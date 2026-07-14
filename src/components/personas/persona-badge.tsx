import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface PersonaBadgeProps {
  className?: string
}

/**
 * The AI badge rendered anywhere a persona name appears — feed cards, list
 * headers, consensus attribution, comments (spec-ai-expert-personas.md).
 * Stroke chip, matching the inline "AI" badges on the explore feed and the
 * home AI-experts shelf.
 */
export function PersonaBadge({ className }: PersonaBadgeProps) {
  return (
    <Badge variant="stroke" className={cn('shrink-0', className)}>
      AI
    </Badge>
  )
}
