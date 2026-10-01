// Zero-model tests for dshHome precedence and the fail-closed snapshot fallback.
import { resolve } from 'node:path'
import { eq, ok } from './_harness.mjs'
import { ProtectedRootResolver, resolveDshHome, makeProtectedRoots } from '../src/paths.ts'

const H = 'E:\\fake-home'
const stor = (p) => resolve(p, 'storages')

// --- resolveDshHome precedence: configured > $DSH_HOME > ~/.dsh ---
eq('R1 configured wins over env',
  resolveDshHome('E:\\cfg-home', { DSH_HOME: 'E:\\env-home' }, H), 'E:\\cfg-home')

eq('R2 env used when configured absent',
  resolveDshHome(undefined, { DSH_HOME: 'E:\\env-home' }, H), 'E:\\env-home')

eq('R3 blank env falls back to ~/.dsh',
  resolveDshHome(undefined, { DSH_HOME: '   ' }, H), resolve(H, '.dsh'))

eq('R4 nothing set falls back to ~/.dsh',
  resolveDshHome(undefined, {}, H), resolve(H, '.dsh'))

eq('R5 ~ expansion',
  resolveDshHome('~/proj', {}, H), resolve(H, 'proj'))

// --- root shape ---
const roots = makeProtectedRoots('E:\\h')
eq('R6 two protected roots', roots.length, 2)
ok('R6 storages + sessions', roots.includes(stor('E:\\h')) && roots.includes(resolve('E:\\h', 'sessions')))

// --- resolver: live in normal operation ---
const r = new ProtectedRootResolver('E:\\cfg', { DSH_HOME: 'E:\\env' }, H)
eq('R7 live resolution source', r.current().source, 'live')
eq('R7 live dshHome', r.current().dshHome, 'E:\\cfg')
ok('R7 snapshot matches configured home', r.snapshotResolution.roots.includes(stor('E:\\cfg')))

// --- fail-closed: a runtime env that throws must fall back to the snapshot ---
const envHolder = {}
Object.defineProperty(envHolder, 'DSH_HOME', { configurable: true, get: () => 'E:\\live-home' })
const fr = new ProtectedRootResolver(undefined, envHolder, H)
const snap = fr.snapshotResolution
eq('R8 snapshot built from initial env', snap.roots[0], stor('E:\\live-home'))

Object.defineProperty(envHolder, 'DSH_HOME', { configurable: true, get: () => { throw new Error('env unavailable') } })
const cur = fr.current()
eq('R9 failure reports snapshot source', cur.source, 'snapshot')
eq('R9 failure keeps prior roots (never opens up)', cur.roots[0], snap.roots[0])
ok('R9 snapshot still non-empty', Array.isArray(cur.roots) && cur.roots.length === 2)
