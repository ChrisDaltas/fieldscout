/**
 * Where a load run points, resolved on the Node side (M7 L.F2.1; spec §22.6
 * v2.16.100; PROGRESS D571 — TD2; breakdown §4 rules (c) and (i)).
 *
 *   --target local   the local stack (127.0.0.1:54321, the CLI's public demo
 *                    keys) — for exercising the harness at smoke size only;
 *   --target test    the hosted TEST project, read from
 *                    `.env.test-project.local` — the file breakdown §12
 *                    C1 (b) tells Chris to create (gitignored by
 *                    `.env*.local`; it lives only on his machine). Keys: the
 *                    app's own names (NEXT_PUBLIC_SUPABASE_URL,
 *                    NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)
 *                    or FS_LOAD_URL / FS_LOAD_ANON_KEY / FS_LOAD_SERVICE_KEY;
 *                    the process environment overrides the file.
 * There is no default and no fallback to `.env.local` — that file targets
 * production (the reconcile CLI's own header records the hazard).
 *
 * THE PRODUCTION NAMES (`deny`) are read at run time and never printed:
 *   1. `supabase/.temp/project-ref` — the repo is `supabase link`ed to
 *      PRODUCTION (never to the test project, rule (i)); looked up in this
 *      checkout and in the main checkout a worktree belongs to;
 *   2. the host of `.env.local`'s NEXT_PUBLIC_SUPABASE_URL when it is hosted;
 *   3. FS_LOAD_DENY (comma list) — operator ADDITIONS only (R1641): they add
 *      refusals and never count toward the fail-closed check.
 * `assertSafeTarget` (load/k6/config.ts) refuses a test target that names
 * any of them, and refuses ANY test target when 1–2 yielded nothing. The URL
 * it returns is the normalized origin; every client gets that, never the raw
 * string (R1640). Paths resolve against the repo root, not the cwd (R1644).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { assertSafeTarget, derivedDenyNames, parseEnvText, type TargetKind } from '../../load/k6/config'
import { REPO_ROOT } from './paths'

/** The Supabase CLI's PUBLIC demo keys for the local stack (the same
 *  literals `scripts/dev-seed-inseason-league.ts` carries) — not secrets. */
const LOCAL_URL = 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

/** Breakdown §12 C1 (b): the test project's details, on Chris's machine only. */
export const TEST_PROJECT_ENV_FILE = '.env.test-project.local'

export interface ResolvedTarget {
  kind: TargetKind
  /** The guard's NORMALIZED origin — the only URL any client is handed. */
  url: string
  anonKey: string
  serviceKey: string
  /** Every production name (derived + operator additions), for handing to
   *  k6 as FS_LOAD_DENY — which k6 treats as ADDITIONS only. Never log this. */
  deny: string[]
  /** Checkout roots holding the `supabase link` file, for k6's own `open()`
   *  of it (FS_LOAD_REPO_ROOTS). */
  linkRoots: string[]
}

/** Parse `KEY=value` lines — the pure parser in load/k6/config.ts. */
export const parseEnvFile = parseEnvText

function readIf(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

/** This checkout's root and, for a worktree, the main checkout's root. */
export function checkoutRoots(cwd: string = REPO_ROOT): string[] {
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

export interface ProductionNames {
  /** From the checkouts' own files — the only names that satisfy fail-closed. */
  derived: string[]
  /** FS_LOAD_DENY — additions only (R1641). */
  extra: string[]
  /** Roots where a `supabase/.temp/project-ref` was found. */
  linkRoots: string[]
}

/** Every production name readable from this machine (see the header). */
export function productionNames(roots: readonly string[], extra: string | undefined): ProductionNames {
  const derived = new Set<string>()
  const linkRoots: string[] = []
  for (const root of roots) {
    const link = readIf(resolve(root, 'supabase/.temp/project-ref'))
    if (link?.trim()) linkRoots.push(root)
    for (const name of derivedDenyNames(link, readIf(resolve(root, '.env.local')))) derived.add(name)
  }
  const extras = (extra ?? '')
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n.length > 0)
  return { derived: [...derived], extra: extras, linkRoots }
}

export function resolveTarget(kind: string | undefined, cwd: string = REPO_ROOT): ResolvedTarget {
  if (kind !== 'local' && kind !== 'test') {
    throw new Error("--target is required: 'local' (the local stack, smoke only) or 'test' (the hosted test project)")
  }
  const roots = checkoutRoots(cwd)
  const names = productionNames(roots, process.env.FS_LOAD_DENY)
  const deny = [...new Set([...names.derived, ...names.extra])]
  const guard = { derivedDeny: names.derived, extraDeny: names.extra }
  if (kind === 'local') {
    const url = assertSafeTarget({ kind, url: process.env.FS_LOAD_LOCAL_URL ?? LOCAL_URL, ...guard })
    return { kind, url, anonKey: LOCAL_ANON_KEY, serviceKey: LOCAL_SERVICE_KEY, deny, linkRoots: names.linkRoots }
  }
  const file = readIf(resolve(cwd, TEST_PROJECT_ENV_FILE))
  const fromFile = file ? parseEnvFile(file) : {}
  const pick = (own: string, appName: string): string => {
    const v = process.env[own] ?? fromFile[own] ?? fromFile[appName]
    if (!v) {
      throw new Error(`${own} is not set (put the TEST project's ${appName} in ${TEST_PROJECT_ENV_FILE} — gitignored; never .env.local)`)
    }
    return v
  }
  const url = assertSafeTarget({ kind, url: pick('FS_LOAD_URL', 'NEXT_PUBLIC_SUPABASE_URL'), ...guard })
  return {
    kind,
    url,
    anonKey: pick('FS_LOAD_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    serviceKey: pick('FS_LOAD_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'),
    deny,
    linkRoots: names.linkRoots,
  }
}
