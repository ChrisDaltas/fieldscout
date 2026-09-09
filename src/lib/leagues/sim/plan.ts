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
import type { RosterSettings } from '../settings/league-settings'
import { mulberry32 } from '../stats/synthetic/prng'

import { deriveStream } from './sim-rng'
import {
  LEGAL_TEAM_COUNTS,
  type AuctionPersonaKind,
  type LeaguePlan,
  type LegalTeamCount,
  type PersonaKind,
  type RunPlan,
  type SeasonLeaguePlan,
  type SeatPlan,
  type SimDraftType,
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

/** The auction persona base set (L.C4.1; §5 sketch). Chaos-first for the
 *  same reason as the snake set: every non-all-afk league carries one. */
const AUCTION_PERSONA_SET: readonly AuctionPersonaKind[] = [
  'chaos',
  'value-bidder',
  'sniper',
  'budget-hoarder',
  'afk',
]

/** Seeded auction budgets — the LOW end binds the §8.6.7 endgame clamps in
 *  a couple of buys on the compact rosters; 200 is the shipped default. */
const AUCTION_BUDGET_CHOICES = [50, 100, 200] as const

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
  /** 'snake' (the M2 matrix, unchanged default) or 'auction' (L.C4.1). */
  draftType?: SimDraftType
  /**
   * L.D6.1: draw the D299 in-season settings matrix as well. The axes come
   * from a SEPARATE seeded stream (`deriveStream(seed, SEASON_MATRIX_LABEL)`)
   * and never from `rng`, so a snake plan's rng consumption stays
   * BYTE-IDENTICAL to M2's — `plan.test.ts`'s stored-literal golden matrix at
   * seed 42 must not move, and it does not.
   */
  season?: boolean
}

/** The season matrix's own entropy label — never shared with `rng`. */
export const SEASON_MATRIX_LABEL = 'season:matrix'

/**
 * D299's PARITY-TEMPLATE axis, which the matrix did not have until L.D6.3:
 * every league was hard-coded to `ESPN Standard` (`runner.ts`'s one template
 * lookup), so seven of the eight shipped templates — and with them the §7.3.3
 * parity surface the M1 gate certifies — were never scored through by a season
 * run at all.
 *
 * The names are the SHIPPED eight in `templates.ts` order. They are listed
 * here rather than imported so a template added upstream cannot silently
 * change a season run's matrix; the runner REFUSES a name the database does
 * not carry, which is what keeps this list falsifiable rather than decorative.
 */
export const SEASON_SCORING_TEMPLATES: readonly string[] = [
  'Scout Standard',
  'Scout PPR',
  'ESPN Standard',
  'ESPN Full PPR',
  'Yahoo Standard',
  'Yahoo Half PPR',
  'Sleeper Standard',
  'Sleeper Full PPR',
]

/**
 * L.D6.1's season roster preset: ONE starting slot per scoring position, so
 * every one of the §23.6 library's six positions can actually reach a
 * starting lineup. `rosterForRounds` (the M2 draft preset) starts QB/RB/WR
 * only, which would make a bridged TE/K/D-ST line unreachable by
 * construction — a scenario the sim cannot observe is a decorative one.
 */
export const SEASON_ROSTER: RosterSettings = {
  starting_slots: [
    { key: 'qb', label: 'QB', eligible: ['QB'], count: 1 },
    { key: 'rb', label: 'RB', eligible: ['RB'], count: 1 },
    { key: 'wr', label: 'WR', eligible: ['WR'], count: 1 },
    { key: 'te', label: 'TE', eligible: ['TE'], count: 1 },
    { key: 'k', label: 'K', eligible: ['K'], count: 1 },
    { key: 'dst', label: 'D/ST', eligible: ['DST'], count: 1 },
  ],
  bench: 1,
  ir_slots: [],
  swap_spots: 0,
}

/** Draftable rounds in season mode: the six starters plus one bench seat. */
export const SEASON_ROUNDS = 7

/**
 * The §7.3.1 CREATION range for `regular_season_weeks` is 12–15
 * (`validateLeagueSettings`), so a season league's PLAN is always at least
 * twelve weeks long; `--weeks N` decides how many of them the run DRIVES.
 */
const SEASON_WEEK_CHOICES = [12, 13, 14] as const

export function buildRunPlan(input: BuildPlanInput): RunPlan {
  const rng = mulberry32(input.seed >>> 0)
  const draftType: SimDraftType = input.draftType ?? 'snake'
  const leagues: LeaguePlan[] = []

  // Deterministic special-league placement (seeded, but guaranteed).
  const sixteenIndex = input.teams === 'mixed' ? Math.floor(rng() * input.leagues) : -1
  const allAfkIndex = input.leagues >= 2 ? Math.floor(rng() * input.leagues) : -1
  // Auction axis guarantees (≥2 leagues): BOTH reserve columns and ≥1
  // manual nomination order appear BY CONSTRUCTION, not by seed luck. The
  // zero-dollar anchor deliberately avoids the all-afk index so the $0
  // column always carries manual bidding traffic too. The draws happen ONLY
  // on the auction path — a snake plan's rng consumption is byte-identical
  // to M2's (the stored-literal golden matrix in plan.test.ts must not
  // move; the league pins stay untouched).
  const zeroDollarAnchor =
    draftType === 'auction' && input.leagues >= 2
      ? (allAfkIndex + 1 + Math.floor(rng() * (input.leagues - 1))) % input.leagues
      : -1
  const manualOrderIndex =
    draftType === 'auction' && input.leagues >= 2 ? Math.floor(rng() * input.leagues) : -1

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
    const personaSetSize = draftType === 'auction' ? AUCTION_PERSONA_SET.length : PERSONA_SET.length
    // Season mode seats every pool bot it can: each human seat is one the
    // sim can SET a lineup for, and the more lineups it sets the more of the
    // eighteen bridged §23.6 players actually reach a starting slot. (Only
    // the `input.season` arm changes — a draft-only plan's humanCount, and
    // therefore its rng consumption, is byte-identical to M2's.)
    const humanCount = Math.min(
      teamCount,
      input.season === true
        ? BOT_POOL_SIZE
        : teamCount === 16
          ? HUMANS_SIXTEEN
          : Math.max(HUMANS_DEFAULT, draftType === 'auction' ? personaSetSize : 0),
    )

    // Distinct pool bots per league (a user holds at most one seat per
    // league); rotate the pool so bots spread across leagues.
    const firstBot = i % BOT_POOL_SIZE
    const humanSeats: SeatPlan[] = []
    if (draftType === 'auction') {
      const personas: AuctionPersonaKind[] = allAfk
        ? Array.from({ length: humanCount }, () => 'afk' as const)
        : [
            ...AUCTION_PERSONA_SET,
            ...Array.from({ length: Math.max(0, humanCount - AUCTION_PERSONA_SET.length) }, () =>
              pick(rng, AUCTION_PERSONA_SET),
            ),
          ].slice(0, humanCount)
      for (const [seat, auctionPersona] of shuffled(rng, personas).entries()) {
        humanSeats.push({
          botIndex: (firstBot + seat) % BOT_POOL_SIZE,
          // `persona` is the shared SeatPlan slot the snake plumbing reads;
          // the auction runner reads `auctionPersona`. Kept coherent:
          // afk maps to afk, everything else to the closest snake kind.
          persona: auctionPersona === 'afk' ? 'afk' : 'adp-drafter',
          auctionPersona,
        })
      }
    } else {
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
      ...(draftType === 'auction'
        ? {
            auction: {
              zeroDollarNominations: i === zeroDollarAnchor ? true : i === allAfkIndex ? false : rng() < 0.35,
              budget: pick(rng, AUCTION_BUDGET_CHOICES),
              nominationOrderMode: i === manualOrderIndex ? ('manual' as const) : ('same_as_draft_order' as const),
              // Bounded commissioner traffic (E28/E69/reverse) runs in every
              // league that has a live commissioner persona to drive it.
              commishEdits: !allAfk,
            },
          }
        : {}),
    })
  }

  if (input.season === true) applySeasonMatrix(leagues, input.seed)

  return {
    seed: input.seed,
    draftType,
    clockSeconds: input.clockSeconds,
    leagues,
    botCount: BOT_POOL_SIZE,
  }
}

/**
 * The D299 in-season matrix, applied to an already-built plan — L.D6.1.
 *
 * Coverage is BY CONSTRUCTION, not by seed luck (the `plan.ts:96-112`
 * discipline): with ≥2 leagues the run carries at least one of each
 * `schedule_mode`; with ≥3 at least one `median_game` on; with ≥4 at least
 * one `second_opponent` on; with ≥5 at least one `allow_illegal_lineups` OFF.
 * Everything else is seeded.
 *
 * The two coupled facts the schema enforces and this respects:
 *   - `total_points` ⇒ `playoff_teams = 0` (v2.16.25 / Q39 (C)).
 *   - `playoff_start_week = regular_season_weeks + 1` (Q10, §7.3.8's seam).
 *
 * Season mode also fixes `rounds` to `SEASON_ROUNDS` and seats as many human
 * bots as the pool allows: the more seats a real manager holds, the more of
 * the eighteen bridged §23.6 players reach a lineup the sim can set.
 *
 * R918 (PR #273 review): `median_game` and `second_opponent` are MODE-GATED —
 * a points race carries neither (§11.7) — so guaranteeing the index alone was
 * not a guarantee at all. The free-league coin below could flip the very
 * league that carried the arm to `total_points` and drop it: measured over
 * seeds 1-300 at 6 leagues, 19 seeds lost the median arm and 21 lost the
 * second-opponent arm, and the unseeded default (`scripts/sim.ts` falls back
 * to a wall-clock seed) made ~6-7 % of runs certify a thinner matrix than
 * D327(2) claims and exit 0. The guarantee indices are therefore FORCED to
 * `h2h` before the coin is tossed, and `plan.test.ts` asserts the guarantee
 * over a seed RANGE rather than sampling one seed.
 */
export function applySeasonMatrix(leagues: LeaguePlan[], seed: number): void {
  const rng = deriveStream(seed, SEASON_MATRIX_LABEL)
  const n = leagues.length
  // Guaranteed columns, placed deterministically from the season stream.
  const totalPointsIndex = n >= 2 ? Math.floor(rng() * n) : -1
  const h2hIndex = n >= 2 ? (totalPointsIndex + 1 + Math.floor(rng() * (n - 1))) % n : 0
  const medianIndex = n >= 3 ? pickOther(rng, n, [totalPointsIndex]) : -1
  const secondIndex = n >= 4 ? pickOther(rng, n, [totalPointsIndex, medianIndex]) : -1
  const illegalOffIndex = n >= 5 ? pickOther(rng, n, [totalPointsIndex]) : -1
  // The parity-template axis: a seeded ROTATION, so at n >= 8 every shipped
  // template appears by construction and below 8 the sample still moves with
  // the seed. `forkIndex` carries D299's §7.3.3.1 custom-fork arm.
  const templateOffset = Math.floor(rng() * SEASON_SCORING_TEMPLATES.length)
  const forkIndex = n >= 2 ? Math.floor(rng() * n) : -1
  // The mode-gated arms only exist on an h2h league, so the leagues carrying
  // them are h2h BY CONSTRUCTION — never by the coin below (R918).
  const forcedH2h = new Set([h2hIndex, medianIndex, secondIndex].filter((i) => i >= 0))

  for (const league of leagues) {
    const i = league.index
    const scheduleMode: 'h2h' | 'total_points' =
      i === totalPointsIndex ? 'total_points' : forcedH2h.has(i) ? 'h2h' : rng() < 0.25 ? 'total_points' : 'h2h'
    const regularSeasonWeeks = pick(rng, SEASON_WEEK_CHOICES)
    // playoff_teams ≤ team_count, an even bracket size from the catalog.
    const playoffTeams =
      scheduleMode === 'total_points' ? 0 : Math.min(league.teamCount, pick(rng, [4, 6, 8] as const))
    league.rounds = SEASON_ROUNDS
    const seasonPlan: SeasonLeaguePlan = {
      scheduleMode,
      // A median game is meaningless in a points race — the mode already
      // scores every team against the field (§11.7); keep it off there.
      medianGame: scheduleMode === 'h2h' && (i === medianIndex || rng() < 0.4),
      secondOpponent: scheduleMode === 'h2h' && (i === secondIndex || rng() < 0.3),
      allowIllegalLineups: i !== illegalOffIndex,
      regularSeasonWeeks,
      playoffTeams,
      playoffStartWeek: regularSeasonWeeks + 1,
      scoringTemplate:
        SEASON_SCORING_TEMPLATES[(i + templateOffset) % SEASON_SCORING_TEMPLATES.length]!,
      forkScoring: i === forkIndex,
    }
    league.season = seasonPlan
  }
}

function pickOther(rng: () => number, n: number, avoid: readonly number[]): number {
  const candidates = Array.from({ length: n }, (_, i) => i).filter((i) => !avoid.includes(i))
  if (candidates.length === 0) return -1
  return candidates[Math.floor(rng() * candidates.length)]!
}

/** One line per league for the SEASON matrix — the D299 axes actually set. */
export function seasonPlanLines(plan: RunPlan): string[] {
  return plan.leagues.map((l) => {
    const s = l.season
    if (s === undefined) return `${l.name}: (no season plan)`
    return (
      `${l.name}: ${l.teamCount} teams · ${s.scheduleMode} · median ${s.medianGame ? 'on' : 'off'} · ` +
      `second ${s.secondOpponent ? 'on' : 'off'} · illegal-lineups ${s.allowIllegalLineups ? 'on' : 'off'} · ` +
      `${s.regularSeasonWeeks} regular weeks · playoff_teams ${s.playoffTeams} · ` +
      `scoring ${s.scoringTemplate}${s.forkScoring ? ' (FORKED + edited — §7.3.3.1)' : ''} · ` +
      `${l.rounds} rounds · humans ${l.humanSeats.length}/${l.teamCount}`
    )
  })
}

/** One line per league for the printed matrix (the report's plan echo). */
export function planLines(plan: RunPlan): string[] {
  return plan.leagues.map((l) => {
    const personas = l.allAfk
      ? `all-afk ×${l.humanSeats.length}`
      : l.humanSeats.map((s) => s.auctionPersona ?? s.persona).join(', ')
    const auction = l.auction
      ? ` — auction $${l.auction.budget}` +
        `${l.auction.zeroDollarNominations ? ' $0-noms' : ''}` +
        `${l.auction.nominationOrderMode === 'manual' ? ' manual-order' : ''}`
      : ''
    return (
      `${l.name}: ${l.teamCount} teams × ${l.rounds} rounds` +
      `${l.snakeReversal && !l.auction ? ' (3RR)' : ''}${auction} — humans [${personas}]` +
      ` + ${l.placeholderCount} placeholders`
    )
  })
}
