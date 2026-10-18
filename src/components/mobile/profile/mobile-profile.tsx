'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect } from 'react'

import {
  ME_TABS,
  MY_RANKINGS_HREF,
  NEW_RANKING_HREF,
  RANKING_SUB_CLASS,
  credCard,
  listRowSub,
  parseMeTab,
  plural,
  rankingEditHref,
  rankingRowSub,
  rankingRowTitle,
  resolveMeTab,
  sortRankingRows,
  sortSsQuestions,
  ssIsOpen,
  ssPreviewSub,
  ssTitle,
  type MeTab,
} from '@/components/mobile/profile/profile-ops'
import { useProfileTabStore } from '@/components/mobile/profile/profile-tab-store'
import { positionRankings } from '@/components/mobile/rankings/position-rankings'
import { rankingStatus } from '@/components/mobile/rankings/rankings-ops'
import { M_ICON, MIcon } from '@/components/mobile/ui/m-icon'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'
import { MSegmented } from '@/components/mobile/ui/m-segmented'
import { UsernameLink } from '@/components/shared/username-link'
import { Progress } from '@/components/ui/progress'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useAuth } from '@/hooks/use-auth'
import { useLeagues } from '@/hooks/use-leagues'
import { useLists } from '@/hooks/use-lists'
import { useMobileProfileListMeta } from '@/hooks/use-mobile-profile-list-meta'
import { useMyRankingBoards } from '@/hooks/use-mobile-rankings-boards'
import { useMobileProfileStartSit } from '@/hooks/use-mobile-profile-start-sit'
import { useMobileProfileTitles } from '@/hooks/use-mobile-profile-titles'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'
import { useThemeStore } from '@/stores/theme-store'
import { NEW_LIST_FROM_ELSEWHERE_HREF } from '@/components/mobile/lists/lists-nav'

/** The design's up-and-down arrows (Start/Sit rows, §5). */
const START_SIT_PATH = 'M5 3v10M2.5 10.5L5 13l2.5-2.5M11 13V3M8.5 5.5L11 3l2.5 2.5'

/**
 * Profile — the account root in the mobile layout (handoff `m-profile.md`
 * P0–P5): "Profile" + the Dark/Light pill (where mobile dark mode is
 * switched), the user's identity and stats, then "My stuff" — Rankings /
 * Lists / Start/Sit previews with a contextual create button.
 *
 * The header scrolls away with the content (it is inside the scroller in the
 * handoff, not sticky). The shell already clears the dock below.
 *
 * `currentWeek` is the NFL week (the route's server read, as Rankings has
 * it): it names the season ranking (Pre-draft / Rest of season) and marks
 * played weeks Finalized.
 */
export function MobileProfile({ currentWeek }: { currentWeek: number }) {
  const { user, profile, isLoading } = useAuth()

  return (
    <MobileScreen>
      <div className="px-4 pb-6">
        <div className="flex h-12 items-center justify-between">
          <h2 className="text-[28px] font-semibold leading-normal tracking-[-0.03em]">Profile</h2>
          <div className="flex items-center gap-2">
            {/* Not in the handoff: account settings (avatar, sign-in,
                notifications — desktop's "Edit profile") need a door on
                mobile, and the Menu sheet's Settings tile only exists inside
                a league. Same 34px b2 circle as the design's round buttons. */}
            <Link
              href="/app/settings"
              aria-label="Account settings"
              title="Account settings"
              className="flex size-[34px] flex-none items-center justify-center rounded-full bg-m-b2 text-m-t1"
            >
              <MIcon name="gear" size={16} stroke={1.5} />
            </Link>
            <ThemePill />
          </div>
        </div>

        {isLoading ? (
          <IdentitySkeleton />
        ) : !profile ? (
          <p className="py-9 text-center text-[13px] font-medium text-m-t3">
            We couldn&apos;t load your profile. Refresh to try again.
          </p>
        ) : (
          <Identity
            username={profile.username}
            avatarUrl={profile.avatar_url}
            bio={profile.bio}
            credScore={profile.cred_score ?? 0}
            followers={profile.follower_count ?? 0}
            following={profile.following_count ?? 0}
          />
        )}

        <MyStuff userId={user?.id} currentWeek={currentWeek} />
      </div>
    </MobileScreen>
  )
}

/** Moon + "Dark" in light mode, sun + "Light" in dark mode (§2 P0.1). */
function ThemePill() {
  const dark = useThemeStore((s) => s.dark)
  const toggle = useThemeStore((s) => s.toggle)
  const tip = dark ? 'Switch to light mode' : 'Switch to dark mode'
  return (
    <button
      type="button"
      onClick={toggle}
      title={tip}
      aria-label={tip}
      className="flex h-[34px] items-center gap-1.5 rounded-pill bg-m-b2 pl-2.5 pr-3 text-[13px] font-semibold text-m-t1"
    >
      <MIcon name={dark ? 'sun' : 'moon'} size={16} stroke={1.5} />
      {dark ? 'Light' : 'Dark'}
    </button>
  )
}

/**
 * Avatar, the handle, the bio and the stats (§2 P0.2–3). FieldScout keeps no
 * display name — the handle is the only name (ruling 2026-08-05) — so the
 * handle takes the 18/700 name line and the t3 line below keeps the rest of
 * the design's "@handle · N leagues": the league count, while leagues are on.
 *
 * Not in the handoff, kept from desktop's profile (gap list §3 #21):
 *  - The bio, full width under the avatar row in the handoff's paragraph
 *    style (13/500 t2, 1.45), as phone profiles put it. Nothing when empty.
 *  - Following beside Followers. The design's first card, Ranking accuracy,
 *    has no data (no grading job writes it); the cred score that stood in
 *    for it moves into the Cred card, so the row is Followers · Following ·
 *    Titles. Titles = leagues won (champion = the team you manage). Leagues
 *    are a gated test cohort; while they're off there is nothing to count
 *    and the two remaining cards share the row.
 *  - A slim Cred card: Scout tier, cred and the bar to the next tier.
 */
function Identity({
  username,
  avatarUrl,
  bio,
  credScore,
  followers,
  following,
}: {
  username: string
  avatarUrl: string | null
  bio: string | null
  credScore: number
  followers: number
  following: number
}) {
  const leaguesOn = featureFlags.leagues
  const leagues = useLeagues({ enabled: leaguesOn })
  const titles = useMobileProfileTitles(leagues.data, leaguesOn)
  const sub = leaguesOn && leagues.data ? plural(leagues.data.length, 'league', 'leagues') : null
  const about = bio?.trim()

  return (
    <>
      <div className="mt-2 flex items-center gap-[14px]">
        <UserAvatar
          src={avatarUrl}
          name={username}
          className="size-16 flex-none"
          fallbackClassName="bg-accent text-[24px] font-semibold text-white"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* A username is always a door to that person's profile (D462) —
              here, your own public page (desktop's "View public profile"). */}
          <UsernameLink username={username} className="truncate text-[18px] font-bold tracking-[-0.02em]" />
          {sub && <span className="text-[13px] font-medium text-m-t3">{sub}</span>}
        </div>
      </div>

      {about && (
        <p
          className="mt-3 whitespace-pre-line break-words text-[13px] font-medium leading-[1.45] text-m-t2 text-pretty"
          data-profile-bio
        >
          {about}
        </p>
      )}

      <div className={cn('mt-4 grid gap-2', leaguesOn ? 'grid-cols-3' : 'grid-cols-2')}>
        <StatCard value={followers.toLocaleString('en-US')} label="Followers" />
        <StatCard value={following.toLocaleString('en-US')} label="Following" />
        {leaguesOn && (
          // "–" while loading or when the read fails — never a guessed 0.
          <StatCard value={titles.data !== undefined ? titles.data.toLocaleString('en-US') : '–'} label="Titles" />
        )}
      </div>

      <CredCardView credScore={credScore} />
    </>
  )
}

/**
 * The slim Cred card under the stats — not in the handoff, so it is drawn in
 * the stat cards' language (b1, 14px radius, 10/12 padding) with the
 * handoff's meter (4px pill, b3 track): tier dot + Scout tier name and the
 * cred score, the bar, then "Scout tier N of 10" and what's left to the
 * next tier. Read-only, like the stat cards.
 */
function CredCardView({ credScore }: { credScore: number }) {
  const card = credCard(credScore)
  return (
    <div className="mt-2 flex flex-col rounded-[14px] bg-m-b1 px-3 py-2.5" data-profile-cred>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5">
          {/* The tier's own colour, from the tier table (desktop's badge dot). */}
          <span aria-hidden className="size-2 flex-none rounded-full" style={{ backgroundColor: card.accent }} />
          <span className="truncate text-[15px] font-bold tracking-[-0.01em]">{card.tier}</span>
        </span>
        <span className="flex-none text-[12px] font-semibold tabular-nums text-m-t3">{card.score}</span>
      </div>
      <Progress
        value={card.pct}
        aria-label={card.barLabel}
        className="mt-2 h-1 bg-m-b3"
        indicatorClassName="bg-accent"
      />
      <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] font-medium">
        <span className="truncate text-m-t3">{card.level}</span>
        <span className={cn('flex-none tabular-nums', card.top ? 'font-semibold text-m-tg' : 'text-m-t3')}>
          {card.next}
        </span>
      </div>
    </div>
  )
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[14px] bg-m-b1 px-3 py-2.5">
      <span className="truncate text-[17px] font-bold tabular-nums">{value}</span>
      <span className="text-[11px] font-medium text-m-t3">{label}</span>
    </div>
  )
}

function IdentitySkeleton() {
  return (
    <div aria-hidden>
      <div className="mt-2 flex items-center gap-[14px]">
        <span className="size-16 flex-none rounded-full bg-m-b1" />
        <span className="flex flex-1 flex-col gap-2">
          <span className="h-[18px] w-32 rounded-md bg-m-b1" />
          <span className="h-[13px] w-40 rounded-md bg-m-b1" />
        </span>
      </div>
      <div className={cn('mt-4 grid gap-2', featureFlags.leagues ? 'grid-cols-3' : 'grid-cols-2')}>
        {(featureFlags.leagues ? [0, 1, 2] : [0, 1]).map((i) => (
          <span key={i} className="h-[56px] rounded-[14px] bg-m-b1" />
        ))}
      </div>
      {/* The Cred card's height. */}
      <span className="mt-2 block h-[77px] rounded-[14px] bg-m-b1" />
    </div>
  )
}

/**
 * "My stuff": segmented Rankings / Lists / Start/Sit (only the released
 * surfaces — Rankings and Start/Sit follow their launch flags), preview rows
 * from the user's real content, and the segment's create button. `?tab=`
 * picks the segment (Home's My stuff tiles); otherwise the last segment of
 * the session is kept.
 */
const SEE_ALL_HREF: Record<MeTab, string> = {
  lists: '/app/lists',
  rankings: MY_RANKINGS_HREF,
  ss: '/app/start-or-sit',
}

function MyStuff({ userId, currentWeek }: { userId: string | undefined; currentWeek: number }) {
  const params = useSearchParams()
  const stored = useProfileTabStore((s) => s.tab)
  const setStored = useProfileTabStore((s) => s.setTab)

  const available = ME_TABS.filter(
    (t) =>
      t.value === 'lists' ||
      (t.value === 'rankings' && featureFlags.weeklyRanks) ||
      (t.value === 'ss' && featureFlags.startOrSit),
  )
  const requested = parseMeTab(params.get('tab'))
  const tab = resolveMeTab(
    requested ?? stored,
    available.map((t) => t.value),
  )

  // A `?tab=` arrival (Home's My stuff tiles) becomes the session's segment,
  // as the handoff's `set({ meTab })` does — the Profile tab reopens on it.
  useEffect(() => {
    if (requested) setStored(requested)
  }, [requested, setStored])

  const select = (next: MeTab) => {
    setStored(next)
    // Keep the URL in step so a reload or a shared link reopens this segment.
    const url = new URL(window.location.href)
    url.searchParams.set('tab', next)
    window.history.replaceState(window.history.state, '', url)
  }

  return (
    <>
      <div className="mt-5 flex items-baseline justify-between">
        <h3 className="text-[17px] font-semibold leading-normal tracking-[-0.01em]">My stuff</h3>
        {/* The whole of the segment — the design's rows open the Lists grid
            (Saved tab included); ours open the row's own item, so the grid
            gets its own door. */}
        <Link href={SEE_ALL_HREF[tab]} className="text-[13px] font-semibold text-accent" data-my-stuff-see-all>
          See all
        </Link>
      </div>
      {available.length > 1 && (
        <MSegmented
          label="My stuff"
          options={available}
          value={tab}
          onChange={select}
          className="mt-2"
          itemClassName="h-8 transition-none"
        />
      )}
      {tab === 'rankings' ? (
        <RankingsPreview currentWeek={currentWeek} />
      ) : tab === 'ss' ? (
        <StartSitPreview userId={userId} />
      ) : (
        <ListsPreview userId={userId} />
      )}
    </>
  )
}

/**
 * One row per position ranking — the cards My rankings shows — newest save
 * first, each opening that ranking (gap list §3 #22). The same read as the
 * Rankings screen, so the two share one cache entry.
 */
function RankingsPreview({ currentWeek }: { currentWeek: number }) {
  const boards = useMyRankingBoards()
  const rows = boards.data ? sortRankingRows(positionRankings(boards.data)).slice(0, 3) : []

  return (
    <>
      <PreviewBody
        loading={boards.isPending}
        error={boards.isError ? { copy: 'Couldn’t load your rankings.', retry: () => void boards.refetch() } : null}
        emptyCopy="No rankings yet"
        count={rows.length}
      >
        {rows.map((r) => (
          <PreviewRow
            key={r.key}
            href={rankingEditHref(r.type, r.pos)}
            iconPath={M_ICON.rank}
            title={rankingRowTitle(r, currentWeek)}
            sub={rankingRowSub(r, currentWeek)}
            subClassName={RANKING_SUB_CLASS[rankingStatus(r.type, currentWeek)]}
          />
        ))}
      </PreviewBody>
      <CreateButton href={NEW_RANKING_HREF}>New ranking</CreateButton>
    </>
  )
}

/**
 * The user's own lists, newest first — weekly ranking boards left out (the
 * weekly-ranks API stores them as lists; they show under Rankings). The same
 * 100-list read Home's My stuff makes, so the two share one cache entry.
 */
function ListsPreview({ userId }: { userId: string | undefined }) {
  const lists = useLists(1, 100)
  const meta = useMobileProfileListMeta(userId)
  const weekly = new Set(meta.data?.weeklyBoardIds ?? [])
  const videos = new Set(meta.data?.videoListIds ?? [])
  // Own lists only (a saved list from someone else carries its `owner`).
  const rows = (lists.data?.lists ?? []).filter((l) => !l.owner && !weekly.has(l.id)).slice(0, 3)

  return (
    <>
      <PreviewBody
        loading={lists.isLoading || meta.isLoading || !userId}
        error={
          lists.isError || meta.isError
            ? {
                copy: 'Couldn’t load your lists.',
                retry: () => {
                  if (lists.isError) void lists.refetch()
                  if (meta.isError) void meta.refetch()
                },
              }
            : null
        }
        emptyCopy="No lists yet"
        count={rows.length}
      >
        {rows.map((l) => (
          <PreviewRow
            key={l.id}
            href={`/app/lists/${l.id}`}
            iconPath={M_ICON.lists}
            title={l.title}
            sub={listRowSub(l, videos.has(l.id))}
          />
        ))}
      </PreviewBody>
      <CreateButton href={NEW_LIST_FROM_ELSEWHERE_HREF}>New list</CreateButton>
    </>
  )
}

/**
 * The user's own questions (first four, My start/sit's order), each opening
 * My start/sit on All (§3). "Ask a question" is left out: the app has no
 * start/sit composer. With no rows, the design's "No questions here yet".
 */
function StartSitPreview({ userId }: { userId: string | undefined }) {
  const { data, isLoading, isError, refetch } = useMobileProfileStartSit(userId)
  // Read once per render — the open/closed split is a moment in time.
  const now = Date.now()
  const rows = sortSsQuestions(data ?? [], now).slice(0, 4)

  return (
    <PreviewBody
      loading={isLoading || !userId}
      error={isError ? { copy: 'Couldn’t load your questions.', retry: () => void refetch() } : null}
      emptyCopy="No questions here yet"
      count={rows.length}
    >
      {rows.map((q) => (
        <PreviewRow
          key={q.id}
          href="/app/start-or-sit"
          iconPath={START_SIT_PATH}
          title={ssTitle(q)}
          sub={ssPreviewSub(q, now)}
          subClassName={ssIsOpen(q, now) ? 'text-m-green' : 'text-m-t3'}
        />
      ))}
    </PreviewBody>
  )
}

function PreviewBody({
  loading,
  error,
  emptyCopy,
  count,
  children,
}: {
  loading: boolean
  error: { copy: string; retry: () => void } | null
  emptyCopy: string
  count: number
  children: React.ReactNode
}) {
  if (loading) {
    return (
      <div className="mt-1.5 flex flex-col" aria-busy="true" aria-label="Loading">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 border-b border-m-b2 py-3">
            <span className="size-10 flex-none rounded-[12px] bg-m-b1" />
            <span className="flex flex-1 flex-col gap-1.5">
              <span className="h-[15px] w-3/5 rounded-md bg-m-b1" />
              <span className="h-3 w-2/5 rounded-md bg-m-b1" />
            </span>
          </div>
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <div className="mt-1.5 flex flex-col items-center gap-2 py-9 text-center">
        <p className="text-[13px] font-medium text-m-t3">{error.copy}</p>
        <button type="button" onClick={error.retry} className="text-[13px] font-semibold text-accent">
          Try again
        </button>
      </div>
    )
  }
  if (count === 0) {
    return <p className="mt-1.5 py-9 text-center text-[13px] font-medium text-m-t3">{emptyCopy}</p>
  }
  return <div className="mt-1.5 flex flex-col">{children}</div>
}

/** 40px icon tile · title / sub · chevron, ruled off below (§2 P0.6). */
function PreviewRow({
  href,
  iconPath,
  title,
  sub,
  subClassName = 'text-m-t3',
}: {
  href: string
  iconPath: string
  title: string
  sub: string
  subClassName?: string
}) {
  return (
    <Link href={href} className="flex items-center gap-3 border-b border-m-b2 py-3 text-m-t1">
      <span className="flex size-10 flex-none items-center justify-center rounded-[12px] bg-m-b2">
        <svg
          viewBox="0 0 16 16"
          width={18}
          height={18}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={iconPath} />
        </svg>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-semibold">{title}</span>
        <span className={cn('text-[12px] font-medium', subClassName)}>{sub}</span>
      </span>
      <MIcon name="chevronRight" size={12} stroke={2} className="text-m-t5" />
    </Link>
  )
}

/** Outlined 44px button with a plus (§2 P0.7). */
function CreateButton({
  href,
  onClick,
  children,
}: {
  href?: string
  onClick?: () => void
  children: React.ReactNode
}) {
  const cls =
    'mt-[14px] flex h-11 w-full items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] border-m-b3s text-[14px] font-semibold text-m-t1'
  const body = (
    <>
      <MIcon name="avail" size={12} stroke={2.2} />
      {children}
    </>
  )
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  )
}
