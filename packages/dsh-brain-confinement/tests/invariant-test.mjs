// Safety invariant: the ONLY code reached by a non-fs tool in the hook is
// `isFsTool(name)`. The promise "our bug can never break non-fs tools" depends
// entirely on this lookup never throwing for exotic/hostile inputs. Pin it.
import { ok } from './_harness.mjs'
import { isFsTool } from '../src/paths.ts'

const exotic = [
  undefined, null, true, false, 0, 123, NaN, -Infinity,
  '', 'READ', 'Read', 'pwsh', 'bash', 'brain', 'read ', ' read',
  {}, [], [1, 2], new Date(), /regex/,
  Symbol('x'), Symbol.for('y'),
  BigInt(1),
  function () {},
  () => {},
  new Proxy({}, { get() { throw new Error('must not call getter') } }),
  new Proxy(function () {}, { apply() { throw new Error('must not invoke') } }),
  Object.create(null),
  { toString() { throw new Error('must not stringify') } },
]

for (const [i, v] of exotic.entries()) {
  let r
  let threw = false
  try { r = isFsTool(v) } catch { threw = true }
  // Label uses typeof/index only — touching .constructor/.toString here would
  // itself trip the throwing Proxy and falsely look like a guard failure.
  ok(`isFsTool never throws [${i}] typeof=${typeof v}`, !threw)
  ok(`isFsTool returns boolean [${i}] typeof=${typeof v}`, typeof r === 'boolean')
}

// Correctness on the guarded names (exact, case-sensitive).
for (const n of ['read', 'read_image', 'write', 'edit', 'str_replace_editor', 'glob', 'grep']) {
  ok(`fs tool recognized: ${n}`, isFsTool(n) === true)
}
// Shell is NOT an fs tool at this stage; odd casings are not fs tools.
for (const n of ['pwsh', 'bash', 'brain', 'Read', 'READ', ' read', 'read ']) {
  ok(`non-fs / non-exact name passes through: ${JSON.stringify(n)}`, isFsTool(n) === false)
}
