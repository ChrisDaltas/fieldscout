'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { MessagesAvatar } from '@/components/mobile/messages/messages-avatar'
import { LeagueMenuSheet } from '@/components/mobile/shell/league-menu-sheet'
import { LeagueSwitchSheet } from '@/components/mobile/shell/league-switch-sheet'
import { DOCK_LG, DOCK_SM, leagueTabHref, mobileRoute, showsLeagueSwitcher, type LeagueTab } from '@/components/mobile/shell/mobile-nav'
import { initials, leagueAvClass, switchedToTitle, useLeagueCard } from '@/components/mobile/shell/use-league-card'
import { MIcon, type MIconName } from '@/components/mobile/ui/m-icon'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useAuth } from '@/hooks/use-auth'
import { useLeague } from '@/hooks/use-league'
import { useLeagues, type MyLeagueRow } from '@/hooks/use-leagues'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'
import { useMobileNavStore } from '@/stores/mobile-nav-store'
import { toast } from '@/hooks/use-toast'

/**
 * Which dock a mobile route gets, plus the bottom clearance its scroller needs
 * (handoff §2.1: 84px with the tab bar alone, 150px with the switcher strip).
 */
export function useMobileDock() {
  const pathname = usePathname()
  const { data: leagues } = useLeagues({ enabled: featureFlags.leagues })
  const lastLeagueId = useMobileNavStore((s) => s.lastLeagueId)
  const setLastLeagueId = useMobileNavStore((s) => s.setLastLeagueId)

  const leagueIdInPath = /^\/app\/leagues\/([^/]+)/.exec(pathname)?.[1] ?? null
  const myTeamId = leagues?.find((l) => l.id === leagueIdInPath)?.my_team_id ?? null
  const route = mobileRoute(pathname, myTeamId)

  // League context persists through league sub-screens (Notifications,
  // Messages, …) and clears on an account tab (navigation §(c)).
  useEffect(() => {
    if (route.leagueId) setLastLeagueId(route.leagueId)
    else if (route.accountTab) setLastLeagueId(null)
  }, [route.leagueId, route.accountTab, setLastLeagueId])

  const leagueId = route.leagueId ?? (route.accountTab ? null : lastLeagueId)
  const inLeague = featureFlags.leagues && leagueId !== null
  const showSwitcher = showsLeagueSwitcher(inLeague, route.leagueTab, leagues?.length ?? 0)
  return {
    route,
    leagueId: inLeague ? leagueId : null,
    showSwitcher,
    clearance: showSwitcher ? DOCK_LG : DOCK_SM,
    leagues: leagues ?? [],
  }
}

/**
 * The FieldScout Mobile bottom dock (handoff §2.1–2.3): the league switcher
 * strip (league tabs only, and only with more than one league) over the tab
 * bar. Two translucent surfaces with
 * different alphas — the visible seam between them is in the design. Content
 * scrolls behind the dock.
 */
export function MobileDock() {
  const dock = useMobileDock()
  const setMenuOpen = useMobileNavStore((s) => s.setMenuOpen)
  const menuOpen = useMobileNavStore((s) => s.menuOpen)
  const switchOpen = useMobileNavStore((s) => s.switchOpen)
  const setSwitchOpen = useMobileNavStore((s) => s.setSwitchOpen)
  const league = dock.leagues.find((l) => l.id === dock.leagueId) ?? null

  // The dock's height for things that float above it outside the shell
  // (the toast viewport): 84px with the tab bar alone, 150px with the
  // switcher strip. Cleared when the dock goes (the draft room, desktop).
  useEffect(() => {
    const html = document.documentElement
    html.style.setProperty('--m-dock-h', `${dock.clearance}px`)
    return () => {
      html.style.removeProperty('--m-dock-h')
    }
  }, [dock.clearance])

  return (
    <>
      {/* Frosted, like an iOS tab bar (Chris, 2026-10-17: "it's see through
          without any blur so it's hard to see"): the bars keep their
          translucent fills, and what scrolls under them is blurred instead
          of showing through sharp. The landing header's recipe. */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col backdrop-blur-xl backdrop-saturate-[1.8]" data-mobile-dock>
        {dock.showSwitcher && league && (
          <LeagueSwitcher league={league} leagues={dock.leagues} tab={dock.route.leagueTab!} onOpen={() => setSwitchOpen(true)} />
        )}
        {dock.leagueId && league ? (
          <LeagueTabBar
            league={league}
            active={menuOpen ? null : dock.route.leagueTab}
            menuOpen={menuOpen}
            onMenu={() => setMenuOpen(!menuOpen)}
          />
        ) : (
          <AccountTabBar active={dock.route.accountTab} />
        )}
      </div>
      {league && (
        <>
          <LeagueMenuSheet open={menuOpen} onOpenChange={setMenuOpen} league={league} />
          <LeagueSwitchSheet
            open={switchOpen}
            onOpenChange={setSwitchOpen}
            current={league}
            leagues={dock.leagues}
            tab={dock.route.leagueTab ?? 'match'}
          />
        </>
      )}
    </>
  )
}

const TAB_ON = 'text-white'
const TAB_OFF = 'text-fs-on-ink-2'

/** Tab bar shell: 80px of item row + home-indicator zone (safe area). */
function TabBar({ children }: { children: React.ReactNode }) {
  return (
    <nav
      className="relative flex bg-m-bar-a px-2 pb-[max(26px,env(safe-area-inset-bottom))] pt-1.5"
      aria-label="Main"
    >
      {children}
    </nav>
  )
}

function TabItem({
  href,
  onClick,
  label,
  icon,
  on,
  children,
}: {
  href?: string
  onClick?: () => void
  label: string
  icon?: MIconName
  on: boolean
  children?: React.ReactNode
}) {
  const body = (
    <>
      {children ?? (icon ? <MIcon name={icon} size={22} /> : null)}
      <span className="text-[10px] font-semibold">{label}</span>
    </>
  )
  const cls = cn('flex h-12 flex-1 flex-col items-center justify-center gap-[3px]', on ? TAB_ON : TAB_OFF)
  return href ? (
    <Link href={href} className={cls} aria-current={on ? 'page' : undefined}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls} aria-pressed={on}>
      {body}
    </button>
  )
}

/** Outside a league: Home · Community · Players · Profile (avatar).
 *  Community shows only while its switch is on (launch scope). */
function AccountTabBar({ active }: { active: string | null }) {
  const { profile } = useAuth()
  return (
    <TabBar>
      <TabItem href="/app" label="Home" icon="home" on={active === 'home'} />
      {featureFlags.community && <TabItem href="/app/explore" label="Community" icon="star" on={active === 'community'} />}
      <TabItem href="/app/research" label="Players" icon="players" on={active === 'players'} />
      <TabItem href="/app/profile" label="Profile" on={active === 'profile'}>
        <span
          className={cn(
            'flex size-[22px] items-center justify-center rounded-full',
            active === 'profile' && 'shadow-m-tab-avatar',
          )}
        >
          <UserAvatar
            src={profile?.avatar_url ?? null}
            name={profile?.username ?? 'You'}
            className="size-[22px] !rounded-pill"
            fallbackClassName="bg-accent text-[10px] font-semibold text-white"
          />
        </span>
      </TabItem>
    </TabBar>
  )
}

/** Inside a league: Match · Team · Players · League · Menu. */
function LeagueTabBar({
  league,
  active,
  menuOpen,
  onMenu,
}: {
  league: MyLeagueRow
  active: LeagueTab | null
  menuOpen: boolean
  onMenu: () => void
}) {
  const href = (t: LeagueTab) => leagueTabHref(league.id, t, league.my_team_id)
  return (
    <TabBar>
      <TabItem href={href('match')} label="Match" icon="match" on={active === 'match'} />
      <TabItem href={href('team')} label="Team" icon="players" on={active === 'team'} />
      <TabItem href={href('players')} label="Players" icon="search" on={active === 'players'} />
      <TabItem href={href('league')} label="League" icon="leaders" on={active === 'league'} />
      <TabItem onClick={onMenu} label="Menu" icon="menu" on={menuOpen} />
    </TabBar>
  )
}

/**
 * The floating league switcher card (handoff §2.2 + gesture spec): swipe left
 * or right to move to the next / previous league on the same tab, swipe up or
 * tap to open the Switch league sheet. The row slides out and in again
 * (140ms linear); the card and its grab pill stay put. A swipe says
 * "Switched to {your team there}" — both neighbours' details are read ahead
 * so the name is ready (and warm for the screen the swipe opens).
 */
function LeagueSwitcher({
  league,
  leagues,
  tab,
  onOpen,
}: {
  league: MyLeagueRow
  leagues: MyLeagueRow[]
  tab: LeagueTab
  onOpen: () => void
}) {
  const router = useRouter()
  const index = Math.max(0, leagues.findIndex((l) => l.id === league.id))
  const card = useLeagueCard(league)
  const after = leagues[(index + 1) % leagues.length] ?? league
  const before = leagues[(index - 1 + leagues.length) % leagues.length] ?? league
  const afterDetail = useLeague(after.id)
  const beforeDetail = useLeague(before.id)
  const [dx, setDx] = useState(0)
  const [anim, setAnim] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)

  const step = (d: 1 | -1) => {
    if (leagues.length < 2) {
      setAnim(true)
      setDx(0)
      return
    }
    const next = d > 0 ? after : before
    setAnim(true)
    setDx(d > 0 ? -120 : 120)
    toast({ title: switchedToTitle(next, (d > 0 ? afterDetail : beforeDetail).data) })
    window.setTimeout(() => {
      setAnim(false)
      setDx(d > 0 ? 120 : -120)
      router.push(leagueTabHref(next.id, tab, next.my_team_id))
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setAnim(true)
          setDx(0)
        }),
      )
    }, 140)
  }

  return (
    <div className="relative bg-m-dock px-2 py-1.5">
      <div
        role="button"
        tabIndex={0}
        aria-label={`${card.teamName}, ${league.name}. Swipe to switch league, tap to see all leagues.`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onOpen()
          if (e.key === 'ArrowLeft') step(-1)
          if (e.key === 'ArrowRight') step(1)
        }}
        onPointerDown={(e) => {
          start.current = { x: e.clientX, y: e.clientY }
          e.currentTarget.setPointerCapture(e.pointerId)
          setAnim(false)
        }}
        onPointerMove={(e) => {
          const s = start.current
          if (!s) return
          const ddx = e.clientX - s.x
          const ddy = e.clientY - s.y
          if (Math.abs(ddx) > Math.abs(ddy)) setDx(Math.max(-140, Math.min(140, ddx)))
          else if (ddy < -24) {
            start.current = null
            setDx(0)
            onOpen()
          }
        }}
        onPointerUp={(e) => {
          const s = start.current
          start.current = null
          if (!s) return
          const ddx = e.clientX - s.x
          const ddy = e.clientY - s.y
          if (Math.abs(ddx) > 50 && Math.abs(ddx) > Math.abs(ddy)) step(ddx < 0 ? 1 : -1)
          else if ((Math.abs(ddx) < 8 && Math.abs(ddy) < 8) || ddy < -24) {
            setAnim(true)
            setDx(0)
            onOpen()
          } else {
            setAnim(true)
            setDx(0)
          }
        }}
        onPointerCancel={() => {
          start.current = null
          setAnim(true)
          setDx(0)
        }}
        className="relative h-14 cursor-grab touch-none select-none overflow-hidden rounded-[10px] bg-m-mini text-white"
        data-league-switcher
      >
        <span aria-hidden className="absolute left-1/2 top-1 h-[3px] w-7 -translate-x-1/2 rounded-pill bg-white/[0.28]" />
        <div
          className="flex h-full items-center gap-2.5 px-4 pt-1.5"
          style={{
            transform: `translateX(${dx}px)`,
            opacity: Math.max(0.2, 1 - Math.abs(dx) / 200),
            transition: anim ? 'transform .14s linear, opacity .14s linear' : 'none',
          }}
        >
          <MessagesAvatar
            text={initials(league.name)}
            src={league.avatar_url}
            sizeClass="size-[34px]"
            radiusClass="rounded-[10px]"
            colorClass={leagueAvClass(index)}
            fgClass="text-inherit"
            textClass="text-[12px]"
          />
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="flex min-w-0 items-baseline gap-1 text-[14px] font-semibold">
              <span className="min-w-0 truncate">{card.teamName}</span>
              {card.recordShort && (
                <span className="flex-none whitespace-nowrap text-[12px] font-medium text-white/[0.62]">{card.recordShort}</span>
              )}
            </span>
            <span className="truncate text-[11px] font-medium text-white/[0.62]">{league.name}</span>
          </span>
          {/* The "you are here" dash is plain white in both themes, like the
              card's text: the handoff's var(--x-b0) turns #121212 in dark
              mode and vanishes on the #090909 card (gap list §4 item 7). */}
          <span className="flex flex-none gap-1" aria-hidden>
            {leagues.map((l) => (
              <span
                key={l.id}
                className={cn('h-1.5 rounded-pill transition-[width] duration-200 ease-linear', l.id === league.id ? 'w-3.5 bg-white' : 'w-1.5 bg-m-dot')}
              />
            ))}
          </span>
          <MIcon name="chevronUp" size={14} stroke={2} className="text-white/[0.62]" />
        </div>
      </div>
    </div>
  )
}

export { DOCK_LG, DOCK_SM }
