/**
 * my-team-ops.test.ts — League UX batch 3 (PROGRESS D478): the stat columns
 * and Customize, OPRK, the Lineup check, the projected total, the Move
 * menu's entries, and the AUTOSAVE queue (success · refusal restores ·
 * serialized · a locked player is never sent).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { lockedPlayerIds, planMove, slotInstances, type Placement, type SlotRow } from './lineup-editor-ops'
import {
  DEFAULT_STAT_COLUMNS,
  LineupAutosaver,
  WEEK_TABS_SAVING_REASON,
  weekTabsLockedReason,
  lineupChecks,
  moveOptions,
  moveToastCopy,
  opponentOf,
  oprkOf,
  oprkTone,
  parseStoredColumns,
  pointsCell,
  projectedTotal,
  readColumns,
  STAT_COLUMNS_STORAGE_KEY,
  statusTag,
  toggleColumn,
  writeColumns,
  type AutosaveStatus,
  type QueuedMove,
} from './my-team-ops'

function player(over: Partial<RosterPlayer> & Pick<RosterPlayer, 'player_id' | 'position' | 'full_name'>): RosterPlayer {
  return {
    nfl_team: 'KC',
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

const settings = defaultsForTeamCount(8).roster_settings
const slots = slotInstances(settings)

describe('stat columns + Customize', () => {
  it('defaults to Opp, OPRK, Proj; Proj can never be turned off; order is canonical', () => {
    expect(DEFAULT_STAT_COLUMNS).toEqual(['opp', 'oprk', 'proj'])
    expect(toggleColumn(['opp', 'oprk', 'proj'], 'proj')).toEqual(['opp', 'oprk', 'proj'])
    expect(toggleColumn(['opp', 'proj'], 'adp')).toEqual(['opp', 'adp', 'proj'])
    expect(toggleColumn(['opp', 'adp', 'proj'], 'opp')).toEqual(['adp', 'proj'])
    expect(toggleColumn(['proj'], 'points')).toEqual(['points', 'proj'])
  })
  it('a stored choice round-trips; junk and a missing Proj fall back safely', () => {
    expect(parseStoredColumns(null)).toEqual(['opp', 'oprk', 'proj'])
    expect(parseStoredColumns('not json')).toEqual(['opp', 'oprk', 'proj'])
    expect(parseStoredColumns('{"a":1}')).toEqual(['opp', 'oprk', 'proj'])
    expect(parseStoredColumns('["snap","bogus"]')).toEqual(['snap', 'proj'])
  })
  it('localStorage is read and written through try/catch — a throwing store never breaks the page', () => {
    const mem = new Map<string, string>()
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
    writeColumns(store, ['adp', 'proj'])
    expect(mem.get(STAT_COLUMNS_STORAGE_KEY)).toBe('["adp","proj"]')
    expect(readColumns(store)).toEqual(['adp', 'proj'])
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceeded')
      },
    }
    expect(readColumns(throwing)).toEqual(['opp', 'oprk', 'proj'])
    expect(() => writeColumns(throwing, ['proj'])).not.toThrow()
    expect(readColumns(null)).toEqual(['opp', 'oprk', 'proj'])
  })
})

describe('cells', () => {
  const games = [{ home_team: 'KC', away_team: 'BUF', kickoff_at: '2099-09-13T17:00:00.000Z' }]
  it('Opp: home is "vs", away is "@"; a team with no game is on bye; no games on record is unknown', () => {
    expect(opponentOf('KC', games)).toEqual({ kind: 'game', label: 'vs BUF', opp: 'BUF', kickoff_at: games[0].kickoff_at })
    expect(opponentOf('BUF', games)).toMatchObject({ label: '@ KC', opp: 'KC' })
    expect(opponentOf('DAL', games)).toEqual({ kind: 'bye' })
    expect(opponentOf('KC', [])).toEqual({ kind: 'unknown' })
    expect(opponentOf(null, games)).toEqual({ kind: 'unknown' })
  })
  it('OPRK flips 033’s "1 = most generous" to the platform reading (1 = toughest) within the position; absent = null', () => {
    const splits = [
      { defense: 'BUF', position: 'WR', rank: 1 }, // most generous → OPRK 4 of 4
      { defense: 'NYJ', position: 'WR', rank: 4 }, // stingiest → OPRK 1
      { defense: 'MIA', position: 'WR', rank: 2 },
      { defense: 'NE', position: 'WR', rank: 3 },
      { defense: 'BUF', position: 'DEF', rank: 7 },
      { defense: 'LV', position: 'WR', rank: 0 }, // unranked
    ]
    expect(oprkOf(splits, 'BUF', 'WR')).toBe(4)
    expect(oprkOf(splits, 'NYJ', 'WR')).toBe(1)
    expect(oprkOf(splits, 'BUF', 'DST')).toBe(1)
    expect(oprkOf(splits, 'LV', 'WR')).toBeNull()
    expect(oprkOf(splits, 'BUF', 'TE')).toBeNull()
    expect(oprkOf(splits, null, 'WR')).toBeNull()
  })
  it('OPRK chip tone — the boundaries are exact: 8 tough, 9 neutral, 23 neutral, 24 soft', () => {
    expect(oprkTone(1)).toBe('negative')
    expect(oprkTone(8)).toBe('negative')
    expect(oprkTone(9)).toBe('caution')
    expect(oprkTone(23)).toBe('caution')
    expect(oprkTone(24)).toBe('positive')
    expect(oprkTone(32)).toBe('positive')
  })
  it('status tags and the Points cell ("—" before kickoff and on bye; pending is marked)', () => {
    expect(statusTag('Questionable')).toBe('Q')
    expect(statusTag('Doubtful')).toBe('D')
    expect(statusTag('Out')).toBe('O')
    expect(statusTag('IR')).toBe('IR')
    expect(statusTag('Active')).toBeNull()
    expect(pointsCell(null)).toEqual({ text: '—', pending: false })
    expect(pointsCell({ phase: 'up_next', points: 0, pending: [] })).toEqual({ text: '—', pending: false })
    expect(pointsCell({ phase: 'bye', points: 0, pending: [] })).toEqual({ text: '—', pending: false })
    expect(pointsCell({ phase: 'done', points: 12.34, pending: [] })).toEqual({ text: '12.3', pending: false })
    expect(pointsCell({ phase: 'now_playing', points: 3, pending: ['rec'] })).toEqual({ text: '3.0', pending: true })
  })
})

describe('projected total + the Lineup check', () => {
  const qb = player({ player_id: 'qb', position: 'QB', full_name: 'Q One' })
  const rb = player({ player_id: 'rb', position: 'RB', full_name: 'R Hurt', status: 'Questionable' })
  const wr = player({ player_id: 'wr', position: 'WR', full_name: 'W Bye', bye_week: 3 })
  const rows = (filled: RosterPlayer[]): SlotRow[] =>
    slots.filter((s) => s.kind === 'start').map((slot, i) => ({ slot, player: filled[i] ?? null }))

  it('projected total sums what exists and COUNTS what is missing (never a silent 0)', () => {
    const proj = (id: string) => ({ qb: 20.5, rb: 10.25 })[id] ?? null
    expect(projectedTotal(['qb', 'rb', null], proj)).toEqual({ total: 30.75, missing: 0 })
    expect(projectedTotal(['qb', 'wr'], proj)).toEqual({ total: 20.5, missing: 1 })
  })

  it('every check from real data: starters set, injury risk naming them, bye naming them, Proj vs opponent', () => {
    const starters = rows([qb, rb, wr])
    const checks = lineupChecks({
      starters,
      week: 3,
      games: [],
      mine: { total: 100, missing: 0 },
      opponent: { name: 'Rivals', projected: { total: 104.5, missing: 0 } },
    })
    const by = Object.fromEntries(checks.map((c) => [c.id, c]))
    expect(by.starters).toMatchObject({ value: `3 / ${starters.length}`, tone: 'caution', note: 'Empty slots score zero — fill them before kickoff.' })
    expect(by.injury).toMatchObject({ value: '1 flagged', tone: 'caution' })
    expect(by.injury.note).toContain('R Hurt')
    expect(by.bye).toMatchObject({ value: '1', tone: 'caution' })
    expect(by.bye.note).toContain('W Bye')
    expect(by.proj).toMatchObject({ value: '−4.5', tone: 'caution', note: '100.0 vs Rivals’s 104.5 projected' })
  })

  it('a full, healthy lineup reads positive; a game-less team in a week with games is on bye', () => {
    const full = slots.filter((s) => s.kind === 'start').map((slot, i) => ({ slot, player: player({ player_id: `p${i}`, position: 'QB', full_name: `P${i}` }) }))
    const checks = lineupChecks({ starters: full, week: 1, games: [{ home_team: 'KC', away_team: 'BUF', kickoff_at: 'x' }], mine: { total: 110, missing: 0 }, opponent: { name: 'R', projected: { total: 100, missing: 0 } } })
    const by = Object.fromEntries(checks.map((c) => [c.id, c]))
    expect(by.starters.tone).toBe('positive')
    expect(by.injury).toMatchObject({ value: 'None', tone: 'positive' })
    expect(by.bye).toMatchObject({ value: 'None', tone: 'positive' })
    expect(by.proj).toMatchObject({ value: '+10.0', tone: 'positive' })
    const away = full.map((r, i) => (i === 0 ? { ...r, player: { ...r.player, nfl_team: 'DAL' } } : r))
    expect(lineupChecks({ starters: away, week: 1, games: [{ home_team: 'KC', away_team: 'BUF', kickoff_at: 'x' }], mine: null, opponent: null }).find((c) => c.id === 'bye')?.value).toBe('1')
  })

  it('Proj vs opponent is NOT shown unless both sides are complete (a partial sum is no comparison)', () => {
    const base = { starters: rows([qb]), week: 1, games: [] }
    expect(lineupChecks({ ...base, mine: null, opponent: null }).map((c) => c.id)).toEqual(['starters', 'injury', 'bye'])
    expect(lineupChecks({ ...base, mine: { total: 1, missing: 1 }, opponent: { name: 'R', projected: { total: 1, missing: 0 } } }).some((c) => c.id === 'proj')).toBe(false)
    expect(lineupChecks({ ...base, mine: { total: 1, missing: 0 }, opponent: { name: 'R', projected: { total: 1, missing: 2 } } }).some((c) => c.id === 'proj')).toBe(false)
  })
})

describe('the Move menu’s entries', () => {
  const qb = player({ player_id: 'qb', position: 'QB', full_name: 'Q One' })
  const wr1 = player({ player_id: 'wr1', position: 'WR', full_name: 'W One' })
  const wr2 = player({ player_id: 'wr2', position: 'WR', full_name: 'W Two', game_lock: { state: 'locked_release_unrecorded', until: null } })
  const wrOut = player({ player_id: 'wr3', position: 'WR', full_name: 'W Out', status: 'Out' })
  const players = new Map([qb, wr1, wr2, wrOut].map((p) => [p.player_id, p]))
  const roster = [...players.values()]
  const placement: Placement = { 'qb:0': 'qb', 'wr:0': 'wr2' }
  const locked = lockedPlayerIds(roster, true)

  it('lists every eligible seat with its occupant, "To bench — leave X empty", and IR only for an eligible player', () => {
    const fromBench = moveOptions({ player: wr1, placement, slots, players, locked, lockExempt: false })
    const labels = fromBench.map((o) => o.label)
    expect(labels).toContain('WR — W Two')
    expect(labels.some((l) => /^WR \d — Empty$/.test(l))).toBe(true)
    expect(labels.some((l) => l.startsWith('IR'))).toBe(false)
    expect(labels.some((l) => l.startsWith('QB'))).toBe(false)
    // The seat a LOCKED player holds is shown but closed, with the reason.
    expect(fromBench.find((o) => o.label === 'WR — W Two')?.disabledReason).toContain('locked')
    expect(moveOptions({ player: wr1, placement, slots, players, locked, lockExempt: true }).find((o) => o.label === 'WR — W Two')?.disabledReason).toBeNull()
    const seated = moveOptions({ player: qb, placement, slots, players, locked, lockExempt: false })
    expect(seated.at(-1)).toEqual({ target: { kind: 'bench' }, label: 'To bench — leave QB empty', disabledReason: null })
    expect(moveOptions({ player: wrOut, placement, slots, players, locked, lockExempt: false }).some((o) => o.label.startsWith('IR'))).toBe(true)
  })

  it('two empty seats sharing a label read apart — "RB 1 — Empty" / "RB 2 — Empty"', () => {
    const rb = player({ player_id: 'rbx', position: 'RB', full_name: 'R X' })
    const labels = moveOptions({ player: rb, placement: {}, slots, players: new Map([[rb.player_id, rb]]), locked: new Set(), lockExempt: false }).map((o) => o.label)
    expect(labels).toContain('RB 1 — Empty')
    expect(labels).toContain('RB 2 — Empty')
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('toasts in plain words', () => {
    expect(moveToastCopy({ player: 'A', target: { kind: 'bench' }, targetLabel: null, displaced: null })).toBe('A moved to the bench.')
    expect(moveToastCopy({ player: 'A', target: { kind: 'slot', key: 'wr:0' }, targetLabel: 'WR', displaced: 'B' })).toBe('A is in at WR; B moved out.')
    expect(moveToastCopy({ player: 'A', target: { kind: 'slot', key: 'wr:0' }, targetLabel: 'WR', displaced: null })).toBe('A is in at WR.')
  })
})

// ---------------------------------------------------------------------------
// AUTOSAVE
// ---------------------------------------------------------------------------

describe('AUTOSAVE — LineupAutosaver (Chris 2026-10-03: no Save button)', () => {
  const qb = player({ player_id: 'qb', position: 'QB', full_name: 'Q One' })
  const qb2 = player({ player_id: 'qb2', position: 'QB', full_name: 'Q Two' })
  const rb = player({ player_id: 'rb', position: 'RB', full_name: 'R One' })
  const rbLocked = player({ player_id: 'rbL', position: 'RB', full_name: 'R Locked', game_lock: { state: 'locked_release_unrecorded', until: null } })
  const roster = [qb, qb2, rb, rbLocked]
  const players = new Map(roster.map((p) => [p.player_id, p]))
  const ctx = { slots, players, locked: lockedPlayerIds(roster, true), currentWeek: 1 }

  type Result = { slot_map: Placement }
  function rig(send: (slotMap: Placement) => Promise<Result>, base: Placement = { 'qb:0': 'qb' }) {
    const log = { statuses: [] as AutosaveStatus[], saved: [] as Placement[], refused: [] as string[], planRefused: [] as string[], sent: [] as Placement[] }
    const saver = new LineupAutosaver<Result>(base, {
      plan: (b, m: QueuedMove) => planMove(b, m.playerId, m.target, ctx),
      send: (slotMap) => {
        log.sent.push(slotMap)
        return send(slotMap)
      },
      canonical: (r) => r.slot_map,
      onStatus: (s) => log.statuses.push(s),
      onSaved: (r) => log.saved.push(r.slot_map),
      onRefused: (m) => log.refused.push(m),
      onPlanRefused: (m) => log.planRefused.push(m),
    })
    return { saver, log }
  }
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('success: the WHOLE map is sent once, "saving" → "saved", and the base becomes the SERVER’s canonical map (not the submitted one)', async () => {
    const { saver, log } = rig(async () => ({ slot_map: { 'qb:0': 'qb2', 'rb:0': 'rb' } }))
    saver.enqueue({ playerId: 'qb2', target: { kind: 'slot', key: 'qb:0' } })
    expect(saver.saving).toBe(true)
    // Never optimistic: until the server answers, the base is unchanged.
    expect(saver.placement).toEqual({ 'qb:0': 'qb' })
    await flush()
    expect(log.sent).toEqual([{ 'qb:0': 'qb2' }])
    expect(saver.placement).toEqual({ 'qb:0': 'qb2', 'rb:0': 'rb' })
    expect(log.statuses).toEqual(['saving', 'saved'])
  })

  it('refusal: the server’s words come through verbatim, the queue is dropped, and the arrangement stays the server’s (restored)', async () => {
    const words = "R One's game kicked off at 2099-09-13T17:00:00+00:00 — a player whose game has started cannot enter or move slots"
    let reject!: (e: Error) => void
    const { saver, log } = rig(() => new Promise((_, r) => (reject = r)))
    saver.enqueue({ playerId: 'rb', target: { kind: 'slot', key: 'rb:0' } })
    saver.enqueue({ playerId: 'qb2', target: { kind: 'slot', key: 'qb:0' } })
    reject(new Error(words))
    await flush()
    expect(log.refused).toEqual([words])
    expect(log.sent).toHaveLength(1)
    expect(saver.placement).toEqual({ 'qb:0': 'qb' })
    expect(log.statuses.at(-1)).toBe('error')
    expect(saver.saving).toBe(false)
  })

  it('serialized: one save in flight; the next waits and is planned against the FIRST save’s answer', async () => {
    const resolvers: Array<(r: Result) => void> = []
    const { saver, log } = rig(() => new Promise((r) => resolvers.push(r)))
    saver.enqueue({ playerId: 'rb', target: { kind: 'slot', key: 'rb:0' } })
    saver.enqueue({ playerId: 'qb2', target: { kind: 'slot', key: 'qb:0' } })
    await flush()
    expect(log.sent).toHaveLength(1)
    // The server answers the first save with a canonical map of its own.
    resolvers[0]({ slot_map: { 'qb:0': 'qb', 'rb:0': 'rb' } })
    await flush()
    expect(log.sent).toHaveLength(2)
    expect(log.sent[1]).toEqual({ 'qb:0': 'qb2', 'rb:0': 'rb' })
    resolvers[1]({ slot_map: { 'qb:0': 'qb2', 'rb:0': 'rb' } })
    await flush()
    expect(saver.placement).toEqual({ 'qb:0': 'qb2', 'rb:0': 'rb' })
    expect(log.statuses.at(-1)).toBe('saved')
  })

  it('a refetch underneath never overwrites a save in flight', async () => {
    let resolve!: (r: Result) => void
    const { saver } = rig(() => new Promise((r) => (resolve = r)))
    saver.enqueue({ playerId: 'rb', target: { kind: 'slot', key: 'rb:0' } })
    saver.setBase({})
    expect(saver.placement).toEqual({ 'qb:0': 'qb' })
    resolve({ slot_map: { 'qb:0': 'qb', 'rb:0': 'rb' } })
    await flush()
    saver.setBase({ 'rb:0': 'rb' })
    expect(saver.placement).toEqual({ 'rb:0': 'rb' })
  })

  it('R1466: a trailing no-op after a save still ends in a terminal status (never stuck on "saving")', async () => {
    let resolve!: (r: Result) => void
    const { saver, log } = rig(() => new Promise((r) => (resolve = r)))
    saver.enqueue({ playerId: 'rb', target: { kind: 'slot', key: 'rb:0' } })
    // Queued behind the save — and a no-op once the save lands (rb is already there).
    saver.enqueue({ playerId: 'rb', target: { kind: 'slot', key: 'rb:0' } })
    resolve({ slot_map: { 'qb:0': 'qb', 'rb:0': 'rb' } })
    await flush()
    expect(log.sent).toHaveLength(1)
    expect(log.statuses.at(-1)).toBe('saved')
    expect(saver.saving).toBe(false)
  })

  it('R1466: a trailing client-refused move after a save ends in a terminal status', async () => {
    let resolve!: (r: Result) => void
    const { saver, log } = rig(() => new Promise((r) => (resolve = r)), { 'qb:0': 'qb', 'rb:0': 'rbL' })
    saver.enqueue({ playerId: 'qb2', target: { kind: 'slot', key: 'qb:0' } })
    saver.enqueue({ playerId: 'rbL', target: { kind: 'bench' } })
    resolve({ slot_map: { 'qb:0': 'qb2', 'rb:0': 'rbL' } })
    await flush()
    expect(log.planRefused).toHaveLength(1)
    expect(log.statuses.at(-1)).toBe('saved')
  })

  it('a LOCKED player is never sent — the plan refuses him and nothing reaches the server', async () => {
    const { saver, log } = rig(async (m) => ({ slot_map: m }), { 'rb:0': 'rbL' })
    saver.enqueue({ playerId: 'rbL', target: { kind: 'bench' } })
    saver.enqueue({ playerId: 'rb', target: { kind: 'slot', key: 'rb:0' } })
    await flush()
    expect(log.sent).toEqual([])
    expect(log.planRefused).toHaveLength(2)
    expect(log.planRefused[0]).toContain('R Locked is locked')
  })
})

describe('R1467 — a week switch never sends another week’s lineup', () => {
  it('the week tabs are held, with a reason, only while a save is in flight', () => {
    expect(weekTabsLockedReason(true)).toBe(WEEK_TABS_SAVING_REASON)
    expect(weekTabsLockedReason(false)).toBeNull()
  })
  it('the editor (and so its saver) remounts per team-week, and the tabs sit in a fieldset disabled by that reason', () => {
    const page = readFileSync(path.join(__dirname, 'team-page.tsx'), 'utf8')
    expect(page).toMatch(/<LineupEditor\s+(?:\/\/[^\n]*\n\s*)?key=\{`\$\{teamId\}:\$\{week\}`\}/)
    const editor = readFileSync(path.join(__dirname, 'lineup-editor.tsx'), 'utf8')
    expect(editor).toContain('disabled={weekLockedReason !== null}')
    expect(editor).toContain('weekTabsLockedReason(saving)')
  })
})
