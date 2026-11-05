/**
 * gate-m7-wiring.test.ts — `scripts/gate-m7.sh` end to end with its test legs
 * STUBBED (M7 L.F2.12; PROGRESS D792). The real script runs in a scratch tree
 * with `npx` / `npm` shims first on PATH: every database leg is an echo, and
 * only the verdict is real. No database, no stack. What this pins is the wiring
 * no unit test reaches: a green run with an attachment gone exits 3 with the
 * right headline, an open S0 exits 4, a failed leg exits 1 even when the leg's
 * own code was 3, a hang or a non-local URL exits 2, and "PASSED" needs it all.
 * Each scratch tree is a real git checkout (the stage stamps name HEAD, R1761),
 * and the vitest shims print the real summary line (R1762).
 */
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { ATTACHMENTS } from './gate-m7-open-rows'

const REPO = resolve(__dirname, '..')
const TSX_CLI = join(dirname(createRequire(__filename).resolve('tsx/package.json')), 'dist/cli.mjs')

const NAMED_FILES = [
  'supabase/tests/156_function_grants_and_server_owned_columns.sql',
  'supabase/tests/157_list_players_list_id_and_start_sit_freeze.sql',
  'supabase/tests/159_rate_limits.sql',
  'supabase/tests/160_security_hardening_followups.sql',
  'supabase/tests/162_league_archive.sql',
  'supabase/tests/166_lost_scores.sql',
  'src/lib/rate-limit/rate-limits-db.test.ts',
  'src/lib/security/hardening-wire-db.test.ts',
  'src/middleware-rate-limit.test.ts',
  'src/lib/rate-limit/route-limits.test.ts',
  'src/lib/rate-limit/rate-limit-refusal.test.ts',
  'src/lib/rate-limit/latest-value-sender.test.ts',
  'src/lib/auth/cron-secret.test.ts',
  'src/lib/auth/profile-columns.test.ts',
  'src/lib/storage-bucket-limits.test.ts',
  'src/app/auth/callback/route.test.ts',
  'src/utils/safe-redirect-path.test.ts',
  'src/utils/local-supabase-url.test.ts',
  'src/lib/leagues/scoring/lost-scores-db.test.ts',
  'src/lib/leagues/chaos/realtime-kill-db.test.ts',
  'src/lib/leagues/chaos/provider-faults-db.test.ts',
  'src/lib/leagues/chaos/worker-crash-db.test.ts',
  'src/lib/leagues/chaos/waiver-run-failure-db.test.ts',
]

/** Logs each call, then answers per the STUB_* env the test sets. */
const NPX_SHIM = `#!/usr/bin/env bash
echo "npx $*" >> "$STUB_LOG"
case "$1 $2" in
  "supabase status")
    [ "\${STUB_CLI:-ok}" = "hang" ] && { sleep 30 >/dev/null 2>&1 & wait; }
    echo "API_URL=\\"\${STUB_API_URL:-http://127.0.0.1:54321}\\""
    ;;
  "supabase db")
    [ "\${STUB_RESET:-ok}" = "hang" ] && { sleep 30 >/dev/null 2>&1 & wait; }
    [ "\${STUB_RESET:-ok}" = "fail" ] && exit 1
    ;;
  "supabase test") echo "Files=\${STUB_PGTAP_FILES:-6}, Tests=9,  1 wallclock secs" ;;
  "vitest run")
    shift 2
    files=$#
    skipped=""
    # More than the pre-flight's two files is the M7 list at [4/7].
    if [ "$#" -gt 2 ]; then
      files="\${STUB_M7_FILES:-$files}"
      [ -n "\${STUB_M7_SKIPPED:-}" ] && skipped=" | 1 skipped"
    fi
    echo " Test Files  $files passed ($files)"
    echo "      Tests  9 passed$skipped (9)"
    exit "\${STUB_VITEST_CODE:-0}"
    ;;
  "tsx scripts/gate-settle.ts") ;;
  "tsx scripts/gate-m7-evidence.ts") shift; exec node "$TSX_CLI" "$@" ;;
  *) echo "unexpected npx call: $*" >&2; exit 99 ;;
esac
exit 0
`
const NPM_SHIM = `#!/usr/bin/env bash
echo "npm $*" >> "$STUB_LOG"
case "$2" in
  test:chaos)
    files="\${STUB_CHAOS_FILES:-7}"
    echo " Test Files  $files passed ($files)"
    if [ -n "\${STUB_CHAOS_SKIPPED:-}" ]; then echo "      Tests  8 passed | 1 skipped (9)"; else echo "      Tests  9 passed (9)"; fi
    exit "\${STUB_CHAOS_CODE:-0}"
    ;;
  test:gate:m6) exit "\${STUB_M6_CODE:-0}" ;;
  test:gate:m8) exit 0 ;;
  *) echo "unexpected npm call: $*" >&2; exit 99 ;;
esac
`

const LEDGER_PADDING = Array.from({ length: 600 }, (_, i) => `| F${i + 1} | x | y | z | ✅ Done |`).filter((r) => !r.startsWith('| F273 '))
/** F861 closed and F273 / F859 / F860 rated: what exit 0 needs from the ledger (R1759). */
const SETTLED = [
  '| F273 | x | y | z | ⬜ Open **[Severity S3 — fixture]** |',
  '| F859 | x | y | z | ⬜ Open **[Severity S3 — fixture]** |',
  '| F860 | x | y | z | ⬜ Open **[Severity S3 — fixture]** |',
  '| F861 | x | y | z | ✅ Done |',
]
function ledger(...rows: string[]): string {
  return ['## 6. Forward obligations ledger', ...LEDGER_PADDING, ...rows, '## Review findings'].join('\n')
}
function attachmentText(key: string): string {
  const ruling = key === 'C4' ? 'M7-GATE-RULING: C4 2026-12-01 Chris: "it counts"\n' : ''
  return `M7-GATE-ATTACHMENT: ${key} PASS\n${ruling}`
}

describe('gate-m7.sh, with its legs stubbed', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'gate-m7-wiring-'))
  afterAll(() => rmSync(scratch, { recursive: true, force: true }))
  let counter = 0

  function gate(opts: {
    rows?: string[]
    attachments?: boolean
    env?: Record<string, string>
    m8?: boolean
    without?: string
    settled?: string[]
    noGit?: boolean
  }) {
    const root = join(scratch, `run-${counter++}`)
    const put = (rel: string, text: string) => {
      const file = join(root, rel)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, text)
    }
    mkdirSync(join(root, 'scripts'), { recursive: true })
    for (const f of ['gate-m7.sh', 'gate-m7-evidence.ts', 'gate-m7-open-rows.ts']) {
      copyFileSync(join(REPO, 'scripts', f), join(root, 'scripts', f))
    }
    for (const f of NAMED_FILES) if (f !== opts.without) put(f, '')
    put('package.json', JSON.stringify({ scripts: opts.m8 ? { 'test:gate:m8': 'x' } : {} }))
    put('docs/specs/PROGRESS-leagues.md', ledger(...(opts.settled ?? SETTLED), ...(opts.rows ?? [])))
    if (opts.attachments) {
      for (const a of ATTACHMENTS) put(a.path, attachmentText(a.key))
    }
    const bin = join(root, '.bin')
    put('.bin/npx', NPX_SHIM)
    put('.bin/npm', NPM_SHIM)
    chmodSync(join(bin, 'npx'), 0o755)
    chmodSync(join(bin, 'npm'), 0o755)
    const log = join(root, 'stub.log')
    writeFileSync(log, '')
    let head = ''
    if (!opts.noGit) {
      const inRoot = (...args: string[]) =>
        spawnSync('git', ['-C', root, '-c', 'user.name=gate', '-c', 'user.email=gate@example.test', ...args], {
          encoding: 'utf8',
          env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NODE_ENV: 'test' },
        })
      inRoot('init', '-q')
      inRoot('commit', '-q', '--allow-empty', '-m', 'fixture')
      head = inRoot('rev-parse', 'HEAD').stdout.trim()
    }
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: process.env.HOME,
      STUB_LOG: log,
      TSX_CLI,
      ...opts.env,
    }
    const res = spawnSync('bash', [join(root, 'scripts/gate-m7.sh')], { encoding: 'utf8', env })
    const stamp = (stage: number) => {
      const file = join(root, '.gate-m7', `stage-${stage}.done`)
      return existsSync(file) ? readFileSync(file, 'utf8').trim() : null
    }
    return { code: res.status, out: `${res.stdout}\n${res.stderr}`, calls: () => readFileSync(log, 'utf8'), head, stamp }
  }

  it('all green, attachments gone: exit 3, the exact headline, every stage ran in order', () => {
    const run = gate({})
    expect(run.code).toBe(3)
    expect(run.out).toContain('AUTOMATED LEGS GREEN — M7 2026 GATE NOT PASSED')
    expect(run.out).not.toContain('GATE PASSED')
    expect(run.out).toContain('test:gate:m8: NOT RUN')
    expect(run.out).toContain(`Commit: ${run.head}`)
    for (const stage of [1, 2, 3, 4, 5, 6]) expect(run.stamp(stage), `stage ${stage}`).toBe(run.head)
    const calls = run.calls().split('\n').filter((l: string) => !l.includes('gate-m7-evidence') && !l.includes('supabase status'))
    expect(calls.map((l: string) => l.split(' ').slice(0, 4).join(' '))).toEqual([
      'npx vitest run scripts/gate-m7-open-rows.test.ts',
      'npx supabase db reset',
      'npx supabase test db',
      'npx tsx scripts/gate-settle.ts',
      `npx vitest run src/lib/rate-limit/rate-limits-db.test.ts`,
      'npm run test:chaos',
      'npx tsx scripts/gate-settle.ts',
      'npm run test:gate:m6',
      '',
    ])
  }, 60_000)

  it('an open S0: every stage still runs, then exit 4 naming it', () => {
    const run = gate({ rows: ['| F710 | **[S0 — REDACTED]** x | y | z | ⬜ Open — S0 |'], attachments: true })
    expect(run.code).toBe(4)
    expect(run.out).toContain('AUTOMATED LEGS GREEN — M7 2026 GATE NOT PASSED')
    expect(run.out).toContain('F710 [S0]')
    expect(run.calls()).toContain('npm run test:gate:m6')
  }, 60_000)

  it('everything in: exit 0 and PASSED — and M8 runs once the script exists', () => {
    const run = gate({ attachments: true, m8: true })
    expect(run.code).toBe(0)
    expect(run.out).toContain('M7 2026 GATE PASSED')
    expect(run.out).toContain('test:gate:m8: ran')
    expect(run.calls()).toContain('npm run test:gate:m8')
  }, 60_000)

  it.each([
    ['the chaos drills', { STUB_CHAOS_CODE: '1' }],
    ['the chaos drills, exiting 3', { STUB_CHAOS_CODE: '3' }],
    ['the M6 gate, exiting 4', { STUB_M6_CODE: '4' }],
    ['the M7 vitest', { STUB_VITEST_CODE: '1' }],
    ['a dropped file at [4/7], vitest exit 0', { STUB_M7_FILES: '12' }],
    ['a skipped test at [4/7], vitest exit 0', { STUB_M7_SKIPPED: '1' }],
    ['a dropped file at [5/7], chaos exit 0', { STUB_CHAOS_FILES: '6' }],
    ['a skipped drill at [5/7], chaos exit 0', { STUB_CHAOS_SKIPPED: '1' }],
    ['a failed reset', { STUB_RESET: 'fail' }],
    ['pgTAP that ran five files', { STUB_PGTAP_FILES: '5' }],
  ])('a failed leg (%s): exit 1, GATE FAILED, the green headline never printed', (_name, env) => {
    const run = gate({ attachments: true, env })
    expect(run.code).toBe(1)
    expect(run.out).toContain('M7 2026 GATE FAILED')
    expect(run.out).not.toContain('AUTOMATED LEGS GREEN')
    expect(run.out).not.toContain('GATE PASSED')
  }, 60_000)

  it('a failed stage leaves no stamp, and no later stage stamps either (R1761)', () => {
    const run = gate({ attachments: true, env: { STUB_CHAOS_FILES: '6' } })
    expect(run.code).toBe(1)
    expect(run.stamp(4)).toBe(run.head)
    expect(run.stamp(5)).toBeNull()
    expect(run.stamp(6)).toBeNull()
    expect(run.calls()).not.toContain('test:gate:m6')
    expect(run.calls()).not.toContain('verdict')
  }, 60_000)

  it('a gate re-run clears the last run\'s stamps first', () => {
    const script = readFileSync(join(REPO, 'scripts/gate-m7.sh'), 'utf8')
    expect(script.indexOf('rm -rf "$REPORT_DIR"')).toBeLessThan(script.indexOf('stage_done 1'))
  })

  it('every leg green but F861 open: exit 3 by name, never PASSED (R1759)', () => {
    const run = gate({ attachments: true, settled: SETTLED.map((r) => (r.startsWith('| F861') ? '| F861 | x | y | z | ⬜ Open |' : r)) })
    expect(run.code).toBe(3)
    expect(run.out).toContain('AUTOMATED LEGS GREEN — M7 2026 GATE NOT PASSED')
    expect(run.out).toContain('exit 0 held back: F861')
    expect(run.out).not.toContain('GATE PASSED')
  }, 60_000)

  it('F860 unrated: exit 3 by name (R1759)', () => {
    const run = gate({ attachments: true, settled: SETTLED.map((r) => (r.startsWith('| F860') ? '| F860 | x | y | z | ⬜ Open |' : r)) })
    expect(run.code).toBe(3)
    expect(run.out).toContain('exit 0 held back: F860')
  }, 60_000)

  it('the chaos count is the directory\'s, so a new or renamed file is seen', () => {
    const script = readFileSync(join(REPO, 'scripts/gate-m7.sh'), 'utf8')
    const pinned = Number(/^CHAOS_FILE_COUNT=(\d+)$/m.exec(script)?.[1])
    const onDisk = readdirSync(join(REPO, 'src/lib/leagues/chaos')).filter((f) => f.endsWith('.test.ts'))
    expect(onDisk).toHaveLength(pinned)
    expect(pinned).toBe(7)
  })

  it.each([
    ['a hosted URL in the environment', { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }],
    ['a hosted SUPABASE_LOCAL_URL', { SUPABASE_LOCAL_URL: 'https://example.supabase.co' }],
    ['a CLI naming another stack', { STUB_API_URL: 'https://example.supabase.co' }],
    ['a hung CLI', { STUB_CLI: 'hang', GATE_M7_CLI_BUDGET_S: '2' }],
    ['a hung reset', { STUB_RESET: 'hang', GATE_M7_RESET_BUDGET_S: '2' }],
  ])('not runnable (%s): exit 2, no green headline, the value never printed', (_name, env) => {
    const run = gate({ attachments: true, env })
    expect(run.code).toBe(2)
    expect(run.out).toContain('NOT RUNNABLE')
    expect(run.out).not.toContain('AUTOMATED LEGS GREEN')
    expect(run.out).not.toContain('GATE PASSED')
    expect(run.out).not.toContain('example.supabase.co')
  }, 60_000)

  it('not a git checkout: exit 2 before anything is reset', () => {
    const run = gate({ attachments: true, noGit: true })
    expect(run.code).toBe(2)
    expect(run.out).toContain('not a git checkout')
    expect(run.calls()).not.toContain('supabase db reset')
  }, 60_000)

  it('a hung reset warns that its child may still be changing the DB (R1768)', () => {
    const run = gate({ attachments: true, env: { STUB_RESET: 'hang', GATE_M7_RESET_BUDGET_S: '2' } })
    expect(run.code).toBe(2)
    expect(run.out).toContain('a child may still be changing the local DB')
  }, 60_000)

  it('a named file gone: exit 1 before anything is reset', () => {
    const run = gate({ attachments: true, without: 'src/lib/leagues/chaos/worker-crash-db.test.ts' })
    expect(run.code).toBe(1)
    expect(run.out).toContain('MISSING: src/lib/leagues/chaos/worker-crash-db.test.ts')
    expect(run.calls()).not.toContain('supabase db reset')
  }, 60_000)
})
