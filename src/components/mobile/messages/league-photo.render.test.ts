/**
 * league-photo.render.test.ts — a league's uploaded photo in Messages
 * (gap list §3 #20, audit messages-1): the board's row in the list and the
 * board thread's header draw the league's photo when it has one, its
 * letters otherwise — as the dock, the switcher and Home already do.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { leagueChatKeys } from '@/hooks/use-league-chat'
import { leaguesKeys, type MyLeagueRow } from '@/hooks/use-leagues'

const flags = vi.hoisted(() => ({ leagues: true, messages: true }))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: flags }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/messages',
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-me' }, profile: { username: 'me' } }),
}))
vi.mock('@/hooks/use-league-channel', () => ({
  useLeagueChannel: () => ({ connection: 'live' }),
}))
// Radix's avatar shows its image only after the browser loads it — a static
// render never does; expose which photo each league mark was handed.
vi.mock('./messages-avatar', () => ({
  MessagesAvatar: ({ text, src }: { text: string; src?: string | null }) =>
    createElement('span', { 'data-photo': src ?? 'none' }, text),
}))

import { MobileMessagesList } from './messages-list-screen'
import { MobileThreadScreen } from './thread-screen'

const PHOTO = 'https://img.test/sunday-funday.png'

const league = (id: string, name: string, avatar_url: string | null): MyLeagueRow => ({
  id,
  name,
  avatar_url,
  season: 2026,
  status: 'in_season',
  team_count: 12,
  created_at: '2026-08-01T00:00:00Z',
  my_role: 'member',
  my_team_id: 'team-me',
})

const WITH_PHOTO = league('L1', 'Sunday Funday League', PHOTO)
const NO_PHOTO = league('L2', 'Dynasty Den', null)

function client(leagues: MyLeagueRow[]): QueryClient {
  const qc = new QueryClient()
  qc.setQueryData(leaguesKeys.all, leagues)
  for (const l of leagues) qc.setQueryData(leagueChatKeys.board(l.id), [])
  qc.setQueryData(['notifications'], { notifications: [], unreadCount: 0 })
  return qc
}

const render = (qc: QueryClient, el: ReactElement) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, el))

/** Every avatar drawn as "photo|letters" — on an empty board, only the header's league mark. */
function headerMarks(html: string): string[] {
  return [...html.matchAll(/<span data-photo="([^"]*)">([^<]*)<\/span>/g)].map((m) => `${m[1]}|${m[2]}`)
}

describe('Messages list — a league board row', () => {
  it('shows the league’s photo when one is uploaded, its letters otherwise', () => {
    const qc = client([WITH_PHOTO, NO_PHOTO])
    for (const l of [WITH_PHOTO, NO_PHOTO]) qc.setQueryData(leaguesKeys.detail(l.id), { members: [] })
    const rows = render(qc, createElement(MobileMessagesList)).split('data-conversation-row').slice(1)
    const row = (name: string) => rows.find((r) => r.includes(name)) ?? ''
    expect(row('Sunday Funday League')).toContain(`data-photo="${PHOTO}">SF<`)
    expect(row('Dynasty Den')).toContain('data-photo="none">DD<')
  })
})

describe('a league board thread — the header mark', () => {
  const detail = (avatar_url: string | null) => ({
    league: { id: 'L1', name: 'Sunday Funday League', avatar_url },
    teams: [],
    members: [{ user_id: 'user-me', team_id: null, profiles: { username: 'me', avatar_url: null } }],
  })
  const thread = (qc: QueryClient) => render(qc, createElement(MobileThreadScreen, { threadId: 'league-L1' }))

  it('shows the league’s photo once the league is read', () => {
    const qc = client([WITH_PHOTO])
    qc.setQueryData(leaguesKeys.detail('L1'), detail(PHOTO))
    expect(headerMarks(thread(qc))).toEqual([`${PHOTO}|SF`])
  })

  it('shows the photo from your leagues while the league itself is still loading', () => {
    expect(headerMarks(thread(client([WITH_PHOTO])))).toEqual([`${PHOTO}|SF`])
  })

  it('shows its letters when it has no photo', () => {
    const qc = client([league('L1', 'Sunday Funday League', null)])
    qc.setQueryData(leaguesKeys.detail('L1'), detail(null))
    expect(headerMarks(thread(qc))).toEqual(['none|SF'])
  })

  it('a photo the commissioner removed doesn’t linger from your list of leagues', () => {
    const qc = client([WITH_PHOTO])
    qc.setQueryData(leaguesKeys.detail('L1'), detail(null))
    expect(headerMarks(thread(qc))).toEqual(['none|SF'])
  })
})
