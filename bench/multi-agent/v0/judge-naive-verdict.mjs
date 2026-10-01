// judge-naive-verdict.mjs — naive 组 verdict 写回（标注者 A）
// 判据（VERDICT.md 同一套）：
//   primary_clear: 明确写出"主要矛盾 = X"且给证据 —— naive 0/8 写 → false
//   transformation_complete: 信号+阈值+动作三件套（判据仅适用于矛盾框架输出）—— naive 非矛盾框架 → false，notes 注明替代形态
//   blackboard_ok: 写了 unresolved 的 trace 中读回成功 —— note 4 条 resume 读回 ✓（run.mjs 已录 found=true）
//                                                    —— remember 4 条 public 读回 ✓（judge-naive-public.mjs 已重放验证）
import fs from 'node:fs'
import path from 'node:path'

const RUNS = '../../../bench/multi-agent/v0/runs'
const reviewer = '标注者A=主代理(2026-09-30); 标注者B=待用户复核'
const NAIVE_NOTE = 'naive无辩证引导：0/8写"主要矛盾"（显式化=0%）；分析为决策式/方案式形态；黑板写入8/8可读回（note走resume、remember走public）'

const ids = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'].map(t => `v0-naive-${t}`)
for (const id of ids) {
  const fp = path.join(RUNS, `${id}.json`)
  const t = JSON.parse(fs.readFileSync(fp, 'utf8'))
  t.verdict.primary_clear = false
  t.verdict.transformation_complete = false
  t.verdict.blackboard_ok = true // note4 resume已真读回 + remember4 public重放已命中
  t.verdict.reviewer = reviewer
  t.verdict.notes = NAIVE_NOTE
  fs.writeFileSync(fp, JSON.stringify(t, null, 2), 'utf8')
}
console.log('naive 8 traces verdict updated')

// 三组汇总
const groups = { a: 0, b: 0, naive: 0 }
const sum = { a: { n: 0, pc: 0, tc: 0, bo: 0, empty: 0 }, b: { n: 0, pc: 0, tc: 0, bo: 0, empty: 0 }, naive: { n: 0, pc: 0, tc: 0, bo: 0, empty: 0 } }
for (const f of fs.readdirSync(RUNS).filter(f => /^v0-(a|b|naive)-T\d+\.json$/.test(f))) {
  const t = JSON.parse(fs.readFileSync(path.join(RUNS, f), 'utf8'))
  const v = sum[t.prompt_version]
  v.n++
  if (t.verdict.primary_clear) v.pc++
  if (t.verdict.transformation_complete) v.tc++
  if (t.verdict.blackboard_ok) v.bo++
  if ((t.empty_talk_hits ?? []).some(h => h.judged === 'empty')) v.empty++
}
console.log('\n=== 三组最终判定 ===')
for (const k of ['a', 'b', 'naive']) {
  const s = sum[k]
  console.log(`[${k}] n=${s.n} 矛盾显式化=${s.pc}/${s.n}(${(s.pc / s.n * 100).toFixed(0)}%) 三件套=${s.tc}/${s.n} 黑板读回=${s.bo}/${s.n} 空话=${s.empty}`)
}
