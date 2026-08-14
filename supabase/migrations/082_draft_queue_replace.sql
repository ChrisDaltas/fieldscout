-- ============================================================================
-- `draft_queue_replace` — the atomic whole-queue replace — migration 082
-- (task L.B7.1; PROGRESS §6 F54 discharge; spec §8.4/§12.6; tasks-M2 §4
-- standing rules; D113(3) both faces; D118(6)/D123(5)(6) evidence).
--
-- WHY (the F54 row, verbatim mechanics): the L.B2.2 whole-queue replace is
-- validate → DELETE → INSERT over PostgREST, which spans NO transaction, and
-- 065 has no (draft_id, team_id, rank) unique. Two near-simultaneous replaces
-- for one seat interleave. The failure has TWO faces (D123(6)):
--   * DISJOINT sets — both INSERTs land: duplicate ranks, e.g. TEN rows
--     [1,1,2,2,3,3,4,4,5,5] (L.B6.1's chaos persona reproduced it through
--     the REAL route path 92 times in ~160 volleys — the COMMON case under
--     double-tap load, not a rarity);
--   * OVERLAPPING sets — the loser's INSERT trips
--     uniq(draft_id, team_id, player_id) AFTER its DELETE already ran: the
--     caller eats a 500 and their queue is GONE (the D113(3) partial-failure
--     face; observed 3/3 in a focused probe).
-- A (draft_id, team_id, rank) unique alone would close only the first face.
-- This RPC closes BOTH: one transaction (a failed INSERT rolls the DELETE
-- back) + a per-seat advisory xact lock (concurrent replaces for the same
-- seat SERIALIZE — last writer wins with dense ranks, exactly the §8.4
-- replace semantics the UI promises).
--
-- SECURITY INVOKER, DELIBERATELY (recorded design choice — the one draft
-- RPC that is NOT SECURITY DEFINER): `draft_queues` is the ONE
-- spec-sanctioned client-writable draft table (§12.6), and 065's
-- "Own queue write" / "Own queue read" policies (incl. the F51 mock
-- exclusion + the D103(3) launcher carve-out) ARE the authorization law.
-- Running as invoker keeps every row-touch inside this function under those
-- exact policies — the RLS backstop stays live, nothing is re-derived with
-- definer privileges that could drift from the policy text. The §4.1
-- SECURITY DEFINER checklist therefore does not bite (no definer routine is
-- created); search_path is pinned to '' regardless (house style, 004's
-- doctrine) and EXECUTE is revoked from PUBLIC/anon below.
--
-- In-body guard (loud failure over silent no-op): before touching rows the
-- function re-checks the SAME two admit arms as 065's policies and raises
-- 42501 otherwise. Without it, a forged (draft_id, team_id) with p_players
-- = '{}' would DELETE 0 RLS-filtered rows and report success — the
-- CLAUDE.md "never let nothing-happened mean it worked" class.
--
-- Residual (recorded, F7-style): a client writing draft_queues DIRECTLY
-- over PostgREST (the table stays client-writable per §12.6) can still
-- interleave its own raw statements. The app's only queue writers
-- (upsertQueue / queueFromList, amended in this task's PR) ride this RPC;
-- the residual is a self-inflicted corruption of the caller's OWN advisory
-- rows, bounded exactly as the F54 row documents (autopick's
-- ORDER BY rank, id stays deterministic; the next replace rewrites dense
-- ranks).
--
-- Errors follow the 062/063 SQLSTATE conventions (tasks-M2 §4.6): 42501
-- auth/no-leak · 22023 shape (friendly text — surfaced as a 400).
--
-- Migration checklist (§4.4): additive-only (one new function, no table
-- change, no policy change, no data change) · R6 rehearsal waiver cited —
-- unreleased-chain precedent does NOT apply (065–072 shipped; this file is
-- NEW at the chain head, 082 confirmed next-free after 081) · typegen
-- re-run with the hand-written alias block re-appended (additive-only diff
-- verified in the PR) · pgTAP file 031 (next free after 030) pins shape,
-- ACL, both admit arms, both refusal arms, dense-rank semantics, the
-- overlap face, and the empty-array clear.
-- ============================================================================

CREATE OR REPLACE FUNCTION draft_queue_replace(
  p_draft_id UUID,
  p_team_id UUID,
  p_players TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_count INTEGER;
  v_result JSONB;
BEGIN
  -- Shape (22023 — friendly, surfaced as a 400 by the service).
  IF p_draft_id IS NULL OR p_team_id IS NULL OR p_players IS NULL THEN
    RAISE EXCEPTION 'draft_id, team_id and players are required.'
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE(array_length(p_players, 1), 0) > 500 THEN
    RAISE EXCEPTION 'A queue can hold at most 500 players.'
      USING ERRCODE = '22023';
  END IF;
  IF (SELECT COUNT(*) FROM unnest(p_players) AS p(id))
     <> (SELECT COUNT(DISTINCT id) FROM unnest(p_players) AS p(id)) THEN
    RAISE EXCEPTION 'A player can appear in the queue only once.'
      USING ERRCODE = '22023';
  END IF;

  -- Auth guard — the SAME two admit arms as 065's "Own queue write" policy
  -- (real-draft owner with the F51 NOT is_mock exclusion, OR the D103(3)
  -- mock launcher writing the human seat). 42501 keeps the no-leak
  -- convention: forged seat, wrong draft, and nonexistent ids all answer
  -- identically. The RLS policies remain the backstop on the actual
  -- DELETE/INSERT below (SECURITY INVOKER).
  IF NOT (
    EXISTS (
      SELECT 1
      FROM public.teams t
      JOIN public.drafts d ON d.id = p_draft_id
      WHERE t.id = p_team_id
        AND t.league_id = d.league_id
        AND t.owner_id = v_uid
        AND NOT d.is_mock
    )
    OR EXISTS (
      SELECT 1
      FROM public.drafts d
      WHERE d.id = p_draft_id
        AND d.is_mock
        AND d.config->'mock'->>'launched_by' = v_uid::text
        AND d.config->'mock'->>'human_team_id' = p_team_id::text
    )
  ) THEN
    RAISE EXCEPTION 'You do not manage this queue.' USING ERRCODE = '42501';
  END IF;

  -- Per-seat serialization (the concurrency face): concurrent replaces for
  -- the SAME (draft, team) queue take this xact-scoped advisory lock in
  -- turn — the second waits for the first's COMMIT, then sees its rows and
  -- replaces them. Different seats never contend. Taken only AFTER the auth
  -- guard: only a seat's own manager (or mock launcher) can ever hold that
  -- seat's lock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('draft_queue_replace:' || p_draft_id::text || ':' || p_team_id::text, 0)
  );

  -- Unknown ids are a friendly 22023 BEFORE the destructive replace (the
  -- players FK would abort the txn anyway — this just names the ids; queue
  -- rows are advisory, so already-DRAFTED players stay legal, §8.4).
  IF COALESCE(array_length(p_players, 1), 0) > 0 THEN
    SELECT COUNT(*) INTO v_count
    FROM unnest(p_players) AS wanted(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.players pl WHERE pl.id = wanted.id);
    IF v_count > 0 THEN
      RAISE EXCEPTION 'Unknown player id(s): %',
        (SELECT string_agg(wanted.id, ', ')
         FROM unnest(p_players) AS wanted(id)
         WHERE NOT EXISTS (SELECT 1 FROM public.players pl WHERE pl.id = wanted.id))
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- The replace — ONE transaction, RLS-checked row by row (invoker):
  -- a failure anywhere rolls back the delete (the partial-failure face).
  DELETE FROM public.draft_queues
  WHERE draft_id = p_draft_id AND team_id = p_team_id;

  IF COALESCE(array_length(p_players, 1), 0) > 0 THEN
    INSERT INTO public.draft_queues (draft_id, team_id, player_id, rank)
    SELECT p_draft_id, p_team_id, p.id, p.ord
    FROM unnest(p_players) WITH ORDINALITY AS p(id, ord);
  END IF;

  -- THIS call's outcome (not a later writer's): the response truth the
  -- service returns.
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('player_id', q.player_id, 'rank', q.rank)
              ORDER BY q.rank),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.draft_queues q
  WHERE q.draft_id = p_draft_id AND q.team_id = p_team_id;

  RETURN v_result;
END;
$$;

-- Grants: callable by signed-in users (the policies + in-body guard decide
-- WHOSE queue); never by anon. service_role keeps EXECUTE (harness/ops —
-- note auth.uid() is NULL there, so the in-body guard refuses it by design:
-- privileged fixture writes go straight to the table, not through this RPC).
REVOKE ALL ON FUNCTION draft_queue_replace(UUID, UUID, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION draft_queue_replace(UUID, UUID, TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION draft_queue_replace(UUID, UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION draft_queue_replace(UUID, UUID, TEXT[]) TO service_role;
