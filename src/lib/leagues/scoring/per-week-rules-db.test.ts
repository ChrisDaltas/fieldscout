/**
 * per-week-rules-db.test.ts — F397 + Q69 end to end over the REAL local stack
 * (M6A L.E1.27, migration 144; PROGRESS F397 / F404 / Q69 / D382; spec §7.3.3
 * / §10.1 / §15.4). Chris's rulings (2026-09-27): "F397 yes build it" — each
 * league week stores the rules it is played with, and the worker, the box
 * score and the nightly reconcile read THAT; "Q69 keep last week's scores" —
 * a week in its stat-correction window is not re-scored by a scoring change.
 *
 * THE STORY (2099 synthetic weeks 1–3; every instant a literal; a
 * VirtualClock; one h2h league, two seats, ESPN Standard):
 *   PW1  weeks 1–2 are scored under ESPN STANDARD through the real worker;
 *        week 1 walks to FINAL, week 2 sits in its CORRECTION WINDOW.
 *   PW2  the commissioner switches to ESPN FULL PPR with re-score ON, through
 *        the real verb. Nothing is being played (week 3 has not opened), so
 *        nothing is re-scored; weeks 1 and 2 are named as kept.
 *   PW3  weeks 1–2: stored scores unchanged, stored rules still Standard, box
 *        scores Standard (= the stored scores), reconcile CLEAN.
 *   PW4  week 3 opens through the real `league_week_advance` and takes PPR;
 *        the worker scores it under PPR.
 *   PW5  a stat correction to week 2 (still in its window) re-scores it under
 *        STANDARD — not PPR — and the box and reconcile agree.
 *   PW6  (the task's (e) — MEASURED here first, then RULED: F405, Chris
 *        2026-09-28, built by M5 L.D3.11 / migration 158) a stat correction
 *        to FINAL week 1 after its window: the worker keeps the stored score
 *        (week_final); the box reads the per-player points stored WITH that
 *        score, so it still shows 11.00 — its lines add up to the final
 *        score — and reconcile names the moved line `post_window_correction`
 *        [INFO], exact (no warn). (Before 158 the box showed 12.00 here.)
 *
 * Requires the local stack — D59(5); FAILS loudly when it is down. Fixture
 * hygiene (F199): players / stats / queue rows carry the `vitest-pwr`
 * prefix, the league its name; cleanup-first and after. Action-id prefix
 * `3b2` (measured free 2026-09-27).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import { readBoxScore, type TeamBoxScore } from '../api/box-score-service'
import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { VirtualClock } from '../time/virtual-clock'
import { type ReconcileReport, reconcileSeason } from './reconcile'
import { runScoreWeekBatch } from './score-week-worker'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PREFIX = 'vitest-pwr'
const SEASON = SYNTHETIC_SEASON
const COMMISH = { email: 'per-week-rules-commish@fieldscout.test', password: 'pgtap-pwr-pass-1', username: 'pwr_commish_one' }
const ACTION = {
  league: '3b200000-0000-4000-8000-000000000001',
  ppr: '3b200000-0000-4000-8000-000000000002',
} as const

const WR1 = `${PREFIX}-wr1`
const WR2 = `${PREFIX}-wr2`
const PLAYERS = [
  { id: WR1, full_name: 'PWR Receiver One', position: 'WR', team: 'PWA', status: 'Active' },
  { id: WR2, full_name: 'PWR Receiver Two', position: 'WR', team: 'PWB', status: 'Active' },
]

/** Stat stamps, each inside its week (2099 week N starts Wed 04:00Z; windows close the next Thu 10:00Z). */
const STAMP = { 1: '2099-09-13T21:00:00.000Z', 2: '2099-09-20T21:00:00.000Z', 3: '2099-09-27T21:00:00.000Z' } as const
/** Week 3's start (the open instant) and a correction for week 2 while its window is still open (closes 2099-09-24 10:00Z). */
const WEEK3_OPEN = '2099-09-23T04:00:00.000Z'
const WEEK2_CORRECTION = '2099-09-23T12:00:00.000Z'
/** After week 1's window closed (2099-09-17 10:00Z): a correction the worker no longer applies. */
const WEEK1_LATE_CORRECTION = '2099-09-23T13:00:00.000Z'

/** ESPN Standard for a WR: 0.1 / receiving yard, 6 / TD, 0 / reception. Full PPR: + 1 / reception. */
const LINES = {
  1: { [WR1]: { receptions: 5, receiving_yards: 50, receiving_tds: 1 }, [WR2]: { receptions: 3, receiving_yards: 40 } }, // Std 11 / 4 · PPR 16 / 7
  2: { [WR1]: { receptions: 6, receiving_yards: 70 }, [WR2]: { receptions: 4, receiving_yards: 90, receiving_tds: 1 } }, // Std 7 / 15 · PPR 13 / 19
  3: { [WR1]: { receptions: 8, receiving_yards: 100 }, [WR2]: { receptions: 2, receiving_yards: 20 } }, // Std 10 / 2 · PPR 18 / 4
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const clock = new VirtualClock(new Date('2099-09-14T12:00:00.000Z'))

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) await service.auth.admin.deleteUser(row.id)
}

async function cleanup(): Promise<void> {
  await must(service.from('score_fanout').delete().like('player_id', `${PREFIX}-%`), 'cleanup score_fanout')
  await must(service.from('player_stats').delete().like('player_id', `${PREFIX}-%`), 'cleanup player_stats')
  const { data: stale } = await service.from('leagues').select('id').like('name', `${PREFIX}-%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    const { data: teams } = await service.from('teams').select('id').in('league_id', ids)
    const teamIds = (teams ?? []).map((t) => t.id)
    if (teamIds.length > 0) await must(service.from('team_lineups').delete().in('team_id', teamIds), 'cleanup team_lineups')
    for (const table of ['transactions', 'team_week_results', 'matchups', 'league_weeks', 'league_player_pool', 'league_rosters', 'league_chat', 'league_members'] as const) {
      await must(service.from(table).delete().in('league_id', ids), `cleanup ${table}`)
    }
    await must(service.from('teams').delete().in('league_id', ids), 'cleanup teams')
    await must(service.from('leagues').delete().in('id', ids), 'cleanup leagues')
  }
  await must(service.from('players').delete().like('id', `${PREFIX}-%`), 'cleanup players')
  await deleteUserByUsername(COMMISH.username)
}

let leagueId: string
let t1: string
let t2: string
let commishClient: SupabaseClient<Database>
const matchupIds: Record<number, string> = {}

async function plant(week: 1 | 2 | 3, lines: Record<string, Record<string, number>>, stamp: string): Promise<void> {
  const rows = Object.entries(lines).map(([player_id, columns]) => ({
    player_id,
    season: SEASON,
    week,
    stat_type: 'weekly',
    updated_at: stamp,
    advanced: {},
    receptions: 0,
    receiving_yards: 0,
    receiving_tds: 0,
    ...columns,
  }))
  await must(service.from('player_stats').upsert(rows, { onConflict: 'player_id,season,week' }).select('player_id'), `plant wk ${week}`)
  await must(
    service
      .from('score_fanout')
      .upsert(rows.map((r) => ({ season: SEASON, week, player_id: r.player_id, enqueued_at: stamp, deferred_until: null })), { onConflict: 'season,week,player_id', ignoreDuplicates: false })
      .select('player_id'),
    `enqueue wk ${week}`,
  )
}

function drain() {
  return runScoreWeekBatch({ time: clock, db: service }, { batchSize: 1000, leagueIds: [leagueId] })
}

async function stored(week: number): Promise<[number | null, number | null]> {
  const row = await must(service.from('matchups').select('home_score, away_score').eq('id', matchupIds[week]).single(), 'matchup read')
  return [row!.home_score === null ? null : Number(row!.home_score), row!.away_score === null ? null : Number(row!.away_score)]
}

async function box(week: number, team: string): Promise<number | null> {
  const result = await readBoxScore(commishClient, leagueId, { week: String(week), team })
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  return (result.body as unknown as TeamBoxScore).points
}

async function weekRules(week: number): Promise<{ name: string | null; source: string | null; status: string }> {
  const row = await must(service.from('league_weeks').select('status, scoring_rules_source, scoring_system_id').eq('league_id', leagueId).eq('week', week).single(), `week ${week} rules`)
  const name = row!.scoring_system_id === null ? null : (await must(service.from('scoring_systems').select('name').eq('id', row!.scoring_system_id).single(), 'system name'))!.name
  return { name, source: row!.scoring_rules_source, status: row!.status }
}

function reconcile(): Promise<ReconcileReport> {
  return reconcileSeason({ time: clock, db: service }, { season: SEASON, leagueIds: [leagueId] })
}

async function step(week: number, to: 'live' | 'correction_window' | 'final'): Promise<void> {
  await must(service.from('league_weeks').update({ status: to }).eq('league_id', leagueId).eq('week', week), `week ${week} → ${to}`)
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)
  const { data: created, error: userError } = await service.auth.admin.createUser({ email: COMMISH.email, password: COMMISH.password, email_confirm: true, user_metadata: { username: COMMISH.username } })
  if (userError) throw new Error(`createUser: ${userError.message}`)
  const commishId = created.user.id
  commishClient = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await commishClient.auth.signInWithPassword({ email: COMMISH.email, password: COMMISH.password })
  if (signInError) throw new Error(`sign-in: ${signInError.message}`)
  await must(service.from('players').upsert(PLAYERS).select('id'), 'players')

  const { columns, blob } = splitSettings(defaultsForTeamCount(8))
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: std } = await commishClient.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  const { data: league, error } = await commishClient.rpc('create_league', {
    p_name: `${PREFIX}-league`,
    p_season: SEASON,
    p_scoring_system_id: std?.id,
    p_team_name: 'PWR One',
    p_action_id: ACTION.league,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (error) throw new Error(`create_league: ${error.message}`)
  leagueId = (league as { league_id: string }).league_id
  t1 = (await must(service.from('teams').select('id').eq('league_id', leagueId).single(), 'team one'))!.id
  t2 = (await must(service.from('teams').insert({ owner_id: commishId, name: 'PWR Two', league_id: leagueId }).select('id').single(), 'team two'))!.id
  await must(service.from('leagues').update({ status: 'in_season', scoring_rules_snapshot: std!.rules as Json }).eq('id', leagueId), 'league → in_season')
  await must(service.from('league_weeks').insert([1, 2, 3].map((week) => ({ league_id: leagueId, season: SEASON, week }))), 'weeks 1-3')
  for (const week of [1, 2, 3]) {
    const m = await must(
      service.from('matchups').insert({ league_id: leagueId, season: SEASON, week, round_type: 'regular', home_team_id: t1, away_team_id: t2, status: week === 3 ? 'scheduled' : 'live' }).select('id').single(),
      `matchup wk ${week}`,
    )
    matchupIds[week] = m!.id
  }
  await must(service.from('league_rosters').insert([{ league_id: leagueId, team_id: t1, player_id: WR1 }, { league_id: leagueId, team_id: t2, player_id: WR2 }]), 'rosters')
  await must(
    service.from('team_lineups').insert(
      [1, 2, 3].flatMap((week) => [
        { team_id: t1, season: SEASON, week, starters: [], bench: [], slot_map: { 'wr:0': WR1 } },
        { team_id: t2, season: SEASON, week, starters: [], bench: [], slot_map: { 'wr:0': WR2 } },
      ]),
    ),
    'lineups wk 1-3',
  )
}, 60_000)

afterAll(cleanup)

describe('F397 + Q69 end to end: each week is scored, box-scored and reconciled under ITS OWN rules', () => {
  it('PW1 weeks 1–2 are scored under ESPN STANDARD by the real worker; week 1 walks to final, week 2 to its correction window — each week stored the rules it opened with', async () => {
    await step(1, 'live')
    await plant(1, LINES[1], STAMP[1])
    expect((await drain()).written).toBe(1)
    expect(await stored(1)).toEqual([11, 4])
    await step(1, 'correction_window')
    await step(1, 'final')
    await step(2, 'live')
    await plant(2, LINES[2], STAMP[2])
    expect((await drain()).written).toBe(1)
    expect(await stored(2)).toEqual([7, 15])
    await step(2, 'correction_window')
    expect(await weekRules(1)).toEqual({ name: 'ESPN Standard', source: 'week_open', status: 'final' })
    expect(await weekRules(2)).toEqual({ name: 'ESPN Standard', source: 'week_open', status: 'correction_window' })
    expect(await weekRules(3)).toEqual({ name: null, source: null, status: 'upcoming' })
  })

  it('PW2 the commissioner switches to ESPN FULL PPR with re-score ON while week 2 is in its correction window — it lands, re-scores nothing (no week is being played), and names week 1 (final) and week 2 (pending corrections) as kept', async () => {
    const { data: ppr } = await commishClient.from('scoring_systems').select('id').eq('is_template', true).eq('name', 'ESPN Full PPR').single()
    const { data: doc, error } = await commishClient.rpc('commish_change_setting', {
      p_league_id: leagueId,
      p_key: 'scoring_system_id',
      p_value: ppr!.id as unknown as Json,
      p_rescore: true,
      p_action_id: ACTION.ppr,
    })
    expect(error).toBeNull()
    const result = doc as { no_changes: boolean; rescore_performed: boolean; rescore_skipped_final_weeks: number[]; rescore_skipped_correction_window_weeks: number[]; rescore_not_performed_why: string }
    expect(result.no_changes).toBe(false)
    expect(result.rescore_skipped_final_weeks).toEqual([1])
    expect(result.rescore_skipped_correction_window_weeks).toEqual([2])
    expect(result.rescore_performed).toBe(false)
    expect(result.rescore_not_performed_why).toBe(
      'no_live_week — no week is being played right now, so nothing is re-scored: week 1 (final) and week 2 (final, pending stat corrections) keep their scores and results, and every later week is scored under the new scoring when it opens',
    )
    // Under 141 (F404) week 2 would have been re-queued and re-scored under PPR here.
    expect(await must(service.from('score_fanout').select('player_id').like('player_id', `${PREFIX}-%`), 'queue')).toEqual([])
  })

  it('PW3 weeks 1–2 STAY ON STANDARD: stored scores unchanged, stored rules unchanged, box scores = the stored scores, reconcile CLEAN', async () => {
    expect(await stored(1)).toEqual([11, 4])
    expect(await stored(2)).toEqual([7, 15])
    expect((await weekRules(1)).name).toBe('ESPN Standard')
    expect((await weekRules(2)).name).toBe('ESPN Standard')
    // Under PPR these would read 16 / 7 and 13 / 19 — the box uses each week's OWN rules.
    expect([await box(1, t1), await box(1, t2), await box(2, t1), await box(2, t2)]).toEqual([11, 4, 7, 15])
    const report = await reconcile()
    expect(report.findings.filter((f) => f.league_id === leagueId && ['drift', 'snapshot_unscorable', 'pending_vs_stored'].includes(f.kind))).toEqual([])
  })

  it('PW4 week 3 OPENS through the real league_week_advance and takes FULL PPR; the worker scores it under PPR (18 / 4 — Standard would be 10 / 2)', async () => {
    clock.advanceTo(new Date(WEEK3_OPEN))
    const { data: adv, error } = await service.rpc('league_week_advance', { p_now: WEEK3_OPEN, p_league_id: leagueId })
    expect(error).toBeNull()
    expect((adv as { opened: number }).opened).toBe(1)
    expect(await weekRules(3)).toEqual({ name: 'ESPN Full PPR', source: 'week_open', status: 'live' })
    await plant(3, LINES[3], STAMP[3])
    expect((await drain()).written).toBe(1)
    expect(await stored(3)).toEqual([18, 4])
    expect([await box(3, t1), await box(3, t2)]).toEqual([18, 4])
  })

  it('PW5 a STAT CORRECTION to week 2 (still in its window) re-scores it under STANDARD — 8.00, not PPR 15.00 — and the box and reconcile agree', async () => {
    clock.advanceTo(new Date(WEEK2_CORRECTION))
    await plant(2, { [WR1]: { receptions: 7, receiving_yards: 80 } }, WEEK2_CORRECTION)
    const batch = await drain()
    expect(batch.written).toBe(1)
    const wk2 = batch.leagues.find((l) => l.league_id === leagueId && l.week === 2)!
    expect(wk2.outcome).toBe('written')
    expect(await stored(2)).toEqual([8, 15])
    expect(await box(2, t1)).toBe(8)
    expect((await weekRules(2)).name).toBe('ESPN Standard')
    const report = await reconcile()
    expect(report.findings.filter((f) => f.league_id === leagueId && ['drift', 'snapshot_unscorable'].includes(f.kind))).toEqual([])
  })

  it('PW6 (F405 as ruled — 158): a stat correction to FINAL week 1 after its window is NOT applied (week_final) — the box reads the STORED per-player points, so it still adds up to the stored 11.00; reconcile names the moved line post_window_correction [info], exact', async () => {
    clock.advanceTo(new Date(WEEK1_LATE_CORRECTION))
    await plant(1, { [WR1]: { receptions: 5, receiving_yards: 60, receiving_tds: 1 } }, WEEK1_LATE_CORRECTION)
    const batch = await drain()
    expect(batch.written).toBe(0)
    expect(batch.problems).toContain(`[${leagueId} wk 1] league ${leagueId} week 1 skipped: week_final`)
    expect(await stored(1)).toEqual([11, 4])
    expect(await box(1, t1)).toBe(11)
    const report = await reconcile()
    const late = report.findings.filter((f) => f.league_id === leagueId && f.kind === 'post_window_correction')
    // recomputed = Σ of the STORED rows (11) — the exact check; the moved line is named in the message.
    expect(late.map((f) => [f.week, f.team_id, f.severity, f.stored, f.recomputed])).toEqual([[1, t1, 'info', 11, 11]])
    expect(late[0].message).toContain(`${WR1} (wr:0) stored 11, today's stats 12`)
    expect(report.findings.filter((f) => f.league_id === leagueId && f.kind === 'drift')).toEqual([])
  })
})
