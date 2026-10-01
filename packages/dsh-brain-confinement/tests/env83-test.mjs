// Runtime probe for Windows 8.3 short-name aliasing. The containment lexical
// check cannot see an 8.3 spelling, so the identity fallback matters ONLY on
// volumes that actually generate short names. Many recent Windows installs
// disable 8.3 on non-system volumes; when a volume does not mint short names we
// report INCONCLUSIVE_ENV for it instead of pretending the case ran.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ok, skip } from './_harness.mjs'
import { isPathUnder } from '../src/containment.ts'

const volumes = (process.env.CONF_83_VOLUMES || 'E:,C:').split(',').map(s => s.trim()).filter(Boolean)
const LONG_NAME = 'VeryLongFileNameForShortNameCheck1234567890.txt'

function shortPath(p) {
  const ps = `(New-Object -ComObject Scripting.FileSystemObject).GetFile('${p.replace(/'/g, "''")}').ShortPath`
  return execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim()
}

for (const vol of volumes) {
  const probeDir = join(`${vol}\\`, `y83probe-${process.pid}-${Math.abs(vol.charCodeAt(0))}`)
  if (!existsSync(`${vol}\\`)) { skip(`8.3: volume ${vol} absent`); continue }
  try {
    mkdirSync(join(probeDir, 'storages'), { recursive: true })
    const longFile = join(probeDir, 'storages', LONG_NAME)
    writeFileSync(longFile, 'x', 'utf8')

    let sp
    try { sp = shortPath(longFile) } catch (e) { skip(`8.3: cannot query short path on ${vol} (${e?.message || e})`); continue }

    const minted = sp.replace(/\//g, '\\').toLowerCase() !== longFile.toLowerCase()
    if (!minted) {
      skip(`8.3: volume ${vol} does NOT generate short names (ShortPath == long) -> identity path INCONCLUSIVE_ENV here`)
      continue
    }

    // Volume mints 8.3: the short spelling is lexically unrelated yet the same
    // file identity; isPathUnder must still recognize it under the long root.
    ok(`8.3[${vol}] short name differs from long name`, /~\d/.test(sp))
    const root = join(probeDir, 'storages')
    const under = await isPathUnder(sp, root, false)
    ok(`8.3[${vol}] 8.3 alias of a protected file is recognized (identity)`, under === true)

    const outsideLong = join(probeDir, LONG_NAME)
    writeFileSync(outsideLong, 'x', 'utf8')
    const outsideShort = shortPath(outsideLong)
    const notUnder = await isPathUnder(outsideShort, root, false)
    ok(`8.3[${vol}] sibling 8.3 alias outside storages is not confined`, notUnder === false)
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }
}
