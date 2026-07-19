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
 * - 'deferred' — no storage mapping until M1 (D5); the key is canonical for
 *   scoring rules but nothing persists it yet.
 */
export type StatStorage = 'column' | 'advanced' | 'deferred'

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
  // The three 2-pt conversion types are summed into the single
  // two_point_conversions column today; per-type storage mapping is M1 work
  // (D5), so the canonical keys stay deferred.
  { key: 'pass_2pt', label: '2-Pt Conversions (Pass)', tier: 'core_box', storage: 'deferred' },
  { key: 'rush_yards', label: 'Rushing Yards', tier: 'core_box', storage: 'column', column: 'rush_yards' },
  { key: 'rush_tds', label: 'Rushing TDs', tier: 'core_box', storage: 'column', column: 'rush_tds' },
  { key: 'rush_2pt', label: '2-Pt Conversions (Rush)', tier: 'core_box', storage: 'deferred' },
  { key: 'receptions', label: 'Receptions', tier: 'core_box', storage: 'column', column: 'receptions' },
  { key: 'receiving_yards', label: 'Receiving Yards', tier: 'core_box', storage: 'column', column: 'receiving_yards' },
  { key: 'receiving_tds', label: 'Receiving TDs', tier: 'core_box', storage: 'column', column: 'receiving_tds' },
  { key: 'rec_2pt', label: '2-Pt Conversions (Rec)', tier: 'core_box', storage: 'deferred' },
  { key: 'fumbles_lost', label: 'Fumbles Lost', tier: 'core_box', storage: 'column', column: 'fumbles_lost' },
  { key: 'fumble_recovery_td', label: 'Fumble Recovery TD', tier: 'core_box', storage: 'deferred' },
  { key: 'return_td', label: 'Kick/Punt Return TD', tier: 'core_box', storage: 'deferred' },

  // ── core_box · Appendix B.4 — kicking ─────────────────────────────────────
  { key: 'fg_0_39', label: 'FG Made (0–39)', tier: 'core_box', storage: 'deferred' }, // no short-FG column exists (D5)
  // fg_made_40_plus is misleadingly named: it holds the 40–49 bucket only
  // (live-stats STAT_MAP sources it from Sleeper's fgm_40_49; 50+ is separate).
  { key: 'fg_40_49', label: 'FG Made (40–49)', tier: 'core_box', storage: 'column', column: 'fg_made_40_plus' },
  { key: 'fg_50_plus', label: 'FG Made (50+)', tier: 'core_box', storage: 'column', column: 'fg_made_50_plus' },
  { key: 'pat_made', label: 'PAT Made', tier: 'core_box', storage: 'column', column: 'xp_made' },
  { key: 'fg_missed', label: 'FG Missed', tier: 'core_box', storage: 'deferred' },
  { key: 'pat_missed', label: 'PAT Missed', tier: 'core_box', storage: 'deferred' },

  // ── core_box · Appendix B.4 — D/ST ────────────────────────────────────────
  { key: 'def_sack', label: 'Sack', tier: 'core_box', storage: 'column', column: 'def_sacks' },
  { key: 'def_int', label: 'Defensive Interception', tier: 'core_box', storage: 'column', column: 'def_interceptions' },
  { key: 'def_fumble_rec', label: 'Fumble Recovery', tier: 'core_box', storage: 'column', column: 'def_fumble_recoveries' },
  { key: 'def_td', label: 'Defensive TD', tier: 'core_box', storage: 'column', column: 'def_tds' },
  { key: 'def_safety', label: 'Safety', tier: 'core_box', storage: 'column', column: 'def_safeties' },
  { key: 'def_block', label: 'Blocked Kick', tier: 'core_box', storage: 'deferred' },
  { key: 'def_return_td', label: 'Return TD (D/ST)', tier: 'core_box', storage: 'deferred' },
  // Points-allowed tier indicators (dst_model 'single'). B.4 names the two
  // endpoint keys (`def_pa_0` … `def_pa_35_plus`); the middle tiers follow
  // the same def_pa_<lo>_<hi> shape on the industry-standard boundaries all
  // three platforms share. The raw number lives in the def_points_allowed
  // column; deriving tier indicators is M1 scoring work, so storage stays
  // deferred.
  { key: 'def_pa_0', label: 'Points Allowed: 0', tier: 'core_box', storage: 'deferred' },
  { key: 'def_pa_1_6', label: 'Points Allowed: 1–6', tier: 'core_box', storage: 'deferred' },
  { key: 'def_pa_7_13', label: 'Points Allowed: 7–13', tier: 'core_box', storage: 'deferred' },
  { key: 'def_pa_14_20', label: 'Points Allowed: 14–20', tier: 'core_box', storage: 'deferred' },
  { key: 'def_pa_21_27', label: 'Points Allowed: 21–27', tier: 'core_box', storage: 'deferred' },
  { key: 'def_pa_28_34', label: 'Points Allowed: 28–34', tier: 'core_box', storage: 'deferred' },
  { key: 'def_pa_35_plus', label: 'Points Allowed: 35+', tier: 'core_box', storage: 'deferred' },

  // ── core_box · Appendix B.4 — bonuses (the two the spec names; the rest of
  // the reserved catalog — further bonuses, TE premium, idp_* — arrives with
  // the v1.1 custom-scoring unlock) ─────────────────────────────────────────
  { key: 'pass_300_bonus', label: '300-Yard Passing Game', tier: 'core_box', storage: 'deferred' },
  { key: 'rush_100_bonus', label: '100-Yard Rushing Game', tier: 'core_box', storage: 'deferred' },

  // ── D15 placeholders — tier-machinery proof only, never product stats ─────
  { key: 'example_tracking_yards', label: 'Example Tracking Yards (placeholder)', tier: 'tracking', storage: 'advanced', placeholder: true },
  { key: 'example_charted_yards', label: 'Example Charted Yards (placeholder)', tier: 'charted', storage: 'advanced', placeholder: true },
]
