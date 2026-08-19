'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

import { compareBidRows, type DraftBidRow } from './use-draft-bids-ops'

/**
 * Auction bid feed data (M3 task L.C1.6; spec §12.5 — bids are member-
 * readable in an open auction; §9.3; migration 088; D134/F69).
 *
 * READ: an RLS-scoped direct SELECT (D92's read rule; 083's member SELECT
 * policy is the auth) over `draft_bids` for this draft — LIVE rows only
 * (`voided_at IS NULL`; 088 banner item 3: a live set is run-pure by
 * construction, so no run key is needed). PAGED, never capped: PostgREST
 * returns at most 1000 rows per request and a bidding-heavy auction can
 * exceed that — the CLAUDE.md "exactly 1000 rows looked like the whole
 * table" lesson — so the read walks ranges until a short page proves the end.
 *
 * LIVE updates ride the room's ONE existing channel (§9.3's ≤3 budget — no
 * second subscription): `useDraftRoom` folds `draft_bids` broadcasts into
 * this query's cache through the pure reducer (`use-draft-bids-ops.ts`) and
 * invalidates it on every confirmed (re)join (the feed has no gap detector —
 * tuple-dedupe + join-refetch is the missed-event recovery, the chat
 * precedent). There is no write here: bids land via the §15.2 routes →
 * `draft_place_bid` (L.C2.1), never client DML.
 */

export const draftBidKeys = {
  feed: (draftId: string) => ['draft-bids', draftId] as const,
}

/** PostgREST's default per-request row cap; one page below it proves the end. */
export const DRAFT_BIDS_PAGE = 1000

export const DRAFT_BID_COLUMNS = 'nomination_seq, player_id, team_id, amount, created_at, voided_at'

export function useDraftBids(draftId: string | undefined) {
  return useQuery({
    queryKey: draftBidKeys.feed(draftId ?? 'none'),
    enabled: Boolean(draftId),
    queryFn: async (): Promise<DraftBidRow[]> => {
      const supabase = createBrowserClient()
      const rows: DraftBidRow[] = []
      for (let from = 0; ; from += DRAFT_BIDS_PAGE) {
        const { data, error } = await supabase
          .from('draft_bids')
          .select(DRAFT_BID_COLUMNS)
          .eq('draft_id', draftId!)
          .is('voided_at', null)
          .order('nomination_seq', { ascending: true })
          .order('amount', { ascending: true })
          .order('created_at', { ascending: true })
          .range(from, from + DRAFT_BIDS_PAGE - 1)
        if (error) throw error
        const page = (data ?? []) as DraftBidRow[]
        rows.push(...page)
        // A short page is the only proof of the end; a full page means
        // there may be more (never assume the cap was the table).
        if (page.length < DRAFT_BIDS_PAGE) break
      }
      return rows.sort(compareBidRows)
    },
  })
}
