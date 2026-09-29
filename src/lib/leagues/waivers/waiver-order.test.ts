/**
 * L.D2.18 (F484, migration 163): the display twin of "does this league keep
 * a waiver order" is ONE rule with the SQL — parsed from the NEWEST
 * migration defining each function (the D30(2) parse-the-artifact pattern,
 * as league-settings.test.ts does for the tiebreaker default), so a later
 * definer that changes the rule on one side fails here.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { waiverOrderBasis, waiverOrderPersists } from './waiver-order'

function newestDefiner(fn: string): string {
  const dir = join(process.cwd(), 'supabase/migrations')
  const re = new RegExp(`CREATE (OR REPLACE )?FUNCTION (public\\.)?${fn}\\(`)
  const newest = readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort()
    .filter((f) => re.test(readFileSync(join(dir, f), 'utf8')))
    .pop()
  expect(newest, `some migration must define ${fn}`).toBeDefined()
  return readFileSync(join(dir, newest as string), 'utf8')
}

describe('waiverOrderPersists ≡ the SQL rule', () => {
  it('the processor (newest process_waivers_internal) states the rule this twin mirrors', () => {
    const sql = newestDefiner('process_waivers_internal')
    expect(sql).toContain("v_type := COALESCE(v_league.waiver_type, 'faab');")
    expect(sql).toMatch(/v_tb := COALESCE\(v_league\.settings ->> 'faab_tiebreaker', 'rolling_priority'\);/)
    expect(sql).toContain("v_persists := v_type = 'rolling_priority' OR (v_type = 'faab' AND v_tb = 'rolling_priority');")
  })
  it('the draft-end seed (newest waiver_priority_seed_internal) stores an order under the same rule', () => {
    const sql = newestDefiner('waiver_priority_seed_internal')
    expect(sql).toContain("v_type := COALESCE(v_league.waiver_type, 'faab');")
    expect(sql).toContain("v_tb := COALESCE(v_league.settings ->> 'faab_tiebreaker', 'rolling_priority');")
    expect(sql).toContain("IF NOT (v_type = 'rolling_priority' OR (v_type = 'faab' AND v_tb = 'rolling_priority')) THEN")
  })
  it('the truth table (stored literals)', () => {
    const table = (['faab', 'rolling_priority', 'reverse_standings', 'none_fcfs', null] as const).flatMap((t) =>
      (['rolling_priority', 'reverse_standings', null] as const).map(
        (tb) => `${t ?? '-'}/${tb ?? '-'}=${waiverOrderPersists(t, tb) ? 'P' : '.'}${waiverOrderBasis(t, tb)[0]}`,
      ),
    )
    expect(table.join(' ')).toBe(
      'faab/rolling_priority=Pr faab/reverse_standings=.r faab/-=Pr ' +
        'rolling_priority/rolling_priority=Pr rolling_priority/reverse_standings=Pr rolling_priority/-=Pr ' +
        'reverse_standings/rolling_priority=.r reverse_standings/reverse_standings=.r reverse_standings/-=.r ' +
        'none_fcfs/rolling_priority=.n none_fcfs/reverse_standings=.n none_fcfs/-=.n ' +
        '-/rolling_priority=Pr -/reverse_standings=.r -/-=Pr',
    )
  })
})
