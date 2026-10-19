import { describe, expect, it } from 'vitest'

import { adpText, fantasyPlayersLabel, rosterRowMeta, rosterStatus, teamMetaLine } from './nfl-ops'

describe('NFL team pages on the phone — labels (gap list §4 item 103)', () => {
  it('the header line names the division, and the bye when the roster carries one', () => {
    expect(teamMetaLine('AFC East', 7)).toBe('AFC East · Bye week 7')
    expect(teamMetaLine('NFC West', null)).toBe('NFC West')
  })

  it('counts the fantasy players as desktop does', () => {
    expect(fantasyPlayersLabel(24)).toBe('24 fantasy players')
    expect(fantasyPlayersLabel(1)).toBe('1 fantasy player')
    expect(fantasyPlayersLabel(0)).toBe('0 fantasy players')
  })

  it('ADP to one decimal; a dash when there is none', () => {
    expect(adpText(8.8)).toBe('8.8')
    expect(adpText(20)).toBe('20.0')
    expect(adpText(151.66)).toBe('151.7')
    expect(adpText(null)).toBe('–')
  })

  it('designations in their tone: Questionable / Doubtful orange, Out and the reserve lists red', () => {
    expect(rosterStatus('Questionable')).toEqual({ label: 'Questionable', tone: 'warn' })
    expect(rosterStatus('Doubtful')).toEqual({ label: 'Doubtful', tone: 'warn' })
    for (const s of ['Out', 'IR', 'PUP', 'Suspended']) expect(rosterStatus(s)).toEqual({ label: s, tone: 'negative' })
    // The feed's lower-case reserve spelling reads as IR (the profile pill's rule).
    expect(rosterStatus('injured')).toEqual({ label: 'IR', tone: 'negative' })
  })

  it('Active says nothing; any other status desktop shows (Inactive, …) stays, as plain text', () => {
    expect(rosterStatus('Active')).toBeNull()
    expect(rosterStatus(' active ')).toBeNull()
    expect(rosterStatus(null)).toBeNull()
    expect(rosterStatus('')).toBeNull()
    expect(rosterStatus('Inactive')).toEqual({ label: 'Inactive', tone: 'quiet' })
    expect(rosterStatus('DNR')).toEqual({ label: 'DNR', tone: 'quiet' })
  })

  it('the second line: the jersey number and the status; a defense has no number', () => {
    expect(rosterRowMeta({ jersey_number: 17, position: 'QB', status: 'Active' })).toEqual({ number: '#17', status: null })
    expect(rosterRowMeta({ jersey_number: 0, position: 'WR', status: 'Questionable' })).toEqual({
      number: '#0',
      status: { label: 'Questionable', tone: 'warn' },
    })
    expect(rosterRowMeta({ jersey_number: null, position: 'DEF', status: 'Active' })).toEqual({ number: null, status: null })
    expect(rosterRowMeta({ jersey_number: 3, position: 'DEF', status: 'Active' }).number).toBeNull()
    expect(rosterRowMeta({ jersey_number: null, position: 'RB', status: 'IR' })).toEqual({
      number: null,
      status: { label: 'IR', tone: 'negative' },
    })
  })
})
