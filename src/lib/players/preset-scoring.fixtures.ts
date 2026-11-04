/**
 * Test fixtures for the preset scorer (K0): real Sleeper lines, the row shape
 * ingest stores for them, and a small Supabase stand-in that returns only the
 * columns a read selected, so a wrong SELECT fails the way it would for real.
 * Imported by tests only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { StatLineRow } from '@/lib/leagues/scoring/score-week-worker'
import { mapToCanonicalKeys, readZeroOmittedYardsAllowed } from '@/lib/leagues/stats/sleeper-stats-provider'
import { NULL_IS_PENDING_COLUMNS, STAT_COLUMN_SURFACE } from '@/lib/sync/ingest-week'
import { toStatColumns } from '@/lib/sync/live-stats'

/** What ingest stores for a raw Sleeper line: the adapter's own mapping, then
 *  every surface column filled with its default (`ingest-week.ts`). */
export function storedLine(raw: Record<string, number>): StatLineRow {
  const columns = toStatColumns(readZeroOmittedYardsAllowed(raw, mapToCanonicalKeys(raw)))
  const row: StatLineRow = { player_id: 'x', updated_at: 'x', advanced: null }
  for (const column of STAT_COLUMN_SURFACE) row[column] = columns[column] ?? (NULL_IS_PENDING_COLUMNS.has(column) ? null : 0)
  return row
}

export type StoredGame = Record<string, unknown> & { player_id: string; season: number; week: number; source: string | null }

/** A stored `player_stats` row for one game. */
export function storedGame(playerId: string, season: number, week: number, raw: Record<string, number>, over: Record<string, unknown> = {}): StoredGame {
  return { ...storedLine(raw), id: `${playerId}-${season}-${week}`, player_id: playerId, season, week, source: 'sleeper+nflverse', is_live: false, ...over }
}

// Real Sleeper lines, trimmed to the scoring fields.
export const BASS_2026_WK1 = { fga: 3, fgm: 3, fgm_30_39: 2, fgm_40_49: 1, xpa: 3, xpm: 3 }
export const RYLAND_2026_WK6 = { fga: 6, fgm: 6, fgm_20_29: 2, fgm_30_39: 3, fgm_40_49: 1 }
export const BOSWELL_2026_WK8 = { fga: 3, fgm: 2, fgm_20_29: 1, fgm_30_39: 1, fgmiss: 1, fgmiss_50_59: 1, fgmiss_50p: 1, xpa: 3, xpm: 3 }
export const MYERS_2025_WK18 = { fga: 4, fgm: 2, fgm_30_39: 1, fgm_40_49: 1, fgmiss: 2, fgmiss_20_29: 1, fgmiss_40_49: 1, xpa: 1, xpm: 1 }
export const MCMANUS_2025_WK2 = { fga: 3, fgm: 2, fgm_20_29: 1, fgm_50_59: 1, fgm_50p: 1, fgmiss: 1, fgmiss_40_49: 1, xpa: 3, xpm: 3 }
export const BOSWELL_2025_WK1 = { fga: 2, fgm: 2, fgm_50_59: 1, fgm_50p: 2, fgm_60p: 1, xpa: 4, xpm: 4 }
export const AUBREY_2025_WK15 = { fga: 6, fgm: 4, fgm_20_29: 1, fgm_30_39: 1, fgm_40_49: 2, fgmiss: 2, fgmiss_50_59: 2, fgmiss_50p: 2, rush_yd: 6, xpa: 2, xpm: 2 }
export const SEA_2026_WK1 = { int: 3, pts_allow: 10, sack: 3, yds_allow: 277 }
export const TB_2026_WK8 = { int: 4, pts_allow_0: 1, yds_allow: 224 }
export const KC_2025_WK7 = { fum_rec: 1, pts_allow_0: 1, sack: 1, yds_allow: 95, yds_allow_0_100: 1 }
export const BUF_2025_WK2 = { fum_rec: 1, pts_allow: 10, sack: 4, yds_allow: 154 }
export const PHI_2026_WK8 = { fum_rec: 1, pts_allow: 27, sack: 2, yds_allow: 339 }
export const DAL_2026_WK5 = { pts_allow: 24, sack: 1, yds_allow: 419 }
export const DAL_2026_WK6 = { int: 1, pts_allow: 23, sack: 3, yds_allow: 318 }
export const ARI_2026_WK1 = { blk_kick: 1, fum_rec: 1, int: 1, pts_allow: 14, sack: 3, yds_allow: 268 }
export const MIN_2026_WK3 = { def_st_td: 1, int: 2, pts_allow: 16, sack: 6, yds_allow: 243 }
export const PRESCOTT_2025_WK1 = { pass_yd: 188, rush_yd: 3 }
export const JEANTY_2025_WK2 = { rec: 3, rec_yd: 1, rush_yd: 43 }

/** A live kickoff row: Sleeper omits points allowed and the game has no yards
 *  yet, so it stores 0 and NULL. It must never read as a +5 shutout. */
export const KICKOFF_DST = { sack: 0 }

/** Cowboys 2026: weeks 5 and 6 final (−2, +5), week 7 a live kickoff row. */
export function cowboysThroughKickoff(playerId = 'DAL'): StoredGame[] {
  return [
    storedGame(playerId, 2026, 5, DAL_2026_WK5),
    storedGame(playerId, 2026, 6, DAL_2026_WK6),
    storedGame(playerId, 2026, 7, KICKOFF_DST, { is_live: true }),
  ]
}

type Row = Record<string, unknown>

/** A stand-in for the Supabase client's read chain. A read gets back only the
 *  columns it selected. */
export function fakeSupabase(tables: Record<string, readonly Row[]>): SupabaseClient {
  return {
    rpc: async (name: string) => ({ data: name === 'is_league_member' ? true : null, error: null }),
    from(table: string) {
      let rows: readonly Row[] = tables[table] ?? []
      let columns: string[] | null = null
      const project = () =>
        rows.map((row) => (columns ? Object.fromEntries(columns.filter((c) => c in row).map((c) => [c, row[c]])) : row))
      const query = {
        select(selected: string) {
          columns = selected === '*' ? null : selected.split(',').map((c) => c.trim())
          return query
        },
        eq(column: string, value: unknown) {
          rows = rows.filter((row) => row[column] === value)
          return query
        },
        neq(column: string, value: unknown) {
          rows = rows.filter((row) => row[column] !== value)
          return query
        },
        in(column: string, values: readonly unknown[]) {
          rows = rows.filter((row) => values.includes(row[column]))
          return query
        },
        not(column: string) {
          rows = rows.filter((row) => row[column] !== null && row[column] !== undefined)
          return query
        },
        is(column: string, value: null) {
          rows = rows.filter((row) => (row[column] ?? null) === value)
          return query
        },
        gte(column: string, value: number) {
          rows = rows.filter((row) => Number(row[column]) >= value)
          return query
        },
        or: () => query,
        order: () => query,
        range: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: project()[0] ?? null, error: null }),
        then<T>(resolve: (value: { data: Row[]; error: null; count: number }) => T) {
          return Promise.resolve({ data: project(), error: null, count: rows.length }).then(resolve)
        },
      }
      return query
    },
  } as unknown as SupabaseClient
}
