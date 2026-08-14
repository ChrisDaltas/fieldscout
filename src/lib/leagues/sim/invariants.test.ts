/**
 * Invariant-sweep pins — L.B6.1 item 3 (each invariant falsifiable ALONE,
 * and every failure NAMES its draft). The stuck-clock pins carry the D102
 * grace-aware boundaries as stored literals (±1ms at each threshold).
 */
import { describe, expect, it } from 'vitest'

import {
  checkBoardComplete,
  checkBoardOrder,
  checkDraftComplete,
  checkLeagueInSeason,
  checkNoDuplicatePlayers,
  checkNoWorkerErrors,
  checkPerTeamCounts,
  checkPickNumbersContiguous,
  checkRostersMatchPicks,
  duplicateQueueRanks,
  EPSILON_MS,
  isStuckClock,
  sweepAudit,
  TICK_MS,
  type AuditPick,
  type DraftAudit,
} from './invariants'

/** A compact, fully-consistent 4-team × 2-round snake audit (the pure fns
 *  take any size; v1's 8..16 constraint is the ENGINE's, enforced at the
 *  wire — these pins exercise the math). Order [a,b,c,d]: round 1 forward,
 *  round 2 reversed. */
function greenAudit(): DraftAudit {
  const order = ['a', 'b', 'c', 'd']
  const teams = [...order, ...[...order].reverse()]
  const picks: AuditPick[] = teams.map((team_id, i) => ({
    pick_number: i + 1,
    round: i < 4 ? 1 : 2,
    team_id,
    player_id: `pl${i + 1}`,
  }))
  return {
    leagueLabel: 'SIM L.B6.1 #01',
    draftId: 'draft-1',
    teamCount: 4,
    totalRounds: 2,
    draftOrder: order,
    snakeReversal: false,
    picks,
    rosters: picks.map((p) => ({ team_id: p.team_id, player_id: p.player_id })),
    leagueStatus: 'in_season',
    draftStatus: 'complete',
    workerErrors: [],
  }
}

describe('the sweep — green on a consistent draft, and every failure names it', () => {
  it('a fully consistent audit sweeps clean', () => {
    expect(sweepAudit(greenAudit())).toEqual([])
  })

  it('board-complete: a suppressed final pick names the draft (the item-3 shape)', () => {
    const a = greenAudit()
    const broken = { ...a, picks: a.picks.slice(0, -1), rosters: a.rosters.slice(0, -1) }
    const failures = checkBoardComplete(broken)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({
      invariant: 'board-complete',
      draftId: 'draft-1',
      leagueLabel: 'SIM L.B6.1 #01',
    })
    expect(failures[0]!.detail).toBe('7 live picks, expected 4 teams × 2 rounds = 8')
  })

  it('zero-duplicate-picks: the same player twice is named with both pick numbers', () => {
    const a = greenAudit()
    const picks = a.picks.map((p) => (p.pick_number === 8 ? { ...p, player_id: 'pl1' } : p))
    const failures = checkNoDuplicatePlayers({ ...a, picks })
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('pl1 at picks 1 and 8')
  })

  it('pick-numbers-contiguous: a dropped turn (E14 substance) is named', () => {
    const a = greenAudit()
    const picks = a.picks.filter((p) => p.pick_number !== 3)
    // Board-complete also fires; the contiguity check names the exact slot.
    const failures = checkPickNumbersContiguous({ ...a, picks })
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('slot 3 holds pick_number 4')
  })

  it('per-team-counts: a team over/under its rounds is named', () => {
    const a = greenAudit()
    const picks = a.picks.map((p) => (p.pick_number === 8 ? { ...p, team_id: 'b' } : p))
    const failures = checkPerTeamCounts({ ...a, picks })
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('team a has 1 picks, expected 2')
    expect(failures[0]!.detail).toContain('team b has 3 picks, expected 2')
  })

  it('board-order: a pick on the wrong seat fails against the D90 mirror (snake)', () => {
    const a = greenAudit()
    // Swap picks 5 and 8's teams (d↔a in round 2) — order math must object.
    const picks = a.picks.map((p) =>
      p.pick_number === 5 ? { ...p, team_id: 'a' } : p.pick_number === 8 ? { ...p, team_id: 'd' } : p,
    )
    const failures = checkBoardOrder({ ...a, picks })
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain('pick 5: team a, order math says d')
  })

  it('board-order honors 3RR (snake_reversal: round 3 repeats round 2 direction)', () => {
    const order = ['a', 'b', 'c', 'd']
    // 3RR expansion: r1 forward, r2 reversed, r3 reversed again.
    const teams = [...order, ...[...order].reverse(), ...[...order].reverse()]
    const picks: AuditPick[] = teams.map((team_id, i) => ({
      pick_number: i + 1,
      round: Math.floor(i / 4) + 1,
      team_id,
      player_id: `pl${i + 1}`,
    }))
    const audit: DraftAudit = {
      ...greenAudit(),
      totalRounds: 3,
      snakeReversal: true,
      picks,
      rosters: picks.map((p) => ({ team_id: p.team_id, player_id: p.player_id })),
    }
    expect(checkBoardOrder(audit)).toEqual([])
    // The PLAIN-snake reading of the same board must fail (discriminator).
    expect(checkBoardOrder({ ...audit, snakeReversal: false })).not.toEqual([])
  })

  it('rosters-consistent: a missing and an alien roster row are both named', () => {
    const a = greenAudit()
    expect(checkRostersMatchPicks({ ...a, rosters: a.rosters.slice(1) })[0]!.detail).toContain(
      'picked but not rostered: a:pl1',
    )
    expect(
      checkRostersMatchPicks({
        ...a,
        rosters: [...a.rosters, { team_id: 'a', player_id: 'ghost' }],
      })[0]!.detail,
    ).toContain('rostered but never picked: a:ghost')
  })

  it('status invariants: draft complete + league in_season', () => {
    const a = greenAudit()
    expect(checkDraftComplete({ ...a, draftStatus: 'live' })[0]!.detail).toContain("'live'")
    expect(checkLeagueInSeason({ ...a, leagueStatus: 'drafting' })[0]!.detail).toContain(
      "'drafting'",
    )
  })

  it('zero-worker-errors: any recorded tick failure fails the draft', () => {
    const a = greenAudit()
    const failures = checkNoWorkerErrors({ ...a, workerErrors: ['tick pick_failures: [...]'] })
    expect(failures).toHaveLength(1)
    expect(failures[0]!.invariant).toBe('zero-worker-errors')
  })
})

describe('stuck-clock (grace-aware — D102) — boundary literals', () => {
  const deadlineMs = 1_000_000
  const grace = 30_000

  it('a human seat is stuck only PAST deadline + grace + tick + ε', () => {
    const base = { deadlineMs, allowanceMs: grace, lastProgressMs: 0 }
    const threshold = deadlineMs + grace + TICK_MS + EPSILON_MS // 1,038,000
    expect(isStuckClock({ ...base, nowMs: threshold })).toBe(false)
    expect(isStuckClock({ ...base, nowMs: threshold + 1 })).toBe(true)
  })

  it('autodraft/no-user seats: deadline + tick + ε (no grace)', () => {
    const base = { deadlineMs, allowanceMs: 0, lastProgressMs: 0 }
    const threshold = deadlineMs + TICK_MS + EPSILON_MS // 1,008,000
    expect(isStuckClock({ ...base, nowMs: threshold })).toBe(false)
    expect(isStuckClock({ ...base, nowMs: threshold + 1 })).toBe(true)
  })

  it('a harness REWIND is not a stuck clock: overdue-ness measures from the later of deadline+allowance and our own last action', () => {
    // Deadline rewound deep past; our rewind+tick just ran at 2,000,000.
    const base = { deadlineMs: 0, allowanceMs: 0, lastProgressMs: 2_000_000 }
    const threshold = 2_000_000 + TICK_MS + EPSILON_MS
    expect(isStuckClock({ ...base, nowMs: threshold })).toBe(false)
    expect(isStuckClock({ ...base, nowMs: threshold + 1 })).toBe(true)
  })

  it('an untimed clock (NULL deadline) is never stuck', () => {
    expect(
      isStuckClock({ deadlineMs: null, allowanceMs: 0, lastProgressMs: 0, nowMs: 9e9 }),
    ).toBe(false)
  })
})

describe('duplicateQueueRanks — the F54 signature detector', () => {
  it('duplicate ranks are reported sorted; a dense queue reports none', () => {
    expect(duplicateQueueRanks([{ rank: 1 }, { rank: 1 }, { rank: 2 }])).toEqual([1])
    expect(duplicateQueueRanks([{ rank: 3 }, { rank: 1 }, { rank: 3 }, { rank: 1 }])).toEqual([
      1, 3,
    ])
    expect(duplicateQueueRanks([{ rank: 1 }, { rank: 2 }, { rank: 3 }])).toEqual([])
    expect(duplicateQueueRanks([])).toEqual([])
  })
})
