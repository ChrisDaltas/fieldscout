import type { ListRosterSettings, TeamSlot } from '@/types/database'

// Single source of truth for team-list roster rules, shared by the UI
// (list-detail-view) and the slot API route so eligibility/capacity can't
// drift between client guards and server enforcement.

export const SLOT_ORDER: TeamSlot[] = [
  'QB',
  'RB',
  'WR',
  'FLEX',
  'TE',
  'DST',
  'K',
  'IR',
  'BENCH',
]

/** The active lineup slots (everything except the bench and IR). */
export const STARTING_SLOTS: TeamSlot[] = [
  'QB',
  'RB',
  'WR',
  'FLEX',
  'TE',
  'DST',
  'K',
]

/** Player positions eligible for each slot; null = anyone (IR, Bench). */
export const SLOT_ELIGIBILITY: Record<TeamSlot, readonly string[] | null> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  FLEX: ['RB', 'WR', 'TE'],
  TE: ['TE'],
  DST: ['DEF'],
  K: ['K'],
  IR: null,
  BENCH: null,
}

/** Whether a player of `position` may occupy `slot`. */
export function isSlotEligible(slot: TeamSlot, position: string): boolean {
  const allowed = SLOT_ELIGIBILITY[slot]
  return !allowed || allowed.includes(position)
}

/** Seats available in `slot` for this roster, or null when no roster is set. */
export function slotCapacity(
  roster: ListRosterSettings | null,
  slot: TeamSlot,
): number | null {
  if (!roster) return null
  switch (slot) {
    case 'QB':
      return roster.qb
    case 'RB':
      return roster.rb
    case 'WR':
      return roster.wr
    case 'FLEX':
      return roster.flex
    case 'TE':
      return roster.te
    case 'DST':
      return roster.dst
    case 'K':
      return roster.k
    case 'IR':
      return roster.ir
    case 'BENCH':
      return roster.bench
  }
}

/**
 * Capacity is enforced only on starting slots — the bench and IR are allowed to
 * overflow so a user can never get soft-locked (unable to bench a player
 * because the bench is "full", and unable to start them because the lineup is).
 */
export function isCappedSlot(slot: TeamSlot): boolean {
  return STARTING_SLOTS.includes(slot)
}
