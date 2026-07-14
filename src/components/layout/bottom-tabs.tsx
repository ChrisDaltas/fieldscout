'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Icon, type IconName } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'

interface BottomTabsProps {
  onMoreClick: () => void
}

interface TabConfig {
  label: string
  icon: IconName
  href?: string
  matchPrefix?: string
  isMore?: boolean
  isSearch?: boolean
}

const TABS: TabConfig[] = [
  { label: 'Home', icon: 'dashboard', href: '/app', matchPrefix: '/app' },
  {
    label: 'Players',
    icon: 'table',
    href: '/app/players',
    matchPrefix: '/app/players',
  },
  { label: 'Search', icon: 'search', isSearch: true },
  {
    label: 'My stats',
    icon: 'chart',
    href: '/app/profile',
    matchPrefix: '/app/profile',
  },
  { label: 'More', icon: 'dots', isMore: true },
]

function isTabActive(pathname: string, tab: TabConfig): boolean {
  if (tab.isMore || tab.isSearch) return false
  if (tab.href === '/app') {
    return pathname === '/app' || pathname === '/app/explore'
  }
  return Boolean(tab.matchPrefix && pathname.startsWith(tab.matchPrefix))
}

/** Mobile tab bar — ink surface, 64px, lime active state (the "you are
 *  here" signal; lime never carries the tap action itself). */
export function BottomTabs({ onMoreClick }: BottomTabsProps) {
  const pathname = usePathname()
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen)

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-ink bg-ink lg:hidden">
      {TABS.map((tab) => {
        const active = isTabActive(pathname, tab)
        const inner = (
          <span
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors duration-200 ease-linear',
              active ? 'text-brand' : 'text-white/60 hover:text-white',
            )}
          >
            <Icon name={tab.icon} size={16} />
            <span>{tab.label}</span>
          </span>
        )

        if (tab.isMore) {
          return (
            <button
              key={tab.label}
              type="button"
              onClick={onMoreClick}
              className="flex flex-1"
              aria-label="More navigation"
            >
              {inner}
            </button>
          )
        }

        if (tab.isSearch) {
          return (
            <button
              key={tab.label}
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              className="flex flex-1"
              aria-label="Search"
            >
              {inner}
            </button>
          )
        }

        return (
          <Link key={tab.href} href={tab.href!} className="flex flex-1">
            {inner}
          </Link>
        )
      })}
    </nav>
  )
}
