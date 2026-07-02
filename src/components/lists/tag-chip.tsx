'use client'

import Link from 'next/link'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

interface TagChipProps {
  name: string
  slug?: string
  href?: string
  onRemove?: () => void
  active?: boolean
  className?: string
}

export function TagChip({ name, slug, href, onRemove, active, className }: TagChipProps) {
  const target = href ?? (slug ? `/tag/${slug}` : undefined)

  const inner = (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-bg-elevated-2 text-foreground'
          : 'bg-bg-elevated-2 text-text-secondary hover:bg-bg-elevated-3 hover:text-foreground',
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
          className="-mr-1 ml-0.5 rounded-full p-0.5 text-text-tertiary hover:text-foreground"
          aria-label={`Remove ${name}`}
        >
          <X className="h-3 w-3" />
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
