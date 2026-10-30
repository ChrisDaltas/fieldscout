/**
 * Lists — whose list is open (walk-off-1), one rule for the desktop panel and
 * the phone's list view. Someone else's list you haven't saved used to name
 * *you* as its author, link your profile, and Share a `/u/<you>/lists/<slug>`
 * link that 404s. Pinned here: you are the author only of your own list; a
 * saved list keeps the collection's owner; anyone else's list shows its real
 * owner once read, and no name (Share disabled) until then; a read that fails
 * says so (`ownerNote`) instead of passing for a list with no author.
 */
import { describe, expect, it } from 'vitest'

import {
  isViewersList,
  listShareLink,
  needsOwnerLookup,
  OWNER_UNREADABLE,
  resolveListOwner,
  SHARE_LINK_FAILED,
  SHARE_LINK_LOADING,
  type ListOwnerInput,
} from './list-owner'

const ME = { id: 'u-me', username: 'me', avatarUrl: 'me.png' }
const PENDING = { data: undefined, isError: false }

const input = (over: Partial<ListOwnerInput> = {}): ListOwnerInput => ({
  list: { is_owner: false, owner_id: 'u-devpro' },
  summary: undefined,
  viewer: ME,
  lookup: PENDING,
  ...over,
})

describe('resolveListOwner — someone else’s list you haven’t saved', () => {
  it('while the owner is being read: no name, Share disabled — never you', () => {
    const got = resolveListOwner(input())
    expect(got.owner).toBeNull()
    expect(got.shareAs).toBeNull()
    expect(got.shareUnavailable).toBe(SHARE_LINK_LOADING)
    // Still loading is not a failure: no note, just no name yet.
    expect(got.ownerNote).toBeUndefined()
  })

  it('once read: the real owner, and Share carries their handle', () => {
    const got = resolveListOwner(input({ lookup: { data: { username: 'devpro', avatarUrl: 'd.png' }, isError: false } }))
    expect(got.owner).toEqual({ username: 'devpro', avatarUrl: 'd.png' })
    expect(got.shareAs).toBe('devpro')
    expect(got.shareUnavailable).toBeUndefined()
    expect(got.ownerNote).toBeUndefined()
  })

  it('a failed read: no name, Share disabled with the reason, and the byline says so — never you', () => {
    const got = resolveListOwner(input({ lookup: { data: undefined, isError: true } }))
    expect(got).toEqual({
      owner: null,
      shareAs: null,
      shareUnavailable: SHARE_LINK_FAILED,
      ownerNote: OWNER_UNREADABLE,
    })
  })

  it('read and empty (no profile, or no handle) is final too — never you', () => {
    const none = resolveListOwner(input({ lookup: { data: null, isError: false } }))
    expect(none.shareUnavailable).toBe(SHARE_LINK_FAILED)
    expect(none.ownerNote).toBe(OWNER_UNREADABLE)
    const noHandle = resolveListOwner(input({ lookup: { data: { username: null, avatarUrl: null }, isError: false } }))
    expect(noHandle.owner).toBeNull()
    expect(noHandle.shareAs).toBeNull()
    expect(noHandle.shareUnavailable).toBe(SHARE_LINK_FAILED)
    expect(noHandle.ownerNote).toBe(OWNER_UNREADABLE)
  })

  it('a list with no owner id can never be read: final, not loading forever', () => {
    const got = resolveListOwner(input({ list: { is_owner: false, owner_id: null } }))
    expect(got).toEqual({
      owner: null,
      shareAs: null,
      shareUnavailable: SHARE_LINK_FAILED,
      ownerNote: OWNER_UNREADABLE,
    })
  })

  it('the viewer’s name never appears, whatever the lookup says', () => {
    for (const lookup of [PENDING, { data: undefined, isError: true }, { data: null, isError: false }]) {
      const got = resolveListOwner(input({ lookup }))
      expect(got.owner?.username).not.toBe('me')
      expect(got.shareAs).not.toBe('me')
    }
  })
})

describe('resolveListOwner — your own and saved lists are unchanged', () => {
  it('your own list (is_owner): you, as before — no lookup', () => {
    const own = input({ list: { is_owner: true, owner_id: 'u-me' }, summary: { owner: null } })
    expect(resolveListOwner(own)).toEqual({
      owner: { username: 'me', avatarUrl: 'me.png' },
      shareAs: 'me',
      shareUnavailable: undefined,
    })
    expect(needsOwnerLookup(own.list, own.summary, ME.id)).toBe(false)
  })

  it('your own list before your profile has loaded: the byline is as before, Share waits', () => {
    const got = resolveListOwner(input({
      list: { is_owner: true, owner_id: 'u-me' },
      viewer: { id: 'u-me', username: null, avatarUrl: null },
    }))
    expect(got.owner).toEqual({ username: 'you', avatarUrl: null })
    expect(got.shareAs).toBeNull()
    expect(got.shareUnavailable).toBe(SHARE_LINK_LOADING)
    expect(got.ownerNote).toBeUndefined()
  })

  it('a saved list: the collection’s owner, as before — no lookup', () => {
    const saved = input({ summary: { owner: { username: 'kelly', avatar_url: 'k.png' } } })
    expect(resolveListOwner(saved)).toEqual({ owner: { username: 'kelly', avatarUrl: 'k.png' }, shareAs: 'kelly' })
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
