import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { featureFlags } from '@/lib/feature-flags'

/**
 * LV.7 — the Lists v2 cutover, pinned.
 *
 * **This file replaces `src/lib/lists-v2-flag.test.ts`**, which pinned the
 * `featureFlags.listsV2` branch: that it defaulted OFF in a deployed build, ON
 * in local development, read its env var literally, and that each Lists route
 * took the v2 arm when the flag was ON and the legacy arm when it was OFF.
 *
 * Every one of those properties was **about a branch that no longer exists**, so
 * none of them survives the cutover as written. What replaces them is the
 * opposite guarantee, and it is the one worth keeping: there is exactly one
 * Lists surface, it is the rebuilt one, and the retired one is gone rather than
 * dormant. The old file's real point — "a one-character edit must not silently
 * change which Lists page production serves" — is preserved by making the
 * *absence* of a second page assertable.
 *
 * Source pins rather than renders, same idiom and same reason as
 * `ai-surfaces.test.ts` and `ui/elevation-rule.test.ts`: these are `.tsx`, which
 * Vite cannot parse under Next's `jsx: "preserve"`.
 */

const at = (file: string) => path.resolve(process.cwd(), file)
const read = (file: string) => readFileSync(at(file), 'utf8')

/**
 * Source with comments stripped. A pin has to read the **code**, not the prose
 * about it — these files explain at length what the flag *was*, and a pin that
 * cannot tell an explanation from a branch is a pin nobody can keep green
 * without deleting the explanation. (Learned in `use-draft-mode.test.ts`.)
 */
const code = (file: string) =>
  // **One pass, alternating**, not two sequential passes. A line comment can
  // contain `/*` — `// … `/app/**` is behind auth …` in the open list does
  // exactly that — and a block-comment strip run first sees that `/*` as an
  // opening token and swallows everything up to the next `*/`, silently eating
  // half the file and turning every pin below into "the string is not there".
  // Alternation scans left to right, so whichever token genuinely comes first
  // wins. (Found by LV.7 when this pin followed the guarded clear onto the
  // panel; `[^:]` still keeps `https://` out of it.)
  read(file).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, (_match, before) => before ?? '')

const LISTS_ROUTE = 'src/app/app/(shell)/lists/page.tsx'
const DETAIL_ROUTE = 'src/app/app/(shell)/lists/[listId]/page.tsx'
const DRAFT_MODE_ROUTE = 'src/app/app/(shell)/lists/draft-mode/page.tsx'
const PANEL = 'src/components/lists/v2/list-detail-panel.tsx'
const GALLERY_CARD = 'src/components/lists/v2/list-gallery-card.tsx'
const HERO = 'src/components/lists/v2/list-detail-hero.tsx'
const PAGE = 'src/components/lists/v2/lists-page-v2.tsx'
const BODY = 'src/components/lists/v2/list-body.tsx'

/** Every file the cutover deleted. Each is a whole surface, not a tidy-up. */
const RETIRED = [
  'src/components/lists/list-detail-view.tsx',
  'src/components/lists/lists-browse.tsx',
  'src/components/lists/list-card.tsx',
  'src/components/lists/comments-thread.tsx',
  'src/components/lists/customize-popover.tsx',
  'src/components/lists/editable-thumbnail.tsx',
  'src/components/lists/draft-mode/draft-mode-view.tsx',
  'src/components/lists/draft-mode/board-stage.tsx',
  'src/components/lists/draft-mode/board-column.tsx',
  'src/components/lists/draft-mode/select-stage.tsx',
  'src/components/lists/draft-mode/use-board-marks.ts',
  'src/components/lists/v2/list-detail-page-v2.tsx',
  'src/lib/lists-v2-flag.test.ts',
] as const

describe('the listsV2 flag is gone (LV.7)', () => {
  it('is not a feature flag any more', () => {
    expect(Object.keys(featureFlags)).not.toContain('listsV2')
  })

  it('leaves no branch on it anywhere in src/', () => {
    // A stale `featureFlags.listsV2` read would now be `undefined` — falsy, and
    // therefore silently the *legacy* arm of whatever it guarded. That is the
    // failure mode this asserts away rather than trusting a grep at review time.
    for (const file of [LISTS_ROUTE, DETAIL_ROUTE, PAGE, 'src/components/lists/generate-ai-modal.tsx']) {
      expect(code(file), `${file} still branches on the removed flag`).not.toContain('listsV2')
    }
  })
})

describe('the retired Lists surfaces are deleted, not dormant (LV.7)', () => {
  it.each(RETIRED)('%s no longer exists', (file) => {
    expect(existsSync(at(file))).toBe(false)
  })
})

describe('every Lists URL still resolves (LV.7)', () => {
  it('/app/lists serves the rebuilt page, unconditionally', () => {
    const source = read(LISTS_ROUTE)
    expect(source).toContain('<ListsPageV2 />')
    // `ListsPageV2` reads `?list=` with `useSearchParams`, which Next refuses to
    // prerender outside a boundary. Losing this makes the route fail to build,
    // not fail at runtime — so it is pinned where it is cheap to notice.
    expect(source).toContain('<Suspense>')
  })

  it('/app/lists/<id> redirects into the panel with that list selected', () => {
    const source = read(DETAIL_ROUTE)
    expect(source).toContain('redirect(`/app/lists?list=${encodeURIComponent(listId)}`)')
    // Not a placeholder, and not a second detail screen.
    expect(source).not.toContain('ListDetailPageV2')
  })

  it('the retired /app/lists/draft-mode redirects rather than 404s', () => {
    // The retired Lists page linked here from a CTA and from every folder tile,
    // so the URL is in histories and bookmarks.
    expect(read(DRAFT_MODE_ROUTE)).toContain("redirect('/app/lists')")
  })

  it('the Lists page reads the deep link the detail route sends it', () => {
    const source = read(PAGE)
    expect(source).toContain("useSearchParams().get('list')")
    // ...and does not bounce a deep-linked list that the collection has never
    // heard of — one the viewer can see but does not own or save.
    expect(source).toContain('if (deepLinkId && selectedId === deepLinkId) return')
  })
})

/**
 * The four capabilities Chris ruled must survive (PROGRESS §3 Q3, 2026-08-11 —
 * *"Right rail dragging is a MUST. Yes mini player card 100%, MUST… Folders yes
 * keep folders. Pin and Unpin great keep it."*).
 *
 * Each one lived **only** in a file this task deleted, which is exactly why they
 * are pinned: they have no other consumer to fail loudly if a later edit drops
 * them again.
 */
describe('the four ported capabilities are mounted (LV.7)', () => {
  it('the panel is the right rail’s drop target', () => {
    const source = read(PANEL)
    // The id shape `app-dnd-context.tsx` already parses — `overId.split(':').pop()`.
    expect(source).toContain('useDroppable({ id: `list-drop:detail:${listId}`')
    // It must be registered on the panel shell, above `ListBody`'s own nested
    // DndContext, or the rail's app-level drag never sees it.
    expect(source).toContain('dropRef={playerDrop.setNodeRef}')
  })

  it('a player name opens the app’s existing mini card', () => {
    // The *existing* window store, not a second card component.
    expect(read(PANEL)).toContain("from '@/stores/player-windows-store'")
    expect(read(PANEL)).toContain('openPlayerWindow(entry.player_id')
    // Wired in all three view styles.
    expect(read(BODY).match(/<PlayerName/g) ?? []).toHaveLength(3)
  })

  it('pin / unpin is reachable from the hero and the gallery card', () => {
    expect(read(PANEL)).toContain('useToggleFavorite')
    expect(read(HERO)).toContain("{list.is_favorited ? 'Unpin' : 'Pin'}")
    expect(read(GALLERY_CARD)).toContain("{list.is_favorited ? 'Unpin' : 'Pin'}")
  })

  it('folders keep their grid, their scope and their move gesture', () => {
    expect(read(PAGE)).toContain('<ListFoldersSection')
    expect(read(PAGE)).toContain('<FolderScopeCrumb')
    expect(read(PAGE)).toContain('<FolderFormDialog')
    // "Move to folder" from a list's own menu, on both surfaces.
    expect(read(HERO)).toContain('Move to folder')
    expect(read(GALLERY_CARD)).toContain('Move to folder')
  })
})

/**
 * `lists.ranking_mode = 'rank_and_tier'` keeps a writer.
 *
 * The retired detail view's *List order / Tiers* control was the last one in the
 * codebase: `list-form-dialog.tsx` sends only `unranked` or `ranked`, and
 * `/api/lists` reaches `rank_and_tier` only from a `tiers_enabled: true` payload
 * nothing sends. Without this, `resolveOrg(null, …)` would answer `'rank'`
 * forever and no list could ever be tiered again — while the create dialog goes
 * on promising *"Flip on the tiers view any time."*
 */
describe('a list can still become tiered (LV.7)', () => {
  it('choosing the Tier grouping persists rank_and_tier', () => {
    const source = read(PANEL)
    expect(source).toContain("'rank_and_tier'")
    expect(source).toContain('updateList.mutate(')
    expect(source).toContain('onOrgChange={chooseOrg}')
  })

  it('the create dialog still promises it', () => {
    // If this copy ever changes, the guarantee above is what it is promising.
    expect(read('src/components/lists/list-form-dialog.tsx')).toContain(
      'Flip on the tiers view any time.',
    )
  })
})
