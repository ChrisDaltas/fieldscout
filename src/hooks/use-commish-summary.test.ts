/**
 * The L.E1.32 hooks' pure contract (D455): `useCommishLog`'s query string
 * with the new filters, its infinite-query key (filters in the key, the
 * cursor NOT — it is the page param) and its next-page rule (the server's
 * `has_more`); `useCommishSummary`'s key under the log's root, so every
 * commissioner mutation hook's existing `commishLogKeys.all` invalidation
 * re-reads what needs him.
 */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import type { CommishLogPage } from '@/lib/leagues/api/commish-log-service'

import { commishLogKeys, commishLogNextCursor, commishLogSearchParams } from './use-commish-log'
import { COMMISH_SUMMARY_REPOLL_MS, commishSummaryKeys, commishSummaryRefetchInterval } from './use-commish-summary'

const LEAGUE = 'c3200000-0000-4000-8000-000000000001'
const OTHER = 'c3200000-0000-4000-8000-000000000002'
const TEAM = 'c1180051-0000-4000-8000-000000000002'

describe('useCommishLog — the filters on the wire', () => {
  it('sends only what is SET, the type list comma-joined, the cursor as the page param', () => {
    expect(commishLogSearchParams({})).toBe('')
    expect(commishLogSearchParams({ type: [] })).toBe('')
    expect(commishLogSearchParams({ type: ['edit_score', 'set_result'] })).toBe('?type=edit_score%2Cset_result')
    expect(commishLogSearchParams({ team_id: TEAM })).toBe(`?team_id=${TEAM}`)
    expect(commishLogSearchParams({ week: 5 })).toBe('?week=5')
    expect(commishLogSearchParams({ limit: 20, cursor: 'tok', type: ['edit_lineup'], team_id: TEAM, week: 3 })).toBe(
      `?limit=20&cursor=tok&type=edit_lineup&team_id=${TEAM}&week=3`,
    )
  })

  it('the key carries the filters (a filter change is a fresh log) and never the cursor; it is a child of `all`', () => {
    const a = commishLogKeys.list(LEAGUE, { limit: 50, type: ['edit_score'], team_id: TEAM, week: 5 })
    expect(a.slice(0, 2)).toStrictEqual([...commishLogKeys.all(LEAGUE)])
    expect(a).not.toStrictEqual(commishLogKeys.list(LEAGUE, { limit: 50, type: ['edit_score'], team_id: TEAM, week: 6 }))
    expect(commishLogKeys.list(LEAGUE, { type: [] })).toStrictEqual(commishLogKeys.list(LEAGUE, {}))
    expect(JSON.stringify(a)).not.toContain('cursor')
  })

  it('the next page is asked for only while the server says there is more', () => {
    const page = (has_more: boolean, next_cursor: string | null): CommishLogPage => ({
      items: [],
      limit: 50,
      filters: { type: null, team_id: null, week: null },
      has_more,
      next_cursor,
    })
    expect(commishLogNextCursor(page(true, 'tok'))).toBe('tok')
    expect(commishLogNextCursor(page(false, null))).toBeUndefined()
    expect(commishLogNextCursor(page(true, null))).toBeUndefined()
  })
})

describe('useCommishSummary — the poll (R1363)', () => {
  it('re-polls each minute while it answers and stops once refused (a manager’s 403 is not asked again)', () => {
    expect(commishSummaryRefetchInterval({ state: { error: null } })).toBe(COMMISH_SUMMARY_REPOLL_MS)
    expect(COMMISH_SUMMARY_REPOLL_MS).toBe(60_000)
    expect(commishSummaryRefetchInterval({ state: { error: new LeagueActionError(403, 'Only this league’s commissioner…') } })).toBe(false)
  })

  it('R1375: any failure that is NOT a refusal keeps polling — a blip or a 500 heals on its own', () => {
    expect(commishSummaryRefetchInterval({ state: { error: new LeagueActionError(500, 'boom') } })).toBe(COMMISH_SUMMARY_REPOLL_MS)
    expect(commishSummaryRefetchInterval({ state: { error: new LeagueActionError(503, 'unavailable') } })).toBe(COMMISH_SUMMARY_REPOLL_MS)
    expect(commishSummaryRefetchInterval({ state: { error: new TypeError('Failed to fetch') } })).toBe(COMMISH_SUMMARY_REPOLL_MS)
  })
})

describe('useCommishSummary — re-read by every commissioner mutation', () => {
  it('its key sits under the log’s root, so the invalidation every commissioner hook already makes reaches it — and only this league’s', async () => {
    const client = new QueryClient()
    client.setQueryData(commishSummaryKeys.one(LEAGUE), { seeded: true })
    client.setQueryData(commishSummaryKeys.one(OTHER), { seeded: true })
    await client.invalidateQueries({ queryKey: commishLogKeys.all(LEAGUE) })
    expect(client.getQueryState(commishSummaryKeys.one(LEAGUE))?.isInvalidated).toBe(true)
    expect(client.getQueryState(commishSummaryKeys.one(OTHER))?.isInvalidated).toBe(false)
  })
})
