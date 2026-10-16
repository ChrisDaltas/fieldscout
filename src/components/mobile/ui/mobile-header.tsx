'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { LogoTile } from '@/components/landing/fieldscout-logo'
import { MIcon, type MIconName } from '@/components/mobile/ui/m-icon'
import { dmUnreadCount } from '@/components/layout/rail/messages-panel'
import { useNotifications } from '@/hooks/use-notifications'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'

/**
 * FieldScout Mobile header parts (handoff navigation "Headers by screen").
 * Screens compose these into their own 48–56px header rows.
 */

/** Logo tile (28px, radius 8, brand green #07D066, 15px mark) + "FieldScout" 19/700. */
export function LogoLockup({ href = '/app', withWord = true }: { href?: string | null; withWord?: boolean }) {
  const body = (
    <span className="flex items-center gap-2">
      <LogoTile size={28} markSize={15} className="bg-brand" />
      {withWord && <span className="text-[19px] font-bold tracking-[-0.03em] text-m-t1">FieldScout</span>}
    </span>
  )
  return href ? (
    <Link href={href} aria-label="FieldScout home">
      {body}
    </Link>
  ) : (
    body
  )
}

/** 38px round icon button with an optional count badge (top 4, right 4). */
export function HeaderIconButton({
  icon,
  label,
  onClick,
  href,
  badge,
  badgeTone = 'red',
  iconSize = 20,
  stroke = 1.5,
}: {
  icon: MIconName
  label: string
  onClick?: () => void
  href?: string
  badge?: number
  badgeTone?: 'red' | 'blue'
  iconSize?: number
  stroke?: number
}) {
  const inner = (
    <>
      <MIcon name={icon} size={iconSize} stroke={stroke} />
      {badge ? (
        <span
          className={cn(
            'absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-pill px-1 text-[10px] font-semibold leading-none text-white shadow-m-badge',
            badgeTone === 'red' ? 'bg-negative-strong' : 'bg-accent',
          )}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </>
  )
  const cls = 'relative flex size-[38px] flex-none items-center justify-center rounded-full text-m-t1 active:bg-m-b2'
  return href ? (
    <Link href={href} aria-label={label} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} aria-label={label} className={cls}>
      {inner}
    </button>
  )
}

/** Search · Notifications · Messages — the right group on Home and League.
 *  Messages holds direct messages and league boards, so it shows while
 *  either switch is on. The chat badge counts unread direct messages only —
 *  never trade offers, which stay inside their league (ruling #22). */
export function HeaderActions() {
  const openSearch = useUIStore((s) => s.setCommandPaletteOpen)
  const { data } = useNotifications()
  const unread = data?.unreadCount ?? 0
  const dms = featureFlags.messages ? dmUnreadCount() : 0
  return (
    <div className="flex flex-none items-center gap-0.5">
      <HeaderIconButton icon="search" label="Search" onClick={() => openSearch(true)} />
      <HeaderIconButton icon="bell" label={unread ? `Notifications (${unread} unread)` : 'Notifications'} href="/app/notifications" badge={unread} />
      {(featureFlags.messages || featureFlags.leagues) && (
        <HeaderIconButton icon="chat" label="Messages" href="/app/messages" badge={dms} badgeTone="blue" />
      )}
    </div>
  )
}

/** "‹ Back" pill (Messages / Notifications): blue text, 36px tall. */
export function BackPill({ label = 'Back', onClick }: { label?: string; onClick?: () => void }) {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={onClick ?? (() => router.back())}
      className="flex h-9 items-center gap-0.5 rounded-pill pl-1 pr-2 text-[15px] font-medium text-accent active:bg-m-b2"
    >
      <MIcon name="back" size={18} stroke={2} />
      {label}
    </button>
  )
}

/** Round back (chevron) or close (×) button — 34–36px. */
export function RoundNavButton({
  kind,
  onClick,
  size = 36,
  filled = false,
  label,
}: {
  kind: 'back' | 'close'
  onClick?: () => void
  size?: 34 | 36
  filled?: boolean
  label?: string
}) {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={onClick ?? (() => router.back())}
      aria-label={label ?? (kind === 'back' ? 'Back' : 'Close')}
      className={cn(
        'flex flex-none items-center justify-center rounded-full text-m-t1 active:bg-m-b2',
        size === 34 ? 'size-[34px]' : 'size-9',
        filled && 'bg-m-b2',
      )}
    >
      <MIcon name={kind} size={kind === 'back' ? 18 : 16} stroke={2} />
    </button>
  )
}

/**
 * A mobile screen: a sticky header over the scrolling body, edge to edge
 * (it undoes the shell's gutter) and clear of the bottom dock.
 */
export function MobileScreen({
  header,
  children,
  className,
  headerClassName,
}: {
  header?: React.ReactNode
  children: React.ReactNode
  className?: string
  headerClassName?: string
}) {
  return (
    <div className={cn('-mx-4 -mt-5 min-h-full bg-m-b0 text-m-t1', className)} data-mobile-screen>
      {header ? (
        <div className={cn('sticky top-0 z-10 bg-m-b0 pt-[env(safe-area-inset-top)]', headerClassName)}>{header}</div>
      ) : (
        <div className="pt-[env(safe-area-inset-top)]" />
      )}
      {children}
    </div>
  )
}
