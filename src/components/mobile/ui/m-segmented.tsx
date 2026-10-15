'use client'

import { cn } from '@/lib/utils'

/**
 * Mobile segmented control (README: track b2, "on" segment on the page colour
 * with `0 1px 2px rgba(0,0,0,.12)`). Equal-width grid; screens pass their own
 * height / radius / type via `className` + `itemClassName` per their spec.
 */
export function MSegmented<T extends string>({
  options,
  value,
  onChange,
  className,
  itemClassName,
  shadow = 'm-seg',
  label,
}: {
  options: ReadonlyArray<{ value: T; label: React.ReactNode }>
  value: T
  onChange: (value: T) => void
  className?: string
  itemClassName?: string
  shadow?: 'm-seg' | 'm-seg-3'
  label?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('grid gap-0.5 rounded-[10px] bg-m-b2 p-0.5', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex h-[30px] items-center justify-center rounded-[8px] text-[13px] font-semibold',
              on ? cn('bg-m-b0 text-m-t1', shadow === 'm-seg' ? 'shadow-m-seg' : 'shadow-m-seg-3') : 'text-m-t3',
              itemClassName,
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
