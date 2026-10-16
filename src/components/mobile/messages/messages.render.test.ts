/**
 * messages.render.test.ts — render pins for FieldScout Mobile › Messages
 * (m-messages §2.1): the list is conversations only (Chris, ruling #22,
 * 2026-10-15 — trades stay inside their league), the conversation row's
 * unread treatment, the board row's sender, and the header's chat badge.
 * `renderToStaticMarkup` over the real components, the React Query cache
 * pre-seeded (fetches are effects, so the cache IS the data).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { leagueChatKeys } from '@/hooks/use-league-chat'
import { leaguesKeys, type MyLeagueRow } from '@/hooks/use-leagues'
import { tradeKeys } from '@/hooks/use-trades'
import { HeaderActions } from '@/components/mobile/ui/mobile-header'

import { ConversationRow, boardSender } from './conversation-row'
import { MessagesEmpty } from './messages-empty'
import { MESSAGES_EMPTY_TITLE, MobileMessagesList } from './messages-list-screen'
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

/** A trade sent to my team, still waiting on my answer. */
const PENDING_OFFER = {
  trades: [
    {
      id: 'T1',
      status: 'proposed',
      proposer: { team_id: 'team-marcus', name: 'Gridiron Gurus' },
      recipient: { team_id: 'team-me', name: 'Touchdown Tacos' },
      created_at: '2026-10-15T11:52:00Z',
      items: [],
      drops: [],
    },
  ],
  viewer: { team_id: 'team-me', is_commissioner: false },
  evaluated_at: '2026-10-15T12:00:00Z',
}

function client(leagues: MyLeagueRow[] | null): QueryClient {
  const qc = new QueryClient()
  if (leagues) qc.setQueryData(leaguesKeys.all, leagues)
  for (const l of leagues ?? []) {
    qc.setQueryData(leagueChatKeys.board(l.id), [
      { id: 'c1', user_id: 'user-me', message: 'Waiver wire is thin', context: 'league', is_system: false, created_at: '2026-10-15T11:00:00Z' },
    ])
    qc.setQueryData(leaguesKeys.detail(l.id), { members: [] })
    // A pending offer in the cache — Messages must not show or count it.
    qc.setQueryData(tradeKeys.list(l.id, 'all', null), PENDING_OFFER)
  }
  qc.setQueryData(['notifications'], { notifications: [], unreadCount: 0 })
  return qc
}

function list(leagues: MyLeagueRow[] | null): string {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: client(leagues) }, createElement(MobileMessagesList)))
}

describe('Messages list — conversations only (ruling #22)', () => {
  it('has the title and Search but no All / Trades control and no trade offers', () => {
    const html = list([LEAGUE])
    expect(html).toMatch(/<h1[^>]*>Messages<\/h1>/)
    expect(html).toContain('aria-label="Search messages"')
    expect(html).not.toContain('Message filter')
    expect(html).not.toMatch(/>Trades</)
    expect(html).not.toContain('data-trade-offer')
    expect(html).not.toContain('waiting on you')
  })

  it("lists each league's message board as a conversation", () => {
    const html = list([LEAGUE])
    expect(html).toContain('data-conversations')
    expect(html).toContain('href="/app/messages/league-L1"')
    expect(html).toContain('Sunday Funday League')
    expect(html).toContain('You: Waiver wire is thin')
  })

  it('says what will show up when there is nothing yet, and loads with skeleton rows', () => {
    const empty = list([])
    expect(empty).toContain(MESSAGES_EMPTY_TITLE)
    expect(empty).toContain('Your leagues’ message boards and direct messages will show up here.')
    expect(list(null)).toContain('data-skeleton="conversation"')
  })
})

describe('a league board thread', () => {
  it('lists the posts oldest → newest (it opens scrolled to the newest, #47) under a plain Back (#27)', () => {
    const qc = client([LEAGUE])
    qc.setQueryData(leagueChatKeys.board('L1'), [
      { id: 'c1', user_id: 'user-priya', message: 'Who needs a kicker?', context: 'league', is_system: false, created_at: '2026-10-15T10:00:00Z' },
      { id: 'c2', user_id: 'user-me', message: 'Waiver wire is thin', context: 'league', is_system: false, created_at: '2026-10-15T11:00:00Z' },
    ])
    qc.setQueryData(leaguesKeys.detail('L1'), {
      league: { id: 'L1', name: 'Sunday Funday League' },
      teams: [],
      members: [
        { user_id: 'user-me', team_id: null, profiles: { username: 'me', avatar_url: null } },
        { user_id: 'user-priya', team_id: null, profiles: { username: 'priya', avatar_url: null } },
      ],
    })
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(MobileThreadScreen, { threadId: 'league-L1' })))
    expect(html).toMatch(/<button type="button" aria-label="Back"/)
    expect(html).not.toContain('Back to Messages')
    expect(html).toMatch(/role="log"[\s\S]*Who needs a kicker\?[\s\S]*Waiver wire is thin/)
    expect(html).toContain('data-composer')
  })

  it('a dead thread’s way out is the header’s Back (#27), never a push to the list that leaves it behind', () => {
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: client([LEAGUE]) }, createElement(MobileThreadScreen, { threadId: 'dm-gone' })))
    expect(html).toContain('Conversation not found')
    expect(html).toMatch(/<button type="button"[^>]*data-thread-go-back[^>]*>Go back<\/button>/)
    expect(html).not.toContain('href="/app/messages"')
  })
})

describe('header chat badge', () => {
  it('counts unread direct messages only — never trade offers', () => {
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: client([LEAGUE]) }, createElement(HeaderActions)))
    const chat = html.match(/<a [^>]*aria-label="Messages"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? ''
    expect(chat).toContain('href="/app/messages"')
    // No DM backend yet, so no DM is unread — and the pending offer above
    // must not light it.
    expect(chat).not.toContain('rounded-pill')
  })
})

describe('board sender', () => {
  const members = [{ user_id: 'u1', profiles: { username: 'priya' } }]
  it('labels a member by handle, calls a missing one a former member, and names nobody when the members are unknown', () => {
    expect(boardSender('u1', members)).toBe('@priya')
    expect(boardSender('u9', members)).toBe('Former member')
    expect(boardSender(null, members)).toBe('Former member')
    expect(boardSender('u1', null)).toBeNull()
  })
})

describe('ConversationRow', () => {
  const row = (unread: boolean) =>
    renderToStaticMarkup(
      createElement(ConversationRow, {
        href: '/app/messages/marcus',
        name: 'Marcus',
        avatar: null,
        preview: 'Sent it over, check your trades · 8m',
        unread,
      }),
    )

  it('bolds an unread conversation and shows the blue dot', () => {
    const html = row(true)
    expect(html).toContain('href="/app/messages/marcus"')
    expect(html).toContain('font-semibold text-m-t1')
    expect(html).toContain('data-unread-dot')
  })

  it('keeps a read one at 500 / t3 with no dot', () => {
    const html = row(false)
    expect(html).toContain('font-medium text-m-t3')
    expect(html).not.toContain('data-unread-dot')
  })
})

describe('MessagesEmpty', () => {
  it('renders the title and body', () => {
    const html = renderToStaticMarkup(createElement(MessagesEmpty, { title: 'No messages yet', body: 'Later.' }))
    expect(html).toContain('No messages yet')
    expect(html).toContain('Later.')
  })
})
