'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import {
  buildEditorModel,
  keptStarters,
  lineupSaveRequest,
  lockedPlayerIds,
  placementFromStored,
  placementsEqual,
  planMove,
  saveOutcomeCopy,
  slotInstances,
  type MoveContext,
  type MoveTarget,
  type Placement,
  type WeekEditability,
} from '@/components/leagues/lineup-editor-ops'
import { LineupAutosaver, type AutosaveStatus, type QueuedMove } from '@/components/leagues/my-team-ops'
import { useCommishEditLineup } from '@/hooks/use-commish-lineup'
import { useSetLineup, type TeamLineupRow } from '@/hooks/use-lineup'
import { toast } from '@/hooks/use-toast'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { RosterSettings } from '@/lib/leagues/settings/league-settings'
import { useReportOverrideSaving } from '@/stores/commish-override-store'

/**
 * The mobile lineup's moves — the SAME save path as the desktop editor
 * (`lineup-editor.tsx`): each swap is planned by `planMove`, sent WHOLE
 * through `set_lineup` (or `commish_edit_lineup` in the commissioner's
 * override mode) by the `LineupAutosaver` queue, and never shown before the
 * server answers — the rows are the server's arrangement. A refusal is the
 * RPC's own words (a toast, and the banner the screen renders from
 * `refusal`); the lock is the fetched `game_lock`, never a clock.
 */
type Saved = { slot_map: Record<string, string>; action_id: string } & Parameters<typeof saveOutcomeCopy>[0]

export interface LineupMovesInput {
  leagueId: string
  teamId: string
  week: number
  settings: RosterSettings
  roster: readonly RosterPlayer[]
  stored: TeamLineupRow | null
  currentWeek: number | null
  editability: WeekEditability
  canEdit: boolean
  overrideMode: boolean
}

export function useLineupMoves(input: LineupMovesInput) {
  const { leagueId, teamId, week, settings, roster, stored, currentWeek, editability, canEdit, overrideMode } = input
  const slots = useMemo(() => slotInstances(settings), [settings])
  const players = useMemo(() => new Map(roster.map((p) => [p.player_id, p])), [roster])
  const weekIsCurrent = currentWeek !== null && week === currentWeek
  const locked = useMemo(() => lockedPlayerIds(roster, weekIsCurrent), [roster, weekIsCurrent])
  const storedPlacement = useMemo(() => placementFromStored(stored?.slot_map, roster), [stored, roster])
  const kept = useMemo(() => keptStarters(stored?.slot_map, roster), [stored, roster])

  const mutation = useSetLineup(leagueId, teamId)
  const override = useCommishEditLineup(leagueId)

  const [shown, setShown] = useState<Placement>(storedPlacement)
  const [status, setStatus] = useState<AutosaveStatus>('idle')

  const readOnly = !canEdit || (editability.state !== 'open' && !overrideMode)
  const ctx = useMemo<MoveContext>(
    () => ({ slots, players, locked, currentWeek, lockExempt: overrideMode, kept }),
    [slots, players, locked, currentWeek, overrideMode, kept],
  )

  const toasts = useRef(new WeakMap<QueuedMove, string>())
  const live = useRef({ overrideMode, week, ctx, players, slots, mutation, override })
  live.current = { overrideMode, week, ctx, players, slots, mutation, override }

  const saver = useRef<LineupAutosaver<Saved> | null>(null)
  if (saver.current === null) {
    saver.current = new LineupAutosaver<Saved>(storedPlacement, {
      plan: (base, move) => planMove(base, move.playerId, move.target, live.current.ctx),
      send: async (slotMap) => {
        const request = lineupSaveRequest({ overrideMode: live.current.overrideMode, slotMap })
        if (request.verb === 'commish_edit_lineup') {
          return (await live.current.override.submitAsync({ teamId, week: live.current.week, slotMap: request.slotMap })) as unknown as Saved
        }
        return (await live.current.mutation.submitAsync({ week: live.current.week, slotMap: request.slotMap })) as unknown as Saved
      },
      canonical: (result) => placementFromStored(result.slot_map, [...live.current.players.values()]),
      onStatus: (s) => setStatus(s),
      onSaved: (result, move) => {
        setShown(placementFromStored(result.slot_map, [...live.current.players.values()]))
        const name = (id: string) => live.current.players.get(id)?.full_name ?? id
        const label = (key: string) => live.current.slots.find((s) => s.key === key)?.label ?? key
        const outcome = saveOutcomeCopy(result, name, label)
        toast({ title: toasts.current.get(move) ?? 'Lineup saved', description: outcome === 'Lineup saved.' ? undefined : outcome })
      },
      onRefused: (message) => {
        toast({ title: 'That move wasn’t saved', description: message, variant: 'destructive' })
      },
      onPlanRefused: (message) => {
        toast({ title: 'That move can’t be made', description: message, variant: 'destructive' })
      },
    })
  }

  // A refetch of the stored row is the server's word — taken whenever no
  // save is in flight (the desktop editor's rule).
  useEffect(() => {
    const s = saver.current!
    if (s.saving) return
    s.setBase(storedPlacement)
    setShown((cur) => (placementsEqual(cur, s.placement) ? cur : s.placement))
  }, [storedPlacement])

  const saving = status === 'saving'
  useReportOverrideSaving(overrideMode && saving)

  const model = useMemo(() => buildEditorModel(shown, roster, settings), [shown, roster, settings])

  function move(playerId: string, target: MoveTarget, toastTitle: string) {
    if (readOnly) return
    mutation.reset()
    override.reset()
    const queued: QueuedMove = { playerId, target }
    toasts.current.set(queued, toastTitle)
    saver.current!.enqueue(queued)
  }

  const refusal = (mutation.error ?? override.error)?.message ?? null
  const dismissRefusal = () => {
    mutation.reset()
    override.reset()
  }

  return { slots, players, locked, kept, ctx, shown, model, status, saving, readOnly, weekIsCurrent, move, refusal, dismissRefusal }
}
