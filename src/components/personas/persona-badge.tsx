import { Bot } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface PersonaBadgeProps {
  className?: string
}

/**
 * The AI badge rendered anywhere a persona name appears — feed cards, list
 * headers, consensus attribution, comments (spec-ai-expert-personas.md).
 */
export function PersonaBadge({ className }: PersonaBadgeProps) {
  return (
    <Badge variant="outline" className={cn('gap-1', className)}>
      <Bot className="h-3 w-3" aria-hidden />
      AI
    </Badge>
  )
}
