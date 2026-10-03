-- ============================================================================
-- 178 — "whose queue" is the SEAT, and the commissioner reads another team's
--       Targets through a door (M6 follow-ups F525 + F524; FULL rigour —
--       permissions + receipts) (spec §8.4, §8.7, §10.3, §12.6, §12.12;
--       PROGRESS D452, D474; standing rules (a), (b))
-- ============================================================================
--
-- THE DEFECT (F525, R1339 — measured on the L.E1.38 review). 065's two
-- draft_queues policies ("Own queue read" / "Own queue write") and
-- draft_queue_replace's manager arm (082, kept by 171) admit whoever holds
-- teams.owner_id. For a placeholder or vacated franchise that is the
-- commissioner who created or vacated it (169 / 150 stamp him), so:
--   * he INSERTs / DELETEs / UPDATEs that team's draft_queues rows straight
--     through PostgREST — a commissioner write with NO receipt, while the same
--     act through draft_queue_replace writes one (171);
--   * once demoted he is no commissioner, yet the owner arm still admits him
--     to those queues (table and RPC) and nothing is recorded.
-- draft_place_bid already resolves "whose team" by the seat (league_members),
-- so the two draft-room verbs disagreed.
--
-- THE CHANGE
--   1. Both draft_queues policies: the real-draft arm keys on the SEAT —
--      league_members.user_id = auth.uid() on that team in the draft's
--      league — never teams.owner_id. The D103(3) mock-launcher arm (and the
--      F51 NOT is_mock guard on the seat arm) is unchanged. A commissioner
--      therefore edits another team's queue ONLY through draft_queue_replace,
--      which writes his receipt; the table is the seat's own.
--      Spec §12.6's printed policies are amended to match (v2.16.88 — the
--      fold-back rule).
--   2. draft_queue_replace — CREATE OR REPLACE against its NEWEST definer's
--      FILE TEXT (D137; CLAUDE.md's 073 lesson). Newest definer MEASURED by
--      grep 'FUNCTION[^(]*draft_queue_replace' over 001–177: 082 → 171;
--      172–177 do not define it. Source 171:432-634 (the function block),
--      extracted programmatically (derive_178.py — each substitution asserted
--      to hit once, the reversal asserted byte-identical to the source block);
--      its prosrc md5 5b54fe07ad99a494d3052e376c1e47a7 = the live one on the
--      177 chain (measured) = pgTAP 119 A6's stored literal.
--        H1 (+6 / -0)  a comment before the guard naming the seat rule.
--        H2 (+1 / -1)  the manager arm reads public.league_members m, not
--                      public.teams t.
--        H3 (+3 / -3)  m.team_id = p_team_id / m.league_id = d.league_id /
--                      m.user_id = v_uid (was t.id / t.league_id /
--                      t.owner_id).
--      → prosrc md5 69d64cbdfb4e9cbbab15f6a46fead4a7. pgTAP 126's
--      pg_temp.un178 reverses both substitutions to 171's text. The
--      commissioner's arm (v_commish), the v_visible conjunct (R1338), the
--      receipt / post and the no-op test are byte-identical.
--   3. NEW draft_queue_for_team(p_draft_id, p_team_id) — F48 / F524: the
--      commissioner's READ of another team's Targets (the editor must read
--      them before he changes them). SECURITY DEFINER, search_path '',
--      in-body auth: a commissioner or co-commissioner of a REAL draft's
--      league, on an active franchise of that league; everyone else — a
--      manager (even on his own team: he reads it from the table), a mock,
--      an outsider, no user — 42501 with one message (no leak). A read writes
--      nothing (no receipt — standing rule (b) is about changes). Why a door
--      and not §12.6's "commissioners can read all" as a SELECT policy: the
--      app deploys before this migration is pushed, and on 177 a policy read
--      would answer an EMPTY queue — a plausible-looking empty result
--      (CLAUDE.md) — where a missing door answers PGRST202, which the route
--      names as a 503 (isDoorNotPushed). Spec §12.6's comment is kept
--      ("commissioners can read all") and says it is this door.
--
-- WHAT DOES NOT CHANGE. Nobody who manages a seat loses anything: a seated
-- manager (the normal team: owner_id = seat) reads and writes his queue as
-- before. The commissioner's own seat is his manager act (no receipt, 171).
-- draft_place_bid is untouched (171 already keys on the seat and is live).
-- No table, column, index, trigger, cron or realtime row. Time: none.
--
-- DEPLOY BEFORE PUSH (TD15). The routes that send team_id for another team
-- reach draft_place_bid's p_team_id (171 — live in production since the 171
-- push, so no degrade arm is needed) and draft_queue_replace (unchanged
-- signature). The one new object is draft_queue_for_team: on 177 the
-- read route's call answers PGRST202 and is named as a 503 ("the
-- commissioner's read of another team's Targets isn't available yet").
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   Replaced: policies "Own queue read" / "Own queue write" (DROP + CREATE,
--   same names, same commands); draft_queue_replace (CREATE OR REPLACE,
--   DEFINER, search_path '' unchanged, ACL restated). New: draft_queue_for_team
--   (DEFINER, search_path '', REVOKE PUBLIC / anon, GRANT authenticated +
--   service_role). Typegen: Functions gain draft_queue_for_team.
--   WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
--   `db reset` 001–178 and the full pgTAP run in the PR. D38 — no backfill:
--   queue rows written through the owner arm before 178 stay (they are a
--   team's advisory Targets; the seat now owns them).
-- Rollback = re-apply 065's two policies, 171:432-634 verbatim with its
-- grants, DROP FUNCTION draft_queue_for_team(UUID, UUID).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The draft_queues policies — the seat, not teams.owner_id (F525).
-- ---------------------------------------------------------------------------
DROP POLICY "Own queue read" ON draft_queues;
DROP POLICY "Own queue write" ON draft_queues;

-- A manager sees / edits only his SEAT's queue on a real draft (§12.6 as
-- amended v2.16.88), OR the D103(3) mock launcher the human seat's queue on
-- his mock (065, unchanged). The F51 NOT d.is_mock guard keeps the seat arm
-- off every mock. The commissioner reads another team's queue through
-- draft_queue_for_team and writes it through draft_queue_replace (receipted).
CREATE POLICY "Own queue read" ON draft_queues FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM league_members m
      JOIN drafts d ON d.id = draft_queues.draft_id
      WHERE m.team_id = draft_queues.team_id
        AND m.league_id = d.league_id
        AND m.user_id = auth.uid()
        AND NOT d.is_mock
    )
    OR EXISTS (
      SELECT 1 FROM drafts d
      WHERE d.id = draft_queues.draft_id
        AND d.is_mock
        AND d.config->'mock'->>'launched_by' = auth.uid()::text
        AND d.config->'mock'->>'human_team_id' = draft_queues.team_id::text
    )
  );
CREATE POLICY "Own queue write" ON draft_queues FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM league_members m
      JOIN drafts d ON d.id = draft_queues.draft_id
      WHERE m.team_id = draft_queues.team_id
        AND m.league_id = d.league_id
        AND m.user_id = auth.uid()
        AND NOT d.is_mock
    )
    OR EXISTS (
      SELECT 1 FROM drafts d
      WHERE d.id = draft_queues.draft_id
        AND d.is_mock
        AND d.config->'mock'->>'launched_by' = auth.uid()::text
        AND d.config->'mock'->>'human_team_id' = draft_queues.team_id::text
    )
  );

-- ---------------------------------------------------------------------------
-- 2. draft_queue_replace — 171:432-634's FILE TEXT (D137), 3 hunks (+10 / -4).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_queue_replace(
  p_draft_id UUID,
  p_team_id UUID,
  p_players TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER   -- 171/L.E1.38: was INVOKER — the guard below is now the whole auth law (the receipt seam is not a client's to call)
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_count INTEGER;
  v_result JSONB;
  v_draft     public.drafts;       -- 171
  v_commish   BOOLEAN := FALSE;    -- 171: the commissioner edits a team he does not manage
  v_old       TEXT[];              -- 171: the queue before, for the no-op test (never recorded)
  v_team_name TEXT;                -- 171
  v_visible   BOOLEAN := FALSE;    -- 171 (R1338): the drafts read policy, re-stated
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
  --
  -- 171/L.E1.38 (F521; standing rule (a); spec §8.4, §8.7, §10.3) — THE
  -- COMMISSIONER'S ARM, and the posture it forces. A commissioner or
  -- co-commissioner may replace the queue of any active franchise of the
  -- draft's league that is not his own seat — the act §8.4 gives its
  -- manager, done for the team (an absent manager's Targets are what his
  -- timeouts draft from). A real draft only: a mock has no commissioner
  -- (§8.8), so its one admit stays the launcher's. The arm writes a receipt
  -- and a room post, and the receipt seam is not a client's to call, so the
  -- function now runs SECURITY DEFINER: THIS guard is the whole auth law.
  -- The two arms below are 065's two queue policies re-derived (the owner
  -- arm here is stricter — the league-consistency conjunct, 031). Under
  -- INVOKER they ALSO ran behind the drafts read policy ("Drafts viewable by
  -- league members": a league member, or the launcher of a league-less
  -- mock), because each arm reads public.drafts; a DEFINER body does not,
  -- so that predicate is re-stated here as v_visible and ANDed onto both
  -- arms (R1338) — a user who left the league (still teams.owner_id, or
  -- still the launcher of a league mock) is refused as he was under
  -- INVOKER. With it, a manager or a mock launcher is admitted precisely as
  -- before. The comments below that say "invoker" / "RLS-checked" describe
  -- the pre-171 posture; 065's policies still govern every direct table
  -- read and write.
  -- Validity is unchanged for him: the same shape rules (500 players, no
  -- duplicate, known ids) run before anything is touched.
  SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  v_commish := COALESCE(
    v_draft.id IS NOT NULL
    AND NOT v_draft.is_mock
    AND public.is_league_commish(v_draft.league_id)
    AND EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = p_team_id AND t.league_id = v_draft.league_id
        AND t.status <> 'retired'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.league_members m
      WHERE m.league_id = v_draft.league_id AND m.user_id = v_uid
        AND m.team_id = p_team_id
    ), FALSE);
  v_visible := EXISTS (
    SELECT 1 FROM public.drafts d
    WHERE d.id = p_draft_id
      AND (public.is_league_member(d.league_id)
           OR (d.league_id IS NULL AND d.is_mock
               AND ((d.config -> 'mock') ->> 'launched_by') = v_uid::text))
  );
  -- 178 (F525): the manager arm is the SEAT (league_members.user_id on the
  -- team), never teams.owner_id: a placeholder or vacated team's owner_id is
  -- the commissioner who made or vacated it (169 / 150), so the owner arm
  -- admitted him (and, once demoted, kept admitting him) with no receipt.
  -- Another team's queue is reached only through v_commish above, which
  -- writes the receipt.
  IF NOT v_commish AND (NOT v_visible OR NOT (
    EXISTS (
      SELECT 1
      FROM public.league_members m   -- 178 (F525): the seat, never teams.owner_id
      JOIN public.drafts d ON d.id = p_draft_id
      WHERE m.team_id = p_team_id
        AND m.league_id = d.league_id
        AND m.user_id = v_uid
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
  )) THEN
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
  -- 171: the commissioner arm reads the queue it replaces, under the seat
  -- lock, to tell a real change from the same queue again (D336 part 3).
  IF v_commish THEN
    SELECT COALESCE(array_agg(q.player_id ORDER BY q.rank, q.id), '{}'::text[])
    INTO v_old
    FROM public.draft_queues q
    WHERE q.draft_id = p_draft_id AND q.team_id = p_team_id;
  END IF;

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

  -- 171/L.E1.38 (F521) — THE RECEIPT AND THE POST, on the commissioner arm
  -- only, and only when the queue changed (the same players in the same
  -- order is a no-op: nothing posted, nothing receipted — standing rule
  -- (b)). The log is member-readable, so a receipt NEVER carries the queue
  -- (TD9): only how many Targets there were and are, how many were added
  -- and removed, and whether the kept ones were re-ordered.
  IF v_commish AND v_old IS DISTINCT FROM p_players THEN
    SELECT t.name INTO v_team_name FROM public.teams t WHERE t.id = p_team_id;
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (v_draft.league_id, v_uid,
            'Targets for ' || COALESCE(v_team_name, 'a team') || ' updated by commissioner '
            || public.draft_actor_name() || '.',
            'draft:' || p_draft_id::text, TRUE);
    PERFORM public.draft_commish_receipt_internal(
      v_draft.league_id, v_draft.is_mock, 'draft_queue_replace', 'draft_set_queue', 'team',
      p_team_id::text, NULL,
      jsonb_build_object('targets', COALESCE(array_length(v_old, 1), 0)),
      jsonb_build_object(
        'targets', COALESCE(array_length(p_players, 1), 0),
        'added', (SELECT count(*)::int FROM unnest(p_players) AS n(id) WHERE NOT (n.id = ANY (v_old))),
        'removed', (SELECT count(*)::int FROM unnest(v_old) AS o(id) WHERE NOT (o.id = ANY (p_players))),
        'reordered',
          (SELECT COALESCE(array_agg(n.id ORDER BY n.ord), '{}'::text[])
           FROM unnest(p_players) WITH ORDINALITY AS n(id, ord) WHERE n.id = ANY (v_old))
          IS DISTINCT FROM
          (SELECT COALESCE(array_agg(o.id ORDER BY o.ord), '{}'::text[])
           FROM unnest(v_old) WITH ORDINALITY AS o(id, ord) WHERE o.id = ANY (p_players))),
      jsonb_build_object(
        'draft_id', p_draft_id,
        'team_name', v_team_name,
        'affected_team_ids', jsonb_build_array(p_team_id)),
      p_team_id);  -- acting_as: the team whose Targets he set (§10.3, D451)
  END IF;

  RETURN v_result;
END;
$$;

-- The 082 / 171 grants restated (CREATE OR REPLACE keeps the ACL).
REVOKE ALL ON FUNCTION draft_queue_replace(UUID, UUID, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION draft_queue_replace(UUID, UUID, TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION draft_queue_replace(UUID, UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION draft_queue_replace(UUID, UUID, TEXT[]) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. draft_queue_for_team — the commissioner's read of a team's Targets
--    (F48 / F524; §12.6 "commissioners can read all").
-- ---------------------------------------------------------------------------
CREATE FUNCTION draft_queue_for_team(
  p_draft_id UUID,
  p_team_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER   -- the queue is private to its seat (065 / 178 RLS); this door is the commissioner's read
SET search_path = ''
AS $$
DECLARE
  v_draft  public.drafts;
  v_result JSONB;
BEGIN
  SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  -- One refusal for every miss (no leak): no user, no draft, a mock (no
  -- commissioner — §8.8), not a commissioner / co-commissioner of the
  -- draft's league, or not an active franchise of that league.
  IF auth.uid() IS NULL
     OR v_draft.id IS NULL
     OR v_draft.is_mock
     OR NOT public.is_league_commish(v_draft.league_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.teams t
       WHERE t.id = p_team_id AND t.league_id = v_draft.league_id
         AND t.status <> 'retired'
     ) THEN
    RAISE EXCEPTION 'draft_queue_for_team: only a commissioner can read another team''s Targets (§12.6)'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('player_id', q.player_id, 'rank', q.rank)
              ORDER BY q.rank, q.id),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.draft_queues q
  WHERE q.draft_id = p_draft_id AND q.team_id = p_team_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION draft_queue_for_team(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION draft_queue_for_team(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION draft_queue_for_team(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION draft_queue_for_team(UUID, UUID) TO service_role;
