import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Pins `.github/scripts/drift_compare.py`, which decides whether production's
 * migration history has drifted from the repo.
 *
 * Why this test exists: the drift check went red on 2026-08-13 and STAYED red
 * for twelve days, because the leagues schema is deliberately held back. A
 * permanently red alarm cannot alarm — so holds became declarable. The danger in
 * that fix is obvious: a hold that swallows everything is worse than no check.
 * These cases pin that it does not. Case "a new migration is not covered by an
 * existing hold" is the load-bearing one.
 *
 * Mirrors the R608 precedent (`ci-stack-lane-trigger.test.ts`): CI logic that
 * nothing exercises is CI logic that silently stops working.
 */

const SCRIPT = join(process.cwd(), '.github/scripts/drift_compare.py')

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'drift-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

/**
 * Returns the exit code AND the output. Both matter: exit 1 has FOUR distinct
 * causes (unapplied / stray / stale / rot), so asserting only the code cannot
 * tell which fired. A probe proved that gap real — making holds open-ended, the
 * very mistake these cases defend against, left the load-bearing case green
 * because a different cause tripped the same exit code.
 */
function run(local: string[], remote: string[], holds: string): { code: number; out: string } {
  const l = join(dir, 'local.txt')
  const r = join(dir, 'remote.txt')
  const h = join(dir, 'holds.txt')
  writeFileSync(l, local.join('\n') + '\n')
  writeFileSync(r, remote.join('\n') + '\n')
  writeFileSync(h, holds)
  try {
    return { code: 0, out: execFileSync('python3', [SCRIPT, l, r, h], { encoding: 'utf8' }) }
  } catch (e) {
    const err = e as { status?: number; stdout?: string }
    return { code: err.status ?? -1, out: err.stdout ?? '' }
  }
}

/** Assert the run failed FOR THE STATED REASON, not merely that it failed. */
function expectFailure(r: { code: number; out: string }, because: RegExp) {
  expect(r.code).toBe(1)
  expect(r.out).toMatch(because)
}

const REPO = ['001', '002', '003', '082', '083', '084']
const PROD = ['001', '002', '003']
const HELD = '082-084\n'

describe('production drift check — declared holds', () => {
  it('passes when every unapplied migration is declared held', () => {
    expect(run(REPO, PROD, HELD).code).toBe(0)
  })

  it('FAILS when a new migration is not covered by an existing hold', () => {
    // The load-bearing case. Holds are closed ranges precisely so that 085 —
    // the next task's migration — falls outside 082-084 and still alarms.
    expectFailure(run([...REPO, '085'], PROD, HELD), /NOT declared held:[\s\S]*085/)
  })

  it('FAILS on a stray, which a hold must never suppress', () => {
    // Production carrying a version the repo does not have is the hand-applied
    // direction that cost 36 migrations on 2026-08-05.
    expectFailure(run(REPO, [...PROD, '999'], HELD), /NOT in the repo[\s\S]*999/)
  })

  it('FAILS on a stray even when a hold explicitly names it', () => {
    // R654. The case above chose a stray OUTSIDE the hold set, so it could not
    // detect a hold that suppresses strays: the mutant
    // `stray = remote - local - holds` passed the whole file. Naming 999 in the
    // hold file is the only fixture that puts the suppression on trial — and it
    // must red twice, since a hold on something absent from the repo is also rot.
    const r = run(REPO, [...PROD, '999'], '082-084\n999\n')
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/NOT in the repo[\s\S]*999/)
    expect(r.out).toMatch(/names nothing:[\s\S]*999/)
  })

  it('cannot express an open-ended hold at all', () => {
    // R655. Rule 1 of HELD-FROM-PRODUCTION.txt is "ranges are CLOSED; there is
    // no 082+". The load-bearing case pins that a closed range MISSES 085 — it
    // does not pin that the syntax cannot express "and everything after". A
    // mutant teaching the parser `\d{3}\+` passed all eight cases.
    expectFailure(run(REPO, PROD, '082+\n'), /Malformed[\s\S]*not NNN/)
    expectFailure(run(REPO, PROD, '082-\n'), /Malformed/)
  })

  it('FAILS when a held migration has since been applied (the hold is stale)', () => {
    expectFailure(run(REPO, [...PROD, '083'], HELD), /hold is stale:[\s\S]*083/)
  })

  it('FAILS when a hold names a migration the repo no longer has (rot)', () => {
    expectFailure(run(REPO, PROD, '082-084\n300\n'), /names nothing:[\s\S]*300/)
  })

  it('FAILS on a malformed or descending range rather than ignoring the line', () => {
    expectFailure(run(REPO, PROD, '084-082\n'), /Malformed[\s\S]*descends/)
    expectFailure(run(REPO, PROD, 'everything\n'), /Malformed[\s\S]*not NNN/)
  })

  it('still reports the drift when nothing is declared held', () => {
    // Without holds this is exactly the red that ran for twelve days.
    expectFailure(run(REPO, PROD, ''), /NOT declared held:[\s\S]*082/)
  })

  it('still announces success once the holds are gone — the end state', () => {
    // R656. The success line was nested inside the has-holds branch, so the
    // intended end state (leagues pushed, file emptied) printed the counts and
    // then nothing at all. A green run that says nothing is indistinguishable
    // from a run that did nothing — CLAUDE.md's rule, in this file's own code.
    const r = run(['001', '002'], ['001', '002'], '')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/In sync/)
  })

  it('reports non-contiguous holds as separate runs, not one span', () => {
    // R657. min-max rendered {082,083,084,090} as "082-090" — a range that
    // contradicts its own count.
    const r = run(['001', '082', '083', '084', '090'], ['001'], '082-084\n090\n')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/082-084, 090/)
    expect(r.out).not.toMatch(/082-090/)
  })

  it('ignores comments and blank lines', () => {
    expect(run(REPO, PROD, '# leagues, awaiting the cohort\n\n082-084\n').code).toBe(0)
  })
})

describe('the drift workflow watches the files it depends on', () => {
  // R652. This PR cited R608 as its precedent and then reproduced it: the push
  // trigger watched only supabase/migrations/**, so the intended hold-expiry
  // edit ("we pushed 082-104, delete the holds") would touch the declaration
  // file and dispatch nothing until the next daily schedule. A filter that has
  // stopped matching the job's inputs is the R608 defect exactly.
  const yml = readFileSync('.github/workflows/db-drift.yml', 'utf8')

  it.each([
    ['the migrations it compares', 'supabase/migrations/**'],
    ['the hold declarations it honours', 'supabase/HELD-FROM-PRODUCTION.txt'],
    ['the comparator it runs', '.github/scripts/drift_compare.py'],
    ['its own definition', '.github/workflows/db-drift.yml'],
  ])('re-runs when %s changes', (_what, path) => {
    expect(yml).toContain(`- '${path}'`)
  })

  it('invokes the comparator with local, remote and holds in that order', () => {
    // A swapped argument order fails closed (23 spurious "stray" lines) rather
    // than passing, but it should not be reachable by a silent edit either.
    expect(yml).toMatch(
      /drift_compare\.py[\s\\]+\/tmp\/local\.txt[\s]+\/tmp\/remote\.txt[\s]+supabase\/HELD-FROM-PRODUCTION\.txt/,
    )
  })
})
