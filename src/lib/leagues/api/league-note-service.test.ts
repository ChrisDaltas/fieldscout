/**
 * league-note-service.test.ts — the commissioner note's route layer (gap list
 * #13; migration 192), over an injected client. The database half (the gate,
 * the trim and cap, the receipt, the notifications, RLS) is pgTAP 139.
 *
 *  - READ: membership first (a non-member is the family's 403, never an
 *    empty note); the note with its author; no note; the pre-192 database
 *    (42703 on the column → `available: false`, 200); any other error loud.
 *  - WRITE: the schema (192's trim class, the 500 cap in code points, a
 *    blank note clears, reason optional); 192's argument order with an absent
 *    reason omitted; the door missing (PGRST202 → 503); the family mapping;
 *    the identity guard.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  LEAGUE_NOTE_FORBIDDEN_MESSAGE,
  LEAGUE_NOTE_NOT_LIVE_MESSAGE,
  isMissingNoteColumns,
  readLeagueNote,
  setLeagueNote,
  setLeagueNoteInputSchema,
} from './league-note-service'
import { INSEASON_READ_FORBIDDEN_MESSAGE } from './inseason-reads'

const LEAGUE = 'e9200000-0000-4000-8000-000000000001'
const AUTHOR = 'd9200000-0000-4000-8000-000000000001'

type Answer = { data: unknown; error: { code?: string; message: string; hint?: string | null } | null }

function fakeClient(opts: {
  member?: boolean
  note?: Answer
  profile?: Answer
  rpc?: Answer
}) {
  const rpc = vi.fn(async (fn: string, ...rest: unknown[]) => {
    void rest
    if (fn === 'is_league_member') return { data: opts.member ?? true, error: null }
    return opts.rpc ?? { data: null, error: null }
  })
  const selects: string[] = []
  const from = vi.fn((table: string) => ({
    select: (cols: string) => {
      selects.push(`${table}:${cols}`)
      const answer = async (): Promise<Answer> => {
        if (table === 'leagues' && cols === 'id') return { data: { id: LEAGUE }, error: null }
        if (table === 'leagues') return opts.note ?? { data: null, error: null }
        if (table === 'profiles') return opts.profile ?? { data: null, error: null }
        return { data: null, error: { message: `unexpected table ${table}` } }
      }
      const chain = { eq: () => chain, is: () => chain, maybeSingle: answer }
      return chain
    },
  }))
  return { client: { rpc, from } as never, rpc, from, selects }
}

describe('readLeagueNote — GET …/commish/note', () => {
  it('a non-member gets the family’s one 403 — and the note is never read', async () => {
    const f = fakeClient({ member: false })
    const res = await readLeagueNote(f.client, LEAGUE)
    expect(res).toEqual({ status: 403, body: { error: INSEASON_READ_FORBIDDEN_MESSAGE } })
    expect(f.selects).toEqual([])
  })

  it('returns the note with who pinned it and when', async () => {
    const f = fakeClient({
      note: { data: { commissioner_note: 'Trade deadline is Nov 24', commissioner_note_updated_at: '2026-10-15T18:00:00+00:00', commissioner_note_updated_by: AUTHOR }, error: null },
      profile: { data: { username: 'chris_gm' }, error: null },
    })
    const res = await readLeagueNote(f.client, LEAGUE)
    expect(res).toEqual({
      status: 200,
      body: {
        available: true,
        note: { text: 'Trade deadline is Nov 24', updated_at: '2026-10-15T18:00:00+00:00', author: { id: AUTHOR, username: 'chris_gm' } },
      },
    })
    expect(f.selects).toContain('leagues:commissioner_note, commissioner_note_updated_at, commissioner_note_updated_by')
  })

  it('no note pinned → note: null (and no profile read)', async () => {
    const f = fakeClient({
      note: { data: { commissioner_note: null, commissioner_note_updated_at: '2026-10-15T18:00:00+00:00', commissioner_note_updated_by: AUTHOR }, error: null },
    })
    expect(await readLeagueNote(f.client, LEAGUE)).toEqual({ status: 200, body: { available: true, note: null } })
    expect(f.selects.some((s) => s.startsWith('profiles:'))).toBe(false)
  })

  it('a note whose author account is gone reads with no author', async () => {
    const f = fakeClient({
      note: { data: { commissioner_note: 'Dues by Friday', commissioner_note_updated_at: null, commissioner_note_updated_by: null }, error: null },
    })
    expect(await readLeagueNote(f.client, LEAGUE)).toEqual({
      status: 200,
      body: { available: true, note: { text: 'Dues by Friday', updated_at: null, author: null } },
    })
  })

  it('a database without 192 (42703 on the column) → available: false, 200', async () => {
    const missing = { code: '42703', message: 'column leagues.commissioner_note does not exist' }
    expect(isMissingNoteColumns(missing)).toBe(true)
    const f = fakeClient({ note: { data: null, error: missing } })
    expect(await readLeagueNote(f.client, LEAGUE)).toEqual({ status: 200, body: { available: false, note: null } })
  })

  it('any other error is a loud 500 — never a quiet "no note" (anchored on the column name)', async () => {
    const other = { code: '42703', message: 'column leagues.something_else does not exist' }
    expect(isMissingNoteColumns(other)).toBe(false)
    const f = fakeClient({ note: { data: null, error: other } })
    expect((await readLeagueNote(f.client, LEAGUE)).status).toBe(500)
    const g = fakeClient({ note: { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } } })
    expect((await readLeagueNote(g.client, LEAGUE)).status).toBe(500)
  })

  it('a failed author read is a 500, not a note with a blank byline', async () => {
    const f = fakeClient({
      note: { data: { commissioner_note: 'x', commissioner_note_updated_at: null, commissioner_note_updated_by: AUTHOR }, error: null },
      profile: { data: null, error: { message: 'boom' } },
    })
    expect((await readLeagueNote(f.client, LEAGUE)).status).toBe(500)
  })

  it('a league deleted between the gate and the read → 404', async () => {
    const f = fakeClient({ note: { data: null, error: null } })
    expect((await readLeagueNote(f.client, LEAGUE)).status).toBe(404)
  })
})

describe('setLeagueNoteInputSchema — 192’s text rules', () => {
  it('trims spaces, tabs and newlines at the ends (keeps the inner line breaks)', () => {
    expect(setLeagueNoteInputSchema.parse({ note: ' \n\tDues by Friday.\nVenmo me\t \r\n' })).toEqual({ note: 'Dues by Friday.\nVenmo me', reason: undefined })
  })
  it('a blank note is valid — it clears the note', () => {
    expect(setLeagueNoteInputSchema.parse({ note: ' \t\n ' }).note).toBe('')
  })
  it('caps at 500 characters AFTER trimming, counted as Postgres counts (code points)', () => {
    expect(setLeagueNoteInputSchema.safeParse({ note: `  ${'x'.repeat(500)}  ` }).success).toBe(true)
    expect(setLeagueNoteInputSchema.safeParse({ note: 'x'.repeat(501) }).success).toBe(false)
    // 500 emoji = 1000 UTF-16 units but 500 characters to the database.
    expect(setLeagueNoteInputSchema.safeParse({ note: '🏈'.repeat(500) }).success).toBe(true)
    expect(setLeagueNoteInputSchema.safeParse({ note: '🏈'.repeat(501) }).success).toBe(false)
  })
  it('the reason is optional; a blank one is absent; unknown keys and a missing note are refused', () => {
    expect(setLeagueNoteInputSchema.parse({ note: 'x', reason: '  ' }).reason).toBeUndefined()
    expect(setLeagueNoteInputSchema.parse({ note: 'x', reason: 'typo' }).reason).toBe('typo')
    expect(setLeagueNoteInputSchema.safeParse({ note: 'x', pinned: true }).success).toBe(false)
    expect(setLeagueNoteInputSchema.safeParse({}).success).toBe(false)
    expect(setLeagueNoteInputSchema.safeParse({ note: null }).success).toBe(false)
  })
})

describe('setLeagueNote — POST …/commish/note', () => {
  const ok = { verb: 'commish_set_league_note', league_id: LEAGUE, note: 'Dues by Friday', no_changes: false, notified: 3 }

  it('calls 192’s door with (league, trimmed note) — an absent reason omitted — and returns its document whole', async () => {
    const f = fakeClient({ rpc: { data: ok, error: null } })
    const res = await setLeagueNote(f.client, LEAGUE, { note: '  Dues by Friday ' })
    expect(f.rpc).toHaveBeenCalledWith('commish_set_league_note', { p_league_id: LEAGUE, p_note: 'Dues by Friday' })
    expect(res).toEqual({ status: 200, body: ok })
  })

  it('passes a given reason; a blank note goes through as the clear', async () => {
    const f = fakeClient({ rpc: { data: { ...ok, note: null, cleared: true }, error: null } })
    await setLeagueNote(f.client, LEAGUE, { note: '\n', reason: 'old news' })
    expect(f.rpc).toHaveBeenCalledWith('commish_set_league_note', { p_league_id: LEAGUE, p_note: '', p_reason: 'old news' })
  })

  it('a bad body is a 400 and never reaches the database', async () => {
    const f = fakeClient({})
    expect((await setLeagueNote(f.client, LEAGUE, { note: 'x'.repeat(501) })).status).toBe(400)
    expect((await setLeagueNote(f.client, LEAGUE, null)).status).toBe(400)
    expect(f.rpc).not.toHaveBeenCalled()
  })

  it('before 192 is pushed (the door is missing) → a named 503', async () => {
    const f = fakeClient({
      rpc: { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.commish_set_league_note(p_league_id, p_note) in the schema cache', hint: null } },
    })
    expect(await setLeagueNote(f.client, LEAGUE, { note: 'x' })).toEqual({ status: 503, body: { error: LEAGUE_NOTE_NOT_LIVE_MESSAGE } })
  })

  it('the family mapping: 42501 → 403 (one no-leak copy), 22023 → 400, P0001 → 409, else 500', async () => {
    const cases: Array<[string, number]> = [['42501', 403], ['22023', 400], ['P0001', 409], ['XX000', 500]]
    for (const [code, status] of cases) {
      const f = fakeClient({ rpc: { data: null, error: { code, message: `refused ${code}` } } })
      const res = await setLeagueNote(f.client, LEAGUE, { note: 'x' })
      expect(res.status, code).toBe(status)
      if (code === '42501') expect(res.body).toEqual({ error: LEAGUE_NOTE_FORBIDDEN_MESSAGE })
    }
  })

  it('a document that is not this verb’s, for this league, is never a 200', async () => {
    for (const data of [null, { ...ok, verb: 'commish_rename_team' }, { ...ok, league_id: 'e9200000-0000-4000-8000-0000000000ff' }]) {
      const f = fakeClient({ rpc: { data, error: null } })
      expect((await setLeagueNote(f.client, LEAGUE, { note: 'x' })).status).toBe(500)
    }
    // The league id is compared case-insensitively (a route may carry upper case).
    const f = fakeClient({ rpc: { data: ok, error: null } })
    expect((await setLeagueNote(f.client, LEAGUE.toUpperCase(), { note: 'x' })).status).toBe(200)
  })
})
