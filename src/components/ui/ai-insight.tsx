import { Badge } from '@/components/ui/badge'
import { Icon, type IconName } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

type Confidence = 'high' | 'medium' | 'low'

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
}

/**
 * The Scout AI mark — a blue rounded tile holding one glyph (v7 blue). It
 * anchors the AI dialogs and banners; inline AI cards use v7's blue dot.
 *
 * **Extracted at LV.5, not invented there.** Three surfaces had hand-copied the
 * same eleven classes: `AIInsight` below, the "Generate with AI" dialog title,
 * and the AI build banner. CLAUDE.md forbids near-duplicate components, and
 * three copies of one mark is that rule's plainest case — the banner had
 * already drifted to a bare accent glyph with no square at all.
 *
 * The glyph is a prop because the build banner uses the mark itself as its
 * phase indicator (star → scouting, plus-circle → adding, sort → ordering)
 * rather than putting a second icon beside it.
 */
export function ScoutAiMark({
  icon = 'star',
  size = 'md',
  className,
}: {
  icon?: IconName
  /** `md` (24px) beside a heading; `sm` (20px) inline in a banner row. */
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground',
        size === 'sm' ? 'h-5 w-5' : 'h-6 w-6',
        className,
      )}
    >
      <Icon name={icon} size={size === 'sm' ? 11 : 13} />
    </span>
  )
}

interface AIInsightProps {
  /** The call — one decision, stated plainly. */
  heading: React.ReactNode
  /** One stat-backed supporting line. Keep it to a single insight. */
  children?: React.ReactNode
  confidence?: Confidence
  className?: string
}

/** Scout AI insight — v7's Scout AI card: sunken grey panel, a blue dot +
 *  "Scout AI" label, one call as a headline, one stat-backed line, and an
 *  optional confidence tag. */
export function AIInsight({
  heading,
  children,
  confidence,
  className,
}: AIInsightProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-[7px] rounded-2xl bg-surface-sunken px-[19px] py-[17px]',
        className,
      )}
    >
      <div className="flex items-center gap-[7px] text-[10px] font-semibold text-n-3">
        <span aria-hidden className="size-1.5 rounded-full bg-accent" />
        <span>Scout AI</span>
        {confidence && (
          <Badge variant="stroke" className="ml-auto bg-white">
            {CONFIDENCE_LABEL[confidence]}
          </Badge>
        )}
      </div>
      <p className="text-[19px] font-bold leading-[1.15] tracking-[-0.025em] [text-wrap:balance]">
        {heading}
      </p>
      {children && (
        <div className="text-[13px] font-medium leading-[1.45] text-n-3">
          {children}
        </div>
      )}
    </div>
  )
}
