/**
 * Pure helpers for the mobile Profile and My start/sit screens (FieldScout
 * Mobile handoff, `m-profile.md`).
 */

import type { PositionRanking } from '@/components/mobile/rankings/position-rankings'
import {
  rankingStatus,
  rankingTitle,
  scoringLabel,
  toRankingsSearch,
  type RankPos,
  type RankStatus,
  type RankType,
} from '@/components/mobile/rankings/rankings-ops'
import { CRED_TIERS, computeCredRank } from '@/lib/cred-tiers'
import { hasTiers, isNumbered } from '@/lib/lists/ranking-mode'
import { shortPlayerName } from '@/utils/format-name'

/** Profile › "My stuff" segment (the handoff's `meTab` keys). */
export type MeTab = 'rankings' | 'lists' | 'ss'

export const ME_TABS: ReadonlyArray<{ value: MeTab; label: string }> = [
  { value: 'rankings', label: 'Rankings' },
  { value: 'lists', label: 'Lists' },
  { value: 'ss', label: 'Start/Sit' },
]

/** First visit opens on Lists — the handoff's initial `meTab` (§1 P2). */
export const DEFAULT_ME_TAB: MeTab = 'lists'

/** `?tab=` → segment. Takes the handoff's own keys plus readable aliases. */
export function parseMeTab(raw: string | null | undefined): MeTab | null {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'rankings':
    case 'ranking':
    case 'ranks':
      return 'rankings'
    case 'lists':
    case 'list':
      return 'lists'
    case 'ss':
    case 'start-sit':
    case 'startsit':
    case 'start-or-sit':
      return 'ss'
    default:
      return null
  }
}

/** The segment to show: the requested one when it is released, else Lists. */
export function resolveMeTab(requested: MeTab, available: readonly MeTab[]): MeTab {
  if (available.includes(requested)) return requested
  return available.includes('lists') ? 'lists' : (available[0] ?? 'lists')
}

/** `Aug 20`, with the year once it isn't `now`'s year (`Aug 20, 2025`). */
export function shortDate(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (date.getFullYear() !== new Date(now).getFullYear()) options.year = 'numeric'
  return date.toLocaleDateString('en-US', options)
}

/** `just now` / `5m ago` / `3h ago` / `2d ago`, then a date (`Aug 20`). */
export function relativeAgo(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const minutes = Math.floor((now - then) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return shortDate(iso, now)
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Titles: the leagues whose champion is the team the user manages there
 * (`leagues.champion_team_id`, written when a season completes, against
 * `league_members.team_id` — `MyLeagueRow.my_team_id`).
 */
export function countTitles(
  myLeagues: ReadonlyArray<{ id: string; my_team_id: string | null }>,
  champions: ReadonlyArray<{ id: string; champion_team_id: string | null }>,
): number {
  const myTeam = new Map(myLeagues.map((l) => [l.id, l.my_team_id]))
  return champions.filter((c) => c.champion_team_id !== null && myTeam.get(c.id) === c.champion_team_id).length
}

/** What the slim Cred card shows (not in the handoff — gap list §3 #21). */
export interface CredCard {
  /** Scout tier name, e.g. `JV`. */
  tier: string
  /** The tier's dot colour — the same one desktop's tier badge uses. */
  accent: string
  /** `Scout tier 3 of 10`. */
  level: string
  /** `340 cred`. */
  score: string
  /** `260 to Varsity`, or `Top tier` once there is no next tier. */
  next: string
  /** Fill of the bar: progress through the current tier toward the next, 0–100. */
  pct: number
  /** True on the last tier — the bar is full and nothing is left to earn. */
  top: boolean
  /** The bar's accessible name: `Progress to Varsity` / `Top tier reached`. */
  barLabel: string
}

/**
 * The Cred card from the stored `profiles.cred_score` and the existing tier
 * table (`lib/cred-tiers`, desktop's Cred score / Scout tier tiles and Cred
 * progress bar) — the same numbers and words desktop shows, no new scoring.
 */
export function credCard(credScore: number): CredCard {
  const rank = computeCredRank(credScore)
  return {
    tier: rank.current.name,
    accent: rank.current.accent,
    level: `Scout tier ${rank.current.level} of ${CRED_TIERS.length}`,
    score: `${credScore.toLocaleString('en-US')} cred`,
    next: rank.next ? `${rank.toNext.toLocaleString('en-US')} to ${rank.next.name}` : 'Top tier',
    pct: rank.progressPct,
    top: rank.next === null,
    barLabel: rank.next ? `Progress to ${rank.next.name}` : 'Top tier reached',
  }
}

// ---------------------------------------------------------------------------
// Lists preview
// ---------------------------------------------------------------------------

/**
 * The list's kind in the handoff's set — Ranked | Video | Tiers (§5): a tiered
 * list reads Tiers (with numbers or without — tier_only, migration 191), a
 * ranked one Ranked, an unranked one with a video Video. An unranked list
 * without a video has no word in that set, so it gets none.
 */
export function listKindLabel(rankingMode: string | null | undefined, hasVideo: boolean): string | null {
  if (hasTiers(rankingMode)) return 'Tiers'
  if (isNumbered(rankingMode)) return 'Ranked'
  return hasVideo ? 'Video' : null
}

/** Lists preview sub: `5 players · Ranked · Updated 2d ago` (§5). */
export function listRowSub(
  list: { player_count: number | null; ranking_mode: string | null; updated_at: string | null },
  hasVideo: boolean,
  now: number = Date.now(),
): string {
  const parts = [plural(list.player_count ?? 0, 'player', 'players')]
  const kind = listKindLabel(list.ranking_mode, hasVideo)
  if (kind) parts.push(kind)
  const ago = relativeAgo(list.updated_at, now)
  if (ago) parts.push(`Updated ${ago}`)
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// Rankings preview — one row per position ranking (gap list §3 #22)
// ---------------------------------------------------------------------------

/**
 * "See all" on the Rankings segment — the handoff's `#mine`: the mobile
 * Rankings screen on its Mine tab (`?view=mine`, `parseRankingsParams`, the
 * Rankings area's URL contract).
 */
export const MY_RANKINGS_HREF = '/app/weekly-ranks?view=mine'

/** "New ranking" — the handoff's `#new-ranking`: the hub's New ranking step 1. */
export const NEW_RANKING_HREF = '/app/weekly-ranks?new=1'

/**
 * A row opens the ranking you tap — its editor, over the Mine tab (the
 * handoff only opened `#mine`, OQ 6: "the app can deep-link to the exact
 * ranking today"). The editor's Back returns to Profile.
 */
export function rankingEditHref(type: RankType, pos: RankPos): string {
  return `/app/weekly-ranks${toRankingsSearch({
    src: 'mine',
    scoring: 'ppr',
    pos,
    overlay: { kind: 'edit', type, pos, from: null },
  })}`
}

/** `<period> · <pos> · <scoring>` (§5): `Week 5 · RB · Half PPR`,
 *  `Rest of season · D/ST · PPR` — the scoring the editor opens it on. */
export function rankingRowTitle(r: Pick<PositionRanking, 'type' | 'pos' | 'scoring'>, currentWeek: number): string {
  return `${rankingTitle(r.type, r.pos, currentWeek)} · ${scoringLabel(r.scoring)}`
}

/**
 * `Published · updated 2d ago` / `Finalized · updated Sep 28`. The app's own
 * status words (Chris, 2026-10-15: Publish is the only commit), where the
 * handoff had Submitted / Saved / Finalized: there is no saved-not-published
 * state, and no grading yet for "top 18%".
 */
export function rankingRowSub(
  r: Pick<PositionRanking, 'type' | 'savedAt'>,
  currentWeek: number,
  now: number = Date.now(),
): string {
  const status = rankingStatus(r.type, currentWeek)
  const ago = relativeAgo(r.savedAt, now)
  return ago ? `${status} · updated ${ago}` : status
}

/**
 * The status colours (§5): Published wears the design's Submitted green —
 * Publish is save-and-submit, as My rankings' status pill has it — and
 * Finalized its t4.
 */
export const RANKING_SUB_CLASS: Record<RankStatus, string> = {
  Published: 'text-m-green',
  Finalized: 'text-m-t4',
}

/** Newest save first, never-saved last; ties keep their order. */
export function sortRankingRows<T extends Pick<PositionRanking, 'savedAt'>>(rows: readonly T[]): T[] {
  const t = (r: T) => (r.savedAt ? new Date(r.savedAt).getTime() || 0 : 0)
  return [...rows].sort((a, b) => t(b) - t(a))
}

// ---------------------------------------------------------------------------
// Start/Sit — the user's own questions (`start_sit_questions`)
// ---------------------------------------------------------------------------

/** My start/sit filter chips (the handoff's `ssTab`). */
export type SsFilter = 'all' | 'open' | 'closed'

export const SS_FILTERS: ReadonlyArray<{ value: SsFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
]

export interface SsPlayer {
  id: string
  full_name: string
  team: string | null
  position: string | null
  headshot_url: string | null
}

/**
 * One of the user's questions as the app stores it: two players, "which do I
 * start?" — so every question is the handoff's "Start 1 of 2".
 */
export interface SsQuestion {
  id: string
  note: string | null
  season: number
  week: number
  votesA: number
  votesB: number
  closesAt: string
  resolvedAt: string | null
  createdAt: string | null
  playerA: SsPlayer
  playerB: SsPlayer
}

/**
 * A question on its own page (`/app/start-or-sit/[id]`): the question, who
 * asked it, and the scoring it was asked under — the name only when this
 * viewer can read that scoring system (a member's own system is private to
 * them), else null and the page just says the week.
 */
export interface SsQuestionDetail extends SsQuestion {
  poster: { id: string; username: string; avatarUrl: string | null }
  scoringName: string | null
}

/** The right-hand meta on a question's author row, drawn
 *  `ESPN Full PPR · Week 5` — or `Week 5` without a readable scoring name.
 *  Kept in its two parts so a long scoring name (up to 80 characters; a
 *  league's is "<league name> Custom") is what cuts off, never the week. */
export interface SsQuestionMeta {
  scoring: string | null
  week: string
}

export function ssQuestionMeta(q: Pick<SsQuestionDetail, 'week' | 'scoringName'>): SsQuestionMeta {
  return { scoring: q.scoringName?.trim() || null, week: `Week ${q.week}` }
}

const time = (iso: string | null | undefined) => {
  const t = iso ? new Date(iso).getTime() : NaN
  return Number.isNaN(t) ? 0 : t
}

/** Open = voting still running and not resolved (Home's My stuff rule). */
export function ssIsOpen(q: Pick<SsQuestion, 'closesAt' | 'resolvedAt'>, now: number): boolean {
  return q.resolvedAt === null && time(q.closesAt) > now
}

/**
 * Handoff §5 sort, written out: open questions first, newest first; then
 * closed ones by week, latest first (season, then week, then close time).
 */
export function sortSsQuestions(qs: readonly SsQuestion[], now: number): SsQuestion[] {
  return [...qs].sort((a, b) => {
    const ao = ssIsOpen(a, now)
    const bo = ssIsOpen(b, now)
    if (ao !== bo) return ao ? -1 : 1
    if (ao) return time(b.createdAt) - time(a.createdAt)
    return b.season - a.season || b.week - a.week || time(b.closesAt) - time(a.closesAt)
  })
}

export function filterSsQuestions(qs: readonly SsQuestion[], filter: SsFilter, now: number): SsQuestion[] {
  if (filter === 'all') return [...qs]
  return qs.filter((q) => ssIsOpen(q, now) === (filter === 'open'))
}

/** Chip counts, always over the unfiltered set (§3). */
export function ssCounts(qs: readonly SsQuestion[], now: number): Record<SsFilter, number> {
  const open = qs.filter((q) => ssIsOpen(q, now)).length
  return { all: qs.length, open, closed: qs.length - open }
}

/** "Votes received": every vote cast on the user's questions. */
export function ssVotesReceived(qs: readonly SsQuestion[]): number {
  return qs.reduce((n, q) => n + q.votesA + q.votesB, 0)
}

export interface SsResults {
  total: number
  /** Whole percents, A then B; 0 with no votes. */
  pcts: [number, number]
  /** The highlighted option(s): the highest %, ties included; none at 0 votes. */
  top: [boolean, boolean]
  /** The option the crowd leans to — null at 0 votes or when the % tie. */
  lean: 0 | 1 | null
}

export function ssResults(q: Pick<SsQuestion, 'votesA' | 'votesB'>): SsResults {
  const total = q.votesA + q.votesB
  const pcts: [number, number] = total
    ? [Math.round((q.votesA / total) * 100), Math.round((q.votesB / total) * 100)]
    : [0, 0]
  const max = Math.max(...pcts)
  const top: [boolean, boolean] = [total > 0 && pcts[0] === max, total > 0 && pcts[1] === max]
  const lean = top[0] === top[1] ? null : top[0] ? 0 : 1
  return { total, pcts, top, lean }
}

export const SS_MODE_LABEL = 'Start 1 of 2'

/** The question's own words, or its matchup when the poster wrote none. */
export function ssTitle(q: Pick<SsQuestion, 'note' | 'playerA' | 'playerB'>): string {
  const note = q.note?.trim()
  return note || `${shortPlayerName(q.playerA.full_name)} or ${shortPlayerName(q.playerB.full_name)}?`
}

/** Card meta: `Just now`, `12m`, `1h`, then the posting date (`Sep 28`). */
export function ssPostedLabel(iso: string | null, now: number): string {
  if (!iso) return ''
  const t = time(iso)
  const minutes = Math.floor((now - t) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return shortDate(iso, now) ?? ''
}

/** `Sun 1:00 PM` while the close is within the week, else its date. */
export function ssClosesLabel(iso: string, now: number): string {
  const t = time(iso)
  if (t - now < 6 * 24 * 60 * 60_000) {
    return new Date(t).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  }
  return shortDate(iso, now) ?? ''
}

/** `58 votes · crowd leans I. Pacheco` — the lean only while voting is open. */
export function ssFooter(q: SsQuestion, now: number): string {
  const r = ssResults(q)
  const parts = [plural(r.total, 'vote', 'votes')]
  if (ssIsOpen(q, now) && r.lean !== null) {
    parts.push(`crowd leans ${shortPlayerName((r.lean === 0 ? q.playerA : q.playerB).full_name)}`)
  }
  return parts.join(' · ')
}

/** Profile preview sub: `Start 1 of 2 · Open · 58 votes` (§5). */
export function ssPreviewSub(q: SsQuestion, now: number): string {
  const r = ssResults(q)
  return `${SS_MODE_LABEL} · ${ssIsOpen(q, now) ? 'Open' : 'Closed'} · ${plural(r.total, 'vote', 'votes')}`
}
