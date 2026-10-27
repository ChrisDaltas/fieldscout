-- ============================================================================
-- 162 — leagues are archived, never deleted (migration 212; ledger F716;
--       Chris 2026-10-27; spec §7.2 / §12.1 / §15.1 / §17 v2.16.109;
--       PROGRESS D780–D786)
-- ============================================================================
-- What this file proves, in one rolled-back transaction:
--   §A  FORM — the column + its CHECK; the doors DEFINER + search_path '' +
--       EXECUTE for authenticated only; every internal / trigger function
--       closed; THE CENSUS — every public table with a league_id column
--       carries the freeze trigger (two named exemptions), every table that
--       reaches a league through a draft / team / trade carries it with
--       that key, `leagues` carries the row guard; the jobs that rely on
--       `deleted_at IS NULL` still say so; D137 — with 212's marked lines
--       removed each replaced job body is its newest definer's FILE TEXT
--       (stored md5 literals).
--   §K  THE GATE — archive / restore per role: anon cannot execute; an
--       outsider, a manager and a CO-COMMISSIONER are refused 42501 by name
--       (F716); none of them wrote a receipt, a line or a stamp; the reason
--       bound; a live or paused real draft refuses archive by name; a live
--       PRACTICE draft does not; soft_delete_league refuses every caller.
--   §R  THE ROUND TRIP — the commissioner archives: one receipt, one line,
--       the stamp; a replay writes nothing; while archived every member act
--       and every direct write on the league's rows is refused 55000 (league
--       id, draft, team and trade keys), the leagues row refuses everything
--       but the restore, reads still work; restore: one receipt, one line,
--       the stamp cleared, scoring re-queued, a replay writes nothing — and
--       the league's data is BYTE-IDENTICAL to before the archive (a
--       fingerprint over every guarded table). After it, members act again.
--   §J  EVERY SCHEDULED JOB SKIPS AN ARCHIVED LEAGUE — each against an
--       identical un-archived control league on the same inputs: waivers,
--       week advance, week finalize, lineup lock, trade tick, mock expiry,
--       draft auto-start; then each restored league catches up through the
--       normal rule (waivers settle to the control's exact outcome, the week
--       opens, the week finalizes). The draft rule (D785): a draft time that
--       passed while archived does not start the draft; a later one does.
--   §X  ACCOUNT DELETION is never blocked by an archived league (FK actions
--       run at trigger depth > 1).
--   PR #543 review (Chris's rulings 2026-10-27 + fixes): §R's trades — archive
--   CANCELS every unfinished trade (R1728), one line, both managers told;
--   §Q finalize reads no queue (R1755 — R1730 / R1750's queue hold replaced)
--   and §J19 a restored league waits out its own 30-minute restore window,
--   never another league's (R1755); restore re-arms an existing queue row and
--   takes its lease back (J16b); restore's queue rows are fresh to the stall
--   check (R1731); §S an archived league
--   still owns its scoring system — a direct rules write is refused (R1725);
--   §O the operator's restore (F851) and the archived wording (R1733).
-- Break probes (§4.3) — each injected after `begin;` (inside this file's own
-- rolled-back transaction), shown red in the PR, reverted: (1) the gate
-- widened to co-commissioners ⇒ K5 + 7 downstream red; (2) trade_tick's claim
-- predicate removed ⇒ J11 red (J10 holds — the freeze refuses the sweep's
-- writes); (3) the freeze dropped on league_chat ⇒ A3 + R9 red; (4) the
-- missed-draft-time rule removed ⇒ J14 red; (5) restore's re-queue removed ⇒
-- R25 + R29 red; (6) the leagues row guard opened ⇒ R20 / R21 / R30 + 5 red.
-- Round 3 (R1755): (15) finalize's window hunk removed ⇒ J19 + J19b red;
-- (16) the window shut one instant late (`<=`) ⇒ J19c + J19n red; (17) the window
-- read off ANY league's latest restore ⇒ J19m + J19n red; (14) restore's
-- re-arm turned back into DO NOTHING ⇒ J16b red.
-- World: u1 commissioner (of every league), u2 co-commissioner (LA), u3 / u5
-- managers, u4 outsider, u6 a manager of LX only.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(109);

-- ---------------------------------------------------------------------------
-- A. Form
-- ---------------------------------------------------------------------------
select is(
  (select format('%s|%s|%s', a.attnotnull, (select confdeltype from pg_constraint c
      where c.conrelid = 'public.leagues'::regclass and c.contype = 'f' and c.conkey = array[a.attnum]),
     (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'leagues_archived_by_only_while_archived'))
   from pg_attribute a where a.attrelid = 'public.leagues'::regclass and a.attname = 'archived_by'),
  'f|n|CHECK (((archived_by IS NULL) OR (deleted_at IS NOT NULL)))',
  'A1 leagues.archived_by: nullable, ON DELETE SET NULL, set only while archived');
select is(
  (select string_agg(format('%s=%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                 has_function_privilege('anon', p.oid, 'EXECUTE'),
                 has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('archive_league', 'restore_league', 'archive_league_internal',
     'restore_league_internal', 'league_archive_who_internal', 'league_archived_guard_internal',
     'league_row_archived_guard_internal', 'soft_delete_league', 'league_archive_trade_reason_internal',
     'league_restore_apply_internal', 'op_archived_league_prelude_internal', 'op_restore_league', 'op_restore_league_internal',
     'league_restore_hold_internal')),
  'archive_league=t:search_path="":f:t archive_league_internal=f:search_path="":f:f league_archive_trade_reason_internal=f:search_path="":f:f league_archive_who_internal=f:search_path="":f:f league_archived_guard_internal=t:search_path="":f:f league_restore_apply_internal=f:search_path="":f:f league_restore_hold_internal=f:search_path="":f:f league_row_archived_guard_internal=t:search_path="":f:f op_archived_league_prelude_internal=f:search_path="":f:f op_restore_league=t:search_path="":f:t op_restore_league_internal=f:search_path="":f:f restore_league=t:search_path="":f:t restore_league_internal=f:search_path="":f:f soft_delete_league=t:search_path="":f:t',
  'A2 doors DEFINER + search_path '''' + authenticated only; internals plain + closed; trigger functions DEFINER + closed (the operator''s door F851 included)');

-- THE CENSUS. Every public table with a league_id column carries the freeze
-- with key 'league_id' — except the two operator tables, by name.
select is(
  (select coalesce(string_agg(c.relname, ' ' order by c.relname), '')
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'league_id' and not a.attisdropped)
     and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'tr_aa_league_archived_guard'
                       and encode(t.tgargs, 'escape') = E'league_id\\000')),
  'job_pauses platform_operator_actions',
  'A3 every table with a league_id carries the freeze — the ONLY exemptions are the two operator tables (their verbs refuse an archived league in 184''s prelude)');
-- …and every table that reaches a league only through a draft / team /
-- trade carries it with that key (derived from the foreign keys, not typed).
select is(
  (select string_agg(format('%s:%s', c.relname, replace(encode(t.tgargs, 'escape'), E'\\000', '')), ' ' order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   left join pg_trigger t on t.tgrelid = c.oid and t.tgname = 'tr_aa_league_archived_guard'
   where n.nspname = 'public' and c.relkind = 'r'
     and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'league_id' and not a.attisdropped)
     and exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f'
                   and k.confrelid in ('public.drafts'::regclass, 'public.teams'::regclass, 'public.trades'::regclass))
     and c.relname <> 'leagues'),
  'draft_dnd_marks:draft_id draft_liveness:draft_id draft_queues:draft_id team_autopilot:team_id team_lineups:team_id trade_drops:trade_id trade_items:trade_id trade_votes:trade_id',
  'A4 every table that belongs to a league through its draft / team / trade carries the freeze with that key');
select is(
  (select string_agg(distinct format('%s/%s/%s', (t.tgtype & 2) = 2, (t.tgtype & 1) = 1, t.tgenabled), ',')
   from pg_trigger t where t.tgname = 'tr_aa_league_archived_guard'),
  't/t/O',
  'A5 every freeze trigger is BEFORE, FOR EACH ROW, enabled ORIGIN (a replica-mode data restore is not refused)');
select is(
  (select string_agg(distinct format('%s:%s:%s:%s', (t.tgtype & 4) = 4, (t.tgtype & 8) = 8, (t.tgtype & 16) = 16, t.tgfoid::regproc), ',')
   from pg_trigger t where t.tgname = 'tr_aa_league_archived_guard'),
  't:t:t:league_archived_guard_internal',
  'A6 …on INSERT, DELETE and UPDATE alike');
select is(
  (select format('%s|%s|%s', t.tgtype & (2 | 1 | 16 | 4 | 8), t.tgfoid::regproc, t.tgenabled)
   from pg_trigger t where t.tgrelid = 'public.leagues'::regclass and t.tgname = 'tr_aa_league_row_archived_guard'),
  '19|league_row_archived_guard_internal|O',
  'A7 leagues carries the row guard: BEFORE UPDATE FOR EACH ROW (19 = ROW|BEFORE|UPDATE)');
select is(
  (select string_agg(format('%s=%s', p.proname, p.prosrc ~ 'l\.deleted_at IS NULL'), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('waiver_tick', 'league_week_advance', 'finalize_matchups', 'lineup_lock_tick', 'draft_tick', 'draft_league_alive')),
  'draft_league_alive=t draft_tick=t finalize_matchups=t league_week_advance=t lineup_lock_tick=t waiver_tick=t',
  'A8 the jobs the freeze relies on still claim only leagues with deleted_at IS NULL');

-- pg_temp.un212 — 212's marked lines removed (each ends `-- 212 / F716…`).
create function pg_temp.un212(p_src text) returns text language sql as $un$
  select regexp_replace(p_src, E'\n[^\n]*-- 212 / F716[^\n]*', '', 'g')
$un$;
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un212(p.prosrc)), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('trade_tick', 'mock_draft_expire', 'draft_tick', 'finalize_matchups', 'op_verb_prelude_internal')),
  'draft_tick=87977590c0d9f597664192798cdfccec finalize_matchups=55c40a017c775f4bab6febb25db3a436 mock_draft_expire=b25eabbf469bb29a445bcd34d52e249f op_verb_prelude_internal=69e0a040fd961551a792fd486c107f58 trade_tick=6ad1184263167e6ebb1d013550bb171c',
  'A9 D137: with 212''s lines removed each body is its newest definer''s FILE TEXT (097 / 183 / 095 / 184 / 199 — stored md5 literals)');
select is(
  (select string_agg(p.proname || ':' || (length(p.prosrc) - length(replace(p.prosrc, '-- 212 / F716', ''))) / length('-- 212 / F716'), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and pg_temp.un212(p.prosrc) <> p.prosrc),
  'draft_tick:1 finalize_matchups:5 mock_draft_expire:1 op_verb_prelude_internal:1 trade_tick:2',
  'A10 …and only those five bodies carry 212 lines (2 + 1 + 1 + 5 + 1)');
-- R1725's two REPLACED lines (marker `-- F716 / 212`): the full bodies are
-- pinned as 212's FILE TEXT, and undoing the one line gives 170 / 104 back.
create function pg_temp.un212r(p_src text) returns text language sql as $un$
  select replace(replace(p_src,
    '  JOIN public.leagues l ON l.scoring_system_id = s.id   -- F716 / 212 (R1725): an ARCHIVED league still plays by it (was `AND l.deleted_at IS NULL`)',
    '  JOIN public.leagues l ON l.scoring_system_id = s.id AND l.deleted_at IS NULL'),
    '           -- F716 / 212 (R1725): an ARCHIVED league still uses it (was `AND l.deleted_at IS NULL`)',
    '           AND l.deleted_at IS NULL')
$un$;
select is(
  (select string_agg(format('%s=%s/%s', p.proname, md5(p.prosrc), md5(pg_temp.un212r(p.prosrc))), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('scoring_system_league_use_internal', 'scoring_systems_rules_guard')),
  'scoring_system_league_use_internal=10b9b9123c62ae50f41a127a907b2ead/e04d488051a3a637c5f6d87312284254 scoring_systems_rules_guard=07fb3088ab838f1f783f8187ace84316/009f9c68b41f1ff6fb58dfcc3d7725b1',
  'A11 R1725 (D137, 170 / 104): each body is 212''s FILE TEXT, and with its ONE replaced line undone it is its newest definer''s FILE TEXT (stored md5 literals)');
select ok(
  (select bool_and(regexp_replace(p.prosrc, '--[^\n]*', '', 'g') !~ 'deleted_at IS NULL') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('scoring_system_league_use_internal', 'scoring_systems_rules_guard')),
  'A12 …and neither filters out an archived league any more');

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
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('x162-g8', 2026, 8, 'KC', 'BUF', '2026-10-30 00:15:00+00', 'scheduled'),
 ('x162-g7', 2026, 7, 'MIA', 'NYJ', '2026-10-25 20:00:00+00', 'final'),
 ('x162-g9', 2026, 9, 'KC', 'BUF', '2026-11-06 00:15:00+00', 'scheduled');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('99162000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-x162-u' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'x162_user' || i)::jsonb, now(), now()
from generate_series(1, 7) i;
update profiles set is_admin = true where id = '99162000-0000-4000-8000-000000000007';   -- u7: the platform operator (F851)

-- Leagues. Two letters = role + (W archived / C control). Every league is
-- the commissioner u1's.
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot,
                     lineup_lock, waiver_type, faab_budget, settings, roster_settings, waiver_next_run_at)
select v.id::uuid, '99162000-0000-4000-8000-000000000001', 'pgtap-x162-' || v.nm, 2026, v.st, 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', 'faab', 100,
  '{"waiver_run_days": ["sun","mon","tue","wed","thu","fri","sat"], "waiver_run_time": "12:00", "waiver_time_zone": "UTC", "free_agency_opens": "after_waiver_run", "faab_tiebreaker": "reverse_standings"}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 4, "ir_slots": [], "swap_spots": 0}',
  v.nx::timestamptz
from (values
  ('b1620000-0000-4000-8000-0000000000a1', 'LA', 'in_season', null),                       -- the round trip
  ('b1620000-0000-4000-8000-0000000000b1', 'LB', 'drafting', null),                        -- drafting: refused
  ('b1620000-0000-4000-8000-0000000000b2', 'LP', 'scheduled', null),                       -- a PAUSED real draft: refused
  ('b1620000-0000-4000-8000-000000000011', 'JW', 'in_season', '2026-11-01 12:00:00+00'),   -- waivers, archived
  ('b1620000-0000-4000-8000-000000000012', 'JC', 'in_season', '2026-11-01 12:00:00+00'),   -- waivers, control
  ('b1620000-0000-4000-8000-000000000021', 'VW', 'in_season', null),                       -- advance, archived
  ('b1620000-0000-4000-8000-000000000022', 'VC', 'in_season', null),                       -- advance, control
  ('b1620000-0000-4000-8000-000000000031', 'FW', 'in_season', null),                       -- finalize, archived
  ('b1620000-0000-4000-8000-000000000032', 'FC', 'in_season', null),                       -- finalize, control
  ('b1620000-0000-4000-8000-000000000041', 'KW', 'in_season', null),                       -- lineup lock, archived
  ('b1620000-0000-4000-8000-000000000042', 'KC', 'in_season', null),                       -- lineup lock, control
  ('b1620000-0000-4000-8000-000000000051', 'TW', 'setup', null),                           -- trade tick, archived
  ('b1620000-0000-4000-8000-000000000052', 'TC', 'setup', null),                           -- trade tick, control
  ('b1620000-0000-4000-8000-000000000061', 'MW', 'setup', null),                           -- mock expiry, archived
  ('b1620000-0000-4000-8000-000000000062', 'MC', 'setup', null),                           -- mock expiry, control
  ('b1620000-0000-4000-8000-000000000071', 'DW', 'scheduled', null),                       -- auto-start, archived
  ('b1620000-0000-4000-8000-000000000072', 'DC', 'scheduled', null),                       -- auto-start, control
  ('b1620000-0000-4000-8000-000000000073', 'DR', 'scheduled', null),                       -- restored AFTER its draft time
  ('b1620000-0000-4000-8000-000000000074', 'DL', 'scheduled', null),                       -- restored BEFORE its draft time
  ('b1620000-0000-4000-8000-000000000081', 'LX', 'in_season', null),                       -- account deletion
  ('b1620000-0000-4000-8000-000000000033', 'FQ', 'in_season', null),                       -- finalize reads no queue (R1755)
  ('b1620000-0000-4000-8000-000000000034', 'FM', 'in_season', null),                       -- shares FW's player; FW's restore never holds it (R1755)
  ('b1620000-0000-4000-8000-000000000091', 'LR', 'setup', null),                           -- its own scoring system (R1725)
  ('b1620000-0000-4000-8000-000000000092', 'LO', 'in_season', null)                        -- the operator's restore (F851)
) v(id, nm, st, nx);
-- The draft leagues' instant: an hour ago (the auto-start arm reads now()).
update leagues set settings = settings || jsonb_build_object('draft', jsonb_build_object(
    'draft_type', 'snake', 'draft_order_mode', 'random', 'pick_timer_seconds', 60,
    'draft_scheduled_at', (now() - interval '1 hour')::text))
where name in ('pgtap-x162-DW', 'pgtap-x162-DC', 'pgtap-x162-DR', 'pgtap-x162-DL');

-- Teams: two per league (u3 / u5) — a draft league is therefore 2 of 8
-- (capacity-short), so an attempted auto-start FAILS INTO THE SUMMARY by
-- name (022 §G's LF) — the observable that the arm reached the league.
insert into teams (id, owner_id, name, league_id, status)
select ('c162' || right(l.id::text, 4) || '-0000-4000-8000-00000000000' || k)::uuid,
       case k when 1 then '99162000-0000-4000-8000-000000000003'::uuid else '99162000-0000-4000-8000-000000000005'::uuid end,
       'X162 ' || right(l.name, 2) || k, l.id, 'active'
from leagues l, generate_series(1, 2) k where l.name like 'pgtap-x162-%' and l.name <> 'pgtap-x162-LX';
insert into teams (id, owner_id, name, league_id, status) values
 ('c1620081-0000-4000-8000-000000000001', '99162000-0000-4000-8000-000000000006', 'X162 LX1', 'b1620000-0000-4000-8000-000000000081', 'active');

create or replace function pg_temp.team(p_league text, p_k int) returns uuid language sql as $$
  select t.id from teams t join leagues l on l.id = t.league_id
  where l.name = 'pgtap-x162-' || p_league and t.name = 'X162 ' || p_league || p_k
$$;
create or replace function pg_temp.lg(p_league text) returns uuid language sql as $$
  select id from leagues where name = 'pgtap-x162-' || p_league
$$;

insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select l.id, '99162000-0000-4000-8000-000000000001', null, 'commissioner', false, null
from leagues l where l.name like 'pgtap-x162-%';
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select l.id, u.uid, pg_temp.team(right(l.name, 2), u.k), 'manager', false, 100
from leagues l, (values ('99162000-0000-4000-8000-000000000003'::uuid, 1), ('99162000-0000-4000-8000-000000000005'::uuid, 2)) u(uid, k)
where l.name like 'pgtap-x162-%' and l.name <> 'pgtap-x162-LX';
insert into league_members (league_id, user_id, team_id, role, is_placeholder) values
 (pg_temp.lg('LA'), '99162000-0000-4000-8000-000000000002', null, 'co_commissioner', false),
 (pg_temp.lg('LX'), '99162000-0000-4000-8000-000000000006', 'c1620081-0000-4000-8000-000000000001', 'manager', false);

insert into players (id, full_name, position, team, status) values
 ('x162-qb', 'X162 QB', 'QB', 'SEA', 'Active'),
 ('x162-x', 'X162 Ex', 'WR', 'SEA', 'Active'),
 ('x162-y', 'X162 Why', 'WR', 'SEA', 'Active'),
 ('x162-k', 'X162 Kay', 'K', 'SEA', 'Active');

-- LA: week 9 live, one matchup, a rostered QB in A1's lineup with a stat
-- line (the restore's scoring catch-up), a chat line, a commissioner note.
insert into league_weeks (league_id, season, week, status) values (pg_temp.lg('LA'), 2026, 8, 'upcoming');
insert into league_weeks (league_id, season, week) values (pg_temp.lg('LA'), 2026, 9);
update league_weeks set status = 'live' where league_id = pg_temp.lg('LA') and week = 9;
insert into matchups (league_id, season, week, home_team_id, away_team_id, round_type, status, home_score, away_score)
values (pg_temp.lg('LA'), 2026, 9, pg_temp.team('LA', 1), pg_temp.team('LA', 2), 'regular', 'live', 12.5, 7.0);
insert into league_rosters (league_id, team_id, player_id) values (pg_temp.lg('LA'), pg_temp.team('LA', 1), 'x162-qb');
insert into team_lineups (team_id, season, week, starters, bench, slot_map)
values (pg_temp.team('LA', 1), 2026, 9, '[]', '[]', '{"qb": "x162-qb"}');
insert into player_stats (player_id, season, week, stat_type, updated_at, pass_yards)
values ('x162-qb', 2026, 9, 'weekly', '2026-11-09 20:00:00+00', 250),
       ('x162-qb', 2026, 8, 'weekly', '2026-11-02 20:00:00+00', 100);
insert into league_chat (league_id, user_id, message, context, is_system)
values (pg_temp.lg('LA'), '99162000-0000-4000-8000-000000000003', 'hello league', 'league', false);
delete from score_fanout where player_id like 'x162-%';

-- LB drafting; LP scheduled with a PAUSED real draft; LA gets a live mock.
insert into drafts (league_id, status, draft_type, is_mock, draft_order) values
 (pg_temp.lg('LP'), 'paused', 'snake', false, '[]'),
 (pg_temp.lg('MW'), 'live', 'snake', true, '[]'),
 (pg_temp.lg('MC'), 'live', 'snake', true, '[]');
update drafts set config = jsonb_build_object('mock', jsonb_build_object('launched_by', '99162000-0000-4000-8000-000000000003')),
                  updated_at = now() - interval '80 hours'
where league_id in (pg_temp.lg('MW'), pg_temp.lg('MC'));

-- Waiver leagues: weeks 1–14 upcoming; the SAME claims in both (131's
-- shape): A bids 30 on Ex; B bids 20 on Ex and 5 on Why.
insert into league_weeks (league_id, season, week)
select l.id, 2026, g from leagues l, generate_series(1, 14) g
where l.name in ('pgtap-x162-JW', 'pgtap-x162-JC', 'pgtap-x162-KW', 'pgtap-x162-KC');
insert into drafts (league_id, status, completed_at, draft_order)
select pg_temp.lg(x), 'complete', '2026-09-06 06:00:00+00', jsonb_build_array(pg_temp.team(x, 1), pg_temp.team(x, 2))
from unnest(array['JW', 'JC']) x;
insert into waiver_claims (league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order, action_id, created_by)
select pg_temp.lg(x), pg_temp.team(x, c.k), c.p, null, c.bid, c.ord, gen_random_uuid(),
       case c.k when 1 then '99162000-0000-4000-8000-000000000003'::uuid else '99162000-0000-4000-8000-000000000005'::uuid end
from unnest(array['JW', 'JC']) x,
     (values (1, 'x162-x', 30, 1), (2, 'x162-x', 20, 1), (2, 'x162-y', 5, 2)) c(k, p, bid, ord);
-- Advance leagues: only week 9, upcoming. Finalize leagues: week 7 in its
-- correction window. Lock leagues: a rostered player and no pool row yet.
insert into league_weeks (league_id, season, week)
select pg_temp.lg(x), 2026, 9 from unnest(array['VW', 'VC']) x;
insert into league_weeks (league_id, season, week, status)
select pg_temp.lg(x), 2026, 7, 'correction_window' from unnest(array['FW', 'FC']) x;
insert into league_rosters (league_id, team_id, player_id)
select pg_temp.lg(x), pg_temp.team(x, 1), 'x162-k' from unnest(array['KW', 'KC']) x;
-- Trade leagues (setup): one open offer each — the tick's sweep closes an
-- offer in a league that is not in its season.
insert into trades (league_id, proposer_team_id, recipient_team_id, status, proposed_by, action_id)
select pg_temp.lg(x), pg_temp.team(x, 1), pg_temp.team(x, 2), 'proposed', '99162000-0000-4000-8000-000000000003', gen_random_uuid()
from unnest(array['TW', 'TC']) x;
-- LA's trades (R1728): offered, in review, accepted but deferred — and one
-- already complete, which archiving must leave alone.
insert into trades (id, league_id, proposer_team_id, recipient_team_id, status, proposed_by, action_id,
                    accepted_at, accepted_by, review_deadline, execute_after, resolved_at, created_at) values
 ('e1620000-0000-4000-8000-000000000001', pg_temp.lg('LA'), pg_temp.team('LA', 1), pg_temp.team('LA', 2), 'proposed',
  '99162000-0000-4000-8000-000000000003', gen_random_uuid(), null, null, null, null, null, now() - interval '4 hours'),
 ('e1620000-0000-4000-8000-000000000002', pg_temp.lg('LA'), pg_temp.team('LA', 2), pg_temp.team('LA', 1), 'in_review',
  '99162000-0000-4000-8000-000000000005', gen_random_uuid(), now() - interval '3 hours', '99162000-0000-4000-8000-000000000003', now() + interval '1 day', null, null, now() - interval '3 hours'),
 ('e1620000-0000-4000-8000-000000000003', pg_temp.lg('LA'), pg_temp.team('LA', 1), pg_temp.team('LA', 2), 'accepted',
  '99162000-0000-4000-8000-000000000003', gen_random_uuid(), now() - interval '2 hours', '99162000-0000-4000-8000-000000000005', null, now() + interval '2 days', null, now() - interval '2 hours'),
 ('e1620000-0000-4000-8000-000000000004', pg_temp.lg('LA'), pg_temp.team('LA', 2), pg_temp.team('LA', 1), 'complete',
  '99162000-0000-4000-8000-000000000005', gen_random_uuid(), now() - interval '9 days', '99162000-0000-4000-8000-000000000003', null, null, now() - interval '8 days', now() - interval '9 days');
-- FQ: week 7 in its window, its game final — and a score still QUEUED for
-- its rostered QB. Finalize reads no queue (R1755 — 183's rule; the queue's
-- own gaps predate 212: F859 / F860), so the row does not hold the week.
insert into league_weeks (league_id, season, week, status) values (pg_temp.lg('FQ'), 2026, 7, 'correction_window');
insert into players (id, full_name, position, team, status) values ('x162-q2', 'X162 Q Two', 'QB', 'MIA', 'Active');
insert into league_rosters (league_id, team_id, player_id) values (pg_temp.lg('FQ'), pg_temp.team('FQ', 1), 'x162-q2');
insert into score_fanout (season, week, player_id, enqueued_at) values (2026, 7, 'x162-q2', '2026-10-26 20:00:00+00');
insert into players (id, full_name, position, team, status) values ('x162-q3', 'X162 Q Three', 'QB', 'MIA', 'Active');
-- FW (archived in §J, restored at J16) and FM (never archived; its week 7
-- enters the window just before J16) both roster x162-q3, who has a week-7
-- line and an existing queue row a drain is holding — LEASED when FW's
-- restore lands. The restore must re-arm it and take the lease back; FW's
-- restore window must hold FW alone, never FM (R1755).
insert into league_rosters (league_id, team_id, player_id) values
 (pg_temp.lg('FW'), pg_temp.team('FW', 1), 'x162-q3'), (pg_temp.lg('FM'), pg_temp.team('FM', 1), 'x162-q3');
insert into player_stats (player_id, season, week, stat_type, updated_at, pass_yards)
values ('x162-q3', 2026, 7, 'weekly', '2026-10-26 20:00:00+00', 180);
-- LR: plays by its OWN scoring system, owned by u1 (R1725).
insert into scoring_systems (id, name, owner_id, is_template, rules)
values ('51620000-0000-4000-8000-000000000001', 'pgtap-x162-LR scoring', '99162000-0000-4000-8000-000000000001', false,
        (select rules from scoring_systems where is_template and name = 'ESPN Standard'));
update leagues set scoring_system_id = '51620000-0000-4000-8000-000000000001' where id = pg_temp.lg('LR');
-- LX: an archived league whose manager u6 deletes his account (§X).
insert into league_chat (league_id, user_id, message, context, is_system)
values (pg_temp.lg('LX'), '99162000-0000-4000-8000-000000000006', 'bye', 'league', false);

create temp table r162 (tag text primary key, r jsonb);
grant all on r162 to anon, authenticated, service_role;

create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.err(text) to anon, authenticated;
create or replace function pg_temp.as_user(p_n int) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', '99162000-0000-4000-8000-00000000000' || p_n, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(int) to anon, authenticated;
create or replace function pg_temp.receipts(p_league uuid) returns text language sql as $$
  select coalesce(string_agg(format('%s:%s>%s', action_type, before ->> 'archived', after ->> 'archived'), ',' order by created_at, action_type), '-')
  from commissioner_actions where league_id = p_league
$$;
grant execute on function pg_temp.receipts(uuid) to authenticated;
create or replace function pg_temp.lines(p_league uuid) returns text language sql as $$
  select coalesce(string_agg(message, ' || ' order by created_at, message), '-') from league_chat
  where league_id = p_league and is_system and user_id is null
$$;
grant execute on function pg_temp.lines(uuid) to authenticated;
-- The league's data as one md5: every table with a league_id AND the eight
-- that reach it through a draft / team / trade (R1732), the leagues row but
-- for the four columns the round trip moves. commissioner_actions and
-- league_chat are left out — the archive's and the restore's own record
-- lands there, and R3–R5 / R27–R28 count it exactly.
create or replace function pg_temp.fingerprint(p_league uuid) returns text language plpgsql as $$
declare
  v_out text := '';
  v_part text;
  r record;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'league_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname not in ('commissioner_actions', 'league_chat', 'job_pauses', 'platform_operator_actions')
    order by c.relname
  loop
    execute format('select coalesce(md5(string_agg(to_jsonb(t)::text, ''|'' order by to_jsonb(t)::text)), ''-'') from public.%I t where t.league_id = $1', r.relname)
      into v_part using p_league;
    v_out := v_out || r.relname || '=' || v_part || ';';
  end loop;
  for r in
    select * from (values
      ('draft_dnd_marks', 'draft_id', 'drafts'), ('draft_liveness', 'draft_id', 'drafts'), ('draft_queues', 'draft_id', 'drafts'),
      ('team_autopilot', 'team_id', 'teams'), ('team_lineups', 'team_id', 'teams'),
      ('trade_drops', 'trade_id', 'trades'), ('trade_items', 'trade_id', 'trades'), ('trade_votes', 'trade_id', 'trades')) v(tbl, key, parent)
  loop
    execute format('select coalesce(md5(string_agg(to_jsonb(t)::text, ''|'' order by to_jsonb(t)::text)), ''-'') from public.%I t where t.%I in (select id from public.%I where league_id = $1)',
                   r.tbl, r.key, r.parent)
      into v_part using p_league;
    v_out := v_out || r.tbl || '=' || v_part || ';';
  end loop;
  select md5((to_jsonb(l) - array['deleted_at', 'archived_by', 'updated_at', 'restored_at'])::text) into v_part from leagues l where l.id = p_league;
  return md5(v_out || 'leagues=' || v_part);
end;
$$;

-- ---------------------------------------------------------------------------
-- K. The gate — per role (F716)
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select alike(pg_temp.err($$ select archive_league('b1620000-0000-4000-8000-0000000000a1') $$), '42501:%', 'K1 anon cannot execute archive_league');
select alike(pg_temp.err($$ select restore_league('b1620000-0000-4000-8000-0000000000a1') $$), '42501:%', 'K2 …nor restore_league');
reset role;
set local role authenticated;
select pg_temp.as_user(4);
select is(pg_temp.err($$ select archive_league('b1620000-0000-4000-8000-0000000000a1') $$),
  '42501: archive_league: only the league''s commissioner can archive it — a co-commissioner or a manager cannot', 'K3 an outsider is refused by name');
select pg_temp.as_user(3);
select is(pg_temp.err($$ select archive_league('b1620000-0000-4000-8000-0000000000a1') $$),
  '42501: archive_league: only the league''s commissioner can archive it — a co-commissioner or a manager cannot', 'K4 a manager is refused by name');
select pg_temp.as_user(2);
select is(pg_temp.err($$ select archive_league('b1620000-0000-4000-8000-0000000000a1') $$),
  '42501: archive_league: only the league''s commissioner can archive it — a co-commissioner or a manager cannot', 'K5 a CO-COMMISSIONER is refused (F716 — the commissioner only)');
select is(pg_temp.err($$ select archive_league('b1620000-0000-4000-8000-00000000dead') $$),
  '42501: archive_league: only the league''s commissioner can archive it — a co-commissioner or a manager cannot', 'K6 a missing league: the same 42501 (no existence leak)');
select is(pg_temp.err($$ select soft_delete_league('b1620000-0000-4000-8000-0000000000a1') $$),
  '0A000: soft_delete_league: leagues are archived, not deleted — the commissioner archives the league (archive_league) and can restore it',
  'K7 soft_delete_league is retired — refused for a co-commissioner…');
select pg_temp.as_user(1);
select is(pg_temp.err($$ select soft_delete_league('b1620000-0000-4000-8000-0000000000a1') $$),
  '0A000: soft_delete_league: leagues are archived, not deleted — the commissioner archives the league (archive_league) and can restore it',
  'K8 …and for the commissioner too');
select is(pg_temp.err(format($f$ select archive_league('b1620000-0000-4000-8000-0000000000a1', %L) $f$, repeat('x', 501))),
  '22023: archive_league: the reason is 501 characters — keep it to 500 or fewer', 'K9 a reason past 500 characters is refused by name');
select is(pg_temp.err($$ select archive_league('b1620000-0000-4000-8000-0000000000b1') $$),
  '55000: archive_league: the draft is in progress — finish or reset the draft before archiving the league', 'K10 a league that is drafting cannot be archived (D781 — Chris ruled R1726 2026-10-27: "Block it until the draft ends")');
select is(pg_temp.err($$ select archive_league('b1620000-0000-4000-8000-0000000000b2') $$),
  '55000: archive_league: the draft is in progress — finish or reset the draft before archiving the league', 'K11 …nor one whose real draft is paused');
reset role;
select is(
  (select format('%s|%s|%s', count(*) filter (where l.deleted_at is not null),
     (select count(*) from commissioner_actions a where a.league_id = any (array[pg_temp.lg('LA'), pg_temp.lg('LB'), pg_temp.lg('LP')])),
     (select count(*) from league_chat c where c.is_system and c.league_id = any (array[pg_temp.lg('LA'), pg_temp.lg('LB'), pg_temp.lg('LP')])))
   from leagues l where l.id = any (array[pg_temp.lg('LA'), pg_temp.lg('LB'), pg_temp.lg('LP')])),
  '0|0|0', 'K12 no refusal stamped a league, wrote a receipt or posted a line');

-- ---------------------------------------------------------------------------
-- R. The round trip on LA
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(1);
insert into r162 select 'R1', archive_league('b1620000-0000-4000-8000-0000000000a1', '  season on hold  ');
reset role;
select is((select format('%s|%s|%s|%s', r ->> 'changed', r ->> 'archived', r ->> 'status', r ->> 'reason') from r162 where tag = 'R1'),
  'true|true|in_season|season on hold', 'R1 the commissioner archives (the reason trimmed)');
select is(
  (select format('%s|%s', deleted_at = now(), archived_by) from leagues where id = pg_temp.lg('LA')),
  't|99162000-0000-4000-8000-000000000001', 'R2 the stamp: archived now, by u1');
select is(pg_temp.receipts(pg_temp.lg('LA')), 'archive_league:false>true', 'R3 ONE receipt, {archived} false → true');
select is(
  (select format('%s|%s|%s|%s|%s', actor_id, target_type, target_id = pg_temp.lg('LA')::text, reason, metadata ->> 'verb')
   from commissioner_actions where league_id = pg_temp.lg('LA')),
  '99162000-0000-4000-8000-000000000001|league|t|season on hold|archive_league', 'R4 …the receipt names the actor, the league and the reason');
select is((select message from league_chat where league_id = pg_temp.lg('LA') and is_system and message like 'x162_user1 %'), 'x162_user1 archived the league — reason: season on hold.', 'R5 ONE archive line in plain words');
select is((select r ->> 'commissioner_action_id' from r162 where tag = 'R1'),
  (select id::text from commissioner_actions where league_id = pg_temp.lg('LA')), 'R6 the result names its receipt');
-- R1728 (Chris 2026-10-27: "the trade goes away and has to be redone later").
select is(
  (select string_agg(right(id::text, 1) || ':' || status || ':' || (resolved_at = now()) || ':' || coalesce(resolved_by::text, '-'), ' ' order by id)
   from trades where league_id = pg_temp.lg('LA')),
  '1:cancelled:true:99162000-0000-4000-8000-000000000001 2:cancelled:true:99162000-0000-4000-8000-000000000001 3:cancelled:true:99162000-0000-4000-8000-000000000001 4:complete:false:-',
  'R6a archiving CANCELS every unfinished trade — offered, in review, accepted but deferred — and leaves a finished one alone (R1728)');
select is((select string_agg(distinct status_reason, ' | ') from trades where league_id = pg_temp.lg('LA') and status = 'cancelled'),
  'Cancelled because the league was archived — propose it again after it''s restored.', 'R6b …each with the plain reason');
select is((select format('%s|%s', r ->> 'trades_cancelled', jsonb_array_length(r -> 'cancelled_trade_ids')) from r162 where tag = 'R1'),
  '3|3', 'R6c …the result counts them');
select is(
  (select count(*)::int from league_chat where league_id = pg_temp.lg('LA') and is_system
     and message like 'Archiving the league cancelled 3 trades that weren''t finished — propose them again after the league is restored: %'),
  1, 'R6d …ONE league line lists them');
select is(
  (select string_agg(format('%s:%s', right(user_id::text, 1), count), ' ' order by user_id)
   from (select user_id, count(*) from notifications where type = 'league_trade_cancelled' and data ->> 'league_id' = pg_temp.lg('LA')::text group by user_id) x),
  '3:3 5:3', 'R6e …and both managers are told, once per trade');
select is((select jsonb_array_length(metadata -> 'cancelled_trade_ids') from commissioner_actions where league_id = pg_temp.lg('LA') and action_type = 'archive_league'),
  3, 'R6f …the receipt names the cancelled trades');
insert into r162 select 'FP0', to_jsonb(pg_temp.fingerprint(pg_temp.lg('LA')));

-- Replay: nothing written.
set local role authenticated;
select pg_temp.as_user(1);
insert into r162 select 'R7', archive_league('b1620000-0000-4000-8000-0000000000a1');
reset role;
select is((select format('%s|%s', r ->> 'changed', r ->> 'why') from r162 where tag = 'R7'),
  'false|already_archived — this league is already archived; nothing was written', 'R7 archiving again is a no-op that says why');
select is(format('%s|%s', pg_temp.receipts(pg_temp.lg('LA')), (select count(*) from league_chat where league_id = pg_temp.lg('LA') and is_system)),
  'archive_league:false>true|2', 'R8 …no second receipt, no further line (the archive line + the trades line)');

-- While archived: members cannot act, nor can anyone write its rows.
set local role authenticated;
select pg_temp.as_user(3);
select is(pg_temp.err($$ insert into league_chat (league_id, user_id, message, context, is_system)
  values ('b1620000-0000-4000-8000-0000000000a1', '99162000-0000-4000-8000-000000000003', 'anyone?', 'league', false) $$),
  '55000: This league is archived, so nothing in it can change. Its commissioner can restore it from Leagues › Archived leagues.',
  'R9 a member''s chat post is refused, in plain words');
select alike(pg_temp.err(format($f$ select rename_own_team(%L, 'New Name') $f$, pg_temp.team('LA', 1))), '55000: This league is archived%',
  'R10 a manager''s own-team rename is refused');
select pg_temp.as_user(2);
select is(pg_temp.err($$ select commish_set_league_note('b1620000-0000-4000-8000-0000000000a1', 'note') $$),
  '42501: commish_set_league_note: only this league''s commissioner or a co-commissioner can change the commissioner note',
  'R11 a co-commissioner''s commissioner verb is refused (an archived league reads as not found to every verb that checks — the no-leak refusal)');
select pg_temp.as_user(1);
select is(pg_temp.err($$ select update_league_profile(p_league_id => 'b1620000-0000-4000-8000-0000000000a1', p_name => 'Renamed') $$),
  'P0001: update_league_profile: league b1620000-0000-4000-8000-0000000000a1 not found',
  'R12 …and so is the commissioner''s own rename (nothing in it changes)');
-- Reads still work: the member sees the row (how Archived leagues lists it).
select pg_temp.as_user(3);
select is((select format('%s|%s', count(*), bool_and(deleted_at is not null)) from leagues where id = 'b1620000-0000-4000-8000-0000000000a1'),
  '1|t', 'R13 a member still READS the archived league''s row');
select is((select count(*)::int from matchups where league_id = 'b1620000-0000-4000-8000-0000000000a1'), 1,
  'R14 …and its history');
reset role;
-- The owner (service role's peer) is refused too, per key.
select is(pg_temp.err(format($f$ update matchups set home_score = 99 where league_id = %L $f$, pg_temp.lg('LA'))),
  '55000: This league is archived, so nothing in it can change. Its commissioner can restore it from Leagues › Archived leagues.',
  'R15 a direct score write is refused (league_id key)');
select alike(pg_temp.err(format($f$ insert into league_rosters (league_id, team_id, player_id) values (%L, %L, 'x162-x') $f$, pg_temp.lg('LA'), pg_temp.team('LA', 2))),
  '55000:%', 'R16 a roster insert is refused');
select alike(pg_temp.err(format($f$ delete from team_lineups where team_id = %L $f$, pg_temp.team('LA', 1))), '55000:%',
  'R17 a lineup delete is refused (team_id key)');
select alike(pg_temp.err(format($f$ insert into team_autopilot (team_id, is_on) values (%L, true) $f$, pg_temp.team('LA', 2))), '55000:%',
  'R18 an autopilot switch is refused (team_id key)');
select alike(pg_temp.err(format($f$ delete from league_members where league_id = %L and role = 'manager' $f$, pg_temp.lg('LA'))), '55000:%',
  'R19 removing a member is refused');
select alike(pg_temp.err(format($f$ update leagues set name = 'pgtap-x162-LA-renamed' where id = %L $f$, pg_temp.lg('LA'))), '55000:%',
  'R20 the leagues row itself refuses a rename while archived');
select alike(pg_temp.err(format($f$ update leagues set deleted_at = null, archived_by = null, name = 'sneaky' where id = %L $f$, pg_temp.lg('LA'))), '55000:%',
  'R21 …and a "restore" that changes anything else');
select is((select format('%s|%s', count(*), sum(home_score)) from matchups where league_id = pg_temp.lg('LA')), '1|12.5',
  'R22 nothing moved: the matchup is as it was');

-- Restore.
set local role authenticated;
select pg_temp.as_user(2);
select is(pg_temp.err($$ select restore_league('b1620000-0000-4000-8000-0000000000a1') $$),
  '42501: restore_league: only the league''s commissioner can restore it — a co-commissioner or a manager cannot', 'R23 a co-commissioner cannot restore');
select pg_temp.as_user(3);
select is(pg_temp.err($$ select restore_league('b1620000-0000-4000-8000-0000000000a1') $$),
  '42501: restore_league: only the league''s commissioner can restore it — a co-commissioner or a manager cannot', 'R24 …nor a manager');
select pg_temp.as_user(1);
insert into r162 select 'R25', restore_league('b1620000-0000-4000-8000-0000000000a1');
reset role;
select is((select format('%s|%s|%s', r ->> 'changed', r ->> 'archived', r ->> 'scores_requeued') from r162 where tag = 'R25'),
  'true|false|2', 'R25 the commissioner restores; the QB''s two not-final weeks re-queued (D782)');
select is((select format('%s|%s|%s', deleted_at is null, archived_by is null, restored_at = now()) from leagues where id = pg_temp.lg('LA')), 't|t|t', 'R26 the stamp is cleared; restored_at records the restore (R1750)');
select is(pg_temp.receipts(pg_temp.lg('LA')), 'archive_league:false>true,restore_league:true>false', 'R27 ONE restore receipt, true → false');
select is((select string_agg(message, ' || ' order by created_at, message) from league_chat where league_id = pg_temp.lg('LA') and is_system and message like 'x162_user1 %'),
  'x162_user1 archived the league — reason: season on hold. || x162_user1 restored the league.', 'R28 ONE restore line');
select is(
  (select string_agg(format('%s:%s=%s', week, player_id, enqueued_at), ',' order by week) from score_fanout where player_id = 'x162-qb'),
  '8:x162-qb=2026-11-02 20:00:00+00,9:x162-qb=2026-11-09 20:00:00+00',
  'R29 the queue rows carry each line''s own stamp — the worker reads them as landed');
select ok((select bool_and(deferred_until = now()) from score_fanout where player_id = 'x162-qb'),
  'R29b R1731: …and deferred_until = the restore instant — fresh to the stall check, claimable at once');
select is((select status from trades where id = 'e1620000-0000-4000-8000-000000000003'), 'cancelled',
  'R29c the deferred trade stays cancelled — nothing executes on restore (R1728)');
select is(pg_temp.fingerprint(pg_temp.lg('LA')), (select r #>> '{}' from r162 where tag = 'FP0'),
  'R30 THE LEAGUE CAME BACK EXACTLY AS IT WAS ARCHIVED — every league_id table, the eight parent-keyed ones and the leagues row byte-identical to the moment after the archive (the receipts and lines are counted separately)');
set local role authenticated;
select pg_temp.as_user(1);
insert into r162 select 'R31', restore_league('b1620000-0000-4000-8000-0000000000a1');
reset role;
select is((select format('%s|%s', r ->> 'changed', r ->> 'why') from r162 where tag = 'R31'),
  'false|not_archived — this league is not archived; nothing was written', 'R31 restoring again is a no-op that says why');
select is(format('%s|%s', (select count(*) from commissioner_actions where league_id = pg_temp.lg('LA')), (select count(*) from league_chat where league_id = pg_temp.lg('LA') and is_system)),
  '2|3', 'R32 …no third receipt and no further line');
set local role authenticated;
select pg_temp.as_user(3);
select is(pg_temp.err($$ insert into league_chat (league_id, user_id, message, context, is_system)
  values ('b1620000-0000-4000-8000-0000000000a1', '99162000-0000-4000-8000-000000000003', 'we are back', 'league', false) $$),
  'no error', 'R33 after the restore members act again');
reset role;

-- A live PRACTICE draft never blocks an archive (MW archives below in §J).

-- ---------------------------------------------------------------------------
-- J. Every scheduled job skips an archived league
-- ---------------------------------------------------------------------------
-- Archive the W leagues (and DW, DR) as the commissioner, at injected instants.
select pg_temp.as_user(1);
insert into r162 select 'J0' || x, archive_league_internal(pg_temp.lg(x), null, '2026-10-29 09:00:00+00')
from unnest(array['JW', 'VW', 'FW', 'KW', 'TW', 'MW', 'DW', 'DR', 'LX']) x;
select is(
  (select string_agg(right(l.name, 2) || ':' || (l.deleted_at is not null), ' ' order by l.name) from leagues l
   where l.name ~ '^pgtap-x162-(JW|VW|FW|KW|TW|MW|DW|DR|LX)$'),
  'DR:true DW:true FW:true JW:true KW:true LX:true MW:true TW:true VW:true',
  'J1 nine leagues archived — MW with a live practice draft (a mock never blocks an archive)');
-- DR is restored now — after its draft time (an hour ago).
insert into r162 select 'J0DRr', restore_league_internal(pg_temp.lg('DR'), null, now());
-- DL's restore receipt is planted two hours ago — BEFORE its draft time.
insert into commissioner_actions (league_id, actor_id, action_type, target_type, target_id, before, after, metadata, created_at)
values (pg_temp.lg('DL'), '99162000-0000-4000-8000-000000000001', 'restore_league', 'league', pg_temp.lg('DL')::text,
        '{"archived": true}', '{"archived": false}', '{"verb": "restore_league"}', now() - interval '2 hours');
select set_config('request.jwt.claims', '', true);

-- Waivers — the cron path (every league) at the run instant.
create or replace function pg_temp.wstate(p_league uuid) returns text language sql as $$
  select string_agg(format('%s[%s|$%s|%s]', right(t.name, 1),
    (select string_agg(c.add_player_id || ':' || c.status || coalesce(':' || c.result_reason, ''), ',' order by c.claim_order)
     from waiver_claims c where c.team_id = t.id),
    (select m.faab_balance from league_members m where m.team_id = t.id),
    coalesce((select string_agg(r.player_id, ',' order by r.player_id) from league_rosters r where r.team_id = t.id), '-')),
    ' ' order by t.name)
  from teams t where t.league_id = p_league
$$;
insert into r162 select 'J2', waiver_tick('2026-11-01 12:00:00+00', null);
select is(pg_temp.wstate(pg_temp.lg('JC')), '1[x162-x:won|$70|x162-x] 2[x162-x:lost:outbid,x162-y:won|$95|x162-y]',
  'J2 waivers: the control league settles (stored literal)');
select is(pg_temp.wstate(pg_temp.lg('JW')), '1[x162-x:pending|$100|-] 2[x162-x:pending,x162-y:pending|$100|-]',
  'J3 waivers: ARCHIVED — every claim pending in order, FAAB untouched, no roster write');
select is(
  (select format('%s|%s', l.waiver_next_run_at, (select count(*) from waiver_runs w where w.league_id = l.id)) from leagues l where l.id = pg_temp.lg('JW')),
  '2026-11-01 12:00:00+00|0', 'J4 …its run still due, no run row');
-- Week advance.
insert into r162 select 'J5', league_week_advance('2026-11-04 06:00:00+00', null);
select is(
  (select string_agg(right(l.name, 2) || ':' || lw.status, ' ' order by l.name) from league_weeks lw join leagues l on l.id = lw.league_id
   where l.name in ('pgtap-x162-VW', 'pgtap-x162-VC')),
  'VC:live VW:upcoming', 'J5 week advance: the control opens week 9, the archived league''s stays upcoming');
-- Week finalize.
insert into r162 select 'J6', finalize_matchups('2026-10-29 11:05:00+00', null);
select is(
  (select string_agg(right(l.name, 2) || ':' || lw.status, ' ' order by l.name) from league_weeks lw join leagues l on l.id = lw.league_id
   where l.name in ('pgtap-x162-FW', 'pgtap-x162-FC')),
  'FC:final FW:correction_window', 'J6 week finalize: the control''s week 7 is final, the archived league''s is not');
select ok((select not (r::text like '%' || pg_temp.lg('FW')::text || '%') from r162 where tag = 'J6'),
  'J7 …the archived league was never claimed by the run');
-- §Q — R1755: finalize reads no queue. R1730 / R1750's queue hold is gone
-- (it leaked across leagues — R1755 / R1756); a restored league waits out its
-- own restore window instead (§J19). A score still queued for a rostered
-- player does not hold the week — 183's rule, unchanged by 212.
select is(
  (select format('%s|%s', (select status from league_weeks where league_id = pg_temp.lg('FQ')),
     (select count(*) from jsonb_array_elements(r -> 'skipped') x where x ->> 'league_id' = pg_temp.lg('FQ')::text))
   from r162 where tag = 'J6'),
  'final|0', 'Q1 R1755: a queued score for a rostered player does not hold the week — the every-league run finalized FQ with no skip (finalize reads no queue; the queue''s own gaps are F859 / F860)');
select is((select count(*)::int from score_fanout where season = 2026 and week = 7 and player_id = 'x162-q2'), 1,
  'Q2 …and the row is still queued: finalize neither read nor consumed it (the premise is real)');
-- Lineup lock.
insert into r162 select 'J8', lineup_lock_tick('2026-11-04 06:00:00+00', null);
select is(
  (select string_agg(right(l.name, 2) || ':' || (select count(*) from league_player_pool p where p.league_id = l.id), ' ' order by l.name)
   from leagues l where l.name in ('pgtap-x162-KW', 'pgtap-x162-KC')),
  'KC:1 KW:0', 'J8 lineup lock: the control''s rostered player enters the lock view, the archived league is untouched');
select ok((select not (r::text like '%' || pg_temp.lg('KW')::text || '%') from r162 where tag = 'J8'),
  'J9 …and is not named anywhere in the tick''s report');
-- Trade tick.
insert into r162 select 'J10', trade_tick('2026-10-29 12:00:00+00', null);
select is(
  (select string_agg(right(l.name, 2) || ':' || t.status, ' ' order by l.name) from trades t join leagues l on l.id = t.league_id
   where l.name in ('pgtap-x162-TW', 'pgtap-x162-TC')),
  'TC:invalid TW:cancelled', 'J10 trade tick: the control''s out-of-season offer is swept; the archived league''s was CANCELLED at the archive (R1728) and the tick leaves it alone');
select is((select resolved_at from trades t where t.league_id = pg_temp.lg('TW')), '2026-10-29 09:00:00+00'::timestamptz,
  'J10b …resolved at the archive instant, never by the tick');
select ok((select not (r::text like '%' || pg_temp.lg('TW')::text || '%') from r162 where tag = 'J10'),
  'J11 …the archived league is neither a candidate nor claimed');
insert into r162 select 'J12', trade_tick('2026-10-29 12:00:00+00', pg_temp.lg('TW'));
select is((select format('%s|%s', r ->> 'candidates', r ->> 'reason') from r162 where tag = 'J12'), '0|no_trades_in_flight',
  'J12 a run scoped to the archived league finds nothing to do');
-- Mock expiry.
insert into r162 select 'J13', mock_draft_expire();
select is(
  (select string_agg(right(l.name, 2) || ':' || (select count(*) from drafts d where d.league_id = l.id and d.is_mock), ' ' order by l.name)
   from leagues l where l.name in ('pgtap-x162-MW', 'pgtap-x162-MC')),
  'MC:0 MW:1', 'J13 mock expiry: the control''s idle practice draft is expired; the archived league''s is kept');
-- Draft auto-start (ARM 1) — every draft league is capacity-short, so an
-- attempt fails INTO the summary by name (022 §G's LF).
insert into r162 select 'J14', draft_tick();
select is(
  (select string_agg(x || ':' || ((r -> 'start_failures') @> jsonb_build_array(jsonb_build_object('league_id', pg_temp.lg(x)))), ' ' order by x)
   from r162, unnest(array['DC', 'DW', 'DR', 'DL']) x where tag = 'J14'),
  'DC:true DL:true DR:false DW:false',
  'J14 auto-start: the control and DL (restored BEFORE its draft time) are attempted; the archived DW and DR (restored AFTER its draft time) are not (D785)');
select is(
  (select string_agg(right(l.name, 2) || ':' || l.status || ':' || (select count(*) from drafts d where d.league_id = l.id and not d.is_mock), ' ' order by l.name)
   from leagues l where l.name ~ '^pgtap-x162-D[WR]$'),
  'DR:scheduled:0 DW:scheduled:0', 'J15 …neither of them was started or given a drafts row');

-- Restore, and each job catches up through its normal rule.
select pg_temp.as_user(1);
insert into league_weeks (league_id, season, week, status) values (pg_temp.lg('FM'), 2026, 7, 'correction_window');   -- after J6, so J6 could not finalize it
insert into score_fanout (season, week, player_id, enqueued_at, deferred_until, claimed_at, claim_token)
values (2026, 7, 'x162-q3', '2026-10-26 20:00:00+00', null, '2026-11-04 06:59:50+00', gen_random_uuid());   -- a drain holds the lease as FW comes back
insert into r162 select 'J16' || x, restore_league_internal(pg_temp.lg(x), null, '2026-11-04 07:00:00+00')
from unnest(array['JW', 'VW', 'FW']) x;
select is(
  (select format('%s|%s|%s', deferred_until = '2026-11-04 07:00:00+00'::timestamptz, claimed_at is null, claim_token is null)
   from score_fanout where season = 2026 and week = 7 and player_id = 'x162-q3'),
  't|t|t', 'J16b R1750 / R1755: the restore RE-ARMS an existing row (deferred_until = its restore instant) and takes the lease back — a drain that leased it before the restore cannot ack it away without scoring FW (its ack reads lease_lost — R1757)');
select is((select restored_at from leagues where id = pg_temp.lg('FW')), '2026-11-04 07:00:00+00'::timestamptz,
  'J16c …and leagues.restored_at records the instant (the restore window opens there — R1755)');
select set_config('request.jwt.claims', '', true);
insert into r162 select 'J17', waiver_tick('2026-11-04 07:01:00+00', pg_temp.lg('JW'));
select is(pg_temp.wstate(pg_temp.lg('JW')), '1[x162-x:won|$70|x162-x] 2[x162-x:lost:outbid,x162-y:won|$95|x162-y]',
  'J17 restored: the due waiver run settles to the control''s IDENTICAL outcome (stored literal)');
insert into r162 select 'J18', league_week_advance('2026-11-04 07:05:00+00', pg_temp.lg('VW'));
select is((select status from league_weeks where league_id = pg_temp.lg('VW')), 'live', 'J18 restored: the week opens at the next advance');
-- R1755 — THE RESTORE WINDOW (30 minutes from leagues.restored_at = 07:00):
-- held at :05 and at :29:59 (the boundary), finalized at :30:00 exactly.
insert into r162 select 'J19', finalize_matchups('2026-11-04 07:05:00+00', pg_temp.lg('FW'));
select is(
  (select format('%s|%s', (select status from league_weeks where league_id = pg_temp.lg('FW')),
     (select x ->> 'reason' || ':' || (x ->> 'remaining_seconds') || ':' || (x ->> 'restored_at') from jsonb_array_elements(r -> 'skipped') x where x ->> 'league_id' = pg_temp.lg('FW')::text))
   from r162 where tag = 'J19'),
  'correction_window|recently_restored:1500:2026-11-04T07:00:00+00:00', 'J19 R1755: restored at 07:00, the 07:05 finalize SKIPS the finished week BY NAME — recently_restored, 1500 s left — so the restore''s scoring catch-up lands first');
insert into r162 select 'J19b', finalize_matchups('2026-11-04 07:29:59+00', pg_temp.lg('FW'));
select is(
  (select format('%s|%s', (select status from league_weeks where league_id = pg_temp.lg('FW')),
     (select x ->> 'reason' || ':' || (x ->> 'remaining_seconds') from jsonb_array_elements(r -> 'skipped') x where x ->> 'league_id' = pg_temp.lg('FW')::text))
   from r162 where tag = 'J19b'),
  'correction_window|recently_restored:1', 'J19b …one second before the window shuts it still waits (the boundary instant)');
insert into r162 select 'J19c', finalize_matchups('2026-11-04 07:30:00+00', pg_temp.lg('FW'));
select is(
  (select format('%s|%s', (select status from league_weeks where league_id = pg_temp.lg('FW')),
     (select count(*) from jsonb_array_elements(r -> 'skipped') x where x ->> 'league_id' = pg_temp.lg('FW')::text))
   from r162 where tag = 'J19c'),
  'final|0', 'J19c …and at 07:30:00 exactly the window is shut: the week is finalized by the normal rule (the queue row is not read — it is still there)');
insert into r162 select 'J19m', finalize_matchups('2026-11-04 07:05:00+00', pg_temp.lg('FM'));
select is(
  (select format('%s|%s|%s', (select status from league_weeks where league_id = pg_temp.lg('FM')),
     (select count(*) from jsonb_array_elements(r -> 'skipped') x where x ->> 'league_id' = pg_temp.lg('FM')::text),
     (select count(*) from score_fanout where season = 2026 and week = 7 and player_id = 'x162-q3'))
   from r162 where tag = 'J19m'),
  'final|0|1', 'J19m R1755: FM shares FW''s player and its re-armed queue row, and FW was restored five minutes earlier — FM''s week is finalized at 07:05 all the same (the window is league-local; nothing reads the queue)');
select is(
  (select format('%s|%s|%s', coalesce(league_restore_hold_internal(pg_temp.lg('FW'), '2026-11-04 07:04:00+00')::text, 'null'),
     coalesce(league_restore_hold_internal(pg_temp.lg('FW'), '2026-11-04 07:30:00+00')::text, 'null'),
     coalesce(league_restore_hold_internal(pg_temp.lg('FM'), '2026-11-04 07:04:00+00')::text, 'null'))),
  '1560|null|null', 'J19n league_restore_hold_internal: 1560 s left at 07:04, shut at 07:30, and never open for a league that was never restored');

-- ---------------------------------------------------------------------------
-- S. R1725 — an archived league still owns its scoring system
-- ---------------------------------------------------------------------------
select pg_temp.as_user(1);
insert into r162 select 'S0', archive_league_internal(pg_temp.lg('LR'), null, '2026-10-29 09:00:00+00');
set local role authenticated;
select pg_temp.as_user(1);
select alike(pg_temp.err($$ update scoring_systems set rules = (select rules from scoring_systems where is_template and name = 'ESPN Full PPR')
  where id = '51620000-0000-4000-8000-000000000001' $$),
  '42501: scoring system 51620000-0000-4000-8000-000000000001 is the scoring of league "pgtap-x162-LR"%',
  'S1 the owner''s DIRECT rules write on an archived league''s scoring is refused — it still belongs to the league (R1725)');
reset role;
select is((select rules = (select rules from scoring_systems where is_template and name = 'ESPN Standard') from scoring_systems where id = '51620000-0000-4000-8000-000000000001'),
  true, 'S2 …and nothing moved');

-- ---------------------------------------------------------------------------
-- O. F851 — the operator restores; R1733 — the archived wording
-- ---------------------------------------------------------------------------
select pg_temp.as_user(1);
insert into r162 select 'O0', archive_league_internal(pg_temp.lg('LO'), null, '2026-10-29 09:00:00+00');
set local role authenticated;
select pg_temp.as_user(1);
select is(pg_temp.err($$ select op_restore_league('b1620000-0000-4000-8000-000000000092', gen_random_uuid()) $$),
  '42501: restore_league: only a platform operator can use the operator tools (M8 TD1)', 'O1 the league''s own commissioner cannot use the operator''s door');
select pg_temp.as_user(7);
select is(pg_temp.err(format($f$ select op_set_commissioner('b1620000-0000-4000-8000-000000000092', %L, gen_random_uuid()) $f$,
    (select id from league_members where league_id = pg_temp.lg('LO') and role = 'manager' limit 1))),
  'P0002: set_commissioner: league b1620000-0000-4000-8000-000000000092 is archived — restore it first (the admin league page''s Restore)',
  'O2 R1733: an operator verb on an archived league says ARCHIVED, not "does not exist"');
insert into r162 select 'O3', op_restore_league('b1620000-0000-4000-8000-000000000092', 'a1620000-0000-4000-8000-000000000001', 'commissioner gone');
reset role;
select is((select format('%s|%s', r ->> 'changed', r ->> 'archived') from r162 where tag = 'O3'), 'true|false', 'O3 the operator restores the league');
select is((select deleted_at is null from leagues where id = pg_temp.lg('LO')), true, 'O4 …the stamp is cleared');
select is((select string_agg(message, ' || ' order by created_at, message) from league_chat where league_id = pg_temp.lg('LO') and is_system and message like 'FieldScout%'),
  'FieldScout restored the league.', 'O5 …one "FieldScout" line, no operator named');
select is((select format('%s|%s|%s|%s', verb, scope, reason, after ->> 'archived') from platform_operator_actions where action_id = 'a1620000-0000-4000-8000-000000000001'),
  'restore_league|league|commissioner gone|false', 'O6 …one operator receipt');
select is((select string_agg(action_type, ',' order by created_at) from commissioner_actions where league_id = pg_temp.lg('LO')),
  'archive_league', 'O7 …and no commissioner-log row for the operator (D671)');
set local role authenticated;
select pg_temp.as_user(7);
insert into r162 select 'O8', op_restore_league('b1620000-0000-4000-8000-000000000092', 'a1620000-0000-4000-8000-000000000001', 'commissioner gone');
insert into r162 select 'O9', op_restore_league('b1620000-0000-4000-8000-000000000092', 'a1620000-0000-4000-8000-000000000002');
reset role;
select is((select format('%s|%s', (select r ->> 'replayed' from r162 where tag = 'O8'), (select r ->> 'why' from r162 where tag = 'O9'))),
  'true|not_archived — this league is not archived; nothing was written', 'O8 a replay returns the receipt; a restore of a live league is the no-op');
select is(format('%s|%s', (select count(*) from platform_operator_actions where league_id = pg_temp.lg('LO')),
    (select count(*) from league_chat where league_id = pg_temp.lg('LO') and message like 'FieldScout%')),
  '1|1', 'O9 …neither wrote a receipt or a line');

-- ---------------------------------------------------------------------------
-- X. Account deletion is never blocked by an archived league
-- ---------------------------------------------------------------------------
select is(pg_temp.err($$ delete from auth.users where id = '99162000-0000-4000-8000-000000000006' $$), 'no error',
  'X1 a member of an archived league deletes his account (the FK actions run at trigger depth > 1)');
select is(
  (select format('%s|%s|%s', l.deleted_at is not null,
     (select count(*) from league_members m where m.league_id = l.id and m.user_id = '99162000-0000-4000-8000-000000000006'),
     (select count(*) from league_chat c where c.league_id = l.id and c.user_id is null and not c.is_system))
   from leagues l where l.id = pg_temp.lg('LX')),
  't|0|1', 'X2 …the league stays archived; his seat went with the account and his chat line stayed (author cleared)');

-- ---------------------------------------------------------------------------
-- W. The no-write-policy pattern per role (§4.2): the guard is not a way in
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(1);
with u as (update leagues set deleted_at = null, archived_by = null where id = pg_temp.lg('MW') returning 1)
insert into r162 select 'W1', to_jsonb(count(*)) from u;
select is((select r::int from r162 where tag = 'W1'), 0, 'W1 the commissioner cannot clear the stamp directly (no client UPDATE policy on leagues; RETURNING count)');
with u as (update leagues set deleted_at = now() where id = pg_temp.lg('LA') returning 1)
insert into r162 select 'W2', to_jsonb(count(*)) from u;
select is((select r::int from r162 where tag = 'W2'), 0, 'W2 …nor set it directly');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
with u as (update leagues set deleted_at = null where id = pg_temp.lg('MW') returning 1)
insert into r162 select 'W3', to_jsonb(count(*)) from u;
select is((select r::int from r162 where tag = 'W3'), 0, 'W3 anon updates no league row');
reset role;
select is((select deleted_at is not null from leagues where id = pg_temp.lg('MW')), true, 'W4 MW is still archived');

select * from finish();
rollback;
