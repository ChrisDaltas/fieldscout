/**
 * The Top scouts read (desktop's card and the phone's For you shelf). Nothing
 * awards cred yet, so every account ties at the starting 7 (migration 197) —
 * the read must carry a fixed tiebreak after cred (earliest account, then id)
 * so the 1–5 order can't reshuffle between reads. Pinned on the query the
 * hook sends.
 */
import { describe, expect, it } from 'vitest'

import { CRED_START } from '@/lib/cred-tiers'

import { fetchTopScouts, LEADERBOARD_SIZE } from './use-top-scouts'

type Call = [string, ...unknown[]]

function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: Call[] = []
  const builder = {
    select: (...a: unknown[]) => (calls.push(['select', ...a]), builder),
    order: (...a: unknown[]) => (calls.push(['order', ...a]), builder),
    limit: (...a: unknown[]) => (calls.push(['limit', ...a]), Promise.resolve(result)),
  }
  const client = {
    from: (table: string) => (calls.push(['from', table]), builder),
  }
  return { client: client as unknown as Parameters<typeof fetchTopScouts>[0], calls }
}

describe('fetchTopScouts', () => {
  it('orders by cred, then a fixed tiebreak, and takes the top five', async () => {
    const { client, calls } = fakeClient({ data: [], error: null })
    await fetchTopScouts(client)

    expect(calls[0]).toEqual(['from', 'profiles'])
    expect(calls.filter((c) => c[0] === 'order')).toEqual([
      ['order', 'cred_score', { ascending: false, nullsFirst: false }],
      ['order', 'created_at', { ascending: true, nullsFirst: false }],
      ['order', 'id', { ascending: true }],
    ])
    expect(calls.at(-1)).toEqual(['limit', LEADERBOARD_SIZE])
  })

  it('reads a missing cred as the starting 7, shows a stored cred as stored, and keeps the server order', async () => {
    const { client } = fakeClient({
      data: [
        { id: 'a', username: 'first', avatar_url: null, cred_score: null },
        { id: 'b', username: 'second', avatar_url: 'x.png', cred_score: 7 },
        { id: 'c', username: 'third', avatar_url: null, cred_score: 0 },
      ],
      error: null,
    })
    expect(await fetchTopScouts(client)).toEqual([
      { id: 'a', username: 'first', avatar_url: null, cred_score: CRED_START },
      { id: 'b', username: 'second', avatar_url: 'x.png', cred_score: 7 },
      // A stored 0 (an account 197 hasn't reached yet) is not dressed up as 7.
      { id: 'c', username: 'third', avatar_url: null, cred_score: 0 },
    ])
  })

  it('fails loudly on a read error instead of returning an empty board', async () => {
    const { client } = fakeClient({ data: null, error: new Error('boom') })
    await expect(fetchTopScouts(client)).rejects.toThrow('boom')
  })
})
