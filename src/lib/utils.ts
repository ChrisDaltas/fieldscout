import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Teach tailwind-merge our custom theme tokens so overrides win correctly:
// rounded-pill / rounded-message must beat rounded-sm, named font sizes must
// not be mistaken for colours, and the control-constant spacing names must
// merge within h-*/w-*.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['pill', 'message'],
      // Named font sizes (tailwind.config fontSize). Without this they read
      // as colours, so `cn('text-h6 text-ink')` silently dropped the size.
      text: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body', 'meta', 'micro'],
      spacing: [
        'btn',
        'btn-md',
        'btn-sm',
        'input',
        'chip',
        'tab',
        'header',
        'sidebar',
        'sidebar-collapsed',
        'rail-strip',
        'rail-panel',
        'card-pad',
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
