'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useQueryClient } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type MutableRefObject } from 'react'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { ListPickerSheet } from '@/components/mobile/player/list-picker-sheet'
import { PlayerMoveSheet, type MoveSheetKind } from '@/components/mobile/player/player-move-sheet'
import { LeaguesTab, QueueButton, TransactionsTab } from '@/components/mobile/player/profile-leagues'
import {
  bioLine,
  currentWeekOf,
  headerColors,
  statusPill,
  stripCells,
  teamLine,
} from '@/components/mobile/player/profile-ops'
import { GameLogTab, HistoryTab, TeamTab } from '@/components/mobile/player/profile-stats-tabs'
import { SummaryTab } from '@/components/mobile/player/profile-summary'
import { useProfileUiStore, type ProfileDraftContext } from '@/components/mobile/player/profile-ui-store'
import { poolOf, useProfileLeague, useProfileScoring } from '@/components/mobile/player/use-profile-context'
import { TradeBuilderOverlay } from '@/components/mobile/trades/trade-builder-overlay'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MPosChip, posLabel } from '@/components/mobile/ui/m-pos-chip'
import { useCardLeagueView } from '@/components/players/player-card-actions'
import { scheduleRows, thisWeek } from '@/components/players/player-page-ops'
import { useDefenseSplits } from '@/hooks/use-defense-splits'
import { useLeague } from '@/hooks/use-league'
import { useMobileProfileStatLines } from '@/hooks/use-mobile-pprofile-stat-lines'
import { useNflTeamSchedule } from '@/hooks/use-nfl-team-schedule'
import { usePlayerStats, type PlayerStatsPlayer, type PlayerStatsResponse } from '@/hooks/use-player-stats'
import { toast } from '@/hooks/use-toast'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'
import type { PlayerModalTarget } from '@/stores/player-modal-store'

/** What Escape closes while something sits on top of the profile that is
 *  not a Radix layer (the trade builder) — set by that layer, read by the
 *  profile's own Escape handler. */
const ProfileEscape = createContext<MutableRefObject<(() => void) | null> | null>(null)

/**
 * FieldScout Mobile player profile (handoff spec m-pprofile.md): the
 * full-screen profile every player tap opens in the mobile layout — a
 * team-coloured header, the stat strip and the tab strip fixed above one
 * scrolling body. It covers the dock, opens and closes instantly, and the
 * screen beneath keeps its state (the page is never navigated). Close (×)
 * is the only way out; any link inside it that leaves the page closes it.
 *
 * Built on the app's Radix dialog primitive (Escape, focus looping, nested
 * sheets as Radix layers) with no overlay or motion — the design has none.
 * NON-modal on purpose: the trade builder opens ON TOP of the profile
 * (§3 "Propose trade", §4 z-order) as a mobile overlay that is not a Radix
 * layer, and a modal dialog would make it inert (body pointer-events off,
 * focus trapped back into the profile). The profile covers the whole screen
 * anyway, says `aria-modal`, Tab still loops inside it, and an outside
 * interaction never dismisses it.
 */
export function MobilePlayerProfile({ target, onClose }: { target: PlayerModalTarget | null; onClose: () => void }) {
  const escape = useRef<(() => void) | null>(null)
  // A draft seat belongs to the profile it was opened with — drop it on close.
  useEffect(() => {
    if (!target) useProfileUiStore.getState().setDraft(null)
  }, [target])
  return (
    <DialogPrimitive.Root modal={false} open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        {target && (
          <DialogPrimitive.Content
            // Elevation exception: a full-screen overlay — no shadow at all.
            className="fixed inset-0 z-50 flex flex-col bg-m-b0 pt-[env(safe-area-inset-top)] font-sans leading-[normal] text-m-t1 tabular-nums outline-none"
            aria-modal="true"
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => {
              // The trade builder on top takes Escape (closing it returns here).
              const close = escape.current
              if (close) {
                e.preventDefault()
                close()
              }
            }}
            aria-describedby={undefined}
            data-player-profile={target.playerId}
          >
            <ProfileEscape.Provider value={escape}>
              <ProfileBody key={`${target.playerId}:${target.leagueId ?? ''}`} target={target} onClose={onClose} />
            </ProfileEscape.Provider>
          </DialogPrimitive.Content>
        )}
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

type Tab = 'summary' | 'log' | 'leagues' | 'tx' | 'team' | 'history'
type Sheet = { kind: 'list' } | { kind: MoveSheetKind; leagueId: string } | null
type Builder = { leagueId: string; teamId: string } | null

function ProfileBody({ target, onClose }: { target: PlayerModalTarget; onClose: () => void }) {
  const { data, isLoading, error, refetch, isFetching } = usePlayerStats(target.playerId)
  // Leaving the page under it (a trade, a team, a username link) closes it.
  const pathname = usePathname()
  const [origin] = useState(pathname)
  useEffect(() => {
    if (pathname !== origin) onClose()
  }, [pathname, origin, onClose])

  if (isLoading) return <ProfileLoading onClose={onClose} />
  if (error || !data) {
    // The stats route's 404 reads "Player not found"; anything else is a
    // failed read — said in plain words (never the raw error), with a retry.
    const notFound = !error || error.message === 'Player not found'
    return (
      <>
        <PlainHeader onClose={onClose} title="Player" />
        <div className="flex flex-col items-center gap-1 px-8 py-16 text-center" role="alert">
          <p className="text-[15px] font-semibold">{notFound ? 'Player not found' : 'Couldn’t load this player'}</p>
          <p className="text-[13px] font-medium text-m-t3">
            {notFound ? 'This player may have moved or been removed.' : 'Check your connection and try again.'}
          </p>
          {!notFound && (
            <button
              type="button"
              disabled={isFetching}
              onClick={() => void refetch()}
              className="mt-3 h-9 rounded-pill bg-m-b2 px-4 text-[13px] font-semibold text-m-t1 disabled:opacity-40"
            >
              Try again
            </button>
          )}
        </div>
      </>
    )
  }
  return <ProfileLoaded data={data} target={target} onClose={onClose} />
}

function PlainHeader({ onClose, title }: { onClose: () => void; title: string }) {
  return (
    <div className="flex flex-none items-center gap-1.5 bg-m-b1 px-4 pb-3 pt-2">
      <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
      <CloseButton onClose={onClose} className="bg-m-b2 text-m-t1" />
    </div>
  )
}

function CloseButton({ onClose, className }: { onClose: () => void; className: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className={cn('flex size-[30px] flex-none items-center justify-center rounded-full', className)}
      data-profile-close
    >
      <MIcon name="close" size={14} stroke={2.2} />
    </button>
  )
}

function ProfileLoading({ onClose }: { onClose: () => void }) {
  return (
    <div aria-busy="true" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-col gap-2.5 bg-m-b1 px-4 pb-3 pt-2">
        <DialogPrimitive.Title className="sr-only">Loading player</DialogPrimitive.Title>
        <CloseButton onClose={onClose} className="bg-m-b2 text-m-t1" />
        <div className="flex items-center gap-3">
          <span className="size-16 flex-none animate-pulse rounded-full bg-m-b2" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-[22px] w-2/3 animate-pulse rounded-[8px] bg-m-b2" />
            <span className="h-3 w-1/2 animate-pulse rounded-[6px] bg-m-b2" />
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-3 px-4 py-[14px]">
        <div className="h-[52px] animate-pulse rounded-[14px] bg-m-b1" />
        <div className="h-9 animate-pulse rounded-[12px] bg-m-b1" />
        <div className="h-[140px] animate-pulse rounded-[14px] bg-m-b1" />
      </div>
    </div>
  )
}

export function ProfileLoaded({ data, target, onClose }: { data: PlayerStatsResponse; target: PlayerModalTarget; onClose: () => void }) {
  const { player } = data
  const season = data.seasons.current.season
  const ctx = useProfileLeague(featureFlags.leagues ? target.leagueId : null)
  const scoring = useProfileScoring(player.id, ctx.explicit ? ctx.leagueId : null)
  const core = scoring.stats.data ?? null
  const games = useNflTeamSchedule(season, player.team)
  const splits = useDefenseSplits(season)
  const lines = useMobileProfileStatLines(player.id, season)
  const schedule = useMemo(
    () => scheduleRows(player.team, player.position, games.data ?? [], splits.data ?? [], player.bye_week),
    [player.team, player.position, player.bye_week, games.data, splits.data],
  )
  const tw = games.data ? thisWeek(player.team, player.position, games.data, splits.data ?? [], player.bye_week) : null
  // The week being played: his live game, else the NFL calendar's week (the
  // core-stats read), else the schedule's next game / bye.
  const currentWeek = currentWeekOf(games.data ?? [], core?.week ?? null, tw?.week ?? null)
  const pool = useMemo(() => poolOf(player), [player])
  // The draft seat he was opened from (the draft card's Queue), if it is his.
  const draftSeat = useProfileUiStore((s) => s.draft)
  const draft = draftSeat && draftSeat.playerId === player.id ? draftSeat : null

  const [tab, setTab] = useState<Tab>('summary')
  const [sheet, setSheet] = useState<Sheet>(null)
  const [builder, setBuilder] = useState<Builder>(null)
  // The Game log's season: reset when a profile opens, kept across tabs (§3).
  const [logYear, setLogYear] = useState(season)
  const bodyRef = useRef<HTMLDivElement>(null)
  const pick = (t: Tab) => {
    setTab(t)
    // One body for every tab: a new tab starts at its top (the prototype's
    // kept scrollTop is a quirk the spec says not to copy).
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }
  const leaguesOn = featureFlags.leagues
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'summary', label: 'Summary' },
    { key: 'log', label: 'Game log' },
    ...(leaguesOn ? [{ key: 'leagues' as const, label: 'Leagues' }, { key: 'tx' as const, label: 'Transactions' }] : []),
    ...(player.team ? [{ key: 'team' as const, label: 'Team' }] : []),
    { key: 'history', label: 'History' },
  ]
  const openMove = (kind: MoveSheetKind, leagueId: string) => setSheet({ kind, leagueId })
  // Propose trade / Trade: the builder opens over the profile (§3).
  const openTrade = (leagueId: string, teamId: string) => setBuilder({ leagueId, teamId })

  // Tabs (WAI-ARIA tabs pattern): one tab stop, arrows / Home / End move it.
  const ids = useId()
  const tabId = (k: Tab) => `${ids}-tab-${k}`
  const panelId = `${ids}-panel`
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.key === tab)
    const next =
      e.key === 'ArrowRight' ? (i + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? tabs.length - 1
      : -1
    if (next < 0) return
    e.preventDefault()
    const key = tabs[next]!.key
    pick(key)
    document.getElementById(tabId(key))?.focus()
  }

  return (
    <>
      <ProfileHeader
        player={player}
        pool={pool}
        leagueId={ctx.leagueId}
        draft={draft}
        draftLeagueName={draft?.leagueId ? (ctx.leagues.find((l) => l.id === draft.leagueId)?.name ?? null) : null}
        onClose={onClose}
        onList={() => setSheet({ kind: 'list' })}
        onMove={openMove}
        onTrade={openTrade}
      />
      <StatStrip cells={stripCells(core, player, season, posLabel(player.position))} pending={scoring.stats.isPending} />
      <div
        role="tablist"
        aria-label="Player sections"
        onKeyDown={onTabKey}
        className="flex flex-none gap-[18px] overflow-x-auto border-b border-m-b3 px-4 scrollbar-none"
      >
        {tabs.map((t) => {
          const on = t.key === tab
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              id={tabId(t.key)}
              aria-controls={on ? panelId : undefined}
              tabIndex={on ? 0 : -1}
              onClick={() => pick(t.key)}
              className={cn('relative flex h-10 flex-none items-center whitespace-nowrap text-[13px] font-semibold', on ? 'text-m-t1' : 'text-m-t3')}
              data-profile-tab={t.key}
            >
              {t.label}
              {on && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-m-ink" />}
            </button>
          )
        })}
      </div>
      <div
        ref={bodyRef}
        id={panelId}
        role="tabpanel"
        aria-labelledby={tabId(tab)}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(28px+env(safe-area-inset-bottom))] outline-none scrollbar-none"
      >
        {tab === 'summary' && (
          <SummaryTab
            player={player}
            pool={pool}
            season={season}
            core={core}
            coreError={scoring.stats.isError}
            ctx={ctx}
            schedule={schedule}
            games={games.data ?? []}
            // The cards wait for the scoring read too: it says which week is
            // current, and the strip is placed on that week once per mount.
            gamesState={games.isError ? 'error' : (player.team && games.isPending) || scoring.stats.isPending ? 'loading' : 'ready'}
            lines={lines.data ?? []}
            currentWeek={currentWeek}
            onLeagues={() => pick(leaguesOn ? 'leagues' : 'summary')}
          />
        )}
        {tab === 'log' && (
          <GameLogTab
            player={player}
            season={season}
            year={logYear}
            onYear={setLogYear}
            choice={scoring.choice}
            core={core}
            schedule={schedule}
            lines={lines.data ?? []}
            linesState={lines.isError ? 'error' : lines.isPending ? 'loading' : 'ready'}
          />
        )}
        {tab === 'leagues' && (
          <LeaguesTab
            player={player}
            pool={pool}
            leagues={ctx.leagues}
            pending={ctx.leaguesPending}
            error={ctx.leaguesError}
            onMove={openMove}
            onTrade={openTrade}
          />
        )}
        {tab === 'tx' && <TransactionsTab playerId={player.id} leagues={ctx.leagues} pending={ctx.leaguesPending} error={ctx.leaguesError} />}
        {tab === 'team' && player.team && <TeamTab player={player} />}
        {tab === 'history' && (
          <HistoryTab
            player={player}
            season={season}
            choice={scoring.choice}
            core={core}
            lines={lines.data ?? []}
            linesState={lines.isError ? 'error' : lines.isPending ? 'loading' : 'ready'}
            movesLeagueIds={leaguesOn ? (ctx.leagueId ? [ctx.leagueId] : ctx.leagues.map((l) => l.id)) : null}
          />
        )}
      </div>
      <ListPickerSheet
        open={sheet?.kind === 'list'}
        onOpenChange={(o) => !o && setSheet(null)}
        playerId={player.id}
        playerName={player.full_name}
        listContext={target.listContext}
        onRemoved={onClose}
      />
      {sheet && sheet.kind !== 'list' && (
        <PlayerMoveSheet
          open
          onOpenChange={(o) => !o && setSheet(null)}
          kind={sheet.kind}
          leagueId={sheet.leagueId}
          player={pool}
        />
      )}
      {builder && (
        <ProfileTradeBuilder
          leagueId={builder.leagueId}
          teamId={builder.teamId}
          playerId={player.id}
          onClose={() => setBuilder(null)}
          onSent={onClose}
        />
      )}
    </>
  )
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A trade proposal's variables (`proposeTradeVariables` — 151's
 *  `trade_propose` body), told apart in the shared mutation cache. */
function isTradeProposal(v: unknown): boolean {
  return isObj(v) && typeof v.from_team_id === 'string' && typeof v.to_team_id === 'string' && Array.isArray(v.items) && typeof v.action_id === 'string'
}

/**
 * The league's mobile trade builder, opened over the profile with him asked
 * for from the team that holds him (§3 "Action: Propose trade" / "Leagues:
 * Trade"; §4: the builder sits above the profile). Closing it returns to the
 * profile as it was; Send closes both, back to the screen under the profile
 * (the builder's own toast names the manager). The builder reports both
 * through one `onClose`, so a proposal that went through is recognised from
 * the shared mutation cache — the builder itself is untouched.
 */
function ProfileTradeBuilder({
  leagueId,
  teamId,
  playerId,
  onClose,
  onSent,
}: {
  leagueId: string
  teamId: string
  playerId: string
  onClose: () => void
  onSent: () => void
}) {
  const league = useLeague(leagueId)
  const queryClient = useQueryClient()
  const escape = useContext(ProfileEscape)
  const status = useRef({ sending: false, sent: false })
  const done = useRef({ onClose, onSent })
  done.current = { onClose, onSent }
  const finish = () => (status.current.sent ? done.current.onSent() : done.current.onClose())

  useEffect(
    () =>
      queryClient.getMutationCache().subscribe((e) => {
        if (e.type !== 'updated' || !isTradeProposal(e.mutation.state.variables)) return
        if (e.action.type === 'pending') status.current.sending = true
        if (e.action.type === 'error') status.current.sending = false
        if (e.action.type === 'success') status.current = { sending: false, sent: true }
      }),
    [queryClient],
  )
  // Escape closes the builder (never mid-send, like its own ×).
  useEffect(() => {
    if (!escape) return
    escape.current = () => {
      if (!status.current.sending) done.current.onClose()
    }
    return () => {
      escape.current = null
    }
  }, [escape])
  // Focus goes back to what opened it (the pill or the row's Trade).
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    if (!league.isError) return
    toast({ title: 'Couldn’t open the trade builder — try again.' })
    done.current.onClose()
  }, [league.isError])

  if (!league.data) return null
  return (
    <TradeBuilderOverlay leagueId={leagueId} detail={league.data} mode="propose" initialTo={teamId} initialGet={[playerId]} onClose={finish} />
  )
}

// ---------------------------------------------------------------------------
// Header (§2.1)
// ---------------------------------------------------------------------------

function ProfileHeader({
  player,
  pool,
  leagueId,
  draft,
  draftLeagueName,
  onClose,
  onList,
  onMove,
  onTrade,
}: {
  player: PlayerStatsPlayer
  pool: PoolPlayer
  leagueId: string | null
  /** Opened from a draft seat: the action is the draft card's Queue. */
  draft: ProfileDraftContext | null
  draftLeagueName: string | null
  onClose: () => void
  onList: () => void
  onMove: (kind: MoveSheetKind, leagueId: string) => void
  onTrade: (leagueId: string, teamId: string) => void
}) {
  const colors = headerColors(player.team)
  const light = colors?.light ?? false
  const status = statusPill(player.status)
  const bio = bioLine(player, new Date())
  return (
    <div
      className={cn('flex flex-none flex-col gap-2.5 px-4 pb-3 pt-2', !colors && 'bg-fs-ink-3', light ? 'text-ink' : 'text-white')}
      // The team colour is data (the app's NFL colour table).
      style={colors ? { background: colors.bg } : undefined}
      data-profile-header
    >
      <div className="flex items-center gap-1.5">
        <CloseButton onClose={onClose} className={light ? 'bg-black/[.08]' : 'bg-white/[.16]'} />
        {draft ? (
          <QueueButton
            variant="header"
            leagueId={draft.leagueId}
            leagueName={draftLeagueName}
            draftId={draft.draftId}
            teamId={draft.teamId}
            playerId={player.id}
          />
        ) : (
          leagueId && <HeaderAction pool={pool} leagueId={leagueId} light={light} onMove={onMove} onTrade={onTrade} />
        )}
        <button
          type="button"
          onClick={onList}
          title="Add to list"
          aria-label={`Add ${player.full_name} to a list`}
          className="flex h-[30px] flex-none items-center gap-[5px] rounded-pill bg-m-b2 px-3 text-[13px] font-semibold text-m-t1"
          data-profile-list
        >
          <MIcon name="add" size={11} stroke={2.4} />
          List
        </button>
        <span className="flex-1" />
        {status && (
          <span
            title={player.injury_notes ?? player.injury_body_part ?? undefined}
            className={cn(
              'flex h-[22px] flex-none items-center rounded-pill px-[9px] text-[11px] font-semibold text-white',
              status.tone === 'warn' ? 'bg-warn' : 'bg-negative-strong',
            )}
            data-profile-status
          >
            {status.label}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <MHeadshot player={player} size={64} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <DialogPrimitive.Title className="truncate text-[22px] font-bold leading-[1.1] tracking-[-0.02em]">
            {player.full_name}
          </DialogPrimitive.Title>
          <span className="flex items-center gap-1.5 text-[12px] font-semibold">
            <MPosChip pos={player.position} className="h-[17px] min-w-0 rounded-[5px] px-[5px] text-[10px] font-semibold" />
            {teamLine(player)}
          </span>
          {bio && <span className={cn('truncate text-[11px] font-medium', light ? 'text-ink/[.72]' : 'text-white/80')}>{bio}</span>}
        </div>
      </div>
    </div>
  )
}

/**
 * The one roster move that fits in the profile's league (H1): Drop (yours),
 * Propose trade (another team's — the builder opens over the profile),
 * Claim off waivers / Add (available) — the player card's gates
 * (`cardLeagueView`). A closed door is shown dimmed and says why when
 * tapped; it never sends.
 */
function HeaderAction({
  pool,
  leagueId,
  light,
  onMove,
  onTrade,
}: {
  pool: PoolPlayer
  leagueId: string
  light: boolean
  onMove: (kind: MoveSheetKind, leagueId: string) => void
  onTrade: (leagueId: string, teamId: string) => void
}) {
  const card = useCardLeagueView(pool, leagueId)
  if (card.state === 'loading') {
    // Holds the pill's place so "+ List" does not jump when it lands.
    return <span aria-hidden className={cn('h-[30px] w-[60px] flex-none animate-pulse rounded-pill', light ? 'bg-black/[.08]' : 'bg-white/[.16]')} />
  }
  if (card.state !== 'ready') return null
  const v = card.view
  if (v.kind === 'no_seat') return null
  const pill = (label: string, cls: string, open: boolean, reason: string | undefined, run: () => void) => (
    <button
      type="button"
      aria-disabled={!open || undefined}
      onClick={() => (open ? run() : toast({ title: reason ?? 'Not available right now.' }))}
      className={cn('flex h-[30px] flex-none items-center whitespace-nowrap rounded-pill px-3.5 text-[13px] font-semibold', cls, !open && 'opacity-40')}
      data-profile-action={v.kind}
    >
      {label}
    </button>
  )
  if (v.kind === 'mine') return pill('Drop', 'bg-m-gr text-m-tr', v.drop.open, v.drop.open ? undefined : v.drop.reason, () => onMove('drop', leagueId))
  if (v.kind === 'theirs') {
    return pill('Propose trade', 'bg-accent text-white', v.trade.open, v.trade.open ? undefined : v.trade.reason, () => onTrade(leagueId, v.teamId))
  }
  const claim = v.acquire.kind === 'claim' || (v.acquire.kind === 'none' && v.row.availability.kind === 'on_waivers')
  return pill(
    claim ? 'Claim off waivers' : 'Add',
    claim ? 'bg-m-gold text-white' : 'bg-confirm text-white',
    !v.acquire.disabled,
    v.acquire.disabled ? v.acquire.title : undefined,
    () => onMove('acquire', leagueId),
  )
}

// ---------------------------------------------------------------------------
// Stat strip (§2.2)
// ---------------------------------------------------------------------------

function StatStrip({ cells, pending }: { cells: ReturnType<typeof stripCells>; pending: boolean }) {
  return (
    <div
      className="grid flex-none border-b border-m-b3 px-2 py-2.5"
      style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
      data-profile-strip
    >
      {cells.map((c) => (
        <div key={c.key} className="flex min-w-0 flex-col items-center gap-px text-center" data-strip={c.key}>
          <span className={cn('whitespace-nowrap text-[15px] font-bold', c.missing && 'text-m-t4', pending && c.missing && 'animate-pulse')}>{c.value}</span>
          <span className="whitespace-nowrap text-[9.5px] font-medium text-m-t3">{c.label}</span>
        </div>
      ))}
    </div>
  )
}
