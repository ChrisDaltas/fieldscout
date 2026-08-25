-- ============================================================================
-- 098 — the auction's manual nomination order becomes reachable
--       (AP task AP.5; ledger F80 arm (b); spec v2.16 §7.3.8 `nomination_order`
--       row + its validation bullet, §8.3's auction line, §16.2; D201)
-- ============================================================================
--
-- WHAT THIS FIXES. §7.3.8 lists three `nomination_order_mode`s and the third
-- (`manual`) was a trap: 084's manual arm validates a STORED
-- `drafts.nomination_order`, and the only writer of that column
-- (`draft_set_order`, 087) refuses a pre-start auction — so the two surfaces
-- pointed at each other and a league that stored `manual` could not start its
-- draft at all (F80, found at L.C3.2). The fix is the row's own arm (b),
-- ruled at D201(1): a `nomination_order` array in the §7.3.8 settings catalog
-- that `draft_start` hydrates — exactly what `draft_order` already does for
-- snake through `draft_resolve_order_internal`'s candidate-then-settings
-- resolution (066:345-410; the D101 candidate-wins rule).
--
-- FOUR FUNCTIONS MOVE, each authored against its chain HEAD's file text
-- (D137 / CLAUDE.md), re-derived at task time with
-- `grep -n "FUNCTION.*<name>" supabase/migrations/*.sql`:
--
--   1. `draft_nomination_order_internal` — head **084:415-476** (its only
--      definition). DROP + CREATE, because CREATE OR REPLACE cannot add a
--      parameter and a defaulted overload BESIDE the old signature is the
--      ambiguity trap 087 hit twice (D201(2); 087:1500/1794 precedent). The
--      new `p_config_order` is LAST and `DEFAULT NULL`, so any 7-argument
--      call text binds to NULL — the pre-098 behaviour exactly. The manual
--      arm becomes candidate-then-settings (the resolve-order CASE verbatim);
--      **the permutation check and the pinned RAISE text are byte-identical**
--      (pgTAP 033:518 keeps passing untouched). The random arm still passes
--      NULL — the settings fallback is manual-only, R123/R126's rule — with
--      its comment corrected (the old one said "the catalog has no
--      nomination_order field", which stops being true in this migration).
--   2. `draft_start_internal` — head **092:395-664**. ONE hunk: the
--      nomination call passes `v_config->'nomination_order'` as the new last
--      argument (+ its comment). Everything else is 092's text verbatim.
--   3. `create_mock_draft` — head **095:709-1226** (signature unchanged from
--      095's 5-arg DROP+CREATE ⇒ CREATE OR REPLACE). ONE hunk, the same one:
--      the league arm's nomination call gains the settings fallback, so a
--      pre-start `manual` league — whose real draft row has hydrated nothing
--      yet — can still be practiced in (D201(2)'s "two call sites"; the
--      standalone arm is untouched and 095 still refuses `manual` by name).
--   4. `draft_set_order` — head **087:2302-2470**. ONE hunk: the pre-start
--      auction refusal is re-worded — it used to point at a settings field
--      that DID NOT EXIST; now the field and its editor exist, the message
--      says where they are and what happens at start. F57's pause-first gate
--      and the not-pause-gated auction order edit are untouched (the F57
--      ledger note); MS.7's mis-target fix is SERVICE-layer (`patchDraftOrder`
--      / `orderRequest`) and nothing here moves it.
--
-- **§4 rule on real drafts:** snake/linear paths are byte-identical; an
-- auction in `same_as_draft_order` or `random` resolves exactly as before
-- (pgTAP 033 §E's golden shuffle literal keeps passing untouched). The ONLY
-- behaviour change is that `manual` + a valid settings order now starts.
--
-- **§4.1 posture:** `draft_nomination_order_internal` stays a plain internal
-- helper (no SECURITY DEFINER — callers are DEFINER), `search_path = ''`,
-- REVOKE re-emitted for the new signature; the three DEFINER bodies re-emit
-- their DEFINER + search_path + REVOKE exactly as their heads left them.
--
-- Proof: pgTAP 046 (the league that was unstartable now starts; the settings
-- order hydrates verbatim; candidate still wins; invalid/absent still raises
-- the byte-identical text; random ignores the settings field), pgTAP 036's
-- re-worded pin, and `commish-auction-ops.test.ts`'s F80 section moved from
-- pinning the gate-out to pinning the working path. Break probe (shown RED in
-- the PR, then reverted): the settings-fallback WHEN arm removed ⇒ 046's
-- start case fails with the pinned text.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. draft_nomination_order_internal — DROP + CREATE (the D201(2) signature
--    trap): + p_config_order (LAST, DEFAULT NULL); the manual arm resolves
--    candidate-then-settings. RAISE text + permutation check byte-identical.
-- ---------------------------------------------------------------------------
DROP FUNCTION draft_nomination_order_internal(UUID, INTEGER, TEXT, JSONB, JSONB, UUID, TEXT);

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
  p_config_order JSONB DEFAULT NULL
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
      p_label);

  ELSE
    -- 'same_as_draft_order' — the §7.3.8 default, and the fallback for an
    -- unrecognized mode (the catalog enum is closed API-side; this mirrors
    -- draft_start's COALESCE(draft_order_mode, 'random') shape).
    RETURN p_draft_order;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  draft_nomination_order_internal(UUID, INTEGER, TEXT, JSONB, JSONB, UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. draft_start_internal — REPLACED FROM 092:395-664 (D137 head rule). ONE
--    hunk: the nomination call gains the settings fallback.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_start_internal(
  p_league_id UUID,
  p_require_commish BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league       public.leagues;
  v_draft        public.drafts;
  v_config       JSONB;
  v_order        JSONB;
  v_active_count INTEGER;
  v_total_rounds INTEGER;
  v_timer        INTEGER;
  v_first        UUID;
  -- 084 (L.C1.2) additions:
  v_type         TEXT;
  v_nom_order    JSONB;
  v_deadline     TIMESTAMPTZ;
  v_budget       INTEGER;
  v_reserve      INTEGER;
  v_bad_team     TEXT;
  v_bad_remaining INTEGER;
  v_bad_open     INTEGER;
BEGIN
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_start: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Re-gate under the league lock (R93); skipped for the system caller
  -- (068's tick — see draft_create_internal's note).
  IF p_require_commish AND NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'draft_start: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- PLAIN read for the idempotent arm — deliberately NOT locked (R122):
  -- taking the drafts-row lock here, while holding the leagues lock, races
  -- an in-flight draft_make_pick into a deadlock cycle — the pick holds the
  -- drafts row (its step 1) and its draft_picks INSERT takes an RI FOR KEY
  -- SHARE on the leagues row (the league_id FK, 065:152), which conflicts
  -- with our leagues lock. Live-proven 40P01 (the batch-2 R122 probe). The
  -- plain read is safe for the no-op arm: creates and starts serialize on
  -- the league lock held above, and the already-started shape's status
  -- truth is the LEAGUE row ('drafting'), read under its own lock.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.league_id = p_league_id
    AND d.is_mock = FALSE
    AND d.status IN ('scheduled', 'live', 'paused');

  -- Idempotent re-start (the D63 same-status class): a double-clicked
  -- Start must not error — even while a pick is mid-flight holding the
  -- drafts-row lock (R122: this arm returns without ever touching it). A
  -- started draft and its league move in ONE txn, so live/paused +
  -- 'drafting' is the only reachable already-started shape.
  IF FOUND AND v_draft.status IN ('live', 'paused') AND v_league.status = 'drafting' THEN
    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'started', FALSE);
  END IF;

  IF v_league.status <> 'scheduled' THEN
    RAISE EXCEPTION
      'draft_start: league % is in % — schedule the draft first (League settings → Draft setup), then start it',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  -- CREATE-IF-ABSENT (the D94 no-dead-end principle on the manual path): a
  -- league scheduled purely through the settings surface has no drafts row;
  -- the idempotent create-internal supplies it. Same txn — the league lock
  -- is already held and simply re-entered. p_require_commish FALSE: this
  -- caller's authorization is already established (wrapper fast-fail + the
  -- re-gate above when required).
  IF v_draft.id IS NULL THEN
    PERFORM public.draft_create_internal(p_league_id, FALSE);
  END IF;

  -- NOW lock the draft row — BELOW the 'scheduled' gate (R122): with the
  -- league locked at 'scheduled', no pick's INSERT can be in flight on this
  -- draft (picks require 'live', and start moves draft + league in one txn
  -- under the league lock), so this lock can never complete the
  -- FK-KEY-SHARE cycle described above.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.league_id = p_league_id
    AND d.is_mock = FALSE
    AND d.status IN ('scheduled', 'live', 'paused')
  FOR UPDATE;

  -- Defensive: a live/paused draft under a non-'drafting' league is
  -- unreachable (start moves both in one txn) — refuse LOUDLY rather than
  -- silently resetting a live board to pick 1. (Also catches the
  -- can't-happen empty re-read after create-if-absent.)
  IF v_draft.id IS NULL OR v_draft.status <> 'scheduled' THEN
    RAISE EXCEPTION
      'draft_start: draft % is % while league % is scheduled — inconsistent state; contact support',
      COALESCE(v_draft.id::text, '(missing)'), COALESCE(v_draft.status, '(missing)'), p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- D95: RE-HYDRATE from live settings — the fidelity moment.
  v_config := COALESCE(v_league.settings->'draft', '{}'::jsonb);
  v_type   := COALESCE(v_config->>'draft_type', 'snake');

  -- 084 (L.C1.2): the M2 seam refusal that stood here (066:640–644 —
  -- "the auction engine lands in M3") is GONE; §8.6's engine begins with
  -- this migration. The gates below are shared by both draft types and are
  -- unchanged from 066 — an auction is capacity-gated, snapshot-gated and
  -- rounds-gated exactly like a snake draft.

  -- Capacity (§7.2/D96): every franchise must exist before the draft.
  -- Orphaned seats count (they draft on autopilot — E48); retired do not.
  -- The audited "draft short" override is M6's (F45).
  SELECT count(*) INTO v_active_count
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.status <> 'retired';
  IF v_active_count <> v_league.team_count THEN
    RAISE EXCEPTION
      'draft_start: league % has % of % franchises seated — every seat must exist before the draft starts; add placeholder seats for the empty slots (League home → Invite) or invite managers (§7.2/D96)',
      p_league_id, v_active_count, v_league.team_count
      USING ERRCODE = 'P0001';
  END IF;

  -- Order resolution (D101/D105/R123/R126) via the ONE implementation
  -- (draft_resolve_order_internal — extracted at L.B1.6 amendment (e),
  -- logic verbatim; 071's create_mock_draft is the second consumer):
  -- candidate = the draft row's stored order (a pre-start randomize/order
  -- edit — it wins so the order the lobby displayed is the order that
  -- drafts), config fallback manual/custom-only, seed = the draft row's
  -- own id, label 'draft_start' (every pinned message unchanged).
  -- An auction resolves it too: `same_as_draft_order` feeds from it, and
  -- the commissioner's pre-draft order surface is one surface (§8.3).
  v_order := public.draft_resolve_order_internal(
    p_league_id,
    v_league.team_count,
    COALESCE(v_config->>'draft_order_mode', 'random'),
    v_draft.draft_order,
    v_config->'draft_order',
    v_draft.id,
    'draft_start');

  -- 084: nomination order (§8.3/§7.3.8) — auction only; snake/linear leave
  -- the column NULL. 098/AP.5 (F80): the settings-catalog fallback rides in
  -- as the LAST argument — `manual` resolves candidate-then-settings, the
  -- exact shape the draft-order call above already has (D101/D201(1)).
  IF v_type = 'auction' THEN
    v_nom_order := public.draft_nomination_order_internal(
      p_league_id,
      v_league.team_count,
      COALESCE(v_config->>'nomination_order_mode', 'same_as_draft_order'),
      v_draft.nomination_order,
      v_order,
      v_draft.id,
      'draft_start',
      v_config->'nomination_order');
  END IF;

  -- D91: rounds = starters + bench (IR excluded). For an auction this is
  -- the per-team roster CAPACITY the open-slots math counts down (D126).
  v_total_rounds := public.draft_rounds_from_roster(v_league.roster_settings);
  IF v_total_rounds IS NULL OR v_total_rounds < 1 THEN
    RAISE EXCEPTION
      'draft_start: league % roster settings produce no draftable rounds (rounds = starters + bench, D91) — fix the roster in League settings',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Clock + first seat, per draft type.
  IF v_type = 'auction' THEN
    -- §7.3.8's own clocks. An untimed pick_timer_seconds = 0 (§8.2's soft
    -- timer) does NOT null this one — see the banner, item 3(c).
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

  -- Snapshot BEFORE the transition (D43/D64(2)): we are in 'scheduled' —
  -- exactly 059's sanctioned window. A league that cannot snapshot (no
  -- scoring reference) fails LOUDLY here and nothing below runs; the D43
  -- trigger on the leagues UPDATE is the backstop either way. The INTERNAL
  -- (059, amended alongside 068): the wrapper's commissioner gate would
  -- refuse the cron auto-start caller (no JWT) — this caller's
  -- authorization is already established (see the re-gate above).
  PERFORM public.snapshot_league_scoring_internal(p_league_id);

  UPDATE public.drafts SET
    status               = 'live',
    draft_type           = v_type,
    config               = v_config,
    draft_order          = v_order,
    nomination_order     = v_nom_order,  -- auction only; NULL for snake/linear
    current_nomination   = NULL,         -- D126: NULL ⇒ NOMINATING phase
    total_rounds         = v_total_rounds,
    current_round        = 1,
    current_pick_number  = 1,            -- doubles as nomination seq 1 (D126)
    on_clock_team_id     = v_first,
    current_deadline     = v_deadline,
    paused_at            = NULL,
    deadline_remaining_ms = NULL,
    started_at           = now(),
    completed_at         = NULL,
    updated_at           = now()
  WHERE id = v_draft.id
  RETURNING * INTO v_draft;

  -- 084: the §8.6.8 start-time backstop (banner item 4) — read through the
  -- ONE derivation family, on the LIVE row, before the league transitions.
  -- TWO messages, because there are two causes and one of them is not the
  -- settings knobs (R318). The derivation reads budget_adjustments (line
  -- 263), so a per-team §8.7 delta can make a settings-LEGAL league
  -- insolvent — and printing "a $200 budget cannot fill 15 roster spots at
  -- a $1 per-slot reserve" about a league whose budget clears that floor by
  -- $185 is arithmetically false and sends the commissioner to the wrong
  -- knob. The unit is named too: these are D91 DRAFTABLE slots (starters +
  -- bench), which is not the settings validator's roster size (it counts
  -- IR as well — league-settings.ts:539), so the two layers print two
  -- numbers for one league unless each says which it means.
  IF v_type = 'auction' AND NOT public.draft_auction_solvent(v_draft.id) THEN
    v_budget  := COALESCE((v_config->>'auction_budget')::int, 200);
    -- 092/AP.1: the reserve, through the ONE authority (D198(1)). With
    -- auction_zero_dollar_nominations ON this arm reads 0 and can no longer
    -- fire — correct, and NOT a reason to delete it (§8.6.8/D198(4)).
    v_reserve := public.draft_auction_reserve(v_config);
    IF v_budget < v_total_rounds * v_reserve THEN
      RAISE EXCEPTION
        'draft_start: league % cannot start an auction — a $% budget cannot fill % draftable roster spots at a $% per-slot reserve (§8.6.8 solvency); raise the auction budget, or allow $0 nominations in League settings → Draft setup',
        p_league_id, v_budget, v_total_rounds, v_reserve
        USING ERRCODE = 'P0001';
    ELSE
      -- The settings floor HOLDS, so the shortfall is one franchise's own
      -- (a §8.7 budget adjustment; priced picks cannot exist on a
      -- 'scheduled' draft). Name the seat and its real numbers.
      SELECT t.name, b.remaining, b.open_slots
        INTO v_bad_team, v_bad_remaining, v_bad_open
      FROM public.teams t
      CROSS JOIN LATERAL public.draft_team_budget(v_draft.id, t.id) b
      WHERE t.league_id = p_league_id
        AND t.status <> 'retired'
        AND b.remaining < b.open_slots * v_reserve
      ORDER BY t.name, t.id
      LIMIT 1;
      RAISE EXCEPTION
        'draft_start: league % cannot start an auction — % has $% for % draftable roster spots at a $% per-slot reserve (§8.6.8 solvency). The league''s $% auction budget clears that floor, so the shortfall is this franchise''s own: clear its commissioner budget adjustment (§8.7), or allow $0 nominations in League settings → Draft setup',
        p_league_id, v_bad_team, v_bad_remaining, v_bad_open, v_reserve, v_budget
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- draft_start's OWN transition under the D43 guard (059's banner: M2
  -- removes the M1 refusal only via this path — set_league_status is NOT
  -- widened).
  UPDATE public.leagues
  SET status = 'drafting', updated_at = now()
  WHERE id = p_league_id;

  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'started', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_start_internal(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. create_mock_draft — REPLACED FROM 095:709-1226 (D137 head rule;
--    signature unchanged ⇒ CREATE OR REPLACE). ONE hunk: the league arm's
--    nomination call gains the settings fallback. The standalone arm is
--    byte-identical (it still refuses `manual` by name and shuffles).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_mock_draft(
  p_league_id UUID DEFAULT NULL,
  p_human_team_id UUID DEFAULT NULL,
  p_cpu_speed TEXT DEFAULT 'realistic',
  p_action_id UUID DEFAULT NULL,
  p_settings JSONB DEFAULT NULL
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
    SELECT jsonb_agg(to_jsonb(s.id) ORDER BY md5(v_mock_id::text || s.id::text))
      INTO v_order
    FROM unnest(v_seat_ids) AS s(id);

    IF v_type = 'auction' THEN
      IF v_nom_mode = 'random' THEN
        -- 084's derived seed, verbatim in shape: a random nomination order
        -- must not be a carbon copy of a random draft order (D105).
        SELECT jsonb_agg(to_jsonb(s.id)
                 ORDER BY md5(md5('nomination:' || v_mock_id::text) || s.id::text))
          INTO v_nom_order
        FROM unnest(v_seat_ids) AS s(id);
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

    v_order := public.draft_resolve_order_internal(
      p_league_id,
      v_league.team_count,
      COALESCE(v_config->>'draft_order_mode', 'random'),
      v_real_order,
      v_config->'draft_order',
      v_mock_id,
      'create_mock_draft');

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
        v_config->'nomination_order');
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

REVOKE EXECUTE ON FUNCTION create_mock_draft(UUID, UUID, TEXT, UUID, JSONB)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 4. draft_set_order — REPLACED FROM 087:2302-2470 (D137 head rule). ONE
--    hunk: the pre-start auction refusal now points at an editor that
--    exists. NOT pause-gated, exactly as before (F57 note stands).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_set_order(
  p_draft_id UUID,
  p_order UUID[],
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft      public.drafts;
  v_league     public.leagues;
  v_new_order  JSONB;
  v_valid      BOOLEAN;
  v_timer      INTEGER;
  v_new_onclock UUID;
BEGIN
  IF p_order IS NULL OR cardinality(p_order) = 0 THEN
    RAISE EXCEPTION 'draft_set_order: a non-empty draft order is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_set_order: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  -- MOCK GUARD (L.B1.6/071 — amended in place, F12; D103(2)/§8.8): §8.7
  -- is the REAL-draft commissioner surface. On a mock this control is
  -- interference with a member's solo practice (and for draft_reset an
  -- outright zero-side-effect breach — it writes leagues.status and the
  -- stored schedule instant). The launcher's controls are
  -- pause/resume/delete (069 mock arms + 071). Pinned in pgTAP 025.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_set_order: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION 'draft_set_order: the draft is complete — the order cannot change'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_set_order: league % not found', v_draft.league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Permutation of the active franchises (066's validation, typed at the
  -- boundary — uuid[] means malformed entries failed at the wire cast).
  v_valid := (
    SELECT count(*) = v_league.team_count
       AND count(DISTINCT e.id) = v_league.team_count
       AND bool_and(EXISTS (
             SELECT 1 FROM public.teams t
             WHERE t.league_id = v_draft.league_id
               AND t.status <> 'retired'
               AND t.id = e.id))
    FROM unnest(p_order) AS e(id)
  );
  IF NOT v_valid THEN
    RAISE EXCEPTION
      'draft_set_order: the order must include every active franchise exactly once (§8.3)'
      USING ERRCODE = 'P0001';
  END IF;

  v_new_order := to_jsonb(p_order);
  v_timer := COALESCE((v_draft.config->>'pick_timer_seconds')::int, 90);

  -- 087/L.C1.5 — THE AUCTION ARM (E31 analog). On an auction the order under
  -- edit is `nomination_order`, not `draft_order`: completed nominations are
  -- stored picks and stay untouched, and the rotation re-derives mechanically
  -- because ARM 2.6 scans `nomination_order` from the current nominator.
  -- on_clock_team_id and both clocks are deliberately NOT recomputed — there
  -- is no positional derivation to redo (the snake branch's whole reason for
  -- re-deriving), the seat mid-nomination keeps its turn, and the new order
  -- takes effect at the next advance. NOT pause-gated (D141 does not name
  -- order edits).
  IF v_draft.draft_type = 'auction' THEN
    IF v_draft.status = 'scheduled' THEN
      RAISE EXCEPTION
        'draft_set_order: this auction has not started — set nomination_order_mode and drag the nomination order in League settings (Draft configuration); draft_start hydrates it (§7.3.8)'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.drafts SET
      nomination_order = v_new_order,
      updated_at       = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_draft;

    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (v_draft.league_id, auth.uid(),
            'Nomination order changed by ' || public.draft_actor_name()
            || ' at nomination ' || v_draft.current_pick_number
            || ' — the rotation follows the new order from the next nomination.',
            'draft:' || p_draft_id::text, TRUE);

    RETURN jsonb_build_object('draft', to_jsonb(v_draft));
  END IF;

  IF v_draft.status = 'scheduled' THEN
    -- Pre-start: just the stored order — the lobby shows it and
    -- draft_start honors the draft-row candidate (D101/R123).
    UPDATE public.drafts SET
      draft_order = v_new_order,
      updated_at  = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_draft;
  ELSE
    -- E31 (live/paused): completed picks are STORED rows and stay
    -- untouched; remaining picks re-derive mechanically because advance
    -- reads drafts.draft_order. The CURRENT pick's team re-derives NOW; a
    -- CHANGED on-clock team gets a FRESH full clock (it never had the
    -- clock), an unchanged team keeps its running clock. RESIDUAL: a
    -- mid-round edit can leave per-team totals uneven — E31 sanctions it
    -- (see the banner).
    v_new_onclock := public.draft_team_for_pick(
      v_new_order, v_draft.draft_type,
      COALESCE((v_draft.config->>'snake_reversal')::boolean, FALSE),
      v_draft.current_pick_number);

    UPDATE public.drafts SET
      draft_order           = v_new_order,
      on_clock_team_id      = v_new_onclock,
      current_deadline      = CASE
                                WHEN v_new_onclock IS DISTINCT FROM v_draft.on_clock_team_id
                                     AND status = 'live' AND v_timer > 0
                                THEN now() + make_interval(secs => v_timer)
                                WHEN v_new_onclock IS DISTINCT FROM v_draft.on_clock_team_id
                                THEN NULL
                                ELSE current_deadline
                              END,
      deadline_remaining_ms = CASE
                                WHEN v_new_onclock IS DISTINCT FROM v_draft.on_clock_team_id
                                     AND status = 'paused' AND v_timer > 0
                                THEN v_timer * 1000
                                WHEN v_new_onclock IS DISTINCT FROM v_draft.on_clock_team_id
                                     AND status = 'paused'
                                THEN NULL
                                ELSE deadline_remaining_ms
                              END,
      updated_at            = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_draft;
  END IF;

  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          CASE WHEN v_draft.status = 'scheduled'
            THEN 'Draft order updated by ' || public.draft_actor_name() || '.'
            ELSE 'Draft order changed by ' || public.draft_actor_name()
                 || ' at pick ' || v_draft.current_pick_number
                 || ' — remaining picks follow the new order.'
          END,
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object('draft', to_jsonb(v_draft));
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_set_order(UUID, UUID[], TEXT)
  FROM PUBLIC, anon;
