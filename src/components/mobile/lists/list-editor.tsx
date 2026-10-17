'use client'

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import * as React from 'react'

import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MPosChip, posLabel } from '@/components/mobile/ui/m-pos-chip'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { useAiListBuild } from '@/hooks/use-ai-list-build'
import { useList, type ListPlayerWithPlayer, type ListWithDetails } from '@/hooks/use-lists'
import { useMobileListsCommit } from '@/hooks/use-mobile-lists-commit'
import { rankPoolPositions, useMobileListsPosRanks, type PoolPlayer } from '@/hooks/use-mobile-lists-pool'
import { useMobileListsLatestWeek, useMobileListsTimeframeStats } from '@/hooks/use-mobile-lists-timeframe-stats'
import { toast } from '@/hooks/use-toast'
import { hasTiers, isNumbered, withNumbers, withTiers } from '@/lib/lists/ranking-mode'
import { cn } from '@/lib/utils'
import { useListDisplay, useListDisplayStore } from '@/stores/list-display-store'
import { usePlayerModalStore } from '@/stores/player-modal-store'
import { listTitleSchema, type RankingMode } from '@/types/schemas/lists'

import { AddPlayersSheet } from './add-players-sheet'
import { AddStatsSheet } from './add-stats-sheet'
import {
  MAX_TIERS,
  addToDraft,
  arrangeDraft,
  autoTierItems,
  draftChanged,
  draftItems,
  draftOf,
  fillScores,
  moveItem,
  playersLabel,
  removeFromDraft,
  saveFailureNote,
  setDraftMode,
  shortName,
  tierCount,
  tierChipClass,
  tierFillClass,
  type EdItem,
  type ListDraft,
} from './lists-model'
import { useListsNav } from './lists-nav'
import {
  CenterNote,
  GripIcon,
  InlineError,
  LIcon,
  PillButton,
  ScoringControl,
  SwitchTrack,
  TimeFrameControl,
  type LIconName,
} from './lists-parts'
import { useListScoring, useListTimeFrame } from './lists-session-store'
import { resolveMobileStats, seasonLine } from './lists-stats'

/**
 * FieldScout Mobile — the list editor (lr-lists §2.3, states L4–L4g): no dock,
 * a title you edit in place, the Ranked / Tiers switches, stat chips with the
 * time frame and scoring, the tools row, and the rows — players and tier
 * lines, reordered by dragging the whole row.
 *
 * ## A draft, written on Update (Chris, 2026-10-15, gap list #16)
 *
 * Every edit here — the name, Ranked / Tiers, adding and removing players
 * (Add players), dragging, tier lines, merges, Auto tiers — changes a local
 * draft only (`ListDraft`). The header's **Update** writes the whole draft
 * (`useMobileListsCommit`: the app's own routes in a safe order, then a
 * re-read that must match the draft) and returns to the List view with a
 * toast. It is greyed out while nothing has changed and reads "Saving…"
 * while it writes, with every control locked. If a write fails the editor
 * stays open, keeps the draft, and says what saved and what didn't; Update
 * again writes only what is left (and, if it had all landed, confirms it).
 *
 * "What changed" is the draft against the list as editing began (its
 * `base`), never against the list as it stands later: until the first edit
 * the draft follows the list (the editor can open on a cached copy that a
 * refetch then corrects), and after it, Update applies only the user's own
 * changes onto the list as the server then holds it — a player added on
 * desktop meanwhile is kept, not removed (`planSave`).
 *
 * **Back discards the draft** — the on-screen Back and the OS back gesture
 * alike (`useEditorBackGuard` in `mobile-lists.tsx` keeps the editor on
 * screen when the gesture leaves with changes). With changes, it asks first
 * ("Discard changes?" — Chris's default; he may drop the question); with
 * none, it just leaves. A reload or tab close with changes gets the
 * browser's own leave-page prompt.
 *
 * The stat columns, time frame and scoring are display choices for the
 * session (#18, #19), not part of the list, so they change at once.
 *
 * ## Where the app wins over the prototype (each is a lr-lists gap)
 *
 * - **Touch drag works**: a long press (220ms) lifts a row, a 2px blue line
 *   shows where it will land — above the target moving up, below it moving
 *   down — and the edges auto-scroll (gaps 17, 18).
 * - **Ranked and Tiers are independent switches** (Chris, 2026-10-15:
 *   "allow tiers without numbers"): Ranked is the 1-2-3 numbers, Tiers the
 *   Tier 1, Tier 2… lines, and either can be on without the other — Tiers
 *   with Ranked off is `tier_only` (migration 191). Until 191 is pushed the
 *   server answers that save with a 409 ("coming in the next update"), and
 *   Update's failure note says so and keeps the draft. A list holds at most
 *   six tiers (S–F), so Add tier line stops there.
 * - **A tap on a player opens their profile**, with "Remove from list"
 *   (Chris, 2026-10-15): inside the editor it takes him out of the draft —
 *   gone from the list at once, saved by Update, undone by Back — like the
 *   ✓ in Add players. The List view's profile removes at once.
 * - Import a ranking is left out: the app has no rankings to import yet.
 */
export function ListEditor({
  listId,
  autoAdd,
  promptSeq = 0,
  onDirtyChange,
  onLeave,
}: {
  listId: string
  autoAdd: boolean
  /** Bumped when the OS back gesture tried to leave with changes. */
  promptSeq?: number
  /** Whether leaving now would drop changes (or a save in flight). */
  onDirtyChange?: (dirty: boolean) => void
  /** Called just before the editor leaves on its own (Update, Discard). */
  onLeave?: () => void
}) {
  const nav = useListsNav()
  const detail = useList(listId)
  const aiBuild = useAiListBuild(listId)
  const list = detail.data
  const close = () => {
    onLeave?.()
    nav.closeEdit(listId)
  }

  return (
    <div className="fixed inset-0 z-[45] flex flex-col bg-m-b0 pt-[env(safe-area-inset-top)] leading-[normal] text-m-t1 tabular-nums" data-mobile-screen>
      {/* A background refetch that fails keeps the list (and the draft):
          only a list that never loaded is an error screen. */}
      {!list && detail.isError ? (
        <>
          <EditorHeader title={null} onBack={close} />
          <CenterNote
            title="This list could not be loaded."
            body={detail.error.message}
            action={<PillButton onClick={() => void detail.refetch()}>Try again</PillButton>}
          />
        </>
      ) : !list ? (
        <>
          <EditorHeader title={null} onBack={close} />
          <div className="flex flex-col gap-2.5 px-4 pt-2" aria-busy="true" aria-label="Loading list">
            <div className="flex gap-2">
              <div className="h-10 flex-1 animate-pulse rounded-xl bg-m-b1" />
              <div className="h-10 flex-1 animate-pulse rounded-xl bg-m-b1" />
            </div>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-[46px] animate-pulse rounded-[14px] bg-m-b1" />
            ))}
          </div>
        </>
      ) : !list.is_owner || aiBuild.building ? (
        <>
          <EditorHeader title={list.title} onBack={close} />
          <CenterNote
            title={aiBuild.building ? 'The AI is still building this list.' : 'Only the owner can edit this list.'}
            action={<PillButton onClick={close}>Back to the list</PillButton>}
          />
        </>
      ) : (
        <EditorBody
          list={list}
          autoAdd={autoAdd}
          promptSeq={promptSeq}
          onDirtyChange={onDirtyChange}
          onClose={close}
        />
      )}
    </div>
  )
}

/**
 * The header: Back, the title, and Update — blue when the draft has changes,
 * greyed (the design's disabled pill, as the ranking editor's) when it has
 * none, "Saving…" while it writes.
 */
function EditorHeader({
  title,
  onBack,
  onUpdate,
  titleInput,
  canUpdate = false,
  saving = false,
}: {
  title: string | null
  onBack: () => void
  onUpdate?: () => void
  titleInput?: React.ReactNode
  canUpdate?: boolean
  saving?: boolean
}) {
  const live = canUpdate || saving
  return (
    <div className="flex h-[52px] flex-none items-center gap-2 px-3">
      <button
        type="button"
        onClick={onBack}
        disabled={saving}
        aria-label="Back"
        className="flex size-9 flex-none items-center justify-center rounded-full text-m-t1 active:bg-m-b2 disabled:opacity-40"
      >
        <MIcon name="back" size={16} stroke={2} />
      </button>
      {titleInput ?? (
        <span className="min-w-0 flex-1 truncate text-center text-[16px] font-semibold text-m-t1">{title ?? ''}</span>
      )}
      <button
        type="button"
        onClick={onUpdate}
        disabled={!canUpdate || saving}
        aria-busy={saving || undefined}
        className={cn(
          'flex h-8 flex-none items-center whitespace-nowrap rounded-pill px-3.5 text-[13px] font-semibold',
          live ? 'bg-accent text-white active:bg-accent-strong' : 'bg-m-b2 text-m-t3',
          saving && 'opacity-60',
        )}
      >
        {saving ? 'Saving…' : 'Update'}
      </button>
    </div>
  )
}

function EditorBody({
  list,
  autoAdd,
  promptSeq,
  onDirtyChange,
  onClose,
}: {
  list: ListWithDetails
  autoAdd: boolean
  promptSeq: number
  onDirtyChange?: (dirty: boolean) => void
  onClose: () => void
}) {
  const commit = useMobileListsCommit(list.id)
  const display = useListDisplay(list.id)
  const toggleCol = useListDisplayStore((state) => state.toggleCol)
  const [tf, setTf] = useListTimeFrame(list.id)
  const [scoring, setScoring] = useListScoring(list.id)

  // The draft starts as the list loaded and follows it only until the first
  // edit (a refetch of the cached copy the editor opened on). From then on it
  // keeps its base: Update applies the user's changes; Back drops them.
  const [draft, setDraft] = React.useState<ListDraft>(() => draftOf(list))
  const [edited, setEdited] = React.useState(false)
  const [seen, setSeen] = React.useState(list)
  if (list !== seen) {
    setSeen(list)
    if (!edited) setDraft(draftOf(list))
  }
  const [addOpen, setAddOpen] = React.useState(false)
  const [statsOpen, setStatsOpen] = React.useState(false)
  const [confirmLeave, setConfirmLeave] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)

  const saving = commit.isPending
  // Measured against the draft's base, not the live list: a change made
  // elsewhere is not the user's, and a save that landed without its
  // confirmation still leaves "Update again" able to confirm it.
  const dirty = React.useMemo(() => draftChanged(draft), [draft])

  // The design opens Add players on its own after "Next: add players" (and
  // the List view's empty-state "Add players" lands here the same way).
  React.useEffect(() => {
    if (autoAdd && draft.entries.length === 0) setAddOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The screen's back guard (OS back gesture) and the browser (reload, tab
  // close) both need to know when leaving would drop something.
  const unsaved = dirty || saving
  React.useEffect(() => {
    onDirtyChange?.(unsaved)
  }, [unsaved, onDirtyChange])
  React.useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  React.useEffect(() => {
    if (!unsaved) return
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [unsaved])

  // The OS back gesture left with changes and the guard put the editor back:
  // ask, as the on-screen Back does. (Mid-save there is nothing to ask — the
  // save finishes and leaves on its own.)
  const lastPrompt = React.useRef(promptSeq)
  React.useEffect(() => {
    if (promptSeq === lastPrompt.current) return
    lastPrompt.current = promptSeq
    if (saving) return
    setAddOpen(false)
    setStatsOpen(false)
    setConfirmLeave(true)
  }, [promptSeq, saving])

  const mode = draft.mode
  const tiersOn = hasTiers(mode)
  const ranked = isNumbered(mode)

  const items = React.useMemo(() => draftItems(draft), [draft])
  const players = items.filter((item): item is Extract<EdItem, { t: 'p' }> => item.t === 'p')
  const ids = React.useMemo(() => draft.entries.map((entry) => entry.player_id), [draft.entries])
  const inList = React.useMemo(() => new Set(ids), [ids])

  // Pos rk ranks against the Add players pool, in the list's scoring; until
  // it lands the cell is blank, and if it fails the editor says so (never a
  // row of "–").
  const ranksRead = useMobileListsPosRanks(
    rankPoolPositions(
      list.position_filter,
      draft.entries.map((entry) => entry.player.position),
    ),
    true,
    scoring,
  )
  const ranks = ranksRead.data ?? null

  const stats = React.useMemo(() => resolveMobileStats(display.cols), [display.cols])
  // The rows' Pts / Avg are the payload's PPR figures; any other scoring
  // reads the season's weekly rows — the list's own players once, and the
  // players added in Add players in a small read of their own that keeps
  // its last answer while the next loads. So a tap in Add players neither
  // re-reads the whole list nor blanks its rows: only the new player's
  // cells wait.
  const latest = useMobileListsLatestWeek(stats.length > 0 || scoring !== 'ppr')
  const baseIds = React.useMemo(() => draft.base.players.map((entry) => entry.player_id), [draft.base])
  const addedIds = React.useMemo(() => {
    const inBase = new Set(baseIds)
    return ids.filter((id) => !inBase.has(id))
  }, [ids, baseIds])
  const framesBase = useMobileListsTimeframeStats(baseIds, latest.data, scoring !== 'ppr')
  const framesAdded = useMobileListsTimeframeStats(addedIds, latest.data, scoring !== 'ppr', false, { keepPrevious: true })
  const failed = [ranksRead, latest, framesBase, framesAdded].filter((query) => query.isError)
  const lineOf = (entry: ListPlayerWithPlayer) => {
    const id = entry.player_id
    // A player not in a map yet is still loading (blank), never "no games".
    const map = framesBase.data?.has(id) ? framesBase.data : framesAdded.data?.has(id) ? framesAdded.data : undefined
    return seasonLine(entry, map?.get(id), map !== undefined, scoring)
  }

  // ------------------------------------------------------------------ edits --

  const edit = (next: (draft: ListDraft) => ListDraft) => {
    if (saving) return
    setEdited(true)
    setDraft(next)
  }

  // A big board's name and grouping are not the owner's to change (the
  // server refuses both; desktop skips the writes too, `list-detail-panel.tsx`).
  const bigBoard = Boolean(list.is_big_board)
  const setMode = (next: RankingMode) => {
    if (next === mode || bigBoard) return
    edit((current) => setDraftMode(current, next))
  }

  const arrange = (next: EdItem[]) => edit((current) => arrangeDraft(current, next))

  const togglePlayer = (player: PoolPlayer) =>
    edit((current) =>
      current.entries.some((entry) => entry.player_id === player.id)
        ? removeFromDraft(current, player.id)
        : addToDraft(current, player, list.id),
    )

  // A tap on a player opens his full profile (the phone has no mini card)
  // with "Remove from list" acting on this draft.
  const openPlayer = (playerId: string) =>
    usePlayerModalStore.getState().openPlayerView(playerId, null, {
      listId: list.id,
      listTitle: draft.title || list.title,
      removeFromDraft: (id) => edit((current) => removeFromDraft(current, id)),
    })

  // ------------------------------------------------------------- the exits --

  const update = () => {
    if (!dirty || saving) return
    setSaveError(null)
    commit.mutate(draft, {
      onSuccess: (outcome) => {
        if (outcome.ok) {
          toast({ title: 'List updated' })
          onClose()
          return
        }
        const note = saveFailureNote(outcome.error, outcome.attempted, outcome.remaining)
        setSaveError(note)
        toast({ title: 'The list wasn’t fully updated', description: note, variant: 'destructive' })
      },
      onError: (error) => {
        const note = saveFailureNote(error.message, null, null)
        setSaveError(note)
        toast({ title: 'The list wasn’t updated', description: note, variant: 'destructive' })
      },
    })
  }

  const back = () => {
    if (saving) return
    if (dirty) setConfirmLeave(true)
    else onClose()
  }

  // -------------------------------------------------------------- the tools --

  const canAutoTier = players.length >= 3 && fillScores(players.map((p) => p.entry.stats?.projected_pts ?? null)) !== null
  const canAddLine = tierCount(items) < MAX_TIERS && players.length > 0

  const tools: Array<{ label: string; icon: LIconName; onClick: () => void; disabled?: boolean }> = [
    { label: 'Add players', icon: 'plus', onClick: () => setAddOpen(true) },
    ...(tiersOn
      ? [
          {
            label: 'Auto tiers',
            icon: 'autoTiers' as const,
            disabled: !canAutoTier,
            onClick: () => {
              const next = autoTierItems(items)
              // No gap clears the rule: the user's tiers stay as they are and
              // nothing claims success (lr-lists gap 19).
              if (!next) {
                toast({ title: 'No clear tier breaks in this order.' })
                return
              }
              arrange(next)
              toast({ title: 'Auto tiers applied. Drag a tier line to adjust.' })
            },
          },
          {
            label: 'Add tier line',
            icon: 'addTierLine' as const,
            disabled: !canAddLine,
            onClick: () => edit((current) => ({ ...current, pending: current.pending + 1 })),
          },
        ]
      : []),
  ]

  return (
    <>
      <EditorHeader
        title={draft.title}
        onBack={back}
        onUpdate={update}
        canUpdate={dirty}
        saving={saving}
        titleInput={
          <input
            value={draft.title}
            onChange={(event) => {
              const title = event.target.value
              edit((current) => ({ ...current, title }))
            }}
            onBlur={() => {
              // An empty name isn't a name: back to the one editing began with.
              if (!listTitleSchema.safeParse(draft.title).success) edit((current) => ({ ...current, title: current.base.title }))
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            readOnly={bigBoard || saving}
            maxLength={100}
            aria-label="List name"
            className="min-w-0 flex-1 bg-transparent text-center text-[16px] font-semibold text-m-t1 outline-none"
          />
        }
      />

      <div className="flex flex-none flex-col gap-2.5 border-b border-m-b3 px-4 pb-2.5">
        <div className="flex gap-2">
          <ToggleCard
            label="Ranked"
            on={ranked}
            disabled={bigBoard || saving}
            onClick={() => setMode(withNumbers(mode, !ranked))}
          />
          <ToggleCard
            label="Tiers"
            on={tiersOn}
            disabled={bigBoard || saving}
            onClick={() => setMode(withTiers(mode, !tiersOn))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[13px] font-semibold text-m-t1">Stats</span>
            {/* The rows always show points (Pts / Avg), so the scoring is
                always named here. */}
            <ScoringControl value={scoring} onChange={setScoring} disabled={saving} />
            {stats.length > 0 && <TimeFrameControl value={tf} onChange={setTf} latestWeek={latest.data ?? null} />}
          </div>
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
            {stats.map((stat) => (
              <span
                key={stat.id}
                className="flex h-7 flex-none items-center gap-0.5 rounded-pill bg-accent pl-2.5 pr-1 text-[12px] font-semibold text-white"
              >
                {stat.chip}
                <button
                  type="button"
                  onClick={() => toggleCol(list.id, stat.id)}
                  disabled={saving}
                  aria-label={`Remove ${stat.chip}`}
                  // 20px as drawn; the tap area reaches 30px (lr-lists gap 32).
                  className="relative flex size-5 items-center justify-center rounded-full after:absolute after:-inset-[5px] after:content-['']"
                >
                  <MIcon name="close" size={9} stroke={2.6} />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => setStatsOpen(true)}
              disabled={saving}
              className="flex h-7 flex-none items-center gap-1 rounded-pill border-[1.5px] border-m-b4 px-2.5 text-[12px] font-semibold text-m-t1 active:bg-m-b2 disabled:opacity-40"
            >
              <LIcon name="plus" size={10} stroke={2.4} />
              Add stat
            </button>
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
          {tools.map((tool) => (
            <button
              key={tool.label}
              type="button"
              onClick={tool.onClick}
              disabled={tool.disabled || saving}
              className="flex h-[30px] flex-none items-center gap-[5px] whitespace-nowrap rounded-pill bg-m-b2 px-3 text-[12px] font-semibold text-m-t1 active:bg-m-b2h disabled:opacity-40"
            >
              <LIcon name={tool.icon} size={12} stroke={1.9} />
              {tool.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] font-medium text-m-t3">{playersLabel(players.length)} · drag to reorder</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[max(24px,env(safe-area-inset-bottom))] pt-1 scrollbar-none">
        {saveError && !saving && (
          <InlineError className="mx-1 mb-1 mt-1.5" tone="alert" message={saveError} onRetry={update} retryLabel="Update again" />
        )}
        {failed.length > 0 && (
          <InlineError
            className="mx-1 mb-1 mt-1.5"
            message="Some stats could not be loaded."
            onRetry={() => failed.forEach((query) => void query.refetch())}
          />
        )}
        {players.length === 0 ? (
          <CenterNote
            title="No players yet"
            body="Add players to start building this list."
            action={<PillButton onClick={() => setAddOpen(true)}>Add players</PillButton>}
          />
        ) : (
          <>
            {tiersOn && (
              <div className="flex items-center gap-2 px-1 pb-1 pt-2.5">
                <span className={tierChipClass(0)}>Tier 1</span>
                <span className="h-px flex-1 bg-m-b3" />
              </div>
            )}
            <DragRows
              items={items}
              ranked={ranked}
              ranks={ranks}
              locked={saving}
              lineOf={lineOf}
              onMove={(from, to) => arrange(moveItem(items, from, to))}
              onOpen={openPlayer}
              onMerge={(index) => {
                const item = items[index]
                if (item.t !== 'tier') return
                if (item.pending) {
                  edit((current) => ({ ...current, pending: Math.max(0, current.pending - 1) }))
                  return
                }
                arrange(items.filter((_, i) => i !== index))
              }}
            />
          </>
        )}
      </div>

      <AddPlayersSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        positionFilter={list.position_filter}
        inList={inList}
        onToggle={togglePlayer}
      />
      <AddStatsSheet open={statsOpen} onOpenChange={setStatsOpen} listId={list.id} />

      {/* Chris's default for Back with changes (2026-10-15): ask first. */}
      <MobileSheet
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Discard changes?"
        subtitle="Your changes to this list haven’t been saved."
        footer={
          <div className="flex flex-col gap-2 px-4 pb-[max(30px,env(safe-area-inset-bottom))] pt-1">
            <button
              type="button"
              onClick={() => setConfirmLeave(false)}
              className="flex h-12 items-center justify-center rounded-[14px] bg-accent text-[15px] font-semibold text-white active:bg-accent-strong"
            >
              Keep editing
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmLeave(false)
                onClose()
              }}
              className="flex h-12 items-center justify-center rounded-[14px] bg-m-b2 text-[15px] font-semibold text-negative-strong active:bg-m-b2h"
            >
              Discard
            </button>
          </div>
        }
      >
        <span className="sr-only">Leaving now drops the changes you haven’t saved with Update.</span>
      </MobileSheet>
    </>
  )
}

/** Ranked / Tiers card (lr-lists §2.3): the whole card is the switch. */
function ToggleCard({
  label,
  on,
  disabled,
  onClick,
}: {
  label: string
  on: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 flex-1 items-center gap-2 rounded-xl bg-m-b1 pl-3 pr-2.5 text-left active:bg-m-b2h disabled:opacity-40"
    >
      <span className="flex-1 text-[13px] font-semibold text-m-t1">{label}</span>
      <SwitchTrack on={on} />
    </button>
  )
}

// =============================================================================
// Drag rows
// =============================================================================

function DragRows({
  items,
  ranked,
  ranks,
  locked,
  lineOf,
  onMove,
  onMerge,
  onOpen,
}: {
  items: EdItem[]
  ranked: boolean
  ranks: Map<string, number> | null
  /** Update is writing: nothing moves. */
  locked: boolean
  /** The row's season points and games in the list's scoring
   *  (`undefined` while that read loads). */
  lineOf: (entry: ListPlayerWithPlayer) => { pts: number; games: number } | undefined
  onMove: (from: number, to: number) => void
  onMerge: (index: number) => void
  /** A tap on a player row: open his profile. */
  onOpen: (playerId: string) => void
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A long press lifts a row; a quick swipe still scrolls the list.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  )
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [overId, setOverId] = React.useState<string | null>(null)
  const justDragged = React.useRef(false)

  const indexOf = (id: string | null) => (id ? items.findIndex((item) => item.id === id) : -1)
  const from = indexOf(activeId)
  const to = indexOf(overId)

  // Numbers count players only, not tier lines.
  const numbers = new Map<string, number>()
  let n = 0
  let tier = 1
  const tierNumber = new Map<string, number>()
  for (const item of items) {
    if (item.t === 'p') numbers.set(item.id, (n += 1))
    else if (item.t === 'tier') tierNumber.set(item.id, (tier += 1))
  }

  const end = (event: DragEndEvent) => {
    const a = indexOf(String(event.active.id))
    const b = event.over ? indexOf(String(event.over.id)) : -1
    setActiveId(null)
    setOverId(null)
    justDragged.current = true
    window.setTimeout(() => {
      justDragged.current = false
    }, 0)
    if (a >= 0 && b >= 0 && a !== b) onMove(a, b)
  }

  const active = from >= 0 ? items[from] : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event: DragStartEvent) => setActiveId(String(event.active.id))}
      onDragOver={(event: DragOverEvent) => setOverId(event.over ? String(event.over.id) : null)}
      onDragEnd={end}
      onDragCancel={() => {
        setActiveId(null)
        setOverId(null)
      }}
    >
      {items.map((item, index) => (
        <DragItem
          key={item.id}
          item={item}
          locked={locked}
          dragging={item.id === activeId}
          indicator={from >= 0 && to === index && to !== from ? (to > from ? 'below' : 'above') : null}
        >
          {item.t === 'p' ? (
            <PlayerRowBody
              entry={item.entry}
              number={ranked ? (numbers.get(item.id) ?? null) : null}
              posRank={ranks ? (ranks.get(item.entry.player_id) ?? null) : undefined}
              line={lineOf(item.entry)}
              blockClick={justDragged}
              onOpen={onOpen}
            />
          ) : item.t === 'tier' ? (
            <TierLineBody number={tierNumber.get(item.id) ?? 2} disabled={locked} onMerge={() => onMerge(index)} />
          ) : (
            <div className="flex items-center gap-2 px-1 pb-1 pt-3">
              <span className="text-[12px] font-bold text-m-t3">Ungrouped</span>
              <span className="h-px flex-1 bg-m-b3" />
            </div>
          )}
        </DragItem>
      ))}
      <DragOverlay dropAnimation={null}>
        {active ? (
          // A drag ghost floats above the page, so it carries a resting shadow
          // (CLAUDE.md → "Elevation": drag ghosts are true overlays).
          <div className="rounded-[10px] bg-m-b0 shadow-m-menu">
            {active.t === 'p' ? (
              <PlayerRowBody
                entry={active.entry}
                number={ranked ? (numbers.get(active.id) ?? null) : null}
                posRank={ranks ? (ranks.get(active.entry.player_id) ?? null) : undefined}
                line={lineOf(active.entry)}
                blockClick={justDragged}
                onOpen={onOpen}
              />
            ) : active.t === 'tier' ? (
              <TierLineBody number={tierNumber.get(active.id) ?? 2} disabled onMerge={() => undefined} />
            ) : null}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function DragItem({
  item,
  locked,
  dragging,
  indicator,
  children,
}: {
  item: EdItem
  locked: boolean
  dragging: boolean
  indicator: 'above' | 'below' | null
  children: React.ReactNode
}) {
  const drag = useDraggable({ id: item.id, disabled: item.t === 'ungrouped' || locked })
  const drop = useDroppable({ id: item.id })
  const ref = (node: HTMLElement | null) => {
    drag.setNodeRef(node)
    drop.setNodeRef(node)
  }
  return (
    <div
      ref={ref}
      {...(item.t === 'ungrouped' ? {} : drag.listeners)}
      className={cn(
        'relative touch-manipulation select-none rounded-[10px] [-webkit-touch-callout:none]',
        item.t !== 'ungrouped' && 'cursor-grab',
        dragging && 'opacity-40',
      )}
    >
      {children}
      {indicator && (
        <span
          aria-hidden
          className={cn('pointer-events-none absolute inset-x-0 z-[2] h-0.5 rounded-pill bg-accent', indicator === 'above' ? 'top-0' : 'bottom-0')}
        />
      )}
    </div>
  )
}

function PlayerRowBody({
  entry,
  number,
  posRank,
  line,
  blockClick,
  onOpen,
}: {
  entry: ListPlayerWithPlayer
  number: number | null
  /** `undefined` while the pool loads. */
  posRank: number | null | undefined
  /** Season points and games in the list's scoring; `undefined` while that
   *  read loads (blank, never "–"). */
  line: { pts: number; games: number } | undefined
  blockClick: React.MutableRefObject<boolean>
  onOpen: (playerId: string) => void
}) {
  const player = entry.player
  const games = line?.games ?? 0
  const pts = line?.pts ?? 0
  const mini: Array<{ v: string; l: string }> = [
    { v: line === undefined ? '' : games > 0 ? pts.toFixed(1) : '–', l: 'Pts' },
    { v: line === undefined ? '' : games > 0 ? (pts / games).toFixed(1) : '–', l: 'Avg' },
    { v: posRank === undefined ? '' : posRank ? `${posLabel(player.position ?? '')}${posRank}` : '–', l: 'Pos rk' },
  ]
  const sub = [player.team ?? 'FA', player.bye_week ? `Bye ${player.bye_week}` : null].filter(Boolean).join(' · ')
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        if (blockClick.current) return
        onOpen(entry.player_id)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen(entry.player_id)
      }}
      aria-label={`${player.full_name}: tap for player details, long press to drag.`}
      className="flex min-h-[46px] items-center gap-[9px] border-b border-m-b2 bg-m-b0 py-1 pl-1 pr-2"
    >
      {number !== null && <span className="w-[22px] flex-none text-center text-[14px] font-bold tabular-nums">{number}</span>}
      <MHeadshot player={player} size={26} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] font-semibold text-m-t1">{shortName(player.full_name, player.position)}</span>
        <span className="flex min-w-0 items-center gap-[5px] overflow-hidden whitespace-nowrap text-[11px] font-medium text-m-t3">
          <MPosChip pos={player.position ?? ''} className="h-4 min-w-0 flex-none rounded-[4px] px-[5px] text-[9.5px]" />
          {sub}
        </span>
      </span>
      <span className="flex flex-none gap-0.5">
        {mini.map((cell) => (
          <span key={cell.l} className="flex w-9 flex-col items-center gap-px">
            <span className="whitespace-nowrap text-[12px] font-semibold tabular-nums text-m-t1">{cell.v}</span>
            <span className="whitespace-nowrap text-[9px] font-medium text-m-t3">{cell.l}</span>
          </span>
        ))}
      </span>
    </div>
  )
}


function TierLineBody({ number, disabled = false, onMerge }: { number: number; disabled?: boolean; onMerge: () => void }) {
  const index = number - 1
  return (
    <div className="flex items-center gap-2 px-1 pb-1 pt-3">
      <GripIcon className="text-m-t5" />
      <span className={tierChipClass(index)}>Tier {number}</span>
      <span className={cn('h-px flex-1 opacity-35', tierFillClass(index))} />
      <button
        type="button"
        title="Merge tiers"
        aria-label={`Merge Tier ${number} into Tier ${number - 1}`}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onClick={onMerge}
        disabled={disabled}
        // 24px as drawn; the tap area reaches 30px (lr-lists gap 32).
        className="relative flex size-6 items-center justify-center rounded-full text-m-t3 after:absolute after:-inset-[3px] after:content-[''] active:bg-m-b2"
      >
        <MIcon name="close" size={10} stroke={2.4} />
      </button>
    </div>
  )
}
