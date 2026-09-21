/**
 * In-season sweep pins — L.D6.1 item 3 (§4.3's falsifiability floor: EVERY
 * invariant is falsifiable ALONE, one `it()` per invariant mutating exactly
 * one field of a green audit, and every failure NAMES its league AND week).
 *
 * The live half of these — the same seven violations PLANTED IN THE DATABASE
 * against migrations 001–122 — lives in `season-sweep-db.test.ts`. Invariant
 * 1's roster arm is the one that CANNOT be planted live (072:147's
 * `UNIQUE(league_id, player_id)` refuses even a service-role INSERT), which
 * is why its falsifiability lives here and is DECLARED rather than shipped
 * decorative (D267; `season-invariants.ts`'s banner).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  checkExclusivity,
  checkFinalCellsImmutable,
  checkLineupLegality,
  checkNoWorkerErrors,
  checkPointsForOnce,
  checkPoolMirror,
  checkStandingsRecompute,
  checkUnmanagedSeatsAutopiloted,
  classifyHeldWeeks,
  SEASON_INVARIANTS,
  startersOfMap,
  sweepSeasonAudit,
  toInvariantFailure,
  type SeasonAudit,
} from './season-invariants'
import {
  BLOCKING_DESIGNATIONS,
  chooseStarterSlots,
  classifyReconcileAlert,
  lawfulBracketSkip,
  simDesignation,
} from './season-runner'

/**
 * A compact, fully-consistent two-team league that drove ONE week to `final`:
 * both teams roster two players, start both, both score, the standings agree
 * with the sum of the week's results, the rebuild is a no-op and the final
 * cell is byte-unchanged.
 */
function greenAudit(): SeasonAudit {
  return {
    leagueLabel: 'SIM L.B6.1 #01',
    leagueId: 'league-1',
    season: 2099,
    scheduleMode: 'h2h',
    // The §7.3.1 minimum — the oracle's window is weeks 1-12 here (R920).
    regularSeasonWeeks: 12,
    weeksDriven: [1],
    rosters: [
      { team_id: 'A', player_id: 'p1' },
      { team_id: 'A', player_id: 'p2' },
      { team_id: 'B', player_id: 'p3' },
      { team_id: 'B', player_id: 'p4' },
      // Team C is the UNMANAGED seat (M6A L.E1.14): it has no standings /
      // results rows here because invariants 3 and 5 are pinned on A and B;
      // what it carries is a roster and a server-written lineup.
      { team_id: 'C', player_id: 'p5' },
      { team_id: 'C', player_id: 'p6' },
      { team_id: 'C', player_id: 'p10' },
    ],
    pool: [
      { player_id: 'p1', state: 'rostered' },
      { player_id: 'p2', state: 'rostered' },
      { player_id: 'p3', state: 'rostered' },
      { player_id: 'p4', state: 'rostered' },
      { player_id: 'p9', state: 'free_agent' },
    ],
    lineups: [
      {
        team_id: 'A',
        week: 1,
        slot_map: { 'qb:0': 'p1', 'rb:0': 'p2' },
        ir_keys: ['ir1'],
        fit: { unplaced: [], rearranged: false },
      },
      {
        team_id: 'B',
        week: 1,
        slot_map: { 'qb:0': 'p3', 'rb:0': 'p4' },
        ir_keys: ['ir1'],
        fit: { unplaced: [], rearranged: false },
      },
      {
        team_id: 'C',
        week: 1,
        slot_map: { 'qb:0': 'p5', 'rb:0': 'p6' },
        ir_keys: ['ir1'],
        fit: { unplaced: [], rearranged: false },
      },
    ],
    standings: [
      { team_id: 'A', points_for: 21.5 },
      { team_id: 'B', points_for: 18.25 },
    ],
    results: [
      { team_id: 'A', week: 1, points: 21.5, is_final: true },
      { team_id: 'B', week: 1, points: 18.25, is_final: true },
    ],
    weeks: [{ week: 1, status: 'final' }],
    finalCells: [
      {
        week: 1,
        matchup_id: 'm1',
        at_final: 'home=21.50 away=18.25',
        at_end: 'home=21.50 away=18.25',
        baselines: [{ rendered: 'home=21.50 away=18.25', licensed_by: null }],
      },
    ],
    commissionerActions: [],
    allowIllegalLineups: true,
    startingSlots: [
      { key: 'qb:0', eligible: ['QB'] },
      { key: 'rb:0', eligible: ['RB'] },
    ],
    unmanagedSeats: [
      {
        team_id: 'C',
        shape: 'member_row_user_id_null',
        roster: [
          { player_id: 'p5', position: 'QB' },
          { player_id: 'p6', position: 'RB' },
          { player_id: 'p10', position: 'RB' }, // the bench — a second RB behind a filled RB slot
        ],
      },
    ],
    autopilotUnfillable: [],
    rebuilds: [
      {
        week: 1,
        week_status: 'final',
        changed: false,
        reason: 'already_consistent',
        digest_before: 'abc123',
        digest_after: 'abc123',
        refusal: null,
      },
    ],
    reconcileFindings: [],
    workerErrors: [],
    noStatRowStarters: 0,
  }
}

describe('the in-season sweep — green on a consistent season, and every failure names it', () => {
  it('a fully consistent audit sweeps clean', () => {
    expect(sweepSeasonAudit(greenAudit())).toEqual([])
  })

  it('the invariant names are the row\'s seven in the row\'s order, then M6A L.E1.14\'s eighth', () => {
    expect(SEASON_INVARIANTS).toEqual([
      'exclusivity',
      'lineup-legality',
      'standings-recompute',
      'pool-roster-mirror',
      'pf-once-per-week',
      'final-cell-immutable',
      'zero-worker-errors',
      'unmanaged-seat-autopilot',
    ])
  })
})

describe('1 — exclusivity (§11.1; CLAUDE.md rule 7)', () => {
  it('two teams rostering one player names both teams (the arm 072:147 makes unplantable live)', () => {
    const a = greenAudit()
    a.rosters = [...a.rosters, { team_id: 'B', player_id: 'p1' }]
    const failures = checkExclusivity(a)
    expect(failures.length).toBeGreaterThan(0)
    expect(failures[0]!.invariant).toBe('exclusivity')
    expect(failures[0]!.leagueId).toBe('league-1')
    expect(failures[0]!.detail).toContain('p1')
    expect(failures[0]!.detail).toContain('A')
    expect(failures[0]!.detail).toContain('B')
  })

  it('starting a player the team does not roster names the team and the week', () => {
    const a = greenAudit()
    a.lineups[0]!.slot_map = { 'qb:0': 'p1', 'rb:0': 'p9' } // p9 is on no roster
    const failures = checkExclusivity(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.week).toBe(1)
    expect(failures[0]!.detail).toContain('team A starts p9')
    expect(failures[0]!.detail).toContain('not on any roster')
  })

  it('one player started by two teams in a week names both (nothing constrains slot_map)', () => {
    const a = greenAudit()
    a.rosters = [...a.rosters, { team_id: 'B', player_id: 'p1' }].filter(
      (r) => !(r.team_id === 'A' && r.player_id === 'p1'),
    )
    a.lineups[1]!.slot_map = { 'qb:0': 'p1', 'rb:0': 'p4' }
    a.lineups[0]!.slot_map = { 'qb:0': 'p1', 'rb:0': 'p2' }
    const failures = checkExclusivity(a)
    expect(failures.some((f) => f.detail.includes('started by BOTH team'))).toBe(true)
  })

  it('an IR-slotted player is NOT a starter (§12.13: IR keys are excluded)', () => {
    expect(startersOfMap({ 'qb:0': 'p1', 'ir1:0': 'p9' }, ['ir1'])).toEqual(['p1'])
  })
})

describe('2 — roster/lineup legality, the bipartite recheck (§11.1/§11.2; E16)', () => {
  it("an unplaced starter names the team, the week and the player (the oracle's own word)", () => {
    const a = greenAudit()
    a.lineups[0]!.fit = { unplaced: ['p2'], rearranged: false }
    const failures = checkLineupLegality(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.invariant).toBe('lineup-legality')
    expect(failures[0]!.week).toBe(1)
    expect(failures[0]!.detail).toContain('cannot seat p2')
  })

  it('a stored map the matcher REARRANGES is not its own fit', () => {
    const a = greenAudit()
    a.lineups[1]!.fit = { unplaced: [], rearranged: true }
    const failures = checkLineupLegality(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('REARRANGED')
  })

  it('an unreadable slot_map is named, never assumed empty', () => {
    const a = greenAudit()
    a.lineups[0]!.slot_map = null
    const failures = checkLineupLegality(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('not a readable object')
  })

  it('a week with nothing started has no fit to check (not a failure)', () => {
    const a = greenAudit()
    a.lineups[0]!.slot_map = {}
    a.lineups[0]!.fit = null
    expect(checkLineupLegality(a)).toEqual([])
  })
})

describe('3 — standings ≡ recompute-from-scratch (§11.5; D297/D314)', () => {
  it('a rebuild that CHANGES a final week names the week and both digests', () => {
    const a = greenAudit()
    a.rebuilds = [{ ...a.rebuilds[0]!, changed: true, reason: 'rebuilt', digest_after: 'zzz999' }]
    const failures = checkStandingsRecompute(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.week).toBe(1)
    expect(failures[0]!.detail).toContain('abc123')
    expect(failures[0]!.detail).toContain('zzz999')
  })

  it('changed=false with differing digests is still a failure (the ±1 boundary)', () => {
    const a = greenAudit()
    a.rebuilds = [{ ...a.rebuilds[0]!, digest_after: 'abc124' }]
    expect(checkStandingsRecompute(a)).toHaveLength(1)
  })

  it("a refusal on a NON-final week is the RPC working — skipped by name", () => {
    const a = greenAudit()
    a.weeks = [{ week: 1, status: 'live' }]
    a.rebuilds = [
      {
        week: 1,
        week_status: 'live',
        changed: null,
        reason: null,
        digest_before: null,
        digest_after: null,
        refusal: 'week_not_final — league … week 1 is live',
      },
    ]
    expect(checkStandingsRecompute(a)).toEqual([])
  })

  it('a refusal on a FINAL week carries the refusal verbatim', () => {
    const a = greenAudit()
    a.rebuilds = [{ ...a.rebuilds[0]!, refusal: 'pending_scores — 3 matchups' }]
    const failures = checkStandingsRecompute(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('pending_scores')
  })

  it("reconcile's drift and twr_mirror_drift are promoted here, and nothing else is", () => {
    const a = greenAudit()
    a.reconcileFindings = [
      { kind: 'drift', severity: 'alert', week: 1, message: 'team A stored 10 recomputed 11' },
      { kind: 'twr_mirror_drift', severity: 'alert', week: 1, message: 'mirror' },
      { kind: 'starter_final_game_no_line', severity: 'alert', week: 1, message: 'no line' },
    ]
    const failures = checkStandingsRecompute(a)
    expect(failures).toHaveLength(2)
    expect(failures.map((f) => f.detail)).toEqual([
      'reconcile drift: team A stored 10 recomputed 11',
      'reconcile twr_mirror_drift: mirror',
    ])
  })
})

describe('4 — pool/roster mirror (§12.19; D294)', () => {
  it('a rostered pool row nobody rosters names the player', () => {
    const a = greenAudit()
    a.pool = [...a.pool, { player_id: 'p7', state: 'rostered' }]
    const failures = checkPoolMirror(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.invariant).toBe('pool-roster-mirror')
    expect(failures[0]!.detail).toContain('p7')
  })

  it("a rostered player whose pool row says free_agent names him (the D294 flip)", () => {
    const a = greenAudit()
    a.pool = [{ player_id: 'p1', state: 'free_agent' }, ...a.pool.slice(1)]
    const failures = checkPoolMirror(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain("'free_agent'")
    expect(failures[0]!.detail).toContain('team A rosters him')
  })

  it('a roster row with NO pool row is LEGAL (§12.19 lazy rows — the naive false positive)', () => {
    const a = greenAudit()
    a.pool = a.pool.filter((p) => p.player_id !== 'p4')
    expect(checkPoolMirror(a)).toEqual([])
  })

  it("'locked_in_game' mirrors a roster row exactly as 'rostered' does", () => {
    const a = greenAudit()
    a.pool = [{ player_id: 'p1', state: 'locked_in_game' }, ...a.pool.slice(1)]
    expect(checkPoolMirror(a)).toEqual([])
  })
})

describe('5 — PF counted once per week (§11.7; D297)', () => {
  it('a standings PF that is not the sum of the final weeks names the team and both numbers', () => {
    const a = greenAudit()
    a.standings[0]!.points_for = 43 // double-counted
    const failures = checkPointsForOnce(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.invariant).toBe('pf-once-per-week')
    expect(failures[0]!.detail).toContain('43')
    expect(failures[0]!.detail).toContain('21.50')
  })

  it('a NON-final week contributes nothing to PF (the median/second extra games move W/L, not PF)', () => {
    const a = greenAudit()
    a.weeks = [
      { week: 1, status: 'final' },
      { week: 2, status: 'live' },
    ]
    a.results = [...a.results, { team_id: 'A', week: 2, points: 99, is_final: false }]
    expect(checkPointsForOnce(a)).toEqual([])
  })

  it('a FINAL week carrying a NULL points is named, never summed as zero (E61)', () => {
    const a = greenAudit()
    a.results = [{ team_id: 'A', week: 1, points: null, is_final: true }, ...a.results.slice(1)]
    const failures = checkPointsForOnce(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('NULL team_week_results.points')
  })

  it('cent-level agreement is agreement (both sides are two-decimal values by law)', () => {
    const a = greenAudit()
    a.standings[0]!.points_for = 21.5000001
    expect(checkPointsForOnce(a)).toEqual([])
  })

  it('one cent of disagreement is a failure (the ±1 boundary)', () => {
    const a = greenAudit()
    a.standings[0]!.points_for = 21.51
    expect(checkPointsForOnce(a)).toHaveLength(1)
  })

  // R920 — the window boundary, both sides of it. The oracle
  // (`league_standings_internal`, 118:641-643/684-690) sums
  // `[v_first … v_first + regular_season_weeks − 1]` and nothing else, so a
  // FINAL bracket week must contribute NOTHING here. Before the fix this
  // check summed every `final` week and emitted a deterministic FALSE FAILURE
  // for every bracket participant on a `--weeks ≥ 13` run.
  it('a FINAL PLAYOFF week contributes nothing — the sweep sums the ORACLE\'s window, not every final week', () => {
    const a = greenAudit()
    a.regularSeasonWeeks = 2
    a.weeks = [
      { week: 1, status: 'final' },
      { week: 2, status: 'final' },
      { week: 3, status: 'final' }, // the bracket's first week
    ]
    a.results = [
      ...a.results,
      { team_id: 'A', week: 3, points: 99, is_final: true },
      { team_id: 'B', week: 3, points: 77, is_final: true },
    ]
    expect(checkPointsForOnce(a)).toEqual([])
  })

  it('the LAST regular-season week still counts (the inclusive upper bound)', () => {
    const a = greenAudit()
    a.regularSeasonWeeks = 2
    a.weeks = [
      { week: 1, status: 'final' },
      { week: 2, status: 'final' },
    ]
    a.results = [...a.results, { team_id: 'A', week: 2, points: 10, is_final: true }]
    const failures = checkPointsForOnce(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('31.50')
  })

  it('is_final — not the WEEK\'s status — is the row-level predicate the oracle uses', () => {
    const a = greenAudit()
    // The week says final; the row does not. The oracle would skip it.
    a.results = [{ team_id: 'A', week: 1, points: 21.5, is_final: false }, ...a.results.slice(1)]
    const failures = checkPointsForOnce(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('= 0.00')
  })
})

describe('6 — zero final-cell rewrites (§23.4; D295(b))', () => {
  it('a cell that moved after its week went final names the week, the matchup and both renderings', () => {
    const a = greenAudit()
    a.finalCells[0]!.at_end = 'home=99.00 away=18.25'
    const failures = checkFinalCellsImmutable(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.invariant).toBe('final-cell-immutable')
    expect(failures[0]!.week).toBe(1)
    expect(failures[0]!.detail).toContain('home=21.50')
    expect(failures[0]!.detail).toContain('home=99.00')
  })

  it('byte-identity is the assertion — an equal rendering passes', () => {
    expect(checkFinalCellsImmutable(greenAudit())).toEqual([])
  })
})

/**
 * D345 / F336 (M6A L.E1.14 item 3) — invariant 6 is TAUGHT provenance, never
 * exempted. `overriddenAudit()` is the ONE lawful shape; every `it()` below
 * it mutates exactly one field of that shape.
 */
describe('6 — provenance: a lawful override is ACCOUNTED FOR, never skipped (D345; F336)', () => {
  const MOVED = 'home=22.50 away=18.25'

  function overriddenAudit(): SeasonAudit {
    const a = greenAudit()
    a.finalCells[0]!.baselines = [
      { rendered: 'home=21.50 away=18.25', licensed_by: null },
      { rendered: MOVED, licensed_by: 'act-1' },
    ]
    a.finalCells[0]!.at_end = MOVED
    a.commissionerActions = [{ id: 'act-1', target_type: 'matchup', target_id: 'm1' }]
    return a
  }

  it('a cell that moves WITH a matching audit row passes', () => {
    expect(checkFinalCellsImmutable(overriddenAudit())).toEqual([])
    expect(sweepSeasonAudit(overriddenAudit())).toEqual([])
  })

  it('the same movement with NO audit row still FAILS', () => {
    const a = overriddenAudit()
    a.commissionerActions = []
    const failures = checkFinalCellsImmutable(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.invariant).toBe('final-cell-immutable')
    expect(failures[0]!.week).toBe(1)
    expect(failures[0]!.detail).toContain('NO audit row')
    expect(failures[0]!.detail).toContain('act-1')
  })

  it('a movement whose audit row targets a DIFFERENT matchup FAILS', () => {
    const a = overriddenAudit()
    a.commissionerActions = [{ id: 'act-1', target_type: 'matchup', target_id: 'm2' }]
    const failures = checkFinalCellsImmutable(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('DIFFERENT target')
    expect(failures[0]!.detail).toContain('matchup m2')
  })

  it('two consecutive baselines differing byte-wise BETWEEN re-baselines FAIL — a re-baseline cannot launder drift', () => {
    const a = overriddenAudit()
    // The runner re-read the cell just before the audited event and it had
    // already moved: that rendering is recorded with no licence.
    a.finalCells[0]!.baselines = [
      { rendered: 'home=21.50 away=18.25', licensed_by: null },
      { rendered: 'home=21.75 away=18.25', licensed_by: null },
      { rendered: MOVED, licensed_by: 'act-1' },
    ]
    const failures = checkFinalCellsImmutable(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('DRIFTED BETWEEN BASELINES')
    expect(failures[0]!.detail).toContain('home=21.75')
  })

  it('a cell that moves again AFTER its licensed baseline fails against THAT baseline', () => {
    const a = overriddenAudit()
    a.finalCells[0]!.at_end = 'home=30.00 away=18.25'
    const failures = checkFinalCellsImmutable(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('last audited baseline')
    expect(failures[0]!.detail).toContain('home=30.00')
  })

  it('an audit row of another target TYPE carrying the matchup\'s id does not license it', () => {
    const a = overriddenAudit()
    a.commissionerActions = [{ id: 'act-1', target_type: 'player', target_id: 'm1' }]
    expect(checkFinalCellsImmutable(a)).toHaveLength(1)
  })

  it('one receipt cannot license TWO baseline changes of a cell', () => {
    const a = overriddenAudit()
    a.finalCells[0]!.baselines = [
      ...a.finalCells[0]!.baselines,
      { rendered: 'home=23.50 away=18.25', licensed_by: 'act-1' },
    ]
    a.finalCells[0]!.at_end = 'home=23.50 away=18.25'
    const failures = checkFinalCellsImmutable(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('spent TWICE')
  })

  it('a duplicated audit id is not "exactly one" row', () => {
    const a = overriddenAudit()
    a.commissionerActions = [...a.commissionerActions, { id: 'act-1', target_type: 'matchup', target_id: 'm1' }]
    const failures = checkFinalCellsImmutable(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('2 commissioner_actions row(s)')
  })

  it('a provenance record whose first baseline is not the unlicensed at-finalize rendering is malformed', () => {
    const a = greenAudit()
    a.finalCells[0]!.baselines = []
    expect(checkFinalCellsImmutable(a)[0]!.detail).toContain('malformed')
    const b = greenAudit()
    b.finalCells[0]!.baselines = [{ rendered: 'home=21.50 away=18.25', licensed_by: 'act-1' }]
    expect(checkFinalCellsImmutable(b)[0]!.detail).toContain('malformed')
  })
})

describe('7 — zero unhandled worker errors (§23.2)', () => {
  it('every worker error becomes one failure carrying league context', () => {
    const a = greenAudit()
    a.workerErrors = ['league X week 1 FAILED — snapshot_missing', 'ack_missed lease_lost=1']
    const failures = checkNoWorkerErrors(a)
    expect(failures).toHaveLength(2)
    expect(failures.every((f) => f.leagueId === 'league-1')).toBe(true)
  })
})

describe('8 — unmanaged seats are seated by the SERVER (§7.2.1(c); 125; F334/F335)', () => {
  it('an unmanaged seat the server never seated — an EMPTY map — names the team, the week and every slot', () => {
    const a = greenAudit()
    a.lineups[2]!.slot_map = {}
    a.lineups[2]!.fit = null
    const failures = checkUnmanagedSeatsAutopiloted(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.invariant).toBe('unmanaged-seat-autopilot')
    expect(failures[0]!.week).toBe(1)
    expect(failures[0]!.detail).toContain('team C')
    expect(failures[0]!.detail).toContain('EMPTY')
    expect(failures[0]!.detail).toContain('qb:0')
    expect(failures[0]!.detail).toContain('rb:0')
  })

  it('ONE empty slot beside an eligible unstarted player is a shortfall, named by slot key and by witness', () => {
    const a = greenAudit()
    a.lineups[2]!.slot_map = { 'qb:0': 'p5' }
    const failures = checkUnmanagedSeatsAutopiloted(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('rb:0')
    expect(failures[0]!.detail).toContain('p6')
    expect(failures[0]!.detail).not.toContain('qb:0')
  })

  it('an unmanaged seat with NO team_lineups row at all fails (D354)', () => {
    const a = greenAudit()
    a.lineups = a.lineups.slice(0, 2)
    const failures = checkUnmanagedSeatsAutopiloted(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('NO team_lineups row')
  })

  it('an empty slot NOBODY on the roster could take is lawful — the witness, not the emptiness, is the failure', () => {
    const a = greenAudit()
    a.lineups[2]!.slot_map = { 'rb:0': 'p6' }
    a.unmanagedSeats = [{ ...a.unmanagedSeats[0]!, roster: a.unmanagedSeats[0]!.roster.filter((p) => p.position !== 'QB') }]
    expect(checkUnmanagedSeatsAutopiloted(a)).toEqual([])
  })

  it('the ONE excuse needs BOTH halves — the league forbids illegal lineups AND the tick named the slot', () => {
    const shortfall = (): SeasonAudit => {
      const a = greenAudit()
      a.lineups[2]!.slot_map = { 'qb:0': 'p5' }
      return a
    }
    const namedOnly = shortfall()
    namedOnly.autopilotUnfillable = [{ team_id: 'C', week: 1, slot: 'rb:0', reason: 'no healthy eligible player at RB' }]
    expect(checkUnmanagedSeatsAutopiloted(namedOnly)).toHaveLength(1) // allow_illegal_lineups is TRUE: no excuse exists

    const offOnly = shortfall()
    offOnly.allowIllegalLineups = false
    const offFailures = checkUnmanagedSeatsAutopiloted(offOnly)
    expect(offFailures).toHaveLength(1) // the server said nothing about the slot
    expect(offFailures[0]!.detail).toContain('never named them in autopilot_unfillable[]')

    const both = shortfall()
    both.allowIllegalLineups = false
    both.autopilotUnfillable = [{ team_id: 'C', week: 1, slot: 'rb:0', reason: 'no healthy eligible player at RB' }]
    expect(checkUnmanagedSeatsAutopiloted(both)).toEqual([])

    const wrongWeek = shortfall()
    wrongWeek.allowIllegalLineups = false
    wrongWeek.autopilotUnfillable = [{ team_id: 'C', week: 2, slot: 'rb:0', reason: 'no healthy eligible player at RB' }]
    expect(checkUnmanagedSeatsAutopiloted(wrongWeek)).toHaveLength(1)
  })

  it('a week that has not OPENED yet is not asserted on; a MANAGED team\'s empty map is not this invariant\'s', () => {
    const a = greenAudit()
    a.lineups[2]!.slot_map = {}
    a.weeks = [{ week: 1, status: 'upcoming' }]
    expect(checkUnmanagedSeatsAutopiloted(a)).toEqual([])

    const b = greenAudit()
    b.lineups[0]!.slot_map = {} // team A has a manager
    expect(checkUnmanagedSeatsAutopiloted(b)).toEqual([])
  })

  it('a team with NO league_members row is listed and fails with the reason the server will never seat it', () => {
    const a = greenAudit()
    a.lineups[2]!.slot_map = {}
    a.unmanagedSeats = [{ ...a.unmanagedSeats[0]!, shape: 'no_member_row' }]
    const failures = checkUnmanagedSeatsAutopiloted(a)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('DECLINES')
  })

  it('PREMISE: over ZERO unmanaged seats the check asserts nothing — which is why the RUNNER makes zero a problem', () => {
    const a = greenAudit()
    a.lineups[2]!.slot_map = {}
    a.unmanagedSeats = []
    expect(checkUnmanagedSeatsAutopiloted(a)).toEqual([])
  })

  it('an IR occupant is not a bench witness', () => {
    const a = greenAudit()
    a.lineups[2]!.slot_map = { 'qb:0': 'p5', 'ir1:0': 'p6' }
    a.unmanagedSeats = [{ ...a.unmanagedSeats[0]!, roster: a.unmanagedSeats[0]!.roster.filter((p) => p.player_id !== 'p10') }]
    expect(checkUnmanagedSeatsAutopiloted(a)).toEqual([])
  })
})

describe('F335 — the harness never does the server\'s job again (source pins over season-runner.ts)', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/leagues/sim/season-runner.ts'), 'utf8')
  // Comments are stripped first: the docblocks QUOTE the struck fallback.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('`seedLineups` has NO commissioner fallback — an unmanaged seat is never set by the harness', () => {
    expect(code).not.toMatch(/\?\?\s*commishClient/)
    // …and the ONE `setLineup` call the runner makes carries no `reason`
    // (the commissioner arm's argument): it is a manager's own door only.
    const calls = code.match(/await setLineup\([\s\S]*?\n {6}\}\)/g) ?? []
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('setLineup(manager,')
    expect(calls[0]).not.toContain('reason')
  })

  it('invariant 6 is never exempted for an overridden cell (D345 pre-refuses it)', () => {
    const invariants = readFileSync(path.resolve(process.cwd(), 'src/lib/leagues/sim/season-invariants.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(invariants).not.toMatch(/is_overridden/)
    expect(invariants).not.toMatch(/overridden\s*\)\s*continue/)
  })
})

describe('held weeks are CLASSIFIED, never counted (Q37 is OPEN)', () => {
  it('a week left in its correction window is named with a lawful explanation', () => {
    const a = greenAudit()
    a.weeks = [{ week: 1, status: 'correction_window' }]
    const held = classifyHeldWeeks(a)
    expect(held).toHaveLength(1)
    expect(held[0]!.explanation).toContain('correction window')
    // and it is NOT a sweep failure
    expect(sweepSeasonAudit(a).some((f) => f.invariant === 'zero-worker-errors')).toBe(false)
  })

  it('a week outside the driven range is not classified at all', () => {
    const a = greenAudit()
    a.weeks = [
      { week: 1, status: 'final' },
      { week: 9, status: 'upcoming' },
    ]
    expect(classifyHeldWeeks(a)).toEqual([])
  })
})

describe('the adapter onto the draft sweep\'s printer', () => {
  it('a league-wide failure prints its league id where the draft sweep prints a draft id', () => {
    expect(
      toInvariantFailure({
        invariant: 'exclusivity',
        leagueLabel: 'L',
        leagueId: 'league-1',
        week: null,
        detail: 'd',
      }).draftId,
    ).toBe('league-1')
  })

  it('a week-scoped failure carries the week into the printed id', () => {
    expect(
      toInvariantFailure({
        invariant: 'lineup-legality',
        leagueLabel: 'L',
        leagueId: 'league-1',
        week: 3,
        detail: 'd',
      }).draftId,
    ).toBe('league-1 week 3')
  })
})

/**
 * R920 — what invariant 7 counts, at the bracket boundary. Migration 119's
 * own doctrine: "a team with no row this week (an eliminated playoff seat, a
 * bye-less week — `no_matchup_row`) is NAMED, not an error" (119:110-112,
 * D319(3)). Measured live: a `--weeks 15` run over a 14-week-regular-season
 * 16-team league with a 6-seat bracket produced 26 of these and reddened the
 * run on a chain behaving exactly to §7.3.8.
 */
describe('7 — the door\'s no_matchup_row skip is a NOTE in a bracket week and a FINDING inside the regular season', () => {
  const LAST_REGULAR = new Map([['807d95c6-ccd4-4d48-a65b-cc746a50504c', 14]])
  const TEAM = '24fe23e6-981d-482e-8a86-234056340c72'
  const LEAGUE = '807d95c6-ccd4-4d48-a65b-cc746a50504c'

  it('the batch-level form, past the regular season, is a named lawful note', () => {
    const note = lawfulBracketSkip(`[${LEAGUE} wk 15] door skipped ${TEAM}: no_matchup_row`, LAST_REGULAR)
    expect(note).toContain('bracket week')
    expect(note).toContain('119:110-112')
  })

  it('the per-league form, past the regular season, is the same note', () => {
    expect(lawfulBracketSkip(`door skipped ${TEAM}: no_matchup_row`, LAST_REGULAR, { leagueId: LEAGUE, week: 15 })).toContain(
      'bracket week',
    )
  })

  // THE NEGATIVE CONTROL — the detection this classification must not cost.
  it('the LAST regular-season week is NOT a bracket week — a missing matchup row there stays a finding', () => {
    expect(lawfulBracketSkip(`[${LEAGUE} wk 14] door skipped ${TEAM}: no_matchup_row`, LAST_REGULAR)).toBeNull()
    expect(lawfulBracketSkip(`door skipped ${TEAM}: no_matchup_row`, LAST_REGULAR, { leagueId: LEAGUE, week: 14 })).toBeNull()
  })

  it('a league the run does not know is never excused (an unknown id cannot be past anything)', () => {
    expect(lawfulBracketSkip(`[${TEAM} wk 15] door skipped ${TEAM}: no_matchup_row`, LAST_REGULAR)).toBeNull()
  })

  it('no other worker problem is swallowed by this arm', () => {
    expect(lawfulBracketSkip(`door skipped ${TEAM}: overridden`, LAST_REGULAR, { leagueId: LEAGUE, week: 15 })).toBeNull()
    expect(lawfulBracketSkip(`[${LEAGUE} wk 15] unreadable slot_map`, LAST_REGULAR)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// chooseStarterSlots — F286's residual necessary condition (D328).
//
// The full slate removes §7.3.6's `on_bye` arm outright. What survives is the
// DESIGNATION arm (114:596): an OUT/IR/PUP/NFI/Suspended starter is refused in
// a league with `allow_illegal_lineups = false`. These pins are the
// falsifiability for that arm. R927 (#274 review) corrects the number that
// used to sit here: the 400-ROW pool window holds FOURTEEN blocking-status
// players (IR 10, PUP 4); the "five" were those whose ADP VALUE is under 400.
// The load-bearing fact is structural, not probabilistic: the earliest
// blocking-status player sits at ADP rank ~120 while the OFF league drafts at
// most 112 picks (16 x 7), so the designation arm is out of reach by ~8 ranks
// at every configuration the sim runs — see F289, whose discharge is L.D6.3's.
// ---------------------------------------------------------------------------
describe('chooseStarterSlots — the seating a league that POLICES legality will accept', () => {
  const SLOTS = [
    { key: 'qb:0', eligible: ['QB'] },
    { key: 'rb:0', eligible: ['RB'] },
    { key: 'wr:0', eligible: ['WR'] },
  ]
  const active = (id: string, position: string) => ({ id, position, status: 'Active' })

  it('greedy first fit by eligibility, in the caller\'s order (best ADP first)', () => {
    const seat = chooseStarterSlots([active('q1', 'QB'), active('r1', 'RB'), active('w1', 'WR')], SLOTS, {
      allowIllegalLineups: true,
    })
    expect(seat.slotMap).toEqual({ 'qb:0': 'q1', 'rb:0': 'r1', 'wr:0': 'w1' })
    expect(seat.emptySlots).toEqual([])
    expect(seat.benchedForLegality).toEqual([])
  })

  it('an OUT-designated player is PASSED OVER where §7.3.6 is enforced, and the next man takes the slot', () => {
    const roster = [{ id: 'r1', position: 'RB', status: 'IR' }, active('r2', 'RB')]
    const seat = chooseStarterSlots(roster, SLOTS, { allowIllegalLineups: false })
    expect(seat.slotMap['rb:0']).toBe('r2')
    expect(seat.benchedForLegality).toEqual(['r1 (IR)'])
  })

  it('with NO legal alternative the slot is left EMPTY and NAMED — lawful (114:585-588), never a 409', () => {
    const seat = chooseStarterSlots([{ id: 'r1', position: 'RB', status: 'PUP' }], SLOTS, {
      allowIllegalLineups: false,
    })
    expect(seat.slotMap).toEqual({})
    expect(seat.emptySlots).toEqual(['qb:0', 'rb:0', 'wr:0'])
    expect(seat.benchedForLegality).toEqual(['r1 (PUP)'])
  })

  // THE NEGATIVE CONTROL — the coverage this skip must not cost. A league that
  // ALLOWS illegal lineups exercises that arm by seating the OUT player.
  it('where illegal lineups are ALLOWED nothing is passed over — that arm is coverage, not a bug', () => {
    const roster = [{ id: 'r1', position: 'RB', status: 'IR' }, active('r2', 'RB')]
    const seat = chooseStarterSlots(roster, SLOTS, { allowIllegalLineups: true })
    expect(seat.slotMap['rb:0']).toBe('r1')
    expect(seat.benchedForLegality).toEqual([])
  })

  it('every blocking designation is passed over, and ONLY those five', () => {
    for (const status of ['out', 'IR', 'pup', 'NFI', 'Sus', 'suspended']) {
      const seat = chooseStarterSlots([{ id: 'x', position: 'QB', status }], SLOTS, { allowIllegalLineups: false })
      expect(seat.slotMap, status).toEqual({})
    }
    // Doubtful and Questionable are NOT blocked by 114:596 — starting them is
    // lawful even where legality is enforced.
    for (const status of ['Doubtful', 'Questionable', 'Active', null]) {
      const seat = chooseStarterSlots([{ id: 'x', position: 'QB', status }], SLOTS, { allowIllegalLineups: false })
      expect(seat.slotMap, String(status)).toEqual({ 'qb:0': 'x' })
    }
  })

  it('simDesignation is 112:337-353\'s bridge, case- and space-insensitive', () => {
    expect(simDesignation('  OuT ')).toBe('OUT')
    expect(simDesignation('sus')).toBe('Suspended')
    expect(simDesignation('doubtful')).toBe('Doubtful')
    expect(simDesignation('Active')).toBeNull()
    expect(simDesignation(null)).toBeNull()
    expect([...BLOCKING_DESIGNATIONS].sort()).toEqual(['IR', 'NFI', 'OUT', 'PUP', 'Suspended'])
  })

  it('a player with no eligible slot is simply unseated (not an error, not a legality skip)', () => {
    const seat = chooseStarterSlots([active('k1', 'K')], SLOTS, { allowIllegalLineups: false })
    expect(seat.slotMap).toEqual({})
    expect(seat.benchedForLegality).toEqual([])
    expect(seat.emptySlots).toEqual(['qb:0', 'rb:0', 'wr:0'])
  })
})

// ---------------------------------------------------------------------------
// classifyReconcileAlert — the four lawful-classification arms that keep a
// reconcile ALERT out of `report.problems`. Pinned here (F287(d) named the
// gap; the `starter_final_game_no_line` wording moved with D328's full slate,
// so the arms are pinned rather than left falsifiable only through a run).
// ---------------------------------------------------------------------------
describe('classifyReconcileAlert — what a run may lawfully NOT count as a problem', () => {
  const ctx = {
    drivenWeeks: new Set([1, 2]),
    rosteredPlayers: new Set(['p-rostered']),
    postponedGameIds: new Set(['simseason-2099-w01-BUF@KC']),
  }

  it('starter_final_game_no_line is Q42 territory and is always classified — counted, never asserted on', () => {
    const note = classifyReconcileAlert({ kind: 'starter_final_game_no_line', message: 'x' }, ctx)
    expect(note).toContain('18 players')
    expect(note).toContain('Q42 OPEN')
  })

  it('no_game_rows is lawful ONLY for a week the run never drove', () => {
    expect(classifyReconcileAlert({ kind: 'no_game_rows', week: 5, message: 'x' }, ctx)).toContain('not driven')
    // THE NEGATIVE CONTROL: a DRIVEN week with no games is a real finding.
    expect(classifyReconcileAlert({ kind: 'no_game_rows', week: 2, message: 'x' }, ctx)).toBeNull()
    expect(classifyReconcileAlert({ kind: 'no_game_rows', week: null, message: 'x' }, ctx)).toBeNull()
  })

  it('stuck_queue is lawful ONLY for a player no run league rosters (D313(2)\'s scope seam)', () => {
    expect(classifyReconcileAlert({ kind: 'stuck_queue', player_id: 'p-other', message: 'x' }, ctx)).toContain(
      'no run league rosters',
    )
    // THE NEGATIVE CONTROL: a stuck row for a ROSTERED player is real.
    expect(classifyReconcileAlert({ kind: 'stuck_queue', player_id: 'p-rostered', message: 'x' }, ctx)).toBeNull()
    expect(classifyReconcileAlert({ kind: 'stuck_queue', player_id: null, message: 'x' }, ctx)).toBeNull()
  })

  it('game_not_final_late is lawful ONLY for a game the scenario declared postponed (E43)', () => {
    expect(
      classifyReconcileAlert(
        { kind: 'game_not_final_late', message: 'simseason-2099-w01-BUF@KC never went final' },
        ctx,
      ),
    ).toContain('postponed out of the week')
    // THE NEGATIVE CONTROL: any OTHER game that never went final is real.
    expect(
      classifyReconcileAlert({ kind: 'game_not_final_late', message: 'simseason-2099-w01-DAL@PHI stalled' }, ctx),
    ).toBeNull()
  })

  it('every other kind is UNCLASSIFIED — the default must stay a finding', () => {
    for (const kind of ['drift', 'twr_mirror_drift', 'pool_mirror_broken', 'something_new']) {
      expect(classifyReconcileAlert({ kind, message: 'x' }, ctx), kind).toBeNull()
    }
  })
})
