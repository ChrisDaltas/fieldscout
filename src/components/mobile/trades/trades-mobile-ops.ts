/**
 * FieldScout Mobile — trade detail / builder / list: the pure half (handoff
 * spec `docs/design/mobile/m-team.md` §2.4–2.6). Words and shapes only; the
 * trade's status, legality and every refusal are the server's (`trades-ops.ts`
 * says them, this maps them onto the handoff's pills and footers).
 */
import type { LeagueDetail } from '@/hooks/use-league'
import type { TradeView } from '@/lib/leagues/api/trades-service'

export type PillTone = 'pending' | 'sent' | 'accepted' | 'declined' | 'neutral'
export type PillIcon = 'clock' | 'check' | 'x'

export interface SidePill {
  label: string
  tone: PillTone
  icon: PillIcon
}

/** The handoff's per-side status pills (§2.4 table), over the app's richer
 *  status set: an offer is "Sent offer" on the offering side and "Pending"
 *  on the side that answers; an accepted / reviewed / completed trade is
 *  "Accepted" on both; a trade that ended without going through is red. */
export function sidePill(trade: Pick<TradeView, 'status' | 'status_reason' | 'proposer'>, teamId: string): SidePill {
  switch (trade.status) {
    case 'proposed':
      return teamId === trade.proposer.team_id ? { label: 'Sent offer', tone: 'sent', icon: 'check' } : { label: 'Pending', tone: 'pending', icon: 'clock' }
    case 'in_review':
      return { label: 'Under review', tone: 'pending', icon: 'clock' }
    case 'accepted':
      return { label: 'Accepted', tone: 'accepted', icon: 'check' }
    case 'complete':
      return { label: 'Completed', tone: 'accepted', icon: 'check' }
    case 'rejected':
      return trade.status_reason?.startsWith('countered')
        ? { label: 'Countered', tone: 'neutral', icon: 'x' }
        : { label: 'Declined', tone: 'declined', icon: 'x' }
    case 'cancelled':
      return { label: 'Withdrawn', tone: 'neutral', icon: 'x' }
    case 'vetoed':
      return { label: 'Vetoed', tone: 'declined', icon: 'x' }
    case 'expired':
      return { label: 'Expired', tone: 'neutral', icon: 'x' }
    case 'invalid':
      return { label: 'No longer valid', tone: 'declined', icon: 'x' }
    case 'reversed':
      return { label: 'Reversed', tone: 'declined', icon: 'x' }
  }
}

/** One pill for a list row: the viewer's side when he is in the trade. */
export function rowPill(trade: TradeView, viewerTeamId: string | null): SidePill {
  const mine = viewerTeamId === trade.recipient.team_id || viewerTeamId === trade.proposer.team_id ? viewerTeamId! : trade.recipient.team_id
  return sidePill(trade, mine)
}

/** The finished footer's line (D3) — the handoff's two lines plus the app's
 *  other endings, in its words. Null while the trade still waits on someone. */
export function finishedFooter(trade: Pick<TradeView, 'status' | 'status_reason' | 'deferred'>): { text: string; tone: 'positive' | 'neutral' | 'negative' } | null {
  switch (trade.status) {
    case 'in_review':
      return { text: 'Trade accepted · players move after the review period', tone: 'positive' }
    case 'accepted':
      return {
        text: trade.deferred ? 'Trade accepted · players move after this week’s last game' : 'Trade accepted · going through now',
        tone: 'positive',
      }
    case 'complete':
      return { text: 'Trade complete · the players have moved', tone: 'positive' }
    case 'rejected':
      return { text: trade.status_reason?.startsWith('countered') ? 'This offer was countered' : 'This offer was declined', tone: 'neutral' }
    case 'cancelled':
      return { text: 'This offer was withdrawn', tone: 'neutral' }
    case 'expired':
      return { text: 'This offer expired at the trade deadline', tone: 'neutral' }
    case 'vetoed':
      return { text: 'This trade was vetoed', tone: 'negative' }
    case 'invalid':
      return { text: 'This trade could no longer go through', tone: 'negative' }
    case 'reversed':
      return { text: 'This trade was reversed', tone: 'negative' }
    default:
      return null
  }
}

export interface TradeAsset {
  key: string
  playerId: string | null
  name: string
  position: string | null
  nflTeam: string | null
  faab: number | null
}

/** What one team receives and sends in a trade (Receives mirrors the other
 *  team's Sends). */
export function assetsOf(trade: Pick<TradeView, 'items'>, teamId: string): { receives: TradeAsset[]; sends: TradeAsset[] } {
  const asset = (i: TradeView['items'][number], n: number): TradeAsset =>
    i.player
      ? { key: i.player.player_id, playerId: i.player.player_id, name: i.player.full_name ?? i.player.player_id, position: i.player.position, nflTeam: i.player.nfl_team, faab: null }
      : { key: `faab-${i.from_team_id}-${n}`, playerId: null, name: `$${i.faab_amount} FAAB`, position: null, nflTeam: null, faab: i.faab_amount }
  return {
    receives: trade.items.filter((i) => i.to_team_id === teamId).map(asset),
    sends: trade.items.filter((i) => i.from_team_id === teamId).map(asset),
  }
}

/** The @handle of a team's manager (the league's member list), or null. */
export function managerOf(detail: Pick<LeagueDetail, 'members'>, teamId: string): string | null {
  return detail.members.find((m) => m.team_id === teamId && m.user_id)?.profiles?.username ?? null
}

/** "1 for 1", "2 for $10", "1 + $5 for 2" — the builder's footer summary. */
export function sidesSummary(mine: number, mineFaab: number | null, theirs: number, theirsFaab: number | null): string {
  const side = (n: number, faab: number | null) => {
    const f = faab !== null && faab > 0 ? `$${faab}` : null
    if (n > 0 && f) return `${n} + ${f}`
    if (f) return f
    return String(n)
  }
  return `${side(mine, mineFaab)} for ${side(theirs, theirsFaab)}`
}
