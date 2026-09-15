-- ============================================================================
-- `commish_change_setting` — the PER-KEY in-season settings override —
-- migration 129
-- (task L.E1.8 of M6A; tasks-M6A §6 "L.E1.8", §5's contractual shapes, §3
-- D336 / D347 / D350; §4 rules 1-15; §11 Q64; PROGRESS §3 STANDING RULE
-- clauses (a), (b), (d), (g), (i); `spec:1701` (§15.4), §7.3 header, §7.3.3's
-- snapshot bullet, §10.3, §12.12, §12.26.)
--
-- WHAT THIS MIGRATION DOES
--   1. `commish_setting_actions` — this verb's OWN zero-policy replay ledger
--      (D350), `UNIQUE (league_id, action_id)` + `REVOKE TRUNCATE`.
--   2. `commish_setting_policy(p_key)` — THE PER-KEY POLICY TABLE AS DATA
--      (item 2 of the task text), so the banner's table, the verb's branches
--      and pgTAP 077's pins are ONE object and cannot drift from each other.
--      IMMUTABLE, pure; L.E1.13's settings panel renders refusal copy from it.
--   3. Four small value gates (`commish_setting_int_internal`,
--      `_bool_`, `_enum_`, `_canon_`) that turn a caller's JSON value into
--      the ONE canonical jsonb the verb compares and stores — which is what
--      makes `2` and `"2"` the same value (item 4; `123:1016` is the model).
--   4. `commish_change_setting_internal` + `commish_change_setting` — the
--      audited verb, the 123 template in all seven parts (D336).
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS A NEW VERB AND NOT A REUSE OF 118's BODY (D347, item 1)
-- ---------------------------------------------------------------------------
-- `update_league_settings` — newest defining migration **118** (`118:2438`);
-- 061 and 105 are DECOYS, both superseded — writes a WHOLE DOCUMENT: one
-- UPDATE setting 13 typed columns plus `roster_settings` and `settings`
-- (`118:2595-2612`). `spec:1701` prints a PER-KEY signature —
-- `commish_change_setting(key, value, rescore?, reason)` — and a per-key
-- receipt is the whole point: a `commissioner_actions` row whose
-- `before`/`after` carry fifteen fields says nothing about which one moved.
-- So this verb does a READ-MODIFY-WRITE OF ONE KEY, and its receipt names
-- that key ALONE (§5's contractual shape: `before`/`after` = `{<key>: value}`).
--
-- THE GATE IT LIFTS. 118's step 3 (`118:2489-2497`) refuses every status
-- outside `setup`/`scheduled` with a message that names THIS verb as the
-- remedy: *"settings are locked once the draft starts; post-draft changes are
-- audited commissioner overrides (M6) (§7.3)"*. The §7.3 header is the law
-- behind it: *"After the draft, structural settings … become
-- commissioner-override-only (changing them mid-season is allowed but logged
-- and warned)."* This verb IS that override. It carries no status gate of its
-- own beyond `deleted_at IS NULL` (standing rule (a): *"any time the league is
-- in a state where the action is meaningful"*); what it carries instead is
-- the per-key table below, because lifting 118's gate detonates two
-- statements that were safe ONLY because of it. Both are RE-DECIDED here, in
-- writing, as the task requires:
--
-- ---------------------------------------------------------------------------
-- RE-DECISION 1 — THE FAAB RE-SEED (`118:2617-2621`)
-- ---------------------------------------------------------------------------
-- 118 step 8: `UPDATE league_members SET faab_balance = p_faab_budget WHERE
-- league_id = …` whenever the budget changes, under its own comment *"pre-draft
-- (guaranteed by the status gate), faab_balance carries no history — re-seed
-- every seat"* (D70's §12.2 invariant: every balance equals the budget until
-- the first claim). IN-SEASON the same statement WIPES EVERY TEAM'S SPEND — a
-- seat that has bid its budget down to 37 would be handed a fresh 150.
--
-- DECIDED: **the re-seed fires ONLY while the league is in `setup` or
-- `scheduled` — the exact precondition 118's own comment names — and NEVER
-- after.** In-season a `faab_budget` change LANDS (the column moves; the
-- number a future `commish_edit_faab` and the waiver worker read as the
-- season's budget changes) and EVERY `faab_balance` is BYTE-UNCHANGED: a
-- spent balance is the ledger of what that team did, and rewriting it would
-- forge history the same way rewriting a receipt would. The result names
-- `faab_reseeded = false`, WHY, the MEASURED number of seats whose balance now
-- differs from the new budget, and the per-team route that does exist for
-- adjusting one balance (`commish_edit_faab`, §15.4:1698 — M5's, F340). The
-- rejected alternatives: (i) refuse the key in-season — a budget number is
-- meaningful all season and refusing it is a reachability defect under
-- standing rule (a); (ii) add the DELTA to every balance — invented policy
-- nobody ruled, and it hands a team that overspent a negative number.
-- pgTAP 077 §F proves the in-season case WITH ITS PREMISE (§4 rule 14(c) /
-- F345): a seat is seated at 37 — a value that differs from BOTH the old
-- budget (100) and the new (150) — asserted by value BEFORE the change, then
-- byte-unchanged after; and a `setup` league beside it proves the re-seed
-- still fires pre-draft, so the in-season zero is the STATUS condition and
-- not a deleted statement. Break probe 1 reinstates 118's unconditional
-- re-seed and §F reds.
--
-- ---------------------------------------------------------------------------
-- RE-DECISION 2 — THE SCORING-SNAPSHOT RE-FREEZE (`118:2585-2590`)
-- ---------------------------------------------------------------------------
-- 118 step 6: a `scoring_system_id` change with an existing snapshot refreshes
-- `scoring_rules_snapshot` from the NEW system's rules; a NULL snapshot stays
-- NULL. §7.3.3's snapshot bullet is LAW and on CLAUDE.md's never-weaken list:
-- *"on draft start (**and on any commissioner scoring change**), the
-- template's full `rules` JSONB is frozen into `leagues.scoring_rules_snapshot`;
-- all scoring — live, finalization, rescoring — reads the snapshot."*
--
-- DECIDED: **the re-freeze STAYS, unchanged in shape** — a scoring change
-- in-season writes the new rules into the snapshot in the SAME statement that
-- moves the reference, so there is never an instant where the reference and
-- the frozen document disagree; a NULL snapshot (pre-draft) stays NULL exactly
-- as 118 leaves it, because `draft_start` is the freezer then (059/110). 104's
-- two column walls (`trg_leagues_scoring_rules_valid` on the snapshot,
-- `trg_leagues_scoring_reference_guard` on the reference) fire on this UPDATE
-- and are NOT bypassed — a commissioner cannot freeze an invalid document.
-- The attachable scope is 118 step 5's, verbatim in meaning: a template, or
-- the league's own currently-referenced row (which is the no-op).
--
-- WHAT THE RE-FREEZE DOES NOT DO, SAID OUT LOUD (§4 rule 15): it does NOT
-- rewrite any stored score. A FINAL week's `team_week_results` / `matchups`
-- are untouched — `score_write_week_batch` refuses a final week by name
-- (`119:566-568`) and the total-points arm guards `is_final = FALSE`
-- (`119:600-602`). An OPEN week's stored points were computed under the
-- PREVIOUS snapshot and its next drain will use the NEW one, so without a
-- rescore that week is MIXED; the result says so (`score_stale = true`,
-- `score_stale_reason = 'snapshot_changed_without_rescore'`) rather than
-- letting a re-frozen snapshot read as a re-scored season.
--
-- ---------------------------------------------------------------------------
-- `rescore: true` — AND THE ONE SEAM A FUTURE `reopen_week` REPLACES (Q64)
-- ---------------------------------------------------------------------------
-- Task item 3: *"`rescore: true` EITHER reaches a final week through an
-- audited `reopen_week` OR refuses that week BY NAME … Silently accepting the
-- flag is not an option (§4 rule 15)."* Q64's RECOMMENDATION, built to as
-- instructed: **ship `rescore` REFUSING a final week BY NAME; `reopen_week` is
-- its own task if the capability is wanted.** So:
--
--   * `rescore` on any key other than `scoring_system_id` is a MALFORMED CALL
--     (22023): the flag has no subject there and a success document for a
--     flag that meant nothing is 126's rule against.
--   * `rescore = true` on a scoring change where this season has ≥ 1 FINAL
--     `league_weeks` row ⇒ **P0001, refused BY NAME**, listing every final
--     week, and the WHOLE call rolls back (the snapshot is not re-frozen
--     either — a commissioner who asked for a rescored season gets a rescored
--     season or nothing, never half). The message names the two routes that
--     exist: resubmit with `rescore = false` (scoring changes going forward;
--     stored scores stay), or wait for `reopen_week`.
--   * `rescore = true` with NO final week ⇒ every OPEN week (`live` /
--     `correction_window`) is re-queued: one `score_fanout` row per starter
--     per team-week, stamped with that player's own `MIN(player_stats.
--     updated_at)` and never `now()` (123's SCORING rule — the worker's
--     readiness test is `updated_at >= enqueued_at`, so a `now()` stamp is
--     `not_ready` for ever). The worker recomputes a WHOLE team when any
--     starter of it is queued (`score-week-worker.ts` → `startersByTeam` /
--     `toCompute`), so this is sufficient and, with `ON CONFLICT DO NOTHING`,
--     harmless. A starter with no stamped stat line is NAMED in
--     `score_not_enqueued`, never folded into silence (R968's arm). An
--     `upcoming`-only season reports `rescore_performed = false` with
--     `nothing_scored_yet` — the flag did nothing because there was nothing,
--     and the document says so.
--   * `rescore = false` (or NULL) ⇒ nothing is queued; the result reports
--     `rescore_performed = false`, `rescore_not_performed_why = 'not_requested'`,
--     and names the final weeks whose stored scores were left as they were
--     and the open weeks now MIXED (above).
--
-- **THE SEAM, EXACTLY.** The refusal lives in ONE place — step (11b) below,
-- the `IF p_rescore AND v_final_weeks <> '[]'::jsonb THEN RAISE` block,
-- marked `-- Q64 SEAM`. A future `reopen_week` task replaces that RAISE with:
-- for each week in `v_final_weeks`, `PERFORM public.reopen_week_internal(
-- p_league_id, week, p_at, v_reason)` — which must write its OWN
-- `commissioner_actions` row (`action_type = 'reopen_week'`, §12.12's printed
-- vocabulary) and flip `league_weeks.status` final → correction_window WITH
-- that row's id in `reopened_by_action_id` on the same UPDATE (110's
-- transition guard, `110:285-296`, already demands exactly that) — and then
-- lets the existing step (11c) enqueue the reopened week alongside the open
-- ones. Nothing else in this function changes: `v_final_weeks` is computed
-- either way, the result fields already exist, and pgTAP 077 §G's "refused by
-- name" cell becomes that task's "reopened with an audited row" cell. The
-- split seam the task reserved (migration 132 / pgTAP 080) was NOT taken —
-- no `reopen_week` is built here.
--
-- ---------------------------------------------------------------------------
-- THE PER-KEY POLICY TABLE (item 2) — `commish_setting_policy(key)` IS THIS
-- TABLE AS DATA; pgTAP 077 §L pins the rows below against it
-- ---------------------------------------------------------------------------
-- Classes:
--   FREE      changeable in ANY status through this verb; no scoring or
--             calendar consequence; `bypassed` names 118's status gate when
--             the league is past `scheduled`.
--   RESCORE   `scoring_system_id` — changeable; re-freezes the snapshot
--             (re-decision 2); `rescore` governs stored scores (above).
--   BRACKET   changeable until the playoff bracket EXISTS; refused BY NAME in
--             `playoffs` / `complete`, because `playoff_bracket_sync_internal`
--             has already read them (`118:1075-1077`, `118:1338-1340`) and
--             seeded rows from them.
--   REFUSED   never through this verb, refused BY NAME with the route:
--             pre-draft the route is `update_league_settings`, which
--             validates these as a COUPLED document (Q10's
--             `playoff_start_week = regular_season_weeks + 1`, F28's seat
--             floor, Q39's total-points/bracket coupling); post-draft the
--             thing they define ALREADY EXISTS under rows no verb re-plans.
--
-- | key                        | storage | class   | what a change does / why refused |
-- |----------------------------|---------|---------|----------------------------------|
-- | waiver_type                | column  | FREE    | the next waiver run reads it |
-- | faab_budget                | column  | FREE    | re-decision 1: balances byte-unchanged in-season; re-seeded ONLY in setup/scheduled |
-- | trade_review               | column  | FREE    | the next trade proposal reads it |
-- | trade_deadline_week        | column  | FREE    | nullable (none) or 1..regular_season_weeks — read at proposal time |
-- | roster_settings            | column  | FREE    | §7.3 header: roster slots are override-only post-draft, "allowed but logged and warned". NOTHING RE-FITS a stored `team_lineups.slot_map`: the next `set_lineup` / autopilot pass fits against the new shape; the result COUNTS the lineup rows of open/upcoming weeks left un-refit (`lineups_not_refit`) so the warning is a number, not a mood |
-- | faab_min_bid · faab_tiebreaker · waiver_process_day · waiver_process_time · waiver_period_hours · free_agency · acquisitions_per_week · acquisitions_per_season · bench_lock · fa_hold_hours | blob | FREE | waiver/FA knobs, read per run |
-- | trade_veto_votes · trade_review_period_hours · allow_faab_in_trades · allow_future_considerations · trade_lock_behavior | blob | FREE | trade knobs, read per proposal |
-- | allow_illegal_lineups · auto_sub_inactives · stat_correction_window | blob | FREE | lineup / correction knobs, read per tick |
-- | tiebreakers                | blob    | FREE    | `league_standings` applies the STORED order on every read (`117:1020-1033`) — a change re-ranks the standings on the next read; nothing stored moves |
-- | playoff_reseed             | blob    | FREE    | read at EACH round advance (`118:1077`, `:1340`) |
-- | scoring_system_id          | column  | RESCORE | re-decision 2 + the `rescore` block above |
-- | playoff_teams              | column  | BRACKET | moves who makes the bracket; Q39's `> 0` under total_points refused; ≤ team_count; ∈ {0,2,4,…,12} |
-- | playoff_weeks_per_round · consolation_bracket · third_place_game | blob | BRACKET | read when the bracket is seeded |
-- | regular_season_weeks       | column  | REFUSED | the SEASON WINDOW: `league_weeks` + `matchups` were generated for the stored plan (`111:346`, `:422`) and D288's standings cutoff reads it; moving it under rows that exist re-plans nothing and re-cuts the standings. Coupled to `playoff_start_week` by Q10 — one key at a time cannot keep the pair |
-- | playoff_start_week         | column  | REFUSED | same window, same coupling |
-- | team_count                 | column  | REFUSED | PRE-DRAFT ONLY by spec — §7.3 erratum v2.16.40 (Q65 ruled (b), Chris 2026-09-15): seats and a schedule exist for N, F28's floor lives in 118 pre-draft, and post-draft there is NO route — no verb raises this number in-season (R1039: the first cut's `refused_why` pointed at `add_placeholder_seat`, which stops at the stored ceiling, `063:445-446`) |
-- | schedule_mode · median_game · second_opponent | blob | REFUSED | schedule SHAPE: primary/secondary/median rows are generated by the engine (110/111); flipping the mode under them leaves rows nothing reads or removes |
-- | format · lineup_lock · divisions · playoff_byes | column/blob | REFUSED | each PINNED to one value (§7.3.1 redraft-only; 114's CHECK; Q30 (d); 'auto') — a change is a CHECK violation or a no-op with a receipt |
-- | schedule_seed              | blob    | REFUSED | minted by the engine, never set by hand (F246: a remix re-mints it) |
-- | draft (the whole §7.3.8 block) | blob | REFUSED | pre-draft it is the wizard's / `update_league_settings`'s; post-draft the draft has happened and the block has no subject |
-- | any other key              | —       | UNKNOWN | refused BY NAME — this verb writes no key the catalog (`league-settings.ts` `leagueSettingsSchema`) does not define, and `player_game_lock` in particular is CHECK-refused on the table (115) |
--
-- Value gates: each key's TYPE and RANGE mirror `leagueSettingsSchema`
-- (`src/lib/leagues/settings/league-settings.ts`) — the SQL is the
-- server-authoritative copy; L.E1.11's route adds the Zod mirror in front of
-- it. Integers accept a JSON number OR a numeric string (`2` ≡ `"2"`),
-- booleans a JSON boolean OR `"true"`/`"false"`; the canonical form is the
-- typed one, and `leagues.settings` stores it typed — `mergeSettings` parses
-- the blob with the same schema and would refuse a string where it expects a
-- number.
--
-- ---------------------------------------------------------------------------
-- D137 PROVENANCE: **THIS MIGRATION REPLACES NOTHING. ZERO HUNKS.**
-- `update_league_settings` (118) is BYTE-UNTOUCHED — its status gate, its
-- FAAB re-seed and its re-freeze all stand for the pre-draft document path,
-- and pgTAP 077 §K pins the gate string and the re-seed statement still in
-- its `prosrc` with exactly one overload (§4 rule 13's `071:835-867` shape).
-- Every object below is NEW (`grep -rn` over `supabase/migrations/` returns
-- each name only here). 059, 104, 110, 111, 117, 118, 119 and 123 are all
-- byte-untouched; the walls this verb relies on (104's two triggers, 110's
-- week-status guard) are RIDDEN, never edited.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4): additive only (one new table, seven
-- new functions); no column dropped, no policy dropped, no function replaced;
-- RLS enabled with ZERO policies on the new table plus the per-role
-- `REVOKE TRUNCATE` (D350 — RLS does not cover TRUNCATE; asserted per role
-- with `has_table_privilege` in pgTAP 077 §A, not through `pg_policies`).
-- **NO `HELD-FROM-PRODUCTION.txt` ENTRY IS ADDED — the hold was cleared
-- 2026-09-09 (PR #282); the file remains in the tree as the record of the
-- hold and gains no entry (R1042).** 125-128 are merged and NOT yet pushed (hosted tops out at
-- 124); 129 is authored against the repo's chain and never against a deployed
-- body (CLAUDE.md migration discipline). `npx supabase db push` for 125-129
-- is Chris's after merge.
--
-- WAIVERS: none. R6 and D38 are not engaged — no constraint is added to an
-- existing table and nothing is backfilled.
--
-- D336's SEVEN PARTS, AND WHERE EACH ONE IS
--   (1) the ledger      → §1, `commish_setting_actions`
--   (2) ONE audit row   → §4 step (12), through `log_commissioner_action_internal`
--                         (`123:417-453`), INSIDE the no-op guard and AFTER
--                         the state write, `IF v_audit_id IS NULL RAISE`
--   (3) the no-op       → §4 step (9): `v_canon = v_before`, jsonb equality
--                         over the canonical form (item 4); ledger row written
--                         anyway
--   (4) the chat post   → §4 step (13), in-txn and non-disableable (§10.3)
--   (5) the posture     → PLAIN `search_path=''` internal taking `p_at`,
--                         triple-REVOKEd, under a SECURITY DEFINER wrapper
--                         passing `now()` (D307(3)); in-body auth as ONE
--                         no-leak 42501
--   (6) the reason gate → §4 step (4), the explicit `E' \t\r\n'` class,
--                         matching the table CHECK (`123:295-296`)
--   (7) the result      → names the bypassed gate and WHY, and every
--                         downstream that did or did not follow — the
--                         snapshot, the balances, the queue, the lineups —
--                         with `commissioner_action_id` NULL on a no-op
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. commish_setting_actions — this verb's OWN replay ledger (D350). Never
--    shared with the other commish_* ledgers and never folded into
--    commissioner_actions (`123:333-335`'s pre-planted-row attack).
-- ---------------------------------------------------------------------------
CREATE TABLE commish_setting_actions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  setting_key TEXT NOT NULL,                     -- the ONE key this submit named
  action_id   UUID NOT NULL,                     -- client-minted; dedupes retries (E2/D68)
  actor_id    UUID NOT NULL REFERENCES profiles(id),
  result      JSONB NOT NULL,                    -- the verb's returned jsonb, replayed byte-identically
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, action_id)                  -- the race backstop behind the select-then-insert
);
CREATE INDEX idx_commish_setting_actions_league_key ON commish_setting_actions(league_id, setting_key);

COMMENT ON TABLE commish_setting_actions IS
  'Idempotency ledger for commish_change_setting (migration 129, D350). ZERO policies: the DEFINER verb is the only reader and writer. NOT the audit log — §12.26: "an action_id is an idempotency key, not an audit record" — so a row is written for a NO-OP too, while commissioner_actions is not.';

ALTER TABLE commish_setting_actions ENABLE ROW LEVEL SECURITY;
-- ZERO policies. RLS does NOT cover TRUNCATE and the Supabase default grants
-- it to anon/authenticated (`123:485-491`, measured) — taken away here (§4
-- rule 12; F349's app-wide sweep is deferred by Chris's 2026-09-13 ruling and
-- deliberately NOT widened by this table). Asserted PER ROLE in pgTAP 077 §A.
REVOKE TRUNCATE ON TABLE commish_setting_actions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. commish_setting_policy — THE PER-KEY TABLE AS DATA. Pure and IMMUTABLE:
--    {storage: 'column'|'blob', class: 'free'|'rescore'|'bracket'|'refused',
--     refused_why: text|null}. NULL for a key the catalog does not define.
--    `authenticated` may read it (L.E1.13 renders refusal copy from it);
--    it writes nothing and reads no table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_setting_policy(p_key TEXT)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    -- FREE, typed columns
    WHEN p_key IN ('waiver_type')          THEN jsonb_build_object('storage', 'column', 'class', 'free', 'refused_why', NULL)
    WHEN p_key IN ('faab_budget')          THEN jsonb_build_object('storage', 'column', 'class', 'free', 'refused_why', NULL)
    WHEN p_key IN ('trade_review')         THEN jsonb_build_object('storage', 'column', 'class', 'free', 'refused_why', NULL)
    WHEN p_key IN ('trade_deadline_week')  THEN jsonb_build_object('storage', 'column', 'class', 'free', 'refused_why', NULL)
    WHEN p_key IN ('roster_settings')      THEN jsonb_build_object('storage', 'column', 'class', 'free', 'refused_why', NULL)
    -- FREE, blob
    WHEN p_key IN ('faab_min_bid', 'faab_tiebreaker', 'waiver_process_day', 'waiver_process_time',
         'waiver_period_hours', 'free_agency', 'acquisitions_per_week', 'acquisitions_per_season',
         'bench_lock', 'fa_hold_hours',
         'trade_veto_votes', 'trade_review_period_hours', 'allow_faab_in_trades',
         'allow_future_considerations', 'trade_lock_behavior',
         'allow_illegal_lineups', 'auto_sub_inactives', 'stat_correction_window',
         'tiebreakers', 'playoff_reseed')
                                THEN jsonb_build_object('storage', 'blob', 'class', 'free', 'refused_why', NULL)
    -- RESCORE
    WHEN p_key IN ('scoring_system_id')    THEN jsonb_build_object('storage', 'column', 'class', 'rescore', 'refused_why', NULL)
    -- BRACKET (refused once the bracket exists — the verb decides by status)
    WHEN p_key IN ('playoff_teams')        THEN jsonb_build_object('storage', 'column', 'class', 'bracket', 'refused_why',
                                  'once the league is in playoffs (or complete) the bracket has been SEEDED from this key (118:1075-1077, :1338-1340); no verb re-seeds a bracket under played rounds')
    WHEN p_key IN ('playoff_weeks_per_round', 'consolation_bracket', 'third_place_game')
                                THEN jsonb_build_object('storage', 'blob', 'class', 'bracket', 'refused_why',
                                  'once the league is in playoffs (or complete) the bracket has been SEEDED from this key (118:1075-1077, :1338-1340); no verb re-seeds a bracket under played rounds')
    -- REFUSED, always through this verb
    WHEN p_key IN ('regular_season_weeks', 'playoff_start_week')
                                THEN jsonb_build_object('storage', 'column', 'class', 'refused', 'refused_why',
                                  'this key defines the SEASON WINDOW: league_weeks and matchups were generated for the stored plan (111:346, :422) and the standings cutoff reads it (D288), so moving it under rows that already exist re-plans nothing and re-cuts the standings; it is also coupled to its partner by Q10 (playoff_start_week = regular_season_weeks + 1), which one key at a time cannot keep. Pre-draft the route is update_league_settings, which validates the pair; post-draft no verb re-plans a season')
    WHEN p_key IN ('team_count')           THEN jsonb_build_object('storage', 'column', 'class', 'refused', 'refused_why',
                                  'team_count is PRE-DRAFT ONLY (§7.3, erratum v2.16.40 — Q65 ruled (b) by Chris 2026-09-15): seats (teams / league_members) and a schedule already exist for the stored count; pre-draft the route is update_league_settings (F28''s seat floor lives there, 118:2499-2510); post-draft there is NO route — no verb raises this number in-season, and a placeholder seat cannot be added past the stored ceiling')
    WHEN p_key IN ('schedule_mode', 'median_game', 'second_opponent')
                                THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'this key defines the SCHEDULE SHAPE: primary, secondary and median rows are generated by the schedule engine (110/111) from it, and flipping it under rows that already exist leaves rows nothing reads or removes. Pre-draft the route is update_league_settings; post-draft no verb re-plans a schedule')
    WHEN p_key IN ('format')               THEN jsonb_build_object('storage', 'column', 'class', 'refused', 'refused_why',
                                  'pinned to redraft in v1 (§7.3.1) — there is no other value to change it to')
    WHEN p_key IN ('lineup_lock')          THEN jsonb_build_object('storage', 'column', 'class', 'refused', 'refused_why',
                                  'pinned to per_player_kickoff by 114''s CHECK (Q34(A)) — any other value is a constraint violation')
    WHEN p_key IN ('divisions')            THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'pinned to 1 (Q30 (d), v2.16.12) — the engine ignores the value')
    WHEN p_key IN ('playoff_byes')         THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'derived from the bracket size (§7.3.1: the literal ''auto'') — not independently settable')
    WHEN p_key IN ('schedule_seed')        THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'minted by the schedule engine and re-minted by a remix (F246) — never set by hand')
    WHEN p_key IN ('draft')                THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'the §7.3.8 draft block: pre-draft it belongs to the wizard / update_league_settings; post-draft the draft has happened and the block has no subject')
    ELSE NULL
  END;
$$;
REVOKE EXECUTE ON FUNCTION commish_setting_policy(TEXT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 3. THE VALUE GATES. Each returns the CANONICAL jsonb for a key or raises
--    22023 BY NAME. `2` and `"2"` canonicalise to the same jsonb (item 4).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_setting_int_internal(
  p_key TEXT, p_value JSONB, p_lo INTEGER, p_hi INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_txt TEXT;
  v_int INTEGER;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    RAISE EXCEPTION 'commish_change_setting: % requires an integer between % and % — got null', p_key, p_lo, p_hi
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_value) NOT IN ('number', 'string') THEN
    RAISE EXCEPTION 'commish_change_setting: % requires an integer between % and % — got a JSON %', p_key, p_lo, p_hi, jsonb_typeof(p_value)
      USING ERRCODE = '22023';
  END IF;
  v_txt := btrim(p_value #>> '{}');
  IF v_txt !~ '^-?[0-9]+$' THEN
    RAISE EXCEPTION 'commish_change_setting: % requires an integer between % and % — got %', p_key, p_lo, p_hi, v_txt
      USING ERRCODE = '22023';
  END IF;
  v_int := v_txt::integer;
  IF v_int < p_lo OR v_int > p_hi THEN
    RAISE EXCEPTION 'commish_change_setting: % must be between % and % (§7.3) — got %', p_key, p_lo, p_hi, v_int
      USING ERRCODE = '22023';
  END IF;
  RETURN to_jsonb(v_int);
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_setting_int_internal(TEXT, JSONB, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION commish_setting_bool_internal(p_key TEXT, p_value JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_value IS NOT NULL AND jsonb_typeof(p_value) = 'boolean' THEN
    RETURN p_value;
  END IF;
  IF p_value IS NOT NULL AND jsonb_typeof(p_value) = 'string'
     AND lower(btrim(p_value #>> '{}')) IN ('true', 'false') THEN
    RETURN to_jsonb((lower(btrim(p_value #>> '{}')) = 'true'));
  END IF;
  RAISE EXCEPTION 'commish_change_setting: % requires true or false — got %', p_key, COALESCE(p_value::text, 'null')
    USING ERRCODE = '22023';
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_setting_bool_internal(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION commish_setting_enum_internal(p_key TEXT, p_value JSONB, p_allowed TEXT[])
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_txt TEXT;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'string' THEN
    RAISE EXCEPTION 'commish_change_setting: % must be one of % — got %', p_key, array_to_string(p_allowed, ', '), COALESCE(p_value::text, 'null')
      USING ERRCODE = '22023';
  END IF;
  v_txt := btrim(p_value #>> '{}');
  IF NOT (v_txt = ANY (p_allowed)) THEN
    RAISE EXCEPTION 'commish_change_setting: % must be one of % — got %', p_key, array_to_string(p_allowed, ', '), v_txt
      USING ERRCODE = '22023';
  END IF;
  RETURN to_jsonb(v_txt);
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_setting_enum_internal(TEXT, JSONB, TEXT[])
  FROM PUBLIC, anon, authenticated;

-- The per-key canonicaliser: type + range per `leagueSettingsSchema`. Takes
-- the LOCKED league row so cross-field bounds (team_count, regular_season_
-- weeks, schedule_mode) are read from the row this call will write.
CREATE OR REPLACE FUNCTION commish_setting_canon_internal(
  p_key TEXT, p_value JSONB, p_league public.leagues
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_txt   TEXT;
  v_arr   TEXT[];
  v_n     INTEGER;
  v_pt    INTEGER;
  v_slot  JSONB;
BEGIN
  CASE p_key
    -- ── FREE columns ──────────────────────────────────────────────────────
    WHEN 'waiver_type' THEN
      RETURN public.commish_setting_enum_internal(p_key, p_value,
        ARRAY['faab', 'rolling_priority', 'reverse_standings', 'none_fcfs']);
    WHEN 'faab_budget' THEN
      RETURN public.commish_setting_int_internal(p_key, p_value, 0, 1000);
    WHEN 'trade_review' THEN
      RETURN public.commish_setting_enum_internal(p_key, p_value,
        ARRAY['none', 'commissioner', 'league_vote']);
    WHEN 'trade_deadline_week' THEN
      -- nullable: null / "none" = no deadline; else 1..regular_season_weeks
      IF p_value IS NULL OR jsonb_typeof(p_value) = 'null'
         OR (jsonb_typeof(p_value) = 'string' AND lower(btrim(p_value #>> '{}')) = 'none') THEN
        RETURN 'null'::jsonb;
      END IF;
      RETURN public.commish_setting_int_internal(p_key, p_value, 1, p_league.regular_season_weeks);
    WHEN 'roster_settings' THEN
      -- The §7.3.2 canonical object: starting_slots[] (key/label/eligible/count),
      -- bench 0..20, ir_slots[] ≤ 6, swap_spots 0|1. The Zod schema is the
      -- full authority (L.E1.11's route); this is the server floor.
      IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
        RAISE EXCEPTION 'commish_change_setting: roster_settings must be the §7.3.2 object {starting_slots, bench, ir_slots, swap_spots} — got %', COALESCE(jsonb_typeof(p_value), 'null')
          USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(p_value -> 'starting_slots') <> 'array'
         OR jsonb_typeof(p_value -> 'ir_slots') <> 'array'
         OR jsonb_typeof(p_value -> 'bench') <> 'number'
         OR jsonb_typeof(p_value -> 'swap_spots') <> 'number' THEN
        RAISE EXCEPTION 'commish_change_setting: roster_settings must carry starting_slots (array), ir_slots (array), bench (integer) and swap_spots (0 or 1) (§7.3.2)'
          USING ERRCODE = '22023';
      END IF;
      IF (p_value ->> 'bench')::numeric NOT BETWEEN 0 AND 20 OR (p_value ->> 'bench')::numeric <> floor((p_value ->> 'bench')::numeric) THEN
        RAISE EXCEPTION 'commish_change_setting: roster_settings.bench must be an integer 0..20 (§7.3.2) — got %', p_value ->> 'bench'
          USING ERRCODE = '22023';
      END IF;
      IF (p_value ->> 'swap_spots')::numeric NOT IN (0, 1) THEN
        RAISE EXCEPTION 'commish_change_setting: roster_settings.swap_spots must be 0 or 1 (§7.3.2) — got %', p_value ->> 'swap_spots'
          USING ERRCODE = '22023';
      END IF;
      IF jsonb_array_length(p_value -> 'ir_slots') > 6 THEN
        RAISE EXCEPTION 'commish_change_setting: roster_settings.ir_slots may hold at most 6 spots (§7.3.2) — got %', jsonb_array_length(p_value -> 'ir_slots')
          USING ERRCODE = '22023';
      END IF;
      FOR v_slot IN SELECT * FROM jsonb_array_elements(p_value -> 'starting_slots') LOOP
        IF jsonb_typeof(v_slot) <> 'object'
           OR NULLIF(btrim(COALESCE(v_slot ->> 'key', ''), E' \t\r\n'), '') IS NULL
           OR jsonb_typeof(v_slot -> 'eligible') <> 'array' OR jsonb_array_length(v_slot -> 'eligible') < 1
           OR jsonb_typeof(v_slot -> 'count') <> 'number'
           OR (v_slot ->> 'count')::numeric NOT BETWEEN 0 AND 10 THEN
          RAISE EXCEPTION 'commish_change_setting: every roster_settings.starting_slots entry needs a key, a non-empty eligible[] and an integer count 0..10 (§7.3.2) — offending entry: %', v_slot::text
            USING ERRCODE = '22023';
        END IF;
      END LOOP;
      -- R1040: the STORED value is REBUILT from the known keys, never
      -- `p_value` verbatim — an unknown top-level key or an unknown key
      -- inside a slot is dropped here, not left for L.E1.11's Zod mirror to
      -- be the only thing that strips it. Each slot is rebuilt from
      -- key/label/eligible/count (`label` carried through when present —
      -- the §7.3.2 shape has it; whether it is REQUIRED is the Zod
      -- schema's call, L.E1.11). `ir_slots` entries pass through unchanged:
      -- this floor validates only their count (≤ 6), and their element
      -- shape (§7.3.2's key/type/eligible_designations) is L.E1.11's too.
      RETURN jsonb_build_object(
        'starting_slots', COALESCE((
          SELECT jsonb_agg(
                   jsonb_strip_nulls(jsonb_build_object(
                     'key',      s.slot -> 'key',
                     'label',    s.slot -> 'label',
                     'eligible', s.slot -> 'eligible',
                     'count',    s.slot -> 'count'))
                   ORDER BY s.ord)
            FROM jsonb_array_elements(p_value -> 'starting_slots') WITH ORDINALITY AS s(slot, ord)),
          '[]'::jsonb),
        'bench',      p_value -> 'bench',
        'ir_slots',   p_value -> 'ir_slots',
        'swap_spots', p_value -> 'swap_spots');
    -- ── RESCORE ───────────────────────────────────────────────────────────
    WHEN 'scoring_system_id' THEN
      IF p_value IS NULL OR jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'commish_change_setting: scoring_system_id must be a scoring_systems id (uuid string) — got %', COALESCE(p_value::text, 'null')
          USING ERRCODE = '22023';
      END IF;
      v_txt := btrim(p_value #>> '{}');
      IF v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'commish_change_setting: scoring_system_id must be a uuid — got %', v_txt
          USING ERRCODE = '22023';
      END IF;
      RETURN to_jsonb(lower(v_txt));
    -- ── BRACKET ───────────────────────────────────────────────────────────
    WHEN 'playoff_teams' THEN
      v_pt := (public.commish_setting_int_internal(p_key, p_value, 0, 12) #>> '{}')::int;
      IF v_pt NOT IN (0, 2, 4, 6, 8, 10, 12) THEN
        RAISE EXCEPTION 'commish_change_setting: playoff_teams must be one of 0, 2, 4, 6, 8, 10, 12 (§7.3.1) — got %', v_pt
          USING ERRCODE = '22023';
      END IF;
      IF v_pt > p_league.team_count THEN
        RAISE EXCEPTION 'commish_change_setting: playoff_teams % exceeds team_count % (§7.3.1)', v_pt, p_league.team_count
          USING ERRCODE = '22023';
      END IF;
      -- Q39 (C), 118:2531-2534's backstop, mirrored: a total-points league
      -- has no bracket.
      IF v_pt > 0 AND COALESCE(p_league.settings ->> 'schedule_mode', 'h2h') = 'total_points' THEN
        RAISE EXCEPTION 'commish_change_setting: playoff_teams must be 0 for a total-points league — the season-long points race is its playoff and there is no bracket (§11.7, Q39 (C))'
          USING ERRCODE = '22023';
      END IF;
      RETURN to_jsonb(v_pt);
    WHEN 'playoff_weeks_per_round' THEN
      RETURN public.commish_setting_int_internal(p_key, p_value, 1, 2);
    WHEN 'consolation_bracket', 'third_place_game', 'playoff_reseed',
         'bench_lock', 'allow_faab_in_trades', 'allow_future_considerations',
         'allow_illegal_lineups', 'auto_sub_inactives' THEN
      RETURN public.commish_setting_bool_internal(p_key, p_value);
    -- ── FREE blob ─────────────────────────────────────────────────────────
    WHEN 'faab_min_bid' THEN
      RETURN public.commish_setting_int_internal(p_key, p_value, 0, 10);
    WHEN 'faab_tiebreaker' THEN
      RETURN public.commish_setting_enum_internal(p_key, p_value, ARRAY['reverse_standings', 'rolling_priority']);
    WHEN 'waiver_process_day' THEN
      RETURN public.commish_setting_enum_internal(p_key, p_value, ARRAY['tue', 'wed', 'thu']);
    WHEN 'waiver_process_time' THEN
      IF p_value IS NULL OR jsonb_typeof(p_value) <> 'string'
         OR btrim(p_value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        RAISE EXCEPTION 'commish_change_setting: waiver_process_time must be HH:MM (24h, ET; D60) — got %', COALESCE(p_value::text, 'null')
          USING ERRCODE = '22023';
      END IF;
      RETURN to_jsonb(btrim(p_value #>> '{}'));
    WHEN 'waiver_period_hours' THEN
      RETURN public.commish_setting_int_internal(p_key, p_value, 0, 168);
    WHEN 'free_agency' THEN
      RETURN public.commish_setting_enum_internal(p_key, p_value, ARRAY['immediate_after_waivers', 'continuous']);
    WHEN 'acquisitions_per_week' THEN
      IF p_value IS NOT NULL AND jsonb_typeof(p_value) = 'string' AND lower(btrim(p_value #>> '{}')) = 'unlimited' THEN
        RETURN to_jsonb('unlimited'::text);
      END IF;
      RETURN public.commish_setting_int_internal(p_key, p_value, 0, 50);
    WHEN 'acquisitions_per_season' THEN
      IF p_value IS NOT NULL AND jsonb_typeof(p_value) = 'string' AND lower(btrim(p_value #>> '{}')) = 'unlimited' THEN
        RETURN to_jsonb('unlimited'::text);
      END IF;
      RETURN public.commish_setting_int_internal(p_key, p_value, 0, 500);
    WHEN 'fa_hold_hours' THEN
      RETURN public.commish_setting_int_internal(p_key, p_value, 0, 48);
    WHEN 'trade_veto_votes' THEN
      RETURN public.commish_setting_int_internal(p_key, p_value, 1, p_league.team_count);
    WHEN 'trade_review_period_hours' THEN
      RETURN public.commish_setting_int_internal(p_key, p_value, 0, 96);
    WHEN 'trade_lock_behavior' THEN
      RETURN public.commish_setting_enum_internal(p_key, p_value, ARRAY['defer', 'reject']);
    WHEN 'stat_correction_window' THEN
      IF p_value IS NOT NULL AND jsonb_typeof(p_value) = 'string' AND btrim(p_value #>> '{}') = 'thu_06_00_et' THEN
        RETURN to_jsonb('thu_06_00_et'::text);
      END IF;
      RETURN public.commish_setting_int_internal(p_key, p_value, 0, 168);
    WHEN 'tiebreakers' THEN
      IF p_value IS NULL OR jsonb_typeof(p_value) <> 'array' THEN
        RAISE EXCEPTION 'commish_change_setting: tiebreakers must be an ordered array of win_pct, points_for, head_to_head, points_against, division_record, coin_flip (§7.3.7) — got %', COALESCE(jsonb_typeof(p_value), 'null')
          USING ERRCODE = '22023';
      END IF;
      v_arr := ARRAY(SELECT jsonb_array_elements_text(p_value));
      IF EXISTS (SELECT 1 FROM unnest(v_arr) x
                 WHERE x NOT IN ('win_pct', 'points_for', 'head_to_head', 'points_against', 'division_record', 'coin_flip')) THEN
        RAISE EXCEPTION 'commish_change_setting: tiebreakers carries an unknown entry — allowed: win_pct, points_for, head_to_head, points_against, division_record, coin_flip (§7.3.7); got %', p_value::text
          USING ERRCODE = '22023';
      END IF;
      SELECT count(*) - count(DISTINCT x) INTO v_n FROM unnest(v_arr) x;
      IF v_n > 0 THEN
        RAISE EXCEPTION 'commish_change_setting: tiebreakers carries a duplicated entry (§7.3.7; league_standings refuses a duplicate) — got %', p_value::text
          USING ERRCODE = '22023';
      END IF;
      RETURN p_value;
    ELSE
      RAISE EXCEPTION 'commish_change_setting: no value gate for key % (this is a migration-129 defect: every key the policy table admits must have one)', p_key
        USING ERRCODE = 'P0001';
  END CASE;
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_setting_canon_internal(TEXT, JSONB, public.leagues)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. commish_change_setting_internal — the audited verb (123's template).
--    PLAIN, search_path='', takes the instant as an argument (the TimeProvider
--    seam pgTAP drives).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_change_setting_internal(
  p_league_id UUID,
  p_key       TEXT,
  p_value     JSONB,
  p_rescore   BOOLEAN,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league        public.leagues;
  v_found         BOOLEAN;
  v_reason        TEXT;
  v_key           TEXT;
  v_policy        JSONB;
  v_class         TEXT;
  v_storage       TEXT;
  v_rescore       BOOLEAN := COALESCE(p_rescore, FALSE);
  v_in_season     BOOLEAN;
  v_before        JSONB;
  v_canon         JSONB;
  v_no_changes    BOOLEAN;
  v_bypassed      JSONB;
  v_bypassed_why  TEXT;
  v_audit_id      UUID;
  v_message       TEXT;
  v_result        JSONB;
  v_cnt           INTEGER;
  -- scoring
  v_new_scoring   UUID;
  v_new_rules     JSONB;
  v_snapshot_refrozen BOOLEAN := FALSE;
  v_snapshot_why  TEXT;
  v_final_weeks   JSONB := '[]'::jsonb;
  v_open_weeks    JSONB := '[]'::jsonb;
  v_rescored      JSONB := '[]'::jsonb;
  v_rescore_done  BOOLEAN := FALSE;
  v_rescore_why   TEXT;
  v_score_stale   BOOLEAN := FALSE;
  v_stale_why     TEXT;
  v_wk            RECORD;
  v_enq           INTEGER;
  v_not_enq       JSONB;
  v_ir_keys       TEXT[];
  -- faab
  v_faab_reseeded BOOLEAN := FALSE;
  v_faab_why      TEXT;
  v_faab_off      INTEGER := 0;
  -- roster
  v_not_refit     INTEGER := 0;
  v_consequences  JSONB;
BEGIN
  -- (0) SHAPE. A malformed call is refused BY NAME and never answered with
  --     `no_changes: true` (126's rule; §4 rule 15).
  IF NULLIF(btrim(COALESCE(p_key, ''), E' \t\r\n'), '') IS NULL THEN
    RAISE EXCEPTION 'commish_change_setting: p_key is required — an override that names no setting is not an override'
      USING ERRCODE = '22023';
  END IF;
  v_key := btrim(p_key, E' \t\r\n');
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'commish_change_setting: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8). Every gate
  --     below reads THIS row, never a pre-lock read (R1036's lesson).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — commissioner only, in-body, ONE no-leak 42501 covering "no
  --     such league" and "not a commissioner" alike (D336 part 5).
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_change_setting: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2), AFTER auth and BEFORE every business gate
  --     (`123:602-609`), so a retry replays byte-identically even when the
  --     league has since moved on.
  SELECT a.result INTO v_result
  FROM public.commish_setting_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  -- (4) THE REASON, required unconditionally (§15.4:1690 "all require
  --     reason"); the explicit whitespace class (R745); the 500 bound
  --     (`123:295-296`). A client-supplied LABEL, never a prompt (F343).
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'commish_change_setting: a reason is required — this verb writes an audited commissioner_actions row the whole league can read (§15.4, §10.3)'
      USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'commish_change_setting: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) THE KEY, against the policy table. An unknown key is refused BY NAME:
  --     this verb writes no key the catalog does not define.
  v_policy := public.commish_setting_policy(v_key);
  IF v_policy IS NULL THEN
    RAISE EXCEPTION 'commish_change_setting: % is not a league setting this verb knows — the catalog is leagueSettingsSchema (§7.3); no undefined key is ever written into leagues.settings', v_key
      USING ERRCODE = '22023';
  END IF;
  v_class   := v_policy ->> 'class';
  v_storage := v_policy ->> 'storage';
  v_in_season := v_league.status NOT IN ('setup', 'scheduled');

  -- (6) THE PER-KEY POLICY — refused-by-name classes (the banner's table).
  IF v_class = 'refused' THEN
    RAISE EXCEPTION 'commish_change_setting: % cannot be changed through this verb (league % is %). WHY: %',
      v_key, p_league_id, v_league.status, v_policy ->> 'refused_why'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_class = 'bracket' AND v_league.status IN ('playoffs', 'complete') THEN
    RAISE EXCEPTION 'commish_change_setting: % is REFUSED in-season once the bracket exists (league % is %). WHY: %',
      v_key, p_league_id, v_league.status, v_policy ->> 'refused_why'
      USING ERRCODE = 'P0001';
  END IF;

  -- (7) `rescore` has exactly one subject. On any other key the flag is a
  --     malformed call, refused by name — never accepted and ignored.
  IF v_rescore AND v_key <> 'scoring_system_id' THEN
    RAISE EXCEPTION 'commish_change_setting: rescore applies only to scoring_system_id — % has no stored score to recompute; resubmit without rescore',
      v_key
      USING ERRCODE = '22023';
  END IF;

  -- (8) THE VALUE, canonicalised (item 4) and range-checked against the
  --     LOCKED row; the CURRENT value read from the same row in the same
  --     canonical form.
  v_canon := public.commish_setting_canon_internal(v_key, p_value, v_league);
  IF v_storage = 'column' THEN
    v_before := to_jsonb(v_league) -> v_key;          -- typed column; uuid renders as a string
  ELSE
    v_before := COALESCE(v_league.settings -> v_key, 'null'::jsonb);  -- absent blob key = null
  END IF;

  -- (8b) scoring_system_id: 118 step 5's attachable scope, in meaning — a
  --      TEMPLATE, or the league's own currently-referenced row (the no-op).
  --      104's wall 3 (`trg_leagues_scoring_reference_guard`) additionally
  --      validates the referenced rules at the UPDATE; it is ridden, not
  --      duplicated.
  IF v_key = 'scoring_system_id' THEN
    v_new_scoring := (v_canon #>> '{}')::uuid;
    IF v_new_scoring IS DISTINCT FROM v_league.scoring_system_id THEN
      SELECT s.rules INTO v_new_rules
      FROM public.scoring_systems s
      WHERE s.id = v_new_scoring AND s.is_template = TRUE AND s.owner_id IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'commish_change_setting: scoring_system_id % must reference one of the scoring templates, or the league''s own current custom scoring system — personal scoring systems and other leagues'' systems cannot be attached (§7.3.8 v2.11, §7.3.3.1; 118 step 5''s scope)',
          v_new_scoring
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  -- (9) THE NO-OP, DETECTED BY VALUE — jsonb equality over the canonical
  --     form of the ONE dimension this verb changes (D336 part 3; `123:1016`).
  --     `2` and `"2"` both canonicalise to `2`, so a re-send in a different
  --     JSON type is a no-op too.
  v_no_changes := (v_canon = v_before);

  -- (10) THE LIFTED GATE, NAMED. Past `scheduled`, 118 step 3 would have
  --      refused this write (`118:2489-2497`); that is the rule this verb
  --      walks past, and the receipt says so (standing rule (g)'s shape).
  IF v_in_season THEN
    v_bypassed     := jsonb_build_array('settings_status_gate');
    v_bypassed_why := 'update_league_settings refuses every status past scheduled (118:2489-2497, "settings are locked once the draft starts; post-draft changes are audited commissioner overrides (M6) (§7.3)"); this verb IS that override (§7.3 header: "commissioner-override-only … allowed but logged and warned")';
  ELSE
    v_bypassed     := '[]'::jsonb;
    v_bypassed_why := 'nothing to bypass — in setup/scheduled the document path (update_league_settings) admits this key too; this verb was used for its per-key receipt';
  END IF;

  -- (11) THE SCORING CONSEQUENCES are computed BEFORE the write so the
  --      refusal at (11b) rolls back nothing and the report at (11c)/(11d)
  --      describes the weeks as they were.
  IF v_key = 'scoring_system_id' AND NOT v_no_changes THEN
    SELECT COALESCE(jsonb_agg(lw.week ORDER BY lw.week), '[]'::jsonb) INTO v_final_weeks
    FROM public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.status = 'final';
    SELECT COALESCE(jsonb_agg(jsonb_build_object('week', lw.week, 'status', lw.status) ORDER BY lw.week), '[]'::jsonb) INTO v_open_weeks
    FROM public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.status IN ('live', 'correction_window');

    -- (11b) ── Q64 SEAM ── `rescore` cannot reach a FINAL week today:
    --       `score_write_week_batch` refuses `week_final` (119:566-568), the
    --       total-points arm guards `is_final = FALSE` (119:600-602), and
    --       `reopen_week` — the audited un-freeze §12.12 names and 110's
    --       transition guard (110:285-296) already expects — has no writer
    --       (`league_weeks.reopened_by_action_id`: FK since 123:463-464, zero
    --       writers). So the week is REFUSED BY NAME and the whole call rolls
    --       back. A future `reopen_week` task replaces THIS block with a
    --       per-week `PERFORM public.reopen_week_internal(p_league_id, week,
    --       p_at, v_reason)` and lets (11c) below enqueue the reopened weeks
    --       with the open ones. See the banner.
    IF v_rescore AND v_final_weeks <> '[]'::jsonb THEN
      RAISE EXCEPTION 'commish_change_setting: rescore = true cannot reach FINAL week(s) % of league % — a final week''s stored scores are immutable without an audited reopen_week, and NO VERB REOPENS A WEEK TODAY (Q64; league_weeks.reopened_by_action_id has zero writers). Nothing was changed. Either resubmit with rescore = false (scoring changes going FORWARD; every stored score stays as it is), or wait for reopen_week to be built',
        v_final_weeks::text, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NOT v_no_changes THEN
    -- (12a) THE STATE WRITE — ONE key, read-modify-write (D347). Typed
    --       columns each by name; blob keys through `settings || {key: v}`
    --       so every OTHER key is byte-untouched. `updated_at = p_at`.
    CASE v_key
      WHEN 'waiver_type' THEN
        UPDATE public.leagues SET waiver_type = v_canon #>> '{}', updated_at = p_at WHERE id = p_league_id;
      WHEN 'faab_budget' THEN
        UPDATE public.leagues SET faab_budget = (v_canon #>> '{}')::int, updated_at = p_at WHERE id = p_league_id;
      WHEN 'trade_review' THEN
        UPDATE public.leagues SET trade_review = v_canon #>> '{}', updated_at = p_at WHERE id = p_league_id;
      WHEN 'trade_deadline_week' THEN
        UPDATE public.leagues SET trade_deadline_week = (v_canon #>> '{}')::int, updated_at = p_at WHERE id = p_league_id;
      WHEN 'roster_settings' THEN
        UPDATE public.leagues SET roster_settings = v_canon, updated_at = p_at WHERE id = p_league_id;
      WHEN 'playoff_teams' THEN
        UPDATE public.leagues SET playoff_teams = (v_canon #>> '{}')::int, updated_at = p_at WHERE id = p_league_id;
      WHEN 'scoring_system_id' THEN
        -- RE-DECISION 2: the reference and the re-frozen snapshot move in ONE
        -- statement (§7.3.3 — "on any commissioner scoring change"); a NULL
        -- snapshot stays NULL, exactly as 118:2586-2590 leaves it (draft_start
        -- is the freezer pre-draft). 104's two walls fire on this UPDATE.
        UPDATE public.leagues
        SET scoring_system_id      = v_new_scoring,
            scoring_rules_snapshot = CASE WHEN scoring_rules_snapshot IS NOT NULL THEN v_new_rules ELSE scoring_rules_snapshot END,
            updated_at             = p_at
        WHERE id = p_league_id;
        v_snapshot_refrozen := (v_league.scoring_rules_snapshot IS NOT NULL);
        v_snapshot_why := CASE WHEN v_snapshot_refrozen
          THEN 'scoring_rules_snapshot re-frozen from the new system''s rules in the same statement as the reference (§7.3.3, never-weaken; 118:2585-2590''s rule kept)'
          ELSE 'scoring_rules_snapshot is NULL (pre-draft) and stays NULL — draft_start freezes it (059/110), exactly as 118:2586 leaves it' END;
      ELSE
        UPDATE public.leagues
        SET settings   = settings || jsonb_build_object(v_key, v_canon),
            updated_at = p_at
        WHERE id = p_league_id;
    END CASE;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'commish_change_setting: the write touched % rows, expected exactly 1 (league %)', v_cnt, p_league_id
        USING ERRCODE = 'P0001';
    END IF;

    -- (12b) RE-DECISION 1 — THE FAAB RE-SEED, narrowed to the precondition
    --       118's own comment names: pre-draft ONLY. In-season every balance
    --       is byte-unchanged and the document says so with a MEASURED count.
    IF v_key = 'faab_budget' THEN
      IF NOT v_in_season THEN
        UPDATE public.league_members
        SET faab_balance = (v_canon #>> '{}')::int
        WHERE league_id = p_league_id;
        v_faab_reseeded := TRUE;
        v_faab_why := 'league is ' || v_league.status || ' (pre-draft): every seat re-seeded to the new budget so all balances match the create/join/claim seeding (§12.2 / D70 — 118:2617-2621''s rule, kept for the state it was written for)';
      ELSE
        SELECT count(*)::int INTO v_faab_off
        FROM public.league_members m
        WHERE m.league_id = p_league_id AND m.team_id IS NOT NULL
          AND m.faab_balance IS DISTINCT FROM (v_canon #>> '{}')::int;
        v_faab_why := 'league is ' || v_league.status || ' (in-season): faab_balance is the ledger of each team''s spend and is BYTE-UNCHANGED for every seat — re-seeding would wipe every team''s spend (118:2617-2621 was safe only behind the status gate this verb lifts). ' || v_faab_off || ' seat(s) now carry a balance that differs from the new budget; adjusting ONE team''s balance is commish_edit_faab (§15.4:1698 — M5, F340)';
      END IF;
    END IF;

    -- (12c) THE RESCORE — every OPEN week re-queued when asked; the stored
    --       scores of every week left alone when not, and NAMED either way.
    IF v_key = 'scoring_system_id' THEN
      IF v_rescore THEN
        -- (11b) already guaranteed v_final_weeks = [] here.
        SELECT COALESCE(array_agg(s ->> 'key'), ARRAY[]::text[]) INTO v_ir_keys
        FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) s;
        FOR v_wk IN
          SELECT lw.week, lw.status
          FROM public.league_weeks lw
          WHERE lw.league_id = p_league_id AND lw.season = v_league.season
            AND lw.status IN ('live', 'correction_window')
          ORDER BY lw.week
        LOOP
          -- Starters of every team-week, derived from slot_map the way the
          -- worker derives them (`startersOf`: every non-empty value whose
          -- slot key's base is not an IR key), stamped with the player's own
          -- MIN(player_stats.updated_at) — never now() (123's SCORING rule).
          INSERT INTO public.score_fanout (season, week, player_id, enqueued_at)
          SELECT v_league.season, v_wk.week, ps.player_id, min(ps.updated_at)
          FROM public.team_lineups tl
          JOIN public.teams t ON t.id = tl.team_id AND t.league_id = p_league_id
          JOIN LATERAL jsonb_each_text(COALESCE(tl.slot_map, '{}'::jsonb)) sm(slot, pid) ON TRUE
          JOIN public.player_stats ps
            ON ps.season = v_league.season AND ps.week = v_wk.week AND ps.player_id = sm.pid
           AND ps.updated_at IS NOT NULL
          WHERE tl.season = v_league.season AND tl.week = v_wk.week
            AND sm.pid IS NOT NULL AND sm.pid <> ''
            AND NOT (split_part(sm.slot, ':', 1) = ANY (v_ir_keys))
          GROUP BY ps.player_id
          ON CONFLICT (season, week, player_id) DO NOTHING;   -- never re-stamp a healthy row
          -- "a claimable queue row EXISTS for him" (123:1088-1092's meaning),
          -- and the starters the INSERT could NOT queue, named (R968).
          SELECT count(DISTINCT sm.pid)::int INTO v_enq
          FROM public.team_lineups tl
          JOIN public.teams t ON t.id = tl.team_id AND t.league_id = p_league_id
          JOIN LATERAL jsonb_each_text(COALESCE(tl.slot_map, '{}'::jsonb)) sm(slot, pid) ON TRUE
          WHERE tl.season = v_league.season AND tl.week = v_wk.week
            AND sm.pid IS NOT NULL AND sm.pid <> ''
            AND NOT (split_part(sm.slot, ':', 1) = ANY (v_ir_keys))
            AND EXISTS (SELECT 1 FROM public.score_fanout f
                        WHERE f.season = v_league.season AND f.week = v_wk.week AND f.player_id = sm.pid);
          SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id', x.pid, 'why',
                   CASE WHEN EXISTS (SELECT 1 FROM public.player_stats ps
                                     WHERE ps.season = v_league.season AND ps.week = v_wk.week AND ps.player_id = x.pid)
                        THEN 'stats_unstamped' ELSE 'no_stat_row' END) ORDER BY x.pid), '[]'::jsonb)
          INTO v_not_enq
          FROM (SELECT DISTINCT sm.pid
                FROM public.team_lineups tl
                JOIN public.teams t ON t.id = tl.team_id AND t.league_id = p_league_id
                JOIN LATERAL jsonb_each_text(COALESCE(tl.slot_map, '{}'::jsonb)) sm(slot, pid) ON TRUE
                WHERE tl.season = v_league.season AND tl.week = v_wk.week
                  AND sm.pid IS NOT NULL AND sm.pid <> ''
                  AND NOT (split_part(sm.slot, ':', 1) = ANY (v_ir_keys))
                  AND NOT EXISTS (SELECT 1 FROM public.score_fanout f
                                  WHERE f.season = v_league.season AND f.week = v_wk.week AND f.player_id = sm.pid)) x;
          v_rescored := v_rescored || jsonb_build_object(
            'week', v_wk.week, 'status', v_wk.status,
            'starters_enqueued', v_enq, 'score_not_enqueued', v_not_enq);
        END LOOP;
        IF jsonb_array_length(v_rescored) > 0 THEN
          v_rescore_done := TRUE;
          v_rescore_why  := NULL;
        ELSE
          v_rescore_done := FALSE;
          v_rescore_why  := 'nothing_scored_yet — this season has no live or correction_window week and no final week, so there is no stored score to recompute; the re-frozen snapshot governs every week from here';
        END IF;
      ELSE
        v_rescore_done := FALSE;
        v_rescore_why  := 'not_requested — rescore was not asked for: '
          || jsonb_array_length(v_final_weeks) || ' final week(s) ' || v_final_weeks::text
          || ' keep their stored scores, and ' || jsonb_array_length(v_open_weeks) || ' open week(s) '
          || (SELECT COALESCE(jsonb_agg(x -> 'week'), '[]'::jsonb) FROM jsonb_array_elements(v_open_weeks) x)::text
          || ' keep the points already computed under the PREVIOUS snapshot';
        IF v_open_weeks <> '[]'::jsonb THEN
          -- An open week's stored points were computed under the previous
          -- snapshot; its next drain uses the new one. That is a MIXED week
          -- and the one thing this verb must never report as clean.
          v_score_stale := TRUE;
          v_stale_why   := 'snapshot_changed_without_rescore';
        END IF;
      END IF;
    END IF;

    -- (12d) ROSTER SHAPE: nothing re-fits a stored slot_map. Counted, so the
    --       §7.3 header's "warned" is a number.
    IF v_key = 'roster_settings' THEN
      SELECT count(*)::int INTO v_not_refit
      FROM public.team_lineups tl
      JOIN public.teams t ON t.id = tl.team_id AND t.league_id = p_league_id
      JOIN public.league_weeks lw ON lw.league_id = p_league_id AND lw.season = tl.season AND lw.week = tl.week
      WHERE tl.season = v_league.season AND lw.status IN ('upcoming', 'live');
    END IF;

    v_consequences := jsonb_build_object(
      'snapshot_refrozen',         v_snapshot_refrozen,
      'snapshot_why',              v_snapshot_why,
      'final_weeks',               v_final_weeks,
      'open_weeks',                v_open_weeks,
      'rescore_requested',         v_rescore,
      'rescore_performed',         v_rescore_done,
      'rescore_not_performed_why', v_rescore_why,
      'rescored_weeks',            v_rescored,
      'score_stale',               v_score_stale,
      'score_stale_reason',        v_stale_why,
      'faab_reseeded',             v_faab_reseeded,
      'faab_reseed_why',           v_faab_why,
      'faab_seats_off_budget',     v_faab_off,
      'lineups_not_refit',         v_not_refit,
      'lineups_not_refit_why',     CASE WHEN v_key = 'roster_settings' THEN
                                     'no stored team_lineups.slot_map is re-fit by a roster change; the next set_lineup / autopilot pass fits against the new shape (§7.3 header: "allowed but logged and warned") — the count is the open/upcoming lineup rows of this season' END);

    -- (13) D336 part 2 — EXACTLY ONE audit row, through the ONE shared
    --      logging helper, INSIDE the no-op guard and AFTER the state write.
    --      §5's contractual shape: target_type 'setting', target_id = the
    --      key, before/after = {<key>: value} — THAT KEY ALONE.
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'change_setting', 'setting', v_key, v_reason,
      jsonb_build_object(v_key, v_before),
      jsonb_build_object(v_key, v_canon),
      jsonb_build_object(
        'verb',                      'commish_change_setting',
        'season',                    v_league.season,
        'action_id',                 p_action_id,
        'league_status',             v_league.status,
        'storage',                   v_storage,
        'policy_class',              v_class,
        'bypassed',                  v_bypassed,
        -- §5's three contractual extras for this verb:
        'rescore_requested',         v_rescore,
        'rescore_performed',         v_rescore_done,
        'rescore_not_performed_why', v_rescore_why,
        'consequences',              v_consequences),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_change_setting: the audit row was not written — refusing to let the change stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- (14) §10.3: override system messages auto-post to league chat and
    --      CANNOT be disabled. The consequence is in the post, not only in
    --      the document (R971's shape).
    v_message := 'Setting ' || v_key || ' changed from ' || v_before::text || ' to ' || v_canon::text
      || ' by ' || public.draft_actor_name() || ' (commissioner override)'
      || CASE WHEN v_rescore_done THEN ' — open weeks will be re-scored under the new rules'
              WHEN v_score_stale THEN ' — stored scores were NOT recomputed'
              WHEN v_key = 'faab_budget' AND NOT v_faab_reseeded THEN ' — team balances unchanged'
              ELSE '' END
      || ' — reason: ' || v_reason;
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   'commish_change_setting',
    'action_type',            'change_setting',
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'league_status',          v_league.status,
    'key',                    v_key,
    'storage',                v_storage,
    'policy_class',           v_class,
    'value',                  CASE WHEN v_no_changes THEN v_before ELSE v_canon END,
    'previous_value',         v_before,
    'requested_value',        v_canon,
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN
                                'value_already_set — the league already stored this exact value for ' || v_key || ' (compared as canonical jsonb, so 2 and "2" are the same value), so nothing was written and no receipt was issued (PROGRESS standing rule (b))' END,
    'commissioner_action_id', v_audit_id,            -- NULL on a no-op, and that is the point
    'bypassed',               v_bypassed,
    'bypassed_why',           v_bypassed_why,
    'rescore_requested',      v_rescore,
    'rescore_performed',      v_rescore_done,
    'rescore_not_performed_why', CASE WHEN v_no_changes AND v_rescore THEN
                                'no_changes — the scoring reference is already this system, so there is nothing to re-score'
                                ELSE v_rescore_why END,
    'consequences',           CASE WHEN v_no_changes THEN NULL ELSE v_consequences END,
    'reason',                 v_reason,
    'system_post',            v_message,             -- NULL on a no-op
    'evaluated_at',           p_at);

  -- The idempotency ledger row is written for a NO-OP TOO (`123:1259-1266`):
  -- an action_id is consumed by its submit whether or not anything moved.
  INSERT INTO public.commish_setting_actions (league_id, setting_key, action_id, actor_id, result)
  VALUES (p_league_id, v_key, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_change_setting_internal(UUID, TEXT, JSONB, BOOLEAN, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- The client door. Transaction `now()`, never a caller-supplied instant
-- (D307(3)); SECURITY DEFINER; in-body auth is the internal's step (2).
-- `spec:1701`'s printed order — (key, value, rescore?, reason) — is kept,
-- with `p_league_id` first as every §15.4 route does and `p_action_id` last
-- (§5's sketch: `commish_change_setting(p_league_id, p_key, p_value,
-- p_rescore, p_reason, p_action_id)`).
CREATE OR REPLACE FUNCTION commish_change_setting(
  p_league_id UUID,
  p_key       TEXT,
  p_value     JSONB    DEFAULT NULL,
  p_rescore   BOOLEAN  DEFAULT FALSE,
  p_reason    TEXT     DEFAULT NULL,  -- REQUIRED in-body (22023) — §15.4:1690, "all require reason"
  p_action_id UUID     DEFAULT NULL   -- REQUIRED in-body (22023)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.commish_change_setting_internal(
    p_league_id, p_key, p_value, p_rescore, p_action_id, now(), p_reason);
END;
$$;
-- `authenticated` keeps EXECUTE; the in-body commissioner gate is the
-- authorization (112:1237's posture).
REVOKE EXECUTE ON FUNCTION commish_change_setting(UUID, TEXT, JSONB, BOOLEAN, TEXT, UUID)
  FROM PUBLIC, anon;
