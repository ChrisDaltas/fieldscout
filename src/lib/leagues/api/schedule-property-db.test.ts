/**
 * THE SCHEDULE PROPERTY SWEEP — delivery plan §4.1's "schedule invariants
 * (§11.7) — property tests over random seeds/team counts", run as a seeded
 * sweep THROUGH THE REAL SQL ENGINE over the wire (D289: one implementation,
 * no TS mirror, no parity burden). tasks-M4 L.D1.2 item 5; spec v2.16.12
 * §11.7 Generation + Mid-season entry; PROGRESS Q30 (d) / Q31 (b); D305(5).
 *
 * Two layers, both against migration 110's functions:
 *
 *   LAYER 1 — ≥ 200 seeded draws through the PURE core (`schedule_fit_internal`
 *   + `schedule_build_internal`): each draw picks (seed, size ∈ the closed v1
 *   set, regular-season weeks 4..15, `divisions` 1|2 — drawn so the record
 *   shows it was, expecting NO effect (it is not even a parameter of the
 *   builder; layer 2 proves the writer ignores it), second_opponent, entry
 *   week 1..18, playoff_teams ≤ size, playoff_weeks_per_round). The fit/shrink
 *   outcome is asserted against the ruling's chain (the test's oracle — ten
 *   lines of the §11.7 text, not a product mirror), and when the season fits
 *   the schedule's every §11.7 invariant is asserted on the returned rows:
 *   row count, EVERY team EXACTLY ONCE per week per game type counted over
 *   home AND away together (R703's cross-side shape), no self-matchups, the
 *   E40 derangement (a secondary pairing never repeats that week's primary
 *   pairing), balanced repeats (spread ≤ 1), repeat gap ≥ 3 (and exactly
 *   n − 1 — measured), home/away alternation within a pairing, and — every
 *   tenth draw — determinism (the same call twice is byte-equal).
 *
 *   LAYER 2 — the WRITER (`league_generate_schedule`) on real in_season
 *   leagues created by the service role: eight configured draws at injected
 *   `p_now` instants on the real 2026 calendar (D291's front door), asserting
 *   the returned plan against the same oracle, the written `matchups` /
 *   `league_weeks` rows against the invariants, the written-back effective
 *   columns (Q31 rider (3)), and the Q30 (d) pin: the SAME league regenerated
 *   with `divisions` flipped 1 → 2 (same seed) produces byte-identical rows.
 *   One draw enters at NFL week 16 and must be REFUSED by name. Held-lock
 *   discipline (tasks-M3 §4 rule 6 / plan §8.3): the fastest writer RTT of the
 *   sweep must land under 50 ms — a systematically long league-row hold
 *   inflates every sample.
 *
 * Draws are reproducible: a fixed SWEEP_SEED drives an in-test LCG, and every
 * assertion message carries the draw index + parameters, so a red cell can be
 * replayed by number.
 *
 * FIXTURE HYGIENE (F199): every league this suite creates carries the
 * `vitest-sched-prop-` name prefix and is swept in beforeAll AND afterAll
 * (matchups → league_weeks → members → teams → leagues — the FK order).
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips (§4.3).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import { derivePlayoffRounds } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const service: SupabaseClient<Database> = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const NAME_PREFIX = 'vitest-sched-prop-'
const OWNER = { email: 'vitest-sched-prop-owner@fieldscout.local', password: 'sched-prop-pass-1234', username: 'sched_prop_owner' }
const SWEEP_SEED = 20260902
const LAYER1_DRAWS = 220
const V1_SIZES = [8, 10, 12, 14, 16] as const
const PLAYOFF_CATALOG = [0, 2, 4, 6, 8, 10, 12] as const

// ---------------------------------------------------------------------------
// The sweep's own PRNG (reproducible draws; never Math.random)
// ---------------------------------------------------------------------------
function makeRng(seed: number) {
  let state = seed % 2147483647
  if (state <= 0) state += 2147483646
  return {
    next(): number {
      state = (state * 48271) % 2147483647
      return state
    },
    int(min: number, max: number): number {
      return min + (this.next() % (max - min + 1))
    },
    pick<T>(xs: readonly T[]): T {
      return xs[this.int(0, xs.length - 1)]!
    },
    bool(): boolean {
      return this.next() % 2 === 0
    },
  }
}

// ---------------------------------------------------------------------------
// The oracle: §11.7 Mid-season entry's fit check + shrink chain (Q31 (b);
// D305(5) for the non-default drop steps). Ten lines of the ruling's text.
// ---------------------------------------------------------------------------
function playoffDrop(pt: number): number {
  const target = derivePlayoffRounds(pt) - 1
  return Math.max(...PLAYOFF_CATALOG.filter((v) => derivePlayoffRounds(v) === target))
}

function fitOracle(first: number, rsw: number, pt: number, wpr: number) {
  let r = rsw
  let p = pt
  let last = 0
  let fits = true
  for (;;) {
    last = first + r + derivePlayoffRounds(p) * wpr - 1
    if (last <= 18) break
    if (r > 4) r -= 1
    else if (p > 0) p = playoffDrop(p)
    else {
      fits = false
      break
    }
  }
  return { regular_season_weeks: r, playoff_teams: p, last_week: last, fits, shrunk: r !== rsw || p !== pt }
}

// ---------------------------------------------------------------------------
// The invariant checker (shared by both layers)
// ---------------------------------------------------------------------------
interface Row {
  week: number
  round_type: string
  home_team_id: string
  away_team_id: string
}

function assertInvariants(rows: Row[], n: number, rsw: number, firstWeek: number, second: boolean, label: string) {
  const types = second ? 2 : 1
  expect(rows.length, `${label}: row count`).toBe(rsw * (n / 2) * types)

  // Every team exactly once per (week, round_type), home AND away together (R703).
  const perCell = new Map<string, number>()
  for (const r of rows) {
    for (const t of [r.home_team_id, r.away_team_id]) {
      const k = `${r.week}|${r.round_type}|${t}`
      perCell.set(k, (perCell.get(k) ?? 0) + 1)
    }
    expect(r.home_team_id, `${label}: self-matchup wk ${r.week}`).not.toBe(r.away_team_id)
    expect(r.week >= firstWeek && r.week < firstWeek + rsw, `${label}: week ${r.week} outside the plan`).toBe(true)
  }
  for (const [k, c] of perCell) expect(c, `${label}: ${k} appears ${c}× (must be exactly once)`).toBe(1)
  const cells = new Set(rows.flatMap((r) => [`${r.week}|${r.round_type}`]))
  for (const cell of cells) {
    const teams = new Set<string>()
    for (const r of rows) if (`${r.week}|${r.round_type}` === cell) teams.add(r.home_team_id).add(r.away_team_id)
    expect(teams.size, `${label}: ${cell} covers ${teams.size} of ${n} teams`).toBe(n)
  }

  // E40: no secondary pairing equals that week's primary pairing.
  const pairKey = (r: Row) => [r.home_team_id, r.away_team_id].sort().join('~')
  const primaryByWeek = new Map<number, Set<string>>()
  for (const r of rows) if (r.round_type === 'regular') {
    if (!primaryByWeek.has(r.week)) primaryByWeek.set(r.week, new Set())
    primaryByWeek.get(r.week)!.add(pairKey(r))
  }
  for (const r of rows) if (r.round_type === 'secondary') {
    expect(primaryByWeek.get(r.week)?.has(pairKey(r)) ?? false, `${label}: E40 — secondary wk ${r.week} repeats the primary pair`).toBe(false)
  }

  // Balanced repeats (spread ≤ 1) and repeat gap (≥ 3; measured n − 1).
  const meetings = new Map<string, number[]>()
  for (const r of rows) if (r.round_type === 'regular') {
    const k = pairKey(r)
    if (!meetings.has(k)) meetings.set(k, [])
    meetings.get(k)!.push(r.week)
  }
  const counts = [...meetings.values()].map((w) => w.length)
  expect(Math.max(...counts) - Math.min(...counts), `${label}: repeat spread`).toBeLessThanOrEqual(1)
  let minGap = Number.POSITIVE_INFINITY
  for (const weeks of meetings.values()) {
    const sorted = [...weeks].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) minGap = Math.min(minGap, sorted[i]! - sorted[i - 1]!)
  }
  if (rsw > n - 1) {
    expect(minGap, `${label}: min repeat gap`).toBe(n - 1)
    expect(minGap, `${label}: repeat gap ≥ 3`).toBeGreaterThanOrEqual(3)
  } else {
    expect(minGap, `${label}: no repeats inside one cycle`).toBe(Number.POSITIVE_INFINITY)
  }

  // Home/away alternation within a pairing, per game type.
  const lastHome = new Map<string, string>()
  const ordered = [...rows].sort((a, b) => a.week - b.week)
  for (const r of ordered) {
    const k = `${r.round_type}|${pairKey(r)}`
    const prev = lastHome.get(k)
    if (prev !== undefined) expect(r.home_team_id, `${label}: ${k} — same home side twice in a row`).not.toBe(prev)
    lastHome.set(k, r.home_team_id)
  }
}

const rowText = (rows: Row[]) =>
  [...rows]
    .sort((a, b) => a.week - b.week || a.round_type.localeCompare(b.round_type) || a.home_team_id.localeCompare(b.home_team_id))
    .map((r) => `${r.week}|${r.round_type}|${r.home_team_id}|${r.away_team_id}`)
    .join(',')

// ---------------------------------------------------------------------------
// Fixture sweep (F199)
// ---------------------------------------------------------------------------
async function cleanup() {
  const { data: leagues } = await service.from('leagues').select('id').like('name', `${NAME_PREFIX}%`)
  const ids = (leagues ?? []).map((l) => l.id)
  if (ids.length > 0) {
    for (const table of ['matchups', 'league_weeks', 'league_members', 'teams'] as const) {
      const { error } = await service.from(table).delete().in('league_id', ids)
      if (error) throw new Error(`cleanup ${table}: ${error.message}`)
    }
    const { error } = await service.from('leagues').delete().in('id', ids)
    if (error) throw new Error(`cleanup leagues: ${error.message}`)
  }
  const { data: users } = await service.auth.admin.listUsers({ perPage: 1000 })
  for (const u of users?.users ?? []) if (u.email === OWNER.email) await service.auth.admin.deleteUser(u.id)
}

let ownerId = ''
let templateId = ''
let templateRules: Json = {}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)
  const { data: created, error } = await service.auth.admin.createUser({
    email: OWNER.email,
    password: OWNER.password,
    email_confirm: true,
    user_metadata: { username: OWNER.username },
  })
  if (error) throw new Error(`createUser failed: ${error.message}`)
  ownerId = created.user.id
  const { data: template, error: tErr } = await service
    .from('scoring_systems')
    .select('id, rules')
    .eq('is_template', true)
    .eq('name', 'ESPN Standard')
    .single()
  if (tErr || !template) throw new Error(`template read failed: ${tErr?.message}`)
  templateId = template.id
  templateRules = template.rules
})

afterAll(async () => {
  await cleanup()
})

// ---------------------------------------------------------------------------
// RPC helpers
// ---------------------------------------------------------------------------
async function rpcFit(first: number, rsw: number, pt: number, wpr: number) {
  const { data, error } = await service.rpc('schedule_fit_internal', {
    p_first_week: first,
    p_regular_season_weeks: rsw,
    p_playoff_teams: pt,
    p_playoff_weeks_per_round: wpr,
  })
  if (error) throw new Error(`schedule_fit_internal(${first},${rsw},${pt},${wpr}): ${error.message}`)
  const row = (data as unknown as Array<Record<string, unknown>>)[0]!
  return row as { regular_season_weeks: number; playoff_teams: number; last_week: number; fits: boolean; shrunk: boolean }
}

async function rpcBuild(ids: string[], seed: number, first: number, rsw: number, second: boolean): Promise<Row[]> {
  const { data, error } = await service.rpc('schedule_build_internal', {
    p_team_ids: ids,
    p_seed: seed,
    p_first_week: first,
    p_regular_season_weeks: rsw,
    p_second_opponent: second,
  })
  if (error) throw new Error(`schedule_build_internal: ${error.message}`)
  return data as unknown as Row[]
}

/**
 * The synthetic season's calendar (synthetic-season.ts — the 039 shape: week W
 * starts Wednesday 00:00 ET, no kickoffs, no games), so the datum resolves
 * through its THIRD arm, `starts_at`. Under THAT arm "enter at week W" is any
 * instant in [starts_at(W−1), starts_at(W)) — noon on the Thursday of week
 * W−1 here (or the day before week 1). With `first_kickoff_at` populated (the
 * production shape after L.D2.1's ingest) the window is [kickoff(W−1),
 * kickoff(W)) instead; pgTAP 058 §E pins each arm with its twins (R725).
 * Layer 2 runs on the synthetic season so a shifted or spent real calendar can
 * never move these goldens (R724).
 */
function entryInstant(week: number): string {
  // Week 1 starts <season>-09-09 00:00 -04; week n starts 7 × (n − 1) days later.
  const week1 = Date.UTC(SYNTHETIC_SEASON, 8, 9, 4, 0, 0) // 00:00 -04 = 04:00Z
  const startOfWeek = week1 + (week - 1) * 7 * 86_400_000
  // Inside [start(W−1), start(W)): 12h after start(W−1) (or 12h before start(1)).
  const inside = week === 1 ? startOfWeek - 12 * 3_600_000 : startOfWeek - 7 * 86_400_000 + 12 * 3_600_000
  return new Date(inside).toISOString()
}

// ---------------------------------------------------------------------------
// LAYER 1 — ≥ 200 draws through the pure core
// ---------------------------------------------------------------------------
describe('LAYER 1: ≥ 200 seeded draws through schedule_fit_internal + schedule_build_internal (the real engine over the wire)', () => {
  it(`${LAYER1_DRAWS} draws: the fit chain matches the ruling's oracle and every §11.7 invariant holds on the built rows`, async () => {
    const rng = makeRng(SWEEP_SEED)
    let fitsCount = 0
    let refusedCount = 0
    let shrunkCount = 0
    for (let i = 0; i < LAYER1_DRAWS; i++) {
      const n = rng.pick(V1_SIZES)
      const rsw = rng.int(4, 15)
      const divisions = rng.int(1, 2) // drawn; no effect (not a builder parameter — layer 2 pins the writer)
      const second = rng.bool()
      const first = rng.int(1, 18)
      const pt = rng.pick(PLAYOFF_CATALOG.filter((v) => v <= n))
      const wpr = rng.int(1, 2)
      const seed = rng.next()
      const label = `draw ${i} (n=${n} rsw=${rsw} div=${divisions} so=${second} first=${first} pt=${pt} wpr=${wpr} seed=${seed})`

      const fit = await rpcFit(first, rsw, pt, wpr)
      const want = fitOracle(first, rsw, pt, wpr)
      expect(
        { rsw: fit.regular_season_weeks, pt: fit.playoff_teams, last: fit.last_week, fits: fit.fits, shrunk: fit.shrunk },
        `${label}: fit chain`,
      ).toStrictEqual({ rsw: want.regular_season_weeks, pt: want.playoff_teams, last: want.last_week, fits: want.fits, shrunk: want.shrunk })
      if (!fit.fits) {
        refusedCount++
        expect(first, `${label}: only NFL week 16+ can be refused`).toBeGreaterThanOrEqual(16)
        continue
      }
      fitsCount++
      if (fit.shrunk) shrunkCount++
      expect(fit.regular_season_weeks, `${label}: floor`).toBeGreaterThanOrEqual(4)

      const ids = Array.from({ length: n }, () => crypto.randomUUID())
      const rows = await rpcBuild(ids, seed, first, fit.regular_season_weeks, second)
      assertInvariants(rows, n, fit.regular_season_weeks, first, second, label)
      if (i % 10 === 0) {
        const again = await rpcBuild(ids, seed, first, fit.regular_season_weeks, second)
        expect(rowText(again), `${label}: determinism`).toBe(rowText(rows))
        const shuffled = [...ids].sort((a, b) => (a < b ? 1 : -1))
        const reordered = await rpcBuild(shuffled, seed, first, fit.regular_season_weeks, second)
        expect(rowText(reordered), `${label}: input-order independence`).toBe(rowText(rows))
      }
    }
    // The sweep must have exercised every arm, not just the happy path.
    expect(fitsCount, 'draws that fit').toBeGreaterThan(150)
    expect(refusedCount, 'draws refused (entry week 16+)').toBeGreaterThan(10)
    expect(shrunkCount, 'draws that shrank').toBeGreaterThan(50)
  }, 120_000)

  it('the chain at every boundary as literals: week 12 → 4+6, 13 → 4+4, 14 → 4+2, 15 → 4+0, 16 → refused (defaults)', async () => {
    expect(await rpcFit(12, 14, 6, 1)).toMatchObject({ regular_season_weeks: 4, playoff_teams: 6, fits: true })
    expect(await rpcFit(13, 14, 6, 1)).toMatchObject({ regular_season_weeks: 4, playoff_teams: 4, fits: true })
    expect(await rpcFit(14, 14, 6, 1)).toMatchObject({ regular_season_weeks: 4, playoff_teams: 2, fits: true })
    expect(await rpcFit(15, 14, 6, 1)).toMatchObject({ regular_season_weeks: 4, playoff_teams: 0, fits: true })
    expect(await rpcFit(16, 14, 6, 1)).toMatchObject({ regular_season_weeks: 4, playoff_teams: 0, fits: false })
  })
})

// ---------------------------------------------------------------------------
// LAYER 2 — the writer on real leagues (divisions drawn and IGNORED)
// ---------------------------------------------------------------------------
interface LeagueDraw {
  n: number
  rsw: number
  pt: number
  wpr: 1 | 2
  second: boolean
  divisions: 1 | 2
  seed: number
  entryWeek: number
}

async function createLeague(draw: LeagueDraw, index: number): Promise<{ leagueId: string; teamIds: string[] }> {
  const leagueId = crypto.randomUUID()
  const { error } = await service.from('leagues').insert({
    id: leagueId,
    owner_id: ownerId,
    name: `${NAME_PREFIX}${index}`,
    season: SYNTHETIC_SEASON,
    status: 'in_season',
    team_count: draw.n as 8,
    regular_season_weeks: draw.rsw,
    playoff_teams: draw.pt,
    playoff_start_week: draw.rsw + 1,
    scoring_system_id: templateId,
    scoring_rules_snapshot: templateRules,
    settings: {
      divisions: draw.divisions,
      second_opponent: draw.second,
      playoff_weeks_per_round: draw.wpr,
      schedule_seed: draw.seed,
      schedule_mode: 'h2h',
    },
  })
  if (error) throw new Error(`league insert: ${error.message}`)
  const teamIds = Array.from({ length: draw.n }, () => crypto.randomUUID())
  const { error: tErr } = await service.from('teams').insert(
    teamIds.map((id, i) => ({ id, owner_id: ownerId, name: `${NAME_PREFIX}${index}-t${i + 1}`, league_id: leagueId })),
  )
  if (tErr) throw new Error(`teams insert: ${tErr.message}`)
  return { leagueId, teamIds }
}

async function generate(leagueId: string, instant: string) {
  // process.hrtime.bigint(): monotonic and outside the D3/D17 wall-clock fence (the auction-core-db idiom).
  const startNs = process.hrtime.bigint()
  const { data, error } = await service.rpc('league_generate_schedule', { p_league_id: leagueId, p_now: instant })
  const rtt = Number(process.hrtime.bigint() - startNs) / 1e6
  return { data: data as Record<string, unknown> | null, error, rtt }
}

async function readWritten(leagueId: string) {
  const { data: rows, error } = await service
    .from('matchups')
    .select('week, round_type, home_team_id, away_team_id')
    .eq('league_id', leagueId)
  if (error) throw new Error(`matchups read: ${error.message}`)
  const { data: weeks, error: wErr } = await service.from('league_weeks').select('week, status').eq('league_id', leagueId).order('week')
  if (wErr) throw new Error(`league_weeks read: ${wErr.message}`)
  const { data: league, error: lErr } = await service
    .from('leagues')
    .select('regular_season_weeks, playoff_teams, playoff_start_week, settings')
    .eq('id', leagueId)
    .single()
  if (lErr || !league) throw new Error(`league read: ${lErr?.message}`)
  return { rows: (rows ?? []) as Row[], weeks: weeks ?? [], league }
}

describe('LAYER 2: league_generate_schedule on real in_season leagues — the plan, the written rows, the write-back, divisions ignored', () => {
  it('eight configured draws at injected instants: plan ≡ oracle, invariants on the WRITTEN rows, columns written back, divisions 1 → 2 byte-identical; held-lock < 50 ms', async () => {
    const rng = makeRng(SWEEP_SEED + 1)
    const draws: LeagueDraw[] = [
      { n: 8, rsw: 14, pt: 6, wpr: 1, second: false, divisions: 1, seed: rng.next(), entryWeek: 1 },
      { n: 10, rsw: 14, pt: 6, wpr: 1, second: true, divisions: 2, seed: rng.next(), entryWeek: 10 },
      { n: 12, rsw: 15, pt: 12, wpr: 1, second: false, divisions: 2, seed: rng.next(), entryWeek: 13 },
      { n: 14, rsw: 13, pt: 8, wpr: 2, second: true, divisions: 1, seed: rng.next(), entryWeek: 6 },
      { n: 16, rsw: 12, pt: 4, wpr: 1, second: false, divisions: 2, seed: rng.next(), entryWeek: 14 },
      { n: 8, rsw: 14, pt: 0, wpr: 1, second: true, divisions: 1, seed: rng.next(), entryWeek: 15 },
      { n: 10, rsw: 12, pt: 10, wpr: 1, second: false, divisions: 1, seed: rng.next(), entryWeek: 12 },
      { n: 12, rsw: 14, pt: 6, wpr: 2, second: true, divisions: 2, seed: rng.next(), entryWeek: 2 },
    ]
    const rtts: number[] = []
    for (const [i, draw] of draws.entries()) {
      const label = `league draw ${i} (n=${draw.n} rsw=${draw.rsw} pt=${draw.pt} wpr=${draw.wpr} so=${draw.second} div=${draw.divisions} entry=${draw.entryWeek})`
      const { leagueId, teamIds } = await createLeague(draw, i)
      const instant = entryInstant(draw.entryWeek)
      const want = fitOracle(draw.entryWeek, draw.rsw, draw.pt, draw.wpr)
      expect(want.fits, `${label}: the draw is designed to fit`).toBe(true)

      const first = await generate(leagueId, instant)
      expect(first.error, `${label}: generate — ${first.error?.message}`).toBeNull()
      rtts.push(first.rtt)
      expect(first.data, label).toMatchObject({
        first_week: draw.entryWeek,
        regular_season_weeks: want.regular_season_weeks,
        playoff_teams: want.playoff_teams,
        playoff_start_week: want.regular_season_weeks + 1,
        last_week: want.last_week,
        shrunk: want.shrunk,
        schedule_seed: draw.seed,
        seed_minted: false,
        second_opponent: draw.second,
      })

      const w1 = await readWritten(leagueId)
      assertInvariants(w1.rows, draw.n, want.regular_season_weeks, draw.entryWeek, draw.second, label)
      for (const r of w1.rows) expect(teamIds, `${label}: a foreign team in the schedule`).toContain(r.home_team_id)
      expect(w1.weeks.map((w) => w.week), `${label}: league_weeks span`).toStrictEqual(
        Array.from({ length: want.last_week - draw.entryWeek + 1 }, (_, k) => draw.entryWeek + k),
      )
      expect(w1.weeks.every((w) => w.status === 'upcoming'), `${label}: weeks born upcoming`).toBe(true)
      expect(
        { rsw: w1.league.regular_season_weeks, pt: w1.league.playoff_teams, psw: w1.league.playoff_start_week },
        `${label}: write-back`,
      ).toStrictEqual({ rsw: want.regular_season_weeks, pt: want.playoff_teams, psw: want.regular_season_weeks + 1 })

      // Q30 (d): flip divisions, regenerate from the SAME seed ⇒ byte-identical.
      for (const table of ['matchups', 'league_weeks'] as const) {
        const { error } = await service.from(table).delete().eq('league_id', leagueId)
        if (error) throw new Error(`${label}: reset ${table}: ${error.message}`)
      }
      const flipped = draw.divisions === 1 ? 2 : 1
      const { error: sErr } = await service
        .from('leagues')
        .update({
          settings: { ...(w1.league.settings as Record<string, Json>), divisions: flipped },
          // restore the STORED plan so the chain re-runs from the same input
          regular_season_weeks: draw.rsw,
          playoff_teams: draw.pt,
          playoff_start_week: draw.rsw + 1,
        })
        .eq('id', leagueId)
      if (sErr) throw new Error(`${label}: flip divisions: ${sErr.message}`)
      const second = await generate(leagueId, instant)
      expect(second.error, `${label}: regenerate with divisions=${flipped}`).toBeNull()
      rtts.push(second.rtt)
      const w2 = await readWritten(leagueId)
      expect(rowText(w2.rows), `${label}: divisions ${draw.divisions} → ${flipped} must not change the schedule (Q30 (d))`).toBe(rowText(w1.rows))
    }
    expect(
      Math.min(...rtts),
      `held-lock bound: every league_generate_schedule RTT exceeded 50 ms — [${rtts.map((n) => n.toFixed(1)).join(', ')}]ms`,
    ).toBeLessThan(50)
  }, 120_000)

  it('a league entering at NFL week 16 is REFUSED by name — and writes nothing', async () => {
    const draw: LeagueDraw = { n: 8, rsw: 14, pt: 6, wpr: 1, second: false, divisions: 1, seed: 424242, entryWeek: 16 }
    const { leagueId } = await createLeague(draw, 99)
    const res = await generate(leagueId, entryInstant(16))
    expect(res.error?.message ?? '').toMatch(/would enter the season at NFL week 16 — even the 4-week floor with no playoffs ends at week 19/)
    const w = await readWritten(leagueId)
    expect(w.rows.length + w.weeks.length, 'nothing written on refusal').toBe(0)
    expect({ rsw: w.league.regular_season_weeks, pt: w.league.playoff_teams }, 'plan untouched on refusal').toStrictEqual({ rsw: 14, pt: 6 })
  })

  it('…its one-unit positive: the same league one week earlier (week 15) generates at 4 + 0', async () => {
    const draw: LeagueDraw = { n: 8, rsw: 14, pt: 6, wpr: 1, second: false, divisions: 1, seed: 424242, entryWeek: 15 }
    const { leagueId } = await createLeague(draw, 98)
    const res = await generate(leagueId, entryInstant(15))
    expect(res.error).toBeNull()
    expect(res.data).toMatchObject({ first_week: 15, regular_season_weeks: 4, playoff_teams: 0, playoff_start_week: 5, last_week: 18, matchups: 16, league_weeks: 4 })
  })

  it('total_points writes zero matchup rows BY NAME and still materializes the weeks', async () => {
    const draw: LeagueDraw = { n: 8, rsw: 14, pt: 6, wpr: 1, second: true, divisions: 1, seed: 7, entryWeek: 10 }
    const { leagueId } = await createLeague(draw, 97)
    const { error } = await service
      .from('leagues')
      .update({ settings: { schedule_mode: 'total_points', second_opponent: true, schedule_seed: 7, divisions: 1, playoff_weeks_per_round: 1 } })
      .eq('id', leagueId)
    if (error) throw new Error(error.message)
    const res = await generate(leagueId, entryInstant(10))
    expect(res.error).toBeNull()
    expect(res.data).toMatchObject({ matchups: 0, matchups_reason: 'total_points', league_weeks: 9, regular_season_weeks: 6 })
  })
})
