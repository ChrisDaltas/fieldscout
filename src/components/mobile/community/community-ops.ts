import type { CommunityItem, CommunityPlayer } from '@/hooks/use-mobile-community-feed'
import { authorAvatarClass } from '@/components/mobile/ui/avatar-colors'

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
 * list screen (lr-lists §2.2, step 1 — the composer's "name your list").
 */
export const CREATE_RANKING_HREF = '/app/weekly-ranks?new=1'
export const CREATE_LIST_HREF = '/app/lists/new?from=back'

/** A topic pill: a tag the pool's lists carry, or a player they share. */
export type CommunityTopic =
  | { kind: 'tag'; id: string; label: string }
  | { kind: 'player'; id: string; label: string; player: CommunityPlayer }

export type RankType = 'weekly' | 'pre'
export type CommunityScoring = 'PPR' | 'Half PPR' | 'Standard'

export type RankTypeFilter = 'all' | RankType
export type RankPosFilter = 'all' | 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST'
/** The handoff's scoring row is exactly PPR / Standard; a Half PPR ranking
 *  (an AI expert's default) shows under "Any scoring" only. */
export type RankScoringFilter = 'all' | 'PPR' | 'Standard'
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
const WEEKLY_BOARD_SLUG = /^week-\d+-big-board(?:-|$)/

/**
 * Rankings vs lists. In the handoff a ranking is a ranking product — a week,
 * rest of season or the draft — and a list is a person's own grouping
 * (which may itself be ordered). The app's equivalents: the pre-draft big
 * board, the weekly boards and the AI experts' boards are rankings; every
 * other list is a list. (`ranking_mode` can't tell them apart — nearly every
 * list is "ranked" by default.)
 */
export function classifyCommunityList(list: {
  is_big_board: boolean | null
  slug: string
  ai_persona_id: string | null
}): { kind: 'rank' | 'list'; rankType: RankType | null } {
  if (list.is_big_board) return { kind: 'rank', rankType: 'pre' }
  if (WEEKLY_BOARD_SLUG.test(list.slug)) return { kind: 'rank', rankType: 'weekly' }
  if (list.ai_persona_id) return { kind: 'rank', rankType: null }
  return { kind: 'list', rankType: null }
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
  if (rk.scoring !== 'all' && item.scoring !== rk.scoring) return false
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
 * The Rankings chip rows (handoff §2.9: type × position × scoring), fixed as
 * the handoff draws them. Type leaves out "Rest of season": nothing marks a
 * list as one (an m-community gap).
 */
export const RANK_TYPE_CHIPS: readonly Chip<RankTypeFilter>[] = [
  { value: 'all', label: 'All types' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'pre', label: 'Pre-draft' },
]
export const RANK_SCORING_CHIPS: readonly Chip<RankScoringFilter>[] = [
  { value: 'all', label: 'Any scoring' },
  { value: 'PPR', label: 'PPR' },
  { value: 'Standard', label: 'Standard' },
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
 *  "1. B. Robinson 2. J. Taylor 3. K. Williams". */
export function topLine(heads: CommunityPlayer[]): string {
  return heads
    .slice(0, 3)
    .map((p, i) => `${i + 1}. ${shortName(p.full_name, p.position)}`)
    .join(' ')
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

/** The avatar letter: the handle's first character (prototype `by[1]`). */
export function authorInitial(username: string): string {
  return (username.replace(/^@/, '')[0] ?? '?').toUpperCase()
}

/** "1 video" / "3 videos". */
export function videoCount(n: number): string {
  return n === 1 ? '1 video' : `${n} videos`
}

/**
 * Topic pills from the pool itself, so every pill matches something: the
 * tags its lists carry most, interleaved (as in the handoff's row) with the
 * players most of its lists share. A selected topic stays in the row even
 * if the pool moves on.
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
  // Handoff order: two topics, a player, a topic, a player, two topics, a player.
  const slots: (CommunityTopic | undefined)[] = [tags[0], tags[1], players[0], tags[2], players[1], tags[3], tags[4], players[2]]
  const out = slots.filter((t): t is CommunityTopic => Boolean(t))
  if (selected && !out.some((t) => t.kind === selected.kind && t.id === selected.id)) out.unshift(selected)
  return out
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
  /** Pool lists containing the topic's player (player topics). */
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
  return { message: topic ? `Nothing matches ${topic.label}` : 'Nothing matches your search', action: 'Clear filters', kind: 'reset' as const }
}
