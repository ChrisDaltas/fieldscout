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
--   §T  F557 / R1440 — TWO TEAMS MOVED in one batch: the correction's team
--       (T1, flips its matchup, its second game and the median) and another
--       team (T4, a settled line with no correction — it flips T3 v T4 and
--       the median). ONLY the correction's flips are announced and notified:
--       T1, T2 and T3 (second game + median) are told; T4 is not, and the
--       post never says "Team Four now beats Team Three".
--   §N  A correction that flips NOTHING — one record, result_changed false,
--       the post without a result line, no notification.
--   §S  SECOND GAME and MEDIAN only — the correction leaves T1's matchup
--       standing but flips its second game and the median, and the median
--       knock-on on a team that never started him (T4): exactly those told.
--   §M  the helper — on a single-team batch the week "as the correction
--       alone moved it" IS the week after (teams, matchups, median); an
--       empty movement returns the before state's results.
-- Break probes (the PR, reverted): P1 172's door back (pg_temp.un177 of the
-- live body, applied by psql) ⇒ T red; P2 the helper ignoring p_moves for
-- the opponent side ⇒ S / M red.
-- Worlds (season 2088 — its own calendar; measured unused 2026-10-02):
--   L1 b1250000…01, L2 …02, L3 …03 — h2h, median game ON, 4 teams each,
--   regular season 3 weeks, NO bracket; week 2 CORRECTION_WINDOW (games over).
--   u1–u4 manage T1–T4 in every league. T1 starts a QB (60) + a WR (40).
--     L1 / L2: T1 100.00 v T2 97.00, T3 95.00 v T4 80.00, second game T1 v T3.
--     L3:      T1 100.00 v T2 90.00, T3 95.00 v T4 93.00, second game T1 v T3.
-- Descriptions carry no bare apostrophes (house rule).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

-- pg_temp.un177 — 177's four hunks reversed (derive_177.py: H4 the post /
-- notification block back to v_after, then H3, H2, H1 by exact match).
create function pg_temp.un177(s text) returns text language plpgsql as $un$
declare a int; b int; seg text;
begin
  -- H4 reversed: v_moved -> v_after inside the post / notification block only
  a := strpos(s, $r$    IF jsonb_array_length(v_rec) > 0 THEN
$r$);
  if a > 0 then
    b := a + strpos(substr(s, a), $r$    v_corr := jsonb_build_object(
$r$) - 1;
    seg := substr(s, a, b - a);
    s := substr(s, 1, a - 1) || replace(seg, 'v_moved', 'v_after') || substr(s, b);
  end if;
  s := replace(s, $r$      END LOOP;
    END LOOP;

    -- 177 (B12 / F557): a result is "changed by the correction" only when
    -- the week as the corrections ALONE moved it (every other team at its
    -- before score) differs from the week before — h2h, second game and
    -- median (§11.7). Any other movement in the batch is not the
    -- correction's and is never announced or notified under it.
    v_moved := public.stat_correction_week_state_moved_internal(p_league_id, v_league.season, p_week, v_before, v_moves);
    FOR v_pr IN SELECT value FROM jsonb_array_elements(v_pend) WITH ORDINALITY ORDER BY ordinality LOOP
      v_tid := (v_pr ->> 'team_id')::uuid;
      v_tb := v_before -> 'teams' -> (v_tid::text);
      v_ta := v_moved  -> 'teams' -> (v_tid::text);
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
              v_results_final AND ROW(v_tb ->> 'h2h', v_tb ->> 'second', v_tb ->> 'median')
                                  IS DISTINCT FROM ROW(v_ta ->> 'h2h', v_ta ->> 'second', v_ta ->> 'median'))
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
  -- 177 (B12 / F557): the week as the CORRECTION alone moved it
  v_moves      JSONB := '{}'::jsonb;    -- team -> its recorded players' points movement
  v_moved      JSONB;                   -- v_before with ONLY those movements applied
  v_pend       JSONB := '[]'::jsonb;    -- this call's records, held until v_moved is known
  v_pr         JSONB;
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
   from pg_proc p where p.oid = 'public.stat_correction_week_state_moved_internal(uuid,integer,integer,jsonb,jsonb)'::regprocedure),
  'A2 the new helper is plain, STABLE, search_path empty and REVOKEd from anon and authenticated');
select is(
  (select md5(prosrc) from pg_proc where oid = 'public.score_write_week_batch(uuid,integer,jsonb)'::regprocedure),
  '10fca465849fd7677585303917817e86',
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
from generate_series(1, 3) i;

-- team t (1–4) of league l (1–3): c125000l-…-00000000000t
insert into teams (id, owner_id, name, league_id)
select ('c125000' || l || '-0000-4000-8000-00000000000' || t)::uuid,
       ('9f125000-0000-4000-8000-00000000000' || t)::uuid,
       (array['Team One', 'Team Two', 'Team Three', 'Team Four'])[t],
       ('b1250000-0000-4000-8000-00000000000' || l)::uuid
from generate_series(1, 3) l, generate_series(1, 4) t;
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select ('b1250000-0000-4000-8000-00000000000' || l)::uuid,
       ('9f125000-0000-4000-8000-00000000000' || t)::uuid,
       ('c125000' || l || '-0000-4000-8000-00000000000' || t)::uuid,
       case when t = 1 then 'commissioner' else 'manager' end, false, 100
from generate_series(1, 3) l, generate_series(1, 4) t;

insert into players (id, full_name, position, team, status)
select 'pgtap-cfn-' || p || l, n || ' L' || l, pos, 'KC', 'Active'
from generate_series(1, 3) l,
     (values ('q1', 'Quinn One', 'QB'), ('w1', 'Wade One', 'WR'), ('q2', 'Quinn Two', 'QB'),
             ('q3', 'Quinn Three', 'QB'), ('q4', 'Quinn Four', 'QB')) v(p, n, pos);

insert into league_weeks (league_id, season, week, status)
select ('b1250000-0000-4000-8000-00000000000' || l)::uuid, 2088, w, s
from generate_series(1, 3) l, (values (1, 'final'), (2, 'correction_window')) v(w, s);

-- week 2 pairings: m<l>1 T1 v T2, m<l>2 T3 v T4, m<l>3 second game T1 v T3
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status, result, is_overridden)
select ('d125000' || l || '-0000-4000-8000-00000000000' || k)::uuid, ('b1250000-0000-4000-8000-00000000000' || l)::uuid, 2088, 2, rt,
       ('c125000' || l || '-0000-4000-8000-00000000000' || h)::uuid, ('c125000' || l || '-0000-4000-8000-00000000000' || a)::uuid,
       hs, case when l = 3 then a3 else aws end, 'live', null, false
from generate_series(1, 3) l,
     (values (1, 'regular', 1, 2, 100.00, 97.00, 90.00), (2, 'regular', 3, 4, 95.00, 80.00, 93.00),
             (3, 'secondary', 1, 3, 100.00, 95.00, 95.00)) v(k, rt, h, a, hs, aws, a3);

insert into league_week_player_points (league_id, season, week, team_id, slot, player_id, points, reason, source)
select ('b1250000-0000-4000-8000-00000000000' || l)::uuid, 2088, 2, ('c125000' || l || '-0000-4000-8000-00000000000' || t)::uuid,
       slot, 'pgtap-cfn-' || p || l, case when l = 3 and t = 2 then 90.00 when l = 3 and t = 4 then 93.00 else pts end, 'scored', 'worker'
from generate_series(1, 3) l,
     (values (1, 'qb:0', 'q1', 60.00), (1, 'wr:0', 'w1', 40.00), (2, 'qb:0', 'q2', 97.00),
             (3, 'qb:0', 'q3', 95.00), (4, 'qb:0', 'q4', 80.00)) v(t, slot, p, pts);

insert into stat_correction_events (id, season, week, player_id, stat_key, old_value, new_value, detected_at, week_state, source, game_id) values
 ('e1250000-0000-4000-8000-000000000001', 2088, 2, 'pgtap-cfn-w11', 'receiving_yards', 97, 37, '2088-09-16 15:00+00', 'open', 'pgtap', 'pgtap-cfn-g2'),
 ('e1250000-0000-4000-8000-000000000002', 2088, 2, 'pgtap-cfn-w12', 'receiving_yards', 97, 87, '2088-09-16 15:00+00', 'open', 'pgtap', 'pgtap-cfn-g2'),
 ('e1250000-0000-4000-8000-000000000003', 2088, 2, 'pgtap-cfn-w13', 'receiving_yards', 97, 17, '2088-09-16 15:00+00', 'open', 'pgtap', 'pgtap-cfn-g2');

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
--    second game); the median 96 → 94.5 flips T1 (win → loss) and T3 (loss
--    → win). T4''s own move flips T3 v T4 and T4''s median — NOT the
--    correction''s doing.
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
  'Stat correction (Week 2): Wade One L1''s receiving yards 97 → 37 — Team One 100.00 → 94.00. Result changed: Team Two now beats Team One 97.00–94.00; Team Three now beats Team One 95.00–94.00 (second game). Median game: Team One now loses the median game (it was winning); Team Three now wins the median game (it was losing).',
  'T3 GOLDEN: ONE post naming ONLY the flips the correction caused — no Team Four now beats Team Three, no Team Four median line');
select is(pg_temp.notes('b1250000-0000-4000-8000-000000000001'),
  'cfn_user1: Stat correction (Week 2): Wade One L1''s receiving yards 97 → 37 — Team One 100.00 → 94.00. Team Two now beats you 97.00–94.00 (you were winning). In your second game Team Three now beats you (you were winning). You now lose the median game (you were winning).' || E'\n'
  || 'cfn_user2: Stat correction (Week 2): Wade One L1''s receiving yards 97 → 37 — Team One 100.00 → 94.00. You now beat Team One 97.00–94.00 (you were losing).' || E'\n'
  || 'cfn_user3: Stat correction (Week 2): Wade One L1''s receiving yards 97 → 37 — Team One 100.00 → 94.00. In your second game you now beat Team One (you were losing). You now win the median game (you were losing).',
  'T4 GOLDEN: notified exactly T1, T2 and T3 for the flips the correction made; T4 (whose own line flipped T3 v T4) is NOT told a stat correction changed his result, and T3 is not told of that matchup');
select is(
  jsonb_array_length(current_setting('pgtap.r')::jsonb -> 'corrections' -> 'notified')::text || ':'
  || (select string_agg(x ->> 'team_id', ',' order by x ->> 'team_id') from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'corrections' -> 'notified') x),
  '3:c1250001-0000-4000-8000-000000000001,c1250001-0000-4000-8000-000000000002,c1250001-0000-4000-8000-000000000003',
  'T5 the door''s own report names the same three (the report and the table agree)');

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
-- M. THE HELPER
-- ---------------------------------------------------------------------------
select is(
  public.stat_correction_week_state_moved_internal('b1250000-0000-4000-8000-000000000003', 2088, 2,
    current_setting('pgtap.before')::jsonb, '{"c1250003-0000-4000-8000-000000000001": -8}'::jsonb) - 'points',
  public.stat_correction_week_state_internal('b1250000-0000-4000-8000-000000000003', 2088, 2) - 'points',
  'M1 on a single-team batch the week as the correction alone moved it IS the week after (teams, matchups, median — 172 state, rule for rule)');
select is(
  (select jsonb_object_agg(key, jsonb_build_object('h2h', value -> 'h2h', 'second', value -> 'second', 'median', value -> 'median', 'score', value -> 'score'))
   from jsonb_each(public.stat_correction_week_state_moved_internal('b1250000-0000-4000-8000-000000000003', 2088, 2,
                     current_setting('pgtap.before')::jsonb, '{}'::jsonb) -> 'teams')),
  (select jsonb_object_agg(key, jsonb_build_object('h2h', value -> 'h2h', 'second', value -> 'second', 'median', value -> 'median', 'score', value -> 'score'))
   from jsonb_each(current_setting('pgtap.before')::jsonb -> 'teams')),
  'M2 an empty movement returns the before state''s scores and results');
select is(
  (public.stat_correction_week_state_moved_internal('b1250000-0000-4000-8000-000000000003', 2088, 2,
     current_setting('pgtap.before')::jsonb, '{"c1250003-0000-4000-8000-000000000004": 3}'::jsonb) #>> '{teams,c1250003-0000-4000-8000-000000000004,h2h}')
  || ':' || (public.stat_correction_week_state_moved_internal('b1250000-0000-4000-8000-000000000003', 2088, 2,
     current_setting('pgtap.before')::jsonb, '{"c1250003-0000-4000-8000-000000000004": 3}'::jsonb) #>> '{matchups,d1250003-0000-4000-8000-000000000002,result}'),
  'win:away',
  'M3 a movement on the AWAY side of a pairing flips it (T4, the away team, 93 + 3 = 96.00 now beats T3 95) — the helper reads both sides');
select is(
  (select count(*)::int from league_chat where league_id in ('b1250000-0000-4000-8000-000000000001', 'b1250000-0000-4000-8000-000000000002', 'b1250000-0000-4000-8000-000000000003') and is_system),
  3, 'M4 one post per re-score, one per league (unchanged)');

select * from finish();
rollback;
