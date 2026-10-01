// judge-prep.mjs — 提取全部 trace 输出供人工判题（标注者 A）
import fs from 'node:fs'
import path from 'node:path'

const RUNS = '../../../bench/multi-agent/v0/runs'
const files = fs.readdirSync(RUNS).filter(f => f.endsWith('.json')).sort()
let out = []
for (const f of files) {
  const t = JSON.parse(fs.readFileSync(path.join(RUNS, f), 'utf8'))
  out.push(`\n${'='.repeat(70)}\n### ${t.trace_id} (${t.category})`)
  out.push(`INPUT: ${t.input}`)
  out.push(`OUTPUT:\n${t.output}`)
  const rb = t.resume_readback
  out.push(`READBACK: found=${rb.found} unresolved=${JSON.stringify(rb.unresolved)}`)
  const w = t.blackboard_writes
  out.push(`WRITES: ${w ? JSON.stringify(w) : 'null'}`)
}
fs.writeFileSync('../../../bench/multi-agent/v0/judge-material.txt', out.join('\n'), 'utf8')
console.log('written', files.length, 'traces to judge-material.txt')
