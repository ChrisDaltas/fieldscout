-- ============================================================================
-- The lineup batch — pgTAP 114 (task L.D2.20; migration 166; PROGRESS
-- D430 — F500 + F501 discharged; D420 / D429 / D413 / R739; spec §7.3.6,
-- §11.2 (the one-start bullet: the lineup record of his kickoff is kept),
-- §10 / standing rule (g)).
--
-- Numbering: reserved and measured (166 / 114). OWN FIXTURE: users 9114…,
-- league b114…, teams c114…, action ids a114…, players x-* / y-*, NFL teams
-- R*. Every instant is passed explicitly (the TimeProvider rule); internals
-- are called as postgres with the actor JWT claims set.
--
--   §A  form: the two replaced bodies (PLAIN, search_path empty, closed to
--       anon / authenticated, one overload each), D137 in the database (each
--       live body with 166 reversed = its newest definer FILE TEXT, stored
--       literals), 166 as written, un166 an identity on every other body,
--       the neighbours untouched, the editor carrying set_lineup R739 clause
--       byte for byte, the readers of the helper counted, the comment.
--   §F  F500 (and F503: F9), allow_illegal_lineups OFF, Sunday 16:00: a starter who played
--       Thursday and is now on IR (XK IR) — a commissioner fix that keeps him
--       where he stands LANDS (the pre-166 editor refused it), exactly as the
--       manager own re-save lands, and they write the same row; what still
--       binds the commissioner: moving him to another key, starting an OUT
--       player from the bench, the E16 fit, the one-start trigger; with the
--       setting ON both editors write the same thing.
--   §X  F501, Sunday 17:30 (after the new team kickoff): XK Trd played
--       Thursday (the lineup record) and was traded to a Sunday team; XK UTrd
--       played Thursday (his stat line) and was traded likewise. Each writer
--       — set_lineup (X1), the editor (X2), the carry (X3), autopilot (X4) —
--       keeps the Thursday record and locked_at, side by side with the
--       pre-166 helper (which records Sunday 17:00); the tick keeps what the
--       writer stored (X5); the manager lock outcomes are the same under both
--       helpers, only the instant named differs (X6); and over a boundary
--       matrix of 13 players x 7 instants the lock bit and the bye bit
--       never differ — only the kickoff, and only for players who played
--       Thursday and were then traded (to a Sunday, a postponed or a flexed
--       team), plus the stale-record residual F504 (X7 / X8).
--
-- BREAK PROBES (the PR body; measured), each injected right after the
-- pre-166 bodies are created, inside this transaction (the ROLLBACK ends it):
--   (1) the editor back to 165 (its un166 on the live body) ⇒ A4 A7 F1 F2
--       F3 F5 F7 F9 red (F5 / F7: the 165 gate refuses XK IR at qb:0 before
--       the cell reaches its own refusal) — 17 / 25 green;
--   (2) the helper back to 157 ⇒ A4 X1 X2 X3 X4 X5 X6 X8 red — X7 stays
--       green by design (the lock bits never depended on it) — 17 / 25;
--   (3) the helper stat-line branch disabled ⇒ A3 A4 X3 X8 red (X1 X2 X4
--       stay green — they ride the lineup record) — 21 / 25;
--   (4) the helper stat-line branch counting a stat line that names no game
--       (157 fallback, the week first kickoff) ⇒ A3 A4 X8 red (XK NG moves
--       to Thursday) — 22 / 25;
--   (5) the editor R739 clause with set_lineup literal `=` occupant test
--       (not null-safe) ⇒ A3 A4 A7 F4 F9 red (moving the played OUT starter
--       into an empty key lands — the hole the first draft of 166 had; the
--       kept start of F9 needs BOTH clauses null-safe) — 20 / 25;
--   (6) the editor kept-start clause back to its 154 `=` occupant test (F503)
--       ⇒ A3 A4 F9 red (the kept off-roster start moved into an empty key
--       lands) — 22 / 25.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(25);

-- pg_temp.un181 — migration 181's one tick hunk removed (pgTAP 129 pins it);
-- an identity on every other body. Applied INNERMOST.
create function pg_temp.un181(p_src text) returns text language sql as $un181$
  select replace(p_src, $h$        -- 181 (D496): every ROSTERED player has a pool row before the view
        -- runs. A drafted player never passed through the pool (072's draft
        -- writes league_rosters only; pool rows are lazy, D294), so the view
        -- below never judged him and My Team showed him unlocked while
        -- set_lineup refused him. The row is the D294 mirror's own shape
        -- ('rostered'); an existing row of any state is left alone.
        INSERT INTO public.league_player_pool (league_id, player_id, state, updated_at)
        SELECT r.league_id, r.player_id, 'rostered', p_now
        FROM public.league_rosters r
        WHERE r.league_id = v_lg.id
        ON CONFLICT (league_id, player_id) DO NOTHING;

$h$, '')
$un181$;

-- L.E1.31 (migration 170 — additive, the R992 shape): pg_temp.un170 reverses
-- 170's ONE hunk in each of commish_edit_lineup_internal,
-- commish_roster_override_internal and commish_rename_team_internal (D451 —
-- acting_as_team_id on the override twins) and is an identity on every other
-- body (pgTAP 118 A5). Generated by derive_170.py from the same pairs the
-- migration was derived with; applied INNERMOST below.
create function pg_temp.un170(p_src text) returns text language sql as $un170$
  select replace(replace(replace(p_src,
    -- commish_edit_lineup_internal
    E'        \'score_stale_reason\',  v_stale_why),\n      -- 170/L.E1.31 (D451) — acting_as_team_id = THE TEAM. The commissioner\n      -- set this team\'s lineup: a manager\'s act done for the team (§10.3:711\n      -- "set when the commissioner acts on behalf of any team, most commonly\n      -- an orphaned one"). set_lineup\'s commissioner arm has written the same\n      -- action_type with it since 169; one action_type, one shape. His OWN\n      -- team is his own act, not one on its behalf: NULL (169\'s arm, R1334).\n      CASE WHEN EXISTS (SELECT 1 FROM public.league_members m\n                        WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id)\n           THEN NULL ELSE p_team_id END);\n    IF v_audit_id IS NULL THEN',
    E'        \'score_stale_reason\',  v_stale_why),\n      NULL);\n    IF v_audit_id IS NULL THEN'),
    -- commish_roster_override_internal
    E'        \'score_stale_reason\',  v_stale_why),\n      -- 170/L.E1.31 (D451) — acting_as_team_id = THE TEAM on the force\n      -- add / drop arm: the commissioner made this team\'s roster move, the\n      -- act roster_add_drop gives its manager (§10.3:711; TD16 — the manager\n      -- verb\'s commissioner door is this override, standing rule (h)). A MOVE\n      -- acts on two teams and for neither: NULL, both ride in\n      -- affected_team_ids (D353). His OWN team is his own act: NULL (R1334).\n      CASE WHEN v_is_move OR EXISTS (SELECT 1 FROM public.league_members m\n                                     WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id)\n           THEN NULL ELSE p_team_id END);\n    IF v_audit_id IS NULL THEN',
    E'        \'score_stale_reason\',  v_stale_why),\n      NULL);\n    IF v_audit_id IS NULL THEN'),
    -- commish_rename_team_internal
    E'        \'frozen_receipts_for_this_team\', v_frozen),\n      -- 170/L.E1.31 (D451) — acting_as_team_id = THE TEAM: the commissioner\n      -- renamed it, the act rename_own_team gives its manager (§10.3:711;\n      -- TD16 — the manager verb\'s commissioner door is this override). His\n      -- OWN team is his own act: NULL (R1334).\n      CASE WHEN EXISTS (SELECT 1 FROM public.league_members m\n                        WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id)\n           THEN NULL ELSE p_team_id END);\n    IF v_audit_id IS NULL THEN',
    E'        \'frozen_receipts_for_this_team\', v_frozen),\n      NULL);\n    IF v_audit_id IS NULL THEN')
$un170$;

-- L.E1.30 (migration 169 — additive, the R992 shape): pg_temp.un169 reverses
-- 169's ONE hunk in set_lineup_internal (F514 — the commissioner arm's
-- receipt) and is an identity on every other body (pgTAP 117 A3 / A5).
-- Generated by derive_169.py from the same pair the migration was derived
-- with; applied INNERMOST below.
create function pg_temp.un169(p_src text) returns text language sql as $un169$
  select replace(p_src,
    E'      INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)\n      VALUES (p_league_id, auth.uid(), v_message, \'league\', TRUE);\n      -- 169/L.E1.30 (F514) — THE RECEIPT: a commissioner setting a team he\n      -- does not manage is a commissioner action (D363(2)) — one row per\n      -- changed lineup, the team acted for in acting_as_team_id (§10.3). The\n      -- no-op re-save wrote nothing above; a manager\'s own save (the\n      -- commissioner\'s own team included) is not this arm.\n      PERFORM public.draft_commish_receipt_internal(\n        p_league_id, FALSE, \'set_lineup\', \'edit_lineup\', \'team\', p_team_id::text, v_reason,\n        jsonb_build_object(\'slot_map\', v_stored),\n        jsonb_build_object(\'slot_map\', v_canon)\n          || CASE WHEN jsonb_array_length(v_ir_placed) + jsonb_array_length(v_ir_removed) > 0\n                  THEN jsonb_build_object(\'ir_moves\', jsonb_build_object(\'placed\', v_ir_placed, \'removed\', v_ir_removed))\n                  ELSE \'{}\'::jsonb END,\n        jsonb_build_object(\'week\', p_week, \'current_week\', v_current, \'season\', v_league.season,\n                           \'week_status\', v_lw.status, \'team_name\', v_team.name, \'action_id\', p_action_id),\n        p_team_id);\n    END IF;\n',
    E'      INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)\n      VALUES (p_league_id, auth.uid(), v_message, \'league\', TRUE);\n    END IF;\n')
$un169$;

-- pg_temp.un166 reverses 166's substitutions in the two bodies it replaced
-- (commish_edit_lineup_internal, lineup_player_kickoff_internal) — an
-- identity on every other body (A5). Generated by derive_166.py from the
-- same pairs the migration was derived with (one per substitution).
create function pg_temp.un166(p_src text) returns text language sql as $un166$
  select replace(replace(replace(p_src,
    E'      -- §7.3.6 allow_illegal_lineups = FALSE. KEPT (see WHAT IS NOT LIFTED).\n      -- 166 / F500: R739\'s exemption, carried exactly as set_lineup_internal\n      -- step (10) has it (157): a STORED starter whose own game has kicked\n      -- off (his per-player datum, step (6)) and who stays at his stored key\n      -- is not blocked — his game is under way or over, so keeping him where\n      -- he stands is the week as it happened, not a submit. 123 dropped the\n      -- clause as meaningless for a verb with no lock; without it a starter\n      -- who played Thursday and was put on IR before Sunday refused every\n      -- commissioner fix to that week unless he benched him (changing the\n      -- score) — a save the manager may make: a TIMING refusal of the\n      -- commissioner (standing rule (g)). Putting a bye / OUT player at any\n      -- key he is not stored at (moving him, or starting one from the\n      -- bench) is still refused by name, as it is for the manager. The\n      -- stored-occupant test is spelled NULL-SAFE here: set_lineup\'s `=`\n      -- yields NULL for a key that was empty, which cannot reach its gate\n      -- (step (7b) refuses a kicked-off player entering a slot first) but\n      -- would reach this one (no lock) and let a moved OUT starter through.\n      -- The kept-start clause below (154 / F441) is spelled the same way\n      -- (F503): its `=` let a kept OFF-ROSTER starter, now OUT, be moved\n      -- into an empty key without the refusal.\n      IF NOT v_allow AND jsonb_array_length(v_pflags) > 0\n         AND NOT ((v_kick -> v_pid ->> \'kickoff_at\') IS NOT NULL\n                  AND (v_kick -> v_pid ->> \'kickoff_at\')::timestamptz <= p_at\n                  AND (v_stored ->> v_key) IS NOT DISTINCT FROM v_pid)   -- 166 / F500: R739, as set_lineup (null-safe)\n         AND NOT (v_gone_kick ? v_pid AND (v_stored ->> v_key) IS NOT DISTINCT FROM v_pid) THEN   -- 154 / F441: a kept start where it stands is the week\'s record, not a submit (166 / F503: null-safe too — an empty key must not exempt a moved kept start)\n',
    E'      -- §7.3.6 allow_illegal_lineups = FALSE. KEPT (see WHAT IS NOT LIFTED).\n      -- 114\'s R739 clause is dropped from the predicate rather than carried:\n      -- it exempts "the stored player\'s own game has kicked off and he is the\n      -- stored occupant", i.e. "not the manager\'s to change" — and for a verb\n      -- with no lock there is no such thing, so carrying it would be a clause\n      -- that means nothing. The gate is therefore the plain one.\n      IF NOT v_allow AND jsonb_array_length(v_pflags) > 0\n         AND NOT (v_gone_kick ? v_pid AND (v_stored ->> v_key) = v_pid) THEN   -- 154 / F441: a kept start where it stands is the week\'s record, not a submit\n'),
    E'  v_k    RECORD;\n  v_p    RECORD;\n  v_stat TIMESTAMPTZ;   -- 166 / F501\nBEGIN\n',
    E'  v_k    RECORD;\n  v_p    RECORD;\nBEGIN\n'),
    E'      RETURN NEXT;\n      RETURN;\n    END IF;\n  ELSE\n    -- 166 / F501: his current team\'s kickoff HAS passed. When he PLAYED\n    -- earlier this week in another game — the NFL traded him after it to a\n    -- team that has also kicked off since — the datum is the game he played\n    -- in, never his new team\'s later one: an earlier start this league\n    -- recorded for a real, passed kickoff of the week (lineup_played_\n    -- internal (ii), guarded by lineup_record_kicked_off_internal), else his\n    -- stat line\'s game (a real, passed kickoff of the week, not postponed).\n    -- Both instants have passed, so every lock reads the same; only the\n    -- record (and locked_at, and the instant a refusal names) stays on the\n    -- game he played. A stat line that names no game carries no instant he\n    -- played at (157\'s fallback there is the week\'s first kickoff) and\n    -- never displaces his team\'s kickoff.\n    SELECT * INTO v_p FROM public.lineup_played_internal(p_league_id, p_season, p_week, p_player_id, p_at);\n    IF v_p.played AND v_p.datum_arm = \'lineup_record\' AND v_p.kickoff_at < v_k.kickoff_at THEN\n      kickoff_at := v_p.kickoff_at; datum_arm := v_p.datum_arm; on_bye := FALSE;\n      RETURN NEXT;\n      RETURN;\n    END IF;\n    SELECT min(g.kickoff_at) INTO v_stat\n    FROM public.player_stats ps\n    JOIN public.nfl_games g ON g.id = ps.game_id\n    WHERE ps.player_id = p_player_id AND ps.season = p_season AND ps.week = p_week\n      AND g.season = p_season AND g.week = p_week\n      AND g.status IS DISTINCT FROM \'postponed\'\n      AND g.kickoff_at <= p_at;\n    IF v_stat < v_k.kickoff_at THEN\n      kickoff_at := v_stat; datum_arm := \'stat_line\'; on_bye := FALSE;\n      RETURN NEXT;\n      RETURN;\n    END IF;\n  END IF;\n  kickoff_at := v_k.kickoff_at; datum_arm := v_k.datum_arm; on_bye := v_k.on_bye;\n',
    E'      RETURN NEXT;\n      RETURN;\n    END IF;\n  END IF;\n  kickoff_at := v_k.kickoff_at; datum_arm := v_k.datum_arm; on_bye := v_k.on_bye;\n')
$un166$;

-- The pre-166 bodies, side by side with the live ones: the editor renamed
-- into pg_temp; the helper kept as DDL (pre166_helper) that a trial runs
-- inside its own rolled-back subtransaction, so every writer that reads the
-- helper (set_lineup, the editor, the carry, autopilot) runs against 157's
-- datum. Nothing live is replaced outside a rolled-back trial.
do $pre$
begin
  execute replace(pg_temp.un166(pg_get_functiondef('public.commish_edit_lineup_internal(uuid, uuid, integer, jsonb, uuid, timestamptz, text)'::regprocedure)),
                  'FUNCTION public.commish_edit_lineup_internal(', 'FUNCTION pg_temp.edit_pre166(');
  execute replace(pg_temp.un166(pg_get_functiondef('public.lineup_player_kickoff_internal(uuid, integer, integer, text, timestamptz)'::regprocedure)),
                  'FUNCTION public.lineup_player_kickoff_internal(', 'FUNCTION pg_temp.kick_pre166(');
end
$pre$;
create temp table pre166_helper as
select pg_temp.un166(pg_get_functiondef('public.lineup_player_kickoff_internal(uuid, integer, integer, text, timestamptz)'::regprocedure)) as ddl;

-- ---------------------------------------------------------------------------
-- A. Form pins, D137 in the database, the neighbours untouched
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('commish_edit_lineup_internal', 'lineup_player_kickoff_internal')),
  'commish_edit_lineup_internal:f:search_path="":f:f lineup_player_kickoff_internal:f:search_path="":f:f',
  'A1 the two replaced bodies: one overload each (signatures unchanged), PLAIN, search_path empty, closed to anon and authenticated');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and a.privilege_type = 'EXECUTE' and a.grantee = 0
      and p.proname in ('commish_edit_lineup_internal', 'lineup_player_kickoff_internal')),
  'A2 PUBLIC holds EXECUTE on neither (REVOKEs restated)');
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un166(pg_temp.un170(p.prosrc))), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('commish_edit_lineup_internal', 'lineup_player_kickoff_internal')),
  'commish_edit_lineup_internal=95d0b4652636948b4499d1e27c3b5d93 lineup_player_kickoff_internal=b14949f7f54de384bac2a49efdfd494d',
  'A3 D137: each live body with 166 reversed is its NEWEST definer FILE TEXT (165:145 / 157:275 — the stored md5 literals pgTAP 113 A4 and A7 pinned before 166)');
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un170(p.prosrc)), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('commish_edit_lineup_internal', 'lineup_player_kickoff_internal')),
  'commish_edit_lineup_internal=cee39d868365ebe257365cfc56804ad3 lineup_player_kickoff_internal=a9b16bd7ded168d0730376a3561301dd',
  'A4 the two live prosrc md5s — 166 as written (stored literals; 170 reversed innermost — pgTAP 118 A4 pins the editor as 170 wrote it)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname not in ('commish_edit_lineup_internal', 'lineup_player_kickoff_internal')
     and pg_temp.un166(p.prosrc) <> p.prosrc),
  0,
  'A5 un166 is an identity on every other body in the schema — so the older suites that apply it innermost pin exactly what they pinned (additive, R992)');
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un169(pg_temp.un181(p.prosrc))), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('set_lineup_internal', 'lineup_autopilot_internal', 'lineup_lock_tick', 'lineup_carry_internal',
                                                 'lineup_played_internal', 'lineup_record_kicked_off_internal', 'lineup_played_lock_internal',
                                                 'pool_game_lock_player_internal', 'lineup_kept_starter_internal', 'lineup_kickoff_internal',
                                                 'commish_edit_lineup', 'team_lineups_one_start_per_week')),
  'commish_edit_lineup=876d323ce50e0b305a29046a8fee0515 lineup_autopilot_internal=544d32c67abd3f3243ff1bfa568360ad lineup_carry_internal=53f4b5d29a2d881e27e07ff27a0fec4c lineup_kept_starter_internal=3f60bb975e57719c0be2de7f4ccdbb12 lineup_kickoff_internal=80b9c63efa3cb5bbef7b79863e9801a7 lineup_lock_tick=bcc10f9a40e99f7a1cf83e1c94f813f0 lineup_played_internal=aa79ff77ba714b19b6740c60202d8476 lineup_played_lock_internal=cfee6bd961f1dae36991bb4ffbfc19b4 lineup_record_kicked_off_internal=9c54a4f3fb38bad956d6386d7748b777 pool_game_lock_player_internal=402cae9eb3c781f6b0c82c44178e4851 set_lineup_internal=ca3307414057469da7ed5c0af0b29fe6 team_lineups_one_start_per_week=a1fb72fc17941cda5f7ddc0d15226b74',
  'A6 UNTOUCHED (stored literals): every reader of the helper but the editor (set_lineup, autopilot, the carry), the tick, the played-lock helpers, the kept-start judgment, the team datum, the DEFINER door and the one-start trigger');
create function pg_temp.cnt(p_src text, p_needle text) returns int language sql as $$
  select (length(p_src) - length(replace(p_src, p_needle, ''))) / length(p_needle)
$$;
select is(
  (select format('set_lineup %s/%s editor %s/%s',
                 pg_temp.cnt(s.prosrc, x.eq), pg_temp.cnt(s.prosrc, x.nd), pg_temp.cnt(e.prosrc, x.eq), pg_temp.cnt(e.prosrc, x.nd))
   from pg_proc s, pg_proc e,
        (select E'         AND NOT ((v_kick -> v_pid ->> \'kickoff_at\') IS NOT NULL\n                  AND (v_kick -> v_pid ->> \'kickoff_at\')::timestamptz <= p_at\n                  AND (v_stored ->> v_key) = v_pid)' as eq,
                E'         AND NOT ((v_kick -> v_pid ->> \'kickoff_at\') IS NOT NULL\n                  AND (v_kick -> v_pid ->> \'kickoff_at\')::timestamptz <= p_at\n                  AND (v_stored ->> v_key) IS NOT DISTINCT FROM v_pid)' as nd) x
   where s.oid = 'public.set_lineup_internal(uuid, uuid, integer, jsonb, uuid, timestamptz, text)'::regprocedure
     and e.oid = 'public.commish_edit_lineup_internal(uuid, uuid, integer, jsonb, uuid, timestamptz, text)'::regprocedure),
  'set_lineup 1/0 editor 0/1',
  'A7 R739 carried as set_lineup_internal step (10) has it — his own kickoff passed and he is the stored occupant — once, with the occupant test spelled null-safe in the editor (an empty stored key must not exempt a moved player: no lock there stops him first); set_lineup unchanged');
select is(
  (select string_agg(p.proname || ':' || (length(p.prosrc) - length(replace(p.prosrc, 'public.lineup_player_kickoff_internal(', ''))) / length('public.lineup_player_kickoff_internal('), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%public.lineup_player_kickoff_internal(%')
  || ' | ' || coalesce(obj_description('public.lineup_player_kickoff_internal(uuid, integer, integer, text, timestamptz)'::regprocedure, 'pg_proc') like '%since migration 166, when his team''s kickoff has passed but he played EARLIER this week%', false)::text,
  'commish_edit_lineup_internal:2 lineup_autopilot_internal:1 lineup_carry_internal:1 set_lineup_internal:2 | true',
  'A8 the helper READERS, counted in the database: set_lineup (x2), autopilot, the editor (x2), the carry — no other body reads it (the tick keeps a passed real record on its own, 157); and its comment is restated for 166');

-- ---------------------------------------------------------------------------
-- FIXTURE — the 105 / 112 / 113 calendar shape (2026 seeds; only the stamps
-- rewritten): WEEK 6 — RA @ RZ Thu 10-16 00:15Z (played, final), RB @ RY
-- Sun 10-18 17:00Z; RF @ RG FLEXED from Sun 10-18 13:00Z to 10-19 00:20Z.
-- Every other week: KC @ BUF one day after its start (week 5: Thu 10-08
-- 04:00Z). SUN = 10-18 16:00Z (after Thursday, before Sunday); LATE =
-- 10-18 17:30Z (after the Sunday kickoff, before the flexed game).
-- ---------------------------------------------------------------------------
update nfl_weeks w
set last_game_ends_at = case when w.week <= 5 then w.starts_at + interval '6 days'
                             when w.week = 6 then '2026-10-20 03:30:00+00'::timestamptz end,
    first_kickoff_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status)
select 'x-dummy-' || w.week, 2026, w.week, 'KC', 'BUF', w.starts_at + interval '1 day', case when w.week <= 5 then 'final' else 'scheduled' end
from nfl_weeks w where w.season = 2026 and w.week <= 14 and w.week <> 6;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('x-g6a', 2026, 6, 'RA', 'RZ', '2026-10-16 00:15:00+00', 'final'),
 ('x-g6b', 2026, 6, 'RB', 'RY', '2026-10-18 17:00:00+00', 'scheduled'),
 ('x-g6f', 2026, 6, 'RF', 'RG', '2026-10-19 00:20:00+00', 'scheduled'),
 ('x-g6p', 2026, 6, 'RP', 'RQ', '2026-10-18 20:00:00+00', 'postponed');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('91140000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-lb' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'lb_user' || i)::jsonb, now(), now()
from generate_series(1, 5) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, waiver_type, faab_budget, trade_review,
                     settings, roster_settings)
values ('b1140000-0000-4000-8000-000000000001', '91140000-0000-4000-8000-000000000001', 'pgtap-lb-L', 2026, 'in_season', 12, 14, 0, 15,
        (select id from scoring_systems where is_template and name = 'ESPN Standard'),
        (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
        'per_player_kickoff', 'none_fcfs', 100, 'none', '{}'::jsonb,
        '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 4}], "bench": 8, "ir_slots": [{"key": "ir", "label": "IR", "type": "standard", "eligible_designations": ["OUT", "IR"]}], "swap_spots": 0}'::jsonb);

insert into teams (id, owner_id, name, league_id, status) values
 ('c1140000-0000-4000-8000-000000000001', '91140000-0000-4000-8000-000000000001', 'XK Commish', 'b1140000-0000-4000-8000-000000000001', 'active'),
 ('c1140000-0000-4000-8000-000000000002', '91140000-0000-4000-8000-000000000002', 'XK Tango',   'b1140000-0000-4000-8000-000000000001', 'active'),
 ('c1140000-0000-4000-8000-000000000003', '91140000-0000-4000-8000-000000000003', 'XK Uniform', 'b1140000-0000-4000-8000-000000000001', 'active'),
 ('c1140000-0000-4000-8000-000000000004', '91140000-0000-4000-8000-000000000004', 'XK Victor',  'b1140000-0000-4000-8000-000000000001', 'active'),
 ('c1140000-0000-4000-8000-000000000005', '91140000-0000-4000-8000-000000000005', 'XK Whiskey', 'b1140000-0000-4000-8000-000000000001', 'active');
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, t.owner_id, t.id,
       case when t.owner_id = '91140000-0000-4000-8000-000000000001' then 'commissioner' else 'manager' end, false, 100
from teams t where t.id::text like 'c1140000-%';

insert into league_weeks (league_id, season, week)
select 'b1140000-0000-4000-8000-000000000001', 2026, w from generate_series(1, 14) w;
update league_weeks set status = 'live'              where league_id = 'b1140000-0000-4000-8000-000000000001' and week <= 6;
update league_weeks set status = 'correction_window' where league_id = 'b1140000-0000-4000-8000-000000000001' and week <= 5;
update league_weeks set status = 'final'             where league_id = 'b1140000-0000-4000-8000-000000000001' and week <= 5;

-- Everyone is on the team his note says at the Thursday kickoff; the NFL
-- moves (the two trades to RB, the IR designation) are applied after it.
insert into players (id, full_name, position, team, status) values
 ('x-ir',   'XK IR (Thu, played, now IR)',      'QB', 'RA', 'Active'),
 ('x-out',  'XK Out (Sun, OUT, not played)',    'QB', 'RB', 'Out'),
 ('x-sun1', 'XK Sun1',                          'QB', 'RB', 'Active'),
 ('x-rb',   'XK RB',                            'RB', 'RB', 'Active'),
 ('x-dup',  'XK Dup (started by Whiskey)',      'QB', 'RB', 'Active'),
 ('x-trd',  'XK Trd (Thu record, traded)',      'QB', 'RA', 'Active'),
 ('x-sunA', 'XK SunA',                          'QB', 'RB', 'Active'),
 ('x-lt1',  'XK Late1 (flexed game)',           'QB', 'RF', 'Active'),
 ('x-lt2',  'XK Late2 (flexed game)',           'QB', 'RF', 'Active'),
 ('y-trd',  'XK UTrd (Thu stat line, traded)',  'QB', 'RA', 'Active'),
 ('y-ng',   'XK NG (Sun, stat line names no game)', 'QB', 'RB', 'Active'),
 ('y-cut',  'XK Cut (no team, never played)',   'QB', null, 'Active'),
 ('y-early', 'XK Early (Sun team, traded to the Thu team, never played)', 'QB', 'RB', 'Active'),
 ('y-post', 'XK Post (Thu stat line, traded to a postponed team)', 'QB', 'RA', 'Active'),
 ('y-flx',  'XK Flx (Thu stat line, traded to the flexed team)', 'QB', 'RA', 'Active'),
 ('y-stale', 'XK Stale (flexed team, stale 17:00 record)', 'QB', 'RF', 'Active'),
 ('y-rel',  'XK Rel (Thu stat line, released)',  'QB', 'RA', 'Active'),
 ('y-prior', 'XK Prior (Sun team, week-5 stat line only)', 'QB', 'RB', 'Active');

insert into league_rosters (league_id, team_id, player_id, slot_key)
select 'b1140000-0000-4000-8000-000000000001', 'c1140000-0000-4000-8000-000000000002', p, case when p = 'x-ir' then 'qb' else 'bn' end
from unnest(array['x-ir', 'x-out', 'x-sun1', 'x-rb', 'x-dup']) p;
insert into league_rosters (league_id, team_id, player_id, slot_key)
select 'b1140000-0000-4000-8000-000000000001', 'c1140000-0000-4000-8000-000000000003', p, case when p in ('x-trd', 'x-sunA') then 'qb' else 'bn' end
from unnest(array['x-trd', 'x-sunA', 'x-lt1', 'x-lt2']) p;
insert into league_rosters (league_id, team_id, player_id, slot_key) values
 ('b1140000-0000-4000-8000-000000000001', 'c1140000-0000-4000-8000-000000000004', 'y-trd', 'qb');
insert into league_player_pool (league_id, player_id, state)
select 'b1140000-0000-4000-8000-000000000001', r.player_id, 'rostered' from league_rosters r where r.league_id = 'b1140000-0000-4000-8000-000000000001';

-- Lineups in 114 shape; each starter carries the kickoff the writer that
-- seated him recorded. Whiskey starts XK Dup this week (the one-start
-- holder) — he is on Tango roster (F7 builds the collision directly).
insert into team_lineups (team_id, season, week, slot_map, starters, bench, locked_at) values
 ('c1140000-0000-4000-8000-000000000002', 2026, 6, '{"qb:0": "x-ir"}'::jsonb,
  '[{"slot": "qb:0", "slot_key": "qb", "label": "QB", "player_id": "x-ir", "position": "QB", "kickoff_at": "2026-10-16T00:15:00+00:00", "flags": []},
    {"slot": "qb:1", "slot_key": "qb", "label": "QB", "player_id": null, "position": null, "kickoff_at": null, "flags": ["empty"]},
    {"slot": "qb:2", "slot_key": "qb", "label": "QB", "player_id": null, "position": null, "kickoff_at": null, "flags": ["empty"]},
    {"slot": "qb:3", "slot_key": "qb", "label": "QB", "player_id": null, "position": null, "kickoff_at": null, "flags": ["empty"]}]'::jsonb,
  '["x-dup", "x-out", "x-rb", "x-sun1"]'::jsonb, '2026-10-16 00:15:00+00'),
 ('c1140000-0000-4000-8000-000000000003', 2026, 6, '{"qb:0": "x-trd", "qb:1": "x-sunA"}'::jsonb,
  '[{"slot": "qb:0", "slot_key": "qb", "label": "QB", "player_id": "x-trd", "position": "QB", "kickoff_at": "2026-10-16T00:15:00+00:00", "flags": []},
    {"slot": "qb:1", "slot_key": "qb", "label": "QB", "player_id": "x-sunA", "position": "QB", "kickoff_at": "2026-10-18T17:00:00+00:00", "flags": []},
    {"slot": "qb:2", "slot_key": "qb", "label": "QB", "player_id": null, "position": null, "kickoff_at": null, "flags": ["empty"]},
    {"slot": "qb:3", "slot_key": "qb", "label": "QB", "player_id": null, "position": null, "kickoff_at": null, "flags": ["empty"]}]'::jsonb,
  '["x-lt1", "x-lt2"]'::jsonb, '2026-10-16 00:15:00+00'),
 ('c1140000-0000-4000-8000-000000000004', 2026, 5, '{"qb:0": "y-trd"}'::jsonb,
  '[{"slot": "qb:0", "slot_key": "qb", "label": "QB", "player_id": "y-trd", "position": "QB", "kickoff_at": "2026-10-08T04:00:00+00:00", "flags": []}]'::jsonb,
  '[]'::jsonb, '2026-10-08 04:00:00+00'),
 ('c1140000-0000-4000-8000-000000000005', 2026, 6, '{"qb:0": "x-dup", "qb:1": "y-stale"}'::jsonb,
  '[{"slot": "qb:0", "slot_key": "qb", "label": "QB", "player_id": "x-dup", "position": "QB", "kickoff_at": "2026-10-18T17:00:00+00:00", "flags": []},
    {"slot": "qb:1", "slot_key": "qb", "label": "QB", "player_id": "y-stale", "position": "QB", "kickoff_at": "2026-10-18T17:00:00+00:00", "flags": []}]'::jsonb,
  '[]'::jsonb, '2026-10-18 17:00:00+00');

-- THE STAT LINES: XK IR and XK UTrd played Thursday (the game named); XK NG
-- has a stat line that names NO game. XK Trd has none — the lineup record
-- alone says he played.
insert into player_stats (player_id, season, week, stat_type, game_id, updated_at) values
 ('x-ir',  2026, 6, 'weekly', 'x-g6a', '2026-10-16 03:30:00+00'),
 ('y-trd', 2026, 6, 'weekly', 'x-g6a', '2026-10-16 03:30:00+00'),
 ('y-ng',  2026, 6, 'weekly', null,    '2026-10-18 20:30:00+00'),
 ('y-post', 2026, 6, 'weekly', 'x-g6a', '2026-10-16 03:30:00+00'),
 ('y-flx',  2026, 6, 'weekly', 'x-g6a', '2026-10-16 03:30:00+00'),
 ('y-rel',  2026, 6, 'weekly', 'x-g6a', '2026-10-16 03:30:00+00'),
 ('y-prior', 2026, 5, 'weekly', 'x-dummy-5', '2026-10-09 03:30:00+00');

-- THE NFL MOVES, after the Thursday game.
update players set team = 'RB' where id in ('x-trd', 'y-trd');
update players set team = 'RA' where id = 'y-early';
update players set team = 'RP' where id = 'y-post';
update players set team = 'RF' where id = 'y-flx';
update players set team = null where id = 'y-rel';
update players set status = 'IR' where id = 'x-ir';

-- Post-reset race guard (067): today and tomorrow realtime.messages partitions.
do $part$
declare
  d date;
  part_name text;
begin
  foreach d in array array[current_date, current_date + 1] loop
    part_name := 'messages_' || to_char(d, 'YYYY_MM_DD');
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'realtime' and c.relname = part_name) then
      execute format('create table realtime.%I partition of realtime.messages for values from (%L) to (%L)',
                     part_name, d::timestamp, (d + 1)::timestamp);
    end if;
  end loop;
end
$part$;

-- A TRIAL runs one statement in a subtransaction that is then rolled back,
-- and returns its document and the league state it left — so the live body
-- and the pre-166 body start from the SAME state.
create function pg_temp.state() returns jsonb language sql as $$
  select jsonb_build_object(
    'rosters', (select jsonb_agg(jsonb_build_array(r.team_id, r.player_id, r.slot_key, r.ir_placed_week, r.ir_lock_until_week) order by r.team_id, r.player_id)
                from league_rosters r where r.league_id = 'b1140000-0000-4000-8000-000000000001'),
    'lineups', (select jsonb_agg(jsonb_build_object('team', tl.team_id, 'week', tl.week, 'slot_map', tl.slot_map, 'starters', tl.starters,
                                                    'bench', tl.bench, 'locked_at', tl.locked_at) order by tl.team_id, tl.week)
                from team_lineups tl join teams t on t.id = tl.team_id where t.league_id = 'b1140000-0000-4000-8000-000000000001'));
$$;
create function pg_temp.trial(p_sql text) returns jsonb language plpgsql as $$
declare
  v_doc   jsonb;
  v_state jsonb;
begin
  begin
    execute p_sql into v_doc;
    v_state := pg_temp.state();
    raise exception 'trial rolled back' using errcode = 'FST01';
  exception when sqlstate 'FST01' then
    null;
  end;
  return jsonb_build_object('doc', v_doc, 'state', v_state);
exception when others then
  return jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate);
end $$;
-- Runs p_sql with the per-player datum put back to 157's body (inside the
-- caller trial, so the replacement is rolled back with it).
create function pg_temp.with_pre166(p_sql text) returns jsonb language plpgsql as $$
declare
  v_doc jsonb;
begin
  execute (select ddl from pre166_helper);
  execute p_sql into v_doc;
  return v_doc;
end $$;
create temp table r114 (tag text primary key, r jsonb not null);
create function pg_temp.act_as(p_user int) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '91140000-0000-4000-8000-00000000000' || p_user, 'role', 'authenticated')::text, true);
$$;
select pg_temp.act_as(1);

-- One commissioner edit / one manager save of week p_week for team p_team.
create function pg_temp.edit_sql(p_fn text, p_team int, p_week int, p_map text, p_act int, p_at text) returns text language sql as $$
  select format('select %s(%L::uuid, %L::uuid, %s, %L::jsonb, %L::uuid, %L::timestamptz, null)', p_fn,
                'b1140000-0000-4000-8000-000000000001', 'c1140000-0000-4000-8000-00000000000' || p_team, p_week, p_map,
                'a1140000-0000-4000-8000-' || lpad(p_act::text, 12, '0'), p_at)
$$;
create function pg_temp.mgr(p_team int, p_map text, p_act int, p_at text) returns jsonb language plpgsql as $$
declare
  v_doc jsonb;
begin
  perform pg_temp.act_as(p_team);
  execute pg_temp.edit_sql('public.set_lineup_internal', p_team, 6, p_map, p_act, p_at) into v_doc;
  perform pg_temp.act_as(1);
  return v_doc;
end $$;
-- Renders a lineup row of the state: player@kickoff[flags],… | locked_at.
create function pg_temp.row_of(p_r jsonb, p_team int, p_week int) returns text language sql as $$
  select (select string_agg(coalesce(s ->> 'player_id', '-') || '@' || coalesce(s ->> 'kickoff_at', '-') || coalesce(s ->> 'flags', ''), ',' order by o)
          from jsonb_array_elements(l -> 'starters') with ordinality x(s, o)
          where s ->> 'player_id' is not null)
         || ' | locked_at ' || coalesce(l ->> 'locked_at', '-')
  from jsonb_array_elements(p_r -> 'state' -> 'lineups') l
  where l ->> 'team' = 'c1140000-0000-4000-8000-00000000000' || p_team and (l ->> 'week')::int = p_week
$$;
create function pg_temp.outcome(p_tag text) returns text language sql as $$
  select coalesce((select 'refused: ' || (r ->> 'error') from r114 where tag = p_tag and r ? 'error'),
                  (select 'landed' from r114 where tag = p_tag and r ? 'doc'), 'missing')
$$;

-- ---------------------------------------------------------------------------
-- F. F500 — allow_illegal_lineups OFF, Sunday 16:00. XK IR played Thursday
--    and is now on IR, stored at qb:0 of XK Tango.
-- ---------------------------------------------------------------------------
update leagues set settings = '{"allow_illegal_lineups": false}'::jsonb where id = 'b1140000-0000-4000-8000-000000000001';
insert into r114 (tag, r)
select 'f1:' || f.side,
       pg_temp.trial(pg_temp.edit_sql(f.fn, 2, 6, '{"qb:0": "x-ir", "qb:1": "x-sun1"}', 11, '2026-10-18 16:00:00+00'))
from (values ('live', 'public.commish_edit_lineup_internal'), ('pre', 'pg_temp.edit_pre166')) f(side, fn);
select is('live ' || pg_temp.outcome('f1:live') || ' | pre166 ' || pg_temp.outcome('f1:pre'),
  'live landed | pre166 refused: commish_edit_lineup: XK IR (Thu, played, now IR) is OUT (IR) for week 6 and allow_illegal_lineups is off — slot "qb:0" is blocked at submit (§7.3.6); bench him, start someone who plays, or turn the setting on',
  'F1 THE IR-AFTER-THURSDAY CASE: a commissioner fix that keeps a starter who played Thursday and is now on IR where he stands LANDS — before 166 it was refused unless he benched him (a timing refusal of the commissioner, standing rule (g))');
insert into r114 (tag, r)
select 'f2', pg_temp.trial(format('select pg_temp.mgr(2, %L, 12, %L)', '{"qb:0": "x-ir", "qb:1": "x-sun1"}', '2026-10-18 16:00:00+00'));
select is(
  pg_temp.outcome('f2') || ' | same row as the commissioner: '
  || ((select r -> 'state' -> 'lineups' from r114 where tag = 'f2') = (select r -> 'state' -> 'lineups' from r114 where tag = 'f1:live'))::text
  || ' | same rosters: ' || ((select r -> 'state' -> 'rosters' from r114 where tag = 'f2') = (select r -> 'state' -> 'rosters' from r114 where tag = 'f1:live'))::text,
  'landed | same row as the commissioner: true | same rosters: true',
  'F2 …the manager own re-save of the same lineup lands (R739, unchanged) and the two saves leave the league in the same state — the commissioner may do what the manager may');
select is(
  (select pg_temp.row_of(r, 2, 6) from r114 where tag = 'f1:live')
  || ' || ' || (select format('%s %s', r -> 'doc' -> 'locked_players_moved', r -> 'doc' -> 'bypassed') from r114 where tag = 'f1:live'),
  'x-ir@2026-10-16T00:15:00+00:00["out"],x-sun1@2026-10-18T17:00:00+00:00[] | locked_at 2026-10-16T00:15:00+00:00 || [] []',
  'F3 the stored row keeps XK IR at qb:0 with his Thursday record and the OUT flag (the week as it happened), locked_at Thursday; the receipt names no lock walked past (nobody was moved)');
insert into r114 (tag, r)
select 'f4:' || f.side,
       pg_temp.trial(pg_temp.edit_sql(f.fn, 2, 6, '{"qb:0": "x-sun1", "qb:1": "x-ir"}', 13, '2026-10-18 16:00:00+00'))
from (values ('live', 'public.commish_edit_lineup_internal'), ('pre', 'pg_temp.edit_pre166')) f(side, fn);
select is('live ' || pg_temp.outcome('f4:live') || ' | pre166 ' || pg_temp.outcome('f4:pre'),
  'live refused: commish_edit_lineup: XK IR (Thu, played, now IR) is OUT (IR) for week 6 and allow_illegal_lineups is off — slot "qb:1" is blocked at submit (§7.3.6); bench him, start someone who plays, or turn the setting on'
  || ' | pre166 refused: commish_edit_lineup: XK IR (Thu, played, now IR) is OUT (IR) for week 6 and allow_illegal_lineups is off — slot "qb:1" is blocked at submit (§7.3.6); bench him, start someone who plays, or turn the setting on',
  'F4 NO BROADER THAN R739: MOVING the played OUT starter to another key is not keeping him where he stands — still refused by name under both bodies (the exemption needs the stored occupant, as in set_lineup)');
insert into r114 (tag, r)
select 'f5', pg_temp.trial(pg_temp.edit_sql('public.commish_edit_lineup_internal', 2, 6, '{"qb:0": "x-ir", "qb:1": "x-out"}', 14, '2026-10-18 16:00:00+00'));
select is(pg_temp.outcome('f5'),
  'refused: commish_edit_lineup: XK Out (Sun, OUT, not played) is OUT (OUT) for week 6 and allow_illegal_lineups is off — slot "qb:1" is blocked at submit (§7.3.6); bench him, start someone who plays, or turn the setting on',
  'F5 VALIDITY BINDS HIM: starting an OUT player who has not played, from the bench, is refused by name (the gate for a submit is unchanged)');
insert into r114 (tag, r)
select 'f6', pg_temp.trial(pg_temp.edit_sql('public.commish_edit_lineup_internal', 2, 6, '{"qb:0": "x-ir", "qb:1": "x-rb"}', 15, '2026-10-18 16:00:00+00'));
select is(split_part(pg_temp.outcome('f6'), ' — ', 1),
  'refused: commish_edit_lineup: XK RB (RB) cannot be placed',
  'F6 …and so does the E16 fit: a running back in a quarterback slot is refused by name while the played OUT starter stays where he stands');
insert into r114 (tag, r)
select 'f7', pg_temp.trial(pg_temp.edit_sql('public.commish_edit_lineup_internal', 2, 6, '{"qb:0": "x-ir", "qb:1": "x-dup"}', 16, '2026-10-18 16:00:00+00'));
select is(pg_temp.outcome('f7'),
  'refused: XK Dup (started by Whiskey) (x-dup) is already in XK Whiskey''s starting lineup for week 6 (slot "qb:0") — a player starts for at most one team per league-week, so XK Tango cannot start him at "qb:1" (§7.3.3 / §11.2; PROGRESS F441 / F445): that start stays, and so do its points',
  'F7 …and so does the one-start trigger (154): a player another team already starts this week cannot be started for XK Tango, even by the commissioner');
update leagues set settings = '{}'::jsonb where id = 'b1140000-0000-4000-8000-000000000001';
insert into r114 (tag, r)
select 'f8:' || f.side,
       pg_temp.trial(pg_temp.edit_sql(f.fn, 2, 6, '{"qb:0": "x-ir", "qb:1": "x-sun1"}', 17, '2026-10-18 16:00:00+00'))
from (values ('live', 'public.commish_edit_lineup_internal'), ('pre', 'pg_temp.edit_pre166')) f(side, fn);
select is(
  pg_temp.outcome('f8:live') || ' | ' || pg_temp.outcome('f8:pre') || ' | same state: '
  || ((select r -> 'state' from r114 where tag = 'f8:live') = (select r -> 'state' from r114 where tag = 'f8:pre'))::text
  || ' | same document: ' || ((select (r -> 'doc') - 'commissioner_action_id' from r114 where tag = 'f8:live') = (select (r -> 'doc') - 'commissioner_action_id' from r114 where tag = 'f8:pre'))::text,
  'landed | landed | same state: true | same document: true',
  'F8 CONTROL, the setting ON (the default): the live and pre-166 editors land the same fix and write the same rows and the same document (but its fresh audit row id) — the gate is all 166 changed in the editor');

-- F9 (F503, review R1300): the kept-start clause is null-safe too. XK IR
--    leaves XK Tango roster after he played (a kept OFF-ROSTER start, 152 /
--    154 — built directly inside the trial); with the setting off his start
--    stays where it stands, but moving him into an empty key is refused.
create function pg_temp.kept_try(p_fn text, p_map text, p_act int) returns jsonb language plpgsql as $$
declare
  v_doc jsonb;
begin
  delete from league_rosters where team_id = 'c1140000-0000-4000-8000-000000000002' and player_id = 'x-ir';
  execute pg_temp.edit_sql(p_fn, 2, 6, p_map, p_act, '2026-10-18 16:00:00+00') into v_doc;
  return v_doc;
end $$;
update leagues set settings = '{"allow_illegal_lineups": false}'::jsonb where id = 'b1140000-0000-4000-8000-000000000001';
insert into r114 (tag, r) values
 ('f9m:live', pg_temp.trial(format('select pg_temp.kept_try(%L, %L, 18)', 'public.commish_edit_lineup_internal', '{"qb:0": "x-sun1", "qb:1": "x-ir"}'))),
 ('f9k:live', pg_temp.trial(format('select pg_temp.kept_try(%L, %L, 19)', 'public.commish_edit_lineup_internal', '{"qb:0": "x-ir", "qb:1": "x-sun1"}'))),
 ('f9m:pre',  pg_temp.trial(format('select pg_temp.kept_try(%L, %L, 18)', 'pg_temp.edit_pre166', '{"qb:0": "x-sun1", "qb:1": "x-ir"}')));
select is(
  'moved: ' || pg_temp.outcome('f9m:live') || ' | kept where he stands: ' || pg_temp.outcome('f9k:live')
  || ' | moved, pre-166: ' || pg_temp.outcome('f9m:pre')
  || coalesce(' illegal=' || (select r -> 'doc' -> 'flags' ->> 'illegal' from r114 where tag = 'f9m:pre'), ''),
  'moved: refused: commish_edit_lineup: XK IR (Thu, played, now IR) is OUT (IR) for week 6 and allow_illegal_lineups is off — slot "qb:1" is blocked at submit (§7.3.6); bench him, start someone who plays, or turn the setting on'
  || ' | kept where he stands: landed | moved, pre-166: landed illegal=true',
  'F9 THE KEPT OFF-ROSTER TWIN OF F4 (F503): a start kept after XK IR left the roster stays where it stands under the setting off, but moving him into an empty key is refused by name — before 166 that move landed with flags.illegal (the NULL-shaped occupant test)');
update leagues set settings = '{}'::jsonb where id = 'b1140000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- X. F501 — Sunday 17:30, after the traded starters NEW team kicked off.
-- ---------------------------------------------------------------------------
-- X1 set_lineup (the manager of XK Uniform) fills qb:2 with XK Late1.
insert into r114 (tag, r) values
 ('x1:live', pg_temp.trial(format('select pg_temp.mgr(3, %L, 21, %L)', '{"qb:0": "x-trd", "qb:1": "x-sunA", "qb:2": "x-lt1"}', '2026-10-18 17:30:00+00'))),
 ('x1:pre',  pg_temp.trial(format('select pg_temp.with_pre166(%L)',
                                  format('select pg_temp.mgr(3, %L, 21, %L)', '{"qb:0": "x-trd", "qb:1": "x-sunA", "qb:2": "x-lt1"}', '2026-10-18 17:30:00+00'))));
select is(
  (select format('live %s || pre166 %s', (select pg_temp.row_of(r, 3, 6) from r114 where tag = 'x1:live'), (select pg_temp.row_of(r, 3, 6) from r114 where tag = 'x1:pre'))),
  'live x-trd@2026-10-16T00:15:00+00:00[],x-sunA@2026-10-18T17:00:00+00:00[],x-lt1@2026-10-19T00:20:00+00:00[] | locked_at 2026-10-16T00:15:00+00:00'
  || ' || pre166 x-trd@2026-10-18T17:00:00+00:00[],x-sunA@2026-10-18T17:00:00+00:00[],x-lt1@2026-10-19T00:20:00+00:00[] | locked_at 2026-10-18T17:00:00+00:00',
  'X1 set_lineup after the new team kickoff: XK Trd (played Thursday, traded to a Sunday team) keeps the Thursday record he played in and locked_at stays Thursday — the pre-166 datum recorded his new team Sunday kickoff and moved locked_at (R1296)');
-- X2 the commissioner editor, the same fix.
insert into r114 (tag, r) values
 ('x2:live', pg_temp.trial(pg_temp.edit_sql('public.commish_edit_lineup_internal', 3, 6, '{"qb:0": "x-trd", "qb:1": "x-sunA", "qb:2": "x-lt1"}', 22, '2026-10-18 17:30:00+00'))),
 ('x2:pre',  pg_temp.trial(format('select pg_temp.with_pre166(%L)',
                                  pg_temp.edit_sql('public.commish_edit_lineup_internal', 3, 6, '{"qb:0": "x-trd", "qb:1": "x-sunA", "qb:2": "x-lt1"}', 22, '2026-10-18 17:30:00+00'))));
select is(
  (select format('live %s || pre166 %s', (select pg_temp.row_of(r, 3, 6) from r114 where tag = 'x2:live'), (select pg_temp.row_of(r, 3, 6) from r114 where tag = 'x2:pre'))),
  'live x-trd@2026-10-16T00:15:00+00:00[],x-sunA@2026-10-18T17:00:00+00:00[],x-lt1@2026-10-19T00:20:00+00:00[] | locked_at 2026-10-16T00:15:00+00:00'
  || ' || pre166 x-trd@2026-10-18T17:00:00+00:00[],x-sunA@2026-10-18T17:00:00+00:00[],x-lt1@2026-10-19T00:20:00+00:00[] | locked_at 2026-10-18T17:00:00+00:00',
  'X2 the commissioner editor, the same fix: the Thursday record and locked_at stay (pre-166: Sunday 17:00) — and the two writers store the same row');
-- X3 the carry: XK Victor has no week-6 row; the mid-week carry (D354).
insert into r114 (tag, r) values
 ('x3:live', pg_temp.trial(format('select public.lineup_carry_internal(%L::uuid, %L::uuid, 2026, 6, %L::timestamptz)',
                                  'b1140000-0000-4000-8000-000000000001', 'c1140000-0000-4000-8000-000000000004', '2026-10-18 17:30:00+00'))),
 ('x3:pre',  pg_temp.trial(format('select pg_temp.with_pre166(%L)',
                                  format('select public.lineup_carry_internal(%L::uuid, %L::uuid, 2026, 6, %L::timestamptz)',
                                         'b1140000-0000-4000-8000-000000000001', 'c1140000-0000-4000-8000-000000000004', '2026-10-18 17:30:00+00'))));
select is(
  (select format('live %s || pre166 %s', (select pg_temp.row_of(r, 4, 6) from r114 where tag = 'x3:live'), (select pg_temp.row_of(r, 4, 6) from r114 where tag = 'x3:pre'))),
  'live y-trd@2026-10-16T00:15:00+00:00[] | locked_at 2026-10-16T00:15:00+00:00 || pre166 y-trd@2026-10-18T17:00:00+00:00[] | locked_at 2026-10-18T17:00:00+00:00',
  'X3 the carry after the new team kickoff: XK UTrd (played Thursday by his STAT LINE, traded to a Sunday team) is carried with the Thursday kickoff of the game his stat line names — pre-166: his new team Sunday kickoff');
-- X4 autopilot (the chooser the tick arm (c) writes) fills XK Uniform.
insert into r114 (tag, r) values
 ('x4:live', jsonb_build_object('doc', public.lineup_autopilot_internal('b1140000-0000-4000-8000-000000000001', 'c1140000-0000-4000-8000-000000000003', 2026, 6, '2026-10-18 17:30:00+00'))),
 ('x4:pre',  pg_temp.trial(format('select pg_temp.with_pre166(%L)',
                                  format('select public.lineup_autopilot_internal(%L::uuid, %L::uuid, 2026, 6, %L::timestamptz)',
                                         'b1140000-0000-4000-8000-000000000001', 'c1140000-0000-4000-8000-000000000003', '2026-10-18 17:30:00+00'))));
create function pg_temp.doc_row(p_tag text) returns text language sql as $$
  select (select string_agg(s ->> 'player_id' || '@' || (s ->> 'kickoff_at'), ',' order by o)
          from r114, jsonb_array_elements(r -> 'doc' -> 'starters') with ordinality x(s, o)
          where tag = p_tag and s ->> 'player_id' is not null)
         || ' | locked_at ' || (select r -> 'doc' ->> 'locked_at' from r114 where tag = p_tag)
         || ' | changed ' || (select r -> 'doc' ->> 'changed' from r114 where tag = p_tag)
$$;
select is('live ' || pg_temp.doc_row('x4:live') || ' || pre166 ' || pg_temp.doc_row('x4:pre'),
  'live x-trd@2026-10-16T00:15:00+00:00,x-sunA@2026-10-18T17:00:00+00:00,x-lt1@2026-10-19T00:20:00+00:00,x-lt2@2026-10-19T00:20:00+00:00 | locked_at 2026-10-16T00:15:00+00:00 | changed true'
  || ' || pre166 x-trd@2026-10-18T17:00:00+00:00,x-sunA@2026-10-18T17:00:00+00:00,x-lt1@2026-10-19T00:20:00+00:00,x-lt2@2026-10-19T00:20:00+00:00 | locked_at 2026-10-18T17:00:00+00:00 | changed true',
  'X4 autopilot filling the empty slots after the new team kickoff: the document it writes keeps XK Trd on his Thursday record (pre-166: Sunday 17:00) — the same seats either way');
-- X5 the tick a minute after X1 (both helpers) keeps what the writer stored;
--    the tick alone (no save) keeps the Thursday record under both.
create function pg_temp.save_then_tick(p_pre boolean) returns jsonb language plpgsql as $$
begin
  if p_pre then execute (select ddl from pre166_helper); end if;
  perform pg_temp.mgr(3, '{"qb:0": "x-trd", "qb:1": "x-sunA", "qb:2": "x-lt1"}', 23, '2026-10-18 17:30:00+00');
  perform set_config('request.jwt.claims', '', true);
  perform public.lineup_lock_tick('2026-10-18 17:31:00+00', 'b1140000-0000-4000-8000-000000000001');
  perform pg_temp.act_as(1);
  return '{}'::jsonb;
end $$;
create function pg_temp.tick_only(p_pre boolean) returns jsonb language plpgsql as $$
begin
  if p_pre then execute (select ddl from pre166_helper); end if;
  perform set_config('request.jwt.claims', '', true);
  perform public.lineup_lock_tick('2026-10-18 17:31:00+00', 'b1140000-0000-4000-8000-000000000001');
  perform pg_temp.act_as(1);
  return '{}'::jsonb;
end $$;
insert into r114 (tag, r) values
 ('x5:live', pg_temp.trial('select pg_temp.save_then_tick(false)')),
 ('x5:pre',  pg_temp.trial('select pg_temp.save_then_tick(true)')),
 ('x5t:live', pg_temp.trial('select pg_temp.tick_only(false)')),
 ('x5t:pre',  pg_temp.trial('select pg_temp.tick_only(true)'));
select is(
  format('save+tick live %s || pre166 %s || tick alone live %s || pre166 %s',
         split_part((select pg_temp.row_of(r, 3, 6) from r114 where tag = 'x5:live'), ',', 1),
         split_part((select pg_temp.row_of(r, 3, 6) from r114 where tag = 'x5:pre'), ',', 1),
         split_part((select pg_temp.row_of(r, 3, 6) from r114 where tag = 'x5t:live'), ',', 1),
         split_part((select pg_temp.row_of(r, 3, 6) from r114 where tag = 'x5t:pre'), ',', 1)),
  'save+tick live x-trd@2026-10-16T00:15:00+00:00[] || pre166 x-trd@2026-10-18T17:00:00+00:00[] || tick alone live x-trd@2026-10-16T00:15:00+00:00[] || pre166 x-trd@2026-10-16T00:15:00+00:00[]',
  'X5 the tick keeps what the writer stored: after the 166 save the Thursday record stays; after a pre-166 save it cannot restore it; and the tick alone keeps Thursday under both (157 arm (b) already kept a passed real record — it never read the helper)');
-- X6 THE LOCK OUTCOMES ARE THE SAME: the manager at 17:30, under both
--    helpers — bench XK Trd (refused), move him (refused), start XK Sun1-
--    style Sunday player… here XK SunA moved (refused), XK Late1 in (lands).
create function pg_temp.mgr_try(p_map text, p_pre boolean) returns jsonb language plpgsql as $$
declare
  v_out text;
begin
  if p_pre then execute (select ddl from pre166_helper); end if;
  begin
    perform pg_temp.mgr(3, p_map, 24, '2026-10-18 17:30:00+00');
    v_out := 'accepted';
  exception when others then
    v_out := sqlerrm;
  end;
  perform pg_temp.act_as(1);
  return to_jsonb(v_out);
end $$;
insert into r114 (tag, r)
select 'x6:' || m.k || ':' || s.side, pg_temp.trial(format('select pg_temp.mgr_try(%L, %s)', m.map, s.pre))
from (values ('bench', '{"qb:0": "x-lt1", "qb:1": "x-sunA"}'),
             ('move',  '{"qb:2": "x-trd", "qb:1": "x-sunA"}'),
             ('sunA',  '{"qb:0": "x-trd", "qb:2": "x-sunA"}'),
             ('add',   '{"qb:0": "x-trd", "qb:1": "x-sunA", "qb:3": "x-lt2"}')) m(k, map),
     (values ('live', 'false'), ('pre', 'true')) s(side, pre);
select is(
  (select string_agg(format('%s: %s', m.k,
            case when (select r ->> 'doc' from r114 where tag = 'x6:' || m.k || ':live') = 'accepted' then 'accepted' else 'refused' end
            || ' / ' ||
            case when (select r ->> 'doc' from r114 where tag = 'x6:' || m.k || ':pre') = 'accepted' then 'accepted' else 'refused' end), ', ' order by m.o)
   from (values (1, 'bench'), (2, 'move'), (3, 'sunA'), (4, 'add')) m(o, k))
  || ' || ' || (select r ->> 'doc' from r114 where tag = 'x6:bench:live')
  || ' || ' || (select r ->> 'doc' from r114 where tag = 'x6:bench:pre'),
  'bench: refused / refused, move: refused / refused, sunA: refused / refused, add: accepted / accepted'
  || ' || set_lineup: slot qb:0 is locked — XK Trd (Thu record, traded) kicked off at 2026-10-16T00:15:00+00:00 (lineup_record) and a locked slot''s player never moves (§11.2, lineup_lock = per_player_kickoff); every other unlocked slot stays editable'
  || ' || set_lineup: slot qb:0 is locked — XK Trd (Thu record, traded) kicked off at 2026-10-18T17:00:00+00:00 (nfl_games) and a locked slot''s player never moves (§11.2, lineup_lock = per_player_kickoff); every other unlocked slot stays editable',
  'X6 NO LOCK OUTCOME CHANGES: benching or moving XK Trd and moving XK SunA are refused, adding XK Late2 lands — the same under both helpers (live / pre-166); only the kickoff the refusal names is now the Thursday game he played');
-- X7 / X8 THE BOUNDARY MATRIX: the datum for every player at every instant,
--    live vs pre-166 — the lock bit (kickoff passed) and the bye bit never
--    differ; the kickoff differs only for the two traded players, and only
--    from the Sunday kickoff on (16:59:59 reads Thursday under both — 157).
create temp table m114 as
select p.pid, t.at,
       l.kickoff_at as l_k, l.datum_arm as l_arm, l.on_bye as l_bye,
       q.kickoff_at as q_k, q.datum_arm as q_arm, q.on_bye as q_bye
from unnest(array['x-trd', 'y-trd', 'x-ir', 'x-sunA', 'x-lt1', 'y-ng', 'y-cut', 'y-early', 'y-post', 'y-flx', 'y-stale', 'y-rel', 'y-prior']) p(pid)
cross join unnest(array['2026-10-16 00:14:59+00', '2026-10-16 00:15:00+00', '2026-10-18 16:59:59+00', '2026-10-18 17:00:00+00',
                        '2026-10-18 17:30:00+00', '2026-10-19 00:20:00+00', '2026-10-19 01:00:00+00']::timestamptz[]) t(at)
cross join lateral public.lineup_player_kickoff_internal('b1140000-0000-4000-8000-000000000001', 2026, 6, p.pid, t.at) l
cross join lateral pg_temp.kick_pre166('b1140000-0000-4000-8000-000000000001', 2026, 6, p.pid, t.at) q;
select is(
  (select format('cells %s | lock bit differs %s | bye bit differs %s', count(*),
                 count(*) filter (where (l_k is not null and l_k <= at) is distinct from (q_k is not null and q_k <= at)),
                 count(*) filter (where l_bye is distinct from q_bye))
   from m114),
  'cells 91 | lock bit differs 0 | bye bit differs 0',
  'X7 over 13 players x 7 instants (a second before and at the Thursday kickoff, a second before and at the Sunday kickoff, 17:30, at and after the flexed kickoff) — the two traded players, the controls, and the review grid (traded to an EARLIER team, played then traded to a postponed or a flexed team, a stale record, released, a prior-week stat line only): the lock bit and the bye bit are the same under both helpers, including XK NG, whose stat line names no game (it never displaces his team kickoff)');
select is(
  (select string_agg(format('%s@%s %s(%s)->%s(%s)', pid, to_char(at at time zone 'UTC', 'MM-DD HH24:MI:SS'),
                            to_char(q_k at time zone 'UTC', 'MM-DD HH24:MI'), q_arm, to_char(l_k at time zone 'UTC', 'MM-DD HH24:MI'), l_arm), ', ' order by pid, at)
   from m114 where l_k is distinct from q_k or l_arm is distinct from q_arm),
  'x-trd@10-18 17:00:00 10-18 17:00(nfl_games)->10-16 00:15(lineup_record), x-trd@10-18 17:30:00 10-18 17:00(nfl_games)->10-16 00:15(lineup_record), x-trd@10-19 00:20:00 10-18 17:00(nfl_games)->10-16 00:15(lineup_record), x-trd@10-19 01:00:00 10-18 17:00(nfl_games)->10-16 00:15(lineup_record), '
  || 'y-flx@10-19 00:20:00 10-19 00:20(nfl_games)->10-16 00:15(stat_line), y-flx@10-19 01:00:00 10-19 00:20(nfl_games)->10-16 00:15(stat_line), '
  || 'y-post@10-19 00:20:00 10-18 20:00(nfl_games)->10-16 00:15(stat_line), y-post@10-19 01:00:00 10-18 20:00(nfl_games)->10-16 00:15(stat_line), '
  || 'y-stale@10-19 00:20:00 10-19 00:20(nfl_games)->10-18 17:00(lineup_record), y-stale@10-19 01:00:00 10-19 00:20(nfl_games)->10-18 17:00(lineup_record), '
  || 'y-trd@10-18 17:00:00 10-18 17:00(nfl_games)->10-16 00:15(stat_line), y-trd@10-18 17:30:00 10-18 17:00(nfl_games)->10-16 00:15(stat_line), y-trd@10-19 00:20:00 10-18 17:00(nfl_games)->10-16 00:15(stat_line), y-trd@10-19 01:00:00 10-18 17:00(nfl_games)->10-16 00:15(stat_line)',
  'X8 …and the ONLY differences (pre-166 -> live), each once his current team kickoff has passed: the players who played Thursday and were then traded — to a Sunday team (XK Trd by the lineup record, XK UTrd by his stat line), to the postponed team (XK Post) or to the flexed team (XK Flx) — keep the Thursday game; and XK Stale (F504, a residual): a stale record at an instant another game shares (17:00) is preferred over his real later kickoff — record only (X7: the lock bit is equal). Traded to an earlier team, released, and a prior-week stat line change nothing');

select * from finish();
rollback;
