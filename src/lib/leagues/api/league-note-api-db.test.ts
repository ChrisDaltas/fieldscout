/**
 * league-note-api-db.test.ts — the commissioner note (gap list #13; migration
 * 192) at the SERVICE layer, against the LOCAL Supabase stack through
 * PostgREST with real signed-in clients. pgTAP 139 holds the verb's law
 * DB-side; this suite proves the layer above it:
 *
 *   - the read a member makes (the columns typed through PostgREST, the
 *     author's username), and a non-member's no-leak 403;
 *   - a manager's write is the route's 403 and writes nothing;
 *   - the commissioner's set: 200, the member's bell row
 *     (`league_commissioner_note`, carrying the league id the link opens), the
 *     receipt in the commissioner log a member reads (League activity);
 *   - the clear: 200, no note, and the member's unread bell row replaced by
 *     "The commissioner cleared the note." (a clear is a change).
 *
 * Requires the local stack — FAILS loudly when it is down, never skips.
 * Determinism: fixed emails / usernames / league name + cleanup-first.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { readCommishLog, type CommishLogPage } from './commish-log-service'
import { INSEASON_READ_FORBIDDEN_MESSAGE } from './inseason-reads'
import { LEAGUE_NOTE_FORBIDDEN_MESSAGE, readLeagueNote, setLeagueNote, type LeagueNoteView, type SetLeagueNoteResult } from './league-note-service'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const LEAGUE_NAME = 'vitest-league-note-api-league'

const COMMISH = { email: 'league-note-commish@fieldscout.test', password: 'vitest-lnote-pass-1', username: 'lnote_commish_one' }
const MEMBER = { email: 'league-note-member@fieldscout.test', password: 'vitest-lnote-pass-2', username: 'lnote_member_two' }
const STRANGER = { email: 'league-note-stranger@fieldscout.test', password: 'vitest-lnote-pass-3', username: 'lnote_stranger_three' }

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

let commishClient: SupabaseClient<Database>
let memberClient: SupabaseClient<Database>
let strangerClient: SupabaseClient<Database>
let leagueId: string
let memberId: string

async function deleteUserByUsername(username: string): Promise<void> {
  const { data } = await service.from('profiles').select('id').eq('username', username)
  for (const row of data ?? []) {
    await service.from('notifications').delete().eq('user_id', row.id)
    await service.auth.admin.deleteUser(row.id)
  }
}

async function cleanup(): Promise<void> {
  const { data: stale } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    const { error: membersError } = await service.from('league_members').delete().in('league_id', ids)
    if (membersError) throw new Error(`cleanup league_members: ${membersError.message}`)
    // commissioner_actions ride the league's delete (ON DELETE CASCADE).
    const { error: leaguesError } = await service.from('leagues').delete().in('id', ids)
    if (leaguesError) throw new Error(`cleanup leagues: ${leaguesError.message}`)
  }
  for (const u of [COMMISH, MEMBER, STRANGER]) await deleteUserByUsername(u.username)
}

async function createUser(user: { email: string; password: string; username: string }): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true, user_metadata: { username: user.username } })
  if (error) throw new Error(`createUser failed for ${user.email}: ${error.message}`)
  return data.user.id
}

async function signIn(user: { email: string; password: string }): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword(user)
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`)
  return client
}

async function memberNoteRows() {
  const { data, error } = await memberClient
    .from('notifications')
    .select('type, title, body, data, read')
    .eq('type', 'league_commissioner_note')
  if (error) throw new Error(`notifications read: ${error.message}`)
  return data ?? []
}

beforeAll(async () => {
  await cleanup()
  const commishId = await createUser(COMMISH)
  memberId = await createUser(MEMBER)
  await createUser(STRANGER)
  commishClient = await signIn(COMMISH)
  memberClient = await signIn(MEMBER)
  strangerClient = await signIn(STRANGER)

  const { data: league, error: leagueError } = await service
    .from('leagues')
    .insert({ owner_id: commishId, name: LEAGUE_NAME, season: 2026, status: 'setup' })
    .select('id')
    .single()
  if (leagueError) throw new Error(`leagues insert: ${leagueError.message}`)
  leagueId = league.id
  const { error: membersError } = await service.from('league_members').insert([
    { league_id: leagueId, user_id: commishId, role: 'commissioner' },
    { league_id: leagueId, user_id: memberId, role: 'manager' },
  ])
  if (membersError) throw new Error(`league_members insert: ${membersError.message}`)
}, 60_000)

afterAll(async () => {
  await cleanup()
  const { data: leagues } = await service.from('leagues').select('id').like('name', `${LEAGUE_NAME}%`)
  expect(leagues ?? []).toHaveLength(0)
})

describe('the commissioner note through the real door', () => {
  it('a member reads "no note yet" (available on this database); a stranger gets the no-leak 403', async () => {
    expect(await readLeagueNote(memberClient, leagueId)).toEqual({ status: 200, body: { available: true, note: null } })
    expect(await readLeagueNote(strangerClient, leagueId)).toEqual({ status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } })
  })

  it('a manager cannot set it — the route’s 403, nothing written', async () => {
    const res = await setLeagueNote(memberClient, leagueId, { note: 'I am the commish now' })
    expect(res).toEqual({ status: 403, body: { error: LEAGUE_NOTE_FORBIDDEN_MESSAGE } })
    expect((await readLeagueNote(memberClient, leagueId)).body).toEqual({ available: true, note: null })
  })

  it('the commissioner pins it: the member reads it with the author, gets one bell row that opens the league home, and the log shows it', async () => {
    const res = await setLeagueNote(commishClient, leagueId, { note: '  Trade deadline is Nov 24\n' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const result = res.body as unknown as SetLeagueNoteResult
    expect(result).toMatchObject({ verb: 'commish_set_league_note', note: 'Trade deadline is Nov 24', no_changes: false, cleared: false, notified: 1 })

    const read = (await readLeagueNote(memberClient, leagueId)).body as unknown as LeagueNoteView
    expect(read.available).toBe(true)
    expect(read.note?.text).toBe('Trade deadline is Nov 24')
    expect(read.note?.author?.username).toBe(COMMISH.username)

    const rows = await memberNoteRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'Commissioner note updated', body: 'Trade deadline is Nov 24', read: false })
    // `data.league_id` is what `notificationHref` opens (the league home — notification-href.test.ts).
    expect((rows[0].data as { league_id?: string }).league_id).toBe(leagueId)

    const log = (await readCommishLog(memberClient, leagueId, {})).body as unknown as CommishLogPage
    const notes = log.items.filter((i) => i.action_type === 'set_league_note')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ before: { note: null }, after: { note: 'Trade deadline is Nov 24' }, reason: null })
  })

  it('the same note again is a no-op — nothing new anywhere', async () => {
    const res = await setLeagueNote(commishClient, leagueId, { note: 'Trade deadline is Nov 24' })
    expect((res.body as unknown as SetLeagueNoteResult).no_changes).toBe(true)
    expect(await memberNoteRows()).toHaveLength(1)
  })

  it('clearing it: no note, a receipt, and the member is told — the unread bell row now says it was cleared (replaced, not stacked)', async () => {
    const res = await setLeagueNote(commishClient, leagueId, { note: '' })
    expect(res.status).toBe(200)
    expect(res.body as unknown as SetLeagueNoteResult).toMatchObject({ cleared: true, notified: 1 })
    expect((await readLeagueNote(memberClient, leagueId)).body).toEqual({ available: true, note: null })
    const rows = await memberNoteRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'Commissioner note updated', body: 'The commissioner cleared the note.', read: false })
    expect(rows[0].data as { league_id?: string; cleared?: boolean }).toMatchObject({ league_id: leagueId, cleared: true })
    const log = (await readCommishLog(memberClient, leagueId, {})).body as unknown as CommishLogPage
    expect(log.items.filter((i) => i.action_type === 'set_league_note')).toHaveLength(2)
  })
})
