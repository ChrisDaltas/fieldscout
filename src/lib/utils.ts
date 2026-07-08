import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Teach tailwind-merge our custom theme tokens so overrides win correctly:
// rounded-pill must beat rounded-sm (people are round, everything else is
// 1px), and the control-constant spacing names must merge within h-*/w-*.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['pill'],
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
