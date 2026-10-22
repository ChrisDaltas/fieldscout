/**
 * use-realtime-fallback-poll.test.ts — spec §24.3's realtime-degradation
 * fallback ("fall back to 10s REST polling"), PROGRESS **F758** / **D690**.
 *
 * Every rule Chris set on 2026-10-21, each driven under fake timers through
 * the poller the shared hook wraps (`createFallbackPoller`), plus the one
 * React Query interaction the loud-failure rule depends on — run against a
 * REAL `QueryClient` + `QueryObserver`, not a mock, so "a failed poll shows
 * the stale state" is the library's actual behaviour and not an assumption.
 *
 * The last block is a source pin on WHERE the poll runs ("Nothing else"):
 * the draft room plus the six live-scoring mounts, and no other file.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  REALTIME_FALLBACK_POLL_MS,
  channelDegradedAfter,
  createFallbackPoller,
  invalidateForFallbackPoll,
} from './use-realtime-fallback-poll-ops'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function harness() {
  const state = { visible: true, polls: 0 }
  const poller = createFallbackPoller({
    poll: () => {
      state.polls += 1
    },
    isVisible: () => state.visible,
  })
  return { state, poller }
}

describe('the cadence is §24.3\'s printed 10 s', () => {
  it('is the stored literal 10000', () => {
    expect(REALTIME_FALLBACK_POLL_MS).toBe(10_000)
  })
})

describe('channelDegradedAfter — the spines\' down flag', () => {
  it('the three failures set it, SUBSCRIBED alone clears it, anything else leaves it', () => {
    expect(channelDegradedAfter('CHANNEL_ERROR', false)).toBe(true)
    expect(channelDegradedAfter('TIMED_OUT', false)).toBe(true)
    expect(channelDegradedAfter('CLOSED', false)).toBe(true)
    expect(channelDegradedAfter('SUBSCRIBED', true)).toBe(false)
    expect(channelDegradedAfter('JOINING', true)).toBe(true)
    expect(channelDegradedAfter('JOINING', false)).toBe(false)
    // Case-sensitive, like realtime-js's own constants.
    expect(channelDegradedAfter('closed', false)).toBe(false)
  })
})

describe('createFallbackPoller', () => {
  it('never polls while the channel is connected', () => {
    const { state, poller } = harness()
    vi.advanceTimersByTime(REALTIME_FALLBACK_POLL_MS * 6)
    expect(state.polls).toBe(0)
    poller.setDegraded(false)
    vi.advanceTimersByTime(REALTIME_FALLBACK_POLL_MS * 6)
    expect(state.polls).toBe(0)
    expect(poller.running()).toBe(false)
    // A visibility change on a connected client polls nothing either.
    poller.visibilityChanged()
    expect(state.polls).toBe(0)
  })

  it('polls every 10 s while down — the first one interval after the drop', () => {
    const { state, poller } = harness()
    poller.setDegraded(true)
    expect(state.polls).toBe(0) // the drop already refetched (onDrop)
    vi.advanceTimersByTime(9_999)
    expect(state.polls).toBe(0) // boundary: one ms short of the cadence
    vi.advanceTimersByTime(1)
    expect(state.polls).toBe(1)
    vi.advanceTimersByTime(20_000)
    expect(state.polls).toBe(3)
    // A repeated "still down" does not re-arm (no double cadence).
    poller.setDegraded(true)
    vi.advanceTimersByTime(10_000)
    expect(state.polls).toBe(4)
    poller.dispose()
  })

  it('stops the moment the channel is SUBSCRIBED again', () => {
    const { state, poller } = harness()
    poller.setDegraded(true)
    vi.advanceTimersByTime(20_000)
    expect(state.polls).toBe(2)
    poller.setDegraded(channelDegradedAfter('SUBSCRIBED', true))
    expect(poller.running()).toBe(false)
    vi.advanceTimersByTime(REALTIME_FALLBACK_POLL_MS * 6)
    expect(state.polls).toBe(2)
    // Down again later: the cadence restarts from the new drop.
    poller.setDegraded(true)
    vi.advanceTimersByTime(10_000)
    expect(state.polls).toBe(3)
    poller.dispose()
  })

  it('pauses while the tab is hidden, and catches up once when it is back in front', () => {
    const { state, poller } = harness()
    state.visible = false
    poller.setDegraded(true)
    vi.advanceTimersByTime(60_000)
    expect(state.polls).toBe(0) // six ticks landed on a hidden tab — all skipped, none queued

    state.visible = true
    poller.visibilityChanged()
    expect(state.polls).toBe(1) // back in front while still down: poll at once
    vi.advanceTimersByTime(9_999)
    expect(state.polls).toBe(1) // and the cadence counts from the return
    vi.advanceTimersByTime(1)
    expect(state.polls).toBe(2)

    // Hidden again mid-outage: the next tick is skipped.
    state.visible = false
    poller.visibilityChanged()
    vi.advanceTimersByTime(10_000)
    expect(state.polls).toBe(2)
    poller.dispose()
  })

  it('a disposed poller is inert', () => {
    const { state, poller } = harness()
    poller.setDegraded(true)
    poller.dispose()
    vi.advanceTimersByTime(60_000)
    poller.visibilityChanged()
    poller.setDegraded(true)
    vi.advanceTimersByTime(60_000)
    expect(state.polls).toBe(0)
  })
})

describe('a failed poll shows the stale state — loud failure, never an empty result', () => {
  /** The live screens' own predicate: last-good data AND an error ⇒ the
   *  `StaleDataBanner` (e.g. `matchup-view.tsx`: `problem && doc`). */
  const showsStale = (r: { isError: boolean; data: unknown }) => r.isError && r.data !== undefined

  async function drain() {
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
  }

  it('keeps the last-good scores and goes isError when the poll\'s read fails', async () => {
    // The production client's retry posture (query-provider.tsx: retry 1).
    const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 1_000, staleTime: 60_000 } } })
    const key = ['league-matchups', 'L', 7]
    let failing = false
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: async () => {
        if (failing) throw new Error('upstream 503')
        return { week: 7, home_points: 101.5 }
      },
    })
    const unsubscribe = observer.subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    await drain()
    expect(observer.getCurrentResult().data).toEqual({ week: 7, home_points: 101.5 })
    expect(showsStale(observer.getCurrentResult())).toBe(false)

    const poller = createFallbackPoller({
      poll: () => invalidateForFallbackPoll(client, [key]),
      isVisible: () => true,
    })
    failing = true
    poller.setDegraded(true)
    await vi.advanceTimersByTimeAsync(REALTIME_FALLBACK_POLL_MS) // the poll fires
    await vi.advanceTimersByTimeAsync(1_000) // its one retry
    await drain()

    const result = observer.getCurrentResult()
    expect(result.isError).toBe(true)
    expect(result.data).toEqual({ week: 7, home_points: 101.5 }) // not emptied
    expect(showsStale(result)).toBe(true)

    // And it recovers on the next good poll.
    failing = false
    await vi.advanceTimersByTimeAsync(REALTIME_FALLBACK_POLL_MS)
    await drain()
    expect(observer.getCurrentResult().isError).toBe(false)

    poller.dispose()
    unsubscribe()
    client.clear()
  })

  it('a SLOW failing read still reaches isError — the next tick joins it rather than cancelling it', async () => {
    // A read that fails only after 15 s (longer than the cadence). React
    // Query's default `cancelRefetch: true` would cancel it at the next
    // tick and start over, forever — the banner would never show.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
    const key = ['league-box', 'L', 7, 'T']
    let calls = 0
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: () => {
        calls += 1
        if (calls === 1) return Promise.resolve({ starters: 9 })
        return new Promise((_, reject) => setTimeout(() => reject(new Error('slow 504')), 15_000))
      },
    })
    const unsubscribe = observer.subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    await drain()
    expect(observer.getCurrentResult().data).toEqual({ starters: 9 })

    const poller = createFallbackPoller({
      poll: () => invalidateForFallbackPoll(client, [key]),
      isVisible: () => true,
    })
    poller.setDegraded(true)
    await vi.advanceTimersByTimeAsync(10_000 + 15_000) // poll at 10 s, a 2nd tick at 20 s, the read fails at 25 s
    await drain()

    const result = observer.getCurrentResult()
    expect(result.isError).toBe(true)
    expect(result.data).toEqual({ starters: 9 })
    expect(calls).toBe(2) // the 20 s tick joined the in-flight read

    poller.dispose()
    unsubscribe()
    client.clear()
  })
})

describe('where the poll runs — the draft room and the live scoring screens, nothing else (F758)', () => {
  const ROOT = join(__dirname, '..')
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path, out)
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(path)
    }
    return out
  }
  const files = walk(ROOT)
  const rel = (p: string) => p.slice(ROOT.length + 1)

  it('only the six live-scoring mounts opt in', () => {
    const optedIn = files.filter((f) => readFileSync(f, 'utf8').includes('fallbackPoll: true')).map(rel).sort()
    expect(optedIn).toEqual([
      'components/leagues/league-home-season.tsx', // League Home's scoreboard
      'components/leagues/matchup-view.tsx', // Matchup
      'components/leagues/team-page.tsx', // My Team
      'components/mobile/league/league/matchups-segment.tsx', // phone League Home scoreboard
      'components/mobile/league/match/mobile-match.tsx', // phone Matchup
      'components/mobile/league/team/my-team-tab.tsx', // phone My Team
    ])
  })

  it('only the shared hook\'s owners call it', () => {
    const callers = files
      .filter((f) => /useRealtimeFallbackPoll\(/.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort()
    expect(callers).toEqual([
      'hooks/use-draft.ts', // the draft room
      'hooks/use-matchups.ts',
      'hooks/use-playoff-bracket.ts',
      'hooks/use-realtime-fallback-poll.ts', // its definition
      'hooks/use-rosters.ts',
    ])
  })
})
