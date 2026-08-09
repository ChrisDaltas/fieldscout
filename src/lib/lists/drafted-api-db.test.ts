/**
 * drafted-api-db.test.ts — **LV.1.2** at the WIRE layer: migration 079's
 * `list_player_drafted` and the D2 read/set/clear surface, driven against the
 * LOCAL Supabase stack through PostgREST with real signed-in users, through
 * the SERVICE layer that actually ships (`drafted-service.ts`).
 *
 * pgTAP 028 owns the exhaustive DB-side matrix (shape pins, policy set,
 * grants, per-role deny-by-default, the composite FK, immutability). This
 * suite proves the two things pgTAP cannot: the production service
 * composition (friendly, specific 4xxs; idempotent replays; `changed` telling
 * a no-op from a write), and that the policies hold over real JWTs on the
 * wire rather than over `set_config` inside one transaction.
 *
 * The three claims the LV.1.2 DoD names explicitly, each proven in BOTH
 * directions so no pin can pass against an empty table:
 *   1. user B cannot READ user A's marks — B's read of the very same list
 *      returns [] while A's returns the mark;
 *   2. user B cannot WRITE A's marks — a spoofed insert is 42501 and a
 *      targeted delete affects 0 rows, with A's row shown surviving after;
 *   3. a user CAN mark drafted on a list they do NOT own — the Saved-list
 *      case D2 exists for — with A's and B's marks on that shared list shown
 *      to be independent.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips.
 *
 * Determinism: FIXED emails/usernames/slugs/player ids + cleanup-first. No
 * wall-clock, no randomness. Usernames are prefixed `lpd_` — distinct from
 * every other stack suite's fixture namespace.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  CANNOT_MARK_MESSAGE,
  clearDrafted,
  LIST_NOT_FOUND_MESSAGE,
  listDrafted,
  PLAYER_NOT_ON_LIST_MESSAGE,
  setDrafted,
} from './drafted-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const USER_A = {
  email: 'drafted-a@fieldscout.test',
  password: 'pgtap-drafted-pass-1',
  username: 'lpd_wire_alpha',
}
const USER_B = {
  email: 'drafted-b@fieldscout.test',
  password: 'pgtap-drafted-pass-2',
  username: 'lpd_wire_bravo',
}

/** `players` is app-read-only; service-role fixtures are the house move. */
const PLAYERS = [
  { id: 'vitest-lpd-p1', full_name: 'Vitest LPD Player One', position: 'RB' },
  { id: 'vitest-lpd-p2', full_name: 'Vitest LPD Player Two', position: 'WR' },
  { id: 'vitest-lpd-p3', full_name: 'Vitest LPD Player Three', position: 'TE' },
] as const

const ABSENT_LIST_ID = '99999999-0000-4000-8000-00000000dead'

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let clientA: SupabaseClient<Database>
let clientB: SupabaseClient<Database>
let userA: string
let userB: string
let publicListId: string // owned by A, PUBLIC — the shared/saved board
let privateListId: string // owned by A, PRIVATE — invisible to B

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) {
    await service.auth.admin.deleteUser(row.id)
  }
}

async function cleanup(): Promise<void> {
  for (const u of [USER_A, USER_B]) {
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

/** Privileged read — the "the row really is there" control behind every
 *  0-affected assertion below. Bypasses RLS deliberately. */
async function privilegedMarkCount(userId: string, listId: string): Promise<number> {
  const { count, error } = await service
    .from('list_player_drafted')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('list_id', listId)
  if (error) throw new Error(`privileged count failed: ${error.message}`)
  return count ?? 0
}

function draftedIds(body: unknown): string[] {
  return (body as { drafted: string[] }).drafted
}

beforeAll(async () => {
  await cleanup()
  userA = await createUser(USER_A)
  userB = await createUser(USER_B)
  // The pre-leagues free-account cap trigger (one private list) fires for
  // every role; A holds a Big Board plus two fixture lists.
  await service.from('profiles').update({ is_pro: true }).eq('id', userA)
  clientA = await signIn(USER_A)
  clientB = await signIn(USER_B)

  await service.from('players').upsert([...PLAYERS])

  const { data: pub, error: pubError } = await clientA
    .from('lists')
    .insert({
      owner_id: userA,
      title: 'lpd wire public board',
      slug: 'lpd-wire-pub',
      is_private: false,
    })
    .select('id')
    .single()
  if (pubError) throw new Error(`public list insert failed: ${pubError.message}`)
  publicListId = pub.id

  const { data: priv, error: privError } = await clientA
    .from('lists')
    .insert({
      owner_id: userA,
      title: 'lpd wire private board',
      slug: 'lpd-wire-priv',
      is_private: true,
    })
    .select('id')
    .single()
  if (privError) throw new Error(`private list insert failed: ${privError.message}`)
  privateListId = priv.id

  const { error: lpError } = await clientA.from('list_players').insert([
    { list_id: publicListId, player_id: PLAYERS[0].id, position: 1, overall_rank: 1 },
    { list_id: publicListId, player_id: PLAYERS[1].id, position: 2, overall_rank: 2 },
    { list_id: privateListId, player_id: PLAYERS[0].id, position: 1, overall_rank: 1 },
  ])
  if (lpError) throw new Error(`list_players insert failed: ${lpError.message}`)
}, 60_000)

afterAll(async () => {
  await cleanup()
})

describe('drafted marks — the happy path and its idempotency (D2)', () => {
  it('starts empty, and an empty read is a 200 with an explicit list_id', async () => {
    const result = await listDrafted(clientA, publicListId, userA)
    expect(result.status).toBe(200)
    expect(draftedIds(result.body)).toEqual([])
    expect((result.body as { list_id: string }).list_id).toBe(publicListId)
  })

  it('marks a player and reports changed:true, then reads him back', async () => {
    const marked = await setDrafted(clientA, publicListId, userA, {
      player_id: PLAYERS[0].id,
      drafted: true,
    })
    expect(marked.status).toBe(200)
    expect(marked.body).toMatchObject({ drafted: true, changed: true })

    const read = await listDrafted(clientA, publicListId, userA)
    expect(draftedIds(read.body)).toEqual([PLAYERS[0].id])
  })

  it('replaying the same mark is a no-op, not a second row or an inversion', async () => {
    const replay = await setDrafted(clientA, publicListId, userA, {
      player_id: PLAYERS[0].id,
      drafted: true,
    })
    expect(replay.status).toBe(200)
    // changed:false is the whole reason the wire takes a desired STATE rather
    // than a blind toggle — a retried checkbox must not un-mark the player.
    expect(replay.body).toMatchObject({ drafted: true, changed: false })
    expect(await privilegedMarkCount(userA, publicListId)).toBe(1)
  })

  it('un-marks, and replaying the un-mark is likewise a no-op', async () => {
    const cleared = await setDrafted(clientA, publicListId, userA, {
      player_id: PLAYERS[0].id,
      drafted: false,
    })
    expect(cleared.body).toMatchObject({ drafted: false, changed: true })

    const replay = await setDrafted(clientA, publicListId, userA, {
      player_id: PLAYERS[0].id,
      drafted: false,
    })
    expect(replay.body).toMatchObject({ drafted: false, changed: false })
    expect(await privilegedMarkCount(userA, publicListId)).toBe(0)
  })
})

describe('DoD claim 3 — a user CAN mark drafted on a list they do not own', () => {
  it("B marks a player on A's public list without touching A's list", async () => {
    const result = await setDrafted(clientB, publicListId, userB, {
      player_id: PLAYERS[0].id,
      drafted: true,
    })
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ drafted: true, changed: true })
    expect(await privilegedMarkCount(userB, publicListId)).toBe(1)

    // The Saved-list guarantee: nothing about A's list changed.
    const { data: rows } = await service
      .from('list_players')
      .select('player_id')
      .eq('list_id', publicListId)
    expect((rows ?? []).map((r) => r.player_id).sort()).toEqual(
      [PLAYERS[0].id, PLAYERS[1].id].sort(),
    )
  })

  it('A and B hold marks for the SAME (list, player) independently', async () => {
    await setDrafted(clientA, publicListId, userA, {
      player_id: PLAYERS[0].id,
      drafted: true,
    })
    expect(await privilegedMarkCount(userA, publicListId)).toBe(1)
    expect(await privilegedMarkCount(userB, publicListId)).toBe(1)

    // ...and A un-marking does not disturb B — the exact collision a
    // `list_players.drafted` column would have lost (D2's "cheaper bug").
    await setDrafted(clientA, publicListId, userA, {
      player_id: PLAYERS[0].id,
      drafted: false,
    })
    expect(await privilegedMarkCount(userA, publicListId)).toBe(0)
    expect(await privilegedMarkCount(userB, publicListId)).toBe(1)

    await setDrafted(clientA, publicListId, userA, {
      player_id: PLAYERS[0].id,
      drafted: true,
    })
  })
})

describe('DoD claim 1 — B cannot READ A\'s marks (proven both directions)', () => {
  it("B's read of the same list returns only B's marks, A's returns only A's", async () => {
    // Both users hold a mark on PLAYERS[0]; A additionally holds PLAYERS[1].
    await setDrafted(clientA, publicListId, userA, {
      player_id: PLAYERS[1].id,
      drafted: true,
    })

    const readA = await listDrafted(clientA, publicListId, userA)
    const readB = await listDrafted(clientB, publicListId, userB)
    expect(draftedIds(readA.body).sort()).toEqual([PLAYERS[0].id, PLAYERS[1].id].sort())
    expect(draftedIds(readB.body)).toEqual([PLAYERS[0].id])

    // The positive control: A's second mark demonstrably exists, so B's
    // shorter list is isolation rather than an empty table.
    expect(await privilegedMarkCount(userA, publicListId)).toBe(2)
  })

  it("a raw table read from B's client scoped to A's user_id returns zero rows", async () => {
    const { data, error } = await clientB
      .from('list_player_drafted')
      .select('player_id')
      .eq('user_id', userA)
      .eq('list_id', publicListId)
    expect(error).toBeNull()
    expect(data).toEqual([])
    expect(await privilegedMarkCount(userA, publicListId)).toBe(2)
  })
})

describe("DoD claim 2 — B cannot WRITE A's marks", () => {
  it("a spoofed insert as A from B's client is refused by RLS (42501)", async () => {
    const { error } = await clientB.from('list_player_drafted').insert({
      user_id: userA,
      list_id: publicListId,
      player_id: PLAYERS[1].id,
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it("B deleting A's marks affects zero rows, and A's marks survive", async () => {
    const before = await privilegedMarkCount(userA, publicListId)
    expect(before).toBe(2)

    const { data, error } = await clientB
      .from('list_player_drafted')
      .delete()
      .eq('user_id', userA)
      .eq('list_id', publicListId)
      .select('player_id')
    expect(error).toBeNull()
    expect(data).toEqual([])
    expect(await privilegedMarkCount(userA, publicListId)).toBe(2)
  })

  it('nobody can UPDATE a mark — not even the user who owns it', async () => {
    // 079 ships no UPDATE policy on purpose: row presence is the entire
    // state. Proven from the OWNER's client, because a stranger being blocked
    // would not prove immutability.
    const { data, error } = await clientA
      .from('list_player_drafted')
      .update({ drafted_at: '2030-01-01T00:00:00Z' })
      .eq('user_id', userA)
      .eq('list_id', publicListId)
      .select('player_id')
    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: rows } = await service
      .from('list_player_drafted')
      .select('drafted_at')
      .eq('user_id', userA)
      .eq('list_id', publicListId)
    expect(rows).toHaveLength(2)
    for (const row of rows ?? []) {
      expect(row.drafted_at.startsWith('2030')).toBe(false)
    }
  })
})

describe('a list B cannot open is a 404, never an empty result', () => {
  it("B reading A's private list gets 404 with the reason, not []", async () => {
    const result = await listDrafted(clientB, privateListId, userB)
    expect(result.status).toBe(404)
    expect(result.body).toEqual({ error: LIST_NOT_FOUND_MESSAGE })
  })

  it("B marking on A's private list gets 404 from the route probe", async () => {
    const result = await setDrafted(clientB, privateListId, userB, {
      player_id: PLAYERS[0].id,
      drafted: true,
    })
    expect(result.status).toBe(404)
    expect(result.body).toEqual({ error: LIST_NOT_FOUND_MESSAGE })
    expect(await privilegedMarkCount(userB, privateListId)).toBe(0)
  })

  it('RLS — not the route probe — is what actually stops the write', async () => {
    // Bypass the service entirely: a direct insert of B's OWN row against A's
    // private list. If 079's INSERT policy ever loses its EXISTS, this goes
    // green and the 404 above becomes decorative.
    const { error } = await clientB.from('list_player_drafted').insert({
      user_id: userB,
      list_id: privateListId,
      player_id: PLAYERS[0].id,
    })
    expect(error?.code).toBe('42501')
    expect(await privilegedMarkCount(userB, privateListId)).toBe(0)
  })

  it('a 42501 the probe cannot foresee becomes a friendly 403, not a 500', async () => {
    // Drive the service so the list probe PASSES (A can read A's public list)
    // and the insert is still refused — here by naming B as the mark's owner
    // while holding A's client. That is the only way to reach the 42501 arm
    // through setDrafted, and it pins the code→copy mapping.
    const result = await setDrafted(clientA, publicListId, userB, {
      player_id: PLAYERS[1].id,
      drafted: true,
    })
    expect(result.status).toBe(403)
    expect(result.body).toEqual({ error: CANNOT_MARK_MESSAGE })
    expect(await privilegedMarkCount(userB, publicListId)).toBe(1) // unchanged
  })

  it('an unknown list id is 404, and a non-UUID id is 404 too', async () => {
    expect((await listDrafted(clientA, ABSENT_LIST_ID, userA)).status).toBe(404)
    expect((await listDrafted(clientA, 'not-a-uuid', userA)).status).toBe(404)
    expect((await setDrafted(clientA, ABSENT_LIST_ID, userA, {
      player_id: PLAYERS[0].id,
      drafted: true,
    })).status).toBe(404)
  })
})

describe('a player who is not on the list cannot be marked', () => {
  it('names the reason rather than storing a mark nothing will render', async () => {
    const result = await setDrafted(clientA, publicListId, userA, {
      player_id: PLAYERS[2].id,
      drafted: true,
    })
    expect(result.status).toBe(404)
    expect(result.body).toEqual({ error: PLAYER_NOT_ON_LIST_MESSAGE })
  })

  it('and the DB refuses it too, independently of the route probe', async () => {
    const { error } = await clientA.from('list_player_drafted').insert({
      user_id: userA,
      list_id: publicListId,
      player_id: PLAYERS[2].id,
    })
    // 079's composite FK — (list_id, player_id) → list_players.
    expect(error?.code).toBe('23503')
  })

  it('removing a player from the list takes every mark for him with it', async () => {
    expect(await privilegedMarkCount(userA, publicListId)).toBe(2)

    const { error } = await clientA
      .from('list_players')
      .delete()
      .eq('list_id', publicListId)
      .eq('player_id', PLAYERS[1].id)
    expect(error).toBeNull()

    const read = await listDrafted(clientA, publicListId, userA)
    expect(draftedIds(read.body)).toEqual([PLAYERS[0].id])
    expect(await privilegedMarkCount(userA, publicListId)).toBe(1)

    // Restore the fixture for the clear-drafted block below.
    await clientA
      .from('list_players')
      .insert({ list_id: publicListId, player_id: PLAYERS[1].id, position: 2, overall_rank: 2 })
  })
})

describe('clear drafted (LV.3.9\'s options-menu action)', () => {
  it('clears only my marks, on only this list, and reports the count', async () => {
    await setDrafted(clientA, publicListId, userA, { player_id: PLAYERS[1].id, drafted: true })
    await setDrafted(clientA, privateListId, userA, { player_id: PLAYERS[0].id, drafted: true })
    expect(await privilegedMarkCount(userA, publicListId)).toBe(2)
    expect(await privilegedMarkCount(userA, privateListId)).toBe(1)
    expect(await privilegedMarkCount(userB, publicListId)).toBe(1)

    const result = await clearDrafted(clientA, publicListId, userA)
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ list_id: publicListId, cleared: 2 })

    expect(await privilegedMarkCount(userA, publicListId)).toBe(0)
    // Another list of mine is untouched; another user's marks on THIS list are
    // untouched. Both are the point of D2's scoping.
    expect(await privilegedMarkCount(userA, privateListId)).toBe(1)
    expect(await privilegedMarkCount(userB, publicListId)).toBe(1)
  })

  it('clearing an already-clear list reports 0 rather than pretending to work', async () => {
    const result = await clearDrafted(clientA, publicListId, userA)
    expect(result.body).toEqual({ list_id: publicListId, cleared: 0 })
  })
})
