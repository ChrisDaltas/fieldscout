-- ============================================================================
-- 120 — each league's record of a stat correction, the announcement, F245's
--       apply half, the bracket re-sync (migration 172; M6 L.E2.2; spec
--       §23.4 v2.16.83, §12.21, §11.4, §16.4; tasks-M6 TD6 / TD7 / TD8 as
--       ruled by Q81 — PROGRESS D438 / D439 / D440, F510; D453; F245 /
--       F476 / F511)
-- ============================================================================
-- What this file proves, over REAL calls of the scoring door in one
-- rolled-back transaction:
--   §A  FORM and D137 — the table (columns, CHECKs, FKs, RLS: one SELECT
--       policy and no write policy), the three new functions (two DEFINER
--       doors REVOKEd with EXECUTE for the service role, two plain helpers
--       REVOKEd), score_write_week_batch still ONE overload, its body a
--       STORED-LITERAL md5 and — with the five fenced 172 hunks reversed on
--       the LIVE prosrc (pg_temp.un172) — 158''s body byte for byte; the
--       overridden-row exclusions unchanged (3).
--   §B  ROLES — anon / an outsider read no record; a member reads his own
--       league''s and none of another''s; nobody writes (RETURNING counts); no
--       signed-in caller runs the door or the two new service doors (the
--       REVOKE and the in-body refusal).
--   §C  THE CORRECTION THAT FLIPS RESULTS (a correction_window week): one
--       record for the ONE team that started the corrected player (stored
--       literals), its results before / after derived from the scores; the
--       ONE league post names the correction, the team score, every flipped
--       pairing (the second-opponent row included) and the median knock-on;
--       a notification ONLY to each manager whose result changed — the
--       opponent and the third team whose median flipped included, the
--       unaffected manager not; no commissioner_actions row (a correction is
--       not an override — D345 untouched); the stored matchups.result stays
--       NULL (TD8 as measured).
--   §S  THE STARTER FILTER and the loud emptiness — a benched player''s event
--       writes no record (not_started); a stat the league does not score
--       writes none (no_points_moved); an overridden row writes none
--       (score_not_written); an identical re-send records nothing; every
--       reason named in the report; no post for nothing.
--   §L  A LIVE week — the record is written without results (the games are
--       still being played), the post goes, no notification.
--   §R  THE ROLLBACK — a failure while writing the record rolls the re-score
--       back with it (the scores and the stored per-player points as they
--       were): the record is IN the re-score''s transaction.
--   §D  RESULT WITH SCORE (F245, TD8) — the corrected week through the REAL
--       finalize_matchups and rebuild_team_week_results: no result_drift,
--       the stored results are the ones the record derived.
--   §F  THE FINAL WEEK — the door''s week_final refusal is unchanged with the
--       element; nothing moves in any league cell.
--   §V  the element''s shape — refused by name (not an array, without
--       players, a non-uuid, an event of another week).
--   §P  APPLIED — stat_correction_mark_applied stamps the named, unapplied
--       events at the caller''s instant; a replay stamps nothing.
--   §W  THE ONE-TIME BACKFILL (R1342(a)) — events recorded before 172 whose
--       row is drained are stamped at their own detected_at; queued ones wait.
--   (§S S6–S8, R1342) an event this league already recorded is never
--       re-announced by a later correction to the same player-week.
--   §K  F476 — bracket_resync_due on the last regular week of a league with
--       a bracket (and not without one); score_bracket_resync runs the sync.
-- Worlds (season 2089 — its own calendar; measured unused 2026-09-30):
--   LA b1200000…0a — h2h, median game ON, 4 teams, NO bracket (playoff_teams
--     0): week 1 FINAL, week 2 CORRECTION_WINDOW, week 3 LIVE. Week 2:
--     T1 100.00 v T2 97.00, T3 95.00 v T4 80.00, and the secondary row
--     T1 v T3. T1 starts q1 (60) + w1 (40) and benches w2. Median 96.
--   LB b1200000…0b — h2h, a bracket (playoff_teams 2), regular season 2
--     weeks; week 2 CORRECTION_WINDOW: TB1 v TB2 OVERRIDDEN, TB3 v TB4.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(72);

-- pg_temp.un177 — 177's four hunks reversed (derive_177.py; pgTAP 125).
create function pg_temp.un177(s text) returns text language plpgsql as $un$
declare a int; b int; seg text;
begin
  -- H4 reversed: inside the post / notification block only (the v_butfor
  -- but-for joins and conditions out — 172 reads v_after alone)
  a := strpos(s, $r$    IF jsonb_array_length(v_rec) > 0 THEN
$r$);
  if a > 0 then
    b := a + strpos(substr(s, a), $r$    v_corr := jsonb_build_object(
$r$) - 1;
    seg := substr(s, a, b - a);
    seg := replace(seg, $r$          JOIN jsonb_each(v_butfor -> 'matchups') c ON c.key = a.key
$r$, $o$$o$);
    seg := replace(seg, $r$
            AND (a.value ->> 'result') IS DISTINCT FROM (c.value ->> 'result')$r$, $o$$o$);
    seg := replace(seg, $r$        JOIN jsonb_each(v_butfor -> 'teams') c ON c.key = a.key
        JOIN public.teams t$r$, $o$        JOIN public.teams t$o$);
    seg := replace(seg, $r$
          AND (a.value ->> 'median') IS DISTINCT FROM (c.value ->> 'median');$r$, $o$;$o$);
    seg := replace(seg, $r$, b.value AS bef, c.value AS bf
$r$, $o$, b.value AS bef
$o$);
    seg := replace(seg, $r$          JOIN jsonb_each(v_butfor -> 'teams') c ON c.key = a.key
          WHERE ((a.value ->> 'h2h') IS DISTINCT FROM (b.value ->> 'h2h') AND (a.value ->> 'h2h') IS DISTINCT FROM (c.value ->> 'h2h'))
             OR ((a.value ->> 'second') IS DISTINCT FROM (b.value ->> 'second') AND (a.value ->> 'second') IS DISTINCT FROM (c.value ->> 'second'))
             OR ((a.value ->> 'median') IS DISTINCT FROM (b.value ->> 'median') AND (a.value ->> 'median') IS DISTINCT FROM (c.value ->> 'median'))
$r$, $o$          WHERE ROW(a.value ->> 'h2h', a.value ->> 'second', a.value ->> 'median')
                IS DISTINCT FROM ROW(b.value ->> 'h2h', b.value ->> 'second', b.value ->> 'median')
$o$);
    seg := replace(seg, $r$ AND (v_pl.aft ->> 'h2h') IS DISTINCT FROM (v_pl.bf ->> 'h2h') THEN
$r$, $o$ THEN
$o$);
    seg := replace(seg, $r$ AND (v_pl.aft ->> 'second') IS DISTINCT FROM (v_pl.bf ->> 'second') THEN
$r$, $o$ THEN
$o$);
    seg := replace(seg, $r$ AND (v_pl.aft ->> 'median') IS DISTINCT FROM (v_pl.bf ->> 'median') THEN
$r$, $o$ THEN
$o$);
    s := substr(s, 1, a - 1) || seg || substr(s, b);
  end if;
  s := replace(s, $r$      END LOOP;
    END LOOP;

    -- 177 (B12 / F557; R1446 — ONE but-for test, ruled 2026-10-02): a result
    -- changed BY THE CORRECTION is one that changed (after <> before) AND
    -- that the correction caused: the actual after week differs from the
    -- BUT-FOR week (the after week with only this call's corrections taken
    -- back out, every other team at its actual after score) — per h2h,
    -- second game and median (§11.7) and per pairing. A flip another team's
    -- move made alone, or one it undid, is never the correction's; a flip
    -- that needs both the correction and another team's move IS. Every
    -- result and score recorded, posted or notified is the ACTUAL after
    -- week's. `result_changed` therefore means "changed by the correction":
    -- a record may honestly carry result_before <> result_after with
    -- result_changed false when another team's move alone changed it
    -- (pgTAP 125 O pins that meaning; the column comment below says it).
    v_butfor := public.stat_correction_week_state_but_for_internal(p_league_id, v_league.season, p_week, v_after, v_moves);
    FOR v_pr IN SELECT value FROM jsonb_array_elements(v_pend) WITH ORDINALITY ORDER BY ordinality LOOP
      v_tid := (v_pr ->> 'team_id')::uuid;
      v_tb := v_before -> 'teams' -> (v_tid::text);
      v_ta := v_after  -> 'teams' -> (v_tid::text);
      v_tf := v_butfor -> 'teams' -> (v_tid::text);
      INSERT INTO public.league_stat_corrections
        (league_id, season, week, team_id, player_id, slot, matchup_id, event_ids, stat_changes,
         player_points_before, player_points_after, team_score_before, team_score_after,
         result_before, result_after, result_changed)
      VALUES (p_league_id, v_league.season, p_week, v_tid, v_pr ->> 'player_id', v_pr ->> 'slot',
              (v_pr ->> 'matchup_id')::uuid,
              ARRAY(SELECT (x.value #>> '{}')::uuid FROM jsonb_array_elements(v_pr -> 'event_ids') WITH ORDINALITY x ORDER BY x.ordinality),
              v_pr -> 'changes',
              (v_pr ->> 'pp_before')::numeric, (v_pr ->> 'pp_after')::numeric, (v_pr ->> 'score_b')::numeric, (v_pr ->> 'score_a')::numeric,
              CASE WHEN v_results_final THEN jsonb_build_object('h2h', v_tb ->> 'h2h', 'second', v_tb ->> 'second', 'median', v_tb ->> 'median') END,
              CASE WHEN v_results_final THEN jsonb_build_object('h2h', v_ta ->> 'h2h', 'second', v_ta ->> 'second', 'median', v_ta ->> 'median') END,
              v_results_final AND (
                   ((v_ta ->> 'h2h') IS DISTINCT FROM (v_tb ->> 'h2h') AND (v_ta ->> 'h2h') IS DISTINCT FROM (v_tf ->> 'h2h'))
                OR ((v_ta ->> 'second') IS DISTINCT FROM (v_tb ->> 'second') AND (v_ta ->> 'second') IS DISTINCT FROM (v_tf ->> 'second'))
                OR ((v_ta ->> 'median') IS DISTINCT FROM (v_tb ->> 'median') AND (v_ta ->> 'median') IS DISTINCT FROM (v_tf ->> 'median'))))
      RETURNING id INTO v_cid;
      v_rec := v_rec || jsonb_build_object(
        'id', v_cid, 'team_id', v_tid, 'player_id', v_pr ->> 'player_id', 'event_ids', v_pr -> 'event_ids',
        'player_points_before', v_pr -> 'pp_before', 'player_points_after', v_pr -> 'pp_after',
        'team_score_before', v_pr -> 'score_b', 'team_score_after', v_pr -> 'score_a');
    END LOOP;

    IF jsonb_array_length(v_rec) > 0 THEN
$r$, $o$      END LOOP;
    END LOOP;

    IF jsonb_array_length(v_rec) > 0 THEN
$o$);
  s := replace(s, $r$        v_score_b := (v_tb ->> 'score')::numeric;
        v_score_a := (v_ta ->> 'score')::numeric;
        -- 177 (B12 / F557): the record is HELD — its result is the one THIS
        -- call's corrections made, which needs every record of the call; the
        -- team's movement is the corrected players' own points, never the
        -- rest of its score.
        v_moves := jsonb_set(v_moves, ARRAY[v_tid::text],
          to_jsonb(COALESCE((v_moves ->> v_tid::text)::numeric, 0)
                   + COALESCE((v_pp_after ->> 'points')::numeric, 0) - COALESCE(v_pp_before, 0)));
        v_pend := v_pend || jsonb_build_object(
          'team_id', v_tid, 'player_id', v_pl.player_id, 'slot', v_pp_after ->> 'slot',
          'matchup_id', v_ta ->> 'matchup_id', 'event_ids', to_jsonb(v_pl.ids), 'changes', v_pl.changes,
          'pp_before', v_pp_before, 'pp_after', (v_pp_after ->> 'points')::numeric,
          'score_b', v_score_b, 'score_a', v_score_a);
$r$, $o$        v_score_b := (v_tb ->> 'score')::numeric;
        v_score_a := (v_ta ->> 'score')::numeric;
        INSERT INTO public.league_stat_corrections
          (league_id, season, week, team_id, player_id, slot, matchup_id, event_ids, stat_changes,
           player_points_before, player_points_after, team_score_before, team_score_after,
           result_before, result_after, result_changed)
        VALUES (p_league_id, v_league.season, p_week, v_tid, v_pl.player_id, v_pp_after ->> 'slot',
                (v_ta ->> 'matchup_id')::uuid, v_pl.ids, v_pl.changes,
                v_pp_before, (v_pp_after ->> 'points')::numeric, v_score_b, v_score_a,
                CASE WHEN v_results_final THEN jsonb_build_object('h2h', v_tb ->> 'h2h', 'second', v_tb ->> 'second', 'median', v_tb ->> 'median') END,
                CASE WHEN v_results_final THEN jsonb_build_object('h2h', v_ta ->> 'h2h', 'second', v_ta ->> 'second', 'median', v_ta ->> 'median') END,
                v_results_final AND ROW(v_tb ->> 'h2h', v_tb ->> 'second', v_tb ->> 'median')
                                    IS DISTINCT FROM ROW(v_ta ->> 'h2h', v_ta ->> 'second', v_ta ->> 'median'))
        RETURNING id INTO v_cid;
        v_rec := v_rec || jsonb_build_object(
          'id', v_cid, 'team_id', v_tid, 'player_id', v_pl.player_id, 'event_ids', to_jsonb(v_pl.ids),
          'player_points_before', v_pp_before, 'player_points_after', (v_pp_after ->> 'points')::numeric,
          'team_score_before', v_score_b, 'team_score_after', v_score_a);
$o$);
  s := replace(s, $r$  v_oname      TEXT;
  -- 177 (B12 / F557; R1446): the BUT-FOR week — the actual week without the correction
  v_moves      JSONB := '{}'::jsonb;    -- team -> its recorded players' points movement
  v_butfor     JSONB;                   -- v_after with ONLY those movements taken back out
  v_pend       JSONB := '[]'::jsonb;    -- this call's records, held until v_butfor is known
  v_pr         JSONB;
  v_tf         JSONB;                   -- a team in the but-for week
  -- @172}
$r$, $o$  v_oname      TEXT;
  -- @172}
$o$);
  return s;
end $un$;

-- 172's five fenced hunks reversed on the live body (D137) — ONE regexp.
create function pg_temp.un172(p_src text) returns text language sql as $un172$
  select regexp_replace(p_src, E'[ ]*-- @172\\{[^@]*-- @172\\}\\n', '', 'g');
$un172$;

-- ---------------------------------------------------------------------------
-- A. FORM
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position)
   from information_schema.columns where table_schema = 'public' and table_name = 'league_stat_corrections'),
  'id:uuid:NO,league_id:uuid:NO,season:integer:NO,week:integer:NO,team_id:uuid:NO,player_id:text:NO,slot:text:NO,matchup_id:uuid:YES,'
  'event_ids:ARRAY:NO,stat_changes:jsonb:NO,player_points_before:numeric:YES,player_points_after:numeric:NO,team_score_before:numeric:YES,'
  'team_score_after:numeric:YES,result_before:jsonb:YES,result_after:jsonb:YES,result_changed:boolean:NO,recorded_at:timestamp with time zone:NO',
  'A1 league_stat_corrections: one row per league / week / team / player — the events and their words, his points, the team score and the results, each before and after');
select is(
  (select string_agg(pg_get_constraintdef(c.oid), ' | ' order by c.contype, pg_get_constraintdef(c.oid) collate "C") from pg_constraint c
   where c.conrelid = 'public.league_stat_corrections'::regclass),
  'CHECK (((cardinality(event_ids) > 0) AND (jsonb_typeof(stat_changes) = ''array''::text))) | '
  'CHECK ((player_points_before IS DISTINCT FROM player_points_after)) | '
  'FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE | '
  'FOREIGN KEY (league_id, season, week) REFERENCES league_weeks(league_id, season, week) ON DELETE CASCADE | '
  'FOREIGN KEY (matchup_id) REFERENCES matchups(id) ON DELETE SET NULL | '
  'FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE | '
  'FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE | '
  'PRIMARY KEY (id)',
  'A2 a record always names an event and always MOVED his points (a correction that moves no points writes nothing); the league / week / team / player FKs cascade, the matchup one lets go');
select is(
  (select relrowsecurity::text || ':' || (select string_agg(polname || '=' || polcmd::text, ',') from pg_policy where polrelid = c.oid)
   from pg_class c where c.oid = 'public.league_stat_corrections'::regclass),
  'true:Stat correction records viewable by league members=r',
  'A3 RLS on, exactly ONE policy and it is SELECT (league members) — no write policy for any role');
select ok(
  (select bool_and(p.prosecdef = (p.proname in ('score_write_week_batch', 'stat_correction_mark_applied', 'score_bracket_resync'))
                   and array_to_string(p.proconfig, ',') = 'search_path=""'
                   and not has_function_privilege('anon', p.oid, 'EXECUTE')
                   and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   and (not p.prosecdef or has_function_privilege('service_role', p.oid, 'EXECUTE')))
          and count(*) = 6
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('score_write_week_batch', 'stat_correction_mark_applied', 'score_bracket_resync',
                       'stat_key_label_internal', 'stat_correction_week_state_internal', 'stat_correction_backfill_applied_internal')),
  'A4 the three doors are SECURITY DEFINER with EXECUTE for the service role, the three helpers plain; all six search_path empty and REVOKEd from anon and authenticated');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'score_write_week_batch'),
  1, 'A5 score_write_week_batch is still ONE overload — the element rides the same signature (074 K3)');
-- RE-CUT BY 177 (B12 / F557): A6 reads the live body through pg_temp.un177
-- INNERMOST (additive — the 172 stored literal unchanged); pgTAP 125 A3 pins 177.
select is(
  (select md5(pg_temp.un177(prosrc)) from pg_proc where oid = 'public.score_write_week_batch(uuid,integer,jsonb)'::regprocedure),
  '7fbb74085768afd0f9d56a235f1ebabb',
  'A6 score_write_week_batch is 172''s body — a STORED LITERAL md5 (derive_172.py: 158:409-720 plus five fenced hunks), read with 177''s four hunks reversed (pg_temp.un177; 125 A3 pins 177)');
select is(
  (select md5(pg_temp.un172(prosrc)) from pg_proc where oid = 'public.score_write_week_batch(uuid,integer,jsonb)'::regprocedure),
  '548958d0a402c352c91c23fa924a2a0f',
  'A7 …and with the five hunks reversed on the LIVE body it is 158''s BYTE FOR BYTE (D137; pgTAP 106 A7''s stored literal)');
select is(
  (select (length(prosrc) - length(replace(prosrc, 'NOT m.is_overridden', ''))) / length('NOT m.is_overridden')
   from pg_proc where oid = 'public.score_write_week_batch(uuid,integer,jsonb)'::regprocedure),
  3, 'A8 still THREE overridden-row exclusions (158''s — 106 A9): the records ride the rows 158 already judged writable, never a new predicate');
select is(
  (select count(*)::int from pg_trigger where tgrelid = 'public.league_stat_corrections'::regclass and not tgisinternal)
  || ':' || (not has_table_privilege('anon', 'public.league_stat_corrections', 'TRUNCATE')
             and not has_table_privilege('authenticated', 'public.league_stat_corrections', 'TRUNCATE'))::text,
  '0:true', 'A9 no trigger on the table; no TRUNCATE for anon or authenticated (133''s default ACL)');
select is(public.stat_key_label_internal('receiving_yards') || ' | ' || public.stat_key_label_internal('pat_made') || ' | '
          || public.stat_key_label_internal('def_return_td') || ' | ' || public.stat_key_label_internal('not_a_key'),
  'receiving yards | PAT made | return TD (D/ST) | not a key',
  'A10 a stat key in plain words (the registry''s labels — stat-correction-labels.test.ts pins the whole map), never a code word');

-- ---------------------------------------------------------------------------
-- FIXTURES (postgres context, JWT cleared).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('9f120000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-lsc' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'lsc_user' || i)::jsonb, now(), now()
from generate_series(1, 6) i;
-- u1 commissioner (T1), u2 T2, u3 T3, u4 T4, u5 an outsider, u6 LB''s commissioner.

insert into nfl_weeks (season, week, starts_at, first_kickoff_at, correction_window_ends_at) values
 (2089, 1, '2089-09-05 04:00+00', '2089-09-07 00:15+00', '2089-09-13 10:00+00'),
 (2089, 2, '2089-09-12 04:00+00', '2089-09-14 00:15+00', '2089-09-20 10:00+00'),
 (2089, 3, '2089-09-19 04:00+00', '2089-09-21 00:15+00', '2089-09-27 10:00+00');
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('pgtap-lsc-g1', 2089, 1, 'KC', 'BUF', '2089-09-07 00:15+00', 'final'),
 ('pgtap-lsc-g2', 2089, 2, 'KC', 'BUF', '2089-09-14 00:15+00', 'final'),
 ('pgtap-lsc-g3', 2089, 3, 'KC', 'BUF', '2089-09-21 00:15+00', 'in_progress');

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks,
                     playoff_teams, playoff_start_week, faab_budget,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings)
select l.id::uuid, l.owner::uuid, l.name, 2089, 'in_season', 8, l.rsw, l.pt, l.rsw + 1, 100,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', l.settings::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'
from (values ('b1200000-0000-4000-8000-00000000000a', '9f120000-0000-4000-8000-000000000001', 'pgtap-lsc-LA', 3, 0, '{"schedule_mode": "h2h", "median_game": true}'),
             ('b1200000-0000-4000-8000-00000000000b', '9f120000-0000-4000-8000-000000000006', 'pgtap-lsc-LB', 2, 2, '{"schedule_mode": "h2h"}')) l(id, owner, name, rsw, pt, settings);

insert into teams (id, owner_id, name, league_id) values
 ('c1200000-0000-4000-8000-000000000001', '9f120000-0000-4000-8000-000000000001', 'Team One',   'b1200000-0000-4000-8000-00000000000a'),
 ('c1200000-0000-4000-8000-000000000002', '9f120000-0000-4000-8000-000000000002', 'Team Two',   'b1200000-0000-4000-8000-00000000000a'),
 ('c1200000-0000-4000-8000-000000000003', '9f120000-0000-4000-8000-000000000003', 'Team Three', 'b1200000-0000-4000-8000-00000000000a'),
 ('c1200000-0000-4000-8000-000000000004', '9f120000-0000-4000-8000-000000000004', 'Team Four',  'b1200000-0000-4000-8000-00000000000a'),
 ('c1200000-0000-4000-8000-000000000011', '9f120000-0000-4000-8000-000000000006', 'Bees One',   'b1200000-0000-4000-8000-00000000000b'),
 ('c1200000-0000-4000-8000-000000000012', '9f120000-0000-4000-8000-000000000006', 'Bees Two',   'b1200000-0000-4000-8000-00000000000b'),
 ('c1200000-0000-4000-8000-000000000013', '9f120000-0000-4000-8000-000000000006', 'Bees Three', 'b1200000-0000-4000-8000-00000000000b'),
 ('c1200000-0000-4000-8000-000000000014', '9f120000-0000-4000-8000-000000000006', 'Bees Four',  'b1200000-0000-4000-8000-00000000000b');
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance) values
 ('b1200000-0000-4000-8000-00000000000a', '9f120000-0000-4000-8000-000000000001', 'c1200000-0000-4000-8000-000000000001', 'commissioner', false, 100),
 ('b1200000-0000-4000-8000-00000000000a', '9f120000-0000-4000-8000-000000000002', 'c1200000-0000-4000-8000-000000000002', 'manager',      false, 100),
 ('b1200000-0000-4000-8000-00000000000a', '9f120000-0000-4000-8000-000000000003', 'c1200000-0000-4000-8000-000000000003', 'manager',      false, 100),
 ('b1200000-0000-4000-8000-00000000000a', '9f120000-0000-4000-8000-000000000004', 'c1200000-0000-4000-8000-000000000004', 'manager',      false, 100),
 ('b1200000-0000-4000-8000-00000000000b', '9f120000-0000-4000-8000-000000000006', 'c1200000-0000-4000-8000-000000000011', 'commissioner', false, 100);

insert into players (id, full_name, position, team, status) values
 ('pgtap-lsc-q1', 'Quinn One',   'QB', 'KC',  'Active'),
 ('pgtap-lsc-w1', 'Wade One',    'WR', 'KC',  'Active'),
 ('pgtap-lsc-w2', 'Walt Bench',  'WR', 'KC',  'Active'),
 ('pgtap-lsc-q2', 'Quinn Two',   'QB', 'BUF', 'Active'),
 ('pgtap-lsc-q3', 'Quinn Three', 'QB', 'BUF', 'Active'),
 ('pgtap-lsc-q4', 'Quinn Four',  'QB', 'BUF', 'Active'),
 ('pgtap-lsc-b1', 'Bea One',     'QB', 'KC',  'Active'),
 ('pgtap-lsc-b3', 'Bea Three',   'QB', 'KC',  'Active');

insert into league_weeks (league_id, season, week, status) values
 ('b1200000-0000-4000-8000-00000000000a', 2089, 1, 'final'),
 ('b1200000-0000-4000-8000-00000000000a', 2089, 2, 'correction_window'),
 ('b1200000-0000-4000-8000-00000000000a', 2089, 3, 'live'),
 ('b1200000-0000-4000-8000-00000000000b', 2089, 1, 'final'),
 ('b1200000-0000-4000-8000-00000000000b', 2089, 2, 'correction_window'),
 ('b1200000-0000-4000-8000-00000000000b', 2089, 3, 'upcoming');

insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status, result, is_overridden) values
 ('d1200000-0000-4000-8000-000000000011', 'b1200000-0000-4000-8000-00000000000a', 2089, 1, 'regular', 'c1200000-0000-4000-8000-000000000001', 'c1200000-0000-4000-8000-000000000002', 50.00, 40.00, 'final', 'home', false),
 ('d1200000-0000-4000-8000-000000000012', 'b1200000-0000-4000-8000-00000000000a', 2089, 1, 'regular', 'c1200000-0000-4000-8000-000000000003', 'c1200000-0000-4000-8000-000000000004', 30.00, 20.00, 'final', 'home', false),
 ('d1200000-0000-4000-8000-000000000021', 'b1200000-0000-4000-8000-00000000000a', 2089, 2, 'regular',   'c1200000-0000-4000-8000-000000000001', 'c1200000-0000-4000-8000-000000000002', 100.00, 97.00, 'live', null, false),
 ('d1200000-0000-4000-8000-000000000022', 'b1200000-0000-4000-8000-00000000000a', 2089, 2, 'regular',   'c1200000-0000-4000-8000-000000000003', 'c1200000-0000-4000-8000-000000000004', 95.00, 80.00, 'live', null, false),
 ('d1200000-0000-4000-8000-000000000023', 'b1200000-0000-4000-8000-00000000000a', 2089, 2, 'secondary', 'c1200000-0000-4000-8000-000000000001', 'c1200000-0000-4000-8000-000000000003', 100.00, 95.00, 'live', null, false),
 ('d1200000-0000-4000-8000-000000000031', 'b1200000-0000-4000-8000-00000000000a', 2089, 3, 'regular',   'c1200000-0000-4000-8000-000000000001', 'c1200000-0000-4000-8000-000000000002', 10.00, 12.00, 'live', null, false),
 ('d1200000-0000-4000-8000-000000000032', 'b1200000-0000-4000-8000-00000000000a', 2089, 3, 'regular',   'c1200000-0000-4000-8000-000000000003', 'c1200000-0000-4000-8000-000000000004', 5.00, 6.00, 'live', null, false),
 ('d1200000-0000-4000-8000-000000000041', 'b1200000-0000-4000-8000-00000000000b', 2089, 2, 'regular',   'c1200000-0000-4000-8000-000000000011', 'c1200000-0000-4000-8000-000000000012', 70.00, 60.00, 'live', 'home', true),
 ('d1200000-0000-4000-8000-000000000042', 'b1200000-0000-4000-8000-00000000000b', 2089, 2, 'regular',   'c1200000-0000-4000-8000-000000000013', 'c1200000-0000-4000-8000-000000000014', 50.00, 40.00, 'live', null, false);

-- The per-player rows each open week's score was stored with (158).
insert into league_week_player_points (league_id, season, week, team_id, slot, player_id, points, reason, source) values
 ('b1200000-0000-4000-8000-00000000000a', 2089, 2, 'c1200000-0000-4000-8000-000000000001', 'qb:0', 'pgtap-lsc-q1', 60.00, 'scored', 'worker'),
 ('b1200000-0000-4000-8000-00000000000a', 2089, 2, 'c1200000-0000-4000-8000-000000000001', 'wr:0', 'pgtap-lsc-w1', 40.00, 'scored', 'worker'),
 ('b1200000-0000-4000-8000-00000000000a', 2089, 2, 'c1200000-0000-4000-8000-000000000002', 'qb:0', 'pgtap-lsc-q2', 97.00, 'scored', 'worker'),
 ('b1200000-0000-4000-8000-00000000000a', 2089, 2, 'c1200000-0000-4000-8000-000000000003', 'qb:0', 'pgtap-lsc-q3', 95.00, 'scored', 'worker'),
 ('b1200000-0000-4000-8000-00000000000a', 2089, 2, 'c1200000-0000-4000-8000-000000000004', 'qb:0', 'pgtap-lsc-q4', 80.00, 'scored', 'worker'),
 ('b1200000-0000-4000-8000-00000000000a', 2089, 3, 'c1200000-0000-4000-8000-000000000001', 'qb:0', 'pgtap-lsc-q1', 10.00, 'scored', 'worker'),
 ('b1200000-0000-4000-8000-00000000000b', 2089, 2, 'c1200000-0000-4000-8000-000000000013', 'qb:0', 'pgtap-lsc-b3', 50.00, 'scored', 'worker');

-- The corrections the stats poll recorded (167 — what ingest_write_batch writes).
insert into stat_correction_events (id, season, week, player_id, stat_key, old_value, new_value, detected_at, week_state, source, game_id) values
 ('e1200000-0000-4000-8000-000000000001', 2089, 2, 'pgtap-lsc-w1', 'receiving_yards', 97, 37, '2089-09-16 15:00+00', 'open', 'pgtap', 'pgtap-lsc-g2'),
 ('e1200000-0000-4000-8000-000000000002', 2089, 2, 'pgtap-lsc-w2', 'receiving_yards', 50, 60, '2089-09-16 15:00+00', 'open', 'pgtap', 'pgtap-lsc-g2'),
 ('e1200000-0000-4000-8000-000000000003', 2089, 2, 'pgtap-lsc-q1', 'targets',         5,  6,  '2089-09-16 15:00+00', 'open', 'pgtap', 'pgtap-lsc-g2'),
 ('e1200000-0000-4000-8000-000000000004', 2089, 1, 'pgtap-lsc-w1', 'receiving_yards', 20, 30, '2089-09-16 15:00+00', 'final', 'pgtap', 'pgtap-lsc-g1'),
 ('e1200000-0000-4000-8000-000000000005', 2089, 3, 'pgtap-lsc-q1', 'pass_yards',      100, 125, '2089-09-21 03:00+00', 'open', 'pgtap', 'pgtap-lsc-g3'),
 ('e1200000-0000-4000-8000-000000000006', 2089, 2, 'pgtap-lsc-b1', 'pass_yards',      200, 225, '2089-09-16 15:00+00', 'open', 'pgtap', 'pgtap-lsc-g2'),
 ('e1200000-0000-4000-8000-000000000007', 2089, 2, 'pgtap-lsc-w1', 'receiving_yards', 37,  42,  '2089-09-17 15:00+00', 'open', 'pgtap', 'pgtap-lsc-g2'),
 ('e1200000-0000-4000-8000-000000000008', 2089, 3, 'pgtap-lsc-q1', 'pass_yards',      125, 150, '2089-09-21 04:00+00', 'open', 'pgtap', 'pgtap-lsc-g3');

-- Every stored cell of LB (the "nothing moves" digest) and LA week 1.
create function pg_temp.cells(p_league uuid, p_week int) returns text language sql as $dg$
  select coalesce((select md5(string_agg(m.id::text || ':' || coalesce(m.home_score::text, 'N') || ':' || coalesce(m.away_score::text, 'N')
                          || ':' || coalesce(m.result, 'N') || ':' || m.status || ':' || m.is_overridden::text, '|' order by m.id))
                   from public.matchups m where m.league_id = p_league and m.week = p_week), 'none')
      || coalesce((select md5(string_agg(p.team_id::text || p.slot || p.points::text, '|' order by p.team_id, p.slot))
                   from public.league_week_player_points p where p.league_id = p_league and p.week = p_week), 'none')
      || coalesce((select md5(string_agg(r.team_id::text || r.points::text || coalesce(r.h2h_result, 'N'), '|' order by r.team_id))
                   from public.team_week_results r where r.league_id = p_league and r.week = p_week), 'none');
$dg$;

-- ---------------------------------------------------------------------------
-- C. THE CORRECTION THAT FLIPS RESULTS — Wade One (T1''s starting WR) loses
--    60 receiving yards: 40.00 → 34.00, T1 100.00 → 94.00.
-- ---------------------------------------------------------------------------
select set_config('pgtap.cmsh', (select count(*)::text from commissioner_actions where league_id = 'b1200000-0000-4000-8000-00000000000a'), true);
select set_config('pgtap.r', public.score_write_week_batch('b1200000-0000-4000-8000-00000000000a', 2, '[
  {"team_id": "c1200000-0000-4000-8000-000000000001", "points": 94.00,
   "players": [{"slot": "qb:0", "player_id": "pgtap-lsc-q1", "points": 60, "pending": [], "reason": "scored"},
               {"slot": "wr:0", "player_id": "pgtap-lsc-w1", "points": 34, "pending": [], "reason": "scored"}],
   "corrections": ["e1200000-0000-4000-8000-000000000001"]}]')::text, true);
select is(
  (current_setting('pgtap.r')::jsonb ->> 'written') || ' ' || (current_setting('pgtap.r')::jsonb -> 'corrections' ->> 'recorded')
  || ' ' || (current_setting('pgtap.r')::jsonb -> 'corrections' ->> 'results_final') || ' ' || (current_setting('pgtap.r')::jsonb -> 'corrections' -> 'skipped')::text,
  '2 1 true []',
  'C1 the re-score wrote T1''s two pairing rows (primary + second game) and ONE record; the week''s games are over, so results are final');
select is(
  (select string_agg(team_id::text || ' ' || player_id || ' ' || slot || ' ' || matchup_id::text || ' ' || array_to_string(event_ids, ',')
                     || ' ' || player_points_before::text || '→' || player_points_after::text || ' ' || team_score_before::text || '→' || team_score_after::text
                     || ' ' || result_before::text || ' → ' || result_after::text || ' changed=' || result_changed::text, E'\n')
   from league_stat_corrections where league_id = 'b1200000-0000-4000-8000-00000000000a' and week = 2),
  'c1200000-0000-4000-8000-000000000001 pgtap-lsc-w1 wr:0 d1200000-0000-4000-8000-000000000021 e1200000-0000-4000-8000-000000000001 40.00→34.00 100.00→94.00 '
  '{"h2h": "win", "median": "win", "second": "win"} → {"h2h": "loss", "median": "loss", "second": "loss"} changed=true',
  'C2 GOLDEN (stored literal): ONE record — the team that STARTED him, his slot, the pairing, the event, his points 40 → 34, the team 100 → 94, and its results derived from the scores: it now loses its matchup, its second game and the median');
select is(
  (select stat_changes::text from league_stat_corrections where league_id = 'b1200000-0000-4000-8000-00000000000a' and week = 2),
  '[{"new": 37, "old": 97, "label": "receiving yards", "event_id": "e1200000-0000-4000-8000-000000000001", "stat_key": "receiving_yards"}]',
  'C3 …and the words the corrections view reads: receiving yards 97 → 37 (the key in plain words, never a code word)');
select is(
  (select message from league_chat where league_id = 'b1200000-0000-4000-8000-00000000000a' and is_system order by created_at desc limit 1),
  'Stat correction (Week 2): Wade One''s receiving yards 97 → 37 — Team One 100.00 → 94.00. Result changed: Team Two now beats Team One 97.00–94.00; Team Three now beats Team One 95.00–94.00 (second game). Median game: Team One now loses the median game (it was winning); Team Three now wins the median game (it was losing).',
  'C4 GOLDEN: the ONE league post in plain words — the correction, the team score, both flipped pairings (the second game included) and the median knock-on on a team that never started him');
select is(
  (select count(*)::int from league_chat where league_id = 'b1200000-0000-4000-8000-00000000000a' and is_system),
  1, 'C5 …exactly one post for the league');
select is(
  (select string_agg(u.raw_user_meta_data ->> 'username' || ': ' || n.body, E'\n' order by u.raw_user_meta_data ->> 'username')
   from notifications n join auth.users u on u.id = n.user_id
   where n.type = 'stat_correction_result' and (n.data ->> 'league_id') = 'b1200000-0000-4000-8000-00000000000a'),
  'lsc_user1: Stat correction (Week 2): Wade One''s receiving yards 97 → 37 — Team One 100.00 → 94.00. Team Two now beats you 97.00–94.00 (you were winning). In your second game Team Three now beats you (you were winning). You now lose the median game (you were winning).' || E'\n'
  || 'lsc_user2: Stat correction (Week 2): Wade One''s receiving yards 97 → 37 — Team One 100.00 → 94.00. You now beat Team One 97.00–94.00 (you were losing).' || E'\n'
  || 'lsc_user3: Stat correction (Week 2): Wade One''s receiving yards 97 → 37 — Team One 100.00 → 94.00. In your second game you now beat Team One (you were losing). You now win the median game (you were losing).',
  'C6 GOLDEN: a notification ONLY to each manager whose result changed, saying plainly who now wins — T1 (all three), his opponent T2, and T3 (second game + median, a team that never started him); T4''s manager (nothing changed) gets none');
select is(
  (select string_agg(title, ' | ') from (select distinct title from notifications where type = 'stat_correction_result') t),
  'A stat correction changed your Week 2 result', 'C7 …titled in plain words');
select is(
  (select count(*)::text from commissioner_actions where league_id = 'b1200000-0000-4000-8000-00000000000a'),
  current_setting('pgtap.cmsh'),
  'C8 NO commissioner_actions row: a correction is not an override (the F373 knock-on is a correction — D345''s per-cell law is untouched)');
select is(
  (select string_agg(id::text || '=' || coalesce(result, 'NULL') || ':' || is_overridden::text || ':' || home_score::text || '-' || away_score::text, ' ' order by id)
   from matchups where league_id = 'b1200000-0000-4000-8000-00000000000a' and week = 2),
  'd1200000-0000-4000-8000-000000000021=NULL:false:94.00-97.00 d1200000-0000-4000-8000-000000000022=NULL:false:95.00-80.00 d1200000-0000-4000-8000-000000000023=NULL:false:94.00-95.00',
  'C9 TD8 AS MEASURED: the scores moved, the stored matchups.result stays NULL on every open row (finalization derives it from the final scores) and nothing is marked overridden');
select is(
  (select string_agg(slot || '=' || points::text, ',' order by slot) from league_week_player_points
   where league_id = 'b1200000-0000-4000-8000-00000000000a' and week = 2 and team_id = 'c1200000-0000-4000-8000-000000000001'),
  'qb:0=60.00,wr:0=34.00', 'C10 …and the stored per-player points moved with the score (158, unchanged)');

-- ---------------------------------------------------------------------------
-- S. THE STARTER FILTER + LOUD EMPTINESS
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.score_write_week_batch('b1200000-0000-4000-8000-00000000000a', 2, '[
  {"team_id": "c1200000-0000-4000-8000-000000000001", "points": 94.00,
   "players": [{"slot": "qb:0", "player_id": "pgtap-lsc-q1", "points": 60, "pending": [], "reason": "scored"},
               {"slot": "wr:0", "player_id": "pgtap-lsc-w1", "points": 34, "pending": [], "reason": "scored"}],
   "corrections": ["e1200000-0000-4000-8000-000000000002", "e1200000-0000-4000-8000-000000000003", "e1200000-0000-4000-8000-000000000001"]}]')::text, true);
select is(
  current_setting('pgtap.r')::jsonb -> 'corrections' -> 'skipped',
  '[{"reason": "already_recorded", "team_id": "c1200000-0000-4000-8000-000000000001", "event_id": "e1200000-0000-4000-8000-000000000001", "player_id": "pgtap-lsc-w1"},
    {"reason": "no_points_moved", "team_id": "c1200000-0000-4000-8000-000000000001", "player_id": "pgtap-lsc-q1"},
    {"reason": "not_started", "team_id": "c1200000-0000-4000-8000-000000000001", "player_id": "pgtap-lsc-w2"}]'::jsonb,
  'S1 every non-record NAMED: his benched WR (not_started — the starter filter), his QB''s targets (a stat the league does not score — no_points_moved), and the re-send of the first correction (already_recorded — R1342)');
select is(
  (select count(*)::int from league_stat_corrections where player_id = 'pgtap-lsc-w2')
  || ':' || (select count(*)::int from league_stat_corrections where league_id = 'b1200000-0000-4000-8000-00000000000a'),
  '0:1', 'S2 the BENCH cell: a benched player''s correction writes no record (and nothing else was added)');
select is(
  (current_setting('pgtap.r')::jsonb -> 'corrections' ->> 'reason') || ' ' || coalesce(current_setting('pgtap.r')::jsonb -> 'corrections' ->> 'post', 'no post')
  || ' ' || (current_setting('pgtap.r')::jsonb ->> 'reason') || ' '
  || (select count(*)::text from league_chat where league_id = 'b1200000-0000-4000-8000-00000000000a' and is_system),
  'nothing_recorded no post no_change 1',
  'S3 …and a correction that moves no points writes NOTHING and says why: no record, no post, no score (no_change)');
select set_config('pgtap.lb0', pg_temp.cells('b1200000-0000-4000-8000-00000000000b', 2), true);
select set_config('pgtap.r', public.score_write_week_batch('b1200000-0000-4000-8000-00000000000b', 2, '[
  {"team_id": "c1200000-0000-4000-8000-000000000011", "points": 72.50,
   "players": [{"slot": "qb:0", "player_id": "pgtap-lsc-b1", "points": 72.5, "pending": [], "reason": "scored"}],
   "corrections": ["e1200000-0000-4000-8000-000000000006"]}]')::text, true);
select is(
  (current_setting('pgtap.r')::jsonb -> 'corrections' -> 'skipped')::text || ' ' || (current_setting('pgtap.r')::jsonb ->> 'reason'),
  '[{"reason": "score_not_written", "team_id": "c1200000-0000-4000-8000-000000000011"}] nothing_writable',
  'S4 an OVERRIDDEN row: the commissioner''s number stands — no record (score_not_written), nothing written');
select is(pg_temp.cells('b1200000-0000-4000-8000-00000000000b', 2), current_setting('pgtap.lb0'),
  'S5 …and every LB cell is byte-identical');

-- R1342 — AT MOST ONCE: a later correction to the same player-week drains
-- while the first event is still unapplied (a stamp that failed, or an event
-- recorded before 172 was pushed). The first event is NOT re-announced.
select set_config('pgtap.r', public.score_write_week_batch('b1200000-0000-4000-8000-00000000000a', 2, '[
  {"team_id": "c1200000-0000-4000-8000-000000000001", "points": 94.50,
   "players": [{"slot": "qb:0", "player_id": "pgtap-lsc-q1", "points": 60, "pending": [], "reason": "scored"},
               {"slot": "wr:0", "player_id": "pgtap-lsc-w1", "points": 34.5, "pending": [], "reason": "scored"}],
   "corrections": ["e1200000-0000-4000-8000-000000000001", "e1200000-0000-4000-8000-000000000007"]}]')::text, true);
select is(
  (current_setting('pgtap.r')::jsonb -> 'corrections' -> 'skipped')::text || ' '
  || (select stat_changes::text || ' ' || array_to_string(event_ids, ',') from league_stat_corrections
      where league_id = 'b1200000-0000-4000-8000-00000000000a' and week = 2 and 'e1200000-0000-4000-8000-000000000007' = any (event_ids)),
  '[{"reason": "already_recorded", "team_id": "c1200000-0000-4000-8000-000000000001", "event_id": "e1200000-0000-4000-8000-000000000001", "player_id": "pgtap-lsc-w1"}] '
  '[{"new": 42, "old": 37, "label": "receiving yards", "event_id": "e1200000-0000-4000-8000-000000000007", "stat_key": "receiving_yards"}] e1200000-0000-4000-8000-000000000007',
  'S6 R1342 AT MOST ONCE: the event this league already recorded is skipped by name (already_recorded); the new record carries ONLY the new event');
select is(
  (select message from league_chat where league_id = 'b1200000-0000-4000-8000-00000000000a' and is_system and message like '%37 → 42%'),
  'Stat correction (Week 2): Wade One''s receiving yards 37 → 42 — Team One 94.00 → 94.50.',
  'S7 …and the post names only the new correction — "97 → 37" is never re-announced (no result flipped, so no result sentence)');
select is(
  (select count(*)::int from league_chat where league_id = 'b1200000-0000-4000-8000-00000000000a' and is_system and message like '%97 → 37%'),
  1, 'S8 …the first correction was announced exactly once');

-- ---------------------------------------------------------------------------
-- L. A LIVE WEEK — recorded without results, posted, nobody notified
-- ---------------------------------------------------------------------------
select set_config('pgtap.nn', (select count(*)::text from notifications where type = 'stat_correction_result'), true);
select set_config('pgtap.r', public.score_write_week_batch('b1200000-0000-4000-8000-00000000000a', 3, '[
  {"team_id": "c1200000-0000-4000-8000-000000000001", "points": 11.00,
   "players": [{"slot": "qb:0", "player_id": "pgtap-lsc-q1", "points": 11, "pending": [], "reason": "scored"}],
   "corrections": ["e1200000-0000-4000-8000-000000000005"]}]')::text, true);
select is(
  (select coalesce(result_before::text, 'NULL') || ' ' || coalesce(result_after::text, 'NULL') || ' ' || result_changed::text || ' ' || team_score_before::text || '→' || team_score_after::text
   from league_stat_corrections where league_id = 'b1200000-0000-4000-8000-00000000000a' and week = 3),
  'NULL NULL false 10.00→11.00',
  'L1 a LIVE week''s record carries the score change and NO result (the games are still being played — a result is not a result yet)');
select is(
  (current_setting('pgtap.r')::jsonb -> 'corrections' ->> 'results_final') || ' '
  || (select count(*)::text from notifications where type = 'stat_correction_result') || ' '
  || (select message from league_chat where league_id = 'b1200000-0000-4000-8000-00000000000a' and is_system and message like 'Stat correction (Week 3)%'),
  'false ' || current_setting('pgtap.nn') || ' Stat correction (Week 3): Quinn One''s passing yards 100 → 125 — Team One 10.00 → 11.00.',
  'L2 …the post names the correction and the score; no result sentence and no notification while the week is being played');

-- ---------------------------------------------------------------------------
-- R. THE ROLLBACK — the record is IN the re-score's transaction
-- ---------------------------------------------------------------------------
create function pg_temp.refuse_record() returns trigger language plpgsql as $rr$
begin
  raise exception 'pgtap: the record write failed' using errcode = 'P0001';
end;
$rr$;
create trigger pgtap_refuse_record before insert on public.league_stat_corrections
  for each row execute function pg_temp.refuse_record();
select set_config('pgtap.la3', pg_temp.cells('b1200000-0000-4000-8000-00000000000a', 3), true);
select throws_ok(
  $$ select public.score_write_week_batch('b1200000-0000-4000-8000-00000000000a', 3, '[
       {"team_id": "c1200000-0000-4000-8000-000000000001", "points": 12.00,
        "players": [{"slot": "qb:0", "player_id": "pgtap-lsc-q1", "points": 12, "pending": [], "reason": "scored"}],
        "corrections": ["e1200000-0000-4000-8000-000000000008"]}]') $$,
  'P0001', 'pgtap: the record write failed',
  'R1 a failure writing the record fails the whole call');
select is(pg_temp.cells('b1200000-0000-4000-8000-00000000000a', 3), current_setting('pgtap.la3'),
  'R2 THE ROLLBACK CELL: the re-score went with it — T1''s week 3 score and stored per-player points are exactly as they were (the record and the score are ONE transaction)');
drop trigger pgtap_refuse_record on public.league_stat_corrections;

-- ---------------------------------------------------------------------------
-- D. RESULT WITH SCORE (F245 / TD8) — the corrected week through the REAL
--    finalize_matchups and rebuild_team_week_results.
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.finalize_matchups('2089-09-21 01:00+00', 'b1200000-0000-4000-8000-00000000000a')::text, true);
select is(
  (current_setting('pgtap.r')::jsonb ->> 'finalized') || ' ' || (select status from league_weeks where league_id = 'b1200000-0000-4000-8000-00000000000a' and week = 2),
  '1 final', 'D1 the REAL finalize_matchups at the window''s end finalizes the corrected week');
select is(
  (select string_agg(id::text || '=' || result, ' ' order by id) from matchups where league_id = 'b1200000-0000-4000-8000-00000000000a' and week = 2),
  'd1200000-0000-4000-8000-000000000021=away d1200000-0000-4000-8000-000000000022=home d1200000-0000-4000-8000-000000000023=away',
  'D2 …the stored results are the ones the record derived from the corrected scores (Team Two, Team Three, and Team Three in the second game)');
select is(
  (select string_agg(t.name || ' ' || r.h2h_result || '/' || coalesce(r.second_result, '-') || '/' || coalesce(r.median_result, '-'), ', ' order by t.name)
   from team_week_results r join teams t on t.id = r.team_id where r.league_id = 'b1200000-0000-4000-8000-00000000000a' and r.week = 2),
  'Team Four loss/-/loss, Team One loss/loss/loss, Team Three win/win/win, Team Two win/-/win',
  'D3 …and the standings rows agree with the record''s after-results for every team, the median knock-on included');
select is(
  public.rebuild_team_week_results('b1200000-0000-4000-8000-00000000000a', 2) ->> 'reason',
  'already_consistent',
  'D4 NO result_drift (F245): the rebuild reads the week and finds every stored result is its scores'' own E38 result — nothing to repair');

-- ---------------------------------------------------------------------------
-- F. THE FINAL WEEK — the refusal is unchanged with the element
-- ---------------------------------------------------------------------------
select set_config('pgtap.la1', pg_temp.cells('b1200000-0000-4000-8000-00000000000a', 1), true);
select throws_ok(
  $$ select public.score_write_week_batch('b1200000-0000-4000-8000-00000000000a', 1, '[
       {"team_id": "c1200000-0000-4000-8000-000000000001", "points": 51.00,
        "players": [{"slot": "wr:0", "player_id": "pgtap-lsc-w1", "points": 51, "pending": [], "reason": "scored"}],
        "corrections": ["e1200000-0000-4000-8000-000000000004"]}]') $$,
  'P0001', 'score_write_week_batch: week_final — league b1200000-0000-4000-8000-00000000000a week 1 is final; a post-window delta changes no league cell (D295, §23.4)',
  'F1 a FINAL week is refused by name, the corrections element or not (Q81: after the window a fix never changes a league score)');
select is(
  pg_temp.cells('b1200000-0000-4000-8000-00000000000a', 1) || ':' || (select count(*)::text from league_stat_corrections where week = 1),
  current_setting('pgtap.la1') || ':0', 'F2 …and nothing moved: every week-1 cell byte-identical, no record');
select throws_ok(
  $$ select public.score_write_week_batch('b1200000-0000-4000-8000-00000000000a', 2, '[
       {"team_id": "c1200000-0000-4000-8000-000000000001", "points": 94.00,
        "players": [{"slot": "qb:0", "player_id": "pgtap-lsc-q1", "points": 60, "pending": [], "reason": "scored"},
                    {"slot": "wr:0", "player_id": "pgtap-lsc-w1", "points": 34, "pending": [], "reason": "scored"}],
        "corrections": ["e1200000-0000-4000-8000-000000000001"]}]') $$,
  'P0001', 'score_write_week_batch: week_final — league b1200000-0000-4000-8000-00000000000a week 2 is final; a post-window delta changes no league cell (D295, §23.4)',
  'F3 …and the corrected week, now final, is refused the same way (its record stands; nothing re-scores it)');

-- ---------------------------------------------------------------------------
-- V. THE ELEMENT''S SHAPE (22023, before anything is written)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.score_write_week_batch('b1200000-0000-4000-8000-00000000000b', 2, '[{"team_id": "c1200000-0000-4000-8000-000000000013", "points": 50, "players": [{"slot": "qb:0", "player_id": "pgtap-lsc-b3", "points": 50, "pending": [], "reason": "scored"}], "corrections": "e1200000-0000-4000-8000-000000000006"}]') $$,
  '22023', 'score_write_week_batch: element 1 (team c1200000-0000-4000-8000-000000000013) corrections must be a JSON array of event ids, sent WITH players (got string / players sent)',
  'V1 corrections that is not an array is refused by name');
select throws_ok(
  $$ select public.score_write_week_batch('b1200000-0000-4000-8000-00000000000b', 2, '[{"team_id": "c1200000-0000-4000-8000-000000000013", "points": 50, "corrections": ["e1200000-0000-4000-8000-000000000006"]}]') $$,
  '22023', 'score_write_week_batch: element 1 (team c1200000-0000-4000-8000-000000000013) corrections must be a JSON array of event ids, sent WITH players (got array / players absent)',
  'V2 …and corrections without the per-player rows (a record''s before / after are theirs)');
select throws_ok(
  $$ select public.score_write_week_batch('b1200000-0000-4000-8000-00000000000b', 2, '[{"team_id": "c1200000-0000-4000-8000-000000000013", "points": 50, "players": [{"slot": "qb:0", "player_id": "pgtap-lsc-b3", "points": 50, "pending": [], "reason": "scored"}], "corrections": ["not-an-id"]}]') $$,
  '22023', 'score_write_week_batch: element 1 (team c1200000-0000-4000-8000-000000000013) corrections holds a value that is not an event id',
  'V3 …and a value that is not an event id');
select throws_ok(
  $$ select public.score_write_week_batch('b1200000-0000-4000-8000-00000000000b', 2, '[{"team_id": "c1200000-0000-4000-8000-000000000013", "points": 50, "players": [{"slot": "qb:0", "player_id": "pgtap-lsc-b3", "points": 50, "pending": [], "reason": "scored"}], "corrections": ["e1200000-0000-4000-8000-000000000004"]}]') $$,
  '22023', 'score_write_week_batch: corrections names 1 event id(s) that are not season 2089 week 2 stat corrections',
  'V4 …and an event of ANOTHER week (a caller bug — loud, never skipped)');
select is(pg_temp.cells('b1200000-0000-4000-8000-00000000000b', 2), current_setting('pgtap.lb0'),
  'V5 …none of the four wrote anything');

-- ---------------------------------------------------------------------------
-- K. F476 — the bracket re-sync is due on a bracket league''s last regular week
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.score_write_week_batch('b1200000-0000-4000-8000-00000000000b', 2, '[
  {"team_id": "c1200000-0000-4000-8000-000000000013", "points": 51.00,
   "players": [{"slot": "qb:0", "player_id": "pgtap-lsc-b3", "points": 51, "pending": [], "reason": "scored"}]}]')::text, true);
select is(
  (current_setting('pgtap.r')::jsonb ->> 'written') || ' ' || (current_setting('pgtap.r')::jsonb ->> 'bracket_resync_due') || ' '
  || (current_setting('pgtap.r')::jsonb -> 'corrections' ->> 'reason'),
  '1 true none_sent',
  'K1 a re-score of LB''s LAST regular week (2 of 2) with a bracket owes the sync NOW (bracket_resync_due) — with or without a correction; an element-less batch reports none_sent');
select is(
  (select (public.score_write_week_batch('b1200000-0000-4000-8000-00000000000b', 2, '[
     {"team_id": "c1200000-0000-4000-8000-000000000013", "points": 51.00,
      "players": [{"slot": "qb:0", "player_id": "pgtap-lsc-b3", "points": 51, "pending": [], "reason": "scored"}]}]') ->> 'bracket_resync_due')),
  'false', 'K2 …but an identical re-send (nothing written) owes nothing');
select set_config('pgtap.k3', public.score_bracket_resync('b1200000-0000-4000-8000-00000000000b', '2089-09-17 12:00+00')::text, true);
select is(
  (select (r ->> 'league_id') || ' ' || (r ->> 'action') || ' round ' || (r ->> 'round') || ' ' || (r ->> 'source') || ' ' || (r ->> 'games') || ' flipped=' || (r ->> 'status_flipped')
   from (select current_setting('pgtap.k3')::jsonb as r) x)
  || ' ' || (select status from leagues where id = 'b1200000-0000-4000-8000-00000000000b')
  || ' ' || (select count(*)::text from matchups where league_id = 'b1200000-0000-4000-8000-00000000000b' and week = 3 and round_type <> 'secondary'),
  'b1200000-0000-4000-8000-00000000000b built round 1 provisional 1:c1200000-0000-4000-8000-000000000011v2:c1200000-0000-4000-8000-000000000013 flipped=true playoffs 1',
  'K3 F476 AT ONCE: score_bracket_resync runs the ONE bracket writer at the caller''s instant — round 1 BUILT from the re-scored week (seed 1 Bees One v seed 2 Bees Three), the league into its playoffs, the round-1 row written');

-- ---------------------------------------------------------------------------
-- P. APPLIED (§12.21) — the worker stamps the events of the rows it is about
--    to consume, BEFORE its ack (R1342); a replay stamps nothing
-- ---------------------------------------------------------------------------
select is(
  public.stat_correction_mark_applied(array['e1200000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000002']::uuid[], '2089-09-16 15:05+00')::text,
  '{"named": 2, "reason": null, "stamped": 2, "unknown": 0, "already_applied": 0}',
  'P1 the named, still-unapplied events are stamped (the worker names the events of the rows it consumes)');
select is(
  (select string_agg(id::text || '=' || coalesce(applied_at::text, 'NULL'), ' ' order by id) from stat_correction_events
   where id in ('e1200000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000002')),
  'e1200000-0000-4000-8000-000000000001=2089-09-16 15:05:00+00 e1200000-0000-4000-8000-000000000002=2089-09-16 15:05:00+00',
  'P2 …stamped at the CALLER''s instant (p_now), never the wall clock');
select is(
  public.stat_correction_mark_applied(array['e1200000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-0000000000ff']::uuid[], '2089-09-17 00:00+00')::text,
  '{"named": 2, "reason": "nothing_to_stamp", "stamped": 0, "unknown": 1, "already_applied": 1}',
  'P3 a replay stamps nothing and says why (the first stamp stands); an unknown id is counted, never invented');

-- ---------------------------------------------------------------------------
-- W. THE ONE-TIME BACKFILL (R1342(a), the D38 waiver): an event recorded
--    before 172 whose queue row is already drained was re-scored into every
--    league — stamped applied_at = detected_at; one still queued is in flight
-- ---------------------------------------------------------------------------
insert into score_fanout (season, week, player_id, enqueued_at) values (2089, 2, 'pgtap-lsc-q1', '2089-09-16 15:00+00');
select is(
  (select count(*)::int from stat_correction_events where applied_at is null and id::text like 'e1200000-%'),
  6, 'W0 PREMISE: six fixture events are unapplied (e3 — its row still queued — and e4, e5, e6, e7, e8 — drained)');
select is(public.stat_correction_backfill_applied_internal(), 5,
  'W1 the backfill stamps the FIVE whose player-week has no queue row left');
select is(
  (select string_agg(right(id::text, 2) || '=' || coalesce((applied_at = detected_at)::text, 'NULL'), ' ' order by id) from stat_correction_events
   where id::text like 'e1200000-%' and id not in ('e1200000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000002')),
  '03=NULL 04=true 05=true 06=true 07=true 08=true',
  'W2 …each at its OWN detected_at (no clock read); e3, still queued, stays unapplied for the next drain to deliver');
select is(public.stat_correction_backfill_applied_internal(), 0, 'W3 …and it is idempotent');

-- ---------------------------------------------------------------------------
-- Z. DEPLOY BEFORE PUSH — the door as production has it (158: the live body
--    with 172''s hunks reversed) IGNORES the element: it scores exactly as
--    before and its report has no `corrections` key — the worker''s signal.
-- ---------------------------------------------------------------------------
do $mk$ begin
  execute format('create function pg_temp.door158(p_league_id uuid, p_week integer, p_scores jsonb) returns jsonb language plpgsql as %L',
    (select pg_temp.un172(prosrc) from pg_proc where oid = 'public.score_write_week_batch(uuid,integer,jsonb)'::regprocedure));
end $mk$;
select set_config('pgtap.nrec', (select count(*)::text from league_stat_corrections), true);
select set_config('pgtap.r', pg_temp.door158('b1200000-0000-4000-8000-00000000000b', 2, '[
  {"team_id": "c1200000-0000-4000-8000-000000000013", "points": 52.00,
   "players": [{"slot": "qb:0", "player_id": "pgtap-lsc-b3", "points": 52, "pending": [], "reason": "scored"}],
   "corrections": ["e1200000-0000-4000-8000-000000000006"]}]')::text, true);
select is(
  (current_setting('pgtap.r')::jsonb ->> 'written') || ' ' || (current_setting('pgtap.r')::jsonb ? 'corrections')::text || ' '
  || (current_setting('pgtap.r')::jsonb ? 'player_points')::text || ' '
  || (select home_score::text from matchups where id = 'd1200000-0000-4000-8000-000000000042'),
  '1 false true 52.00',
  'Z1 the 158 body scores the batch exactly as before with the element present, and its report carries no corrections key (the worker names that: not_recorded_pre_172)');
select is((select count(*)::text from league_stat_corrections), current_setting('pgtap.nrec'),
  'Z2 …and writes no record');

-- R1345: B7 is only falsifiable if ANOTHER league holds a record — seed one in
-- LB (postgres; the table's shape, not the door, is under test here).
insert into league_stat_corrections (league_id, season, week, team_id, player_id, slot, event_ids, stat_changes,
                                     player_points_before, player_points_after, team_score_before, team_score_after, result_changed)
values ('b1200000-0000-4000-8000-00000000000b', 2089, 2, 'c1200000-0000-4000-8000-000000000013', 'pgtap-lsc-b3', 'qb:0',
        array['e1200000-0000-4000-8000-000000000006']::uuid[], '[]', 50, 51, 50, 51, false);
select is((select count(*)::int from league_stat_corrections where league_id = 'b1200000-0000-4000-8000-00000000000b'), 1,
  'B0 PREMISE: LB holds a record (so B7 below can fail)');

-- ---------------------------------------------------------------------------
-- B. ROLES — members read, nobody writes, no signed-in caller runs a door
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from league_stat_corrections), 0, 'B1 anon reads no record');
select results_eq($$ with w as (update league_stat_corrections set result_changed = false returning 1) select count(*) from w $$, $$ values (0::bigint) $$,
  'B2 anon: UPDATE touches 0 rows');
select throws_ok($$ select public.stat_correction_mark_applied(array[]::uuid[], now()) $$, '42501', null,
  'B3 anon cannot run the applied door (REVOKEd)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f120000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select is((select count(*)::int from league_stat_corrections), 0, 'B4 a signed-in OUTSIDER reads no record (a member of no league)');
select results_eq($$ with w as (delete from league_stat_corrections returning 1) select count(*) from w $$, $$ values (0::bigint) $$,
  'B5 the outsider: DELETE touches 0 rows');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f120000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select is((select count(*)::int from league_stat_corrections where league_id = 'b1200000-0000-4000-8000-00000000000a'), 3,
  'B6 a league MEMBER (T4, whose result never moved) reads his league''s records — all three');
select is((select count(*)::int from league_stat_corrections where league_id <> 'b1200000-0000-4000-8000-00000000000a'), 0,
  'B7 …and NOT LB''s record (B0) — none of a league he is not in');
select results_eq($$ with w as (update league_stat_corrections set team_score_after = 0 returning 1) select count(*) from w $$, $$ values (0::bigint) $$,
  'B8 the member: UPDATE touches 0 rows');
select throws_ok($$ insert into league_stat_corrections (league_id, season, week, team_id, player_id, slot, event_ids, stat_changes, player_points_after, result_changed)
  values ('b1200000-0000-4000-8000-00000000000a', 2089, 2, 'c1200000-0000-4000-8000-000000000004', 'pgtap-lsc-q4', 'qb:0', array['e1200000-0000-4000-8000-000000000001']::uuid[], '[]', 99, false) $$,
  '42501', null, 'B9 the member: INSERT refused (RLS, 42501)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f120000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select results_eq($$ with w as (delete from league_stat_corrections where league_id = 'b1200000-0000-4000-8000-00000000000a' returning 1) select count(*) from w $$, $$ values (0::bigint) $$,
  'B10 the COMMISSIONER: DELETE touches 0 rows — no one edits a correction record');
select throws_ok($$ select public.score_write_week_batch('b1200000-0000-4000-8000-00000000000b', 2, '[{"team_id": "c1200000-0000-4000-8000-000000000013", "points": 1}]') $$,
  '42501', null, 'B11 …nor runs the scoring door (REVOKEd)');
select throws_ok($$ select public.score_bracket_resync('b1200000-0000-4000-8000-00000000000a', now()) $$,
  '42501', null, 'B12 …nor the bracket door (REVOKEd)');
reset role;
-- The in-body refusal (rule 2): a JWT reaching either new door as a privileged role.
select set_config('request.jwt.claims', '{"sub": "9f120000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok($$ select public.stat_correction_mark_applied(array[]::uuid[], now()) $$,
  '42501', 'stat_correction_mark_applied: the score worker''s door (service role), never a signed-in or anonymous caller''s',
  'B13 the applied door refuses a signed-in caller IN-BODY');
select throws_ok($$ select public.score_bracket_resync('b1200000-0000-4000-8000-00000000000a', now()) $$,
  '42501', 'score_bracket_resync: the score worker''s door (service role), never a signed-in or anonymous caller''s',
  'B14 …and so does the bracket door');
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select public.score_bracket_resync('b1200000-0000-4000-8000-00000000000a', now()) $$,
  '42501', null, 'B15 …an anonymous claim as well');
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
