'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core'

import { useShowMovement } from '@/components/mobile/rankings/movement-pref'
import { carryBoard, boardFor } from '@/components/mobile/rankings/new-ranking'
import {
  MovementMark,
  MovementSwitch,
  RkIcon,
  RK_ICON,
  StatCells,
  statCells,
} from '@/components/mobile/rankings/rank-parts'
import {
  RANK_SCORINGS,
  afterPublish,
  backAction,
  dbPos,
  editorMovement,
  editorMovementAvailable,
  formatSaved,
  fromDbPos,
  moveItem,
  onBye,
  opensInWeek,
  orderChanged,
  plural,
  publishButtonLabel,
  rankPosLabel,
  rankingExists,
  rankingScoring,
  rankingTitle,
  scoringChanged,
  scoringFromFormat,
  scoringLabel,
  seasonLabel,
  seasonSub,
  weekOf,
  weekStatus,
  weeklySub,
  type Movement,
  type RankFrom,
  type RankPos,
  type RankType,
  type Scoring,
  type WeekGameLite,
} from '@/components/mobile/rankings/rankings-ops'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MPosChip, posTextClass } from '@/components/mobile/ui/m-pos-chip'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { useWeeklyBigBoard } from '@/hooks/use-big-board'
import { NFL_SEASON, latestSaved, useMyRankingBoards, useSeasonBoard } from '@/hooks/use-mobile-rankings-boards'
import { useSaveRankingSlice } from '@/hooks/use-mobile-rankings-save'
import {
  sourceDraft,
  useExpertsSource,
  usePositionPool,
  useUsersSource,
  type PoolStat,
} from '@/hooks/use-mobile-rankings-sources'
import { useNflWeekGames } from '@/hooks/use-nfl-week-games'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'
import { shortPlayerName } from '@/utils/format-name'

/**
 * Ranking editor (lr-myrank §2.3) on a real board: one position's slice of
 * the season board or a weekly board. Whole-row drag (long-press on touch)
 * and Add players. Past weeks open read-only (Finalized); this week and the
 * next three are editable; later weeks are locked and never fetched.
 *
 * Publishing (Chris, 2026-10-15): the one commit button is "Publish" (a
 * ranking that doesn't exist yet) or "Publish updates". Publish is the
 * app's save — through the same routes desktop uses — and a saved ranking
 * is the one that counts, so there is no "save without publishing". Back
 * discards anything unpublished: with changes it asks first ("Discard
 * changes?"). Leaving waits while a publish is running, so a publish never
 * carries on behind a "Discard".
 *
 * Movement (Chris, 2026-10-15, gap list #33): ▲3 / ▼2 beside each player —
 * OFF by default while you make or edit your own ranking, behind a "Show
 * movement" switch remembered on this device. It measures the version on
 * screen against the one before: with nothing unpublished, the published
 * ranking against its previous update (what others see); with changes, the
 * draft against what's published (what Publish will record).
 *
 * Scoring (#36): the pill on the tool row picks the scoring the stats show
 * and the ranking is published for — the board's saved one when it has one,
 * else Half PPR (Chris, 2026-10-16: "if no scoring type is selected, default
 * to half point ppr"); the Rankings screen's scoring filter never picks it.
 * It is saved by Publish. On a published ranking a picked scoring that
 * differs from the ranking's is itself a change to publish ("Publish
 * updates", and Back asks first), so a wrong tag can be fixed without
 * moving a player; with the order unchanged, Publish saves only the scoring
 * and leaves the order — and its movement — alone.
 *
 * "Publish" vs "Publish updates" is about whether a ranking already exists
 * at the position, not where the draft started: starting from the experts
 * over a ranking you have publishes updates to it. (Someone else's ranking
 * is never a start.)
 *
 * A NEW ranking (from New ranking step 2, or a week that has no board yet)
 * exists only on the phone until Publish (C1):
 * nothing is created by opening it, Publish is blue from the start, and
 * backing out drops it. A week's board is only created by its first Publish.
 *
 * The app has nowhere to keep tier lines or a custom title, so the editor
 * offers neither (Auto tiers, Add tier line, tier lines and the title input
 * are design gaps) — it never shows an edit that Publish would silently drop.
 */

interface EditorPlayer {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  bye_week: number | null
}

interface BoardEntryLike {
  player_id: string
  player: {
    id: string
    full_name: string
    position: string
    team: string | null
    headshot_url: string | null
    bye_week?: number | null
  }
}

function asEditorPlayer(p: {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  bye_week?: number | null
}): EditorPlayer {
  return {
    id: p.id,
    full_name: p.full_name,
    position: p.position,
    team: p.team,
    headshot_url: p.headshot_url,
    bye_week: p.bye_week ?? null,
  }
}

export interface RankingEditorProps {
  type: RankType
  pos: RankPos
  /** Where a new (unpublished) ranking starts from; null = the published one. */
  from: RankFrom | null
  currentWeek: number
  /** Bumped when browser / OS Back tried to leave with unpublished changes. */
  promptSeq: number
  onDirtyChange: (dirty: boolean) => void
  onBack: () => void
  /** Called after a publish, so the URL can drop `from`. */
  onPublished: () => void
}

export function RankingEditor({
  type,
  pos,
  from,
  currentWeek,
  promptSeq,
  onDirtyChange,
  onBack,
  onPublished,
}: RankingEditorProps) {
  const status = weekStatus(type, currentWeek)
  const week = weekOf(type)
  const isSeason = type === 'season'
  const readOnly = status === 'past'
  const locked = status === 'future'

  // ---- which board, and does it exist yet? ---------------------------------
  // `useMyRankingBoards` reads `big_board_weekly` directly, so knowing
  // whether a week has a board never creates one.
  const boards = useMyRankingBoards()
  const known = isSeason || boards.data !== undefined
  const exists = isSeason || boardFor(boards.data, type) !== null
  // A week with no board starts as a new ranking from what the app would
  // seed it with — your latest ranking — until Publish creates it.
  const effFrom: RankFrom | null =
    from ?? (known && !exists && (status === 'current' || status === 'upcoming') ? 'carry' : null)

  // The scoring this ranking is made for: picked here, else the board's
  // saved one, else Half PPR.
  const myBoard = boardFor(boards.data, type)
  const [pickedScoring, setPickedScoring] = useState<Scoring | null>(null)
  /** The scoring this session's publish saved (until the boards refetch). */
  const [publishedScoring, setPublishedScoring] = useState<Scoring | null>(null)
  const savedScoring = publishedScoring ?? scoringFromFormat(myBoard?.scoringFormat)
  const scoring: Scoring = rankingScoring(pickedScoring, savedScoring)

  const seasonQ = useSeasonBoard(isSeason && !locked)
  const weeklyQ = useWeeklyBigBoard(!isSeason && !locked && known && exists ? week : -1)
  const boardQ = isSeason ? seasonQ : weeklyQ

  const pool = usePositionPool(dbPos(pos), scoring, !locked)
  const weeklyGames = !isSeason && !locked
  const games = useNflWeekGames(weeklyGames ? NFL_SEASON : undefined, weeklyGames ? week : undefined)
  const experts = useExpertsSource(pos, effFrom === 'experts')
  const users = useUsersSource(pos, effFrom === 'users')

  const saveSlice = useSaveRankingSlice()
  const saving = saveSlice.isPending

  // ---- server board -------------------------------------------------------
  const boardEntries = useMemo(() => (boardQ.data?.players ?? []) as unknown as BoardEntryLike[], [boardQ.data])
  const boardPlayers = useMemo(() => {
    const m = new Map<string, EditorPlayer>()
    for (const e of boardEntries) m.set(e.player_id, asEditorPlayer(e.player))
    return m
  }, [boardEntries])

  // ---- local draft --------------------------------------------------------
  const [items, setItems] = useState<string[] | null>(null)
  /** The order the draft is measured against: the published slice, or
   *  empty for a draft started from somewhere (any players = publishable). */
  const [savedSeq, setSavedSeq] = useState<string[]>([])
  const [extra, setExtra] = useState<Map<string, EditorPlayer>>(new Map())
  /** null until a publish in this session; then whether a ranking exists. */
  const [publishedHere, setPublishedHere] = useState<boolean | null>(null)
  const [startedFrom, setStartedFrom] = useState<string | null>(null)
  const initialized = useRef(false)

  // The season board seeds itself on its first read: refresh My rankings'
  // cards whenever the editor closes.
  const qc = useQueryClient()
  useEffect(() => () => void qc.invalidateQueries({ queryKey: ['mobile-rankings', 'boards'] }), [qc])

  const sourcesReady =
    effFrom === null
      ? Boolean(boardQ.data) || (!isSeason && known && !exists)
      : effFrom === 'carry'
        ? known
        : effFrom === 'blank'
          ? true
          : effFrom === 'experts'
            ? Boolean(experts.data) && (isSeason || !games.isPending)
            : Boolean(users.data) && (isSeason || !games.isPending)
  const ready = !locked && known && sourcesReady

  useEffect(() => {
    if (!ready || initialized.current) return
    initialized.current = true

    const sliceOf = (rows: ReadonlyArray<{ player_id: string; player: { position: string } }>) =>
      rows.filter((r) => fromDbPos(r.player.position) === pos).map((r) => r.player_id)
    const extras = new Map<string, EditorPlayer>()
    let seq: string[] = []
    let label: string | null = null

    if (effFrom === null) {
      seq = sliceOf(boardEntries)
    } else if (effFrom === 'carry') {
      const carry = carryBoard(boards.data, week)
      const rows = (carry?.players ?? []).filter((r) => fromDbPos(r.player.position) === pos)
      for (const r of rows) extras.set(r.player_id, asEditorPlayer(r.player))
      seq = rows.map((r) => r.player_id)
      label = carry && carry.week > 0 ? `your Week ${carry.week} ranking` : `your ${seasonLabel(currentWeek).toLowerCase()} ranking`
    } else if (effFrom === 'blank') {
      label = 'blank'
    } else {
      const draft = sourceDraft(effFrom === 'experts' ? experts.data?.rows : users.data, !isSeason, games.data)
      for (const p of draft) extras.set(p.id, asEditorPlayer(p))
      seq = draft.map((p) => p.id)
      label = effFrom === 'experts' ? 'Experts' : 'Users'
    }

    setExtra(extras)
    setItems(seq)
    setSavedSeq(effFrom === null ? seq : [])
    setStartedFrom(label)
  }, [ready, effFrom, boardEntries, boards.data, week, pos, currentWeek, isSeason, experts.data, users.data, games.data])

  const seq = useMemo(() => items ?? [], [items])
  const orderDirty = !readOnly && items !== null && orderChanged(seq, savedSeq)

  // Is a ranking published at this position? Read from the server's boards
  // (the season board's own read once it's in, since that GET seeds it),
  // never from where the draft started. Until the boards are known, a
  // ranking opened as-is is assumed to exist and one started from
  // somewhere to be new — only the inert pill reads it in that moment.
  const existsKnown = isSeason ? boardQ.data !== undefined || boards.data !== undefined : known
  const serverRows = isSeason && boardQ.data ? boardEntries : (boardFor(boards.data, type)?.players ?? [])
  const hasRanking = existsKnown
    ? rankingExists(serverRows, pos, publishedHere)
    : (publishedHere ?? effFrom === null)

  // A changed scoring is a change to publish on its own (#36) — only where
  // the board can keep one (its read carries the column: migration 190).
  const scoringDirty =
    !readOnly &&
    items !== null &&
    scoringChanged({
      picked: pickedScoring,
      saved: savedScoring,
      savable: myBoard !== null && myBoard.scoringFormat !== undefined,
      hasRanking,
    })
  const dirty = orderDirty || scoringDirty

  // The area's guard needs to know (browser / OS Back), and so does the
  // browser itself (reload, closing the tab).
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  useEffect(() => {
    if (!dirty) return
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [dirty])

  const playerOf = (id: string): EditorPlayer | undefined => {
    const b = boardPlayers.get(id) ?? extra.get(id)
    if (b) return b
    const s = pool.data?.get(id)
    return s
      ? { id: s.id, full_name: s.full_name, position: s.position, team: s.team, headshot_url: s.headshot_url, bye_week: null }
      : undefined
  }

  // ---- actions --------------------------------------------------------------
  const [sheet, setSheet] = useState<null | 'add' | 'scoring'>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)

  // Browser / OS Back left with unpublished changes: the area put the
  // editor back — ask what to do.
  const lastPrompt = useRef(promptSeq)
  useEffect(() => {
    if (promptSeq === lastPrompt.current) return
    lastPrompt.current = promptSeq
    setSheet(null)
    setConfirmLeave(true)
  }, [promptSeq])

  // Publish = the app's save (there is no separate submit step). The hook
  // reports the outcome (toast), even if the editor has closed by then.
  const publish = () => {
    if (!dirty || saving) return
    const next = seq
    // Only the scoring changed: save just that — re-sending the order would
    // reset every previous position and wipe the movement arrows.
    const scoringOnly = !orderDirty && myBoard ? { listId: myBoard.listId } : undefined
    saveSlice.mutate(
      { week: isSeason ? 0 : week, pos, next, isNew: !hasRanking, scoring, scoringOnly },
      {
        onSuccess: (data) => {
          // Nothing unpublished now.
          if (!scoringOnly) {
            const after = afterPublish(next)
            setSavedSeq(after.savedSeq)
            setPublishedHere(after.hasRanking)
          }
          // A scoring the server failed to save stays a change to publish
          // (the toast says so).
          if (!data.scoringError) setPublishedScoring(scoring)
          // A Back that came in mid-publish has nothing left to discard.
          setConfirmLeave(false)
          // Only an order publish publishes the draft (the URL drops `from`).
          if (!scoringOnly) onPublished()
        },
      },
    )
  }

  const togglePlayer = (id: string) =>
    setItems((cur) => {
      const list = cur ?? []
      return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
    })

  const back = () => {
    const action = backAction({ dirty, publishing: saving })
    if (action === 'ask') setConfirmLeave(true)
    else if (action === 'leave') onBack()
  }

  // ---- drag ---------------------------------------------------------------
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  )
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  // A drag ends in a click on some browsers; ignore taps right after one.
  const lastDragEnd = useRef(0)

  const onDragStart = (e: DragStartEvent) => {
    setDragId(String(e.active.id))
    setDropAt(null)
  }
  const onDragMove = (e: DragMoveEvent) => {
    const { active, over } = e
    if (!over || !items) return
    const overIdx = items.indexOf(String(over.id))
    const rect = active.rect.current.translated
    if (overIdx < 0 || !rect) return
    const before = rect.top + rect.height / 2 < over.rect.top + over.rect.height / 2
    const next = before ? overIdx : overIdx + 1
    if (next !== dropAt) setDropAt(next)
  }
  const endDrag = () => {
    if (dragId && dropAt !== null && items) setItems(moveItem(items, items.indexOf(dragId), dropAt))
    setDragId(null)
    setDropAt(null)
    lastDragEnd.current = Date.now()
  }
  const cancelDrag = () => {
    setDragId(null)
    setDropAt(null)
    lastDragEnd.current = Date.now()
  }

  // ---- movement (gap list #33) ---------------------------------------------
  // Measured against the server's boards (one read for the order AND its
  // previous positions, so the two never disagree mid-refetch).
  const [showMovement, setShowMovement] = useShowMovement('own')
  const published = useMemo(
    () =>
      (boardFor(boards.data, type)?.players ?? [])
        .filter((r) => fromDbPos(r.player.position) === pos)
        .map((r) => ({ id: r.player_id, prev: r.previous_position })),
    [boards.data, type, pos],
  )
  const movement = useMemo(() => editorMovement(seq, published), [seq, published])
  // The switch only where there's a version to compare with: a draft that
  // reorders, or a previous update stored on the published ranking.
  const movementAvailable = editorMovementAvailable(published, orderDirty)
  const marks = movementAvailable && showMovement ? movement : undefined
  const reserveMark = marks !== undefined && [...marks.values()].some((m) => m !== 0)

  // ---- derived rows -------------------------------------------------------
  const fromIdx = dragId ? seq.indexOf(dragId) : -1
  const lineAt = dropAt !== null && dropAt !== fromIdx && dropAt !== fromIdx + 1 ? dropAt : null

  const openPlayer = usePlayerModalStore((s) => s.openPlayerView)
  const sub = (p: EditorPlayer) => (isSeason ? seasonSub(p.team, p.bye_week) : weeklySub(p.team, games.data))

  const savedStamp = useMemo(() => {
    const b = boardFor(boards.data, type)
    return formatSaved(latestSaved((b?.players ?? []).filter((r) => fromDbPos(r.player.position) === pos)))
  }, [boards.data, type, pos])

  const title = rankingTitle(type, pos, currentWeek)
  const playerCount = seq.length
  const missingPast = readOnly && known && !exists
  const info = readOnly
    ? `${plural(playerCount, 'player')} · view only`
    : `${plural(playerCount, 'player')} · drag to reorder${startedFrom ? ` · started from ${startedFrom}` : ''}`

  const footer =
    locked || missingPast
      ? null
      : readOnly
        ? { label: 'Finalized', cls: 'text-m-green', sub: `Week ${week} is over · can't be edited` }
        : saving
          ? {
              label: 'Publishing…',
              cls: 'text-m-t1',
              sub: !hasRanking ? 'Publishing your ranking' : orderDirty ? 'Publishing your new order' : 'Publishing its scoring',
            }
          : dirty
            ? {
                label: 'Unpublished changes',
                cls: 'text-m-to',
                sub: hasRanking ? 'Publish updates to keep them' : 'Publish to keep this ranking',
              }
            : !hasRanking
              ? { label: 'Not published yet', cls: 'text-m-t1', sub: 'Add players to publish this ranking' }
              : {
                  label: publishedHere !== null
                    ? 'Published just now'
                    : savedStamp
                      ? `Published ${savedStamp === 'Just now' ? 'just now' : savedStamp}`
                      : 'Published',
                  cls: 'text-m-t1',
                  sub: isSeason ? 'Your draft room uses this order' : `Locks once Week ${week} is played`,
                }

  const loadError =
    !locked &&
    ((boards.isError && !isSeason) ||
      boardQ.isError || (effFrom === 'experts' && experts.isError) || (effFrom === 'users' && users.isError))
  const retry = () => {
    if (boards.isError) void boards.refetch()
    if (boardQ.isError) void boardQ.refetch()
    if (experts.isError) experts.refetch()
    if (users.isError) void users.refetch()
  }
  const loading = !locked && !missingPast && items === null
  const dragPlayer = dragId ? playerOf(dragId) : undefined
  const dragRank = dragId ? seq.indexOf(dragId) + 1 : 0
  const pill = publishButtonLabel({ readOnly, isNew: !hasRanking, dirty, publishing: saving })

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-m-b0 pt-[env(safe-area-inset-top)] text-m-t1" role="dialog" aria-label={title}>
      <div className="flex h-[52px] flex-none items-center gap-2 px-3">
        <button
          type="button"
          onClick={back}
          disabled={saving}
          aria-label="Back"
          className="flex size-9 flex-none items-center justify-center rounded-full text-m-t1 disabled:text-m-t4"
        >
          <RkIcon d={RK_ICON.back} size={16} stroke={2} />
        </button>
        <div role="heading" aria-level={1} className="min-w-0 flex-1 truncate text-center text-[16px] font-semibold">
          {title}
        </div>
        {!locked && !missingPast && (
          <button
            type="button"
            onClick={publish}
            disabled={!dirty || saving}
            className={cn(
              'flex h-8 flex-none items-center whitespace-nowrap rounded-pill px-3.5 text-[13px] font-semibold',
              dirty ? 'bg-accent text-white' : 'bg-m-b2 text-m-t3',
            )}
          >
            {pill}
          </button>
        )}
      </div>

      {!locked && !missingPast && (
        <div className="flex flex-none flex-col gap-2.5 border-b border-m-b3 px-4 pb-2.5">
          {(!readOnly || movementAvailable) && (
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
              {!readOnly && <ToolChip icon={RK_ICON.plus} label="Add players" onClick={() => setSheet('add')} />}
              {!readOnly && (
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-label={`Scoring: ${scoringLabel(scoring)}`}
                  onClick={() => setSheet('scoring')}
                  className="flex h-[30px] flex-none items-center gap-[5px] whitespace-nowrap rounded-pill bg-m-b2 pl-3 pr-2.5 text-[12px] font-semibold text-m-t1"
                >
                  {scoringLabel(scoring)}
                  <RkIcon d={RK_ICON.chevronDown} size={10} stroke={2.4} />
                </button>
              )}
              {movementAvailable && <MovementSwitch on={showMovement} onChange={setShowMovement} />}
            </div>
          )}
          <span className="text-[11px] font-medium text-m-t3">{info}</span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-1 scrollbar-none">
        {locked ? (
          <Centered
            title={`Week ${week} isn't open yet`}
            sub={`You can rank this week and the next three. This one opens in Week ${opensInWeek(week)}.`}
          />
        ) : missingPast ? (
          <Centered title={`No Week ${week} ranking`} sub={`Week ${week} is over, so it can't be started now.`} />
        ) : loadError && items === null ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <span className="text-[13px] font-medium text-m-t3">Couldn&apos;t load this ranking.</span>
            <button type="button" onClick={retry} className="text-[13px] font-semibold text-accent">
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="flex flex-col gap-1.5 pt-2.5" aria-busy="true" aria-label="Loading ranking">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="h-[46px] rounded-[14px] bg-m-b1" />
            ))}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={endDrag}
            onDragCancel={cancelDrag}
          >
            {playerCount === 0 && (
              <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
                <span className="text-[15px] font-semibold">No players yet</span>
                <span className="text-pretty text-[13px] font-medium leading-[1.4] text-m-t3">
                  {readOnly
                    ? 'Nothing was ranked at this position.'
                    : 'Add players one at a time, or go back and start from the experts.'}
                </span>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setSheet('add')}
                    className="flex h-10 items-center rounded-pill bg-accent px-[18px] text-[14px] font-semibold text-white"
                  >
                    Add players
                  </button>
                )}
              </div>
            )}
            {seq.map((id, i) => {
              const p = playerOf(id)
              if (!p) return null
              const rank = i + 1
              return (
                <DragRow
                  key={id}
                  id={id}
                  disabled={readOnly}
                  lineTop={lineAt === i}
                  lineBottom={lineAt === seq.length && i === seq.length - 1}
                  dimmed={dragId === id}
                >
                  <PlayerLine
                    rank={rank}
                    player={p}
                    sub={sub(p)}
                    stat={pool.data?.get(p.id)}
                    movement={marks?.get(p.id)}
                    reserveMark={reserveMark}
                    grab={!readOnly}
                    onOpen={() => {
                      if (Date.now() - lastDragEnd.current > 400) openPlayer(p.id)
                    }}
                  />
                </DragRow>
              )
            })}
            <DragOverlay dropAnimation={null}>
              {dragPlayer ? (
                // A drag ghost genuinely floats over the list — the elevation
                // rule's overlay exception, so it keeps a resting shadow.
                <div className="rounded-[10px] bg-m-b0 shadow-m-menu">
                  <PlayerLine
                    rank={dragRank}
                    player={dragPlayer}
                    sub={sub(dragPlayer)}
                    stat={pool.data?.get(dragPlayer.id)}
                    movement={marks?.get(dragPlayer.id)}
                    reserveMark={reserveMark}
                    grab
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {footer && (
        <div className="flex flex-none items-center gap-3 border-t border-m-b3 bg-m-b0 px-4 pb-[30px] pt-2.5">
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className={cn('text-[13px] font-semibold', footer.cls)}>{footer.label}</span>
            <span className="text-[11px] font-medium text-m-t3">{footer.sub}</span>
          </span>
        </div>
      )}

      <MobileSheet
        open={sheet === 'scoring'}
        onOpenChange={(o) => {
          if (!o) setSheet(null)
        }}
        title="Scoring"
        subtitle="The stats follow it, and Publish saves it with this ranking."
        showClose
      >
        <div className="grid grid-cols-2 gap-1.5 px-4 pb-[30px]">
          {RANK_SCORINGS.map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={scoring === o.key}
              onClick={() => {
                setPickedScoring(o.key)
                setSheet(null)
              }}
              className={cn(
                'flex h-[44px] items-center justify-center rounded-[12px] px-2.5 text-[14px] font-semibold',
                scoring === o.key ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </MobileSheet>

      <AddPlayersSheet
        open={sheet === 'add'}
        onOpenChange={(o) => {
          if (!o) setSheet(null)
        }}
        pos={pos}
        weekGames={isSeason ? undefined : games.data}
        pool={pool.data}
        poolPending={pool.isPending}
        inRanking={new Set(seq)}
        count={playerCount}
        onToggle={togglePlayer}
      />

      <MobileSheet
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Discard changes?"
        subtitle={
          saving
            ? 'Publishing your changes…'
            : hasRanking
              ? "Your changes haven't been published."
              : "This ranking hasn't been published."
        }
        footer={
          <div className="flex flex-col gap-2 px-4 pb-[30px] pt-1">
            <button
              type="button"
              onClick={() => setConfirmLeave(false)}
              className="flex h-12 items-center justify-center rounded-[14px] bg-accent text-[15px] font-semibold text-white"
            >
              Keep editing
            </button>
            {/* Not mid-publish: a Discard then would close the editor while
                the publish carries on. Browser / OS Back can open this
                sheet during one; it closes itself once the publish lands. */}
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                if (backAction({ dirty, publishing: saving }) === 'wait') return
                setConfirmLeave(false)
                onBack()
              }}
              className="flex h-12 items-center justify-center rounded-[14px] bg-m-b2 text-[15px] font-semibold text-m-red disabled:text-m-t4"
            >
              Discard
            </button>
          </div>
        }
      >
        <span className="sr-only">Leaving now drops the changes you haven&apos;t published.</span>
      </MobileSheet>
    </div>
  )
}

function Centered({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
      <span className="text-[15px] font-semibold">{title}</span>
      <span className="text-pretty text-[13px] font-medium leading-[1.4] text-m-t3">{sub}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function DragRow({
  id,
  disabled,
  lineTop,
  lineBottom,
  dimmed,
  children,
}: {
  id: string
  disabled: boolean
  lineTop: boolean
  lineBottom: boolean
  dimmed: boolean
  children: React.ReactNode
}) {
  const drag = useDraggable({ id, disabled })
  const drop = useDroppable({ id, disabled })
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el)
        drop.setNodeRef(el)
      }}
      {...drag.listeners}
      className={cn(
        'relative touch-manipulation select-none rounded-[10px] [-webkit-touch-callout:none]',
        dimmed && 'opacity-40',
      )}
    >
      {/* Drop line: where the dragged row will land. */}
      {lineTop && <span aria-hidden className="absolute inset-x-0 top-0 z-[1] h-[2px] rounded-pill bg-accent" />}
      {children}
      {lineBottom && <span aria-hidden className="absolute inset-x-0 bottom-0 z-[1] h-[2px] rounded-pill bg-accent" />}
    </div>
  )
}

function PlayerLine({
  rank,
  player,
  sub,
  stat,
  movement,
  reserveMark,
  grab,
  onOpen,
}: {
  rank: number
  player: EditorPlayer
  sub: string
  stat: PoolStat | undefined
  /** Movement since the previous version, when "Show movement" is on. */
  movement: Movement | undefined
  /** Keep the movement column on every row so the stats line up. */
  reserveMark: boolean
  grab: boolean
  onOpen?: () => void
}) {
  const content = (
    <>
      <span className="w-[22px] flex-none text-center text-[14px] font-bold">{rank}</span>
      <MHeadshot player={player} size={26} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] font-semibold text-m-t1">{shortPlayerName(player.full_name, player.position)}</span>
        <span className="flex min-w-0 items-center gap-[5px] overflow-hidden whitespace-nowrap text-[11px] font-medium text-m-t3">
          <MPosChip pos={player.position} className="h-4 min-w-0 rounded-[4px] px-[5px] text-[9.5px]" />
          {sub}
        </span>
      </span>
      <StatCells cells={statCells(stat, player.position)} />
      {(reserveMark || (movement !== undefined && movement !== 0)) && (
        <span className="w-7 flex-none text-right text-[12px]">
          <MovementMark m={movement} className={movement === 'new' ? 'text-[10px]' : undefined} />
        </span>
      )}
    </>
  )
  const cls = cn(
    'flex min-h-[46px] w-full items-center gap-[9px] border-b border-m-b2 bg-m-b0 py-1 pl-1 pr-2 text-left',
    grab && 'cursor-grab',
  )
  return onOpen ? (
    <button type="button" onClick={onOpen} className={cls}>
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  )
}

function ToolChip({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[30px] flex-none items-center gap-[5px] whitespace-nowrap rounded-pill bg-m-b2 px-3 text-[12px] font-semibold text-m-t1"
    >
      <RkIcon d={icon} size={12} stroke={1.9} />
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Add players sheet (lr-myrank §2.4) — the position's whole pool, in
// projection order; a tap toggles the player in the draft.
//
// Gap list §3 #31: a ranking holds one position, so the design's "All" chip
// listed exactly what the position chip did — it's gone, and the position
// shows as the one (selected) chip. On a weekly ranking a player whose team
// has no game that week is marked "Bye" from the real schedule, the same
// test the editor's "KC · Bye" line uses; he can still be added (the mark
// says why he'd score nothing). Season rankings span every week, so nothing
// is marked, and neither is anyone while the week's schedule isn't on record.
// ---------------------------------------------------------------------------

export function AddPlayersSheet({
  open,
  onOpenChange,
  pos,
  weekGames,
  pool,
  poolPending,
  inRanking,
  count,
  onToggle,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  pos: RankPos
  /** The ranking week's games (weekly rankings only) — marks the byes. */
  weekGames: readonly WeekGameLite[] | undefined
  pool: Map<string, PoolStat> | undefined
  poolPending: boolean
  inRanking: Set<string>
  count: number
  onToggle: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const list = useMemo(() => {
    const all = Array.from(pool?.values() ?? [])
    if (!query) return all
    return all.filter((p) => p.full_name.toLowerCase().includes(query) || (p.team ?? '').toLowerCase() === query)
  }, [pool, query])

  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="Add players" subtitle={`${count} in your ranking`} action={{ label: 'Done' }}>
      <div className="sticky top-0 z-[1] flex flex-col gap-2 bg-m-b0 px-4 pb-2">
        <label className="flex h-10 items-center gap-2 rounded-[12px] bg-m-b2 px-3">
          <svg viewBox="0 0 16 16" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" className="flex-none text-m-t4">
            <circle cx="7" cy="7" r="4.8" />
            <path d="M10.6 10.6L14 14" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search players"
            aria-label="Search players"
            className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-m-t1 outline-none placeholder:text-n-3"
          />
        </label>
        <div className="flex gap-1.5">
          <span className="flex h-[30px] flex-none items-center whitespace-nowrap rounded-pill bg-m-ink px-3 text-[12px] font-semibold text-white">
            {rankPosLabel(pos)}
          </span>
        </div>
      </div>
      <div className="px-4 pb-[30px]">
        {poolPending ? (
          Array.from({ length: 6 }, (_, i) => <div key={i} className="my-1.5 h-[46px] rounded-[14px] bg-m-b1" />)
        ) : list.length === 0 ? (
          <p className="py-9 text-center text-[13px] font-medium text-m-t3">
            {query ? `No players match “${q.trim()}”` : 'No players at this position'}
          </p>
        ) : (
          list.map((p) => {
            const on = inRanking.has(p.id)
            const bye = onBye(p.team, weekGames)
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(p.id)}
                className="flex w-full items-center gap-2.5 border-b border-m-b2 py-2 text-left"
              >
                <MHeadshot player={p} size={34} />
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate text-[14px] font-semibold text-m-t1">{p.full_name}</span>
                  <span className={cn('truncate text-[11px] font-semibold', posTextClass(p.position))}>
                    {rankPosLabel(fromDbPos(p.position) ?? pos)}{' '}
                    <span className="font-medium text-m-t3">
                      {p.team ?? 'FA'}
                      {bye && (
                        <>
                          {' · '}
                          <span data-bye className="font-semibold text-m-to">
                            Bye
                          </span>
                        </>
                      )}
                      {' · '}Proj #{p.projRank}
                    </span>
                  </span>
                </span>
                <span
                  className={cn(
                    'flex size-7 flex-none items-center justify-center rounded-full text-white',
                    on ? 'bg-accent' : 'bg-m-ink',
                  )}
                >
                  <RkIcon d={on ? RK_ICON.check : RK_ICON.plusSmall} size={12} stroke={2.6} />
                </span>
              </button>
            )
          })
        )}
      </div>
    </MobileSheet>
  )
}
