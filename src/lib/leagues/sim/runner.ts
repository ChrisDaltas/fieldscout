/**
 * The League Simulator runner — M2 task L.B6.1 (delivery plan §4.2; spec
 * §22.1/§22.3; tasks-M2 §5 sketch + §6 L.B6.1; D100).
 *
 * WHAT IT DRIVES (D100 — the service layer, never direct DB writes):
 * every bot is a per-user AUTHED supabase-js client driving the SAME
 * service functions the Route Handlers wrap — `createLeague`,
 * `createInvite`/`claimInvite`, `addPlaceholderSeat`, `patchLeague`,
 * `createDraft`/`startDraft` (L.B2.1) and `makePick`/`upsertQueue`
 * (L.B2.2) — so a sim pick travels the identical RPC path a user's click
 * does (the Next cookie layer is the only plumbing skipped, the
 * D68(6)/M1-gate precedent). Reads are the D92 pattern: RLS-scoped
 * SELECTs under each bot's own JWT.
 *
 * SERVICE-ROLE HARNESS CLIENT (harness-only, recorded): exactly five jobs —
 *   1. bot-user provisioning/teardown (auth admin);
 *   2. deadline REWINDS for timeout scenarios (`current_deadline`
 *      subtraction from the SERVER-written value, `status='live'`-
 *      conditional — the F52 draft-tick lesson: the harness must never
 *      mutate a draft the engine has finished);
 *   3. direct `draft_tick()` invocation after a rewind (the RPC is
 *      REVOKEd from authenticated — cron/service only; driving it
 *      directly instead of waiting on the live 5s cron is the F52
 *      sibling-wait lesson);
 *   4. the post-run audit reads the invariant sweep consumes;
 *   5. the R285-loud fixture-cleanup sweep (start + finally: sim-league
 *      graph DELETEs + byte-clean verification) — teardown's data half,
 *      enumerated here since R290: an unenumerated service write is how
 *      scope creep starts. Every OTHER read rides a member's own JWT —
 *      including the scoring-template lookup (a bot client reads it;
 *      templates are viewable by everyone, 058).
 * Production RPCs never accept a caller clock (D100) — the rewind IS the
 * virtual-time mechanism.
 *
 * DETERMINISM (plan principle 4; the ESLint guard is in force here): all
 * wall time flows through the injected `SimClock`; all entropy through
 * per-league child streams of the seed (`deriveStream` — replay-stable
 * under concurrency). `--seed K` reproduces the plan and every persona
 * decision exactly; what a re-run cannot pin byte-for-byte is race
 * RESOLUTION (which of two chaos double-taps wins is the system under
 * test), which is why the invariant sweep — not a board transcript — is
 * the gate's assertion surface.
 *
 * PACING (recorded — the D118(9) polite-neighbor precedent): all 25
 * leagues draft CONCURRENTLY (the gate's word), but every HTTP call rides
 * one global semaphore (default width 16) so in-flight requests against
 * local PostgREST/GoTrue stay bounded; the pg_cron 5s tick remains a
 * LEGAL concurrent actor throughout (assertions are on converged DB
 * state, the draft-tick-db precedent).
 *
 * CLEANUP (loud — the R285 class): every fixture write/read throws
 * through `throwIfError`; the run sweeps by the SIM name/username
 * prefixes at start (stale crashed-run state) and in a `finally` at end,
 * then VERIFIES 0 sim leagues + 0 sim profiles remain. The sim seeds NO
 * players — bots draft the REAL local pool (the R286 lesson: no fixture
 * ADP band exists that cannot poison a co-scheduled walk; the real pool
 * is the one every suite already shares).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { claimInvite, createInvite } from '../api/invites-service'
import { createLeague, patchLeague } from '../api/leagues-service'
import { addPlaceholderSeat } from '../api/members-service'
import { createDraft, makePick, startDraft, upsertQueue } from '../api/draft-service'
import { defaultsForTeamCount } from '../settings/league-settings'
import type { RosterSettings } from '../settings/league-settings'

import { decidePick, desiredQueue, type PickContext } from './personas'
import {
  duplicateQueueRanks,
  isStuckClock,
  sweepAudit,
  type AuditPick,
  type DraftAudit,
} from './invariants'
import { buildRunPlan, planLines, SIM_LEAGUE_PREFIX } from './plan'
import type { BuildPlanInput } from './plan'
import { deriveStream, uuidFromRng } from './sim-rng'
import type {
  InvariantFailure,
  LeaguePlan,
  LeagueResult,
  PersonaKind,
  RunReport,
  SimClock,
} from './sim-types'

type Supabase = SupabaseClient<Database>

// ---------------------------------------------------------------------------
// Config + deps
// ---------------------------------------------------------------------------

export interface SimRunConfig extends BuildPlanInput {
  /** Global HTTP semaphore width (recorded pacing choice). */
  concurrency?: number
  verbose?: boolean
}

export interface SimRunDeps {
  clock: SimClock
  /** Uniquifies this run's action-id streams + league names (CLI-supplied —
   *  see sim-rng.ts on why action_ids are per-run nonces). */
  runTag: string
  log: (line: string) => void
  url: string
  anonKey: string
  serviceRoleKey: string
}

/** Sim fixture identity prefixes (cleanup sweeps by these; unique in the
 *  repo — checked against the D108(14) registry's naming space). */
export const SIM_USERNAME_PREFIX = 'sim_b6_bot_'
const SIM_EMAIL_DOMAIN = 'fieldscout.test'
const SIM_PASSWORD = 'sim-b6-pass-1234'

/** Far-future schedule instant — the D94 auto-start arm must never race the
 *  manual start path (the F49 fixture-instant discipline: 2028, not 2026). */
const DRAFT_INSTANT = '2028-09-01T17:00:00+00:00'
const GRACE_SECONDS = 30

/** Bounded ADP pool window per league (the bots' pool view — mirrors 068's
 *  `ORDER BY adp NULLS LAST` walk head; big enough for the deepest board:
 *  16 × 4 = 64 picks). */
const POOL_WINDOW = 400

/** Transport-only retry budget for reads (D118(9): infra hiccups must not
 *  wear a product failure's name; refusals NEVER retry). */
const READ_RETRIES = 3

const MAX_F54_INCIDENTS = 5

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function throwIfError(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what} failed: ${error.message}`)
}

/** One global semaphore for every HTTP call the runner makes. */
function makeLimiter(width: number): <T>(fn: () => PromiseLike<T>) => Promise<T> {
  let active = 0
  const waiters: Array<() => void> = []
  const acquire = async (): Promise<void> => {
    if (active < width) {
      active += 1
      return
    }
    await new Promise<void>((resolve) => waiters.push(resolve))
    active += 1
  }
  const release = (): void => {
    active -= 1
    waiters.shift()?.()
  }
  return async <T>(fn: () => PromiseLike<T>): Promise<T> => {
    await acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

/** Compact roster presets by draftable-round count (D91: starters + bench). */
export function rosterForRounds(rounds: number): RosterSettings {
  const slots = [
    { key: 'qb', label: 'QB', eligible: ['QB'], count: 1 },
    { key: 'rb', label: 'RB', eligible: ['RB'], count: 1 },
    { key: 'wr', label: 'WR', eligible: ['WR'], count: 1 },
  ]
  const starters = Math.max(1, rounds - 1)
  return {
    starting_slots: slots.slice(-starters).slice(0, starters) as RosterSettings['starting_slots'],
    bench: rounds - starters,
    ir_slots: [],
    swap_spots: 0,
  }
}

interface BotUser {
  index: number
  userId: string
  username: string
  client: Supabase
}

interface SeatInfo {
  teamId: string
  kind: 'human' | 'placeholder'
  botIndex?: number
  persona?: PersonaKind
}

interface DraftRowView {
  status: string
  current_pick_number: number | null
  on_clock_team_id: string | null
  current_deadline: string | null
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

export async function runDraftSim(cfg: SimRunConfig, deps: SimRunDeps): Promise<RunReport> {
  const { clock, log } = deps
  const limit = makeLimiter(cfg.concurrency ?? 16)
  const plan = buildRunPlan(cfg)

  const service = createClient<Database>(deps.url, deps.serviceRoleKey, {
    auth: { persistSession: false },
  })

  const report: RunReport = {
    seed: cfg.seed,
    planLines: planLines(plan),
    leagues: [],
    invariantFailures: [],
    f54Incidents: [],
    f54Total: 0,
    expectedRefusals: 0,
    replayVerified: 0,
    workerErrors: [],
    cleanupSummary: '',
    green: false,
  }

  log(`SIM SEED: ${cfg.seed}`)
  log(
    `REPLAY: npm run sim -- draft --leagues ${cfg.leagues}` +
      `${cfg.teams === 'mixed' ? '' : ` --teams ${cfg.teams}`} --clock ${cfg.clockSeconds} --seed ${cfg.seed}`,
  )
  log(`MATRIX (${plan.leagues.length} leagues):`)
  for (const line of report.planLines) log(`  ${line}`)

  // ---- Stale sweep (a crashed prior run must never poison this one) ------
  await cleanupSweep(service, log)

  // ---- Bot pool ----------------------------------------------------------
  const bots: BotUser[] = []
  try {
    for (let i = 0; i < plan.botCount; i++) {
      const username = `${SIM_USERNAME_PREFIX}${String(i + 1).padStart(2, '0')}`
      const email = `sim-b6-bot-${String(i + 1).padStart(2, '0')}@${SIM_EMAIL_DOMAIN}`
      const { data: created, error: createError } = await limit(() =>
        service.auth.admin.createUser({
          email,
          password: SIM_PASSWORD,
          email_confirm: true,
          user_metadata: { username },
        }),
      )
      if (createError) throw new Error(`bot createUser ${username} failed: ${createError.message}`)
      const client = createClient<Database>(deps.url, deps.anonKey, {
        auth: { persistSession: false },
      })
      const { error: signInError } = await limit(() =>
        client.auth.signInWithPassword({ email, password: SIM_PASSWORD }),
      )
      if (signInError) throw new Error(`bot sign-in ${username} failed: ${signInError.message}`)
      bots.push({ index: i, userId: created.user.id, username, client })
    }
    log(`BOTS: ${bots.length} pool users provisioned + signed in`)

    // Scoring template — read through a BOT's own authed client (templates
    // are viewable by everyone, 058), one call for the whole run: the
    // service-role client does the five recorded harness jobs and nothing
    // else (R290).
    const { data: template, error: templateError } = await limit(() =>
      bots[0]!.client
        .from('scoring_systems')
        .select('id')
        .eq('is_template', true)
        .eq('name', 'ESPN Standard')
        .single(),
    )
    throwIfError(templateError, 'scoring-template lookup')
    const scoringSystemId = template!.id

    // ---- Drive every league CONCURRENTLY ---------------------------------
    // allSettled so one league's provisioning failure cannot orphan its
    // siblings mid-flight (the cleanup below must run after ALL loops end).
    const settled = await Promise.allSettled(
      plan.leagues.map((leaguePlan) =>
        driveLeague({
          plan: leaguePlan,
          clockSeconds: cfg.clockSeconds,
          seed: cfg.seed,
          runTag: deps.runTag,
          bots,
          service,
          scoringSystemId,
          limit,
          clock,
          log,
          verbose: cfg.verbose ?? false,
          report,
        }),
      ),
    )
    settled.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        report.leagues.push(outcome.value)
        report.invariantFailures.push(...outcome.value.failures)
      } else {
        const detail = (outcome.reason as Error)?.message ?? String(outcome.reason)
        report.invariantFailures.push({
          invariant: 'provisioning',
          leagueLabel: plan.leagues[i]!.name,
          draftId: '(none)',
          detail,
        })
        log(`${plan.leagues[i]!.name}: FAILED — ${detail}`)
      }
    })
  } finally {
    // ---- Loud cleanup + byte-clean verification --------------------------
    try {
      report.cleanupSummary = await cleanupSweep(service, log)
    } catch (cleanupError) {
      report.cleanupSummary = `CLEANUP FAILED: ${(cleanupError as Error).message}`
      report.invariantFailures.push({
        invariant: 'cleanup',
        leagueLabel: '(run)',
        draftId: '(run)',
        detail: (cleanupError as Error).message,
      })
      log(report.cleanupSummary)
    }
  }

  report.green = report.invariantFailures.length === 0
  return report
}

// ---------------------------------------------------------------------------
// One league end-to-end
// ---------------------------------------------------------------------------

interface DriveLeagueArgs {
  plan: LeaguePlan
  clockSeconds: number
  seed: number
  runTag: string
  bots: BotUser[]
  service: Supabase
  scoringSystemId: string
  limit: <T>(fn: () => PromiseLike<T>) => Promise<T>
  clock: SimClock
  log: (line: string) => void
  verbose: boolean
  report: RunReport
}

async function driveLeague(args: DriveLeagueArgs): Promise<LeagueResult> {
  const { plan, bots, limit, clock, log, report } = args
  const label = plan.name
  const startedAt = clock.nowMs()
  const failures: InvariantFailure[] = []
  const workerErrors: string[] = []
  const decisionRng = deriveStream(args.seed, `decisions:${plan.index}`)
  // Action-ids are salted with the run tag (per-run nonces — sim-rng.ts).
  const actionRng = deriveStream(args.seed, `actions:${plan.index}:${args.runTag}`)

  const commish = bots[plan.humanSeats[0]!.botIndex]!

  // ---- Provision (real create → invite/claim → schedule → start) ---------
  const settings = defaultsForTeamCount(plan.teamCount)
  const configured = {
    ...settings,
    roster_settings: rosterForRounds(plan.rounds),
    draft: {
      ...settings.draft,
      draft_type: 'snake' as const,
      snake_reversal: plan.snakeReversal,
      draft_order_mode: 'random' as const,
      pick_timer_seconds: args.clockSeconds as (typeof settings.draft)['pick_timer_seconds'],
      disconnect_grace_seconds: GRACE_SECONDS,
      draft_scheduled_at: DRAFT_INSTANT,
    },
  }
  const created = await limit(() =>
    createLeague(commish.client, {
      name: plan.name,
      season: 2026,
      scoring_system_id: args.scoringSystemId,
      team_name: `${label} T1`,
      action_id: uuidFromRng(actionRng),
      settings: configured,
    }),
  )
  if (created.status !== 201) {
    throw new Error(`${label}: createLeague failed (${created.status}): ${JSON.stringify(created.body)}`)
  }
  const leagueId = (created.body as { league_id: string }).league_id

  // Seat the other humans through the REAL invite/claim path.
  const botTeamIds = new Map<number, string>() // botIndex → teamId
  for (const seat of plan.humanSeats.slice(1)) {
    const bot = bots[seat.botIndex]!
    const invite = await limit(() => createInvite(commish.client, leagueId, {}))
    if (invite.status !== 201 && invite.status !== 200) {
      throw new Error(`${label}: createInvite failed (${invite.status}): ${JSON.stringify(invite.body)}`)
    }
    const token = (invite.body as { token: string }).token
    const claim = await limit(() => claimInvite(bot.client, { token }))
    if (claim.status !== 200) {
      throw new Error(`${label}: claimInvite (${bot.username}) failed (${claim.status}): ${JSON.stringify(claim.body)}`)
    }
    botTeamIds.set(seat.botIndex, (claim.body as { team_id: string }).team_id)
  }

  // Placeholder seats (no user — E48 autopilot; the D96 capacity remedy).
  for (let i = 0; i < plan.placeholderCount; i++) {
    const filled = await limit(() => addPlaceholderSeat(commish.client, leagueId, {}))
    if (filled.status !== 201) {
      throw new Error(`${label}: addPlaceholderSeat failed (${filled.status}): ${JSON.stringify(filled.body)}`)
    }
  }

  // The commissioner's own franchise (create_league seats exactly one).
  {
    const { data: memberRow, error } = await limit(() =>
      commish.client
        .from('league_members')
        .select('team_id')
        .eq('league_id', leagueId)
        .eq('user_id', commish.userId)
        .single(),
    )
    throwIfError(error, `${label}: commissioner membership read`)
    botTeamIds.set(commish.index, memberRow!.team_id as string)
  }

  const scheduled = await limit(() => patchLeague(commish.client, leagueId, { status: 'scheduled' }))
  if (scheduled.status !== 200) {
    throw new Error(`${label}: scheduled PATCH failed (${scheduled.status}): ${JSON.stringify(scheduled.body)}`)
  }
  const draftCreated = await limit(() => createDraft(commish.client, leagueId))
  if (draftCreated.status !== 201 && draftCreated.status !== 200) {
    throw new Error(`${label}: createDraft failed (${draftCreated.status}): ${JSON.stringify(draftCreated.body)}`)
  }
  const started = await limit(() => startDraft(commish.client, leagueId))
  if (started.status !== 200) {
    throw new Error(`${label}: startDraft failed (${started.status}): ${JSON.stringify(started.body)}`)
  }
  const startedDraft = (started.body as {
    draft: { id: string; draft_order: string[]; total_rounds: number }
  }).draft
  const draftId = startedDraft.id
  const draftOrder = startedDraft.draft_order
  const totalRounds = startedDraft.total_rounds
  const totalPicks = plan.teamCount * totalRounds

  // Seat map: order ids → human bot / placeholder.
  const seatByTeam = new Map<string, SeatInfo>()
  const teamByBot = new Map<string, number>()
  for (const [botIndex, teamId] of botTeamIds) teamByBot.set(teamId, botIndex)
  const personaByBot = new Map<number, PersonaKind>()
  for (const seat of plan.humanSeats) personaByBot.set(seat.botIndex, seat.persona)
  for (const teamId of draftOrder) {
    const botIndex = teamByBot.get(teamId)
    if (botIndex !== undefined) {
      seatByTeam.set(teamId, {
        teamId,
        kind: 'human',
        botIndex,
        persona: personaByBot.get(botIndex),
      })
    } else {
      seatByTeam.set(teamId, { teamId, kind: 'placeholder' })
    }
  }

  // The league's pool view: real players, ADP ascending (068's walk head).
  const { data: poolRows, error: poolError } = await limit(() =>
    commish.client
      .from('players')
      .select('id, adp')
      .order('adp', { ascending: true, nullsFirst: false })
      .limit(POOL_WINDOW),
  )
  throwIfError(poolError, `${label}: pool read`)
  const poolByAdp = (poolRows ?? []).map((p) => p.id as string)

  if (args.verbose) log(`${label}: live — ${plan.teamCount} × ${totalRounds} = ${totalPicks} picks`)

  // ---- The draft loop ----------------------------------------------------
  // All loop reads under the commissioner bot's OWN JWT (a member's RLS
  // SELECT — the D92 pattern; service-role stays harness-only).
  const reader = commish.client
  const drafted = new Set<string>()
  let lastProgress = { pickNumber: 0, atMs: clock.nowMs() }
  let stuck = false
  const maxIterations = totalPicks * 12 + 100

  for (let iter = 0; iter < maxIterations; iter++) {
    const row = await readDraftRow(args, reader, draftId)
    if (row === null) continue // transport retry exhausted → next iteration
    if (row.status === 'complete') break
    if (row.status !== 'live') {
      // paused/scheduled should be unreachable (no commissioner controls in
      // this sim) — record loudly rather than spin silently.
      workerErrors.push(`${label}: draft status '${row.status}' mid-run`)
      break
    }

    const pickNumber = row.current_pick_number ?? 0
    if (pickNumber > lastProgress.pickNumber) {
      lastProgress = { pickNumber, atMs: clock.nowMs() }
      // Refresh the drafted set from the wire every advance (covers cron
      // autopicks the loop didn't make itself).
      const picks = await readPicks(args, reader, draftId)
      if (picks !== null) {
        drafted.clear()
        for (const p of picks) drafted.add(p.player_id)
      }
    }

    const seat = row.on_clock_team_id ? seatByTeam.get(row.on_clock_team_id) : undefined
    const persona = seat?.kind === 'human' ? seat.persona : undefined

    // Stuck-clock watchdog (grace-aware — D102): humans get the grace
    // allowance, autodraft/no-user seats none.
    const allowanceMs = seat?.kind === 'human' ? GRACE_SECONDS * 1000 : 0
    const deadlineMs = row.current_deadline === null ? null : Date.parse(row.current_deadline)
    if (
      isStuckClock({
        deadlineMs,
        allowanceMs,
        lastProgressMs: lastProgress.atMs,
        nowMs: clock.nowMs(),
      })
    ) {
      // One direct tick, one re-check — then declare it.
      await tickOnce(args, workerErrors)
      const recheck = await readDraftRow(args, reader, draftId)
      if (
        recheck !== null &&
        recheck.status === 'live' &&
        (recheck.current_pick_number ?? 0) === pickNumber
      ) {
        failures.push({
          invariant: 'stuck-clock',
          leagueLabel: label,
          draftId,
          detail: `pick ${pickNumber} stuck past deadline+${allowanceMs / 1000}s+tick+ε (seat ${row.on_clock_team_id})`,
        })
        stuck = true
        break
      }
      continue
    }

    if (seat === undefined) {
      await clock.sleep(120)
      continue
    }

    if (seat.kind === 'placeholder' || persona === 'afk' || persona === undefined) {
      // The timeout path: rewind the SERVER-written deadline past
      // deadline + grace, then drive the tick directly (F52 lesson).
      // COVERAGE MAP, honestly (R292): because every rewindAndTick
      // refreshes lastProgress (the D123(8) max-arm — a rewind must not
      // read as stuck), the stuck-clock watchdog can NEVER fire while one
      // of these seats is on the clock. A stuck engine here still fails
      // the run — loudly but later: the loop exhausts its iteration cap
      // ('loop-exhausted') and the end sweep's board-complete names the
      // draft. Bounded, not silent; the watchdog's live coverage is the
      // manual-persona turns.
      await rewindAndTick(args, draftId, args.clockSeconds + GRACE_SECONDS + 60, workerErrors)
      lastProgress = { pickNumber: lastProgress.pickNumber, atMs: clock.nowMs() }
      await clock.sleep(60)
      continue
    }

    // A manual persona is on the clock.
    const bot = bots[seat.botIndex!]!
    const available = poolByAdp.filter((id) => !drafted.has(id))
    const ownQueue = await readOwnQueue(args, bot.client, draftId, seat.teamId)
    const ctx: PickContext = {
      availableByAdp: available,
      queue: (ownQueue ?? []).map((q) => q.player_id).filter((id) => !drafted.has(id)),
    }

    // Queue maintenance first (real route; chaos double-taps it — F54).
    const queuePlan = desiredQueue(persona, ctx, decisionRng)
    if (queuePlan !== null && queuePlan.players.length > 0) {
      if (queuePlan.concurrentAlternate !== null) {
        await chaosQueueDoubleTap(args, bot, leagueId, draftId, seat.teamId, queuePlan.players, queuePlan.concurrentAlternate, label, workerErrors)
      } else {
        const saved = await limit(() =>
          upsertQueue(bot.client, leagueId, bot.userId, {
            draft_id: draftId,
            players: queuePlan.players,
          }),
        )
        if (saved.status !== 200) {
          workerErrors.push(`${label}: queue save ${saved.status}: ${JSON.stringify(saved.body)}`)
        }
      }
    }

    const decision = decidePick(persona, ctx, decisionRng)
    if (decision.kind === 'timeout') {
      // Same R292 coverage note as the placeholder/afk branch above.
      await rewindAndTick(args, draftId, args.clockSeconds + GRACE_SECONDS + 60, workerErrors)
      lastProgress = { pickNumber: lastProgress.pickNumber, atMs: clock.nowMs() }
      await clock.sleep(60)
      continue
    }

    const actionId = uuidFromRng(actionRng)
    if (decision.doubleTap) {
      // E2 on the wire: the SAME action_id submitted twice concurrently —
      // both must answer 200 with the SAME pick. A stray concurrent pick
      // (different action_id/player) either loses with a friendly refusal
      // OR lands LEGALLY as the seat's next turn at a snake corner (the
      // last seat of a round owns picks N and N+1 back-to-back), so no
      // per-volley "landed ≤ 1" count is asserted here — the first gate
      // run flagged exactly that corner as a false positive (3 leagues,
      // every one with a fully consistent final board). A TRUE double-land
      // cannot escape the end sweep: it must break board-order,
      // pick-numbers-contiguous, or per-team-counts.
      // Volley members bypass the pacing semaphore for the same reason the
      // queue double-tap does: a saturated limiter would serialize the taps
      // and the E2/E1 concurrency under test would never actually occur.
      const volley: Array<Promise<{ status: number; body: unknown }>> = [
        makePick(bot.client, leagueId, { draft_id: draftId, player_id: decision.playerId, action_id: actionId }),
        makePick(bot.client, leagueId, { draft_id: draftId, player_id: decision.playerId, action_id: actionId }),
      ]
      if (decision.strayPlayerId !== null) {
        volley.push(
          makePick(bot.client, leagueId, {
            draft_id: draftId,
            player_id: decision.strayPlayerId!,
            action_id: uuidFromRng(actionRng),
          }),
        )
      }
      const settled = await Promise.all(volley)
      const pair = settled.slice(0, 2)
      const okPair = pair.filter((r) => r.status === 200)
      if (okPair.length === 2) {
        const players = okPair.map(
          (r) => ((r.body as { pick?: { player_id?: string } }).pick?.player_id ?? '(none)'),
        )
        if (players[0] !== players[1]) {
          failures.push({
            invariant: 'e2-replay-mismatch',
            leagueLabel: label,
            draftId,
            detail: `same action_id answered two different picks: ${players.join(' vs ')}`,
          })
        } else {
          report.replayVerified += 1
        }
      } else {
        // The seat lost the turn to a concurrent actor (cron autopick or
        // the stray) before/between the taps — but ONLY a friendly 400 is
        // that expected chaos traffic. Anything else (5xx, 401/403, …) is
        // an engine/harness failure under exactly the most concurrency-
        // stressed traffic and must fail the sweep, never be absorbed as
        // a refusal (R287).
        for (const r of pair) {
          if (r.status === 200) continue
          if (r.status === 400) report.expectedRefusals += 1
          else workerErrors.push(`${label}: E2 tap ${r.status}: ${JSON.stringify(r.body)}`)
        }
      }
      const stray = settled[2]
      if (stray !== undefined && stray.status !== 200) {
        if (stray.status === 400) report.expectedRefusals += 1
        else workerErrors.push(`${label}: stray pick ${stray.status}: ${JSON.stringify(stray.body)}`)
      }

      // Refresh the drafted set after the volley (whichever taps landed).
      const picksAfter = await readPicks(args, reader, draftId)
      if (picksAfter !== null) {
        drafted.clear()
        for (const p of picksAfter) drafted.add(p.player_id)
      }
    } else {
      const picked = await limit(() =>
        makePick(bot.client, leagueId, {
          draft_id: draftId,
          player_id: decision.playerId,
          action_id: actionId,
        }),
      )
      if (picked.status === 200) {
        drafted.add(decision.playerId)
      } else if (picked.status === 400) {
        // Friendly refusal (E1 loser / turn already advanced under the
        // cron) — expected under concurrency; the loop re-reads and moves on.
        report.expectedRefusals += 1
      } else {
        workerErrors.push(`${label}: pick ${picked.status}: ${JSON.stringify(picked.body)}`)
      }
    }

    await clock.sleep(60)
  }

  if (!stuck) {
    // A final belt: if the loop exited by iteration cap, say so loudly.
    const finalRow = await readDraftRow(args, reader, draftId)
    if (finalRow !== null && finalRow.status !== 'complete') {
      failures.push({
        invariant: 'loop-exhausted',
        leagueLabel: label,
        draftId,
        detail: `draft still '${finalRow.status}' after ${maxIterations} iterations`,
      })
    }
  }

  // ---- Audit + sweep (service-role harness reads — recorded) -------------
  const audit = await collectAudit(args, label, leagueId, draftId, plan, totalRounds, workerErrors)
  failures.push(...sweepAudit(audit))
  report.workerErrors.push(...workerErrors)

  const result: LeagueResult = {
    leagueLabel: label,
    leagueId,
    draftId,
    teamCount: plan.teamCount,
    rounds: totalRounds,
    totalPicks,
    personas: plan.allAfk ? 'all-afk' : plan.humanSeats.map((s) => s.persona).join('/'),
    durationMs: clock.nowMs() - startedAt,
    failures,
  }
  log(
    `${label}: ${audit.picks.length}/${totalPicks} picks · league '${audit.leagueStatus}' · ` +
      `${failures.length === 0 ? 'invariants OK' : `${failures.length} FAILURES`} · ${(result.durationMs / 1000).toFixed(1)}s`,
  )
  return result
}

// ---------------------------------------------------------------------------
// Wire helpers (transport-retried reads; harness rewind/tick)
// ---------------------------------------------------------------------------

/** Loop reads run under a MEMBER's own JWT (the D92 read pattern — the same
 *  RLS SELECT the room performs); transport-only bounded retries (D118(9)). */
async function readDraftRow(
  args: DriveLeagueArgs,
  client: Supabase,
  draftId: string,
): Promise<DraftRowView | null> {
  for (let attempt = 0; attempt < READ_RETRIES; attempt++) {
    const { data, error } = await args.limit(() =>
      client
        .from('drafts')
        .select('status, current_pick_number, on_clock_team_id, current_deadline')
        .eq('id', draftId)
        .single(),
    )
    if (!error) return data as DraftRowView
    await args.clock.sleep(200)
  }
  return null
}

async function readPicks(
  args: DriveLeagueArgs,
  client: Supabase,
  draftId: string,
): Promise<AuditPick[] | null> {
  for (let attempt = 0; attempt < READ_RETRIES; attempt++) {
    const { data, error } = await args.limit(() =>
      client
        .from('draft_picks')
        .select('pick_number, round, team_id, player_id')
        .eq('draft_id', draftId)
        .eq('is_undone', false)
        .order('pick_number'),
    )
    if (!error) return (data ?? []) as AuditPick[]
    await args.clock.sleep(200)
  }
  return null
}

async function readOwnQueue(
  args: DriveLeagueArgs,
  client: Supabase,
  draftId: string,
  teamId: string,
): Promise<Array<{ player_id: string; rank: number }> | null> {
  const { data, error } = await args.limit(() =>
    client
      .from('draft_queues')
      .select('player_id, rank')
      .eq('draft_id', draftId)
      .eq('team_id', teamId)
      .order('rank'),
  )
  if (error) return null
  return (data ?? []) as Array<{ player_id: string; rank: number }>
}

/** Service-role deadline rewind + direct tick — THE harness move (D100).
 *  `status='live'`-conditional so the harness can never mutate a draft the
 *  engine has finished (the F52 draft-tick-db lesson, applied at authoring). */
async function rewindAndTick(
  args: DriveLeagueArgs,
  draftId: string,
  seconds: number,
  workerErrors: string[],
): Promise<void> {
  const { data: row, error: readError } = await args.limit(() =>
    args.service.from('drafts').select('status, current_deadline').eq('id', draftId).single(),
  )
  if (readError || row === null) return
  if (row.status !== 'live' || row.current_deadline === null) return
  const rewound = new Date(Date.parse(row.current_deadline) - seconds * 1000).toISOString()
  const { error: rewindError } = await args.limit(() =>
    args.service
      .from('drafts')
      .update({ current_deadline: rewound })
      .eq('id', draftId)
      .eq('status', 'live'),
  )
  if (rewindError) {
    workerErrors.push(`rewind failed for ${draftId}: ${rewindError.message}`)
    return
  }
  await tickOnce(args, workerErrors)
}

/** One direct draft_tick() — the summary's `*_failures` arrays feed the
 *  zero-worker-errors invariant. */
async function tickOnce(args: DriveLeagueArgs, workerErrors: string[]): Promise<void> {
  const { data, error } = await args.limit(() => args.service.rpc('draft_tick'))
  if (error) {
    workerErrors.push(`draft_tick error: ${error.message}`)
    return
  }
  const summary = data as Record<string, unknown> | null
  if (summary === null) return
  for (const [key, value] of Object.entries(summary)) {
    if (key.endsWith('_failures') && Array.isArray(value) && value.length > 0) {
      workerErrors.push(`tick ${key}: ${JSON.stringify(value)}`)
    }
  }
}

/** Chaos: two conflicting whole-queue replaces fired CONCURRENTLY for one
 *  seat — the F54 reproduction (observe + record; the sim never fixes). */
async function chaosQueueDoubleTap(
  args: DriveLeagueArgs,
  bot: BotUser,
  leagueId: string,
  draftId: string,
  teamId: string,
  orderA: string[],
  orderB: string[],
  label: string,
  workerErrors: string[],
): Promise<void> {
  // The two replaces DELIBERATELY bypass the pacing semaphore: a saturated
  // limiter (25 league loops > width 16) serializes "concurrent" calls and
  // closes exactly the interleave window F54 documents — the first gate
  // run produced 0 reproductions in ~160 taps for precisely that reason.
  // A user's double-tap has no semaphore; neither does this one (bounded:
  // +2 in-flight requests per chaos turn).
  const [a, b] = await Promise.all([
    upsertQueue(bot.client, leagueId, bot.userId, { draft_id: draftId, players: orderA }),
    upsertQueue(bot.client, leagueId, bot.userId, { draft_id: draftId, players: orderB }),
  ])
  // Classify every failed leg by STATUS (R287): a 400 is a friendly
  // refusal (expected chaos traffic — e.g. the seat's turn advanced
  // mid-volley); ANY other status is an engine failure under exactly the
  // most concurrency-stressed traffic and must fail the sweep — this pair
  // is the known-unprotected delete→insert window (F54's D113(3) face
  // eats a 500 here on OVERLAPPING sets; the sim's sets are disjoint, so
  // a 500 in this lane is news, never noise).
  for (const [leg, r] of [['A', a], ['B', b]] as const) {
    if (r.status === 200) continue
    if (r.status === 400) args.report.expectedRefusals += 1
    else workerErrors.push(`${label}: queue double-tap leg ${leg} ${r.status}: ${JSON.stringify(r.body)}`)
  }
  // Both 200s are "successes" as far as the route knows — the interleave is
  // exactly what F54 documents. Read the seat's settled rows and look for
  // the duplicate-rank signature.
  if (a.status !== 200 && b.status !== 200) return
  const rows = await readOwnQueue(args, bot.client, draftId, teamId)
  if (rows === null) return
  const dupes = duplicateQueueRanks(rows)
  if (dupes.length > 0) {
    // EVERY incident is counted and logged; only the stored evidence
    // detail rows are capped (R288: the cap must never wear the total's
    // name — "5" on the old report line was MAX_F54_INCIDENTS, not the
    // count).
    args.report.f54Total += 1
    if (args.report.f54Incidents.length < MAX_F54_INCIDENTS) {
      args.report.f54Incidents.push({
        leagueLabel: label,
        draftId,
        teamId,
        submittedA: orderA,
        submittedB: orderB,
        rows,
        duplicateRanks: dupes,
      })
    }
    args.log(
      `${label}: F54 REPRODUCED — seat ${teamId} queue ranks [${rows
        .map((r) => r.rank)
        .join(', ')}] (duplicate rank ${dupes.join(', ')}) after concurrent replaces`,
    )
  }
}

// ---------------------------------------------------------------------------
// Audit collection (service-role harness reads — recorded)
// ---------------------------------------------------------------------------

async function collectAudit(
  args: DriveLeagueArgs,
  label: string,
  leagueId: string,
  draftId: string,
  plan: LeaguePlan,
  totalRounds: number,
  workerErrors: string[],
): Promise<DraftAudit> {
  const { service, limit } = args
  const { data: draftRow, error: draftError } = await limit(() =>
    service
      .from('drafts')
      .select('status, draft_order, total_rounds')
      .eq('id', draftId)
      .single(),
  )
  throwIfError(draftError, `${label}: audit draft read`)
  const { data: picks, error: picksError } = await limit(() =>
    service
      .from('draft_picks')
      .select('pick_number, round, team_id, player_id')
      .eq('draft_id', draftId)
      .eq('is_undone', false)
      .order('pick_number'),
  )
  throwIfError(picksError, `${label}: audit picks read`)
  const { data: rosters, error: rostersError } = await limit(() =>
    service.from('league_rosters').select('team_id, player_id').eq('league_id', leagueId),
  )
  throwIfError(rostersError, `${label}: audit rosters read`)
  const { data: league, error: leagueError } = await limit(() =>
    service.from('leagues').select('status').eq('id', leagueId).single(),
  )
  throwIfError(leagueError, `${label}: audit league read`)

  return {
    leagueLabel: label,
    draftId,
    teamCount: plan.teamCount,
    totalRounds,
    draftOrder: (draftRow!.draft_order ?? []) as string[],
    snakeReversal: plan.snakeReversal,
    picks: (picks ?? []) as AuditPick[],
    rosters: (rosters ?? []) as Array<{ team_id: string; player_id: string }>,
    leagueStatus: league!.status as string,
    draftStatus: draftRow!.status as string,
    workerErrors,
  }
}

// ---------------------------------------------------------------------------
// Cleanup (loud — R285; byte-clean verification)
// ---------------------------------------------------------------------------

async function cleanupSweep(service: Supabase, log: (line: string) => void): Promise<string> {
  const { data: stale, error: staleError } = await service
    .from('leagues')
    .select('id')
    .like('name', `${SIM_LEAGUE_PREFIX}%`)
  throwIfError(staleError, 'cleanup: sim-league lookup')
  const ids = (stale ?? []).map((row) => row.id)
  if (ids.length > 0) {
    const { error: draftsError } = await service.from('drafts').delete().in('league_id', ids)
    throwIfError(draftsError, 'cleanup: drafts delete')
    const { error: teamsError } = await service.from('teams').delete().in('league_id', ids)
    throwIfError(teamsError, 'cleanup: teams delete')
    const { error: leaguesError } = await service.from('leagues').delete().in('id', ids)
    throwIfError(leaguesError, 'cleanup: leagues delete')
  }
  const { data: profiles, error: profilesError } = await service
    .from('profiles')
    .select('id, username')
    .like('username', `${SIM_USERNAME_PREFIX}%`)
  throwIfError(profilesError, 'cleanup: sim-profile lookup')
  for (const row of profiles ?? []) {
    const { error: deleteError } = await service.auth.admin.deleteUser(row.id)
    if (deleteError) {
      throw new Error(`cleanup: deleteUser ${row.username} failed: ${deleteError.message}`)
    }
  }

  // Byte-clean verification: 0 sim leagues, 0 sim profiles remain.
  const { count: leagueCount, error: verifyLeagues } = await service
    .from('leagues')
    .select('id', { count: 'exact', head: true })
    .like('name', `${SIM_LEAGUE_PREFIX}%`)
  throwIfError(verifyLeagues, 'cleanup: league verification')
  const { count: profileCount, error: verifyProfiles } = await service
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .like('username', `${SIM_USERNAME_PREFIX}%`)
  throwIfError(verifyProfiles, 'cleanup: profile verification')
  if ((leagueCount ?? -1) !== 0 || (profileCount ?? -1) !== 0) {
    throw new Error(
      `cleanup: stack NOT clean — ${leagueCount} sim leagues, ${profileCount} sim profiles remain`,
    )
  }
  const summary = `CLEANUP: swept ${ids.length} leagues + ${(profiles ?? []).length} bot users — 0 sim leagues / 0 sim profiles remain (players untouched — none seeded)`
  log(summary)
  return summary
}
