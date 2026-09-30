/**
 * activity-feed-ops.test.ts — the feed's sentences from STORED payloads
 * (spec §13.4, §16.2 `activity-feed`; PROGRESS D310(5), D324).
 */
import { describe, expect, it } from 'vitest'

import type { ActivityItem, TransactionActivityItem } from '@/lib/leagues/api/activity-service'
import type { CommishLogItem } from '@/lib/leagues/api/commish-log-service'

import * as ops from './activity-feed-ops'
import { COMMISH_LOG_UNNAMED_ACTOR, COMMISSIONER_LABEL, SYSTEM_LABEL, commishLogLines, feedLines, memberNamesOf, transactionText } from './activity-feed-ops'
import { UNKNOWN_ACTION_WORDS } from './commish-log-copy'

function tx(over: Partial<TransactionActivityItem>): TransactionActivityItem {
  return { kind: 'transaction', id: 'tx1', created_at: '2099-09-10T12:00:00Z', type: 'add_drop', status: 'complete', week: 3, team_id: 't1', actor_id: 'u1', action_id: 'a1', payload: {}, ...over }
}

describe('transactionText — 113’s payload names, nothing computed', () => {
  it('add + drop with position · team tags', () => {
    const item = tx({ payload: { add: { name: 'Nine', player_id: 'p9', position: 'WR', nfl_team: 'AAA' }, drop: { name: 'One', player_id: 'p1', position: 'RB', nfl_team: 'BBB' } } })
    expect(transactionText(item)).toBe('added Nine (WR · AAA), dropped One (RB · BBB)')
  })
  it('add only · drop only · a name missing falls back to the id', () => {
    expect(transactionText(tx({ payload: { add: { name: 'Nine', player_id: 'p9' }, drop: null } }))).toBe('added Nine')
    expect(transactionText(tx({ payload: { add: null, drop: { player_id: 'p1' } } }))).toBe('dropped p1')
  })
  it('a payload without names, or another writer’s type, is labelled — never hidden', () => {
    expect(transactionText(tx({ payload: {} }))).toBe('Roster move')
    expect(transactionText(tx({ type: 'waiver_claim', status: 'pending', payload: {} }))).toBe('Waiver claim (pending)')
    expect(transactionText(tx({ type: 'some_future_type', payload: null }))).toBe('some future type')
    // L.E1.34: every type §12.9's CHECK allows has a label.
    expect(transactionText(tx({ type: 'add', payload: {} }))).toBe('Added a player')
    expect(transactionText(tx({ type: 'drop', payload: {} }))).toBe('Dropped a player')
  })
})

describe('transactionText — a WON waiver claim (TD9 row; M5 L.D2.12)', () => {
  it('names the players in 113’s shape, the winning bid when FAAB was debited, and the drop', () => {
    const payload = { add: { name: 'Nine', player_id: 'p9', position: 'WR', nfl_team: 'AAA' }, drop: { name: 'One', player_id: 'p1' }, faab_bid: 12, faab_before: 40, faab_after: 28 }
    expect(transactionText(tx({ type: 'waiver_claim', payload }))).toBe('claimed Nine (WR · AAA) off waivers for $12, dropped One')
  })
  it('F416 (M5 L.D2.9): the row migration 150 writes renders with both names — its payload as pgTAP 098 F10 pins it', () => {
    // 150's won-claim payload (the fields the feed reads), verbatim from 098 F10 / F9.
    const payload = {
      type: 'waiver_claim',
      claim_id: 'd9800000-0000-4000-8000-000000000004',
      add_player_id: 'wp-y',
      drop_player_id: 'wp-cold',
      faab_bid: 12,
      faab_before: 100,
      faab_after: 88,
      add: { name: 'WP Why', nfl_team: 'SEA', position: 'WR', slot_key: 'bn', to_state: 'rostered', player_id: 'wp-y', from_state: 'free_agent', acquired_at: '2026-11-01T12:00:00+00:00', acquisition_type: 'waiver' },
      drop: { name: 'WP Cold', player_id: 'wp-cold', position: 'QB', nfl_team: 'DEN', to_state: 'on_waivers' },
    }
    expect(transactionText(tx({ type: 'waiver_claim', payload }))).toBe('claimed WP Why (WR · SEA) off waivers for $12, dropped WP Cold (QB · DEN)')
    // …and a priority league's row (150 writes faab_before / faab_after NULL) shows no price.
    expect(transactionText(tx({ type: 'waiver_claim', payload: { ...payload, faab_bid: 0, faab_before: null, faab_after: null } }))).toBe(
      'claimed WP Why (WR · SEA) off waivers, dropped WP Cold (QB · DEN)',
    )
  })
  it('a priority league (no FAAB debit) shows no price; bare TD9 ids name "a player", never a provider id', () => {
    expect(transactionText(tx({ type: 'waiver_claim', payload: { add: { name: 'Nine' }, faab_bid: 0 } }))).toBe('claimed Nine off waivers')
    expect(transactionText(tx({ type: 'waiver_claim', payload: { add_player_id: 'p9', faab_bid: 5, faab_before: 10 } }))).toBe('claimed a player off waivers for $5')
  })
})

describe('transactionText — trades (M5 L.D3.7, F415 / F438): the deal from the stored summary, never a bare "Trade"', () => {
  const summary = 'Alpha gives A One; Bravo gives B One, $5 FAAB'
  it('an executed trade (151’s row) names the deal; a forced one says so', () => {
    expect(transactionText(tx({ type: 'trade', payload: { type: 'trade', summary, via: 'review_none' } }))).toBe(`completed a trade: ${summary}`)
    expect(transactionText(tx({ type: 'trade', payload: { summary, via: 'commissioner_force' } }))).toBe(`completed a trade (forced through by the commissioner): ${summary}`)
    // L.E1.34: 156's approve executes with via 'commissioner_approve'.
    expect(transactionText(tx({ type: 'trade', payload: { summary, via: 'commissioner_approve' } }))).toBe(`completed a trade (approved by the commissioner): ${summary}`)
    expect(transactionText(tx({ type: 'trade', payload: {} }))).toBe('completed a trade')
  })
  it('the commissioner’s reversal (156’s commissioner_move row, kind trade_reversal) says every player went back', () => {
    expect(transactionText(tx({ type: 'commissioner_move', team_id: null, payload: { kind: 'trade_reversal', summary } }))).toBe(`reversed a trade — every player went back: ${summary}`)
    // Any other commissioner_move keeps its label.
    expect(transactionText(tx({ type: 'commissioner_move', payload: {} }))).toBe('Commissioner move')
  })
})

describe('transactionText — a retirement (L.E1.40, F262(a)): the ledger row in words, from the verb payload', () => {
  it('in season: the retired team, the team taking its place and the week', () => {
    expect(transactionText(tx({ type: 'commissioner_move', team_id: null,
      payload: { verb: 'retire_franchise', retired_team_name: 'Bravo', successor_team_name: 'Team 9', retired_at_week: 6, reason: null } })))
      .toBe('retired Bravo — Team 9 takes its place from Week 6')
  })
  it('after the season (no founding week) it says so; a missing name never renders as undefined', () => {
    expect(transactionText(tx({ type: 'commissioner_move', team_id: null,
      payload: { verb: 'retire_franchise', retired_team_name: 'Bravo', successor_team_name: 'Team 9', retired_at_week: null } })))
      .toBe('retired Bravo — Team 9 takes its place after the season')
    expect(transactionText(tx({ type: 'commissioner_move', team_id: null, payload: { verb: 'retire_franchise' } })))
      .toBe('retired a team — a new team takes its place after the season')
  })
})

describe('feedLines — transactions carry their team + week; a system post carries the commissioner treatment ONLY when an actor wrote it', () => {
  const names = new Map([['t1', 'Alpha']])
  const items: ActivityItem[] = [
    tx({ payload: { add: { name: 'Nine', player_id: 'p9' }, drop: null } }),
    { kind: 'system', id: 'c1', created_at: '2099-09-11T12:00:00Z', context: 'league', message: 'Schedule remixed (seed 42).', actor_id: 'u2', topic: null, week: null },
    tx({ id: 'tx2', type: 'commissioner_move', team_id: 't9', payload: {} }),
    // R895: the week worker's notice (116→118 `finalize_matchups`, the
    // postponed-game arm) is written with `user_id NULL` — the engine's
    // post, not a commissioner's act.
    { kind: 'system', id: 'c2', created_at: '2099-09-12T12:00:00Z', context: 'league', message: 'Week 3 finalized with a postponed game.', actor_id: null, topic: null, week: null },
  ]
  it('the shapes — an actor’s system post is the commissioner’s; a NULL actor is the system’s; a named team carries its id, an unnameable one carries none', () => {
    // `teamId` rides beside `team` so the rendered name can be a door to the
    // team page (§16.1). tx2's `t9` is NOT in `names`, so the line has no name
    // AND no id: a franchise we cannot name gets no link, never a dead one.
    expect(feedLines(items, names)).toEqual([
      { id: 'tx1', kind: 'transaction', text: 'added Nine', team: 'Alpha', teamId: 't1', week: 3, createdAt: '2099-09-10T12:00:00Z', commissioner: false, commishActionId: null },
      { id: 'c1', kind: 'system', text: 'Schedule remixed (seed 42).', team: null, teamId: null, week: null, createdAt: '2099-09-11T12:00:00Z', commissioner: true, commishActionId: null },
      { id: 'tx2', kind: 'transaction', text: 'Commissioner move', team: null, teamId: null, week: 3, createdAt: '2099-09-10T12:00:00Z', commissioner: true, commishActionId: null },
      { id: 'c2', kind: 'system', text: 'Week 3 finalized with a postponed game.', team: null, teamId: null, week: null, createdAt: '2099-09-12T12:00:00Z', commissioner: false, commishActionId: null },
    ])
    expect(COMMISSIONER_LABEL).toBe('✸ commissioner')
    expect(SYSTEM_LABEL).toBe('system')
  })
})

describe('no ledger code in any end-user copy (F277(a))', () => {
  it('every exported string constant is free of Q/E/F/D/R numbers', () => {
    for (const [name, value] of Object.entries(ops)) {
      if (typeof value === 'string') expect(value, name).not.toMatch(/\b[QEFDR]\d+\b/)
    }
  })
})

// ---------------------------------------------------------------------------
// COMMISSIONER ACTIONS — the §10.3 log in League Home's activity (L.E1.13, Q66)
// ---------------------------------------------------------------------------

describe('commishLogLines — the act is read from before/after, the reason is optional, the line is never empty', () => {
  const base: CommishLogItem = {
    id: 'ca-1',
    action_type: 'edit_lineup',
    actor: { id: 'u1', username: 'chris' },
    target_type: 'team',
    target_id: 't1',
    reason: null,
    before: null,
    after: null,
    metadata: null,
    acting_as_team_id: null,
    reverts_action_id: null,
    created_at: '2099-09-14T18:00:00.000Z',
  }
  const names = new Map([['t1', 'Alpha'], ['t2', 'Bravo']])
  const line = (over: Partial<CommishLogItem>) => commishLogLines([{ ...base, ...over }], names)[0]

  it('one sentence per verb’s receipt shape (131’s before/after documents)', () => {
    expect(line({ after: { slot_map: {} }, before: { slot_map: {} }, metadata: { week: 3 } }).text).toBe('set Alpha’s Week 3 lineup')
    expect(line({ action_type: 'reassign_team', before: { name: 'Old' }, after: { name: 'New' } }).text).toBe('renamed Old to New')
    expect(line({ target_type: 'matchup', before: { home_score: 10, away_score: 20, result: 'away_win' }, after: { home_score: 30, away_score: 20, result: 'home_win' }, metadata: { week: 7 } }).text).toBe('corrected a Week 7 score: 10–20 → 30–20')
    expect(line({ target_type: 'matchup', before: { home_score: 10, away_score: 20, result: 'away_win' }, after: { home_score: 10, away_score: 20, result: 'home_win' }, metadata: { week: 7 } }).text).toBe('set the result of a Week 7 matchup')
    expect(line({ target_type: 'matchup', before: { home_score: null, away_score: null, result: null }, after: { home_score: 5, away_score: 6, result: null }, metadata: {} }).text).toBe('corrected a score: —–— → 5–6')
    expect(line({ target_type: 'player', after: { team_id: 't2', slot_key: 'bn', acquisition_type: 'commissioner' }, before: { team_id: 't1', slot_key: 'bn', acquisition_type: 'draft' }, metadata: { player_name: 'P', from_team_name: 'Alpha', to_team_name: 'Bravo' } }).text).toBe('moved P from Alpha to Bravo')
    expect(line({ target_type: 'player', after: { team_id: 't2', slot_key: 'bn', acquisition_type: 'commissioner' }, before: { team_id: null, slot_key: null, acquisition_type: null }, metadata: { player_name: 'P', to_team_name: 'Bravo' } }).text).toBe('added P to Bravo')
    expect(line({ target_type: 'player', after: { team_id: null, slot_key: null, acquisition_type: null }, before: { team_id: 't1', slot_key: 'rb', acquisition_type: 'draft' }, metadata: { player_name: 'P', from_team_name: 'Alpha' } }).text).toBe('dropped P from Alpha')
    // L.E1.34 (TD12): the key in words, never the key.
    expect(line({ target_type: 'setting', target_id: 'trade_deadline_week', before: { trade_deadline_week: 10 }, after: { trade_deadline_week: null } }).text).toBe('changed the trade deadline week: 10 → none')
    expect(line({ target_type: 'setting', target_id: 'roster_settings', before: { roster_settings: { bench: 6 } }, after: { roster_settings: { bench: 7 } } }).text).toBe('changed the roster spots: (updated) → (updated)')
    expect(line({ target_type: 'schedule', before: { schedule_seed: 1 }, after: { schedule_seed: 2 }, metadata: { change_count: 42 } }).text).toBe('remixed the schedule (42 team-week pairings changed)')
    expect(line({ target_type: 'schedule', before: { home_team_id: 'a' }, after: { home_team_id: 'b' }, metadata: { week: 4 } }).text).toBe('edited a Week 4 matchup pairing')
  })

  it('M6A L.E1.22 (Q63): the autopilot switch is read from its {autopilot} documents — both directions, the team named live (falling back to the receipt’s team_name), the verb name never on screen', () => {
    expect(line({ action_type: 'set_autopilot', target_id: 't2', before: { autopilot: false }, after: { autopilot: true }, metadata: { team_name: 'Old Bravo' } }).text).toBe('put Bravo on autopilot')
    expect(line({ action_type: 'set_autopilot', target_id: 't2', before: { autopilot: true }, after: { autopilot: false } }).text).toBe('took Bravo off autopilot')
    expect(line({ action_type: 'set_autopilot', target_id: 'gone', before: { autopilot: false }, after: { autopilot: true }, metadata: { team_name: 'Retired Name' } }).text).toBe('put Retired Name on autopilot')
    expect(line({ action_type: 'set_autopilot', target_id: 't1', before: { autopilot: false }, after: { autopilot: true } }).text).not.toContain('set autopilot')
  })

  it('M5 L.D2.11: a FAAB edit is read from its {faab_balance} documents — amounts shown, an unset balance never "null", the verb name never on screen', () => {
    expect(line({ action_type: 'edit_faab', target_id: 't2', before: { faab_balance: 60 }, after: { faab_balance: 250 }, metadata: { team_name: 'Old Bravo' } }).text).toBe('set Bravo’s FAAB balance: $60 → $250')
    expect(line({ action_type: 'edit_faab', target_id: 'gone', before: { faab_balance: null }, after: { faab_balance: 0 }, metadata: { team_name: 'Gone FC' } }).text).toBe('set Gone FC’s FAAB balance: unset → $0')
    expect(line({ action_type: 'edit_faab', target_id: 't1', before: { faab_balance: 5 }, after: { faab_balance: 6 } }).text).not.toContain('edit faab')
  })

  it('M5 L.D3.13 (161): a ruled re-score of a final week reads in plain words, from its {week_scores} documents — never the verb name', () => {
    const rescore = (metadata: { [key: string]: number }) =>
      line({ action_type: 'rescore_final_week', target_type: 'week', target_id: '2026:1', before: { week_scores: [] }, after: { week_scores: [] }, metadata }).text
    expect(rescore({ week: 1, scores_changed: 12 })).toBe('re-scored Week 1 after it was final (12 team scores changed)')
    expect(rescore({ week: 2, scores_changed: 1 })).toBe('re-scored Week 2 after it was final (1 team score changed)')
    expect(rescore({})).toBe('re-scored after it was final')
    expect(rescore({ week: 1 })).not.toContain('rescore final week')
  })

  it('M5 L.D3.5: a commissioner trade override is read from the op it recorded, with the deal — the verb name never on screen', () => {
    const summary = 'Alpha gives A One; Bravo gives B One'
    const trade = (op: string, before: string, after: string) =>
      line({ action_type: `${op}_trade`, target_type: 'trade', target_id: 'tr1', before: { status: before }, after: { status: after },
             metadata: { verb: 'commish_force_or_reverse_trade', op, summary } }).text
    expect(trade('approve', 'in_review', 'complete')).toBe(`approved a trade: ${summary}`)
    expect(trade('veto', 'accepted', 'vetoed')).toBe(`vetoed a trade: ${summary}`)
    expect(trade('force', 'expired', 'complete')).toBe(`forced a trade through: ${summary}`)
    expect(trade('reverse', 'complete', 'reversed')).toBe(`reversed a trade: ${summary}`)
    expect(line({ action_type: 'reverse_trade', target_type: 'trade', target_id: 'tr1', before: { status: 'complete' }, after: { status: 'reversed' },
                  metadata: { verb: 'commish_force_or_reverse_trade', op: 'reverse' } }).text).toBe('reversed a trade')
  })

  it('M5 L.D3.7 (F415): a manager’s trade move the commissioner made for a team (148 / 151’s arm) reads in plain words, with the deal and the team', () => {
    const summary = 'Alpha gives A One; Bravo gives B One'
    const arm = (actionType: string, verb: string) =>
      commishLogLines(
        [{ ...base, action_type: actionType, target_type: 'trade', target_id: 'tr1', acting_as_team_id: 't2', before: { status: 'proposed' }, after: { status: 'proposed' }, metadata: { verb, summary } }],
        new Map([['t2', 'Bravo']]),
      )[0].text
    // L.E1.34 (TD16): "(for <team>)" — the deal names both teams, so the suffix says whose side he took.
    expect(arm('propose_trade', 'trade_propose')).toBe(`offered a trade: ${summary} (for Bravo)`)
    expect(arm('accept_trade', 'trade_respond')).toBe(`accepted a trade: ${summary} (for Bravo)`)
    expect(arm('reject_trade', 'trade_respond')).toBe(`turned down a trade: ${summary} (for Bravo)`)
    expect(arm('cancel_trade', 'trade_respond')).toBe(`called off a trade offer: ${summary} (for Bravo)`)
    expect(arm('counter_trade', 'trade_respond')).toBe(`made a counter-offer: ${summary} (for Bravo)`)
    // The generic "accept trade" line R1174 found is gone.
    expect(arm('accept_trade', 'trade_respond')).not.toMatch(/^accept trade/)
  })

  it('F355: a rename is read from its {name} documents — the word "reassign" never reaches the screen', () => {
    expect(line({ action_type: 'reassign_team', before: { name: 'Old' }, after: { name: 'New' } }).text).not.toContain('reassign')
  })

  it('L.E1.34 (TD12): a type this file does not know reads in plain words — NEVER its code name, NEVER an empty line', () => {
    expect(line({ action_type: 'some_future_power', target_type: 'thing', before: null, after: null }).text).toBe(UNKNOWN_ACTION_WORDS)
    expect(line({ action_type: 'some_future_power', target_type: 'thing', before: null, after: null }).text).not.toContain('future power')
  })

  it('the reason: given ⇒ carried TRIMMED; NULL or blank ⇒ null (rendered as ABSENT — §10.3, Q66)', () => {
    expect(line({ reason: '  bye-week fix ' }).reason).toBe('bye-week fix')
    expect(line({ reason: null }).reason).toBeNull()
    expect(line({ reason: '   ' }).reason).toBeNull()
  })

  it('an unnamed actor is "A commissioner", and acting-as names the team (§7.2.1)', () => {
    expect(line({ actor: { id: 'u1', username: null } }).actor).toBe(COMMISH_LOG_UNNAMED_ACTOR)
    expect(line({ after: { slot_map: {} }, metadata: { week: 1 }, acting_as_team_id: 't2' }).text).toBe('set Alpha’s Week 1 lineup (for Bravo)')
  })
})

// ---------------------------------------------------------------------------
// L.E1.34 — one line per act (Q84 / F463), the ✸ line's entry (F233(d)),
// "(for <team>)" only when the sentence has not named it (F518)
// ---------------------------------------------------------------------------

describe('feedLines — one line per act, and the ✸ line carries its log entry (L.E1.34)', () => {
  const names = new Map([['t1', 'Alpha'], ['t2', 'Bravo']])
  const post = (over: Partial<Extract<ActivityItem, { kind: 'system' }>>): ActivityItem => ({
    kind: 'system', id: 'p1', created_at: '2099-09-10T12:00:00Z', context: 'league', message: 'chris (commissioner) reversed a trade — …', actor_id: 'u1', topic: null, week: null, ...over,
  })

  it('a reversal (156: a commissioner_move row + the actor’s post + ONE receipt) is ONE line — the transaction’s, ✸, linked to the entry', () => {
    const lines = feedLines(
      [tx({ id: 'rev', type: 'commissioner_move', team_id: null, payload: { kind: 'trade_reversal', summary: 'Alpha gives A; Bravo gives B' }, commish_action_id: 'ca-rev' }), post({ commish_action_id: 'ca-rev' })],
      names,
    )
    expect(lines.map((l) => [l.id, l.commissioner, l.commishActionId])).toEqual([['rev', true, 'ca-rev']])
  })

  it('a forced trade: the trade row takes the receipt written in its transaction — ONE ✸ line saying so', () => {
    const lines = feedLines([tx({ id: 'tr', type: 'trade', payload: { summary: 'S', via: 'commissioner_force' }, commish_action_id: 'ca-f' }), post({ id: 'pf', commish_action_id: 'ca-f' })], names)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ id: 'tr', commissioner: true, commishActionId: 'ca-f', text: 'completed a trade (forced through by the commissioner): S' })
  })

  it('a commissioner post with no feed row (a veto, a score fix) stays, ✸ and linked; a manager’s move and a system notice carry no entry', () => {
    const lines = feedLines([post({ id: 'veto', message: 'chris (commissioner) vetoed a trade: S', commish_action_id: 'ca-v' }), tx({ id: 'mine' }), post({ id: 'sys', actor_id: null, message: 'Week 3 was finalized.' })], names)
    expect(lines.map((l) => [l.id, l.commissioner, l.commishActionId])).toEqual([
      ['veto', true, 'ca-v'],
      ['mine', false, null],
      ['sys', false, null],
    ])
  })

  it('a stat-correction post shows the week it names', () => {
    expect(feedLines([post({ actor_id: null, topic: 'stat_correction', week: 3, message: 'Stat correction (Week 3): …' })], names)[0].week).toBe(3)
  })
})

describe('commishLogLines — "(for <team>)" and member names (L.E1.34; F518, D451)', () => {
  const item = (over: Partial<CommishLogItem>): CommishLogItem => ({
    id: 'ca', action_type: 'edit_lineup', actor: { id: 'u1', username: 'chris' }, target_type: 'team', target_id: 't1', reason: null,
    before: null, after: null, metadata: null, acting_as_team_id: null, reverts_action_id: null, created_at: '2099-09-14T18:00:00.000Z', ...over,
  })
  const names = new Map([['t1', 'Alpha'], ['t2', 'Bravo']])
  const text = (over: Partial<CommishLogItem>, members = new Map<string, string>()) => commishLogLines([item(over)], names, members)[0].text

  it('F518: the suffix drops when the sentence already names the team he acted for', () => {
    expect(text({ after: { slot_map: {} }, metadata: { week: 3 }, acting_as_team_id: 't1' })).toBe('set Alpha’s Week 3 lineup')
    expect(text({ action_type: 'draft_force_pick', target_type: 'draft_pick', after: { pick_number: 12, team_id: 't2' }, metadata: { for_team_id: 't2' }, acting_as_team_id: 't2' })).toBe('made pick 12 for Bravo')
    expect(text({ action_type: 'set_autodraft', target_id: 't2', before: { autodraft: false }, after: { autodraft: true }, acting_as_team_id: 't2' })).toBe('turned autodraft on for Bravo')
    expect(text({ action_type: 'reassign_team', target_id: 't1', before: { name: 'Old' }, after: { name: 'Alpha' }, acting_as_team_id: 't1' })).toBe('renamed Old to Alpha')
    expect(text({ action_type: 'force_add', target_type: 'player', after: { acquisition_type: 'commissioner' }, before: { acquisition_type: null }, metadata: { player_name: 'P', to_team_name: 'Bravo' }, acting_as_team_id: 't2' })).toBe('added P to Bravo')
  })

  it('a membership receipt names the member from the league’s member list — and says what happened without it', () => {
    const members = new Map([['u7', 'dana']])
    expect(text({ action_type: 'promote_member', target_type: 'member', before: { role: 'manager' }, after: { role: 'co_commissioner' }, metadata: { user_id: 'u7' } }, members)).toBe('made dana a co-commissioner')
    expect(text({ action_type: 'promote_member', target_type: 'member', before: { role: 'manager' }, after: { role: 'co_commissioner' }, metadata: { user_id: 'u7' } })).toBe('made a member a co-commissioner')
    expect(memberNamesOf([{ user_id: 'u7', profiles: { username: 'dana' } }, { user_id: null, profiles: null }])).toEqual(new Map([['u7', 'dana']]))
  })
})
