/**
 * messages-ops.test.ts — the pure rules of FieldScout Mobile › Messages
 * (docs/design/mobile/m-messages.md): times, previews, the bubble-run
 * geometry, search, thread ids, the DM feed's view model (the same empty
 * feed the desktop rail renders), and a league's trade offers as Home's
 * league-card dot reads them (Messages itself shows no trades — ruling #22;
 * the Trades tab's search, direction words and cross-league merge went with
 * it).
 */
import { describe, expect, it } from 'vitest'

import type { RailDmThread } from '@/components/layout/rail/messages-panel'
import type { LeagueDetail } from '@/hooks/use-league'
import { dmViewModel } from '@/hooks/use-mobile-messages-dms'
import type { TradeView, TradesDocument } from '@/lib/leagues/api/trades-service'

import {
  FORMER_MEMBER,
  MANAGER_COLORS,
  MY_COLOR,
  NEAR_TOP_PX,
  boardRows,
  bubbleRadius,
  dayLabel,
  firstMessageOf,
  followsNewMessage,
  isNearBottom,
  isNearTop,
  lastMessageOf,
  olderState,
  PIN_SLACK_PX,
  senderHandle,
  initialOf,
  keyColor,
  leagueIdOfThread,
  leagueThreadId,
  matchesName,
  leagueTradeOffers,
  membersLine,
  pendingCount,
  previewLine,
  previewText,
  seatColor,
  shortTime,
  threadHref,
  threadItems,
  tradeOfferStatus,
  type MChatMessage,
} from './messages-ops'

// Thu 15 Oct 2026, 12:00 local.
const NOW = new Date(2026, 9, 15, 12, 0, 0)
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN

function msg(id: string, sender: string, at: string | null = null, text = id): MChatMessage {
  return {
    id,
    fromMe: sender === 'me',
    senderKey: sender,
    senderName: sender === 'me' ? 'You' : senderHandle(sender),
    senderUsername: sender === 'me' ? null : sender,
    senderAvatarUrl: null,
    senderColorClass: sender === 'me' ? MY_COLOR : 'bg-m-ink',
    text,
    at,
  }
}

describe('names', () => {
  it('shows a handle as the design does: no @, first letter capitalised', () => {
    expect(senderHandle('marcus')).toBe('@marcus')
    expect(senderHandle('@priya')).toBe('@priya')
    expect(senderHandle(null)).toBe(FORMER_MEMBER)
    expect(senderHandle('')).toBe(FORMER_MEMBER)
  })
  // Ruling #8 (2026-10-15): a photoless person shows TWO letters, the
  // app-wide rule — never the "@", never one letter.
  it('takes two letters, the app-wide avatar rule', () => {
    expect(initialOf('Marcus')).toBe('MA')
    expect(initialOf(' nina')).toBe('NI')
    expect(initialOf('@marcus')).toBe('MA')
    expect(initialOf('Former member')).toBe('FM')
    expect(initialOf('')).toBe('?')
    expect(initialOf('@')).toBe('?')
  })
})

describe('avatar colours', () => {
  it('keeps blue for the viewer and cycles the other eleven TEAMS colours by seat', () => {
    expect(MY_COLOR).toBe('bg-accent')
    expect(seatColor(0)).toBe('bg-m-ink')
    expect(seatColor(1)).toBe('bg-pos-wr')
    expect(seatColor(10)).toBe('bg-n-3')
    expect(seatColor(11)).toBe('bg-m-ink')
    for (let i = 0; i < 30; i++) expect(seatColor(i)).not.toBe(MY_COLOR)
  })
  it('gives an id with no seat a stable colour from the palette', () => {
    expect(keyColor('thread-1')).toBe(keyColor('thread-1'))
    expect(MANAGER_COLORS).toContain(keyColor('anything'))
    expect(keyColor('x')).not.toBe(MY_COLOR)
  })
})

describe('shortTime (the list time)', () => {
  it('reads now / minutes / hours / weekday / date', () => {
    expect(shortTime(ago(20_000), NOW)).toBe('now')
    expect(shortTime(ago(2 * MIN), NOW)).toBe('2m')
    expect(shortTime(ago(59 * MIN), NOW)).toBe('59m')
    expect(shortTime(ago(HOUR), NOW)).toBe('1h')
    expect(shortTime(ago(5 * HOUR), NOW)).toBe('5h')
    // Tue 13 Oct
    expect(shortTime(new Date(2026, 9, 13, 9, 0).toISOString(), NOW)).toBe('Tue')
    expect(shortTime(new Date(2026, 8, 24, 9, 0).toISOString(), NOW)).toBe('Sep 24')
    expect(shortTime(new Date(2025, 8, 24, 9, 0).toISOString(), NOW)).toBe('Sep 24, 2025')
  })
  it('is empty for an unreadable instant', () => {
    expect(shortTime('not a date', NOW)).toBe('')
  })
})

describe('dayLabel (the thread separator)', () => {
  it('says Today, Yesterday, else weekday and date', () => {
    expect(dayLabel(ago(HOUR), NOW)).toBe('Today')
    expect(dayLabel(new Date(2026, 9, 14, 23, 0).toISOString(), NOW)).toBe('Yesterday')
    expect(dayLabel(new Date(2026, 9, 12, 8, 0).toISOString(), NOW)).toBe('Mon, Oct 12')
  })
})

describe('previews', () => {
  it('prefixes You: for mine, the sender in a group, nothing in a DM', () => {
    expect(previewText({ fromMe: true, senderName: 'You', text: 'Value play' }, false)).toBe('You: Value play')
    expect(previewText({ fromMe: false, senderName: 'Marcus', text: 'Still 8-0. Just saying.' }, true)).toBe(
      'Marcus: Still 8-0. Just saying.',
    )
    expect(previewText({ fromMe: false, senderName: 'Nina', text: 'Want to swap kickers?' }, false)).toBe(
      'Want to swap kickers?',
    )
  })
  it('joins the time into the same line', () => {
    expect(previewLine('You: Value play', '1h')).toBe('You: Value play · 1h')
    expect(previewLine('No messages yet', null)).toBe('No messages yet')
  })
})

describe('search', () => {
  it('matches names case-insensitively and untrimmed (a lone space finds names with a space)', () => {
    expect(matchesName('Sunday Funday League', 'funday')).toBe(true)
    expect(matchesName('Marcus', '')).toBe(true)
    expect(matchesName('Marcus', ' ')).toBe(false)
    expect(matchesName('Sunday Funday League', ' ')).toBe(true)
  })
})

describe('bubble geometry', () => {
  it('rounds corners by sender and run position (TL TR BR BL)', () => {
    expect(bubbleRadius(true, true)).toBe('rounded-[18px_18px_6px_18px]')
    expect(bubbleRadius(true, false)).toBe('rounded-[18px_6px_6px_18px]')
    expect(bubbleRadius(false, true)).toBe('rounded-[18px_18px_18px_6px]')
    expect(bubbleRadius(false, false)).toBe('rounded-[6px_18px_18px_6px]')
  })

  it("lays out Marcus's thread like the prototype: avatar on the last of a run, spacer before, 8px between runs", () => {
    const items = threadItems([msg('a', 'marcus'), msg('b', 'me'), msg('c', 'marcus'), msg('d', 'marcus')], false, NOW)
    const rows = items.filter((i) => i.kind === 'msg')
    expect(items.some((i) => i.kind === 'day')).toBe(false) // no times → no separator
    expect(rows.map((r) => [r.firstOfRun, r.lastOfRun, r.showAvatar, r.spacer, r.gapTop])).toEqual([
      [true, true, true, false, false],
      [true, true, false, false, true],
      [true, false, false, true, true],
      [false, true, true, false, false],
    ])
    expect(rows.every((r) => !r.showName)).toBe(true)
  })

  it('labels the first bubble of their runs in a group, never mine', () => {
    const items = threadItems([msg('a', 'priya'), msg('b', 'leo'), msg('c', 'leo'), msg('d', 'me')], true, NOW)
    const names = items.flatMap((i) => (i.kind === 'msg' ? [i.showName] : []))
    expect(names).toEqual([true, true, false, false])
  })

  it('puts a separator before each day and ends a run at the day boundary', () => {
    const y = new Date(2026, 9, 14, 20, 0).toISOString()
    const t = ago(HOUR)
    const items = threadItems([msg('a', 'leo', y), msg('b', 'leo', t), msg('c', 'leo', t)], true, NOW)
    expect(items.map((i) => (i.kind === 'day' ? i.label : i.key))).toEqual(['Yesterday', 'a', 'Today', 'b', 'c'])
    const [a, b] = items.filter((i) => i.kind === 'msg')
    expect(a.lastOfRun).toBe(true)
    expect(b.firstOfRun).toBe(true)
    expect(b.showName).toBe(true)
  })
})

describe('following the conversation (#47)', () => {
  it('at the bottom, or within a finger’s rest of it, is pinned', () => {
    expect(isNearBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(true)
    expect(isNearBottom({ scrollTop: 600 - PIN_SLACK_PX, scrollHeight: 1000, clientHeight: 400 })).toBe(true)
    expect(isNearBottom({ scrollTop: 600 - PIN_SLACK_PX - 1, scrollHeight: 1000, clientHeight: 400 })).toBe(false)
    // Scrolled up to read.
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 1000, clientHeight: 400 })).toBe(false)
    // Nothing to scroll: at the bottom.
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 400 })).toBe(true)
  })

  it('a newcomer is followed only while pinned — except the reader’s own message', () => {
    expect(followsNewMessage({ pinned: true, fromMe: false })).toBe(true)
    expect(followsNewMessage({ pinned: false, fromMe: false })).toBe(false)
    expect(followsNewMessage({ pinned: false, fromMe: true })).toBe(true)
  })

  it('the newest message skips the day separators', () => {
    const t = ago(HOUR)
    const items = threadItems([msg('a', 'leo', t), msg('b', 'me', t)], true, NOW)
    expect(lastMessageOf(items)).toEqual({ key: items[items.length - 1]!.key, fromMe: true })
    expect(lastMessageOf([{ kind: 'day', key: 'd', label: 'Today' }])).toBeNull()
    expect(lastMessageOf([])).toBeNull()
  })
})

describe('older posts as you scroll up (gap list §3 #23)', () => {
  it('asks for more once the top of the list is within about a screen above the view', () => {
    expect(isNearTop({ listTop: 100, viewTop: 0 })).toBe(true)
    expect(isNearTop({ listTop: -NEAR_TOP_PX, viewTop: 0 })).toBe(true)
    expect(isNearTop({ listTop: -NEAR_TOP_PX - 1, viewTop: 0 })).toBe(false)
    // Measured against where the scroller's view starts, not the page's top.
    expect(isNearTop({ listTop: 56 - NEAR_TOP_PX, viewTop: 56 })).toBe(true)
    expect(isNearTop({ listTop: 55 - NEAR_TOP_PX, viewTop: 56 })).toBe(false)
  })

  it('the oldest message skips the day separators', () => {
    const t = ago(HOUR)
    const items = threadItems([msg('a', 'leo', t), msg('b', 'me', t)], true, NOW)
    expect(items[0]!.kind).toBe('day')
    expect(firstMessageOf(items)).toBe('a')
    expect(firstMessageOf([{ kind: 'day', key: 'd', label: 'Today' }])).toBeNull()
  })

  const base = { paging: false, windowFull: false, pending: true, fetching: false, error: false, hasMore: false }

  it('before paging: older posts may exist only when the first read came back full', () => {
    expect(olderState(base)).toBe('none')
    expect(olderState({ ...base, windowFull: true })).toBe('idle')
  })

  it('paging: loading while a page is on its way, Try again when it failed, idle while more remain, then the start', () => {
    const paging = { ...base, paging: true }
    expect(olderState({ ...paging, pending: true, fetching: true })).toBe('loading')
    expect(olderState({ ...paging, pending: true })).toBe('loading')
    expect(olderState({ ...paging, pending: false, error: true })).toBe('error')
    // A retry in flight shows as loading again, not as the old error.
    expect(olderState({ ...paging, pending: false, error: true, fetching: true })).toBe('loading')
    expect(olderState({ ...paging, pending: false, hasMore: true })).toBe('idle')
    expect(olderState({ ...paging, pending: false, hasMore: false })).toBe('start')
  })

  it('lays the older pages (newest page first) and the live read out oldest → newest, each post once', () => {
    const r = (id: string) => ({ id })
    const pages = [{ rows: [r('4'), r('5')] }, { rows: [r('1'), r('2'), r('3')] }]
    expect(boardRows(pages, [r('5'), r('6'), r('7')])?.map((x) => x.id)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(boardRows(undefined, [r('6')])?.map((x) => x.id)).toEqual(['6'])
    expect(boardRows(pages, undefined)).toBeUndefined()
  })
})

describe('thread ids', () => {
  it('names a league board and reads it back', () => {
    expect(leagueThreadId('abc')).toBe('league-abc')
    expect(leagueIdOfThread('league-abc')).toBe('abc')
    expect(leagueIdOfThread('league-')).toBeNull()
    expect(leagueIdOfThread('marcus')).toBeNull()
    expect(threadHref('league-abc')).toBe('/app/messages/league-abc')
  })
  it('counts members', () => {
    expect(membersLine(12)).toBe('12 members')
    expect(membersLine(1)).toBe('1 member')
  })
})

describe('DM feed view model', () => {
  const thread: RailDmThread = {
    id: 'marcus',
    gmName: 'Marcus',
    gmAvatarUrl: null,
    teamName: 'Gridiron Gurus',
    leagueName: 'Sunday Funday League',
    lastActive: '8m',
    unread: 1,
    messages: [
      { id: 'm1', text: 'You still shopping Conner?', fromMe: false, time: '9m' },
      { id: 'm2', text: 'Sent it over, check your trades', fromMe: false, time: '8m' },
    ],
    trade: { give: ['James Conner'], get: ['Darnell Mooney'] },
  }
  const none = { read: {}, sent: {} }

  it('is empty with an empty feed (no DM backend yet)', () => {
    expect(dmViewModel([], none)).toEqual({ conversations: [] })
  })

  it('maps a thread: preview, time, unread until read this session', () => {
    const { conversations } = dmViewModel([thread], none)
    expect(conversations[0]).toMatchObject({
      id: 'marcus',
      name: 'Marcus',
      initial: 'MA',
      unread: true,
      preview: 'Sent it over, check your trades',
      time: '8m',
    })
    expect(dmViewModel([thread], { ...none, read: { marcus: true } }).conversations[0]!.unread).toBe(false)
  })

  it('appends this session’s sends and makes the time "now"', () => {
    const c = dmViewModel([thread], { ...none, sent: { marcus: ['Deal'] } }).conversations[0]!
    expect(c.preview).toBe('You: Deal')
    expect(c.time).toBe('now')
    expect(c.messages.at(-1)).toMatchObject({ fromMe: true, text: 'Deal' })
  })
})

describe('a league\'s trade offers (Home\'s league-card dot)', () => {
  const ME = 'team-me'
  const MARCUS = 'team-marcus'
  const NINA = 'team-nina'
  const player = (id: string, full_name: string) => ({ player_id: id, full_name, position: 'WR', nfl_team: 'ATL' })
  const trade = (over: Partial<TradeView> & Pick<TradeView, 'id'>): TradeView =>
    ({
      status: 'proposed',
      status_reason: null,
      in_flight: true,
      proposer: { team_id: MARCUS, name: 'Gridiron Gurus' },
      recipient: { team_id: ME, name: 'Touchdown Tacos' },
      note: null,
      countered_from: null,
      created_at: ago(8 * MIN),
      accepted_at: null,
      resolved_at: null,
      items: [
        { from_team_id: MARCUS, to_team_id: ME, player: player('p1', 'Darnell Mooney'), faab_amount: null },
        { from_team_id: MARCUS, to_team_id: ME, player: null, faab_amount: 5 },
        { from_team_id: ME, to_team_id: MARCUS, player: player('p2', 'James Conner'), faab_amount: null },
      ],
      drops: [],
      review: null,
      deferred: null,
      tally: null,
      ...over,
    }) as TradeView
  const detail = {
    teams: [
      { id: ME, name: 'Touchdown Tacos', owner_id: 'u-me', status: 'active', created_at: '2026-08-01T00:00:00Z' },
      { id: MARCUS, name: 'Gridiron Gurus', owner_id: 'u-m', status: 'active', created_at: '2026-08-02T00:00:00Z' },
      { id: NINA, name: 'Hail Marys', owner_id: 'u-n', status: 'active', created_at: '2026-08-03T00:00:00Z' },
    ],
    members: [
      { id: 'm1', user_id: 'u-me', team_id: ME, role: 'owner', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'dalton', avatar_url: null } },
      { id: 'm2', user_id: 'u-m', team_id: MARCUS, role: 'member', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'marcus', avatar_url: 'https://x/m.png' } },
      { id: 'm3', user_id: 'u-n', team_id: NINA, role: 'member', is_placeholder: false, is_autodraft: false, joined_at: null, profiles: { username: 'nina', avatar_url: null } },
    ],
  } as unknown as LeagueDetail
  const doc = (trades: TradeView[], me: string | null = ME) =>
    ({ trades, viewer: { team_id: me, is_commissioner: false }, evaluated_at: NOW.toISOString() }) as Pick<TradesDocument, 'trades' | 'viewer' | 'evaluated_at'>

  it('reads an offer sent to me: @marcus, 8m, Pending, You get / You give, waiting on me', () => {
    const [o] = leagueTradeOffers(doc([trade({ id: 't1' })]), detail, 'lg')
    expect(o).toMatchObject({
      id: 't1',
      leagueId: 'lg',
      name: '@marcus',
      handle: 'marcus',
      teamName: 'Gridiron Gurus',
      avatarUrl: 'https://x/m.png',
      colorClass: 'bg-m-ink',
      dir: 'in',
      time: '8m',
      gets: ['Darnell Mooney', '$5 FAAB'],
      gives: ['James Conner'],
      status: { label: 'Pending', tone: 'pending' },
      awaitingMe: true,
    })
  })

  it('reads an offer I sent as outgoing, still Pending but not waiting on me', () => {
    const [o] = leagueTradeOffers(
      doc([trade({ id: 't2', proposer: { team_id: ME, name: 'Touchdown Tacos' }, recipient: { team_id: NINA, name: 'Hail Marys' } })]),
      detail,
      'lg',
    )
    expect(o).toMatchObject({ name: '@nina', dir: 'out', status: { label: 'Pending', tone: 'pending' }, awaitingMe: false })
  })

  it('leaves out trades between two other teams, and everything when I have no team', () => {
    const others = trade({ id: 't3', proposer: { team_id: MARCUS, name: 'Gridiron Gurus' }, recipient: { team_id: NINA, name: 'Hail Marys' } })
    expect(leagueTradeOffers(doc([others]), detail, 'lg')).toEqual([])
    expect(leagueTradeOffers(doc([trade({ id: 't1' })], null), detail, 'lg')).toEqual([])
  })

  it('words a finished offer as the trade screens do', () => {
    expect(tradeOfferStatus(trade({ id: 'a', status: 'complete' }), ME)).toEqual({ label: 'Completed', tone: 'accepted' })
    expect(tradeOfferStatus(trade({ id: 'b', status: 'rejected', status_reason: 'rejected by x' }), ME)).toEqual({ label: 'Declined', tone: 'declined' })
    expect(tradeOfferStatus(trade({ id: 'c', status: 'cancelled' }), ME)).toEqual({ label: 'Withdrawn', tone: 'neutral' })
    expect(tradeOfferStatus(trade({ id: 'd', status: 'in_review' }), ME)).toEqual({ label: 'Under review', tone: 'pending' })
    const [declined] = leagueTradeOffers(doc([trade({ id: 'e', status: 'rejected', in_flight: false })]), detail, 'lg')
    expect(declined!.awaitingMe).toBe(false)
  })

  it('counts only the offers waiting on my answer', () => {
    expect(pendingCount([{ awaitingMe: true }, { awaitingMe: false }, { awaitingMe: true }])).toBe(2)
    expect(pendingCount([])).toBe(0)
    const mine = { proposer: { team_id: ME, name: 'Touchdown Tacos' }, recipient: { team_id: NINA, name: 'Hail Marys' } }
    const offers = leagueTradeOffers(
      doc([trade({ id: 'in' }), trade({ id: 'out', ...mine }), trade({ id: 'done', status: 'complete', in_flight: false })]),
      detail,
      'lg',
    )
    expect(pendingCount(offers)).toBe(1)
  })
})
