/**
 * What the desktop list dialog sends (Chris, 2026-10-15: cover colours;
 * migration 188). `cover-color-tints.test.ts` pins what the picker draws; this
 * pins what is SAVED — including that nothing about the colour is sent before
 * the column exists.
 */
import { describe, expect, it } from 'vitest'

import { listFormPayload, rosterTotal, type ListFormState } from './list-form-payload'

const ROSTER = { qb: 1, rb: 2, wr: 2, te: 1, flex: 1, dst: 1, k: 1, bench: 6, ir: 2 }

const form = (extra: Partial<ListFormState> = {}): ListFormState => ({
  title: '  Sleepers  ',
  positionFilter: '',
  listType: 'ranked',
  roster: ROSTER,
  isPrivate: false,
  coverColor: null,
  ...extra,
})

describe('listFormPayload — create', () => {
  it('no colour chosen: no cover_color key', () => {
    const body = listFormPayload(form(), { mode: 'create', coloursReady: true })
    expect(body).toEqual({
      title: 'Sleepers',
      position_filter: undefined,
      ranking_mode: 'ranked',
      is_team: false,
      roster_settings: undefined,
      is_private: false,
    })
    expect(body).not.toHaveProperty('cover_color')
  })

  it('a chosen colour is sent', () => {
    expect(listFormPayload(form({ coverColor: 'indigo' }), { mode: 'create', coloursReady: true }).cover_color).toBe(
      'indigo',
    )
  })

  it('never sends a colour before the column exists', () => {
    expect(listFormPayload(form({ coverColor: 'indigo' }), { mode: 'create', coloursReady: false })).not.toHaveProperty(
      'cover_color',
    )
  })

  it('carries the rest of the form as before (position, basic, team roster, private)', () => {
    expect(listFormPayload(form({ positionFilter: 'WR', listType: 'basic' }), { mode: 'create', coloursReady: false }))
      .toMatchObject({ position_filter: 'WR', ranking_mode: 'unranked', is_team: false })
    expect(listFormPayload(form({ listType: 'team', isPrivate: true }), { mode: 'create', coloursReady: false }))
      .toMatchObject({ is_team: true, is_private: true, roster_settings: { ...ROSTER, total: rosterTotal(ROSTER) } })
    expect(rosterTotal(ROSTER)).toBe(17)
  })
})

describe('listFormPayload — edit', () => {
  it('an unchanged colour is not sent', () => {
    const body = listFormPayload(form({ coverColor: 'red' }), { mode: 'edit', list: { cover_color: 'red' }, coloursReady: true })
    expect(body).not.toHaveProperty('cover_color')
  })

  it('a new colour is sent; clearing one sends null', () => {
    expect(
      listFormPayload(form({ coverColor: 'green' }), { mode: 'edit', list: { cover_color: 'red' }, coloursReady: true })
        .cover_color,
    ).toBe('green')
    const cleared = listFormPayload(form(), { mode: 'edit', list: { cover_color: 'red' }, coloursReady: true })
    expect(cleared).toHaveProperty('cover_color', null)
  })

  it('never sends a colour for a row read before the push', () => {
    expect(
      listFormPayload(form({ coverColor: 'green' }), { mode: 'edit', list: {}, coloursReady: false }),
    ).not.toHaveProperty('cover_color')
  })
})
