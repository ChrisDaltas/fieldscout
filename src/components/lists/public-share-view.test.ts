import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { bucketBandClass } from '@/components/lists/bucket-colors'
import { buildBuckets } from '@/components/lists/v2/list-buckets'
import { LIST_ORGS } from '@/stores/list-display-store'

import type { ListPlayerWithPlayer } from '@/hooks/use-lists'

/**
 * LV.6 — the public share view, `/u/[username]/lists/[slug]`.
 *
 * Two properties, and each has already cost this codebase something.
 *
 * **1. It is server-rendered, so a throw is a 500.** LV.1.5's builder found
 * that widening `list_players_tier_check` would have crashed this exact page:
 * `public-list-view.tsx` seeded a `Map` with S–F keys and did
 * `map.get(key)!.push(p)`, so the first stored `r1` dereferenced `undefined`.
 * The page now groups through `buildBuckets`, which is total over `string` —
 * pinned below against the whole storable vocabulary *and* keys outside it,
 * in every grouping mode.
 *
 * **2. It is the only Lists surface a stranger sees.** So the subtractions are
 * pinned by source, not left to review: no write hook, no editor, no drag, no
 * drafted mark, and no `'use client'` on the page itself (plan **D7**,
 * CLAUDE.md's "all public-facing pages must be server-rendered for SEO"). The
 * source idiom is the house one for `.tsx` — Vite cannot parse them under
 * Next's `jsx: "preserve"` — the same as `ai-surfaces.test.ts` and
 * `lists-v2-flag.test.ts`.
 */

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8')

/**
 * The same source with comments removed.
 *
 * The "must not contain" pins below are about **code**, and this file's subject
 * is a screen whose whole design decision is a list of things it does not
 * mount — which the view documents in prose, naming every one of them. Scanning
 * the raw text would fail on its own explanation. (The `[^:]` guard keeps
 * `https://` out of the line-comment rule.)
 */
const readCode = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

const PAGE = 'src/app/u/[username]/lists/[listSlug]/page.tsx'
const VIEW = 'src/components/lists/public-list-view.tsx'
const ROW_PARTS = 'src/components/lists/v2/list-row-parts.tsx'

// =============================================================================
// 1. Bucket keys cannot 500 this page
// =============================================================================

const NO_LABELS: Readonly<Record<string, string>> = Object.freeze(Object.create(null))

function entry(id: string, tier: string | null, cost: number | null = 20): ListPlayerWithPlayer {
  return {
    id,
    list_id: 'l1',
    player_id: `p-${id}`,
    position: Number(id),
    tier,
    added_at: null,
    notes: null,
    overall_rank: null,
    rank_in_tier: null,
    slot: null,
    updated_at: null,
    player: {
      id: `p-${id}`,
      full_name: `Player ${id}`,
      position: 'WR',
      team: 'NYG',
      headshot_url: null,
      status: null,
      auction_value: cost,
    },
    stats: null,
  } as unknown as ListPlayerWithPlayer
}

/**
 * Everything `list_players.tier` can hold after migration 081, plus three
 * things it cannot — because `duplicate_list` copies `tier` verbatim without
 * ever meeting Zod, and because the CHECK could be widened again by someone
 * who never reads this file.
 */
const TIER_KEYS = [
  null,
  'S',
  'A',
  'F',
  'r1',
  'r7',
  'r10',
  'r30',
  'c1',
  'c4',
  // Not in the vocabulary. The page must render them, not crash on them.
  'r99',
  'zz',
  '__proto__',
]

describe('the share view survives every bucket key, in every grouping', () => {
  const entries = TIER_KEYS.map((tier, index) => entry(String(index + 1), tier))

  for (const org of LIST_ORGS) {
    it(`${org}: renders every player exactly once and never throws`, () => {
      const buckets = buildBuckets({ org, entries, bandLabels: NO_LABELS, budget: 200 })

      const placed = buckets.flatMap((bucket) => bucket.entries.map((e) => e.id))
      expect(new Set(placed).size, 'no player is duplicated across sections').toBe(placed.length)
      expect(placed.sort()).toEqual(entries.map((e) => e.id).sort())
    })

    it(`${org}: every section gets a real colour, never undefined`, () => {
      const buckets = buildBuckets({ org, entries, bandLabels: NO_LABELS, budget: 200 })
      for (const bucket of buckets) {
        // `cn(undefined)` was the silent-failure shape LV.1.5 closed: a band
        // with no fill at all, on this page and the legacy detail view.
        expect(typeof bucket.className).toBe('string')
        expect(bucket.key).toBeTruthy()
      }
    })
  }

  it('an out-of-vocabulary key gets the neutral fill, not tier 1', () => {
    // A bucket nobody can name must not be dressed up as the best tier.
    expect(bucketBandClass('r99')).toBe(bucketBandClass('zz'))
    expect(bucketBandClass('r99')).not.toBe(bucketBandClass('S'))
  })

  it('a round key is Ungrouped in tier mode rather than dropped', () => {
    const buckets = buildBuckets({
      org: 'tier',
      entries: [entry('1', 'S'), entry('2', 'r1')],
      bandLabels: NO_LABELS,
      budget: 200,
    })
    const ungrouped = buckets.find((bucket) => bucket.key === 'ungrouped')
    expect(ungrouped?.entries.map((e) => e.id)).toEqual(['2'])
  })
})

// =============================================================================
// 2. The page stays on the server (D7)
// =============================================================================

describe('the share route is server-rendered', () => {
  it('the page is not a client component', () => {
    // The whole point of the route. A `'use client'` here moves the list into
    // a hydration payload and out of the crawlable HTML.
    expect(read(PAGE)).not.toMatch(/^\s*['"]use client['"]/m)
  })

  it('the page fetches on the server, not through a hook', () => {
    const source = read(PAGE)
    expect(source).toContain('createServerClient')
    expect(source).not.toContain('useQuery')
  })

  it('a private list is 404, never a partial render', () => {
    const source = read(PAGE)
    expect(source).toContain('if (!list || list.is_private) return null')
    expect(source).toContain('notFound()')
  })

  it('players carry the stat columns the shared body renders', () => {
    // A narrower select than `/api/lists/[id]`'s renders an em dash in every
    // stat cell — "we hold no value" — on the one page strangers see.
    const source = read(PAGE)
    for (const column of ['adp', 'bye_week', 'sos', 'auction_value']) {
      expect(source, `players select must include ${column}`).toContain(column)
    }
  })
})

// =============================================================================
// 3. What a stranger does not get
// =============================================================================

describe('the share view is read-only', () => {
  const source = readCode(VIEW)

  it('mounts the shared v2 components rather than a fork of them', () => {
    for (const shared of [
      'ListHeroShell',
      'ListToolbar',
      'ListBody',
      'ListDetailsTab',
      'ListCommentsTab',
      'EmptyListState',
    ]) {
      expect(source, `${shared} must be the shared component`).toContain(shared)
    }
  })

  it('passes no editing rights to any of them', () => {
    expect(source).toContain('canEdit: false')
    expect(source).toContain('canMark: false')
    expect(source).toContain('canEdit={false}')
    expect(source).toContain('canRename={false}')
  })

  it('mounts no write gesture: no drag, no add, no rename, no bucket write', () => {
    for (const banned of [
      'AddPlayersPopover',
      'onAddPlayers',
      'onDrop',
      'onRenameBand',
      'onAddToBucket',
      'onRename={',
    ]) {
      expect(source, `${banned} must not reach the public view`).not.toContain(banned)
    }
  })

  it('mounts no mutation hook', () => {
    for (const hook of [
      'useUpdateList',
      'useAddPlayer',
      'useRemovePlayer',
      'useDeleteList',
      'useDuplicateList',
      'useReorderPlayers',
      'useSetPlayerTier',
      'useAddLink',
      'useRemoveLink',
      'useDraftMode',
    ]) {
      expect(source, `${hook} must not reach the public view`).not.toContain(hook)
    }
  })

  it('offers no options menu — every item on it is owner-or-account', () => {
    expect(source).not.toContain('DropdownMenu')
  })

  it('the row menu disappears rather than opening empty', () => {
    // With drafted, Add note and Remove all subtracted there is nothing left to
    // put in it, and a trigger that opens an empty popover is worse than none.
    expect(readCode(ROW_PARTS)).toContain('if (!showDrafted && !actions.canEdit) return null')
  })
})
