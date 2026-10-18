/**
 * lineup-check.test.ts — the phone's Lineup check card rows (gap list §3
 * #11): starters set N/N (a kept seat is filled), injured and bye starters
 * NAMED by the desktop check's own rules, and the projected score against
 * this week's opponent — stored projections summed by the Match card's rule
 * (no partial sums), with a plain reason whenever a side reads "–".
 */
import { describe, expect, it } from 'vitest'

import { slotInstances, type SlotRow } from '@/components/leagues/lineup-editor-ops'
import type { RosterPlayer } from '@/lib/leagues/api/rosters-service'
import { defaultsForTeamCount } from '@/lib/leagues/settings/league-settings'

import { lineupCheckRows, type CheckRow, type MobileLineupCheckInput } from './team-ops'

function p(id: string, full_name: string, position: string, extra: Partial<RosterPlayer> = {}): RosterPlayer {
  return {
    player_id: id,
    full_name,
    position,
    nfl_team: 'KC',
    status: 'Active',
    bye_week: null,
    slot_key: null,
    acquisition_type: null,
    acquisition_cost: null,
    ir_placed_week: null,
    ir_lock_until_week: null,
    acquired_at: null,
    pool_state: 'rostered',
    game_lock: { state: 'unlocked', until: null },
    ...extra,
  }
}

const starterSlots = slotInstances(defaultsForTeamCount(8).roster_settings).filter((s) => s.kind === 'start')
/** The starting seats, filled in order by `players` (null = empty). */
const seats = (players: ReadonlyArray<RosterPlayer | null>): SlotRow[] => starterSlots.map((slot, i) => ({ slot, player: players[i] ?? null }))
const full = (): RosterPlayer[] => starterSlots.map((s, i) => p(`p${i}`, `Player ${i}`, s.eligible[0] ?? 'WR'))

const PROJ: Record<string, number> = Object.fromEntries([...starterSlots.map((_, i) => [`p${i}`, 10]), ...starterSlots.map((_, i) => [`o${i}`, 9])])
const GAMES = [{ home_team: 'KC', away_team: 'BUF', kickoff_at: '2099-09-13T17:00:00Z' }]

function rows(over: Partial<MobileLineupCheckInput> = {}): Record<CheckRow['id'], CheckRow> {
  const input: MobileLineupCheckInput = {
    starters: seats(full()),
    kept: new Map(),
    week: 1,
    games: GAMES,
    projOf: (id) => PROJ[id] ?? null,
    projections: 'ready',
    opponent: { kind: 'opponent', name: 'Gridiron Gurus', starterIds: starterSlots.map((_, i) => `o${i}`), error: false },
    ...over,
  }
  return Object.fromEntries(lineupCheckRows(input).map((r) => [r.id, r])) as Record<CheckRow['id'], CheckRow>
}

describe('lineupCheckRows — the phone’s Lineup check', () => {
  const n = starterSlots.length

  it('a full, healthy lineup that projects ahead reads all green', () => {
    const r = rows()
    expect(r.starters).toMatchObject({ label: 'Starters set', value: `${n}/${n}`, sub: null, tone: 'positive' })
    expect(r.injury).toMatchObject({ label: 'Injured', value: 'None', tone: 'positive', players: [] })
    expect(r.bye).toMatchObject({ label: 'On bye', value: 'None', tone: 'positive', players: [] })
    expect(r.proj).toMatchObject({
      label: 'Projected score',
      value: (10 * n).toFixed(2),
      value2: (9 * n).toFixed(2),
      sub: 'vs Gridiron Gurus',
      note: null,
      tone: 'positive',
    })
  })

  it('counts empty seats, and says what an empty seat costs', () => {
    const players = full()
    expect(rows({ starters: seats([...players.slice(0, n - 1), null]) }).starters).toMatchObject({ value: `${n - 1}/${n}`, sub: '1 empty slot scores zero', tone: 'caution' })
    expect(rows({ starters: seats([null, null, ...players.slice(2)]) }).starters).toMatchObject({ value: `${n - 2}/${n}`, sub: '2 empty slots score zero' })
  })

  it('a seat kept for a dropped-after-he-played starter is filled, not empty', () => {
    const players = full()
    const starters = seats([null, ...players.slice(1)])
    expect(rows({ starters, kept: new Map([[starters[0]!.slot.key, 'gone']]) }).starters).toMatchObject({ value: `${n}/${n}`, tone: 'positive' })
  })

  it('a kept starter counts in your projected score — never a whole-looking total missing a seat', () => {
    const players = full()
    const starters = seats([null, ...players.slice(1)])
    const kept = new Map([[starters[0]!.slot.key, 'gone']])
    // His stored projection is summed with the rest…
    expect(rows({ starters, kept, projOf: (id) => (id === 'gone' ? 10 : (PROJ[id] ?? null)) }).proj).toMatchObject({
      value: (10 * n).toFixed(2),
      note: null,
      tone: 'positive',
    })
    // …and without one the side reads "–" and says why, like the Match card.
    expect(rows({ starters, kept }).proj).toMatchObject({ value: '–', value2: (9 * n).toFixed(2), note: 'Not every starter has a projection yet', tone: 'neutral' })
  })

  it('names injured starters with their tag — the desktop check’s rule (Q / D / O / IR and designations)', () => {
    const players = full()
    players[0] = p('p0', 'Bijan Robinson', 'QB', { status: 'Questionable' })
    players[1] = p('p1', 'Puka Nacua', 'RB', { status: 'Out' })
    players[2] = p('p2', 'Rashee Rice', 'RB', { status: 'Suspended' })
    const r = rows({ starters: seats(players) })
    expect(r.injury).toMatchObject({ value: '3', tone: 'caution' })
    expect(r.injury.players).toEqual([
      { id: 'p0', name: 'Bijan Robinson', tag: 'Q' },
      { id: 'p1', name: 'Puka Nacua', tag: 'O' },
      { id: 'p2', name: 'Rashee Rice', tag: 'Suspended' },
    ])
  })

  it('names bye starters — his own bye week, or no game for his team in a week that has games', () => {
    const players = full()
    players[0] = p('p0', 'Josh Allen', 'QB', { bye_week: 1 })
    players[1] = p('p1', 'Saquon Barkley', 'RB', { nfl_team: 'PHI' })
    const r = rows({ starters: seats(players) })
    expect(r.bye).toMatchObject({ value: '2', tone: 'caution' })
    expect(r.bye.players.map((x) => x.name)).toEqual(['Josh Allen', 'Saquon Barkley'])
    // No games read yet: only the stored bye week counts (never "everyone's on bye").
    expect(rows({ starters: seats(players), games: [] }).bye.players.map((x) => x.name)).toEqual(['Josh Allen'])
  })

  it('projected behind reads orange; level reads green', () => {
    expect(rows({ projOf: (id) => (id.startsWith('p') ? 8 : 9) }).proj.tone).toBe('caution')
    expect(rows({ projOf: () => 9 }).proj.tone).toBe('positive')
  })

  it('a partial sum is no comparison — the side reads "–" and says why', () => {
    const missingOne = rows({ projOf: (id) => (id === 'p0' ? null : (PROJ[id] ?? null)) }).proj
    expect(missingOne).toMatchObject({ value: '–', value2: (9 * n).toFixed(2), note: 'Not every starter has a projection yet', tone: 'neutral' })
    expect(rows({ projOf: () => null }).proj).toMatchObject({ value: '–', value2: '–', note: 'No projections for this week yet', tone: 'neutral' })
  })

  it('a failed read says so — never a plausible blank', () => {
    expect(rows({ projections: 'error' }).proj).toMatchObject({ value: '–', value2: '–', note: 'Couldn’t load the projections', tone: 'neutral' })
    expect(rows({ opponent: { kind: 'opponent', name: 'Gridiron Gurus', starterIds: null, error: true } }).proj).toMatchObject({
      value2: '–',
      note: 'Couldn’t load their lineup',
    })
  })

  it('still loading reads "–" with no reason yet', () => {
    expect(rows({ projections: 'pending' }).proj).toMatchObject({ value: '–', value2: '–', note: null })
    expect(rows({ opponent: { kind: 'opponent', name: 'Gridiron Gurus', starterIds: null, error: false } }).proj).toMatchObject({ value2: '–', note: null })
  })

  it('an opponent with no lineup for the week says so', () => {
    expect(rows({ opponent: { kind: 'opponent', name: 'Gridiron Gurus', starterIds: [], error: false } }).proj).toMatchObject({
      value2: '–',
      note: 'Their lineup isn’t set yet',
      tone: 'neutral',
    })
  })

  it('a bye week shows your projection alone; no matchup means no projection row', () => {
    expect(rows({ opponent: { kind: 'bye' } }).proj).toMatchObject({ value: (10 * n).toFixed(2), value2: null, sub: 'No opponent this week', tone: 'neutral' })
    expect(rows({ opponent: null }).proj).toBeUndefined()
  })
})
