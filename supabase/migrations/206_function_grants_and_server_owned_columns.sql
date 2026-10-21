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
-- MIGRATION CHECKLIST (tasks-M* §4.4):
--   * No CREATE OR REPLACE of an existing function — D137 does not apply;
--     every function below is new (`grep -l "server_owned" supabase/migrations`
--     → this file only).
--   * New functions pin `search_path = ''` and are REVOKEd from PUBLIC, anon,
--     authenticated (trigger functions are never called directly).
--   * No table, policy or existing trigger changed. Triggers are added at the
--     default enable mode, like the 025 / 026 profile guards beside them.
--   * R6 / D38 waivers: none needed — no league table, no RPC, no realtime.
--   * Rollback: DROP the five triggers and five functions; Part 1 has no
--     undo (it restores 074's intent).
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

-- 2d. start_sit_questions — vote totals and the result
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

-- Trigger functions are never called directly.
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
