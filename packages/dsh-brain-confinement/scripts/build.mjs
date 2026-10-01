// Bundles the confinement function-plugin into one self-contained ESM file that
// cordis.patch.yml references by relative path. Every @deepseek-ai/* import and
// zod stay external so they resolve to the single physical copy provided by the
// running dsh host (critical: cordis must remain a singleton).
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))

const external = ['zod', '@deepseek-ai/*']

await build({
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'es2024',
  external,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'info',
  entryPoints: { confinement: here('../src/index.ts') },
  outdir: fileURLToPath(new URL('../dist', import.meta.url)),
  outExtension: { '.js': '.mjs' },
})

console.log('dsh-brain-confinement: dist/confinement.mjs built')
