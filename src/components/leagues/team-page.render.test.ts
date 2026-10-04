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
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { leaguesKeys } from '@/hooks/use-leagues'
import { teamLineupKeys, useLineup, useSetLineup, type TeamLineupRow } from '@/hooks/use-lineup'
import { leagueRosterKeys, useRostersLive } from '@/hooks/use-rosters'
import { scheduleKeys, type LeagueSchedule } from '@/hooks/use-schedule'
import { tradeDeadlineKeys, type TradeDeadlineState } from '@/hooks/use-trade-deadline'
import type { LeagueDetail } from '@/hooks/use-league'
import type { LeagueRosters, RosterPlayer } from '@/lib/leagues/api/rosters-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'
import { useOverrideMode } from '@/stores/commish-override-store'

import { LineupEditor, type LineupStats } from './lineup-editor'
import { KEPT_STARTER_COPY, KEPT_STARTER_OTHER_WEEK_COPY, LOCK_RELEASE_UNRECORDED_COPY, PAST_WEEK_COPY, type WeekEditability } from './lineup-editor-ops'
import { STALE_LEAGUE_COPY } from './status-banners'
import { AUTOPILOT_SWITCH_LABEL, COMMISH_CHANGED_BADGE, COMMISH_CHANGED_TITLE, NO_SEAT_ROW_AUTOPILOT_COPY } from './team-commish-ops'
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
// The override-mode READ is a spy over the real hook. It has to be: zustand v5
// answers `useSyncExternalStore` with `getInitialState()` on the server
// snapshot, and `renderToStaticMarkup` IS the server path — so `setState`
// cannot reach a static render. The store's own behaviour (enter/exit, keyed
// by league) is pinned directly in `stores/commish-override-store.test.ts`;
// what this file pins is what the PAGE does with the answer.
vi.mock('@/stores/commish-override-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/stores/commish-override-store')>()
  return { ...orig, useOverrideMode: vi.fn(orig.useOverrideMode) }
})
// R1386: `PageHeader` portals its actions into the app header through a store
// effect a static render never runs — rendered inline so the header's doors
// are observable (the console / members rigs' shape).
vi.mock('@/components/layout/app-header', () => ({
  PageHeader: ({ title, actions }: { title: ReactNode; actions?: ReactNode }) =>
    createElement('header', { 'data-page-header': '' }, createElement('h1', null, title), actions ?? null),
}))

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
    { team_id: TEAM, name: 'Render Team', owner_id: 'user-manager', status: 'active', manager_user_id: 'user-manager', autopilot: false, faab_balance: null, waiver_priority: null, roster },
    { team_id: 'team-2', name: 'Commish Team', owner_id: 'user-commish', status: 'active', manager_user_id: 'user-commish', autopilot: false, faab_balance: null, waiver_priority: null, roster: [] },
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
  /** L.D3.12: the trade deadline read (162) — unseeded = still loading. */
  deadline?: TradeDeadlineState
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
  if (seed.deadline) client.setQueryData(tradeDeadlineKeys.all(LEAGUE), seed.deadline)
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
    expect(open).toContain('data-player="rb-open"')
    // rb-locked: view locked (release unrecorded) → 🔒 + the state's copy.
    const lockedRow = html.slice(html.indexOf('data-slot="rb:1"'), html.indexOf('data-slot="wr:0"'))
    expect(lockedRow).toContain('🔒')
    expect(lockedRow).toContain(LOCK_RELEASE_UNRECORDED_COPY)
    // League UX batch 3: a locked player has NO drag handle (prevented).
    expect(lockedRow).not.toContain('data-player="rb-locked"')
    // locked_at rendered as the record ("locks from"), never as a lock. The
    // "· countdown coming" placeholder copy is gone (Chris 2026-10-03).
    expect(html).toContain('Locks from')
    expect(html).toContain('data-lock-record')
    expect(html).not.toContain('countdown coming')
    expect(html).not.toMatch(/Q40/)
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
    // (The page also mounts the opponent's lineup read — disabled with no pairing.)
    expect(vi.mocked(useLineup).mock.calls.filter((c) => c[0] === TEAM).at(-1)).toEqual([TEAM, undefined])
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
            isCommish: false,
            leagueTimeZone: null,
            overrideMode: false,
            onOverrideMode: () => {},
          }),
        ),
      ),
    )
    expect(html).toContain(refusal)
    expect(html).toContain('role="alert"')
    expect(html).toContain('Dismiss')
    expect(html).not.toContain('Something went wrong')
  })

  // -------------------------------------------------------------------------
  // OVERRIDE MODE IS A MODE (M6A; PROGRESS §3(h), ruled by Chris 2026-09-11).
  //
  // Every pin below is measured against a failure that actually happened in
  // his league on 2026-09-11: the switch was reachable only after a refusal,
  // Save then sat disabled behind an unmentioned Reason field, and teams 5 and
  // 6 produced `set_lineup` refusals with ZERO `commissioner_actions` rows.
  // `overrideMode` is a PROP now (the page owns it, over
  // `commish-override-store`), so both states are real renders here rather
  // than source greps.
  // -------------------------------------------------------------------------

  const renderEditor = (over: Partial<Parameters<typeof LineupEditor>[0]> = {}) => {
    const client = new QueryClient()
    return unescapeHtml(
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
            editability: { state: 'open' } as WeekEditability,
            canEdit: true,
            isCommish: true,
            leagueTimeZone: null,
            overrideMode: false,
            onOverrideMode: () => {},
            ...over,
          }),
        ),
      ),
    )
  }

  it('NO SWITCH ON THE TEAM PAGE (League UX batch 1, Chris 2026-10-03): override mode is turned on in League settings / the console, so the editor carries no toggle in any week state — for a commissioner or a manager', () => {
    // The lock wall still holds with the mode off: the locked RB is not
    // draggable, has no onClick and no bench ×.
    const open = renderEditor()
    expect(open).not.toContain('data-commish-tools')
    expect(open).not.toContain('data-override-toggle')
    expect(open).not.toContain('Turn on override mode')
    expect(open).not.toContain('role="alert"')
    // No drag handle and no seat options for him — his menu says why.
    expect(open).not.toContain('data-player="rb-locked"')
    expect(open).toContain('data-move-menu="rb-locked"')

    for (const editability of [{ state: 'closed', reason: PAST_WEEK_COPY } as const, { state: 'unknown' } as const]) {
      expect(renderEditor({ editability })).not.toContain('data-override-toggle')
      expect(renderEditor({ editability, overrideMode: true })).not.toContain('data-override-toggle')
    }

    // THE MANAGER'S EDITOR IS UNCHANGED. No switch, no commissioner tools.
    for (const editability of [{ state: 'open' } as const, { state: 'closed', reason: PAST_WEEK_COPY } as const]) {
      const managerHtml = renderEditor({ isCommish: false, editability })
      expect(managerHtml).not.toContain('data-override-toggle')
      expect(managerHtml).not.toContain('data-commish-tools')
      expect(managerHtml).not.toContain('data-override-mode="on"')
    }
  })

  it('NO REASON INPUT EXISTS IN THE OVERRIDE PATH — not on entry, not per save, in either mode (its presence WAS the defect)', () => {
    for (const html of [
      renderEditor(),
      renderEditor({ overrideMode: true }),
      renderEditor({ overrideMode: true, editability: { state: 'closed', reason: PAST_WEEK_COPY } }),
    ]) {
      expect(html).not.toContain('<input')
      expect(html).not.toContain('data-override-reason')
      expect(html).not.toMatch(/Reason \(required/)
    }
    // …and the file cannot grow one back without this failing.
    const source = readFileSync(path.resolve(process.cwd(), 'src/components/leagues/lineup-editor.tsx'), 'utf8')
    expect(source).not.toContain("@/components/ui/input")
    expect(source).not.toMatch(/<Input\b/)
  })

  it('THE VISIBLE STATE: present while ON, absent while OFF — a frame (the header carries the badge and the off switch), none of it an error and none of it a resting shadow', () => {
    const on = renderEditor({ overrideMode: true })
    expect(on).toContain('data-override-mode="on"')
    expect(on).toContain('border-brand-strong')
    expect(on).toContain('bg-brand-soft')
    expect(on).not.toContain('data-override-toggle')
    // Not an error, and not elevated at rest — the frame and the bar carry
    // fill + border only (the `hover:shadow-hard-*` on the Save button is a
    // hover affordance and is exactly what the rule permits).
    expect(on).not.toContain('bg-negative-soft')
    const frameClass = on.slice(on.indexOf('class="') + 7, on.indexOf('"', on.indexOf('class="') + 7))
    expect(frameClass).toContain('border-brand-strong')
    expect(frameClass).not.toContain('shadow')

    const off = renderEditor()
    expect(off).toContain('data-override-mode="off"')
    expect(off).not.toContain('Override mode ON')
    expect(off).not.toContain('border-brand-strong')
    expect(off).not.toContain('Exit override mode')
  })

  it('while ON the commissioner acts like any GM: the locked row is live, the closed week opens, and Save is the override', () => {
    const on = renderEditor({ overrideMode: true })
    const at = on.indexOf('data-player="rb-locked"')
    const lockedRow = on.slice(Math.max(0, at - 400), at + 400)
    // The 🔒 badge STAYS (it is the record of what is being overridden)…
    expect(on).toContain('🔒')
    // …but the wall is down: he has his drag handle, and the move saves itself
    // through the override (no Save button exists any more).
    expect(at).toBeGreaterThan(-1)
    expect(lockedRow).toContain('cursor-grab')
    expect(on).not.toContain('data-save-lineup')
    expect(on).toContain('data-save-state="idle"')

    // A CLOSED week is editable in the mode — the past-week banner steps aside
    // rather than contradicting the bar above it, and Save is still there.
    const closedOn = renderEditor({ overrideMode: true, editability: { state: 'closed', reason: PAST_WEEK_COPY } })
    expect(closedOn).not.toContain(PAST_WEEK_COPY)
    expect(closedOn).toContain('data-save-state="idle"')
  })

  it('AUTOSAVE (Chris 2026-10-03): NO Save or Discard button in either mode — the indicator says moves save themselves', () => {
    for (const html of [renderEditor(), renderEditor({ overrideMode: true }), renderEditor({ isCommish: false })]) {
      expect(html).not.toContain('data-save-lineup')
      expect(html).not.toContain('data-discard-lineup')
      expect(html).not.toContain('Save lineup')
      expect(html).toContain('Moves save automatically')
    }
  })

  it('the refusal keeps a way OUT — the shortcut turns on the SAME mode, and it is gone once the mode is on', () => {
    const refusal = 'Render RB Locked’s game kicked off — a player whose game has started cannot enter or move slots (§11.2)'
    const refused = () =>
      ({
        data: undefined,
        error: new Error(refusal),
        isPending: false,
        reset: () => {},
        submit: () => {},
      }) as unknown as ReturnType<typeof useSetLineup>

    // All three renders carry the SAME server refusal, so every absence below
    // is a decision and not an accident of there being nothing to hang it on.
    vi.mocked(useSetLineup).mockReturnValueOnce(refused())
    const offered = renderEditor()
    expect(offered).toContain(refusal)
    expect(offered).toContain('data-offer-override')
    expect(offered).toContain('Turn on override mode')
    expect(offered).toContain('Nothing changed — the lineup shown is the one that’s saved.')

    // Already in the mode → the refusal still renders, the offer does not.
    vi.mocked(useSetLineup).mockReturnValueOnce(refused())
    const already = renderEditor({ overrideMode: true })
    expect(already).toContain(refusal)
    expect(already).not.toContain('data-offer-override')

    // A plain manager is never offered it, refusal or no refusal.
    vi.mocked(useSetLineup).mockReturnValueOnce(refused())
    const manager = renderEditor({ isCommish: false })
    expect(manager).toContain(refusal)
    expect(manager).not.toContain('data-offer-override')
  })

  it('the mode is said ONCE, in the league header (League UX batch 1) — no badge in the team card; the editor’s frame marks it, for a commissioner only', () => {
    vi.mocked(useOverrideMode).mockReturnValue(false)
    const off = renderTeamPage({ detail: { ...detail, my_role: 'commissioner' } })
    expect(off).not.toContain('data-override-mode-badge')
    expect(off).toContain('data-override-mode="off"')

    vi.mocked(useOverrideMode).mockReturnValue(true)
    try {
      const asCommish = renderTeamPage({ detail: { ...detail, my_role: 'commissioner' } })
      expect(asCommish).not.toContain('data-override-mode-badge')
      expect(asCommish).not.toContain('✸ Override mode ON')
      expect(asCommish).toContain('data-override-mode="on"')

      // The seeded viewer's role is `manager` — the mode must not reach him
      // even when the store says the league is in it.
      const asManager = renderTeamPage()
      expect(asManager).not.toContain('data-override-mode-badge')
      expect(asManager).toContain('data-override-mode="off"')
      expect(asManager).not.toContain('data-commish-tools')
    } finally {
      vi.mocked(useOverrideMode).mockReset()
    }
  })

  // -------------------------------------------------------------------------
  // F344 / D346 — THE WIDENING, PINNED IN THE TASK THAT CAUSES IT (L.E1.6).
  //
  // Migration 127's roster verbs route their eviction THROUGH the
  // `team_lineups` row and set `edited_by_commish = TRUE`, reusing the
  // drain-side force `score-week-worker.ts` already reads. The flag used to
  // mean "a commissioner SET this lineup"; it now also means "a commissioner
  // CHANGED this lineup row" — so a week a MANAGER set can carry the badge.
  // The consequence is asserted here rather than discovered in the UI;
  // L.E1.13 re-reads the copy against the wider meaning.
  //
  // The fixture state is exactly what pgTAP 075 §C11-§C13 + §J1 measure on
  // the database: the evicted player's key GONE from `slot_map`, his
  // `starters[]` entry nulled and flagged `["empty"]`, `edited_by_commish`
  // TRUE and `set_at` UNMOVED (four columns, not five).
  // -------------------------------------------------------------------------
  it('F344 PREMISE: a lineup the MANAGER set renders NO commissioner badge', () => {
    expect(renderTeamPage()).not.toContain('data-commish-changed')
  })

  it('F344: after a commissioner force-drop out of a starting slot, the MANAGER’s own week renders the badge — and (L.E1.13 item 3b) its WORDS widened with the flag: "changed by commissioner", never "commissioner-set" over a week the manager set himself', () => {
    const evicted: TeamLineupRow = {
      ...lineupRow,
      slot_map: { 'rb:0': 'rb-open', 'rb:1': 'rb-locked', 'wr:0': 'wr1' },
      starters: lineupRow.starters.map((s) =>
        s.slot === 'qb:0' ? { ...s, player_id: null, position: null, kickoff_at: null, flags: ['empty'] } : s,
      ),
      edited_by_commish: true,
      // NOT moved: nobody SET this lineup, a roster move changed it underneath.
      set_at: lineupRow.set_at,
    }
    const html = renderTeamPage({ lineup: evicted })
    expect(html).toContain('data-commish-changed')
    expect(html).toContain(COMMISH_CHANGED_BADGE)
    // L.E1.34 (F233(d), §10.3): the ✸ lands on the log — every action naming this team.
    expect(html).toMatch(/data-commish-changed-link="true" href="[^"]*\/activity\?tab=commissioner&team=/)
    expect(html).toContain(COMMISH_CHANGED_TITLE)
    // The old words are GONE: nobody SET this lineup (`set_at` did not move).
    expect(html).not.toContain('commissioner-set')
    // …and the emptied slot renders as empty, not as a ghost naming a player
    // who is no longer on the roster.
    const qb = html.slice(html.indexOf('data-slot="qb:0"'), html.indexOf('data-slot="rb:0"'))
    expect(qb).toContain('Empty')
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
    expect(html).toContain('Moves save automatically')
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
            isCommish: false,
            leagueTimeZone: null,
            overrideMode: false,
            onOverrideMode: () => {},
          }),
        ),
      ),
    )
    expect(closed).toContain(PAST_WEEK_COPY)
    expect(closed).not.toContain('Moves save automatically')
    expect(closed).not.toContain('data-player="')
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

// ---------------------------------------------------------------------------
// M6A L.E1.13 — the commissioner's team-page tools are a FACE OF OVERRIDE MODE
// (rule (h)): gated on the ROLE and on the ONE switch, never a second toggle;
// rename has TWO arms and the manager's is NOT inside the mode.
// ---------------------------------------------------------------------------

describe('the team page’s commissioner tools and rename arms (L.E1.13) — free vs gated', () => {
  const asCommish = { ...detail, my_role: 'commissioner' as const }
  /** The viewer is the commissioner and this team is SOMEONE ELSE's seat. */
  const asCommishElsewhere = {
    ...asCommish,
    members: detail.members.map((m) => (m.user_id === 'user-manager' ? { ...m, team_id: 'team-2' } : { ...m, team_id: TEAM })),
  }

  it('MODE OFF: no roster tools for anyone; the team’s own manager has HIS rename arm; a commissioner on another team’s page is told the mode is the way — never a dead control', () => {
    vi.mocked(useOverrideMode).mockReturnValue(false)
    try {
      const manager = renderTeamPage()
      expect(manager).not.toContain('data-team-commish-tools')
      expect(manager).toContain('data-rename-open="manager"')
      // A commissioner whose OWN seat is this team is its manager too: outside
      // the mode he exercises no §10.1 power, so it is the manager's arm.
      const ownSeat = renderTeamPage({ detail: asCommish })
      expect(ownSeat).not.toContain('data-team-commish-tools')
      expect(ownSeat).toContain('data-rename-open="manager"')
      expect(ownSeat).not.toContain('data-rename-hint')
      const commish = renderTeamPage({ detail: asCommishElsewhere })
      expect(commish).not.toContain('data-team-commish-tools')
      expect(commish).not.toContain('data-rename-open')
      expect(commish).toContain('data-rename-hint')
    } finally {
      vi.mocked(useOverrideMode).mockReset()
    }
  })

  it('MODE ON, commissioner: the roster tools mount under the editor with one row per rostered player, the rename is the AUDITED arm, and there is no override switch on the page', () => {
    vi.mocked(useOverrideMode).mockReturnValue(true)
    try {
      const html = renderTeamPage({ detail: asCommish })
      expect(html).toContain('data-team-commish-tools')
      expect(html.match(/data-tools-player=/g)).toHaveLength(roster.length)
      expect(html.indexOf('data-team-commish-tools')).toBeGreaterThan(html.indexOf('data-lineup-editor'))
      expect(html).toContain('data-rename-open="commissioner"')
      expect(html).not.toContain('data-rename-hint')
      expect(html).not.toContain('data-override-toggle') // the switch lives in settings / the console
      // The move targets are the OTHER franchises — never the team itself.
      expect(html).toContain('aria-label="Move Render QB to"')
    } finally {
      vi.mocked(useOverrideMode).mockReset()
    }
  })

  it('MODE ON in the store, but the viewer is a MANAGER: the mode never reaches him — no tools, and his rename stays the manager’s arm', () => {
    vi.mocked(useOverrideMode).mockReturnValue(true)
    try {
      const html = renderTeamPage()
      expect(html).not.toContain('data-team-commish-tools')
      expect(html).toContain('data-rename-open="manager"')
      expect(html).not.toContain('data-rename-open="commissioner"')
    } finally {
      vi.mocked(useOverrideMode).mockReset()
    }
  })

  it('a roster that FAILED to load mounts no tools — the page renders its error card, never an empty tools panel', () => {
    vi.mocked(useOverrideMode).mockReturnValue(true)
    try {
      const html = renderTeamPage({ detail: asCommish, rosters: 'error' })
      expect(html).toContain('Couldn’t load this roster.')
      expect(html).not.toContain('data-team-commish-tools')
    } finally {
      vi.mocked(useOverrideMode).mockReset()
    }
  })
})

// M6A L.E1.22 (migration 139; Q63, ruled 2026-09-27): the per-team "Put on
// autopilot" switch — a face of override mode, shown for an UNMANAGED seat
// only, its checked state the rosters document's `autopilot` (never the click).
describe('the team page’s autopilot switch (L.E1.22) — free vs gated', () => {
  const asCommish = { ...detail, my_role: 'commissioner' as const }
  /** TEAM has NO manager: its member row is a placeholder and the rosters
   *  document says so (`manager_user_id: null`). */
  const unmanagedDetail = {
    ...asCommish,
    members: detail.members.map((m) => (m.team_id === TEAM ? { ...m, user_id: null, is_placeholder: true } : m)),
  }
  const unmanagedRosters = (autopilot: boolean): LeagueRosters => ({
    ...rosters,
    teams: rosters.teams.map((t) => (t.team_id === TEAM ? { ...t, manager_user_id: null, autopilot } : t)),
  })

  it('MODE ON, commissioner, an UNMANAGED seat: the switch shows, OFF by default, with its label — and it is the rosters document’s state', () => {
    vi.mocked(useOverrideMode).mockReturnValue(true)
    try {
      const off = renderTeamPage({ detail: unmanagedDetail, rosters: unmanagedRosters(false) })
      expect(off).toContain('data-autopilot-switch="off"')
      expect(off).toContain(AUTOPILOT_SWITCH_LABEL)
      expect(off).toMatch(/role="switch"[^>]*aria-checked="false"/)
      const on = renderTeamPage({ detail: unmanagedDetail, rosters: unmanagedRosters(true) })
      expect(on).toContain('data-autopilot-switch="on"')
      expect(on).toMatch(/role="switch"[^>]*aria-checked="true"/)
      // No override switch on the page — it lives in settings / the console.
      expect(on).not.toContain('data-override-toggle')
    } finally {
      vi.mocked(useOverrideMode).mockReset()
    }
  })

  it('MODE OFF: no switch for the commissioner on the same unmanaged seat — it is a face of the mode, never a standalone control', () => {
    vi.mocked(useOverrideMode).mockReturnValue(false)
    try {
      expect(renderTeamPage({ detail: unmanagedDetail, rosters: unmanagedRosters(false) })).not.toContain('data-autopilot-switch')
    } finally {
      vi.mocked(useOverrideMode).mockReset()
    }
  })

  it('MODE ON, commissioner, a MANAGED seat: no switch (139 refuses ON there — no dead control)', () => {
    vi.mocked(useOverrideMode).mockReturnValue(true)
    try {
      const html = renderTeamPage({ detail: asCommish })
      expect(html).toContain('data-team-commish-tools')
      expect(html).not.toContain('data-autopilot-switch')
    } finally {
      vi.mocked(useOverrideMode).mockReset()
    }
  })

  it('MODE ON in the store, but the viewer is a MANAGER: no switch, even on an unmanaged seat', () => {
    vi.mocked(useOverrideMode).mockReturnValue(true)
    try {
      const manager = { ...unmanagedDetail, my_role: 'manager' as const }
      expect(renderTeamPage({ detail: manager, rosters: unmanagedRosters(false) })).not.toContain('data-autopilot-switch')
    } finally {
      vi.mocked(useOverrideMode).mockReset()
    }
  })

  // L.E1.39 (F539(b)): a team with NO seat row at all (D339's unsafe
  // direction) — 139 refuses its switch, so the page offers none and says
  // why, the console's F535(b) rule.
  it('MODE ON, commissioner, a team with NO seat row: no switch — the sentence in its place; a seated unmanaged team never shows the sentence', () => {
    vi.mocked(useOverrideMode).mockReturnValue(true)
    try {
      const seatless = { ...asCommish, members: detail.members.filter((m) => m.team_id !== TEAM) }
      const html = renderTeamPage({ detail: seatless, rosters: unmanagedRosters(false) })
      expect(html).not.toContain('data-autopilot-switch')
      expect(html).toContain('data-no-seat-row')
      expect(html).toContain(NO_SEAT_ROW_AUTOPILOT_COPY)
      const seated = renderTeamPage({ detail: unmanagedDetail, rosters: unmanagedRosters(false) })
      expect(seated).toContain('data-autopilot-switch="off"')
      expect(seated).not.toContain('data-no-seat-row')
    } finally {
      vi.mocked(useOverrideMode).mockReset()
    }
  })

  // R1386 (§16.5.2 "Replace a GM": console → Membership · team page).
  it('the Members door in the team page header — for a commissioner, never for a manager', () => {
    const commish = renderTeamPage({ detail: asCommish })
    const door = commish.match(/<a [^>]*data-door="members"[^>]*>/)?.[0] ?? ''
    expect(door).toContain(`href="/app/leagues/${LEAGUE}/members"`)
    const manager = renderTeamPage()
    expect(manager).not.toContain('data-door="members"')
    expect(manager).not.toContain(`/app/leagues/${LEAGUE}/members`)
  })

  it('MODE OFF: a seatless team shows neither the switch nor the sentence (both are faces of the mode)', () => {
    vi.mocked(useOverrideMode).mockReturnValue(false)
    try {
      const seatless = { ...asCommish, members: detail.members.filter((m) => m.team_id !== TEAM) }
      const html = renderTeamPage({ detail: seatless, rosters: unmanagedRosters(false) })
      expect(html).not.toContain('data-autopilot-switch')
      expect(html).not.toContain('data-no-seat-row')
    } finally {
      vi.mocked(useOverrideMode).mockReset()
    }
  })
})

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

// ---------------------------------------------------------------------------
// M5 L.D2.13 — the seat's FAAB line; F443's kept starter
// ---------------------------------------------------------------------------

describe('L.D2.13 — the FAAB balance on the team page; a dropped-but-played starter stays in his seat (F443)', () => {
  it('a FAAB league prints the seat’s balance against the budget; a priority league its priority', () => {
    const faabRosters: LeagueRosters = { ...rosters, teams: rosters.teams.map((t) => (t.team_id === TEAM ? { ...t, faab_balance: 73 } : t)) }
    expect(renderTeamPage({ rosters: faabRosters })).toMatch(/data-team-waiver-seat="true">\$73 of \$100 FAAB left</)
    const priorityDetail: LeagueDetail = { ...detail, settings: { ...settings, waiver_type: 'rolling_priority' } }
    const priorityRosters: LeagueRosters = { ...rosters, teams: rosters.teams.map((t) => (t.team_id === TEAM ? { ...t, waiver_priority: 2 } : t)) }
    expect(renderTeamPage({ detail: priorityDetail, rosters: priorityRosters })).toMatch(/data-team-waiver-seat="true">Waiver priority #2</)
  })
  it('L.D2.18 (F484): a FAAB league with the stored rolling order prints the tie order after the balance; the manager reads it as his own', () => {
    const tieRosters: LeagueRosters = {
      ...rosters,
      teams: rosters.teams.map((t) => (t.team_id === TEAM ? { ...t, faab_balance: 73, waiver_priority: 4 } : t)),
    }
    expect(renderTeamPage({ rosters: tieRosters })).toMatch(/data-team-waiver-seat="true">\$73 of \$100 FAAB left · Ties on equal bids: you’re #4</)
  })

  it('F443: a stored starter no longer on the roster shows LOCKED in his seat by name — never an empty seat to fill', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
    // The identity read the editor makes for the kept id (usePlayersByIds).
    client.setQueryData(['players-by-ids', ['gone-te']], [{ id: 'gone-te', full_name: 'Gone Tight End', position: 'TE', team: 'AAA', headshot_url: null, status: 'Active', adp: null }])
    const stored: TeamLineupRow = { ...lineupRow, slot_map: { ...lineupRow.slot_map, 'te:0': 'gone-te' } }
    const seatHtml = (currentWeek: number) => {
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
              stored,
              currentWeek,
              editability: currentWeek === 1 ? { state: 'open' } : { state: 'closed', reason: PAST_WEEK_COPY },
              canEdit: true,
              isCommish: false,
              leagueTimeZone: null,
              overrideMode: false,
              onOverrideMode: () => {},
            }),
          ),
        ),
      )
      return html.slice(html.indexOf('data-slot="te:0"'), html.indexOf('data-slot=', html.indexOf('data-slot="te:0"') + 10))
    }
    const seat = seatHtml(1)
    expect(seat).toContain('data-kept-starter')
    expect(seat).toContain('Gone Tight End')
    expect(seat).toContain(KEPT_STARTER_COPY)
    expect(seat).not.toContain('>Empty<')
    // R1221: a past week's record says it neutrally — no "played" / "until the week ends".
    const past = seatHtml(2)
    expect(past).toContain('data-kept-starter')
    expect(past).toContain(KEPT_STARTER_OTHER_WEEK_COPY)
    expect(past).not.toContain(KEPT_STARTER_COPY)
  })
})

// ---------------------------------------------------------------------------
// L.D3.12 — no Propose trade door past the trade deadline (Q76; Chris
// 2026-09-29: "you can't propose trades past the trade deadline")
// ---------------------------------------------------------------------------

describe('the Propose trade door and the trade deadline (L.D3.12)', () => {
  /** The viewer manages team-2 and is looking at TEAM — another team's page. */
  const elsewhere = { ...detail, members: detail.members.map((m) => (m.user_id === 'user-manager' ? { ...m, team_id: 'team-2' } : { ...m, team_id: TEAM })) }
  const view = (passed: boolean): TradeDeadlineState => ({
    state: 'known',
    view: {
      league_id: LEAGUE,
      deadline_week: 11,
      deadline_at: '2099-11-18T05:00:00.000Z',
      why: 'next_week_starts',
      label: 'Wed 2099-11-18 00:00 America/New_York',
      passed,
      ms_remaining: passed ? null : 1000,
      evaluated_at: '2099-11-18T04:59:59.000Z',
    },
  })
  it('before the deadline, while it loads, and before 162 is pushed: the door is there', () => {
    expect(renderTeamPage({ detail: elsewhere, deadline: view(false) })).toContain('data-propose-trade')
    expect(renderTeamPage({ detail: elsewhere })).toContain('data-propose-trade')
    expect(renderTeamPage({ detail: elsewhere, deadline: { state: 'unavailable', reason: 'not pushed' } })).toContain('data-propose-trade')
  })
  it('174 fix round (R1410): no door toward a team with NO manager — nobody could answer the offer', () => {
    const unmanaged = { ...rosters, teams: rosters.teams.map((t) => (t.team_id === TEAM ? { ...t, manager_user_id: null } : t)) }
    expect(renderTeamPage({ detail: elsewhere, deadline: view(false), rosters: unmanaged })).not.toContain('data-propose-trade')
  })
  it('past it (the server said so): no door', () => {
    expect(renderTeamPage({ detail: elsewhere, deadline: view(true) })).not.toContain('data-propose-trade')
  })
})

// ---------------------------------------------------------------------------
// L.E1.41 — the manager's name opens his profile (Chris 2026-09-30: "Clicking
// a user name should always take a user to the user profile they clicked on")
// ---------------------------------------------------------------------------

describe('the team page names its manager — a door to his profile (L.E1.41)', () => {
  it('another team: "Managed by @<username>", the handle a link to /u/<username>', () => {
    const named = {
      ...detail,
      members: detail.members.map((m) =>
        m.user_id === 'user-manager'
          ? { ...m, team_id: 'team-2' }
          : { ...m, team_id: TEAM, profiles: { username: 'chris_gm', avatar_url: null } },
      ),
    }
    const html = renderTeamPage({ detail: named })
    const line = html.slice(html.indexOf('data-team-manager'), html.indexOf('</span>', html.indexOf('data-team-manager')) + 60)
    expect(line).toContain('Managed by <a data-username-link="chris_gm"')
    expect(line).toContain('href="/u/chris_gm">@chris_gm</a>')
    expect(html).not.toContain('Managed by another member')
  })
  it('your own team says "Your team" — no link to yourself', () => {
    const html = renderTeamPage()
    expect(html).toContain('Your team')
    expect(html).not.toContain('data-team-manager')
  })
})

// ---------------------------------------------------------------------------
// League UX batch 3 (D478) — My Team built to the prototype: stat columns +
// Customize, the Lineup check, the projected total, the matchup strip, and
// read-only for anyone who cannot edit.
// ---------------------------------------------------------------------------

describe('My Team (League UX batch 3) — stats, checks, matchup, read-only', () => {
  const stats: LineupStats = {
    games: [{ home_team: 'XXX', away_team: 'BUF', kickoff_at: '2099-09-13T17:00:00.000Z' }],
    splits: [
      { defense: 'BUF', position: 'QB', rank: 32 },
      { defense: 'MIA', position: 'QB', rank: 1 },
      // a full 32-team QB scale so the D486(16) bands apply unscaled
      ...Array.from({ length: 30 }, (_, i) => ({ defense: `T${i + 2}`, position: 'QB', rank: i + 2 })),
    ],
    proj: (id) => ({ qb1: 21.4, 'rb-open': 12.1, 'rb-locked': 9.5, wr1: 0 } as Record<string, number>)[id] ?? null,
    points: (id) => (id === 'qb1' ? { phase: 'done', points: 18.25, pending: [] } : null),
    snap: (id) => (id === 'qb1' ? 97 : null),
  }
  const render = (over: Partial<Parameters<typeof LineupEditor>[0]> = {}) => {
    const client = new QueryClient()
    return unescapeHtml(
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
            editability: { state: 'open' } as WeekEditability,
            canEdit: true,
            isCommish: false,
            leagueTimeZone: null,
            overrideMode: false,
            onOverrideMode: () => {},
            stats,
            ...over,
          }),
        ),
      ),
    )
  }

  it('the default columns are Opp, OPRK, Proj — each a real value, "—" where a read has none', () => {
    const html = render()
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'))
    expect([...head.matchAll(/data-col="(\w+)"/g)].map((m) => m[1])).toEqual(['opp', 'oprk', 'proj'])
    const qb = html.slice(html.indexOf('data-slot="qb:0"'), html.indexOf('data-slot="rb:0"'))
    expect(qb).toContain('vs BUF')
    // 033 rank 32 (the stingiest here) → OPRK 1, a tough (negative) chip.
    expect(qb).toMatch(/data-oprk-tone="negative">1</)
    expect(qb).toContain('21.4')
    // Points / Snap / ADP are off by default.
    expect(head).not.toContain('Points')
  })

  it('Customize is offered in the starters card header', () => {
    const html = render()
    expect(html).toContain('data-customize-columns')
    expect(html).toContain('Customize')
  })

  it('the projected total row sums the starters and names any without a projection', () => {
    const html = render()
    const at = html.indexOf('data-projected-total')
    const total = html.slice(at, html.indexOf('</tr>', at))
    expect(total).toContain('Projected total')
    expect(total).toContain('43.0')
    expect(total).not.toContain('without a projection')
    const partial = render({ stats: { ...stats, proj: (id) => (id === 'qb1' ? 20 : null) } })
    expect(partial).toContain('3 without a projection')
  })

  it('the Lineup check shows chips collapsed, from the arrangement on screen; the strip links to the matchup', () => {
    const html = render()
    expect(html).toContain('Lineup check')
    expect(html).toContain('data-check-chip="starters"')
    expect(html).toContain('data-check-chip="injury"')
    expect(html).toContain('data-check-chip="bye"')
    // No opponent → no Proj-vs-opponent check (never a guess).
    expect(html).not.toContain('data-check-chip="proj"')
    const withOpp = render({
      opponent: { kind: 'opponent', selfName: 'You', name: 'Rivals', href: '/m/1', myScore: 10, oppScore: 12.5, oppProjected: { total: 40, missing: 0 } },
    })
    expect(withOpp).toContain('data-check-chip="proj"')
    expect(withOpp).toContain('+3.0')
    expect(withOpp).toContain('data-matchup-strip')
    expect(withOpp).toContain('12.5')
    expect(withOpp).toContain('proj 43.0')
    expect(withOpp).toContain('proj 40.0')
    expect(withOpp).toContain('data-strip-matchup-link')
    expect(withOpp).toContain('href="/m/1"')
    expect(render({ opponent: { kind: 'bye' } })).toContain('this team has a bye')
  })

  it('the bench card holds the bench and a Reserve section with an empty IR seat', () => {
    const html = render({ stored: { ...lineupRow, slot_map: { 'qb:0': 'qb1' } } })
    const bench = html.slice(html.indexOf('data-bench'))
    expect(bench).toContain('Render RB Open')
    expect(bench).toContain('Reserve')
    expect(bench).toContain('Empty — for players ruled out')
  })

  it('READ-ONLY for another team: no Move, no drag handle, no save indicator', () => {
    const html = render({ canEdit: false })
    expect(html).not.toContain('data-move-menu')
    expect(html).not.toContain('data-player="')
    expect(html).not.toContain('Moves save automatically')
    expect(html).toContain('data-read-only')
    expect(render({ canEdit: false, isCommish: true })).toContain('turn on override mode to change this team’s lineup')
    // Editable: an unlocked row is draggable and has its Move menu.
    const mine = render()
    expect(mine).toContain('data-player="qb1"')
    expect(mine).toContain('data-move-menu="qb1"')
  })

  it('the page makes another manager’s team read-only (no Move, no drag)', () => {
    // The seeded viewer manages team-1; render team-2.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
    client.setQueryData(leaguesKeys.detail(LEAGUE), detail)
    client.setQueryData(leagueRosterKeys.all(LEAGUE), { ...rosters, teams: [rosters.teams[0], { ...rosters.teams[1], roster }] })
    client.setQueryData(scheduleKeys.all(LEAGUE), schedule)
    client.setQueryData(teamLineupKeys.week('team-2', 1), { ...lineupRow, team_id: 'team-2' })
    const html = unescapeHtml(
      renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(TeamPage, { leagueId: LEAGUE, teamId: 'team-2' }))),
    )
    expect(html).toContain('data-read-only')
    expect(html).not.toContain('data-move-menu')
  })
})
