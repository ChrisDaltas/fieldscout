import { describe, expect, it } from 'vitest'

import { profileOpenFor } from './use-mobile-card-redirect'

const card = { playerId: 'p1', listContext: null, readOnly: false }

describe('mini card → mobile profile', () => {
  it('a league card opens the profile in that league, with no draft seat', () => {
    expect(profileOpenFor({ ...card, context: { kind: 'league', leagueId: 'L1' } })).toEqual({
      playerId: 'p1',
      leagueId: 'L1',
      listContext: null,
      draft: null,
    })
  })

  it('a draft card keeps its seat (Queue) — a league draft and a mock draft alike', () => {
    expect(profileOpenFor({ ...card, context: { kind: 'draft', leagueId: 'L1', draftId: 'd1', teamId: 't1' } })).toMatchObject({
      leagueId: 'L1',
      draft: { playerId: 'p1', draftId: 'd1', teamId: 't1', leagueId: 'L1' },
    })
    expect(profileOpenFor({ ...card, context: { kind: 'draft', leagueId: null, draftId: 'm1', teamId: 't9' } })).toMatchObject({
      leagueId: null,
      draft: { draftId: 'm1', teamId: 't9', leagueId: null },
    })
    // A spectator (no seat) has no Queue on the card either.
    expect(profileOpenFor({ ...card, context: { kind: 'draft', leagueId: 'L1', draftId: 'd1', teamId: null } }).draft).toBeNull()
  })

  it('a research card opens the profile without a league', () => {
    expect(profileOpenFor({ ...card, context: { kind: 'global' } })).toMatchObject({ leagueId: null, draft: null })
  })
})
