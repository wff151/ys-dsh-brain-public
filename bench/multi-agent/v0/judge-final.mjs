// judge-final.mjs — 32 条最终判定写回（标注者 A）
// 双判据：
//   primary_clear（格式级）：明确写出"主要矛盾 = X" + 证据
//   contradiction_identified（语义级）：输出中出现显式冲突/对立/取舍结构
//     （X vs Y、权衡、冲突、取舍、平衡、约束、两难、"不是X而是Y"句式等）
// 语义级人工复核结论（judge-semantic.mjs 初筛 + 标注者 A 复核全文）：
//   a/b: 8/8 显式；naive: T2/T5/T7/T8 显式、T1/T3/T4/T6 隐含(行为驱动但无显式冲突词)；
//   naive+: 8/8 显式（"主要问题不是X而是Y"句式）
import fs from 'node:fs'
import path from 'node:path'

const RUNS = '../../../bench/multi-agent/v0/runs'
const reviewer = '标注者A=主代理(2026-09-30); 标注者B=待用户复核'

const SEMANTIC = {
  'a': [1,1,1,1,1,1,1,1],
  'b': [1,1,1,1,1,1,1,1],
  'naive': [0,1,0,0,1,0,1,1],   // T1/T3/T4/T6 隐含非显式
  'naiveplus': [1,1,1,1,1,1,1,1],
}
const NAIVEPLUS_NOTE = 'naive+：仅加一句中性指令"请分析这个任务的主要问题是什么"→ 8/8语义级显式识别（"主要问题不是X而是Y"句式），未用"主要矛盾"字样（格式级primary_clear=false）；黑板写入8/8可读回（note4 resume + remember4 public）'

const stats = { a: { n:0, f:0, s:0 }, b: { n:0, f:0, s:0 }, naive: { n:0, f:0, s:0 }, naiveplus: { n:0, f:0, s:0 } }
for (const g of Object.keys(SEMANTIC)) {
  for (let i = 0; i < 8; i++) {
    const id = `v0-${g}-T${i + 1}`
    const fp = path.join(RUNS, `${id}.json`)
    const t = JSON.parse(fs.readFileSync(fp, 'utf8'))
    t.verdict.contradiction_identified = SEMANTIC[g][i] === 1
    if (g === 'naiveplus') {
      t.verdict.notes = NAIVEPLUS_NOTE
      t.verdict.reviewer = reviewer
    }
    fs.writeFileSync(fp, JSON.stringify(t, null, 2), 'utf8')
    stats[g].n++
    if (t.verdict.primary_clear) stats[g].f++
    if (t.verdict.contradiction_identified) stats[g].s++
  }
}

console.log('=== 32 条最终判定（标注者 A，单标注未校准） ===')
console.log('组     格式级primary_clear  语义级contradiction 黑板读回  空话')
for (const g of ['a', 'b', 'naive', 'naiveplus']) {
  const s = stats[g]
  // 黑板读回与空话从 trace 现算
  let bo = 0, empty = 0
  for (let i = 0; i < 8; i++) {
    const t = JSON.parse(fs.readFileSync(path.join(RUNS, `v0-${g}-T${i + 1}.json`), 'utf8'))
    if (t.verdict.blackboard_ok) bo++
    if ((t.empty_talk_hits ?? []).some(h => h.judged === 'empty')) empty++
  }
  console.log(`[${g}] ${s.f}/8 (${(s.f / 8 * 100).toFixed(0)}%)   ${s.s}/8 (${(s.s / 8 * 100).toFixed(0)}%)   ${bo}/8   ${empty}`)
}
