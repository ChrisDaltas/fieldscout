'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import type { ListWithTags } from '@/hooks/use-lists'
import { cn } from '@/lib/utils'

import { ListCoverTile } from './cover-tile'

/**
 * Lists v2 — Side by side, step one: **the picker** (LV.12).
 *
 * Built from `docs/design/lists/screens/side-by-side-picker.png` and the design
 * LAW's §"Mode: Side by side" → *Picker* bullet, with
 * `docs/design/lists/design/ListsScreen.jsx` (`ComparePicker`, :428) as the
 * prototype source. Picking the lists is deliberately its own step: the columns
 * then stay stable while you work a live draft.
 *
 * ## The set it offers, and the plan clause it does not follow
 *
 * **Every list on the page — your own first, then saved — regardless of which
 * of the My lists / Saved tabs is active.** The delivery plan's §6 task row
 * says the picker *"honours the My lists / Saved tab"*; that clause is wrong
 * against the design package, which outranks it (`PROGRESS-lists-v2.md`
 * header: *design LAW > delivery plan > PROGRESS*), and the evidence is
 * unambiguous:
 *
 * | Source | Says |
 * | --- | --- |
 * | `ListsScreen.jsx:431` | `const rows = st.myLists().concat(st.savedLists())` — the tab is not read |
 * | `ListsScreen.jsx:49` | the tab control is **hidden** in compare mode (`st.mode !== "compare"`) |
 * | `side-by-side-picker.png` | renders **9** cards, which is the prototype's 7 own + 2 saved lists, own first |
 *
 * The two combine into a trap rather than a simplification: because the tab
 * control does not render in this mode, honouring the tab would mean a viewer
 * sitting on *My lists* could never compare a saved board, and one sitting on
 * *Saved* could never compare their own — with no control on screen to change
 * it. Comparing your board against someone else's is the reason the mode
 * exists. The erratum is folded into the plan (§6, v5.1) rather than left as a
 * local deviation, and `side-by-side-picker.test.ts` pins it so a later
 * "tidy-up" cannot quietly reinstate the filter.
 *
 * ## The copy's promise, what ships today, and what LV.14 adds
 *
 * The sub-line — *"Mark players off as they go in your draft and every column
 * updates"* — is the design's own copy and ships verbatim.
 *
 * **Today it is ahead of the behaviour, and that interval is deliberate**
 * (LV.13 review, **R220**). As of LV.13 a tick is *one tick on one list*:
 * `side-by-side-columns.tsx` marks through `useDraftMode(listId)` for the column
 * you clicked in, so a player sitting in four columns strikes through in one and
 * the other three headers do not move. **LV.14 is what makes the sentence true**
 * — plan §6, D12 — and discharging this note is part of that task's row. Until
 * it lands, do not read the copy as a description of shipped behaviour, and do
 * not "fix" it: the wording is the design's and stays.
 *
 * What the sentence will never mean is a **global** mark. It is bounded because
 * **the comparison set is the draft** (**D12**): LV.14 fans a drafted tick out
 * across exactly the lists in this comparison — every column on screen — and no
 * further. The handoff's global `toggleDrafted` (*"sets the flag on that player
 * in every list that contains him"*) is **overridden** by Chris, 2026-08-10:
 * *"marking a player as drafted is per user, per list… players will have
 * multiple lists for multiple leagues."* Nothing here promises a mark that
 * reaches a list you did not pick.
 *
 * ## Scale and elevation
 *
 * The handoff's numbers are 1× and this app's tokens are ×0.8 (plan §1), the
 * same conversion the shipped gallery (268 → 214) and rail (cover 30 → 24)
 * already made:
 *
 * | Handoff | Here |
 * | --- | --- |
 * | grid `minmax(232px, 1fr)`, gap 10 | `minmax(186px, 1fr)`, `gap-2` |
 * | 30px cover | `ListCoverTile size={24}` — the shared cover, never a second one |
 * | name 13/700, `N players` 11/500 mono | 10.5/700, 9/500 mono |
 * | heading 18/700, sub-line 13/500, max-width 520 | 14.5/700, 10.5/500, 416px |
 * | container max-width 720 | 576px |
 *
 * The **16px checkbox stays 16px**: `DraftedCheckbox` in `list-row-parts.tsx`
 * already takes the prototype's 14px box at 1:1, so shrinking this one would
 * invert the design's own size relationship between the two, and 16px is the
 * smaller end of a comfortable hit target even though the whole card is the
 * control.
 *
 * Cards **rest flat with the 1px ink border and lift on hover only**
 * (CLAUDE.md → Elevation; design LAW §Geometry). Selected is a *resting*
 * condition, so it is carried by fill and border — `bg-accent-soft` /
 * `border-accent` — and never by a shadow.
 */
export function SideBySidePicker({
  lists,
  loading,
  onShow,
}: {
  /** Every list the page holds — own lists first, then saved. */
  lists: ListWithTags[]
  /**
   * Whether the collection has actually arrived — **not** the negation of
   * `isPending`. An empty grid must never claim "you have no lists" over a
   * request that has not answered (CLAUDE.md: never let "nothing happened"
   * mean "it worked"); the rail carries the same guard for the same reason.
   */
  loading: boolean
  /** Commit the comparison. Session-only state, held by the page (D3). */
  onShow: (ids: string[]) => void
}) {
  const [picked, setPicked] = React.useState<string[]>([])

  const available = React.useMemo(() => new Set(lists.map((list) => list.id)), [lists])

  /**
   * What the button would actually open.
   *
   * A list can leave the collection while the picker is open — deleted in
   * another tab, or unpinned from Saved — and a tick taken before that would
   * otherwise survive in `picked` and be committed as a column for a list that
   * no longer exists. Deriving the count the button *shows* from the same
   * filter it *commits* means the label can never over-promise.
   */
  const chosen = React.useMemo(
    () => picked.filter((id) => available.has(id)),
    [picked, available],
  )

  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    )

  return (
    <div className="flex max-w-[576px] flex-col gap-3">
      <div>
        <h4 className="text-[14.5px] font-bold leading-tight tracking-[-0.01em]">
          Pick the lists to compare
        </h4>
        {/* The design's own sub-line, verbatim. "Every column updates" is a
            promise about the comparison, not about your account — and it is
            true from LV.14, not from LV.13. See the header note above (D12,
            R220) before treating it as a description of today. */}
        <p className="mt-1 max-w-[416px] text-[10.5px] font-medium leading-snug text-n-3">
          They show up as columns across the page. Mark players off as they go in your draft and
          every column updates.
        </p>
      </div>

      {loading ? (
        <div
          className="grid grid-cols-[repeat(auto-fill,minmax(186px,1fr))] gap-2"
          aria-busy="true"
          aria-label="Loading your lists"
        >
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div key={index} className="flex animate-pulse items-center gap-2 border border-n-4 bg-white p-2">
              <span className="h-4 w-4 shrink-0 rounded-sm bg-n-4" />
              <span className="h-6 w-6 shrink-0 rounded-sm bg-n-4" />
              <span className="h-2.5 flex-1 rounded-sm bg-n-4" />
            </div>
          ))}
        </div>
      ) : lists.length === 0 ? (
        /* The design package shows no empty picker; this extends the language
           per CLAUDE.md rather than dropping the state. */
        <p className="border border-dashed border-ink px-3 py-8 text-center text-[11px] font-semibold text-n-3">
          There is nothing to compare yet. Make a list, or save someone else&rsquo;s, and it shows
          up here.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(186px,1fr))] gap-2">
          {lists.map((list) => {
            const on = chosen.includes(list.id)
            return (
              <button
                key={list.id}
                type="button"
                onClick={() => toggle(list.id)}
                aria-pressed={on}
                // Named explicitly for the same reason the rail names its rows:
                // the visible title sits in a nested span beside an aria-hidden
                // cover tile, and leaving the name to be computed from the
                // subtree is one refactor away from announcing nothing.
                aria-label={`${list.title}, ${list.player_count ?? 0} players`}
                className={cn(
                  // Flat at rest, lifts under the cursor. The selected state is
                  // fill + border, never a shadow — a resting condition is not
                  // an interaction (CLAUDE.md → Elevation).
                  'flex items-center gap-2 border p-2 text-left transition-shadow hover:shadow-hard-4',
                  on ? 'border-accent bg-accent-soft' : 'border-ink bg-white',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border-1 border-ink transition-colors',
                    on ? 'bg-accent' : 'bg-white',
                  )}
                >
                  {on && <Icon name="check" size={10} className="text-white" />}
                </span>
                <ListCoverTile list={list} players={list.first_players} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[10.5px] font-bold leading-tight">
                    {list.title}
                  </span>
                  <span className="mt-px block font-mono text-[9px] font-medium leading-tight text-n-3">
                    {list.player_count ?? 0} players
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div>
        {/* Present and washed out at zero, not hidden — the reference renders
            the disabled CTA (the primitive's own `disabled:opacity-40`), so the
            next step is visible before you have taken it. */}
        <Button
          variant="blue"
          shadow
          disabled={chosen.length === 0}
          onClick={() => onShow(chosen)}
        >
          {chosen.length === 0
            ? 'Select at least one list'
            : `Show ${chosen.length} list${chosen.length === 1 ? '' : 's'} side by side`}
        </Button>
      </div>
    </div>
  )
}
