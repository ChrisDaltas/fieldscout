/**
 * lineup-editor-ops.test.ts — L.D5.1's pure pins (spec §11.2/§12.13/§16.5.4;
 * PROGRESS D293/D315(5)/F241(d)/R779).
 *
 * The one that matters: **the lock is read from the FETCHED evaluation
 * (`game_lock`), never from a stored instant** — the moved-kickoff fixture
 * below carries a lineup row whose `locked_at` / `starters[].kickoff_at`
 * still say "kicked off" (written before the kickoff moved, E42) while the
 * pool view the tick refreshed says `unlocked`; the editor must show NO
 * lock. The DoD probe (derive the lock from `locked_at`) reds exactly that
 * cell.
 */
import { describe, expect, it } from 'vitest'

import type { LineupStarter } from '@/lib/leagues/api/lineup-service'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import {
  LOCK_POLL_MS,
  LOCK_RELEASE_UNRECORDED_COPY,
  LOCK_UNTIL_COPY,
  NO_LOCK_RECORD_COPY,
  PAST_WEEK_COPY,
  WEEK_OVER_COPY,
  buildEditorModel,
  currentWeekOf,
  defaultLineupWeek,
  designationOf,
  irStintChip,
  lockBadgeFor,
  lockPollInterval,
  lockedPlayerIds,
  locksAtCopy,
  placementFromStored,
  placementsEqual,
  planMove,
  saveOutcomeCopy,
  slotInstances,
  starterFlagChips,
  starterHint,
  startersByKey,
  weekEditability,
  type Placement,
} from './lineup-editor-ops'

const roster = defaultsForTeamCount(8).roster_settings

function player(over: Partial<RosterPlayer> & Pick<RosterPlayer, 'player_id' | 'position'>): RosterPlayer {
  return {
    full_name: over.player_id,
    nfl_team: 'XXX',
    status: 'Active',
    bye_week: null,
    slot_key: 'bn',
    acquisition_type: null,
    acquisition_cost: null,
    ir_placed_week: null,
    ir_lock_until_week: null,
    acquired_at: null,
    pool_state: 'rostered',
    game_lock: { state: 'unlocked', until: null },
    ...over,
  }
}

const qb = player({ player_id: 'qb1', position: 'QB', full_name: 'QB One' })
const rbA = player({ player_id: 'rbA', position: 'RB', full_name: 'RB Locked' })
const rbB = player({ player_id: 'rbB', position: 'RB', full_name: 'RB Open' })
const wrA = player({ player_id: 'wrA', position: 'WR' })
const te = player({ player_id: 'te1', position: 'TE', full_name: 'TE One' })
const dst = player({ player_id: 'dst1', position: 'DEF', full_name: 'DST One' })
const irGuy = player({ player_id: 'ir1p', position: 'RB', full_name: 'IR Guy', status: 'IR' })
const ALL = [qb, rbA, rbB, wrA, te, dst, irGuy]
const players = new Map(ALL.map((p) => [p.player_id, p]))
const slots = slotInstances(roster)

describe('slot instances (§12.13)', () => {
  it('expands starting slots by count and IR spots as "<key>:0", in catalog order', () => {
    expect(slots.map((s) => s.key)).toEqual([
      'qb:0', 'rb:0', 'rb:1', 'wr:0', 'wr:1', 'wr:2', 'te:0', 'flex:0', 'k:0', 'dst:0', 'ir1:0',
    ])
    expect(slots.find((s) => s.key === 'ir1:0')).toMatchObject({ kind: 'ir', label: 'IR', eligible: [] })
    expect(slots.find((s) => s.key === 'flex:0')?.eligible).toEqual(['WR', 'RB', 'TE'])
  })
})

describe('the editor model', () => {
  it('places starters by key, benches the rest, names an orphaned entry', () => {
    const model = buildEditorModel({ 'qb:0': 'qb1', 'rb:0': 'rbA', 'dst:0': 'dst1', 'wr:0': 'gone' }, ALL, roster)
    expect(model.starters.find((r) => r.slot.key === 'qb:0')?.player?.player_id).toBe('qb1')
    expect(model.starters.find((r) => r.slot.key === 'rb:1')?.player).toBeNull()
    expect(model.bench.map((p) => p.player_id)).toEqual(['rbB', 'wrA', 'te1', 'ir1p'])
    expect(model.orphaned).toEqual([{ key: 'wr:0', player_id: 'gone' }])
    expect(model.ir).toHaveLength(1)
  })

  it('a null stored row is the empty placement (every slot open, the roster on the bench)', () => {
    expect(placementFromStored(null, ALL)).toEqual({})
    expect(placementFromStored({ 'qb:0': 'qb1', 'rb:0': 'dropped' }, ALL)).toEqual({ 'qb:0': 'qb1' })
    expect(placementsEqual({ 'a': '1', 'b': '2' }, { 'b': '2', 'a': '1' })).toBe(true)
    expect(placementsEqual({ 'a': '1' }, { 'a': '2' })).toBe(false)
  })
})

describe('the lock is the FETCHED evaluation (D315(5)/F241(d)) — never a stored instant', () => {
  /** THE MOVED-KICKOFF FIXTURE (E42). The lineup row was written when RB
   *  Locked's game had kicked off: `locked_at` and his `kickoff_at` are a
   *  PAST instant. The kickoff then moved ahead; the tick re-evaluated the
   *  pool and the roster now reads `unlocked`. */
  const movedKickoffLineup = {
    locked_at: '2001-09-09T17:00:00.000Z',
    starters: [
      { slot: 'rb:0', slot_key: 'rb', label: 'RB', player_id: 'rbA', position: 'RB', kickoff_at: '2001-09-09T17:00:00.000Z', flags: [] },
    ] as LineupStarter[],
  }
  const rosterAfterMove = [qb, { ...rbA, game_lock: { state: 'unlocked', until: null } as const }, rbB]

  it('the moved-kickoff fixture shows NO lock — the pool view rules, the stored instant does not', () => {
    // Only the DECISION is pinned here: `lockedPlayerIds` never receives the
    // lineup row, so an assertion on the fixture's `locked_at` /
    // `kickoff_at` cannot fail for the reason this cell names (R828/D267).
    // The DoD probe's carrier is the RENDER pin — `team-page.render.test.ts`
    // "the moved-kickoff fixture…" — where the record DOES enter the editor
    // and must not lock the row. The record's shape is kept in the fixture
    // above as documentation of what the render pin feeds.
    expect(lockedPlayerIds(rosterAfterMove, true).has('rbA')).toBe(false)
    expect(startersByKey(movedKickoffLineup.starters).size).toBe(1)
  })

  it('R822(ii): the CURRENT week polls the rosters at the tick’s cadence; any other week polls nothing', () => {
    expect(LOCK_POLL_MS).toBe(60_000)
    expect(lockPollInterval(3, 3)).toBe(60_000)
    expect(lockPollInterval(2, 3)).toBe(false)
    expect(lockPollInterval(4, 3)).toBe(false)
    expect(lockPollInterval(1, null)).toBe(false)
  })

  it('a locked pool view locks the player — both locked shapes, the copy from the STATE', () => {
    const untilRow = { ...rbA, game_lock: { state: 'locked_until', until: '2099-09-15T04:00:00.000Z' } as const }
    const infRow = { ...rbB, game_lock: { state: 'locked_release_unrecorded', until: null } as const }
    expect(lockedPlayerIds([qb, untilRow, infRow], true)).toEqual(new Set(['rbA', 'rbB']))
    expect(lockBadgeFor(untilRow.game_lock, true)).toEqual({ locked: true, copy: LOCK_UNTIL_COPY, until: '2099-09-15T04:00:00.000Z' })
    expect(lockBadgeFor(infRow.game_lock, true)).toEqual({ locked: true, copy: LOCK_RELEASE_UNRECORDED_COPY, until: null })
    expect(LOCK_RELEASE_UNRECORDED_COPY).toBe("locked — the week's last game has not ended")
  })

  it('the pool view is the CURRENT week’s — a future week carries no lock', () => {
    const untilRow = { ...rbA, game_lock: { state: 'locked_until', until: '2099-09-15T04:00:00.000Z' } as const }
    expect(lockedPlayerIds([untilRow], false).size).toBe(0)
    expect(lockBadgeFor(untilRow.game_lock, false)).toEqual({ locked: false })
  })
})

describe('current week from the ladder (112’s arm, read through league_weeks.status)', () => {
  it('the greatest non-upcoming week; else the first week; null on an empty ladder', () => {
    expect(currentWeekOf([{ week: 1, status: 'final' }, { week: 2, status: 'live' }, { week: 3, status: 'upcoming' }])).toBe(2)
    expect(currentWeekOf([{ week: 1, status: 'final' }, { week: 2, status: 'correction_window' }, { week: 3, status: 'upcoming' }])).toBe(2)
    expect(currentWeekOf([{ week: 1, status: 'upcoming' }, { week: 2, status: 'upcoming' }])).toBe(1)
    expect(currentWeekOf([{ week: 4, status: 'upcoming' }, { week: 5, status: 'upcoming' }])).toBe(4)
    expect(currentWeekOf([])).toBeNull()
    expect(defaultLineupWeek([])).toBe(1)
  })

  it('editability: past = closed by name; correction_window/final = over; else open; unknown without a ladder', () => {
    const ladder = [{ week: 1, status: 'final' }, { week: 2, status: 'correction_window' }, { week: 3, status: 'upcoming' }]
    expect(weekEditability(ladder, 1, 2)).toEqual({ state: 'closed', reason: PAST_WEEK_COPY })
    expect(weekEditability(ladder, 2, 2)).toEqual({ state: 'closed', reason: WEEK_OVER_COPY })
    expect(weekEditability(ladder, 3, 2)).toEqual({ state: 'open' })
    expect(weekEditability([{ week: 1, status: 'live' }], 1, 1)).toEqual({ state: 'open' })
    expect(weekEditability([], 1, null)).toEqual({ state: 'unknown' })
  })
})

describe('moves', () => {
  const base: Placement = { 'qb:0': 'qb1', 'rb:0': 'rbA', 'rb:1': 'rbB', 'te:0': 'te1' }
  const ctx = { slots, players, locked: new Set<string>(), currentWeek: 1 }

  it('bench → an open eligible slot; a filled slot swaps the occupant back when he fits', () => {
    const toFlex = planMove(base, 'wrA', { kind: 'slot', key: 'flex:0' }, ctx)
    expect(toFlex).toMatchObject({ ok: true, displaced: null })
    if (toFlex.ok) expect(toFlex.next['flex:0']).toBe('wrA')
    // rbB (rb:1) into rb:0 — rbA takes rb:1 (an RB slot fits an RB).
    const swap = planMove(base, 'rbB', { kind: 'slot', key: 'rb:0' }, ctx)
    expect(swap).toMatchObject({ ok: true, displaced: 'rbA' })
    if (swap.ok) expect(swap.next).toMatchObject({ 'rb:0': 'rbB', 'rb:1': 'rbA' })
    // te1 (te:0) into flex:0 (open) — te:0 empties.
    const teToFlex = planMove(base, 'te1', { kind: 'slot', key: 'flex:0' }, ctx)
    if (teToFlex.ok) {
      expect(teToFlex.next['flex:0']).toBe('te1')
      expect('te:0' in teToFlex.next).toBe(false)
    }
  })

  it('an occupant who does not fit the mover’s old slot goes to the bench (no illegal client placement)', () => {
    // wrA (bench) → te:0 is refused (WR is not a TE); te1 → rb:0 refused too.
    expect(planMove(base, 'wrA', { kind: 'slot', key: 'te:0' }, ctx)).toMatchObject({ ok: false, reason: 'ineligible' })
    // dst (DEF) fits dst (DST) — the 112 bridge.
    expect(planMove(base, 'dst1', { kind: 'slot', key: 'dst:0' }, ctx)).toMatchObject({ ok: true })
    // te1 at te:0 → flex:0 while rbB sits at flex: rbB cannot take te:0, so he benches.
    const withFlex: Placement = { ...base, 'flex:0': 'rbB' }
    delete withFlex['rb:1']
    const plan = planMove(withFlex, 'te1', { kind: 'slot', key: 'flex:0' }, ctx)
    expect(plan).toMatchObject({ ok: true, displaced: 'rbB' })
    if (plan.ok) {
      expect(plan.next['flex:0']).toBe('te1')
      expect(Object.values(plan.next)).not.toContain('rbB')
    }
  })

  it('slot → bench empties the key; a benched player benching is a noop', () => {
    const plan = planMove(base, 'rbA', { kind: 'bench' }, ctx)
    if (plan.ok) expect('rb:0' in plan.next).toBe(false)
    expect(planMove(base, 'wrA', { kind: 'bench' }, ctx)).toMatchObject({ ok: false, reason: 'noop' })
    expect(planMove(base, 'rbA', { kind: 'slot', key: 'rb:0' }, ctx)).toMatchObject({ ok: false, reason: 'noop' })
  })

  it('a LOCKED player never moves, and a locked occupant’s slot refuses by name (§11.2)', () => {
    const locked = { ...ctx, locked: new Set(['rbA']) }
    const mover = planMove(base, 'rbA', { kind: 'bench' }, locked)
    expect(mover).toMatchObject({ ok: false, reason: 'locked' })
    if (!mover.ok) expect(mover.message).toContain('RB Locked is locked')
    const intoLocked = planMove(base, 'rbB', { kind: 'slot', key: 'rb:0' }, locked)
    expect(intoLocked).toMatchObject({ ok: false, reason: 'locked' })
    if (!intoLocked.ok) expect(intoLocked.message).toContain('RB Locked has kicked off')
  })

  it('IR: placement needs a designation; a Restricted stint refuses leaving until it is served', () => {
    expect(planMove(base, 'rbB', { kind: 'slot', key: 'ir1:0' }, ctx)).toMatchObject({ ok: false, reason: 'ir_designation' })
    expect(planMove(base, 'ir1p', { kind: 'slot', key: 'ir1:0' }, ctx)).toMatchObject({ ok: true })
    const onIr: Placement = { ...base, 'ir1:0': 'ir1p' }
    const stint = new Map(players)
    stint.set('ir1p', { ...irGuy, ir_placed_week: 1, ir_lock_until_week: 5 })
    const early = planMove(onIr, 'ir1p', { kind: 'bench' }, { ...ctx, players: stint, currentWeek: 3 })
    expect(early).toMatchObject({ ok: false, reason: 'ir_stint' })
    if (!early.ok) expect(early.message).toContain('until week 5 (2 weeks left)')
    expect(planMove(onIr, 'ir1p', { kind: 'bench' }, { ...ctx, players: stint, currentWeek: 5 })).toMatchObject({ ok: true })
    expect(irStintChip({ ir_lock_until_week: 5, ir_placed_week: 1, slot_key: 'ir1' }, 3)).toBe('IR · 2 wks left')
    expect(irStintChip({ ir_lock_until_week: 5, ir_placed_week: 1, slot_key: 'ir1' }, 4)).toBe('IR · 1 wk left')
    expect(irStintChip({ ir_lock_until_week: 5, ir_placed_week: 1, slot_key: 'ir1' }, 5)).toBe('IR · stint served')
    expect(irStintChip({ ir_lock_until_week: null, ir_placed_week: 1, slot_key: 'ir1' }, 3)).toBeNull()
  })
})

describe('hints and chips (§7.3.6 allow_illegal_lineups; §16.5.4 flags)', () => {
  it('112’s designation bridge, mirrored', () => {
    expect(designationOf('Out')).toBe('OUT')
    expect(designationOf(' sus ')).toBe('Suspended')
    expect(designationOf('Questionable')).toBeNull()
    expect(designationOf(null)).toBeNull()
  })

  it('bye/OUT hints read the setting: TRUE scores 0 flagged, FALSE will be refused', () => {
    const bye = { bye_week: 7, status: 'Active', full_name: 'X' }
    expect(starterHint(bye, 7, true)).toEqual({ tone: 'caution', text: 'on bye — starts and scores 0 this week' })
    expect(starterHint(bye, 7, false)).toEqual({ tone: 'negative', text: 'on bye — this league blocks it; the save will be refused' })
    expect(starterHint(bye, 8, true)).toBeNull()
    expect(starterHint({ bye_week: null, status: 'Out', full_name: 'X' }, 1, true)?.text).toBe('OUT — starts and scores 0 this week')
    expect(starterFlagChips(['bye', 'ir_ineligible'], true)).toEqual([
      { tone: 'caution', text: 'Bye — scores 0' },
      { tone: 'negative', text: 'IR spot — no longer eligible' },
    ])
    expect(starterFlagChips(['out'], false)[0]?.tone).toBe('negative')
  })

  it('the save outcome names no_changes, re-seats with their moves, and a flagged save (R779)', () => {
    const nameOf = (id: string) => players.get(id)?.full_name ?? id
    const label = (k: string) => slots.find((s) => s.key === k)?.label ?? k
    const flags = { illegal: false, bye: [], out: [], empty: [], ir_ineligible: [] }
    expect(saveOutcomeCopy({ no_changes: true, rearranged: false, moved: [], flags }, nameOf, label)).toBe('Nothing changed — this lineup was already set.')
    expect(saveOutcomeCopy({ no_changes: false, rearranged: true, moved: [{ player_id: 'te1', from: 'wr:2', to: 'te:0' }], flags }, nameOf, label))
      .toBe('Saved — we re-seated one placement so every starter fits: TE One → TE (from WR).')
    expect(saveOutcomeCopy({ no_changes: false, rearranged: false, moved: [], flags: { ...flags, illegal: true } }, nameOf, label))
      .toBe('Saved — flagged: a starter is on bye or out and will score 0.')
    expect(saveOutcomeCopy({ no_changes: false, rearranged: false, moved: [], flags }, nameOf, label)).toBe('Lineup saved.')
  })

  it('locked_at is rendered as "locks from" — a record, never the lock (R779)', () => {
    expect(locksAtCopy(null)).toBe(NO_LOCK_RECORD_COPY)
    expect(locksAtCopy('Sun, Sep 13 · 1:00 PM')).toBe('Locks from Sun, Sep 13 · 1:00 PM')
  })
})
