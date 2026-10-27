'use client'

import Link from 'next/link'

import { credCard } from '@/components/mobile/profile/profile-ops'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

/**
 * The pieces a person's profile is built from on the phone — your own
 * Profile tab (`mobile-profile.tsx`, handoff `m-profile.md` P0) and anyone's
 * profile screen (`person-profile.tsx`, `/app/u/[username]`) — so the two
 * read as one design and never drift apart.
 */

/**
 * The slim Cred card under the stats — not in the handoff, so it is drawn in
 * the stat cards' language (b1, 14px radius, 10/12 padding) with the
 * handoff's meter (4px pill, b3 track): tier dot + Scout tier name and the
 * cred score, the bar, then "Scout tier N of 10" and what's left to the
 * next tier. Read-only, like the stat cards.
 */
export function CredCardView({ credScore }: { credScore: number }) {
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

/**
 * A stat card (§2 P0.3): value over label on b1. Read-only on your own
 * Profile; with `href` the whole card opens what it counts (a person's
 * Followers / Following) and takes the pressed tint.
 */
export function StatCard({ value, label, href }: { value: string; label: string; href?: string }) {
  const cls = 'flex min-w-0 flex-col gap-0.5 rounded-[14px] bg-m-b1 px-3 py-2.5'
  const body = (
    <>
      <span className="truncate text-[17px] font-bold tabular-nums">{value}</span>
      <span className="text-[11px] font-medium text-m-t3">{label}</span>
    </>
  )
  return href ? (
    <Link href={href} className={cn(cls, 'text-m-t1 active:bg-m-b2')} data-stat-link={label}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export function PreviewBody({
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
export function PreviewRow({
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
