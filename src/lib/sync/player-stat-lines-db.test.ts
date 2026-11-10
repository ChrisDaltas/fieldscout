/**
 * F916 / migration 223 against the local stack: `player_stat_lines` keeps the
 * provider's lines verbatim — readable by everyone (like `player_stats`, 005),
 * written by the service role only (RLS with no write policy is the wall: a
 * client INSERT is refused, an UPDATE / DELETE matches nothing; the house
 * pattern revokes TRUNCATE only — 081 C3), and `keepStatLines` writes, skips an
 * unchanged line and rewrites a changed one with its first_seen_at kept. Rows live under a test-only source
 * and are removed after.
 */
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ProviderPlayerWeekStats, ProviderSourceLine } from '@/lib/leagues/stats/stats-provider'
import type { Database } from '@/types/database'

import { keepStatLines, statLineHash, STAT_LINES_TABLE, type IngestReport } from './ingest-week'
import type { SyncClient } from './types'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const service = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false } })

const SOURCE = 'test-f916'
const SEASON = 2026
const WEEK = 17

function sourceLine(stats: Record<string, unknown>): ProviderSourceLine {
  return {
    source: SOURCE,
    seasonType: 'regular',
    position: 'WR',
    stats,
    meta: { player_id: 'f916-kr', game_id: '202611701', date: '2026-12-27', company: 'sportradar' },
    team: 'DAL',
    opponent: 'PHI',
    gameId: '202611701',
    gameDate: '2026-12-27',
    updatedAt: '2026-12-27T21:00:00.000Z',
  }
}

function line(stats: Record<string, unknown>): ProviderPlayerWeekStats {
  return { playerId: 'f916-kr', season: SEASON, week: WEEK, stats: {}, advanced: {}, sourceLine: sourceLine(stats) }
}

function freshReport(): IngestReport {
  return { lines: { status: 'none', seen: 0, written: 0, unchanged: 0, repeats: 0 }, reasons: [] } as unknown as IngestReport
}

async function cleanup(): Promise<void> {
  const { error } = await service.from(STAT_LINES_TABLE).delete().eq('source', SOURCE)
  if (error) throw new Error(`cleanup: ${error.message}`)
}

beforeAll(cleanup)
afterAll(cleanup)

describe('player_stat_lines (migration 223, F916)', () => {
  it('S1 keepStatLines writes a line verbatim, leaves an unchanged one alone, and rewrites a changed one keeping first_seen_at', async () => {
    const db = service as unknown as SyncClient
    const first = freshReport()
    await keepStatLines(db, SEASON, WEEK, [line({ kr: 2, kr_yd: 51, gp: 1, pts_ppr: 0 })], '2026-12-27T21:05:00.000Z', first)
    expect(first.lines).toEqual({ status: 'kept', seen: 1, written: 1, unchanged: 0, repeats: 0 })

    const { data: stored, error } = await service.from(STAT_LINES_TABLE).select('*').eq('source', SOURCE)
    expect(error).toBeNull()
    expect(stored).toHaveLength(1)
    expect(stored![0]).toMatchObject({
      source: SOURCE, season: SEASON, season_type: 'regular', week: WEEK, player_id: 'f916-kr', position: 'WR',
      team: 'DAL', opponent: 'PHI', game_id: '202611701', game_date: '2026-12-27',
      stats: { kr: 2, kr_yd: 51, gp: 1, pts_ppr: 0 },
      meta: { player_id: 'f916-kr', game_id: '202611701', date: '2026-12-27', company: 'sportradar' },
      line_hash: statLineHash(sourceLine({ kr: 2, kr_yd: 51, gp: 1, pts_ppr: 0 })),
    })
    expect(new Date(stored![0].first_seen_at).toISOString()).toBe('2026-12-27T21:05:00.000Z')
    expect(new Date(stored![0].source_updated_at!).toISOString()).toBe('2026-12-27T21:00:00.000Z')

    const again = freshReport()
    await keepStatLines(db, SEASON, WEEK, [line({ kr: 2, kr_yd: 51, gp: 1, pts_ppr: 0 })], '2026-12-27T21:06:00.000Z', again)
    expect(again.lines).toEqual({ status: 'kept', seen: 1, written: 0, unchanged: 1, repeats: 0 })

    const changed = freshReport()
    await keepStatLines(db, SEASON, WEEK, [line({ kr: 3, kr_yd: 77, gp: 1, pts_ppr: 0 })], '2026-12-27T21:07:00.000Z', changed)
    expect(changed.lines.written).toBe(1)
    const { data: after } = await service.from(STAT_LINES_TABLE).select('stats, first_seen_at, updated_at').eq('source', SOURCE).single()
    expect(after!.stats).toEqual({ kr: 3, kr_yd: 77, gp: 1, pts_ppr: 0 })
    expect(new Date(after!.first_seen_at).toISOString()).toBe('2026-12-27T21:05:00.000Z')
    expect(new Date(after!.updated_at).toISOString()).toBe('2026-12-27T21:07:00.000Z')
  })

  it('S2 everyone can read; nobody but the service role can write (RLS, no write policy: INSERT refused, UPDATE / DELETE match nothing)', async () => {
    const { data, error } = await anon.from(STAT_LINES_TABLE).select('player_id, stats').eq('source', SOURCE)
    expect(error).toBeNull()
    expect(data).toEqual([{ player_id: 'f916-kr', stats: { kr: 3, kr_yd: 77, gp: 1, pts_ppr: 0 } }])

    const row = {
      source: SOURCE, season: SEASON, season_type: 'regular', week: WEEK, player_id: 'f916-anon', stats: {}, meta: {},
      line_hash: 'x', first_seen_at: '2026-12-27T21:00:00Z', updated_at: '2026-12-27T21:00:00Z',
    }
    const insert = await anon.from(STAT_LINES_TABLE).insert(row)
    expect(insert.error?.code).toBe('42501')
    const update = await anon.from(STAT_LINES_TABLE).update({ stats: { kr: 99 } }).eq('source', SOURCE).select('player_id')
    expect([update.error, update.data]).toEqual([null, []])
    const remove = await anon.from(STAT_LINES_TABLE).delete().eq('source', SOURCE).select('player_id')
    expect([remove.error, remove.data]).toEqual([null, []])
    const { data: still } = await service.from(STAT_LINES_TABLE).select('stats').eq('source', SOURCE).single()
    expect(still!.stats).toEqual({ kr: 3, kr_yd: 77, gp: 1, pts_ppr: 0 })
  })

  it('S3 the shape checks hold: stats must be an object, first_seen_at never after updated_at', async () => {
    const base = {
      source: SOURCE, season: SEASON, season_type: 'regular', week: WEEK, player_id: 'f916-bad', meta: {},
      line_hash: 'x', first_seen_at: '2026-12-27T21:00:00Z', updated_at: '2026-12-27T21:00:00Z',
    }
    const notObject = await service.from(STAT_LINES_TABLE).insert({ ...base, stats: [] })
    expect(notObject.error?.code).toBe('23514')
    const backwards = await service.from(STAT_LINES_TABLE).insert({ ...base, stats: {}, first_seen_at: '2026-12-28T00:00:00Z' })
    expect(backwards.error?.code).toBe('23514')
  })
})
