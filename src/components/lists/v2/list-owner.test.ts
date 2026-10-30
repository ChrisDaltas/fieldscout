/**
 * Lists v2 — whose list the open panel shows (walk-off-1). Someone else's
 * list you haven't saved used to name *you* as its author, link your profile,
 * and Share a `/u/<you>/lists/<slug>` link that 404s. Pinned here: you are the
 * author only of your own list; a saved list keeps the collection's owner;
 * anyone else's list shows its real owner once read, and no name (Share
 * disabled) until then.
 */
import { describe, expect, it } from 'vitest'

import {
  isViewersList,
  listShareLink,
  needsOwnerLookup,
  panelOwner,
  SHARE_LINK_FAILED,
  SHARE_LINK_LOADING,
  type PanelOwnerInput,
} from './list-owner'

const ME = { id: 'u-me', username: 'me', avatarUrl: 'me.png' }
const PENDING = { data: undefined, isError: false }

const input = (over: Partial<PanelOwnerInput> = {}): PanelOwnerInput => ({
  list: { is_owner: false, owner_id: 'u-devpro' },
  summary: undefined,
  viewer: ME,
  lookup: PENDING,
  ...over,
})

describe('panelOwner — someone else’s list you haven’t saved', () => {
  it('while the owner is being read: no name, Share disabled — never you', () => {
    const got = panelOwner(input())
    expect(got.owner).toBeNull()
    expect(got.shareAs).toBeNull()
    expect(got.shareUnavailable).toBe(SHARE_LINK_LOADING)
  })

  it('once read: the real owner, and Share carries their handle', () => {
    const got = panelOwner(input({ lookup: { data: { username: 'devpro', avatarUrl: 'd.png' }, isError: false } }))
    expect(got.owner).toEqual({ username: 'devpro', avatarUrl: 'd.png' })
    expect(got.shareAs).toBe('devpro')
    expect(got.shareUnavailable).toBeUndefined()
  })

  it('a failed read: no name, Share disabled with the reason — never you', () => {
    const got = panelOwner(input({ lookup: { data: undefined, isError: true } }))
    expect(got).toEqual({ owner: null, shareAs: null, shareUnavailable: SHARE_LINK_FAILED })
  })

  it('read and empty (no profile, or no handle) is final too — never you', () => {
    expect(panelOwner(input({ lookup: { data: null, isError: false } })).shareUnavailable).toBe(SHARE_LINK_FAILED)
    const noHandle = panelOwner(input({ lookup: { data: { username: null, avatarUrl: null }, isError: false } }))
    expect(noHandle.owner).toBeNull()
    expect(noHandle.shareAs).toBeNull()
    expect(noHandle.shareUnavailable).toBe(SHARE_LINK_FAILED)
  })

  it('the viewer’s name never appears, whatever the lookup says', () => {
    for (const lookup of [PENDING, { data: undefined, isError: true }, { data: null, isError: false }]) {
      const got = panelOwner(input({ lookup }))
      expect(got.owner?.username).not.toBe('me')
      expect(got.shareAs).not.toBe('me')
    }
  })
})

describe('panelOwner — your own and saved lists are unchanged', () => {
  it('your own list (is_owner): you, as before — no lookup', () => {
    const own = input({ list: { is_owner: true, owner_id: 'u-me' }, summary: { owner: null } })
    expect(panelOwner(own)).toEqual({
      owner: { username: 'me', avatarUrl: 'me.png' },
      shareAs: 'me',
      shareUnavailable: undefined,
    })
    expect(needsOwnerLookup(own.list, own.summary, ME.id)).toBe(false)
  })

  it('your own list before your profile has loaded: the byline is as before, Share waits', () => {
    const got = panelOwner(input({
      list: { is_owner: true, owner_id: 'u-me' },
      viewer: { id: 'u-me', username: null, avatarUrl: null },
    }))
    expect(got.owner).toEqual({ username: 'you', avatarUrl: null })
    expect(got.shareAs).toBeNull()
    expect(got.shareUnavailable).toBe(SHARE_LINK_LOADING)
  })

  it('a saved list: the collection’s owner, as before — no lookup', () => {
    const saved = input({ summary: { owner: { username: 'kelly', avatar_url: 'k.png' } } })
    expect(panelOwner(saved)).toEqual({ owner: { username: 'kelly', avatarUrl: 'k.png' }, shareAs: 'kelly' })
    expect(needsOwnerLookup(saved.list, saved.summary, ME.id)).toBe(false)
  })
})

describe('isViewersList / needsOwnerLookup', () => {
  it('yours by the server’s is_owner, or by owner id', () => {
    expect(isViewersList({ is_owner: true, owner_id: 'u-x' }, 'u-me')).toBe(true)
    expect(isViewersList({ is_owner: false, owner_id: 'u-me' }, 'u-me')).toBe(true)
    expect(isViewersList({ is_owner: false, owner_id: 'u-devpro' }, 'u-me')).toBe(false)
    // Signed-out (no id) never matches a list by id.
    expect(isViewersList({ is_owner: false, owner_id: 'u-devpro' }, undefined)).toBe(false)
  })

  it('looks up only someone else’s list that isn’t saved', () => {
    expect(needsOwnerLookup({ is_owner: false, owner_id: 'u-devpro' }, undefined, 'u-me')).toBe(true)
    expect(needsOwnerLookup({ is_owner: false, owner_id: 'u-devpro' }, { owner: null }, 'u-me')).toBe(true)
  })
})

describe('listShareLink', () => {
  it('is the public share page address', () => {
    expect(listShareLink('https://fieldscout.gg', 'devpro', 'sleepers')).toBe(
      'https://fieldscout.gg/u/devpro/lists/sleepers',
    )
  })
})
