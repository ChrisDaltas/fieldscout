-- ============================================================================
-- 218 — the 60+ yard field goal and the D/ST two-point return start paying
--       (PROGRESS F871, D835; F870 / F871 design PR 4; spec v2.16.115,
--       §7.3.3 / §7.3.3.1 / App B.4 / §23.5). The second of the two database
--       updates; 217 added the columns.
-- ============================================================================
--
-- THE RULINGS (Chris, verbatim, in the owner's session):
--   2026-11-05, on the questions asked 2026-11-04 (PROGRESS F870, F871):
--     "go on league kickers and the other plays"
--   2026-11-05 ~18:50Z, answering numbered questions: "2. yes. 3. 2 4. huh? 5. sure."
--     Q2 as asked: "In a Scout-rules league, does a D/ST two-point return pay
--     2? I recommend no." — "yes". Read literally (the owner's session
--     restated it to Chris; it stands until corrected): Scout documents pay
--     def_2pt_return 2. This amends the design, which left Scout untouched.
--     Q1 (do Weeks 1-8 of an ESPN-rules league get the two plays?) is
--     unanswered and moot — production has no ESPN-rules league — so Chris's
--     own Q64 words stand: "The new rule applies to this week and later.
--     Finished weeks keep their original scores and results."
--   2026-11-06, told the piece is "the extra point for a 60+ yard field goal
--   and a D/ST two-point return ... two database updates": "Okay, go do it."
--   Standing: match standard platforms (ESPN's defaults pay a 60+ field goal
--   6 and a D/ST two-point return 2, Q9's verified record).
--
-- WHAT, in order ((a) before (c): the template walls validate):
--   (a) scoring_rules_validate — 195:50-727's FILE TEXT (the chain's head:
--       103, 195; 212 only calls it), 4 hunks (+8 / -4): `c_scorable` gains
--       both keys, `c_kicking` gains `fg_60_plus`, `c_dst_events` gains
--       `def_2pt_return`, and the count comment. So an override of either is
--       legal on its own page only (K, D/ST) and refused on any other (§7.3.3.1
--       guardrail 3). Plain, IMMUTABLE, search_path '', REVOKEd as at the head.
--   (b) stat_key_label_internal — 195:729-782's FILE TEXT (head: 172, 195),
--       2 hunks (+2): 'FG made (60+)', 'two-point return (D/ST)' (the registry
--       labels in sentence case; stat-correction-labels.test.ts reads THIS
--       file). Plain, IMMUTABLE, search_path '', REVOKEd as at the head.
--   (c) The template rows (`is_template`, owner-less): ESPN Standard and
--       ESPN Full PPR gain {"fg_60_plus": 1, "def_2pt_return": 2} and a new
--       description (Q9's named-exception note: the 60+ and PAT-return
--       exceptions close, PAT-safety stays — the words are templates.ts's
--       `ESPN_PARITY_EXCEPTION_NOTE`); Scout Standard and Scout PPR gain
--       {"def_2pt_return": 2} only (Q2) — no `fg_60_plus`: Scout pays every
--       field goal a flat 3 — and keep their descriptions (neither lists D/ST
--       plays). Yahoo and Sleeper rows: byte-unchanged. templates-db.test.ts
--       deep-equals all eight against templates.ts.
--   (d) long_fg_two_point_rules_add_internal(), run once below and NOTICEd
--       (160's shape: a plain helper, search_path '', REVOKEd, kept so pgTAP
--       170 can drive it on fixtures). REACH: leagues with deleted_at NULL
--       (212: archived = deleted_at set; its row guard would abort the file on
--       an archived league — they are named, untouched), status IN
--       ('drafting', 'in_season', 'playoffs') and season 2026. In each it
--       may rewrite three kinds of document, each tested ON ITS OWN (its own
--       value and its own scoring_system_id — a league that switched rules
--       with re-score off has a live week on the old rules):
--         * leagues.scoring_rules_snapshot — the rules every week from the
--           next one to open takes (144: an `upcoming` week holds NO rules —
--           a CHECK — and is stamped from this column when it goes live, so
--           every week after the live one pays the new keys through it);
--         * the `live` league_weeks row's snapshot — the guard (144:314)
--           allows live → live; scoring_rules_source / _action_id stay;
--         * the league's fork row (`scoring_systems`, not a template), unless
--           a league outside the reach also references it.
--       A `correction_window` or `final` week is NEVER touched: its rules are
--       the rules it was played with (Q64 / Q69), 216's digest and close pass
--       read non-final weeks, and a changed one would re-score a finished week
--       under the new rule (R1794(c)). pgTAP 170 pins it.
--       DESCENT of a document: its scoring_system_id is the ESPN Standard /
--       ESPN Full PPR (or Scout Standard / Scout PPR) template; or a fork
--       whose newest `fork_scoring` receipt (169) names one; or a fork with
--       no receipt (made before 169) whose effective kicking block is ESPN's
--       by value (3 / 4 / 5 / 1 / -1, no PAT miss) — or, failing that, whose
--       effective D/ST block (events + points-allowed + yards-allowed) is
--       Scout's by value. Yahoo- and Sleeper-descended documents, their
--       forks, and anything matching neither: byte-untouched, named.
--       WHAT IS ADDED — only ABSENT keys, never an existing value (absent =
--       nowhere in the flat map, or in `base` or any `positions` map):
--         ESPN descent: def_2pt_return 2; fg_60_plus 1 only where the
--           document's effective K fg_50_plus is 5 (a commissioner who set
--           another value chose what a long kick pays; it keeps paying that).
--         Scout descent: def_2pt_return 2 only.
--       Format 1 gains the keys in the flat map, format 2 in `base`.
--       THE RECORD: one league_chat system post per league whose snapshot or
--       live week changed, in plain words, naming the week the rule starts:
--       the live week when it took the same keys, else the next week to go
--       live (a drafting league with no week rows: Week 1):
--         "Scoring update from Week N on: a field goal of 60+ yards pays 1
--          more point (6 in all), and a D/ST two-point return pays 2, matching
--          ESPN. Finished weeks keep their scoring."
--         "Scoring update from Week N on: a D/ST two-point return pays 2
--          points. Finished weeks keep their scoring."
--       NO commissioner_actions row: a migration has no actor (160's
--       precedent; spec :199 calls this shape a system act). The migration,
--       its NOTICE and the post are the record. 160 wrote no post; this one
--       does, because members' scoring changes mid-season.
--   (e) Inside (d): the live week's lines holding either new stat are
--       re-queued (score_fanout, 149:2599's shape: min(player_stats.updated_at),
--       ON CONFLICT DO NOTHING), so a play scored before the push is re-scored
--       under the new rules. Back-dated `enqueued_at` counts at once in
--       `queue_undrained` (124), as 149's does — only if such a line exists.
--
-- PRODUCTION (read by the owner's session 2026-11-06, read-only): one live
-- league, season 2026, in_season, on the Scout Standard template; Week 9
-- live. At the push it takes def_2pt_return 2 (snapshot + the live week if
-- one is live) and gets the Scout post; no ESPN-rules league exists.
--
-- PUSH ORDER (R1794(b), PR 4's merge gate): 217 pushed and confirmed through
-- PostgREST → THIS PR merges → the deployed SHA is confirmed (the app's rules
-- validator must read the two keys BEFORE any snapshot holds them: after
-- 216, a week whose frozen rules the validator can't read is HELD) → Chris
-- pushes 218 at once. If 218 lands while Week 9 is live, Week 9 takes the
-- rule; if not, Week 10 does (the post names it). db-drift.yml reads red
-- between the merge and the push: expected.
--
-- CHECKLIST (tasks-M* §4.4). Two bodies replaced, signatures, volatility and
-- search_path unchanged, REVOKEs restated as at the head (validator: PUBLIC,
-- anon; labels: PUBLIC, anon, authenticated). Two new PLAIN helpers
-- (search_path '', REVOKEd from PUBLIC, anon, authenticated; called here and
-- by pgTAP 170 only, never by the app); the writer takes its league rows
-- FOR UPDATE first (rule 8) and asserts every UPDATE touched exactly the row
-- it chose. No table, column, policy, grant, trigger, index or cron row; no
-- DEFINER. Rows written: 4 template rows; per reached league its snapshot,
-- live week and fork row; one league_chat line; score_fanout rows. RLS
-- unchanged on all of them. Typegen: the two helpers join `Functions`
-- (additive; alias block untouched). R6 waiver: no staging clone; rehearsal
-- = a fresh local `db reset` 001-218, `migration up` 217 → 218 over
-- fixtures, and the full pgTAP run (D835). pgTAP 170 (extended), with 011,
-- 012, 013, 051, 143 moved where they pin the key sets, labels or rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (a) scoring_rules_validate — 195_player_info_c.sql:50-727 FILE TEXT (D137),
--     4 hunks (+8 / -4): the two keys join c_scorable, c_kicking and
--     c_dst_events, and the count comment moves.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scoring_rules_validate(p_rules JSONB)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  -- ── The registry, transcribed (§23.5 v2.11's `scoring_surface`) ──────────
  -- The 30 non-tier scorable keys, then the 20 tier keys the three published
  -- cut lists generate. Proved ≡ TS's `SCORABLE_KEYS` over all 68 registry
  -- entries by the parity suite, and the tier half is proved ≡ the generator's
  -- own output in pgTAP 051 §B — two independent checks on one transcription.
  c_scorable CONSTANT TEXT[] := ARRAY[
    'pass_yards', 'pass_tds', 'interceptions', 'pass_2pt', 'qb_sack_taken',
    'rush_yards', 'rush_tds', 'rush_2pt',
    'receptions', 'receiving_yards', 'receiving_tds', 'rec_2pt',
    'return_td', 'fumbles_lost', 'fumble_recovery_td',
    'fg_0_39', 'fg_40_49', 'fg_50_plus', 'pat_made', 'fg_missed', 'pat_missed',
    'def_sack', 'def_int', 'def_fumble_rec', 'def_td', 'def_safety',
    'def_block', 'def_return_td',
    -- 218 / F871: the 60+ make's top-up (K) and the D/ST two-point return.
    'fg_60_plus', 'def_2pt_return',
    'def_pa_0', 'def_pa_1_6', 'def_pa_7_13', 'def_pa_14_20', 'def_pa_21_27',
    'def_pa_28_34', 'def_pa_35_plus',
    'def_pa_14_17', 'def_pa_18_27', 'def_pa_35_45', 'def_pa_46_plus',
    'def_ya_0_99', 'def_ya_100_199', 'def_ya_200_299', 'def_ya_300_349',
    'def_ya_350_399', 'def_ya_400_449', 'def_ya_450_499', 'def_ya_500_549',
    'def_ya_550_plus'
  ];
  -- Why a key is refused: a raw source reads differently from a reserved
  -- bonus, and the commissioner deserves the difference (TS `SURFACE_BY_KEY`).
  c_context CONSTANT TEXT[] := ARRAY[
    'pass_attempts', 'pass_completions', 'rush_attempts', 'targets',
    'fg_made', 'fg_attempted', 'pat_attempted',
    'def_points_allowed', 'def_yards_allowed',
    -- 195 / F578: the usage keys (player view only, never paid).
    'off_snaps', 'pass_rz_att', 'rush_rz_att', 'rec_rz_tgt', 'fg_long'
  ];
  c_reserved CONSTANT TEXT[] := ARRAY[
    'pass_300_bonus', 'rush_100_bonus',
    'example_tracking_yards', 'example_charted_yards'
  ];

  -- ── §7.3.3.1's section catalog, grouped by position (guardrail 3's law;
  --    the SQL mirror of `POSITION_SCORABLE_KEYS`) ──────────────────────────
  c_positions CONSTANT TEXT[] := ARRAY['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
  c_offense CONSTANT TEXT[] := ARRAY[
    'pass_yards', 'pass_tds', 'pass_2pt', 'qb_sack_taken',
    'rush_yards', 'rush_tds', 'rush_2pt',
    'receptions', 'receiving_yards', 'receiving_tds', 'rec_2pt',
    'return_td',
    'interceptions', 'fumbles_lost', 'fumble_recovery_td'
  ];
  c_kicking CONSTANT TEXT[] := ARRAY[
    'fg_0_39', 'fg_40_49', 'fg_50_plus', 'pat_made', 'fg_missed', 'pat_missed',
    'fg_60_plus'      -- 218 / F871
  ];
  c_dst_events CONSTANT TEXT[] := ARRAY[
    'def_sack', 'def_int', 'def_fumble_rec', 'def_td', 'def_safety',
    'def_block', 'def_return_td',
    'def_2pt_return'  -- 218 / F871
  ];

  -- ── The published cut lists (§23.5(b); `tier-cuts.ts`'s three constants) ──
  c_shared_pa CONSTANT JSONB := '[0, 1, 7, 14, 21, 28, 35]'::JSONB;
  c_espn_pa   CONSTANT JSONB := '[0, 1, 7, 14, 18, 28, 35, 46]'::JSONB;
  c_ya        CONSTANT JSONB := '[0, 100, 200, 300, 350, 400, 450, 500, 550]'::JSONB;

  c_envelope CONSTANT TEXT[] := ARRAY['format', 'base', 'positions', 'tier_cuts'];
  c_tables   CONSTANT TEXT[] := ARRAY['def_pa', 'def_ya'];

  -- §7.3.3.1's per-field bounds bullet.
  c_max_abs   CONSTANT NUMERIC := 100;

  -- ── The one violation this call will raise (E75: family, path, reason) ───
  v_code TEXT;
  v_path TEXT;
  v_msg  TEXT;

  v_is_f2      BOOLEAN;
  v_base       JSONB;
  v_positions  JSONB;
  v_tier_cuts  JSONB;
  v_pa_cuts    JSONB;   -- NULL when the residuals refused it
  v_ya_cuts    JSONB;
  -- The residual violation, computed early (guardrail 2 needs the verdict) and
  -- raised last (§7.3.3.1(c) is the residual bullet, not one of the five).
  v_cut_path   TEXT;
  v_cut_msg    TEXT;

  v_key        TEXT;
  v_pos        TEXT;
  v_map        JSONB;
  v_val        JSONB;
  v_num        NUMERIC;
  v_prefix     TEXT;
  v_table      TEXT;
  v_legal      TEXT[];
  v_generated  TEXT[];
  v_strays     TEXT[];
  v_pa_keys    TEXT[];
  v_list       JSONB;
  v_n          INT;
  v_bad        INT;
  v_homes      INT;
  i            INT;
BEGIN
  <<checks>>
  LOOP

  -- ══ The front door ═══════════════════════════════════════════════════════
  IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'object' THEN
    v_code := 'document_shape'; v_path := NULL;
    v_msg := 'Document shape (§7.3.3.1): a scoring rules document must be a JSON object; got '
             || CASE WHEN p_rules IS NULL THEN 'nothing'
                     WHEN jsonb_typeof(p_rules) = 'null' THEN 'null'
                     WHEN jsonb_typeof(p_rules) = 'array' THEN 'an array'
                     ELSE 'a ' || jsonb_typeof(p_rules) END
             || '.';
    EXIT checks;
  END IF;

  v_is_f2 := p_rules ? 'format';

  -- ══ Format 1: the flat map ═══════════════════════════════════════════════
  IF NOT v_is_f2 THEN
    -- An envelope whose `format` member was dropped reads as a flat map whose
    -- keys happen to be "base"/"positions"/"tier_cuts" (R597). The document
    -- says what it is; the refusal should too.
    SELECT array_agg(k ORDER BY k) INTO v_strays
      FROM jsonb_object_keys(p_rules) k
     WHERE k <> 'format' AND k = ANY(c_envelope);
    IF v_strays IS NOT NULL THEN
      v_code := 'document_shape'; v_path := NULL;
      v_msg := 'Document shape (§7.3.3.1): this document carries no "format" member, so it reads as a flat format-1 map — but it holds '
               || array_to_string(v_strays, ', ')
               || ', which are format-2 envelope members. Add "format": 2, or make it a genuine flat map of coefficients.';
      EXIT checks;
    END IF;

    -- (1) Scorable allowlist. Path is the KEY ITSELF, not `base.<key>` — a
    --     flat map has no `base` member and SE.6's route surfaces these paths
    --     as form fields (D269(2)).
    FOR v_key IN SELECT k FROM jsonb_object_keys(p_rules) k LOOP
      IF NOT (v_key = ANY(c_scorable)) THEN
        v_code := 'scorable_allowlist'; v_path := v_key;
        v_msg := 'Scorable allowlist (§7.3.3.1 guardrail 1): "' || v_key
                 || '" cannot be scored — '
                 || CASE
                      WHEN v_key = ANY(c_context) THEN 'it is a context key — a raw source or an aggregate (§23.5), and paying it beside the keys derived from it is the double-count this guardrail exists to make inexpressible'
                      WHEN v_key = ANY(c_reserved) THEN 'it is a reserved key (§23.5) — deferred bonuses, placeholders and IDP are not exposed by the cohort editor'
                      ELSE 'it is not a canonical stat key at all (§23.5 STAT_KEYS)'
                    END
                 || '.';
        EXIT checks;
      END IF;
    END LOOP;

    -- (2) Tier exclusivity, format-1 arm.
    SELECT array_agg(k ORDER BY k) INTO v_pa_keys
      FROM jsonb_object_keys(p_rules) k WHERE starts_with(k, 'def_pa_');
    IF v_pa_keys IS NOT NULL THEN
      -- D269(3)'s RELAXED reading, exhaustively verified there and mirrored
      -- here verbatim: "some published family contains every def_pa_* key this
      -- document names". A document naming only the four SHARED key names is a
      -- subset of both families and cannot double-pay anything, so the literal
      -- "exactly one" reading would refuse it for nothing. Do not re-litigate.
      v_homes := 0;
      IF v_pa_keys <@ public.scoring_tier_keys_from_cuts('def_pa', c_shared_pa) THEN
        v_homes := v_homes + 1;
      END IF;
      IF v_pa_keys <@ public.scoring_tier_keys_from_cuts('def_pa', c_espn_pa) THEN
        v_homes := v_homes + 1;
      END IF;
      IF v_homes = 0 THEN
        v_code := 'tier_exclusivity'; v_path := NULL;
        v_msg := 'Tier exclusivity (§7.3.3.1 guardrail 2): the points-allowed keys ['
                 || array_to_string(v_pa_keys, ', ')
                 || '] are not all cut on one published family (shared (Yahoo/Sleeper) or ESPN). Mixing families double-pays every week that lands in the overlap — the F21 defect.';
        EXIT checks;
      END IF;
    END IF;

    SELECT array_agg(k ORDER BY k) INTO v_strays
      FROM jsonb_object_keys(p_rules) k
     WHERE starts_with(k, 'def_ya_')
       AND NOT (k = ANY(public.scoring_tier_keys_from_cuts('def_ya', c_ya)));
    IF v_strays IS NOT NULL THEN
      v_code := 'tier_exclusivity'; v_path := NULL;
      v_msg := 'Tier exclusivity (§7.3.3.1 guardrail 2): the yards-allowed keys ['
               || array_to_string(v_strays, ', ')
               || '] are not generated by the published yards-allowed cut list.';
      EXIT checks;
    END IF;

    -- (5) Bounds.
    FOR v_key IN SELECT k FROM jsonb_object_keys(p_rules) k LOOP
      v_val := p_rules -> v_key;
      IF jsonb_typeof(v_val) <> 'number' THEN
        v_code := 'bounds'; v_path := v_key;
        v_msg := 'Bounds (§7.3.3.1 guardrail 5): "' || v_key
                 || '" must be a finite number; got '
                 || CASE WHEN jsonb_typeof(v_val) = 'string' THEN v_val::TEXT
                         WHEN jsonb_typeof(v_val) = 'null' THEN 'null'
                         WHEN jsonb_typeof(v_val) = 'array' THEN 'an array'
                         ELSE 'a ' || jsonb_typeof(v_val) END
                 || '.';
        EXIT checks;
      END IF;
      v_num := (v_val #>> '{}')::NUMERIC;
      IF abs(v_num) > c_max_abs THEN
        v_code := 'bounds'; v_path := v_key;
        v_msg := 'Bounds (§7.3.3.1 guardrail 5): "' || v_key || '" is '
                 || (v_val #>> '{}') || '; a coefficient must satisfy |coef| ≤ 100.';
        EXIT checks;
      END IF;
      IF scale(trim_scale(v_num)) > 2 THEN
        v_code := 'bounds'; v_path := v_key;
        v_msg := 'Bounds (§7.3.3.1 guardrail 5): "' || v_key || '" is '
                 || (v_val #>> '{}')
                 || '; a coefficient carries at most 2 decimal places (a multiple of 0.01).';
        EXIT checks;
      END IF;
    END LOOP;

    EXIT checks;
  END IF;

  -- ══ Format 2: the envelope ═══════════════════════════════════════════════
  -- Never fall through to a plausible reading of an unknown version: a
  -- `format: 3` document read as flat, or as base-only, scores an entire league
  -- wrong with no error anywhere. A future format is a future validator.
  IF (p_rules -> 'format') <> '2'::JSONB THEN
    v_code := 'document_shape'; v_path := 'format';
    IF (p_rules -> 'format') = '1'::JSONB THEN
      -- The one version number that needs its own sentence (R597): format 1 IS
      -- the flat map, identified by carrying NO version member at all.
      v_msg := 'Document shape (§7.3.3.1): this document declares format 1 — but format 1 IS the flat map, identified by carrying NO "format" member at all, so a document that names the version is not one. Drop the "format" member for a flat map, or use format 2''s envelope.';
    ELSE
      v_msg := 'Document shape (§7.3.3.1): this document declares format '
               || (p_rules -> 'format')::TEXT
               || ', which this build cannot validate — it knows the flat map (no "format" member) and format 2. A future format is a future validator, never a silent pass.';
    END IF;
    EXIT checks;
  END IF;

  -- §7.3.3.1's printed shape has exactly four members. A document carrying a
  -- FIFTH is not a document with a harmless extra — nothing in this function
  -- or in `resolveRules` would ever read it, so `postions: {…}` (one transposed
  -- letter) would discard a commissioner's whole override map while the save
  -- reported success. That is R588, and CLAUDE.md's never-let-"nothing
  -- happened"-mean-"it worked". Refused BY NAME.
  FOR v_key IN SELECT k FROM jsonb_object_keys(p_rules) k WHERE NOT (k = ANY(c_envelope)) LOOP
    v_code := 'document_shape'; v_path := v_key;
    v_msg := 'Document shape (§7.3.3.1''s printed shape): "' || v_key
             || '" is not a member of a format-2 scoring document, which carries exactly '
             || array_to_string(c_envelope, ', ')
             || '. A member nothing reads is a value silently discarded on save — coefficients belong in "base" or under a position.';
    EXIT checks;
  END LOOP;

  v_base      := p_rules -> 'base';
  v_positions := p_rules -> 'positions';
  v_tier_cuts := p_rules -> 'tier_cuts';

  IF v_base IS NULL OR jsonb_typeof(v_base) <> 'object' THEN
    v_code := 'document_shape'; v_path := 'base';
    v_msg := 'Document shape (§7.3.3.1''s printed shape): a format-2 scoring document needs a "base" object; got '
             || CASE WHEN v_base IS NULL THEN 'nothing'
                     WHEN jsonb_typeof(v_base) = 'null' THEN 'null'
                     WHEN jsonb_typeof(v_base) = 'array' THEN 'an array'
                     ELSE 'a ' || jsonb_typeof(v_base) END
             || '.';
    EXIT checks;
  END IF;
  IF v_positions IS NULL OR jsonb_typeof(v_positions) <> 'object' THEN
    v_code := 'document_shape'; v_path := 'positions';
    v_msg := 'Document shape (§7.3.3.1''s printed shape): a format-2 scoring document needs a "positions" object; got '
             || CASE WHEN v_positions IS NULL THEN 'nothing'
                     WHEN jsonb_typeof(v_positions) = 'null' THEN 'null'
                     WHEN jsonb_typeof(v_positions) = 'array' THEN 'an array'
                     ELSE 'a ' || jsonb_typeof(v_positions) END
             || '.';
    EXIT checks;
  END IF;

  FOR v_pos IN SELECT k FROM jsonb_object_keys(v_positions) k LOOP
    IF jsonb_typeof(v_positions -> v_pos) <> 'object' THEN
      v_code := 'document_shape'; v_path := 'positions.' || v_pos;
      v_msg := 'Document shape (§7.3.3.1''s printed shape): a position override must be an object of coefficients; positions.'
               || v_pos || ' is '
               || CASE WHEN jsonb_typeof(v_positions -> v_pos) = 'null' THEN 'null'
                       WHEN jsonb_typeof(v_positions -> v_pos) = 'array' THEN 'an array'
                       ELSE 'a ' || jsonb_typeof(v_positions -> v_pos) END
               || '.';
      EXIT checks;
    END IF;
  END LOOP;

  -- ── §7.3.3.1(c) residuals, COMPUTED here, RAISED last ────────────────────
  -- Guardrail 2 generates key sets from these lists, and generating from a
  -- list nobody validated is exactly the throw this function must not make
  -- (D269(4)). A table that fails its residuals yields NULL and guardrail 2
  -- skips it — the residual violation is already the document's answer.
  IF v_tier_cuts IS NULL OR jsonb_typeof(v_tier_cuts) <> 'object' THEN
    v_cut_path := 'tier_cuts';
    v_cut_msg := 'Tier cuts (§7.3.3.1(a)/(c)): a format-2 document carries a "tier_cuts" object with both a "def_pa" and a "def_ya" cut list; got '
                 || CASE WHEN v_tier_cuts IS NULL THEN 'nothing'
                         WHEN jsonb_typeof(v_tier_cuts) = 'null' THEN 'null'
                         WHEN jsonb_typeof(v_tier_cuts) = 'array' THEN 'an array'
                         ELSE 'a ' || jsonb_typeof(v_tier_cuts) END
                 || '.';
  ELSE
    -- R588's second half, and the one a normalize-based fix would MISS:
    -- `normalizeScoringDoc` passes `tier_cuts` through by REFERENCE, so a
    -- stray table inside it is a FIXED POINT of the normal form. Its own
    -- member check, here.
    SELECT k INTO v_table
      FROM jsonb_object_keys(v_tier_cuts) k
     WHERE NOT (k = ANY(c_tables))
     ORDER BY k LIMIT 1;
    IF v_table IS NOT NULL THEN
      v_cut_path := 'tier_cuts.' || v_table;
      v_cut_msg := 'Tier cuts (§7.3.3.1(a)/(c)): "' || v_table
                   || '" is not a tier table — a format-2 document cuts exactly def_pa, def_ya, which are independent and additively scored. A table nothing reads is a cut list silently discarded.';
    END IF;

    FOREACH v_table IN ARRAY c_tables LOOP
      v_list := v_tier_cuts -> v_table;
      IF v_list IS NULL OR jsonb_typeof(v_list) <> 'array' THEN
        IF v_cut_path IS NULL THEN
          v_cut_path := 'tier_cuts.' || v_table;
          v_cut_msg := 'Tier cuts (§7.3.3.1(a)/(c)): tier_cuts.' || v_table
                       || ' must be an ascending list of integer cut points; got '
                       || CASE WHEN v_list IS NULL THEN 'nothing'
                               WHEN jsonb_typeof(v_list) = 'null' THEN 'null'
                               ELSE 'a ' || jsonb_typeof(v_list) END
                       || '. Both tables are always written — a league that pays no '
                       || CASE WHEN v_table = 'def_pa' THEN 'points-allowed' ELSE 'yards-allowed' END
                       || ' table simply pays none of its keys.';
        END IF;
        CONTINUE;
      END IF;

      v_n := jsonb_array_length(v_list);
      IF v_n < 2 THEN
        IF v_cut_path IS NULL THEN
          v_cut_path := 'tier_cuts.' || v_table;
          v_cut_msg := 'Tier cuts (§7.3.3.1(c)): tier_cuts.' || v_table
                       || ' needs at least 2 cut points to define a tier boundary; got ' || v_n || '.';
        END IF;
        CONTINUE;
      END IF;

      v_bad := NULL;
      FOR i IN 0 .. v_n - 1 LOOP
        -- The magnitude clause is `> 2^53`, not `> 1e308` — see the long note
        -- at scoring_tier_keys_from_cuts (R599). Above 2^53 the ascending
        -- residual cannot be mirrored, because `numeric` separates integers a
        -- double does not; below it the two number models agree exactly, which
        -- is what makes `SQL accepts ⟹ TS accepts` true rather than hoped.
        IF jsonb_typeof(v_list -> i) <> 'number'
           OR ((v_list -> i) #>> '{}')::NUMERIC <> trunc(((v_list -> i) #>> '{}')::NUMERIC)
           OR abs(((v_list -> i) #>> '{}')::NUMERIC) > 9007199254740992 THEN
          v_bad := i; EXIT;
        END IF;
      END LOOP;
      IF v_bad IS NOT NULL THEN
        IF v_cut_path IS NULL THEN
          v_cut_path := 'tier_cuts.' || v_table;
          v_cut_msg := 'Tier cuts (§7.3.3.1(c)): tier_cuts.' || v_table
                       || CASE WHEN jsonb_typeof(v_list -> v_bad) = 'number'
                                 AND ((v_list -> v_bad) #>> '{}')::NUMERIC = trunc(((v_list -> v_bad) #>> '{}')::NUMERIC)
                               THEN ' carries a cut beyond the exactly-representable integer range (|cut| <= 2^53); index '
                               ELSE ' must be integers; index ' END || v_bad || ' is '
                       || CASE WHEN jsonb_typeof(v_list -> v_bad) = 'number' THEN ((v_list -> v_bad) #>> '{}')
                               WHEN jsonb_typeof(v_list -> v_bad) = 'string' THEN (v_list -> v_bad)::TEXT
                               WHEN jsonb_typeof(v_list -> v_bad) = 'null' THEN 'null'
                               WHEN jsonb_typeof(v_list -> v_bad) = 'array' THEN 'an array'
                               ELSE 'a ' || jsonb_typeof(v_list -> v_bad) END
                       || '.';
        END IF;
        CONTINUE;
      END IF;

      v_bad := NULL;
      FOR i IN 1 .. v_n - 1 LOOP
        IF ((v_list -> i) #>> '{}')::NUMERIC <= ((v_list -> (i - 1)) #>> '{}')::NUMERIC THEN
          v_bad := i; EXIT;
        END IF;
      END LOOP;
      IF v_bad IS NOT NULL THEN
        IF v_cut_path IS NULL THEN
          v_cut_path := 'tier_cuts.' || v_table;
          v_cut_msg := 'Tier cuts (§7.3.3.1(c)): tier_cuts.' || v_table
                       || ' must ascend strictly — ' || trim_scale(((v_list -> (v_bad - 1)) #>> '{}')::NUMERIC)
                       || ' then ' || trim_scale(((v_list -> v_bad) #>> '{}')::NUMERIC)
                       || ' at index ' || v_bad
                       || '. Ascending cut points are what make overlapping tiers and coverage gaps unconstructible.';
        END IF;
        CONTINUE;
      END IF;

      -- R592 — the points-allowed table must start at exactly 0. D174 made
      -- enforceable, not a new rule: PA FLOORS at its first cut (R58/D58 rules
      -- a negative points-allowed unmappable), and §7.3.3.1(a)'s controlling
      -- agreement clause is that the cuts reading must agree with today's
      -- literals. A first cut above 0 puts a FALSE E61 pending badge on an
      -- ordinary low-scoring week; below 0 pays a tier for data the derivation
      -- refuses to map. YA is deliberately untouched — its first tier is
      -- genuinely open below (a negative-total-yards game is real).
      IF v_table = 'def_pa' AND ((v_list -> 0) #>> '{}')::NUMERIC <> 0 THEN
        IF v_cut_path IS NULL THEN
          v_cut_path := 'tier_cuts.def_pa';
          v_cut_msg := 'Tier cuts (§7.3.3.1(c) + §7.3.3.1(a)''s derive-agreement clause): tier_cuts.def_pa must start at 0 — a points-allowed table covers a shutout upward, and R58/D58 rules a negative points-allowed unmappable. Starting at '
                       || trim_scale(((v_list -> 0) #>> '{}')::NUMERIC)
                       || ' moves the E61 pending badge without moving any total. (Yards allowed has no such floor: its first tier is open below.)';
        END IF;
        CONTINUE;
      END IF;

      IF v_table = 'def_pa' THEN v_pa_cuts := v_list; ELSE v_ya_cuts := v_list; END IF;
    END LOOP;
  END IF;

  -- ── (1) Scorable allowlist ───────────────────────────────────────────────
  FOR v_key IN SELECT k FROM jsonb_object_keys(v_base) k LOOP
    IF NOT (v_key = ANY(c_scorable)) THEN
      v_code := 'scorable_allowlist'; v_path := 'base.' || v_key;
      v_msg := 'Scorable allowlist (§7.3.3.1 guardrail 1): "' || v_key
               || '" cannot be scored — '
               || CASE
                    WHEN v_key = ANY(c_context) THEN 'it is a context key — a raw source or an aggregate (§23.5), and paying it beside the keys derived from it is the double-count this guardrail exists to make inexpressible'
                    WHEN v_key = ANY(c_reserved) THEN 'it is a reserved key (§23.5) — deferred bonuses, placeholders and IDP are not exposed by the cohort editor'
                    ELSE 'it is not a canonical stat key at all (§23.5 STAT_KEYS)'
                  END
               || '.';
      EXIT checks;
    END IF;
  END LOOP;
  FOR v_pos IN SELECT k FROM jsonb_object_keys(v_positions) k LOOP
    FOR v_key IN SELECT k2 FROM jsonb_object_keys(v_positions -> v_pos) k2 LOOP
      IF NOT (v_key = ANY(c_scorable)) THEN
        v_code := 'scorable_allowlist'; v_path := 'positions.' || v_pos || '.' || v_key;
        v_msg := 'Scorable allowlist (§7.3.3.1 guardrail 1): "' || v_key
                 || '" cannot be scored — '
                 || CASE
                      WHEN v_key = ANY(c_context) THEN 'it is a context key — a raw source or an aggregate (§23.5), and paying it beside the keys derived from it is the double-count this guardrail exists to make inexpressible'
                      WHEN v_key = ANY(c_reserved) THEN 'it is a reserved key (§23.5) — deferred bonuses, placeholders and IDP are not exposed by the cohort editor'
                      ELSE 'it is not a canonical stat key at all (§23.5 STAT_KEYS)'
                    END
                 || '.';
        EXIT checks;
      END IF;
    END LOOP;
  END LOOP;

  -- ── (2) Tier exclusivity, format-2 arm: against the document's OWN cuts ──
  -- The version §7.3.3.1 calls INEXPRESSIBLE: one cut list per table generates
  -- one non-overlapping tier set, so a key the document's own cuts do not
  -- generate has no tier to pay. Checked doc-wide (base AND every override,
  -- whatever position it sits under) — the double-pay is a property of the
  -- DOCUMENT, not of one map.
  FOR i IN 1 .. 2 LOOP
    v_prefix := c_tables[i];
    v_list   := CASE WHEN i = 1 THEN v_pa_cuts ELSE v_ya_cuts END;
    CONTINUE WHEN v_list IS NULL;
    -- Nothing to compare against if the document names no key in this family,
    -- and generating a key set the document cannot violate is the one place a
    -- long-but-legal cut list would cost real work (R595).
    SELECT array_agg(k) INTO v_strays FROM (
      SELECT k FROM jsonb_object_keys(v_base) k WHERE starts_with(k, v_prefix || '_')
      UNION ALL
      SELECT k2 FROM jsonb_object_keys(v_positions) p,
                     LATERAL jsonb_object_keys(v_positions -> p) k2
       WHERE starts_with(k2, v_prefix || '_')
    ) s;
    CONTINUE WHEN v_strays IS NULL;

    v_generated := public.scoring_tier_keys_from_cuts(v_prefix, v_list);

    SELECT k INTO v_key FROM jsonb_object_keys(v_base) k
     WHERE starts_with(k, v_prefix || '_') AND NOT (k = ANY(v_generated)) ORDER BY k LIMIT 1;
    IF v_key IS NOT NULL THEN
      v_code := 'tier_exclusivity'; v_path := 'base.' || v_key;
    ELSE
      SELECT p, k2 INTO v_pos, v_key
        FROM jsonb_object_keys(v_positions) p,
             LATERAL jsonb_object_keys(v_positions -> p) k2
       WHERE starts_with(k2, v_prefix || '_') AND NOT (k2 = ANY(v_generated))
       ORDER BY p, k2 LIMIT 1;
      IF v_key IS NOT NULL THEN
        v_code := 'tier_exclusivity'; v_path := 'positions.' || v_pos || '.' || v_key;
      END IF;
    END IF;
    IF v_code IS NOT NULL THEN
      v_msg := 'Tier exclusivity (§7.3.3.1 guardrail 2): "' || v_key
               || '" is not a tier this document''s own '
               || CASE WHEN v_prefix = 'def_pa' THEN 'points-allowed' ELSE 'yards-allowed' END
               || ' cut list ['
               || (SELECT string_agg(e #>> '{}', ', ' ORDER BY ord)
                     FROM jsonb_array_elements(v_list) WITH ORDINALITY AS t(e, ord))
               || '] generates (' || array_to_string(v_generated, ', ')
               || '). A document cannot name a tier its own cuts do not cut — that is how the F21 double-pay is made inexpressible.';
      EXIT checks;
    END IF;
  END LOOP;

  -- ── (3) Position scope ───────────────────────────────────────────────────
  -- §7.3.3.1's scope sentence has THREE clauses and all three are checked
  -- (R594). The position vocabulary is EXACT and case-sensitive on purpose: a
  -- forgiving `upper(trim(p))` would accept `positions.dst` while
  -- `resolveRules`' own-property lookup pays it nothing.
  FOR v_pos IN SELECT k FROM jsonb_object_keys(v_positions) k LOOP
    IF NOT (v_pos = ANY(c_positions)) THEN
      v_code := 'position_scope'; v_path := 'positions.' || v_pos;
      v_msg := 'Position scope (§7.3.3.1 guardrail 3): "' || v_pos
               || '" is not one of the six scored positions '
               || array_to_string(c_positions, ', ') || '.';
      EXIT checks;
    END IF;
    v_legal := CASE
                 WHEN v_pos = 'K' THEN c_kicking
                 WHEN v_pos = 'DST' THEN c_dst_events
                   || public.scoring_tier_keys_from_cuts('def_pa', c_shared_pa)
                   || public.scoring_tier_keys_from_cuts('def_pa', c_espn_pa)
                   || public.scoring_tier_keys_from_cuts('def_ya', c_ya)
                 ELSE c_offense
               END;
    FOR v_key IN SELECT k2 FROM jsonb_object_keys(v_positions -> v_pos) k2 LOOP
      CONTINUE WHEN v_key = ANY(v_legal);
      -- A key that is not scorable AT ALL is already guardrail 1's rejection;
      -- saying it twice would make "the first violation" ambiguous for no gain.
      CONTINUE WHEN NOT (v_key = ANY(c_scorable));
      v_code := 'position_scope'; v_path := 'positions.' || v_pos || '.' || v_key;
      v_msg := 'Position scope (§7.3.3.1 guardrail 3): "' || v_key
               || '" is not scored for ' || v_pos || ' — it belongs to '
               || COALESCE(
                    (SELECT string_agg(p, '/' ORDER BY array_position(c_positions, p))
                       FROM unnest(c_positions) p
                      WHERE v_key = ANY(CASE
                                          WHEN p = 'K' THEN c_kicking
                                          WHEN p = 'DST' THEN c_dst_events
                                            || public.scoring_tier_keys_from_cuts('def_pa', c_shared_pa)
                                            || public.scoring_tier_keys_from_cuts('def_pa', c_espn_pa)
                                            || public.scoring_tier_keys_from_cuts('def_ya', c_ya)
                                          ELSE c_offense
                                        END)),
                    'no position page')
               || '. An override may only name its own position''s section keys.';
      EXIT checks;
    END LOOP;
  END LOOP;

  -- ── (4) Normal form ──────────────────────────────────────────────────────
  -- `normalizeScoringDoc` strips overrides equal to the base value and empty
  -- override objects; a document is in normal form iff normalizing changes
  -- nothing. The strip rule has ONE definition (rules-doc.ts) and this is its
  -- diff, not a second strip: "did not survive normalization" and "is a no-op"
  -- are the same fact, because the strip keeps a key unless it exists in
  -- `base` AND matches it.
  FOR v_pos IN SELECT k FROM jsonb_object_keys(v_positions) k LOOP
    v_map := v_positions -> v_pos;
    IF v_map = '{}'::JSONB THEN
      v_code := 'normal_form'; v_path := 'positions.' || v_pos;
      v_msg := 'Normal form (§7.3.3.1 guardrail 4): positions.' || v_pos
               || ' is an empty override object — the normal form carries no empty overrides, because the All-Positions switch state is derived from the document alone.';
      EXIT checks;
    END IF;
    FOR v_key IN SELECT k2 FROM jsonb_object_keys(v_map) k2 LOOP
      IF (v_base ? v_key) AND (v_base -> v_key) = (v_map -> v_key) THEN
        v_code := 'normal_form'; v_path := 'positions.' || v_pos || '.' || v_key;
        v_msg := 'Normal form (§7.3.3.1 guardrail 4): positions.' || v_pos || '.' || v_key
                 || ' repeats the base value (' || (v_base -> v_key)::TEXT
                 || '), so it overrides nothing — the All-Positions switch would read OFF for a section whose values are in fact uniform.';
        EXIT checks;
      END IF;
    END LOOP;
  END LOOP;

  -- ── (5) Bounds ───────────────────────────────────────────────────────────
  -- Magnitude BEFORE precision, exactly as TS orders them: nothing large
  -- enough to render exponentially in JS ever reaches the decimal rule.
  -- `base` first, then the overrides — TS's `coefficientEntries` order, and
  -- the layer split R590 found unpinned (every magnitude/precision fixture had
  -- sat at `positions.QB.*`, so bounds-on-`base` — the layer a fork writes the
  -- whole template into — was never exercised).
  FOR v_key IN SELECT k FROM jsonb_object_keys(v_base) k LOOP
    v_val  := v_base -> v_key;
    v_path := 'base.' || v_key;
    IF jsonb_typeof(v_val) <> 'number' THEN
      v_code := 'bounds';
      v_msg := 'Bounds (§7.3.3.1 guardrail 5): "' || v_key
               || '" must be a finite number; got '
               || CASE WHEN jsonb_typeof(v_val) = 'string' THEN v_val::TEXT
                       WHEN jsonb_typeof(v_val) = 'null' THEN 'null'
                       WHEN jsonb_typeof(v_val) = 'array' THEN 'an array'
                       ELSE 'a ' || jsonb_typeof(v_val) END
               || '.';
      EXIT checks;
    END IF;
    v_num := (v_val #>> '{}')::NUMERIC;
    IF abs(v_num) > c_max_abs THEN
      v_code := 'bounds';
      v_msg := 'Bounds (§7.3.3.1 guardrail 5): "' || v_key || '" is '
               || (v_val #>> '{}') || '; a coefficient must satisfy |coef| ≤ 100.';
      EXIT checks;
    END IF;
    -- THE DECIMAL RULE, and the one place D269(6)'s hand-off needed measuring
    -- rather than obeying: `scale()` alone refuses `0.100`, which TS accepts.
    -- `trim_scale()` drops exactly the trailing zeros `String()` never prints.
    IF scale(trim_scale(v_num)) > 2 THEN
      v_code := 'bounds';
      v_msg := 'Bounds (§7.3.3.1 guardrail 5): "' || v_key || '" is '
               || (v_val #>> '{}')
               || '; a coefficient carries at most 2 decimal places (a multiple of 0.01).';
      EXIT checks;
    END IF;
  END LOOP;
  FOR v_pos IN SELECT k FROM jsonb_object_keys(v_positions) k LOOP
    FOR v_key IN SELECT k2 FROM jsonb_object_keys(v_positions -> v_pos) k2 LOOP
      v_val  := (v_positions -> v_pos) -> v_key;
      v_path := 'positions.' || v_pos || '.' || v_key;
      IF jsonb_typeof(v_val) <> 'number' THEN
        v_code := 'bounds';
        v_msg := 'Bounds (§7.3.3.1 guardrail 5): "' || v_key
                 || '" must be a finite number; got '
                 || CASE WHEN jsonb_typeof(v_val) = 'string' THEN v_val::TEXT
                         WHEN jsonb_typeof(v_val) = 'null' THEN 'null'
                         WHEN jsonb_typeof(v_val) = 'array' THEN 'an array'
                         ELSE 'a ' || jsonb_typeof(v_val) END
                 || '.';
        EXIT checks;
      END IF;
      v_num := (v_val #>> '{}')::NUMERIC;
      IF abs(v_num) > c_max_abs THEN
        v_code := 'bounds';
        v_msg := 'Bounds (§7.3.3.1 guardrail 5): "' || v_key || '" is '
                 || (v_val #>> '{}') || '; a coefficient must satisfy |coef| ≤ 100.';
        EXIT checks;
      END IF;
      IF scale(trim_scale(v_num)) > 2 THEN
        v_code := 'bounds';
        v_msg := 'Bounds (§7.3.3.1 guardrail 5): "' || v_key || '" is '
                 || (v_val #>> '{}')
                 || '; a coefficient carries at most 2 decimal places (a multiple of 0.01).';
        EXIT checks;
      END IF;
    END LOOP;
  END LOOP;

  -- ── §7.3.3.1(c) residuals — last, because they are the (c) bullet and not
  --    one of the five families (the TS ordering contract, D269(7)) ─────────
  IF v_cut_path IS NOT NULL THEN
    v_code := 'tier_cuts'; v_path := v_cut_path; v_msg := v_cut_msg;
    EXIT checks;
  END IF;

  EXIT checks;
  END LOOP;

  -- ── The one refusal site (E75) ───────────────────────────────────────────
  IF v_code IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = v_msg,
      -- R602: the sentinel is now injective. It used to be
      -- `CASE WHEN v_path = '' THEN '(document)'`, and `""` is a LEGAL JSON
      -- key — so `{"": 1}` reported a concrete field violation to SE.5/SE.6 as
      -- a document-level one. The four document-level sites set v_path to NULL
      -- instead, so `(document)` now means exactly one thing and an empty
      -- DETAIL means the empty-string key.
      DETAIL  = COALESCE(v_path, '(document)'),
      HINT    = v_code;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.scoring_rules_validate(JSONB) FROM PUBLIC, anon;

COMMENT ON FUNCTION public.scoring_rules_validate(JSONB) IS
  'SE.4 / spec §7.3.3.1(5): the five F21 guardrail families + §7.3.3.1(c) tier_cuts residuals, server side. Raises P0001 on the FIRST violation with the guardrail family named in MESSAGE, the dot path in DETAIL and the family code in HINT (E75). Mirrors validateScoringRulesDoc (src/lib/leagues/scoring/validate-rules-doc.ts) family-for-family; the mirror is measured by scoring-parity-db.test.ts, not asserted. SE.4b bolts this to scoring_systems and leagues as the write walls (D175/D168).';

-- ---------------------------------------------------------------------------
-- (b) stat_key_label_internal — 195_player_info_c.sql:729-782 FILE TEXT
--     (D137), 2 hunks (+2): the two keys' plain words.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stat_key_label_internal(p_key TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_key
    WHEN 'pass_yards' THEN 'passing yards'
    WHEN 'pass_tds' THEN 'passing TDs'
    WHEN 'interceptions' THEN 'interceptions thrown'
    WHEN 'pass_2pt' THEN '2-pt conversions (pass)'
    WHEN 'rush_yards' THEN 'rushing yards'
    WHEN 'rush_tds' THEN 'rushing TDs'
    WHEN 'rush_2pt' THEN '2-pt conversions (rush)'
    WHEN 'receptions' THEN 'receptions'
    WHEN 'receiving_yards' THEN 'receiving yards'
    WHEN 'receiving_tds' THEN 'receiving TDs'
    WHEN 'rec_2pt' THEN '2-pt conversions (rec)'
    WHEN 'fumbles_lost' THEN 'fumbles lost'
    WHEN 'fumble_recovery_td' THEN 'fumble recovery TD'
    WHEN 'return_td' THEN 'kick/punt return TD'
    WHEN 'fg_0_39' THEN 'FG made (0–39)'
    WHEN 'fg_40_49' THEN 'FG made (40–49)'
    WHEN 'fg_50_plus' THEN 'FG made (50+)'
    WHEN 'fg_60_plus' THEN 'FG made (60+)'
    WHEN 'pat_made' THEN 'PAT made'
    WHEN 'fg_missed' THEN 'FG missed'
    WHEN 'pat_missed' THEN 'PAT missed'
    WHEN 'def_sack' THEN 'sack'
    WHEN 'def_int' THEN 'defensive interception'
    WHEN 'def_fumble_rec' THEN 'fumble recovery'
    WHEN 'def_td' THEN 'defensive TD'
    WHEN 'def_safety' THEN 'safety'
    WHEN 'def_block' THEN 'blocked kick'
    WHEN 'def_return_td' THEN 'return TD (D/ST)'
    WHEN 'def_2pt_return' THEN 'two-point return (D/ST)'
    WHEN 'pass_attempts' THEN 'pass attempts'
    WHEN 'pass_completions' THEN 'pass completions'
    WHEN 'qb_sack_taken' THEN 'sacks taken'
    WHEN 'rush_attempts' THEN 'rush attempts'
    WHEN 'targets' THEN 'targets'
    WHEN 'fg_made' THEN 'FG made (total)'
    WHEN 'fg_attempted' THEN 'FG attempted'
    WHEN 'pat_attempted' THEN 'PAT attempted'
    WHEN 'def_points_allowed' THEN 'points allowed'
    WHEN 'def_yards_allowed' THEN 'yards allowed'
    WHEN 'off_snaps' THEN 'offensive snaps'
    WHEN 'pass_rz_att' THEN 'red-zone pass attempts'
    WHEN 'rush_rz_att' THEN 'red-zone rush attempts'
    WHEN 'rec_rz_tgt' THEN 'red-zone targets'
    WHEN 'fg_long' THEN 'longest FG made'
    WHEN 'example_tracking_yards' THEN 'example tracking yards (placeholder)'
    WHEN 'example_charted_yards' THEN 'example charted yards (placeholder)'
    ELSE replace(p_key, '_', ' ') END;
$$;
REVOKE EXECUTE ON FUNCTION stat_key_label_internal(TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- (c) The template rows. Each UPDATE must touch exactly its one row: a
--     missing or renamed template is a reconcile, never a silent pass.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  -- templates.ts's ESPN_PARITY_EXCEPTION_NOTE, verbatim (pinned by
  -- templates-db.test.ts against the row, and by pgTAP 170).
  c_note CONSTANT TEXT :=
    'Heads up on one tiny gap our stat feed cannot see: ESPN awards 1 point '
    'when a D/ST scores a safety on a PAT try (not scored here). Our stats '
    'come from one feed, so on a rare play our count can differ from ESPN''s.';
  v_cnt INTEGER;
BEGIN
  UPDATE public.scoring_systems
     SET rules = rules || '{"fg_60_plus": 1, "def_2pt_return": 2}'::jsonb,
         description = 'ESPN''s 2026 default scoring, 0 PPR — verified against ESPN''s published defaults (July 2026). Interceptions −2. ' || c_note,
         updated_at = NOW()
   WHERE is_template AND owner_id IS NULL AND name = 'ESPN Standard'
     AND NOT (rules ?| ARRAY['fg_60_plus', 'def_2pt_return']);
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '218 (c): the ESPN Standard template update touched % rows, expected exactly 1 (missing, renamed, or already carrying a new key — reconcile first, runbook-hosted-migration-reconciliation.md)', v_cnt;
  END IF;

  UPDATE public.scoring_systems
     SET rules = rules || '{"fg_60_plus": 1, "def_2pt_return": 2}'::jsonb,
         description = 'ESPN''s 2026 default scoring with 1 point per reception — verified against ESPN''s published defaults (July 2026). Interceptions −2. ' || c_note,
         updated_at = NOW()
   WHERE is_template AND owner_id IS NULL AND name = 'ESPN Full PPR'
     AND NOT (rules ?| ARRAY['fg_60_plus', 'def_2pt_return']);
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '218 (c): the ESPN Full PPR template update touched % rows, expected exactly 1', v_cnt;
  END IF;

  -- Q2 (Chris 2026-11-05, "yes"): Scout pays the two-point return. No 60+
  -- key: Scout's fg_50_plus is the flat 3 every field goal pays.
  UPDATE public.scoring_systems
     SET rules = rules || '{"def_2pt_return": 2}'::jsonb,
         updated_at = NOW()
   WHERE is_template AND owner_id IS NULL AND name IN ('Scout Standard', 'Scout PPR')
     AND NOT (rules ?| ARRAY['fg_60_plus', 'def_2pt_return']);
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION '218 (c): the Scout template update touched % rows, expected exactly 2 (Scout Standard, Scout PPR)', v_cnt;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- (d) The one-time addition to running leagues' rules (banner, (d) and (e)).
-- ---------------------------------------------------------------------------

-- What one rules document takes, and why. Reads the template rows and the
-- fork receipts; writes nothing. `p_system` is the scoring system the
-- document was copied from (its row's own id for a fork row).
-- Returns {"descent": "espn" | "scout" | "other", "how": text,
--          "add": {key: value, ...}, "kept": text | null}.
CREATE OR REPLACE FUNCTION long_fg_two_point_doc_plan_internal(p_doc JSONB, p_system UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  -- The pre-218 kicking and D/ST event keys: the by-value blocks leave the
  -- two new keys out on both sides of the comparison.
  c_k_keys   CONSTANT TEXT[] := ARRAY['fg_0_39', 'fg_40_49', 'fg_50_plus', 'pat_made', 'fg_missed', 'pat_missed'];
  c_dst_keys CONSTANT TEXT[] := ARRAY['def_sack', 'def_int', 'def_fumble_rec', 'def_td', 'def_safety', 'def_block', 'def_return_td'];
  v_f2       BOOLEAN;
  v_k        JSONB;   -- the document's effective K map (format 2: base, then positions.K)
  v_dst      JSONB;   -- the document's effective D/ST map
  v_sys      RECORD;
  v_tpl_id   TEXT;
  v_from     TEXT;    -- the template the document descends from, by name
  v_how      TEXT;
  v_descent  TEXT;
  v_add      JSONB := '{}'::jsonb;
  v_kept     TEXT;
  v_present  BOOLEAN;
BEGIN
  IF p_doc IS NULL OR jsonb_typeof(p_doc) <> 'object' THEN
    RETURN jsonb_build_object('descent', 'other', 'how', 'no rules document', 'add', '{}'::jsonb, 'kept', 'no rules document');
  END IF;
  v_f2 := p_doc ? 'format';
  v_k := CASE WHEN v_f2 THEN COALESCE(p_doc -> 'base', '{}'::jsonb) || COALESCE(p_doc #> '{positions,K}', '{}'::jsonb) ELSE p_doc END;
  v_dst := CASE WHEN v_f2 THEN COALESCE(p_doc -> 'base', '{}'::jsonb) || COALESCE(p_doc #> '{positions,DST}', '{}'::jsonb) ELSE p_doc END;

  -- ── Descent ───────────────────────────────────────────────────────────────
  SELECT s.id, s.name, s.is_template, s.owner_id INTO v_sys
  FROM public.scoring_systems s WHERE s.id = p_system;
  IF p_system IS NULL OR NOT FOUND THEN
    v_how := 'no scoring system reference';
  ELSIF v_sys.is_template AND v_sys.owner_id IS NULL THEN
    v_from := v_sys.name;
    v_how := 'the ' || v_sys.name || ' template';
  ELSE
    -- A fork: its newest fork_scoring receipt (169:2127-2131) names the template.
    SELECT a.metadata ->> 'template_id' INTO v_tpl_id
    FROM public.commissioner_actions a
    WHERE a.action_type = 'fork_scoring'
      AND a.after ->> 'scoring_system_id' = p_system::text
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT 1;
    IF FOUND THEN
      SELECT t.name INTO v_from
      FROM public.scoring_systems t
      WHERE t.id::text = v_tpl_id AND t.is_template AND t.owner_id IS NULL;
      v_how := 'a fork of ' || COALESCE(v_from, 'an unknown template (' || COALESCE(v_tpl_id, 'none named') || ')') || ', by its fork_scoring receipt';
    ELSE
      -- No receipt (a fork made before 169): by value.
      IF (SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb) FROM jsonb_each(v_k) e WHERE e.key = ANY (c_k_keys))
         = (SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
            FROM public.scoring_systems t, jsonb_each(t.rules) e
            WHERE t.is_template AND t.owner_id IS NULL AND t.name = 'ESPN Standard' AND e.key = ANY (c_k_keys)) THEN
        v_from := 'ESPN Standard';
        v_how := 'a fork with no receipt whose kicking is ESPN''s by value';
      ELSIF (SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb) FROM jsonb_each(v_dst) e
             WHERE e.key = ANY (c_dst_keys) OR starts_with(e.key, 'def_pa_') OR starts_with(e.key, 'def_ya_'))
         = (SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
            FROM public.scoring_systems t, jsonb_each(t.rules) e
            WHERE t.is_template AND t.owner_id IS NULL AND t.name = 'Scout Standard'
              AND (e.key = ANY (c_dst_keys) OR starts_with(e.key, 'def_pa_') OR starts_with(e.key, 'def_ya_'))) THEN
        v_from := 'Scout Standard';
        v_how := 'a fork with no receipt whose D/ST is Scout''s by value';
      ELSE
        v_how := 'a fork with no receipt matching neither ESPN''s kicking nor Scout''s D/ST by value';
      END IF;
    END IF;
  END IF;
  v_descent := CASE WHEN v_from IN ('ESPN Standard', 'ESPN Full PPR') THEN 'espn'
                    WHEN v_from IN ('Scout Standard', 'Scout PPR') THEN 'scout'
                    ELSE 'other' END;
  IF v_descent = 'other' THEN
    RETURN jsonb_build_object('descent', v_descent, 'how', v_how, 'add', '{}'::jsonb,
                              'kept', 'not ESPN or Scout scoring (' || v_how || ')');
  END IF;

  -- ── What is added: absent keys only, never an existing value ──────────────
  -- "Absent" = nowhere in the flat map, or in base or any positions map.
  v_present := CASE WHEN v_f2 THEN COALESCE(p_doc -> 'base', '{}'::jsonb) ? 'def_2pt_return'
                                   OR EXISTS (SELECT 1 FROM jsonb_each(COALESCE(p_doc -> 'positions', '{}'::jsonb)) p
                                              WHERE jsonb_typeof(p.value) = 'object' AND p.value ? 'def_2pt_return')
                    ELSE p_doc ? 'def_2pt_return' END;
  IF NOT v_present THEN
    v_add := v_add || '{"def_2pt_return": 2}'::jsonb;
  END IF;
  IF v_descent = 'espn' THEN
    v_present := CASE WHEN v_f2 THEN COALESCE(p_doc -> 'base', '{}'::jsonb) ? 'fg_60_plus'
                                     OR EXISTS (SELECT 1 FROM jsonb_each(COALESCE(p_doc -> 'positions', '{}'::jsonb)) p
                                                WHERE jsonb_typeof(p.value) = 'object' AND p.value ? 'fg_60_plus')
                      ELSE p_doc ? 'fg_60_plus' END;
    IF NOT v_present THEN
      IF (v_k -> 'fg_50_plus') = '5'::jsonb THEN
        v_add := v_add || '{"fg_60_plus": 1}'::jsonb;
      ELSE
        v_kept := 'its 50+ field goal pays ' || COALESCE(v_k ->> 'fg_50_plus', 'nothing')
                  || ', not ESPN''s 5, so a 60-yarder keeps paying that (no fg_60_plus)';
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('descent', v_descent, 'how', v_how, 'add', v_add, 'kept', v_kept);
END;
$$;
REVOKE EXECUTE ON FUNCTION long_fg_two_point_doc_plan_internal(JSONB, UUID) FROM PUBLIC, anon, authenticated;

-- The writer. Returns what it rewrote and kept, each league in id order.
CREATE OR REPLACE FUNCTION long_fg_two_point_rules_add_internal()
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_lg         RECORD;
  v_lw         RECORD;
  v_lplan      JSONB;   -- the league snapshot's plan
  v_wplan      JSONB;   -- one live week's plan
  v_fplan      JSONB;   -- the fork row's plan
  v_fork       RECORD;
  v_weeks      JSONB;   -- this league's live weeks: [{week, plan, rewritten}]
  v_changed    BOOLEAN; -- the snapshot or a live week changed (members see it)
  v_fork_out   JSONB;
  v_add        JSONB;   -- the keys the post describes
  v_week       INTEGER;
  v_from_on    BOOLEAN; -- "from Week N on" (the league's rules) vs "for Week N" (a live week alone)
  v_what       TEXT;
  v_post       TEXT;
  v_cnt        INTEGER;
  v_rewritten  JSONB := '[]'::jsonb;
  v_kept       JSONB := '[]'::jsonb;
  v_requeue    JSONB := '[]'::jsonb;   -- [{season, week}] of rewritten live weeks
  v_requeued   INTEGER := 0;
  v_archived   JSONB;
  v_outside    JSONB;
BEGIN
  -- The league rows first, in id order (rule 8).
  PERFORM 1 FROM public.leagues l
  WHERE l.deleted_at IS NULL AND l.status IN ('drafting', 'in_season', 'playoffs') AND l.season = 2026
  ORDER BY l.id
  FOR UPDATE;

  FOR v_lg IN
    SELECT l.id, l.season, l.status, l.scoring_system_id, l.scoring_rules_snapshot
    FROM public.leagues l
    WHERE l.deleted_at IS NULL AND l.status IN ('drafting', 'in_season', 'playoffs') AND l.season = 2026
    ORDER BY l.id
  LOOP
    v_changed := FALSE;
    v_weeks := '[]'::jsonb;
    v_fork_out := NULL;

    -- ── The league's snapshot: the rules every week from the next one takes ──
    v_lplan := public.long_fg_two_point_doc_plan_internal(v_lg.scoring_rules_snapshot, v_lg.scoring_system_id);
    IF v_lplan -> 'add' <> '{}'::jsonb THEN
      UPDATE public.leagues l
      SET scoring_rules_snapshot = CASE WHEN l.scoring_rules_snapshot ? 'format'
                                        THEN jsonb_set(l.scoring_rules_snapshot, '{base}', COALESCE(l.scoring_rules_snapshot -> 'base', '{}'::jsonb) || (v_lplan -> 'add'))
                                        ELSE l.scoring_rules_snapshot || (v_lplan -> 'add') END
      WHERE l.id = v_lg.id AND l.scoring_rules_snapshot = v_lg.scoring_rules_snapshot;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION '218 (d): league %: its scoring snapshot update touched % rows, expected 1', v_lg.id, v_cnt
          USING ERRCODE = 'P0001';
      END IF;
      v_changed := TRUE;
    END IF;

    -- ── The LIVE week only. Never correction_window, never final (Q64 / Q69,
    --    216's digest); upcoming weeks hold no rules (144's CHECK) and take the
    --    snapshot above when they open. ─────────────────────────────────────
    FOR v_lw IN
      SELECT lw.id, lw.week, lw.scoring_rules_snapshot, lw.scoring_system_id
      FROM public.league_weeks lw
      WHERE lw.league_id = v_lg.id AND lw.season = v_lg.season AND lw.status = 'live'
      ORDER BY lw.week
    LOOP
      v_wplan := public.long_fg_two_point_doc_plan_internal(v_lw.scoring_rules_snapshot, v_lw.scoring_system_id);
      IF v_wplan -> 'add' <> '{}'::jsonb THEN
        UPDATE public.league_weeks lw
        SET scoring_rules_snapshot = CASE WHEN lw.scoring_rules_snapshot ? 'format'
                                          THEN jsonb_set(lw.scoring_rules_snapshot, '{base}', COALESCE(lw.scoring_rules_snapshot -> 'base', '{}'::jsonb) || (v_wplan -> 'add'))
                                          ELSE lw.scoring_rules_snapshot || (v_wplan -> 'add') END
        WHERE lw.id = v_lw.id AND lw.status = 'live' AND lw.scoring_rules_snapshot = v_lw.scoring_rules_snapshot;
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        IF v_cnt <> 1 THEN
          RAISE EXCEPTION '218 (d): league % week %: the live week''s rules update touched % rows, expected 1', v_lg.id, v_lw.week, v_cnt
            USING ERRCODE = 'P0001';
        END IF;
        v_changed := TRUE;
        IF NOT v_requeue @> jsonb_build_array(jsonb_build_object('season', v_lg.season, 'week', v_lw.week)) THEN
          v_requeue := v_requeue || jsonb_build_array(jsonb_build_object('season', v_lg.season, 'week', v_lw.week));
        END IF;
      END IF;
      v_weeks := v_weeks || jsonb_build_array(jsonb_build_object(
        'week', v_lw.week, 'plan', v_wplan, 'rewritten', v_wplan -> 'add' <> '{}'::jsonb));
    END LOOP;

    -- ── The league's fork row (a template row is (c)'s) ──────────────────────
    SELECT s.id, s.rules INTO v_fork
    FROM public.scoring_systems s
    WHERE s.id = v_lg.scoring_system_id AND NOT (s.is_template AND s.owner_id IS NULL);
    IF FOUND THEN
      IF EXISTS (SELECT 1 FROM public.leagues o
                 WHERE o.scoring_system_id = v_fork.id
                   AND NOT (o.deleted_at IS NULL AND o.status IN ('drafting', 'in_season', 'playoffs') AND o.season = 2026)) THEN
        v_fork_out := jsonb_build_object('scoring_system_id', v_fork.id, 'rewritten', FALSE,
                                         'kept', 'a league outside this change also plays by it');
      ELSE
        v_fplan := public.long_fg_two_point_doc_plan_internal(v_fork.rules, v_fork.id);
        IF v_fplan -> 'add' <> '{}'::jsonb THEN
          UPDATE public.scoring_systems s
          SET rules = CASE WHEN s.rules ? 'format'
                           THEN jsonb_set(s.rules, '{base}', COALESCE(s.rules -> 'base', '{}'::jsonb) || (v_fplan -> 'add'))
                           ELSE s.rules || (v_fplan -> 'add') END,
              updated_at = NOW()
          WHERE s.id = v_fork.id AND s.rules = v_fork.rules;
          GET DIAGNOSTICS v_cnt = ROW_COUNT;
          IF v_cnt <> 1 THEN
            RAISE EXCEPTION '218 (d): league %: its scoring system % update touched % rows, expected 1', v_lg.id, v_fork.id, v_cnt
              USING ERRCODE = 'P0001';
          END IF;
        END IF;
        v_fork_out := jsonb_build_object('scoring_system_id', v_fork.id, 'plan', v_fplan,
                                         'rewritten', v_fplan -> 'add' <> '{}'::jsonb);
      END IF;
    END IF;

    IF NOT v_changed THEN
      v_kept := v_kept || jsonb_build_array(jsonb_build_object(
        'league_id', v_lg.id, 'status', v_lg.status, 'league', v_lplan, 'live_weeks', v_weeks, 'fork', v_fork_out));
      CONTINUE;
    END IF;

    -- ── The post: what changed, and from which week ──────────────────────────
    IF v_lplan -> 'add' <> '{}'::jsonb THEN
      v_add := v_lplan -> 'add';
      v_from_on := TRUE;
      -- The live week, when it took the same keys; else the next to open.
      SELECT min((w ->> 'week')::int) INTO v_week
      FROM jsonb_array_elements(v_weeks) w
      WHERE w #> '{plan,add}' = v_add;
      IF v_week IS NULL THEN
        SELECT min(lw.week) INTO v_week
        FROM public.league_weeks lw
        WHERE lw.league_id = v_lg.id AND lw.season = v_lg.season AND lw.status = 'upcoming';
      END IF;
      IF v_week IS NULL AND v_lg.status = 'drafting' THEN
        v_week := 1;
      END IF;
    ELSE
      -- Only a live week changed: the league's own rules (a different system,
      -- re-score off) don't pay these, so the post is about that week alone.
      SELECT (w #> '{plan,add}'), (w ->> 'week')::int INTO v_add, v_week
      FROM jsonb_array_elements(v_weeks) w
      WHERE (w ->> 'rewritten')::boolean
      ORDER BY (w ->> 'week')::int
      LIMIT 1;
      v_from_on := FALSE;
    END IF;
    v_what := CASE
      WHEN v_add ? 'fg_60_plus' AND v_add ? 'def_2pt_return' THEN
        'a field goal of 60+ yards pays 1 more point (6 in all), and a D/ST two-point return pays 2, matching ESPN.'
      WHEN v_add ? 'fg_60_plus' THEN
        'a field goal of 60+ yards pays 1 more point (6 in all), matching ESPN.'
      ELSE
        'a D/ST two-point return pays 2 points.'
      END;
    v_post := 'Scoring update '
      || CASE WHEN v_week IS NULL THEN 'from the next week on'
              WHEN v_from_on THEN 'from Week ' || v_week || ' on'
              ELSE 'for Week ' || v_week END
      || ': ' || v_what || ' Finished weeks keep their scoring.';
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (v_lg.id, NULL, v_post, 'league', TRUE);

    v_rewritten := v_rewritten || jsonb_build_array(jsonb_build_object(
      'league_id', v_lg.id, 'status', v_lg.status, 'league', v_lplan, 'live_weeks', v_weeks,
      'fork', v_fork_out, 'week', v_week, 'post', v_post));
  END LOOP;

  -- ── (e) Re-queue the rewritten live weeks' lines holding either new stat,
  --    149:2599's shape: the line's own MIN(updated_at), never now(); a healthy
  --    queue row is never re-stamped. ────────────────────────────────────────
  IF jsonb_array_length(v_requeue) > 0 THEN
    INSERT INTO public.score_fanout (season, week, player_id, enqueued_at)
    SELECT ps.season, ps.week, ps.player_id, min(ps.updated_at)
    FROM public.player_stats ps
    JOIN jsonb_to_recordset(v_requeue) AS q(season INTEGER, week INTEGER)
      ON q.season = ps.season AND q.week = ps.week
    WHERE ps.updated_at IS NOT NULL
      AND (COALESCE(ps.fg_60_plus, 0) <> 0 OR COALESCE(ps.def_2pt_return, 0) <> 0)
    GROUP BY ps.season, ps.week, ps.player_id
    ON CONFLICT (season, week, player_id) DO NOTHING;
    GET DIAGNOSTICS v_requeued = ROW_COUNT;
  END IF;

  -- ── Named, untouched ──────────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(l.id ORDER BY l.id), '[]'::jsonb) INTO v_archived
  FROM public.leagues l
  WHERE l.deleted_at IS NOT NULL AND l.status IN ('drafting', 'in_season', 'playoffs') AND l.season = 2026;
  SELECT COALESCE(jsonb_object_agg(x.why, x.n), '{}'::jsonb) INTO v_outside
  FROM (SELECT CASE WHEN l.season <> 2026 THEN 'season ' || l.season
                    ELSE l.status END AS why, count(*) AS n
        FROM public.leagues l
        WHERE l.deleted_at IS NULL
          AND NOT (l.status IN ('drafting', 'in_season', 'playoffs') AND l.season = 2026)
        GROUP BY 1) x;

  RETURN jsonb_build_object(
    'rewritten', v_rewritten,
    'kept', v_kept,
    'archived_untouched', v_archived,
    'outside_the_change', v_outside,
    'requeued_weeks', v_requeue,
    'requeued_lines', v_requeued);
END;
$$;
REVOKE EXECUTE ON FUNCTION long_fg_two_point_rules_add_internal() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v JSONB;
BEGIN
  v := public.long_fg_two_point_rules_add_internal();
  RAISE NOTICE '218 / F871: rules rewritten (league, what was added, the post): %', v -> 'rewritten';
  RAISE NOTICE '218 / F871: kept (league, why): %', v -> 'kept';
  RAISE NOTICE '218 / F871: archived leagues, untouched: %; outside the change (pre-draft, complete, other seasons), untouched: %',
    v -> 'archived_untouched', v -> 'outside_the_change';
  RAISE NOTICE '218 / F871: live-week lines re-queued: % (weeks %)', v -> 'requeued_lines', v -> 'requeued_weeks';
END
$$;
