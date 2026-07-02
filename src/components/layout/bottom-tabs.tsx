'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BarChart3,
  Home,
  type LucideIcon,
  MoreHorizontal,
  Search,
  Shield,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'

interface BottomTabsProps {
  onMoreClick: () => void
}

interface TabConfig {
  label: string
  icon: LucideIcon
  href?: string
  matchPrefix?: string
  isMore?: boolean
  isSearch?: boolean
}

const TABS: TabConfig[] = [
  { label: 'Home', icon: Home, href: '/app', matchPrefix: '/app' },
  {
    label: 'Players',
    icon: Shield,
    href: '/app/players',
    matchPrefix: '/app/players',
  },
  { label: 'Search', icon: Search, isSearch: true },
  {
    label: 'My Stats',
    icon: BarChart3,
    href: '/app/profile',
    matchPrefix: '/app/profile',
  },
  { label: 'More', icon: MoreHorizontal, isMore: true },
]

function isTabActive(pathname: string, tab: TabConfig): boolean {
  if (tab.isMore || tab.isSearch) return false
  if (tab.href === '/app') {
    return pathname === '/app' || pathname === '/app/explore'
  }
  return Boolean(tab.matchPrefix && pathname.startsWith(tab.matchPrefix))
}

export function BottomTabs({ onMoreClick }: BottomTabsProps) {
  const pathname = usePathname()
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen)

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-bg-elevated-2 bg-sidebar lg:hidden">
      {TABS.map((tab) => {
        const active = isTabActive(pathname, tab)
        const inner = (
          <span
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
              active ? 'text-foreground' : 'text-text-secondary',
            )}
          >
            <tab.icon
              className="h-5 w-5"
              strokeWidth={active ? 2.25 : 2}
            />
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
