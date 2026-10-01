// judge-naive-public.mjs — naive 组 remember 路径的 public 读回验证（重放）
// 背景：readResume 只读 portable；naive-T1/T2/T4/T5 用 remember 写 public，
//       readback found=false 是"通道未覆盖 public 路径"，不是模型失败。
// 本脚本：对 4 条 remember trace，各用全新独立 store 重放 applyMemoryWrites，
//        再以 listAllPublicMemories 按 issues 内容匹配读回 → 判定 blackboard_ok。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { openStore, closeStore, applyMemoryWrites } from '../../../packages/dsh-memory/tests/v0-bridge.mjs'

const RUNS = '../../../bench/multi-agent/v0/runs'
const REMEMBER_TRACES = ['v0-naive-T1', 'v0-naive-T2', 'v0-naive-T4', 'v0-naive-T5']

/** public 表内容级读回：找到一条 unresolved 完整包含本 trace issues 的记录 */
function readPublicContains(store, issues) {
  const all = store.listAllPublicMemories()
  if (!issues || issues.length === 0) return { found: false, unresolved: [] }
  const hit = all.find(m => {
    const un = m.unresolved ?? []
    return issues.every(i => un.includes(i))
  })
  return { found: !!hit, unresolved: hit ? [...hit.unresolved] : [] }
}

const results = []
for (const id of REMEMBER_TRACES) {
  const fp = path.join(RUNS, `${id}.json`)
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
      `naive-remember public读回(${rb.found ? '命中' : '未命中'}, issues=${rb.unresolved.length})`
    fs.writeFileSync(fp, JSON.stringify(t, null, 2), 'utf8')
    results.push({ id, found: rb.found, issues: issues.length, readUnresolved: rb.unresolved.length })
    await closeStore({ store })
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

console.log(JSON.stringify(results, null, 2))
const ok = results.filter(r => r.found).length
console.log(`public 读回: ${ok}/${results.length}`)
