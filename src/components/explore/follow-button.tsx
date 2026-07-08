'use client'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * Community follow control (package screen 08). The schema has `follows` /
 * `expert_follows` tables but no mutation or API route exists anywhere in the
 * app yet, so the button ships disabled with an explainer tooltip.
 *
 * TODO(follows): wire to the follow mutation once one exists.
 */
export function FollowButton({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Disabled buttons swallow pointer events; the span keeps the
            tooltip trigger alive. */}
        <span className={cn('inline-flex', className)}>
          <Button variant="stroke" size="sm" disabled>
            Follow
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Following is coming soon</TooltipContent>
    </Tooltip>
  )
}
