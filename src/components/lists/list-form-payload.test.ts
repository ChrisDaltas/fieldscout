/**
 * What the desktop list dialog sends (Chris, 2026-10-15: cover colours;
 * migration 188). `cover-color-tints.test.ts` pins what the picker draws; this
 * pins what is SAVED — including that nothing about the colour is sent before
 * the column exists.
 */
import { describe, expect, it } from 'vitest'

import { createListWithCoverSchema, updateListWithCoverSchema } from '@/lib/lists/cover-color'

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

/**
 * Position group "All players" (Chris, 2026-10-15): editing a WR list back to
 * "All players" didn't save — the dialog sent `position_filter: undefined`,
 * which `JSON.stringify` drops, so the PATCH never touched the column. What
 * matters is the body ON THE WIRE, so these go through `JSON.stringify` and
 * the routes' own Zod schemas.
 */
describe('listFormPayload — position group', () => {
  const wire = (body: unknown) => JSON.parse(JSON.stringify(body)) as Record<string, unknown>

  it('edit: "All players" sends position_filter null, which the PATCH schema accepts', () => {
    const body = wire(listFormPayload(form({ positionFilter: '' }), { mode: 'edit', list: { cover_color: null }, coloursReady: true }))
    expect(body).toHaveProperty('position_filter', null)
    const parsed = updateListWithCoverSchema.safeParse(body)
    expect(parsed.success).toBe(true)
    expect(parsed.data).toHaveProperty('position_filter', null)
  })

  it('edit: a chosen position is sent as itself', () => {
    const body = wire(listFormPayload(form({ positionFilter: 'RB' }), { mode: 'edit', list: {}, coloursReady: false }))
    expect(body).toHaveProperty('position_filter', 'RB')
    expect(updateListWithCoverSchema.safeParse(body).success).toBe(true)
  })

  it('create: "All players" sends no position key at all — the POST schema takes no null', () => {
    const body = wire(listFormPayload(form({ positionFilter: '' }), { mode: 'create', coloursReady: true }))
    expect(body).not.toHaveProperty('position_filter')
    const parsed = createListWithCoverSchema.safeParse(body)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.position_filter).toBeUndefined()
  })

  it('create: a chosen position is sent and validates', () => {
    const body = wire(listFormPayload(form({ positionFilter: 'TE' }), { mode: 'create', coloursReady: true }))
    expect(body).toHaveProperty('position_filter', 'TE')
    expect(createListWithCoverSchema.safeParse(body).success).toBe(true)
  })

  it('edit sends the rest of the form unchanged (title, privacy); create-only is_team and ranking_mode stay on create', () => {
    const edit = listFormPayload(form({ positionFilter: 'WR', listType: 'basic', isPrivate: true }), {
      mode: 'edit',
      list: {},
      coloursReady: false,
    })
    expect(edit).toEqual({
      title: 'Sleepers',
      position_filter: 'WR',
      roster_settings: undefined,
      is_private: true,
    })
    const created = listFormPayload(form({ listType: 'team' }), { mode: 'create', coloursReady: false })
    expect(created).toHaveProperty('is_team', true)
    expect(created).toHaveProperty('ranking_mode', 'ranked')
  })

  it('edit: a team list still carries its (editable) roster', () => {
    const edit = listFormPayload(form({ listType: 'team' }), { mode: 'edit', list: {}, coloursReady: false })
    expect(edit.roster_settings).toEqual({ ...ROSTER, total: rosterTotal(ROSTER) })
  })
})

/**
 * The Type picker is disabled in edit mode and only knows basic/ranked/team,
 * while a list can be `rank_and_tier` (the desktop Tier grouping) or
 * `tier_only` (migration 191). The PATCH rewrites `ranking_mode` and both
 * legacy flags whenever the key is present, so an edit body that carried it
 * turned the tiers view off on every rename or "All players" save.
 */
describe('listFormPayload — edit never sends ranking_mode', () => {
  const wire = (body: unknown) => JSON.parse(JSON.stringify(body)) as Record<string, unknown>

  // The dialog hands the whole `List` row in; `initialFormState` shows every
  // non-'unranked', non-team list as 'ranked' in the (disabled) Type picker.
  it.each(['rank_and_tier', 'tier_only', 'ranked'] as const)(
    'a %s list saved from Edit list (back to "All players") has no ranking_mode on the wire',
    (stored) => {
      const list = { cover_color: null, ranking_mode: stored, position_filter: 'WR' }
      const body = wire(
        listFormPayload(form({ positionFilter: '', listType: 'ranked' }), {
          mode: 'edit',
          list,
          coloursReady: true,
        }),
      )
      expect(body).not.toHaveProperty('ranking_mode')
      expect(body).not.toHaveProperty('tiers_enabled')
      expect(body).not.toHaveProperty('hide_order')
      expect(body).toHaveProperty('position_filter', null)
      const parsed = updateListWithCoverSchema.safeParse(body)
      expect(parsed.success).toBe(true)
      // The PATCH route only writes ranking_mode / hide_order / tiers_enabled
      // when these arrive — so the stored mode is left alone.
      expect(parsed.data?.ranking_mode).toBeUndefined()
      expect(parsed.data?.tiers_enabled).toBeUndefined()
      expect(parsed.data?.hide_order).toBeUndefined()
    },
  )

  it('an unranked (Basic) list renamed from Edit list has no ranking_mode either', () => {
    const list = { cover_color: null, ranking_mode: 'unranked' as const }
    const body = wire(listFormPayload(form({ listType: 'basic' }), { mode: 'edit', list, coloursReady: false }))
    expect(body).not.toHaveProperty('ranking_mode')
  })
})
