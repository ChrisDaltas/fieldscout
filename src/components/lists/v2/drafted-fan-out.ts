'use client'

import * as React from 'react'

import { useToast } from '@/hooks/use-toast'

/**
 * Lists v2 — **the drafted fan-out** (LV.14, delivery plan §3 **D12**).
 *
 * ## The rule, and the ruling it reconciles
 *
 * The handoff says a tick marks a player *"in every list containing him"*, its
 * store calls the mutation `toggleDrafted` (global), and
 * `screens/side-by-side-columns.png` shows Malik Nabers struck through in all
 * five columns. Chris ruled the opposite on 2026-08-10: *"marking a player as
 * drafted is per user, per list. it's not some global app wide thing. players
 * will have multiple lists for multiple leagues."* Screenshots outrank the
 * prose; they do not outrank Chris (`docs/design/lists/screens/README.md`).
 *
 * D12 reconciles the two exactly, and it is the whole of this file:
 *
 * > **The comparison set *is* the draft.** A tick writes one
 * > `list_player_drafted` row per list **currently in the comparison** — which
 * > is every column on screen, so the picker's promise holds literally — and
 * > touches **no** list outside it.
 *
 * So the fan-out set is `the columns ∩ the lists containing the player`. It is
 * built from the columns that have **registered themselves**, in the on-screen
 * order the page holds (`ids`), and there is deliberately no other source: this
 * module never queries "which lists contain this player", because a question
 * like that has an answer wider than the comparison and something would
 * eventually use it.
 *
 * ## Storage does not change
 *
 * N writes to LV.1.2's table through LV.1.2's route, keyed
 * `(user_id, list_id, player_id)`. **No new table, no new column, no new
 * route** — the Lists v2 schema budget stays closed at three
 * (`ACTIVE-BUILD.md`). Each column's write is its own `useDraftMode(listId)`
 * mutation, so per-column optimism, per-column rollback and per-column
 * invalidation all come from the hook LV.1.3 already shipped (**D11** —
 * compose, do not re-solve).
 *
 * ## The failure model, stated rather than discovered
 *
 * This build has paid three times for a mechanism that was right in the middle
 * and wrong at an edge (R190, R195, R199/R200), and R190's specific lesson is
 * that **consequences accepted singly still have to be crossed with each
 * other**. So every column state is given an answer up front:
 *
 * | The column | The fan-out | What the user sees |
 * | --- | --- | --- |
 * | rows loaded, contains him (`in`) | writes the desired state | the row strikes through, the header count moves |
 * | rows loaded, does not contain him (`out`) | nothing — D12 consequence 2 | unchanged, correctly |
 * | rows still loading (`loading`) | **skipped, and reported** | one toast naming the column |
 * | rows failed to load (`unreadable`) | skipped, **not** reported | the column's own permanent *"This list could not be loaded"* |
 * | the write failed | that column, and only that column, rolls back | the same one toast, naming it |
 *
 * **Why `unreadable` is silent and `loading` is not.** A column whose rows
 * failed says so on screen for as long as it is there; a toast per tick would
 * add nothing and would fire on every tick for the rest of the session. A
 * column that is merely *loading* resolves in a moment and then renders a row
 * that disagrees with the four beside it, with nothing to say why — that is the
 * "nothing happened means it worked" shape (CLAUDE.md), so it is said out loud.
 *
 * **One report per gesture, not per write.** `use-toast.ts` sets
 * `TOAST_LIMIT = 1`: three failed writes toasting individually would be two
 * *invisible* toasts and one survivor naming a single column. The aggregate
 * names them all, and counts what did land.
 *
 * **The crossing with `hasRead` (R190/R195).** Marking into a column whose
 * *drafted* read failed writes optimistically over an empty cache, exactly as a
 * single tick there already did. It does **not** open that list's landing flag —
 * only the `queryFn` can — so *Clear drafted* on that list stays refused. N
 * optimistic writes cannot forge N landings.
 *
 * ## What this is not
 *
 * Not a cap, not a queue, not a batch endpoint. Q4 is ruled **A** (no cap, no
 * search, no truncation — **D14**), so the fan-out is as wide as the comparison
 * is, and the writes go out together rather than in series because five
 * sequential round trips on draft night is a worse answer than five parallel
 * ones.
 */

/** Whether a column belongs in the fan-out, and why not when it does not. */
export type ColumnMembership =
  /** Its rows are loaded and this player is on them. */
  | 'in'
  /** Its rows are loaded and this player is not on them (D12, consequence 2). */
  | 'out'
  /** Its rows have not arrived, so it cannot answer. Skipped, and reported. */
  | 'loading'
  /** Its rows failed to load. Skipped, and already saying so on screen. */
  | 'unreadable'

/** One registered column, as the fan-out sees it. */
export interface FanOutColumn {
  listId: string
  /** The column header's own name — the report calls columns what the screen does. */
  title: string
  membership: (playerId: string) => ColumnMembership
  /** The state a tap in this column asks for. Read only from the clicked one. */
  desiredFor: (playerId: string) => boolean
  /**
   * Write the desired state to this list. Rejects when the server refused —
   * by which point this column has already rolled itself back
   * (`markMutationOptions`), which is why the fan-out only has to *report*.
   */
  write: (playerId: string, drafted: boolean) => Promise<unknown>
}

/** Everything registered, sorted into what happens to it. All in screen order. */
export interface FanOutPlan {
  /** Lists that get the write. */
  targets: string[]
  /** Lists that could not answer yet. */
  pending: string[]
  /** Lists whose rows failed to load. */
  unreadable: string[]
}

/**
 * `columns ∩ lists containing the player` — D12's fan-out set, plus the two
 * kinds of "cannot say", kept apart because they are told to the user
 * differently.
 *
 * Order is the caller's, which is the on-screen order, so a report reads left
 * to right.
 */
export function planFanOut(columns: readonly FanOutColumn[], playerId: string): FanOutPlan {
  const plan: FanOutPlan = { targets: [], pending: [], unreadable: [] }
  for (const column of columns) {
    switch (column.membership(playerId)) {
      case 'in':
        plan.targets.push(column.listId)
        break
      case 'loading':
        plan.pending.push(column.listId)
        break
      case 'unreadable':
        plan.unreadable.push(column.listId)
        break
      case 'out':
        break
    }
  }
  return plan
}

/** `a`, `a and b`, `a, b and c` — column names in a sentence, not a JSON dump. */
export function joinTitles(titles: readonly string[]): string {
  if (titles.length === 0) return ''
  if (titles.length === 1) return titles[0]
  return `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`
}

export interface FanOutReport {
  title: string
  description: string
  variant: 'destructive'
}

/**
 * What the user is told about one gesture — `null` when everything the fan-out
 * could reach did what it was asked, because a strike-through and a moving
 * count are their own confirmation and a toast per tick on draft night is
 * noise.
 *
 * Takes **titles**, not ids: it is copy, and the point of the whole function is
 * that a partial outcome names which columns it was.
 */
export function fanOutReport(input: {
  playerName: string
  drafted: boolean
  /** Every column that was written to, by title. */
  targets: readonly string[]
  /** Those of them whose write was refused. */
  failed: readonly string[]
  /** Columns skipped because their rows had not arrived. */
  pending: readonly string[]
}): FanOutReport | null {
  const { playerName, drafted, targets, failed, pending } = input
  if (failed.length === 0 && pending.length === 0) return null

  const landed = targets.length - failed.length
  const parts: string[] = []

  if (landed > 0) {
    parts.push(
      `${playerName} was ${drafted ? 'marked' : 'cleared'} in ${landed} of ${targets.length} ` +
        `column${targets.length === 1 ? '' : 's'}.`,
    )
  }
  if (failed.length > 0) {
    parts.push(`${joinTitles(failed)} could not be updated, so nothing changed there.`)
  }
  if (pending.length > 0) {
    parts.push(
      `${joinTitles(pending)} ${pending.length === 1 ? 'has' : 'have'} not loaded yet, so ` +
        `${playerName} was not checked there.`,
    )
  }

  return {
    // "Could not update" only when nothing at all landed — claiming a partial
    // success as a total failure is the same dishonesty in the other direction.
    title: landed === 0 ? `Could not update ${playerName}` : 'Not every column was updated',
    description: parts.join(' '),
    variant: 'destructive',
  }
}

export interface FanOutOutcome {
  /** The state every target was asked for — the clicked column's answer. */
  drafted: boolean
  plan: FanOutPlan
  /** Target list ids whose write was refused. */
  failed: string[]
  report: FanOutReport | null
}

/**
 * One tick, end to end.
 *
 * `Promise.allSettled`, never `Promise.all`: the first rejection must not
 * cancel — or hide — the other four outcomes, and every write's rollback is its
 * own column's business regardless of what its neighbours did.
 *
 * The desired state comes from the **clicked** column and is then written to
 * all of them, which is what converges a comparison whose columns disagree
 * (say, after an earlier partial failure) instead of inverting each of them
 * separately. It rests on LV.1.2's explicit-state wire contract: replaying a
 * write is a no-op, not a flip.
 *
 * Returns `null` when the clicked column is not registered — which should be
 * impossible, since you clicked one of its rows, and is therefore reported as
 * nothing happening rather than guessed at.
 */
export async function runFanOut(input: {
  /** Every registered column, in on-screen order. */
  columns: readonly FanOutColumn[]
  clickedListId: string
  playerId: string
  playerName: string
}): Promise<FanOutOutcome | null> {
  const { columns, clickedListId, playerId, playerName } = input

  const clicked = columns.find((column) => column.listId === clickedListId)
  if (!clicked) return null

  const drafted = clicked.desiredFor(playerId)
  const plan = planFanOut(columns, playerId)

  const targets = columns.filter((column) => plan.targets.includes(column.listId))
  const results = await Promise.allSettled(
    targets.map((column) => column.write(playerId, drafted)),
  )
  const failed = targets.filter((_column, index) => results[index].status === 'rejected')
  const pending = columns.filter((column) => plan.pending.includes(column.listId))

  return {
    drafted,
    plan,
    failed: failed.map((column) => column.listId),
    report: fanOutReport({
      playerName,
      drafted,
      targets: targets.map((column) => column.title),
      failed: failed.map((column) => column.title),
      pending: pending.map((column) => column.title),
    }),
  }
}

/** What a column registers: everything in `FanOutColumn` except its own id. */
export type FanOutColumnState = Omit<FanOutColumn, 'listId'>

export interface DraftedFanOut {
  /** A column joins the comparison; the returned function takes it back out. */
  register: (listId: string, read: () => FanOutColumnState) => () => void
  /** A tick landed on `playerId` in `listId`. Fans out per D12. */
  tick: (listId: string, playerId: string, playerName: string) => void
}

/**
 * The comparison's fan-out, held by the surface that owns the column order.
 *
 * Columns register rather than being read from above because each one already
 * owns the two things the fan-out needs — its rows (`useList`) and its marks
 * (`useDraftMode`) — and lifting either would mean a second copy of state that
 * could disagree with what is on screen. Registration is a `useRef` map, not
 * state: nothing renders off it, and re-rendering the whole strip because a
 * column joined would be a lie about what changed.
 */
export function useDraftedFanOut(ids: readonly string[]): DraftedFanOut {
  const { toast } = useToast()
  const columnsRef = React.useRef(new Map<string, () => FanOutColumnState>())
  const idsRef = React.useRef(ids)

  // The on-screen order, as of the last commit. A tick is an event, so it wants
  // what was actually rendered — not what a render in progress might become.
  React.useEffect(() => {
    idsRef.current = ids
  }, [ids])

  const register = React.useCallback((listId: string, read: () => FanOutColumnState) => {
    columnsRef.current.set(listId, read)
    return () => {
      // Only if it is still ours: React can mount the replacement before it
      // unmounts the original, and a blind delete would drop the live one.
      if (columnsRef.current.get(listId) === read) columnsRef.current.delete(listId)
    }
  }, [])

  const tick = React.useCallback(
    (listId: string, playerId: string, playerName: string) => {
      // Walk `ids`, not the Map: insertion order is mount order, and the report
      // should name columns in the order they sit on the page.
      const columns = idsRef.current.flatMap((id) => {
        const read = columnsRef.current.get(id)
        return read ? [{ listId: id, ...read() }] : []
      })

      void runFanOut({ columns, clickedListId: listId, playerId, playerName }).then((outcome) => {
        if (outcome?.report) toast(outcome.report)
      })
    },
    [toast],
  )

  return React.useMemo(() => ({ register, tick }), [register, tick])
}

/**
 * Join the fan-out for as long as this column is on screen.
 *
 * The registered value is a **getter over a ref**, not the state object itself,
 * so a column that re-renders (new rows, a mark landing, a grouping change) does
 * not have to re-register — and a tick always reads what was last *committed*
 * rather than a closure from whenever registration happened. The ref is written
 * in an effect for that reason: a render React throws away must not become the
 * answer a click gets.
 */
export function useRegisterFanOutColumn(
  fanOut: DraftedFanOut,
  listId: string,
  state: FanOutColumnState,
): void {
  const latest = React.useRef(state)

  React.useEffect(() => {
    latest.current = state
  })

  const read = React.useCallback(() => latest.current, [])

  React.useEffect(() => fanOut.register(listId, read), [fanOut, listId, read])
}
