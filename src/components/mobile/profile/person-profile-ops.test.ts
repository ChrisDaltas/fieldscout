/**
 * A person's profile on the phone (audit profile-1) — the pure half: where
 * a person link goes per layout, the public page a phone path stands for,
 * Back's parent, and the rows' words.
 */
import { describe, expect, it } from 'vitest'

import {
  phoneFollowsHref,
  phoneProfileHref,
  profileHrefFor,
  publicPersonPath,
  userProfileHref,
} from '@/components/shared/username-link-ops'

import {
  FOLLOWS_KINDS,
  followRowSub,
  followsEmptyCopy,
  followsSegmentLabel,
  personAvatarClass,
  personListSub,
  personProfileParent,
} from './person-profile-ops'

describe('where a person link goes', () => {
  it('the phone layout opens the phone screen inside the app; desktop and pages outside the app open the public page', () => {
    expect(profileHrefFor('chris_gm', 'mobile')).toBe('/app/u/chris_gm')
    expect(profileHrefFor('chris_gm', 'desktop')).toBe('/u/chris_gm')
    // No layout attribute: the server, the hydration pass, every public page.
    expect(profileHrefFor('chris_gm', null)).toBe('/u/chris_gm')
  })

  it('one spelling for each address', () => {
    expect(userProfileHref('bathew-ai')).toBe('/u/bathew-ai')
    expect(phoneProfileHref('bathew-ai')).toBe('/app/u/bathew-ai')
    expect(phoneFollowsHref('chris_gm', 'followers')).toBe('/app/u/chris_gm/followers')
    expect(phoneFollowsHref('chris_gm', 'following')).toBe('/app/u/chris_gm/following')
  })

  it('a phone person path maps to its public page (desktop and signed-out visits go there)', () => {
    expect(publicPersonPath('/app/u/chris_gm')).toBe('/u/chris_gm')
    expect(publicPersonPath('/app/u/chris_gm/')).toBe('/u/chris_gm')
    expect(publicPersonPath('/app/u/chris_gm/followers')).toBe('/u/chris_gm/followers')
    expect(publicPersonPath('/app/u/chris_gm/following')).toBe('/u/chris_gm/following')
  })

  it('…and nothing else does', () => {
    for (const path of ['/app', '/app/u', '/app/u/', '/app/profile', '/u/chris_gm', '/app/u/chris_gm/lists', '/app/u/a/b', '/app/users/x', '/xapp/u/x']) {
      expect(publicPersonPath(path), path).toBeNull()
    }
  })
})

describe('Back, when nothing in the app is behind (#27)', () => {
  it('your own public profile goes to Profile; anyone else’s to Community, or Home while it is off', () => {
    expect(personProfileParent(true, true)).toBe('/app/profile')
    expect(personProfileParent(true, false)).toBe('/app/profile')
    expect(personProfileParent(false, true)).toBe('/app/explore')
    expect(personProfileParent(false, false)).toBe('/app')
  })
})

describe('the rows’ words', () => {
  const NOW = Date.parse('2026-10-27T12:00:00Z')

  it('a public list: the Profile tab’s sub, plus its likes when it has any', () => {
    const list = { player_count: 24, ranking_mode: 'ranked', updated_at: '2026-10-25T12:00:00Z', like_count: 3 }
    expect(personListSub(list, NOW)).toBe('24 players · Ranked · Updated 2d ago · 3 likes')
    expect(personListSub({ ...list, like_count: 1 }, NOW)).toBe('24 players · Ranked · Updated 2d ago · 1 like')
    expect(personListSub({ ...list, like_count: 0 }, NOW)).toBe('24 players · Ranked · Updated 2d ago')
    expect(personListSub({ ...list, like_count: null }, NOW)).toBe('24 players · Ranked · Updated 2d ago')
  })

  it('a person row: cred, then the bio’s first line', () => {
    expect(followRowSub({ cred_score: 7, bio: null })).toBe('7 cred')
    expect(followRowSub({ cred_score: 1340, bio: '  RB truther.\nSecond line ' })).toBe('1,340 cred · RB truther.')
    expect(followRowSub({ cred_score: 7, bio: '   ' })).toBe('7 cred')
  })

  it('the switch reads Followers N | Following N once the counts are known', () => {
    expect(FOLLOWS_KINDS.map((k) => k.value)).toEqual(['followers', 'following'])
    expect(followsSegmentLabel('followers', 1200)).toBe('Followers 1,200')
    expect(followsSegmentLabel('following', 0)).toBe('Following 0')
    expect(followsSegmentLabel('following', null)).toBe('Following')
  })

  it('empty lists say so in plain words, yours or someone else’s', () => {
    expect(followsEmptyCopy('followers', true)).toBe('No one follows you yet.')
    expect(followsEmptyCopy('followers', false)).toBe('No followers yet.')
    expect(followsEmptyCopy('following', true)).toBe('You aren’t following anyone yet.')
    expect(followsEmptyCopy('following', false)).toBe('Not following anyone yet.')
  })

  it('the big avatar: blue for you (the Profile tab’s), else the person’s own colour', () => {
    expect(personAvatarClass(true, 'user-me')).toBe('bg-accent')
    expect(personAvatarClass(false, 'user-x')).toMatch(/^bg-/)
    expect(personAvatarClass(false, 'user-x')).toBe(personAvatarClass(false, 'user-x'))
  })
})
