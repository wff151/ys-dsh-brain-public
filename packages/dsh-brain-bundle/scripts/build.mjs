// Bundles the two in-repo Cordis function-plugins into self-contained ESM files
// that cordis.patch.yml references by relative path. Every @deepseek-ai/* import
// and zod stay external so they resolve to the single physical copy provided by
// the running dsh host (critical: cordis must remain a singleton).
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))

// esbuild accepts glob strings (not functions) for `external`. Everything
// @deepseek-ai/* and zod resolve at runtime to the host's single physical copy.
const external = ['zod', '@deepseek-ai/*']

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'es2024',
  external,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'info',
}

await build({
  ...common,
  entryPoints: {
    memory: here('../../dsh-memory/src/index.ts'),
    conduct: here('../../dsh-conduct/src/index.ts'),
    dispatch: here('../../dsh-brain-dispatch/src/index.ts'),
    // Stage 7: memory-gated confinement wrapper (src/gate.ts inlines the main
    // confinement plugin; memory.mjs / conduct.mjs / dispatch.mjs above stay
    // untouched). The gate activates only once the memory facility exists and
    // mounts the guard under a child fiber — "memory 启用才挂，禁用即撤".
    gate: here('../../dsh-brain-confinement/src/gate.ts'),
  },
  outdir: fileURLToPath(new URL('../dist', import.meta.url)),
  outExtension: { '.js': '.mjs' },
})

console.log('dsh-brain-bundle: dist/memory.mjs + dist/conduct.mjs + dist/dispatch.mjs + dist/gate.mjs built')
