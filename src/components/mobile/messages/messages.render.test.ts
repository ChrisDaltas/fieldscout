/**
 * messages.render.test.ts — render pins for FieldScout Mobile › Messages
 * parts (m-messages §2.1 E/F): the trade-offer card's states, the
 * conversation row's unread treatment and the board row's sender. `renderToStaticMarkup` over the real
 * components.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ConversationRow, boardSender } from './conversation-row'
import { MessagesEmpty } from './messages-empty'
import type { MTradeOffer } from './messages-ops'
import { TradeOfferCard, type OfferAnswers } from './trade-offer-card'

const noop = () => {}

const OFFER: MTradeOffer = {
  id: 'trade-1',
  leagueId: 'league-1',
  name: 'Marcus',
  handle: 'marcus',
  teamName: 'Gridiron Gurus',
  avatarUrl: null,
  colorClass: 'bg-m-ink',
  dir: 'in',
  createdAt: '2026-10-15T11:52:00Z',
  time: '8m',
  gets: ['Darnell Mooney', '$5 FAAB'],
  gives: ['James Conner'],
  status: { label: 'Pending', tone: 'pending' },
  awaitingMe: true,
}

const ALL: OfferAnswers = {
  decline: { onClick: noop, disabled: false },
  counter: { onClick: noop, disabled: false },
  accept: { onClick: noop, disabled: false },
  note: null,
}

function card(offer: MTradeOffer, answers: OfferAnswers | null = null): string {
  return renderToStaticMarkup(createElement(TradeOfferCard, { offer, onOpen: noop, answers }))
}

describe('TradeOfferCard', () => {
  it('shows an offer waiting on me with its three answers, and opens the offer', () => {
    const html = card(OFFER, ALL)
    expect(html).toContain('Sent to you · 8m')
    expect(html).toContain('data-trade-offer-status="pending"')
    expect(html).toContain('bg-m-go text-m-to')
    expect(html).toContain('>Pending</span>')
    expect(html).toContain('You get')
    expect(html).toContain('Darnell Mooney')
    expect(html).toContain('$5 FAAB')
    expect(html).toContain('You give')
    expect(html).toContain('James Conner')
    expect(html).toContain('data-trade-offer-actions')
    expect(html).toContain('grid-cols-3')
    for (const label of ['Decline', 'Counter', 'Accept']) expect(html).toContain(`>${label}</button>`)
    expect(html).toContain('aria-label="Open trade offer from Marcus"')
  })

  it('shows only the answers the league takes, and says why Accept is missing', () => {
    const html = card(OFFER, { ...ALL, counter: null, accept: null, note: 'Trades are closed for the season.' })
    expect(html).toContain('grid-cols-1')
    expect(html).toContain('>Decline</button>')
    expect(html).not.toContain('>Accept</button>')
    expect(html).toContain('Trades are closed for the season.')
    const checking = card(OFFER, { ...ALL, accept: { onClick: noop, disabled: true } })
    expect(checking).toMatch(/disabled=""[^>]*>Accept<\/button>/)
  })

  it('has no answers once resolved, or for an offer I sent', () => {
    const accepted = card({ ...OFFER, status: { label: 'Accepted', tone: 'accepted' }, awaitingMe: false })
    expect(accepted).toContain('bg-m-gg text-m-tg')
    expect(accepted).not.toContain('data-trade-offer-actions')
    const withdrawn = card({ ...OFFER, status: { label: 'Withdrawn', tone: 'neutral' }, awaitingMe: false })
    expect(withdrawn).toContain('bg-m-b2 text-m-t3')
    const mine = card({ ...OFFER, dir: 'out', awaitingMe: false })
    expect(mine).toContain('You sent · 8m')
    expect(mine).toContain('aria-label="Open trade offer to Marcus"')
    expect(mine).not.toContain('data-trade-offer-actions')
  })

  it('says Nothing for an empty side', () => {
    expect(card({ ...OFFER, gives: [] })).toContain('>Nothing</span>')
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
