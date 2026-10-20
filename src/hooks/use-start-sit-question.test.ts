/**
 * A start/sit question's own page reads one question (gap list §4 item 112).
 * Pinned:
 *  - the same columns and players My start/sit reads, plus who asked it and
 *    the scoring system's name, by id, voided questions left out, one row;
 *  - "not here" (null) only for a reason the read proves: an id that isn't
 *    one is never sent (Postgres would refuse it as an error), and no row
 *    came back;
 *  - a failed read, or a row missing a player or its poster, throws — the
 *    page says it couldn't load, never "not here" or half a question;
 *  - a scoring name this viewer can't read (a member's own system) is null.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Op = [string, unknown[]]
interface Call {
  table: string
  ops: Op[]
}
const calls: Call[] = []
let answer: (call: Call) => { data: unknown; error: unknown } = () => ({ data: null, error: null })

vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: (table: string) => {
      const call: Call = { table, ops: [] }
      calls.push(call)
      const builder: object = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                Promise.resolve(answer(call)).then(resolve, reject)
            }
            return (...args: unknown[]) => {
              call.ops.push([String(prop), args])
              return builder
            }
          },
        },
      )
      return builder
    },
  }),
}))

import { SS_QUESTION_SELECT } from './use-mobile-profile-start-sit'
import { readStartSitQuestion } from './use-start-sit-question'

const ID = '5f77b13f-0501-4413-9367-46cf5f84ebef'
const op = (call: Call, name: string) => call.ops.filter(([n]) => n === name).map(([, args]) => args)

const BIJAN = { id: '9509', full_name: 'Bijan Robinson', team: 'ATL', position: 'RB', headshot_url: null }
const GIBBS = { id: '9221', full_name: 'Jahmyr Gibbs', team: 'DET', position: 'RB', headshot_url: null }

function row(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    context_note: 'FLEX spot: who starts?',
    season: 2026,
    week: 7,
    vote_count_a: 41,
    vote_count_b: null,
    voting_closes_at: '2026-10-25T17:00:00Z',
    resolved_at: null,
    created_at: '2026-10-19T10:00:00Z',
    player_a: BIJAN,
    player_b: [GIBBS],
    poster: { id: 'u2', username: 'devpro', avatar_url: null },
    scoring: { name: 'Scout PPR' },
    ...over,
  }
}

beforeEach(() => {
  calls.length = 0
  answer = () => ({ data: null, error: null })
})

describe('readStartSitQuestion', () => {
  it('reads one question by id — My start/sit’s columns plus the poster and scoring name, voided ones left out', async () => {
    answer = () => ({ data: row(), error: null })
    await readStartSitQuestion(ID)
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call!.table).toBe('start_sit_questions')
    const [select] = op(call!, 'select')[0] as [string]
    expect(select.startsWith(`${SS_QUESTION_SELECT}, `)).toBe(true)
    expect(select).toContain('poster:profiles!start_sit_questions_poster_id_fkey(id, username, avatar_url)')
    expect(select).toContain('scoring:scoring_systems!start_sit_questions_scoring_system_id_fkey(name)')
    expect(op(call!, 'eq')).toEqual([['id', ID]])
    expect(op(call!, 'not')).toEqual([['is_voided', 'is', true]])
    expect(op(call!, 'maybeSingle')).toEqual([[]])
  })

  it('maps the row: votes (null → 0), both players (object or one-row array), the poster and the scoring name', async () => {
    answer = () => ({ data: row(), error: null })
    expect(await readStartSitQuestion(ID)).toEqual({
      id: ID,
      note: 'FLEX spot: who starts?',
      season: 2026,
      week: 7,
      votesA: 41,
      votesB: 0,
      closesAt: '2026-10-25T17:00:00Z',
      resolvedAt: null,
      createdAt: '2026-10-19T10:00:00Z',
      playerA: BIJAN,
      playerB: GIBBS,
      poster: { id: 'u2', username: 'devpro', avatarUrl: null },
      scoringName: 'Scout PPR',
    })
  })

  it('a scoring system this viewer can’t read (or none) is no name, not an error', async () => {
    answer = () => ({ data: row({ scoring: null }), error: null })
    expect((await readStartSitQuestion(ID))?.scoringName).toBeNull()
  })

  it('an id that isn’t one is "not here" without a read (Postgres would refuse it as an error)', async () => {
    for (const bad of ['not-a-question', 'q1', '', `${ID}x`]) {
      expect(await readStartSitQuestion(bad), bad).toBeNull()
    }
    expect(calls).toHaveLength(0)
  })

  it('no row back (gone, or voided) is "not here"', async () => {
    answer = () => ({ data: null, error: null })
    expect(await readStartSitQuestion(ID)).toBeNull()
  })

  it('a failed read throws — never "not here"', async () => {
    const error = { message: 'boom', code: '500' }
    answer = () => ({ data: null, error })
    await expect(readStartSitQuestion(ID)).rejects.toBe(error)
  })

  it('a row missing a player or its poster is a broken read, not half a question', async () => {
    answer = () => ({ data: row({ player_b: null }), error: null })
    await expect(readStartSitQuestion(ID)).rejects.toThrow(/missing a player/)
    answer = () => ({ data: row({ poster: null }), error: null })
    await expect(readStartSitQuestion(ID)).rejects.toThrow(/missing its poster/)
  })
})
