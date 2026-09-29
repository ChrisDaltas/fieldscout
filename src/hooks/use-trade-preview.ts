'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { LeagueActionError, jsonInit, sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { TradePreview } from '@/lib/leagues/api/trades-service'

import { tradeLegVariables, type TradeLeg, type TradeLegVariables } from './use-propose-trade'

/**
 * The league's answer to an offer BEFORE it is sent, or to accepting one
 * BEFORE it is answered — M5 task L.D3.12 (`POST …/trades/preview` →
 * `trade_preview`, migration 162; spec §13.3, §16.2 "legality preview";
 * PROGRESS D426, F462 closed).
 *
 * Chris 2026-09-29: "there is no such thing as trade that isn't legal" — the
 * builder's Send and a card's Accept are enabled only when this says the
 * verb would take it. Every rule is the database's (`trade_check_internal`,
 * the verbs' own validator): the roster fit on both sides and the drops each
 * still needs, FAAB against the balance, exclusivity, both sides giving, the
 * deadline, the season. This hook only carries the answer.
 *
 * A read: never optimistic, never retried; the draft settles for
 * `TRADE_PREVIEW_DEBOUNCE_MS` before it is asked (a typed FAAB amount is one
 * request, not five), and the previous answer stays on screen while the new
 * one is fetched — but it is `checking`, so no button trusts a stale answer.
 * The trade center invalidates `tradePreviewKeys.all` whenever rosters or
 * trades re-read, so an answer never outlives the rosters it was about.
 *
 * DEPLOY BEFORE PUSH: until 162 is pushed the route answers a named 503 →
 * `unavailable`, and the screen falls back to today's send-and-see (the
 * verb's refusal renders, D419). Any OTHER failure is `failed` (R1282): the
 * screen says the check couldn't be made, the error is logged, and the verb
 * stays the backstop — prevention never switches off silently.
 */
export const tradePreviewKeys = {
  all: (leagueId: string) => ['league-trade-preview', leagueId] as const,
  one: (leagueId: string, body: string | null) => ['league-trade-preview', leagueId, body ?? 'none'] as const,
}

export type TradePreviewDraft =
  | { kind: 'offer'; fromTeamId: string; toTeamId: string; legs: TradeLeg[]; drops: string[] }
  | { kind: 'accept'; tradeId: string; drops: string[] }

export type TradePreviewBody =
  | { from_team_id: string; to_team_id: string; items: TradeLegVariables[]; drops?: string[] }
  | { trade_id: string; drops?: string[] }

export type TradePreviewState =
  /** Nothing to check yet. */
  | { state: 'off' }
  /** 162 not pushed (the named 503) — send and see, exactly as before (D419). */
  | { state: 'unavailable'; reason: string }
  /** R1282: the check itself failed (a 400 / 403 / 409 / 500, a network
   *  error) — said on screen, never passed off as "not updated yet"; the
   *  verb still decides when the offer is sent. */
  | { state: 'failed'; reason: string }
  /** The current draft is being checked; `last` is the previous answer. */
  | { state: 'checking'; last: TradePreview | null }
  | { state: 'ready'; preview: TradePreview }

export const TRADE_PREVIEW_DEBOUNCE_MS = 250

/** Pure: the wire body, drops sorted (the answer does not depend on the
 *  order the manager ticked them in, so neither does the cache key). */
export function tradePreviewBody(draft: TradePreviewDraft): TradePreviewBody {
  const drops = [...draft.drops].sort()
  const dropsPart = drops.length > 0 ? { drops } : {}
  return draft.kind === 'accept'
    ? { trade_id: draft.tradeId, ...dropsPart }
    : { from_team_id: draft.fromTeamId, to_team_id: draft.toTeamId, items: tradeLegVariables(draft.legs), ...dropsPart }
}

export type TradePreviewFetch = { kind: 'answer'; preview: TradePreview } | { kind: 'unavailable'; reason: string }

export async function fetchTradePreview(leagueId: string, body: TradePreviewBody): Promise<TradePreviewFetch> {
  try {
    return { kind: 'answer', preview: await sendLeagueAction<TradePreview>(`/api/leagues/${leagueId}/trades/preview`, jsonInit('POST', body)) }
  } catch (error) {
    if (error instanceof LeagueActionError && error.status === 503) return { kind: 'unavailable', reason: error.message }
    throw error
  }
}

/** The reason recorded when a failed check carried no message. */
export const TRADE_PREVIEW_NO_REASON = 'the league check failed'

/**
 * Pure: the hook's state from the pieces React Query hands it. `key` is the
 * current draft's body, `settled` the debounced one the query is for.
 * Exported for its pins.
 */
export function tradePreviewState(input: {
  key: string | null
  settled: string | null
  data: TradePreviewFetch | undefined
  isError: boolean
  error: unknown
  isFetching: boolean
  isPlaceholderData: boolean
}): TradePreviewState {
  if (input.key === null) return { state: 'off' }
  if (input.isError) {
    return { state: 'failed', reason: input.error instanceof Error && input.error.message ? input.error.message : TRADE_PREVIEW_NO_REASON }
  }
  if (input.data?.kind === 'unavailable') return { state: 'unavailable', reason: input.data.reason }
  const answer = input.data?.kind === 'answer' ? input.data.preview : null
  if (input.key !== input.settled || input.isFetching || input.isPlaceholderData || answer === null) {
    return { state: 'checking', last: answer }
  }
  return { state: 'ready', preview: answer }
}

export type UseTradePreview = (leagueId: string, draft: TradePreviewDraft | null) => TradePreviewState

export const useTradePreview: UseTradePreview = (leagueId, draft) => {
  const key = draft ? JSON.stringify(tradePreviewBody(draft)) : null
  const [settled, setSettled] = useState<string | null>(key)
  useEffect(() => {
    if (key === settled) return
    const timer = setTimeout(() => setSettled(key), TRADE_PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [key, settled])
  const query = useQuery({
    queryKey: tradePreviewKeys.one(leagueId, settled),
    enabled: settled !== null,
    queryFn: () => fetchTradePreview(leagueId, JSON.parse(settled!) as TradePreviewBody),
    retry: false,
    placeholderData: keepPreviousData,
  })
  // R1282: a failed check is loud — on screen (the gates) and here.
  useEffect(() => {
    if (query.error) console.error('trade preview failed:', query.error)
  }, [query.error])
  return tradePreviewState({
    key,
    settled,
    data: query.data,
    isError: query.isError,
    error: query.error,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
  })
}
