import type { CommunityItem, CommunityPlayer } from '@/hooks/use-mobile-community-feed'
import { seasonLabel } from '@/components/mobile/rankings/rankings-ops'
import { authorAvatarClass } from '@/components/mobile/ui/avatar-colors'
import { DEFAULT_RANKING_SCORING, personaScoringFormat } from '@/lib/lists/ranking-publish'
import { activeWeekOf } from '@/lib/rankings/week-window'
import { handleInitials } from '@/utils/initials'

/**
 * FieldScout Mobile — Community, the pure half (handoff m-community). Tabs,
 * topics, the inline search and the Rankings chips all filter one pool of
 * public lists on the client, exactly as the prototype's `cmVals()` does;
 * these are its rules, over the app's real fields.
 */

export type CommunityTab = 'all' | 'following' | 'poll' | 'rank' | 'list'

export const COMMUNITY_TABS: readonly { value: CommunityTab; label: string }[] = [
  { value: 'all', label: 'For you' },
  { value: 'following', label: 'Following' },
  { value: 'poll', label: 'Start or sit' },
  { value: 'rank', label: 'Rankings' },
  { value: 'list', label: 'Lists' },
]

/**
 * Where the Create sheet's rows go (m-community §3, m-composer §3.1).
 * Ranking: the new-ranking wizard (the Rankings area opens it at `?new=1`,
 * on the current week — the handoff's `#new-ranking`). List: the mobile New
 * list screen (lr-lists §2.2, step 1 — the composer's "name your list"),
 * marked as started from Community: its X comes back here as every Back
 * does, and once its players are saved it returns here too, refreshed, with
 * "List created" (gap list §3 #8; `lists-nav.ts`). Community's and the
 * Latest page's "Create a list" open it the same way.
 */
export const CREATE_RANKING_HREF = '/app/weekly-ranks?new=1'
export const CREATE_LIST_HREF = '/app/lists/new?from=community'

/**
 * A topic pill: a tag the pool's lists carry, a player they share, or the
 * always-present "Injuries" pill — lists that include a player on this week's
 * injury report (Chris, 2026-10-15, gap list #37; the injury report is the
 * one Home's "Injury news" reads — see `useCommunityInjuryMatches`).
 */
export type CommunityTopic =
  | { kind: 'tag'; id: string; label: string }
  | { kind: 'player'; id: string; label: string; player: CommunityPlayer }
  | { kind: 'injuries'; id: 'injuries'; label: 'Injuries' }

export const INJURIES_TOPIC: CommunityTopic = { kind: 'injuries', id: 'injuries', label: 'Injuries' }

/**
 * A ranking's type: one NFL week's board, or a season ranking — the big
 * board, called "Rest of season" in season and "Pre-draft" in the offseason
 * (`seasonLabel`, the Rankings area's name for it), and an AI expert's board
 * (every AI expert ranking is season-long, as the Rankings area reads them).
 */
export type RankType = 'weekly' | 'season'
export type CommunityScoring = 'PPR' | 'Half PPR' | '0.25 PPR' | 'Standard'

/**
 * The scoring a published ranking was made for, as saved on the list
 * (`lists.scoring_format`, migration 190 — Chris, 2026-10-15, gap list #36).
 * NULL for rankings published before it existed.
 */
export type ScoringFormat = 'ppr' | 'half' | 'quarter' | 'standard'
export const SCORING_FORMATS: readonly ScoringFormat[] = ['ppr', 'half', 'quarter', 'standard']
export const SCORING_FORMAT_LABEL: Record<ScoringFormat, CommunityScoring> = {
  ppr: 'PPR',
  half: 'Half PPR',
  quarter: '0.25 PPR',
  standard: 'Standard',
}

/**
 * A row's saved scoring, or null. Tolerates a row read before migration 190
 * is pushed (no `scoring_format` key at all — the reads use `select('*')` and
 * never name the column) and any value outside the vocabulary.
 */
export function scoringFormatOf(row: { scoring_format?: unknown } | null | undefined): ScoringFormat | null {
  const value = row?.scoring_format
  return typeof value === 'string' && (SCORING_FORMATS as readonly string[]).includes(value) ? (value as ScoringFormat) : null
}

/**
 * A ranking with no saved scoring is Half PPR (Chris, 2026-10-16: "if no
 * scoring type is selected, default to half point ppr") — rankings published
 * before migration 190, and every ranking until 190 is pushed.
 */
export const DEFAULT_SCORING_FORMAT: ScoringFormat = DEFAULT_RANKING_SCORING

/**
 * The scoring a ranking counts as — the rule migration 190 saves
 * (`fill_ranking_scoring_internal`), so a ranking reads the same before and
 * after the push: its saved scoring; else, on an AI expert's board, its
 * persona's usual scoring (`style_profile.scoring_default`, passed as
 * `personaDefault`); else Half PPR. What its label says and what the
 * Rankings scoring chips filter on — one answer.
 */
export function effectiveScoringFormat(saved: ScoringFormat | null, personaDefault?: string | null): ScoringFormat {
  return saved ?? personaScoringFormat(personaDefault)
}

export type RankTypeFilter = 'all' | RankType
export type RankPosFilter = 'all' | 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST'
/** Any scoring, or one scoring. A ranking with no saved scoring counts as
 *  Half PPR, an AI expert's as its usual scoring (`effectiveScoringFormat`). */
export type RankScoringFilter = 'all' | ScoringFormat
export interface RankFilters {
  type: RankTypeFilter
  pos: RankPosFilter
  scoring: RankScoringFilter
}
export const RANK_FILTERS_ALL: RankFilters = { type: 'all', pos: 'all', scoring: 'all' }

/** A weekly big board's permanent slug (`/api/big-board/week/[n]` writes
 *  `week-<n>-big-board-<ts>`; slugs are never regenerated). Who owns which
 *  week (`big_board_weekly`) is owner-only, so the slug is what a viewer
 *  can read. */
const WEEKLY_BOARD_SLUG = /^week-(\d+)-big-board(?:-|$)/

/**
 * Rankings vs lists. In the handoff a ranking is a ranking product — a week,
 * rest of season or the draft — and a list is a person's own grouping
 * (which may itself be ordered). The app's equivalents: the season big
 * board, the weekly boards and the AI experts' boards are rankings; every
 * other list is a list. (`ranking_mode` can't tell them apart — nearly every
 * list is "ranked" by default.) A weekly board's week is in its slug.
 */
export function classifyCommunityList(list: {
  is_big_board: boolean | null
  slug: string
  ai_persona_id: string | null
}): { kind: 'rank' | 'list'; rankType: RankType | null; week: number | null } {
  if (list.is_big_board) return { kind: 'rank', rankType: 'season', week: null }
  const weekly = WEEKLY_BOARD_SLUG.exec(list.slug)
  if (weekly) return { kind: 'rank', rankType: 'weekly', week: Number(weekly[1]) }
  if (list.ai_persona_id) return { kind: 'rank', rankType: 'season', week: null }
  return { kind: 'list', rankType: null, week: null }
}

/**
 * The NFL season a moment belongs to: March to February — the offseason
 * counts toward the season it leads into, January and February's playoffs
 * toward the one ending. (Weekly boards reuse week numbers every season.)
 */
export function nflSeasonOf(ms: number): number {
  const d = new Date(ms)
  return d.getUTCMonth() < 2 ? d.getUTCFullYear() - 1 : d.getUTCFullYear()
}

/**
 * Is it a ranking for "Rankings this week" (gap list §3 #27): a season
 * ranking, or this week's board — the app's week (`activeWeekOf`: Week 1 in
 * the offseason), made this season. Another week's board, or a board left
 * from an earlier season with the same week number, is not. A board whose
 * time can't be read is taken at its week number.
 */
export function rankingThisWeek(
  item: Pick<CommunityItem, 'rankType' | 'rankWeek' | 'createdAt'>,
  currentWeek: number,
  now: number,
): boolean {
  if (item.rankType !== 'weekly') return true
  if (item.rankWeek !== activeWeekOf(currentWeek)) return false
  const made = Date.parse(item.createdAt)
  return !Number.isFinite(made) || nflSeasonOf(made) === nflSeasonOf(now)
}

/** PPR / Half PPR / Standard from a scoring system's points per reception. */
export function scoringLabel(rules: unknown): CommunityScoring | null {
  if (!rules || typeof rules !== 'object') return null
  const rec = (rules as Record<string, unknown>).receptions
  if (typeof rec !== 'number') return null
  if (rec >= 1) return 'PPR'
  if (rec > 0) return 'Half PPR'
  return 'Standard'
}

/** An AI expert's default scoring (`style_profile.scoring_default`). */
export function personaScoring(value: string | null): CommunityScoring | null {
  if (value === 'PPR' || value === 'Standard') return value
  if (value === 'Half-PPR' || value === 'Half PPR') return 'Half PPR'
  return null
}

/** A list's position filter as a chip value (DEF and DST read as D/ST). */
export function posFilterValue(positionFilter: string | null): RankPosFilter | null {
  if (!positionFilter) return null
  const p = positionFilter.toUpperCase()
  if (p === 'DEF' || p === 'DST' || p === 'D/ST') return 'DST'
  if (p === 'QB' || p === 'RB' || p === 'WR' || p === 'TE' || p === 'K') return p
  return null
}

export function rankFilterOk(item: CommunityItem, rk: RankFilters): boolean {
  if (rk.type !== 'all' && item.rankType !== rk.type) return false
  if (rk.pos !== 'all' && posFilterValue(item.positionFilter) !== rk.pos) return false
  // The scoring the ranking counts as (`effectiveScoringFormat`) — never a
  // guess from its scoring system.
  if (rk.scoring !== 'all' && item.scoringFormat !== rk.scoring) return false
  return true
}

export interface Chip<V extends string> {
  value: V
  label: string
}

export const RANK_POS_CHIPS: readonly Chip<RankPosFilter>[] = [
  { value: 'all', label: 'All positions' },
  { value: 'QB', label: 'QB' },
  { value: 'RB', label: 'RB' },
  { value: 'WR', label: 'WR' },
  { value: 'TE', label: 'TE' },
  { value: 'K', label: 'K' },
  { value: 'DST', label: 'D/ST' },
]

/**
 * The Rankings chip rows (handoff §2.9: type × position × scoring). The
 * handoff's type row has both "Rest of season" and "Pre-draft"; the app has
 * one season ranking, so it gets one chip, called by the calendar —
 * "Rest of season" in season, "Pre-draft" in the offseason (gap list §3 #27;
 * `currentWeek` is the app's NFL week, 0 = offseason). Scoring is "Any
 * scoring" plus the four scorings a ranking can be saved for (Chris,
 * 2026-10-15, gap list #36).
 */
export function rankTypeChips(currentWeek: number): readonly Chip<RankTypeFilter>[] {
  return [
    { value: 'all', label: 'All types' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'season', label: seasonLabel(currentWeek) },
  ]
}
export const RANK_SCORING_CHIPS: readonly Chip<RankScoringFilter>[] = [
  { value: 'all', label: 'Any scoring' },
  ...SCORING_FORMATS.map((value) => ({ value, label: SCORING_FORMAT_LABEL[value] })),
]

/** Handoff `short(n)`: "DK Metcalf" → "D. Metcalf"; "A.J. Brown" and team
 *  defenses are left whole. */
export function shortName(name: string, position?: string | null): string {
  const pos = (position ?? '').toUpperCase()
  if (pos === 'DEF' || pos === 'DST' || / D\/ST$/.test(name)) return name
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2 || parts[0]!.includes('.')) return name.trim()
  return `${parts[0]![0]}. ${parts.slice(1).join(' ')}`
}

/** Player meta line "WR · PHI" (D/ST for team defenses). */
export function playerMeta(p: Pick<CommunityPlayer, 'position' | 'team'>): string {
  const pos = (p.position ?? '').toUpperCase()
  const label = pos === 'DEF' || pos === 'DST' ? 'D/ST' : pos
  return [label, p.team ?? 'FA'].filter(Boolean).join(' · ')
}

/** Ranking top line, single-spaced as the prototype renders it:
 *  "1. B. Robinson 2. J. Taylor 3. K. Williams". A list without numbers
 *  (its Ranked switch off — Chris 2026-10-16, one numbering rule) names the
 *  same players in its order with no numbers: "B. Robinson · J. Taylor ·
 *  K. Williams". */
export function topLine(heads: CommunityPlayer[], numbered = true): string {
  const top = heads.slice(0, 3)
  if (!numbered) return top.map((p) => shortName(p.full_name, p.position)).join(' · ')
  return top.map((p, i) => `${i + 1}. ${shortName(p.full_name, p.position)}`).join(' ')
}

/** "12k follows", "8.4k follows", "640 follows", "1 follow". */
export function formatFollows(n: number): string {
  const count = n < 1000 ? String(n) : `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${count} ${n === 1 ? 'follow' : 'follows'}`
}

/** "Updated 40m ago" / "Updated 3h ago" / "Updated 2d ago". */
export function updatedAgo(iso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'Updated just now'
  if (mins < 60) return `Updated ${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Updated ${hours}h ago`
  return `Updated ${Math.floor(hours / 24)}d ago`
}

/** When it was posted, short (the handoff's "@jordan · 25m"): "now", "25m",
 *  "3h", "2d", "3w". */
export function postedAgo(iso: string, now: number): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const mins = Math.max(0, Math.floor((now - t) / 60000))
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`
}

/** Small stable hash of a string (FNV-1a). */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Masonry cover height for a non-video cover: one of 150 / 180 / 205,
 *  stable per list (the prototype seeds it from the id). */
export function coverHeight(id: string): 150 | 180 | 205 {
  return ([150, 180, 205] as const)[hash(id) % 3]!
}

/** Author avatar colour — the shared mobile palette (`avatar-colors.ts`),
 *  stable per author. */
export function authorBgClass(seed: string): string {
  return authorAvatarClass(seed)
}

/** The avatar letters when the author has no photo: the app-wide two-letter
 *  rule ("chrisdaltas" → "CH"), not the prototype's one (`by[1]`) — Chris,
 *  2026-10-15, gap list #8. */
export function authorInitials(username: string): string {
  return handleInitials(username)
}

/** "1 video" / "3 videos". */
export function videoCount(n: number): string {
  return n === 1 ? '1 video' : `${n} videos`
}

/**
 * Topic pills. Automatic ones come from the pool itself, so each matches
 * something: the tags its lists carry most, interleaved (as in the handoff's
 * row) with the players most of its lists share. "Injuries" is always there,
 * in the handoff's trend-pill slot (Chris, 2026-10-15, gap list #37). A
 * selected topic stays in the row even if the pool moves on.
 */
export function deriveTopics(items: CommunityItem[], selected: CommunityTopic | null): CommunityTopic[] {
  const tagCount = new Map<string, { tag: { id: string; name: string }; n: number }>()
  const playerCount = new Map<string, { player: CommunityPlayer; n: number }>()
  for (const item of items) {
    for (const tag of item.tags) {
      const cur = tagCount.get(tag.id)
      tagCount.set(tag.id, { tag, n: (cur?.n ?? 0) + 1 })
    }
    for (const p of item.heads) {
      const cur = playerCount.get(p.id)
      playerCount.set(p.id, { player: p, n: (cur?.n ?? 0) + 1 })
    }
  }
  const tags: CommunityTopic[] = [...tagCount.values()]
    .sort((a, b) => b.n - a.n || a.tag.name.localeCompare(b.tag.name))
    .slice(0, 5)
    .map(({ tag }) => ({ kind: 'tag', id: tag.id, label: tag.name }))
  const players: CommunityTopic[] = [...playerCount.values()]
    .filter((p) => p.n >= 2)
    .sort((a, b) => b.n - a.n || a.player.full_name.localeCompare(b.player.full_name))
    .slice(0, 3)
    .map(({ player }) => ({ kind: 'player', id: player.id, label: player.full_name, player }))
  // Handoff order: two topics, a player, Injuries (its trend pill), a
  // player, then the remaining topics and a player. Injuries is added on top
  // of the automatic pills — it takes none of their places.
  const slots: (CommunityTopic | undefined)[] = [
    tags[0],
    tags[1],
    players[0],
    INJURIES_TOPIC,
    players[1],
    tags[2],
    tags[3],
    tags[4],
    players[2],
  ]
  const out = slots.filter((t): t is CommunityTopic => Boolean(t))
  if (selected && !out.some((t) => t.kind === selected.kind && t.id === selected.id)) out.unshift(selected)
  return out
}

/** How many tags For you's "Trending tags" shelf shows (desktop's card: 8). */
export const TRENDING_TAGS_SIZE = 8

/**
 * For you's "Trending tags" shelf (gap list §3 #26 — desktop's Trending tags
 * card, read the same way: `/api/tags?trending=true`, most used first). A tag
 * on the shelf filters Community by that topic, so only tags that a list or
 * ranking showing on Community carries are offered (`shown`: the For you
 * candidates, rankings left out while their switch is off) — a tap never
 * lands on "Nothing matches". Trending order kept.
 */
export function trendingTagTopics(
  trending: readonly { id: string; name: string }[],
  shown: readonly Pick<CommunityItem, 'tags'>[],
  size: number = TRENDING_TAGS_SIZE,
): CommunityTopic[] {
  const carried = new Set(shown.flatMap((i) => i.tags.map((t) => t.id)))
  return trending
    .filter((t) => carried.has(t.id))
    .slice(0, size)
    .map((t) => ({ kind: 'tag', id: t.id, label: t.name }))
}

/** The trimmed, lower-cased query — whitespace-only counts as no query. */
export function normQuery(query: string): string {
  return query.toLowerCase().trim()
}

function haystack(item: CommunityItem): string {
  return [
    item.title,
    `@${item.author.username}`,
    item.description ?? '',
    ...item.tags.map((t) => t.name),
    ...item.heads.map((p) => p.full_name),
  ]
    .join(' ')
    .toLowerCase()
}

export interface FilterInput {
  tab: CommunityTab
  topic: CommunityTopic | null
  /** Already normalised (`normQuery`). */
  q: string
  followingIds: ReadonlySet<string>
  /** Pool lists containing the topic's player (player topics), or a player
   *  on the injury report (Injuries) — the server's answer. */
  topicListIds?: ReadonlySet<string>
  /** Pool lists containing a player whose name matches the query. */
  queryListIds?: ReadonlySet<string>
}

/** Tab AND topic AND query — the prototype's `filt`. */
export function filterItems(items: CommunityItem[], f: FilterInput): CommunityItem[] {
  return items.filter((item) => {
    if (f.tab === 'following') {
      if (!item.author.profileId || !f.followingIds.has(item.author.profileId)) return false
    } else if (f.tab === 'rank') {
      if (item.kind !== 'rank') return false
    } else if (f.tab === 'list') {
      if (item.kind !== 'list') return false
    } else if (f.tab === 'poll') {
      // Start/sit questions have no backend yet — nothing in the pool is one.
      return false
    }
    if (f.topic) {
      if (f.topic.kind === 'tag') {
        if (!item.tags.some((t) => t.id === f.topic!.id)) return false
      } else if (f.topic.kind === 'injuries') {
        // Only the server knows every player's injury status (the pool
        // carries four players per list, and no status) — no guess.
        if (!f.topicListIds?.has(item.id)) return false
      } else {
        const inList = f.topicListIds?.has(item.id) ?? item.heads.some((p) => p.id === f.topic!.id)
        if (!inList) return false
      }
    }
    if (f.q && !haystack(item).includes(f.q) && !f.queryListIds?.has(item.id)) return false
    return true
  })
}

/** "Updated by people you follow": followed authors' rankings changed in
 *  the last week (an edit after creation), newest first — every one, as the
 *  handoff lists every followed ranking with an update. */
export function recentUpdates(items: CommunityItem[], followingIds: ReadonlySet<string>, now: number): CommunityItem[] {
  const WEEK = 7 * 24 * 60 * 60 * 1000
  return items
    .filter((i) => {
      if (i.kind !== 'rank' || !i.author.profileId || !followingIds.has(i.author.profileId)) return false
      const updated = new Date(i.updatedAt).getTime()
      const created = new Date(i.createdAt).getTime()
      return now - updated < WEEK && updated - created > 60 * 1000
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

/**
 * The empty-state copy (handoff §2.12). The Following tab's "Follow people…"
 * is only true when the viewer follows nobody; someone who follows people
 * whose lists aren't in the pool gets a line that says so (and, when the pool
 * is capped, that it only holds the most recent lists).
 */
export function emptyCopy(
  tab: CommunityTab,
  topic: CommunityTopic | null,
  q: string,
  rankFiltered: boolean,
  ctx: { followsAnyone: boolean; capped: boolean } = { followsAnyone: false, capped: false },
) {
  if (rankFiltered) return { message: 'Nothing matches these filters', action: 'Clear filters', kind: 'rank' as const }
  if (tab === 'following' && !q && !topic) {
    const message = !ctx.followsAnyone
      ? 'Follow people to see their lists, rankings and start/sit questions here'
      : ctx.capped
        ? 'Nothing recent from people you follow'
        : 'People you follow haven’t shared lists or rankings yet'
    return { message, action: 'Browse For you', kind: 'reset' as const }
  }
  if (!q && !topic) {
    // A tab with nothing in it yet (the prototype's seed data never empties
    // these; the product can).
    const message =
      tab === 'poll'
        ? 'No start or sit questions yet'
        : tab === 'rank'
          ? 'No rankings yet'
          : tab === 'list'
            ? 'No lists yet'
            : 'No lists or rankings yet'
    return tab === 'all'
      ? { message, action: 'Create a list', kind: 'create' as const }
      : { message, action: 'Browse For you', kind: 'reset' as const }
  }
  const message =
    topic?.kind === 'injuries'
      ? q
        ? 'Nothing matches your search'
        : 'No lists with a player on this week’s injury report'
      : topic
        ? `Nothing matches ${topic.label}`
        : 'Nothing matches your search'
  return { message, action: 'Clear filters', kind: 'reset' as const }
}

// =============================================================================
// For you order (Chris, 2026-10-15, gap list #35)
// =============================================================================

/** How many lists and rankings the For you "Latest" shelf shows (Chris,
 *  2026-10-16: a horizontal shelf; "See all" opens the Latest page). */
export const LATEST_SIZE = 10

/**
 * "Latest": STRICTLY newest-first — by when each list or ranking was posted
 * (`created_at`), nothing else. Ties (same instant) fall back to the id so
 * the order is stable. `ranksOn` false leaves rankings out (their switch is
 * off). An unreadable time sorts last.
 */
export function pickLatest(items: readonly CommunityItem[], ranksOn: boolean, size = LATEST_SIZE): CommunityItem[] {
  const at = (i: CommunityItem) => {
    const t = Date.parse(i.createdAt)
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY
  }
  return items
    .filter((i) => ranksOn || i.kind !== 'rank')
    .slice()
    .sort((a, b) => at(b) - at(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, size)
}

/**
 * The "popular + recent" knobs. In words:
 *  - a list itself, and every like it has ever had, count a little
 *    (1, and LIKE_FLOOR per like) — and that part halves every
 *    AGE_HALF_LIFE_DAYS days since the list was last updated, so older posts
 *    fade, even if they were popular;
 *  - a like given lately counts on top of that, fully the moment it's given,
 *    halving every LIKE_HALF_LIFE_DAYS days by ITS OWN age — so a list
 *    getting likes lately rises however long ago it was edited.
 * Likes older than LIKE_WINDOW_DAYS (or with no time on them) count only in
 * the fading part; the feed reads the timed ones from `list_likes.created_at`.
 */
export const POPULAR = {
  LIKE_FLOOR: 0.25,
  LIKE_HALF_LIFE_DAYS: 3,
  AGE_HALF_LIFE_DAYS: 7,
  LIKE_WINDOW_DAYS: 14,
} as const

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How much a list's recent likes weigh right now:
 * Σ over its likes of ½^(likeAgeDays / LIKE_HALF_LIFE_DAYS) — 1 for a like
 * given just now, ½ for one LIKE_HALF_LIFE_DAYS old.
 */
export function recentLikeHeat(recentLikes: readonly number[], now: number): number {
  let heat = 0
  for (const t of recentLikes) heat += 0.5 ** (Math.max(0, now - t) / DAY_MS / POPULAR.LIKE_HALF_LIFE_DAYS)
  return heat
}

/**
 * A list's "popular + recent" score:
 *
 *   score = (1 + LIKE_FLOOR × likes) × ½^(daysSinceUpdate / AGE_HALF_LIFE_DAYS)
 *         + (1 − LIKE_FLOOR) × Σ over recent likes of ½^(likeAgeDays / LIKE_HALF_LIFE_DAYS)
 *
 * So a brand-new list with no likes scores 1; a like given just now on a new
 * list adds 1 (0.25 + 0.75); the first part halves each week the list sits
 * untouched, while a recent like's 0.75 fades by the like's own age — a
 * month-old list liked today still rises. `likes` is the larger of the list's
 * like count and the recent likes read (a count that lags its rows never
 * undercounts them). No readable update time: the first part is 0 (nothing
 * says the list is recent), but its recent likes still count.
 */
export function popularScore(
  item: Pick<CommunityItem, 'likeCount' | 'recentLikes' | 'updatedAt'>,
  now: number,
): number {
  const { LIKE_FLOOR, AGE_HALF_LIFE_DAYS } = POPULAR
  const likes = Math.max(item.likeCount, item.recentLikes.length)
  const updated = Date.parse(item.updatedAt)
  const fading = Number.isFinite(updated)
    ? (1 + LIKE_FLOOR * likes) * 0.5 ** (Math.max(0, now - updated) / DAY_MS / AGE_HALF_LIFE_DAYS)
    : 0
  return fading + (1 - LIKE_FLOOR) * recentLikeHeat(item.recentLikes, now)
}

/**
 * The lists liked lately, hottest first (`recentLikeHeat`), leaving out
 * `exclude` (the pool) — at most `size` of them. Ties: the newest like, then
 * the id. The pool is the most recently UPDATED lists and a like doesn't
 * update a list, so without these a list edited weeks ago could never rise
 * on For you however many likes it gets.
 */
export function hottestLikedOutside(
  likes: ReadonlyMap<string, readonly number[]>,
  exclude: ReadonlySet<string>,
  now: number,
  size: number,
): string[] {
  const rows: { id: string; heat: number; newest: number }[] = []
  for (const [id, times] of likes) {
    if (exclude.has(id) || times.length === 0) continue
    rows.push({ id, heat: recentLikeHeat(times, now), newest: Math.max(...times) })
  }
  rows.sort((a, b) => b.heat - a.heat || b.newest - a.newest || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return rows.slice(0, size).map((r) => r.id)
}

/** Everything on For you other than "Latest": highest `popularScore` first;
 *  ties go to the more recently updated, then the id (a stable order). */
export function sortPopular(items: readonly CommunityItem[], now: number): CommunityItem[] {
  const scored = items.map((item) => ({ item, score: popularScore(item, now), updated: Date.parse(item.updatedAt) || 0 }))
  scored.sort(
    (a, b) =>
      b.score - a.score || b.updated - a.updated || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0),
  )
  return scored.map((s) => s.item)
}

// =============================================================================
// What the screen shows (the tab, topic, search, switches and For you order
// put together — kept pure so the wiring is tested, not just its parts)
// =============================================================================

export interface CommunityViewInput {
  /** The pool: the most recently updated public lists and rankings. */
  pool: readonly CommunityItem[]
  /** Lists liked lately that the pool left out — For you candidates only. */
  popularExtra: readonly CommunityItem[]
  /** The Latest read: the newest-posted lists and rankings. */
  latestRows: readonly CommunityItem[]
  filter: FilterInput
  rk: RankFilters
  /** Rankings' own switch (launch scope) — off, no ranking shows anywhere. */
  ranksOn: boolean
  /** The app's NFL week (0 = offseason) — what "Rankings this week" means. */
  currentWeek: number
  now: number
}

export interface CommunityView {
  /** Everything the tab, topic and search matched, in the order shown. */
  filtered: CommunityItem[]
  /** For you with no topic or search: the shelves layout. */
  shelves: boolean
  /** For you's "Latest" (shelves only), strictly newest-posted first. */
  latest: CommunityItem[]
  /** "Updated by people you follow". */
  updates: CommunityItem[]
  /** The matched rankings, before the Rankings chips. */
  ranksAll: CommunityItem[]
  ranks: CommunityItem[]
  lists: CommunityItem[]
  /** The shelves under Latest — Latest's own items left out. "Rankings this
   *  week" holds only season rankings and this week's boards
   *  (`rankingThisWeek`). */
  shelfRanks: CommunityItem[]
  shelfLists: CommunityItem[]
  /** Any list shows on the shelves page (Latest included). */
  anyList: boolean
  /** The Rankings chips excluded every ranking there is. */
  rankFilteredEmpty: boolean
  /** Nothing shows (the empty state). */
  empty: boolean
}

/**
 * The screen's sections. For you (Chris, 2026-10-15, gap list #35): "Latest"
 * strictly newest-first, and EVERYTHING else on it "popular + recent"
 * (`sortPopular`) — its shelves and its "Updated by people you follow" — each
 * list or ranking shown once (Latest's are left out of the rest). For you
 * also weighs the recently liked lists the update-ordered pool left out
 * (`popularExtra`); the other tabs keep the pool, most recently updated
 * first.
 */
export function communityView(input: CommunityViewInput): CommunityView {
  const { filter, rk, ranksOn, currentWeek, now } = input
  const { tab, topic, q, followingIds } = filter
  const forYou = tab === 'all'
  const candidates = forYou ? withoutRepeats([...input.pool, ...input.popularExtra]) : [...input.pool]
  const matched = filterItems(candidates, filter)
  const filtered = forYou ? sortPopular(matched, now) : matched
  const ranksAll = ranksOn ? filtered.filter((i) => i.kind === 'rank') : []
  const ranks = tab === 'rank' ? ranksAll.filter((i) => rankFilterOk(i, rk)) : ranksAll
  const lists = filtered.filter((i) => i.kind === 'list')
  const shelves = forYou && !topic && !q
  const latest = shelves ? pickLatest(input.latestRows, ranksOn) : []
  const latestIds = new Set(latest.map((i) => i.id))
  const notInLatest = (i: CommunityItem) => !latestIds.has(i.id)
  const updated =
    (tab === 'all' || tab === 'following' || tab === 'rank') && !topic && !q
      ? recentUpdates([...input.pool], followingIds, now).filter((i) => ranksOn || i.kind !== 'rank')
      : []
  const rankFilteredEmpty = tab === 'rank' && ranksAll.length > 0 && ranks.length === 0
  return {
    filtered,
    shelves,
    latest,
    updates: forYou ? sortPopular(updated.filter(notInLatest), now) : updated,
    ranksAll,
    ranks,
    lists,
    shelfRanks: ranks.filter((i) => notInLatest(i) && rankingThisWeek(i, currentWeek, now)),
    shelfLists: lists.filter(notInLatest),
    anyList: lists.length > 0 || latest.some((i) => i.kind === 'list'),
    rankFilteredEmpty,
    empty: ranks.length === 0 && lists.length === 0,
  }
}

function withoutRepeats(items: CommunityItem[]): CommunityItem[] {
  const seen = new Set<string>()
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
}

/**
 * A topic waits for the server's answer before anything shows: a player
 * topic (rather than first showing the cover-players guess), and Injuries
 * (it has no guess at all). Tags and no topic never wait.
 */
export function topicAwaitingServer(
  topic: CommunityTopic | null,
  loading: { player: boolean; injuries: boolean },
): boolean {
  if (topic?.kind === 'player') return loading.player
  if (topic?.kind === 'injuries') return loading.injuries
  return false
}

/** Community's own address — the parent the detail's Back falls back to. */
export const COMMUNITY_HREF = '/app/explore'

/** The Community detail URL — the screen it opens from (`from`: the feed,
 *  or the Latest page) stays mounted underneath. A mobile URL: the desktop
 *  Community page ignores `?list=`. */
export function communityDetailHref(id: string, from: string = COMMUNITY_HREF): string {
  return `${from}?list=${encodeURIComponent(id)}`
}
/** The Latest page (For you's "Latest" shelf → See all): everything the shelf
 *  draws from, simply newest first. */
export const LATEST_HREF = '/app/explore/latest'

/**
 * The detail's Back / Close (Chris, gap list #27: "Back always goes to where
 * you came from"). Opened from a card (a `history.pushState`), the screen
 * under it is the entry behind it — known for certain, so pop it. Reached any
 * other way (a link from another screen, a reload, a shared link), `goBack`
 * returns to the app screen behind it, else replaces the URL with the screen
 * the detail sits on (`parentHref`: Community, or the Latest page).
 */
export function closeCommunityDetail(
  openedFromFeed: boolean,
  nav: { popFeed: () => void; goBack: (parentHref: string) => void },
  parentHref: string = COMMUNITY_HREF,
): void {
  if (openedFromFeed) nav.popFeed()
  else nav.goBack(parentHref)
}

/**
 * The Latest page's rows: its pages in order (each newest posted first),
 * each list or ranking once — the pages are read by offset, so a post made
 * between two reads pushes a row already shown onto the next page — and
 * rankings left out while their switch is off.
 */
export function latestPageItems(
  pages: readonly { items: readonly CommunityItem[] }[],
  ranksOn: boolean,
): CommunityItem[] {
  return withoutRepeats(pages.flatMap((p) => p.items)).filter((i) => ranksOn || i.kind !== 'rank')
}
