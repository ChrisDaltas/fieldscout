/**
 * draft-commish-db.test.ts — L.B1.4 at the WIRE layer: migration 069's
 * commissioner controls against the LOCAL Supabase stack through PostgREST —
 * a real signed-in commissioner pausing, resuming, force-picking, and
 * undoing on a real league, with a real manager reading the system posts.
 * pgTAP 023 owns the exhaustive DB-side matrix (ms-exact pause/resume,
 * cascade golden fixture, the R125 replay pin, E31, the reset seam, the
 * outage arm); this suite proves the production wire path plus the §4.6
 * held-lock bound for the CONTROLS family.
 *
 * CLOCK-INTEGRITY WIRE PINS (no wall clock — server timestamps only, the
 * 068 rewind discipline):
 *  - pause: deadline_remaining_ms vs (pre-pause deadline − paused_at),
 *    both server-written; ±1ms tolerance for the microsecond precision the
 *    JS Date type truncates (Postgres keeps µs; JS keeps ms — the two
 *    operands carry different µs remainders). The EXACT pin is pgTAP 023's.
 *  - resume: current_deadline − updated_at === remaining EXACTLY — both
 *    columns are written from the SAME now() in the same statement, so
 *    their µs remainders are identical and the ms difference is exact even
 *    after JS truncation.
 *
 * HELD-LOCK ASSERTION (tasks-M2 §4.6 / plan §8.3, per RPC family): the
 * fastest control RTT upper-bounds the in-RPC lock window — min() over
 * pause/resume/undo, same de-flaked form as draft-core-db.test.ts.
 *
 * LIVE-CRON SAFETY (the 022/068 concurrent-actor rule): the draft runs a
 * 300s pick clock (the 5s draft-tick cron can never reach a timeout
 * mid-test), the commissioners never call draft_touch (zero liveness rows
 * ⇒ the 069 outage arm's never-connected exemption leaves the draft
 * alone), and draft_scheduled_at is FAR FUTURE (2027 — the F49
 * discipline: committed fixture instants must never become D94 auto-start
 * bait).
 *
 * Requires the local stack — D59(5); FAILS loudly when the stack is down,
 * never skips (§4.3).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { SYNTHETIC_SEASON, seedSyntheticSeason } from '../sim/synthetic-season'
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

const LEAGUE_NAME = 'vitest-draft-commish-league'
/** FAR FUTURE (F49): a committed past instant would be D94 auto-start bait. */
const DRAFT_INSTANT = '2027-09-01T17:00:00+00:00'

const COMMISH = {
  email: 'draft-commish-c@fieldscout.test',
  password: 'pgtap-draft-pass-c1',
  username: 'dcm_wire_commish',
}
const MGR2 = {
  email: 'draft-commish-m2@fieldscout.test',
  password: 'pgtap-draft-pass-c2',
  username: 'dcm_wire_mgr_two',
}

const PLAYERS = [
  { id: 'vitest-dcm-p1', full_name: 'Vitest DCM Player One', position: 'RB' },
  { id: 'vitest-dcm-p2', full_name: 'Vitest DCM Player Two', position: 'RB' },
  { id: 'vitest-dcm-p3', full_name: 'Vitest DCM Player Three', position: 'RB' },
] as const

const ACTION = {
  create: 'ad400000-0000-4000-8000-000000000001',
  pick1: 'ad400000-0000-4000-8000-000000000011',
  pick2: 'ad400000-0000-4000-8000-000000000012',
  force3: 'ad400000-0000-4000-8000-000000000013',
} as const

type DraftRow = Database['public']['Tables']['drafts']['Row']
interface DraftStateResponse {
  draft: DraftRow
  created?: boolean
  started?: boolean
  paused?: boolean
  resumed?: boolean
  undone_count?: number
  rewound_to_pick?: number
}

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let mgr2Client: SupabaseClient<Database>
let leagueId: string
let draftId: string
let orderedTeamIds: string[]
/**
 * min() over the pause/resume RTT samples, carried into the undo test so the
 * §4.6 held-lock bound really spans the header's pause/resume/undo set
 * (R139 — the undo sample was previously asserted only > 0, vacuously).
 * Infinity until the pause/resume test runs, so a solo undo run still
 * asserts against its own sample.
 */
let clockControlMinMs = Number.POSITIVE_INFINITY

/** Server-timestamp parse (data, not a wall-clock read — D3/D17 clean). */
function serverMs(ts: string | null): number {
  if (ts === null) throw new Error('expected a server timestamp, got NULL')
  return new Date(ts).getTime()
}

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
  for (const u of [COMMISH, MGR2]) {
    await deleteUserByUsername(u.username)
  }
}

async function createUser(user: {
  email: string
  password: string
  username: string
}): Promise<void> {
  const { error } = await service.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { username: user.username },
  })
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`)
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

/** Timed control RPC round trip (monotonic harness clock — the D105(9) form). */
async function timedRpc(
  name: 'draft_pause' | 'draft_resume' | 'draft_undo',
  args: Record<string, unknown>,
): Promise<{ response: DraftStateResponse; ms: number }> {
  const startNs = process.hrtime.bigint()
  const { data, error } = await commishClient.rpc(
    name,
    args as never,
  )
  const ms = Number(process.hrtime.bigint() - startNs) / 1e6
  if (error) throw new Error(`${name} failed: ${error.message}`)
  return { response: data as unknown as DraftStateResponse, ms }
}

beforeAll(async () => {
  await cleanup()
  // F215 / R724 / migration 110: starting a real draft pre-flights the §11.7
  // fit against the NFL calendar at now() — this suite creates its league on
  // a SYNTHETIC season so the start never depends on the wall clock.
  await seedSyntheticSeason(service)
  await createUser(COMMISH)
  await createUser(MGR2)
  commishClient = await signIn(COMMISH)
  mgr2Client = await signIn(MGR2)

  await service.from('players').upsert([...PLAYERS])

  // League (8 teams) via the real create_league path; LONG pick clock (the
  // live-cron safety note in the header).
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
    p_season: SYNTHETIC_SEASON, // F215/R724: the fixture owns its calendar (migration 110 pre-flights every draft START against nfl_weeks)
    p_scoring_system_id: template?.id,
    p_team_name: 'Commish Team',
    p_action_id: ACTION.create,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id

  // Seat mgr2 (placeholder → username invite → claim), then fill with
  // placeholders.
  const seat = await addPlaceholderSeat(commishClient, leagueId, {
    team_name: 'Seat for mgr2',
  })
  if (seat.status !== 201) throw new Error(`addPlaceholderSeat failed: ${JSON.stringify(seat.body)}`)
  const mgr2TeamId = (seat.body as { team_id: string }).team_id
  const invite = await createInvite(commishClient, leagueId, {
    target_team_id: mgr2TeamId,
    invited_username: MGR2.username,
  })
  if (invite.status !== 201) throw new Error(`createInvite failed: ${JSON.stringify(invite.body)}`)
  const claim = await claimInvite(mgr2Client, {
    token: (invite.body as { token: string }).token,
  })
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
  orderedTeamIds = [commishMember.team_id, mgr2TeamId, ...placeholderIds]

  const configured = await patchLeague(commishClient, leagueId, {
    settings: {
      draft: {
        draft_scheduled_at: DRAFT_INSTANT,
        draft_order_mode: 'manual',
        draft_order: orderedTeamIds,
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
  draftId = (started as unknown as DraftStateResponse).draft.id
}, 120_000)

afterAll(async () => {
  await cleanup()
})

describe('commissioner controls over PostgREST (migration 069)', () => {
  it('a manager is refused (42501 → the route layer 403s in L.B2.3)', async () => {
    const { error } = await mgr2Client.rpc('draft_pause', { p_draft_id: draftId })
    expect(error?.code).toBe('42501')
  })

  it('pause persists the remaining clock; resume restores it — server timestamps only; held-lock < 50ms (§4.6)', async () => {
    // Deadline before the pause (server-written at draft_start: now()+300s).
    const { data: before } = await service
      .from('drafts')
      .select('current_deadline')
      .eq('id', draftId)
      .single()
    const deadlineBefore = serverMs(before?.current_deadline ?? null)

    const pause = await timedRpc('draft_pause', {
      p_draft_id: draftId,
      p_reason: 'commercial break',
    })
    expect(pause.response.paused).toBe(true)
    expect(pause.response.draft.status).toBe('paused')
    expect(pause.response.draft.current_deadline).toBeNull()
    const remaining = pause.response.draft.deadline_remaining_ms
    expect(remaining).not.toBeNull()
    // ±1ms: the two operands carry different µs remainders (header note).
    const pausedAt = serverMs(pause.response.draft.paused_at)
    expect(Math.abs((remaining as number) - (deadlineBefore - pausedAt))).toBeLessThanOrEqual(1)

    const resume = await timedRpc('draft_resume', { p_draft_id: draftId })
    expect(resume.response.resumed).toBe(true)
    expect(resume.response.draft.status).toBe('live')
    expect(resume.response.draft.deadline_remaining_ms).toBeNull()
    // EXACT: deadline and updated_at are written from the SAME now().
    const restored = serverMs(resume.response.draft.current_deadline)
    const resumedAt = serverMs(resume.response.draft.updated_at)
    expect(restored - resumedAt).toBe(remaining)

    // §4.6 held-lock bound for the controls family (min() de-flake form) —
    // the undo sample joins the bound in the pick/undo test below; assert
    // the two clock controls now and carry the min forward (R139).
    clockControlMinMs = Math.min(pause.ms, resume.ms)
    expect(
      clockControlMinMs,
      `held-lock bound: pause/resume RTTs [${pause.ms.toFixed(1)}, ${resume.ms.toFixed(1)}]ms`,
    ).toBeLessThan(50)
  })

  it('force-pick + cascade undo over the wire; system posts are member-visible', async () => {
    // Picks 1 (commish) and 2 (mgr2) via the ordinary path.
    const { error: p1 } = await commishClient.rpc('draft_make_pick', {
      p_draft_id: draftId,
      p_player_id: PLAYERS[0].id,
      p_action_id: ACTION.pick1,
    })
    expect(p1).toBeNull()
    const { error: p2 } = await mgr2Client.rpc('draft_make_pick', {
      p_draft_id: draftId,
      p_player_id: PLAYERS[1].id,
      p_action_id: ACTION.pick2,
    })
    expect(p2).toBeNull()

    // Pick 3: a placeholder is on the clock — the commissioner picks for
    // it (§8.7 "Pick for a manager").
    const { data: forced, error: forceError } = await commishClient.rpc('draft_force_pick', {
      p_draft_id: draftId,
      p_player_id: PLAYERS[2].id,
      p_action_id: ACTION.force3,
    })
    expect(forceError).toBeNull()
    const forcedPick = (forced as unknown as { pick: { made_via: string; team_id: string } }).pick
    expect(forcedPick.made_via).toBe('commissioner')
    expect(forcedPick.team_id).toBe(orderedTeamIds[2])

    // F57 ALIGNED (migration 090): undo is pause-first on snake too. The
    // live call is refused with the aligned sentence — the wire surfacing
    // of the change — then the cascade runs behind a pause.
    const { error: liveUndoError } = await commishClient.rpc('draft_undo', {
      p_draft_id: draftId,
      p_to_pick_number: 1,
      p_reason: 'live undo (must refuse — F57/090)',
    })
    expect(liveUndoError).not.toBeNull()
    expect(liveUndoError!.message).toBe(
      'draft_undo: pause the draft first — commissioner controls run on a paused board (§8.7 v2.12.5)',
    )
    const pauseForUndo = await timedRpc('draft_pause', { p_draft_id: draftId })
    expect(pauseForUndo.response.draft.status).toBe('paused')

    // Cascade undo back to pick 1: picks 2–3 revert, mgr2 back on the clock.
    const undo = await timedRpc('draft_undo', {
      p_draft_id: draftId,
      p_to_pick_number: 1,
      p_reason: 'redo from pick 2',
    })
    expect(undo.response.undone_count).toBe(2)
    expect(undo.response.rewound_to_pick).toBe(2)
    expect(undo.response.draft.current_pick_number).toBe(2)
    expect(undo.response.draft.on_clock_team_id).toBe(orderedTeamIds[1])
    // R139: fold the undo sample into the §4.6 held-lock bound — the header
    // promises min() over pause/resume/undo, and this completes the set.
    // R143 (batch-5 addendum, recorded limitation — kept deliberately): once
    // pauseResumeMin < 50 the fold cannot flag a slow undo on its own. That
    // is the min() family form's point: §4.6 bounds the SHARED drafts-row
    // lock window (all three controls lock it first), and a systematic hold
    // inflates every sample, so the min catches it; a per-control bound on
    // this SINGLE undo sample would trade the deliberate de-flake property
    // (D105(9): one load spike must not flake the suite) for coverage of
    // undo-specific latency, which is not what §4.6 bounds.
    expect(
      Math.min(clockControlMinMs, undo.ms),
      `held-lock bound (§4.6, min over pause/resume/undo): pause/resume min ${clockControlMinMs.toFixed(1)}ms, undo ${undo.ms.toFixed(1)}ms`,
    ).toBeLessThan(50)

    // Resume for the repick (make_pick needs the live board).
    const resumeAfterUndo = await timedRpc('draft_resume', { p_draft_id: draftId })
    expect(resumeAfterUndo.response.draft.status).toBe('live')

    // Pool restored on the wire: mgr2 re-picks the player pick 3 had taken.
    const { data: repick, error: repickError } = await mgr2Client.rpc('draft_make_pick', {
      p_draft_id: draftId,
      p_player_id: PLAYERS[2].id,
      p_action_id: 'ad400000-0000-4000-8000-000000000021',
    })
    expect(repickError).toBeNull()
    expect(
      (repick as unknown as { pick: { player_id: string } }).pick.player_id,
    ).toBe(PLAYERS[2].id)

    // System posts are member-visible over the wire (D97/§16.3): the
    // MANAGER's client reads every control's post in the draft context.
    const { data: posts, error: postsError } = await mgr2Client
      .from('league_chat')
      .select('message, is_system, user_id, context')
      .eq('league_id', leagueId)
      .eq('context', `draft:${draftId}`)
      .eq('is_system', true)
    expect(postsError).toBeNull()
    const messages = (posts ?? []).map((row) => row.message)
    expect(messages).toHaveLength(6) // pause, resume, force, pause, undo, resume (F57/090: the undo runs behind its own pause)
    expect(messages.some((m) => m.startsWith('Draft paused by'))).toBe(true)
    expect(messages.some((m) => m.startsWith('Draft resumed by'))).toBe(true)
    expect(messages.some((m) => m.startsWith('Pick 3 made by commissioner'))).toBe(true)
    expect(messages.some((m) => m.startsWith('Picks 2-3 undone by'))).toBe(true)
    // Every post carries the acting commissioner (no tick actor in this
    // suite).
    expect((posts ?? []).every((row) => row.user_id !== null)).toBe(true)
  })
})
