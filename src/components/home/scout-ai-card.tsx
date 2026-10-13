'use client'

import { AIInsight } from '@/components/ui/ai-insight'

/**
 * Scout AI hub insight — v7's Scout AI card (sunken grey panel, blue dot +
 * "Scout AI" label, one call as a 19px headline, one stat-backed line),
 * composed from the shared `AIInsight` rather than hand-copied.
 *
 * TODO(live-draft): this is a generic sample insight. A real Scout AI
 * insights source doesn't exist yet, and matchup/league-specific reads need
 * the rosters + schedule data that arrive in later milestones — the copy
 * names no specific league until then.
 */
export function ScoutAiCard() {
  return (
    <AIInsight
      heading="Bijan Robinson is a strong start this week"
      confidence="high"
    >
      Start Bijan over Gibbs — the Bears rank 24th vs the run and Gibbs is in a
      committee. <span className="fs-num">+3.2</span> projected.
    </AIInsight>
  )
}
