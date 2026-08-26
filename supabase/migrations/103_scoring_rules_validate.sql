-- ============================================================================
-- 103 — the §7.3.3.1 guardrail validator, SQL side (SE.4)
--       `scoring_rules_validate(jsonb)` + `scoring_tier_keys_from_cuts(text,
--       jsonb)`. tasks-SE §5 SE.4; spec §7.3.3.1 (the F21-guardrails bullet
--       IN FULL) + §7.3.8's v2.11 bullet ("Exactly one scoring system
--       referenced and readable by the league…"); D168(1) one validator per
--       language; D175 (the wall SE.4b bolts these to); PROGRESS D270.
-- ============================================================================
--
-- WHAT THIS IS. The TS validator (`src/lib/leagues/scoring/validate-rules-
-- doc.ts`, SE.3) is the client's UX pre-check and the service-layer pre-check.
-- §7.3.3.1(5) says in as many words that **client Zod is UX only**: the wall
-- every server write path stands behind is SQL. This migration is that wall's
-- load-bearing half — the same five guardrail families plus §7.3.3.1(c)'s
-- `tier_cuts` residuals, mirrored family-for-family and arm-for-arm. SE.4b
-- bolts it to `scoring_systems` and `leagues` with two triggers (D175/D168);
-- until then it is a callable function and nothing enforces it, which is why
-- F21's ledger row does NOT flip here.
--
-- THE MIRROR IS MEASURED, NOT ASSERTED. `scoring-parity-db.test.ts` runs one
-- shared fixture through BOTH implementations and asserts identical verdicts
-- in both directions — accept AND refuse, with the same guardrail family AND
-- the same dot path (D168(1)'s anti-drift mechanism, built as D269(12) says it
-- must be: a document per ARM, not per NAME). It additionally sweeps all 61
-- registry keys and the full 6 × 48 position matrix through both layers, so
-- the two transcriptions below (the scorable allowlist, the position → legal
-- keys map) are proved against TS's registry rather than eyeballed.
--
-- ── THE THREE PLACES A SQL MIRROR OF A JS RULE CAN GO WRONG, AND WHAT WAS
--    DONE ABOUT EACH (all three measured — §4 rule 9) ──────────────────────
--
-- (1) **The 2-decimal-place rule.** D269(6) hands this over as `scale(p) <= 2`
--     — "Postgres's question", because the TS side is
--     `/^-?\d+(\.\d{1,2})?$/.test(String(value))`. Measured, that pair
--     DISAGREES: `jsonb` preserves a numeric literal byte-exactly, so
--     `{"pass_yards": 0.100}` has `scale() = 3` and is refused by SQL while
--     `String(0.1)` is `"0.1"` and TS accepts it
--     (`select scale((('{"a":0.100}'::jsonb)->>'a')::numeric)` → **3**).
--     `String()` renders the SHORTEST round-tripping decimal, and dropping
--     trailing zeros is exactly what `trim_scale()` does, so the true mirror
--     is **`scale(trim_scale(v)) <= 2`** — used below and pinned in both
--     directions. The residual difference runs the SAFE way only: a literal
--     whose exact decimal carries >2 significant places but whose nearest
--     double renders with ≤2 (`1.0000000000000000001`) is refused by SQL and
--     accepted by TS — a LOUD refusal at the wall, never a silent admission,
--     and unreachable from `JSON.stringify`, which never emits more digits
--     than the shortest round-trip. Pinned as a measured fact, not a hope.
--
-- (2) **Tier-key rendering.** `${lo}` in JS prints an integer without a
--     decimal point; `(7.0)::numeric::text` prints `7.0`, which would generate
--     `def_pa_7.0_13` — a plausible-looking key name nothing would ever look
--     at again (CLAUDE.md's never-let-"nothing happened"-mean-"it worked").
--     Every cut is passed through `trim_scale()` before it is rendered.
--
-- (3) **Report ORDER vs evaluation ORDER.** TS returns every violation, sorted
--     into §7.3.3.1's own family numbering (shape → 1 → 2 → 3 → 4 → 5 →
--     residuals last); SQL RAISEs on the FIRST. So this function evaluates in
--     the REPORT order, not in the order TS happens to compute things: the
--     `tier_cuts` residuals are computed EARLY (guardrail 2 generates key sets
--     from them and must never generate from a list nobody validated — D269(4))
--     but are RAISED LAST. The parity fixture is built from documents that each
--     break exactly one family (D269(7)) precisely so this contract is
--     checkable; within a family, TS reports in insertion order and SQL in
--     `jsonb` storage order, which is why the fixture never leans on a
--     multi-violation document.
--
-- ── ERROR SHAPE (E75: a refusal names its own reason) ──────────────────────
-- ONE `RAISE` site, at the bottom of the checks block, so the shape cannot
-- drift between families:
--     ERRCODE 'P0001'
--     MESSAGE  the TS message, verbatim in structure — it opens with the
--              guardrail's own name ("Scorable allowlist (§7.3.3.1 guardrail
--              1): …"), which is what `FAMILY_NAME_IN_MESSAGE` matches on
--     DETAIL   the dot path of the offending member (`base.def_points_allowed`,
--              `positions.QB.fg_0_39`, `tier_cuts.def_pa`), or `(document)`
--              for a document-level refusal. **The sentinel is INJECTIVE, and
--              the first cut of it was not (R602):** it read "empty path ⇒
--              (document)", but `""` is a legal JSON key, so `{"": 1}` — a
--              concrete allowlist violation at a real field — was reported to
--              SE.5/SE.6 as a document-level refusal. The document-level sites
--              now carry a NULL path and the RAISE COALESCEs, so `(document)`
--              means the document and an empty DETAIL means the empty key.
--              *Residue, named rather than hidden:* the TS side is still
--              ambiguous here (`violation.path` is `''` for both cases) and a
--              format-2 empty key still produces the path `base.`, whose
--              `split('.')` has an empty segment — both are `validate-rules-
--              doc.ts` contracts that SE.6's route layer consumes, so they are
--              filed as **F138** rather than changed from under it
--     HINT     the guardrail family code, the same seven strings the TS
--              `ScoringViolation.code` uses
-- The parity fixture compares all three. SE.5's RPCs and SE.6's routes get the
-- field path for free.
--
-- ── FORM (tasks-M1 §4 rule 1, as SE.4(1) directs) ──────────────────────────
-- BOTH functions are **plain, not SECURITY DEFINER** — they read no table, own
-- no authority, and have nothing to be a confused deputy about. They therefore
-- carry no in-body auth check (there is no subject to authorize) and are
-- `IMMUTABLE` + `SET search_path = ''` with every reference schema-qualified.
-- pgTAP 051 §A pins `prosecdef = false`, the `search_path=""` proconfig and
-- `provolatile = 'i'` for both, so a later "helpful" edit that promotes either
-- to SECURITY DEFINER without in-body auth reds immediately.
-- **REVOKE is emitted anyway** (the 038/059 precedent): the editor is a
-- commissioner surface and anon has no business at it. `authenticated` and
-- `service_role` keep EXECUTE through 037's default ACLs — which is what
-- SE.4b's triggers need, since a trigger function runs as the writing role.
--
-- Migration checklist (§8.1 / §4.4):
--   • RLS: unchanged — no table, no column, no policy touched. **R6 waiver:**
--     no staging clone exists; the rehearsal evidence is the migration applied
--     forward over the 001–102 chain plus the full pgTAP + vitest suites, shown
--     in the SE.4 PR. **D38 waiver:** no new table ⇒ no realtime work and no
--     new RLS/policy suite owed.
--   • Grants: no per-object GRANT (D18/D23 — 037's default ACLs already
--     expose new routines); explicit REVOKE FROM PUBLIC, anon per function,
--     pinned in pgTAP 051 §A.
--   • Typegen: two new PostgREST-visible functions ⇒ `src/types/database.ts`
--     regenerated with the hand-written alias block preserved and re-appended;
--     the diff is additive-only (md5 of the alias block shown either side in
--     the PR).
--   • Nothing above is CREATE OR REPLACE'd, and that was MEASURED rather than
--     assumed (D137's rule) — with a command that stays reproducible after
--     this file exists, by pinning the commit it asks about:
--         git grep -c "scoring_rules_validate\|scoring_tier_keys_from_cuts" \
--             2d2c04b -- supabase/migrations/          →  0 files
--     (the same grep at HEAD returns 1 file: this one). So both names are new
--     and there is no head body to author against. Worth measuring rather than
--     eyeballing: D168's own 2026-08-25 amendment records `draft_start_internal`
--     moving 084 → 092 → 098 in the seven days this lane's breakdown sat still.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. scoring_tier_keys_from_cuts — the SQL twin of `tierKeysFromCuts`
--    (spec §7.3.3.1(a)'s generation rule; SE.1 / `tier-cuts.ts`)
-- ---------------------------------------------------------------------------
--
-- Cut list → tier KEY NAMES, ascending. Tiers are `[cut, next_cut)` with the
-- last open-ended:
--     <prefix>_<lo>_<hi>   with hi = next_cut - 1
--     single-value tier    → <prefix>_<lo>          (e.g. def_pa_0)
--     final open tier      → <prefix>_<lo>_plus     (e.g. def_pa_35_plus)
--
-- The preconditions (≥ 2 cuts · integers · strictly ascending) are the SAME
-- three §7.3.3.1(c) names, and they THROW here exactly as `assertCutList`
-- throws in TS: a malformed list would otherwise generate plausible key names
-- (`def_pa_14_12`, a duplicate) that no validator would ever look at again.
-- The document-level, user-facing arm of those three conditions lives in
-- `scoring_rules_validate` below, which is why that function validates a cut
-- list BEFORE it ever calls this one (D269(4)).
CREATE OR REPLACE FUNCTION public.scoring_tier_keys_from_cuts(
  p_prefix TEXT,
  p_cuts   JSONB
) RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_n    INT;
  v_lo   NUMERIC;
  v_hi   NUMERIC;
  v_prev NUMERIC;
  v_elem JSONB;
  v_keys TEXT[] := ARRAY[]::TEXT[];
  i      INT;
BEGIN
  IF p_cuts IS NULL OR jsonb_typeof(p_cuts) <> 'array' THEN
    RAISE EXCEPTION
      'tier cut list for "%" must be a JSON array of integer cut points (§7.3.3.1(c))',
      p_prefix USING ERRCODE = '22023';
  END IF;

  v_n := jsonb_array_length(p_cuts);
  IF v_n < 2 THEN
    RAISE EXCEPTION
      'tier cut list for "%" needs at least 2 cuts, got % (§7.3.3.1(c) — one cut cannot define a tier boundary)',
      p_prefix, v_n USING ERRCODE = '22023';
  END IF;

  -- Preconditions first, generation second: never generate from a list this
  -- function has not itself vouched for.
  FOR i IN 0 .. v_n - 1 LOOP
    v_elem := p_cuts -> i;
    IF jsonb_typeof(v_elem) <> 'number'
       OR (v_elem #>> '{}')::NUMERIC <> trunc((v_elem #>> '{}')::NUMERIC) THEN
      RAISE EXCEPTION
        'tier cut list for "%" must be integers, got % at index % (§7.3.3.1(c); R58/D58 — the published tables'' domain is the integers)',
        p_prefix, v_elem::TEXT, i USING ERRCODE = '22023';
    END IF;
    -- ── THE DOMAIN CLAUSE (R599; it used to read `> 1e308` and that was the
    -- WRONG BOUND, in the unsafe direction) ─────────────────────────────────
    -- A cut point's domain here is `numeric`; the domain the rest of the
    -- system scores in is IEEE-754 double. Above **2^53** `numeric` holds
    -- integers a double cannot tell apart, and that is what makes the
    -- strictly-ascending residual UNMIRRORABLE: `[0, 9007199254740992,
    -- 9007199254740993]` ascends in `numeric` and collapses to a repeated cut
    -- in JS, so SQL accepted a list TS refuses — and `tierKeysFromCuts`, which
    -- is on the production scoring path via `tierBucketsFromCuts` →
    -- `deriveTierIndicators`, then THREW on it. `> 1e308` never caught it,
    -- and was not even the double range (`Number.MAX_VALUE` is
    -- 1.7976931348623157e308, so `1.5e308` is a finite JS integer this clause
    -- used to void — flipping the reported family and path for no reason).
    -- 2^53 itself is allowed: it is exactly representable, and `cut - 1` at
    -- that bound still is. A PA/YA cut beyond 2^53 has no meaning under
    -- R58/D58 anyway. **The magnitude condition is its own IF so the refusal
    -- names its own reason** (E75): the old single RAISE told a caller that
    -- 1.5e308 "must be an integer", which it is.
    IF abs((v_elem #>> '{}')::NUMERIC) > 9007199254740992 THEN
      RAISE EXCEPTION
        'tier cut list for "%" has a cut of magnitude % at index %, beyond the exactly-representable integer range (|cut| <= 2^53 = 9007199254740992). Above it `numeric` distinguishes integers that IEEE-754 double cannot, so this list would not mean the same thing to the engine that scores it (§7.3.3.1(c); R599)',
        p_prefix, v_elem::TEXT, i USING ERRCODE = '22023';
    END IF;
    v_lo := trim_scale((v_elem #>> '{}')::NUMERIC);
    IF i > 0 AND v_lo <= v_prev THEN
      RAISE EXCEPTION
        'tier cut list for "%" must ascend strictly, got % then % at index % (§7.3.3.1(c) — overlaps and gaps are meant to be unconstructible)',
        p_prefix, v_prev, v_lo, i USING ERRCODE = '22023';
    END IF;
    v_prev := v_lo;
  END LOOP;

  FOR i IN 0 .. v_n - 1 LOOP
    -- trim_scale before rendering: `${7}` is "7" in JS, but (7.0)::text is
    -- "7.0", and a `def_pa_7.0_13` key would be a silently-wrong name.
    v_lo := trim_scale(((p_cuts -> i) #>> '{}')::NUMERIC);
    IF i = v_n - 1 THEN
      v_keys := v_keys || (p_prefix || '_' || v_lo::TEXT || '_plus');
    ELSE
      v_hi := trim_scale(((p_cuts -> (i + 1)) #>> '{}')::NUMERIC - 1);
      IF v_hi = v_lo THEN
        v_keys := v_keys || (p_prefix || '_' || v_lo::TEXT);
      ELSE
        v_keys := v_keys || (p_prefix || '_' || v_lo::TEXT || '_' || v_hi::TEXT);
      END IF;
    END IF;
  END LOOP;

  RETURN v_keys;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.scoring_tier_keys_from_cuts(TEXT, JSONB)
  FROM PUBLIC, anon;

COMMENT ON FUNCTION public.scoring_tier_keys_from_cuts(TEXT, JSONB) IS
  'SE.4 / spec §7.3.3.1(a): cut list → tier key names, the SQL twin of tierKeysFromCuts (src/lib/leagues/scoring/tier-cuts.ts). Preconditions (>= 2 cuts, integers, strictly ascending) raise 22023 — the document-level arm of the same three conditions is scoring_rules_validate. Byte-exact regeneration of the three published families is pinned in pgTAP 051 §B.';

-- ---------------------------------------------------------------------------
-- 2. scoring_rules_validate — the five §7.3.3.1 guardrail families, the SQL
--    mirror of `validateScoringRulesDoc`
-- ---------------------------------------------------------------------------
--
--  1. Scorable allowlist  — every coefficient key ∈ the registry's
--                           `scoring_surface: 'scorable'` set (§23.5 v2.11).
--  2. Tier exclusivity    — the F21 double-pay itself. Format 2: keys ⊆ the
--                           set generated by the doc's OWN tier_cuts. Format 1:
--                           `def_pa_*` ⊆ some published family, `def_ya_*` ⊆
--                           the YA set.
--  3. Position scope      — `positions` keys ⊆ {QB,RB,WR,TE,K,DST}; an override
--                           under P names only P's own section keys.
--  4. Normal form         — no no-op overrides, no empty override objects.
--  5. Bounds              — finite, |coef| ≤ 100, at most 2 decimal places.
--  + §7.3.3.1(c) residuals — tier_cuts ascending, integers, ≥ 2 cuts, both
--                           tables present and independent, and (R592) the
--                           points-allowed table starting at exactly 0.
--
-- A **format-1** document (a flat map with no `format` member — every shipped
-- template) is checked against the three families that have a subject there:
-- allowlist, the format-1 arm of tier exclusivity, and bounds. That the flat
-- arm is checked at all is D269(2)'s reading, and it is load-bearing HERE:
-- D175's wall validates `is_template = TRUE` rows and every live-league-
-- referenced row, so format-1 documents are the majority of what this function
-- will ever see.
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
    'def_points_allowed', 'def_yards_allowed'
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
