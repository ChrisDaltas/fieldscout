'use client'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'

/**
 * Scout AI hub insight — the brand's signature AI callout (accent-soft tinted
 * card, spark mark, confidence chip, one call + one stat). Anatomy follows
 * the design system's AIInsight primitive; a shared `ui/ai-insight` should
 * absorb this once more screens need it (reported, not created here).
 *
 * TODO(live-draft): this is a generic sample insight. A real Scout AI
 * insights source doesn't exist yet, and matchup/league-specific reads need
 * the rosters + schedule data that arrive in later milestones — the copy
 * names no specific league until then.
 */
export function ScoutAiCard() {
  return (
    <Card className="bg-accent-soft px-[14px] py-[13px] shadow-hard-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 gap-y-1">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-pill border border-ink bg-accent text-accent-foreground">
          <Icon name="star" size={13} />
        </span>
        <span className="whitespace-nowrap text-[11px] font-medium tracking-[0.06em]">
          Scout AI
        </span>
        <Badge variant="stroke" className="ml-auto shrink-0">
          High confidence
        </Badge>
      </div>
      <div className="mb-1 text-[13px] font-extrabold">
        Bijan Robinson is a strong start this week
      </div>
      <div className="text-[11px] font-medium leading-[1.4]">
        Start Bijan over Gibbs — the Bears rank 24th vs the run and Gibbs is in
        a committee. <span className="fs-num">+3.2</span> projected.
      </div>
    </Card>
  )
}
