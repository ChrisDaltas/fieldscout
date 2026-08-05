/**
 * draft-api-db.test.ts — L.B2.1 item 3 at the WIRE layer: the §15.2
 * schedule/start surface (`createDraft` / `patchDraftOrder` / `startDraft`
 * in draft-service.ts) plus `getLeagueDetail`'s active-draft summary,
 * driven over the LOCAL stack through PostgREST by real signed-in users —
 * the exact composition the Route Handlers run, minus only the Next cookie
 * plumbing (the D68 wire-suite convention).
 *
 * What this suite owns (pgTAP 020/023 own the RPC-side matrices):
 *   - create → PATCH order → start over the wire (the task-named journey);
 *   - non-commish 403 on all three verbs (42501 → 403 mapping);
 *   - the double-create idempotency (201 then 200/created:false, same row);
 *   - the D95 fence: a schedule field in the draft PATCH body is a 400
 *     (settings PATCH is the only `draft_scheduled_at` writer);
 *   - D101 randomize: the pure injected-entropy shuffle (literal pins) and
 *     the wire path writing its permutation through `draft_set_order`;
 *   - the active-draft summary: is_mock-filtered (a live MOCK row never
 *     surfaces), scheduled instant from settings (D95), gone when complete;
 *   - the post-start order-edit seam 409 (L.B2.3's dispatch).
 *
 * Requires the local stack — D59(5); FAILS loudly when the stack is down,
 * never skips (§4.3). Determinism: fixed emails/usernames/action-ids
 * (prefix ad6 — ad0/1/2/4/5 belong to the sibling suites; committed wire
 * leagues persist between runs and create_league's idempotency key is
 * globally unique), literal entropy for the shuffle, cleanup-first.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Draft } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { createDraft, patchDraftOrder, shuffleTeamIds, startDraft } from './draft-service'
import { claimInvite, createInvite } from './invites-service'
import { getLeagueDetail, patchLeague } from './leagues-service'
import { addPlaceholderSeat } from './members-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-draft-api-league'
const DRAFT_INSTANT = '2026-09-02T17:00:00+00:00'

const COMMISH = {
  email: 'draft-api-commish@fieldscout.test',
  password: 'pgtap-draft-pass-1',
  username: 'da_wire_commish',
}
const MGR2 = {
  email: 'draft-api-mgr2@fieldscout.test',
  password: 'pgtap-draft-pass-2',
  username: 'da_wire_mgr_two',
}

const ACTION = {
  create: 'ad600000-0000-4000-8000-000000000001',
} as const

/** Literal entropy for the randomize wire call — value per Fisher–Yates
 *  step, consumed front-to-back (see shuffleTeamIds). */
const ENTROPY_8 = [0.9, 0.1, 0.9, 0.3, 0.6, 0.05, 0.5, 0.99] as const

interface DraftStateBody {
  draft: Draft
  created?: boolean
  started?: boolean
}
interface DetailBody {
  active_draft: {
    id: string
    status: string
    draft_type: string
    started_at: string | null
    scheduled_at: string | null
  } | null
}

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let commishClient: SupabaseClient<Database>
let mgr2Client: SupabaseClient<Database>
let commishId: string
let leagueId: string
let draftId: string
let sortedTeamIds: string[]

const fixedEntropy = (values: readonly number[]) => (count: number) => {
  if (count > values.length) throw new Error(`entropy fixture too short for ${count} teams`)
  return values.slice(0, count) as number[]
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
  for (const u of [COMMISH, MGR2]) {
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

async function detailFor(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<DetailBody> {
  const result = await getLeagueDetail(client, userId, leagueId)
  if (result.status !== 200) {
    throw new Error(`getLeagueDetail failed (${result.status}): ${JSON.stringify(result.body)}`)
  }
  return result.body as unknown as DetailBody
}

beforeAll(async () => {
  await cleanup()
  commishId = await createUser(COMMISH)
  await createUser(MGR2)
  commishClient = await signIn(COMMISH)
  mgr2Client = await signIn(MGR2)

  // League (8 teams) via the real create path; draft_order_mode stays the
  // catalog default ('random') — draft_start honors the draft-row candidate
  // this suite writes through the PATCH (D101/R123).
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

  // Seat mgr2 on a real franchise (placeholder → username invite → claim),
  // then fill to capacity with placeholders (D96: start requires == 8).
  const seat = await addPlaceholderSeat(commishClient, leagueId, { team_name: 'Seat for mgr2' })
  if (seat.status !== 201) throw new Error(`addPlaceholderSeat failed: ${JSON.stringify(seat.body)}`)
  const invite = await createInvite(commishClient, leagueId, {
    target_team_id: (seat.body as { team_id: string }).team_id,
    invited_username: MGR2.username,
  })
  if (invite.status !== 201) throw new Error(`createInvite failed: ${JSON.stringify(invite.body)}`)
  const claim = await claimInvite(mgr2Client, { token: (invite.body as { token: string }).token })
  if (claim.status !== 200) throw new Error(`claimInvite failed: ${JSON.stringify(claim.body)}`)
  for (let i = 0; i < 6; i++) {
    const fill = await addPlaceholderSeat(commishClient, leagueId, {})
    if (fill.status !== 201) throw new Error(`placeholder fill failed: ${JSON.stringify(fill.body)}`)
  }

  const { data: teams, error: teamsError } = await service
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .neq('status', 'retired')
    .order('id', { ascending: true })
  if (teamsError) throw new Error(`teams read failed: ${teamsError.message}`)
  sortedTeamIds = (teams ?? []).map((t) => t.id)

  // Schedule through the ONLY schedule surface (D95): the settings PATCH.
  const configured = await patchLeague(commishClient, leagueId, {
    settings: { draft: { draft_scheduled_at: DRAFT_INSTANT } },
  })
  if (configured.status !== 200) {
    throw new Error(`configure PATCH failed: ${JSON.stringify(configured.body)}`)
  }
  const scheduled = await patchLeague(commishClient, leagueId, { status: 'scheduled' })
  if (scheduled.status !== 200) {
    throw new Error(`scheduled PATCH failed: ${JSON.stringify(scheduled.body)}`)
  }

  // A live MOCK draft planted privileged (the pgTAP-fixture move): the
  // summary + PATCH probe must NEVER see it (is_mock-filtered; E60 — it
  // legally coexists with the real draft under the D95 partial unique).
  const { error: mockError } = await service.from('drafts').insert({
    league_id: leagueId,
    draft_type: 'snake',
    status: 'live',
    is_mock: true,
    config: {},
  })
  if (mockError) throw new Error(`mock fixture insert failed: ${mockError.message}`)
}, 120_000)

afterAll(async () => {
  await cleanup()
})

describe('shuffleTeamIds — the pure D101 randomize (injected entropy)', () => {
  it('literal pin: 4 ids × [0.9, 0.1, 0.9] → the hand-derived permutation', () => {
    // i=3: floor(0.9×4)=3 → swap(3,3); i=2: floor(0.1×3)=0 → swap(2,0);
    // i=1: floor(0.9×2)=1 → swap(1,1)  ⇒  [c, b, a, d]
    expect(shuffleTeamIds(['a', 'b', 'c', 'd'], [0.9, 0.1, 0.9])).toEqual(['c', 'b', 'a', 'd'])
  })

  it('is deterministic and total: same inputs same output; a value ~1 never indexes out of range', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const values = [0.999999, 0.999999, 0.999999, 0.999999]
    const one = shuffleTeamIds(ids, values)
    expect(shuffleTeamIds(ids, values)).toEqual(one)
    expect([...one].sort()).toEqual([...ids].sort())
    expect(shuffleTeamIds(ids, [])).toEqual(expect.arrayContaining(ids)) // missing values → 0
  })
})

describe('draft schedule/start API over PostgREST (L.B2.1)', () => {
  it('before create: detail active_draft is null (the live MOCK never surfaces) and the order PATCH 404s', async () => {
    const detail = await detailFor(commishClient, commishId)
    expect(detail.active_draft).toBeNull()

    const patched = await patchDraftOrder(
      commishClient,
      leagueId,
      { order: sortedTeamIds },
      { randomValues: fixedEntropy(ENTROPY_8) },
    )
    expect(patched.status).toBe(404)
    expect(JSON.stringify(patched.body)).toContain('No draft is scheduled')
  })

  it('POST create: non-commish 403; commish 201; the double-create replays as 200/created:false with the SAME row', async () => {
    const denied = await createDraft(mgr2Client, leagueId)
    expect(denied.status).toBe(403)

    const created = await createDraft(commishClient, leagueId)
    expect(created.status).toBe(201)
    const body = created.body as unknown as DraftStateBody
    expect(body.created).toBe(true)
    expect(body.draft.status).toBe('scheduled')
    expect(body.draft.is_mock).toBe(false)
    draftId = body.draft.id

    const replayed = await createDraft(commishClient, leagueId)
    expect(replayed.status).toBe(200)
    const replay = replayed.body as unknown as DraftStateBody
    expect(replay.created).toBe(false)
    expect(replay.draft.id).toBe(draftId)

    // Exactly one non-mock draft row exists (the D95 partial unique held).
    const { count } = await service
      .from('drafts')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .eq('is_mock', false)
    expect(count).toBe(1)
  })

  it('detail now carries the summary: id/status/type + the SETTINGS instant (D95), still mock-blind', async () => {
    const detail = await detailFor(mgr2Client, (await mgr2Client.auth.getUser()).data.user!.id)
    expect(detail.active_draft).toEqual({
      id: draftId,
      status: 'scheduled',
      draft_type: 'snake',
      started_at: null,
      scheduled_at: DRAFT_INSTANT,
    })
  })

  it('PATCH order (explicit): non-commish 403; a non-permutation 400s; the commish write lands on drafts.draft_order', async () => {
    const explicit = [...sortedTeamIds].reverse()

    const denied = await patchDraftOrder(
      mgr2Client,
      leagueId,
      { order: explicit },
      { randomValues: fixedEntropy(ENTROPY_8) },
    )
    expect(denied.status).toBe(403)

    const short = await patchDraftOrder(
      commishClient,
      leagueId,
      { order: explicit.slice(0, 7) },
      { randomValues: fixedEntropy(ENTROPY_8) },
    )
    expect(short.status).toBe(400)
    expect(JSON.stringify(short.body)).toContain('every active franchise exactly once')

    const ok = await patchDraftOrder(
      commishClient,
      leagueId,
      { order: explicit },
      { randomValues: fixedEntropy(ENTROPY_8) },
    )
    expect(ok.status).toBe(200)
    const { data: row } = await service
      .from('drafts')
      .select('draft_order')
      .eq('id', draftId)
      .single()
    expect(row?.draft_order).toEqual(explicit)
  })

  it('the D95 fence: a schedule (or any unknown) key in the draft PATCH body is a 400, nothing written', async () => {
    const before = await service.from('drafts').select('draft_order, updated_at').eq('id', draftId).single()
    for (const body of [
      { draft_scheduled_at: '2026-09-09T17:00:00+00:00' },
      { order: sortedTeamIds, draft_scheduled_at: '2026-09-09T17:00:00+00:00' },
      { order: sortedTeamIds, randomize: true }, // both halves — ambiguous
      {}, // neither half
    ]) {
      const result = await patchDraftOrder(commishClient, leagueId, body, {
        randomValues: fixedEntropy(ENTROPY_8),
      })
      expect(result.status).toBe(400)
    }
    const after = await service.from('drafts').select('draft_order, updated_at').eq('id', draftId).single()
    expect(after.data).toEqual(before.data)
  })

  it('PATCH randomize: writes EXACTLY the injected-entropy permutation (wire ≡ pure pin)', async () => {
    const expected = shuffleTeamIds(sortedTeamIds, [...ENTROPY_8])
    const result = await patchDraftOrder(
      commishClient,
      leagueId,
      { randomize: true },
      { randomValues: fixedEntropy(ENTROPY_8) },
    )
    expect(result.status).toBe(200)
    const { data: row } = await service
      .from('drafts')
      .select('draft_order')
      .eq('id', draftId)
      .single()
    expect(row?.draft_order).toEqual(expected)
    // A real shuffle, not a passthrough of the sorted fetch order.
    expect(expected).not.toEqual(sortedTeamIds)
    expect([...(row?.draft_order as string[])].sort()).toEqual(sortedTeamIds)
  })

  it('POST start: non-commish 403; commish 200/started:true honoring the randomized order; league → drafting; re-start is a 200 no-op', async () => {
    const denied = await startDraft(mgr2Client, leagueId)
    expect(denied.status).toBe(403)

    const expectedOrder = shuffleTeamIds(sortedTeamIds, [...ENTROPY_8])
    const started = await startDraft(commishClient, leagueId)
    expect(started.status).toBe(200)
    const body = started.body as unknown as DraftStateBody
    expect(body.started).toBe(true)
    expect(body.draft.status).toBe('live')
    // D101/R123: random mode honors the VALID draft-row candidate as-is —
    // the order the lobby showed is the order that drafts.
    expect(body.draft.draft_order).toEqual(expectedOrder)
    expect(body.draft.on_clock_team_id).toBe(expectedOrder[0])

    const { data: league } = await service
      .from('leagues')
      .select('status, scoring_rules_snapshot')
      .eq('id', leagueId)
      .single()
    expect(league?.status).toBe('drafting')
    expect(league?.scoring_rules_snapshot).not.toBeNull()

    const restart = await startDraft(commishClient, leagueId)
    expect(restart.status).toBe(200)
    expect((restart.body as unknown as DraftStateBody).started).toBe(false)

    // The summary follows the draft into 'live'.
    const detail = await detailFor(commishClient, commishId)
    expect(detail.active_draft?.status).toBe('live')
    expect(detail.active_draft?.started_at).not.toBeNull()
  })

  it('post-start order PATCH → the 409 seam (L.B2.3 dispatch owns live edits)', async () => {
    const result = await patchDraftOrder(
      commishClient,
      leagueId,
      { order: sortedTeamIds },
      { randomValues: fixedEntropy(ENTROPY_8) },
    )
    expect(result.status).toBe(409)
    expect(JSON.stringify(result.body)).toContain('already started')
  })

  it('a COMPLETE draft leaves the summary: active_draft returns to null (harness flip)', async () => {
    // Privileged status flip (harness move) — 'complete' exits the D95
    // active set, so the detail summary and the PATCH probe both go blank.
    const { error } = await service
      .from('drafts')
      .update({ status: 'complete' })
      .eq('id', draftId)
    if (error) throw new Error(`complete flip failed: ${error.message}`)
    const detail = await detailFor(commishClient, commishId)
    expect(detail.active_draft).toBeNull()
  })
})
