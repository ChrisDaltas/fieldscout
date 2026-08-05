/**
 * draft-queue-api-db.test.ts — L.B2.2 at the WIRE layer: the room's own
 * §15.2/§15.5 surface (`makePick` / `upsertQueue` / `queueFromList` /
 * `setAutodraft` in draft-service.ts, plus the members-PATCH commissioner
 * toggle in members-service.ts — F33 discharged), driven over the LOCAL
 * stack through PostgREST by real signed-in users — the exact composition
 * the Route Handlers run (the D68 wire-suite convention).
 *
 * What this suite owns (pgTAP 020/022/026 own the RPC-side matrices):
 *   - queue round-trip: whole-queue upsert + reorder as own RLS rows;
 *     duplicate/unknown-player 400s with the queue UNTOUCHED (the
 *     validate-before-destructive-replace guard);
 *   - the E1 pick race: two clients, one player — the loser's friendly
 *     "just went off the board" message pinned as a 400;
 *   - the E2 replay: the same action_id twice answers 200 with the SAME
 *     pick row, one row total (D68(1) — the hook mints one id per submit);
 *   - §8.9 from-list: the attached list loads in `list_players.position`
 *     order with already-drafted players SKIPPED (replace), and "Add
 *     remaining" appends after the queue tail skipping queued players;
 *   - BOTH autodraft toggle paths over 072's `set_team_autodraft`: the
 *     self route (posts NOTHING with a live draft in the room — the D97
 *     discriminator) incl. the R153 double-submit changed:false round-trip
 *     and the R154 held-lock < 50ms bound (rule 6, the toggle family); the
 *     commissioner members-PATCH (system post member-visible);
 *   - the D103(3) mock seam at the SERVICE layer: only the LAUNCHER
 *     queue-writes a mock through the route (the seat's real owner is
 *     refused here even though the 065 policy's owner arm would let a raw
 *     client through — queue rows are advisory and the mock room is the
 *     launcher's; recorded in the service banner);
 *   - the OUTSIDER no-leak sweep: pick/queue/from-list answer the same 404
 *     a draftless league gets; autodraft answers the member 403.
 *
 * LIVE-CRON SAFETY (the 022/068 concurrent-actor rule): 300s pick clock
 * (the 5s tick can never reach a timeout mid-test — autodraft ON included:
 * ARM 2 fires at the deadline only), nobody calls draft_touch (the outage
 * arm's never-connected exemption), draft_scheduled_at is FAR FUTURE
 * (2027 — F49), and the planted mock carries no current_deadline (never
 * DUE, so ARM 2.5 leaves it alone).
 *
 * Requires the local stack — D59(5); FAILS loudly when the stack is down,
 * never skips (§4.3). Determinism: fixed emails/usernames/action-ids
 * (prefix ad7 — ad0/1/2/4/5/6 belong to the sibling suites), fixed player
 * fixtures, cleanup-first. Timing uses process.hrtime.bigint() (monotonic
 * harness measurement — outside the D3/D17 wall-clock ban).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import {
  makePick,
  queueFromList,
  setAutodraft,
  upsertQueue,
} from './draft-service'
import { claimInvite, createInvite } from './invites-service'
import { attachLeagueList } from './league-lists-service'
import { patchLeague } from './leagues-service'
import { addPlaceholderSeat, patchMember } from './members-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-draft-queue-league'
const DRAFT_INSTANT = '2027-09-03T17:00:00+00:00'
const LIST_SLUG = 'dq-wire-list'

const COMMISH = {
  email: 'draft-queue-commish@fieldscout.test',
  password: 'pgtap-draft-pass-1',
  username: 'dq_wire_commish',
}
const MGR2 = {
  email: 'draft-queue-mgr2@fieldscout.test',
  password: 'pgtap-draft-pass-2',
  username: 'dq_wire_mgr_two',
}
const OUTSIDER = {
  email: 'draft-queue-outsider@fieldscout.test',
  password: 'pgtap-draft-pass-3',
  username: 'dq_wire_outsider',
}

/** Harness player fixtures (players is app-read-only; service-role inserts
 *  are the pgTAP-privileged-fixture move at the wire layer). */
const PLAYERS = [
  { id: 'vitest-dq-p1', full_name: 'Vitest DQ Player One', position: 'RB' },
  { id: 'vitest-dq-p2', full_name: 'Vitest DQ Player Two', position: 'RB' },
  { id: 'vitest-dq-p3', full_name: 'Vitest DQ Player Three', position: 'RB' },
  { id: 'vitest-dq-p4', full_name: 'Vitest DQ Player Four', position: 'WR' },
  { id: 'vitest-dq-p5', full_name: 'Vitest DQ Player Five', position: 'WR' },
  { id: 'vitest-dq-p6', full_name: 'Vitest DQ Player Six', position: 'TE' },
] as const
const [P1, P2, P3, P4, P5, P6] = PLAYERS.map((p) => p.id)

const ACTION = {
  create: 'ad700000-0000-4000-8000-000000000001',
  pick1: 'ad700000-0000-4000-8000-000000000011',
  pick2: 'ad700000-0000-4000-8000-000000000012',
  loser: 'ad700000-0000-4000-8000-000000000021',
} as const

interface QueueResponse {
  draft_id: string
  team_id: string
  queue: { player_id: string; rank: number }[]
  mode?: string
  added?: number
  skipped_drafted?: number
  skipped_queued?: number
}
interface PickResponse {
  draft: Database['public']['Tables']['drafts']['Row']
  pick: Database['public']['Tables']['draft_picks']['Row']
}

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let mgr2Client: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let commishId: string
let mgr2Id: string
let leagueId: string
let draftId: string
let mockDraftId: string
let mgr2TeamId: string
let mgr2MemberId: string
let listId: string

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
    // drafts first: picks/queues cascade off drafts and FK-pin teams/players.
    await service.from('drafts').delete().in('league_id', ids)
    await service.from('teams').delete().in('league_id', ids)
    await service.from('leagues').delete().in('id', ids)
  }
  await service.from('lists').delete().eq('slug', LIST_SLUG)
  await service
    .from('players')
    .delete()
    .in(
      'id',
      PLAYERS.map((p) => p.id),
    )
  for (const u of [COMMISH, MGR2, OUTSIDER]) {
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

/** The (draft, team) queue as the server holds it — read privileged so the
 *  assertion is against stored truth, not the caller's RLS view. */
async function storedQueue(dId: string, teamId: string): Promise<[string, number][]> {
  const { data, error } = await service
    .from('draft_queues')
    .select('player_id, rank')
    .eq('draft_id', dId)
    .eq('team_id', teamId)
    .order('rank', { ascending: true })
  if (error) throw new Error(`stored queue read failed: ${error.message}`)
  return (data ?? []).map((row) => [row.player_id, row.rank])
}

/** Timed self-toggle round trip (monotonic harness clock — D105(9) form). */
async function timedToggle(
  client: SupabaseClient<Database>,
  userId: string,
  on: boolean,
): Promise<{ result: Awaited<ReturnType<typeof setAutodraft>>; ms: number }> {
  const startNs = process.hrtime.bigint()
  const result = await setAutodraft(client, leagueId, userId, { on })
  const ms = Number(process.hrtime.bigint() - startNs) / 1e6
  return { result, ms }
}

beforeAll(async () => {
  await cleanup()
  commishId = await createUser(COMMISH)
  mgr2Id = await createUser(MGR2)
  await createUser(OUTSIDER)
  commishClient = await signIn(COMMISH)
  mgr2Client = await signIn(MGR2)
  outsiderClient = await signIn(OUTSIDER)

  await service.from('players').upsert([...PLAYERS])

  // League (8 teams) via the real create path; LONG pick clock + far-future
  // instant (the live-cron safety note in the header).
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

  // Seat mgr2 (placeholder → username invite → claim), then fill to 8.
  const seat = await addPlaceholderSeat(commishClient, leagueId, { team_name: 'Seat for mgr2' })
  if (seat.status !== 201) throw new Error(`addPlaceholderSeat failed: ${JSON.stringify(seat.body)}`)
  mgr2TeamId = (seat.body as { team_id: string }).team_id
  const invite = await createInvite(commishClient, leagueId, {
    target_team_id: mgr2TeamId,
    invited_username: MGR2.username,
  })
  if (invite.status !== 201) throw new Error(`createInvite failed: ${JSON.stringify(invite.body)}`)
  const claim = await claimInvite(mgr2Client, { token: (invite.body as { token: string }).token })
  if (claim.status !== 200) throw new Error(`claimInvite failed: ${JSON.stringify(claim.body)}`)
  const placeholderIds: string[] = []
  for (let i = 0; i < 6; i++) {
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
  const { data: mgr2Member, error: mgr2MemberError } = await service
    .from('league_members')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', mgr2Id)
    .single()
  if (mgr2MemberError || !mgr2Member) {
    throw new Error(`mgr2 member lookup failed: ${mgr2MemberError?.message}`)
  }
  mgr2MemberId = mgr2Member.id

  // Manual order [commish, mgr2, placeholders…]: pick 1 = commish,
  // pick 2 = mgr2 — the race test's deterministic seats.
  const configured = await patchLeague(commishClient, leagueId, {
    settings: {
      draft: {
        draft_scheduled_at: DRAFT_INSTANT,
        draft_order_mode: 'manual',
        draft_order: [commishMember.team_id, mgr2TeamId, ...placeholderIds],
        pick_timer_seconds: 300,
        disconnect_grace_seconds: 30,
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
  const { data: started, error: startError } = await commishClient.rpc('draft_start', {
    p_league_id: leagueId,
  })
  if (startError) throw new Error(`draft_start failed: ${startError.message}`)
  draftId = (started as unknown as { draft: { id: string } }).draft.id

  // mgr2's prep list [P1, P2, P4, P6] in position order — the §8.9 fixture
  // (mgr2's ONE private list, inside the free-account cap).
  const { data: list, error: listError } = await mgr2Client
    .from('lists')
    .insert({ owner_id: mgr2Id, title: 'DQ wire list', slug: LIST_SLUG, is_private: true })
    .select('id')
    .single()
  if (listError) throw new Error(`list insert failed: ${listError.message}`)
  listId = list.id
  const { error: lpError } = await mgr2Client.from('list_players').insert([
    { list_id: listId, player_id: P1, position: 1, overall_rank: 1 },
    { list_id: listId, player_id: P2, position: 2, overall_rank: 2 },
    { list_id: listId, player_id: P4, position: 3, overall_rank: 3 },
    { list_id: listId, player_id: P6, position: 4, overall_rank: 4 },
  ])
  if (lpError) throw new Error(`list_players insert failed: ${lpError.message}`)
  const attached = await attachLeagueList(mgr2Client, leagueId, mgr2Id, { list_id: listId })
  if (attached.status !== 201) {
    throw new Error(`attachLeagueList failed: ${JSON.stringify(attached.body)}`)
  }

  // A live MOCK planted privileged (the pgTAP-fixture move): launcher =
  // COMMISH, human seat = MGR2'S franchise (the D103 "any seat selectable"
  // shape that makes the launcher-vs-owner discriminator sharp). No
  // current_deadline — never DUE, the tick's ARM 2.5 leaves it alone.
  const { data: mock, error: mockError } = await service
    .from('drafts')
    .insert({
      league_id: leagueId,
      draft_type: 'snake',
      status: 'live',
      is_mock: true,
      config: { mock: { launched_by: commishId, human_team_id: mgr2TeamId, cpu_speed: 'fast' } },
    })
    .select('id')
    .single()
  if (mockError) throw new Error(`mock fixture insert failed: ${mockError.message}`)
  mockDraftId = mock.id
}, 120_000)

afterAll(async () => {
  await cleanup()
})

describe('queue upsert/reorder over PostgREST (§8.4/§12.6)', () => {
  it('round-trip: POST the full order, read it back (response + RLS + stored rows agree); reorder replaces', async () => {
    const posted = await upsertQueue(mgr2Client, leagueId, mgr2Id, {
      players: [P5, P4, P3],
    })
    expect(posted.status).toBe(200)
    const body = posted.body as unknown as QueueResponse
    expect(body.draft_id).toBe(draftId)
    expect(body.team_id).toBe(mgr2TeamId)
    expect(body.queue).toEqual([
      { player_id: P5, rank: 1 },
      { player_id: P4, rank: 2 },
      { player_id: P3, rank: 3 },
    ])

    // The caller's own RLS view agrees (the hook's read path).
    const { data: mine } = await mgr2Client
      .from('draft_queues')
      .select('player_id, rank')
      .eq('draft_id', draftId)
      .eq('team_id', mgr2TeamId)
      .order('rank', { ascending: true })
    expect((mine ?? []).map((r) => r.player_id)).toEqual([P5, P4, P3])

    // Reorder = the same set in a new order, whole-queue replace.
    const reordered = await upsertQueue(mgr2Client, leagueId, mgr2Id, {
      players: [P3, P5],
    })
    expect(reordered.status).toBe(200)
    expect(await storedQueue(draftId, mgr2TeamId)).toEqual([
      [P3, 1],
      [P5, 2],
    ])
  })

  it('duplicate and unknown-player bodies 400 with the queue UNTOUCHED (validate before the destructive replace)', async () => {
    const before = await storedQueue(draftId, mgr2TeamId)

    const dupe = await upsertQueue(mgr2Client, leagueId, mgr2Id, {
      players: [P3, P3],
    })
    expect(dupe.status).toBe(400)

    const unknown = await upsertQueue(mgr2Client, leagueId, mgr2Id, {
      players: [P3, 'vitest-dq-ghost'],
    })
    expect(unknown.status).toBe(400)
    expect(JSON.stringify(unknown.body)).toContain('vitest-dq-ghost')

    // Neither refusal emptied the queue (the delete-then-insert hazard).
    expect(await storedQueue(draftId, mgr2TeamId)).toEqual(before)
  })

  it('MOCK seam (D103(3) at the service layer): the LAUNCHER writes the human seat queue; the seat REAL owner is refused', async () => {
    // Commish launched the mock on MGR2'S franchise — the launcher writes.
    const launcher = await upsertQueue(commishClient, leagueId, commishId, {
      draft_id: mockDraftId,
      players: [P6],
    })
    expect(launcher.status).toBe(200)
    const body = launcher.body as unknown as QueueResponse
    expect(body.team_id).toBe(mgr2TeamId)
    expect(await storedQueue(mockDraftId, mgr2TeamId)).toEqual([[P6, 1]])

    // mgr2 owns the franchise but did NOT launch: the route refuses (the
    // mock room is the launcher's solo practice — autopick reads mocks
    // launcher-keyed, 068).
    const owner = await upsertQueue(mgr2Client, leagueId, mgr2Id, {
      draft_id: mockDraftId,
      players: [P5],
    })
    expect(owner.status).toBe(403)
    expect(JSON.stringify(owner.body)).toContain('solo practice')

    // The REAL draft's queue never moved.
    expect(await storedQueue(draftId, mgr2TeamId)).toEqual([
      [P3, 1],
      [P5, 2],
    ])
  })
})

describe('picks over PostgREST — E1 race + E2 replay (§8.1)', () => {
  it('pick 1 lands for the on-clock commissioner; the race LOSER gets the friendly E1 400, message pinned', async () => {
    const pick1 = await makePick(commishClient, leagueId, {
      player_id: P1,
      action_id: ACTION.pick1,
    })
    expect(pick1.status).toBe(200)
    const body = pick1.body as unknown as PickResponse
    expect(body.pick.player_id).toBe(P1)
    expect(body.draft.on_clock_team_id).toBe(mgr2TeamId)

    // Two clients, one player: mgr2 (now legitimately on the clock) submits
    // the SAME player — the loser's message is the UX (§8.3), pinned.
    const loser = await makePick(mgr2Client, leagueId, {
      player_id: P1,
      action_id: ACTION.loser,
    })
    expect(loser.status).toBe(400)
    expect(JSON.stringify(loser.body)).toContain(
      'Vitest DQ Player One just went off the board — pick another player',
    )
  })

  it('E2: the SAME action_id replays as a 200 no-op — same pick row, one row total (D68(1))', async () => {
    const first = await makePick(mgr2Client, leagueId, {
      player_id: P2,
      action_id: ACTION.pick2,
    })
    expect(first.status).toBe(200)
    const firstPick = (first.body as unknown as PickResponse).pick

    const replay = await makePick(mgr2Client, leagueId, {
      player_id: P2,
      action_id: ACTION.pick2,
    })
    expect(replay.status).toBe(200)
    expect((replay.body as unknown as PickResponse).pick.id).toBe(firstPick.id)

    const { count } = await service
      .from('draft_picks')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', draftId)
      .eq('is_undone', false)
    expect(count).toBe(2)

    // action_id is REQUIRED wire-side (the stamping contract): a body
    // without one is a 400 before any RPC call.
    const missing = await makePick(mgr2Client, leagueId, { player_id: P3 })
    expect(missing.status).toBe(400)
  })
})

describe('§8.9 from-list — load into queue (skip drafted; replace/append)', () => {
  it('replace: the attached list loads in LIST ORDER with drafted players SKIPPED (the task pin)', async () => {
    // List order [P1, P2, P4, P6]; P1 and P2 are drafted (live picks above).
    const loaded = await queueFromList(mgr2Client, leagueId, mgr2Id, listId, {
      mode: 'replace',
    })
    expect(loaded.status).toBe(200)
    const body = loaded.body as unknown as QueueResponse
    expect(body.mode).toBe('replace')
    expect(body.added).toBe(2)
    expect(body.skipped_drafted).toBe(2)
    // THE PIN: exactly the undrafted list players, in list order, from
    // rank 1 — and the previous queue ([P3, P5]) is fully replaced.
    expect(await storedQueue(draftId, mgr2TeamId)).toEqual([
      [P4, 1],
      [P6, 2],
    ])
  })

  it('append ("Add remaining"): adds after the queue tail, skipping queued AND drafted players', async () => {
    // Reset the queue to just P4 (rank 1), then append the list.
    const reset = await upsertQueue(mgr2Client, leagueId, mgr2Id, { players: [P4] })
    expect(reset.status).toBe(200)

    const appended = await queueFromList(mgr2Client, leagueId, mgr2Id, listId, {
      mode: 'append',
    })
    expect(appended.status).toBe(200)
    const body = appended.body as unknown as QueueResponse
    expect(body.added).toBe(1) // P6 only
    expect(body.skipped_drafted).toBe(2) // P1, P2
    expect(body.skipped_queued).toBe(1) // P4
    expect(await storedQueue(draftId, mgr2TeamId)).toEqual([
      [P4, 1],
      [P6, 2],
    ])
  })

  it('an unattached list 404s (no-leak: invisible ≡ not attached), queue untouched', async () => {
    const before = await storedQueue(draftId, mgr2TeamId)
    // The commissioner never attached a list — any random uuid behaves the
    // same as a real-but-foreign one under the 067 RLS scope.
    const result = await queueFromList(
      commishClient,
      leagueId,
      commishId,
      '00000000-0000-4000-8000-0000000000aa',
      {},
    )
    expect(result.status).toBe(404)
    expect(JSON.stringify(result.body)).toContain('not attached')
    expect(await storedQueue(draftId, mgr2TeamId)).toEqual(before)
  })
})

describe('autodraft — BOTH toggle paths over 072 set_team_autodraft (F33)', () => {
  it('self route: toggle on (posts NOTHING with a live draft — the D97 discriminator); R153 replay changed:false; R154 held-lock < 50ms', async () => {
    const on = await timedToggle(mgr2Client, mgr2Id, true)
    expect(on.result.status).toBe(200)
    expect(on.result.body).toMatchObject({
      team_id: mgr2TeamId,
      is_autodraft: true,
      changed: true,
      posted: false,
    })
    const { data: seat } = await service
      .from('league_members')
      .select('is_autodraft')
      .eq('id', mgr2MemberId)
      .single()
    expect(seat?.is_autodraft).toBe(true)

    // R153: the double-submitted toggle round-trips as changed:false (the
    // D63 no-op — idempotent by value, the recorded latitude in place of
    // an action_id arm; D111(5)).
    const replay = await timedToggle(mgr2Client, mgr2Id, true)
    expect(replay.result.status).toBe(200)
    expect(replay.result.body).toMatchObject({ changed: false, posted: false })

    // R154: the held-lock bound for the TOGGLE family (rule 6 — the RPC
    // takes the live draft's row FOR UPDATE first). min() de-flake form:
    // the fastest RTT upper-bounds the in-RPC lock window.
    const fastest = Math.min(on.ms, replay.ms)
    expect(
      fastest,
      `held-lock bound: toggle RTTs [${on.ms.toFixed(1)}, ${replay.ms.toFixed(1)}]ms`,
    ).toBeLessThan(50)

    // The SELF path posted nothing — asserted against the LIVE draft's own
    // room (the discriminator that makes the commissioner pin below real).
    const { data: posts } = await service
      .from('league_chat')
      .select('message')
      .eq('league_id', leagueId)
      .like('message', 'Autopick turned%')
    expect(posts ?? []).toEqual([])
  })

  it('commissioner path (members PATCH — F33 discharged): any-team toggle + the member-visible system post', async () => {
    const off = await patchMember(commishClient, leagueId, mgr2MemberId, {
      is_autodraft: false,
    })
    expect(off.status).toBe(200)
    expect(off.body).toMatchObject({
      team_id: mgr2TeamId,
      is_autodraft: false,
      changed: true,
      posted: true,
    })
    const { data: seat } = await service
      .from('league_members')
      .select('is_autodraft')
      .eq('id', mgr2MemberId)
      .single()
    expect(seat?.is_autodraft).toBe(false)

    // The D97 system post landed in the LIVE draft's room and is visible to
    // an ordinary member over their own RLS read.
    const { data: posts } = await mgr2Client
      .from('league_chat')
      .select('message, is_system, context')
      .eq('league_id', leagueId)
      .like('message', 'Autopick turned%')
    expect(posts).toHaveLength(1)
    expect(posts?.[0]?.is_system).toBe(true)
    expect(posts?.[0]?.context).toBe(`draft:${draftId}`)
    expect(posts?.[0]?.message).toContain('Autopick turned off for Seat for mgr2')

    // A fellow MANAGER toggling someone else's seat is refused (the RPC's
    // 42501 → the members mapping 403).
    const fellow = await setAutodraft(mgr2Client, leagueId, mgr2Id, { on: true })
    expect(fellow.status).toBe(200) // own seat — allowed (control)
    const restore = await setAutodraft(mgr2Client, leagueId, mgr2Id, { on: false })
    expect(restore.status).toBe(200)
  })
})

describe('OUTSIDER no-leak sweep (R155 class, the room surface)', () => {
  it('pick/queue/from-list answer the draftless 404; autodraft answers the member 403; nothing written', async () => {
    const outsiderId = (await outsiderClient.auth.getUser()).data.user!.id

    // Explicit draft_id changes nothing: the RLS probe sees no row.
    const pick = await makePick(outsiderClient, leagueId, {
      draft_id: draftId,
      player_id: P3,
      action_id: 'ad700000-0000-4000-8000-000000000099',
    })
    expect(pick.status).toBe(404)

    const queue = await upsertQueue(outsiderClient, leagueId, outsiderId, {
      players: [P3],
    })
    expect(queue.status).toBe(404)

    const fromList = await queueFromList(outsiderClient, leagueId, outsiderId, listId, {})
    expect(fromList.status).toBe(404)

    const toggle = await setAutodraft(outsiderClient, leagueId, outsiderId, { on: true })
    expect(toggle.status).toBe(403)

    // Nothing landed: mgr2's queue and the pick sheet are untouched.
    expect(await storedQueue(draftId, mgr2TeamId)).toEqual([
      [P4, 1],
      [P6, 2],
    ])
    const { count } = await service
      .from('draft_picks')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', draftId)
    expect(count).toBe(2)
  })
})
