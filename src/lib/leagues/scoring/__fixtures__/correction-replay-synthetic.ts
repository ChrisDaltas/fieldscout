/**
 * THE SYNTHETIC CORRECTION PAIR — MADE UP. NOT A REAL NFL CORRECTION.
 *
 * M6 L.E2.6 under Chris's 2026-10-02 ruling ("yeah lets not hold for it" —
 * PROGRESS D468): the replay proof is built and gated on made-up corrections
 * now; a real recorded 2026 correction replays through the same harness when
 * L.E2.5's capture yields one (F540). This file is that made-up pair. It
 * lives with the tests, never under `fixtures/nfl/` (where only real
 * captures go), and its provider identity says what it is:
 * `synthetic:correction-replay` — so every row it writes carries
 * `source = 'replay:synthetic:synthetic:correction-replay'`.
 *
 * The pair, in the L.A0.4 format (D6 / D27), on a calendar of its own
 * (season label 2080; every instant a literal):
 *   week 1: one game, kickoff Sunday 2080-09-15 17:00Z, FINAL at snapshot 1;
 *   week 2: one game, kickoff Friday 2080-09-20 00:15Z (= week 1's lock).
 *   snapshot 1 (Monday 2080-09-16 12:00Z): the receiver 100 receiving yards.
 *   snapshot 2 (Thursday 2080-09-19 12:00Z): 94 — a made-up -6 correction.
 */
import { FIXTURE_FORMAT, FIXTURE_FORMAT_VERSION, type FixtureRecording } from '@/lib/leagues/stats/fixtures/fixture-format'

import type { ReplayPair } from '../correction-replay'

export const SYNTHETIC_PROVIDER = 'synthetic:correction-replay'
const SEASON = 2080
const WEEK = 1
const GAME_W1 = 'syn-crp-w1'
const GAME_W2 = 'syn-crp-w2'
export const SYNTHETIC_T1 = '2080-09-16T12:00:00.000Z'
export const SYNTHETIC_T2 = '2080-09-19T12:00:00.000Z'

function snapshot(playerId: string, t: string, receivingYards: number): FixtureRecording {
  const schedule = [
    { gameId: GAME_W1, season: SEASON, week: WEEK, homeTeam: 'SYA', awayTeam: 'SYB', kickoffAt: '2080-09-15T17:00:00.000Z', gameDate: '2080-09-15', status: 'final' },
    { gameId: GAME_W2, season: SEASON, week: WEEK + 1, homeTeam: 'SYB', awayTeam: 'SYA', kickoffAt: '2080-09-20T00:15:00.000Z', gameDate: '2080-09-19', status: 'scheduled' },
  ]
  // No game id on the line — production's Sleeper lines carry none (F468(a)),
  // so the week stands in for the game, exactly as on production.
  const lines = [{ playerId, season: SEASON, week: WEEK, stats: { receiving_yards: receivingYards, receptions: 7 }, advanced: {} }]
  return {
    header: { format: FIXTURE_FORMAT, version: FIXTURE_FORMAT_VERSION, provider: SYNTHETIC_PROVIDER, season: SEASON, week: WEEK },
    entries: [
      { t, method: 'getSchedule', args: [SEASON], ok: true, status: null, body: schedule },
      { t, method: 'getGameStates', args: [SEASON, WEEK], ok: true, status: null, body: [{ gameId: GAME_W1, status: 'final' }] },
      { t, method: 'getWeekStats', args: [SEASON, WEEK], ok: true, status: null, body: lines },
    ],
  }
}

/** The made-up pair around `playerId` (a test-prefixed WR the caller inserts). */
export function buildSyntheticCorrectionPair(playerId: string): ReplayPair {
  return {
    origin: 'synthetic',
    label: 'synthetic (made up — a test fixture, not a real correction)',
    first: snapshot(playerId, SYNTHETIC_T1, 100),
    second: snapshot(playerId, SYNTHETIC_T2, 94),
    change: { playerId, statKey: 'receiving_yards', old: 100, new: 94, name: 'Syn Receiver', position: 'WR', nflTeam: 'SYA' },
  }
}
