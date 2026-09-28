-- ============================================================================
-- The Wednesday 00:00 Pacific week CEILING releases every lock — pgTAP 101
-- (task L.D2.10; migration 153; PROGRESS F333 (lock half) + F424, Q78, R1202,
-- D404 / TD15; spec §11.2 Release, §13.1, §13.2, §13.3).
--
-- Numbering: measured (153 / 101). OWN FIXTURE: users 9153…, leagues b153…,
-- teams c153…, claims d153…, action ids a153…, players wc-*, NFL teams C*.
-- Every instant is passed explicitly (the TimeProvider rule); internals are
-- called as postgres with the actor's JWT claims set.
--
-- THE CALENDAR (2026 seeds; only the stamps are rewritten): weeks 1–5 over;
-- week 6 recorded ending AT its floor (Tue 2026-10-20 07:00Z — the control);
-- week 7: CA kicked off Thu 10-23 00:15Z, CB Sun 10-25 17:00Z, CM's Monday
-- game kicked off Tue 10-27 00:15Z and was SUSPENDED (never final), CP's
-- Monday game POSTPONED to Thu 10-29 00:15Z (still a week-7 row), CC on bye
-- — so week 7's `last_game_ends_at` stays NULL (the F333 state). Week 8
-- starts Wed 10-28 04:00Z (00:00 EDT); week 7's CEILING is Wed 10-28 07:00Z
-- (00:00 PDT); week 8's is Wed 11-04 08:00Z (00:00 PST — after the 11-01
-- fall-back). Boundary instants: 06:59:59Z / 07:00:00Z and 07:59:59Z /
-- 08:00:00Z.
--
-- SECTIONS: A form + the ceiling literals + D137 in the database;
-- B the two lock helpers (−1 s / AT across the DST week; the all-final
-- control at the floor; an end stamped after the ceiling); C the tick's pool
-- view; D add/drop, and — in LZ, a league whose LAST week is 7, so week 7 is
-- still current at the ceiling — add/drop and the commissioner (the
-- finished-week CASE); E the free-agency window (F424); F the waiver run AT
-- the ceiling (Q78: "waivers run on schedule"), and in LZW (last week 7);
-- G R1202 — a deferred trade releases at the ceiling and starts at week 8,
-- and in LZT (last week 7); H TD15 — nothing stamped, the week stays live.
--
-- BREAK PROBES (the PR body), each injected inside this transaction (so the
-- ROLLBACK ends it); A13's live-md5 pin reds in every probe by design:
--   (1) both lock helpers back to 115's text ⇒ B2 B3 B4 B7 B9 C2 red, and
--       D3's drop AT the ceiling raises the lock refusal (the run aborts);
--   (2) roster_add_drop_internal back to 152's text ⇒ D8 D9 red (and D10,
--       whose week-7 row literal D8 / D9 changed);
--   (3) waiver_window_internal back to 149's text ⇒ E2 E4 red;
--   (4) the other three writers back to 152 / 152 / 151 ⇒ D10 F4 G7 red.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(52);

-- ---------------------------------------------------------------------------
-- A. Form pins, the ceiling literals, D137 in the database
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('week_release_ceiling_internal', 'week_lock_release_internal')),
  'week_lock_release_internal:f:search_path="":f:f week_release_ceiling_internal:f:search_path="":f:f',
  'A1 the two new helpers: one overload each, PLAIN, search_path empty, closed to anon and authenticated');
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('pool_game_lock_internal', 'pool_game_lock_any_internal', 'waiver_window_internal',
                                                 'roster_add_drop_internal', 'commish_roster_override_internal',
                                                 'process_waivers_internal', 'trade_execute_internal')),
  'commish_roster_override_internal:f:search_path="":f:f pool_game_lock_any_internal:f:search_path="":f:f pool_game_lock_internal:f:search_path="":f:f process_waivers_internal:f:search_path="":f:f roster_add_drop_internal:f:search_path="":f:f trade_execute_internal:f:search_path="":f:f waiver_window_internal:f:search_path="":f:f',
  'A2 the seven replaced bodies: one overload each (signatures unchanged), PLAIN, search_path empty, closed to anon and authenticated');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and a.privilege_type = 'EXECUTE' and a.grantee = 0
      and p.proname in ('week_release_ceiling_internal', 'week_lock_release_internal', 'pool_game_lock_internal',
                        'pool_game_lock_any_internal', 'waiver_window_internal', 'roster_add_drop_internal',
                        'commish_roster_override_internal', 'process_waivers_internal', 'trade_execute_internal')),
  'A3 PUBLIC holds EXECUTE on none of the nine (REVOKEs restated)');
select is(
  (select string_agg(w.week || '=' || to_char(public.week_release_ceiling_internal(w.starts_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI'), ' ' order by w.week)
   from nfl_weeks w where w.season = 2026 and w.week in (1, 2, 7, 8, 9, 18)),
  '1=2026-09-16T07:00 2=2026-09-23T07:00 7=2026-10-28T07:00 8=2026-11-04T08:00 9=2026-11-11T08:00 18=2027-01-13T08:00',
  'A4 GOLDEN — the ceilings of the seeded weeks (stored literals, the SAME ones release-floor.test.ts pins on weekReleaseCeiling): 07:00Z under PDT, 08:00Z under PST');
select is(
  format('%s|%s',
         public.week_release_ceiling_internal('2027-03-10 05:00:00+00') at time zone 'UTC',
         public.week_release_ceiling_internal('2026-10-20 06:00:00+00') at time zone 'UTC'),
  '2027-03-17 07:00:00|2026-10-27 07:00:00',
  'A5 the spring-forward boundary (a week starting Wed 2027-03-10 00:00 EST ceilings at Wed 03-17 00:00 PDT) and a mis-timed anchor (Mon 23:00 PDT) still ceilings past its own seven days — the TS twin''s literals');
-- Independent cross-check over the whole seeded calendar: the ceiling is
-- Wednesday 00:00 on the Pacific wall clock, exactly one Pacific day after
-- the floor (the first Tuesday 00:00 Pacific strictly after starts_at,
-- derived here separately from release-floor.ts's rule), and three hours
-- after the NEXT week starts (Wednesday 00:00 Eastern).
select is(
  (select count(*)::int from (
     select w.week, w.starts_at, public.week_release_ceiling_internal(w.starts_at) as c,
            (select min(t) from generate_series(1, 8) k,
                    lateral (select (((w.starts_at at time zone 'America/Los_Angeles')::date + k)::timestamp at time zone 'America/Los_Angeles') as t) x
              where extract(dow from ((w.starts_at at time zone 'America/Los_Angeles')::date + k)) = 2
                and x.t > w.starts_at) as floor_at,
            (select n.starts_at from nfl_weeks n where n.season = w.season and n.week = w.week + 1) as next_start
     from nfl_weeks w where w.season = 2026) q
   where to_char(q.c at time zone 'America/Los_Angeles', 'Dy HH24:MI:SS') = 'Wed 00:00:00'
     and ((q.floor_at at time zone 'America/Los_Angeles')::date + 1) = (q.c at time zone 'America/Los_Angeles')::date
     and q.c > q.floor_at
     and (q.next_start is null or q.c - q.next_start = interval '3 hours')),
  (select count(*)::int from nfl_weeks where season = 2026),
  'A6 every seeded 2026 week: the ceiling is Wed 00:00 Pacific, the day after its Tuesday floor, three hours after the next week starts');
select throws_ok($$ select public.week_release_ceiling_internal(null) $$, '22023', null,
  'A7 a NULL starts_at is refused loudly (22023), never guessed');
select is(
  (select format('%s|%s|%s',
                 public.week_lock_release_internal(null, w.starts_at) at time zone 'UTC',
                 public.week_lock_release_internal('2026-10-27 07:00:00+00', w.starts_at) at time zone 'UTC',
                 public.week_lock_release_internal('2026-10-28 09:30:00+00', w.starts_at) at time zone 'UTC')
   from nfl_weeks w where w.season = 2026 and w.week = 7),
  '2026-10-28 07:00:00|2026-10-27 07:00:00|2026-10-28 07:00:00',
  'A8 week 7''s lock release: unrecorded ⇒ the ceiling; recorded at the floor ⇒ the floor; recorded AFTER the ceiling ⇒ the ceiling');
select is(
  (select md5(replace(replace(replace(p.prosrc,
  E'DECLARE\n  v_k       RECORD;\n  v_release TIMESTAMPTZ;   -- 153: the week\'s LOCK RELEASE (week_lock_release_internal)\nBEGIN',
  E'DECLARE\n  v_k RECORD;\nBEGIN'),
  E'  SELECT w.last_game_ends_at, public.week_lock_release_internal(w.last_game_ends_at, w.starts_at)\n    INTO window_ends_at, v_release\n  FROM public.nfl_weeks w\n  WHERE w.season = p_season AND w.week = p_week;\n  -- 153 / F333 (Q78, Chris 2026-09-27): the week\'s locks release at the\n  -- EARLIER of its recorded end and its Wednesday 00:00 Pacific CEILING —\n  -- even with a game unplayed. The document reports the release when it is\n  -- KNOWN (the recorded end, capped by the ceiling). While the end is not\n  -- recorded it stays NULL — F238\'s loud state, which lineup_lock_tick\n  -- writes as \'infinity\' and a deferred trade re-reads every minute — so an\n  -- ordinary all-final stamp (the Tuesday floor) is never hidden behind the\n  -- ceiling.\n  IF window_ends_at IS NOT NULL THEN\n    window_ends_at := v_release;\n  END IF;\n',
  E'  SELECT w.last_game_ends_at INTO window_ends_at\n  FROM public.nfl_weeks w\n  WHERE w.season = p_season AND w.week = p_week;\n'),
  E'  IF kickoff_at IS NULL OR kickoff_at > p_at THEN\n    locked := FALSE;                     -- bye, or the kickoff is still ahead\n  ELSIF v_release <= p_at THEN\n    -- 153 / Q78: RELEASED — the week\'s last game ended, or its ceiling has\n    -- passed with the end still unrecorded (a postponed game: its points\n    -- stay pending — M8\'s operator tools, never this helper). NULL (no\n    -- calendar row) falls through to the loud arm below, as before.\n    locked := FALSE;\n  ELSIF window_ends_at IS NULL THEN',
  E'  IF kickoff_at IS NULL OR kickoff_at > p_at THEN\n    locked := FALSE;                     -- bye, or the kickoff is still ahead\n  ELSIF window_ends_at IS NULL THEN')) from pg_proc p where p.oid = 'public.pool_game_lock_internal(integer,integer,text,timestamptz)'::regprocedure),
  '049726c75e6c7fc534ed3978a4e645d3',
  'A9 D137 pool_game_lock_internal: 115''s FILE TEXT (115:225-274) beneath 153''s 3 substitution(s) — each reversed, the prosrc md5 is 115''s (a stored literal)');
select is(
  (select md5(replace(replace(p.prosrc,
  E'  -- here — a scoring boundary that no longer governs transactions.)\n  -- 153 / F333 (Q78): and whose Wednesday 00:00 Pacific CEILING has not\n  -- passed — past it the week holds nobody, recorded end or not.\n  FOR v_w IN',
  E'  -- here — a scoring boundary that no longer governs transactions.)\n  FOR v_w IN'),
  E'      AND (w.last_game_ends_at IS NULL OR w.last_game_ends_at > p_at)\n      AND public.week_release_ceiling_internal(w.starts_at) > p_at\n    ORDER BY w.week DESC',
  E'      AND (w.last_game_ends_at IS NULL OR w.last_game_ends_at > p_at)\n    ORDER BY w.week DESC')) from pg_proc p where p.oid = 'public.pool_game_lock_any_internal(integer,integer,text,timestamptz)'::regprocedure),
  'f872fd8d6393a0d66472ec73318ca4e4',
  'A10 D137 pool_game_lock_any_internal: 115''s FILE TEXT (115:283-328) beneath 153''s 2 substitution(s) — each reversed, the prosrc md5 is 115''s (a stored literal)');
select is(
  (select md5(replace(p.prosrc,
  E'  -- 153 / F424 (Q78): a week ENDS at its lock release — the recorded end,\n  -- or its Wednesday 00:00 Pacific ceiling when that comes first — so a\n  -- postponed game no longer holds free agency open past the ceiling, and a\n  -- run scheduled AT the ceiling counts ("waivers run on schedule").\n  SELECT max(public.week_lock_release_internal(w.last_game_ends_at, w.starts_at)) INTO v_week_end\n  FROM public.nfl_weeks w\n  WHERE w.season = p_league.season\n    AND public.week_lock_release_internal(w.last_game_ends_at, w.starts_at) <= p_at;\n',
  E'  SELECT max(w.last_game_ends_at) INTO v_week_end\n  FROM public.nfl_weeks w\n  WHERE w.season = p_league.season AND w.last_game_ends_at <= p_at;\n')) from pg_proc p where p.oid = 'public.waiver_window_internal(public.leagues,timestamptz)'::regprocedure),
  '00fa7459291e8d330ae87772d868737e',
  'A11 D137 waiver_window_internal: 149''s FILE TEXT (149:306-389) beneath 153''s 1 substitution(s) — each reversed, the prosrc md5 is 149''s (a stored literal)');
-- The four roster writers: the SAME two substitutions (the DECLARE comment
-- where 152 wrote one; the week end's SELECT), reversed on each live body.
create function pg_temp.unhunk(p_src text, p_indent text) returns text language sql as $$
  select replace(replace(p_src,
    'TIMESTAMPTZ;   -- 152 / F437: the current week''s end (153: its lock release — Q78''s ceiling)',
    'TIMESTAMPTZ;   -- 152 / F437: the current week''s last_game_ends_at'),
    p_indent || '-- 153 / F333 (Q78): the week ENDS at its lock release — the recorded end,' || E'\n'
    || p_indent || '-- or its Wednesday 00:00 Pacific ceiling when that comes first. The' || E'\n'
    || p_indent || '-- ceiling releases a played starter, so it must finish the week for' || E'\n'
    || p_indent || '-- lineups too: otherwise, in a league''s LAST week (no week N+1 row to' || E'\n'
    || p_indent || '-- flip the current week), a move at the ceiling would clear his start.' || E'\n'
    || p_indent || 'SELECT public.week_lock_release_internal(w.last_game_ends_at, w.starts_at) INTO v_week_end FROM public.nfl_weeks w' || E'\n',
    p_indent || 'SELECT w.last_game_ends_at INTO v_week_end FROM public.nfl_weeks w' || E'\n')
$$;
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.unhunk(p.prosrc, case when p.proname = 'commish_roster_override_internal' then '    ' else '  ' end)), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('roster_add_drop_internal', 'commish_roster_override_internal', 'process_waivers_internal', 'trade_execute_internal')),
  'commish_roster_override_internal=42e165a610082723c1124d1dc872d648 process_waivers_internal=faaca7fba5fff976f4fa811678e553aa roster_add_drop_internal=a30621f38adb8b114a4a903b068eeb8e trade_execute_internal=ef4648770bd5c18127e5c2270d8aec14',
  'A12 D137 the four roster writers: each live body with 153''s substitutions reversed is its newest definer''s FILE TEXT (152:103-638 / 152:646-1643 / 152:1651-2203 / 151:755-1209 — stored md5 literals)');
select is(
  (select string_agg(p.proname || '=' || md5(p.prosrc), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('pool_game_lock_internal', 'pool_game_lock_any_internal', 'waiver_window_internal',
                                                 'roster_add_drop_internal', 'commish_roster_override_internal',
                                                 'process_waivers_internal', 'trade_execute_internal')),
  'commish_roster_override_internal=32972a1a5183c748be5a90c8ffdad7f1 pool_game_lock_any_internal=c04027b390f46cf19247fab2ff2e1990 pool_game_lock_internal=0f5108e621329f956437ecacd370a011 process_waivers_internal=7b3dad5e6e9483ed0edc82bd8f055ada roster_add_drop_internal=f4879cd129747a28d52bab277108265e trade_execute_internal=2be2500ab6e3ba21b02a087e29403e50 waiver_window_internal=52a4199c8cf011c34cd24e93d4581b7c',
  'A13 the seven live prosrc md5s — 153 as written (stored literals)');
select ok(
  (select col_description('public.league_player_pool'::regclass, a.attnum)
   from pg_attribute a where a.attrelid = 'public.league_player_pool'::regclass and a.attname = 'locked_until')
  like '%VIEW%CEILING%NEVER read from this column%''infinity''%',
  'A14 the locked_until comment names the ceiling and keeps 116''s pinned words (064 A12)');

-- ---------------------------------------------------------------------------
-- Fixtures (postgres context)
-- ---------------------------------------------------------------------------
update nfl_weeks w
set last_game_ends_at = case when w.week <= 5 then w.starts_at + interval '6 days'
                             when w.week = 6 then '2026-10-20 07:00:00+00'::timestamptz end,
    first_kickoff_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at)
select 'wc-dummy-' || w.week, 2026, w.week, 'KC', 'BUF', w.starts_at + interval '1 day' from nfl_weeks w where w.season = 2026 and w.week <= 14;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('wc-g6a', 2026, 6, 'CA', 'CZ', '2026-10-16 00:15:00+00'),
 ('wc-g7a', 2026, 7, 'CA', 'CZ', '2026-10-23 00:15:00+00'), ('wc-g7b', 2026, 7, 'CB', 'CY', '2026-10-25 17:00:00+00'),
 ('wc-g7m', 2026, 7, 'CM', 'CX', '2026-10-27 00:15:00+00'),   -- Monday night, suspended: never final
 ('wc-g7p', 2026, 7, 'CP', 'CQ', '2026-10-29 00:15:00+00'),   -- Monday night, postponed to Thursday
 ('wc-g8a', 2026, 8, 'CA', 'CZ', '2026-10-30 00:15:00+00'), ('wc-g8b', 2026, 8, 'CB', 'CY', '2026-11-01 18:00:00+00');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('91530000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-wc' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'wc_user' || i)::jsonb, now(), now()
from generate_series(1, 3) i;

-- L1 add/drop + the tick (weeks 1–14); LZ the LAST-week edge (weeks 1–7);
-- LW1 daily 10:00 UTC; LW2 league 2's Wednesday 00:00 Pacific run; LW3 the
-- same, tracked (the processor); LT a trade with no review.
insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, waiver_type, faab_budget, trade_review,
                     settings, roster_settings, waiver_next_run_at)
select l.id, '91530000-0000-4000-8000-000000000001', l.nm, 2026, 'in_season', 12, 14, 0, 15,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', l.wt, 100, l.review, l.st,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 2}], "bench": 3, "ir_slots": [], "swap_spots": 0}'::jsonb,
       l.nx
from (values
 ('b1530000-0000-4000-8000-000000000001'::uuid, 'pgtap-wc-L1',  'none_fcfs', 'commissioner', '{}'::jsonb, null::timestamptz),
 ('b1530000-0000-4000-8000-000000000002'::uuid, 'pgtap-wc-LZ',  'none_fcfs', 'commissioner', '{}'::jsonb, null),
 ('b1530000-0000-4000-8000-000000000003'::uuid, 'pgtap-wc-LW1', 'faab', 'commissioner',
  '{"waiver_run_days": ["sun","mon","tue","wed","thu","fri","sat"], "waiver_run_time": "10:00", "waiver_time_zone": "UTC", "free_agency_opens": "after_waiver_run"}'::jsonb, null),
 ('b1530000-0000-4000-8000-000000000004'::uuid, 'pgtap-wc-LW2', 'faab', 'commissioner',
  '{"waiver_run_days": ["wed"], "waiver_run_time": "00:00", "waiver_time_zone": "America/Los_Angeles", "free_agency_opens": "after_waiver_run"}'::jsonb, null),
 ('b1530000-0000-4000-8000-000000000005'::uuid, 'pgtap-wc-LW3', 'faab', 'commissioner',
  '{"waiver_run_days": ["wed"], "waiver_run_time": "00:00", "waiver_time_zone": "America/Los_Angeles", "free_agency_opens": "after_waiver_run"}'::jsonb,
  '2026-10-28 07:00:00+00'),
 ('b1530000-0000-4000-8000-000000000006'::uuid, 'pgtap-wc-LT',  'none_fcfs', 'none', '{}'::jsonb, null),
 ('b1530000-0000-4000-8000-000000000007'::uuid, 'pgtap-wc-LZW', 'faab', 'commissioner',
  '{"waiver_run_days": ["wed"], "waiver_run_time": "00:00", "waiver_time_zone": "America/Los_Angeles", "free_agency_opens": "after_waiver_run"}'::jsonb,
  '2026-10-28 07:00:00+00'),
 ('b1530000-0000-4000-8000-000000000008'::uuid, 'pgtap-wc-LZT', 'none_fcfs', 'none', '{}'::jsonb, null)
) as l(id, nm, wt, review, st, nx);

insert into teams (id, owner_id, name, league_id, status)
select t.id::uuid, ('91530000-0000-4000-8000-00000000000' || t.u)::uuid, t.nm, ('b1530000-0000-4000-8000-00000000000' || t.lg)::uuid, 'active'
from (values
 ('c1530000-0000-4000-8000-000000000011', 1, 'WC Commish', 1), ('c1530000-0000-4000-8000-000000000012', 2, 'WC Alpha', 1),
 ('c1530000-0000-4000-8000-000000000013', 3, 'WC Bravo', 1),
 ('c1530000-0000-4000-8000-000000000021', 1, 'WC Zed Commish', 2), ('c1530000-0000-4000-8000-000000000022', 2, 'WC Zulu', 2),
 ('c1530000-0000-4000-8000-000000000031', 1, 'WC W1 Commish', 3),
 ('c1530000-0000-4000-8000-000000000041', 1, 'WC W2 Commish', 4),
 ('c1530000-0000-4000-8000-000000000051', 1, 'WC W3 Commish', 5), ('c1530000-0000-4000-8000-000000000052', 2, 'WC Foxtrot', 5),
 ('c1530000-0000-4000-8000-000000000061', 1, 'WC T Commish', 6), ('c1530000-0000-4000-8000-000000000062', 2, 'WC Tango', 6),
 ('c1530000-0000-4000-8000-000000000063', 3, 'WC Uniform', 6),
 ('c1530000-0000-4000-8000-000000000071', 1, 'WC ZW Commish', 7), ('c1530000-0000-4000-8000-000000000072', 2, 'WC Yankee', 7),
 ('c1530000-0000-4000-8000-000000000081', 1, 'WC ZT Commish', 8), ('c1530000-0000-4000-8000-000000000082', 2, 'WC Victor', 8),
 ('c1530000-0000-4000-8000-000000000083', 3, 'WC Whiskey', 8)
) as t(id, u, nm, lg);

insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, t.owner_id, t.id,
       case when t.owner_id = '91530000-0000-4000-8000-000000000001' then 'commissioner' else 'manager' end, false, 100
from teams t where t.id::text like 'c1530000-%';

insert into league_weeks (league_id, season, week)
select l.id, 2026, w from leagues l cross join generate_series(1, 14) w
where l.id::text like 'b1530000-%' and l.name not in ('pgtap-wc-LZ', 'pgtap-wc-LZW', 'pgtap-wc-LZT');
insert into league_weeks (league_id, season, week)
select l.id, 2026, w from leagues l cross join generate_series(1, 7) w
where l.name in ('pgtap-wc-LZ', 'pgtap-wc-LZW', 'pgtap-wc-LZT');

insert into drafts (league_id, status, completed_at, draft_order)
select l.id, 'complete', '2026-09-06 06:00:00+00',
       (select jsonb_agg(t.id order by t.id) from teams t where t.league_id = l.id)
from leagues l where l.id::text like 'b1530000-%';

insert into players (id, full_name, position, team, status)
select p.id, p.nm, 'QB', p.nfl, 'Active'
from (values
 ('wc-a1', 'WC A One (Thu)', 'CA'), ('wc-a2', 'WC A Two (postponed)', 'CP'), ('wc-a3', 'WC A Three (bye)', 'CC'),
 ('wc-b1', 'WC B One (suspended)', 'CM'), ('wc-b2', 'WC B Two (Sun)', 'CB'),
 ('wc-fa', 'WC Free Agent (Thu)', 'CA'),
 ('wc-z1', 'WC Z One (Thu)', 'CA'), ('wc-z2', 'WC Z Two (postponed)', 'CP'), ('wc-z3', 'WC Z Three (bye)', 'CC'),
 ('wc-z4', 'WC Z Four (Thu)', 'CA'),
 ('wc-y1', 'WC Y One (Sun)', 'CB'), ('wc-y2', 'WC Y Two (bye)', 'CC'), ('wc-y9', 'WC Y Nine (bye)', 'CC'),
 ('wc-v1', 'WC V One (Thu)', 'CA'), ('wc-v2', 'WC V Two (bye)', 'CC'), ('wc-w1', 'WC W One (bye)', 'CC'), ('wc-w2', 'WC W Two (bye)', 'CC'),
 ('wc-f1', 'WC F One (Sun)', 'CB'), ('wc-f2', 'WC F Two (bye)', 'CC'), ('wc-x1', 'WC X One (Thu)', 'CA'),
 ('wc-t1', 'WC T One (Thu)', 'CA'), ('wc-t2', 'WC T Two (bye)', 'CC'), ('wc-u1', 'WC U One (bye)', 'CC'), ('wc-u2', 'WC U Two (bye)', 'CC')
) as p(id, nm, nfl);

insert into league_rosters (league_id, team_id, player_id, slot_key)
select t.league_id, t.id, r.pid, 'bn'
from (values
 ('WC Alpha', 'wc-a1'), ('WC Alpha', 'wc-a2'), ('WC Alpha', 'wc-a3'), ('WC Bravo', 'wc-b1'), ('WC Bravo', 'wc-b2'),
 ('WC Zulu', 'wc-z1'), ('WC Zulu', 'wc-z2'), ('WC Zulu', 'wc-z3'), ('WC Zulu', 'wc-z4'),
 ('WC Yankee', 'wc-y1'), ('WC Yankee', 'wc-y2'),
 ('WC Victor', 'wc-v1'), ('WC Victor', 'wc-v2'), ('WC Whiskey', 'wc-w1'), ('WC Whiskey', 'wc-w2'),
 ('WC Foxtrot', 'wc-f1'), ('WC Foxtrot', 'wc-f2'),
 ('WC Tango', 'wc-t1'), ('WC Tango', 'wc-t2'), ('WC Uniform', 'wc-u1'), ('WC Uniform', 'wc-u2')
) as r(team, pid)
join teams t on t.name = r.team and t.id::text like 'c1530000-%';
insert into league_player_pool (league_id, player_id, state) values
 ('b1530000-0000-4000-8000-000000000001', 'wc-fa', 'free_agent');

-- Lineups in 114's shape (100's helper): week 7 (the week the ceiling closes) and week 8.
create function pg_temp.team(p_name text) returns uuid language sql as $$ select id from teams where name = p_name and id::text like 'c1530000-%' $$;
create function pg_temp.put(p_team text, p_week int, p_q0 text, p_q1 text, p_bench jsonb) returns void language sql as $$
  insert into team_lineups (team_id, season, week, slot_map, starters, bench)
  values (pg_temp.team(p_team), 2026, p_week,
          jsonb_strip_nulls(jsonb_build_object('qb:0', p_q0, 'qb:1', p_q1)),
          jsonb_build_array(
            jsonb_build_object('slot', 'qb:0', 'player_id', p_q0, 'flags', case when p_q0 is null then '["empty"]'::jsonb else '[]'::jsonb end),
            jsonb_build_object('slot', 'qb:1', 'player_id', p_q1, 'flags', case when p_q1 is null then '["empty"]'::jsonb else '[]'::jsonb end)),
          p_bench)
$$;
select pg_temp.put(t.team, w.week, t.q0, t.q1, t.bench::jsonb)
from (values
 ('WC Alpha', 'wc-a1', 'wc-a2', '["wc-a3"]'), ('WC Bravo', 'wc-b1', 'wc-b2', '[]'),
 ('WC Foxtrot', 'wc-f1', null, '["wc-f2"]'),
 ('WC Tango', 'wc-t1', null, '["wc-t2"]'), ('WC Uniform', 'wc-u1', null, '["wc-u2"]')
) as t(team, q0, q1, bench)
cross join (values (7), (8)) as w(week);
-- The LAST-week leagues (weeks 1–7): week 7 rows only.
select pg_temp.put(t.team, 7, t.q0, t.q1, t.bench::jsonb)
from (values
 ('WC Zulu', 'wc-z1', 'wc-z2', '["wc-z3", "wc-z4"]'), ('WC Yankee', 'wc-y1', null, '["wc-y2"]'),
 ('WC Victor', 'wc-v1', null, '["wc-v2"]'), ('WC Whiskey', 'wc-w1', null, '["wc-w2"]')
) as t(team, q0, q1, bench);

-- Post-reset race guard (067's): today's + tomorrow's realtime.messages partitions.
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

create temp table r101 (tag text primary key, r jsonb not null);
create function pg_temp.as_user(p_n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '91530000-0000-4000-8000-00000000000' || p_n, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.lg(p_n int) returns uuid language sql as $$ select ('b1530000-0000-4000-8000-00000000000' || p_n)::uuid $$;
create function pg_temp.act(p_n int) returns uuid language sql as $$ select ('a1530000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.lu(p_team text, p_week int) returns text language sql as $$
  select format('%s | %s | %s', tl.slot_map::text,
                (select string_agg(coalesce(s ->> 'player_id', '-'), ',' order by o) from jsonb_array_elements(tl.starters) with ordinality x(s, o)),
                tl.bench::text)
  from team_lineups tl where tl.team_id = pg_temp.team(p_team) and tl.season = 2026 and tl.week = p_week $$;
create function pg_temp.ad(p_tag text, p_lg int, p_user int, p_team text, p_add text, p_drop text, p_at timestamptz, p_act int) returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r101 select p_tag, public.roster_add_drop_internal(pg_temp.lg(p_lg), pg_temp.team(p_team), p_add, p_drop, pg_temp.act(p_act), p_at);
  perform set_config('request.jwt.claims', '', true);
  return (select r from r101 where tag = p_tag);
end $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  perform set_config('request.jwt.claims', '', true);
  return sqlstate || ': ' || sqlerrm;
end $$;
create function pg_temp.roster_of(p_pid text) returns text language sql as $$
  select coalesce(string_agg(t.name, ',' order by t.name), '(none)') from league_rosters r join teams t on t.id = r.team_id where r.player_id = p_pid $$;
create function pg_temp.lock(p_week int, p_team text, p_at timestamptz) returns text language sql as $$
  select format('%s|%s', l.locked::text, coalesce(l.window_ends_at::text, 'null')) from public.pool_game_lock_internal(2026, p_week, p_team, p_at) l $$;
create function pg_temp.win(p_lg int, p_at timestamptz) returns jsonb language sql as $$
  select public.waiver_window_internal(l, p_at) from leagues l where l.id = pg_temp.lg(p_lg) $$;

-- ---------------------------------------------------------------------------
-- B. The two lock helpers — the ceiling itself
-- ---------------------------------------------------------------------------
select is(pg_temp.lock(7, 'CA', '2026-10-28 06:59:59+00'), 'true|null',
  'B1 week 7 unrecorded (a Monday game unfinished), CEILING − 1 s (Tue 23:59:59 PDT): the Thursday player is LOCKED, the release not yet known');
select is(pg_temp.lock(7, 'CA', '2026-10-28 07:00:00+00'), 'false|null',
  'B2 AT the ceiling (Wed 00:00 PDT = 07:00Z): RELEASED although the week''s end is still unrecorded (Q78)');
select is(
  format('%s / %s', pg_temp.lock(8, 'CA', '2026-11-04 07:59:59+00'), pg_temp.lock(8, 'CA', '2026-11-04 08:00:00+00')),
  'true|null / false|null',
  'B3 DST: week 8''s ceiling is Wed 00:00 PST = 08:00Z (after the 11-01 fall-back) — locked at 07:59:59Z, released AT 08:00Z (an hour later in absolute time than week 7''s)');
select is(
  format('%s / %s', pg_temp.lock(7, 'CM', '2026-10-28 06:59:59+00'), pg_temp.lock(7, 'CM', '2026-10-28 07:00:00+00')),
  'true|null / false|null',
  'B4 the SUSPENDED Monday game''s own players (kicked off, never final): locked until the ceiling, released AT it — their points stay pending (M8)');
select is(
  (select format('%s|%s|%s', l.locked, l.kickoff_at, l.datum_arm) from public.pool_game_lock_internal(2026, 7, 'CP', '2026-10-28 06:59:59+00') l),
  'f|2026-10-29 00:15:00+00|nfl_games',
  'B5 the POSTPONED game''s players (kickoff moved to Thursday) never locked for week 7 — their kickoff is still ahead');
select is(
  format('%s / %s', pg_temp.lock(6, 'CA', '2026-10-20 06:59:59+00'), pg_temp.lock(6, 'CA', '2026-10-20 07:00:00+00')),
  'true|2026-10-20 07:00:00+00 / false|2026-10-20 07:00:00+00',
  'B6 CONTROL — week 6, every game final, recorded at its FLOOR (Tue 00:00 PDT): locked at floor − 1 s, released AT the floor, exactly as before 153 (the ceiling a day later plays no part)');
update nfl_weeks set last_game_ends_at = '2026-10-28 09:30:00+00' where season = 2026 and week = 7;
select is(
  format('%s / %s', pg_temp.lock(7, 'CA', '2026-10-28 06:59:59+00'), pg_temp.lock(7, 'CA', '2026-10-28 07:00:00+00')),
  'true|2026-10-28 07:00:00+00 / false|2026-10-28 07:00:00+00',
  'B7 an end STAMPED AFTER the ceiling (the suspended game finished Wed 02:30 PDT): the reported release is capped AT the ceiling, and the player is released there');
update nfl_weeks set last_game_ends_at = null where season = 2026 and week = 7;
select is(
  public.pool_game_lock_any_internal(2026, 8, 'CA', '2026-10-28 06:59:59+00') - 'kickoff_at' - 'window_ends_at',
  '{"locked": true, "week": 7, "datum_arm": "nfl_games", "on_bye": false}'::jsonb,
  'B8 across weeks, ceiling − 1 s: week 8 is ALREADY current (it began at 04:00Z, Wed 00:00 EDT) and the unfinished week 7 still binds — the three hours the previous week can hold');
select is(
  public.pool_game_lock_any_internal(2026, 8, 'CA', '2026-10-28 07:00:00+00') - 'kickoff_at' - 'window_ends_at',
  '{"locked": false, "week": 8, "datum_arm": "nfl_games", "on_bye": false}'::jsonb,
  'B9 across weeks, AT the ceiling: week 7 is no longer a candidate — the result reports the current week''s own datum (week 8, not yet kicked off)');

-- ---------------------------------------------------------------------------
-- C. The tick's pool view (lineup_lock_tick → league_player_pool)
-- ---------------------------------------------------------------------------
select set_config('pgtap.c1', public.lineup_lock_tick('2026-10-28 06:59:59+00', pg_temp.lg(1))::text, true);
select is((select state || ':' || coalesce(locked_until::text, 'null') from league_player_pool where league_id = pg_temp.lg(1) and player_id = 'wc-fa'),
  'locked_in_game:infinity',
  'C1 the tick at ceiling − 1 s: the Thursday free agent reads locked_in_game until ''infinity'' (F238: the week''s end is not recorded)');
select set_config('pgtap.c2', public.lineup_lock_tick('2026-10-28 07:00:00+00', pg_temp.lg(1))::text, true);
select is((select state || ':' || coalesce(locked_until::text, 'null') from league_player_pool where league_id = pg_temp.lg(1) and player_id = 'wc-fa'),
  'free_agent:null',
  'C2 the tick AT the ceiling: he is a free agent again (the view follows the helper — nothing else decides)');

-- ---------------------------------------------------------------------------
-- D. add/drop (L1, and LZ — a league whose LAST week is 7)
-- ---------------------------------------------------------------------------
select is(
  pg_temp.err($$ select pg_temp.ad('D1x', 1, 2, 'WC Alpha', null, 'wc-a1', '2026-10-28 06:59:59+00', 1) $$),
  'P0001: roster_add_drop: WC A One (Thu) (wc-a1) is locked for drops — kicked off at 2026-10-23T00:15:00+00:00 (nfl_games); week 7 clears at an instant not yet recorded — nfl_weeks.last_game_ends_at stays NULL until ingestion has recorded every game of the week final, so he stays locked (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no dropping a player mid-game',
  'D1 ceiling − 1 s: the Thursday starter who played is still locked for drops (week 7''s end unrecorded)');
select is(
  pg_temp.err($$ select pg_temp.ad('D2x', 1, 2, 'WC Alpha', 'wc-fa', null, '2026-10-28 06:59:59+00', 2) $$),
  'P0001: roster_add_drop: WC Free Agent (Thu) (wc-fa) is locked for adds — kicked off at 2026-10-23T00:15:00+00:00 (nfl_games); week 7 clears at an instant not yet recorded — nfl_weeks.last_game_ends_at stays NULL until ingestion has recorded every game of the week final, so he stays locked (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no in-game pickups',
  'D2 ceiling − 1 s: the Thursday free agent is still locked for adds');
select pg_temp.ad('D3', 1, 2, 'WC Alpha', null, 'wc-a1', '2026-10-28 07:00:00+00', 3);
select is(
  format('%s|%s|%s', (select r ->> 'week' from r101 where tag = 'D3'), (select r #>> '{drop,lineups}' from r101 where tag = 'D3'), pg_temp.roster_of('wc-a1')),
  '8|[{"slot": "qb:0", "week": 8}]|(none)',
  'D3 AT the ceiling the drop goes through — recorded in week 8 (current since 04:00Z) and clearing ONLY week 8''s slot');
select is(
  format('%s || %s', pg_temp.lu('WC Alpha', 7), pg_temp.lu('WC Alpha', 8)),
  '{"qb:0": "wc-a1", "qb:1": "wc-a2"} | wc-a1,wc-a2 | ["wc-a3"] || {"qb:1": "wc-a2"} | -,wc-a2 | ["wc-a3"]',
  'D4 week 7 (closed by the ceiling, still unscored) keeps WC A One at qb:0 — his points stay with WC Alpha; week 8 is cleared');
select pg_temp.ad('D5', 1, 2, 'WC Alpha', 'wc-fa', 'wc-a2', '2026-10-28 07:00:00+00', 4);
select is(
  format('%s|%s|%s || %s || %s', (select r #>> '{add,game_lock,locked}' from r101 where tag = 'D5'), pg_temp.roster_of('wc-fa'), pg_temp.roster_of('wc-a2'),
         pg_temp.lu('WC Alpha', 7), pg_temp.lu('WC Alpha', 8)),
  'false|WC Alpha|(none) || {"qb:0": "wc-a1", "qb:1": "wc-a2"} | wc-a1,wc-a2 | ["wc-a3"] || {} | -,- | ["wc-a3", "wc-fa"]',
  'D5 AT the ceiling: the Thursday free agent is added (released) and the POSTPONED game''s WC A Two dropped — week 7 keeps him where WC Alpha had him (his pending points stay with that team, Q78); week 8 loses him and gains the add on the bench');
select is(
  format('%s|%s', public.lineup_current_week_internal(pg_temp.lg(2), '2026-10-28 07:00:00+00'), public.lineup_current_week_internal(pg_temp.lg(1), '2026-10-28 07:00:00+00')),
  '7|8',
  'D6 PREMISE — LZ''s calendar ends at week 7, so at the ceiling its current week is STILL 7 (L1''s is 8): the one place 152''s CASE decides alone');
select pg_temp.ad('D7a', 2, 2, 'WC Zulu', null, 'wc-z3', '2026-10-28 06:59:59+00', 5);
select is(
  format('%s || %s', (select r #>> '{drop,lineups}' from r101 where tag = 'D7a'), pg_temp.lu('WC Zulu', 7)),
  '[{"slot": null, "week": 7}] || {"qb:0": "wc-z1", "qb:1": "wc-z2"} | wc-z1,wc-z2 | ["wc-z4"]',
  'D7 LZ at ceiling − 1 s: week 7 is NOT finished — the bye bench player leaves week 7''s bench (unchanged behaviour)');
select pg_temp.ad('D8a', 2, 2, 'WC Zulu', null, 'wc-z1', '2026-10-28 07:00:00+00', 6);
select is(
  format('%s|%s|%s || %s', (select r ->> 'week' from r101 where tag = 'D8a'), (select r #>> '{drop,lineups}' from r101 where tag = 'D8a'),
         pg_temp.roster_of('wc-z1'), pg_temp.lu('WC Zulu', 7)),
  '7|[]|(none) || {"qb:0": "wc-z1", "qb:1": "wc-z2"} | wc-z1,wc-z2 | ["wc-z4"]',
  'D8 LZ AT the ceiling: the Thursday starter who PLAYED is released and dropped — and week 7 KEEPS his start (the ceiling finishes the week for lineups too; the F437 guard holds in a league''s last week)');
select pg_temp.ad('D9a', 2, 2, 'WC Zulu', null, 'wc-z2', '2026-10-28 07:00:01+00', 7);
select is(
  format('%s || %s', (select r #>> '{drop,lineups}' from r101 where tag = 'D9a'), pg_temp.lu('WC Zulu', 7)),
  '[] || {"qb:0": "wc-z1", "qb:1": "wc-z2"} | wc-z1,wc-z2 | ["wc-z4"]',
  'D9 LZ after the ceiling: the POSTPONED game''s player dropped — week 7 keeps him too (no move changes a ceiling-closed week''s lineup; his points pending with WC Zulu)');

select pg_temp.as_user(1);
insert into r101 select 'D10', public.commish_roster_override_internal(
  pg_temp.lg(2), pg_temp.team('WC Zulu'), null, 'wc-z4', null, null, null, pg_temp.act(8), '2026-10-28 07:00:02+00', 'pgtap 101', 'commish_force_add_drop');
select set_config('request.jwt.claims', '', true);
select is(
  format('%s|%s|%s || %s',
         (select count(*) from r101, jsonb_array_elements(r -> 'lineups') l, jsonb_array_elements(l -> 'rows') x where tag = 'D10'),
         coalesce((select r ->> 'vacated_current_slot' from r101 where tag = 'D10'), 'null'),
         pg_temp.roster_of('wc-z4'), pg_temp.lu('WC Zulu', 7)),
  '0|null|(none) || {"qb:0": "wc-z1", "qb:1": "wc-z2"} | wc-z1,wc-z2 | ["wc-z4"]',
  'D10 LZ AT the ceiling, the COMMISSIONER''s force-drop of the played Thursday bench player: no lineup row touched, no current slot vacated — week 7 keeps him (153 §8''s hunk)');

-- ---------------------------------------------------------------------------
-- E. The free-agency window (F424)
-- ---------------------------------------------------------------------------
select is(
  (select jsonb_build_array(w ->> 'free_agency_open', w ->> 'why', (w ->> 'reset_at')::timestamptz) from pg_temp.win(3, '2026-10-28 06:59:59+00') w),
  jsonb_build_array('true', 'open', '2026-10-20 07:00:00+00'::timestamptz),
  'E1 LW1 (daily 10:00 UTC) at ceiling − 1 s: week 7''s end is unrecorded, so the last week end is week 6''s — free agency is open');
select is(
  (select jsonb_build_array(w ->> 'free_agency_open', w ->> 'why', (w ->> 'reset_at')::timestamptz, w ->> 'reset_kind', (w ->> 'next_run_at')::timestamptz)
   from pg_temp.win(3, '2026-10-28 07:00:00+00') w),
  jsonb_build_array('false', 'awaiting_run', '2026-10-28 07:00:00+00'::timestamptz, 'week_end', '2026-10-28 10:00:00+00'::timestamptz),
  'E2 F424 — AT the ceiling the week ENDS for the window: claims only until the next run (10:00Z), although no game-final stamp exists');
select is(pg_temp.win(3, '2026-10-28 10:00:00+00') ->> 'why', 'open',
  'E3 LW1 AT its next run after the ceiling: free agency opens again');
select is(
  (select jsonb_build_array(w ->> 'free_agency_open', (w ->> 'reset_at')::timestamptz, (w ->> 'last_run_at')::timestamptz)
   from pg_temp.win(4, '2026-10-28 07:00:00+00') w),
  jsonb_build_array('true', '2026-10-28 07:00:00+00'::timestamptz, '2026-10-28 07:00:00+00'::timestamptz),
  'E4 LW2 (league 2: one run Wednesday 00:00 Pacific) AT the ceiling: its run AT the week''s end counts — "waivers run on schedule" (Q78) — and free agency follows it');
update nfl_weeks set last_game_ends_at = '2026-10-27 07:00:00+00' where season = 2026 and week = 7;
select is(
  (select jsonb_build_array(w ->> 'free_agency_open', (w ->> 'reset_at')::timestamptz) from pg_temp.win(3, '2026-10-28 07:00:00+00') w),
  jsonb_build_array('true', '2026-10-27 07:00:00+00'::timestamptz),
  'E5 CONTROL — week 7 recorded ending at its FLOOR: the window''s week end is that stamp; the ceiling a day later closes nothing again (Tuesday''s 10:00Z run already reopened it)');
update nfl_weeks set last_game_ends_at = null where season = 2026 and week = 7;

-- ---------------------------------------------------------------------------
-- F. The waiver run AT the ceiling (LW3: tracked, due Wed 00:00 PDT)
-- ---------------------------------------------------------------------------
insert into waiver_claims (id, league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order, action_id, created_by) values
 ('d1530000-0000-4000-8000-000000000001', pg_temp.lg(5), pg_temp.team('WC Foxtrot'), 'wc-x1', 'wc-f1', 7, 1, pg_temp.act(21), '91530000-0000-4000-8000-000000000002');
insert into r101 select 'F1', public.waiver_tick('2026-10-28 06:59:59+00', pg_temp.lg(5));
select is(
  format('%s|%s', jsonb_array_length((select r -> 'settled' from r101 where tag = 'F1')),
         (select status from waiver_claims where id = 'd1530000-0000-4000-8000-000000000001')),
  '0|pending',
  'F1 ceiling − 1 s: the run is not due — nothing settles (and WC X One is still locked: B8)');
insert into r101 select 'F2', public.waiver_tick('2026-10-28 07:00:00+00', pg_temp.lg(5));
select is(
  format('%s|%s|%s|%s|%s', jsonb_array_length((select r -> 'settled' from r101 where tag = 'F2')),
         (select format('%s:%s', c.status, coalesce(c.result_reason, '-')) from waiver_claims c where c.id = 'd1530000-0000-4000-8000-000000000001'),
         pg_temp.roster_of('wc-x1'), pg_temp.roster_of('wc-f1'),
         (select faab_balance from league_members where team_id = pg_temp.team('WC Foxtrot'))),
  '1|won:-|WC Foxtrot|(none)|93',
  'F2 AT the ceiling the scheduled run SETTLES and the claim on the Thursday player is WON — the lock is read at the run''s instant, and the ceiling released him (Q74 / Q78)');
select is(
  format('%s || %s || %s', pg_temp.lu('WC Foxtrot', 7), pg_temp.lu('WC Foxtrot', 8),
         (select waiver_next_run_at from leagues where id = pg_temp.lg(5))),
  '{"qb:0": "wc-f1"} | wc-f1,- | ["wc-f2"] || {} | -,- | ["wc-f2", "wc-x1"] || 2026-11-04 08:00:00+00',
  'F3 week 7 keeps WC F One''s start (the claim''s drop); week 8 loses him and benches WC X One; the next run is Wed 00:00 PST (08:00Z)');

-- F4: the same run in a league whose LAST week is 7 (LZW) — 153 §9's hunk.
insert into waiver_claims (id, league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order, action_id, created_by) values
 ('d1530000-0000-4000-8000-000000000002', pg_temp.lg(7), pg_temp.team('WC Yankee'), 'wc-y9', 'wc-y1', 3, 1, pg_temp.act(22), '91530000-0000-4000-8000-000000000002');
insert into r101 select 'F4', public.waiver_tick('2026-10-28 07:00:00+00', pg_temp.lg(7));
select is(
  format('%s|%s|%s || %s', public.lineup_current_week_internal(pg_temp.lg(7), '2026-10-28 07:00:00+00'),
         (select format('%s:%s', c.status, coalesce(c.result_reason, '-')) from waiver_claims c where c.id = 'd1530000-0000-4000-8000-000000000002'),
         pg_temp.roster_of('wc-y1'), pg_temp.lu('WC Yankee', 7)),
  '7|won:-|(none) || {"qb:0": "wc-y1"} | wc-y1,- | ["wc-y2"]',
  'F4 LZW (last week 7, still current at the ceiling): the run AT the ceiling drops WC Y One (played Sunday) and week 7 KEEPS his start — nothing lands in a ceiling-closed week');

-- ---------------------------------------------------------------------------
-- G. R1202 — a DEFERRED trade releases at the ceiling and starts at week 8
-- ---------------------------------------------------------------------------
select pg_temp.as_user(2);
insert into r101 select 'G0', public.trade_propose_internal(pg_temp.lg(6), pg_temp.team('WC Tango'), pg_temp.team('WC Uniform'),
  jsonb_build_array(jsonb_build_object('player_id', 'wc-t1', 'from_team_id', pg_temp.team('WC Tango')),
                    jsonb_build_object('player_id', 'wc-u1', 'from_team_id', pg_temp.team('WC Uniform'))),
  null, null, pg_temp.act(31), '2026-10-26 12:00:00+00', null);
select pg_temp.as_user(3);
insert into r101 select 'G1', public.trade_respond_internal(pg_temp.lg(6), (select (r #>> '{trade,id}')::uuid from r101 where tag = 'G0'),
  'accept', null, null, null, pg_temp.act(32), '2026-10-27 10:00:00+00', null);
select set_config('request.jwt.claims', '', true);
create function pg_temp.g_trade() returns uuid language sql as $$ select (r #>> '{trade,id}')::uuid from r101 where tag = 'G0' $$;
select is(
  (select format('%s|%s|%s', r #>> '{execution,outcome}', r #>> '{execution,execute_after}', (select t.execute_after from trades t where t.id = pg_temp.g_trade()))
   from r101 where tag = 'G1'),
  'deferred|infinity|infinity',
  'G1 PREMISE (151): accepted Tuesday 10:00Z while WC T One (played Thursday) is locked and week 7''s end is unrecorded — parked at execute_after = ''infinity'', re-read every minute');
insert into r101 select 'G2', public.trade_tick('2026-10-28 06:59:59+00', pg_temp.lg(6));
select is(
  format('%s|%s|%s || %s / %s', (select r ->> 'executed' from r101 where tag = 'G2'), (select r ->> 'deferred' from r101 where tag = 'G2'),
         (select t.status from trades t where t.id = pg_temp.g_trade()), pg_temp.roster_of('wc-t1'), pg_temp.roster_of('wc-u1')),
  '0|1|accepted || WC Tango / WC Uniform',
  'G2 the tick at ceiling − 1 s re-reads it and parks it again — nothing moves');
insert into r101 select 'G3', public.trade_tick('2026-10-28 07:00:00+00', pg_temp.lg(6));
select is(
  format('%s|%s|%s || %s / %s', (select r ->> 'executed' from r101 where tag = 'G3'), (select r #>> '{actions,0,via}' from r101 where tag = 'G3'),
         (select t.status from trades t where t.id = pg_temp.g_trade()), pg_temp.roster_of('wc-t1'), pg_temp.roster_of('wc-u1')),
  '1|deferred_release|complete || WC Uniform / WC Tango',
  'G3 R1202: AT the ceiling the tick EXECUTES the deferred trade — both players move together');
select is(
  format('%s || %s', pg_temp.lu('WC Tango', 7), pg_temp.lu('WC Uniform', 7)),
  '{"qb:0": "wc-t1"} | wc-t1,- | ["wc-t2"] || {"qb:0": "wc-u1"} | wc-u1,- | ["wc-u2"]',
  'G4 week 7 is untouched on both sides — WC T One''s played start stays with WC Tango (Q75: "can be started by their current teams")');
select is(
  format('%s || %s', pg_temp.lu('WC Tango', 8), pg_temp.lu('WC Uniform', 8)),
  '{} | -,- | ["wc-t2", "wc-u1"] || {} | -,- | ["wc-t1", "wc-u2"]',
  'G5 the move starts at week 8: each player leaves his old team''s week-8 slot and joins his new team''s week-8 bench');
select is(
  (select count(*)::int from transactions x where x.league_id = pg_temp.lg(6) and x.type = 'trade' and x.status = 'complete'),
  1,
  'G6 exactly one completed trade transaction');

-- G7: the same deferred trade in a league whose LAST week is 7 (LZT) — 153 §10's hunk.
select pg_temp.as_user(2);
insert into r101 select 'G7p', public.trade_propose_internal(pg_temp.lg(8), pg_temp.team('WC Victor'), pg_temp.team('WC Whiskey'),
  jsonb_build_array(jsonb_build_object('player_id', 'wc-v1', 'from_team_id', pg_temp.team('WC Victor')),
                    jsonb_build_object('player_id', 'wc-w1', 'from_team_id', pg_temp.team('WC Whiskey'))),
  null, null, pg_temp.act(33), '2026-10-26 12:00:00+00', null);
select pg_temp.as_user(3);
insert into r101 select 'G7a', public.trade_respond_internal(pg_temp.lg(8), (select (r #>> '{trade,id}')::uuid from r101 where tag = 'G7p'),
  'accept', null, null, null, pg_temp.act(34), '2026-10-27 10:00:00+00', null);
select set_config('request.jwt.claims', '', true);
insert into r101 select 'G7t', public.trade_tick('2026-10-28 07:00:00+00', pg_temp.lg(8));
select is(
  format('%s|%s|%s || %s / %s || %s || %s', (select r #>> '{execution,outcome}' from r101 where tag = 'G7a'), (select r ->> 'executed' from r101 where tag = 'G7t'),
         public.lineup_current_week_internal(pg_temp.lg(8), '2026-10-28 07:00:00+00'),
         pg_temp.roster_of('wc-v1'), pg_temp.roster_of('wc-w1'), pg_temp.lu('WC Victor', 7), pg_temp.lu('WC Whiskey', 7)),
  'deferred|1|7 || WC Whiskey / WC Victor || {"qb:0": "wc-v1"} | wc-v1,- | ["wc-v2"] || {"qb:0": "wc-w1"} | wc-w1,- | ["wc-w2"]',
  'G7 LZT (last week 7): the deferred trade executes AT the ceiling and both week-7 lineups stay as played — WC V One''s start stays with WC Victor');

-- ---------------------------------------------------------------------------
-- H. TD15 / D404 — the ceiling releases LOCKS only: nothing is stamped, the
--    week is not advanced
-- ---------------------------------------------------------------------------
-- (F4's transition guard: upcoming → live → correction_window → final, one step at a time.)
update league_weeks set status = 'live'              where league_id = pg_temp.lg(1) and week <= 7;
update league_weeks set status = 'correction_window' where league_id = pg_temp.lg(1) and week <= 6;
update league_weeks set status = 'final'             where league_id = pg_temp.lg(1) and week <= 6;
select set_config('pgtap.h', public.league_week_advance('2026-10-28 08:00:00+00', pg_temp.lg(1))::text, true);
select is(
  format('%s|%s|%s',
         coalesce((select last_game_ends_at::text from nfl_weeks where season = 2026 and week = 7), 'null'),
         (select status from league_weeks where league_id = pg_temp.lg(1) and week = 7),
         (select status from league_weeks where league_id = pg_temp.lg(1) and week = 8)),
  'null|live|live',
  'H1 an hour past the ceiling: week 7''s last_game_ends_at is still NULL (nothing stamped it) and the league''s week 7 stays LIVE — advance, finalization and scoring still wait for the games (its unplayed cells pending); week 8 opened on its own start');

select * from finish();
rollback;
