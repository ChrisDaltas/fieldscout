/**
 * hardening-wire-db.test.ts — migration 210 (M7 L.F2.8) at the WIRE layer,
 * against the LOCAL Supabase stack: real Storage API uploads and real
 * PostgREST reads with real JWTs. pgTAP 160 owns the catalog matrix; this
 * proves what pgTAP cannot reach.
 *
 *   F715 — every public bucket takes a small image and refuses an HTML file
 *          and an over-size image; a user's avatar upload into his own folder
 *          (the avatar route's exact call) still lands.
 *   F720 — `select('*')` on profiles is refused for anon and for a signed-in
 *          user; the app's named-column read and `is_platform_operator()`
 *          work.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips. Fixed emails /
 * usernames (`hw210_`), cleanup first and last; uploaded objects removed.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PROFILE_READABLE_COLUMNS } from '@/lib/auth/profile-columns'
import type { Database } from '@/types/database'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const USER = { email: 'hw210-user@fieldscout.test', password: 'pgtap-hw210-pass-1', username: 'hw210_user' }
const BUCKETS = ['user-avatars', 'list-thumbnails', 'folder-thumbnails', 'league-avatars'] as const

// A 1×1 transparent PNG.
const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
)
const HTML = new TextEncoder().encode('<!doctype html><title>x</title>')
const OVERSIZE = new Uint8Array(5 * 1024 * 1024 + 1)

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
let user: SupabaseClient<Database>
let userId: string
const uploaded: Array<[string, string]> = []

async function cleanup(): Promise<void> {
  for (const [bucket, p] of uploaded.splice(0)) await service.storage.from(bucket).remove([p])
  const { data } = await service.from('profiles').select('id').eq('username', USER.username)
  for (const row of data ?? []) await service.auth.admin.deleteUser(row.id)
}

beforeAll(async () => {
  await cleanup()
  const { data, error } = await service.auth.admin.createUser({
    email: USER.email,
    password: USER.password,
    email_confirm: true,
    user_metadata: { username: USER.username },
  })
  if (error) throw new Error(`createUser: ${error.message}`)
  userId = data.user.id
  user = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await user.auth.signInWithPassword({ email: USER.email, password: USER.password })
  if (signInError) throw new Error(`signIn: ${signInError.message}`)
})

afterAll(cleanup)

describe('F715 — the public buckets take images only, 5 MiB at most', () => {
  it.each(BUCKETS)('%s takes a small PNG and refuses HTML and an over-size image', async (bucket) => {
    const base = `${userId}/hw210-${bucket}`
    const ok = await service.storage.from(bucket).upload(`${base}.png`, PNG, { contentType: 'image/png', upsert: true })
    expect(ok.error).toBeNull()
    uploaded.push([bucket, `${base}.png`])

    const html = await service.storage.from(bucket).upload(`${base}.html`, HTML, { contentType: 'text/html', upsert: true })
    expect(html.error, 'an HTML file must be refused').not.toBeNull()
    if (!html.error) uploaded.push([bucket, `${base}.html`])

    const big = await service.storage.from(bucket).upload(`${base}-big.png`, OVERSIZE, { contentType: 'image/png', upsert: true })
    expect(big.error, 'a file over 5 MiB must be refused').not.toBeNull()
    if (!big.error) uploaded.push([bucket, `${base}-big.png`])
  })

  it('a signed-in user\'s avatar upload into his own folder still lands (the avatar route\'s call)', async () => {
    const p = `${userId}/hw210-own.png`
    const { error } = await user.storage.from('user-avatars').upload(p, PNG, { cacheControl: '3600', upsert: false, contentType: 'image/png' })
    expect(error).toBeNull()
    uploaded.push(['user-avatars', p])
  })
})

describe('F720 — profiles over PostgREST', () => {
  it('anon: select * is refused, the named columns read', async () => {
    const star = await anon.from('profiles').select('*').eq('id', userId)
    expect(star.error?.code).toBe('42501')
    const named = await anon.from('profiles').select(PROFILE_READABLE_COLUMNS).eq('id', userId).single()
    expect(named.error).toBeNull()
    expect(named.data?.username).toBe(USER.username)
  })

  it('signed in: select * and is_admin are refused on his own row; the app\'s read and is_platform_operator() work', async () => {
    expect((await user.from('profiles').select('*').eq('id', userId)).error?.code).toBe('42501')
    expect((await user.from('profiles').select('is_admin').eq('id', userId)).error?.code).toBe('42501')
    const named = await user.from('profiles').select(PROFILE_READABLE_COLUMNS).eq('id', userId).single()
    expect(named.error).toBeNull()
    const op = await user.rpc('is_platform_operator')
    expect(op.error).toBeNull()
    expect(op.data).toBe(false)
  })

  it('an own-profile update that returns the named columns lands (the avatar route\'s shape)', async () => {
    const { data, error } = await user
      .from('profiles')
      .update({ bio: 'hw210 bio' })
      .eq('id', userId)
      .select(PROFILE_READABLE_COLUMNS)
      .single()
    expect(error).toBeNull()
    expect(data?.bio).toBe('hw210 bio')
  })
})
