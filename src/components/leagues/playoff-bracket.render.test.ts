/**
 * playoff-bracket.render.test.ts — L.D5.5's states checklist + the bracket
 * shapes as REAL static renders (spec §16.5.4 "required states per data
 * surface"; §16.2 `playoff-bracket`; §16.1's standings page "Playoffs" tab
 * ALL SEASON — v2.16.25 / Q39 (E); §16.5.1's `playoffs` hero row; CLAUDE.md's
 * elevation rule; PROGRESS D326).
 *
 * The `standings-schedule.render.test.ts` rig: `renderToStaticMarkup` over
 * the actual components with the React Query cache pre-seeded (fetches are
 * effects and effects do not run in a static render, so the cache IS the
 * data); `useAuth` mocked at the module edge. The standings page is
 * rendered with `initialTab: 'playoffs'` so Radix mounts the bracket
 * panel; the league home is rendered in the `playoffs` status so the hero
 * embeds the same component.
 *
 * Probes of the PR: (1) render the rollover through a fixed zone or as
 * "midnight" → the ops fixture (`playoff-bracket-ops.test.ts`) and the
 * no-midnight cells here; (2) remove an error branch → the error-with-retry
 * cells; (3) a resting `shadow-hard-*` in a feature file → the elevation
 * pin; (4) show a door to a manager → the commissioner cells.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { leagueActivityKeys } from '@/hooks/use-league-activity'
import type { LeagueDetail } from '@/hooks/use-league'
import { leaguesKeys } from '@/hooks/use-leagues'
import { leagueMatchupKeys } from '@/hooks/use-matchups'
import { playoffBracketKeys } from '@/hooks/use-playoff-bracket'
import { scheduleKeys, type LeagueSchedule } from '@/hooks/use-schedule'
import { leagueStandingsKeys } from '@/hooks/use-standings'
import { statsDegradedKeys } from '@/hooks/use-stats-degraded'
import type { ActivityFeed } from '@/lib/leagues/api/activity-service'
import type { WeekMatchups } from '@/lib/leagues/api/matchups-service'
import type { PlayoffBracket } from '@/lib/leagues/api/playoffs-service'
import type { LeagueStandings } from '@/lib/leagues/api/standings-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'
import type { LiveScoringFlags } from '@/lib/sync/ingest-flags'

import { LeagueHomeStates } from './league-home-states'
import {
  AWAITING_BUILD_COPY,
  COMMISH_DOOR_PENDING_COPY,
  NO_PLAYOFFS_COPY,
  POINTS_RACE_COPY,
  PROJECTED_TITLE,
  SEEDED_BEFORE_CORRECTION_COPY,
} from './playoff-bracket-ops'
import {
  AWAITING_BUILD_DOC,
  BRACKET_NAMES,
  BUILT_DOC,
  BUILT_UNPLAYED_DOC,
  COMPLETE_DOC,
  FOREIGN_ROWS_DOC,
  NO_PLAYOFFS_COMPLETE_DOC,
  POINTS_RACE_DOC,
  PROJECTED_DOC,
  PROJECTED_UNSEEDABLE_DOC,
  T,
  UNRECORDED_ROLLOVER_DOC,
} from './playoff-bracket.fixtures'
import { StandingsPage } from './standings-page'
import { GOLDEN_STANDINGS } from './standings-schedule.fixtures'
import { PROJECTED_COPY } from './standings-table-ops'
import { STALE_LEAGUE_COPY } from './status-banners'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-commish' }, profile: { username: 'chris' } }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: vi.fn(() => ({ connection: 'live' })),
}))

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

const LEAGUE = 'league-1'
const settings = { ...defaultsForTeamCount(8), regular_season_weeks: 14, draft: { ...defaultsForTeamCount(8).draft, time_zone: 'America/Los_Angeles' } }

function detailWith(over: Partial<LeagueDetail['league']> = {}, role: string | null = 'commissioner'): LeagueDetail {
  return {
    league: {
      id: LEAGUE,
      name: 'Render League',
      avatar_url: null,
      description: null,
      season: 2099,
      status: 'in_season',
      owner_id: 'user-commish',
      scoring_system_id: null,
      invite_code: null,
      invite_slug: null,
      max_teams: 8,
      created_at: null,
      updated_at: null,
      champion_team_id: null,
      ...over,
    },
    settings,
    members: [
      { id: 'm1', user_id: 'user-commish', team_id: T.charlie, role: 'commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
      { id: 'm2', user_id: 'user-manager', team_id: T.bravo, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
    ],
    teams: [...BRACKET_NAMES.entries()].map(([id, name]) => ({ id, name, owner_id: 'user-commish', status: 'active', created_at: null })),
    my_role: role,
    active_draft: null,
  }
}

/** 117's final standings in the bracket's seed order (Alpha … Foxtrot). */
const FINAL_STANDINGS: LeagueStandings = {
  ...GOLDEN_STANDINGS,
  standings: [...BRACKET_NAMES.entries()].map(([team_id, name], i) => ({ ...GOLDEN_STANDINGS.standings[0], rank: i + 1, team_id, name })),
}

function failQuery(client: QueryClient, queryKey: readonly unknown[], error: Error, data?: unknown) {
  const query = client.getQueryCache().build(client, { queryKey })
  if (data !== undefined) query.setData(data)
  query.setState({ status: 'error', error, fetchStatus: 'idle' })
}

function unescapeHtml(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
}

function render(qc: QueryClient, element: React.ReactElement): string {
  return unescapeHtml(renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, element)))
}

interface Seed {
  detail?: LeagueDetail
  bracket?: PlayoffBracket | 'error' | 'degraded' | 'missing'
  standings?: LeagueStandings | 'missing'
  projected?: LeagueStandings
}

function seedBracket(qc: QueryClient, seed: Seed) {
  qc.setQueryData(leaguesKeys.detail(LEAGUE), seed.detail ?? detailWith())
  const s = seed.standings ?? FINAL_STANDINGS
  if (s !== 'missing') qc.setQueryData(leagueStandingsKeys.all(LEAGUE), s)
  if (seed.projected) qc.setQueryData(leagueStandingsKeys.projected(LEAGUE), seed.projected)
  const b = seed.bracket ?? PROJECTED_DOC
  if (b === 'error') failQuery(qc, playoffBracketKeys.all(LEAGUE), new Error('Only members of this league can view it.'))
  else if (b === 'degraded') failQuery(qc, playoffBracketKeys.all(LEAGUE), new Error('bracket: refetch boom'), BUILT_DOC)
  else if (b !== 'missing') qc.setQueryData(playoffBracketKeys.all(LEAGUE), b)
}

function renderTab(seed: Seed = {}, tab: 'standings' | 'playoffs' = 'playoffs'): string {
  const qc = client()
  seedBracket(qc, seed)
  return render(qc, createElement(StandingsPage, { leagueId: LEAGUE, initialTab: tab }))
}

/** The slice between two markers, for per-round / per-game assertions. */
function between(html: string, from: string, to: string): string {
  const start = html.indexOf(from)
  expect(start, from).toBeGreaterThan(-1)
  const end = html.indexOf(to, start + 1)
  return html.slice(start, end === -1 ? undefined : end)
}

/** The whole element that carries `marker` — from its opening `<` to the
 *  closing tag named — so attributes written BEFORE the marker are in the slice. */
function elementOf(html: string, marker: string, close: string): string {
  const at = html.indexOf(marker)
  expect(at, marker).toBeGreaterThan(-1)
  const start = html.lastIndexOf('<', at)
  const end = html.indexOf(close, at)
  return html.slice(start, end === -1 ? undefined : end)
}

/** The team line (`data-team-line`) that names `team`, within `scope`. */
function teamLine(scope: string, team: string): string {
  const at = scope.indexOf(team)
  expect(at, team).toBeGreaterThan(-1)
  const start = scope.lastIndexOf('data-team-line', at)
  return scope.slice(scope.lastIndexOf('<', start), at)
}

// ---------------------------------------------------------------------------
// The Playoffs tab — §16.5.4's four states
// ---------------------------------------------------------------------------

describe('the Playoffs tab — the four required states (§16.5.4)', () => {
  it('the ONE Tabs control carries both panels; `?tab=playoffs` opens the bracket panel, the default opens the table', () => {
    const playoffs = renderTab()
    expect(playoffs).toContain('data-standings-tabs')
    expect(playoffs).toContain('data-tab="standings"')
    expect(playoffs).toContain('data-tab="playoffs"')
    expect(playoffs).toContain('data-tab-panel="playoffs"')
    expect(playoffs).toContain('data-playoff-bracket="projected"')
    const standings = renderTab({}, 'standings')
    expect(standings).toContain('data-tab-panel="standings"')
    expect(standings).not.toContain('data-playoff-bracket')
  })

  it('skeleton while the bracket loads (the page chrome is up)', () => {
    const html = renderTab({ bracket: 'missing' })
    expect(html).toContain('data-skeleton="playoff-bracket"')
    expect(html).toContain('data-standings-tabs')
    expect(html).not.toContain('data-playoff-bracket')
  })

  it('error-with-retry when the bracket read fails with nothing to show — the family’s 403 copy', () => {
    const html = renderTab({ bracket: 'error' })
    expect(html).toContain('Couldn’t load the bracket.')
    expect(html).toContain('Only members of this league can view it.')
    expect(html).toContain('Retry')
    expect(html).toContain('role="alert"')
    expect(html).not.toContain('data-playoff-bracket')
  })

  it('degraded: a failed refetch keeps the last-good bracket behind the banner', () => {
    const html = renderTab({ bracket: 'degraded' })
    expect(html).toContain(STALE_LEAGUE_COPY)
    expect(html).toContain('data-playoff-bracket="bracket"')
    expect(html).not.toContain('Couldn’t load the bracket.')
  })
})

// ---------------------------------------------------------------------------
// The shapes — 118's document, rendered
// ---------------------------------------------------------------------------

describe('ALL SEASON: the projected bracket — "if the playoffs started today" (Q39 (E))', () => {
  it('round 1 from `projected_round_1` — byes first, then the pairings outside-in — later rounds TBD (F256(c)); the basis named', () => {
    const html = renderTab()
    expect(html).toContain(PROJECTED_TITLE)
    expect(html).toContain('data-bracket-badge="projected"')
    expect(html).toContain('Based on 8 weeks final and 1 projected as if it ended now.')
    const r1 = between(html, 'data-round="Quarterfinals"', 'data-round="Semifinals"')
    expect(r1.match(/data-game="projected"/g)).toHaveLength(4)
    expect(r1.match(/data-bye/g)).toHaveLength(2)
    expect(r1.indexOf('Alpha')).toBeLessThan(r1.indexOf('Bravo'))
    expect(r1.indexOf('Bravo')).toBeLessThan(r1.indexOf('Charlie'))
    // Charlie(3) v Foxtrot(6), then Delta(4) v Echo(5) — the engine's order, painted as given.
    expect(r1.indexOf('Charlie')).toBeLessThan(r1.indexOf('Foxtrot'))
    expect(r1.indexOf('Foxtrot')).toBeLessThan(r1.indexOf('Delta'))
    expect(r1.indexOf('Delta')).toBeLessThan(r1.indexOf('Echo'))
    expect(between(html, 'data-round="Semifinals"', 'data-round="Championship"').match(/data-game="tbd"/g)).toHaveLength(2)
    expect(between(html, 'data-round="Championship"', 'data-commish-doors').match(/data-game="tbd"/g)).toHaveLength(1)
    // The viewer's own franchise (Charlie — the commissioner's seat) is marked.
    expect(between(r1, 'Charlie', 'Foxtrot')).toContain('>You<')
    expect(html).toContain('6</span> teams')
    expect(html).toContain('8</span>-team bracket')
  })

  it('a table that cannot fill the bracket renders the seeded count and TBD slots — never an invented pairing', () => {
    const html = renderTab({ bracket: PROJECTED_UNSEEDABLE_DOC })
    expect(html).toContain('Only 3 of 6 seats can be seeded yet')
    expect(html).not.toContain('data-game="projected"')
    expect(between(html, 'data-round="Quarterfinals"', 'data-round="Semifinals"').match(/data-game="tbd"/g)).toHaveLength(4)
  })

  it('the rollover is ONE stored instant rendered in the VIEWER’S zone with the league zone on hover — never "midnight"', () => {
    const html = renderTab()
    const line = elementOf(html, 'data-rollover-line="rollover"', '</p>')
    expect(line).toContain('data-rollover="instant"')
    // The viewer's rendering (this process's zone) carries a clock time; the
    // hover carries the league's (Los Angeles: the instant IS midnight there).
    expect(line).toMatch(/Tue, Dec 1[45], \d{1,2}:\d\d [AP]M/)
    expect(line).toContain('title="Tue, Dec 15, 2099 · 12:00 AM PST (league time)"')
    expect(line).toContain('(your time; league time on hover)')
    expect(html).not.toMatch(/midnight/i)
  })

  it('an unrecorded rollover names the EVENT — "When Week 14’s last game ends" — with no clock and no hover', () => {
    const html = renderTab({ bracket: UNRECORDED_ROLLOVER_DOC })
    const line = elementOf(html, 'data-rollover-line="rollover"', '</p>')
    expect(line).toContain('data-rollover="event"')
    expect(line).toContain('When Week 14’s last game ends')
    expect(line).not.toContain('title=')
    expect(line).not.toMatch(/\d:\d\d|\b(AM|PM)\b|midnight/i)
  })

  it('the regular season rolled with nothing written: the honest awaiting copy; a foreign row is COUNTED (D318(5))', () => {
    const waiting = renderTab({ bracket: AWAITING_BUILD_DOC })
    expect(waiting).toContain('data-playoff-bracket="awaiting_build"')
    expect(waiting).toContain(AWAITING_BUILD_COPY)
    expect(waiting).not.toContain('data-foreign-rows')
    const foreign = renderTab({ bracket: FOREIGN_ROWS_DOC })
    expect(foreign).toContain('data-foreign-rows')
    expect(foreign).toContain('1 playoff pairing on record was not written by the engine')
  })
})

describe('once built: the stored rounds — seeds, byes, per-week rows, the two-week totals, decided_by, final (Q39 (A)/(B))', () => {
  it('round 1 FINAL: two byes, a points verdict, and the tie that advances the higher seed with its result left a tie', () => {
    const html = renderTab({ bracket: BUILT_DOC })
    expect(html).toContain('data-playoff-bracket="bracket"')
    const r1 = between(html, 'data-round="1"', 'data-round="2"')
    expect(r1).toContain('data-round-badge="final"')
    expect(r1).toContain('Seeded from final results')
    expect(r1.match(/data-game="bye"/g)).toHaveLength(2)
    const charlie = between(r1, 'data-game="points"', 'data-game="higher_seed"')
    expect(charlie).toContain('101.25')
    expect(charlie).toContain('98.10')
    expect(charlie).toContain('Advances on points')
    // The winner is a FILL (state), never a shadow.
    expect(teamLine(charlie, 'Charlie')).toContain('bg-accent-soft')
    expect(teamLine(charlie, 'Foxtrot')).not.toContain('bg-accent-soft')
    const tie = between(r1, 'data-game="higher_seed"', 'data-round="2"')
    expect(tie).toContain('90.00')
    expect(tie).toContain('Tied — higher seed advances')
    expect(teamLine(tie, 'Delta')).toContain('data-winner')
    expect(teamLine(tie, 'Echo')).not.toContain('data-winner')
  })

  it('round 2 LIVE: a pending score is the door’s word (E61), never 0.00; the ✸ commissioner-adjusted row is said; the correction close is a viewer-local instant', () => {
    const html = renderTab({ bracket: BUILT_DOC })
    const r2 = between(html, 'data-round="2"', 'data-round="3"')
    expect(r2).toContain('data-round-badge="live"')
    expect(r2).toContain('>pending<')
    expect(r2).toContain('Leads on points')
    expect(r2).toContain('✸ commissioner-adjusted')
    expect(between(html, 'data-round="3"', 'data-commish-doors')).toContain('data-game="tbd"')
    // R911: BUILT_DOC's regular season is FINAL — the document-level close is the regular
    // season's (a past instant) and must NOT render under a final bracket; each round's badge
    // carries its own close.
    expect(html).not.toContain('data-rollover-line="corrections-close"')
  })

  it('R911: while the seeds are PROVISIONAL (regular_season_final false) the regular season’s close renders as the seeds-final instant, viewer-local, league zone on hover', () => {
    const html = renderTab({ bracket: { ...BUILT_DOC, regular_season_final: false } })
    const close = elementOf(html, 'data-rollover-line="corrections-close"', '</p>')
    expect(close).toContain('Seeds final when corrections close')
    expect(close).toMatch(/Thu, Dec 1[67], \d{1,2}:\d\d [AP]M/)
    expect(close).toContain('(league time)')
    expect(renderTab({ bracket: { ...BUILT_DOC, regular_season_final: true } })).not.toContain('data-rollover-line="corrections-close"')
  })

  it('a built round NOT YET PLAYED (rows `scheduled`, 109’s DEFAULT 0) renders dashes and "Not played yet" — no 0.00, no tie verdict, no winner fill', () => {
    const html = renderTab({ bracket: BUILT_UNPLAYED_DOC })
    const r2 = between(html, 'data-round="2"', 'data-round="3"')
    expect(r2).toContain('data-round-badge="upcoming"')
    expect(r2.match(/data-not-played/g)).toHaveLength(2)
    expect(r2).not.toContain('data-verdict')
    expect(r2).not.toContain('0.00')
    expect(r2).not.toContain('data-winner')
    expect(r2).not.toContain('bg-accent-soft')
    expect(r2.match(/>—</g)?.length).toBeGreaterThanOrEqual(4)
    // Round 1 (played, final) is untouched.
    expect(between(html, 'data-round="1"', 'data-round="2"')).toContain('data-verdict="points"')
  })

  it('a two-week championship renders both weeks’ cells and 118’s SUM — an equal sum falls to the higher seed — and the STORED champion', () => {
    const html = renderTab({ bracket: COMPLETE_DOC, detail: detailWith({ status: 'complete', champion_team_id: T.alpha }) })
    const r3 = between(html, 'data-round="3"', 'data-commish-doors')
    expect(r3).toContain('two weeks per round'.length > 0 ? 'Weeks <span class="fs-num">17 + 18</span>' : '')
    expect(r3).toContain('80.00 + 70.00')
    expect(r3).toContain('95.50 + 54.50')
    expect(r3.match(/150\.00/g)).toHaveLength(2)
    expect(r3).toContain('Tied — higher seed advances')
    expect(html).toContain(`data-champion="${T.alpha}"`)
    // The champion's NAME is now a door to their team page (§16.1), so the
    // banner's text is no longer one contiguous run — assert the prefix, the
    // name and the link the name became.
    expect(html).toContain('Champion · <a')
    expect(html).toContain(`href="/app/leagues/${LEAGUE}/team/${T.alpha}"`)
    expect(html).toContain('>Alpha</a>')
    expect(html).not.toContain('data-rollover-line="corrections-close"')
  })

  it('R846 / F257(b′): a round whose frozen seeds differ from the FINAL standings is labelled — and not otherwise', () => {
    expect(renderTab({ bracket: BUILT_DOC })).not.toContain(SEEDED_BEFORE_CORRECTION_COPY)
    const moved: LeagueStandings = {
      ...FINAL_STANDINGS,
      standings: FINAL_STANDINGS.standings.map((r) => (r.rank === 5 ? { ...r, team_id: T.foxtrot } : r.rank === 6 ? { ...r, team_id: T.echo } : r)),
    }
    const html = renderTab({ bracket: BUILT_DOC, standings: moved })
    expect(between(html, 'data-round="1"', 'data-round="2"')).toContain('data-seeded-before-correction')
    expect(between(html, 'data-round="2"', 'data-round="3"')).not.toContain('data-seeded-before-correction')
    // Without the final standings loaded there is no evidence — no label.
    expect(renderTab({ bracket: BUILT_DOC, standings: 'missing' })).not.toContain(SEEDED_BEFORE_CORRECTION_COPY)
  })
})

describe('the no-bracket kinds (Q39 (C)/(D)): the standings ARE the playoff', () => {
  it('a total-points league renders the points-race copy with the regular season’s end; no rounds, no doors', () => {
    const html = renderTab({ bracket: POINTS_RACE_DOC })
    expect(html).toContain('data-playoff-bracket="points_race"')
    expect(html).toContain(POINTS_RACE_COPY)
    expect(html).toContain('Regular season ends')
    expect(html).not.toContain('data-rounds')
    expect(html).not.toContain('data-commish-doors')
  })

  it('playoffs off + complete: the copy and the STORED champion — never rank 1 by inference', () => {
    const html = renderTab({ bracket: NO_PLAYOFFS_COMPLETE_DOC, detail: detailWith({ status: 'complete', champion_team_id: T.bravo }) })
    expect(html).toContain(NO_PLAYOFFS_COPY)
    expect(html).toContain('Champion · <a')
    expect(html).toContain(`href="/app/leagues/${LEAGUE}/team/${T.bravo}"`)
    expect(html).toContain('>Bravo</a>')
    expect(html).not.toContain('Regular season ends')
    const unwritten = renderTab({ bracket: { ...NO_PLAYOFFS_COMPLETE_DOC, champion_team_id: null } })
    expect(unwritten).toContain('No champion recorded for this season.')
  })
})

// ---------------------------------------------------------------------------
// The commissioner's doors — M6's modal, pending by name
// ---------------------------------------------------------------------------

describe('commissioner edit affordances (§10.1 / §16.2) — the doors, routed to the pending-by-name state', () => {
  it('the commissioner sees the two doors (seeds, results); a manager sees none', () => {
    const commish = renderTab({ bracket: BUILT_DOC })
    expect(commish).toContain('data-commish-door="seeds"')
    expect(commish).toContain('data-commish-door="results"')
    expect(commish).not.toContain('data-commish-door-pending') // closed until pressed
    const manager = renderTab({ bracket: BUILT_DOC, detail: detailWith({}, 'manager') })
    expect(manager).not.toContain('data-commish-doors')
  })

  it('the door’s copy names the modal’s law — a reason, an audit entry — and carries no ledger code', () => {
    expect(COMMISH_DOOR_PENDING_COPY).toMatch(/reason/)
    expect(COMMISH_DOOR_PENDING_COPY).toMatch(/audit/)
    expect(COMMISH_DOOR_PENDING_COPY).not.toMatch(/\b[QEF]\d+\b|L\.D\d|M6/)
  })
})

// ---------------------------------------------------------------------------
// The Final | Projected control on the Standings tab — LIVE (F253(a) ✅)
// ---------------------------------------------------------------------------

describe('the Standings tab’s Final | Projected control reads 118’s projected table', () => {
  it('Final by default with no projected line; the projected document renders its weeks_projected beside weeks_final', () => {
    const html = renderTab({}, 'standings')
    expect(html).not.toContain('data-projected-copy')
    expect(html).toContain('>3</span> weeks final')
    expect(html).not.toContain('projected</span>')
    expect(PROJECTED_COPY).toMatch(/as if it ended now/)
    expect(PROJECTED_COPY).not.toMatch(/\b[QEF]\d+\b|L\.D\d|B9/)
  })
})

// ---------------------------------------------------------------------------
// The league home's playoffs hero — the SAME component, compact
// ---------------------------------------------------------------------------

function renderHome(seed: { bracket?: PlayoffBracket | 'error' | 'missing'; status?: string } = {}): string {
  const qc = client()
  const detail = detailWith({ status: seed.status ?? 'playoffs' })
  qc.setQueryData(leaguesKeys.detail(LEAGUE), detail)
  qc.setQueryData(leagueStandingsKeys.all(LEAGUE), FINAL_STANDINGS)
  const ladder: LeagueSchedule = {
    weeks: [
      { id: 'w14', season: 2099, week: 14, status: 'final', finalized_at: null, median_score: null },
      { id: 'w15', season: 2099, week: 15, status: 'live', finalized_at: null, median_score: null },
    ],
    matchups: [],
  }
  qc.setQueryData(scheduleKeys.all(LEAGUE), ladder)
  const weekDoc: WeekMatchups = {
    league_id: LEAGUE,
    season: 2099,
    week: 15,
    schedule_mode: 'h2h',
    league_week: { status: 'live', median_score: null, finalized_at: null },
    teams: [...BRACKET_NAMES.entries()].map(([id, name]) => ({ id, name, status: 'active' })),
    matchups: [],
    results: [],
  }
  qc.setQueryData(leagueMatchupKeys.week(LEAGUE, 15), weekDoc)
  const feed: ActivityFeed = { items: [], limit: 8, has_more: false, next_before: null, next_before_id: null }
  qc.setQueryData(leagueActivityKeys.feed(LEAGUE, { limit: 8 }), feed)
  const flag: LiveScoringFlags = { degraded: false, consecutive_failures: 0, last_failure_at: null, last_success_at: null, last_error: null, provider: 'sleeper+nflverse', stall: { stalled: false, reasons: [], rows: 0, oldest_enqueued_at: null, threshold_minutes: 10, ingest_stale: false, last_ingest_at: null, ingest_threshold_minutes: 120, checked_at: null } }
  qc.setQueryData(statsDegradedKeys.flag(), flag)
  const b = seed.bracket ?? BUILT_DOC
  if (b === 'error') failQuery(qc, playoffBracketKeys.all(LEAGUE), new Error('bracket read failed'))
  else if (b !== 'missing') qc.setQueryData(playoffBracketKeys.all(LEAGUE), b)
  return render(qc, createElement(LeagueHomeStates, { leagueId: LEAGUE }))
}

describe('the league home’s playoffs hero embeds the bracket (§16.5.1’s playoffs row — L.D5.5’s component)', () => {
  it('the bracket card renders the SAME component in its compact trim, with the door to the full tab; no doors on the hero', () => {
    const html = renderHome()
    expect(html).toContain('data-season-hero="playoffs"')
    expect(html).toContain('data-bracket-card')
    expect(html).toContain('data-playoff-bracket="bracket"')
    expect(html).toContain('data-compact')
    expect(html).toContain(`href="/app/leagues/${LEAGUE}/standings?tab=playoffs"`)
    expect(html).not.toContain('data-commish-doors')
    expect(html).not.toContain('the bracket view arrives in a later update')
  })

  it('states on the hero: skeleton · error-with-retry; absent for an in-season league', () => {
    expect(renderHome({ bracket: 'missing' })).toContain('data-skeleton="playoff-bracket"')
    const error = renderHome({ bracket: 'error' })
    expect(error).toContain('Couldn’t load the bracket.')
    expect(error).toContain('Retry')
    expect(renderHome({ status: 'in_season' })).not.toContain('data-bracket-card')
  })
})

// ---------------------------------------------------------------------------
// Elevation (CLAUDE.md), the theme, the clock, the ledger codes
// ---------------------------------------------------------------------------

describe('elevation is a hover affordance, never a resting one — the L.D5.5 files; no clock; no ledger code on screen', () => {
  const files = [
    'src/components/leagues/playoff-bracket.tsx',
    'src/components/leagues/playoff-bracket-ops.ts',
    'src/components/leagues/standings-page.tsx',
    'src/hooks/use-playoff-bracket.ts',
    'src/lib/leagues/api/playoffs-service.ts',
  ]
  const read = (f: string) => readFileSync(path.resolve(process.cwd(), f), 'utf8')
  const code = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')

  it('no feature file carries a resting shadow', () => {
    for (const f of files) {
      for (const m of code(read(f)).matchAll(/(?<![\w-])(?<!:)shadow-hard-[\w-]+/g)) {
        const before = code(read(f)).slice(Math.max(0, m.index - 40), m.index)
        expect(before, `${f}: ${m[0]}`).toMatch(/(hover|active|focus|focus-visible|group-hover|peer-hover|data-\[[^\]]*\]):$/)
      }
    }
  })

  it('no dark: variants, no next-themes; no clock read (§23.3 / F226); no second .channel(; no "midnight"; no fixed zone in the render path', () => {
    for (const f of files) {
      const src = code(read(f))
      expect(src, f).not.toMatch(/\bdark:/)
      expect(src, f).not.toContain('next-themes')
      expect(src, f).not.toMatch(/Date\.now\(|new Date\(\)/)
      expect(src, f).not.toContain('.channel(')
      expect(src, f).not.toMatch(/midnight/i)
    }
    // The viewer's zone is the BROWSER's (undefined) in the component — a
    // named zone reaches `rolloverDisplay` only from a test fixture.
    // R913: the formatter lives in the ops file — the fixed-zone pin reads BOTH sources.
    for (const f of ['src/components/leagues/playoff-bracket.tsx', 'src/components/leagues/playoff-bracket-ops.ts']) {
      expect(code(read(f)), f).not.toMatch(/America\/|Europe\/|Asia\/|'UTC'/)
    }
  })

  it('the component computes no seed, no total, no tiebreak — nothing is derived from a comparison of scores or seeds', () => {
    const src = code(read('src/components/leagues/playoff-bracket.tsx'))
    expect(src).not.toMatch(/home_total\s*[<>+]|away_total\s*[<>+]|home_score\s*[<>+]|_seed\s*[<>]|\.sort\(|Math\.(max|min|log2)/)
  })

  it('no ledger code reaches the screen in any state (F277(a))', () => {
    for (const html of [renderTab(), renderTab({ bracket: BUILT_DOC }), renderTab({ bracket: COMPLETE_DOC }), renderTab({ bracket: FOREIGN_ROWS_DOC }), renderTab({ bracket: POINTS_RACE_DOC }), renderHome()]) {
      expect(html.replace(/data-[a-z-]+="[^"]*"/g, '')).not.toMatch(/\b[QEF]\d+\b|L\.D\d/)
    }
  })
})
