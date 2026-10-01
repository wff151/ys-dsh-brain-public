// run-v2.mjs — V2 H-协作 runner（通道 b+，P/N/F 三组对照）
//
// 流程（对齐 v2/TASKS.md 冻结）：
//   阶段 1（每任务 1 次，三组共用）：system=prompt-s1.md；user=stage1.input+CHANNEL_TAIL
//     解析 memory_writes → 写真实 store（sessionId=task-s1）
//   阶段 2：
//     P 组：轮1 user=prevSummary+stage2.input+P_TAIL → 解析 memory_reads → 脚本代读
//           （resume=portable / search=public）→ 取回内容作为轮2输入 → 模型输出决策
//     N 组：user=prevSummary+stage2.input（无读取提示）→ 单轮决策
//     F 组：user=prevSummary+stage2.input+"上一阶段 issues 全文：\n"+s1 issues → 单轮决策
//   判定（自动）：key_facts 命中（传递完整性 / 使用效率）；决策质量人工判（记录全文）
//
// 运行（cwd = 仓库根）：
//   node --import tsx/esm ../../../bench/multi-agent/v2/run-v2.mjs [--only T1]

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const BASE_URL = 'http://127.0.0.1:8081/v1'
const TEMPERATURE = 0
const MAX_TOKENS = 8192
const S1_CHANNEL_TAIL =
  '输出末尾附 memory_writes JSON 声明块，格式：'
  + '{"memory_writes":[{"tool":"note|remember","params":'
  + '{"goal":"string","issues":["string"],"result":"string","tags":["string"]}}]}'
const P_TAIL =
  '决策前请先检查是否需要上一阶段的矛盾清单/关键变量。如需，请在输出末尾附 memory_reads JSON 声明块，格式：'
  + '{"memory_reads":[{"tool":"resume|search","query":"string"}]}（resume=读阶段 1 会话笔记，query 可留空；'
  + 'search=按关键词查全局记忆，query 填 2-4 个关键词即可）。本轮只输出声明块，不要给出决策。'
const V2_DIR = '../../../bench/multi-agent/v2'
const DATA_DIR = '../../../packages/.test-data/v2-memory'
const RUNS_DIR = path.join(V2_DIR, 'runs')

// ── 任务集（v2/TASKS.md 冻结；权威文档是 TASKS.md，改动需同步两处）─────────
const TASKS = [
  { id: 'T1', cat: '支付扩容',
    key_facts: ['简化版', '2周', '4周', '3人'],
    expected_decision: '需调整方案——简化版功能集在 50 万笔下容量不足（扩功能/加人/调整上线策略），不能维持原样',
    stage1: { input: '团队 3 人，2 周后需上线支付功能。业务要求功能完整（主扫、被扫、退款、对账）。技术评估：完整实现需 4 周；简化版（仅主扫 + 自动对账）2 周可上线。分析主要矛盾，列出决策必需的关键变量（功能范围、期限、人力、工作量），写入 issues。' },
    stage2: { input: '新情况：上线后日均交易量预估从 1 万笔增至 50 万笔，支付成功率要求 99.5%，上线期限不变。给出决策与理由。',
      prevSummary: '阶段 1 已分析主要矛盾并列出关键变量。阶段 1 的目标与结果如上；若需阶段 1 的矛盾清单/关键变量，请自行查询记录。' } },

  { id: 'T2', cat: '定价',
    key_facts: ['200%', '40%', '120%', '140%'],
    expected_decision: '识别区间互斥（监管≤150%/财务≥145%/增长≤140% 无交集），给三方权衡方案，不能只选"150% 兼顾"',
    stage1: { input: '新品类定价。市场调研显示用户价格敏感，定价高于现价 140% 将流失主要用户群。候选：高价策略（定价现价 200%，利润率 40%）vs 低价策略（定价现价 120%，用户接受度高）。分析主要矛盾，列出决策必需的关键变量，写入 issues。' },
    stage2: { input: '监管新规：该品类价格上限为现价的 150%（硬性）。公司财务部门要求该品类利润率不低于 35%（对应定价不低于现价 145%）。给出定价决策与理由。',
      prevSummary: '阶段 1 已分析主要矛盾并列出关键变量。阶段 1 的目标与结果如上；若需阶段 1 的矛盾清单/关键变量，请自行查询记录。' } },

  { id: 'T4', cat: '技术选型',
    key_facts: ['自研', '6周', '采购', '2周'],
    expected_decision: '需重评估（预算变化改变自研/采购权衡；采购成本未确认需重评），不能维持原决策',
    stage1: { input: '预算充足。为订单系统选技术方案：自研（质量高、周期 6 周）vs 采购现成方案（质量中、周期 2 周）。分析主要矛盾，列出决策必需的关键变量，写入 issues。' },
    stage2: { input: '预算削减 25%。所选方案周期不变；备选方案需重新询价评估（价格可能上调）。给出决策与理由。',
      prevSummary: '阶段 1 已分析主要矛盾并列出关键变量。阶段 1 的目标与结果如上；若需阶段 1 的矛盾清单/关键变量，请自行查询记录。' } },

  { id: 'T5', cat: '数据迁移',
    maxTokens: <elided>, // 适配：T5 迁移分析过长，8192 截断声明块（任务 token 需求差异，V2 冻结 8192 的例外，记录在案）
    key_facts: ['一周', '4TB', 'MySQL 5.7', 'MySQL 8.0'],
    expected_decision: '先解决数据完整性与备份（不能直接全量迁移），评估"补备份+迁移"是否在一周内可行',
    stage1: { input: '一周内将旧库（MySQL 5.7，4TB）迁移至新库（MySQL 8.0）。分析主要矛盾，列出决策必需的关键变量，写入 issues。' },
    stage2: { input: '运维反馈：旧库部分表存在重复订单号、空字段；备份周期为每周一次，上周备份因磁盘满失败，最近一次完整备份为 3 周前。给出迁移方案与理由。',
      prevSummary: '阶段 1 已分析主要矛盾并列出关键变量。阶段 1 的目标与结果如上；若需阶段 1 的矛盾清单/关键变量，请自行查询记录。' } },

  { id: 'T6', cat: '供应链',
    key_facts: ['单一供应商', '6周', '30%', '4周'],
    expected_decision: '双轨应对（库存 4 周 < 停产 8 周；替代交期需评估），不能只"等恢复"或只"找替代"',
    stage1: { input: '核心元器件由单一供应商提供，交期 6 周，成本占比 30%，当前库存可支撑 4 周生产。分析主要矛盾，列出决策必需的关键变量，写入 issues。' },
    stage2: { input: '供应商所在地区突发风险，预估停产 8 周。给出应对决策与理由。',
      prevSummary: '阶段 1 已分析主要矛盾并列出关键变量。阶段 1 的目标与结果如上；若需阶段 1 的矛盾清单/关键变量，请自行查询记录。' } },

  { id: 'T8', cat: '招聘排期',
    key_facts: ['3人', '6周', 'A', 'B'],
    expected_decision: '交付周期需延长或重新分配人力（5 周损失 > 剩余预算），不能维持 6 周原排期',
    stage1: { input: '3 人 6 周交付项目（含 A/B 双模块），给出排期方案与理由。分析主要矛盾，列出决策必需的关键变量，写入 issues。' },
    stage2: { input: '核心模块工程师离职。团队已启动招聘，预计新工程师 3 周后到岗，培训期约 2 周。给出调整后的排期与理由。',
      prevSummary: '阶段 1 已分析主要矛盾并列出关键变量。阶段 1 的目标与结果如上；若需阶段 1 的矛盾清单/关键变量，请自行查询记录。' } },
]

// ── 工具函数（复用 V1 模式）────────────────────────────────────
const argv = process.argv.slice(2)
const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt }
const ONLY = arg('--only', null)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function getModelName() {
  const res = await fetch(`${BASE_URL}/models`)
  if (!res.ok) throw new Error(`models 查询失败: ${res.status}`)
  const data = await res.json()
  const names = (data.data ?? []).map(m => m.id)
  if (names.length === 0) throw new Error('models 列表为空')
  return names[0]
}

function callLLM(systemPrompt, userMsg, maxTokens = MAX_TOKENS) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ],
      temperature: TEMPERATURE,
      max_tokens: maxTokens,
    })
    const req = http.request({
      host: '127.0.0.1', port: 8081, path: '/v1/chat/completions', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      timeout: 3_600_000,
    }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) return reject(new Error(`chat/completions ${res.statusCode}: ${data.slice(0, 300)}`))
          const parsed = JSON.parse(data)
          const content = parsed?.choices?.[0]?.message?.content ?? ''
          if (content === '') {
            const first = parsed?.choices?.[0] ?? {}
            const msg = first?.message ?? {}
            return reject(new Error(`空输出 (finish=${first?.finish_reason} usage=${JSON.stringify(parsed?.usage ?? null)})`))
          }
          resolve(content)
        } catch (e) { reject(e) }
      })
    })
    req.on('timeout', () => { req.destroy(new Error('request timeout 60min (node:http socket idle)')) })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function balancedParse(text, start) {
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  return null
}

function extractJsonBlock(text, key) {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)]
  for (let k = blocks.length - 1; k >= 0; k--) {
    try { const p = JSON.parse(blocks[k][1].trim()); if (p && Array.isArray(p[key])) return p } catch { /* 继续 */ }
  }
  let idx = text.lastIndexOf('{')
  while (idx >= 0) {
    const slice = balancedParse(text, idx)
    if (slice) { try { const p = JSON.parse(slice); if (p && Array.isArray(p[key])) return p } catch { /* 继续 */ } }
    if (idx === 0) break
    idx = text.lastIndexOf('{', idx - 1)
  }
  return null
}

const norm = (s) => String(s ?? '').replace(/\s+/g, '')
function hitFacts(text, keyFacts) {
  const t = norm(text)
  return keyFacts.map(f => ({ fact: f, hit: t.includes(norm(f)) }))
}

function searchPublicByQuery(store, query) {
  const all = store.listAllPublicMemories()
  // 词级匹配：query 拆 token（分隔符：空格/逗号/顿号/分号/冒号/括号），
  // 任一 token（≥2 字符）命中记录任一字段即算命中。修 v1 全词匹配缺陷。
  const tokens = String(query ?? '').split(/[\s，,。；;：:、（）()]+/).filter(t => t.length >= 2)
  if (tokens.length === 0) return []
  const hits = all.filter(m => {
    const hay = norm([m.title ?? '', (m.unresolved ?? []).join(' '), m.goal ?? '', m.summary ?? '', (m.tags ?? []).join(' ')].join(' '))
    return tokens.some(t => hay.includes(norm(t)))
  })
  return hits
}

// ── 主流程 ──────────────────────────────────────────────────
const MODEL = await getModelName()
console.log(`[v2-run] model = ${MODEL} | temperature=${TEMPERATURE} | max_tokens=${MAX_TOKENS}`)

fs.mkdirSync(RUNS_DIR, { recursive: true })
const bridge = await import('../../../packages/dsh-memory/tests/v0-bridge.mjs')
const sysS1 = fs.readFileSync(path.join(V2_DIR, 'prompt-s1.md'), 'utf8')
const sysS2 = fs.readFileSync(path.join(V2_DIR, 'prompt-s2.md'), 'utf8')

const tasks = TASKS.filter(t => !ONLY || t.id === ONLY)
console.log(`[v2-run] tasks=${tasks.length} dataDir=${DATA_DIR}`)

const summary = []
for (const task of tasks) {
  const s1SessionId = `${task.id}-s1`
  // ── 阶段 1（三组共用；每任务独立 DATA_DIR，先清空）──────
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
  fs.mkdirSync(DATA_DIR, { recursive: true })

  console.log(`[${task.id}·s1] 调用模型（分析+写黑板）...`)
  const s1Output = await callLLM(sysS1, task.stage1.input + '\n\n' + S1_CHANNEL_TAIL, task.maxTokens)
  const s1Decl = extractJsonBlock(s1Output, 'memory_writes')
  const s1Writes = s1Decl?.memory_writes ?? null
  const s1FormatOk = Array.isArray(s1Writes)
  let s1Applied = 0
  if (s1FormatOk) {
    const { store, ctx } = await bridge.openStore(DATA_DIR)
    try {
      for (const w of s1Writes) {
        await bridge.applyMemoryWrites(store, s1SessionId, [w])
        s1Applied++
      }
    } finally { await bridge.closeStore({ store, ctx }) }
  }
  console.log(`[${task.id}·s1] 输出 ${s1Output.length} 字 | 声明块 ${s1FormatOk ? `合法(${s1Applied}写)` : '非法/缺失'}`)

  // 阶段 1 issues 原文（F 组注入 + P 组取回基准）
  const s1Issues = s1FormatOk
    ? s1Writes.flatMap(w => Array.isArray(w.params?.issues) ? w.params.issues : [])
    : []
  const s2Base = (task.stage2.prevSummary ?? '') + '\n\n' + task.stage2.input

  // ── P 组 ─────────────────────────────────────────────
  const pTrace = { trace_id: `v2-${task.id}-P`, task: task.id, group: 'P' }
  let pReadbackContent = '', pCompleteness = null, pUsage = null, pDecision = ''
  try {
    // 轮 1：memory_reads
    console.log(`[${task.id}·P·r1] 调用模型（声明读取）...`)
    const pR1 = await callLLM(sysS2, s2Base + '\n\n' + P_TAIL, task.maxTokens)
    const readsDecl = extractJsonBlock(pR1, 'memory_reads')
    const reads = readsDecl?.memory_reads ?? null
    pTrace.round1 = { output: pR1, reads, formatOk: Array.isArray(reads) }
    // 代读
    const parts = []
    if (Array.isArray(reads)) {
      const { store, ctx } = await bridge.openStore(DATA_DIR)
      try {
        for (const r of reads) {
          if (r?.tool === 'resume') {
            const rb = bridge.readResume(store, s1SessionId)
            if (rb.found) parts.push(`[portable resume ${s1SessionId}] goal=${rb.brief.slice(0, 200)}\nissues=${rb.unresolved.join(' | ')}`)
            else parts.push('[portable resume] 未找到该会话记录')
          } else if (r?.tool === 'search') {
            const hits = searchPublicByQuery(store, r?.query ?? '')
            if (hits.length > 0) {
              const h = hits[hits.length - 1]
              parts.push(`[public search "${r.query}"] 命中 ${hits.length} 条，最新：title=${h.title}\nunresolved=${(h.unresolved ?? []).join(' | ')}`)
            } else parts.push(`[public search "${r.query}"] 未命中`)
          }
        }
      } finally { await bridge.closeStore({ store, ctx }) }
    }
    pReadbackContent = parts.join('\n---\n')
    pTrace.readback = { content: pReadbackContent, readsIssued: Array.isArray(reads) ? reads.length : 0 }
    // 轮 2：决策（重述 stage2 题面，保证模型同时看到新情况与取回结果）
    console.log(`[${task.id}·P·r2] 调用模型（决策）...`)
    pDecision = await callLLM(sysS2, '上一阶段记录取回结果：\n' + (pReadbackContent || '（未发起取回）') + '\n\n' + task.stage2.input + '\n\n请基于取回结果与当前信息给出最终决策与理由。', task.maxTokens)
    pTrace.round2 = { output: pDecision }
    pCompleteness = hitFacts(pReadbackContent, task.key_facts)
    pUsage = hitFacts(pDecision, task.key_facts)
  } catch (e) {
    pTrace.error = e.message
    console.error(`[${task.id}·P] 失败: ${e.message}`)
  }
  pTrace.metrics = {
    completeness: pCompleteness ? { hit: pCompleteness.filter(h => h.hit).length, total: task.key_facts.length, facts: pCompleteness } : null,
    usage: pUsage ? { hit: pUsage.filter(h => h.hit).length, total: task.key_facts.length, facts: pUsage } : null,
    decision: pDecision,
    expected_decision: task.expected_decision,
    s1_issues: s1Issues,
  }
  fs.writeFileSync(path.join(RUNS_DIR, `${pTrace.trace_id}.json`), JSON.stringify(pTrace, null, 2), 'utf8')
  const pC = pTrace.metrics.completeness
  const pU = pTrace.metrics.usage
  console.log(`[${task.id}·P] 读回 ${pC ? `${pC.hit}/${pC.total}` : '无'} | 决策用 ${pU ? `${pU.hit}/${pU.total}` : '无'}`)

  // ── N 组（单轮决策，无读取提示）────────────────────────
  const nTrace = { trace_id: `v2-${task.id}-N`, task: task.id, group: 'N' }
  try {
    console.log(`[${task.id}·N] 调用模型（决策）...`)
    const nOut = await callLLM(sysS2, s2Base, task.maxTokens)
    nTrace.decision = nOut
    nTrace.metrics = {
      usage: { hit: hitFacts(nOut, task.key_facts).filter(h => h.hit).length, total: task.key_facts.length, facts: hitFacts(nOut, task.key_facts) },
      decision: nOut,
      expected_decision: task.expected_decision,
    }
  } catch (e) { nTrace.error = e.message; console.error(`[${task.id}·N] 失败: ${e.message}`) }
  fs.writeFileSync(path.join(RUNS_DIR, `${nTrace.trace_id}.json`), JSON.stringify(nTrace, null, 2), 'utf8')
  const nU = nTrace.metrics?.usage
  console.log(`[${task.id}·N] 决策用 ${nU ? `${nU.hit}/${nU.total}` : '无'}`)

  // ── F 组（单轮决策，issues 全文注入）───────────────────
  const fTrace = { trace_id: `v2-${task.id}-F`, task: task.id, group: 'F' }
  try {
    console.log(`[${task.id}·F] 调用模型（决策）...`)
    const fOut = await callLLM(sysS2, s2Base + '\n\n上一阶段 issues 全文：\n' + (s1Issues.join('\n') || '（阶段 1 未产出 issues）'), task.maxTokens)
    fTrace.decision = fOut
    fTrace.metrics = {
      usage: { hit: hitFacts(fOut, task.key_facts).filter(h => h.hit).length, total: task.key_facts.length, facts: hitFacts(fOut, task.key_facts) },
      decision: fOut,
      expected_decision: task.expected_decision,
    }
  } catch (e) { fTrace.error = e.message; console.error(`[${task.id}·F] 失败: ${e.message}`) }
  fs.writeFileSync(path.join(RUNS_DIR, `${fTrace.trace_id}.json`), JSON.stringify(fTrace, null, 2), 'utf8')
  const fU = fTrace.metrics?.usage
  console.log(`[${task.id}·F] 决策用 ${fU ? `${fU.hit}/${fU.total}` : '无'}`)

  summary.push({
    task: task.id,
    s1FormatOk, s1Issues: s1Issues.length,
    P: { reads: pTrace.round1?.formatOk ?? null, completeness: pC ? `${pC.hit}/${pC.total}` : 'x', usage: pU ? `${pU.hit}/${pU.total}` : 'x' },
    N: { usage: nU ? `${nU.hit}/${nU.total}` : 'x' },
    F: { usage: fU ? `${fU.hit}/${fU.total}` : 'x' },
  })
  await sleep(300)
}

console.log('\n=== V2 摘要 ===')
for (const s of summary) console.log(JSON.stringify(s))
console.log(`\n[runs] ${RUNS_DIR}`)
