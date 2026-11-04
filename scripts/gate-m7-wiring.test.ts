/**
 * gate-m7-wiring.test.ts — `scripts/gate-m7.sh` end to end with its test legs
 * STUBBED (M7 L.F2.12; PROGRESS D792). The real script runs in a scratch tree
 * with `npx` / `npm` shims first on PATH: every database leg is an echo, and
 * only the verdict is real. No database, no stack. What this pins is the wiring
 * no unit test reaches: a green run with an attachment gone exits 3 with the
 * right headline, an open S0 exits 4, a failed leg exits 1 even when the leg's
 * own code was 3, a hang or a non-local URL exits 2, and "PASSED" needs it all.
 */
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  "supabase test") echo "Files=\${STUB_PGTAP_FILES:-5}, Tests=9,  1 wallclock secs" ;;
  "vitest run") exit "\${STUB_VITEST_CODE:-0}" ;;
  "tsx scripts/gate-settle.ts") ;;
  "tsx scripts/gate-m7-evidence.ts") shift; exec node "$TSX_CLI" "$@" ;;
  *) echo "unexpected npx call: $*" >&2; exit 99 ;;
esac
exit 0
`
const NPM_SHIM = `#!/usr/bin/env bash
echo "npm $*" >> "$STUB_LOG"
case "$2" in
  test:chaos) exit "\${STUB_CHAOS_CODE:-0}" ;;
  test:gate:m6) exit "\${STUB_M6_CODE:-0}" ;;
  test:gate:m8) exit 0 ;;
  *) echo "unexpected npm call: $*" >&2; exit 99 ;;
esac
`

const LEDGER_PADDING = Array.from({ length: 600 }, (_, i) => `| F${i + 1} | x | y | z | ✅ Done |`)
function ledger(...rows: string[]): string {
  return ['## 6. Forward obligations ledger', ...LEDGER_PADDING, ...rows, '## Review findings'].join('\n')
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
    put('docs/specs/PROGRESS-leagues.md', ledger(...(opts.rows ?? [])))
    if (opts.attachments) {
      for (const a of ATTACHMENTS) put(a.path, `M7-GATE-ATTACHMENT: ${a.key} PASS\n`)
    }
    const bin = join(root, '.bin')
    put('.bin/npx', NPX_SHIM)
    put('.bin/npm', NPM_SHIM)
    chmodSync(join(bin, 'npx'), 0o755)
    chmodSync(join(bin, 'npm'), 0o755)
    const log = join(root, 'stub.log')
    writeFileSync(log, '')
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: process.env.HOME,
      STUB_LOG: log,
      TSX_CLI,
      ...opts.env,
    }
    const res = spawnSync('bash', [join(root, 'scripts/gate-m7.sh')], { encoding: 'utf8', env })
    return { code: res.status, out: `${res.stdout}\n${res.stderr}`, calls: () => readFileSync(log, 'utf8') }
  }

  it('all green, attachments gone: exit 3, the exact headline, every stage ran in order', () => {
    const run = gate({})
    expect(run.code).toBe(3)
    expect(run.out).toContain('AUTOMATED LEGS GREEN — M7 2026 GATE NOT PASSED')
    expect(run.out).not.toContain('GATE PASSED')
    expect(run.out).toContain('test:gate:m8: NOT RUN')
    const calls = run.calls().split('\n').filter((l: string) => !l.includes('gate-m7-evidence') && !l.includes('supabase status'))
    expect(calls.map((l: string) => l.split(' ').slice(0, 4).join(' '))).toEqual([
      'npx vitest run scripts/gate-m7-open-rows.test.ts',
      'npx supabase db reset',
      'npx supabase test db',
      `npx vitest run src/lib/rate-limit/rate-limits-db.test.ts`,
      'npx tsx scripts/gate-settle.ts',
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
    ['a failed reset', { STUB_RESET: 'fail' }],
    ['pgTAP that ran four files', { STUB_PGTAP_FILES: '4' }],
  ])('a failed leg (%s): exit 1, GATE FAILED, the green headline never printed', (_name, env) => {
    const run = gate({ attachments: true, env })
    expect(run.code).toBe(1)
    expect(run.out).toContain('M7 2026 GATE FAILED')
    expect(run.out).not.toContain('AUTOMATED LEGS GREEN')
    expect(run.out).not.toContain('GATE PASSED')
  }, 60_000)

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

  it('a named file gone: exit 1 before anything is reset', () => {
    const run = gate({ attachments: true, without: 'src/lib/leagues/chaos/worker-crash-db.test.ts' })
    expect(run.code).toBe(1)
    expect(run.out).toContain('MISSING: src/lib/leagues/chaos/worker-crash-db.test.ts')
    expect(run.calls()).not.toContain('supabase db reset')
  }, 60_000)
})
