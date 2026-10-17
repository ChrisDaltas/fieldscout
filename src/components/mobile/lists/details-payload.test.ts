/**
 * What New list / Edit details send (Chris, 2026-10-15: cover colours +
 * position group on phones; migration 188). The render test pins what the
 * screen draws; this pins what it SAVES — including that nothing about the
 * colour is sent before the column exists.
 */
import { describe, expect, it } from 'vitest'

import { detailsCreateInput, detailsPatch, type DetailsCurrent, type DetailsDraft } from './details-payload'

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
