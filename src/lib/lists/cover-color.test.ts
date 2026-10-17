import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  COVER_COLORS,
  COVER_COLOR_UNAVAILABLE_BODY,
  COVER_COLOR_UNAVAILABLE_STATUS,
  coverColorOf,
  createListWithCoverSchema,
  hasCoverColorColumn,
  isCoverColor,
  isMissingCoverColorColumn,
  updateListWithCoverSchema,
} from './cover-color'

/**
 * A list's cover colour (Chris, 2026-10-15, mobile ruling 9; migration 188).
 * Six stable keys, `null` = follow the position colour. The app and the
 * database must agree on the vocabulary, and everything that reads a row must
 * survive the column being absent (main deploys before the push).
 */

const MIGRATION = 'supabase/migrations/188_list_cover_color.sql'

describe('the vocabulary matches migration 188’s CHECK', () => {
  it('the same six keys, in the same order', () => {
    const sql = readFileSync(path.resolve(process.cwd(), MIGRATION), 'utf8')
    const check = /CHECK \(cover_color IN \(([^)]*)\)\)/.exec(sql)
    expect(check, 'migration 188 carries a cover_color IN (…) CHECK').not.toBeNull()
    const keys = check![1].split(',').map((k) => k.trim().replace(/^'|'$/g, ''))
    expect(keys).toEqual([...COVER_COLORS])
  })

  it('is the design’s six swatches, as keys', () => {
    expect(COVER_COLORS).toEqual(['blue', 'ink', 'red', 'purple', 'indigo', 'green'])
  })
})

describe('reading a row', () => {
  it('a chosen key reads as itself', () => {
    for (const key of COVER_COLORS) expect(coverColorOf({ cover_color: key })).toBe(key)
  })

  it('null, a missing key (before 188), or junk all read as "no colour"', () => {
    expect(coverColorOf({ cover_color: null })).toBeNull()
    expect(coverColorOf({})).toBeNull()
    expect(coverColorOf(null)).toBeNull()
    expect(coverColorOf(undefined)).toBeNull()
    expect(coverColorOf({ cover_color: '#0088FF' })).toBeNull()
    expect(coverColorOf({ cover_color: 'Blue' })).toBeNull()
    expect(isCoverColor('')).toBe(false)
  })

  it('the column counts as present only when the row carries the key', () => {
    expect(hasCoverColorColumn({ id: 'x', cover_color: null })).toBe(true)
    expect(hasCoverColorColumn({ id: 'x', cover_color: 'red' })).toBe(true)
    expect(hasCoverColorColumn({ id: 'x' })).toBe(false)
    expect(hasCoverColorColumn(null)).toBe(false)
    expect(hasCoverColorColumn(undefined)).toBe(false)
  })
})

describe('"the column isn’t there yet" is recognised, and nothing else', () => {
  it('PostgREST’s write answer and Postgres’s read answer, naming the column', () => {
    expect(
      isMissingCoverColorColumn({
        code: 'PGRST204',
        message: "Could not find the 'cover_color' column of 'lists' in the schema cache",
      }),
    ).toBe(true)
    expect(isMissingCoverColorColumn({ code: '42703', message: 'column lists.cover_color does not exist' })).toBe(true)
  })

  it('another missing column, another error, or none is not this', () => {
    expect(
      isMissingCoverColorColumn({
        code: 'PGRST204',
        message: "Could not find the 'roster_settings' column of 'lists' in the schema cache",
      }),
    ).toBe(false)
    expect(
      isMissingCoverColorColumn({ code: '23514', message: 'new row violates check constraint "lists_cover_color_check"' }),
    ).toBe(false)
    expect(isMissingCoverColorColumn(null)).toBe(false)
    expect(isMissingCoverColorColumn(undefined)).toBe(false)
  })

  it('the API answers it with a clear 409, not a 500', () => {
    expect(COVER_COLOR_UNAVAILABLE_STATUS).toBe(409)
    expect(COVER_COLOR_UNAVAILABLE_BODY.code).toBe('COVER_COLOR_UNAVAILABLE')
  })
})

describe('the API bodies', () => {
  it('create: a key, null or nothing; anything else is a 400', () => {
    for (const key of COVER_COLORS) {
      expect(createListWithCoverSchema.safeParse({ title: 'x', cover_color: key }).success).toBe(true)
    }
    expect(createListWithCoverSchema.safeParse({ title: 'x', cover_color: null }).success).toBe(true)
    expect(createListWithCoverSchema.safeParse({ title: 'x' }).success).toBe(true)
    for (const bad of ['#0088FF', 'Blue', '', 'orange', 3]) {
      expect(createListWithCoverSchema.safeParse({ title: 'x', cover_color: bad }).success, String(bad)).toBe(false)
    }
  })

  it('update: the same, and the rest of the update body is unchanged', () => {
    expect(updateListWithCoverSchema.safeParse({ cover_color: 'green' }).success).toBe(true)
    expect(updateListWithCoverSchema.safeParse({ cover_color: null }).success).toBe(true)
    expect(updateListWithCoverSchema.safeParse({ cover_color: '#07B85A' }).success).toBe(false)
    expect(updateListWithCoverSchema.safeParse({ position_filter: null, title: 'Renamed' }).success).toBe(true)
    expect(updateListWithCoverSchema.safeParse({}).data).toEqual({})
  })
})
