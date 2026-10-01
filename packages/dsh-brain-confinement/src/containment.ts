/**
 * VENDORED path-containment predicate, synced verbatim (logic) from stock dsh:
 *   @deepseek-ai/dsh-fs-sandbox/src/containment.ts
 *   tag dsh-v0.1.6-alpha.2 (branch dsh-0.1.6-plugins)
 *
 * Why a copy instead of an import: the package's public entry does not re-export
 * `isPathUnder`, and the only other surface is the `./src/*` source subpath,
 * which is not included in published tarballs (`files: lib/...`). Importing it
 * would (a) couple this add-only plugin to a non-stable source path and
 * (b) drag the fs-sandbox plugin class and its cordis/fs-local peers into a
 * pure decision function. The function depends only on node built-ins, so it is
 * vendored to keep the decision layer self-contained and zero-model testable.
 *
 * Drift guard: tests/parity-test.mjs imports the ORIGINAL implementation from
 * the local dsh source tree and asserts identical answers over a shared
 * path matrix. Run it after every dsh upgrade; if upstream changed, re-sync this
 * file. Do not "improve" the logic here without also updating the parity test.
 *
 * Canonical spellings take the fast lexical path; filesystem identity supplies
 * the conservative fallback for alias-equivalent roots such as Windows 8.3
 * names, junctions/symlinks and casing.
 * @module confinement
 */

import type { BigIntStats } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, sep } from 'node:path'

const MISSING_CODES: ReadonlySet<NodeJS.ErrnoException['code']> = new Set(['ENOENT', 'ENOTDIR'])

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return MISSING_CODES.has(code)
}

function comparablePath(path: string, caseSensitive: boolean): string {
  return caseSensitive ? path : path.toLowerCase()
}

function isLexicallyUnder(path: string, root: string, caseSensitive: boolean): boolean {
  const comparableTarget = comparablePath(path, caseSensitive)
  const comparableRoot = comparablePath(root, caseSensitive)
  if (comparableTarget === comparableRoot) return true
  const prefix = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep
  return comparableTarget.startsWith(prefix)
}

async function statIfPresent(path: string): Promise<BigIntStats | undefined> {
  try {
    return await stat(path, { bigint: true })
  } catch (error: unknown) {
    if (isMissing(error)) return undefined
    throw error
  }
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

/**
 * Determine whether a canonical target is a root or lies beneath it. The
 * lexical fast path handles normal canonical spellings; when spellings differ,
 * walk the target's existing ancestors and compare filesystem identity with the
 * root, recognizing long-name/8.3 aliases, junctions and casing without
 * weakening containment to a textual approximation. A missing target suffix is
 * fine: the first EXISTING ancestor still settles identity.
 * @param path - canonical target key, which may end in a missing suffix.
 * @param root - canonical protected root.
 * @param caseSensitive - whether lexical comparison preserves case; defaults to
 *   the host filesystem convention used by supported platforms.
 * @returns whether the target is the root or a descendant of it.
 */
export async function isPathUnder(
  path: string,
  root: string,
  caseSensitive = process.platform !== 'win32',
): Promise<boolean> {
  if (isLexicallyUnder(path, root, caseSensitive)) return true

  const rootInfo = await statIfPresent(root)
  if (!rootInfo) return false

  let ancestor = path
  while (true) {
    const ancestorInfo = await statIfPresent(ancestor)
    if (ancestorInfo && sameIdentity(ancestorInfo, rootInfo)) return true
    const parent = dirname(ancestor)
    if (parent === ancestor) return false
    ancestor = parent
  }
}
