/**
 * draft-core-db.test.ts — L.B1.2 item 4 at the WIRE layer: migration 066's
 * draft core (draft_create / draft_start / draft_make_pick) against the
 * LOCAL Supabase stack through PostgREST — real signed-in users driving a
 * real league from creation through scheduling, start, and three picks.
 * pgTAP 020 owns the exhaustive DB-side matrix (order math golden pins,
 * capacity boundary, D43 order probes, completion, untimed); this suite
 * proves the production wire path plus the §4.6 held-lock bound.
 *
 * HELD-LOCK ASSERTION (tasks-M2 §4.6 / plan §8.3 "held-lock < 50ms"): the
 * client-observed round trip UPPER-BOUNDS the in-RPC lock window (RTT =
 * network + parse + plan + execute, and the drafts-row lock is held for a
 * subset of execute). We assert the FASTEST of the three real picks lands
 * under 50ms: a systematically long lock hold (the failure §4.6 exists to
 * catch — heavy scans or sleeps under the lock) inflates EVERY call and
 * fails the bound, while a one-off load spike on the slower calls cannot
 * flake the suite. Timing uses process.hrtime.bigint() — monotonic, and
 * outside the D3/D17 wall-clock ban (this is harness measurement, not
 * league logic reading time).
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips (§4.3).
 *
 * Determinism: FIXED emails/usernames/action_ids/player-fixture ids +
 * cleanup-first. No wall-clock or random anywhere (ESLint D3/D17 guard
 * covers this file).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { claimInvite, createInvite } from './invites-service'
import { patchLeague } from './leagues-service'
import { addPlaceholderSeat } from './members-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-draft-core-league'
// F49 (L.B7.1 sweep): far-future — 068's LIVE cron auto-starts COMMITTED
// scheduled leagues whose stored instant has passed; 2026 dates became
// mid-run `scheduled`->`drafting` flip bait from Sep 2026.
const DRAFT_INSTANT = '2028-09-01T17:00:00+00:00'

const COMMISH = {
  email: 'draft-core-commish@fieldscout.test',
  password: 'pgtap-draft-pass-1',
  username: 'dc_wire_commish',
}
const MGR2 = {
  email: 'draft-core-mgr2@fieldscout.test',
  password: 'pgtap-draft-pass-2',
  username: 'dc_wire_mgr_two',
}
const MGR3 = {
  email: 'draft-core-mgr3@fieldscout.test',
  password: 'pgtap-draft-pass-3',
  username: 'dc_wire_mgr_three',
}

/** Harness player fixtures (players is app-read-only; service-role inserts
 *  are the pgTAP-privileged-fixture move at the wire layer). */
const PLAYERS = [
  { id: 'vitest-dc-p1', full_name: 'Vitest DC Player One', position: 'RB' },
  { id: 'vitest-dc-p2', full_name: 'Vitest DC Player Two', position: 'RB' },
  { id: 'vitest-dc-p3', full_name: 'Vitest DC Player Three', position: 'RB' },
] as const

const ACTION = {
  create: 'ad000000-0000-4000-8000-000000000001',
  pick1: 'ad000000-0000-4000-8000-000000000011',
  pick2: 'ad000000-0000-4000-8000-000000000012',
  pick3: 'ad000000-0000-4000-8000-000000000013',
  loser: 'ad000000-0000-4000-8000-000000000021',
  wrongTurn: 'ad000000-0000-4000-8000-000000000022',
} as const

type DraftRow = Database['public']['Tables']['drafts']['Row']
type PickRow = Database['public']['Tables']['draft_picks']['Row']
interface DraftStateResponse {
  draft: DraftRow
  created?: boolean
  started?: boolean
}
interface PickResponse {
  draft: DraftRow
  pick: PickRow
}

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let mgr2Client: SupabaseClient<Database>
let mgr3Client: SupabaseClient<Database>
let leagueId: string
let draftId: string
/** Manual draft order: [commish, mgr2, mgr3, 5 placeholders]. */
let orderedTeamIds: string[]

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) {
    await service.auth.admin.deleteUser(row.id)
  }
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').eq('name', LEAGUE_NAME)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    // drafts first: draft_picks cascade off drafts and FK-pin teams/players.
    await service.from('drafts').delete().in('league_id', ids)
    await service.from('teams').delete().in('league_id', ids)
    await service.from('leagues').delete().in('id', ids)
  }
  await service
    .from('players')
    .delete()
    .in(
      'id',
      PLAYERS.map((p) => p.id),
    )
  for (const u of [COMMISH, MGR2, MGR3]) {
    await deleteUserByUsername(u.username)
  }
}

async function createUser(user: {
  email: string
  password: string
  username: string
}): Promise<string> {
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
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

/** Round-trip a draft_make_pick and report the RTT in ms (monotonic clock). */
async function timedPick(
  client: SupabaseClient<Database>,
  playerId: string,
  actionId: string,
): Promise<{ response: PickResponse; ms: number }> {
  const startNs = process.hrtime.bigint()
  const { data, error } = await client.rpc('draft_make_pick', {
    p_draft_id: draftId,
    p_player_id: playerId,
    p_action_id: actionId,
  })
  const ms = Number(process.hrtime.bigint() - startNs) / 1e6
  if (error) throw new Error(`draft_make_pick(${playerId}) failed: ${error.message}`)
  return { response: data as unknown as PickResponse, ms }
}

beforeAll(async () => {
  await cleanup()
  await createUser(COMMISH)
  const mgr2Id = await createUser(MGR2)
  const mgr3Id = await createUser(MGR3)
  void mgr2Id
  void mgr3Id
  commishClient = await signIn(COMMISH)
  mgr2Client = await signIn(MGR2)
  mgr3Client = await signIn(MGR3)

  await service.from('players').upsert([...PLAYERS])

  // League (8 teams) via the real create_league path.
  const settings = defaultsForTeamCount(8)
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(
    Object.entries(columns).map(([key, value]) => [`p_${key}`, value]),
  )
  const { data: template } = await commishClient
    .from('scoring_systems')
    .select('id')
    .eq('is_template', true)
    .eq('name', 'ESPN Standard')
    .single()
  const { data: created, error: createError } = await commishClient.rpc('create_league', {
    p_name: LEAGUE_NAME,
    p_season: 2026,
    p_scoring_system_id: template?.id,
    p_team_name: 'Commish Team',
    p_action_id: ACTION.create,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id

  // Seat mgr2 + mgr3 on real franchises (placeholder seat → username invite
  // → claim — the L.A1.14/15 path), then fill to capacity with placeholders.
  const seatFor = async (
    username: string,
    client: SupabaseClient<Database>,
  ): Promise<string> => {
    const seat = await addPlaceholderSeat(commishClient, leagueId, {
      team_name: `Seat for ${username}`,
    })
    if (seat.status !== 201) throw new Error(`addPlaceholderSeat failed: ${JSON.stringify(seat.body)}`)
    const teamId = (seat.body as { team_id: string }).team_id
    const invite = await createInvite(commishClient, leagueId, {
      target_team_id: teamId,
      invited_username: username,
    })
    if (invite.status !== 201) throw new Error(`createInvite failed: ${JSON.stringify(invite.body)}`)
    const claim = await claimInvite(client, {
      token: (invite.body as { token: string }).token,
    })
    if (claim.status !== 200) throw new Error(`claimInvite failed: ${JSON.stringify(claim.body)}`)
    return teamId
  }
  const mgr2TeamId = await seatFor(MGR2.username, mgr2Client)
  const mgr3TeamId = await seatFor(MGR3.username, mgr3Client)

  const placeholderIds: string[] = []
  for (let i = 0; i < 5; i++) {
    const fill = await addPlaceholderSeat(commishClient, leagueId, {})
    if (fill.status !== 201) throw new Error(`placeholder fill failed: ${JSON.stringify(fill.body)}`)
    placeholderIds.push((fill.body as { team_id: string }).team_id)
  }

  const { data: commishMember, error: memberError } = await service
    .from('league_members')
    .select('team_id')
    .eq('league_id', leagueId)
    .eq('role', 'commissioner')
    .single()
  if (memberError || !commishMember?.team_id) {
    throw new Error(`commissioner team lookup failed: ${memberError?.message}`)
  }
  orderedTeamIds = [commishMember.team_id, mgr2TeamId, mgr3TeamId, ...placeholderIds]

  // Configure: manual order + the draft instant, then schedule.
  const configured = await patchLeague(commishClient, leagueId, {
    settings: {
      draft: {
        draft_scheduled_at: DRAFT_INSTANT,
        draft_order_mode: 'manual',
        draft_order: orderedTeamIds,
      },
    },
  })
  if (configured.status !== 200) {
    throw new Error(`configure PATCH failed: ${JSON.stringify(configured.body)}`)
  }
  const scheduled = await patchLeague(commishClient, leagueId, { status: 'scheduled' })
  if (scheduled.status !== 200) {
    throw new Error(`scheduled PATCH failed: ${JSON.stringify(scheduled.body)}`)
  }
}, 120_000)

afterAll(async () => {
  await cleanup()
})

describe('draft core over PostgREST (migration 066)', () => {
  it('draft_create hydrates and is idempotent; non-commish start is refused', async () => {
    const { data, error } = await commishClient.rpc('draft_create', {
      p_league_id: leagueId,
    })
    expect(error).toBeNull()
    const created = data as unknown as DraftStateResponse
    expect(created.created).toBe(true)
    expect(created.draft.status).toBe('scheduled')
    expect(created.draft.is_mock).toBe(false)
    draftId = created.draft.id

    // Idempotent replay (D95): same row back, no second draft.
    const { data: replayed } = await commishClient.rpc('draft_create', {
      p_league_id: leagueId,
    })
    const replay = replayed as unknown as DraftStateResponse
    expect(replay.created).toBe(false)
    expect(replay.draft.id).toBe(draftId)

    // A manager cannot start the draft (42501 → the route's 403).
    const { error: startDenied } = await mgr2Client.rpc('draft_start', {
      p_league_id: leagueId,
    })
    expect(startDenied?.code).toBe('42501')
  })

  it('draft_start re-hydrates config, snapshots, and puts order[1] on the clock', async () => {
    const startNs = process.hrtime.bigint()
    const { data, error } = await commishClient.rpc('draft_start', {
      p_league_id: leagueId,
    })
    const startMs = Number(process.hrtime.bigint() - startNs) / 1e6
    expect(error).toBeNull()
    const started = data as unknown as DraftStateResponse
    expect(started.started).toBe(true)
    expect(started.draft.status).toBe('live')
    expect(started.draft.current_pick_number).toBe(1)
    expect(started.draft.on_clock_team_id).toBe(orderedTeamIds[0])
    expect(started.draft.draft_order).toEqual(orderedTeamIds)
    expect(started.draft.total_rounds).toBe(15)
    expect(started.draft.current_deadline).not.toBeNull()

    // The league transitioned (draft_start's own path) and the snapshot
    // landed BEFORE it (D43 — the trigger would have raised otherwise).
    const { data: league } = await service
      .from('leagues')
      .select('status, scoring_rules_snapshot')
      .eq('id', leagueId)
      .single()
    expect(league?.status).toBe('drafting')
    expect(league?.scoring_rules_snapshot).not.toBeNull()

    // Family sanity ceiling only — the strict §4.6 bound is asserted on the
    // pick family below (start does strictly more one-time work: snapshot,
    // order generation, hydration).
    expect(startMs).toBeLessThan(1500)
  })

  it('three real users make the first three picks; held-lock < 50ms (§4.6)', async () => {
    const pick1 = await timedPick(commishClient, PLAYERS[0].id, ACTION.pick1)
    expect(pick1.response.pick.team_id).toBe(orderedTeamIds[0])
    expect(pick1.response.pick.player_id).toBe(PLAYERS[0].id)
    expect(pick1.response.pick.made_via).toBe('manager')
    expect(pick1.response.draft.current_pick_number).toBe(2)
    expect(pick1.response.draft.on_clock_team_id).toBe(orderedTeamIds[1])

    // E1 over the wire: the loser gets the friendly refusal (§8.1).
    const { error: loser } = await mgr2Client.rpc('draft_make_pick', {
      p_draft_id: draftId,
      p_player_id: PLAYERS[0].id,
      p_action_id: ACTION.loser,
    })
    expect(loser?.code).toBe('P0001')
    expect(loser?.message).toContain('just went off the board')

    const pick2 = await timedPick(mgr2Client, PLAYERS[1].id, ACTION.pick2)
    expect(pick2.response.pick.team_id).toBe(orderedTeamIds[1])
    expect(pick2.response.draft.on_clock_team_id).toBe(orderedTeamIds[2])

    // E2 over the wire: the replay is a no-op with the identical response.
    const { data: replayData, error: replayError } = await mgr2Client.rpc('draft_make_pick', {
      p_draft_id: draftId,
      p_player_id: PLAYERS[1].id,
      p_action_id: ACTION.pick2,
    })
    expect(replayError).toBeNull()
    expect(replayData).toEqual(pick2.response as unknown as typeof replayData)

    // Wrong turn over the wire: mgr2 again while mgr3 is on the clock.
    const { error: wrongTurn } = await mgr2Client.rpc('draft_make_pick', {
      p_draft_id: draftId,
      p_player_id: PLAYERS[2].id,
      p_action_id: ACTION.wrongTurn,
    })
    expect(wrongTurn?.code).toBe('P0001')
    expect(wrongTurn?.message).toContain('it is not your turn')

    const pick3 = await timedPick(mgr3Client, PLAYERS[2].id, ACTION.pick3)
    expect(pick3.response.pick.team_id).toBe(orderedTeamIds[2])
    expect(pick3.response.draft.current_pick_number).toBe(4)
    expect(pick3.response.draft.on_clock_team_id).toBe(orderedTeamIds[3])

    // Exactly three live picks landed (the E1/E2/wrong-turn attempts wrote
    // nothing).
    const { count } = await service
      .from('draft_picks')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', draftId)
      .eq('is_undone', false)
    expect(count).toBe(3)

    // §4.6 held-lock bound — see the file header for why min() is the
    // honest de-flaked form (RTT upper-bounds the lock window; a
    // systematically held lock inflates every sample).
    const rtts = [pick1.ms, pick2.ms, pick3.ms]
    expect(
      Math.min(...rtts),
      `held-lock bound: every pick RTT exceeded 50ms — [${rtts.map((n) => n.toFixed(1)).join(', ')}]ms`,
    ).toBeLessThan(50)
  })
})
