/**
 * seed-staging — the §22.6 harness's seeder (M7 L.F2.1; breakdown §5
 * `scripts/load/seed-staging.ts`; spec §22.6 v2.16.100; PROGRESS D571).
 *
 *   npx tsx scripts/load/seed-staging.ts --target test  --profile y2026 --scenario snake
 *   npx tsx scripts/load/seed-staging.ts --target test  --profile y2026 --scenario auction
 *   npx tsx scripts/load/seed-staging.ts --target test  --profile y2026 --scenario leagues --recording <fixture.jsonl.gz>
 *   npx tsx scripts/load/seed-staging.ts --target local --profile smoke --scenario snake   # exercising the harness only
 *   npx tsx scripts/load/seed-staging.ts --target <t> --cleanup                            # sweep everything a load run made
 *   npx tsx scripts/load/seed-staging.ts --target <t> --census                             # count it (0 × 8 = clean)
 *
 * PRODUCTION-SHAPED, THROUGH THE REAL VERBS. Every league is created by a
 * real signed-in user through `createLeague`, every other seat claimed
 * through `createInvite` / `claimInvite`, every draft created through
 * `createDraft` — the service functions the route handlers wrap (the sim's
 * D100 rule). Drafts are left CREATED, NOT STARTED: the k6 setup (or the
 * Node driver) starts them, so no clock runs before the load does. The
 * in-season leagues (`--scenario leagues`, scenarios 3 and 4) are taken past
 * the draft by the same service-role steps the in-season fixture uses
 * (`dev-seed-inseason-league.ts`): status → in_season with the template's
 * snapshot, `league_generate_schedule`, rosters, a week-1 lineup per team,
 * `league_week_advance` to open week 1.
 *
 * NAMESPACED, AND SWEPT LOUDLY. Leagues are named `load-f21 …`, bots are
 * `load_f21_NN` on a reserved test domain, and the in-season calendar is
 * the harness's own season (`LOAD_SEASON`, measured unused). `--cleanup`
 * deletes by exactly those, in the sim's recorded FK order
 * (`runner.ts` `cleanupSweep`), then verifies the census is zero. Seeding
 * always sweeps first. The seeder never writes `players` (CLAUDE.md: player
 * data is sync-only) — a test project needs its `players` synced first.
 *
 * REFUSES PRODUCTION BY NAME (TD2) — `scripts/load/target.ts`.
 * The manifest (bot passwords + row ids) goes to `load/.out/` — gitignored.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Database } from '@/types/database'
import { pageAll } from '@/lib/supabase/page-all'
import { claimInvite, createInvite } from '@/lib/leagues/api/invites-service'
import { createLeague, patchLeague } from '@/lib/leagues/api/leagues-service'
import { createDraft } from '@/lib/leagues/api/draft-service'
import { defaultsForTeamCount, type LeagueSettings } from '@/lib/leagues/settings/league-settings'
import { rosterForRounds } from '@/lib/leagues/sim/runner'
import { syntheticNflWeeks } from '@/lib/leagues/sim/synthetic-season'
import type { ProviderPlayerWeekStats } from '@/lib/leagues/stats/stats-provider'

import {
  LOAD_EMAIL_DOMAIN,
  LOAD_GAME_PREFIX,
  LOAD_LEAGUE_PREFIX,
  LOAD_SEASON,
  LOAD_USERNAME_PREFIX,
  LOAD_WEEK,
  TEAM_COUNTS,
  resolveProfile,
  seatsPerDraft,
  sizeBanner,
  type LoadProfile,
} from '../../load/k6/config'
import type { LoadBot, LoadManifest, SeedScenario } from '../../load/k6/lib/manifest'
import { loadRecording } from './recording'
import { resolveTarget, type ResolvedTarget } from './target'

type Supabase = SupabaseClient<Database>

const FAR_FUTURE_DRAFT = '2069-09-01T17:00:00+00:00' // never auto-starts before the run starts it
const CHUNK = 200
export const OUT_DIR = 'load/.out'

function chunked<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} failed: ${res.error.message}`)
  return res.data
}

function mustRow<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  const row = must(res, what)
  if (row === null || row === undefined) throw new Error(`${what}: no row`)
  return row as NonNullable<T>
}

function randomPassword(): string {
  return `load-${crypto.randomUUID()}`
}

export function manifestPath(scenario: SeedScenario): string {
  return resolve(process.cwd(), OUT_DIR, `${scenario}.manifest.json`)
}

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

interface Bot extends LoadBot {
  client: Supabase
}

async function provisionBots(target: ResolvedTarget, service: Supabase, count: number, runTag: string): Promise<Bot[]> {
  const bots: Bot[] = []
  for (let i = 0; i < count; i++) {
    const username = `${LOAD_USERNAME_PREFIX}${String(i + 1).padStart(2, '0')}`
    const email = `${username}.${runTag}@${LOAD_EMAIL_DOMAIN}`
    const password = randomPassword()
    const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username } })
    if (error) throw new Error(`createUser ${username} failed: ${error.message}`)
    const client = createClient<Database>(target.url, target.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const signIn = await client.auth.signInWithPassword({ email, password })
    if (signIn.error) throw new Error(`sign-in ${username} failed: ${signIn.error.message}`)
    bots.push({ index: i, email, password, userId: data.user.id, username, client })
  }
  return bots
}

// ---------------------------------------------------------------------------
// Leagues (the real verbs)
// ---------------------------------------------------------------------------

interface SeatedLeague {
  leagueId: string
  teamByBot: Map<number, string>
}

async function templateId(reader: Supabase): Promise<{ id: string; rules: unknown }> {
  const row = must(
    await reader.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').maybeSingle(),
    'scoring template lookup',
  )
  if (!row) throw new Error("scoring template 'ESPN Standard' is not on the target (migrations not applied?)")
  return { id: row.id as string, rules: row.rules }
}

async function createSeatedLeague(
  bots: readonly Bot[],
  name: string,
  season: number,
  settings: LeagueSettings,
  scoringSystemId: string,
): Promise<SeatedLeague> {
  const commish = bots[0]!
  const created = await createLeague(commish.client, {
    name,
    season,
    scoring_system_id: scoringSystemId,
    team_name: 'Load team 1', // ≤ 24 chars (the create schema)
    action_id: crypto.randomUUID(),
    settings,
  })
  if (created.status !== 201) throw new Error(`createLeague '${name}' failed (${created.status}): ${JSON.stringify(created.body)}`)
  const leagueId = (created.body as { league_id: string }).league_id
  const teamByBot = new Map<number, string>()
  for (const bot of bots.slice(1)) {
    const invite = await createInvite(commish.client, leagueId, {})
    if (invite.status !== 201 && invite.status !== 200) throw new Error(`createInvite failed (${invite.status}): ${JSON.stringify(invite.body)}`)
    const claim = await claimInvite(bot.client, { token: (invite.body as { token: string }).token })
    if (claim.status !== 200) throw new Error(`claimInvite ${bot.username} failed (${claim.status}): ${JSON.stringify(claim.body)}`)
    teamByBot.set(bot.index, (claim.body as { team_id: string }).team_id)
  }
  const own = mustRow(
    await commish.client.from('league_members').select('team_id').eq('league_id', leagueId).eq('user_id', commish.userId).single(),
    'commissioner seat read',
  )
  teamByBot.set(commish.index, own.team_id as string)
  return { leagueId, teamByBot }
}

async function draftPool(reader: Supabase, depth: number): Promise<string[]> {
  const rows = must(
    await reader.from('players').select('id, adp').not('adp', 'is', null).order('adp', { ascending: true }).limit(depth),
    'player pool read',
  )
  const ids = (rows ?? []).map((r) => r.id as string)
  if (ids.length < depth) {
    throw new Error(`the target has ${ids.length} players with an ADP; the draft scenarios need ${depth} (sync players first)`)
  }
  return ids
}

async function seedDrafts(
  service: Supabase,
  target: ResolvedTarget,
  profile: LoadProfile,
  scenario: 'snake' | 'auction',
  runTag: string,
): Promise<LoadManifest> {
  const seats = scenario === 'snake' ? seatsPerDraft(profile) : profile.auctionSeats
  if (!TEAM_COUNTS.includes(seats)) throw new Error(`${seats} seats is not a §7.3.8 team count`)
  const count = scenario === 'snake' ? profile.drafts : 1
  const bots = await provisionBots(target, service, seats, runTag)
  const template = await templateId(bots[0]!.client)
  const base = defaultsForTeamCount(seats as LeagueSettings['team_count'])
  const settings: LeagueSettings = {
    ...base,
    roster_settings: rosterForRounds(profile.rounds),
    draft:
      scenario === 'snake'
        ? {
            ...base.draft,
            draft_type: 'snake',
            draft_order_mode: 'random',
            pick_timer_seconds: profile.clockSec,
            draft_scheduled_at: FAR_FUTURE_DRAFT,
          }
        : {
            ...base.draft,
            draft_type: 'auction',
            draft_order_mode: 'random',
            auction_nomination_seconds: profile.clockSec,
            draft_scheduled_at: FAR_FUTURE_DRAFT,
          },
  }
  const pool = await draftPool(bots[0]!.client, Math.max(400, seats * profile.rounds * 2))
  const drafts: LoadManifest['drafts'] = []
  for (let d = 0; d < count; d++) {
    const name = `${LOAD_LEAGUE_PREFIX}${scenario} ${d + 1} ${runTag}`
    const league = await createSeatedLeague(bots, name, LOAD_SEASON, settings, template.id)
    const scheduled = await patchLeague(bots[0]!.client, league.leagueId, { status: 'scheduled' })
    if (scheduled.status !== 200) throw new Error(`scheduled PATCH failed (${scheduled.status}): ${JSON.stringify(scheduled.body)}`)
    const created = await createDraft(bots[0]!.client, league.leagueId)
    if (created.status !== 201 && created.status !== 200) throw new Error(`createDraft failed (${created.status}): ${JSON.stringify(created.body)}`)
    const draft = mustRow(
      await service.from('drafts').select('id, status').eq('league_id', league.leagueId).eq('is_mock', false).single(),
      'draft read',
    )
    drafts.push({
      leagueId: league.leagueId,
      draftId: draft.id as string,
      commissioner: 0,
      seats: bots.map((b) => ({ bot: b.index, teamId: league.teamByBot.get(b.index)! })),
    })
    console.log(`  seeded ${scenario} draft ${d + 1}/${count}: ${seats} seats, draft ${draft.status as string}`)
  }
  return manifest(scenario, profile, target, runTag, bots, drafts, [], pool)
}

// ---------------------------------------------------------------------------
// In-season leagues (scenarios 3 + 4)
// ---------------------------------------------------------------------------

const POSITION_OF: Record<string, string> = { DEF: 'DST', DST: 'DST' }

/** The recorded Sunday's players, by position, that the target knows. */
async function recordedPlayersByPosition(service: Supabase, recordingPath: string): Promise<Map<string, string[]>> {
  const recording = loadRecording(recordingPath)
  const statEntries = recording.entries.filter((e) => e.method === 'getWeekStats' && e.ok)
  const last = statEntries[statEntries.length - 1]
  if (!last) throw new Error(`recording ${recordingPath} has no getWeekStats response`)
  const lines = last.body as ProviderPlayerWeekStats[]
  const ids = [...new Set(lines.map((l) => l.playerId))]
  const byPosition = new Map<string, string[]>()
  for (const part of chunked(ids)) {
    const rows = must(await service.from('players').select('id, position').in('id', part), 'recorded players read')
    for (const row of rows ?? []) {
      const raw = String(row.position ?? '').toUpperCase()
      const pos = POSITION_OF[raw] ?? raw
      const list = byPosition.get(pos) ?? []
      list.push(row.id as string)
      byPosition.set(pos, list)
    }
  }
  for (const list of byPosition.values()) list.sort()
  return byPosition
}

/** Fill a lineup's starting slots from the per-position lists (rotated). */
export function buildLineups(
  slots: ReadonlyArray<{ key: string; eligible: readonly string[]; count: number }>,
  teams: readonly string[],
  byPosition: ReadonlyMap<string, readonly string[]>,
  rotate: number,
): Map<string, Record<string, string>> {
  const used = new Set<string>()
  const cursor = new Map<string, number>()
  const next = (eligible: readonly string[]): string | null => {
    for (const pos of eligible) {
      const list = byPosition.get(pos === 'DEF' ? 'DST' : pos) ?? []
      for (let tries = 0; tries < list.length; tries++) {
        const c = cursor.get(pos) ?? rotate % Math.max(1, list.length)
        cursor.set(pos, (c + 1) % list.length)
        const id = list[c]!
        if (!used.has(id)) {
          used.add(id)
          return id
        }
      }
    }
    return null
  }
  const out = new Map<string, Record<string, string>>()
  for (const team of teams) {
    const map: Record<string, string> = {}
    for (const slot of slots) {
      for (let i = 0; i < slot.count; i++) {
        const id = next(slot.eligible)
        if (id !== null) map[`${slot.key}:${i}`] = id
      }
    }
    out.set(team, map)
  }
  return out
}

async function seedInSeasonLeagues(
  service: Supabase,
  target: ResolvedTarget,
  profile: LoadProfile,
  runTag: string,
  recordingPath: string,
): Promise<LoadManifest> {
  const teams = profile.teamsPerLeague
  const bots = await provisionBots(target, service, teams, runTag)
  const template = await templateId(bots[0]!.client)
  const byPosition = await recordedPlayersByPosition(service, recordingPath)
  const settings = defaultsForTeamCount(teams)
  const slots = settings.roster_settings.starting_slots
  const week1 = syntheticNflWeeks(LOAD_SEASON)[LOAD_WEEK - 1]!
  const openAt = new Date(Date.parse(week1.starts_at) + 60_000).toISOString()
  const leagues: LoadManifest['leagues'] = []
  for (let l = 0; l < profile.leagues; l++) {
    const name = `${LOAD_LEAGUE_PREFIX}league ${l + 1} ${runTag}`
    const league = await createSeatedLeague(bots, name, LOAD_SEASON, settings, template.id)
    must(
      await service.from('leagues').update({ status: 'in_season', scoring_rules_snapshot: template.rules as never }).eq('id', league.leagueId).select('id'),
      'league → in_season',
    )
    must(await service.rpc('league_generate_schedule', { p_league_id: league.leagueId }), 'league_generate_schedule')
    const teamIds = bots.map((b) => league.teamByBot.get(b.index)!)
    const lineups = buildLineups(slots, teamIds, byPosition, l * 7)
    const rosterRows: Array<{ league_id: string; team_id: string; player_id: string }> = []
    const lineupRows: Array<Database['public']['Tables']['team_lineups']['Insert']> = []
    for (const [teamId, slotMap] of lineups) {
      for (const playerId of Object.values(slotMap)) rosterRows.push({ league_id: league.leagueId, team_id: teamId, player_id: playerId })
      lineupRows.push({ team_id: teamId, season: LOAD_SEASON, week: LOAD_WEEK, starters: [], bench: [], slot_map: slotMap })
    }
    must(await service.from('league_rosters').insert(rosterRows).select('id'), 'league_rosters insert')
    must(
      await service
        .from('league_player_pool')
        .insert(rosterRows.map((r) => ({ league_id: r.league_id, player_id: r.player_id, state: 'rostered' as const })))
        .select('player_id'),
      'league_player_pool insert',
    )
    must(await service.from('team_lineups').insert(lineupRows).select('id'), 'team_lineups insert')
    must(await service.rpc('league_week_advance', { p_now: openAt, p_league_id: league.leagueId }), 'league_week_advance (open week 1)')
    const week = mustRow(
      await service.from('league_weeks').select('status').eq('league_id', league.leagueId).eq('week', LOAD_WEEK).single(),
      'league week read',
    )
    if (week.status !== 'live') throw new Error(`league ${l + 1}: week ${LOAD_WEEK} is '${week.status as string}' after the open, not live`)
    leagues.push({ leagueId: league.leagueId, members: bots.map((b) => b.index) })
    console.log(`  seeded in-season league ${l + 1}/${profile.leagues}: ${teams} teams, ${rosterRows.length} rostered, week ${LOAD_WEEK} live`)
  }
  return manifest('leagues', profile, target, runTag, bots, [], leagues, [])
}

function manifest(
  scenario: SeedScenario,
  profile: LoadProfile,
  target: ResolvedTarget,
  runTag: string,
  bots: readonly Bot[],
  drafts: LoadManifest['drafts'],
  leagues: LoadManifest['leagues'],
  pool: string[],
): LoadManifest {
  return {
    version: 1,
    scenario,
    profile: profile.name,
    target: target.kind,
    runTag,
    createdAt: new Date().toISOString(),
    bots: bots.map(({ index, email, password, userId, username }) => ({ index, email, password, userId, username })),
    drafts,
    leagues,
    pool,
  }
}

/** The harness's own calendar (idempotent). Deleted by `--cleanup`. */
async function seedLoadSeason(service: Supabase): Promise<void> {
  must(
    await service.from('nfl_weeks').upsert(syntheticNflWeeks(LOAD_SEASON), { onConflict: 'season,week', ignoreDuplicates: true }).select('week'),
    'nfl_weeks (load season) upsert',
  )
}

// ---------------------------------------------------------------------------
// Cleanup + census
// ---------------------------------------------------------------------------

export interface CensusCell {
  what: string
  count: number
}

export async function census(service: Supabase): Promise<CensusCell[]> {
  const count = async (what: string, q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const { count: n, error } = await q
    if (error) throw new Error(`census ${what}: ${error.message}`)
    return { what, count: n ?? 0 }
  }
  const head = { count: 'exact' as const, head: true }
  return Promise.all([
    count('leagues', service.from('leagues').select('id', head).like('name', `${LOAD_LEAGUE_PREFIX}%`)),
    count('profiles', service.from('profiles').select('id', head).like('username', `${LOAD_USERNAME_PREFIX}%`)),
    count('player_stats', service.from('player_stats').select('player_id', head).eq('season', LOAD_SEASON)),
    count('score_fanout', service.from('score_fanout').select('player_id', head).eq('season', LOAD_SEASON)),
    count('stat_correction_events', service.from('stat_correction_events').select('id', head).eq('season', LOAD_SEASON)),
    count('nfl_games', service.from('nfl_games').select('id', head).like('id', `${LOAD_GAME_PREFIX}%`)),
    count('nfl_games(season)', service.from('nfl_games').select('id', head).eq('season', LOAD_SEASON)),
    count('nfl_weeks', service.from('nfl_weeks').select('week', head).eq('season', LOAD_SEASON)),
  ])
}

export function censusLine(cells: readonly CensusCell[]): string {
  const dirty = cells.filter((c) => c.count !== 0)
  return dirty.length === 0 ? `census CLEAN (0 × ${cells.length})` : `census DIRTY: ${dirty.map((c) => `${c.what}=${c.count}`).join(' ')}`
}

/** Sweep everything a load run made, in the sim's recorded FK order. */
export async function cleanup(service: Supabase): Promise<string> {
  const leagueRows = await pageAll<{ id: string }>((from, to) =>
    service.from('leagues').select('id', { count: 'exact' }).like('name', `${LOAD_LEAGUE_PREFIX}%`).order('id').range(from, to),
  )
  const ids = leagueRows.map((r) => r.id)
  if (ids.length > 0) {
    for (const part of chunked(ids)) must(await service.from('drafts').delete().in('league_id', part), 'drafts delete')
    const teamIds: string[] = []
    for (const part of chunked(ids)) {
      const rows = await pageAll<{ id: string }>((from, to) =>
        service.from('teams').select('id', { count: 'exact' }).in('league_id', part).order('id').range(from, to),
      )
      teamIds.push(...rows.map((t) => t.id))
    }
    for (const part of chunked(teamIds)) must(await service.from('team_lineups').delete().in('team_id', part), 'team_lineups delete')
    for (const table of [
      'trades',
      'lineup_actions',
      'team_week_results',
      'league_player_pool',
      'league_rosters',
      'transactions',
      'league_chat',
      'schedule_actions',
      'matchups',
      'league_weeks',
    ] as const) {
      for (const part of chunked(ids)) must(await service.from(table).delete().in('league_id', part), `${table} delete`)
    }
    for (const part of chunked(ids)) must(await service.from('leagues').update({ champion_team_id: null }).in('id', part), 'champion clear')
    for (const part of chunked(teamIds)) must(await service.from('teams').update({ league_id: null }).in('id', part), 'teams detach')
    for (const part of chunked(ids)) must(await service.from('leagues').delete().in('id', part), 'leagues delete')
    for (const part of chunked(teamIds)) must(await service.from('teams').delete().in('id', part), 'teams delete')
  }
  must(await service.from('score_fanout').delete().eq('season', LOAD_SEASON), 'score_fanout delete')
  must(await service.from('stat_correction_events').delete().eq('season', LOAD_SEASON), 'stat_correction_events delete')
  must(await service.from('player_stats').delete().eq('season', LOAD_SEASON), 'player_stats delete')
  must(await service.from('nfl_games').delete().eq('season', LOAD_SEASON), 'nfl_games delete (season)')
  must(await service.from('nfl_games').delete().like('id', `${LOAD_GAME_PREFIX}%`), 'nfl_games delete (prefix)')
  must(await service.from('nfl_weeks').delete().eq('season', LOAD_SEASON), 'nfl_weeks delete')
  const profiles = must(
    await service.from('profiles').select('id, username').like('username', `${LOAD_USERNAME_PREFIX}%`),
    'load-bot lookup',
  )
  for (const row of profiles ?? []) {
    const { error } = await service.auth.admin.deleteUser(row.id as string)
    if (error) throw new Error(`deleteUser ${row.username as string} failed: ${error.message}`)
  }
  const cells = await census(service)
  const line = censusLine(cells)
  if (cells.some((c) => c.count !== 0)) throw new Error(`cleanup did not finish — ${line}`)
  return `CLEANUP: ${ids.length} load league(s) + ${(profiles ?? []).length} load bot(s) swept · ${line}`
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Args {
  target: string | undefined
  profile: string | undefined
  scenario: string | undefined
  recording: string | undefined
  cleanup: boolean
  census: boolean
}

export function parseArgs(argv: readonly string[]): Args {
  const out: Args = { target: undefined, profile: undefined, scenario: undefined, recording: undefined, cleanup: false, census: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const value = (): string => {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`)
      return v
    }
    if (a === '--target') out.target = value()
    else if (a === '--profile') out.profile = value()
    else if (a === '--scenario') out.scenario = value()
    else if (a === '--recording') out.recording = value()
    else if (a === '--cleanup') out.cleanup = true
    else if (a === '--census') out.census = true
    else throw new Error(`unknown argument '${a}' (refused, never ignored)`)
  }
  return out
}

/** Default replay source for the leagues seed — see sunday-replay.ts. */
export const DEFAULT_RECORDING = 'fixtures/nfl/2026/wk02/synthetic.jsonl.gz'

export async function seed(target: ResolvedTarget, args: Args): Promise<LoadManifest> {
  const profile = resolveProfile(args.profile)
  const scenario = args.scenario
  if (scenario !== 'snake' && scenario !== 'auction' && scenario !== 'leagues') {
    throw new Error("--scenario is required: snake | auction | leagues")
  }
  const service = createClient<Database>(target.url, target.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  console.log(`seed-staging: ${sizeBanner(profile)} · scenario ${scenario} · target ${target.kind}`)
  console.log(`  ${await cleanup(service)} (sweep-first)`)
  await seedLoadSeason(service)
  const runTag = crypto.randomUUID().slice(0, 8)
  let m: LoadManifest
  try {
    m =
      scenario === 'leagues'
        ? await seedInSeasonLeagues(service, target, profile, runTag, args.recording ?? DEFAULT_RECORDING)
        : await seedDrafts(service, target, profile, scenario, runTag)
  } catch (e) {
    // A half-seeded target is swept, never left behind (loudly either way).
    console.error(`  seeding FAILED — sweeping what it made: ${(e as Error).message}`)
    console.error(`  ${await cleanup(service)}`)
    throw e
  }
  mkdirSync(resolve(process.cwd(), OUT_DIR), { recursive: true })
  writeFileSync(manifestPath(scenario), JSON.stringify(m, null, 2))
  console.log(`  manifest → ${OUT_DIR}/${scenario}.manifest.json (gitignored: it holds this run's bot passwords)`)
  return m
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const target = resolveTarget(args.target)
  const service = createClient<Database>(target.url, target.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  if (args.census) {
    console.log(censusLine(await census(service)))
    return
  }
  if (args.cleanup) {
    console.log(await cleanup(service))
    return
  }
  await seed(target, args)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  main().catch((e) => {
    console.error(`seed-staging: ${(e as Error).message}`)
    process.exit(1)
  })
}
