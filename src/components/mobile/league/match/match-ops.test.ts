import { describe, expect, it } from 'vitest'

import type { BoxGame } from '@/lib/leagues/api/box-score-service'

import {
  cardProjection,
  gameLine,
  isBareMatchHref,
  lineupProjection,
  metaTeam,
  orderMatchups,
  pointsDisplay,
  resultWord,
  routeMatchupId,
  sidesOf,
  slotChipPos,
  slotChipText,
  spotOf,
  spotToRestore,
  teamAvatarClass,
  teamInitial,
  wrapIndex,
  yetToPlay,
  yetToPlayText,
} from './match-ops'

const game = (over: Partial<BoxGame>): BoxGame => ({
  id: 'g',
  status: 'scheduled',
  home_team: 'GB',
  away_team: 'DET',
  home_score: null,
  away_score: null,
  quarter: null,
  game_clock: null,
  kickoff_at: '2026-10-11T17:00:00Z',
  ...over,
})

describe('mobile Match — routes', () => {
  it('reads the swiped matchup from the path; the bare tab is "your matchup"', () => {
    expect(routeMatchupId('/app/leagues/L1/matchup', 'L1')).toBeNull()
    expect(routeMatchupId('/app/leagues/L1/matchup/m-9', 'L1')).toBe('m-9')
    expect(routeMatchupId('/app/leagues/L2/matchup/m-9', 'L1')).toBeNull()
    expect(routeMatchupId(null, 'L1')).toBeNull()
  })
  it('knows the bare Match link (the dock’s) from a week or matchup link', () => {
    expect(isBareMatchHref('/app/leagues/L1/matchup', 'L1')).toBe(true)
    expect(isBareMatchHref('/app/leagues/L1/matchup?week=3', 'L1')).toBe(false)
    expect(isBareMatchHref('/app/leagues/L1/matchup/m-9', 'L1')).toBe(false)
    expect(isBareMatchHref('/app/leagues/L2/matchup', 'L1')).toBe(false)
    expect(isBareMatchHref(null, 'L1')).toBe(false)
  })
})

describe('mobile Match — where the tab was left (§3.2 item 7)', () => {
  it('remembers a swiped matchup and a non-current week, nothing for the default', () => {
    expect(spotOf({ index: 0, matchupId: 'mine', week: 5, currentWeek: 5 })).toEqual({ matchupId: null, week: null })
    expect(spotOf({ index: 2, matchupId: 'm-x', week: 5, currentWeek: 5 })).toEqual({ matchupId: 'm-x', week: null })
    expect(spotOf({ index: 0, matchupId: 'mine', week: 3, currentWeek: 5 })).toEqual({ matchupId: null, week: 3 })
    expect(spotOf({ index: 1, matchupId: 'm-y', week: 3, currentWeek: 5 })).toEqual({ matchupId: 'm-y', week: 3 })
  })
  it('restores only a spot that differs from the default', () => {
    expect(spotToRestore(undefined)).toBeNull()
    expect(spotToRestore({ matchupId: null, week: null })).toBeNull()
    expect(spotToRestore({ matchupId: 'm-x', week: null })).toEqual({ matchupId: 'm-x', week: null })
    expect(spotToRestore({ matchupId: null, week: 3 })).toEqual({ matchupId: null, week: 3 })
  })
})

describe('mobile Match — the week’s matchups', () => {
  const rows = [
    { id: 'a', home_team_id: 't1', away_team_id: 't2' },
    { id: 'b', home_team_id: 't3', away_team_id: 't4' },
    { id: 'c', home_team_id: 't5', away_team_id: 't6' },
  ]
  it('puts your matchup first and keeps the rest in order', () => {
    expect(orderMatchups(rows, 't6').map((r) => r.id)).toEqual(['c', 'a', 'b'])
    expect(orderMatchups(rows, 't1').map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(orderMatchups(rows, null).map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(orderMatchups(rows, 'nobody').map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
  it('shows you on the left even as the away team', () => {
    expect(sidesOf({ home_team_id: 't1', away_team_id: 't2' }, 't2')).toEqual({ a: 't2', b: 't1' })
    expect(sidesOf({ home_team_id: 't1', away_team_id: 't2' }, 't9')).toEqual({ a: 't1', b: 't2' })
    expect(sidesOf({ home_team_id: 't1', away_team_id: null }, 't1')).toEqual({ a: 't1', b: null })
  })
  it('wraps the swipe at both ends', () => {
    expect(wrapIndex(5, 1, 6)).toBe(0)
    expect(wrapIndex(0, -1, 6)).toBe(5)
    expect(wrapIndex(2, 1, 6)).toBe(3)
    expect(wrapIndex(0, 1, 0)).toBe(0)
  })
})

describe('mobile Match — the card', () => {
  it('gives you the accent and every other team a stable palette colour, fixed fills only', () => {
    const ids = ['me', 'x', 'y', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    expect(teamAvatarClass(ids, 'me', 'me')).toBe('bg-accent')
    expect(teamAvatarClass(ids, 'x', 'me')).toBe('bg-m-ink')
    expect(teamAvatarClass(ids, 'y', 'me')).toBe('bg-pos-wr')
    expect(teamAvatarClass(ids, 'f', 'me')).toBe('bg-n-2')
    expect(teamAvatarClass(ids, 'i', 'me')).toBe('bg-n-3')
    // Never a themed text colour (light grey under white initials in dark).
    for (const id of ids) expect(teamAvatarClass(ids, id, 'me')).not.toMatch(/bg-m-t\d/)
    expect(teamInitial(' touchdown Tacos')).toBe('T')
    expect(teamInitial('')).toBe('?')
  })
  it('says a decided result in the win-% slot and nothing before', () => {
    expect(resultWord('win')).toEqual({ text: 'Won', tone: 'win' })
    expect(resultWord('loss')).toEqual({ text: 'Lost', tone: 'loss' })
    expect(resultWord('tie')).toEqual({ text: 'Tied', tone: 'tie' })
    expect(resultWord(null)).toBeNull()
    expect(resultWord('bye')).toBeNull()
  })
  it('shows a projected total only when every starter has a projection', () => {
    expect(cardProjection({ total: 83.44, missing: 0 }, 9)).toBe('83.44')
    expect(cardProjection({ total: 70, missing: 1 }, 9)).toBeNull()
    expect(cardProjection({ total: 0, missing: 0 }, 0)).toBeNull()
    expect(cardProjection(null, 9)).toBeNull()
  })
  it('a lineup’s projected total — the one rule for the Match card, the Team tab card and the Team view header', () => {
    const proj = (id: string) => ({ qb: 19.71, rb: 16.03, wr: 10 } as Record<string, number>)[id] ?? null
    expect(lineupProjection(['qb', 'rb', 'wr', null], proj)).toBe('45.74')
    // A filled starter without a projection: no partial sum.
    expect(lineupProjection(['qb', 'rb', 'te'], proj)).toBeNull()
    // Projections loading or failed (nobody has one): never "0.00".
    expect(lineupProjection(['qb', 'rb'], () => null)).toBeNull()
    expect(lineupProjection(['qb', 'rb'], () => undefined)).toBeNull()
    // An empty lineup: nothing to project.
    expect(lineupProjection([null, null], proj)).toBeNull()
    expect(lineupProjection([], proj)).toBeNull()
  })
})

describe('mobile Match — starter rows', () => {
  it('writes the team with its bye week', () => {
    expect(metaTeam('CLE', 9)).toBe('CLE (9)')
    expect(metaTeam('CLE', null)).toBe('CLE')
    expect(metaTeam(null, 9)).toBeNull()
  })
  it('writes the game line from the stored game row', () => {
    expect(gameLine('DET', 'up_next', game({}), 'Sun 1:00 PM')).toBe('Sun 1:00 PM @ GB')
    expect(gameLine('GB', 'up_next', game({}), 'Sun 1:00 PM')).toBe('Sun 1:00 PM vs DET')
    expect(gameLine('DET', 'now_playing', game({ status: 'live', quarter: 4, game_clock: '6:50' }), null)).toBe('Q4 6:50 @ GB')
    expect(gameLine('DET', 'now_playing', game({ status: 'live', quarter: 5, game_clock: '2:00' }), null)).toBe('OT 2:00 @ GB')
    expect(gameLine('DET', 'now_playing', game({ status: 'live' }), null)).toBe('Live @ GB')
    expect(gameLine('DET', 'done', game({ status: 'final', home_score: 20, away_score: 31 }), null)).toBe('Final W 31-20 @ GB')
    expect(gameLine('GB', 'done', game({ status: 'final', home_score: 20, away_score: 31 }), null)).toBe('Final L 20-31 vs DET')
    expect(gameLine('GB', 'done', game({ status: 'final', home_score: 17, away_score: 17 }), null)).toBe('Final T 17-17 vs DET')
    expect(gameLine('GB', 'done', game({ status: 'final' }), null)).toBe('Final vs DET')
    expect(gameLine('KC', 'bye', null, null)).toBe('Bye week')
    expect(gameLine('KC', 'up_next', null, null)).toBe('')
  })
  it('draws points the design’s way and keeps pending a word', () => {
    expect(pointsDisplay({ text: '9.60', tone: 'scored' })).toEqual({ text: '9.60', tone: 'scored' })
    expect(pointsDisplay({ text: '0.00', tone: 'zero_by_name' })).toEqual({ text: '0.00', tone: 'scored' })
    expect(pointsDisplay({ text: '—', tone: 'yet_to_play' })).toEqual({ text: '-', tone: 'dim' })
    expect(pointsDisplay({ text: '—', tone: 'empty' })).toEqual({ text: '–', tone: 'dim' })
    expect(pointsDisplay({ text: 'pending', tone: 'pending' })).toEqual({ text: 'pending', tone: 'word' })
  })
  it('fits the slot into its chip and hands MPosChip the position to fill it by', () => {
    expect(slotChipText('FLEX (W/R/T)', 'flex')).toBe('FLEX')
    expect(slotChipText('D/ST', 'dst')).toBe('D/ST')
    expect(slotChipText('DEF', 'def')).toBe('D/ST')
    expect(slotChipText('QB', 'qb')).toBe('QB')
    expect(slotChipText('Superflex', 'sf')).toBe('SFLX')
    expect(slotChipText('', 'wr')).toBe('WR')
    expect(slotChipPos('qb', 'QB')).toBe('QB')
    expect(slotChipPos('k', 'K')).toBe('K')
    expect(slotChipPos('dst', 'D/ST')).toBe('DST')
    expect(slotChipPos('def', 'D/ST')).toBe('DEF')
    expect(slotChipPos('flex', 'FLEX')).toBe('FLEX')
    expect(slotChipPos('sf', 'SFLX')).toBe('SFLX')
  })
  it('counts who is yet to play and names their positions in slot order', () => {
    const p = (position: string) => ({ id: position, full_name: position, position, nfl_team: 'X', headshot_url: null })
    const starters = [
      { player: p('QB'), phase: 'up_next' as const },
      { player: p('RB'), phase: 'done' as const },
      { player: p('WR'), phase: 'up_next' as const },
      { player: null, phase: 'up_next' as const },
      { player: p('DEF'), phase: 'up_next' as const },
      { player: p('TE'), phase: 'bye' as const },
    ]
    expect(yetToPlay(starters)).toEqual({ count: 3, positions: ['QB', 'WR', 'D/ST'] })
    expect(yetToPlayText(3, ['QB', 'WR', 'D/ST'])).toBe('Yet to play: 3 · QB, WR, D/ST')
    expect(yetToPlayText(5, null)).toBe('Yet to play: 5')
    expect(yetToPlayText(0, [])).toBe('Yet to play: 0')
  })
})
