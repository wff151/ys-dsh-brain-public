// summarize.mjs — 读 runs/*.json 输出判题汇总表（V0 判题辅助）
// 用法：node ../../../bench/multi-agent/v0/summarize.mjs
import fs from 'node:fs'
import path from 'node:path'

const RUNS = '../../../bench/multi-agent/v0/runs'
const files = fs.readdirSync(RUNS).filter(f => f.endsWith('.json')).sort()
if (files.length === 0) { console.log('no traces'); process.exit(0) }

const traces = files.map(f => JSON.parse(fs.readFileSync(path.join(RUNS, f), 'utf8')))
const byVariant = { a: [], b: [] }
for (const t of traces) byVariant[t.prompt_version]?.push(t)

const summary = { a: {}, b: {} }
for (const v of ['a', 'b']) {
  const ts = byVariant[v] ?? []
  const writesValid = ts.filter(t => t.blackboard_writes !== null).length
  const readbackFound = ts.filter(t => t.resume_readback.found).length
  const emptyTraces = ts.filter(t => t.empty_talk_hits.some(h => h.judged === 'empty')).length
  const failed = ts.filter(t => t.output === undefined || t.verdict?.notes?.includes('LLM')).length
  summary[v] = {
    total: ts.length,
    writesValid,
    readbackFound,
    emptyTalkTraces: emptyTraces,
    emptyRate: ts.length ? (emptyTraces / ts.length * 100).toFixed(1) + '%' : 'n/a',
    failed,
  }
}

console.log('=== V0 汇总 ===')
for (const v of ['a', 'b']) {
  console.log(`\n[variant ${v}] ${JSON.stringify(summary[v])}`)
}

console.log('\n=== 逐条 ===')
for (const t of traces) {
  const w = t.blackboard_writes
  const rb = t.resume_readback
  const empty = t.empty_talk_hits.filter(h => h.judged === 'empty')
  console.log(
    `${t.trace_id} | ${t.category} | out=${t.output?.length ?? 'FAIL'} | ` +
    `writes=${w ? w.length : 0}(${w ? w.map(x => x.tool).join(',') : '-'}) | ` +
    `read=${rb.found ? rb.unresolved.length : 0} | 空话=${empty.length}`
  )
  if (empty.length) {
    for (const h of empty) console.log(`    empty: "${h.word}" ctx="${h.context.slice(0, 60)}..."`)
  }
  if (t.verdict?.notes) console.log(`    note: ${t.verdict.notes}`)
}

console.log(`\ntraces: ${traces.length} (a=${byVariant.a.length}, b=${byVariant.b.length})`)
