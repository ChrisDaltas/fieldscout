'use client'

import { useEffect, useMemo, useState } from 'react'

import { statusTag } from '@/components/leagues/my-team-ops'
import { ListPickerSheet } from '@/components/mobile/player/list-picker-sheet'
import { M_ICON, MIcon } from '@/components/mobile/ui/m-icon'
import { HeaderIconButton, MobileScreen } from '@/components/mobile/ui/mobile-header'
import { useFavoritePlayerIds, useToggleFavorite } from '@/hooks/use-favorites'
import { useMobilePlayerUsage, useMobileResearchPool, type ResearchPlayer } from '@/hooks/use-mobile-players-data'
import { RESEARCH_DEFAULTS, useMobilePlayersUI, type ResearchScoring, type ResearchSeason } from '@/hooks/use-mobile-players-ui'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'
import { shortPlayerName } from '@/utils/format-name'

import { FilterBar, ListHeader, Notice, PathIcon, ProblemState, RowsSkeleton, ShowMore, type FilterPill } from './players-chrome'
import {
  BLANK,
  colNeeds,
  NFL_TEAMS,
  num1,
  PAGE,
  POS_OPTIONS,
  posMatches,
  rankCell,
  sortAfterToggle,
  sortByCell,
  STAT_FIELDS,
  statCells,
  toggleCol,
  type Cell,
  type ColKey,
  type MPos,
  type StatLine,
} from './players-ops'
import { ColumnTip, CustomizeSheet } from './players-overlays'
import { PlayersRows, type ViewRow } from './players-views'

/**
 * FieldScout Mobile — the account Players tab (`/app/research`, and
 * `/app/players`, which renders the same table). The handoff has no account
 * Players screen (its tab only toasts "soon"), but the app has a real
 * research table, so it gets the League › Players treatment — filter pills,
 * List / Cards / Sheet, Customize stats, the column tip — without league
 * actions. The row's action slot keeps the desktop table's two controls:
 * the favourites star (`useFavoritePlayerIds` / `useToggleFavorite`) and
 * add-to-list (the mobile `ListPickerSheet`, the profile's own picker).
 *
 * Data: `/api/players/builder` for the WHOLE active pool in the chosen
 * scoring (the research table's own read), so ranks are over everyone and
 * the filters are instant; season `player_usage` for snap % / target share.
 */

const SCORING: ReadonlyArray<{ value: ResearchScoring; label: string }> = [
  { value: 'ppr', label: 'PPR' },
  { value: 'half_ppr', label: 'Half-PPR' },
  { value: 'standard', label: 'Standard' },
]

const POS_TITLE: Record<MPos, string> = {
  All: 'All players',
  QB: 'Quarterbacks',
  RB: 'Running backs',
  WR: 'Wide receivers',
  TE: 'Tight ends',
  FLEX: 'Flex',
  K: 'Kickers',
  'D/ST': 'Defenses',
}

/** `?position=` on the research routes uses the app's spelling (DEF). */
export function researchPosFromParam(param: string | null): MPos | null {
  if (!param) return null
  if (param === 'DEF') return 'D/ST'
  return (POS_OPTIONS as readonly string[]).includes(param) ? (param as MPos) : null
}

function lineOf(stats: Record<string, number> | undefined, games: number): StatLine | null {
  if (!stats || games === 0) return null
  const line = { games } as StatLine
  for (const f of STAT_FIELDS) line[f] = Number(stats[f] ?? 0) || 0
  return line
}

export function ResearchPlayersScreen({ initialPosition = null }: { initialPosition?: MPos | null }) {
  const openPlayerView = usePlayerModalStore((s) => s.openPlayerView)
  const ui = useMobilePlayersUI((s) => s.research)
  const setUi = useMobilePlayersUI((s) => s.setResearch)
  const [menu, setMenu] = useState<string | null>(null)
  const [tip, setTip] = useState<ColKey | null>(null)
  const [customize, setCustomize] = useState(false)
  const [searching, setSearching] = useState(ui.query !== '')
  const [shown, setShown] = useState(PAGE)
  const [listFor, setListFor] = useState<{ id: string; name: string } | null>(null)
  const favorites = useFavoritePlayerIds()
  const toggleFavorite = useToggleFavorite()

  useEffect(() => {
    if (initialPosition) setUi({ pos: initialPosition })
  }, [initialPosition, setUi])

  const pool = useMobileResearchPool(ui.scoring)
  // The seasons come from the read — never a guessed year before it lands.
  const seasons = pool.data?.season ?? null
  const seasonYear = seasons ? (ui.season === 'current' ? seasons.current : seasons.last) : null
  const players = useMemo(() => pool.data?.players ?? [], [pool.data])
  const allIds = useMemo(() => players.map((p) => p.id), [players])
  const needs = colNeeds(ui.cols, ui.sort)
  const usage = useMobilePlayerUsage(needs.usage && seasonYear !== null ? seasonYear : undefined, allIds)

  const ptsOf = (p: ResearchPlayer) => (ui.season === 'current' ? p.current_pts : p.last_pts)
  const gamesOf = (p: ResearchPlayer) => (ui.season === 'current' ? p.current_games : p.last_games)

  // Position and overall ranks in total points, over the whole pool (only
  // players who played in the season are ranked).
  const ranks = useMemo(() => {
    const played = players.filter((p) => gamesOf(p) > 0).sort((a, b) => ptsOf(b) - ptsOf(a))
    const ovr = new Map<string, number>()
    const pos = new Map<string, number>()
    const count = new Map<string, number>()
    played.forEach((p, i) => {
      ovr.set(p.id, i + 1)
      const n = (count.get(p.position) ?? 0) + 1
      count.set(p.position, n)
      pos.set(p.id, n)
    })
    return { ovr, pos }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ptsOf / gamesOf read only ui.season
  }, [players, ui.season])

  const query = ui.query.trim().toLowerCase()
  const team = ui.team === 'All' ? null : ui.team
  const built: ViewRow[] = useMemo(
    () =>
      players
        .filter((p) => posMatches(ui.pos, p.position) && (!team || p.team === team) && (!query || p.full_name.toLowerCase().includes(query)))
        .map((p) => {
          const games = gamesOf(p)
          const pts = ptsOf(p)
          const stats = ui.season === 'current' ? p.stats_current : p.stats_last
          const posRank = ranks.pos.get(p.id) ?? null
          const cells: Partial<Record<ColKey, Cell>> = {
            proj: num1(p.projected_pts),
            avg: games > 0 ? num1(Math.round((pts / games) * 10) / 10) : BLANK,
            tot: games > 0 ? num1(pts) : BLANK,
            prk: rankCell(posRank, p.position === 'DEF' ? 'D' : p.position),
            ovr: rankCell(ranks.ovr.get(p.id) ?? null),
            ...statCells(p.position, lineOf(stats, games), usage.data?.get(p.id) ?? null),
          }
          const depth = p.depth_chart_position && p.depth_chart_order !== null ? `${p.depth_chart_position}${p.depth_chart_order}` : null
          const meta = `${depth ? `${depth} · ` : ''}${games === 0 ? 'No games' : `${games} ${games === 1 ? 'game' : 'games'}`} in ${seasonYear ?? ''}`
          return {
            id: p.id,
            player: p,
            short: shortPlayerName(p.full_name, p.position),
            status: statusTag(p.status),
            line2: meta,
            line3: null,
            cardLine: meta,
            cells,
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ptsOf / gamesOf read only ui.season
    [players, ui.pos, team, query, ui.season, ranks, usage.data, seasonYear],
  )
  const sorted = useMemo(() => sortByCell(built, (r) => r.cells[ui.sort] ?? BLANK), [built, ui.sort])
  const filterKey = `${ui.scoring}|${ui.season}|${ui.pos}|${ui.team}|${ui.sort}|${query}`
  useEffect(() => setShown(PAGE), [filterKey])
  const visible = sorted.slice(0, shown)

  const pills: FilterPill[] = [
    {
      key: 'scoring',
      label: SCORING.find((s) => s.value === ui.scoring)?.label ?? 'PPR',
      on: ui.scoring !== RESEARCH_DEFAULTS.scoring,
      title: 'Scoring',
      cols: 3,
      options: SCORING.map((s) => ({ value: s.value, label: s.label })),
      value: ui.scoring,
      canReset: ui.scoring !== RESEARCH_DEFAULTS.scoring,
      onPick: (v) => setUi({ scoring: v as ResearchScoring }),
      onReset: () => setUi({ scoring: RESEARCH_DEFAULTS.scoring }),
    },
    {
      key: 'season',
      label: seasonYear !== null ? String(seasonYear) : ui.season === 'current' ? 'This season' : 'Last season',
      on: ui.season !== RESEARCH_DEFAULTS.season,
      title: 'Stats for',
      cols: 2,
      options: [
        { value: 'current', label: seasons ? String(seasons.current) : 'This season' },
        { value: 'last', label: seasons ? String(seasons.last) : 'Last season' },
      ],
      value: ui.season,
      canReset: ui.season !== RESEARCH_DEFAULTS.season,
      onPick: (v) => setUi({ season: v as ResearchSeason }),
      onReset: () => setUi({ season: RESEARCH_DEFAULTS.season }),
    },
    {
      key: 'pos',
      label: ui.pos === 'All' ? 'Position' : ui.pos,
      on: ui.pos !== 'All',
      title: 'Position',
      cols: 4,
      options: POS_OPTIONS.map((p) => ({ value: p, label: p })),
      value: ui.pos,
      canReset: ui.pos !== 'All',
      onPick: (v) => setUi({ pos: v as MPos }),
      onReset: () => setUi({ pos: 'All' }),
    },
    {
      key: 'team',
      label: ui.team === 'All' ? 'Teams' : ui.team,
      on: ui.team !== 'All',
      title: 'NFL team',
      cols: 4,
      options: [{ value: 'All', label: 'All teams' }, ...NFL_TEAMS.map((t) => ({ value: t, label: t }))],
      value: ui.team,
      canReset: ui.team !== 'All',
      onPick: (v) => setUi({ team: v }),
      onReset: () => setUi({ team: 'All' }),
    },
  ]

  const titleRow = searching ? (
    <div className="flex h-12 items-center gap-2.5 px-4">
      <label className="flex h-[38px] min-w-0 flex-1 items-center gap-2 rounded-[12px] bg-m-b2 px-3">
        <MIcon name="search" size={15} stroke={1.6} className="text-m-t4" />
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the search mode opens on the user's tap; the field is its whole purpose
          autoFocus
          value={ui.query}
          onChange={(e) => setUi({ query: e.target.value })}
          placeholder="Search players"
          aria-label="Search players"
          className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-m-t1 outline-none placeholder:text-m-t4"
        />
      </label>
      <button
        type="button"
        onClick={() => {
          setSearching(false)
          setUi({ query: '' })
        }}
        className="flex-none text-[15px] font-medium text-accent"
      >
        Cancel
      </button>
    </div>
  ) : (
    <div className="flex h-12 items-center gap-2 pl-4 pr-3">
      <h1 className="min-w-0 flex-1 truncate text-[28px] font-semibold tracking-[-0.03em] text-m-t1">Players</h1>
      <HeaderIconButton icon="search" label="Search players" onClick={() => setSearching(true)} stroke={1.6} />
    </div>
  )

  // The favourites star needs the set first: the server TOGGLES, so a press
  // before the set has loaded could undo a favourite it can't see.
  const favReady = favorites.data !== undefined
  const renderAction = (row: ViewRow, size: 28 | 22) => {
    const name = row.player.full_name
    const on = favorites.data?.has(row.id) ?? false
    return (
      <span className="flex flex-none items-center gap-1">
        <button
          type="button"
          disabled={!favReady}
          aria-pressed={on}
          aria-label={on ? `Remove ${name} from favorites` : `Save ${name} to favorites`}
          title={on ? 'In favorites' : 'Save to favorites'}
          onClick={() =>
            toggleFavorite.mutate(
              { playerId: row.id, favorited: on },
              { onError: () => toast({ title: 'Couldn’t update favorites', description: name, variant: 'destructive' }) },
            )
          }
          className={cn(
            'flex flex-none items-center justify-center rounded-full disabled:opacity-40',
            size === 28 ? 'size-7' : 'size-[22px]',
            on ? 'text-accent' : 'text-m-t4',
          )}
          data-favorite={on || undefined}
        >
          <PathIcon d={M_ICON.star} size={size === 28 ? 15 : 12} stroke={1.6} filled={on} />
        </button>
        <button
          type="button"
          onClick={() => setListFor({ id: row.id, name })}
          aria-label={`Add ${name} to a list`}
          title="Add to a list"
          className={cn('flex flex-none items-center justify-center rounded-full bg-m-b2 text-m-t1 active:bg-m-b2h', size === 28 ? 'size-7' : 'size-[22px]')}
        >
          <MIcon name="add" size={size === 28 ? 13 : 11} stroke={2.2} />
        </button>
      </span>
    )
  }

  const loading = pool.isPending && !pool.data
  const problem = pool.isError && !pool.data

  return (
    <MobileScreen
      header={
        <>
          {titleRow}
          <FilterBar pills={pills} open={menu} onOpenChange={setMenu} />
        </>
      }
    >
      {usage.isError && <Notice tone="caution">Snap and target shares couldn’t load — those columns show “–” until they do.</Notice>}
      {favorites.isError && (
        <Notice tone="caution" action={{ label: 'Try again', onClick: () => void favorites.refetch() }}>
          Your favorites couldn’t load — the stars are off until they do.
        </Notice>
      )}
      <ListHeader
        title={POS_TITLE[ui.pos]}
        count={loading || problem ? null : String(sorted.length)}
        updating={usage.isFetching && (usage.isPending || usage.isPlaceholderData)}
        view={ui.view}
        onView={(view) => setUi({ view })}
        onCustomize={() => setCustomize(true)}
      />
      {problem ? (
        <ProblemState title="Couldn’t load the players." detail={pool.error instanceof Error ? pool.error.message : null} onRetry={() => void pool.refetch()} />
      ) : loading ? (
        <RowsSkeleton />
      ) : (
        <>
          <PlayersRows
            view={ui.view}
            rows={visible}
            cols={ui.cols}
            sort={ui.sort}
            action={renderAction}
            actionSlots={2}
            onOpen={(row) => openPlayerView(row.id)}
            onTip={setTip}
            emptyText={query ? `No players match “${ui.query.trim()}”` : undefined}
          />
          <ShowMore remaining={sorted.length - visible.length} onMore={() => setShown((n) => n + PAGE)} />
        </>
      )}
      <ColumnTip colKey={tip} surface="research" sort={ui.sort} onSort={(sort) => setUi({ sort })} onClose={() => setTip(null)} />
      <CustomizeSheet
        open={customize}
        onOpenChange={setCustomize}
        surface="research"
        cols={ui.cols}
        onToggle={(key) => {
          const cols = toggleCol(ui.cols, key, 'research')
          setUi({ cols, sort: sortAfterToggle(cols, ui.sort) })
        }}
      />
      {listFor && (
        <ListPickerSheet
          open
          onOpenChange={(o) => !o && setListFor(null)}
          playerId={listFor.id}
          playerName={listFor.name}
          listContext={null}
          onRemoved={() => setListFor(null)}
        />
      )}
    </MobileScreen>
  )
}
