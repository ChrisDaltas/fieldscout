/**
 * Rosters service — M4 task L.D4.1, `GET /api/leagues/[id]/rosters` (spec
 * §15.3 "all rosters"; §12.7 `league_rosters`, §12.19 `league_player_pool`;
 * PROGRESS D92, D294, D308, ledger **F241(d)**).
 *
 * Same D68/D71 layering as the rest of the family: the Route Handler is auth
 * + param plumbing; everything testable lives here over an INJECTED client
 * so the stack suite (`inseason-reads-api-db.test.ts`) drives the production
 * composition across the real PostgREST wire.
 *
 * **Reads are RLS-scoped with the user's client (D92)** — `league_rosters`
 * (072), `league_player_pool` (109) and `league_members` (052) are
 * member-SELECT; `teams` and `players` are world-readable (001). And because
 * an RLS-empty read for a non-member would render as an EMPTY league,
 * membership is asserted FIRST through the database's own predicate
 * (`inseason-reads.ts`) — a non-member gets the family's no-leak 403, never
 * `{ teams: [] }` (CLAUDE.md's "never let 'nothing happened' mean 'it
 * worked'"; tasks-M4 §4 rule 10).
 *
 * **What the payload is.** Every seated franchise of the league (retired
 * ones included, marked — a sealed franchise still HAS a roster on the
 * record, §7.2.1) with its manager's `user_id` (from `league_members`, F35's
 * cache column — never a stint) and its roster: each `league_rosters` row
 * joined to the player's identity columns and to the player's pool row.
 * `slot_key` is the roster's CURRENT slot assignment (`bn`, `qb`, `ir`, … —
 * 112/113 maintain it on every set and every move) and the IR columns are
 * the roster-level IR truth (D308). Nothing here is computed: no lock is
 * evaluated, no legality judged, no score summed — those are 112's, 113's
 * and the worker's.
 *
 * **F241(d) — `locked_until` can be the literal `'infinity'`.** Migration
 * 116's `lineup_lock_tick` writes `'infinity'` when a player has kicked off
 * and the week's `last_game_ends_at` is not yet recorded (the release
 * instant is an EVENT datum L.D2.1's ingestion stamps); PostgREST hands it
 * to the client as the string `"infinity"`, and `new Date("infinity")` is
 * `Invalid Date`. So this layer never hands the raw column to a renderer:
 * `gameLockView` normalises the three shapes §12.19 defines — NULL = not
 * locked; an instant = locked until it; `'infinity'` = locked and the
 * release not yet recorded ("locked — the week's last game has not ended")
 * — into a discriminated view, and an unparseable value is a THROWN error
 * (a 500 by name), never a silently-unlocked row. The view carries no
 * "is it still locked" judgement: that needs a clock, which
 * `src/lib/leagues/**` does not read (D3); the UI compares `until` with its
 * own time. And per §12.19/§13.1 this column is a VIEW of the game-day
 * lock, never the E32 decider — 113 evaluates kickoffs itself.
 *
 * Loud emptiness (rule 10): a league whose `teams` read returns nothing
 * AFTER membership passed is a 500 by name (every league is created with
 * its commissioner's franchise — 060 — so an empty read is a fault, not a
 * league); every read is asserted below the PostgREST cap; a transport
 * error is a 500, never an empty list. An EMPTY ROSTER, by contrast, is a
 * real state (pre-draft) and renders as `roster: []` under a team that
 * exists.
 *
 * `Date.parse` is the one Date call here and it is legal inside the fence
 * (D310(7)): a pure parse of a value the database wrote, not a wall-clock
 * read.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'

import { assertBelowPostgrestCap, assertLeagueMember } from './inseason-reads'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

/** The §12.19 `locked_until` column, made renderable. */
export type GameLockView =
  | { state: 'unlocked'; until: null }
  | { state: 'locked_until'; until: string }
  | { state: 'locked_release_unrecorded'; until: null }

/** The literal PostgREST renders for a `timestamptz 'infinity'`. */
export const POOL_LOCK_INFINITY = 'infinity'

export function gameLockView(lockedUntil: string | null | undefined): GameLockView {
  if (lockedUntil === null || lockedUntil === undefined) {
    return { state: 'unlocked', until: null }
  }
  if (lockedUntil === POOL_LOCK_INFINITY) {
    return { state: 'locked_release_unrecorded', until: null }
  }
  if (Number.isNaN(Date.parse(lockedUntil))) {
    throw new Error(
      `league_player_pool.locked_until is neither NULL, an instant nor 'infinity' (§12.19): ${JSON.stringify(lockedUntil)}`,
    )
  }
  return { state: 'locked_until', until: lockedUntil }
}

export interface RosterPlayer {
  player_id: string
  full_name: string
  position: string
  nfl_team: string | null
  /** The feed's spelling (`Active`/`Questionable`/`Out`/`IR`/… — C56); the
   *  designation bridge is 112's, not the client's. */
  status: string | null
  bye_week: number | null
  /** The roster's current slot assignment (`bn`, `qb`, `rb`, `ir`, …). */
  slot_key: string | null
  acquisition_type: string | null
  acquisition_cost: number | null
  ir_placed_week: number | null
  ir_lock_until_week: number | null
  acquired_at: string | null
  /** The pool's state for this player (`rostered` when the mirror holds — a
   *  missing row is reported as `null`, never invented as `rostered`; D294's
   *  reconciliation owns the mirror). */
  pool_state: string | null
  game_lock: GameLockView
}

export interface RosterTeam {
  team_id: string
  name: string
  owner_id: string
  status: string
  /** From `league_members.team_id` (F35) — null for an unseated franchise. */
  manager_user_id: string | null
  roster: RosterPlayer[]
}

export interface LeagueRosters {
  league_id: string
  season: number
  teams: RosterTeam[]
}

/**
 * GET /api/leagues/[id]/rosters — every franchise's roster (§15.3).
 */
export async function readRosters(supabase: Supabase, leagueId: string): Promise<ServiceResult> {
  const refused = await assertLeagueMember(supabase, leagueId)
  if (refused) return refused

  const [leagueRes, teamsRes, membersRes, rostersRes, poolRes] = await Promise.all([
    supabase.from('leagues').select('id, season').eq('id', leagueId).is('deleted_at', null).maybeSingle(),
    supabase
      .from('teams')
      .select('id, name, owner_id, status')
      .eq('league_id', leagueId)
      .order('name', { ascending: true })
      .order('id', { ascending: true }),
    supabase.from('league_members').select('user_id, team_id').eq('league_id', leagueId),
    supabase
      .from('league_rosters')
      .select(
        'team_id, player_id, slot_key, acquisition_type, acquisition_cost, ir_placed_week, ir_lock_until_week, acquired_at',
      )
      .eq('league_id', leagueId)
      .order('player_id', { ascending: true }),
    supabase.from('league_player_pool').select('player_id, state, locked_until').eq('league_id', leagueId),
  ])
  for (const [what, res] of [
    ['leagues', leagueRes],
    ['teams', teamsRes],
    ['league_members', membersRes],
    ['league_rosters', rostersRes],
    ['league_player_pool', poolRes],
  ] as const) {
    if (res.error) return { status: 500, body: { error: `${what}: ${res.error.message}` } }
  }
  // Membership passed, so a missing league row is a fault (soft-deleted
  // between the two reads), not a non-member — say so.
  if (!leagueRes.data) {
    return { status: 500, body: { error: 'leagues: the league row read empty after membership passed' } }
  }
  const teams = teamsRes.data ?? []
  if (teams.length === 0) {
    return {
      status: 500,
      body: { error: 'teams: the league has no franchises — every league is created with its commissioner’s team (060)' },
    }
  }
  const rosterRows = rostersRes.data ?? []
  const poolRows = poolRes.data ?? []
  for (const [rows, what] of [
    [teams, 'teams'],
    [membersRes.data ?? [], 'league_members'],
    [rosterRows, 'league_rosters'],
    [poolRows, 'league_player_pool'],
  ] as const) {
    const capped = assertBelowPostgrestCap(rows, what)
    if (capped) return capped
  }

  // Player identity for every rostered id — one read, `in` over the set.
  const playerIds = [...new Set(rosterRows.map((r) => r.player_id))]
  const playersById = new Map<
    string,
    { full_name: string; position: string; team: string | null; status: string | null; bye_week: number | null }
  >()
  if (playerIds.length > 0) {
    const { data: players, error } = await supabase
      .from('players')
      .select('id, full_name, position, team, status, bye_week')
      .in('id', playerIds)
    if (error) return { status: 500, body: { error: `players: ${error.message}` } }
    const capped = assertBelowPostgrestCap(players ?? [], 'players')
    if (capped) return capped
    for (const p of players ?? []) playersById.set(p.id, p)
    // Rule 10: a roster row whose player is missing from `players` is a
    // broken FK-level invariant (072's FK forbids it), so it is named, not
    // rendered as an anonymous row.
    const missing = playerIds.filter((id) => !playersById.has(id))
    if (missing.length > 0) {
      return {
        status: 500,
        body: { error: `players: ${missing.length} rostered player(s) have no players row: ${missing.join(', ')}` },
      }
    }
  }

  const poolByPlayer = new Map(poolRows.map((row) => [row.player_id, row]))
  const managerByTeam = new Map<string, string>()
  for (const m of membersRes.data ?? []) {
    if (m.team_id && m.user_id) managerByTeam.set(m.team_id, m.user_id)
  }

  let payload: LeagueRosters
  try {
    payload = {
      league_id: leagueId,
      season: leagueRes.data.season,
      teams: teams.map((team) => ({
        team_id: team.id,
        name: team.name,
        owner_id: team.owner_id,
        status: team.status,
        manager_user_id: managerByTeam.get(team.id) ?? null,
        roster: rosterRows
          .filter((r) => r.team_id === team.id)
          .map((r) => {
            const player = playersById.get(r.player_id)!
            const pool = poolByPlayer.get(r.player_id)
            return {
              player_id: r.player_id,
              full_name: player.full_name,
              position: player.position,
              nfl_team: player.team,
              status: player.status,
              bye_week: player.bye_week,
              slot_key: r.slot_key,
              acquisition_type: r.acquisition_type,
              acquisition_cost: r.acquisition_cost,
              ir_placed_week: r.ir_placed_week,
              ir_lock_until_week: r.ir_lock_until_week,
              acquired_at: r.acquired_at,
              pool_state: pool?.state ?? null,
              game_lock: gameLockView(pool?.locked_until),
            }
          }),
      })),
    }
  } catch (cause) {
    // `gameLockView` throws on a value §12.19 does not define — a 500 by
    // name, never a silently-unlocked player.
    return { status: 500, body: { error: (cause as Error).message } }
  }

  return { status: 200, body: payload as unknown as Json }
}
