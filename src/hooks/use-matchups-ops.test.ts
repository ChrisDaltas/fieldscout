/**
 * use-matchups-ops.test.ts — L.D4.1's freshness wiring (M4; spec §9.3/§11.4;
 * PROGRESS D296/D298, ledger F233(a)), in three layers:
 *
 *   1. THE REDUCER, pure: `matchupsEventEffect` decides refetch/ignore per
 *      event — a known event for THIS week refetches, one naming another
 *      week is inert, a payload with no week refetches conservatively, and
 *      an UNKNOWN event is inert (the M2 forward-compat pattern; the task's
 *      item 3).
 *   2. THE WIRING, EXECUTABLE: the very handler maps the hooks hand to
 *      `useLeagueChannel` (`matchupsHandlers`, `invalidatingHandlers(...)`)
 *      are joined to a room through the real `joinLeagueRoom` with the
 *      supabase client mocked (the `use-league-channel-room.test.ts` fake),
 *      a synthetic `matchups` broadcast is driven through the ONE channel,
 *      and the invalidate is counted. **This is the DoD's target**: drop
 *      `matchups` from `MATCHUPS_INVALIDATING_EVENTS` (the refetch-on-event
 *      wiring) and the event-driven freshness cell below goes RED — shown in
 *      the PR, then reverted. The trigger that emits the real event is
 *      L.D1.9's (behind B9); this is the synthetic pin PROGRESS F248 names,
 *      the wire proof deferred with the trigger.
 *   3. SOURCE PINS on the four hooks — the claims only a mounted React tree
 *      could execute (the `use-league-channel-ops.test.ts` pattern): each
 *      subscriber hook passes its DERIVED map to the shared spine and opens
 *      no channel; the lineup mutation mints per submit and is never
 *      optimistic.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LEAGUE_CHANNEL_EVENTS,
  LEAGUE_DETAIL_INVALIDATING_EVENTS,
  MATCHUPS_INVALIDATING_EVENTS,
  ROSTERS_INVALIDATING_EVENTS,
  SCHEDULE_INVALIDATING_EVENTS,
  STANDINGS_INVALIDATING_EVENTS,
  invalidatingHandlers,
  leagueDetailEventInvalidates,
  matchupsEventInvalidates,
  mergeHandlers,
  rostersEventInvalidates,
  scheduleEventInvalidates,
  standingsEventInvalidates,
  type LeagueBroadcastEnvelope,
} from './use-league-channel-ops'
import { eventWeek, matchupsEventEffect, matchupsHandlers, matchupsInvalidationKeys } from './use-matchups-ops'

// ---------------------------------------------------------------------------
// The fake supabase browser client — the room test's, reproduced: a
// singleton whose `channel(topic)` returns the existing instance for a held
// topic, with bindings we can drive.
// ---------------------------------------------------------------------------

type Status = 'SUBSCRIBED' | 'CLOSED' | 'CHANNEL_ERROR' | 'TIMED_OUT'
interface FakeChannel {
  topic: string
  bindings: Map<string, Array<(payload: { payload: unknown }) => void>>
  statusCallback: ((status: Status) => void) | null
  on: (kind: string, filter: { event: string }, cb: (m: { payload: unknown }) => void) => FakeChannel
  subscribe: (cb: (status: Status) => void) => FakeChannel
  unsubscribe: () => Promise<'ok'>
}
let registry: FakeChannel[] = []
function makeChannel(topic: string): FakeChannel {
  const channel: FakeChannel = {
    topic: `realtime:${topic}`,
    bindings: new Map(),
    statusCallback: null,
    on(_kind, filter, cb) {
      const list = channel.bindings.get(filter.event) ?? []
      list.push(cb)
      channel.bindings.set(filter.event, list)
      return channel
    },
    subscribe(cb) {
      channel.statusCallback = cb
      return channel
    },
    unsubscribe: async () => 'ok',
  }
  return channel
}
const fakeClient = {
  getChannels: () => [...registry],
  removeChannel: async (channel: FakeChannel) => {
    registry = registry.filter((held) => held !== channel)
    channel.statusCallback?.('CLOSED')
    return 'ok'
  },
  channel: (topic: string) => {
    const existing = registry.find((held) => held.topic === `realtime:${topic}`)
    if (existing) return existing
    const created = makeChannel(topic)
    registry.push(created)
    return created
  },
  auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  realtime: { setAuth: async () => undefined },
}
vi.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => fakeClient }))
const { joinLeagueRoom } = await import('./use-league-channel')

const LEAGUE = '11111111-2222-4333-8444-555555555555'
async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}
function fire(event: string, payload: unknown) {
  const channel = registry.find((held) => held.topic === `realtime:league:${LEAGUE}`)
  for (const cb of channel?.bindings.get(event) ?? []) cb({ payload })
}
beforeEach(() => {
  registry = []
})

const MATCHUPS = 'src/hooks/use-matchups.ts'
const STANDINGS = 'src/hooks/use-standings.ts'
const ROSTERS = 'src/hooks/use-rosters.ts'
const LINEUP = 'src/hooks/use-lineup.ts'
const TRANSACTIONS = 'src/hooks/use-transactions.ts'
function code(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

// ---------------------------------------------------------------------------
// 1. The reducer
// ---------------------------------------------------------------------------

describe('matchupsEventEffect — the per-event refetch/ignore decision (§9.3: hints, never authority)', () => {
  const scoresTick: LeagueBroadcastEnvelope = {
    operation: 'UPDATE',
    record: { id: 'm1', week: 3, home_score: 71.5, away_score: 64, status: 'live' },
  }

  it('a `matchups` UPDATE (the coalesced scores_updated) for THIS week refetches', () => {
    expect(matchupsEventEffect('matchups', scoresTick, 3)).toBe('refetch')
  })

  it('the same event naming ANOTHER week is inert — week 2\'s view ignores week 3\'s tick', () => {
    expect(matchupsEventEffect('matchups', scoresTick, 2)).toBe('ignore')
  })

  it('finalization and the status flip refetch too, week-scoped the same way', () => {
    const results = { operation: 'INSERT', record: { team_id: 't1', week: 3, is_final: true } }
    const flip = { operation: 'UPDATE', record: { week: 3, status: 'correction_window' } }
    expect(matchupsEventEffect('team_week_results', results, 3)).toBe('refetch')
    expect(matchupsEventEffect('league_weeks', flip, 3)).toBe('refetch')
    expect(matchupsEventEffect('team_week_results', results, 4)).toBe('ignore')
    expect(matchupsEventEffect('league_weeks', flip, 4)).toBe('ignore')
  })

  it('a payload that names NO week refetches — conservative, never silent', () => {
    expect(matchupsEventEffect('matchups', { operation: 'UPDATE', record: {} }, 3)).toBe('refetch')
    expect(matchupsEventEffect('matchups', { operation: 'UPDATE', record: null }, 3)).toBe('refetch')
    expect(matchupsEventEffect('matchups', {}, 3)).toBe('refetch')
    expect(matchupsEventEffect('matchups', undefined, 3)).toBe('refetch')
  })

  it('a week rendered as a STRING still matches its own view (numeric compare)', () => {
    expect(matchupsEventEffect('matchups', { record: { week: '3' } }, 3)).toBe('refetch')
    expect(matchupsEventEffect('matchups', { record: { week: '2' } }, 3)).toBe('ignore')
    expect(eventWeek({ record: { week: '3' } })).toBe(3)
    expect(eventWeek({ record: { week: 'three' } })).toBeNull()
    expect(eventWeek({ record: { week: 3.5 } })).toBeNull()
  })

  it('UNKNOWN events are inert — a future trigger cannot make an old client refetch (M2 forward-compat)', () => {
    for (const stranger of ['waiver_claims', 'commissioner_actions', 'lineup_swaps', '', 'MATCHUPS']) {
      expect(matchupsEventEffect(stranger, scoresTick, 3), stranger).toBe('ignore')
    }
  })

  it('the events the matchups surface does NOT listen to are inert even for this week', () => {
    for (const other of ['league_rosters', 'transactions', 'league_chat', 'leagues']) {
      expect(matchupsEventEffect(other, { record: { week: 3 } }, 3), other).toBe('ignore')
    }
  })
})

describe('one week’s refetch names BOTH the matchups key and the week’s box keys (L.D5.2 — §11.4 "refetches box-score lines on scores_updated")', () => {
  it('matchupsInvalidationKeys pairs the two keys for the week, and nothing else', () => {
    expect(matchupsInvalidationKeys('league-1', 4)).toEqual([
      ['league-matchups', 'league-1', 4],
      ['league-box', 'league-1', 4],
    ])
  })
  it('the box hook keys under the SAME prefix the invalidation names, so a per-team query is covered by the week key', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/hooks/use-box-score.ts'), 'utf8')
    expect(src).toContain("week: (leagueId: string, week: number) => ['league-box', leagueId, week] as const")
    expect(src).toContain("team: (leagueId: string, week: number, teamId: string) => ['league-box', leagueId, week, teamId] as const")
    // …and opens no channel of its own (F233(a)).
    expect(src).not.toContain('.channel(')
    expect(src).not.toContain('useLeagueChannel')
  })
  it('use-matchups iterates the pair on every invalidation', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/hooks/use-matchups.ts'), 'utf8')
    expect(src).toContain('for (const queryKey of matchupsInvalidationKeys(leagueId, week)) {')
    expect(src).toContain('void queryClient.invalidateQueries({ queryKey })')
  })
})

describe('the three predicates SELECT each surface\'s handler map (R773 — derived, not described)', () => {
  it('matchups: the scores tick, finalization, and the status flip — in the closed set\'s order', () => {
    expect([...MATCHUPS_INVALIDATING_EVENTS]).toEqual(['matchups', 'team_week_results', 'league_weeks'])
    expect(LEAGUE_CHANNEL_EVENTS.filter(matchupsEventInvalidates)).toEqual([
      'matchups',
      'team_week_results',
      'league_weeks',
    ])
  })

  it('standings: finalization + the status flip + a franchise retirement (120 teams), and NOT the scores tick (117 reads final rows only)', () => {
    expect([...STANDINGS_INVALIDATING_EVENTS]).toEqual(['team_week_results', 'league_weeks', 'teams'])
    expect(standingsEventInvalidates('matchups')).toBe(false)
    expect(LEAGUE_CHANNEL_EVENTS.filter(standingsEventInvalidates)).toEqual(['team_week_results', 'league_weeks', 'teams'])
  })

  it('league detail: the teams list refetches on `teams` ONLY (120 / R856) — not on a finalization, a tick or the league row', () => {
    expect([...LEAGUE_DETAIL_INVALIDATING_EVENTS]).toEqual(['teams'])
    expect(LEAGUE_CHANNEL_EVENTS.filter(leagueDetailEventInvalidates)).toEqual(['teams'])
    for (const quiet of ['team_week_results', 'league_weeks', 'matchups', 'leagues', 'league_rosters', 'transactions']) {
      expect(leagueDetailEventInvalidates(quiet), quiet).toBe(false)
    }
  })

  it('mergeHandlers: an event in both maps runs both handlers, in map order; an event in one runs one; an event in none has no handler', () => {
    const calls: string[] = []
    const merged = mergeHandlers(
      invalidatingHandlers(standingsEventInvalidates, () => calls.push('standings')),
      invalidatingHandlers(leagueDetailEventInvalidates, () => calls.push('detail')),
    )
    expect(Object.keys(merged).sort()).toEqual(['league_weeks', 'team_week_results', 'teams'])
    merged.teams?.()
    expect(calls).toEqual(['standings', 'detail'])
    merged.team_week_results?.()
    expect(calls).toEqual(['standings', 'detail', 'standings'])
    expect(merged.matchups).toBeUndefined()
    expect(merged.leagues).toBeUndefined()
  })

  it('rosters: 072\'s league_rosters carrier + transactions (the drop is a DELETE 072 does not broadcast) + the pool lock summary (119)', () => {
    expect([...ROSTERS_INVALIDATING_EVENTS]).toEqual(['league_rosters', 'transactions', 'league_player_pool'])
    expect(rostersEventInvalidates('matchups')).toBe(false)
    expect(LEAGUE_CHANNEL_EVENTS.filter(rostersEventInvalidates)).toEqual([
      'transactions',
      'league_rosters',
      'league_player_pool',
    ])
  })

  it('schedule: the pairing carriers only — matchups + league_weeks; the league_chat stand-in is GONE (F254(a)/F253(e), 119)', () => {
    expect([...SCHEDULE_INVALIDATING_EVENTS]).toEqual(['matchups', 'league_weeks'])
    expect(scheduleEventInvalidates('league_chat')).toBe(false)
    expect(scheduleEventInvalidates('league_player_pool')).toBe(false)
    expect(LEAGUE_CHANNEL_EVENTS.filter(scheduleEventInvalidates)).toEqual(['matchups', 'league_weeks'])
  })

  it('every predicate is inert for a stranger', () => {
    for (const stranger of ['waiver_claims', 'player_stats', '', 'TRANSACTIONS']) {
      expect(matchupsEventInvalidates(stranger), stranger).toBe(false)
      expect(standingsEventInvalidates(stranger), stranger).toBe(false)
      expect(rostersEventInvalidates(stranger), stranger).toBe(false)
      expect(scheduleEventInvalidates(stranger), stranger).toBe(false)
    }
  })

  it('invalidatingHandlers binds exactly the admitted events, all to the one invalidate', () => {
    const invalidate = vi.fn()
    const handlers = invalidatingHandlers(standingsEventInvalidates, invalidate)
    expect(Object.keys(handlers)).toEqual(['team_week_results', 'league_weeks', 'teams'])
    handlers.team_week_results?.()
    handlers.league_weeks?.()
    handlers.teams?.()
    expect(invalidate).toHaveBeenCalledTimes(3)
  })
})

// ---------------------------------------------------------------------------
// 2. THE DoD PIN — event-driven freshness through the real room
// ---------------------------------------------------------------------------

describe('event-driven freshness (D298): a synthetic scores_updated through the ONE channel refetches', () => {
  it('a `matchups` broadcast for the viewed week invalidates the matchups query — THE DoD\'s cell', async () => {
    // THE BREAK PROBE'S TARGET. Removing `'matchups'` from
    // MATCHUPS_INVALIDATING_EVENTS (dropping the refetch-on-event wiring)
    // leaves this subscriber with no handler for the tick, and `invalidate`
    // is never called.
    const invalidate = vi.fn()
    const release = joinLeagueRoom(LEAGUE, {
      handlers: { current: matchupsHandlers(3, invalidate) },
    })
    await settle()
    registry[0].statusCallback?.('SUBSCRIBED')

    fire('matchups', { operation: 'UPDATE', record: { id: 'm1', week: 3, home_score: 71.5, status: 'live' } })
    expect(invalidate).toHaveBeenCalledTimes(1)

    // Week-scoped: another week's tick through the same channel is inert.
    fire('matchups', { operation: 'UPDATE', record: { id: 'm9', week: 4, home_score: 10, status: 'live' } })
    expect(invalidate).toHaveBeenCalledTimes(1)

    // And an event this build has never heard of reaches nothing — the
    // spine binds only LEAGUE_CHANNEL_EVENTS, so there is no binding to fire.
    fire('waiver_claims', { operation: 'INSERT', record: { week: 3 } })
    expect(registry[0].bindings.has('waiver_claims')).toBe(false)
    expect(invalidate).toHaveBeenCalledTimes(1)

    release()
  })

  it('finalization + the status flip reach the standings map; the scores tick does not', async () => {
    const invalidate = vi.fn()
    const release = joinLeagueRoom(LEAGUE, {
      handlers: { current: invalidatingHandlers(standingsEventInvalidates, invalidate) },
    })
    await settle()
    registry[0].statusCallback?.('SUBSCRIBED')

    fire('matchups', { operation: 'UPDATE', record: { id: 'm1', week: 3 } })
    expect(invalidate).toHaveBeenCalledTimes(0)
    fire('team_week_results', { operation: 'INSERT', record: { team_id: 't1', week: 3, is_final: true } })
    fire('league_weeks', { operation: 'UPDATE', record: { week: 3, status: 'final' } })
    expect(invalidate).toHaveBeenCalledTimes(2)

    release()
  })

  it('a franchise retirement (120 teams) reaches BOTH the standings and the league-detail maps through the merged subscription; a finalization reaches standings only', async () => {
    const standings = vi.fn()
    const detail = vi.fn()
    const release = joinLeagueRoom(LEAGUE, {
      handlers: {
        current: mergeHandlers(
          invalidatingHandlers(standingsEventInvalidates, standings),
          invalidatingHandlers(leagueDetailEventInvalidates, detail),
        ),
      },
    })
    await settle()
    registry[0].statusCallback?.('SUBSCRIBED')
    expect(registry[0].bindings.has('teams')).toBe(true)

    // 120 §4's envelope: the seal statement, one event, the sealed row.
    fire('teams', {
      operation: 'UPDATE',
      record: { count: 1, teams: [{ id: 't1', name: 'RS A', status: 'retired', retired_at_week: 5, successor_team_id: 't5' }] },
    })
    expect(standings).toHaveBeenCalledTimes(1)
    expect(detail).toHaveBeenCalledTimes(1)
    fire('team_week_results', { operation: 'INSERT', record: { team_id: 't1', week: 3, is_final: true } })
    expect(standings).toHaveBeenCalledTimes(2)
    expect(detail).toHaveBeenCalledTimes(1)
    fire('matchups', { operation: 'UPDATE', record: { id: 'm1', week: 3 } })
    expect(standings).toHaveBeenCalledTimes(2)
    expect(detail).toHaveBeenCalledTimes(1)

    release()
  })

  it('a roster write (072, live today) and a transaction reach the rosters map', async () => {
    const invalidate = vi.fn()
    const release = joinLeagueRoom(LEAGUE, {
      handlers: { current: invalidatingHandlers(rostersEventInvalidates, invalidate) },
    })
    await settle()
    registry[0].statusCallback?.('SUBSCRIBED')

    fire('league_rosters', { operation: 'UPDATE', record: { id: 'r1', team_id: 't1', player_id: 'p1', slot_key: 'qb' } })
    fire('transactions', { operation: 'INSERT', record: { id: 'x1', type: 'add_drop' } })
    fire('matchups', { operation: 'UPDATE', record: { id: 'm1', week: 3 } })
    expect(invalidate).toHaveBeenCalledTimes(2)

    release()
  })

  it('three surfaces of one league share ONE channel (F233(a)) and each hears only its own events', async () => {
    const matchups = vi.fn()
    const standings = vi.fn()
    const rosters = vi.fn()
    const releases = [
      joinLeagueRoom(LEAGUE, { handlers: { current: matchupsHandlers(3, matchups) } }),
      joinLeagueRoom(LEAGUE, { handlers: { current: invalidatingHandlers(standingsEventInvalidates, standings) } }),
      joinLeagueRoom(LEAGUE, { handlers: { current: invalidatingHandlers(rostersEventInvalidates, rosters) } }),
    ]
    await settle()
    expect(registry).toHaveLength(1)
    registry[0].statusCallback?.('SUBSCRIBED')

    fire('matchups', { operation: 'UPDATE', record: { id: 'm1', week: 3 } })
    fire('league_rosters', { operation: 'INSERT', record: { id: 'r1' } })
    fire('league_weeks', { operation: 'UPDATE', record: { week: 3, status: 'final' } })
    expect(matchups).toHaveBeenCalledTimes(2) // the tick + the flip
    expect(standings).toHaveBeenCalledTimes(1) // the flip
    expect(rosters).toHaveBeenCalledTimes(1) // the roster write

    for (const release of releases) release()
  })
})

// ---------------------------------------------------------------------------
// 3. Source pins on the four hooks
// ---------------------------------------------------------------------------

describe('the three subscriber hooks JOIN the spine with a DERIVED map and open no channel (F233(a)/R773)', () => {
  it('use-matchups hands matchupsHandlers(week, invalidate) to useLeagueChannel', () => {
    const source = code(MATCHUPS)
    expect(source).toContain("import { useLeagueChannel } from './use-league-channel'")
    expect(source).toContain("import { matchupsHandlers, matchupsInvalidationKeys } from './use-matchups-ops'")
    expect(source).toMatch(/useLeagueChannel\(\s*leagueId,\s*matchupsHandlers\(week \?\? 0, invalidate\),/)
    expect(source).not.toContain('.channel(')
  })

  it('use-standings hands the MERGED standings + league-detail maps, use-rosters invalidatingHandlers(<predicate>, invalidate), to useLeagueChannel', () => {
    const standings = code(STANDINGS)
    // 120 / R856: one subscription, two derived maps — standings on its
    // predicate, the league detail (`leaguesKeys.detail`) on `teams` only.
    expect(standings).toMatch(
      /useLeagueChannel\(\s*leagueId,\s*mergeHandlers\(\s*invalidatingHandlers\(standingsEventInvalidates, invalidate\),\s*invalidatingHandlers\(leagueDetailEventInvalidates, invalidateDetail\),\s*\),/,
    )
    expect(standings).toContain('queryKey: leaguesKeys.detail(leagueId)')
    expect(standings).not.toContain('.channel(')
    const rosters = code(ROSTERS)
    expect(rosters).toMatch(
      /useLeagueChannel\(\s*leagueId,\s*invalidatingHandlers\(rostersEventInvalidates, invalidate\),/,
    )
    expect(rosters).not.toContain('.channel(')
  })

  it('each refetches on EVERY confirmed (re)join and FIRST on a drop (§9.3)', () => {
    for (const rel of [MATCHUPS, STANDINGS, ROSTERS]) {
      expect(code(rel), rel).toContain('{ onJoin: invalidate, onDrop: invalidate }')
    }
  })

  it('each refetches rather than patching a column-selected payload — no setQueryData from an event', () => {
    for (const rel of [MATCHUPS, STANDINGS, ROSTERS]) {
      expect(code(rel), rel).toContain('invalidateQueries')
      expect(code(rel), rel).not.toContain('setQueryData')
    }
  })
})

describe('the lineup hook: one action_id per submit, never optimistic, reads the server\'s answer (§11.2/F224(e))', () => {
  const source = code(LINEUP)

  it('mints the action_id in the VARIABLES per submit — a retry replays, a second tap is a new submit', () => {
    expect(source).toContain('action_id: crypto.randomUUID(),')
    expect(source).toMatch(/submit: \(input: SetLineupInput\) => mutation\.mutate\(variables\(input\)\)/)
    expect(source).toMatch(/submitAsync: \(input: SetLineupInput\) => mutation\.mutateAsync\(variables\(input\)\)/)
  })

  it('has no optimistic arm — no onMutate, no setQueryData, no cancelQueries', () => {
    expect(source).not.toContain('onMutate')
    expect(source).not.toContain('setQueryData')
    expect(source).not.toContain('cancelQueries')
  })

  it('on success AND on a refusal it RE-READS the row and the rosters (the set wrote league_rosters.slot_key; a refusal means the view was stale — R822(i))', () => {
    // The behavioural pin (a REAL client driven through MutationObserver,
    // negative controls, the probe of the round) is `use-lineup-
    // invalidation.test.ts`; this keeps the shape visible at the source.
    expect(source).toContain('queryClient.invalidateQueries({ queryKey: teamLineupKeys.week(teamId, week) })')
    expect(source).toContain('queryClient.invalidateQueries({ queryKey: leagueRosterKeys.all(leagueId) })')
    expect(source).toContain('onSuccess: (_result, variables) => reread(variables.week)')
    expect(source).toContain('onError: (_error, variables) => reread(variables.week)')
  })

  it('sends the map WHOLE — slot_map is forwarded, never filtered, filled or reordered', () => {
    expect(source).toContain('slot_map: input.slotMap,')
    expect(source).not.toMatch(/Object\.(entries|keys|fromEntries)\(input\.slotMap/)
  })

  it('the read is the member-truth SELECT of team_lineups with a loud transport error and a null missing row', () => {
    expect(source).toContain(".from('team_lineups')")
    expect(source).toContain('.maybeSingle()')
    expect(source).toContain('if (error) throw error')
    expect(source).toContain('if (!data) return null')
  })
})

describe('F233(b): useAddDrop now invalidates the rosters key L.D4.1 named', () => {
  it('use-transactions imports leagueRosterKeys from use-rosters and invalidates it on success', () => {
    const source = code(TRANSACTIONS)
    expect(source).toContain("import { leagueRosterKeys } from './use-rosters'")
    expect(source).toContain('queryClient.invalidateQueries({ queryKey: leagueRosterKeys.all(leagueId) })')
  })
})
