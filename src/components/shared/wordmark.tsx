import { cn } from '@/lib/utils'

interface WordmarkProps {
  className?: string
}

/**
 * The FieldScout logomark: Silkscreen with −0.1em tracking, capital F and S
 * bold against regular-weight "ield"/"cout". Size/color come from className.
 */
export function Wordmark({ className }: WordmarkProps) {
  return (
    <span className={cn('font-silkscreen font-normal tracking-[-0.1em]', className)}>
      <span className="font-bold">F</span>ield
      <span className="font-bold">S</span>cout
    </span>
  )
}
