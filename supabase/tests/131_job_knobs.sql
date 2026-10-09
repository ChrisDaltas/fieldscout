-- ============================================================================
-- 131 — job knobs: pause / resume / run now (migration 183; M8 L.G1.3;
--       spec §24.4; tasks-M8 TD3 / TD4 / TD5 / TD11; Q98 / Q102;
--       PROGRESS D512)
-- ============================================================================
-- What this file proves, in one rolled-back transaction:
--   §A  FORM — job_pauses: RLS on, one SELECT policy, TRUNCATE held by no
--       client; the three doors DEFINER + search_path '' + EXECUTE for
--       authenticated only; every internal plain, search_path '', closed to
--       anon / authenticated; the three job bodies still DEFINER and closed;
--       each job body carries the pause predicate + note (2 hunks).
--   §K  REFUSALS — anon cannot execute a door; a plain user and a
--       commissioner are refused 42501 (TD1); lineup-lock pause / resume,
--       a draft job, a stat-sync job, an unknown job refused BY NAME (22023);
--       a missing action id refused; the CHECK refuses a stored lineup-lock
--       pause. None of them writes a receipt or a pause.
--   §W  WAIVERS (two identical FAAB leagues: LP paused, LQ control) — the
--       pause writes one receipt + one "FieldScout" line; a replay and a
--       second pause write nothing; the cron-path tick (every league) settles
--       LQ and leaves LP with ZERO claim / FAAB / roster / run writes, its
--       run still due; run-now refuses while paused; resume + run-now
--       settles LP to the SAME outcome LQ got (stored literals); the pause
--       row counted the skip; the run-now's identity is restored.
--   §V  WEEK ADVANCE — paused league's week stays upcoming while the control
--       opens; a scoped direct call honours the pause too.
--   §F  WEEK FINALIZE — paused league not even claimed; the control's run
--       (and a run-now) cannot finalize a week whose game is unfinished
--       (the rule holds); once the game is final the control finalizes and
--       the paused league still does not; resume + run-now finalizes it.
--   §G  EVERY-LEAGUE PAUSE — one row pauses all leagues; platform-scoped
--       receipt, no league line.
--   §L  LINEUP LOCK — run-now only; runs the tick and restores identity.
-- Break probe (§4.3): drop the `job_paused_internal('waivers', …)` line from
-- waiver_tick ⇒ the §W paused-league cells red (shown in the PR, reverted).
-- World: u1 commissioner, u2 / u3 managers, u4 OPERATOR, u5 plain user.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(70);

-- ---------------------------------------------------------------------------
-- A. Form
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.job_pauses'::regclass), 'A1 job_pauses RLS on');
select is(
  (select string_agg(format('%s:%s:%s', policyname, cmd, roles::text), ' ') from pg_policies
   where schemaname = 'public' and tablename = 'job_pauses'),
  'Job pauses readable by platform operators:SELECT:{authenticated}',
  'A2 exactly one policy, SELECT to authenticated — no write policy');
select ok(
  not has_table_privilege('anon', 'public.job_pauses', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.job_pauses', 'TRUNCATE'),
  'A3 TRUNCATE held by neither anon nor authenticated');
select is(
  (select string_agg(format('%s=%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                 has_function_privilege('anon', p.oid, 'EXECUTE'),
                 has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'op\_%' and p.proname not like 'op\_actions%'),
  'op_job_check_internal=f:search_path="":f:f op_job_words_internal=f:search_path="":f:f op_league_line_internal=f:search_path="":f:f op_pause_job=t:search_path="":f:t op_pause_job_internal=f:search_path="":f:f op_resume_job=t:search_path="":f:t op_resume_job_internal=f:search_path="":f:f op_run_job_now=t:search_path="":f:t op_run_job_now_internal=f:search_path="":f:f op_verb_prelude_internal=f:search_path="":f:f',
  'A4 the three doors DEFINER + search_path '''' + authenticated only; every internal plain and closed to anon / authenticated');
select is(
  (select string_agg(format('%s=%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                 has_function_privilege('anon', p.oid, 'EXECUTE'),
                 has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('job_paused_internal', 'job_pause_note_internal',
     'waiver_tick', 'league_week_advance', 'finalize_matchups', 'lineup_lock_tick')),
  'finalize_matchups=t:search_path="":f:f job_pause_note_internal=f:search_path="":f:f job_paused_internal=f:search_path="":f:f league_week_advance=t:search_path="":f:f lineup_lock_tick=t:search_path="":f:f waiver_tick=t:search_path="":f:f',
  'A5 job helpers plain + closed; the four job bodies still DEFINER and closed to every client');
select is(
  (select string_agg(format('%s=%s/%s', p.proname,
            (p.prosrc ~ ('AND NOT public\.job_paused_internal\(''' ||
               case p.proname when 'waiver_tick' then 'waivers' when 'league_week_advance' then 'week-advance' else 'week-finalize' end || ''', l\.id\)')),
            (p.prosrc ~ 'PERFORM public\.job_pause_note_internal\(')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('waiver_tick', 'league_week_advance', 'finalize_matchups')),
  'finalize_matchups=t/t league_week_advance=t/t waiver_tick=t/t',
  'A6 each pausable job''s entry carries the pause predicate and the skip note (TD4)');
select ok(
  (select p.prosrc !~ 'job_paused_internal' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_lock_tick'),
  'A7 lineup_lock_tick carries NO pause check (Q98: never paused)');
select ok(
  (select bool_and(pg_get_functiondef(p.oid) !~* 'league_members') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'op\_%\_job%'),
  'A8 TD1: no verb body reads league_members');

-- pg_temp.un183 — migration 183's two inserted lines per job body removed
-- (each marked `183 / L.G1.3 (TD4)`); an identity on every other body.
create function pg_temp.un183(p_src text) returns text language sql as $un183$
  select regexp_replace(
           regexp_replace(p_src,
             E'\n\n  PERFORM public\\.job_pause_note_internal\\(''[a-z-]+'', p_league_id, p_now\\);   -- 183 / L\\.G1\\.3 \\(TD4\\)', '', 'g'),
           E'        AND NOT public\\.job_paused_internal\\(''[a-z-]+'', l\\.id\\)   -- 183 / L\\.G1\\.3 \\(TD4\\)\n', '', 'g')
$un183$;
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un183(p.prosrc)), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('waiver_tick', 'league_week_advance', 'finalize_matchups')),
  'finalize_matchups=5239ab311af797a401bb91d00d78f9bd league_week_advance=1ea76a893bada31b54ebe1a82f004625 waiver_tick=8477f03af76d5117fa021e3b38cd1667',
  'A9 D137: with 183''s two lines reversed each job body is its newest definer''s FILE TEXT (150:1279 / 118:1725 / 180:115 — stored literals, md5 of the file text)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and pg_temp.un183(p.prosrc) <> p.prosrc),
  3, 'A10 …and un183 touches exactly those three bodies');

-- ---------------------------------------------------------------------------
-- World
-- ---------------------------------------------------------------------------
update nfl_weeks w
set last_game_ends_at = case
      when w.week <= 7 then w.starts_at + interval '6 days 3 hours'
      when w.week = 8 then '2026-11-03 08:00:00+00'::timestamptz
      when w.week = 9 then '2026-11-10 08:00:00+00'::timestamptz
    end,
    first_kickoff_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
-- One week-8 game (098's shape) so a SEA player is on BYE at the run, not
-- held by the week's start-time fallback.
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('x131-g8', 2026, 8, 'KC', 'BUF', '2026-10-30 00:15:00+00');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('99131000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-x131-u' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'x131_user' || i)::jsonb, now(), now()
from generate_series(1, 5) i;
update profiles set is_admin = true where id = '99131000-0000-4000-8000-000000000004';

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot,
                     lineup_lock, waiver_type, faab_budget, settings, roster_settings, waiver_next_run_at)
select v.id::uuid, '99131000-0000-4000-8000-000000000001', v.nm, 2026, 'in_season', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', 'faab', 100,
  '{"waiver_run_days": ["sun","mon","tue","wed","thu","fri","sat"], "waiver_run_time": "12:00", "waiver_time_zone": "UTC", "free_agency_opens": "after_waiver_run", "faab_tiebreaker": "reverse_standings"}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 4, "ir_slots": [], "swap_spots": 0}',
  v.nx::timestamptz
from (values
  ('b1310000-0000-4000-8000-000000000001', 'pgtap-x131-LP', '2026-11-01 12:00:00+00'),   -- waivers PAUSED
  ('b1310000-0000-4000-8000-000000000002', 'pgtap-x131-LQ', '2026-11-01 12:00:00+00'),   -- waivers control
  ('b1310000-0000-4000-8000-000000000003', 'pgtap-x131-WA', null),                       -- advance PAUSED
  ('b1310000-0000-4000-8000-000000000004', 'pgtap-x131-WB', null),                       -- advance control
  ('b1310000-0000-4000-8000-000000000005', 'pgtap-x131-FA', null),                       -- finalize PAUSED
  ('b1310000-0000-4000-8000-000000000006', 'pgtap-x131-FB', null)                        -- finalize control
) v(id, nm, nx);

insert into teams (id, owner_id, name, league_id, status) values
 ('c1310000-0000-4000-8000-000000000011', '99131000-0000-4000-8000-000000000002', 'X131 PA', 'b1310000-0000-4000-8000-000000000001', 'active'),
 ('c1310000-0000-4000-8000-000000000012', '99131000-0000-4000-8000-000000000003', 'X131 PB', 'b1310000-0000-4000-8000-000000000001', 'active'),
 ('c1310000-0000-4000-8000-000000000021', '99131000-0000-4000-8000-000000000002', 'X131 QA', 'b1310000-0000-4000-8000-000000000002', 'active'),
 ('c1310000-0000-4000-8000-000000000022', '99131000-0000-4000-8000-000000000003', 'X131 QB', 'b1310000-0000-4000-8000-000000000002', 'active');
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select l.id, '99131000-0000-4000-8000-000000000001', null, 'commissioner', false, null
from leagues l where l.name like 'pgtap-x131-%';
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance) values
 ('b1310000-0000-4000-8000-000000000001', '99131000-0000-4000-8000-000000000002', 'c1310000-0000-4000-8000-000000000011', 'manager', false, 100),
 ('b1310000-0000-4000-8000-000000000001', '99131000-0000-4000-8000-000000000003', 'c1310000-0000-4000-8000-000000000012', 'manager', false, 100),
 ('b1310000-0000-4000-8000-000000000002', '99131000-0000-4000-8000-000000000002', 'c1310000-0000-4000-8000-000000000021', 'manager', false, 100),
 ('b1310000-0000-4000-8000-000000000002', '99131000-0000-4000-8000-000000000003', 'c1310000-0000-4000-8000-000000000022', 'manager', false, 100);

-- Waiver leagues: weeks 1–14 upcoming (098's shape). Advance leagues: only
-- week 9, upcoming. Finalize leagues: only week 7, in its correction window.
insert into league_weeks (league_id, season, week)
select l.id, 2026, g from leagues l, generate_series(1, 14) g where l.name in ('pgtap-x131-LP', 'pgtap-x131-LQ');
insert into league_weeks (league_id, season, week)
select l.id, 2026, 9 from leagues l where l.name in ('pgtap-x131-WA', 'pgtap-x131-WB');
insert into league_weeks (league_id, season, week, status)
select l.id, 2026, 7, 'correction_window' from leagues l where l.name in ('pgtap-x131-FA', 'pgtap-x131-FB');

insert into drafts (league_id, status, completed_at, draft_order) values
 ('b1310000-0000-4000-8000-000000000001', 'complete', '2026-09-06 06:00:00+00',
  '["c1310000-0000-4000-8000-000000000011", "c1310000-0000-4000-8000-000000000012"]'),
 ('b1310000-0000-4000-8000-000000000002', 'complete', '2026-09-06 06:00:00+00',
  '["c1310000-0000-4000-8000-000000000021", "c1310000-0000-4000-8000-000000000022"]');

insert into players (id, full_name, position, team, status) values
 ('x131-x', 'X131 Ex', 'WR', 'SEA', 'Active'),
 ('x131-y', 'X131 Why', 'WR', 'SEA', 'Active');

-- The SAME claims in both waiver leagues: A bids 30 on Ex; B bids 20 on Ex
-- and 5 on Why. By hand: A takes Ex for $30 (70 left); B loses Ex and takes
-- Why for $5 (95 left).
insert into waiver_claims (id, league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order, action_id, created_by) values
 ('d1310000-0000-4000-8000-000000000011', 'b1310000-0000-4000-8000-000000000001', 'c1310000-0000-4000-8000-000000000011', 'x131-x', null, 30, 1, 'a1310000-0000-4000-8000-000000000911', '99131000-0000-4000-8000-000000000002'),
 ('d1310000-0000-4000-8000-000000000012', 'b1310000-0000-4000-8000-000000000001', 'c1310000-0000-4000-8000-000000000012', 'x131-x', null, 20, 1, 'a1310000-0000-4000-8000-000000000912', '99131000-0000-4000-8000-000000000003'),
 ('d1310000-0000-4000-8000-000000000013', 'b1310000-0000-4000-8000-000000000001', 'c1310000-0000-4000-8000-000000000012', 'x131-y', null, 5,  2, 'a1310000-0000-4000-8000-000000000913', '99131000-0000-4000-8000-000000000003'),
 ('d1310000-0000-4000-8000-000000000021', 'b1310000-0000-4000-8000-000000000002', 'c1310000-0000-4000-8000-000000000021', 'x131-x', null, 30, 1, 'a1310000-0000-4000-8000-000000000921', '99131000-0000-4000-8000-000000000002'),
 ('d1310000-0000-4000-8000-000000000022', 'b1310000-0000-4000-8000-000000000002', 'c1310000-0000-4000-8000-000000000022', 'x131-x', null, 20, 1, 'a1310000-0000-4000-8000-000000000922', '99131000-0000-4000-8000-000000000003'),
 ('d1310000-0000-4000-8000-000000000023', 'b1310000-0000-4000-8000-000000000002', 'c1310000-0000-4000-8000-000000000022', 'x131-y', null, 5,  2, 'a1310000-0000-4000-8000-000000000923', '99131000-0000-4000-8000-000000000003');

create temp table r131 (tag text primary key, r jsonb);
grant all on r131 to anon, authenticated, service_role;

-- One league's waiver state as a stored-literal string: per team (by its
-- letter) the claims' statuses in claim order, the FAAB balance, the roster.
create or replace function pg_temp.wstate(p_league uuid) returns text language sql as $$
  select string_agg(format('%s[%s|$%s|%s]', right(t.name, 1),
    (select string_agg(c.add_player_id || ':' || c.status || coalesce(':' || c.result_reason, ''), ',' order by c.claim_order)
     from waiver_claims c where c.team_id = t.id),
    (select m.faab_balance from league_members m where m.team_id = t.id),
    coalesce((select string_agg(r.player_id, ',' order by r.player_id) from league_rosters r where r.team_id = t.id), '-')),
    ' ' order by t.name)
  from teams t where t.league_id = p_league
$$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.err(text) to anon, authenticated;
create or replace function pg_temp.as_op() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "99131000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
$$;
create or replace function pg_temp.receipts() returns int language sql as $$
  select count(*)::int from platform_operator_actions a where a.actor_id = '99131000-0000-4000-8000-000000000004'
$$;
create or replace function pg_temp.lines(p_league uuid) returns text language sql as $$
  select coalesce(string_agg(message, ' || ' order by message), '-') from league_chat
  where league_id = p_league and is_system and user_id is null and message like 'FieldScout %'
$$;

-- ---------------------------------------------------------------------------
-- K. Refusals — per role, and per job with no knob
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select alike(pg_temp.err($$ select op_pause_job('waivers', null, gen_random_uuid()) $$), '42501:%', 'K1 anon cannot execute a door');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99131000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select is(pg_temp.err($$ select op_pause_job('waivers', 'b1310000-0000-4000-8000-000000000001', gen_random_uuid()) $$),
  '42501: pause_job: only a platform operator can use the job knobs (M8 TD1)', 'K2 a plain user is refused by name');
select is(pg_temp.err($$ select op_run_job_now('waivers', 'b1310000-0000-4000-8000-000000000001', gen_random_uuid()) $$),
  '42501: run_job_now: only a platform operator can use the job knobs (M8 TD1)', 'K3 a plain user cannot run a job');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99131000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(pg_temp.err($$ select op_resume_job('waivers', 'b1310000-0000-4000-8000-000000000001', gen_random_uuid()) $$),
  '42501: resume_job: only a platform operator can use the job knobs (M8 TD1)', 'K4 the league''s own commissioner is refused (TD1 — a platform role, never a league role)');
reset role;

set local role authenticated;
select pg_temp.as_op();
select is(pg_temp.err($$ select op_pause_job('lineup-lock', 'b1310000-0000-4000-8000-000000000001', gen_random_uuid()) $$),
  '22023: lineup locking can never be paused or resumed — pausing would let people move players after kickoff (Q98); it has "run now" only',
  'K5 lineup-lock pause refused BY NAME (Q98)');
select is(pg_temp.err($$ select op_resume_job('lineup-lock', null, gen_random_uuid()) $$),
  '22023: lineup locking can never be paused or resumed — pausing would let people move players after kickoff (Q98); it has "run now" only',
  'K6 lineup-lock resume refused too');
select is(pg_temp.err($$ select op_pause_job('draft-tick', null, gen_random_uuid()) $$),
  '22023: job "draft-tick" has no operator knobs — drafts and stat syncing get no pause / resume / run-now (Q98)',
  'K7 a draft job has no knobs');
select is(pg_temp.err($$ select op_run_job_now('sync-live-ping', null, gen_random_uuid()) $$),
  '22023: job "sync-live-ping" has no operator knobs — drafts and stat syncing get no pause / resume / run-now (Q98)',
  'K8 the stat sync has no run-now either');
select is(pg_temp.err($$ select op_pause_job('everything', null, gen_random_uuid()) $$),
  '22023: unknown job "everything" — the operator knobs cover waivers, week-advance, week-finalize (and run-now for lineup-lock)',
  'K9 an unknown job is refused by name');
select is(pg_temp.err($$ select op_pause_job('waivers', null, null) $$),
  '22023: pause_job: p_action_id is required — it makes a retry safe (M8 TD3)', 'K10 the action id is required');
reset role;
select is(pg_temp.err($$ insert into job_pauses (job, paused_at, paused_by, pause_action_id)
  values ('lineup-lock', now(), '99131000-0000-4000-8000-000000000004', gen_random_uuid()) $$)::text like '23514:%', true,
  'K11 even the owner cannot STORE a lineup-lock pause (CHECK)');
select is(format('%s/%s', pg_temp.receipts(), (select count(*) from job_pauses)), '0/0', 'K12 no refusal wrote a receipt or a pause');

-- ---------------------------------------------------------------------------
-- W. Waivers — pause LP, the cron path settles LQ only
-- ---------------------------------------------------------------------------
select pg_temp.as_op();
insert into r131 select 'W1', op_pause_job_internal('waivers', 'b1310000-0000-4000-8000-000000000001',
  'a1310000-0000-4000-8000-000000000001', null, '2026-11-01 09:00:00+00');
select is((select format('%s/%s/%s', r ->> 'changed', r ->> 'paused', r ->> 'also_paused_for_every_league') from r131 where tag = 'W1'),
  'true/true/false', 'W1 the pause is on');
select is(
  (select format('%s|%s|%s|%s|%s', verb, scope, league_id, before, after ->> 'job') from platform_operator_actions
   where action_id = 'a1310000-0000-4000-8000-000000000001'),
  'pause_job|league|b1310000-0000-4000-8000-000000000001|{"job": "waivers", "paused": false}|waivers',
  'W2 ONE league-scoped receipt, before / after recorded');
select is(pg_temp.lines('b1310000-0000-4000-8000-000000000001'),
  'FieldScout paused waivers in this league. Pending claims keep their order and run when waivers resume.',
  'W3 TD11: one activity line signed "FieldScout", no actor');
insert into r131 select 'W4', op_pause_job_internal('waivers', 'b1310000-0000-4000-8000-000000000001',
  'a1310000-0000-4000-8000-000000000001', null, '2026-11-01 09:05:00+00');
insert into r131 select 'W5', op_pause_job_internal('waivers', 'b1310000-0000-4000-8000-000000000001',
  'a1310000-0000-4000-8000-000000000002', null, '2026-11-01 09:06:00+00');
select is((select format('%s|%s', (select r ->> 'replayed' from r131 where tag = 'W4'), (select r ->> 'why' from r131 where tag = 'W5'))),
  'true|already_paused — this pause is already on; nothing was written', 'W4 a replay returns the receipt; a second pause is a no-op');
select is(format('%s/%s/%s', pg_temp.receipts(), (select count(*) from job_pauses),
  (select count(*) from league_chat where league_id = 'b1310000-0000-4000-8000-000000000001')),
  '1/1/1', 'W5 …and neither wrote a receipt, a pause or a line');
select is(pg_temp.err($$ select op_pause_job_internal('waivers', 'b1310000-0000-4000-8000-000000000001',
  'a1310000-0000-4000-8000-000000000001', null, now()) $$), 'no error', 'W6 (replay is not an error)');
select is(pg_temp.err($$ select op_resume_job_internal('waivers', 'b1310000-0000-4000-8000-000000000001',
  'a1310000-0000-4000-8000-000000000001', null, now()) $$),
  '22023: resume_job: action id a1310000-0000-4000-8000-000000000001 was already used for a different operator action',
  'W7 an action id reused for a different verb is refused');

-- The boundary: one second before the run, nothing is due anywhere.
select set_config('request.jwt.claims', '', true);
insert into r131 select 'W8', waiver_tick('2026-11-01 11:59:59+00', null);
select is(format('%s/%s', pg_temp.wstate('b1310000-0000-4000-8000-000000000002'), pg_temp.wstate('b1310000-0000-4000-8000-000000000001')),
  'A[x131-x:pending|$100|-] B[x131-x:pending,x131-y:pending|$100|-]/A[x131-x:pending|$100|-] B[x131-x:pending,x131-y:pending|$100|-]',
  'W8 boundary R−1s: neither league processed');
-- The cron path (every league) at R.
insert into r131 select 'W9', waiver_tick('2026-11-01 12:00:00+00', null);
select is(pg_temp.wstate('b1310000-0000-4000-8000-000000000002'),
  'A[x131-x:won|$70|x131-x] B[x131-x:lost:outbid,x131-y:won|$95|x131-y]',
  'W9 the control league settles by hand (stored literal)');
select is(pg_temp.wstate('b1310000-0000-4000-8000-000000000001'),
  'A[x131-x:pending|$100|-] B[x131-x:pending,x131-y:pending|$100|-]',
  'W10 PAUSED: every claim pending in order, FAAB untouched, no roster write');
select is(
  (select format('%s|%s', l.waiver_next_run_at, (select count(*) from waiver_runs w where w.league_id = l.id)) from leagues l
   where l.id = 'b1310000-0000-4000-8000-000000000001'),
  '2026-11-01 12:00:00+00|0', 'W11 PAUSED: the run is still due, not advanced, no run row');
select is((select format('%s|%s', skipped_runs, last_skipped_at) from job_pauses where pause_action_id = 'a1310000-0000-4000-8000-000000000001'),
  '2|2026-11-01 12:00:00+00', 'W12 the skip is logged on the pause row (both runs it held)');
select ok((select (r -> 'settled') @> '[{"league_id": "b1310000-0000-4000-8000-000000000002"}]'
              and not (r::text like '%b1310000-0000-4000-8000-000000000001%') from r131 where tag = 'W9'),
  'W13 the tick''s report names the control and never the paused league');

-- Run now while paused: refused as a no-op.
select pg_temp.as_op();
insert into r131 select 'W14', op_run_job_now_internal('waivers', 'b1310000-0000-4000-8000-000000000001',
  'a1310000-0000-4000-8000-000000000003', null, '2026-11-01 13:00:00+00');
select is((select r ->> 'why' from r131 where tag = 'W14'),
  'paused — this job is paused for this scope; resume it first. Nothing was run or written', 'W14 run-now never bypasses a pause');
select is(format('%s/%s', pg_temp.receipts(), pg_temp.wstate('b1310000-0000-4000-8000-000000000001')),
  '1/A[x131-x:pending|$100|-] B[x131-x:pending,x131-y:pending|$100|-]', 'W15 …and wrote nothing');

-- Resume, then run now: the same outcome the control got.
insert into r131 select 'W16', op_resume_job_internal('waivers', 'b1310000-0000-4000-8000-000000000001',
  'a1310000-0000-4000-8000-000000000004', 'game moved — done', '2026-11-01 14:00:00+00');
select is((select format('%s/%s/%s', r ->> 'changed', r ->> 'paused', r ->> 'skipped_runs') from r131 where tag = 'W16'),
  'true/false/2', 'W16 resumed');
select is((select format('%s|%s', resumed_at, resumed_by) from job_pauses where pause_action_id = 'a1310000-0000-4000-8000-000000000001'),
  '2026-11-01 14:00:00+00|99131000-0000-4000-8000-000000000004', 'W17 the pause row is closed (history kept)');
insert into r131 select 'W18', op_run_job_now_internal('waivers', 'b1310000-0000-4000-8000-000000000001',
  'a1310000-0000-4000-8000-000000000005', null, '2026-11-01 14:01:00+00');
select is(pg_temp.wstate('b1310000-0000-4000-8000-000000000001'),
  'A[x131-x:won|$70|x131-x] B[x131-x:lost:outbid,x131-y:won|$95|x131-y]',
  'W18 resume ⇒ IDENTICAL outcome to the unpaused control on the same inputs (stored literal)');
select is(auth.uid()::text, '99131000-0000-4000-8000-000000000004', 'W19 the run-now restored the caller''s identity');
select is(
  (select string_agg(format('%s:%s', verb, reason), ',' order by created_at, verb) from platform_operator_actions
   where league_id = 'b1310000-0000-4000-8000-000000000001'),
  'pause_job:,resume_job:game moved — done,run_job_now:', 'W20 three receipts in all — pause, resume (reason kept), run now');
select is(pg_temp.lines('b1310000-0000-4000-8000-000000000001'),
  'FieldScout paused waivers in this league. Pending claims keep their order and run when waivers resume. || FieldScout ran waivers for this league now, under the usual rules. || FieldScout resumed waivers in this league. Pending claims run at the next waiver run.',
  'W21 three FieldScout lines, one per change');
-- A second run-now: nothing due, a no-op.
insert into r131 select 'W22', op_run_job_now_internal('waivers', 'b1310000-0000-4000-8000-000000000001',
  'a1310000-0000-4000-8000-000000000006', null, '2026-11-01 14:02:00+00');
select is(format('%s|%s', (select r ->> 'changed' from r131 where tag = 'W22'), pg_temp.receipts()), 'false|3',
  'W22 run-now with nothing due writes no receipt');
select is(format('%s/%s', (select r ->> 'replayed' from r131 where tag = 'W18'),
  (op_run_job_now_internal('waivers', 'b1310000-0000-4000-8000-000000000001', 'a1310000-0000-4000-8000-000000000005', null, '2026-11-02 12:00:00+00') ->> 'replayed')),
  '/true', 'W23 replaying the run-now action returns its receipt — the job is not run twice');
select is(pg_temp.wstate('b1310000-0000-4000-8000-000000000001'),
  'A[x131-x:won|$70|x131-x] B[x131-x:lost:outbid,x131-y:won|$95|x131-y]', 'W24 …state unchanged by the replay');

-- ---------------------------------------------------------------------------
-- V. Week advance
-- ---------------------------------------------------------------------------
insert into r131 select 'V1', op_pause_job_internal('week-advance', 'b1310000-0000-4000-8000-000000000003',
  'a1310000-0000-4000-8000-000000000011', null, '2026-11-04 04:00:00+00');
select set_config('request.jwt.claims', '', true);
insert into r131 select 'V2', league_week_advance('2026-11-04 06:00:00+00', 'b1310000-0000-4000-8000-000000000003');
insert into r131 select 'V3', league_week_advance('2026-11-04 06:00:00+00', null);
select is(
  (select string_agg(format('%s:%s', right(l.name, 2), lw.status), ' ' order by l.name) from league_weeks lw join leagues l on l.id = lw.league_id
   where l.name in ('pgtap-x131-WA', 'pgtap-x131-WB')),
  'WA:upcoming WB:live', 'V1 PAUSED week stays upcoming (scoped AND every-league calls); the control opens');
select is((select r ->> 'leagues' from r131 where tag = 'V2'), '0', 'V2 a call scoped to the paused league claims nothing');
select pg_temp.as_op();
insert into r131 select 'V4', op_resume_job_internal('week-advance', 'b1310000-0000-4000-8000-000000000003',
  'a1310000-0000-4000-8000-000000000012', null, '2026-11-04 07:00:00+00');
insert into r131 select 'V5', op_run_job_now_internal('week-advance', 'b1310000-0000-4000-8000-000000000003',
  'a1310000-0000-4000-8000-000000000013', null, '2026-11-04 07:00:00+00');
select is(
  (select format('%s|%s', lw.status, (select r -> 'report' ->> 'opened' from r131 where tag = 'V5')) from league_weeks lw
   where lw.league_id = 'b1310000-0000-4000-8000-000000000003'),
  'live|1', 'V3 resume + run now opens it');

-- ---------------------------------------------------------------------------
-- F. Week finalize — the rule still holds
-- ---------------------------------------------------------------------------
-- The only week-7 game, added only now (the waiver world above has no game
-- at all): NOT final yet, so the rule holds week 7.
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('x131-g7', 2026, 7, 'MIA', 'NYJ', '2026-10-25 20:00:00+00', 'in_progress');
insert into r131 select 'F1', op_pause_job_internal('week-finalize', 'b1310000-0000-4000-8000-000000000005',
  'a1310000-0000-4000-8000-000000000021', null, '2026-10-29 09:00:00+00');
-- Run now on the CONTROL while its week's game is unfinished.
insert into r131 select 'F2', op_run_job_now_internal('week-finalize', 'b1310000-0000-4000-8000-000000000006',
  'a1310000-0000-4000-8000-000000000022', null, '2026-10-29 11:00:00+00');
select is(
  (select format('%s|%s|%s', r ->> 'changed', r -> 'report' ->> 'reason', r -> 'report' -> 'skipped' -> 0 ->> 'reason') from r131 where tag = 'F2'),
  'false|nothing_finalized|games_not_final', 'F1 run now CANNOT finalize a week the rule holds (a game unfinished) — and writes nothing');
select is(
  (select string_agg(format('%s:%s', right(l.name, 2), lw.status), ' ' order by l.name) from league_weeks lw join leagues l on l.id = lw.league_id
   where l.name in ('pgtap-x131-FA', 'pgtap-x131-FB')),
  'FA:correction_window FB:correction_window', 'F2 both weeks still in their correction window');
-- The game ends; the cron path runs.
update nfl_games set status = 'final' where id = 'x131-g7';
select set_config('request.jwt.claims', '', true);
insert into r131 select 'F3', finalize_matchups('2026-10-29 11:05:00+00', null);
select is(
  (select string_agg(format('%s:%s', right(l.name, 2), lw.status), ' ' order by l.name) from league_weeks lw join leagues l on l.id = lw.league_id
   where l.name in ('pgtap-x131-FA', 'pgtap-x131-FB')),
  'FA:correction_window FB:final', 'F3 PAUSED league not finalized (zero result writes); the control is');
select ok((select not (r::text like '%b1310000-0000-4000-8000-000000000005%') from r131 where tag = 'F3'),
  'F4 the paused league was never claimed by the run');
select pg_temp.as_op();
insert into r131 select 'F5', op_resume_job_internal('week-finalize', 'b1310000-0000-4000-8000-000000000005',
  'a1310000-0000-4000-8000-000000000023', null, '2026-10-29 12:00:00+00');
insert into r131 select 'F6', op_run_job_now_internal('week-finalize', 'b1310000-0000-4000-8000-000000000005',
  'a1310000-0000-4000-8000-000000000024', null, '2026-10-29 12:00:00+00');
select is(
  (select format('%s|%s', lw.status, (select r -> 'report' ->> 'finalized' from r131 where tag = 'F6')) from league_weeks lw
   where lw.league_id = 'b1310000-0000-4000-8000-000000000005'),
  'final|1', 'F5 resume + run now finalizes it through the normal rule');
select is(pg_temp.lines('b1310000-0000-4000-8000-000000000005'),
  'FieldScout paused final weekly results in this league. Finished weeks will not be made final until it resumes. || FieldScout ran final weekly results for this league now, under the usual rules. || FieldScout resumed final weekly results in this league. Anything that was waiting happens at the next run.',
  'F6 the league read three plain FieldScout lines');

-- ---------------------------------------------------------------------------
-- G. Every-league pause
-- ---------------------------------------------------------------------------
insert into r131 select 'G1', op_pause_job_internal('waivers', null, 'a1310000-0000-4000-8000-000000000031', null, '2026-11-02 09:00:00+00');
select is(
  (select format('%s|%s', scope, coalesce(league_id::text, 'null')) from platform_operator_actions where action_id = 'a1310000-0000-4000-8000-000000000031'),
  'platform|null', 'G1 an every-league pause is a platform-scoped receipt');
select is((select count(*)::int from league_chat where message like 'FieldScout%' and created_at >= now() and league_id = 'b1310000-0000-4000-8000-000000000002'), 0,
  'G2 …and posts no league line');
select ok(job_paused_internal('waivers', 'b1310000-0000-4000-8000-000000000002') and job_paused_internal('waivers', gen_random_uuid()),
  'G3 every league reads as paused');
insert into r131 select 'G4', op_run_job_now_internal('waivers', 'b1310000-0000-4000-8000-000000000002',
  'a1310000-0000-4000-8000-000000000032', null, '2026-11-02 12:00:00+00');
select alike((select r ->> 'why' from r131 where tag = 'G4'), 'paused —%', 'G4 run-now on one league is refused while every league is paused');
insert into r131 select 'G5', op_pause_job_internal('waivers', 'b1310000-0000-4000-8000-000000000002', 'a1310000-0000-4000-8000-000000000033', null, '2026-11-02 09:10:00+00');
select is((select r ->> 'also_paused_for_every_league' from r131 where tag = 'G5'), 'true', 'G5 a league pause on top says so');
insert into r131 select 'G6', op_resume_job_internal('waivers', null, 'a1310000-0000-4000-8000-000000000034', null, '2026-11-02 09:20:00+00');
select ok(job_paused_internal('waivers', 'b1310000-0000-4000-8000-000000000002') and not job_paused_internal('waivers', 'b1310000-0000-4000-8000-000000000001'),
  'G6 lifting the every-league pause leaves the league''s own pause on');
select is(pg_temp.err($$ insert into job_pauses (job, league_id, paused_at, paused_by, pause_action_id)
  values ('waivers', 'b1310000-0000-4000-8000-000000000002', now(), '99131000-0000-4000-8000-000000000004', gen_random_uuid()) $$)::text like '23505:%', true,
  'G7 at most one open pause per (job, league)');

-- ---------------------------------------------------------------------------
-- L. Lineup lock — run now only
-- ---------------------------------------------------------------------------
insert into r131 select 'L1', op_run_job_now_internal('lineup-lock', 'b1310000-0000-4000-8000-000000000002',
  'a1310000-0000-4000-8000-000000000041', null, '2026-11-02 12:00:00+00');
select ok((select r ? 'changed' from r131 where tag = 'L1'), 'L1 lineup-lock run-now runs the tick (no pause check)');
select is(auth.uid()::text, '99131000-0000-4000-8000-000000000004', 'L2 identity restored after the lineup-lock run');

-- ---------------------------------------------------------------------------
-- R. Reads per role
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99131000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is((select count(*)::int from job_pauses), 0, 'R1 a commissioner reads no pause rows');
with u as (update job_pauses set skipped_runs = 0 returning 1) insert into r131 select 'R2', to_jsonb(count(*)) from u;
select is((select r::int from r131 where tag = 'R2'), 0, 'R2 …and updates none (RETURNING count)');
select pg_temp.as_op();
select is((select count(*)::int from job_pauses), 5, 'R3 the operator reads every pause row');
with u as (update job_pauses set skipped_runs = 0 returning 1) insert into r131 select 'R4', to_jsonb(count(*)) from u;
with d as (delete from job_pauses returning 1) insert into r131 select 'R5', to_jsonb(count(*)) from d;
select is((select r::int from r131 where tag = 'R4'), 0, 'R4 the operator cannot update one directly (no write policy; RETURNING count)');
select is((select r::int from r131 where tag = 'R5'), 0, 'R5 …nor delete one');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from job_pauses), 0, 'R6 anon reads 0 rows');
reset role;

select * from finish();
rollback;
