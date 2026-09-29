-- ============================================================================
-- 163_waiver_order_from_draft.sql — the rolling waiver order is STORED from
-- the moment the draft ends, not first written by the first waiver run
-- (task L.D2.18, FULL rigour — the order decides who gets players and which
-- equal FAAB bid wins; PROGRESS F484 discharged, D427).
-- Spec §13.2 "Priority before there are standings" (Q72: rolling priority
-- starts from REVERSE DRAFT ORDER and a team moves to the back only when it
-- wins a claim; v2.16.69: equal FAAB bids go by that order by default),
-- §7.3.4 row `faab_tiebreaker`; F434 (RULED 2026-09-28: an auction league's
-- reverse draft order is the reverse NOMINATION order, `drafts.draft_order`).
--
-- THE RULING (Chris, 2026-09-29, in chat): "in my leagues the waiver
-- priority starts as soon as the draft is over and never resets. it just
-- keeps updating based on who used their waiver" — and equal FAAB bids go by
-- that same rolling order (D424).
--
-- Numbering: reserved by the orchestrator and measured at build time (D161)
-- — `ls supabase/migrations | tail -1` → 162_trade_preview.sql,
-- `ls supabase/tests | tail -1` → 110_trade_preview.sql; so 163 / pgTAP 111.
-- Reaches production by `npx supabase db push` only. MEASURED 2026-09-29
-- (read-only, Supabase MCP): the hosted database's newest applied migration
-- is 162 — so the push debt is 163 alone.
--
-- THE DEFECT (F484, widened by R1271). The order exists from the draft's
-- end and decides the first run, but `league_members.waiver_priority` was
-- written only BY that run (150 → 157 → 160: a persisting league with no
-- stored order starts from reverse draft order and writes the rolled order
-- back). So no seat showed "Waiver priority #N" until then, and a FAAB
-- league — where the order now breaks every tied bid — never showed it.
--
-- MEASURED (where the order is decided and written):
--   * Draft completion has ONE writer, `draft_complete_internal`
--     (110:821-897, the chain head; 086:394 before it): the snake
--     `draft_apply_pick_internal` (086:518) and every auction completion
--     (the tick 092:3642, the award 093:534, `draft_end` 087:1023,
--     `draft_force_pick` 100:2271 — call sites as grep finds them, later
--     re-creations keep the call) delegate to it. Its non-mock arm flips
--     `leagues.status` to 'in_season' in the completing transaction.
--   * The processor's first-run seed: `process_waivers_internal`
--     (160:165-720, chain head) reads `v_rolling` = the seats'
--     `waiver_priority` when the order persists (`v_persists`, 160:330-331),
--     and the resolver (`waiver_resolve_run_internal`, 150; its TS twin
--     `startOrder`) starts from THAT map whenever it is non-null — only a
--     NULL map falls back to reverse draft order. So the processor ALREADY
--     continues from a stored order and never re-seeds over it. It is NOT
--     replaced here (zero D137 hunks; pgTAP 111 A pins its prosrc md5 to
--     160's stored literal).
--   * Seat changes never touch the column: takeover / vacate / leave /
--     seat-claim / assign fill the SAME seat row in place (146's
--     `seat_league_member_internal` UPDATE; `remove_manager`, 150), and
--     retire-and-succeed re-points the seat row to the successor in place
--     (120:569) — no `DELETE FROM league_members` exists in the chain. So a
--     team's place carries with the seat exactly like its FAAB balance
--     (145's column comment; pgTAP 111 F proves it through the real verbs).
--   * `draft_reset` refuses a COMPLETE draft (150:2633-2637), so a stored order
--     is never orphaned by a reset.
--
-- WHAT THIS MIGRATION DOES
--   §1 `waiver_priority_seed_internal(p_league_id)` — PLAIN, search_path '',
--      REVOKEd. Stores the order the processor's first run would start from:
--      the latest complete NON-mock draft's `draft_order` (160:367-380's
--      exact selection — `ORDER BY completed_at DESC NULLS LAST, id`), each
--      franchise mapped through its successor chain to the live one, then
--      REVERSED; 1 = first. It writes ONLY when (a) the league is
--      `in_season` / `playoffs` (the statuses the processor runs in), (b)
--      the order PERSISTS — `waiver_type = rolling_priority`, or `faab` with
--      `faab_tiebreaker = rolling_priority` (no stored key ⇒ the 160
--      default, rolling) — the processor's own `v_persists`, (c) NO seat of
--      the league stores a priority yet (never re-seed over an order, which
--      would be the reset the ruling forbids), (d) a complete non-mock draft
--      exists, and (e) the mapped list orders EXACTLY the league's active
--      (non-retired) franchises, each with its seat row — the resolver's
--      own `assertPermutation` precondition. Every "no" is answered BY NAME
--      in the returned JSON (`not_in_season` / `not_rolling` / `kept` /
--      `no_draft` / `unseedable` + why); an `unseedable` league is left
--      exactly as before 163 (no stored order) and its first run judges it
--      as it always did (the resolver refuses that input by name and the
--      league's run is refused in its own subtransaction, 150 F421(g)). The
--      write is asserted to touch exactly the seats it chose.
--   §2 `leagues_waiver_priority_seed_trg()` + `trg_leagues_waiver_priority_
--      seed` — SECURITY DEFINER (writes `league_members`, which no client
--      role may), search_path '', REVOKEd; AFTER UPDATE OF status,
--      waiver_type, settings ON leagues, WHEN the new row is in season /
--      playoffs and not deleted; ENABLE ALWAYS (R616 — a replica-mode
--      session must not skip it). WHY A TRIGGER rather than a PERFORM in
--      `draft_complete_internal`: the order must be stored whenever a
--      league with a complete draft BECOMES rolling, and three writers make
--      that true — draft completion (the status flip, snake and auction
--      alike), a commissioner's in-season `waiver_type` / `faab_tiebreaker`
--      change (`commish_change_setting_internal`, 149), and any later writer
--      of those columns. The trigger covers every one with no body replaced;
--      the seed is idempotent (condition (c)), so the extra firings the
--      schedule write-back (`league_generate_schedule` updates `settings`
--      inside the same completion) or an unrelated setting change cause are
--      `kept` no-ops. It never raises for a business reason, so it can
--      never fail a draft's last pick or a setting change; a broken
--      invariant (the write count) does raise.
--   §3 `waiver_priority_backfill_internal()` + ONE call — every league
--      already past its draft with no stored order is seeded exactly as the
--      processor would have seeded it (§1 is that computation). Idempotent:
--      a second call seeds nothing. The NOTICE names every league by
--      outcome. Hosted, measured 2026-09-29 (read-only): 1 live league —
--      in_season, FAAB, `faab_tiebreaker = rolling_priority` (160 pushed),
--      12 active franchises, 12 seats, 0 stored priorities, 0 waiver claims,
--      0 waiver runs, 1 complete non-mock draft whose 12-long `draft_order`
--      names only live franchises; next run 2026-09-30 07:00Z ⇒ `seeded`
--      (12 seats). If that run settles before the push, it seeds the same
--      order itself (no claims ⇒ nobody moves) and the backfill reports it
--      `kept`. Local before the reset: 0 leagues.
--
-- DEPLOY BEFORE PUSH. Merging deploys the UI at once (Vercel); the database
-- takes this file at Chris's `db push`. On 162 the app reads the same
-- column it reads today: with no stored order it says what decides
-- ("starts from reverse draft order") and shows no number — never a wrong
-- one — and the first run still seeds it. Nothing in the app calls the new
-- functions.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   Replaces NOTHING (zero CREATE OR REPLACE of an existing function — the
--   D137 derivation is vacuous; pgTAP 111 A pins the processor's and
--   `draft_complete_internal`'s prosrc md5s as stored literals to prove
--   it). New: two PLAIN helpers (search_path '', REVOKEd from PUBLIC /
--   anon / authenticated — called by the trigger, this file and pgTAP 111
--   only), one SECURITY DEFINER trigger function (search_path '', in-body
--   gate = the WHEN clause + the helper's own conditions; REVOKEd — only
--   the trigger calls it), one trigger. No table, column, policy, index,
--   grant or cron row. Lock order: the leagues row first (the helper takes
--   it FOR UPDATE — a same-transaction no-op under the trigger, whose
--   UPDATE already holds it), then `league_members` — the processor's
--   order (160:236-240 then 390-392). Time: none read. Typegen: the two helpers
--   join `Functions` (additive; alias block re-appended). Realtime: none.
--   WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
--   `db reset` 001–163 and the full pgTAP run in the PR. D38 — the backfill
--   is §3, stated above.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. waiver_priority_seed_internal — store the order the first run would
--    start from (conditions (a)-(e) above).
-- ---------------------------------------------------------------------------
CREATE FUNCTION waiver_priority_seed_internal(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league    public.leagues;
  v_type      TEXT;
  v_tb        TEXT;
  v_draft_raw JSONB;
  v_x         JSONB;
  v_live      public.teams;
  v_depth     INTEGER;
  v_mapped    TEXT[] := '{}';
  v_order     TEXT[];
  v_active    TEXT[];
  v_seated    INTEGER;
  v_cnt       INTEGER;
BEGIN
  IF p_league_id IS NULL THEN
    RAISE EXCEPTION 'waiver_priority_seed: p_league_id is required' USING ERRCODE = '22023';
  END IF;

  -- the league row first (the processor's lock order)
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'skipped',
      'why', 'league_not_found — no live league has this id');
  END IF;

  -- (a) the statuses the processor runs in
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'not_in_season',
      'why', 'not_in_season — the league is ' || v_league.status || '; the order is stored when the draft completes');
  END IF;

  -- (b) the processor's own v_persists (160:330-331), the same fallback
  v_type := COALESCE(v_league.waiver_type, 'faab');
  v_tb := COALESCE(v_league.settings ->> 'faab_tiebreaker', 'rolling_priority');
  IF NOT (v_type = 'rolling_priority' OR (v_type = 'faab' AND v_tb = 'rolling_priority')) THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'not_rolling',
      'why', 'not_rolling — waiver type ' || v_type
             || CASE WHEN v_type = 'faab' THEN ' with tiebreaker ' || v_tb ELSE '' END
             || ' decides by the standings (or has no waivers); no order is stored');
  END IF;

  -- (c) never re-seed over a stored order
  SELECT count(*)::int INTO v_cnt
  FROM public.league_members m
  WHERE m.league_id = p_league_id AND m.waiver_priority IS NOT NULL;
  IF v_cnt > 0 THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'kept',
      'why', 'kept — ' || v_cnt || ' seat(s) already store the order; it rolls with each waiver run and is never re-seeded');
  END IF;

  -- (d) the round-1 order as drafted — 160:367-380's selection, exactly
  SELECT d.draft_order INTO v_draft_raw
  FROM public.drafts d
  WHERE d.league_id = p_league_id AND NOT d.is_mock AND d.status = 'complete'
  ORDER BY d.completed_at DESC NULLS LAST, d.id
  LIMIT 1;
  IF NOT FOUND OR v_draft_raw IS NULL OR jsonb_typeof(v_draft_raw) <> 'array' THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'no_draft',
      'why', 'no_draft — the league has no complete draft with a draft order; its first waiver run decides the order');
  END IF;
  FOR v_x IN SELECT e FROM jsonb_array_elements(v_draft_raw) WITH ORDINALITY AS a(e, o) ORDER BY o LOOP
    SELECT t.* INTO v_live FROM public.teams t WHERE t.id = (v_x #>> '{}')::uuid;
    v_depth := 0;
    WHILE FOUND AND v_live.status = 'retired' AND v_live.successor_team_id IS NOT NULL AND v_depth < 64 LOOP
      SELECT t.* INTO v_live FROM public.teams t WHERE t.id = v_live.successor_team_id;
      v_depth := v_depth + 1;
    END LOOP;
    v_mapped := v_mapped || COALESCE(v_live.id::text, v_x #>> '{}');
  END LOOP;
  SELECT COALESCE(array_agg(u.t ORDER BY u.o DESC), '{}') INTO v_order
  FROM unnest(v_mapped) WITH ORDINALITY AS u(t, o);          -- REVERSE draft order

  -- (e) exactly the active franchises, each with its seat (assertPermutation)
  SELECT COALESCE(array_agg(t.id::text ORDER BY t.id::text COLLATE "C"), '{}') INTO v_active
  FROM public.teams t WHERE t.league_id = p_league_id AND t.status <> 'retired';
  IF cardinality(v_order) <> (SELECT count(DISTINCT u) FROM unnest(v_order) u)
     OR (SELECT array_agg(u ORDER BY u COLLATE "C") FROM unnest(v_order) u) IS DISTINCT FROM v_active
     OR cardinality(v_active) = 0 THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'unseedable',
      'why', 'unseedable — the draft order (' || cardinality(v_order) || ' entries) does not list exactly the league''s '
             || cardinality(v_active) || ' active franchises; nothing stored, the first waiver run judges it',
      'draft_order', to_jsonb(v_order), 'active', to_jsonb(v_active));
  END IF;
  SELECT count(*)::int INTO v_seated
  FROM public.league_members m
  WHERE m.league_id = p_league_id AND m.team_id::text = ANY (v_active);
  IF v_seated <> cardinality(v_active) THEN
    RETURN jsonb_build_object('league_id', p_league_id, 'status', 'unseedable',
      'why', 'unseedable — ' || v_seated || ' of ' || cardinality(v_active)
             || ' active franchises have a seat row; nothing stored, the first waiver run judges it');
  END IF;

  UPDATE public.league_members m
  SET waiver_priority = a.o::int
  FROM unnest(v_order) WITH ORDINALITY AS a(t, o)
  WHERE m.league_id = p_league_id AND m.team_id = a.t::uuid;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> cardinality(v_order) THEN
    RAISE EXCEPTION 'waiver_priority_seed: storing league %''s order wrote % of % seats — refusing', p_league_id, v_cnt, cardinality(v_order)
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('league_id', p_league_id, 'status', 'seeded',
    'source', 'reverse_draft_order', 'order', to_jsonb(v_order),
    'why', 'seeded — the order is reverse draft order from the draft''s end (Q72); a team moves to the back only when it wins a claim');
END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_priority_seed_internal(UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The trigger — the order is stored the moment a league with a complete
--    draft is in season with a rolling order (draft completion, or a switch
--    to a rolling order later).
-- ---------------------------------------------------------------------------
CREATE FUNCTION leagues_waiver_priority_seed_trg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- The WHEN clause restates the status gate; the helper decides the rest
  -- and answers every "no" by name without raising (§2 in the banner).
  PERFORM public.waiver_priority_seed_internal(NEW.id);
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION leagues_waiver_priority_seed_trg() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_leagues_waiver_priority_seed
  AFTER UPDATE OF status, waiver_type, settings ON leagues
  FOR EACH ROW
  WHEN (NEW.status IN ('in_season', 'playoffs') AND NEW.deleted_at IS NULL)
  EXECUTE FUNCTION leagues_waiver_priority_seed_trg();
-- R616: a replica-mode session must not skip it.
ALTER TABLE leagues ENABLE ALWAYS TRIGGER trg_leagues_waiver_priority_seed;

-- ---------------------------------------------------------------------------
-- 3. The backfill — every league already past its draft, seeded exactly as
--    its first run would have (§1), each outcome named.
-- ---------------------------------------------------------------------------
CREATE FUNCTION waiver_priority_backfill_internal()
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_l   RECORD;
  v_r   JSONB;
  v_out JSONB := '{}'::jsonb;
BEGIN
  FOR v_l IN
    SELECT l.id FROM public.leagues l
    WHERE l.deleted_at IS NULL AND l.status IN ('in_season', 'playoffs')
    ORDER BY l.id
  LOOP
    v_r := public.waiver_priority_seed_internal(v_l.id);
    v_out := jsonb_set(v_out, ARRAY[v_r ->> 'status'],
                       COALESCE(v_out -> (v_r ->> 'status'), '[]'::jsonb) || to_jsonb(v_l.id::text));
    IF v_r ->> 'status' = 'unseedable' THEN
      v_out := jsonb_set(v_out, '{unseedable_why}',
                         COALESCE(v_out -> 'unseedable_why', '{}'::jsonb) || jsonb_build_object(v_l.id::text, v_r ->> 'why'));
    END IF;
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE EXECUTE ON FUNCTION waiver_priority_backfill_internal() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_r JSONB;
BEGIN
  v_r := public.waiver_priority_backfill_internal();
  RAISE NOTICE '163 waiver order backfill: %', v_r;
END;
$$;
