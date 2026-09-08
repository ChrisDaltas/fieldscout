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
import { describe, expect, it } from 'vitest'

import {
  checkExclusivity,
  checkFinalCellsImmutable,
  checkLineupLegality,
  checkNoWorkerErrors,
  checkPointsForOnce,
  checkPoolMirror,
  checkStandingsRecompute,
  classifyHeldWeeks,
  SEASON_INVARIANTS,
  startersOfMap,
  sweepSeasonAudit,
  toInvariantFailure,
  type SeasonAudit,
} from './season-invariants'
import { lawfulBracketSkip } from './season-runner'

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
    finalCells: [{ week: 1, matchup_id: 'm1', at_final: 'home=21.50 away=18.25', at_end: 'home=21.50 away=18.25' }],
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

  it('the seven invariant names are the row\'s seven, in the row\'s order', () => {
    expect(SEASON_INVARIANTS).toEqual([
      'exclusivity',
      'lineup-legality',
      'standings-recompute',
      'pool-roster-mirror',
      'pf-once-per-week',
      'final-cell-immutable',
      'zero-worker-errors',
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

describe('7 — zero unhandled worker errors (§23.2)', () => {
  it('every worker error becomes one failure carrying league context', () => {
    const a = greenAudit()
    a.workerErrors = ['league X week 1 FAILED — snapshot_missing', 'ack_missed lease_lost=1']
    const failures = checkNoWorkerErrors(a)
    expect(failures).toHaveLength(2)
    expect(failures.every((f) => f.leagueId === 'league-1')).toBe(true)
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
