-- ============================================================================
-- Autopilot OFF by default + the commissioner's per-team switch — pgTAP 087
-- (task L.E1.22; migration 139; spec §7.2 Kick/replace, §7.2.1(c), §10.1
-- Membership, §12.12, §23 `lineup-lock` (v2.16.42 Q63 ruling note); PROGRESS
-- Q63 (RULED 2026-09-27), F380 / F392, D336 / D339 / D350 / D354 / D356 /
-- D371(7) / D376; tasks-M6A §6 L.E1.22 and §4 rules 11-15).
--
-- Numbering: pgTAP head measured `086_autopilot_q62_order.sql` by
-- `ls supabase/tests/ | tail -1` at task time ⇒ 087.
--
-- THIS SUITE HAS ITS OWN FIXTURE LEAGUES (`b7…`, teams `c7…`, users `9c…`).
--
-- Falsifiability notes (tasks-M1 §4.3; tasks-M6A §4 rules 14-15):
--   * THE DEFAULT IS MEASURED, NOT ASSUMED: a seat minted by the REAL
--     `add_placeholder_seat` (063) carries no switch row (§B2), and the verb's
--     own `previous` reads FALSE for it.
--   * THE OFF CELL HAS A FILLABLE PREMISE (rule 14(c)): the OFF seat holds an
--     empty stored map beside two healthy, unlocked, eligible players (§E0) —
--     and §E6 flips the SAME seat ON through the verb and ticks at the SAME
--     instant: it fills. So "not filled" in §E1 is the switch, never an
--     unfillable fixture.
--   * NO CELL INFERS EMPTINESS (rule 15): the OFF seat is NAMED in the tick's
--     `commissioner_managed[]` (§E2), and a pass that saw only OFF seats says
--     so in `autopilot_reason` (§E8).
--   * STORED LITERALS: every md5, every instant (the tick instant P =
--     2026-09-25 12:00Z; nobody's game has kicked off at P).
--   * BREAK PROBES (rule 14), shown red by name in the PR then restored with
--     `diff -q`: drop the switch branch in the tick (§E1 reds); drop the
--     OFF-seat report (§E2 reds); revert F392's candidate scoping in the
--     chooser (§F3 reds).
--   * The verb runs as each role through `request.jwt.claims`; the tick and
--     the fixtures run as postgres (`auth.uid()` NULL — the tick's own
--     precondition).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(76);

-- ---------------------------------------------------------------------------
-- A. Form pins
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s', column_name, data_type, is_nullable), ' ' order by ordinal_position)
   from information_schema.columns where table_schema = 'public' and table_name = 'team_autopilot'),
  'team_id:uuid:NO is_on:boolean:NO set_at:timestamp with time zone:NO',
  'A1 team_autopilot is (team_id, is_on, set_at) — NO ROW = OFF, so there is no DEFAULT to get wrong and nothing to backfill (D371(7))');
select ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.team_autopilot'::regclass)
  and (select c.relrowsecurity from pg_class c where c.oid = 'public.commish_autopilot_actions'::regclass),
  'A2 RLS is ENABLED on both new tables');
select is(
  (select string_agg(format('%s/%s/%s', tablename, cmd, array_to_string(roles, ',')), ' ' order by tablename, policyname)
   from pg_policies where schemaname = 'public' and tablename in ('team_autopilot', 'commish_autopilot_actions')),
  'team_autopilot/SELECT/authenticated',
  'A3 exactly ONE policy across the two tables — a SELECT for authenticated on the switch; ZERO write policies for any role, and ZERO policies on the ledger (D350)');
select ok(
  not has_table_privilege('anon', 'public.team_autopilot', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.team_autopilot', 'TRUNCATE')
  and not has_table_privilege('anon', 'public.commish_autopilot_actions', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.commish_autopilot_actions', 'TRUNCATE')
  and has_table_privilege('service_role', 'public.team_autopilot', 'TRUNCATE'),
  'A4 TRUNCATE revoked from anon + authenticated on BOTH tables, per role (RLS does not cover TRUNCATE — 081 §A / D350); service_role keeps it (133''s posture)');
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p where p.oid = 'public.commish_set_autopilot_internal(uuid,uuid,boolean,uuid,timestamptz,text)'::regprocedure)
  and not has_function_privilege('anon', 'public.commish_set_autopilot_internal(uuid,uuid,boolean,uuid,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.commish_set_autopilot_internal(uuid,uuid,boolean,uuid,timestamptz,text)', 'EXECUTE')
  and not exists (
    select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.commish_set_autopilot_internal(uuid,uuid,boolean,uuid,timestamptz,text)'::regprocedure
      and a.privilege_type = 'EXECUTE' and a.grantee = 0),
  'A5 the internal is PLAIN with search_path='''' and TRIPLE-REVOKEd (PUBLIC, anon, authenticated)');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p where p.oid = 'public.commish_set_autopilot(uuid,uuid,boolean,text,uuid)'::regprocedure)
  and not has_function_privilege('anon', 'public.commish_set_autopilot(uuid,uuid,boolean,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.commish_set_autopilot(uuid,uuid,boolean,text,uuid)', 'EXECUTE')
  and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('commish_set_autopilot', 'commish_set_autopilot_internal')) = 2,
  'A6 the door is SECURITY DEFINER with search_path='''', REVOKEd from anon, EXECUTE for authenticated (the in-body gate is the authorization), one overload each');
select is(
  (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_lock_tick'),
  '540946257b7f6b2f2739e4d27f5cf584',
  'A7 lineup_lock_tick is 139''s FILE TEXT (prosrc md5, a stored literal)');
select is(
  (select md5(replace(replace(replace(replace(replace(p.prosrc,
  E'  -- 139 (L.E1.22, Q63 RULED): the per-team switch. An unmanaged seat whose\n  -- switch is OFF — the DEFAULT — is COMMISSIONER-MANAGED: materialized (D354)\n  -- but never filled, and NAMED here rather than read as a quiet zero.\n  v_ap_cm          INTEGER := 0;   -- unmanaged seats left alone because the switch is OFF\n  v_ap_cm_list     JSONB := \'[]\'::jsonb;\n',
  E''),
  E'                   EXISTS (SELECT 1 FROM public.league_members m WHERE m.team_id = t.id) AS has_member,\n                   -- 139 (L.E1.22, Q63): the commissioner\'s per-team switch —\n                   -- NO ROW IS OFF (the ruled default; no backfill).\n                   COALESCE((SELECT sw.is_on FROM public.team_autopilot sw WHERE sw.team_id = t.id), FALSE) AS autopilot_on\n',
  E'                   EXISTS (SELECT 1 FROM public.league_members m WHERE m.team_id = t.id) AS has_member\n'),
  E'            END IF;\n\n            -- 139 (L.E1.22, Q63 RULED 2026-09-27): "the default would be the\n            -- commissioner has to manage the team, but give the [commissioner]\n            -- a button that lets them put the team on autopilot." A seat whose\n            -- switch is OFF is left EXACTLY as the carry (or the commissioner)\n            -- left it — never filled, never substituted — and it is NAMED, so\n            -- an empty slot there reads as the ruled state ("that is fine"),\n            -- never as autopilot having silently done nothing. It still passed\n            -- the materialize step above (D354): a seat with NO row would hold a\n            -- total_points week pending for ever (the worker writes no\n            -- provisional row without one — score-week-worker.ts step (6b) —\n            -- so week_results_pending_internal reports it), and a lineup row is\n            -- what the commissioner\'s own override edits.\n            IF NOT v_ap.autopilot_on THEN\n              v_ap_cm := v_ap_cm + 1;\n              v_ap_cm_list := v_ap_cm_list || jsonb_build_object(\n                \'league_id\', v_lg.id, \'team_id\', v_ap.team_id, \'week\', v_current,\n                \'reason\', \'unmanaged_autopilot_off\',\n                \'why\', \'unmanaged, autopilot off — commissioner-managed (Q63, ruled 2026-09-27): the seat has no manager and the commissioner has not switched autopilot on, so it plays the lineup it has and an empty slot scores zero\',\n                \'materialized\', v_ap.lineup_id IS NULL);\n              CONTINUE;\n',
  E''),
  E'    -- 139 (L.E1.22, Q63): every unmanaged seat left alone because its switch\n    -- is OFF, BY NAME — the commissioner manages it.\n    \'commissioner_managed\', v_ap_cm_list,\n',
  E''),
  E'      -- 139 (L.E1.22, Q63): the pass evaluated NO seat because every unmanaged\n      -- seat it reached has its switch OFF. Ahead of the D339 decline arm:\n      -- with an OFF seat present, "every unmanaged-looking seat was declined"\n      -- would be false (`skipped[]` still names each declined team).\n      WHEN v_ap_seats = 0 AND v_ap_cm > 0\n        THEN \'every_unmanaged_seat_commissioner_managed_autopilot_off\'\n',
  E''))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_lock_tick'),
  '2040f93b901c6224e39a973fc958f1a0',
  'A7b …and those FIVE hunks are the WHOLE change (D137): the prosrc with each reversed is 138''s md5 byte for byte — arms (a) / (b), the kill switch, the D339 decline, the materialize and the write are untouched');
-- RE-PINNED BY L.E1.25 (migration 142, Q68 — additive, R992): 142 replaces
-- the chooser with FOUR hunks against 139's file text (pass 1b). The live
-- prosrc's md5 is pinned by pgTAP 090 §A; here 142's four hunks are REVERSED
-- first, so A8 / A8b keep proving exactly what they proved: 139's text is
-- intact beneath 142, and 138's beneath that.
select is(
  (select md5(replace(replace(replace(replace(p.prosrc,
  E'  -- 142 (L.E1.25, Q68 RULED): pass 1b — a Doubtful replacement for a BLOCKED\n  -- starter nobody healthy replaced.\n  v_defer       JSONB := \'{}\'::jsonb;        -- slot key → vacated BLOCKED starter with no healthy replacement\n  v_dslots      JSONB;                       -- pass 1b\'s slots: exactly those keys\n  v_players_d   JSONB := \'[]\'::jsonb;        -- pass 1b\'s candidates: the unseated Doubtful tail\n  v_fit_d       JSONB;\n  v_d_in        TEXT[] := ARRAY[]::text[];   -- Doubtful men pass 1b seated (fixed in pass 2)\n',
  E''),
  E'      -- 142 (L.E1.25, Q68 RULED 2026-09-27 — "yes, swap in the doubtful"): a\n      -- vacated starter who is BLOCKED (on bye, or OUT / IR / PUP / NFI /\n      -- Suspended) and whose key nobody healthy took is NOT restored yet — pass\n      -- 1b below offers his key to the Doubtful tail first. A vacated DOUBTFUL\n      -- starter is restored here as before: never one Doubtful for another.\n      IF COALESCE((v_kick -> v_pid ->> \'on_bye\')::boolean, FALSE)\n         OR COALESCE((v_by_pid -> v_pid ->> \'designation\') IN (\'OUT\', \'IR\', \'PUP\', \'NFI\', \'Suspended\'), FALSE) THEN\n        v_defer := v_defer || jsonb_build_object(v_key, v_pid);\n        CONTINUE;\n      END IF;\n',
  E''),
  E'  -- PASS 1b — 142 (L.E1.25, Q68 RULED 2026-09-27: "yes, swap in the\n  -- doubtful"). When no healthy, unlocked, eligible replacement exists, a\n  -- DOUBTFUL one replaces a starter who is OUT / on bye. The contest is\n  -- exactly the deferred BLOCKED keys (never an empty slot — pass 2 owns\n  -- those, unchanged) and its candidates are the Doubtful tail in Q62 order,\n  -- minus every man already staying where he is — so a restored Doubtful\n  -- starter is never moved to another key (never one Doubtful for another).\n  -- A locked man is never a candidate (the pool loop sent him to\n  -- skipped_locked[]) and a locked starter was never vacated (D338). The\n  -- Doubtful tail is a preference under BOTH `allow_illegal_lineups` values\n  -- (a Doubtful start is legal, 114:596), so this runs under both — which is\n  -- what restores production\'s (125) swap in a league that forbids illegal\n  -- lineups (R1123). A deferred key no Doubtful man takes is restored exactly\n  -- as Q63\'s clause restores it.\n  IF v_defer <> \'{}\'::jsonb THEN\n    SELECT COALESCE(jsonb_agg(t.s ORDER BY t.ord), \'[]\'::jsonb)\n    INTO v_dslots\n    FROM jsonb_array_elements(v_slots) WITH ORDINALITY AS t(s, ord)\n    WHERE v_defer ? (t.s ->> \'key\');\n    FOR v_e IN SELECT * FROM jsonb_array_elements(v_tail_d) LOOP\n      CONTINUE WHEN (v_e ->> \'player_id\') = ANY (v_seated);\n      v_players_d := v_players_d || v_e;\n    END LOOP;\n    v_fit_d := public.lineup_fit_internal(v_dslots, v_players_d);\n    FOR v_key, v_val IN SELECT * FROM jsonb_each(v_defer) LOOP\n      v_pid := v_val #>> \'{}\';\n      IF (v_fit_d -> \'assignment\' ->> v_key) IS NULL THEN\n        v_restored := v_restored || jsonb_build_object(\n          \'slot\', v_key, \'player_id\', v_pid, \'name\', v_by_pid -> v_pid ->> \'name\',\n          \'reason\', \'no healthy or Doubtful, unlocked, eligible replacement existed — left exactly as he was (Q63; Q68)\');\n        v_seated := v_seated || v_pid;\n        v_players_b := v_players_b || jsonb_build_object(\n          \'player_id\', v_pid, \'position\', v_by_pid -> v_pid ->> \'position\',\n          \'wanted\', v_key, \'fixed\', TRUE);\n      ELSE\n        v_d_in := v_d_in || (v_fit_d -> \'assignment\' ->> v_key);\n        v_players_b := v_players_b || jsonb_build_object(\n          \'player_id\', v_fit_d -> \'assignment\' ->> v_key,\n          \'position\', v_by_pid -> (v_fit_d -> \'assignment\' ->> v_key) ->> \'position\',\n          \'wanted\', v_key, \'fixed\', TRUE);\n        v_subbed := v_subbed || jsonb_build_object(\n          \'slot\', v_key, \'out\', v_pid, \'out_name\', v_by_pid -> v_pid ->> \'name\',\n          \'in\', v_fit_d -> \'assignment\' ->> v_key,\n          \'in_name\', v_by_pid -> (v_fit_d -> \'assignment\' ->> v_key) ->> \'name\',\n          \'reason\', CASE WHEN COALESCE((v_kick -> v_pid ->> \'on_bye\')::boolean, FALSE)\n                         THEN \'on bye\' ELSE \'designated \' || (v_by_pid -> v_pid ->> \'designation\') END,\n          \'why\', \'no healthy, unlocked, eligible replacement existed — a Doubtful one replaces a starter who cannot play (Q68, ruled 2026-09-27)\',\n          \'order\', v_by_pid -> (v_fit_d -> \'assignment\' ->> v_key) -> \'order\');\n      END IF;\n    END LOOP;\n  END IF;\n\n',
  E''),
  E'    -- 142 (Q68): a Doubtful man pass 1b seated is already fixed above.\n    CONTINUE WHEN (v_e ->> \'player_id\') = ANY (v_d_in);\n',
  E''))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_autopilot_internal'),
  'a4fc61e3f00b5ed91770c496045cd57c',
  'A8 lineup_autopilot_internal is 139''s FILE TEXT beneath 142''s four hunks (prosrc with 142''s hunks reversed — md5 a stored literal)');
select is(
  (select md5(replace(replace(replace(replace(replace(p.prosrc,
  E'  -- 142 (L.E1.25, Q68 RULED): pass 1b — a Doubtful replacement for a BLOCKED\n  -- starter nobody healthy replaced.\n  v_defer       JSONB := \'{}\'::jsonb;        -- slot key → vacated BLOCKED starter with no healthy replacement\n  v_dslots      JSONB;                       -- pass 1b\'s slots: exactly those keys\n  v_players_d   JSONB := \'[]\'::jsonb;        -- pass 1b\'s candidates: the unseated Doubtful tail\n  v_fit_d       JSONB;\n  v_d_in        TEXT[] := ARRAY[]::text[];   -- Doubtful men pass 1b seated (fixed in pass 2)\n',
  E''),
  E'      -- 142 (L.E1.25, Q68 RULED 2026-09-27 — "yes, swap in the doubtful"): a\n      -- vacated starter who is BLOCKED (on bye, or OUT / IR / PUP / NFI /\n      -- Suspended) and whose key nobody healthy took is NOT restored yet — pass\n      -- 1b below offers his key to the Doubtful tail first. A vacated DOUBTFUL\n      -- starter is restored here as before: never one Doubtful for another.\n      IF COALESCE((v_kick -> v_pid ->> \'on_bye\')::boolean, FALSE)\n         OR COALESCE((v_by_pid -> v_pid ->> \'designation\') IN (\'OUT\', \'IR\', \'PUP\', \'NFI\', \'Suspended\'), FALSE) THEN\n        v_defer := v_defer || jsonb_build_object(v_key, v_pid);\n        CONTINUE;\n      END IF;\n',
  E''),
  E'  -- PASS 1b — 142 (L.E1.25, Q68 RULED 2026-09-27: "yes, swap in the\n  -- doubtful"). When no healthy, unlocked, eligible replacement exists, a\n  -- DOUBTFUL one replaces a starter who is OUT / on bye. The contest is\n  -- exactly the deferred BLOCKED keys (never an empty slot — pass 2 owns\n  -- those, unchanged) and its candidates are the Doubtful tail in Q62 order,\n  -- minus every man already staying where he is — so a restored Doubtful\n  -- starter is never moved to another key (never one Doubtful for another).\n  -- A locked man is never a candidate (the pool loop sent him to\n  -- skipped_locked[]) and a locked starter was never vacated (D338). The\n  -- Doubtful tail is a preference under BOTH `allow_illegal_lineups` values\n  -- (a Doubtful start is legal, 114:596), so this runs under both — which is\n  -- what restores production\'s (125) swap in a league that forbids illegal\n  -- lineups (R1123). A deferred key no Doubtful man takes is restored exactly\n  -- as Q63\'s clause restores it.\n  IF v_defer <> \'{}\'::jsonb THEN\n    SELECT COALESCE(jsonb_agg(t.s ORDER BY t.ord), \'[]\'::jsonb)\n    INTO v_dslots\n    FROM jsonb_array_elements(v_slots) WITH ORDINALITY AS t(s, ord)\n    WHERE v_defer ? (t.s ->> \'key\');\n    FOR v_e IN SELECT * FROM jsonb_array_elements(v_tail_d) LOOP\n      CONTINUE WHEN (v_e ->> \'player_id\') = ANY (v_seated);\n      v_players_d := v_players_d || v_e;\n    END LOOP;\n    v_fit_d := public.lineup_fit_internal(v_dslots, v_players_d);\n    FOR v_key, v_val IN SELECT * FROM jsonb_each(v_defer) LOOP\n      v_pid := v_val #>> \'{}\';\n      IF (v_fit_d -> \'assignment\' ->> v_key) IS NULL THEN\n        v_restored := v_restored || jsonb_build_object(\n          \'slot\', v_key, \'player_id\', v_pid, \'name\', v_by_pid -> v_pid ->> \'name\',\n          \'reason\', \'no healthy or Doubtful, unlocked, eligible replacement existed — left exactly as he was (Q63; Q68)\');\n        v_seated := v_seated || v_pid;\n        v_players_b := v_players_b || jsonb_build_object(\n          \'player_id\', v_pid, \'position\', v_by_pid -> v_pid ->> \'position\',\n          \'wanted\', v_key, \'fixed\', TRUE);\n      ELSE\n        v_d_in := v_d_in || (v_fit_d -> \'assignment\' ->> v_key);\n        v_players_b := v_players_b || jsonb_build_object(\n          \'player_id\', v_fit_d -> \'assignment\' ->> v_key,\n          \'position\', v_by_pid -> (v_fit_d -> \'assignment\' ->> v_key) ->> \'position\',\n          \'wanted\', v_key, \'fixed\', TRUE);\n        v_subbed := v_subbed || jsonb_build_object(\n          \'slot\', v_key, \'out\', v_pid, \'out_name\', v_by_pid -> v_pid ->> \'name\',\n          \'in\', v_fit_d -> \'assignment\' ->> v_key,\n          \'in_name\', v_by_pid -> (v_fit_d -> \'assignment\' ->> v_key) ->> \'name\',\n          \'reason\', CASE WHEN COALESCE((v_kick -> v_pid ->> \'on_bye\')::boolean, FALSE)\n                         THEN \'on bye\' ELSE \'designated \' || (v_by_pid -> v_pid ->> \'designation\') END,\n          \'why\', \'no healthy, unlocked, eligible replacement existed — a Doubtful one replaces a starter who cannot play (Q68, ruled 2026-09-27)\',\n          \'order\', v_by_pid -> (v_fit_d -> \'assignment\' ->> v_key) -> \'order\');\n      END IF;\n    END LOOP;\n  END IF;\n\n',
  E''),
  E'    -- 142 (Q68): a Doubtful man pass 1b seated is already fixed above.\n    CONTINUE WHEN (v_e ->> \'player_id\') = ANY (v_d_in);\n',
  E''),
  E'                WHERE c ->> \'player_id\' = e ->> \'player_id\')\n    -- 139 (L.E1.22, F392 / R1126): a vacated-then-RESTORED starter is back in\n    -- `v_seated` and pass 2 skips him as seated, so the pass never ORDERED him —\n    -- he is not a candidate, and counting him let one valued restored man\n    -- report "ordered by projection" for a pass whose every real candidate\n    -- was ordered by ADP (spec §7.2.1(c): "counted over the pass\'s candidates\n    -- only").\n    AND NOT ((e ->> \'player_id\') = ANY (v_seated));\n',
  E'                WHERE c ->> \'player_id\' = e ->> \'player_id\');\n'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_autopilot_internal'),
  '50038ce481ba713ba9fd1a10414c8c45',
  'A8b …and F392''s ONE hunk is its WHOLE change: reversed, the prosrc is 138''s chooser md5 (R1124''s pin) byte for byte');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'lineup_lock_tick')
  and not has_function_privilege('authenticated', 'public.lineup_lock_tick(timestamptz,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.lineup_lock_tick(timestamptz,uuid)', 'EXECUTE'),
  'A9 the tick''s posture is unchanged: SECURITY DEFINER, search_path='''', EXECUTE revoked from anon and authenticated');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context)
--    Calendar (2026, stored literals): week 3 starts 09-23 04:00Z; games
--    PHI–DAL Sun 09-27 17:00Z and SF–NYG Mon 09-28 00:15Z; every player is on
--    one of those four clubs ⇒ nobody is on bye and nobody is locked at P.
--    L1 `b7…01` h2h, allow TRUE, week 3 LIVE — the verb and the switch cells.
--      TC  c7…01 u1's (commissioner)      TCO c7…02 u2's (co_commissioner)
--      TM  c7…03 u3's (manager)           TO  c7…04 UNMANAGED — the OFF subject
--      TV  c7…05 UNMANAGED, NO lineup row TN  c7…06 NO league_members row
--      TR  c7…07 RETIRED (placeholder row) TW  c7…08 UNMANAGED — the co-commish flip
--      TF  c7…09 UNMANAGED — F392's chooser cell (the chooser is called directly)
--      TX  c7…10 u5's (manager) — a stored ON survives the claim, resumes on vacate
--    L2 `b7…02` total_points, week 3 LIVE — D354's measurement (TP c7…22,
--      UNMANAGED, OFF, NO lineup row; TC2 c7…21 u1's).
--    L3 `b7…03` h2h, week 3 LIVE — only an OFF unmanaged seat (TO3 c7…32).
--    L4 `b7…04` status 'setup' — the fresh seat minted by the real
--      add_placeholder_seat.
--    Slots everywhere: qb ×1, flex ×1 [RB, WR, TE].
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('9c000000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-sw' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'sw_user' || i)::jsonb, now(), now()
from generate_series(1, 5) i;

update nfl_weeks set first_kickoff_at = null where season = 2026;
update nfl_weeks set starts_at = '2026-09-23 04:00:00+00', last_game_ends_at = '2026-09-29 04:00:00+00', correction_window_ends_at = '2026-10-01 10:00:00+00' where season = 2026 and week = 3;
update nfl_weeks set starts_at = '2026-09-30 04:00:00+00' where season = 2026 and week = 4;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('sw-w3-sun', 2026, 3, 'PHI', 'DAL', '2026-09-27 17:00:00+00', 'scheduled'),
 ('sw-w3-mon', 2026, 3, 'SF',  'NYG', '2026-09-28 00:15:00+00', 'scheduled');

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings)
select l.id, '9c000000-0000-4000-8000-000000000001', l.nm, 2026, l.status, 12, 6, 0, 7,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', l.st,
       '{"starting_slots": [
           {"key": "qb",   "label": "QB",    "eligible": ["QB"],             "count": 1},
           {"key": "flex", "label": "W/R/T", "eligible": ["RB", "WR", "TE"], "count": 1}],
         "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb
from (values
 ('b7000000-0000-4000-8000-000000000001'::uuid, 'pgtap-sw-L1', 'in_season', '{"schedule_mode": "h2h", "allow_illegal_lineups": true}'::jsonb),
 ('b7000000-0000-4000-8000-000000000002'::uuid, 'pgtap-sw-L2', 'in_season', '{"schedule_mode": "total_points", "allow_illegal_lineups": true}'::jsonb),
 ('b7000000-0000-4000-8000-000000000003'::uuid, 'pgtap-sw-L3', 'in_season', '{"schedule_mode": "h2h", "allow_illegal_lineups": true}'::jsonb),
 ('b7000000-0000-4000-8000-000000000004'::uuid, 'pgtap-sw-L4', 'setup',     '{"schedule_mode": "h2h", "allow_illegal_lineups": true}'::jsonb)
) as l(id, nm, status, st);

insert into league_weeks (league_id, season, week, status)
select l, 2026, g, case when g = 3 then 'live' else 'upcoming' end
from (values ('b7000000-0000-4000-8000-000000000001'::uuid),
             ('b7000000-0000-4000-8000-000000000002'::uuid),
             ('b7000000-0000-4000-8000-000000000003'::uuid)) v(l),
     generate_series(3, 6) g;

insert into teams (id, owner_id, name, league_id, status) values
 ('c7000000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000001', 'SW Commish',     'b7000000-0000-4000-8000-000000000001', 'active'),
 ('c7000000-0000-4000-8000-000000000002', '9c000000-0000-4000-8000-000000000002', 'SW Co',          'b7000000-0000-4000-8000-000000000001', 'active'),
 ('c7000000-0000-4000-8000-000000000003', '9c000000-0000-4000-8000-000000000003', 'SW Managed',     'b7000000-0000-4000-8000-000000000001', 'active'),
 ('c7000000-0000-4000-8000-000000000004', '9c000000-0000-4000-8000-000000000001', 'SW Off Seat',    'b7000000-0000-4000-8000-000000000001', 'active'),
 ('c7000000-0000-4000-8000-000000000005', '9c000000-0000-4000-8000-000000000001', 'SW No Row',      'b7000000-0000-4000-8000-000000000001', 'active'),
 ('c7000000-0000-4000-8000-000000000006', '9c000000-0000-4000-8000-000000000001', 'SW No Member',   'b7000000-0000-4000-8000-000000000001', 'active'),
 ('c7000000-0000-4000-8000-000000000007', '9c000000-0000-4000-8000-000000000001', 'SW Retired',     'b7000000-0000-4000-8000-000000000001', 'retired'),
 ('c7000000-0000-4000-8000-000000000008', '9c000000-0000-4000-8000-000000000001', 'SW Co Flip',     'b7000000-0000-4000-8000-000000000001', 'active'),
 ('c7000000-0000-4000-8000-000000000009', '9c000000-0000-4000-8000-000000000001', 'SW F392',        'b7000000-0000-4000-8000-000000000001', 'active'),
 ('c7000000-0000-4000-8000-000000000010', '9c000000-0000-4000-8000-000000000005', 'SW Claimed',     'b7000000-0000-4000-8000-000000000001', 'active'),
 ('c7000000-0000-4000-8000-000000000021', '9c000000-0000-4000-8000-000000000001', 'SW TP Commish',  'b7000000-0000-4000-8000-000000000002', 'active'),
 ('c7000000-0000-4000-8000-000000000022', '9c000000-0000-4000-8000-000000000001', 'SW TP Off',      'b7000000-0000-4000-8000-000000000002', 'active'),
 ('c7000000-0000-4000-8000-000000000031', '9c000000-0000-4000-8000-000000000001', 'SW L3 Commish',  'b7000000-0000-4000-8000-000000000003', 'active'),
 ('c7000000-0000-4000-8000-000000000032', '9c000000-0000-4000-8000-000000000001', 'SW L3 Off',      'b7000000-0000-4000-8000-000000000003', 'active'),
 ('c7000000-0000-4000-8000-000000000041', '9c000000-0000-4000-8000-000000000001', 'SW Setup Commish','b7000000-0000-4000-8000-000000000004', 'active');

insert into league_members (league_id, user_id, team_id, role, is_placeholder) values
 ('b7000000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'commissioner', false),
 ('b7000000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000002', 'co_commissioner', false),
 ('b7000000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000003', 'c7000000-0000-4000-8000-000000000003', 'manager', false),
 ('b7000000-0000-4000-8000-000000000001', null, 'c7000000-0000-4000-8000-000000000004', 'manager', true),
 ('b7000000-0000-4000-8000-000000000001', null, 'c7000000-0000-4000-8000-000000000005', 'manager', true),
 ('b7000000-0000-4000-8000-000000000001', null, 'c7000000-0000-4000-8000-000000000007', 'manager', true),
 ('b7000000-0000-4000-8000-000000000001', null, 'c7000000-0000-4000-8000-000000000008', 'manager', true),
 ('b7000000-0000-4000-8000-000000000001', null, 'c7000000-0000-4000-8000-000000000009', 'manager', true),
 ('b7000000-0000-4000-8000-000000000001', '9c000000-0000-4000-8000-000000000005', 'c7000000-0000-4000-8000-000000000010', 'manager', false),
 ('b7000000-0000-4000-8000-000000000002', '9c000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000021', 'commissioner', false),
 ('b7000000-0000-4000-8000-000000000002', null, 'c7000000-0000-4000-8000-000000000022', 'manager', true),
 ('b7000000-0000-4000-8000-000000000003', '9c000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000031', 'commissioner', false),
 ('b7000000-0000-4000-8000-000000000003', null, 'c7000000-0000-4000-8000-000000000032', 'manager', true),
 ('b7000000-0000-4000-8000-000000000004', '9c000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000041', 'commissioner', false);

insert into players (id, full_name, position, team, status, adp) values
 ('sw-o-qb',  'SW Off QB',  'QB', 'DAL', 'Active', 10.0),
 ('sw-o-wr',  'SW Off WR',  'WR', 'PHI', 'Active', 11.0),
 ('sw-v-qb',  'SW NoRow QB','QB', 'DAL', 'Active', 12.0),
 ('sw-w-qb',  'SW Co QB',   'QB', 'DAL', 'Active', 13.0),
 ('sw-x-qb',  'SW Claim QB','QB', 'DAL', 'Active', 14.0),
 ('sw-p-qb',  'SW TP QB',   'QB', 'SF',  'Active', 15.0),
 ('sw-3-qb',  'SW L3 QB',   'QB', 'NYG', 'Active', 16.0),
 -- F392 (TF): an unlocked OUT starter with a FRESH projection who has NO
 -- eligible replacement at all (so he is RESTORED), plus a QB with no value
 -- row for the one empty slot, so the pass WRITES. RE-CUT BY L.E1.25 (Q68
 -- RULED — "yes, swap in the doubtful"): the Doubtful bench man was a flex-
 -- eligible RB, and since 142 he REPLACES the OUT starter — so he is now a
 -- QB (not flex-eligible, never placed), which keeps the restore F392 is
 -- about and keeps him a candidate the pass ORDERED (F3's count is unchanged).
 ('sw-f-out', 'SW F Out WR','WR', 'NYG', 'Out',      1.0),
 ('sw-f-dbt', 'SW F Dbt QB','QB', 'SF',  'Doubtful', 2.0),
 ('sw-f-qb',  'SW F QB',    'QB', 'DAL', 'Active',   5.0);

insert into league_rosters (league_id, team_id, player_id, slot_key, ir_placed_week) values
 ('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000004', 'sw-o-qb',  'bn', null),
 ('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000004', 'sw-o-wr',  'bn', null),
 ('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000005', 'sw-v-qb',  'bn', null),
 ('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000008', 'sw-w-qb',  'bn', null),
 ('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000010', 'sw-x-qb',  'bn', null),
 ('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000009', 'sw-f-out', 'bn', null),
 ('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000009', 'sw-f-dbt', 'bn', null),
 ('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000009', 'sw-f-qb',  'bn', null),
 ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000022', 'sw-p-qb',  'bn', null),
 ('b7000000-0000-4000-8000-000000000003', 'c7000000-0000-4000-8000-000000000032', 'sw-3-qb',  'bn', null);

-- THE WEEK-OPEN STATE, WRITTEN BY THE REAL CARRY (every "empty" row is what
-- `league_week_advance` produces). TV (L1) and TP (L2) get NO row — the
-- mid-week `add_placeholder_seat` shape D354 exists for.
select public.lineup_carry_internal(t.league_id, t.id, 2026, 3, '2026-09-23 04:00:00+00')
from teams t
where t.league_id in ('b7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000003')
  and t.id not in ('c7000000-0000-4000-8000-000000000005', 'c7000000-0000-4000-8000-000000000022');
-- F392's stored map: the OUT man seated at flex:0, qb:0 EMPTY (so the pass writes).
update team_lineups set slot_map = '{"flex:0": "sw-f-out"}'::jsonb
 where team_id = 'c7000000-0000-4000-8000-000000000009' and season = 2026 and week = 3;
-- F392's one value row: the OUT man, a FRESH 30.00 projection (the job's own
-- CHECK-honouring shape); the QB and the Doubtful RB have NO row.
insert into league_player_values
  (league_id, season, week, player_id, projected_points, projected_missing, projected_unscored, projection_fetched_at,
   season_points, season_games, preseason_points, preseason_missing, preseason_unscored, computed_at)
values ('b7000000-0000-4000-8000-000000000001', 2026, 3, 'sw-f-out', 30.00, null, '{}'::text[], '2026-09-25 11:00:00+00',
        null, 0, null, 'no_line', null, '2026-09-25 11:00:00+00');

create temp table r87 (tag text primary key, r jsonb not null);
grant select, insert on r87 to authenticated;

-- THE PREMISE BLOCK (rule 14(c)).
select is(
  (select string_agg(format('%s=%s', right(t.id::text, 2),
            case when m.id is null then 'no_member_row' when m.user_id is not null then 'managed' else 'unmanaged' end
            || case when t.status = 'retired' then '+retired' else '' end), ' ' order by t.id)
   from teams t left join league_members m on m.team_id = t.id
   where t.league_id = 'b7000000-0000-4000-8000-000000000001'),
  '01=managed 02=managed 03=managed 04=unmanaged 05=unmanaged 06=no_member_row 07=unmanaged+retired 08=unmanaged 09=unmanaged 10=managed',
  'B1 SEATING PREMISE (L1): every seat''s shape, read the way arm (c) reads it (D339 — league_members, never teams.status)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9c000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
insert into r87 select 'B2seat', public.add_placeholder_seat('b7000000-0000-4000-8000-000000000004', 'SW Fresh Seat');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select count(*)::int from team_autopilot where team_id = ((select r from r87 where tag = 'B2seat') ->> 'team_id')::uuid),
  0,
  'B2 THE DEFAULT, MEASURED ON A FRESH SEAT: a seat minted by the REAL add_placeholder_seat (063) has NO team_autopilot row — autopilot is OFF (Q63, ruled 2026-09-27); nothing had to write "off"');
select is(
  (select count(*)::int from team_autopilot sw join teams t on t.id = sw.team_id where t.league_id::text like 'b7000000-%'),
  0,
  'B2b …and no team in this fixture carries a row either — every switch below is flipped by the verb, or planted by the service role where the cell says so');
select is(
  (select format('map=%s roster=%s', tl.slot_map::text,
          (select string_agg(p.id || ':' || p.position || ':' || p.status || ':' || p.team, ',' order by p.id)
           from league_rosters r join players p on p.id = r.player_id where r.team_id = tl.team_id))
   from team_lineups tl where tl.team_id = 'c7000000-0000-4000-8000-000000000004' and tl.season = 2026 and tl.week = 3),
  'map={} roster=sw-o-qb:QB:Active:DAL,sw-o-wr:WR:Active:PHI',
  'B3 THE OFF SUBJECT''S PREMISE: TO''s stored map is EMPTY and its roster holds a healthy QB and a healthy WR whose games (Sun / Mon) are after P — so an unfilled slot there can only be the switch');
select is(
  (select count(*)::int from team_lineups where team_id in ('c7000000-0000-4000-8000-000000000005', 'c7000000-0000-4000-8000-000000000022') and season = 2026 and week = 3),
  0,
  'B4 TV (L1) and TP (L2) have NO lineup row for (2026, 3) — the carry had already run when they were seated (D354''s shape)');

-- ---------------------------------------------------------------------------
-- C. The verb — refusals (auth first, then shape, then the ON gates)
-- ---------------------------------------------------------------------------
set local role authenticated;
-- a MANAGER of the league (not a commissioner)
select set_config('request.jwt.claims', '{"sub": "9c000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_set_autopilot('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000004', true, null, 'a7000000-0000-4000-8000-000000000001') $$,
  '42501', 'commish_set_autopilot: not a commissioner of this league',
  'C1 a MANAGER is refused with the ONE no-leak 42501');
-- a NON-member
select set_config('request.jwt.claims', '{"sub": "9c000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_set_autopilot('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000004', true, null, 'a7000000-0000-4000-8000-000000000002') $$,
  '42501', 'commish_set_autopilot: not a commissioner of this league',
  'C2 a NON-member gets the SAME 42501, byte for byte');
select throws_ok(
  $$ select public.commish_set_autopilot('b7000000-0000-4000-8000-0000000000ff', 'c7000000-0000-4000-8000-000000000004', true, null, 'a7000000-0000-4000-8000-000000000003') $$,
  '42501', 'commish_set_autopilot: not a commissioner of this league',
  'C3 …and so does a league that does not exist — no existence leak');
-- the commissioner, malformed calls
select set_config('request.jwt.claims', '{"sub": "9c000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_set_autopilot('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000004', null, null, 'a7000000-0000-4000-8000-000000000004') $$,
  '22023', null, 'C4 p_on NULL is refused BY NAME (22023) — never answered as a no-op');
select throws_ok(
  $$ select public.commish_set_autopilot('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000004', true, null, null) $$,
  '22023', null, 'C5 no action_id is refused (22023)');
select throws_ok(
  $$ select public.commish_set_autopilot('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000021', true, null, 'a7000000-0000-4000-8000-000000000005') $$,
  'P0001', 'commish_set_autopilot: team c7000000-0000-4000-8000-000000000021 is not a franchise of league b7000000-0000-4000-8000-000000000001',
  'C6 a team of ANOTHER league is refused by name');
select throws_ok(
  $$ select public.commish_set_autopilot('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000004', true, repeat('x', 501), 'a7000000-0000-4000-8000-000000000006') $$,
  '22023', null, 'C7 a 501-character reason is refused (the league_chat bound)');
select throws_ok(
  $$ select public.commish_set_autopilot('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000003', true, null, 'a7000000-0000-4000-8000-000000000007') $$,
  'P0001', 'commish_set_autopilot: team c7000000-0000-4000-8000-000000000003 has a manager — autopilot is for a seat with NO manager (§7.2.1(c)); to set this team''s lineup, use the lineup override',
  'C8 ON on a MANAGED seat is refused BY NAME, verbatim (autopilot never runs for a seated manager — arm (c)''s predicate)');
select throws_ok(
  $$ select public.commish_set_autopilot('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000006', true, null, 'a7000000-0000-4000-8000-000000000008') $$,
  'P0001', null, 'C9 ON on a team with NO league_members row is refused (D339''s unsafe direction — arm (c) would decline it anyway)');
select throws_ok(
  $$ select public.commish_set_autopilot('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000007', true, null, 'a7000000-0000-4000-8000-000000000009') $$,
  'P0001', null, 'C10 ON on a RETIRED franchise is refused (it plays no more weeks — its successor is the seat to switch)');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select format('switch=%s audit=%s ledger=%s',
     (select count(*) from team_autopilot sw join teams t on t.id = sw.team_id where t.league_id = 'b7000000-0000-4000-8000-000000000001'),
     (select count(*) from commissioner_actions where league_id = 'b7000000-0000-4000-8000-000000000001'),
     (select count(*) from commish_autopilot_actions where league_id = 'b7000000-0000-4000-8000-000000000001'))),
  'switch=0 audit=0 ledger=0',
  'C11 every refusal above wrote NOTHING — no switch row, no receipt, no ledger row');

-- ---------------------------------------------------------------------------
-- D. The verb — landing, the no-op, the replay, the co-commissioner, OFF
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9c000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(public.is_league_commish('b7000000-0000-4000-8000-000000000001') and
          (select role from league_members where user_id = '9c000000-0000-4000-8000-000000000002' and league_id = 'b7000000-0000-4000-8000-000000000001') = 'co_commissioner',
  true, 'D1 PREMISE: this caller is a CO-commissioner (role co_commissioner), not the commissioner');
insert into r87 select 'D2', public.commish_set_autopilot('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000008', true, '  covering while the seat is empty  ', 'a7000000-0000-4000-8000-000000000011');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select format('%s/%s/%s/%s/%s/%s', r ->> 'verb', r ->> 'autopilot', r ->> 'previous', r ->> 'requested', r ->> 'seat', r ->> 'no_changes') from r87 where tag = 'D2'),
  'commish_set_autopilot/true/false/true/unmanaged/false',
  'D2 a CO-COMMISSIONER lands: TW goes OFF → ON on an unmanaged seat (D336 — co-commissioners included, asserted)');
select is(
  (select format('%s|%s|%s|%s|%s', c.action_type, c.target_type, c.target_id, c.before::text, c.after::text)
   from commissioner_actions c where c.id = ((select r from r87 where tag = 'D2') ->> 'commissioner_action_id')::uuid),
  'set_autopilot|team|c7000000-0000-4000-8000-000000000008|{"autopilot": false}|{"autopilot": true}',
  'D2b ONE commissioner_actions row, action_type set_autopilot, target the TEAM, before/after = {autopilot} (the activity feed reads the key set — F355)');
select is(
  (select format('%s|%s|%s', c.actor_id, c.reason, c.metadata -> 'affected_team_ids')
   from commissioner_actions c where c.id = ((select r from r87 where tag = 'D2') ->> 'commissioner_action_id')::uuid),
  '9c000000-0000-4000-8000-000000000002|covering while the seat is empty|["c7000000-0000-4000-8000-000000000008"]',
  'D2c …naming the co-commissioner as the actor, the reason TRIMMED, and affected_team_ids');
select is(
  (select format('%s|%s', sw.is_on, sw.set_at) from team_autopilot sw where sw.team_id = 'c7000000-0000-4000-8000-000000000008'),
  (select format('t|%s', (r ->> 'evaluated_at')::timestamptz) from r87 where tag = 'D2'),
  'D2d the switch row now reads ON, stamped with the verb''s transaction instant');
select is(
  (select count(*)::int from league_chat where league_id = 'b7000000-0000-4000-8000-000000000001' and is_system
     and message like 'SW Co Flip is now on autopilot — set by % (commissioner override) — reason: covering while the seat is empty'),
  1, 'D2e the §10.3 chat post, non-disableable, with the reason clause (a reason WAS given)');
select is(
  (select count(*)::int from commish_autopilot_actions where league_id = 'b7000000-0000-4000-8000-000000000001' and action_id = 'a7000000-0000-4000-8000-000000000011'),
  1, 'D2f the replay ledger holds the submit (D350)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9c000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
-- THE NO-OP: ON → ON with a NEW action_id.
insert into r87 select 'D3', public.commish_set_autopilot('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000008', true, null, 'a7000000-0000-4000-8000-000000000012');
-- THE REPLAY: D2's action_id again, from the commissioner, with DIFFERENT arguments.
insert into r87 select 'D4', public.commish_set_autopilot('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000008', false, null, 'a7000000-0000-4000-8000-000000000011');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select format('%s/%s/%s', r ->> 'no_changes', r ->> 'commissioner_action_id', left(r ->> 'no_changes_why', 10)) from r87 where tag = 'D3'),
  'true//already_on',
  'D3 ON → ON is a NO-OP BY VALUE: no_changes, NO receipt (commissioner_action_id NULL), and the why says already_on');
select is(
  (select format('audit=%s posts=%s ledger=%s',
     (select count(*) from commissioner_actions where league_id = 'b7000000-0000-4000-8000-000000000001'),
     (select count(*) from league_chat where league_id = 'b7000000-0000-4000-8000-000000000001' and is_system),
     (select count(*) from commish_autopilot_actions where league_id = 'b7000000-0000-4000-8000-000000000001'))),
  'audit=1 posts=1 ledger=2',
  'D3b …it wrote NOTHING but its ledger row: still ONE receipt and ONE post (D2''s)');
select is((select r from r87 where tag = 'D4'), (select r from r87 where tag = 'D2'),
  'D4 a REPLAY of D2''s action_id returns D2''s document BYTE-IDENTICALLY — even with different arguments from a different commissioner (the route''s F65(b) guard is what catches that)');
select is((select is_on from team_autopilot where team_id = 'c7000000-0000-4000-8000-000000000008'), true,
  'D4b …and the replay did NOT act on its arguments: TW is still ON');

-- OFF IS ACCEPTED ON ANY FRANCHISE — a stored ON on a MANAGED seat (TM) is
-- disarmed. The service role plants the stored ON (the state a later claim
-- leaves behind); the commissioner turns it off.
insert into team_autopilot (team_id, is_on, set_at) values ('c7000000-0000-4000-8000-000000000003', true, '2026-09-24 00:00:00+00');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9c000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
insert into r87 select 'D5', public.commish_set_autopilot('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000003', false, '', 'a7000000-0000-4000-8000-000000000013');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select format('%s/%s/%s/%s', r ->> 'autopilot', r ->> 'previous', r ->> 'seat', r ->> 'reason') from r87 where tag = 'D5'),
  'false/true/managed/',
  'D5 OFF lands on a MANAGED seat carrying a stored ON (OFF is the ruled default and can never seize a team); a blank reason normalises to NULL (Q66)');
select is(
  (select count(*)::int from league_chat where league_id = 'b7000000-0000-4000-8000-000000000001' and is_system
     and message like 'SW Managed is off autopilot — the commissioner manages its lineup — set by % (commissioner override)'
     and message not like '%reason:%'),
  1, 'D5b …its post carries NO reason clause — never "reason: <NULL>" (131 / Q66)');

-- ---------------------------------------------------------------------------
-- E. ARM (c) — the switch
-- ---------------------------------------------------------------------------
-- A stored ON on a MANAGED seat (TX): the design note's "a claim leaves it
-- untouched". Planted by the service role as the state a claim leaves behind.
insert into team_autopilot (team_id, is_on, set_at) values ('c7000000-0000-4000-8000-000000000010', true, '2026-09-24 00:00:00+00');
select is(
  (select string_agg(right(sw.team_id::text, 2) || '=' || sw.is_on, ',' order by sw.team_id)
   from team_autopilot sw join teams t on t.id = sw.team_id where t.league_id = 'b7000000-0000-4000-8000-000000000001'),
  '03=false,08=true,10=true',
  'E0 SWITCH PREMISE at the first tick: TW ON (the verb), TX ON (managed — planted), TM OFF (the verb); TO and TV have NO row, so they are OFF');
insert into r87 select 'T1', public.lineup_lock_tick('2026-09-25 12:00:00+00', 'b7000000-0000-4000-8000-000000000001');
select is(
  (select slot_map from team_lineups where team_id = 'c7000000-0000-4000-8000-000000000004' and season = 2026 and week = 3),
  '{}'::jsonb,
  'E1 THE OFF SEAT IS NOT FILLED: TO''s empty slots beside a healthy, unlocked, eligible QB and WR stay EMPTY — the commissioner manages it (Q63). Break probe: drop the switch branch ⇒ red');
select is(
  (select format('%s|%s|%s', e ->> 'reason', left(e ->> 'why', 47), e ->> 'materialized')
   from r87, jsonb_array_elements(r -> 'commissioner_managed') e
   where tag = 'T1' and e ->> 'team_id' = 'c7000000-0000-4000-8000-000000000004'),
  'unmanaged_autopilot_off|unmanaged, autopilot off — commissioner-managed|false',
  'E2 …AND IT IS NAMED: the tick''s commissioner_managed[] carries TO with reason unmanaged_autopilot_off and the plain-words why — never a quiet zero (rule 15). Break probe: drop the report ⇒ red');
select is(
  (select count(*)::int from r87, jsonb_array_elements(r -> 'autopiloted') e
   where tag = 'T1' and e ->> 'team_id' = 'c7000000-0000-4000-8000-000000000004'),
  0, 'E3 …and it is NOT in autopiloted[]');
select is(
  (select format('rows=%s map=%s', count(*), max(slot_map::text))
   from team_lineups where team_id = 'c7000000-0000-4000-8000-000000000005' and season = 2026 and week = 3),
  'rows=1 map={}',
  'E4 THE OFF SEAT WITH NO ROW (TV) IS MATERIALIZED, NOT FILLED: the carry wrote its row (D354 kept for OFF seats) and it is empty although its QB could start');
select is(
  (select format('mat=%s cm=%s',
     (select count(*) from jsonb_array_elements(r -> 'seats_materialized') e where e ->> 'team_id' = 'c7000000-0000-4000-8000-000000000005'),
     (select e ->> 'materialized' from jsonb_array_elements(r -> 'commissioner_managed') e where e ->> 'team_id' = 'c7000000-0000-4000-8000-000000000005'))
   from r87 where tag = 'T1'),
  'mat=1 cm=true',
  'E4b …named in BOTH seats_materialized[] and commissioner_managed[] (materialized: true)');
select is(
  (select format('%s|%s', (select string_agg(e ->> 'team_id', ',' order by e ->> 'team_id') from jsonb_array_elements(r -> 'autopiloted') e),
                          coalesce(r ->> 'autopilot_reason', 'NULL'))
   from r87 where tag = 'T1'),
  'c7000000-0000-4000-8000-000000000008|NULL',
  'E5 the ON seat in the same league (TW, switched by the co-commissioner) IS autopiloted at the same pass — the switch is per TEAM — and the reason is NULL because work happened');
select is(
  (select format('%s|%s', tl.slot_map::text, (select count(*) from jsonb_array_elements(r -> 'commissioner_managed') e where e ->> 'team_id' = 'c7000000-0000-4000-8000-000000000010'))
   from team_lineups tl, r87 where tl.team_id = 'c7000000-0000-4000-8000-000000000010' and tl.season = 2026 and tl.week = 3 and r87.tag = 'T1'),
  '{}|0',
  'E6 a MANAGED seat carrying a stored ON (TX) is never reached by arm (c): not filled, not named OFF — the predicate stops autopilot for a seated manager, so a claim needs no switch change');
select is(
  (select string_agg(right(e ->> 'team_id', 2), ',' order by e ->> 'team_id') from r87, jsonb_array_elements(r -> 'commissioner_managed') e where tag = 'T1'),
  '04,05,09',
  'E6b commissioner_managed[] names EXACTLY the three OFF unmanaged seats (TO, TV, TF) — not the managed ones, not the declined member-row-less TN, not the retired TR');

-- THE SAME SEAT, SWITCHED ON THROUGH THE VERB, AT THE SAME INSTANT.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9c000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
insert into r87 select 'E7v', public.commish_set_autopilot('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000004', true, null, 'a7000000-0000-4000-8000-000000000014');
reset role;
select set_config('request.jwt.claims', '', true);
insert into r87 select 'T2', public.lineup_lock_tick('2026-09-25 12:00:00+00', 'b7000000-0000-4000-8000-000000000001');
select is(
  (select slot_map from team_lineups where team_id = 'c7000000-0000-4000-8000-000000000004' and season = 2026 and week = 3),
  '{"qb:0": "sw-o-qb", "flex:0": "sw-o-wr"}'::jsonb,
  'E7 THE SAME SEAT, flipped ON by the verb, FILLS at the SAME instant P — so E1''s empty map was the switch and nothing else (rule 14(c))');
select is(
  (select count(*)::int from r87, jsonb_array_elements(r -> 'autopiloted') e where tag = 'T2' and e ->> 'team_id' = 'c7000000-0000-4000-8000-000000000004'),
  1, 'E7b …and the tick''s autopiloted[] names it');
select is(
  (select format('%s/%s', r ->> 'previous', r ->> 'autopilot') from r87 where tag = 'E7v'),
  'false/true',
  'E7c …and the verb read TO''s previous state as OFF with NO row — the default, once more, from the verb''s side');

-- A LATER VACATE RESUMES A STORED ON (the banner's design note): TX's manager
-- is removed in remove_manager's vacate shape (user_id = NULL on the same
-- row, 120's arm) and the next tick fills the seat; the switch row is untouched.
update league_members set user_id = null, is_placeholder = true where team_id = 'c7000000-0000-4000-8000-000000000010';
insert into r87 select 'T3', public.lineup_lock_tick('2026-09-25 12:00:00+00', 'b7000000-0000-4000-8000-000000000001');
select is(
  (select format('%s|%s|%s', tl.slot_map::text, sw.is_on, sw.set_at)
   from team_lineups tl join team_autopilot sw on sw.team_id = tl.team_id
   where tl.team_id = 'c7000000-0000-4000-8000-000000000010' and tl.season = 2026 and tl.week = 3),
  '{"qb:0": "sw-x-qb"}|t|2026-09-24 00:00:00+00',
  'E8 a LATER VACATE RESUMES IT: TX, vacated, is filled by the next tick, and its switch row is exactly as it was (never rewritten by the claim or the vacate)');

-- A PASS THAT SAW ONLY AN OFF SEAT SAYS SO.
insert into r87 select 'T4', public.lineup_lock_tick('2026-09-25 12:00:00+00', 'b7000000-0000-4000-8000-000000000003');
select is(
  (select format('%s|%s|%s|%s', r ->> 'autopilot_reason', jsonb_array_length(r -> 'autopiloted'), jsonb_array_length(r -> 'commissioner_managed'), r ->> 'reason')
   from r87 where tag = 'T4'),
  'every_unmanaged_seat_commissioner_managed_autopilot_off|0|1|no_changes',
  'E9 THE NEW REASON ARM: a pass whose only unmanaged seat is OFF evaluates NOTHING and says WHY — every_unmanaged_seat_commissioner_managed_autopilot_off, with the seat named — never "no unmanaged seats" (rule 15)');
select is(
  (select slot_map from team_lineups where team_id = 'c7000000-0000-4000-8000-000000000032' and season = 2026 and week = 3),
  '{}'::jsonb, 'E9b …and TO3 is untouched');

-- THE KILL SWITCH IS UNCHANGED: it still short-circuits the whole arm, ahead
-- of the switch (an ON seat is not filled; the OFF report is not produced).
insert into system_flags (key, value) values ('autopilot_disabled', '{"disabled": true}')
  on conflict (key) do update set value = excluded.value;
insert into r87 select 'T5', public.lineup_lock_tick('2026-09-25 12:00:00+00', 'b7000000-0000-4000-8000-000000000003');
select is(
  (select format('%s|%s', r ->> 'autopilot_reason', jsonb_array_length(r -> 'commissioner_managed')) from r87 where tag = 'T5'),
  'disabled_by_system_flag:autopilot_disabled|0',
  'E10 the autopilot_disabled kill switch is UNCHANGED — it still wins, ahead of the per-team switch');
delete from system_flags where key = 'autopilot_disabled';

-- ---------------------------------------------------------------------------
-- F. F392 — order_basis counts the pass's CANDIDATES only (the D7 variant)
-- ---------------------------------------------------------------------------
select is(
  (select format('%s:%s:%s', v.player_id, v.projected_points, v.computed_at) from league_player_values v
   where v.league_id = 'b7000000-0000-4000-8000-000000000001' and v.season = 2026 and v.week = 3),
  'sw-f-out:30.00:2026-09-25 11:00:00+00',
  'F1 PREMISE: the ONLY values row in L1''s week 3 is the OUT starter''s — a FRESH 30.00 projection (1h old at P); the QB and the Doubtful QB have NO row');
insert into r87 select 'F', public.lineup_autopilot_internal('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000009', 2026, 3, '2026-09-25 12:00:00+00');
select is(
  (select format('%s|%s|%s', r -> 'slot_map', (select string_agg(e ->> 'player_id', ',') from jsonb_array_elements(r -> 'restored') e), r ->> 'changed')
   from r87 where tag = 'F'),
  '{"qb:0": "sw-f-qb", "flex:0": "sw-f-out"}|sw-f-out|true',
  'F2 PREMISE (the D7 variant, re-cut by L.E1.25): the OUT starter is RESTORED (no healthy or Doubtful man is eligible for his flex slot — the Doubtful man is a QB) and the empty qb:0 is FILLED, so the pass WRITES');
select is(
  (select format('%s|%s|%s', r -> 'order_basis' ->> 'candidates', r -> 'order_basis' -> 'by_key' ->> 'projected_points', r -> 'order_basis' -> 'by_key' ->> 'adp')
   from r87 where tag = 'F'),
  '2|0|2',
  'F3 F392 (R1126): order_basis counts the TWO men the pass ordered (the QB and the Doubtful QB, both by ADP) — NOT the restored OUT man, whose projection the pass never used. Before 139: candidates 3, projected_points 1. Break probe: revert the hunk ⇒ red');
select is(
  (select format('%s|%s', r -> 'order_basis' ->> 'fell_back_to_adp', left(r -> 'order_basis' ->> 'fallback_why', 14)) from r87 where tag = 'F'),
  'true|no_value_rows:',
  'F4 …so the pass now SAYS it fell back to ADP, and why (no candidate had a values row) — before 139 it reported fell_back_to_adp false');

-- ---------------------------------------------------------------------------
-- G. RLS per role — RETURNING counts (§4.2)
-- ---------------------------------------------------------------------------
create temp table q87_before as select * from team_autopilot;
grant select on q87_before to anon, authenticated;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from team_autopilot), 0, 'G1 ANON reads ZERO switch rows (no anon policy)');
select throws_ok($$ insert into team_autopilot (team_id, is_on, set_at) values ('c7000000-0000-4000-8000-000000000009', true, now()) $$,
  '42501', null, 'G2 ANON cannot INSERT (42501)');
select results_eq($$ with u as (update team_autopilot set is_on = not is_on returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'G3 ANON UPDATE touches 0 rows');
select results_eq($$ with d as (delete from team_autopilot returning 1) select count(*)::int from d $$,
  $$ values (0) $$, 'G4 ANON DELETE touches 0 rows');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9c000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select is((select count(*)::int from team_autopilot sw join teams t on t.id = sw.team_id where t.league_id::text like 'b7000000-%'), 0,
  'G5 an AUTHENTICATED NON-member reads ZERO rows of this league — member-readable, not public (a teams column would have been world-readable, 001:845)');
select throws_ok($$ insert into team_autopilot (team_id, is_on, set_at) values ('c7000000-0000-4000-8000-000000000009', true, now()) $$,
  '42501', null, 'G6 …cannot INSERT (42501)');
-- a MANAGER of the league reads, cannot write
select set_config('request.jwt.claims', '{"sub": "9c000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is((select count(*)::int from team_autopilot sw join teams t on t.id = sw.team_id where t.league_id = 'b7000000-0000-4000-8000-000000000001'), 4,
  'G7 a league MEMBER (a manager) reads the league''s four switch rows (TM, TO, TW, TX)');
select results_eq($$ with u as (update team_autopilot set is_on = true returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'G8 …UPDATE touches 0 rows');
-- the COMMISSIONER cannot write it directly either — only through the verb
select set_config('request.jwt.claims', '{"sub": "9c000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok($$ insert into team_autopilot (team_id, is_on, set_at) values ('c7000000-0000-4000-8000-000000000009', true, now()) $$,
  '42501', null, 'G9 the COMMISSIONER cannot INSERT a switch row directly (42501) — the audited verb is the only door');
select results_eq($$ with u as (update team_autopilot set is_on = not is_on returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'G10 …UPDATE touches 0 rows');
select results_eq($$ with d as (delete from team_autopilot returning 1) select count(*)::int from d $$,
  $$ values (0) $$, 'G11 …DELETE touches 0 rows');
select is((select count(*)::int from commish_autopilot_actions), 0,
  'G12 …and reads ZERO ledger rows (zero policies — D350)');
select throws_ok($$ insert into commish_autopilot_actions (league_id, team_id, action_id, actor_id, result)
                    values ('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000009', gen_random_uuid(), '9c000000-0000-4000-8000-000000000001', '{}') $$,
  '42501', null, 'G13 …and cannot PRE-PLANT a ledger row (the attack D350 exists to make impossible)');
reset role;
select set_config('request.jwt.claims', '', true);
select set_eq($$ select * from team_autopilot $$, $$ select * from q87_before $$,
  'G14 the switch rows are BYTE-IDENTICAL after every client walk');

-- ---------------------------------------------------------------------------
-- H. D354's MEASUREMENT — why an OFF seat is still materialized
-- ---------------------------------------------------------------------------
-- A total_points week holds while ANY seated team has no team_week_results
-- row (`week_results_pending_internal`, 120:1059-1084), and the scoring
-- worker writes NO provisional row for a team with no lineup row
-- (`score-week-worker.ts` step (6b) — "no team_lineups row for week … the
-- week is held by name until one exists, F241(b)"; the stack suite
-- `lineup-autopilot-score-db.test.ts` drives that half end to end). Here: the
-- commissioner's team has its row, TP has none ⇒ the week is HELD, naming TP.
insert into team_week_results (league_id, team_id, season, week, points)
values ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000021', 2026, 3, 0);
select is(
  public.week_results_pending_internal('b7000000-0000-4000-8000-000000000002', 2026, 3),
  '{"reason": "pending_results", "missing": ["c7000000-0000-4000-8000-000000000022"], "pending": 1}'::jsonb,
  'H1 THE MEASUREMENT: a total_points week with ONE seated team lacking a result row is HELD (pending_results, naming it) — which is what a seat with NO lineup row produces, since the worker writes it no provisional row');
insert into r87 select 'TP', public.lineup_lock_tick('2026-09-25 12:00:00+00', 'b7000000-0000-4000-8000-000000000002');
select is(
  (select format('rows=%s map=%s named=%s',
     (select count(*) from team_lineups where team_id = 'c7000000-0000-4000-8000-000000000022' and season = 2026 and week = 3),
     (select slot_map::text from team_lineups where team_id = 'c7000000-0000-4000-8000-000000000022' and season = 2026 and week = 3),
     (select e ->> 'materialized' from jsonb_array_elements(r -> 'commissioner_managed') e where e ->> 'team_id' = 'c7000000-0000-4000-8000-000000000022'))
   from r87 where tag = 'TP'),
  'rows=1 map={} named=true',
  'H2 …so the OFF seat TP is MATERIALIZED (row written, EMPTY, named) — the worker can now write its provisional zero and the week can finalize; it is never FILLED');

select * from finish();
rollback;
