'use client'

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { leagueCardContext, type PlayerCardContext } from '@/components/players/player-card-context'
import { PlayerFace, PlayerLink } from '@/components/players/player-link'
import { PositionBadge } from '@/components/players/position-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { useCommishEditLineup } from '@/hooks/use-commish-lineup'
import { useSetLineup, type TeamLineupRow } from '@/hooks/use-lineup'
import { usePlayersByIds } from '@/hooks/use-players-by-ids'
import { toast } from '@/hooks/use-toast'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import type { RosterSettings } from '@/lib/leagues/settings/league-settings'
import { useReportOverrideSaving } from '@/stores/commish-override-store'
import { cn } from '@/lib/utils'

import {
  buildEditorModel,
  formatKickoff,
  irStintChip,
  KEPT_STARTER_COPY,
  KEPT_STARTER_OTHER_WEEK_COPY,
  keptStarters,
  lineupSaveRequest,
  lockBadgeFor,
  lockedPlayerIds,
  placementFromStored,
  placementsEqual,
  planMove,
  saveOutcomeCopy,
  slotInstances,
  starterFlagChips,
  starterHint,
  startersByKey,
  type HintTone,
  type MoveTarget,
  type Placement,
  type SlotRow,
  type WeekEditability,
} from './lineup-editor-ops'
import {
  formatAdp,
  formatPoints,
  formatSnap,
  LineupAutosaver,
  weekTabsLockedReason,
  lineupChecks,
  moveOptions,
  moveToastCopy,
  opponentOf,
  oprkOf,
  oprkRankedCount,
  oprkTone,
  pointsCell,
  projectedTotal,
  readColumns,
  STAT_COLUMNS,
  statusTag,
  toggleColumn,
  writeColumns,
  type AutosaveStatus,
  type LineupCheck,
  type ProjectedTotal,
  type StatColumnId,
  type WeekGame,
} from './my-team-ops'
import { LOCKED_DROP_TITLE } from './players-page-ops'

/**
 * LineupEditor — the team page's lineup (§16.2 `lineup-editor`; §11.2;
 * §16.5.2 Weekly loop), rebuilt to the prototype's `MyTeam.jsx` in League UX
 * batch 3 (Chris 2026-10-03; PROGRESS D478): the Lineup check, the starters
 * table with Customize-able stat columns and a projected total, the sticky
 * bench + Reserve card, and Move menus.
 *
 * **Every move saves itself — no Save button** (Chris: "When I set my
 * lineup, I still have to hit a Save button"). The decisions live in
 * `my-team-ops.ts` (`LineupAutosaver`): a completed drag or menu move is
 * sent WHOLE (IR keys included — F224(e)) through `set_lineup`, or through
 * `commish_edit_lineup` in override mode. It is NEVER optimistic: the rows
 * on screen are the server's arrangement; the indicator says "Saving…"
 * until the server answers, then the canonical map renders (E16 may
 * re-seat). A refusal shows the RPC's own words, drops any queued moves and
 * leaves the server's arrangement on screen — both mutation hooks re-read
 * the roster and the row on error (R822(i)). One save at a time; a move
 * made meanwhile waits its turn and is planned against the newer answer.
 *
 * **The 🔒 is the fetched evaluation** (`game_lock`, D315(5)). A locked row
 * is not draggable, its Move menu offers nothing but the reason, and a seat
 * held by a locked player refuses drops — prevented, not refused; the
 * server is still the decider when the two disagree. Override mode lifts
 * the client's wall the same way the audited verb lifts the server's.
 *
 * **Read-only** for anyone who cannot edit this team: no Move, no drag.
 *
 * Elevation: nothing rests elevated (CLAUDE.md). The drag ghost and the
 * menus are true overlays.
 */

/** What the stat columns read — every value a server read, "—" when absent. */
export interface LineupStats {
  games: readonly WeekGame[]
  splits: ReadonlyArray<{ defense: string; position: string; rank: number }>
  proj: (playerId: string) => number | null
  points: (playerId: string) => { phase: string; points: number; pending: readonly string[] } | null
  snap: (playerId: string) => number | null
}

/** The week's opponent, for the strip and the Proj check. */
export interface LineupOpponent {
  kind: 'opponent'
  /** "You" on your own team; the team's name when viewing another. */
  selfName: string
  name: string
  href: string
  myScore: number | null
  oppScore: number | null
  oppProjected: ProjectedTotal | null
}

export interface LineupEditorProps {
  leagueId: string
  teamId: string
  week: number
  settings: RosterSettings
  allowIllegal: boolean
  roster: readonly RosterPlayer[]
  /** The stored row for the week, or null (nothing set yet — D293/D313). */
  stored: TeamLineupRow | null
  currentWeek: number | null
  editability: WeekEditability
  /** The viewer may change this lineup: its own manager, or a commissioner
   *  IN override mode. Everyone else reads it. */
  canEdit: boolean
  /** The viewer holds the commissioner role — the refusal's way into
   *  override mode (PROGRESS §3(a)). */
  isCommish: boolean
  leagueTimeZone: string | null
  overrideMode: boolean
  onOverrideMode: (next: boolean) => void
  /** The Move menu's Drop — the viewer's OWN team only. */
  onDrop?: (player: RosterPlayer) => void
  dropClosedReason?: string | null
  /** Omitted = every stat cell reads "—" (nothing fetched). */
  stats?: LineupStats
  /** The week tabs, rendered in the starters card's header. */
  weekTabs?: ReactNode
  /** The week's opponent, `bye`, or null (no pairing on record). */
  opponent?: LineupOpponent | { kind: 'bye' } | null
}

export const EMPTY_STATS: LineupStats = { games: [], splits: [], proj: () => null, points: () => null, snap: () => null }

type Notice = { tone: HintTone | 'positive'; text: string }
type Saved = { slot_map: Record<string, string>; action_id: string } & Parameters<typeof saveOutcomeCopy>[0]

export function LineupEditor({
  leagueId,
  teamId,
  week,
  settings,
  allowIllegal,
  roster,
  stored,
  currentWeek,
  editability,
  canEdit,
  isCommish,
  leagueTimeZone,
  overrideMode,
  onOverrideMode,
  onDrop,
  dropClosedReason = null,
  stats = EMPTY_STATS,
  weekTabs,
  opponent = null,
}: LineupEditorProps) {
  const context = leagueCardContext(leagueId)
  const slots = useMemo(() => slotInstances(settings), [settings])
  const players = useMemo(() => new Map(roster.map((p) => [p.player_id, p])), [roster])
  const weekIsCurrent = currentWeek !== null && week === currentWeek
  const locked = useMemo(() => lockedPlayerIds(roster, weekIsCurrent), [roster, weekIsCurrent])
  const storedPlacement = useMemo(() => placementFromStored(stored?.slot_map, roster), [stored, roster])
  const storedStarters = useMemo(() => startersByKey(stored?.starters), [stored])
  const kept = useMemo(() => keptStarters(stored?.slot_map, roster), [stored, roster])
  const keptIds = useMemo(() => [...kept.values()], [kept])
  const keptIdentity = usePlayersByIds(keptIds)
  const rosterIds = useMemo(() => roster.map((p) => p.player_id), [roster])
  const identity = usePlayersByIds(rosterIds)

  const mutation = useSetLineup(leagueId, teamId)
  const override = useCommishEditLineup(leagueId)

  // THE SERVER'S ARRANGEMENT — what renders. Only a server answer (a save's
  // canonical map, or a refetch of the row) changes it.
  const [shown, setShown] = useState<Placement>(storedPlacement)
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [queued, setQueued] = useState(0)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [columns, setColumns] = useState<StatColumnId[]>(() => readColumns(typeof window === 'undefined' ? null : safeStorage()))

  const readOnly = !canEdit || (editability.state !== 'open' && !overrideMode)
  const lockExempt = overrideMode
  const moveCtx = useMemo(() => ({ slots, players, locked, currentWeek, lockExempt, kept }), [slots, players, locked, currentWeek, lockExempt, kept])

  // Live values the queue reads at send time (the mode can change between moves).
  const live = useRef({ overrideMode, week, moveCtx, players, slots, mutation, override })
  live.current = { overrideMode, week, moveCtx, players, slots, mutation, override }

  const saver = useRef<LineupAutosaver<Saved> | null>(null)
  if (saver.current === null) {
    saver.current = new LineupAutosaver<Saved>(storedPlacement, {
      plan: (base, move) => planMove(base, move.playerId, move.target, live.current.moveCtx),
      send: async (slotMap) => {
        const request = lineupSaveRequest({ overrideMode: live.current.overrideMode, slotMap })
        if (request.verb === 'commish_edit_lineup') {
          return (await live.current.override.submitAsync({ teamId, week: live.current.week, slotMap: request.slotMap })) as unknown as Saved
        }
        return (await live.current.mutation.submitAsync({ week: live.current.week, slotMap: request.slotMap })) as unknown as Saved
      },
      canonical: (result) => placementFromStored(result.slot_map, [...live.current.players.values()]),
      onStatus: (s, q) => {
        setStatus(s)
        setQueued(q)
      },
      onSaved: (result, move, plan) => {
        setShown(placementFromStored(result.slot_map, [...live.current.players.values()]))
        const name = (id: string) => live.current.players.get(id)?.full_name ?? id
        const label = (key: string) => live.current.slots.find((s) => s.key === key)?.label ?? key
        const title = moveToastCopy({
          player: name(move.playerId),
          target: move.target,
          targetLabel: move.target.kind === 'slot' ? label(move.target.key) : null,
          displaced: plan.displaced ? name(plan.displaced) : null,
        })
        const outcome = saveOutcomeCopy(result, name, label)
        toast({ title, description: outcome === 'Lineup saved.' ? undefined : outcome })
      },
      // The refusal itself is the mutation's own `error` (rendered below,
      // verbatim — F224(e)); the toast says it too.
      onRefused: (message) => {
        toast({ title: 'That move wasn’t saved', description: message, variant: 'destructive' })
      },
      onPlanRefused: (message) => setNotice({ tone: 'negative', text: message }),
    })
  }

  // A refetch of the stored row (after a save, the tick's re-stamp, another
  // tab) is the server's word — taken whenever no save is in flight.
  useEffect(() => {
    const s = saver.current!
    if (s.saving) return
    s.setBase(storedPlacement)
    setShown((cur) => (placementsEqual(cur, s.placement) ? cur : s.placement))
  }, [storedPlacement])

  const saving = status === 'saving'
  useReportOverrideSaving(overrideMode && saving) // R1460: locks the header's Turn off
  /** R1467: the week tabs wait for a save to land. */
  const weekLockedReason = weekTabsLockedReason(saving)

  function move(playerId: string, target: MoveTarget) {
    if (readOnly) return
    setNotice(null)
    mutation.reset()
    override.reset()
    saver.current!.enqueue({ playerId, target })
  }

  const model = useMemo(() => buildEditorModel(shown, roster, settings), [shown, roster, settings])
  const mine = useMemo(() => projectedTotal(model.starters.map((r) => r.player?.player_id ?? null), stats.proj), [model.starters, stats.proj])
  const checks = useMemo(
    () =>
      lineupChecks({
        starters: model.starters,
        week,
        games: stats.games,
        mine,
        opponent: opponent?.kind === 'opponent' && opponent.oppProjected ? { name: opponent.name, projected: opponent.oppProjected } : null,
      }),
    [model.starters, week, stats.games, mine, opponent],
  )

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  )
  function onDragStart(e: DragStartEvent) {
    setDragging(String(e.active.id))
  }
  function onDragEnd(e: DragEndEvent) {
    const playerId = String(e.active.id)
    setDragging(null)
    const over = e.over ? String(e.over.id) : null
    if (!over) return
    if (over === 'bench') move(playerId, { kind: 'bench' })
    else if (over.startsWith('slot:')) move(playerId, { kind: 'slot', key: over.slice(5) })
  }

  function onToggleColumn(id: StatColumnId) {
    setColumns((cur) => {
      const next = toggleColumn(cur, id)
      writeColumns(safeStorage(), next)
      return next
    })
  }

  const labelOf = (key: string) => slots.find((s) => s.key === key)?.label ?? key
  const draggingPlayer = dragging ? players.get(dragging) ?? null : null
  const rowCtx: RowContext = {
    context,
    readOnly,
    lockExempt,
    locked,
    weekIsCurrent,
    currentWeek,
    leagueTimeZone,
    week,
    allowIllegal,
    columns,
    stats,
    headshot: (id) => identity.playerById.get(id)?.headshot_url ?? null,
    adp: (id) => identity.playerById.get(id)?.adp ?? null,
    options: (player) => moveOptions({ player, placement: shown, slots, players, locked, lockExempt }),
    onMove: move,
    onDrop,
    dropClosedReason,
  }
  const canOfferOverride = isCommish && !overrideMode
  // The server's refusal, VERBATIM (F224(e)) — the mutation's own error.
  const refusal = (mutation.error ?? override.error)?.message ?? null
  const dismissRefusal = () => {
    mutation.reset()
    override.reset()
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      {/* Override mode frames the editor (fill + border — a resting
          condition, never a shadow). */}
      <div
        className={cn('flex flex-col gap-4', overrideMode && 'rounded-sm border-2 border-brand-strong bg-brand-soft p-2 sm:p-3')}
        data-lineup-editor={teamId}
        data-override-mode={overrideMode ? 'on' : 'off'}
      >
        {opponent && <MatchupStrip week={week} opponent={opponent} mine={mine} />}
        <LineupCheckCard checks={checks} />

        {editability.state === 'closed' && !overrideMode && (
          <p role="status" className="rounded-sm border border-ink bg-n-4 px-3 py-2 text-[12px] font-semibold text-ink">
            {editability.reason}
          </p>
        )}
        {editability.state === 'unknown' && (
          <p role="status" className="rounded-sm border border-ink bg-caution-soft px-3 py-2 text-[12px] font-semibold text-ink">
            This league has no schedule yet — lineups can be set once the season’s weeks are on the calendar.
          </p>
        )}
        {!canEdit && editability.state === 'open' && (
          <p role="status" className="rounded-sm border border-ink bg-white px-3 py-2 text-[12px] font-semibold text-n-3" data-read-only>
            {isCommish
              ? 'Viewing — turn on override mode to change this team’s lineup.'
              : 'Viewing — only this team’s manager can set its lineup.'}
          </p>
        )}
        {model.orphaned.length > 0 && (
          <p role="alert" className="rounded-sm border border-negative bg-negative-soft px-3 py-2 text-[12px] font-semibold text-ink">
            {model.orphaned.length} stored {model.orphaned.length === 1 ? 'placement names a player' : 'placements name players'} no longer on this roster
            ({model.orphaned.map((o) => `${labelOf(o.key)}: ${o.player_id}`).join(', ')}) — the seat reads empty here; the next move clears it.
          </p>
        )}
        {refusal && (
          <div role="alert" className="flex flex-col gap-2 rounded-sm border border-negative bg-negative-soft px-3 py-2 text-[12px] font-semibold text-ink" data-lineup-refusal>
            <span>{refusal}</span>
            <span className="text-[11px] font-medium">Nothing changed — the lineup shown is the one that’s saved.</span>
            <div className="flex flex-wrap gap-2">
              {canOfferOverride && (
                <Button
                  variant="blue"
                  size="sm"
                  onClick={() => {
                    dismissRefusal()
                    onOverrideMode(true)
                  }}
                  data-offer-override
                >
                  Turn on override mode
                </Button>
              )}
              <Button variant="stroke" size="sm" onClick={dismissRefusal}>
                Dismiss
              </Button>
            </div>
          </div>
        )}
        {!refusal && notice && <NoticeLine tone={notice.tone} text={notice.text} />}

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.7fr_1fr]">
          <Card className="min-w-0">
            <CardHeader className="flex-wrap gap-2">
              <fieldset
                disabled={weekLockedReason !== null}
                title={weekLockedReason ?? undefined}
                className="flex min-w-0 flex-wrap items-center gap-2"
                data-week-tabs-locked={weekLockedReason ? 'on' : 'off'}
              >
                {weekTabs ?? <CardTitle>Week {week}</CardTitle>}
                {weekLockedReason && weekTabs && <span className="text-[10px] font-medium text-n-3" data-week-locked-reason>{weekLockedReason}</span>}
              </fieldset>
              <div className="flex items-center gap-2">
                {!readOnly && <SaveIndicator status={status} queued={queued} />}
                <CustomizeMenu columns={columns} onToggle={onToggleColumn} />
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[520px] border-collapse text-[11px]" data-starters-table>
                <thead>
                  <tr className="border-b border-ink text-left">
                    <th className="fs-overline px-3 py-2 text-[9px] font-bold text-n-3">Slot</th>
                    <th className="fs-overline px-2 py-2 text-[9px] font-bold text-n-3">Player</th>
                    {columns.map((c) => (
                      <th key={c} className="fs-overline px-2 py-2 text-right text-[9px] font-bold text-n-3" data-col={c}>
                        {STAT_COLUMNS.find((x) => x.id === c)?.label}
                      </th>
                    ))}
                    <th className="px-3 py-2" aria-label="Move" />
                  </tr>
                </thead>
                <tbody>
                  {model.starters.map((row) => (
                    <StarterRow
                      key={row.slot.key}
                      row={row}
                      ctx={rowCtx}
                      storedStarter={storedStarters.get(row.slot.key) ?? null}
                      kept={!row.player && kept.has(row.slot.key) ? keptIdentity.playerById.get(kept.get(row.slot.key)!)?.full_name ?? kept.get(row.slot.key)! : null}
                    />
                  ))}
                  <tr className="bg-n-4" data-projected-total>
                    <td className="px-3 py-2 text-[11px] font-bold text-ink" colSpan={2 + columns.length - 1}>
                      Projected total
                      {mine.missing > 0 && (
                        <span className="ml-1 font-medium text-n-3">
                          · {mine.missing} without a projection
                        </span>
                      )}
                    </td>
                    <td className="fs-num px-2 py-2 text-right text-[12px] font-extrabold text-ink">{mine.total.toFixed(1)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>

          <BenchCard bench={model.bench} ir={model.ir} ctx={rowCtx} empty={roster.length === 0} />
        </div>
      </div>

      {/* The drag ghost — a TRUE overlay floating above the page, so it
          rests elevated by definition (CLAUDE.md's overlay exception). */}
      <DragOverlay dropAnimation={null}>
        {draggingPlayer ? (
          <div className="flex items-center gap-1.5 rounded-sm border border-ink bg-white px-2 py-1 text-[11px] font-bold shadow-hard-4">
            <PositionBadge position={draggingPlayer.position} size="sm" />
            <span>{draggingPlayer.full_name}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Header pieces
// ---------------------------------------------------------------------------

function SaveIndicator({ status, queued }: { status: AutosaveStatus; queued: number }) {
  const text =
    status === 'saving' ? (queued > 0 ? `Saving… (${queued} more queued)` : 'Saving…') : status === 'saved' ? 'Saved' : status === 'error' ? 'Not saved' : 'Moves save automatically'
  return (
    <span
      role="status"
      aria-live="polite"
      data-save-state={status}
      className={cn('text-[10px] font-bold', status === 'error' ? 'text-negative-strong' : status === 'saved' ? 'text-positive-strong' : 'text-n-3')}
    >
      {text}
    </span>
  )
}

function CustomizeMenu({ columns, onToggle }: { columns: readonly StatColumnId[]; onToggle: (id: StatColumnId) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="stroke" size="sm" data-customize-columns>
          <Icon name="filters" size={13} />
          Customize
        </Button>
      </DropdownMenuTrigger>
      {/* A menu is a true overlay — the primitive keeps its resting shadow. */}
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Stat columns</DropdownMenuLabel>
        {STAT_COLUMNS.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.id}
            checked={columns.includes(c.id)}
            disabled={c.locked}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onToggle(c.id)}
            data-column-option={c.id}
          >
            {c.label}
            {c.locked ? ' (always on)' : ''}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MatchupStrip({ week, opponent, mine }: { week: number; opponent: LineupOpponent | { kind: 'bye' }; mine: ProjectedTotal }) {
  if (opponent.kind === 'bye') {
    return (
      <Card data-matchup-strip="bye">
        <CardContent className="px-card-pad py-3 text-[12px] font-bold text-ink">Week {week}: no matchup — this team has a bye.</CardContent>
      </Card>
    )
  }
  return (
    <Card data-matchup-strip>
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 px-card-pad py-3">
        <span className="fs-overline text-[9px] text-n-3">Week {week} matchup</span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-bold text-ink">{opponent.selfName}</span>
          <span className="fs-num text-[16px] font-extrabold text-ink" data-strip-my-score>
            {formatPoints(opponent.myScore)}
          </span>
          <span className="fs-num text-[10px] font-medium text-n-3">proj {mine.missing > 0 ? '—' : mine.total.toFixed(1)}</span>
        </span>
        <span className="text-[11px] font-bold text-n-3">vs</span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-bold text-ink">{opponent.name}</span>
          <span className="fs-num text-[16px] font-extrabold text-ink" data-strip-opp-score>
            {formatPoints(opponent.oppScore)}
          </span>
          <span className="fs-num text-[10px] font-medium text-n-3">
            proj {opponent.oppProjected && opponent.oppProjected.missing === 0 ? opponent.oppProjected.total.toFixed(1) : '—'}
          </span>
        </span>
        <Button variant="stroke" size="sm" asChild className="ml-auto">
          <Link href={opponent.href} data-strip-matchup-link>
            Open matchup
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}

function CheckDot({ tone }: { tone: LineupCheck['tone'] }) {
  return <span aria-hidden className={cn('inline-block h-2 w-2 shrink-0 rounded-full border border-ink', tone === 'positive' ? 'bg-positive' : 'bg-caution')} />
}

function LineupCheckCard({ checks }: { checks: readonly LineupCheck[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Card data-lineup-check>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-card-pad py-3 text-left hover:bg-n-4 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      >
        <span className="text-[13px] font-bold text-ink">Lineup check</span>
        {!open &&
          checks.map((c) => (
            <span key={c.id} className="flex items-center gap-1.5 text-[11px] font-bold text-ink" data-check-chip={c.id}>
              <CheckDot tone={c.tone} />
              {c.label}
              <span className="fs-num font-medium text-n-3">{c.value}</span>
            </span>
          ))}
        <Icon name={open ? 'collapse' : 'expand'} size={13} className="ml-auto" />
      </button>
      {open && (
        <CardContent className="grid grid-cols-1 gap-2 px-card-pad pb-3 pt-0 sm:grid-cols-2">
          {checks.map((c) => (
            <div key={c.id} className="flex flex-col gap-0.5 rounded-sm border border-ink bg-white px-3 py-2" data-check-card={c.id}>
              <span className="flex items-center gap-1.5 text-[12px] font-bold text-ink">
                <CheckDot tone={c.tone} />
                {c.label}
                <span className="fs-num ml-auto text-[12px] font-extrabold">{c.value}</span>
              </span>
              <span className="text-[11px] font-medium text-n-3">{c.note}</span>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  )
}

function NoticeLine({ tone, text }: { tone: HintTone | 'positive'; text: string }) {
  return (
    <p
      role="status"
      className={cn(
        'rounded-sm border px-3 py-2 text-[12px] font-semibold text-ink',
        tone === 'positive' && 'border-positive bg-positive-soft',
        tone === 'caution' && 'border-ink bg-caution-soft',
        tone === 'negative' && 'border-negative bg-negative-soft',
      )}
    >
      {text}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface RowContext {
  context: PlayerCardContext
  readOnly: boolean
  lockExempt: boolean
  locked: ReadonlySet<string>
  weekIsCurrent: boolean
  currentWeek: number | null
  leagueTimeZone: string | null
  week: number
  allowIllegal: boolean
  columns: readonly StatColumnId[]
  stats: LineupStats
  headshot: (id: string) => string | null
  adp: (id: string) => number | null
  options: (player: RosterPlayer) => ReturnType<typeof moveOptions>
  onMove: (playerId: string, target: MoveTarget) => void
  onDrop?: (player: RosterPlayer) => void
  dropClosedReason: string | null
}

const OPRK_TONE: Record<string, string> = {
  negative: 'border-negative bg-negative-soft',
  caution: 'border-ink bg-caution-soft',
  positive: 'border-positive bg-positive-soft',
}

function StatCell({ column, player, ctx }: { column: StatColumnId; player: RosterPlayer | null; ctx: RowContext }) {
  const base = 'px-2 py-1.5 text-right align-middle'
  if (!player) return <td className={cn(base, 'text-n-3')}>—</td>
  const opp = opponentOf(player.nfl_team, ctx.stats.games)
  switch (column) {
    case 'opp': {
      if (opp.kind === 'bye') return <td className={cn(base, 'font-bold text-ink')}>BYE</td>
      if (opp.kind !== 'game') return <td className={cn(base, 'text-n-3')}>—</td>
      const k = formatKickoff(opp.kickoff_at, ctx.leagueTimeZone)
      return (
        <td className={base} data-cell="opp">
          <span className="block font-bold text-ink">{opp.label}</span>
          <span className="fs-num block text-[10px] font-medium text-n-3" title={k.title ?? undefined}>
            {k.local}
          </span>
        </td>
      )
    }
    case 'oprk': {
      const r = oprkOf(ctx.stats.splits, opp.kind === 'game' ? opp.opp : null, player.position)
      if (r === null) return <td className={cn(base, 'text-n-3')}>—</td>
      const tone = oprkTone(r, oprkRankedCount(ctx.stats.splits, player.position))
      return (
        <td className={base} data-cell="oprk">
          <span className={cn('fs-num inline-flex h-chip items-center rounded-sm border px-1.5 text-[10px] font-bold text-ink', OPRK_TONE[tone])} data-oprk-tone={tone}>
            {r}
          </span>
        </td>
      )
    }
    case 'points': {
      const cell = pointsCell(ctx.stats.points(player.player_id))
      return (
        <td className={cn(base, 'fs-num font-bold', cell.text === '—' ? 'text-n-3' : 'text-ink')} title={cell.pending ? 'Some of his stats are not in yet' : undefined} data-cell="points">
          {cell.text}
          {cell.pending ? '*' : ''}
        </td>
      )
    }
    case 'snap':
      return <td className={cn(base, 'fs-num text-ink')}>{formatSnap(ctx.stats.snap(player.player_id))}</td>
    case 'rostered':
      return (
        <td className={cn(base, 'text-n-3')} title="Not tracked yet">
          —
        </td>
      )
    case 'adp':
      return <td className={cn(base, 'fs-num text-ink')}>{formatAdp(ctx.adp(player.player_id))}</td>
    case 'proj':
      return (
        <td className={cn(base, 'fs-num text-[12px] font-extrabold text-ink')} data-cell="proj">
          {formatPoints(ctx.stats.proj(player.player_id))}
        </td>
      )
  }
}

function StatusTag({ status }: { status: string | null }) {
  const tag = statusTag(status)
  if (!tag) return null
  return (
    <Badge variant={tag === 'Q' ? 'yellow' : 'pink'} className="h-4 px-1 text-[9px]" title={status ?? undefined}>
      {tag}
    </Badge>
  )
}

/** The player cell's identity: headshot, name (opens the card), status, position, team. */
function PlayerIdentity({ player, ctx, frozen }: { player: RosterPlayer; ctx: RowContext; frozen: boolean }) {
  const draggable = useDraggable({ id: player.player_id, disabled: ctx.readOnly || frozen })
  const lock = lockBadgeFor(player.game_lock, ctx.weekIsCurrent)
  const stint = irStintChip(player, ctx.currentWeek)
  return (
    <div className={cn('flex min-w-0 items-center gap-2', draggable.isDragging && 'opacity-40')}>
      {!ctx.readOnly && !frozen && (
        <button
          ref={draggable.setNodeRef}
          type="button"
          {...draggable.attributes}
          {...draggable.listeners}
          data-player={player.player_id}
          aria-label={`Drag ${player.full_name}`}
          className="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center rounded-sm text-n-3 hover:bg-n-4 active:cursor-grabbing"
        >
          <Icon name="dots-vertical" size={12} />
        </button>
      )}
      <PlayerFace playerId={player.player_id} name={player.full_name} position={player.position} team={player.nfl_team} headshotUrl={ctx.headshot(player.player_id)} context={ctx.context} size={24} />
      <div className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-1">
          <PlayerLink playerId={player.player_id} name={player.full_name} context={ctx.context} className="min-w-0 text-[12px] font-bold" />
          <StatusTag status={player.status} />
          {lock.locked && (
            <Badge variant="black" className="h-4 px-1 text-[9px]" title={lock.until ? `Locked until ${formatKickoff(lock.until, ctx.leagueTimeZone).local}` : lock.copy} data-locked>
              🔒
            </Badge>
          )}
          {stint && <Badge variant="stroke-purple" className="h-4 px-1 text-[9px]">{stint}</Badge>}
        </span>
        <span className="flex items-center gap-1 text-[10px] font-medium text-n-3">
          <PositionBadge position={player.position} size="sm" />
          {player.nfl_team ?? 'FA'}
        </span>
      </div>
    </div>
  )
}

function StarterRow({
  row,
  ctx,
  storedStarter,
  kept,
}: {
  row: SlotRow
  ctx: RowContext
  storedStarter: { flags: string[]; player_id: string | null } | null
  kept: string | null
}) {
  const { slot, player } = row
  const isLocked = player ? ctx.locked.has(player.player_id) : kept !== null
  const frozen = isLocked && !ctx.lockExempt
  const droppable = useDroppable({ id: `slot:${slot.key}`, disabled: ctx.readOnly || frozen })
  const hint = player ? starterHint(player, ctx.week, ctx.allowIllegal) : null
  const flags = storedStarter && player && storedStarter.player_id === player.player_id ? starterFlagChips(storedStarter.flags, ctx.allowIllegal) : []
  const hints = [...(hint ? [hint] : []), ...flags]
  return (
    <tr
      ref={droppable.setNodeRef}
      data-slot={slot.key}
      className={cn('border-b border-n-4', isLocked && 'bg-n-4', droppable.isOver && !frozen && 'bg-accent-soft')}
    >
      <td className="fs-overline w-12 px-3 py-1.5 align-middle text-[9px] font-bold text-n-3">{slot.label}</td>
      <td className="px-2 py-1.5 align-middle">
        {player ? (
          <div className="flex flex-col gap-0.5">
            <PlayerIdentity player={player} ctx={ctx} frozen={frozen} />
            {hints.length > 0 && (
              <span className="flex flex-wrap gap-1 pl-6">
                {hints.map((h) => (
                  <Badge key={h.text} variant={h.tone === 'negative' ? 'stroke-pink' : 'yellow'} className="h-4 px-1 text-[9px]">
                    {h.text}
                  </Badge>
                ))}
              </span>
            )}
          </div>
        ) : kept ? (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2" data-kept-starter>
            <Badge variant="black">🔒</Badge>
            <span className="truncate text-[12px] font-bold text-ink">{kept}</span>
            <span className="text-[10px] font-medium text-n-3">{ctx.weekIsCurrent ? KEPT_STARTER_COPY : KEPT_STARTER_OTHER_WEEK_COPY}</span>
          </span>
        ) : (
          <span className="inline-flex h-6 items-center rounded-sm border border-dashed border-n-3 px-2 text-[11px] font-medium text-n-3">Empty</span>
        )}
      </td>
      {ctx.columns.map((c) => (
        <StatCell key={c} column={c} player={player} ctx={ctx} />
      ))}
      <td className="px-3 py-1.5 text-right align-middle">{player && <MoveMenu player={player} ctx={ctx} frozen={frozen} isLocked={isLocked} />}</td>
    </tr>
  )
}

function BenchRow({ player, ctx, ir }: { player: RosterPlayer; ctx: RowContext; ir?: boolean }) {
  const isLocked = ctx.locked.has(player.player_id)
  const frozen = isLocked && !ctx.lockExempt
  const opp = opponentOf(player.nfl_team, ctx.stats.games)
  return (
    <div className={cn('flex items-center gap-2 border-b border-n-4 px-3 py-1.5 last:border-b-0', isLocked && 'bg-n-4')} data-bench-row={player.player_id}>
      {ir && <Badge variant="black" className="h-4 px-1 text-[9px]">IR</Badge>}
      <div className="min-w-0 flex-1">
        <PlayerIdentity player={player} ctx={ctx} frozen={frozen} />
        <span className="block pl-[52px] text-[10px] font-medium text-n-3">
          {opp.kind === 'game' ? opp.label : opp.kind === 'bye' ? 'BYE' : ''}
        </span>
      </div>
      <span className="fs-num text-[12px] font-extrabold text-ink" data-cell="proj">
        {formatPoints(ctx.stats.proj(player.player_id))}
      </span>
      <MoveMenu player={player} ctx={ctx} frozen={frozen} isLocked={isLocked} />
    </div>
  )
}

function IrSeat({ row, ctx }: { row: SlotRow; ctx: RowContext }) {
  const frozen = Boolean(row.player && ctx.locked.has(row.player.player_id) && !ctx.lockExempt)
  const droppable = useDroppable({ id: `slot:${row.slot.key}`, disabled: ctx.readOnly || frozen })
  return (
    <div ref={droppable.setNodeRef} data-slot={row.slot.key} className={cn(droppable.isOver && !frozen && 'bg-accent-soft')}>
      {row.player ? (
        <BenchRow player={row.player} ctx={ctx} ir />
      ) : (
        <div className="flex items-center gap-2 px-3 py-2">
          <Badge variant="black" className="h-4 px-1 text-[9px]">
            {row.slot.label}
          </Badge>
          <span className="text-[11px] font-medium text-n-3">Empty — for players ruled out</span>
        </div>
      )}
    </div>
  )
}

function BenchCard({ bench, ir, ctx, empty }: { bench: RosterPlayer[]; ir: SlotRow[]; ctx: RowContext; empty: boolean }) {
  const droppable = useDroppable({ id: 'bench', disabled: ctx.readOnly })
  return (
    <Card ref={droppable.setNodeRef} className={cn('min-w-0 lg:sticky lg:top-4', droppable.isOver && 'border-accent')} data-bench>
      <CardHeader>
        <CardTitle>Bench</CardTitle>
        <span className="fs-overline text-[9px] text-n-3">
          <span className="fs-num">{bench.length}</span> {bench.length === 1 ? 'player' : 'players'}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col p-0">
        {empty ? (
          <p className="px-3 py-2 text-[12px] font-medium text-n-3">No players on this roster yet — the draft (or a free-agent add) fills it.</p>
        ) : bench.length === 0 ? (
          <p className="px-3 py-2 text-[12px] font-medium text-n-3">Every rostered player is in the lineup.</p>
        ) : (
          bench.map((player) => <BenchRow key={player.player_id} player={player} ctx={ctx} />)
        )}
        {ir.length > 0 && (
          <>
            <p className="fs-overline border-y border-ink bg-n-4 px-3 py-1.5 text-[9px] font-bold text-n-3">Reserve</p>
            {ir.map((row) => (
              <IrSeat key={row.slot.key} row={row} ctx={ctx} />
            ))}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The Move menu: every seat he can go to with its occupant ("WR — Name" /
 * "WR — Empty"), "To bench", IR when he is eligible, and Drop (own team).
 * A locked player's menu says why and offers nothing that would move him.
 */
function MoveMenu({ player, ctx, frozen, isLocked }: { player: RosterPlayer; ctx: RowContext; frozen: boolean; isLocked: boolean }) {
  const canMove = !ctx.readOnly && !frozen
  const showLockReason = !ctx.readOnly && frozen
  if (!canMove && !showLockReason && !ctx.onDrop) return null
  const options = canMove ? ctx.options(player) : []
  const dropReason = ctx.dropClosedReason ?? (isLocked ? LOCKED_DROP_TITLE : null)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="stroke" size="sm" aria-label={`Move menu for ${player.full_name}`} data-move-menu={player.player_id}>
          Move
        </Button>
      </DropdownMenuTrigger>
      {/* A menu is a true overlay — the primitive keeps its resting shadow. */}
      <DropdownMenuContent align="end" className="max-w-[280px]">
        {showLockReason && (
          <p className="px-2 py-1.5 text-[11px] font-medium text-n-3" data-move-locked>
            Locked — his game has started, so he stays where he is until it’s over.
          </p>
        )}
        {options.map((o) => (
          <DropdownMenuItem
            key={o.target.kind === 'slot' ? o.target.key : 'bench'}
            disabled={o.disabledReason !== null}
            title={o.disabledReason ?? undefined}
            onSelect={() => ctx.onMove(player.player_id, o.target)}
            data-move-option={o.target.kind === 'slot' ? o.target.key : 'bench'}
          >
            {o.label}
          </DropdownMenuItem>
        ))}
        {canMove && options.length === 0 && <p className="px-2 py-1.5 text-[11px] font-medium text-n-3">No open seat takes a {player.position}.</p>}
        {ctx.onDrop && (
          <>
            {(options.length > 0 || showLockReason) && <DropdownMenuSeparator />}
            <DropdownMenuItem disabled={dropReason !== null} onSelect={() => ctx.onDrop?.(player)} data-menu-drop={player.player_id}>
              Drop
            </DropdownMenuItem>
            {dropReason && <p className="px-2 pb-1 text-[10px] font-medium text-n-3">{dropReason}</p>}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** `formatKickoff` lives in `lineup-editor-ops.ts` since L.D5.4 (F275(d)) —
 *  re-exported so an existing import path keeps working. */
export { formatKickoff }
