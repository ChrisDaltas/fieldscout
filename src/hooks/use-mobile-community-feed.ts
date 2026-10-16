'use client'

import { useQuery } from '@tanstack/react-query'

import {
  classifyCommunityList,
  effectiveScoringFormat,
  hottestLikedOutside,
  POPULAR,
  SCORING_FORMAT_LABEL,
  scoringFormatOf,
  type CommunityScoring,
  type RankType,
  type ScoringFormat,
} from '@/components/mobile/community/community-ops'
import { INJURY_STATUSES } from '@/components/mobile/home/home-ops'
import { createBrowserClient } from '@/lib/supabase/client'
import { firstEmbed } from '@/utils/supabase-embed'

/**
 * FieldScout Mobile — Community (handoff m-community). One pool of the most
 * recently active PUBLIC lists — the same rows, RLS surface and persona
 * handling as the desktop feed (`use-explore-feed.ts`) — carrying what the
 * mobile cards draw: the first four players (collage, lead tile, top-three
 * line), video links (badge, YouTube cover), tags (topic pills), the
 * author's follower count, the list's position group and scoring.
 *
 * Which of them are "Rankings" and which "Lists" is `classifyCommunityList`
 * (big boards, weekly boards and AI experts' boards are rankings; people's
 * own lists are lists, ranked or not). Lists with no players aren't in the
 * pool: every account starts with an empty public big board, and an empty
 * list has nothing to explore.
 *
 * Tabs, topics, the inline search and the Rankings chips filter this pool on
 * the client, as the prototype does. Questions the pool can't answer on its
 * own go to the server: which pool lists contain a given player, which
 * contain a player whose name matches the search, and which contain a player
 * on the injury report (only four players per list ride along with the pool).
 *
 * The pool is capped. When the read comes back full (`capped`), older public
 * lists are not in it, and the screen says so wherever it filters the pool —
 * a full read is never presented as the whole table.
 *
 * For you (Chris, 2026-10-15, gap list #35) also needs, beside the pool:
 *  - `latest`: the newest POSTED lists and rankings, read by `created_at` on
 *    their own — the pool is ordered by last update, so a capped pool could
 *    miss a new list that nobody has touched since;
 *  - each list's likes: its like count, plus the times of its recent likes
 *    (`list_likes.created_at`), for the "popular + recent" order
 *    (`popularScore` in community-ops);
 *  - `popularExtra`: the lists liked lately that the pool left out. A like
 *    doesn't touch `lists.updated_at` (the like trigger only bumps
 *    `like_count`), so a list edited weeks ago could sit outside the pool
 *    however many likes it gets today — and never rise on For you.
 *
 * The rows are read with `select('*')` plus the embeds, never naming
 * `cover_color` (migration 188) or `scoring_format` (migration 190): main
 * reaches production before Chris pushes a migration, and a read naming a
 * missing column fails outright (HTTP 400). Until 190 is pushed the rows
 * simply have no `scoring_format` and every ranking reads as "no saved
 * scoring" — which counts as Half PPR (Chris, 2026-10-16), or on an AI
 * expert's board as its persona's usual scoring: the value 190 then saves
 * (`effectiveScoringFormat`).
 *
 * The Latest page (For you's "Latest" → See all) reads the same rows, newest
 * posted first, a page at a time — `use-community-latest.ts`.
 */

/** How many lists the feed holds. A cap on the pool, not a page size. */
export const COMMUNITY_POOL_SIZE = 100
/** How many newest-posted rows the Latest read takes — more than the shelf
 *  shows (LATEST_SIZE), so it stays full while rankings are switched off. */
export const LATEST_READ_SIZE = 20
/** At most this many recently liked lists outside the pool join For you —
 *  the hottest ones (`hottestLikedOutside`). A bound on a ranking's
 *  candidates, not a page: the coolest of them are the ones left out. */
export const LIKED_EXTRA_SIZE = 50
/** `list_likes` is read in pages of PostgREST's row cap… */
const LIKES_PAGE = 1000
/** …up to this many pages. Past it, only the oldest likes in the window are
 *  left out (newest are read first) — the least-weighted ones, which still
 *  count in the fading part through the list's like count. */
const LIKES_MAX_PAGES = 10

export interface CommunityPool {
  items: CommunityItem[]
  /** The newest-posted public lists and rankings, newest first (the Latest
   *  read, not the pool — see the file comment). */
  latest: CommunityItem[]
  /** Public lists liked lately that aren't in the pool — For you weighs them
   *  with the pool; the other tabs don't (see the file comment). */
  popularExtra: CommunityItem[]
  /** The read hit COMMUNITY_POOL_SIZE: there may be older public lists. */
  capped: boolean
}

export interface CommunityPlayer {
  id: string
  full_name: string
  position: string | null
  team: string | null
  headshot_url: string | null
}

export interface CommunityVideo {
  url: string
  /** YouTube's real title, or null when it would not give one — never a placeholder. */
  title: string | null
  duration: string | null
  source: string | null
}

export interface CommunityAuthor {
  /** Profile id — null for an AI persona's board (not a followable person). */
  profileId: string | null
  /** The handle without the "@". */
  username: string
  avatarUrl: string | null
  /** Followers of a person; null for a persona (no follow graph). */
  followers: number | null
  isPersona: boolean
}

export interface CommunityItem {
  id: string
  title: string
  slug: string
  description: string | null
  kind: 'rank' | 'list'
  /** Weekly board / pre-draft big board; null for other rankings. */
  rankType: RankType | null
  positionFilter: string | null
  /** The owner's chosen cover colour key (migration 188), else null — the
   *  cover then follows the position colour. */
  coverColor?: string | null
  /** `scoringFormat`'s label. */
  scoring: CommunityScoring
  /** The scoring the ranking counts as (`effectiveScoringFormat`) — what the
   *  Rankings scoring chips filter on: the one saved with it
   *  (`lists.scoring_format`, migration 190); else, none saved (published
   *  before 190, or 190 not pushed), an AI expert's usual scoring or Half
   *  PPR — the value 190 saves for it. */
  scoringFormat: ScoringFormat
  playerCount: number
  /** Likes, all time (`lists.like_count`). */
  likeCount: number
  /** When its likes of the last POPULAR.LIKE_WINDOW_DAYS days were given
   *  (epoch ms, newest first). Read for every item: [] means none. */
  recentLikes: number[]
  createdAt: string
  updatedAt: string
  thumbnailUrl: string | null
  /** The list owner's username — the public URL lives under it, persona
   *  boards included. */
  ownerUsername: string
  author: CommunityAuthor
  /** First four players in list order. */
  heads: CommunityPlayer[]
  tags: { id: string; name: string; slug: string }[]
  videos: CommunityVideo[]
}

/** A `lists` row as POOL_SELECT reads it (cast — the select is a plain
 *  string). */
export interface CommunityRow {
  id: string
  title: string
  /** Present only once migration 188 is pushed (`*` reads what exists). */
  cover_color?: string | null
  /** Present only once migration 190 is pushed. */
  scoring_format?: string | null
  slug: string
  description: string | null
  is_big_board: boolean | null
  position_filter: string | null
  player_count: number | null
  like_count: number | null
  created_at: string | null
  updated_at: string | null
  thumbnail_url: string | null
  ai_persona_id: string | null
  owner: OwnerRow | OwnerRow[] | null
  persona: PersonaRow | PersonaRow[] | null
  tag_links: { tag: TagRow | TagRow[] | null }[] | null
  links: LinkRow[] | null
  heads: { position: number; player: CommunityPlayer | CommunityPlayer[] | null }[] | null
}
interface OwnerRow {
  id: string
  username: string
  avatar_url: string | null
  follower_count: number | null
}
interface PersonaRow {
  username: string
  avatar_url: string | null
  /** `style_profile.scoring_default` ("PPR", "Half-PPR", "Standard"…). */
  scoring: string | null
}
interface TagRow {
  id: string
  name: string
  slug: string
}
interface LinkRow {
  kind: string
  url: string
  title: string | null
  duration_label: string | null
  source_label: string | null
  position: number
}

/** `*` — every column that exists, so columns added by migrations not yet
 *  pushed are never named — plus the embeds the cards draw. Typed `string`
 *  so the client doesn't parse it at the type level (the rows are cast). */
export const POOL_SELECT: string = `*,
  owner:profiles!lists_owner_id_fkey(id, username, avatar_url, follower_count),
  persona:ai_personas!lists_ai_persona_id_fkey(username, avatar_url, scoring:style_profile->>scoring_default),
  tag_links:list_tags(tag:tags(id, name, slug)),
  links:list_links(kind, url, title, duration_label, source_label, position),
  heads:list_players(position, player:players(id, full_name, position, team, headshot_url))`

/** Rows → items. `recentLikes`: the likes read for these rows
 *  (`readRecentLikes`) — a list absent from it had no recent likes. */
export function mapCommunityRows(rows: CommunityRow[], recentLikes: ReadonlyMap<string, number[]>): CommunityItem[] {
  return rows.flatMap((row) => {
    const owner = firstEmbed(row.owner)
    if (!owner) return []
    const persona = row.ai_persona_id ? firstEmbed(row.persona) : null
    const heads = (row.heads ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .flatMap((h) => {
        const p = firstEmbed(h.player)
        return p ? [p] : []
      })
      .slice(0, 4)
    const videos = (row.links ?? [])
      .filter((l) => l.kind === 'video')
      .sort((a, b) => a.position - b.position)
      .map((l) => ({ url: l.url, title: l.title, duration: l.duration_label, source: l.source_label }))
    const { kind, rankType } = classifyCommunityList(row)
    const scoringFormat = effectiveScoringFormat(scoringFormatOf(row), persona?.scoring)
    return [
      {
        id: row.id,
        title: row.title,
        slug: row.slug,
        description: row.description,
        kind,
        rankType,
        positionFilter: row.position_filter,
        coverColor: row.cover_color ?? null,
        scoring: SCORING_FORMAT_LABEL[scoringFormat],
        scoringFormat,
        playerCount: row.player_count ?? 0,
        likeCount: row.like_count ?? 0,
        recentLikes: recentLikes.get(row.id) ?? [],
        createdAt: row.created_at ?? '',
        updatedAt: row.updated_at ?? row.created_at ?? '',
        thumbnailUrl: row.thumbnail_url,
        ownerUsername: owner.username,
        author: persona
          ? { profileId: null, username: persona.username, avatarUrl: persona.avatar_url, followers: null, isPersona: true }
          : {
              profileId: owner.id,
              username: owner.username,
              avatarUrl: owner.avatar_url,
              followers: owner.follower_count ?? 0,
              isPersona: false,
            },
        heads,
        tags: (row.tag_links ?? []).flatMap((t) => {
          const tag = firstEmbed(t.tag)
          return tag ? [tag] : []
        }),
        videos,
      } satisfies CommunityItem,
    ]
  })
}

export const mobileCommunityKeys = {
  all: ['mobile-community'] as const,
  pool: () => ['mobile-community', 'pool'] as const,
  /** The Latest page's pages (`use-community-latest.ts`). */
  latestPages: () => ['mobile-community', 'latest-pages'] as const,
  playerMatch: (poolIds: string[], playerId: string | null, query: string) =>
    ['mobile-community', 'player-match', playerId ?? '', query, poolIds] as const,
  injuryMatch: (poolIds: string[]) => ['mobile-community', 'injury-match', poolIds] as const,
}

type Supabase = ReturnType<typeof createBrowserClient>

/**
 * The lists Community shows: public, not deleted, with players — and the
 * per-list caps on the embeds (PostgREST applies these per parent). Callers
 * add the order and the size.
 */
export function publicListsQuery(supabase: Supabase) {
  return supabase
    .from('lists')
    .select(POOL_SELECT)
    .eq('is_private', false)
    .is('deleted_at', null)
    .gt('player_count', 0)
    .order('position', { referencedTable: 'heads', ascending: true })
    .limit(4, { referencedTable: 'heads' })
}

/**
 * Every like given in the last POPULAR.LIKE_WINDOW_DAYS days, by list:
 * list id → like times (epoch ms), newest first. Not narrowed to the lists
 * already read — it is also how For you finds the lists liked lately that the
 * pool left out (`popularExtra`). `list_likes` is public to read (its rows for
 * lists that aren't public are never shown: only public lists are read).
 * Paged past PostgREST's row cap, so a full page is never taken for all of
 * them (see LIKES_MAX_PAGES for the one bound).
 */
export async function readRecentLikes(supabase: Supabase, now: number): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>()
  const since = new Date(now - POPULAR.LIKE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  for (let page = 0; page < LIKES_MAX_PAGES; page++) {
    const from = page * LIKES_PAGE
    const { data, error } = await supabase
      .from('list_likes')
      .select('list_id, user_id, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      // (list_id, user_id) is unique: a total order, so pages don't overlap.
      .order('list_id', { ascending: true })
      .order('user_id', { ascending: true })
      .range(from, from + LIKES_PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as { list_id: string; created_at: string | null }[]
    for (const r of rows) {
      const t = r.created_at ? Date.parse(r.created_at) : Number.NaN
      if (!Number.isFinite(t)) continue
      const times = out.get(r.list_id)
      if (times) times.push(t)
      else out.set(r.list_id, [t])
    }
    if (rows.length < LIKES_PAGE) break
  }
  return out
}

/** The Community read: the pool, the Latest rows, the recently liked lists
 *  the pool left out, and their likes. */
export async function readCommunityFeed(now: number = Date.now()): Promise<CommunityPool> {
  const supabase = createBrowserClient()
  const publicLists = () => publicListsQuery(supabase)
  const [pool, latest, likes] = await Promise.all([
    publicLists().order('updated_at', { ascending: false, nullsFirst: false }).limit(COMMUNITY_POOL_SIZE),
    publicLists().order('created_at', { ascending: false, nullsFirst: false }).limit(LATEST_READ_SIZE),
    readRecentLikes(supabase, now),
  ])
  if (pool.error) throw pool.error
  if (latest.error) throw latest.error
  const poolRows = (pool.data ?? []) as unknown as CommunityRow[]
  const latestRows = (latest.data ?? []) as unknown as CommunityRow[]

  // The hottest lists liked lately that the pool doesn't hold. Rows the
  // Latest read already holds are reused; the rest are read by id, through
  // the same public-lists filter (a like on a private, deleted or empty list
  // simply doesn't come back).
  const extraIds = hottestLikedOutside(likes, new Set(poolRows.map((r) => r.id)), now, LIKED_EXTRA_SIZE)
  const latestById = new Map(latestRows.map((r) => [r.id, r]))
  const toRead = extraIds.filter((id) => !latestById.has(id))
  let readRows: CommunityRow[] = []
  if (toRead.length > 0) {
    const extra = await publicLists().in('id', toRead)
    if (extra.error) throw extra.error
    readRows = (extra.data ?? []) as unknown as CommunityRow[]
  }
  const extraRows = [...extraIds.flatMap((id) => latestById.get(id) ?? []), ...readRows]

  return {
    items: mapCommunityRows(poolRows, likes),
    latest: mapCommunityRows(latestRows, likes),
    popularExtra: mapCommunityRows(extraRows, likes),
    capped: poolRows.length >= COMMUNITY_POOL_SIZE,
  }
}

/** The Community pool: most recently active public lists and rankings. */
export function useMobileCommunityFeed() {
  return useQuery({
    queryKey: mobileCommunityKeys.pool(),
    staleTime: 60 * 1000,
    queryFn: () => readCommunityFeed(),
  })
}

/**
 * Which pool lists include a player on this week's injury report — the
 * "Injuries" topic (Chris, 2026-10-15, gap list #37). The injury report is
 * Home's "Injury news" definition (`useMobileHomeInjuries`): the synced
 * injury status (`players.status`, Sleeper) is one of INJURY_STATUSES
 * (Questionable, Doubtful, Out, IR, PUP) and the player is on an NFL team.
 *
 * Asked from the list side, like the name search below: at most one row per
 * pool list, so PostgREST's row cap can't silently drop lists.
 */
export async function readInjuryMatches(poolIds: string[]): Promise<Set<string>> {
  const supabase = createBrowserClient()
  const { data, error } = await supabase
    .from('lists')
    .select('id, lp:list_players!inner(player:players!inner(status, team))')
    .in('id', poolIds)
    .in('lp.player.status', [...INJURY_STATUSES])
    .not('lp.player.team', 'is', null)
    .limit(1, { referencedTable: 'lp' })
  if (error) throw error
  return new Set(((data ?? []) as unknown as { id: string }[]).map((r) => r.id))
}

/** `readInjuryMatches` while the Injuries topic is on. */
export function useCommunityInjuryMatches(poolIds: string[], enabled: boolean) {
  return useQuery({
    queryKey: mobileCommunityKeys.injuryMatch(poolIds),
    enabled: enabled && poolIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: () => readInjuryMatches(poolIds),
  })
}

/** Escape LIKE wildcards so a typed "%" or "_" matches itself. */
function likePattern(q: string): string {
  return `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`
}

/**
 * Which pool lists contain a player — by id (a player topic pill) or by a
 * name fragment (the inline search). Undefined while there is nothing to ask.
 */
export function useCommunityPlayerMatches(
  poolIds: string[],
  opts: { playerId?: string | null; query?: string },
) {
  const playerId = opts.playerId ?? null
  const query = (opts.query ?? '').trim()
  const enabled = poolIds.length > 0 && (playerId !== null || query.length >= 2)
  return useQuery({
    queryKey: mobileCommunityKeys.playerMatch(poolIds, playerId, playerId ? '' : query),
    enabled,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<Set<string>> => {
      const supabase = createBrowserClient()
      if (playerId) {
        const { data, error } = await supabase
          .from('list_players')
          .select('list_id')
          .in('list_id', poolIds)
          .eq('player_id', playerId)
        if (error) throw error
        return new Set((data ?? []).map((r) => r.list_id as string))
      }
      // Asked from the list side so the answer is at most one row per pool
      // list: the inner joins keep only lists with a matching player, and the
      // embed is capped at one row. (Asking list_players directly could run
      // past PostgREST's 1000-row cap on a short fragment and silently drop
      // lists.) Each player appears once per list, so the id lookup above is
      // bounded by the pool too.
      const { data, error } = await supabase
        .from('lists')
        .select('id, lp:list_players!inner(player:players!inner(full_name))')
        .in('id', poolIds)
        .ilike('lp.player.full_name', likePattern(query))
        .limit(1, { referencedTable: 'lp' })
      if (error) throw error
      return new Set(((data ?? []) as unknown as { id: string }[]).map((r) => r.id))
    },
  })
}
