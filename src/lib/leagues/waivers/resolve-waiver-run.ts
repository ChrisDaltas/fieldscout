/**
 * resolve-waiver-run.ts — THE REFERENCE WAIVER RESOLVER (M5 task L.D2.8,
 * FULL rigour: it decides who gets players and how much FAAB is spent).
 *
 * Spec §13.2 (process-waivers), §7.3.4 (waiver_type / faab_tiebreaker /
 * caps), §13.1 (the game-day lock rule, E32), E7, E33, E34; tasks-M5 TD7
 * ("one reference resolver, two implementations") and TD8 (priority on the
 * seat). Chris's rulings 2026-09-27 (PROGRESS §3, "approve M5, all
 * recommendations"):
 *
 *   Q71 — the highest bid on a player always wins him; a team's own claim
 *         ranking only settles clashes between ITS OWN claims (two claims
 *         dropping the same player, not enough budget / room for both); a
 *         team can win several players in one run, each claim valid when its
 *         turn comes.
 *   Q72 — before week 1 is final, waiver priority is REVERSE DRAFT ORDER
 *         (last pick of round 1 first); after that reverse standings or the
 *         rolling order as the league chose; rolling starts from reverse
 *         draft order and a team moves to the back only when it wins.
 *   Q73 — a claim whose DROP player has kicked off this week fails
 *         (`drop_locked`, no FAAB) — `bench_lock` retires; there is no
 *         "off" position (E34 is unreachable).
 *   Q74 — a claim on a player whose game has kicked off fails at the run
 *         (`add_locked`, no FAAB) rather than waiting for a later run.
 *
 * PURE and DETERMINISTIC: no clock, no I/O, no randomness. Every lock fact is
 * an INPUT (`lockedPlayerIds` — the players whose game has kicked off and
 * whose week has not cleared at the run instant, i.e. what
 * `pool_game_lock_any_internal(season, week, team, p_at)` says for each), so
 * the TimeProvider rule is honoured by construction: the caller evaluates the
 * lock at its `p_at`, this function never asks what time it is.
 *
 * THIS IS THE CONTRACT L.D2.9's SQL PROCESSOR MUST MATCH BYTE FOR BYTE
 * (`waivers-resolver-parity-db.test.ts`): feed both the same claim set,
 * compare `serializeWaiverRunResult(resolveWaiverRun(input))` with the SQL
 * run's result in the same shape. Everything that could vary between the two
 * implementations is pinned here:
 *   - ids (claim, team, player) are compared as plain code-unit strings —
 *     SQL must order them `COLLATE "C"` (a UUID's `::text` is lower-case hex,
 *     so byte order = code-unit order);
 *   - input ARRAY ORDER NEVER MATTERS (claims, teams, rosters, locks are
 *     sets); the only ordered inputs are the priority sources, which are
 *     semantic;
 *   - the failure-reason precedence (FAIL_CHECK_ORDER below) and the
 *     decision sequence (`decision`, 1..N) are part of the output.
 *
 * ── THE ALGORITHM ──────────────────────────────────────────────────────────
 * Each claim's EFFECTIVE BID is its `faabBid` in a FAAB league and 0 under a
 * priority waiver type (priority leagues spend no money, §13.2 — a stray bid
 * left over from a mid-season settings change is ignored, never charged).
 * Between two TEAMS a player goes to the higher effective bid, then the
 * better current priority position (E7's tiebreaker) — strict, two teams
 * never share a position. Between a team's OWN claims on one player (same
 * add, different drops) the team's ranking decides (Q71): the team wins
 * through its highest-ranked claim on him that still beats the strongest
 * other team's claim. Turn order across players uses the full key
 *     (effective bid DESC, priority position ASC, claim_order ASC, claim id ASC).
 *
 * Repeat until nothing is pending:
 *   1. FAIL every pending claim that cannot go through against the CURRENT
 *      state (FAIL_CHECK_ORDER, first failing check names the reason; claims
 *      in id order). Every check is monotone — balances only fall, rosters
 *      only fill, a dropped player never comes back, caps only fill — so a
 *      failed claim can never become valid again, and a pending claim is
 *      always one that could be executed right now.
 *   2. For each player, the TOP claim is the one that would take him at this
 *      turn: the strongest team's highest-ranked claim that beats every
 *      other team's pending claim on him.
 *   3. A claim is READY when it stays valid however its team's
 *      higher-ranked pending claims (on other players) turn out: budget,
 *      room, drop and caps are checked with all of them counted as won
 *      (at most one per player). Awarding a ready claim therefore never
 *      costs its team a claim it ranked higher — Q71's "a team's own ranking
 *      settles running out, in its own ranking order". A team's first
 *      pending claim is always ready.
 *   4. Award the STRONGEST READY TOP (highest bid first across players, the
 *      classic "bids processed from the top" turn order). Its player's other
 *      pending claims are decided at once: another team's → `lost`
 *      (`outbid` when its bid was lower, `lost_on_priority` when equal), the
 *      same team's → `invalid` (`own_claim_won`). Under rolling priority the
 *      winner moves to the back NOW, so the next turn sees the new order.
 *   5. DEADLOCK BREAK. If no top is ready, every top is waiting on its own
 *      team's higher-ranked claims, which are themselves outbid — a cycle
 *      (A: #1 X $10, #2 Y $50; B: #1 Y $10, #2 X $50; both $50 budgets). Two
 *      self-consistent outcomes exist; Q71's "the highest bid on a player
 *      ALWAYS wins him" picks the one where the high bids win: take the
 *      strongest top overall; its team's highest-ranked TOP claim is awarded
 *      (`deadlockBreak: true`). Its own team's higher-ranked claims were all
 *      outbid at that moment; any the award now makes unaffordable fail on
 *      the next pass (PROGRESS D389(4)).
 *   Each iteration decides at least one claim, so the loop ends in ≤ N turns.
 *
 * Priority (Q72 / TD8): the START ORDER is the stored rolling order
 * (`priority.rolling`) when the league rotates and it has been seeded, else
 * reverse standings once week 1 is final (`priority.standings` non-null),
 * else reverse draft order. The league ROTATES iff waiver_type is
 * `rolling_priority`, or `faab` with `faab_tiebreaker = rolling_priority`;
 * then every win moves the winner to the back (non-winners keep their
 * relative order). Under `reverse_standings` the order is recomputed from the
 * standings each run and a win does not move a team (§13.2: "winner drops to
 * the back (rolling) or order resets by reverse standings" — PROGRESS
 * D389(3), flagged for Chris in F422).
 */

// ── Public types ─────────────────────────────────────────────────────────────

/** The waiver types that decide claims (`none_fcfs` has no claims —
 *  145's submit refuses them; the resolver refuses the type by name). */
export const WAIVER_CLAIM_TYPES = ['faab', 'rolling_priority', 'reverse_standings'] as const
export type WaiverClaimType = (typeof WAIVER_CLAIM_TYPES)[number]

export const FAAB_TIEBREAKERS = ['reverse_standings', 'rolling_priority'] as const
export type FaabTiebreaker = (typeof FAAB_TIEBREAKERS)[number]

export interface WaiverRunSettings {
  waiverType: WaiverClaimType
  /** Read only when `waiverType = 'faab'` (§7.3.4). */
  faabTiebreaker: FaabTiebreaker
  /** Roster capacity — starting slots + bench + IR, exactly 115's count. */
  rosterSize: number
  /** `acquisitions_per_week` / `_per_season`; null = unlimited. */
  acquisitionsPerWeek: number | null
  acquisitionsPerSeason: number | null
}

export interface WaiverRunTeam {
  teamId: string
  /** Player ids on this team's roster when the run starts. */
  roster: string[]
  /** `league_members.faab_balance` for the team's seat. Required (integer ≥ 0)
   *  in a FAAB league for every active team that has a claim. */
  faabBalance: number | null
  /** Acquisitions already used (115's count: `complete` transactions whose
   *  payload carries `add_player_id`) this week / this season. */
  acquisitionsWeek: number
  acquisitionsSeason: number
  /** A sealed (retired) franchise — its claims fail `team_retired` and it holds
   *  no waiver priority (F408). */
  retired: boolean
}

export interface WaiverRunClaim {
  claimId: string
  teamId: string
  addPlayerId: string
  dropPlayerId: string | null
  faabBid: number
  /** The team's own ranking — 1 = try first (§12.10 `claim_order`). */
  claimOrder: number
}

export interface WaiverRunPrioritySources {
  /** Round-1 pick order as drafted, first pick first (Q72 reverses it). */
  draftOrder: string[]
  /** Final standings, best team first; null until week 1 is final (Q72). */
  standings: string[] | null
  /** Stored `league_members.waiver_priority` per team (1 = first); null until
   *  the first run seeds it (TD8). */
  rolling: Record<string, number> | null
}

export interface WaiverRunInput {
  settings: WaiverRunSettings
  teams: WaiverRunTeam[]
  claims: WaiverRunClaim[]
  priority: WaiverRunPrioritySources
  /** Players locked at the run instant (kicked off, week not cleared — E32 /
   *  Q34(B)); computed by the caller at its `p_at`. */
  lockedPlayerIds: string[]
}

/** Why a claim did not go through. `lost` = another team's claim won the
 *  player in this run; `invalid` = the claim could not go through for its own
 *  reasons. The DB column (`waiver_claims.result_reason`) stores these words. */
export const WAIVER_LOST_REASONS = ['outbid', 'lost_on_priority'] as const
export const WAIVER_INVALID_REASONS = [
  'team_retired',
  'add_rostered',
  'add_locked',
  'drop_gone',
  'drop_locked',
  'roster_full',
  'cap_reached',
  'insufficient_faab',
  'own_claim_won',
] as const
export type WaiverLostReason = (typeof WAIVER_LOST_REASONS)[number]
export type WaiverInvalidReason = (typeof WAIVER_INVALID_REASONS)[number]
export type WaiverFailReason = WaiverLostReason | WaiverInvalidReason

/** The pass-1 checks, in precedence order — the FIRST failing one names the
 *  reason (parity-relevant: the SQL twin must test in this order). */
export const FAIL_CHECK_ORDER = [
  'team_retired',
  'add_rostered',
  'add_locked',
  'drop_gone',
  'drop_locked',
  'roster_full',
  'cap_reached',
  'insufficient_faab',
] as const satisfies readonly WaiverInvalidReason[]

export type WaiverClaimOutcome =
  | {
      /** 1..N — the order decisions were made in. */
      decision: number
      claimId: string
      teamId: string
      addPlayerId: string
      dropPlayerId: string | null
      status: 'won'
      reason: null
      /** The effective bid, debited from the team's balance. */
      faabSpent: number
      /** Awarded by step 5 (a cycle), not as a ready top. */
      deadlockBreak: boolean
    }
  | {
      decision: number
      claimId: string
      teamId: string
      addPlayerId: string
      dropPlayerId: string | null
      status: 'lost' | 'invalid'
      reason: WaiverFailReason
      /** Always 0 — a claim that does not go through never spends FAAB. */
      faabSpent: 0
      deadlockBreak: false
    }

export interface WaiverRunTeamResult {
  teamId: string
  faabBefore: number | null
  faabAfter: number | null
  /** Sorted by player id. */
  rosterAfter: string[]
  acquisitionsWeekAfter: number
  acquisitionsSeasonAfter: number
}

export type WaiverPrioritySource = 'rolling' | 'reverse_standings' | 'reverse_draft_order'

export interface WaiverRunResult {
  /** Every input claim exactly once, in decision order. */
  outcomes: WaiverClaimOutcome[]
  /** Every input team, sorted by team id. */
  teams: WaiverRunTeamResult[]
  priority: {
    /** Where the start order came from (Q72 / TD8). */
    source: WaiverPrioritySource
    /** Whether a win moves the winner to the back (rolling). */
    rotates: boolean
    /** Active team ids, first priority first, at the start of the run. */
    before: string[]
    /** After the run (== `before` when the league does not rotate). The value
     *  L.D2.9 writes to `league_members.waiver_priority` (1-based) when
     *  `rotates` — including the first run's lazy seeding. */
    after: string[]
  }
}

/** Bad input — the caller's data is inconsistent (a player on two rosters, a
 *  priority list that is not the active teams, …). Loud by design: the
 *  resolver never guesses around corrupt state. */
export class WaiverRunInputError extends Error {
  constructor(message: string) {
    super(`resolveWaiverRun: ${message}`)
    this.name = 'WaiverRunInputError'
  }
}

// ── Internals ────────────────────────────────────────────────────────────────

interface LiveClaim extends WaiverRunClaim {
  done: boolean
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function isNonNegInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0
}

/** `h` is ranked above `c` by their (shared) team: claim_order, then id. */
function rankedAbove(h: WaiverRunClaim, c: WaiverRunClaim): boolean {
  return h.claimOrder < c.claimOrder || (h.claimOrder === c.claimOrder && h.claimId < c.claimId)
}

function validate(input: WaiverRunInput): void {
  const { settings, teams, claims, priority, lockedPlayerIds } = input
  if ((settings.waiverType as string) === 'none_fcfs') {
    throw new WaiverRunInputError(
      'waiver type "none_fcfs" has no waivers — there is nothing to resolve (§7.3.4); the caller decides what happens to claims left pending by a settings change',
    )
  }
  if (!(WAIVER_CLAIM_TYPES as readonly string[]).includes(settings.waiverType)) {
    throw new WaiverRunInputError(`unknown waiver type "${String(settings.waiverType)}"`)
  }
  if (!(FAAB_TIEBREAKERS as readonly string[]).includes(settings.faabTiebreaker)) {
    throw new WaiverRunInputError(`unknown faab_tiebreaker "${String(settings.faabTiebreaker)}"`)
  }
  if (!isNonNegInt(settings.rosterSize)) {
    throw new WaiverRunInputError(`rosterSize must be a whole number ≥ 0 (got ${String(settings.rosterSize)})`)
  }
  for (const [name, cap] of [
    ['acquisitionsPerWeek', settings.acquisitionsPerWeek],
    ['acquisitionsPerSeason', settings.acquisitionsPerSeason],
  ] as const) {
    if (cap !== null && !isNonNegInt(cap)) {
      throw new WaiverRunInputError(`${name} must be null or a whole number ≥ 0 (got ${String(cap)})`)
    }
  }

  const teamIds = new Set<string>()
  const owner = new Map<string, string>()
  for (const t of teams) {
    if (typeof t.teamId !== 'string' || t.teamId === '') throw new WaiverRunInputError('a team has no id')
    if (teamIds.has(t.teamId)) throw new WaiverRunInputError(`team ${t.teamId} is listed twice`)
    teamIds.add(t.teamId)
    if (t.faabBalance !== null && !isNonNegInt(t.faabBalance)) {
      throw new WaiverRunInputError(`team ${t.teamId} has FAAB balance ${String(t.faabBalance)} — a balance is a whole number ≥ 0 (TD2)`)
    }
    if (!isNonNegInt(t.acquisitionsWeek) || !isNonNegInt(t.acquisitionsSeason)) {
      throw new WaiverRunInputError(`team ${t.teamId} has a non-whole acquisition count`)
    }
    for (const p of t.roster) {
      const prev = owner.get(p)
      if (prev !== undefined) {
        throw new WaiverRunInputError(
          `player ${p} is on ${prev === t.teamId ? `team ${prev}'s roster twice` : `two rosters (${prev} and ${t.teamId})`} — exclusivity is already broken; refusing to resolve on corrupt rosters`,
        )
      }
      owner.set(p, t.teamId)
    }
  }

  const claimIds = new Set<string>()
  for (const c of claims) {
    if (typeof c.claimId !== 'string' || c.claimId === '') throw new WaiverRunInputError('a claim has no id')
    if (claimIds.has(c.claimId)) throw new WaiverRunInputError(`claim ${c.claimId} is listed twice`)
    claimIds.add(c.claimId)
    if (!teamIds.has(c.teamId)) throw new WaiverRunInputError(`claim ${c.claimId} names team ${c.teamId}, which is not in the run`)
    if (typeof c.addPlayerId !== 'string' || c.addPlayerId === '') throw new WaiverRunInputError(`claim ${c.claimId} has no add player`)
    if (c.dropPlayerId !== null && (typeof c.dropPlayerId !== 'string' || c.dropPlayerId === '')) {
      throw new WaiverRunInputError(`claim ${c.claimId} has an empty drop player id (use null for no drop)`)
    }
    if (c.dropPlayerId === c.addPlayerId) throw new WaiverRunInputError(`claim ${c.claimId} adds and drops the same player`)
    if (!isNonNegInt(c.faabBid)) throw new WaiverRunInputError(`claim ${c.claimId} has bid ${String(c.faabBid)} — a bid is a whole number ≥ 0`)
    if (!Number.isInteger(c.claimOrder) || c.claimOrder < 1) {
      throw new WaiverRunInputError(`claim ${c.claimId} has claim_order ${String(c.claimOrder)} — 1 or more`)
    }
  }

  const activeTeams = teams.filter((t) => !t.retired)
  if (settings.waiverType === 'faab') {
    const withClaims = new Set(claims.map((c) => c.teamId))
    for (const t of activeTeams) {
      if (withClaims.has(t.teamId) && t.faabBalance === null) {
        throw new WaiverRunInputError(
          `team ${t.teamId} has claims in a FAAB league but no FAAB balance on record — refusing to settle bids against money that is not recorded (§12.2)`,
        )
      }
    }
  }
  for (const p of lockedPlayerIds) {
    if (typeof p !== 'string' || p === '') throw new WaiverRunInputError('lockedPlayerIds holds an empty id')
  }
  // The priority sources are validated where they are used (startOrder).
  void priority
}

function assertPermutation(list: string[], active: Set<string>, what: string): void {
  const seen = new Set<string>()
  for (const id of list) {
    if (!active.has(id)) {
      throw new WaiverRunInputError(`${what} lists ${id}, which is not an active (non-retired) team in the run`)
    }
    if (seen.has(id)) throw new WaiverRunInputError(`${what} lists ${id} twice`)
    seen.add(id)
  }
  if (seen.size !== active.size) {
    const missing = [...active].filter((id) => !seen.has(id)).sort(cmpStr)
    throw new WaiverRunInputError(`${what} is missing active team(s) ${missing.join(', ')} — it must order exactly the active teams`)
  }
}

function startOrder(
  input: WaiverRunInput,
  rotates: boolean,
): { source: WaiverPrioritySource; order: string[] } {
  const active = new Set(input.teams.filter((t) => !t.retired).map((t) => t.teamId))
  const { draftOrder, standings, rolling } = input.priority
  if (rotates && rolling !== null) {
    const ids = Object.keys(rolling)
    assertPermutation(ids, active, 'the stored rolling priority')
    const values = new Set<number>()
    for (const id of ids) {
      const v = rolling[id]
      if (!Number.isInteger(v) || v < 1) throw new WaiverRunInputError(`team ${id} has waiver priority ${String(v)} — 1 or more`)
      if (values.has(v)) throw new WaiverRunInputError(`two teams hold waiver priority ${v}`)
      values.add(v)
    }
    return { source: 'rolling', order: ids.sort((a, b) => rolling[a] - rolling[b]) }
  }
  if (!rotates && standings !== null) {
    assertPermutation(standings, active, 'the standings')
    return { source: 'reverse_standings', order: [...standings].reverse() }
  }
  assertPermutation(draftOrder, active, 'the draft order')
  return { source: 'reverse_draft_order', order: [...draftOrder].reverse() }
}

// ── The resolver ─────────────────────────────────────────────────────────────

export function resolveWaiverRun(input: WaiverRunInput): WaiverRunResult {
  validate(input)
  const { settings } = input
  const faab = settings.waiverType === 'faab'
  const rotates =
    settings.waiverType === 'rolling_priority' ||
    (faab && settings.faabTiebreaker === 'rolling_priority')
  const { source, order: before } = startOrder(input, rotates)
  let order = [...before]

  // State (mutated by awards only).
  const rosterOwner = new Map<string, string>()
  const count = new Map<string, number>()
  const balance = new Map<string, number | null>()
  const accWeek = new Map<string, number>()
  const accSeason = new Map<string, number>()
  const retired = new Set<string>()
  for (const t of input.teams) {
    for (const p of t.roster) rosterOwner.set(p, t.teamId)
    count.set(t.teamId, t.roster.length)
    balance.set(t.teamId, t.faabBalance)
    accWeek.set(t.teamId, t.acquisitionsWeek)
    accSeason.set(t.teamId, t.acquisitionsSeason)
    if (t.retired) retired.add(t.teamId)
  }
  const locked = new Set(input.lockedPlayerIds)
  const effBid = (c: WaiverRunClaim): number => (faab ? c.faabBid : 0)
  const net = (c: WaiverRunClaim): number => (c.dropPlayerId === null ? 1 : 0)

  const claims: LiveClaim[] = input.claims
    .map((c) => ({ ...c, done: false }))
    .sort((a, b) => cmpStr(a.claimId, b.claimId))
  const outcomes: WaiverClaimOutcome[] = []

  const fail = (c: LiveClaim, status: 'lost' | 'invalid', reason: WaiverFailReason): void => {
    c.done = true
    outcomes.push({
      decision: outcomes.length + 1,
      claimId: c.claimId,
      teamId: c.teamId,
      addPlayerId: c.addPlayerId,
      dropPlayerId: c.dropPlayerId,
      status,
      reason,
      faabSpent: 0,
      deadlockBreak: false,
    })
  }

  /** Step 1's check against the CURRENT state; null = could go through now. */
  const absoluteFailure = (c: WaiverRunClaim): WaiverInvalidReason | null => {
    const team = c.teamId
    if (retired.has(team)) return 'team_retired'
    if (rosterOwner.has(c.addPlayerId)) return 'add_rostered'
    if (locked.has(c.addPlayerId)) return 'add_locked'
    if (c.dropPlayerId !== null && rosterOwner.get(c.dropPlayerId) !== team) return 'drop_gone'
    if (c.dropPlayerId !== null && locked.has(c.dropPlayerId)) return 'drop_locked'
    if ((count.get(team) ?? 0) + net(c) > settings.rosterSize) return 'roster_full'
    if (
      (settings.acquisitionsPerWeek !== null && (accWeek.get(team) ?? 0) >= settings.acquisitionsPerWeek) ||
      (settings.acquisitionsPerSeason !== null && (accSeason.get(team) ?? 0) >= settings.acquisitionsPerSeason)
    ) {
      return 'cap_reached'
    }
    if (faab && effBid(c) > (balance.get(team) ?? 0)) return 'insufficient_faab'
    return null
  }

  /** Step 3 — valid however the team's higher-ranked pending claims on OTHER
   *  players turn out (each counted as won, at most one per player). */
  const isReady = (c: LiveClaim, pending: LiveClaim[]): boolean => {
    const higher = pending.filter(
      (h) => h.teamId === c.teamId && h !== c && h.addPlayerId !== c.addPlayerId && rankedAbove(h, c),
    )
    if (higher.length === 0) return true
    const groups = new Map<string, { bid: number; net: number }>()
    for (const h of higher) {
      const g = groups.get(h.addPlayerId) ?? { bid: 0, net: 0 }
      g.bid = Math.max(g.bid, effBid(h))
      g.net = Math.max(g.net, net(h))
      groups.set(h.addPlayerId, g)
    }
    let reservedBid = 0
    let reservedNet = 0
    for (const g of groups.values()) {
      reservedBid += g.bid
      reservedNet += g.net
    }
    const team = c.teamId
    if (faab && (balance.get(team) ?? 0) - reservedBid < effBid(c)) return false
    if (c.dropPlayerId !== null && higher.some((h) => h.dropPlayerId === c.dropPlayerId)) return false
    if ((count.get(team) ?? 0) + reservedNet + net(c) > settings.rosterSize) return false
    const n = groups.size
    if (settings.acquisitionsPerWeek !== null && (accWeek.get(team) ?? 0) + n + 1 > settings.acquisitionsPerWeek) return false
    if (settings.acquisitionsPerSeason !== null && (accSeason.get(team) ?? 0) + n + 1 > settings.acquisitionsPerSeason) return false
    return true
  }

  for (;;) {
    // Step 1.
    for (const c of claims) {
      if (c.done) continue
      const r = absoluteFailure(c)
      if (r !== null) fail(c, 'invalid', r)
    }
    const pending = claims.filter((c) => !c.done)
    if (pending.length === 0) break

    // Step 2 — strength under the CURRENT order. Between two teams: bid, then
    // priority (strict — two teams never share a position). Within one team
    // on one player the team's own ranking decides (Q71: its ranking settles
    // clashes between its own claims): the team whose best claim is
    // strongest wins the player, through its HIGHEST-RANKED claim on him that
    // still beats the strongest other team's claim (the rival is judged at
    // this turn).
    const pos = new Map(order.map((id, i) => [id, i]))
    const teamwise = (a: LiveClaim, b: LiveClaim): number =>
      effBid(b) - effBid(a) ||
      (pos.get(a.teamId) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.teamId) ?? Number.MAX_SAFE_INTEGER)
    const stronger = (a: LiveClaim, b: LiveClaim): number =>
      teamwise(a, b) || a.claimOrder - b.claimOrder || cmpStr(a.claimId, b.claimId)
    const byRank = (a: LiveClaim, b: LiveClaim): number =>
      a.claimOrder - b.claimOrder || cmpStr(a.claimId, b.claimId)
    const byPlayer = new Map<string, LiveClaim[]>()
    for (const c of pending) {
      const list = byPlayer.get(c.addPlayerId)
      if (list === undefined) byPlayer.set(c.addPlayerId, [c])
      else list.push(c)
    }
    const topList: LiveClaim[] = []
    for (const list of byPlayer.values()) {
      const best = [...list].sort(stronger)[0]
      const rival = list.filter((c) => c.teamId !== best.teamId).sort(stronger)[0]
      const exec = list
        .filter((c) => c.teamId === best.teamId)
        .sort(byRank)
        .find((c) => rival === undefined || teamwise(c, rival) < 0)
      // `best` itself beats the rival strictly, so `exec` always exists.
      topList.push(exec ?? best)
    }
    topList.sort(stronger)

    // Steps 3–5.
    let winner = topList.find((c) => isReady(c, pending))
    let deadlockBreak = false
    if (winner === undefined) {
      const team = topList[0].teamId
      winner = topList.filter((c) => c.teamId === team).sort(byRank)[0]
      deadlockBreak = true
    }

    // Award.
    const w = winner
    const spent = effBid(w)
    const team = w.teamId
    if (faab) balance.set(team, (balance.get(team) ?? 0) - spent)
    rosterOwner.set(w.addPlayerId, team)
    if (w.dropPlayerId !== null) rosterOwner.delete(w.dropPlayerId)
    count.set(team, (count.get(team) ?? 0) + net(w))
    accWeek.set(team, (accWeek.get(team) ?? 0) + 1)
    accSeason.set(team, (accSeason.get(team) ?? 0) + 1)
    w.done = true
    outcomes.push({
      decision: outcomes.length + 1,
      claimId: w.claimId,
      teamId: team,
      addPlayerId: w.addPlayerId,
      dropPlayerId: w.dropPlayerId,
      status: 'won',
      reason: null,
      faabSpent: spent,
      deadlockBreak,
    })
    // The player's other claims, strongest first.
    for (const c of pending.filter((p) => !p.done && p.addPlayerId === w.addPlayerId).sort(stronger)) {
      if (c.teamId === team) fail(c, 'invalid', 'own_claim_won')
      else fail(c, 'lost', effBid(c) < spent ? 'outbid' : 'lost_on_priority')
    }
    if (rotates) order = [...order.filter((id) => id !== team), team]
  }

  const rosters = new Map<string, string[]>()
  for (const t of input.teams) rosters.set(t.teamId, [])
  for (const [p, t] of rosterOwner) rosters.get(t)?.push(p)

  const teams: WaiverRunTeamResult[] = [...input.teams]
    .sort((a, b) => cmpStr(a.teamId, b.teamId))
    .map((t) => ({
      teamId: t.teamId,
      faabBefore: t.faabBalance,
      faabAfter: balance.get(t.teamId) ?? null,
      rosterAfter: (rosters.get(t.teamId) ?? []).sort(cmpStr),
      acquisitionsWeekAfter: accWeek.get(t.teamId) ?? 0,
      acquisitionsSeasonAfter: accSeason.get(t.teamId) ?? 0,
    }))

  return { outcomes, teams, priority: { source, rotates, before, after: order } }
}

/** The canonical byte form for the L.D2.9 differential test: the result's
 *  own field order and array orders are already fixed, so this is plain
 *  JSON. Compare strings, not objects. */
export function serializeWaiverRunResult(result: WaiverRunResult): string {
  return JSON.stringify(result)
}
