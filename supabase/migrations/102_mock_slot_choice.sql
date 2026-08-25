-- ============================================================================
-- 102 — choose your slot when you launch a mock (MS.8)
--       (tasks-MS §5 MS.8; spec §8.8's v2.15 parity block + E77; D223;
--        PROGRESS D261)
-- ============================================================================
--
-- WHAT THIS IS. Chris's motivating case, built: "in my league last place
-- gets to choose their draft position the next year" — someone with a
-- genuine choice of slot needs to TRY each one. At launch the user picks
-- their draft slot, 1..N or Random (the default), and the other seats
-- shuffle around them. Three DROP+CREATEs, all three the D201(2)/AP.5
-- shape (one new parameter, LAST and DEFAULTED; DROP because CREATE OR
-- REPLACE cannot append a parameter — the 087 ambiguity trap — and the
-- REVOKE after each is therefore load-bearing again):
--
--   1. draft_resolve_order_internal (head 066 — never replaced; verified
--      with the sorted-glob rule, D137). + p_pin_team/p_pin_slot: the pin
--      applies ONLY in the seeded-shuffle branch — the other seats keep
--      their md5(seed || id) keys and the pinned seat is spliced in at
--      slot (a CONSTRAINT on the one shuffle, never a second randomizer —
--      D223(5)). When a stored order would win (a drawn lobby order, or
--      manual/custom) a requested pin REFUSES by name: the mock INHERITS
--      a drawn order (§8.8 fidelity, "order incl. their actual slot"),
--      and a slot silently ignored would be a control that lies.
--
--   2. draft_nomination_order_internal (head 098). Pass-through of the
--      same pin to the one shuffle, plus the same drawn-order refusal on
--      the manual arm. DECISION, pinned here: for an AUCTION the slot is
--      the NOMINATION position too — "slot 3" means you nominate third.
--      With same_as_draft_order (the default) the two orders coincide by
--      construction; an independently-random nomination order pins the
--      human at the same slot over its own derived-seed shuffle.
--
--   3. create_mock_draft (head 098:447-970; the file text, D137). + p_slot
--      INTEGER DEFAULT NULL. Range-checked per arm against the board it
--      lands on (22023, names the bound — D146: 1 and N legal, 0 and N+1
--      refuse). League arm: the pin rides the two resolver calls. The
--      standalone arm's inline shuffles (which are deliberately NOT the
--      resolver — 095's own banner says why) gain the same
--      splice-around-the-pin, seeded identically.
--
-- WHAT DOES NOT CHANGE. p_slot NULL reproduces every pre-102 order
-- byte-for-byte (pgTAP 050 pins the equivalence — the backward-compat
-- argument, MS.8 item 4); draft_start's calls pass no pin and real drafts
-- are untouched in every respect (§4 rule 13); the 5-arg named launch
-- call still binds (draft-service sends named args; pinned). §8.8 zero
-- side effects: the slot writes the MOCK'S OWN order and nothing else —
-- no real order need exist ("there is no real draft order, most drafts
-- will set the order right before"), none is read as a constraint, none
-- is written (E77; the composite is pinned in 050).
--
-- Migration checklist (§4.4): RLS unchanged (no table, no policy — R6
-- waiver: function bodies only); grants re-asserted after each DROP+CREATE
-- (§4.1: SECURITY DEFINER + in-body auth + search_path='' preserved from
-- the head texts verbatim); D38 waiver: no new table ⇒ no new RLS/policy
-- suite owed; typegen: create_mock_draft's Args change ⇒ database.ts
-- regenerated (alias block preserved, diff additive-only).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. draft_resolve_order_internal — DROP + CREATE (head 066:345-413).
-- ---------------------------------------------------------------------------
DROP FUNCTION draft_resolve_order_internal(UUID, INTEGER, TEXT, JSONB, JSONB, UUID, TEXT);

CREATE FUNCTION draft_resolve_order_internal(
  p_league_id UUID,
  p_team_count INTEGER,
  p_mode TEXT,
  p_candidate JSONB,
  p_config_order JSONB,
  p_seed UUID,
  p_label TEXT,
  -- 102/MS.8 (D223): the launch-time slot pin — the human's franchise
  -- (p_pin_team) lands at exactly index p_pin_slot-1 and the OTHER seats
  -- keep the same md5(seed || id) shuffle around it. A CONSTRAINT on the
  -- one seeded shuffle, never a second randomizer (D223(5)). LAST and
  -- DEFAULTED so every 7-argument call text still binds — to NULL, which
  -- is exactly the pre-102 behaviour (the AP.5/D201(2) shape).
  p_pin_team UUID DEFAULT NULL,
  p_pin_slot INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_stored JSONB;
  v_valid  BOOLEAN;
  v_order  JSONB;
BEGIN
  -- Draft-row value wins over the settings field (D101); `random`
  -- considers ONLY the draft-row candidate (R123/R126 — the config
  -- fallback is manual/custom-only).
  v_stored := CASE
    WHEN jsonb_typeof(p_candidate) = 'array' THEN p_candidate
    WHEN p_mode IN ('manual', 'custom')
     AND jsonb_typeof(p_config_order) = 'array' THEN p_config_order
    ELSE NULL
  END;
  -- Permutation check, compared as TEXT (malformed entries fail
  -- validation, never a ::uuid cast — the R117 lesson).
  v_valid := v_stored IS NOT NULL AND (
    SELECT count(*) = p_team_count
       AND count(DISTINCT e.val) = p_team_count
       AND bool_and(EXISTS (
             SELECT 1 FROM public.teams t
             WHERE t.league_id = p_league_id
               AND t.status <> 'retired'
               AND t.id::text = e.val))
    FROM jsonb_array_elements_text(v_stored) AS e(val)
  );

  -- 102/MS.8: a slot pin is a constraint on a FRESH shuffle and nothing
  -- else. When a stored order would win — a drawn lobby order (D101) or a
  -- manual/custom settings order — the mock INHERITS it (§8.8 fidelity),
  -- so a requested slot is refused by name rather than silently ignored.
  -- Order-neutral wording on purpose: the nomination arm routes here too.
  IF p_pin_slot IS NOT NULL THEN
    IF p_pin_slot < 1 OR p_pin_slot > p_team_count THEN
      RAISE EXCEPTION '%: pin slot % is out of range for % teams',
        p_label, p_pin_slot, p_team_count
        USING ERRCODE = '22023';
    END IF;
    IF v_valid THEN
      RAISE EXCEPTION
        '%: a stored order already covers this league — a practice draft inherits it (§8.8/D223); launch without a slot to practice from the stored order',
        p_label
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_mode IN ('manual', 'custom') THEN
    IF NOT v_valid THEN
      RAISE EXCEPTION
        '%: league % has draft_order_mode=% but the stored draft order does not cover every active franchise exactly once — re-save the order in Draft setup (§8.3)',
        p_label, p_league_id, p_mode
        USING ERRCODE = 'P0001';
    END IF;
    v_order := v_stored;
  ELSE
    IF v_valid THEN
      -- D101: a pre-start randomize already wrote (and the lobby already
      -- showed) this order — honor it.
      v_order := v_stored;
    ELSE
      -- Deterministic seeded shuffle (D105): seed = the caller's draft id.
      IF p_pin_slot IS NULL THEN
        SELECT jsonb_agg(to_jsonb(t.id) ORDER BY md5(p_seed::text || t.id::text))
          INTO v_order
        FROM public.teams t
        WHERE t.league_id = p_league_id AND t.status <> 'retired';
      ELSE
        -- 102/MS.8 (D223(5)): the SAME shuffle over the other seats, then
        -- the pinned seat spliced in at its slot. Deterministic per
        -- (seed, slot): the md5 keys of the other seats do not change.
        SELECT COALESCE(
                 jsonb_agg(to_jsonb(t.id) ORDER BY md5(p_seed::text || t.id::text)),
                 '[]'::jsonb)
          INTO v_order
        FROM public.teams t
        WHERE t.league_id = p_league_id
          AND t.status <> 'retired'
          AND t.id <> p_pin_team;
        -- jsonb_insert places before index slot-1; index = array length
        -- (slot = N) appends — measured, both boundaries pinned (pgTAP 050).
        v_order := jsonb_insert(v_order, ARRAY[(p_pin_slot - 1)::text],
                                to_jsonb(p_pin_team));
      END IF;
    END IF;
  END IF;

  RETURN v_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  draft_resolve_order_internal(UUID, INTEGER, TEXT, JSONB, JSONB, UUID, TEXT, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. draft_nomination_order_internal — DROP + CREATE (head 098:77-158).
-- ---------------------------------------------------------------------------
DROP FUNCTION draft_nomination_order_internal(UUID, INTEGER, TEXT, JSONB, JSONB, UUID, TEXT, JSONB);

CREATE FUNCTION draft_nomination_order_internal(
  p_league_id   UUID,
  p_team_count  INTEGER,
  p_mode        TEXT,
  p_candidate   JSONB,     -- drafts.nomination_order as stored (a pre-start edit)
  p_draft_order JSONB,     -- the RESOLVED draft order (same_as_draft_order's source)
  p_seed        UUID,      -- the draft id; the random arm derives its own seed
  p_label       TEXT,
  -- 098/AP.5 (F80 arm (b)): settings.draft.nomination_order — the §7.3.8
  -- catalog field the manual arm falls back to when the draft row has not
  -- stored one, mirroring draft_resolve_order_internal's p_config_order
  -- (D101 candidate-wins). LAST and DEFAULTED so the parameter arrives
  -- without an overload beside the old signature (the 087 ambiguity trap,
  -- D201(2)) and any 7-argument call text still binds — to NULL, which is
  -- exactly the pre-098 behaviour.
  p_config_order JSONB DEFAULT NULL,
  -- 102/MS.8 (D223): the launch-time slot pin, passed through to the ONE
  -- shuffle (draft_resolve_order_internal). For an auction the slot is the
  -- NOMINATION position too — 'slot 3' means you nominate third. LAST and
  -- DEFAULTED (the AP.5/D201(2) shape): every 8-argument call still binds.
  p_pin_team UUID DEFAULT NULL,
  p_pin_slot INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_stored JSONB;
  v_valid BOOLEAN;
BEGIN
  IF p_mode = 'manual' THEN
    -- 098/AP.5: candidate-then-settings, the CASE draft_resolve_order_internal
    -- uses verbatim (066:366-370's D101 rule) — the draft row's stored order
    -- wins, the settings catalog's is the fallback.
    v_stored := CASE
      WHEN jsonb_typeof(p_candidate) = 'array' THEN p_candidate
      WHEN jsonb_typeof(p_config_order) = 'array' THEN p_config_order
      ELSE NULL
    END;
    -- Permutation of the active franchises, compared as TEXT (malformed
    -- entries fail validation rather than blowing up a ::uuid cast — the
    -- R117 lesson, same shape as draft_resolve_order_internal's check).
    v_valid := v_stored IS NOT NULL AND (
      SELECT count(*) = p_team_count
         AND count(DISTINCT e.val) = p_team_count
         AND bool_and(EXISTS (
               SELECT 1 FROM public.teams t
               WHERE t.league_id = p_league_id
                 AND t.status <> 'retired'
                 AND t.id::text = e.val))
      FROM jsonb_array_elements_text(v_stored) AS e(val)
    );
    IF NOT v_valid THEN
      RAISE EXCEPTION
        '%: league % has nomination_order_mode=manual but the stored nomination order does not cover every active franchise exactly once — set the nomination order in the commissioner panel, or switch nomination_order_mode to same_as_draft_order (§8.3)',
        p_label, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    -- 102/MS.8: a drawn manual nomination order is inherited (§8.8
    -- fidelity), so a requested slot refuses by name rather than being
    -- silently ignored — the resolver's own sentence, verbatim.
    IF p_pin_slot IS NOT NULL THEN
      RAISE EXCEPTION
        '%: a stored order already covers this league — a practice draft inherits it (§8.8/D223); launch without a slot to practice from the stored order',
        p_label
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_stored;

  ELSIF p_mode = 'random' THEN
    -- The ONE order-resolution implementation (066/D107(2)): D101's
    -- candidate-wins rule + D105's md5 shuffle, unforked. The seed is
    -- DERIVED from the draft id so a random nomination order is not a
    -- carbon copy of a random draft order (see the banner).
    RETURN public.draft_resolve_order_internal(
      p_league_id,
      p_team_count,
      'random',
      p_candidate,
      NULL,                                        -- settings fallback is
                                                   -- manual-only (R123/R126,
                                                   -- like draft_order's)
      md5('nomination:' || p_seed::text)::uuid,
      p_label,
      p_pin_team,
      p_pin_slot);

  ELSE
    -- 'same_as_draft_order' — the §7.3.8 default, and the fallback for an
    -- unrecognized mode (the catalog enum is closed API-side; this mirrors
    -- draft_start's COALESCE(draft_order_mode, 'random') shape).
    RETURN p_draft_order;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  draft_nomination_order_internal(UUID, INTEGER, TEXT, JSONB, JSONB, UUID, TEXT, JSONB, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. create_mock_draft — DROP + CREATE (head 098:447-970, the file text).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS create_mock_draft(UUID, UUID, TEXT, UUID, JSONB);

CREATE FUNCTION create_mock_draft(
  p_league_id UUID DEFAULT NULL,
  p_human_team_id UUID DEFAULT NULL,
  p_cpu_speed TEXT DEFAULT 'realistic',
  p_action_id UUID DEFAULT NULL,
  p_settings JSONB DEFAULT NULL,
  -- 102/MS.8 (D223; §8.8 parity; E77): the launch-time DRAFT SLOT — 1..N,
  -- NULL = Random (today's behaviour, byte-for-byte). The human's seat
  -- lands at exactly this index in the mock's own order and the other
  -- seats shuffle around it through the ONE seeded implementation. For an
  -- auction the slot is the NOMINATION position too ('slot 3' = you
  -- nominate third; with same_as_draft_order the two coincide by
  -- construction). LAST and DEFAULTED (D201(2)/AP.5's shape): every
  -- 5-argument call text still binds — DROP+CREATE because CREATE OR
  -- REPLACE cannot append a parameter (the 087 ambiguity trap), so the
  -- REVOKE below is load-bearing again (ACL reset).
  p_slot INTEGER DEFAULT NULL
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
  -- 095 (MP.3) — the STANDALONE arm:
  v_uid          UUID;
  v_roster       JSONB;
  v_team_count   INTEGER;
  v_order_mode   TEXT;
  v_nom_mode     TEXT;
  v_seat_ids     UUID[] := '{}';
  v_seat         UUID;
  v_cpu_seats    JSONB := '[]'::jsonb;
  v_i            INTEGER;
  v_mock_block   JSONB;
BEGIN
  -- Argument shape (22023) before any data access.
  IF p_cpu_speed IS NULL OR p_cpu_speed NOT IN ('realistic', 'fast') THEN
    RAISE EXCEPTION 'create_mock_draft: cpu_speed must be realistic or fast'
      USING ERRCODE = '22023';
  END IF;

  -- 095/MP.3 — THE TWO ARMS ARE MUTUALLY EXCLUSIVE, AND SAYING SO IS THE
  -- WHOLE §4-rule-12 CONTRACT. A league mock's settings come from its
  -- league and are SNAPSHOTTED (D95: a mock never re-hydrates); a
  -- standalone mock's settings arrive as an OBJECT and the caller decides
  -- where the object came from. Accepting both at once would make the
  -- precedence a guess, and a caller who sent settings would silently get
  -- the league's instead.
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'create_mock_draft: must be signed in to practice'
      USING ERRCODE = '42501';
  END IF;
  IF p_league_id IS NOT NULL AND p_settings IS NOT NULL THEN
    RAISE EXCEPTION
      'create_mock_draft: a league mock takes its settings FROM the league — send settings only for a standalone practice draft (§8.8/D95)'
      USING ERRCODE = '22023';
  END IF;
  IF p_league_id IS NULL AND p_settings IS NULL THEN
    RAISE EXCEPTION
      'create_mock_draft: a standalone practice draft needs a settings object (team_count, roster_settings, draft)'
      USING ERRCODE = '22023';
  END IF;
  IF p_league_id IS NULL AND p_human_team_id IS NOT NULL THEN
    -- There is no franchise to borrow: this arm MINTS the human's seat.
    -- (MS.8's slot picker rides this same RPC as a future parameter — it
    -- chooses a POSITION in the order, never an existing team row.)
    RAISE EXCEPTION
      'create_mock_draft: a standalone practice draft mints its own seats — human_team_id applies to a league mock only'
      USING ERRCODE = '22023';
  END IF;

  -- Cap-race serializer (banner item 1): same-user concurrent launches
  -- serialize here so the §22.5 caps cannot be double-tapped past. An
  -- ADVISORY lock, deliberately not a profiles-row lock (row locks on
  -- profiles join the FK KEY-SHARE graph chat INSERTs touch — the R122
  -- deadlock class; advisory locks live outside it).
  PERFORM pg_advisory_xact_lock(
    hashtextextended('create_mock_draft:' || v_uid::text, 0));

  -- §4 rule 6 (E2) idempotency — batch 7, R149 (banner item 1): a retry of
  -- an already-committed launch returns the ORIGINAL mock, not a second
  -- one (the 060 replay pattern). AFTER the advisory lock (a concurrent
  -- double-tap serializes into create-then-replay) and BEFORE league/cap
  -- validation (the same intent must not trip caps its own creation
  -- already passed). Launcher-scoped + TEXT-compared (R117): a foreign
  -- caller's lookup simply misses and falls through to their own
  -- validation. A deleted mock does not replay (row = ledger). The replay
  -- is arm-agnostic on purpose — the action_id identifies the SUBMIT, and
  -- a retried submit must never mint a second set of seats.
  IF p_action_id IS NOT NULL THEN
    SELECT d.* INTO v_draft
    FROM public.drafts d
    WHERE d.is_mock
      AND d.config->'mock'->>'launched_by' = v_uid::text
      AND d.config->'mock'->>'action_id' = p_action_id::text;
    IF FOUND THEN
      RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'created', FALSE);
    END IF;
  END IF;

  v_mock_id := gen_random_uuid();

  IF p_league_id IS NULL THEN
    -- =====================================================================
    -- THE STANDALONE ARM (095/MP.3; D226/D227/D234; tasks-MP §4 rule 12).
    -- No league, no membership, no commissioner. The settings arrive as an
    -- object and are validated here; WHERE the object came from is the
    -- caller's business (MP.4 fills it from a base scoring template; league
    -- inheritance, when it returns, is a new SOURCE and not a rewrite).
    -- =====================================================================
    IF jsonb_typeof(p_settings) <> 'object' THEN
      RAISE EXCEPTION 'create_mock_draft: settings must be a JSON object'
        USING ERRCODE = '22023';
    END IF;

    -- team_count — the §7.2 v1 seat counts (league-settings.ts V1_TEAM_COUNTS).
    -- This is the one number that decides how many rows this transaction
    -- MINTS, so it is checked before anything is written.
    IF jsonb_typeof(p_settings->'team_count') <> 'number' THEN
      RAISE EXCEPTION 'create_mock_draft: settings.team_count is required (8, 10, 12, 14 or 16)'
        USING ERRCODE = '22023';
    END IF;
    v_team_count := (p_settings->>'team_count')::int;
    IF v_team_count NOT IN (8, 10, 12, 14, 16) THEN
      RAISE EXCEPTION
        'create_mock_draft: team_count % is not a v1 league size — practice with 8, 10, 12, 14 or 16 seats',
        v_team_count
        USING ERRCODE = '22023';
    END IF;

    -- 102/MS.8: the slot is bounded by the board it lands on (D146: 1 and
    -- N are legal, 0 and N+1 refuse by name — pinned one unit either side).
    IF p_slot IS NOT NULL AND (p_slot < 1 OR p_slot > v_team_count) THEN
      RAISE EXCEPTION
        'create_mock_draft: slot % is out of range — this practice draft has % seats (pick 1..%, or leave the slot on Random)',
        p_slot, v_team_count, v_team_count
        USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(p_settings->'roster_settings') <> 'object' THEN
      RAISE EXCEPTION 'create_mock_draft: settings.roster_settings is required (the roster shape MP.2 snapshots)'
        USING ERRCODE = '22023';
    END IF;
    v_roster := p_settings->'roster_settings';

    v_config := COALESCE(p_settings->'draft', '{}'::jsonb);
    IF jsonb_typeof(v_config) <> 'object' THEN
      RAISE EXCEPTION 'create_mock_draft: settings.draft must be a JSON object'
        USING ERRCODE = '22023';
    END IF;

    v_type := COALESCE(v_config->>'draft_type', 'snake');
    IF v_type NOT IN ('snake', 'linear', 'auction') THEN
      RAISE EXCEPTION 'create_mock_draft: draft_type % is not snake, linear or auction', v_type
        USING ERRCODE = '22023';
    END IF;

    -- The §7.3.8 draft ranges AND the §7.3.2 roster bounds, mirrored from the
    -- ONE catalog the app validates against (see the guard's own header).
    -- Mirrored DELIBERATELY rather than trusted: this RPC is EXECUTE-able by
    -- `authenticated`, so a client that skips the route reaches it directly,
    -- and every one of these numbers can WEDGE the engine (a 0-second bid
    -- clock never closes a nomination; an unbounded bench is an unbounded
    -- auction capacity, because `draft_team_budget` reads `total_rounds`).
    -- MP.4's form parses with the zod schema; this is the server floor under
    -- it, not a second opinion. R498: the roster half was missing from the
    -- first cut and is the reason this call takes two arguments.
    PERFORM public.draft_settings_range_guard(v_config, v_roster);

    v_order_mode := COALESCE(v_config->>'draft_order_mode', 'random');
    IF v_order_mode <> 'random' THEN
      -- A standalone mock has no stored league order to honour and no
      -- pre-draft lobby to have randomized one — `random` is the only mode
      -- that MEANS anything here. (MS.8's slot picker chooses the human's
      -- POSITION in that shuffle; it does not resurrect `manual`.)
      RAISE EXCEPTION
        'create_mock_draft: draft_order_mode % has no meaning without a league — a standalone practice draft shuffles its own seats',
        v_order_mode
        USING ERRCODE = '22023';
    END IF;
    v_nom_mode := COALESCE(v_config->>'nomination_order_mode', 'same_as_draft_order');
    IF v_nom_mode NOT IN ('same_as_draft_order', 'random') THEN
      RAISE EXCEPTION
        'create_mock_draft: nomination_order_mode % has no meaning without a league — use same_as_draft_order or random',
        v_nom_mode
        USING ERRCODE = '22023';
    END IF;

    -- MP.2's roster snapshot, written by this arm ITSELF — there is no
    -- league to copy it from, and both readers now RAISE on a mock whose
    -- config lacks the `roster` KEY (094 §2a/R491). Same key, same whole
    -- object, same reason.
    v_config := jsonb_set(v_config, '{roster}', v_roster);

  ELSE
    -- =====================================================================
    -- THE LEAGUE ARM — 092/094's text, unchanged (tasks-MP §4 rule 11).
    -- =====================================================================
    -- Fast-fail auth (no-leak: a nonexistent league answers 42501 too).
    IF NOT public.is_league_member(p_league_id) THEN
      RAISE EXCEPTION 'create_mock_draft: not a member of this league'
        USING ERRCODE = '42501';
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

    -- 102/MS.8: same bound, the league's board (D146 both edges pinned).
    IF p_slot IS NOT NULL AND (p_slot < 1 OR p_slot > v_league.team_count) THEN
      RAISE EXCEPTION
        'create_mock_draft: slot % is out of range — this practice draft has % seats (pick 1..%, or leave the slot on Random)',
        p_slot, v_league.team_count, v_league.team_count
        USING ERRCODE = '22023';
    END IF;

    -- D95: snapshot the REAL config at launch — a mock never re-hydrates.
    -- Read here so config-shape refusals (auction) answer before seat-map
    -- ones.
    v_config := COALESCE(v_league.settings->'draft', '{}'::jsonb);

    -- 094/MP.2 — the roster SHAPE joins the snapshot, because D95's promise
    -- was never true of it: `roster_settings` is a separate COLUMN on
    -- `leagues`, not part of `settings->'draft'`.
    v_config := jsonb_set(v_config, '{roster}',
                          COALESCE(v_league.roster_settings, '{}'::jsonb));
    v_roster := v_league.roster_settings;

    -- 089 (L.C1.7): the M3 seam is LIFTED — a mock auction launches through
    -- the same arm shape draft_start's auction arm has (084).
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
  END IF;

  -- §22.5 caps, in-body (friendly refusals — §16.5.2 states). Counted
  -- across ALL leagues AND standalone practice alike (per-USER caps — the
  -- cap has never been per-league, and a standalone mock costs the same
  -- tick budget as a league one).
  SELECT count(*) INTO v_active_mocks
  FROM public.drafts d
  WHERE d.is_mock
    AND d.status IN ('live', 'paused')
    AND d.config->'mock'->>'launched_by' = v_uid::text;
  IF v_active_mocks >= 3 THEN
    RAISE EXCEPTION
      'create_mock_draft: you already have 3 active mock drafts — finish or delete one first (§22.5)'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_hour_creates
  FROM public.drafts d
  WHERE d.is_mock
    AND d.config->'mock'->>'launched_by' = v_uid::text
    AND d.created_at > now() - interval '1 hour';
  IF v_hour_creates >= 5 THEN
    RAISE EXCEPTION
      'create_mock_draft: mock-draft creation is limited to 5 per hour — try again in a bit (§22.5)'
      USING ERRCODE = 'P0001';
  END IF;

  -- D91: rounds = starters + bench (IR excluded) — the same fn the real
  -- start uses, over the same object both arms just resolved.
  v_total_rounds := public.draft_rounds_from_roster(v_roster);
  IF v_total_rounds IS NULL OR v_total_rounds < 1 THEN
    -- The league arm's message is 092's, VERBATIM and golden-pinned
    -- (pgTAP 025). The standalone arm cannot use it — it names a league that
    -- does not exist and points at a settings screen that is not the one the
    -- caller used — so it gets its own, and the league text is untouched.
    IF p_league_id IS NULL THEN
      RAISE EXCEPTION
        'create_mock_draft: these roster settings produce no draftable rounds (rounds = starters + bench, D91) — add starting slots or bench spots'
        USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION
        'create_mock_draft: league % roster settings produce no draftable rounds (rounds = starters + bench, D91) — fix the roster in League settings',
        p_league_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_league_id IS NULL THEN
    -- ---------------------------------------------------------------------
    -- THE SEATS (D227). `draft_picks.team_id` is NOT NULL FK `teams`
    -- (065:160) and the order needs every seat, so a board with no league
    -- still needs N `teams` rows. They are standalone rows — `league_id
    -- NULL`, `list_id NULL`, owner = the launcher — minted INSIDE the
    -- launch transaction, so a failure anywhere below leaves none behind.
    -- The human's seat is minted too: with no league there is no franchise
    -- to borrow (D227(2)).
    -- ---------------------------------------------------------------------
    INSERT INTO public.teams (owner_id, name, league_id, list_id)
    VALUES (v_uid, 'My Team', NULL, NULL)
    RETURNING id INTO v_human;
    v_seat_ids := array_append(v_seat_ids, v_human);

    FOR v_i IN 1..(v_team_count - 1) LOOP
      -- D227(5): one naming rule, not a system. `CPU 1 … CPU N-1`. No
      -- avatars, no personas, no generated team names (tasks-MP §4 rule 16).
      INSERT INTO public.teams (owner_id, name, league_id, list_id)
      VALUES (v_uid, 'CPU ' || v_i::text, NULL, NULL)
      RETURNING id INTO v_seat;
      v_seat_ids := array_append(v_seat_ids, v_seat);
      v_cpu_seats := v_cpu_seats || to_jsonb(v_seat::text);
    END LOOP;

    -- The order: D105's deterministic md5 shuffle seeded by the MOCK's own
    -- id, over the seats this transaction just minted.
    --
    -- DELIBERATELY NOT `draft_resolve_order_internal` (066), and the reason
    -- matters more than the eleven lines it saves. That function resolves an
    -- order over a LEAGUE's seat table — every branch of it, including the
    -- shuffle, is `FROM public.teams t WHERE t.league_id = p_league_id`.
    -- Widening that to `IS NOT DISTINCT FROM` so it would accept a NULL
    -- league does not make it work: its shuffle branch would then select
    -- EVERY standalone team in the database. The candidate/manual/config
    -- machinery it exists for has no meaning here either — there is no
    -- stored league order and no lobby randomize to honour (D101), which is
    -- why `draft_order_mode` is refused above unless it is `random`. So the
    -- ONE implementation keeps the ONE question it answers, and this arm
    -- answers a different one over an array it holds in hand.
    IF p_slot IS NULL THEN
      SELECT jsonb_agg(to_jsonb(s.id) ORDER BY md5(v_mock_id::text || s.id::text))
        INTO v_order
      FROM unnest(v_seat_ids) AS s(id);
    ELSE
      -- 102/MS.8 (D223(5)): the slot is a CONSTRAINT on the SAME seeded
      -- shuffle — the bot seats keep their md5(mock_id || id) order and the
      -- human's seat is spliced in at slot (jsonb_insert before index
      -- slot-1; index = array length appends, i.e. slot = N — measured).
      SELECT COALESCE(
               jsonb_agg(to_jsonb(s.id) ORDER BY md5(v_mock_id::text || s.id::text)),
               '[]'::jsonb)
        INTO v_order
      FROM unnest(v_seat_ids) AS s(id)
      WHERE s.id <> v_human;
      v_order := jsonb_insert(v_order, ARRAY[(p_slot - 1)::text],
                              to_jsonb(v_human));
    END IF;

    IF v_type = 'auction' THEN
      IF v_nom_mode = 'random' THEN
        -- 084's derived seed, verbatim in shape: a random nomination order
        -- must not be a carbon copy of a random draft order (D105).
        IF p_slot IS NULL THEN
          SELECT jsonb_agg(to_jsonb(s.id)
                   ORDER BY md5(md5('nomination:' || v_mock_id::text) || s.id::text))
            INTO v_nom_order
          FROM unnest(v_seat_ids) AS s(id);
        ELSE
          -- 102/MS.8: an auction's slot is the NOMINATION position too, so
          -- an independently-random nomination order pins the human at the
          -- same slot over its own derived-seed shuffle (084's seed, D105).
          SELECT COALESCE(
                   jsonb_agg(to_jsonb(s.id)
                     ORDER BY md5(md5('nomination:' || v_mock_id::text) || s.id::text)),
                   '[]'::jsonb)
            INTO v_nom_order
          FROM unnest(v_seat_ids) AS s(id)
          WHERE s.id <> v_human;
          v_nom_order := jsonb_insert(v_nom_order, ARRAY[(p_slot - 1)::text],
                                      to_jsonb(v_human));
        END IF;
      ELSE
        v_nom_order := v_order;                  -- same_as_draft_order
      END IF;
    END IF;

  ELSE
    -- Seat resolution: default = the launcher's own franchise (§8.8 "their
    -- real seat by default"); ANY active seat selectable (placeholder or
    -- another member's franchise — authorization is launcher-keyed, D103).
    IF p_human_team_id IS NULL THEN
      SELECT m.team_id INTO v_human
      FROM public.league_members m
      WHERE m.league_id = p_league_id AND m.user_id = v_uid;
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

    -- 102/MS.8: the pin rides the ONE resolver (D223(5)). NULL slot = the
    -- shipped call exactly; a slot against a DRAWN order (a stored lobby
    -- order, or manual/custom) refuses by name inside the resolver — the
    -- mock inherits a drawn order (§8.8 fidelity), it never overrides it.
    v_order := public.draft_resolve_order_internal(
      p_league_id,
      v_league.team_count,
      COALESCE(v_config->>'draft_order_mode', 'random'),
      v_real_order,
      v_config->'draft_order',
      v_mock_id,
      'create_mock_draft',
      v_human,
      p_slot);

    -- 089: nomination order (§8.3/§7.3.8) — auction only, through 084's ONE
    -- implementation with the rules draft_start applies. 098/AP.5 (F80): the
    -- league's settings fallback rides along, so a pre-start `manual` league
    -- (whose real draft row has hydrated nothing yet) can still be practiced
    -- in — the mock resolves the SAME order draft_start will.
    IF v_type = 'auction' THEN
      v_nom_order := public.draft_nomination_order_internal(
        p_league_id,
        v_league.team_count,
        COALESCE(v_config->>'nomination_order_mode', 'same_as_draft_order'),
        v_real_nom,
        v_order,
        v_mock_id,
        'create_mock_draft',
        v_config->'nomination_order',
        v_human,
        p_slot);
    END IF;
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
  --
  -- 095/MP.3 adds ONE key and only on the standalone arm: `cpu_seats`, the
  -- ids of the bot `teams` rows this transaction minted. It is not
  -- decoration — it is the DELETE authority for cleanup (delete_mock_draft
  -- / mock_draft_expire) and the predicate the narrowed teams policy reads
  -- (D227(4)). A league mock mints nothing, so it stores nothing: an unread
  -- stored field is a claim nobody checks (D236(4)).
  v_mock_block := jsonb_build_object(
    'human_team_id', v_human::text,
    'cpu_speed', p_cpu_speed,
    'launched_by', v_uid::text)
    || CASE WHEN p_action_id IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('action_id', p_action_id::text) END
    || CASE WHEN p_league_id IS NULL THEN jsonb_build_object('cpu_seats', v_cpu_seats)
            ELSE '{}'::jsonb END;
  v_config := jsonb_set(v_config, '{mock}', v_mock_block);

  -- Starts immediately (§8.8): live, pick 1 (= nomination sequence 1 for an
  -- auction — D126) on the clock; `current_nomination` NULL ⇒ the
  -- NOMINATING phase; `budget_adjustments` is the column default '{}' (a
  -- mock has no commissioner to adjust anything — D110(1)/D138). The D95
  -- partial unique ignores mocks — the league's real scheduled draft
  -- coexists (E60) — and it is `WHERE is_mock = false`, so a NULL
  -- `league_id` cannot collide with it either (measured, D234(4)).
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
  -- one either: "Same engine, literally" (§8.8) — and so, now, cannot a
  -- settings object (095: draft_auction_solvent sweeps the mock's own seat
  -- map when there is no league).
  IF v_type = 'auction' AND NOT public.draft_auction_solvent(v_mock_id) THEN
    v_budget  := COALESCE((v_config->>'auction_budget')::int, 200);
    -- 092/AP.1: the reserve, through the ONE authority (D198(1)).
    v_reserve := public.draft_auction_reserve(v_config);
    -- Same rule: 089's message is golden-pinned (pgTAP 038) and stays
    -- byte-for-byte on the league arm.
    IF p_league_id IS NULL THEN
      RAISE EXCEPTION
        'create_mock_draft: this setup cannot practice an auction — a $% budget cannot fill % draftable roster spots at a $% per-slot reserve (§8.6.8 solvency); raise the auction budget, or allow $0 nominations',
        v_budget, v_total_rounds, v_reserve
        USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION
        'create_mock_draft: league % cannot practice an auction — a $% budget cannot fill % draftable roster spots at a $% per-slot reserve (§8.6.8 solvency); raise the auction budget, or allow $0 nominations in League settings → Draft setup',
        p_league_id, v_budget, v_total_rounds, v_reserve
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Launch is the launcher's first liveness beat (banner item 1): the E59
  -- stale clock starts honest even if the room never mounts, and the
  -- expiry idle definition always has a beat to read.
  INSERT INTO public.draft_liveness (draft_id, user_id, last_seen_at)
  VALUES (v_mock_id, v_uid, now())
  ON CONFLICT (draft_id, user_id) DO UPDATE SET last_seen_at = now();

  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'created', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION create_mock_draft(UUID, UUID, TEXT, UUID, JSONB, INTEGER)
  FROM PUBLIC, anon;
