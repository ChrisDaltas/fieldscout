/**
 * rate-limits-db.test.ts — §22.5 rate limits ON THE WIRE (M7 L.F2.6;
 * migration 209; PROGRESS D700–D706).
 *
 * pgTAP 159 owns the DB matrix (form, gate, the sliding window at boundary
 * instants, isolation, the chat guard inside one transaction). This suite
 * proves what pgTAP cannot: over real JWTs through PostgREST,
 *   1. the door spends the CALLER's own allowance — 10 mutations, then a
 *      refusal naming the wait; another member is untouched;
 *   2. a member's 6th chat post in 10 s comes back as HTTP **429** with a
 *      **Retry-After** header and the plain-words message — PostgREST honours
 *      209's PGRST envelope; nothing was posted.
 *
 * Requires the local stack with 209 applied (D59(5)); FAILS loudly when the
 * stack is down, never skips. Fixed emails / usernames / ids, cleanup-first.
 * The window is real time (10 s) and the suite finishes well inside it; the
 * cleanup clears the ledger rows so a re-run starts empty.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const USER_A = { email: 'ratelimit-a@fieldscout.test', password: 'pgtap-ratelimit-pass-1', username: 'rlw_wire_alpha' }
const USER_B = { email: 'ratelimit-b@fieldscout.test', password: 'pgtap-ratelimit-pass-2', username: 'rlw_wire_bravo' }
const LEAGUE_ID = 'b2090000-0000-4000-8000-000000000001'

const service = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

let clientA: SupabaseClient
let clientB: SupabaseClient
let tokenA: string
let userA: string
let userB: string

async function cleanup(): Promise<void> {
  const { error: chatErr } = await service.from('league_chat').delete().eq('league_id', LEAGUE_ID)
  if (chatErr) throw new Error(`cleanup: league_chat: ${chatErr.message}`)
  await service.from('league_members').delete().eq('league_id', LEAGUE_ID)
  await service.from('leagues').delete().eq('id', LEAGUE_ID)
  for (const u of [USER_A, USER_B]) {
    const { data } = await service.from('profiles').select('id').eq('username', u.username)
    for (const row of data ?? []) {
      const { error } = await service.from('rate_limit_hits').delete().eq('user_id', row.id)
      if (error) throw new Error(`cleanup: rate_limit_hits: ${error.message}`)
      await service.auth.admin.deleteUser(row.id)
    }
  }
  const { data: left } = await service.from('leagues').select('id').eq('id', LEAGUE_ID)
  if ((left ?? []).length !== 0) throw new Error('cleanup: the fixture league survived')
}

async function createUser(user: typeof USER_A): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { username: user.username },
  })
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`)
  return data.user.id
}

async function signIn(user: typeof USER_A): Promise<{ client: SupabaseClient; token: string }> {
  const client = createClient(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signInWithPassword(user)
  if (error || !data.session) throw new Error(`sign-in failed for ${user.email}: ${error?.message}`)
  return { client, token: data.session.access_token }
}

beforeAll(async () => {
  await cleanup()
  userA = await createUser(USER_A)
  userB = await createUser(USER_B)
  const { error: leagueErr } = await service.from('leagues').insert({
    id: LEAGUE_ID,
    owner_id: userA,
    name: 'rlw Wire League',
    season: 2097,
    status: 'setup',
    team_count: 8,
    settings: {},
    roster_settings: {
      starting_slots: [{ key: 'qb', label: 'QB', eligible: ['QB'], count: 1 }],
      bench: 4,
      ir_slots: [],
      swap_spots: 0,
    },
  })
  if (leagueErr) throw new Error(`league insert: ${leagueErr.message}`)
  const { error: memberErr } = await service.from('league_members').insert([
    { league_id: LEAGUE_ID, user_id: userA, role: 'commissioner' },
    { league_id: LEAGUE_ID, user_id: userB, role: 'manager' },
  ])
  if (memberErr) throw new Error(`members insert: ${memberErr.message}`)
  const a = await signIn(USER_A)
  clientA = a.client
  tokenA = a.token
  clientB = (await signIn(USER_B)).client
})

afterAll(async () => {
  await cleanup()
})

describe('the door over a real JWT', () => {
  it('10 mutations, then a refusal that names the wait; another member is untouched', async () => {
    const answers: Array<{ allowed: boolean; remaining: number; retry_after_ms: number }> = []
    for (let i = 0; i < 11; i++) {
      const { data, error } = await clientA.rpc('rate_limit_take', { p_bucket: 'mutation', p_scope: LEAGUE_ID })
      if (error) throw new Error(`rate_limit_take: ${error.message}`)
      answers.push(data)
    }
    expect(answers.slice(0, 10).map((a) => a.allowed)).toEqual(Array(10).fill(true))
    expect(answers[9].remaining).toBe(0)
    expect(answers[10].allowed).toBe(false)
    expect(answers[10].retry_after_ms).toBeGreaterThan(0)
    expect(answers[10].retry_after_ms).toBeLessThanOrEqual(10_000)

    const { data: other, error } = await clientB.rpc('rate_limit_take', { p_bucket: 'mutation', p_scope: LEAGUE_ID })
    if (error) throw new Error(`rate_limit_take (B): ${error.message}`)
    expect(other).toMatchObject({ allowed: true, remaining: 9 })
  })

  it('an unknown scope is refused by name, not counted', async () => {
    const { error } = await clientA.rpc('rate_limit_take', {
      p_bucket: 'mutation',
      p_scope: 'b2090000-0000-4000-8000-0000000000ff',
    })
    expect(error?.code).toBe('22023')
    expect(error?.message).toBe('rate_limit: unknown league or draft')
  })

  it('the ledger is closed to the member (no reading or clearing his own wait)', async () => {
    // The premise: A's row exists (the door wrote it above) — a 0 below is RLS, not emptiness.
    const { data: seen } = await service.from('rate_limit_hits').select('bucket').eq('user_id', userA)
    expect((seen ?? []).length).toBeGreaterThanOrEqual(1)

    const { data: read, error: readErr } = await clientA.from('rate_limit_hits').select('*')
    expect(readErr).toBeNull()
    expect(read).toEqual([])
    const { data: deleted, error: delErr } = await clientA.from('rate_limit_hits').delete().eq('user_id', userA).select()
    expect(delErr).toBeNull()
    expect(deleted).toEqual([])
    const { error: insErr } = await clientA
      .from('rate_limit_hits')
      .insert({ user_id: userA, bucket: 'bid', scope: LEAGUE_ID, hits: [] })
    expect(insErr?.code).toBe('42501')

    const { data: after } = await service.from('rate_limit_hits').select('bucket').eq('user_id', userA)
    expect((after ?? []).length).toBe((seen ?? []).length)
  })
})

describe('chat over the wire: the 6th post in 10 s is a 429 with Retry-After', () => {
  it('five land; the sixth is HTTP 429, Retry-After, plain words — and was not posted', async () => {
    for (let i = 1; i <= 5; i++) {
      const { error } = await clientA
        .from('league_chat')
        .insert({ league_id: LEAGUE_ID, user_id: userA, message: `wire ${i}`, context: 'league', is_system: false })
      if (error) throw new Error(`post ${i}: ${error.message}`)
    }

    const res = await fetch(`${LOCAL_URL}/rest/v1/league_chat`, {
      method: 'POST',
      headers: {
        apikey: LOCAL_ANON_KEY,
        Authorization: `Bearer ${tokenA}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ league_id: LEAGUE_ID, user_id: userA, message: 'wire 6', context: 'league', is_system: false }),
    })
    expect(res.status).toBe(429)
    const retryAfter = Number(res.headers.get('retry-after'))
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(10)
    const body = (await res.json()) as { code: string; message: string }
    expect(body.code).toBe('rate_limited')
    expect(body.message).toBe(
      `You're sending messages too fast. Wait ${retryAfter} ${retryAfter === 1 ? 'second' : 'seconds'} and send it again — that message wasn't posted.`,
    )

    // supabase-js (the composer's path) sees the same refusal as an error, never a silent success.
    const { error: jsErr } = await clientA
      .from('league_chat')
      .insert({ league_id: LEAGUE_ID, user_id: userA, message: 'wire 7', context: 'league', is_system: false })
    expect(jsErr?.code).toBe('rate_limited')

    const { data: rows } = await service.from('league_chat').select('message').eq('league_id', LEAGUE_ID).eq('user_id', userA)
    expect((rows ?? []).map((r) => r.message).sort()).toEqual(['wire 1', 'wire 2', 'wire 3', 'wire 4', 'wire 5'])

    // Another member's allowance is his own.
    const { error: bErr } = await clientB
      .from('league_chat')
      .insert({ league_id: LEAGUE_ID, user_id: userB, message: 'b here', context: 'league', is_system: false })
    expect(bErr).toBeNull()
  })
})
