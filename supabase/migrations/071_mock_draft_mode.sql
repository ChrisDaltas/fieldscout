-- ============================================================================
-- Mock Draft Mode — migration 071 (task L.B1.6; spec §8.8 ALL bullets,
-- §22.5 caps, §16.5.2 mock workflow row, E59/E60; tasks-M2 §3 D93/D95/D102/
-- D103 + §4 standing rules, §5 sketch — names contractual; PROGRESS D110).
-- Engine-native, ZERO league side effects: a mock is a real `drafts` row
-- (`is_mock = TRUE`) run by the SAME engine — same clock, same tick, same
-- autopick brain (plan §4.2's "one implementation, two consumers": the CPU
-- pick IS `draft_autopick_resolve`, never a fork).
--
-- Contents of THIS file (the amendments live in the amended files — the
-- unreleased-chain amend precedent, F12; inventory below):
--   1. `create_mock_draft(p_league_id, p_human_team_id, p_cpu_speed,
--      p_action_id)` — §8.8 launch: ANY member (not commish-gated — "any league member
--      starts a mock"), league `setup`/`scheduled`, active franchises ==
--      team_count (D103(1) — the order needs a full seat map and
--      draft_picks.team_id is NOT NULL; friendly refusal names placeholder
--      seats as the remedy, the D96 mirror). Snapshots the REAL config at
--      launch (D95: a mock never re-hydrates): the §7.3.8 settings blob +
--      total_rounds via draft_rounds_from_roster (D91) + the order via the
--      ONE resolution implementation (`draft_resolve_order_internal`,
--      extracted into 066 at this task — the real scheduled draft row's
--      stored order wins, else manual/custom config order, else the D105
--      md5 shuffle seeded by the MOCK's own id; "order incl. the
--      launcher's actual slot" is literal when a stored order exists, and
--      under never-randomized `random` mode the real order does not exist
--      yet — a fresh deterministic shuffle is the honest simulation,
--      recorded). `config.mock = {human_team_id, cpu_speed, launched_by}`
--      (+ `action_id` when the route stamps one — the E2 replay ledger,
--      batch 7 R149; no schema change — §8.8; `launched_by` is D103(2)'s
--      authorization key, folded into §8.8 as erratum v2.8.16). Human seat defaults to
--      the launcher's own franchise; ANY active seat selectable (§8.8 —
--      incl. a placeholder or another member's franchise; authorization is
--      launcher-keyed, never seat-keyed, D103(2)/(3)). Starts IMMEDIATELY:
--      status='live', started_at, pick-1 on_clock = order[1], pick-1
--      deadline (timer 0 ⇒ NULL — §8.2 soft timer). Auction config
--      refused naming M3 (the 066 seam precedent — mock auctions are
--      Phase C's gate). The launcher's `draft_liveness` row is SEEDED at
--      launch (launch is the first beat — the E59 stale clock starts
--      honest even if the room never mounts).
--      CAPS IN-BODY (§22.5/D93, friendly refusals — §16.5.2 states):
--        * 3 ACTIVE mocks per user (status live|paused, launched_by =
--          caller, across ALL leagues — §22.5 is per-user, not per-league).
--        * 5 CREATIONS per hour per user — counted over SURVIVING rows
--          (created_at > now() − 1h, any status). RECORDED RESIDUAL: a
--          hard delete removes the row from the count, so create→delete
--          cycles can evade the hourly cap; in-body counting has no other
--          ledger (soft-deleting mocks would contradict §8.8's hard
--          delete/expiry semantics). The M7 rate-limit pass owns the
--          route-layer backstop (F41, annotated).
--      CAP-RACE SERIALIZER: pg_advisory_xact_lock on a per-user key —
--      same-user concurrent launches serialize so the caps cannot be
--      double-tapped past; an advisory lock (not a profiles-row lock)
--      deliberately: row locks on profiles would join the FK KEY-SHARE
--      graph every chat INSERT touches (the R122 deadlock class); advisory
--      locks live outside it.
--      IDEMPOTENCY (§4 rule 6 / E2 — batch 7, R149): `p_action_id uuid
--      DEFAULT NULL`. A retry of an already-committed launch REPLAYS the
--      original mock (`created: false`) instead of creating a second one —
--      the 060 replay pattern. The lookup runs AFTER the advisory lock (a
--      concurrent double-tap serializes into create-then-replay) and
--      BEFORE any league/cap validation (a replay is the same intent; it
--      must not trip caps its own creation already passed — pinned at both
--      caps' ceilings). Ledger = `config.mock.action_id` (no schema
--      change), matched launcher-scoped as TEXT (R117) — an action_id
--      never replays across users. NULL = no-dedupe path (the §5 sketch's
--      3-arg call stands); the L.B2.3 route stamps one UUID per submit.
--      A DELETED mock does not replay (row gone = ledger gone — the same
--      surviving-rows posture as the hourly cap; M7/F41 backstop).
--   2. `delete_mock_draft(p_draft_id)` — launcher-only (covers abandon +
--      recap-delete, §8.8). Locks the drafts row FIRST (§4.6), one 42501
--      no-leak for {nonexistent, non-member}, friendly P0001 for a real
--      draft and for a member who is not the launcher (commissioners have
--      NO bypass — D103(2)'s doctrine: no other member drives, or erases,
--      someone's solo practice). CHILD CLEANUP (task rule — decided +
--      pinned): draft_picks / draft_queues / draft_liveness ride their
--      ON DELETE CASCADE FKs (065/068); `league_chat` mock-room rows
--      (context = 'draft:<mock_id>') are deleted EXPLICITLY in the same
--      txn — the chat FK is to the LEAGUE, not the draft, so CASCADE can
--      never reach them, and leaving them would strand a member-visible
--      ghost context (against E59's "zero league impact either way").
--      D99's append-only chat bans CLIENT update/delete policies; this is
--      the server erasing a deleted mock's room wholesale, not an edit
--      surface — recorded, league-context rows pinned untouched.
--      Works under a soft-deleted league (cleanup must not dead-end).
--   3. `mock_draft_expire()` — the §8.8 72h expiry (daily cron): deletes
--      INCOMPLETE (status <> 'complete') mocks idle > 72h; completed
--      recaps are kept until owner-deleted (pinned). IDLE DEFINITION
--      (task rule — decided + pinned at the boundary): idle_since =
--      GREATEST(drafts.updated_at, the LAUNCHER's draft_liveness beat) —
--      either engine activity (every pick/pause bumps updated_at, D108(1))
--      or human presence (the launcher's heartbeat; seeded at launch so a
--      row always exists — COALESCE('-infinity') guards hand-crafted
--      fixtures) resets the clock; the most conservative deletion posture,
--      because deleting user data early is the bad direction. The E59
--      auto-pause freezes updated_at within ~grace+one-tick of
--      abandonment, so the 72h clock effectively starts at abandonment.
--      Claim shape: FOR UPDATE SKIP LOCKED, batch 25, loop until no rows
--      (the ARM-2 shape), per-row subtransactions, jsonb summary. Also
--      sweeps mocks under soft-deleted leagues (an abandoned mock is
--      league-independent garbage — the F50 zombie class gets this much
--      cleanup for free; completed recaps under deleted leagues linger
--      until owner-deleted, recorded residual). Same chat cleanup as (2).
--   4. `cron.schedule('mock-expiry', '0 3 * * *', …)` — daily (§8.8),
--      idempotent unschedule-first (the 068 pattern).
--
-- AMENDED IN PLACE ALONGSIDE THIS MIGRATION (unreleased chain — F12; each
-- file's banner carries its own note):
--   * 065 — `draft_queues` policies gain the D103(3) mock-launcher
--     carve-out: the launcher owns the HUMAN seat's queue regardless of
--     stint (the chosen seat may be another user's franchise); both
--     policies get the OR arm (mock + launched_by = caller + team =
--     human_team_id, TEXT-compared — the R117 no-cast rule). 019's
--     name/cmd pins hold (names unchanged); behavior pinned in 025.
--   * 066 — (a) `draft_make_pick` gains the D103(2) mock branch replacing
--     the L.B1.6 seam refusal: launcher-only (any other member — including
--     the on-clock seat's REAL manager and the commissioner — gets the
--     friendly solo-practice refusal), human seat only (a CPU seat on the
--     clock answers "CPU picks land on their own"); the normal
--     league_members turn check never runs for mocks. pgTAP 020's seam pin
--     FLIPS to the new refusal (the pin was built to flip — 066's banner
--     cross-reference). (b) `draft_resolve_order_internal` extracted from
--     `draft_start_internal`'s order-resolution block (the D107(2)
--     wrapper/internal precedent) so the mock snapshot and the real start
--     share the ONE order-resolution implementation — byte-identical
--     behavior for the real path (020's order pins prove it), p_label
--     keeps every pinned message intact.
--   * 068 — (a) `draft_mock_think_fraction` + `draft_mock_cpu_due` (pure
--     IMMUTABLE helpers — defined in 068 so the tick never references a
--     not-yet-created function during a fresh-reset cron fire; the
--     068→069 forward-reference lesson applied proactively). Think-time =
--     PRNG(draft_id, pick_number) → 20–70% of the pick clock
--     (`realistic`) or ~2s (`fast`) — deterministic (D93: seeded hash, no
--     stored schedule, no wall-clock/Math.random), pinned as stored
--     literals. (b) `draft_autopick_resolve` is mock-aware: the HUMAN
--     seat resolves under the LAUNCHER's queue/boards (the launcher is
--     the one practicing — the seat may be a placeholder or another
--     member's franchise); every CPU seat resolves as a NO-USER seat
--     (ADP + need — §8.8's bot behavior per D93; a CPU seat NEVER reads
--     its real owner's queue/boards, pinned). (c) `draft_tick` gains
--     ARM 1.6 (the E59 mock stale-pause: a live mock auto-pauses when the
--     LAUNCHER's heartbeat is stale past disconnect_grace_seconds + one
--     tick — the D93 threshold; runs BEFORE the timeout arm so the pause
--     always preempts the grace-hold's deadline+grace autopick), a mock
--     branch in ARM 2 (the human seat keys freshness/grace on the
--     LAUNCHER; a CPU seat that somehow reaches its deadline autopicks
--     immediately), and ARM 2.5 (CPU think-time picks: claims ONLY due
--     mocks — the R135/R141 lock-scope discipline, the claim WHERE is the
--     body's predicate — and writes each pick through
--     draft_autopick_resolve + draft_apply_pick_internal, the SAME brain
--     and advance path as a live timeout; one CPU pick per mock per pass,
--     the think origin is the advance instant — so `fast` ≈ 2s think-time
--     lands on the first tick after it elapses, effective cadence bounded
--     by the 5s tick, the same granularity class D87 records for timeout
--     lag).
--   * 069 — (a) `draft_pause`/`draft_resume` gain the mock-launcher arm:
--     on a mock the ONLY legal human caller is `config.mock.launched_by`
--     (§8.8 "pause/leave anytime … resumable" + "Same engine, literally:
--     … pause/resume" — the launcher must be able to freeze and resume
--     their own practice, and E59's auto-pause needs a resume path that
--     cannot dead-end on a non-commissioner launcher); commissioners have
--     NO bypass (D103(2) — nobody else drives a solo practice). The
--     42501 no-leak floor is unchanged for real drafts (023's pins hold).
--     (b) every OTHER §8.7 control (set_clock/undo/reassign/move/force/
--     set_order/reset) REFUSES mocks with a friendly P0001: §8.7 is the
--     REAL-draft commissioner surface; on a mock those controls are
--     either interference with a member's solo practice (D103(2)) or —
--     draft_reset — an outright zero-side-effect breach (reset writes
--     leagues.status + removes the stored schedule instant; on a mock
--     that would be exactly the league write §8.8 bans; live-verified
--     before guarding). The launcher's controls are pause/resume/delete.
--
-- Zero-side-effect contract (§8.8, pinned by the pgTAP 025 full-table
-- diff): a scripted mock from launch to completion changes NOTHING
-- league-scoped outside `drafts` / `draft_picks` / `draft_queues` /
-- `draft_liveness` / `league_chat(context='draft:<mock_id>')` — no
-- `league_rosters`, no league status transition, no notifications, the
-- leagues row byte-identical. Mock completion is 066's counted completion
-- (status='complete' + completed_at, on_clock/deadline NULLed) — already
-- league-neutral; 072's completion arm must keep its mock bypass (its own
-- task text re-pins it from the completion side). Mock chat rows are
-- member-visible by D99's printed SELECT (recorded there: visibility is
-- not a §8.8 "side effect").
--
-- E60 independence: the D95 partial unique ignores mocks — a live mock
-- and the league's real scheduled draft coexist (pinned in 019 at the
-- index and re-pinned in 025 from the RPC path with the real draft shown
-- untouched). E59: auto-pause on disconnect (ARM 1.6) + resumable
-- (launcher draft_resume) + 72h expiry + zero league impact (the diff pin
-- + delete cleanup).
--
-- Grants doctrine (D18→D23 / tasks-M1 §4.1): no per-object GRANTs;
-- `create_mock_draft`/`delete_mock_draft` are SECURITY DEFINER + SET
-- search_path = '' + in-body auth + REVOKE FROM PUBLIC, anon;
-- `mock_draft_expire` is SECURITY DEFINER + REVOKE FROM PUBLIC, anon,
-- authenticated (cron/service only — the draft_tick narrowing). The pure
-- helpers (068) keep broad EXECUTE (the draft_team_for_pick precedent —
-- pure math over arguments, no data access); `draft_resolve_order_internal`
-- (066) is a plain internal with the 062-form triple REVOKE.
--
-- Realtime (standing rule 5): mocks broadcast through the SAME 070
-- triggers (drafts UPDATE / draft_picks INSERT / league_chat INSERT emit
-- on 'draft:<mock_id>'; the channel-auth policies already cover any
-- league member — §8.8 scopes the mock to its own topic) and the tick
-- heartbeat (068 ARM 3) beats live mocks like real drafts (recorded at
-- D109(6)). No new broadcast surface; `draft_liveness`/`draft_queues`
-- stay never-broadcast.
--
-- SQLSTATE convention (062/063 verbatim): 42501 auth + no-leak · P0002 →
-- 404 · P0001 friendly refusal · 22023 argument shape. Every refusal
-- string is UX and pgTAP-pinned (025).
--
-- Typegen: RE-RUN (new functions change the generated surface); alias
-- block re-appended, diff verified additive-only (§4.4).
--
-- Staging rehearsal: R6 waiver — no staging clone exists (environments
-- are local + prod only); the recorded rehearsal evidence is the fresh
-- local `npx supabase db reset` replay of the full 001–071 chain plus
-- pgTAP 025 in the same PR (session log 2026-08-04). F12 note: prod's
-- migration history still ends pre-league-schema; this lands with the
-- next normal push.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. create_mock_draft — §8.8 launch (any member; caps in-body; snapshot;
--    starts immediately)
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

  -- The M3 seam: mock auctions are Phase C's gate (§18) — M2 implements
  -- none of §8.6 (the 066 refusal precedent).
  IF COALESCE(v_config->>'draft_type', 'snake') = 'auction' THEN
    RAISE EXCEPTION
      'create_mock_draft: league % is configured for an auction draft — mock auctions land with the auction engine in M3',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;

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
  SELECT d.draft_order INTO v_real_order
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

  v_timer := COALESCE((v_config->>'pick_timer_seconds')::int, 90);

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

  -- Starts immediately (§8.8): live, pick 1 on the clock. The D95 partial
  -- unique ignores mocks — the league's real scheduled draft coexists
  -- (E60).
  INSERT INTO public.drafts
    (id, league_id, draft_type, status, is_mock, config, draft_order,
     total_rounds, current_round, current_pick_number, on_clock_team_id,
     current_deadline, started_at)
  VALUES
    (v_mock_id, p_league_id,
     COALESCE(v_config->>'draft_type', 'snake'),
     'live', TRUE, v_config, v_order,
     v_total_rounds, 1, 1,
     public.draft_team_for_pick(
       v_order, COALESCE(v_config->>'draft_type', 'snake'),
       COALESCE((v_config->>'snake_reversal')::boolean, FALSE), 1),
     CASE WHEN v_timer > 0 THEN now() + make_interval(secs => v_timer) END,
     now())
  RETURNING * INTO v_draft;

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
-- 2. delete_mock_draft — launcher-only delete (abandon + recap-delete)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION delete_mock_draft(p_draft_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft public.drafts;
BEGIN
  -- (1) LOCK the drafts row FIRST (§4.6) — a tick claim in flight
  -- serializes here; the SKIP LOCKED arms skip us symmetrically.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  -- (2) VALIDATE. No-leak: nonexistent draft and non-member get the same
  -- 42501. Deliberately NO deleted-league gate: deleting one's own mock
  -- under a soft-deleted league is cleanup and must not dead-end
  -- (membership rows survive the soft delete).
  IF NOT FOUND OR NOT public.is_league_member(v_draft.league_id) THEN
    RAISE EXCEPTION 'delete_mock_draft: not a member of this draft''s league'
      USING ERRCODE = '42501';
  END IF;

  IF NOT v_draft.is_mock THEN
    RAISE EXCEPTION 'delete_mock_draft: draft % is not a mock draft', p_draft_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Launcher-only (D103(2) doctrine) — commissioners included in the
  -- refusal: nobody else erases a member's solo practice.
  IF v_draft.config->'mock'->>'launched_by' IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION
      'delete_mock_draft: only the member who launched this mock can delete it (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  -- (3) Child cleanup: chat EXPLICITLY (FK is to the league — banner item
  -- 2), everything else rides ON DELETE CASCADE.
  DELETE FROM public.league_chat
  WHERE league_id = v_draft.league_id
    AND context = 'draft:' || v_draft.id::text;

  DELETE FROM public.drafts WHERE id = v_draft.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION delete_mock_draft(UUID) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 3. mock_draft_expire — the §8.8 72h expiry (daily cron; idle =
--    GREATEST(updated_at, launcher's last beat) — banner item 3)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mock_draft_expire()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_batch    CONSTANT INTEGER := 25;
  c_max_loops CONSTANT INTEGER := 40;
  v_row      RECORD;
  v_draft    public.drafts;
  v_idle     TIMESTAMPTZ;
  v_seen     UUID[] := '{}';
  v_pass     INTEGER;
  v_loops    INTEGER := 0;
  v_expired  INTEGER := 0;
  v_failures JSONB := '[]'::jsonb;
BEGIN
  LOOP
    v_loops := v_loops + 1;
    v_pass := 0;

    FOR v_row IN
      SELECT d.id
      FROM public.drafts d
      WHERE d.is_mock
        AND d.status <> 'complete'          -- recaps kept until owner-deleted
        AND NOT (d.id = ANY(v_seen))
        -- Idle > 72h: neither engine activity nor a launcher heartbeat.
        AND GREATEST(
              d.updated_at,
              COALESCE((SELECT dl.last_seen_at
                        FROM public.draft_liveness dl
                        WHERE dl.draft_id = d.id
                          AND dl.user_id::text = d.config->'mock'->>'launched_by'),
                       '-infinity'::timestamptz)
            ) < now() - interval '72 hours'
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_seen := v_seen || v_row.id;
      BEGIN
        SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_row.id;
        -- Re-verify under the held lock (authoritative — the claim is a
        -- snapshot pre-filter, the R135 discipline).
        IF v_draft.status = 'complete' OR NOT v_draft.is_mock THEN
          CONTINUE;
        END IF;
        v_idle := GREATEST(
          v_draft.updated_at,
          COALESCE((SELECT dl.last_seen_at
                    FROM public.draft_liveness dl
                    WHERE dl.draft_id = v_draft.id
                      AND dl.user_id::text = v_draft.config->'mock'->>'launched_by'),
                   '-infinity'::timestamptz));
        IF v_idle >= now() - interval '72 hours' THEN
          CONTINUE;
        END IF;

        -- Same cleanup as delete_mock_draft (chat explicit, CASCADE for
        -- the rest).
        DELETE FROM public.league_chat
        WHERE league_id = v_draft.league_id
          AND context = 'draft:' || v_draft.id::text;
        DELETE FROM public.drafts WHERE id = v_draft.id;
        v_expired := v_expired + 1;
      EXCEPTION WHEN OTHERS THEN
        v_failures := v_failures || jsonb_build_object(
          'draft_id', v_row.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'mock_draft_expire failed for draft %: % (%)',
          v_row.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass = 0 OR v_loops >= c_max_loops;
  END LOOP;

  RETURN jsonb_build_object(
    'expired', v_expired,
    'failures', v_failures,
    'loops', v_loops);
END;
$$;

-- Cron/service only (the draft_tick narrowing).
REVOKE EXECUTE ON FUNCTION mock_draft_expire() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. pg_cron: the daily mock-expiry schedule (§8.8; idempotent — the 068
--    pattern)
-- ---------------------------------------------------------------------------

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mock-expiry') THEN
    PERFORM cron.unschedule('mock-expiry');
  END IF;
  PERFORM cron.schedule('mock-expiry', '0 3 * * *', 'SELECT public.mock_draft_expire()');
END;
$do$;
