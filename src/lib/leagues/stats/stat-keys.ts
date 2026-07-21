/**
 * STAT_KEYS — the canonical stat-key registry (spec §23.5; M0 task L.A0.2a).
 *
 * ONE shared key namespace for scoring rules and stat payloads: §7.3.3's
 * dot-product (score = Σ rules[key] × stat(key)) requires rules keys ≡ stat
 * keys — no translation layer, ever (D5). Provider adapters map feed-native
 * field names into these keys at the edge; everything downstream speaks only
 * this namespace.
 *
 * Contents (Q2 resolved 2026-07-18 — advanced stats punted until funded):
 * - `core_box`: the Appendix B.1 + B.4 catalog. (§23.5 and the M0 breakdown
 *   cite "Appendix B.1–B.5", but Appendix B ends at B.4 — B.2/B.3 are the
 *   punted Alpha/Ultra templates, so B.1 + B.4 is the whole core_box set.)
 * - `tracking`/`charted`: D15 placeholder keys ONLY (`placeholder: true`).
 *   They exist so the tier machinery (capability gating, two-phase settle,
 *   revision handling) is exercisable before real advanced keys are funded;
 *   they are never product stats and never persisted. Real keys arrive later
 *   via the §23.5 one-PR checklist.
 */

import type { Database } from '@/types/database'

/** A column of the deployed player_stats table — typed against the generated
 *  schema so a bogus storage mapping fails `npm run type-check`. */
export type PlayerStatsColumn =
  keyof Database['public']['Tables']['player_stats']['Row']

/** §23.5 capability tiers, declared by each provider adapter. */
export type StatTier = 'core_box' | 'tracking' | 'charted'

/**
 * Where a canonical key's value lives today:
 * - 'column'   — a typed player_stats column exists now (named in `column`).
 * - 'advanced' — the §23.5 player_stats.advanced JSONB home for
 *   tracking/charted stats. The column itself deliberately does NOT exist in
 *   M0 (D8) — it lands with the first milestone that persists advanced stats.
 * - 'derived'  — never persisted: the value is computed at scoring time by a
 *   pure helper from a raw column-stored key (D44 — the def_pa / def_ya
 *   one-hot tier indicators, from def_points_allowed/def_yards_allowed).
 * - 'deferred' — no storage decision yet; the key is canonical for scoring
 *   rules but nothing persists it. (M0's deferrals were resolved by L.A1.7 /
 *   migration 057 per D41 — what remains deferred is v1.1-unlock material.)
 */
export type StatStorage = 'column' | 'advanced' | 'derived' | 'deferred'

export interface StatKeyDef {
  /** Canonical key — the one namespace shared by rules and stats (§7.3.3). */
  key: string
  label: string
  tier: StatTier
  storage: StatStorage
  /** Present iff storage === 'column': the player_stats column holding it. */
  column?: PlayerStatsColumn
  /** D15: machinery-proof keys only; never a product stat, never persisted. */
  placeholder?: true
}

export const STAT_KEYS: readonly StatKeyDef[] = [
  // ── core_box · Appendix B.1 — core offense ────────────────────────────────
  { key: 'pass_yards', label: 'Passing Yards', tier: 'core_box', storage: 'column', column: 'pass_yards' },
  { key: 'pass_tds', label: 'Passing TDs', tier: 'core_box', storage: 'column', column: 'pass_tds' },
  { key: 'interceptions', label: 'Interceptions Thrown', tier: 'core_box', storage: 'column', column: 'interceptions' },
  // Per-type 2-pt columns landed with migration 057 (D20's "per-type storage
  // is M1 work", honored by L.A1.7/D41); the writer still derives the summed
  // two_point_conversions column alongside, byte-identical to pre-seam.
  { key: 'pass_2pt', label: '2-Pt Conversions (Pass)', tier: 'core_box', storage: 'column', column: 'pass_2pt' },
  { key: 'rush_yards', label: 'Rushing Yards', tier: 'core_box', storage: 'column', column: 'rush_yards' },
  { key: 'rush_tds', label: 'Rushing TDs', tier: 'core_box', storage: 'column', column: 'rush_tds' },
  { key: 'rush_2pt', label: '2-Pt Conversions (Rush)', tier: 'core_box', storage: 'column', column: 'rush_2pt' },
  { key: 'receptions', label: 'Receptions', tier: 'core_box', storage: 'column', column: 'receptions' },
  { key: 'receiving_yards', label: 'Receiving Yards', tier: 'core_box', storage: 'column', column: 'receiving_yards' },
  { key: 'receiving_tds', label: 'Receiving TDs', tier: 'core_box', storage: 'column', column: 'receiving_tds' },
  { key: 'rec_2pt', label: '2-Pt Conversions (Rec)', tier: 'core_box', storage: 'column', column: 'rec_2pt' },
  { key: 'fumbles_lost', label: 'Fumbles Lost', tier: 'core_box', storage: 'column', column: 'fumbles_lost' },
  { key: 'fumble_recovery_td', label: 'Fumble Recovery TD', tier: 'core_box', storage: 'column', column: 'fumble_recovery_td' },
  { key: 'return_td', label: 'Kick/Punt Return TD', tier: 'core_box', storage: 'column', column: 'return_td' },

  // ── core_box · Appendix B.4 — kicking ─────────────────────────────────────
  { key: 'fg_0_39', label: 'FG Made (0–39)', tier: 'core_box', storage: 'column', column: 'fg_0_39' },
  // fg_made_40_plus is misleadingly named: it holds the 40–49 bucket only
  // (live-stats STAT_MAP sources it from Sleeper's fgm_40_49; 50+ is separate).
  { key: 'fg_40_49', label: 'FG Made (40–49)', tier: 'core_box', storage: 'column', column: 'fg_made_40_plus' },
  { key: 'fg_50_plus', label: 'FG Made (50+)', tier: 'core_box', storage: 'column', column: 'fg_made_50_plus' },
  { key: 'pat_made', label: 'PAT Made', tier: 'core_box', storage: 'column', column: 'xp_made' },
  { key: 'fg_missed', label: 'FG Missed', tier: 'core_box', storage: 'column', column: 'fg_missed' },
  { key: 'pat_missed', label: 'PAT Missed', tier: 'core_box', storage: 'column', column: 'pat_missed' },

  // ── core_box · Appendix B.4 — D/ST ────────────────────────────────────────
  { key: 'def_sack', label: 'Sack', tier: 'core_box', storage: 'column', column: 'def_sacks' },
  { key: 'def_int', label: 'Defensive Interception', tier: 'core_box', storage: 'column', column: 'def_interceptions' },
  { key: 'def_fumble_rec', label: 'Fumble Recovery', tier: 'core_box', storage: 'column', column: 'def_fumble_recoveries' },
  { key: 'def_td', label: 'Defensive TD', tier: 'core_box', storage: 'column', column: 'def_tds' },
  { key: 'def_safety', label: 'Safety', tier: 'core_box', storage: 'column', column: 'def_safeties' },
  { key: 'def_block', label: 'Blocked Kick', tier: 'core_box', storage: 'column', column: 'def_block' },
  { key: 'def_return_td', label: 'Return TD (D/ST)', tier: 'core_box', storage: 'column', column: 'def_return_td' },
  // Points-allowed tier indicators. B.4 names the two endpoint keys
  // (`def_pa_0` … `def_pa_35_plus`); the middle tiers follow the same
  // def_pa_<lo>_<hi> shape (D21). Storage is 'derived' (D44): a pure helper
  // one-hots these from the raw def_points_allowed column at scoring time —
  // they are never persisted.
  { key: 'def_pa_0', label: 'Points Allowed: 0', tier: 'core_box', storage: 'derived' },
  { key: 'def_pa_1_6', label: 'Points Allowed: 1–6', tier: 'core_box', storage: 'derived' },
  { key: 'def_pa_7_13', label: 'Points Allowed: 7–13', tier: 'core_box', storage: 'derived' },
  { key: 'def_pa_14_20', label: 'Points Allowed: 14–20', tier: 'core_box', storage: 'derived' },
  { key: 'def_pa_21_27', label: 'Points Allowed: 21–27', tier: 'core_box', storage: 'derived' },
  { key: 'def_pa_28_34', label: 'Points Allowed: 28–34', tier: 'core_box', storage: 'derived' },
  { key: 'def_pa_35_plus', label: 'Points Allowed: 35+', tier: 'core_box', storage: 'derived' },
  // ESPN-bucket points-allowed indicators (L.A1.7, migration-057 session).
  // FINDING (PROGRESS D56; spec changelog v2.8.3): ESPN's PUBLISHED standard
  // table — support.espn.com/hc/en-us/articles/360003914032-Scoring-Formats,
  // retrieved 2026-07-20 — buckets points allowed as 0 / 1–6 / 7–13 / 14–17 /
  // 18–27 / 28–34 / 35–45 / 46+ (values +5/+4/+3/+1/0/−1/−3/−5), which the
  // D21 "shared" family above cannot express (it assumed 14–20/21–27/35+).
  // Q3's build-time-verification condition caught this; per the task charter
  // ESPN's own buckets are seeded additively beside the shared family. The
  // 0 / 1–6 / 7–13 / 28–34 buckets are genuinely shared and not duplicated.
  { key: 'def_pa_14_17', label: 'Points Allowed: 14–17 (ESPN)', tier: 'core_box', storage: 'derived' },
  { key: 'def_pa_18_27', label: 'Points Allowed: 18–27 (ESPN)', tier: 'core_box', storage: 'derived' },
  { key: 'def_pa_35_45', label: 'Points Allowed: 35–45 (ESPN)', tier: 'core_box', storage: 'derived' },
  { key: 'def_pa_46_plus', label: 'Points Allowed: 46+ (ESPN)', tier: 'core_box', storage: 'derived' },
  // Yards-allowed tier indicators — the Q3 `def_ya_<lo>_<hi>` family (ruled
  // 2026-07-19; D21 naming convention), seeded on ESPN's PUBLISHED bucket
  // boundaries (same Scoring-Formats page + the D/ST-Scoring article's split
  // confirmation: standard D/ST starts +10 = 5 for 0 PA + 5 for 0 YA):
  // <100 / 100–199 / 200–299 / 300–349 / 350–399 / 400–449 / 450–499 /
  // 500–549 / 550+. Derived at scoring time from the raw def_yards_allowed
  // column (D44) — never stored. Note for L.A1.9: ESPN publishes the YA
  // BUCKETS but not the standard YA point values on its support pages; the
  // template task pulls values from the in-product default scoring settings.
  { key: 'def_ya_0_99', label: 'Yards Allowed: <100', tier: 'core_box', storage: 'derived' },
  { key: 'def_ya_100_199', label: 'Yards Allowed: 100–199', tier: 'core_box', storage: 'derived' },
  { key: 'def_ya_200_299', label: 'Yards Allowed: 200–299', tier: 'core_box', storage: 'derived' },
  { key: 'def_ya_300_349', label: 'Yards Allowed: 300–349', tier: 'core_box', storage: 'derived' },
  { key: 'def_ya_350_399', label: 'Yards Allowed: 350–399', tier: 'core_box', storage: 'derived' },
  { key: 'def_ya_400_449', label: 'Yards Allowed: 400–449', tier: 'core_box', storage: 'derived' },
  { key: 'def_ya_450_499', label: 'Yards Allowed: 450–499', tier: 'core_box', storage: 'derived' },
  { key: 'def_ya_500_549', label: 'Yards Allowed: 500–549', tier: 'core_box', storage: 'derived' },
  { key: 'def_ya_550_plus', label: 'Yards Allowed: 550+', tier: 'core_box', storage: 'derived' },

  // ── core_box · Appendix B.4 — bonuses (the two the spec names; the rest of
  // the reserved catalog — further bonuses, TE premium, idp_* — arrives with
  // the v1.1 custom-scoring unlock). Still 'deferred' after L.A1.7: no v1
  // parity template scores a bonus, so the storage-vs-derivation decision
  // belongs to the v1.1 unlock (they are threshold indicators over yardage,
  // so 'derived' is the likely answer — deliberately not pre-decided here). ──
  { key: 'pass_300_bonus', label: '300-Yard Passing Game', tier: 'core_box', storage: 'deferred' },
  { key: 'rush_100_bonus', label: '100-Yard Rushing Game', tier: 'core_box', storage: 'deferred' },

  // ── core_box · ingestion-continuity keys (L.A0.2b, D24 — D22 option
  // "extend the adapter map + registry additively") ──────────────────────────
  // Not Appendix B scoring categories: pre-existing player_stats columns the
  // app's research/usage surfaces consume. They ride the canonical §23.1
  // payload so the seam refactor — and record/replay, which only sees
  // canonical method responses (D6) — reproduces today's ingestion writes
  // exactly. §7.3.3 is untroubled: stat keys no rules reference are ignored.
  // qb_sack_taken is the one spec-named key here (App B.3, box-score tier) —
  // seeded now, ahead of D21's funded-Alpha/Ultra deferral, so the
  // sacks_taken column never acquires a second canonical name.
  { key: 'pass_attempts', label: 'Pass Attempts', tier: 'core_box', storage: 'column', column: 'pass_attempts' },
  { key: 'pass_completions', label: 'Pass Completions', tier: 'core_box', storage: 'column', column: 'pass_completions' },
  { key: 'qb_sack_taken', label: 'Sacks Taken', tier: 'core_box', storage: 'column', column: 'sacks_taken' },
  { key: 'rush_attempts', label: 'Rush Attempts', tier: 'core_box', storage: 'column', column: 'rush_attempts' },
  { key: 'targets', label: 'Targets', tier: 'core_box', storage: 'column', column: 'targets' },
  { key: 'fg_made', label: 'FG Made (Total)', tier: 'core_box', storage: 'column', column: 'fg_made' },
  { key: 'fg_attempted', label: 'FG Attempted', tier: 'core_box', storage: 'column', column: 'fg_attempted' },
  { key: 'pat_attempted', label: 'PAT Attempted', tier: 'core_box', storage: 'column', column: 'xp_attempted' },
  // The raw points-allowed number; the derived def_pa_<lo>_<hi> tier
  // indicators above one-hot from this at scoring time (D44).
  { key: 'def_points_allowed', label: 'Points Allowed (Raw)', tier: 'core_box', storage: 'column', column: 'def_points_allowed' },
  // Raw total yards allowed — the def_ya_* family's source (Q3/D44). Column
  // added by migration 057; no Sleeper actuals mapping yet (no repo evidence
  // for the feed spelling — see the L.A1.7 adapter audit note in the map).
  { key: 'def_yards_allowed', label: 'Yards Allowed (Raw)', tier: 'core_box', storage: 'column', column: 'def_yards_allowed' },

  // ── D15 placeholders — tier-machinery proof only, never product stats ─────
  { key: 'example_tracking_yards', label: 'Example Tracking Yards (placeholder)', tier: 'tracking', storage: 'advanced', placeholder: true },
  { key: 'example_charted_yards', label: 'Example Charted Yards (placeholder)', tier: 'charted', storage: 'advanced', placeholder: true },
]
