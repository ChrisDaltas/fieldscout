/**
 * Admin › Reports' rows (Community launch plan C10) — `shapeAdminReports`
 * turns 214's report rows and their lookups into what the page shows: who
 * wrote the thing (list owner / comment author / question asker), what the
 * list is now (live, private, deleted, gone), whether a comment was removed.
 */
import { describe, expect, it } from 'vitest'

import { shapeAdminReports } from './content-reports'

const base = {
  reporter_id: 'u-dev',
  reason: null,
  note: null,
  created_at: '2026-10-29T20:00:00Z',
  reviewed_at: null,
  reviewed_by: null,
}
const profiles = [
  { id: 'u-dev', username: 'dev_user' },
  { id: 'u-kelly', username: 'kelly' },
  { id: 'u-sam', username: 'sam' },
  { id: 'u-admin', username: 'chris' },
]

describe('shapeAdminReports', () => {
  it('a list: its owner wrote it; its state follows the list', () => {
    const rows = ['L-live', 'L-private', 'L-deleted', 'L-gone'].map((id, i) => ({ ...base, id: `r${i}`, target_type: 'list', target_id: id, list_id: id }))
    const shaped = shapeAdminReports(
      rows,
      {
        lists: [
          { id: 'L-live', title: 'Live', owner_id: 'u-kelly', is_private: false, deleted_at: null },
          { id: 'L-private', title: 'Private', owner_id: 'u-admin', is_private: true, deleted_at: null },
          { id: 'L-deleted', title: 'Deleted', owner_id: 'u-kelly', is_private: false, deleted_at: '2026-10-29T00:00:00Z' },
        ],
        comments: [],
        questions: [],
        profiles,
      },
      'u-admin',
    )
    expect(shaped.map((r) => [r.kind, r.author, r.list?.state, r.list?.own])).toEqual([
      ['list', 'kelly', 'live', false],
      ['list', 'chris', 'private', true],
      ['list', 'kelly', 'deleted', false],
      ['list', null, 'missing', false],
    ])
    expect(shaped[3]!.list?.title).toBeNull()
    expect(shaped.every((r) => r.comment === null)).toBe(true)
  })

  it('a comment: its author wrote it; removed is said; a comment that’s gone is null', () => {
    const shaped = shapeAdminReports(
      [
        { ...base, id: 'r1', target_type: 'comment', target_id: 'c1', list_id: 'L1', reason: 'spam' },
        { ...base, id: 'r2', target_type: 'comment', target_id: 'c-gone', list_id: 'L1' },
      ],
      {
        lists: [{ id: 'L1', title: 'Sleepers', owner_id: 'u-kelly', is_private: false, deleted_at: null }],
        comments: [{ id: 'c1', author_id: 'u-sam', body: 'Buy my course', deleted_at: '2026-10-29T21:00:00Z' }],
        questions: [],
        profiles,
      },
      'u-admin',
    )
    expect(shaped[0]).toMatchObject({ kind: 'comment', reason: 'spam', author: 'sam', reporter: 'dev_user', comment: { body: 'Buy my course', removed: true } })
    expect(shaped[1]).toMatchObject({ comment: null, author: null })
  })

  it('a start/sit question: its asker; no list', () => {
    const [r] = shapeAdminReports(
      [{ ...base, id: 'r1', target_type: 'start_sit', target_id: 'q1', list_id: null }],
      { lists: [], comments: [], questions: [{ id: 'q1', poster_id: 'u-kelly' }], profiles },
      'u-admin',
    )
    expect(r).toMatchObject({ kind: 'start_sit', author: 'kelly', list: null, comment: null })
  })

  it('reviewed: by whom; an unknown reason reads as none', () => {
    const [r] = shapeAdminReports(
      [{ ...base, id: 'r1', target_type: 'list', target_id: 'L1', list_id: 'L1', reason: 'weird', reviewed_at: '2026-10-29T22:00:00Z', reviewed_by: 'u-admin' }],
      { lists: [], comments: [], questions: [], profiles },
      'u-admin',
    )
    expect(r).toMatchObject({ reason: null, reviewer: 'chris', reviewed_at: '2026-10-29T22:00:00Z' })
  })
})
