/**
 * League settings contract — the §7.3 catalog as ONE Zod source of truth
 * (M1 task L.A1.6; spec §7.3.1–§7.3.8, §12.1; tasks-M1 §5 sketch).
 *
 * Pure TS (engine home, D1): no Next/Node APIs, no process.env, no fetch,
 * no clock reads. Zod only.
 *
 * Contractual exports (tasks-M1 §5 — names are law):
 *   - `leagueSettingsSchema`, `rosterSettingsSchema`
 *   - `LEAGUE_SETTINGS_DEFAULTS` (creation defaults, verbatim §7.3 "D" columns)
 *   - `DL_PRESET` (§7.3.2 one-tap Restricted-IR preset)
 *   - `validateLeagueSettings` (§7.3.8 validation bullets, per-field messages)
 *   - `splitSettings` / `mergeSettings` (§12.1 typed-column / JSONB-blob split)
 *
 * Layering contract:
 *   - The SCHEMA owns per-field shapes, enums, and numeric ranges (§7.3 "R"
 *     columns). `.parse` is the boundary gate for anything entering from
 *     outside TS (API bodies, DB rows via `mergeSettings`).
 *   - `validateLeagueSettings` owns the CROSS-FIELD rules: every §7.3.8
 *     validation bullet this task is chartered for, re-checked independently
 *     of the schema (it takes an already-typed object and still re-verifies
 *     the bullet-named ranges, so a hand-built object can't skip them),
 *     plus the cross-field "R" constraints the per-field schema cannot
 *     express (playoff_teams ≤ team_count; playoff_start_week =
 *     regular_season_weeks + 1 (Q10, v2.8.6); trade_veto_votes ≤ team_count;
 *     trade_deadline_week ≤ regular_season_weeks).
 *   - §7.3.8's "exactly one scoring system referenced and readable" bullet is
 *     DELIBERATELY absent here — it needs a DB lookup, so it is enforced
 *     in-body by the L.A1.12/L.A1.13 RPC path (v1 templates-only rule,
 *     §7.3.3). Same for the runtime bullets (Swap assignment legality,
 *     §11.7 schedule invariants, kickoff-derived locks): they validate
 *     per-week STATE, not league settings, and live with their features.
 *
 * Builder-finalized field shapes (tasks-M1 §5: "Builder finalizes exact
 * fields; names below are contractual") — recorded in PROGRESS D60:
 *   - `waiver_process_time` ("+ time" in §7.3.4's R column) is HH:MM 24h ET,
 *     default '03:00' (incumbent-normed overnight processing; the spec names
 *     no default).
 *   - `stat_correction_window` is `'thu_06_00_et'` (the §23.4 anchored-instant
 *     default) or an integer hour count 0–168 (the "0h–7d" configurable range).
 *   - `playoff_byes` is the literal 'auto' (§7.3.1: derived from bracket
 *     size — not independently settable in v1).
 *   - The §7.3.8 draft table is a nested `draft` block (§12.1's "draft config
 *     block" comment).
 */
import { z } from 'zod'

import type { Json, League } from '@/types/database'

/**
 * Recursively freeze an exported constant (R64): `Object.freeze` alone is
 * shallow, leaving nested arrays/objects mutable. Consumers clone before
 * editing (e.g. `structuredClone` — the schema's roster default already does).
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Roster slot position vocabulary (§7.3.2 preset table + IDP slots).
 * `DST` matches the canonical roster_settings JSONB shape (040's DEFAULT and
 * the §7.3.2 example) — NOT the research-surface `DEF` spelling used by lists.
 */
export const ROSTER_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST', 'DL', 'LB', 'DB'] as const
export type RosterPosition = (typeof ROSTER_POSITIONS)[number]

/**
 * IR eligible designations (§7.3.2 IR slot rules — drawn from
 * `players.status` / the injury feed).
 */
export const IR_DESIGNATIONS = ['OUT', 'IR', 'Doubtful', 'PUP', 'NFI', 'Suspended'] as const
export type IrDesignation = (typeof IR_DESIGNATIONS)[number]

/** §7.3.7 tiebreaker chain entries (ordered, reorderable). */
export const TIEBREAKERS = [
  'win_pct',
  'points_for',
  'head_to_head',
  'points_against',
  'division_record',
  'coin_flip',
] as const
export type Tiebreaker = (typeof TIEBREAKERS)[number]

/** §7.3.8 pick timer options — enum including 0 (untimed) per the task text. */
export const PICK_TIMER_SECONDS = [0, 30, 45, 60, 90, 120, 180, 300, 600, 3600, 14400, 28800, 86400] as const

// ---------------------------------------------------------------------------
// §7.3.2 — roster settings (canonical `leagues.roster_settings` JSONB)
// ---------------------------------------------------------------------------

const positionSchema = z.enum(ROSTER_POSITIONS)
const designationSchema = z.enum(IR_DESIGNATIONS)

/** A starting slot instance: unique `key`, eligible-position set, count 0–10. */
const startingSlotSchema = z.strictObject({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  eligible: z.array(positionSchema).min(1),
  count: z.number().int().min(0).max(10),
})
export type StartingSlot = z.infer<typeof startingSlotSchema>

/**
 * IR slots are configured per spot (§7.3.2 IR slot rules). `min_weeks` exists
 * on RESTRICTED spots only (default 4, range 1–17); the canonical default
 * (unrestricted `ir1`) carries no `min_weeks` key, and strict objects keep it
 * that way. `label` is optional (the canonical default has none; presets like
 * DL carry one).
 */
const unrestrictedIrSlotSchema = z.strictObject({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(60).optional(),
  type: z.literal('unrestricted'),
  eligible_designations: z.array(designationSchema).min(1),
})
const restrictedIrSlotSchema = z.strictObject({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(60).optional(),
  type: z.literal('restricted'),
  eligible_designations: z.array(designationSchema).min(1),
  min_weeks: z.number().int().min(1).max(17).default(4),
})
const irSlotSchema = z.discriminatedUnion('type', [unrestrictedIrSlotSchema, restrictedIrSlotSchema])
export type IrSlot = z.infer<typeof irSlotSchema>

/** An IR slot configuration without its instance `key` (what a preset is). */
export type IrSlotConfig = Omit<z.infer<typeof restrictedIrSlotSchema>, 'key'> | Omit<z.infer<typeof unrestrictedIrSlotSchema>, 'key'>

/**
 * §7.3.2 "DL" preset (v2.0 product naming): one-tap Restricted IR —
 * designations OUT, IR, Doubtful; min_weeks 4; label "DL". Identical
 * mechanics to any Restricted spot; the label is the product promise.
 */
export const DL_PRESET: IrSlotConfig = deepFreeze({
  label: 'DL',
  type: 'restricted',
  eligible_designations: ['OUT', 'IR', 'Doubtful'],
  min_weeks: 4,
}) as IrSlotConfig

/** §7.3.2 canonical roster JSONB: starting_slots[] + bench + ir_slots[] + swap_spots. */
export const rosterSettingsSchema = z.strictObject({
  starting_slots: z.array(startingSlotSchema),
  bench: z.number().int().min(0).max(20),
  ir_slots: z.array(irSlotSchema).max(6),
  swap_spots: z.union([z.literal(0), z.literal(1)]),
})
export type RosterSettings = z.infer<typeof rosterSettingsSchema>

/**
 * §7.3.2 preset-table Default counts rendered in the canonical shape — the
 * SAME object the `roster_settings` column DEFAULT holds (040 as amended by
 * 107) and pgTAP 005 golden-pins as a JSON literal (C9; the cross-pin lives
 * in league-settings.test.ts).
 *
 * wr = 3 since v2.16.9: Chris's 2026-08-26 Scout default roster (task SC.2,
 * F186) — 1 QB / 2 RB / 3 WR / 1 TE / 1 FLEX W-R-T / 1 K / 1 D/ST, bench 6,
 * 1 IR. Migration 107 swaps the column DEFAULT for future rows only —
 * existing leagues keep their chosen roster (a default is not a retrofit).
 */
export const DEFAULT_ROSTER_SETTINGS: RosterSettings = deepFreeze({
  starting_slots: [
    { key: 'qb', label: 'QB', eligible: ['QB'], count: 1 },
    { key: 'rb', label: 'RB', eligible: ['RB'], count: 2 },
    { key: 'wr', label: 'WR', eligible: ['WR'], count: 3 },
    { key: 'te', label: 'TE', eligible: ['TE'], count: 1 },
    { key: 'flex', label: 'FLEX (W/R/T)', eligible: ['WR', 'RB', 'TE'], count: 1 },
    { key: 'k', label: 'K', eligible: ['K'], count: 1 },
    { key: 'dst', label: 'D/ST', eligible: ['DST'], count: 1 },
  ],
  bench: 6,
  ir_slots: [{ key: 'ir1', type: 'unrestricted', eligible_designations: ['OUT', 'IR'] }],
  swap_spots: 0,
}) as RosterSettings

/** Derived roster size (§7.3.2): Σ starting-slot counts + bench + IR spots. */
export function deriveRosterSize(roster: RosterSettings): number {
  const starters = roster.starting_slots.reduce((sum, slot) => sum + slot.count, 0)
  return starters + roster.bench + roster.ir_slots.length
}

// ---------------------------------------------------------------------------
// §7.3.8 — draft configuration block
// ---------------------------------------------------------------------------

/**
 * D98 (spec §7.3.8 erratum v2.9.2): is `zone` a usable IANA time zone name?
 * Probed through Intl itself (the renderer that will consume it), so "valid"
 * means exactly "this runtime can render league time in it" — no shipped zone
 * list to drift from the ICU data. Deterministic: constructing a formatter
 * with an explicit `timeZone` reads no clock (the D3 guard bans wall-clock
 * reads, not Intl).
 *
 * R276 strict arm (M2 batch 15, D120(11)): Intl alone also accepts ECMA-402
 * offset strings ('+05:00') and legacy no-slash link names ('EST'), which are
 * not "a valid IANA time zone name" per the §7.3.8 row — so a name must
 * contain a '/' (UTC and GMT allowlisted; every curated-select and one-tap
 * value is Region/City). The Intl probe stays the base check underneath.
 */
export function isIanaTimeZone(zone: string): boolean {
  if (zone !== 'UTC' && zone !== 'GMT' && !zone.includes('/')) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/**
 * The ONE TypeScript derivation of the auction's per-slot RESERVE and
 * nomination FLOOR — the mirror of migration 092's
 * `draft_auction_reserve(jsonb)` (task AP.1; spec v2.13 §7.3.8/§8.6.1/§8.6.2;
 * D198(1), the §4.7 one-authority discipline applied to a second quantity).
 *
 * `auction_zero_dollar_nominations` OFF ⇒ **1**: a nomination opens at ≥ $1
 * and every team holds $1 back per still-empty roster slot
 * (`max_bid = remaining − (open_slots − 1) × 1`).
 * ON ⇒ **0**: a nomination may open at any amount the nominator can afford,
 * including $0, and `max_bid = remaining` flat —
 * *"with $0 nominations there is no $1 per slot reserve"* (Chris, 2026-08-20).
 *
 * **This is not the bid increment.** A raise must exceed the standing high
 * bid, so the minimum legal raise is `high_bid + 1` in BOTH columns (§8.6.3),
 * including from a $0 opening. The retired `auction_min_bid` conflated the
 * two and governed neither honestly; keeping them apart is Chris's ruling
 * (*"Nomination and Min Bid need to be different"*), and it is why nothing in
 * this function is ever read by a raise clause. `auction-budget.ts` (the
 * display-only mirror of `draft_team_budget`) reads the reserve through here;
 * a second derivation anywhere is a review finding.
 */
export function auctionReserve(zeroDollarNominations: boolean | null | undefined): 0 | 1 {
  return zeroDollarNominations === true ? 0 : 1
}

/**
 * §7.3.8 draft-configuration block — exported (MP.4) because it is also the
 * shape of `drafts.config`'s settings half: a standalone practice draft
 * sends this exact object as `create_mock_draft`'s `p_settings.draft` and
 * the RPC stores it verbatim, so the launch route parses with the SAME
 * schema the league surfaces validate against rather than a second opinion
 * (tasks-MP §4 rule 12 / MP.4 item 5).
 */
export const draftConfigSchema = z.strictObject({
  draft_type: z.enum(['snake', 'auction', 'linear']).default('snake'),
  snake_reversal: z.boolean().default(false),
  draft_order_mode: z.enum(['random', 'manual', 'custom']).default('random'),
  draft_order: z.array(z.uuid()).nullable().default(null),
  pick_timer_seconds: z.literal(PICK_TIMER_SECONDS).default(90),
  auction_budget: z.number().int().min(50).max(1000).default(200),
  // 092/AP.1 (spec v2.13 §7.3.8): `auction_min_bid` is RETIRED and this
  // toggle carries the two jobs it really did — the §8.6.2 NOMINATION
  // FLOOR and the §8.6.1 PER-SLOT RESERVE. OFF (the default, today's
  // behaviour exactly): floor $1, reserve $1. ON: floor $0, reserve $0, so
  // `max_bid = remaining` flat and "a nomination should allow any number
  // that the player can afford" (Chris, 2026-08-20).
  // It does NOT touch the BID INCREMENT, which is a fixed $1 in both
  // columns (§8.6.3) and lives in the raise clause, not here — the
  // distinction the retired field collapsed ("you can't have a $0 minimum
  // bid, those are two different settings").
  auction_zero_dollar_nominations: z.boolean().default(false),
  auction_nomination_seconds: z.number().int().min(10).max(120).default(30),
  auction_bid_seconds: z.number().int().min(10).max(60).default(20),
  auction_anti_snipe_seconds: z.number().int().min(0).max(15).default(10),
  nomination_order_mode: z.enum(['same_as_draft_order', 'random', 'manual']).default('same_as_draft_order'),
  // 098/AP.5 (spec v2.13 §7.3.8, F80 arm (b)): the auction's counterpart to
  // `draft_order`, and for the same reason — `manual` needs somewhere
  // pre-draft to store the order the commissioner set. `draft_start` hydrates
  // it into `drafts.nomination_order` (candidate-then-settings, the D101
  // rule); the permutation is validated AT START, server-side, exactly like
  // `draft_order`'s — this field is storage, never authority.
  nomination_order: z.array(z.uuid()).nullable().default(null),
  autopick_default: z.literal('queue_then_board_then_adp').default('queue_then_board_then_adp'),
  disconnect_grace_seconds: z.number().int().min(0).max(120).default(30),
  draft_scheduled_at: z.iso.datetime({ offset: true }).nullable().default(null),
  // D98 (additive, spec §7.3.8 erratum v2.9.2): the league's named draft
  // reference zone (§16.4). DISPLAY-ONLY metadata — instants
  // (`draft_scheduled_at`, `drafts.current_deadline`) stay the authority;
  // when set, league-time renders in this zone (Intl), when null the M1
  // offset render stands. The draft-setup surface offers the scheduler's own
  // zone as the one-tap default (L.B3.4).
  time_zone: z
    .string()
    .refine(isIanaTimeZone, 'must be a valid IANA time zone name (e.g. America/New_York)')
    .nullable()
    .default(null),
})
export type DraftConfig = z.infer<typeof draftConfigSchema>

// ---------------------------------------------------------------------------
// §7.3.5 — derived default: trade veto votes
// ---------------------------------------------------------------------------

/** The §7.3.1 "D" column team count — the anchor for derived defaults. */
const DEFAULT_TEAM_COUNT = 12

// ---------------------------------------------------------------------------
// §7.3.1 / §11.7 Mid-season entry (v2.16.12, Q31) — the two ranges of the
// regular season, said once
// ---------------------------------------------------------------------------

/**
 * §11.7 Mid-season entry's FLOOR: a league entering the season late may have
 * its stored `regular_season_weeks` engine-shrunk down to this many weeks
 * (then playoff rounds drop; then the engine refuses — migration 110's
 * `schedule_fit_internal`). The Zod PARSE range starts here so a shrunk row
 * still merges (Q31 rider (3)).
 */
export const MID_SEASON_REGULAR_SEASON_FLOOR = 4

/** §7.3.1 R column: `regular_season_weeks` at CREATION and settings edit. */
export const CREATION_REGULAR_SEASON_WEEKS = { min: 12, max: 15 } as const

/** §7.3.1 R column: `playoff_start_week` at CREATION and settings edit (13–16 = 12–15 + 1). */
export const CREATION_PLAYOFF_START_WEEK = { min: 13, max: 16 } as const

/** The schedule engine's seed space: 31-bit non-negative (Park–Miller state, migration 110). */
export const SCHEDULE_SEED_MAX = 2_147_483_647

/**
 * Mint a `schedule_seed` (§11.7 — "a seeded PRNG permutes the team order")
 * from the create's idempotency key: the first 32 bits of the `action_id`
 * UUID, masked to the 31-bit seed space. DETERMINISTIC on purpose — no clock,
 * no random source (the M0 time fence and the L.A0.3/R22 determinism guard
 * both stand): the same submit, replayed, mints the same seed (D68's
 * idempotency extends to the schedule), and a UUID v4's leading bits are as
 * unpredictable as a seed needs to be. Remix (L.D1.3) re-mints from its own
 * action id the same way.
 */
export function mintScheduleSeed(actionId: string): number {
  const hex = actionId.replace(/-/g, '').slice(0, 8)
  if (!/^[0-9a-f]{8}$/i.test(hex)) {
    throw new TypeError(`mintScheduleSeed: expected a UUID, got ${JSON.stringify(actionId)}`)
  }
  return Number.parseInt(hex, 16) & SCHEDULE_SEED_MAX
}

/**
 * §7.3.5 "D" column: `trade_veto_votes` defaults to **⌈team_count/2⌉** — a
 * DERIVED default, not a constant. This function is the single home of that
 * derivation (R63): the schema's own default calls it at the default
 * team_count, and any surface that re-defaults on a team_count change (the
 * L.A2.1 wizard, L.A1.12 `create_league`) calls it — or `defaultsForTeamCount`
 * — instead of hard-coding 6. The formula is the spec's ⌈/2⌉ even though every
 * v1 team_count is even (odd-count ceiling pins keep it honest if counts widen).
 */
export function deriveDefaultVetoVotes(teamCount: number): number {
  return Math.ceil(teamCount / 2)
}

// ---------------------------------------------------------------------------
// The full §7.3 catalog — leagueSettingsSchema
// ---------------------------------------------------------------------------

export const leagueSettingsSchema = z.strictObject({
  // §7.3.1 — format & structure
  format: z.literal('redraft').default('redraft'), // keeper/dynasty/best_ball reserved (v1)
  team_count: z.literal([8, 10, 12, 14, 16]).default(DEFAULT_TEAM_COUNT), // even only in v1 (OQ 12)
  divisions: z.number().int().min(1).max(2).default(1), // v2.16.12 (Q30 (d)): PINNED AT 1 for v1 — the select renders one option (settings-panel-ops DIVISION_OPTIONS) and the engine ignores the value; the 1–2 parse range is KEPT so stored rows stay valid and F221's return path is additive
  // v2.16.12 (Q31 rider (3)): the PARSE range is the EFFECTIVE range — a
  // mid-season league's stored plan may be engine-shrunk to ≥ 4 regular-season
  // weeks (§11.7 Mid-season entry), and `mergeSettings` must not throw on that
  // row. The 12–15 / 13–16 CREATION-and-edit ranges (§7.3.1 R column) live in
  // `validateLeagueSettings` — the validator every create/PATCH runs.
  regular_season_weeks: z.number().int().min(MID_SEASON_REGULAR_SEASON_FLOOR).max(15).default(14),
  playoff_teams: z.literal([0, 2, 4, 6, 8, 10, 12]).default(6), // ≤ team_count → validator
  playoff_start_week: z.number().int().min(MID_SEASON_REGULAR_SEASON_FLOOR + 1).max(16).default(15), // = regular_season_weeks + 1 → validator seam check (Q10, v2.8.6); creation 13–16 → validator; effective ≥ 5 when engine-shrunk (Q31)
  playoff_weeks_per_round: z.union([z.literal(1), z.literal(2)]).default(1),
  playoff_byes: z.literal('auto').default('auto'), // derived from bracket size (§7.3.1)
  playoff_reseed: z.boolean().default(true),
  consolation_bracket: z.boolean().default(false),
  third_place_game: z.boolean().default(false),
  schedule_mode: z.enum(['h2h', 'total_points']).default('h2h'),
  median_game: z.boolean().default(false),
  second_opponent: z.boolean().default(false),
  // §11.7 (v2.0) — the seed the schedule engine permutes the team order
  // with (D289; migration 110). Minted at league creation (`createLeague`
  // via `mintScheduleSeed`), re-minted by Remix (L.D1.3); `null` = not yet
  // minted (a pre-110 row) — the engine mints one at generation and writes
  // it back so every schedule stays reproducible. 31-bit non-negative: the
  // engine's Park–Miller LCG state range.
  schedule_seed: z.number().int().min(0).max(SCHEDULE_SEED_MAX).nullable().default(null),

  // §7.3.2 — roster (own typed column; part of the settings object so the
  // defaults/round-trip cover the WHOLE catalog)
  roster_settings: rosterSettingsSchema.default(() => structuredClone(DEFAULT_ROSTER_SETTINGS)),

  // §7.3.4 — waivers & free agency
  waiver_type: z.enum(['faab', 'rolling_priority', 'reverse_standings', 'none_fcfs']).default('faab'),
  faab_budget: z.number().int().min(0).max(1000).default(100),
  faab_min_bid: z.number().int().min(0).max(10).default(0),
  faab_tiebreaker: z.enum(['reverse_standings', 'rolling_priority']).default('reverse_standings'),
  waiver_process_day: z.enum(['tue', 'wed', 'thu']).default('wed'),
  waiver_process_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM (24h, ET)')
    .default('03:00'), // Builder-finalized default (D60) — spec's R column names "+ time" with no D
  waiver_period_hours: z.number().int().min(0).max(168).default(48),
  free_agency: z.enum(['immediate_after_waivers', 'continuous']).default('immediate_after_waivers'),
  acquisitions_per_week: z.union([z.literal('unlimited'), z.number().int().min(0).max(50)]).default('unlimited'),
  acquisitions_per_season: z.union([z.literal('unlimited'), z.number().int().min(0).max(500)]).default('unlimited'),
  // v2.16.21 (Q34(B) + Q35 (a), Chris 2026-09-05; migration 115): `player_game_lock` is RETIRED — the
  // game-day add/drop lock is a RULE (a player locks for adds and drops at his own kickoff, releases at
  // the week's `last_game_ends_at`), not a setting. The key is unstorable at the table (a CHECK) and
  // refused here by the strict object (`league-settings.test.ts` pins it).
  bench_lock: z.boolean().default(true),
  fa_hold_hours: z.number().int().min(0).max(48).default(0),

  // §7.3.5 — trades
  trade_review: z.enum(['none', 'commissioner', 'league_vote']).default('commissioner'),
  trade_veto_votes: z.number().int().min(1).max(16).default(() => deriveDefaultVetoVotes(DEFAULT_TEAM_COUNT)), // D = ⌈team_count/2⌉ (derived — R63); ≤ team_count → validator
  trade_review_period_hours: z.number().int().min(0).max(96).default(24),
  trade_deadline_week: z.number().int().min(1).max(15).nullable().default(11), // none → null; ≤ regular_season_weeks → validator
  allow_faab_in_trades: z.boolean().default(false),
  allow_future_considerations: z.boolean().default(false),
  trade_lock_behavior: z.enum(['defer', 'reject']).default('defer'),

  // §7.3.6 — lineups & lock
  // v2.16.20 (Q34(A), Chris 2026-09-05; migration 114): `first_game_of_week` is RETIRED — a player's
  // slot locks at his own kickoff and nothing else; this is the only value and the DB CHECK agrees.
  lineup_lock: z.enum(['per_player_kickoff']).default('per_player_kickoff'),
  allow_illegal_lineups: z.boolean().default(true),
  auto_sub_inactives: z.boolean().default(false),
  stat_correction_window: z
    .union([z.literal('thu_06_00_et'), z.number().int().min(0).max(168)])
    .default('thu_06_00_et'), // §23.4 anchored default; configurable 0h–7d as hours (D60)

  // §7.3.7 — tiebreakers (ordered, reorderable; stored in `settings`)
  tiebreakers: z
    .array(z.enum(TIEBREAKERS))
    .refine((chain) => new Set(chain).size === chain.length, 'tiebreaker chain entries must be unique')
    .default(() => [...TIEBREAKERS]),

  // §7.3.8 — draft configuration block
  draft: draftConfigSchema.default(() => draftConfigSchema.parse({})),
})
export type LeagueSettings = z.infer<typeof leagueSettingsSchema>

/**
 * Creation defaults, verbatim from the §7.3 "D" columns (v1 default chain
 * per §7.3.7; trade_veto_votes = deriveDefaultVetoVotes(12) = 6 at the
 * default team_count — surfaces that change team_count re-derive via
 * `defaultsForTeamCount`, R63).
 *
 * Deep-frozen (R64) — clone before editing. Golden-pinned by serialization
 * in league-settings.test.ts; the roster portion is the SAME JSON literal
 * 040's pgTAP default test pins, and L.A1.13's integration suite asserts a
 * freshly-defaulted leagues row's roster_settings deep-equals it.
 */
export const LEAGUE_SETTINGS_DEFAULTS: LeagueSettings = deepFreeze(leagueSettingsSchema.parse({})) as LeagueSettings

/**
 * Creation defaults for a chosen team_count: LEAGUE_SETTINGS_DEFAULTS with
 * the §7.3.5 DERIVED default applied (trade_veto_votes = ⌈team_count/2⌉) —
 * the contract owns the derivation (R63); the L.A2.1 wizard and L.A1.12
 * `create_league` default through THIS, never a static 6. Returns a fresh
 * MUTABLE object (the frozen module constant is never handed out).
 */
export function defaultsForTeamCount(teamCount: LeagueSettings['team_count']): LeagueSettings {
  return leagueSettingsSchema.parse({
    team_count: teamCount,
    trade_veto_votes: deriveDefaultVetoVotes(teamCount),
  })
}

// ---------------------------------------------------------------------------
// validateLeagueSettings — §7.3.8 validation bullets (cross-field; per-field
// human-readable messages — they are UX)
// ---------------------------------------------------------------------------

export interface FieldIssue {
  /** Dot path of the offending field (e.g. `roster_settings.bench`, `draft.auction_budget`). */
  field: string
  /** Human-readable message (surfaced directly in the wizard/settings UI). */
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: FieldIssue[]
  /** Non-blocking advisories (§7.3.2: the draftable-pool check WARNS). */
  warnings: FieldIssue[]
}

export const V1_TEAM_COUNTS = [8, 10, 12, 14, 16] as const

/**
 * Playoff rounds derived from bracket size (§7.3.1 `playoff_byes`: "top seeds
 * get byes when bracket > playoff_teams") — the bracket is the next power of
 * two, so rounds = ⌈log2(playoff_teams)⌉ (6 teams → 8-bracket → 3 rounds;
 * 10/12 → 4). Used by §7.3.8's playoff-week arithmetic.
 */
export function derivePlayoffRounds(playoffTeams: number): number {
  if (playoffTeams < 2) return 0
  return Math.ceil(Math.log2(playoffTeams))
}

export function validateLeagueSettings(s: LeagueSettings, ctx: { draftablePoolSize?: number } = {}): ValidationResult {
  const errors: FieldIssue[] = []
  const warnings: FieldIssue[] = []

  // §7.3.8 bullet: team_count ∈ {8,10,12,14,16} (v1)
  if (!(V1_TEAM_COUNTS as readonly number[]).includes(s.team_count)) {
    errors.push({
      field: 'team_count',
      message: `Team count must be one of ${V1_TEAM_COUNTS.join(', ')} (v1 supports even counts 8–16).`,
    })
  }

  // §7.3.1 R column: playoff_teams ≤ team_count
  if (s.playoff_teams > s.team_count) {
    errors.push({
      field: 'playoff_teams',
      message: `Playoff teams (${s.playoff_teams}) cannot exceed the number of teams (${s.team_count}).`,
    })
  }

  // §7.3.1 / §11.7 (v2.16.25 — Q39 (C), Chris 2026-09-07): a total-points
  // league has NO playoff bracket — the season-long points race IS its
  // playoff — so `playoff_teams` must be 0 under `schedule_mode =
  // 'total_points'`. Migration 118 refuses the pair in `create_league` /
  // `update_league_settings` (P0001; the message names `playoff_teams`) and
  // backstops it with a CHECK; this is the API-side enforcement point every
  // create/PATCH runs first, so the DB refusal is the direct-caller's.
  if (s.schedule_mode === 'total_points' && s.playoff_teams > 0) {
    errors.push({
      field: 'playoff_teams',
      message:
        `A total-points league has no playoff bracket — the season-long points race is the playoff. ` +
        `Set playoff teams to 0 (currently ${s.playoff_teams}) or switch to head-to-head.`,
    })
  }

  // §7.3.1 R column (v2.16.12, Q31 rider (3)): the CREATION-and-edit ranges —
  // 12–15 / 13–16 — are enforced HERE, not at parse: the Zod schema's parse
  // range is the EFFECTIVE range (≥ 4 / ≥ 5) so an engine-shrunk mid-season
  // row still merges. This validator runs on every create and settings PATCH
  // (leagues-service), so creation keeps the catalog ranges exactly.
  if (s.regular_season_weeks < CREATION_REGULAR_SEASON_WEEKS.min || s.regular_season_weeks > CREATION_REGULAR_SEASON_WEEKS.max) {
    errors.push({
      field: 'regular_season_weeks',
      message:
        `Regular season must be between ${CREATION_REGULAR_SEASON_WEEKS.min} and ${CREATION_REGULAR_SEASON_WEEKS.max} weeks ` +
        `(currently ${s.regular_season_weeks}). A league that enters the season late is shortened automatically when its draft completes.`,
    })
  }
  if (s.playoff_start_week < CREATION_PLAYOFF_START_WEEK.min || s.playoff_start_week > CREATION_PLAYOFF_START_WEEK.max) {
    errors.push({
      field: 'playoff_start_week',
      message:
        `Playoffs must start between week ${CREATION_PLAYOFF_START_WEEK.min} and week ${CREATION_PLAYOFF_START_WEEK.max} ` +
        `(currently week ${s.playoff_start_week}).`,
    })
  }

  // §7.3.8 bullet (Q10 ruling, v2.8.6): playoff_start_week = regular_season_weeks + 1
  // — strict continuity: the playoffs begin the week after the regular season
  // ends (no overlap, no gap weeks). Applies regardless of playoff_teams — the
  // ruling makes the field effectively DERIVED (§7.3.1 note), so a points-only
  // league (playoff_teams 0) stores the consistent value too; only the
  // END-arithmetic bullet below has the D60(5) points-only skip.
  if (s.playoff_start_week !== s.regular_season_weeks + 1) {
    errors.push({
      field: 'playoff_start_week',
      message:
        `Playoffs must start the week after the regular season ends — ` +
        `week ${s.regular_season_weeks + 1} for a ${s.regular_season_weeks}-week regular season ` +
        `(currently week ${s.playoff_start_week}).`,
    })
  }

  // §7.3.8 bullet: playoff_start_week + (playoff_rounds × playoff_weeks_per_round) − 1 ≤ 18
  if (s.playoff_teams >= 2) {
    const rounds = derivePlayoffRounds(s.playoff_teams)
    const lastWeek = s.playoff_start_week + rounds * s.playoff_weeks_per_round - 1
    if (lastWeek > 18) {
      errors.push({
        field: 'playoff_start_week',
        message:
          `Playoffs would end in week ${lastWeek}, past the NFL's week 18 — ` +
          `${s.playoff_teams} playoff teams need ${rounds} rounds of ${s.playoff_weeks_per_round} week(s); ` +
          `start earlier, shorten rounds, or shrink the bracket.`,
      })
    }
  }

  // §7.3.8 bullet: sum of starting slots ≥ 1 and ≤ 20
  const startingSum = s.roster_settings.starting_slots.reduce((sum, slot) => sum + slot.count, 0)
  if (startingSum < 1 || startingSum > 20) {
    errors.push({
      field: 'roster_settings.starting_slots',
      message: `Starting lineup must total between 1 and 20 slots (currently ${startingSum}).`,
    })
  }

  // §7.3.8 bullet: every starting slot has a unique `key`
  const slotKeys = s.roster_settings.starting_slots.map((slot) => slot.key)
  const duplicateSlotKeys = [...new Set(slotKeys.filter((key, i) => slotKeys.indexOf(key) !== i))]
  if (duplicateSlotKeys.length > 0) {
    errors.push({
      field: 'roster_settings.starting_slots',
      message: `Every starting slot needs a unique key — duplicated: ${duplicateSlotKeys.join(', ')}.`,
    })
  }

  // §7.3.8 bullet: non-empty `eligible` set — flex slots (2+ positions) and
  // single-position slots (exactly 1) both satisfy this by construction; an
  // EMPTY set is the violating shape. Duplicate positions within a set are
  // rejected too (a set, not a bag).
  for (const slot of s.roster_settings.starting_slots) {
    if (slot.eligible.length === 0) {
      errors.push({
        field: 'roster_settings.starting_slots',
        message: `Slot "${slot.key}" has no eligible positions — a slot must accept at least one position (2+ makes it a flex).`,
      })
    } else if (new Set(slot.eligible).size !== slot.eligible.length) {
      errors.push({
        field: 'roster_settings.starting_slots',
        message: `Slot "${slot.key}" lists a position more than once.`,
      })
    }
  }

  // §7.3.8 bullet: bench 0–20
  if (s.roster_settings.bench < 0 || s.roster_settings.bench > 20) {
    errors.push({
      field: 'roster_settings.bench',
      message: `Bench spots must be between 0 and 20 (currently ${s.roster_settings.bench}).`,
    })
  }

  // §7.3.8 bullet: 0–6 IR spots, each typed with ≥ 1 eligible designation;
  // restricted spots set min_weeks ≥ 1
  if (s.roster_settings.ir_slots.length > 6) {
    errors.push({
      field: 'roster_settings.ir_slots',
      message: `A league can have at most 6 IR spots (currently ${s.roster_settings.ir_slots.length}).`,
    })
  }
  const irKeys = s.roster_settings.ir_slots.map((slot) => slot.key)
  if (new Set(irKeys).size !== irKeys.length) {
    errors.push({
      field: 'roster_settings.ir_slots',
      message: 'Every IR spot needs a unique key.',
    })
  }
  for (const slot of s.roster_settings.ir_slots) {
    if (slot.eligible_designations.length === 0) {
      errors.push({
        field: 'roster_settings.ir_slots',
        message: `IR spot "${slot.key}" needs at least one eligible designation (e.g. OUT, IR).`,
      })
    } else if (new Set(slot.eligible_designations).size !== slot.eligible_designations.length) {
      errors.push({
        field: 'roster_settings.ir_slots',
        message: `IR spot "${slot.key}" lists a designation more than once.`,
      })
    }
    if (slot.type === 'restricted' && (slot.min_weeks < 1 || slot.min_weeks > 17)) {
      errors.push({
        field: 'roster_settings.ir_slots',
        message: `Restricted IR spot "${slot.key}" must hold players for between 1 and 17 weeks (currently ${slot.min_weeks}).`,
      })
    }
  }

  // §7.3.5 R column: trade_veto_votes 1–team_count (when league_vote)
  if (s.trade_review === 'league_vote' && (s.trade_veto_votes < 1 || s.trade_veto_votes > s.team_count)) {
    errors.push({
      field: 'trade_veto_votes',
      message: `Veto votes must be between 1 and the number of teams (${s.team_count}).`,
    })
  }

  // §7.3.5 R column: trade_deadline_week none or 1–regular_season_weeks
  if (s.trade_deadline_week !== null && (s.trade_deadline_week < 1 || s.trade_deadline_week > s.regular_season_weeks)) {
    errors.push({
      field: 'trade_deadline_week',
      message: `Trade deadline must fall inside the regular season (week 1–${s.regular_season_weeks}), or be off.`,
    })
  }

  const rosterSize = deriveRosterSize(s.roster_settings)

  // §7.3.8 bullet: auction solvency floor — auction_budget ≥ roster_size ×
  // reserve (every team can fill a legal roster). The bullet is prefixed
  // "Auction:" — enforced when the league drafts by auction (D60).
  //
  // 092/AP.1 (v2.13): the bullet used to read `× auction_min_bid`; the field
  // is gone and the reserve is DERIVED from the toggle through the ONE
  // authority below. With $0 nominations ON the reserve is 0, so every legal
  // budget satisfies it — that is the point, not a hole (§8.6.8: the
  // machinery stays correct and stops binding). The check is NOT made
  // conditional on the toggle and NOT removed; the algebra goes slack on its
  // own (D198(4)).
  const reserve = auctionReserve(s.draft.auction_zero_dollar_nominations)
  if (s.draft.draft_type === 'auction' && s.draft.auction_budget < rosterSize * reserve) {
    errors.push({
      field: 'draft.auction_budget',
      message:
        `Auction budget (${s.draft.auction_budget}) can't fill a ${rosterSize}-player roster at the ` +
        `$${reserve} per-slot reserve — needs at least ${rosterSize * reserve}. ` +
        `Allowing $0 nominations removes the reserve.`,
    })
  }

  // §7.3.8 bullet (§7.3.2: WARNS): roster_size × team_count ≤ draftable pool
  if (ctx.draftablePoolSize !== undefined && rosterSize * s.team_count > ctx.draftablePoolSize) {
    warnings.push({
      field: 'roster_settings',
      message:
        `${s.team_count} teams × ${rosterSize} roster spots = ${rosterSize * s.team_count} players, ` +
        `more than the ${ctx.draftablePoolSize} draftable players available — drafts may not be able to fill every roster.`,
    })
  }

  return { valid: errors.length === 0, errors, warnings }
}

// ---------------------------------------------------------------------------
// splitSettings / mergeSettings — the §12.1 typed-column / JSONB-blob split
// ---------------------------------------------------------------------------

/**
 * The §12.1 typed columns splitSettings owns. `status` is lifecycle (not a
 * §7.3 setting); `scoring_system_id` is a §12.1 typed column carried
 * ALONGSIDE this split by the RPC layer (§7.3.3 template choice), never
 * inside it; `max_teams` is kept in sync with team_count by the RPCs.
 */
const TYPED_COLUMN_KEYS = [
  'format',
  'team_count',
  'regular_season_weeks',
  'playoff_teams',
  'playoff_start_week',
  'waiver_type',
  'faab_budget',
  'trade_review',
  'trade_deadline_week',
  'lineup_lock',
  'roster_settings',
] as const satisfies readonly (keyof LeagueSettings)[]
type TypedColumnKey = (typeof TYPED_COLUMN_KEYS)[number]

export type LeagueTypedColumns = Pick<LeagueSettings, TypedColumnKey>

/** The long-tail fields that live in the `leagues.settings` JSONB blob. */
export type LeagueSettingsBlob = Omit<LeagueSettings, TypedColumnKey>

/**
 * The subset of a `leagues` row `mergeSettings` reads: the §12.1 typed
 * columns plus the `settings` blob. (A full generated `League` row satisfies
 * this — the type is a Pick so tests and RPC callers can build minimal rows.)
 */
export type LeagueRow = Pick<
  League,
  | 'format'
  | 'team_count'
  | 'regular_season_weeks'
  | 'playoff_teams'
  | 'playoff_start_week'
  | 'waiver_type'
  | 'faab_budget'
  | 'trade_review'
  | 'trade_deadline_week'
  | 'lineup_lock'
  | 'roster_settings'
  | 'settings'
>

/**
 * Split a full LeagueSettings into §12.1's typed columns + the `settings`
 * JSONB blob. Pure projection — no serialization, no mutation, no data loss:
 * every LeagueSettings field lands in exactly one of the two outputs
 * (`mergeSettings(splitSettings(x)) ≡ x` is a pinned property test).
 */
export function splitSettings(s: LeagueSettings): { columns: LeagueTypedColumns; blob: Json } {
  const columns = {} as Record<string, unknown>
  const blob = {} as Record<string, unknown>
  for (const [key, value] of Object.entries(s)) {
    if ((TYPED_COLUMN_KEYS as readonly string[]).includes(key)) {
      columns[key] = value
    } else {
      blob[key] = value
    }
  }
  return { columns: columns as LeagueTypedColumns, blob: blob as Json }
}

/**
 * Inverse of `splitSettings`: reconstitute LeagueSettings from a leagues row
 * (typed columns + `settings` blob), re-validated through the schema.
 * Corrupt rows THROW (ZodError) rather than yielding a silently-wrong
 * settings object (the D58 loud-failure doctrine); missing blob fields on a
 * legacy/defaulted row fill from the §7.3 defaults.
 */
export function mergeSettings(row: LeagueRow): LeagueSettings {
  const blob = row.settings
  if (blob === null || typeof blob !== 'object' || Array.isArray(blob)) {
    throw new TypeError(`mergeSettings: leagues.settings must be a JSON object, got ${blob === null ? 'null' : Array.isArray(blob) ? 'array' : typeof blob}`)
  }
  const candidate: Record<string, unknown> = {
    ...blob,
    format: row.format,
    team_count: row.team_count,
    regular_season_weeks: row.regular_season_weeks,
    playoff_teams: row.playoff_teams,
    playoff_start_week: row.playoff_start_week,
    waiver_type: row.waiver_type,
    faab_budget: row.faab_budget,
    trade_review: row.trade_review,
    trade_deadline_week: row.trade_deadline_week,
    lineup_lock: row.lineup_lock,
    roster_settings: row.roster_settings,
  }
  return leagueSettingsSchema.parse(candidate)
}
