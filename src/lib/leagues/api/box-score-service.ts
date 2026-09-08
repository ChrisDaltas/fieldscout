/**
 * Box-score service — M4 task L.D5.2, `GET /api/leagues/[id]/matchups/box?week=&team=`
 * (spec §11.4 "the matchup view refetches box-score lines on
 * `scores_updated`"; §16.2 `matchup-view` "Live Mode patterns"; §7.3.3 the
 * frozen snapshot; E61; PROGRESS D292/D321(7)/Q42, ledger F248(b)).
 *
 * WHY THIS READ EXISTS. The schema stores NO per-player points (D321(7):
 * "per-player points storage — the schema has none; the report carries
 * them; L.D5.2 renders box lines from `player_stats` per §11.4"), and the
 * client computes no score (CLAUDE.md — server-authoritative). So the box
 * lines are computed HERE, server-side, through the worker's OWN exported
 * pipeline — `scoreStarter` = `scorePlayerWeek(resolveRules(snapshot,
 * position), deriveTierIndicators(deliveredLine(row), cuts))` — the one
 * implementation D33/D57 name and F22/F23 pinned at the production call
 * site. Never a second dot product. The TEAM number a page shows is still
 * the door's (`matchups.home_score` / `team_week_results.points`); this
 * read's `points` is the same function over the same rows and is rendered
 * as the box's own sum, labelled as such.
 *
 * **What a starter is — the canonical `slot_map` (§12.13, D293),** never the
 * derived `starters` JSONB: every value under a starting slot key of the
 * team's `team_lineups` row for (season, week), IR keys excluded, exactly as
 * `startersOf` reads it for scoring. Slot labels come from the league's
 * `roster_settings.starting_slots` (§7.3.2). A team with no row for the week
 * is a real state (`lineup: null` — nothing set and the week not yet opened
 * by `league_week_advance`'s auto-carry) and renders as such, never as an
 * empty lineup of zeros.
 *
 * **The three starter states are the WORKER'S (D321(4)), verbatim:** SCORED
 * (a line, every applicable key delivered) · PENDING (a line, an applicable
 * key absent — E61; `pending[]` names the keys; the team's `points` is
 * `null`) · NO STAT LINE (0 and named — `reason: 'no_stat_row'`, Q42's
 * reading, OPEN and pinned so it reds if ruled otherwise). The UI renders
 * PENDING as pending — never 0 — and a no-line starter as the worker's
 * "0 by name" with the reason in a title (Q42). Nothing here invents a
 * DNP/bye vocabulary the spec lacks: the game PHASE below is the
 * `nfl_games` row's own status.
 *
 * **Live Mode phase (§11.4 "Now Playing / Done / Up Next")** is read from the
 * week's `nfl_games` rows for the player's NFL team (`players.team` matched
 * against `home_team` / `away_team`): `live` → `now_playing`, `final` →
 * `done`, anything else (`scheduled`, `postponed`, NULL) → `up_next`; a
 * player whose team has NO game row in a week that HAS rows is `bye`
 * (§11.2's bye reading); a week with no game rows at all is `up_next` for
 * everyone with `game: null` (nothing on record yet — the F238 posture).
 * No clock is read anywhere in this file: the phase is the provider's
 * status as ingestion stored it, never "kickoff_at ≤ now" (§23.3; the
 * `src/lib/leagues/**` ESLint fence). The row's `kickoff_at` rides along
 * for the UI to format as a stored instant (§16.4).
 *
 * **Reads are RLS-scoped with the user's client (D92)** behind the family's
 * membership gate (`inseason-reads.ts`) — `team_lineups` is member-SELECT
 * (112's F18 swap), `leagues` member-only (the snapshot column with it —
 * the same read `use-draft-pool.ts` makes), `players` / `player_stats` /
 * `nfl_games` world-readable (001/005). A non-member gets the no-leak 403,
 * never an empty box. Loud emptiness (tasks-M4 §4 rule 10): a week off the
 * calendar is a 404 by name; a team not of this league is a 404 by name; a
 * transport error is a 500; every read asserted below the PostgREST cap; a
 * snapshot that cannot score throws the calculator's own message as a 500
 * (the D292 posture — never a plausible 0.00 for a broken document).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import {
  assertSnapshotScorable,
  computeTeamWeek,
  irKeysOf,
  normalizePosition,
  STAT_LINE_COLUMNS,
  startersOf,
  type StarterRef,
  type StatLineRow,
} from '../scoring/score-week-worker'
import { assertBelowPostgrestCap, assertLeagueMember } from './inseason-reads'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

export const boxScoreQuerySchema = z.strictObject({
  week: z.coerce.number().int().min(1).max(18),
  team: z.uuid(),
})
export type BoxScoreQuery = z.infer<typeof boxScoreQuerySchema>

export type StarterPhase = 'now_playing' | 'done' | 'up_next' | 'bye'

/** The `nfl_games` columns the box renders (world-readable, 001/005). */
export interface BoxGame {
  id: string
  status: string | null
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  quarter: number | null
  game_clock: string | null
  kickoff_at: string
}

/** The headline stat columns rendered on a box line — a DISPLAY subset of
 *  `player_stats` (the scoring reads the whole `STAT_LINE_COLUMNS` surface;
 *  the line shown is what a fan reads at a glance). */
export const BOX_LINE_COLUMNS = [
  'pass_yards',
  'pass_tds',
  'interceptions',
  'rush_yards',
  'rush_tds',
  'receptions',
  'receiving_yards',
  'receiving_tds',
  'fumbles_lost',
  'fg_made',
  'fg_attempted',
  'def_sacks',
  'def_interceptions',
  'def_tds',
  'def_points_allowed',
] as const
export type BoxLineColumn = (typeof BOX_LINE_COLUMNS)[number]

export interface BoxStarter {
  /** The §12.13 instance key — `qb:0`, `flex:0`. */
  slot: string
  slot_key: string
  label: string
  player: { id: string; full_name: string; position: string; nfl_team: string | null } | null
  phase: StarterPhase
  game: BoxGame | null
  /** The worker's per-starter rounded points (0 for `no_stat_row`). */
  points: number
  /** E61: applicable rules keys with no delivered stat — non-empty ⇒ PENDING. */
  pending: string[]
  reason: 'scored' | 'no_stat_row' | 'empty' | 'unknown_player'
  /** The display subset of the stored line, or null with no line. */
  line: Partial<Record<BoxLineColumn, number>> | null
}

export interface TeamBoxScore {
  league_id: string
  season: number
  week: number
  team_id: string
  /** `null` = no `team_lineups` row for the week (a real state). */
  lineup: { locked_at: string | null; set_at: string | null; edited_by_commish: boolean } | null
  starters: BoxStarter[]
  /** Σ of the starters' rounded points, or `null` when any starter is
   *  pending (the door's NULL — E61). The box's OWN sum through the same
   *  function the worker stores from; the stored matchup score is the
   *  matchups read's. */
  points: number | null
  pending: Array<{ player_id: string; keys: string[] }>
  no_stat_row: string[]
  /** True when the week has no `nfl_games` rows at all (phases are
   *  `up_next` by default, `game: null`). */
  no_game_rows: boolean
}

interface SlotDef {
  key: string
  label: string
  count: number
}

/** The starting slots of a league's `roster_settings` (§7.3.2), in order —
 *  the labels the box renders. Tolerant of a malformed document (an empty
 *  list, which renders the slot key itself). */
export function startingSlotDefs(rosterSettings: unknown): SlotDef[] {
  const slots = (rosterSettings as { starting_slots?: unknown } | null)?.starting_slots
  if (!Array.isArray(slots)) return []
  const out: SlotDef[] = []
  for (const slot of slots) {
    const s = slot as { key?: unknown; label?: unknown; count?: unknown }
    if (typeof s.key !== 'string' || s.key.length === 0) continue
    out.push({
      key: s.key,
      label: typeof s.label === 'string' && s.label.length > 0 ? s.label : s.key,
      count: typeof s.count === 'number' && Number.isInteger(s.count) && s.count >= 0 ? s.count : 0,
    })
  }
  return out
}

/** The ordered starting-slot INSTANCES (`qb:0`, `rb:0`, `rb:1`, …) — the
 *  rows the box renders, empty seats included. */
export function slotInstanceKeys(defs: readonly SlotDef[]): Array<{ slot: string; slot_key: string; label: string }> {
  const out: Array<{ slot: string; slot_key: string; label: string }> = []
  for (const def of defs) {
    for (let i = 0; i < def.count; i += 1) out.push({ slot: `${def.key}:${i}`, slot_key: def.key, label: def.label })
  }
  return out
}

/** The Live Mode phase of one starter from the week's game rows (pure —
 *  the provider's stored status, never a clock). */
export function starterPhase(
  nflTeam: string | null,
  games: readonly BoxGame[],
): { phase: StarterPhase; game: BoxGame | null } {
  if (games.length === 0) return { phase: 'up_next', game: null }
  if (!nflTeam) return { phase: 'bye', game: null }
  const game = games.find((g) => g.home_team === nflTeam || g.away_team === nflTeam) ?? null
  if (!game) return { phase: 'bye', game: null }
  if (game.status === 'live') return { phase: 'now_playing', game }
  if (game.status === 'final') return { phase: 'done', game }
  return { phase: 'up_next', game }
}

function boxLine(row: StatLineRow | null): Partial<Record<BoxLineColumn, number>> | null {
  if (!row) return null
  const line: Partial<Record<BoxLineColumn, number>> = {}
  for (const column of BOX_LINE_COLUMNS) {
    const value = row[column]
    if (typeof value === 'number' && Number.isFinite(value)) line[column] = value
  }
  return line
}

/**
 * GET /api/leagues/[id]/matchups/box?week=&team= — one team's box score for
 * one week: its starters with the worker's per-starter points / pending /
 * no-line states and each starter's Live Mode phase.
 */
export async function readBoxScore(supabase: Supabase, leagueId: string, rawQuery: unknown): Promise<ServiceResult> {
  const parsed = boxScoreQuerySchema.safeParse(rawQuery)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { week, team: teamId } = parsed.data

  const refused = await assertLeagueMember(supabase, leagueId)
  if (refused) return refused

  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('id, season, roster_settings, scoring_rules_snapshot')
    .eq('id', leagueId)
    .is('deleted_at', null)
    .maybeSingle()
  if (leagueError) return { status: 500, body: { error: `leagues: ${leagueError.message}` } }
  if (!league) {
    return { status: 500, body: { error: 'leagues: the league row read empty after membership passed' } }
  }

  const [weekRes, ladderRes, teamRes] = await Promise.all([
    supabase.from('league_weeks').select('week').eq('league_id', leagueId).eq('season', league.season).eq('week', week).maybeSingle(),
    supabase.from('league_weeks').select('week').eq('league_id', leagueId).eq('season', league.season),
    supabase.from('teams').select('id').eq('id', teamId).eq('league_id', leagueId).maybeSingle(),
  ])
  if (weekRes.error) return { status: 500, body: { error: `league_weeks: ${weekRes.error.message}` } }
  if (ladderRes.error) return { status: 500, body: { error: `league_weeks: ${ladderRes.error.message}` } }
  if (teamRes.error) return { status: 500, body: { error: `teams: ${teamRes.error.message}` } }
  if (!weekRes.data) {
    const weeks = (ladderRes.data ?? []).map((r) => r.week)
    const bounds = weeks.length > 0 ? `weeks ${Math.min(...weeks)}–${Math.max(...weeks)}` : 'no weeks (no season calendar yet)'
    return {
      status: 404,
      body: { error: `Week ${week} is not on this league’s calendar (season ${league.season}; league_weeks holds ${bounds})` },
    }
  }
  if (!teamRes.data) {
    return { status: 404, body: { error: 'This team isn’t a franchise of this league.' } }
  }

  // The snapshot must score before any starter is computed (the D292
  // quarantine gate, applied to a read): a broken document is a 500 naming
  // the key, never a page of zeros.
  let snapshot: Parameters<typeof computeTeamWeek>[0]
  try {
    assertSnapshotScorable(league.scoring_rules_snapshot)
    snapshot = league.scoring_rules_snapshot
  } catch (e) {
    return { status: 500, body: { error: `scoring snapshot: ${e instanceof Error ? e.message : String(e)}` } }
  }

  const [lineupRes, gamesRes] = await Promise.all([
    supabase
      .from('team_lineups')
      .select('slot_map, locked_at, set_at, edited_by_commish')
      .eq('team_id', teamId)
      .eq('season', league.season)
      .eq('week', week)
      .maybeSingle(),
    supabase
      .from('nfl_games')
      .select('id, status, home_team, away_team, home_score, away_score, quarter, game_clock, kickoff_at')
      .eq('season', league.season)
      .eq('week', week)
      .order('kickoff_at', { ascending: true })
      .order('id', { ascending: true }),
  ])
  if (lineupRes.error) return { status: 500, body: { error: `team_lineups: ${lineupRes.error.message}` } }
  if (gamesRes.error) return { status: 500, body: { error: `nfl_games: ${gamesRes.error.message}` } }
  const games = (gamesRes.data ?? []) as BoxGame[]
  const gamesCapped = assertBelowPostgrestCap(games, 'nfl_games')
  if (gamesCapped) return gamesCapped

  const slots = slotInstanceKeys(startingSlotDefs(league.roster_settings))
  const empty: TeamBoxScore = {
    league_id: leagueId,
    season: league.season,
    week,
    team_id: teamId,
    lineup: null,
    starters: [],
    points: null,
    pending: [],
    no_stat_row: [],
    no_game_rows: games.length === 0,
  }
  if (!lineupRes.data) return { status: 200, body: empty as unknown as Json }

  const slotMap = (lineupRes.data.slot_map ?? {}) as Record<string, unknown>
  const irKeys = irKeysOf(league.roster_settings)
  const starterIds = startersOf(slotMap, irKeys) ?? []

  const playerIds = [...new Set(starterIds)]
  const [playersRes, statsRes] = await Promise.all([
    playerIds.length > 0
      ? supabase.from('players').select('id, full_name, position, team').in('id', playerIds)
      : Promise.resolve({ data: [], error: null }),
    playerIds.length > 0
      ? supabase
          .from('player_stats')
          .select(['player_id', 'updated_at', 'advanced', ...STAT_LINE_COLUMNS].join(', '))
          .eq('season', league.season)
          .eq('week', week)
          .in('player_id', playerIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (playersRes.error) return { status: 500, body: { error: `players: ${playersRes.error.message}` } }
  if (statsRes.error) return { status: 500, body: { error: `player_stats: ${statsRes.error.message}` } }
  const players = new Map((playersRes.data ?? []).map((p) => [p.id, p]))
  const statRows = (statsRes.data ?? []) as unknown as StatLineRow[]
  const statsCapped = assertBelowPostgrestCap(statRows, 'player_stats')
  if (statsCapped) return statsCapped
  const statsByPlayer = new Map(statRows.map((r) => [r.player_id, r]))

  // THE computation — the worker's own `computeTeamWeek` over the same
  // refs and rows it scores from (one implementation; the team `points`,
  // `pending` and `no_stat_row` are its verbatim, never re-derived here).
  const refs: StarterRef[] = []
  for (const seat of slots) {
    const raw = slotMap[seat.slot]
    const playerId = typeof raw === 'string' && raw.length > 0 ? raw : null
    const player = playerId ? players.get(playerId) : undefined
    if (playerId && player) refs.push({ player_id: playerId, position: normalizePosition(player.position) })
  }
  let team: ReturnType<typeof computeTeamWeek>
  try {
    team = computeTeamWeek(snapshot, teamId, refs, statsByPlayer)
  } catch (e) {
    return { status: 500, body: { error: `scoring: ${e instanceof Error ? e.message : String(e)}` } }
  }
  const scoredByPlayer = new Map(team.starters.map((s) => [s.player_id, s]))

  const starters: BoxStarter[] = []
  for (const seat of slots) {
    const raw = slotMap[seat.slot]
    const playerId = typeof raw === 'string' && raw.length > 0 ? raw : null
    if (!playerId) {
      starters.push({ ...seat, player: null, phase: 'up_next', game: null, points: 0, pending: [], reason: 'empty', line: null })
      continue
    }
    const player = players.get(playerId)
    const scored = scoredByPlayer.get(playerId)
    if (!player || !scored) {
      // A rostered id with no `players` row — named, never scored as 0
      // silently (CLAUDE.md's loud emptiness).
      starters.push({
        ...seat,
        player: { id: playerId, full_name: playerId, position: '?', nfl_team: null },
        phase: 'up_next',
        game: null,
        points: 0,
        pending: [],
        reason: 'unknown_player',
        line: null,
      })
      continue
    }
    const { phase, game } = starterPhase(player.team, games)
    starters.push({
      ...seat,
      player: { id: playerId, full_name: player.full_name, position: player.position, nfl_team: player.team },
      phase,
      game,
      points: scored.points,
      pending: scored.pending,
      reason: scored.reason,
      line: boxLine(statsByPlayer.get(playerId) ?? null),
    })
  }

  const payload: TeamBoxScore = {
    ...empty,
    lineup: { locked_at: lineupRes.data.locked_at, set_at: lineupRes.data.set_at, edited_by_commish: lineupRes.data.edited_by_commish },
    starters,
    points: team.points,
    pending: team.pending,
    no_stat_row: team.no_stat_row,
  }
  return { status: 200, body: payload as unknown as Json }
}
