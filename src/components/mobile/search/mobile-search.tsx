'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { teamPageHref } from '@/components/leagues/league-cells'
import { poolRows, type Availability } from '@/components/leagues/players-page-ops'
import { AuthorAvatar } from '@/components/mobile/community/community-cards'
import { formatFollows } from '@/components/mobile/community/community-ops'
import { isPreDraft } from '@/components/mobile/player/profile-ops'
import { mobileRoute } from '@/components/mobile/shell/mobile-nav'
import { MOverlay, MOverlayScroll } from '@/components/mobile/trades/m-overlay'
import { teamAvatarClass } from '@/components/mobile/ui/avatar-colors'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { posLabel } from '@/components/mobile/ui/m-pos-chip'
import { userProfileHref } from '@/components/shared/username-link-ops'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useAuth } from '@/hooks/use-auth'
import { useLeague } from '@/hooks/use-league'
import { useLeaguePool } from '@/hooks/use-league-pool'
import { useMobileHomeTrending } from '@/hooks/use-mobile-home-trending'
import { communityTerm, useMobileSearch, type SearchList, type SearchUser } from '@/hooks/use-mobile-search'
import { useRosters } from '@/hooks/use-rosters'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'
import { handleInitials } from '@/utils/initials'

import {
  SEARCH_SCOPES,
  bodyState,
  leagueManagers,
  managerSub,
  matchManagers,
  ownerLabel,
  postHref,
  readRecentSearches,
  readState,
  sectionCap,
  showsSection,
  withRecent,
  writeRecentSearches,
  type OwnerLabel,
  type OwnerTone,
  type SearchManager,
  type SearchScope,
  type SectionStatus,
} from './search-ops'

/**
 * FieldScout Mobile — full-screen search (gap list §3 #1; handoff m-match
 * §2.4 / §3.6). Opened from the Search button in the Home and League
 * headers, always on an empty query and All. It covers the header and the
 * dock (no backdrop, no animation); Cancel returns to the screen underneath
 * exactly as it was.
 *
 * Players come from the player search (a team code — "phi" — finds that
 * team's players too); People are the league's managers when you're inside
 * a league (a manager opens their team), then FieldScout people (a person
 * opens their profile); Posts are public lists for now. The empty query
 * shows Recent (kept on this phone) and Trending (Home's Risers).
 */
export function MobileSearch({ onClose }: { onClose: () => void }) {
  return (
    <MOverlay label="Search" onClose={onClose} className="leading-[normal]">
      <SearchPanel onClose={onClose} />
    </MOverlay>
  )
}

const TONE: Record<OwnerTone, string> = {
  mine: 'text-accent',
  other: 'text-m-t3',
  open: 'text-m-green',
  pre: 'text-m-to',
}

const HEADING = 'text-[13px] font-semibold text-m-t3'

/** The search screen's contents (exported for the render tests; the
 *  overlay itself portals after mount). */
export function SearchPanel({
  onClose,
  initialQuery = '',
  initialScope = 'all',
}: {
  onClose: () => void
  initialQuery?: string
  initialScope?: SearchScope
}) {
  const pathname = usePathname() ?? ''
  const leagueId = mobileRoute(pathname, null).leagueId
  const [raw, setRaw] = useState(initialQuery)
  const [scope, setScope] = useState<SearchScope>(initialScope)
  const [recent, setRecent] = useState<string[]>(() => readRecentSearches())
  const inputRef = useRef<HTMLInputElement>(null)

  const q = raw.trim()
  // The reads follow the typing a beat behind; the empty state doesn't wait.
  const [term, setTerm] = useState(q)
  useEffect(() => {
    if (term === q) return
    const id = setTimeout(() => setTerm(q), 200)
    return () => clearTimeout(id)
  }, [q, term])

  // The field takes focus in the same commit as the tap that opened the
  // search — iOS raises the keyboard only for a focus made while the tap is
  // being handled (not a frame later). The overlay leaves focus where it is.
  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  // The OS back gesture moves the screen underneath: the search goes with it.
  const [openedOn] = useState(pathname)
  useEffect(() => {
    if (pathname !== openedOn) onClose()
  }, [pathname, openedOn, onClose])

  const remember = (label: string) => {
    const next = withRecent(recent, label)
    setRecent(next)
    writeRecentSearches(next)
  }

  const clear = () => {
    setRaw('')
    inputRef.current?.focus({ preventScroll: true })
  }

  return (
    <>
      <form
        role="search"
        className="flex h-[52px] flex-none items-center gap-[10px] px-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (q) remember(q)
          inputRef.current?.blur()
        }}
      >
        <label className="flex h-[38px] min-w-0 flex-1 items-center gap-2 rounded-[12px] bg-m-b2 px-3">
          <MIcon name="search" size={15} stroke={1.8} className="text-m-t4" />
          <input
            ref={inputRef}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="Players, people and posts"
            aria-label="Search players, people and posts"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 border-0 bg-transparent text-[15px] font-medium text-m-t1 outline-none placeholder:text-m-t3"
          />
          {q && (
            <button
              type="button"
              onClick={clear}
              aria-label="Clear search"
              className="flex size-[18px] flex-none items-center justify-center rounded-full bg-m-b4l text-white"
            >
              <MIcon name="close" size={8} stroke={3} />
            </button>
          )}
        </label>
        <button type="button" onClick={onClose} className="flex-none text-[15px] font-medium text-accent">
          Cancel
        </button>
      </form>

      <div className="flex flex-none gap-[6px] overflow-x-auto px-4 pb-[10px] scrollbar-none" role="group" aria-label="Search in">
        {SEARCH_SCOPES.map((c) => {
          const on = scope === c.value
          return (
            <button
              key={c.value}
              type="button"
              aria-pressed={on}
              onClick={() => setScope(c.value)}
              className={cn(
                'flex h-[30px] flex-none items-center rounded-pill px-[14px] text-[13px] font-semibold',
                on ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1',
              )}
            >
              {c.label}
            </button>
          )
        })}
      </div>

      <MOverlayScroll className="px-4 pb-[calc(24px+env(safe-area-inset-bottom))]">
        {q ? (
          <Results raw={raw} term={term} scope={scope} leagueId={leagueId} remember={remember} onClose={onClose} />
        ) : (
          <EmptyQuery
            recent={recent}
            onPick={setRaw}
            onClearRecent={() => {
              setRecent([])
              writeRecentSearches([])
            }}
          />
        )}
      </MOverlayScroll>
    </>
  )
}

// ---------------------------------------------------------------------------
// Empty query: Recent + Trending
// ---------------------------------------------------------------------------

function EmptyQuery({ recent, onPick, onClearRecent }: { recent: readonly string[]; onPick: (label: string) => void; onClearRecent: () => void }) {
  const trend = useMobileHomeTrending(6)
  return (
    <>
      {recent.length > 0 && (
        <>
          <div className="flex items-center justify-between pb-1 pt-[6px]">
            <h2 className={HEADING}>Recent</h2>
            <button type="button" onClick={onClearRecent} className="text-[13px] font-semibold text-accent">
              Clear
            </button>
          </div>
          <ul>
            {recent.map((label) => (
              <li key={label}>
                <button type="button" onClick={() => onPick(label)} className="flex h-[42px] w-full items-center gap-[10px] border-b border-m-b2 text-left">
                  <MIcon name="history" size={14} stroke={1.6} className="text-m-t4" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-m-t1">{label}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {trend.isError ? (
        <>
          <h2 className={cn(HEADING, 'pb-2', recent.length ? 'pt-[18px]' : 'pt-[6px]')}>Trending</h2>
          <ProblemLine onRetry={() => void trend.refetch()}>Couldn’t load trending players.</ProblemLine>
        </>
      ) : trend.risers.length > 0 ? (
        <>
          <h2 className={cn(HEADING, 'pb-2', recent.length ? 'pt-[18px]' : 'pt-[6px]')}>Trending</h2>
          <div className="flex flex-wrap gap-[6px]">
            {trend.risers.map((e) => (
              <button
                key={e.player.id}
                type="button"
                onClick={() => onPick(e.player.full_name)}
                className="flex h-8 items-center gap-[5px] rounded-pill bg-m-b2 px-3 text-[13px] font-semibold text-m-t1"
              >
                <MIcon name="trend" size={11} stroke={2} />
                {e.player.full_name}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// A query: Players / People / Posts
// ---------------------------------------------------------------------------

interface LeagueContext {
  leagueId: string
  status: string | null
  myTeamId: string | null
  teamIds: string[]
  managers: SearchManager[]
  /** Who holds each player, once the league's reads are in (null before). */
  ownerOf: ((players: readonly PoolPlayer[]) => Map<string, Availability>) | null
  failed: boolean
  retry: () => void
}

/** The league the search was opened in: its managers and, per player,
 *  where he is (the rosters document + the pool rows — the Players tab's
 *  own derivation). Before a league has drafted, no roster read is needed. */
function useSearchLeague(leagueId: string | null): LeagueContext | null {
  const { user } = useAuth()
  const detail = useLeague(leagueId ?? undefined)
  const rosters = useRosters(leagueId ?? undefined)
  const pool = useLeaguePool(leagueId ?? undefined)
  const myUserId = user?.id ?? null
  return useMemo(() => {
    if (!leagueId) return null
    const d = detail.data
    const status = d?.league.status ?? null
    const myTeamId = d?.members.find((m) => m.user_id !== null && m.user_id === myUserId)?.team_id ?? null
    const preDraft = status !== null && isPreDraft(status)
    const ready = Boolean(d) && (preDraft || (rosters.data !== undefined && pool.data !== undefined))
    return {
      leagueId,
      status,
      myTeamId,
      teamIds: d ? d.teams.map((t) => t.id) : [],
      managers: d ? leagueManagers(d, myUserId) : [],
      ownerOf: ready
        ? (players) => new Map(poolRows(players, preDraft ? undefined : rosters.data, preDraft ? [] : (pool.data ?? []), myTeamId, 'all').map((r) => [r.player.id, r.availability]))
        : null,
      failed: detail.isError || (!preDraft && (rosters.isError || pool.isError)),
      retry: () => {
        void detail.refetch()
        void rosters.refetch()
        void pool.refetch()
      },
    }
  }, [leagueId, detail, rosters, pool, myUserId])
}

/** A typed query's sections (exported for the render tests: `term` is the
 *  query the reads answer for, a beat behind `raw` while typing). */
export function Results({
  raw,
  term,
  scope,
  leagueId,
  remember,
  onClose,
}: {
  raw: string
  term: string
  scope: SearchScope
  leagueId: string | null
  remember: (label: string) => void
  onClose: () => void
}) {
  const openPlayerView = usePlayerModalStore((s) => s.openPlayerView)
  const league = useSearchLeague(leagueId)
  const { players, community } = useMobileSearch(term)
  const asksCommunity = communityTerm(term).length > 0

  const playerRows = (term ? (players.data ?? []) : []).slice(0, sectionCap('players', scope))
  const owners = league?.ownerOf ? league.ownerOf(playerRows) : null

  const managers = league ? matchManagers(league.managers, raw) : []
  const managerIds = new Set(managers.map((m) => m.userId))
  const users: SearchUser[] = asksCommunity ? (community.data?.users ?? []).filter((u) => !managerIds.has(u.id)) : []
  const peopleCap = sectionCap('people', scope)
  const shownManagers = managers.slice(0, peopleCap)
  const shownUsers = users.slice(0, Math.max(0, peopleCap - shownManagers.length))

  const posts: SearchList[] = (asksCommunity ? (community.data?.lists ?? []) : []).slice(0, sectionCap('posts', scope))

  // Until the reads have caught up with the typing — and while the rows
  // drawn are the last query's — nothing answers what's typed yet.
  const current = term !== '' && term === raw.trim()
  const communityState: SectionStatus['state'] = !current ? 'pending' : !asksCommunity ? 'ready' : readState(current, community)
  const sections: Record<'players' | 'people' | 'posts', SectionStatus> = {
    players: { state: readState(current, players), count: playerRows.length },
    people: {
      state: communityState === 'ready' && league && !league.failed && league.status === null ? 'pending' : communityState,
      count: shownManagers.length + shownUsers.length,
    },
    posts: { state: communityState, count: posts.length },
  }
  const body = bodyState(scope, sections)
  const visible = (s: 'players' | 'people' | 'posts') => showsSection(scope, s) && (sections[s].count > 0 || sections[s].state === 'error')

  const openPlayer = (p: PoolPlayer) => {
    remember(p.full_name)
    onClose()
    openPlayerView(p.id, leagueId)
  }
  const leave = (label: string) => {
    remember(label)
    onClose()
  }

  return (
    <>
      {league?.failed && (showsSection(scope, 'players') || showsSection(scope, 'people')) && (
        <ProblemLine onRetry={league.retry}>Couldn’t load your league, so its teams aren’t shown.</ProblemLine>
      )}

      {visible('players') && (
        <section aria-label="Players">
          <h2 className={cn(HEADING, 'pb-[2px] pt-[6px]')}>Players</h2>
          {sections.players.state === 'error' && playerRows.length === 0 ? (
            <ProblemLine onRetry={() => void players.refetch()}>Couldn’t search players.</ProblemLine>
          ) : (
            <ul>
              {playerRows.map((p) => {
                const a = owners?.get(p.id)
                return (
                  <li key={p.id}>
                    <PlayerRow player={p} owner={a && league?.status ? ownerLabel(a, league.status) : null} onOpen={() => openPlayer(p)} />
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {visible('people') && (
        <section aria-label="People">
          <h2 className={cn(HEADING, 'pb-[2px] pt-4')}>People</h2>
          <ul>
            {league &&
              shownManagers.map((m) => (
                <li key={`${m.teamId}:${m.userId}`}>
                  <ManagerRow manager={m} league={league} onOpen={leave} />
                </li>
              ))}
            {shownUsers.map((u) => (
              <li key={u.id}>
                <PersonRow user={u} onOpen={leave} />
              </li>
            ))}
          </ul>
          {communityState === 'error' && <ProblemLine onRetry={() => void community.refetch()}>Couldn’t search people.</ProblemLine>}
        </section>
      )}

      {visible('posts') && (
        <section aria-label="Posts">
          <h2 className={cn(HEADING, 'pb-[2px] pt-4')}>Posts</h2>
          {sections.posts.state === 'error' && posts.length === 0 ? (
            <ProblemLine onRetry={() => void community.refetch()}>Couldn’t search posts.</ProblemLine>
          ) : (
            <ul>
              {posts.map((l) => (
                <li key={l.id}>
                  <PostRow list={l} onOpen={leave} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {body === 'searching' && <p className="py-10 text-center text-[14px] font-medium text-m-t3">Searching…</p>}
      {body === 'none' && <p className="py-10 text-center text-[14px] font-medium text-m-t3">No results</p>}
    </>
  )
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function PlayerRow({ player, owner, onOpen }: { player: PoolPlayer; owner: OwnerLabel | null; onOpen: () => void }) {
  const meta = [posLabel(player.position), player.team].filter(Boolean).join(' · ')
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-[10px] border-b border-m-b2 py-2 text-left">
      <MHeadshot player={player} size={34} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[14px] font-semibold text-m-t1">{player.full_name}</span>
        <span className="text-[11px] font-medium text-m-t3">{meta}</span>
      </span>
      {owner && <span className={cn('max-w-[40%] flex-none truncate text-[11px] font-semibold', TONE[owner.tone])}>{owner.text}</span>}
    </button>
  )
}

/** A league manager: opens their team (the row is the door, so the handle
 *  is plain text inside it). */
function ManagerRow({ manager, league, onOpen }: { manager: SearchManager; league: LeagueContext; onOpen: (label: string) => void }) {
  const handle = `@${manager.username}`
  return (
    <Link href={teamPageHref(league.leagueId, manager.teamId)} onClick={() => onOpen(handle)} className="flex items-center gap-[10px] border-b border-m-b2 py-2">
      <UserAvatar
        src={manager.avatarUrl}
        name={manager.username}
        initials={handleInitials(manager.username)}
        className="size-[34px] flex-none"
        fallbackClassName={cn(teamAvatarClass(league.teamIds, manager.teamId, league.myTeamId), 'text-[13px] font-semibold text-white')}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-[14px] font-semibold text-m-t1">{handle}</span>
        <span className="truncate whitespace-nowrap text-[11px] font-medium text-m-t3">{managerSub(manager.teamName)}</span>
      </span>
    </Link>
  )
}

/** A FieldScout person: opens their profile (the row is the link). */
function PersonRow({ user, onOpen }: { user: SearchUser; onOpen: (label: string) => void }) {
  const handle = `@${user.username}`
  return (
    <Link href={userProfileHref(user.username)} onClick={() => onOpen(handle)} className="flex items-center gap-[10px] border-b border-m-b2 py-2">
      <AuthorAvatar author={{ profileId: user.id, username: user.username, avatarUrl: user.avatar_url, followers: user.follower_count, isPersona: false }} size={34} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-[14px] font-semibold text-m-t1">{handle}</span>
        <span className="truncate whitespace-nowrap text-[11px] font-medium text-m-t3">{formatFollows(user.follower_count)}</span>
      </span>
    </Link>
  )
}

/** A public list ("List" pill, title, author). The row opens the list, so
 *  the author's handle is plain text inside it. */
function PostRow({ list, onOpen }: { list: SearchList; onOpen: (label: string) => void }) {
  const handle = list.owner_username ? `@${list.owner_username}` : null
  return (
    <Link href={postHref(list.id, featureFlags.community)} onClick={() => onOpen(list.title)} className="flex items-center gap-[10px] border-b border-m-b2 py-[10px]">
      <span className="flex h-5 flex-none items-center rounded-pill bg-m-ink px-[7px] text-[10px] font-semibold text-white">List</span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[14px] font-semibold text-m-t1">{list.title}</span>
        {handle && <span className="truncate text-[11px] font-medium text-m-t3">{handle}</span>}
      </span>
    </Link>
  )
}

function ProblemLine({ children, onRetry }: { children: React.ReactNode; onRetry: () => void }) {
  return (
    <p role="alert" className="py-3 text-[13px] font-medium text-m-t3">
      {children}{' '}
      <button type="button" onClick={onRetry} className="font-semibold text-accent">
        Try again
      </button>
    </p>
  )
}
