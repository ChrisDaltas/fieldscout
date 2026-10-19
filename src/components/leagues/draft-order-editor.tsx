'use client'

import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMemo } from 'react'

import { GripIcon } from '@/components/mobile/lists/lists-parts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { useCreateDraft, useDraft, useDraftOrder } from '@/hooks/use-draft'
import { toast } from '@/hooks/use-toast'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import type { LeagueDetail } from '@/hooks/use-league'
import type { LeagueSettings } from '@/lib/leagues/settings/league-settings'
import { cn } from '@/lib/utils'

import { reorderIds } from '@/components/draft/my-queue-ops'
import { parseDraftOrder } from '@/components/draft/draft-board-ops'

import { reconcileDraftOrder } from './draft-order-editor-ops'
import { useSettingsSkin } from './settings-form-controls'

/** The phone skin's parts (`SettingsSkin` mobile): the G-page note, a quiet
 *  pill, and one order row on the page's b2 hairlines. */
const M_NOTE = 'text-[12px] font-medium leading-[1.35] text-m-t3'
const M_PILL = 'flex h-8 w-fit flex-none items-center gap-1.5 rounded-pill bg-m-b2 px-3.5 text-[13px] font-semibold text-m-t1 active:bg-m-b2h disabled:opacity-50'
const M_ORDER_ROW = 'flex min-h-[44px] items-center gap-3 border-b border-m-b2 bg-m-b0 text-[14px] font-semibold text-m-t1 last:border-b-0'

interface DraftOrderEditorProps {
  leagueId: string
  detail: LeagueDetail
  mode: LeagueSettings['draft']['draft_order_mode']
  /** The settings store — `draft.draft_order`, or (098/AP.5, §16.2's "ONE
   *  editor, two consumers") `draft.nomination_order`, whose mount pins
   *  `mode="manual"`: the randomize arm below PATCHes the DRAFT order and
   *  must never be reachable from the nomination mount. */
  value: string[] | null
  onChange: (next: string[]) => void
  canEdit: boolean
}

/**
 * Order-method surface for the Draft-setup section (M2 task L.B3.4 item 3;
 * spec §8.3, §16.2 draft-setup-panel "order method (random/manual/reveal)").
 *
 * - `manual` / `custom`: drag the franchise order (dnd-kit sortable — the
 *   my-queue pattern) writing `settings.draft.draft_order` through the
 *   panel's ordinary atomic PATCH (D95's single pre-start store;
 *   `draft_start` re-validates the permutation server-side).
 * - `random`: an instant "Randomize now" action (D101 — result-before-
 *   start, NO reveal animation, F43): ensures the drafts row exists (the
 *   idempotent POST) then PATCHes `randomize: true`; `draft_set_order` (069)
 *   writes + system-posts. The stored result renders as a plain list; when
 *   nothing is stored yet, 066 shuffles at start — also stated plainly.
 */
export function DraftOrderEditor({
  leagueId,
  detail,
  mode,
  value,
  onChange,
  canEdit,
}: DraftOrderEditorProps) {
  const activeTeams = useMemo(
    () => detail.teams.filter((t) => t.status !== 'retired'),
    [detail.teams],
  )
  const teamNameById = useMemo(
    () => new Map(activeTeams.map((t) => [t.id, t.name])),
    [activeTeams],
  )

  if (mode === 'random') {
    return (
      <RandomizeRow
        leagueId={leagueId}
        detail={detail}
        teamNameById={teamNameById}
        canEdit={canEdit}
      />
    )
  }

  const ids = reconcileDraftOrder(value, activeTeams.map((t) => t.id))
  // Nothing (or a stale array) stored yet: `draft_start` refuses manual/
  // custom without a stored permutation, so the displayed list must be
  // adoptable EXPLICITLY, not only by dragging.
  const stored = JSON.stringify(value ?? null) === JSON.stringify(ids)

  return (
    <ManualOrderList
      ids={ids}
      stored={stored}
      teamNameById={teamNameById}
      onChange={onChange}
      canEdit={canEdit}
    />
  )
}

// ---------------------------------------------------------------------------
// manual / custom — drag the franchise order (writes the settings store)
// ---------------------------------------------------------------------------

function ManualOrderList({
  ids,
  stored,
  teamNameById,
  onChange,
  canEdit,
}: {
  ids: string[]
  stored: boolean
  teamNameById: ReadonlyMap<string, string>
  onChange: (next: string[]) => void
  canEdit: boolean
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    onChange(reorderIds(ids, String(active.id), String(over.id)))
  }

  const phone = useSettingsSkin() === 'mobile'

  if (ids.length === 0) {
    return (
      <p className={phone ? cn(M_NOTE, 'py-2.5') : 'pb-2.5 text-[11px] font-medium text-n-6'}>
        No franchises yet — seats appear here as the league fills.
      </p>
    )
  }

  if (phone) {
    return (
      <div className="flex flex-col gap-2 py-2.5" data-draft-order="manual">
        <p className={M_NOTE}>Drag to set pick 1 → {ids.length}. Saved with your other changes.</p>
        {canEdit && !stored && (
          <div className="flex flex-col gap-1.5">
            <button type="button" className={M_PILL} onClick={() => onChange(ids)}>
              Use this order
            </button>
            <p className={M_NOTE}>This order isn&apos;t stored yet — use it (or drag), then save.</p>
          </div>
        )}
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ol className="flex flex-col">
              {ids.map((teamId, i) => (
                <OrderRow key={teamId} teamId={teamId} ordinal={i + 1} name={teamNameById.get(teamId) ?? 'Team'} disabled={!canEdit} phone />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 pb-3">
      <p className="text-[10px] font-medium text-n-6">
        Drag to set pick 1 → {ids.length}. Saved with the settings above.
      </p>
      {canEdit && !stored && (
        <div className="flex items-center gap-2">
          <Button type="button" variant="stroke" size="sm" onClick={() => onChange(ids)}>
            <Icon name="check" size={13} />
            Use this order
          </Button>
          <p className="text-[10px] font-medium text-n-6">
            This order isn&apos;t stored yet — adopt it (or drag), then save.
          </p>
        </div>
      )}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col gap-[3px]">
            {ids.map((teamId, i) => (
              <OrderRow
                key={teamId}
                teamId={teamId}
                ordinal={i + 1}
                name={teamNameById.get(teamId) ?? 'Team'}
                disabled={!canEdit}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  )
}

function OrderRow({
  teamId,
  ordinal,
  name,
  disabled,
  phone = false,
}: {
  teamId: string
  ordinal: number
  name: string
  disabled: boolean
  /** The phone skin's row (the caller reads the skin once for the list). */
  phone?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: teamId,
    disabled,
  })

  if (phone) {
    return (
      <li
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={cn(
          M_ORDER_ROW,
          !disabled && 'touch-none',
          // Drag ghost = a true overlay while held — the one sanctioned
          // resting shadow (CLAUDE.md elevation rule, the my-queue precedent).
          isDragging && 'relative z-10 rounded-[10px] shadow-m-menu',
        )}
        {...attributes}
        {...listeners}
      >
        <span className="w-6 flex-none text-right text-[13px] font-semibold tabular-nums text-m-t3">{ordinal}</span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {!disabled && <GripIcon className="text-m-t5" />}
      </li>
    )
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex min-h-[34px] items-center gap-2 rounded-lg bg-surface-sunken px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
        !disabled && 'cursor-grab touch-none hover:bg-surface-hover',
        // Drag ghost = a true overlay while held — the one sanctioned
        // resting shadow (CLAUDE.md elevation rule, the my-queue precedent).
        isDragging && 'relative z-10 bg-white shadow-hard-6',
      )}
      {...attributes}
      {...listeners}
    >
      <span className="fs-num w-6 shrink-0 text-right text-[10px] font-bold text-n-6">{ordinal}</span>
      <span className="truncate">{name}</span>
      {!disabled && <Icon name="sort" size={13} className="ml-auto shrink-0 text-n-7" />}
    </li>
  )
}

// ---------------------------------------------------------------------------
// random — the D101 instant randomize + the stored result
// ---------------------------------------------------------------------------

function RandomizeRow({
  leagueId,
  detail,
  teamNameById,
  canEdit,
}: {
  leagueId: string
  detail: LeagueDetail
  teamNameById: ReadonlyMap<string, string>
  canEdit: boolean
}) {
  const activeDraft = detail.active_draft
  // The stored randomize result lives on the DRAFTS row (D101 wrote it via
  // draft_set_order) — read it when a scheduled row exists.
  const draftRow = useDraft(activeDraft?.status === 'scheduled' ? activeDraft.id : undefined)
  const storedOrder = parseDraftOrder(draftRow.data?.draft?.draft_order)

  const createDraft = useCreateDraft(leagueId)
  const patchOrder = useDraftOrder(leagueId)
  const busy = createDraft.isPending || patchOrder.isPending

  // Post-start the order is the commissioner panel's E31 dispatch — the
  // setup surface only acts pre-start.
  const postStart = activeDraft != null && activeDraft.status !== 'scheduled'
  const phone = useSettingsSkin() === 'mobile'

  const handleRandomize = async () => {
    try {
      if (!activeDraft) {
        // The PATCH needs a drafts row; the POST is idempotent (D95).
        await createDraft.mutateAsync()
      }
      await patchOrder.mutateAsync({ randomize: true })
      toast({ title: 'Draft order randomized', description: 'The order is locked in below.' })
    } catch (error) {
      toast({
        title: "Couldn't randomize the order",
        description:
          error instanceof LeagueActionError
            ? error.message
            : 'Something went wrong. Please try again.',
        variant: 'destructive',
      })
    }
  }

  if (phone) {
    return (
      <div className="flex flex-col gap-2 py-2.5" data-draft-order="random">
        {canEdit && !postStart && (
          <div className="flex flex-col gap-1.5">
            <button type="button" className={M_PILL} disabled={busy} onClick={() => void handleRandomize()}>
              {busy ? 'Randomizing…' : storedOrder.length > 0 ? 'Re-randomize' : 'Randomize now'}
            </button>
            <p className={M_NOTE}>Instant — the result is written immediately and shown to the league.</p>
          </div>
        )}
        {storedOrder.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="flex h-5 w-fit items-center rounded-pill bg-m-gg px-2 text-[11px] font-semibold text-m-tg">Order locked in</span>
            <ol className="flex flex-col">
              {storedOrder.map((teamId, i) => (
                <li key={teamId} className={M_ORDER_ROW}>
                  <span className="w-6 flex-none text-right text-[13px] font-semibold tabular-nums text-m-t3">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{teamNameById.get(teamId) ?? 'Team'}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <p className={M_NOTE}>
            No order stored yet — it randomizes automatically when the draft starts
            {canEdit && !postStart ? ', or randomize it now' : ''}.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 pb-3">
      {canEdit && !postStart && (
        <div className="flex flex-wrap items-center gap-2.5">
          <Button type="button" variant="stroke" size="sm" disabled={busy} onClick={() => void handleRandomize()}>
            <Icon name="repeat" size={13} className={busy ? 'animate-spin' : undefined} />
            {busy ? 'Randomizing…' : storedOrder.length > 0 ? 'Re-randomize' : 'Randomize now'}
          </Button>
          <p className="text-[10px] font-medium text-n-6">
            Instant — the result is written immediately and shown to the league.
          </p>
        </div>
      )}

      {storedOrder.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Badge variant="green" className="w-fit">
            Order locked in
          </Badge>
          <ol className="flex flex-col gap-[3px]">
            {storedOrder.map((teamId, i) => (
              <li
                key={teamId}
                className="flex min-h-[34px] items-center gap-2 rounded-lg bg-surface-sunken px-2.5 py-1.5 text-[11px] font-semibold"
              >
                <span className="fs-num w-6 shrink-0 text-right text-[10px] font-bold text-n-6">{i + 1}</span>
                <span className="truncate">{teamNameById.get(teamId) ?? 'Team'}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="text-[11px] font-medium text-n-6">
          No order stored yet — it randomizes automatically when the draft starts
          {canEdit && !postStart ? ', or randomize it now' : ''}.
        </p>
      )}
    </div>
  )
}
