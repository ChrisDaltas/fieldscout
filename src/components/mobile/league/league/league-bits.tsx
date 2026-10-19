'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'

import { MobileOverrideStrip } from '@/components/mobile/league/override-strip'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { MPageBar } from '@/components/mobile/ui/mobile-header'
import { WithOnlineDot } from '@/components/mobile/ui/online-dot'
import { cn } from '@/lib/utils'

import { teamInitial } from './league-tab-ops'

/**
 * Small shared parts of the mobile League tab (handoff m-league): the team
 * avatar circle, the Filter pill, and the states the prototype does not
 * draw (loading / empty / error) in its own language — centred 13–15px t3
 * text, b1 skeleton blocks, a blue text action. Plus the two parts every
 * League Menu page shares (handoff m-community G): the page bar and the
 * choice chip.
 */

/**
 * A League Menu page's bar (handoff G pages): a 52px row with the blue back
 * chevron, the title centred and a spacer — then the commissioner-override
 * strip when it's on. Back goes to where you came from, else the League tab.
 */
export function LeaguePageBar({ leagueId, title }: { leagueId: string; title: string }) {
  const goBack = useGoBack()
  return (
    <>
      <MPageBar title={title} onBack={() => goBack(`/app/leagues/${leagueId}`)} />
      <MobileOverrideStrip leagueId={leagueId} className="mb-1.5" />
    </>
  )
}

/**
 * A chip scroller that opens with its pressed chip in view — a page opened
 * at a later round or team (from its address) shows that chip, not the
 * first few. Runs on open and whenever `key` changes (a view switch).
 */
export function useChipRowInView<T extends HTMLElement>(key?: unknown) {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    const row = ref.current
    const on = row?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!row || !on) return
    const box = row.getBoundingClientRect()
    const chip = on.getBoundingClientRect()
    if (chip.left < box.left || chip.right > box.right) row.scrollLeft = Math.max(0, row.scrollLeft + chip.left - box.left - 16)
  }, [key])
  return ref
}

/** A League Menu page's chip (G3 rounds, G4 seasons) — white on ink when on,
 *  t1 on b2 when off; your own team's chip reads blue when it's off, the way
 *  your picks do. */
export function PageChip({
  on,
  mine = false,
  onClick,
  className,
  children,
}: {
  on: boolean
  mine?: boolean
  onClick: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      data-mine={mine || undefined}
      className={cn(
        'flex h-8 flex-none items-center whitespace-nowrap rounded-pill px-3.5 text-[12px] font-semibold',
        on ? 'bg-m-ink text-white' : mine ? 'bg-m-b2 text-accent' : 'bg-m-b2 text-m-t1',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** A team's avatar: a solid circle with the name's first letter, white.
 *  With `online` passed, the manager's green dot when they're online (gap
 *  list §3 #25); `onlineRingClass` matches the dot's ring to the surface. */
export function TeamAvatar({
  name,
  className,
  size = 28,
  online,
  onlineRingClass,
}: {
  name: string
  className: string
  size?: 28 | 32
  online?: boolean
  onlineRingClass?: string
}) {
  const avatar = (
    <span
      aria-hidden="true"
      className={cn(
        'flex flex-none items-center justify-center rounded-full text-[11px] font-semibold text-white',
        size === 32 ? 'size-8' : 'size-7',
        className,
      )}
    >
      {teamInitial(name)}
    </span>
  )
  if (online === undefined) return avatar
  return (
    <WithOnlineDot online={online} size="sm" ringClass={onlineRingClass}>
      {avatar}
    </WithOnlineDot>
  )
}

/** The Filter pill (spec §2.4): b2 / t1 at rest, blue tint with a count. */
export function FilterPill({ count, label, onClick }: { count: number; label: string; onClick: () => void }) {
  const on = count > 0
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className={cn(
        'flex h-[30px] flex-none items-center gap-1.5 rounded-pill px-3 text-[12px] font-semibold',
        on ? 'bg-m-gb text-m-tb' : 'bg-m-b2 text-m-t1',
      )}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
        <path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3" />
      </svg>
      {label}
    </button>
  )
}

/** Centred t3 message with an optional blue action (spec §2.5 item 6). */
export function CenteredNote({
  message,
  action,
  onAction,
  href,
  role,
  className,
}: {
  message: string
  action?: string
  onAction?: () => void
  href?: string
  role?: 'alert' | 'status'
  className?: string
}) {
  return (
    <div role={role} className={cn('flex flex-col items-center gap-2.5 px-4 py-10 text-center', className)}>
      <span className="text-[14px] font-medium text-m-t3">{message}</span>
      {action && href ? (
        <Link href={href} className="text-[14px] font-semibold text-accent">
          {action}
        </Link>
      ) : action ? (
        <button type="button" onClick={onAction} className="text-[14px] font-semibold text-accent">
          {action}
        </button>
      ) : null}
    </div>
  )
}

/** b1 skeleton blocks while a list reads. */
export function SkeletonBlocks({ count, className }: { count: number; className: string }) {
  return (
    <div className="flex flex-col gap-2.5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cn('animate-pulse rounded-[14px] bg-m-b1', className)} />
      ))}
    </div>
  )
}

/** A thin status line (reconnecting, scores not refreshing, stats delayed). */
export function StatusLine({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'caution' }) {
  return (
    <p
      role="status"
      className={cn(
        'rounded-[12px] px-3 py-2 text-[12px] font-medium',
        tone === 'caution' ? 'bg-m-go text-m-to' : 'bg-m-b1 text-m-t3',
      )}
    >
      {children}
    </p>
  )
}

/** A section heading inside a segment (17/600, the design's "Activity"). */
export function SectionHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 pb-1 pt-2">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-m-t1">{children}</h2>
      {action}
    </div>
  )
}
