/**
 * The §22.6 load harness's ONE config (M7 L.F2.1; spec §22.6 v2.16.100;
 * PROGRESS D570 / D571 — breakdown TD1 / TD2).
 *
 * TD1 — TARGET LOAD IS A PARAMETER, NOT A CONSTANT. Every scenario (the four
 * k6 entries under `load/k6/`, the seeder `scripts/load/seed-staging.ts`, the
 * Sunday feeder `scripts/load/sunday-replay.ts` and the Node driver
 * `scripts/load/run-node.ts`) reads its sizes from `resolveProfile(name)`
 * below and nowhere else. Two CERTIFYING profiles exist, as ruled: `y2026`
 * (Q88 (a): about 5 drafts, 25 leagues — the friends' test-league scale) and
 * `ga` (the printed §22.6 sizes: 50 drafts, 500 leagues). A third, `smoke`,
 * is the small size the task's smoke run uses; it certifies NOTHING and the
 * report says so on every line it prints.
 *
 * TD2 — WHERE IT RUNS. The hosted TEST project (Q89 (a)), never production,
 * never the shared local DB for a load run. `assertSafeTarget` refuses the
 * production project BY NAME — the name is never written in this repo (it is
 * public; standing rule (c)): the Node side reads it at run time from the
 * repo's own `supabase link` file (`supabase/.temp/project-ref`, gitignored —
 * the repo is linked to production and never to the test project, standing
 * rule (i)) and from `.env.local`'s hosted URL, and hands it to k6 as
 * `FS_LOAD_DENY`. With no deny name available a non-local target is refused
 * (fail closed: a guard that cannot name production cannot prove a target is
 * not it). The `local` target exists so the harness itself can be exercised
 * on a laptop at smoke size; it is not a §22.6 run (D571).
 *
 * Pure module: no k6 import, no Node import — k6, vitest and tsx all load it.
 */

export type ProfileName = 'smoke' | 'y2026' | 'ga'
export const CERTIFYING_PROFILES: readonly ProfileName[] = ['y2026', 'ga']

/** A §7.3.8 team count (every seat is a real bot — no placeholder seats, so
 *  no E48 autopilot pick ever lands in a measured draft). */
export type TeamCount = 8 | 10 | 12 | 14 | 16
export const TEAM_COUNTS: readonly number[] = [8, 10, 12, 14, 16]

/** A pick clock from the §7.3.8 catalog (the `pick_timer_seconds` enum). */
export type ClockSec = 30 | 45 | 60 | 90 | 120

export interface LoadProfile {
  name: ProfileName
  // ---- TD1's contractual names (breakdown §5 sketch) -----------------------
  /** Scenario (1): simultaneous snake drafts. */
  drafts: number
  /** Scenario (1): seats (bots) per draft. GA: NOT YET SET — spec §22.6
   *  (v2.16.100, R1600): "seats per draft follow the `ga` profile's
   *  `botsPerDraft`, bounded by v1's 16-team cap (OQ 12) — set when the
   *  GA-size load task (M7 L.F2.13) is cut." `null` until then; resolving a
   *  scenario that needs it refuses with that sentence. */
  botsPerDraft: number | null
  /** Scenario (1): pick clock (§22.6 prints 60 s). */
  clockSec: ClockSec
  /** Scenario (3): seeded in-season leagues the Sunday replays across. */
  leagues: number
  /** Scenario (3): replay speeds (§22.6: 1× and 4×). One run per speed. */
  replaySpeed: readonly number[]
  /** Scenario (4): soak length (§22.6: 24 h). */
  soakHours: number
  // ---- Harness parameters (not §22.6 numbers — named, never assumed) -------
  /** Scenario (1): draftable rounds per snake draft. */
  rounds: number
  /** Scenario (1): a bot's think time on the clock, ms (uniform in range). */
  pickDelayMs: { min: number; max: number }
  /** Scenario (2): seats in the auction room (a §7.3.8 team count). */
  auctionSeats: TeamCount
  /** Scenario (2): bids in one storm (§22.6: 20) … */
  bidsPerStorm: number
  /** … inside this window (§22.6: 2 s). */
  stormWindowMs: number
  /** Scenario (2): storms (one nomination each) per run. */
  storms: number
  /** Scenario (3): seats per seeded league (a §7.3.8 team count). */
  teamsPerLeague: TeamCount
  /** Scenario (3) and (4): viewers per league (§22.1: "avg 4 viewers"). */
  viewersPerLeague: number
  /** Scenario (3): wall seconds between feeder polls (§14: HOT polls 20 s). */
  pollSec: number
  /** Scenario (3): wall seconds between score-worker invocations when the
   *  feeder drives the worker itself (§22.2: "cron every 5–10 s"). */
  workerSec: number
  /** Scenario (3): replay only the first N recorded minutes (null = all). */
  replayClipMinutes: number | null
  /** Scenario (4): one connection's hold before it churns, seconds. */
  churnHoldSec: { min: number; max: number }
}

const NOT_SET_GA_SEATS =
  "the ga profile's botsPerDraft is not set — spec §22.6 (v2.16.100): seats per draft are set when the " +
  'GA-size load task (M7 L.F2.13) is cut, bounded by v1’s 16-team cap (OQ 12)'

const PROFILES: Record<ProfileName, LoadProfile> = {
  smoke: {
    name: 'smoke',
    drafts: 1,
    botsPerDraft: 8, // the smallest §7.3.8 team count — every seat a bot, no placeholder autopilot
    clockSec: 30,
    leagues: 2,
    replaySpeed: [1, 4],
    soakHours: 0.05, // 3 minutes
    rounds: 3,
    pickDelayMs: { min: 200, max: 600 },
    auctionSeats: 8,
    bidsPerStorm: 20,
    stormWindowMs: 2000,
    storms: 1,
    teamsPerLeague: 8,
    viewersPerLeague: 2,
    pollSec: 20,
    workerSec: 5,
    replayClipMinutes: 10,
    churnHoldSec: { min: 10, max: 30 },
  },
  y2026: {
    name: 'y2026',
    drafts: 5, // Q88 (a): "about 5 simultaneous drafts"
    botsPerDraft: 12,
    clockSec: 60, // §22.6 (1)
    leagues: 25, // Q88 (a): "25 leagues"
    replaySpeed: [1, 4], // §22.6 (3)
    soakHours: 24, // §22.6 (4)
    rounds: 15,
    pickDelayMs: { min: 2000, max: 15000 },
    auctionSeats: 12,
    bidsPerStorm: 20, // §22.6 (2)
    stormWindowMs: 2000, // §22.6 (2)
    storms: 3,
    teamsPerLeague: 10,
    viewersPerLeague: 4, // §22.1
    pollSec: 20,
    workerSec: 5,
    replayClipMinutes: null,
    churnHoldSec: { min: 60, max: 900 },
  },
  ga: {
    name: 'ga',
    drafts: 50, // §22.6 (1)
    botsPerDraft: null, // set when L.F2.13 is cut (§22.6 v2.16.100)
    clockSec: 60, // §22.6 (1)
    leagues: 500, // §22.6 (3)
    replaySpeed: [1, 4], // §22.6 (3)
    soakHours: 24, // §22.6 (4)
    rounds: 15,
    pickDelayMs: { min: 2000, max: 15000 },
    auctionSeats: 12,
    bidsPerStorm: 20, // §22.6 (2)
    stormWindowMs: 2000, // §22.6 (2)
    storms: 10,
    teamsPerLeague: 12,
    viewersPerLeague: 4, // §22.1
    pollSec: 20,
    workerSec: 5,
    replayClipMinutes: null,
    churnHoldSec: { min: 60, max: 900 },
  },
}

export function isProfileName(value: string): value is ProfileName {
  return value === 'smoke' || value === 'y2026' || value === 'ga'
}

export function resolveProfile(name: string | undefined): LoadProfile {
  const key = name ?? 'smoke'
  if (!isProfileName(key)) {
    throw new Error(`unknown load profile '${key}' — one of smoke | y2026 | ga (load/k6/config.ts)`)
  }
  return PROFILES[key]
}

/** Scenario (1)'s seat count, or the spec's own refusal while it is unset. */
export function seatsPerDraft(profile: LoadProfile): number {
  if (profile.botsPerDraft === null) throw new Error(NOT_SET_GA_SEATS)
  if (profile.botsPerDraft > 16) {
    throw new Error(`botsPerDraft ${profile.botsPerDraft} exceeds v1's 16-team cap (OQ 12; spec §22.6)`)
  }
  if (!TEAM_COUNTS.includes(profile.botsPerDraft)) {
    throw new Error(`botsPerDraft ${profile.botsPerDraft} is not a §7.3.8 team count (${TEAM_COUNTS.join(' | ')})`)
  }
  return profile.botsPerDraft
}

/** §22.1's viewer model — the soak's connection count: leagues × viewers. */
export function soakConnections(profile: LoadProfile): number {
  return profile.leagues * profile.viewersPerLeague
}

/** Every line a smoke-size run prints carries this, so a smoke number is
 *  never read as a §22.6 result. */
export function sizeBanner(profile: LoadProfile): string {
  return CERTIFYING_PROFILES.includes(profile.name)
    ? `PROFILE ${profile.name} (§22.6 ${profile.name === 'ga' ? 'GA / launch-gate size' : '2026 size'})`
    : `PROFILE ${profile.name} (SMOKE — certifies nothing; §22.6 sizes are y2026 and ga)`
}

// ---------------------------------------------------------------------------
// The §22.6 asserts — the numbers the spec prints, and only those
// ---------------------------------------------------------------------------

/** §22.6 (1): p95 pick→broadcast < 500 ms. */
export const PICK_TO_BROADCAST_P95_MS = 500
/** §22.6 (3): scoring lag p95 < 15 s behind ingestion. */
export const SCORING_LAG_P95_MS = 15_000

// ---------------------------------------------------------------------------
// The namespace every seeded row carries (cleanup is by these, loudly)
// ---------------------------------------------------------------------------

/** League names start with this; bot usernames with `LOAD_USERNAME_PREFIX`. */
export const LOAD_LEAGUE_PREFIX = 'load-f21 '
export const LOAD_USERNAME_PREFIX = 'load_f21_'
export const LOAD_EMAIL_DOMAIN = 'load.fieldscout.test'
/** The harness's own NFL season: measured unused by every suite, fixture and
 *  migration in the repo at task time (2026-10-20, `grep -rlw 2070`) — so a
 *  load run's calendar, games, stat lines, queue rows and correction events
 *  never touch a season anything else reads, and cleanup deletes by it. */
export const LOAD_SEASON = 2070
/** The replayed Sunday lands on this week of `LOAD_SEASON`. */
export const LOAD_WEEK = 1
/** Remapped game ids carry this prefix (`nfl_games.id` is a global key). */
export const LOAD_GAME_PREFIX = 'load-f21-'

// ---------------------------------------------------------------------------
// TD2 — the target guard
// ---------------------------------------------------------------------------

export type TargetKind = 'local' | 'test'

export interface TargetSpec {
  kind: TargetKind
  /** The Supabase API base URL (https://<host> or http://127.0.0.1:54321). */
  url: string
  /** Names that identify PRODUCTION (project refs / hostnames). Read at run
   *  time, never committed. */
  deny: readonly string[]
}

const LOCAL_URL = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/
/** The production app's own domain — never a Supabase target either. */
const PRODUCTION_APP_DOMAIN = 'fieldscout.gg'

function hostOf(url: string): string {
  const match = /^[a-z]+:\/\/([^/:?#]+)/i.exec(url.trim())
  if (!match) throw new Error(`load target: '${url}' is not a URL`)
  return match[1]!.toLowerCase()
}

/**
 * Throws unless `spec` is a target this harness may load. Returns the
 * normalized base URL (no trailing slash).
 *
 *  - `local`: the URL must be the local stack (127.0.0.1 / localhost).
 *  - `test`: the URL must be https, must NOT be local, and must not contain
 *    any deny name; with NO deny names the target is refused (fail closed).
 */
export function assertSafeTarget(spec: TargetSpec): string {
  const url = spec.url.trim().replace(/\/+$/, '')
  const host = hostOf(url)
  const deny = spec.deny.map((d) => d.trim().toLowerCase()).filter((d) => d.length > 0)
  if (host === PRODUCTION_APP_DOMAIN || host.endsWith(`.${PRODUCTION_APP_DOMAIN}`)) {
    throw new Error('load target refused: that is the production app domain (spec §22.6 — never production)')
  }
  for (const name of deny) {
    if (host === name || host.includes(name)) {
      throw new Error('load target refused: it names the PRODUCTION project (spec §22.6, PROGRESS D571 — never production)')
    }
  }
  if (spec.kind === 'local') {
    if (!LOCAL_URL.test(url)) {
      throw new Error(`load target refused: --target local needs the local stack URL, got a non-local host`)
    }
    return url
  }
  if (LOCAL_URL.test(url)) {
    throw new Error('load target refused: --target test was given the local stack (use --target local)')
  }
  if (!url.startsWith('https://')) {
    throw new Error('load target refused: a hosted test project is reached over https')
  }
  if (deny.length === 0) {
    throw new Error(
      'load target refused: no production name is available to check against (the repo’s supabase link file ' +
        'and .env.local were both unreadable) — the guard fails closed (spec §22.6: the harness refuses production by name)',
    )
  }
  return url
}

/** The realtime websocket endpoint for a Supabase base URL. */
export function realtimeSocketUrl(baseUrl: string, anonKey: string): string {
  const ws = baseUrl.replace(/^http/, 'ws')
  return `${ws}/realtime/v1/websocket?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`
}
