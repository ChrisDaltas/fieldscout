import { Badge } from '@/components/ui/badge'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

type Confidence = 'high' | 'medium' | 'low'

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
}

interface AIInsightProps {
  /** The call — one decision, stated plainly. */
  heading: React.ReactNode
  /** One stat-backed supporting line. Keep it to a single insight. */
  children?: React.ReactNode
  confidence?: Confidence
  className?: string
}

/** Scout AI insight — accent-tinted card: star badge, one call, one stat,
 *  confidence tag. AI moments are always ultramarine, never lime. */
export function AIInsight({
  heading,
  children,
  confidence,
  className,
}: AIInsightProps) {
  return (
    <div
      className={cn(
        'rounded-sm border border-ink bg-accent-soft p-card-pad',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-ink bg-accent text-white">
          <Icon name="star" size={13} />
        </span>
        <span className="text-[12px] font-extrabold">Scout AI</span>
        {confidence && (
          <Badge variant="stroke" className="ml-auto bg-white">
            {CONFIDENCE_LABEL[confidence]}
          </Badge>
        )}
      </div>
      <p className="mt-2.5 text-[14px] font-extrabold leading-snug">
        {heading}
      </p>
      {children && (
        <div className="mt-1 text-[13px] font-medium text-ink/70">
          {children}
        </div>
      )}
    </div>
  )
}
