/**
 * activity-page-ops.test.ts — the Activity page's one spelling of its URLs and
 * the parse back (M6 L.E1.34; PROGRESS D459): every door into the page — a ✸
 * badge, a ✸ feed line, "See all activity", the console's "See all", the
 * matchup's correction note — builds its link here, and the page reads the
 * same shape back.
 */
import { describe, expect, it } from 'vitest'

import * as ops from './activity-page-ops'
import {
  ACTIVITY_TABS,
  ACTIVITY_TAB_LABELS,
  activityHref,
  activityRouteFrom,
  commishEntryHref,
  commishMatchupHref,
  commishTeamHref,
  parseActivityRoute,
} from './activity-page-ops'

const L = 'league-1'
const TEAM = 'aaaaaaaa-0000-4000-8000-000000000001'
const ENTRY = 'ca340000-0000-4000-8000-000000000034'

describe('the tabs', () => {
  it('All · Adds & drops · Trades · Commissioner · Stat corrections — in that order (the task’s)', () => {
    expect(ACTIVITY_TABS.map((t) => ACTIVITY_TAB_LABELS[t])).toStrictEqual(['All', 'Adds & drops', 'Trades', 'Commissioner', 'Stat corrections'])
  })
})

describe('activityHref — only what the tab reads reaches the URL', () => {
  it('All is the bare page', () => {
    expect(activityHref(L)).toBe('/app/leagues/league-1/activity')
    expect(activityHref(L, { tab: 'all', week: 3, team: TEAM })).toBe('/app/leagues/league-1/activity')
  })
  it('the commissioner log carries its team, week and entry; the corrections tab its week only', () => {
    expect(activityHref(L, { tab: 'commissioner', week: 4, team: TEAM, entry: ENTRY })).toBe(`/app/leagues/league-1/activity?tab=commissioner&week=4&team=${TEAM}&entry=${ENTRY}`)
    expect(activityHref(L, { tab: 'corrections', week: 2, team: TEAM })).toBe('/app/leagues/league-1/activity?tab=corrections&week=2')
    expect(activityHref(L, { tab: 'trades', week: 2 })).toBe('/app/leagues/league-1/activity?tab=trades')
  })
  it('the ✸ doors', () => {
    expect(commishEntryHref(L, ENTRY)).toBe(`/app/leagues/league-1/activity?tab=commissioner&entry=${ENTRY}`)
    expect(commishMatchupHref(L, 5, TEAM)).toBe(`/app/leagues/league-1/activity?tab=commissioner&week=5&team=${TEAM}`)
    expect(commishMatchupHref(L, null, null)).toBe('/app/leagues/league-1/activity?tab=commissioner')
    // A roster's ✸ names the team only — a roster move records no week (F534).
    expect(commishTeamHref(L, TEAM)).toBe(`/app/leagues/league-1/activity?tab=commissioner&team=${TEAM}`)
  })
})

describe('parseActivityRoute — the URL back into state; a malformed link opens All, never an error', () => {
  it('round-trips every door', () => {
    const route = { tab: 'commissioner', week: 4, team: TEAM, entry: ENTRY } as const
    const query = Object.fromEntries(new URL(`https://x${activityHref(L, route)}`).searchParams)
    expect(parseActivityRoute(query)).toStrictEqual(route)
    expect(parseActivityRoute({ tab: 'corrections', week: '7' })).toStrictEqual({ tab: 'corrections', week: 7, team: null, entry: null })
  })
  it('drops what is malformed or not the tab’s', () => {
    expect(parseActivityRoute({})).toStrictEqual({ tab: 'all', week: null, team: null, entry: null })
    expect(parseActivityRoute({ tab: 'nope', week: '3' })).toStrictEqual({ tab: 'all', week: null, team: null, entry: null })
    expect(parseActivityRoute({ tab: 'commissioner', week: '19', team: 'not-a-team', entry: 'x' })).toStrictEqual({ tab: 'commissioner', week: null, team: null, entry: null })
    expect(parseActivityRoute({ tab: 'commissioner', team: TEAM.toUpperCase() }).team).toBe(TEAM)
    expect(parseActivityRoute({ tab: 'trades', team: TEAM }).team).toBeNull()
  })
})

describe('copy', () => {
  it('no ledger code and no snake_case in any exported string (F277(a), TD12)', () => {
    const strings = Object.entries(ops).flatMap(([name, value]) =>
      typeof value === 'string' ? [[name, value]] : value && typeof value === 'object' && !Array.isArray(value) ? Object.values(value).filter((v): v is string => typeof v === 'string').map((v) => [name, v]) : [],
    )
    expect(strings.length).toBeGreaterThan(15)
    for (const [name, value] of strings) {
      expect(value, name).not.toMatch(/\b[QEFDR]\d+\b/)
      expect(value, name).not.toMatch(/\b[a-z]+_[a-z_]+\b/)
    }
  })
  it('the Trades tab says what Q84 ruled: offers stay between the two teams', () => {
    expect(ops.TAB_INTRO_COPY.trades).toContain('went through, were vetoed or were reversed')
    expect(ops.TAB_INTRO_COPY.trades).toContain('Offers stay between the two teams')
  })
  it('F534: the week filter says in words what it shows and what it does not', () => {
    expect(ops.COMMISH_WEEK_NOTE).toContain('lineups, scores, results')
    expect(ops.COMMISH_WEEK_NOTE).toContain('Trades, roster moves, settings and member changes aren’t tied to a week')
  })
})

describe('activityRouteFrom — R1392: the URL is the state', () => {
  const fallback = { tab: 'trades', week: null, team: null, entry: null } as const
  it('the search params win over the first render’s route; no params to read ⇒ the server’s parse', () => {
    expect(activityRouteFrom(new URLSearchParams(`tab=commissioner&entry=${ENTRY}`), fallback)).toStrictEqual({ tab: 'commissioner', week: null, team: null, entry: ENTRY })
    expect(activityRouteFrom(new URLSearchParams(''), fallback)).toStrictEqual({ tab: 'all', week: null, team: null, entry: null })
    expect(activityRouteFrom(null, fallback)).toBe(fallback)
  })
})
