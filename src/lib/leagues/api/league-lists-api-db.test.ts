/**
 * league-lists-api-db.test.ts — L.B4.1 at the WIRE layer: migration 067's
 * `league_lists` + the §15.5 attach/list/patch/detach surface against the
 * LOCAL Supabase stack through PostgREST, driving the SERVICE layer
 * (`league-lists-service.ts`) with real signed-in clients. pgTAP 021 owns
 * the exhaustive DB-side matrix (per-role RLS, the D106 composite FK, the
 * one-primary boundary, the shared-private read policies both directions);
 * this suite proves the production service composition: friendly 4xxs,
 * retry-safe replays, the clear-first primary switch, the probe-before-
 * side-effect ordering on BOTH write paths (PATCH's target probe; attach's
 * natural-key probe — R127), and the shared-private reads over real JWTs.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips (§4.3).
 *
 * Determinism: FIXED emails/usernames/action_ids/fixture ids +
 * cleanup-first. No wall-clock or random anywhere (the D3/D17 lint guard
 * covers this file). Action-id prefix `af1` — the D108(14) registry; `af0`
 * belongs to `members-api-db.test.ts` (R161: both suites minted
 * `af000000-…-0001` as a `create_league` key, and `leagues.creation_action_id`
 * is GLOBALLY unique across committed wire leagues, so whichever suite ran
 * second failed its `beforeAll` with "this action_id was already used by
 * another account" — an intermittent full-run failure, pre-existing on main).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { defaultsForTeamCount, splitSettings } from '../settings/league-settings'
import { joinLeague } from './invites-service'
import {
  ALREADY_ATTACHED_MESSAGE,
  attachLeagueList,
  detachLeagueList,
  listLeagueLists,
  NOT_YOUR_LIST_MESSAGE,
  patchLeagueList,
  type LeagueListWithList,
} from './league-lists-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-league-lists-league'
const CREATE_ACTION = 'af100000-0000-4000-8000-000000000001'

const OWNER = {
  email: 'league-lists-owner@fieldscout.test',
  password: 'pgtap-lists-pass-1',
  username: 'lla_owner_one',
}
const MEMBER = {
  email: 'league-lists-member@fieldscout.test',
  password: 'pgtap-lists-pass-2',
  username: 'lla_member_two',
}
const OUTSIDER = {
  email: 'league-lists-outsider@fieldscout.test',
  password: 'pgtap-lists-pass-3',
  username: 'lla_outsider_three',
}

/** Harness player fixtures (players is app-read-only; service-role inserts
 *  are the pgTAP-privileged-fixture move at the wire layer). */
const PLAYERS = [
  { id: 'vitest-lla-p1', full_name: 'Vitest LLA Player One', position: 'RB' },
  { id: 'vitest-lla-p2', full_name: 'Vitest LLA Player Two', position: 'WR' },
] as const

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let ownerClient: SupabaseClient<Database>
let memberClient: SupabaseClient<Database>
let outsiderClient: SupabaseClient<Database>
let ownerId: string
let memberId: string
let outsiderId: string
let leagueId: string
let list1Id: string // owner's private list, 2 players
let list2Id: string // owner's second private list (primary-switch fixture)
let outsiderListId: string
let attach1Id: string // list1's attachment (created in the tests)

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
    await service.from('teams').delete().in('league_id', ids)
    await service.from('leagues').delete().in('id', ids)
  }
  for (const u of [OWNER, MEMBER, OUTSIDER]) {
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

async function signIn(user: {
  email: string
  password: string
}): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

async function createPrivateList(
  client: SupabaseClient<Database>,
  ownerUserId: string,
  title: string,
  slug: string,
): Promise<string> {
  const { data, error } = await client
    .from('lists')
    .insert({ owner_id: ownerUserId, title, slug, is_private: true })
    .select('id')
    .single()
  if (error) throw new Error(`list insert failed (${title}): ${error.message}`)
  return data.id
}

beforeAll(async () => {
  await cleanup()
  ownerId = await createUser(OWNER)
  memberId = await createUser(MEMBER)
  outsiderId = await createUser(OUTSIDER)
  // OWNER holds multiple private lists; the pre-league free-account cap
  // trigger (one private list) fires regardless of role → pro fixture.
  await service.from('profiles').update({ is_pro: true }).eq('id', ownerId)
  ownerClient = await signIn(OWNER)
  memberClient = await signIn(MEMBER)
  outsiderClient = await signIn(OUTSIDER)

  // League via the real create path; MEMBER joins by code (the F5 free path).
  const settings = defaultsForTeamCount(8)
  const { columns, blob } = splitSettings(settings)
  const columnArgs = Object.fromEntries(
    Object.entries(columns).map(([key, value]) => [`p_${key}`, value]),
  )
  const { data: template } = await ownerClient
    .from('scoring_systems')
    .select('id')
    .eq('is_template', true)
    .eq('name', 'ESPN Standard')
    .single()
  const { data: created, error: createError } = await ownerClient.rpc('create_league', {
    p_name: LEAGUE_NAME,
    p_season: 2026,
    p_scoring_system_id: template?.id,
    p_team_name: 'Owner Team',
    p_action_id: CREATE_ACTION,
    p_settings: blob,
    ...columnArgs,
  } as unknown as Database['public']['Functions']['create_league']['Args'])
  if (createError) throw new Error(`create_league failed: ${createError.message}`)
  leagueId = (created as { league_id: string }).league_id

  const { data: league } = await ownerClient
    .from('leagues')
    .select('invite_code')
    .eq('id', leagueId)
    .single()
  const joined = await joinLeague(memberClient, { code: league?.invite_code ?? '' })
  if (joined.status !== 200) {
    throw new Error(`joinLeague failed: ${JSON.stringify(joined.body)}`)
  }

  await service.from('players').upsert([...PLAYERS])

  list1Id = await createPrivateList(ownerClient, ownerId, 'lla wire list one', 'lla-wire-1')
  list2Id = await createPrivateList(ownerClient, ownerId, 'lla wire list two', 'lla-wire-2')
  outsiderListId = await createPrivateList(
    outsiderClient,
    outsiderId,
    'lla outsider list',
    'lla-wire-out',
  )
  const { error: lpError } = await ownerClient.from('list_players').insert([
    { list_id: list1Id, player_id: PLAYERS[0].id, position: 1, overall_rank: 1 },
    { list_id: list1Id, player_id: PLAYERS[1].id, position: 2, overall_rank: 2 },
  ])
  if (lpError) throw new Error(`list_players insert failed: ${lpError.message}`)
}, 60_000)

afterAll(async () => {
  await cleanup()
})

function rowsOf(result: { body: unknown }): LeagueListWithList[] {
  return (result.body as { league_lists: LeagueListWithList[] }).league_lists
}

describe('league-lists API over the local stack (L.B4.1)', () => {
  it('attaches my list, lists it back, and keeps a NON-shared attachment invisible to a fellow member', async () => {
    const attached = await attachLeagueList(ownerClient, leagueId, ownerId, {
      list_id: list1Id,
    })
    expect(attached.status).toBe(201)
    const row = attached.body as unknown as LeagueListWithList
    attach1Id = row.id
    expect(row.shared_with_league).toBe(false)
    expect(row.lists?.title).toBe('lla wire list one')

    const mine = await listLeagueLists(ownerClient, leagueId, ownerId)
    expect(mine.status).toBe(200)
    expect(rowsOf(mine)).toHaveLength(1)

    // The privacy half on the wire: the member sees NO attachment and
    // cannot read the private list or its rows.
    const theirs = await listLeagueLists(memberClient, leagueId, memberId)
    expect(theirs.status).toBe(200)
    expect(rowsOf(theirs)).toHaveLength(0)
    const { data: listRead } = await memberClient.from('lists').select('id').eq('id', list1Id)
    expect(listRead).toHaveLength(0)
    const { data: playersRead } = await memberClient
      .from('list_players')
      .select('id')
      .eq('list_id', list1Id)
    expect(playersRead).toHaveLength(0)
  })

  it('replays an attach as a friendly 409 with no duplicate row (natural-key retry safety)', async () => {
    const replay = await attachLeagueList(ownerClient, leagueId, ownerId, {
      list_id: list1Id,
    })
    expect(replay.status).toBe(409)
    expect(replay.body).toEqual({ error: ALREADY_ATTACHED_MESSAGE })
    const mine = await listLeagueLists(ownerClient, leagueId, ownerId)
    expect(rowsOf(mine)).toHaveLength(1)
  })

  it('PATCH share flips the attachment league-visible: the member reads the attachment, the private list AND its rows', async () => {
    const patched = await patchLeagueList(ownerClient, leagueId, attach1Id, ownerId, {
      shared_with_league: true,
    })
    expect(patched.status).toBe(200)

    const theirs = await listLeagueLists(memberClient, leagueId, memberId)
    expect(theirs.status).toBe(200)
    const rows = rowsOf(theirs)
    expect(rows).toHaveLength(1)
    // The §12.15-note read on a REAL JWT: the embed carries the private list.
    expect(rows[0]?.lists?.title).toBe('lla wire list one')
    const { data: playersRead } = await memberClient
      .from('list_players')
      .select('player_id')
      .eq('list_id', list1Id)
      .order('position', { ascending: true })
    expect(playersRead?.map((p) => p.player_id)).toEqual([PLAYERS[0].id, PLAYERS[1].id])
  })

  it('primary switch is clear-first: promoting one attachment demotes the other, never two primaries', async () => {
    const attached2 = await attachLeagueList(ownerClient, leagueId, ownerId, {
      list_id: list2Id,
      is_primary_board: true,
    })
    expect(attached2.status).toBe(201)
    expect((attached2.body as unknown as LeagueListWithList).is_primary_board).toBe(true)

    const promoted = await patchLeagueList(ownerClient, leagueId, attach1Id, ownerId, {
      is_primary_board: true,
    })
    expect(promoted.status).toBe(200)

    const mine = await listLeagueLists(ownerClient, leagueId, ownerId)
    const primaries = rowsOf(mine).filter((row) => row.is_primary_board)
    expect(primaries).toHaveLength(1)
    expect(primaries[0]?.id).toBe(attach1Id)
  })

  it("PATCH on a FOREIGN (visible, shared) attachment 404s BEFORE any side effect — the caller's own primary survives", async () => {
    // attach1 (owner's, shared) is visible to MEMBER; member first sets
    // their own primary so the ordering bug (clear-then-404) would show.
    const memberList = await createPrivateList(
      memberClient,
      memberId,
      'lla member list',
      'lla-wire-m1',
    )
    const memberAttach = await attachLeagueList(memberClient, leagueId, memberId, {
      list_id: memberList,
      is_primary_board: true,
    })
    expect(memberAttach.status).toBe(201)

    const foreign = await patchLeagueList(memberClient, leagueId, attach1Id, memberId, {
      is_primary_board: true,
    })
    expect(foreign.status).toBe(404)
    expect(foreign.body).toEqual({ error: 'Attachment not found' })

    const theirs = await listLeagueLists(memberClient, leagueId, memberId)
    const memberPrimary = rowsOf(theirs).find((row) => row.owner_id === memberId)
    expect(memberPrimary?.is_primary_board).toBe(true)
  })

  it("attach-as-primary of an ALREADY-attached list 409s BEFORE any side effect — the caller's primary survives (R127)", async () => {
    // State here: owner's attach1 (list1) is PRIMARY; list2's attachment is
    // attached NON-primary. Re-attaching list2 with is_primary_board=true is
    // the R127 case: NOT a byte-identical replay (the original attach was
    // non-primary), so the clear-first `.neq list_id` exclusion alone would
    // demote attach1 and then 409 on the natural key — zero primaries under
    // an error response. The natural-key probe must answer 409 pre-demote.
    const replay = await attachLeagueList(ownerClient, leagueId, ownerId, {
      list_id: list2Id,
      is_primary_board: true,
    })
    expect(replay.status).toBe(409)
    expect(replay.body).toEqual({ error: ALREADY_ATTACHED_MESSAGE })

    const mine = await listLeagueLists(ownerClient, leagueId, ownerId)
    const primaries = rowsOf(mine).filter(
      (row) => row.owner_id === ownerId && row.is_primary_board,
    )
    expect(primaries).toHaveLength(1)
    expect(primaries[0]?.id).toBe(attach1Id)
  })

  it("refuses attaching a list you don't own — friendly 403 at the service, 23503 at the DB backstop", async () => {
    // list1 is VISIBLE to the member (shared) but not theirs.
    const friendly = await attachLeagueList(memberClient, leagueId, memberId, {
      list_id: list1Id,
    })
    expect(friendly.status).toBe(403)
    expect(friendly.body).toEqual({ error: NOT_YOUR_LIST_MESSAGE })

    // Direct PostgREST write (bypassing the service probes): RLS WITH CHECK
    // passes (own owner_id + member) but the D106 composite FK refuses.
    const { error } = await memberClient.from('league_lists').insert({
      league_id: leagueId,
      list_id: list1Id,
      owner_id: memberId,
    })
    expect(error?.code).toBe('23503')
  })

  it('answers a non-member with the no-leak 404 on every verb', async () => {
    const listAll = await listLeagueLists(outsiderClient, leagueId, outsiderId)
    expect(listAll.status).toBe(404)
    const attach = await attachLeagueList(outsiderClient, leagueId, outsiderId, {
      list_id: outsiderListId,
    })
    expect(attach.status).toBe(404)
    expect(attach.body).toEqual({ error: 'League not found' })
  })

  it('detaches non-destructively and replays as 404 (retry-safe; the list survives)', async () => {
    const mine = await listLeagueLists(ownerClient, leagueId, ownerId)
    const attach2 = rowsOf(mine).find((row) => row.list_id === list2Id)
    expect(attach2).toBeDefined()

    const detached = await detachLeagueList(ownerClient, leagueId, attach2?.id ?? '')
    expect(detached.status).toBe(200)
    const replay = await detachLeagueList(ownerClient, leagueId, attach2?.id ?? '')
    expect(replay.status).toBe(404)

    // Non-destructive (§7.4): the LIST is untouched.
    const { data: survivors } = await ownerClient.from('lists').select('id').eq('id', list2Id)
    expect(survivors).toHaveLength(1)
  })
})
