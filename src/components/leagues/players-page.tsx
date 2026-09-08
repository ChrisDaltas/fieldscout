'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { PositionBadge } from '@/components/players/position-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/hooks/use-auth'
import { useDraftPool } from '@/hooks/use-draft-pool'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useLeaguePoolLive } from '@/hooks/use-league-pool'
import { useRostersLive } from '@/hooks/use-rosters'
import { useAddDrop, type AddDropResult } from '@/hooks/use-transactions'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import { deriveRosterSize } from '@/lib/leagues/settings/league-settings'
import { cn } from '@/lib/utils'

import { formatInstantWithDate, lockBadgeFor } from './lineup-editor-ops'
import {
  FREE_AGENT_LABEL,
  LOCKED_ADD_TITLE,
  LOCKED_DROP_TITLE,
  MOVE_NOTHING_COPY,
  NO_SEAT_COPY,
  ON_WAIVERS_LABEL,
  POSITIONS,
  ROSTERED_ELSEWHERE_TITLE,
  SCOPE_LABELS,
  WAIVERS_ADD_TITLE,
  emptyCopy,
  moveProblem,
  moveReadout,
  poolRows,
  rosterFill,
  type MoveIntent,
  type PoolPlayerRow,
  type PoolScope,
} from './players-page-ops'
import { ReconnectingBanner, STALE_LEAGUE_COPY, StaleDataBanner, StatusBanner } from './status-banners'
import { ProblemCard, problemCopy } from './team-page'

/**
 * Players / free agents — §16.1 `…/leagues/[id]/players`, §16.2
 * `free-agents-table` ("add/claim … locked 🔒 rows once a player's game
 * starts (the game-day lock — a RULE since v2.16.21, released at the week's
 * last game end)"), §12.19, §13.1 — M4 task L.D5.4 (PROGRESS D324).
 *
 * **Data, and who gates whom.** `useLeague` is the membership gate for the
 * whole page (the D316(4)/F249(a) posture). Three reads compose §12.19's
 * derived truth per player: the search WINDOW (`useDraftPool` — the draft
 * room's own server-backed player search: ADP-ordered, `ilike` + position
 * narrow the query, never a scan of a page — reused, not forked), the
 * ROSTERS route (who holds whom, with the tick's lock view joined —
 * `game_lock`, F241(d)) and the POOL rows (`useLeaguePoolLive` —
 * `free_agent` / `on_waivers` + `waivers_until` / `locked_in_game`, lazy).
 * The rosters and the pool JOIN the ONE `league:<id>` room (F233(a)) and
 * refetch on `league_rosters` / `transactions` / `league_player_pool`.
 *
 * **The client computes NO lock and NO eligibility.** The 🔒 is the tick's
 * VIEW through the lineup editor's `lockBadgeFor` (one reading across both
 * surfaces; the pool view is the CURRENT week's — F251(b), decided here:
 * no per-week arm on the client). A free agent with NO pool row shows no
 * 🔒 even if his game is on: the tick refreshes existing rows only, and
 * the add is refused by 113's own kickoff evaluation at transaction time —
 * which is what this page renders, VERBATIM (F227(f): the E32 message
 * names the kickoff and when the week clears; the waiver message names
 * `waivers_until`; the cap message names used/cap/week). A locked row's
 * button is disabled with the state's copy because the view says so, not
 * because the client decided anything; the server's answer still governs.
 *
 * **Never optimistic (§15.6 / F224 / F227).** A move is `useAddDrop`'s —
 * one `action_id` per submit — and the list re-reads on the answer either
 * way (the hook invalidates rosters + pool + feed on success, rosters +
 * pool on a refusal — D316(10a)). The result renders 113's stored payload
 * read out (`moveReadout`): the slot the add landed on, every lineup the
 * drop touched, where the dropped player went, the caps after.
 *
 * **Waivers and trades are HONEST absences:** an `on_waivers` row says when
 * he clears and that claims arrive in a later update; a player on another
 * roster says trades do. No button posts nowhere.
 *
 * **§16.5.4:** skeleton · empty by reason (per scope, per search) · error-
 * with-retry (`ProblemCard`) · degraded (stale banner + last-good rows; the
 * reconnecting banner off the room). Mobile: the table scrolls inside its
 * own container; the page never scrolls sideways.
 */
export function PlayersPage({ leagueId }: { leagueId: string }) {
  const league = useLeague(leagueId)
  if (league.isPending) return <PlayersSkeleton />
  if (league.isError || !league.data) {
    return (
      <ProblemCard
        heading="Players"
        title="Couldn’t load this league."
        detail={problemCopy(league.error)}
        onRetry={() => league.refetch()}
        leagueId={null}
      />
    )
  }
  return <PlayersContent leagueId={leagueId} detail={league.data} />
}

function PlayersContent({ leagueId, detail }: { leagueId: string; detail: LeagueDetail }) {
  const { user } = useAuth()
  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const leagueTimeZone = detail.settings.draft.time_zone ?? null
  const [search, setSearch] = useState('')
  const [position, setPosition] = useState('')
  const [scope, setScope] = useState<PoolScope>('free_agents')
  const [intent, setIntent] = useState<MoveIntent>({ add: null, drop: null })

  const rosters = useRostersLive(leagueId)
  const pool = useLeaguePoolLive(leagueId)
  const players = useDraftPool(search, position)
  const move = useAddDrop(leagueId)

  const rows = useMemo(
    () => poolRows(players.data ?? [], rosters.data, pool.data ?? [], myTeamId, scope),
    [players.data, rosters.data, pool.data, myTeamId, scope],
  )
  const myRoster = rosters.data?.teams.find((t) => t.team_id === myTeamId)?.roster
  const fill = rosterFill(myRoster, deriveRosterSize(detail.settings.roster_settings))

  const rostersProblem = rosters.isError ? rosters.error : null
  const poolProblem = pool.isError ? pool.error : null
  const reconnecting = rosters.connection === 'reconnecting' || pool.connection === 'reconnecting'
  const stale = (rostersProblem && rosters.data) || (poolProblem && pool.data)
  const loading = (rosters.isPending && !rosters.data) || (pool.isPending && !pool.data) || (players.isPending && !players.data)

  const header = (
    <PageHeader
      title="Players"
      actions={
        <Button variant="stroke" size="sm" asChild>
          <Link href={`/app/leagues/${leagueId}`}>
            <Icon name="cup" size={13} />
            {detail.league.name}
          </Link>
        </Button>
      }
    />
  )

  const submit = () => {
    if (moveProblem(intent)) return
    move.submit({ teamId: myTeamId!, addPlayerId: intent.add?.player.id ?? null, dropPlayerId: intent.drop?.player_id ?? null })
  }
  const clear = () => {
    setIntent({ add: null, drop: null })
    move.reset()
  }

  return (
    <div className="flex flex-col gap-4">
      {header}

      {reconnecting && <ReconnectingBanner>Reconnecting — syncing this league…</ReconnectingBanner>}
      {stale && <StaleDataBanner>{STALE_LEAGUE_COPY}</StaleDataBanner>}

      {myTeamId ? (
        <MovePanel
          intent={intent}
          myRoster={myRoster ?? []}
          fill={fill}
          pending={move.isPending}
          result={move.data ?? null}
          refusal={move.isError ? (move.error instanceof Error ? move.error.message : 'The move was refused.') : null}
          leagueTimeZone={leagueTimeZone}
          onDrop={(player) => setIntent((i) => ({ ...i, drop: player }))}
          onClearAdd={() => setIntent((i) => ({ ...i, add: null }))}
          onSubmit={submit}
          onDone={clear}
        />
      ) : (
        <StatusBanner tone="neutral" className="text-n-3">
          {NO_SEAT_COPY}
        </StatusBanner>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search players"
          aria-label="Search players"
          className="h-btn-md w-full max-w-xs px-2 text-[12px]"
        />
        <Segment aria-label="Position">
          <SegmentItem active={position === ''} onClick={() => setPosition('')}>
            All
          </SegmentItem>
          {POSITIONS.map((p) => (
            <SegmentItem key={p} active={position === p} onClick={() => setPosition(p)}>
              {p === 'DEF' ? 'D/ST' : p}
            </SegmentItem>
          ))}
        </Segment>
        <Segment aria-label="Availability">
          {(Object.keys(SCOPE_LABELS) as PoolScope[]).map((s) => (
            <SegmentItem key={s} active={scope === s} onClick={() => setScope(s)} data-scope={s}>
              {SCOPE_LABELS[s]}
            </SegmentItem>
          ))}
        </Segment>
      </div>

      {loading ? (
        <TableSkeleton />
      ) : rostersProblem && !rosters.data ? (
        <ProblemCard heading="Players" title="Couldn’t load the rosters." detail={problemCopy(rostersProblem)} onRetry={() => rosters.refetch()} leagueId={leagueId} />
      ) : poolProblem && !pool.data ? (
        <ProblemCard heading="Players" title="Couldn’t load the player pool." detail={problemCopy(poolProblem)} onRetry={() => pool.refetch()} leagueId={leagueId} />
      ) : players.isError && !players.data ? (
        <ProblemCard
          heading="Players"
          title="Couldn’t load the player list."
          detail={players.error instanceof Error ? players.error.message : 'The players read failed.'}
          onRetry={() => players.refetch()}
          leagueId={leagueId}
        />
      ) : (
        <PoolTable
          rows={rows}
          scope={scope}
          hadSearch={search.trim() !== '' || position !== ''}
          canAct={myTeamId !== null}
          intent={intent}
          leagueTimeZone={leagueTimeZone}
          onAdd={(row) => {
            move.reset()
            setIntent((i) => ({ ...i, add: row }))
          }}
          onDrop={(player) => {
            move.reset()
            setIntent((i) => ({ ...i, drop: player }))
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The move panel — what will be sent, the answer as it came back
// ---------------------------------------------------------------------------

const NO_DROP = 'none'

export function MovePanel({
  intent,
  myRoster,
  fill,
  pending,
  result,
  refusal,
  leagueTimeZone,
  onDrop,
  onClearAdd,
  onSubmit,
  onDone,
}: {
  intent: MoveIntent
  myRoster: readonly RosterPlayer[]
  fill: { count: number; size: number }
  pending: boolean
  result: AddDropResult | null
  refusal: string | null
  leagueTimeZone: string | null
  onDrop: (player: RosterPlayer | null) => void
  onClearAdd: () => void
  onSubmit: () => void
  onDone: () => void
}) {
  const problem = moveProblem(intent)
  const idle = !intent.add && !intent.drop && !result && !refusal

  if (result) {
    const readout = moveReadout(result, (iso) => formatInstantWithDate(iso, leagueTimeZone).local)
    return (
      <Card data-move-result>
        <CardContent className="flex flex-col gap-2 px-card-pad py-3">
          <StatusBanner tone="accent">
            <strong>{readout.headline}</strong>
          </StatusBanner>
          <ul className="flex flex-col gap-0.5 text-[11px] font-medium text-n-3">
            {readout.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <span>
            <Button variant="stroke" size="sm" onClick={onDone}>
              Done
            </Button>
          </span>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card data-move-panel={idle ? 'idle' : 'armed'}>
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="flex items-center gap-2 text-[12px]">
          Roster move
          <span className="ml-auto text-[11px] font-medium text-n-3">
            Your roster: <span className="fs-num">{fill.count}</span> of <span className="fs-num">{fill.size}</span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-card-pad py-3">
        {refusal && (
          <div className="flex flex-col items-start gap-2 rounded-sm border border-negative bg-negative-soft px-3 py-2" role="alert" data-move-refusal>
            <p className="text-[12px] font-bold">That move was refused.</p>
            {/* VERBATIM — the server's own sentence names the player, the
                kickoff, the waiver instant or the cap (F227(f)). */}
            <p className="text-[11px] font-medium text-ink">{refusal}</p>
            <Button variant="stroke" size="sm" onClick={onDone}>
              Dismiss
            </Button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1 text-[10px] font-bold text-n-3">
            Add
            <div className="flex h-btn-md items-center gap-2 rounded-sm border border-n-4 px-2 text-[12px] font-medium text-ink" data-move-add={intent.add?.player.id ?? ''}>
              {intent.add ? (
                <>
                  <PositionBadge position={intent.add.player.position} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{intent.add.player.full_name}</span>
                  <button type="button" className="text-[10px] font-bold text-n-3 hover:text-ink" onClick={onClearAdd} aria-label="Clear the add">
                    Clear
                  </button>
                </>
              ) : (
                <span className="text-n-3">Pick a free agent below</span>
              )}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-[10px] font-bold text-n-3">
            Drop
            <Select value={intent.drop?.player_id ?? NO_DROP} onValueChange={(v) => onDrop(v === NO_DROP ? null : (myRoster.find((p) => p.player_id === v) ?? null))}>
              <SelectTrigger className="h-btn-md px-2 text-[12px]" data-move-drop={intent.drop?.player_id ?? ''}>
                <SelectValue placeholder="No drop" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_DROP}>No drop</SelectItem>
                {myRoster.map((p) => {
                  const lock = lockBadgeFor(p.game_lock, true)
                  return (
                    <SelectItem key={p.player_id} value={p.player_id} disabled={lock.locked} title={lock.locked ? LOCKED_DROP_TITLE : undefined}>
                      {p.position} · {p.full_name}
                      {lock.locked ? ' 🔒' : ''}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="blue" size="sm" shadow disabled={pending || problem !== null} onClick={onSubmit} data-move-submit>
            {pending ? 'Sending…' : 'Make move'}
          </Button>
          {!idle && (
            <Button variant="stroke" size="sm" onClick={onDone} disabled={pending}>
              Cancel
            </Button>
          )}
          <span className="text-[10px] font-medium text-n-3">{problem ?? 'The server checks the lock, the roster and the caps — its answer is what you see.'}</span>
        </div>
        {idle && problem === MOVE_NOTHING_COPY && null}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The table — §12.19's derived truth per row, the 🔒 from the view
// ---------------------------------------------------------------------------

export function PoolTable({
  rows,
  scope,
  hadSearch,
  canAct,
  intent,
  leagueTimeZone,
  onAdd,
  onDrop,
}: {
  rows: readonly PoolPlayerRow[]
  scope: PoolScope
  hadSearch: boolean
  canAct: boolean
  intent: MoveIntent
  leagueTimeZone: string | null
  onAdd: (row: PoolPlayerRow) => void
  onDrop: (player: RosterPlayer) => void
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <Icon name="search" size={18} className="text-n-3" />
          <p className="max-w-md text-[13px] font-medium text-n-3" data-empty={scope}>
            {emptyCopy(scope, hadSearch)}
          </p>
        </CardContent>
      </Card>
    )
  }
  return (
    <div className="overflow-x-auto rounded-sm border border-ink bg-white" data-pool-table>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Player</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Availability</TableHead>
            {canAct && <TableHead className="text-right">Move</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const selected = intent.add?.player.id === row.player.id || intent.drop?.player_id === row.player.id
            return (
              <TableRow
                key={row.player.id}
                data-pool-row={row.player.id}
                data-availability={row.availability.kind}
                data-locked={row.lock.locked || undefined}
                className={cn(selected && 'bg-accent-soft hover:bg-accent-soft')}
              >
                <TableCell>
                  <span className="flex items-center gap-2">
                    <PositionBadge position={row.player.position} size="sm" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-bold text-ink">{row.player.full_name}</span>
                      <span className="text-[10px] font-medium text-n-3">
                        {row.player.team ?? '—'}
                        {row.player.status && row.player.status !== 'Active' ? ` · ${row.player.status}` : ''}
                      </span>
                    </span>
                  </span>
                </TableCell>
                <TableCell>
                  {row.lock.locked ? (
                    <Badge variant="black" title={row.lock.until ? `Locked until ${formatInstantWithDate(row.lock.until, leagueTimeZone).local}` : row.lock.copy} data-lock>
                      🔒 locked
                    </Badge>
                  ) : (
                    <span className="text-[11px] text-n-3">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <AvailabilityCell row={row} leagueTimeZone={leagueTimeZone} />
                </TableCell>
                {canAct && (
                  <TableCell className="text-right">
                    <MoveButton row={row} onAdd={onAdd} onDrop={onDrop} />
                  </TableCell>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function AvailabilityCell({ row, leagueTimeZone }: { row: PoolPlayerRow; leagueTimeZone: string | null }) {
  const a = row.availability
  if (a.kind === 'free_agent') return <Badge variant="stroke-green">{FREE_AGENT_LABEL}</Badge>
  if (a.kind === 'on_waivers') {
    const until = formatInstantWithDate(a.until, leagueTimeZone)
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge variant="yellow" title={WAIVERS_ADD_TITLE}>
          {ON_WAIVERS_LABEL}
        </Badge>
        <span className="fs-num text-[10px] font-medium text-n-3" title={until.title ?? undefined}>
          until {until.local}
        </span>
      </span>
    )
  }
  return (
    <span className={cn('text-[12px] font-medium', a.mine ? 'font-bold text-accent-strong' : 'text-ink')} title={a.mine ? undefined : ROSTERED_ELSEWHERE_TITLE}>
      {a.mine ? 'Your team' : a.teamName}
    </span>
  )
}

/** The action per row: Add for a free agent (disabled by the VIEW's lock or
 *  a waiver state, with the reason), Drop for the viewer's own player
 *  (disabled by the view's lock), nothing for another roster's — each an
 *  honest absence, never a button that posts nowhere. */
function MoveButton({ row, onAdd, onDrop }: { row: PoolPlayerRow; onAdd: (row: PoolPlayerRow) => void; onDrop: (player: RosterPlayer) => void }) {
  const a = row.availability
  if (a.kind === 'rostered') {
    if (!a.mine) return <span className="text-[11px] text-n-3">—</span>
    return (
      <Button variant="stroke" size="sm" disabled={row.lock.locked} title={row.lock.locked ? LOCKED_DROP_TITLE : undefined} onClick={() => onDrop(rosterPlayerOf(row))} data-action="drop">
        Drop
      </Button>
    )
  }
  const waivers = a.kind === 'on_waivers'
  return (
    <Button
      variant="stroke"
      size="sm"
      disabled={row.lock.locked || waivers}
      title={row.lock.locked ? LOCKED_ADD_TITLE : waivers ? WAIVERS_ADD_TITLE : undefined}
      onClick={() => onAdd(row)}
      data-action="add"
    >
      Add
    </Button>
  )
}

/** The roster-route shape the drop needs, from a pool row (a rostered row's
 *  player identity is the same `players` row the rosters route joined). */
function rosterPlayerOf(row: PoolPlayerRow): RosterPlayer {
  return {
    player_id: row.player.id,
    full_name: row.player.full_name,
    position: row.player.position,
    nfl_team: row.player.team,
    status: row.player.status,
    bye_week: null,
    slot_key: null,
    acquisition_type: null,
    acquisition_cost: null,
    ir_placed_week: null,
    ir_lock_until_week: null,
    acquired_at: null,
    pool_state: row.poolState,
    game_lock: row.lock.locked ? (row.lock.until ? { state: 'locked_until', until: row.lock.until } : { state: 'locked_release_unrecorded', until: null }) : { state: 'unlocked', until: null },
  }
}

// ---------------------------------------------------------------------------
// States (§16.5.4)
// ---------------------------------------------------------------------------

function PlayersSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Players" />
      <Skeleton className="h-24 rounded-sm" />
      <Skeleton className="h-7 w-80 rounded-sm" />
      <TableSkeleton />
    </div>
  )
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2" data-skeleton="pool-table">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-9 rounded-sm" />
      ))}
    </div>
  )
}
