/**
 * FieldScout Mobile — New list is one draft until Save (lr-lists §4; audit
 * lists-1: backing out of "2 of 2" left an empty list in My lists).
 *
 * Pinned here:
 *   - New list's entries: its first (the URL it opened on), step 1 again
 *     (`step=1`) and step 2 (`step=2`), each keeping `from=`.
 *   - A Back New list didn't take (the OS gesture) down to its first entry
 *     asks when the draft holds players, else carries on out — never while
 *     New list is leaving, and not without a draft.
 *   - Next's draft: fresh and empty, or the one Back kept — its players —
 *     under step 1's name.
 *   - ✕ on step 1 asks only once step 2 has players.
 *   - Save (`saveNewList`): nothing is made without a name; the list is made
 *     once, then its cover, its videos, then the players through the
 *     editor's write measured against the empty list just made; a cover or
 *     video failure doesn't stop it; a failed create makes nothing; players
 *     that fail after the list exists keep it — the note says the list
 *     saved — and Save again only writes what is left, never a second list.
 *   - The "List created" toast names what didn't make it.
 *   - The editor's view choices follow the list to its new id.
 */
import { afterEach, describe, expect, it } from 'vitest'

import type { CommitOutcome } from '@/hooks/use-mobile-lists-commit'
import type { ListPlayerWithPlayer } from '@/hooks/use-lists'
import { useListDisplayStore } from '@/stores/list-display-store'

import type { VideoDraft } from './details-payload'
import { saveFailureNote, type ListDraft } from './lists-model'
import { carryListSession, useListsSessionStore } from './lists-session-store'
import {
  createdToast,
  newListCloseAsks,
  newListDepth,
  newListStartHref,
  newListStepHref,
  newListStrayBack,
  saveNewList,
  stepTwoDraft,
  type CreatedList,
  type NewListSaveIO,
  type NewListSaveInput,
} from './new-list-save'
import { ADD_PLAYERS_TO_SHARE } from '@/lib/lists/share-hint'

function entry(id: string, position: number): ListPlayerWithPlayer {
  return {
    id: `draft-${id}`,
    list_id: 'new-list:test',
    player_id: id,
    position,
    overall_rank: position,
    tier: null,
    rank_in_tier: null,
    notes: null,
    slot: null,
    added_at: null,
    updated_at: null,
    player: { id, full_name: id, position: 'QB', team: 'BUF', headshot_url: null, status: 'active' },
    stats: { current_pts: 0, current_games: 0, last_pts: 0, last_games: 0, projected_pts: 0 },
  } as unknown as ListPlayerWithPlayer
}

const withPlayers = (draft: ListDraft, ...ids: string[]): ListDraft => ({
  ...draft,
  entries: ids.map((id, i) => entry(id, i + 1)),
})

const VIDEO: VideoDraft = { url: 'https://youtu.be/dQw4w9WgXcQ', yt: 'dQw4w9WgXcQ' } as VideoDraft

function input(extra: Partial<NewListSaveInput> = {}): NewListSaveInput {
  return {
    details: { desc: 'Week 6 starters', position: 'QB', coverColor: null, coloursReady: false, team: false, isPrivate: false },
    cover: null,
    videos: [],
    draft: withPlayers(stepTwoDraft(null, 'My top 5 QBs'), 'p1', 'p2'),
    created: null,
    ...extra,
  }
}

const OK: CommitOutcome = { ok: true, list: { id: 'l1' } as never }

/** IO that records every call, in order. */
function io(overrides: Partial<NewListSaveIO> = {}) {
  const calls: string[] = []
  const commitDrafts: ListDraft[] = []
  const fake: NewListSaveIO = {
    create: async (body) => {
      calls.push(`create ${body.title}`)
      return { id: 'l1', title: body.title, ranking_mode: 'ranked' }
    },
    uploadCover: async (listId) => {
      calls.push(`cover ${listId}`)
    },
    videos: {
      del: async () => {
        calls.push('video del')
      },
      post: async (listId) => {
        calls.push(`video ${listId}`)
      },
      titleOf: () => null,
    },
    commit: async (listId, draft) => {
      calls.push(`commit ${listId}`)
      commitDrafts.push(draft)
      return OK
    },
    ...overrides,
  }
  return { fake, calls, commitDrafts }
}

describe('New list’s entries', () => {
  it('step 2 and step 1 again are New list’s own URL, with `step=`, keeping where it came from', () => {
    expect(newListStepHref('from=grid', 2)).toBe('/app/lists/new?from=grid&step=2')
    expect(newListStepHref('', 2)).toBe('/app/lists/new?step=2')
    expect(newListStepHref('from=community&step=2', 1)).toBe('/app/lists/new?from=community&step=1')
    expect(newListStepHref(new URLSearchParams('step=2'), 1)).toBe('/app/lists/new?step=1')
  })

  it('the first is the URL New list opened on', () => {
    expect(newListStartHref('from=community&step=2')).toBe('/app/lists/new?from=community')
    expect(newListStartHref(new URLSearchParams('step=1'))).toBe('/app/lists/new')
  })

  it('counts the entries above the first', () => {
    expect(newListDepth(null)).toBe(0)
    expect(newListDepth('1')).toBe(1)
    expect(newListDepth('2')).toBe(2)
    expect(newListDepth('9')).toBe(0)
  })
})

describe('the OS back gesture from step 1 (gap list #16)', () => {
  const empty = stepTwoDraft(null, 'x')
  const held = withPlayers(empty, 'p1')

  it('down to New list’s first entry with players added: asks "Discard this list?"', () => {
    expect(newListStrayBack(1, 0, { draft: held, leaving: false })).toBe('ask')
    // Two back at once (the long-press Back menu) from step 2.
    expect(newListStrayBack(2, 0, { draft: held, leaving: false })).toBe('ask')
  })

  it('with no players: carries on out, as ✕ does — one gesture, not two', () => {
    expect(newListStrayBack(1, 0, { draft: empty, leaving: false })).toBe('leave')
  })

  it('leaves New list alone when it is leaving (Save, ✕, Discard) or has no draft (a reload)', () => {
    expect(newListStrayBack(1, 0, { draft: held, leaving: true })).toBeNull()
    expect(newListStrayBack(2, 0, { draft: empty, leaving: true })).toBeNull()
    expect(newListStrayBack(1, 0, { draft: null, leaving: false })).toBeNull()
  })

  it('only the step down to the first entry: Back from step 2 to step 1, and Next, are not it', () => {
    expect(newListStrayBack(2, 1, { draft: held, leaving: false })).toBeNull()
    expect(newListStrayBack(0, 1, { draft: held, leaving: false })).toBeNull()
    expect(newListStrayBack(1, 2, { draft: held, leaving: false })).toBeNull()
  })
})

describe('Next’s draft', () => {
  it('fresh: a ranked list with this name and no players, measured against the same empty list', () => {
    const draft = stepTwoDraft(null, 'My top 5 QBs')
    expect(draft).toMatchObject({ title: 'My top 5 QBs', mode: 'ranked', entries: [], pending: 0 })
    expect(draft.base).toEqual({ title: 'My top 5 QBs', ranking_mode: 'ranked', players: [] })
  })

  it('after Back: the players, Ranked / Tiers and tier lines are kept, under step 1’s name', () => {
    const kept: ListDraft = { ...withPlayers(stepTwoDraft(null, 'Old'), 'p1', 'p2'), mode: 'rank_and_tier', pending: 1 }
    const next = stepTwoDraft(kept, 'New name')
    expect(next.title).toBe('New name')
    expect(next.base.title).toBe('New name')
    expect(next.entries.map((e) => e.player_id)).toEqual(['p1', 'p2'])
    expect(next.mode).toBe('rank_and_tier')
    expect(next.pending).toBe(1)
  })
})

describe('✕ on step 1', () => {
  it('asks only once step 2 has players', () => {
    expect(newListCloseAsks(null)).toBe(false)
    expect(newListCloseAsks(stepTwoDraft(null, 'x'))).toBe(false)
    expect(newListCloseAsks(withPlayers(stepTwoDraft(null, 'x'), 'p1'))).toBe(true)
  })
})

describe('Save makes the list — and only Save', () => {
  it('makes it once, then the cover, the videos, then the players against the empty list just made', async () => {
    const { fake, calls, commitDrafts } = io()
    const cover = new File(['x'], 'cover.png', { type: 'image/png' })
    const outcome = await saveNewList(input({ cover, videos: [VIDEO] }), fake)
    expect(calls).toEqual(['create My top 5 QBs', 'cover l1', 'video l1', 'commit l1'])
    expect(outcome.ok).toBe(true)
    expect(outcome.created).toMatchObject({ id: 'l1', coverError: null, videoFailures: [] })
    // The write adds both players to the list as it was made: empty.
    expect(commitDrafts[0].base).toEqual({ title: 'My top 5 QBs', ranking_mode: 'ranked', players: [] })
    expect(commitDrafts[0].entries.map((e) => e.player_id)).toEqual(['p1', 'p2'])
  })

  it('sends step 1’s details under the name step 2 holds', async () => {
    let body: Record<string, unknown> = {}
    const { fake } = io({
      create: async (sent) => {
        body = sent as unknown as Record<string, unknown>
        return { id: 'l1', title: sent.title }
      },
    })
    const draft = { ...stepTwoDraft(null, 'Step 1 name'), title: '  Renamed in step 2 ' }
    await saveNewList(input({ draft, details: { ...input().details, isPrivate: true } }), fake)
    expect(body).toMatchObject({
      title: 'Renamed in step 2',
      description: 'Week 6 starters',
      position_filter: 'QB',
      ranking_mode: 'ranked',
      is_private: true,
    })
  })

  it('a list with a name and no players is made (the design allows zero players)', async () => {
    const { fake, calls } = io()
    const outcome = await saveNewList(input({ draft: stepTwoDraft(null, 'Empty on purpose') }), fake)
    expect(outcome.ok).toBe(true)
    expect(calls).toEqual(['create Empty on purpose', 'commit l1'])
  })

  it('no name, nothing made', async () => {
    const { fake, calls } = io()
    const outcome = await saveNewList(input({ draft: { ...stepTwoDraft(null, 'x'), title: '   ' } }), fake)
    expect(outcome.ok).toBe(false)
    expect(outcome.created).toBeNull()
    expect(calls).toEqual([])
  })

  it('a failed create makes nothing, writes nothing, and says so', async () => {
    const { fake, calls } = io({
      create: async () => {
        throw new Error('Network down')
      },
    })
    const outcome = await saveNewList(input({ videos: [VIDEO] }), fake)
    expect(outcome.ok).toBe(false)
    expect(outcome.created).toBeNull()
    expect(calls).toEqual([])
    if (outcome.ok) throw new Error('unreachable')
    expect(saveFailureNote(outcome.error, outcome.attempted, outcome.remaining)).toBe(
      'Could not create the list: Network down Nothing was saved.',
    )
  })

  it('a cover or video that fails doesn’t stop the save — it’s told in the toast', async () => {
    const { fake, calls } = io({
      uploadCover: async () => {
        throw new Error('Image too large')
      },
      videos: {
        del: async () => {},
        post: async () => {
          throw new Error('That video is private.')
        },
        titleOf: () => null,
      },
    })
    const outcome = await saveNewList(input({ cover: new File(['x'], 'c.png'), videos: [VIDEO] }), fake)
    expect(outcome.ok).toBe(true)
    expect(calls).toEqual(['create My top 5 QBs', 'commit l1'])
    expect(outcome.created).toMatchObject({ coverError: 'Image too large', videoFailures: ['That video is private.'] })
  })

  it('players that fail after the list exists keep it; Save again writes only the draft — never a second list', async () => {
    const failed: CommitOutcome = {
      ok: false,
      error: 'Could not add the players: request failed with 500',
      attempted: { fields: {}, remove: [], add: ['p1', 'p2'], tiers: [], order: null },
      remaining: { fields: {}, remove: [], add: ['p1', 'p2'], tiers: [], order: null },
      list: null,
    }
    const first = io({ commit: async () => failed })
    const outcome = await saveNewList(input(), first.fake)
    expect(outcome.ok).toBe(false)
    expect(outcome.created?.id).toBe('l1')
    if (outcome.ok) throw new Error('unreachable')
    // The note never says "Nothing was saved" once the list exists.
    expect(saveFailureNote(outcome.error, outcome.attempted, outcome.remaining, outcome.alsoSaved)).toBe(
      'Could not add the players: request failed with 500 Saved: the list. Not saved: 2 added players.',
    )

    const again = io()
    const retry = await saveNewList(input({ created: outcome.created }), again.fake)
    expect(retry.ok).toBe(true)
    expect(again.calls).toEqual(['commit l1'])
    expect(retry.created?.id).toBe('l1')
  })

  it('the list made but the players never sent (the write’s first read failed): the note says the list saved', async () => {
    const { fake } = io({
      commit: async () => ({ ok: false, error: 'Could not read the list: offline', attempted: null, remaining: null, list: null }),
    })
    const outcome = await saveNewList(input(), fake)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.created?.id).toBe('l1')
    expect(saveFailureNote(outcome.error, outcome.attempted, outcome.remaining, outcome.alsoSaved)).toBe(
      'Could not read the list: offline Saved: the list.',
    )
  })
})

describe('the "List created" toast', () => {
  const made = (extra: Partial<CreatedList> = {}) => ({ coverError: null, videoFailures: [], ...extra })

  it('says List created, and what didn’t make it', () => {
    expect(createdToast(made())).toEqual({ title: 'List created' })
    expect(createdToast(made({ coverError: 'Too big' }))).toEqual({
      title: 'List created, but the cover image didn’t upload',
      description: 'Too big',
    })
    expect(createdToast(made({ videoFailures: ['Private video'] }))).toEqual({
      title: 'List created, but a video couldn’t be added',
      description: 'Private video',
    })
    expect(createdToast(made({ coverError: 'Too big', videoFailures: ['a', 'b'] }))).toEqual({
      title: 'List created, but the cover image and 2 videos couldn’t be added',
      description: 'Too big',
    })
  })

  it('a list saved with no players says how to share it: "List created. Add players to share it." (plan C4)', () => {
    expect(createdToast(made(), ADD_PLAYERS_TO_SHARE)).toEqual({
      title: 'List created',
      description: 'Add players to share it.',
    })
    // What didn't make it is still the one toast that shows.
    expect(createdToast(made({ coverError: 'Too big' }), ADD_PLAYERS_TO_SHARE)).toEqual({
      title: 'List created, but the cover image didn’t upload',
      description: 'Too big',
    })
  })
})

describe('the editor’s view choices follow the new list', () => {
  afterEach(() => {
    useListDisplayStore.setState({ byList: {} })
    useListsSessionStore.setState({ tfByList: {}, scoringByList: {} })
  })

  it('stat columns, time frame and scoring move from the stand-in key to the list’s id', () => {
    useListDisplayStore.getState().setCols('new-list:abc', ['proj', 'adp'])
    useListsSessionStore.getState().setTf('new-list:abc', 'season')
    useListsSessionStore.getState().setScoring('new-list:abc', 'half')
    carryListSession('new-list:abc', 'l1')
    expect(useListDisplayStore.getState().byList.l1?.cols).toEqual(['proj', 'adp'])
    expect(useListsSessionStore.getState().tfByList.l1).toBe('season')
    expect(useListsSessionStore.getState().scoringByList.l1).toBe('half')
  })

  it('nothing chosen, nothing carried (the list keeps the defaults)', () => {
    const before = useListsSessionStore.getState()
    carryListSession('new-list:none', 'l2')
    expect(useListDisplayStore.getState().byList.l2).toBeUndefined()
    expect(useListsSessionStore.getState()).toBe(before)
  })
})
