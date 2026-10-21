/**
 * League › League tab (FieldScout Mobile handoff, m-league.md) — the pure
 * half: the three segments and their URLs, the Transaction filters and the
 * feed reads they map to, the transaction rows built from the feed's stored
 * payloads, and the standings cells. Nothing here computes a score or a
 * rank: every number is the server's, only labelled.
 */
import type { ScheduleWeek } from '@/hooks/use-schedule'
import type { ActivityItem, TransactionActivityItem } from '@/lib/leagues/api/activity-service'
import type { MatchupRow } from '@/lib/leagues/api/matchups-service'
import type { StandingsRow } from '@/lib/leagues/api/standings-service'
import { posLabel } from '@/components/mobile/ui/m-pos-chip'
import { teamAvatarClass as matchTeamAvatarClass, orderMatchups } from '@/components/mobile/league/match/match-ops'
import { feedLines, groupFeedLines, transactionText } from '@/components/leagues/activity-feed-ops'
import { heroWeek } from '@/components/leagues/league-home-season-ops'
import { splitRows } from '@/components/leagues/matchup-view-ops'
import { formatRecord, renderedChain } from '@/components/leagues/standings-table-ops'
import { lostClaimWinner } from '@/components/leagues/team-transactions-ops'
import { claimOutcome, claimReasonWords } from '@/components/leagues/waiver-claims-ops'
import type { WaiverClaimPlayer, WaiverClaimView } from '@/lib/leagues/api/waivers-service'
import { TIEBREAKERS } from '@/lib/leagues/settings/league-settings'
import { shortPlayerName } from '@/utils/format-name'

// ---------------------------------------------------------------------------
// Segments (spec §2.1) — Matchups / Standings / Activity
// ---------------------------------------------------------------------------

export type LeagueSegment = 'matchups' | 'standings' | 'activity'

export const SEGMENTS: ReadonlyArray<{ value: LeagueSegment; label: string }> = [
  { value: 'matchups', label: 'Matchups' },
  { value: 'standings', label: 'Standings' },
  { value: 'activity', label: 'Activity' },
]

/** Each segment keeps the app's existing URL: the league page is Matchups. */
export function segmentHref(leagueId: string, segment: LeagueSegment): string {
  const base = `/app/leagues/${leagueId}`
  if (segment === 'standings') return `${base}/standings`
  if (segment === 'activity') return `${base}/activity`
  return base
}

// ---------------------------------------------------------------------------
// Matchups — which week shows (gap list §4 item 9: the week picker)
// ---------------------------------------------------------------------------

/** The week League › Matchups shows: the week it was stepped to while that
 *  week is on the ladder, else the ladder's current week (`heroWeek` — the
 *  greatest started week, else the first). `null` while the ladder is
 *  unknown or empty. */
export function matchupsWeek(kept: number | undefined, weeks: readonly Pick<ScheduleWeek, 'week' | 'status'>[] | undefined): number | null {
  if (!weeks) return null
  if (kept !== undefined && weeks.some((w) => w.week === kept)) return kept
  return heroWeek(weeks)
}

/** What to keep when Matchups steps to `week`: the current week is not
 *  kept (`null`), so the picker's default keeps following the season. */
export function weekToKeep(week: number, weeks: readonly Pick<ScheduleWeek, 'week' | 'status'>[]): number | null {
  return week === heroWeek(weeks) ? null : week
}

// ---------------------------------------------------------------------------
// Matchups — the week's two groups (gap list §4 item 10)
// ---------------------------------------------------------------------------

/** The heading over a second-opponent league's extra games, and the line
 *  under it (the desktop list's own title; the design draws neither). */
export const SECOND_OPPONENTS_TITLE = 'Second opponents'
export const SECOND_OPPONENTS_NOTE = 'Each team’s second game. It counts in the record too.'

/** The week's cards in their two groups: the matchups (`regular` /
 *  `playoff` rows) and the second-opponent games (the `secondary` rows a
 *  `second_opponent` league stores, §11.7) — each with yours first, then the
 *  rest in the server's order. A league without second opponents has none. */
export function matchupGroups(matchups: readonly MatchupRow[], myTeamId: string | null): { primary: MatchupRow[]; secondary: MatchupRow[] } {
  const { primary, secondary } = splitRows(matchups)
  return { primary: orderMatchups(primary, myTeamId), secondary: orderMatchups(secondary, myTeamId) }
}

/** The Transactions screen (spec §2.5). `mine` = "My moves" (Team tab's
 *  Moves tile); `team` = pre-filtered to one team (a team view's "See all"). */
export function transactionsHref(leagueId: string, opts: { mine?: boolean; team?: string | null } = {}): string {
  const params = new URLSearchParams()
  if (opts.mine) params.set('mine', '1')
  else if (opts.team) params.set('team', opts.team)
  const q = params.toString()
  return `/app/leagues/${leagueId}/activity/transactions${q ? `?${q}` : ''}`
}

/** The segment a League-tab address shows: `/standings`, `/activity`, or
 *  null for the league page (which opens the segment last used here).
 *  `undefined` when the address is not one of the three. */
export function segmentAtPath(pathname: string, leagueId: string): LeagueSegment | null | undefined {
  const base = `/app/leagues/${leagueId}`
  const path = pathname.replace(/\/+$/, '')
  if (path === base) return null
  if (path === `${base}/standings`) return 'standings'
  if (path === `${base}/activity`) return 'activity'
  return undefined
}

/** The Standings address, with the bracket over the table when asked. */
export function standingsHref(leagueId: string, bracket: boolean): string {
  return `${segmentHref(leagueId, 'standings')}${bracket ? '?tab=playoffs' : ''}`
}

/** The Commissioner log as its own full screen (no switcher, nothing lit):
 *  `/activity/commissioner`, with the desktop tab's own filters. */
export function commishLogHref(leagueId: string, route: { team?: string | null; week?: number | null; entry?: string | null } = {}): string {
  const params = new URLSearchParams()
  if (route.week != null) params.set('week', String(route.week))
  if (route.team) params.set('team', route.team)
  if (route.entry) params.set('entry', route.entry)
  const q = params.toString()
  return `/app/leagues/${leagueId}/activity/commissioner${q ? `?${q}` : ''}`
}

/** Stat corrections as its own full screen: `/activity/corrections`. */
export function correctionsScreenHref(leagueId: string, week: number | null = null): string {
  return `/app/leagues/${leagueId}/activity/corrections${week != null ? `?week=${week}` : ''}`
}

// ---------------------------------------------------------------------------
// Transaction filters (spec §2.6, §3)
// ---------------------------------------------------------------------------

export type TxType = 'All' | 'Trades' | 'Free agents' | 'Waivers'

export const TYPE_CHIPS: ReadonlyArray<{ value: TxType; label: string }> = [
  { value: 'All', label: 'All types' },
  { value: 'Trades', label: 'Trades' },
  { value: 'Free agents', label: 'Free agents' },
  { value: 'Waivers', label: 'Waivers' },
]

export interface TxFilter {
  type: TxType
  /** Team ids; empty = "All teams". */
  teams: string[]
}

export const NO_FILTER: TxFilter = { type: 'All', teams: [] }

/** `nFilt` — a type counts 1, a team selection counts 1 (not in My moves). */
export function filterCount(filter: TxFilter, myMoves: boolean): number {
  return (filter.type !== 'All' ? 1 : 0) + (!myMoves && filter.teams.length > 0 ? 1 : 0)
}

/** "Filter" or "Filter · N" (U+00B7). */
export function filterLabel(count: number): string {
  return count > 0 ? `Filter · ${count}` : 'Filter'
}

export function emptyFilterCopy(myMoves: boolean): string {
  return myMoves ? 'No moves match this filter' : 'No transactions match this filter'
}

/** "Clear filter": the type always resets; in My moves the hidden team
 *  selection is kept (spec §3). */
export function clearedFilter(filter: TxFilter, myMoves: boolean): TxFilter {
  return { type: 'All', teams: myMoves ? filter.teams : [] }
}

/** One read of the activity feed (`GET …/activity`); `parties` keeps a
 *  league-wide read to the moves naming one of those teams. */
export interface FeedStream {
  teamId?: string
  type?: readonly string[]
  topic?: 'trades'
  parties?: readonly string[]
}

const FREE_AGENCY_TYPES = ['add', 'drop', 'add_drop'] as const
const WAIVER_TYPES = ['waiver_claim'] as const
/** The moves a team only ever starts itself (its own adds, drops, claims). */
const OWN_MOVE_TYPES = ['add', 'drop', 'add_drop', 'waiver_claim'] as const
/** The moves that can name a team that did not start them: a trade (either
 *  side) and a commissioner's move (no starting team at all). */
const SHARED_MOVE_TYPES = ['trade', 'commissioner_move'] as const

/**
 * The filter → the feed reads. Without a team: one read (Trades = the
 * feed's own `trades` topic — went through, vetoed, reversed). With teams:
 * the read's `team_id` matches only the team that STARTED a move, so each
 * team's own adds, drops and claims are a read per team, and trades and
 * commissioner moves are one league-wide read kept to the moves that name a
 * selected team (`parties`) — a trade the team received is in its list. The
 * hook merges them in the feed's order.
 */
export function feedStreams(filter: TxFilter, myMoves: boolean, myTeamId: string | null): FeedStream[] {
  const teams = myMoves ? (myTeamId ? [myTeamId] : []) : [...filter.teams].sort()
  if (teams.length === 0) {
    switch (filter.type) {
      case 'Trades':
        return [{ topic: 'trades' }]
      case 'Free agents':
        return [{ type: FREE_AGENCY_TYPES }]
      case 'Waivers':
        return [{ type: WAIVER_TYPES }]
      default:
        return [{}]
    }
  }
  switch (filter.type) {
    case 'Trades':
      return [{ topic: 'trades', parties: teams }]
    case 'Free agents':
      return teams.map((teamId) => ({ type: FREE_AGENCY_TYPES, teamId }))
    case 'Waivers':
      return teams.map((teamId) => ({ type: WAIVER_TYPES, teamId }))
    default:
      return [...teams.map((teamId) => ({ type: OWN_MOVE_TYPES, teamId })), { type: SHARED_MOVE_TYPES, parties: teams }]
  }
}

// ---------------------------------------------------------------------------
// Transaction rows (spec §2.5 item 5)
// ---------------------------------------------------------------------------

export type PillTone = 'trade' | 'waiver' | 'free' | 'commish' | 'league' | 'correction'

export interface Pill {
  label: string
  tone: PillTone
}

export const TYPE_PILL: Record<string, Pill> = {
  add: { label: 'Free agency', tone: 'free' },
  drop: { label: 'Free agency', tone: 'free' },
  add_drop: { label: 'Free agency', tone: 'free' },
  waiver_claim: { label: 'Waiver', tone: 'waiver' },
  trade: { label: 'Trade', tone: 'trade' },
  commissioner_move: { label: '✸ Commissioner', tone: 'commish' },
}

/** A sentence piece: plain words, or a manager — a door to his profile
 *  (project rule 2026-09-30: every displayed username links). A team with
 *  no manager reads as its name. */
export type TextPart = string | { username: string }

/** Who a team is, in a sentence: its manager, else its name. */
export type WhoOf = (teamId: string | null) => TextPart | null

export interface MoveLine {
  key: string
  playerId: string | null
  name: string
  position: string | null
  nflTeam: string | null
  tone: 'add' | 'drop'
  verb: string
  /** Extra words after "pos · team" (a trade's roster drop, a move's from → to). */
  note: TextPart[] | null
  /** Nothing happened to this player (a claim that didn't go through): the
   *  + / − and the verb are drawn grey, not green / red. */
  muted?: boolean
}

export interface TxRow {
  kind: 'transaction'
  id: string
  /** The team whose side the row tells (its manager heads the row). */
  teamId: string | null
  pill: Pill
  createdAt: string | null
  /** The winning FAAB bid, when the claim debited FAAB. */
  bid: number | null
  moves: MoveLine[]
  /** A sentence when the payload names no players we can draw (a trade
   *  reversal, a retirement), the trade's tail ("Trade with @x · $5 FAAB
   *  sent"), or why a claim didn't go through. */
  text: TextPart[] | null
  commishActionId: string | null
  /** A claim of yours that didn't go through (My moves): its result, drawn
   *  in red after the pill — "Lost" / "Didn’t go through". */
  result?: ClaimResult
}

/** The result of a claim a waiver run settled without giving you the player. */
export interface ClaimResult {
  status: 'lost' | 'invalid'
  /** The claims panel's words. */
  label: string
}

export interface PostRow {
  kind: 'post'
  id: string
  pill: Pill
  createdAt: string | null
  text: string
  actorUsername: string | null
  commishActionId: string | null
}

export type FeedRow = TxRow | PostRow

type Doc = Record<string, unknown>
const asDoc = (v: unknown): Doc => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Doc) : {})
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function sideLine(side: unknown, tone: 'add' | 'drop', key: string): MoveLine | null {
  const d = asDoc(side)
  const playerId = str(d.player_id)
  const name = str(d.name)
  if (!playerId && !name) return null
  return {
    key,
    playerId,
    name: name ?? '',
    position: str(d.position),
    nflTeam: str(d.nfl_team),
    tone,
    verb: tone === 'add' ? 'Added' : 'Dropped',
    note: null,
  }
}

function idLine(playerId: unknown, tone: 'add' | 'drop', verb: string, key: string, note: TextPart[] | null = null): MoveLine | null {
  const id = str(playerId)
  if (!id) return null
  return { key, playerId: id, name: '', position: null, nflTeam: null, tone, verb, note }
}

/** Parts joined by " · ", dropping the empty ones. */
function joinParts(groups: ReadonlyArray<TextPart[] | null>): TextPart[] | null {
  const kept = groups.filter((g): g is TextPart[] => g !== null && g.length > 0)
  if (kept.length === 0) return null
  return kept.flatMap((g, i) => (i === 0 ? g : [' · ', ...g]))
}

/**
 * One transaction as the design's row. Adds, drops and won claims read the
 * stored `add` / `drop` objects (name, position, team). A trade is told from
 * ONE side in the design's Added / Dropped words — what that team received
 * is Added, what it gave is Dropped, a player it released to make room is a
 * roster drop — and names the other manager; the side is a selected team's
 * when the list is filtered to teams (`perspective`: My moves, a team's "See
 * all"), else the side that started it. A commissioner's roster move reads
 * the player ids it recorded. Anything else is its sentence.
 */
export function transactionRow(
  item: TransactionActivityItem,
  who: WhoOf,
  commishActionId: string | null,
  perspective: readonly string[] = [],
): TxRow {
  const payload = asDoc(item.payload)
  const pill = TYPE_PILL[item.type] ?? { label: item.type.replace(/_/g, ' '), tone: 'league' as const }
  const base: TxRow = {
    kind: 'transaction',
    id: item.id,
    teamId: item.team_id,
    pill,
    createdAt: item.created_at,
    bid: null,
    moves: [],
    text: null,
    commishActionId,
  }
  const done = item.status === 'complete'
  const one = (v: TextPart | null): TextPart[] | null => (v === null ? null : [v])

  if ((item.type === 'add' || item.type === 'drop' || item.type === 'add_drop' || item.type === 'waiver_claim') && done) {
    const moves = [sideLine(payload.add, 'add', `${item.id}:add`), sideLine(payload.drop, 'drop', `${item.id}:drop`)].filter(
      (m): m is MoveLine => m !== null,
    )
    const bid = item.type === 'waiver_claim' && num(payload.faab_bid) !== null && num(payload.faab_before) !== null ? num(payload.faab_bid) : null
    if (moves.length > 0) return { ...base, moves, bid }
  }

  if (item.type === 'trade' && done) {
    const proposer = str(payload.proposer_team_id)
    const recipient = str(payload.recipient_team_id)
    const sides = [proposer, recipient].filter((t): t is string => t !== null)
    const me = perspective.find((t) => sides.includes(t)) ?? item.team_id ?? proposer
    const other = proposer === me ? recipient : proposer
    const moves: MoveLine[] = []
    const players = Array.isArray(payload.players) ? payload.players : []
    players.forEach((raw, i) => {
      const p = asDoc(raw)
      const received = str(p.to_team_id) === me
      const gave = str(p.from_team_id) === me
      if (!received && !gave) return
      const line = idLine(p.player_id, received ? 'add' : 'drop', received ? 'Added' : 'Dropped', `${item.id}:p${i}`)
      if (line) moves.push({ ...line, name: str(p.name) ?? '' })
    })
    const drops = Array.isArray(payload.drops) ? payload.drops : []
    drops.forEach((raw, i) => {
      const d = asDoc(raw)
      const team = str(d.team_id)
      const note: TextPart[] = team && team !== me ? [...(one(who(team)) ?? []), ' · roster drop'] : ['Roster drop']
      const line = idLine(d.player_id, 'drop', 'Dropped', `${item.id}:d${i}`, note)
      if (line) moves.push({ ...line, name: str(d.name) ?? '' })
    })
    const faab = (Array.isArray(payload.faab) ? payload.faab : [])
      .map((raw): TextPart[] | null => {
        const f = asDoc(raw)
        const amount = num(f.amount)
        if (amount === null) return null
        if (str(f.to_team_id) === me) return [`$${amount} FAAB received`]
        if (str(f.from_team_id) === me) return [`$${amount} FAAB sent`]
        return null
      })
    const via =
      payload.via === 'commissioner_force' ? 'forced through by the commissioner' : payload.via === 'commissioner_approve' ? 'approved by the commissioner' : null
    const otherWho = other ? who(other) : null
    const tail = joinParts([otherWho ? ['Trade with ', otherWho] : null, ...faab, via ? [via] : null])
    if (moves.length > 0) return { ...base, teamId: me, moves, text: tail }
  }

  if (item.type === 'commissioner_move' && done && payload.kind !== 'trade_reversal' && payload.verb !== 'retire_franchise') {
    const fromTeam = str(payload.from_team_id)
    const toTeam = str(payload.to_team_id)
    const from = who(fromTeam)
    const to = who(toTeam)
    const moves = [
      idLine(payload.added_player_id, 'add', 'Added', `${item.id}:a`),
      idLine(payload.dropped_player_id, 'drop', 'Dropped', `${item.id}:d`),
      idLine(payload.moved_player_id, 'add', 'Moved', `${item.id}:m`, from && to ? [from, ' → ', to] : null),
    ].filter((m): m is MoveLine => m !== null)
    const named = [str(payload.team_id), toTeam, fromTeam].filter((t): t is string => t !== null)
    const teamId = named.find((t) => perspective.includes(t)) ?? named[0] ?? item.team_id
    if (moves.length > 0) return { ...base, teamId, moves }
  }

  return { ...base, text: [capitalise(transactionText(item))] }
}

function capitalise(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s
}

/**
 * The feed's items as rows, newest first — ONE row per act: the desktop
 * feed's own folding (a commissioner's act that wrote a move and a post
 * shows the move) and grouping (back-to-back lineup fixes read as one).
 */
export function feedRows(
  items: readonly ActivityItem[],
  teamNames: ReadonlyMap<string, string>,
  memberNames: ReadonlyMap<string, string>,
  who: WhoOf,
  perspective: readonly string[] = [],
): FeedRow[] {
  const lines = feedLines(items, teamNames, memberNames)
  const grouped = groupFeedLines(items, lines)
  const byId = new Map(items.map((i) => [i.id, i]))
  return grouped.map(({ line }): FeedRow => {
    const item = byId.get(line.id)
    if (item && item.kind === 'transaction') return transactionRow(item, who, line.commishActionId, perspective)
    const topic = item && item.kind === 'system' ? item.topic : null
    const pill: Pill = topic === 'stat_correction'
      ? { label: 'Stat correction', tone: 'correction' }
      : line.commissioner
        ? { label: '✸ Commissioner', tone: 'commish' }
        : { label: 'League', tone: 'league' }
    return {
      kind: 'post',
      id: line.id,
      pill,
      createdAt: line.createdAt,
      text: line.text,
      actorUsername: line.actorUsername,
      commishActionId: line.commishActionId,
    }
  })
}

// ---------------------------------------------------------------------------
// Waiver claims that didn't go through (gap list §3 #12) — My moves only
// ---------------------------------------------------------------------------

function claimLine(player: WaiverClaimPlayer, tone: 'add' | 'drop', key: string): MoveLine {
  return {
    key,
    playerId: player.player_id,
    name: player.full_name ?? '',
    position: player.position,
    nflTeam: player.nfl_team,
    tone,
    verb: tone === 'add' ? 'Claim' : 'Drop',
    note: null,
    muted: true,
  }
}

/** Why, from the stored reason: a lost claim names who won him and what he
 *  went for (the desktop panel's D495 words, the winner a door to his
 *  manager's profile); a failed one the reason's own words. */
function claimReason(claim: WaiverClaimView, waiverType: string | null, who: WhoOf): TextPart[] | null {
  const winner = lostClaimWinner(claim, waiverType)
  if (winner) {
    const name = claim.add.full_name ? shortPlayerName(claim.add.full_name, claim.add.position) : 'him'
    return [who(winner.winnerTeamId) ?? winner.winnerTeamName, ` won ${name}${winner.priceSuffix} ${winner.reason}`]
  }
  if (claim.status === 'invalid') {
    const words = claimReasonWords(claim.result_reason)
    if (words) return [capitalise(words)]
  }
  const detail = claimOutcome(claim, waiverType).detail
  return detail ? [detail] : null
}

/**
 * Your claims a waiver run settled without giving you the player, as
 * transaction rows in the read's order (newest first): LOST (another team
 * won him) or INVALID ("didn't go through" — the stored reason says why).
 * Each is the Waiver pill with the result in red, when the run settled it
 * (when it was made, if the run left no time) and your bid, the player you
 * claimed and the one you'd have dropped (both grey — nothing moved), then
 * the reason in plain words. A won claim is already a move in the feed; a
 * cancelled one was your own doing — neither is a row (the desktop panel's
 * rule).
 */
export function claimResultRows(claims: readonly WaiverClaimView[], waiverType: string | null, who: WhoOf): TxRow[] {
  return claims.flatMap((claim): TxRow[] => {
    if (claim.status !== 'lost' && claim.status !== 'invalid') return []
    return [
      {
        kind: 'transaction',
        id: `claim:${claim.id}`,
        teamId: claim.team_id,
        pill: TYPE_PILL.waiver_claim,
        createdAt: claim.processed_at ?? claim.created_at,
        bid: waiverType === 'faab' ? claim.faab_bid : null,
        moves: [claimLine(claim.add, 'add', `${claim.id}:add`), ...(claim.drop ? [claimLine(claim.drop, 'drop', `${claim.id}:drop`)] : [])],
        text: claimReason(claim, waiverType, who),
        commishActionId: null,
        result: { status: claim.status, label: claimOutcome(claim, waiverType).label },
      },
    ]
  })
}

function instant(iso: string | null): number {
  const ms = iso ? Date.parse(iso) : Number.NaN
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

/**
 * The feed's rows with your lost and failed claims slotted in by time,
 * newest first. The feed's own order is kept; each claim goes above the
 * first row older than it (a claim and a move at the same instant — one
 * waiver run — put the claim first, as the desktop panel does). While older
 * moves are still unread (`complete` false) a claim older than the oldest
 * row shown waits for its page, so it never sits above moves made before it.
 */
export function withClaimResults(rows: readonly FeedRow[], claims: readonly TxRow[], complete: boolean): FeedRow[] {
  if (claims.length === 0) return [...rows]
  const timed = rows.map((r) => instant(r.createdAt)).filter((ms) => ms !== Number.NEGATIVE_INFINITY)
  const floor = complete || timed.length === 0 ? Number.NEGATIVE_INFINITY : Math.min(...timed)
  const waiting = claims
    .map((row, index) => ({ row, index, ms: instant(row.createdAt) }))
    .filter((c) => c.ms >= floor)
    .sort((a, b) => (b.ms === a.ms ? a.index - b.index : b.ms - a.ms))
  const out: FeedRow[] = []
  let k = 0
  for (const row of rows) {
    const ms = instant(row.createdAt)
    while (k < waiting.length && waiting[k]!.ms >= ms) out.push(waiting[k++]!.row)
    out.push(row)
  }
  while (k < waiting.length) out.push(waiting[k++]!.row)
  return out
}

/** Every player id a row draws, for one headshot / identity read. */
export function rowPlayerIds(rows: readonly FeedRow[]): string[] {
  const ids = new Set<string>()
  for (const r of rows) if (r.kind === 'transaction') for (const m of r.moves) if (m.playerId) ids.add(m.playerId)
  return [...ids]
}

/** "WR · ARI" (D/ST for a defense). */
export function moveSub(position: string | null, nflTeam: string | null): string {
  return [position ? posLabel(position) : null, nflTeam].filter(Boolean).join(' · ')
}

/** "Oct 11, 12:06 PM" in the viewer's zone — no year. */
export function formatTxDate(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms))
}

// ---------------------------------------------------------------------------
// Standings cells (spec §2.3)
// ---------------------------------------------------------------------------

/** "$103 (10)" — FAAB left (waiver priority); a priority league shows the
 *  place alone; a league without waivers, or a seat with neither, a dash. */
export function waiverCell(row: Pick<StandingsRow, 'faab_balance' | 'waiver_priority'>, waiverType: string): string {
  if (waiverType === 'none_fcfs') return '—'
  const prio = row.waiver_priority
  if (waiverType === 'faab' && row.faab_balance !== null) return prio !== null ? `$${row.faab_balance} (${prio})` : `$${row.faab_balance}`
  return prio !== null ? `#${prio}` : '—'
}

/** ["vs median 4-4", "2nd opp 3-5"] — the extra records under a team's
 *  name, each only where the league plays that game (`recordColumns` — the
 *  league's settings, or records already on the table); empty when neither.
 *  Separate parts so the row can wrap between them on a narrow phone
 *  instead of cutting the second one away. */
export function extraRecords(
  row: Pick<StandingsRow, 'median_record' | 'second_record'>,
  shown: { median: boolean; second: boolean },
): string[] {
  const parts: string[] = []
  if (shown.median) parts.push(`vs median ${formatRecord(row.median_record)}`)
  if (shown.second) parts.push(`2nd opp ${formatRecord(row.second_record)}`)
  return parts
}

/** Each tiebreaker in plain words. Divisions are left out — they are off in
 *  v1, so that entry never separates anyone (117 marks it inert). */
const TIEBREAK_WORDS: Record<string, string> = {
  win_pct: 'best record',
  points_for: 'most points for',
  head_to_head: 'head-to-head (two-team ties)',
  points_against: 'most points against',
  coin_flip: 'a coin flip',
}

/**
 * The chain 117 would return for a league, built from its stored setting —
 * used only when the read carries no chain. Mirrors 117 exactly: the stored
 * entries in their order, then every catalog entry the stored list leaves
 * out, in the catalog's default order (so the chain is always total);
 * divisions are inert; head-to-head is skipped unless the league plays
 * head-to-head games (`schedule_mode = 'h2h'`).
 */
function storedChain(stored: readonly string[], scheduleMode: string): Array<{ entry: string; status: 'applied' | 'skipped' | 'inert' }> {
  const order: string[] = []
  for (const e of [...stored, ...TIEBREAKERS]) if (!order.includes(e)) order.push(e)
  return order.map((entry) => ({
    entry,
    status: entry === 'division_record' ? 'inert' : entry === 'head_to_head' && scheduleMode !== 'h2h' ? 'skipped' : 'applied',
  }))
}

/**
 * How the table breaks ties, in one plain sentence (gap list #40), from the
 * league's own tiebreak order. The standings read returns it as `chain` —
 * the stored `settings.tiebreakers` in order, the rest appended, each entry
 * marked applied / skipped / inert — and that chain always wins. Only the
 * read's own chain is the truth; when it carries none, the same chain is
 * rebuilt from the stored setting (`storedChain`). Only applied entries are
 * named: a total-points league skips head-to-head (no head-to-head games),
 * divisions are inert. The coin flip ends every tie (117: "coin_flip ends
 * every tie"), so the sentence stops there — nothing after it can separate
 * anyone.
 *
 * Record comes first by default, so the sentence says what breaks a tied
 * record: "Ties go to most points for, then head-to-head (two-team ties),
 * then most points against, then a coin flip." A league whose order puts
 * something else first says what it ranks by: "Ranked by most points for,
 * then best record, …". Higher points against wins a tie on purpose (the
 * team that allowed more had the harder schedule — §7.3.7).
 */
export function tiebreakNote(chain: unknown, stored: readonly string[], scheduleMode: string): string | null {
  const rendered = renderedChain(chain)
  const order = rendered.length > 0 ? rendered : storedChain(stored, scheduleMode)
  const entries: string[] = []
  for (const e of order) {
    if (e.status !== 'applied' || !TIEBREAK_WORDS[e.entry]) continue
    entries.push(e.entry)
    if (e.entry === 'coin_flip') break
  }
  if (entries.length === 0) return null
  const words = entries.map((e) => TIEBREAK_WORDS[e])
  if (entries[0] === 'win_pct') {
    const rest = words.slice(1)
    return rest.length > 0 ? `Ties go to ${rest.join(', then ')}.` : null
  }
  return `Ranked by ${words.join(', then ')}.`
}

/** "Top 6 make the playoffs. Line marks the cutoff." — N from the
 *  league's own setting; a league without playoffs says so. */
export function playoffNote(playoffTeams: number): string {
  if (playoffTeams <= 0) return 'Playoffs are off for this league — the final standings decide the champion.'
  return `Top ${playoffTeams} make the playoffs. Line marks the cutoff.`
}

// ---------------------------------------------------------------------------
// Team avatars — the design's TEAMS palette (teams store no colour)
// ---------------------------------------------------------------------------

/** Your team is the blue; the others take the handoff's TEAMS colours in
 *  league order. ONE palette with the Match tab (`match-ops`), so a team
 *  wears the same colour on every league screen. A seat with no team: t5. */
export function teamAvatarClass(teamId: string | null, teamIds: readonly string[], myTeamId: string | null): string {
  if (!teamId) return 'bg-m-t5'
  return matchTeamAvatarClass(teamIds, teamId, myTeamId)
}

/** The avatar glyph: the team name's first character. */
export function teamInitial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase()
}
