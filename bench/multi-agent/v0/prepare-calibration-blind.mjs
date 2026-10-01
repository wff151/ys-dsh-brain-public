// prepare-calibration-blind.mjs — 全盲一致性材料（第二轮，无标签）
// 从标注者 B 未看过的 24 条中另选 8 条，只含 trace_id + input + output，无任何案例说明/判定倾向
import fs from 'node:fs'
import path from 'node:path'

const RUNS = '../../../bench/multi-agent/v0/runs'
const OUT = '../../../bench/multi-agent/v0/calibration'
// B 已看：a-T2/T7、b-T5/T8、naive-T2/T3、naiveplus-T5/T7 → 另选 8 条
const SELECT = ['v0-a-T1', 'v0-a-T6', 'v0-b-T1', 'v0-b-T7', 'v0-naive-T4', 'v0-naive-T8', 'v0-naiveplus-T1', 'v0-naiveplus-T3']

fs.mkdirSync(OUT, { recursive: true })
let md = `# V0 判定一致性检验材料（第二轮，全盲）

日期：2026-09-30。用途：第一轮为半盲（材料带案例标签，污染判定倾向，κ 虚高）——本轮**无标签**，从 B 未看过的 trace 另选 8 条。
**请仅依据 input/output 独立标注三列：primary_clear（Y/N）、contradiction（Y/N）、空话（empty/concrete）。**

## 判据（与 V0 相同，供回顾）

1. **primary_clear（格式级）**：明确写出"主要矛盾 = X"且给证据？
2. **contradiction_identified（语义级）**：显式冲突/取舍结构（X vs Y、权衡、冲突、取舍、约束、两难、"不是X而是Y"、"A但B"转折张力）？
3. **空话**：无具体内容的套话？（empty/concrete）

## 标注表

| # | trace_id | primary_clear | contradiction | 空话 |
|---|---|---|---|---|
| 1 | v0-a-T1 | __ | __ | __ |
| 2 | v0-a-T6 | __ | __ | __ |
| 3 | v0-b-T1 | __ | __ | __ |
| 4 | v0-b-T7 | __ | __ | __ |
| 5 | v0-naive-T4 | __ | __ | __ |
| 6 | v0-naive-T8 | __ | __ | __ |
| 7 | v0-naiveplus-T1 | __ | __ | __ |
| 8 | v0-naiveplus-T3 | __ | __ | __ |

## 材料原文

`
for (const id of SELECT) {
  const t = JSON.parse(fs.readFileSync(path.join(RUNS, `${id}.json`), 'utf8'))
  md += `
### ${id}

**input**：
\`\`\`
${t.input}
\`\`\`

**output**：
\`\`\`
${t.output}
\`\`\`

---
`
}
fs.writeFileSync(path.join(OUT, 'calibration-material-blind.md'), md, 'utf8')
console.log(`written ${SELECT.length} traces -> ${OUT}/calibration-material-blind.md`)
