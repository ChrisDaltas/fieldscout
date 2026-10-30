'use client'

import { useInfiniteQuery } from '@tanstack/react-query'

import { WEEKLY_BOARD_PATTERN, listsOnlyQuery, type OlderSpec } from '@/components/mobile/community/community-ops'
import { INJURY_STATUSES } from '@/components/mobile/home/home-ops'
import {
  POOL_SELECT,
  likeEscape,
  likePattern,
  mapCommunityRows,
  mobileCommunityKeys,
  publicListsQuery,
  type CommunityItem,
  type CommunityRow,
  type PoolCursor,
} from '@/hooks/use-mobile-community-feed'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * FieldScout Mobile — Community past the pool (gap list §3 #30: "search and
 * filters cover every public list, not just the newest 100"). The pool holds
 * the most recently updated public lists, and the screen filters it on the
 * client. Once it's full, a filtered view also reads, from the server, the
 * public lists older than the pool's last row that match the same filters
 * (`OlderSpec`, built by `olderSpecs`):
 *
 *  - the tab: a ranking or a list — the same split as `classifyCommunityList`
 *    (the big board, a weekly board by its slug, an AI expert's board are
 *    rankings; the rest are lists) — and on Following, the people followed
 *    (their own lists; an AI expert's board is no one's to follow);
 *  - the topic: a tag on the list, a player in it, or a player in it on the
 *    injury report (Home's statuses, on an NFL team);
 *  - the search, as the client reads it: the title, the author's @handle (an
 *    AI expert's board, the expert's), the description, a tag, or any player
 *    in the list — not only the four the card shows;
 *  - the Rankings tab's type and position chips (the scoring chip stays on
 *    the client — see `OlderSpec`).
 *
 * Read OLDER_PAGE_SIZE rows at a time in the pool's order (last update, then
 * the id, newest first), each page starting after the row the one before
 * ended on — never an offset, so a list edited between two reads (it jumps
 * to the pool's end of the order) can't make a later page skip a row. A
 * short page is the end; a failed read throws, never an empty page.
 *
 * The filters that look inside a list (topic, search) are embeds of their
 * own beside the card's (`sq_*`), asked to hold at most one row: they decide
 * which lists come back, never what the card draws. Rows are mapped exactly
 * as the pool's (`mapCommunityRows`).
 */

export const OLDER_PAGE_SIZE = 20

/** No likes are read here: older rows follow the pool in update order. */
const NO_LIKES: ReadonlyMap<string, number[]> = new Map()

export interface OlderPage {
  items: CommunityItem[]
  /** Where the next page starts; null when this one was the last. */
  next: PoolCursor | null
}

/** A value inside an `or=(…)` filter: quoted, so commas, dots and brackets
 *  a person typed stay theirs (PostgREST unescapes `\` inside the quotes). */
function quoted(value: string): string {
  return `"${value.replace(/[\\"]/g, (m) => `\\${m}`)}"`
}

/** The embeds the filters need on top of the card's (none for a plain tab). */
export function olderSelect(spec: OlderSpec): string {
  const extra: string[] = []
  if (spec.topic?.kind === 'tag') extra.push('sq_topic:list_tags!inner(tag_id)')
  else if (spec.topic?.kind === 'player') extra.push('sq_topic:list_players!inner(player_id)')
  else if (spec.topic?.kind === 'injuries') extra.push('sq_topic:list_players!inner(player:players!inner(status, team))')
  if (spec.q) {
    extra.push(
      'sq_owner:profiles!lists_owner_id_fkey(username)',
      'sq_persona:ai_personas!lists_ai_persona_id_fkey(username)',
      'sq_tags:list_tags(tag:tags!inner(name))',
      'sq_players:list_players(player:players!inner(full_name))',
    )
  }
  return extra.length > 0 ? `${POOL_SELECT},\n  ${extra.join(',\n  ')}` : POOL_SELECT
}

/**
 * The search, as the client's haystack reads it (`filterItems`): the title,
 * the description, a tag or a player (the text anywhere in it), or the
 * author's handle — which the client reads as "@handle", so a search that
 * starts with "@" matches handles that start with the rest.
 */
export function searchPatterns(q: string): { text: string; handle: string } {
  const text = likePattern(q)
  return { text, handle: q.startsWith('@') ? `${likeEscape(q.slice(1))}%` : text }
}

type Builder = ReturnType<typeof publicListsQuery>

/** The filter methods `pastPoolCursor` uses — any `from('lists')` read. */
export interface CursorQuery<Q> {
  is(column: 'updated_at', value: null): Q
  lt(column: 'id', value: string): Q
  or(filters: string): Q
}

/**
 * The rows after `after` in the pool's order (last update, then the id, both
 * newest first; no update time sorts last) — where a read past the pool
 * starts. The caller orders the read the same way. Also the desktop feed's
 * Popular, past its candidates (`use-explore-feed.ts`).
 */
export function pastPoolCursor<Q extends CursorQuery<Q>>(query: Q, after: PoolCursor): Q {
  return after.updatedAt === null
    ? query.is('updated_at', null).lt('id', after.id)
    : query.or(
        `updated_at.lt.${quoted(after.updatedAt)},and(updated_at.eq.${quoted(after.updatedAt)},id.lt.${after.id}),updated_at.is.null`,
      )
}

/** `query` narrowed to the spec's matches past `after`, one page of them. */
export function applyOlder(query: Builder, spec: OlderSpec, after: PoolCursor): Builder {
  let b = query

  // Past the cursor, in the pool's order (no update time sorts last).
  b = pastPoolCursor(b, after)

  // A ranking or a list (`classifyCommunityList`), and the type chip.
  const weekly = quoted(WEEKLY_BOARD_PATTERN)
  if (spec.kind === 'list') {
    b = listsOnlyQuery(b)
  } else if (spec.rankType === 'weekly') {
    b = b.not('is_big_board', 'is', true).filter('slug', 'match', WEEKLY_BOARD_PATTERN)
  } else if (spec.rankType === 'season') {
    b = b.or(`is_big_board.is.true,and(slug.not.match.${weekly},ai_persona_id.not.is.null)`)
  } else {
    b = b.or(`is_big_board.is.true,slug.match.${weekly},ai_persona_id.not.is.null`)
  }

  // The position chip (`posFilterValue`: DEF and D/ST read as D/ST).
  if (spec.kind === 'rank' && spec.rankPos !== 'all') {
    b =
      spec.rankPos === 'DST'
        ? b.or(`position_filter.ilike.DEF,position_filter.ilike.DST,position_filter.ilike.${quoted('D/ST')}`)
        : b.ilike('position_filter', spec.rankPos)
  }

  // Following: the people followed, their own lists.
  if (spec.following) b = b.in('owner_id', spec.following).is('ai_persona_id', null)

  // The topic.
  if (spec.topic) {
    if (spec.topic.kind === 'tag') b = b.eq('sq_topic.tag_id', spec.topic.id)
    else if (spec.topic.kind === 'player') b = b.eq('sq_topic.player_id', spec.topic.id)
    else b = b.in('sq_topic.player.status', [...INJURY_STATUSES]).not('sq_topic.player.team', 'is', null)
    b = b.limit(1, { referencedTable: 'sq_topic' })
  }

  // The search: any of the places the client looks.
  if (spec.q) {
    const { text, handle } = searchPatterns(spec.q)
    b = b
      .ilike('sq_owner.username', handle)
      .ilike('sq_persona.username', handle)
      .ilike('sq_tags.tag.name', text)
      .ilike('sq_players.player.full_name', text)
      .limit(1, { referencedTable: 'sq_tags' })
      .limit(1, { referencedTable: 'sq_players' })
      .or(
        [
          `title.ilike.${quoted(text)}`,
          `description.ilike.${quoted(text)}`,
          // A person's own list: their handle. An AI expert's board: the
          // expert's (the handle the card shows), not its owner's.
          'and(ai_persona_id.is.null,sq_owner.not.is.null)',
          'sq_persona.not.is.null',
          'sq_tags.not.is.null',
          'sq_players.not.is.null',
        ].join(','),
      )
  }

  return b
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .limit(OLDER_PAGE_SIZE)
}

/** One page of a view's lists past the pool, starting after `after`. */
export async function readOlderPage(spec: OlderSpec, after: PoolCursor): Promise<OlderPage> {
  // Following nobody: nothing of theirs to read.
  if (spec.following?.length === 0) return { items: [], next: null }
  const supabase = createBrowserClient()
  const { data, error } = await applyOlder(publicListsQuery(supabase, olderSelect(spec)), spec, after)
  if (error) throw error
  const rows = (data ?? []) as unknown as CommunityRow[]
  const last = rows[rows.length - 1]
  return {
    items: mapCommunityRows(rows, NO_LIKES),
    next: rows.length < OLDER_PAGE_SIZE || !last ? null : { updatedAt: last.updated_at, id: last.id },
  }
}

/**
 * A filtered view's lists past the pool, a page at a time (`fetchNextPage`
 * reads the next). Off with no spec (the view needs none), no cursor (the
 * pool holds every public list), following no one, or `ready` false (the
 * search is still being typed — it waits under its own key, so it shows as
 * loading rather than as the last search's rows).
 */
export function useCommunityOlder(spec: OlderSpec | null, from: PoolCursor | null, ready = true) {
  return useInfiniteQuery({
    queryKey: mobileCommunityKeys.older(spec, from),
    enabled: ready && spec !== null && from !== null && spec.following?.length !== 0,
    initialPageParam: from ?? { updatedAt: null, id: '' },
    queryFn: ({ pageParam }) => readOlderPage(spec!, pageParam),
    getNextPageParam: (last: OlderPage) => last.next ?? undefined,
    staleTime: 60 * 1000,
  })
}
