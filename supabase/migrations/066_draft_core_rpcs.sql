-- ============================================================================
-- Draft core RPCs: draft_create + draft_start + draft_make_pick — migration
-- 066 (task L.B1.2; spec §8.1 five-step action contract, §8.3 order, §8.5
-- flow, §7.2 capacity, §7.3.8 config, §12.3–12.4; tasks-M2 §3 D90/D91/D94/
-- D95/D96/D101/D103 + §4.6 draft-row lock discipline, §5 sketch — the names
-- are contractual). The serialized core of the snake draft engine.
--
-- Contents:
--   1. `draft_rounds_from_roster(jsonb)` — the ONE D91 implementation:
--      total_rounds = Σ starting-slot counts + bench, IR EXCLUDED (§7.3.2
--      eligibility makes drafting into IR unsatisfiable — C23/D91; the
--      erratum clarifies §12.3's "derived from roster_size" comment). Pure,
--      IMMUTABLE, reused by 068 (tick auto-start) and 071 (mock snapshot).
--      Default roster golden value: 9 starters + 6 bench = 15 (a naive
--      +IR implementation returns 16 — pgTAP 020 pins the exclusion).
--   2. `draft_team_for_pick(order, type, reversal, pick_no)` — the ONE D90
--      order-math implementation (turn authority lives in SQL only; the TS
--      helpers are display-only and get parity-pinned in L.B3.2):
--        * linear: same order every round (§8.3 — "a cheap variant of
--          snake", §7.3.8);
--        * snake: odd rounds forward, even rounds reversed;
--        * snake + snake_reversal (3RR, §8.3): round 1 forward, round 2
--          reversed, round 3 REPEATS reversed (the flip), then alternates —
--          i.e. for rounds ≥ 3 the parity inverts (r3 rev, r4 fwd, r5 rev…).
--      Pure/IMMUTABLE/STRICT on its arguments; no data access; EXECUTE left
--      broad deliberately (pure math leaks nothing — the is_league_member
--      precedent; pgTAP 020 drives its golden pick→team tables directly AND
--      through real driven picks so the RPC wiring cannot drift, D90).
--   3. `draft_create(p_league_id)` — commish; hydrates the §7.3.8 block from
--      CURRENT league settings into drafts.config (D95 "hydrated when
--      scheduled"); IDEMPOTENT against the D95 partial unique: an existing
--      scheduled/live/paused non-mock draft is returned (`created: false`),
--      never a 23505 — the D94 tick and a double-POST both lean on this.
--      League must be pre-draft (`setup`/`scheduled`) unless the idempotent
--      arm already answered.
--   4. `draft_start(p_league_id)` — commish; the §8.5.1 manual start ("or
--      commissioner clicks Start Draft" — early start before the scheduled
--      instant is legal; the D94 auto-start arm lands with the tick, 068):
--        league lock → re-gate (R93) → idempotent re-start no-op (D63
--        class; a PLAIN drafts-row read, deliberately unlocked — R122: a
--        drafts-row lock here deadlocks an in-flight pick, see the
--        lock-order note) → `status='scheduled'` required → CREATE-IF-
--        ABSENT via the idempotent draft_create (the D94 no-dead-end
--        principle applied to the manual path: a league scheduled purely
--        through the settings surface has no drafts row and the Start
--        button must still work)
--        → draft row lock (BELOW the scheduled gate — R122) → auction
--        refusal (the M3 seam — tasks-M2 §1:
--        M2 implements none of §8.6; a friendly P0001 names M3, the 059
--        "lands in M2" precedent) → capacity: active (non-retired)
--        franchises == team_count, friendly refusal naming placeholder
--        seats (D96; orphaned seats count — they draft on autopilot, E48)
--        → config RE-HYDRATION from live settings (D95 — the fidelity
--        moment; a pre-start settings edit is honored at start)
--        → order resolution (below) → total_rounds per D91 (≥ 1 enforced)
--        → **snapshot_league_scoring BEFORE the status UPDATE** (059's
--        setup/scheduled window, D43/D64(2) — the guard trigger is the
--        backstop and pgTAP 020 carries the order probe both ways)
--        → drafts: status='live', started_at, pick-1 on_clock = order[1],
--        pick-1 deadline (pick_timer_seconds 0 ⇒ NULL deadline — §8.2 soft
--        timer) → leagues.status='drafting' (draft_start's OWN transition
--        under the D43 guard — set_league_status's M1 refusal is NOT
--        widened, exactly as 059's banner prescribes).
--      ORDER RESOLUTION (D101 + Builder mechanics, D105):
--        * stored candidate = drafts.draft_order if it is an array (a
--          pre-start randomize/order-edit via PATCH /draft, L.B2.1), else —
--          in manual/custom mode ONLY (R123) — the re-hydrated config's
--          draft_order (§7.3.8 settings field): draft-row value wins so
--          the order the lobby displayed is the order that drafts (D101
--          "result written before start"); random mode NEVER reads the
--          config fallback — no lobby ever displayed a config-sourced
--          order under random, and a stale settings-blob leftover from a
--          prior manual/custom episode would silently defeat the shuffle;
--        * validity = a PERMUTATION of the active team_ids (length ==
--          team_count, all distinct, every element an active franchise;
--          compared as TEXT so a malformed entry fails validation, never a
--          ::uuid cast — the R117 lesson);
--        * `manual`/`custom`: stored candidate MUST be valid → else a
--          friendly P0001 (re-save the order);
--        * `random`: a VALID stored DRAFT-ROW candidate is honored as-is
--          (the lobby showed it — reshuffling at start would make the
--          displayed order a lie, D101); otherwise a deterministic shuffle:
--          ORDER BY md5(draft_id || team_id) (D105 — seed = the draft row's
--          own id, so sim replays reproduce given the row and no wall-clock
--          or Math.random enters the engine; distinct drafts get distinct
--          orders).
--   5. `draft_make_pick(p_draft_id, p_player_id, p_action_id)` — the full
--      §8.1 five-step contract, in exactly this order:
--        (1) LOCK the drafts row FOR UPDATE FIRST (§4.6 — the serializer;
--            the league row is deliberately not locked EXPLICITLY —
--            heartbeat/lock-contention doctrine D102 — but the pick's
--            INSERT at step (3) takes an implicit RI FOR KEY SHARE on it
--            via the league_id FK, so the pick's true order is drafts →
--            leagues(KEY SHARE) — R122; see the lock-order note below);
--        (2) VALIDATE: 42501 no-leak (nonexistent draft and non-member get
--            the same refusal), P0002 soft-deleted league, E2 replay
--            short-circuit (BEFORE status/turn checks — a retried pick
--            returns its original pick + current authoritative state as a
--            no-op even after the clock moved on; **R125 DECIDED at
--            L.B1.4/069 (draft_undo exists now):** the lookup deliberately
--            does NOT filter is_undone — an action_id is CONSUMED FOREVER.
--            A stale client retry of a pick the commissioner later undid
--            returns the historical (undone) row + current state as a
--            no-op and can NEVER silently re-apply the undone pick;
--            filtering instead would route the retry into a fresh INSERT
--            against uniq_draft_action (undone rows KEEP their action_id)
--            ⇒ 23505 ⇒ a misleading "just went off the board". The manager
--            re-picks with a FRESH action_id. Pinned in pgTAP 023),
--            THE D103(2) MOCK BRANCH (landed by L.B1.6/071 — this
--            replaced the seam refusal 066 originally shipped; the 020
--            seam pin flipped with it): launcher-only (any other member,
--            incl. the seat's real manager and the commissioner, gets the
--            friendly solo-practice refusal) + human seat only (checked
--            at the TURN step — a CPU seat on the clock answers "CPU
--            picks land on their own"), auction refusal (M3), status
--            ('live' required — friendly per-status messages), TURN (the
--            caller's league_members cache row manages on_clock_team_id —
--            M1's access model; commissioners use L.B1.4's force path, NOT
--            this RPC — no commish bypass exists here, pgTAP-pinned),
--            player existence (P0002), availability (E1 — the friendly
--            "just went off the board" refusal under the lock; the partial
--            unique uniq_draft_player_live is the impossibility guarantee
--            and a unique_violation handler converts the exotic loser to
--            the same friendly message);
--        (3) WRITE the draft_picks row (made_via='manager', is_auto=FALSE,
--            picked_by=auth.uid(), the caller's action_id);
--        (4) ADVANCE: next pick_number/round; on_clock via
--            draft_team_for_pick; new deadline (0 ⇒ NULL); COMPLETION when
--            live (non-undone) picks == total_rounds × team_count →
--            status='complete' + completed_at (**amended in place by
--            L.B1.7/072 — F12: a NON-mock completion now, in the SAME
--            txn, populates league_rosters from the non-undone picks
--            (acquisition_type='draft', cost NULL — D88) and moves the
--            league to 'in_season' (§8.5 step 6; the D43 guard holds —
--            the snapshot has existed since draft_start; pinned in 026).
--            The MOCK branch bypasses all of it (§8.8 zero side effects
--            — re-pinned from the completion side in 025/026). pgTAP
--            020's "league stays 'drafting'" pin flipped with it, as its
--            own text promised**);
--        (5) RETURN the new authoritative state: {draft, pick} (D92's
--            state_version = drafts.updated_at rides along).
--      Removal race note: turn truth is read AFTER the draft-row lock from
--      the league_members cache; a removal (063) serializes on the LEAGUE
--      row, so one in-flight pick may land for a just-removed manager —
--      identical to §7.2.1's "removal during a live draft flips the seat on
--      the same pick clock" semantics; no tighter guarantee is specified.
--
-- LOCK ORDER (banner-stated per the 063 precedent; CORRECTED by batch-2
-- R122 — the original "no cycle exists" claim missed the FK row lock):
-- draft_create and draft_start take leagues → drafts. draft_make_pick
-- takes the drafts row explicitly and reads leagues/league_members/teams
-- unlocked — BUT its draft_picks INSERT takes an implicit RI FOR KEY SHARE
-- on the leagues row (the league_id FK, 065:152), so the pick's true order
-- is drafts → leagues(KEY SHARE), which conflicts with FOR UPDATE. A cycle
-- IS therefore constructible against a drafts-row FOR UPDATE taken under
-- the league lock while a pick is in flight (live-proven 40P01 — the R122
-- probe; the victim can be the manager's pick). The discipline that
-- prevents it: draft_start's idempotent no-op arm reads the drafts row
-- WITHOUT locking it, and the drafts-row FOR UPDATE is taken only BELOW
-- the `scheduled` league gate — a state in which no pick's INSERT can be
-- in flight on this draft (picks require 'live'; start moves draft +
-- league in one txn under the league lock) — so the two lock orders can
-- never interleave. pgTAP 020 pins the structural property (exactly one
-- FOR UPDATE — the leagues lock — precedes the scheduled gate in
-- draft_start's body). Each RPC holds its locks across single-row writes
-- only (held-lock < 50ms asserted in the stack vitest, plan §8.3/§4.6).
--
-- SQLSTATE convention (062/063 verbatim): 42501 auth + no-leak · P0002 →
-- 404 (soft-deleted/nonexistent league for a legitimate caller; unknown
-- player) · P0001 friendly refusal of a well-formed request · 22023
-- argument shape. Error strings are UX (§8.3 checklist) and are pinned in
-- pgTAP 020.
--
-- §7.3.8 defaults in SQL (draft_type 'snake', order_mode 'random',
-- pick_timer 90, snake_reversal false) mirror the SPEC's printed D column —
-- the settings API (L.A1.6 catalog) writes explicit values on every
-- sanctioned path, so the COALESCEs are defense against a bare '{}' blob,
-- not a second source of truth.
--
-- Grants doctrine (D18→D23 / tasks-M1 §4.1): no per-object GRANTs; every
-- RPC below is SECURITY DEFINER + SET search_path = '' (spec form) +
-- schema-qualified references + in-body auth + explicit REVOKE FROM
-- PUBLIC, anon (038/062 precedent). The two pure helpers are NOT SECURITY
-- DEFINER (no data access, D49(3) narrow-privilege pattern) and keep broad
-- EXECUTE deliberately (see item 2).
--
-- Realtime (standing rule 5): drafts/draft_picks broadcast triggers land in
-- migration 070 (L.B1.5) — no subscriber exists until L.B3.1; nothing in
-- this migration writes a table a client currently renders live.
--
-- Typegen: RE-RUN (R68 lesson — new PostgREST-exposed functions change the
-- generated Functions surface); alias block re-appended, diff verified
-- additive-only (§4.4).
--
-- §8.1 staging-rehearsal waiver (R6 rule): no staging clone exists
-- (environments are local + prod only); the recorded rehearsal evidence is
-- the fresh local `npx supabase db reset` replay of the full 001–066 chain
-- plus pgTAP 020 in the same PR. Prod-safe: new functions only, no table
-- changes. F12 note: prod's migration history still ends pre-league-schema;
-- this lands with the next normal push.
--
-- AMENDED IN PLACE 2026-08-03 (L.B1.3/068 — the unreleased-migration amend
-- precedent, F12; the D103(2) mock branch is still L.B1.6's future
-- amendment, unchanged). Three mechanical changes, no semantic change to
-- any client-visible surface (every SQLSTATE + message + return shape is
-- byte-identical; pgTAP 020's pins prove it):
--   (a) `draft_create` / `draft_start` are now thin auth WRAPPERS over
--       `draft_create_internal(p_league_id, p_require_commish)` /
--       `draft_start_internal(p_league_id, p_require_commish)` — the ONE
--       create/start implementation each (D90's one-implementation rule
--       applied to lifecycle): 068's `draft_tick` D94 auto-start arm runs
--       under cron with NO JWT (auth.uid() NULL), so the commissioner
--       gates must be the WRAPPER's job (fast-fail) + a lock-held re-gate
--       the internal performs only when p_require_commish (R93 — roles
--       move only under the league lock). Internals follow the 062
--       `seat_league_member_internal` form: plain (non-SECURITY-DEFINER,
--       they execute under their SECURITY DEFINER callers), SET
--       search_path = '', REVOKE FROM PUBLIC, anon, authenticated.
--       The R122 lock discipline moves with the body: pgTAP 020's
--       structural pin now targets draft_start_internal's prosrc.
--   (b) `draft_apply_pick_internal(draft_id, player_id, is_auto, made_via,
--       picked_by, action_id)` extracted from draft_make_pick's steps
--       (3) WRITE + (4) ADVANCE/COMPLETION + (5) RETURN — verbatim, same
--       now()-based deadlines, same counted completion — so 068's autopick
--       writes a pick through the SAME advance path (is_auto=TRUE,
--       made_via='autopick', picked_by NULL, action_id NULL — §12.4's
--       system-pick shape) instead of forking it (tasks-M2 L.B1.3's
--       reuse-never-fork rule). Caller contract: the drafts row is LOCKED
--       and the pick fully validated before calling; draft_make_pick keeps
--       its own unique_violation → friendly-E1 handler around the call.
--   (c) R126 TAKEN (the routed batch-2 re-review nit — 066's next touch is
--       this amendment): the R123 guard is now `v_mode IN ('manual',
--       'custom')`, closing the out-of-enum-mode shape (an unvalidated
--       `draft_order_mode` value could previously still read the
--       settings-blob draft_order); attestations already said
--       "manual/custom-only" — the code now matches them.
--
-- AMENDED 2026-08-04 (L.B1.4/069 — COMMENT-ONLY, no code change): the
-- R125 routing notes above and at the replay arm rewritten to the DECISION
-- (an action_id is consumed forever; the no-filter replay is deliberate
-- and pinned in pgTAP 023 — see 069's banner item 5 for the full
-- rationale).
--
-- AMENDED IN PLACE 2026-08-04 (L.B1.6/071 — the unreleased-chain amend
-- precedent, F12; see 071's banner + PROGRESS D110). Two changes:
--   (d) THE D103(2) MOCK BRANCH lands in `draft_make_pick`, replacing the
--       L.B1.6 seam refusal this banner cross-referenced: on an is_mock
--       draft the ONLY legal human caller is `config.mock.launched_by`
--       (any other member — including the on-clock seat's REAL manager
--       and the commissioner — gets the friendly solo-practice refusal;
--       no bypass), and only while `on_clock_team_id` equals
--       `config.mock.human_team_id` (a CPU seat on the clock answers
--       "CPU picks land on their own" — every other seat is tick-only,
--       D93/071 ARM 2.5). The normal league_members turn check never runs
--       for mocks (the launcher's chosen seat may be a placeholder or
--       another member's franchise — "any seat selectable", §8.8).
--       pgTAP 020's seam pin FLIPS to the launcher refusal (the pin was
--       built to flip); both sides of D103(2) are pinned in 025.
--   (e) `draft_resolve_order_internal` EXTRACTED from
--       draft_start_internal's order-resolution block (the D107(2)
--       wrapper/internal precedent) so 071's `create_mock_draft` snapshot
--       and the real start share the ONE order-resolution implementation
--       (candidate-wins-over-config, manual/custom permutation validation,
--       the D105 md5 shuffle) — a fork would drift the mock's order from
--       the order draft night produces (§8.8 "a mock that behaves
--       differently from draft night is worse than no mock"). Behavior
--       byte-identical for the real path (p_label = 'draft_start' keeps
--       every pinned message; pgTAP 020's order pins prove it); plain
--       internal, 062-form triple REVOKE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. draft_rounds_from_roster — D91: starters + bench, IR EXCLUDED
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_rounds_from_roster(p_roster JSONB)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE STRICT
SET search_path = ''
AS $$
  -- Σ starting-slot counts + bench. ir_slots deliberately NOT summed (D91:
  -- §7.3.2 IR eligibility makes drafting a healthy player into IR
  -- unsatisfiable — rounds count draftable spots only).
  SELECT COALESCE(
           (SELECT SUM((slot->>'count')::int)::int
            FROM jsonb_array_elements(p_roster->'starting_slots') AS slot), 0)
       + COALESCE((p_roster->>'bench')::int, 0);
$$;

-- ----------------------------------------------------------------------------
-- 2. draft_team_for_pick — D90: the one order-math implementation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_team_for_pick(
  p_draft_order JSONB,
  p_draft_type TEXT,
  p_snake_reversal BOOLEAN,
  p_pick_number INTEGER
) RETURNS UUID
LANGUAGE sql IMMUTABLE STRICT
SET search_path = ''
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_draft_order) <> 'array'
      OR jsonb_array_length(p_draft_order) = 0
      OR p_pick_number < 1
    THEN NULL
    ELSE (
      WITH m AS (
        SELECT jsonb_array_length(p_draft_order)                          AS n,
               ((p_pick_number - 1) % jsonb_array_length(p_draft_order)) + 1 AS pos,
               ((p_pick_number - 1) / jsonb_array_length(p_draft_order)) + 1 AS rnd
      ),
      dir AS (
        SELECT n, pos,
               CASE
                 WHEN p_draft_type = 'linear' THEN TRUE            -- §8.3: repeats
                 -- 3RR (§8.3): r1 fwd, r2 rev, r3 rev (the flip), r4 fwd, …
                 -- i.e. parity inverts for rounds ≥ 3.
                 WHEN p_snake_reversal AND rnd >= 3 THEN (rnd % 2 = 0)
                 ELSE (rnd % 2 = 1)                                -- plain snake
               END AS forward
        FROM m
      )
      SELECT (p_draft_order ->> (CASE WHEN forward THEN pos ELSE n - pos + 1 END - 1))::uuid
      FROM dir
    )
  END;
$$;

-- ----------------------------------------------------------------------------
-- 2b. draft_resolve_order_internal — the ONE order-resolution
--     implementation (L.B1.6 amendment (e); D101/D105/R123/R126).
--     Consumers: draft_start_internal (candidate = the draft row's stored
--     order, seed = the draft row's id, label 'draft_start') and 071's
--     create_mock_draft (candidate = the REAL scheduled draft row's
--     stored order if any, seed = the MOCK's own id, label
--     'create_mock_draft'). Logic moved VERBATIM from
--     draft_start_internal: the draft-row candidate wins so the order the
--     lobby displayed is the order that drafts (D101); the config
--     fallback is manual/custom-ONLY (R123/R126); manual/custom REQUIRE a
--     permutation of the active team ids (TEXT-compared — the R117
--     lesson) else the friendly P0001; random honors a VALID candidate
--     as-is and otherwise shuffles deterministically by
--     md5(seed || team_id) (D105 — no wall-clock, no Math.random).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_resolve_order_internal(
  p_league_id UUID,
  p_team_count INTEGER,
  p_mode TEXT,
  p_candidate JSONB,
  p_config_order JSONB,
  p_seed UUID,
  p_label TEXT
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
      SELECT jsonb_agg(to_jsonb(t.id) ORDER BY md5(p_seed::text || t.id::text))
        INTO v_order
      FROM public.teams t
      WHERE t.league_id = p_league_id AND t.status <> 'retired';
    END IF;
  END IF;

  RETURN v_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  draft_resolve_order_internal(UUID, INTEGER, TEXT, JSONB, JSONB, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. draft_create — hydrate §7.3.8 config; idempotent vs the D95 partial
--    unique. Auth WRAPPER over draft_create_internal (L.B1.3 amendment (a):
--    068's tick auto-start arm runs with no JWT, so the ONE implementation
--    lives in the internal and the commissioner gate lives here + in the
--    internal's p_require_commish re-gate).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_create(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Fast-fail auth (no-leak: a nonexistent league answers 42501 too).
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'draft_create: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;
  RETURN public.draft_create_internal(p_league_id, TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_create(UUID) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION draft_create_internal(
  p_league_id UUID,
  p_require_commish BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league public.leagues;
  v_draft  public.drafts;
  v_config JSONB;
BEGIN
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_create: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Re-gate on the CURRENT role under the league lock (the R93 rule —
  -- roles move only under this lock, so only a post-lock read is stable).
  -- Skipped for the system caller (068's tick — no JWT; its authority is
  -- the REVOKE-narrowed draft_tick itself, the 062-internal precedent).
  IF p_require_commish AND NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'draft_create: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- Idempotent arm (D95): one live/scheduled non-mock draft per league —
  -- return the existing row instead of racing the partial unique. All
  -- creates serialize on the league row above, so check-then-insert is
  -- race-free.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.league_id = p_league_id
    AND d.is_mock = FALSE
    AND d.status IN ('scheduled', 'live', 'paused');
  IF FOUND THEN
    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'created', FALSE);
  END IF;

  IF v_league.status NOT IN ('setup', 'scheduled') THEN
    RAISE EXCEPTION
      'draft_create: league % is in % — a draft can only be created before draft day (setup/scheduled)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  -- D95: hydrate the §7.3.8 block from CURRENT settings ("hydrated when
  -- scheduled"); draft_start re-hydrates at the start instant.
  v_config := COALESCE(v_league.settings->'draft', '{}'::jsonb);

  INSERT INTO public.drafts (league_id, draft_type, status, is_mock, config, total_rounds)
  VALUES (
    p_league_id,
    COALESCE(v_config->>'draft_type', 'snake'),
    'scheduled',
    FALSE,
    v_config,
    public.draft_rounds_from_roster(v_league.roster_settings)
  )
  RETURNING * INTO v_draft;

  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'created', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_create_internal(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. draft_start — the §8.5.1 manual start (snapshot BEFORE transition).
--    Auth WRAPPER over draft_start_internal (L.B1.3 amendment (a)): the ONE
--    start implementation, driven by the commissioner here and by 068's
--    D94 auto-start tick arm (p_require_commish = FALSE — cron has no JWT).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_start(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Fast-fail auth (no-leak).
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'draft_start: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;
  RETURN public.draft_start_internal(p_league_id, TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_start(UUID) FROM PUBLIC, anon;

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

  -- The M3 seam (tasks-M2 §1): M2 implements none of §8.6 — starting an
  -- auction draft would transition a league into an engine that does not
  -- exist yet (the 059 "lands in M2" refusal precedent).
  IF COALESCE(v_config->>'draft_type', 'snake') = 'auction' THEN
    RAISE EXCEPTION
      'draft_start: league % is configured for an auction draft — the auction engine lands in M3; switch draft_type to snake or linear to draft now',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;

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
  v_order := public.draft_resolve_order_internal(
    p_league_id,
    v_league.team_count,
    COALESCE(v_config->>'draft_order_mode', 'random'),
    v_draft.draft_order,
    v_config->'draft_order',
    v_draft.id,
    'draft_start');

  -- D91: rounds = starters + bench (IR excluded).
  v_total_rounds := public.draft_rounds_from_roster(v_league.roster_settings);
  IF v_total_rounds IS NULL OR v_total_rounds < 1 THEN
    RAISE EXCEPTION
      'draft_start: league % roster settings produce no draftable rounds (rounds = starters + bench, D91) — fix the roster in League settings',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  v_timer := COALESCE((v_config->>'pick_timer_seconds')::int, 90);

  -- Snapshot BEFORE the transition (D43/D64(2)): we are in 'scheduled' —
  -- exactly 059's sanctioned window. A league that cannot snapshot (no
  -- scoring reference) fails LOUDLY here and nothing below runs; the D43
  -- trigger on the leagues UPDATE is the backstop either way. The INTERNAL
  -- (059, amended alongside 068): the wrapper's commissioner gate would
  -- refuse the cron auto-start caller (no JWT) — this caller's
  -- authorization is already established (see the re-gate above).
  PERFORM public.snapshot_league_scoring_internal(p_league_id);

  v_first := public.draft_team_for_pick(
    v_order, COALESCE(v_config->>'draft_type', 'snake'),
    COALESCE((v_config->>'snake_reversal')::boolean, FALSE), 1);

  UPDATE public.drafts SET
    status               = 'live',
    draft_type           = COALESCE(v_config->>'draft_type', 'snake'),
    config               = v_config,
    draft_order          = v_order,
    total_rounds         = v_total_rounds,
    current_round        = 1,
    current_pick_number  = 1,
    on_clock_team_id     = v_first,
    current_deadline     = CASE WHEN v_timer > 0
                                THEN now() + make_interval(secs => v_timer)
                                ELSE NULL END,   -- §8.2 soft timer: 0 ⇒ no clock
    paused_at            = NULL,
    deadline_remaining_ms = NULL,
    started_at           = now(),
    completed_at         = NULL,
    updated_at           = now()
  WHERE id = v_draft.id
  RETURNING * INTO v_draft;

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

-- ----------------------------------------------------------------------------
-- 5. draft_apply_pick_internal — steps (3) WRITE + (4) ADVANCE/COMPLETION +
--    (5) RETURN of the §8.1 contract, extracted (L.B1.3 amendment (b)) so
--    draft_make_pick (manual) and 068's draft_tick (autopick) write through
--    the SAME advance path. CALLER CONTRACT: the drafts row is held FOR
--    UPDATE and the pick is fully validated (status/turn/availability);
--    this helper only writes, advances, and returns the new state. The
--    caller owns any unique_violation → friendly-E1 conversion.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_apply_pick_internal(
  p_draft_id UUID,
  p_player_id TEXT,
  p_is_auto BOOLEAN,
  p_made_via TEXT,
  p_picked_by UUID,
  p_action_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_draft      public.drafts;
  v_pick       public.draft_picks;
  v_team_count INTEGER;
  v_timer      INTEGER;
  v_next       INTEGER;
  v_live_picks BIGINT;
BEGIN
  -- Plain re-read: the caller holds the drafts-row lock (§4.6), so this is
  -- the authoritative current state.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id;

  v_team_count := jsonb_array_length(v_draft.draft_order);
  v_timer := COALESCE((v_draft.config->>'pick_timer_seconds')::int, 90);

  -- (3) WRITE.
  INSERT INTO public.draft_picks
    (draft_id, league_id, pick_number, round, team_id, player_id,
     is_auto, picked_by, made_via, action_id)
  VALUES
    (p_draft_id, v_draft.league_id, v_draft.current_pick_number,
     v_draft.current_round, v_draft.on_clock_team_id, p_player_id,
     p_is_auto, p_picked_by, p_made_via, p_action_id)
  RETURNING * INTO v_pick;

  -- (4) ADVANCE. Completion = all total_rounds × team_count LIVE picks
  -- (counted, not inferred — robust against L.B1.4's undo rewinds).
  SELECT count(*) INTO v_live_picks
  FROM public.draft_picks p
  WHERE p.draft_id = p_draft_id AND p.is_undone = FALSE;

  IF v_live_picks >= v_draft.total_rounds * v_team_count THEN
    UPDATE public.drafts SET
      status           = 'complete',
      completed_at     = now(),
      on_clock_team_id = NULL,
      current_deadline = NULL,
      updated_at       = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_draft;

    -- COMPLETION ARM (amended in place by L.B1.7/072 — F12; §8.5 step 6,
    -- §12.7, D88). NON-mock only: the §8.8 zero-side-effect contract keeps
    -- a mock at drafts.complete + recap — no rosters, no league
    -- transition (re-pinned from this side in 025/026). In THIS txn,
    -- under the caller's drafts-row lock (drafts → leagues — see 072's
    -- banner lock analysis):
    --   * league_rosters from the draft's non-undone picks
    --     (acquisition_type='draft'; acquisition_cost NULL for snake —
    --     D88; M3's auction writes price). slot_key/IR columns stay NULL
    --     (M4's). The §12.7 UNIQUE(league_id, player_id) is the
    --     exclusivity backstop — a duplicate here means engine corruption
    --     and the 23505 aborts the completion LOUDLY (nothing to convert:
    --     uniq_draft_player_live makes it unreachable via any RPC path).
    --   * leagues.status = 'in_season' (§8.5 step 6). The D43 snapshot
    --     guard fires on this UPDATE and holds — the snapshot has existed
    --     since draft_start (pinned in 026). 070's status-column trigger
    --     broadcasts the flip on league:<id> (home hero / draft bar).
    IF NOT v_draft.is_mock THEN
      INSERT INTO public.league_rosters
        (league_id, team_id, player_id, acquisition_type, acquisition_cost)
      SELECT p.league_id, p.team_id, p.player_id, 'draft', NULL
      FROM public.draft_picks p
      WHERE p.draft_id = p_draft_id
        AND p.is_undone = FALSE;

      UPDATE public.leagues
      SET status = 'in_season', updated_at = now()
      WHERE id = v_draft.league_id;
    END IF;
  ELSE
    v_next := v_draft.current_pick_number + 1;
    UPDATE public.drafts SET
      current_pick_number = v_next,
      current_round       = ((v_next - 1) / v_team_count) + 1,
      on_clock_team_id    = public.draft_team_for_pick(
                              draft_order, draft_type,
                              COALESCE((config->>'snake_reversal')::boolean, FALSE),
                              v_next),
      current_deadline    = CASE WHEN v_timer > 0
                                 THEN now() + make_interval(secs => v_timer)
                                 ELSE NULL END,
      updated_at          = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_draft;
  END IF;

  -- (5) RETURN the new authoritative state.
  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'pick', to_jsonb(v_pick));
END;
$$;

REVOKE EXECUTE ON FUNCTION
  draft_apply_pick_internal(UUID, TEXT, BOOLEAN, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. draft_make_pick — the §8.1 five-step contract (steps 3–5 via
--    draft_apply_pick_internal since the L.B1.3 amendment)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_make_pick(
  p_draft_id UUID,
  p_player_id TEXT,
  p_action_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft         public.drafts;
  v_pick          public.draft_picks;
  v_my_team       UUID;
  v_on_clock_name TEXT;
  v_player_name   TEXT;
BEGIN
  -- Argument shape (22023) before any data access.
  IF p_player_id IS NULL OR btrim(p_player_id) = '' THEN
    RAISE EXCEPTION 'draft_make_pick: player_id is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'draft_make_pick: action_id is required — client picks are idempotent (§8.1/E2)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the drafts row FIRST (§4.6). The league row is deliberately
  -- NOT locked — see the banner's lock-order note.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  -- (2) VALIDATE. No-leak: a nonexistent draft and a non-member get the
  -- same 42501 (is_league_member(NULL) is FALSE).
  IF NOT FOUND OR NOT public.is_league_member(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_make_pick: not a member of this draft''s league'
      USING ERRCODE = '42501';
  END IF;

  -- A soft-deleted league answers 404 for a legitimate member (063 rule).
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'draft_make_pick: league % not found', v_draft.league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- E2 replay short-circuit — BEFORE status/turn checks: a retried pick is
  -- a no-op returning its original pick + the current authoritative state,
  -- even if the clock has moved on (§8.1 idempotency). R125 DECIDED
  -- (L.B1.4/069): DELIBERATELY no is_undone filter — an action_id is
  -- consumed forever. A stale retry of a commissioner-undone pick returns
  -- the historical (undone) row as a no-op and never re-applies the pick;
  -- filtering would route the retry into a 23505 on uniq_draft_action
  -- (undone rows keep their action_id) surfaced as a misleading E1
  -- message. Pinned in pgTAP 023; the manager re-picks with a fresh
  -- action_id.
  SELECT p.* INTO v_pick
  FROM public.draft_picks p
  WHERE p.draft_id = p_draft_id AND p.action_id = p_action_id;
  IF FOUND THEN
    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'pick', to_jsonb(v_pick));
  END IF;

  -- THE D103(2) MOCK BRANCH (landed by L.B1.6/071 — this was the seam
  -- refusal 066 shipped; the 020 seam pin flipped with it): on a mock the
  -- ONLY legal human caller is the launcher (config.mock.launched_by,
  -- TEXT-compared — R117). Any other member — including the on-clock
  -- seat's REAL manager and the commissioner — is refused: nobody else
  -- drives a member's solo practice, and there is no force-path bypass
  -- for mocks (069's controls refuse them). A config-less mock (only
  -- reachable by privileged fixture inserts — every RPC writer stamps
  -- config.mock) has launched_by NULL and stays tick-only, the safe
  -- default. The human-seat-only half of D103(2) lives at the TURN step
  -- below (it needs status='live' established first so on_clock is real).
  IF v_draft.is_mock
     AND v_draft.config->'mock'->>'launched_by' IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION
      'draft_make_pick: this mock draft is another member''s solo practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.draft_type = 'auction' THEN
    RAISE EXCEPTION
      'draft_make_pick: this is an auction draft — the auction engine lands in M3'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'scheduled' THEN
    RAISE EXCEPTION 'draft_make_pick: the draft has not started yet'
      USING ERRCODE = 'P0001';
  ELSIF v_draft.status = 'paused' THEN
    RAISE EXCEPTION 'draft_make_pick: the draft is paused'
      USING ERRCODE = 'P0001';
  ELSIF v_draft.status = 'complete' THEN
    RAISE EXCEPTION 'draft_make_pick: the draft is complete'
      USING ERRCODE = 'P0001';
  END IF;

  -- TURN. Mock branch (D103(2), the human-seat-only half): the launcher —
  -- already verified above — may pick ONLY while the HUMAN seat is on the
  -- clock (every other seat is tick-only, D93/071 ARM 2.5); the normal
  -- league_members turn check never runs for mocks (the chosen seat may
  -- be a placeholder or another member's franchise — "any seat
  -- selectable", §8.8). Real drafts: the caller manages the on-clock team
  -- (league_members cache — M1's access model). Commissioners use the
  -- L.B1.4 force path, not this RPC: no role bypass exists here.
  IF v_draft.is_mock THEN
    IF v_draft.config->'mock'->>'human_team_id'
       IS DISTINCT FROM v_draft.on_clock_team_id::text THEN
      RAISE EXCEPTION
        'draft_make_pick: a CPU seat is on the clock — CPU picks land on their own (§8.8)'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT m.team_id INTO v_my_team
    FROM public.league_members m
    WHERE m.league_id = v_draft.league_id AND m.user_id = auth.uid();
    IF v_my_team IS NULL OR v_my_team IS DISTINCT FROM v_draft.on_clock_team_id THEN
      SELECT t.name INTO v_on_clock_name
      FROM public.teams t WHERE t.id = v_draft.on_clock_team_id;
      RAISE EXCEPTION
        'draft_make_pick: it is not your turn — % is on the clock',
        COALESCE(v_on_clock_name, 'another team')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT pl.full_name INTO v_player_name
  FROM public.players pl WHERE pl.id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_make_pick: player % not found', p_player_id
      USING ERRCODE = 'P0002';
  END IF;

  -- E1 availability under the lock (friendly path); the partial unique is
  -- the guarantee (§8.1: lock + index make double-picks impossible).
  IF EXISTS (
    SELECT 1 FROM public.draft_picks p
    WHERE p.draft_id = p_draft_id
      AND p.player_id = p_player_id
      AND p.is_undone = FALSE
  ) THEN
    RAISE EXCEPTION
      'draft_make_pick: % just went off the board — pick another player',
      v_player_name
      USING ERRCODE = 'P0001';
  END IF;

  -- (3)+(4)+(5) via the ONE advance path (L.B1.3 amendment (b)): manual
  -- pick shape — is_auto FALSE, made_via 'manager', picked_by = caller.
  BEGIN
    RETURN public.draft_apply_pick_internal(
      p_draft_id, p_player_id, FALSE, 'manager', auth.uid(), p_action_id);
  EXCEPTION WHEN unique_violation THEN
    -- The exotic race loser (non-RPC interleavings the row lock cannot
    -- see) gets the same friendly E1 message (§8.1).
    RAISE EXCEPTION
      'draft_make_pick: % just went off the board — pick another player',
      v_player_name
      USING ERRCODE = 'P0001';
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_make_pick(UUID, TEXT, UUID) FROM PUBLIC, anon;
