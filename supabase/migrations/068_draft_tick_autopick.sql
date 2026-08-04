-- ============================================================================
-- Autopick + draft_liveness/draft_touch + draft_tick + pg_cron — migration
-- 068 (task L.B1.3; spec §8.2 timer/worker, §8.4 autopick strategy + E30,
-- §8.5.4–5 timeout/disconnect + E3, §14 draft-tick row, §22.3 job
-- architecture; tasks-M2 §3 D87/D90/D93/D94/D100/D102 + §4.6 lock
-- discipline, §5 sketch — names contractual). The authoritative clock:
-- the draft is correct even if every client disconnects (§8.2/§14).
--
-- Contents:
--   1. `draft_liveness` (D102 — spec-absent schema, recorded as the D102
--      erratum, spec v2.8.13): (draft_id, user_id, last_seen_at),
--      PK(draft_id, user_id). Deliberately its OWN TABLE, never a `drafts`
--      column — heartbeats must not contend with the draft-row lock. RLS
--      enabled with NO policies: no client DML, no client SELECT, no
--      broadcast (writes only via draft_touch; the tick reads it under
--      definer rights; presence UI rides Realtime Presence, §9 — not this
--      table).
--   2. `draft_liveness_freshness()` — THE pinned D102 freshness constant:
--      interval '45 seconds' = 3 × the 15s room heartbeat cadence, i.e. a
--      seat is FRESH while it has missed ≤ 2 beats. Named as a function so
--      the commissioner-outage arm reuses the SAME constant (one
--      implementation — it does, since the L.B1.4 amendment; pgTAP 022
--      pins the literal). The tick's GRACE branch measures it against the
--      DEADLINE instant (R132 — see the ARM 2 notes below); the OUTAGE
--      arm measures it as-of-now (see ARM 1.5 — a deliberate contrast,
--      reasoned there).
--   3. `draft_touch(p_draft_id)` — the D102 heartbeat (real + mock rooms,
--      ~15s cadence + visibility change): upserts (draft_id, auth.uid()).
--      SECURITY DEFINER, in-body auth: caller must be a league member of
--      the draft's league (nonexistent draft answers the SAME 42501 —
--      no-leak). Deliberately does NOT touch the drafts row (no lock
--      contention — the reason the table exists).
--   4. `draft_autopick_resolve(p_draft_id, p_team_id)` — the ONE autopick
--      resolution implementation (D90: engine authority in SQL only;
--      §7.3.8 `autopick_default` = queue_then_board_then_adp, §8.4).
--      Source priority, each source skipping drafted AND filter-ineligible
--      players before falling through to the next:
--        (1) the seat's own `draft_queues` rows (rank order) — R120: the
--            065 banner records that queue policies validate TEAM ownership
--            only, so rows can reference ANY draft_id; this fn treats them
--            as untrusted hints and JOINs teams → the draft's league
--            (a row whose team is not a franchise of THIS draft's league
--            is never honored);
--        (2) the seat user's primary league-tagged board
--            (`league_lists.is_primary_board` → `list_players.position`
--            order — 003's canonical 1-based list order);
--        (3) the seat user's season Big Board (`lists.is_big_board`, same
--            order);
--        (4) lowest `players.adp` (NULLS LAST, id tiebreak).
--      Seats with NO user (placeholder / vacated — E48's autopilot) skip
--      sources 1–3 entirely and resolve straight to (4) (task rule; a
--      vacated seat's leftover queue rows are NOT honored).
--
--      THE DOCUMENTED GREEDY NEED-FIT MODEL (task latitude "Builder
--      finalizes the documented greedy" — finalized HERE; the full
--      bipartite slot-fit is M4's lineup validator, E16/tasks-M2 §1):
--        a. Normalize position: players.position 'DEF' → 'DST' (the
--           roster_settings vocabulary — league-settings.ts ROSTER_POSITIONS
--           note: DST is the canonical roster spelling, DEF the research-
--           surface/Sleeper spelling).
--        b. Assign the team's existing live (non-undone) picks greedily in
--           pick order: each fills the FIRST unfilled starting slot (in
--           `roster_settings.starting_slots` array order) whose eligible
--           set contains the player's normalized position; otherwise it
--           occupies a bench seat. (Greedy, order-dependent — documented
--           limitation; E16's bipartite matching is M4's.)
--        c. remaining := total_rounds − picks_made;
--           unfilled := Σ over starting slots of (count − filled).
--        d. FORCED mode (remaining <= unfilled): only players whose
--           normalized position fits some UNFILLED starting slot are
--           eligible — every remaining pick must fill a required seat.
--           This is also E30's "until (open slots − remaining picks)
--           forces them" arm: K/DST become eligible in forced mode when a
--           K/DST seat is among the unfilled.
--        e. OPEN mode with needs open (unfilled > 0): position P is
--           INELIGIBLE when have(P) >= S(P) + 1, where S(P) = Σ counts of
--           starting slots whose eligible set contains P (flex slots
--           count) — i.e. all P-fillable starting capacity is covered AND
--           one bench backup is already held. This is the §8.4 3rd-QB
--           rule, pinned: a 1-QB league (S=1) blocks the 3rd QB while
--           other needs are open, and permits the 2nd (the backup).
--           ("Bench headroom" in this model = exactly one backup seat per
--           position while required seats remain unfilled.)
--        f. OPEN mode with no needs (unfilled = 0): caps lift — pure
--           best-available fills the bench.
--        g. E30 K/DST deferral (OPEN mode only — forced overrides): K and
--           DST are ineligible until current_round > total_rounds − 3,
--           pinned at the exact boundary (round total_rounds−3 still
--           deferred; round total_rounds−2 eligible; pgTAP 022).
--        h. FLOOR (never stall — §22.3 zero stuck clocks): if every source
--           and filter yields nothing, the lowest-ADP available player
--           (NULLS LAST, id tiebreak) is returned with NO filters. NULL
--           only when the entire pool is drafted.
--   5. `draft_tick()` — D87: pg_cron calling this in-database SQL RPC; NO
--      Edge Function, NO HTTP hop (the §8.2/§14 "Edge Function invoked by
--      pg_cron" vehicle is an ERRATUM, folded as spec v2.8.13; the repo
--      has zero Edge Functions and its Vercel-cron floor is 60s — tasks-M2
--      C21/D87; pg_net self-invocation is the recorded escape hatch if 5s
--      proves coarse). No arguments; returns a jsonb summary; safe to call
--      directly (the D100 harness path — service-role deadline rewinds
--      between direct calls) AND from cron; self-gating no-op when nothing
--      is due. Concurrent invocations are safe by construction (SKIP
--      LOCKED claims, idempotent arms — §22.3). Two arms in this task:
--        ARM 1 — D94 auto-start: scans LEAGUES in 'scheduled' whose
--        `settings.draft.draft_scheduled_at` <= now() (the league scan —
--        never the drafts table — so a league scheduled purely through the
--        settings surface, which creates NO drafts row, can never
--        dead-end), claims each with FOR UPDATE SKIP LOCKED (never waits
--        behind a user's settings PATCH; skipped rows retry next tick),
--        and drives 066's `draft_start_internal(league, FALSE)` — the ONE
--        start implementation (create-if-absent included; capacity +
--        snapshot checks identical to the manual path). Failures are
--        RECORDED in the summary + WARNed with the league_id and retried
--        every tick — never a silent skip (D94; the per-league
--        subtransaction rolls back any partial state; the lobby banner is
--        L.B3.4's read of the same refusal).
--        SEAM (routed to L.B1.4, tasks-M2 §6 read-list line): draft_reset
--        returns draft + league to 'scheduled'; under a PAST
--        draft_scheduled_at this arm would auto-restart the reset draft on
--        the next tick — L.B1.4 owns reset semantics and must clear or
--        re-gate the schedule (D107).
--        ARM 2 — timeout → autopick per the D102 contract (§8.5.4/§8.5.5/
--        E3): claims due drafts (status='live', current_deadline <= now()
--        — idx_drafts_due) in batches of 25 with FOR UPDATE SKIP LOCKED
--        (the §4.6 discipline: a user action holding the draft row is
--        SKIPPED, never blocked), looping until no due rows (§22.3
--        batch-limited; loop-capped). At deadline expiry, for the on-clock
--        seat:
--          * `is_autodraft` seats, NO-USER seats (placeholder/vacated —
--            E48's autopilot), and seats FRESH AS OF THE DEADLINE INSTANT
--            (a `draft_liveness` heartbeat in (deadline − 45s, deadline] —
--            ≤ 2 missed beats at expiry) autopick IMMEDIATELY (§8.5.4:
--            timeout → autopick);
--          * a STALE seat's pick is HELD OPEN until deadline +
--            `disconnect_grace_seconds` (§7.3.8 default 30) — the deadline
--            stays past-due and each tick re-evaluates; a returning human
--            may pick manually during the hold ("reconnect restores
--            manual control", §8.5.5/E3 — draft_make_pick never checks the
--            deadline) — then autopicks at deadline + grace. R132 (M2
--            batch 4): the fresh/stale branch is decided AS OF the
--            deadline, never re-derived from now() — a mid-hold heartbeat
--            (the returning manager's own draft_touch) can NOT end the
--            hold; pre-fix it flipped the seat FRESH and the next tick
--            autopicked them inside the grace window. Residual (recorded):
--            the PK upsert means a beat landing between deadline and the
--            first tick overwrites pre-deadline evidence — that seat errs
--            into the protective hold, never an early autopick.
--        The autopick writes through 066's `draft_apply_pick_internal` —
--        the SAME advance/completion path as a manual pick (reuse, never
--        fork): is_auto=TRUE, made_via='autopick', picked_by NULL,
--        action_id NULL (§12.4's system-pick shape; NULL action_id
--        coexists freely under uniq_draft_action).
--        ARM 1.5 — THE §8.7 COMMISSIONER-OUTAGE AUTO-PAUSE (D102/§8.7:478;
--        LANDED 2026-08-04 with L.B1.4/069 — this migration amended in
--        place, the unreleased-chain precedent F12; it runs BETWEEN the
--        auto-start and timeout arms so an expired deadline under an
--        outage PAUSES instead of autopicking — "nothing runs unsupervised
--        during an outage"; the ordering is PINNED, pgTAP 023 §H R136: an
--        expired-past-grace deadline under an outage → paused, negative
--        remaining persisted, zero picks): a live NON-mock draft auto-pauses when
--        supervision was ESTABLISHED and then LOST — at least one
--        commissioner/co-commissioner `draft_liveness` row exists for the
--        draft AND none is newer than now() − (draft_liveness_freshness()
--        + disconnect_grace_seconds), i.e. the "no commissioner heartbeat
--        is fresh" condition (freshness = the ONE 45s constant) has held
--        for more than the grace. FRESHNESS IS AS-OF-NOW here — the
--        deliberate contrast with R132's as-of-deadline pick hold: the
--        pick hold classifies a seat at a FIXED past instant (the
--        deadline) and a later beat must not rewrite that classification;
--        the outage check is a CONTINUOUS present-tense supervision
--        question with no reference instant — every tick honestly
--        re-asks "is any commissioner supervising NOW?", a returning
--        commissioner ends the outage condition immediately (but NEVER
--        auto-resumes — resume is a commissioner action, §8.7; pinned),
--        and a newly-departed one starts the clock from their last beat.
--        THE NEVER-CONNECTED EXEMPTION (D108): a draft whose
--        commissioners have ZERO liveness rows (auto-started and never
--        opened, or started and never opened) is D94's unattended
--        autopilot ("absent rooms still draft correctly"; E48) — §8.7's
--        word is "disconnects", which presupposes a connection; pausing
--        never-attended drafts would dead-end every D94 auto-start.
--        CLAIM SCOPE (R135, M2 batch 5; R141, batch-5 addendum): the
--        claim's WHERE carries the same established-then-lost supervision
--        predicate the body re-verifies under the lock, PLUS the body's
--        deleted-league re-check mirrored in (R141 — without it a live
--        draft under a soft-deleted league, reachable today because
--        soft_delete_league (060) has no draft-status gate, matched the
--        claim WHERE forever: claimed + locked every tick, body-skipped,
--        never paused, never leaving the candidate set — a
--        permanent-candidate class; pinned in 023 §H via pgrowlocks on the
--        LD fixture), plus a LIMIT 25 batch cap (ARM 2 symmetry) — so a
--        fully supervised, never-connected, or deleted-league live draft
--        is NEVER locked by this arm. The no-loop shape's "overflow
--        candidates wait ≤ 5s for the next tick" holds only INSIDE the
--        ≤25-draft M2 gate (no ORDER BY/loop/v_seen = no batch rotation
--        beyond it; persistent-failure candidates could then starve real
--        ones — routed to M7/L.F1's §22.6 load gate as F50).
--        Pre-fix the unfiltered claim locked EVERY
--        live non-mock draft each tick and held the locks for the rest of
--        the tick transaction (a two-session probe showed a pick RPC on a
--        fully supervised, not-due draft dying on lock_timeout behind the
--        batch — against §22.3/§22.6 and the 25-draft M2 gate). Pinned via
--        pgrowlocks lock-visibility in pgTAP 023 §H (a supervised and a
--        never-connected live draft carry NO "For Update" after the
--        ticks; a claimed-and-skipped due draft shown still locked as the
--        probe's positive control).
--        Pauses ride 069's `draft_pause_internal` — the ONE pause
--        bookkeeping implementation (remaining persisted to the ms,
--        deadline NULLed, system chat post with user_id NULL — the tick
--        has no acting user). Summary keys: outage_paused,
--        outage_failures. FORWARD REFERENCE, safe: plpgsql resolves the
--        callee at CALL time, and in a fresh 001–069 replay no live draft
--        (and no commissioner heartbeat) can exist in the 068→069 window;
--        the per-draft subtransaction contains any exotic gap as a
--        recorded failure.
--        MOCK ARMS (LANDED 2026-08-04 with L.B1.6/071 — this migration
--        amended in place, F12; D93/D103, PROGRESS D110):
--          * ARM 1.6 (before ARM 2) — the E59 stale-pause: a live mock
--            auto-pauses when the LAUNCHER's heartbeat is stale past
--            disconnect_grace_seconds + one tick (the D93 threshold;
--            keyed on config.mock.launched_by, never the seat owner);
--            always preempts the grace-hold's deadline+grace autopick
--            (the threshold expires ≥ 40s before any hold does — see the
--            arm comment); claim scope = stale live mocks under alive
--            leagues ONLY (R135/R141 — a healthy mock is never locked);
--            resume is the launcher's action (069), never the tick's.
--          * ARM 2 mock branch — the human seat keys freshness/grace on
--            the LAUNCHER (seat-owner is_autodraft irrelevant); a CPU
--            seat reaching its deadline autopicks immediately (no-user
--            semantics).
--          * ARM 2.5 (after ARM 2) — CPU think-time picks: due =
--            draft_mock_cpu_due (pick start + PRNG 20–70% of clock /
--            ~2s fast); THE PICK IS draft_autopick_resolve +
--            draft_apply_pick_internal — the same brain and advance path
--            as a live timeout ("one implementation, two consumers",
--            plan §4.2); one CPU pick per mock per pass (effective fast
--            cadence bounded by the 5s tick — the D87 granularity class,
--            recorded); claim scope = due mocks only.
--          * draft_autopick_resolve is mock-aware: human seat → the
--            launcher's queue/boards; CPU seats → no-user (ADP + need —
--            a CPU never reads its real owner's prep, pinned in 025).
--        ARM 3 — THE §9.1 TICK HEARTBEAT (LANDED 2026-08-04 with
--        L.B1.5/070 — this migration amended in place, the unreleased-
--        chain precedent F12): after the state-changing arms, one
--        realtime.send() per LIVE draft under a non-deleted league —
--        event 'tick' on 'draft:<id>', payload { server_now,
--        current_deadline } (§9.1's clock-drift beat; §9.3's subscribe-
--        time offset correction). Vehicle finalized per the L.B1.5
--        latitude: PER TICK PASS (~5s), not every third pass — the tick
--        is stateless across invocations (a 1-in-3 counter would need a
--        persisted cell or clock-modulo jitter), a ≤5s beat strictly
--        tightens the printed 15s correction cadence, and the message
--        cost (1 msg/5s per live draft) is bounded by the ≤25-draft M2
--        gate (recorded residual, D109: 3× the printed volume; M7's
--        §22.6 load gate measures message volume as part of its existing
--        charter — no new obligation). LOCK DISCIPLINE (R135/R141): the
--        beat is a PLAIN SELECT — no FOR UPDATE, no claim, zero new lock
--        scope; it runs AFTER the arms so the beat reflects post-arm
--        state (a just-made autopick's fresh deadline beats in the same
--        pass); the deleted-league exclusion mirrors the R141 discipline
--        (a zombie live draft under a soft-deleted league gets no beat —
--        F50's product question owns that class). Paused drafts get no
--        beat (their clock is frozen; current_deadline is NULL and the
--        §16.5.2 pause display reads deadline_remaining_ms via refetch);
--        mocks (status='live', when 071 lands) beat like real drafts —
--        their rooms run the same clock. realtime.send() traps its own
--        errors (verified from the local definition), and the arm is
--        wrapped in one containment block anyway (summary keys:
--        heartbeats, heartbeat_failures).
--        LOCK-HOLD NOTE: a single invocation is one transaction, so claimed
--        rows stay locked until it returns (a user pick on a JUST-CLAIMED
--        draft waits ~ms for the batch to finish — the §22.3 "own
--        transaction per item" ideal needs a procedure, which PostgREST
--        cannot call; recorded residual, covered by the D87 escape hatch).
--        R135 bounds WHAT gets claimed: only due drafts (ARM 2) and
--        alive-league outage candidates (ARM 1.5 — R141) are ever locked —
--        a healthy live draft is untouched by the tick.
--   6. `CREATE EXTENSION pg_cron` + `cron.schedule('draft-tick',
--      '5 seconds', …)` (D87; §22.3 — ONE cron entry, never one per
--      league; pg_cron 1.5+ sub-minute syntax; local stack preloads
--      pg_cron, cron.database_name = postgres). Idempotent:
--      unschedule-if-exists first. Worst-case timeout-enforcement lag ~5s
--      (inside incumbent norms; the p95 pick→broadcast < 500ms metric
--      targets user actions, not timeouts — D87). HOSTED-PROJECT
--      ENABLEMENT NOTE (D87): pg_cron must be available/enabled on the
--      hosted project (Dashboard → Database → Extensions, or this
--      migration's CREATE EXTENSION on plans that allow it) BEFORE `db
--      push` reaches 068; Supabase runs cron jobs in the `postgres`
--      database, which is where this schema lives.
--
-- 066 AMENDED IN PLACE alongside this migration (unreleased chain — F12;
-- see 066's banner): draft_create/draft_start refactored into auth
-- wrappers over `draft_create_internal`/`draft_start_internal` (the tick
-- runs with no JWT), `draft_apply_pick_internal` extracted from
-- draft_make_pick's write/advance steps, and R126 taken (`v_mode IN
-- ('manual','custom')`).
--
-- Grants doctrine (D18→D23 / tasks-M1 §4.1): no per-object GRANTs;
-- `draft_touch` is SECURITY DEFINER + SET search_path = '' + in-body auth
-- + REVOKE FROM PUBLIC, anon; `draft_tick` is SECURITY DEFINER + REVOKE
-- FROM PUBLIC, anon, AUTHENTICATED (service-role/cron only — the
-- 062-internal-helper precedent; its in-body auth is that narrowing);
-- `draft_autopick_resolve` is a plain internal helper (non-SECURITY-
-- DEFINER — executes under its SECURITY DEFINER caller; 062 form) with the
-- same triple REVOKE; `draft_liveness_freshness` is a pure constant with
-- deliberately broad EXECUTE (the draft_team_for_pick precedent — leaks
-- nothing).
--
-- Realtime (standing rule 5): draft_liveness is NEVER broadcast (D102);
-- the autopicked drafts/draft_picks writes get their triggers in migration
-- 070 (L.B1.5), which also amends ARM 3 (the §9.1 heartbeat) into this
-- file — the first subscriber arrives with L.B3.1.
--
-- Typegen: RE-RUN (new table + functions change the generated surface);
-- alias block re-appended + `DraftLiveness` added, diff additive-only
-- (§4.4).
--
-- Staging rehearsal: R6 waiver — no staging clone exists (environments are
-- local + prod only); the recorded rehearsal evidence is the fresh local
-- `npx supabase db reset` replay of the full 001–068 chain plus pgTAP 022
-- in the same PR (session log 2026-08-03). F12 note: prod's migration
-- history still ends pre-league-schema; this lands with the next normal
-- push (with the pg_cron enablement note above).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. draft_liveness (D102 — own table; no policies: no client DML, no
--    client SELECT, no broadcast)
-- ---------------------------------------------------------------------------

CREATE TABLE draft_liveness (
  draft_id UUID REFERENCES drafts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_id, user_id)
);

ALTER TABLE draft_liveness ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policies: heartbeats are written only via draft_touch
-- (SECURITY DEFINER) and read only by the tick/069's outage arm under
-- definer rights. pgTAP 022 pins deny-by-default per role.

-- ---------------------------------------------------------------------------
-- 2. draft_liveness_freshness — the pinned D102 constant (≤ 2 missed beats)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_liveness_freshness()
RETURNS INTERVAL
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  -- D102: the room heartbeats every ~15s; a seat is FRESH while it has
  -- missed <= 2 beats => last_seen_at within 3 × 15s = 45 seconds. ONE
  -- constant — 069's commissioner-outage arm must reuse this function.
  SELECT interval '45 seconds';
$$;

-- ---------------------------------------------------------------------------
-- 2b. draft_mock_think_fraction — D93's deterministic CPU think-time PRNG
--     (added by L.B1.6/071 — amended in place, F12; defined HERE so the
--     tick never references a not-yet-created function during a
--     fresh-reset cron fire). Seeded hash of (draft_id, pick_number) →
--     a fraction in [0.20, 0.70): same inputs, same fraction, forever —
--     no stored schedule, no wall-clock, no Math.random (D93). Occasional
--     near-buzzer picks fall out of the distribution's tail naturally
--     (§8.8). '00' + 6 hex chars ⇒ a provably non-negative 24-bit int;
--     round(…, 6) keeps the literal pins stable. Pure math over
--     arguments — broad EXECUTE deliberately (the draft_team_for_pick
--     precedent); stored-literal-pinned in pgTAP 025.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_mock_think_fraction(
  p_draft_id UUID,
  p_pick_number INTEGER
) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE STRICT
SET search_path = ''
AS $$
  SELECT round(
    0.20 + 0.50 * (('x' || '00' || left(md5(p_draft_id::text || ':' || p_pick_number::text), 6))::bit(32)::int
                   / 16777216.0),
    6);
$$;

-- ---------------------------------------------------------------------------
-- 2c. draft_mock_cpu_due — WHEN a mock CPU pick lands (L.B1.6/071; D93):
--     pick start (deadline − timer for a timed draft; updated_at — the
--     advance instant — for an untimed one) + think-time (`fast` ≈ 2s;
--     `realistic` = think-fraction × the pick clock; an untimed draft has
--     no clock to take a fraction of, so its CPUs think ~2s regardless of
--     speed — recorded). ONE implementation for the ARM 2.5 claim WHERE
--     and its under-lock re-check (the R135 claim ≡ body discipline).
--     Pure over arguments — IMMUTABLE, broad EXECUTE (same precedent).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_mock_cpu_due(
  p_draft_id UUID,
  p_config JSONB,
  p_current_deadline TIMESTAMPTZ,
  p_updated_at TIMESTAMPTZ,
  p_pick_number INTEGER
) RETURNS TIMESTAMPTZ
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  WITH s AS (
    SELECT COALESCE((p_config->>'pick_timer_seconds')::int, 90) AS timer,
           COALESCE(p_config->'mock'->>'cpu_speed', 'realistic') AS speed
  )
  SELECT CASE
           WHEN s.timer > 0 AND p_current_deadline IS NOT NULL
           THEN p_current_deadline - make_interval(secs => s.timer)
           ELSE p_updated_at
         END
         + CASE
             WHEN s.speed = 'fast' OR s.timer = 0 OR p_current_deadline IS NULL
             THEN interval '2 seconds'
             ELSE make_interval(secs =>
                    s.timer * public.draft_mock_think_fraction(p_draft_id, p_pick_number))
           END
  FROM s;
$$;

-- ---------------------------------------------------------------------------
-- 3. draft_touch — the D102 heartbeat (writes draft_liveness ONLY)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_touch(p_draft_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league UUID;
BEGIN
  SELECT d.league_id INTO v_league
  FROM public.drafts d
  WHERE d.id = p_draft_id;
  -- No-leak: a nonexistent draft and a non-member get the same 42501
  -- (is_league_member(NULL) is FALSE).
  IF NOT FOUND OR NOT public.is_league_member(v_league) THEN
    RAISE EXCEPTION 'draft_touch: not a member of this draft''s league'
      USING ERRCODE = '42501';
  END IF;

  -- Never touches the drafts row (D102 — no contention with the draft-row
  -- lock; that is the whole reason this table exists).
  INSERT INTO public.draft_liveness (draft_id, user_id, last_seen_at)
  VALUES (p_draft_id, auth.uid(), now())
  ON CONFLICT (draft_id, user_id)
  DO UPDATE SET last_seen_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_touch(UUID) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 4. draft_autopick_resolve — the ONE §8.4 resolution implementation
--    (sources + the documented greedy + E30; banner item 4)
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
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_draft.league_id;

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
  v_slots := COALESCE(v_league.roster_settings->'starting_slots', '[]'::jsonb);
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
      v_ok := (v_row.pos NOT IN ('K', 'DST')
               OR v_draft.current_round > v_draft.total_rounds - 3)
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
-- 5. draft_tick — the authoritative clock (D87/D94/D102; §22.3)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_tick()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_batch     CONSTANT INTEGER := 25;
  c_max_loops CONSTANT INTEGER := 40;
  v_lg             RECORD;
  v_at             TIMESTAMPTZ;
  v_res            JSONB;
  v_scanned        INTEGER := 0;
  v_started        INTEGER := 0;
  v_start_failures JSONB := '[]'::jsonb;
  v_seen           UUID[] := '{}';
  v_pass           INTEGER;
  v_row            RECORD;
  v_draft          public.drafts;
  v_user           UUID;
  v_autodraft      BOOLEAN;
  v_grace          INTEGER;
  v_fresh          BOOLEAN;
  v_player         TEXT;
  v_claimed        INTEGER := 0;
  v_picked         INTEGER := 0;
  v_held           INTEGER := 0;
  v_pick_failures  JSONB := '[]'::jsonb;
  v_loops          INTEGER := 0;
  v_od             RECORD;
  v_ograce         INTEGER;
  v_established    BOOLEAN;
  v_supervised     BOOLEAN;
  v_outage_paused  INTEGER := 0;
  v_outage_failures JSONB := '[]'::jsonb;
  v_hb             RECORD;
  v_heartbeats     INTEGER := 0;
  v_heartbeat_failures JSONB := '[]'::jsonb;
  v_mk             RECORD;
  v_mock_paused    INTEGER := 0;
  v_mock_pause_failures JSONB := '[]'::jsonb;
  v_mock_seen      UUID[] := '{}';
  v_mock_picked    INTEGER := 0;
  v_mock_cpu_failures JSONB := '[]'::jsonb;
  v_mock_loops     INTEGER := 0;
BEGIN
  -- -------------------------------------------------------------------------
  -- ARM 1 — D94 auto-start: scan scheduled LEAGUES (never the drafts
  -- table), create the drafts row if absent, start. Failures recorded +
  -- retried every tick, never a silent skip.
  -- -------------------------------------------------------------------------
  FOR v_lg IN
    SELECT l.id, l.settings->'draft'->>'draft_scheduled_at' AS at_txt
    FROM public.leagues l
    WHERE l.status = 'scheduled'
      AND l.deleted_at IS NULL
      AND COALESCE(l.settings->'draft'->>'draft_scheduled_at', '') <> ''
  LOOP
    v_scanned := v_scanned + 1;
    BEGIN
      -- Cast inside the per-league subtransaction: a malformed stored
      -- instant becomes THIS league's recorded failure, never a scan
      -- abort.
      v_at := v_lg.at_txt::timestamptz;
      IF v_at > now() THEN
        CONTINUE;
      END IF;

      -- Claim without waiting (§4.6: the tick never blocks — or waits
      -- behind — a user action; a held league row retries next tick).
      PERFORM 1 FROM public.leagues l
      WHERE l.id = v_lg.id AND l.status = 'scheduled' AND l.deleted_at IS NULL
      FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      -- The ONE start implementation (066): create-if-absent + capacity +
      -- snapshot-before-transition, commissioner gate skipped (cron has no
      -- JWT; this RPC's authority is its REVOKE narrowing).
      v_res := public.draft_start_internal(v_lg.id, FALSE);
      IF (v_res->>'started')::boolean THEN
        v_started := v_started + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_start_failures := v_start_failures || jsonb_build_object(
        'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
      RAISE WARNING 'draft_tick auto-start failed for league %: % (%)',
        v_lg.id, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- ARM 1.5 — §8.7 commissioner-outage auto-pause (D102/§8.7:478; landed
  -- with L.B1.4/069 — see the banner). Runs BEFORE the timeout arm so an
  -- expired deadline under an outage pauses instead of autopicking (pinned:
  -- pgTAP 023 §H's R136 case — a deadline past deadline+grace under an
  -- outage pauses with NEGATIVE remaining and ZERO picks). The candidacy
  -- test covers ALL live non-mock drafts (not just due ones — the pause
  -- must freeze a still-running clock through the outage), but the CLAIM
  -- locks ONLY outage candidates (R135, M2 batch 5): the pre-fix
  -- unfiltered claim FOR UPDATE'd every live non-mock draft each tick and
  -- held the locks for the rest of the tick transaction, serializing every
  -- pick on every live draft behind the batch every 5s — against the
  -- §22.3/§22.6 load posture. The WHERE below is the same
  -- established-then-lost supervision predicate the body re-verifies UNDER
  -- the lock (claim = pre-filter against a snapshot; body = authoritative);
  -- a filter bug that over-claims costs only lock scope (pgTAP 023 §H's
  -- lock-visibility pins catch it), one that under-claims would miss the
  -- pause (023 §H's 76s-threshold pins catch that direction). Batch-capped
  -- at c_batch for symmetry with ARM 2 — no loop (an outage pause is
  -- idempotent and not deadline-urgent the way a timeout is). CORRECTED,
  -- R141 (batch-5 addendum): "overflow candidates are claimed on the next
  -- 5s tick" is guaranteed only INSIDE the ≤25-draft M2 gate, where the
  -- candidate set can never exceed c_batch. This claim has no ORDER BY, no
  -- loop, and no v_seen, so beyond the gate nothing rotates the batch:
  -- ≥ c_batch candidates that never leave the set (e.g. rows the body
  -- persistently fails on — recorded outage_failures) could recur in every
  -- batch while real outage candidates starve, and a starved candidate
  -- whose deadline is due is autopicked by ARM 2 in the SAME tick. The one
  -- known PERMANENT class (soft-deleted league) is excluded from the claim
  -- below; the beyond-gate rotation hazard is F50's (M7/L.F1 §22.6 load
  -- gate — the ARM-2 loop+v_seen shape is the fix when scale demands it).
  -- Freshness AS-OF-NOW; the never-connected exemption; resume is a
  -- commissioner action (the tick never auto-resumes).
  -- -------------------------------------------------------------------------
  FOR v_od IN
    SELECT d.id
    FROM public.drafts d
    WHERE d.status = 'live' AND d.is_mock = FALSE
      -- Supervision was ESTABLISHED (some commissioner/co-commissioner has
      -- heartbeat this draft at least once)…
      AND EXISTS (
        SELECT 1
        FROM public.draft_liveness dl
        JOIN public.league_members m
          ON m.league_id = d.league_id AND m.user_id = dl.user_id
        WHERE dl.draft_id = d.id
          AND m.role IN ('commissioner', 'co_commissioner')
      )
      -- …and then LOST (no commissioner beat within freshness + grace).
      AND NOT EXISTS (
        SELECT 1
        FROM public.draft_liveness dl
        JOIN public.league_members m
          ON m.league_id = d.league_id AND m.user_id = dl.user_id
        WHERE dl.draft_id = d.id
          AND m.role IN ('commissioner', 'co_commissioner')
          AND dl.last_seen_at > now() - (public.draft_liveness_freshness()
                + make_interval(secs => COALESCE(
                    (d.config->>'disconnect_grace_seconds')::int, 30)))
      )
      -- …and the league is ALIVE (R141, batch-5 addendum — the body's
      -- deleted-league re-check mirrored into the claim): without this, a
      -- live draft under a soft-deleted league matched the claim WHERE
      -- FOREVER (claimed + locked every tick, body-skipped by the
      -- deleted-league CONTINUE, never paused, never leaving the candidate
      -- set) — the permanent-candidate class that falsified the no-loop
      -- rationale below. Reachable today: soft_delete_league (060) has no
      -- draft-status gate.
      AND EXISTS (
        SELECT 1 FROM public.leagues l
        WHERE l.id = d.league_id AND l.deleted_at IS NULL
      )
    LIMIT c_batch
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_od.id;
      IF v_draft.status <> 'live' THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.leagues l
        WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
      ) THEN
        CONTINUE;
      END IF;

      v_ograce := COALESCE(
        (v_draft.config->>'disconnect_grace_seconds')::int, 30);

      -- Supervision was ESTABLISHED: some commissioner/co-commissioner
      -- has heartbeat this draft at least once (else: D94's unattended
      -- autopilot — never paused; the banner's never-connected exemption).
      SELECT
        count(*) > 0,
        count(*) FILTER (
          WHERE dl.last_seen_at > now() - (public.draft_liveness_freshness()
                                           + make_interval(secs => v_ograce))
        ) > 0
      INTO v_established, v_supervised
      FROM public.draft_liveness dl
      JOIN public.league_members m
        ON m.league_id = v_draft.league_id AND m.user_id = dl.user_id
      WHERE dl.draft_id = v_draft.id
        AND m.role IN ('commissioner', 'co_commissioner');

      IF v_established AND NOT v_supervised THEN
        -- The ONE pause-bookkeeping path (069's draft_pause_internal);
        -- system post with NO acting user (the tick has no JWT).
        PERFORM public.draft_pause_internal(
          v_draft.id, NULL,
          'Draft auto-paused: no commissioner or co-commissioner is connected. '
          || 'A commissioner can resume from the draft room.');
        v_outage_paused := v_outage_paused + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_outage_failures := v_outage_failures || jsonb_build_object(
        'draft_id', v_od.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
      RAISE WARNING 'draft_tick outage arm failed for draft %: % (%)',
        v_od.id, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- ARM 1.6 — THE E59 MOCK STALE-PAUSE (L.B1.6/071 — amended in place,
  -- F12; D93/§8.8). A live MOCK auto-pauses when the LAUNCHER's heartbeat
  -- is stale past disconnect_grace_seconds + one tick (5s) — the D93
  -- threshold, keyed on config.mock.launched_by (never the on-clock
  -- seat's owner: the whole room is one human's practice, and without
  -- them watching there is no point burning CPU picks — E59). Runs
  -- BEFORE the timeout arm so the pause always preempts the grace-hold's
  -- deadline+grace autopick: a seat stale AS OF its deadline last beat at
  -- ≤ deadline − 45s, so the pause threshold (last beat + grace + 5s ≤
  -- deadline + grace − 40s) expires strictly before the hold does — the
  -- disconnected human never loses their pick to a timeout (pinned in
  -- 025). CLAIM SCOPE (the R135/R141 discipline — the task charge "mock
  -- arms must not widen any lock scope beyond due/claimable mocks"): the
  -- WHERE is the body's predicate — live + mock + alive league + stale
  -- launcher — so a healthy mock (fresh beat) is NEVER locked by this
  -- arm; COALESCE(beat, started_at, created_at) guards fixture mocks
  -- with no seeded beat (create_mock_draft always seeds one). Resume is
  -- the LAUNCHER's action (069's draft_resume mock arm) — the tick never
  -- auto-resumes (the ARM 1.5 symmetry: a deliberate pause must not be
  -- fought by the clock).
  -- -------------------------------------------------------------------------
  FOR v_mk IN
    SELECT d.id
    FROM public.drafts d
    WHERE d.status = 'live'
      AND d.is_mock
      AND EXISTS (
        SELECT 1 FROM public.leagues l
        WHERE l.id = d.league_id AND l.deleted_at IS NULL
      )
      AND COALESCE(
            (SELECT dl.last_seen_at
             FROM public.draft_liveness dl
             WHERE dl.draft_id = d.id
               AND dl.user_id::text = d.config->'mock'->>'launched_by'),
            d.started_at, d.created_at)
          < now() - (make_interval(secs => COALESCE(
                       (d.config->>'disconnect_grace_seconds')::int, 30))
                     + interval '5 seconds')
    LIMIT c_batch
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_mk.id;
      -- Re-verify under the held lock (claim = snapshot pre-filter; body =
      -- authoritative — the R135 discipline).
      IF v_draft.status <> 'live' OR NOT v_draft.is_mock THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.leagues l
        WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
      ) THEN
        CONTINUE;
      END IF;
      IF COALESCE(
           (SELECT dl.last_seen_at
            FROM public.draft_liveness dl
            WHERE dl.draft_id = v_draft.id
              AND dl.user_id::text = v_draft.config->'mock'->>'launched_by'),
           v_draft.started_at, v_draft.created_at)
         >= now() - (make_interval(secs => COALESCE(
                       (v_draft.config->>'disconnect_grace_seconds')::int, 30))
                     + interval '5 seconds') THEN
        CONTINUE;
      END IF;

      -- The ONE pause-bookkeeping path (069's draft_pause_internal —
      -- call-time-resolved, the ARM 1.5 forward-reference rationale: no
      -- live mock can exist in the 068→071 window since create_mock_draft
      -- is 071's); system post with NO acting user, scoped to the mock's
      -- own chat context (zero league side effects).
      PERFORM public.draft_pause_internal(
        v_draft.id, NULL,
        'Mock draft auto-paused — you left the room. Resume your practice from the league page.');
      v_mock_paused := v_mock_paused + 1;
    EXCEPTION WHEN OTHERS THEN
      v_mock_pause_failures := v_mock_pause_failures || jsonb_build_object(
        'draft_id', v_mk.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
      RAISE WARNING 'draft_tick mock stale-pause failed for draft %: % (%)',
        v_mk.id, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- ARM 2 — timeout → autopick per the D102 contract; batch-limited loop
  -- until no due rows (§22.3), FOR UPDATE SKIP LOCKED claims (§4.6).
  -- -------------------------------------------------------------------------
  LOOP
    v_loops := v_loops + 1;
    v_pass := 0;

    FOR v_row IN
      SELECT d.id
      FROM public.drafts d
      WHERE d.status = 'live'
        AND d.current_deadline IS NOT NULL
        AND d.current_deadline <= now()
        AND NOT (d.id = ANY(v_seen))
      ORDER BY d.current_deadline
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_claimed := v_claimed + 1;
      v_seen := v_seen || v_row.id;

      BEGIN
        SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_row.id;

        -- Re-verify under the held lock (the claim's snapshot may predate
        -- a concurrent pick that advanced the clock).
        IF v_draft.status <> 'live'
           OR v_draft.current_deadline IS NULL
           OR v_draft.current_deadline > now()
           OR v_draft.on_clock_team_id IS NULL THEN
          CONTINUE;
        END IF;
        -- Defensive: a live draft under a soft-deleted league is not ours
        -- to advance.
        IF NOT EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
        ) THEN
          CONTINUE;
        END IF;

        -- Seat-user derivation. MOCK BRANCH (L.B1.6/071 — D93/D103): the
        -- HUMAN seat keys freshness/grace on the LAUNCHER (the seat's
        -- real owner and their is_autodraft are irrelevant inside a
        -- practice room — the launcher wants the clock pressure, §8.8);
        -- every CPU seat is a no-user seat here (immediate autopick —
        -- normally ARM 2.5 picks it BEFORE the deadline, so reaching this
        -- arm means the tick was down past the deadline, and the timeout
        -- semantics are identical).
        IF v_draft.is_mock THEN
          IF v_draft.config->'mock'->>'human_team_id'
             = v_draft.on_clock_team_id::text THEN
            v_user := (v_draft.config->'mock'->>'launched_by')::uuid;
          ELSE
            v_user := NULL;
          END IF;
          v_autodraft := FALSE;
        ELSE
          SELECT m.user_id, COALESCE(m.is_autodraft, FALSE)
            INTO v_user, v_autodraft
          FROM public.league_members m
          WHERE m.league_id = v_draft.league_id
            AND m.team_id = v_draft.on_clock_team_id;
        END IF;

        v_grace := COALESCE(
          (v_draft.config->>'disconnect_grace_seconds')::int, 30);

        -- D102: only a STALE HUMAN seat gets the grace hold. is_autodraft
        -- seats, no-user seats (placeholder/vacated — E48), and seats
        -- FRESH AS OF THE DEADLINE autopick AT the deadline (§8.5.4).
        IF v_user IS NOT NULL AND NOT COALESCE(v_autodraft, FALSE) THEN
          -- R132: the branch is decided from freshness AS OF THE DEADLINE
          -- INSTANT — a heartbeat in (deadline − freshness, deadline].
          -- Re-deriving it from now() each tick let a returning manager's
          -- own post-deadline heartbeat retroactively grant the
          -- fresh-at-expiry branch, and the next tick autopicked them
          -- INSIDE the grace window (§8.5.5/E3 defeated in exactly the
          -- scenario the hold exists for). The lower bound is STRICT so
          -- the pinned 45s constant keeps both behavioral sides against a
          -- 1s-past deadline (44s-old fresh / 46s-old stale — pgTAP 022);
          -- the upper bound is what makes a mid-hold reconnect unable to
          -- end the hold (it restores MANUAL control only —
          -- draft_make_pick never checks the deadline). Recorded
          -- residual: the PK upsert keeps ONE row per (draft, user), so a
          -- beat landing between the deadline and the tick OVERWRITES the
          -- pre-deadline evidence and that seat takes the hold — the
          -- error direction is the protective §8.5.5 hold, never an early
          -- autopick.
          v_fresh := EXISTS (
            SELECT 1 FROM public.draft_liveness dl
            WHERE dl.draft_id = v_draft.id
              AND dl.user_id = v_user
              AND dl.last_seen_at > v_draft.current_deadline
                                    - public.draft_liveness_freshness()
              AND dl.last_seen_at <= v_draft.current_deadline
          );
          IF NOT v_fresh
             AND now() < v_draft.current_deadline
                         + make_interval(secs => v_grace) THEN
            -- HELD OPEN: deadline stays past-due; a returning human may
            -- pick manually during the hold (§8.5.5/E3) — re-evaluated
            -- every tick until deadline + grace; a mid-hold heartbeat
            -- never ends the hold (R132).
            v_held := v_held + 1;
            CONTINUE;
          END IF;
        END IF;

        v_player := public.draft_autopick_resolve(
          v_draft.id, v_draft.on_clock_team_id);
        IF v_player IS NULL THEN
          RAISE EXCEPTION
            'draft_tick: no available player to autopick in draft % (pool exhausted)',
            v_draft.id;
        END IF;

        -- The SAME advance path as a manual pick (066 — reuse, never
        -- fork): §12.4 system-pick shape.
        PERFORM public.draft_apply_pick_internal(
          v_draft.id, v_player, TRUE, 'autopick', NULL, NULL);
        v_picked := v_picked + 1;
      EXCEPTION WHEN OTHERS THEN
        v_pick_failures := v_pick_failures || jsonb_build_object(
          'draft_id', v_row.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'draft_tick timeout arm failed for draft %: % (%)',
          v_row.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass = 0 OR v_loops >= c_max_loops;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- ARM 2.5 — MOCK CPU THINK-TIME PICKS (L.B1.6/071 — amended in place,
  -- F12; D93/§8.8, plan §4.2). Every non-human seat in a live mock picks
  -- when its think-time elapses: due = pick start + PRNG(draft_id,
  -- pick_number) → 20–70% of the clock (`realistic`) or ~2s (`fast`) —
  -- draft_mock_cpu_due, the ONE due computation for claim AND re-check.
  -- THE PICK ITSELF IS THE AUTOPICK STRATEGY FN (draft_autopick_resolve →
  -- draft_apply_pick_internal — the same brain and the same advance path
  -- as a live timeout; "one implementation, two consumers" — the DoD
  -- break-probe target: a forked raw-ADP CPU fails 025's need-fit board
  -- pins). The human seat is NEVER touched by this arm (its clock is
  -- always real — §8.8; ARM 2 owns its timeout at the deadline). CLAIM
  -- SCOPE (R135/R141 + the task charge): the WHERE is the body's
  -- predicate — live + mock + CPU on clock + due + alive league — so a
  -- mock whose CPU is still thinking is NEVER locked. One CPU pick per
  -- mock per pass (the think origin is the advance instant, so the next
  -- pick's due is always in the future at apply time): `fast` ≈ 2s
  -- think-time lands on the first tick after it elapses — effective
  -- cadence bounded by the 5s tick, the same granularity class D87
  -- records for timeout lag (recorded residual). Runs AFTER ARM 2 (a
  -- deadline-expired mock CPU seat is ARM 2's immediate autopick; the
  -- fresh deadline it writes puts the next due in the future) and BEFORE
  -- ARM 3 (a just-made CPU pick's fresh deadline beats in the same pass).
  -- -------------------------------------------------------------------------
  LOOP
    v_mock_loops := v_mock_loops + 1;
    v_pass := 0;

    FOR v_row IN
      SELECT d.id
      FROM public.drafts d
      WHERE d.status = 'live'
        AND d.is_mock
        AND d.on_clock_team_id IS NOT NULL
        AND d.config->'mock'->>'human_team_id'
            IS DISTINCT FROM d.on_clock_team_id::text
        AND NOT (d.id = ANY(v_mock_seen))
        AND EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = d.league_id AND l.deleted_at IS NULL
        )
        AND now() >= public.draft_mock_cpu_due(
              d.id, d.config, d.current_deadline, d.updated_at,
              d.current_pick_number)
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_mock_seen := v_mock_seen || v_row.id;

      BEGIN
        SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_row.id;

        -- Re-verify under the held lock (claim = snapshot pre-filter).
        IF v_draft.status <> 'live'
           OR NOT v_draft.is_mock
           OR v_draft.on_clock_team_id IS NULL
           OR v_draft.config->'mock'->>'human_team_id'
              = v_draft.on_clock_team_id::text
           OR now() < public.draft_mock_cpu_due(
                v_draft.id, v_draft.config, v_draft.current_deadline,
                v_draft.updated_at, v_draft.current_pick_number) THEN
          CONTINUE;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
        ) THEN
          CONTINUE;
        END IF;

        -- THE SHARED BRAIN (D93/plan §4.2 — never a fork): resolution +
        -- the ONE advance path, §12.4's system-pick shape.
        v_player := public.draft_autopick_resolve(
          v_draft.id, v_draft.on_clock_team_id);
        IF v_player IS NULL THEN
          RAISE EXCEPTION
            'draft_tick: no available player for the CPU pick in mock draft % (pool exhausted)',
            v_draft.id;
        END IF;
        PERFORM public.draft_apply_pick_internal(
          v_draft.id, v_player, TRUE, 'autopick', NULL, NULL);
        v_mock_picked := v_mock_picked + 1;
      EXCEPTION WHEN OTHERS THEN
        v_mock_cpu_failures := v_mock_cpu_failures || jsonb_build_object(
          'draft_id', v_row.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'draft_tick mock CPU arm failed for draft %: % (%)',
          v_row.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass = 0 OR v_mock_loops >= c_max_loops;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- ARM 3 — the §9.1 tick heartbeat (amended in by L.B1.5/070 — see the
  -- banner). ONE realtime.send() per live draft per pass (~5s), event
  -- 'tick' on the draft topic, payload = server-now + the authoritative
  -- deadline (§9.3's clock-drift correction). LOCK-FREE by design
  -- (R135/R141: a PLAIN read — the beat claims nothing, locks nothing;
  -- a healthy live draft stays untouched by the tick's lock scope).
  -- Runs AFTER the state-changing arms so the beat reflects post-arm
  -- state. Deleted-league drafts excluded (the R141 discipline); paused
  -- drafts excluded (frozen clock — nothing to correct); mock drafts
  -- included once 071 makes them reachable (same room, same clock).
  -- realtime.send() traps its own errors; this block is containment
  -- symmetry with the other arms.
  -- -------------------------------------------------------------------------
  BEGIN
    FOR v_hb IN
      SELECT d.id, d.current_deadline
      FROM public.drafts d
      WHERE d.status = 'live'
        AND EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = d.league_id AND l.deleted_at IS NULL
        )
    LOOP
      PERFORM realtime.send(
        jsonb_build_object(
          -- clock_timestamp(), not now(): the drift-correction beat must
          -- carry STATEMENT time — transaction_timestamp() is frozen at
          -- tick-txn start, so it would bake the txn's own runtime into
          -- the very drift figure the beat exists to correct (R146).
          'server_now', clock_timestamp(),
          'current_deadline', v_hb.current_deadline),
        'tick',
        'draft:' || v_hb.id::text,
        true);
      v_heartbeats := v_heartbeats + 1;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    v_heartbeat_failures := v_heartbeat_failures || jsonb_build_object(
      'sqlstate', SQLSTATE, 'error', SQLERRM);
    RAISE WARNING 'draft_tick heartbeat arm failed: % (%)', SQLERRM, SQLSTATE;
  END;

  RETURN jsonb_build_object(
    'scanned_scheduled_leagues', v_scanned,
    'auto_started', v_started,
    'start_failures', v_start_failures,
    'outage_paused', v_outage_paused,
    'outage_failures', v_outage_failures,
    'mock_paused', v_mock_paused,
    'mock_pause_failures', v_mock_pause_failures,
    'mock_cpu_picked', v_mock_picked,
    'mock_cpu_failures', v_mock_cpu_failures,
    'claimed_due', v_claimed,
    'autopicked', v_picked,
    'held_for_grace', v_held,
    'pick_failures', v_pick_failures,
    'heartbeats', v_heartbeats,
    'heartbeat_failures', v_heartbeat_failures,
    'loops', v_loops);
END;
$$;

-- Service-role/cron only (the 062-internal-helper narrowing — authenticated
-- is revoked too; the D100 harness drives it through the service role).
REVOKE EXECUTE ON FUNCTION draft_tick() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. pg_cron: the 5-second schedule (D87; §22.3 — one entry, idempotent)
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $do$
BEGIN
  -- Idempotent re-apply: unschedule-if-exists first.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'draft-tick') THEN
    PERFORM cron.unschedule('draft-tick');
  END IF;
  PERFORM cron.schedule('draft-tick', '5 seconds', 'SELECT public.draft_tick()');
END;
$do$;
