// prepare-calibration.mjs — 抽取 V0 一致性检验材料（路 A）
// 选 8 条 trace 覆盖：四组各 1-2 条 + 边界案例（naive-T3 隐含识别、b-T8 格式 fail）
// 材料只含 input + output（不含 verdict/reviewer），供标注者 B（用户）独立标注
import fs from 'node:fs'
import path from 'node:path'

const RUNS = '../../../bench/multi-agent/v0/runs'
const OUT = '../../../bench/multi-agent/v0/calibration'
const SELECT = ['v0-a-T2', 'v0-a-T7', 'v0-b-T5', 'v0-b-T8', 'v0-naive-T2', 'v0-naive-T3', 'v0-naiveplus-T5', 'v0-naiveplus-T7']
const WHY = {
  'v0-a-T2': 'a组常规（显式矛盾+三件套）',
  'v0-a-T7': 'a组截断重跑条（max_tokens=16384）',
  'v0-b-T5': 'b组常规',
  'v0-b-T8': 'b组声明块格式fail（边界：primary可判、blackboard fail）',
  'v0-naive-T2': 'naive显式语义识别（"主要约束"）',
  'v0-naive-T3': 'naive隐含识别边界（条件分支决策，无显式冲突词）',
  'v0-naiveplus-T5': 'naive+显式（"主要问题不是X而是Y"）',
  'v0-naiveplus-T7': 'naive+显式（约束缺失识别）',
}

fs.mkdirSync(OUT, { recursive: true })
let md = `# V0 判定一致性检验材料（标注者 B 独立标注）

日期：2026-09-30。用途：V0 单标注收尾——标注者 B（用户）独立重标 8 条，与标注者 A 比对一致率。
**请在不看标注者 A 判定（RESULTS.md / trace verdict 字段）的情况下完成下表。**

## 判据（与 V0 相同）

1. **primary_clear（格式级）**：输出是否明确写出"主要矛盾 = X"且给证据？（Y/N）
2. **contradiction_identified（语义级）**：输出是否出现显式冲突/取舍结构（X vs Y、权衡、冲突、取舍、约束、两难、"不是X而是Y"）？（Y/N）
3. **空话（judged）**：输出是否有无具体内容的套话（辩证词但无变量/阈值/信号/路径/工具名）？（empty/concrete）

## 标注表

| # | trace | 案例说明 | input | output | primary_clear | contradiction | 空话 |
|---|---|---|---|---|---|---|---|
`

for (const id of SELECT) {
  const t = JSON.parse(fs.readFileSync(path.join(RUNS, `${id}.json`), 'utf8'))
  md += `| ${id} | ${WHY[id]} | 见下 | 见下 | __ | __ | __ |\n`
}
md += `
## 材料原文
`
for (const id of SELECT) {
  const t = JSON.parse(fs.readFileSync(path.join(RUNS, `${id}.json`), 'utf8'))
  md += `
### ${id}（${WHY[id]}）

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
fs.writeFileSync(path.join(OUT, 'calibration-material.md'), md, 'utf8')
console.log(`written ${SELECT.length} traces -> ${OUT}/calibration-material.md`)
