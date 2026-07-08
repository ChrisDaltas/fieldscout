import type { AiPosition } from '@/types/schemas/ai'

/**
 * Theme catalog for the automated content engine (spec-ai-content-engine.md,
 * Slice C). Config, not code: add/retire themes here and re-run
 * generate-persona-content. Themed lists are tagged with `tag` so they
 * compound on the existing /tag/{slug} SEO feeds.
 */

export interface PostTheme {
  key: string
  /** Post kind stored on persona_posts. */
  kind: 'themed_list' | 'take' | 'weekly_movers'
  /** Human title seed — the persona voices its own final title. */
  topic: string
  /** What the ranking should select for — goes into the prompt. */
  brief: string
  /** Player pool position for the packet. */
  position: AiPosition
  /** How many players the themed list should hold. */
  playerCount: number
  /** System tag applied to the backing list. */
  tag: string
  /** Seasonal themes can be toggled without deleting them. */
  active: boolean
}

export const POST_THEMES: PostTheme[] = [
  {
    key: 'top-busts',
    kind: 'themed_list',
    topic: 'Top Busts',
    brief:
      'Players being drafted at a cost their situation, age, usage trend, or efficiency cannot support — likely to return meaningfully less than their draft price. Overvalued, not merely bad.',
    position: 'Overall',
    playerCount: 8,
    tag: 'Busts',
    active: true,
  },
  {
    key: 'sleepers',
    kind: 'themed_list',
    topic: 'Sleepers',
    brief:
      'Late-round or overlooked players with a realistic path to returning far more than their draft cost — opportunity opening up, roles consolidating, or efficiency the market has not priced in.',
    position: 'Overall',
    playerCount: 8,
    tag: 'Sleepers',
    active: true,
  },
  {
    key: 'breakouts',
    kind: 'themed_list',
    topic: 'Breakout Candidates',
    brief:
      'Young players positioned for a leap into a new tier this season — ascending usage, expanded roles, second- or third-year jumps. Players whose ceiling this year exceeds anything on their resume.',
    position: 'Overall',
    playerCount: 8,
    tag: 'Breakouts',
    active: true,
  },
  {
    key: 'post-hype-wrs',
    kind: 'themed_list',
    topic: 'Post-Hype WRs',
    brief:
      'Wide receivers the market has given up on after failing to meet earlier hype — now priced at a discount despite intact talent and a live path back to relevance.',
    position: 'WR',
    playerCount: 6,
    tag: 'Post-Hype',
    active: true,
  },
  {
    key: 'rookie-rbs',
    kind: 'themed_list',
    topic: 'Rookie RBs to Target',
    brief:
      'First-year running backs worth drafting — landing spot, draft capital, and early role signals that point to real fantasy value this season.',
    position: 'RB',
    playerCount: 6,
    tag: 'Rookies',
    active: true,
  },
  {
    key: 'weekly-movers',
    kind: 'weekly_movers',
    topic: 'Weekly Risers & Fallers',
    brief:
      'Players whose stock moved most this week — usage shifts, injuries ahead of them, role changes. In-season only.',
    position: 'Overall',
    playerCount: 8,
    tag: 'Risers',
    active: false, // in-season theme — flip on when weekly data flows
  },
]

export function activeThemes(): PostTheme[] {
  return POST_THEMES.filter((t) => t.active)
}
