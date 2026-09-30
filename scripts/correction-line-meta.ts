/**
 * correction-line-meta — the line sidecar a two-snapshot recording writes
 * beside its canonical fixture (M6 L.E2.5; PROGRESS D458).
 *
 * The §23.1 contract carries neither the player's team nor a game id on a
 * Sleeper line (F468(a)), so a canonical recording alone cannot say WHICH
 * game a changed line belongs to, and nothing in it says WHEN a line last
 * changed. Sleeper's public weekly-stats rows — the very endpoint the adapter
 * polls — carry both: `team` (the team he played for that week), `opponent`,
 * `date`, and `last_modified`. This reads them, and only them: no stat value
 * is taken from here (the fixture's stat lines come through the provider,
 * D6 / D24 — record/replay reproduces exactly what the contract served).
 *
 * Everything kept is public NFL data (the repo is public): the player's
 * name, position, team, opponent, game date and Sleeper's stamp.
 */
import { FANTASY_POSITIONS } from '../src/lib/sports-data/sleeper'

import type { LineMeta, LinesSidecar } from './correction-snapshot-diff'

/** The fields read from a raw Sleeper weekly-stats row (a cast, validated here). */
export interface SleeperRawRow {
  player_id?: unknown
  team?: unknown
  opponent?: unknown
  date?: unknown
  last_modified?: unknown
  player?: { first_name?: unknown; last_name?: unknown; position?: unknown } | null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function isoFromMs(v: unknown): string | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? new Date(v).toISOString() : null
}

/** Raw rows → meta by player id, for `keep` players only (the lines the
 *  recording holds). A player seen twice with different teams is refused
 *  (never guess which game). */
export function toLineMeta(rows: readonly SleeperRawRow[], keep: ReadonlySet<string>): Record<string, LineMeta> {
  const out: Record<string, LineMeta> = {}
  for (const row of rows) {
    const id = str(row?.player_id)
    if (id === null || !keep.has(id)) continue
    const name = [str(row.player?.first_name), str(row.player?.last_name)].filter(Boolean).join(' ')
    const meta: LineMeta = {
      name: name.length > 0 ? name : null,
      position: str(row.player?.position),
      team: str(row.team),
      opponent: str(row.opponent),
      gameDate: str(row.date),
      lastModified: isoFromMs(row.last_modified),
    }
    const prior = out[id]
    if (prior && prior.team !== meta.team) {
      throw new Error(`player ${id} has rows for two teams (${prior.team} / ${meta.team}) — refusing to guess his game`)
    }
    // Two rows of one player (listed at two positions): keep the later stamp.
    if (!prior || (meta.lastModified ?? '') > (prior.lastModified ?? '')) out[id] = meta
  }
  return out
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/** The adapter's own endpoint and positions (sleeper-stats-provider.ts). */
export function sleeperWeekStatsUrl(season: number, week: number, position: string): string {
  return `https://api.sleeper.com/stats/nfl/${season}/${week}?season_type=regular&position[]=${position}`
}

export async function fetchLinesSidecar(
  season: number,
  week: number,
  keep: ReadonlySet<string>,
  capturedAt: Date,
  fetchImpl: FetchLike,
): Promise<LinesSidecar> {
  const rows: SleeperRawRow[] = []
  for (const position of FANTASY_POSITIONS) {
    const res = await fetchImpl(sleeperWeekStatsUrl(season, week, position))
    if (!res.ok) throw new Error(`Sleeper weekly stats (${position} wk${week}) answered ${res.status} — no sidecar written`)
    const body = await res.json()
    if (!Array.isArray(body)) throw new Error(`Sleeper weekly stats (${position} wk${week}) is not a list`)
    rows.push(...(body as SleeperRawRow[]))
  }
  const lines = toLineMeta(rows, keep)
  return {
    note:
      `Line sidecar (M6 L.E2.5, PROGRESS D458): for each player in the recording beside it, his name, position, the team he played for this week, the opponent, the game date and Sleeper's last-modified stamp, read from Sleeper's public weekly-stats endpoint. No stat value is read from here; public NFL data only.`,
    season,
    week,
    capturedAt: capturedAt.toISOString(),
    lines,
  }
}
