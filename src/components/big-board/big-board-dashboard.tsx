'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { PlayerCard, type PlayerCardStatChip } from '@/components/players/player-card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  useAdpBoard,
  useAuctionBoard,
  useConsensusBoard,
  usePersonaBoardPlayers,
  type BoardSourcePlayer,
} from '@/hooks/use-board-sources'
import { listsKeys, useBigBoard, useReorderPlayers } from '@/hooks/use-lists'
import { usePersonaBoards } from '@/hooks/use-persona-boards'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { useBoardLabelsStore, type BoardLabel } from '@/stores/board-labels-store'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

// ---------------------------------------------------------------------------
// Filter vocab
// ---------------------------------------------------------------------------

type SourceId = 'mine' | 'consensus' | 'adp' | 'auction' | `persona:${string}`

const POSITIONS = [
  { id: 'ALL', title: 'All positions' },
  { id: 'QB', title: 'QB' },
  { id: 'RB', title: 'RB' },
  { id: 'WR', title: 'WR' },
  { id: 'TE', title: 'TE' },
  { id: 'FLEX', title: 'FLEX (RB/WR/TE)' },
  { id: 'K', title: 'K' },
  { id: 'DEF', title: 'D/ST' },
] as const
type PositionFilter = (typeof POSITIONS)[number]['id']

const SCORINGS = [
  { id: 'standard', title: 'Standard' },
  { id: 'half', title: 'Half PPR' },
  { id: 'ppr', title: 'Full PPR' },
] as const
type Scoring = (typeof SCORINGS)[number]['id']

const WIDTHS = [
  { id: '0', title: 'Auto' },
  { id: '4', title: '4 wide' },
  { id: '6', title: '6 wide' },
  { id: '8', title: '8 wide' },
  { id: '10', title: '10 wide' },
] as const

// What a card can show. Insertion-ordered — the 3 most recently enabled
// fields win a chip slot (mirrors the design package's card-info menu).
// TODO(data): SOS and auction values have no schema column yet — the menu
// keeps their slots visible-but-disabled so the feature is discoverable.
const FIELDS: Array<{ id: string; label: string; available: boolean }> = [
  { id: 'bye', label: 'Bye week', available: true },
  { id: 'proj', label: 'Proj points', available: true },
  { id: 'adp', label: 'ADP', available: true },
  { id: 'tgt', label: 'Target share', available: true },
  { id: 'snap', label: 'Snap %', available: true },
  { id: 'sos', label: 'Strength of schedule', available: true },
  { id: 'auction', label: 'Avg auction price', available: true },
]

const PROJ_KEY: Record<Scoring, keyof BoardSourcePlayer> = {
  standard: 'projected_pts_standard',
  half: 'projected_pts_half_ppr',
  ppr: 'projected_pts_ppr',
}

function matchesPosition(position: string, filter: PositionFilter): boolean {
  if (filter === 'ALL') return true
  if (filter === 'FLEX') return ['RB', 'WR', 'TE'].includes(position)
  if (filter === 'DEF') return position === 'DEF' || position === 'DST'
  return position === filter
}

// Cross-position tier cuts, proportional to how deep the board is (from the
// Field Scout design package): 6 bands that widen as you go down.
function tierBands(count: number): Array<{ tier: number; start: number; end: number }> {
  const cuts = [0.03, 0.08, 0.16, 0.28, 0.46].map((f) =>
    Math.max(3, Math.round(count * f)),
  )
  const bands: Array<{ tier: number; start: number; end: number }> = []
  let prev = 0
  for (let t = 0; t < 6; t++) {
    const end = t === 5 ? count : cuts[t]
    if (end <= prev) continue
    bands.push({ tier: t + 1, start: prev, end })
    prev = end
  }
  return bands
}

// Full literal class strings so Tailwind's scanner emits them. Tiers 3–4
// take dark text per the token ramp's contrast note.
const TIER_BG = ['bg-tier-1', 'bg-tier-2', 'bg-tier-3', 'bg-tier-4', 'bg-tier-5', 'bg-tier-6']
const TIER_TEXT = ['text-white', 'text-white', 'text-ink', 'text-ink', 'text-white', 'text-white']

// ---------------------------------------------------------------------------
// Sortable card
// ---------------------------------------------------------------------------

interface CardData {
  player: BoardSourcePlayer
  rank: number
  chips: PlayerCardStatChip[]
  label: BoardLabel | null
  faded: boolean
}

function BoardCardMenu({
  label,
  onToggle,
}: {
  label: BoardLabel | null
  onToggle: (label: BoardLabel) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Quick label"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute bottom-1 right-1 z-20 flex h-5 w-5 items-center justify-center rounded-sm border border-ink bg-white text-ink opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
        >
          <Icon name="dots" size={11} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => onToggle('drafted')}>
          <Icon name="check" size={12} />
          {label === 'drafted' ? 'Undo drafted' : 'Mark drafted'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onToggle('dnd')}>
          <Icon name="close" size={12} />
          {label === 'dnd' ? 'Undo do not draft' : 'Do not draft'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SortableBoardCard({
  data,
  draggable,
  onOpen,
  onToggleLabel,
}: {
  data: CardData
  draggable: boolean
  onOpen: () => void
  onToggleLabel: (label: BoardLabel) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: data.player.id, disabled: !draggable })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <PlayerCard
        layout="board"
        rank={data.rank}
        player={data.player}
        statChips={data.chips}
        label={data.label}
        faded={data.faded}
        draggable={draggable}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
        onOpen={onOpen}
        menuSlot={<BoardCardMenu label={data.label} onToggle={onToggleLabel} />}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * The Big Board — an evergreen, cross-position VIEW of rankings (now → rest
 * of season). Rankings is the activity; this is the dashboard: pick a source
 * board (yours, expert consensus, ADP, an AI persona), filter by position and
 * scoring, toggle tiers, choose what each card shows, and quick-label players
 * on draft day. Your own board stays drag-to-sort; every other board is a
 * read-only view.
 */
export function BigBoardDashboard() {
  const [source, setSource] = useState<SourceId>('mine')
  const [pos, setPos] = useState<PositionFilter>('ALL')
  const [hideOthers, setHideOthers] = useState(false)
  const [scoring, setScoring] = useState<Scoring>('half')
  const [tiers, setTiers] = useState(false)
  const [width, setWidth] = useState<string>('0')
  const [fields, setFields] = useState<string[]>(['bye', 'adp', 'proj'])
  const [hideDrafted, setHideDrafted] = useState(false)

  const labels = useBoardLabelsStore((s) => s.labels)
  const toggleLabel = useBoardLabelsStore((s) => s.toggleLabel)
  const openPlayer = usePlayerWindowsStore((s) => s.open)
  const { toast } = useToast()
  const qc = useQueryClient()

  // ---- source data -------------------------------------------------------
  const mineQuery = useBigBoard()
  const consensusQuery = useConsensusBoard(source === 'consensus')
  const adpQuery = useAdpBoard(source === 'adp')
  const auctionQuery = useAuctionBoard(source === 'auction')
  const personaListId = source.startsWith('persona:') ? source.slice('persona:'.length) : null
  const personaQuery = usePersonaBoardPlayers(personaListId)
  const personas = usePersonaBoards(8)

  const listId = mineQuery.data?.list?.id ?? ''
  const reorder = useReorderPlayers(listId)

  const minePlayers = useMemo<BoardSourcePlayer[]>(
    () =>
      (mineQuery.data?.players ?? []).map((entry) => ({
        id: entry.player.id,
        full_name: entry.player.full_name,
        position: entry.player.position,
        team: entry.player.team,
        headshot_url: entry.player.headshot_url,
        bye_week: entry.player.bye_week ?? null,
        adp: entry.player.adp ?? null,
        projected_pts_standard: entry.player.projected_pts_standard ?? null,
        projected_pts_half_ppr: entry.player.projected_pts_half_ppr ?? null,
        projected_pts_ppr: entry.player.projected_pts_ppr ?? null,
        snap_pct: entry.player.snap_pct ?? null,
        target_share: entry.player.target_share ?? null,
        sos: entry.player.sos ?? null,
        auction_value: entry.player.auction_value ?? null,
      })),
    [mineQuery.data],
  )

  // Local order for your board — optimistic, saved on every drop.
  const serverOrder = useMemo(() => minePlayers.map((p) => p.id), [minePlayers])
  const [order, setOrder] = useState<string[]>(serverOrder)
  useEffect(() => {
    setOrder(serverOrder)
  }, [serverOrder])

  const mineById = useMemo(() => {
    const map = new Map<string, BoardSourcePlayer>()
    for (const p of minePlayers) map.set(p.id, p)
    return map
  }, [minePlayers])

  const activeQuery =
    source === 'mine'
      ? mineQuery
      : source === 'consensus'
        ? consensusQuery
        : source === 'adp'
          ? adpQuery
          : source === 'auction'
            ? auctionQuery
            : personaQuery

  const pool = useMemo<BoardSourcePlayer[]>(() => {
    if (source === 'mine') {
      return order
        .map((id) => mineById.get(id))
        .filter((p): p is BoardSourcePlayer => Boolean(p))
    }
    if (source === 'consensus') return consensusQuery.data ?? []
    if (source === 'adp') return adpQuery.data ?? []
    if (source === 'auction') return auctionQuery.data ?? []
    return personaQuery.data ?? []
  }, [source, order, mineById, consensusQuery.data, adpQuery.data, auctionQuery.data, personaQuery.data])

  // ---- filters ------------------------------------------------------------
  const inPos = (p: BoardSourcePlayer) => matchesPosition(p.position, pos)
  const fading = pos !== 'ALL' && !hideOthers

  const visible = useMemo(() => {
    let list = pool
    if (pos !== 'ALL' && hideOthers) list = list.filter(inPos)
    if (hideDrafted) list = list.filter((p) => labels[p.id] !== 'drafted')
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, pos, hideOthers, hideDrafted, labels])

  const draftedCount = useMemo(
    () => pool.filter((p) => labels[p.id] === 'drafted').length,
    [pool, labels],
  )

  const chipSet = useMemo(() => new Set(fields.slice(-3)), [fields])
  const projKey = PROJ_KEY[scoring]

  const cardData = useMemo<CardData[]>(
    () =>
      visible.map((player, i) => {
        const chips: PlayerCardStatChip[] = []
        // Pink per the design: SOS is the "watch out" stat (1 easy – 32 hard).
        if (chipSet.has('sos') && player.sos != null) {
          chips.push({ id: 'sos', text: `S: ${player.sos}`, tone: 'pink' })
        }
        if (chipSet.has('bye') && player.bye_week != null) {
          chips.push({ id: 'bye', text: `B: ${player.bye_week}` })
        }
        if (chipSet.has('adp') && player.adp != null) {
          chips.push({ id: 'adp', text: `A: ${Math.round(player.adp)}` })
        }
        const proj = player[projKey]
        if (chipSet.has('proj') && typeof proj === 'number') {
          chips.push({ id: 'proj', text: `P: ${proj.toFixed(0)}` })
        }
        if (chipSet.has('tgt') && player.target_share != null) {
          chips.push({ id: 'tgt', text: `T: ${Math.round(player.target_share)}%` })
        }
        if (chipSet.has('snap') && player.snap_pct != null) {
          chips.push({ id: 'snap', text: `Sn: ${Math.round(player.snap_pct)}%` })
        }
        // Green per the design: auction is the "money" chip.
        if (chipSet.has('auction') && player.auction_value != null) {
          chips.push({
            id: 'auction',
            text: `$${Math.round(player.auction_value)}`,
            tone: 'green',
          })
        }
        return {
          player,
          rank: i + 1,
          chips,
          label: labels[player.id] ?? null,
          faded: fading && !inPos(player),
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, chipSet, projKey, labels, fading, pos],
  )

  // ---- drag to sort (your board only) -------------------------------------
  const canDrag = source === 'mine' && !tiers
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const persistOrder = (next: string[]) => {
    if (!listId) return
    reorder.mutate(
      next.map((playerId, i) => ({ playerId, position: i + 1 })),
      {
        onSuccess: () => qc.invalidateQueries({ queryKey: listsKeys.bigBoard() }),
        onError: (err) => {
          setOrder(serverOrder)
          toast({
            title: 'Could not save your order',
            description: err.message,
            variant: 'destructive',
          })
        },
      },
    )
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const visibleIds = visible.map((p) => p.id)
    const from = visibleIds.indexOf(String(active.id))
    const to = visibleIds.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    const nextVisible = arrayMove(visibleIds, from, to)

    // When a filter hides players, re-thread the permuted subset through its
    // original slots so hidden players keep their place in the full order.
    const inVisible = new Set(visibleIds)
    let i = 0
    const next = order.map((id) => (inVisible.has(id) ? nextVisible[i++] : id))
    setOrder(next)
    persistOrder(next)
  }

  // ---- source select ------------------------------------------------------
  // Selecting the ADP/auction board flips that stat onto the cards
  // (design behavior).
  const pickSource = (next: SourceId) => {
    setSource(next)
    if (next === 'adp') {
      setFields((f) => (f.includes('adp') ? f : [...f, 'adp']))
    }
    if (next === 'auction') {
      setFields((f) => (f.includes('auction') ? f : [...f, 'auction']))
    }
  }

  const toggleField = (id: string) =>
    setFields((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))

  const sourceTitle =
    source === 'mine'
      ? 'My board'
      : source === 'consensus'
        ? 'Expert consensus'
        : source === 'adp'
          ? 'ADP'
          : source === 'auction'
            ? 'Auction price'
            : (personas.data?.find((b) => b.id === personaListId)?.persona.display_name ??
              'AI board')

  const gridStyle = {
    display: 'grid',
    gap: '10px',
    gridTemplateColumns:
      width === '0'
        ? 'repeat(auto-fill, minmax(170px, 1fr))'
        : `repeat(${width}, minmax(0, 1fr))`,
  } as const

  const renderCards = (items: CardData[]) => (
    <div style={gridStyle}>
      {items.map((data) => (
        <SortableBoardCard
          key={data.player.id}
          data={data}
          draggable={canDrag}
          onOpen={() => openPlayer(data.player.id)}
          onToggleLabel={(label) => toggleLabel(data.player.id, label)}
        />
      ))}
    </div>
  )

  const board = tiers ? (
    <div className="flex flex-col gap-5">
      {tierBands(cardData.length).map((band, i) => (
        <div key={band.tier}>
          <div className="mb-2.5 flex items-center gap-2.5">
            <span
              className={cn(
                'fs-num inline-flex items-center rounded-sm border border-ink px-2.5 py-0.5 text-[12px] font-extrabold',
                TIER_BG[i],
                TIER_TEXT[i],
              )}
            >
              Tier {band.tier}
            </span>
            <span className="text-[11px] font-bold text-n-3">
              {band.end - band.start} players
            </span>
          </div>
          {renderCards(cardData.slice(band.start, band.end))}
        </div>
      ))}
    </div>
  ) : (
    renderCards(cardData)
  )

  return (
    <section>
      {/* controls */}
      <div className="mb-2 flex flex-wrap items-end gap-3">
        <label className="flex w-[200px] flex-col gap-1">
          <span className="fs-overline text-n-3">Board</span>
          <Select value={source} onValueChange={(v) => pickSource(v as SourceId)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">My board</SelectItem>
              <SelectItem value="consensus">Expert consensus</SelectItem>
              <SelectItem value="adp">ADP</SelectItem>
              <SelectItem value="auction">Auction price</SelectItem>
              {(personas.data ?? []).map((b) => (
                <SelectItem key={b.id} value={`persona:${b.id}`}>
                  {b.persona.display_name.includes('(AI)')
                    ? b.persona.display_name
                    : `${b.persona.display_name} (AI)`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex w-[170px] flex-col gap-1">
          <span className="fs-overline text-n-3">Position</span>
          <Select value={pos} onValueChange={(v) => setPos(v as PositionFilter)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POSITIONS.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        {pos !== 'ALL' && (
          <label className="flex h-input cursor-pointer items-center gap-2">
            <Switch checked={hideOthers} onCheckedChange={setHideOthers} />
            <span className="text-[12px] font-bold">
              {hideOthers ? 'Hide others' : 'Fade others'}
            </span>
          </label>
        )}

        <label className="flex w-[130px] flex-col gap-1">
          <span className="fs-overline text-n-3">Scoring</span>
          <Select value={scoring} onValueChange={(v) => setScoring(v as Scoring)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCORINGS.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex w-[110px] flex-col gap-1">
          <span className="fs-overline text-n-3">Width</span>
          <Select value={width} onValueChange={setWidth}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WIDTHS.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex h-input cursor-pointer items-center gap-2">
          <Switch checked={tiers} onCheckedChange={setTiers} />
          <span className="text-[12px] font-bold">Tiers</span>
        </label>

        <span className="ml-auto">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="stroke" size="sm">
                <Icon name="filters" size={13} /> Card info
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 p-3.5">
              <p className="mb-2.5 text-[11px] font-extrabold text-n-3">
                Show on every card · latest 3 show
              </p>
              <div className="flex flex-col gap-2.5">
                {FIELDS.map((f) => (
                  <label
                    key={f.id}
                    className={cn(
                      'flex items-center gap-2 text-[13px] font-bold',
                      f.available ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <Checkbox
                      checked={fields.includes(f.id)}
                      disabled={!f.available}
                      onCheckedChange={() => toggleField(f.id)}
                    />
                    {f.label}
                    {!f.available && (
                      <span className="ml-auto text-[10px] font-bold text-n-3">
                        Soon
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </span>
      </div>

      {/* status line */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-[12px] font-bold text-n-3">
          {sourceTitle} · rest of season · {cardData.length} players ·{' '}
          {source === 'mine'
            ? tiers
              ? 'turn tiers off to drag'
              : reorder.isPending
                ? 'saving…'
                : 'drag to sort'
            : 'read-only view'}
        </span>
        {draftedCount > 0 && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-bold">
            <Checkbox
              checked={hideDrafted}
              onCheckedChange={(v) => setHideDrafted(v === true)}
            />
            Hide drafted ({draftedCount})
          </label>
        )}
      </div>

      {/* board */}
      {activeQuery?.isPending ? (
        <div style={gridStyle}>
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="h-[95px] w-full" />
          ))}
        </div>
      ) : activeQuery?.isError ? (
        <div className="rounded-sm border border-ink bg-white px-6 py-10 text-center">
          <h3 className="text-h6">Could not load this board</h3>
          <p className="mx-auto mt-1 max-w-md text-[13px] font-medium text-negative-strong">
            {(activeQuery.error as Error)?.message ?? 'Something went wrong.'}
          </p>
        </div>
      ) : cardData.length === 0 ? (
        <div className="rounded-sm border border-ink bg-white px-6 py-14 text-center">
          <h3 className="text-h6">No players to show</h3>
          <p className="mx-auto mt-1 max-w-md text-[13px] font-medium text-n-3">
            {pos !== 'ALL' && hideOthers
              ? `No ${pos} players on this board — try another position or switch back to fade.`
              : 'This board is empty right now.'}
          </p>
        </div>
      ) : canDrag ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={visible.map((p) => p.id)}
            strategy={rectSortingStrategy}
          >
            {board}
          </SortableContext>
        </DndContext>
      ) : (
        board
      )}
    </section>
  )
}
