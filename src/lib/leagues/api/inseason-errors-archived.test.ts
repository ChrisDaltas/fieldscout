/**
 * R1734 (PR #543): the archive freeze (212, SQLSTATE 55000) reaches a member
 * as a 409 in plain words from every league error mapper — never a 500.
 */
import { describe, expect, it } from 'vitest'

import { archivedLeagueResult, isLeagueArchivedError, LEAGUE_ARCHIVED_MESSAGE, mapInSeasonRpcError } from './inseason-errors'

const FREEZE = { code: '55000', message: 'This league is archived, so nothing in it can change. Its commissioner can restore it from Leagues › Archived leagues.' }

describe('the archive freeze, mapped', () => {
  it('the freeze is a 409 with its own words', () => {
    expect(archivedLeagueResult(FREEZE)).toEqual({ status: 409, body: { error: LEAGUE_ARCHIVED_MESSAGE } })
    expect(mapInSeasonRpcError(FREEZE, 'nope')).toEqual({ status: 409, body: { error: LEAGUE_ARCHIVED_MESSAGE } })
  })
  it('another 55000 (the archive verb mid-draft) and every other code are not it', () => {
    expect(isLeagueArchivedError({ code: '55000', message: 'archive_league: the draft is in progress' })).toBe(false)
    expect(archivedLeagueResult({ code: 'P0001', message: 'This league is archived' })).toBeNull()
    expect(archivedLeagueResult(null)).toBeNull()
    expect(mapInSeasonRpcError({ code: 'P0001', message: 'x' }, 'nope')).toEqual({ status: 409, body: { error: 'x' } })
  })
})
