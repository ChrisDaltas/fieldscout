/**
 * TRANSACTING PERSONAS + THE GHOST — M5 task L.D3.8 (tasks-M5-transactions.md
 * §6 L.D3.8; delivery plan §4.2 "Bots … drive real RPCs through the real API —
 * never direct DB writes. The Ghost scenario exercises the full §7.2.1
 * lifecycle"; PROGRESS F211 (the Ghost arm), F284(b), F300).
 *
 * OPT-IN (`sim season --transact`). The default season run — the population
 * `gate-m4.sh` measures, whose evidence stage REQUIRES `poolRows = 0` and the
 * F300 withdrawal (gate-m4-evidence.ts:371-396) — is byte-for-byte what it was.
 * A transacting run is a different population and says so on every report.
 *
 * WHAT EACH LEAGUE DOES, in this order, every write through a real door
 * (the API service a route calls, or the RPC a route will call — L.D3.6's
 * trade routes are not built yet, so trades go to the RPCs under the bot's
 * OWN JWT, exactly what those routes will send):
 *
 *   1. CLAIMS (`submitClaim` → `waiver_claim_submit`). Three managers bid on
 *      the SAME best free agent at a position (the first of WR / RB / TE / QB
 *      all three can give up — the draft is a real race, so rosters are read,
 *      never assumed) with distinct bids, each dropping his own worst there,
 *      and each ranks a second, uncontested player behind it with the same
 *      drop — so one run yields `won`, `lost` (outbid) and `invalid` (drop
 *      gone) outcomes, the blind-bid population TD3 needs. The Ghost's team
 *      makes one uncontested claim (it WINS, so it has spent FAAB for L.D2.6
 *      to carry).
 *   2. THE WAIVER RUN — `waiver_tick(p_now, league)` at VIRTUAL instants: once
 *      eight days before the first driven week to seed / align the league's
 *      next run onto the synthetic calendar, then AT that run (spec §13.2;
 *      TD6 — the in-database processor, scoped by league like every job the
 *      season harness drives).
 *   3. THE GHOST LEAVES: the commissioner vacates his seat (`removeMember`
 *      mode `vacate`, §7.2.1(c)) and switches the orphaned seat's autopilot ON
 *      (`commishSetAutopilot`, Q63). The ghost's own JWT then reads the
 *      league's claims (must be 0) and submits a claim for his old team (must
 *      be refused 403) — "instant access revocation".
 *   4. TRADES, one per review mode (§13.3; `allow_faab_in_trades` switched ON
 *      through `commishChangeSetting` first; each a like-for-like 1-for-1
 *      between two managed seats, spread across the league):
 *        A `commissioner` review (the default): + a $2 FAAB leg, accepted,
 *          then APPROVED by the commissioner (`commish_force_or_reverse_trade`
 *          op `approve` — L.D3.5).
 *        B `none`: + a $3 FAAB leg, executes at accept — then the
 *          commissioner's `reverse` is REFUSED BY NAME (174 / L.D3.16 — Chris
 *          2026-09-30, "Remove reverse"): the trade stands, the players and
 *          the FAAB leg stay where it put them.
 *        C `league_vote` (L.D3.4): accepted, one veto vote and one approve
 *          vote (below the number), then executed by `trade_tick` at a
 *          virtual instant past its review deadline.
 *   5. `commishEditFaab` — one repair (+$5), the ledger's commissioner term.
 *   6. ADD / DROP (`submitAddDrop` → `roster_add_drop`): the commissioner
 *      switches `waiver_type` to `none_fcfs` (every waiver knob is free
 *      in-season, 149:1932) and two managers each add the best free agent at a
 *      position, dropping their worst there.
 *   7. (mid-season, the first `finalize` beat of the driven season) THE SEAT
 *      CLAIM: the commissioner sends a seat invite for the orphaned franchise
 *      (`createInvite` target_team_id) and a NEW user claims it
 *      (`claimInvite`) — the takeover.
 *
 * Every move is POSITION-FOR-POSITION and never touches a §23.6 bridged
 * player, so the week-1 seating (F288's empty-slot problem) and the scenario
 * evidence read the same world they read without transactions.
 *
 * ── TIME: WHY ALL OF IT IS PRE-KICKOFF, said plainly ───────────────────────
 * Every CLIENT verb here (claim submit, add/drop, trade propose / respond /
 * vote, the commissioner verbs) takes no caller clock — its DEFINER wrapper
 * passes the transaction's `now()` (the F284(a) shape: 145:567, 113:912,
 * 148:946). On SYNTHETIC_SEASON that is WALL time, before every 2099 instant,
 * so `lineup_current_week_internal` answers the league's FIRST week and a
 * wall-time roster move would rewrite lineups from week 1 on — a FINAL week,
 * once the season has been driven. So the transacting phase runs before the
 * first driven week opens, where the wall clock and the virtual one agree on
 * the week; only the JOBS (`waiver_tick`, `trade_tick`) take a virtual
 * instant. The Ghost's vacate and seat claim move no roster and no lineup
 * (146:95's arms), which is why the claim can land mid-season. Mid-season
 * roster traffic waits for a caller clock at the door — PROGRESS F458.
 *
 * ── SERVICE-ROLE WRITES (R290's enumeration rule) ──────────────────────────
 * Two, recorded here and in the runner banner: (9) the Ghost's SUCCESSOR is
 * provisioned with `auth.admin.createUser` under the bot pool's username
 * prefix, exactly the bot-pool job (runner.ts:325), so the run's cleanup
 * sweeps it; (10) `--probe` plants ONE fault in the sim's own league
 * (`applyBreakProbe`) so the matching invariant must go red. Nothing else:
 * every other write is a manager's or a commissioner's through his own JWT.
 * The job RPCs are service-role by design (runner banner job 6).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'

import { commishSetAutopilot } from '../api/commish-autopilot-service'
import { reportVisitedLeagues, runScopedJob } from './scoped-job'
import { commishEditFaab } from '../api/commish-faab-service'
import { commishChangeSetting } from '../api/commish-setting-service'
import { claimInvite, createInvite } from '../api/invites-service'
import { removeMember } from '../api/members-service'
import { submitAddDrop } from '../api/transactions-service'
import { submitClaim } from '../api/waivers-service'

import { BLOCKING_DESIGNATIONS, simDesignation } from './designations'
import { SIM_BOT_PASSWORD, SIM_USERNAME_PREFIX } from './runner'
import { NFL_CLUBS } from './season-scenario'
import { deriveStream, uuidFromRng } from './sim-rng'
import { SYNTHETIC_SEASON } from './synthetic-season'
import type {
  AuditClaimRow,
  AuditClaimView,
  AuditGhost,
  TransactionAudit,
  TransactionProbe,
} from './transaction-invariants'

type Supabase = SupabaseClient<Database>
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** The slice of the season runner's `LeagueState` this module reads/writes. */
export interface TransactLeague {
  label: string
  leagueId: string
  ownerId: string | null
  /** FALSE = the league refuses a bye/OUT starter (§7.3.6): a traded-in player must be startable. */
  allowIllegalLineups: boolean
  autopilotedSeatWeeks: ReadonlySet<string>
}

export interface TransactDeps {
  service: Supabase
  /** Every bot's signed-in client, by user id (the season runner's map). */
  bots: ReadonlyMap<string, Supabase>
  url: string
  anonKey: string
  seed: number
  runTag: string
  log: (line: string) => void
  sleep: (ms: number) => Promise<void>
  /** §23.6 bridged players — never moved (the scenario reads them). */
  bridged: ReadonlySet<string>
}

export interface GhostState {
  teamId: string
  memberId: string
  ghostUserId: string
  spent: number
  balanceAtVacate: number | null
  ghostVisibleClaims: number
  ghostSubmitStatus: number | null
  successorUserId: string | null
  successorClient: Supabase | null
  balanceAfterTakeover: number | null
  /** Driven weeks whose OPEN beat ran while the seat had no manager. */
  orphanWeeks: number[]
  incomplete: string | null
}

/**
 * M5 L.D3.10 (D423) — THE WAIVER-TYPE AXIS. The gate runs the transacting
 * personas "across the settings matrix (FAAB / rolling / reverse)" (tasks-M5
 * §6 L.D3.10), so each league runs its claims under ONE of the three claim
 * types, by its plan number (`#NN`, 1-based) mod 3 — replayable, never by
 * completion order. The league is switched through `commish_change_setting`
 * before any claim (a free knob in-season, 149:1932). Under a priority type a
 * claim carries no money (157's submit refuses a non-zero bid), so every bid
 * is $0 and the contested player is decided by waiver priority; the same
 * won / lost / invalid shape follows, since each claimer ranks the contested
 * player first and a second with the same drop behind it.
 */
export const WAIVER_TYPE_MATRIX = ['faab', 'rolling_priority', 'reverse_standings'] as const
export type SimWaiverType = (typeof WAIVER_TYPE_MATRIX)[number]

export function waiverTypeFor(label: string, index: number): SimWaiverType {
  const planNumber = Number(/#(\d+)/.exec(label)?.[1] ?? index + 1)
  return WAIVER_TYPE_MATRIX[(planNumber - 1) % WAIVER_TYPE_MATRIX.length]!
}

export interface LeagueTransactState {
  label: string
  leagueId: string
  commishUserId: string
  /** The claim type this league's claims ran under (the D423 axis). */
  waiverType: SimWaiverType
  expectedHolder: Map<string, string | null>
  counts: {
    claimsSubmitted: number
    won: number
    lost: number
    invalid: number
    addDrops: number
    trades: Record<'commissioner' | 'none' | 'league_vote', number>
    /** 174: the commissioner's reverse, refused by name — the trade stood. */
    reverseRefused: number
    votes: number
    commishFaabEdits: number
  }
  ghost: GhostState | null
  /** Non-null when the league's script stopped early — a run PROBLEM. */
  aborted: string | null
  lines: string[]
}

export interface TransactRun {
  byLeague: Map<string, LeagueTransactState>
  /** The virtual instants the phase used (all before the first driven week). */
  instants: string[]
}

class StepError extends Error {}

function must<R extends { data: unknown; error: { message: string } | null }>(what: string, r: R): NonNullable<R['data']> {
  if (r.error) throw new StepError(`${what}: ${r.error.message}`)
  if (r.data === null || r.data === undefined) throw new StepError(`${what}: no data`)
  return r.data as NonNullable<R['data']>
}

function ok(what: string, r: { status: number; body: unknown }, want: number[] = [200]): Record<string, unknown> {
  if (!want.includes(r.status)) throw new StepError(`${what} answered ${r.status}: ${JSON.stringify(r.body).slice(0, 400)}`)
  return (r.body ?? {}) as Record<string, unknown>
}

interface RosterPlayer {
  id: string
  position: string
  adp: number | null
  status: string | null
  team: string | null
}

/** A player §7.3.6 would let a manager START (a covered club, no blocking designation). */
const startable = (p: RosterPlayer): boolean =>
  p.team !== null && NFL_CLUBS.includes(p.team) && !BLOCKING_DESIGNATIONS.has(simDesignation(p.status) ?? '')

/** Worst-first (highest ADP; no ADP is worst), then id — a pure order. */
const worstFirst = (a: RosterPlayer, b: RosterPlayer): number =>
  (b.adp ?? Number.POSITIVE_INFINITY) - (a.adp ?? Number.POSITIVE_INFINITY) || (a.id < b.id ? -1 : 1)

/** The positions a like-for-like move may use (K / DEF are one-deep). */
const MOVE_POSITIONS = ['WR', 'RB', 'TE', 'QB'] as const

/**
 * The harness's model of one league's rosters for CHOOSING moves (never for
 * judging them — the sweep reads the database). Every move is like-for-like
 * so each roster keeps its count at every position; a player is used once;
 * bridged players are never touched. `strict` = the league forbids illegal
 * lineups, so a player traded IN must be startable there (§7.3.6).
 */
class LeagueWorld {
  readonly roster = new Map<string, RosterPlayer[]>()
  readonly used = new Set<string>()
  readonly freeAgents = new Map<string, RosterPlayer[]>()

  constructor(
    private readonly bridged: ReadonlySet<string>,
    private readonly strict: boolean,
  ) {}

  private movable(teamId: string, position: string, forTrade: boolean): RosterPlayer[] {
    return (this.roster.get(teamId) ?? [])
      .filter((p) => p.position === position && !this.bridged.has(p.id) && !this.used.has(p.id))
      .filter((p) => p.team !== null && NFL_CLUBS.includes(p.team))
      .filter((p) => !forTrade || !this.strict || startable(p))
      .sort(worstFirst)
  }

  canGive(teamId: string, position: string, forTrade = false): boolean {
    return this.movable(teamId, position, forTrade).length > 0
  }

  take(teamId: string, position: string, forTrade = false): RosterPlayer {
    const pick = this.movable(teamId, position, forTrade)[0]
    if (pick === undefined) throw new StepError(`team ${teamId} has no movable ${position} — ${this.depth([teamId])}`)
    this.used.add(pick.id)
    return pick
  }

  freeAgentsLeft(position: string): number {
    return (this.freeAgents.get(position) ?? []).filter((p) => !this.used.has(p.id)).length
  }

  freeAgent(position: string): RosterPlayer {
    const pick = (this.freeAgents.get(position) ?? []).find((p) => !this.used.has(p.id))
    if (pick === undefined) throw new StepError(`no free-agent ${position} left in the candidate window`)
    this.used.add(pick.id)
    return pick
  }

  /** The first position (MOVE_POSITIONS order) this team can give up with a free agent to take his place. */
  addDropPosition(teamId: string, faNeeded = 1): string | undefined {
    return MOVE_POSITIONS.find((p) => this.canGive(teamId, p) && this.freeAgentsLeft(p) >= faNeeded)
  }

  /**
   * A like-for-like trade among `pool`: the first pair (in pool order) and
   * position at which BOTH hold a movable player — pairs touching `avoid`
   * are tried last, so consecutive trades spread across the league.
   */
  pickTrade<T extends { teamId: string }>(pool: readonly T[], avoid: ReadonlySet<string>): { a: T; b: T; pa: RosterPlayer; pb: RosterPlayer } {
    const pairs: Array<[T, T]> = []
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) pairs.push([pool[i]!, pool[j]!])
    const fresh = (x: [T, T]): boolean => !avoid.has(x[0].teamId) && !avoid.has(x[1].teamId)
    for (const [a, b] of [...pairs.filter(fresh), ...pairs.filter((x) => !fresh(x))]) {
      const position = MOVE_POSITIONS.find((p) => this.canGive(a.teamId, p, true) && this.canGive(b.teamId, p, true))
      if (position === undefined) continue
      return { a, b, pa: this.take(a.teamId, position, true), pb: this.take(b.teamId, position, true) }
    }
    throw new StepError(`no two seats share a position with a movable player each — ${this.depth(pool.map((s) => s.teamId))}`)
  }

  /** Each team's movable players by position (the refusal's evidence). */
  depth(teams: readonly string[]): string {
    return teams
      .map((t) => {
        const by: Record<string, number> = {}
        for (const p of this.roster.get(t) ?? []) {
          if (this.bridged.has(p.id) || this.used.has(p.id)) continue
          by[p.position] = (by[p.position] ?? 0) + 1
        }
        return `${t.slice(0, 8)} ${JSON.stringify(by)}`
      })
      .join('; ')
  }
}

async function readWorld(service: Supabase, leagueId: string, bridged: ReadonlySet<string>, strict: boolean): Promise<LeagueWorld> {
  const world = new LeagueWorld(bridged, strict)
  const rows = must(
    'roster read',
    await service
      .from('league_rosters')
      .select('team_id, player_id, players!inner(position, adp, status, team)')
      .eq('league_id', leagueId),
  )
  const rostered = new Set<string>()
  for (const r of rows) {
    const p = r.players as unknown as { position: string; adp: number | null; status: string | null; team: string | null }
    rostered.add(r.player_id)
    const list = world.roster.get(r.team_id) ?? []
    list.push({ id: r.player_id, position: String(p.position), adp: p.adp === null ? null : Number(p.adp), status: p.status, team: p.team })
    world.roster.set(r.team_id, list)
  }
  const pooled = new Set(
    must('pool read', await service.from('league_player_pool').select('player_id').eq('league_id', leagueId)).map((r) => r.player_id),
  )
  for (const position of MOVE_POSITIONS) {
    // The BEST-ADP window, not the whole table: a sample of the best
    // available is what a manager picks from, and this read claims nothing
    // about completeness (rule 5's paging is for reads that do).
    const candidates = must(
      `free-agent ${position} read`,
      await service
        .from('players')
        .select('id, position, adp, status, team')
        .eq('position', position)
        .in('team', [...NFL_CLUBS])
        .not('adp', 'is', null)
        .order('adp', { ascending: true })
        .order('id', { ascending: true })
        .limit(400),
    )
    world.freeAgents.set(
      position,
      candidates
        .map((p) => ({ id: p.id, position: String(p.position), adp: p.adp === null ? null : Number(p.adp), status: p.status, team: p.team }))
        .filter((p) => !rostered.has(p.id) && !pooled.has(p.id) && !bridged.has(p.id) && startable(p)),
    )
  }
  return world
}

async function readBalance(service: Supabase, leagueId: string, teamId: string): Promise<number | null> {
  const row = must(
    'balance read',
    await service.from('league_members').select('faab_balance').eq('league_id', leagueId).eq('team_id', teamId).single(),
  )
  return row.faab_balance
}

async function tradeStatus(service: Supabase, tradeId: string): Promise<string> {
  return must('trade status', await service.from('trades').select('status').eq('id', tradeId).single()).status
}

async function tickOnce(deps: TransactDeps, fn: 'waiver_tick' | 'trade_tick', leagueId: string, at: Date): Promise<Record<string, unknown>> {
  const { data, error } = await (deps.service.rpc as unknown as Rpc)(fn, { p_now: at.toISOString(), p_league_id: leagueId })
  if (error) throw new StepError(`${fn}@${at.toISOString()}: ${error.message}`)
  return (data ?? {}) as Record<string, unknown>
}

/**
 * F559 (and F558's species): both jobs take the league row `FOR UPDATE SKIP
 * LOCKED`, and the wall-clock pg_cron holds every in-season league row for
 * the length of its own pass — so a scoped call can come back `leagues: 0`
 * ("no_league_due") for a league that WAS due. `inScope` is the job's own
 * selection read back; the call is re-run at the same virtual instant until
 * it visits the league (scoped-job.ts), loud if it never does.
 */
async function tick(
  deps: TransactDeps,
  fn: 'waiver_tick' | 'trade_tick',
  leagueId: string,
  at: Date,
  inScope: () => Promise<boolean>,
): Promise<Record<string, unknown>> {
  try {
    const { report } = await runScopedJob({
      label: `${fn}@${at.toISOString()} for league ${leagueId}`,
      call: () => tickOnce(deps, fn, leagueId, at),
      visited: (r) => reportVisitedLeagues(r) === 1,
      inScope,
      sleep: deps.sleep,
    })
    return report
  } catch (e) {
    throw e instanceof StepError ? e : new StepError((e as Error).message)
  }
}

/** `waiver_tick`'s selection (150:1333-1343) for a league at `at`: in season,
 *  and a run due (or untracked) — or claims left under no waivers. */
function waiverDue(deps: TransactDeps, leagueId: string, at: Date): () => Promise<boolean> {
  return async () => {
    const lg = must(
      'league read',
      await deps.service.from('leagues').select('status, deleted_at, waiver_type, waiver_next_run_at').eq('id', leagueId).single(),
    )
    if (lg.deleted_at !== null || (lg.status !== 'in_season' && lg.status !== 'playoffs')) return false
    if ((lg.waiver_type ?? 'faab') !== 'none_fcfs') {
      return lg.waiver_next_run_at === null || Date.parse(lg.waiver_next_run_at) <= at.getTime()
    }
    if (lg.waiver_next_run_at !== null) return true
    const pending = must('pending read', await deps.service.from('waiver_claims').select('id').eq('league_id', leagueId).eq('status', 'pending'))
    return pending.length > 0
  }
}

/** `trade_tick`'s selection: the league holds a proposed / accepted / in-review trade. */
function tradeDue(deps: TransactDeps, leagueId: string): () => Promise<boolean> {
  return async () =>
    must(
      'open trades read',
      await deps.service.from('trades').select('id').eq('league_id', leagueId).in('status', ['proposed', 'accepted', 'in_review']),
    ).length > 0
}

/** The first driven week's opening instant (the phase must finish before it). */
async function firstWeekStart(service: Supabase, leagueIds: readonly string[]): Promise<Date> {
  const weeks = must('league_weeks read', await service.from('league_weeks').select('week').in('league_id', [...leagueIds]).order('week').limit(1))
  if (weeks.length === 0) throw new Error('transact: no league_weeks rows — the drafts did not complete')
  const row = must(
    'nfl_weeks read',
    await service.from('nfl_weeks').select('starts_at').eq('season', SYNTHETIC_SEASON).eq('week', weeks[0]!.week).single(),
  )
  return new Date(row.starts_at)
}

/**
 * Phase 3d of `runSeasonSim` (after the autopilot switch, before the season
 * is driven). Returns per-league state the Ghost's seat claim, the probes and
 * the audit read back. A league whose script fails is ABORTED loudly (its
 * state says why) and the others carry on.
 */
export async function driveTransactions(deps: TransactDeps, leagues: readonly TransactLeague[]): Promise<TransactRun> {
  const byLeague = new Map<string, LeagueTransactState>()
  const opens = await firstWeekStart(deps.service, leagues.map((l) => l.leagueId))
  const seedAt = new Date(opens.getTime() - 8 * DAY_MS)
  const instants = [seedAt.toISOString()]
  for (const [index, league] of leagues.entries()) {
    const state: LeagueTransactState = {
      label: league.label,
      leagueId: league.leagueId,
      commishUserId: league.ownerId ?? '',
      waiverType: waiverTypeFor(league.label, index),
      expectedHolder: new Map(),
      counts: { claimsSubmitted: 0, won: 0, lost: 0, invalid: 0, addDrops: 0, trades: { commissioner: 0, none: 0, league_vote: 0 }, reverseRefused: 0, votes: 0, commishFaabEdits: 0 },
      ghost: null,
      aborted: null,
      lines: [],
    }
    byLeague.set(league.leagueId, state)
    try {
      await driveLeague(deps, league, index, state, seedAt, opens, instants)
    } catch (e) {
      state.aborted = (e as Error).message
      deps.log(`${league.label}: TRANSACT ABORTED — ${state.aborted}`)
    }
  }
  return { byLeague, instants }
}

async function driveLeague(
  deps: TransactDeps,
  league: TransactLeague,
  index: number,
  state: LeagueTransactState,
  seedAt: Date,
  opens: Date,
  instants: string[],
): Promise<void> {
  const { service, bots } = deps
  const ids = deriveStream(deps.seed, `season:transact:ids:${deps.runTag}:${index}`)
  // DECISIONS replay from the seed alone (no run tag) — plan principle 4.
  const decide = deriveStream(deps.seed, `season:transact:bids:${index}`)
  const draw = (lo: number, hi: number): number => lo + Math.floor(decide() * (hi - lo + 1))
  const commish = league.ownerId === null ? undefined : bots.get(league.ownerId)
  if (commish === undefined) throw new StepError('no signed-in commissioner client')

  // The managed seats (membership truth — D339), commissioner's own team out.
  const members = must(
    'members read',
    await service.from('league_members').select('id, user_id, team_id, role').eq('league_id', league.leagueId),
  )
  const seats = members
    .filter((m) => m.team_id !== null && m.user_id !== null && m.user_id !== league.ownerId && bots.has(m.user_id))
    .sort((a, b) => (a.team_id! < b.team_id! ? -1 : 1))
  if (seats.length < 6) throw new StepError(`only ${seats.length} bot-managed seats besides the commissioner's — the script needs 6`)
  const N = seats.map((s) => ({ teamId: s.team_id!, userId: s.user_id!, memberId: s.id, client: bots.get(s.user_id!)! }))
  const world = await readWorld(service, league.leagueId, deps.bridged, !league.allowIllegalLineups)
  const note = (line: string): void => {
    state.lines.push(line)
  }
  const setting = async (key: string, value: Json): Promise<void> => {
    ok(`setting ${key}=${JSON.stringify(value)}`, await commishChangeSetting(commish, league.leagueId, { key, value, action_id: uuidFromRng(ids) }))
  }

  // ---- 0a. THE CLAIM TYPE (D423's axis), before the run is tracked ---------
  {
    const current = must('league read', await service.from('leagues').select('waiver_type').eq('id', league.leagueId).single()).waiver_type
    if (current !== state.waiverType) await setting('waiver_type', state.waiverType)
    const readBack = must('league read', await service.from('leagues').select('waiver_type').eq('id', league.leagueId).single()).waiver_type
    if (readBack !== state.waiverType) throw new StepError(`waiver_type reads '${readBack}' after switching it to '${state.waiverType}'`)
  }
  const priced = state.waiverType === 'faab'

  // ---- 0. TRACK THE LEAGUE ON THE SYNTHETIC CALENDAR (before any claim) ---
  // The live per-minute `process-waivers` cron may already have tracked the
  // league from WALL time (a 2026 run — it seeds every untracked in-season
  // league, F423). One scoped tick at a virtual instant eight days before the
  // first driven week settles that stale run while NO claim is pending (so it
  // decides nothing) and re-tracks the league from the virtual instant — or,
  // untracked, seeds it. Read what happened rather than assume it; a tick the
  // cron's SKIP LOCKED beat can win is retried.
  let runAt: Date | null = null
  for (let attempt = 0; attempt < 5 && runAt === null; attempt++) {
    await tick(deps, 'waiver_tick', league.leagueId, seedAt, waiverDue(deps, league.leagueId, seedAt))
    const row = must('league next run', await service.from('leagues').select('waiver_next_run_at').eq('id', league.leagueId).single())
    const next = row.waiver_next_run_at === null ? null : new Date(row.waiver_next_run_at)
    if (next !== null && next.getTime() > seedAt.getTime()) runAt = next
    else await deps.sleep(250)
  }
  if (runAt === null) throw new StepError(`waiver_tick at ${seedAt.toISOString()} never tracked the league onto the synthetic calendar`)
  if (runAt.getTime() >= opens.getTime()) {
    throw new StepError(`the league's next waiver run ${runAt.toISOString()} is not before the first driven week (${opens.toISOString()})`)
  }

  // ---- 1. CLAIMS ---------------------------------------------------------
  // Like-for-like: the first position at which three seats can each give up a
  // player and the free-agent window holds a contested player plus one each
  // (the draft is a real race, so depth differs run to run — read, not assumed).
  const claimAt = MOVE_POSITIONS.find((p) => world.freeAgentsLeft(p) >= 4 && N.filter((s) => world.canGive(s.teamId, p)).length >= 3)
  if (claimAt === undefined) throw new StepError(`no position lets three seats claim like-for-like — ${world.depth(N.map((s) => s.teamId))}`)
  const claimers = N.filter((s) => world.canGive(s.teamId, claimAt)).slice(0, 3)
  const contested = world.freeAgent(claimAt)
  const b2 = draw(1, 4)
  const b1 = b2 + draw(1, 4)
  const b0 = b1 + draw(1, 4)
  // The draws are consumed in every league so the decision stream is the same
  // whatever the claim type; a priority league bids $0 (no money — 157).
  const bids = priced ? [b0, b1, b2] : [0, 0, 0]
  for (const [i, c] of claimers.entries()) {
    const drop = world.take(c.teamId, claimAt)
    const second = world.freeAgent(claimAt)
    for (const [add, bid] of [
      [contested, bids[i]!],
      [second, priced ? 1 : 0],
    ] as const) {
      ok(
        `claim ${add.id} for team ${c.teamId}`,
        await submitClaim(c.client, league.leagueId, {
          team_id: c.teamId,
          add_player_id: add.id,
          drop_player_id: drop.id,
          faab_bid: bid,
          action_id: uuidFromRng(ids),
        }),
      )
      state.counts.claimsSubmitted += 1
    }
  }
  // The Ghost: the first other seat with a like-for-like claim to make.
  const ghostSeat = N.find((s) => !claimers.includes(s) && world.addDropPosition(s.teamId, 2) !== undefined)
  if (ghostSeat === undefined) throw new StepError(`no seat left to play the Ghost — ${world.depth(N.map((s) => s.teamId))}`)
  const ghostAt = world.addDropPosition(ghostSeat.teamId, 2)!
  const ghostDraw = draw(5, 15)
  const ghostBid = priced ? ghostDraw : 0
  const ghostAdd = world.freeAgent(ghostAt)
  const ghostDrop = world.take(ghostSeat.teamId, ghostAt)
  ok(
    `ghost claim for team ${ghostSeat.teamId}`,
    await submitClaim(ghostSeat.client, league.leagueId, {
      team_id: ghostSeat.teamId,
      add_player_id: ghostAdd.id,
      drop_player_id: ghostDrop.id,
      faab_bid: ghostBid,
      action_id: uuidFromRng(ids),
    }),
  )
  state.counts.claimsSubmitted += 1
  // Everyone else the script uses is still managed (the ghost is about to leave).
  const others = N.filter((s) => s !== ghostSeat)

  // ---- 2. THE WAIVER RUN, at the tracked (virtual) instant ---------------
  const pendingNow = must(
    'pending read',
    await service.from('waiver_claims').select('id').eq('league_id', league.leagueId).eq('status', 'pending'),
  ).length
  if (pendingNow !== state.counts.claimsSubmitted) {
    throw new StepError(`${pendingNow} claim(s) pending before the run, ${state.counts.claimsSubmitted} submitted — something settled them early`)
  }
  {
    const report = await tick(deps, 'waiver_tick', league.leagueId, runAt, waiverDue(deps, league.leagueId, runAt))
    const settled = ((report.settled ?? []) as Array<{ league_id?: string }>).filter((s) => s.league_id === league.leagueId)
    if (settled.length !== 1) throw new StepError(`waiver_tick at ${runAt.toISOString()} settled ${settled.length} runs for the league: ${JSON.stringify(report).slice(0, 400)}`)
    instants.push(runAt.toISOString())
  }
  const claims = must(
    'claims read',
    await service.from('waiver_claims').select('id, team_id, add_player_id, drop_player_id, status, result_reason, faab_bid').eq('league_id', league.leagueId),
  )
  for (const c of claims) {
    if (c.status === 'pending') throw new StepError(`claim ${c.id} is still pending after the run`)
    if (c.status === 'won') {
      state.counts.won += 1
      state.expectedHolder.set(c.add_player_id, c.team_id)
      if (c.drop_player_id !== null) state.expectedHolder.set(c.drop_player_id, null)
    } else if (c.status === 'lost') state.counts.lost += 1
    else state.counts.invalid += 1
  }
  note(
    `claims ${state.counts.claimsSubmitted} submitted → ${state.counts.won} won · ${state.counts.lost} lost · ${state.counts.invalid} invalid ` +
      `(${state.waiverType}: contested ${claimAt} ${contested.id} — ${priced ? `bids $${b0}/$${b1}/$${b2}` : 'no bids, decided by waiver priority'}) · run at ${runAt.toISOString()}`,
  )
  const ghostClaim = claims.find((c) => c.team_id === ghostSeat.teamId && c.add_player_id === ghostAdd.id)
  const ghost: GhostState = {
    teamId: ghostSeat.teamId,
    memberId: ghostSeat.memberId,
    ghostUserId: ghostSeat.userId,
    spent: ghostClaim?.status === 'won' ? ghostClaim.faab_bid : 0,
    balanceAtVacate: null,
    ghostVisibleClaims: -1,
    ghostSubmitStatus: null,
    successorUserId: null,
    successorClient: null,
    balanceAfterTakeover: null,
    orphanWeeks: [],
    incomplete: 'the seat claim never ran',
  }
  state.ghost = ghost

  // ---- 3. THE GHOST LEAVES -----------------------------------------------
  ok(
    `vacate team ${ghostSeat.teamId}`,
    await removeMember(commish, league.leagueId, ghostSeat.memberId, league.ownerId!, { mode: 'vacate' }),
  )
  ghost.balanceAtVacate = await readBalance(service, league.leagueId, ghostSeat.teamId)
  ok(
    `autopilot ON for the orphaned team ${ghostSeat.teamId}`,
    await commishSetAutopilot(commish, league.leagueId, { team_id: ghostSeat.teamId, on: true, action_id: uuidFromRng(ids) }),
  )
  ghost.ghostVisibleClaims = must(
    'ghost claims read',
    await ghostSeat.client.from('waiver_claims').select('id').eq('league_id', league.leagueId),
  ).length
  const probeAdd = world.freeAgent(ghostAt)
  ghost.ghostSubmitStatus = (
    await submitClaim(ghostSeat.client, league.leagueId, {
      team_id: ghostSeat.teamId,
      add_player_id: probeAdd.id,
      faab_bid: 0,
      action_id: uuidFromRng(ids),
    })
  ).status
  note(
    `ghost: team ${ghostSeat.teamId} spent $${ghost.spent} then was VACATED holding $${ghost.balanceAtVacate} · autopilot ON · ` +
      `his JWT now reads ${ghost.ghostVisibleClaims} claim(s), his claim answered ${ghost.ghostSubmitStatus}`,
  )

  // ---- 4. TRADES, one per review mode ------------------------------------
  type Seat = (typeof N)[number]
  const rpc = (client: Supabase): Rpc => client.rpc.bind(client) as unknown as Rpc
  const propose = async (from: Seat, to: Seat, give: string, get: string, faab: number): Promise<string> => {
    const items: Array<Record<string, unknown>> = [
      { player_id: give, from_team_id: from.teamId },
      { player_id: get, from_team_id: to.teamId },
    ]
    if (faab > 0) items.push({ faab_amount: faab, from_team_id: from.teamId })
    const { data, error } = await rpc(from.client)('trade_propose', {
      p_league_id: league.leagueId,
      p_from_team_id: from.teamId,
      p_to_team_id: to.teamId,
      p_items: items,
      p_action_id: uuidFromRng(ids),
    })
    if (error) throw new StepError(`trade_propose ${give}↔${get}: ${error.message}`)
    return (data as { trade: { id: string } }).trade.id
  }
  const accept = async (to: Seat, tradeId: string): Promise<void> => {
    const { error } = await rpc(to.client)('trade_respond', {
      p_league_id: league.leagueId,
      p_trade_id: tradeId,
      p_op: 'accept',
      p_action_id: uuidFromRng(ids),
    })
    if (error) throw new StepError(`trade_respond accept ${tradeId}: ${error.message}`)
  }
  const commishOp = async (tradeId: string, op: 'approve'): Promise<void> => {
    const { error } = await rpc(commish)('commish_force_or_reverse_trade', {
      p_league_id: league.leagueId,
      p_trade_id: tradeId,
      p_op: op,
      p_action_id: uuidFromRng(ids),
    })
    if (error) throw new StepError(`commish_force_or_reverse_trade ${op} ${tradeId}: ${error.message}`)
  }
  // 174 (L.D3.16 — Chris 2026-09-30, "Remove reverse"): the verb refuses a
  // reverse BY NAME (22023) and writes nothing. Anything else — a landing, or
  // another refusal — is a step failure.
  const REVERSE_REFUSAL = 'reversing a trade is no longer a commissioner tool'
  const refuseReverse = async (tradeId: string): Promise<void> => {
    const { data, error } = await rpc(commish)('commish_force_or_reverse_trade', {
      p_league_id: league.leagueId,
      p_trade_id: tradeId,
      p_op: 'reverse',
      p_action_id: uuidFromRng(ids),
    })
    if (!error) throw new StepError(`commish_force_or_reverse_trade reverse ${tradeId} LANDED (${JSON.stringify(data)}) — 174 removed reverse`)
    if (error.code !== '22023' || !error.message.includes(REVERSE_REFUSAL)) {
      throw new StepError(`commish_force_or_reverse_trade reverse ${tradeId}: expected 174's refusal by name, got ${error.code} ${error.message}`)
    }
  }
  const expectStatus = async (tradeId: string, want: string, what: string): Promise<void> => {
    const got = await tradeStatus(service, tradeId)
    if (got !== want) throw new StepError(`${what}: trade ${tradeId} is '${got}', expected '${want}'`)
  }
  const swap = (a: Seat, pa: string, b: Seat, pb: string): void => {
    state.expectedHolder.set(pa, b.teamId)
    state.expectedHolder.set(pb, a.teamId)
  }
  const inTrades = new Set<string>()

  // A priority league has no FAAB to trade (148's propose refuses a FAAB leg
  // there, §7.3.4), so its trades carry players only (D423).
  if (priced) await setting('allow_faab_in_trades', true)
  // A — commissioner review, approved by the commissioner (L.D3.5 approve).
  const reviewNow = must('league read', await service.from('leagues').select('trade_review').eq('id', league.leagueId).single()).trade_review
  if (reviewNow !== 'commissioner') await setting('trade_review', 'commissioner')
  {
    const { a, b, pa, pb } = world.pickTrade(others, inTrades)
    const t = await propose(a, b, pa.id, pb.id, priced ? 2 : 0)
    await accept(b, t)
    await expectStatus(t, 'in_review', 'trade A after accept (commissioner review)')
    await commishOp(t, 'approve')
    await expectStatus(t, 'complete', 'trade A after the commissioner approved it')
    swap(a, pa.id, b, pb.id)
    inTrades.add(a.teamId).add(b.teamId)
    state.counts.trades.commissioner += 1
    note(`trade A (commissioner review): ${pa.position} ${pa.id} ↔ ${pb.id}${priced ? ' + $2' : ''} — approved by the commissioner → complete`)
  }
  // B — no review: executes at accept; the commissioner's reverse is then
  // REFUSED by name (174 — "Remove reverse") and the trade stands.
  await setting('trade_review', 'none')
  {
    const { a, b, pa, pb } = world.pickTrade(others, inTrades)
    const t = await propose(a, b, pa.id, pb.id, priced ? 3 : 0)
    await accept(b, t)
    await expectStatus(t, 'complete', 'trade B after accept (no review)')
    swap(a, pa.id, b, pb.id)
    state.counts.trades.none += 1
    await refuseReverse(t)
    await expectStatus(t, 'complete', 'trade B after the commissioner tried to reverse it (refused — 174)')
    inTrades.add(a.teamId).add(b.teamId)
    state.counts.reverseRefused += 1
    note(`trade B (no review): ${pa.position} ${pa.id} ↔ ${pb.id}${priced ? ' + $3' : ''} — complete at accept; the commissioner's reverse REFUSED by name (174), the trade stands`)
  }
  // C — league vote (L.D3.4): one veto + one approve (below the number), then
  // the tick executes it at a virtual instant past the review deadline.
  await setting('trade_review', 'league_vote')
  {
    const { a, b, pa, pb } = world.pickTrade(others, inTrades)
    const t = await propose(a, b, pa.id, pb.id, 0)
    await accept(b, t)
    await expectStatus(t, 'in_review', 'trade C after accept (league vote)')
    const voters = others.filter((s) => s !== a && s !== b).slice(0, 2)
    if (voters.length < 2) throw new StepError('fewer than two managers outside trade C to vote on it')
    for (const [voter, vote] of [
      [voters[0]!, 'veto'],
      [voters[1]!, 'approve'],
    ] as const) {
      const { error } = await rpc(voter.client)('trade_vote', {
        p_league_id: league.leagueId,
        p_trade_id: t,
        p_vote: vote,
        p_action_id: uuidFromRng(ids),
      })
      if (error) throw new StepError(`trade_vote ${vote} by team ${voter.teamId}: ${error.message}`)
      state.counts.votes += 1
    }
    await expectStatus(t, 'in_review', 'trade C after one veto + one approve (below the number)')
    const tickAt = new Date(runAt.getTime() + HOUR_MS)
    if (tickAt.getTime() >= opens.getTime()) throw new StepError(`the trade tick instant ${tickAt.toISOString()} is not before the first driven week`)
    await tick(deps, 'trade_tick', league.leagueId, tickAt, tradeDue(deps, league.leagueId))
    instants.push(tickAt.toISOString())
    await expectStatus(t, 'complete', `trade C after trade_tick@${tickAt.toISOString()} (review deadline passed)`)
    swap(a, pa.id, b, pb.id)
    state.counts.trades.league_vote += 1
    note(`trade C (league vote): ${pa.position} ${pa.id} ↔ ${pb.id} — 1 veto + 1 approve, executed by trade_tick@${tickAt.toISOString()}`)
  }

  // ---- 5. ONE COMMISSIONER FAAB REPAIR -----------------------------------
  {
    const target = others[others.length - 1]!
    const before = await readBalance(service, league.leagueId, target.teamId)
    if (before === null) throw new StepError(`team ${target.teamId} has no FAAB balance to repair`)
    ok(
      `commish_edit_faab team ${target.teamId}`,
      await commishEditFaab(commish, league.leagueId, { team_id: target.teamId, balance: before + 5, action_id: uuidFromRng(ids) }),
    )
    state.counts.commishFaabEdits += 1
    note(`commish_edit_faab: team ${target.teamId} $${before} → $${before + 5}`)
  }

  // ---- 6. ADD / DROP under free agency ------------------------------------
  await setting('waiver_type', 'none_fcfs')
  const adders = [...others].reverse().filter((s) => world.addDropPosition(s.teamId) !== undefined).slice(0, 2)
  if (adders.length === 0) throw new StepError(`no seat can make a like-for-like add/drop — ${world.depth(others.map((s) => s.teamId))}`)
  for (const seat of adders) {
    const at = world.addDropPosition(seat.teamId)!
    const add = world.freeAgent(at)
    const drop = world.take(seat.teamId, at)
    ok(
      `add/drop ${add.id}/${drop.id} for team ${seat.teamId}`,
      await submitAddDrop(seat.client, league.leagueId, {
        team_id: seat.teamId,
        add_player_id: add.id,
        drop_player_id: drop.id,
        action_id: uuidFromRng(ids),
      }),
    )
    state.expectedHolder.set(add.id, seat.teamId)
    state.expectedHolder.set(drop.id, null)
    state.counts.addDrops += 1
  }
  note(`add/drop: ${state.counts.addDrops} instant pickup(s) under none_fcfs (switched through commish_change_setting)`)
}

/**
 * The Ghost's SEAT CLAIM (step 7) — run at the season's first `finalize`
 * beat, so the franchise spent at least its first driven week unmanaged. The
 * successor is a NEW user (runner banner job 9).
 */
export async function ghostSeatClaim(
  deps: TransactDeps,
  leagues: readonly TransactLeague[],
  run: TransactRun,
  openedWeeks: readonly number[],
  successorIndex: { next: number },
): Promise<void> {
  for (const league of leagues) {
    const state = run.byLeague.get(league.leagueId)
    const ghost = state?.ghost
    if (state === undefined || ghost === null || ghost === undefined || state.aborted !== null) continue
    if (ghost.successorUserId !== null) continue
    try {
      const commish = deps.bots.get(league.ownerId ?? '')
      if (commish === undefined) throw new StepError('no signed-in commissioner client')
      ghost.orphanWeeks = [...openedWeeks]
      const invite = ok(
        `seat invite for team ${ghost.teamId}`,
        await createInvite(commish, league.leagueId, { target_team_id: ghost.teamId }),
        [200, 201],
      )
      const token = String(invite.token ?? '')
      const n = successorIndex.next++
      const username = `${SIM_USERNAME_PREFIX}g${String(n).padStart(2, '0')}`
      const email = `sim-b6-bot-g${String(n).padStart(2, '0')}@fieldscout.test`
      const { data: created, error: createError } = await deps.service.auth.admin.createUser({
        email,
        password: SIM_BOT_PASSWORD,
        email_confirm: true,
        user_metadata: { username },
      })
      if (createError) throw new StepError(`successor createUser ${username}: ${createError.message}`)
      const client = createClient<Database>(deps.url, deps.anonKey, { auth: { persistSession: false } })
      const { error: signInError } = await client.auth.signInWithPassword({ email, password: SIM_BOT_PASSWORD })
      if (signInError) throw new StepError(`successor sign-in ${username}: ${signInError.message}`)
      const claimed = ok(`seat claim by ${username}`, await claimInvite(client, { token }))
      if (claimed.team_id !== ghost.teamId) throw new StepError(`the seat claim seated ${String(claimed.team_id)}, not team ${ghost.teamId}`)
      ghost.successorUserId = created.user.id
      ghost.successorClient = client
      ghost.balanceAfterTakeover = await readBalance(deps.service, league.leagueId, ghost.teamId)
      ghost.incomplete = null
      state.lines.push(
        `ghost: seat CLAIMED by ${username} after week(s) ${openedWeeks.join(',') || '(none)'} unmanaged — FAAB $${ghost.balanceAtVacate} → $${ghost.balanceAfterTakeover}`,
      )
    } catch (e) {
      ghost.incomplete = (e as Error).message
      deps.log(`${league.label}: GHOST SEAT CLAIM FAILED — ${ghost.incomplete}`)
    }
  }
}

/**
 * `--probe` (runner banner job 10): ONE fault in the sim's own league, planted
 * after the season is driven and before the sweep, so the named invariant
 * must turn the run RED. `claim-privacy` plants nothing — it is applied at
 * collection (one viewer's read goes through the service client, i.e. an RLS
 * that stopped filtering).
 */
export async function applyBreakProbe(deps: TransactDeps, run: TransactRun, probe: TransactionProbe): Promise<string> {
  const state = [...run.byLeague.values()].find((s) => s.aborted === null)
  if (state === undefined) throw new Error(`--probe ${probe}: no league completed its transacting script`)
  const { service } = deps
  if (probe === 'exclusivity') {
    const [playerId, teamId] = [...state.expectedHolder.entries()].find(([, t]) => t !== null) ?? []
    if (playerId === undefined || teamId === undefined || teamId === null) throw new Error('--probe exclusivity: no moved player to misplace')
    const other = must(
      'probe: teams',
      await service.from('teams').select('id').eq('league_id', state.leagueId).neq('id', teamId).order('id').limit(1),
    )[0]!
    must(
      'probe: roster move',
      await service.from('league_rosters').update({ team_id: other.id }).eq('league_id', state.leagueId).eq('player_id', playerId).select('player_id'),
    )
    return `exclusivity: ${state.label} — ${playerId}'s roster row moved from team ${teamId} to team ${other.id} with NO transaction`
  }
  if (probe === 'faab-ledger') {
    const seat = must(
      'probe: seat',
      await service.from('league_members').select('id, team_id, faab_balance').eq('league_id', state.leagueId).not('team_id', 'is', null).order('id').limit(1),
    )[0]!
    must(
      'probe: balance write',
      await service.from('league_members').update({ faab_balance: (seat.faab_balance ?? 0) + 1 }).eq('id', seat.id).select('id'),
    )
    return `faab-ledger: ${state.label} — team ${seat.team_id}'s balance $${seat.faab_balance} → $${(seat.faab_balance ?? 0) + 1} with NO receipt`
  }
  if (probe === 'pool-mirror') {
    const row = must(
      'probe: pool row',
      await service.from('league_player_pool').select('player_id').eq('league_id', state.leagueId).eq('state', 'rostered').order('player_id').limit(1),
    )[0]
    if (row === undefined) throw new Error('--probe pool-mirror: no rostered pool row to flip')
    must(
      'probe: pool write',
      await service
        .from('league_player_pool')
        .update({ state: 'free_agent', waivers_until: null })
        .eq('league_id', state.leagueId)
        .eq('player_id', row.player_id)
        .select('player_id'),
    )
    return `pool-mirror: ${state.label} — ${row.player_id}'s pool row flipped rostered → free_agent while a roster still holds him`
  }
  return `claim-privacy: ${state.label} — one non-commissioner viewer's claims read goes through the SERVICE client (an RLS that stopped filtering)`
}

/** Collect one league's transaction audit (service reads + each viewer's own). */
export async function collectTransactionAudit(
  deps: TransactDeps,
  state: LeagueTransactState,
  league: TransactLeague,
  probe: TransactionProbe | null,
  probeLeagueId: string | null,
): Promise<TransactionAudit> {
  const { service } = deps
  const leagueId = state.leagueId
  const lg = must('league read', await service.from('leagues').select('faab_budget').eq('id', leagueId).single())
  const members = must('members read', await service.from('league_members').select('user_id, team_id, role, faab_balance').eq('league_id', leagueId))
  const rosters = must('rosters read', await service.from('league_rosters').select('team_id, player_id, id').eq('league_id', leagueId).order('id'))
  const txns = must('txns read', await service.from('transactions').select('id, type, status, initiator_team_id, payload').eq('league_id', leagueId))
  const edits = must(
    'edit_faab read',
    await service.from('commissioner_actions').select('target_id, before, after').eq('league_id', leagueId).eq('action_type', 'edit_faab'),
  )
  const claims = must('claims read', await service.from('waiver_claims').select('id, team_id, status').eq('league_id', leagueId).order('id'))
  const pool = must('pool read', await service.from('league_player_pool').select('player_id, state').eq('league_id', leagueId))

  // Every viewer, through his OWN client: each bot seated in the league, the
  // successor, and the ghost (former member).
  const ghost = state.ghost
  const viewers: Array<{ name: string; client: Supabase; userId: string; former: boolean }> = []
  for (const m of members) {
    if (m.user_id === null) continue
    const client = deps.bots.get(m.user_id) ?? (ghost?.successorUserId === m.user_id ? ghost.successorClient : null)
    if (client === null || client === undefined) continue
    viewers.push({ name: `user ${m.user_id}`, client, userId: m.user_id, former: false })
  }
  if (ghost !== null) {
    const client = deps.bots.get(ghost.ghostUserId)
    if (client !== undefined && !members.some((m) => m.user_id === ghost.ghostUserId)) {
      viewers.push({ name: `ghost ${ghost.ghostUserId}`, client, userId: ghost.ghostUserId, former: true })
    }
  }
  let probed = false
  const views: AuditClaimView[] = []
  for (const v of viewers) {
    const member = members.find((m) => m.user_id === v.userId)
    const commissioner = member?.role === 'commissioner' || member?.role === 'co_commissioner'
    const breakThisRead = probe === 'claim-privacy' && probeLeagueId === leagueId && !probed && !commissioner && !v.former
    if (breakThisRead) probed = true
    const reader = breakThisRead ? service : v.client
    const visible = must(
      `${v.name} claims read`,
      await reader.from('waiver_claims').select('id, team_id, status').eq('league_id', leagueId),
    ) as AuditClaimRow[]
    views.push({ viewer: v.name, teamId: member?.team_id ?? null, commissioner, former: v.former, visible })
  }

  let ghostAudit: AuditGhost | null = null
  if (ghost !== null) {
    const stints = must(
      'stints read',
      await service.from('team_managers').select('user_id, started_at, ended_at').eq('team_id', ghost.teamId).order('started_at'),
    )
    ghostAudit = {
      teamId: ghost.teamId,
      ghostUserId: ghost.ghostUserId,
      successorUserId: ghost.successorUserId,
      spentBeforeVacate: ghost.spent,
      waiverType: state.waiverType,
      balanceAtVacate: ghost.balanceAtVacate,
      balanceAfterTakeover: ghost.balanceAfterTakeover,
      budget: lg.faab_budget ?? 0,
      ghostVisibleClaims: ghost.ghostVisibleClaims,
      ghostSubmitStatus: ghost.ghostSubmitStatus,
      orphanWeeks: ghost.orphanWeeks.map((week) => ({ week, autopilotedByServer: league.autopilotedSeatWeeks.has(`${ghost.teamId}|${week}`) })),
      stints,
      incomplete: ghost.incomplete,
    }
  }

  return {
    leagueLabel: state.label,
    leagueId,
    faabBudget: lg.faab_budget ?? 0,
    balances: members.filter((m) => m.team_id !== null).map((m) => ({ team_id: m.team_id!, faab_balance: m.faab_balance })),
    rosters,
    txns: txns.map((t) => ({ ...t, payload: (t.payload ?? {}) as Record<string, unknown> })),
    commishFaabEdits: edits.map((e) => ({
      target_id: String(e.target_id),
      before: typeof (e.before as { faab_balance?: unknown } | null)?.faab_balance === 'number' ? ((e.before as { faab_balance: number }).faab_balance) : null,
      after: typeof (e.after as { faab_balance?: unknown } | null)?.faab_balance === 'number' ? ((e.after as { faab_balance: number }).faab_balance) : null,
    })),
    expectedHolder: state.expectedHolder,
    claims,
    views,
    pool,
    ghost: ghostAudit,
  }
}
