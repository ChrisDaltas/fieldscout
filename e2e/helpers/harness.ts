import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import type { AuctionDraftAudit, AuctionAuditBid, AuctionAuditBudget, AuctionAuditPick } from '@/lib/leagues/sim/invariants'
import { auctionKnobsOf } from '@/components/draft/auction-budget'
import { runScoreWeekBatch, type BatchReport } from '@/lib/leagues/scoring/score-week-worker'
import { SYNTHETIC_SEASON } from '@/lib/leagues/sim/synthetic-season'
import { systemTime } from '@/lib/leagues/time/time-provider'

import {
  E2E_BOT_EMAIL_DOMAIN,
  E2E_BOT_PASSWORD,
  E2E_BOT_USERNAME_PREFIX,
  E2E_LEAGUE_PREFIX,
  E2E_SEASON_GAME_PREFIX,
  LOCAL_ANON_KEY,
  LOCAL_SERVICE_ROLE_KEY,
  LOCAL_URL,
} from './local-env'

type Supabase = SupabaseClient<Database>

/**
 * SERVICE-ROLE HARNESS CLIENT — M2 task L.B5.1 (the D100/L.B6.1 confinement
 * doctrine, recorded; enumeration made literally true per R296, the R290
 * precedent): the service CLIENT is constructed ONLY in this file — the key
 * CONSTANT lives in local-env.ts, and playwright.config.ts also injects it
 * into the app server's process env (the webServer's own admin client) —
 * and the client does exactly TEN jobs, nothing else (5 from M2's L.B5.1;
 * 6–8 added by M3's L.C5.1, 9–10 by M4's L.D6.2 — enumerated extensions,
 * the R290 precedent):
 *
 *   1. the E2E-prefix fixture-cleanup sweep (start-stale + per-spec finally,
 *      loud + byte-clean-verified — the R285 class; delete order mirrors the
 *      sim's cleanupSweep). **L.D6.2 widened its BODY, not its job number**
 *      (job 10 is the season-surface half it grew, enumerated below);
 *   2. deadline REWINDS for placeholder-seat picks (an UPDATE writing a
 *      past `current_deadline`, `.eq('status','live')`-conditional — the
 *      F52 draft-tick lesson: the harness must never mutate a draft the
 *      engine has finished) + direct `draft_tick()` invocation (the RPC is
 *      REVOKEd from authenticated — cron/service only; driving it directly
 *      instead of waiting on the live 5s cron is the F52 sibling-wait
 *      lesson). **L.D6.2 added `driveDraftToCompletion` — the rewind+tick
 *      LOOP `draft-live.spec.ts:235-239` already ran inline, named once so
 *      the in-season specs reach `in_season` through 110's real completion
 *      wiring (D100) instead of a service-role status INSERT**;
 *   3. the zero-league-writes snapshot/diff for the mock spec — the pgTAP
 *      025 §F diff's E2E twin (same table list, same leagues-row
 *      byte-identity);
 *   4. small authoritative post-hoc reads the specs assert on (league
 *      status, roster counts, pick sheets, pool size; L.D6.2 adds the
 *      in-season reads — the NFL week's stored instants, a team's roster
 *      and stored lineup, a week's matchups and results — because R297
 *      forbids a spec inlining a service query and these are the same
 *      read-only class, not a new job);
 *   5. the journey spec's F49 season-year bump (L.B7.1): the settings UI's
 *      schedule picker pins year = the league's SEASON, so a UI-set instant
 *      on a 2026-season league is live-cron auto-start bait from its own
 *      date — bumping the created league's season server-side BEFORE the
 *      schedule step keeps the picker interaction identical while the
 *      stored instant lands far-future (the F49 row's "season-year bump"
 *      arm; non-literal by construction — year follows the season);
 *   6. (L.C5.1, the R290 enumerated-extension precedent) storm-bot
 *      provisioning/teardown: `auth.admin.createUser` for the bid storm's
 *      seated actors (the sim runner's bot-pool shape, own prefix), swept
 *      by the same cleanup;
 *   7. (L.C5.1) bid-deadline STAGING into the anti-snipe window — a
 *      forward-pointed, `.eq('status','live')`-conditional write of
 *      `now + N ms` (the L.C4.1 sniper-staging arm; the D128 re-floor is
 *      then asserted from the SERVER's own deadline moving later);
 *   8. (L.C5.1) the auction-audit reads for `sweepAuctionAudit` — including
 *      the `draft_team_budget` oracle calls, which are REVOKEd from
 *      authenticated (§4.7's one authority is exactly why the harness must
 *      hold the key — the L.C4.1 precedent);
 *   9. (L.D6.2) IN-SEASON WEEK DRIVING at an injected `p_now` (D291) — the
 *      `rewindDeadline` pattern's in-season sibling. `league_week_advance`
 *      / `finalize_matchups` / `lineup_lock_tick` are REVOKEd from
 *      `authenticated` and refuse a JWT caller in-body with 42501
 *      (`116_week_workers.sql:613-617`), so only this key can drive them;
 *      the same job plants the week's fixture rows (`nfl_games`,
 *      `player_stats` + `score_fanout`, direct `team_lineups` upserts —
 *      `score_fanout` has RLS on with ZERO policies, `109:294-308`) and
 *      runs the PRODUCTION scorer `runScoreWeekBatch` scoped by its
 *      documented `leagueIds` seam. Nothing here hand-UPDATEs `matchups`:
 *      a number that moved on screen moved because the pipeline moved it.
 *      **Every helper in job 9 follows `stageBidDeadline`, never
 *      `rewindDeadline`** — an advance that opened nothing, a finalize that
 *      flipped nothing, an upsert that wrote zero rows THROWS naming the
 *      reason (M4 rule 10's loud emptiness; CLAUDE.md's "never let 'nothing
 *      happened' mean 'it worked'"). The one deliberate exception is
 *      documented at its own call site;
 *  10. (L.D6.2) the SEASON-SURFACE half of the sweep and its door check.
 *      The synthetic season (2099) is shared ground with the sim and the
 *      dev seeder, and no league delete cascades to `nfl_games`,
 *      `player_stats`, `score_fanout` or the `nfl_weeks` bounds — F199's
 *      whole species. This suite therefore sweeps by IDENTITY (the
 *      `E2E_SEASON_GAME_PREFIX`) and by LEDGER (the exact tuples/weeks this
 *      process planted), never season-wide as the sim does (D330(3): a
 *      season-wide delete from two suites is mutual clobbering), and
 *      `assertNoForeignSeasonFixtures` refuses to start a run beside
 *      another suite's resident 2099 game row rather than working around it.
 *
 * Everything the USER does in a spec rides the browser or a seed-user's own
 * authed anon-key client (provision.ts) — production RPCs never accept a
 * caller clock (D100); the rewind and `p_now` ARE the virtual-time
 * mechanisms (`set_lineup`/`roster_add_drop` accept neither, by design —
 * their wrappers pass the transaction's own `now()`, `112:1234`/`113:912`).
 */
export function serviceClient(): Supabase {
  return createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

/** An anon-key client for seed-user sign-ins (provision.ts). */
export function anonClient(): Supabase {
  return createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false },
  })
}

function throwIfError(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what} failed: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Job 1 — loud cleanup (the R285 class)
// ---------------------------------------------------------------------------

/**
 * PostgREST puts an `in.(…)` list in the URI and Kong refuses a long one
 * ("URI too long" — the sim measured it at ~330 team uuids, `runner.ts:2023`).
 * 100 uuids is ~4 KB, comfortably inside the limit. An 8-team e2e league is
 * nowhere near it; the chunking is here so the shape matches the sim's and
 * cannot become a latent trap if a spec ever seats more.
 */
const ID_CHUNK = 100

function chunked<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += ID_CHUNK) out.push(items.slice(i, i + ID_CHUNK))
  return out
}

/**
 * Sweep every E2E-prefixed league graph and VERIFY zero remain. Runs at
 * spec start (a crashed prior run must never poison this one) and in every
 * spec's finally. Seed users are never deleted — they are the stack's own
 * fixtures.
 *
 * L.D6.2 widened the delete order to the sim's ONE recorded-correct
 * in-season sequence (`runner.ts:2037-2130`; D326(11)) because the in-season
 * tables have FKs with NO cascade — `team_week_results.opponent_team_id` /
 * `second_opponent_team_id` (`109:211`/`:216`), `transactions.initiator_team_id`
 * (`109:246`) and `leagues.champion_team_id` (`118:303`) each fail the
 * `teams` delete on their own. `team_lineups` is keyed by TEAM, not league,
 * so the teams are resolved first.
 */
export async function cleanupSweep(service: Supabase): Promise<string> {
  const { data: stale, error: staleError } = await service
    .from('leagues')
    .select('id')
    .like('name', `${E2E_LEAGUE_PREFIX}%`)
  throwIfError(staleError, 'cleanup: e2e-league lookup')
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    for (const part of chunked(ids)) {
      const { error: draftsError } = await service.from('drafts').delete().in('league_id', part)
      throwIfError(draftsError, 'cleanup: drafts delete')
    }
    const teamIds: string[] = []
    for (const part of chunked(ids)) {
      const { data: teamRows, error: teamReadError } = await service
        .from('teams')
        .select('id')
        .in('league_id', part)
      throwIfError(teamReadError, 'cleanup: e2e-team lookup')
      teamIds.push(...(teamRows ?? []).map((t) => t.id))
    }
    for (const part of chunked(teamIds)) {
      const { error: lineupsError } = await service.from('team_lineups').delete().in('team_id', part)
      throwIfError(lineupsError, 'cleanup: team_lineups delete')
    }
    for (const table of [
      'lineup_actions',
      'team_week_results',
      'league_player_pool',
      'league_rosters',
      'transactions',
      'league_chat',
      'schedule_actions',
      // 110/L.D1.2: completion writes matchups + league_weeks (the schedule) — both reference teams/leagues, so the league graph releases them FIRST (a fixture change forced by 110, not a drive-by).
      'matchups',
      'league_weeks',
    ] as const) {
      for (const part of chunked(ids)) {
        const { error } = await service.from(table).delete().in('league_id', part)
        throwIfError(error, `cleanup: ${table} delete`)
      }
    }
    for (const part of chunked(ids)) {
      // 118's `leagues.champion_team_id` FK has no cascade (118:303): a
      // COMPLETE league points at its champion and the teams delete fails on
      // it. No e2e spec reaches `complete` today; the clear is here so the
      // first one that does is not a fixture bug (D326(11)'s measurement).
      const { error: championError } = await service
        .from('leagues')
        .update({ champion_team_id: null })
        .in('id', part)
      throwIfError(championError, 'cleanup: champion clear')
      const { error: teamsError } = await service.from('teams').delete().in('league_id', part)
      throwIfError(teamsError, 'cleanup: teams delete')
      const { error: leaguesError } = await service.from('leagues').delete().in('id', part)
      throwIfError(leaguesError, 'cleanup: leagues delete')
    }
  }
  const season = await sweepSeasonFixtures(service)
  // Job 6's teardown half (L.C5.1): the storm-bot users, by their own
  // prefix — the sim runner's profile-sweep shape. Seed users are untouched.
  const { data: botProfiles, error: botError } = await service
    .from('profiles')
    .select('id, username')
    .like('username', `${E2E_BOT_USERNAME_PREFIX}%`)
  throwIfError(botError, 'cleanup: bot-profile lookup')
  for (const row of botProfiles ?? []) {
    const { error: deleteError } = await service.auth.admin.deleteUser(row.id)
    if (deleteError) {
      throw new Error(`cleanup: deleteUser ${row.username} failed: ${deleteError.message}`)
    }
  }

  const { count, error: verifyError } = await service
    .from('leagues')
    .select('id', { count: 'exact', head: true })
    .like('name', `${E2E_LEAGUE_PREFIX}%`)
  throwIfError(verifyError, 'cleanup: verification')
  if ((count ?? -1) !== 0) {
    throw new Error(`cleanup: stack NOT clean — ${count} e2e leagues remain`)
  }
  const { count: botCount, error: botVerifyError } = await service
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .like('username', `${E2E_BOT_USERNAME_PREFIX}%`)
  throwIfError(botVerifyError, 'cleanup: bot verification')
  if ((botCount ?? -1) !== 0) {
    throw new Error(`cleanup: stack NOT clean — ${botCount} e2e bot user(s) remain`)
  }
  return `CLEANUP: swept ${ids.length} e2e league(s) + ${(botProfiles ?? []).length} bot user(s) + ${season} — 0 remain`
}

// ---------------------------------------------------------------------------
// Job 10 — the SEASON-surface sweep half + the door check (F199)
// ---------------------------------------------------------------------------

/**
 * What THIS process planted on the shared synthetic season. Playwright runs
 * this suite in ONE worker (`playwright.config.ts:36-37`), so a module-level
 * ledger covers every spec in a run; a crashed PRIOR run leaves nothing in
 * it, which is exactly why the game rows also carry a prefix the sweep can
 * find without the ledger, and why `assertNoForeignSeasonFixtures` refuses
 * to start beside residue it cannot attribute.
 */
interface SeasonFixtureLedger {
  /** `nfl_games.id`s (all `E2E_SEASON_GAME_PREFIX`-prefixed). */
  gameIds: Set<string>
  /** `${season}:${week}:${player_id}` — the `player_stats` / `score_fanout` tuples. */
  statTuples: Set<string>
  /** Weeks whose `nfl_weeks` live bounds this run wrote. */
  boundedWeeks: Set<number>
}

const seasonFixtures: SeasonFixtureLedger = {
  gameIds: new Set(),
  statTuples: new Set(),
  boundedWeeks: new Set(),
}

const tupleKey = (week: number, playerId: string): string =>
  `${SYNTHETIC_SEASON}:${week}:${playerId}`

/**
 * Delete this suite's season fixtures — BY IDENTITY and BY LEDGER, never
 * season-wide.
 *
 * D330(3): the sim's own sweep deletes ALL `player_stats` and `score_fanout`
 * for season 2099 and NULLs the 2099 `nfl_weeks` bounds season-wide
 * (`runner.ts:2098-2128`). If this sweep did the same, a sim run and an e2e
 * run would clobber each other's fixtures mid-flight. So: `nfl_games` by
 * prefix (its id IS its identity), stat/queue rows by the exact tuples this
 * run planted, and the `nfl_weeks` bounds only for the weeks this run wrote.
 * Verified afterwards, loudly — a sweep that reports CLEAN while leaving
 * residue is precisely F199's shape.
 */
async function sweepSeasonFixtures(service: Supabase): Promise<string> {
  const { error: gamesError } = await service
    .from('nfl_games')
    .delete()
    .like('id', `${E2E_SEASON_GAME_PREFIX}%`)
  throwIfError(gamesError, 'cleanup: nfl_games delete (e2e prefix)')

  const tuples = [...seasonFixtures.statTuples].map((key) => {
    const [, week, playerId] = key.split(':')
    return { week: Number(week), playerId: playerId! }
  })
  const weeks = [...new Set(tuples.map((t) => t.week))]
  for (const week of weeks) {
    const playerIds = tuples.filter((t) => t.week === week).map((t) => t.playerId)
    for (const part of chunked(playerIds)) {
      const { error: queueError } = await service
        .from('score_fanout')
        .delete()
        .eq('season', SYNTHETIC_SEASON)
        .eq('week', week)
        .in('player_id', part)
      throwIfError(queueError, 'cleanup: score_fanout delete (planted tuples)')
      const { error: statsError } = await service
        .from('player_stats')
        .delete()
        .eq('season', SYNTHETIC_SEASON)
        .eq('week', week)
        .in('player_id', part)
      throwIfError(statsError, 'cleanup: player_stats delete (planted tuples)')
    }
  }

  // The 18 seeded `nfl_weeks` rows are NEVER deleted (`synthetic-season.ts:24-29`
  // — reference data a parallel suite's `league_weeks` FK depends on); only
  // the two live-updated columns this run wrote go back to the seed's NULLs,
  // and only on the weeks it wrote them.
  for (const week of seasonFixtures.boundedWeeks) {
    const { error: boundsError } = await service
      .from('nfl_weeks')
      .update({ first_kickoff_at: null, last_game_ends_at: null })
      .eq('season', SYNTHETIC_SEASON)
      .eq('week', week)
    throwIfError(boundsError, 'cleanup: nfl_weeks bounds reset')
  }

  const plantedGames = seasonFixtures.gameIds.size
  const plantedTuples = seasonFixtures.statTuples.size
  seasonFixtures.gameIds.clear()
  seasonFixtures.statTuples.clear()
  seasonFixtures.boundedWeeks.clear()

  // Byte-clean verification of the identity arm (the ledger arm is verified
  // by the door check the next spec runs).
  const { count, error: verifyError } = await service
    .from('nfl_games')
    .select('id', { count: 'exact', head: true })
    .like('id', `${E2E_SEASON_GAME_PREFIX}%`)
  throwIfError(verifyError, 'cleanup: nfl_games verification')
  if ((count ?? -1) !== 0) {
    throw new Error(`cleanup: stack NOT clean — ${count} e2e nfl_games row(s) remain`)
  }
  for (const week of weeks) {
    const playerIds = tuples.filter((t) => t.week === week).map((t) => t.playerId)
    const { count: statCount, error: statVerify } = await service
      .from('player_stats')
      .select('player_id', { count: 'exact', head: true })
      .eq('season', SYNTHETIC_SEASON)
      .eq('week', week)
      .in('player_id', playerIds)
    throwIfError(statVerify, 'cleanup: player_stats verification')
    if ((statCount ?? -1) !== 0) {
      throw new Error(
        `cleanup: stack NOT clean — ${statCount} planted player_stats row(s) remain on ${SYNTHETIC_SEASON} week ${week}`,
      )
    }
  }
  return `${plantedGames} game row(s) + ${plantedTuples} stat tuple(s)`
}

/**
 * The DOOR CHECK (F199, whose discharge was reversed on 2026-09-08 — R922).
 * A resident foreign `nfl_games` row on the synthetic season is not a
 * nuisance, it silently changes three answers:
 *
 *   * `schedule_window_internal` takes `min(nfl_games.kickoff_at)` for the
 *     league's FIRST week (`111:262-266`), so one past-kickoff row pushes
 *     every Remix into the E41 OVERRIDE branch and freezes week 1;
 *   * `week_games_state_internal` gates finalization on `(season, week)` —
 *     there is NO league column — so one non-final row BLOCKS
 *     `finalize_matchups` for a league that has nothing to do with it
 *     (`116:317-358`);
 *   * `lineup_kickoff_internal`'s week-datum fallback stops applying once
 *     ANY row exists for the week, so every club without one reads `on_bye`
 *     (`112:397-425`).
 *
 * The sim's sweep only deletes `nfl_games like 'simseason-%'`, so `dev-ld5*`
 * rows survive it and `npm run sim:census` prints CLEAN with the poison
 * resident (D317(7)). Refuse to start, name the ids and the remedy —
 * working around it silently repeats F199 exactly.
 *
 * Deliberately STRICT (stricter than "…or status='final'"): a final row with
 * a past kickoff still closes the Remix window, and on a fresh `db reset`
 * the correct count is zero. Prefer loud failure over a plausible-looking
 * pass (CLAUDE.md).
 */
export async function assertNoForeignSeasonFixtures(service: Supabase): Promise<void> {
  const { data, error } = await service
    .from('nfl_games')
    .select('id, week, status, kickoff_at')
    .eq('season', SYNTHETIC_SEASON)
    .order('id')
  throwIfError(error, 'season fixture door check: nfl_games')
  const foreign = (data ?? []).filter((row) => !row.id.startsWith(E2E_SEASON_GAME_PREFIX))
  if (foreign.length > 0) {
    throw new Error(
      `season ${SYNTHETIC_SEASON} carries ${foreign.length} nfl_games row(s) this suite does not own — ` +
        `${foreign.map((r) => `${r.id} (wk ${r.week}, ${r.status}, kickoff ${r.kickoff_at})`).join(', ')}. ` +
        'They would close the Remix window, block finalization and bye out every club without a row ' +
        '(F199). Remedy: `npx tsx scripts/dev-seed-inseason-league.ts --teardown` for dev-ld5* rows, ' +
        'or re-run the sim so its own sweep clears simseason-* rows.',
    )
  }
  const { data: bounds, error: boundsError } = await service
    .from('nfl_weeks')
    .select('week, first_kickoff_at')
    .eq('season', SYNTHETIC_SEASON)
    .not('first_kickoff_at', 'is', null)
  throwIfError(boundsError, 'season fixture door check: nfl_weeks bounds')
  if ((bounds ?? []).length > 0) {
    throw new Error(
      `season ${SYNTHETIC_SEASON} has first_kickoff_at set on week(s) ` +
        `${(bounds ?? []).map((b) => b.week).join(', ')} — the Remix window datum would come from ` +
        'another run\'s ingestion, not this fixture (F199). Re-run that suite\'s teardown, or ' +
        `NULL the column for season ${SYNTHETIC_SEASON}.`,
    )
  }
}

// ---------------------------------------------------------------------------
// Job 2 — deadline rewind + direct tick (virtual time, F52-shaped)
// ---------------------------------------------------------------------------

/**
 * Rewind the live draft's clock into the past so the NEXT tick resolves the
 * on-clock seat (placeholder/no-user seats autopick AT deadline — §8.5.4;
 * no grace applies to them, D102). `.eq('status','live')` keeps the write
 * off finished/paused drafts (the F52 lesson) — a 0-row rewind is legal
 * (the engine advanced first) and the caller just re-checks.
 */
export async function rewindDeadline(service: Supabase, draftId: string): Promise<void> {
  const past = new Date(Date.now() - 120_000).toISOString()
  const { error } = await service
    .from('drafts')
    .update({ current_deadline: past })
    .eq('id', draftId)
    .eq('status', 'live')
  throwIfError(error, 'harness rewind')
}

/** Drive one tick pass directly (service-role — the RPC is cron/service
 *  only). The live 5s cron stays a legal concurrent actor; SKIP LOCKED and
 *  the engine's uniques make the race benign (assertions are on converged
 *  state — the draft-tick-db precedent). */
export async function tickOnce(service: Supabase): Promise<void> {
  const { error } = await service.rpc('draft_tick')
  throwIfError(error, 'harness draft_tick')
}

/**
 * Drive a live board to COMPLETION through the real engine — the rewind +
 * tick pair `draft-live.spec.ts:235-239` already ran inline, named once so
 * the in-season specs can reach `in_season` the sanctioned way (L.D6.2).
 *
 * Why this and not a service-role status write: `draft_complete_internal`
 * (`110:821-895`) is what sets `leagues.status='in_season'` AND runs
 * `league_generate_schedule` in the SAME transaction. Inserting the status
 * and calling the generator separately (the dev seeder's shape,
 * `scripts/dev-seed-inseason-league.ts:211-251`) bypasses 110's real
 * completion wiring and is a D100 departure — the in-season specs exist to
 * exercise that wiring, so they must arrive through it.
 *
 * A HUMAN seat autopicks here too, and that is 097's own rule, not a
 * loophole: the grace hold applies only while `now() < deadline + grace`
 * (`097:487-489`), and the rewind puts the deadline 120 s in the past
 * against a 30 s grace. No browser is attached during this drive, so no
 * seat is fresh and no room is listening — the pacing below is courtesy to
 * the 5 s `draft-tick` cron sharing the stack, not a broadcast-storm
 * mitigation (`auction-live.spec.ts:87-98` needed that with two rooms open).
 *
 * THROWS if the board does not complete inside `maxSteps` (M4 rule 10: a
 * drive that finished nothing must never read as a finished draft).
 */
export async function driveDraftToCompletion(
  service: Supabase,
  draftId: string,
  opts: { maxSteps: number; paceMs?: number } = { maxSteps: 200 },
): Promise<{ steps: number; status: string }> {
  const pace = opts.paceMs ?? 120
  for (let step = 1; step <= opts.maxSteps; step++) {
    const { data, error } = await service
      .from('drafts')
      .select('status')
      .eq('id', draftId)
      .single()
    throwIfError(error, 'drive draft: status read')
    const status = data!.status as string
    if (status !== 'live') return { steps: step - 1, status }
    await rewindDeadline(service, draftId)
    await tickOnce(service)
    await new Promise((resolve) => setTimeout(resolve, pace))
  }
  const { data: final, error: finalError } = await service
    .from('drafts')
    .select('status, current_pick_number')
    .eq('id', draftId)
    .single()
  throwIfError(finalError, 'drive draft: final status read')
  throw new Error(
    `driveDraftToCompletion: draft ${draftId} is still '${final!.status}' at pick ` +
      `${final!.current_pick_number} after ${opts.maxSteps} rewind+tick steps — the board did NOT complete`,
  )
}

// ---------------------------------------------------------------------------
// Job 3 — the zero-league-writes diff (the pgTAP 025 §F twin)
// ---------------------------------------------------------------------------

export interface LeagueWritesSnapshot {
  /** The leagues row, whole — byte-identity is the assertion (025's
   *  to_jsonb pin: no status transition, no settings write, no updated_at
   *  bump). */
  leagueRow: unknown
  memberCount: number
  teamCount: number
  teamManagerCount: number
  inviteCount: number
  leagueWeekCount: number
  rosterCount: number
  leagueListCount: number
  /** league_chat rows OUTSIDE the mock's own context (the mock's own room
   *  is sanctioned §8.8 scope). Captured as a total when no mock exists
   *  yet; compared minus-mock-context after. */
  chatRowsOutsideMock: number
  /** Notifications held by the league's member users (§8.8: "no
   *  notifications to other members"). */
  memberNotificationCount: number
  /** Non-mock drafts + their pick counts (E60: a real scheduled draft must
   *  ride out a mock untouched — none exists in the mock spec's league, and
   *  the diff proves none appeared). */
  realDraftCount: number
  realPickCount: number
}

async function exactCount(
  service: Supabase,
  table: 'league_members' | 'teams' | 'team_managers' | 'league_invites' | 'league_weeks' | 'league_rosters' | 'league_lists',
  leagueId: string,
): Promise<number> {
  const { count, error } = await service
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('league_id', leagueId)
  throwIfError(error, `snapshot count ${table}`)
  return count ?? -1
}

/**
 * Capture everything league-scoped outside the mock's sanctioned surface
 * (its own drafts row, picks, queues, liveness, and `draft:<mock_id>` chat).
 * Call once BEFORE launch (excludeMockDraftId undefined — no mock exists)
 * and once AFTER completion (excludeMockDraftId = the mock), then
 * assert deep equality.
 */
export async function snapshotLeagueWrites(
  service: Supabase,
  leagueId: string,
  memberUserIds: readonly string[],
  excludeMockDraftId?: string,
): Promise<LeagueWritesSnapshot> {
  const { data: leagueRow, error: leagueError } = await service
    .from('leagues')
    .select('*')
    .eq('id', leagueId)
    .single()
  throwIfError(leagueError, 'snapshot leagues row')

  let chatQuery = service
    .from('league_chat')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', leagueId)
  if (excludeMockDraftId) {
    chatQuery = chatQuery.neq('context', `draft:${excludeMockDraftId}`)
  }
  const { count: chatCount, error: chatError } = await chatQuery
  throwIfError(chatError, 'snapshot chat rows')

  let notificationCount = 0
  if (memberUserIds.length > 0) {
    const { count, error } = await service
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .in('user_id', [...memberUserIds])
    throwIfError(error, 'snapshot notifications')
    notificationCount = count ?? -1
  }

  const { data: realDrafts, error: draftsError } = await service
    .from('drafts')
    .select('id')
    .eq('league_id', leagueId)
    .eq('is_mock', false)
  throwIfError(draftsError, 'snapshot real drafts')
  const realDraftIds = (realDrafts ?? []).map((d) => d.id)
  let realPickCount = 0
  if (realDraftIds.length > 0) {
    const { count, error } = await service
      .from('draft_picks')
      .select('*', { count: 'exact', head: true })
      .in('draft_id', realDraftIds)
    throwIfError(error, 'snapshot real picks')
    realPickCount = count ?? -1
  }

  return {
    leagueRow,
    memberCount: await exactCount(service, 'league_members', leagueId),
    teamCount: await exactCount(service, 'teams', leagueId),
    teamManagerCount: await exactCount(service, 'team_managers', leagueId),
    inviteCount: await exactCount(service, 'league_invites', leagueId),
    leagueWeekCount: await exactCount(service, 'league_weeks', leagueId),
    rosterCount: await exactCount(service, 'league_rosters', leagueId),
    leagueListCount: await exactCount(service, 'league_lists', leagueId),
    chatRowsOutsideMock: chatCount ?? -1,
    memberNotificationCount: notificationCount,
    realDraftCount: realDraftIds.length,
    realPickCount,
  }
}

// ---------------------------------------------------------------------------
// Job 4 — small authoritative reads
// ---------------------------------------------------------------------------

/** The authoritative leagues-row read (status + name — the name doubles as
 *  the identity check when a spec derives the id from a URL). Every spec's
 *  service read rides a named job-4 helper — no inline queries (R297). */
export async function readLeague(
  service: Supabase,
  leagueId: string,
): Promise<{ status: string; name: string }> {
  const { data, error } = await service
    .from('leagues')
    .select('status, name')
    .eq('id', leagueId)
    .single()
  throwIfError(error, 'read league row')
  return { status: data!.status as string, name: data!.name }
}

/** The stored §7.3 schedule instant (settings.draft.draft_scheduled_at) —
 *  the journey spec asserts its year followed the F49 season bump (job 5). */
export async function readLeagueScheduledInstant(
  service: Supabase,
  leagueId: string,
): Promise<string | null> {
  const { data, error } = await service
    .from('leagues')
    .select('settings')
    .eq('id', leagueId)
    .single()
  throwIfError(error, 'read league schedule instant')
  return (
    (data?.settings as { draft?: { draft_scheduled_at?: string | null } } | null)?.draft
      ?.draft_scheduled_at ?? null
  )
}

export async function countLeagueRosters(service: Supabase, leagueId: string): Promise<number> {
  const { count, error } = await service
    .from('league_rosters')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', leagueId)
  throwIfError(error, 'count league_rosters')
  return count ?? -1
}

export async function readPickSheet(
  service: Supabase,
  draftId: string,
): Promise<Array<{ pick_number: number; team_id: string; player_id: string; is_auto: boolean | null; created_at: string | null }>> {
  const { data, error } = await service
    .from('draft_picks')
    .select('pick_number, team_id, player_id, is_auto, is_undone, created_at')
    .eq('draft_id', draftId)
    .order('pick_number', { ascending: true })
  throwIfError(error, 'read pick sheet')
  return (data ?? []).filter((p) => !p.is_undone)
}

// --- Job 4, the L.D6.2 in-season half (same read-only class, R297) --------

export interface RosterEntry {
  player_id: string
  position: string
  nfl_team: string | null
  full_name: string
}

/** One team's roster, with the player identity the plants need (position to
 *  choose a legal seat, `team` to plant that club's game row). */
export async function readTeamRoster(
  service: Supabase,
  leagueId: string,
  teamId: string,
): Promise<RosterEntry[]> {
  const { data, error } = await service
    .from('league_rosters')
    .select('player_id, players!inner(position, team, full_name)')
    .eq('league_id', leagueId)
    .eq('team_id', teamId)
    .order('player_id')
  throwIfError(error, 'read team roster')
  return (data ?? []).map((row) => {
    const p = row.players as unknown as { position: string; team: string | null; full_name: string }
    return { player_id: row.player_id, position: p.position, nfl_team: p.team, full_name: p.full_name }
  })
}

/** The STORED lineup row for a team-week — the server's canonical
 *  `slot_map`, which is what a save is asserted against (never the DOM's
 *  idea of it; §11.2/D293 "what renders after a save is the server's map"). */
export async function readTeamLineup(
  service: Supabase,
  teamId: string,
  week: number,
): Promise<{ slot_map: Record<string, string>; locked_at: string | null } | null> {
  const { data, error } = await service
    .from('team_lineups')
    .select('slot_map, locked_at')
    .eq('team_id', teamId)
    .eq('season', SYNTHETIC_SEASON)
    .eq('week', week)
    .maybeSingle()
  throwIfError(error, 'read team lineup')
  if (!data) return null
  return {
    slot_map: (data.slot_map ?? {}) as Record<string, string>,
    locked_at: data.locked_at,
  }
}

export interface WeekMatchupRow {
  id: string
  status: string
  round_type: string
  home_team_id: string
  away_team_id: string | null
  home_score: number | null
  away_score: number | null
  result: string | null
}

/** A week's `matchups` rows — the pairing/score source of truth (D297). */
export async function readWeekMatchups(
  service: Supabase,
  leagueId: string,
  week: number,
): Promise<WeekMatchupRow[]> {
  const { data, error } = await service
    .from('matchups')
    .select('id, status, round_type, home_team_id, away_team_id, home_score, away_score, result')
    .eq('league_id', leagueId)
    .eq('week', week)
    .order('id')
  throwIfError(error, 'read week matchups')
  return (data ?? []) as never
}

/** The league room's D97 system posts, newest last — the server's own copy
 *  of what a Remix wrote (`111:748-749`), which is what the modal's applied
 *  panel and the activity feed are asserted AGAINST rather than each other. */
export async function readSystemPosts(
  service: Supabase,
  leagueId: string,
): Promise<Array<{ message: string; created_at: string }>> {
  const { data, error } = await service
    .from('league_chat')
    .select('message, created_at')
    .eq('league_id', leagueId)
    .eq('context', 'league')
    .eq('is_system', true)
    .order('created_at', { ascending: true })
  throwIfError(error, 'read league system posts')
  return (data ?? []) as never
}

/**
 * Pick an UNDRAFTED player of a given NFL club — the E32 spec's add target.
 *
 * It must be chosen at RUN TIME, never pinned: `provisionLeague` drafts the
 * REAL local pool by ADP, so which clubs the board consumed is not knowable
 * in advance (the R286 lesson). Deliberately returns a player with NO
 * `league_player_pool` row — `lineup_lock_tick` refreshes EXISTING rows only
 * (`119:775-780`), so such a player can never acquire a 🔒 from the every-
 * minute cron and the refusal on screen must be the SERVER's (§6.2 / E32:
 * `locked_until` is the job's VIEW, never the decider).
 */
export async function findUndraftedClubmate(
  service: Supabase,
  leagueId: string,
  nflTeam: string,
): Promise<RosterEntry> {
  const { data: rostered, error: rosterError } = await service
    .from('league_rosters')
    .select('player_id')
    .eq('league_id', leagueId)
  throwIfError(rosterError, 'find undrafted clubmate: roster read')
  const taken = new Set((rostered ?? []).map((r) => r.player_id))
  const { data, error } = await service
    .from('players')
    .select('id, position, team, full_name')
    .eq('team', nflTeam)
    .order('id')
  throwIfError(error, 'find undrafted clubmate: player read')
  const free = (data ?? []).find((p) => !taken.has(p.id))
  if (!free) {
    throw new Error(
      `findUndraftedClubmate: every ${nflTeam} player in the local pool is on a roster in league ` +
        `${leagueId} (${(data ?? []).length} club players, ${taken.size} rostered) — pick another club`,
    )
  }
  const { count, error: poolError } = await service
    .from('league_player_pool')
    .select('player_id', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .eq('player_id', free.id)
  throwIfError(poolError, 'find undrafted clubmate: pool row check')
  if ((count ?? 0) !== 0) {
    throw new Error(
      `findUndraftedClubmate: ${free.full_name} already has a league_player_pool row — the E32 spec ` +
        'needs a player with NO row, so the 🔒 on screen cannot be the tick\'s view',
    )
  }
  return { player_id: free.id, position: free.position, nfl_team: free.team, full_name: free.full_name }
}

/** One player's pool row, or null — how the E32 spec proves the DISABLED
 *  arm is the tick's VIEW and the refusal arm is not. */
export async function readPoolRow(
  service: Supabase,
  leagueId: string,
  playerId: string,
): Promise<{ state: string; locked_until: string | null } | null> {
  const { data, error } = await service
    .from('league_player_pool')
    .select('state, locked_until')
    .eq('league_id', leagueId)
    .eq('player_id', playerId)
    .maybeSingle()
  throwIfError(error, 'read pool row')
  return data ? { state: data.state as string, locked_until: data.locked_until } : null
}

/** A league's `league_weeks` ladder — status per week, the badge's source. */
export async function readLeagueWeeks(
  service: Supabase,
  leagueId: string,
): Promise<Array<{ week: number; status: string; finalized_at: string | null }>> {
  const { data, error } = await service
    .from('league_weeks')
    .select('week, status, finalized_at')
    .eq('league_id', leagueId)
    .order('week')
  throwIfError(error, 'read league weeks')
  return (data ?? []) as never
}

// ---------------------------------------------------------------------------
// Job 5 — the journey spec's F49 season-year bump (L.B7.1)
// ---------------------------------------------------------------------------

/**
 * Bump a just-created league's `season` so the settings UI's Month/Day/Time
 * picker (year = season) builds a FAR-FUTURE `draft_scheduled_at` — the F49
 * row's "season-year bump" sweep arm for the one instant this suite sets
 * through the real UI. Returns the season written so the spec can assert the
 * stored instant's year actually followed it (the falsifiable half).
 */
export async function bumpLeagueSeason(
  service: Supabase,
  leagueId: string,
  season: number,
): Promise<number> {
  const { error } = await service.from('leagues').update({ season }).eq('id', leagueId)
  throwIfError(error, 'bump league season (F49 arm)')
  return season
}

/**
 * The specs draft the REAL local player pool (the R286 lesson — no fixture
 * ADP band is safe by construction). A fresh `db reset` leaves `players`
 * EMPTY until `restore:dev` runs; fail loudly at the door with the remedy
 * named, never with a confusing empty pool mid-spec ("never let 'nothing
 * happened' mean 'it worked'" — CLAUDE.md).
 */
export async function assertPlayerPoolPresent(service: Supabase): Promise<void> {
  const { count, error } = await service
    .from('players')
    .select('id', { count: 'exact', head: true })
  throwIfError(error, 'player pool check')
  if ((count ?? 0) < 100) {
    throw new Error(
      `players table has ${count ?? 0} rows — the local stack needs its data restored ` +
        '(npm run restore:dev pinned to the LOCAL stack; see ACTIVE-BUILD.md) before test:e2e can run.',
    )
  }
}

// ---------------------------------------------------------------------------
// Job 6 — storm-bot provisioning (L.C5.1; the sim runner's bot-pool shape)
// ---------------------------------------------------------------------------

export interface BotSeatUser {
  userId: string
  client: Supabase
  username: string
}

/**
 * Mint `count` real auth users (own prefix, `email_confirm` — the sim
 * runner's exact shape) and sign each into its OWN anon-key client. Every
 * storm bid then travels the same service fn + JWT path a browser's would
 * (D100) — the service client itself never bids.
 */
export async function provisionBotUsers(service: Supabase, count: number): Promise<BotSeatUser[]> {
  const bots: BotSeatUser[] = []
  for (let i = 0; i < count; i++) {
    const username = `${E2E_BOT_USERNAME_PREFIX}${String(i + 1).padStart(2, '0')}`
    const email = `e2e-c5-bot-${String(i + 1).padStart(2, '0')}@${E2E_BOT_EMAIL_DOMAIN}`
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password: E2E_BOT_PASSWORD,
      email_confirm: true,
      user_metadata: { username },
    })
    if (createError) throw new Error(`bot createUser ${username} failed: ${createError.message}`)
    const client = anonClient()
    const { error: signInError } = await client.auth.signInWithPassword({
      email,
      password: E2E_BOT_PASSWORD,
    })
    if (signInError) throw new Error(`bot sign-in ${username} failed: ${signInError.message}`)
    bots.push({ userId: created.user.id, client, username })
  }
  return bots
}

// ---------------------------------------------------------------------------
// Job 7 — bid-deadline staging (the L.C4.1 sniper arm; D128's test bench)
// ---------------------------------------------------------------------------

/**
 * Stage the LIVE bid clock to `now + msFromNow` — INTO the anti-snipe window,
 * so the next accepted bid must move the server deadline LATER (the D128
 * re-floor, asserted from the drafts row afterwards). Forward-pointed and
 * `.eq('status','live')`-conditional (the F52 lesson). A 0-row write means
 * the engine advanced past `live` between the caller's read and this write —
 * that staging never happened, and pretending otherwise would let the spec
 * assert a re-floor against a deadline nobody staged, so it THROWS a
 * staging-specific error rather than returning as success (R564: the first
 * draft of this docblock promised "the caller re-checks" while the matched
 * count was discarded — nobody re-checked; the CLAUDE.md rule is that
 * "nothing happened" must never mean "it worked").
 */
export async function stageBidDeadline(
  service: Supabase,
  draftId: string,
  msFromNow: number,
): Promise<void> {
  const staged = new Date(Date.now() + msFromNow).toISOString()
  const { data, error } = await service
    .from('drafts')
    .update({ current_deadline: staged })
    .eq('id', draftId)
    .eq('status', 'live')
    .select('id')
  throwIfError(error, 'harness bid-deadline staging')
  if ((data ?? []).length === 0) {
    throw new Error(
      `stageBidDeadline matched 0 rows — draft ${draftId} is no longer 'live' ` +
        `(the engine advanced first); the staged deadline was NOT written`,
    )
  }
}

// ---------------------------------------------------------------------------
// Job 8 — auction reads (the L.C4.1 audit shape, service-side; job-4 class)
// ---------------------------------------------------------------------------

/** The authoritative auction market: nomination + deadline in one read. */
export async function readAuctionMarket(
  service: Supabase,
  draftId: string,
): Promise<{
  status: string
  currentPickNumber: number | null
  currentDeadline: string | null
  onClockTeamId: string | null
  nomination: { player_id: string; high_bid: number; high_bidder_team_id: string | null } | null
}> {
  const { data, error } = await service
    .from('drafts')
    .select('status, current_pick_number, current_deadline, on_clock_team_id, current_nomination')
    .eq('id', draftId)
    .single()
  throwIfError(error, 'read auction market')
  const raw = data!.current_nomination as
    | { player_id?: string; high_bid?: number; high_bidder_team_id?: string | null }
    | null
  return {
    status: data!.status as string,
    currentPickNumber: data!.current_pick_number,
    currentDeadline: data!.current_deadline,
    onClockTeamId: data!.on_clock_team_id,
    nomination:
      raw && typeof raw.player_id === 'string'
        ? {
            player_id: raw.player_id,
            high_bid: Number(raw.high_bid ?? 0),
            high_bidder_team_id: (raw.high_bidder_team_id as string | null) ?? null,
          }
        : null,
  }
}

/** Every bid row for one draft (optionally one nomination), in commit order. */
export async function readBidLedger(
  service: Supabase,
  draftId: string,
  nominationSeq?: number,
): Promise<
  Array<{
    id: string
    nomination_seq: number
    player_id: string
    team_id: string
    amount: number
    action_id: string | null
    created_at: string
  }>
> {
  let query = service
    .from('draft_bids')
    .select('id, nomination_seq, player_id, team_id, amount, action_id, created_at')
    .eq('draft_id', draftId)
  if (nominationSeq !== undefined) query = query.eq('nomination_seq', nominationSeq)
  const { data, error } = await query
    .order('created_at', { ascending: true })
    .order('amount', { ascending: true })
  throwIfError(error, 'read bid ledger')
  return (data ?? []) as never
}

/**
 * Build the L.C4.1 `AuctionDraftAudit` for ONE finished draft so the spec can
 * run `sweepAuctionAudit` VERBATIM — the invariant helpers are reused, never
 * re-derived (the task charter's own words). Mirrors the sim runner's
 * `collectAuctionAudit` read-for-read.
 */
export async function collectAuctionAudit(
  service: Supabase,
  input: { label: string; leagueId: string; draftId: string; teamCount: number; totalRounds: number },
): Promise<AuctionDraftAudit> {
  const { data: draftRow, error: draftError } = await service
    .from('drafts')
    .select('status, config, budget_adjustments, nomination_order')
    .eq('id', input.draftId)
    .single()
  throwIfError(draftError, 'audit draft read')
  const { data: picks, error: picksError } = await service
    .from('draft_picks')
    .select('pick_number, team_id, player_id, price, is_undone')
    .eq('draft_id', input.draftId)
    .order('pick_number')
  throwIfError(picksError, 'audit picks read')
  const { data: bids, error: bidsError } = await service
    .from('draft_bids')
    .select('nomination_seq, team_id, player_id, amount')
    .eq('draft_id', input.draftId)
    .order('created_at')
  throwIfError(bidsError, 'audit bids read')
  const { data: rosters, error: rostersError } = await service
    .from('league_rosters')
    .select('team_id, player_id')
    .eq('league_id', input.leagueId)
  throwIfError(rostersError, 'audit rosters read')
  const { data: league, error: leagueError } = await service
    .from('leagues')
    .select('status')
    .eq('id', input.leagueId)
    .single()
  throwIfError(leagueError, 'audit league read')
  const { data: teams, error: teamsError } = await service
    .from('teams')
    .select('id')
    .eq('league_id', input.leagueId)
    .neq('status', 'retired')
  throwIfError(teamsError, 'audit team read')

  const workerErrors: string[] = []
  const sqlBudgets: AuctionAuditBudget[] = []
  for (const t of teams ?? []) {
    const { data, error } = await service.rpc('draft_team_budget', {
      p_draft_id: input.draftId,
      p_team_id: t.id as string,
    })
    if (error) {
      workerErrors.push(`draft_team_budget(${t.id}) errored: ${error.message}`)
      continue
    }
    const row = (
      data as Array<{ remaining: number; open_slots: number; max_bid: number; committed: number }>
    )[0]
    if (row !== undefined) sqlBudgets.push({ team_id: t.id as string, ...row })
  }

  const knobs = auctionKnobsOf((draftRow!.config ?? {}) as never)
  return {
    leagueLabel: input.label,
    draftId: input.draftId,
    teamCount: input.teamCount,
    totalRounds: input.totalRounds,
    budget: knobs.auctionBudget,
    reserve: knobs.reserve,
    budgetAdjustments: (draftRow!.budget_adjustments ?? {}) as Record<string, number>,
    picks: (picks ?? []) as AuctionAuditPick[],
    bids: (bids ?? []) as AuctionAuditBid[],
    sqlBudgets,
    rosters: (rosters ?? []) as Array<{ team_id: string; player_id: string }>,
    nominationOrderPin: null,
    leagueStatus: league!.status as string,
    draftStatus: draftRow!.status as string,
    workerErrors,
  }
}

// ---------------------------------------------------------------------------
// Job 9 — in-season week driving at an injected `p_now` (D291)
// ---------------------------------------------------------------------------

/**
 * The shape every week job returns (`116:746-760`, `:924-939`, `:1310-1323`).
 * `reason` is how a job says NOTHING WAS DUE, which is a lawful answer and
 * the only thing that makes "0 opened" readable rather than silent (M4 rule
 * 10). Q37 note for callers: a HELD week is lawful — classify it by this
 * `reason`, never treat it as red.
 */
export interface JobReport {
  at: string
  scope: string
  leagues: number
  failures: number
  reason: string | null
  [key: string]: unknown
}

function jobReport(data: unknown, what: string): JobReport {
  if (data === null || typeof data !== 'object') {
    throw new Error(`${what}: the job returned no report document (got ${JSON.stringify(data)})`)
  }
  const report = data as JobReport
  if (report.failures !== undefined && Number(report.failures) > 0) {
    throw new Error(`${what}: the job reported ${report.failures} failure(s) — ${JSON.stringify(report)}`)
  }
  return report
}

/**
 * `league_week_advance` at an injected instant, run TWICE at the SAME
 * `p_now` — the second pass is the idempotence proof (M4 rule 10; the
 * recorded pattern at `scripts/dev-drive-inseason-week.ts:269-277`) and it
 * also picks up a build the first pass's claim order left for the next tick.
 * Always league-scoped: the unscoped hourly cron must never be what moved a
 * spec's league.
 *
 * THROWS when the first pass moved NOTHING (`opened` + `closed` + `carried`
 * all zero) — an advance that opened nothing is the caller's bug, not a
 * pass. `stageBidDeadline`'s shape, not `rewindDeadline`'s.
 */
export async function advanceWeekAt(
  service: Supabase,
  leagueId: string,
  pNow: string,
): Promise<{ first: JobReport; second: JobReport }> {
  const { data: firstData, error: firstError } = await service.rpc('league_week_advance', {
    p_now: pNow,
    p_league_id: leagueId,
  })
  throwIfError(firstError, 'harness league_week_advance')
  const first = jobReport(firstData, 'advanceWeekAt')
  const moved =
    Number(first.opened ?? 0) + Number(first.closed ?? 0) + Number(first.carried ?? 0)
  if (moved === 0) {
    throw new Error(
      `advanceWeekAt: league_week_advance at ${pNow} moved NOTHING for league ${leagueId} ` +
        `(opened 0, closed 0, carried 0; reason ${JSON.stringify(first.reason)}) — ` +
        'the caller expected a transition; report: ' +
        JSON.stringify(first),
    )
  }
  const { data: secondData, error: secondError } = await service.rpc('league_week_advance', {
    p_now: pNow,
    p_league_id: leagueId,
  })
  throwIfError(secondError, 'harness league_week_advance (idempotence pass)')
  const second = jobReport(secondData, 'advanceWeekAt (idempotence pass)')
  return { first, second }
}

/**
 * `finalize_matchups` at an injected instant. THROWS when it finalized
 * nothing — a finalize that flipped zero matchups reported as success is
 * exactly the "nothing happened means it worked" failure CLAUDE.md names.
 * The job's own `reason`/`skipped`/`live_past_window` counters travel in the
 * error so a HELD week (Q37 — lawful) is readable from the message.
 */
export async function finalizeWeekAt(
  service: Supabase,
  leagueId: string,
  pNow: string,
): Promise<JobReport> {
  const { data, error } = await service.rpc('finalize_matchups', {
    p_now: pNow,
    p_league_id: leagueId,
  })
  throwIfError(error, 'harness finalize_matchups')
  const report = jobReport(data, 'finalizeWeekAt')
  if (Number(report.finalized ?? 0) === 0) {
    throw new Error(
      `finalizeWeekAt: finalize_matchups at ${pNow} finalized NOTHING for league ${leagueId} — ` +
        `report: ${JSON.stringify(report)}`,
    )
  }
  return report
}

/**
 * `lineup_lock_tick` at an injected instant — the job that REFRESHES
 * `league_player_pool.locked_until` and stamps `team_lineups.locked_at`.
 * Returned, not asserted here: what a caller may assert about it is bounded
 * by Q40 (the countdown referent is OPEN — `locked_at` is a RECORD, not the
 * lock) and by E32's own row (`locked_until` is this job's VIEW, never the
 * decider). THROWS when the pass touched nothing at all.
 */
export async function lockTickAt(
  service: Supabase,
  leagueId: string,
  pNow: string,
): Promise<JobReport> {
  const { data, error } = await service.rpc('lineup_lock_tick', {
    p_now: pNow,
    p_league_id: leagueId,
  })
  throwIfError(error, 'harness lineup_lock_tick')
  const report = jobReport(data, 'lockTickAt')
  if (Number(report.leagues ?? 0) === 0) {
    throw new Error(
      `lockTickAt: lineup_lock_tick at ${pNow} matched NO league for ${leagueId} ` +
        `(reason ${JSON.stringify(report.reason)}) — report: ${JSON.stringify(report)}`,
    )
  }
  return report
}

export interface NflWeekInstants {
  week: number
  starts_at: string
  last_game_ends_at: string | null
  correction_window_ends_at: string
}

/** The synthetic calendar's STORED literals for one week — every `p_now` a
 *  spec injects is derived from these, never from the wall clock. */
export async function nflWeekInstants(service: Supabase, week: number): Promise<NflWeekInstants> {
  const { data, error } = await service
    .from('nfl_weeks')
    .select('week, starts_at, last_game_ends_at, correction_window_ends_at')
    .eq('season', SYNTHETIC_SEASON)
    .eq('week', week)
    .single()
  throwIfError(error, 'read nfl_weeks instants')
  if (!data) {
    throw new Error(
      `nflWeekInstants: season ${SYNTHETIC_SEASON} has no week ${week} row — the synthetic calendar is not seeded`,
    )
  }
  if (!data.correction_window_ends_at) {
    throw new Error(
      `nflWeekInstants: season ${SYNTHETIC_SEASON} week ${week} has no correction_window_ends_at — ` +
        'the synthetic calendar is not seeded (seedSyntheticSeason runs in provisionLeague)',
    )
  }
  return data as NflWeekInstants
}

/** `nfl_weeks.last_game_ends_at` — the datum `league_week_advance` reads to
 *  close a live week, and E32's release instant. THROWS on 0 rows. */
export async function recordWeekEnd(
  service: Supabase,
  week: number,
  lastEndIso: string,
): Promise<void> {
  const { data, error } = await service
    .from('nfl_weeks')
    .update({ last_game_ends_at: lastEndIso })
    .eq('season', SYNTHETIC_SEASON)
    .eq('week', week)
    .select('week')
  throwIfError(error, 'harness nfl_weeks last_game_ends_at')
  if ((data ?? []).length !== 1) {
    throw new Error(
      `recordWeekEnd: writing last_game_ends_at on season ${SYNTHETIC_SEASON} week ${week} ` +
        `matched ${(data ?? []).length} rows, expected 1 — the week is not on the calendar`,
    )
  }
  seasonFixtures.boundedWeeks.add(week)
}

export interface PlantedGame {
  /** Suffix appended to `E2E_SEASON_GAME_PREFIX` — keep it spec-unique. */
  suffix: string
  week: number
  homeTeam: string
  awayTeam: string
  kickoffAt: string
  status: 'scheduled' | 'live' | 'final'
}

/**
 * Plant ONE `nfl_games` row, ledgered for the sweep.
 *
 * Why any spec must: `week_games_state_internal` refuses to finalize a week
 * with ZERO in-week game rows and requires every one of them `final`
 * (`116:317-358`) — zero rows is never finalizable. Consequence a caller
 * must design around, never improvise past: once ANY row exists for the
 * week, `lineup_kickoff_internal`'s week-datum fallback stops applying and
 * every club WITHOUT a row reads `on_bye` (`112:397-425`).
 */
export async function plantGameRow(service: Supabase, game: PlantedGame): Promise<string> {
  const id = `${E2E_SEASON_GAME_PREFIX}${game.suffix}`
  const { data, error } = await service
    .from('nfl_games')
    .upsert({
      id,
      season: SYNTHETIC_SEASON,
      week: game.week,
      home_team: game.homeTeam,
      away_team: game.awayTeam,
      kickoff_at: game.kickoffAt,
      status: game.status,
    })
    .select('id')
  throwIfError(error, 'harness nfl_games upsert')
  if ((data ?? []).length !== 1) {
    throw new Error(`plantGameRow: upsert of ${id} wrote ${(data ?? []).length} rows, expected 1`)
  }
  seasonFixtures.gameIds.add(id)
  return id
}

/** Flip every in-week game to `final` — the state
 *  `week_games_state_internal` requires before a week may finalize.
 *  Returns the row count; THROWS on 0 (a week with no games never
 *  finalizes, and pretending otherwise hides the reason). */
export async function setInWeekGamesFinal(service: Supabase, week: number): Promise<number> {
  const { data, error } = await service
    .from('nfl_games')
    .update({ status: 'final' })
    .eq('season', SYNTHETIC_SEASON)
    .eq('week', week)
    .select('id')
  throwIfError(error, 'harness nfl_games final')
  const rows = (data ?? []).length
  if (rows === 0) {
    throw new Error(
      `setInWeekGamesFinal: season ${SYNTHETIC_SEASON} week ${week} has NO game rows to finalize — ` +
        'plant one first (week_games_state_internal never finalizes a week with zero games)',
    )
  }
  return rows
}

/** One planted weekly stat line. The keys are `player_stats` columns; the
 *  worker reads them through the league's FROZEN scoring snapshot (rule 9),
 *  so nothing here decides a point value. */
export interface StatLine {
  player_id: string
  pass_yards?: number
  pass_tds?: number
  interceptions?: number
  rush_yards?: number
  rush_tds?: number
  receptions?: number
  receiving_yards?: number
  receiving_tds?: number
  fumbles_lost?: number
}

/**
 * Upsert `player_stats` + enqueue `score_fanout` for one week — the
 * ingestion half of §23.2, exactly as `dev-drive-inseason-week.ts:159-189`
 * writes it (`onConflict 'player_id,season,week'` and `'season,week,player_id'`,
 * `ignoreDuplicates:false` so a re-plant really does re-enqueue). Both
 * tables are service-role only (`score_fanout` has RLS on with zero
 * policies, `109:294-308`).
 *
 * THROWS unless BOTH writes touched every line handed in.
 */
export async function plantStatLines(
  service: Supabase,
  week: number,
  lines: readonly StatLine[],
): Promise<{ stats: number; queued: number }> {
  if (lines.length === 0) {
    throw new Error('plantStatLines: called with no lines — a plant that plants nothing is a caller bug')
  }
  const stamp = systemTime.now().toISOString()
  const { data: stats, error: statsError } = await service
    .from('player_stats')
    .upsert(
      lines.map((line) => ({
        ...line,
        season: SYNTHETIC_SEASON,
        week,
        stat_type: 'weekly',
        updated_at: stamp,
        advanced: {},
      })),
      { onConflict: 'player_id,season,week' },
    )
    .select('player_id')
  throwIfError(statsError, 'harness player_stats upsert')
  if ((stats ?? []).length !== lines.length) {
    throw new Error(
      `plantStatLines: player_stats upsert wrote ${(stats ?? []).length} of ${lines.length} rows`,
    )
  }
  const { data: queued, error: queueError } = await service
    .from('score_fanout')
    .upsert(
      lines.map((line) => ({
        season: SYNTHETIC_SEASON,
        week,
        player_id: line.player_id,
        enqueued_at: stamp,
        deferred_until: null,
      })),
      { onConflict: 'season,week,player_id', ignoreDuplicates: false },
    )
    .select('player_id')
  throwIfError(queueError, 'harness score_fanout enqueue')
  if ((queued ?? []).length !== lines.length) {
    throw new Error(
      `plantStatLines: score_fanout enqueue wrote ${(queued ?? []).length} of ${lines.length} rows`,
    )
  }
  for (const line of lines) seasonFixtures.statTuples.add(tupleKey(week, line.player_id))
  return { stats: (stats ?? []).length, queued: (queued ?? []).length }
}

/**
 * Run the PRODUCTION scorer over the queue, scoped to ONE league through
 * `runScoreWeekBatch`'s own documented stack-lane seam (`opts.leagueIds`,
 * `score-week-worker.ts:496-502`): only those leagues are scored and a queue
 * row is consumed only if it maps to one of them, so a foreign suite's
 * queue rows are neither scored nor eaten.
 *
 * This is the ONLY thing in the harness that writes a matchup score. THROWS
 * when the worker reports problems, and when it drained nothing — an empty
 * drain after a plant means the enqueue never reached this league.
 */
export async function driveScoreBatch(service: Supabase, leagueId: string): Promise<BatchReport> {
  const report = await runScoreWeekBatch(
    { time: systemTime, db: service },
    { batchSize: 1000, leagueIds: [leagueId] },
  )
  if (report.problems.length > 0) {
    throw new Error(
      `driveScoreBatch: the worker reported ${report.problems.length} problem(s) — ` +
        JSON.stringify(report.problems),
    )
  }
  if (report.drained === 0) {
    throw new Error(
      `driveScoreBatch: the worker drained 0 queue rows for league ${leagueId} — ` +
        'nothing was enqueued for it, so no score could have moved (report: ' +
        `${JSON.stringify({ drained: report.drained, leagues: report.leagues, written: report.written })})`,
    )
  }
  return report
}

/**
 * Write a team-week lineup DIRECTLY (`onConflict 'team_id,season,week'`) —
 * the dev driver's own move (`dev-drive-inseason-week.ts:121-144`) and the
 * only way to seat a lineup on a week that already carries a past kickoff,
 * because `set_lineup`'s public wrapper passes the transaction's `now()` and
 * accepts NO caller clock (`112:1234`).
 *
 * Setup lineups ride this; the ONE lineup a spec actually asserts rides the
 * browser and the real RPC. THROWS on anything but exactly one row.
 */
export async function upsertLineupRow(
  service: Supabase,
  teamId: string,
  week: number,
  slotMap: Record<string, string>,
): Promise<void> {
  if (Object.keys(slotMap).length === 0) {
    throw new Error(`upsertLineupRow: empty slot_map for team ${teamId} week ${week} — seats nobody`)
  }
  const { data, error } = await service
    .from('team_lineups')
    .upsert(
      { team_id: teamId, season: SYNTHETIC_SEASON, week, starters: [], bench: [], slot_map: slotMap },
      { onConflict: 'team_id,season,week' },
    )
    .select('id')
  throwIfError(error, 'harness team_lineups upsert')
  if ((data ?? []).length !== 1) {
    throw new Error(
      `upsertLineupRow: team ${teamId} week ${week} wrote ${(data ?? []).length} rows, expected 1`,
    )
  }
}

/**
 * Poll `check` on a fixed pace until it holds, or THROW naming what was last
 * seen. The e2e lane had no shared waiter — `auction-live.spec.ts:69-118`
 * owns two private `for(;;)` pollers and `expect.poll` appears nowhere — and
 * three in-season specs need the same one (a week reaching a status, a score
 * landing, a badge flipping). Paced, never a busy loop.
 */
export async function waitFor<T>(
  what: string,
  check: () => Promise<{ ok: boolean; seen: T }>,
  opts: { timeoutMs?: number; paceMs?: number } = {},
): Promise<T> {
  const timeout = opts.timeoutMs ?? 30_000
  const pace = opts.paceMs ?? 500
  const deadline = Date.now() + timeout
  let last: T | undefined
  for (;;) {
    const result = await check()
    last = result.seen
    if (result.ok) return result.seen
    if (Date.now() >= deadline) {
      throw new Error(`waitFor(${what}) timed out after ${timeout}ms — last seen: ${JSON.stringify(last)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, pace))
  }
}
