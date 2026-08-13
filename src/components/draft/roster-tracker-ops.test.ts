import { describe, expect, it } from 'vitest'

import type { StartingSlot } from '@/lib/leagues/settings/league-settings'

import { buildRosterTracker, normalizePosition } from './roster-tracker-ops'

/**
 * roster-tracker-ops pins (M2 task L.B3.2) — the display read-model of 068's
 * documented greedy (banner steps a–c), pinned against the same behaviors
 * pgTAP 022 pins server-side: first-eligible-slot-in-array-order assignment,
 * flex absorption, DEF→DST normalization, bench spill, the needs counter.
 */

function slot(key: string, eligible: string[], count: number): StartingSlot {
  return { key, label: key.toUpperCase(), eligible: eligible as StartingSlot['eligible'], count }
}

// A §7.3.2-shaped mini roster: 1 QB · 2 RB · 1 FLEX(RB/WR/TE) · 1 DST.
const SLOTS = [
  slot('qb', ['QB'], 1),
  slot('rb', ['RB'], 2),
  slot('flex', ['RB', 'WR', 'TE'], 1),
  slot('dst', ['DST'], 1),
]

function pick(pick_number: number, player_id: string, is_undone: boolean | null = false) {
  return { pick_number, player_id, is_undone }
}

describe('buildRosterTracker — 068 greedy steps a–c as a display read-model', () => {
  it('assigns in pick order to the FIRST eligible unfilled slot; overflow position lands on bench (step b)', () => {
    const model = buildRosterTracker({
      picks: [pick(1, 'rb1'), pick(5, 'rb2'), pick(9, 'rb3'), pick(13, 'rb4'), pick(17, 'qb1')],
      positionById: new Map([
        ['rb1', 'RB'],
        ['rb2', 'RB'],
        ['rb3', 'RB'],
        ['rb4', 'RB'],
        ['qb1', 'QB'],
      ]),
      startingSlots: SLOTS,
      bench: 3,
    })
    // RB seats fill first (array order), the 3rd RB falls into FLEX, the
    // 4th onto the bench — the greedy's documented order-dependence.
    expect(model.slots.find((s) => s.key === 'rb')?.playerIds).toEqual(['rb1', 'rb2'])
    expect(model.slots.find((s) => s.key === 'flex')?.playerIds).toEqual(['rb3'])
    expect(model.benchIds).toEqual(['rb4'])
    expect(model.slots.find((s) => s.key === 'qb')?.playerIds).toEqual(['qb1'])
    // Step c: only the DST seat is still unfilled.
    expect(model.unfilled).toBe(1)
  })

  it("normalizes 'DEF' → 'DST' (step a) so a defense fills the DST seat", () => {
    expect(normalizePosition('DEF')).toBe('DST')
    expect(normalizePosition('QB')).toBe('QB')
    const model = buildRosterTracker({
      picks: [pick(1, 'def1')],
      positionById: new Map([['def1', 'DEF']]), // players-table spelling
      startingSlots: SLOTS,
      bench: 3,
    })
    expect(model.slots.find((s) => s.key === 'dst')?.playerIds).toEqual(['def1'])
    expect(model.benchIds).toEqual([])
  })

  it('undone picks vanish from the tracker (E4); assignment re-derives from the survivors', () => {
    const model = buildRosterTracker({
      picks: [pick(1, 'rb1', true), pick(5, 'rb2')],
      positionById: new Map([
        ['rb1', 'RB'],
        ['rb2', 'RB'],
      ]),
      startingSlots: SLOTS,
      bench: 3,
    })
    expect(model.slots.find((s) => s.key === 'rb')?.playerIds).toEqual(['rb2'])
    expect(model.unfilled).toBe(4)
  })

  it('a pick whose identity has not loaded is PENDING — counted, never guessed into a slot', () => {
    const model = buildRosterTracker({
      picks: [pick(1, 'mystery'), pick(5, 'qb1')],
      positionById: new Map([['qb1', 'QB']]),
      startingSlots: SLOTS,
      bench: 3,
    })
    expect(model.pendingIds).toEqual(['mystery'])
    expect(model.slots.find((s) => s.key === 'qb')?.playerIds).toEqual(['qb1'])
    expect(model.unfilled).toBe(4)
  })

  it('empty roster: every seat open, needs = Σ counts', () => {
    const model = buildRosterTracker({
      picks: [],
      positionById: new Map(),
      startingSlots: SLOTS,
      bench: 6,
    })
    expect(model.unfilled).toBe(5)
    expect(model.benchCount).toBe(6)
  })
})
