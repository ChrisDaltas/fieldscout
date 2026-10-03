/**
 * schedule-view.render.test.ts — R1459 (PR #395 fix round): the per-week Edit
 * is the NORMAL commissioner verb (`/schedule/matchup`, the open-window edit),
 * so it is offered to a commissioner whenever that window is open — override
 * mode OFF included — and is absent once the window has closed (changing a
 * closed week is an override action, reached through the console's
 * `/commish/schedule`). Rig: `renderToStaticMarkup` over the REAL
 * `ScheduleView` with the league / schedule hooks stubbed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { LeagueDetail } from '@/hooks/use-league'
import type { LeagueSchedule } from '@/hooks/use-schedule'
import { useCommishOverrideStore } from '@/stores/commish-override-store'

import { ScheduleView } from './schedule-view'
import { SCHEDULE } from './standings-schedule.fixtures'

const state: { role: string; schedule: LeagueSchedule } = { role: 'commissioner', schedule: SCHEDULE }

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/',
}))
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'user-me' }, profile: null }) }))
vi.mock('@/hooks/use-league', () => ({
  useLeague: () => ({
    isPending: false,
    isError: false,
    data: {
      my_role: state.role,
      members: [],
      teams: [
        { id: 't1', name: 'Alpha', status: 'active' },
        { id: 't2', name: 'Bravo', status: 'active' },
        { id: 't3', name: 'Charlie', status: 'active' },
        { id: 't4', name: 'Delta', status: 'active' },
      ],
      settings: { regular_season_weeks: 3, schedule_mode: 'h2h' },
    } as unknown as LeagueDetail,
  }),
}))
vi.mock('@/hooks/use-schedule', () => ({
  useScheduleLive: () => ({ data: state.schedule, isError: false, error: null, connection: 'live' }),
  useEditMatchup: () => ({ mutate: () => {}, isPending: false }),
}))

function render(): string {
  const qc = new QueryClient()
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(ScheduleView, { leagueId: 'L' })))
}
const editCount = (html: string) => html.split('data-edit-matchup').length - 1

describe('R1459 — the schedule page’s Edit follows the normal window, not override mode', () => {
  it('a commissioner with override mode OFF sees Edit on a week whose window is still open', () => {
    useCommishOverrideStore.setState({ leagueId: null })
    state.role = 'commissioner'
    state.schedule = SCHEDULE
    expect(editCount(render())).toBeGreaterThan(0)
  })

  it('the same commissioner (override OFF) sees no Edit once that week’s window has closed', () => {
    useCommishOverrideStore.setState({ leagueId: null })
    state.role = 'commissioner'
    state.schedule = {
      ...SCHEDULE,
      weeks: SCHEDULE.weeks.map((w) => (w.status === 'upcoming' ? { ...w, status: 'live' } : w)),
    }
    expect(editCount(render())).toBe(0)
  })

  it('a manager never sees Edit', () => {
    state.role = 'manager'
    state.schedule = SCHEDULE
    expect(editCount(render())).toBe(0)
  })
})
