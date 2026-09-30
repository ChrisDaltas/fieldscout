/**
 * corrections-service.test.ts — the corrections read's PURE halves and its
 * error arms over a fake client (M6 L.E2.3; spec §23.4 / §15.3; PROGRESS
 * D453 / D454). `corrections-api-db.test.ts` drives the whole read over the
 * real stack with records the REAL door wrote; what lives here is the copy
 * (plain words, never a stat key), the result-change arithmetic, the cursor
 * string, and the deploy-before-push arm anchored on the table's NAME.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import {
  CORRECTIONS_BAD_CURSOR_MESSAGE,
  CORRECTIONS_UNAVAILABLE_MESSAGE,
  correctionResult,
  correctionsCursorFilter,
  correctionsEmptyNote,
  correctionsQuerySchema,
  correctionStatChanges,
  readStatCorrections,
  toCorrectionItem,
} from './corrections-service'

const LEAGUE = '00000000-0000-4000-8000-0000000000aa'

/** A stored row exactly as the door writes it (stack LC3's record, 172). */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    league_id: LEAGUE,
    season: 2087,
    week: 1,
    team_id: 'team-one',
    player_id: 'wr1',
    slot: 'wr:0',
    matchup_id: 'm1',
    event_ids: ['e1'],
    stat_changes: [{ event_id: 'e1', stat_key: 'receiving_yards', label: 'receiving yards', old: 100, new: 94 }] as Json,
    player_points_before: 10,
    player_points_after: 9.4,
    team_score_before: 10,
    team_score_after: 9.4,
    result_before: { h2h: 'win', second: 'win', median: 'win' } as Json,
    result_after: { h2h: 'loss', second: 'loss', median: 'loss' } as Json,
    result_changed: true,
    recorded_at: '2087-09-15T15:00:00.123456+00:00',
    player: { id: 'wr1', full_name: 'Lou Receiver', position: 'WR', team: 'LCA' },
    team: { id: 'team-one', name: 'Team One' },
    ...overrides,
  } as Parameters<typeof toCorrectionItem>[0]
}

describe('each correction in plain words (tasks-M6 §4 rule 10 — never a stat key)', () => {
  it('the stat by its words, old → new — the same words the door\'s post uses', () => {
    expect(correctionStatChanges([{ stat_key: 'receiving_yards', old: 100, new: 94 }, { stat_key: 'return_td', old: 2, new: null }] as Json)).toEqual([
      { stat_key: 'receiving_yards', stat: 'receiving yards', old: 100, new: 94, words: 'receiving yards 100 → 94' },
      { stat_key: 'return_td', stat: 'kick/punt return TD', old: 2, new: null, words: 'kick/punt return TD 2 → none' },
    ])
  })

  it('the summary is the league post\'s own sentence for the one record (stack LC3\'s post, verbatim prefix)', () => {
    const item = toCorrectionItem(row())
    expect(item.summary).toBe("Lou Receiver's receiving yards 100 → 94 — Team One 10.00 → 9.40")
    expect(item).toMatchObject({
      week: 1,
      player: { id: 'wr1', name: 'Lou Receiver', position: 'WR', nfl_team: 'LCA' },
      team: { id: 'team-one', name: 'Team One' },
      player_points: { before: 10, after: 9.4 },
      team_score: { before: 10, after: 9.4 },
    })
  })

  it('a pending team score reads "pending", never "null" or 0 (E61)', () => {
    expect(toCorrectionItem(row({ team_score_before: null })).summary).toBe("Lou Receiver's receiving yards 100 → 94 — Team One pending → 9.40")
  })

  it('the result change names only the games that moved — the matchup, the second game, the median game', () => {
    expect(correctionResult({ h2h: 'win', second: null, median: 'win' }, { h2h: 'loss', second: null, median: 'win' }, true)).toEqual({
      known: true,
      changed: true,
      changes: [{ game: 'matchup', before: 'win', after: 'loss', words: 'Matchup: win → loss' }],
    })
    expect(correctionResult({ h2h: 'win', second: 'win', median: 'win' }, { h2h: 'loss', second: 'loss', median: 'loss' }, true).changes.map((c) => c.words)).toEqual([
      'Matchup: win → loss',
      'Second game: win → loss',
      'Median game: win → loss',
    ])
    expect(correctionResult({ h2h: 'win', second: null, median: null }, { h2h: 'win', second: null, median: null }, false)).toEqual({ known: true, changed: false, changes: [] })
  })

  it('while the week\'s games were still being played there is no result yet (D453(4)) — known: false, nothing invented', () => {
    expect(correctionResult(null, null, false)).toEqual({ known: false, changed: false, changes: [] })
  })
})

describe('the query surface', () => {
  it('coerces the week and the limit a query string delivers, and refuses an unknown key by name', () => {
    expect(correctionsQuerySchema.parse({ week: '3', limit: '10' })).toMatchObject({ week: 3, limit: 10 })
    expect(correctionsQuerySchema.safeParse({ wek: '3' }).success).toBe(false)
    expect(correctionsQuerySchema.safeParse({ week: '0' }).success).toBe(false)
    expect(correctionsQuerySchema.safeParse({ limit: '101' }).success).toBe(false)
  })

  it('a week with none says so in words', () => {
    expect(correctionsEmptyNote(3)).toBe('No stat correction changed a score in this league in Week 3.')
    expect(correctionsEmptyNote(undefined)).toBe('No stat correction has changed a score in this league yet.')
  })

  it('the page boundary is the exact inverse of (recorded_at DESC, id DESC) — R770', () => {
    expect(correctionsCursorFilter('2087-09-15T15:00:00+00:00', 'abc')).toBe(
      'recorded_at.lt."2087-09-15T15:00:00+00:00",and(recorded_at.eq."2087-09-15T15:00:00+00:00",id.lt."abc")',
    )
  })
})

/** A fake client: membership passes, the league is live, the table read answers `tableError`. */
function fakeClient(tableError: { code: string; message: string } | null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    or: () => chain,
    maybeSingle: async () => ({ data: { id: LEAGUE }, error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: tableError ? null : [], error: tableError }),
  }
  return {
    rpc: async () => ({ data: true, error: null }),
    from: () => chain,
  } as unknown as SupabaseClient<Database>
}

describe('deploy before push (TD15): the table absent BY NAME is a named 503 — never a 500, never an empty list', () => {
  it('PGRST205 naming league_stat_corrections (PostgREST\'s GET answer, measured in the stack suite) ⇒ 503 with the sentence', async () => {
    const result = await readStatCorrections(
      fakeClient({ code: 'PGRST205', message: "Could not find the table 'public.league_stat_corrections' in the schema cache" }),
      LEAGUE,
      {},
    )
    expect(result).toStrictEqual({ status: 503, body: { error: CORRECTIONS_UNAVAILABLE_MESSAGE } })
  })

  it('Postgres\'s own 42P01 naming it ⇒ the same 503', async () => {
    const result = await readStatCorrections(fakeClient({ code: '42P01', message: 'relation "league_stat_corrections" does not exist' }), LEAGUE, {})
    expect(result.status).toBe(503)
  })

  it('a missing OTHER object is a loud 500 naming the read, not the quiet 503 (anchored on the name — R1222)', async () => {
    const result = await readStatCorrections(fakeClient({ code: 'PGRST205', message: "Could not find the table 'public.league_stat_correctionz' in the schema cache" }), LEAGUE, {})
    expect(result.status).toBe(500)
    expect(JSON.stringify(result.body)).toContain('league_stat_corrections: ')
  })

  it('an empty first page carries the note; a malformed cursor is a 400 by name before any read', async () => {
    const empty = await readStatCorrections(fakeClient(null), LEAGUE, { week: '4' })
    expect(empty).toMatchObject({ status: 200, body: { week: 4, items: [], has_more: false, next_cursor: null, note: 'No stat correction changed a score in this league in Week 4.' } })
    const bad = await readStatCorrections(fakeClient(null), LEAGUE, { cursor: 'not-a-cursor' })
    expect(bad).toStrictEqual({ status: 400, body: { error: { fieldErrors: { cursor: [CORRECTIONS_BAD_CURSOR_MESSAGE] } } } })
  })
})
