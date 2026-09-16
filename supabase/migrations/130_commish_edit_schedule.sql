-- ============================================================================
-- `commish_edit_schedule` — the LOCK-EXEMPT sibling of 111's
-- `schedule_edit_matchup` — AND `schedule_edit_matchup`'s missing receipt —
-- migration 130
-- (task L.E1.9 of M6A; tasks-M6A §6 "L.E1.9", §2.2, §5's contractual shapes,
-- §3 D336 / D348 / D350 / D353; §4 rules 1-15; PROGRESS §3 STANDING RULE
-- clauses (a), (b), (g), (i); PROGRESS F225 / F326 / F339 / F341;
-- `spec:1700` (§15.4), `spec:771` (§11.7 "Manual per-matchup editing …
-- same audit rules"), §10.3, §10.4, §12.12, §22.2, E41 (`spec:2016`).)
--
-- WHAT THIS MIGRATION DOES
--   0. **Q66 (Chris, 2026-09-16 — spec v2.16.41): A REASON IS OPTIONAL ON
--      EVERY COMMISSIONER ACTION; THE AUDIT ROW IS ALWAYS WRITTEN.** This is
--      the FIRST writer under that ruling, so it carries the ONE schema
--      change the ruling needs and lands it once, for the sweep (PROGRESS
--      F362) to build on: `commissioner_actions.reason` DROPS its NOT NULL
--      and its CHECK becomes `reason IS NULL OR <123's non-blank class + 500
--      bound>`. 123 is IN PRODUCTION and is not edited; the change is an
--      `ALTER TABLE` here (§0 below). A blank / whitespace-only reason is
--      stored as NULL, never as '' and never refused; a non-empty reason is
--      stored TRIMMED (the explicit `E' \t\r\n'` class — that part of F225
--      stands) and bounded at 500. Only 130's two verbs pass NULL today; the
--      six earlier verbs (123, 125-129) still refuse a blank reason in-body
--      until the sweep lands — a known, recorded transitional state (F362).
--   1. `commish_schedule_actions` — the sibling's OWN zero-policy replay
--      ledger (D350), `UNIQUE (league_id, action_id)` + `REVOKE TRUNCATE`.
--   2. `commish_edit_schedule_internal` + `commish_edit_schedule` — a NEW
--      verb beside 111's, the 123 template in all seven parts (D336): it
--      re-pairs ONE regular-season matchup the way 111 does (the same
--      permutation, the same parking step, the same in-body re-validation),
--      but as a COMMISSIONER OVERRIDE — the timing gates 111 raises against a
--      commissioner are lifted and NAMED in `bypassed[]`, the reason is
--      OPTIONAL (Q66) and normalised in the explicit `E' \t\r\n'` class, a
--      no-op returns `no_changes: true` instead of raising, and every change
--      writes its `commissioner_actions` row through the ONE logging helper.
--   3. `schedule_edit_matchup` (111's verb) gains the receipt it has never
--      had — `CREATE OR REPLACE` against **111:785-1153's FILE TEXT** (D137),
--      **EXACTLY ONE NEW HUNK**, at the seam between the in-txn `league_chat`
--      post (`111:1123-1124`) and the `schedule_actions` ledger INSERT
--      (`111:1148-1149`), reading the `v_result` built at `111:1126-1146`.
--      Nothing else in that body moves (pgTAP 078 §L pins it), and
--      `schedule_remix_confirm` (`111:573-784`) is BYTE-UNTOUCHED — its
--      pre-130 `prosrc` md5 is a stored-literal pin in 078 §L (F341).
--
-- ---------------------------------------------------------------------------
-- WHY A SIBLING AND NOT A COMMISSIONER ARM ON 111 (D348, §4 rule 13)
-- ---------------------------------------------------------------------------
-- The house move is 123's: `commish_edit_lineup` did not edit `set_lineup`;
-- pgTAP 071 §I pins the manager verb's refusal strings, its single
-- `is_league_commish` mention and its single overload (`071:835-867`).
-- `schedule_edit_matchup` is ALREADY commissioner-only (`111:848-851`), so
-- "the manager's verb" here is the §11.7 SCHEDULE-MANAGEMENT verb — the one a
-- commissioner uses while the schedule is still a plan — and this verb is the
-- §15.4:1700 OVERRIDE a commissioner uses when the plan has met the calendar.
-- A commissioner arm inside 111's gates would weaken a never-weaken surface
-- (§11.2's lock family, rule 13) and would red nothing that exists today;
-- 078 §L is the cell that reds it, and break probe 1 shows it doing so.
--
-- ---------------------------------------------------------------------------
-- THE GATES, ONE BY ONE — LIFTED (timing / reachability) vs KEPT (legality)
-- ---------------------------------------------------------------------------
-- Standing rule (i) is the test: a commissioner power FIXES what is broken
-- inside the rules (the lock, the week gate and the status gate are TIMING
-- and REACHABILITY constraints — "when" and "by whom") and never CHANGES what
-- the game is. §2.2 / F339 name four state refusals in 111. Measured against
-- (i) and against 111's own mechanics, they split like this:
--
-- | 111 line | refusal                                  | here                                     |
-- |----------|------------------------------------------|------------------------------------------|
-- | 111:887  | matchup status ≠ `scheduled`             | **LIFTED** → `bypassed` `matchup_status_gate:<status>` |
-- | 111:904  | week status ≠ `upcoming`                 | **LIFTED** → `bypassed` `week_status_gate:<status>` (a MISSING `league_weeks` row is still refused — that is data integrity, not timing) |
-- | 111:913  | the week's own first kickoff has passed  | **LIFTED** → `bypassed` `kickoff_lock` (standing rule (g): the game-day lock binds no verb in this slice; D335). Not in §2.2's four — it is the lock the verb's NAME says it is exempt from, and without it 111:904's lift is unreachable (a `live` week has kicked off by definition) |
-- | 111:993  | a SIBLING row's status ≠ `scheduled`     | **LIFTED** → `bypassed` `sibling_status_gate:<matchup_id>:<status>` (111:887's own rule, applied to the row the new team vacates) |
-- | 111:894  | the cell carries a score, a result or `is_overridden` | **KEPT, refused BY NAME** — §22.2 / rule 9: a scored or overridden cell is never rewritten; correcting it is `commish_edit_score`'s (126) |
-- | 111:999  | a SIBLING cell carries a score / result / flag | **KEPT** — the same rule on the row the edit would re-seat |
-- | 111:881  | round_type ∉ (regular, secondary)        | **KEPT, refused BY NAME — PROGRESS F360, RULED 2026-09-16 (R1047): hand-picking playoff matchups is a WANTED commissioner feature and its OWN task, not a lift here.** §2.2 lists it among the four, but lifting it in THIS verb lands nothing: bracket rows (`playoff` / `consolation` / `third_place`) seat a SUBSET of the league, and 111's in-body uniqueness re-validation (`111:1075-1091`, KEPT here as a legality gate) counts EVERY non-retired team once per (week, round_type) — so a bracket edit would be refused one gate later with a message about regular-season uniqueness, and even a landed one would be re-seeded away at the next sync: `playoff_bracket_sync_internal` DELETEs the round's `playoff` rows with `home_seed IS NOT NULL` and re-INSERTs them from the standings (**118:1573-1594** — the earlier `118:1075-1077` cite pointed at variable assignments, corrected in the fix round). The bracket verb F360 now names must make BOTH of those respect a manual pairing. The refusal here says that playoff matchups are set automatically today and that hand-picking them is a planned commissioner feature — not a legality wall |
-- | 111:867  | league status ≠ `in_season`              | **KEPT** — standing rule (a)'s own bound: "at any time the league is in a state where the action is meaningful"; a regular-season pairing is meaningful only in season |
-- | 111:919  | bye row                                  | **KEPT** — v1 schedules have no bye to edit |
-- | 111:926-934 | a foreign or retired team               | **KEPT** — F222(a): only this league's seated franchises pair |
-- | 111:1034-1041 | the parking type is occupied           | **KEPT** — the permutation cannot be made safe under the unique indexes |
-- | 111:1086-1107 | uniqueness + E40 after the write       | **KEPT** — legality of the resulting week |
-- | 111:938-943 | the no-op                               | not a refusal here: `no_changes: true` (D336 part 3), ledger row written, no receipt, no post |
-- | 111:952-957 | reason required only after Week 1 kickoff | ~~superseded: the reason is required UNCONDITIONALLY (§15.4:1690, standing rule (b))~~ **STRUCK 2026-09-16 (Q66): the reason is OPTIONAL in every window (spec v2.16.41 — §10 / §11.7 / §15.4 / E41). The sibling requires none; 111's own post-kickoff gate at `111:952-957` is an ORIGINAL line outside the one hunk and stays as written until the sweep (F362) touches 111 — see "111's RECEIPT HUNK" below.** E41's window is still evaluated and REPORTED (`window`) because the chat post and the receipt say whether the edit fell inside it |
--
-- Every gate reads the row this call LOCKED: `leagues … FOR UPDATE` is the
-- first statement after the shape checks (rule 8, R1036), and the matchup,
-- week and sibling rows are read AFTER it, so a concurrent writer that takes
-- the league lock is serialised behind this call and one that does not
-- (the score workers) is the same exposure 111 and 126 already carry.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS VERB DOES NOT DO, SAID OUT LOUD (§4 rule 15)
-- ---------------------------------------------------------------------------
-- It re-pairs cells that carry NO score and NO result (the kept 111:894 gate
-- is the PREMISE of that claim), so nothing stored is stale after it. On a
-- `live` week the NEXT score drain / finalize scores the NEW pairing; any
-- `team_week_results` rows for the affected teams are per-team points, not
-- pairings, and are untouched — the result COUNTS them and says so
-- (`scoring`). It never writes `is_overridden` (126's backstop is not
-- engaged), never touches `league_weeks`, and never re-plans the week
-- (Remix is `schedule_remix_confirm`'s).
--
-- ---------------------------------------------------------------------------
-- 111's RECEIPT HUNK — RE-DERIVED UNDER Q66 (2026-09-16)
-- ---------------------------------------------------------------------------
-- THE FIRST CUT (2026-09-15) made the reason UNCONDITIONAL here, because
-- `commissioner_actions.reason` was NOT NULL (`123:295-296`) and the receipt
-- could not otherwise be written for a free-window edit. The Reviewer
-- (R1046) showed that decided a spec conflict (§11.7:770 / E41 grant a
-- reason-free window) by a D-row instead of a Q; Q66 was filed and Chris
-- RULED (2026-09-16): *"No we should not require a reason for anything …
-- I think it's fine to have one but it's not required. What is required is
-- storing the transaction and displaying it in the 'activity' section of the
-- League Home."* Spec v2.16.41 folds that into §10, §11.7, §15.4 and E41.
--
-- WHAT THE HUNK DOES NOW: the receipt is written on EVERY edit (audit
-- always); the reason it stores is `NULLIF(btrim(v_reason, E' \t\r\n'), '')`
-- — NULL when absent or whitespace-only (§0's column change makes that
-- storable), the explicit class otherwise, bounded at 500 by name. NO
-- refusal for a missing reason. The receipt's id is folded into the returned
-- document (`commissioner_action_id`). The hunk does NOT touch the top-level
-- `reason_required` any more: 111 computes it as `NOT v_free` at
-- `111:1140`/`:1146` and that is still TRUE AS MEASURED — see the next
-- paragraph. The no-op (`111:938-943`) stays a REFUSAL — it fires BEFORE the
-- hunk and writes none of the three rows (D348).
--
-- WHAT THE HUNK DELIBERATELY DOES NOT DO, AND WHY (the one-hunk discipline
-- vs the ruling's reach): 111's OWN post-kickoff gate (`111:952-957`,
-- *"a matchup edit after the first kickoff … requires a reason"*) and its
-- post text (`111:1123`, the `— reason: ' || v_reason` tail, which would
-- concatenate to NULL) are ORIGINAL lines outside the hunk. Under Q66 that
-- gate is now a defect against the spec (a verb refusing a commissioner —
-- standing rule (a)/(f): file and fix), but removing it here is a SECOND
-- and THIRD hunk in a body D137 / F341 / this task's text say carries
-- exactly one. It is therefore FILED, not built: PROGRESS **F362** (the
-- reason-optional sweep) owns `111:952-957` and `111:1123` together with the
-- six earlier verbs' in-body gates and R1048's plain-`btrim` post. Until the
-- sweep lands, `schedule_edit_matchup` still refuses a reason-less edit
-- AFTER Week 1 kickoff (by 111's own gate — pgTAP 078 C-family and the stack
-- vitest's 2001 cells pin that transitional state BY NAME as F362's), and
-- lands one BEFORE it with a NULL-reason receipt (078 §D). The sibling
-- `commish_edit_schedule` is fully under the ruling today: no reason gate in
-- any window (078 §H1-H3).
--
-- Suites re-cut toward the ruling in the fix round: pgTAP 059 §H (H1-H4 and
-- the `…36` side flip pass NO reason again; H1's `reason_required` is back
-- to `false`), `schedule-edit-api-db.test.ts` (the free-window edits pass no
-- reason and assert a receipt whose `reason` IS NULL), pgTAP 078 §D/§H/§M.
-- The M4 schedule panel's hint (*"required after Week 1 kickoff"*) is stale
-- the OTHER way now — a reason is optional everywhere — and stays
-- **PROGRESS F361**, re-scoped, L.E1.13's.
--
-- ---------------------------------------------------------------------------
-- D137 PROVENANCE
-- ---------------------------------------------------------------------------
-- `schedule_edit_matchup`: ONE replaced function, authored against
-- **`supabase/migrations/111_schedule_remix.sql` lines 785-1153** (the newest
-- and ONLY defining migration — `grep -ln schedule_edit_matchup
-- supabase/migrations/*.sql` → 111 alone; never `pg_get_functiondef`, never a
-- deployed body). Pre-130 `md5(prosrc)` measured on the local chain at
-- 001-129: `dd445484008f90c6a1fe6a1e2727d02e` (17000 chars).
-- **HUNK COUNT: 1** — inserted after `111:1146` (the `v_result` build) and
-- before `111:1148` (the `schedule_actions` INSERT). `diff -u` of
-- `111:785-1153` against §4 below shows exactly one `@@` hunk (shown in the
-- PR; RE-DERIVED and re-counted in the Q66 fix round, 2026-09-16 — still
-- one `@@`, zero `-` lines). The DECLARE block is untouched on purpose: the
-- receipt id is carried in `v_result` itself, so no new variable was needed.
-- `schedule_remix_confirm` (`111:573-784`): NOT replaced, NOT touched. Its
-- pre-130 `md5(prosrc)` = `d6fdf4664703904554356009a30a1fc2` (8932 chars) is
-- pinned as a stored literal in pgTAP 078 §L, so a hunk that wanders into it
-- (the F341 misread of `111:738-740`) reds by name. 111's REVOKE
-- (`111:1155`) survives `CREATE OR REPLACE` (privileges are not reset) and
-- 078 §A asserts the door's grants unchanged.
-- Every other object below is NEW (`grep -rn` over `supabase/migrations/`
-- returns each name only here). 109, 111 (bar the one hunk), 118, 123 and 126
-- are byte-untouched.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4): additive (one new table, two new
-- functions) plus ONE `CREATE OR REPLACE` with a stated one-hunk diff, plus
-- ONE `ALTER TABLE` on a production table (§0: `commissioner_actions.reason`
-- DROP NOT NULL + CHECK relaxed — a WIDENING, no existing row can fail it,
-- no backfill, no data rewrite; typegen turns `reason: string` into
-- `string | null` and every TypeScript consumer compiles — measured, the
-- only reader of the Row type is the `CommissionerAction` alias); no
-- column dropped, no policy dropped, no signature changed (`schedule_edit_
-- matchup(UUID, UUID, UUID, UUID, TEXT, UUID)` is the same overload —
-- `inseason-routes.test.ts`'s six-argument pin is untouched); RLS enabled
-- with ZERO policies on the new table plus the per-role `REVOKE TRUNCATE`
-- (D350; asserted per role with `has_table_privilege` in pgTAP 078 §A).
-- **NO `HELD-FROM-PRODUCTION.txt` ENTRY IS ADDED — the hold was cleared
-- 2026-09-09 (PR #282); the file remains in the tree as the record of the
-- hold and gains no entry (R1042).** 125-129 are merged and NOT yet pushed
-- (hosted tops out at 124); 130 is authored against the repo's chain and
-- never against a deployed body (CLAUDE.md migration discipline).
-- `npx supabase db push` for 125-130 is Chris's after merge.
--
-- WAIVERS: none. R6 and D38 are not engaged — §0 REPLACES an existing CHECK
-- with a strictly weaker one (every row that satisfied the old predicate
-- satisfies the new; `ALTER … ADD CONSTRAINT` validates the existing rows
-- and cannot fail) and nothing is backfilled.
--
-- D336's SEVEN PARTS, AND WHERE EACH ONE IS
--   (1) the ledger      → §1, `commish_schedule_actions`
--   (2) ONE audit row   → §2 step (15c), through `log_commissioner_action_internal`
--                         (`123:417-453`), INSIDE the no-op guard and AFTER the
--                         state write, `IF v_audit_id IS NULL RAISE`
--   (3) the no-op       → §2 step (13): the requested pairing equals the stored
--                         one — the ONE dimension this verb changes (a sibling
--                         moves only when the target does); ledger row written
--                         anyway
--   (4) the chat post   → §2 step (15d), in-txn and non-disableable (§10.3)
--   (5) the posture     → PLAIN `search_path=''` internal taking `p_at`,
--                         triple-REVOKEd, under a SECURITY DEFINER wrapper
--                         passing `now()` (D307(3)); in-body auth as ONE
--                         no-leak 42501
--   (6) the reason gate → §2 step (4): OPTIONAL under Q66 — normalised in the
--                         explicit `E' \t\r\n'` class (blank ⇒ NULL), the
--                         500 bound by name, matching §0's relaxed CHECK
--   (7) the result      → names every gate bypassed and WHY, the affected
--                         teams (D353), what scoring did NOT do, with
--                         `commissioner_action_id` NULL on a no-op
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Q66 — `commissioner_actions.reason` becomes NULLABLE (spec v2.16.41).
--    123 is in production (hosted tops out at 124), so its column definition
--    at 123:295-296 is not edited; this ALTER is the whole change. The CHECK
--    keeps 123's explicit whitespace class and the 500 bound for a NON-NULL
--    reason — '' and a tab/newline-only string are still refused by the
--    table (23514), because a verb that wants "no reason" stores NULL. The
--    constraint name is the one Postgres minted for 123's inline CHECK
--    (`commissioner_actions_reason_check`, measured on the local chain);
--    it is re-minted under the same name so pgTAP 078 §M can pin its text.
-- ---------------------------------------------------------------------------
ALTER TABLE commissioner_actions
  ALTER COLUMN reason DROP NOT NULL;
ALTER TABLE commissioner_actions
  DROP CONSTRAINT commissioner_actions_reason_check;
ALTER TABLE commissioner_actions
  ADD CONSTRAINT commissioner_actions_reason_check
  CHECK (reason IS NULL OR (length(btrim(reason, E' \t\r\n')) > 0 AND length(reason) <= 500));
COMMENT ON COLUMN commissioner_actions.reason IS
  'OPTIONAL since migration 130 (PROGRESS Q66, Chris 2026-09-16; spec v2.16.41 §10.3): a commissioner action always writes its row, a reason is free text the actor MAY give. NULL = none given (a blank or whitespace-only input is stored as NULL by the verbs, never as ''''); non-NULL is non-blank in the explicit E'' \t\r\n'' class and at most 500 characters. Readers render "no reason given" for NULL.';

-- ---------------------------------------------------------------------------
-- 1. commish_schedule_actions — this verb's OWN replay ledger (D350). Never
--    shared with `schedule_actions` (111's — a different verb's namespace,
--    `111:628-635`'s `kind` lesson) and never folded into
--    commissioner_actions (`123:333-335`'s pre-planted-row attack; F326).
-- ---------------------------------------------------------------------------
CREATE TABLE commish_schedule_actions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  matchup_id  UUID NOT NULL,                     -- the ONE row this submit named (no FK: the receipt outlives a re-planned schedule)
  action_id   UUID NOT NULL,                     -- client-minted; dedupes retries (E2/D68)
  actor_id    UUID NOT NULL REFERENCES profiles(id),
  result      JSONB NOT NULL,                    -- the verb's returned jsonb, replayed byte-identically
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, action_id)                  -- the race backstop behind the select-then-insert
);
CREATE INDEX idx_commish_schedule_actions_league_matchup ON commish_schedule_actions(league_id, matchup_id);

COMMENT ON TABLE commish_schedule_actions IS
  'Idempotency ledger for commish_edit_schedule (migration 130, D350). ZERO policies: the DEFINER verb is the only reader and writer. NOT the audit log — §12.26: "an action_id is an idempotency key, not an audit record" — so a row is written for a NO-OP too, while commissioner_actions is not. NOT schedule_actions: that is schedule_edit_matchup''s / schedule_remix_confirm''s namespace (F326).';

ALTER TABLE commish_schedule_actions ENABLE ROW LEVEL SECURITY;
-- ZERO policies. RLS does NOT cover TRUNCATE and the Supabase default grants
-- it to anon/authenticated (`123:485-491`, measured) — taken away here (§4
-- rule 12; F349's app-wide sweep is deferred by Chris's 2026-09-13 ruling and
-- deliberately NOT widened by this table). Asserted PER ROLE in pgTAP 078 §A.
REVOKE TRUNCATE ON TABLE commish_schedule_actions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. commish_edit_schedule_internal — the audited sibling (123's template).
--    PLAIN, search_path='', takes the instant as an argument (the
--    TimeProvider seam pgTAP drives). The permutation, the parking step and
--    the in-body re-validation are 111's (`111:959-1107`), carried over in
--    meaning; the gates are re-decided per the banner's table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_edit_schedule_internal(
  p_league_id  UUID,
  p_matchup_id UUID,
  p_home       UUID,
  p_away       UUID,
  p_action_id  UUID,
  p_at         TIMESTAMPTZ,
  p_reason     TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_found       BOOLEAN;
  v_m           public.matchups;
  v_week_status TEXT;
  v_first       INTEGER;
  v_window      RECORD;
  v_wk          RECORD;
  v_reason      TEXT;
  v_result      JSONB;
  v_old_home    UUID;
  v_old_away    UUID;
  v_new_ids     UUID[] := ARRAY[]::uuid[];   -- new teams not already in the matchup (home first)
  v_disp_ids    UUID[] := ARRAY[]::uuid[];   -- displaced teams (home first)
  v_sib         public.matchups;
  v_sibs        JSONB := '[]'::jsonb;
  v_i           INTEGER;
  v_t           UUID;
  v_d           UUID;
  v_side        TEXT;
  v_cnt         INTEGER;
  v_n           INTEGER;
  v_message     TEXT;
  v_names       JSONB;
  v_no_changes  BOOLEAN;
  v_bypassed    JSONB := '[]'::jsonb;
  v_bypassed_why JSONB := '{}'::jsonb;
  v_affected    JSONB;
  v_audit_id    UUID;
  v_twr         INTEGER := 0;
  v_scoring     JSONB;
BEGIN
  -- (0) SHAPE. A malformed call is refused BY NAME and never answered with
  --     `no_changes: true` (126's rule; §4 rule 15).
  IF p_matchup_id IS NULL THEN
    RAISE EXCEPTION 'commish_edit_schedule: p_matchup_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'commish_edit_schedule: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_home IS NULL OR p_away IS NULL THEN
    RAISE EXCEPTION 'commish_edit_schedule: both teams are required — v1 schedules even counts only, a matchup has no bye (§7.3.1/§11.7)'
      USING ERRCODE = '22023';
  END IF;
  IF p_home = p_away THEN
    RAISE EXCEPTION 'commish_edit_schedule: a team cannot play itself (§11.7 "no self-matchups")'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8). Every gate
  --     below reads THIS row or rows read after it, never a pre-lock read
  --     (R1036's lesson).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — commissioner only, in-body, ONE no-leak 42501 covering "no
  --     such league" and "not a commissioner" alike (D336 part 5).
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_edit_schedule: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2), AFTER auth and BEFORE every business gate
  --     (`123:602-609`), so a retry replays byte-identically even when the
  --     week has since moved on.
  SELECT a.result INTO v_result
  FROM public.commish_schedule_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  -- (4) THE REASON — OPTIONAL (Q66, Chris 2026-09-16; spec v2.16.41 §10 /
  --     §15.4). Normalised in the explicit whitespace class (R745 / F225):
  --     absent or whitespace-only ⇒ NULL, stored as NULL (§0's column
  --     change), never refused and never ''; a non-empty reason is stored
  --     trimmed and bounded at 500 by name (the league_chat bound). What IS
  --     required is the audit row (step 15c) and the chat post (15d).
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'commish_edit_schedule: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) KEPT (standing rule (a)'s "meaningful state"): a regular-season
  --     pairing exists to be played in season.
  IF v_league.status <> 'in_season' THEN
    RAISE EXCEPTION
      'commish_edit_schedule: league % is % — regular-season matchups exist to be edited only while in_season (§11.7; standing rule (a): a state where the action is meaningful)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  -- (6) THE ROW, read after the lock.
  SELECT m.* INTO v_m
  FROM public.matchups m
  WHERE m.id = p_matchup_id AND m.league_id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commish_edit_schedule: matchup % is not a matchup of league %', p_matchup_id, p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- (7) KEPT (F360, ruled 2026-09-16 — a bracket verb is its own task): a
  --     bracket row is the playoffs engine's. See the banner — lifting
  --     111:881 HERE lands nothing, because the uniqueness re-validation this
  --     verb KEEPS counts every team once per (week, round_type) and a
  --     bracket seats a subset; and `playoff_bracket_sync_internal`
  --     (118:1573-1594) DELETEs and re-INSERTs the round's seeded rows at
  --     each sync. The message says "planned feature", not "illegal".
  IF v_m.round_type NOT IN ('regular', 'secondary') THEN
    RAISE EXCEPTION
      'commish_edit_schedule: matchup % is a % row — only regular-season pairings (regular / secondary) are re-paired here. Playoff matchups are set automatically today: the playoffs engine seeds them from the standings and re-seeds them at each sync (§11.5, 118:1573-1594), and this verb''s every-team-once re-validation (§11.7) cannot hold over a bracket subset. Hand-picking playoff matchups is a planned commissioner feature with its own verb (PROGRESS F360, ruled 2026-09-16) — not available yet',
      p_matchup_id, v_m.round_type
      USING ERRCODE = 'P0001';
  END IF;

  -- (8) LIFTED — 111:887 (matchup status ≠ scheduled). Named, not refused.
  IF v_m.status <> 'scheduled' THEN
    v_bypassed := v_bypassed || to_jsonb(('matchup_status_gate:' || v_m.status)::text);
    v_bypassed_why := v_bypassed_why || jsonb_build_object('matchup_status_gate',
      'schedule_edit_matchup refuses a ' || v_m.status || ' matchup by name (111:887-892, "only scheduled matchups may change; live/final never regenerate (§11.7/E41)"); that is a TIMING gate (standing rule (i)) and the commissioner override stands outside it — the cell carries no score and no result (step 9), so nothing stored is rewritten');
  END IF;

  -- (9) KEPT — 111:894 (R733): a scored or overridden cell is never rewritten
  --     (§22.2 / rule 9). Correcting a score is commish_edit_score's (126).
  IF v_m.is_overridden OR v_m.result IS NOT NULL
     OR COALESCE(v_m.home_score, 0) <> 0 OR COALESCE(v_m.away_score, 0) <> 0 THEN
    RAISE EXCEPTION
      'commish_edit_schedule: matchup % (week %) carries a result or score (overridden: %) — a scored or overridden cell is never rewritten (§22.2/rule 9); this is a LEGALITY boundary, not a timing one: correct the score or result with commish_edit_score / commish_set_result (migration 126) and re-pair a cell that carries none',
      p_matchup_id, v_m.week, v_m.is_overridden
      USING ERRCODE = 'P0001';
  END IF;

  -- (10) LIFTED — 111:904 (week status ≠ upcoming). A MISSING week row is
  --      still refused: that is data integrity, not timing.
  SELECT w.status INTO v_week_status
  FROM public.league_weeks w
  WHERE w.league_id = p_league_id AND w.season = v_m.season AND w.week = v_m.week;
  IF v_week_status IS NULL THEN
    RAISE EXCEPTION
      'commish_edit_schedule: week % of league % has no league_weeks row — the schedule row exists but its week does not (§12.17); refusing rather than re-pairing a week the engine never opened',
      v_m.week, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_week_status <> 'upcoming' THEN
    v_bypassed := v_bypassed || to_jsonb(('week_status_gate:' || v_week_status)::text);
    v_bypassed_why := v_bypassed_why || jsonb_build_object('week_status_gate',
      'schedule_edit_matchup refuses a week whose status is ' || v_week_status || ' by name (111:904-909, "only an upcoming week''s matchups may change (§11.7/§12.17)"); the week gate is a TIMING constraint (standing rule (i)) and does not bind the commissioner override');
  END IF;

  -- (11) LIFTED — 111:913 (R730: the week's own first kickoff has passed).
  --      Standing rule (g): the game-day lock binds no verb in this slice.
  --      The datum is still READ (at p_at, the TimeProvider seam) so the
  --      receipt and the post can say the edit landed on a week under way.
  SELECT * INTO v_wk FROM public.schedule_window_internal(v_m.season, v_m.week, p_at);
  IF NOT v_wk.free THEN
    v_bypassed := v_bypassed || to_jsonb('kickoff_lock'::text);
    v_bypassed_why := v_bypassed_why || jsonb_build_object('kickoff_lock',
      'week ' || v_m.week || ' kicked off at ' || v_wk.first_kickoff_at || ' (' || v_wk.datum_arm || '); schedule_edit_matchup refuses it by name (111:913-918, "only future weeks may change (§11.7/E41/E42)") — the game-day lock does not bind the commissioner (standing rule (g), D335)');
  END IF;

  -- (12) KEPT: a bye row; a foreign or retired team (F222(a)).
  IF v_m.away_team_id IS NULL THEN
    RAISE EXCEPTION 'commish_edit_schedule: matchup % is a bye row — v1 schedules have none to edit', p_matchup_id
      USING ERRCODE = 'P0001';
  END IF;
  FOR v_t IN SELECT unnest(ARRAY[p_home, p_away]) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.teams t
                   WHERE t.id = v_t AND t.league_id = p_league_id AND t.status <> 'retired') THEN
      RAISE EXCEPTION
        'commish_edit_schedule: team % is not a seated franchise of league % — a matchup may only pair this league''s own teams (§11.7/F222)',
        v_t, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- (13) THE NO-OP, DETECTED BY VALUE (D336 part 3): the requested pairing
  --      equals the stored one. That is the ONE dimension this verb changes —
  --      a sibling row moves only when the target does, so an unchanged
  --      target implies unchanged siblings.
  v_old_home := v_m.home_team_id;
  v_old_away := v_m.away_team_id;
  v_no_changes := (p_home = v_old_home AND p_away = v_old_away);

  -- (14) E41's window, REPORTED not enforced: the league's FIRST week's
  --      kickoff, at p_at. Under Q66 it gates nothing here (no reason is
  --      required in either window); the post and the receipt still say
  --      which side of it the edit fell on.
  SELECT min(w.week) INTO v_first
  FROM public.league_weeks w
  WHERE w.league_id = p_league_id AND w.season = v_league.season;
  SELECT * INTO v_window FROM public.schedule_window_internal(v_league.season, v_first, p_at);

  IF NOT v_no_changes THEN
    -- (15a) THE PERMUTATION — 111:959-1028 in meaning: new teams not already
    --       in this matchup, and the teams they displace (home slot first on
    --       both sides). |new| = |displaced|. Every sibling is resolved
    --       BEFORE any write, so every refusal fires against an untouched
    --       week.
    IF p_home <> v_old_home AND p_home <> v_old_away THEN v_new_ids := array_append(v_new_ids, p_home); END IF;
    IF p_away <> v_old_home AND p_away <> v_old_away THEN v_new_ids := array_append(v_new_ids, p_away); END IF;
    IF v_old_home <> p_home AND v_old_home <> p_away THEN v_disp_ids := array_append(v_disp_ids, v_old_home); END IF;
    IF v_old_away <> p_home AND v_old_away <> p_away THEN v_disp_ids := array_append(v_disp_ids, v_old_away); END IF;

    FOR v_i IN 1..COALESCE(array_length(v_new_ids, 1), 0) LOOP
      v_t := v_new_ids[v_i];
      SELECT s.* INTO v_sib
      FROM public.matchups s
      WHERE s.league_id = p_league_id AND s.season = v_m.season AND s.week = v_m.week
        AND s.round_type = v_m.round_type AND s.id <> p_matchup_id
        AND (s.home_team_id = v_t OR s.away_team_id = v_t);
      IF NOT FOUND THEN
        RAISE EXCEPTION
          'commish_edit_schedule: team % has no other % matchup in week % of league % to vacate — the week''s rows are not the engine''s one-per-team shape (§11.7)',
          v_t, v_m.round_type, v_m.week, p_league_id
          USING ERRCODE = 'P0001';
      END IF;
      -- LIFTED — 111:993 (the sibling's status), 111:887's rule on the row
      -- the new team vacates. Named per sibling.
      IF v_sib.status <> 'scheduled' THEN
        v_bypassed := v_bypassed || to_jsonb(('sibling_status_gate:' || v_sib.id || ':' || v_sib.status)::text);
        v_bypassed_why := v_bypassed_why || jsonb_build_object('sibling_status_gate:' || v_sib.id,
          'schedule_edit_matchup refuses to re-seat a team into a ' || v_sib.status || ' matchup by name (111:993-998); the same timing gate as matchup_status_gate, lifted for the same reason — the sibling cell carries no score and no result (next check)');
      END IF;
      -- KEPT — 111:999: a scored or overridden sibling cell.
      IF v_sib.is_overridden OR v_sib.result IS NOT NULL
         OR COALESCE(v_sib.home_score, 0) <> 0 OR COALESCE(v_sib.away_score, 0) <> 0 THEN
        RAISE EXCEPTION
          'commish_edit_schedule: matchup % (week %, %''s current game) carries a result or score — a scored or overridden cell is never rewritten (§22.2/rule 9), and the edit would have to re-seat a team into it',
          v_sib.id, v_sib.week, v_t
          USING ERRCODE = 'P0001';
      END IF;
      v_side := CASE WHEN v_sib.home_team_id = v_t THEN 'home' ELSE 'away' END;
      v_d := v_disp_ids[v_i];
      -- One entry PER SIBLING ROW: two new teams drawn from the same matchup
      -- (the pairing swap) merge into one entry with both slots re-seated.
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_sibs) s WHERE (s ->> 'matchup_id')::uuid = v_sib.id) THEN
        SELECT jsonb_agg(
                 CASE WHEN (s ->> 'matchup_id')::uuid = v_sib.id
                      THEN jsonb_set(
                             jsonb_set(s, ARRAY['after', v_side || '_team_id'], to_jsonb(v_d), TRUE),
                             ARRAY['vacated_sides'], (s -> 'vacated_sides') || to_jsonb(v_side), TRUE)
                      ELSE s END)
          INTO v_sibs
        FROM jsonb_array_elements(v_sibs) s;
      ELSE
        v_sibs := v_sibs || jsonb_build_object(
          'matchup_id', v_sib.id,
          'status', v_sib.status,
          'vacated_sides', jsonb_build_array(v_side),
          'before', jsonb_build_object('home_team_id', v_sib.home_team_id, 'away_team_id', v_sib.away_team_id),
          'after',  jsonb_build_object(
                      'home_team_id', CASE WHEN v_side = 'home' THEN v_d ELSE v_sib.home_team_id END,
                      'away_team_id', CASE WHEN v_side = 'away' THEN v_d ELSE v_sib.away_team_id END));
      END IF;
    END LOOP;

    -- (15b) THE WRITE — 111:1030-1070's parking permutation under the
    --       IMMEDIATE per-side unique indexes (D276, measured there): the
    --       sibling rows park on a game type that holds no row in this week
    --       (asserted), the edited row is written, each sibling returns with
    --       its displaced team seated. `updated_at = p_at`.
    IF jsonb_array_length(v_sibs) > 0 THEN
      IF EXISTS (SELECT 1 FROM public.matchups m
                 WHERE m.league_id = p_league_id AND m.season = v_m.season
                   AND m.week = v_m.week AND m.round_type = 'third_place') THEN
        RAISE EXCEPTION
          'commish_edit_schedule: week % of league % holds third_place rows — the edit''s parking step cannot use that game type; refusing (§11.7/§11.5)',
          v_m.week, p_league_id
          USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.matchups
      SET round_type = 'third_place'
      WHERE id IN (SELECT (s ->> 'matchup_id')::uuid FROM jsonb_array_elements(v_sibs) s);
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> jsonb_array_length(v_sibs) THEN
        RAISE EXCEPTION 'commish_edit_schedule: parked % sibling rows, expected %', v_cnt, jsonb_array_length(v_sibs)
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    UPDATE public.matchups
    SET home_team_id = p_home, away_team_id = p_away, updated_at = p_at
    WHERE id = p_matchup_id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'commish_edit_schedule: the edited row UPDATE touched % rows, expected exactly 1 (matchup %)', v_cnt, p_matchup_id
        USING ERRCODE = 'P0001';
    END IF;

    FOR v_sib IN
      SELECT m.* FROM public.matchups m
      WHERE m.id IN (SELECT (s ->> 'matchup_id')::uuid FROM jsonb_array_elements(v_sibs) s)
    LOOP
      UPDATE public.matchups
      SET round_type   = v_m.round_type,
          home_team_id = (s -> 'after' ->> 'home_team_id')::uuid,
          away_team_id = (s -> 'after' ->> 'away_team_id')::uuid,
          updated_at   = p_at
      FROM jsonb_array_elements(v_sibs) s
      WHERE public.matchups.id = v_sib.id AND (s ->> 'matchup_id')::uuid = v_sib.id;
    END LOOP;

    -- KEPT — 111:1072-1107's in-body re-validation: (a) every seated
    -- franchise exactly once across home ∪ away in this (week, game type);
    -- (b) E40, no pair in both game types.
    SELECT count(*)::int INTO v_n FROM public.teams t WHERE t.league_id = p_league_id AND t.status <> 'retired';
    SELECT count(*)::int INTO v_cnt
    FROM (
      SELECT app.team_id
      FROM (SELECT m.home_team_id AS team_id FROM public.matchups m
            WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week = v_m.week AND m.round_type = v_m.round_type
            UNION ALL
            SELECT m.away_team_id FROM public.matchups m
            WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week = v_m.week AND m.round_type = v_m.round_type) app
      GROUP BY app.team_id HAVING count(*) = 1
    ) once;
    IF v_cnt <> v_n THEN
      RAISE EXCEPTION
        'commish_edit_schedule: after the edit, week % (%) of league % does not seat every team exactly once (% of % teams appear exactly once) — refusing (§11.7 uniqueness)',
        v_m.week, v_m.round_type, p_league_id, v_cnt, v_n
        USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.matchups a
      JOIN public.matchups b
        ON b.league_id = a.league_id AND b.season = a.season AND b.week = a.week
       AND a.round_type = 'regular' AND b.round_type = 'secondary'
       AND least(a.home_team_id, a.away_team_id) = least(b.home_team_id, b.away_team_id)
       AND greatest(a.home_team_id, a.away_team_id) = greatest(b.home_team_id, b.away_team_id)
      WHERE a.league_id = p_league_id AND a.season = v_m.season AND a.week = v_m.week
    ) THEN
      RAISE EXCEPTION
        'commish_edit_schedule: after the edit, week % of league % would pair the same two teams in both game types — a second game is never the primary opponent (E40)',
        v_m.week, p_league_id
        USING ERRCODE = 'P0001';
    END IF;

    -- THE AFFECTED TEAMS (D353): both pairings of the target and of every
    -- sibling, distinct.
    SELECT COALESCE(jsonb_agg(DISTINCT x.t), '[]'::jsonb) INTO v_affected
    FROM (
      SELECT unnest(ARRAY[v_old_home, v_old_away, p_home, p_away]) AS t
      UNION
      SELECT (s -> 'before' ->> 'home_team_id')::uuid FROM jsonb_array_elements(v_sibs) s
      UNION
      SELECT (s -> 'before' ->> 'away_team_id')::uuid FROM jsonb_array_elements(v_sibs) s
    ) x;

    -- WHAT SCORING DID NOT DO (§4 rule 15). The kept gate at (9)/(15a) is the
    -- premise: no re-paired cell carried a score or a result, so nothing
    -- stored is stale. Per-team rows for the week are counted and named as
    -- untouched.
    SELECT count(*)::int INTO v_twr
    FROM public.team_week_results r
    WHERE r.league_id = p_league_id AND r.season = v_m.season AND r.week = v_m.week
      AND r.team_id IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(v_affected) e);
    v_scoring := jsonb_build_object(
      'week_status',            v_week_status,
      'stored_cells_rewritten', 0,
      'team_week_results_rows', v_twr,
      'why',
        'every re-paired cell carried no score and no result (the §22.2 gate this verb KEEPS — step 9 / 15a), so no stored score is stale; '
        || CASE WHEN v_week_status = 'upcoming' AND v_wk.free
                THEN 'the week has not opened and has not kicked off — nothing downstream has read the pairing'
                WHEN v_week_status = 'upcoming'
                THEN 'the week''s status row is still upcoming although it kicked off (kickoff_lock lifted) — it opens at the next league_week_advance and every score read from then on is of the NEW pairing; the '
                     || v_twr || ' team_week_results row(s) for the affected teams this week are per-team points, not pairings, and are untouched'
                ELSE 'the week is ' || v_week_status || ' — the next score drain / finalize scores the NEW pairing; the '
                     || v_twr || ' team_week_results row(s) for the affected teams this week are per-team points, not pairings, and are untouched' END);

    -- (15c) D336 part 2 — EXACTLY ONE audit row, through the ONE shared
    --       logging helper, INSIDE the no-op guard and AFTER the state write.
    --       §5's contractual shape: action_type 'edit_schedule', target_type
    --       'schedule', target_id = matchup_id::text, before/after =
    --       {home_team_id, away_team_id}, metadata carrying
    --       affected_team_ids / bypassed / week / week_status.
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'edit_schedule', 'schedule', p_matchup_id::text, v_reason,
      jsonb_build_object('home_team_id', v_old_home, 'away_team_id', v_old_away),
      jsonb_build_object('home_team_id', p_home,     'away_team_id', p_away),
      jsonb_build_object(
        'verb',              'commish_edit_schedule',
        'season',            v_m.season,
        'action_id',         p_action_id,
        'week',              v_m.week,
        'week_status',       v_week_status,
        'matchup_status',    v_m.status,
        'round_type',        v_m.round_type,
        'affected_team_ids', v_affected,          -- D353
        'bypassed',          v_bypassed,
        'bypassed_why',      v_bypassed_why,
        'siblings',          v_sibs,
        'rows_changed',      1 + jsonb_array_length(v_sibs),
        'scoring',           v_scoring,
        'window',            jsonb_build_object(
                               'evaluated_at',     p_at,
                               'first_kickoff_at', v_window.first_kickoff_at,
                               'datum_arm',        v_window.datum_arm,
                               'free',             v_window.free)),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_edit_schedule: the audit row was not written — refusing to let the edit stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- (15d) §10.3: override system messages auto-post to league chat and
    --       CANNOT be disabled. Before/after in the text (D97), the bypassed
    --       gates named (R971's shape), the reason last — WHEN one was given
    --       (Q66: the clause is conditional, never "reason: <NULL>").
    SELECT jsonb_object_agg(t.id::text, t.name) INTO v_names
    FROM public.teams t WHERE t.league_id = p_league_id;
    v_message := 'Week ' || v_m.week || CASE WHEN v_m.round_type = 'secondary' THEN ' (second game)' ELSE '' END
      || ' matchup edited by ' || public.draft_actor_name() || ' (commissioner override): '
      || (v_names ->> p_home::text) || ' vs ' || (v_names ->> p_away::text)
      || ' (was ' || (v_names ->> v_old_home::text) || ' vs ' || (v_names ->> v_old_away::text) || ')'
      || COALESCE((SELECT '; ' || string_agg(
                     (v_names ->> (s -> 'after' ->> 'home_team_id')) || ' vs ' || (v_names ->> (s -> 'after' ->> 'away_team_id'))
                     || ' (was ' || (v_names ->> (s -> 'before' ->> 'home_team_id')) || ' vs '
                     || (v_names ->> (s -> 'before' ->> 'away_team_id')) || ')', '; ')
                   FROM jsonb_array_elements(v_sibs) s), '')
      || CASE WHEN jsonb_array_length(v_bypassed) > 0
              THEN ' — lifted: ' || (SELECT string_agg(b #>> '{}', ', ') FROM jsonb_array_elements(v_bypassed) b)
              ELSE '' END
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
  END IF;

  -- (16) THE RESULT — D336 part 7: every gate bypassed and WHY, the affected
  --      teams, what scoring did not do; `commissioner_action_id` NULL on a
  --      no-op, and that is the point.
  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   'commish_edit_schedule',
    'action_type',            'edit_schedule',
    'action_id',              p_action_id,
    'season',                 v_m.season,
    'week',                   v_m.week,
    'round_type',             v_m.round_type,
    'week_status',            v_week_status,
    'matchup_status',         v_m.status,
    'matchup', jsonb_build_object(
      'matchup_id', v_m.id,
      'before', jsonb_build_object('home_team_id', v_old_home, 'away_team_id', v_old_away),
      'after',  jsonb_build_object('home_team_id', p_home, 'away_team_id', p_away)),
    'siblings',               v_sibs,
    'rows_changed',           CASE WHEN v_no_changes THEN 0 ELSE 1 + jsonb_array_length(v_sibs) END,
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN
                                'pairing_already_as_asked — matchup ' || v_m.id || ' already pairs ' || p_home || ' (home) vs ' || p_away || ' (away), so nothing was written and no receipt was issued (PROGRESS standing rule (b)); the gates that would have been lifted are still named in bypassed' END,
    'commissioner_action_id', v_audit_id,            -- NULL on a no-op
    'bypassed',               v_bypassed,
    'bypassed_why',           v_bypassed_why,
    'affected_team_ids',      COALESCE(v_affected, '[]'::jsonb),
    'scoring',                v_scoring,             -- NULL on a no-op
    'reason_required',        FALSE,                 -- Q66: nothing requires one; kept for the panel (F361)
    'window', jsonb_build_object(
      'evaluated_at',     p_at,
      'first_kickoff_at', v_window.first_kickoff_at,
      'datum_arm',        v_window.datum_arm,
      'free',             v_window.free,
      'reason_required',  FALSE),                -- Q66: E41 no longer requires one after kickoff either
    'reason',                 v_reason,             -- NULL when none was given
    'system_post',            v_message,             -- NULL on a no-op
    'evaluated_at',           p_at);

  -- The idempotency ledger row is written for a NO-OP TOO (`123:1259-1266`):
  -- an action_id is consumed by its submit whether or not anything moved.
  INSERT INTO public.commish_schedule_actions (league_id, matchup_id, action_id, actor_id, result)
  VALUES (p_league_id, p_matchup_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_edit_schedule_internal(UUID, UUID, UUID, UUID, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The client door. Transaction `now()`, never a caller-supplied instant
--    (D307(3)); SECURITY DEFINER; in-body auth is the internal's step (2).
--    §5's sketch: `commish_edit_schedule(p_league_id, p_matchup_id, p_home,
--    p_away, p_reason, p_action_id)` — 111's argument order, kept.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_edit_schedule(
  p_league_id  UUID,
  p_matchup_id UUID,
  p_home       UUID,
  p_away       UUID,
  p_reason     TEXT DEFAULT NULL,  -- OPTIONAL (Q66 / spec v2.16.41): blank ⇒ NULL, never refused; ≤ 500 when given
  p_action_id  UUID DEFAULT NULL   -- REQUIRED in-body (22023)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.commish_edit_schedule_internal(
    p_league_id, p_matchup_id, p_home, p_away, p_action_id, now(), p_reason);
END;
$$;
-- `authenticated` keeps EXECUTE; the in-body commissioner gate is the
-- authorization (112:1237's posture).
REVOKE EXECUTE ON FUNCTION commish_edit_schedule(UUID, UUID, UUID, UUID, TEXT, UUID)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 4. schedule_edit_matchup — 111's verb, CREATE OR REPLACE against
--    111:785-1153's FILE TEXT with EXACTLY ONE NEW HUNK (the receipt), placed
--    between the league_chat post (111:1123-1124) and the schedule_actions
--    INSERT (111:1148-1149). See the banner section "111's RECEIPT HUNK —
--    RE-DERIVED UNDER Q66 (2026-09-16)": D137 provenance, the pre-130 md5,
--    the hunk count, and the transitional state F362 owns. The text
--    below is the extraction, not a re-typing — the hunk is the only block
--    that is not 111's.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION schedule_edit_matchup(
  p_league_id  UUID,
  p_matchup_id UUID,
  p_home       UUID,
  p_away       UUID,
  p_reason     TEXT,
  p_action_id  UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league    public.leagues;
  v_m         public.matchups;
  v_week_status TEXT;
  v_first     INTEGER;
  v_window    RECORD;
  v_free      BOOLEAN;
  v_reason    TEXT;
  v_result    JSONB;
  v_old_home  UUID;
  v_old_away  UUID;
  v_new_ids   UUID[] := ARRAY[]::uuid[];   -- new teams not already in the matchup (home first)
  v_disp_ids  UUID[] := ARRAY[]::uuid[];   -- displaced teams (home first)
  v_sib       public.matchups;
  v_sibs      JSONB := '[]'::jsonb;
  v_i         INTEGER;
  v_t         UUID;
  v_d         UUID;
  v_side      TEXT;
  v_cnt       INTEGER;
  v_n         INTEGER;
  v_message   TEXT;
  v_names     JSONB;
  v_kind      TEXT;
  v_wk        RECORD;
BEGIN
  IF p_matchup_id IS NULL THEN
    RAISE EXCEPTION 'schedule_edit_matchup: matchup_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: p_action_id is required (idempotency key — one UUID per edit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_home IS NULL OR p_away IS NULL THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: both teams are required — v1 schedules even counts only, a matchup has no bye (§7.3.1/§11.7)'
      USING ERRCODE = '22023';
  END IF;
  IF p_home = p_away THEN
    RAISE EXCEPTION 'schedule_edit_matchup: a team cannot play itself (§11.7 "no self-matchups")'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;

  -- (2) VALIDATE. One no-leak 42501.
  IF NOT FOUND OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'schedule_edit_matchup: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- REPLAY (099/E2).
  SELECT a.result, a.kind INTO v_result, v_kind
  FROM public.schedule_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    IF v_kind <> 'edit_matchup' THEN
      RAISE EXCEPTION
        'schedule_edit_matchup: action_id % was used by a % on this league — an action_id belongs to one verb (R732)',
        p_action_id, v_kind
        USING ERRCODE = '22023';
    END IF;
    RETURN v_result;
  END IF;

  IF v_league.status <> 'in_season' THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: league % is % — regular-season matchups can be edited only while in_season (§11.7)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT m.* INTO v_m
  FROM public.matchups m
  WHERE m.id = p_matchup_id AND m.league_id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'schedule_edit_matchup: matchup % is not a matchup of league %', p_matchup_id, p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_m.round_type NOT IN ('regular', 'secondary') THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: matchup % is a % row — only regular-season pairings (regular / secondary) are edited here; brackets are the playoffs engine''s (§11.5)',
      p_matchup_id, v_m.round_type
      USING ERRCODE = 'P0001';
  END IF;
  IF v_m.status <> 'scheduled' THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: matchup % (week %) is % — only scheduled matchups may change; live/final never regenerate (§11.7/E41)',
      p_matchup_id, v_m.week, v_m.status
      USING ERRCODE = 'P0001';
  END IF;
  -- R733: an overridden or scored cell is never touched (rule 9).
  IF v_m.is_overridden OR v_m.result IS NOT NULL
     OR COALESCE(v_m.home_score, 0) <> 0 OR COALESCE(v_m.away_score, 0) <> 0 THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: matchup % (week %) carries a result or score (overridden: %) — a scored or overridden cell is never rewritten (§22.2/rule 9)',
      p_matchup_id, v_m.week, v_m.is_overridden
      USING ERRCODE = 'P0001';
  END IF;
  SELECT w.status INTO v_week_status
  FROM public.league_weeks w
  WHERE w.league_id = p_league_id AND w.season = v_m.season AND w.week = v_m.week;
  IF v_week_status IS DISTINCT FROM 'upcoming' THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: week % of league % is % — only an upcoming week''s matchups may change (§11.7/§12.17)',
      v_m.week, p_league_id, COALESCE(v_week_status, 'missing')
      USING ERRCODE = 'P0001';
  END IF;
  -- R730: the week's OWN first kickoff, from nfl_games at call time — a
  -- week under way is not a future week whatever its status row says.
  SELECT * INTO v_wk FROM public.schedule_window_internal(v_m.season, v_m.week, now());
  IF NOT v_wk.free THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: week % of league % kicked off at % (%) — only future weeks may change (§11.7/E41/E42)',
      v_m.week, p_league_id, v_wk.first_kickoff_at, v_wk.datum_arm
      USING ERRCODE = 'P0001';
  END IF;
  IF v_m.away_team_id IS NULL THEN
    RAISE EXCEPTION 'schedule_edit_matchup: matchup % is a bye row — v1 schedules have none to edit', p_matchup_id
      USING ERRCODE = 'P0001';
  END IF;

  -- F222(a): a foreign or retired team is refused BY NAME (the writer's
  -- refusal in place of the composite FK).
  FOR v_t IN SELECT unnest(ARRAY[p_home, p_away]) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.teams t
                   WHERE t.id = v_t AND t.league_id = p_league_id AND t.status <> 'retired') THEN
      RAISE EXCEPTION
        'schedule_edit_matchup: team % is not a seated franchise of league % — a matchup may only pair this league''s own teams (§11.7/F222)',
        v_t, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  v_old_home := v_m.home_team_id;
  v_old_away := v_m.away_team_id;
  IF p_home = v_old_home AND p_away = v_old_away THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: matchup % already pairs % (home) vs % (away) — nothing to change',
      p_matchup_id, p_home, p_away
      USING ERRCODE = 'P0001';
  END IF;

  -- E41 / D290: the window, from the league's FIRST week's kickoff, now.
  SELECT min(w.week) INTO v_first
  FROM public.league_weeks w
  WHERE w.league_id = p_league_id AND w.season = v_league.season;
  SELECT * INTO v_window FROM public.schedule_window_internal(v_league.season, v_first, now());
  v_free := v_window.free;
  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF NOT v_free AND v_reason IS NULL THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: league Week 1 kicked off at % (%) — a matchup edit after the first kickoff is a commissioner override and requires a reason (§11.7 / E41 / D290)',
      v_window.first_kickoff_at, v_window.datum_arm
      USING ERRCODE = '22023';
  END IF;

  -- The permutation: new teams not already in this matchup, and the teams
  -- they displace (home slot first on both sides). |new| = |displaced|.
  IF p_home <> v_old_home AND p_home <> v_old_away THEN v_new_ids := array_append(v_new_ids, p_home); END IF;
  IF p_away <> v_old_home AND p_away <> v_old_away THEN v_new_ids := array_append(v_new_ids, p_away); END IF;
  IF v_old_home <> p_home AND v_old_home <> p_away THEN v_disp_ids := array_append(v_disp_ids, v_old_home); END IF;
  IF v_old_away <> p_home AND v_old_away <> p_away THEN v_disp_ids := array_append(v_disp_ids, v_old_away); END IF;

  -- (3) WRITE — a permutation over up to three rows under IMMEDIATE per-side
  -- unique indexes (109). MEASURED, not assumed (D276): single-row UPDATEs
  -- in EITHER order collide when a team swaps places with a team on the
  -- SAME side of another row (M = (T2, T5), N = (T4, T3), new (T2, T3):
  -- writing M.away = T3 duplicates N's away T3; writing N.away = T5 first
  -- duplicates M's away T5). So the sibling rows PARK first — they step out
  -- of the week's (round_type, side) uniqueness space onto a round_type
  -- that holds no row in this week (asserted, never assumed) — then the
  -- edited row is written, then each sibling returns to its game type with
  -- its displaced team seated, one UPDATE per row. Every intermediate state
  -- is legal to both indexes; the whole permutation is one transaction.
  --
  -- First resolve every sibling (the row the new team vacates) BEFORE any
  -- write, so every refusal fires against an untouched week.
  FOR v_i IN 1..COALESCE(array_length(v_new_ids, 1), 0) LOOP
    v_t := v_new_ids[v_i];
    SELECT s.* INTO v_sib
    FROM public.matchups s
    WHERE s.league_id = p_league_id AND s.season = v_m.season AND s.week = v_m.week
      AND s.round_type = v_m.round_type AND s.id <> p_matchup_id
      AND (s.home_team_id = v_t OR s.away_team_id = v_t);
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'schedule_edit_matchup: team % has no other % matchup in week % of league % to vacate — the week''s rows are not the engine''s one-per-team shape (§11.7)',
        v_t, v_m.round_type, v_m.week, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_sib.status <> 'scheduled' THEN
      RAISE EXCEPTION
        'schedule_edit_matchup: matchup % (week %, %''s current game) is % — the edit would have to re-seat a team into it; only scheduled matchups may change (§11.7/E41)',
        v_sib.id, v_sib.week, v_t, v_sib.status
        USING ERRCODE = 'P0001';
    END IF;
    IF v_sib.is_overridden OR v_sib.result IS NOT NULL
       OR COALESCE(v_sib.home_score, 0) <> 0 OR COALESCE(v_sib.away_score, 0) <> 0 THEN
      RAISE EXCEPTION
        'schedule_edit_matchup: matchup % (week %, %''s current game) carries a result or score — a scored or overridden cell is never rewritten (§22.2/rule 9)',
        v_sib.id, v_sib.week, v_t
        USING ERRCODE = 'P0001';
    END IF;
    v_side := CASE WHEN v_sib.home_team_id = v_t THEN 'home' ELSE 'away' END;
    v_d := v_disp_ids[v_i];
    -- One entry PER SIBLING ROW: two new teams drawn from the same matchup
    -- (the pairing swap) merge into one entry with both slots re-seated.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_sibs) s WHERE (s ->> 'matchup_id')::uuid = v_sib.id) THEN
      SELECT jsonb_agg(
               CASE WHEN (s ->> 'matchup_id')::uuid = v_sib.id
                    THEN jsonb_set(
                           jsonb_set(s, ARRAY['after', v_side || '_team_id'], to_jsonb(v_d), TRUE),
                           ARRAY['vacated_sides'], (s -> 'vacated_sides') || to_jsonb(v_side), TRUE)
                    ELSE s END)
        INTO v_sibs
      FROM jsonb_array_elements(v_sibs) s;
    ELSE
      v_sibs := v_sibs || jsonb_build_object(
        'matchup_id', v_sib.id,
        'vacated_sides', jsonb_build_array(v_side),
        'before', jsonb_build_object('home_team_id', v_sib.home_team_id, 'away_team_id', v_sib.away_team_id),
        'after',  jsonb_build_object(
                    'home_team_id', CASE WHEN v_side = 'home' THEN v_d ELSE v_sib.home_team_id END,
                    'away_team_id', CASE WHEN v_side = 'away' THEN v_d ELSE v_sib.away_team_id END));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_sibs) > 0 THEN
    -- The parking type must be EMPTY in this week (a regular-season week
    -- holds regular/secondary rows only; playoff-family rows live in playoff
    -- weeks — 116's). Asserted: a row there would make parking collide.
    IF EXISTS (SELECT 1 FROM public.matchups m
               WHERE m.league_id = p_league_id AND m.season = v_m.season
                 AND m.week = v_m.week AND m.round_type = 'third_place') THEN
      RAISE EXCEPTION
        'schedule_edit_matchup: week % of league % holds third_place rows — the edit''s parking step cannot use that game type; refusing (§11.7/§11.5)',
        v_m.week, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.matchups
    SET round_type = 'third_place'
    WHERE id IN (SELECT (s ->> 'matchup_id')::uuid FROM jsonb_array_elements(v_sibs) s);
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> jsonb_array_length(v_sibs) THEN
      RAISE EXCEPTION 'schedule_edit_matchup: parked % sibling rows, expected %', v_cnt, jsonb_array_length(v_sibs)
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- The edited row (one UPDATE — a side flip is one row; its new teams are
  -- parked or already its own).
  UPDATE public.matchups
  SET home_team_id = p_home, away_team_id = p_away, updated_at = now()
  WHERE id = p_matchup_id;

  -- Each sibling returns to its game type with the displaced team seated.
  FOR v_sib IN
    SELECT m.* FROM public.matchups m
    WHERE m.id IN (SELECT (s ->> 'matchup_id')::uuid FROM jsonb_array_elements(v_sibs) s)
  LOOP
    UPDATE public.matchups
    SET round_type   = v_m.round_type,
        home_team_id = (s -> 'after' ->> 'home_team_id')::uuid,
        away_team_id = (s -> 'after' ->> 'away_team_id')::uuid,
        updated_at   = now()
    FROM jsonb_array_elements(v_sibs) s
    WHERE public.matchups.id = v_sib.id AND (s ->> 'matchup_id')::uuid = v_sib.id;
  END LOOP;

  -- IN-BODY RE-VALIDATION (task item 3). (a) Every seated franchise exactly
  -- once across home ∪ away in this (week, game type) — the cross-side pin
  -- (R703); the two unique indexes remain the race backstop.
  SELECT count(*)::int INTO v_n FROM public.teams t WHERE t.league_id = p_league_id AND t.status <> 'retired';
  SELECT count(*)::int INTO v_cnt
  FROM (
    SELECT app.team_id
    FROM (SELECT m.home_team_id AS team_id FROM public.matchups m
          WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week = v_m.week AND m.round_type = v_m.round_type
          UNION ALL
          SELECT m.away_team_id FROM public.matchups m
          WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week = v_m.week AND m.round_type = v_m.round_type) app
    GROUP BY app.team_id HAVING count(*) = 1
  ) once;
  IF v_cnt <> v_n THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: after the edit, week % (%) of league % does not seat every team exactly once (% of % teams appear exactly once) — refusing (§11.7 uniqueness)',
      v_m.week, v_m.round_type, p_league_id, v_cnt, v_n
      USING ERRCODE = 'P0001';
  END IF;
  -- (b) E40: no pair may appear in both game types that week.
  IF EXISTS (
    SELECT 1
    FROM public.matchups a
    JOIN public.matchups b
      ON b.league_id = a.league_id AND b.season = a.season AND b.week = a.week
     AND a.round_type = 'regular' AND b.round_type = 'secondary'
     AND least(a.home_team_id, a.away_team_id) = least(b.home_team_id, b.away_team_id)
     AND greatest(a.home_team_id, a.away_team_id) = greatest(b.home_team_id, b.away_team_id)
    WHERE a.league_id = p_league_id AND a.season = v_m.season AND a.week = v_m.week
  ) THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: after the edit, week % of league % would pair the same two teams in both game types — a second game is never the primary opponent (E40)',
      v_m.week, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- D97: the in-txn system post, before/after in the text.
  SELECT jsonb_object_agg(t.id::text, t.name) INTO v_names
  FROM public.teams t WHERE t.league_id = p_league_id;
  v_message := 'Week ' || v_m.week || CASE WHEN v_m.round_type = 'secondary' THEN ' (second game)' ELSE '' END
    || ' matchup edited by ' || public.draft_actor_name() || ': '
    || (v_names ->> p_home::text) || ' vs ' || (v_names ->> p_away::text)
    || ' (was ' || (v_names ->> v_old_home::text) || ' vs ' || (v_names ->> v_old_away::text) || ')'
    || COALESCE((SELECT '; ' || string_agg(
                   (v_names ->> (s -> 'after' ->> 'home_team_id')) || ' vs ' || (v_names ->> (s -> 'after' ->> 'away_team_id'))
                   || ' (was ' || (v_names ->> (s -> 'before' ->> 'home_team_id')) || ' vs '
                   || (v_names ->> (s -> 'before' ->> 'away_team_id')) || ')', '; ')
                 FROM jsonb_array_elements(v_sibs) s), '')
    || CASE WHEN v_free THEN '.'
            ELSE ' — after Week 1 kickoff (commissioner override) — reason: ' || v_reason END;
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);

  v_result := jsonb_build_object(
    'league_id',      p_league_id,
    'season',         v_m.season,
    'action_id',      p_action_id,
    'week',           v_m.week,
    'round_type',     v_m.round_type,
    'matchup', jsonb_build_object(
      'matchup_id', v_m.id,
      'before', jsonb_build_object('home_team_id', v_old_home, 'away_team_id', v_old_away),
      'after',  jsonb_build_object('home_team_id', p_home, 'away_team_id', p_away)),
    'siblings',       v_sibs,
    'rows_changed',   1 + jsonb_array_length(v_sibs),
    'reason_required', NOT v_free,
    'window', jsonb_build_object(
      'evaluated_at',     now(),
      'first_kickoff_at', v_window.first_kickoff_at,
      'datum_arm',        v_window.datum_arm,
      'free',             v_free,
      'reason_required',  NOT v_free),
    'system_post',    v_message
  );

  -- ── migration 130 / L.E1.9 (D348, F339, F225; Q66 fix round 2026-09-16):
  -- THE RECEIPT — the ONE new hunk in this body. Spec v2.16.41 §10.3 /
  -- §15.4: every override WRITES commissioner_actions; a reason is OPTIONAL.
  -- The reason stored is 111's `v_reason` re-normalised in the explicit
  -- `E' \t\r\n'` class (F225's R745 hole; 130 §0's CHECK is the same class):
  -- absent or whitespace-only ⇒ NULL (never refused, never ''), otherwise
  -- trimmed and bounded at 500 by name. NO refusal for a missing reason
  -- here. 111's own post-kickoff gate above (111:952-957) and its post text
  -- (111:1123) are ORIGINAL lines outside this hunk and are F362's (the
  -- sweep) — see the banner. The no-op above (…"nothing to change") fires
  -- before this point and stays a refusal. The receipt's id is folded into
  -- `v_result` (so the ledger row and the replay carry it); `reason_required`
  -- is left as 111 computed it (`NOT v_free`), which is true as measured
  -- until the sweep removes that gate. No DECLARE change.
  IF v_reason IS NOT NULL AND char_length(btrim(v_reason, E' \t\r\n')) > 500 THEN
    RAISE EXCEPTION 'schedule_edit_matchup: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(btrim(v_reason, E' \t\r\n'))
      USING ERRCODE = '22023';
  END IF;
  v_result := v_result || jsonb_build_object(
    'commissioner_action_id', public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'edit_schedule', 'schedule', p_matchup_id::text,
      NULLIF(btrim(COALESCE(v_reason, ''), E' \t\r\n'), ''),
      v_result -> 'matchup' -> 'before',
      v_result -> 'matchup' -> 'after',
      jsonb_build_object(
        'verb',              'schedule_edit_matchup',
        'season',            v_m.season,
        'action_id',         p_action_id,
        'week',              v_m.week,
        'week_status',       v_week_status,
        'matchup_status',    v_m.status,
        'round_type',        v_m.round_type,
        'affected_team_ids', (SELECT COALESCE(jsonb_agg(DISTINCT x.t), '[]'::jsonb) FROM (
                               SELECT unnest(ARRAY[v_old_home, v_old_away, p_home, p_away]) AS t
                               UNION SELECT (s -> 'before' ->> 'home_team_id')::uuid FROM jsonb_array_elements(v_sibs) s
                               UNION SELECT (s -> 'before' ->> 'away_team_id')::uuid FROM jsonb_array_elements(v_sibs) s) x),
        'bypassed',          '[]'::jsonb,     -- 111's verb lifts nothing; the lifted sibling is commish_edit_schedule
        'siblings',          v_sibs,
        'rows_changed',      1 + jsonb_array_length(v_sibs),
        'window',            v_result -> 'window'),
      NULL));
  IF v_result ->> 'commissioner_action_id' IS NULL THEN
    RAISE EXCEPTION 'schedule_edit_matchup: the audit row was not written — refusing to let the edit stand without its receipt (§10.3)'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.schedule_actions (league_id, action_id, kind, actor_id, result)
  VALUES (p_league_id, p_action_id, 'edit_matchup', auth.uid(), v_result);

  RETURN v_result;
END;
$$;
