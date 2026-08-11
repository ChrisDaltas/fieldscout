import type { ListWithTags } from '@/hooks/use-lists'

/**
 * Lists v2 — the page's pure state helpers.
 *
 * Everything here is a plain function over the payload `GET /api/lists`
 * already returns, so the screen adds no fetching of its own (LV.2 is UI-only:
 * delivery-plan-lists-v2.md §1). Kept out of the components so the tab split
 * and the date rule can be pinned by unit tests.
 */

/** Page mode — the handoff's three-segment view toggle (§"Lists page"). */
export type ListsPageMode = 'rail' | 'gallery' | 'compare'

/** Which set of lists the rail and the gallery show (§"Lists page" tabs). */
export type ListsTab = 'mine' | 'saved'

export interface PageModeOption {
  id: ListsPageMode
  label: string
  icon: 'list' | 'layers' | 'table'
  /** Side by side is Round 2 (delivery plan §6) — shown, not yet usable. */
  disabled?: boolean
  disabledReason?: string
}

export const PAGE_MODES: readonly PageModeOption[] = [
  { id: 'rail', label: 'List', icon: 'list' },
  { id: 'gallery', label: 'Cards', icon: 'layers' },
  {
    id: 'compare',
    label: 'Side by side',
    icon: 'table',
    disabled: true,
    disabledReason: 'Side by side arrives in round 2',
  },
] as const

/**
 * Split the collection into the handoff's two tabs.
 *
 * `GET /api/lists` returns the viewer's own lists plus lists they have saved
 * (favorited) from other people, and sets `owner` **only** on the ones they do
 * not own — see `src/app/api/lists/route.ts`. That flag is the tab split: it
 * is the server's answer, so no client-side auth comparison is needed (which
 * would race session loading).
 *
 * Favorites sorts first inside "My lists", matching the prototype's
 * `myLists()` (`design/lists.js:242`).
 */
export function partitionLists(lists: readonly ListWithTags[]): {
  mine: ListWithTags[]
  saved: ListWithTags[]
} {
  const mine: ListWithTags[] = []
  const saved: ListWithTags[] = []
  for (const list of lists) {
    if (list.owner) saved.push(list)
    else mine.push(list)
  }
  // Stable: only the Favorites list moves, everything else keeps API order
  // (updated_at desc).
  mine.sort((a, b) => Number(Boolean(b.is_favorites)) - Number(Boolean(a.is_favorites)))
  return { mine, saved }
}

/**
 * Handoff §"Copy": `Aug 8` for the current year, `Nov 9, 2025` otherwise.
 *
 * `now` is injectable so the year rule is testable without freezing the clock.
 */
export function formatCreated(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

/** `1 player` / `12 players` — sentence case, never all caps (§"Copy"). */
export function playerCountLabel(count: number | null | undefined): string {
  const n = count ?? 0
  return `${n} ${n === 1 ? 'player' : 'players'}`
}

/**
 * The distinct positions on a list, in list order, for the card's badge row.
 * Derived from the three players the collection endpoint already embeds — the
 * page never fetches a list's full roster to draw a card.
 */
export function listPositions(list: ListWithTags): string[] {
  const seen: string[] = []
  for (const p of list.first_players ?? []) {
    if (p.position && !seen.includes(p.position)) seen.push(p.position)
  }
  return seen
}
