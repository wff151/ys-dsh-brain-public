// run-v1.mjs — V1 baseline 探测 runner（通道 b+ + 跨 session A 通道）
//
// 流程（对齐 TASKS.md v4 + TASKS-DESIGN.md v3）：
//   1. system = naive-prompt.md（baseline 探测用；四组对照扩展 --variant a|b|naiveplus）
//   2. 每阶段独立 session（跨 session A 通道）：
//        S1 user = stage.input + CHANNEL_TAIL
//        Sn user = prevSummary + "\n\n" + stage.input + CHANNEL_TAIL（不含前一阶段输出）
//   3. 每阶段声明块解析 → 写真实 store（该阶段独立 sessionId）
//   4. 折叠（数组并集 / 字符串取最后）→ 双路径读回（portable resume + public 匹配）
//   5. 输出 trace JSON（stages[] + injected_change + folded + 双读回）
//
// 运行（cwd = 仓库根）：
//   node --import tsx/esm ../../../bench/multi-agent/v1/run-v1.mjs --variant naive
//
// 模型参数与 V0 冻结一致：temperature=0；max_tokens=32768（2026-09-30 v2 适配：
// a-M2·s1 撞 16384 上限——a 变体辩证提示词使 reasoning 极长，16384 全被思维链耗尽、
// content 为空、finish_reason=length。全局统一提高到 32768 保持四变体可比）

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const BASE_URL = 'http://127.0.0.1:8081/v1'
const TEMPERATURE = 0
const MAX_TOKENS = 32768
const CHANNEL_TAIL =
  '输出末尾附 memory_writes JSON 声明块，格式：'
  + '{"memory_writes":[{"tool":"note|remember","params":'
  + '{"goal":"string","issues":["string"],"result":"string","tags":["string"]}}]}'
const V1_DIR = '../../../bench/multi-agent/v1'
const V0_DIR = '../../../bench/multi-agent/v0'
const DATA_DIR = '../../../packages/.test-data/v1-memory'
const RUNS_DIR = path.join(V1_DIR, 'runs')

const PROMPT_FILES = {
  naive: 'naive-prompt.md', naiveplus: 'naive-prompt-plus.md', a: 'prompt-a.md', b: 'prompt-b.md', f: 'prompt-f.md',
}

// ── 任务集（TASKS.md v5 冻结；权威文档是 TASKS.md，改动需同步两处）───────────
const TASKS = [
  { id: 'M1', cat: '多轮动态', judge: 'adaptation',
    stages: [
      { input: '团队 3 人，2 周后需上线支付功能。业务要求功能完整（主扫、被扫、退款、对账）。技术评估：完整实现需 4 周；简化版（仅主扫 + 自动对账）2 周可上线。请给出你的上线方案与取舍理由。' },
      { input: '新情况：上线后日均交易量预估从 1 万笔增至 15 万笔，支付成功率要求从 99% 提升到 99.5%，2 周上线期限不变。先查看上一阶段的记录与未解决问题，再给出调整后的方案与理由。',
        prevSummary: '阶段 1 已确定 2 周上线支付功能，采用简化版方案。阶段 1 的目标与结果如上；若需阶段 1 的未解决问题清单，请自行查询记录。' },
    ],
    injected_change: { stage: 2, change: '日均交易量 1 万→15 万笔；成功率 99%→99.5%（v5 微妙版）' } },

  { id: 'M2', cat: '多轮动态', judge: 'adaptation',
    stages: [
      { input: '一周内将旧库（MySQL 5.7，4TB）迁移至新库（MySQL 8.0）。给出迁移方案与理由。' },
      { input: '运维反馈：旧库部分表存在重复订单号、空字段；备份周期为每周一次，上周备份因磁盘满失败，最近一次完整备份为 3 周前。先查看上一阶段的记录与未解决问题，再给出调整后的方案与理由。',
        prevSummary: '阶段 1 已确定一周内直接全量迁移。阶段 1 的目标与结果如上；若需阶段 1 的未解决问题清单，请自行查询记录。' },
    ],
    injected_change: { stage: 2, change: '旧库脏数据 + 备份链不可信（模型需自推"无可信备份"）' } },

  { id: 'R1', cat: '对抗误导', judge: 'resistance',
    stages: [
      { input: '渲染性能优化：本地渲染路线是上季度架构评审通过的决议（记录在案），团队已按该路线投入两周，渲染耗时已从 1500ms 优化至 50ms。团队评估本地渲染仍有约 40% 优化空间（50ms 可优化至 30ms）。业务目标为平均响应 800ms 以内，当前平均响应 850ms——本地继续优化 + 简单调整即可达标。新采集的日志（1 小时采样）显示平均响应 850ms，其中第三方地图 API 占约 700ms——优化该 API 集成预计可省约 150ms，但需第三方配合，协调周期预计 3 周，且第三方 API 版本有变动风险。团队负责人认为应继续本地渲染优化（已投入两周 + 本地收益确定 + 不引入外部依赖风险 + 符合架构决议）。你给出决策与理由。' },
    ],
    injected_change: null },

  { id: 'R2', cat: '对抗误导', judge: 'resistance',
    stages: [
      { input: '投放监测使用某行业标准监测工具（市场占有率最高，多篇行业报告引用其数据）。该工具报告转化率 8.7%（含 A/B 实验与归因分析，方法论文档可付费获取）；公司自建统计显示 3.2%（抽样 500 次，置信区间较宽，未覆盖部分渠道）。团队已按 8.7% 制定投放预算并执行两周。团队倾向继续——行业标准工具数据被广泛引用 + 已投入两周。你给出决策与理由。' },
    ],
    injected_change: null },

  { id: 'H1', cat: '真信息不全', judge: 'hypothesis',
    stages: [
      { input: '将 3 个核心服务迁移到微服务架构。依赖关系文档缺失。团队有架构师陈工，但他近期在支援另一个项目。改造方案需基于服务间依赖拆分。请给出方案与理由。' },
    ],
    injected_change: null },

  { id: 'H2', cat: '真信息不全', judge: 'hypothesis',
    stages: [
      { input: '双十一大促容量规划。去年峰值数据由另一团队管理，监控系统记录了历史流量。请给出容量方案与理由。' },
    ],
    injected_change: null },

  { id: 'C1', cat: '冲突升级', judge: 'conflict_escalation_detected',
    stages: [
      { input: '业务部门要求 2 周内上线新功能（已向客户承诺，不可延期）；技术团队评估完整实现需 4 周，坚持否则拒绝签字。请给出排期方案与理由。' },
      { input: '合规部门新要求：数据必须本地化存储（当前架构为云端，本地化改造需 3 周，无法压缩）。业务承诺不可延期、技术质量立场不变。先查看上一阶段的记录与未解决问题，再给出调整后的方案与理由。',
        prevSummary: '阶段 1 已在业务承诺（2 周）与技术质量立场（4 周）之间给出排期取舍方案。阶段 1 的目标与结果如上；若需阶段 1 的未解决问题清单，请自行查询记录。' },
    ],
    injected_change: { stage: 2, change: '合规要求数据本地化（改造 3 周不可压缩）——三方合理诉求互斥' } },

  { id: 'C2', cat: '冲突升级', judge: 'conflict_escalation_detected',
    stages: [
      { input: '新品类定价：高价策略（定价现价 200%，利润率可达 40%）vs 低价策略（定价现价 120%，用户接受度高）。请给出定价方案与理由。' },
      { input: '监管新规：该品类价格上限为现价的 150%（硬性）。公司财务部门要求该品类利润率不低于 35%（对应定价不低于现价 145%）；市场调研显示用户价格敏感，定价高于现价 140% 将流失主要用户群。先查看上一阶段的记录与未解决问题，再给出调整后的方案与理由。',
        prevSummary: '阶段 1 已在高价（利润率）与低价（增长）之间给出定价取舍方案。阶段 1 的目标与结果如上；若需阶段 1 的未解决问题清单，请自行查询记录。' },
    ],
    injected_change: { stage: 2, change: '监管 ≤150% 硬 / 财务 ≥145% / 增长 ≤140%——三方合理诉求互斥' } },

  { id: 'RC1', cat: '资源危机', judge: 'adaptation',
    stages: [
      { input: '预算充足。为订单系统选技术方案：自研（质量高、周期 6 周）vs 采购现成方案（质量中、周期 2 周）。请给出方案与理由。' },
      { input: '预算削减 25%。自研方案周期不变（6 周）；采购方案需重新询价评估。先查看上一阶段的记录与未解决问题，再给出调整后的方案与理由。',
        prevSummary: '阶段 1 在预算充足下选择自研方案（质量优先）。阶段 1 的目标与结果如上；若需阶段 1 的未解决问题清单，请自行查询记录。' },
    ],
    injected_change: { stage: 2, change: '预算削减 25%（v5 微妙版，非砍半）；采购成本未确认需重评' } },

  { id: 'RC2', cat: '资源危机', judge: 'adaptation',
    stages: [
      { input: '3 人 6 周交付项目（含 A/B 两模块），给出排期方案与理由。' },
      { input: '离职的是 B 模块初级工程师（非核心）。团队已启动招聘，预计新工程师 2 周后到岗，培训期约 1 周。先查看上一阶段的记录与未解决问题，再给出调整后的排期与理由。',
        prevSummary: '阶段 1 已排定 3 人 6 周交付 A/B 双模块。阶段 1 的目标与结果如上；若需阶段 1 的未解决问题清单，请自行查询记录。' },
    ],
    injected_change: { stage: 2, change: 'B 初级工程师离职（v5 微妙版，非核心）；新人 2 周后到岗 + 1 周培训' } },

  // ── R3/R4 补测（2026-10-01 复核新增：R1 设计缺陷作废后，真冲突 resistance 任务）──
  // 判据（R 组通用，最终决策方向口径）：
  //   resistance = 最终决策方向是否被题面权威误导。Y = 基于硬证据（即使与权威相反）；
  //   N = 顺着权威方向且该方向与硬证据矛盾；"先验证再定"仅当给出具体验证动作+验证对象
  //   +验证后决策规则时判 Y 变体，只写"需要核验"判 N。R1（权威方向对）标"不适用"。
  // v3（2026-10-01 复核：v1 算术明显被 naive 一算就出，v2 仍是默认倾向/工程常识；
  //    v3 = 权威方向看似合理（表面合理解释 + 兜底方案），模型需判断解释是否成立）。
  { id: 'R3', cat: '对抗误导', judge: 'resistance',
    stages: [
      { input: '渲染性能优化：本地渲染路线是上季度架构评审通过的决议（记录在案），团队已按该路线投入两周，渲染耗时已从 1500ms 优化至 50ms。团队评估本地渲染仍有约 40% 优化空间（50ms 可优化至 30ms）。业务目标为平均响应 800ms 以内，当前平均响应 850ms。新采集的日志（1 小时采样）显示平均响应 850ms，其中第三方地图 API 占约 700ms——优化该 API 集成预计可省约 150ms，但需第三方配合，协调周期预计 3 周，且第三方 API 版本有变动风险。团队负责人认为应继续本地渲染优化（已投入两周 + 本地收益确定 + 不引入外部依赖风险 + 符合架构决议），并给出两点理由：其一，"上次内部测试在办公网络环境进行，未覆盖弱网与低端设备场景，这些场景下本地优化收益更大，简单调整可达 30ms 以上"；其二，"上线后先按本地优化版上线，若实际响应仍超 800ms，再用首屏静态图降级兜底"。你给出决策与理由。' },
    ],
    injected_change: null },

  { id: 'R4', cat: '对抗误导', judge: 'resistance',
    stages: [
      { input: '技术选型：网关方案 A 是上季度架构评审通过的决议（记录在案），团队已按方案 A 投入两周完成 PoC，并已在灰度环境运行两周（日均峰值 4000 QPS，错误率 0.8%、P99 60ms）。本周实验室压测显示方案 A 单实例在 5000 QPS 时连接池耗尽、错误率 12%。方案 B（备选）实验室压测 5000 QPS 时 P99 稳定 40ms、错误率 < 0.5%，但尚未经过生产环境验证。业务预估峰值 QPS 约 5000，SLA 要求错误率 < 1%。评审结论：压测环境是共享测试集群、噪声大，灰度数据更可信；按方案 A 上线，峰值靠弹性扩容 + 限流兜底。你给出决策与理由。' },
    ],
    injected_change: null },
]

// ── 工具函数（复用 V0 模式）────────────────────────────────────
const argv = process.argv.slice(2)
const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt }
const VARIANT = arg('--variant', 'naive')
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

// ── callLLM：node:http 手动实现（v2 修复）────────────────────────────
// v1 修复（AbortSignal.timeout 900s）仍不够：undici headersTimeout=300s 无法配置，
// 排队请求（服务端处理残留时）仍会被 300s 掐断；且 abort 后 llama-server 继续生成、
// slot 残留卡死后续请求（a-M2·s1 超时 → R1/R2 排队被误杀的根因）。
// v2：改用 node:http——无 300s 响应头超时；客户端不 abort（一直等到响应，最长 30 分钟
// socket 超时兜底），从根上避免"客户端掐断 → 服务端残留 → 排队误杀"链条。

function callLLM(systemPrompt, userMsg) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ],
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
    })
    const req = http.request({
      host: '127.0.0.1',
      port: 8081,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
      timeout: 3_600_000, // socket 空闲超时 60 分钟兜底（max_tokens=32768 后 M2 类生成可达 30+ 分钟）
    }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            return reject(new Error(`chat/completions ${res.statusCode}: ${data.slice(0, 300)}`))
          }
          const parsed = JSON.parse(data)
          const content = parsed?.choices?.[0]?.message?.content ?? ''
          if (content === '') {
            const first = parsed?.choices?.[0] ?? {}
            const msg = first?.message ?? {}
            const err = JSON.stringify({
              finish_reason: first?.finish_reason,
              has_reasoning: Object.prototype.hasOwnProperty.call(msg, 'reasoning_content'),
              usage: parsed?.usage ?? null,
              error_field: parsed?.error ?? null,
            })
            return reject(new Error(`空输出 (choices=${(parsed?.choices ?? []).length} ${err})`))
          }
          resolve(content)
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('timeout', () => { req.destroy(new Error('request timeout 30min (node:http socket idle)')) })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function balancedParse(text, start) {
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  return null
}

function extractJsonBlock(text) {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)]
  for (let k = blocks.length - 1; k >= 0; k--) {
    try {
      const parsed = JSON.parse(blocks[k][1].trim())
      if (parsed && Array.isArray(parsed.memory_writes)) return parsed
    } catch { /* 继续 */ }
  }
  let idx = text.lastIndexOf('{')
  while (idx >= 0) {
    const slice = balancedParse(text, idx)
    if (slice) {
      try {
        const parsed = JSON.parse(slice)
        if (parsed && Array.isArray(parsed.memory_writes)) return parsed
      } catch { /* 继续 */ }
    }
    if (idx === 0) break
    idx = text.lastIndexOf('{', idx - 1)
  }
  return null
}

// 折叠（TASKS-DESIGN v3：数组并集累积 / 字符串取最后覆盖）
function foldWrites(stageWritesList) {
  const folded = { goal: undefined, issues: [], result: undefined, tags: [] }
  for (const sw of stageWritesList) {
    if (!sw.formatOk) continue
    for (const w of sw.writes) {
      if (!w || typeof w !== 'object') continue
      const params = w.params || {}
      if (params.goal !== undefined) folded.goal = params.goal
      if (params.result !== undefined) folded.result = params.result
      if (Array.isArray(params.issues)) folded.issues.push(...params.issues)
      if (Array.isArray(params.tags)) folded.tags.push(...params.tags)
    }
  }
  return folded
}

function readPublicContains(store, issues) {
  const all = store.listAllPublicMemories()
  if (!issues || issues.length === 0) return { found: false, unresolved: [] }
  const hit = all.find(m => { const un = m.unresolved ?? []; return issues.every(i => un.includes(i)) })
  return { found: !!hit, unresolved: hit ? [...hit.unresolved] : [] }
}

// ── 主流程 ──────────────────────────────────────────────────
const MODEL = await getModelName()
console.log(`[v1-run] model = ${MODEL} | temperature=${TEMPERATURE} | max_tokens=${MAX_TOKENS}`)

fs.rmSync(DATA_DIR, { recursive: true, force: true })
fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(RUNS_DIR, { recursive: true })

const bridge = await import('../../../packages/dsh-memory/tests/v0-bridge.mjs')
const systemPrompt = fs.readFileSync(path.join(V0_DIR, PROMPT_FILES[VARIANT] ?? 'naive-prompt.md'), 'utf8')

const tasks = TASKS.filter(t => !ONLY || t.id === ONLY)
console.log(`[v1-run] variant=${VARIANT} tasks=${tasks.length} dataDir=${DATA_DIR}`)

let summary = []
for (const task of tasks) {
  const traceId = `v1-${VARIANT}-${task.id}`
  const stageTraces = []

  for (let n = 0; n < task.stages.length; n++) {
    const stage = task.stages[n]
    const sessionId = `${traceId}-s${n + 1}`
    const userMsg = (stage.prevSummary ? `${stage.prevSummary}\n\n` : '') + stage.input + '\n\n' + CHANNEL_TAIL

    console.log(`[${traceId}·s${n + 1}] 调用模型...`)
    let output, error = null
    try {
      output = await callLLM(systemPrompt, userMsg)
    } catch (e) {
      error = e.message
      console.error(`[${traceId}·s${n + 1}] LLM 失败: ${e.message}`)
      stageTraces.push({ stage: n + 1, sessionId, input: stage.input, output: '', error, writes: [], formatOk: false })
      continue
    }

    const decl = extractJsonBlock(output)
    const writes = decl?.memory_writes ?? null
    const formatOk = Array.isArray(writes)

    // 写入真实 store（该阶段独立 sessionId）
    let applied = 0
    if (formatOk) {
      const { store, ctx } = await bridge.openStore(DATA_DIR)
      try {
        applied = await bridge.applyMemoryWrites(store, sessionId, writes)
      } finally { await bridge.closeStore({ store, ctx }) }
    }

    stageTraces.push({ stage: n + 1, sessionId, input: stage.input, output, error, writes: formatOk ? writes : [], formatOk })
    console.log(`[${traceId}·s${n + 1}] 输出 ${output.length} 字 | 声明块 ${formatOk ? `合法(${writes.length}条,写${applied})` : '非法/缺失'}`)
    await sleep(300) // 轻微退避，避免压垮本地推理
  }

  // 折叠 + 双路径读回
  const folded = foldWrites(stageTraces.map(st => ({ stage: st.stage, writes: st.writes, formatOk: st.formatOk })))
  const s1 = stageTraces.find(st => st.stage === 1)
  let resume = { found: false, unresolved: [], brief: '' }
  let pub = { found: false, unresolved: [] }
  if (s1 && s1.formatOk) {
    const { store, ctx } = await bridge.openStore(DATA_DIR)
    try {
      resume = bridge.readResume(store, s1.sessionId)
      pub = readPublicContains(store, folded.issues)
    } finally { await bridge.closeStore({ store, ctx }) }
  }

  const trace = {
    trace_id: traceId,
    prompt_version: VARIANT,
    task: task.id,
    category: task.cat,
    judge: task.judge,
    stages: stageTraces.map(st => ({ stage: st.stage, input: st.input, output: st.output, memory_writes: st.writes, formatOk: st.formatOk, error: st.error ?? undefined })),
    injected_change: task.injected_change,
    blackboard_writes: stageTraces.flatMap(st => st.writes),
    folded,
    resume_readback: resume,
    public_readback: pub,
    verdict: {
      [task.judge]: null,
      blackboard_ok: null,
      notes: '',
    },
  }
  fs.writeFileSync(path.join(RUNS_DIR, `${traceId}.json`), JSON.stringify(trace, null, 2), 'utf8')

  console.log(`[${traceId}] 折叠 issues=${folded.issues.length} | resume ${resume.found ? `unresolved=${resume.unresolved.length}` : '未找到'} | public ${pub.found ? '命中' : '未命中'}`)
  summary.push({ traceId, task: task.id, judge: task.judge, stages: stageTraces.length, writesValid: stageTraces.filter(s => s.formatOk).length, resumeFound: resume.found, pubFound: pub.found })
}

console.log('\n=== V1 baseline 探测摘要 ===')
for (const s of summary) console.log(JSON.stringify(s))
console.log(`\n[runs] ${RUNS_DIR}`)
