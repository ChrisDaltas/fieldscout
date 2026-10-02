import Link from 'next/link'

import { cn } from '@/lib/utils'

/** Scout AI "alive" dot — hue-cycling with a pulse ring. Still for reduced motion. */
export function ScoutDot({ size = 8, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block flex-none rounded-full bg-fs-blue animate-fs-scout motion-reduce:animate-none',
        className,
      )}
      style={{ width: size, height: size }}
    />
  )
}

/** Position tag (QB/RB/WR/TE) — saturated fill, white text. */
export function PosTag({
  pos,
  children,
  className,
}: {
  pos: 'QB' | 'RB' | 'WR' | 'TE' | 'BN'
  children?: React.ReactNode
  className?: string
}) {
  const bg = {
    QB: 'bg-pos-qb',
    RB: 'bg-pos-rb',
    WR: 'bg-pos-wr',
    TE: 'bg-pos-te',
    BN: 'bg-fs-text-4',
  }[pos]
  return (
    <span
      className={cn(
        'inline-flex h-5 flex-none items-center justify-center rounded-fs-xs px-1.5 text-[11px] font-bold text-white',
        bg,
        className,
      )}
    >
      {children ?? pos}
    </span>
  )
}

const CTA_SIZES = {
  sm: 'h-8 px-4 text-[14px]',
  md: 'h-10 px-5 text-[14px]',
  lg: 'h-[52px] px-[30px] text-[17px]',
  xl: 'h-14 px-9 text-[18px]',
} as const

/** v13 primary pill — "Create account" everywhere on the landing page. */
export function CreateAccountButton({
  size = 'md',
  className,
}: {
  size?: keyof typeof CTA_SIZES
  className?: string
}) {
  return (
    <Link
      href="/signup"
      className={cn(
        'inline-flex flex-none items-center whitespace-nowrap rounded-pill bg-fs-blue font-semibold text-white transition-colors hover:bg-fs-blue-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fs-blue',
        CTA_SIZES[size],
        className,
      )}
    >
      Create account
    </Link>
  )
}

/** Three grey window-control dots + centred title — the demo window bar. */
export function WindowBar({ title }: { title: string }) {
  return (
    <div className="flex h-11 items-center gap-2 border-b-1 border-fs-line bg-fs-raised px-4">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-3 rounded-full bg-fs-fill" />
      ))}
      <span className="mx-auto text-[13px] font-medium text-fs-text-3">{title}</span>
      <span className="w-[52px]" />
    </div>
  )
}

/** Green check disc used by the demos and comparison table. */
export function CheckDisc({ size = 18, muted = false }: { size?: number; muted?: boolean }) {
  return (
    <span
      className={cn(
        'flex flex-none items-center justify-center rounded-full font-extrabold text-fs-ink',
        muted ? 'bg-fs-fill' : 'bg-fs-green',
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.58) }}
    >
      ✓
    </span>
  )
}
