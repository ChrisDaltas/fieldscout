/**
 * whos-online.render.test.ts — gap list §3 #25 in Messages: the design's
 * green dot and "Active now" (m-messages §2.1 C/E, §2.2 A) on the people
 * row, the conversation rows and the thread header, and the board thread's
 * "N members · N online". `renderToStaticMarkup` over the real screens, the
 * React Query cache pre-seeded.
 *
 * The presence store is filled by the session's PresenceHost over a live
 * socket, which a static render never has, so its read is stubbed with a set
 * the test controls. Direct messages have no backend (the feed is empty), so
 * the DM feed hook is stubbed with one conversation — what the rows draw
 * once a feed exists.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { leagueChatKeys } from '@/hooks/use-league-chat'
import { leaguesKeys, type MyLeagueRow } from '@/hooks/use-leagues'
import type { MDmConversation } from '@/hooks/use-mobile-messages-dms'
import { ACTIVE_NOW, activeNowLine } from '@/components/mobile/ui/online-dot'

import { MessagesAvatar } from './messages-avatar'
import { MobileMessagesList } from './messages-list-screen'
import { membersOnlineLine } from './messages-ops'
import { MobileThreadScreen } from './thread-screen'

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

const presence = vi.hoisted(() => ({ online: new Set<string>() }))
vi.mock('@/hooks/use-online', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/use-online')>()
  return {
    ...actual,
    useIsOnline: (id: string | null | undefined) => !!id && presence.online.has(id),
    useOnlineUserIds: () => presence.online,
  }
})

const MARCUS: MDmConversation = {
  id: 'dm-marcus',
  name: '@marcus',
  userId: 'user-marcus',
  initial: 'M',
  avatarUrl: null,
  colorClass: 'bg-m-ink',
  teamName: 'Gridiron Gurus',
  leagueName: 'Sunday Funday League',
  unread: false,
  messages: [
    { id: 'x1', fromMe: false, senderKey: 'dm-marcus', senderName: '@marcus', senderUsername: null, senderAvatarUrl: null, senderColorClass: 'bg-m-ink', text: 'You still shopping Conner?', at: null },
  ],
  preview: 'You still shopping Conner?',
  time: '8m',
  lastAt: null,
}
const dms = vi.hoisted(() => ({ conversations: [] as MDmConversation[] }))
vi.mock('@/hooks/use-mobile-messages-dms', () => ({
  useMobileMessagesDms: () => ({ enabled: true, conversations: dms.conversations }),
}))

const LEAGUE: MyLeagueRow = {
  id: 'L1',
  name: 'Sunday Funday League',
  avatar_url: null,
  season: 2026,
  status: 'in_season',
  team_count: 12,
  created_at: '2026-08-01T00:00:00Z',
  my_role: 'member',
  my_team_id: 'team-me',
}

function client(): QueryClient {
  const qc = new QueryClient()
  qc.setQueryData(leaguesKeys.all, [LEAGUE])
  qc.setQueryData(leagueChatKeys.board('L1'), [
    { id: 'c1', user_id: 'user-priya', message: 'Who’s starting Shough?', context: 'league', is_system: false, created_at: '2026-10-15T11:00:00Z' },
  ])
  qc.setQueryData(leaguesKeys.detail('L1'), {
    league: { id: 'L1', name: 'Sunday Funday League' },
    teams: [],
    members: [
      { user_id: 'user-me', team_id: null, profiles: { username: 'me', avatar_url: null } },
      { user_id: 'user-priya', team_id: null, profiles: { username: 'priya', avatar_url: null } },
      { user_id: 'user-leo', team_id: null, profiles: { username: 'leo', avatar_url: null } },
    ],
  })
  qc.setQueryData(['notifications'], { notifications: [], unreadCount: 0 })
  return qc
}

const render = (element: React.ReactElement) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: client() }, element)).replace(/&#x27;/g, "'")

afterEach(() => {
  presence.online = new Set()
  dms.conversations = []
})

describe('the copy', () => {
  it('"Active now · {team}" while online, else just the team (§2.2 A)', () => {
    expect(activeNowLine(true, 'Gridiron Gurus')).toBe('Active now · Gridiron Gurus')
    expect(activeNowLine(false, 'Gridiron Gurus')).toBe('Gridiron Gurus')
    expect(activeNowLine(true, null)).toBe(ACTIVE_NOW)
  })

  it('"8 members · 3 online" counts you once anyone else is here; alone it stays "8 members"', () => {
    expect(membersOnlineLine(8, 2)).toBe('8 members · 3 online')
    expect(membersOnlineLine(8, 0)).toBe('8 members')
    expect(membersOnlineLine(1, 0)).toBe('1 member')
  })
})

describe('the avatar', () => {
  const avatar = (online?: boolean) =>
    renderToStaticMarkup(
      createElement(MessagesAvatar, { text: 'M', sizeClass: 'size-[52px]', colorClass: 'bg-m-ink', textClass: 'text-[16px]', online }),
    )

  it('online: the 13px dot with the 2.5px ring at right 1 / bottom 1 (§2.1 C/E), and "Online" for screen readers', () => {
    const html = avatar(true)
    expect(html).toMatch(
      /class="[^"]*\bbg-confirm\b[^"]*\bring-m-b0\b[^"]*\bsize-\[13px\][^"]*\bring-\[2\.5px\][^"]*\bbottom-px\b[^"]*\bright-px\b[^"]*" data-online-dot/,
    )
    expect(html).toContain('<span class="sr-only">Online</span>')
  })

  it('offline keeps the same frame with no dot; a league tile (no presence) has no frame at all', () => {
    expect(avatar(false)).toContain('data-online="false"')
    expect(avatar(false)).not.toContain('data-online-dot')
    expect(avatar(undefined)).not.toContain('data-online')
  })
})

describe('Messages list — the people row and rows (§2.1 C/E)', () => {
  it('a league-mate online: the dot in the people row and on their conversation row', () => {
    dms.conversations = [MARCUS]
    presence.online = new Set(['user-marcus'])
    const html = render(createElement(MobileMessagesList))
    const people = html.slice(html.indexOf('data-people-row'), html.indexOf('data-conversations'))
    expect(people.match(/data-online-dot/g)).toHaveLength(1)
    const rows = html.slice(html.indexOf('data-conversations'))
    expect(rows.match(/data-online-dot/g)).toHaveLength(1)
  })

  it('offline: no dot; a league board row never has one', () => {
    dms.conversations = [MARCUS]
    const html = render(createElement(MobileMessagesList))
    expect(html).not.toContain('data-online-dot')
    presence.online = new Set(['user-priya'])
    dms.conversations = []
    expect(render(createElement(MobileMessagesList))).not.toContain('data-online-dot')
  })
})

describe('a conversation header (§2.2 A)', () => {
  it('1:1, online: the 10px dot and "Active now · Gridiron Gurus"', () => {
    dms.conversations = [MARCUS]
    presence.online = new Set(['user-marcus'])
    const html = render(createElement(MobileThreadScreen, { threadId: 'dm-marcus' }))
    expect(html).toMatch(/class="[^"]*\bsize-2\.5\b[^"]*\bring-2\b[^"]*" data-online-dot/)
    expect(html).toContain('>Active now · Gridiron Gurus<')
  })

  it('1:1, offline: just the team, no dot', () => {
    dms.conversations = [MARCUS]
    const html = render(createElement(MobileThreadScreen, { threadId: 'dm-marcus' }))
    expect(html).toContain('>Gridiron Gurus<')
    expect(html).not.toContain('Active now')
    expect(html).not.toContain('data-online-dot')
  })

  it('a league board: "3 members · 2 online" with a league-mate here, "3 members" with only you', () => {
    presence.online = new Set(['user-priya'])
    expect(render(createElement(MobileThreadScreen, { threadId: 'league-L1' }))).toContain('>3 members · 2 online<')
    presence.online = new Set()
    expect(render(createElement(MobileThreadScreen, { threadId: 'league-L1' }))).toContain('>3 members<')
  })

  it('someone online who is not in this league does not count', () => {
    presence.online = new Set(['user-stranger'])
    expect(render(createElement(MobileThreadScreen, { threadId: 'league-L1' }))).toContain('>3 members<')
  })
})
