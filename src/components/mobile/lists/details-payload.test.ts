/**
 * What New list / Edit details send (Chris, 2026-10-15: cover colours +
 * position group on phones; migration 188). The render test pins what the
 * screen draws; this pins what it SAVES — including that nothing about the
 * colour is sent before the column exists.
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TEAM_ROSTER,
  MAX_ROSTER,
  detailsCreateInput,
  detailsPatch,
  rosterDraftOf,
  rosterValid,
  stepRoster,
  type DetailsCurrent,
  type DetailsDraft,
} from './details-payload'

const draft = (extra: Partial<DetailsDraft> = {}): DetailsDraft => ({
  title: 'My top 5 QBs',
  desc: '',
  position: 'ALL',
  coverColor: null,
  coloursReady: true,
  ...extra,
})

const current = (extra: Partial<DetailsCurrent> = {}): DetailsCurrent => ({
  title: 'My top 5 QBs',
  description: null,
  position_filter: 'QB',
  is_team: false,
  cover_color: null,
  tags: [{ name: 'dynasty' }],
  ...extra,
})

describe('New list — detailsCreateInput', () => {
  it('a ranked list with the name; "All" and "no colour" send nothing extra', () => {
    expect(detailsCreateInput(draft())).toEqual({ title: 'My top 5 QBs', ranking_mode: 'ranked' })
  })

  it('sends the chosen position group and cover colour', () => {
    expect(detailsCreateInput(draft({ position: 'WR', coverColor: 'green', desc: '  sleepers  ' }))).toEqual({
      title: 'My top 5 QBs',
      description: 'sleepers',
      ranking_mode: 'ranked',
      position_filter: 'WR',
      cover_color: 'green',
    })
  })

  it('never sends a colour before the column exists', () => {
    expect(detailsCreateInput(draft({ coverColor: 'green', coloursReady: false }))).not.toHaveProperty('cover_color')
  })
})

describe('Edit details — detailsPatch', () => {
  const unchanged = (extra: Partial<DetailsDraft> = {}) => ({ ...draft({ position: 'QB', ...extra }), tags: ['dynasty'] })

  it('nothing changed → an empty patch', () => {
    expect(detailsPatch(current(), unchanged())).toEqual({})
  })

  it('a chosen colour is sent; the same colour again is not', () => {
    expect(detailsPatch(current(), unchanged({ coverColor: 'purple' }))).toEqual({ cover_color: 'purple' })
    expect(detailsPatch(current({ cover_color: 'purple' }), unchanged({ coverColor: 'purple' }))).toEqual({})
  })

  it('un-choosing a colour sends null (back to the position colour)', () => {
    expect(detailsPatch(current({ cover_color: 'red' }), unchanged({ coverColor: null }))).toEqual({ cover_color: null })
  })

  it('never sends a colour before the column exists (the row has no key)', () => {
    const before = current()
    delete before.cover_color
    expect(detailsPatch(before, unchanged({ coverColor: 'red', coloursReady: false }))).toEqual({})
  })

  it('a new position group is sent; "All" clears it with null', () => {
    expect(detailsPatch(current(), unchanged({ position: 'RB' }))).toEqual({ position_filter: 'RB' })
    expect(detailsPatch(current(), unchanged({ position: 'ALL' }))).toEqual({ position_filter: null })
    expect(detailsPatch(current({ position_filter: null }), unchanged({ position: 'ALL' }))).toEqual({})
  })

  it('a team list has no position group to send', () => {
    expect(detailsPatch(current({ is_team: true, position_filter: null }), unchanged({ position: 'QB' }))).toEqual({})
  })

  it('name, description and tags are sent only when they change', () => {
    expect(
      detailsPatch(current({ description: 'old' }), {
        ...unchanged({ title: 'Renamed', desc: ' ' }),
        tags: ['dynasty', 'ppr'],
      }),
    ).toEqual({ title: 'Renamed', description: null, tags: ['dynasty', 'ppr'] })
  })
})

describe('team lists (gap list §3 #3)', () => {
  it('New list as a Team sends desktop’s team body — is_team and the roster with its total, no position group', () => {
    expect(detailsCreateInput(draft({ team: true, position: 'QB', roster: DEFAULT_TEAM_ROSTER }))).toEqual({
      title: 'My top 5 QBs',
      ranking_mode: 'ranked',
      is_team: true,
      roster_settings: { ...DEFAULT_TEAM_ROSTER, total: 17 },
    })
  })

  it('a plain list sends no team keys', () => {
    const body = detailsCreateInput(draft({ team: false, roster: DEFAULT_TEAM_ROSTER }))
    expect(body).not.toHaveProperty('is_team')
    expect(body).not.toHaveProperty('roster_settings')
  })

  it('Edit details sends a team’s whole roster only when a slot changed', () => {
    const team = current({ is_team: true, position_filter: null, roster_settings: { ...DEFAULT_TEAM_ROSTER, total: 17 } })
    const same = { ...draft({ position: 'ALL', roster: DEFAULT_TEAM_ROSTER }), tags: ['dynasty'] }
    expect(detailsPatch(team, same)).toEqual({})
    const more = { ...DEFAULT_TEAM_ROSTER, bench: 7 }
    expect(detailsPatch(team, { ...same, roster: more })).toEqual({ roster_settings: { ...more, total: 18 } })
  })

  it('a roster is never sent for a list that isn’t a team', () => {
    expect(detailsPatch(current(), { ...draft({ position: 'QB', roster: { ...DEFAULT_TEAM_ROSTER, k: 0 } }), tags: ['dynasty'] })).toEqual({})
  })

  it('a stored roster is read through the API schema; a malformed one opens on the default', () => {
    expect(rosterDraftOf({ ...DEFAULT_TEAM_ROSTER, qb: 2, total: 18 })).toEqual({ ...DEFAULT_TEAM_ROSTER, qb: 2 })
    expect(rosterDraftOf({ qb: 'two' })).toEqual(DEFAULT_TEAM_ROSTER)
    expect(rosterDraftOf(null)).toEqual(DEFAULT_TEAM_ROSTER)
  })

  it('the steppers stay inside what the API takes: 0–20 a slot, 60 in all', () => {
    const empty = { qb: 0, rb: 0, wr: 0, te: 0, flex: 0, dst: 0, k: 0, bench: 0, ir: 0 }
    expect(stepRoster(empty, 'qb', -1)).toBe(empty)
    expect(rosterValid(empty)).toBe(false)
    expect(rosterValid(stepRoster(empty, 'qb', 1))).toBe(true)
    expect(stepRoster({ ...empty, bench: 20 }, 'bench', 1).bench).toBe(20)
    const full = { ...empty, bench: 20, ir: 20, rb: 20 }
    expect(stepRoster(full, 'qb', 1)).toBe(full)
    expect(rosterValid(full)).toBe(true)
    expect(MAX_ROSTER).toBe(60)
  })
})
