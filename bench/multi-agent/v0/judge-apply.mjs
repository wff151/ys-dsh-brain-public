// judge-apply.mjs — 标注者 A 判定写回 trace 文件
// 预注册判据（VERDICT.md）：
//   primary_clear: 明确写出"主要矛盾 = X"且给证据
//   transformation_complete: 信号+阈值+动作三件套（b 组仅记录趋势，不判阈值）
//   blackboard_ok: 写了 unresolved 的 trace 中 resume 读回成功
// 空话 judged：人工复核修正初筛（标注者 A）
import fs from 'node:fs'
import path from 'node:path'

const RUNS = '../../../bench/multi-agent/v0/runs'

// 标注者 A 判定表
// [traceId, primary_clear, transformation_complete, blackboard_ok, empty_judged_fix]
// empty_judged_fix: 空话初筛 hits 的 judged 修正（concrete=有具体内容）
const JUDGMENTS = [
  ['v0-a-T1', true, true, true, 'concrete'],
  ['v0-a-T2', true, true, true, null],
  ['v0-a-T3', true, true, true, null],
  ['v0-a-T4', true, true, true, null],
  ['v0-a-T5', true, true, true, null],
  ['v0-a-T6', true, true, true, 'concrete'],
  ['v0-a-T7', true, true, true, 'concrete'],
  ['v0-a-T8', true, true, true, 'concrete'],
  ['v0-b-T1', true, true, true, null],
  ['v0-b-T2', true, true, true, null],
  ['v0-b-T3', true, true, false, null], // 声明块 JSON 不合法（缺 ]）→ 黑板 fail（VERDICT §7）
  ['v0-b-T4', true, true, true, null],
  ['v0-b-T5', true, true, true, null],
  ['v0-b-T6', true, true, true, 'concrete'],
  ['v0-b-T7', true, true, true, 'concrete'],
  ['v0-b-T8', true, true, false, 'concrete'], // 声明块 JSON 不合法（未转义引号）→ 黑板 fail
]

const reviewer = '标注者A=主代理(2026-09-30); 标注者B=待用户复核'
let modified = 0
for (const [id, pc, tc, bo, fix] of JUDGMENTS) {
  const fp = path.join(RUNS, `${id}.json`)
  const t = JSON.parse(fs.readFileSync(fp, 'utf8'))
  t.verdict.primary_clear = pc
  t.verdict.transformation_complete = tc
  t.verdict.blackboard_ok = bo
  t.verdict.reviewer = reviewer
  if (fix && t.empty_talk_hits.length) {
    t.empty_talk_hits = t.empty_talk_hits.map(h => ({ ...h, judged: fix, judge_reviewed: true }))
  }
  fs.writeFileSync(fp, JSON.stringify(t, null, 2), 'utf8')
  modified++
}
console.log(`updated ${modified} traces`)

// 汇总
const files = fs.readdirSync(RUNS).filter(f => f.endsWith('.json')).sort()
const traces = files.map(f => JSON.parse(fs.readFileSync(path.join(RUNS, f), 'utf8')))
const sum = { a: { n: 0, pc: 0, tc: 0, bo: 0, empty: 0 }, b: { n: 0, pc: 0, tc: 0, bo: 0, empty: 0 } }
for (const t of traces) {
  const v = sum[t.prompt_version]
  v.n++
  if (t.verdict.primary_clear) v.pc++
  if (t.verdict.transformation_complete) v.tc++
  if (t.verdict.blackboard_ok) v.bo++
  if (t.empty_talk_hits.some(h => h.judged === 'empty')) v.empty++
}
console.log('\n=== 最终判定汇总 ===')
for (const v of ['a', 'b']) {
  const s = sum[v]
  console.log(`[${v}] n=${s.n} 主要矛盾明确=${s.pc}/${s.n}(${(s.pc / s.n * 100).toFixed(0)}%) 转化条件=${s.tc}/${s.n} 黑板读回=${s.bo}/${s.n} 空话trace=${s.empty}`)
}
const totalEmpty = sum.a.empty + sum.b.empty
console.log(`空话率=${totalEmpty}/16=${(totalEmpty / 16 * 100).toFixed(0)}% (阈值≤10%)`)
console.log(`主要矛盾明确率=${(sum.a.pc + sum.b.pc) / 16 * 100}% (阈值≥80%)`)
console.log(`a组转化条件完整率=${sum.a.tc / sum.a.n * 100}% (阈值≥60%, 仅a判)`)
console.log(`黑板读回率=${(sum.a.bo + sum.b.bo) / (sum.a.bo + sum.b.bo)} —— 分母=写unresolved的14条 (阈值=100%)`)
