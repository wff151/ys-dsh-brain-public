// judge-semantic.mjs — 四组语义级矛盾识别初筛（模式 + 片段，供人工复核）
// 语义级判据（V1 TASKS-DESIGN 预注册）：输出中出现冲突/对立/取舍结构
// （X vs Y、权衡、冲突、取舍、平衡、约束、两难、制约、主要问题、核心问题、核心冲突）
// 说明：只做初筛与证据提取；最终 judged 由标注者人工复核（V0 铁律）。
import fs from 'node:fs'
import path from 'node:path'

const RUNS = '../../../bench/multi-agent/v0/runs'
const PATTERNS = /权衡|冲突|取舍|平衡|两难|制约|矛盾|tradeoff|主要问题|核心问题|核心冲突|关键约束|主要约束|约束|vs|与[^，。]{1,20}之间|而不是/
// 注意："矛盾"一词 a/b 必现（辩证引导强制），对 a/b 无区分信息；保留仅用于 naive/naive+ 观测。

const groups = ['a', 'b', 'naive', 'naiveplus']
const out = {}
for (const g of groups) {
  out[g] = []
  for (let i = 1; i <= 8; i++) {
    const id = `v0-${g}-T${i}`
    const fp = path.join(RUNS, `${id}.json`)
    if (!fs.existsSync(fp)) { out[g].push({ id, missing: true }); continue }
    const t = JSON.parse(fs.readFileSync(fp, 'utf8'))
    const text = t.output ?? ''
    const hits = []
    for (const m of text.matchAll(new RegExp(PATTERNS, 'g'))) {
      const s = Math.max(0, m.index - 25), e = Math.min(text.length, m.index + m[0].length + 35)
      hits.push(text.slice(s, e).replace(/\s+/g, ' '))
    }
    out[g].push({ id, len: text.length, hits: hits.slice(0, 3) })
  }
}

for (const g of groups) {
  console.log(`\n===== [${g}] =====`)
  for (const r of out[g]) {
    console.log(`${r.id} (len=${r.len})${r.missing ? ' MISSING' : ''}`)
    for (const h of r.hits ?? []) console.log(`   ~ ${h}`)
    if (!r.hits || r.hits.length === 0) console.log('   <无模式命中>')
  }
}
