'use client'

import { usePathname } from 'next/navigation'
import { useMemo } from 'react'
import {
  CalendarRange,
  ClipboardList,
  Clock,
  Home,
  ListOrdered,
  type LucideIcon,
  Pin,
  Shield,
  ShieldHalf,
  User,
  Vote,
} from 'lucide-react'

import { NavItem } from '@/components/layout/nav-item'
import { SidebarSubsection } from '@/components/layout/sidebar-subsection'
import { useLists } from '@/hooks/use-lists'
import { cn } from '@/lib/utils'

interface SidebarNavProps {
  collapsed: boolean
}

interface NavConfigItem {
  label: string
  icon: LucideIcon
  href: string
  matchPrefix?: string
}

const PRIMARY_NAV: NavConfigItem[] = [
  { label: 'Home', icon: Home, href: '/app', matchPrefix: '/app' },
  {
    label: 'Players',
    icon: Shield,
    href: '/app/players',
    matchPrefix: '/app/players',
  },
  {
    label: 'NFL Teams',
    icon: ShieldHalf,
    href: '/app/nfl',
    matchPrefix: '/app/nfl',
  },
  {
    label: 'Start or Sit',
    icon: Vote,
    href: '/app/start-or-sit',
    matchPrefix: '/app/start-or-sit',
  },
]

const MY_STUFF_NAV: NavConfigItem[] = [
  {
    label: 'Big Board',
    icon: ClipboardList,
    href: '/app/big-board',
    matchPrefix: '/app/big-board',
  },
  {
    label: 'Profile',
    icon: User,
    href: '/app/profile',
    matchPrefix: '/app/profile',
  },
  {
    label: 'Weekly Ranks',
    icon: CalendarRange,
    href: '/app/weekly-ranks',
    matchPrefix: '/app/weekly-ranks',
  },
  {
    label: 'Lists',
    icon: ListOrdered,
    href: '/app/lists',
    matchPrefix: '/app/lists',
  },
]

function isActive(pathname: string, item: NavConfigItem): boolean {
  if (item.href === '/app') {
    return pathname === '/app' || pathname === '/app/explore'
  }
  return Boolean(item.matchPrefix && pathname.startsWith(item.matchPrefix))
}

function formatListTitle(title: string, position: string | null) {
  return position ? `${position} · ${title}` : title
}

export function SidebarNav({ collapsed }: SidebarNavProps) {
  const pathname = usePathname()
  const { data } = useLists(1, 20)

  const recent = useMemo(
    () =>
      (data?.lists ?? []).slice(0, 5).map((l) => ({
        id: l.id,
        title: formatListTitle(l.title, l.position_filter),
        href: `/app/lists/${l.id}`,
      })),
    [data],
  )

  const favorites = useMemo(
    () =>
      (data?.lists ?? [])
        .filter((l) => l.is_favorited)
        .slice(0, 5)
        .map((l) => ({
          id: l.id,
          title: formatListTitle(l.title, l.position_filter),
          href: `/app/lists/${l.id}`,
        })),
    [data],
  )

  return (
    <nav className="space-y-3">
      <div className="space-y-0.5">
        {PRIMARY_NAV.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={isActive(pathname, item)}
            collapsed={collapsed}
          />
        ))}
      </div>

      <div>
        {!collapsed && (
          <p
            className={cn(
              'mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary',
            )}
          >
            My Stuff
          </p>
        )}
        <div className="space-y-0.5">
          {MY_STUFF_NAV.map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={isActive(pathname, item)}
              collapsed={collapsed}
            />
          ))}
        </div>
      </div>

      {!collapsed && (
        <>
          <SidebarSubsection
            label="Pinned"
            icon={<Pin className="h-3 w-3" />}
            items={favorites}
            emptyHint="Nothing pinned yet"
            starred
          />
          <SidebarSubsection
            label="Recent"
            icon={<Clock className="h-3 w-3" />}
            items={recent}
            emptyHint="No lists yet"
            seeAllHref="/app/lists"
          />
        </>
      )}
    </nav>
  )
}
