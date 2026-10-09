-- ============================================================================
-- 183 — job knobs: pause / resume / run now (M8 L.G1.3; spec §24.4 v2.16.89;
--       tasks-M8-admin-console.md §6 / TD3 / TD4 / TD5 / TD11; Q98 / Q102
--       ruled 2026-10-08; PROGRESS D512; FULL rigour — production writes,
--       scheduled jobs)
-- ============================================================================
--
-- WHAT THIS ADDS
--
--   1. `job_pauses` (TD4) — an operator's pause is a ROW the job reads, never
--      `cron.unschedule` (the schedule survives, the pause survives restarts,
--      the live-state view can see it). One row per pause; `league_id` NULL =
--      every league. Only the three pausable jobs exist in its CHECK —
--      'waivers', 'week-advance', 'week-finalize' (Q98). Lineup locking is
--      NEVER pausable (pausing would let people move players after kickoff),
--      drafts and stat syncing get no knobs: none of them can even be stored.
--      A resume closes the row (`resumed_at` / `resumed_by` /
--      `resume_action_id`), so the table keeps the history; at most ONE open
--      pause per (job, league-or-all) (partial unique index). A missing row
--      means NOT paused (TD9). RLS on; operators read; no client write policy
--      — every write is a DEFINER verb's.
--
--   2. `job_paused_internal(job, league)` — the predicate each pausable job's
--      entry function now carries in its league-claim query: a league is
--      skipped when an open pause names it OR names every league.
--      `job_pause_note_internal(job, scope, at)` — the job's "run log" of a
--      skip: it stamps `last_skipped_at` / `skipped_runs` on each open pause
--      that applied to this run and RAISEs a NOTICE ("paused by operator").
--      Both PLAIN, search_path '', revoked from every client.
--
--   3. The three entry functions (HEAD of chain, D137) — `waiver_tick` (150),
--      `league_week_advance` (118), `finalize_matchups` (180) — each gains
--      exactly TWO lines: the note call before its claim loop and the
--      predicate inside the league-claim query. A paused league is never
--      claimed, so it never half-runs (TD4): no claim, FAAB, roster, week,
--      matchup or result write for it; its due run stays due (waivers: the
--      claims stay pending in their order and `waiver_next_run_at` is not
--      advanced), so the next unpaused run — scheduled or run now — settles
--      it under the same rules as if it had never paused. Other leagues are
--      untouched. The existing global `system_flags.waivers_paused` switch
--      (150) is unchanged and still checked first.
--      `lineup_lock_tick` is NOT edited (never paused).
--
--   4. The verbs (TD3) — `op_pause_job`, `op_resume_job`, `op_run_job_now`:
--      SECURITY DEFINER, search_path '', the operator gate re-checked
--      in-body (`is_platform_operator()`, TD1 — never `league_members`),
--      `p_action_id` required and idempotent (a replay returns the earlier
--      receipt and writes nothing), `p_reason` optional (Chris 2026-09-16).
--      Each is a thin door over a PLAIN `_internal` that takes the instant
--      (`now()` from the door — the database's clock, as every public verb;
--      the injected instant is the TimeProvider seam the tests use).
--        • a no-op (already paused / not paused / nothing due / paused, so
--          run-now refuses) writes NOTHING and says why;
--        • a change writes ONE `platform_operator_actions` receipt through
--          `log_operator_action_internal` (182), and — when league-scoped —
--          ONE plain-words line in that league's activity signed "FieldScout"
--          (TD11 / Q101 (a)) through `op_league_line_internal`, the writer
--          F582 asked for (L.G1.2 / L.G1.4 reuse it);
--        • `op_pause_job('lineup-lock', …)` / `op_resume_job('lineup-lock', …)`
--          and any draft / stat-sync / unknown job are refused BY NAME (22023).
--      RUN NOW (TD5) calls THE SAME FUNCTION the cron calls, with the same
--      instant source and the same rules — it cannot finalize a week the rule
--      holds, and a paused scope must be resumed first. The four job RPCs
--      refuse a signed-in caller (`auth.uid() IS NOT NULL`, 42501 — they are
--      cron / service-role only); the run-now door is a signed-in operator,
--      so it clears the request's JWT claims TRANSACTION-LOCALLY for the one
--      call (set_config(…, true)) and restores them after, having already
--      checked the gate and captured the actor. Concurrency: every job
--      claims leagues `FOR UPDATE SKIP LOCKED`, so a run-now racing the
--      scheduled minute settles each league exactly once; a pause takes the
--      league row lock, so it waits out an in-flight run of that league and
--      no run starts that league afterwards.
--
-- CHECKLIST (tasks-M* §4.4): one new table, RLS ON, one SELECT policy
-- (operators), no write policy, TRUNCATE revoked from PUBLIC / anon /
-- authenticated; new functions all search_path '', DEFINER only on the three
-- doors (in-body gate), every internal REVOKEd from PUBLIC / anon /
-- authenticated; the three replaced job bodies keep SECURITY DEFINER +
-- search_path '' and their REVOKEs are restated. No R6 / D38 waiver needed.
-- DEPLOY BEFORE PUSH (TD9): no client code calls any of this yet; until the
-- push, the jobs run exactly as 150 / 118 / 180 left them.
-- pgTAP 131_job_knobs.sql; 128's finalize_matchups md5 pins read the body
-- through pg_temp.un183.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. job_pauses (TD4)
-- ---------------------------------------------------------------------------
CREATE TABLE job_pauses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job              TEXT NOT NULL
    CHECK (job IN ('waivers', 'week-advance', 'week-finalize')),   -- Q98: never 'lineup-lock'
  league_id        UUID REFERENCES leagues(id) ON DELETE CASCADE,  -- NULL = every league
  paused_at        TIMESTAMPTZ NOT NULL,
  paused_by        UUID NOT NULL REFERENCES profiles(id),
  pause_action_id  UUID NOT NULL UNIQUE,
  resumed_at       TIMESTAMPTZ,
  resumed_by       UUID REFERENCES profiles(id),
  resume_action_id UUID UNIQUE,
  last_skipped_at  TIMESTAMPTZ,
  skipped_runs     INTEGER NOT NULL DEFAULT 0 CHECK (skipped_runs >= 0),
  CONSTRAINT job_pauses_resume_whole
    CHECK ((resumed_at IS NULL) = (resumed_by IS NULL)
       AND (resumed_at IS NULL) = (resume_action_id IS NULL)),
  CONSTRAINT job_pauses_resume_after CHECK (resumed_at IS NULL OR resumed_at >= paused_at)
);

COMMENT ON TABLE job_pauses IS
  'M8 job pauses (migration 183, TD4 / Q98): an operator pause of waivers / week-advance / week-finalize, per league or every league (league_id NULL). Open while resumed_at IS NULL — one open pause per (job, league-or-all). Each job''s entry function skips a paused league (job_paused_internal) and stamps last_skipped_at / skipped_runs (job_pause_note_internal). Lineup locking can never be paused. Readable by platform operators; written only by op_pause_job / op_resume_job.';

CREATE UNIQUE INDEX job_pauses_one_open
  ON job_pauses (job, COALESCE(league_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE resumed_at IS NULL;
CREATE INDEX idx_job_pauses_league ON job_pauses (league_id, paused_at DESC) WHERE league_id IS NOT NULL;

ALTER TABLE job_pauses ENABLE ROW LEVEL SECURITY;
-- Operators read; nobody writes through RLS (no INSERT / UPDATE / DELETE
-- policy, deliberately).
CREATE POLICY "Job pauses readable by platform operators"
  ON job_pauses FOR SELECT TO authenticated
  USING (public.is_platform_operator());
REVOKE TRUNCATE ON TABLE job_pauses FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The job-side helpers (PLAIN, REVOKEd)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION job_paused_internal(p_job TEXT, p_league_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.job_pauses p
    WHERE p.job = p_job AND p.resumed_at IS NULL
      AND (p.league_id IS NULL OR p.league_id = p_league_id));
$$;
REVOKE ALL ON FUNCTION job_paused_internal(TEXT, UUID) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION job_paused_internal(TEXT, UUID) IS
  'M8 TD4 (migration 183): true when an open job_pauses row names this league or every league for the job. The league-claim predicate of waiver_tick / league_week_advance / finalize_matchups.';

CREATE OR REPLACE FUNCTION job_pause_note_internal(p_job TEXT, p_scope UUID, p_at TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  -- The pauses that apply to THIS run: an every-league pause always; a
  -- league's own pause when the run covers that league (a scheduled run, or
  -- a run scoped to it).
  UPDATE public.job_pauses p
  SET last_skipped_at = p_at, skipped_runs = p.skipped_runs + 1
  WHERE p.job = p_job AND p.resumed_at IS NULL
    AND (p.league_id IS NULL OR p_scope IS NULL OR p.league_id = p_scope);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    RAISE NOTICE '%: % operator pause(s) applied — the paused league(s) were skipped by this run (paused by operator, M8 TD4)', p_job, v_n;
  END IF;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION job_pause_note_internal(TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION job_pause_note_internal(TEXT, UUID, TIMESTAMPTZ) IS
  'M8 TD4 (migration 183): the paused job''s run log — stamps last_skipped_at / skipped_runs on every open pause that applied to this run and raises a NOTICE. Writes nothing else.';

-- ---------------------------------------------------------------------------
-- 3. The league activity line (TD11 / Q101 (a)) — discharges F582
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION op_league_line_internal(p_league_id UUID, p_text TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_league_id IS NULL OR p_text IS NULL OR p_text !~ '^FieldScout ' THEN
    RAISE EXCEPTION 'op_league_line_internal: an operator''s league line names a league and is signed "FieldScout" (M8 TD11)'
      USING ERRCODE = '22023';
  END IF;
  -- A system post with NO actor: the operator's username is never shown
  -- (Q101 (a)); the feed renders it as a system line, its text says who.
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (p_league_id, NULL, p_text, 'league', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION op_league_line_internal(UUID, TEXT) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION op_league_line_internal(UUID, TEXT) IS
  'M8 TD11 (migration 183; F582): the one writer of an operator''s league activity line — a league_chat system post with no actor whose text begins "FieldScout ". Called by league-scoped op_* verbs only.';

-- ---------------------------------------------------------------------------
-- 4. Shared verb plumbing
-- ---------------------------------------------------------------------------
-- The job's plain name, as a league member reads it.
CREATE OR REPLACE FUNCTION op_job_words_internal(p_job TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_job
    WHEN 'waivers'       THEN 'waivers'
    WHEN 'week-advance'  THEN 'the start and end of each week'
    WHEN 'week-finalize' THEN 'final weekly results'
    WHEN 'lineup-lock'   THEN 'lineup locks'
  END;
$$;
REVOKE ALL ON FUNCTION op_job_words_internal(TEXT) FROM PUBLIC, anon, authenticated;

-- Refuses a job with no knob of this kind, BY NAME (Q98).
CREATE OR REPLACE FUNCTION op_job_check_internal(p_job TEXT, p_kind TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_job IN ('waivers', 'week-advance', 'week-finalize') THEN
    RETURN;
  END IF;
  IF p_job = 'lineup-lock' THEN
    IF p_kind = 'run' THEN RETURN; END IF;
    RAISE EXCEPTION 'lineup locking can never be paused or resumed — pausing would let people move players after kickoff (Q98); it has "run now" only'
      USING ERRCODE = '22023';
  END IF;
  IF p_job IN ('draft-tick', 'mock-expiry', 'trade-tick', 'sync-live-ping', 'score-week-ping',
               'scoring-stall-check', 'sync-weekly-projections-ping', 'league-player-values-ping') THEN
    RAISE EXCEPTION 'job "%" has no operator knobs — drafts and stat syncing get no pause / resume / run-now (Q98)', p_job
      USING ERRCODE = '22023';
  END IF;
  RAISE EXCEPTION 'unknown job "%" — the operator knobs cover waivers, week-advance, week-finalize (and run-now for lineup-lock)', p_job
    USING ERRCODE = '22023';
END;
$$;
REVOKE ALL ON FUNCTION op_job_check_internal(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- The gate, the action id, the league, and the replay — common to the verbs.
-- Returns the earlier receipt's `after` (with replayed = true) on a replay,
-- else NULL. Takes the league row lock when league-scoped.
CREATE OR REPLACE FUNCTION op_verb_prelude_internal(
  p_verb TEXT, p_league_id UUID, p_action_id UUID, p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_rec public.platform_operator_actions;
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION '%: only a platform operator can use the job knobs (M8 TD1)', p_verb
      USING ERRCODE = '42501';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION '%: p_action_id is required — it makes a retry safe (M8 TD3)', p_verb
      USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NOT NULL AND (length(btrim(p_reason, E' \t\r\n')) = 0 OR length(p_reason) > 500) THEN
    RAISE EXCEPTION '%: a reason is optional, but when given it is non-blank and at most 500 characters', p_verb
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_rec FROM public.platform_operator_actions a WHERE a.action_id = p_action_id;
  IF FOUND THEN
    IF v_rec.verb <> p_verb OR v_rec.actor_id <> auth.uid()
       OR v_rec.league_id IS DISTINCT FROM p_league_id THEN
      RAISE EXCEPTION '%: action id % was already used for a different operator action', p_verb, p_action_id
        USING ERRCODE = '22023';
    END IF;
    RETURN COALESCE(v_rec.after, '{}'::jsonb) || jsonb_build_object('replayed', TRUE, 'receipt_id', v_rec.id);
  END IF;

  IF p_league_id IS NOT NULL THEN
    -- The row lock: waits out an in-flight job run of this league (each job
    -- claims the league FOR UPDATE SKIP LOCKED), and makes a concurrent
    -- scheduled run SKIP the league while this verb commits.
    PERFORM 1 FROM public.leagues l WHERE l.id = p_league_id AND l.deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '%: league % does not exist', p_verb, p_league_id
        USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION op_verb_prelude_internal(TEXT, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. op_pause_job / op_resume_job
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION op_pause_job_internal(
  p_job TEXT, p_league_id UUID, p_action_id UUID, p_reason TEXT, p_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_replay JSONB;
  v_actor  UUID := auth.uid();
  v_id     UUID;
  v_after  JSONB;
BEGIN
  v_replay := public.op_verb_prelude_internal('pause_job', p_league_id, p_action_id, p_reason);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM public.op_job_check_internal(p_job, 'pause');
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'pause_job: p_at is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.job_pauses p
             WHERE p.job = p_job AND p.resumed_at IS NULL
               AND p.league_id IS NOT DISTINCT FROM p_league_id) THEN
    RETURN jsonb_build_object('changed', FALSE, 'job', p_job, 'league_id', p_league_id,
      'why', 'already_paused — this pause is already on; nothing was written');
  END IF;

  INSERT INTO public.job_pauses (job, league_id, paused_at, paused_by, pause_action_id)
  VALUES (p_job, p_league_id, p_at, v_actor, p_action_id)
  RETURNING id INTO v_id;

  v_after := jsonb_build_object('changed', TRUE, 'job', p_job, 'league_id', p_league_id,
    'paused', TRUE, 'pause_id', v_id, 'paused_at', p_at,
    'also_paused_for_every_league', (p_league_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.job_pauses p WHERE p.job = p_job AND p.resumed_at IS NULL AND p.league_id IS NULL)));
  PERFORM public.log_operator_action_internal(p_action_id, v_actor, 'pause_job',
    CASE WHEN p_league_id IS NULL THEN 'platform' ELSE 'league' END, p_league_id, p_reason,
    jsonb_build_object('job', p_job, 'paused', FALSE), v_after);
  IF p_league_id IS NOT NULL THEN
    PERFORM public.op_league_line_internal(p_league_id,
      'FieldScout paused ' || public.op_job_words_internal(p_job) || ' in this league.' ||
      CASE p_job
        WHEN 'waivers' THEN ' Pending claims keep their order and run when waivers resume.'
        WHEN 'week-advance' THEN ' Weeks will not open or close until it resumes.'
        ELSE ' Finished weeks will not be made final until it resumes.' END);
  END IF;
  RETURN v_after;
END;
$$;
REVOKE ALL ON FUNCTION op_pause_job_internal(TEXT, UUID, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION op_resume_job_internal(
  p_job TEXT, p_league_id UUID, p_action_id UUID, p_reason TEXT, p_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_replay JSONB;
  v_actor  UUID := auth.uid();
  v_p      public.job_pauses;
  v_after  JSONB;
BEGIN
  v_replay := public.op_verb_prelude_internal('resume_job', p_league_id, p_action_id, p_reason);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM public.op_job_check_internal(p_job, 'resume');
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'resume_job: p_at is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_p FROM public.job_pauses p
  WHERE p.job = p_job AND p.resumed_at IS NULL AND p.league_id IS NOT DISTINCT FROM p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('changed', FALSE, 'job', p_job, 'league_id', p_league_id,
      'why', 'not_paused — there is no open pause for this job and scope; nothing was written');
  END IF;

  UPDATE public.job_pauses
  SET resumed_at = GREATEST(p_at, v_p.paused_at), resumed_by = v_actor, resume_action_id = p_action_id
  WHERE id = v_p.id;

  v_after := jsonb_build_object('changed', TRUE, 'job', p_job, 'league_id', p_league_id,
    'paused', FALSE, 'pause_id', v_p.id, 'resumed_at', GREATEST(p_at, v_p.paused_at),
    'skipped_runs', v_p.skipped_runs,
    'still_paused_for_every_league', (p_league_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.job_pauses p WHERE p.job = p_job AND p.resumed_at IS NULL AND p.league_id IS NULL)));
  PERFORM public.log_operator_action_internal(p_action_id, v_actor, 'resume_job',
    CASE WHEN p_league_id IS NULL THEN 'platform' ELSE 'league' END, p_league_id, p_reason,
    jsonb_build_object('job', p_job, 'paused', TRUE, 'pause_id', v_p.id, 'paused_at', v_p.paused_at), v_after);
  IF p_league_id IS NOT NULL THEN
    PERFORM public.op_league_line_internal(p_league_id,
      'FieldScout resumed ' || public.op_job_words_internal(p_job) || ' in this league.' ||
      CASE p_job
        WHEN 'waivers' THEN ' Pending claims run at the next waiver run.'
        ELSE ' Anything that was waiting happens at the next run.' END);
  END IF;
  RETURN v_after;
END;
$$;
REVOKE ALL ON FUNCTION op_resume_job_internal(TEXT, UUID, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. op_run_job_now (TD5) — the SAME function the cron calls
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION op_run_job_now_internal(
  p_job TEXT, p_league_id UUID, p_action_id UUID, p_reason TEXT, p_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_replay  JSONB;
  v_actor   UUID := auth.uid();
  v_claims  TEXT;
  v_sub     TEXT;
  v_r       JSONB;
  v_worked  BOOLEAN;
  v_after   JSONB;
BEGIN
  v_replay := public.op_verb_prelude_internal('run_job_now', p_league_id, p_action_id, p_reason);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM public.op_job_check_internal(p_job, 'run');
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'run_job_now: p_at is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  -- A paused scope is resumed first — run now never bypasses a pause.
  IF p_job <> 'lineup-lock' AND EXISTS (
       SELECT 1 FROM public.job_pauses p
       WHERE p.job = p_job AND p.resumed_at IS NULL
         AND (p.league_id IS NULL OR p.league_id = p_league_id)) THEN
    RETURN jsonb_build_object('changed', FALSE, 'job', p_job, 'league_id', p_league_id,
      'why', 'paused — this job is paused for this scope; resume it first. Nothing was run or written');
  END IF;

  -- The job RPCs are cron / service-role only (auth.uid() must be NULL). The
  -- gate has passed and the actor is captured, so the request's claims are
  -- cleared for this one call — transaction-local — and restored after.
  v_claims := current_setting('request.jwt.claims', TRUE);
  v_sub    := current_setting('request.jwt.claim.sub', TRUE);
  PERFORM set_config('request.jwt.claims', '', TRUE);
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);

  v_r := CASE p_job
    WHEN 'waivers'       THEN public.waiver_tick(p_at, p_league_id)
    WHEN 'week-advance'  THEN public.league_week_advance(p_at, p_league_id)
    WHEN 'week-finalize' THEN public.finalize_matchups(p_at, p_league_id)
    WHEN 'lineup-lock'   THEN public.lineup_lock_tick(p_at, p_league_id)
  END;

  PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), TRUE);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_sub, ''), TRUE);
  IF auth.uid() IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'run_job_now: the caller''s identity was not restored after the run' USING ERRCODE = 'P0001';
  END IF;

  -- Each job names "nothing happened" in its own key (waivers: why; the rest:
  -- reason); a failure is recorded as work (the job wrote its refusal).
  v_worked := CASE p_job
    WHEN 'waivers' THEN (v_r ->> 'why') IS NULL AND NOT COALESCE((v_r ->> 'paused')::boolean, FALSE)
    ELSE (v_r ->> 'reason') IS NULL END
    OR jsonb_array_length(COALESCE(v_r -> 'failures', '[]'::jsonb)) > 0;

  IF NOT v_worked THEN
    RETURN jsonb_build_object('changed', FALSE, 'job', p_job, 'league_id', p_league_id,
      'why', 'nothing_due — the job ran and found nothing to do; nothing was written', 'report', v_r);
  END IF;

  v_after := jsonb_build_object('changed', TRUE, 'job', p_job, 'league_id', p_league_id, 'ran_at', p_at, 'report', v_r);
  PERFORM public.log_operator_action_internal(p_action_id, v_actor, 'run_job_now',
    CASE WHEN p_league_id IS NULL THEN 'platform' ELSE 'league' END, p_league_id, p_reason,
    NULL, v_after);
  IF p_league_id IS NOT NULL THEN
    PERFORM public.op_league_line_internal(p_league_id,
      'FieldScout ran ' || public.op_job_words_internal(p_job) || ' for this league now, under the usual rules.');
  END IF;
  RETURN v_after;
END;
$$;
REVOKE ALL ON FUNCTION op_run_job_now_internal(TEXT, UUID, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. The doors (DEFINER; the database clock is the instant)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION op_pause_job(
  p_job TEXT, p_league_id UUID DEFAULT NULL, p_action_id UUID DEFAULT NULL, p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'pause_job: only a platform operator can use the job knobs (M8 TD1)' USING ERRCODE = '42501';
  END IF;
  RETURN public.op_pause_job_internal(p_job, p_league_id, p_action_id, p_reason, now());
END;
$$;
REVOKE ALL ON FUNCTION op_pause_job(TEXT, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION op_pause_job(TEXT, UUID, UUID, TEXT) TO authenticated;
COMMENT ON FUNCTION op_pause_job(TEXT, UUID, UUID, TEXT) IS
  'M8 §24.4 (migration 183, TD3 / TD4 / Q98): pause waivers / week-advance / week-finalize for one league or every league (p_league_id NULL). Operators only (in-body gate); idempotent on p_action_id; already paused = no-op, nothing written; one platform_operator_actions receipt + a "FieldScout" league line when league-scoped. lineup-lock and draft / stat-sync jobs refused by name.';

CREATE OR REPLACE FUNCTION op_resume_job(
  p_job TEXT, p_league_id UUID DEFAULT NULL, p_action_id UUID DEFAULT NULL, p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'resume_job: only a platform operator can use the job knobs (M8 TD1)' USING ERRCODE = '42501';
  END IF;
  RETURN public.op_resume_job_internal(p_job, p_league_id, p_action_id, p_reason, now());
END;
$$;
REVOKE ALL ON FUNCTION op_resume_job(TEXT, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION op_resume_job(TEXT, UUID, UUID, TEXT) TO authenticated;
COMMENT ON FUNCTION op_resume_job(TEXT, UUID, UUID, TEXT) IS
  'M8 §24.4 (migration 183, TD3 / TD4): close the open pause for (job, league-or-all). Operators only; idempotent on p_action_id; not paused = no-op; one receipt + a "FieldScout" league line when league-scoped. The next run — scheduled or run now — settles what waited.';

CREATE OR REPLACE FUNCTION op_run_job_now(
  p_job TEXT, p_league_id UUID DEFAULT NULL, p_action_id UUID DEFAULT NULL, p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'run_job_now: only a platform operator can use the job knobs (M8 TD1)' USING ERRCODE = '42501';
  END IF;
  RETURN public.op_run_job_now_internal(p_job, p_league_id, p_action_id, p_reason, now());
END;
$$;
REVOKE ALL ON FUNCTION op_run_job_now(TEXT, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION op_run_job_now(TEXT, UUID, UUID, TEXT) TO authenticated;
COMMENT ON FUNCTION op_run_job_now(TEXT, UUID, UUID, TEXT) IS
  'M8 §24.4 (migration 183, TD5): run waivers / week-advance / week-finalize / lineup-lock now, for one league or every league — the SAME function the cron calls, at the database clock, under the same rules (cannot finalize a week the rule holds). A paused scope must be resumed first. Operators only; idempotent on p_action_id; nothing due = no-op, nothing written.';

-- ---------------------------------------------------------------------------
-- waiver_tick — CREATE OR REPLACE against 150:1279-1388's FILE TEXT (D137),
--   2 hunks (+2 / -0), each marked `183 / L.G1.3 (TD4)`; not one other byte.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION waiver_tick(
  p_now       TIMESTAMPTZ DEFAULT now(),
  p_league_id UUID        DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_batch     CONSTANT INTEGER := 25;
  c_max_loops CONSTANT INTEGER := 40;
  v_paused    BOOLEAN;
  v_seen      UUID[] := '{}';
  v_loops     INTEGER := 0;
  v_pass      INTEGER;
  v_lg        RECORD;
  v_r         JSONB;
  v_settled   JSONB := '[]'::jsonb;
  v_seeded    JSONB := '[]'::jsonb;
  v_closed    JSONB := '[]'::jsonb;
  v_other     JSONB := '[]'::jsonb;
  v_failures  JSONB := '[]'::jsonb;
  v_waiting   INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'waiver_tick: a job RPC is run by pg_cron or the service role, never by a signed-in user'
      USING ERRCODE = '42501';
  END IF;
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'waiver_tick: p_now is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  -- THE KILL SWITCH, read once. An operator pauses waivers with a
  -- service_role write and nothing else:
  --     insert into system_flags (key, value) values ('waivers_paused', '{"paused": true}')
  --     on conflict (key) do update set value = excluded.value, updated_at = now();
  -- Deleting the row (or {"paused": false}) resumes at the next minute.
  SELECT COALESCE((f.value ->> 'paused')::boolean, FALSE) INTO v_paused
  FROM public.system_flags f WHERE f.key = 'waivers_paused';
  IF COALESCE(v_paused, FALSE) THEN
    SELECT count(*)::int INTO v_waiting
    FROM public.leagues l
    WHERE l.status IN ('in_season', 'playoffs') AND l.deleted_at IS NULL
      AND (p_league_id IS NULL OR l.id = p_league_id)
      AND l.waiver_next_run_at <= p_now;
    RETURN jsonb_build_object('at', p_now, 'scope', p_league_id, 'paused', TRUE,
      'why', 'paused_by_system_flag:waivers_paused — no league was processed or seeded; due runs stay pending (free agency stays shut on them) until the flag is lifted',
      'leagues_waiting', v_waiting);
  END IF;

  PERFORM public.job_pause_note_internal('waivers', p_league_id, p_now);   -- 183 / L.G1.3 (TD4)

  LOOP
    v_loops := v_loops + 1;
    v_pass := 0;
    FOR v_lg IN
      SELECT l.id, l.waiver_next_run_at
      FROM public.leagues l
      WHERE l.status IN ('in_season', 'playoffs')
        AND l.deleted_at IS NULL
        AND (p_league_id IS NULL OR l.id = p_league_id)
        AND NOT (l.id = ANY (v_seen))
        AND NOT public.job_paused_internal('waivers', l.id)   -- 183 / L.G1.3 (TD4)
        AND (
          (COALESCE(l.waiver_type, 'faab') <> 'none_fcfs' AND (l.waiver_next_run_at IS NULL OR l.waiver_next_run_at <= p_now))
          OR (COALESCE(l.waiver_type, 'faab') = 'none_fcfs'
              AND (l.waiver_next_run_at IS NOT NULL
                   OR EXISTS (SELECT 1 FROM public.waiver_claims c WHERE c.league_id = l.id AND c.status = 'pending'))))
      ORDER BY l.waiver_next_run_at NULLS FIRST, l.id
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_seen := v_seen || v_lg.id;
      BEGIN
        v_r := public.process_waivers_internal(v_lg.id, p_now);
        CASE v_r ->> 'status'
          WHEN 'settled'    THEN v_settled := v_settled || jsonb_build_array(v_r);
          WHEN 'seeded'     THEN v_seeded  := v_seeded  || jsonb_build_array(v_r);
          WHEN 'no_waivers' THEN v_closed  := v_closed  || jsonb_build_array(v_r);
          ELSE                   v_other   := v_other   || jsonb_build_array(v_r);
        END CASE;
      EXCEPTION WHEN OTHERS THEN
        -- This league's writes are rolled back (the block is a
        -- subtransaction): claims stay pending, no FAAB moved, the run not
        -- advanced. Recorded LOUDLY, then the tick carries on.
        v_failures := v_failures || jsonb_build_object(
          'league_id', v_lg.id, 'run_at', v_lg.waiver_next_run_at, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'waiver_tick: league % refused at %: % (%)', v_lg.id, v_lg.waiver_next_run_at, SQLERRM, SQLSTATE;
        INSERT INTO public.waiver_runs AS w (league_id, run_at, status, processed_at, attempts, last_error, updated_at)
        VALUES (v_lg.id, COALESCE(v_lg.waiver_next_run_at, '-infinity'::timestamptz), 'refused', NULL, 1,
                SQLSTATE || ': ' || SQLERRM, p_now)
        ON CONFLICT (league_id, run_at) DO UPDATE
          SET attempts = w.attempts + 1, last_error = EXCLUDED.last_error, updated_at = EXCLUDED.updated_at
          WHERE w.status = 'refused';
      END;
    END LOOP;
    EXIT WHEN v_pass < c_batch OR v_loops >= c_max_loops;
  END LOOP;

  RETURN jsonb_build_object(
    'at',         p_now,
    'scope',      p_league_id,
    'paused',     FALSE,
    'leagues',    cardinality(v_seen),
    'settled',    v_settled,
    'seeded',     v_seeded,
    'no_waivers', v_closed,
    'other',      v_other,
    'failures',   v_failures,
    'why',        CASE WHEN cardinality(v_seen) = 0 THEN 'no_league_due — no in-season league had a waiver run due, an untracked schedule, or claims left under no waivers' END);
END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_tick(TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- league_week_advance — CREATE OR REPLACE against 118:1725-1936's FILE TEXT (D137),
--   2 hunks (+2 / -0), each marked `183 / L.G1.3 (TD4)`; not one other byte.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_week_advance(
  p_now       TIMESTAMPTZ DEFAULT now(),
  p_league_id UUID        DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_batch     CONSTANT INTEGER := 25;
  c_max_loops CONSTANT INTEGER := 40;
  v_seen        UUID[] := '{}';
  v_loops       INTEGER := 0;
  v_pass        INTEGER;
  v_lg          RECORD;
  v_league      public.leagues;
  v_lw          RECORD;
  v_team        RECORD;
  v_carry       JSONB;
  v_cnt         INTEGER;
  v_leagues     INTEGER := 0;
  v_opened      INTEGER := 0;
  v_closed      INTEGER := 0;
  v_carried     INTEGER := 0;
  v_matchups    INTEGER := 0;
  v_unstamped   JSONB := '[]'::jsonb;
  v_carries     JSONB := '[]'::jsonb;
  v_failures    JSONB := '[]'::jsonb;
  v_weeks       INTEGER[];
  v_bracket     JSONB;
  v_brackets    JSONB := '[]'::jsonb;
  v_bracket_failures JSONB := '[]'::jsonb;
  v_bracket_blocked  JSONB := '[]'::jsonb;
  v_bracket_waiting  JSONB := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'league_week_advance: a job RPC is run by pg_cron or the service role, never by a signed-in user'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.job_pause_note_internal('week-advance', p_league_id, p_now);   -- 183 / L.G1.3 (TD4)

  LOOP
    v_loops := v_loops + 1;
    v_pass := 0;

    FOR v_lg IN
      SELECT l.id
      FROM public.leagues l
      WHERE l.status IN ('in_season', 'playoffs')
        AND l.deleted_at IS NULL
        AND (p_league_id IS NULL OR l.id = p_league_id)
        AND NOT (l.id = ANY (v_seen))
        AND NOT public.job_paused_internal('week-advance', l.id)   -- 183 / L.G1.3 (TD4)
      ORDER BY l.id
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_seen := v_seen || v_lg.id;
      v_leagues := v_leagues + 1;

      BEGIN
        SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_lg.id;

        -- (a) upcoming → live at starts_at (the CURRENT-week boundary, 112).
        FOR v_lw IN
          SELECT lw.id, lw.week
          FROM public.league_weeks lw
          JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
          WHERE lw.league_id = v_lg.id
            AND lw.season = v_league.season
            AND lw.status = 'upcoming'
            AND w.starts_at <= p_now
          ORDER BY lw.week
          FOR UPDATE OF lw
        LOOP
          UPDATE public.league_weeks SET status = 'live' WHERE id = v_lw.id;   -- F4 guard: one legal step
          GET DIAGNOSTICS v_cnt = ROW_COUNT;
          IF v_cnt <> 1 THEN
            RAISE EXCEPTION 'league_week_advance: opening week % of league % touched % rows, expected 1', v_lw.week, v_lg.id, v_cnt
              USING ERRCODE = 'P0001';
          END IF;
          v_opened := v_opened + 1;

          UPDATE public.matchups m
          SET status = 'live', updated_at = p_now
          WHERE m.league_id = v_lg.id AND m.season = v_league.season AND m.week = v_lw.week
            AND m.status = 'scheduled';
          GET DIAGNOSTICS v_cnt = ROW_COUNT;
          v_matchups := v_matchups + v_cnt;

          -- AUTO-CARRY (D293): an explicit row for every seated franchise
          -- that has none for the week.
          FOR v_team IN
            SELECT t.id
            FROM public.teams t
            WHERE t.league_id = v_lg.id AND t.status <> 'retired'
              AND NOT EXISTS (
                SELECT 1 FROM public.team_lineups tl
                WHERE tl.team_id = t.id AND tl.season = v_league.season AND tl.week = v_lw.week)
            ORDER BY t.id
          LOOP
            v_carry := public.lineup_carry_internal(v_lg.id, v_team.id, v_league.season, v_lw.week, p_now);
            v_carried := v_carried + 1;
            v_carries := v_carries || jsonb_build_object(
              'league_id', v_lg.id,
              'team_id', v_team.id,
              'week', v_lw.week,
              'carried_from_week', v_carry -> 'carried_from_week',
              'dropped', v_carry -> 'dropped',
              'illegal', v_carry -> 'flags' -> 'illegal');
          END LOOP;
        END LOOP;

        -- (b) live → correction_window at last_game_ends_at (the games-over
        --     EVENT — the datum 115's lock releases on; NULL = not over).
        FOR v_lw IN
          SELECT lw.id, lw.week
          FROM public.league_weeks lw
          JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
          WHERE lw.league_id = v_lg.id
            AND lw.season = v_league.season
            AND lw.status = 'live'
            AND w.last_game_ends_at IS NOT NULL
            AND w.last_game_ends_at <= p_now
          ORDER BY lw.week
          FOR UPDATE OF lw
        LOOP
          UPDATE public.league_weeks SET status = 'correction_window' WHERE id = v_lw.id;   -- F4: one legal step
          GET DIAGNOSTICS v_cnt = ROW_COUNT;
          IF v_cnt <> 1 THEN
            RAISE EXCEPTION 'league_week_advance: closing week % of league % touched % rows, expected 1', v_lw.week, v_lg.id, v_cnt
              USING ERRCODE = 'P0001';
          END IF;
          v_closed := v_closed + 1;
        END LOOP;

        -- LOUD (F238): a live week whose correction window has passed but
        -- whose last game end is unrecorded is NAMED, never inferred.
        SELECT array_agg(lw.week ORDER BY lw.week) INTO v_weeks
        FROM public.league_weeks lw
        JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
        WHERE lw.league_id = v_lg.id AND lw.season = v_league.season
          AND lw.status = 'live'
          AND w.last_game_ends_at IS NULL
          AND w.correction_window_ends_at <= p_now;
        IF v_weeks IS NOT NULL THEN
          v_unstamped := v_unstamped || jsonb_build_object('league_id', v_lg.id, 'weeks', to_jsonb(v_weeks));
          RAISE WARNING 'league_week_advance: league % week(s) % are past their correction window but nfl_weeks.last_game_ends_at is NOT RECORDED — the week stays live until ingestion records the last game end (F238; §23.3)',
            v_lg.id, v_weeks;
        END IF;

        -- 118 (Q39 (E), the ROLLOVER): the bracket / champion consequences —
        -- every run, idempotent. A round becomes due the moment the prior
        -- stage's last week has CLOSED at `nfl_weeks.last_game_ends_at` (the
        -- (b) instant above — the same event Q34(B) ruled for the lock's
        -- release), provisional from that week's scores; finalize rebuilds it
        -- from the final results. Guarded so a bracket problem is LOUD
        -- (`bracket_failures` + WARNING) and RETRIED next run — never a
        -- block on the week machine.
        BEGIN
          v_bracket := public.playoff_bracket_sync_internal(v_lg.id, p_now);
          IF v_bracket ? 'action' THEN
            v_brackets := v_brackets || (jsonb_build_object('league_id', v_lg.id) || v_bracket);
          -- R841: a bracket a HUMAN must unblock (a seedless playoff row; a
          -- played round the prior verdict moved under — R839) is named on
          -- the hourly payload + WARNING; one WAITING on pending scores
          -- (R840, §23.2/E61) likewise — retried next run. The calendar
          -- `waiting_*` states (the prior stage not yet rolled) are the
          -- every-hour normal and stay out of the payload.
          ELSIF v_bracket ->> 'reason' IN ('bracket_foreign_rows', 'rebuild_refused_round_played') THEN
            v_bracket_blocked := v_bracket_blocked || (jsonb_build_object('league_id', v_lg.id) || v_bracket);
            RAISE WARNING 'league_week_advance: league % playoff bracket BLOCKED at round % — % (a commissioner must act — M6 §10; retried next run)', v_lg.id, v_bracket ->> 'round', v_bracket ->> 'reason';
          ELSIF v_bracket ->> 'reason' = 'bracket_waiting' THEN
            v_bracket_waiting := v_bracket_waiting || (jsonb_build_object('league_id', v_lg.id) || v_bracket);
            RAISE WARNING 'league_week_advance: league % playoff bracket round % WAITING — the prior stage holds pending scores % (§23.2/E61: never seeded from an absent score; retried next run)', v_lg.id, v_bracket ->> 'round', v_bracket -> 'pending';
          END IF;
        EXCEPTION WHEN OTHERS THEN
          v_bracket_failures := v_bracket_failures || jsonb_build_object(
            'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
          RAISE WARNING 'league_week_advance: playoff bracket sync failed for league %: % (%) — retried next run', v_lg.id, SQLERRM, SQLSTATE;
        END;
      EXCEPTION WHEN OTHERS THEN
        v_failures := v_failures || jsonb_build_object(
          'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'league_week_advance failed for league %: % (%)', v_lg.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass < c_batch OR v_loops >= c_max_loops;
  END LOOP;

  RETURN jsonb_build_object(
    'at',              p_now,
    'scope',           p_league_id,
    'leagues',         v_leagues,
    'opened',          v_opened,
    'closed',          v_closed,
    'matchups_live',   v_matchups,
    'carried',         v_carried,
    'carries',         v_carries,
    'unstamped_weeks', v_unstamped,
    'brackets',        v_brackets,
    'bracket_failures', v_bracket_failures,
    'bracket_blocked', v_bracket_blocked,
    'bracket_waiting', v_bracket_waiting,
    'failures',        v_failures,
    'loops',           v_loops,
    'reason', CASE
      WHEN v_leagues = 0 THEN 'no_in_season_leagues'
      WHEN v_opened + v_closed + jsonb_array_length(v_brackets) = 0 THEN 'nothing_due'
      ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION league_week_advance(TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- finalize_matchups — CREATE OR REPLACE against 180:115-385's FILE TEXT (D137),
--   2 hunks (+2 / -0), each marked `183 / L.G1.3 (TD4)`; not one other byte.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION finalize_matchups(
  p_now       TIMESTAMPTZ DEFAULT now(),
  p_league_id UUID        DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_batch     CONSTANT INTEGER := 25;
  c_max_loops CONSTANT INTEGER := 40;
  v_seen         UUID[] := '{}';
  v_loops        INTEGER := 0;
  v_pass         INTEGER;
  v_lg           RECORD;
  v_league       public.leagues;
  v_settings     JSONB;
  v_mode         TEXT;
  v_lw           RECORD;
  v_g            RECORD;
  v_m            RECORD;
  v_res          TEXT;
  v_cnt          INTEGER;
  v_twr          INTEGER;
  v_median       NUMERIC;
  v_matchups     INTEGER;
  v_pend         JSONB;
  v_w            RECORD;
  v_finalized    INTEGER := 0;
  v_lg_finalized INTEGER := 0;
  v_lg_report    JSONB := '[]'::jsonb;
  v_leagues      INTEGER := 0;
  v_report       JSONB := '[]'::jsonb;
  v_skipped      JSONB := '[]'::jsonb;
  v_failures     JSONB := '[]'::jsonb;
  v_live_past    JSONB := '[]'::jsonb;
  v_weeks        INTEGER[];
  v_bracket      JSONB;
  v_brackets     JSONB := '[]'::jsonb;
  v_bracket_failures JSONB := '[]'::jsonb;
  v_bracket_blocked  JSONB := '[]'::jsonb;
  v_bracket_waiting  JSONB := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'finalize_matchups: a job RPC is run by pg_cron or the service role, never by a signed-in user'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.job_pause_note_internal('week-finalize', p_league_id, p_now);   -- 183 / L.G1.3 (TD4)

  LOOP
    v_loops := v_loops + 1;
    v_pass := 0;

    -- Claim LEAGUES with a due week (rule 8: the league row first).
    FOR v_lg IN
      SELECT l.id
      FROM public.leagues l
      WHERE l.status IN ('in_season', 'playoffs')
        AND l.deleted_at IS NULL
        AND (p_league_id IS NULL OR l.id = p_league_id)
        AND NOT (l.id = ANY (v_seen))
        AND NOT public.job_paused_internal('week-finalize', l.id)   -- 183 / L.G1.3 (TD4)
        AND EXISTS (
          SELECT 1
          FROM public.league_weeks lw
          JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
          WHERE lw.league_id = l.id AND lw.season = l.season
            AND (   (lw.status = 'correction_window' AND w.correction_window_ends_at <= p_now)
                 OR (lw.status = 'live'              AND w.last_game_ends_at IS NULL
                                                    AND w.correction_window_ends_at <= p_now)))
      ORDER BY l.id
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_seen := v_seen || v_lg.id;
      v_leagues := v_leagues + 1;

      -- F244: the league's count/report accumulate in LOCALS and merge only
      -- after the subtransaction COMMITS (a later week's raise rolls the
      -- league's writes back; PL/pgSQL keeps variables — the report must not).
      v_lg_finalized := 0;
      v_lg_report := '[]'::jsonb;
      BEGIN
        SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_lg.id;
        v_settings  := COALESCE(v_league.settings, '{}'::jsonb);
        v_mode      := COALESCE(v_settings ->> 'schedule_mode', 'h2h');

        -- LOUD (F238, the other side): live weeks past their window are not
        -- finalizable — the advance job could not close them.
        SELECT array_agg(lw.week ORDER BY lw.week) INTO v_weeks
        FROM public.league_weeks lw
        JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
        WHERE lw.league_id = v_lg.id AND lw.season = v_league.season
          AND lw.status = 'live' AND w.last_game_ends_at IS NULL
          AND w.correction_window_ends_at <= p_now;
        IF v_weeks IS NOT NULL THEN
          v_live_past := v_live_past || jsonb_build_object('league_id', v_lg.id, 'weeks', to_jsonb(v_weeks));
        END IF;

        FOR v_lw IN
          SELECT lw.id, lw.week, w.correction_window_ends_at
          FROM public.league_weeks lw
          JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
          WHERE lw.league_id = v_lg.id
            AND lw.season = v_league.season
            AND lw.status = 'correction_window'
            AND w.correction_window_ends_at <= p_now
          ORDER BY lw.week
          FOR UPDATE OF lw
        LOOP
          -- (a) §23.2: every non-postponed game of the week final, at run time.
          SELECT * INTO v_g FROM public.week_games_state_internal(v_league.season, v_lw.week);
          IF NOT v_g.all_final THEN
            v_skipped := v_skipped || jsonb_build_object(
              'league_id', v_lg.id, 'week', v_lw.week, 'reason', 'games_not_final',
              'total', v_g.total_games, 'final', v_g.final_games,
              'postponed', v_g.postponed_games, 'open', v_g.open_games);
            RAISE NOTICE 'finalize_matchups: league % week % not finalized — % of % in-week games final (% postponed, % open); no league state advances on partial data (§23.2)',
              v_lg.id, v_lw.week, v_g.final_games, v_g.total_games - v_g.postponed_games, v_g.postponed_games, v_g.open_games;
            CONTINUE;
          END IF;

          v_matchups := 0;

          -- (b)/(c) THE PENDING SHAPES, BY NAME — 117's
          --     `week_results_pending_internal` (D137: ONE reading of
          --     "pending" for finalization AND the rebuild; called, never
          --     copied): h2h — a NULL score on ANY matchup, overridden or
          --     not (E61, R792); total_points — ANY seated team without a
          --     result row (R788). The week is SKIPPED BY NAME and stays
          --     `correction_window`; nothing is coerced to 0.00.
          v_pend := public.week_results_pending_internal(v_lg.id, v_league.season, v_lw.week);
          IF v_pend IS NOT NULL THEN
            v_skipped := v_skipped || (jsonb_build_object('league_id', v_lg.id, 'week', v_lw.week) || v_pend);
            RAISE NOTICE 'finalize_matchups: league % week % not finalized — % (pending; absence is not a score — E61/§23.2; never coerced to 0.00)',
              v_lg.id, v_lw.week, v_pend ->> 'reason';
            CONTINUE;
          END IF;

          IF v_mode = 'h2h' THEN
            -- Results per matchup (E38: two decimals, ties are ties — 117's
            -- `matchup_result_internal` is the ONE derivation, shared with
            -- the rebuild's drift check); an overridden cell is never
            -- touched (§22.2).
            FOR v_m IN
              SELECT m.* FROM public.matchups m
              WHERE m.league_id = v_lg.id AND m.season = v_league.season AND m.week = v_lw.week
              ORDER BY m.round_type, m.id
              FOR UPDATE
            LOOP
              v_res := public.matchup_result_internal(v_m.home_score, v_m.away_score, v_m.away_team_id);
              IF v_m.is_overridden THEN
                -- The cell stands: scores untouched, an overridden result
                -- untouched; a NULL result is read from the overridden scores.
                UPDATE public.matchups
                SET status = 'final', result = COALESCE(v_m.result, v_res), updated_at = p_now
                WHERE id = v_m.id;
              ELSE
                UPDATE public.matchups
                SET status = 'final', result = v_res, updated_at = p_now
                WHERE id = v_m.id;
              END IF;
              v_matchups := v_matchups + 1;
            END LOOP;
          END IF;

          -- (c)/(d) THE RESULTS MATH — 117's `week_results_write_internal`
          --     (D137: the ONE writer of `team_week_results` for a closed
          --     week; `rebuild_team_week_results` calls the same helper and
          --     pgTAP 065 pins the two byte-identical): the h2h rows from the
          --     now-final matchups (PF once; the primary + the `secondary`
          --     row; the shape guards), the total_points rows flipped
          --     `is_final`, the EXACT median (E39) compared and its cells
          --     written. `median` is NULL when median_game is off or the
          --     week is a playoff week.
          SELECT * INTO v_w FROM public.week_results_write_internal(v_lg.id, v_league.season, v_lw.week);
          v_twr := v_w.results;
          v_median := v_w.median;

          -- (e) the week → final (F4's last legal step).
          UPDATE public.league_weeks
          SET status = 'final', finalized_at = p_now, median_score = v_median
          WHERE id = v_lw.id;
          GET DIAGNOSTICS v_cnt = ROW_COUNT;
          IF v_cnt <> 1 THEN
            RAISE EXCEPTION 'finalize_matchups: finalizing week % of league % touched % rows, expected 1', v_lw.week, v_lg.id, v_cnt
              USING ERRCODE = 'P0001';
          END IF;

          -- E43: the system note when a postponed game was excluded.
          IF v_g.postponed_games > 0 THEN
            INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
            VALUES (v_lg.id, NULL,
              'Week ' || v_lw.week || ' is final without the postponed game' ||
              CASE WHEN v_g.postponed_games > 1 THEN 's ' ELSE ' ' END || v_g.postponed_list ||
              ' — players in a game moved out of the week score 0 for the week. The commissioner can change a result.',
              'league', TRUE);
          END IF;

          v_lg_finalized := v_lg_finalized + 1;
          v_lg_report := v_lg_report || jsonb_build_object(
            'league_id', v_lg.id, 'week', v_lw.week, 'schedule_mode', v_mode,
            'matchups_final', v_matchups, 'results', v_twr,
            'median_score', v_median,
            'postponed_excluded', v_g.postponed_games);
        END LOOP;

        -- 118 (Q39 (D)/(E), the CORRECTION CLOSE): the bracket / champion
        -- consequences after this league's weeks — every claim, idempotent:
        -- the round rebuilt from FINAL results when a correction moved a
        -- seed; the champion + `complete` at the last week's final (rank 1
        -- through the full chain when there is no bracket — (C)/(D)). Guarded
        -- so a bracket problem is LOUD (`bracket_failures` + WARNING) and
        -- RETRIED next run — never a rollback of the week's finalization.
        BEGIN
          v_bracket := public.playoff_bracket_sync_internal(v_lg.id, p_now);
          IF v_bracket ? 'action' THEN
            v_brackets := v_brackets || (jsonb_build_object('league_id', v_lg.id) || v_bracket);
          -- R841: a bracket a HUMAN must unblock (a seedless playoff row; a
          -- played round the prior verdict moved under — R839) is named on
          -- the hourly payload + WARNING; one WAITING on pending scores
          -- (R840, §23.2/E61) likewise — retried next run. The calendar
          -- `waiting_*` states (the prior stage not yet rolled) are the
          -- every-hour normal and stay out of the payload.
          ELSIF v_bracket ->> 'reason' IN ('bracket_foreign_rows', 'rebuild_refused_round_played') THEN
            v_bracket_blocked := v_bracket_blocked || (jsonb_build_object('league_id', v_lg.id) || v_bracket);
            RAISE WARNING 'finalize_matchups: league % playoff bracket BLOCKED at round % — % (a commissioner must act — M6 §10; retried next run)', v_lg.id, v_bracket ->> 'round', v_bracket ->> 'reason';
          ELSIF v_bracket ->> 'reason' = 'bracket_waiting' THEN
            v_bracket_waiting := v_bracket_waiting || (jsonb_build_object('league_id', v_lg.id) || v_bracket);
            RAISE WARNING 'finalize_matchups: league % playoff bracket round % WAITING — the prior stage holds pending scores % (§23.2/E61: never seeded from an absent score; retried next run)', v_lg.id, v_bracket ->> 'round', v_bracket -> 'pending';
          END IF;
        EXCEPTION WHEN OTHERS THEN
          v_bracket_failures := v_bracket_failures || jsonb_build_object(
            'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
          RAISE WARNING 'finalize_matchups: playoff bracket sync failed for league %: % (%) — retried next run', v_lg.id, SQLERRM, SQLSTATE;
        END;
      EXCEPTION WHEN OTHERS THEN
        v_failures := v_failures || jsonb_build_object(
          'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'finalize_matchups failed for league %: % (%)', v_lg.id, SQLERRM, SQLSTATE;
        -- F244: everything this league reported ROLLED BACK with it.
        v_lg_finalized := 0;
        v_lg_report := '[]'::jsonb;
      END;
      -- F244: merge only what COMMITTED.
      v_finalized := v_finalized + v_lg_finalized;
      v_report := v_report || v_lg_report;
    END LOOP;

    EXIT WHEN v_pass < c_batch OR v_loops >= c_max_loops;
  END LOOP;

  RETURN jsonb_build_object(
    'at',               p_now,
    'scope',            p_league_id,
    'leagues',          v_leagues,
    'finalized',        v_finalized,
    'weeks',            v_report,
    'skipped',          v_skipped,
    'live_past_window', v_live_past,
    'brackets',         v_brackets,
    'bracket_failures', v_bracket_failures,
    'bracket_blocked',  v_bracket_blocked,
    'bracket_waiting',  v_bracket_waiting,
    'failures',         v_failures,
    'loops',            v_loops,
    'reason', CASE
      WHEN v_leagues = 0 THEN 'nothing_due'
      WHEN v_finalized = 0 AND jsonb_array_length(v_brackets) = 0 THEN 'nothing_finalized'
      ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION finalize_matchups(TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated;

