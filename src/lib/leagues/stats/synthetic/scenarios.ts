/**
 * The versioned §23.6 scenario library (M0 task L.A0.3). Nine scenarios,
 * exact ids per tasks-M0 §5; each is the synthetic equivalent of a real
 * §19.2 edge case (E42–E45, E55–E57, E10/E44), deterministic and
 * re-runnable. Reused later by the League Simulator (delivery plan §4.2).
 *
 * All nine share one base week — 2026 week 2, matching the seeded nfl_weeks
 * calendar (039) — so the timing skeleton is identical across scenarios and
 * only the declared events differ. Stat values draw from `seed` only (see
 * prng.ts), so e.g. provider_outage and happy_path with the same seed carry
 * identical stat lines — the back-fill proof relies on it.
 */

import type {
  ScenarioId,
  SyntheticGameDef,
  SyntheticPlayerDef,
  SyntheticScenario,
} from './scenario'

/** Bump when any scenario's behavior changes (per-scenario `version` bumps
 *  with it). Fixture recordings and simulator runs pin against this. */
export const SCENARIO_LIBRARY_VERSION = 1

export const DEFAULT_SEED = 20260920

const SEASON = 2026
const WEEK = 2

// ── Base slate: 2026 week 2 ────────────────────────────────────────────────
// Sun early / Sun late / Sunday-night (Mon 00:20 UTC) games; 3h20m each.
const DURATION_MS = 3 * 60 * 60 * 1000 + 20 * 60 * 1000

const G1 = '2026-wk02-DAL@PHI'
const G2 = '2026-wk02-BUF@KC'
const G3 = '2026-wk02-SEA@SF'

/** §23.4 default: Thursday 06:00 ET after the week (2026-09-24 EDT = UTC−4). */
const CORRECTION_WINDOW_ENDS_AT = new Date('2026-09-24T10:00:00Z')

function baseGames(): SyntheticGameDef[] {
  return [
    {
      gameId: G1,
      homeTeam: 'PHI',
      awayTeam: 'DAL',
      kickoffAt: new Date('2026-09-20T17:00:00Z'),
      durationMs: DURATION_MS,
      chartedPostAt: new Date('2026-09-21T15:00:00Z'), // Mon AM ET (§23.5)
      chartedSlaAt: new Date('2026-09-21T17:00:00Z'),
    },
    {
      gameId: G2,
      homeTeam: 'KC',
      awayTeam: 'BUF',
      kickoffAt: new Date('2026-09-20T20:25:00Z'),
      durationMs: DURATION_MS,
      chartedPostAt: new Date('2026-09-21T15:00:00Z'),
      chartedSlaAt: new Date('2026-09-21T17:00:00Z'),
    },
    {
      gameId: G3,
      homeTeam: 'SF',
      awayTeam: 'SEA',
      kickoffAt: new Date('2026-09-21T00:20:00Z'), // SNF (Sun 8:20pm ET)
      durationMs: DURATION_MS,
      chartedPostAt: new Date('2026-09-22T15:00:00Z'), // T+1 for the late game
      chartedSlaAt: new Date('2026-09-22T17:00:00Z'),
    },
  ]
}

/** One player per position per game — 18 players. Deterministic ids. */
function basePlayers(): SyntheticPlayerDef[] {
  const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
  const out: SyntheticPlayerDef[] = []
  for (const [index, gameId] of [G1, G2, G3].entries()) {
    for (const position of positions) {
      out.push({
        playerId: `syn-g${index + 1}-${position.toLowerCase()}`,
        position,
        gameId,
      })
    }
  }
  return out
}

function baseScenario(id: ScenarioId, seed: number): SyntheticScenario {
  return {
    id,
    version: 1,
    seed,
    season: SEASON,
    week: WEEK,
    correctionWindowEndsAt: CORRECTION_WINDOW_ENDS_AT,
    games: baseGames(),
    players: basePlayers(),
    outages: [],
    corrections: [],
    chartedRevisions: [],
  }
}

function mustFind<T>(items: T[], predicate: (item: T) => boolean, what: string): T {
  const found = items.find(predicate)
  if (!found) throw new Error(`scenario library bug: missing ${what}`)
  return found
}

/**
 * Build a scenario by id. The timing/event skeleton is a pure function of
 * the id; `seed` affects stat-line values only.
 */
export function makeScenario(id: ScenarioId, seed: number = DEFAULT_SEED): SyntheticScenario {
  const scenario = baseScenario(id, seed)

  switch (id) {
    case 'happy_path':
      // One routine inactive + one injury designation so the ~90-min
      // publication and injury feeds are observable even on the golden path.
      mustFind(scenario.players, (p) => p.playerId === 'syn-g2-te', 'g2 TE').inactive = true
      mustFind(scenario.players, (p) => p.playerId === 'syn-g1-wr', 'g1 WR').injury = {
        designation: 'questionable',
        reportedAt: new Date('2026-09-18T20:00:00Z'), // Friday report
      }
      return scenario

    case 'flex_move':
      // E42: G3 (SNF) announced Thursday to move to the Sunday-late slot.
      mustFind(scenario.games, (g) => g.gameId === G3, 'G3').flexMove = {
        announceAt: new Date('2026-09-17T20:00:00Z'),
        newKickoffAt: new Date('2026-09-20T21:05:00Z'),
      }
      return scenario

    case 'postponement':
      // E43: G2 postponed out of the week, announced Sunday morning.
      mustFind(scenario.games, (g) => g.gameId === G2, 'G2').postponement = {
        announceAt: new Date('2026-09-20T15:00:00Z'),
        newKickoffAt: new Date('2026-09-27T20:25:00Z'), // next week — outside wk2
      }
      return scenario

    case 'mass_inactives':
      // Mass-inactives Sunday: most of G1's skill players plus G2 starters
      // scratched — all published on the normal ~90-min-pre-kickoff schedule.
      for (const playerId of [
        'syn-g1-rb',
        'syn-g1-wr',
        'syn-g1-te',
        'syn-g1-k',
        'syn-g2-qb',
        'syn-g2-rb',
        'syn-g2-wr',
      ]) {
        mustFind(scenario.players, (p) => p.playerId === playerId, playerId).inactive = true
      }
      return scenario

    case 'provider_outage':
      // §23.2/E45: a 40-minute outage during the Sunday-early window. Poll
      // cadence 20–30s ⇒ 3 consecutive failures well inside it.
      scenario.outages.push({
        startAt: new Date('2026-09-20T18:00:00Z'),
        endAt: new Date('2026-09-20T18:40:00Z'),
      })
      return scenario

    case 'correction_in_window':
      // E44/E10: a Tuesday correction, inside the Thu 06:00 ET window.
      scenario.corrections.push({
        playerId: 'syn-g1-wr',
        key: 'receiving_yards',
        delta: 7,
        at: new Date('2026-09-22T16:00:00Z'),
      })
      return scenario

    case 'correction_post_window':
      // E44 late arm: dated AFTER correctionWindowEndsAt. The provider dates
      // it honestly; flagging instead of auto-applying is downstream (§23.4).
      scenario.corrections.push({
        playerId: 'syn-g1-wr',
        key: 'receiving_yards',
        delta: -6,
        at: new Date('2026-09-25T12:00:00Z'),
      })
      return scenario

    case 'charted_late': {
      // E55/E57: G1's charted feed misses its Monday SLA and lands Wednesday.
      const g1 = mustFind(scenario.games, (g) => g.gameId === G1, 'G1')
      g1.chartedPostAt = new Date('2026-09-23T15:00:00Z')
      // chartedSlaAt stays Mon 17:00Z — the slip IS the observable.
      return scenario
    }

    case 'charted_revision':
      // E56: G1 WR's charted value revised Wednesday, after Monday's post.
      scenario.chartedRevisions.push({
        playerId: 'syn-g1-wr',
        key: 'example_charted_yards',
        delta: 9,
        at: new Date('2026-09-23T12:00:00Z'),
      })
      return scenario
  }
}
