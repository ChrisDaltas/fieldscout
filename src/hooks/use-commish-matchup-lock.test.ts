/**
 * use-commish-matchup-lock.test.ts — M6A L.E1.18 (Q61, migration 135): the
 * panel's lock read lives UNDER the week's matchup key, so everything that
 * re-reads the week — the `scores_updated` refetch (`matchupsInvalidationKeys`)
 * and both override hooks' success-AND-error invalidation (R822(i)) —
 * re-reads it too. Driven through a REAL `QueryClient`; negative controls
 * (another week, another league) so a blanket invalidation cannot pass.
 */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { COMMISH_MATCHUP_LOCK_REPOLL_MS, commishMatchupLockKeys } from './use-commish-matchup-lock'
import { leagueMatchupKeys } from './use-matchups'
import { matchupsInvalidationKeys } from './use-matchups-ops'

const LEAGUE = '3f2b1c4d-0000-4000-8000-000000000301'
const OTHER_LEAGUE = '3f2b1c4d-0000-4000-8000-000000000302'
const MATCHUP = '3f2b1c4d-0000-4000-8000-000000000501'

function seeded() {
  const qc = new QueryClient()
  const doc = { editable: false, message: 'still playing' }
  qc.setQueryData(commishMatchupLockKeys.one(LEAGUE, 3, MATCHUP), doc)
  qc.setQueryData(commishMatchupLockKeys.one(LEAGUE, 4, MATCHUP), doc)
  qc.setQueryData(commishMatchupLockKeys.one(OTHER_LEAGUE, 3, MATCHUP), doc)
  const stale = (league: string, week: number) =>
    qc.getQueryState(commishMatchupLockKeys.one(league, week, MATCHUP))?.isInvalidated
  return { qc, stale }
}

describe('the lock read’s key rides the week’s matchup key', () => {
  it('invalidating the WEEK (what the override hooks do on a 200 and on a 4xx) re-reads the lock — and only that week’s, only that league’s', async () => {
    const { qc, stale } = seeded()
    await qc.invalidateQueries({ queryKey: leagueMatchupKeys.week(LEAGUE, 3) })
    expect(stale(LEAGUE, 3)).toBe(true)
    expect(stale(LEAGUE, 4)).toBe(false)
    expect(stale(OTHER_LEAGUE, 3)).toBe(false)
  })

  it('the `scores_updated` refetch keys (matchupsInvalidationKeys) reach it too', async () => {
    const { qc, stale } = seeded()
    for (const queryKey of matchupsInvalidationKeys(LEAGUE, 3)) await qc.invalidateQueries({ queryKey })
    expect(stale(LEAGUE, 3)).toBe(true)
    expect(stale(LEAGUE, 4)).toBe(false)
  })

  it('a "not yet" answer re-polls once a minute (games end on their own clock)', () => {
    expect(COMMISH_MATCHUP_LOCK_REPOLL_MS).toBe(60_000)
  })
})
