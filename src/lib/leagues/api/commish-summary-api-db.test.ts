/**
 * commish-summary-api-db.test.ts — M6 L.E1.32 against the LOCAL Supabase
 * stack through PostgREST, with real signed-in clients (the
 * `commish-part2-api-db.test.ts` rig; D455):
 *
 *   - **`GET /commish/summary` — the gate on the real predicates**: a
 *     seated MANAGER gets this read's own 403 (`is_league_commish` false);
 *     an authenticated NON-MEMBER gets the family's one no-leak 403, the
 *     same answer a nonexistent league gives (`is_league_member` false).
 *   - **An empty league** (just created: one managed team, no schedule, no
 *     weeks, no trades): every section `ok` and empty.
 *   - **The sections, composed over the real reads**: D339's no-manager
 *     predicate with 139's switch (a placeholder seat listed; the one the
 *     real `commish_set_autopilot` put on autopilot not); a trade in review
 *     under the commissioner mode listed and an open offer not, and nothing
 *     listed once the league votes instead; every matchup of the LIVE week
 *     answered by the real lock door (135 / 142) with its refusal sentence
 *     byte-equal to the matchup panel's own read of it, and no matchup of
 *     the FINAL week asked about.
 *   - **`GET /commish/log`'s filters on the real table**: `type`, `team_id`
 *     (the three places a receipt names a team — shapes measured over
 *     pgTAP 118's matrix world), `week` (`metadata.week`, never
 *     `current_week`), a filter combination, another league's team refused
 *     by name, and a one-row-per-page walk of a TEAM-filtered log serving
 *     each matching row exactly once — the proof that PostgREST ANDs the
 *     team's `or` tree with the cursor's rather than one replacing the other.
 *
 * Requires the local stack — D59(5) precedent; FAILS loudly when the stack
 * is down, never skips (§4.3). CALENDAR (F215/F226): `SYNTHETIC_SEASON`
 * (2099), no game rows; no clock is read (the summary's `now` is a fixed
 * instant passed in). Determinism: FIXED emails / usernames / action ids +
 * cleanup-first. Id prefix `c32` — this suite owns it (measured free
 * 2026-09-30 by grep over src/, supabase/tests/, e2e/).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Json } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { COMMISH_LOG_UNKNOWN_TEAM_MESSAGE, readCommishLog, type CommishLogPage } from './commish-log-service'
import { readCommishMatchupEditLock, type CommishMatchupEditLock } from './commish-matchup-service'
import { COMMISH_SUMMARY_FORBIDDEN_MESSAGE, readCommishSummary, type CommishSummary } from './commish-summary-service'
import { INSEASON_READ_FORBIDDEN_MESSAGE } from './inseason-reads'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-commish-summary-api-league'
const TEAM_COUNT = 8
const NOW = new Date('2099-10-04T20:00:00.000Z')

const COMMISH = { email: 'commish-summary-commish@fieldscout.test', password: 'pgtap-c32-api-pass-1', username: 'c32_commish_one' }
const MEMBER = { email: 'commish-summary-member@fieldscout.test', password: 'pgtap-c32-api-pass-2', username: 'c32_member_two' }
const OUTSIDER = { email: 'commish-summary-outsider@fieldscout.test', password: 'pgtap-c32-api-pass-3', username: 'c32_outsider_three' }

const ACTION = {
  league: 'c3200000-0000-4000-8000-000000000001',
  emptyLeague: 'c3200000-0000-4000-8000-000000000002',
  autopilot: 'c3200000-0000-4000-8000-000000000011',
  tradeInReview: 'c3200000-0000-4000-8000-000000000021',
  tradeOffer: 'c3200000-0000-4000-8000-000000000022',
} as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

let commishClient: SupabaseClient<Database>
let memberClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let commishId: string
let leagueId: string
let emptyLeagueId: string
let commishTeam: string
let memberTeam: string
let seatA: string // placeholder seat, autopilot off
let seatB: string // placeholder seat, put on autopilot by the real verb
let emptyCommishTeam: string

function errorText(result: { body: unknown }): string {
  return JSON.stringify(result.body)
}

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) {
    await service.auth.admin.deleteUser(row.id)
  }
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    for (const table of ['transactions', 'league_player_pool', 'league_chat', 'matchups', 'league_weeks', 'league_rosters', 'league_members'] as const) {
      const { error } = await service.from(table).delete().in('league_id', ids)
      if (error) throw new Error(`cleanup ${table}: ${error.message}`)
    }
    // F406's order (170 / D451): receipts and trades point at teams with no
    // ON DELETE and ride the league's CASCADE — detach the teams, delete the
    // league, THEN delete the teams.
    const { data: teams, error: teamsReadError } = await service.from('teams').select('id').in('league_id', ids)
    if (teamsReadError) throw new Error(`cleanup teams read: ${teamsReadError.message}`)
    const teamIds = (teams ?? []).map((row) => row.id)
    const { error: detachError } = await service.from('teams').update({ league_id: null }).in('id', teamIds)
    if (detachError) throw new Error(`cleanup teams detach: ${detachError.message}`)
    const { error: leaguesError } = await service.from('leagues').delete().in('id', ids)
    if (leaguesError) throw new Error(`cleanup leagues: ${leaguesError.message}`)
    const { error: teamsError } = await service.from('teams').delete().in('id', teamIds)
    if (teamsError) throw new Error(`cleanup teams: ${teamsError.message}`)
  }
  for (const u of [COMMISH, MEMBER, OUTSIDER]) {
    await deleteUserByUsername(u.username)
  }
}

async function createUser(user: { email: string; password: string; username: string }): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { username: user.username },
  })
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`)
  return data.user.id
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

async function createLeague(name: string, actionId: string): Promise<{ leagueId: string; commishTeam: string }> {
  const settings = defaultsForTeamCount(TEAM_COUNT)
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: template } = await commishClient.from('scoring_systems').select('id, rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  const { data: created, error } = await commishClient.rpc('create_league', {
    p_name: name,
    p_season: SYNTHETIC_SEASON,
    p_scoring_system_id: template?.id,
    p_team_name: 'Commish Team',
    p_action_id: actionId,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (error) throw new Error(`create_league failed: ${error.message}`)
  const id = (created as { league_id: string }).league_id
  const { data: team, error: teamError } = await service.from('teams').select('id').eq('league_id', id).eq('owner_id', commishId).single()
  if (teamError) throw new Error(`commish team read: ${teamError.message}`)
  return { leagueId: id, commishTeam: team.id }
}

/** Plant one receipt in the shape a verb writes (measured over pgTAP 118's
 *  matrix world, 2026-09-30). One statement each ⇒ distinct `created_at`,
 *  in insertion order. The service role bypasses RLS; 123's triggers guard
 *  UPDATE / DELETE / TRUNCATE, not INSERT. */
async function plant(row: {
  tag: string
  action_type: string
  target_type: string
  target_id: string
  acting_as_team_id?: string | null
  metadata: Record<string, Json>
}): Promise<string> {
  const { data, error } = await service
    .from('commissioner_actions')
    .insert({
      league_id: leagueId,
      actor_id: commishId,
      action_type: row.action_type,
      target_type: row.target_type,
      target_id: row.target_id,
      reason: null,
      acting_as_team_id: row.acting_as_team_id ?? null,
      metadata: { ...row.metadata, probe: row.tag },
    })
    .select('id')
    .single()
  if (error) throw new Error(`plant ${row.tag}: ${error.message}`)
  return data.id
}

async function logOf(client: SupabaseClient<Database>, query: Record<string, string>): Promise<CommishLogPage> {
  const res = await readCommishLog(client, leagueId, query)
  expect(res.status, errorText(res)).toBe(200)
  return res.body as unknown as CommishLogPage
}

/** The `probe` tag (or the verb, for a real receipt) of each row, in order. */
const tags = (page: CommishLogPage) =>
  page.items.map((i) => ((i.metadata as { probe?: string; verb?: string } | null)?.probe ?? (i.metadata as { verb?: string }).verb ?? i.action_type))

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  commishId = await createUser(COMMISH)
  const memberId = await createUser(MEMBER)
  await createUser(OUTSIDER)
  commishClient = await signIn(COMMISH)
  memberClient = await signIn(MEMBER)
  outsiderClient = await signIn(OUTSIDER)

  ;({ leagueId: emptyLeagueId, commishTeam: emptyCommishTeam } = await createLeague(`${LEAGUE_NAME}-empty`, ACTION.emptyLeague))
  ;({ leagueId, commishTeam } = await createLeague(LEAGUE_NAME, ACTION.league))

  const { data: seats, error: seatError } = await service
    .from('teams')
    .insert([
      { owner_id: commishId, name: 'C32 Member Team', league_id: leagueId },
      { owner_id: commishId, name: 'C32 Seat A', league_id: leagueId },
      { owner_id: commishId, name: 'C32 Seat B', league_id: leagueId },
      ...[5, 6, 7, 8].map((n) => ({ owner_id: commishId, name: `C32 Filler ${n}`, league_id: leagueId })),
    ])
    .select('id, name')
  if (seatError) throw new Error(`teams insert: ${seatError.message}`)
  const byName = new Map(seats!.map((s) => [s.name, s.id]))
  memberTeam = byName.get('C32 Member Team')!
  seatA = byName.get('C32 Seat A')!
  seatB = byName.get('C32 Seat B')!

  // One league_members row per seat (§12.2): the member seated, the two
  // placeholders unmanaged (add_placeholder_seat's shape — 063).
  const { error: memberError } = await service.from('league_members').insert([
    { league_id: leagueId, user_id: memberId, team_id: memberTeam, role: 'manager' },
    { league_id: leagueId, user_id: null, team_id: seatA, role: 'manager', is_placeholder: true },
    { league_id: leagueId, user_id: null, team_id: seatB, role: 'manager', is_placeholder: true },
  ])
  if (memberError) throw new Error(`league_members insert: ${memberError.message}`)
  // Four filler seats (the league minimum is eight teams): unmanaged too,
  // but switched ON directly (fixture only — no receipt, so the log below
  // holds only the rows this suite names), so they need nothing.
  const fillers = seats!.filter((s) => s.name.startsWith('C32 Filler')).map((s) => s.id)
  const { error: fillerSeatError } = await service
    .from('league_members')
    .insert(fillers.map((team_id) => ({ league_id: leagueId, user_id: null, team_id, role: 'manager', is_placeholder: true })))
  if (fillerSeatError) throw new Error(`filler league_members insert: ${fillerSeatError.message}`)
  const { error: fillerSwitchError } = await service
    .from('team_autopilot')
    .insert(fillers.map((team_id) => ({ team_id, is_on: true, set_at: '2099-09-01T00:00:00.000Z' })))
  if (fillerSwitchError) throw new Error(`filler team_autopilot insert: ${fillerSwitchError.message}`)

  const { data: template } = await service.from('scoring_systems').select('rules').eq('is_template', true).eq('name', 'ESPN Standard').single()
  const { error: seasonError } = await service
    .from('leagues')
    .update({ status: 'in_season', scoring_rules_snapshot: template?.rules ?? null })
    .eq('id', leagueId)
  if (seasonError) throw new Error(`leagues → in_season: ${seasonError.message}`)
  const { error: genError } = await service.rpc('league_generate_schedule', { p_league_id: leagueId })
  if (genError) throw new Error(`league_generate_schedule: ${genError.message}`)

  // Week 1 is being played; week 3 is final (always correctable — not
  // "needs you"). 056's transition trigger allows only the forward steps,
  // so each week walks them (the schedule wrote every week `upcoming`).
  for (const [week, steps] of [
    [1, ['live']],
    [3, ['live', 'correction_window', 'final']],
  ] as const) {
    for (const status of steps) {
      const { error } = await service.from('league_weeks').update({ status }).eq('league_id', leagueId).eq('season', SYNTHETIC_SEASON).eq('week', week)
      if (error) throw new Error(`league_weeks week ${week} → ${status}: ${error.message}`)
    }
  }

  // Seat B goes on autopilot through the REAL verb (its receipt is real too).
  const { error: autopilotError } = await commishClient.rpc('commish_set_autopilot', {
    p_league_id: leagueId,
    p_team_id: seatB,
    p_on: true,
    p_action_id: ACTION.autopilot,
  })
  if (autopilotError) throw new Error(`commish_set_autopilot: ${autopilotError.message}`)

  // Two trades as 148 / 151 store them: one in review, one open offer.
  const { error: tradesError } = await service.from('trades').insert([
    {
      league_id: leagueId,
      proposer_team_id: memberTeam,
      recipient_team_id: commishTeam,
      status: 'in_review',
      proposed_by: memberId,
      accepted_at: '2099-10-04T12:00:00.000Z',
      accepted_by: commishId,
      review_deadline: '2099-10-05T12:00:00.000Z',
      action_id: ACTION.tradeInReview,
    },
    { league_id: leagueId, proposer_team_id: commishTeam, recipient_team_id: memberTeam, status: 'proposed', proposed_by: commishId, action_id: ACTION.tradeOffer },
  ])
  if (tradesError) throw new Error(`trades insert: ${tradesError.message}`)

  // THE PREMISES, asserted (§4 rule 14(c)) — an UPDATE that matched no row
  // would not have errored above, so the statuses are read back by value.
  const { data: weekStates } = await service.from('league_weeks').select('week, status').eq('league_id', leagueId).in('week', [1, 2, 3]).order('week')
  expect(weekStates).toStrictEqual([
    { week: 1, status: 'live' },
    { week: 2, status: 'upcoming' },
    { week: 3, status: 'final' },
  ])
  const { data: autopilot } = await service.from('team_autopilot').select('team_id, is_on').in('team_id', [seatA, seatB])
  expect(autopilot).toStrictEqual([{ team_id: seatB, is_on: true }])
  const { data: review } = await service.from('leagues').select('trade_review').eq('id', leagueId).single()
  expect(review?.trade_review).toBe('commissioner')
  const { data: week1 } = await service.from('matchups').select('id').eq('league_id', leagueId).eq('week', 1)
  expect((week1 ?? []).length).toBeGreaterThan(0)
  const { data: week3 } = await service.from('matchups').select('id').eq('league_id', leagueId).eq('week', 3)
  expect((week3 ?? []).length).toBeGreaterThan(0)
}, 90_000)

afterAll(async () => {
  await cleanup()
  const { data: leagues } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  expect(leagues ?? []).toHaveLength(0)
  for (const u of [COMMISH, MEMBER, OUTSIDER]) {
    const { data } = await service.from('profiles').select('id').eq('username', u.username)
    expect(data ?? [], u.username).toHaveLength(0)
  }
})

// ---------------------------------------------------------------------------
// 1. GET /commish/summary
// ---------------------------------------------------------------------------

describe('GET …/commish/summary — readCommishSummary over the real stack', () => {
  it('a seated MANAGER gets this read’s own 403 (is_league_commish false) — no section reaches him', async () => {
    const res = await readCommishSummary(memberClient, leagueId, 'ignored', NOW)
    expect(res).toStrictEqual({ status: 403, body: { error: COMMISH_SUMMARY_FORBIDDEN_MESSAGE } })
  })

  it('an authenticated NON-MEMBER gets the family’s one no-leak 403 — byte-equal to the answer for a league that does not exist', async () => {
    const res = await readCommishSummary(outsiderClient, leagueId, 'ignored', NOW)
    expect(res).toStrictEqual({ status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } })
    expect(await readCommishSummary(outsiderClient, '00000000-0000-4000-8000-000000000000', 'ignored', NOW)).toStrictEqual(res)
  })

  it('AN EMPTY LEAGUE (just created — one managed team, no schedule, no weeks, no trades): every section ok and empty', async () => {
    const res = await readCommishSummary(commishClient, emptyLeagueId, commishId, NOW)
    expect(res.status, errorText(res)).toBe(200)
    const summary = res.body as unknown as CommishSummary
    expect(summary).toStrictEqual({
      league_id: emptyLeagueId,
      season: SYNTHETIC_SEASON,
      // R1364: the literal a new league stands in — create_league (118:2224)
      // sets no status, so `leagues.status`' column default applies.
      league_status: 'setup',
      evaluated_at: NOW.toISOString(),
      sections: {
        unmanaged_teams: { state: 'ok', teams: [], no_seat_row: [] },
        trades_awaiting_review: { state: 'ok', review_mode: 'commissioner', trades: [] },
        matchup_corrections: { state: 'ok', weeks: [], can_correct_now: [], not_yet: [] },
      },
    })
    expect(emptyCommishTeam).toBeTruthy()
  })

  it('the sections, composed over the real reads: the unmanaged autopilot-off seat; the trade in review (not the offer); the live week’s matchups with the lock door’s own sentence; nothing from the final week', async () => {
    const res = await readCommishSummary(commishClient, leagueId, commishId, NOW)
    expect(res.status, errorText(res)).toBe(200)
    const { sections } = res.body as unknown as CommishSummary

    expect(sections.unmanaged_teams).toStrictEqual({ state: 'ok', teams: [{ team_id: seatA, name: 'C32 Seat A', status: 'active' }], no_seat_row: [] })

    expect(sections.trades_awaiting_review.state).toBe('ok')
    if (sections.trades_awaiting_review.state !== 'ok') throw new Error('unreachable')
    expect(sections.trades_awaiting_review.review_mode).toBe('commissioner')
    expect(sections.trades_awaiting_review.trades.map((t) => [t.status, t.proposer.team_id, t.recipient.team_id])).toStrictEqual([['in_review', memberTeam, commishTeam]])
    expect(sections.trades_awaiting_review.trades[0].review).toStrictEqual({ mode: 'commissioner', ends_at: expect.any(String), ms_remaining: 16 * 3_600_000 })

    expect(sections.matchup_corrections.state).toBe('ok')
    if (sections.matchup_corrections.state !== 'ok') throw new Error('unreachable')
    const mc = sections.matchup_corrections
    expect(mc.weeks).toStrictEqual([1])
    const { data: week1 } = await service.from('matchups').select('id').eq('league_id', leagueId).eq('week', 1).order('id')
    expect(mc.can_correct_now).toStrictEqual([])
    expect(mc.not_yet.map((m) => m.matchup_id).sort()).toStrictEqual((week1 ?? []).map((m) => m.id).sort())
    for (const item of mc.not_yet) {
      expect(item.week).toBe(1)
      // The sentence is the door's, byte-equal to the matchup panel's own read.
      const panel = await readCommishMatchupEditLock(commishClient, leagueId, { matchup_id: item.matchup_id })
      expect(panel.status, errorText(panel)).toBe(200)
      const lock = panel.body as unknown as CommishMatchupEditLock
      expect(lock.editable).toBe(false)
      expect(item.why).toBe(lock.why)
      expect(item.message).toBe(lock.message)
      expect(item.message).toBeTruthy()
    }
  })

  it('once the league votes on trades instead, nothing waits on the commissioner — the list empties and says the mode', async () => {
    const { error } = await service.from('leagues').update({ trade_review: 'league_vote' }).eq('id', leagueId)
    if (error) throw new Error(`trade_review → league_vote: ${error.message}`)
    try {
      const res = await readCommishSummary(commishClient, leagueId, commishId, NOW)
      expect(res.status, errorText(res)).toBe(200)
      expect((res.body as unknown as CommishSummary).sections.trades_awaiting_review).toStrictEqual({ state: 'ok', review_mode: 'league_vote', trades: [] })
    } finally {
      const { error: back } = await service.from('leagues').update({ trade_review: 'commissioner' }).eq('id', leagueId)
      if (back) throw new Error(`trade_review → commissioner: ${back.message}`)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. GET /commish/log — the filters on the real table
// ---------------------------------------------------------------------------

describe('GET …/commish/log — the L.E1.32 filters over the real table', () => {
  beforeAll(async () => {
    // Oldest → newest, after the real set_autopilot receipt.
    await plant({ tag: 'r1-score', action_type: 'edit_score', target_type: 'matchup', target_id: 'c3200000-0000-4000-8000-0000000000f1', metadata: { week: 1, affected_team_ids: [commishTeam, memberTeam] } })
    await plant({ tag: 'r2-lineup-member', action_type: 'edit_lineup', target_type: 'team', target_id: memberTeam, acting_as_team_id: memberTeam, metadata: { week: 2, current_week: 2 } })
    await plant({ tag: 'r3-lineup-own', action_type: 'edit_lineup', target_type: 'team', target_id: commishTeam, metadata: { week: 1, current_week: 1 } })
    await plant({ tag: 'r4-setting', action_type: 'change_setting', target_type: 'setting', target_id: 'waiver_type', metadata: {} })
    await plant({ tag: 'r5-move', action_type: 'move_player', target_type: 'player', target_id: 'c32-player', metadata: { current_week: 1, affected_team_ids: [seatA, memberTeam] } })
    await plant({ tag: 'r6-trade', action_type: 'accept_trade', target_type: 'trade', target_id: 'c3200000-0000-4000-8000-0000000000f6', acting_as_team_id: seatA, metadata: { affected_team_ids: [seatA, commishTeam] } })
    // PREMISE: the whole log is exactly these six plus the real autopilot receipt.
    expect(tags(await logOf(commishClient, {}))).toStrictEqual(['r6-trade', 'r5-move', 'r4-setting', 'r3-lineup-own', 'r2-lineup-member', 'r1-score', 'commish_set_autopilot'])
  })

  it('type: one action type, then a list — only those rows, newest first, the filter echoed', async () => {
    const one = await logOf(commishClient, { type: 'edit_lineup' })
    expect(tags(one)).toStrictEqual(['r3-lineup-own', 'r2-lineup-member'])
    expect(one.filters).toStrictEqual({ type: ['edit_lineup'], team_id: null, week: null })
    expect(tags(await logOf(commishClient, { type: 'edit_lineup,edit_score' }))).toStrictEqual(['r3-lineup-own', 'r2-lineup-member', 'r1-score'])
    const none = await logOf(commishClient, { type: 'edit_faab' })
    expect(none.items).toStrictEqual([])
    expect(none.has_more).toBe(false)
  })

  it('team_id: every row that names the team — as the one acted for, the target, or among the affected — and none that does not', async () => {
    expect(tags(await logOf(commishClient, { team_id: memberTeam }))).toStrictEqual(['r5-move', 'r2-lineup-member', 'r1-score'])
    expect(tags(await logOf(commishClient, { team_id: commishTeam }))).toStrictEqual(['r6-trade', 'r3-lineup-own', 'r1-score'])
    expect(tags(await logOf(commishClient, { team_id: seatA }))).toStrictEqual(['r6-trade', 'r5-move'])
    // The real verb's receipt: target team + affected_team_ids.
    expect(tags(await logOf(commishClient, { team_id: seatB }))).toStrictEqual(['commish_set_autopilot'])
  })

  it('week: `metadata.week` — the week the verb acted on; a row with only `current_week` is in no week', async () => {
    expect(tags(await logOf(commishClient, { week: '1' }))).toStrictEqual(['r3-lineup-own', 'r1-score'])
    expect(tags(await logOf(commishClient, { week: '2' }))).toStrictEqual(['r2-lineup-member'])
    expect((await logOf(commishClient, { week: '9' })).items).toStrictEqual([])
  })

  it('filters combine (AND): the member’s team in week 1 is the score fix alone', async () => {
    const page = await logOf(commishClient, { team_id: memberTeam, week: '1', type: 'edit_score,edit_lineup' })
    expect(tags(page)).toStrictEqual(['r1-score'])
    expect(page.filters).toStrictEqual({ type: ['edit_score', 'edit_lineup'], team_id: memberTeam, week: 1 })
  })

  it('A TEAM-FILTERED LOG PAGES ONE ROW AT A TIME, EACH MATCHING ROW EXACTLY ONCE — the team’s `or` tree and the cursor’s are both applied (neither replaces the other)', async () => {
    const seen: string[] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await logOf(commishClient, { team_id: memberTeam, limit: '1', ...(cursor ? { cursor } : {}) })
      expect(page.items.length).toBeLessThanOrEqual(1)
      seen.push(...tags(page))
      if (!page.has_more) break
      cursor = page.next_cursor!
    }
    expect(seen).toStrictEqual(['r5-move', 'r2-lineup-member', 'r1-score'])
  })

  it('any MEMBER reads a filtered log (the log is member-readable, §10.3); a non-member gets the no-leak 403; another league’s team is a 404 by name', async () => {
    expect(tags(await logOf(memberClient, { team_id: memberTeam }))).toStrictEqual(['r5-move', 'r2-lineup-member', 'r1-score'])
    expect(await readCommishLog(outsiderClient, leagueId, { team_id: memberTeam })).toStrictEqual({ status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } })
    expect(await readCommishLog(commishClient, leagueId, { team_id: emptyCommishTeam })).toStrictEqual({ status: 404, body: { error: COMMISH_LOG_UNKNOWN_TEAM_MESSAGE } })
  })
})
