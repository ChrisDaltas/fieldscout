/**
 * team-page.render.test.ts — L.D5.1's states checklist + elevation pins
 * (spec §16.5.4 "required states per data surface: skeleton-loading, empty
 * (designed copy, not blank), error-with-retry, degraded (banner +
 * last-good data)"; CLAUDE.md's elevation rule; PROGRESS D316).
 *
 * REAL renders — `renderToStaticMarkup` over the actual components with the
 * React Query cache pre-seeded (the `scoring-template-picker.render.test.ts`
 * rig; fetches are effects and effects do not run in a static render, so
 * the cache IS the data). `useAuth` is mocked at the module edge because it
 * reaches for Next's app router, which no static render mounts; every
 * other hook is the real one over the seeded cache. Error and degraded
 * states are built by setting the query's state directly — the shapes
 * React Query hands a component after a failed (re)fetch.
 *
 * Probe 2 of the PR (remove the error branch) reds `error-with-retry`;
 * probe 3 (a resting `shadow-hard-*` on a row) reds the elevation pin.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { leaguesKeys } from '@/hooks/use-leagues'
import { teamLineupKeys, useLineup, useSetLineup, type TeamLineupRow } from '@/hooks/use-lineup'
import { leagueRosterKeys, useRostersLive } from '@/hooks/use-rosters'
import { scheduleKeys, type LeagueSchedule } from '@/hooks/use-schedule'
import type { LeagueDetail } from '@/hooks/use-league'
import type { LeagueRosters, RosterPlayer } from '@/lib/leagues/api/rosters-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { LineupEditor } from './lineup-editor'
import { LOCK_RELEASE_UNRECORDED_COPY, PAST_WEEK_COPY } from './lineup-editor-ops'
import { STALE_LEAGUE_COPY } from './status-banners'
import { TeamPage } from './team-page'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-manager' } }),
}))
// Two REAL hooks wrapped in spies (never replaced): the roster read, so the
// page's poll argument is observable at the call site (R822(ii)); the set,
// so ONE cell can hand the editor a refusal exactly as the mutation reports
// it (R825). Every other render goes through the originals.
vi.mock('@/hooks/use-rosters', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/hooks/use-rosters')>()
  return { ...orig, useRostersLive: vi.fn(orig.useRostersLive) }
})
vi.mock('@/hooks/use-lineup', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/hooks/use-lineup')>()
  return { ...orig, useLineup: vi.fn(orig.useLineup), useSetLineup: vi.fn(orig.useSetLineup) }
})

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

const LEAGUE = 'league-1'
const TEAM = 'team-1'

function player(over: Partial<RosterPlayer> & Pick<RosterPlayer, 'player_id' | 'position' | 'full_name'>): RosterPlayer {
  return {
    nfl_team: 'XXX',
    status: 'Active',
    bye_week: null,
    slot_key: 'bn',
    acquisition_type: null,
    acquisition_cost: null,
    ir_placed_week: null,
    ir_lock_until_week: null,
    acquired_at: null,
    pool_state: 'rostered',
    game_lock: { state: 'unlocked', until: null },
    ...over,
  }
}

const settings = defaultsForTeamCount(8)

const detail: LeagueDetail = {
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
  },
  settings,
  members: [
    { id: 'm1', user_id: 'user-manager', team_id: TEAM, role: 'manager', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
    { id: 'm2', user_id: 'user-commish', team_id: 'team-2', role: 'commissioner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: null },
  ],
  teams: [
    { id: TEAM, name: 'Render Team', owner_id: 'user-manager', status: 'active', created_at: null },
    { id: 'team-2', name: 'Commish Team', owner_id: 'user-commish', status: 'active', created_at: null },
  ],
  my_role: 'manager',
  active_draft: null,
}

const roster: RosterPlayer[] = [
  player({ player_id: 'qb1', position: 'QB', full_name: 'Render QB' }),
  player({ player_id: 'rb-locked', position: 'RB', full_name: 'Render RB Locked', game_lock: { state: 'locked_release_unrecorded', until: null } }),
  player({ player_id: 'rb-open', position: 'RB', full_name: 'Render RB Open' }),
  player({ player_id: 'wr1', position: 'WR', full_name: 'Render WR', bye_week: 1 }),
]

const rosters: LeagueRosters = {
  league_id: LEAGUE,
  season: 2099,
  teams: [
    { team_id: TEAM, name: 'Render Team', owner_id: 'user-manager', status: 'active', manager_user_id: 'user-manager', roster },
    { team_id: 'team-2', name: 'Commish Team', owner_id: 'user-commish', status: 'active', manager_user_id: 'user-commish', roster: [] },
  ],
}

const schedule: LeagueSchedule = {
  weeks: [
    { id: 'w1', season: 2099, week: 1, status: 'live', finalized_at: null, median_score: null },
    { id: 'w2', season: 2099, week: 2, status: 'upcoming', finalized_at: null, median_score: null },
  ],
  matchups: [],
}

/** The MOVED-KICKOFF shape on the wire: the row's record still says the RB
 *  kicked off in 2001 while the roster's `game_lock` says unlocked for him
 *  — and the other RB is locked by the VIEW alone. */
const lineupRow: TeamLineupRow = {
  id: 'l1',
  team_id: TEAM,
  season: 2099,
  week: 1,
  slot_map: { 'qb:0': 'qb1', 'rb:0': 'rb-open', 'rb:1': 'rb-locked', 'wr:0': 'wr1' },
  starters: [
    { slot: 'qb:0', slot_key: 'qb', label: 'QB', player_id: 'qb1', position: 'QB', kickoff_at: '2099-09-13T17:00:00.000Z', flags: [] },
    { slot: 'rb:0', slot_key: 'rb', label: 'RB', player_id: 'rb-open', position: 'RB', kickoff_at: '2001-09-09T17:00:00.000Z', flags: [] },
    { slot: 'rb:1', slot_key: 'rb', label: 'RB', player_id: 'rb-locked', position: 'RB', kickoff_at: '2099-09-13T17:00:00.000Z', flags: [] },
    { slot: 'wr:0', slot_key: 'wr', label: 'WR', player_id: 'wr1', position: 'WR', kickoff_at: null, flags: ['bye'] },
  ],
  bench: [],
  locked_at: '2001-09-09T17:00:00.000Z',
  edited_by_commish: false,
  set_at: '2099-09-10T00:00:00.000Z',
}

interface Seed {
  detail?: LeagueDetail | 'error' | 'missing' | 'gone'
  rosters?: LeagueRosters | 'error' | 'degraded' | 'missing'
  schedule?: LeagueSchedule | 'missing'
  lineup?: TeamLineupRow | null | 'missing' | 'error'
}

function failQuery(client: QueryClient, queryKey: readonly unknown[], error: Error, data?: unknown) {
  const query = client.getQueryCache().build(client, { queryKey })
  if (data !== undefined) query.setData(data)
  query.setState({ status: 'error', error, fetchStatus: 'idle' })
}

function renderTeamPage(seed: Seed = {}): string {
  // `retryOnMount: false`: a static render is a MOUNT, and v5's optimistic
  // result reports an errored, data-less query that would retry on mount as
  // `pending` — which is not the state a mounted component sees after its
  // fetch failed. This models that post-failure state.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  const d = seed.detail ?? detail
  if (d === 'error') failQuery(client, leaguesKeys.detail(LEAGUE), new Error('Failed to load league'))
  else if (d === 'gone') failQuery(client, leaguesKeys.detail(LEAGUE), new Error('League not found'))
  else if (d !== 'missing') client.setQueryData(leaguesKeys.detail(LEAGUE), d)
  const r = seed.rosters ?? rosters
  if (r === 'error') failQuery(client, leagueRosterKeys.all(LEAGUE), new Error('rosters: boom'))
  else if (r === 'degraded') failQuery(client, leagueRosterKeys.all(LEAGUE), new Error('rosters: refetch boom'), rosters)
  else if (r !== 'missing') client.setQueryData(leagueRosterKeys.all(LEAGUE), r)
  const s = seed.schedule ?? schedule
  if (s !== 'missing') client.setQueryData(scheduleKeys.all(LEAGUE), s)
  const l = seed.lineup === undefined ? lineupRow : seed.lineup
  if (l === 'error') failQuery(client, teamLineupKeys.week(TEAM, 1), new Error('team_lineups: boom'))
  else if (l !== 'missing') client.setQueryData(teamLineupKeys.week(TEAM, 1), l)
  return unescapeHtml(
    renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, createElement(TeamPage, { leagueId: LEAGUE, teamId: TEAM })),
    ),
  )
}

/** The markup escapes `'` and `&`; the copy constants do not. */
function unescapeHtml(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

// ---------------------------------------------------------------------------
// The states checklist (§16.5.4)
// ---------------------------------------------------------------------------

describe('team page — the four required states per surface', () => {
  it('skeleton while the league loads; skeleton for the editor while the roster loads', () => {
    expect(renderTeamPage({ detail: 'missing' })).toContain('bg-n-4')
    expect(renderTeamPage({ detail: 'missing' })).not.toContain('Render Team')
    const editorLoading = renderTeamPage({ rosters: 'missing' })
    expect(editorLoading).toContain('data-skeleton="lineup-editor"')
    expect(editorLoading).toContain('Render Team')
  })

  it('error-with-retry when the league read fails; ONE copy for a 404 (F250(a))', () => {
    const html = renderTeamPage({ detail: 'error' })
    expect(html).toContain('Couldn’t load this league.')
    expect(html).toContain('Retry')
    expect(html).toContain('role="alert"')
    const gone = renderTeamPage({ detail: 'gone' })
    expect(gone).toContain('This league no longer exists.')
    const roster = renderTeamPage({ rosters: 'error' })
    expect(roster).toContain('Couldn’t load this roster.')
    expect(roster).toContain('Retry')
    const lineup = renderTeamPage({ lineup: 'error' })
    expect(lineup).toContain('Couldn’t load this week’s lineup.')
  })

  it('degraded: a failed refetch with last-good rows keeps the rows behind the banner', () => {
    const html = renderTeamPage({ rosters: 'degraded' })
    expect(html).toContain(STALE_LEAGUE_COPY)
    expect(html).toContain('Render RB Open')
    expect(html).not.toContain('Couldn’t load this roster.')
  })

  it('empty: no lineup row yet is designed copy over an all-open editor; an empty roster names itself', () => {
    const noRow = renderTeamPage({ lineup: null })
    expect(noRow).toContain('Nothing set for week')
    expect(noRow).toContain('Empty')
    const emptyRoster = renderTeamPage({
      rosters: { ...rosters, teams: [{ ...rosters.teams[0], roster: [] }, rosters.teams[1]] },
      lineup: null,
    })
    expect(emptyRoster).toContain('No players on this roster yet')
  })

  it('a team that is not a franchise of the league is refused by name, never an empty editor', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: (() => { const c = new QueryClient(); c.setQueryData(leaguesKeys.detail(LEAGUE), detail); return c })() },
        createElement(TeamPage, { leagueId: LEAGUE, teamId: 'not-a-team' }),
      ),
    )
    expect(html).toContain('This team isn’t a franchise of this league.')
    expect(html).not.toContain('data-lineup-editor')
  })
})

describe('the editor renders the FETCHED lock, the record as a record, and the catalog chips', () => {
  it('the moved-kickoff fixture: the row whose record says 2001 shows NO lock; the view-locked row shows 🔒 with F241(d)’s copy', () => {
    const html = renderTeamPage()
    // rb-open: record kicked off (2001), view unlocked → draggable, no 🔒.
    const open = html.slice(html.indexOf('data-slot="rb:0"'), html.indexOf('data-slot="rb:1"'))
    expect(open).toContain('Render RB Open')
    expect(open).not.toContain('🔒')
    expect(open).not.toContain('aria-disabled="true"')
    // rb-locked: view locked (release unrecorded) → 🔒 + the state's copy.
    const lockedRow = html.slice(html.indexOf('data-slot="rb:1"'), html.indexOf('data-slot="wr:0"'))
    expect(lockedRow).toContain('🔒')
    expect(lockedRow).toContain(LOCK_RELEASE_UNRECORDED_COPY)
    expect(lockedRow).toContain('aria-disabled="true"')
    // locked_at rendered as the record ("locks from"), never as a lock, and
    // the countdown is the named placeholder (Q40) — the attribute names the
    // ledger, the copy on screen does not (R829).
    expect(html).toContain('Locks from')
    expect(html).toContain('data-lock-countdown="placeholder-q40"')
    expect(html).toContain('countdown coming')
    // F252(d): the honest pin — strip the lowercase attribute, then no 'Q40'
    // anywhere in the text (a mid-sentence mention would have passed the
    // narrower `Q40</` check).
    expect(html.replace(/data-lock-countdown="[^"]*"/g, '')).not.toMatch(/Q40/)
  })

  it('F259(a): the page passes NO poll — the room’s `league_player_pool` event (119) refetches the lock view', () => {
    vi.mocked(useRostersLive).mockClear()
    renderTeamPage()
    // One argument: the league id. No `{ refetchInterval }` — the 60 s poll
    // L.D5.1 added (R822(ii)) retired at L.D5.4 with the tick's broadcast.
    expect(vi.mocked(useRostersLive).mock.calls.at(-1)).toEqual([LEAGUE])
  })

  it('F252(c): no lineup read for week 1 while the ladder is still pending', () => {
    vi.mocked(useLineup).mockClear()
    renderTeamPage({ schedule: 'missing' })
    // The ladder is unknown → the week argument is undefined (the query is
    // disabled), not the `defaultLineupWeek([]) === 1` fetch that was wasted
    // per open before.
    expect(vi.mocked(useLineup).mock.calls.at(-1)).toEqual([TEAM, undefined])
  })

  it('R825: a refusal renders the RPC’s sentence VERBATIM — the player and his kickoff named, nothing re-worded', () => {
    // The 409 the browser pass rendered (F224(e)). Handed to the editor
    // exactly as `useSetLineup` reports a failed mutation.
    const refusal =
      "Dev RB Locked's game kicked off at 2001-09-09T17:00:00+00:00 (nfl_games) — a player whose game has started cannot enter or move slots (§11.2, lineup_lock = per_player_kickoff); wanted \"rb:1\""
    vi.mocked(useSetLineup).mockReturnValueOnce({
      data: undefined,
      error: new Error(refusal),
      isPending: false,
      reset: () => {},
      submit: () => {},
    } as unknown as ReturnType<typeof useSetLineup>)
    const client = new QueryClient()
    const html = unescapeHtml(
      renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client },
          createElement(LineupEditor, {
            leagueId: LEAGUE,
            teamId: TEAM,
            week: 1,
            settings: settings.roster_settings,
            allowIllegal: true,
            roster,
            stored: lineupRow,
            currentWeek: 1,
            editability: { state: 'open' },
            canEdit: true,
            isCommissionerArm: false,
            leagueTimeZone: null,
          }),
        ),
      ),
    )
    expect(html).toContain(refusal)
    expect(html).toContain('role="alert"')
    expect(html).toContain('Dismiss')
    expect(html).not.toContain('Something went wrong')
  })

  it('bye starter: the server flag chip under allow_illegal_lineups = true is caution copy', () => {
    const html = renderTeamPage()
    const wr = html.slice(html.indexOf('data-slot="wr:0"'), html.indexOf('data-bench'))
    expect(wr).toContain('Bye — scores 0')
    expect(wr).toContain('on bye — starts and scores 0 this week')
  })

  it('a past week is closed by name and the editor is read-only', () => {
    const client = new QueryClient()
    client.setQueryData(leaguesKeys.detail(LEAGUE), detail)
    client.setQueryData(leagueRosterKeys.all(LEAGUE), rosters)
    client.setQueryData(scheduleKeys.all(LEAGUE), {
      ...schedule,
      weeks: [
        { id: 'w1', season: 2099, week: 1, status: 'final', finalized_at: null, median_score: null },
        { id: 'w2', season: 2099, week: 2, status: 'live', finalized_at: null, median_score: null },
      ],
    } satisfies LeagueSchedule)
    // Default week is the current (2); the page opens there and the closed
    // copy is not shown. Seed week 2 empty so the render is deterministic.
    client.setQueryData(teamLineupKeys.week(TEAM, 2), null)
    const html = unescapeHtml(
      renderToStaticMarkup(
        createElement(QueryClientProvider, { client }, createElement(TeamPage, { leagueId: LEAGUE, teamId: TEAM })),
      ),
    )
    expect(html).toContain('Current week')
    expect(html).not.toContain(PAST_WEEK_COPY)
    expect(html).toContain('Save lineup')
    // The closed state itself, rendered directly on the editor: the reason
    // by name, no Save, every row read-only.
    const closed = unescapeHtml(
      renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client },
          createElement(LineupEditor, {
            leagueId: LEAGUE,
            teamId: TEAM,
            week: 1,
            settings: settings.roster_settings,
            allowIllegal: true,
            roster,
            stored: lineupRow,
            currentWeek: 2,
            editability: { state: 'closed', reason: PAST_WEEK_COPY },
            canEdit: true,
            isCommissionerArm: false,
            leagueTimeZone: null,
          }),
        ),
      ),
    )
    expect(closed).toContain(PAST_WEEK_COPY)
    expect(closed).not.toContain('Save lineup')
    expect(closed).not.toContain('aria-disabled="false"')
  })
})

// ---------------------------------------------------------------------------
// Elevation (CLAUDE.md) — the feature files, since ui/’s pin stops at ui/
// ---------------------------------------------------------------------------

const RESTING_SHADOW = /(?<![\w-])(?<!:)shadow-hard-[\w-]+/g
const INTERACTION_PREFIX = /(hover|active|focus|focus-visible|group-hover|peer-hover|data-\[[^\]]*\]):$/

function restingShadowsIn(source: string): string[] {
  const hits: string[] = []
  for (const match of source.matchAll(RESTING_SHADOW)) {
    const before = source.slice(Math.max(0, match.index - 40), match.index)
    if (INTERACTION_PREFIX.test(before)) continue
    const line = source.slice(source.lastIndexOf('\n', match.index) + 1, match.index)
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
    hits.push(match[0])
  }
  return hits
}

describe('elevation is a hover affordance, never a resting one — the L.D5.1 files', () => {
  const read = (f: string) => readFileSync(path.resolve(process.cwd(), 'src/components/leagues', f), 'utf8')

  it('team-page.tsx carries no resting shadow', () => {
    expect(restingShadowsIn(read('team-page.tsx'))).toEqual([])
  })

  it('lineup-editor.tsx’s ONE resting shadow is the DragOverlay ghost (a true overlay), and nothing else', () => {
    const source = read('lineup-editor.tsx')
    const hits = restingShadowsIn(source)
    expect(hits).toEqual(['shadow-hard-4'])
    const overlayStart = source.indexOf('<DragOverlay')
    const overlayEnd = source.indexOf('</DragOverlay>')
    const idx = source.indexOf('shadow-hard-4', source.indexOf("'flex items-center gap-1.5 rounded-sm border border-ink bg-white px-2 py-1 text-[11px] font-bold"))
    expect(idx).toBeGreaterThan(overlayStart)
    expect(idx).toBeLessThan(overlayEnd)
  })

  it('no dark: variants, no next-themes (single theme)', () => {
    for (const f of ['team-page.tsx', 'lineup-editor.tsx', 'lineup-editor-ops.ts']) {
      const src = read(f)
      expect(src).not.toMatch(/\bdark:/)
      expect(src).not.toContain('next-themes')
    }
  })
})
