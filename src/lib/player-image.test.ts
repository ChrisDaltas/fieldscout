import { describe, expect, it } from 'vitest'

import { NFL_TEAMS } from '@/lib/nfl-teams'
import { getPlayerImageUrl, getTeamLogoUrl, isTeamDefense } from '@/lib/player-image'

/**
 * Pins for the DEF → team-logo substitution (Chris, 2026-08-11 — *"for DEF use
 * the team's logo"*).
 *
 * The URLs below are **stored literals, not built from the same template the
 * code uses** — a golden pin. If someone rewrites the base path or drops the
 * `.toLowerCase()`, these go red rather than agreeing with the new mistake.
 *
 * The lowercase rule is the whole point: measured 2026-08-11,
 * `…/team_logos/nfl/phi.png` is 200 and `…/PHI.png` is 404, so a plain
 * interpolation of `players.team` (which is stored uppercase) is a 404 on every
 * defense in the app.
 */
describe('getTeamLogoUrl', () => {
  it('lowercases the abbreviation — the CDN path is case-sensitive', () => {
    expect(getTeamLogoUrl('PHI')).toBe('https://sleepercdn.com/images/team_logos/nfl/phi.png')
    expect(getTeamLogoUrl('KC')).toBe('https://sleepercdn.com/images/team_logos/nfl/kc.png')
    expect(getTeamLogoUrl('JAX')).toBe('https://sleepercdn.com/images/team_logos/nfl/jax.png')
  })

  it('accepts an already-lowercase or padded abbreviation', () => {
    expect(getTeamLogoUrl('phi')).toBe('https://sleepercdn.com/images/team_logos/nfl/phi.png')
    expect(getTeamLogoUrl('  PHI  ')).toBe('https://sleepercdn.com/images/team_logos/nfl/phi.png')
  })

  it('resolves all 32 teams, and never emits an uppercase segment', () => {
    const urls = Object.keys(NFL_TEAMS).map((abbr) => getTeamLogoUrl(abbr))
    expect(urls).toHaveLength(32)
    expect(urls.every((url) => url !== null)).toBe(true)
    // Every one of these was checked live against the CDN on 2026-08-11 and
    // returned 200; the uppercase form returned 404.
    expect(urls.filter((url) => url !== null && /[A-Z]/.test(url))).toEqual([])
  })

  it('returns null for anything that is not one of the 32 abbreviations', () => {
    // Prefer no image over a request that is known in advance to 404.
    expect(getTeamLogoUrl('ZZZ')).toBeNull()
    expect(getTeamLogoUrl('')).toBeNull()
    expect(getTeamLogoUrl('   ')).toBeNull()
    expect(getTeamLogoUrl(null)).toBeNull()
    expect(getTeamLogoUrl(undefined)).toBeNull()
  })
})

describe('isTeamDefense', () => {
  it('recognises the schema spelling and the common provider variants', () => {
    expect(isTeamDefense({ position: 'DEF' })).toBe(true)
    expect(isTeamDefense({ position: 'def' })).toBe(true)
    expect(isTeamDefense({ position: 'DST' })).toBe(true)
    expect(isTeamDefense({ position: 'D/ST' })).toBe(true)
  })

  it('does not fire on people', () => {
    for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'FLEX', null, undefined, '']) {
      expect(isTeamDefense({ position })).toBe(false)
    }
  })
})

describe('getPlayerImageUrl', () => {
  // The exact shape of a DEF row in `players`, read from the local database
  // on 2026-08-11: the id is the abbreviation, and `headshot_url` points at a
  // player thumbnail that 403s.
  const eaglesDefense = {
    id: 'PHI',
    full_name: 'Philadelphia Eagles',
    position: 'DEF',
    team: 'PHI',
    headshot_url: 'https://sleepercdn.com/content/nfl/players/thumb/PHI.jpg',
  }

  it('substitutes the team logo for a DEF row, ignoring the stored headshot', () => {
    expect(getPlayerImageUrl(eaglesDefense)).toBe(
      'https://sleepercdn.com/images/team_logos/nfl/phi.png',
    )
  })

  it('prefers `team` over `id`', () => {
    // They are equal in the real data. Pinning the precedence anyway means a
    // future id scheme (a uuid, say) cannot quietly become the source.
    expect(
      getPlayerImageUrl({ ...eaglesDefense, id: 'a1b2c3d4', team: 'DAL' }),
    ).toBe('https://sleepercdn.com/images/team_logos/nfl/dal.png')
  })

  it('falls back to `id` when `team` is null or blank', () => {
    expect(getPlayerImageUrl({ ...eaglesDefense, team: null })).toBe(
      'https://sleepercdn.com/images/team_logos/nfl/phi.png',
    )
    expect(getPlayerImageUrl({ ...eaglesDefense, team: '' })).toBe(
      'https://sleepercdn.com/images/team_logos/nfl/phi.png',
    )
  })

  it('returns null — never the 403 URL — when a DEF row resolves to no team', () => {
    expect(getPlayerImageUrl({ ...eaglesDefense, id: 'a1b2c3d4', team: null })).toBeNull()
    expect(getPlayerImageUrl({ ...eaglesDefense, id: null, team: null })).toBeNull()
  })

  it('leaves every non-DEF player on its stored headshot', () => {
    expect(
      getPlayerImageUrl({
        id: '4046',
        position: 'QB',
        team: 'KC',
        headshot_url: 'https://sleepercdn.com/content/nfl/players/thumb/4046.jpg',
      }),
    ).toBe('https://sleepercdn.com/content/nfl/players/thumb/4046.jpg')
  })

  it('returns null for a player with no headshot at all', () => {
    expect(getPlayerImageUrl({ id: '4046', position: 'QB', team: 'KC', headshot_url: null })).toBeNull()
    expect(getPlayerImageUrl({})).toBeNull()
  })
})
