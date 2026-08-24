-- ============================================================================
-- 094 — THE ENGINE READS ITS OWN CONFIG, NOT A LEAGUE (task MP.2;
-- spec v2.16 §8.8 + §7.3.2/§7.3.3, D95; tasks-MP §5 MP.2 and §4 rules 1-16
-- = tasks-M3 §4's eight + the MP lane's eight; D137 head rule; D234(8)).
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 1 — THE DEFECT, AND IT IS LIVE TODAY.
-- ---------------------------------------------------------------------------
-- §8.8/D95: "a mock never re-hydrates" — a mock snapshots the league's
-- settings at launch and is thereafter immune to edits. That is true of the
-- clocks, the draft type, the budget and every auction knob, because
-- `create_mock_draft` copies `leagues.settings->'draft'` into `drafts.config`
-- (092:1219). It has NEVER been true of the ROSTER SHAPE, for a reason that
-- is easy to miss and was missed for three milestones: `roster_settings` is
-- a SEPARATE COLUMN on `leagues`, not a key inside `settings`, so the block
-- copied at launch does not contain it. What IS snapshotted is the number
-- derived from it (`draft_rounds_from_roster` -> `drafts.total_rounds`,
-- 092:1296) — never the slots themselves.
--
-- So exactly two live functions went back to the league for the shape, on
-- the hot path, on every mock:
--
--   * `draft_autopick_resolve` (head 086:552) — `SELECT l.* INTO v_league`
--     then `v_league.roster_settings->'starting_slots'`, on EVERY autopick.
--   * `draft_mock_cpu_need`   (head 089:394) — `l.roster_settings->
--     'starting_slots'` via `JOIN public.leagues l ON l.id = d.league_id`,
--     inside the CPU value model, on EVERY bot bid.
--
-- CONSEQUENCE ONE, and it is a bug against shipped behaviour: a commissioner
-- editing the league's roster while a member's mock is running SHIFTS THE
-- BOTS under that member. Pinned by pgTAP 042 §B, which is RED against the
-- shipped bodies (shown in the PR) and GREEN after this migration.
--
-- CONSEQUENCE TWO, which is why MP.3 is blocked on this: with no league to
-- join to, the join matches nothing, `v_slots`/`v_total` stay NULL, and every
-- bot's need term collapses. The bots do not error — they stop wanting
-- anybody. Pinned by pgTAP 042 §C as a stored literal.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 2 — THE FIX IS A SNAPSHOT, NOT A NULL GUARD.
-- ---------------------------------------------------------------------------
-- `create_mock_draft` stores the league's WHOLE `roster_settings` object at
-- `config->'roster'` at launch (§1), every mock that predates this migration
-- is backfilled from its own league (§2), and both readers take the shape
-- from the draft row (§3, §4). No fallback to the league is written on the
-- mock path: a fallback would re-open the re-hydration D95 forbids and would
-- leave the very read this task exists to remove.
--
-- The key is `roster` (beside `mock`), holding the whole object rather than
-- just `starting_slots`, so the draft row describes its own roster and MP.4's
-- settings OBJECT (tasks-MP §4 rule 12) has a place to land that is a NEW
-- SOURCE rather than a rewrite.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 2a — AND ABSENCE IS A LOUD FAILURE, NOT AN EMPTY ROSTER (R491).
-- ---------------------------------------------------------------------------
-- `COALESCE(config->'roster'->'starting_slots', '[]')` cannot distinguish
-- "never snapshotted" from "legitimately no starting slots" (an all-bench
-- roster is legal), and the first of those collapses every need term to the
-- same value — this migration's own defect, arriving silently. So both
-- readers RAISE on a mock whose config lacks the `roster` KEY (key absence,
-- never an empty array), and §2's backfill ends by PROVING that no
-- unsnapshotted mock remains rather than trusting an UPDATE's row count.
-- None of this is reachable today — `league_id` is NOT NULL with a live FK,
-- so the backfill's join covers every mock — but **MP.3 drops that NOT NULL
-- and MP.4 adds a settings writer**, and a guard has to exist before the
-- reachability does. CLAUDE.md, verbatim: assert the REASON for emptiness.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 2b — WHAT §2's BACKFILL FIRES (R496), recorded so it is not
-- rediscovered. `public.drafts` carries `tr_broadcast_drafts` with **no WHEN
-- clause** (measured: `pg_get_triggerdef(...) ~ 'WHEN'` is false), so the
-- UPDATE emits one broadcast per stamped mock. Impact on this deploy is
-- ZERO — prod's migration history still ends pre-league-schema (F12), so
-- there are no mock rows to stamp — and on any environment that does have
-- them the audience is a room whose draft did not change. Named, not fixed:
-- narrowing a shipped trigger is not MP.2's to do.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 3 — REAL DRAFTS ARE UNCHANGED, DELIBERATELY AND EXPLICITLY.
-- ---------------------------------------------------------------------------
-- `draft_autopick_resolve` serves real drafts too. Its non-mock arm keeps the
-- LIVE league read, unchanged, and no `config->'roster'` is written for a
-- real draft (nothing would read it). §7.3.3's scoring-snapshot doctrine and
-- D95 both point at snapshot-at-start as the house position, and a real
-- draft's settings edits go through D141's pause-first commissioner controls
-- — which is a DIFFERENT argument with a different blast radius, and one this
-- task has no mandate to settle. Changing it would be a spec question.
-- tasks-MP §4 rule 11 is therefore satisfied by construction: on
-- `is_mock = FALSE` the code path is byte-identical to 086's.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 4 — WHAT THIS MIGRATION DOES **NOT** TOUCH.
-- ---------------------------------------------------------------------------
-- The `leagues`-EXISTENCE GUARD class (F109(a)) — `draft_tick`'s six mock-scan
-- `EXISTS (… public.leagues …)` arms, the second P0002 guards in
-- `draft_make_pick`/`draft_nominate`/`draft_place_bid`, the `FOR UPDATE`
-- variant in `draft_end`/`draft_reset` — is **MP.3's**, assigned there by
-- D234(4)/F109. Those are candidate-set and existence predicates; MP.2 owns
-- the two SETTINGS readers. One consequence for MP.3's inventory, recorded
-- so it is not re-derived: `draft_mock_cpu_need`'s single `public.leagues`
-- reference is the JOIN removed here, so that body drops OFF F109(a)'s list;
-- `draft_autopick_resolve`'s two are the DECLARE (`v_league public.leagues`)
-- and the SELECT, and the SELECT is now unreachable on a mock.
--
-- **AND THE CLAIM STOPS THERE, DELIBERATELY (R492).** "No `public.leagues`
-- reference remains reachable on a mock's path" is TRUE and is what the
-- sweep pins. "The league coupling is exhausted" would be FALSE: this body
-- still carries **two `v_draft.league_id` predicates on the mock path** —
-- the autopick queue source's `t.league_id = v_draft.league_id` (the R120
-- join) and the primary-board source's `ll.league_id = v_draft.league_id`.
-- They read `drafts.league_id`, not the `leagues` table, so they are outside
-- MP.2's charter and outside F109(a)'s `EXISTS(leagues …)` class — but with
-- a NULL `league_id` both silently yield NOTHING, and the launcher's own
-- queue and board would be ignored while best-ADP quietly wins. **Added to
-- F109(a)'s inventory for MP.3.**
--
-- ---------------------------------------------------------------------------
-- Migration checklist (delivery plan §8.1 / tasks-M3 §4.4): NO DDL — no
-- table, no column, no policy, no index, no signature change; three CREATE
-- OR REPLACEs, one data backfill and its post-condition assertion (R491)
-- · rollback = re-apply 092:1128-1422,
-- 086:552-746 and 089:394-497 verbatim, then
-- `UPDATE public.drafts SET config = config - 'roster' WHERE is_mock` (the
-- three head texts ARE the rollback text and the backfill is reversible by
-- one key deletion) · staging rehearsal: **R6 waiver** — no staging clone
-- exists (environments are local + prod only); the recorded rehearsal is
-- `npx supabase migration up` against the local stack plus the FULL pgTAP
-- suite (42 files + new 042) and the stack-backed vitest files. **NO
-- `db reset` was run** — the chain-order rule calls for reset-first only
-- when a reset is otherwise required, and this migration needs none;
-- destroying the dev machine's data to rehearse a chain that
-- `migration up` already replays is a cost with no evidence attached ·
-- **D38: a BACKFILL IS PRESENT and is not waived** — §2 stamps
-- `config->'roster'` on every `is_mock` draft from its own league, is
-- idempotent (`config->'roster' IS NULL` guard), touches no `is_mock = FALSE`
-- row, and its row count is reported in the PR · F12 note: prod's migration
-- history still ends pre-league-schema; this lands with the next normal push
-- · typegen: NOT re-run — no signature, no new function, no table or column
-- changes, so the generated surface is unchanged (verified: the three
-- `CREATE OR REPLACE`s keep their exact argument lists and return types).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. create_mock_draft — REPLACED FROM 092_auction_reserve_toggle.sql:1128-1425
--    (D137 head rule; 071 -> 089 -> 092, and 092 is the head). **ONE hunk**:
--    the roster snapshot, written beside the §7.3.8 draft block it belongs
--    with. Everything else — the §22.5 caps, the seat map refusal, the
--    solvency backstop, the order resolution, `config.mock` — is 092's text
--    verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_mock_draft(
  p_league_id UUID,
  p_human_team_id UUID DEFAULT NULL,
  p_cpu_speed TEXT DEFAULT 'realistic',
  p_action_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league       public.leagues;
  v_active_count INTEGER;
  v_human        UUID;
  v_config       JSONB;
  v_real_order   JSONB;
  v_order        JSONB;
  v_mock_id      UUID;
  v_total_rounds INTEGER;
  v_timer        INTEGER;
  v_draft        public.drafts;
  v_active_mocks BIGINT;
  v_hour_creates BIGINT;
  -- 089 (L.C1.7) — the auction launch arm:
  v_type         TEXT;
  v_real_nom     JSONB;
  v_nom_order    JSONB;
  v_first        UUID;
  v_deadline     TIMESTAMPTZ;
  v_budget       INTEGER;
  v_reserve      INTEGER;
BEGIN
  -- Argument shape (22023) before any data access.
  IF p_cpu_speed IS NULL OR p_cpu_speed NOT IN ('realistic', 'fast') THEN
    RAISE EXCEPTION 'create_mock_draft: cpu_speed must be realistic or fast'
      USING ERRCODE = '22023';
  END IF;

  -- Fast-fail auth (no-leak: a nonexistent league answers 42501 too).
  IF NOT public.is_league_member(p_league_id) THEN
    RAISE EXCEPTION 'create_mock_draft: not a member of this league'
      USING ERRCODE = '42501';
  END IF;

  -- Cap-race serializer (banner item 1): same-user concurrent launches
  -- serialize here so the §22.5 caps cannot be double-tapped past. An
  -- ADVISORY lock, deliberately not a profiles-row lock (row locks on
  -- profiles join the FK KEY-SHARE graph chat INSERTs touch — the R122
  -- deadlock class; advisory locks live outside it).
  PERFORM pg_advisory_xact_lock(
    hashtextextended('create_mock_draft:' || auth.uid()::text, 0));

  -- §4 rule 6 (E2) idempotency — batch 7, R149 (banner item 1): a retry of
  -- an already-committed launch returns the ORIGINAL mock, not a second
  -- one (the 060 replay pattern). AFTER the advisory lock (a concurrent
  -- double-tap serializes into create-then-replay) and BEFORE league/cap
  -- validation (the same intent must not trip caps its own creation
  -- already passed). Launcher-scoped + TEXT-compared (R117): a foreign
  -- caller's lookup simply misses and falls through to their own
  -- validation. A deleted mock does not replay (row = ledger).
  IF p_action_id IS NOT NULL THEN
    SELECT d.* INTO v_draft
    FROM public.drafts d
    WHERE d.is_mock
      AND d.config->'mock'->>'launched_by' = auth.uid()::text
      AND d.config->'mock'->>'action_id' = p_action_id::text;
    IF FOUND THEN
      RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'created', FALSE);
    END IF;
  END IF;

  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    -- Soft-deleted league answers 404 for a legitimate member (063 rule).
    RAISE EXCEPTION 'create_mock_draft: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- §8.8: mocks launch from a PRE-DRAFT league only.
  IF v_league.status NOT IN ('setup', 'scheduled') THEN
    RAISE EXCEPTION
      'create_mock_draft: league % is in % — practice drafts run before draft day (setup/scheduled)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  -- D95: snapshot the REAL config at launch — a mock never re-hydrates.
  -- Read here so config-shape refusals (auction) answer before seat-map
  -- ones.
  v_config := COALESCE(v_league.settings->'draft', '{}'::jsonb);

  -- 094/MP.2 — THE ONE HUNK. The roster SHAPE joins the snapshot, because
  -- D95's promise was never true of it: `roster_settings` is a separate
  -- COLUMN on `leagues`, not part of `settings->'draft'`, so the block
  -- copied above has never carried it and both readers went back to the
  -- LIVE league for it on every autopick and every CPU bid. A commissioner
  -- editing the roster mid-mock therefore moved the bots under the
  -- launcher's feet. Stored WHOLE (not just `starting_slots`) so the draft
  -- row describes its own roster the way `total_rounds` already records the
  -- count derived from it two hunks down. Key `roster`, beside `mock`: the
  -- §7.3.8 draft block is flat scalars and cannot collide with it.
  v_config := jsonb_set(v_config, '{roster}',
                        COALESCE(v_league.roster_settings, '{}'::jsonb));

  -- 089 (L.C1.7): the M3 seam is LIFTED — this is where 071 refused an
  -- auction config naming M3 (tests/025:400 flipped in the same PR). A mock
  -- auction launches through the same arm shape draft_start's auction arm
  -- has (084): the snapshot below already carries the whole §7.3.8 auction
  -- block (budget, the $0-nomination toggle, the three clocks, anti-snipe — D95: a mock never
  -- re-hydrates); the nomination order, the first nominator and the first
  -- clock are resolved per type further down.
  v_type := COALESCE(v_config->>'draft_type', 'snake');

  -- D103(1): the full seat map must exist (draft_picks.team_id is NOT
  -- NULL and the order needs every seat) — the D96 mirror; friendly
  -- refusal names placeholder seats as the remedy.
  SELECT count(*) INTO v_active_count
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.status <> 'retired';
  IF v_active_count <> v_league.team_count THEN
    RAISE EXCEPTION
      'create_mock_draft: league % has % of % franchises seated — a mock drafts the full board, so every seat must exist; add placeholder seats for the empty slots (League home → Invite) (§8.8/D103)',
      p_league_id, v_active_count, v_league.team_count
      USING ERRCODE = 'P0001';
  END IF;

  -- §22.5 caps, in-body (friendly refusals — §16.5.2 states). Counted
  -- across ALL leagues (per-user caps). The hourly count is over
  -- SURVIVING rows — recorded residual in the banner (F41 annotation).
  SELECT count(*) INTO v_active_mocks
  FROM public.drafts d
  WHERE d.is_mock
    AND d.status IN ('live', 'paused')
    AND d.config->'mock'->>'launched_by' = auth.uid()::text;
  IF v_active_mocks >= 3 THEN
    RAISE EXCEPTION
      'create_mock_draft: you already have 3 active mock drafts — finish or delete one first (§22.5)'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_hour_creates
  FROM public.drafts d
  WHERE d.is_mock
    AND d.config->'mock'->>'launched_by' = auth.uid()::text
    AND d.created_at > now() - interval '1 hour';
  IF v_hour_creates >= 5 THEN
    RAISE EXCEPTION
      'create_mock_draft: mock-draft creation is limited to 5 per hour — try again in a bit (§22.5)'
      USING ERRCODE = 'P0001';
  END IF;

  -- Seat resolution: default = the launcher's own franchise (§8.8 "their
  -- real seat by default"); ANY active seat selectable (placeholder or
  -- another member's franchise — authorization is launcher-keyed, D103).
  IF p_human_team_id IS NULL THEN
    SELECT m.team_id INTO v_human
    FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid();
    IF v_human IS NULL THEN
      RAISE EXCEPTION
        'create_mock_draft: pick a seat to practice from — you have no franchise in this league'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT t.id INTO v_human
    FROM public.teams t
    WHERE t.id = p_human_team_id
      AND t.league_id = p_league_id
      AND t.status <> 'retired';
    IF v_human IS NULL THEN
      RAISE EXCEPTION
        'create_mock_draft: team % is not an active franchise of league %',
        p_human_team_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- D91: rounds = starters + bench (IR excluded) — the same fn the real
  -- start uses.
  v_total_rounds := public.draft_rounds_from_roster(v_league.roster_settings);
  IF v_total_rounds IS NULL OR v_total_rounds < 1 THEN
    RAISE EXCEPTION
      'create_mock_draft: league % roster settings produce no draftable rounds (rounds = starters + bench, D91) — fix the roster in League settings',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Order snapshot (§8.8 "order incl. their actual slot"): the real
  -- scheduled draft row's stored order is the candidate (the order the
  -- lobby shows — D101); resolution via the ONE implementation (066's
  -- draft_resolve_order_internal), seeded by the MOCK's own id so a
  -- never-randomized `random` league gets a fresh deterministic shuffle
  -- per mock (banner item 1).
  SELECT d.draft_order, d.nomination_order INTO v_real_order, v_real_nom
  FROM public.drafts d
  WHERE d.league_id = p_league_id
    AND d.is_mock = FALSE
    AND d.status IN ('scheduled', 'live', 'paused');

  v_mock_id := gen_random_uuid();
  v_order := public.draft_resolve_order_internal(
    p_league_id,
    v_league.team_count,
    COALESCE(v_config->>'draft_order_mode', 'random'),
    v_real_order,
    v_config->'draft_order',
    v_mock_id,
    'create_mock_draft');

  -- 089: nomination order (§8.3/§7.3.8) — auction only, through 084's ONE
  -- implementation with the rules draft_start applies: same_as_draft_order
  -- copies the resolved draft order; random = the D105 shuffle seeded by
  -- the MOCK's own id (derived, so it is not a carbon copy of a random
  -- draft order — 084 banner item 2); manual = the real scheduled draft's
  -- stored nomination order, validated as a permutation. Snake/linear leave
  -- the column NULL.
  IF v_type = 'auction' THEN
    v_nom_order := public.draft_nomination_order_internal(
      p_league_id,
      v_league.team_count,
      COALESCE(v_config->>'nomination_order_mode', 'same_as_draft_order'),
      v_real_nom,
      v_order,
      v_mock_id,
      'create_mock_draft');
  END IF;

  -- Clock + first seat, per draft type (084's shape). An auction's first
  -- clock is the NOMINATION clock (§7.3.8's own catalog field) and is never
  -- NULL — an untimed pick_timer_seconds = 0 (§8.2's soft timer) is the
  -- snake clock's and does not touch it (084 banner item 3(c), mirrored).
  IF v_type = 'auction' THEN
    v_deadline := now() + make_interval(
      secs => COALESCE((v_config->>'auction_nomination_seconds')::int, 30));
    v_first    := (v_nom_order->>0)::uuid;        -- the first NOMINATOR (D126)
  ELSE
    v_timer    := COALESCE((v_config->>'pick_timer_seconds')::int, 90);
    v_deadline := CASE WHEN v_timer > 0
                       THEN now() + make_interval(secs => v_timer)
                       ELSE NULL END;             -- §8.2 soft timer: 0 ⇒ no clock
    v_first    := public.draft_team_for_pick(
      v_order, v_type,
      COALESCE((v_config->>'snake_reversal')::boolean, FALSE), 1);
  END IF;

  -- config.mock = {human_team_id, cpu_speed, launched_by} (§8.8 +
  -- D103(2)'s launched_by — erratum v2.8.16). Values stored as text
  -- (jsonb strings); every reader compares as TEXT (the R117 rule).
  -- action_id (the E2 replay ledger — R149) is stamped ONLY when the
  -- route sent one: the NULL path stores no key at all (pinned).
  v_config := jsonb_set(v_config, '{mock}', jsonb_build_object(
    'human_team_id', v_human::text,
    'cpu_speed', p_cpu_speed,
    'launched_by', auth.uid()::text)
    || CASE WHEN p_action_id IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('action_id', p_action_id::text) END);

  -- Starts immediately (§8.8): live, pick 1 (= nomination sequence 1 for an
  -- auction — D126) on the clock; `current_nomination` NULL ⇒ the
  -- NOMINATING phase; `budget_adjustments` is the column default '{}' (a
  -- mock has no commissioner to adjust anything — D110(1)/D138). The D95
  -- partial unique ignores mocks — the league's real scheduled draft
  -- coexists (E60).
  INSERT INTO public.drafts
    (id, league_id, draft_type, status, is_mock, config, draft_order,
     nomination_order, current_nomination,
     total_rounds, current_round, current_pick_number, on_clock_team_id,
     current_deadline, started_at)
  VALUES
    (v_mock_id, p_league_id,
     v_type,
     'live', TRUE, v_config, v_order,
     v_nom_order, NULL,
     v_total_rounds, 1, 1,
     v_first,
     v_deadline,
     now())
  RETURNING * INTO v_draft;

  -- 089: the §8.6.8 start-time backstop, mirrored from 084 (banner item 4)
  -- — read through the ONE derivation family on the LIVE mock row. A mock
  -- carries no budget_adjustments, so the only reachable cause is the
  -- settings knobs, and the message names them and the UNIT (D91 draftable
  -- slots — R318). A league that cannot START an auction cannot PRACTICE
  -- one either: "Same engine, literally" (§8.8). The RAISE rolls the INSERT
  -- back.
  IF v_type = 'auction' AND NOT public.draft_auction_solvent(v_mock_id) THEN
    v_budget  := COALESCE((v_config->>'auction_budget')::int, 200);
    -- 092/AP.1: the reserve, through the ONE authority (D198(1)).
    v_reserve := public.draft_auction_reserve(v_config);
    RAISE EXCEPTION
      'create_mock_draft: league % cannot practice an auction — a $% budget cannot fill % draftable roster spots at a $% per-slot reserve (§8.6.8 solvency); raise the auction budget, or allow $0 nominations in League settings → Draft setup',
      p_league_id, v_budget, v_total_rounds, v_reserve
      USING ERRCODE = 'P0001';
  END IF;

  -- Launch is the launcher's first liveness beat (banner item 1): the E59
  -- stale clock starts honest even if the room never mounts, and the
  -- expiry idle definition always has a beat to read.
  INSERT INTO public.draft_liveness (draft_id, user_id, last_seen_at)
  VALUES (v_mock_id, auth.uid(), now())
  ON CONFLICT (draft_id, user_id) DO UPDATE SET last_seen_at = now();

  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'created', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION create_mock_draft(UUID, UUID, TEXT, UUID)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 2. THE BACKFILL (D38). Every mock that already exists gets the snapshot it
--    should have had at launch, taken from its OWN league. This is the
--    honest value: until this migration the readers were using the league's
--    CURRENT shape, so the current shape IS what those drafts have been
--    running on, and copying it now changes nothing about them today while
--    freezing them from tomorrow. Idempotent, and `is_mock = FALSE` rows are
--    untouched (tasks-MP §4 rule 11).
-- ---------------------------------------------------------------------------
UPDATE public.drafts d
SET config = jsonb_set(d.config, '{roster}',
                       COALESCE(l.roster_settings, '{}'::jsonb))
FROM public.leagues l
WHERE l.id = d.league_id
  AND d.is_mock
  AND d.config->'roster' IS NULL;

-- R491 — AND THE BACKFILL PROVES ITSELF RATHER THAN ENDING QUIETLY. An
-- UPDATE that matches zero rows is exactly the shape CLAUDE.md's "never let
-- 'nothing happened' mean 'it worked'" rule is about: today `league_id` is
-- NOT NULL with a live FK, so every mock has a league to copy from and the
-- coverage is total — but that is a fact about TODAY's schema, and MP.3
-- drops the NOT NULL. If a mock ever escapes the join, this migration must
-- refuse to land rather than ship the readers' guard as the thing that
-- discovers it.
DO $$
DECLARE
  v_unsnapshotted INTEGER;
BEGIN
  SELECT count(*) INTO v_unsnapshotted
  FROM public.drafts d
  WHERE d.is_mock AND NOT (d.config ? 'roster');
  IF v_unsnapshotted > 0 THEN
    RAISE EXCEPTION
      '094 §2: % mock draft(s) still carry no roster snapshot after the backfill — the UPDATE''s join did not reach them (MP.2/094, R491)',
      v_unsnapshotted;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. draft_autopick_resolve — REPLACED FROM
--    086_auction_tick_completion.sql:552-749 (D137 head rule; 068 -> 086, and
--    086 is the head — its body diffs byte-identical against the deployed
--    `pg_get_functiondef`, re-verified this session and previously by F110).
--    **TWO hunks, and they are one change**: the league SELECT moves into the
--    non-mock arm, and the slot read branches on `is_mock`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_autopick_resolve(
  p_draft_id UUID,
  p_team_id UUID
) RETURNS TEXT
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_draft    public.drafts;
  v_league   public.leagues;
  v_user     UUID;
  v_slots    JSONB;
  v_n_slots  INTEGER;
  v_counts   INTEGER[] := '{}';
  v_filled   INTEGER[] := '{}';
  v_have     JSONB := '{}';         -- normalized position -> count on team
  v_picks    INTEGER := 0;
  v_unfilled INTEGER := 0;
  v_remaining INTEGER;
  v_forced   BOOLEAN;
  v_need     TEXT[] := '{}';        -- positions accepted by unfilled slots
  v_i        INTEGER;
  v_placed   BOOLEAN;
  v_row      RECORD;
  v_ok       BOOLEAN;
  v_floor    TEXT;
BEGIN
  SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- The seat's user (NULL row or NULL user_id = no-user seat — E48).
  -- MOCK-AWARE (L.B1.6/071 — amended in place, F12; D93/D103): in a mock,
  -- the HUMAN seat resolves under the LAUNCHER's queue/boards — the
  -- launcher is the one practicing, and the chosen seat may be a
  -- placeholder or another member's franchise — while every CPU seat
  -- resolves as a NO-USER seat (ADP + need, §8.8's bot behavior per D93:
  -- a CPU seat must NEVER read its real owner's queue/boards — pinned in
  -- 025). launched_by is RPC-written (auth.uid()::text) so the cast is
  -- safe; a hand-crafted garbage value raises and is contained by the
  -- tick's per-draft subtransaction.
  IF v_draft.is_mock THEN
    IF v_draft.config->'mock'->>'human_team_id' = p_team_id::text THEN
      v_user := (v_draft.config->'mock'->>'launched_by')::uuid;
    ELSE
      v_user := NULL;
    END IF;
  ELSE
    SELECT m.user_id INTO v_user
    FROM public.league_members m
    WHERE m.league_id = v_draft.league_id AND m.team_id = p_team_id;
  END IF;

  -- Greedy model steps a–c (banner): capacities, then assign existing
  -- picks in pick order.
  -- 094/MP.2 — HUNK 2 of 2, and the pair is one change: 086's
  -- `SELECT l.* INTO v_league` (which stood immediately after the drafts
  -- read, hunk 1) moves INTO the non-mock arm below, because on a mock the
  -- league is no longer read at all.
  --   * A MOCK reads its OWN snapshot. `create_mock_draft` stores it at
  --     launch (094 §1) and 094 §2 backfilled every mock that predates this
  --     migration, so there is no legacy row without one and NO league
  --     fallback is written here — a fallback would re-open exactly the
  --     re-hydration D95 forbids, and would keep a league read on a mock's
  --     path that MP.2 exists to remove.
  --   * A REAL draft is UNCHANGED — same live read, same source, byte-for-
  --     byte the same behaviour (tasks-MP §4 rule 11). Snapshot-at-start for
  --     real drafts is a bigger question than this task (a real league's
  --     settings edits go through the D141 pause-first commissioner
  --     controls); it is deliberately NOT decided here.
  IF v_draft.is_mock THEN
    -- R491 — ASSERT THE REASON FOR EMPTINESS, NEVER INFER IT (CLAUDE.md).
    -- The COALESCE below cannot tell "this mock was never snapshotted" from
    -- "this roster legitimately has no starting slots" (an all-bench roster
    -- is legal), and the first of those collapses every need term to the
    -- SAME value — the exact failure this migration exists to eliminate,
    -- arriving silently. Unreachable today (§1 writes the key at launch, §2
    -- backfills every existing mock and then PROVES none is left), but MP.3
    -- makes `league_id` nullable and MP.4 adds a settings writer, so the
    -- guard must exist BEFORE the reachability does. Keyed on KEY ABSENCE,
    -- not on an empty array.
    IF NOT (v_draft.config ? 'roster') THEN
      RAISE EXCEPTION
        'draft_autopick_resolve: mock draft % carries no roster snapshot (config->''roster'') — refusing to price an unsnapshotted mock as if every seat were filled (MP.2/094, R491)',
        p_draft_id
        USING ERRCODE = 'P0001';
    END IF;
    v_slots := COALESCE(v_draft.config->'roster'->'starting_slots', '[]'::jsonb);
  ELSE
    SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_draft.league_id;
    v_slots := COALESCE(v_league.roster_settings->'starting_slots', '[]'::jsonb);
  END IF;
  v_n_slots := COALESCE(jsonb_array_length(v_slots), 0);
  FOR v_i IN 1..v_n_slots LOOP
    v_counts[v_i] := COALESCE((v_slots->(v_i - 1)->>'count')::int, 0);
    v_filled[v_i] := 0;
  END LOOP;

  FOR v_row IN
    SELECT CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END AS pos
    FROM public.draft_picks p
    JOIN public.players pl ON pl.id = p.player_id
    WHERE p.draft_id = p_draft_id AND p.team_id = p_team_id
      AND p.is_undone = FALSE
    ORDER BY p.pick_number
  LOOP
    v_picks := v_picks + 1;
    v_have := jsonb_set(v_have, ARRAY[v_row.pos],
                        to_jsonb(COALESCE((v_have->>v_row.pos)::int, 0) + 1));
    v_placed := FALSE;
    FOR v_i IN 1..v_n_slots LOOP
      IF NOT v_placed
         AND v_filled[v_i] < v_counts[v_i]
         AND (v_slots->(v_i - 1)->'eligible') ? v_row.pos THEN
        v_filled[v_i] := v_filled[v_i] + 1;
        v_placed := TRUE;
      END IF;
    END LOOP;
    -- not placed => bench (implicit)
  END LOOP;

  FOR v_i IN 1..v_n_slots LOOP
    IF v_filled[v_i] < v_counts[v_i] THEN
      v_unfilled := v_unfilled + (v_counts[v_i] - v_filled[v_i]);
      v_need := v_need || ARRAY(
        SELECT jsonb_array_elements_text(v_slots->(v_i - 1)->'eligible'));
    END IF;
  END LOOP;

  v_remaining := COALESCE(v_draft.total_rounds, 0) - v_picks;
  v_forced := v_remaining <= v_unfilled;   -- greedy step d

  -- Source-priority enumeration (banner item 4). Each branch is gated so a
  -- no-user seat (v_user NULL) resolves straight to ADP; the queue branch
  -- carries the R120 team -> draft-league join.
  FOR v_row IN
    SELECT c.player_id, c.pos
    FROM (
      SELECT 1 AS src,
             row_number() OVER (ORDER BY q.rank, q.player_id) AS ord,
             q.player_id,
             CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END AS pos
      FROM public.draft_queues q
      JOIN public.teams t
        ON t.id = q.team_id AND t.league_id = v_draft.league_id   -- R120
      JOIN public.players pl ON pl.id = q.player_id
      WHERE v_user IS NOT NULL
        AND q.draft_id = p_draft_id AND q.team_id = p_team_id
      UNION ALL
      SELECT 2,
             row_number() OVER (ORDER BY lp.position, lp.player_id),
             lp.player_id,
             CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END
      FROM public.league_lists ll
      JOIN public.lists ls ON ls.id = ll.list_id AND ls.deleted_at IS NULL
      JOIN public.list_players lp ON lp.list_id = ll.list_id
      JOIN public.players pl ON pl.id = lp.player_id
      WHERE v_user IS NOT NULL
        AND ll.league_id = v_draft.league_id
        AND ll.owner_id = v_user
        AND ll.is_primary_board = TRUE
      UNION ALL
      SELECT 3,
             row_number() OVER (ORDER BY lp.position, lp.player_id),
             lp.player_id,
             CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END
      FROM public.lists b
      JOIN public.list_players lp ON lp.list_id = b.id
      JOIN public.players pl ON pl.id = lp.player_id
      WHERE v_user IS NOT NULL
        AND b.owner_id = v_user AND b.is_big_board = TRUE
        AND b.deleted_at IS NULL
      UNION ALL
      SELECT 4,
             row_number() OVER (ORDER BY pl.adp NULLS LAST, pl.id),
             pl.id,
             CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END
      FROM public.players pl
    ) c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.draft_picks dp
      WHERE dp.draft_id = p_draft_id AND dp.player_id = c.player_id
        AND dp.is_undone = FALSE
    )
    ORDER BY c.src, c.ord
  LOOP
    IF v_forced THEN
      -- Greedy step d: every remaining pick must fill a required seat
      -- (E30's "until forced" arm rides need membership).
      v_ok := v_row.pos = ANY(v_need);
    ELSE
      -- Greedy steps e–g: E30 deferral + the 3rd-QB useful cap (caps lift
      -- when no starting seat is unfilled).
      -- 086/L.C1.4 — THE ONE HUNK: the E30 round-window escape is
      -- SNAKE/LINEAR's. D129(2) rules that an auction's K/DST deferral maps
      -- to the FORCED-ONLY arm below: there are no rounds in an auction, and
      -- `current_round` there is the display-only ROTATION LAP (D126), so
      -- inheriting the window would let a lap counter unlock kickers. K/DST
      -- therefore stay ineligible in OPEN mode for the whole auction and
      -- become eligible exactly when FORCED mode engages with a K/DST seat
      -- unfilled (pinned one unit short both ways, 035 §G).
      v_ok := (v_row.pos NOT IN ('K', 'DST')
               OR (v_draft.draft_type <> 'auction'
                   AND v_draft.current_round > v_draft.total_rounds - 3))
          AND (v_unfilled = 0
               OR COALESCE((v_have->>v_row.pos)::int, 0) <
                  (SELECT COALESCE(SUM((s->>'count')::int), 0)
                   FROM jsonb_array_elements(v_slots) s
                   WHERE s->'eligible' ? v_row.pos) + 1);
    END IF;
    IF v_ok THEN
      RETURN v_row.player_id;
    END IF;
  END LOOP;

  -- Greedy step h — the FLOOR: never stall the draft (§22.3). Lowest-ADP
  -- available with NO filters; NULL only when the pool is exhausted.
  SELECT pl.id INTO v_floor
  FROM public.players pl
  WHERE NOT EXISTS (
    SELECT 1 FROM public.draft_picks dp
    WHERE dp.draft_id = p_draft_id AND dp.player_id = pl.id
      AND dp.is_undone = FALSE
  )
  ORDER BY pl.adp NULLS LAST, pl.id
  LIMIT 1;
  RETURN v_floor;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_autopick_resolve(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. draft_mock_cpu_need — REPLACED FROM 089_mock_auctions.sql:394-497 (D137
--    head rule; 089 is the ONLY definition — 091 replaced its sibling
--    `draft_mock_cpu_bid_value` at 091:271, not this one). **ONE hunk**: the
--    `JOIN public.leagues` is deleted and the shape comes from `d.config`.
--    STABLE, `search_path=''`, INVOKER, no grants — 038:145 pins that shape
--    and it is preserved exactly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_mock_cpu_need(
  p_draft_id UUID,
  p_team_id UUID,
  p_player_id TEXT
) RETURNS NUMERIC
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
DECLARE
  v_pos       TEXT;
  v_config    JSONB;                -- 094/R491: the draft's own config
  v_is_mock   BOOLEAN;              -- 094/R491: NULL when no draft row exists
  v_slots     JSONB;
  v_n_slots   INTEGER;
  v_counts    INTEGER[] := '{}';
  v_filled    INTEGER[] := '{}';
  v_total     INTEGER;
  v_picks     INTEGER := 0;
  v_unfilled  INTEGER := 0;
  v_need      TEXT[] := '{}';      -- positions accepted by unfilled seats
  v_starters  INTEGER;
  v_have      INTEGER := 0;
  v_i         INTEGER;
  v_placed    BOOLEAN;
  v_row       RECORD;
BEGIN
  SELECT CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END
    INTO v_pos
  FROM public.players pl WHERE pl.id = p_player_id;
  IF v_pos IS NULL THEN
    RETURN 0;
  END IF;
  IF v_pos IN ('K', 'DST') THEN
    RETURN 0;
  END IF;

  -- 094/MP.2 — THE ONE HUNK, and it deletes the JOIN rather than defending
  -- against it. This is the MOCK CPU's own need function: every caller is a
  -- mock arm (089:2322, superseded by 091:516), so there is no non-mock
  -- column to keep. The snapshot is written at launch (094 §1) and
  -- backfilled for every pre-094 mock (094 §2). With the JOIN gone the
  -- function names no league at all, which is the assertion MP.2 pins:
  -- `prosrc !~ 'public\.leagues'`.
  SELECT d.config, d.is_mock, COALESCE(d.total_rounds, 0)
    INTO v_config, v_is_mock, v_total
  FROM public.drafts d
  WHERE d.id = p_draft_id;
  -- R491, the sibling guard. Same argument as draft_autopick_resolve's, and
  -- this is the WORSE of the two sites: an unsnapshotted mock prices every
  -- position identically and the bots go on bidding, so nothing anywhere
  -- reports a fault. Predicated on `v_is_mock` so an ABSENT draft row keeps
  -- 089's behaviour exactly (v_is_mock NULL ⇒ no raise ⇒ the empty-slot
  -- path), which is what makes this additive rather than a signature change
  -- in disguise.
  IF v_is_mock AND NOT (v_config ? 'roster') THEN
    RAISE EXCEPTION
      'draft_mock_cpu_need: mock draft % carries no roster snapshot (config->''roster'') — refusing to price every position identically and call it a need model (MP.2/094, R491)',
      p_draft_id
      USING ERRCODE = 'P0001';
  END IF;
  v_slots   := COALESCE(v_config->'roster'->'starting_slots', '[]'::jsonb);
  v_n_slots := COALESCE(jsonb_array_length(v_slots), 0);

  -- 086's greedy steps a–c, verbatim in shape: capacities, then the team's
  -- picks placed in pick order into the first starting seat that accepts
  -- them; an unplaced pick sits on the bench.
  FOR v_i IN 1..v_n_slots LOOP
    v_counts[v_i] := COALESCE((v_slots->(v_i - 1)->>'count')::int, 0);
    v_filled[v_i] := 0;
  END LOOP;
  FOR v_row IN
    SELECT CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END AS pos
    FROM public.draft_picks p
    JOIN public.players pl ON pl.id = p.player_id
    WHERE p.draft_id = p_draft_id
      AND p.team_id = p_team_id
      AND p.is_undone = FALSE
    ORDER BY p.pick_number
  LOOP
    v_picks := v_picks + 1;
    IF v_row.pos = v_pos THEN
      v_have := v_have + 1;
    END IF;
    v_placed := FALSE;
    FOR v_i IN 1..v_n_slots LOOP
      IF NOT v_placed
         AND v_filled[v_i] < v_counts[v_i]
         AND (v_slots->(v_i - 1)->'eligible') ? v_row.pos THEN
        v_filled[v_i] := v_filled[v_i] + 1;
        v_placed := TRUE;
      END IF;
    END LOOP;
  END LOOP;
  FOR v_i IN 1..v_n_slots LOOP
    IF v_filled[v_i] < v_counts[v_i] THEN
      v_unfilled := v_unfilled + (v_counts[v_i] - v_filled[v_i]);
      v_need := v_need || ARRAY(
        SELECT jsonb_array_elements_text(v_slots->(v_i - 1)->'eligible'));
    END IF;
  END LOOP;

  -- 086's greedy step d — THE forced rule (R406 / D163): once the picks
  -- left equal the holes, only a hole-filler is worth anything.
  IF (v_total - v_picks) <= v_unfilled THEN
    IF v_pos = ANY(v_need) THEN
      RETURN 1.0;
    END IF;
    RETURN 0;
  END IF;

  -- OPEN mode: the S+1 weights.
  SELECT COALESCE(SUM((s->>'count')::int), 0) INTO v_starters
  FROM jsonb_array_elements(v_slots) s
  WHERE s->'eligible' ? v_pos;

  IF v_have < v_starters THEN
    RETURN 1.0;
  ELSIF v_have < v_starters + 1 THEN
    RETURN 0.5;
  ELSE
    RETURN 0;
  END IF;
END;
$$;
