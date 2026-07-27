'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { SidebarResizeHandle } from '@/components/layout/sidebar-resize-handle'
import { Icon, type IconName } from '@/components/ui/icon'
import { useLeagues } from '@/hooks/use-leagues'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'
import { SIDEBAR_DIMENSIONS, useUIStore } from '@/stores/ui-store'

interface NavEntry {
  href: string
  label: string
  icon: IconName
  matchPrefix?: string
}

// Primary nav per the redesign IA. Routes stay as-is during the reskin
// (docs/redesign-plan.md D1/D2): "Players" points at the research table,
// Community lives at /app/explore, My Stats at /app/stats.
const PRIMARY: NavEntry[] = [
  { href: '/app', label: 'Home', icon: 'dashboard' },
  {
    href: '/app/big-board',
    label: 'Big Board',
    icon: 'layers',
    matchPrefix: '/app/big-board',
  },
  {
    href: '/app/weekly-ranks',
    label: 'Rankings',
    icon: 'level',
    matchPrefix: '/app/weekly-ranks',
  },
  {
    href: '/app/research',
    label: 'Players',
    icon: 'table',
    matchPrefix: '/app/research',
  },
  { href: '/app/lists', label: 'Lists', icon: 'list', matchPrefix: '/app/lists' },
]

const MORE_ITEMS: NavEntry[] = [
  {
    href: '/app/explore',
    label: 'Community',
    icon: 'team',
    matchPrefix: '/app/explore',
  },
  {
    href: '/app/stats',
    label: 'My stats',
    icon: 'chart',
    matchPrefix: '/app/stats',
  },
]

const ROLE_LABEL: Record<string, string> = {
  commissioner: 'Commissioner',
  co_commissioner: 'Co-commissioner',
  manager: 'Manager',
}

/** Two-letter initials for a league crest tile. */
function leagueInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function isActive(pathname: string, item: NavEntry): boolean {
  if (item.href === '/app') return pathname === '/app'
  return Boolean(item.matchPrefix && pathname.startsWith(item.matchPrefix))
}

function NavRow({
  item,
  collapsed,
  active,
}: {
  item: NavEntry
  collapsed: boolean
  active: boolean
}) {
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        'flex h-[34px] items-center gap-2.5 rounded-sm px-2.5 text-[13px] font-bold transition-colors',
        collapsed && 'w-[34px] justify-center self-center px-0',
        active
          ? 'bg-accent text-white'
          : 'text-white/75 hover:bg-white/10 hover:text-white',
      )}
    >
      <Icon name={item.icon} size={16} />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  )
}

/** The ink sidebar — wordmark band, search, primary nav with a More
 *  expander, and the Leagues section (the viewer's real memberships).
 *  Drag-resizable, collapses to an icon rail. */
export function Sidebar() {
  const pathname = usePathname()
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const isCollapsed = useUIStore((s) => s.isSidebarCollapsed)
  const toggleCollapsed = useUIStore((s) => s.toggleSidebarCollapsed)
  const setPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen)

  // The viewer's real league memberships (same query as home / the index).
  // Gated off with the leagues release so /api/leagues isn't hit app-wide
  // when the feature is hidden.
  const { data: leagues } = useLeagues({ enabled: featureFlags.leagues })
  const myLeagues = leagues ?? []

  const moreActive = MORE_ITEMS.some((i) => isActive(pathname, i))
  const [moreOpen, setMoreOpen] = useState(false)
  const [teamsOpen, setTeamsOpen] = useState(true)
  useEffect(() => {
    if (moreActive) setMoreOpen(true)
  }, [moreActive])

  // "/" opens search from anywhere (Cmd+K stays wired in command-palette).
  useEffect(() => {
    const onSlash = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing =
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (e.key === '/' && !typing) {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onSlash)
    return () => window.removeEventListener('keydown', onSlash)
  }, [setPaletteOpen])

  // Avoid hydration flash: only animate width transitions after mount
  const [animateWidth, setAnimateWidth] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimateWidth(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const width = isCollapsed ? SIDEBAR_DIMENSIONS.collapsed : sidebarWidth

  return (
    <aside
      style={{ width }}
      className={cn(
        'relative hidden shrink-0 flex-col overflow-visible bg-ink text-white lg:flex',
        animateWidth && 'transition-[width] duration-200',
      )}
      aria-label="Main navigation"
    >
      {/* Logo band — 37px, flush with the header line */}
      <div
        className={cn(
          'flex h-[37px] shrink-0 items-center border-b border-white/10',
          isCollapsed ? 'justify-center' : 'px-3.5',
        )}
      >
        <Link
          href="/app"
          className="whitespace-nowrap font-wordmark text-[16px] tracking-[-0.1em] text-brand"
        >
          {isCollapsed ? 'FS' : 'FIELDSCOUT'}
        </Link>
      </div>

      {/* Toggle + search */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-1.5 pt-3',
          isCollapsed ? 'flex-col px-0' : 'px-2.5',
        )}
      >
        <button
          onClick={toggleCollapsed}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-sm text-white/75 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Icon name="burger" size={15} />
        </button>
        {isCollapsed ? (
          <button
            onClick={() => setPaletteOpen(true)}
            title="Search"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-sm text-white/75 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Icon name="search" size={15} />
          </button>
        ) : (
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-[34px] min-w-0 flex-1 cursor-text items-center gap-2 rounded-sm border border-white/20 px-2.5 text-left text-[11px] font-semibold text-white/60 transition-colors hover:border-white/40"
          >
            <Icon name="search" size={13} className="shrink-0 opacity-70" />
            <span className="truncate">Search players, lists, users…</span>
            <kbd className="ml-auto shrink-0 rounded-sm border border-white/25 px-1 font-mono text-[9px] text-white/50">
              /
            </kbd>
          </button>
        )}
      </div>

      {/* Scrollable middle: nav + teams */}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto scrollbar-none">
        <nav
          className={cn(
            'flex flex-col gap-0.5',
            isCollapsed ? 'items-stretch px-0' : 'px-2.5',
          )}
        >
          {PRIMARY.map((item) => (
            <NavRow
              key={item.href}
              item={item}
              collapsed={isCollapsed}
              active={isActive(pathname, item)}
            />
          ))}
          {moreOpen &&
            MORE_ITEMS.map((item) => (
              <NavRow
                key={item.href}
                item={item}
                collapsed={isCollapsed}
                active={isActive(pathname, item)}
              />
            ))}
          <button
            onClick={() => setMoreOpen((o) => !o)}
            title={isCollapsed ? (moreOpen ? 'Less' : 'More') : undefined}
            className={cn(
              'flex h-[34px] items-center gap-2.5 rounded-sm px-2.5 text-[13px] font-bold text-white/75 transition-colors hover:bg-white/10 hover:text-white',
              isCollapsed && 'w-[34px] justify-center self-center px-0',
            )}
          >
            <Icon
              name={moreOpen ? 'arrow-up' : 'dots'}
              size={16}
            />
            {!isCollapsed && <span>{moreOpen ? 'Less' : 'More'}</span>}
          </button>

          {/* Leagues section — the viewer's real memberships, gated with the
              leagues release and hidden entirely when they're in none. */}
          {featureFlags.leagues && myLeagues.length > 0 && (
          <div className={cn('mt-2.5', isCollapsed && 'mt-1.5')}>
            {isCollapsed ? (
              <div className="mx-1.5 my-2 h-px bg-white/10" />
            ) : (
              <button
                onClick={() => setTeamsOpen((o) => !o)}
                className="flex w-full items-center justify-between rounded-sm px-2.5 py-1.5 text-[11px] font-bold text-white/50 transition-colors hover:text-white/80"
              >
                <span>Leagues</span>
                <Icon
                  name="arrow-bottom"
                  size={13}
                  className={cn(
                    'transition-transform',
                    !teamsOpen && '-rotate-90',
                  )}
                />
              </button>
            )}
            {(isCollapsed || teamsOpen) && (
              <div className="flex flex-col gap-0.5">
                {myLeagues.map((lg) => (
                  <Link
                    key={lg.id}
                    href={`/app/leagues/${lg.id}`}
                    title={isCollapsed ? lg.name : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-sm px-2.5 text-[13px] font-bold text-white/75 transition-colors hover:bg-white/10 hover:text-white',
                      isCollapsed
                        ? 'h-[34px] w-[34px] justify-center self-center px-0'
                        : 'h-[45px]',
                    )}
                  >
                    <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-sm border border-white/25 bg-white/10 text-[10px] font-extrabold">
                      {leagueInitials(lg.name)}
                    </span>
                    {!isCollapsed && (
                      <span className="flex min-w-0 flex-col leading-tight">
                        <span className="truncate">{lg.name}</span>
                        <span className="truncate text-[10px] font-semibold text-white/50">
                          {ROLE_LABEL[lg.my_role] ?? lg.my_role}
                        </span>
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>
          )}
        </nav>
      </div>

      <SidebarResizeHandle />
    </aside>
  )
}
