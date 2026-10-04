'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { useHeaderStore, type PageHeaderContent } from '@/stores/header-store'

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
 *  page-scoped actions right. The ONE page header of the logged-in app
 *  (F577, D487): pages claim it with `PageHeader`, and
 *  `page-header-rule.test.ts` stops new one-off page headers. */
export function AppHeader() {
  const pathname = usePathname()
  const page = useHeaderStore((s) => s.page)
  const league = useHeaderStore((s) => s.league)

  // League pages: ONE bar — the identity row above, the league sub-nav as
  // the main row (the prototype's AppShell `above` slot). A page's own
  // PageHeader title is ignored here, so there is never a second header.
  if (league) {
    return (
      <header className="sticky top-0 z-20 shrink-0 border-b border-ink bg-white px-7" data-league-header>
        <div className="flex min-w-0 items-center gap-3 pt-3">{league.above}</div>
        <div className="flex h-11 items-center gap-3">
          <div className="mr-auto flex min-w-0 items-center">{league.nav}</div>
          {league.actions}
        </div>
      </header>
    )
  }

  return (
    <header className="sticky top-0 z-20 shrink-0 border-b border-ink bg-white px-7" data-page-header-bar>
      <div className="flex h-header items-center gap-3">
        <div className="mr-auto flex min-w-0 items-center gap-3">
          <HeaderTitle page={page ?? { title: routeTitle(pathname) }} />
        </div>
        {page?.actions}
      </div>
      {page?.subnav}
    </header>
  )
}

/** The title cluster — title (plain or editable), muted
 *  subtitle, inline aside controls. Shared by the shell bar and the in-page
 *  mobile row so the two can never drift. */
function HeaderTitle({ page }: { page: PageHeaderContent }) {
  const { title, subtitle, aside, editableTitle } = page
  const heading =
    typeof title === 'string' || title == null ? (
      editableTitle ? (
        <EditableTitle value={title ?? ''} {...editableTitle} />
      ) : (
        <h3 className="truncate text-h5">{title}</h3>
      )
    ) : (
      title
    )
  return (
    <>
      <div className="flex min-w-0 flex-col justify-center">
        {heading}
        {subtitle != null && (
          <p className="truncate text-[11px] font-semibold text-n-3" data-page-header-subtitle>
            {subtitle}
          </p>
        )}
      </div>
      {aside != null && <div className="flex min-w-0 items-center gap-3">{aside}</div>}
    </>
  )
}

/** The editable-title option: the standard `text-h5` heading as a button;
 *  click → an input of the same type size. */
function EditableTitle({
  value,
  onChange,
  label,
  maxLength,
  placeholder = 'Untitled',
}: { value: string } & NonNullable<PageHeaderContent['editableTitle']>) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') setEditing(false)
        }}
        maxLength={maxLength}
        className="w-full max-w-md rounded-sm border border-ink bg-white px-1 text-h5 text-ink outline-none transition-colors focus:border-accent"
      />
    )
  }
  return (
    <h3 className="min-w-0 text-h5">
      <button
        type="button"
        aria-label={`${label}: ${value || placeholder}`}
        onClick={() => setEditing(true)}
        className={cn(
          'max-w-full truncate rounded-sm px-1 text-left transition-colors hover:bg-n-4',
          value ? 'text-ink' : 'text-n-3',
        )}
      >
        {value || placeholder}
      </button>
    </h3>
  )
}

interface PageHeaderProps extends PageHeaderContent {
  /**
   * The shell hides its header below `lg` (the mobile top bar replaces it).
   * Set this when the page's title or actions must still reach a phone: the
   * SAME title cluster and actions render in the page, below `lg` only.
   */
  inPageOnMobile?: boolean
}

/** Rendered by pages to claim the shell header. Renders nothing itself,
 *  except the opt-in mobile row (`inPageOnMobile`). */
export function PageHeader({ inPageOnMobile = false, ...content }: PageHeaderProps) {
  const setHeader = useHeaderStore((s) => s.setHeader)
  const clearHeader = useHeaderStore((s) => s.clearHeader)
  const { title, actions, subnav, subtitle, aside, editableTitle } = content

  useEffect(() => {
    setHeader({ title, actions, subnav, subtitle, aside, editableTitle })
    return () => clearHeader()
  }, [title, actions, subnav, subtitle, aside, editableTitle, setHeader, clearHeader])

  if (!inPageOnMobile) return null
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 lg:hidden" data-page-header-mobile>
      <div className="mr-auto flex min-w-0 items-center gap-3">
        <HeaderTitle page={{ title, subtitle, editableTitle }} />
      </div>
      {actions}
      {aside != null && <div className="flex w-full flex-wrap items-center gap-2">{aside}</div>}
    </div>
  )
}
