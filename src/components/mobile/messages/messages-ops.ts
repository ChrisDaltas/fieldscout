/**
 * FieldScout Mobile — Messages (docs/design/mobile/m-messages.md). The PURE
 * half: no React, no client. Times, previews, the bubble-run geometry, the
 * search filter and the avatar palette live here so the screens stay thin
 * and the rules are pinned by `messages-ops.test.ts`. So does the reading of
 * a league's trade offers (`leagueTradeOffers`) — Messages itself no longer
 * shows trades (ruling #22); Home's league-card red dot reads it.
 */
import type { LeagueDetail } from '@/hooks/use-league'
import type { TradeView, TradesDocument } from '@/lib/leagues/api/trades-service'
import { teamAvClass, teamOrder } from '@/components/mobile/league/team/team-ops'
import { assetsOf, managerOf, sidePill } from '@/components/mobile/trades/trades-mobile-ops'
import { MY_TEAM_FILL, TEAM_FILLS } from '@/components/mobile/ui/avatar-colors'
import { handleInitials } from '@/utils/initials'

// ---------------------------------------------------------------------------
// Shapes the screens render
// ---------------------------------------------------------------------------

/** One message in a conversation, whatever feed it came from. */
export interface MChatMessage {
  id: string
  fromMe: boolean
  /** Stable sender identity — runs group by it (the prototype's `m[0]`). */
  senderKey: string
  /** The sender's handle ("@marcus") — the sender label and the avatar letters. */
  senderName: string
  /** The sender's username when they have one (the label is a profile link). */
  senderUsername: string | null
  senderAvatarUrl: string | null
  /** Tailwind background class for the initials avatar. */
  senderColorClass: string
  text: string
  /** ISO instant, or null when the feed carries only a display label. */
  at: string | null
}

/** An offer's status tone: Pending (orange), Accepted (green), Declined
 *  (red), plus a grey for the app's other endings. */
export type MTradeTone = 'pending' | 'accepted' | 'declined' | 'neutral'

/** A league trade offer the viewer's team is in (§2.1 F's fields). */
export interface MTradeOffer {
  /** The trade's id. */
  id: string
  leagueId: string
  /** The other manager's handle ("@marcus"), else their team's name. */
  name: string
  /** Their @handle without the "@", when known. */
  handle: string | null
  /** Their team's name. */
  teamName: string | null
  avatarUrl: string | null
  colorClass: string
  dir: 'in' | 'out'
  /** ISO instant the offer was made. */
  createdAt: string
  time: string
  gets: readonly string[]
  gives: readonly string[]
  status: { label: string; tone: MTradeTone }
  /** Sent to me and still waiting on my answer — what lights Home's league
   *  card dot (`pendingCount`). */
  awaitingMe: boolean
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** What a deleted account's messages are signed with (the board's label). */
export const FORMER_MEMBER = 'Former member'

/** A manager as the messages screens label them: their handle ("@marcus").
 *  The design shows first names; FieldScout stores no name for a person —
 *  only the username (the identity contract, 2026-08-05). */
export function senderHandle(username: string | null | undefined): string {
  const handle = (username ?? '').replace(/^@/, '')
  return handle ? `@${handle}` : FORMER_MEMBER
}

/** A person's avatar letters when they have no photo — the app-wide two-letter
 *  rule ("@marcus" → "MA"; Chris, 2026-10-15, gap list #8). */
export function initialOf(name: string): string {
  return handleInitials(name)
}

// ---------------------------------------------------------------------------
// Avatar colours
// ---------------------------------------------------------------------------

/**
 * Manager avatar colours — the prototype's TEAMS palette in seat order
 * (`TEAMS[ti].av`): you are blue, then ink, purple, red, gold, blue, green,
 * orange, grey, teal, pink, grey — the shared mobile palette
 * (`avatar-colors.ts`). The app stores no team colour, so a seat's colour is
 * derived from its position in the league (client-side only).
 */
export const MANAGER_COLORS = [MY_TEAM_FILL, ...TEAM_FILLS] as const

/** The viewer's own colour (the prototype's `myAv`, #0088FF). */
export const MY_COLOR = MANAGER_COLORS[0]

/** Another manager's colour by seat index — never the viewer's blue. */
export function seatColor(seatIndex: number): string {
  const others = MANAGER_COLORS.length - 1
  const i = ((seatIndex % others) + others) % others
  return MANAGER_COLORS[1 + i]!
}

/** A stable colour for an id with no seat (a DM thread). */
export function keyColor(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return seatColor(Math.abs(h))
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function monthDay(d: Date, now: Date): string {
  const base = `${MONTH[d.getMonth()]} ${d.getDate()}`
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`
}

/**
 * The list's short time (prototype CTIME: "2m", "8m", "1h", "5h", "Tue",
 * "Sep 24"): "now" under a minute, minutes under an hour, hours under a
 * day, the weekday within the week, then the date (with the year once it
 * is not this year's).
 */
export function shortTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const ms = now.getTime() - d.getTime()
  if (Number.isNaN(ms)) return ''
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000)
  if (days < 7) return WEEKDAY[d.getDay()]!
  return monthDay(d, now)
}

/** The thread's day separator ("Today" in the design): Today, Yesterday,
 *  else "Tue, Oct 13". */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${WEEKDAY[d.getDay()]}, ${monthDay(d, now)}`
}

function dayKey(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

// ---------------------------------------------------------------------------
// Conversation rows
// ---------------------------------------------------------------------------

/**
 * The row preview (§5 "Preview rule"): the last message's text prefixed
 * "You: " when I sent it, "{Sender}: " in a group, nothing otherwise.
 */
export function previewText(last: Pick<MChatMessage, 'fromMe' | 'senderName' | 'text'>, group: boolean): string {
  if (last.fromMe) return `You: ${last.text}`
  return group ? `${last.senderName}: ${last.text}` : last.text
}

/** "{preview} · {time}" — one string, so a long preview truncates the time
 *  too (§2.1 E). No time → the preview alone. */
export function previewLine(preview: string, time: string | null): string {
  return time ? `${preview} · ${time}` : preview
}

/** Case-insensitive, untrimmed substring match on the display name (§3:
 *  the search matches conversation names only). Empty query matches
 *  everything. */
export function matchesName(name: string, query: string): boolean {
  if (!query) return true
  return name.toLowerCase().includes(query.toLowerCase())
}

/** Offers waiting on my answer — the gap analysis's "proposed, with the
 *  viewer's team as recipient". Home's league-card dot reads it (ruling
 *  #14); nothing in Messages counts trades (ruling #22). */
export function pendingCount(trades: readonly Pick<MTradeOffer, 'awaitingMe'>[]): number {
  return trades.filter((t) => t.awaitingMe).length
}

// ---------------------------------------------------------------------------
// Following the conversation (Chris, #47, 2026-10-15)
// ---------------------------------------------------------------------------

/** How close to the bottom still counts as "at the newest message": a
 *  finger's rest, so a nudge of a few pixels doesn't stop the follow. */
export const PIN_SLACK_PX = 48

/** Whether a scroller sits at (or within `slack` of) its bottom. A scroller
 *  with nothing to scroll is at its bottom. */
export function isNearBottom(
  m: { scrollTop: number; scrollHeight: number; clientHeight: number },
  slack: number = PIN_SLACK_PX,
): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= slack
}

/**
 * A conversation opens at its newest message and follows new ones as they
 * arrive — while the reader is at the bottom. Scrolled up to read, a
 * newcomer leaves them where they are; their OWN message (they just sent
 * it) brings them down to it, as every messaging app does.
 */
export function followsNewMessage(args: { pinned: boolean; fromMe: boolean }): boolean {
  return args.pinned || args.fromMe
}

/** The newest message in a laid-out thread (separators skipped). */
export function lastMessageOf(items: readonly ThreadItem[]): { key: string; fromMe: boolean } | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!
    if (item.kind === 'msg') return { key: item.key, fromMe: item.message.fromMe }
  }
  return null
}

// ---------------------------------------------------------------------------
// Thread geometry (§2.2 B)
// ---------------------------------------------------------------------------

/** Bubble corners (CSS order TL TR BR BL) by sender and run position. */
export function bubbleRadius(fromMe: boolean, lastOfRun: boolean): string {
  if (fromMe) return lastOfRun ? 'rounded-[18px_18px_6px_18px]' : 'rounded-[18px_6px_6px_18px]'
  return lastOfRun ? 'rounded-[18px_18px_18px_6px]' : 'rounded-[6px_18px_18px_6px]'
}

export type ThreadItem =
  | { kind: 'day'; key: string; label: string }
  | {
      kind: 'msg'
      key: string
      message: MChatMessage
      /** Index among messages (not separators) — the 8px run gap skips 0. */
      index: number
      firstOfRun: boolean
      lastOfRun: boolean
      /** Their last bubble of a run carries the 26px avatar… */
      showAvatar: boolean
      /** …the others keep a 26px spacer so bubbles align. */
      spacer: boolean
      /** Group threads label the first bubble of each of their runs. */
      showName: boolean
      gapTop: boolean
    }

/**
 * Lay a conversation out as the prototype's `thMsgs`: runs of one sender
 * (a day separator also ends a run — the design's single hard-coded
 * "Today" becomes a real separator per day when messages carry times).
 */
export function threadItems(messages: readonly MChatMessage[], group: boolean, now: Date = new Date()): ThreadItem[] {
  const items: ThreadItem[] = []
  let prevDay: string | null = null
  messages.forEach((m, k) => {
    const day = dayKey(m.at)
    const newDay = day !== null && day !== prevDay
    if (newDay) items.push({ kind: 'day', key: `day-${day}`, label: dayLabel(m.at!, now) })
    if (day !== null) prevDay = day
    const prev = messages[k - 1]
    const next = messages[k + 1]
    const firstOfRun = !prev || prev.senderKey !== m.senderKey || newDay
    const nextDay = next ? dayKey(next.at) : null
    const lastOfRun = !next || next.senderKey !== m.senderKey || (nextDay !== null && nextDay !== day)
    items.push({
      kind: 'msg',
      key: m.id,
      message: m,
      index: k,
      firstOfRun,
      lastOfRun,
      showAvatar: !m.fromMe && lastOfRun,
      spacer: !m.fromMe && !lastOfRun,
      showName: group && !m.fromMe && firstOfRun,
      gapTop: firstOfRun && k > 0,
    })
  })
  return items
}

// ---------------------------------------------------------------------------
// Thread ids
// ---------------------------------------------------------------------------

const LEAGUE_PREFIX = 'league-'

/** A league's message board as a Messages thread id. */
export function leagueThreadId(leagueId: string): string {
  return `${LEAGUE_PREFIX}${leagueId}`
}

/** The league a thread id names, or null for a direct message. */
export function leagueIdOfThread(threadId: string): string | null {
  return threadId.startsWith(LEAGUE_PREFIX) && threadId.length > LEAGUE_PREFIX.length
    ? threadId.slice(LEAGUE_PREFIX.length)
    : null
}

export function threadHref(threadId: string): string {
  return `/app/messages/${encodeURIComponent(threadId)}`
}

/** "12 members" / "1 member". */
export function membersLine(count: number): string {
  return `${count} member${count === 1 ? '' : 's'}`
}

// ---------------------------------------------------------------------------
// A league's real offers (§2.1 F's fields). Not shown in Messages — trades
// stay inside their league (Chris, ruling #22, 2026-10-15); Home's league
// card dot reads `awaitingMe` from these.
// ---------------------------------------------------------------------------

const PILL_TONE: Record<ReturnType<typeof sidePill>['tone'], MTradeTone> = {
  pending: 'pending',
  sent: 'accepted',
  accepted: 'accepted',
  declined: 'declined',
  neutral: 'neutral',
}

/**
 * An offer's one status. An offer still out is "Pending" whichever way it
 * went (the design's `t[4]`); every other state is the trade screens' own
 * word for it (Accepted, Declined, Under review, Withdrawn…).
 */
export function tradeOfferStatus(trade: Pick<TradeView, 'status' | 'status_reason' | 'proposer'>, myTeamId: string): MTradeOffer['status'] {
  if (trade.status === 'proposed') return { label: 'Pending', tone: 'pending' }
  const pill = sidePill(trade, myTeamId)
  return { label: pill.label, tone: PILL_TONE[pill.tone] }
}

/**
 * One league's offers: only the trades the viewer's team is in (sent to me /
 * I sent), with the other manager's name, handle, photo and team colour (the
 * same colour the trade screens and the Team view give that team), "You get"
 * / "You give", and the time against the read's own clock.
 */
export function leagueTradeOffers(
  doc: Pick<TradesDocument, 'trades' | 'viewer' | 'evaluated_at'>,
  detail: Pick<LeagueDetail, 'members' | 'teams'>,
  leagueId: string,
): MTradeOffer[] {
  const me = doc.viewer.team_id
  if (!me) return []
  const order = teamOrder(detail.teams)
  const now = doc.evaluated_at ? new Date(doc.evaluated_at) : new Date()
  return doc.trades
    .filter((t) => t.proposer.team_id === me || t.recipient.team_id === me)
    .map((t): MTradeOffer => {
      const incoming = t.recipient.team_id === me
      const other = incoming ? t.proposer : t.recipient
      const handle = managerOf(detail, other.team_id)
      const member = detail.members.find((m) => m.team_id === other.team_id && m.user_id)
      const { receives, sends } = assetsOf(t, me)
      return {
        id: t.id,
        leagueId,
        name: handle ? senderHandle(handle) : (other.name ?? 'A team'),
        handle,
        teamName: other.name,
        avatarUrl: member?.profiles?.avatar_url ?? null,
        colorClass: teamAvClass(other.team_id, order, me),
        dir: incoming ? 'in' : 'out',
        createdAt: t.created_at,
        time: shortTime(t.created_at, now),
        gets: receives.map((a) => a.name),
        gives: sends.map((a) => a.name),
        status: tradeOfferStatus(t, me),
        awaitingMe: incoming && t.status === 'proposed',
      }
    })
}
