// Zero-model wiring test for the Stage 7 memory gate (src/gate.ts).
//
// Asserts the cordis-level contract without any LLM or the full dsh-tools
// registry. The event bus is exercised directly: `ctx.waterfall('tools/execute',
// exec, next)` with no scope target (thisArg null -> no scope filter) fires
// every listener — exactly the around-dispatch surface the guard registers on.
//
// Contract under test:
//   - brainMemory missing  -> gate stays INACTIVE, no tools/execute hook
//     (protected read passes through).
//   - brainMemory provided -> gate activates, mounts confinement; protected
//     fs reads are denied, safe reads pass through.
//   - brainMemory removed  -> gate disposes, hook unmounted; protected reads
//     pass through again ("memory 禁用即撤").
import { Context } from '@deepseek-ai/cordis'
import * as gate from '../src/gate.ts'
import { makeSandbox, ok, eq } from './_harness.mjs'

const sandbox = makeSandbox()
const ctx = new Context()

const protectedRead = { name: 'read', arguments: { file_path: sandbox.brainFile } }
const safeRead = { name: 'read', arguments: { file_path: sandbox.normalFile } }
const SAFE = { content: [{ type: 'text', text: 'safe-result' }], isError: false }
const DENIED = 'Operation not permitted in this context.'

const emitExec = async (exec) =>
  ctx.waterfall('tools/execute', exec, async () => SAFE)

async function until(fn, timeoutMs = 3000) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) return null
    await new Promise((r) => setTimeout(r, 20))
  }
}

// Required services on the root context. 'tools' must exist for the gate's
// inject map; 'brainMemory' is the gate switch, armed/disarmed by disposers.
ctx.reflect.provide('tools', {})

// ---- 1. no memory: gate inactive, no hook --------------------------------
const gateFiber = ctx.plugin(gate, { dshHome: sandbox.home })
gateFiber.then(undefined, () => {}) // never-settling INACTIVE fiber: avoid unhandled rejection
const pre = await emitExec(protectedRead)
eq('G1 no-memory: protected read passes through (no hook)', pre.isError, false)

// ---- 2. provide memory: gate activates, confinement mounts ----------------
const disarmMemory = ctx.reflect.provide('brainMemory', {})
const denied = await until(async () => {
  const r = await emitExec(protectedRead)
  return r.isError && r.error?.message === DENIED ? r : null
})
ok('G2 memory-on: protected read denied', !!denied)

const safe = await emitExec(safeRead)
eq('G3 memory-on: safe read passes through', safe.isError, false)

// ---- 3. remove memory: gate disposes, hook unmounted ----------------------
disarmMemory()
const through = await until(async () => {
  const r = await emitExec(protectedRead)
  return r.isError === false ? r : null
})
ok('G4 memory-off: protected read passes through again (hook gone)', !!through)

await gateFiber // the fiber settles once memory is gone again
sandbox.cleanup()
