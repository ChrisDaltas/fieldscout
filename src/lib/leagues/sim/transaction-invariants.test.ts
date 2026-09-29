/**
 * transaction-invariants.test.ts — M5 L.D3.8: each transaction invariant is
 * falsifiable ALONE. One green fixture (a small league that ran a claim, a
 * trade with a FAAB leg, a reversal, a commissioner edit and the Ghost); every
 * `it()` breaks exactly one field and asserts the named invariant reds — and
 * that the populations the runner requires to be > 0 are counted, never
 * inferred. The live-chain twin is `sim season --transact --probe <id>`.
 */
import { describe, expect, it } from 'vitest'

import {
  checkClaimPrivacy,
  checkFaabLedger,
  checkGhostTakeover,
  checkTransactionExclusivity,
  claimPrivacyPopulation,
  exclusivityPopulation,
  faabLedgerPopulation,
  poolPopulation,
  sweepTransactionAudit,
  type TransactionAudit,
} from './transaction-invariants'

/**
 * Teams A, B, C, G (the Ghost's franchise). Budget $100.
 *   - A won a claim for p9 at $7, dropping p1          → A $93
 *   - G won a claim for p8 at $10, dropping p5         → G $90
 *   - A traded p2 + $2 to B for p3 (complete)          → A $91, B $102
 *   - B traded p4 + $3 to C for p6, then REVERSED      → B, C net 0
 *   - the commissioner set C to $105                   → C $105
 *   - B lost a claim for p9 ($5); C's claim was invalid
 */
function greenAudit(): TransactionAudit {
  return {
    leagueLabel: 'L',
    leagueId: 'lg',
    faabBudget: 100,
    balances: [
      { team_id: 'A', faab_balance: 91 },
      { team_id: 'B', faab_balance: 102 },
      { team_id: 'C', faab_balance: 105 },
      { team_id: 'G', faab_balance: 90 },
    ],
    rosters: [
      { team_id: 'A', player_id: 'p9' },
      { team_id: 'A', player_id: 'p3' },
      { team_id: 'B', player_id: 'p2' },
      { team_id: 'B', player_id: 'p4' },
      { team_id: 'C', player_id: 'p6' },
      { team_id: 'G', player_id: 'p8' },
    ],
    txns: [
      { id: 't1', type: 'waiver_claim', status: 'complete', initiator_team_id: 'A', payload: { faab_bid: 7, faab_before: 100, faab_after: 93 } },
      { id: 't2', type: 'waiver_claim', status: 'complete', initiator_team_id: 'G', payload: { faab_bid: 10, faab_before: 100, faab_after: 90 } },
      { id: 't3', type: 'trade', status: 'complete', initiator_team_id: 'A', payload: { faab: [{ amount: 2, from_team_id: 'A', to_team_id: 'B' }] } },
      { id: 't4', type: 'trade', status: 'complete', initiator_team_id: 'B', payload: { faab: [{ amount: 3, from_team_id: 'B', to_team_id: 'C' }] } },
      {
        id: 't5',
        type: 'commissioner_move',
        status: 'complete',
        initiator_team_id: null,
        payload: { kind: 'trade_reversal', reversal: { faab: [{ amount: 3, from_team_id: 'C', to_team_id: 'B' }] } },
      },
      { id: 't6', type: 'add_drop', status: 'complete', initiator_team_id: 'C', payload: { add_player_id: 'p7' } },
    ],
    commishFaabEdits: [{ target_id: 'C', before: 100, after: 105 }],
    expectedHolder: new Map<string, string | null>([
      ['p9', 'A'],
      ['p1', null],
      ['p8', 'G'],
      ['p5', null],
      ['p2', 'B'],
      ['p3', 'A'],
      ['p4', 'B'],
      ['p6', 'C'],
    ]),
    claims: [
      { id: 'c1', team_id: 'A', status: 'won' },
      { id: 'c2', team_id: 'B', status: 'lost' },
      { id: 'c3', team_id: 'C', status: 'invalid' },
      { id: 'c4', team_id: 'G', status: 'won' },
    ],
    views: [
      { viewer: 'a', teamId: 'A', commissioner: false, former: false, visible: [{ id: 'c1', team_id: 'A', status: 'won' }] },
      { viewer: 'b', teamId: 'B', commissioner: false, former: false, visible: [{ id: 'c2', team_id: 'B', status: 'lost' }] },
      {
        viewer: 'commish',
        teamId: 'C',
        commissioner: true,
        former: false,
        visible: [
          { id: 'c1', team_id: 'A', status: 'won' },
          { id: 'c2', team_id: 'B', status: 'lost' },
          { id: 'c3', team_id: 'C', status: 'invalid' },
          { id: 'c4', team_id: 'G', status: 'won' },
        ],
      },
      { viewer: 'successor', teamId: 'G', commissioner: false, former: false, visible: [{ id: 'c4', team_id: 'G', status: 'won' }] },
      { viewer: 'ghost', teamId: null, commissioner: false, former: true, visible: [] },
    ],
    pool: [
      { player_id: 'p9', state: 'rostered' },
      { player_id: 'p1', state: 'on_waivers' },
    ],
    ghost: {
      teamId: 'G',
      ghostUserId: 'u-ghost',
      successorUserId: 'u-succ',
      spentBeforeVacate: 10,
      balanceAtVacate: 90,
      balanceAfterTakeover: 90,
      budget: 100,
      ghostVisibleClaims: 0,
      ghostSubmitStatus: 403,
      orphanWeeks: [
        { week: 1, autopilotedByServer: true },
        { week: 2, autopilotedByServer: false },
      ],
      stints: [
        { user_id: 'u-ghost', started_at: '2026-09-28T10:00:00Z', ended_at: '2026-09-28T10:05:00Z' },
        { user_id: 'u-succ', started_at: '2026-09-28T10:06:00Z', ended_at: null },
      ],
      incomplete: null,
    },
  }
}

describe('the green fixture', () => {
  it('passes every transaction invariant, with every population > 0', () => {
    const a = greenAudit()
    expect(sweepTransactionAudit(a)).toEqual([])
    expect(exclusivityPopulation(a)).toBe(8)
    expect(faabLedgerPopulation(a)).toEqual({
      teams: 4,
      byKind: { won_claim: 2, trade_leg: 4, reversal_leg: 2, commissioner_edit: 1 },
    })
    expect(poolPopulation(a)).toEqual({ rostered: 1, on_waivers: 1 })
    expect(claimPrivacyPopulation(a)).toEqual({ hiddenPairs: 13, ownVisible: 3, commissionerVisible: 4, formerViewers: 1, lost: 1 })
  })
})

describe('T1 transaction-exclusivity', () => {
  it('a moved player on a roster the acknowledged transactions did not put him on reds (a roster write with no receipt)', () => {
    const a = greenAudit()
    a.rosters = a.rosters.map((r) => (r.player_id === 'p3' ? { ...r, team_id: 'C' } : r))
    const f = checkTransactionExclusivity(a)
    expect(f).toHaveLength(1)
    expect(f[0]!.invariant).toBe('transaction-exclusivity')
    expect(f[0]!.detail).toContain('put him on team A')
    expect(f[0]!.detail).toContain('C')
  })

  it('a DROPPED player still on a roster reds', () => {
    const a = greenAudit()
    a.rosters = [...a.rosters, { team_id: 'B', player_id: 'p1' }]
    expect(checkTransactionExclusivity(a).map((x) => x.detail)).toEqual([
      'player p1 was DROPPED by an acknowledged transaction but team B rosters him — a roster write no receipt explains',
    ])
  })

  it('a player on TWO rosters reds (the UNIQUE index restated — declared, not decorative)', () => {
    const a = greenAudit()
    a.rosters = [...a.rosters, { team_id: 'C', player_id: 'p9' }]
    const f = checkTransactionExclusivity(a)
    expect(f.some((x) => x.detail === 'player p9 is rostered by 2 teams (A, C)')).toBe(true)
  })

  it('an acknowledged add that never landed reds (on NO roster)', () => {
    const a = greenAudit()
    a.rosters = a.rosters.filter((r) => r.player_id !== 'p8')
    expect(checkTransactionExclusivity(a)[0]!.detail).toContain('NO roster')
  })
})

describe('T2 faab-ledger (TD2)', () => {
  it('a balance that moved with NO receipt reds, naming the arithmetic', () => {
    const a = greenAudit()
    a.balances = a.balances.map((b) => (b.team_id === 'B' ? { ...b, faab_balance: 101 } : b))
    const f = checkFaabLedger(a)
    expect(f).toHaveLength(1)
    expect(f[0]!.invariant).toBe('faab-ledger')
    expect(f[0]!.detail).toBe(
      'team B: budget $100 + $2 of receipted movement = $102, but the seat holds $101 — a balance changed with no receipt behind it (TD2)',
    )
  })

  it('a won claim whose receipt debits a different amount than its bid reds', () => {
    const a = greenAudit()
    a.txns = a.txns.map((t) => (t.id === 't1' ? { ...t, payload: { faab_bid: 6, faab_before: 100, faab_after: 93 } } : t))
    expect(checkFaabLedger(a).map((x) => x.detail)).toContain('waiver_claim receipt t1: faab_before 100 − faab_after 93 ≠ faab_bid 6')
  })

  it('a REVERSAL whose legs were never returned reds on both teams (the receipt is the ledger)', () => {
    const a = greenAudit()
    a.txns = a.txns.filter((t) => t.id !== 't5')
    expect(checkFaabLedger(a)).toHaveLength(2)
  })

  it('the commissioner term counts (drop the receipt and C is $5 unexplained)', () => {
    const a = greenAudit()
    a.commishFaabEdits = []
    expect(checkFaabLedger(a)[0]!.detail).toContain('team C')
  })

  it('a NEGATIVE balance reds even if the arithmetic agrees', () => {
    const a: TransactionAudit = { ...greenAudit(), faabBudget: 0, balances: [{ team_id: 'A', faab_balance: -1 }], txns: [], commishFaabEdits: [] }
    a.commishFaabEdits = [{ target_id: 'A', before: 0, after: -1 }]
    expect(checkFaabLedger(a).map((x) => x.detail)).toEqual(['team A holds a NEGATIVE balance ($-1)'])
  })

  it('a non-complete receipt moves nothing (a claim row that failed is not money)', () => {
    const a = greenAudit()
    a.txns = [...a.txns, { id: 't9', type: 'waiver_claim', status: 'failed', initiator_team_id: 'A', payload: { faab_bid: 50, faab_before: 91, faab_after: 41 } }]
    expect(checkFaabLedger(a)).toEqual([])
  })
})

describe('T4 claim-privacy (TD3 / E13)', () => {
  it("a non-owner who reads another team's claim reds — the RLS-bypass probe's shape", () => {
    const a = greenAudit()
    a.views = a.views.map((v) => (v.viewer === 'a' ? { ...v, visible: [...v.visible, { id: 'c2', team_id: 'B', status: 'lost' }] } : v))
    const f = checkClaimPrivacy(a)
    expect(f).toHaveLength(1)
    expect(f[0]!.invariant).toBe('claim-privacy')
    expect(f[0]!.detail).toContain("team B's lost claim c2")
  })

  it('the POSITIVE control: an owner who cannot see his own claim reds (an RLS that hides everything is not privacy)', () => {
    const a = greenAudit()
    a.views = a.views.map((v) => (v.viewer === 'b' ? { ...v, visible: [] } : v))
    expect(checkClaimPrivacy(a)[0]!.detail).toContain('his OWN lost claim c2')
  })

  it('a commissioner who cannot see a claim reds (TD4: he sees every claim)', () => {
    const a = greenAudit()
    a.views = a.views.map((v) => (v.viewer === 'commish' ? { ...v, visible: v.visible.slice(1) } : v))
    expect(checkClaimPrivacy(a)[0]!.detail).toContain('(commissioner)')
  })

  it('a FORMER member (the Ghost) who still reads a claim reds — access revocation', () => {
    const a = greenAudit()
    a.views = a.views.map((v) => (v.viewer === 'ghost' ? { ...v, visible: [{ id: 'c4', team_id: 'G', status: 'won' }] } : v))
    expect(checkClaimPrivacy(a)[0]!.detail).toContain('no longer in the league')
  })
})

describe('G ghost-takeover (F211)', () => {
  it('FAAB re-seeded on the seat claim reds (C72 — the exact bug L.D2.6 fixed)', () => {
    const a = greenAudit()
    a.ghost = { ...a.ghost!, balanceAfterTakeover: 100 }
    expect(checkGhostTakeover(a).map((x) => x.detail)).toEqual([
      "team G's FAAB was NOT carried through vacate → seat claim: $90 at the vacate, $100 after the takeover (L.D2.6 / C72)",
    ])
  })

  it('a ghost with nothing spent reds (the carry arm would carry nothing)', () => {
    const a = greenAudit()
    a.ghost = { ...a.ghost!, spentBeforeVacate: 0, balanceAtVacate: 100, balanceAfterTakeover: 100 }
    expect(checkGhostTakeover(a)[0]!.detail).toContain('spent $0')
  })

  it('a ghost whose claim still went through after the vacate reds', () => {
    const a = greenAudit()
    a.ghost = { ...a.ghost!, ghostSubmitStatus: 200 }
    expect(checkGhostTakeover(a)[0]!.detail).toContain('answered 200')
  })

  it('an orphan week the server did not seat reds', () => {
    const a = greenAudit()
    a.ghost = { ...a.ghost!, orphanWeeks: [{ week: 1, autopilotedByServer: false }] }
    expect(checkGhostTakeover(a)[0]!.detail).toContain('no tick named it in autopiloted[]')
  })

  it('no orphan week at all reds (the arm never ran)', () => {
    const a = greenAudit()
    a.ghost = { ...a.ghost!, orphanWeeks: [] }
    expect(checkGhostTakeover(a)[0]!.detail).toContain('spent no driven week unmanaged')
  })

  it('a stint history with two open stints reds', () => {
    const a = greenAudit()
    a.ghost = { ...a.ghost!, stints: a.ghost!.stints.map((s) => ({ ...s, ended_at: null })) }
    expect(checkGhostTakeover(a).some((x) => x.detail.includes('no CLOSED stint for the ghost'))).toBe(true)
  })

  it('an incomplete lifecycle reds by name', () => {
    const a = greenAudit()
    a.ghost = { ...a.ghost!, incomplete: 'the seat claim never ran' }
    expect(checkGhostTakeover(a)[0]!.detail).toContain('the seat claim never ran')
  })
})
