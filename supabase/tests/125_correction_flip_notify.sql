-- ============================================================================
-- 125 — a stat correction announces and notifies only the results IT changed
--       (migration 177; M6 defect fix B12 / F557 / F530; spec §7.3.6, §11.7,
--       §16.4, §23.4; PROGRESS D453(4), D469)
-- ============================================================================
-- What this file proves, over REAL calls of the scoring door in one
-- rolled-back transaction:
--   §A  FORM and D137 — the door still SECURITY DEFINER, search_path '',
--       REVOKEd from anon / authenticated with EXECUTE for the service role;
--       the new helper plain, search_path '', REVOKEd; the live prosrc a
--       STORED-LITERAL md5; pg_temp.un177 reverses 177's four hunks on the
--       LIVE body to 172's text byte for byte (120 A6's stored literal).
--   THE RULE (R1446, ruled 2026-10-02 — ONE but-for test): a result is
--       changed BY THE CORRECTION iff it changed (after <> before) AND the
--       actual after week differs from the BUT-FOR week (the after week
--       with only this call's corrections taken back out, every other team
--       at its actual after score); per h2h / second game / median and per
--       pairing. Every score and result shown is the actual week's.
--   §T  F557 / R1440 — TWO TEAMS MOVED in one batch: the correction's team
--       (T1) and another team (T4, a settled line with no correction). T1,
--       T2 and T3 told of the flips the correction made; T4's own flip of
--       T3 v T4 never announced; T4's median win needs BOTH moves (joint,
--       case e) — announced and T4 told.
--   §N  (f) A correction that flips NOTHING — one record, result_changed
--       false, the post without a result line, no notification.
--   §S  (a) SECOND GAME and MEDIAN only, the correction alone in the batch.
--   §R  (c) the correction would flip T1 v T2 but T2's own move flips it
--       back: nothing announced, result_changed false.
--   §B  (d) both moves push T1 v T2 the same way (T2 at 99 still loses to
--       an uncorrected 100): announced, REAL scores.
--   §J  (e) R1446's probe — the JOINT flip neither move makes alone: T1
--       100 → 99 (correction), T2 97 → 99.50 (no correction). The scoreboard
--       99.00–99.50; but for the correction T1 wins 100–99.50. Announced,
--       T1 and T2 told, the real 99.50–99.00.
--   §O  (b) another team ALONE flips the corrected team: T1 100 → 99
--       (correction), T2 97 → 101 (no correction) — T1 loses with or without
--       it. Silent; the record honestly reads result_before <> result_after
--       with result_changed FALSE (the column means "changed by the
--       correction" — its schema comment pinned).
--   §M  the helper — on a single-team batch the but-for week IS the week
--       before (teams, matchups, median); an empty movement returns the
--       after week's results; a movement on the away side flips a pairing.
-- Break probes (the PR, reverted): P3 (R1446, rule 14) e6cd539's both-states
-- rule back in the live door ⇒ J red. Earlier: P0 431dfa9's moved-only door,
-- P1 172's door (un177), P2 the helper ignoring the away side ⇒ M red.
-- Worlds (season 2088 — its own calendar; measured unused 2026-10-02):
--   L1 b1250000…01 … L7 …07 — h2h, median game ON, 4 teams each,
--   regular season 3 weeks, NO bracket; week 2 CORRECTION_WINDOW (games over).
--   u1–u4 manage T1–T4 in every league. T1 starts a QB (60) + a WR (40).
--     L1 / L2 / L4–L7: T1 100.00 v T2 97.00, T3 95.00 v T4 80.00, second game T1 v T3.
--     L3:      T1 100.00 v T2 90.00, T3 95.00 v T4 93.00, second game T1 v T3.
-- Descriptions carry no bare apostrophes (house rule).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(36);

-- pg_temp.un177 — 177's four hunks reversed (derive_177.py: H4 the post /
-- notification block back to v_after, then H3, H2, H1 by exact match).
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

-- ---------------------------------------------------------------------------
-- A. FORM and D137
-- ---------------------------------------------------------------------------
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
          and not has_function_privilege('anon', p.oid, 'EXECUTE')
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
          and has_function_privilege('service_role', p.oid, 'EXECUTE')
   from pg_proc p where p.oid = 'public.score_write_week_batch(uuid,integer,jsonb)'::regprocedure),
  'A1 the door is still SECURITY DEFINER, search_path empty, REVOKEd from anon and authenticated, EXECUTE for the service role');
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""' and p.provolatile = 's'
          and not has_function_privilege('anon', p.oid, 'EXECUTE')
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
   from pg_proc p where p.oid = 'public.stat_correction_week_state_but_for_internal(uuid,integer,integer,jsonb,jsonb)'::regprocedure),
  'A2 the new helper is plain, STABLE, search_path empty and REVOKEd from anon and authenticated');
select is(
  (select md5(prosrc) from pg_proc where oid = 'public.score_write_week_batch(uuid,integer,jsonb)'::regprocedure),
  '3ea8ee6417852e5d46dc79e8093a1daf',
  'A3 the live door body is 177 as written (STORED LITERAL md5; derive_177.py: 172:362-967 plus four hunks)');
select is(
  (select md5(pg_temp.un177(prosrc)) from pg_proc where oid = 'public.score_write_week_batch(uuid,integer,jsonb)'::regprocedure),
  '7fbb74085768afd0f9d56a235f1ebabb',
  'A4 D137: with the four hunks reversed on the LIVE body it is 172 BYTE FOR BYTE (pgTAP 120 A6 stored literal)');

-- ---------------------------------------------------------------------------
-- FIXTURES (postgres context, JWT cleared).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('9f125000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-cfn' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'cfn_user' || i)::jsonb, now(), now()
from generate_series(1, 4) i;

insert into nfl_weeks (season, week, starts_at, first_kickoff_at, correction_window_ends_at) values
 (2088, 1, '2088-09-05 04:00+00', '2088-09-07 00:15+00', '2088-09-13 10:00+00'),
 (2088, 2, '2088-09-12 04:00+00', '2088-09-14 00:15+00', '2088-09-20 10:00+00');
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('pgtap-cfn-g1', 2088, 1, 'KC', 'BUF', '2088-09-07 00:15+00', 'final'),
 ('pgtap-cfn-g2', 2088, 2, 'KC', 'BUF', '2088-09-14 00:15+00', 'final');

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks,
                     playoff_teams, playoff_start_week, faab_budget,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings)
select ('b1250000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       '9f125000-0000-4000-8000-000000000001', 'pgtap-cfn-L' || i, 2088, 'in_season', 8, 3, 0, 4, 100,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', '{"schedule_mode": "h2h", "median_game": true}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'
from generate_series(1, 7) i;

-- team t (1–4) of league l (1–3): c125000l-…-00000000000t
insert into teams (id, owner_id, name, league_id)
select ('c125000' || l || '-0000-4000-8000-00000000000' || t)::uuid,
       ('9f125000-0000-4000-8000-00000000000' || t)::uuid,
       (array['Team One', 'Team Two', 'Team Three', 'Team Four'])[t],
       ('b1250000-0000-4000-8000-00000000000' || l)::uuid
from generate_series(1, 7) l, generate_series(1, 4) t;
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select ('b1250000-0000-4000-8000-00000000000' || l)::uuid,
       ('9f125000-0000-4000-8000-00000000000' || t)::uuid,
       ('c125000' || l || '-0000-4000-8000-00000000000' || t)::uuid,
       case when t = 1 then 'commissioner' else 'manager' end, false, 100
from generate_series(1, 7) l, generate_series(1, 4) t;

insert into players (id, full_name, position, team, status)
select 'pgtap-cfn-' || p || l, n || ' L' || l, pos, 'KC', 'Active'
from generate_series(1, 7) l,
     (values ('q1', 'Quinn One', 'QB'), ('w1', 'Wade One', 'WR'), ('q2', 'Quinn Two', 'QB'),
             ('q3', 'Quinn Three', 'QB'), ('q4', 'Quinn Four', 'QB')) v(p, n, pos);

insert into league_weeks (league_id, season, week, status)
select ('b1250000-0000-4000-8000-00000000000' || l)::uuid, 2088, w, s
from generate_series(1, 7) l, (values (1, 'final'), (2, 'correction_window')) v(w, s);

-- week 2 pairings: m<l>1 T1 v T2, m<l>2 T3 v T4, m<l>3 second game T1 v T3
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status, result, is_overridden)
select ('d125000' || l || '-0000-4000-8000-00000000000' || k)::uuid, ('b1250000-0000-4000-8000-00000000000' || l)::uuid, 2088, 2, rt,
       ('c125000' || l || '-0000-4000-8000-00000000000' || h)::uuid, ('c125000' || l || '-0000-4000-8000-00000000000' || a)::uuid,
       hs, case when l = 3 then a3 else aws end, 'live', null, false
from generate_series(1, 7) l,
     (values (1, 'regular', 1, 2, 100.00, 97.00, 90.00), (2, 'regular', 3, 4, 95.00, 80.00, 93.00),
             (3, 'secondary', 1, 3, 100.00, 95.00, 95.00)) v(k, rt, h, a, hs, aws, a3);

insert into league_week_player_points (league_id, season, week, team_id, slot, player_id, points, reason, source)
select ('b1250000-0000-4000-8000-00000000000' || l)::uuid, 2088, 2, ('c125000' || l || '-0000-4000-8000-00000000000' || t)::uuid,
       slot, 'pgtap-cfn-' || p || l, case when l = 3 and t = 2 then 90.00 when l = 3 and t = 4 then 93.00 else pts end, 'scored', 'worker'
from generate_series(1, 7) l,
     (values (1, 'qb:0', 'q1', 60.00), (1, 'wr:0', 'w1', 40.00), (2, 'qb:0', 'q2', 97.00),
             (3, 'qb:0', 'q3', 95.00), (4, 'qb:0', 'q4', 80.00)) v(t, slot, p, pts);

insert into stat_correction_events (id, season, week, player_id, stat_key, old_value, new_value, detected_at, week_state, source, game_id) values
 ('e1250000-0000-4000-8000-000000000001', 2088, 2, 'pgtap-cfn-w11', 'receiving_yards', 97, 37, '2088-09-16 15:00+00', 'open', 'pgtap', 'pgtap-cfn-g2'),
 ('e1250000-0000-4000-8000-000000000002', 2088, 2, 'pgtap-cfn-w12', 'receiving_yards', 97, 87, '2088-09-16 15:00+00', 'open', 'pgtap', 'pgtap-cfn-g2'),
 ('e1250000-0000-4000-8000-000000000003', 2088, 2, 'pgtap-cfn-w13', 'receiving_yards', 97, 17, '2088-09-16 15:00+00', 'open', 'pgtap', 'pgtap-cfn-g2'),
 ('e1250000-0000-4000-8000-000000000004', 2088, 2, 'pgtap-cfn-w14', 'receiving_yards', 97, 57, '2088-09-16 15:00+00', 'open', 'pgtap', 'pgtap-cfn-g2'),
 ('e1250000-0000-4000-8000-000000000005', 2088, 2, 'pgtap-cfn-w15', 'receiving_yards', 97, 37, '2088-09-16 15:00+00', 'open', 'pgtap', 'pgtap-cfn-g2'),
 ('e1250000-0000-4000-8000-000000000006', 2088, 2, 'pgtap-cfn-w16', 'receiving_yards', 97, 87, '2088-09-16 15:00+00', 'open', 'pgtap', 'pgtap-cfn-g2'),
 ('e1250000-0000-4000-8000-000000000007', 2088, 2, 'pgtap-cfn-w17', 'receiving_yards', 97, 87, '2088-09-16 15:00+00', 'open', 'pgtap', 'pgtap-cfn-g2');

create function pg_temp.notes(p_league uuid) returns text language sql as $n$
  select coalesce(string_agg(u.raw_user_meta_data ->> 'username' || ': ' || n.body, E'\n' order by u.raw_user_meta_data ->> 'username'), 'none')
  from public.notifications n join auth.users u on u.id = n.user_id
  where n.type = 'stat_correction_result' and (n.data ->> 'league_id') = p_league::text;
$n$;
create function pg_temp.post(p_league uuid) returns text language sql as $p$
  select coalesce(string_agg(message, E'\n' order by created_at), 'none') from public.league_chat where league_id = p_league and is_system;
$p$;
create function pg_temp.rec(p_league uuid) returns text language sql as $r$
  select coalesce(string_agg(t.name || ' ' || r.team_score_before::text || '→' || r.team_score_after::text || ' '
                             || r.result_before::text || ' → ' || r.result_after::text || ' changed=' || r.result_changed::text, E'\n'), 'none')
  from public.league_stat_corrections r join public.teams t on t.id = r.team_id where r.league_id = p_league;
$r$;

-- ---------------------------------------------------------------------------
-- T. TWO TEAMS MOVED (F557 / R1440) — L1: Wade One L1 (T1) 40 → 34 (T1 100 →
--    94) AND, in the same batch, T4 80 → 96 with no correction (a settled
--    line). The correction alone: T1 now loses to T2 (97) and to T3 (95, the
--    second game). The ACTUAL week: 94 / 97 / 95 / 96, median 95.5. The
--    BUT-FOR week (T1 back at 100, T4 at its actual 96): 100 / 97 / 95 / 96,
--    median 96.5. T3 v T4 (T4 96–95) is the same either way — T4''s own move,
--    never announced. T1''s median loss differs from the but-for win —
--    announced. T3''s median is a loss before and after — nothing. T4''s
--    median: a loss before, a WIN now, a loss but for the correction — the
--    joint flip (R1446 case e), announced and T4 told.
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.score_write_week_batch('b1250000-0000-4000-8000-000000000001', 2, '[
  {"team_id": "c1250001-0000-4000-8000-000000000001", "points": 94.00,
   "players": [{"slot": "qb:0", "player_id": "pgtap-cfn-q11", "points": 60, "pending": [], "reason": "scored"},
               {"slot": "wr:0", "player_id": "pgtap-cfn-w11", "points": 34, "pending": [], "reason": "scored"}],
   "corrections": ["e1250000-0000-4000-8000-000000000001"]},
  {"team_id": "c1250001-0000-4000-8000-000000000004", "points": 96.00,
   "players": [{"slot": "qb:0", "player_id": "pgtap-cfn-q41", "points": 96, "pending": [], "reason": "scored"}]}]')::text, true);
select is(
  (select string_agg(id::text || '=' || home_score::text || '-' || away_score::text, ' ' order by id)
   from matchups where league_id = 'b1250000-0000-4000-8000-000000000001' and week = 2),
  'd1250001-0000-4000-8000-000000000001=94.00-97.00 d1250001-0000-4000-8000-000000000002=95.00-96.00 d1250001-0000-4000-8000-000000000003=94.00-95.00',
  'T1 both moves were written: T1 94.00 and T4 96.00 (T4 now leads T3 on the scoreboard)');
select is(pg_temp.rec('b1250000-0000-4000-8000-000000000001'),
  'Team One 100.00→94.00 {"h2h": "win", "median": "win", "second": "win"} → {"h2h": "loss", "median": "loss", "second": "loss"} changed=true',
  'T2 GOLDEN: ONE record, for the team that started him — the results the correction made');
select is(pg_temp.post('b1250000-0000-4000-8000-000000000001'),
  'Stat correction (Week 2): Wade One L1''s receiving yards 97 → 37 — Team One 100.00 → 94.00. Result changed: Team Two now beats Team One 97.00–94.00; Team Three now beats Team One 95.00–94.00 (second game). Median game: Team Four now wins the median game (it was losing); Team One now loses the median game (it was winning).',
  'T3 GOLDEN: ONE post naming ONLY the flips the correction caused (the joint Team Four median win included) — no Team Four now beats Team Three');
select is(pg_temp.notes('b1250000-0000-4000-8000-000000000001'),
  'cfn_user1: Stat correction (Week 2): Wade One L1''s receiving yards 97 → 37 — Team One 100.00 → 94.00. Team Two now beats you 97.00–94.00 (you were winning). In your second game Team Three now beats you (you were winning). You now lose the median game (you were winning).' || E'\n'
  || 'cfn_user2: Stat correction (Week 2): Wade One L1''s receiving yards 97 → 37 — Team One 100.00 → 94.00. You now beat Team One 97.00–94.00 (you were losing).' || E'\n'
  || 'cfn_user3: Stat correction (Week 2): Wade One L1''s receiving yards 97 → 37 — Team One 100.00 → 94.00. In your second game you now beat Team One (you were losing).' || E'\n'
  || 'cfn_user4: Stat correction (Week 2): Wade One L1''s receiving yards 97 → 37 — Team One 100.00 → 94.00. You now win the median game (you were losing).',
  'T4 GOLDEN: T1, T2 and T3 told the flips the correction made; T4 told ONLY of the median win the correction made with his move (never of T3 v T4, his own move alone); T3 told of no median change');
select is(
  jsonb_array_length(current_setting('pgtap.r')::jsonb -> 'corrections' -> 'notified')::text || ':'
  || (select string_agg(x ->> 'team_id', ',' order by x ->> 'team_id') from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'corrections' -> 'notified') x),
  '4:c1250001-0000-4000-8000-000000000001,c1250001-0000-4000-8000-000000000002,c1250001-0000-4000-8000-000000000003,c1250001-0000-4000-8000-000000000004',
  'T5 the door''s own report names the same four (the report and the table agree)');

-- ---------------------------------------------------------------------------
-- N. NO FLIP — L2: Wade One L2 40 → 39 (T1 100 → 99): still beats T2 (97) and
--    T3 (95); the median 96 → 96 (97 / 95 are the middle pair). Nothing flips.
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.score_write_week_batch('b1250000-0000-4000-8000-000000000002', 2, '[
  {"team_id": "c1250002-0000-4000-8000-000000000001", "points": 99.00,
   "players": [{"slot": "qb:0", "player_id": "pgtap-cfn-q12", "points": 60, "pending": [], "reason": "scored"},
               {"slot": "wr:0", "player_id": "pgtap-cfn-w12", "points": 39, "pending": [], "reason": "scored"}],
   "corrections": ["e1250000-0000-4000-8000-000000000002"]}]')::text, true);
select is(pg_temp.rec('b1250000-0000-4000-8000-000000000002'),
  'Team One 100.00→99.00 {"h2h": "win", "median": "win", "second": "win"} → {"h2h": "win", "median": "win", "second": "win"} changed=false',
  'N1 GOLDEN: ONE record, result unchanged');
select is(pg_temp.post('b1250000-0000-4000-8000-000000000002'),
  'Stat correction (Week 2): Wade One L2''s receiving yards 97 → 87 — Team One 100.00 → 99.00.',
  'N2 GOLDEN: ONE post — the correction and the score, no result line');
select is(pg_temp.notes('b1250000-0000-4000-8000-000000000002'), 'none', 'N3 no notification without a flip');
select is(jsonb_array_length(current_setting('pgtap.r')::jsonb -> 'corrections' -> 'notified'), 0, 'N4 …and the door reports none');

-- ---------------------------------------------------------------------------
-- S. SECOND GAME + MEDIAN ONLY — L3: T1 100 v T2 90, T3 95 v T4 93, second
--    game T1 v T3. Wade One L3 40 → 32 (T1 100 → 92): T1 still beats T2
--    (92–90) but now loses the second game to T3 (95); the median 94 → 92.5
--    flips T1 (win → loss) and T4 (93: loss → win — he never started him).
--    The week as it stood BEFORE is captured for §M.
-- ---------------------------------------------------------------------------
select set_config('pgtap.before', public.stat_correction_week_state_internal('b1250000-0000-4000-8000-000000000003', 2088, 2)::text, true);
select set_config('pgtap.r', public.score_write_week_batch('b1250000-0000-4000-8000-000000000003', 2, '[
  {"team_id": "c1250003-0000-4000-8000-000000000001", "points": 92.00,
   "players": [{"slot": "qb:0", "player_id": "pgtap-cfn-q13", "points": 60, "pending": [], "reason": "scored"},
               {"slot": "wr:0", "player_id": "pgtap-cfn-w13", "points": 32, "pending": [], "reason": "scored"}],
   "corrections": ["e1250000-0000-4000-8000-000000000003"]}]')::text, true);
select set_config('pgtap.after', public.stat_correction_week_state_internal('b1250000-0000-4000-8000-000000000003', 2088, 2)::text, true);
select is(pg_temp.rec('b1250000-0000-4000-8000-000000000003'),
  'Team One 100.00→92.00 {"h2h": "win", "median": "win", "second": "win"} → {"h2h": "win", "median": "loss", "second": "loss"} changed=true',
  'S1 GOLDEN: the record — the matchup stands, the second game and the median flipped');
select is(pg_temp.post('b1250000-0000-4000-8000-000000000003'),
  'Stat correction (Week 2): Wade One L3''s receiving yards 97 → 17 — Team One 100.00 → 92.00. Result changed: Team Three now beats Team One 95.00–92.00 (second game). Median game: Team Four now wins the median game (it was losing); Team One now loses the median game (it was winning).',
  'S2 GOLDEN: the post names the second game and both median flips, and no h2h line');
select is(pg_temp.notes('b1250000-0000-4000-8000-000000000003'),
  'cfn_user1: Stat correction (Week 2): Wade One L3''s receiving yards 97 → 17 — Team One 100.00 → 92.00. In your second game Team Three now beats you (you were winning). You now lose the median game (you were winning).' || E'\n'
  || 'cfn_user3: Stat correction (Week 2): Wade One L3''s receiving yards 97 → 17 — Team One 100.00 → 92.00. In your second game you now beat Team One (you were losing).' || E'\n'
  || 'cfn_user4: Stat correction (Week 2): Wade One L3''s receiving yards 97 → 17 — Team One 100.00 → 92.00. You now win the median game (you were losing).',
  'S3 GOLDEN: T1 (second game + median), T3 (second game) and T4 (the median knock-on, never started him) told; T2 (nothing changed) not');

-- ---------------------------------------------------------------------------
-- R. THE CORRECTION FLIPS IT, ANOTHER TEAM FLIPS IT BACK (R1443) — L4: Wade
--    One L4 40 → 36 (T1 100 → 96) would hand T2 (97) the matchup, but in the
--    same batch T2 97 → 90 with no correction. The scoreboard is 96–90: T1
--    still wins. The median (actual 92.5) keeps T1 winning; T2 / T3 median
--    flips are T2''s own move. NOTHING is the correction''s: no result line,
--    no notification, result_changed false, the record''s results are the
--    stored matchup''s.
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.score_write_week_batch('b1250000-0000-4000-8000-000000000004', 2, '[
  {"team_id": "c1250004-0000-4000-8000-000000000001", "points": 96.00,
   "players": [{"slot": "qb:0", "player_id": "pgtap-cfn-q14", "points": 60, "pending": [], "reason": "scored"},
               {"slot": "wr:0", "player_id": "pgtap-cfn-w14", "points": 36, "pending": [], "reason": "scored"}],
   "corrections": ["e1250000-0000-4000-8000-000000000004"]},
  {"team_id": "c1250004-0000-4000-8000-000000000002", "points": 90.00,
   "players": [{"slot": "qb:0", "player_id": "pgtap-cfn-q24", "points": 90, "pending": [], "reason": "scored"}]}]')::text, true);
select is(
  (select home_score::text || '-' || away_score::text || ' ' || public.matchup_result_internal(home_score, away_score, away_team_id)
   from matchups where id = 'd1250004-0000-4000-8000-000000000001'),
  '96.00-90.00 home',
  'R1 the stored matchup: T1 96.00 v T2 90.00 — T1 still wins on the scoreboard');
select is(pg_temp.rec('b1250000-0000-4000-8000-000000000004'),
  'Team One 100.00→96.00 {"h2h": "win", "median": "win", "second": "win"} → {"h2h": "win", "median": "win", "second": "win"} changed=false',
  'R2 GOLDEN: the record says no result changed and its results ARE the stored matchup (win), never the correction-only loss');
select is(pg_temp.post('b1250000-0000-4000-8000-000000000004'),
  'Stat correction (Week 2): Wade One L4''s receiving yards 97 → 57 — Team One 100.00 → 96.00.',
  'R3 GOLDEN: the post names the correction and the score, and no result line (no Team Two now beats Team One)');
select is(pg_temp.notes('b1250000-0000-4000-8000-000000000004'), 'none', 'R4 no manager is told a stat correction changed his result');
select is(jsonb_array_length(current_setting('pgtap.r')::jsonb -> 'corrections' -> 'notified'), 0, 'R5 …and the door reports none');

-- ---------------------------------------------------------------------------
-- B. BOTH MOVE IT THE SAME WAY — L5: Wade One L5 40 → 34 (T1 100 → 94) and,
--    in the same batch, T2 97 → 99 with no correction. The actual week:
--    T2 beats T1, T3 beats T1 in the second game, median 94.5 (T1 loses, T3
--    wins). The but-for week (T1 at 100): T1 beats T2 99 and T3, median 97
--    (T1 wins, T3 loses) — every one of those flips is the correction''s.
--    Announced and notified with the REAL scores (99.00–94.00).
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.score_write_week_batch('b1250000-0000-4000-8000-000000000005', 2, '[
  {"team_id": "c1250005-0000-4000-8000-000000000001", "points": 94.00,
   "players": [{"slot": "qb:0", "player_id": "pgtap-cfn-q15", "points": 60, "pending": [], "reason": "scored"},
               {"slot": "wr:0", "player_id": "pgtap-cfn-w15", "points": 34, "pending": [], "reason": "scored"}],
   "corrections": ["e1250000-0000-4000-8000-000000000005"]},
  {"team_id": "c1250005-0000-4000-8000-000000000002", "points": 99.00,
   "players": [{"slot": "qb:0", "player_id": "pgtap-cfn-q25", "points": 99, "pending": [], "reason": "scored"}]}]')::text, true);
select is(pg_temp.rec('b1250000-0000-4000-8000-000000000005'),
  'Team One 100.00→94.00 {"h2h": "win", "median": "win", "second": "win"} → {"h2h": "loss", "median": "loss", "second": "loss"} changed=true',
  'B1 GOLDEN: the record — every flip the correction caused (the but-for week differs on each)');
select is(pg_temp.post('b1250000-0000-4000-8000-000000000005'),
  'Stat correction (Week 2): Wade One L5''s receiving yards 97 → 37 — Team One 100.00 → 94.00. Result changed: Team Two now beats Team One 99.00–94.00; Team Three now beats Team One 95.00–94.00 (second game). Median game: Team One now loses the median game (it was winning); Team Three now wins the median game (it was losing).',
  'B2 GOLDEN: announced with the REAL scores (99.00–94.00)');
select is(pg_temp.notes('b1250000-0000-4000-8000-000000000005'),
  'cfn_user1: Stat correction (Week 2): Wade One L5''s receiving yards 97 → 37 — Team One 100.00 → 94.00. Team Two now beats you 99.00–94.00 (you were winning). In your second game Team Three now beats you (you were winning). You now lose the median game (you were winning).' || E'\n'
  || 'cfn_user2: Stat correction (Week 2): Wade One L5''s receiving yards 97 → 37 — Team One 100.00 → 94.00. You now beat Team One 99.00–94.00 (you were losing).' || E'\n'
  || 'cfn_user3: Stat correction (Week 2): Wade One L5''s receiving yards 97 → 37 — Team One 100.00 → 94.00. In your second game you now beat Team One (you were losing). You now win the median game (you were losing).',
  'B3 GOLDEN: T1, T2 and T3 told, with the real 99.00–94.00');

-- ---------------------------------------------------------------------------
-- J. THE JOINT FLIP (R1446 case e — the reviewer''s probe) — L6: Wade One L6
--    40 → 39 (T1 100 → 99, the correction) and, in the same batch, T2 97 →
--    99.50 with no correction. The scoreboard: 99.00–99.50, T1 loses. But for
--    the correction T1 wins 100–99.50; T2''s move alone does not flip it, nor
--    does the correction alone (99 v 97). The correction is a but-for cause:
--    announced, T1 and T2 told, the REAL 99.50–99.00. Median (actual 97,
--    but-for 97.5) and the second game (99 v 95) unchanged.
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.score_write_week_batch('b1250000-0000-4000-8000-000000000006', 2, '[
  {"team_id": "c1250006-0000-4000-8000-000000000001", "points": 99.00,
   "players": [{"slot": "qb:0", "player_id": "pgtap-cfn-q16", "points": 60, "pending": [], "reason": "scored"},
               {"slot": "wr:0", "player_id": "pgtap-cfn-w16", "points": 39, "pending": [], "reason": "scored"}],
   "corrections": ["e1250000-0000-4000-8000-000000000006"]},
  {"team_id": "c1250006-0000-4000-8000-000000000002", "points": 99.50,
   "players": [{"slot": "qb:0", "player_id": "pgtap-cfn-q26", "points": 99.50, "pending": [], "reason": "scored"}]}]')::text, true);
select is(pg_temp.rec('b1250000-0000-4000-8000-000000000006'),
  'Team One 100.00→99.00 {"h2h": "win", "median": "win", "second": "win"} → {"h2h": "loss", "median": "win", "second": "win"} changed=true',
  'J1 GOLDEN: the record — the h2h loss is the correction''s (but for it T1 wins 100–99.50); result_changed true and consistent with before / after');
select is(pg_temp.post('b1250000-0000-4000-8000-000000000006'),
  'Stat correction (Week 2): Wade One L6''s receiving yards 97 → 87 — Team One 100.00 → 99.00. Result changed: Team Two now beats Team One 99.50–99.00.',
  'J2 GOLDEN: announced with the REAL scores (99.50–99.00)');
select is(pg_temp.notes('b1250000-0000-4000-8000-000000000006'),
  'cfn_user1: Stat correction (Week 2): Wade One L6''s receiving yards 97 → 87 — Team One 100.00 → 99.00. Team Two now beats you 99.50–99.00 (you were winning).' || E'\n'
  || 'cfn_user2: Stat correction (Week 2): Wade One L6''s receiving yards 97 → 87 — Team One 100.00 → 99.00. You now beat Team One 99.50–99.00 (you were losing).',
  'J3 GOLDEN: T1 and T2 told, with the real 99.50–99.00');
select is(
  (select string_agg(x ->> 'team_id', ',' order by x ->> 'team_id') from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'corrections' -> 'notified') x),
  'c1250006-0000-4000-8000-000000000001,c1250006-0000-4000-8000-000000000002',
  'J4 …and the door reports the same two');

-- ---------------------------------------------------------------------------
-- O. ANOTHER TEAM ALONE FLIPS THE CORRECTED TEAM (R1446 case b) — L7: Wade
--    One L7 40 → 39 (T1 100 → 99, the correction) and T2 97 → 101 with no
--    correction. T1 loses 99–101; but for the correction it loses 100–101 —
--    not the correction''s. Silent; the record honestly says the result
--    moved (win → loss) and that the correction did not move it.
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.score_write_week_batch('b1250000-0000-4000-8000-000000000007', 2, '[
  {"team_id": "c1250007-0000-4000-8000-000000000001", "points": 99.00,
   "players": [{"slot": "qb:0", "player_id": "pgtap-cfn-q17", "points": 60, "pending": [], "reason": "scored"},
               {"slot": "wr:0", "player_id": "pgtap-cfn-w17", "points": 39, "pending": [], "reason": "scored"}],
   "corrections": ["e1250000-0000-4000-8000-000000000007"]},
  {"team_id": "c1250007-0000-4000-8000-000000000002", "points": 101.00,
   "players": [{"slot": "qb:0", "player_id": "pgtap-cfn-q27", "points": 101, "pending": [], "reason": "scored"}]}]')::text, true);
select is(pg_temp.rec('b1250000-0000-4000-8000-000000000007'),
  'Team One 100.00→99.00 {"h2h": "win", "median": "win", "second": "win"} → {"h2h": "loss", "median": "win", "second": "win"} changed=false',
  'O1 GOLDEN: the record — result_before and result_after are the actual week (win → loss) and result_changed is false: T2''s move alone flipped it');
select is(pg_temp.post('b1250000-0000-4000-8000-000000000007'),
  'Stat correction (Week 2): Wade One L7''s receiving yards 97 → 87 — Team One 100.00 → 99.00.',
  'O2 GOLDEN: the post names the correction and the score, and no result line');
select is(pg_temp.notes('b1250000-0000-4000-8000-000000000007'), 'none', 'O3 nobody is told a stat correction changed his result');
select ok(
  (select r.result_before is distinct from r.result_after and not r.result_changed
   from public.league_stat_corrections r where r.league_id = 'b1250000-0000-4000-8000-000000000007')
  and col_description('public.league_stat_corrections'::regclass,
        (select attnum from pg_attribute where attrelid = 'public.league_stat_corrections'::regclass and attname = 'result_changed'))
      like 'TRUE exactly when this re-score''s corrections changed the team%but-for week%may differ with result_changed FALSE when another team%',
  'O4 the MEANING of result_changed is "changed by the correction": a stored row with result_before <> result_after and result_changed false, and the column comment says so');

-- ---------------------------------------------------------------------------
-- M. THE HELPER (the but-for week: the AFTER week with p_moves taken out)
-- ---------------------------------------------------------------------------
select is(
  public.stat_correction_week_state_but_for_internal('b1250000-0000-4000-8000-000000000003', 2088, 2,
    current_setting('pgtap.after')::jsonb, '{"c1250003-0000-4000-8000-000000000001": -8}'::jsonb) - 'points',
  current_setting('pgtap.before')::jsonb - 'points',
  'M1 on a single-team batch the but-for week IS the week before (teams, matchups, median — 172 state, rule for rule)');
select is(
  (select jsonb_object_agg(key, jsonb_build_object('h2h', value -> 'h2h', 'second', value -> 'second', 'median', value -> 'median', 'score', value -> 'score'))
   from jsonb_each(public.stat_correction_week_state_but_for_internal('b1250000-0000-4000-8000-000000000003', 2088, 2,
                     current_setting('pgtap.after')::jsonb, '{}'::jsonb) -> 'teams')),
  (select jsonb_object_agg(key, jsonb_build_object('h2h', value -> 'h2h', 'second', value -> 'second', 'median', value -> 'median', 'score', value -> 'score'))
   from jsonb_each(current_setting('pgtap.after')::jsonb -> 'teams')),
  'M2 an empty movement returns the after week''s scores and results');
select is(
  (public.stat_correction_week_state_but_for_internal('b1250000-0000-4000-8000-000000000003', 2088, 2,
     current_setting('pgtap.after')::jsonb, '{"c1250003-0000-4000-8000-000000000004": -3}'::jsonb) #>> '{teams,c1250003-0000-4000-8000-000000000004,h2h}')
  || ':' || (public.stat_correction_week_state_but_for_internal('b1250000-0000-4000-8000-000000000003', 2088, 2,
     current_setting('pgtap.after')::jsonb, '{"c1250003-0000-4000-8000-000000000004": -3}'::jsonb) #>> '{matchups,d1250003-0000-4000-8000-000000000002,result}'),
  'win:away',
  'M3 a movement on the AWAY side of a pairing flips it (T4, the away team, 93 minus -3 = 96.00 beats T3 95) — the helper reads both sides');
select is(
  (select count(*)::int from league_chat where league_id in ('b1250000-0000-4000-8000-000000000001', 'b1250000-0000-4000-8000-000000000002', 'b1250000-0000-4000-8000-000000000003') and is_system),
  3, 'M4 one post per re-score, one per league (unchanged)');

select * from finish();
rollback;
