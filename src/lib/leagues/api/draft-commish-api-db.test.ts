/**
 * draft-commish-api-db.test.ts — L.B2.3 at the WIRE layer: the §15.2
 * commissioner control block (`pauseOrResumeDraft` / `undoDraft` /
 * `reassignPick` / `forcePick` / `movePlayer` / `resetDraft` / `setClock`
 * + the post-start order dispatch in `patchDraftOrder`) and the mock
 * surface (`launchMockDraft` / `listMockDrafts` / `deleteMockDraft`),
 * driven over the LOCAL stack through PostgREST by real signed-in users —
 * the exact composition the Route Handlers run (the D68 wire-suite
 * convention; pgTAP 023/025 own the RPC-side matrices).
 *
 * What this suite owns (the task's item 3):
 *   - the per-route AUTH SWEEP: a plain manager answers 403 on EVERY
 *     commissioner verb (§17 matrix row "Draft: pause/undo/reassign/move/
 *     reset — Manager: —"); an outsider answers the no-leak 404;
 *   - pause→resume CLOCK INTEGRITY over the wire: the resumed deadline is
 *     exactly `updated_at + deadline_remaining_ms` (both stamped by the
 *     same transaction now() — §8.7 v2.0 "clocks never gain/lose time";
 *     ±2ms tolerance for ISO-serialization µs truncation only, the
 *     ms-exact pin proper lives in pgTAP 023);
 *   - the POST-START ORDER DISPATCH (E31): an order PATCH on a live draft
 *     reaches `draft_set_order` and the REMAINING picks re-derive (the
 *     on-clock team flips to the new order's slot); `reason` REQUIRED
 *     (D97), randomize refused (D114);
 *   - the MOCK lifecycle over the routes: launch (201) → same-action_id
 *     replay (200 `created:false`, the SAME mock — D110(11)) → GET lists
 *     it active (launcher-scoped) → pause/resume by the LAUNCHER riding
 *     the SAME two RPCs (commissioner refused — D110(1)) → DELETE
 *     (launcher-only) → gone from GET;
 *   - CAP refusals surfaced as friendly 4xx (§22.5: the 4th active mock
 *     answers a 400 naming the 3-active cap);
 *   - every OTHER §8.7 control refusing mocks outright (D110(1)).
 *
 * LIVE-CRON SAFETY (the 022/068 concurrent-actor rule): 300s pick clock
 * (no timeout can land mid-test), `cpu_speed: 'realistic'` on every mock
 * (CPU think ≥ 20% × 300s = 60s — no CPU pick inside the test window),
 * nobody calls draft_touch (the outage arm's never-connected exemption; a
 * mock's E59 stale-pause after ~35s only flips live→paused, which changes
 * no assertion here), draft_scheduled_at FAR FUTURE (2027 — F49), and
 * `draft_reset` clears the stored instant (D107(5)) so the reset league
 * is never auto-start bait.
 *
 * Requires the local stack — D59(5); FAILS loudly when the stack is down,
 * never skips (§4.3). Determinism: fixed emails/usernames/action-ids
 * (prefix ad8 — ad0–ad7 belong to the sibling suites, the D108(14)
 * registry), fixed player fixtures, cleanup-first.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import {
  deleteMockDraft,
  forcePick,
  launchMockDraft,
  listMockDrafts,
  makePick,
  movePlayer,
  patchDraftOrder,
  pauseOrResumeDraft,
  POST_START_RANDOMIZE_MESSAGE,
  POST_START_REASON_REQUIRED_MESSAGE,
  reassignPick,
  resetDraft,
  setClock,
  startDraft,
  undoDraft,
} from './draft-service'
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

const LEAGUE_NAME = 'vitest-draft-commish-api-league'
const DRAFT_INSTANT = '2027-09-05T17:00:00+00:00'

const COMMISH = {
  email: 'draft-commish-api-commish@fieldscout.test',
  password: 'pgtap-draft-pass-1',
  username: 'dcapi_wire_commish',
}
const MGR2 = {
  email: 'draft-commish-api-mgr2@fieldscout.test',
  password: 'pgtap-draft-pass-2',
  username: 'dcapi_wire_mgr_two',
}
const OUTSIDER = {
  email: 'draft-commish-api-outsider@fieldscout.test',
  password: 'pgtap-draft-pass-3',
  username: 'dcapi_wire_outsider',
}

const PLAYERS = [
  { id: 'vitest-dcapi-p1', full_name: 'Vitest DCAPI Player One', position: 'RB' },
  { id: 'vitest-dcapi-p2', full_name: 'Vitest DCAPI Player Two', position: 'RB' },
  { id: 'vitest-dcapi-p3', full_name: 'Vitest DCAPI Player Three', position: 'WR' },
] as const
const [P1, P2, P3] = PLAYERS.map((p) => p.id)

const ACTION = {
  create: 'ad800000-0000-4000-8000-000000000001',
  pick1: 'ad800000-0000-4000-8000-000000000011',
  force1: 'ad800000-0000-4000-8000-000000000021',
  forceSweep: 'ad800000-0000-4000-8000-000000000022',
  force2: 'ad800000-0000-4000-8000-000000000023',
  force3: 'ad800000-0000-4000-8000-000000000024',
  mockLaunch1: 'ad800000-0000-4000-8000-000000000031',
  mockLaunch2: 'ad800000-0000-4000-8000-000000000032',
  mockLaunch3: 'ad800000-0000-4000-8000-000000000033',
  mockLaunch4: 'ad800000-0000-4000-8000-000000000034',
} as const

/** Harness minting for the route's `mintActionId` dep — each launch test
 *  passes its own fixed id, so nothing here is random. */
const mintFixed = (id: string) => ({ mintActionId: () => id })

interface DraftBody {
  draft: Database['public']['Tables']['drafts']['Row']
  created?: boolean
  pick?: Database['public']['Tables']['draft_picks']['Row']
  /** `draft_undo` only (069 §6). */
  undone_count?: number
  rewound_to_pick?: number
}
interface MockListBody {
  active: { id: string; status: string }[]
  recaps: { id: string; status: string }[]
}

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let mgr2Client: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let mgr2Id: string
let leagueId: string
let draftId: string
let commishTeamId: string
let mgr2TeamId: string
let placeholderIds: string[] = []
let mock1Id: string
let mock2Id: string
let mock3Id: string

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) {
    await service.auth.admin.deleteUser(row.id)
  }
}

/**
 * ORPHAN HEALING (observed 2026-08-05, this suite's first parallel run):
 * the signup trigger swallows a `profiles_username_key` collision
 * (handle_new_user's WHEN OTHERS arm), so a race can mint an auth user
 * with NO profiles row — invisible to the username-keyed cleanup above,
 * poisoning every subsequent run with "already registered". Recover the
 * orphan's id by signing in with the fixture's FIXED credentials (the
 * orphan was created confirmed with this exact password), then delete it.
 * NOT admin.listUsers — that endpoint 500s permanently on this stack
 * (GoTrue cannot scan the seed.sql users' NULL confirmation_token).
 * The heal path never runs on a healthy rerun.
 */
async function deleteOrphanByCredentials(user: {
  email: string
  password: string
}): Promise<void> {
  const probe = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { data, error } = await probe.auth.signInWithPassword(user)
  if (error || !data.user) {
    throw new Error(
      `orphan heal failed for ${user.email}: cannot recover the auth id ` +
        `(sign-in said: ${error?.message ?? 'no user'})`,
    )
  }
  const { error: deleteError } = await service.auth.admin.deleteUser(data.user.id)
  if (deleteError) {
    throw new Error(`orphan delete failed for ${user.email}: ${deleteError.message}`)
  }
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').eq('name', LEAGUE_NAME)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
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
  for (const u of [COMMISH, MGR2, OUTSIDER]) {
    await deleteUserByUsername(u.username)
  }
}

async function createUser(user: {
  email: string
  password: string
  username: string
}): Promise<string> {
  const attempt = () =>
    service.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: { username: user.username },
    })
  let { data, error } = await attempt()
  if (error?.message.includes('already been registered')) {
    // A profile-less orphan from a swallowed trigger failure — heal + retry.
    await deleteOrphanByCredentials(user)
    ;({ data, error } = await attempt())
  }
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`)
  const created = data.user
  if (!created) throw new Error(`createUser returned no user for ${user.email}`)
  // The profile row is load-bearing (username invites + cleanup) — verify
  // the trigger actually created it instead of swallowing a collision.
  const { data: profile } = await service
    .from('profiles')
    .select('id')
    .eq('id', created.id)
    .maybeSingle()
  if (!profile) {
    throw new Error(
      `signup trigger created NO profile for ${user.email} — ` +
        'a swallowed profiles_username_key collision (stale fixture user?)',
    )
  }
  return created.id
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

/** Stub entropy for patchDraftOrder calls that never randomize. */
const noEntropy = { randomValues: () => [] as number[] }

beforeAll(async () => {
  await cleanup()
  await createUser(COMMISH)
  mgr2Id = await createUser(MGR2)
  await createUser(OUTSIDER)
  commishClient = await signIn(COMMISH)
  mgr2Client = await signIn(MGR2)
  outsiderClient = await signIn(OUTSIDER)

  await service.from('players').upsert([...PLAYERS])

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
  placeholderIds = []
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
  commishTeamId = commishMember.team_id

  // Manual order [commish, mgr2, placeholders…]; 300s clock; far-future
  // instant (live-cron safety, header note).
  const configured = await patchLeague(commishClient, leagueId, {
    settings: {
      draft: {
        draft_scheduled_at: DRAFT_INSTANT,
        draft_order_mode: 'manual',
        draft_order: [commishTeamId, mgr2TeamId, ...placeholderIds],
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
}, 120_000)

afterAll(async () => {
  await cleanup()
})

// ---------------------------------------------------------------------------
// A. Mock surface (league `scheduled` — §8.8's launch window)
// ---------------------------------------------------------------------------

describe('mock routes — launch / replay / list / launcher lifecycle (§8.8; D110)', () => {
  it('launch answers 201 created:true; the SAME action_id replays as 200 created:false with the SAME mock (D110(11))', async () => {
    // mgr2 — a plain member, NOT a commissioner — is the launcher (the
    // sharpest D110(1) shape: role never authorizes the mock surface).
    const launched = await launchMockDraft(mgr2Client, leagueId, {}, mintFixed(ACTION.mockLaunch1))
    expect(launched.status).toBe(201)
    const body = launched.body as unknown as DraftBody
    expect(body.created).toBe(true)
    expect(body.draft.is_mock).toBe(true)
    expect(body.draft.status).toBe('live')
    mock1Id = body.draft.id

    const replay = await launchMockDraft(mgr2Client, leagueId, {}, mintFixed(ACTION.mockLaunch1))
    expect(replay.status).toBe(200)
    const replayBody = replay.body as unknown as DraftBody
    expect(replayBody.created).toBe(false)
    expect(replayBody.draft.id).toBe(mock1Id)

    // One mock row total — the replay launched nothing.
    const { count } = await service
      .from('drafts')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .eq('is_mock', true)
    expect(count).toBe(1)
  })

  it('GET is launcher-scoped: mgr2 sees the active mock; the commissioner sees NONE of it', async () => {
    const mine = await listMockDrafts(mgr2Client, leagueId, mgr2Id)
    expect(mine.status).toBe(200)
    const mineBody = mine.body as unknown as MockListBody
    expect(mineBody.active.map((row) => row.id)).toEqual([mock1Id])
    expect(mineBody.recaps).toEqual([])

    // The commissioner launched nothing — role grants no window into a
    // member's solo practice (D110(1)).
    const commishId = (await commishClient.auth.getUser()).data.user!.id
    const theirs = await listMockDrafts(commishClient, leagueId, commishId)
    expect(theirs.status).toBe(200)
    expect((theirs.body as unknown as MockListBody).active).toEqual([])
  })

  it('pause/resume ride the SAME route, LAUNCHER-only: the commissioner is refused, the launcher pauses and resumes (D110(1)/E59)', async () => {
    // Commissioner pause on the mock → the RPC's friendly launcher-only
    // refusal (P0001 → 400) — role confers nothing on a mock.
    const commishPause = await pauseOrResumeDraft(commishClient, leagueId, {
      draft_id: mock1Id,
      action: 'pause',
    })
    expect(commishPause.status).toBe(400)
    expect(JSON.stringify(commishPause.body)).toContain('only the member practicing this mock')

    // The launcher pauses… (this is the E59 resumable-card state)
    const paused = await pauseOrResumeDraft(mgr2Client, leagueId, {
      draft_id: mock1Id,
      action: 'pause',
    })
    expect(paused.status).toBe(200)
    expect((paused.body as unknown as DraftBody).draft.status).toBe('paused')

    // …and resumes — the E59 comeback path L.B3.5's card will call.
    const resumed = await pauseOrResumeDraft(mgr2Client, leagueId, {
      draft_id: mock1Id,
      action: 'resume',
    })
    expect(resumed.status).toBe(200)
    expect((resumed.body as unknown as DraftBody).draft.status).toBe('live')
  })

  it('every OTHER §8.7 control refuses mocks outright (D110(1))', async () => {
    const undo = await undoDraft(commishClient, leagueId, { draft_id: mock1Id })
    expect(undo.status).toBe(400)
    expect(JSON.stringify(undo.body)).toContain('mock drafts have no commissioner controls')

    const clock = await setClock(commishClient, leagueId, {
      draft_id: mock1Id,
      pick_timer_seconds: 60,
    })
    expect(clock.status).toBe(400)
    expect(JSON.stringify(clock.body)).toContain('mock drafts have no commissioner controls')
  })

  it('the 4th active mock is a FRIENDLY 4xx naming the 3-active cap (§22.5)', async () => {
    const m2 = await launchMockDraft(mgr2Client, leagueId, {}, mintFixed(ACTION.mockLaunch2))
    expect(m2.status).toBe(201)
    mock2Id = (m2.body as unknown as DraftBody).draft.id
    const m3 = await launchMockDraft(mgr2Client, leagueId, {}, mintFixed(ACTION.mockLaunch3))
    expect(m3.status).toBe(201)
    mock3Id = (m3.body as unknown as DraftBody).draft.id

    const m4 = await launchMockDraft(mgr2Client, leagueId, {}, mintFixed(ACTION.mockLaunch4))
    expect(m4.status).toBe(400)
    expect(JSON.stringify(m4.body)).toContain('3 active mock drafts')
  })

  it('DELETE is launcher-only: the commissioner is refused, the launcher deletes, GET no longer lists it', async () => {
    const commishDelete = await deleteMockDraft(commishClient, leagueId, mock1Id)
    expect(commishDelete.status).toBe(400)
    expect(JSON.stringify(commishDelete.body)).toContain('only the member who launched this mock')

    const gone = await deleteMockDraft(mgr2Client, leagueId, mock1Id)
    expect(gone.status).toBe(200)
    expect(gone.body).toMatchObject({ deleted: true, draft_id: mock1Id })

    const after = await listMockDrafts(mgr2Client, leagueId, mgr2Id)
    expect((after.body as unknown as MockListBody).active.map((row) => row.id).sort()).toEqual(
      [mock2Id, mock3Id].sort(),
    )

    // No-leak: an unknown/cross-league id answers the same 404.
    const unknown = await deleteMockDraft(mgr2Client, leagueId, mock1Id)
    expect(unknown.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// B. Commissioner controls on the REAL draft (started here; the live mocks
//    m2/m3 coexist — E60)
// ---------------------------------------------------------------------------

describe('commissioner control routes over PostgREST (§8.7/§15.2/§17)', () => {
  let pick1Id: string

  beforeAll(async () => {
    const started = await startDraft(commishClient, leagueId)
    if (started.status !== 200) throw new Error(`startDraft failed: ${JSON.stringify(started.body)}`)
    draftId = (started.body as unknown as DraftBody).draft.id

    // Pick 1 (commish, P1) — material for undo/reassign/move below.
    const pick1 = await makePick(commishClient, leagueId, {
      player_id: P1,
      action_id: ACTION.pick1,
    })
    if (pick1.status !== 200) throw new Error(`pick 1 failed: ${JSON.stringify(pick1.body)}`)
    pick1Id = (pick1.body as unknown as DraftBody).pick!.id
  }, 60_000)

  it('AUTH SWEEP: a plain manager answers 403 on EVERY commissioner verb (§17); an outsider answers the no-leak 404', async () => {
    const managerCalls: [string, Promise<{ status: number; body: unknown }>][] = [
      ['pause', pauseOrResumeDraft(mgr2Client, leagueId, { action: 'pause' })],
      ['resume', pauseOrResumeDraft(mgr2Client, leagueId, { action: 'resume' })],
      ['undo', undoDraft(mgr2Client, leagueId, {})],
      [
        'reassign',
        reassignPick(mgr2Client, leagueId, { pick_id: pick1Id, team_id: mgr2TeamId }),
      ],
      [
        'force-pick',
        forcePick(mgr2Client, leagueId, { player_id: P2, action_id: ACTION.forceSweep }),
      ],
      [
        'move-player',
        movePlayer(mgr2Client, leagueId, {
          player_id: P1,
          from_team: commishTeamId,
          to_team: mgr2TeamId,
        }),
      ],
      ['reset', resetDraft(mgr2Client, leagueId, {})],
      ['clock', setClock(mgr2Client, leagueId, { pick_timer_seconds: 120 })],
    ]
    for (const [verb, call] of managerCalls) {
      const result = await call
      expect(result.status, `manager on ${verb}`).toBe(403)
      expect(JSON.stringify(result.body), `manager on ${verb}`).toContain(
        'Only the commissioner can manage the draft',
      )
    }

    // The post-start order PATCH is the same §8.7 control: manager 403.
    const managerOrder = await patchDraftOrder(
      mgr2Client,
      leagueId,
      { order: [mgr2TeamId, commishTeamId, ...placeholderIds], reason: 'nope' },
      noEntropy,
    )
    expect(managerOrder.status).toBe(403)

    // Outsider: the RLS probe sees no draft — the no-leak 404 (R155 class).
    const outsiderPause = await pauseOrResumeDraft(outsiderClient, leagueId, { action: 'pause' })
    expect(outsiderPause.status).toBe(404)

    // Nothing changed: the draft is still live on pick 2.
    const { data: draft } = await service
      .from('drafts')
      .select('status, current_pick_number')
      .eq('id', draftId)
      .single()
    expect(draft).toMatchObject({ status: 'live', current_pick_number: 2 })
  })

  it('pause → resume CLOCK INTEGRITY over the wire: resumed deadline = updated_at + the persisted remaining (§8.7 v2.0)', async () => {
    const paused = await pauseOrResumeDraft(commishClient, leagueId, {
      action: 'pause',
      reason: 'wire clock-integrity check',
    })
    expect(paused.status).toBe(200)
    const pausedDraft = (paused.body as unknown as DraftBody).draft
    expect(pausedDraft.status).toBe('paused')
    const remaining = pausedDraft.deadline_remaining_ms
    expect(remaining).not.toBeNull()
    // A 300s clock paused seconds after the pick began: the persisted
    // remaining is positive and never exceeds the full clock.
    expect(remaining!).toBeGreaterThan(0)
    expect(remaining!).toBeLessThanOrEqual(300_000)

    const resumed = await pauseOrResumeDraft(commishClient, leagueId, { action: 'resume' })
    expect(resumed.status).toBe(200)
    const resumedDraft = (resumed.body as unknown as DraftBody).draft
    expect(resumedDraft.status).toBe('live')
    expect(resumedDraft.deadline_remaining_ms).toBeNull()
    // current_deadline and updated_at are stamped by the SAME transaction
    // now() (069), so their wire difference IS the restored remaining.
    // ±2ms tolerance: ISO serialization truncates µs — the ms-exact pin
    // proper is pgTAP 023's.
    const gapMs =
      new Date(resumedDraft.current_deadline as string).getTime() -
      new Date(resumedDraft.updated_at as string).getTime()
    expect(Math.abs(gapMs - remaining!)).toBeLessThanOrEqual(2)
  })

  it('undo (single) rewinds pick 1; force-pick re-picks it as made_via=commissioner (E4 + the force wire path; F57/090 pause-first over the wire)', async () => {
    // F57 ALIGNED (migration 090): the live undo is a 400 with the aligned
    // sentence — the route-layer surfacing of pause-first on snake.
    const liveUndo = await undoDraft(commishClient, leagueId, {
      reason: 'live undo (must refuse — F57/090)',
    })
    expect(liveUndo.status).toBe(400)
    expect(JSON.stringify(liveUndo.body)).toContain(
      'draft_undo: pause the draft first — commissioner controls run on a paused board (§8.7 v2.12.5)',
    )

    const paused = await pauseOrResumeDraft(commishClient, leagueId, { action: 'pause' })
    expect(paused.status).toBe(200)
    const undone = await undoDraft(commishClient, leagueId, { reason: 'wire undo check' })
    expect(undone.status).toBe(200)
    const afterUndo = (undone.body as unknown as DraftBody).draft
    expect(afterUndo.current_pick_number).toBe(1)
    expect(afterUndo.on_clock_team_id).toBe(commishTeamId)
    const resumed = await pauseOrResumeDraft(commishClient, leagueId, { action: 'resume' })
    expect(resumed.status).toBe(200)

    const forced = await forcePick(commishClient, leagueId, {
      player_id: P1,
      action_id: ACTION.force1,
      reason: 'wire force check',
    })
    expect(forced.status).toBe(200)
    const forcedBody = forced.body as unknown as DraftBody
    expect(forcedBody.pick!.player_id).toBe(P1)
    expect(forcedBody.pick!.made_via).toBe('commissioner')
    expect(forcedBody.draft.current_pick_number).toBe(2)
  })

  it('POST-START ORDER DISPATCH (E31): reason required, randomize refused, and the remaining picks RE-DERIVE from the new order', async () => {
    const newOrder = [commishTeamId, placeholderIds[0], mgr2TeamId, ...placeholderIds.slice(1)]

    // The D97 gate: an order body on a live draft without a reason is 400.
    const noReason = await patchDraftOrder(commishClient, leagueId, { order: newOrder }, noEntropy)
    expect(noReason.status).toBe(400)
    expect(JSON.stringify(noReason.body)).toContain(POST_START_REASON_REQUIRED_MESSAGE)

    // The D114 gate: mid-draft randomize is not a control.
    const randomize = await patchDraftOrder(
      commishClient,
      leagueId,
      { randomize: true, reason: 'chaos' },
      { randomValues: (n) => Array.from({ length: n }, () => 0.5) },
    )
    expect(randomize.status).toBe(400)
    expect(JSON.stringify(randomize.body)).toContain(POST_START_RANDOMIZE_MESSAGE)

    // THE WIRE PIN: the dispatch reaches draft_set_order and pick 2 —
    // slot 2 of round 1 — re-derives to the NEW order's second team
    // (placeholder 1, not mgr2). Completed pick 1 stands.
    const dispatched = await patchDraftOrder(
      commishClient,
      leagueId,
      { order: newOrder, reason: 'mid-draft order correction (E31 wire pin)' },
      noEntropy,
    )
    expect(dispatched.status).toBe(200)
    const draft = (dispatched.body as unknown as DraftBody).draft
    expect(draft.current_pick_number).toBe(2)
    expect(draft.on_clock_team_id).toBe(placeholderIds[0])
    expect(draft.draft_order).toEqual(newOrder)

    // Pick 1 (completed) is untouched by the re-derive.
    const { data: pick1 } = await service
      .from('draft_picks')
      .select('team_id, is_undone')
      .eq('id', pick1Id)
      .single()
    expect(pick1).toMatchObject({ team_id: commishTeamId, is_undone: true })
  })

  it('clock edit, reassign, and move-player round-trip over the wire (E15 + the §8.7 correction pair) — behind a pause (F57/090)', async () => {
    const paused = await pauseOrResumeDraft(commishClient, leagueId, {
      action: 'pause',
      reason: 'pause-first edits (F57/090)',
    })
    expect(paused.status).toBe(200)
    const clock = await setClock(commishClient, leagueId, {
      pick_timer_seconds: 600,
      reason: 'wire clock edit',
    })
    expect(clock.status).toBe(200)
    const clockConfig = (clock.body as unknown as DraftBody).draft.config as {
      pick_timer_seconds?: number
    }
    expect(clockConfig.pick_timer_seconds).toBe(600)

    // Reassign the live pick-1 row's player P1 → P2 (a correction).
    const { data: livePick1 } = await service
      .from('draft_picks')
      .select('id')
      .eq('draft_id', draftId)
      .eq('pick_number', 1)
      .eq('is_undone', false)
      .single()
    const reassigned = await reassignPick(commishClient, leagueId, {
      pick_id: livePick1!.id,
      player_id: P2,
      reason: 'wire reassign check',
    })
    expect(reassigned.status).toBe(200)
    const { data: corrected } = await service
      .from('draft_picks')
      .select('player_id, team_id')
      .eq('id', livePick1!.id)
      .single()
    expect(corrected!.player_id).toBe(P2)

    // Move P2 from the commissioner's team to mgr2's.
    const moved = await movePlayer(commishClient, leagueId, {
      player_id: P2,
      from_team: commishTeamId,
      to_team: mgr2TeamId,
      reason: 'wire move check',
    })
    expect(moved.status).toBe(200)
    const { data: afterMove } = await service
      .from('draft_picks')
      .select('team_id')
      .eq('id', livePick1!.id)
      .single()
    expect(afterMove!.team_id).toBe(mgr2TeamId)

    // **F77 (discharged at L.C3.2)** — the SNAKE consumers of the shared
    // P0002 arm: an unknown player on reassign (090:671) and on move
    // (090:947) answer 404 with the RPC's OWN sentence. The status was
    // always right; "League not found" named the one thing that HAD been
    // found. Still paused — these verbs are pause-first (090/F57).
    const badReassign = await reassignPick(commishClient, leagueId, {
      pick_id: livePick1!.id,
      player_id: 'vitest-dc-no-such-player',
      reason: 'F77 arm',
    })
    expect(badReassign.status).toBe(404)
    expect(JSON.stringify(badReassign.body)).toContain(
      'player vitest-dc-no-such-player not found',
    )
    expect(JSON.stringify(badReassign.body)).not.toContain('League not found')

    const badMove = await movePlayer(commishClient, leagueId, {
      player_id: 'vitest-dc-no-such-player',
      from_team: mgr2TeamId,
      to_team: commishTeamId,
      reason: 'F77 arm',
    })
    expect(badMove.status).toBe(404)
    expect(JSON.stringify(badMove.body)).toContain('player vitest-dc-no-such-player not found')
    expect(JSON.stringify(badMove.body)).not.toContain('League not found')

    const resumed = await pauseOrResumeDraft(commishClient, leagueId, { action: 'resume' })
    expect(resumed.status).toBe(200)
  })

  it('undo CASCADE over the wire: `to_pick_number: 0` is the FULL rewind — every pick reverted, pick 1 back on the clock (E4; R160/R162)', async () => {
    // Give the cascade something to cascade over: force pick 2 for the team
    // the E31 re-derive put on the clock (placeholder 1 of the new order).
    // **F77's third consumer (R425's enumeration)** — `draft_force_pick`'s
    // own P0002 (`player % not found`, 087:2144/2252) through the same
    // shared arm. Driven here because force-pick is LIVE-only, and this is
    // the suite's live moment.
    const forcedUnknown = await forcePick(commishClient, leagueId, {
      player_id: 'vitest-dc-no-such-player',
      action_id: 'dc700000-0000-4000-8000-0000000000f7',
      reason: 'F77 arm',
    })
    expect(forcedUnknown.status).toBe(404)
    expect(JSON.stringify(forcedUnknown.body)).toContain(
      'player vitest-dc-no-such-player not found',
    )
    expect(JSON.stringify(forcedUnknown.body)).not.toContain('League not found')

    const forced2 = await forcePick(commishClient, leagueId, {
      player_id: P3,
      action_id: ACTION.force2,
      reason: 'wire cascade setup',
    })
    expect(forced2.status).toBe(200)
    const forced2Body = forced2.body as unknown as DraftBody
    expect(forced2Body.pick!.pick_number).toBe(2)
    expect(forced2Body.draft.current_pick_number).toBe(3)

    // Pause-first (F57/090): the cascade runs behind a pause.
    const paused = await pauseOrResumeDraft(commishClient, leagueId, { action: 'pause' })
    expect(paused.status).toBe(200)

    // THE R160 PIN: 0 passes the wire schema (`min(0)`, not `min(1)`) and
    // reaches 069's `>= 0` arm, which undoes every pick > 0 — the full
    // rewind. `min(1)` here would 400 as a shape error and make the
    // RPC-legal full cascade unreachable over the wire.
    const cascade = await undoDraft(commishClient, leagueId, {
      to_pick_number: 0,
      reason: 'wire cascade check (full rewind)',
    })
    expect(cascade.status).toBe(200)
    const cascadeBody = cascade.body as unknown as DraftBody
    expect(cascadeBody.undone_count).toBe(2)
    expect(cascadeBody.rewound_to_pick).toBe(1)
    expect(cascadeBody.draft.current_pick_number).toBe(1)
    expect(cascadeBody.draft.current_round).toBe(1)
    // Slot 1 of the E31 order is the commissioner's team.
    expect(cascadeBody.draft.on_clock_team_id).toBe(commishTeamId)
    // The draft is still PAUSED (the cascade ran behind the F57/090 pause;
    // reset is the other operation — it would have flipped the league to
    // `scheduled` and cleared the stored instant).
    expect(cascadeBody.draft.status).toBe('paused')

    const { count: liveCount } = await service
      .from('draft_picks')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', draftId)
      .eq('is_undone', false)
    expect(liveCount).toBe(0)

    // Resume, then restore ONE live pick so the reset test that follows
    // still proves "every pick soft-undone" against a non-empty board (this
    // cascade must run BEFORE reset — undo needs a live/paused draft, and
    // force-pick needs the live board).
    const resumed = await pauseOrResumeDraft(commishClient, leagueId, { action: 'resume' })
    expect(resumed.status).toBe(200)
    const restored = await forcePick(commishClient, leagueId, {
      player_id: P1,
      action_id: ACTION.force3,
      reason: 'wire cascade teardown (restore a live pick for the reset pin)',
    })
    expect(restored.status).toBe(200)
  })

  it('reset returns draft AND league to scheduled with every pick soft-undone (§8.7; D107(5) seam held)', async () => {
    const reset = await resetDraft(commishClient, leagueId, { reason: 'wire reset check' })
    expect(reset.status).toBe(200)
    expect((reset.body as unknown as DraftBody).draft.status).toBe('scheduled')

    const { data: league } = await service
      .from('leagues')
      .select('status, settings')
      .eq('id', leagueId)
      .single()
    expect(league!.status).toBe('scheduled')
    // The stored instant is CLEARED (D107(5)) — the reset league is never
    // the auto-start arm's bait.
    const draftSettings = (league!.settings as { draft?: { draft_scheduled_at?: unknown } }).draft
    expect(draftSettings?.draft_scheduled_at ?? null).toBeNull()

    const { count: liveCount } = await service
      .from('draft_picks')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', draftId)
      .eq('is_undone', false)
    expect(liveCount).toBe(0)
  })
})
