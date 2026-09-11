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
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import type { LineupStarter } from '@/lib/leagues/api/lineup-service'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import {
  COMMISSIONER_ARM_REASON,
  COMMISSIONER_OVERRIDE_REASON,
  formatKickoff,
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
  lineupSaveRequest,
  lockedPlayerIds,
  locksAtCopy,
  overrideExitCopy,
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

  it('F259(a): the 60 s lock poll is RETIRED — the tick’s `league_player_pool` broadcast (119) is the freshness path', () => {
    // Source pin: no poll constant, no interval helper survives in the ops
    // or the page; the room's `league_player_pool` event is what refetches.
    const editorOps = readFileSync(path.resolve(process.cwd(), 'src/components/leagues/lineup-editor-ops.ts'), 'utf8')
    const page = readFileSync(path.resolve(process.cwd(), 'src/components/leagues/team-page.tsx'), 'utf8')
    const rosters = readFileSync(path.resolve(process.cwd(), 'src/hooks/use-rosters.ts'), 'utf8')
    for (const src of [editorOps, page, rosters]) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
      expect(code).not.toMatch(/LOCK_POLL_MS|lockPollInterval|refetchInterval/)
    }
    // …and the freshness path is real: the pool event is on the rosters'
    // invalidating list, which `useRostersLive` derives its handlers from.
    const ops = readFileSync(path.resolve(process.cwd(), 'src/hooks/use-league-channel-ops.ts'), 'utf8')
    expect(ops).toMatch(/ROSTERS_INVALIDATING_EVENTS[\s\S]{0,200}'league_player_pool'/)
    expect(rosters).toContain('rostersEventInvalidates')
  })

  it('F275(d): formatKickoff lives in the ops (viewer-local text; the league zone on hover, pinned through the named zone)', () => {
    const view = formatKickoff('2099-09-13T17:00:00.000Z', 'America/New_York')
    expect(view.local).toMatch(/\S/)
    expect(view.title).toBe('Sun, Sep 13, 2099 · 1:00 PM EDT (league time)')
    expect(formatKickoff('not-an-instant', 'America/New_York')).toEqual({ local: 'not-an-instant', title: null })
    expect(formatKickoff('2099-09-13T17:00:00.000Z', null).title).toBeNull()
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

describe('THE COMMISSIONER OVERRIDE (M6A, §15.4:1695 / PROGRESS §3(g))', () => {
  const base: Placement = { 'qb:0': 'qb1', 'rb:0': 'rbA', 'rb:1': 'rbB', 'te:0': 'te1' }
  const ctx = { slots, players, locked: new Set(['rbA']), currentWeek: 1 }
  const exempt = { ...ctx, lockExempt: true }

  it('lockExempt lifts BOTH lock arms — the mover’s and the occupant’s', () => {
    // Without it, these are the refusals the manager gets (pinned above too).
    expect(planMove(base, 'rbA', { kind: 'bench' }, ctx)).toMatchObject({ ok: false, reason: 'locked' })
    expect(planMove(base, 'rbB', { kind: 'slot', key: 'rb:0' }, ctx)).toMatchObject({ ok: false, reason: 'locked' })
    // With it, both plan. This is what gives `commish_edit_lineup` a door: a
    // client that refuses to BUILD a lock-violating map leaves the lock-exempt
    // server verb unreachable.
    const moved = planMove(base, 'rbA', { kind: 'bench' }, exempt)
    expect(moved).toMatchObject({ ok: true })
    if (moved.ok) expect('rb:0' in moved.next).toBe(false)
    const displaced = planMove(base, 'rbB', { kind: 'slot', key: 'rb:0' }, exempt)
    expect(displaced).toMatchObject({ ok: true, displaced: 'rbA' })
  })

  it('lockExempt lifts TIMING only — position eligibility still refuses, because the override is not a legality waiver', () => {
    expect(planMove(base, 'wrA', { kind: 'slot', key: 'te:0' }, exempt)).toMatchObject({
      ok: false,
      reason: 'ineligible',
    })
    expect(planMove(base, 'rbA', { kind: 'slot', key: 'rb:0' }, exempt)).toMatchObject({ ok: false, reason: 'noop' })
  })

  it('R971 — a save whose SCORE did not follow can NEVER render as "Lineup saved."', () => {
    const nameOf = (id: string) => players.get(id)?.full_name ?? id
    const labelOf = (k: string) => slots.find((s) => s.key === k)?.label ?? k
    const FLAGS_CLEAN = { illegal: false, bye: [], out: [], empty: [], ir_ineligible: [] }
    const base = { no_changes: false, rearranged: false, moved: [], flags: FLAGS_CLEAN }
    // The control: no score consequence at all is the plain sentence.
    expect(saveOutcomeCopy(base, nameOf, labelOf)).toBe('Lineup saved.')
    expect(saveOutcomeCopy({ ...base, score_stale: false, score_stale_reason: null }, nameOf, labelOf)).toBe('Lineup saved.')

    // A final week: the lineup moved and the standings did not. This is the
    // whole purpose of the field, and the previous copy dropped it on the
    // floor — the commissioner was told "Lineup saved." and believed the week
    // was corrected while the matchup cell kept the pre-edit total.
    const final = saveOutcomeCopy({ ...base, score_stale: true, score_stale_reason: 'week_final' }, nameOf, labelOf)
    expect(final).toContain('The SCORE did not follow')
    expect(final).toContain('already final')
    expect(final).not.toBe('Lineup saved.')

    // The other named reason.
    const unstamped = saveOutcomeCopy({ ...base, score_stale: true, score_stale_reason: 'stats_unstamped' }, nameOf, labelOf)
    expect(unstamped).toContain('The SCORE did not follow')
    expect(unstamped).toContain('not timestamped')

    // A reason this build has never seen is still SAID — a future arm must
    // not fall through into plain success.
    const unknown = saveOutcomeCopy({ ...base, score_stale: true, score_stale_reason: 'some_future_arm' }, nameOf, labelOf)
    expect(unknown).toContain('The SCORE did not follow')
    expect(unknown).toContain('some_future_arm')

    // …and it survives the re-seat branch, which used to win the race.
    const reseated = saveOutcomeCopy(
      { no_changes: false, rearranged: true, moved: [{ player_id: 'qb1', from: null, to: 'qb:0' }], flags: FLAGS_CLEAN, score_stale: true, score_stale_reason: 'week_final' },
      nameOf,
      labelOf,
    )
    expect(reseated).toContain('re-seated')
    expect(reseated).toContain('The SCORE did not follow')

    // A NO-OP outranks it: nothing was written, so there is no score to chase.
    expect(saveOutcomeCopy({ ...base, no_changes: true, score_stale: true, score_stale_reason: 'week_final' }, nameOf, labelOf)).toBe(
      'Nothing changed — this lineup was already set.',
    )
  })
})

// ---------------------------------------------------------------------------
// OVERRIDE MODE IS A MODE — the save carries a fixed LABEL and asks for
// nothing (M6A; PROGRESS §3(h) as superseded by Chris 2026-09-11:
// "yeah i think no reason at all is fine … if anyone cares they can ask")
//
// Measured failure this replaces: teams 5 and 6, 2026-09-11 — a `set_lineup`
// refusal at 15:10:47 and 15:12:01, and ZERO `commissioner_actions` rows,
// because Save stayed disabled behind a Reason field the screen never
// mentioned. The property that fixes it is that the request is a pure function
// of the mode: nothing typed, and the second save identical to the first.
// ---------------------------------------------------------------------------

describe('lineupSaveRequest — one action, no input, twice in a row', () => {
  const slotMap: Placement = { 'qb:0': 'p1', 'rb:0': 'p2' }

  it('in override mode it is the AUDITED verb, carrying the fixed label', () => {
    const req = lineupSaveRequest({ overrideMode: true, isCommissionerArm: false, slotMap })
    expect(req.verb).toBe('commish_edit_lineup')
    expect(req.reason).toBe(COMMISSIONER_OVERRIDE_REASON)
    expect(req.slotMap).toEqual(slotMap)
  })

  it('override mode wins on the commissioner’s OWN team too (§3(a) — any action, any team)', () => {
    expect(lineupSaveRequest({ overrideMode: true, isCommissionerArm: true, slotMap }).verb).toBe('commish_edit_lineup')
    expect(lineupSaveRequest({ overrideMode: true, isCommissionerArm: true, slotMap }).reason).toBe(COMMISSIONER_OVERRIDE_REASON)
  })

  it('A SECOND SAVE IN THE SAME SESSION IS THE FIRST ONE AGAIN — no further input exists to give', () => {
    const first = lineupSaveRequest({ overrideMode: true, isCommissionerArm: false, slotMap })
    const second = lineupSaveRequest({ overrideMode: true, isCommissionerArm: false, slotMap })
    expect(second).toEqual(first)
    // …and the mode is not consumed by the save: the caller passes the same
    // `true` and gets the same audited verb, which is what "it stays on until
    // you exit it" means at this seam.
    expect(second.verb).toBe('commish_edit_lineup')
  })

  it('outside the mode the manager’s verb is untouched: no reason as the team’s own manager', () => {
    const req = lineupSaveRequest({ overrideMode: false, isCommissionerArm: false, slotMap })
    expect(req.verb).toBe('set_lineup')
    expect(req.reason).toBeNull()
  })

  it('the commissioner ARM of the manager’s verb is not prompted either — same ruling, its own label', () => {
    const req = lineupSaveRequest({ overrideMode: false, isCommissionerArm: true, slotMap })
    expect(req.verb).toBe('set_lineup')
    expect(req.reason).toBe(COMMISSIONER_ARM_REASON)
  })

  it('both labels satisfy the SERVER’s own predicate — non-blank after 114/123’s btrim, and ≤ 500', () => {
    // 123:665 / 114:316: `NULLIF(btrim(COALESCE(p_reason,''), E' \t\r\n'), '')`
    // then RAISE when it is NULL. A label that trimmed to empty would restore
    // the exact failure this replaces, with the suite still green.
    for (const label of [COMMISSIONER_OVERRIDE_REASON, COMMISSIONER_ARM_REASON]) {
      expect(label.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')).not.toBe('')
      expect(label.length).toBeLessThanOrEqual(500)
    }
    // They are LABELS, not fabricated justifications: no invented narrative
    // about a manager, a game or a message ends up in an audit row.
    for (const label of [COMMISSIONER_OVERRIDE_REASON, COMMISSIONER_ARM_REASON]) {
      expect(label.toLowerCase()).toContain('commissioner')
      expect(label).not.toMatch(/unreachable|away|injur|asked|per his|because/i)
    }
  })
})

describe('overrideExitCopy — leaving the mode never eats the draft, and says what changed', () => {
  it('with unsaved placements it keeps them and names the consequence', () => {
    const copy = overrideExitCopy(true)
    expect(copy).toContain('still here')
    expect(copy).toMatch(/locks apply again/)
    // It must never claim the work was thrown away — that is the bug class.
    expect(copy).not.toMatch(/discard|lost|cleared/i)
  })
  it('with nothing unsaved it just says the mode is off', () => {
    expect(overrideExitCopy(false)).toContain('Override mode off')
    expect(overrideExitCopy(false)).not.toContain('still here')
  })
})

// ---------------------------------------------------------------------------
// R973 — OVERRIDE MODE MUST ACTUALLY UNLOCK THE EDITOR, not just show its door
//
// The fix-round review MEASURED this hole: `lockExempt` was deleted from the
// BenchZone call site — leaving the switch, `planMove` and `SlotSeat` intact —
// and 43 files / 943 tests still passed. In the app that is blocker 2 restored
// exactly: Chris turns on override mode for Team 7, the frame and the banner
// appear, and Darnold's bench row is still frozen, so he cannot select him,
// cannot seat him, and Save never leaves `disabled`.
//
// (The Reason field this comment used to name is gone — Chris, 2026-09-11:
// "yeah i think no reason at all is fine". The counts below are UNCHANGED by
// that work: five hops, one memo, two `frozen` expressions, re-measured.)
//
// `overrideMode` is component-internal state and `renderToStaticMarkup` cannot
// click, so this is a SOURCE pin (the house pattern — see the lock pins above
// and `ui/elevation-rule.test.ts`). It fails if ANY of the four sites the
// editor's own comment names is dropped.
// ---------------------------------------------------------------------------

describe('R973 — the four `lockExempt` sites move together, or the door leads nowhere', () => {
  const editor = readFileSync(
    path.resolve(process.cwd(), 'src/components/leagues/lineup-editor.tsx'),
    'utf8',
  )

  it('derives the exemption from override mode, and from nothing else', () => {
    expect(editor).toMatch(/const lockExempt = overrideMode/)
  })

  it('feeds planMove through the memo (site 1 — both arms)', () => {
    // The `ctx` the plan is computed against must carry it, AND it must be a
    // dependency, or the plan goes stale the moment override mode flips.
    expect(editor).toMatch(/\{ slots, players, locked, currentWeek, lockExempt \}/)
    expect(editor).toMatch(/\[slots, players, locked, currentWeek, lockExempt\]/)
  })

  it('passes it down every one of the FIVE prop hops', () => {
    // :364 slot seat · :387 starter row · :406 bench zone · :635 SlotSeat→
    // PlayerRow · :780 BenchZone→PlayerRow. The last two are the pass-THROUGHS,
    // and they matter as much as the first three: `frozen` is computed in
    // PlayerRow, so a hop dropped there leaves the row inert with the door
    // still open. Measured regression: deleting exactly ONE left every suite
    // green (43 files / 943 tests).
    const passes = editor.match(/lockExempt=\{lockExempt\}/g) ?? []
    expect(passes.length).toBe(5)
  })

  it('is what unfreezes a locked row — in BOTH components that gate interaction', () => {
    // `frozen` drives useDraggable({disabled}), onClick={undefined} and the
    // droppable. If this expression loses `lockExempt`, a locked player stays
    // inert in override mode.
    const frozen = editor.match(/const frozen = locked && !lockExempt/g) ?? []
    expect(frozen.length).toBe(2)
  })

  it('does not let override mode be read-only (the Save path stays reachable)', () => {
    expect(editor).toMatch(/const readOnly = !canEdit \|\| \(editability\.state !== 'open' && !overrideMode\)/)
  })
})
