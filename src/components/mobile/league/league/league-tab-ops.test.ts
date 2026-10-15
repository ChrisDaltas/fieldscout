import { describe, expect, it } from 'vitest'

import type { TransactionActivityItem } from '@/lib/leagues/api/activity-service'

import {
  clearedFilter,
  commishLogHref,
  correctionsScreenHref,
  emptyFilterCopy,
  feedRows,
  feedStreams,
  filterCount,
  filterLabel,
  playoffNote,
  segmentAtPath,
  segmentHref,
  shortName,
  standingsHref,
  streakOf,
  teamAvatarClass,
  transactionRow,
  transactionsHref,
  waiverCell,
} from './league-tab-ops'

const L = 'league-1'
const tx = (over: Partial<TransactionActivityItem>): TransactionActivityItem => ({
  kind: 'transaction',
  id: 'tx-1',
  created_at: '2026-10-11T19:06:00.000Z',
  type: 'add_drop',
  status: 'complete',
  week: 5,
  team_id: 'team-a',
  actor_id: null,
  action_id: null,
  payload: {},
  ...over,
})
const managers = new Map([
  ['team-a', 'dalton'],
  ['team-b', 'marcus'],
])
const who = (id: string | null) => {
  const username = id ? managers.get(id) : undefined
  return username ? { username } : null
}

describe('segments and routes', () => {
  it('keeps the app’s three URLs', () => {
    expect(segmentHref(L, 'matchups')).toBe('/app/leagues/league-1')
    expect(segmentHref(L, 'standings')).toBe('/app/leagues/league-1/standings')
    expect(segmentHref(L, 'activity')).toBe('/app/leagues/league-1/activity')
  })
  it('spells the Transactions entries', () => {
    expect(transactionsHref(L)).toBe('/app/leagues/league-1/activity/transactions')
    expect(transactionsHref(L, { mine: true })).toBe('/app/leagues/league-1/activity/transactions?mine=1')
    expect(transactionsHref(L, { team: 'team-b' })).toBe('/app/leagues/league-1/activity/transactions?team=team-b')
  })
  it('reads the segment off the address — the league page is the remembered one', () => {
    expect(segmentAtPath('/app/leagues/league-1', L)).toBeNull()
    expect(segmentAtPath('/app/leagues/league-1/standings', L)).toBe('standings')
    expect(segmentAtPath('/app/leagues/league-1/activity/', L)).toBe('activity')
    expect(segmentAtPath('/app/leagues/league-1/activity/transactions', L)).toBeUndefined()
    expect(standingsHref(L, true)).toBe('/app/leagues/league-1/standings?tab=playoffs')
    expect(standingsHref(L, false)).toBe('/app/leagues/league-1/standings')
  })
  it('the commissioner log and stat corrections are their own full-screen addresses', () => {
    expect(commishLogHref(L)).toBe('/app/leagues/league-1/activity/commissioner')
    expect(commishLogHref(L, { team: 't', week: 4, entry: 'e' })).toBe('/app/leagues/league-1/activity/commissioner?week=4&team=t&entry=e')
    expect(correctionsScreenHref(L, 3)).toBe('/app/leagues/league-1/activity/corrections?week=3')
    expect(correctionsScreenHref(L)).toBe('/app/leagues/league-1/activity/corrections')
  })
})

describe('Transaction filters', () => {
  it('counts a type and a team selection; teams do not count on My moves', () => {
    expect(filterCount({ type: 'All', teams: [] }, false)).toBe(0)
    expect(filterCount({ type: 'Trades', teams: ['x'] }, false)).toBe(2)
    expect(filterCount({ type: 'Trades', teams: ['x'] }, true)).toBe(1)
    expect(filterLabel(0)).toBe('Filter')
    expect(filterLabel(2)).toBe('Filter · 2')
  })
  it('Clear filter keeps the hidden team selection on My moves only', () => {
    expect(clearedFilter({ type: 'Waivers', teams: ['x'] }, false)).toEqual({ type: 'All', teams: [] })
    expect(clearedFilter({ type: 'Waivers', teams: ['x'] }, true)).toEqual({ type: 'All', teams: ['x'] })
    expect(emptyFilterCopy(true)).toBe('No moves match this filter')
    expect(emptyFilterCopy(false)).toBe('No transactions match this filter')
  })
  it('maps type and teams onto the feed reads', () => {
    expect(feedStreams({ type: 'All', teams: [] }, false, null)).toEqual([{}])
    expect(feedStreams({ type: 'Trades', teams: [] }, false, null)).toEqual([{ topic: 'trades' }])
    expect(feedStreams({ type: 'Free agents', teams: [] }, false, null)).toEqual([{ type: ['add', 'drop', 'add_drop'] }])
    // A team's own adds, drops and claims: a read per team (it started them).
    expect(feedStreams({ type: 'Waivers', teams: ['b', 'a'] }, false, null)).toEqual([
      { type: ['waiver_claim'], teamId: 'a' },
      { type: ['waiver_claim'], teamId: 'b' },
    ])
    // Trades with a team: the whole Trades topic (vetoes and reversals too),
    // kept to the trades naming the team — either side.
    expect(feedStreams({ type: 'Trades', teams: ['a'] }, false, null)).toEqual([{ topic: 'trades', parties: ['a'] }])
    // All types with teams: their own moves, plus every trade and commissioner
    // move that names one of them (a received trade has another team's id on it).
    expect(feedStreams({ type: 'All', teams: ['b', 'a'] }, false, null)).toEqual([
      { type: ['add', 'drop', 'add_drop', 'waiver_claim'], teamId: 'a' },
      { type: ['add', 'drop', 'add_drop', 'waiver_claim'], teamId: 'b' },
      { type: ['trade', 'commissioner_move'], parties: ['a', 'b'] },
    ])
    // My moves: always your team, whatever was selected before.
    expect(feedStreams({ type: 'All', teams: ['b'] }, true, 'mine')).toEqual([
      { type: ['add', 'drop', 'add_drop', 'waiver_claim'], teamId: 'mine' },
      { type: ['trade', 'commissioner_move'], parties: ['mine'] },
    ])
  })
})

describe('transaction rows', () => {
  it('an add / drop reads the stored names, positions and teams', () => {
    const row = transactionRow(
      tx({
        payload: {
          add: { player_id: 'p1', name: 'Kendrick Bourne', position: 'WR', nfl_team: 'ARI' },
          drop: { player_id: 'p2', name: 'Ray Davis', position: 'RB', nfl_team: 'BUF' },
        },
      }),
      who,
      null,
    )
    expect(row.pill).toEqual({ label: 'Free agency', tone: 'free' })
    expect(row.bid).toBeNull()
    expect(row.moves.map((m) => [m.name, m.position, m.nflTeam, m.tone, m.verb])).toEqual([
      ['Kendrick Bourne', 'WR', 'ARI', 'add', 'Added'],
      ['Ray Davis', 'RB', 'BUF', 'drop', 'Dropped'],
    ])
  })
  it('a won claim shows its bid only when FAAB was debited', () => {
    const add = { player_id: 'p1', name: 'Ray Davis', position: 'RB', nfl_team: 'BUF' }
    expect(transactionRow(tx({ type: 'waiver_claim', payload: { add, faab_bid: 11, faab_before: 50 } }), who, null).bid).toBe(11)
    expect(transactionRow(tx({ type: 'waiver_claim', payload: { add, faab_bid: 0 } }), who, null).bid).toBeNull()
  })
  const trade = tx({
    type: 'trade',
    payload: {
      proposer_team_id: 'team-a',
      recipient_team_id: 'team-b',
      players: [
        { player_id: 'p1', name: 'Jaylen Wright', from_team_id: 'team-b', to_team_id: 'team-a' },
        { player_id: 'p2', name: 'Jahan Dotson', from_team_id: 'team-a', to_team_id: 'team-b' },
      ],
      drops: [{ player_id: 'p3', name: 'Ray Davis', team_id: 'team-b' }],
      faab: [{ amount: 5, from_team_id: 'team-a', to_team_id: 'team-b' }],
    },
  })
  it('a trade is told from one side in Added / Dropped words, the other manager a profile door', () => {
    const row = transactionRow(trade, who, null)
    expect(row.pill.label).toBe('Trade')
    expect(row.teamId).toBe('team-a')
    expect(row.moves.map((m) => [m.name, m.verb])).toEqual([
      ['Jaylen Wright', 'Added'],
      ['Jahan Dotson', 'Dropped'],
      ['Ray Davis', 'Dropped'],
    ])
    // The other side's roster drop names its manager (a link, not text).
    expect(row.moves[2]!.note).toEqual([{ username: 'marcus' }, ' · roster drop'])
    expect(row.text).toEqual(['Trade with ', { username: 'marcus' }, ' · ', '$5 FAAB sent'])
  })
  it('filtered to the team that RECEIVED the trade, the row is that team’s side', () => {
    const row = transactionRow(trade, who, null, ['team-b'])
    expect(row.teamId).toBe('team-b')
    expect(row.moves.map((m) => [m.name, m.verb, m.note])).toEqual([
      ['Jaylen Wright', 'Dropped', null],
      ['Jahan Dotson', 'Added', null],
      ['Ray Davis', 'Dropped', ['Roster drop']],
    ])
    expect(row.text).toEqual(['Trade with ', { username: 'dalton' }, ' · ', '$5 FAAB received'])
  })
  it('a commissioner’s roster move reads its player ids; anything else is its sentence', () => {
    const move = transactionRow(
      tx({ type: 'commissioner_move', team_id: null, payload: { team_id: 'team-b', added_player_id: 'p9', dropped_player_id: null } }),
      who,
      'act-1',
    )
    expect(move.teamId).toBe('team-b')
    expect(move.pill.tone).toBe('commish')
    expect(move.moves.map((m) => [m.playerId, m.verb])).toEqual([['p9', 'Added']])
    const reversal = transactionRow(tx({ type: 'commissioner_move', payload: { kind: 'trade_reversal', summary: 'A gives X; B gives Y' } }), who, null)
    expect(reversal.moves).toEqual([])
    expect(reversal.text).toEqual(['Reversed a trade — every player went back: A gives X; B gives Y'])
    const moved = transactionRow(
      tx({ type: 'commissioner_move', team_id: null, payload: { from_team_id: 'team-a', to_team_id: 'team-b', moved_player_id: 'p4' } }),
      who,
      null,
      ['team-a'],
    )
    // From → to, each manager a door; filtered to the team it left, it is that team's row.
    expect(moved.moves[0]!.note).toEqual([{ username: 'dalton' }, ' → ', { username: 'marcus' }])
    expect(moved.teamId).toBe('team-a')
  })
  it('folds a commissioner post into the move that carries the same receipt', () => {
    const rows = feedRows(
      [
        tx({ id: 't', type: 'commissioner_move', payload: { team_id: 'team-a', added_player_id: 'p1' }, commish_action_id: 'r1' }),
        { kind: 'system', id: 's', created_at: '2026-10-11T19:06:00.000Z', context: 'league', message: 'Alpha: added X by chris (commissioner override)', actor_id: 'u1', topic: null, week: null, commish_action_id: 'r1' },
        { kind: 'system', id: 's2', created_at: '2026-10-10T19:06:00.000Z', context: 'league', message: 'Week 4 was finalized', actor_id: null, topic: null, week: null, commish_action_id: null },
      ],
      new Map([['team-a', 'Alpha']]),
      new Map(),
      who,
    )
    expect(rows.map((r) => [r.kind, r.id, r.pill.tone])).toEqual([
      ['transaction', 't', 'commish'],
      ['post', 's2', 'league'],
    ])
  })
})

describe('cells', () => {
  it('short names', () => {
    expect(shortName('Kendrick Bourne', 'WR')).toBe('K. Bourne')
    expect(shortName('Efton Chism III', 'WR')).toBe('E. Chism III')
    expect(shortName('Patriots D/ST', 'DEF')).toBe('Patriots D/ST')
    expect(shortName('New England Patriots', 'DEF')).toBe('New England Patriots')
    expect(shortName('A.J. Brown', 'WR')).toBe('A.J. Brown')
  })
  it('the waiver column: FAAB (priority), priority alone, or a dash', () => {
    expect(waiverCell({ faab_balance: 103, waiver_priority: 10 }, 'faab')).toBe('$103 (10)')
    expect(waiverCell({ faab_balance: null, waiver_priority: 3 }, 'rolling_priority')).toBe('#3')
    expect(waiverCell({ faab_balance: 50, waiver_priority: 3 }, 'none_fcfs')).toBe('—')
  })
  it('the streak is the run of equal final head-to-head results', () => {
    const m = (week: number, result: string | null, status = 'final') => ({ week, round_type: 'regular', status, home_team_id: 'a', away_team_id: 'b', result })
    expect(streakOf('a', [m(1, 'away'), m(2, 'home'), m(3, 'home')])).toEqual({ text: '▲2W', tone: 'win' })
    expect(streakOf('b', [m(1, 'away'), m(2, 'home'), m(3, 'home')])).toEqual({ text: '▼2L', tone: 'loss' })
    // A live week is not a result yet.
    expect(streakOf('a', [m(1, 'home'), m(2, 'away', 'live')])).toEqual({ text: '▲1W', tone: 'win' })
    expect(streakOf('a', [])).toBeNull()
  })
  it('the playoff note follows the league’s own setting', () => {
    expect(playoffNote(6)).toBe('Top 6 make the playoffs. Line marks the cutoff.')
    expect(playoffNote(0)).toMatch(/Playoffs are off/)
  })
  it('your team is blue; the others take the TEAMS fills in league order — the Match tab’s palette', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(teamAvatarClass('b', ids, 'b')).toBe('bg-accent')
    expect(teamAvatarClass('a', ids, 'b')).toBe('bg-m-ink')
    // #9D70E9 / #F75252 / #ECAD48 / #5C7CE5 — the fills, not the position text colours.
    expect(['c', 'd', 'e', 'f'].map((t) => teamAvatarClass(t, ids, 'b'))).toEqual(['bg-pos-wr', 'bg-pos-qb', 'bg-pos-te', 'bg-pos-rb'])
    expect(teamAvatarClass(null, ids, 'b')).toBe('bg-m-t5')
  })
})
