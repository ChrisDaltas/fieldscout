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
 * production project BY NAME — and this harness never writes that name into
 * the repo (it is public; standing rule (c)). The name is DERIVED at run
 * time from the repo's own `supabase link` file (`supabase/.temp/project-ref`,
 * gitignored — the repo is linked to production and never to the test
 * project, standing rule (i)): the Node side reads it and `.env.local`'s
 * hosted URL; k6's init context `open()`s the link file itself
 * (`lib/k6-context.ts`). `FS_LOAD_DENY` can only ADD names (R1641). With no
 * DERIVED name a test target is refused (fail closed: a guard that cannot
 * name production cannot prove a target is not it). The host judged is the
 * one the URL parser would reach, from a plain-ASCII origin only, and the
 * normalized origin is the only URL any client is handed (R1640). The
 * `local` target exists so the harness itself can be exercised on a laptop at
 * smoke size; it is not a §22.6 run (D571).
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
  /** Production names DERIVED from this machine's own files (the repo's
   *  `supabase link` file; `.env.local`'s hosted URL). Read at run time,
   *  never committed. ONLY these satisfy the fail-closed check (R1641). */
  derivedDeny: readonly string[]
  /** Operator additions (`FS_LOAD_DENY`). They can only ADD refusals — an
   *  extra name never makes an otherwise-refused target acceptable. */
  extraDeny?: readonly string[]
}

/** A target as the guard sees it. `origin` is the ONLY string any client is
 *  ever handed (R1640 — never the raw input). */
export interface NormalizedTarget {
  scheme: 'http' | 'https'
  /** Lower-cased plain-ASCII hostname, `[a-z0-9.-]` only. */
  host: string
  /** `scheme://host[:port]` — no path, no trailing slash. */
  origin: string
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost'])
/** The production app's own domain — never a Supabase target either. */
const PRODUCTION_APP_DOMAIN = 'fieldscout.gg'
/**
 * The whole accepted shape, applied to the RAW string before anything parses
 * it: scheme, plain-ASCII host, optional port, optional single slash. No
 * userinfo, path, query, fragment, percent-encoding, whitespace or non-ASCII
 * character can pass (R1640: `%61`, a soft hyphen, fullwidth letters and
 * `fieldscout%2egg` are each something a URL parser would quietly rewrite
 * into a host the deny check never saw).
 */
const PLAIN_ORIGIN = /^(https?):\/\/([A-Za-z0-9.-]+)(:\d{1,5})?\/?$/i

/**
 * Parse a target URL into its normalized origin, or throw. Where the runtime
 * has a WHATWG `URL` (Node; k6 has none), its hostname must equal ours — the
 * host the URL parser (lower-casing, IDNA) yields — so a client handed the
 * origin can only reach the host the guard judged.
 */
export function normalizeTarget(raw: string): NormalizedTarget {
  const trimmed = raw.trim()
  const m = PLAIN_ORIGIN.exec(trimmed)
  if (!m) {
    throw new Error(
      'load target refused: not a plain origin — scheme://host[:port] with an ASCII [a-z0-9.-] host, ' +
        'no encoding, path or credentials (R1640)',
    )
  }
  const scheme = m[1]!.toLowerCase() as 'http' | 'https'
  const host = m[2]!.toLowerCase()
  const badLabel = (label: string): boolean =>
    label.length === 0 || label.length > 63 || label.startsWith('-') || label.endsWith('-')
  if (host.split('.').some(badLabel)) throw new Error('load target refused: the host is not a well-formed DNS name')
  const origin = `${scheme}://${host}${m[3] ?? ''}`
  const UrlCtor = (globalThis as { URL?: new (u: string) => { hostname: string; protocol: string } }).URL
  if (UrlCtor !== undefined) {
    const parsed = new UrlCtor(origin)
    if (parsed.hostname !== host || parsed.protocol !== `${scheme}:`) {
      throw new Error('load target refused: the URL parser reads a different host than the guard did')
    }
  }
  return { scheme, host, origin }
}

/** Parse `KEY=value` lines (no interpolation; quotes stripped). Pure. */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    out[key] = value
  }
  return out
}

/**
 * Production names derivable from a checkout's own files: the linked project
 * ref, and the host of `.env.local`'s hosted Supabase URL. Pure — the caller
 * reads the files (`fs` on Node, `open()` in k6).
 */
export function derivedDenyNames(linkRef: string | null, envLocal: string | null): string[] {
  const out: string[] = []
  const ref = linkRef?.trim().toLowerCase()
  if (ref) out.push(ref)
  const url = envLocal ? parseEnvText(envLocal).NEXT_PUBLIC_SUPABASE_URL : undefined
  if (url) {
    // A production URL the strict parser rejects still yields a name: an odd
    // entry must never SHRINK the deny list.
    const loose = /^[a-z]+:\/\/([^/:?#]+)/i.exec(url.trim())?.[1]?.toLowerCase()
    let host = loose
    try {
      host = normalizeTarget(/^[a-z]+:\/\/[^/?#]+/i.exec(url.trim())?.[0] ?? url).host
    } catch {
      host = loose
    }
    if (host && !LOCAL_HOSTS.has(host)) out.push(host)
  }
  return out
}

/**
 * Throws unless `spec` is a target this harness may load. Returns the
 * NORMALIZED ORIGIN — the only string any client may be handed (R1640).
 *
 *  - `local`: the host must be the local stack (127.0.0.1 / localhost).
 *  - `test`: https, not local, not the app domain, naming no deny name; and
 *    with NO derived production name the target is refused (fail closed —
 *    operator additions do not count, R1641).
 */
export function assertSafeTarget(spec: TargetSpec): string {
  const t = normalizeTarget(spec.url)
  const clean = (names: readonly string[] | undefined): string[] =>
    (names ?? []).map((d) => d.trim().toLowerCase()).filter((d) => d.length > 0)
  const derived = clean(spec.derivedDeny)
  const deny = [...derived, ...clean(spec.extraDeny)]
  if (t.host === PRODUCTION_APP_DOMAIN || t.host.endsWith(`.${PRODUCTION_APP_DOMAIN}`)) {
    throw new Error('load target refused: that is the production app domain (spec §22.6 — never production)')
  }
  for (const name of deny) {
    if (t.host === name || t.host.includes(name)) {
      throw new Error('load target refused: it names the PRODUCTION project (spec §22.6, PROGRESS D571 — never production)')
    }
  }
  if (spec.kind === 'local') {
    if (!LOCAL_HOSTS.has(t.host)) {
      throw new Error('load target refused: --target local needs the local stack URL, got a non-local host')
    }
    return t.origin
  }
  if (LOCAL_HOSTS.has(t.host)) {
    throw new Error('load target refused: --target test was given the local stack (use --target local)')
  }
  if (t.scheme !== 'https') {
    throw new Error('load target refused: a hosted test project is reached over https')
  }
  if (derived.length === 0) {
    throw new Error(
      'load target refused: no production name could be derived from this machine (the repo’s supabase link file ' +
        'and .env.local were both unreadable; FS_LOAD_DENY only adds names) — the guard fails closed ' +
        '(spec §22.6: the harness refuses production by name)',
    )
  }
  return t.origin
}

/** The realtime websocket endpoint for a Supabase base URL. */
export function realtimeSocketUrl(baseUrl: string, anonKey: string): string {
  const ws = baseUrl.replace(/^http/, 'ws')
  return `${ws}/realtime/v1/websocket?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`
}
