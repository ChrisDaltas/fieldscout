import { describe, expect, it } from 'vitest'

import {
  deriveDraftAlert,
  draftBarCandidate,
  DRAFT_BAR_SOON_MS,
  type DraftBarLeagueRow,
} from './draft-bar-ops'

const drafting: DraftBarLeagueRow = { id: 'lg-live', name: 'Live League', status: 'drafting' }
const scheduled: DraftBarLeagueRow = { id: 'lg-sched', name: 'Sched League', status: 'scheduled' }
const inSeason: DraftBarLeagueRow = { id: 'lg-season', name: 'Season League', status: 'in_season' }

const NOW = Date.parse('2026-08-30T22:30:00.000Z')
const INSTANT = '2026-08-30T23:00:00.000Z' // 30 minutes after NOW

describe('draftBarCandidate', () => {
  it('a drafting league beats a scheduled one, wherever it sits in the list', () => {
    expect(draftBarCandidate([scheduled, inSeason, drafting])).toBe(drafting)
  })

  it('falls back to the first scheduled league; null when neither exists', () => {
    expect(draftBarCandidate([inSeason, scheduled])).toBe(scheduled)
    expect(draftBarCandidate([inSeason])).toBeNull()
    expect(draftBarCandidate([])).toBeNull()
  })
})

describe('deriveDraftAlert', () => {
  it('a LIVE draft always alerts, pointing at the room', () => {
    expect(deriveDraftAlert(drafting, null, NOW, '/app/home')).toEqual({
      live: true,
      leagueId: 'lg-live',
      league: 'Live League',
      detail: 'Picks are coming off the board.',
      href: '/app/leagues/lg-live/draft',
    })
  })

  it('suppressed on the target league’s own draft-room route (the bar’s job is done)', () => {
    expect(deriveDraftAlert(drafting, null, NOW, '/app/leagues/lg-live/draft')).toBeNull()
    // …but another league's room does NOT suppress it.
    expect(deriveDraftAlert(drafting, null, NOW, '/app/leagues/other/draft')).not.toBeNull()
  })

  it('a scheduled draft inside the soon-window alerts with the countdown detail', () => {
    const alert = deriveDraftAlert(scheduled, INSTANT, NOW, '/app/home')
    expect(alert).toMatchObject({ live: false, leagueId: 'lg-sched', detail: 'Starts in 30m' })
  })

  it('soon-window boundary: exactly 1h out shows; one ms past the window hides', () => {
    const target = Date.parse(INSTANT)
    expect(deriveDraftAlert(scheduled, INSTANT, target - DRAFT_BAR_SOON_MS, '/x')).not.toBeNull()
    expect(deriveDraftAlert(scheduled, INSTANT, target - DRAFT_BAR_SOON_MS - 1, '/x')).toBeNull()
  })

  it('past the instant (draft night, tick about to start it) reads "Starting now"', () => {
    const alert = deriveDraftAlert(scheduled, INSTANT, Date.parse(INSTANT) + 5_000, '/x')
    expect(alert?.detail).toBe('Starting now')
  })

  it('a scheduled candidate with no/unparseable instant stays silent (no undated urgency)', () => {
    expect(deriveDraftAlert(scheduled, null, NOW, '/x')).toBeNull()
    expect(deriveDraftAlert(scheduled, 'tonight', NOW, '/x')).toBeNull()
  })

  it('null candidate ⇒ null', () => {
    expect(deriveDraftAlert(null, INSTANT, NOW, '/x')).toBeNull()
  })
})
