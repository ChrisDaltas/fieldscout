/**
 * activity-feed-ops.test.ts — the feed's sentences from STORED payloads
 * (spec §13.4, §16.2 `activity-feed`; PROGRESS D310(5), D324).
 */
import { describe, expect, it } from 'vitest'

import type { ActivityItem, TransactionActivityItem } from '@/lib/leagues/api/activity-service'
import type { CommishLogItem } from '@/lib/leagues/api/commish-log-service'

import * as ops from './activity-feed-ops'
import { COMMISH_LOG_UNNAMED_ACTOR, COMMISSIONER_LABEL, SYSTEM_LABEL, commishLogLines, feedLines, transactionText } from './activity-feed-ops'

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
  })
})

describe('feedLines — transactions carry their team + week; a system post carries the commissioner treatment ONLY when an actor wrote it', () => {
  const names = new Map([['t1', 'Alpha']])
  const items: ActivityItem[] = [
    tx({ payload: { add: { name: 'Nine', player_id: 'p9' }, drop: null } }),
    { kind: 'system', id: 'c1', created_at: '2099-09-11T12:00:00Z', context: 'league', message: 'Schedule remixed (seed 42).', actor_id: 'u2' },
    tx({ id: 'tx2', type: 'commissioner_move', team_id: 't9', payload: {} }),
    // R895: the week worker's notice (116→118 `finalize_matchups`, the
    // postponed-game arm) is written with `user_id NULL` — the engine's
    // post, not a commissioner's act.
    { kind: 'system', id: 'c2', created_at: '2099-09-12T12:00:00Z', context: 'league', message: 'Week 3 finalized with a postponed game.', actor_id: null },
  ]
  it('the shapes — an actor’s system post is the commissioner’s; a NULL actor is the system’s; a named team carries its id, an unnameable one carries none', () => {
    // `teamId` rides beside `team` so the rendered name can be a door to the
    // team page (§16.1). tx2's `t9` is NOT in `names`, so the line has no name
    // AND no id: a franchise we cannot name gets no link, never a dead one.
    expect(feedLines(items, names)).toEqual([
      { id: 'tx1', kind: 'transaction', text: 'added Nine', team: 'Alpha', teamId: 't1', week: 3, createdAt: '2099-09-10T12:00:00Z', commissioner: false },
      { id: 'c1', kind: 'system', text: 'Schedule remixed (seed 42).', team: null, teamId: null, week: null, createdAt: '2099-09-11T12:00:00Z', commissioner: true },
      { id: 'tx2', kind: 'transaction', text: 'Commissioner move', team: null, teamId: null, week: 3, createdAt: '2099-09-10T12:00:00Z', commissioner: true },
      { id: 'c2', kind: 'system', text: 'Week 3 finalized with a postponed game.', team: null, teamId: null, week: null, createdAt: '2099-09-12T12:00:00Z', commissioner: false },
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
    expect(line({ target_type: 'setting', target_id: 'trade_deadline_week', before: { trade_deadline_week: 10 }, after: { trade_deadline_week: null } }).text).toBe('changed the trade deadline week setting: 10 → none')
    expect(line({ target_type: 'setting', target_id: 'roster_settings', before: { roster_settings: { bench: 6 } }, after: { roster_settings: { bench: 7 } } }).text).toBe('changed the roster settings setting: (updated) → (updated)')
    expect(line({ target_type: 'schedule', before: { schedule_seed: 1 }, after: { schedule_seed: 2 }, metadata: { change_count: 42 } }).text).toBe('remixed the schedule (42 team-week pairings changed)')
    expect(line({ target_type: 'schedule', before: { home_team_id: 'a' }, after: { home_team_id: 'b' }, metadata: { week: 4 } }).text).toBe('edited a Week 4 matchup pairing')
  })

  it('F355: a rename is read from its {name} documents — the word "reassign" never reaches the screen', () => {
    expect(line({ action_type: 'reassign_team', before: { name: 'Old' }, after: { name: 'New' } }).text).not.toContain('reassign')
  })

  it('a shape this file does not know falls back to the action’s own name — NEVER an empty line', () => {
    expect(line({ action_type: 'some_future_power', target_type: 'thing', before: null, after: null }).text).toBe('some future power')
  })

  it('the reason: given ⇒ carried TRIMMED; NULL or blank ⇒ null (rendered as ABSENT — §10.3, Q66)', () => {
    expect(line({ reason: '  bye-week fix ' }).reason).toBe('bye-week fix')
    expect(line({ reason: null }).reason).toBeNull()
    expect(line({ reason: '   ' }).reason).toBeNull()
  })

  it('an unnamed actor is "A commissioner", and acting-as names the team (§7.2.1)', () => {
    expect(line({ actor: { id: 'u1', username: null } }).actor).toBe(COMMISH_LOG_UNNAMED_ACTOR)
    expect(line({ after: { slot_map: {} }, metadata: { week: 1 }, acting_as_team_id: 't2' }).text).toBe('set Alpha’s Week 1 lineup (acting for Bravo)')
  })
})
