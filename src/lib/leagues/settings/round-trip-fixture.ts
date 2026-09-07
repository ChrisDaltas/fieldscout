/**
 * The §7.3 round-trip enumeration fixture (M1 task L.A1.6, test item 3).
 *
 * THE list the gate's item 3 means by "every §7.3 field": every
 * leagueSettingsSchema field (§7.3.1/7.3.4–7.3.8) + rosterSettingsSchema
 * (§7.3.2) + `scoring_system_id` (§7.3.3's template choice — a §12.1 typed
 * column carried ALONGSIDE splitSettings' output, never inside it).
 *
 * L.A1.13's API round-trip drives THIS SAME fixture through the real
 * create/PATCH/read path — import it from here, don't re-enumerate.
 *
 * Design rule (pinned by split-merge.test.ts): every leaf differs from
 * LEAGUE_SETTINGS_DEFAULTS except the fields with exactly one legal value
 * (`format`, `playoff_byes`, `draft.autopick_default`) — so a field that
 * silently falls back to its default anywhere in the split/merge/API path
 * FAILS the round-trip comparison instead of passing vacuously. The same
 * test pins the fixture's field paths ≡ the schema's field paths, so adding
 * a catalog field without extending this fixture fails loudly.
 */
import type { LeagueSettings } from './league-settings'

/**
 * §7.3.3 template choice carried alongside the settings split. Any template
 * row id works for the TS round-trip; L.A1.13 substitutes a real seeded
 * template id when driving the API path.
 */
export const ROUND_TRIP_SCORING_SYSTEM_ID = '00000000-0000-4000-8000-00000000c0de'

/** Ten team ids for the manual draft order (team_count 10 below). */
const DRAFT_ORDER = [
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000104',
  '00000000-0000-4000-8000-000000000105',
  '00000000-0000-4000-8000-000000000106',
  '00000000-0000-4000-8000-000000000107',
  '00000000-0000-4000-8000-000000000108',
  '00000000-0000-4000-8000-000000000109',
  '00000000-0000-4000-8000-000000000110',
]

/** 098/AP.5: the auction's manual nomination order — the SAME ten seats,
 *  reversed, so the round trip provably carries two DIFFERENT orders. */
const NOMINATION_ORDER = [...DRAFT_ORDER].reverse()

export const ROUND_TRIP_SETTINGS: LeagueSettings = {
  // §7.3.1 — format & structure
  format: 'redraft', // single-option field (v1)
  team_count: 10,
  divisions: 2,
  regular_season_weeks: 13,
  playoff_teams: 0, // non-default (6); 0 because `schedule_mode` below is total_points — Q39 (C), v2.16.25: a total-points league has no bracket (migration 118 refuses > 0)
  playoff_start_week: 14, // = regular_season_weeks + 1 (the Q10/v2.8.6 seam) while both stay non-default — validity pinned in split-merge.test.ts
  playoff_weeks_per_round: 2, // non-default; with 0 playoff teams no round is scheduled (the ≤ 18 arithmetic is skipped, D60(5))
  playoff_byes: 'auto', // single-option field (derived)
  playoff_reseed: false,
  consolation_bracket: true,
  third_place_game: true,
  schedule_mode: 'total_points',
  median_game: true,
  second_opponent: true,
  schedule_seed: 20260909, // §11.7 (migration 110): non-null, non-default — the round trip must carry a MINTED seed through the blob

  // §7.3.2 — roster (exercises multi-flex, custom IDP flex, a 0-count slot,
  // both IR types, the DL preset shape, and Hot Swap on)
  roster_settings: {
    starting_slots: [
      { key: 'qb', label: 'QB', eligible: ['QB'], count: 1 },
      { key: 'rb', label: 'RB', eligible: ['RB'], count: 1 },
      { key: 'wr', label: 'WR', eligible: ['WR'], count: 3 },
      { key: 'te', label: 'TE', eligible: ['TE'], count: 1 },
      { key: 'flex1', label: 'W/R/T', eligible: ['WR', 'RB', 'TE'], count: 1 },
      { key: 'flex2', label: 'W/T', eligible: ['WR', 'TE'], count: 1 },
      { key: 'superflex', label: 'SUPERFLEX', eligible: ['QB', 'WR', 'RB', 'TE'], count: 1 },
      { key: 'idp_flex', label: 'IDP', eligible: ['DL', 'LB', 'DB'], count: 1 },
      { key: 'k', label: 'K', eligible: ['K'], count: 0 },
      { key: 'dst', label: 'D/ST', eligible: ['DST'], count: 1 },
    ],
    bench: 5,
    ir_slots: [
      { key: 'dl1', label: 'DL', type: 'restricted', eligible_designations: ['OUT', 'IR', 'Doubtful'], min_weeks: 2 },
      { key: 'ir2', type: 'unrestricted', eligible_designations: ['OUT', 'IR', 'PUP', 'NFI', 'Suspended'] },
    ],
    swap_spots: 1,
  }, // roster_size = 11 starters + 5 bench + 2 IR = 18

  // §7.3.4 — waivers & free agency
  waiver_type: 'rolling_priority',
  faab_budget: 500,
  faab_min_bid: 2,
  faab_tiebreaker: 'rolling_priority',
  waiver_process_day: 'tue',
  waiver_process_time: '11:30',
  waiver_period_hours: 24,
  free_agency: 'continuous',
  acquisitions_per_week: 7,
  acquisitions_per_season: 100,
  bench_lock: false,
  fa_hold_hours: 24,

  // §7.3.5 — trades
  trade_review: 'league_vote',
  trade_veto_votes: 5,
  trade_review_period_hours: 48,
  trade_deadline_week: 10,
  allow_faab_in_trades: true,
  allow_future_considerations: true,
  trade_lock_behavior: 'reject',

  // §7.3.6 — lineups & lock
  lineup_lock: 'per_player_kickoff', // single-option since v2.16.20 (Q34(A)/114 — the DB CHECK refuses anything else)
  allow_illegal_lineups: false,
  auto_sub_inactives: true,
  stat_correction_window: 24,

  // §7.3.7 — tiebreakers (reordered vs the default chain)
  tiebreakers: ['win_pct', 'points_for', 'points_against', 'head_to_head', 'division_record', 'coin_flip'],

  // §7.3.8 — draft block (auction path; untimed picks; anti-snipe off)
  draft: {
    draft_type: 'auction',
    snake_reversal: true,
    draft_order_mode: 'manual',
    draft_order: DRAFT_ORDER,
    pick_timer_seconds: 0,
    auction_budget: 1000,
    auction_zero_dollar_nominations: true, // 092/AP.1: the NON-default value, so the round trip carries it
    auction_nomination_seconds: 15,
    auction_bid_seconds: 45,
    auction_anti_snipe_seconds: 0,
    nomination_order_mode: 'random',
    nomination_order: NOMINATION_ORDER, // 098/AP.5 — differs from the null default (and from DRAFT_ORDER)
    autopick_default: 'queue_then_board_then_adp', // single-option field (fixed strategy)
    disconnect_grace_seconds: 0,
    draft_scheduled_at: '2028-08-30T23:00:00.000Z', // F49 sweep (L.B7.1): far-future
    time_zone: 'America/New_York', // D98 (v2.9.2) — differs from the null default
  },
}

/**
 * Fields whose only legal value equals the default — the documented
 * exceptions to the "every leaf differs from the default" rule.
 */
export const SINGLE_OPTION_FIELD_PATHS = ['format', 'playoff_byes', 'lineup_lock', 'draft.autopick_default'] as const
