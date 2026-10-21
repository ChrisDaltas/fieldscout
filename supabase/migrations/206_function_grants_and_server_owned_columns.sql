-- ============================================================================
-- 206 — tighten two function grants; guard server-owned columns
--       (M7 L.F2.8 G1 + G3; PROGRESS D660–D662; spec §19.3; F710 / F712)
-- ============================================================================
--
-- PART 1 — FUNCTION GRANTS (G1). The AI quota pair from 074 is meant to be
-- callable by the server only (074 §5 says why: both take the user as a
-- parameter). Re-issue that intent explicitly: EXECUTE revoked from PUBLIC,
-- anon and authenticated; granted to service_role (the app's only caller,
-- `src/lib/claude/quota.ts`, uses the service-role client). Idempotent.
--
-- PART 2 — SERVER-OWNED COLUMNS (G3). Some columns are counters or results
-- the server keeps (follow counts, cred, like / view / player counts, tag use
-- counts, start/sit vote totals and results, expert follow counts and the
-- AI-generated flag). Beside each table's row policies, one BEFORE trigger
-- per table refuses a change to those columns from a client role.
--
-- WHO IS A CLIENT ROLE. `current_user` IN ('anon', 'authenticated') — the
-- role PostgREST switches to for a browser request. NOT `auth.role()`: that
-- reads the request's JWT, which is still 'authenticated' inside the counter
-- triggers (`update_follow_counts` and friends, SECURITY DEFINER, owned by
-- postgres) that legitimately keep these columns when a user follows or likes
-- something. Inside those, `current_user` is postgres, so they pass; so do
-- service_role (scripts, admin routes) and migrations. The guard functions
-- are SECURITY INVOKER for exactly that reason — a DEFINER guard would always
-- see its own owner.
--
-- INSERT: a client row may carry only the column's starting value (0 / NULL
-- / false), never a made-up total. UPDATE: the column may not change. Every
-- other column is untouched — profile edits (username, bio, avatar), list
-- edits, start/sit edits before voting closes, claimed-expert profile edits
-- all keep working.
--
-- PART 3 — LINK TABLES (review R1650). follows, list_likes, list_tags and
-- expert_follows are insert / delete only from the app (grep 2026-10-21: the
-- one upsert, `use-follows.ts`, is ignoreDuplicates = ON CONFLICT DO NOTHING,
-- which needs no UPDATE). Their counters move on INSERT / DELETE only, so a
-- client UPDATE of a link row would move it without moving the counts.
-- UPDATE is revoked from anon and authenticated on the four (D23 — an
-- explicit, named REVOKE; pgTAP 081 C3 names them).
--
-- MIGRATION CHECKLIST (tasks-M* §4.4):
--   * No CREATE OR REPLACE of an existing function — D137 does not apply;
--     every function below is new (`grep -l "server_owned" supabase/migrations`
--     → this file only).
--   * New functions pin `search_path = ''`. The six trigger functions are
--     REVOKEd from PUBLIC, anon, authenticated (never called directly). The
--     one SECURITY DEFINER, `start_sit_question_vote_exists`, gates in-body
--     (the caller must be the question's poster), is REVOKEd from PUBLIC /
--     anon and granted to authenticated — the INVOKER guard calls it as the
--     poster, who cannot read other users' votes through RLS.
--   * Grants: UPDATE revoked from anon / authenticated on four link tables
--     (Part 3). No policy or existing trigger changed. Triggers are added at the
--     default enable mode, like the 025 / 026 profile guards beside them.
--   * R6 / D38 waivers: none needed — no league table, no RPC, no realtime.
--   * Rollback: DROP the six triggers and seven functions; GRANT UPDATE on
--     the four link tables back; Part 1 has no undo (it restores 074's
--     intent).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PART 1 — the AI quota pair: server only
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.claim_ai_generation(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_ai_generation(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_generation(uuid, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_ai_generation(uuid, text)
  TO service_role;

-- ----------------------------------------------------------------------------
-- PART 2 — server-owned columns
-- ----------------------------------------------------------------------------

-- 2a. profiles — cred and follow counts (no INSERT policy exists; rows come
--     from handle_new_user, so UPDATE is the only client door)
CREATE FUNCTION public.profiles_server_owned_guard_internal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF NEW.cred_score IS DISTINCT FROM OLD.cred_score
       OR NEW.cred_rank IS DISTINCT FROM OLD.cred_rank
       OR NEW.follower_count IS DISTINCT FROM OLD.follower_count
       OR NEW.following_count IS DISTINCT FROM OLD.following_count THEN
      RAISE EXCEPTION 'Cred and follower counts are managed by the system.'
        USING errcode = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_server_owned_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_server_owned_guard_internal();

-- 2b. lists — like / view / player counts
CREATE FUNCTION public.lists_server_owned_guard_internal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF COALESCE(NEW.like_count, 0) <> 0
         OR COALESCE(NEW.view_count, 0) <> 0
         OR COALESCE(NEW.player_count, 0) <> 0 THEN
        RAISE EXCEPTION 'List counts are managed by the system.'
          USING errcode = 'check_violation';
      END IF;
    ELSIF NEW.like_count IS DISTINCT FROM OLD.like_count
       OR NEW.view_count IS DISTINCT FROM OLD.view_count
       OR NEW.player_count IS DISTINCT FROM OLD.player_count THEN
      RAISE EXCEPTION 'List counts are managed by the system.'
        USING errcode = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lists_server_owned_guard
  BEFORE INSERT OR UPDATE ON public.lists
  FOR EACH ROW
  EXECUTE FUNCTION public.lists_server_owned_guard_internal();

-- 2c. tags — use count (clients may only INSERT a tag; no UPDATE policy)
CREATE FUNCTION public.tags_server_owned_guard_internal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF (TG_OP = 'INSERT' AND COALESCE(NEW.use_count, 0) <> 0)
       OR (TG_OP = 'UPDATE' AND NEW.use_count IS DISTINCT FROM OLD.use_count) THEN
      RAISE EXCEPTION 'Tag counts are managed by the system.'
        USING errcode = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tags_server_owned_guard
  BEFORE INSERT OR UPDATE ON public.tags
  FOR EACH ROW
  EXECUTE FUNCTION public.tags_server_owned_guard_internal();

-- 2d. start_sit_questions — vote totals and the result; the two players are
--     frozen once anyone has voted (review R1651)
CREATE FUNCTION public.start_sit_question_vote_exists(p_question_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.start_sit_questions q
     WHERE q.id = p_question_id AND q.poster_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the question''s poster may ask this.'
      USING errcode = '42501';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.start_sit_votes v WHERE v.question_id = p_question_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_sit_question_vote_exists(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_sit_question_vote_exists(uuid) TO authenticated, service_role;

CREATE FUNCTION public.start_sit_server_owned_guard_internal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF COALESCE(NEW.vote_count_a, 0) <> 0
         OR COALESCE(NEW.vote_count_b, 0) <> 0
         OR NEW.correct_player IS NOT NULL
         OR NEW.resolved_at IS NOT NULL
         OR COALESCE(NEW.is_voided, false) THEN
        RAISE EXCEPTION 'Votes and results are managed by the system.'
          USING errcode = 'check_violation';
      END IF;
    ELSIF NEW.vote_count_a IS DISTINCT FROM OLD.vote_count_a
       OR NEW.vote_count_b IS DISTINCT FROM OLD.vote_count_b
       OR NEW.correct_player IS DISTINCT FROM OLD.correct_player
       OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
       OR NEW.is_voided IS DISTINCT FROM OLD.is_voided THEN
      RAISE EXCEPTION 'Votes and results are managed by the system.'
        USING errcode = 'check_violation';
    ELSIF (NEW.player_a_id IS DISTINCT FROM OLD.player_a_id
           OR NEW.player_b_id IS DISTINCT FROM OLD.player_b_id)
          AND public.start_sit_question_vote_exists(OLD.id) THEN
      RAISE EXCEPTION 'The players can''t change once people have voted.'
        USING errcode = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_start_sit_server_owned_guard
  BEFORE INSERT OR UPDATE ON public.start_sit_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.start_sit_server_owned_guard_internal();

-- 2e. expert_profiles — follow count and the AI-generated flag (claimed
--     experts may UPDATE their own profile; no client INSERT policy)
CREATE FUNCTION public.expert_profiles_server_owned_guard_internal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF NEW.follower_count IS DISTINCT FROM OLD.follower_count
       OR NEW.is_ai_generated IS DISTINCT FROM OLD.is_ai_generated THEN
      RAISE EXCEPTION 'Follower counts and the AI label are managed by the system.'
        USING errcode = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_expert_profiles_server_owned_guard
  BEFORE UPDATE ON public.expert_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.expert_profiles_server_owned_guard_internal();

-- 2f. start_sit_votes — whether a vote was right, and the cred it earned
--     (clients may only INSERT their own vote; no UPDATE policy today)
CREATE FUNCTION public.start_sit_votes_server_owned_guard_internal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF (TG_OP = 'INSERT' AND (NEW.is_correct IS NOT NULL
                              OR COALESCE(NEW.cred_points_earned, 0) <> 0))
       OR (TG_OP = 'UPDATE' AND (NEW.is_correct IS DISTINCT FROM OLD.is_correct
                                 OR NEW.cred_points_earned IS DISTINCT FROM OLD.cred_points_earned)) THEN
      RAISE EXCEPTION 'Vote results are managed by the system.'
        USING errcode = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_start_sit_votes_server_owned_guard
  BEFORE INSERT OR UPDATE ON public.start_sit_votes
  FOR EACH ROW
  EXECUTE FUNCTION public.start_sit_votes_server_owned_guard_internal();

-- Trigger functions are never called directly.
REVOKE EXECUTE ON FUNCTION public.start_sit_votes_server_owned_guard_internal()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.profiles_server_owned_guard_internal()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lists_server_owned_guard_internal()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tags_server_owned_guard_internal()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.start_sit_server_owned_guard_internal()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expert_profiles_server_owned_guard_internal()
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- PART 3 — link tables: insert / delete only from clients (review R1650)
-- ----------------------------------------------------------------------------
REVOKE UPDATE ON public.follows FROM anon, authenticated;
REVOKE UPDATE ON public.list_likes FROM anon, authenticated;
REVOKE UPDATE ON public.list_tags FROM anon, authenticated;
REVOKE UPDATE ON public.expert_follows FROM anon, authenticated;
