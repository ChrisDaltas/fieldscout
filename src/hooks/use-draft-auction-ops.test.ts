/**
 * Auction-verb → route wiring pins (M3 task L.C2.1; spec §15.2 nominate/bid
 * rows over the L.C2.1 routes). Each verb maps to exactly one path + body
 * shape; the pins are the falsifiable half of the two mint-site contracts:
 *  - F64 — a bid body ALWAYS carries the nomination identity
 *    (`nomination_seq` + `player_id`); there is no builder that omits it;
 *  - F65 — action ids are minted PER VERB inside the hooks: `useNominate`
 *    and `usePlaceBid` each call `crypto.randomUUID()` in their own wrappers
 *    and neither wrapper accepts a caller-supplied id (source-pinned — the
 *    `use-draft-feed-sink.test.ts` precedent for pinning a hook's spine
 *    without a DOM).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { bidRequest, nominateRequest } from './use-draft-auction-ops'

const LG = '00000000-0000-4000-8000-00000000lg01'
const D = '00000000-0000-4000-8000-00000000dd01'
const A1 = '00000000-0000-4000-8000-0000000000a1'
const A2 = '00000000-0000-4000-8000-0000000000a2'

describe('auction request wiring (§15.2 → the L.C2.1 routes)', () => {
  it('nominate: player_id + opening_bid + the minted action_id, targeting the room draft explicitly', () => {
    expect(nominateRequest(LG, D, 'p1', 3, A1)).toEqual({
      path: `/api/leagues/${LG}/draft/nominate`,
      body: { draft_id: D, player_id: 'p1', opening_bid: 3, action_id: A1 },
    })
  })

  it('bid: the nomination identity rides EVERY body (F64) — seq + player + amount + the minted action_id', () => {
    expect(bidRequest(LG, D, { nominationSeq: 4, playerId: 'p9', amount: 17 }, A2)).toEqual({
      path: `/api/leagues/${LG}/draft/bid`,
      body: { draft_id: D, nomination_seq: 4, player_id: 'p9', amount: 17, action_id: A2 },
    })
    // The F64 keys are not optional: a body without them is not buildable
    // here and is a 400 at the route.
    const body = bidRequest(LG, D, { nominationSeq: 1, playerId: 'p1', amount: 2 }, A1).body
    expect(Object.keys(body).sort()).toEqual([
      'action_id',
      'amount',
      'draft_id',
      'nomination_seq',
      'player_id',
    ])
  })
})

describe('F65 at the mint site — per-verb action ids (source pins on use-draft-auction.ts)', () => {
  const source = readFileSync(resolve(__dirname, 'use-draft-auction.ts'), 'utf8')

  it('each hook mints inside its own wrappers: four mint sites (nominate/nominateAsync, placeBid/placeBidAsync)', () => {
    const mints = source.match(/crypto\.randomUUID\(\)/g) ?? []
    expect(mints).toHaveLength(4)
    // The nominate wrappers mint for nominations, the bid wrappers for bids.
    expect(source).toMatch(
      /nominate: \(playerId: string, openingBid: number\) =>\s*mutation\.mutate\(\{ playerId, openingBid, actionId: crypto\.randomUUID\(\) \}\)/,
    )
    expect(source).toMatch(
      /placeBid: \(intent: BidIntent\) => mutation\.mutate\(\{ intent, actionId: crypto\.randomUUID\(\) \}\)/,
    )
  })

  it('no wrapper accepts a caller-supplied action id (an id minted for one verb cannot be handed to the other)', () => {
    expect(source).not.toMatch(/nominate: \([^)]*actionId/)
    expect(source).not.toMatch(/placeBid: \([^)]*actionId/)
    expect(source).not.toMatch(/nominateAsync: \([^)]*actionId/)
    expect(source).not.toMatch(/placeBidAsync: \([^)]*actionId/)
  })

  it('never optimistic (§15.6) and no second channel (D184): no cache write on mutate, no subscribe, settle = invalidate draft + feed', () => {
    expect(source).not.toMatch(/onMutate/)
    expect(source).not.toMatch(/setQueryData/)
    expect(source).not.toMatch(/\.channel\(|\.subscribe\(/)
    expect(source).toMatch(/invalidateQueries\(\{ queryKey: draftKeys\.detail\(draftId\) \}\)/)
    expect(source).toMatch(/invalidateQueries\(\{ queryKey: draftBidKeys\.feed\(draftId\) \}\)/)
  })
})
