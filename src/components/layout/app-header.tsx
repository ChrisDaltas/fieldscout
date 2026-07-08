'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { useHeaderStore } from '@/stores/header-store'

// Route-derived fallback titles for screens that haven't registered their
// own header content yet (removed as batches reskin each screen).
const ROUTE_TITLES: Array<[prefix: string, title: string]> = [
  ['/app/styleguide', 'Style guide'],
  ['/app/lists', 'Lists'],
  ['/app/research', 'Players'],
  ['/app/players', 'Players'],
  ['/app/weekly-ranks', 'Rankings'],
  ['/app/big-board', 'Rankings'],
  ['/app/explore', 'Community'],
  ['/app/stats', 'My stats'],
  ['/app/profile', 'My stats'],
  ['/app/settings', 'Account settings'],
  ['/app/leagues', 'Leagues'],
  ['/app/teams', 'Teams'],
  ['/app/notifications', 'Notifications'],
  ['/app/start-or-sit', 'Start or sit'],
  ['/app/nfl', 'NFL teams'],
  ['/app/trash', 'Trash'],
  ['/app/admin', 'Admin'],
  ['/app', 'Home'],
]

function routeTitle(pathname: string): string {
  const hit = ROUTE_TITLES.find(([prefix]) => pathname.startsWith(prefix))
  return hit ? hit[1] : 'FieldScout'
}

/** Sticky page header — 58px, white, 1px ink bottom border. Title left,
 *  page-scoped actions right. */
export function AppHeader() {
  const pathname = usePathname()
  const title = useHeaderStore((s) => s.title)
  const actions = useHeaderStore((s) => s.actions)

  return (
    <header className="sticky top-0 z-20 shrink-0 border-b border-ink bg-white px-7">
      <div className="flex h-header items-center gap-3">
        <div className="mr-auto flex min-w-0 items-center">
          {typeof title === 'string' || title == null ? (
            <h3 className="truncate text-h5">{title ?? routeTitle(pathname)}</h3>
          ) : (
            title
          )}
        </div>
        {actions}
      </div>
    </header>
  )
}

interface PageHeaderProps {
  title: React.ReactNode
  actions?: React.ReactNode
}

/** Rendered by pages to claim the shell header. Renders nothing itself. */
export function PageHeader({ title, actions }: PageHeaderProps) {
  const setHeader = useHeaderStore((s) => s.setHeader)
  const clearHeader = useHeaderStore((s) => s.clearHeader)

  useEffect(() => {
    setHeader(title, actions)
    return () => clearHeader()
  }, [title, actions, setHeader, clearHeader])

  return null
}
