/**
 * Draft-chat render + reducer pins (M2 task L.B3.3; spec §8.8/§16.2/§16.3;
 * D99; D108(15) — BOTH authorless arms are legal data and must render).
 * Golden values are stored literals (tasks-M1 §4.3).
 */

import { describe, expect, it } from 'vitest'

import {
  CHAT_MAX_LENGTH,
  chatAuthorsById,
  chatDraftSendable,
  chatItemView,
  FORMER_MEMBER_LABEL,
  isChatRecord,
  reduceChatEvent,
  type DraftChatRow,
} from './use-draft-chat-ops'

const CTX = 'draft:00000000-0000-4000-8000-0000000000d1'

function row(over: Partial<DraftChatRow> = {}): DraftChatRow {
  return {
    id: 'c1',
    user_id: 'u1',
    message: 'hello room',
    context: CTX,
    is_system: false,
    created_at: '2026-08-13T00:00:10.000Z',
    ...over,
  }
}

const AUTHORS = new Map<string, string>([
  ['u1', 'Hawk Tuah Hawks — @chris'],
  ['u2', 'Ditka’s Ghost — @devpro'],
])

// ---------------------------------------------------------------------------
// chatItemView — the D108(15) both-arms contract
// ---------------------------------------------------------------------------

describe('chatItemView (D108(15) — both authorless arms)', () => {
  it('a system post renders actorless BY SHAPE even when user_id is present (the acting commissioner is named in the text)', () => {
    const view = chatItemView(
      row({ is_system: true, user_id: 'u1', message: 'Draft paused by chris.' }),
      AUTHORS,
      'u2',
    )
    expect(view.kind).toBe('system')
    expect(view.authorLabel).toBeNull()
    expect(view.message).toBe('Draft paused by chris.')
  })

  it("the tick's user_id-NULL system post renders identically (actorless system — no former-member fallback)", () => {
    const view = chatItemView(
      row({ is_system: true, user_id: null, message: 'Draft auto-paused — no commissioner is connected.' }),
      AUTHORS,
      'u1',
    )
    expect(view.kind).toBe('system')
    expect(view.authorLabel).toBeNull()
    expect(view.message).toBe('Draft auto-paused — no commissioner is connected.')
  })

  it('an AUTHORLESS ORDINARY row (user_id NULL, is_system FALSE — a deleted account, R137) keeps its text under the former-member fallback', () => {
    const view = chatItemView(row({ user_id: null, message: 'good luck all' }), AUTHORS, 'u1')
    expect(view.kind).toBe('former-member')
    expect(view.authorLabel).toBe(FORMER_MEMBER_LABEL)
    expect(view.message).toBe('good luck all')
    expect(view.mine).toBe(false)
  })

  it('is_system NULL (the column default before 065 backfill semantics) is an ORDINARY row — the authorless arm still applies', () => {
    const view = chatItemView(row({ is_system: null, user_id: null }), AUTHORS, null)
    expect(view.kind).toBe('former-member')
    expect(view.authorLabel).toBe(FORMER_MEMBER_LABEL)
  })

  it('an ordinary member row renders the §16.4 identity label (Team — @username) and marks mine', () => {
    const view = chatItemView(row({ user_id: 'u1' }), AUTHORS, 'u1')
    expect(view.kind).toBe('member')
    expect(view.authorLabel).toBe('Hawk Tuah Hawks — @chris')
    expect(view.mine).toBe(true)
  })

  it('an author absent from the members map (departed, account intact) renders the former-member fallback', () => {
    const view = chatItemView(row({ user_id: 'u-gone' }), AUTHORS, 'u1')
    expect(view.kind).toBe('former-member')
    expect(view.authorLabel).toBe(FORMER_MEMBER_LABEL)
  })
})

// ---------------------------------------------------------------------------
// chatAuthorsById — the §16.4 identity rule
// ---------------------------------------------------------------------------

describe('chatAuthorsById', () => {
  it('labels Team — @username; bare @username when the member holds no franchise; skips placeholder rows', () => {
    const authors = chatAuthorsById(
      [
        { user_id: 'u1', team_id: 't1', profiles: { username: 'chris' } },
        { user_id: 'u2', team_id: null, profiles: { username: 'devpro' } },
        { user_id: null, team_id: 't2', profiles: null }, // placeholder seat
      ],
      [
        { id: 't1', name: 'Hawk Tuah Hawks' },
        { id: 't2', name: 'Open Seat FC' },
      ],
    )
    expect(authors.get('u1')).toBe('Hawk Tuah Hawks — @chris')
    expect(authors.get('u2')).toBe('@devpro')
    expect(authors.size).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// reduceChatEvent — broadcast → cache (id-dedupe; same-ref inertness)
// ---------------------------------------------------------------------------

describe('reduceChatEvent', () => {
  const rows = [row({ id: 'c1', created_at: '2026-08-13T00:00:10.000Z' })]

  it('appends a new row sorted by (created_at, id)', () => {
    const earlier = row({ id: 'c0', created_at: '2026-08-13T00:00:05.000Z' })
    const next = reduceChatEvent(rows, earlier, CTX)
    expect(next.map((r) => r.id)).toEqual(['c0', 'c1'])
  })

  it('an id already held is inert — the SAME reference back (own-INSERT echo dedupe)', () => {
    const next = reduceChatEvent(rows, row({ id: 'c1', message: 'mutated echo' }), CTX)
    expect(next).toBe(rows)
  })

  it('a record for another context is dropped (same reference)', () => {
    const next = reduceChatEvent(rows, row({ id: 'c9', context: 'league' }), CTX)
    expect(next).toBe(rows)
  })

  it('a malformed record is dropped, never applied', () => {
    expect(reduceChatEvent(rows, { message: 42 }, CTX)).toBe(rows)
    expect(reduceChatEvent(rows, null, CTX)).toBe(rows)
    expect(isChatRecord({ id: 'x' })).toBe(false) // no message
  })
})

// ---------------------------------------------------------------------------
// Composer guard (the 065 policy bound, 1..500)
// ---------------------------------------------------------------------------

describe('chatDraftSendable', () => {
  it('bounds match the 065 policy: 1..500 chars, whitespace-only refused', () => {
    expect(CHAT_MAX_LENGTH).toBe(500)
    expect(chatDraftSendable('')).toBe(false)
    expect(chatDraftSendable('   ')).toBe(false)
    expect(chatDraftSendable('a')).toBe(true)
    expect(chatDraftSendable('x'.repeat(500))).toBe(true)
    expect(chatDraftSendable('x'.repeat(501))).toBe(false)
  })
})
