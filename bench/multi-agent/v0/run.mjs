// V0 runner — 单 agent 辩证法提示词验证（通道 b+）
//
// 流程（与 v0/VERDICT.md §6/§7、v0/TASKS.md 对齐）：
//   1. system = prompt-a.md / prompt-b.md 全文（被测对象，保持纯净）
//   2. user   = 任务描述 + 通道固定尾部（声明块要求，不属于被测提示词）
//   3. 直连 8081 /v1/chat/completions，抓完整输出
//   4. 提取最后一个 ```json 代码块 → 解析 memory_writes 声明块
//   5. 声明块 → v0-bridge（真实 store 写入）→ 真实 resume 渲染读回
//   6. 空话初筛（正则，judged 最终由人工复核）
//   7. 输出 trace JSON（VERDICT.md §4 格式）
//
// 运行（cwd = 仓库根，tsx 在根 node_modules）：
//   node --import tsx/esm ../../../bench/multi-agent/v0/run.mjs            # 全量 16 trace
//   node --import tsx/esm ../../../bench/multi-agent/v0/run.mjs --only T1 --variant a   # 试水
//
// ── 模型参数（冻结，跑中不改）─────────────────────────────
//   temperature = 0（可复现）；max_tokens = 4096（防截断）
//   模型名：跑前从 /v1/models 查询并打印，不写死猜测值。

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// ── 配置区 ──────────────────────────────────────────────
const BASE_URL = 'http://127.0.0.1:8081/v1'
const TEMPERATURE = 0
// max_tokens：2026-09-30 实测 Bonsai 为 thinking 模型，思考链消耗大量 token。
// 4096 被思考耗尽 → 8192 后 T2/T7 仍截断（T7 思考 >8192）→ 上调 16384。
// 此调整是实现适配，非被测提示词变更；正常任务到自然停止，不受上限影响。
const MAX_TOKENS = 16384
const CHANNEL_TAIL =
  '输出末尾附 memory_writes JSON 声明块，格式：'
  + '{"memory_writes":[{"tool":"note|remember","params":'
  + '{"goal":"string","issues":["string"],"result":"string","tags":["string"]}}]}'
const V0_DIR = '../../../bench/multi-agent/v0'
const DATA_DIR = '../../../packages/.test-data/v0-memory'
const RUNS_DIR = path.join(V0_DIR, 'runs')

// 空话词表 v1（2026-09-30 冻结，与 VERDICT.md §3 一致）
const EMPTY_TALK_WORDS = [
  '辩证地看', '一分为二', '对立统一', '既要又要', '具体问题具体分析',
  '抓主要矛盾', '实事求是', '量变质变', '否定之否定', '内因外因',
  '主要矛盾', '次要矛盾', '矛盾双方', '螺旋上升',
]

// 具体内容初筛模式（正则只做初筛；judged 最终人工复核）
const CONCRETE_PATTERNS = [
  /\d+(?:\.\d+)?\s*(?:%|ms|s|分钟|小时|天|周|次|个|条|GB|MB|KB)/,          // 数字+单位（阈值）
  /[<>≥≤]=?\s*\d+(?:\.\d+)?/,                                             // 比较词
  /[A-Za-z]:[\\/]/,                                                        // Windows 路径
  /\.(?:mjs|js|ts|json|md|py|html|css)\b/,                                 // 文件扩展
  /\b(?:note|remember|resume|search|read|write|glob|readFile|writeFile|fetch|记录|写入|读取)\b/i, // 工具名/动词
]

// 任务集（8 条，与 TASKS.md 一致；权威文档是 TASKS.md，改动需同步两处）
const TASKS = [
  { id: 'T1', cat: '冲突目标', desc: '你的团队要在 2 小时内交付一个功能，但完整实现需要约 4 小时。你负责决策如何推进。请说明你的处理方式。' },
  { id: 'T2', cat: '冲突目标', desc: '预算只支持两个方案之一：方案 A 快速上线但维护成本高，方案 B 需要 3 周准备但长期成本低。项目下个月要对外演示。你如何选择？' },
  { id: 'T3', cat: '长期短期', desc: '线上有个 bug 导致约 3% 的用户支付失败。临时方案 5 分钟能修复，但会绕过现有抽象层；根治方案需要重构一个模块，预计 2 天。你如何决策？' },
  { id: 'T4', cat: '长期短期', desc: '一个内部工具出了小问题，快速补丁 10 分钟搞定但会导致下个月返工；规范修复要 1 天且需要跨部门协调。你会怎么做？' },
  { id: 'T5', cat: '局部全局', desc: 'A 模块单独优化能提速 40%，但需要引入一种全项目从未用过的模式；改用全项目统一的现有模式，A 模块只能提速 10%。你如何权衡？' },
  { id: 'T6', cat: '局部全局', desc: '对单个页面做深度定制可以显著提升该页指标，但定制会破坏全站统一的设计系统和交互规范。你如何处理？' },
  { id: 'T7', cat: '信息不全', desc: '用户说"把数据导出功能做好"，没说格式、平台或性能要求。你如何推进这个需求？' },
  { id: 'T8', cat: '信息不全', desc: '要设计一个缓存策略，但你没拿到并发量和数据量。文档里只写了"性能要好"。你怎么做？' },
]

// ── 参数解析 ────────────────────────────────────────────
const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const ONLY = arg('--only', null)          // 试水：--only T1
const VARIANT = arg('--variant', 'a')     // a | b

// ── 工具函数 ────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function getModelName() {
  const res = await fetch(`${BASE_URL}/models`)
  if (!res.ok) throw new Error(`models 查询失败: ${res.status}`)
  const data = await res.json()
  const names = (data.data ?? []).map(m => m.id)
  if (names.length === 0) throw new Error('models 列表为空')
  return names[0]
}

async function callLLM(systemPrompt, userMsg) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ],
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`chat/completions ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content ?? ''
  if (content === '') {
    // 诊断：dump 原始响应结构（Bonsai 可能是 thinking 模型，content 空但 reasoning 有内容）
    const first = data?.choices?.[0] ?? {}
    const msg = first?.message ?? {}
    const err = JSON.stringify({
      finish_reason: first?.finish_reason,
      has_reasoning: Object.prototype.hasOwnProperty.call(msg, 'reasoning_content'),
      reasoning_head: typeof msg.reasoning_content === 'string' ? msg.reasoning_content.slice(0, 120) : null,
      usage: data?.usage ?? null,
      error_field: data?.error ?? null,
    })
    throw new Error(`空输出 (choices=${(data?.choices ?? []).length} ${err})`)
  }
  return content
}

/** 从 start 位置开始做平衡的 {...} 匹配，返回切片；不匹配返回 null。 */
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

/** 提取输出中的 memory_writes 声明块。
 * 优先 ```json 围栏块；无围栏时从后往前枚举裸 JSON 对象，
 * 返回第一个含 memory_writes 数组的（避开最内层 params 等非声明块对象）。 */
function extractJsonBlock(text) {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)]
  for (let k = blocks.length - 1; k >= 0; k--) {
    try {
      const parsed = JSON.parse(blocks[k][1].trim())
      if (parsed && Array.isArray(parsed.memory_writes)) return parsed
    } catch { /* 继续下一个候选 */ }
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

/** 空话初筛：扫词表，命中词看前后 50 字窗口内有无具体内容。 */
function judgeEmptyTalk(text) {
  const hits = []
  for (const word of EMPTY_TALK_WORDS) {
    const idx = text.indexOf(word)
    if (idx < 0) continue
    const win = text.slice(Math.max(0, idx - 50), idx + word.length + 50)
    const concrete = CONCRETE_PATTERNS.some(p => p.test(win))
    hits.push({ word, context: win, judged: concrete ? 'concrete' : 'empty' })
  }
  return hits
}

// ── 主流程 ──────────────────────────────────────────────
const MODEL = await getModelName()
console.log(`[v0-run] model = ${MODEL} | temperature=${TEMPERATURE} | max_tokens=${MAX_TOKENS}`)

// 数据目录隔离：跑前清空重建
fs.rmSync(DATA_DIR, { recursive: true, force: true })
fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(RUNS_DIR, { recursive: true })

// 桥（真实 store + resume）
const bridge = await import('../../../packages/dsh-memory/tests/v0-bridge.mjs')

// 变体：试水(--only)或显式 --variant 用指定变体；全量（未显式指定）跑 a + b 两版
const PROMPT_FILES = { a: 'prompt-a.md', b: 'prompt-b.md', naive: 'naive-prompt.md', naiveplus: 'naive-prompt-plus.md' }
const variants = argv.includes('--variant') ? [VARIANT] : ['a', 'b']
const tasks = TASKS.filter(t => !ONLY || t.id === ONLY)
console.log(`[v0-run] variants=[${variants.join(',')}] tasks=${tasks.length} dataDir=${DATA_DIR}`)

let summary = []
for (const variant of variants) {
  const systemPrompt = fs.readFileSync(path.join(V0_DIR, PROMPT_FILES[variant] ?? PROMPT_FILES.a), 'utf8')
  for (const task of tasks) {
    const traceId = `v0-${variant}-${task.id}`
    const sessionId = `v0-${variant}-${task.id}` // 每条 trace 独立 session
    const userMsg = `${task.desc}\n\n${CHANNEL_TAIL}`

    console.log(`[${traceId}] 调用模型...`)
    let output
    try {
      output = await callLLM(systemPrompt, userMsg)
    } catch (e) {
      console.error(`[${traceId}] LLM 调用失败: ${e.message}`)
      summary.push({ traceId, task: task.id, variant, error: e.message })
      continue
    }

  // 声明块解析（VERDICT §7：缺块/格式不合法 → 黑板读回 fail，不重试）
  const decl = extractJsonBlock(output)
  const writes = decl?.memory_writes ?? null
  const writesValid = Array.isArray(writes)

  // 真实 store 写入 + resume 读回
  let readback = { found: false, unresolved: [], brief: '' }
  if (writesValid) {
    const { store, ctx } = await bridge.openStore(DATA_DIR)
    try {
      await bridge.applyMemoryWrites(store, sessionId, writes)
      readback = bridge.readResume(store, sessionId)
    } finally {
      await bridge.closeStore({ store, ctx })
    }
  }

  const emptyTalkHits = judgeEmptyTalk(output)

  const trace = {
    trace_id: traceId,
    prompt_version: variant,
    task: task.id,
    category: task.cat,
    input: task.desc,
    output,
    blackboard_writes: writesValid ? writes : null,
    resume_readback: {
      found: readback.found,
      unresolved: readback.unresolved,
      brief: readback.brief,
    },
    empty_talk_hits: emptyTalkHits,
    verdict: {
      primary_clear: null,          // 人工填（2 人独立）
      transformation_complete: null, // 人工填
      blackboard_ok: null,          // 人工判（raw 数据已记录：writesValid + unresolved + brief）
      notes: writesValid ? '' : '声明块缺失或格式不合法（VERDICT §7：读回判 fail，不重试）',
    },
  }
  fs.writeFileSync(path.join(RUNS_DIR, `${traceId}.json`), JSON.stringify(trace, null, 2), 'utf8')

  const emptyCount = emptyTalkHits.filter(h => h.judged === 'empty').length
  console.log(
    `[${traceId}] 输出 ${output.length} 字 | 声明块 ${writesValid ? `合法(${writes.length}条)` : '非法/缺失'} | ` +
    `读回 ${readback.found ? `unresolved=${readback.unresolved.length}` : '未找到'} | 空话初筛 ${emptyCount} 次`
  )
  summary.push({ traceId, task: task.id, variant, writesValid, readbackFound: readback.found, emptyCount })
  }
}

console.log('\n=== V0 试跑摘要 ===')
for (const s of summary) console.log(JSON.stringify(s))
console.log(`\n[runs] ${RUNS_DIR}`)
