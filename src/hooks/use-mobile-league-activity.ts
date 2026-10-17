'use client'

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'

import { sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { ActivityFeed, ActivityItem, ActivityTopic } from '@/lib/leagues/api/activity-service'

import { invalidateCommishLog } from './use-commish-log'
import { activitySearchParams, leagueActivityKeys } from './use-league-activity'
import { useLeagueChannel, type LeagueChannelHandlers } from './use-league-channel'
import { LEAGUE_CHANNEL_EVENTS, activityEventInvalidates } from './use-league-channel-ops'

/**
 * The mobile League › Activity / Transactions feed (FieldScout Mobile
 * handoff, m-league §2.4–2.6): the league activity read
 * (`GET /api/leagues/[id]/activity`) over one or more STREAMS, merged in the
 * feed's own order and paged.
 *
 * Why streams: the Transaction filters pick any number of teams, and the
 * read filters one team at a time (`team_id`) — and only by the team that
 * STARTED the move (`initiator_team_id`). Each selected team is its own
 * stream; a trade the team RECEIVED and a commissioner's move (no starting
 * team) come from a league-wide stream kept to the moves that name one of
 * the selected teams (`parties`, matched on the stored payload's team ids —
 * `involvedTeamIds`). A page reads the next slice of every stream that has
 * more and shows only what is certainly in order — every item at or newer
 * than the newest slice boundary among the streams that still have more (an
 * item older than that could have an unread neighbour). The rest is read
 * again from its stream's cursor on the next page, so nothing is skipped or
 * shown twice (an item two streams both read is shown once). With one
 * stream this is plain paging.
 *
 * Live like the desktop feed: one `league:<id>` room join, a feed event or a
 * (re)join re-reads it (and the commissioner log).
 */

export interface MobileActivityStream {
  teamId?: string
  type?: readonly string[]
  topic?: ActivityTopic
  /** Kept to the items naming one of these teams (read league-wide — the
   *  read's own team filter matches only the team that started a move). */
  parties?: readonly string[]
}

type Doc = Record<string, unknown>
const asDoc = (v: unknown): Doc => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Doc) : {})
const TEAM_KEYS = ['team_id', 'from_team_id', 'to_team_id', 'proposer_team_id', 'recipient_team_id'] as const

/** Every team a stored move names: the team that started it, and the team
 *  ids its payload records — a trade's two sides (and each player's, drop's
 *  and FAAB leg's), a commissioner's move's team / from / to. A league post
 *  names none. */
export function involvedTeamIds(item: ActivityItem): Set<string> {
  const ids = new Set<string>()
  if (item.kind !== 'transaction') return ids
  const add = (v: unknown) => {
    if (typeof v === 'string' && v !== '') ids.add(v)
  }
  add(item.team_id)
  const payload = asDoc(item.payload)
  for (const key of TEAM_KEYS) add(payload[key])
  if (Array.isArray(payload.affected_team_ids)) payload.affected_team_ids.forEach(add)
  for (const list of [payload.players, payload.drops, payload.faab]) {
    if (!Array.isArray(list)) continue
    for (const raw of list) {
      const leg = asDoc(raw)
      for (const key of TEAM_KEYS) add(leg[key])
    }
  }
  return ids
}

/** A stream's own keep rule (`parties`); every item when it has none. */
export function streamKeeps(stream: MobileActivityStream | undefined, item: ActivityItem): boolean {
  if (!stream?.parties) return true
  const ids = involvedTeamIds(item)
  return stream.parties.some((t) => ids.has(t))
}

interface StreamState {
  cursor: { before: string; beforeId: string } | null
  done: boolean
}

interface MergedPage {
  items: ActivityItem[]
  next: StreamState[] | null
}

/** Rows per stream per page. */
const PAGE = 30

/** The feed's sort key, to the microsecond (the read's own precision). */
function instantMicros(instant: string | null): number {
  if (!instant) return Number.NEGATIVE_INFINITY
  const ms = Date.parse(instant)
  if (Number.isNaN(ms)) return Number.NEGATIVE_INFINITY
  const fraction = /T\d{2}:\d{2}:\d{2}\.(\d+)/.exec(instant)?.[1] ?? ''
  return ms * 1000 + Number(fraction.padEnd(6, '0').slice(3, 6))
}

/** Newest first: (created_at DESC, id DESC) — the read's order. >0 = a before b. */
function newer(a: ActivityItem, b: ActivityItem): number {
  const d = instantMicros(a.created_at) - instantMicros(b.created_at)
  if (d !== 0) return d
  return a.id > b.id ? 1 : a.id < b.id ? -1 : 0
}

/** Pure: one page over every stream. Exported for its pin. The cursors
 *  follow everything each stream READ; what is shown is what each stream
 *  keeps (`keep`), once per item. */
export function mergeStreamPage(
  states: readonly StreamState[],
  results: ReadonlyArray<ActivityFeed | null>,
  keep: (item: ActivityItem, stream: number) => boolean = () => true,
): MergedPage {
  const pool: Array<{ item: ActivityItem; stream: number }> = []
  results.forEach((r, i) => r?.items.forEach((item) => pool.push({ item, stream: i })))
  pool.sort((a, b) => newer(b.item, a.item))
  let cut: ActivityItem | null = null
  for (const r of results) {
    if (!r || !r.has_more || r.items.length === 0) continue
    const last = r.items[r.items.length - 1]!
    if (cut === null || newer(last, cut) > 0) cut = last
  }
  const emitted = cut === null ? pool : pool.filter((p) => newer(p.item, cut!) >= 0)
  const next = states.map((state, i): StreamState => {
    const r = results[i]
    if (state.done || !r) return state
    const mine = emitted.filter((p) => p.stream === i)
    if (!r.has_more && mine.length === r.items.length) return { cursor: null, done: true }
    const last = mine[mine.length - 1]?.item
    if (last && last.created_at) return { cursor: { before: last.created_at, beforeId: last.id }, done: false }
    if (last) return { cursor: null, done: true }
    return state
  })
  const seen = new Set<string>()
  const items: ActivityItem[] = []
  for (const p of emitted) {
    if (seen.has(p.item.id) || !keep(p.item, p.stream)) continue
    seen.add(p.item.id)
    items.push(p.item)
  }
  return { items, next: next.some((s) => !s.done) ? next : null }
}

export function useMobileLeagueActivity(leagueId: string | undefined, streams: readonly MobileActivityStream[]) {
  const queryClient = useQueryClient()
  const query = useInfiniteQuery({
    queryKey: [...leagueActivityKeys.all(leagueId ?? 'none'), 'mobile', streams] as const,
    enabled: Boolean(leagueId) && streams.length > 0,
    retry: false,
    initialPageParam: streams.map((): StreamState => ({ cursor: null, done: false })),
    getNextPageParam: (last: MergedPage) => last.next ?? undefined,
    queryFn: async ({ pageParam }): Promise<MergedPage> => {
      const results = await Promise.all(
        streams.map((s, i) => {
          const state = pageParam[i]
          if (!state || state.done) return Promise.resolve(null)
          return sendLeagueAction<ActivityFeed>(
            `/api/leagues/${leagueId!}/activity${activitySearchParams({
              ...(s.teamId ? { teamId: s.teamId } : {}),
              ...(s.type ? { type: s.type } : {}),
              ...(s.topic ? { topic: s.topic } : {}),
              limit: PAGE,
              before: state.cursor?.before,
              beforeId: state.cursor?.beforeId,
            })}`,
          )
        }),
      )
      return mergeStreamPage(pageParam, results, (item, i) => streamKeeps(streams[i], item))
    },
  })

  const invalidate = () => {
    if (!leagueId) return
    void queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })
    invalidateCommishLog(queryClient, leagueId)
  }
  const handlers: LeagueChannelHandlers = {}
  for (const event of LEAGUE_CHANNEL_EVENTS.filter(activityEventInvalidates)) handlers[event] = invalidate
  const { connection } = useLeagueChannel(leagueId, handlers, { onJoin: invalidate, onDrop: invalidate })

  const items = query.data?.pages.flatMap((p) => p.items)
  return { ...query, items, connection }
}
