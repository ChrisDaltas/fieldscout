/**
 * use-commish-log-invalidation.test.ts — L.E1.32 R1360: the five commissioner
 * mutation hooks that write a §10.3 receipt but did not re-read the audit log
 * (score, result, lineup, move player, force add / drop) now invalidate
 * `commishLogKeys.all` on success AND on error — which reaches League Home's
 * commissioner section (`commishLogKeys.list`) and the console's "needs you"
 * read (`commishSummaryKeys.one`, under the same root). One cell per hook,
 * driven through a real `QueryClient` + `MutationObserver` over the hook's own
 * options (the `use-commish-overrides-invalidation.test.ts` posture), with
 * another league's keys as the negative control.
 */
import { MutationObserver, QueryClient, type UseMutationOptions } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { commishLogKeys } from './use-commish-log'
import { commishEditLineupMutationOptions } from './use-commish-lineup'
import { commishMovePlayerMutationOptions } from './use-commish-move-player'
import { commishSetResultMutationOptions } from './use-commish-result'
import { commishForceAddDropMutationOptions } from './use-commish-roster'
import { commishEditScoreMutationOptions } from './use-commish-score'
import { commishSummaryKeys } from './use-commish-summary'

const LEAGUE = 'c3200000-0000-4000-8000-000000000301'
const OTHER_LEAGUE = 'c3200000-0000-4000-8000-000000000302'
const TEAM_A = 'c3200000-0000-4000-8000-000000000401'
const TEAM_B = 'c3200000-0000-4000-8000-000000000402'
const MATCHUP = 'c3200000-0000-4000-8000-000000000501'
const ACTION = 'c3200000-0000-4000-8000-000000000601'

function stubFetch(ok: boolean) {
  vi.stubGlobal('fetch', () =>
    Promise.resolve({
      ok,
      status: ok ? 200 : 409,
      json: () => Promise.resolve(ok ? { action_id: ACTION } : { error: 'refused by name' }),
    } as unknown as Response),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function seededClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  for (const league of [LEAGUE, OTHER_LEAGUE]) {
    client.setQueryData(commishLogKeys.list(league, { limit: 8 }), { pages: [], pageParams: [] })
    client.setQueryData(commishSummaryKeys.one(league), { seeded: true })
  }
  return client
}

const invalidated = (client: QueryClient, key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated

type Options = (client: QueryClient, leagueId: string) => UseMutationOptions<unknown, Error, unknown>

const HOOKS: Array<[string, Options, unknown]> = [
  ['useCommishEditScore', commishEditScoreMutationOptions as unknown as Options, { matchup_id: MATCHUP, home_score: 98.4, away_score: 97.1, action_id: ACTION, week: 3 }],
  ['useCommishSetResult', commishSetResultMutationOptions as unknown as Options, { matchup_id: MATCHUP, winner_team_id: TEAM_A, action_id: ACTION, week: 3 }],
  ['useCommishEditLineup', commishEditLineupMutationOptions as unknown as Options, { team_id: TEAM_A, week: 3, slot_map: {}, action_id: ACTION }],
  ['useCommishMovePlayer', commishMovePlayerMutationOptions as unknown as Options, { player_id: 'p1', from_team_id: TEAM_A, to_team_id: TEAM_B, action_id: ACTION }],
  ['useCommishForceAddDrop', commishForceAddDropMutationOptions as unknown as Options, { team_id: TEAM_A, add_player_id: 'p1', action_id: ACTION }],
]

describe('R1360 — every receipt-writing commissioner hook re-reads the audit log’s root on BOTH answers', () => {
  for (const [name, options, variables] of HOOKS) {
    it(`${name}: the log and the "needs you" read are invalidated on a 200 and on a refusal — this league only`, async () => {
      for (const ok of [true, false]) {
        const client = seededClient()
        stubFetch(ok)
        const observer = new MutationObserver(client, options(client, LEAGUE))
        await observer.mutate(variables).catch(() => undefined)
        expect(invalidated(client, commishLogKeys.list(LEAGUE, { limit: 8 })), `${name} ok=${ok} log`).toBe(true)
        expect(invalidated(client, commishSummaryKeys.one(LEAGUE)), `${name} ok=${ok} summary`).toBe(true)
        expect(invalidated(client, commishLogKeys.list(OTHER_LEAGUE, { limit: 8 })), `${name} ok=${ok} other league`).toBe(false)
        expect(invalidated(client, commishSummaryKeys.one(OTHER_LEAGUE)), `${name} ok=${ok} other summary`).toBe(false)
      }
    })
  }
})
