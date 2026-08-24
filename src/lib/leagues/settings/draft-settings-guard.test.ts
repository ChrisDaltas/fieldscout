import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { PICK_TIMER_SECONDS } from './league-settings'

/**
 * `draft_settings_range_guard` (migration 095, task MP.3) MIRRORS this
 * module's bounds in SQL, and this test is the thing that stops the two
 * drifting.
 *
 * Why the mirror exists at all: `create_mock_draft` is EXECUTE-able by
 * `authenticated`, so a client that skips the route reaches it directly. The
 * zod schema here is the catalog; the SQL guard is the server floor under it.
 * Both are needed, which means both can disagree — and a disagreement is
 * invisible until a user hits it.
 *
 * Why it is a SOURCE pin rather than a database round-trip: the claim is about
 * two files agreeing, so it is measured on the two files (tasks-DR §4 rule 9 —
 * measure at the layer you claim about). Same idiom as
 * `src/components/ui/elevation-rule.test.ts` and `src/lib/lists-v2-flag.test.ts`.
 *
 * Filed as R503 by the MP.3 reviewer: the `pick_timer_seconds` whitelist was
 * hand-copied out of `PICK_TIMER_SECONDS` with nothing tying them together.
 * The whitelist is the case that matters most — it is thirteen literals, and a
 * new offered clock added here would silently be refused by the server.
 */

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/095_standalone_mock.sql',
)

function guardBody(): string {
  const sql = readFileSync(MIGRATION, 'utf8')
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION draft_settings_range_guard(')
  expect(start, 'draft_settings_range_guard must exist in 095').toBeGreaterThan(-1)
  const end = sql.indexOf('$$;', start)
  expect(end, 'the guard body must terminate').toBeGreaterThan(start)
  return sql.slice(start, end)
}

describe('draft_settings_range_guard mirrors the TS catalog (R503)', () => {
  it('carries the PICK_TIMER_SECONDS whitelist exactly, in order', () => {
    const body = guardBody()
    const match = body.match(/pick_timer_seconds'\)::int;\s*IF v NOT IN \(([^)]*)\)/)
    expect(match, 'the pick_timer_seconds whitelist must be a literal IN list').not.toBeNull()
    const sqlList = match![1]
      .split(',')
      .map((n) => Number(n.trim()))
    expect(sqlList).toEqual([...PICK_TIMER_SECONDS])
  })

  // Each row is [knob, floor, ceiling] exactly as the zod schema / the
  // §7.3.8 validator states it. The SQL message carries the range, so the
  // message IS the assertion surface — which is deliberate: a bound whose
  // error text disagrees with the bound it enforces is its own bug.
  const NUMERIC_BOUNDS: ReadonlyArray<readonly [string, number, number]> = [
    ['auction_budget', 50, 1000],
    ['auction_nomination_seconds', 10, 120],
    ['auction_bid_seconds', 10, 60],
    ['auction_anti_snipe_seconds', 0, 15],
    ['disconnect_grace_seconds', 0, 120],
  ]

  it.each(NUMERIC_BOUNDS)('bounds %s at %i-%i, and says so', (knob, lo, hi) => {
    const body = guardBody()
    expect(body).toContain(`IF v < ${lo} OR v > ${hi} THEN`)
    expect(body).toContain(`draft settings: ${knob} % is outside ${lo}-${hi}`)
  })

  it('bounds the roster numbers that become total_rounds (R498)', () => {
    const body = guardBody()
    // bench 0-20 — rosterSettingsSchema.bench
    expect(body).toContain('roster settings: bench % is outside 0-20')
    // starting slot count 0-10 — startingSlotSchema.count, both ends checked
    // separately (a single max() lets a negative through)
    expect(body).toContain('roster settings: a starting slot count of % is outside 0-10')
    expect(body).toContain('IF v IS NOT NULL AND v < 0 THEN')
    expect(body).toContain('IF v IS NOT NULL AND v > 10 THEN')
    // starting-lineup sum 1-20 — validateLeagueSettings' §7.3.8 bullet
    expect(body).toContain('IF v_sum < 1 OR v_sum > 20 THEN')
    expect(body).toContain('it must total between 1 and 20')
  })

  it('checks the starting-lineup sum UNCONDITIONALLY, so omitting the key cannot evade it', () => {
    const body = guardBody()
    // The bench and per-knob checks are `IF p_roster ? '<key>'` guarded; the
    // sum deliberately is not, because draft_rounds_from_roster reads an
    // absent array as 0 and the guard has to agree with it.
    expect(body).not.toContain("IF p_roster ? 'starting_slots'")
    expect(body).toContain("COALESCE(p_roster->'starting_slots', '[]'::jsonb)")
  })

  it('takes the roster as a second argument — the R498 shape, not the first cut', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION draft_settings_range_guard(p_draft JSONB, p_roster JSONB)')
    // …and create_mock_draft actually passes both halves.
    expect(sql).toContain('PERFORM public.draft_settings_range_guard(v_config, v_roster);')
  })
})
