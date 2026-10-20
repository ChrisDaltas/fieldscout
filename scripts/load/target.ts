/**
 * Where a load run points, resolved on the Node side (M7 L.F2.1; spec §22.6
 * v2.16.100; PROGRESS D571 — TD2; breakdown §4 rules (c) and (i)).
 *
 *   --target local   the local stack (127.0.0.1:54321, the CLI's public demo
 *                    keys) — for exercising the harness at smoke size only;
 *   --target test    the hosted TEST project, read from `.env.load.local`
 *                    (gitignored by `.env*.local`; it lives only on Chris's
 *                    machine): FS_LOAD_URL, FS_LOAD_ANON_KEY,
 *                    FS_LOAD_SERVICE_KEY.
 * There is no default and no fallback to `.env.local` — that file targets
 * production (the reconcile CLI's own header records the hazard).
 *
 * THE PRODUCTION NAMES (`deny`) are read at run time and never printed:
 *   1. `supabase/.temp/project-ref` — the repo is `supabase link`ed to
 *      PRODUCTION (never to the test project, rule (i)); looked up in this
 *      checkout and in the main checkout a worktree belongs to;
 *   2. the host of `.env.local`'s NEXT_PUBLIC_SUPABASE_URL when it is hosted;
 *   3. FS_LOAD_DENY (comma list), if the operator adds more.
 * `assertSafeTarget` (load/k6/config.ts) refuses a test target that names
 * any of them, and refuses ANY test target when none could be read.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { assertSafeTarget, type TargetKind } from '../../load/k6/config'

/** The Supabase CLI's PUBLIC demo keys for the local stack (the same
 *  literals `scripts/dev-seed-inseason-league.ts` carries) — not secrets. */
const LOCAL_URL = 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

export interface ResolvedTarget {
  kind: TargetKind
  url: string
  anonKey: string
  serviceKey: string
  /** Production names, for handing to k6 (FS_LOAD_DENY). Never log this. */
  deny: string[]
}

/** Parse `KEY=value` lines (no interpolation; quotes stripped). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    out[key] = value
  }
  return out
}

function readIf(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

/** This checkout's root and, for a worktree, the main checkout's root. */
export function checkoutRoots(cwd: string = process.cwd()): string[] {
  const roots = [cwd]
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const main = dirname(common)
    if (!roots.includes(main)) roots.push(main)
  } catch {
    // not a git checkout — this checkout only
  }
  return roots
}

function hostOf(url: string): string | null {
  const m = /^[a-z]+:\/\/([^/:?#]+)/i.exec(url.trim())
  return m ? m[1]!.toLowerCase() : null
}

/** Every production name readable from this machine (see the header). */
export function productionNames(roots: readonly string[], extra: string | undefined): string[] {
  const names = new Set<string>()
  for (const root of roots) {
    const ref = readIf(resolve(root, 'supabase/.temp/project-ref'))?.trim()
    if (ref) names.add(ref.toLowerCase())
    const envLocal = readIf(resolve(root, '.env.local'))
    if (envLocal) {
      const url = parseEnvFile(envLocal).NEXT_PUBLIC_SUPABASE_URL
      const host = url ? hostOf(url) : null
      if (host && host !== '127.0.0.1' && host !== 'localhost') names.add(host)
    }
  }
  for (const name of (extra ?? '').split(',')) if (name.trim()) names.add(name.trim().toLowerCase())
  return [...names]
}

export function resolveTarget(kind: string | undefined, cwd: string = process.cwd()): ResolvedTarget {
  if (kind !== 'local' && kind !== 'test') {
    throw new Error("--target is required: 'local' (the local stack, smoke only) or 'test' (the hosted test project)")
  }
  const roots = checkoutRoots(cwd)
  const deny = productionNames(roots, process.env.FS_LOAD_DENY)
  if (kind === 'local') {
    const url = assertSafeTarget({ kind, url: process.env.FS_LOAD_LOCAL_URL ?? LOCAL_URL, deny })
    return { kind, url, anonKey: LOCAL_ANON_KEY, serviceKey: LOCAL_SERVICE_KEY, deny }
  }
  const file = readIf(resolve(cwd, '.env.load.local'))
  const fromFile = file ? parseEnvFile(file) : {}
  const pick = (k: string): string => {
    const v = process.env[k] ?? fromFile[k]
    if (!v) throw new Error(`${k} is not set (put the TEST project's values in .env.load.local — gitignored; never .env.local)`)
    return v
  }
  const url = assertSafeTarget({ kind, url: pick('FS_LOAD_URL'), deny })
  return { kind, url, anonKey: pick('FS_LOAD_ANON_KEY'), serviceKey: pick('FS_LOAD_SERVICE_KEY'), deny }
}
