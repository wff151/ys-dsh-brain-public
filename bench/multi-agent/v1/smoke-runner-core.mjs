// smoke-runner-core.mjs — runner-core 冒烟测试（临时）
import { foldWrites, buildConversation, buildStageSession, parseMemoryWrites } from './runner-core.mjs'

// 折叠（统一语义）：阶段1 issues=[A],result=s1；阶段2 issues=[B,C] → issues 并集 [A,B,C]，result 取最后 s2
const folded = foldWrites([
  { stage: 1, formatOk: true, writes: [{ tool: 'note', params: { issues: ['A'], result: 's1' } }] },
  { stage: 2, formatOk: true, writes: [{ tool: 'note', params: { issues: ['B', 'C'], result: 's2' } }] },
  { stage: 3, formatOk: false, writes: [] },
])
console.log('folded:', JSON.stringify(folded))
// 预期：issues=['A','B','C']（并集累积），result='s2'（字符串取最后）

// 跨 session 模式：阶段 2 上下文只含 prevSummary + 任务文本（不含阶段 1 assistant 输出）
const sess = buildStageSession({ input: 'S2 任务文本' }, '阶段 1 摘要（只含目标/结果，不含 issues）')
console.log('stage session:', JSON.stringify(sess))

// 对话历史：sys + u1/a1 + u2/a2
const msgs = buildConversation([{ input: 'q1', output: 'a1' }, { input: 'q2', output: 'a2' }], 'sys')
console.log('roles:', msgs.map(x => x.role).join(','))

// 声明块解析：合法 / 缺失 / 非法
const ok = parseMemoryWrites('text\n```json\n{"memory_writes":[{"tool":"note","params":{"issues":["Z"]}}]}\n```')
console.log('parse ok:', JSON.stringify(ok))
const none = parseMemoryWrites('no block here')
console.log('parse none:', JSON.stringify(none))
const bad = parseMemoryWrites('```json\n{not valid json\n```')
console.log('parse bad:', JSON.stringify(bad))
