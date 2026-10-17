/**
 * The cover-colour support probe (migration 188 — main deploys before the
 * push). Pinned: it never names the column (a read naming a missing column is
 * an HTTP 400 on every open until the push), and it answers from whether the
 * row it reads carries the `cover_color` key.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: { table: string; columns: string; limit: number }[] = []
let answer: { data: object[] | null; error: unknown } = { data: [], error: null }

vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: (table: string) => ({
      select: (columns: string) => ({
        limit: (limit: number) => {
          calls.push({ table, columns, limit })
          return Promise.resolve(answer)
        },
      }),
    }),
  }),
}))

import { probeCoverColorSupport } from './use-list-cover-color-support'

beforeEach(() => {
  calls.length = 0
})

describe('probeCoverColorSupport', () => {
  it('reads one lists row with select(*) — never naming cover_color', async () => {
    answer = { data: [{ id: 'l1', cover_color: null }], error: null }
    await probeCoverColorSupport()
    expect(calls).toEqual([{ table: 'lists', columns: '*', limit: 1 }])
  })

  it('after the push: the row carries the key (even when null) → true', async () => {
    answer = { data: [{ id: 'l1', cover_color: null }], error: null }
    await expect(probeCoverColorSupport()).resolves.toBe(true)
  })

  it('before the push: the row has no such key → false', async () => {
    answer = { data: [{ id: 'l1', title: 'x' }], error: null }
    await expect(probeCoverColorSupport()).resolves.toBe(false)
  })

  it('no visible row is "unknown", treated like "not yet" → false', async () => {
    answer = { data: [], error: null }
    await expect(probeCoverColorSupport()).resolves.toBe(false)
    answer = { data: null, error: null }
    await expect(probeCoverColorSupport()).resolves.toBe(false)
  })

  it('a database error is thrown, not read as an answer', async () => {
    const error = { code: '500', message: 'boom' }
    answer = { data: null, error }
    await expect(probeCoverColorSupport()).rejects.toBe(error)
  })
})
