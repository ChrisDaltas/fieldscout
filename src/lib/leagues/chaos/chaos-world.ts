/**
 * chaos-world — the shared fixture plumbing of M7 L.F2.3's drills
 * (`*-db.test.ts` beside this file; PROGRESS D760–D765; the PR #540 fix round D766).
 *
 * NAMESPACE (the shared-local-DB rule). Everything a drill makes is named
 * `chaos-f23…` (leagues, test players, game ids), its users are
 * `chaos_f23_…` on the reserved `fieldscout.test` domain, and every NFL row
 * lives in season **2072** (measured unused). `sweep()` removes exactly
 * those, in the sim's recorded FK order (`runner.ts` `cleanupSweep`), and
 * every drill sweeps before and after itself. A drill never resets the
 * database and never stops a service.
 *
 * LOCAL ONLY. The URL and keys are the local stack's (the D59(5) stack-lane
 * defaults); `runReconcileCli` passes them to the CLI explicitly and checks
 * the CLI printed the local URL, so a stray `.env.local` can never point a
 * drill at a hosted project.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

export const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
export const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
export const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

export const CHAOS_PREFIX = 'chaos-f23'
export const CHAOS_USER_PREFIX = 'chaos_f23_'
export const CHAOS_SEASON = 2072

export type Supabase = SupabaseClient<Database>

export function serviceClient(): Supabase {
  return createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

/** `must` for a read that has to return a row — null is a loud failure, never an empty success. */
export async function mustRow<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<NonNullable<T>> {
  const data = await must(p, what)
  if (data === null || data === undefined) throw new Error(`${what}: no row`)
  return data as NonNullable<T>
}

/** Attempt-counted wait (no wall-clock read — the D3 guard covers this tree). */
export async function waitFor<T>(probe: () => T | undefined | Promise<T | undefined>, timeoutMs: number, label: string, stepMs = 100): Promise<T> {
  const attempts = Math.ceil(timeoutMs / stepMs)
  for (let i = 0; i < attempts; i++) {
    const value = await probe()
    if (value !== undefined) return value
    await sleep(stepMs)
  }
  throw new Error(`chaos: timed out after ~${timeoutMs} ms waiting for ${label}`)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export interface ChaosUser {
  key: string
  email: string
  password: string
  username: string
  userId: string
}

/** Create a confirmed test user (`chaos_f23_<tag>`). */
export async function createChaosUser(service: Supabase, tag: string): Promise<ChaosUser> {
  const username = `${CHAOS_USER_PREFIX}${tag}`
  const email = `${username.replace(/_/g, '-')}@fieldscout.test`
  const password = `chaos-f23-${tag}-${crypto.randomUUID()}`
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username } })
  if (error) throw new Error(`createUser ${username}: ${error.message}`)
  return { key: tag, email, password, username, userId: data.user.id }
}

const CHUNK = 200
function chunked<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK))
  return out
}

/** Every row a chaos drill can have made — counted per surface (0 everywhere = clean). */
export async function census(service: Supabase): Promise<Record<string, number>> {
  const count = async (p: PromiseLike<{ count: number | null; error: { message: string } | null }>, what: string) => {
    const { count: n, error } = await p
    if (error) throw new Error(`census ${what}: ${error.message}`)
    return n ?? 0
  }
  return {
    leagues: await count(service.from('leagues').select('id', { count: 'exact', head: true }).like('name', `${CHAOS_PREFIX}%`), 'leagues'),
    players: await count(service.from('players').select('id', { count: 'exact', head: true }).like('id', `${CHAOS_PREFIX}%`), 'players'),
    nfl_games: await count(service.from('nfl_games').select('id', { count: 'exact', head: true }).like('id', `${CHAOS_PREFIX}%`), 'nfl_games'),
    nfl_weeks: await count(service.from('nfl_weeks').select('week', { count: 'exact', head: true }).eq('season', CHAOS_SEASON), 'nfl_weeks'),
    player_stats: await count(service.from('player_stats').select('id', { count: 'exact', head: true }).eq('season', CHAOS_SEASON), 'player_stats'),
    score_fanout: await count(service.from('score_fanout').select('player_id', { count: 'exact', head: true }).eq('season', CHAOS_SEASON), 'score_fanout'),
    stat_correction_events: await count(
      service.from('stat_correction_events').select('id', { count: 'exact', head: true }).eq('season', CHAOS_SEASON),
      'stat_correction_events',
    ),
    users: await count(service.from('profiles').select('id', { count: 'exact', head: true }).like('username', `${CHAOS_USER_PREFIX.replace(/_/g, '\\_')}%`), 'users'),
  }
}

/**
 * Remove everything a chaos drill made — the sim's FK order (F406: detach
 * the teams, delete the leagues so their cascade takes the audit rows, then
 * the teams), then the season-keyed surfaces, the test players and users.
 */
export async function sweep(service: Supabase): Promise<void> {
  const leagues = await must(service.from('leagues').select('id').like('name', `${CHAOS_PREFIX}%`), 'sweep: leagues')
  const ids = (leagues ?? []).map((l) => l.id)
  const teamIds: string[] = []
  for (const part of chunked(ids)) {
    const teams = await must(service.from('teams').select('id').in('league_id', part), 'sweep: teams')
    teamIds.push(...(teams ?? []).map((t) => t.id))
  }
  for (const part of chunked(ids)) await must(service.from('drafts').delete().in('league_id', part), 'sweep: drafts')
  for (const part of chunked(teamIds)) await must(service.from('team_lineups').delete().in('team_id', part), 'sweep: team_lineups')
  for (const table of [
    'trades',
    'lineup_actions',
    'league_stat_corrections',
    'league_week_player_points',
    'team_week_results',
    'league_player_pool',
    'waiver_claims',
    'waiver_runs',
    'league_rosters',
    'transactions',
    'league_chat',
    'schedule_actions',
    'matchups',
    'league_weeks',
  ] as const) {
    for (const part of chunked(ids)) await must(service.from(table).delete().in('league_id', part), `sweep: ${table}`)
  }
  for (const part of chunked(ids)) await must(service.from('leagues').update({ champion_team_id: null }).in('id', part), 'sweep: champion clear')
  for (const part of chunked(teamIds)) await must(service.from('teams').update({ league_id: null }).in('id', part), 'sweep: teams detach')
  for (const part of chunked(ids)) await must(service.from('leagues').delete().in('id', part), 'sweep: leagues')
  for (const part of chunked(teamIds)) await must(service.from('teams').delete().in('id', part), 'sweep: teams')
  for (const table of ['score_fanout', 'stat_correction_events', 'player_stats'] as const) {
    await must(service.from(table).delete().eq('season', CHAOS_SEASON), `sweep: ${table}`)
  }
  await must(service.from('nfl_games').delete().like('id', `${CHAOS_PREFIX}%`), 'sweep: nfl_games')
  await must(service.from('nfl_weeks').delete().eq('season', CHAOS_SEASON), 'sweep: nfl_weeks')
  await must(service.from('players').delete().like('id', `${CHAOS_PREFIX}%`), 'sweep: players')
  const users = await must(service.from('profiles').select('id').like('username', `${CHAOS_USER_PREFIX.replace(/_/g, '\\_')}%`), 'sweep: users')
  for (const u of users ?? []) {
    const { error } = await service.auth.admin.deleteUser(u.id)
    if (error) throw new Error(`sweep: deleteUser ${u.id}: ${error.message}`)
  }
}

/** The CLI the drills' "reconcile exit 0" runs (a stack-lane dependency — db.yml watches it, F290). */
const RECONCILE_CLI = resolve(__dirname, '../../../../scripts/reconcile.ts')

export interface ReconcileCliResult {
  /** The CLI's exit status — 0 = no alert (§24.1 "reconciliation drift: 0 cells"). */
  status: number | null
  stdout: string
  stderr: string
  /** The JSON summary the CLI prints last. */
  summary: { leagues: number; league_weeks: number; cells: number; alerts: number; warns: number; infos: number; reason: string | null } | null
}

/**
 * Run `npm run reconcile`'s script (`scripts/reconcile.ts`) against the LOCAL
 * stack for the chaos season, scoped to the drill's leagues — the drill's
 * "reconcile exit 0" is this process's exit status.
 */
export function runReconcileCli(leagueIds: readonly string[]): ReconcileCliResult {
  const args = ['tsx', RECONCILE_CLI, String(CHAOS_SEASON), ...leagueIds.flatMap((id) => ['--league', id])]
  const res = spawnSync('npx', args, {
    cwd: resolve(__dirname, '../../../..'),
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: LOCAL_URL, SUPABASE_SERVICE_ROLE_KEY: LOCAL_SERVICE_ROLE_KEY },
    encoding: 'utf8',
    timeout: 120_000,
  })
  const stdout = res.stdout ?? ''
  if (!stdout.includes(`against ${LOCAL_URL}`)) {
    throw new Error(`reconcile CLI did not run against the local stack — refusing to read it as a result:\n${stdout}\n${res.stderr ?? ''}`)
  }
  const jsonStart = stdout.lastIndexOf('\n{')
  let summary: ReconcileCliResult['summary'] = null
  if (jsonStart >= 0) {
    try {
      summary = JSON.parse(stdout.slice(jsonStart + 1)) as ReconcileCliResult['summary']
    } catch {
      summary = null
    }
  }
  return { status: res.status, stdout, stderr: res.stderr ?? '', summary }
}
