// runner-core.mjs — V1 多轮 runner 骨架（任务无关部分）
// 两块已实现：① 对话历史维护 ② stages[] 解析 + 分阶段 memory_writes 写入 + 折叠函数
// 任务相关部分（injected_change 注入格式）留接口，等任务集冻结后填。
import { openStore, closeStore, applyMemoryWrites } from '../../../packages/dsh-memory/tests/v0-bridge.mjs'

// ── ① 对话历史维护 ──────────────────────────────────────────────
// 同 session 模式（保留，V0 兼容）：阶段 n 输入 = 阶段 n-1 输出 + 新 user 消息
export function buildConversation(stages, systemPrompt) {
  const messages = [{ role: 'system', content: systemPrompt }]
  for (const st of stages) {
    messages.push({ role: 'user', content: st.input })
    if (st.output) messages.push({ role: 'assistant', content: st.output })
  }
  return messages
}

// ── ①b 跨 session 模式（V1 默认，A 通道）────────────────────────
// 每阶段独立 session；阶段 n 上下文只含 prevSummary（出题者预写，只含目标/结果，不含 issues/矛盾清单）
// 矛盾清单唯一获取途径 = 黑板（resume/search）——这是格式层价值检验点的前提
export function buildStageSession(stage, prevSummary) {
  const content = prevSummary ? `${prevSummary}\n\n${stage.input}` : stage.input
  return [{ role: 'user', content }]
}

// ── ② 声明块解析（兼容 V0 §7 协议）─────────────────────────────
// 从阶段输出末尾提取 memory_writes JSON 块（缺失/非法 → 该阶段 writes=[] + formatOk=false）
export function extractJsonBlock(text) {
  // 兼容 V0 extractJsonBlock：找 ```json ... ``` 或最后一个 {...} 块
  const fenced = text.match(/```json\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const brace = text.lastIndexOf('{')
  if (brace === -1) return null
  const cand = text.slice(brace)
  try { JSON.parse(cand); return cand } catch { return null }
}

export function parseMemoryWrites(stageOutput) {
  const block = extractJsonBlock(stageOutput)
  if (!block) return { writes: [], formatOk: false }
  try {
    const obj = JSON.parse(block)
    const writes = Array.isArray(obj.memory_writes) ? obj.memory_writes : []
    return { writes, formatOk: true }
  } catch {
    return { writes: [], formatOk: false }
  }
}

// ── ③ 分阶段写入 + 折叠函数 ────────────────────────────────────
// 折叠规则（TASKS-DESIGN v2 §七 统一语义，2026-09-30 用户复核修正）：
//   - 数组字段（issues/tags）= 跨阶段拼接累积（黑板事件流：矛盾清单累积）
//   - 字符串字段（goal/result）= 取最后阶段值（状态快照：覆盖）
//   - V0 单阶段不经折叠（直接单次写入），协议不受影响；V1 多阶段才折叠
export function foldWrites(stageWritesList) {
  // stageWritesList = [{ stage: 1, writes: [...], formatOk }, ...]
  const folded = { goal: undefined, issues: [], result: undefined, tags: [] }
  for (const sw of stageWritesList) {
    if (!sw.formatOk) continue
    for (const w of sw.writes) {
      if (!w || typeof w !== 'object') continue
      const params = w.params || {}
      if (params.goal !== undefined) folded.goal = params.goal          // 字符串：取最后
      if (params.result !== undefined) folded.result = params.result    // 字符串：取最后
      if (Array.isArray(params.issues)) folded.issues.push(...params.issues) // 数组：并集累积
      if (Array.isArray(params.tags)) folded.tags.push(...params.tags)       // 数组：并集累积
    }
  }
  return folded
}

export async function applyStageWrites(store, stageWritesList) {
  // 逐阶段写入真实 store（并集），返回每阶段写入结果 + 折叠后结果
  const results = []
  for (const sw of stageWritesList) {
    if (!sw.formatOk || sw.writes.length === 0) {
      results.push({ stage: sw.stage, applied: 0, formatOk: sw.formatOk })
      continue
    }
    const applied = await applyMemoryWrites(store, { memory_writes: sw.writes })
    results.push({ stage: sw.stage, applied, formatOk: sw.formatOk })
  }
  return { perStage: results, folded: foldWrites(stageWritesList) }
}

// ── ④ injected_change 接口（任务冻结后填）───────────────────────
// 当前仅定义 schema：阶段 2 的 user 消息 = prevSummary + 任务文本 + 变化注入
// TODO(任务冻结)：injected_change 的具体注入文本（与任务集、A/B 通道耦合，冻结后填）
export function buildStageInput(stage, injectedChange) {
  if (!injectedChange) return stage.input
  return stage.input // 骨架：注入格式待任务冻结
}

export { openStore, closeStore }
