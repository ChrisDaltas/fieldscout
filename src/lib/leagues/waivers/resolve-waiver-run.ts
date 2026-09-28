/**
 * resolve-waiver-run.ts — THE REFERENCE WAIVER RESOLVER (M5 task L.D2.8,
 * re-cut by L.D2.9 to Chris's F422 rulings; FULL rigour: it decides who gets
 * players and how much FAAB is spent).
 *
 * Spec §13.2 (process-waivers), §7.3.4 (waiver_type / faab_tiebreaker /
 * caps), §13.1 (the game-day lock rule, E32), E7, E33, E34; tasks-M5 TD7
 * ("one reference resolver, two implementations") and TD8 (priority on the
 * seat). Chris's rulings (PROGRESS §3 / F422):
 *
 *   Q71 — the highest bid on a player always wins him; a team can win
 *         several players in one run, each claim valid when its turn comes.
 *   Q72 — before week 1 is final, waiver priority is REVERSE DRAFT ORDER
 *         (last pick of round 1 first); after that reverse standings or the
 *         rolling order as the league chose; rolling starts from reverse
 *         draft order.
 *   Q73 — a claim whose DROP player has kicked off this week fails
 *         (`drop_locked`, no FAAB) — `bench_lock` retired; E34 unreachable.
 *   Q74 — a claim on a player whose game has kicked off fails at the run
 *         (`add_locked`, no FAAB) rather than waiting for a later run.
 *   F422(a) (2026-09-28) — "During waivers, you burn your order priority with
 *         each pick": EVERY win sends the winning team to the back of the
 *         order at once, for every later decision in the same run — in every
 *         waiver type, and for the FAAB equal-bid tiebreak.
 *   F422(b) (2026-09-28) — "your top choice is the choice you put the most
 *         money on … if you bid $50, and someone else bids $55, you lose
 *         that bid and then the $10 bid becomes your top priority": in a FAAB
 *         league a team's claims are RANKED BY BID, highest first; its own
 *         `claim_order` only orders claims with EQUAL bids. (The swap / cycle
 *         of F422(b) and the double tiebreak of F422(c) cannot arise.)
 *
 * PURE and DETERMINISTIC: no clock, no I/O, no randomness. Every lock fact is
 * an INPUT (`lockedPlayerIds` — the players whose game has kicked off and
 * whose week has not cleared at the run instant, i.e. what
 * `pool_game_lock_any_internal(season, week, team, p_at)` says for each), so
 * the TimeProvider rule is honoured by construction.
 *
 * THIS IS THE CONTRACT THE SQL TWIN MATCHES BYTE FOR BYTE (migration 150's
 * `waiver_resolve_run_internal`; `waivers-resolver-parity-db.test.ts`): feed
 * both the same input, map the SQL answer into a `WaiverRunResult` and
 * compare `serializeWaiverRunResult` strings. Pinned for parity:
 *   - ids (claim, team, player) compare as plain code-unit strings — SQL
 *     orders them `COLLATE "C"`;
 *   - input ARRAY ORDER NEVER MATTERS (claims, teams, rosters, locks are
 *     sets); the only ordered inputs are the priority sources;
 *   - the failure-reason precedence (FAIL_CHECK_ORDER) and the decision
 *     sequence (`decision`, 1..N) are part of the output.
 *
 * ── THE ALGORITHM ──────────────────────────────────────────────────────────
 * A claim's EFFECTIVE BID is its `faabBid` in a FAAB league and 0 under a
 * priority waiver type (priority leagues spend no money, §13.2 — a stray bid
 * left from a settings change is ignored, never charged). The ORDER is the
 * run-start priority order (below); a team's POSITION is its place in the
 * current order (0 = first).
 *
 * Repeat until nothing is pending:
 *   1. FAIL every pending claim that cannot go through against the CURRENT
 *      state (the checks run in FAIL_CHECK_ORDER; the first failing check
 *      names the reason; claims in id order). Every check is monotone —
 *      balances only fall, rosters only fill, a dropped player never comes
 *      back, caps only fill — so a failed claim never becomes valid again.
 *   2. AWARD the STRONGEST pending claim: effective bid DESC, then the
 *      team's position ASC (E7's tiebreak — two teams never share one), then
 *      its `claim_order` ASC, then claim id. That is at once "the highest bid
 *      on a player wins him", "bids are processed from the top" and, for one
 *      team, "its claims are settled biggest bid first, its own order only
 *      between equal bids" (F422(b)) — a team's claims are never decided out
 *      of that ranking, because its higher-ranked pending claim is always the
 *      stronger one. Its player's other pending claims are decided at once:
 *      another team's → `lost` (`outbid` when its bid was lower,
 *      `lost_on_priority` when equal), the same team's → `invalid`
 *      (`own_claim_won`), strongest first.
 *   3. The winner goes to the BACK of the order (F422(a)); non-winners keep
 *      their relative order.
 *   Each iteration decides at least one claim, so the loop ends in ≤ N turns.
 *   (L.D2.8's readiness check and deadlock break are gone: under F422(b) the
 *   strongest claim never waits on a stronger claim of its own team, so no
 *   cycle can form.)
 *
 * Priority (Q72 / TD8): the START ORDER is the stored rolling order
 * (`priority.rolling`) when the order PERSISTS and it has been seeded, else
 * reverse standings once week 1 is final (`priority.standings` non-null) for
 * a league whose order does not persist, else reverse draft order. The order
 * PERSISTS across runs iff waiver_type is `rolling_priority`, or `faab` with
 * `faab_tiebreaker = rolling_priority` — then `priority.after` is written to
 * `league_members.waiver_priority`. Under reverse standings the order rolls
 * within the run (F422(a)) and the next run starts from the standings again
 * (§13.2 "order resets by reverse standings").
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
 *  reason (parity-relevant: the SQL twin must test in this order). THE ONE
 *  SOURCE OF TRUTH: the resolver runs its checks by iterating this list
 *  (R1177); the worked examples pin it as a stored literal. */
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
type FailCheck = (typeof FAIL_CHECK_ORDER)[number]

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
    /** Whether the order carries to the next run (rolling priority, or FAAB
     *  with the rolling tiebreaker). WITHIN a run every league rolls
     *  (F422(a)); only a persisting order is stored. */
    persists: boolean
    /** Active team ids, first priority first, at the start of the run. */
    before: string[]
    /** At the end of the run: `before` with every winner moved to the back,
     *  in the order of its last win (F422(a)). The processor writes it to
     *  `league_members.waiver_priority` (1-based) when `persists` —
     *  including the first run's lazy seeding. */
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
  persists: boolean,
): { source: WaiverPrioritySource; order: string[] } {
  const active = new Set(input.teams.filter((t) => !t.retired).map((t) => t.teamId))
  const { draftOrder, standings, rolling } = input.priority
  if (persists && rolling !== null) {
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
  if (!persists && standings !== null) {
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
  const persists =
    settings.waiverType === 'rolling_priority' ||
    (faab && settings.faabTiebreaker === 'rolling_priority')
  const { source, order: before } = startOrder(input, persists)
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
    })
  }

  /** Step 1's checks against the CURRENT state, one per reason. They are
   *  RUN in FAIL_CHECK_ORDER (below) — that constant is the only statement of
   *  the precedence (R1177); this table only says what each check tests. */
  const fails: Record<FailCheck, (c: WaiverRunClaim) => boolean> = {
    team_retired: (c) => retired.has(c.teamId),
    add_rostered: (c) => rosterOwner.has(c.addPlayerId),
    add_locked: (c) => locked.has(c.addPlayerId),
    drop_gone: (c) => c.dropPlayerId !== null && rosterOwner.get(c.dropPlayerId) !== c.teamId,
    drop_locked: (c) => c.dropPlayerId !== null && locked.has(c.dropPlayerId),
    roster_full: (c) => (count.get(c.teamId) ?? 0) + net(c) > settings.rosterSize,
    cap_reached: (c) =>
      (settings.acquisitionsPerWeek !== null && (accWeek.get(c.teamId) ?? 0) >= settings.acquisitionsPerWeek) ||
      (settings.acquisitionsPerSeason !== null && (accSeason.get(c.teamId) ?? 0) >= settings.acquisitionsPerSeason),
    insufficient_faab: (c) => faab && effBid(c) > (balance.get(c.teamId) ?? 0),
  }
  /** The first failing check in FAIL_CHECK_ORDER; null = could go through now. */
  const absoluteFailure = (c: WaiverRunClaim): WaiverInvalidReason | null =>
    FAIL_CHECK_ORDER.find((reason) => fails[reason](c)) ?? null

  for (;;) {
    // Step 1.
    for (const c of claims) {
      if (c.done) continue
      const r = absoluteFailure(c)
      if (r !== null) fail(c, 'invalid', r)
    }
    const pending = claims.filter((c) => !c.done)
    if (pending.length === 0) break

    // Step 2 — the strongest pending claim at THIS turn: bid, then the
    // team's place in the CURRENT order (F422(a)), then the team's own order
    // between its equal bids (F422(b)), then id. Retired teams' claims failed
    // in step 1, so every pending team has a place.
    const pos = new Map(order.map((id, i) => [id, i]))
    const stronger = (a: LiveClaim, b: LiveClaim): number =>
      effBid(b) - effBid(a) ||
      (pos.get(a.teamId) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.teamId) ?? Number.MAX_SAFE_INTEGER) ||
      a.claimOrder - b.claimOrder ||
      cmpStr(a.claimId, b.claimId)
    const w = [...pending].sort(stronger)[0]

    // Award.
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
    })
    // The player's other claims, strongest first (judged in the order the
    // award was made in).
    for (const c of pending.filter((p) => !p.done && p.addPlayerId === w.addPlayerId).sort(stronger)) {
      if (c.teamId === team) fail(c, 'invalid', 'own_claim_won')
      else fail(c, 'lost', effBid(c) < spent ? 'outbid' : 'lost_on_priority')
    }
    // Step 3 — F422(a): the winner burns its priority for the rest of the run.
    order = [...order.filter((id) => id !== team), team]
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

  return { outcomes, teams, priority: { source, persists, before, after: order } }
}

/** The canonical byte form for the L.D2.9 differential test: the result's
 *  own field order and array orders are already fixed, so this is plain
 *  JSON. Compare strings, not objects. */
export function serializeWaiverRunResult(result: WaiverRunResult): string {
  return JSON.stringify(result)
}
