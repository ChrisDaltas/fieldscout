import { create } from 'zustand'

import type { RankingMode } from '@/types/schemas/lists'

/**
 * Lists v2 — session-only display state (LV.1.4, delivery-plan-lists-v2.md D3).
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ THIS STORE IS DELIBERATELY NOT PERSISTED. DO NOT "FIX" THAT.          │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * D3 (Chris, 2026-08-09): *"`view`, `cols`, cost-band labels and `budget` live
 * in plain component/Zustand state with no `persist` middleware and no
 * columns. They reset on reload, like a search filter. Do not add persistence
 * 'for convenience' — it was considered and declined."*
 *
 * Six other stores in this directory (`ai-build-store`, `list-order-store`,
 * `history-store`, `rail-store`, `board-labels-store`, `player-windows-store`)
 * wrap themselves in `persist` + `createJSONStorage(() => localStorage)`. This
 * one follows their code style and **not** their persistence, on purpose. The
 * absence is a product decision, not an oversight — so it is pinned by tests
 * rather than left to a comment: `list-display-store.test.ts` fails if this
 * module ever imports the persistence middleware, touches web storage, or
 * survives a module reload. If you are here to add persistence, you need a
 * ruling from Chris and a plan changelog entry first, not a green build.
 *
 * ## What lives here, and what deliberately does not
 *
 * | State | Where it lives | Why |
 * | --- | --- | --- |
 * | `view`, `cols`, band labels, `budget`, `org` | here, session only | D3 |
 * | which bucket a player sits in | `list_players.tier`, server-side | D4 |
 * | which players are drafted | `list_player_drafted`, server-side | D2/LV.1.2 |
 *
 * **`org` is here — as an override, not as the value.** D3 does not name it,
 * so the call is spelled out. D4 splits the mechanism in two: the bucket a
 * player sits in is `list_players.tier` and travels with a shared list, while
 * *"only the label set is local"* — and `org` is precisely the label-set
 * selector ("Tier 3" vs "Round 3" vs a cost band's text). Local means session
 * state, and this store is this build's one home for it.
 *
 * It is `ListOrg | null` rather than a plain value because `rank` vs `tier`
 * already has a server-side answer today (`lists.ranking_mode`, written by the
 * legacy List order / Tiers control). A store that *owned* `org` with a
 * hard-coded default would silently re-group every tiered list as ranked on
 * every load. `null` means "the session has no opinion; use the list's own" —
 * see {@link resolveOrg}.
 *
 * **This store never writes to the server.** It holds no player rows and no
 * bucket membership. If LV.3.2 decides that choosing Tiers in the v2 grouping
 * dropdown should also persist `ranking_mode` the way today's control does,
 * that is a route call it makes *alongside* `setOrg` — not something this
 * store starts doing.
 *
 * Design LAW: `docs/design/lists/README.md` — "Data model" (`org`, `view`,
 * `cols`, `costBands`, `budget`), "Toolbar", "View style: Cards".
 */

// =============================================================================
// Vocabulary
// =============================================================================

/** View styles from the design LAW toolbar: List, Table, Cards. */
export const LIST_VIEWS = ['list', 'table', 'card'] as const
export type ListView = (typeof LIST_VIEWS)[number]

/** Grouping modes — four label sets over one bucket mechanism (D4). */
export const LIST_ORGS = ['rank', 'tier', 'round', 'cost', 'budget'] as const
export type ListOrg = (typeof LIST_ORGS)[number]

/**
 * Default cost-band labels, in display order (design LAW "Avg cost"; prototype
 * `lists.js` `defaultCostBands`). The prototype's `min` threshold is dropped on
 * purpose: under D4 nothing is computed from a player's price — a band is a
 * bucket you drag into, exactly like a tier, and the label is free text.
 *
 * Cost bands are the *only* renameable buckets (design LAW Interactions:
 * "Click tier label (cost bands, owner only) → Inline rename"). Tier and round
 * headers render their value and are not editable.
 *
 * These keys are this store's own; the vocabulary written to
 * `PATCH /api/lists/[id]/players/[playerId]/tier` is LV.1.5's to define. If the
 * two need to agree, reconcile there — nothing here is on the wire.
 */
export const DEFAULT_COST_BANDS = [
  { key: 'c1', label: '$40 and up' },
  { key: 'c2', label: '$25 – $39' },
  { key: 'c3', label: '$10 – $24' },
  { key: 'c4', label: 'Under $10' },
] as const

/**
 * Card view renders only the first three chosen stats (design LAW "View style:
 * Cards"); list and table views show all of them.
 */
export const CARD_VIEW_COL_COUNT = 3

/** Auction budget bounds — whole dollars, clamped in {@link setBudget}. */
export const DEFAULT_BUDGET = 200
export const MIN_BUDGET = 1
export const MAX_BUDGET = 10_000

/**
 * Opening stat columns. Mirrors `DEFAULT_LIST_ROW_STATS` in
 * `customize-popover.tsx` so v2 opens on the same three stats today's list
 * does, rather than inventing a new default. The id *vocabulary* belongs to the
 * stat catalog LV.3.7 builds — this store treats ids as opaque strings.
 */
export const DEFAULT_COLS: readonly string[] = Object.freeze(['proj', 'last', 'adp'])

// =============================================================================
// Shape
// =============================================================================

/** One list's display preferences. Every field resets on reload (D3). */
export interface ListDisplay {
  /** List / Table / Cards. */
  readonly view: ListView
  /** Session override of the grouping label set; `null` = use the list's own. */
  readonly org: ListOrg | null
  /** Chosen stat ids, in the user's chosen order. */
  readonly cols: readonly string[]
  /** Cost-band key → the owner's custom label. Absent = the default label. */
  readonly bandLabels: Readonly<Record<string, string>>
  /** Auction budget, whole dollars. */
  readonly budget: number
}

/**
 * The shared value returned for any list nobody has customised yet. Frozen and
 * returned **by reference**, so `useListDisplay` hands React a stable snapshot
 * — zustand v5 re-renders forever if a selector builds a fresh object each
 * call.
 */
export const DEFAULT_LIST_DISPLAY: ListDisplay = Object.freeze({
  view: 'list',
  org: null,
  cols: DEFAULT_COLS,
  bandLabels: Object.freeze({}),
  budget: DEFAULT_BUDGET,
})

interface ListDisplayState {
  /** Keyed by `listId`. A missing entry means "still at the defaults". */
  byList: Readonly<Record<string, ListDisplay>>

  setView: (listId: string, view: ListView) => void
  /** `null` drops the session override and falls back to the list's own. */
  setOrg: (listId: string, org: ListOrg | null) => void
  /** Replaces the chosen stats wholesale — duplicates are dropped, order kept. */
  setCols: (listId: string, cols: readonly string[]) => void
  /** Adds an unchosen stat at the end of the chips, or removes a chosen one. */
  toggleCol: (listId: string, statId: string) => void
  /** Moves a chosen stat to `toIndex` (clamped). Unknown stat = no-op. */
  moveCol: (listId: string, statId: string, toIndex: number) => void
  /** Renames a cost band. A blank label restores the default. */
  setBandLabel: (listId: string, bandKey: string, label: string) => void
  setBudget: (listId: string, budget: number) => void
  /** Back to the defaults for one list; other lists are untouched. */
  reset: (listId: string) => void
}

// =============================================================================
// Store
// =============================================================================

export const useListDisplayStore = create<ListDisplayState>()((set) => {
  /**
   * Applies `next` to one list. Returning the same object the updater was given
   * is a true no-op: zustand skips notifying when `set` returns the state
   * unchanged, so unaffected components never re-render.
   */
  const update = (listId: string, next: (current: ListDisplay) => ListDisplay) =>
    set((state) => {
      const current = state.byList[listId] ?? DEFAULT_LIST_DISPLAY
      const updated = next(current)
      if (updated === current) return state
      return { byList: { ...state.byList, [listId]: updated } }
    })

  return {
    byList: {},

    setView: (listId, view) =>
      update(listId, (current) => (current.view === view ? current : { ...current, view })),

    setOrg: (listId, org) =>
      update(listId, (current) => (current.org === org ? current : { ...current, org })),

    setCols: (listId, cols) =>
      update(listId, (current) => ({ ...current, cols: dedupe(cols) })),

    toggleCol: (listId, statId) =>
      update(listId, (current) => ({
        ...current,
        cols: current.cols.includes(statId)
          ? current.cols.filter((id) => id !== statId)
          : [...current.cols, statId],
      })),

    moveCol: (listId, statId, toIndex) =>
      update(listId, (current) => {
        const from = current.cols.indexOf(statId)
        if (from < 0) return current
        const to = Math.max(0, Math.min(current.cols.length - 1, Math.trunc(toIndex)))
        if (to === from) return current
        const cols = [...current.cols]
        cols.splice(from, 1)
        cols.splice(to, 0, statId)
        return { ...current, cols }
      }),

    setBandLabel: (listId, bandKey, label) =>
      update(listId, (current) => {
        const trimmed = label.trim()
        const bandLabels = { ...current.bandLabels }
        // Clearing the text is how you get the default back — storing "" would
        // render a nameless band header that no longer says what it holds.
        if (trimmed) bandLabels[bandKey] = trimmed
        else delete bandLabels[bandKey]
        return { ...current, bandLabels }
      }),

    setBudget: (listId, budget) =>
      update(listId, (current) => {
        // A cleared number input arrives as NaN. Writing that through would put
        // "$NaN" in every budget header, so the call is refused outright rather
        // than coerced into a plausible-looking number.
        if (!Number.isFinite(budget)) return current
        const clamped = Math.max(MIN_BUDGET, Math.min(MAX_BUDGET, Math.round(budget)))
        return clamped === current.budget ? current : { ...current, budget: clamped }
      }),

    reset: (listId) =>
      set((state) => {
        if (!(listId in state.byList)) return state
        const byList = { ...state.byList }
        delete byList[listId]
        return { byList }
      }),
  }
})

// =============================================================================
// Selectors and pure helpers
// =============================================================================

/** Drops duplicates, keeping first-chosen order, and copies the caller's array. */
function dedupe(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)]
}

/**
 * One list's display state, or the shared frozen default if it has none yet.
 * Stable by reference between mutations — safe as a zustand selector.
 */
export const selectListDisplay =
  (listId: string) =>
  (state: ListDisplayState): ListDisplay =>
    state.byList[listId] ?? DEFAULT_LIST_DISPLAY

/** Hook form of {@link selectListDisplay}. */
export function useListDisplay(listId: string): ListDisplay {
  return useListDisplayStore(selectListDisplay(listId))
}

/**
 * The grouping to render: the session override if the user picked one, else the
 * list's own server-side answer (D4 — only the label set is local).
 *
 * `rank_and_tier` is today's "Tiers" setting, so it opens on tier labels;
 * `ranked` and `unranked` have no buckets and open on plain rank. Round, cost
 * and budget have no server-side representation by design — they are label sets
 * over the same buckets, so they can only ever be a session choice.
 */
export function resolveOrg(
  override: ListOrg | null | undefined,
  rankingMode: RankingMode | string | null | undefined,
): ListOrg {
  return override ?? (rankingMode === 'rank_and_tier' ? 'tier' : 'rank')
}

/**
 * A cost band's header text: the owner's rename, else the LAW default, else the
 * raw key (a band this store has never heard of still renders something).
 */
export function resolveBandLabel(
  bandKey: string,
  bandLabels: Readonly<Record<string, string>>,
): string {
  return (
    bandLabels[bandKey] ??
    DEFAULT_COST_BANDS.find((band) => band.key === bandKey)?.label ??
    bandKey
  )
}

/**
 * The stats a given view actually renders — card view shows the first three,
 * list and table show all (design LAW "View style: Cards").
 *
 * Returns a fresh array for card view, so use it inside a render or a memo, not
 * as a zustand selector.
 */
export function colsForView(cols: readonly string[], view: ListView): readonly string[] {
  return view === 'card' ? cols.slice(0, CARD_VIEW_COL_COUNT) : cols
}
