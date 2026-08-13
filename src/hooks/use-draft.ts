'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'

import { jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import { createBrowserClient } from '@/lib/supabase/client'
import type { Draft } from '@/types/database'

import {
  applyDraftRoomEvent,
  bestClockOffsetMs,
  computeClockOffsetMs,
  connectionAfterJoinFailure,
  heartbeatSignalsGap,
  heartbeatSilenceExceeded,
  OFFSET_SAMPLE_WINDOW,
  type TickHeartbeat,
} from './use-draft-ops'
import { draftChatContext, draftChatKeys } from './use-draft-chat'
import { isChatRecord, reduceChatEvent, type DraftChatRow } from './use-draft-chat-ops'
import { useLeague } from './use-league'
import { leaguesKeys } from './use-leagues'

/**
 * Draft data spine — M2 task L.B2.1 (spec §15.6; tasks-M2 D92).
 *
 * READS are RLS-scoped direct SELECTs (D92: §15.2 prints no draft GET on
 * purpose — `drafts`/`draft_picks` are member-SELECTable, the
 * use-league-invites/use-scoring-templates hook precedent). This file is the
 * FETCH HALF only: the `draft:<id>` subscribe/refetch loop (§9.3
 * fetch-then-subscribe, state_version gap ⇒ refetch) lands with the room
 * shell in L.B3.1 and layers onto these queries without changing them.
 *
 * WRITES are React Query mutations over the §15.2 routes (D92: every
 * mutation is a Route Handler → RPC; never client DML).
 */

export const draftKeys = {
  detail: (draftId: string) => ['draft', draftId] as const,
}

/** The board-relevant slice of a pick row (undone picks included — §12.4
 *  keeps them for audit; board consumers filter `is_undone`). `id` is null
 *  on broadcast-patched HINT rows (pick broadcasts carry no id — D109(2));
 *  the next refetch reconciles. Consumers key on `pick_number`. */
export interface DraftPickSummary {
  id: string | null
  pick_number: number
  round: number | null
  team_id: string
  player_id: string
  is_auto: boolean | null
  is_undone: boolean | null
  made_via: string | null
  created_at: string | null
}

export interface DraftState {
  draft: Draft | null
  picks: DraftPickSummary[]
}

/** Authoritative draft state: the drafts row + its picks (RLS member SELECT). */
export function useDraft(draftId: string | undefined) {
  return useQuery({
    queryKey: draftKeys.detail(draftId ?? 'none'),
    enabled: Boolean(draftId),
    queryFn: async (): Promise<DraftState> => {
      const supabase = createBrowserClient()
      const [draftRes, picksRes] = await Promise.all([
        supabase.from('drafts').select('*').eq('id', draftId!).maybeSingle(),
        supabase
          .from('draft_picks')
          .select(
            'id, pick_number, round, team_id, player_id, is_auto, is_undone, made_via, created_at',
          )
          .eq('draft_id', draftId!)
          .order('pick_number', { ascending: true }),
      ])
      if (draftRes.error) throw draftRes.error
      if (picksRes.error) throw picksRes.error
      return {
        draft: (draftRes.data as Draft | null) ?? null,
        picks: (picksRes.data ?? []) as DraftPickSummary[],
      }
    },
  })
}

// ---------------------------------------------------------------------------
// The subscribe half (L.B3.1 — §9.3; tasks-M2 §4.5; D109)
// ---------------------------------------------------------------------------

export type DraftRoomConnection =
  /** First subscribe not yet confirmed (the fetch already rendered). */
  | 'connecting'
  /** Subscribed — broadcasts are flowing. */
  | 'live'
  /** The channel is down and the room knows it — the §16.5.4 reconnecting
   *  banner renders; refetch-first + resubscribe are already in flight.
   *  Reached from a lost LIVE channel, or (R263) from a room mounted DURING
   *  an outage once `FIRST_JOIN_FAILURES_FOR_BANNER` consecutive first
   *  joins have failed — a never-subscribed room must not claim
   *  'connecting' forever while its liveness is actually broken. */
  | 'reconnecting'

/** What each room occupant tracks over Presence (§9.1; keyed by team). */
export interface DraftRoomPresenceMeta {
  team_id: string | null
  user_id: string | null
}

interface BroadcastEnvelope {
  operation?: string
  record?: unknown
}

/**
 * The room data spine (§15.6; D92 + D109): `useDraft`'s fetch half plus the
 * `draft:<id>` subscribe loop. Doctrine, each line a §9.3 requirement:
 *
 * - **Fetch → render → subscribe:** the channel opens only after the first
 *   successful REST fetch; on every confirmed (re)join the hook refetches —
 *   never depend on missed broadcasts (this is also the D109(9) boot-race
 *   recovery: `realtime.send()` drops silently while the service boots).
 * - **Broadcasts are cache hints** applied through the pure reducer
 *   (`use-draft-ops.ts`); a `state_version` gap ⇒ full refetch.
 * - **Reconnect = refetch-first + resubscribe** (§8.7/§16.3), surfacing
 *   `connection: 'reconnecting'` for the banner.
 * - **Channel budget:** this hook opens exactly ONE channel (the topic
 *   multiplexes drafts/draft_picks/league_chat/tick + Presence — D109(1)),
 *   inside §9.3's ≤ 3 per socket; the effect cleanup unsubscribes on route
 *   change (connection leaks are the #1 quota killer).
 * - **Clock:** the tick heartbeat maintains the server−client offset the
 *   pick clock renders from; the client never owns the clock. Until the
 *   first beat (≤ ~5s after subscribe — 068 ARM 3 beats every pass) the
 *   offset is 0; recorded latitude — the REST fetch carries no server-now,
 *   so the first measurable offset IS the first heartbeat.
 *
 * `presence` (optional): the viewer's seat — when given, the hook tracks
 * {team_id, user_id} on join so `presence-bar` can key online-ness by team.
 */
export function useDraftRoom(
  draftId: string | undefined,
  opts?: { presence?: DraftRoomPresenceMeta },
) {
  const query = useDraft(draftId)
  const queryClient = useQueryClient()
  const [connection, setConnection] = useState<DraftRoomConnection>('connecting')
  const [offsetMs, setOffsetMs] = useState(0)
  const [onlineTeamIds, setOnlineTeamIds] = useState<ReadonlySet<string>>(() => new Set())
  // Offset samples (windowed max — a delay-biased beat cannot drag the
  // clock) + the last-beat instant for silence detection. Refs: neither
  // drives render directly.
  const offsetSamplesRef = useRef<number[]>([])
  const lastBeatAtRef = useRef<number | null>(null)

  const fetched = query.isSuccess
  const presenceTeamId = opts?.presence?.team_id ?? null
  const presenceUserId = opts?.presence?.user_id ?? null

  useEffect(() => {
    if (!draftId || !fetched) return

    const supabase = createBrowserClient()
    let disposed = false
    let channel: RealtimeChannel | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let everSubscribed = false
    // R263: consecutive failed joins while never-subscribed — crossing
    // FIRST_JOIN_FAILURES_FOR_BANNER surfaces the reconnecting banner even
    // though the room was never live (the mount-during-outage shape).
    let failedJoins = 0

    const refetchDraft = () => {
      void queryClient.invalidateQueries({ queryKey: draftKeys.detail(draftId) })
    }

    const applyBroadcast = (event: string, payload: BroadcastEnvelope) => {
      const current = queryClient.getQueryData<DraftState>(draftKeys.detail(draftId))
      if (!current) {
        refetchDraft()
        return
      }
      const result = applyDraftRoomEvent(current, {
        event,
        operation: payload.operation,
        record: payload.record,
      })
      if (result.state !== current) {
        queryClient.setQueryData(draftKeys.detail(draftId), result.state)
      }
      if (result.refetch) refetchDraft()
    }

    const scheduleReopen = () => {
      if (disposed || retryTimer) return
      const delay = Math.min(1_000 * 2 ** attempt, 15_000)
      attempt += 1
      retryTimer = setTimeout(() => {
        retryTimer = null
        channel = null // open() sweeps the stale registry instance, awaited
        void open()
      }, delay)
    }

    const open = async () => {
      if (disposed) return
      // One channel per topic per client (D109(9)): supabase-js returns the
      // EXISTING registry instance for a topic it already holds — including
      // one mid-teardown from an unawaited removeChannel — and subscribing
      // that wedges the rejoin forever (observed live in the D39 pass).
      // Sweep any stale instance for this topic, AWAITED, before creating.
      for (const stale of supabase.getChannels()) {
        if (stale.topic === `realtime:draft:${draftId}`) {
          await supabase.removeChannel(stale)
        }
      }
      if (disposed) return
      // Deterministic private-channel auth (the draft-realtime-db.test.ts
      // posture): pin the realtime token to the current session before the
      // join rather than racing the client's auth listener.
      const { data } = await supabase.auth.getSession()
      if (disposed) return
      await supabase.realtime.setAuth(data.session?.access_token ?? null)
      if (disposed) return

      const ch = supabase.channel(`draft:${draftId}`, {
        config: {
          private: true, // Broadcast-from-DB channels are private (§9.2)
          presence: { key: presenceTeamId ?? presenceUserId ?? 'viewer' },
        },
      })
      channel = ch

      ch.on('broadcast', { event: 'drafts' }, ({ payload }) =>
        applyBroadcast('drafts', (payload ?? {}) as BroadcastEnvelope),
      )
      ch.on('broadcast', { event: 'draft_picks' }, ({ payload }) =>
        applyBroadcast('draft_picks', (payload ?? {}) as BroadcastEnvelope),
      )
      ch.on('broadcast', { event: 'league_chat' }, ({ payload }) => {
        // The chat pane's live feed (L.B3.3) — chat is NOT room state, so it
        // never touches the room reducer: the broadcast folds into the chat
        // query's own cache through the pure chat reducer (id-dedupe absorbs
        // the sender's own-INSERT echo). An unmounted/unfetched pane has no
        // cache to patch — its mount-time fetch carries the history.
        const record = ((payload ?? {}) as BroadcastEnvelope).record
        if (!isChatRecord(record)) return
        const key = draftChatKeys.room(draftId)
        const rows = queryClient.getQueryData<readonly DraftChatRow[]>(key)
        if (!rows) return
        const next = reduceChatEvent(rows, record, draftChatContext(draftId))
        if (next !== rows) queryClient.setQueryData(key, next)
      })
      ch.on('broadcast', { event: 'tick' }, ({ payload }) => {
        const beat = (payload ?? {}) as Partial<TickHeartbeat>
        // Clock SAMPLE at receipt, injected into the pure offset math —
        // never deadline math here (§9.3's grep-able rule).
        const sampledMs = Date.now()
        lastBeatAtRef.current = sampledMs
        if (typeof beat.server_now === 'string') {
          const sample = computeClockOffsetMs(beat.server_now, sampledMs)
          if (sample !== null) {
            const samples = offsetSamplesRef.current
            samples.push(sample)
            if (samples.length > OFFSET_SAMPLE_WINDOW) samples.shift()
            const best = bestClockOffsetMs(samples)
            if (best !== null) setOffsetMs(best)
          }
        }
        const current = queryClient.getQueryData<DraftState>(draftKeys.detail(draftId))
        if (
          current &&
          heartbeatSignalsGap(current, { current_deadline: beat.current_deadline ?? null })
        ) {
          refetchDraft()
        }
      })
      ch.on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState<DraftRoomPresenceMeta>()
        const ids = new Set<string>()
        for (const metas of Object.values(state)) {
          for (const meta of metas) if (meta.team_id) ids.add(meta.team_id)
        }
        setOnlineTeamIds(ids)
      })

      ch.subscribe((status) => {
        if (disposed || ch !== channel) return
        if (status === 'SUBSCRIBED') {
          attempt = 0
          everSubscribed = true
          failedJoins = 0 // R263: a successful join resets the count
          lastBeatAtRef.current = Date.now() // silence counts from the join
          setConnection('live')
          // §9.3: never depend on missed broadcasts — reconcile on EVERY
          // confirmed join (boot window + reconnect gap alike). Chat rides
          // the same rule: it has no gap detector, so the join refetch is
          // its missed-message recovery (id-dedupe absorbs overlap).
          refetchDraft()
          void queryClient.invalidateQueries({ queryKey: draftChatKeys.room(draftId) })
          if (presenceTeamId || presenceUserId) {
            void ch.track({
              team_id: presenceTeamId,
              user_id: presenceUserId,
            } satisfies DraftRoomPresenceMeta)
          }
          return
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // Reconnect doctrine: refetch authoritative state FIRST, then
          // resubscribe (§8.7); the banner renders meanwhile. A room mounted
          // DURING an outage crosses into 'reconnecting' after N failed
          // first joins (R263 — the pure threshold in use-draft-ops.ts).
          failedJoins += 1
          setConnection(connectionAfterJoinFailure(everSubscribed, failedJoins))
          refetchDraft()
          scheduleReopen()
        }
      })
    }

    void open()

    // Beat-SILENCE watchdog: a LIVE draft beats every tick pass; silence
    // past HEARTBEAT_SILENCE_MS while the cache still says 'live' is the
    // one divergence no event can correct (a LOST pause broadcast — paused
    // drafts emit no beats, D109(6)) ⇒ refetch, then re-arm.
    const silenceTimer = setInterval(() => {
      const current = queryClient.getQueryData<DraftState>(draftKeys.detail(draftId))
      const lastBeat = lastBeatAtRef.current
      if (
        current?.draft?.status === 'live' &&
        lastBeat !== null &&
        heartbeatSilenceExceeded(lastBeat, Date.now())
      ) {
        lastBeatAtRef.current = Date.now() // re-arm — one refetch per window
        refetchDraft()
      }
    }, 5_000)

    return () => {
      // §9.3: unsubscribe on route change — no connection leaks.
      disposed = true
      clearInterval(silenceTimer)
      if (retryTimer) clearTimeout(retryTimer)
      if (channel) void supabase.removeChannel(channel)
      channel = null
    }
  }, [draftId, fetched, presenceTeamId, presenceUserId, queryClient])

  // The D102 liveness heartbeat — the room IS the caller the contract names
  // ("a tiny `draft_touch` RPC the room calls (~15s cadence + visibility
  // change)"): without it every occupant is liveness-STALE (held through
  // grace at their deadline) and a mock auto-pauses under E59 while its
  // launcher sits in the room. Presence is ephemeral and tick-invisible —
  // this table read is what the tick's grace/outage arms consume. Best-
  // effort: a failed beat only errs into the protective hold, never breaks
  // the room.
  const draftStatus = query.data?.draft?.status
  const heartbeatActive = draftStatus === 'live' || draftStatus === 'paused'
  useEffect(() => {
    if (!draftId || !heartbeatActive) return
    const supabase = createBrowserClient()
    const touch = () => {
      void supabase.rpc('draft_touch', { p_draft_id: draftId }).then(
        () => undefined,
        () => undefined, // best-effort — the hold semantics are the fallback
      )
    }
    touch()
    const id = setInterval(touch, 15_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') touch()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [draftId, heartbeatActive])

  return { ...query, connection, offsetMs, onlineTeamIds }
}

/**
 * The GET-detail active-draft summary (L.B2.1): non-mock, one row at most
 * (the D95 partial unique). `scheduled_at` is `settings.draft
 * .draft_scheduled_at` — D95's single pre-start store — so it can be
 * populated while `id` is not yet minted (a league scheduled purely through
 * the settings surface has no drafts row until start/tick — D94).
 */
export interface ActiveDraftSummary {
  id: string
  status: 'scheduled' | 'live' | 'paused'
  draft_type: string
  started_at: string | null
  scheduled_at: string | null
}

/**
 * Lobby / home-CTA / draft-bar summary — rides `getLeagueDetail`'s
 * `active_draft` field (one fetch feeds the whole league surface; the
 * detail invalidation the mutations below issue refreshes it).
 */
export function useActiveDraft(leagueId: string | undefined) {
  const detail = useLeague(leagueId)
  return {
    /** The active non-mock draft, or null when none exists yet. */
    activeDraft: detail.data?.active_draft ?? null,
    /** The league's own status ('scheduled'/'drafting' drive the CTAs). */
    leagueStatus: detail.data?.league.status ?? null,
    /** D95: the scheduled instant survives even with no drafts row. */
    scheduledAt:
      detail.data?.active_draft?.scheduled_at ??
      detail.data?.settings.draft.draft_scheduled_at ??
      null,
    isLoading: detail.isLoading,
    isError: detail.isError,
    error: detail.error,
  }
}

// ---------------------------------------------------------------------------
// Mutations (all over the L.B2.1 routes — D92)
// ---------------------------------------------------------------------------

function useInvalidateLeagueDetail(leagueId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: leaguesKeys.detail(leagueId) })
  }
}

/** POST /api/leagues/[id]/draft — create/schedule (commish; idempotent). */
export function useCreateDraft(leagueId: string) {
  const invalidate = useInvalidateLeagueDetail(leagueId)
  return useMutation({
    mutationFn: async () =>
      sendLeagueAction<{ draft: Draft; created: boolean }>(
        `/api/leagues/${leagueId}/draft`,
        jsonInit('POST'),
      ),
    onSuccess: invalidate,
  })
}

/** PATCH body: exactly one of `order`/`randomize`. `reason` is REQUIRED by
 *  the route when the draft is live/paused (the L.B2.3 post-start E31
 *  dispatch — D114(3); randomize is refused post-start), optional pre-start. */
export type DraftOrderBody = { order: string[]; reason?: string } | { randomize: true }

/** PATCH /api/leagues/[id]/draft — order edit (pre-start incl. randomize;
 *  post-start = the E31 dispatch, reason required — the commish panel's
 *  order editor is the consumer). */
export function useDraftOrder(leagueId: string) {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateLeagueDetail(leagueId)
  return useMutation({
    mutationFn: async (body: DraftOrderBody) =>
      sendLeagueAction<{ draft: Draft }>(`/api/leagues/${leagueId}/draft`, jsonInit('PATCH', body)),
    onSuccess: (data) => {
      invalidate()
      void queryClient.invalidateQueries({ queryKey: draftKeys.detail(data.draft.id) })
    },
  })
}

/**
 * POST /api/leagues/[id]/draft/pick — make a pick (L.B2.2). NEVER
 * optimistic (§15.6 — picks reflect the broadcast/refetch, not the cache).
 * Idempotency (D68(1), the create-league stamping pattern): `makePick`
 * stamps ONE `action_id` per user submit — the mutation variables carry it,
 * so a React Query retry REPLAYS server-side (E2) instead of double-picking.
 * Callers use the returned `makePick`/`makePickAsync` wrappers, not
 * `mutate` directly.
 */
export function useMakePick(leagueId: string, draftId: string) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (variables: { player_id: string; action_id: string }) =>
      sendLeagueAction<{ draft: Draft; pick: { id: string; player_id: string } }>(
        `/api/leagues/${leagueId}/draft/pick`,
        jsonInit('POST', { draft_id: draftId, ...variables }),
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: draftKeys.detail(draftId) })
    },
  })

  return {
    ...mutation,
    makePick: (playerId: string) =>
      mutation.mutate({ player_id: playerId, action_id: crypto.randomUUID() }),
    makePickAsync: (playerId: string) =>
      mutation.mutateAsync({ player_id: playerId, action_id: crypto.randomUUID() }),
  }
}

/**
 * POST /api/leagues/[id]/draft/autodraft — "Auto-draft me" (§8.4; the SELF
 * toggle over 072's `set_team_autodraft`; L.B2.2/F33). Idempotent by value
 * (D63/R153: a double-submit round-trips as changed:false) — no action_id.
 * The commissioner any-team toggle rides the members PATCH (use-league-
 * members' surface), not this hook.
 */
export function useToggleAutodraft(leagueId: string) {
  const invalidate = useInvalidateLeagueDetail(leagueId)
  return useMutation({
    mutationFn: async (on: boolean) =>
      sendLeagueAction<{ team_id: string; is_autodraft: boolean; changed: boolean }>(
        `/api/leagues/${leagueId}/draft/autodraft`,
        jsonInit('POST', { on }),
      ),
    // is_autodraft lives on league_members — the league detail feeds it.
    onSettled: invalidate,
  })
}

/** POST /api/leagues/[id]/draft/start — the commissioner's manual start. */
export function useStartDraft(leagueId: string) {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateLeagueDetail(leagueId)
  return useMutation({
    mutationFn: async () =>
      sendLeagueAction<{ draft: Draft; started: boolean }>(
        `/api/leagues/${leagueId}/draft/start`,
        jsonInit('POST'),
      ),
    onSuccess: (data) => {
      invalidate()
      void queryClient.invalidateQueries({ queryKey: draftKeys.detail(data.draft.id) })
    },
  })
}
