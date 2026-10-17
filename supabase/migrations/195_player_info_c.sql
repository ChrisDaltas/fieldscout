-- ============================================================================
-- 195 — player info batch C (Chris 2026-10-17, "fix and resolve these as best
--       you can"; F578; PROGRESS D539 / D540)
-- ============================================================================
--
-- WHAT THIS ADDS:
--
--   (1) players.forty_time — the player's NFL Combine 40-yard dash, seconds
--       (NUMERIC(3,2), e.g. 4.38). Written ONLY by the `sync:combine` script
--       (nflverse's free combine + players files, plain fetch, matched on the
--       ESPN id — CLAUDE.md "player data is read-only"). NULL = no recorded
--       time (did not run, or no id match) — never a guess. A CHECK keeps a
--       stored value physically possible (3.50 < t < 7.00).
--
--   (2) scoring_rules_validate — re-created VERBATIM from the HEAD of its
--       chain (103, the only migration that defines it) with ONE change: the
--       five F578 usage keys join `c_context`, mirroring STAT_KEYS (they are
--       `scoring_surface: 'context'` — never payable; a document naming one
--       is refused as a context key, exactly as the TS validator words it).
--       scoring-parity-db.test.ts sweeps every registry key across both.
--
--   (3) stat_key_label_internal — re-created VERBATIM from the HEAD of its
--       chain (172, the only migration that defines it) with the five keys'
--       plain words added (generated from the registry by
--       stat-correction-labels.ts; its census test now reads THIS file).
--
-- The usage keys themselves (off_snaps, pass_rz_att, rush_rz_att,
-- rec_rz_tgt, fg_long) need NO column: they live in player_stats.advanced
-- (§23.5's storage rule — "new stats require no migration").
--
-- CHECKLIST (tasks-M* §4.4): one nullable column on a world-readable,
-- client-immutable table (players has SELECT-only policies — no new policy,
-- no grant change; pgTAP 143 proves anon / authenticated still cannot write
-- the column, RETURNING counts per role). Both functions keep their exact
-- signatures, volatility, search_path and REVOKEs (scoring_rules_validate:
-- REVOKE PUBLIC, anon — as 103; stat_key_label_internal: REVOKE PUBLIC, anon,
-- authenticated — as 172). No SECURITY DEFINER added. No R6 / D38 waiver
-- needed. DEPLOY BEFORE PUSH: the app reads `forty_time` only through
-- `select('*')`-free reads that tolerate its absence (the player view shows
-- no 40 tile until the column and the sync exist). pgTAP 143_player_info_c.sql.
-- ============================================================================

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS forty_time NUMERIC(3,2)
    CHECK (forty_time IS NULL OR (forty_time > 3.50 AND forty_time < 7.00));

COMMENT ON COLUMN public.players.forty_time IS
  'NFL Combine 40-yard dash in seconds (F578 / D540). Written only by scripts/sync-combine.ts from nflverse combine.csv, matched on espn_id via nflverse players.csv. NULL = no recorded time.';

CREATE OR REPLACE FUNCTION public.scoring_rules_validate(p_rules JSONB)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  -- ── The registry, transcribed (§23.5 v2.11's `scoring_surface`) ──────────
  -- The 28 non-tier scorable keys, then the 20 tier keys the three published
  -- cut lists generate. Proved ≡ TS's `SCORABLE_KEYS` over all 61 registry
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
    'fg_0_39', 'fg_40_49', 'fg_50_plus', 'pat_made', 'fg_missed', 'pat_missed'
  ];
  c_dst_events CONSTANT TEXT[] := ARRAY[
    'def_sack', 'def_int', 'def_fumble_rec', 'def_td', 'def_safety',
    'def_block', 'def_return_td'
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
