'use client'

import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useMemo, useState } from 'react'

import { AIInsight } from '@/components/ui/ai-insight'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from '@/hooks/use-toast'

import { OprkChip, PlayerCell, StatusTag } from './league-cells'
import {
  MOCK_CURRENT_WEEK,
  defaultAssignment,
  initialsOf,
  irEligible,
  resolveWeekLineup,
  slotEligible,
  weekMatchup,
  type MockInjuryStatus,
  type MockLeague,
  type MockLineup,
  type MockLineupPlayer,
  type WeekAssignment,
} from './league-mock-data'
import { cn } from '@/lib/utils'

/**
 * My team — set-lineup roster management (package screen 10): collapsible
 * lineup-check ribbon, starters table, bench + IR/DL column right. All 18
 * weeks are selectable; the current + future weeks are editable (swap a
 * bench player into a starter slot and back — via the Move menu or by
 * dragging a bench row onto a starter/IR row), past weeks render final —
 * the game already happened, so there's nothing left to set.
 *
 * TODO(live-draft): replace the mock lineup/roster with the real one and
 * wire swaps to the league backend (this only edits local component state).
 */

// League rule surfaced in the reserve rows (mirrors the prototype).
const DL_MIN_WEEKS = 3

// Bench drag payload — carried on `active.data.current` so a drop target can
// check position/status eligibility without a lookup back into the roster.
interface BenchDragData {
  pos: string
  status: MockInjuryStatus
}

// Re-measure droppables while dragging — rows shift as the drag moves, and a
// stale rect is the usual reason a drop lands on the wrong target.
const MEASURE_ALWAYS = {
  droppable: { strategy: MeasuringStrategy.Always },
} as const

interface LineupCheck {
  key: string
  value: string
  ok: boolean
  note: string
}

function buildChecks(
  lineup: MockLineup,
  week: number,
  opp: string,
  oppProj: number,
): { checks: LineupCheck[]; total: number } {
  const { starters } = lineup
  const flagged = starters.filter((p) => p.status)
  const onBye = starters.filter((p) => p.opp === 'BYE')
  const total = starters.reduce((sum, p) => sum + p.proj, 0)
  const diff = total - oppProj
  const checks: LineupCheck[] = [
    {
      key: 'Starters set',
      value: `${starters.length} / ${starters.length}`,
      ok: true,
      note: 'Every slot is filled ahead of Sunday’s locks.',
    },
    {
      key: 'Injury risk',
      value: flagged.length === 0 ? 'None' : `${flagged.length} flagged`,
      ok: flagged.length === 0,
      note:
        flagged.length > 0
          ? `${flagged.map((p) => `${p.name} (${p.status})`).join(', ')} — check Sunday inactives before lock.`
          : 'No injury designations in your lineup.',
    },
    {
      key: 'Players on bye',
      value: onBye.length === 0 ? 'None' : `${onBye.length} on bye`,
      ok: onBye.length === 0,
      note:
        onBye.length > 0
          ? `${onBye.map((p) => p.name).join(', ')} — bye week ${week}. Swap in a bench player.`
          : `No week ${week} byes on your roster.`,
    },
    {
      key: 'Proj vs opponent',
      value: `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}`,
      ok: diff >= 0,
      note: `${total.toFixed(1)} vs ${opp}’s ${oppProj.toFixed(1)} projected.`,
    },
  ]
  return { checks, total }
}

function CheckDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        'h-2 w-2 shrink-0 rounded-full border border-ink',
        ok ? 'bg-positive' : 'bg-caution',
      )}
    />
  )
}

function CheckChip({ check }: { check: LineupCheck }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border border-ink bg-white px-2.5 py-1 text-[10px] font-extrabold">
      <CheckDot ok={check.ok} />
      {check.key}
      <span className="fs-num font-bold text-n-3">{check.value}</span>
    </span>
  )
}

/** Collapsible full-width ribbon (Rankings-submissions pattern). */
function LineupCheckRibbon({ checks }: { checks: LineupCheck[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2.5 px-card-pad py-2.5 text-left transition-colors hover:bg-n-4/50',
          open && 'border-b border-ink',
        )}
      >
        <Icon
          name="arrow-bottom"
          size={13}
          className={cn('shrink-0 transition-transform', !open && '-rotate-90')}
        />
        <span className="whitespace-nowrap text-[13px] font-extrabold">
          Lineup check
        </span>
        {!open && (
          <span className="ml-auto hidden flex-wrap items-center justify-end gap-1.5 md:flex">
            {checks.map((check) => (
              <CheckChip key={check.key} check={check} />
            ))}
          </span>
        )}
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-2.5 p-card-pad sm:grid-cols-2">
          {checks.map((check) => (
            <div
              key={check.key}
              className="rounded-sm border border-n-4 px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <CheckDot ok={check.ok} />
                <span className="text-[11px] font-extrabold">{check.key}</span>
                <span className="fs-num ml-auto text-[11px] font-extrabold">
                  {check.value}
                </span>
              </div>
              <p className="mt-1 text-[10px] font-semibold leading-relaxed text-n-3">
                {check.note}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/** Move button on a starter row — swaps in an eligible bench player. Two
 *  starter slots share the label "RB" and two share "WR", so the target is
 *  identified by its ARRAY INDEX in `lineup.starters`, not the slot label. */
function StarterMoveMenu({
  slotIndex,
  slotLabel,
  bench,
  onSwap,
}: {
  slotIndex: number
  slotLabel: string
  bench: MockLineupPlayer[]
  onSwap: (slotIndex: number, playerName: string) => void
}) {
  const eligible = bench.filter((p) => slotEligible(slotLabel, p.pos))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="stroke" size="sm">
          Move
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {eligible.length === 0 ? (
          <div className="px-2 py-1.5 text-[11px] font-semibold text-n-3">
            No eligible bench players
          </div>
        ) : (
          eligible.map((p) => (
            <DropdownMenuItem
              key={p.name}
              onSelect={() => onSwap(slotIndex, p.name)}
            >
              <span className="min-w-0 flex-1 truncate">
                {p.name}
                <StatusTag status={p.status} />
              </span>
              <span className="fs-num shrink-0 text-[10px] text-n-3">
                {p.proj.toFixed(1)}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Move button on a bench row — swaps into an eligible starter slot (by
 *  index — see `StarterMoveMenu`). A bench RB eligible for both RB slots
 *  lists both, so the user picks which specific starter comes out. */
function BenchMoveMenu({
  player,
  starters,
  onSwap,
}: {
  player: MockLineupPlayer
  starters: MockLineupPlayer[]
  onSwap: (slotIndex: number, playerName: string) => void
}) {
  const eligible = starters
    .map((s, index) => ({ ...s, index }))
    .filter((s) => slotEligible(s.slot, player.pos))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Bench rows carry drag listeners on the whole row (see BenchRow) —
            stop the pointer event here so grabbing this button always opens
            the menu instead of starting a drag. */}
        <Button
          variant="stroke"
          size="sm"
          onPointerDown={(e) => e.stopPropagation()}
        >
          Move
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {eligible.length === 0 ? (
          <div className="px-2 py-1.5 text-[11px] font-semibold text-n-3">
            No eligible starter slots
          </div>
        ) : (
          eligible.map((s) => (
            <DropdownMenuItem
              key={s.index}
              onSelect={() => onSwap(s.index, player.name)}
            >
              <span className="font-extrabold">{s.slot}</span>
              <span className="ml-1.5 truncate text-n-3">— swap {s.name}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** One starter row — a drop target for a dragged bench player. Highlights
 *  with a blue ring + tint only while an ELIGIBLE drag hovers it (matching
 *  the position it can actually fill), never for an ineligible one. */
function StarterRow({
  player,
  slotIndex,
  bench,
  editable,
  onSwap,
}: {
  player: MockLineupPlayer
  slotIndex: number
  bench: MockLineupPlayer[]
  editable: boolean
  onSwap: (slotIndex: number, playerName: string) => void
}) {
  const { isOver, setNodeRef, active } = useDroppable({
    id: `starter-slot:${slotIndex}`,
    data: { slotIndex, slotLabel: player.slot },
    disabled: !editable,
  })
  const draggedPos = (active?.data.current as Partial<BenchDragData> | undefined)
    ?.pos
  const highlight =
    isOver && Boolean(draggedPos) && slotEligible(player.slot, draggedPos!)

  return (
    <TableRow
      ref={setNodeRef}
      className={cn(
        highlight && 'bg-accent-soft ring-[1.5px] ring-inset ring-accent hover:bg-accent-soft',
      )}
    >
      <TableCell className="text-[10px] font-extrabold text-n-3">
        {player.slot}
      </TableCell>
      <TableCell>
        <PlayerCell player={player} />
      </TableCell>
      <TableCell>
        <span className="block text-[10px] font-semibold leading-tight text-n-3">
          {player.opp}
        </span>
        <span className="block text-[9px] font-semibold leading-tight text-n-3">
          {player.time}
        </span>
      </TableCell>
      <TableCell className="text-center">
        {player.opp === 'BYE' ? (
          <span className="text-[10px] font-semibold text-n-3">—</span>
        ) : (
          <OprkChip value={player.oprk} />
        )}
      </TableCell>
      <TableCell className="fs-num text-right text-[12px] font-extrabold">
        {player.proj.toFixed(1)}
      </TableCell>
      <TableCell className="text-right">
        {editable ? (
          <StarterMoveMenu
            slotIndex={slotIndex}
            slotLabel={player.slot}
            bench={bench}
            onSwap={onSwap}
          />
        ) : (
          <span className="text-[10px] font-semibold text-n-3">Final</span>
        )}
      </TableCell>
    </TableRow>
  )
}

function StartersCard({
  lineup,
  total,
  week,
  onSelectWeek,
  editable,
  onSwap,
}: {
  lineup: MockLineup
  total: number
  week: number
  onSelectWeek: (week: number) => void
  editable: boolean
  onSwap: (slotIndex: number, playerName: string) => void
}) {
  return (
    // min-w-0 lets this grid item shrink below the Table's natural content
    // width — without it, CSS Grid sizes the column to fit the table and
    // pushes the Bench column off the page (the Table's own overflow-x-auto
    // wrapper only helps once its container is properly constrained).
    <Card className="min-w-0">
      <div className="flex items-center gap-2.5 border-b border-ink px-card-pad py-2.5">
        <Select
          value={String(week)}
          onValueChange={(v) => onSelectWeek(Number(v))}
        >
          <SelectTrigger className="h-btn-md w-[110px] shrink-0 px-3 text-[12px]" aria-label="Lineup week">
            {/* Radix can't mirror the selected SelectItem's label until it has
                mounted at least once (i.e. opened) — pass the text directly
                instead of relying on that automatic lookup. */}
            <SelectValue>Week {week}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
              <SelectItem key={w} value={String(w)}>
                Week {w}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!editable && <Badge variant="stroke" className="shrink-0">Final</Badge>}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-11">Slot</TableHead>
            <TableHead>Player</TableHead>
            <TableHead>Opp</TableHead>
            <TableHead className="text-center">OPRK</TableHead>
            <TableHead className="text-right">Proj</TableHead>
            <TableHead className="w-[70px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lineup.starters.map((player, i) => (
            <StarterRow
              key={`${player.slot}-${i}`}
              player={player}
              slotIndex={i}
              bench={lineup.bench}
              editable={editable}
              onSwap={onSwap}
            />
          ))}
        </TableBody>
        <TableFooter>
          <TableRow className="bg-n-4/50 hover:bg-n-4/50">
            <TableCell colSpan={4} className="py-2.5 text-[10px] font-extrabold text-n-3">
              {editable ? 'Projected total' : `Week ${week} total`}
            </TableCell>
            <TableCell className="fs-num py-2.5 text-right text-[14px] font-extrabold">
              {total.toFixed(1)}
            </TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
    </Card>
  )
}

/** A bench player — draggable onto a starter row (swap) or the IR row (if
 *  eligible) whenever the week is editable. The Move menu keeps working
 *  alongside the drag gesture (its trigger stops the pointer event so a
 *  plain click never gets mistaken for a drag). */
function BenchRow({
  player,
  starters,
  editable,
  onSwap,
}: {
  player: MockLineupPlayer
  starters: MockLineupPlayer[]
  editable: boolean
  onSwap: (slotIndex: number, playerName: string) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: player.name,
    data: { pos: player.pos, status: player.status } satisfies BenchDragData,
    disabled: !editable,
  })

  return (
    <div
      ref={setNodeRef}
      {...(editable ? attributes : {})}
      {...(editable ? listeners : {})}
      className={cn(
        'flex items-center gap-2 border-b border-n-4 px-card-pad py-2 transition-opacity',
        editable && 'touch-none cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
    >
      <Avatar className="h-6 w-6 shrink-0">
        <AvatarFallback className="text-[8px]">
          {initialsOf(player.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-extrabold leading-tight">
          {player.name}
          <StatusTag status={player.status} />
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="truncate text-[10px] font-semibold text-n-3">
            {player.team} · {player.opp}
          </span>
        </div>
      </div>
      <span className="fs-num shrink-0 text-[11px] font-extrabold">
        {player.proj.toFixed(1)}
      </span>
      {editable ? (
        <BenchMoveMenu player={player} starters={starters} onSwap={onSwap} />
      ) : (
        <span className="shrink-0 text-[10px] font-semibold text-n-3">
          Final
        </span>
      )}
    </div>
  )
}

// TODO(live-draft): stub — IR/DL assignment needs the league backend. Both
// reserve slot is always empty in the mock roster, so this never fires
// today; kept for when a player can actually land on DL.
function dlMoveStub(playerName: string) {
  toast({
    title: `${playerName} stays put for now`,
    description: 'Lineup moves ship with league sync.',
  })
}

/** The IR row — a drop target for a bench player with an Out designation
 *  (see `irEligible`). Highlights the same way starter rows do. Already
 *  holding a player disables the drop (IR holds one); Activate sends them
 *  back to the bench. */
function IRRow({
  player,
  editable,
  onActivate,
}: {
  player: MockLineupPlayer | null
  editable: boolean
  onActivate: () => void
}) {
  const { isOver, setNodeRef, active } = useDroppable({
    id: 'ir-slot',
    disabled: !editable || Boolean(player),
  })
  const draggedStatus = (active?.data.current as Partial<BenchDragData> | undefined)
    ?.status
  const highlight = isOver && Boolean(draggedStatus) && irEligible(draggedStatus!)

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex items-center gap-2.5 border-b border-n-4 bg-page px-card-pad py-2.5 transition-colors',
        highlight && 'bg-accent-soft ring-[1.5px] ring-inset ring-accent',
      )}
    >
      <Badge variant="black" className="min-w-[28px] shrink-0 justify-center">
        IR
      </Badge>
      {player ? (
        <>
          <span className="min-w-0 flex-1 truncate text-[11px] font-extrabold">
            {player.name}
            <StatusTag status={player.status} />
          </span>
          {editable ? (
            <Button variant="stroke" size="sm" onClick={onActivate}>
              Activate
            </Button>
          ) : (
            <span className="shrink-0 text-[10px] font-semibold text-n-3">
              Final
            </span>
          )}
        </>
      ) : (
        <span className="text-[10px] font-semibold text-n-3">
          Drop an Out player here
        </span>
      )}
    </div>
  )
}

function BenchCard({
  lineup,
  editable,
  onSwap,
  onActivateFromIR,
}: {
  lineup: MockLineup
  editable: boolean
  onSwap: (slotIndex: number, playerName: string) => void
  onActivateFromIR: () => void
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Bench</CardTitle>
        {!editable && <Badge variant="stroke">Final</Badge>}
      </CardHeader>
      <div>
        {lineup.bench.map((player) => (
          <BenchRow
            key={player.name}
            player={player}
            starters={lineup.starters}
            editable={editable}
            onSwap={onSwap}
          />
        ))}
        <div className="fs-overline border-b border-n-4 bg-page px-card-pad py-2 text-[9px] text-n-3">
          Reserve
        </div>
        <IRRow
          player={lineup.ir}
          editable={editable}
          onActivate={onActivateFromIR}
        />
        <div className="flex items-center gap-2.5 bg-page px-card-pad py-2.5">
          <Badge variant="black" className="min-w-[28px] shrink-0 justify-center">
            DL
          </Badge>
          {lineup.dl ? (
            <>
              <span className="min-w-0 flex-1 truncate text-[11px] font-extrabold">
                {lineup.dl.name}
                <StatusTag status={lineup.dl.status} />
              </span>
              <Button
                variant="stroke"
                size="sm"
                onClick={() => dlMoveStub(lineup.dl!.name)}
              >
                Move
              </Button>
            </>
          ) : (
            <span className="text-[10px] font-semibold text-n-3">
              Empty — out players · stays {DL_MIN_WEEKS}+ weeks (league rule)
            </span>
          )}
        </div>
      </div>
    </Card>
  )
}

interface LeagueMyTeamTabProps {
  league: MockLeague
  // Lifted to LeagueWorkspace (not owned here) so switching to another
  // league sub-tab and back doesn't unmount-and-reset the selected week or
  // any in-progress lineup swaps.
  week: number
  onWeekChange: (week: number) => void
  assignments: Record<number, WeekAssignment>
  onAssignmentsChange: (
    updater: (prev: Record<number, WeekAssignment>) => Record<number, WeekAssignment>,
  ) => void
}

export function LeagueMyTeamTab({
  league,
  week,
  onWeekChange,
  assignments,
  onAssignmentsChange,
}: LeagueMyTeamTabProps) {
  const assignment = assignments[week] ?? defaultAssignment()
  const lineup = useMemo(
    () => resolveWeekLineup(week, assignment),
    [week, assignment],
  )
  const { opp, oppProj } = useMemo(() => weekMatchup(league, week), [league, week])
  const editable = week >= MOCK_CURRENT_WEEK

  const swap = (slotIndex: number, playerName: string) => {
    onAssignmentsChange((prev) => {
      const current = prev[week] ?? defaultAssignment()
      const nextStarters = [...current.starters]
      nextStarters[slotIndex] = playerName
      return { ...prev, [week]: { ...current, starters: nextStarters } }
    })
  }

  const moveToIR = (playerName: string) => {
    onAssignmentsChange((prev) => {
      const current = prev[week] ?? defaultAssignment()
      return { ...prev, [week]: { ...current, ir: playerName } }
    })
  }

  const activateFromIR = () => {
    onAssignmentsChange((prev) => {
      const current = prev[week] ?? defaultAssignment()
      return { ...prev, [week]: { ...current, ir: null } }
    })
  }

  // Bench rows are the only drag source; starter rows and the IR row are the
  // only drop targets — see StarterRow/IRRow for the eligibility + highlight
  // logic, mirrored here so a drop that fails eligibility explains why.
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const playerName = String(active.id)
    const activeData = active.data.current as Partial<BenchDragData> | undefined

    if (over.id === 'ir-slot') {
      if (!activeData?.status || !irEligible(activeData.status)) {
        toast({
          title: 'Not eligible for IR',
          description: `${playerName} needs an Out designation to go on IR.`,
          variant: 'destructive',
        })
        return
      }
      moveToIR(playerName)
      return
    }

    const overData = over.data.current as
      | { slotIndex?: number; slotLabel?: string }
      | undefined
    if (typeof overData?.slotIndex !== 'number') return
    if (!activeData?.pos || !slotEligible(overData.slotLabel ?? '', activeData.pos)) {
      toast({
        title: 'Not eligible',
        description: `${playerName} can't fill that slot.`,
        variant: 'destructive',
      })
      return
    }
    swap(overData.slotIndex, playerName)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )
  const [dragId, setDragId] = useState<string | null>(null)
  const draggingPlayer = dragId
    ? (lineup.bench.find((p) => p.name === dragId) ?? null)
    : null

  const { checks, total } = buildChecks(lineup, week, opp, oppProj)

  return (
    <DndContext
      // A fixed id makes dnd-kit's accessibility description id deterministic
      // (it otherwise falls back to an auto-incrementing counter, which can
      // differ between the server render and the client hydration pass and
      // throw a hydration-mismatch warning once a second DndContext — the
      // app-wide one from AppDndContext plus this local one — is on the page).
      id="my-team-lineup"
      sensors={sensors}
      collisionDetection={pointerWithin}
      measuring={MEASURE_ALWAYS}
      onDragStart={(e) => setDragId(String(e.active.id))}
      onDragEnd={(e) => {
        setDragId(null)
        handleDragEnd(e)
      }}
      onDragCancel={() => setDragId(null)}
    >
      <div className="flex flex-col gap-[19px]">
        <LineupCheckRibbon checks={checks} />

        <div className="grid grid-cols-1 items-start gap-[19px] lg:grid-cols-[1.7fr_1fr]">
          <StartersCard
            lineup={lineup}
            total={total}
            week={week}
            onSelectWeek={onWeekChange}
            editable={editable}
            onSwap={swap}
          />

          <div className="flex flex-col gap-[19px]">
            <BenchCard
              lineup={lineup}
              editable={editable}
              onSwap={swap}
              onActivateFromIR={activateFromIR}
            />
            {/* Start/sit call — AI moments are always ultramarine. The copy
                cites week-11-specific matchup facts (SF's #5 pass defense,
                Evans's #25 at Atlanta), so it only holds at that exact week —
                other weeks' opponents/OPRK are generated and wouldn't match. */}
            {week === MOCK_CURRENT_WEEK && (
              <AIInsight heading="Swap Wilson → Evans" confidence="high">
                Wilson (Q, hamstring) draws SF’s #5 pass defense. Evans is
                healthy with a #25 matchup at Atlanta — a +4.1 projection
                swing.
              </AIInsight>
            )}
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {draggingPlayer ? (
          <div className="flex items-center gap-2 rounded-sm border border-ink bg-white px-3 py-2 shadow-hard-4">
            <Avatar className="h-6 w-6 shrink-0">
              <AvatarFallback className="text-[8px]">
                {initialsOf(draggingPlayer.name)}
              </AvatarFallback>
            </Avatar>
            <span className="text-[11px] font-extrabold">
              {draggingPlayer.name}
            </span>
            <span className="fs-num ml-2 text-[11px] font-bold text-n-3">
              {draggingPlayer.proj.toFixed(1)}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
