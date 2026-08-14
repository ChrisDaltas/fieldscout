import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { E2E_LEAGUE_PREFIX, LOCAL_ANON_KEY, LOCAL_SERVICE_ROLE_KEY, LOCAL_URL } from './local-env'

type Supabase = SupabaseClient<Database>

/**
 * SERVICE-ROLE HARNESS CLIENT — M2 task L.B5.1 (the D100/L.B6.1 confinement
 * doctrine, recorded; enumeration made literally true per R296, the R290
 * precedent): the service CLIENT is constructed ONLY in this file — the key
 * CONSTANT lives in local-env.ts, and playwright.config.ts also injects it
 * into the app server's process env (the webServer's own admin client) —
 * and the client does exactly FIVE jobs, nothing else:
 *
 *   1. the E2E-prefix fixture-cleanup sweep (start-stale + per-spec finally,
 *      loud + byte-clean-verified — the R285 class; delete order mirrors the
 *      sim's cleanupSweep);
 *   2. deadline REWINDS for placeholder-seat picks (an UPDATE writing a
 *      past `current_deadline`, `.eq('status','live')`-conditional — the
 *      F52 draft-tick lesson: the harness must never mutate a draft the
 *      engine has finished) + direct `draft_tick()` invocation (the RPC is
 *      REVOKEd from authenticated — cron/service only; driving it directly
 *      instead of waiting on the live 5s cron is the F52 sibling-wait
 *      lesson);
 *   3. the zero-league-writes snapshot/diff for the mock spec — the pgTAP
 *      025 §F diff's E2E twin (same table list, same leagues-row
 *      byte-identity);
 *   4. small authoritative post-hoc reads the specs assert on (league
 *      status, roster counts, pick sheets, pool size);
 *   5. the journey spec's F49 season-year bump (L.B7.1): the settings UI's
 *      schedule picker pins year = the league's SEASON, so a UI-set instant
 *      on a 2026-season league is live-cron auto-start bait from its own
 *      date — bumping the created league's season server-side BEFORE the
 *      schedule step keeps the picker interaction identical while the
 *      stored instant lands far-future (the F49 row's "season-year bump"
 *      arm; non-literal by construction — year follows the season).
 *
 * Everything the USER does in a spec rides the browser or a seed-user's own
 * authed anon-key client (provision.ts) — production RPCs never accept a
 * caller clock (D100); the rewind IS the virtual-time mechanism.
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
 * Sweep every E2E-prefixed league graph (drafts → teams → leagues, the sim
 * order — everything else cascades from those) and VERIFY zero remain.
 * Runs at spec start (a crashed prior run must never poison this one) and
 * in every spec's finally. Seed users are never deleted — they are the
 * stack's own fixtures.
 */
export async function cleanupSweep(service: Supabase): Promise<string> {
  const { data: stale, error: staleError } = await service
    .from('leagues')
    .select('id')
    .like('name', `${E2E_LEAGUE_PREFIX}%`)
  throwIfError(staleError, 'cleanup: e2e-league lookup')
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    const { error: draftsError } = await service.from('drafts').delete().in('league_id', ids)
    throwIfError(draftsError, 'cleanup: drafts delete')
    const { error: teamsError } = await service.from('teams').delete().in('league_id', ids)
    throwIfError(teamsError, 'cleanup: teams delete')
    const { error: leaguesError } = await service.from('leagues').delete().in('id', ids)
    throwIfError(leaguesError, 'cleanup: leagues delete')
  }
  const { count, error: verifyError } = await service
    .from('leagues')
    .select('id', { count: 'exact', head: true })
    .like('name', `${E2E_LEAGUE_PREFIX}%`)
  throwIfError(verifyError, 'cleanup: verification')
  if ((count ?? -1) !== 0) {
    throw new Error(`cleanup: stack NOT clean — ${count} e2e leagues remain`)
  }
  return `CLEANUP: swept ${ids.length} e2e league(s) — 0 remain`
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
