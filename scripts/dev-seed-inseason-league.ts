/**
 * dev-seed-inseason-league.ts — a deliberate LOCAL fixture for the in-season
 * UI (M4 task L.D5.1's browser pass; PROGRESS D316; extended by L.D5.3 for
 * the standings / schedule / Remix pass, D317; the ACTIVE-BUILD "LV fixture"
 * precedent — a documented local fixture, re-creatable after a
 * `supabase db reset`).
 *
 *   npx tsx scripts/dev-seed-inseason-league.ts            # seed (cleanup-first)
 *   npx tsx scripts/dev-seed-inseason-league.ts --teardown # remove it
 *
 * WHAT IT MAKES. One `in_season` league on the SYNTHETIC season (2099 —
 * F215: the calendar belongs to the fixture, not the clock) commissioned
 * and managed by `dev@fieldscout.local`, a second franchise seated by
 * `dev-pro@fieldscout.local` (so the commissioner arm — reason required —
 * is reachable from the dev account) plus six more franchises owned by
 * `dev-pro@` with no member seated (the engine refuses a half-seated
 * league — 110), the REAL generated season (`league_generate_schedule`,
 * service-driven exactly as `schedule-api-db.test.ts` drives it: 14 regular
 * + 3 playoff `league_weeks` rows and 56 regular matchups — L.D5.3), ten
 * synthetic players (`dev-ld51-*`, each on its own made-up NFL team so a
 * game row locks exactly one of them) rostered to the dev team with pool
 * rows, and TWO `nfl_games` rows on 2099 week 1: one that kicked off on a
 * fixed PAST literal (2001-09-09 — `dev-ld51-rb-locked` is LOCKED by §11.2)
 * and one on a fixed FUTURE literal (2099-09-13 — `dev-ld51-wr-a` is open).
 * Then `lineup_lock_tick` is run once for the league so the pool VIEW
 * (`league_player_pool.locked_until`, F241(d)'s `'infinity'` for the
 * locked player — the week's last game end is unrecorded) is populated
 * before the page is opened; pg_cron's `lineup-lock` job keeps it fresh
 * every minute after that.
 *
 * E41 ON THIS FIXTURE (L.D5.3). The PAST game row means the league's Week 1
 * has kicked off, so a Remix or a matchup edit is a commissioner OVERRIDE
 * (reason required) by default, and week 1 itself is frozen
 * (`week_kicked_off`) while weeks 2–14 regenerate. To walk the FREE window
 * first, move that kickoff ahead and back with psql:
 *   update nfl_games set kickoff_at = '2099-09-09T17:00:00Z' where id = 'dev-ld51-game-locked';
 *   update nfl_games set kickoff_at = '2001-09-09T17:00:00Z' where id = 'dev-ld51-game-locked';
 * (`lineup_lock_tick` re-evaluates the pool lock on its next minute either way.)
 *
 * LOCAL ONLY. Refuses any URL that is not the local stack — every sync
 * script loads `.env.local` (the hosted project) and the restore-dev
 * header records why that is a hazard. F199's census catches the ids by
 * their `dev-ld51-` prefix and the league by its name.
 *
 * L.D5.2 (the matchup view's browser pass) DRIVES this fixture through a
 * live week with `scripts/dev-drive-inseason-week.ts` (--open → --lineup →
 * --games → --score → --window → --finalize); its stat lines, queue rows,
 * third game row and the `nfl_weeks` end instants are cleaned here too.
 *
 * TEAR IT DOWN BEFORE `npm run test` (F199, measured 2026-09-05 by L.D5.3).
 * While resident it poisons the stack lane by TWO vectors: the players
 * carry a null ADP the lowest-ADP cells can pick (L.D5.1's finding), and
 * the two `nfl_games` rows sit on the SHARED synthetic season (2099, week
 * 1) — `schedule_window_internal` / the Q29 first-week mapping read that
 * week's earliest kickoff by (season, week), not by league, so with the
 * 2001 row present EVERY 2099 league in `schedule-api-db`,
 * `schedule-edit-api-db`, `schedule-property-db` and `week-workers-db`
 * sees its Week 1 already kicked off (8 cells red, all four green again
 * after `--teardown`). Re-seed after the run.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '../src/types/database'
import { defaultsForTeamCount, splitSettings } from '../src/lib/leagues/settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../src/lib/leagues/sim/synthetic-season'

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL)) {
  console.error(`refusing: ${URL} is not the local stack (this fixture is LOCAL ONLY)`)
  process.exit(2)
}

const LEAGUE_NAME = 'L.D5.1 dev fixture league'
const DEV = { email: 'dev@fieldscout.local', password: 'dev-password-1234' }
const DEV_PRO_EMAIL = 'dev-pro@fieldscout.local'
const GAME_LOCKED_ID = 'dev-ld51-game-locked'
const GAME_OPEN_ID = 'dev-ld51-game-open'
/** L.D5.2's third game row (`dev-drive-inseason-week.ts --games`): the
 *  QB's team, `final`, so the box shows Now playing / Done / Up next at
 *  once. Owned here for cleanup; created by the driver. */
const GAME_FINAL_ID = 'dev-ld52-game-final'
const KICKOFF_PAST = '2001-09-09T17:00:00.000Z'
const KICKOFF_FUTURE = '2099-09-13T17:00:00.000Z'
const ACTION_LEAGUE = 'd5100000-0000-4000-8000-000000000001'

const PLAYERS = [
  { id: 'dev-ld51-qb', full_name: 'Dev QB Fixture', position: 'QB', team: 'LDA', status: 'Active' },
  { id: 'dev-ld51-rb-locked', full_name: 'Dev RB Locked', position: 'RB', team: 'LDB', status: 'Active' },
  { id: 'dev-ld51-rb-open', full_name: 'Dev RB Open', position: 'RB', team: 'LDC', status: 'Active' },
  { id: 'dev-ld51-wr-a', full_name: 'Dev WR A', position: 'WR', team: 'LDD', status: 'Active' },
  { id: 'dev-ld51-wr-b', full_name: 'Dev WR B', position: 'WR', team: 'LDE', status: 'Active' },
  { id: 'dev-ld51-wr-c', full_name: 'Dev WR C', position: 'WR', team: 'LDF', status: 'Active' },
  { id: 'dev-ld51-te', full_name: 'Dev TE Fixture', position: 'TE', team: 'LDG', status: 'Active' },
  { id: 'dev-ld51-k', full_name: 'Dev K Fixture', position: 'K', team: 'LDH', status: 'Active' },
  { id: 'dev-ld51-dst', full_name: 'Dev DST Fixture', position: 'DEF', team: 'LDI', status: 'Active' },
  { id: 'dev-ld51-ir', full_name: 'Dev IR Fixture', position: 'RB', team: 'LDJ', status: 'IR' },
] as const

const service = createClient<Database>(URL, SERVICE_KEY, { auth: { persistSession: false } })

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').eq('name', LEAGUE_NAME)
  const ids = (stale ?? []).map((r) => r.id)
  if (ids.length > 0) {
    for (const table of ['lineup_actions', 'team_lineups'] as const) {
      // team_lineups is keyed by team; lineup_actions by league.
      if (table === 'team_lineups') {
        const { data: teams } = await service.from('teams').select('id').in('league_id', ids)
        const teamIds = (teams ?? []).map((t) => t.id)
        if (teamIds.length > 0) {
          const { error } = await service.from('team_lineups').delete().in('team_id', teamIds)
          if (error) throw new Error(`cleanup team_lineups: ${error.message}`)
        }
      } else {
        const { error } = await service.from(table).delete().in('league_id', ids)
        if (error) throw new Error(`cleanup ${table}: ${error.message}`)
      }
    }
    for (const table of ['team_week_results', 'league_player_pool', 'matchups', 'league_weeks', 'league_rosters', 'league_members', 'league_chat', 'schedule_actions'] as const) {
      const { error } = await service.from(table).delete().in('league_id', ids)
      if (error) throw new Error(`cleanup ${table}: ${error.message}`)
    }
    const { error: teamsError } = await service.from('teams').delete().in('league_id', ids)
    if (teamsError) throw new Error(`cleanup teams: ${teamsError.message}`)
    const { error: leaguesError } = await service.from('leagues').delete().in('id', ids)
    if (leaguesError) throw new Error(`cleanup leagues: ${leaguesError.message}`)
  }
  const { error: gamesError } = await service.from('nfl_games').delete().in('id', [GAME_LOCKED_ID, GAME_OPEN_ID, GAME_FINAL_ID])
  if (gamesError) throw new Error(`cleanup nfl_games: ${gamesError.message}`)
  // L.D5.2: the driver's stat lines + queue rows for the fixture players
  // (F199's census counts 2099 stamps to zero after a teardown).
  const { error: statsError } = await service.from('player_stats').delete().in('player_id', PLAYERS.map((p) => p.id))
  if (statsError) throw new Error(`cleanup player_stats: ${statsError.message}`)
  const { error: queueError } = await service.from('score_fanout').delete().in('player_id', PLAYERS.map((p) => p.id))
  if (queueError) throw new Error(`cleanup score_fanout: ${queueError.message}`)
  // The synthetic week-1 end instants the driver's --window wrote (the
  // seed leaves nfl_weeks 2099 as seedSyntheticSeason wrote it: NULL ends).
  const { error: weekError } = await service.from('nfl_weeks').update({ last_game_ends_at: null, first_kickoff_at: null }).eq('season', SYNTHETIC_SEASON).eq('week', 1)
  if (weekError) throw new Error(`cleanup nfl_weeks: ${weekError.message}`)
  const { error: playersError } = await service.from('players').delete().in('id', PLAYERS.map((p) => p.id))
  if (playersError) throw new Error(`cleanup players: ${playersError.message}`)
  console.log(`cleanup: ${ids.length} league(s) removed`)
}

async function userId(email: string): Promise<string> {
  const { data, error } = await service.auth.admin.listUsers({ perPage: 200 })
  if (error) throw new Error(`listUsers: ${error.message}`)
  const user = data.users.find((u) => u.email === email)
  if (!user) throw new Error(`no auth user ${email} — run npm run restore:dev first`)
  return user.id
}

async function seed(): Promise<void> {
  await cleanup()
  await seedSyntheticSeason(service)
  const devId = await userId(DEV.email)
  const proId = await userId(DEV_PRO_EMAIL)

  // The league is CREATED as dev@ through the real verb (so the commissioner
  // seat, the invite code and the settings blob are exactly production's).
  const dev: SupabaseClient<Database> = createClient<Database>(URL, ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await dev.auth.signInWithPassword(DEV)
  if (signInError) throw new Error(`sign-in as dev@: ${signInError.message}`)
  const settings = defaultsForTeamCount(8)
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([k, v]) => [`p_${k}`, v]))
  const { data: template } = await dev.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  const { data: created, error: createError } = await dev.rpc('create_league', {
    p_name: LEAGUE_NAME,
    p_season: SYNTHETIC_SEASON,
    p_scoring_system_id: template?.id,
    p_team_name: 'Dev Fixture FC',
    p_action_id: ACTION_LEAGUE,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league: ${createError.message}`)
  const leagueId = (created as { league_id: string }).league_id
  const { data: devTeam, error: devTeamError } = await service.from('teams').select('id').eq('league_id', leagueId).eq('owner_id', devId).single()
  if (devTeamError) throw new Error(`dev team: ${devTeamError.message}`)

  const { data: proTeam, error: proTeamError } = await service
    .from('teams')
    .insert({ owner_id: proId, name: 'Dev Pro Rivals', league_id: leagueId })
    .select('id')
    .single()
  if (proTeamError) throw new Error(`teams insert: ${proTeamError.message}`)
  // L.D5.3: the remaining six seats, so the engine's "every seat must exist"
  // check (110) passes and a real season can be generated. Unmanaged.
  const { error: seatsError } = await service
    .from('teams')
    .insert(Array.from({ length: 6 }, (_, i) => ({ owner_id: proId, name: `Dev Seat ${i + 3}`, league_id: leagueId })))
  if (seatsError) throw new Error(`teams insert (seats): ${seatsError.message}`)
  const { error: memberError } = await service.from('league_members').insert([{ league_id: leagueId, user_id: proId, team_id: proTeam.id, role: 'manager' }])
  if (memberError) throw new Error(`league_members: ${memberError.message}`)

  const { error: seasonError } = await service
    .from('leagues')
    .update({ status: 'in_season', scoring_rules_snapshot: template?.rules ?? null })
    .eq('id', leagueId)
  if (seasonError) throw new Error(`leagues → in_season: ${seasonError.message}`)
  // L.D5.3: the REAL season — `league_generate_schedule` writes the
  // `league_weeks` ladder (14 regular + 3 playoff weeks at the 8-team
  // defaults) and every regular matchup, seeded on `schedule_seed`. It is
  // REVOKEd from `authenticated` (110:812 — the completion path's), so the
  // service client drives it, as the stack suites do.
  const { data: generated, error: genError } = await service.rpc('league_generate_schedule', { p_league_id: leagueId })
  if (genError) throw new Error(`league_generate_schedule: ${genError.message}`)

  const { error: playersError } = await service.from('players').upsert([...PLAYERS])
  if (playersError) throw new Error(`players: ${playersError.message}`)
  const { error: rosterError } = await service
    .from('league_rosters')
    .insert(PLAYERS.map((p) => ({ league_id: leagueId, team_id: devTeam.id, player_id: p.id })))
  if (rosterError) throw new Error(`league_rosters: ${rosterError.message}`)
  const { error: poolError } = await service
    .from('league_player_pool')
    .insert(PLAYERS.map((p) => ({ league_id: leagueId, player_id: p.id, state: 'rostered' })))
  if (poolError) throw new Error(`league_player_pool: ${poolError.message}`)

  const { error: gamesError } = await service.from('nfl_games').insert([
    { id: GAME_LOCKED_ID, season: SYNTHETIC_SEASON, week: 1, home_team: 'LDB', away_team: 'ZZZ', kickoff_at: KICKOFF_PAST },
    { id: GAME_OPEN_ID, season: SYNTHETIC_SEASON, week: 1, home_team: 'LDD', away_team: 'ZZY', kickoff_at: KICKOFF_FUTURE },
  ])
  if (gamesError) throw new Error(`nfl_games: ${gamesError.message}`)

  // The pool VIEW, populated once now (the cron job refreshes it every
  // minute after this). Service role: no auth.uid(), which is the job's
  // in-body condition.
  const { data: tick, error: tickError } = await service.rpc('lineup_lock_tick', {
    p_now: new Date().toISOString(),
    p_league_id: leagueId,
  })
  if (tickError) throw new Error(`lineup_lock_tick: ${tickError.message}`)

  console.log(JSON.stringify({ leagueId, devTeamId: devTeam.id, proTeamId: proTeam.id, generated, tick }, null, 2))
  console.log(`\nopen: http://localhost:3123/app/leagues/${leagueId}/team/${devTeam.id}`)
  console.log(`      http://localhost:3123/app/leagues/${leagueId}/schedule`)
  console.log(`      http://localhost:3123/app/leagues/${leagueId}/standings`)
  console.log(`      http://localhost:3123/app/leagues/${leagueId}/matchup`)
}

const teardown = process.argv.includes('--teardown')
;(teardown ? cleanup() : seed()).catch((e) => {
  console.error(e)
  process.exit(1)
})
