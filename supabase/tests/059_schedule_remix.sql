-- ============================================================================
-- Remix + manual matchup edit — migration 111 (task L.D1.3; spec v2.16.14
-- §11.7 Remix (commissioner action) / E41 / §12.8 / §12.17 / §8.7–§8.8 D97
-- posts; tasks-M4 §4 standing rules 9–11; D289 / D290 / D291; ledger F40
-- (grows), F222(a)/(b) (land here); D307; R728 dispositioned).
--
-- Numbering: pgTAP head measured 058 at task time (ls supabase/tests/ |
-- tail -1) ⇒ 059, the tasks-M4 §7 reservation confirmed, not inherited
-- (D161/D166).
--
-- Falsifiability notes (tasks-M1 §4.3, carried by tasks-M4 §4 rule 9):
--   * EVERY GOLDEN IS A STORED LITERAL. The L8 fixture (8 teams, deterministic
--     ids, names 'SR T1'..'SR T8', second_opponent ON, stored seed 20260902)
--     regenerated with seed 777 changes exactly 192 of its 224 team-week
--     pairings, and the first diff line reads 'Week 1: SR T1 now plays SR T6
--     instead of SR T3' — both measured on the stack and pinned as literals,
--     as is the confirm's system post text. The proposed set and the written
--     rows are pinned ≡ the pure builder (`schedule_build_internal`) over
--     the league's own team ids with the confirmed seed — the
--     one-implementation pin (D289): preview, confirm and 110's writer are
--     the same generator.
--   * PREVIEW IS WRITE-FREE, MEASURED: md5 over the raw row text of every
--     table a remix could touch (matchups, league_weeks, leagues, league_chat,
--     schedule_actions) before and after the preview calls — a preview that
--     wrote anything anywhere in those tables reds the cell.
--   * E41 AT THE BOUNDARY, BOTH SIDES, EVERY ARM (D146's one-unit rule
--     applied to the DATUM, not the clock — the verbs read now(), which is
--     FROZEN inside this txn, so `kickoff_at = now() ± 1s` is exactly
--     kickoff−1s / kickoff+1s; `= now()` is AT the kickoff, closed): the
--     nfl_games arm through the RPCs (free confirm without a reason at −1s;
--     refusal by name at +1s and AT; a blank reason refuses; a reason
--     succeeds one unit later), and all three datum arms pinned directly
--     on `schedule_window_internal` with −1s/+1s twins (games → nfl_weeks.
--     first_kickoff_at → starts_at, the conservative order). A MID-SEASON
--     league's window is its OWN first week's kickoff (league Week 1 = NFL
--     week 10 — Q29/D288), pinned with NFL week 1 already kicked off.
--   * SCHEDULED-ONLY, RAW BYTES (R601): a `final` week, a `live` week and a
--     MIXED week (one final row among scheduled ones) are frozen by name in
--     the plan, and their rows survive a post-kickoff Remix BYTE-IDENTICAL —
--     md5 over `m::text` (every column incl. id/created_at/updated_at), not
--     through any serializing client. The DoD break probe (PR body) lets
--     the confirm's DELETE reach a `live` week: this cell reds.
--   * LOUD EMPTINESS (rule 10): an identical seed previews as an EXPLICIT
--     `no_changes = true` with `change_count = 0`; a league whose every
--     regular-season week is frozen is REFUSED by name; a total_points
--     league is refused by name; a no-op matchup edit is refused by name.
--   * REPLAY BY action_id (099/E2): the same action_id returns the stored
--     result byte-identically (text equality), with the post count, the
--     ledger count, the seed and the matchups digest all unchanged — and it
--     wins even when the retry carries a DIFFERENT seed (the action_id
--     identifies the submit). Missing action_id refuses 22023.
--   * THE PERMUTATION (edit): every arm walked — side flip (1 row), one new
--     team (2 rows: the displaced team takes the vacated slot, side named),
--     pairing swap (2 rows, both slots), two new teams from two siblings
--     (3 rows) — and after EVERY edit the week seats every team exactly
--     once across home ∪ away (R703's cross-side shape) with ZERO rows left
--     on the parking game type. Refusals by name: foreign team (F222(a)),
--     retired team, self, bye, no-op, live matchup, live sibling, non-
--     upcoming week, playoff row, E40 (a regular pairing that duplicates
--     the week's secondary pairing), a parked game type already in use.
--   * ROLES: preview/confirm/edit refuse a manager, an outsider, another
--     league's commissioner and anon with ONE no-leak 42501; the ledger has
--     no client read or write path for any role (INSERT 42501; UPDATE/
--     DELETE RETURNING 0 preceded by a same-role SELECT-sees-0 pin while
--     postgres sees the rows — §4.2).
--   * R728: seeds 0, 1 and 2^31−1 alias to one LCG state (build(2147483647)
--     = build(1) = build(0)), pinned beside 058's 0 ≠ 2147483646; the
--     accepted seed space is [0, 2^31−1] with one-unit twins at both ends.
--   * HELD LOCK: the min RTT over three confirms on a warm stack < 50 ms
--     (rule 8 — min, not mean, so a GC pause cannot red the cell).
--   * All privileged-context work (fixtures, calendar, boundary edits)
--     runs as postgres BEFORE the role switches; set_config(..., true)
--     persists to txn end (D49(7)); every role switch is explicit.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(132);

-- ---------------------------------------------------------------------------
-- A. Form pins — the ledger, the five functions, grants (§4.1)
-- ---------------------------------------------------------------------------
select has_table('public', 'schedule_actions', 'schedule_actions exists');
select columns_are('public', 'schedule_actions',
  array['id', 'league_id', 'action_id', 'kind', 'actor_id', 'result', 'created_at'],
  'schedule_actions: exactly the ledger columns (no reason, no before/after — those are commissioner_actions'', M6)');
select col_not_null('public', 'schedule_actions', 'action_id', 'action_id NOT NULL');
select col_not_null('public', 'schedule_actions', 'kind', 'kind NOT NULL');
select col_not_null('public', 'schedule_actions', 'actor_id', 'actor_id NOT NULL');
select col_not_null('public', 'schedule_actions', 'result', 'result NOT NULL');
select fk_ok('public', 'schedule_actions', 'league_id', 'public', 'leagues', 'id', 'schedule_actions.league_id → leagues');
select fk_ok('public', 'schedule_actions', 'actor_id', 'public', 'profiles', 'id', 'schedule_actions.actor_id → profiles');
select ok(
  exists (select 1 from pg_constraint c join pg_class r on r.oid = c.conrelid
          where r.relname = 'schedule_actions' and c.contype = 'u'
            and (select array_agg(a.attname::text order by a.attnum)
                 from unnest(c.conkey) k join pg_attribute a on a.attrelid = r.oid and a.attnum = k)
                = array['league_id', 'action_id']),
  'UNIQUE (league_id, action_id) — the replay race backstop');
select is(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'schedule_actions'),
  true, 'RLS enabled on schedule_actions');
select policies_are('public', 'schedule_actions', array[]::text[],
  'schedule_actions: ZERO policies — the DEFINER RPCs are its only readers and writers (the 109 score_fanout shape)');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('schedule_window_internal', 'schedule_remix_plan_internal',
                       'schedule_preview', 'schedule_remix_confirm', 'schedule_edit_matchup')),
  5, 'the five 111 functions exist (window / plan / preview / confirm / edit)');
select ok(
  (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('schedule_preview', 'schedule_remix_confirm', 'schedule_edit_matchup')),
  'the three RPCs are SECURITY DEFINER with search_path='''' (rule 2)');
select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('schedule_window_internal', 'schedule_remix_plan_internal')),
  'the two helpers are PLAIN with search_path='''' — reachable only through the DEFINER RPCs');
select ok(
  not has_function_privilege('anon', 'public.schedule_preview(uuid,bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.schedule_remix_confirm(uuid,bigint,text,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.schedule_edit_matchup(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'anon holds no EXECUTE on the three RPCs (REVOKE FROM PUBLIC, anon)');
select ok(
  has_function_privilege('authenticated', 'public.schedule_preview(uuid,bigint)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.schedule_remix_confirm(uuid,bigint,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.schedule_edit_matchup(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'authenticated may EXECUTE the three RPCs — the commish check is IN-BODY');
select ok(
  not has_function_privilege('anon', 'public.schedule_window_internal(integer,integer,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.schedule_window_internal(integer,integer,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.schedule_remix_plan_internal(uuid,bigint,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.schedule_remix_plan_internal(uuid,bigint,timestamptz)', 'EXECUTE'),
  'the two helpers are triple-REVOKEd (no client caller exists or will)');

-- ---------------------------------------------------------------------------
-- B. R728 — the seed aliases, said and pinned
-- ---------------------------------------------------------------------------
create temp table sr_ids on commit drop as
select array_agg(('c2000000-0000-4000-8000-0008000000' || lpad(i::text, 2, '0'))::uuid order by i) as ids
from generate_series(1, 8) i;
select is(
  (select string_agg(b::text, ',' order by b.week, b.round_type, b.home_team_id)
   from sr_ids, public.schedule_build_internal(ids, 2147483647, 1, 14, true) b),
  (select string_agg(b::text, ',' order by b.week, b.round_type, b.home_team_id)
   from sr_ids, public.schedule_build_internal(ids, 1, 1, 14, true) b),
  'R728: build(2147483647) = build(1) — 2^31−1 folds to 0 → 1; the catalog''s own max aliases seed 1');
select is(
  (select string_agg(b::text, ',' order by b.week, b.round_type, b.home_team_id)
   from sr_ids, public.schedule_build_internal(ids, 0, 1, 14, true) b),
  (select string_agg(b::text, ',' order by b.week, b.round_type, b.home_team_id)
   from sr_ids, public.schedule_build_internal(ids, 1, 1, 14, true) b),
  'R728: build(0) = build(1) — the third member of the alias class');
select isnt(
  (select string_agg(b::text, ',' order by b.week, b.round_type, b.home_team_id)
   from sr_ids, public.schedule_build_internal(ids, 2147483646, 1, 14, true) b),
  (select string_agg(b::text, ',' order by b.week, b.round_type, b.home_team_id)
   from sr_ids, public.schedule_build_internal(ids, 1, 1, 14, true) b),
  'R728: build(2147483646) ≠ build(1) — the one-unit neighbour is its own state');

-- ---------------------------------------------------------------------------
-- C. Fixtures (postgres context — before any JWT claims)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('92000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-sr' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'sr_user' || i)::jsonb, now(), now()
from generate_series(1, 4) i;
-- u01 = commissioner/owner of L8, L8b, LT, LS; u02 = manager in L8; u03 = an
-- OUTSIDER (member of nothing); u04 = commissioner of L2 only.

-- The 2026 calendar this file's goldens are written against (058's R724
-- shape): re-asserted from 039's literals inside this rolled-back txn.
update nfl_weeks w
set starts_at = v.starts_at, first_kickoff_at = null, last_game_ends_at = null
from (values
  (1, '2026-09-09 00:00:00-04'::timestamptz), (2, '2026-09-16 00:00:00-04'), (3, '2026-09-23 00:00:00-04'),
  (4, '2026-09-30 00:00:00-04'), (5, '2026-10-07 00:00:00-04'), (6, '2026-10-14 00:00:00-04'),
  (7, '2026-10-21 00:00:00-04'), (8, '2026-10-28 00:00:00-04'), (9, '2026-11-04 00:00:00-05'),
  (10, '2026-11-11 00:00:00-05'), (11, '2026-11-18 00:00:00-05'), (12, '2026-11-25 00:00:00-05'),
  (13, '2026-12-02 00:00:00-05'), (14, '2026-12-09 00:00:00-05'), (15, '2026-12-16 00:00:00-05'),
  (16, '2026-12-23 00:00:00-05'), (17, '2026-12-30 00:00:00-05'), (18, '2027-01-06 00:00:00-05')
) as v(week, starts_at)
where w.season = 2026 and w.week = v.week;
delete from nfl_games where season = 2026;

-- L8 (b2…08): 8 teams, second_opponent ON, stored seed — the literal goldens.
-- L8b (b2…09): 8 teams, second_opponent OFF — the edit permutation cases.
-- L2 (b2…10): 8 teams, commish u04, generated MID-SEASON (first week 10).
-- LT (b2…11): total_points. LS (b2…12): still `scheduled` (no schedule).
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot, settings)
select ('b2000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       (case when n = 10 then '92000000-0000-4000-8000-000000000004' else '92000000-0000-4000-8000-000000000001' end)::uuid,
       'pgtap-sr-L' || n, 2026,
       case when n = 12 then 'scheduled' else 'in_season' end, 8,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       case n
         when 8  then '{"second_opponent": true, "schedule_seed": 20260902}'::jsonb
         when 9  then '{"second_opponent": false, "schedule_seed": 20260902}'::jsonb
         when 10 then '{"second_opponent": false, "schedule_seed": 5}'::jsonb
         when 11 then '{"schedule_mode": "total_points", "schedule_seed": 1}'::jsonb
         else '{}'::jsonb end
from unnest(array[8, 9, 10, 11, 12]) n;
insert into teams (id, owner_id, name, league_id)
select ('c2000000-0000-4000-8000-00' || lpad(n::text, 2, '0') || '000000' || lpad(i::text, 2, '0'))::uuid,
       (case when n = 10 then '92000000-0000-4000-8000-000000000004' else '92000000-0000-4000-8000-000000000001' end)::uuid,
       'SR T' || i,
       ('b2000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
from unnest(array[8, 9, 10, 11, 12]) n, generate_series(1, 8) i;
insert into league_members (league_id, user_id, team_id, role) values
  ('b2000000-0000-4000-8000-000000000008', '92000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000800000001', 'commissioner'),
  ('b2000000-0000-4000-8000-000000000008', '92000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000800000002', 'manager'),
  ('b2000000-0000-4000-8000-000000000009', '92000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000900000001', 'commissioner'),
  ('b2000000-0000-4000-8000-000000000010', '92000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-001000000001', 'commissioner'),
  ('b2000000-0000-4000-8000-000000000011', '92000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-001100000001', 'commissioner'),
  ('b2000000-0000-4000-8000-000000000012', '92000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-001200000001', 'commissioner');

-- Generate: L8/L8b/LT pre-season (week 1); L2 at a week-10 instant
-- (D306(3): [starts_at(9), starts_at(10)) under the starts_at arm).
select results_eq(
  $$ select n, (r ->> 'first_week')::int, (r ->> 'matchups')::int, r ->> 'matchups_reason'
     from unnest(array[8, 9, 11]) n,
     lateral public.league_generate_schedule(('b2000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
                                             '2026-09-08 12:00:00-04') r
     order by n $$,
  $$ values (8, 1, 112, null), (9, 1, 56, null), (11, 1, 0, 'total_points') $$,
  'fixtures generated: L8 112 rows (second on), L8b 56, LT zero BY NAME');
select results_eq(
  $$ select (r ->> 'first_week')::int, (r ->> 'regular_season_weeks')::int, (r ->> 'matchups')::int
     from public.league_generate_schedule('b2000000-0000-4000-8000-000000000010', '2026-11-05 12:00:00-05') r $$,
  $$ values (10, 6, 24) $$,
  'L2 generated mid-season: first week 10, 6 regular weeks, 24 rows (its league Week 1 is NFL week 10)');

-- The free window: NFL week 1's first kickoff one second AHEAD (now() is
-- frozen inside this txn — kickoff−1s exactly).
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
  ('sr-w1-a', 2026, 1, 'KC', 'BUF', now() + interval '1 second'),
  ('sr-w1-b', 2026, 1, 'DAL', 'PHI', now() + interval '3 hours');   -- a later game never decides

-- Digests of every table a preview could touch, BEFORE (write-free pin).
create function pg_temp.sr_digest() returns text language sql as $$
  select md5(
    coalesce((select string_agg(m::text, ',' order by m.id) from public.matchups m), '') || '|' ||
    coalesce((select string_agg(w::text, ',' order by w.id) from public.league_weeks w), '') || '|' ||
    coalesce((select string_agg(l::text, ',' order by l.id) from public.leagues l), '') || '|' ||
    coalesce((select string_agg(c::text, ',' order by c.id) from public.league_chat c), '') || '|' ||
    coalesce((select string_agg(a::text, ',' order by a.id) from public.schedule_actions a), ''))
$$;
select set_config('pgtap.sr_before', pg_temp.sr_digest(), true);

-- ---------------------------------------------------------------------------
-- D. Preview — pure, commish-only, the literal goldens (as u01)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select throws_ok(
  $$ select public.schedule_preview('b2000000-0000-4000-8000-000000000008', -1) $$,
  '22023', null, 'seed −1 refuses 22023 (below the seed space)');
select throws_ok(
  $$ select public.schedule_preview('b2000000-0000-4000-8000-000000000008', 2147483648) $$,
  '22023', null, 'seed 2^31 refuses 22023 (above the seed space)');
select lives_ok(
  $$ select public.schedule_preview('b2000000-0000-4000-8000-000000000008', 0) $$,
  'seed 0 lives — the lower edge (one unit from −1)');
select lives_ok(
  $$ select public.schedule_preview('b2000000-0000-4000-8000-000000000008', 2147483647) $$,
  'seed 2^31−1 lives — the upper edge (one unit from 2^31; the alias is accepted, R728 decided)');
select throws_ok(
  $$ select public.schedule_preview('b2000000-0000-4000-8000-000000000012', 777) $$,
  'P0001', null, 'a `scheduled` league (no schedule yet) refuses by name — remix is in_season only');
select throws_like(
  $$ select public.schedule_preview('b2000000-0000-4000-8000-000000000011', 777) $$,
  '%total_points%', 'a total_points league refuses BY NAME — it has no matchups to remix');

select set_config('pgtap.sr_p777',
  public.schedule_preview('b2000000-0000-4000-8000-000000000008', 777)::text, true);
select results_eq(
  $$ select (p ->> 'change_count')::int, (p ->> 'no_changes')::boolean,
            (p ->> 'matchups_regenerable')::int, (p ->> 'matchups_current')::int,
            (p -> 'window' ->> 'free')::boolean, p -> 'window' ->> 'datum_arm',
            (p -> 'window' ->> 'reason_required')::boolean,
            p -> 'weeks_regenerable', p -> 'weeks_frozen',
            jsonb_array_length(p -> 'proposed'), (p ->> 'first_week')::int, (p ->> 'current_seed')::bigint
     from (select current_setting('pgtap.sr_p777')::jsonb as p) q_sr_p777 $$,
  $$ values (192, false, 112, 112, true, 'nfl_games', false,
             '[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]'::jsonb, '[]'::jsonb, 112, 1, 20260902::bigint) $$,
  'PREVIEW(L8, 777) — the golden: 192 of 224 team-week pairings change, all 14 weeks regenerable, 112 rows, the window free on the nfl_games arm, no reason required');
select is(
  (select p -> 'diff' -> 0 ->> 'text' from (select current_setting('pgtap.sr_p777')::jsonb as p) q_sr_p777),
  'Week 1: SR T1 now plays SR T6 instead of SR T3',
  'the first human-diff line is the stored literal (§11.7 "Week 3: you now play Team D instead of Team B")');
select is(
  (select count(*)::int from (select current_setting('pgtap.sr_p777')::jsonb as p) q_sr_p777, jsonb_array_elements(p -> 'diff') d
   where d ->> 'text' like 'Week % now plays % instead of %' or d ->> 'text' like 'Week % now hosts %' or d ->> 'text' like 'Week % now visits %'),
  192, 'every diff row carries a human line of one of the two shapes (opponent changed / side changed)');
select is(
  (select bool_and((e ->> 'regenerated')::boolean) from (select current_setting('pgtap.sr_p777')::jsonb as p) q_sr_p777, jsonb_array_elements(p -> 'proposed') e),
  true, 'pre-kickoff: every proposed row is tagged regenerated (no frozen weeks)');

select results_eq(
  $$ select (p ->> 'change_count')::int, (p ->> 'no_changes')::boolean, p -> 'diff'
     from public.schedule_preview('b2000000-0000-4000-8000-000000000008', 20260902) p $$,
  $$ values (0, true, '[]'::jsonb) $$,
  'PREVIEW with the CURRENT seed is an EXPLICIT no_changes = true / change_count 0 — never an empty array mistaken for success (rule 10)');

reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.sr_digest(), current_setting('pgtap.sr_before'),
  'PREVIEW IS WRITE-FREE: matchups / league_weeks / leagues / league_chat / schedule_actions byte-identical across six preview calls');
select is(
  (select string_agg((e ->> 'week') || '|' || (e ->> 'round_type') || '|' || (e ->> 'home_team_id') || '|' || (e ->> 'away_team_id'), ','
                     order by (e ->> 'week')::int, e ->> 'round_type', e ->> 'home_team_id')
   from (select current_setting('pgtap.sr_p777')::jsonb as p) q_sr_p777, jsonb_array_elements(p -> 'proposed') e),
  (select string_agg(b.week || '|' || b.round_type || '|' || b.home_team_id || '|' || b.away_team_id, ','
                     order by b.week, b.round_type, b.home_team_id)
   from public.schedule_build_internal(
          (select array_agg(t.id) from teams t where t.league_id = 'b2000000-0000-4000-8000-000000000008'),
          777, 1, 14, true) b),
  'ONE IMPLEMENTATION: the previewed set ≡ the pure builder over the league''s own team ids with seed 777');

-- Roles: manager, outsider, another league's commissioner, anon — one no-leak 42501.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok($$ select public.schedule_preview('b2000000-0000-4000-8000-000000000008', 777) $$,
  '42501', null, 'a MANAGER (member, not commish) cannot preview — 42501');
select throws_ok($$ select public.schedule_remix_confirm('b2000000-0000-4000-8000-000000000008', 777, null, 'a0000000-0000-4000-8000-0000000000e1') $$,
  '42501', null, 'a MANAGER cannot confirm — 42501');
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok($$ select public.schedule_preview('b2000000-0000-4000-8000-000000000008', 777) $$,
  '42501', null, 'an OUTSIDER cannot preview — 42501 (no leak: same code as non-commish)');
select throws_ok($$ select public.schedule_preview('00000000-0000-4000-8000-00000000dead', 777) $$,
  '42501', null, 'a NONEXISTENT league previews as 42501 — no leak');
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok($$ select public.schedule_preview('b2000000-0000-4000-8000-000000000008', 777) $$,
  '42501', null, 'ANOTHER league''s commissioner cannot preview L8 — 42501');
select throws_ok($$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-000800000001', 'c2000000-0000-4000-8000-000800000002', null, 'a0000000-0000-4000-8000-0000000000e2') $$,
  '42501', null, 'ANOTHER league''s commissioner cannot edit an L8 matchup — 42501 (the commish gate fires before any matchup lookup: no leak)');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select public.schedule_preview('b2000000-0000-4000-8000-000000000008', 777) $$,
  '42501', null, 'anon cannot preview — 42501 (REVOKE)');
select throws_ok($$ select public.schedule_remix_confirm('b2000000-0000-4000-8000-000000000008', 777, null, 'a0000000-0000-4000-8000-0000000000e3') $$,
  '42501', null, 'anon cannot confirm — 42501 (REVOKE)');
reset role;

-- ---------------------------------------------------------------------------
-- E. Confirm in the FREE window (L8, seed 777, action A1, no reason) + replay
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select throws_ok(
  $$ select public.schedule_remix_confirm('b2000000-0000-4000-8000-000000000008', 777, null, null) $$,
  '22023', null, 'confirm without an action_id refuses 22023 — the idempotency key is required');

select set_config('pgtap.sr_c1',
  public.schedule_remix_confirm('b2000000-0000-4000-8000-000000000008', 777, null,
                                'a0000000-0000-4000-8000-000000000001')::text, true);
select results_eq(
  $$ select (r ->> 'matchups_replaced')::int, (r ->> 'change_count')::int, (r ->> 'no_changes')::boolean,
            (r -> 'window' ->> 'free')::boolean, (r ->> 'reason_required')::boolean,
            (r ->> 'schedule_seed')::bigint, (r ->> 'previous_seed')::bigint,
            r -> 'weeks_regenerated', r -> 'weeks_frozen', r ->> 'action_id', jsonb_array_length(r -> 'diff')
     from (select current_setting('pgtap.sr_c1')::jsonb as r) q_sr_c1 $$,
  $$ values (112, 192, false, true, false, 777::bigint, 20260902::bigint,
             '[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]'::jsonb, '[]'::jsonb,
             'a0000000-0000-4000-8000-000000000001', 192) $$,
  'CONFIRM(L8, 777) in the free window: 112 rows replaced, 192 changes, no reason required, seed 20260902 → 777, every week regenerated');
select is(
  (select r ->> 'system_post' from (select current_setting('pgtap.sr_c1')::jsonb as r) q_sr_c1),
  'Schedule remixed by sr_user1: 14 of 14 regular-season weeks regenerated (weeks 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14), 192 team-week pairings changed.',
  'the system post text is the stored literal (free window: no override clause, no reason)');
select results_eq(
  $$ select count(*)::int, bool_and(is_system), bool_and(context = 'league'),
            bool_and(user_id = '92000000-0000-4000-8000-000000000001'),
            bool_and(message = 'Schedule remixed by sr_user1: 14 of 14 regular-season weeks regenerated (weeks 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14), 192 team-week pairings changed.')
     from league_chat where league_id = 'b2000000-0000-4000-8000-000000000008' $$,
  $$ values (1, true, true, true, true) $$,
  'D97: exactly ONE in-txn system post in LEAGUE chat (is_system, context league, the commissioner as author, the literal text)');

reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select string_agg((m.week, m.round_type, m.home_team_id, m.away_team_id, m.status)::text, ',' order by m.week, m.round_type, m.home_team_id)
   from matchups m where m.league_id = 'b2000000-0000-4000-8000-000000000008'),
  (select string_agg((b.week, b.round_type, b.home_team_id, b.away_team_id, 'scheduled')::text, ',' order by b.week, b.round_type, b.home_team_id)
   from public.schedule_build_internal(
          (select array_agg(t.id) from teams t where t.league_id = 'b2000000-0000-4000-8000-000000000008'),
          777, 1, 14, true) b),
  'ONE IMPLEMENTATION, WRITTEN: L8''s rows ≡ the pure builder with 777, every row born scheduled');
select is((select (settings ->> 'schedule_seed')::bigint from leagues where id = 'b2000000-0000-4000-8000-000000000008'),
  777::bigint, 'RE-MINT: leagues.settings.schedule_seed = the confirmed seed (§11.7 — reproducible from the stored seed)');
select results_eq(
  $$ select count(*)::int, bool_and(kind = 'remix'), bool_and(actor_id = '92000000-0000-4000-8000-000000000001'),
            bool_and(result::text = current_setting('pgtap.sr_c1'))
     from schedule_actions where league_id = 'b2000000-0000-4000-8000-000000000008' $$,
  $$ values (1, true, true, true) $$,
  'the ledger holds exactly one remix row for L8 whose stored result IS the returned jsonb (byte-identical text)');
select is(
  (select count(*)::int from league_weeks where league_id = 'b2000000-0000-4000-8000-000000000008'), 17,
  'league_weeks untouched by a Remix (17 rows — the plan is 110''s; Remix replaces matchups only)');
select set_config('pgtap.sr_after_c1', pg_temp.sr_digest(), true);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  public.schedule_remix_confirm('b2000000-0000-4000-8000-000000000008', 777, null,
                                'a0000000-0000-4000-8000-000000000001')::text,
  current_setting('pgtap.sr_c1'),
  'REPLAY (same action_id, same seed) returns the stored result BYTE-IDENTICALLY');
select is(
  public.schedule_remix_confirm('b2000000-0000-4000-8000-000000000008', 999, 'a retry with a different seed',
                                'a0000000-0000-4000-8000-000000000001')::text,
  current_setting('pgtap.sr_c1'),
  'REPLAY with a DIFFERENT seed still returns the stored result — the action_id identifies the SUBMIT (099/E2)');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.sr_digest(), current_setting('pgtap.sr_after_c1'),
  'the two replays wrote NOTHING: no second regeneration, no second post, no second ledger row, seed unchanged (digest)');
select is((select count(*)::int from league_chat where league_id = 'b2000000-0000-4000-8000-000000000008'), 1,
  '…and the post count is still exactly 1 (counted, not only digested)');
select is((select count(*)::int from schedule_actions), 1, '…and the ledger still holds exactly 1 row');

-- ---------------------------------------------------------------------------
-- F. E41 at the boundary — every arm, both sides (D146 on the datum)
-- ---------------------------------------------------------------------------
-- F1. The datum function directly: three arms × (−1s / +1s) + AT.
select results_eq(
  $$ select w.datum_arm, w.free from public.schedule_window_internal(2026, 1, now()) w $$,
  $$ values ('nfl_games', true) $$,
  'arm 1 (nfl_games): kickoff−1s ⇒ free (the earliest game decides, not the later one)');
update nfl_games set kickoff_at = now() where id = 'sr-w1-a';
select results_eq(
  $$ select w.datum_arm, w.free from public.schedule_window_internal(2026, 1, now()) w $$,
  $$ values ('nfl_games', false) $$,
  'arm 1: AT the kickoff instant ⇒ closed (until = strictly before)');
update nfl_games set kickoff_at = now() - interval '1 second' where id = 'sr-w1-a';
select results_eq(
  $$ select w.datum_arm, w.free from public.schedule_window_internal(2026, 1, now()) w $$,
  $$ values ('nfl_games', false) $$,
  'arm 1: kickoff+1s ⇒ closed');
delete from nfl_games where season = 2026;
update nfl_weeks set first_kickoff_at = now() + interval '1 second' where season = 2026 and week = 1;
select results_eq(
  $$ select w.datum_arm, w.free from public.schedule_window_internal(2026, 1, now()) w $$,
  $$ values ('nfl_weeks.first_kickoff_at', true) $$,
  'arm 2 (nfl_weeks.first_kickoff_at, no game rows): −1s ⇒ free');
update nfl_weeks set first_kickoff_at = now() - interval '1 second' where season = 2026 and week = 1;
select results_eq(
  $$ select w.datum_arm, w.free from public.schedule_window_internal(2026, 1, now()) w $$,
  $$ values ('nfl_weeks.first_kickoff_at', false) $$,
  'arm 2: +1s ⇒ closed');
update nfl_weeks set first_kickoff_at = null, starts_at = now() + interval '1 second' where season = 2026 and week = 1;
select results_eq(
  $$ select w.datum_arm, w.free from public.schedule_window_internal(2026, 1, now()) w $$,
  $$ values ('nfl_weeks.starts_at', true) $$,
  'arm 3 (starts_at — the conservative fallback): −1s ⇒ free');
update nfl_weeks set starts_at = now() - interval '1 second' where season = 2026 and week = 1;
select results_eq(
  $$ select w.datum_arm, w.free from public.schedule_window_internal(2026, 1, now()) w $$,
  $$ values ('nfl_weeks.starts_at', false) $$,
  'arm 3: +1s ⇒ closed (with no game rows the window closes at Wednesday 00:00 ET — earlier than the letter, never later)');
select throws_ok(
  $$ select * from public.schedule_window_internal(2026, 99, now()) $$,
  'P0001', null, 'a week with no nfl_weeks row refuses by name (never a NULL window)');
-- Restore week 1's calendar row; the game row returns at kickoff+1s (post-kickoff from here).
update nfl_weeks set starts_at = '2026-09-09 00:00:00-04', first_kickoff_at = null where season = 2026 and week = 1;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
  ('sr-w1-a', 2026, 1, 'KC', 'BUF', now() - interval '1 second');

-- F2. A MID-SEASON league's window is ITS first week's kickoff (Q29/D288):
-- NFL week 1 has kicked off; L2's league Week 1 is NFL week 10, still ahead.
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
  ('sr-w10-a', 2026, 10, 'KC', 'BUF', now() + interval '1 second');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select results_eq(
  $$ select (p -> 'window' ->> 'free')::boolean, p -> 'window' ->> 'datum_arm', (p ->> 'first_week')::int, p -> 'weeks_regenerable'
     from public.schedule_preview('b2000000-0000-4000-8000-000000000010', 42) p $$,
  $$ values (true, 'nfl_games', 10, '[10, 11, 12, 13, 14, 15]'::jsonb) $$,
  'MID-SEASON (L2, first week 10): the window is free although NFL week 1 kicked off — league Week 1 = NFL week 10 (Q29/D288)');
reset role;
update nfl_games set kickoff_at = now() - interval '1 second' where id = 'sr-w10-a';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select is(
  (select (p -> 'window' ->> 'free')::boolean from public.schedule_preview('b2000000-0000-4000-8000-000000000010', 42) p),
  false, 'MID-SEASON: one second after NFL week 10''s first kickoff the window is closed');
reset role;

-- F3. The reason law through the RPC (L8, post-kickoff on the nfl_games arm).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.schedule_remix_confirm('b2000000-0000-4000-8000-000000000008', 555, null, 'a0000000-0000-4000-8000-000000000002') $$,
  '%requires a reason%', 'post-kickoff confirm with NO reason refuses by name (E41/D290)');
select throws_ok(
  $$ select public.schedule_remix_confirm('b2000000-0000-4000-8000-000000000008', 555, '   ', 'a0000000-0000-4000-8000-000000000002') $$,
  '22023', null, 'post-kickoff confirm with a BLANK reason refuses 22023 (a reason is non-blank)');
select is(
  (select (p -> 'window' ->> 'reason_required')::boolean from public.schedule_preview('b2000000-0000-4000-8000-000000000008', 555) p),
  true, 'the preview says so ahead of time: window.reason_required = true');
select results_eq(
  $$ select (r ->> 'reason_required')::boolean, (r -> 'window' ->> 'free')::boolean, (r ->> 'matchups_replaced')::int,
            r ->> 'system_post' like '%— after Week 1 kickoff (commissioner override) — reason: Bye-week fix%'
     from public.schedule_remix_confirm('b2000000-0000-4000-8000-000000000008', 555, '  Bye-week fix  ',
                                        'a0000000-0000-4000-8000-000000000002') r $$,
  $$ values (true, false, 112, true) $$,
  'post-kickoff confirm WITH a reason succeeds (the one-unit positive): override clause + the trimmed reason in the post');
select is((select count(*)::int from league_chat where league_id = 'b2000000-0000-4000-8000-000000000008'
           and message like '%commissioner override) — reason: Bye-week fix'), 1,
  'the override post landed in league chat with the reason (the one place it lives until M6 — D290)');
reset role;

-- ---------------------------------------------------------------------------
-- G. Scheduled-only — a final week, a live week and a mixed week survive a
--    post-kickoff Remix BYTE-IDENTICAL (raw row text, R601)
-- ---------------------------------------------------------------------------
-- Week 2 → final (legal F4 steps), its rows final with scores; week 3 → live,
-- its rows live; week 4 MIXED — one final row among scheduled ones.
update league_weeks set status = 'live' where league_id = 'b2000000-0000-4000-8000-000000000008' and week in (2, 3);
update league_weeks set status = 'correction_window' where league_id = 'b2000000-0000-4000-8000-000000000008' and week = 2;
update league_weeks set status = 'final' where league_id = 'b2000000-0000-4000-8000-000000000008' and week = 2;
update matchups set status = 'final', home_score = 101.5, away_score = 88.25, result = 'home'
where league_id = 'b2000000-0000-4000-8000-000000000008' and week = 2;
update matchups set status = 'live' where league_id = 'b2000000-0000-4000-8000-000000000008' and week = 3;
update matchups set status = 'final', home_score = 70, away_score = 71, result = 'away'
where id = (select id from matchups where league_id = 'b2000000-0000-4000-8000-000000000008' and week = 4 and round_type = 'regular' order by home_team_id limit 1);
select set_config('pgtap.sr_frozen',
  (select md5(string_agg(m::text, ',' order by m.id)) from matchups m
   where m.league_id = 'b2000000-0000-4000-8000-000000000008' and m.week in (2, 3, 4)), true);
select is((select count(*)::int from matchups where league_id = 'b2000000-0000-4000-8000-000000000008' and week in (2, 3, 4)), 24,
  'PREMISE: the three frozen weeks hold 24 rows (3 × 4 pairings × 2 game types)');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select results_eq(
  $$ select p -> 'weeks_regenerable', p -> 'weeks_frozen', (p ->> 'matchups_regenerable')::int, (p ->> 'matchups_current')::int
     from public.schedule_preview('b2000000-0000-4000-8000-000000000008', 999) p $$,
  $$ values ('[1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]'::jsonb,
             '[{"week": 2, "reason": "week_final", "week_status": "final"}, {"week": 3, "reason": "week_live", "week_status": "live"}, {"week": 4, "reason": "matchup_not_scheduled", "week_status": "upcoming"}]'::jsonb,
             88, 112) $$,
  'the plan freezes the final week, the live week AND the mixed week BY NAME (reason per week); 88 of 112 rows regenerable');
select is(
  (select count(*)::int from public.schedule_preview('b2000000-0000-4000-8000-000000000008', 999) p, jsonb_array_elements(p -> 'proposed') e
   where (e ->> 'week')::int in (2, 3, 4) and (e ->> 'regenerated')::boolean),
  0, 'no proposed row of a frozen week is tagged regenerated (kept rows are the current rows)');
select results_eq(
  $$ select (r ->> 'matchups_replaced')::int, r -> 'weeks_regenerated', jsonb_array_length(r -> 'weeks_frozen')
     from public.schedule_remix_confirm('b2000000-0000-4000-8000-000000000008', 999, 'a mid-season reshuffle',
                                        'a0000000-0000-4000-8000-000000000003') r $$,
  $$ values (88, '[1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]'::jsonb, 3) $$,
  'CONFIRM post-kickoff replaces exactly the 88 regenerable rows; 3 weeks frozen');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select md5(string_agg(m::text, ',' order by m.id)) from matchups m
   where m.league_id = 'b2000000-0000-4000-8000-000000000008' and m.week in (2, 3, 4)),
  current_setting('pgtap.sr_frozen'),
  'THE FINAL, LIVE AND MIXED WEEKS SURVIVE THE REMIX BYTE-IDENTICAL — raw row text incl. id/scores/updated_at (R601) — the DoD break probe reds THIS cell');
select is(
  (select string_agg((m.week, m.round_type, m.home_team_id, m.away_team_id)::text, ',' order by m.week, m.round_type, m.home_team_id)
   from matchups m where m.league_id = 'b2000000-0000-4000-8000-000000000008' and m.week not in (2, 3, 4)),
  (select string_agg((b.week, b.round_type, b.home_team_id, b.away_team_id)::text, ',' order by b.week, b.round_type, b.home_team_id)
   from public.schedule_build_internal(
          (select array_agg(t.id) from teams t where t.league_id = 'b2000000-0000-4000-8000-000000000008'),
          999, 1, 14, true) b
   where b.week not in (2, 3, 4)),
  'the regenerated weeks ≡ the pure builder with 999 restricted to those weeks (the season is ONE generation; frozen weeks are carved out, not re-numbered)');
select is((select (settings ->> 'schedule_seed')::bigint from leagues where id = 'b2000000-0000-4000-8000-000000000008'),
  999::bigint, 'the seed re-minted to 999');
select is_empty(
  $$ select week, round_type, t, count(*)
     from (select week, round_type, home_team_id t from matchups where league_id = 'b2000000-0000-4000-8000-000000000008'
           union all select week, round_type, away_team_id from matchups where league_id = 'b2000000-0000-4000-8000-000000000008') app
     group by 1, 2, 3 having count(*) <> 1 $$,
  'after the carve-out remix every team still appears exactly once per week per game type, cross-side (R703), in every week');

-- All-frozen ⇒ refused by name (savepoint-scoped).
savepoint g_all_frozen;
update league_weeks set status = 'live'
where league_id = 'b2000000-0000-4000-8000-000000000008' and week in (1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.schedule_remix_confirm('b2000000-0000-4000-8000-000000000008', 4242, 'nothing left', 'a0000000-0000-4000-8000-000000000004') $$,
  '%no regenerable week%', 'every regular-season week frozen ⇒ confirm REFUSES BY NAME (a confirm that replaces nothing is never a silent success)');
select throws_like(
  $$ select public.schedule_remix_confirm('b2000000-0000-4000-8000-000000000011', 4242, 'x', 'a0000000-0000-4000-8000-000000000005') $$,
  '%total_points%', 'a total_points league confirm refuses BY NAME');
reset role;
rollback to savepoint g_all_frozen;

-- ---------------------------------------------------------------------------
-- H. Manual matchup edit — the permutation, the refusals, the law (L8b)
-- ---------------------------------------------------------------------------
-- Free window for the first arm: L8b shares the 2026 calendar; move kickoff
-- ahead again.
update nfl_games set kickoff_at = now() + interval '1 second' where id = 'sr-w1-a';
create temp table sr_w5 on commit drop as
select row_number() over (order by home_team_id) as k, id, home_team_id as h, away_team_id as a
from matchups where league_id = 'b2000000-0000-4000-8000-000000000009' and week = 5 and round_type = 'regular';
create temp table sr_w6 on commit drop as
select row_number() over (order by home_team_id) as k, id, home_team_id as h, away_team_id as a
from matchups where league_id = 'b2000000-0000-4000-8000-000000000009' and week = 6 and round_type = 'regular';
create function pg_temp.sr_once(p_week int) returns int language sql as $$
  select count(*)::int from (
    select t from (select home_team_id t from public.matchups where league_id = 'b2000000-0000-4000-8000-000000000009' and week = p_week and round_type = 'regular'
                   union all
                   select away_team_id from public.matchups where league_id = 'b2000000-0000-4000-8000-000000000009' and week = p_week and round_type = 'regular') x
    group by t having count(*) = 1) y
$$;
grant select on sr_w5, sr_w6 to authenticated;   -- the role-switched cells read the fixture rows
select is((select count(*)::int from sr_w5), 4, 'PREMISE: L8b week 5 holds 4 regular rows');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

-- H1. Side flip (free window, no reason): one row.
select results_eq(
  $$ select (r ->> 'rows_changed')::int, r -> 'siblings', (r ->> 'reason_required')::boolean,
            r ->> 'system_post' like 'Week 5 matchup edited by sr_user1: % vs % (was % vs %).'
     from sr_w5 w, lateral public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000009', w.id, w.a, w.h, null,
                                                         'a0000000-0000-4000-8000-000000000011') r
     where w.k = 1 $$,
  $$ values (1, '[]'::jsonb, false, true) $$,
  'EDIT side flip in the free window, no reason: 1 row, no siblings, the post names before/after');
select is(
  (select (m.home_team_id, m.away_team_id) = (w.a, w.h) from sr_w5 w join public.matchups m on m.id = w.id where w.k = 1),
  true, '…the row is flipped');
select throws_like(
  $$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000009', (select id from sr_w5 where k = 1),
       (select a from sr_w5 where k = 1), (select h from sr_w5 where k = 1), null, 'a0000000-0000-4000-8000-000000000012') $$,
  '%nothing to change%', 'a NO-OP edit (the pairing already as asked) refuses by name (rule 10)');

-- H2. One new team: M1 = (a1, h1) → (a1, a2); M2 = (h2, a2) → (h2, h1).
select results_eq(
  $$ select (r ->> 'rows_changed')::int, jsonb_array_length(r -> 'siblings'),
            (r -> 'siblings' -> 0 ->> 'matchup_id')::uuid = (select id from sr_w5 where k = 2),
            r -> 'siblings' -> 0 -> 'vacated_sides',
            (r -> 'siblings' -> 0 -> 'after' ->> 'home_team_id')::uuid = (select h from sr_w5 where k = 2),
            (r -> 'siblings' -> 0 -> 'after' ->> 'away_team_id')::uuid = (select h from sr_w5 where k = 1)
     from public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000009', (select id from sr_w5 where k = 1),
            (select a from sr_w5 where k = 1), (select a from sr_w5 where k = 2), null,
            'a0000000-0000-4000-8000-000000000013') r $$,
  $$ values (2, 1, true, '["away"]'::jsonb, true, true) $$,
  'EDIT one new team: 2 rows — the displaced team takes the vacated AWAY slot of the sibling');
select is(pg_temp.sr_once(5), 8, '…week 5 seats every team exactly once across home ∪ away (cross-side)');

-- H3. Pairing swap: M3 = (h3, a3) → (h4, a4); M4 → (h3, a3).
select results_eq(
  $$ select (r ->> 'rows_changed')::int, jsonb_array_length(r -> 'siblings'), r -> 'siblings' -> 0 -> 'vacated_sides',
            (r -> 'siblings' -> 0 -> 'after' ->> 'home_team_id')::uuid = (select h from sr_w5 where k = 3),
            (r -> 'siblings' -> 0 -> 'after' ->> 'away_team_id')::uuid = (select a from sr_w5 where k = 3)
     from public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000009', (select id from sr_w5 where k = 3),
            (select h from sr_w5 where k = 4), (select a from sr_w5 where k = 4), null,
            'a0000000-0000-4000-8000-000000000014') r $$,
  $$ values (2, 1, '["home", "away"]'::jsonb, true, true) $$,
  'EDIT pairing swap (both new teams from ONE sibling): 2 rows, both slots of the sibling re-seated');
select is(pg_temp.sr_once(5), 8, '…week 5 still seats every team exactly once');

-- H4. Two new teams from two different siblings (week 6): M1 = (h1, a1) →
-- (a2, h3): h1 → M2's away, a1 → M3's home. 3 rows.
select results_eq(
  $$ select (r ->> 'rows_changed')::int, jsonb_array_length(r -> 'siblings')
     from public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000009', (select id from sr_w6 where k = 1),
            (select a from sr_w6 where k = 2), (select h from sr_w6 where k = 3), null,
            'a0000000-0000-4000-8000-000000000015') r $$,
  $$ values (3, 2) $$,
  'EDIT two new teams from two siblings: 3 rows');
select results_eq(
  $$ select m.id = w.id, m.home_team_id = w.h, m.away_team_id = (select h from sr_w6 where k = 1)
     from sr_w6 w join public.matchups m on m.id = w.id where w.k = 2 $$,
  $$ values (true, true, true) $$,
  '…the first sibling kept its home team and seats the displaced home team at away');
select results_eq(
  $$ select m.home_team_id = (select a from sr_w6 where k = 1), m.away_team_id = w.a
     from sr_w6 w join public.matchups m on m.id = w.id where w.k = 3 $$,
  $$ values (true, true) $$,
  '…the second sibling seats the displaced away team at home and kept its away team');
select is(pg_temp.sr_once(6), 8, '…week 6 seats every team exactly once');
select is((select count(*)::int from matchups where league_id = 'b2000000-0000-4000-8000-000000000009' and round_type not in ('regular', 'secondary')), 0,
  'ZERO rows remain on the parking game type after every permutation');
select is((select count(*)::int from league_chat where league_id = 'b2000000-0000-4000-8000-000000000009' and is_system and context = 'league'), 4,
  'four edits ⇒ four system posts in league chat (one per edit, in-txn)');

-- H5. Replay by action_id (the side flip's id, with a different pairing asked).
reset role;
select is((select count(*)::int from schedule_actions where league_id = 'b2000000-0000-4000-8000-000000000009' and kind = 'edit_matchup'), 4,
  '…and four ledger rows (counted as postgres — the ledger has no member read path)');
select set_config('pgtap.sr_after_edits', pg_temp.sr_digest(), true);
select set_config('pgtap.sr_e1', (select result::text from schedule_actions where action_id = 'a0000000-0000-4000-8000-000000000011'), true);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000009', (select id from sr_w5 where k = 2),
    (select h from sr_w5 where k = 2), (select a from sr_w5 where k = 2), 'retry', 'a0000000-0000-4000-8000-000000000011')::text,
  current_setting('pgtap.sr_e1'),
  'EDIT REPLAY (same action_id, different arguments) returns the stored result byte-identically');
reset role;
select is(pg_temp.sr_digest(), current_setting('pgtap.sr_after_edits'),
  '…and wrote nothing (matchups / chat / ledger digest unchanged)');

-- H6. Refusals by name (free window).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000009', (select id from sr_w5 where k = 2),
       (select h from sr_w5 where k = 2), (select h from sr_w5 where k = 2), null, 'a0000000-0000-4000-8000-000000000021') $$,
  '22023', null, 'self-matchup refuses 22023');
select throws_ok(
  $$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000009', (select id from sr_w5 where k = 2),
       (select h from sr_w5 where k = 2), null, null, 'a0000000-0000-4000-8000-000000000022') $$,
  '22023', null, 'a bye (NULL away) refuses 22023 — v1 schedules even counts only');
select throws_ok(
  $$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000009', (select id from sr_w5 where k = 2),
       (select h from sr_w5 where k = 2), (select a from sr_w5 where k = 2), null, null) $$,
  '22023', null, 'a missing action_id refuses 22023');
select throws_like(
  $$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000009', (select id from sr_w5 where k = 2),
       (select h from sr_w5 where k = 2), 'c2000000-0000-4000-8000-001000000001', null, 'a0000000-0000-4000-8000-000000000023') $$,
  '%not a seated franchise of league%', 'F222(a): a team of ANOTHER league refuses BY NAME (the writer''s refusal in place of the composite FK)');
select throws_ok(
  $$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000009', 'b2000000-0000-4000-8000-000000000008',
       (select h from sr_w5 where k = 2), (select a from sr_w5 where k = 1), null, 'a0000000-0000-4000-8000-000000000024') $$,
  'P0002', null, 'a matchup id that is not this league''s refuses P0002');
reset role;
savepoint h_retired;
update teams set status = 'retired' where id = (select a from sr_w5 where k = 1);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000009', (select id from sr_w5 where k = 2),
       (select h from sr_w5 where k = 2), (select a from sr_w5 where k = 1), null, 'a0000000-0000-4000-8000-000000000025') $$,
  '%not a seated franchise%', 'a RETIRED team of this league refuses BY NAME too');
reset role;
rollback to savepoint h_retired;

-- H7. Status law: a live matchup, a live sibling, a non-upcoming week, a
-- playoff row, the parking type in use (postgres arranges, u01 tries).
update matchups set status = 'live' where id = (select id from sr_w6 where k = 4);
update league_weeks set status = 'live' where league_id = 'b2000000-0000-4000-8000-000000000009' and week = 7;
insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id, status)
values ('b2000000-0000-4000-8000-000000000009', 2026, 15, 'playoff', 'c2000000-0000-4000-8000-000900000001', 'c2000000-0000-4000-8000-000900000002', 'scheduled');
insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id, status)
values ('b2000000-0000-4000-8000-000000000009', 2026, 8, 'third_place', 'c2000000-0000-4000-8000-000900000001', 'c2000000-0000-4000-8000-000900000002', 'scheduled');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000009', (select id from sr_w6 where k = 4),
       (select a from sr_w6 where k = 4), (select h from sr_w6 where k = 4), null, 'a0000000-0000-4000-8000-000000000031') $$,
  '%is live — only scheduled matchups may change%', 'a LIVE matchup refuses by name (never regenerates)');
select throws_like(
  $$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000009', (select id from sr_w6 where k = 2),
       (select h from sr_w6 where k = 2), (select h from sr_w6 where k = 4), null, 'a0000000-0000-4000-8000-000000000032') $$,
  '%current game) is live%', 'an edit that must re-seat a team INTO a live sibling refuses by name');
select throws_like(
  $$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000009',
       (select id from matchups where league_id = 'b2000000-0000-4000-8000-000000000009' and week = 7 and round_type = 'regular' order by home_team_id limit 1),
       (select away_team_id from matchups where league_id = 'b2000000-0000-4000-8000-000000000009' and week = 7 and round_type = 'regular' order by home_team_id limit 1),
       (select home_team_id from matchups where league_id = 'b2000000-0000-4000-8000-000000000009' and week = 7 and round_type = 'regular' order by home_team_id limit 1),
       null, 'a0000000-0000-4000-8000-000000000033') $$,
  '%only an upcoming week%', 'a matchup in a LIVE week (rows still scheduled) refuses by name — the week status is law too');
select throws_like(
  $$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000009',
       (select id from matchups where league_id = 'b2000000-0000-4000-8000-000000000009' and round_type = 'playoff'),
       'c2000000-0000-4000-8000-000900000002', 'c2000000-0000-4000-8000-000900000001', null, 'a0000000-0000-4000-8000-000000000034') $$,
  '%brackets are the playoffs engine%', 'a PLAYOFF row refuses by name (116''s)');
select throws_like(
  $$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000009',
       (select id from matchups where league_id = 'b2000000-0000-4000-8000-000000000009' and week = 8 and round_type = 'regular' order by home_team_id limit 1),
       (select home_team_id from matchups where league_id = 'b2000000-0000-4000-8000-000000000009' and week = 8 and round_type = 'regular' order by home_team_id limit 1),
       (select away_team_id from matchups where league_id = 'b2000000-0000-4000-8000-000000000009' and week = 8 and round_type = 'regular' order by home_team_id offset 1 limit 1),
       null, 'a0000000-0000-4000-8000-000000000035') $$,
  '%third_place rows%', 'a week already holding a third_place row refuses the parking step BY NAME (asserted, never assumed)');
select lives_ok(
  $$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000009',
       (select id from matchups where league_id = 'b2000000-0000-4000-8000-000000000009' and week = 8 and round_type = 'regular' order by home_team_id limit 1),
       (select away_team_id from matchups where league_id = 'b2000000-0000-4000-8000-000000000009' and week = 8 and round_type = 'regular' order by home_team_id limit 1),
       (select home_team_id from matchups where league_id = 'b2000000-0000-4000-8000-000000000009' and week = 8 and round_type = 'regular' order by home_team_id limit 1),
       null, 'a0000000-0000-4000-8000-000000000036') $$,
  '…while a SIDE FLIP in that same week lives (no sibling ⇒ no parking needed) — the one-unit sibling');
reset role;
delete from matchups where league_id = 'b2000000-0000-4000-8000-000000000009' and round_type in ('playoff', 'third_place');

-- H8. E40 on L8 (second_opponent ON, week 9 upcoming, post-kickoff reason law).
update nfl_games set kickoff_at = now() - interval '1 second' where id = 'sr-w1-a';
create temp table sr_l8w9 on commit drop as
select round_type, id, home_team_id as h, away_team_id as a
from matchups where league_id = 'b2000000-0000-4000-8000-000000000008' and week = 9;
grant select on sr_l8w9 to authenticated;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000008',
       (select id from sr_l8w9 where round_type = 'regular' order by h limit 1),
       (select h from sr_l8w9 where round_type = 'secondary' order by h limit 1),
       (select a from sr_l8w9 where round_type = 'secondary' order by h limit 1),
       'E40 probe', 'a0000000-0000-4000-8000-000000000041') $$,
  '%(E40)%', 'E40: a regular pairing that duplicates the week''s SECONDARY pairing refuses by name — a second game is never the primary opponent');
select throws_like(
  $$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000008',
       (select id from sr_l8w9 where round_type = 'regular' order by h limit 1),
       (select a from sr_l8w9 where round_type = 'regular' order by h limit 1),
       (select h from sr_l8w9 where round_type = 'regular' order by h limit 1),
       null, 'a0000000-0000-4000-8000-000000000042') $$,
  '%requires a reason%', 'post-kickoff EDIT with no reason refuses by name (E41/D290 — same law as Remix)');
select results_eq(
  $$ select (r ->> 'rows_changed')::int, (r ->> 'reason_required')::boolean,
            r ->> 'system_post' like 'Week 9 matchup edited by sr_user1: % vs % (was % vs %) — after Week 1 kickoff (commissioner override) — reason: Owner swap'
     from public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000008',
            (select id from sr_l8w9 where round_type = 'regular' order by h limit 1),
            (select a from sr_l8w9 where round_type = 'regular' order by h limit 1),
            (select h from sr_l8w9 where round_type = 'regular' order by h limit 1),
            'Owner swap', 'a0000000-0000-4000-8000-000000000042') r $$,
  $$ values (1, true, true) $$,
  'post-kickoff EDIT with a reason succeeds: override clause + reason in the post (the one-unit positive)');
select results_eq(
  $$ select (r ->> 'rows_changed')::int
     from public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000008',
            (select id from sr_l8w9 where round_type = 'secondary' order by h limit 1),
            (select a from sr_l8w9 where round_type = 'secondary' order by h limit 1),
            (select h from sr_l8w9 where round_type = 'secondary' order by h limit 1),
            'second game flip', 'a0000000-0000-4000-8000-000000000043') r $$,
  $$ values (1) $$,
  'a SECONDARY row is editable under the same law (its post says "(second game)")');
select is((select count(*)::int from league_chat where league_id = 'b2000000-0000-4000-8000-000000000008'
           and message like 'Week 9 (second game) matchup edited by %'), 1, '…and the post names the second game');
reset role;
select is_empty(
  $$ select week, round_type, t, count(*)
     from (select week, round_type, home_team_id t from matchups where league_id = 'b2000000-0000-4000-8000-000000000008' and week = 9
           union all select week, round_type, away_team_id from matchups where league_id = 'b2000000-0000-4000-8000-000000000008' and week = 9) app
     group by 1, 2, 3 having count(*) <> 1 $$,
  'L8 week 9 after both edits: every team once per game type, cross-side');

-- Manager / outsider / anon on the edit door.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000008', (select id from sr_l8w9 where round_type = 'regular' order by h limit 1),
       (select h from sr_l8w9 where round_type = 'regular' order by h limit 1), (select a from sr_l8w9 where round_type = 'regular' order by h limit 1),
       'x', 'a0000000-0000-4000-8000-000000000051') $$,
  '42501', null, 'a MANAGER cannot edit a matchup — 42501');
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000008', (select id from sr_l8w9 where round_type = 'regular' order by h limit 1),
       (select h from sr_l8w9 where round_type = 'regular' order by h limit 1), (select a from sr_l8w9 where round_type = 'regular' order by h limit 1),
       'x', 'a0000000-0000-4000-8000-000000000052') $$,
  '42501', null, 'an OUTSIDER cannot edit a matchup — 42501');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok(
  $$ select public.schedule_edit_matchup('b2000000-0000-4000-8000-000000000008', (select id from sr_l8w9 where round_type = 'regular' order by h limit 1),
       (select h from sr_l8w9 where round_type = 'regular' order by h limit 1), (select a from sr_l8w9 where round_type = 'regular' order by h limit 1),
       'x', 'a0000000-0000-4000-8000-000000000053') $$,
  '42501', null, 'anon cannot edit a matchup — 42501 (REVOKE)');
reset role;

-- ---------------------------------------------------------------------------
-- I. The ledger has no client path for any role (§4.2) + its CHECK/UNIQUE
-- ---------------------------------------------------------------------------
select is((select count(*)::int from schedule_actions), 10,
  'PREMISE (postgres): the ledger holds 10 rows — 3 L8 remixes (…01/…02/…03) + 5 L8b edits (…11/…13/…14/…15/…36) + 2 L8 edits (…42/…43); every refused or rolled-back action left NO row');
select throws_ok(
  $$ insert into schedule_actions (league_id, action_id, kind, actor_id, result)
     values ('b2000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-0000000000ff', 'banana', '92000000-0000-4000-8000-000000000001', '{}') $$,
  '23514', null, 'kind CHECK: banana refuses 23514');
select throws_ok(
  $$ insert into schedule_actions (league_id, action_id, kind, actor_id, result)
     values ('b2000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000001', 'remix', '92000000-0000-4000-8000-000000000001', '{}') $$,
  '23505', null, 'UNIQUE (league_id, action_id): a duplicate action id for the same league refuses 23505 (the race backstop)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is((select count(*)::int from schedule_actions), 0,
  'the COMMISSIONER sees ZERO ledger rows (RLS on, no policy — the ledger is not a member surface)');
select throws_ok(
  $$ insert into schedule_actions (league_id, action_id, kind, actor_id, result)
     values ('b2000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-0000000000fe', 'remix', '92000000-0000-4000-8000-000000000001', '{}') $$,
  '42501', null, 'commissioner INSERT into the ledger: 42501');
select results_eq(
  $$ with w as (update schedule_actions set kind = 'remix' returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'commissioner UPDATE on the ledger: 0 rows (RLS-filtered; SELECT-sees-0 pinned above)');
select results_eq(
  $$ with w as (delete from schedule_actions returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'commissioner DELETE on the ledger: 0 rows');
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is((select count(*)::int from schedule_actions), 0, 'a MANAGER sees zero ledger rows');
select results_eq(
  $$ with w as (delete from schedule_actions returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'manager DELETE on the ledger: 0 rows');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from schedule_actions), 0, 'anon sees zero ledger rows');
select results_eq(
  $$ with w as (delete from schedule_actions returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'anon DELETE on the ledger: 0 rows');
reset role;

-- ---------------------------------------------------------------------------
-- J. Held lock — the min RTT over three confirms on L2 (as u04) < 50 ms
-- ---------------------------------------------------------------------------
update nfl_games set kickoff_at = now() + interval '1 second' where id = 'sr-w10-a';
create temp table sr_rtt (secs double precision) on commit drop;
grant select, insert on sr_rtt to authenticated;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
do $$
declare v_t0 timestamptz; v_i int; begin
  for v_i in 1..3 loop
    v_t0 := clock_timestamp();
    perform public.schedule_remix_confirm('b2000000-0000-4000-8000-000000000010', 100 + v_i, null,
                                          ('a0000000-0000-4000-8000-0000000001' || lpad(v_i::text, 2, '0'))::uuid);
    insert into sr_rtt values (extract(epoch from clock_timestamp() - v_t0));
  end loop;
end $$;
select cmp_ok((select min(secs) from sr_rtt), '<', 0.05::double precision,
  'held-lock discipline (rule 8): the min RTT of three confirms (L2, 24 rows each) is under 50 ms');
select is((select count(*)::int from league_chat where league_id = 'b2000000-0000-4000-8000-000000000010' and is_system), 3,
  '…three confirms, three posts');
reset role;

select * from finish();
rollback;
