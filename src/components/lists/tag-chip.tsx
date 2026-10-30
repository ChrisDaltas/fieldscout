'use client'

import Link from 'next/link'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

interface TagChipProps {
  name: string
  slug?: string
  href?: string
  onRemove?: () => void
  /**
   * The chip picks this tag inside the page instead of going anywhere —
   * desktop Community's Trending tags card, which sets the feed's own topic
   * (plan C4). A button, pressed while `active`; takes the place of
   * `slug` / `href`.
   */
  onClick?: () => void
  active?: boolean
  className?: string
}

/** List tag chip — v7 grey pill; `active` takes the selected-chip blue wash
 *  (tags are metadata, not controls, so they stay a badge rather than a
 *  FilterChip). */
export function TagChip({ name, slug, href, onRemove, onClick, active, className }: TagChipProps) {
  const target = onClick ? undefined : (href ?? (slug ? `/tag/${slug}` : undefined))

  const inner = (
    <span
      className={cn(
        'inline-flex h-chip items-center gap-1 whitespace-nowrap rounded-pill px-2 text-[10px] font-semibold leading-none transition-colors',
        active ? 'bg-accent-soft text-accent-deep' : 'bg-surface-control text-n-2',
        // The picked chip keeps its wash under the pointer.
        (target || onClick) && !onRemove && !active && 'hover:bg-surface-pressed hover:text-ink',
        className,
      )}
    >
      {name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onRemove()
          }}
          className="-mr-0.5 inline-flex items-center text-n-6 transition-colors hover:text-ink"
          aria-label={`Remove ${name}`}
        >
          <Icon name="close" size={10} />
        </button>
      )}
    </span>
  )

  if (onClick && !onRemove) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={Boolean(active)}
        className="inline-flex rounded-pill focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {inner}
      </button>
    )
  }
  if (target && !onRemove) {
    return (
      <Link href={target} className="inline-block">
        {inner}
      </Link>
    )
  }
  return inner
}
