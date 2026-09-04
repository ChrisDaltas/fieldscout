/**
 * transactions-api-db.test.ts — L.D4.2 items 1 & 3 at the SERVICE layer:
 * `POST /api/leagues/[id]/transactions` and `GET /api/leagues/[id]/activity`
 * against the LOCAL Supabase stack through PostgREST — the production wire
 * path — with real signed-in clients (the `members-api-db.test.ts` shape).
 *
 * pgTAP 061 covers `roster_add_drop`'s LAW DB-side at injected instants (E32
 * both sides, caps, fa_hold, exclusivity, the lineup consequences);
 * `roster-add-drop-db.test.ts` covers the raw verb under real concurrency.
 * What THIS suite proves is the layer those two do not touch:
 *
 *   - the auth matrix a route can get wrong (outsider · a fellow manager ·
 *     the COMMISSIONER acting on another team — all one no-leak 403);
 *   - **that a refusal REACHES THE CALLER AS ITS REASON** (F227(f)) — the
 *     exclusivity message names the holding team, the unknown-player message
 *     names the id — never swallowed into a generic failure, never a raw
 *     `duplicate key` string;
 *   - the SQLSTATE → HTTP contract (42501 → 403 · P0001 → 409 · 22023 → 400);
 *   - the `action_id` round trip: a replay of the SAME submit is
 *     byte-identical, and a REUSE of the id for a different move is refused
 *     rather than answered 200 with a move the caller never made (F65(b)) —
 *     **including when the caller sends the uuids UPPERCASE**, which
 *     `z.uuid()` accepts and Postgres never returns (R768);
 *   - **the F227(f) render duties**: `drop.lineups[]` entries are `{week,
 *     slot}` and only that, with `slot: null` for a bench-only touch (R758),
 *     no `kept_in_locked_lineup` key anywhere (R760), and
 *     `caps.used_*_after` real numbers on a DROP-ONLY move (R763);
 *   - the activity feed over the same data: filters, paging, and a
 *     non-member reading nothing.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5) precedent; FAILS loudly when the stack is down, never skips (§4.3).
 *
 * CALENDAR (F215/F226 — every fixture that evaluates a kickoff owns its
 * calendar): the league lives on `SYNTHETIC_SEASON` (2099), whose
 * `nfl_weeks` rows are seeded idempotently. NO `nfl_games` rows are placed
 * and every player carries a made-up NFL abbreviation, so E32 reads the week
 * datum (2099, always ahead) and nothing is ever locked — the locks are 061's
 * subject, not this suite's. No `DRAFT_INSTANT`: the league is set
 * `in_season` directly, so pg_cron's `draft_tick` has nothing to start.
 *
 * Determinism: FIXED emails/usernames/action_ids + cleanup-first (the D3/D17
 * ESLint bans cover `src/lib/leagues/**`). Action-id prefix `af7` — this
 * suite owns it (the D108(14) registry: af0–af6 taken, af7 measured free
 * 2026-09-03).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
import { readActivity } from './activity-service'
import {
  ADD_DROP_ACTION_ID_REUSED_MESSAGE,
  ADD_DROP_FORBIDDEN_MESSAGE,
  submitAddDrop,
} from './transactions-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-txn-api-league'

const COMMISH = {
  email: 'txn-api-commish@fieldscout.test',
  password: 'pgtap-txn-api-pass-1',
  username: 'tx_commish_one',
}
const MANAGER_A = {
  email: 'txn-api-manager-a@fieldscout.test',
  password: 'pgtap-txn-api-pass-2',
  username: 'tx_manager_a',
}
const MANAGER_B = {
  email: 'txn-api-manager-b@fieldscout.test',
  password: 'pgtap-txn-api-pass-3',
  username: 'tx_manager_b',
}
const OUTSIDER = {
  email: 'txn-api-outsider@fieldscout.test',
  password: 'pgtap-txn-api-pass-4',
  username: 'tx_outsider_four',
}

/** The suite's OWN synthetic players on made-up NFL abbreviations, so no
 *  real game row can ever lock them (the roster-add-drop-db shape). */
const PLAYERS = [
  { id: 'vitest-tx-p1', full_name: 'Vitest TX One', position: 'WR', team: 'VTA', status: 'Active' },
  { id: 'vitest-tx-p2', full_name: 'Vitest TX Two', position: 'RB', team: 'VTB', status: 'Active' },
  { id: 'vitest-tx-p3', full_name: 'Vitest TX Three', position: 'TE', team: 'VTC', status: 'Active' },
] as const
const P1 = 'vitest-tx-p1'
const P2 = 'vitest-tx-p2'
const P3 = 'vitest-tx-p3'

const ACTION = {
  league: 'af700000-0000-4000-8000-000000000001',
  addP1: 'af700000-0000-4000-8000-000000000011',
  dropP1: 'af700000-0000-4000-8000-000000000012',
  addP2A: 'af700000-0000-4000-8000-000000000013',
  addP2B: 'af700000-0000-4000-8000-000000000014',
  unknown: 'af700000-0000-4000-8000-000000000015',
  sameBoth: 'af700000-0000-4000-8000-000000000016',
  outsider: 'af700000-0000-4000-8000-000000000017',
  commish: 'af700000-0000-4000-8000-000000000018',
  fellow: 'af700000-0000-4000-8000-000000000019',
  addP3: 'af700000-0000-4000-8000-00000000001a',
  /** R768's fixture: sent UPPERCASE on the wire. */
  upperReuse: 'af700000-0000-4000-8000-00000000001c',
} as const

/** Two system posts written at ONE instant — R770's paging fixture. The
 *  literal is the form Postgres RENDERS (trailing zeros trimmed from the
 *  fractional second), because the cursor the feed hands back is the value it
 *  read, not the value this file wrote. The fraction is deliberate: `.` is
 *  structural in a PostgREST filter string, so a timestamp carrying one is
 *  the case the quoting has to survive. */
const TIE_INSTANT = '2098-06-01T12:00:00.5+00:00'
const TIE_POSTS = [
  { id: 'af700000-0000-4000-8000-0000000000a1', message: 'Tie post A (older id)' },
  { id: 'af700000-0000-4000-8000-0000000000a2', message: 'Tie post B (newer id)' },
] as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

interface Refusal {
  error: string
}

let commishClient: SupabaseClient<Database>
let managerAClient: SupabaseClient<Database>
let managerBClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let leagueId: string
let teamAId: string
let teamBId: string
let currentWeek: number

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
    // `team_lineups` is keyed on TEAM, not league — release it before the
    // teams go (the D306(6) order, extended for this suite's fixture).
    const { data: teamRows } = await service.from('teams').select('id').in('league_id', ids)
    const teamIds = (teamRows ?? []).map((row) => row.id)
    if (teamIds.length > 0) {
      const { error } = await service.from('team_lineups').delete().in('team_id', teamIds)
      if (error) throw new Error(`cleanup team_lineups: ${error.message}`)
    }
    for (const table of [
      'transactions',
      'league_player_pool',
      'league_chat',
      'matchups',
      'league_weeks',
      'league_rosters',
      'league_members',
    ] as const) {
      const { error } = await service.from(table).delete().in('league_id', ids)
      if (error) throw new Error(`cleanup ${table}: ${error.message}`)
    }
    const { error: teamsError } = await service.from('teams').delete().in('league_id', ids)
    if (teamsError) throw new Error(`cleanup teams: ${teamsError.message}`)
    const { error: leaguesError } = await service.from('leagues').delete().in('id', ids)
    if (leaguesError) throw new Error(`cleanup leagues: ${leaguesError.message}`)
  }
  const { error: playersError } = await service
    .from('players')
    .delete()
    .in(
      'id',
      PLAYERS.map((p) => p.id),
    )
  if (playersError) throw new Error(`cleanup players: ${playersError.message}`)
  for (const u of [COMMISH, MANAGER_A, MANAGER_B, OUTSIDER]) {
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

async function seatManager(userId: string, name: string): Promise<string> {
  const { data: team, error: teamError } = await service
    .from('teams')
    .insert({ owner_id: userId, name, league_id: leagueId })
    .select('id')
    .single()
  if (teamError) throw new Error(`teams insert: ${teamError.message}`)
  const { error: memberError } = await service
    .from('league_members')
    .insert({ league_id: leagueId, user_id: userId, team_id: team.id, role: 'manager' })
  if (memberError) throw new Error(`league_members insert: ${memberError.message}`)
  return team.id
}

beforeAll(async () => {
  await cleanup()
  await seedSyntheticSeason(service)

  await createUser(COMMISH)
  const managerAId = await createUser(MANAGER_A)
  const managerBId = await createUser(MANAGER_B)
  await createUser(OUTSIDER)
  commishClient = await signIn(COMMISH)
  managerAClient = await signIn(MANAGER_A)
  managerBClient = await signIn(MANAGER_B)
  outsiderClient = await signIn(OUTSIDER)

  const settings = defaultsForTeamCount(8)
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(Object.entries(columns).map(([key, value]) => [`p_${key}`, value]))
  const { data: template } = await commishClient
    .from('scoring_systems')
    .select('id, rules')
    .eq('is_template', true)
    .eq('name', 'ESPN Standard')
    .single()
  const { data: created, error: createError } = await commishClient.rpc('create_league', {
    p_name: LEAGUE_NAME,
    p_season: SYNTHETIC_SEASON,
    p_scoring_system_id: template?.id,
    p_team_name: 'Commish Team',
    p_action_id: ACTION.league,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id

  teamAId = await seatManager(managerAId, 'Manager A Team')
  teamBId = await seatManager(managerBId, 'Manager B Team')

  const { error: seasonError } = await service
    .from('leagues')
    .update({ status: 'in_season', scoring_rules_snapshot: template?.rules ?? null })
    .eq('id', leagueId)
  if (seasonError) throw new Error(`leagues → in_season: ${seasonError.message}`)
  const { error: weeksError } = await service
    .from('league_weeks')
    .insert([1, 2, 3].map((week) => ({ league_id: leagueId, season: SYNTHETIC_SEASON, week })))
  if (weeksError) throw new Error(`league_weeks insert: ${weeksError.message}`)

  const { error: playersError } = await service.from('players').upsert([...PLAYERS])
  if (playersError) throw new Error(`players upsert: ${playersError.message}`)
}, 60_000)

afterAll(async () => {
  await cleanup()
})

// ---------------------------------------------------------------------------
// 1. The happy path, and the week the whole suite keys on
// ---------------------------------------------------------------------------

describe('POST …/transactions — the manager makes a move', () => {
  it('adds a free agent and answers 200 with 113\'s payload whole', async () => {
    const result = await submitAddDrop(managerAClient, leagueId, {
      team_id: teamAId,
      add_player_id: P1,
      action_id: ACTION.addP1,
    })
    expect(result.status).toBe(200)
    const body = result.body as Record<string, unknown>
    expect(body.add_player_id).toBe(P1)
    expect(body.drop_player_id).toBeNull()
    expect(body.team_id).toBe(teamAId)
    expect(body.action_id).toBe(ACTION.addP1)
    expect(body.type).toBe('add_drop')
    // The caps document reaches the client — F227(f)'s render duty.
    expect(body.caps).toMatchObject({ used_week_after: 1, used_season_after: 1 })
    // …and the add landed on the bench (§13.1).
    expect((body.add as Record<string, unknown>).slot_key).toBe('bn')

    currentWeek = body.week as number
    expect(currentWeek).toBeGreaterThanOrEqual(1)
    expect(currentWeek).toBeLessThanOrEqual(2) // week+1 must still be a seeded week
  })

  it('replays the SAME submit byte-identically — a retry is never a second move', async () => {
    const first = await submitAddDrop(managerAClient, leagueId, {
      team_id: teamAId,
      add_player_id: P1,
      action_id: ACTION.addP1,
    })
    expect(first.status).toBe(200)
    const { count, error } = await service
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .eq('action_id', ACTION.addP1)
    if (error) throw new Error(`transactions count: ${error.message}`)
    expect(count).toBe(1)
  })

  it('REFUSES a reused action_id that names a different move (F65(b)) rather than answering 200', async () => {
    // 113's replay is kind- and team-scoped but NOT argument-scoped (R732),
    // so without this guard the caller would get P1's payload back for a P3
    // request — a 200 reporting a move they never made.
    const result = await submitAddDrop(managerAClient, leagueId, {
      team_id: teamAId,
      add_player_id: P3,
      action_id: ACTION.addP1,
    })
    expect(result.status).toBe(409)
    expect((result.body as unknown as Refusal).error).toBe(ADD_DROP_ACTION_ID_REUSED_MESSAGE)
    // …and P3 really was not added.
    const { data } = await service
      .from('league_rosters')
      .select('player_id')
      .eq('league_id', leagueId)
      .eq('player_id', P3)
    expect(data ?? []).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 2. The auth matrix — one no-leak 403 for three different strangers
// ---------------------------------------------------------------------------

describe('the auth matrix (§12/F35) — 42501 → 403, no-leak', () => {
  it('an outsider is refused', async () => {
    const result = await submitAddDrop(outsiderClient, leagueId, {
      team_id: teamAId,
      add_player_id: P3,
      action_id: ACTION.outsider,
    })
    expect(result.status).toBe(403)
    expect((result.body as unknown as Refusal).error).toBe(ADD_DROP_FORBIDDEN_MESSAGE)
  })

  it('a FELLOW MANAGER of the same league is refused on another team', async () => {
    const result = await submitAddDrop(managerBClient, leagueId, {
      team_id: teamAId,
      add_player_id: P3,
      action_id: ACTION.fellow,
    })
    expect(result.status).toBe(403)
  })

  it('the COMMISSIONER is refused on another team — his move is M6\'s (F227(d))', async () => {
    const result = await submitAddDrop(commishClient, leagueId, {
      team_id: teamAId,
      add_player_id: P3,
      action_id: ACTION.commish,
    })
    expect(result.status).toBe(403)
    // The copy is identical for all three: it distinguishes nothing.
    expect((result.body as unknown as Refusal).error).toBe(ADD_DROP_FORBIDDEN_MESSAGE)
  })

  it('none of the three wrote anything', async () => {
    for (const actionId of [ACTION.outsider, ACTION.fellow, ACTION.commish]) {
      const { count } = await service
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .eq('action_id', actionId)
      expect(count, actionId).toBe(0)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. Refusals SURFACE THEIR REASON (F227(f)) — the point of the route
// ---------------------------------------------------------------------------

describe('refusals reach the caller as their reason, never as a generic failure', () => {
  it('exclusivity: the friendly P0001 names the holding team — never a raw 23505', async () => {
    const mine = await submitAddDrop(managerAClient, leagueId, {
      team_id: teamAId,
      add_player_id: P2,
      action_id: ACTION.addP2A,
    })
    expect(mine.status).toBe(200)

    const theirs = await submitAddDrop(managerBClient, leagueId, {
      team_id: teamBId,
      add_player_id: P2,
      action_id: ACTION.addP2B,
    })
    expect(theirs.status).toBe(409)
    const message = (theirs.body as unknown as Refusal).error
    expect(message).toMatch(/a player is on ONE roster per league \(player exclusivity/)
    expect(message).toContain('Manager A Team') // the team is NAMED
    expect(message).not.toMatch(/duplicate key/)
  })

  it('an unknown player id is refused BY ID, not as a blank failure', async () => {
    const result = await submitAddDrop(managerAClient, leagueId, {
      team_id: teamAId,
      add_player_id: 'vitest-tx-nobody',
      action_id: ACTION.unknown,
    })
    expect(result.status).toBe(409)
    expect((result.body as unknown as Refusal).error).toContain('vitest-tx-nobody')
  })

  it('add === drop is an ARGUMENT problem: 22023 → 400, not 409', async () => {
    const result = await submitAddDrop(managerAClient, leagueId, {
      team_id: teamAId,
      add_player_id: P3,
      drop_player_id: P3,
      action_id: ACTION.sameBoth,
    })
    expect(result.status).toBe(400)
    expect((result.body as unknown as Refusal).error).toContain('name the same player')
  })

  it('neither add nor drop is a FIELD error at the edge (F227(f): never both null)', async () => {
    const result = await submitAddDrop(managerAClient, leagueId, {
      team_id: teamAId,
      action_id: ACTION.sameBoth,
    })
    expect(result.status).toBe(400)
    expect(JSON.stringify(result.body)).toContain('Name a player to add')
  })

  it('an unrecognized body key is refused rather than ignored', async () => {
    const result = await submitAddDrop(managerAClient, leagueId, {
      team_id: teamAId,
      add_player_id: P3,
      action_id: ACTION.sameBoth,
      faab_bid: 40, // M5's field — accepting it silently would be a lie
    })
    expect(result.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// 4. The F227(f) render duties on a DROP-ONLY move
// ---------------------------------------------------------------------------

describe('a drop-only move renders everything F227(f) requires', () => {
  it('reports {week, slot} entries with slot:null for a bench-only touch, and NO kept_in_locked_lineup', async () => {
    // Two lineup rows on purpose: the current week has P1 in a STARTING
    // slot, the next has him on the BENCH only. R758's clause is that the
    // bench row is reported too, with `slot: null` — under-reporting which
    // rows a drop touched is exactly the silence CLAUDE.md forbids.
    const { error: lineupError } = await service.from('team_lineups').insert([
      {
        team_id: teamAId,
        season: SYNTHETIC_SEASON,
        week: currentWeek,
        slot_map: { 'wr:0': P1 },
        starters: [{ slot: 'wr:0', player_id: P1 }],
        bench: [],
      },
      {
        team_id: teamAId,
        season: SYNTHETIC_SEASON,
        week: currentWeek + 1,
        slot_map: {},
        starters: [],
        bench: [P1],
      },
    ])
    if (lineupError) throw new Error(`team_lineups insert: ${lineupError.message}`)

    const result = await submitAddDrop(managerAClient, leagueId, {
      team_id: teamAId,
      drop_player_id: P1,
      action_id: ACTION.dropP1,
    })
    expect(result.status).toBe(200)
    const body = result.body as Record<string, unknown>
    const drop = body.drop as Record<string, unknown>

    expect(drop.lineups).toEqual([
      { week: currentWeek, slot: 'wr:0' },
      { week: currentWeek + 1, slot: null },
    ])
    // R760: the key the Q32 application deleted is nowhere in the document.
    expect(JSON.stringify(body)).not.toContain('kept_in_locked_lineup')
    // R763: a DROP-ONLY move reports real cap numbers, never NULL — a
    // surface rendering "used null of 3" is the bug this clause exists for.
    const caps = body.caps as Record<string, unknown>
    expect(typeof caps.used_week_after).toBe('number')
    expect(typeof caps.used_season_after).toBe('number')
    expect(caps.used_week_after).toBe(2) // the two ADDS; the drop counts for nothing
    // …and the slot really cleared (Q32: no phantom).
    const { data: rows } = await service
      .from('team_lineups')
      .select('week, slot_map, bench')
      .eq('team_id', teamAId)
      .order('week')
    for (const row of rows ?? []) {
      expect(JSON.stringify(row.slot_map ?? {}), `week ${row.week} slot_map`).not.toContain(P1)
      expect(JSON.stringify(row.bench ?? []), `week ${row.week} bench`).not.toContain(P1)
    }
  })
})

// ---------------------------------------------------------------------------
// 5. GET …/activity — the unified feed over what the moves wrote
// ---------------------------------------------------------------------------

describe('GET …/activity — §13.4\'s M4 slice', () => {
  it('a member reads the league\'s transactions, newest first', async () => {
    const result = await readActivity(managerAClient, leagueId, {})
    expect(result.status).toBe(200)
    const feed = result.body as unknown as {
      items: Array<Record<string, unknown>>
      has_more: boolean
      next_before: string | null
    }
    // Three executed moves: add P1, add P2, drop P1.
    expect(feed.items).toHaveLength(3)
    expect(feed.items.every((item) => item.kind === 'transaction')).toBe(true)
    expect(feed.items.every((item) => item.type === 'add_drop')).toBe(true)
    expect(feed.has_more).toBe(false)
    expect(feed.next_before).toBeNull()
    // The payload rides along, so the feed can render the move itself.
    expect(feed.items[0].payload).toBeTruthy()
  })

  it('filters by week, by team and by type — each one NARROWS the feed', async () => {
    const byWeek = await readActivity(managerAClient, leagueId, { week: String(currentWeek) })
    expect((byWeek.body as unknown as { items: unknown[] }).items).toHaveLength(3)

    const otherWeek = await readActivity(managerAClient, leagueId, { week: '18' })
    expect((otherWeek.body as unknown as { items: unknown[] }).items).toHaveLength(0)

    const byTeam = await readActivity(managerAClient, leagueId, { team_id: teamBId })
    expect((byTeam.body as unknown as { items: unknown[] }).items).toHaveLength(0)

    const byType = await readActivity(managerAClient, leagueId, { type: 'trade' })
    expect((byType.body as unknown as { items: unknown[] }).items).toHaveLength(0)

    const mine = await readActivity(managerAClient, leagueId, { type: 'add_drop', team_id: teamAId })
    expect((mine.body as unknown as { items: unknown[] }).items).toHaveLength(3)
  })

  it('kind=system excludes transactions (and this league has no system post yet)', async () => {
    const result = await readActivity(managerAClient, leagueId, { kind: 'system' })
    expect((result.body as unknown as { items: unknown[] }).items).toHaveLength(0)
  })

  it('pages with a measured has_more, not a guess', async () => {
    const page = await readActivity(managerAClient, leagueId, { limit: '2' })
    const feed = page.body as unknown as {
      items: Array<{ id: string; created_at: string }>
      has_more: boolean
      next_before: string | null
    }
    expect(feed.items).toHaveLength(2)
    expect(feed.has_more).toBe(true)
    expect(feed.next_before).toBe(feed.items[1].created_at)

    const next = await readActivity(managerAClient, leagueId, {
      limit: '2',
      before: feed.next_before!,
    })
    const tail = next.body as unknown as { items: Array<{ id: string }>; has_more: boolean }
    expect(tail.items).toHaveLength(1)
    expect(tail.has_more).toBe(false)
    // No item is served twice across the two pages.
    const ids = new Set([...feed.items.map((i) => i.id), ...tail.items.map((i) => i.id)])
    expect(ids.size).toBe(3)
  })

  it('a non-member reads NOTHING — the no-leak posture for league reads', async () => {
    const result = await readActivity(outsiderClient, leagueId, {})
    expect(result.status).toBe(200)
    expect((result.body as unknown as { items: unknown[] }).items).toHaveLength(0)
  })

  it('refuses a malformed filter instead of quietly widening the feed', async () => {
    const result = await readActivity(managerAClient, leagueId, { type: 'promotion' })
    expect(result.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// 6. R768 — an UPPERCASE uuid is the SAME move, never a committed move
//    reported to the caller as a failure.
// ---------------------------------------------------------------------------

describe('the F65(b) guard compares against what POSTGRES wrote (R768)', () => {
  it('an uppercase REPLAY of a committed move answers 200, not 409 with the move already made', async () => {
    // The bug, exactly: `z.uuid()` is case-insensitive, so this body is
    // valid; the RPC accepts it (Postgres parses either case) and replays;
    // and the guard then compared 'AF70…' to the returned 'af70…', found
    // them different, and answered 409 "That didn't go through" for a move
    // that HAD gone through — with the action_id spent, so the retry the
    // copy asks for cannot succeed either. That is CLAUDE.md's "never let
    // 'nothing happened' mean 'it worked'" run in reverse.
    const upper = await submitAddDrop(managerAClient, leagueId, {
      team_id: teamAId.toUpperCase(),
      add_player_id: P1,
      action_id: ACTION.addP1.toUpperCase(),
    })
    expect(upper.status).toBe(200)
    const body = upper.body as Record<string, unknown>
    expect(body.action_id).toBe(ACTION.addP1) // normalised on the way in
    expect(body.team_id).toBe(teamAId)
    expect(body.add_player_id).toBe(P1)

    // Still ONE row for that action_id — the replay wrote nothing.
    const { count, error } = await service
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .eq('action_id', ACTION.addP1)
    if (error) throw new Error(`transactions count: ${error.message}`)
    expect(count).toBe(1)
  })

  it('an uppercase FRESH move commits and is REPORTED as the move it was', async () => {
    const result = await submitAddDrop(managerAClient, leagueId, {
      team_id: teamAId.toUpperCase(),
      add_player_id: P3,
      action_id: ACTION.addP3.toUpperCase(),
    })
    expect(result.status).toBe(200)
    const body = result.body as Record<string, unknown>
    expect(body.add_player_id).toBe(P3)
    expect(body.action_id).toBe(ACTION.addP3)

    // The normalised id is what 113 stored — so a lowercase retry of the
    // same gesture still replays rather than making a second move.
    const { count } = await service
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .eq('action_id', ACTION.addP3)
    expect(count).toBe(1)
    const { data: roster } = await service
      .from('league_rosters')
      .select('player_id')
      .eq('league_id', leagueId)
      .eq('player_id', P3)
    expect(roster ?? []).toHaveLength(1)
  })

  it('and the guard KEEPS its teeth: an uppercase id reused for a DIFFERENT move is still 409', async () => {
    // The normalisation must not become a way past the guard. Consume a
    // fresh id on one move…
    const first = await submitAddDrop(managerAClient, leagueId, {
      team_id: teamAId,
      drop_player_id: P3,
      action_id: ACTION.upperReuse.toUpperCase(),
    })
    expect(first.status).toBe(200)

    // …then reuse it, uppercase, for a different one.
    const reused = await submitAddDrop(managerAClient, leagueId, {
      team_id: teamAId.toUpperCase(),
      drop_player_id: P2,
      action_id: ACTION.upperReuse.toUpperCase(),
    })
    expect(reused.status).toBe(409)
    expect((reused.body as unknown as Refusal).error).toBe(ADD_DROP_ACTION_ID_REUSED_MESSAGE)
    // …and P2 really is still rostered.
    const { data: roster } = await service
      .from('league_rosters')
      .select('player_id')
      .eq('league_id', leagueId)
      .eq('player_id', P2)
    expect(roster ?? []).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 7. R770 — the composite cursor over a SAME-INSTANT pair, on the real wire.
// ---------------------------------------------------------------------------

describe('paging across a same-instant tie serves every item exactly once (R770)', () => {
  beforeAll(async () => {
    // Two league-room system posts at ONE instant — what §13.2/§14's waiver
    // processor (N claims resolved atomically) and M6's commissioner_move (a
    // transactions row + a system post in one txn) will produce for real.
    // Written with an explicit shared `created_at` so the tie is the
    // fixture, not a race.
    const { error } = await service.from('league_chat').insert(
      TIE_POSTS.map((post) => ({
        id: post.id,
        league_id: leagueId,
        message: post.message,
        context: 'league',
        is_system: true,
        created_at: TIE_INSTANT,
      })),
    )
    if (error) throw new Error(`tie posts insert: ${error.message}`)
  })

  it('page 1 hands back BOTH cursor halves and page 2 serves the tied row', async () => {
    const page1 = await readActivity(managerAClient, leagueId, { kind: 'system', limit: '1' })
    expect(page1.status).toBe(200)
    const first = page1.body as unknown as {
      items: Array<{ id: string; created_at: string }>
      has_more: boolean
      next_before: string | null
      next_before_id: string | null
    }
    expect(first.items.map((i) => i.id)).toEqual([TIE_POSTS[1].id]) // id DESC
    expect(first.has_more).toBe(true)
    expect(first.next_before).toBe(TIE_INSTANT)
    expect(first.next_before_id).toBe(TIE_POSTS[1].id)
    // The cursor is the returned item's own position, not a re-derivation.
    expect(first.next_before).toBe(first.items[0].created_at)

    const page2 = await readActivity(managerAClient, leagueId, {
      kind: 'system',
      limit: '1',
      before: first.next_before!,
      before_id: first.next_before_id!,
    })
    const second = page2.body as unknown as { items: Array<{ id: string }>; has_more: boolean }
    // THE FINDING: with the instant-only cursor this page was EMPTY and the
    // row was served on no page at all, in either direction, forever.
    expect(second.items.map((i) => i.id)).toEqual([TIE_POSTS[0].id])
    expect(second.has_more).toBe(false)
  })

  it('the NEGATIVE control: the instant alone still drops the tie — which is why both halves travel', async () => {
    const instantOnly = await readActivity(managerAClient, leagueId, {
      kind: 'system',
      before: TIE_INSTANT,
    })
    expect((instantOnly.body as unknown as { items: unknown[] }).items).toHaveLength(0)
  })

  it('refuses a cursor id with no instant rather than paging as if none were sent', async () => {
    const result = await readActivity(managerAClient, leagueId, {
      kind: 'system',
      before_id: TIE_POSTS[1].id,
    })
    expect(result.status).toBe(400)
    expect(JSON.stringify(result.body)).toContain('before_id')
  })
})
