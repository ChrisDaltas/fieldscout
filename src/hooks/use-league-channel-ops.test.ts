/**
 * use-league-channel-ops.test.ts — the `league:<id>` spine's PURE half plus
 * the source pins on the three L.D4.2 hooks (M4 task L.D4.2; spec
 * §9.2/§9.3/§15.6; PROGRESS D296/D298).
 *
 * Two kinds of claim, deliberately separated:
 *   1. Decidable without a socket (topic string, the closed event set, the
 *      unknown-event rule, the backoff, which events touch the feed) — real
 *      unit tests over the exported functions.
 *   2. Claims about WIRING that only a mounted React tree with a live
 *      WebSocket could execute — source pins, the
 *      `use-draft-auction-ops.test.ts` / `single-room-tab.test.ts` pattern
 *      this repo already uses for exactly this (there is no React testing
 *      harness in the suite, and standing one up for four hooks is a bigger
 *      change than the task).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ACTIVITY_INVALIDATING_EVENTS,
  LEAGUE_CHANNEL_EVENTS,
  LEAGUE_CHANNEL_MAX_REOPEN_MS,
  activityEventInvalidates,
  leagueChannelRegistryTopic,
  leagueChannelTopic,
  reopenDelayMs,
} from './use-league-channel-ops'

const SPINE = 'src/hooks/use-league-channel.ts'
const ACTIVITY = 'src/hooks/use-league-activity.ts'
const TRANSACTIONS = 'src/hooks/use-transactions.ts'
const SCHEDULE = 'src/hooks/use-schedule.ts'

function code(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

describe('the topic string (§9.2)', () => {
  it('is `league:<id>` — the literal 070 broadcasts to and the RLS policy splits on', () => {
    expect(leagueChannelTopic('11111111-2222-4333-8444-555555555555')).toBe(
      'league:11111111-2222-4333-8444-555555555555',
    )
    // 070's READ policy is is_league_member(split_part(topic, ':', 2)::uuid),
    // so a second colon or a suffix would put the join outside the policy.
    expect(leagueChannelTopic('abc').split(':')).toHaveLength(2)
  })

  it('the registry form carries supabase-js\'s own prefix (the D109(9) sweep key)', () => {
    expect(leagueChannelRegistryTopic('abc')).toBe('realtime:league:abc')
  })
})

describe('the event set is CLOSED and unknown events are inert (M2 forward-compat)', () => {
  it('carries the two events that exist today and the four D296 adds', () => {
    expect([...LEAGUE_CHANNEL_EVENTS]).toEqual([
      'leagues', // 070
      'league_chat', // 070 — a non-draft context broadcasts to league:<id>
      'transactions', // 117 / D296 — the activity feed's carrier
      'matchups', // 117 / D296 — the coalesced scores_updated
      'team_week_results', // 117 / D296 — finalization
      'league_weeks', // 117 / D296 — status flips
    ])
  })

  it('never claims an event it does not know — including a case variant', () => {
    // R773 deleted the `isLeagueChannelEvent` type guard (the spine called it
    // on a value drawn from this very constant — a check that could not
    // fail). The claim it carried lives here instead, on the constant: the
    // set is exactly the six above, and the names are the WIRE names 070
    // sends, case included.
    for (const stranger of ['waiver_claims', 'draft_bids', 'player_stats', '', 'TRANSACTIONS']) {
      expect([...LEAGUE_CHANNEL_EVENTS] as string[], stranger).not.toContain(stranger)
    }
  })

  it('NEVER lists a sensitive table (§9.2) — waiver claims and stat lines stay off the wire', () => {
    for (const forbidden of ['waiver_claims', 'player_stats', 'trades', 'nfl_weeks']) {
      expect([...LEAGUE_CHANNEL_EVENTS], forbidden).not.toContain(forbidden)
    }
  })
})

describe('which events make the ACTIVITY feed stale (D298)', () => {
  it('SELECTS the handler map the feed installs — the derivation, not a description', () => {
    // R773: `use-league-activity` builds its map as
    // LEAGUE_CHANNEL_EVENTS.filter(activityEventInvalidates), so this is the
    // exact set of events that gets a handler. Reproduced here so the
    // derivation itself is asserted, not just its two inputs.
    // In LEAGUE_CHANNEL_EVENTS' own order, which is the order the handlers
    // are installed in.
    expect(LEAGUE_CHANNEL_EVENTS.filter(activityEventInvalidates)).toEqual([
      'league_chat',
      'transactions',
    ])
  })

  it('the feed refetches on its two carriers and NOTHING else', () => {
    expect([...ACTIVITY_INVALIDATING_EVENTS]).toEqual(['transactions', 'league_chat'])
    expect(activityEventInvalidates('transactions')).toBe(true)
    expect(activityEventInvalidates('league_chat')).toBe(true)
  })

  it('a score tick does not re-fetch the activity list', () => {
    // `matchups` fires once per scoring batch per league — every few seconds
    // in a game window. Refetching a paged feed on it would be a self-
    // inflicted load problem with no user-visible gain.
    for (const quiet of ['matchups', 'team_week_results', 'league_weeks', 'leagues']) {
      expect(activityEventInvalidates(quiet), quiet).toBe(false)
    }
    expect(activityEventInvalidates('who_knows')).toBe(false)
  })
})

describe('reconnect backoff', () => {
  it('doubles from 1s and CAPS — a long outage never becomes a busy loop or an hour-long wait', () => {
    expect(reopenDelayMs(0)).toBe(1_000)
    expect(reopenDelayMs(1)).toBe(2_000)
    expect(reopenDelayMs(2)).toBe(4_000)
    expect(reopenDelayMs(3)).toBe(8_000)
    expect(reopenDelayMs(4)).toBe(LEAGUE_CHANNEL_MAX_REOPEN_MS)
    expect(reopenDelayMs(400)).toBe(LEAGUE_CHANNEL_MAX_REOPEN_MS)
    // A negative/absurd attempt count cannot produce a sub-millisecond retry.
    expect(reopenDelayMs(-3)).toBe(1_000)
  })
})

// ---------------------------------------------------------------------------
// Source pins — the wiring a node test cannot execute
// ---------------------------------------------------------------------------

describe('the spine keeps §9.3 doctrine', () => {
  const source = code(SPINE)

  it('opens exactly ONE channel, private, on the ops topic', () => {
    expect((source.match(/\.channel\(/g) ?? []).length).toBe(1)
    expect(source).toContain('supabase.channel(leagueChannelTopic(room.leagueId), {')
    expect(source).toContain('config: { private: true }')
  })

  it('holds that channel in a MODULE-LEVEL refcounted room, not per hook instance (R769)', () => {
    // The behavioural proof is `use-league-channel-room.test.ts`; this pins
    // that the state lives outside the effect, which is what makes it true.
    expect(source).toContain('const leagueRooms = new Map<string, LeagueRoom>()')
    expect(source).toContain('room.subscribers.add(subscriber)')
    expect(source).toContain('held.subscribers.delete(subscriber)')
    expect(source).toContain('if (held.subscribers.size > 0) return')
    // …and the hook itself owns no channel: it joins and releases.
    const hook = source.slice(source.indexOf('export function useLeagueChannel'))
    expect(hook).not.toContain('.channel(')
    expect(hook).toContain('return joinLeagueRoom(leagueId, {')
  })

  it('registers every known event on that one channel — never a second channel per consumer', () => {
    expect(source).toContain('for (const event of LEAGUE_CHANNEL_EVENTS) {')
    expect(source).toContain("ch.on('broadcast', { event }, ({ payload }) => {")
    // Dispatch through each subscriber's ref, so an event with no handler is
    // inert — and every subscriber of the room sees it (R769).
    expect(source).toContain('for (const subscriber of [...room.subscribers]) {')
    expect(source).toContain('subscriber.handlers.current[event]?.(envelope)')
  })

  it('refetches on EVERY confirmed (re)join (the boot-window + reconnect recovery)', () => {
    expect(source).toContain("if (status === 'SUBSCRIBED') {")
    expect(source).toContain('for (const subscriber of [...room.subscribers]) subscriber.onJoin?.()')
    // A late joiner gets the same reconcile: its cache may predate the room.
    expect(source).toContain("if (room.connection === 'live') subscriber.onJoin?.()")
  })

  it('refetches FIRST, then resubscribes, on a failed join (§8.7 reconnect order)', () => {
    const dropArm = source.slice(source.indexOf("status === 'CHANNEL_ERROR'"))
    expect(dropArm.indexOf('subscriber.onDrop?.()')).toBeLessThan(dropArm.indexOf('scheduleReopen(room)'))
  })

  it('sweeps a stale registry instance for the topic BEFORE subscribing (D109(9))', () => {
    expect(source).toContain('for (const stale of supabase.getChannels()) {')
    expect(source).toContain('await supabase.removeChannel(stale)')
    expect(source.indexOf('await supabase.removeChannel(stale)')).toBeLessThan(
      source.indexOf('supabase.channel(leagueChannelTopic'),
    )
  })

  it('pins the realtime token to the session before the join', () => {
    expect(source).toContain('await supabase.realtime.setAuth(')
  })

  it('unsubscribes when the LAST subscriber leaves — a leaked league channel is a quota killer', () => {
    expect(source).toContain('held.disposed = true')
    expect(source).toContain('void channel.unsubscribe()')
    expect(source).toContain('void supabase.removeChannel(channel)')
    expect(source).toContain('leagueRooms.delete(leagueChannelTopic(held.leagueId))')
  })

  it('depends only on the league id, so an inline handler map cannot churn the socket', () => {
    expect(source).toContain('}, [leagueId])')
    expect(source).toContain('handlersRef.current = handlers')
  })
})

describe('the activity feed is the F42 transactions trigger\'s consumer (D296/D298)', () => {
  const source = code(ACTIVITY)

  it('subscribes through the shared spine — it opens no channel of its own', () => {
    expect(source).not.toContain('.channel(')
    expect(source).toContain('useLeagueChannel(')
  })

  it('DERIVES its handler map from the pure decision — no hand-listed events (R773)', () => {
    expect(source).toContain(
      'for (const event of LEAGUE_CHANNEL_EVENTS.filter(activityEventInvalidates)) {',
    )
    expect(source).toContain('handlers[event] = invalidate')
    // The shape R773 removed: a handler written out per event, each calling
    // the predicate on its own literal (a guard that could not fail).
    expect(source).not.toContain('transactions: () => {')
    expect(source).not.toContain('league_chat: () => {')
  })

  it('refetches on event rather than patching a column-selected payload', () => {
    expect(source).toContain('queryClient.invalidateQueries({ queryKey: leagueActivityKeys.all(leagueId) })')
    expect(source).toContain('onJoin: invalidate')
    expect(source).toContain('onDrop: invalidate')
  })

  it('sends BOTH cursor halves or neither (R770)', () => {
    expect(source).toContain(
      "if (filters.before && filters.beforeId) params.set('before_id', filters.beforeId)",
    )
  })

  it('sends only the filters the caller SET — an absent filter stays absent', () => {
    expect(source).toContain('if (filters.week !== undefined) params.set(')
    expect(source).toContain("if (filters.kind && filters.kind !== 'all') params.set('kind'")
  })
})

describe('the mutations stamp one action_id per submit and are never optimistic (§15.6/E2)', () => {
  it('add/drop mints per submit, carries it in the VARIABLES, and does not touch the cache first', () => {
    const source = code(TRANSACTIONS)
    expect((source.match(/crypto\.randomUUID\(\)/g) ?? []).length).toBe(2) // submit + submitAsync
    expect(source).toContain('action_id: crypto.randomUUID(),')
    // A retry replays; nothing is written to the cache before the server agrees.
    expect(source).not.toContain('onMutate')
    expect(source).not.toContain('setQueryData')
  })

  it('the remix confirm mints per submit; the PREVIEW mints a seed and can re-show one', () => {
    const source = code(SCHEDULE)
    expect(source).toContain('action_id: crypto.randomUUID(),')
    expect(source).toContain('mintScheduleSeed(crypto.randomUUID())')
    expect(source).toContain('previewSeed: (seed: number) => mutation.mutate({ seed })')
    expect(source).not.toContain('onMutate')
    expect(source).not.toContain('setQueryData')
  })

  it('the confirm posts the SEED and nothing derived from the preview', () => {
    // The hook half of the regenerate-in-body law: no `proposed`, no `diff`,
    // no week list ever leaves the client.
    const source = code(SCHEDULE)
    const confirm = source.slice(source.indexOf('export function useConfirmRemix'))
    for (const forbidden of ['proposed', 'diff', 'weeks_regenerable', 'matchups']) {
      expect(confirm, forbidden).not.toContain(`${forbidden}:`)
    }
  })
})
