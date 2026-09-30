/**
 * correction-events-export — the PRODUCTION route of L.E2.5 (tasks-M6 §6;
 * spec §23.4; PROGRESS D458): read one week's `stat_correction_events`
 * (migration 167, on production since 2026-09-30 ≈ 04:00Z — D432 / D453)
 * together with the week's games, bounds and stored lines, and name every
 * recorded correction — player, key, old → new, game — with F528's
 * measurement: the minutes from the week's (or the game's) first
 * observation as final to the event, the settle grace's own arithmetic
 * (D453(6): `nfl_games.updated_at`; with no game on the line the latest over
 * the week's in-week games).
 *
 * READ ONLY. The export sees the database only through `readOnly(db)`,
 * which exposes `from(table).select(…)` and nothing else: no insert, update,
 * upsert, delete or rpc is reachable from here (correction-events-export.test.ts
 * proves both the shape and the source). The CLI refuses to read at all
 * without `--confirm-target <host>` naming the target.
 *
 * Zero events is an answer, not an empty success: the render says how many
 * rows the table holds for the week AND the season, when it was read, and
 * whether any stored line of the week moved after the week was seen final —
 * the reason for the emptiness, never inferred (CLAUDE.md).
 */
import type { SyncClient } from '../src/lib/sync/types'
import { pageAll } from '../src/lib/supabase/page-all'
import { isMissingSchemaObject } from '../src/lib/supabase/postgrest-errors'
import { SETTLE_GRACE_MS } from '../src/lib/sync/ingest-week'

import type { FinalSeenGame, ProductionEvent } from './correction-snapshot-diff'

// ── The read-only door ─────────────────────────────────────────────────────

type SelectOnly = Pick<ReturnType<SyncClient['from']>, 'select'>

export interface ReadOnlyDb {
  from(table: string): SelectOnly
}

/** The ONLY way this module reaches the database: `select` and nothing else. */
export function readOnly(db: Pick<SyncClient, 'from'>): ReadOnlyDb {
  return Object.freeze({
    from(table: string): SelectOnly {
      const builder = db.from(table)
      return Object.freeze({ select: builder.select.bind(builder) }) as SelectOnly
    },
  })
}

// ── Rows ───────────────────────────────────────────────────────────────────

interface EventRow {
  id: string
  player_id: string
  stat_key: string
  old_value: number | null
  new_value: number | null
  detected_at: string
  week_state: string
  game_id: string | null
  source: string
}

interface GameRow {
  id: string
  week: number
  home_team: string
  away_team: string
  status: string | null
  kickoff_at: string
  updated_at: string | null
}

interface WeekRow {
  week: number
  starts_at: string
  first_kickoff_at: string | null
  last_game_ends_at: string | null
  correction_window_ends_at: string | null
}

interface LineRow {
  player_id: string
  updated_at: string | null
}

interface PlayerRow {
  id: string
  full_name: string
  position: string
  team: string | null
}

export interface ExportedEvent extends ProductionEvent {
  name: string | null
  position: string | null
  team: string | null
  /** The instant the grace measures from — the game's, else the week's. */
  finalSeenAt: string | null
  minutesAfterFinal: number | null
  grace: 'inside' | 'outside' | 'undetermined'
}

export interface CorrectionExport {
  season: number
  week: number
  readAt: string
  eventsTableAbsent: boolean
  seasonEventCount: number | null
  events: ExportedEvent[]
  games: (FinalSeenGame & { gameId: string; kickoffAt: string })[]
  thisWeek: WeekRow | null
  nextWeek: WeekRow | null
  lines: { stored: number; latestWrite: string | null; writtenAfterFinal: number | null }
  weekFinalSeenAt: string | null
}

const IN_WEEK = new Set(['scheduled', 'live', 'final'])

function minutes(fromIso: string, toIso: string): number {
  return Math.round(((Date.parse(toIso) - Date.parse(fromIso)) / 60_000) * 10) / 10
}

/** The week's last game first seen final — `finalObservedAt`'s week arm
 *  (ingest-week.ts): the latest `updated_at` over the in-week games, null if
 *  any is unknown or any in-week game is not final. */
export function weekFinalSeen(games: readonly GameRow[]): string | null {
  const inWeek = games.filter((g) => IN_WEEK.has(g.status ?? ''))
  if (inWeek.length === 0 || inWeek.some((g) => g.status !== 'final' || g.updated_at === null)) return null
  return inWeek.map((g) => g.updated_at as string).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null
}

export function graceOf(minutesAfter: number | null, graceMs = SETTLE_GRACE_MS): ExportedEvent['grace'] {
  if (minutesAfter === null) return 'undetermined'
  return minutesAfter < graceMs / 60_000 ? 'inside' : 'outside'
}

// ── The read ───────────────────────────────────────────────────────────────

export async function readCorrectionExport(db: ReadOnlyDb, season: number, week: number, readAt: Date): Promise<CorrectionExport> {
  // The season count first — on its own error object, so a pre-167 database
  // (PostgREST's "Could not find the table") is told apart from any other
  // failure by its code (pageAll's thrown Error keeps only the message).
  let eventsTableAbsent = false
  let eventRows: EventRow[] = []
  let seasonEventCount: number | null = null
  const head = await db.from('stat_correction_events').select('id', { count: 'exact', head: true }).eq('season', season)
  if (head.error) {
    if (!isMissingSchemaObject(head.error, ['stat_correction_events'])) throw new Error(`stat_correction_events: ${head.error.message}`)
    eventsTableAbsent = true
  } else {
    seasonEventCount = head.count ?? null
    if (seasonEventCount === null) throw new Error('stat_correction_events: the season count came back empty — refusing to report a number')
    eventRows = await pageAll<EventRow>((from, to) =>
      db
        .from('stat_correction_events')
        .select('id, player_id, stat_key, old_value, new_value, detected_at, week_state, game_id, source', { count: 'exact' })
        .eq('season', season)
        .eq('week', week)
        .order('detected_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    )
  }

  const games = await pageAll<GameRow>((from, to) =>
    db
      .from('nfl_games')
      .select('id, week, home_team, away_team, status, kickoff_at, updated_at', { count: 'exact' })
      .eq('season', season)
      .eq('week', week)
      .order('id', { ascending: true })
      .range(from, to),
  )
  if (games.length === 0) throw new Error(`nfl_games holds no game for ${season} week ${week} — refusing to report on an unknown week`)

  const weeks = await pageAll<WeekRow>((from, to) =>
    db
      .from('nfl_weeks')
      .select('week, starts_at, first_kickoff_at, last_game_ends_at, correction_window_ends_at', { count: 'exact' })
      .eq('season', season)
      .in('week', [week, week + 1])
      .order('week', { ascending: true })
      .range(from, to),
  )

  const lineRows = await pageAll<LineRow>((from, to) =>
    db
      .from('player_stats')
      .select('player_id, updated_at', { count: 'exact' })
      .eq('season', season)
      .eq('week', week)
      .order('player_id', { ascending: true })
      .range(from, to),
  )

  const playerIds = [...new Set(eventRows.map((e) => e.player_id))]
  const players = new Map<string, PlayerRow>()
  for (let i = 0; i < playerIds.length; i += 200) {
    const chunk = playerIds.slice(i, i + 200)
    const rows = await pageAll<PlayerRow>((from, to) =>
      db.from('players').select('id, full_name, position, team', { count: 'exact' }).in('id', chunk).order('id', { ascending: true }).range(from, to),
    )
    for (const p of rows) players.set(p.id, p)
  }

  const weekSeen = weekFinalSeen(games)
  const gameSeen = new Map(games.map((g) => [g.id, g.status === 'final' ? g.updated_at : null]))
  const events: ExportedEvent[] = eventRows.map((e) => {
    const seen = e.game_id !== null ? (gameSeen.get(e.game_id) ?? null) : weekSeen
    const after = seen === null ? null : minutes(seen, e.detected_at)
    const p = players.get(e.player_id)
    return {
      playerId: e.player_id,
      statKey: e.stat_key,
      oldValue: e.old_value,
      newValue: e.new_value,
      detectedAt: e.detected_at,
      weekState: e.week_state,
      gameId: e.game_id,
      name: p?.full_name ?? null,
      position: p?.position ?? null,
      team: p?.team ?? null,
      finalSeenAt: seen,
      minutesAfterFinal: after,
      grace: graceOf(after),
    }
  })

  const writes = lineRows.map((l) => l.updated_at).filter((t): t is string => t !== null)
  const latestWrite = writes.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null
  return {
    season,
    week,
    readAt: readAt.toISOString(),
    eventsTableAbsent,
    seasonEventCount,
    events,
    games: games.map((g) => ({
      gameId: g.id,
      week: g.week,
      homeTeam: g.home_team,
      awayTeam: g.away_team,
      status: g.status ?? 'unknown',
      kickoffAt: g.kickoff_at,
      firstSeenFinalAt: g.status === 'final' ? g.updated_at : null,
    })),
    thisWeek: weeks.find((w) => w.week === week) ?? null,
    nextWeek: weeks.find((w) => w.week === week + 1) ?? null,
    lines: {
      stored: lineRows.length,
      latestWrite,
      writtenAfterFinal: weekSeen === null ? null : writes.filter((t) => Date.parse(t) > Date.parse(weekSeen)).length,
    },
    weekFinalSeenAt: weekSeen,
  }
}

// ── Rendering ──────────────────────────────────────────────────────────────

function v(x: number | null): string {
  return x === null ? '(none)' : String(x)
}

export function renderCorrectionExport(x: CorrectionExport): string[] {
  const out: string[] = []
  out.push(`production stat corrections — ${x.season} week ${x.week}, read ${x.readAt} (read only)`)
  const w = x.thisWeek
  out.push(
    w
      ? `week ${x.week}: first kickoff ${w.first_kickoff_at ?? 'unknown'}; last game ends (release) ${w.last_game_ends_at ?? 'not yet'}; correction window ends ${w.correction_window_ends_at ?? 'unknown'}`
      : `week ${x.week}: no nfl_weeks row`,
  )
  if (x.nextWeek) out.push(`week ${x.week + 1}: first kickoff ${x.nextWeek.first_kickoff_at ?? 'unknown'}; its window ends ${x.nextWeek.correction_window_ends_at ?? 'unknown'}`)
  const finals = x.games.filter((g) => g.status === 'final').length
  out.push(
    `games: ${x.games.length} stored, ${finals} final; the week's last game first seen final (nfl_games.updated_at — the settle grace's clock): ${x.weekFinalSeenAt ?? 'not every in-week game is final'}`,
  )
  out.push(
    `stored lines: ${x.lines.stored}; latest write ${x.lines.latestWrite ?? 'none'}; written after the week was seen final: ${x.lines.writtenAfterFinal === null ? 'n/a (the week is not final)' : x.lines.writtenAfterFinal}`,
  )
  if (x.eventsTableAbsent) {
    out.push('stat_correction_events: ABSENT on this database (pre-167) — no correction can have been recorded; nothing to export')
    return out
  }
  if (x.events.length === 0) {
    out.push(
      `events: 0 for week ${x.week} (${x.seasonEventCount} in the ${x.season} season) — production has recorded no stat correction for this week as of ${x.readAt}. Nothing is fabricated.`,
    )
    return out
  }
  out.push(`events: ${x.events.length} for week ${x.week} (${x.seasonEventCount} in the ${x.season} season):`)
  x.events.forEach((e, i) => {
    const who = `${e.name ?? `player ${e.playerId}`} (${[e.position, e.team].filter(Boolean).join(', ') || 'unknown'}; id ${e.playerId})`
    const game = e.gameId ?? `the week (no game on the line — F468(a))`
    const after = e.minutesAfterFinal === null ? 'minutes unknown' : `${e.minutesAfterFinal} min after first seen final (${e.finalSeenAt})`
    out.push(`  ${i + 1}. ${who} — ${e.statKey} ${v(e.oldValue)} → ${v(e.newValue)} — game ${game} — detected ${e.detectedAt} (${e.weekState}) — ${after} — settle grace: ${e.grace}`)
  })
  const inside = x.events.filter((e) => e.grace === 'inside').length
  out.push(`F528: ${inside} of ${x.events.length} events inside the ${SETTLE_GRACE_MS / 3_600_000} h grace (recorded events are, by construction, at or after it — an "inside" here means the clock moved: a re-stamped game row)`)
  return out
}

/** The committed file — public NFL facts only: no event ids, no host, no key. */
export function exportFile(x: CorrectionExport): Record<string, unknown> {
  return {
    note:
      'Production stat_correction_events for this week, exported READ ONLY by scripts/export-correction-events.ts (M6 L.E2.5, PROGRESS D458): each event\'s player, stat key, old → new, detection instant, week state and game; the week\'s games with the instant production first saw each final (nfl_games.updated_at — the settle grace\'s clock); the week\'s bounds. Public NFL stat facts only.',
    season: x.season,
    week: x.week,
    readAt: x.readAt,
    thisWeek: x.thisWeek,
    nextWeek: x.nextWeek,
    weekFinalSeenAt: x.weekFinalSeenAt,
    games: x.games,
    events: x.events,
  }
}
