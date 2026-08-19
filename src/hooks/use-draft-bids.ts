'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'
import { pageAll } from '@/lib/supabase/page-all'

import { compareBidRows, type DraftBidRow } from './use-draft-bids-ops'

/**
 * Auction bid feed data (M3 task L.C1.6; spec §12.5 — bids are member-
 * readable in an open auction; §9.3; migration 088; D134/F69).
 *
 * READ: an RLS-scoped direct SELECT (D92's read rule; 083's member SELECT
 * policy is the auth) over `draft_bids` for this draft — LIVE rows only
 * (`voided_at IS NULL`; 088 banner item 3: the SELECT is run-pure at its
 * snapshot — situation (c) stamps the whole previous run before the next
 * writes a row — so no run key is needed). PAGED, never capped: PostgREST
 * returns at most 1000 rows per request and a bidding-heavy auction can
 * exceed that — the CLAUDE.md "exactly 1000 rows looked like the whole
 * table" lesson — so the read drains through `pageAll` with `count: 'exact'`
 * as the finish line (a short page alone cannot tell "pool exhausted" from
 * "server capped below our page size" — page-all.ts's own header) and a
 * stable order ending in the UNIQUE `id` (R402; the players/builder
 * precedent — a non-unique final key lets rows duplicate or vanish across
 * a page boundary).
 *
 * LIVE updates ride the room's ONE existing channel (§9.3's ≤3 budget — no
 * second subscription): `useDraftRoom` folds `draft_bids` broadcasts into
 * this query's cache through the pure reducer (`use-draft-bids-ops.ts`) —
 * via the feed SINK (`use-draft-feed-sink.ts`, R401), which holds events
 * across an in-flight fetch of this query and replays them onto its result,
 * because React Query discards a cache write made while a fetch is in
 * flight — and invalidates it on every confirmed (re)join (the feed has no
 * gap detector — tuple-dedupe + join-refetch is the missed-event recovery,
 * the chat precedent). There is no write here: bids land via the §15.2
 * routes → `draft_place_bid` (L.C2.1), never client DML.
 */

export const draftBidKeys = {
  feed: (draftId: string) => ['draft-bids', draftId] as const,
}

export const DRAFT_BID_COLUMNS = 'nomination_seq, player_id, team_id, amount, created_at, voided_at'

export function useDraftBids(draftId: string | undefined) {
  return useQuery({
    queryKey: draftBidKeys.feed(draftId ?? 'none'),
    enabled: Boolean(draftId),
    queryFn: async (): Promise<DraftBidRow[]> => {
      const supabase = createBrowserClient()
      const rows = await pageAll<DraftBidRow>((from, to) =>
        supabase
          .from('draft_bids')
          // Exact count is the finish line pageAll drains to — without it a
          // short page is indistinguishable from a server-side cap.
          .select(DRAFT_BID_COLUMNS, { count: 'exact' })
          .eq('draft_id', draftId!)
          .is('voided_at', null)
          .order('nomination_seq', { ascending: true })
          .order('amount', { ascending: true })
          .order('created_at', { ascending: true })
          // Unique final tiebreak — REQUIRED for stable paging (page-all.ts).
          .order('id', { ascending: true })
          .range(from, to),
      )
      return [...rows].sort(compareBidRows)
    },
  })
}
