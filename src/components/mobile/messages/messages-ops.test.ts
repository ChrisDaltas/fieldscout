/**
 * messages-ops.test.ts — the pure rules of FieldScout Mobile › Messages
 * (docs/design/mobile/m-messages.md): times, previews, the bubble-run
 * geometry, search, the pending badge, thread ids, the Trades tab's league
 * offers, and the DM feed's view model (the same empty feed the desktop rail
 * renders).
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
  bubbleRadius,
  dayLabel,
  directionWords,
  senderHandle,
  initialOf,
  keyColor,
  leagueIdOfThread,
  leagueThreadId,
  matchesName,
  matchesTrade,
  leagueTradeOffers,
  membersLine,
  newestFirst,
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
  it('matches a trade by name, @handle, team or any asset — never across two fields', () => {
    const t = { name: 'Marcus', handle: 'marcus', teamName: 'Gridiron Gurus', gets: ['Darnell Mooney', '$5 FAAB'], gives: ['James Conner'] }
    expect(matchesTrade(t, 'mooney')).toBe(true)
    expect(matchesTrade(t, '@marcus')).toBe(true)
    expect(matchesTrade(t, 'gurus')).toBe(true)
    expect(matchesTrade(t, 'conner')).toBe(true)
    expect(matchesTrade(t, 'sdarn')).toBe(false)
    expect(matchesTrade(t, 'marcus darnell')).toBe(false)
    expect(matchesTrade(t, '')).toBe(true)
  })
  it('badges the offers waiting on my answer only', () => {
    expect(pendingCount([{ awaitingMe: true }, { awaitingMe: false }, { awaitingMe: true }])).toBe(2)
    expect(pendingCount([])).toBe(0)
  })
  it('words the direction', () => {
    expect(directionWords('in')).toBe('Sent to you')
    expect(directionWords('out')).toBe('You sent')
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

describe('Trades tab — league offers', () => {
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

  it('turns an offer sent to me into the design\'s card: @marcus, Sent to you · 8m, Pending, You get / You give', () => {
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

  it('shows offers I sent as "You sent", still Pending but not waiting on me', () => {
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

  it('merges leagues newest first', () => {
    const a = leagueTradeOffers(doc([trade({ id: 'old', created_at: ago(5 * HOUR) })]), detail, 'a')
    const b = leagueTradeOffers(doc([trade({ id: 'new', created_at: ago(8 * MIN) })]), detail, 'b')
    expect(newestFirst([...a, ...b]).map((o) => o.id)).toEqual(['new', 'old'])
  })
})
