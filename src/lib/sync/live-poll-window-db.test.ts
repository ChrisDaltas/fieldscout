/**
 * live-poll-window-db.test.ts — migration 224's game window IS
 * `planLivePoll`'s HOT rule, row for row, over the REAL stack.
 *
 * 224 moved the decision "is a game on?" into the database: pg_cron wakes
 * `/api/cron/sync-live` every 30 s only while `public.live_game_window_open`
 * says so (Chris 2026-11-14: "how about every 30 seconds during games" —
 * "once the score is final the game is over"). The route still plans from
 * the same tables with `planLivePoll`. If the two ever disagree, either the
 * database wakes Vercel for nothing (the cost this change exists to end) or
 * — worse — it stays asleep while the route would have polled a live game.
 * So the two are run over the same rows and must agree on every case:
 * every status the column can hold (and an unknown one) × kickoffs either
 * side of the 15-minute lead to the second, plus mixed multi-game slates.
 *
 * Requires the local stack (001–224) — D59(5); FAILS loudly when the stack
 * is down, never skips. Fixture hygiene (F199): season 2093 only, deleted
 * before and after; the season is passed explicitly, so nothing else on the
 * stack can open or close a window here, and no `nfl_weeks` row is written
 * (the default season — the newest in `nfl_weeks` — is left alone).
 */
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { type CalendarGame, planLivePoll, POLL_LEAD_MS, STUCK_GAME_CAP_MS } from './live-poll'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const SEASON = 2093
const NOW = new Date('2093-10-04T17:00:00.000Z')

async function clear() {
  const { error } = await service.from('nfl_games').delete().eq('season', SEASON)
  if (error) throw new Error(`clear 2093 games: ${error.message}`)
}

/** Both answers for one slate: the route's plan and the database's window. */
async function bothAnswers(slate: Array<{ status: string | null; offsetMs: number }>) {
  await clear()
  const games: CalendarGame[] = slate.map((g) => ({
    season: SEASON,
    week: 5,
    kickoff_at: new Date(NOW.getTime() + g.offsetMs).toISOString(),
    status: g.status,
  }))
  if (games.length > 0) {
    const { error } = await service.from('nfl_games').insert(
      games.map((g, i) => ({ id: `q224-${i}`, season: g.season, week: g.week, home_team: 'AAA', away_team: 'BBB', kickoff_at: g.kickoff_at, status: g.status })),
    )
    if (error) throw new Error(`insert 2093 games: ${error.message}`)
  }
  const { data, error } = await service.rpc('live_game_window_open', { p_now: NOW.toISOString(), p_season: SEASON })
  if (error) throw new Error(`live_game_window_open: ${error.message}`)
  return { route: planLivePoll(games, [], NOW).mode === 'hot', database: data }
}

const STATUSES: Array<string | null> = ['scheduled', 'live', 'final', 'postponed', null, 'suspended']
const OFFSETS: Array<[string, number]> = [
  ['cap + 1 s past kickoff', -STUCK_GAME_CAP_MS - 1_000],
  ['exactly the cap past kickoff', -STUCK_GAME_CAP_MS],
  ['5 h past kickoff', -5 * 3_600_000],
  ['at kickoff', 0],
  ['lead − 1 s', POLL_LEAD_MS - 1_000],
  ['exactly the lead', POLL_LEAD_MS],
  ['lead + 1 s', POLL_LEAD_MS + 1_000],
  ['two days out', 2 * 86_400_000],
]

beforeAll(clear)
afterAll(clear)

describe('224: live_game_window_open ≡ planLivePoll(...).mode === "hot"', () => {
  it('one game: every status × every kickoff offset agrees (48 cases — the 15-minute lead and the 8-hour cap, R1822, each to the second)', async () => {
    const rows: string[] = []
    for (const status of STATUSES) {
      for (const [label, offsetMs] of OFFSETS) {
        const { route, database } = await bothAnswers([{ status, offsetMs }])
        rows.push(`${String(status)} @ ${label}: route ${route} database ${database}`)
        expect({ status, label, database }).toEqual({ status, label, database: route })
      }
    }
    // The cases are not vacuous: both answers occur, and FINAL is never open.
    expect(rows.some((r) => r.endsWith('route true database true'))).toBe(true)
    expect(rows.some((r) => r.endsWith('route false database false'))).toBe(true)
    expect(rows.filter((r) => r.startsWith('final @')).every((r) => r.endsWith('route false database false'))).toBe(true)
  })

  it('slates: no games; the last game gone final; a final game beside a live one; a final early game beside a later kickoff inside the lead', async () => {
    const slates: Array<Array<{ status: string | null; offsetMs: number }>> = [
      [],
      [
        { status: 'final', offsetMs: -4 * 3_600_000 },
        { status: 'final', offsetMs: -30 * 60_000 },
      ],
      [
        { status: 'final', offsetMs: -4 * 3_600_000 },
        { status: 'live', offsetMs: -60 * 60_000 },
      ],
      [
        { status: 'final', offsetMs: -4 * 3_600_000 },
        { status: 'scheduled', offsetMs: 10 * 60_000 },
      ],
      [
        { status: 'final', offsetMs: -4 * 3_600_000 },
        { status: 'scheduled', offsetMs: 3 * 3_600_000 },
      ],
    ]
    const expected = [false, false, true, true, false]
    for (const [i, slate] of slates.entries()) {
      const { route, database } = await bothAnswers(slate)
      expect({ slate: i, route }).toEqual({ slate: i, route: expected[i] })
      expect({ slate: i, database }).toEqual({ slate: i, database: route })
    }
  })
})
