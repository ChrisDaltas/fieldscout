'use client'

import Link from 'next/link'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

interface TagChipProps {
  name: string
  slug?: string
  href?: string
  onRemove?: () => void
  active?: boolean
  className?: string
}

/** List tag chip — ink outline on an accent-soft tint (tags are metadata,
 *  not controls, so they stay a badge rather than a FilterChip). */
export function TagChip({ name, slug, href, onRemove, active, className }: TagChipProps) {
  const target = href ?? (slug ? `/tag/${slug}` : undefined)

  const inner = (
    <span
      className={cn(
        'inline-flex h-chip items-center gap-1 whitespace-nowrap rounded-sm border border-ink px-2 text-[11px] font-bold leading-none text-ink transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'bg-accent-soft',
        target && !onRemove && 'hover:bg-accent hover:text-accent-foreground',
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
          className="-mr-0.5 inline-flex items-center text-ink transition-colors hover:text-accent"
          aria-label={`Remove ${name}`}
        >
          <Icon name="close" size={10} />
        </button>
      )}
    </span>
  )

  if (target && !onRemove) {
    return (
      <Link href={target} className="inline-block">
        {inner}
      </Link>
    )
  }
  return inner
}
