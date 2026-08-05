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
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
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
  useLastSeasonPoints,
  usePersonaBoardPlayers,
  useUsageMap,
  type BoardSourcePlayer,
} from '@/hooks/use-board-sources'
import type { ScoringKey } from '@/lib/stats/aggregate-fantasy'
import { TIER_RAMP } from '@/components/lists/tier-badge'
import { NFL_TEAM_COLORS } from '@/lib/nfl-team-colors'
import { matchesPosition } from '@/utils/positions'
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

// What a card can show as a stat pill. Insertion-ordered — the 4 most
// recently enabled fields win a slot (Figma 802:8 shows four pills). Bye is
// not here: it lives permanently in the card's meta row. "Position rank" is
// deliberately absent pre-season: rank on a board is an OPINION (the blue
// chip); an objective rank only exists once real points are scored, and can
// return then, computed from actual fantasy points.
const FIELDS: Array<{ id: string; label: string }> = [
  { id: 'adp', label: 'Draft round (from ADP)' },
  { id: 'proj', label: 'Proj points' },
  { id: 'tgt', label: 'Target share' },
  { id: 'snap', label: 'Snap %' },
  { id: 'sos', label: 'Strength of schedule' },
  { id: 'auction', label: 'Avg auction price' },
  { id: 'pts2025', label: '2025 total points' },
]

/** ADP → snake-draft round in a 12-team league. */
const DRAFT_ROUND_TEAMS = 12

// Big Board always represents the current season — there's no season picker.
const CURRENT_SEASON = Number(process.env.NEXT_PUBLIC_NFL_SEASON ?? 2026)
const LAST_SEASON = CURRENT_SEASON - 1

const TEAM_OPTIONS = Object.keys(NFL_TEAM_COLORS).sort()

const PROJ_KEY: Record<Scoring, keyof BoardSourcePlayer> = {
  standard: 'projected_pts_standard',
  half: 'projected_pts_half_ppr',
  ppr: 'projected_pts_ppr',
}

// Big Board's Scoring ids don't quite match aggregate-fantasy's ScoringKey
// spelling ('half' vs 'half_ppr') — map between them for the 2025-points field.
const SCORING_KEY: Record<Scoring, ScoringKey> = {
  standard: 'standard',
  half: 'half_ppr',
  ppr: 'ppr',
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
        onToggleLabel={onToggleLabel}
        faded={data.faded}
        draggable={draggable}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
        onOpen={onOpen}
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
  const [team, setTeam] = useState('')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [tiers, setTiers] = useState(false)
  const [width, setWidth] = useState<string>('0')
  // No pills by default (Figma "Default" state) — enable via the Card info menu.
  const [fields, setFields] = useState<string[]>([])
  const [hideDrafted, setHideDrafted] = useState(false)

  const labels = useBoardLabelsStore((s) => s.labels)
  const toggleLabel = useBoardLabelsStore((s) => s.toggleLabel)
  const openPlayer = usePlayerWindowsStore((s) => s.open)
  const { toast } = useToast()
  const qc = useQueryClient()

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 200)
    return () => clearTimeout(id)
  }, [query])

  // ---- source data -------------------------------------------------------
  const mineQuery = useBigBoard()
  const usageQuery = useUsageMap(CURRENT_SEASON)
  const usageMap = usageQuery.data
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

  // Single source descriptor — the ONE place that enumerates board sources.
  // Adding a source means adding one entry here plus its SelectItem.
  const sourceInfo = useMemo(() => {
    switch (source) {
      case 'mine':
        return { query: mineQuery, title: 'My board' }
      case 'consensus':
        return { query: consensusQuery, title: 'Expert consensus' }
      case 'adp':
        return { query: adpQuery, title: 'ADP' }
      case 'auction':
        return { query: auctionQuery, title: 'Auction price' }
      default:
        return {
          query: personaQuery,
          title:
            personas.data?.find((b) => b.id === personaListId)?.persona
              .persona_name ?? 'AI board',
        }
    }
  }, [source, mineQuery, consensusQuery, adpQuery, auctionQuery, personaQuery, personas.data, personaListId])
  const activeQuery = sourceInfo.query

  const pool = useMemo<BoardSourcePlayer[]>(() => {
    if (source === 'mine') {
      return order
        .map((id) => mineById.get(id))
        .filter((p): p is BoardSourcePlayer => Boolean(p))
    }
    return (sourceInfo.query.data as BoardSourcePlayer[] | undefined) ?? []
  }, [source, order, mineById, sourceInfo.query.data])

  // ---- filters ------------------------------------------------------------
  const inPos = (p: BoardSourcePlayer) => matchesPosition(p.position, pos)
  const fading = pos !== 'ALL' && !hideOthers

  const visible = useMemo(() => {
    let list = pool
    if (pos !== 'ALL' && hideOthers) list = list.filter(inPos)
    if (team) list = list.filter((p) => p.team === team)
    if (debouncedQuery) {
      list = list.filter((p) => p.full_name.toLowerCase().includes(debouncedQuery))
    }
    if (hideDrafted) list = list.filter((p) => labels[p.id] !== 'drafted')
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, pos, hideOthers, team, debouncedQuery, hideDrafted, labels])

  const draftedCount = useMemo(
    () => pool.filter((p) => labels[p.id] === 'drafted').length,
    [pool, labels],
  )

  const chipSet = useMemo(() => new Set(fields.slice(-4)), [fields])
  const projKey = PROJ_KEY[scoring]

  // Lazy — only fetched once the field is actually toggled on, scoped to the
  // whole (unfiltered) pool so typing in Search doesn't refetch on every key.
  const wantsLastSeasonPts = fields.includes('pts2025')
  const lastSeasonQuery = useLastSeasonPoints(
    wantsLastSeasonPts ? pool.map((p) => p.id) : [],
    SCORING_KEY[scoring],
  )
  const lastSeasonMap = lastSeasonQuery.data

  const cardData = useMemo<CardData[]>(
    () =>
      visible.map((player, i) => {
        const chips: PlayerCardStatChip[] = []
        if (chipSet.has('adp') && player.adp != null) {
          chips.push({
            id: 'adp',
            text: `Round: ${Math.max(1, Math.ceil(player.adp / DRAFT_ROUND_TEAMS))}`,
          })
        }
        const proj = player[projKey]
        if (chipSet.has('proj') && typeof proj === 'number') {
          chips.push({ id: 'proj', text: `Proj: ${proj.toFixed(0)}` })
        }
        const usage = usageMap?.get(player.id)
        if (chipSet.has('tgt') && usage?.target_share != null) {
          chips.push({ id: 'tgt', text: `Tgt: ${Math.round(usage.target_share)}%` })
        }
        if (chipSet.has('snap') && usage?.snap_pct != null) {
          chips.push({ id: 'snap', text: `Snap: ${Math.round(usage.snap_pct)}%` })
        }
        // Green = money, pink = "watch out" (SOS), per the Figma pills.
        if (chipSet.has('auction') && player.auction_value != null) {
          chips.push({
            id: 'auction',
            text: `$${Math.round(player.auction_value)}`,
            tone: 'green',
          })
        }
        if (chipSet.has('sos') && player.sos != null) {
          chips.push({ id: 'sos', text: `SOS: ${player.sos}`, tone: 'pink' })
        }
        const pts2025 = lastSeasonMap?.get(player.id)
        if (chipSet.has('pts2025') && pts2025 != null) {
          chips.push({ id: 'pts2025', text: `${LAST_SEASON}: ${pts2025.toFixed(0)}` })
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
    [visible, chipSet, projKey, usageMap, lastSeasonMap, labels, fading, pos],
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
  const pickSource = (next: SourceId) => setSource(next)

  const toggleField = (id: string) =>
    setFields((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))

  const sourceTitle = sourceInfo.title

  const gridStyle = {
    display: 'grid',
    gap: '10px',
    gridTemplateColumns:
      width === '0'
        ? 'repeat(auto-fill, minmax(200px, 1fr))'
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
                TIER_RAMP[i],
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
            <SelectTrigger className="h-btn-md px-3 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">My board</SelectItem>
              <SelectItem value="consensus">Expert consensus</SelectItem>
              <SelectItem value="adp">ADP</SelectItem>
              <SelectItem value="auction">Auction price</SelectItem>
              {(personas.data ?? []).map((b) => (
                <SelectItem key={b.id} value={`persona:${b.id}`}>
                  {b.persona.persona_name.includes('(AI)')
                    ? b.persona.persona_name
                    : `${b.persona.persona_name} (AI)`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex w-[170px] flex-col gap-1">
          <span className="fs-overline text-n-3">Position</span>
          <Select value={pos} onValueChange={(v) => setPos(v as PositionFilter)}>
            <SelectTrigger className="h-btn-md px-3 text-[12px]">
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
          <label className="flex h-btn-md cursor-pointer items-center gap-2">
            <Switch checked={hideOthers} onCheckedChange={setHideOthers} />
            <span className="text-[12px] font-bold">
              {hideOthers ? 'Hide others' : 'Fade others'}
            </span>
          </label>
        )}

        <label className="flex w-[130px] flex-col gap-1">
          <span className="fs-overline text-n-3">Scoring</span>
          <Select value={scoring} onValueChange={(v) => setScoring(v as Scoring)}>
            <SelectTrigger className="h-btn-md px-3 text-[12px]">
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

        <label className="flex w-[120px] flex-col gap-1">
          <span className="fs-overline text-n-3">Pro team</span>
          <Select
            value={team || 'ALL'}
            onValueChange={(v) => setTeam(v === 'ALL' ? '' : v)}
          >
            <SelectTrigger className="h-btn-md px-3 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All teams</SelectItem>
              {TEAM_OPTIONS.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex w-[170px] flex-col gap-1">
          <span className="fs-overline text-n-3">Search</span>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players…"
            className="h-btn-md px-3 text-[12px]"
          />
        </label>

        <label className="flex w-[110px] flex-col gap-1">
          <span className="fs-overline text-n-3">Width</span>
          <Select value={width} onValueChange={setWidth}>
            <SelectTrigger className="h-btn-md px-3 text-[12px]">
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

        <label className="flex h-btn-md cursor-pointer items-center gap-2">
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
                Show on every card · latest 4 show
              </p>
              <div className="flex flex-col gap-2.5">
                {FIELDS.map((f) => (
                  <label
                    key={f.id}
                    className="flex cursor-pointer items-center gap-2 text-[13px] font-bold"
                  >
                    <Checkbox
                      checked={fields.includes(f.id)}
                      onCheckedChange={() => toggleField(f.id)}
                    />
                    {f.label}
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
