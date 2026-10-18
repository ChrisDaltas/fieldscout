import { describe, expect, it } from 'vitest'

import type { TransactionActivityItem } from '@/lib/leagues/api/activity-service'
import type { MatchupRow } from '@/lib/leagues/api/matchups-service'
import type { WaiverClaimView } from '@/lib/leagues/api/waivers-service'

import {
  claimResultRows,
  clearedFilter,
  commishLogHref,
  correctionsScreenHref,
  emptyFilterCopy,
  extraRecords,
  feedRows,
  feedStreams,
  filterCount,
  filterLabel,
  matchupGroups,
  matchupsWeek,
  playoffNote,
  segmentAtPath,
  segmentHref,
  shortName,
  standingsHref,
  teamAvatarClass,
  tiebreakNote,
  transactionRow,
  transactionsHref,
  waiverCell,
  weekToKeep,
  withClaimResults,
  rowPlayerIds,
  type TxRow,
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

const claim = (over: Partial<WaiverClaimView>): WaiverClaimView => ({
  id: 'c1',
  team_id: 'team-a',
  add: { player_id: 'p-add', full_name: 'Puka Nacua', position: 'WR', nfl_team: 'LAR' },
  drop: { player_id: 'p-drop', full_name: 'Jordan Love', position: 'QB', nfl_team: 'GB' },
  faab_bid: 9,
  claim_order: 1,
  status: 'lost',
  result_reason: 'outbid',
  process_at: '2026-10-14T07:00:00.000Z',
  processed_at: '2026-10-14T07:00:05.000Z',
  created_at: '2026-10-12T19:06:00.000Z',
  created_by: 'u1',
  cancelled_at: null,
  ...over,
})

describe('lost and failed waiver claims in My moves (gap list §3 #12)', () => {
  it('a lost claim: the result, when the run settled it, your bid, both players grey, who won him and why', () => {
    const [row] = claimResultRows(
      [claim({ winner_team_id: 'team-b', winner_team_name: 'Gridiron Gurus', winning_bid: 14 })],
      'faab',
      who,
    )
    // A transaction row (one row view draws both), the result after the Waiver pill.
    expect(row).toMatchObject({
      kind: 'transaction',
      id: 'claim:c1',
      pill: { label: 'Waiver', tone: 'waiver' },
      result: { status: 'lost', label: 'Lost' },
      createdAt: '2026-10-14T07:00:05.000Z',
      bid: 9,
      commishActionId: null,
    })
    expect(row!.moves.map((m) => [m.playerId, m.tone, m.verb, m.muted])).toEqual([
      ['p-add', 'add', 'Claim', true],
      ['p-drop', 'drop', 'Drop', true],
    ])
    // The winner is his manager — a door to the profile.
    expect(row!.text).toEqual([{ username: 'marcus' }, ' won P. Nacua ($14). Your $9 claim was outbid.'])
  })

  it('a lost claim on priority, or with no winner found, says so plainly; a priority league shows no bid', () => {
    const [prio] = claimResultRows(
      [claim({ result_reason: 'lost_on_priority', winner_team_id: 'team-x', winner_team_name: 'Charlie', winning_bid: null })],
      'rolling',
      who,
    )
    expect(prio!.bid).toBeNull()
    // A team with no manager reads as its name.
    expect(prio!.text).toEqual(['Charlie', ' won P. Nacua. Your claim was out-prioritized.'])
    const [unknown] = claimResultRows([claim({ result_reason: 'lost_on_priority' })], 'faab', who)
    expect(unknown!.text).toEqual(['Another team with higher waiver priority claimed him.'])
    const [bid] = claimResultRows([claim({})], 'faab', who)
    expect(bid!.text).toEqual(['Another team bid more.'])
  })

  it('a failed claim: "Didn’t go through" and every stored reason in plain words', () => {
    const reasonOf = (result_reason: string | null) =>
      claimResultRows([claim({ status: 'invalid', result_reason, drop: null })], 'faab', who)[0]!
    const row = reasonOf('roster_full')
    expect(row.result).toEqual({ status: 'invalid', label: 'Didn’t go through' })
    expect(row.moves).toHaveLength(1)
    expect(row.text).toEqual(['Your roster was full — claim again with a player to drop.'])
    expect(reasonOf('add_locked').text).toEqual(['His game had already started.'])
    expect(reasonOf('add_rostered').text).toEqual(['He was already on a roster by then.'])
    expect(reasonOf('drop_gone').text).toEqual(['The player you’d drop was no longer on your roster.'])
    expect(reasonOf('drop_locked').text).toEqual(['The player you’d drop had already played this week.'])
    expect(reasonOf('cap_reached').text).toEqual(['You’d used all the adds the league allows.'])
    expect(reasonOf('insufficient_faab').text).toEqual(['The bid was more than your FAAB left by then.'])
    expect(reasonOf('own_claim_won').text).toEqual(['One of your other claims went through first and made this one impossible.'])
    expect(reasonOf('no_waivers').text).toEqual(['The league turned waivers off — he can be picked up directly now.'])
    expect(reasonOf('team_retired').text).toEqual(['This team was retired before the run.'])
    // A reason the app has no words for is still said, never dropped.
    expect(reasonOf('something_new').text).toEqual(['Didn’t go through (something new).'])
    expect(reasonOf('constructor').text).toEqual(['Didn’t go through (constructor).'])
    expect(reasonOf(null).text).toBeNull()
  })

  it('won, pending and cancelled claims are not rows (a win is already a move)', () => {
    const rows = claimResultRows(
      [claim({ id: 'w', status: 'won' }), claim({ id: 'p', status: 'pending' }), claim({ id: 'x', status: 'cancelled' }), claim({ id: 'l' })],
      'faab',
      who,
    )
    expect(rows.map((r) => r.id)).toEqual(['claim:l'])
  })

  const post = (id: string, createdAt: string | null) => ({ kind: 'post' as const, id, pill: { label: 'League', tone: 'league' as const }, createdAt, text: id, actorUsername: null, commishActionId: null })
  const result = (id: string, createdAt: string): TxRow => ({ ...claimResultRows([claim({ id })], 'faab', who)[0]!, createdAt })

  it('slots each claim in by time, the feed’s own order kept; a claim at the same instant as a move goes first', () => {
    const rows = [post('a', '2026-10-14T09:00:00.000Z'), post('b', '2026-10-14T07:00:05.000Z'), post('c', '2026-10-10T07:00:00.000Z')]
    const merged = withClaimResults(rows, [result('old', '2026-10-01T00:00:00.000Z'), result('run', '2026-10-14T07:00:05.000Z')], true)
    expect(merged.map((r) => r.id)).toEqual(['a', 'claim:run', 'b', 'c', 'claim:old'])
  })

  it('while older moves are unread, a claim older than the oldest row shown waits for its page', () => {
    const rows = [post('a', '2026-10-14T09:00:00.000Z'), post('b', '2026-10-12T00:00:00.000Z')]
    const claims = [result('new', '2026-10-13T00:00:00.000Z'), result('old', '2026-10-01T00:00:00.000Z')]
    expect(withClaimResults(rows, claims, false).map((r) => r.id)).toEqual(['a', 'claim:new', 'b'])
    expect(withClaimResults(rows, claims, true).map((r) => r.id)).toEqual(['a', 'claim:new', 'b', 'claim:old'])
    // Nothing read yet to order against: every claim shows.
    expect(withClaimResults([], claims, false).map((r) => r.id)).toEqual(['claim:new', 'claim:old'])
  })

  it('a claim row’s players join the one headshot read', () => {
    expect(rowPlayerIds([result('l', '2026-10-13T00:00:00.000Z')])).toEqual(['p-add', 'p-drop'])
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
  // The streak's count is `streak-ops` (one for Match, Team view, Standings — gap list #39).
  it('the extra records show only for the games the league plays (gap list #40)', () => {
    const row = { median_record: { wins: 4, losses: 4, ties: 0 }, second_record: { wins: 3, losses: 4, ties: 1 } }
    expect(extraRecords(row, { median: true, second: true })).toEqual(['vs median 4-4', '2nd opp 3-4-1'])
    expect(extraRecords(row, { median: true, second: false })).toEqual(['vs median 4-4'])
    expect(extraRecords(row, { median: false, second: true })).toEqual(['2nd opp 3-4-1'])
    expect(extraRecords(row, { median: false, second: false })).toEqual([])
  })
  it('the tiebreak line: the league’s own order in plain words (gap list #40)', () => {
    const applied = (entry: string) => ({ entry, status: 'applied', reason: null })
    // The default order, as the standings read returns it.
    const chain = [
      applied('win_pct'),
      applied('points_for'),
      applied('head_to_head'),
      applied('points_against'),
      { entry: 'division_record', status: 'inert', reason: 'divisions_pinned_at_1' },
      applied('coin_flip'),
    ]
    expect(tiebreakNote(chain, [], 'h2h')).toBe('Ties go to most points for, then head-to-head (two-team ties), then most points against, then a coin flip.')
    // A total-points league skips head-to-head.
    const skipped = chain.map((e) => (e.entry === 'head_to_head' ? { ...e, status: 'skipped', reason: 'total_points' } : e))
    expect(tiebreakNote(skipped, [], 'total_points')).toBe('Ties go to most points for, then most points against, then a coin flip.')
    // A league that put points for first says what it ranks by.
    expect(tiebreakNote([applied('points_for'), applied('win_pct'), applied('coin_flip')], [], 'h2h')).toBe('Ranked by most points for, then best record, then a coin flip.')
    // The read's chain always wins over the stored setting.
    expect(tiebreakNote(chain, ['points_against', 'win_pct'], 'h2h')).toBe(
      'Ties go to most points for, then head-to-head (two-team ties), then most points against, then a coin flip.',
    )
    // The coin flip ends every tie — nothing after it is named.
    expect(tiebreakNote([applied('win_pct'), applied('coin_flip'), applied('points_for')], [], 'h2h')).toBe('Ties go to a coin flip.')
  })
  it('no chain on the read: the chain 117 would build from the stored setting', () => {
    // The stored order, then the catalog's remainder in default order.
    expect(tiebreakNote(null, ['win_pct', 'points_against'], 'h2h')).toBe(
      'Ties go to most points against, then most points for, then head-to-head (two-team ties), then a coin flip.',
    )
    // Same skips: divisions inert; head-to-head only in a head-to-head league.
    expect(tiebreakNote(null, ['win_pct', 'head_to_head', 'division_record', 'coin_flip'], 'h2h')).toBe('Ties go to head-to-head (two-team ties), then a coin flip.')
    expect(tiebreakNote([], ['win_pct', 'head_to_head', 'coin_flip'], 'total_points')).toBe('Ties go to a coin flip.')
    expect(tiebreakNote([], ['points_for'], 'total_points')).toBe('Ranked by most points for, then best record, then most points against, then a coin flip.')
    // Nothing stored: the whole catalog, as 117 completes it.
    expect(tiebreakNote(null, [], 'h2h')).toBe('Ties go to most points for, then head-to-head (two-team ties), then most points against, then a coin flip.')
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

// Gap list §4 item 9: League › Matchups' week picker.
describe('matchupsWeek / weekToKeep — which week League › Matchups shows', () => {
  const ladder = [
    { week: 1, status: 'final' },
    { week: 2, status: 'correction_window' },
    { week: 3, status: 'live' },
    { week: 4, status: 'upcoming' },
  ]

  it('nothing kept: the ladder’s current week (the greatest started one); none before the ladder loads', () => {
    expect(matchupsWeek(undefined, ladder)).toBe(3)
    expect(matchupsWeek(undefined, undefined)).toBeNull()
    expect(matchupsWeek(2, undefined)).toBeNull()
    expect(matchupsWeek(undefined, [])).toBeNull()
  })

  it('a kept week shows while it is on the ladder — past or future', () => {
    expect(matchupsWeek(1, ladder)).toBe(1)
    expect(matchupsWeek(4, ladder)).toBe(4)
  })

  it('a kept week the ladder does not have falls back to the current week', () => {
    expect(matchupsWeek(9, ladder)).toBe(3)
  })

  it('stepping back to the current week keeps nothing, so the default keeps following the season', () => {
    expect(weekToKeep(3, ladder)).toBeNull()
    expect(weekToKeep(1, ladder)).toBe(1)
    expect(weekToKeep(4, ladder)).toBe(4)
  })
})

// Gap list §4 item 10: second-opponent games in their own group.
describe('matchupGroups — the week’s matchups and its second-opponent games', () => {
  const game = (id: string, round_type: string, home: string, away: string | null): MatchupRow => ({
    id,
    season: 2099,
    week: 2,
    round_type,
    status: 'live',
    home_team_id: home,
    away_team_id: away,
    home_score: null,
    away_score: null,
    result: null,
    is_overridden: false,
    updated_at: null,
  })
  const week = [
    game('p1', 'regular', 'a', 'b'),
    game('s1', 'secondary', 'a', 'c'),
    game('p2', 'regular', 'c', 'me'),
    game('s2', 'secondary', 'b', 'd'),
    game('s3', 'secondary', 'd', 'me'),
    game('p3', 'regular', 'd', null),
  ]

  it('splits the secondary rows into their own group, every other row a matchup', () => {
    const { primary, secondary } = matchupGroups(week, null)
    expect(primary.map((m) => m.id)).toEqual(['p1', 'p2', 'p3'])
    expect(secondary.map((m) => m.id)).toEqual(['s1', 's2', 's3'])
  })

  it('puts yours first in each group (home or away), the rest in the server’s order', () => {
    const { primary, secondary } = matchupGroups(week, 'me')
    expect(primary.map((m) => m.id)).toEqual(['p2', 'p1', 'p3'])
    expect(secondary.map((m) => m.id)).toEqual(['s3', 's1', 's2'])
  })

  it('playoff rows are matchups; a league without second opponents has an empty second group', () => {
    const { primary, secondary } = matchupGroups([game('q1', 'playoff', 'a', 'b'), game('q2', 'playoff', 'me', 'c')], 'me')
    expect(primary.map((m) => m.id)).toEqual(['q2', 'q1'])
    expect(secondary).toEqual([])
  })
})
