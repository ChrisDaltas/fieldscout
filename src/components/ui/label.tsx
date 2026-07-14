import * as React from 'react'

import { cn } from '@/lib/utils'

// Field label — the "label above" pattern for Field/Select controls.
// 12px, bold, sentence case (never all-caps).
const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      'block text-[12px] font-bold leading-none text-ink peer-disabled:opacity-40',
      className,
    )}
    {...props}
  />
))
Label.displayName = 'Label'

export { Label }
