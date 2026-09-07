-- ============================================================================
-- pgTAP 066 — migration 118: playoffs (task L.D1.8; spec v2.16.25 §11.5 /
-- §11.7 / §7.3.1 / §7.3.7 / §7.1 / §16.2 / E38 / E43; PROGRESS Q39 (A)–(E)
-- RULED 2026-09-07 and applied here; D137 / D288 / D297 / D313 / D314 /
-- D318; F212 (cited) / F242 (discharged) / F253(a) (discharged); tasks-M4
-- §4 rules 1–11).
--
-- WHAT IS PINNED (every instant a stored literal on the 2026 calendar, the
-- 064/065 shape; the REAL jobs driven at literal instants with D146 twins):
--   A. Form — DEFINER / search_path / REVOKE per function; the prosrc pins
--      (both jobs call the sync BY NAME; the write helper reads the derive
--      helper + the median helper and carries no median arithmetic; the
--      chain lives in exactly ONE prosrc; `league_standings(uuid)` keeps
--      117's signature); the two columns + the three CHECKs.
--   B. The pure goldens — bracket size per `playoff_teams`; rider (i)'s
--      pairings per size as literals; rider (ii)'s reseed/fixed divergence
--      on the 6-team survivors; the refusals by name; the median helper.
--   C. F242 — a week with NO later calendar row (2026 week 18), one final +
--      one in-week postponed game ⇒ `open 1, postponed 0, all_final false`.
--   D. The projected standings (F253(a)) — a `correction_window` / `live`
--      week changes the projected order and NOT the final one; an
--      `upcoming` week never counts; a NULL score is 0.00 so far; the
--      re-derived median ≡ finalization's (P5); total_points reads the
--      worker's provisional rows; the member / non-member doors.
--   E. THE SEASON — four leagues on one calendar:
--        P1 (h2h, 8 teams A–H, H RETIRED, rsw 4 = weeks 3–6, playoff_teams 6,
--           1-week rounds = weeks 7–9, reseed on): the season-long PROJECTED
--           bracket read; the PROVISIONAL round 1 at week 6's ROLLOVER
--           (10-20 04:00Z — Q39 (E)) from the projected table, in_season →
--           playoffs; the correction that moves seed 6 (G → D) and the
--           REBUILD at the close (10-22 10:00Z); the foreign-row skip and its
--           retry; the (A) tie (B 100.104 v F 100.096 ⇒ 'tie' stays, B
--           advances); the reseed on/off divergence THROUGH the rewrite
--           path; a decided round never recomputed under a corrupted
--           regular season; the champion (A) + complete.
--        P2 (h2h, 4 teams W–Z, playoff_teams 0): (D) — the champion is rank
--           1 through the FULL chain (W, 3-1, PF 300) and NOT the PF leader
--           (X, 2-2, PF 400); in_season → complete at week 6's final.
--        P3 (total_points, 4 teams K–N, playoff_teams 0 by (C)): the
--           points race — never the bracket path; champion K at the final.
--        P5 (h2h, 4 teams P/R/Q/S, playoff_teams 2, TWO-WEEK final, median
--           on): the DoD tie fixture (Q and R tied on the combined record
--           AND PF; PA would put R first; head-to-head seeds Q) — a bracket
--           seeded from raw Win % reds it; (B) the two-week SUM (the week-1
--           loser P wins the aggregate 200–170) and the equal-sum arm (the
--           higher seed — the recorded reading).
--      Forward-only: a complete league is never claimed; `playoffs` never
--      goes back by a job path.
--   F. (C) — `create_league` / `update_league_settings` refuse
--      `playoff_teams > 0` + total_points BY NAME (`playoff_teams` in the
--      message; P0001), each with its one-unit twin (0 + total_points ok;
--      > 0 + h2h ok); a STORED pair (a pre-118 row, or a fixture's) reads
--      as a points race — the mode is what the engine reads, never
--      `playoff_teams`.
--
--   P1 regular season (home/away; H retired after the fixture):
--     W3: A–B 100/90 · C–D 100/80 · E–F 95/85 · G–H 70/110
--     W4: A–C 100/90 · B–D 100/70 · E–G 100/80 · F–H 90/120
--     W5: A–D 110/100 · B–C 80/100 · E–H 90/130 · F–G 100/95
--     W6: A–E 100/90 · B–F 100/70 · C–G 90/95 (the CORRECTION → 96/95) · D–H 100/105
--   Final-only through W5: A 3-0/310 · C 2-1/290 · E 2-1/285 · F 1-2/275 ·
--     B 1-2/270 · D 0-3/250 · G 0-3/245  ⇒ A,C,E,F,B,D,G
--   Projected with W6 (C 90/95): A 4-0/410 · C 2-2/380 · E 2-2/375 ·
--     B 2-2/370 · F 1-3/345 · G 1-3/340 · D 0-4/350 ⇒ A,C,E,B,F,G,D
--     ⇒ seeds A1 C2 E3 B4 F5 G6 — byes A, C; E v G; B v F
--   Final with the correction (C 96/95): C 3-1/386 · G 0-4/340 ⇒
--     A,C,E,B,F,D,G ⇒ seeds A1 C2 E3 B4 F5 D6 — E v D; B v F
--   Round 1 (W7): E 100 / D 110 ⇒ D · B 100.104 / F 100.096 ⇒ tie, B (A)
--     survivors A(1,l1) C(2,l2) D(6,l3) B(4,l4)
--   Round 2 (W8) reseed: A v D, C v B · fixed: A v B, C v D (the divergence)
--     played reseed: A 120 / D 90 ⇒ A · C 80 / B 95 ⇒ B
--   Round 3 (W9): A 130 / B 100 ⇒ champion A
--   P5: W3 P–Q 100/80, R–S 90/85 · W4 P–R 100/80, Q–S 90/70 · W5 P–S 100/70,
--     Q–R 90/80 · W6 P–Q 100/80, R–S 90/85; median per week 87.5/85/85/87.5
--     ⇒ P 8-0/400 · Q 4-4/340/PA 350 · R 4-4/340/PA 360 · S 0-8/310
--     final W7: P 80 / Q 90 · W8: P 120 / Q 80 ⇒ 200–170, P
--   P2: W3 W–X 80/70, Y–Z 60/50 · W4 W–Y 80/60, X–Z 120/50 · W5 W–Z 80/50,
--     X–Y 120/130 · W6 W–X 60/90, Y–Z 40/50 ⇒ W 3-1/300 · X 2-2/400 ·
--     Y 2-2/290 · Z 1-3/200
--   P3: K 100 · L 90 · M 80 · N 70 per week (the worker's rows).
--   Calendar: week w starts Wed 04:00Z, rolls over Tue 04:00Z, closes Thu
--     10:00Z — weeks 3..9 as literals below; week 18 untouched (F242).
--   Privileged work runs as postgres (auth.uid() NULL); the member /
--   non-member cells set a claim and reset it (D49(7)).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(157);

-- ---------------------------------------------------------------------------
-- A. Form pins
-- ---------------------------------------------------------------------------
select ok(
  (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('league_standings', 'league_standings_projected', 'league_playoff_bracket', 'league_week_advance', 'finalize_matchups', 'create_league', 'update_league_settings')),
  'A1 the three member reads and the four replaced RPCs are SECURITY DEFINER with search_path='''' (rule 2)');
select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('week_median_internal', 'week_results_derive_internal', 'week_results_write_internal', 'league_standings_internal',
                                                'playoff_bracket_size_internal', 'playoff_round_pairs_internal', 'playoff_bracket_state_internal', 'playoff_bracket_sync_internal')),
  'A2 the eight helpers are PLAIN with search_path='''' — reached through the DEFINER callers, the jobs or as postgres');
select is(
  (select string_agg(p.proname || ':' || p.provolatile::text, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('week_median_internal', 'playoff_bracket_size_internal', 'playoff_round_pairs_internal', 'playoff_bracket_state_internal', 'week_results_derive_internal', 'league_standings_internal')),
  'league_standings_internal:s,playoff_bracket_size_internal:i,playoff_bracket_state_internal:s,playoff_round_pairs_internal:i,week_median_internal:i,week_results_derive_internal:s',
  'A3 the pure helpers are IMMUTABLE, the readers STABLE');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'league_standings'),
  'p_league_id uuid', 'A4 league_standings(p_league_id) keeps 117''s one-argument signature (065 A3 holds; every consumer binds)');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'league_standings_internal'),
  'p_league_id uuid, p_projected boolean', 'A4b league_standings_internal(p_league_id, p_projected) — the one implementation behind both wrappers');
select ok(
  not has_function_privilege('anon', 'public.league_standings_projected(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.league_standings_projected(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.league_playoff_bracket(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.league_playoff_bracket(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.league_playoff_bracket(uuid)', 'EXECUTE'),
  'A5 the two new member reads: REVOKEd from anon, kept for authenticated (in-body auth decides) and the service role');
select ok(
  not has_function_privilege('authenticated', 'public.week_median_internal(numeric[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.week_results_derive_internal(uuid,integer,integer,boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.league_standings_internal(uuid,boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.playoff_bracket_size_internal(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.playoff_round_pairs_internal(jsonb,integer,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.playoff_bracket_state_internal(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.playoff_bracket_sync_internal(uuid,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.playoff_bracket_sync_internal(uuid,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.league_week_advance(timestamptz,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.finalize_matchups(timestamptz,uuid)', 'EXECUTE'),
  'A6 the helpers are REVOKEd from anon + authenticated; the replaced jobs keep their REVOKE (load-bearing on a fresh CREATE)');
select ok(
  (select bool_and(p.prosrc like '%public.playoff_bracket_sync_internal(v_lg.id, p_now)%')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('league_week_advance', 'finalize_matchups')),
  'A7 both jobs call the bracket sync BY NAME (D137 — one writer)');
select ok(
  (select p.prosrc like '%public.week_results_derive_internal(p_league_id, p_season, p_week, FALSE)%'
      and p.prosrc like '%public.week_median_internal(v_arr)%'
      and p.prosrc not like '%v_arr[v_n / 2]%'
      and p.prosrc not like '%s.res, TRUE%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'week_results_write_internal'),
  'A8 the write helper reads the derive helper and the median helper and carries neither derivation itself (D137)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%row_number() OVER (ORDER BY k.keys DESC, k.team_id)%'),
  1, 'A9 the §7.3.7 chain lives in exactly ONE prosrc on the chain');
select ok(
  (select p.prosrc like '%public.league_standings_internal(p_league_id, FALSE)%' and p.prosrc like '%is_league_member%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'league_standings')
  and (select p.prosrc like '%public.league_standings_internal(p_league_id, TRUE)%' and p.prosrc like '%is_league_member%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'league_standings_projected'),
  'A9b …and the two wrappers are the member door over it (default arm FALSE, projected arm TRUE)');
select ok(
  (select p.prosrc like '%v_finalized := v_finalized + v_lg_finalized;%' and p.prosrc like '%v_lg_report := ''[]''::jsonb;%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'finalize_matchups'),
  'A10 F244''s locals + merge survive in the replaced finalize (not regressed)');
select has_column('leagues', 'champion_team_id', 'A11 leagues.champion_team_id (rider (iv) — a typed column)');
select col_type_is('matchups', 'home_seed', 'smallint', 'A12 matchups.home_seed SMALLINT (rider (iii))');
select col_type_is('matchups', 'away_seed', 'smallint', 'A12b matchups.away_seed SMALLINT');
select throws_ok(
  $$ insert into matchups (league_id, season, week, round_type, home_team_id, home_seed) values ('00000000-0000-4000-8000-000000000000', 2026, 3, 'regular', '00000000-0000-4000-8000-000000000001', 1) $$,
  '23514', null, 'A13 a seed on a regular row is refused by the CHECK (seeds live on bracket rows only)');

-- ---------------------------------------------------------------------------
-- B. The pure goldens — rider (i) / (ii), the median helper
-- ---------------------------------------------------------------------------
create or replace function pg_temp.pb_pairs(p jsonb) returns text language sql as $$
  select string_agg((g -> 'home' ->> 'seed') || ':' || right(g -> 'home' ->> 'team_id', 2) || 'v' ||
                    coalesce((g -> 'away' ->> 'seed') || ':' || right(g -> 'away' ->> 'team_id', 2), 'bye'),
                    ',' order by (g -> 'home' ->> 'seed')::int)
  from jsonb_array_elements(p) g
$$;
create or replace function pg_temp.pb_entrants(n int) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('team_id', '00000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'), 'seed', i, 'line', i) order by i)
  from generate_series(1, n) i
$$;
select is((select string_agg(public.playoff_bracket_size_internal(n)::text, ',' order by n) from unnest(array[0, 2, 4, 6, 8, 10, 12]) n),
  '0,2,4,8,8,16,16', 'B1 bracket size per playoff_teams: 2^⌈log2 pt⌉, 0 under 2 (110''s rounds)');
select is(pg_temp.pb_pairs(public.playoff_round_pairs_internal(pg_temp.pb_entrants(2), 2, 'seed')), '1:01v2:02', 'B2 2 → 1v2');
select is(pg_temp.pb_pairs(public.playoff_round_pairs_internal(pg_temp.pb_entrants(4), 4, 'seed')), '1:01v4:04,2:02v3:03', 'B2b 4 → 1v4, 2v3');
select is(pg_temp.pb_pairs(public.playoff_round_pairs_internal(pg_temp.pb_entrants(6), 8, 'seed')), '1:01vbye,2:02vbye,3:03v6:06,4:04v5:05', 'B2c 6 → 1–2 bye, 3v6, 4v5');
select is(pg_temp.pb_pairs(public.playoff_round_pairs_internal(pg_temp.pb_entrants(8), 8, 'seed')), '1:01v8:08,2:02v7:07,3:03v6:06,4:04v5:05', 'B2d 8 → 1v8, 2v7, 3v6, 4v5');
select is(pg_temp.pb_pairs(public.playoff_round_pairs_internal(pg_temp.pb_entrants(10), 16, 'seed')), '1:01vbye,2:02vbye,3:03vbye,4:04vbye,5:05vbye,6:06vbye,7:07v10:10,8:08v9:09', 'B2e 10 → 1–6 bye, 7v10, 8v9');
select is(pg_temp.pb_pairs(public.playoff_round_pairs_internal(pg_temp.pb_entrants(12), 16, 'seed')), '1:01vbye,2:02vbye,3:03vbye,4:04vbye,5:05v12:12,6:06v11:11,7:07v10:10,8:08v9:09', 'B2f 12 → 1–4 bye, 5v12, 6v11, 7v10, 8v9');
-- Rider (ii): the 6-team survivors after 5 beat 4 and 6 beat 3 — seeds 1, 2,
-- 5 (line 4), 6 (line 3). Reseed pairs by seed: 1v6, 2v5. Fixed pairs by
-- line: 1v(line 4 = seed 5), 2v(line 3 = seed 6).
select is(pg_temp.pb_pairs(public.playoff_round_pairs_internal(
  '[{"team_id": "00000000-0000-4000-8000-000000000001", "seed": 1, "line": 1}, {"team_id": "00000000-0000-4000-8000-000000000002", "seed": 2, "line": 2},
    {"team_id": "00000000-0000-4000-8000-000000000005", "seed": 5, "line": 4}, {"team_id": "00000000-0000-4000-8000-000000000006", "seed": 6, "line": 3}]'::jsonb, 4, 'seed')),
  '1:01v6:06,2:02v5:05', 'B3 reseed ON: survivors re-ranked by ORIGINAL seed — 1v6, 2v5 (the 4v5 winner meets seed 2)');
select is(pg_temp.pb_pairs(public.playoff_round_pairs_internal(
  '[{"team_id": "00000000-0000-4000-8000-000000000001", "seed": 1, "line": 1}, {"team_id": "00000000-0000-4000-8000-000000000002", "seed": 2, "line": 2},
    {"team_id": "00000000-0000-4000-8000-000000000005", "seed": 5, "line": 4}, {"team_id": "00000000-0000-4000-8000-000000000006", "seed": 6, "line": 3}]'::jsonb, 4, 'line')),
  '1:01v5:05,2:02v6:06', 'B3b reseed OFF (fixed bracket): lines pair outside-in — 1v5, 2v6 (the 4v5 winner meets seed 1)');
select throws_ok($$ select public.playoff_round_pairs_internal(pg_temp.pb_entrants(6), 4, 'seed') $$, 'P0001', null,
  'B4 a bracket smaller than its entrants refuses by name');
select throws_ok($$ select public.playoff_round_pairs_internal(pg_temp.pb_entrants(3), 8, 'seed') $$, 'P0001', null,
  'B4b byes that outnumber the games refuse by name (3 entrants in an 8-bracket)');
select throws_ok($$ select public.playoff_round_pairs_internal(pg_temp.pb_entrants(6), 8, 'rank') $$, '22023', null,
  'B4c an unknown key refuses (22023)');
select is(public.playoff_round_pairs_internal('[]'::jsonb, 8, 'seed'), '[]'::jsonb, 'B4d no entrants ⇒ no pairs');
select is(public.week_median_internal(array[95.01, 95.02]::numeric[]), 95.015, 'B5 the median helper: the EXACT average of the two middle values (R789''s pair)');
select is(public.week_median_internal(array[1, 2, 3]::numeric[]), 2::numeric, 'B5b …the middle value when odd');
select is(public.week_median_internal(array[7]::numeric[]), null::numeric, 'B5c …NULL under two');

-- ---------------------------------------------------------------------------
-- C. F242 — the no-later-row branch of 116:341 (2026 week 18 has no week 19)
-- ---------------------------------------------------------------------------
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('pb-w18-f', 2026, 18, 'BUF', 'KC',  (select starts_at + interval '4 days' from nfl_weeks where season = 2026 and week = 18), 'final'),
 ('pb-w18-p', 2026, 18, 'MIA', 'NYJ', (select starts_at + interval '5 days' from nfl_weeks where season = 2026 and week = 18), 'postponed');
select is((select count(*)::int from nfl_weeks where season = 2026 and week > 18), 0, 'C0 the fixture premise: week 18 has NO later calendar row');
select is((select open_games || ':' || postponed_games || ':' || all_final::text from public.week_games_state_internal(2026, 18)), '1:0:false',
  'C1 F242: with no later calendar row nothing can leave the week — the in-week postponed game is OPEN (open 1, postponed 0, all_final false); deleting the `next_starts_at IS NOT NULL` clause reads 0:0:true');
delete from nfl_games where season = 2026;

-- ---------------------------------------------------------------------------
-- D. Fixtures (postgres context)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('98000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-pb' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'pb_user' || i)::jsonb, now(), now()
from generate_series(1, 2) i;

update nfl_weeks set first_kickoff_at = null, last_game_ends_at = null where season = 2026;
update nfl_weeks set last_game_ends_at = starts_at + interval '6 days' where season = 2026 and week in (1, 2);
update nfl_weeks set starts_at = '2026-09-23 04:00:00+00', last_game_ends_at = '2026-09-29 04:00:00+00', correction_window_ends_at = '2026-10-01 10:00:00+00' where season = 2026 and week = 3;
update nfl_weeks set starts_at = '2026-09-30 04:00:00+00', last_game_ends_at = '2026-10-06 04:00:00+00', correction_window_ends_at = '2026-10-08 10:00:00+00' where season = 2026 and week = 4;
update nfl_weeks set starts_at = '2026-10-07 04:00:00+00', last_game_ends_at = '2026-10-13 04:00:00+00', correction_window_ends_at = '2026-10-15 10:00:00+00' where season = 2026 and week = 5;
update nfl_weeks set starts_at = '2026-10-14 04:00:00+00', last_game_ends_at = '2026-10-20 04:00:00+00', correction_window_ends_at = '2026-10-22 10:00:00+00' where season = 2026 and week = 6;
update nfl_weeks set starts_at = '2026-10-21 04:00:00+00', last_game_ends_at = '2026-10-27 04:00:00+00', correction_window_ends_at = '2026-10-29 10:00:00+00' where season = 2026 and week = 7;
update nfl_weeks set starts_at = '2026-10-28 04:00:00+00', last_game_ends_at = '2026-11-03 04:00:00+00', correction_window_ends_at = '2026-11-05 10:00:00+00' where season = 2026 and week = 8;
update nfl_weeks set starts_at = '2026-11-04 04:00:00+00', last_game_ends_at = '2026-11-10 04:00:00+00', correction_window_ends_at = '2026-11-12 10:00:00+00' where season = 2026 and week = 9;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status)
select 'pb-w' || w, 2026, w, 'BUF', 'KC', (select starts_at + interval '2 days' from nfl_weeks where season = 2026 and week = w), 'final'
from generate_series(3, 9) w;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings) values
 ('b8000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000001', 'pgtap-pb-P1', 2026, 'in_season', 8, 4, 6, 5,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff',
  '{"schedule_mode": "h2h", "median_game": false, "second_opponent": false, "schedule_seed": 118118, "playoff_weeks_per_round": 1, "playoff_reseed": true}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'),
 ('b8000000-0000-4000-8000-000000000002', '98000000-0000-4000-8000-000000000001', 'pgtap-pb-P2', 2026, 'in_season', 8, 4, 0, 5,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff',
  '{"schedule_mode": "h2h", "median_game": false, "second_opponent": false, "schedule_seed": 2}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'),
 ('b8000000-0000-4000-8000-000000000003', '98000000-0000-4000-8000-000000000001', 'pgtap-pb-P3', 2026, 'in_season', 8, 4, 0, 5,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff',
  '{"schedule_mode": "total_points", "median_game": false, "second_opponent": false, "schedule_seed": 3}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'),
 ('b8000000-0000-4000-8000-000000000005', '98000000-0000-4000-8000-000000000001', 'pgtap-pb-P5', 2026, 'in_season', 8, 4, 2, 5,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff',
  '{"schedule_mode": "h2h", "median_game": true, "second_opponent": false, "schedule_seed": 5, "playoff_weeks_per_round": 2, "playoff_reseed": true}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}');

insert into teams (id, owner_id, name, league_id)
select ('c8000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid, '98000000-0000-4000-8000-000000000001', 'PB ' || chr(64 + i), 'b8000000-0000-4000-8000-000000000001'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c8000000-0000-4000-8000-0000000000' || (20 + i)::text)::uuid, '98000000-0000-4000-8000-000000000001', 'PB ' || chr(86 + i), 'b8000000-0000-4000-8000-000000000002'
from generate_series(1, 4) i;
insert into teams (id, owner_id, name, league_id)
select ('c8000000-0000-4000-8000-0000000000' || (30 + i)::text)::uuid, '98000000-0000-4000-8000-000000000001', 'PB ' || chr(74 + i), 'b8000000-0000-4000-8000-000000000003'
from generate_series(1, 4) i;
insert into teams (id, owner_id, name, league_id) values
 ('c8000000-0000-4000-8000-000000000051', '98000000-0000-4000-8000-000000000001', 'PB P', 'b8000000-0000-4000-8000-000000000005'),
 ('c8000000-0000-4000-8000-000000000052', '98000000-0000-4000-8000-000000000001', 'PB R', 'b8000000-0000-4000-8000-000000000005'),
 ('c8000000-0000-4000-8000-000000000053', '98000000-0000-4000-8000-000000000001', 'PB Q', 'b8000000-0000-4000-8000-000000000005'),
 ('c8000000-0000-4000-8000-000000000054', '98000000-0000-4000-8000-000000000001', 'PB S', 'b8000000-0000-4000-8000-000000000005');
-- H is RETIRED (rider (v)): its rows stand for history, it is never seeded.
update teams set status = 'retired' where id = 'c8000000-0000-4000-8000-000000000008';

insert into league_members (league_id, user_id, team_id, role) values
 ('b8000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001', 'commissioner'),
 ('b8000000-0000-4000-8000-000000000003', '98000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000031', 'commissioner');

insert into league_weeks (league_id, season, week) select 'b8000000-0000-4000-8000-000000000001', 2026, g from generate_series(3, 9) g;
insert into league_weeks (league_id, season, week) select 'b8000000-0000-4000-8000-000000000002', 2026, g from generate_series(3, 6) g;
insert into league_weeks (league_id, season, week) select 'b8000000-0000-4000-8000-000000000003', 2026, g from generate_series(3, 6) g;
insert into league_weeks (league_id, season, week) select 'b8000000-0000-4000-8000-000000000005', 2026, g from generate_series(3, 8) g;
-- Weeks 3–5 closed by hand along the F4 chain; week 6 opens through the job.
update league_weeks set status = 'live'              where league_id::text like 'b8000000-0000-4000-8000-00000000000%' and week between 3 and 5;
update league_weeks set status = 'correction_window' where league_id::text like 'b8000000-0000-4000-8000-00000000000%' and week between 3 and 5;

-- P1 (A=01 … H=08).
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status) values
 ('d8000000-0000-4000-8000-000000000131', 'b8000000-0000-4000-8000-000000000001', 2026, 3, 'regular', 'c8000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000002', 100.00,  90.00, 'live'),
 ('d8000000-0000-4000-8000-000000000132', 'b8000000-0000-4000-8000-000000000001', 2026, 3, 'regular', 'c8000000-0000-4000-8000-000000000003', 'c8000000-0000-4000-8000-000000000004', 100.00,  80.00, 'live'),
 ('d8000000-0000-4000-8000-000000000133', 'b8000000-0000-4000-8000-000000000001', 2026, 3, 'regular', 'c8000000-0000-4000-8000-000000000005', 'c8000000-0000-4000-8000-000000000006',  95.00,  85.00, 'live'),
 ('d8000000-0000-4000-8000-000000000134', 'b8000000-0000-4000-8000-000000000001', 2026, 3, 'regular', 'c8000000-0000-4000-8000-000000000007', 'c8000000-0000-4000-8000-000000000008',  70.00, 110.00, 'live'),
 ('d8000000-0000-4000-8000-000000000141', 'b8000000-0000-4000-8000-000000000001', 2026, 4, 'regular', 'c8000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000003', 100.00,  90.00, 'live'),
 ('d8000000-0000-4000-8000-000000000142', 'b8000000-0000-4000-8000-000000000001', 2026, 4, 'regular', 'c8000000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000004', 100.00,  70.00, 'live'),
 ('d8000000-0000-4000-8000-000000000143', 'b8000000-0000-4000-8000-000000000001', 2026, 4, 'regular', 'c8000000-0000-4000-8000-000000000005', 'c8000000-0000-4000-8000-000000000007', 100.00,  80.00, 'live'),
 ('d8000000-0000-4000-8000-000000000144', 'b8000000-0000-4000-8000-000000000001', 2026, 4, 'regular', 'c8000000-0000-4000-8000-000000000006', 'c8000000-0000-4000-8000-000000000008',  90.00, 120.00, 'live'),
 ('d8000000-0000-4000-8000-000000000151', 'b8000000-0000-4000-8000-000000000001', 2026, 5, 'regular', 'c8000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000004', 110.00, 100.00, 'live'),
 ('d8000000-0000-4000-8000-000000000152', 'b8000000-0000-4000-8000-000000000001', 2026, 5, 'regular', 'c8000000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000003',  80.00, 100.00, 'live'),
 ('d8000000-0000-4000-8000-000000000153', 'b8000000-0000-4000-8000-000000000001', 2026, 5, 'regular', 'c8000000-0000-4000-8000-000000000005', 'c8000000-0000-4000-8000-000000000008',  90.00, 130.00, 'live'),
 ('d8000000-0000-4000-8000-000000000154', 'b8000000-0000-4000-8000-000000000001', 2026, 5, 'regular', 'c8000000-0000-4000-8000-000000000006', 'c8000000-0000-4000-8000-000000000007', 100.00,  95.00, 'live'),
 ('d8000000-0000-4000-8000-000000000161', 'b8000000-0000-4000-8000-000000000001', 2026, 6, 'regular', 'c8000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000005', 100.00,  90.00, 'scheduled'),
 ('d8000000-0000-4000-8000-000000000162', 'b8000000-0000-4000-8000-000000000001', 2026, 6, 'regular', 'c8000000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000006', 100.00,  70.00, 'scheduled'),
 ('d8000000-0000-4000-8000-000000000163', 'b8000000-0000-4000-8000-000000000001', 2026, 6, 'regular', 'c8000000-0000-4000-8000-000000000003', 'c8000000-0000-4000-8000-000000000007',  90.00,  95.00, 'scheduled'),
 ('d8000000-0000-4000-8000-000000000164', 'b8000000-0000-4000-8000-000000000001', 2026, 6, 'regular', 'c8000000-0000-4000-8000-000000000004', 'c8000000-0000-4000-8000-000000000008', 100.00, 105.00, 'scheduled');
-- P2 (W=21, X=22, Y=23, Z=24).
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status) values
 ('d8000000-0000-4000-8000-000000000231', 'b8000000-0000-4000-8000-000000000002', 2026, 3, 'regular', 'c8000000-0000-4000-8000-000000000021', 'c8000000-0000-4000-8000-000000000022',  80.00,  70.00, 'live'),
 ('d8000000-0000-4000-8000-000000000232', 'b8000000-0000-4000-8000-000000000002', 2026, 3, 'regular', 'c8000000-0000-4000-8000-000000000023', 'c8000000-0000-4000-8000-000000000024',  60.00,  50.00, 'live'),
 ('d8000000-0000-4000-8000-000000000241', 'b8000000-0000-4000-8000-000000000002', 2026, 4, 'regular', 'c8000000-0000-4000-8000-000000000021', 'c8000000-0000-4000-8000-000000000023',  80.00,  60.00, 'live'),
 ('d8000000-0000-4000-8000-000000000242', 'b8000000-0000-4000-8000-000000000002', 2026, 4, 'regular', 'c8000000-0000-4000-8000-000000000022', 'c8000000-0000-4000-8000-000000000024', 120.00,  50.00, 'live'),
 ('d8000000-0000-4000-8000-000000000251', 'b8000000-0000-4000-8000-000000000002', 2026, 5, 'regular', 'c8000000-0000-4000-8000-000000000021', 'c8000000-0000-4000-8000-000000000024',  80.00,  50.00, 'live'),
 ('d8000000-0000-4000-8000-000000000252', 'b8000000-0000-4000-8000-000000000002', 2026, 5, 'regular', 'c8000000-0000-4000-8000-000000000022', 'c8000000-0000-4000-8000-000000000023', 120.00, 130.00, 'live'),
 ('d8000000-0000-4000-8000-000000000261', 'b8000000-0000-4000-8000-000000000002', 2026, 6, 'regular', 'c8000000-0000-4000-8000-000000000021', 'c8000000-0000-4000-8000-000000000022',  60.00,  90.00, 'scheduled'),
 ('d8000000-0000-4000-8000-000000000262', 'b8000000-0000-4000-8000-000000000002', 2026, 6, 'regular', 'c8000000-0000-4000-8000-000000000023', 'c8000000-0000-4000-8000-000000000024',  40.00,  50.00, 'scheduled');
-- P3 (K=31 … N=34): the worker's provisional rows, weeks 3–6.
insert into team_week_results (league_id, team_id, season, week, points, is_final)
select 'b8000000-0000-4000-8000-000000000003', ('c8000000-0000-4000-8000-0000000000' || (30 + t)::text)::uuid, 2026, w, 110 - 10 * t, false
from generate_series(1, 4) t, generate_series(3, 6) w;
-- P5 (P=51, R=52, Q=53, S=54).
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status) values
 ('d8000000-0000-4000-8000-000000000531', 'b8000000-0000-4000-8000-000000000005', 2026, 3, 'regular', 'c8000000-0000-4000-8000-000000000051', 'c8000000-0000-4000-8000-000000000053', 100.00,  80.00, 'live'),
 ('d8000000-0000-4000-8000-000000000532', 'b8000000-0000-4000-8000-000000000005', 2026, 3, 'regular', 'c8000000-0000-4000-8000-000000000052', 'c8000000-0000-4000-8000-000000000054',  90.00,  85.00, 'live'),
 ('d8000000-0000-4000-8000-000000000541', 'b8000000-0000-4000-8000-000000000005', 2026, 4, 'regular', 'c8000000-0000-4000-8000-000000000051', 'c8000000-0000-4000-8000-000000000052', 100.00,  80.00, 'live'),
 ('d8000000-0000-4000-8000-000000000542', 'b8000000-0000-4000-8000-000000000005', 2026, 4, 'regular', 'c8000000-0000-4000-8000-000000000053', 'c8000000-0000-4000-8000-000000000054',  90.00,  70.00, 'live'),
 ('d8000000-0000-4000-8000-000000000551', 'b8000000-0000-4000-8000-000000000005', 2026, 5, 'regular', 'c8000000-0000-4000-8000-000000000051', 'c8000000-0000-4000-8000-000000000054', 100.00,  70.00, 'live'),
 ('d8000000-0000-4000-8000-000000000552', 'b8000000-0000-4000-8000-000000000005', 2026, 5, 'regular', 'c8000000-0000-4000-8000-000000000053', 'c8000000-0000-4000-8000-000000000052',  90.00,  80.00, 'live'),
 ('d8000000-0000-4000-8000-000000000561', 'b8000000-0000-4000-8000-000000000005', 2026, 6, 'regular', 'c8000000-0000-4000-8000-000000000051', 'c8000000-0000-4000-8000-000000000053', 100.00,  80.00, 'scheduled'),
 ('d8000000-0000-4000-8000-000000000562', 'b8000000-0000-4000-8000-000000000005', 2026, 6, 'regular', 'c8000000-0000-4000-8000-000000000052', 'c8000000-0000-4000-8000-000000000054',  90.00,  85.00, 'scheduled');

-- Renderers.
create or replace function pg_temp.pb_order(p_league uuid, p_projected boolean) returns text language sql as $$
  select string_agg(right(x ->> 'team_id', 2), ',' order by (x ->> 'rank')::int)
  from jsonb_array_elements(public.league_standings_internal(p_league, p_projected) -> 'standings') x
$$;
create or replace function pg_temp.pb_rec(p_league uuid, p_projected boolean) returns text language sql as $$
  select string_agg(right(x ->> 'team_id', 2) || ':' || (x ->> 'wins') || '-' || (x ->> 'losses') || '-' || (x ->> 'ties') || ':' || (x ->> 'points_for'), ',' order by (x ->> 'rank')::int)
  from jsonb_array_elements(public.league_standings_internal(p_league, p_projected) -> 'standings') x
$$;
-- A stored round, rendered as the sync renders it (seed:team v seed:team | bye).
create or replace function pg_temp.pb_round(p_league uuid, p_first int, p_last int) returns text language sql as $$
  select string_agg(g, ',' order by seed)
  from (select distinct m.home_seed as seed,
               m.home_seed || ':' || right(m.home_team_id::text, 2) || 'v' ||
               coalesce(m.away_seed || ':' || right(m.away_team_id::text, 2), 'bye') as g
        from matchups m
        where m.league_id = p_league and m.season = 2026 and m.week between p_first and p_last and m.round_type = 'playoff') r
$$;
create or replace function pg_temp.pb_digest(p_league uuid, p_first int, p_last int) returns text language sql as $$
  select md5(coalesce(string_agg(m.week || '|' || m.home_team_id || '|' || coalesce(m.away_team_id::text, '') || '|' || m.home_seed || '|' || coalesce(m.away_seed::text, '') || '|' || m.status || '|' || coalesce(m.result, ''), ';' order by m.week, m.home_seed), ''))
  from matchups m where m.league_id = p_league and m.season = 2026 and m.week between p_first and p_last and m.round_type = 'playoff'
$$;
create or replace function pg_temp.pb_brackets(p_league uuid) returns jsonb language sql as $$
  select coalesce((select x from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'brackets') x where x ->> 'league_id' = p_league::text limit 1), '{}'::jsonb)
$$;

-- ---------------------------------------------------------------------------
-- E. Weeks 3–5 final; the projected standings (F253(a))
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.finalize_matchups('2026-10-15 10:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'finalized')::int, 12, 'E1 weeks 3–5 finalize for the four leagues (12 league-weeks) through the replaced body');
select is(current_setting('pgtap.r')::jsonb -> 'brackets', '[]'::jsonb, 'E1b …no bracket action yet (every regular season still has week 6 ahead)');
select is(current_setting('pgtap.r')::jsonb -> 'bracket_failures', '[]'::jsonb, 'E1c …and no bracket failure');
select is(pg_temp.pb_order('b8000000-0000-4000-8000-000000000001', false), '01,03,05,06,02,04,07',
  'E2 P1 FINAL standings through W5: A,C,E,F,B,D,G — H (retired) absent (rider (v))');
select is(pg_temp.pb_order('b8000000-0000-4000-8000-000000000001', true), '01,03,05,06,02,04,07',
  'E2b P1 PROJECTED with week 6 still `upcoming`: identical — an unplayed week NEVER counts');
select is((public.league_standings_internal('b8000000-0000-4000-8000-000000000001', true) ->> 'weeks_final') || ':' || (public.league_standings_internal('b8000000-0000-4000-8000-000000000001', true) ->> 'weeks_projected') || ':' || (public.league_standings_internal('b8000000-0000-4000-8000-000000000001', true) ->> 'projected'),
  '3:0:true', 'E2c …weeks_final 3, weeks_projected 0, projected true');
select is(public.league_standings('b8000000-0000-4000-8000-000000000001') - 'standings', public.league_standings_internal('b8000000-0000-4000-8000-000000000001', false) - 'standings',
  'E2d the default wrapper IS the internal default arm (payload identical)');
select is((public.league_standings('b8000000-0000-4000-8000-000000000001') ->> 'projected') || ':' || (public.league_standings('b8000000-0000-4000-8000-000000000001') ->> 'weeks_projected'), 'false:0',
  'E2e …and says projected false / 0 weeks');

-- Week 6 opens through the job (starts_at, Wednesday — 110/116's boundary, untouched).
select set_config('pgtap.r', public.league_week_advance('2026-10-14 04:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'opened')::int, 4, 'E3 week 6 opens for the four leagues at its starts_at');
select is(current_setting('pgtap.r')::jsonb -> 'brackets', '[]'::jsonb, 'E3b …and NO bracket is built at the OPEN (Q39 (E): the rollover, never Wednesday''s starts_at)');
select is((select status from league_weeks where league_id = 'b8000000-0000-4000-8000-000000000001' and week = 6), 'live', 'E3c …P1 week 6 is live');
select is(pg_temp.pb_order('b8000000-0000-4000-8000-000000000001', true), '01,03,05,02,06,07,04',
  'E4 P1 PROJECTED with week 6 LIVE (C 90 / G 95 as written): A,C,E,B,F,G,D — the live week moved B above F and G above D');
select is(pg_temp.pb_order('b8000000-0000-4000-8000-000000000001', false), '01,03,05,06,02,04,07',
  'E4b …while the FINAL table is unchanged (byte-identical default arm)');
select is((public.league_standings_internal('b8000000-0000-4000-8000-000000000001', true) ->> 'weeks_final') || ':' || (public.league_standings_internal('b8000000-0000-4000-8000-000000000001', true) ->> 'weeks_projected'), '3:1',
  'E4c …weeks_final 3, weeks_projected 1');
update matchups set away_score = null where id = 'd8000000-0000-4000-8000-000000000161';
select is(pg_temp.pb_order('b8000000-0000-4000-8000-000000000001', true), '01,03,02,05,06,07,04',
  'E4d a NULL score in a projected week is 0.00 SO FAR (E has 285 PF ⇒ B passes him): A,C,B,E,F,G,D');
select is((select x ->> 'points_for' from jsonb_array_elements(public.league_standings_internal('b8000000-0000-4000-8000-000000000001', true) -> 'standings') x where x ->> 'team_id' = 'c8000000-0000-4000-8000-000000000005'), '285.00',
  'E4e …E''s projected PF counts the week at 0');
update matchups set away_score = 90.00 where id = 'd8000000-0000-4000-8000-000000000161';
select is(pg_temp.pb_order('b8000000-0000-4000-8000-000000000003', true) || '|' || (public.league_standings_internal('b8000000-0000-4000-8000-000000000003', true) ->> 'weeks_projected') || '|' || (public.league_standings_internal('b8000000-0000-4000-8000-000000000003', false) ->> 'weeks_final'),
  '31,32,33,34|1|3', 'E5 P3 (total_points): the projection reads the worker''s provisional week-6 rows (weeks_projected 1; final 3)');
select is(pg_temp.pb_rec('b8000000-0000-4000-8000-000000000005', true), '51:8-0-0:400.00,53:4-4-0:340.00,52:4-4-0:340.00,54:0-8-0:310.00',
  'E6 P5 PROJECTED (median on): the re-derived median counts — P 8-0, Q 4-4 (H2H over R), R 4-4, S 0-8');
-- The doors.
select set_config('request.jwt.claims', '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is((public.league_standings_projected('b8000000-0000-4000-8000-000000000001') ->> 'projected') || ':' || (public.league_standings_projected('b8000000-0000-4000-8000-000000000001') ->> 'weeks_projected'), 'true:1',
  'E7 a member reads the projected arm through its wrapper');
select set_config('request.jwt.claims', '{"sub": "98000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok($$ select public.league_standings_projected('b8000000-0000-4000-8000-000000000001') $$, '42501', null,
  'E7b a non-member is refused by name (never an empty table)');
select throws_ok($$ select public.league_playoff_bracket('b8000000-0000-4000-8000-000000000001') $$, '42501', null,
  'E7c …and so is the bracket read');
select set_config('request.jwt.claims', '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

-- ---------------------------------------------------------------------------
-- F. The season-long PROJECTED bracket (the read, while in_season)
-- ---------------------------------------------------------------------------
select set_config('pgtap.b', public.league_playoff_bracket('b8000000-0000-4000-8000-000000000001')::text, true);
select is((current_setting('pgtap.b')::jsonb ->> 'kind') || ':' || (current_setting('pgtap.b')::jsonb ->> 'view') || ':' || (current_setting('pgtap.b')::jsonb ->> 'status'), 'bracket:projected:in_season',
  'F1 P1 in_season: the bracket read is the PROJECTION — "if the playoffs started today"');
select is(pg_temp.pb_pairs(current_setting('pgtap.b')::jsonb -> 'projected_round_1'), '1:01vbye,2:03vbye,3:05v6:07,4:02v5:06',
  'F1b …seeded from the PROJECTED table (week 6 live): A, C bye; E v G; B v F');
select is((current_setting('pgtap.b')::jsonb -> 'projection_basis' ->> 'weeks_final') || ':' || (current_setting('pgtap.b')::jsonb -> 'projection_basis' ->> 'weeks_projected') || ':' || (current_setting('pgtap.b')::jsonb -> 'projection_basis' ->> 'seeded'), '3:1:6',
  'F1c …the basis says so (3 final, 1 projected, 6 seeded)');
select is((current_setting('pgtap.b')::jsonb ->> 'rollover_week') || '|' || (current_setting('pgtap.b')::jsonb ->> 'rollover_at')::timestamptz::text || '|' || (current_setting('pgtap.b')::jsonb ->> 'corrections_close_at')::timestamptz::text,
  '6|' || '2026-10-20 04:00:00+00'::timestamptz::text || '|' || '2026-10-22 10:00:00+00'::timestamptz::text,
  'F1d …and names the ONE absolute instant the real bracket materialises — week 6''s last_game_ends_at — and its correction close (a timestamptz; the UI renders it in the viewer''s zone, never "midnight")');
select is((current_setting('pgtap.b')::jsonb ->> 'bracket_size') || ':' || (current_setting('pgtap.b')::jsonb ->> 'rounds') || ':' || (current_setting('pgtap.b')::jsonb ->> 'next_round') || ':' || (current_setting('pgtap.b')::jsonb ->> 'playoff_start_week'), '8:3:1:7',
  'F1e …bracket 8, three rounds, next round 1, playoff start NFL week 7');
select is((select jsonb_array_length(current_setting('pgtap.b')::jsonb -> 'round_list' -> 0 -> 'games')), 0, 'F1f …no round is built');
select is((public.league_playoff_bracket('b8000000-0000-4000-8000-000000000003') ->> 'kind') || ':' || (public.league_playoff_bracket('b8000000-0000-4000-8000-000000000003') ->> 'view'), 'points_race:points_race',
  'F2 P3 (total_points): kind points_race — no bracket, ever ((C))');
select is(public.playoff_bracket_state_internal('b8000000-0000-4000-8000-000000000002') ->> 'kind', 'no_playoffs', 'F2b P2 (playoff_teams 0): kind no_playoffs ((D))');
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- G. THE ROLLOVER (Q39 (E)) — week 6 closes at last_game_ends_at: the
--    provisional round 1 from the PROJECTED table; the foreign-row skip
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.league_week_advance('2026-10-20 03:59:59+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'closed')::int || ':' || jsonb_array_length(current_setting('pgtap.r')::jsonb -> 'brackets')::text, '0:0',
  'G1 the rollover −1s (D146): nothing closes, nothing is built');
select is((select status from leagues where id = 'b8000000-0000-4000-8000-000000000001'), 'in_season', 'G1b …P1 stays in_season');
-- A playoff row the engine did not write (no seed) — the 064/065 fixture
-- shape, and any hand-written row: named, never touched, the round left alone.
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, status)
values ('d8000000-0000-4000-8000-000000000171', 'b8000000-0000-4000-8000-000000000001', 2026, 7, 'playoff', 'c8000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000002', 'scheduled');
select set_config('pgtap.r', public.league_week_advance('2026-10-20 04:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'closed')::int, 4, 'G2 the rollover AT: week 6 closes for the four leagues');
select is(pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001'), '{}'::jsonb, 'G2b P1: NO bracket action — the foreign row blocks the round by name');
select is(public.playoff_bracket_sync_internal('b8000000-0000-4000-8000-000000000001', '2026-10-20 04:00:00+00') - 'weeks',
  '{"reason": "bracket_foreign_rows", "round": 1, "rows": 1}'::jsonb, 'G2c …the sync says bracket_foreign_rows (round 1, 1 row) and writes nothing');
select is((select status from leagues where id = 'b8000000-0000-4000-8000-000000000001') || ':' || (select count(*)::int from matchups where league_id = 'b8000000-0000-4000-8000-000000000001' and week = 7)::text, 'in_season:1',
  'G2d …P1 stays in_season with the one foreign row only');
select is(current_setting('pgtap.r')::jsonb -> 'bracket_failures', '[]'::jsonb, 'G2e …a named skip is not a failure');
-- P5 (no foreign row) built at the same instant — the DoD tie fixture.
select is((pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000005') ->> 'action') || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000005') ->> 'round') || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000005') ->> 'source') || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000005') ->> 'status_flipped'),
  'built:1:provisional:true', 'G3 P5: round 1 BUILT at the rollover, source provisional (week 6 in its correction window), status flipped');
select is(pg_temp.pb_round('b8000000-0000-4000-8000-000000000005', 7, 8), '1:51v2:53',
  'G3b THE DoD TIE FIXTURE: P v Q — Q and R tie on the combined record AND PF, PA would put R first; head-to-head (Q beat R, W5) seeds Q. Raw Win % (team-id order) seeds R and reds this cell');
select is((select count(*)::int || ':' || string_agg(week::text || status, ',' order by week) from matchups where league_id = 'b8000000-0000-4000-8000-000000000005' and round_type = 'playoff'), '2:7scheduled,8scheduled',
  'G3c …one row per week of the two-week final, `scheduled` into upcoming weeks');
select is((select status from leagues where id = 'b8000000-0000-4000-8000-000000000005'), 'playoffs', 'G3d …P5 in_season → playoffs in the same transaction (rider (vi))');
select is((pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000005') ->> 'rollover_at')::timestamptz, '2026-10-20 04:00:00+00'::timestamptz,
  'G3e …the payload carries the rollover instant the round was built on');
select is((pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000002') || pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000003')), '{}'::jsonb,
  'G3f P2 / P3: nothing at the rollover — the champion waits for the FINAL ((D))');
select is(public.playoff_bracket_sync_internal('b8000000-0000-4000-8000-000000000002', '2026-10-20 04:00:00+00') - 'open_weeks',
  '{"kind": "no_playoffs", "reason": "waiting_regular_season"}'::jsonb, 'G3g …P2 says so by name');
select is(current_setting('pgtap.r')::jsonb ->> 'reason', null, 'G3h …the advance payload''s reason is NULL (something happened)');
-- The foreign row removed: the very next run builds P1 (the retry).
delete from matchups where id = 'd8000000-0000-4000-8000-000000000171';
select set_config('pgtap.r', public.league_week_advance('2026-10-20 04:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'closed')::int || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001') ->> 'action') || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001') ->> 'source'),
  '0:built:provisional', 'G4 the retry: nothing new closes, P1 round 1 is BUILT provisional');
select is(pg_temp.pb_round('b8000000-0000-4000-8000-000000000001', 7, 7), '1:01vbye,2:03vbye,3:05v6:07,4:02v5:06',
  'G4b P1 round 1 from the PROJECTED table (C 90 / G 95): A, C bye; E(3) v G(6); B(4) v F(5) — the higher seed at home (rider (vii))');
select is((select string_agg(coalesce(home_seed::text, '-') || '/' || coalesce(away_seed::text, '-') || ':' || status, ',' order by home_seed) from matchups where league_id = 'b8000000-0000-4000-8000-000000000001' and week = 7),
  '1/-:scheduled,2/-:scheduled,3/6:scheduled,4/5:scheduled', 'G4c …seeds FROZEN on the rows (a bye row carries home_seed alone), `scheduled` into the upcoming week');
select is((select status from leagues where id = 'b8000000-0000-4000-8000-000000000001'), 'playoffs', 'G4d …P1 in_season → playoffs');
select is(current_setting('pgtap.r')::jsonb ->> 'reason', null, 'G4e …reason NULL: a bracket action counts as something happening');
select set_config('pgtap.r', public.league_week_advance('2026-10-20 04:00:00+00')::text, true);
select is(current_setting('pgtap.r')::jsonb -> 'brackets' || (current_setting('pgtap.r')::jsonb -> 'bracket_failures'), '[]'::jsonb, 'G4f idempotent: a third run at the same instant writes nothing');
select is(public.playoff_bracket_sync_internal('b8000000-0000-4000-8000-000000000001', '2026-10-20 04:00:00+00'), '{"round": 1, "reason": "round_in_progress", "source": "provisional"}'::jsonb,
  'G4g …the sync names the round in progress');
-- The bracket read now shows the real thing.
select set_config('request.jwt.claims', '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.b', public.league_playoff_bracket('b8000000-0000-4000-8000-000000000001')::text, true);
select is((current_setting('pgtap.b')::jsonb ->> 'view') || ':' || (current_setting('pgtap.b')::jsonb ->> 'next_round') || ':' || (current_setting('pgtap.b')::jsonb -> 'round_list' -> 0 ->> 'source') || ':' || (current_setting('pgtap.b')::jsonb -> 'round_list' -> 0 ->> 'built'),
  'bracket:2:provisional:true', 'F3 the read flips to the REAL bracket: round 1 built (provisional), next round 2, no projection');
select is(current_setting('pgtap.b')::jsonb -> 'projected_round_1', 'null'::jsonb, 'F3b …projected_round_1 is null once the bracket exists');
select set_config('request.jwt.claims', '', true);

-- Week 7 opens (Wednesday): the round-1 rows go live with the week (116 (a)).
select set_config('pgtap.r', public.league_week_advance('2026-10-21 04:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'opened')::int || ':' || (current_setting('pgtap.r')::jsonb ->> 'matchups_live'), '2:5',
  'G5 week 7 opens for P1 + P5; the 4 + 1 bracket rows flip scheduled → live with the week');

-- ---------------------------------------------------------------------------
-- H. THE CORRECTION CLOSE — a correction in week 6 moves seed 6 (G → D);
--    finalize rebuilds round 1 from the FINAL table; (D) crowns P2 and P3
-- ---------------------------------------------------------------------------
update matchups set home_score = 96.00 where id = 'd8000000-0000-4000-8000-000000000163';   -- C–G: 90 → 96 (C wins)
select set_config('pgtap.d', pg_temp.pb_digest('b8000000-0000-4000-8000-000000000001', 7, 7), true);
select set_config('pgtap.r', public.finalize_matchups('2026-10-22 09:59:59+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'finalized')::int || ':' || jsonb_array_length(current_setting('pgtap.r')::jsonb -> 'brackets')::text, '0:0',
  'H1 the close −1s (D146): nothing finalizes, nothing is rebuilt');
select is(pg_temp.pb_digest('b8000000-0000-4000-8000-000000000001', 7, 7), current_setting('pgtap.d'), 'H1b …round 1 untouched');
select set_config('pgtap.r', public.finalize_matchups('2026-10-22 10:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'finalized')::int, 4, 'H2 the close AT: week 6 finalizes for the four leagues');
select is(pg_temp.pb_order('b8000000-0000-4000-8000-000000000001', false), '01,03,05,02,06,04,07',
  'H2b P1 FINAL standings: A,C,E,B,F,D,G — the correction lifted C to 3-1 and dropped G to 0-4 below D');
select is((pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001') ->> 'action') || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001') ->> 'round') || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001') ->> 'source'),
  'rebuilt:1:final', 'H3 P1 round 1 REBUILT from the FINAL table at the close (Q39 (E))');
select is(pg_temp.pb_round('b8000000-0000-4000-8000-000000000001', 7, 7), '1:01vbye,2:03vbye,3:05v6:04,4:02v5:06',
  'H3b …E(3) v D(6) now — the correction moved seed 6 from G to D; the rest unchanged');
select is(pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001') ->> 'replaced', '1:c8000000-0000-4000-8000-000000000001vbye,2:c8000000-0000-4000-8000-000000000003vbye,3:c8000000-0000-4000-8000-000000000005v6:c8000000-0000-4000-8000-000000000007,4:c8000000-0000-4000-8000-000000000002v5:c8000000-0000-4000-8000-000000000006',
  'H3c …the payload names what it replaced (G at seed 6)');
select is((select count(*)::int || ':' || string_agg(status, ',' order by home_seed) from matchups where league_id = 'b8000000-0000-4000-8000-000000000001' and week = 7 and round_type = 'playoff'), '4:live,live,live,live',
  'H3d …four rows, `live` (the week is open — Thursday 06:00 ET precedes any playoff kickoff)');
select is((select count(*)::int from matchups where league_id = 'b8000000-0000-4000-8000-000000000001' and week = 7 and away_team_id = 'c8000000-0000-4000-8000-000000000007'), 0, 'H3e …G''s provisional row is gone');
select is(pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000005'), '{}'::jsonb, 'H4 P5: no action — its round 1 is what the final table says too (P v Q)');
-- (D): P2 and P3 complete at week 6's final.
select is((pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000002') ->> 'action') || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000002') ->> 'kind') || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000002') ->> 'basis') || ':' || right(pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000002') ->> 'champion_team_id', 2),
  'complete:no_playoffs:standings_rank_1:21', 'H5 (D) P2 (playoff_teams 0): COMPLETE at week 6''s final — champion W, rank 1 through the FULL chain');
select is(pg_temp.pb_rec('b8000000-0000-4000-8000-000000000002', false), '21:3-1-0:300.00,22:2-2-0:400.00,23:2-2-0:290.00,24:1-3-0:200.00',
  'H5b …THE (D) GOLDEN: rank 1 is W (3-1, 300 PF) and NOT the PF leader X (2-2, 400 PF)');
select is((select status || ':' || right(champion_team_id::text, 2) from leagues where id = 'b8000000-0000-4000-8000-000000000002'), 'complete:21', 'H5c …leagues.status complete, champion_team_id = W');
select is((pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000003') ->> 'action') || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000003') ->> 'kind') || ':' || right(pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000003') ->> 'champion_team_id', 2),
  'complete:points_race:31', 'H6 (C)/(D) P3 (total_points): COMPLETE — champion K, the points leader; the bracket path never entered');
select is((select status || ':' || right(champion_team_id::text, 2) from leagues where id = 'b8000000-0000-4000-8000-000000000003'), 'complete:31', 'H6b …P3 complete, champion K');
select is((select count(*)::int from matchups where league_id = 'b8000000-0000-4000-8000-000000000003'), 0, 'H6c …P3 has no matchup row of any kind');
select is(current_setting('pgtap.r')::jsonb -> 'bracket_failures', '[]'::jsonb, 'H7 no bracket failure across the four');
select is(pg_temp.pb_rec('b8000000-0000-4000-8000-000000000005', false), '51:8-0-0:400.00,53:4-4-0:340.00,52:4-4-0:340.00,54:0-8-0:310.00',
  'H8 P5 FINAL ≡ its projection at E6 — the projected median arm derives what finalization writes');
select is((select x ->> 'separated_by' from jsonb_array_elements(public.league_standings('b8000000-0000-4000-8000-000000000005') -> 'standings') x where (x ->> 'rank')::int = 3), 'head_to_head',
  'H8b …R (rank 3) is separated from Q by head_to_head — the tie fixture''s separator (117: `separated_by` names the entry that split a row from the one above)');

-- ---------------------------------------------------------------------------
-- I. Round 1 played: the (A) tie; round 2 at the rollover; the reseed on/off
--    divergence THROUGH the rewrite path; a decided round is history
-- ---------------------------------------------------------------------------
update matchups set home_score = 100.00, away_score = 110.00 where league_id = 'b8000000-0000-4000-8000-000000000001' and week = 7 and home_seed = 3;   -- E 100 / D 110
update matchups set home_score = 100.104, away_score = 100.096 where league_id = 'b8000000-0000-4000-8000-000000000001' and week = 7 and home_seed = 4; -- B v F: a two-decimal tie
update matchups set home_score = 80.00, away_score = 90.00 where league_id = 'b8000000-0000-4000-8000-000000000005' and week = 7;                       -- P 80 / Q 90
select set_config('pgtap.r', public.league_week_advance('2026-10-27 04:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'closed')::int, 2, 'I1 week 7 closes for P1 + P5 at its rollover');
select is((pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001') ->> 'action') || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001') ->> 'round') || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001') ->> 'source') || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001') ->> 'key'),
  'built:2:provisional:seed', 'I2 P1 round 2 BUILT provisional at round 1''s rollover, reseed on (key seed)');
select is(pg_temp.pb_round('b8000000-0000-4000-8000-000000000001', 8, 8), '1:01v6:04,2:03v4:02',
  'I2b (A) + reseed: D (6) beat E; B (4) TIED F at two decimals and advances as the HIGHER SEED — survivors re-ranked by seed: A v D, C v B');
select set_config('pgtap.b', public.playoff_bracket_state_internal('b8000000-0000-4000-8000-000000000001')::text, true);
select is((select string_agg(right(g ->> 'winner_team_id', 2) || ':' || (g ->> 'decided_by') || ':' || (g ->> 'final'), ',' order by (g ->> 'home_seed')::int) from jsonb_array_elements(current_setting('pgtap.b')::jsonb -> 'round_list' -> 0 -> 'games') g),
  '01:bye:false,03:bye:false,04:points:false,02:higher_seed:false', 'I2c …the verdicts: A, C by bye; D by points; B by higher_seed — none final yet');
select is((select string_agg(right(s ->> 'team_id', 2) || ':' || (s ->> 'seed') || ':' || (s ->> 'line'), ',') from jsonb_array_elements(current_setting('pgtap.b')::jsonb -> 'round_list' -> 0 -> 'survivors') s),
  '01:1:1,03:2:2,04:6:3,02:4:4', 'I2d …the survivors carry their ORIGINAL seed and their LINE (D took line 3, B line 4)');
select is((select result from matchups where league_id = 'b8000000-0000-4000-8000-000000000001' and week = 7 and home_seed = 4), null,
  'I2e …the tied row''s `result` is untouched by the bracket (NULL until finalization writes ''tie'')');
select is(pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000005'), '{}'::jsonb, 'I3 P5: the two-week final has one week to go — no action');
select is(public.playoff_bracket_sync_internal('b8000000-0000-4000-8000-000000000005', '2026-10-27 04:00:00+00'), '{"round": 1, "reason": "round_in_progress", "source": "final"}'::jsonb,
  'I3b …said by name');
-- Reseed OFF: the next run REWRITES the open round on the fixed-bracket rule.
update leagues set settings = jsonb_set(settings, '{playoff_reseed}', 'false') where id = 'b8000000-0000-4000-8000-000000000001';
select set_config('pgtap.r', public.league_week_advance('2026-10-27 04:00:00+00')::text, true);
select is((pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001') ->> 'action') || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001') ->> 'key'), 'rebuilt:line',
  'I4 reseed OFF: the open round is REWRITTEN on the fixed-bracket rule (key line)');
select is(pg_temp.pb_round('b8000000-0000-4000-8000-000000000001', 8, 8), '1:01v4:02,2:03v6:04',
  'I4b THE DIVERGENCE (rider (ii)): fixed bracket — the 4v5 winner B meets seed 1 (line 4 v line 1), the 3v6 winner D meets seed 2 — A v B, C v D');
update leagues set settings = jsonb_set(settings, '{playoff_reseed}', 'true') where id = 'b8000000-0000-4000-8000-000000000001';
select set_config('pgtap.r', public.league_week_advance('2026-10-27 04:00:00+00')::text, true);
select is(pg_temp.pb_round('b8000000-0000-4000-8000-000000000001', 8, 8) || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001') ->> 'action'), '1:01v6:04,2:03v4:02:rebuilt',
  'I4c reseed ON again: rewritten back — A v D, C v B (the 4v5 winner meets seed 2)');
-- Week 8 opens; then round 1 finalizes: 'tie' stays on the row (E38); round 2 is untouched.
select set_config('pgtap.r', public.league_week_advance('2026-10-28 04:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'opened')::int || ':' || (current_setting('pgtap.r')::jsonb ->> 'matchups_live'), '2:3', 'I5 week 8 opens for P1 + P5 (2 + 1 bracket rows live)');
select set_config('pgtap.d', pg_temp.pb_digest('b8000000-0000-4000-8000-000000000001', 8, 8), true);
select set_config('pgtap.r', public.finalize_matchups('2026-10-29 10:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'finalized')::int, 2, 'I6 week 7 finalizes for P1 + P5');
select is((select status || ':' || result from matchups where league_id = 'b8000000-0000-4000-8000-000000000001' and week = 7 and home_seed = 4), 'final:tie',
  'I6b (A) E38''s letter holds: the B–F row is final with result ''tie'' — only the ADVANCEMENT read the seed');
select is(pg_temp.pb_digest('b8000000-0000-4000-8000-000000000001', 8, 8), current_setting('pgtap.d'), 'I6c round 2 untouched at the close (its prior verdict did not move)');
select is(pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001'), '{}'::jsonb, 'I6d …no action reported for P1');
select is((select string_agg(right(team_id::text, 2) || ':' || h2h_result, ',' order by team_id) from team_week_results where league_id = 'b8000000-0000-4000-8000-000000000001' and week = 7),
  '01:bye,02:tie,03:bye,04:win,05:loss,06:tie', 'I6e …week 7''s results: byes for A and C, D beat E, B and F tied — each week''s row keeps its own W/L/T');
-- A decided round is HISTORY (rider (iii)): corrupt the regular season so
-- the standings would now seed differently — round 1 is never recomputed
-- and the sync moves on.
select set_config('pgtap.d', pg_temp.pb_digest('b8000000-0000-4000-8000-000000000001', 7, 7), true);
update team_week_results set points = 0, h2h_result = 'loss' where league_id = 'b8000000-0000-4000-8000-000000000001' and team_id = 'c8000000-0000-4000-8000-000000000001' and week = 6;
select isnt(pg_temp.pb_order('b8000000-0000-4000-8000-000000000001', false), '01,03,05,02,06,04,07', 'I7 the corrupted table WOULD seed differently now');
select is(public.playoff_bracket_sync_internal('b8000000-0000-4000-8000-000000000001', '2026-10-29 10:00:00+00'), '{"round": 2, "reason": "round_in_progress", "source": "final"}'::jsonb,
  'I7b …yet the sync never revisits the decided round 1 — it reports round 2 in progress');
select is(pg_temp.pb_digest('b8000000-0000-4000-8000-000000000001', 7, 7), current_setting('pgtap.d'), 'I7c …round 1 byte-identical (seeds frozen)');
select is((select status from leagues where id = 'b8000000-0000-4000-8000-000000000001'), 'playoffs', 'I7d …and playoffs never goes back to in_season by any job path (rider (vi))');
update team_week_results set points = 100, h2h_result = 'win' where league_id = 'b8000000-0000-4000-8000-000000000001' and team_id = 'c8000000-0000-4000-8000-000000000001' and week = 6;

-- ---------------------------------------------------------------------------
-- J. Round 2; (B) the two-week sum on P5 (the equal-sum arm read
--    provisionally, then the points arm final); round 3; the champions
-- ---------------------------------------------------------------------------
update matchups set home_score = 120.00, away_score = 90.00 where league_id = 'b8000000-0000-4000-8000-000000000001' and week = 8 and home_seed = 1;  -- A 120 / D 90
update matchups set home_score = 80.00, away_score = 95.00 where league_id = 'b8000000-0000-4000-8000-000000000001' and week = 8 and home_seed = 2;   -- C 80 / B 95
update matchups set home_score = 90.00, away_score = 80.00 where league_id = 'b8000000-0000-4000-8000-000000000005' and week = 8;                    -- P 90 / Q 80 ⇒ 170–170
select set_config('pgtap.b', public.playoff_bracket_state_internal('b8000000-0000-4000-8000-000000000005')::text, true);
select is((select (g ->> 'home_total') || ':' || (g ->> 'away_total') || ':' || right(g ->> 'winner_team_id', 2) || ':' || (g ->> 'decided_by') || ':' || (g ->> 'final') from jsonb_array_elements(current_setting('pgtap.b')::jsonb -> 'round_list' -> 0 -> 'games') g),
  '170.00:170.00:51:higher_seed:false', 'J1 (B) THE EQUAL-SUM ARM (the recorded reading): 80+90 v 90+80 — an equal two-week total has no "most" and falls to (A): the higher seed P, provisional');
update matchups set home_score = 120.00, away_score = 80.00 where league_id = 'b8000000-0000-4000-8000-000000000005' and week = 8;                   -- P 120 / Q 80 ⇒ 200–170
select set_config('pgtap.b', public.playoff_bracket_state_internal('b8000000-0000-4000-8000-000000000005')::text, true);
select is((select (g ->> 'home_total') || ':' || (g ->> 'away_total') || ':' || right(g ->> 'winner_team_id', 2) || ':' || (g ->> 'decided_by') from jsonb_array_elements(current_setting('pgtap.b')::jsonb -> 'round_list' -> 0 -> 'games') g),
  '200.00:170.00:51:points', 'J1b (B) THE SUM: the week-1 loser P wins the aggregate 200–170 — "the winner is the team with the most points over both weeks"');
select set_config('pgtap.r', public.league_week_advance('2026-11-03 04:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'closed')::int, 2, 'J2 week 8 closes for P1 + P5');
select is((pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001') ->> 'action') || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001') ->> 'round') || ':' || pg_temp.pb_round('b8000000-0000-4000-8000-000000000001', 9, 9),
  'built:3:1:01v4:02', 'J2b P1 round 3 built provisional: A(1) v B(4) — B carried seed 4 through');
select is(public.playoff_bracket_sync_internal('b8000000-0000-4000-8000-000000000005', '2026-11-03 04:00:00+00'), '{"round": 1, "reason": "awaiting_final_round"}'::jsonb,
  'J2c P5: its last round has rolled — the champion waits for the FINAL (never provisional)');
select is((select status from leagues where id = 'b8000000-0000-4000-8000-000000000005'), 'playoffs', 'J2d …P5 still playoffs');
select set_config('pgtap.r', public.league_week_advance('2026-11-04 04:00:00+00')::text, true);
select set_config('pgtap.r', public.finalize_matchups('2026-11-05 10:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'finalized')::int, 2, 'J3 week 8 finalizes for P1 + P5');
select is((pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000005') ->> 'action') || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000005') ->> 'basis') || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000005') ->> 'decided_by') || ':' || right(pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000005') ->> 'champion_team_id', 2) || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000005') ->> 'from_status'),
  'complete:bracket:points:51:playoffs', 'J3b P5 COMPLETE — champion P by points over the two weeks; playoffs → complete');
select is((select status || ':' || right(champion_team_id::text, 2) from leagues where id = 'b8000000-0000-4000-8000-000000000005'), 'complete:51', 'J3c …the column says so');
select is((select string_agg(week || ':' || result, ',' order by week) from matchups where league_id = 'b8000000-0000-4000-8000-000000000005' and round_type = 'playoff'), '7:away,8:home',
  'J3d …each week''s row keeps its OWN result (Q won week 7, P won week 8) — the round''s verdict is the sum');
select is(pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001'), '{}'::jsonb, 'J3e P1: round 3 stands (A v B) — no action at the close');
-- The final.
update matchups set home_score = 130.00, away_score = 100.00 where league_id = 'b8000000-0000-4000-8000-000000000001' and week = 9;
select set_config('pgtap.r', public.league_week_advance('2026-11-10 04:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'closed')::int || ':' || jsonb_array_length(current_setting('pgtap.r')::jsonb -> 'brackets')::text, '1:0', 'J4 week 9 closes for P1; nothing to build (the last round)');
select is(public.playoff_bracket_sync_internal('b8000000-0000-4000-8000-000000000001', '2026-11-10 04:00:00+00'), '{"round": 3, "reason": "awaiting_final_round"}'::jsonb, 'J4b …the champion waits for the final');
select set_config('pgtap.r', public.finalize_matchups('2026-11-12 10:00:00+00')::text, true);
select is((pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001') ->> 'action') || ':' || (pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001') ->> 'decided_by') || ':' || right(pg_temp.pb_brackets('b8000000-0000-4000-8000-000000000001') ->> 'champion_team_id', 2),
  'complete:points:01', 'J5 P1 COMPLETE — champion A (130–100 in the final)');
select is((select status || ':' || right(champion_team_id::text, 2) from leagues where id = 'b8000000-0000-4000-8000-000000000001'), 'complete:01', 'J5b …the column');
select is(current_setting('pgtap.r')::jsonb ->> 'reason', null, 'J5c …reason NULL: a champion counts as something finalized');
-- Forward-only: a complete league is never claimed again.
select set_config('pgtap.r', public.league_week_advance('2026-11-12 10:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'leagues')::int || ':' || (current_setting('pgtap.r')::jsonb ->> 'reason'), '0:no_in_season_leagues', 'J6 the advance job claims no complete league');
select set_config('pgtap.r', public.finalize_matchups('2026-11-12 10:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'leagues')::int || ':' || (current_setting('pgtap.r')::jsonb ->> 'reason'), '0:nothing_due', 'J6b …nor does finalize');
select is(public.playoff_bracket_sync_internal('b8000000-0000-4000-8000-000000000001', '2026-11-12 10:00:00+00'), '{"reason": "not_in_play", "status": "complete"}'::jsonb, 'J6c …and the sync refuses a complete league by name (forward only)');
-- The finished bracket read.
select set_config('request.jwt.claims', '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.b', public.league_playoff_bracket('b8000000-0000-4000-8000-000000000001')::text, true);
select is((current_setting('pgtap.b')::jsonb ->> 'view') || ':' || (current_setting('pgtap.b')::jsonb ->> 'status') || ':' || right(current_setting('pgtap.b')::jsonb ->> 'champion_team_id', 2) || ':' || right(current_setting('pgtap.b')::jsonb ->> 'bracket_champion_team_id', 2) || ':' || coalesce(current_setting('pgtap.b')::jsonb ->> 'next_round', 'null'),
  'bracket:complete:01:01:null', 'J7 the finished bracket: view bracket, complete, champion A (stored ≡ derived), no next round');
select is((select string_agg((r ->> 'round') || ':' || (r ->> 'source') || ':' || (r ->> 'final') || ':' || (select string_agg(right(g ->> 'winner_team_id', 2) || '/' || (g ->> 'decided_by'), ',' order by (g ->> 'home_seed')::int) from jsonb_array_elements(r -> 'games') g), ' ' order by (r ->> 'round')::int) from jsonb_array_elements(current_setting('pgtap.b')::jsonb -> 'round_list') r),
  '1:final:true:01/bye,03/bye,04/points,02/higher_seed 2:final:true:01/points,02/points 3:final:true:01/points', 'J7b …three final rounds, every verdict named (bye · points · higher_seed)');
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- K. (C) — the settings-time refusals; a stored pair is a points race
-- ---------------------------------------------------------------------------
update leagues set playoff_teams = 2 where id = 'b8000000-0000-4000-8000-000000000003';
select is((public.playoff_bracket_state_internal('b8000000-0000-4000-8000-000000000003') ->> 'kind') || ':' || (public.playoff_bracket_state_internal('b8000000-0000-4000-8000-000000000003') ->> 'playoff_teams'),
  'points_race:2', 'K1 a STORED total_points + playoff_teams 2 pair (a pre-118 row; 058 L8 / 059 LT model it) reads as a points race — the MODE is what the engine reads, never playoff_teams');
select is(public.playoff_bracket_sync_internal('b8000000-0000-4000-8000-000000000003', '2026-11-12 10:00:00+00'), '{"reason": "not_in_play", "status": "complete"}'::jsonb,
  'K1b …and the sync on it is the no-bracket path (here: the completed league, refused by name — never a bracket write)');
update leagues set playoff_teams = 0 where id = 'b8000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.create_league('pgtap-pb-tp', 2026, 8, '{"schedule_mode": "total_points"}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'ESPN Standard'), 'TP', 'ad118000-0000-4000-8000-000000000001',
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  '%create_league: playoff_teams must be 0 for a total-points league%',
  'K2 create_league refuses playoff_teams 6 + total_points BY NAME (the message names playoff_teams and no other marker)');
select lives_ok(
  $$ select public.create_league('pgtap-pb-tp', 2026, 8, '{"schedule_mode": "total_points"}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'ESPN Standard'), 'TP', 'ad118000-0000-4000-8000-000000000002',
       'redraft', 14, 0, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'K2b …playoff_teams 0 + total_points creates (one unit away)');
select lives_ok(
  $$ select public.create_league('pgtap-pb-h2h', 2026, 8, '{"schedule_mode": "h2h"}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'ESPN Standard'), 'H2H', 'ad118000-0000-4000-8000-000000000003',
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'K2c …playoff_teams 6 + h2h creates (the other unit)');
select throws_like(
  $$ select public.update_league_settings((select id from public.leagues where creation_action_id = 'ad118000-0000-4000-8000-000000000002'), 8,
       '{"schedule_mode": "total_points"}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'::jsonb,
       null, 'redraft', 14, 4, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  '%update_league_settings: playoff_teams must be 0 for a total-points league%',
  'K3 update_league_settings refuses playoff_teams 4 + total_points BY NAME');
select lives_ok(
  $$ select public.update_league_settings((select id from public.leagues where creation_action_id = 'ad118000-0000-4000-8000-000000000002'), 8,
       '{"schedule_mode": "h2h"}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'::jsonb,
       null, 'redraft', 14, 4, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'K3b …the same PATCH with h2h applies (the refusal is the mode × playoff_teams pair, nothing else)');
select is((select playoff_teams || ':' || (settings ->> 'schedule_mode') from public.leagues where creation_action_id = 'ad118000-0000-4000-8000-000000000002'), '4:h2h', 'K3c …and landed');
reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
