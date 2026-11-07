-- ============================================================================
-- 173 — the stat-correction post and notification print a blank team score
--       as "—", never "pending" (migration 221; PROGRESS F911, D847; D845's
--       last place; spec §16.4 / §23.4, v2.16.117)
-- ============================================================================
-- Chris 2026-11-06, verbatim: "i've never heard of this pending thing before.
-- been playing fantasy football on multiple platforms for decades and i've
-- never heard of pending."
--
-- What this file proves, over REAL calls of the scoring door in one
-- rolled-back transaction:
--   §A  FORM and D137 — the door still SECURITY DEFINER, search_path '',
--       ONE overload, REVOKEd from anon / authenticated with EXECUTE for the
--       service role; the live prosrc a STORED-LITERAL md5; pg_temp.un221
--       reverses 221's one hunk on the LIVE body to 177's text byte for byte
--       (pgTAP 125 A3's stored literal); the dash fallback is there twice and
--       the word fallback is gone.
--   §N  A correction onto a team whose score was BLANK (a starter's stats not
--       all in): the post and both managers' notifications read
--       "Team One — → 101.40", never "pending" (golden, stored literals). The
--       same fixture through 177's door (pg_temp.door177 = un221 of the live
--       body) said "Team One pending → 101.40" — the fixture reaches the
--       fallback.
--   §B  A correction that leaves the team's score blank (live week, so no
--       result is announced): the post reads "Team One 100.00 → —"; 177's
--       door said "100.00 → pending".
--   §C  An ORDINARY correction (number → number, a flip, both managers
--       told): the post and the notifications are golden stored literals AND
--       byte-identical to 177's door on a twin league — nothing else moved.
--   §Z  No league post and no notification written by the 221 door says
--       "pending" in any case.
-- Break probe (the PR, reverted): 221's two fallbacks back to 'pending' ⇒
-- A2 / A3 / A4 and every §N / §B golden red.
-- Worlds (season 2093 — its own calendar; unused by any other pgTAP file):
--   L1 … L6 b1730000-…-00000000000l — h2h, median game OFF, two teams
--   (T1 v T2, managed by u1 / u2), regular season 3 weeks, no bracket.
--   T1 starts a QB and a WR ("Wade One" — the same name in every league, so
--   twin posts compare byte for byte); T2 a QB at 97.00.
--     L1 / L2 (§N, correction window): T1 BLANK — QB 60 still pending, WR 10.
--     L3 / L4 (§B, live week):         T1 100.00 — QB 60, WR 40.
--     L5 / L6 (§C, correction window): T1 100.00 — QB 60, WR 40.
--   L1 / L3 / L5 through the live door (221); L2 / L4 / L6 through 177's.
-- Descriptions carry no bare apostrophes (house rule).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

-- pg_temp.un221 — 221's one hunk reversed (the two fallbacks back to 177's).
create function pg_temp.un221(s text) returns text language sql as $un$
  select replace(s, $r$'FM999999990.00'), '—')$r$, $o$'FM999999990.00'), 'pending')$o$);
$un$;

-- ---------------------------------------------------------------------------
-- A. FORM and D137
-- ---------------------------------------------------------------------------
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
          and not has_function_privilege('anon', p.oid, 'EXECUTE')
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
          and has_function_privilege('service_role', p.oid, 'EXECUTE')
          and (select count(*) from pg_proc q join pg_namespace n on n.oid = q.pronamespace
               where n.nspname = 'public' and q.proname = 'score_write_week_batch') = 1
   from pg_proc p where p.oid = 'public.score_write_week_batch(uuid,integer,jsonb)'::regprocedure),
  'A1 the door is still ONE overload, SECURITY DEFINER, search_path empty, REVOKEd from anon and authenticated, EXECUTE for the service role');
select is(
  (select md5(prosrc) from pg_proc where oid = 'public.score_write_week_batch(uuid,integer,jsonb)'::regprocedure),
  '0bab189d8f6e8ed88d538fb0d99a92b7',
  'A2 the live door body is 221 as written (STORED LITERAL md5; 177:222-879 plus one hunk)');
select is(
  (select md5(pg_temp.un221(prosrc)) from pg_proc where oid = 'public.score_write_week_batch(uuid,integer,jsonb)'::regprocedure),
  '3ea8ee6417852e5d46dc79e8093a1daf',
  'A3 D137: with the one hunk reversed on the LIVE body it is 177 BYTE FOR BYTE (pgTAP 125 A3 stored literal)');
select is(
  (select ((length(prosrc) - length(replace(prosrc, $d$'FM999999990.00'), '—')$d$, ''))) / length($d$'FM999999990.00'), '—')$d$))::text
          || ':' || ((length(prosrc) - length(replace(prosrc, $w$'FM999999990.00'), 'pending')$w$, ''))) / length($w$'FM999999990.00'), 'pending')$w$))::text
   from pg_proc where oid = 'public.score_write_week_batch(uuid,integer,jsonb)'::regprocedure),
  '2:0',
  'A4 the blank-score fallback is the dash twice (before and after) and the word fallback is gone');

-- 177's door, rebuilt from the LIVE body (A3 proves it is 177 byte for byte).
do $mk$ begin
  execute format('create function pg_temp.door177(p_league_id uuid, p_week integer, p_scores jsonb) returns jsonb language plpgsql as %L',
    (select pg_temp.un221(prosrc) from pg_proc where oid = 'public.score_write_week_batch(uuid,integer,jsonb)'::regprocedure));
end $mk$;

-- ---------------------------------------------------------------------------
-- FIXTURES (postgres context, JWT cleared).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('9f173000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-cpd' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'cpd_user' || i)::jsonb, now(), now()
from generate_series(1, 2) i;

insert into nfl_weeks (season, week, starts_at, first_kickoff_at, correction_window_ends_at) values
 (2093, 1, '2093-09-04 04:00+00', '2093-09-06 00:15+00', '2093-09-12 10:00+00'),
 (2093, 2, '2093-09-11 04:00+00', '2093-09-13 00:15+00', '2093-09-19 10:00+00');
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('pgtap-cpd-g1', 2093, 1, 'KC', 'BUF', '2093-09-06 00:15+00', 'final'),
 ('pgtap-cpd-g2', 2093, 2, 'KC', 'BUF', '2093-09-13 00:15+00', 'final');

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks,
                     playoff_teams, playoff_start_week, faab_budget,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings)
select ('b1730000-0000-4000-8000-00000000000' || i)::uuid,
       '9f173000-0000-4000-8000-000000000001', 'pgtap-cpd-L' || i, 2093, 'in_season', 8, 3, 0, 4, 100,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', '{"schedule_mode": "h2h", "median_game": false}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'
from generate_series(1, 6) i;

-- team t (1–2) of league l (1–6): c173000l-…-00000000000t
insert into teams (id, owner_id, name, league_id)
select ('c173000' || l || '-0000-4000-8000-00000000000' || t)::uuid,
       ('9f173000-0000-4000-8000-00000000000' || t)::uuid,
       (array['Team One', 'Team Two'])[t],
       ('b1730000-0000-4000-8000-00000000000' || l)::uuid
from generate_series(1, 6) l, generate_series(1, 2) t;
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select ('b1730000-0000-4000-8000-00000000000' || l)::uuid,
       ('9f173000-0000-4000-8000-00000000000' || t)::uuid,
       ('c173000' || l || '-0000-4000-8000-00000000000' || t)::uuid,
       case when t = 1 then 'commissioner' else 'manager' end, false, 100
from generate_series(1, 6) l, generate_series(1, 2) t;

insert into players (id, full_name, position, team, status)
select 'pgtap-cpd-' || p || l, n, pos, 'KC', 'Active'
from generate_series(1, 6) l,
     (values ('q1', 'Quinn One', 'QB'), ('w1', 'Wade One', 'WR'), ('q2', 'Quinn Two', 'QB')) v(p, n, pos);

insert into league_weeks (league_id, season, week, status)
select ('b1730000-0000-4000-8000-00000000000' || l)::uuid, 2093, w,
       case when w = 1 then 'final' when l in (3, 4) then 'live' else 'correction_window' end
from generate_series(1, 6) l, generate_series(1, 2) w;

-- week 2: m<l> T1 v T2 — T1 BLANK in L1 / L2, 100.00 elsewhere; T2 97.00
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status, result, is_overridden)
select ('d173000' || l || '-0000-4000-8000-000000000001')::uuid, ('b1730000-0000-4000-8000-00000000000' || l)::uuid, 2093, 2, 'regular',
       ('c173000' || l || '-0000-4000-8000-000000000001')::uuid, ('c173000' || l || '-0000-4000-8000-000000000002')::uuid,
       case when l in (1, 2) then null else 100.00 end, 97.00, 'live', null, false
from generate_series(1, 6) l;

-- the stored lines ARE the scores (158): T1 blank ⇔ its QB pending
insert into league_week_player_points (league_id, season, week, team_id, slot, player_id, points, pending, reason, source)
select ('b1730000-0000-4000-8000-00000000000' || l)::uuid, 2093, 2, ('c173000' || l || '-0000-4000-8000-00000000000' || t)::uuid,
       slot, 'pgtap-cpd-' || p || l,
       case when l in (1, 2) and p = 'w1' then 10.00 else pts end,
       case when l in (1, 2) and p = 'q1' then array['passing_yards'] else '{}'::text[] end,
       'scored', 'worker'
from generate_series(1, 6) l,
     (values (1, 'qb:0', 'q1', 60.00), (1, 'wr:0', 'w1', 40.00), (2, 'qb:0', 'q2', 97.00)) v(t, slot, p, pts);

insert into stat_correction_events (id, season, week, player_id, stat_key, old_value, new_value, detected_at, week_state, source, game_id)
select ('e1730000-0000-4000-8000-00000000000' || l)::uuid, 2093, 2, 'pgtap-cpd-w1' || l, 'receiving_yards',
       case when l in (1, 2) then 100 else 400 end, case when l in (1, 2) then 414 else 340 end,
       '2093-09-15 15:00+00', 'open', 'pgtap', 'pgtap-cpd-g2'
from generate_series(1, 6) l;

create function pg_temp.notes(p_league uuid) returns text language sql as $n$
  select coalesce(string_agg(u.raw_user_meta_data ->> 'username' || ': ' || coalesce(n.body, 'NULL'), E'\n' order by u.raw_user_meta_data ->> 'username'), 'none')
  from public.notifications n join auth.users u on u.id = n.user_id
  where n.type = 'stat_correction_result' and (n.data ->> 'league_id') = p_league::text;
$n$;
create function pg_temp.post(p_league uuid) returns text language sql as $p$
  select coalesce(string_agg(message, E'\n' order by created_at), 'none') from public.league_chat where league_id = p_league and is_system;
$p$;

-- the three batches, each sent to a 221 league and to its 177 twin
--   §N: T1's QB is in (60, pending cleared) and Wade One 10 → 41.40: 101.40
--   §B: Wade One 40 → 34 and T1's QB still pending: T1 stays BLANK
--   §C: Wade One 40 → 34: T1 100.00 → 94.00 (T2 97.00 now wins)
create function pg_temp.batch(p_l int) returns jsonb language sql as $b$
  select replace(case
    when p_l in (1, 2) then '[{"team_id": "c173000{L}-0000-4000-8000-000000000001", "points": 101.40,
       "players": [{"slot": "qb:0", "player_id": "pgtap-cpd-q1{L}", "points": 60, "pending": [], "reason": "scored"},
                   {"slot": "wr:0", "player_id": "pgtap-cpd-w1{L}", "points": 41.40, "pending": [], "reason": "scored"}],
       "corrections": ["e1730000-0000-4000-8000-00000000000{L}"]}]'
    when p_l in (3, 4) then '[{"team_id": "c173000{L}-0000-4000-8000-000000000001", "points": null,
       "players": [{"slot": "qb:0", "player_id": "pgtap-cpd-q1{L}", "points": 60, "pending": ["passing_yards"], "reason": "scored"},
                   {"slot": "wr:0", "player_id": "pgtap-cpd-w1{L}", "points": 34, "pending": [], "reason": "scored"}],
       "corrections": ["e1730000-0000-4000-8000-00000000000{L}"]}]'
    else '[{"team_id": "c173000{L}-0000-4000-8000-000000000001", "points": 94.00,
       "players": [{"slot": "qb:0", "player_id": "pgtap-cpd-q1{L}", "points": 60, "pending": [], "reason": "scored"},
                   {"slot": "wr:0", "player_id": "pgtap-cpd-w1{L}", "points": 34, "pending": [], "reason": "scored"}],
       "corrections": ["e1730000-0000-4000-8000-00000000000{L}"]}]' end,
    '{L}', p_l::text)::jsonb;
$b$;

select set_config('pgtap.r1', public.score_write_week_batch('b1730000-0000-4000-8000-000000000001', 2, pg_temp.batch(1))::text, true);
select set_config('pgtap.r2', pg_temp.door177('b1730000-0000-4000-8000-000000000002', 2, pg_temp.batch(2))::text, true);
select set_config('pgtap.r3', public.score_write_week_batch('b1730000-0000-4000-8000-000000000003', 2, pg_temp.batch(3))::text, true);
select set_config('pgtap.r4', pg_temp.door177('b1730000-0000-4000-8000-000000000004', 2, pg_temp.batch(4))::text, true);
select set_config('pgtap.r5', public.score_write_week_batch('b1730000-0000-4000-8000-000000000005', 2, pg_temp.batch(5))::text, true);
select set_config('pgtap.r6', pg_temp.door177('b1730000-0000-4000-8000-000000000006', 2, pg_temp.batch(6))::text, true);

-- ---------------------------------------------------------------------------
-- N. A CORRECTION ONTO A BLANK SCORE — L1 (221) / L2 (177). Before: T1 blank
--    (reads 0 for the matchup — losing to 97.00). After: 101.40, a win. But
--    for the correction (Wade One back at 10): 70.00, a loss — so the flip is
--    the correction''s: announced, both managers told.
-- ---------------------------------------------------------------------------
select is(
  (select coalesce(home_score::text, 'blank') || '-' || away_score::text || ' '
          || (select coalesce(team_score_before::text, 'blank') || '→' || team_score_after::text || ' changed=' || result_changed::text
              from league_stat_corrections where league_id = 'b1730000-0000-4000-8000-000000000001')
   from matchups where id = 'd1730001-0000-4000-8000-000000000001'),
  '101.40-97.00 blank→101.40 changed=true',
  'N1 the score was written and ONE record holds the blank before (NULL kept, never 0) and the flip');
select is(pg_temp.post('b1730000-0000-4000-8000-000000000001'),
  'Stat correction (Week 2): Wade One''s receiving yards 100 → 414 — Team One — → 101.40. Result changed: Team One now beats Team Two 101.40–97.00.',
  'N2 GOLDEN: the league post prints the blank score as the dash');
select is(pg_temp.notes('b1730000-0000-4000-8000-000000000001'),
  'cpd_user1: Stat correction (Week 2): Wade One''s receiving yards 100 → 414 — Team One — → 101.40. You now beat Team Two 101.40–97.00 (you were losing).' || E'\n'
  || 'cpd_user2: Stat correction (Week 2): Wade One''s receiving yards 100 → 414 — Team One — → 101.40. Team One now beats you 101.40–97.00 (you were winning).',
  'N3 GOLDEN: both managers notified, each body printing the blank score as the dash');
select is(
  (current_setting('pgtap.r1')::jsonb -> 'corrections' ->> 'post') = pg_temp.post('b1730000-0000-4000-8000-000000000001')
  and (select bool_and(position('Team One — → 101.40' in x ->> 'body') > 0) and count(*) = 2
       from jsonb_array_elements(current_setting('pgtap.r1')::jsonb -> 'corrections' -> 'notified') x),
  true,
  'N4 the door report carries the same post and the same two bodies');
select is(
  pg_temp.post('b1730000-0000-4000-8000-000000000002') || E'\n' || pg_temp.notes('b1730000-0000-4000-8000-000000000002'),
  'Stat correction (Week 2): Wade One''s receiving yards 100 → 414 — Team One pending → 101.40. Result changed: Team One now beats Team Two 101.40–97.00.' || E'\n'
  || 'cpd_user1: Stat correction (Week 2): Wade One''s receiving yards 100 → 414 — Team One pending → 101.40. You now beat Team Two 101.40–97.00 (you were losing).' || E'\n'
  || 'cpd_user2: Stat correction (Week 2): Wade One''s receiving yards 100 → 414 — Team One pending → 101.40. Team One now beats you 101.40–97.00 (you were winning).',
  'N5 the same batch through 177s door said pending in the post and both notifications (F911 as filed): the fixture reaches the fallback');
select is(
  replace(pg_temp.post('b1730000-0000-4000-8000-000000000002') || E'\n' || pg_temp.notes('b1730000-0000-4000-8000-000000000002'), 'Team One pending →', 'Team One — →'),
  pg_temp.post('b1730000-0000-4000-8000-000000000001') || E'\n' || pg_temp.notes('b1730000-0000-4000-8000-000000000001'),
  'N6 …and that word is the ONLY difference between the two doors on this batch');

-- ---------------------------------------------------------------------------
-- B. A CORRECTION THAT LEAVES THE SCORE BLANK — L3 (221) / L4 (177), a LIVE
--    week: the score line is posted; no result is announced while games are
--    still being played, so no notification.
-- ---------------------------------------------------------------------------
select is(
  (select coalesce(home_score::text, 'blank') || '-' || away_score::text from matchups where id = 'd1730003-0000-4000-8000-000000000001')
  || ' ' || pg_temp.post('b1730000-0000-4000-8000-000000000003'),
  'blank-97.00 Stat correction (Week 2): Wade One''s receiving yards 400 → 340 — Team One 100.00 → —.',
  'B1 GOLDEN: the score is written blank (NULL, never 0) and the post prints it as the dash');
select is(pg_temp.notes('b1730000-0000-4000-8000-000000000003'), 'none', 'B2 a live week announces no result, so no notification');
select is(pg_temp.post('b1730000-0000-4000-8000-000000000004'),
  'Stat correction (Week 2): Wade One''s receiving yards 400 → 340 — Team One 100.00 → pending.',
  'B3 the same batch through 177s door said pending (the after side of F911)');

-- ---------------------------------------------------------------------------
-- C. AN ORDINARY CORRECTION (number → number) — L5 (221) / L6 (177): Wade One
--    40 → 34, T1 100.00 → 94.00, T2 97.00 now wins; both told.
-- ---------------------------------------------------------------------------
select is(pg_temp.post('b1730000-0000-4000-8000-000000000005'),
  'Stat correction (Week 2): Wade One''s receiving yards 400 → 340 — Team One 100.00 → 94.00. Result changed: Team Two now beats Team One 97.00–94.00.',
  'C1 GOLDEN: the ordinary post, numbers both sides');
select is(pg_temp.notes('b1730000-0000-4000-8000-000000000005'),
  'cpd_user1: Stat correction (Week 2): Wade One''s receiving yards 400 → 340 — Team One 100.00 → 94.00. Team Two now beats you 97.00–94.00 (you were winning).' || E'\n'
  || 'cpd_user2: Stat correction (Week 2): Wade One''s receiving yards 400 → 340 — Team One 100.00 → 94.00. You now beat Team One 97.00–94.00 (you were losing).',
  'C2 GOLDEN: the ordinary notifications');
select is(
  pg_temp.post('b1730000-0000-4000-8000-000000000005') || E'\n' || pg_temp.notes('b1730000-0000-4000-8000-000000000005')
  || E'\n' || (((current_setting('pgtap.r5')::jsonb -> 'corrections') - 'records') - 'notified')::text,
  pg_temp.post('b1730000-0000-4000-8000-000000000006') || E'\n' || pg_temp.notes('b1730000-0000-4000-8000-000000000006')
  || E'\n' || (((current_setting('pgtap.r6')::jsonb -> 'corrections') - 'records') - 'notified')::text,
  'C3 …byte for byte what 177s door posts, notifies and reports on a twin league: nothing but the blank-score word moved');

-- ---------------------------------------------------------------------------
-- Z. NEVER THE WORD
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from league_chat
   where league_id in ('b1730000-0000-4000-8000-000000000001', 'b1730000-0000-4000-8000-000000000003', 'b1730000-0000-4000-8000-000000000005')
     and message ilike '%pending%')
  + (select count(*)::int from notifications
     where (data ->> 'league_id') in ('b1730000-0000-4000-8000-000000000001', 'b1730000-0000-4000-8000-000000000003', 'b1730000-0000-4000-8000-000000000005')
       and (body ilike '%pending%' or title ilike '%pending%')),
  0,
  'Z1 no post and no notification the 221 door wrote says pending');

select * from finish();
rollback;
