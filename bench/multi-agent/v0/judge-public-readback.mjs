// judge-public-readback.mjs — 通用 public 读回验证（naive / naive+ 的 remember 写入）
// 用法：node --import tsx/esm judge-public-readback.mjs <variant> <T1> [T2 ...]
// 对指定变体的 remember trace：独立 store 重放 → listAllPublicMemories 按 issues 内容匹配 → 写回 verdict.blackboard_ok
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { openStore, closeStore, applyMemoryWrites } from '../../../packages/dsh-memory/tests/v0-bridge.mjs'

const RUNS = '../../../bench/multi-agent/v0/runs'
const [variant, ...taskNums] = process.argv.slice(2)
if (!variant || taskNums.length === 0) { console.error('usage: node judge-public-readback.mjs <variant> <T1> [T2 ...]'); process.exit(1) }

function readPublicContains(store, issues) {
  const all = store.listAllPublicMemories()
  if (!issues || issues.length === 0) return { found: false, unresolved: [] }
  const hit = all.find(m => { const un = m.unresolved ?? []; return issues.every(i => un.includes(i)) })
  return { found: !!hit, unresolved: hit ? [...hit.unresolved] : [] }
}

const results = []
for (const tn of taskNums) {
  const id = `v0-${variant}-${tn}`
  const fp = path.join(RUNS, `${id}.json`)
  if (!fs.existsSync(fp)) { console.log(`${id}: 不存在，跳过`); continue }
  const t = JSON.parse(fs.readFileSync(fp, 'utf8'))
  const writes = t.blackboard_writes ?? []
  const rememberWrite = writes.find(w => w.tool === 'remember')
  if (!rememberWrite) { console.log(`${id}: 无 remember 写入，跳过`); continue }
  const issues = rememberWrite.params?.issues ?? []
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v0-pub-'))
  try {
    const { store } = await openStore(dataDir)
    await applyMemoryWrites(store, t.trace_id, writes)
    const rb = readPublicContains(store, issues)
    t.verdict.blackboard_ok = rb.found
    t.verdict.notes = (t.verdict.notes ? t.verdict.notes + '; ' : '') +
      `${variant}-remember public读回(${rb.found ? '命中' : '未命中'}, issues=${rb.unresolved.length})`
    fs.writeFileSync(fp, JSON.stringify(t, null, 2), 'utf8')
    results.push({ id, found: rb.found, issues: issues.length, readUnresolved: rb.unresolved.length })
    await closeStore({ store })
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }) }
}
console.log(JSON.stringify(results, null, 2))
const ok = results.filter(r => r.found).length
console.log(`public 读回: ${ok}/${results.length}`)
