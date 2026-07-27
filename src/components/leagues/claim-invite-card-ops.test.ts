import { describe, expect, it } from 'vitest'

import {
  cardCopy,
  claimKindForType,
  isActionable,
  outcomeReasonToCardKind,
  parseJoinPreview,
  previewToCardKind,
  STATE_COPY,
  successLeagueId,
  type CardKind,
  type JoinPreviewFound,
} from './claim-invite-card-ops'

const found = (over: Partial<JoinPreviewFound> = {}): JoinPreviewFound => ({
  found: true,
  type: 'invite',
  status: 'ok',
  league_name: 'Yardboats League',
  team_label: 'Team 4',
  inviter_name: 'Dana',
  seats_open: null,
  ...over,
})

// ---------------------------------------------------------------------------
// resolution-type → claim-kind (§16.1: token → claim RPC; code/slug → join RPC)
// ---------------------------------------------------------------------------
describe('claimKindForType', () => {
  it('routes a seat/invite token to the claim RPC', () => {
    expect(claimKindForType('invite')).toBe('seat')
  })
  it('routes a share code and a custom slug to the join RPC', () => {
    expect(claimKindForType('code')).toBe('join')
    expect(claimKindForType('slug')).toBe('join')
  })
})

// ---------------------------------------------------------------------------
// state → card-kind (the §16.5.2 states, PRE-AUTH from the preview)
// ---------------------------------------------------------------------------
describe('previewToCardKind', () => {
  it('an unresolved value → not-found (unknown token/code/slug)', () => {
    expect(previewToCardKind({ found: false })).toBe('not-found')
  })

  it('a live seat token → claimable-seat; a live code/slug → claimable-join', () => {
    expect(previewToCardKind(found({ type: 'invite', status: 'ok' }))).toBe('claimable-seat')
    expect(previewToCardKind(found({ type: 'code', status: 'ok', team_label: null }))).toBe(
      'claimable-join',
    )
    expect(previewToCardKind(found({ type: 'slug', status: 'ok', team_label: null }))).toBe(
      'claimable-join',
    )
  })

  it('maps each blocked status to its terminal card', () => {
    expect(previewToCardKind(found({ status: 'revoked' }))).toBe('revoked')
    expect(previewToCardKind(found({ status: 'expired' }))).toBe('expired')
    expect(previewToCardKind(found({ status: 'spent' }))).toBe('spent')
    expect(previewToCardKind(found({ status: 'seat_filled' }))).toBe('seat-filled')
    expect(previewToCardKind(found({ status: 'league_full' }))).toBe('league-full')
    expect(previewToCardKind(found({ status: 'joins_closed' }))).toBe('joins-closed')
  })

  it('only the two claimable kinds are actionable', () => {
    expect(isActionable('claimable-seat')).toBe(true)
    expect(isActionable('claimable-join')).toBe(true)
    for (const k of [
      'not-found',
      'revoked',
      'expired',
      'spent',
      'seat-filled',
      'seat-unavailable',
      'league-full',
      'joins-closed',
      'mismatch',
      'error',
    ] as CardKind[]) {
      expect(isActionable(k)).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// claim/join outcome reason → card-kind (POST-ACTION; mismatch is E53/E65)
// ---------------------------------------------------------------------------
describe('outcomeReasonToCardKind', () => {
  it('mismatch (E53/E65 wrong account) is reachable only post-claim', () => {
    expect(outcomeReasonToCardKind('mismatch')).toBe('mismatch')
  })
  it('maps the D72 refusal reasons', () => {
    expect(outcomeReasonToCardKind('not_found')).toBe('not-found')
    expect(outcomeReasonToCardKind('revoked')).toBe('revoked')
    expect(outcomeReasonToCardKind('expired')).toBe('expired')
    expect(outcomeReasonToCardKind('spent')).toBe('spent')
    expect(outcomeReasonToCardKind('seat_filled')).toBe('seat-filled')
    expect(outcomeReasonToCardKind('seat_unavailable')).toBe('seat-unavailable')
    expect(outcomeReasonToCardKind('league_full')).toBe('league-full')
    expect(outcomeReasonToCardKind('joins_closed')).toBe('joins-closed')
  })
  it('an unknown/absent reason (or a 5xx) falls to the generic error card', () => {
    expect(outcomeReasonToCardKind('teapot')).toBe('error')
    expect(outcomeReasonToCardKind(undefined)).toBe('error')
  })
})

// ---------------------------------------------------------------------------
// parseJoinPreview — narrow the RPC's Json, collapse anything untrusted
// ---------------------------------------------------------------------------
describe('parseJoinPreview', () => {
  it('passes a well-formed seat preview through', () => {
    const raw = {
      found: true,
      type: 'invite',
      status: 'ok',
      league_name: 'Yardboats League',
      team_label: 'Team 4',
      inviter_name: 'Dana',
      seats_open: null,
    }
    expect(parseJoinPreview(raw)).toEqual(raw)
  })

  it('coerces a code preview (null team/inviter, numeric seats_open)', () => {
    const parsed = parseJoinPreview({
      found: true,
      type: 'code',
      status: 'ok',
      league_name: 'Open League',
      team_label: null,
      inviter_name: null,
      seats_open: 3,
    })
    expect(parsed).toMatchObject({ found: true, type: 'code', seats_open: 3, team_label: null })
  })

  it('collapses found:false, missing fields, bad type/status, and non-objects to {found:false}', () => {
    expect(parseJoinPreview({ found: false })).toEqual({ found: false })
    expect(parseJoinPreview({ found: true, type: 'invite', status: 'ok' })).toEqual({ found: false }) // no league_name
    expect(
      parseJoinPreview({ found: true, type: 'bogus', status: 'ok', league_name: 'X' }),
    ).toEqual({ found: false })
    expect(
      parseJoinPreview({ found: true, type: 'invite', status: 'weird', league_name: 'X' }),
    ).toEqual({ found: false })
    expect(parseJoinPreview(null)).toEqual({ found: false })
    expect(parseJoinPreview('nope')).toEqual({ found: false })
  })
})

// ---------------------------------------------------------------------------
// copy — RPC message preferred over the authored fallback; F2 no-email floor
// ---------------------------------------------------------------------------
describe('cardCopy', () => {
  it('prefers the RPC-supplied message, falling back to the authored copy', () => {
    expect(cardCopy('league-full', 'This league is full — all 12 seats are taken.').message).toBe(
      'This league is full — all 12 seats are taken.',
    )
    expect(cardCopy('league-full').message).toBe(STATE_COPY['league-full'].message)
    // Blank/whitespace override does not blank the card.
    expect(cardCopy('expired', '   ').message).toBe(STATE_COPY.expired.message)
  })

  it('F2 FLOOR — no terminal copy (title or message) exposes an email address', () => {
    for (const copy of Object.values(STATE_COPY)) {
      expect(copy.title).not.toMatch(/@/)
      expect(copy.message).not.toMatch(/@/)
      expect(`${copy.title} ${copy.message}`.toLowerCase()).not.toContain('invited_email')
    }
    // The mismatch (E53/E65) card names the *account*, never the address.
    expect(STATE_COPY.mismatch.message.toLowerCase()).toContain('account')
    expect(STATE_COPY.mismatch.message).not.toMatch(/@/)
  })
})

describe('successLeagueId', () => {
  it('returns the league id for a successful claim/join (incl. already_member)', () => {
    expect(successLeagueId({ ok: true, league_id: 'lg-7' })).toBe('lg-7')
    expect(successLeagueId({ ok: true, already_member: true, league_id: 'lg-7' })).toBe('lg-7')
  })
  it('returns null on a refusal', () => {
    expect(successLeagueId({ ok: false, reason: 'mismatch' })).toBeNull()
    expect(successLeagueId({ ok: true })).toBeNull() // no league_id
  })
})
