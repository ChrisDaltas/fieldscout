/**
 * Run-plan derivation — M2 task L.B6.1 (delivery plan §4.2; tasks-M2 §6
 * L.B6.1 item 2/4).
 *
 * PURE and seeded: the whole matrix (sizes, rounds, reversal, persona
 * seating, the all-afk league, placeholder counts) derives from the seed
 * alone, so `--seed K` replays the identical plan (plan principle 4). The
 * gate-run guarantees are enforced BY CONSTRUCTION, not by luck:
 *   - ≥1 SIXTEEN-team league when sizes are mixed (E14's drift /
 *     no-dropped-picks substance at v1's max size — C31);
 *   - ≥1 all-afk league when there are ≥2 leagues (the all-timeout path);
 *   - ≥1 chaos seat in EVERY non-all-afk league ("chaos double-taps
 *     throughout") plus one of each other persona wherever seats allow.
 *
 * The sim matrix is SNAKE-only in M2 (tasks-M2 §1 sequencing note: linear
 * is implemented but v1 QA focuses snake; auction is M3). `snake_reversal`
 * (3RR) is mixed in seeded — it is a snake variant and the board-order
 * invariant handles it through the parity-pinned TS mirror (D90).
 */
import { mulberry32 } from '../stats/synthetic/prng'

import {
  LEGAL_TEAM_COUNTS,
  type LeaguePlan,
  type LegalTeamCount,
  type PersonaKind,
  type RunPlan,
  type SeatPlan,
} from './sim-types'

/** Bot-user pool ceiling: enough for the deepest human seating (6 distinct
 *  humans in the 16-team league) with head-room, small enough that
 *  provisioning stays polite to local GoTrue. */
export const BOT_POOL_SIZE = 8

/** Humans per league: 4 (one full persona set) — 6 in the 16-team league so
 *  the max-size board carries every persona plus extra manual traffic. */
export const HUMANS_DEFAULT = 4
export const HUMANS_SIXTEEN = 6

/** League names carry this prefix — cleanup sweeps by it (loud, R285). */
export const SIM_LEAGUE_PREFIX = 'SIM L.B6.1'

const PERSONA_SET: readonly PersonaKind[] = ['chaos', 'queue-drafter', 'adp-drafter', 'afk']

/** Compact draftable-round presets (D91: rounds = starters + bench; IR
 *  excluded). Keyed by round count; the runner materializes the roster. */
export const ROUND_CHOICES = [2, 3, 4] as const
/** The 16-team league always drafts 4 rounds — 64 picks, the run's biggest
 *  single board (the E14-at-16 substance carrier). */
export const SIXTEEN_TEAM_ROUNDS = 4

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!
}

/** Fisher–Yates over a copy (seeded). */
function shuffled<T>(rng: () => number, items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export interface BuildPlanInput {
  leagues: number
  /** 'mixed' (the gate shape) or one fixed legal size for every league. */
  teams: LegalTeamCount | 'mixed'
  clockSeconds: number
  seed: number
}

export function buildRunPlan(input: BuildPlanInput): RunPlan {
  const rng = mulberry32(input.seed >>> 0)
  const leagues: LeaguePlan[] = []

  // Deterministic special-league placement (seeded, but guaranteed).
  const sixteenIndex = input.teams === 'mixed' ? Math.floor(rng() * input.leagues) : -1
  const allAfkIndex = input.leagues >= 2 ? Math.floor(rng() * input.leagues) : -1

  for (let i = 0; i < input.leagues; i++) {
    const teamCount: LegalTeamCount =
      input.teams === 'mixed'
        ? i === sixteenIndex
          ? 16
          : pick(rng, LEGAL_TEAM_COUNTS)
        : input.teams
    const rounds = teamCount === 16 ? SIXTEEN_TEAM_ROUNDS : pick(rng, ROUND_CHOICES)
    const snakeReversal = rng() < 0.5
    const allAfk = i === allAfkIndex
    const humanCount = Math.min(teamCount, teamCount === 16 ? HUMANS_SIXTEEN : HUMANS_DEFAULT)

    // Distinct pool bots per league (a user holds at most one seat per
    // league); rotate the pool so bots spread across leagues.
    const firstBot = i % BOT_POOL_SIZE
    const humanSeats: SeatPlan[] = []
    const personas: PersonaKind[] = allAfk
      ? Array.from({ length: humanCount }, () => 'afk' as const)
      : [
          // One of each persona, then seeded extras; shuffled so the
          // commissioner's seat persona varies by seed. Chaos presence in
          // every non-all-afk league is guaranteed by the base set.
          ...PERSONA_SET,
          ...Array.from({ length: Math.max(0, humanCount - PERSONA_SET.length) }, () =>
            pick(rng, PERSONA_SET),
          ),
        ].slice(0, humanCount)
    for (const [seat, persona] of shuffled(rng, personas).entries()) {
      humanSeats.push({ botIndex: (firstBot + seat) % BOT_POOL_SIZE, persona })
    }

    leagues.push({
      index: i,
      name: `${SIM_LEAGUE_PREFIX} #${String(i + 1).padStart(2, '0')}`,
      teamCount,
      rounds,
      snakeReversal,
      humanSeats,
      placeholderCount: teamCount - humanCount,
      allAfk,
    })
  }

  return {
    seed: input.seed,
    clockSeconds: input.clockSeconds,
    leagues,
    botCount: BOT_POOL_SIZE,
  }
}

/** One line per league for the printed matrix (the report's plan echo). */
export function planLines(plan: RunPlan): string[] {
  return plan.leagues.map((l) => {
    const personas = l.allAfk
      ? `all-afk ×${l.humanSeats.length}`
      : l.humanSeats.map((s) => s.persona).join(', ')
    return (
      `${l.name}: ${l.teamCount} teams × ${l.rounds} rounds` +
      `${l.snakeReversal ? ' (3RR)' : ''} — humans [${personas}]` +
      ` + ${l.placeholderCount} placeholders`
    )
  })
}
