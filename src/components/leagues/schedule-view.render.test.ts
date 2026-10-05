/**
 * schedule-view.render.test.ts — F580 / D493 supersedes the R1459 pins below:
 * the Edit moved to the Commissioner console. Originally R1459 (PR #395 fix round): the per-week Edit
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
import { SCHEDULE_COMMISH_HINT_COPY, scheduleConsoleHref } from './schedule-view-ops'
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

describe('F580 / D493 — the member Schedule page carries no commissioner Edit; it points to the console', () => {
  it('a commissioner sees NO Edit even on a week whose window is open — and a link to the console door', () => {
    useCommishOverrideStore.setState({ leagueId: null })
    state.role = 'commissioner'
    state.schedule = SCHEDULE
    const html = render()
    expect(editCount(html)).toBe(0)
    expect(html).toContain('data-schedule-commish-hint')
    expect(html).toContain(`href="${scheduleConsoleHref('L')}"`)
    expect(html).toContain(SCHEDULE_COMMISH_HINT_COPY)
  })

  it('a manager sees no Edit and no console pointer', () => {
    state.role = 'manager'
    state.schedule = SCHEDULE
    const html = render()
    expect(editCount(html)).toBe(0)
    expect(html).not.toContain('data-schedule-commish-hint')
  })
})
