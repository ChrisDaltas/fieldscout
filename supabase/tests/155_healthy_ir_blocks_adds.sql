-- ============================================================================
-- 155 — a player who is healthy again in an IR spot blocks the team's adds
--       until he leaves it (migration 205; PROGRESS D593; spec v2.16.105
--       §7.3.2 / §11.2 / §13.1 / §13.2; F687 discharged)
-- ============================================================================
-- THE RULINGS (Chris, 2026-10-20, verbatim):
--   "the only thing you can't do is put a player that's not injured into an
--   IR spot and then if you have a player that was in the IR spot but then
--   they became healthy again while they were there, most platforms block you
--   from doing anything until you put that injured player or that formerly
--   injured player out of your IR spot. So you either have to if your roster
--   is full, you either have to drop someone and move them out of the IR
--   spot, or you have to swap in another IR-eligible player into the IR spot
--   before you can make other roster moves."
--   "Okay, when I say roster moves, I mean adds and drops. You can still
--   change who's on your bench and who's in your starting lineup."
--   "The only time you can't move a player between your bench and your
--   starting lineup is because they've locked, because their game has
--   started for the week."
-- AND (Chris, 2026-10-21, verbatim — F690 / F692 / F693 ruled):
--   "1. Nothing changes if the player is locked. that's tough luck. but
--   that's why we have ai roster automations coming. 2. Yes the user can
--   click on the player and drop them directly. the player detail page, mini
--   modal or card should have "Drop" as an option if they are droppable. Not
--   if they are locked for the week though. 3. No, if the player is no longer
--   IR eligible the claims are cancelled."
-- AND (Chris, 2026-10-21, verbatim — F693, correcting how answer 3 was first
-- built): "no the claims are not cancelled, they should fail when waivers
--   run. or maybe that is what you are saying another way..."
--
-- OWN FIXTURE: users 9205…, leagues b205…01 (LA — no waivers: instant
-- pickups, trades with no review) and b205…02 (LW — FAAB, a run every day at
-- 16:00 UTC, the next Sunday 10-18 16:00Z), teams c205…, action ids a205…,
-- players hi-* / hw-*, NFL teams HS (Sunday 17:00Z). Every instant is passed
-- explicitly (the TimeProvider rule); internals are called as postgres with
-- the actor's JWT claims set. One rolled-back transaction.
--
-- THE ROSTER (both leagues): qb ×1, rb ×1, bench 3, and two IR spots —
-- `ir` (unrestricted, OUT / IR) and `dl` (the DL preset: restricted, OUT /
-- IR / Doubtful, 4 weeks) — roster size 7. Week 6 is current; P = Sunday
-- 10-18 15:00Z, before every kickoff. Everyone on an IR spot went there in
-- week 5 (a DL stint runs to week 9).
--   LA  Alpha   a HEALTHY man in `ir` — blocked (the case)
--       Bravo   an OUT man in `ir`, a Doubtful man in `dl` — both still fit
--       Charlie a HEALTHY man in `dl`, his stint running — not blocked
--       Delta   a Doubtful man in `ir` (which takes OUT / IR only) — blocked
--       Echo    a HEALTHY man in `ir` — blocked (trades + the commissioner;
--               then, his game kicked off, the lock — F690)
--       Foxtrot a HEALTHY man in `ir` AND a healthy man in `dl` whose stint
--               ended — two blockers (F692: dropping one in an add + drop
--               leaves the other; dropping the last lets the add land)
--   LW  W Alpha a man in `ir` who is OUT when his two claims are placed,
--               then healthy (the sync's write) and STILL there at the run —
--               both claims fail; W Bravo claims the same free agent for less.
--       W Charlie a man in `ir` who is OUT when his two claims are placed,
--               then listed Doubtful (which a plain IR spot doesn't take) —
--               and FIXED before the run (moved to the bench): his claims
--               are processed as usual.
--
--   §A  FORM and D137: the posture of the helper and the four bodies; un205
--       gives back each of the four sources (199's FILE TEXT) byte for byte;
--       the live md5s are 205 as written; un205 is an identity on every other
--       body; the helper as written; the reason vocabulary names
--       healthy_in_ir among the INVALID (failed) reasons; nothing of the
--       retired cancel build is on the database (no cancel function, no
--       result_detail column).
--   §B  the check itself (the helper): per team, per spot's designations,
--       the Restricted stint; `why` says "healthy" only for a blank / Active
--       status — a Questionable or Inactive man (no designation, so no spot
--       takes him) blocks too and is named "listed Questionable" (B5).
--   §C  adds (roster_add_drop): a healthy IR occupant refuses an add alone
--       and an add + drop of someone else by name; a plain drop lands; the
--       Doubtful man in the plain IR spot refuses; still-fitting occupants and
--       a running DL stint block nothing; F692 — an add + drop whose DROP is
--       the healthy IR man lands and clears the block (with a second blocker,
--       dropping one still refuses, naming the other).
--   §D  lineup moves while blocked (set_lineup): a start / bench move saves;
--       swapping an IR-eligible player in and moving the healthy man out
--       lands — and then adds work again; moving Delta's man to the bench
--       lands, and then his add works.
--   §E  NOT blocked: a trade (Echo, blocked, trades and it executes); the
--       commissioner's force-add onto Echo. F690 as ruled: once his game has
--       kicked off, the block STANDS — an add + drop of him is refused by
--       the drop lock, an add alone by the block.
--   §W  claims (LW): a new claim is refused by name (the manager, and the
--       commissioner acting for the team); F693 as ruled — the claims placed
--       before he turned ineligible SURVIVE the flip (still pending, nobody
--       told); AT THE RUN each claim of the team still blocked FAILS (invalid
--       / healthy_in_ir, before the decision, nothing spent, its owner told
--       per claim in plain words, the player to the next claim in line); the
--       team that fixed it before the run gets its claims processed; the
--       run's counts; after the fix a claim is accepted.
--
-- BREAK PROBES (measured 2026-10-21 on the local DB, 205 applied; each
-- inserted right after the fixture, inside this transaction):
--   (a) the four bodies put back from pg_temp.un205(prosrc) — 199's text ⇒
--       18 of 43 red — C1 C2 C2b C4 C7 C8 C9 D3 D5 E4 W1 W2 W3 W5 W6 W7 W8
--       W9: every add and claim of a blocked team goes through, and at the
--       run W Alpha's claims win (C8 C9 D3 D5 W3 W9 follow: the moves they
--       repeat or count already went through). Green under it by design: §A
--       (measured before the probe), §B (the helper is 205's own), E3 (the
--       drop lock is 199's), W4 (a lineup move), and every way out — the
--       drop, the lineup moves, the trade, the commissioner's force-add.
--   (b) process_waivers_internal alone put back (199's run; the submit still
--       205's) ⇒ 4 of 43 red — W5 W6 W7 W8: the still-blocked team's claims
--       go to the decision and win, nobody is told of a failure. W3 stays
--       green under it: nothing but the run ever touches a pending claim.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(43);

-- pg_temp.un205 — migration 205's inserted lines removed (each ends
-- `-- 205 / D593`; 205 alters no line of 199's text); an identity on every
-- other body (A5).
create function pg_temp.un205(p_src text) returns text language sql as $un205$
  select regexp_replace(p_src, E'\n[^\n]*   -- 205 / D593', '', 'g')
$un205$;

-- ---------------------------------------------------------------------------
-- A. Form pins, D137 in the database
-- ---------------------------------------------------------------------------
create function pg_temp.four() returns text[] language sql as $$
  select array['roster_add_drop_internal', 'waiver_claim_submit_internal', 'process_waivers_internal', 'waiver_claim_notify_internal']
$$;
select is(
  (select string_agg(format('%s:%s:%s:%s:%s:%s:%s:%s', p.proname, l.lanname, p.provolatile, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE'),
                            has_function_privilege('service_role', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
   where n.nspname = 'public' and (p.proname = any (pg_temp.four()) or p.proname = 'ir_healthy_blockers_internal')),
  'ir_healthy_blockers_internal:sql:s:f:search_path="":f:f:t process_waivers_internal:plpgsql:v:f:search_path="":f:f:t roster_add_drop_internal:plpgsql:v:f:search_path="":f:f:t waiver_claim_notify_internal:plpgsql:v:f:search_path="":f:f:t waiver_claim_submit_internal:plpgsql:v:f:search_path="":f:f:t',
  'A1 the five: one overload each; the helper STABLE sql, the four VOLATILE plpgsql as before; none SECURITY DEFINER; search_path empty; closed to anon and authenticated, open to the service role');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and a.privilege_type = 'EXECUTE' and a.grantee = 0
      and (p.proname = any (pg_temp.four()) or p.proname = 'ir_healthy_blockers_internal')),
  'A2 PUBLIC holds EXECUTE on none of the five (REVOKEs restated)');
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un205(p.prosrc)), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any (pg_temp.four())),
  'process_waivers_internal=9e3aecda62b60c7bdc124f8efcd9cc62 roster_add_drop_internal=635060c519df0e420fc4cb7c64c9052f waiver_claim_notify_internal=75f0fb9a57bee9eb2ba47a460f0aec26 waiver_claim_submit_internal=382e6aec7b528c14a80370ff18b794a3',
  'A3 D137: each live body with 205''s lines removed is its newest definer''s FILE TEXT (199:1345 / 199:5041 / 199:1898 / 199:8040 — the md5s 149 A2 pins)');
select is(
  (select string_agg(p.proname || '=' || md5(p.prosrc) || '/' || (length(p.prosrc) - length(replace(p.prosrc, '   -- 205 / D593', ''))) / length('   -- 205 / D593'), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any (pg_temp.four())),
  'process_waivers_internal=88a138c852c959a8d57cc67d4079758e/37 roster_add_drop_internal=c0525a262a5a339ecf1311bb83e82142/23 waiver_claim_notify_internal=3a3755bb54a13455b1b3e9c8e1b3ec96/4 waiver_claim_submit_internal=43d3c7fcf5512bfdf8619ca786ace135/15',
  'A4 the four live prosrc md5s — 205 as written (stored literals) — and the lines it inserted (37 / 23 / 4 / 15)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and not (p.proname = any (pg_temp.four()))
     and pg_temp.un205(p.prosrc) <> p.prosrc),
  0,
  'A5 un205 is an identity on every other body in the schema, the helper included — so the older suites that apply it innermost pin exactly what they pinned (additive, R992)');
select is(
  (select md5(p.prosrc) || ' | ' || (obj_description(p.oid, 'pg_proc') like 'D593 / spec §7.3.2 (migration 205)%')::text
          || ' | ' || (col_description('public.waiver_claims'::regclass,
                         (select a.attnum from pg_attribute a where a.attrelid = 'public.waiver_claims'::regclass and a.attname = 'result_reason'))
                       like '%| no_waivers (the league switched to none_fcfs — F421(e)) | healthy_in_ir (205 / D593 / F693:%; cancelled = cancelled (the verb) | seat_vacated | manager_left (F411). NULL%')::text
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ir_healthy_blockers_internal'),
  '78c1a8fd8ba0a0a9079cfc450794a46a | true | true',
  'A6 the helper as written (a stored literal) with its comment; the stored-reason vocabulary names healthy_in_ir among the INVALID (failed) reasons — not the cancelled ones');
select is(
  format('cancel functions=%s | result_detail column=%s',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'waiver_claims_cancel_healthy_ir%'),
         (select count(*) from pg_attribute a where a.attrelid = 'public.waiver_claims'::regclass and a.attname = 'result_detail' and not a.attisdropped)),
  'cancel functions=0 | result_detail column=0',
  'A7 F693 as ruled ("they should fail when waivers run"): nothing of the retired cancel build is here — no cancel internal, no job door for the syncs, no result_detail column');

-- ---------------------------------------------------------------------------
-- FIXTURE
-- ---------------------------------------------------------------------------
update nfl_weeks w
set last_game_ends_at = case when w.week <= 5 then w.starts_at + interval '6 days'
                             when w.week = 6 then '2026-10-20 03:30:00+00'::timestamptz end,
    first_kickoff_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at)
select 'hi-dummy-' || w.week, 2026, w.week, 'KC', 'BUF', w.starts_at + interval '1 day' from nfl_weeks w where w.season = 2026 and w.week <= 14 and w.week <> 6;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('hi-g6', 2026, 6, 'HS', 'HT', '2026-10-18 17:00:00+00');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('92050000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-hi' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'hi_user' || i)::jsonb, now(), now()
from generate_series(1, 8) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, waiver_type, faab_budget, trade_review,
                     settings, roster_settings, waiver_next_run_at)
select l.id, '92050000-0000-4000-8000-000000000001', l.nm, 2026, 'in_season', 12, 14, 0, 15,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', l.wt, 100, 'none', l.st::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1},
                            {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
         "bench": 3,
         "ir_slots": [{"key": "ir", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]},
                      {"key": "dl", "label": "DL", "type": "restricted", "eligible_designations": ["OUT", "IR", "Doubtful"], "min_weeks": 4}],
         "swap_spots": 0}'::jsonb,
       l.nx
from (values
 ('b2050000-0000-4000-8000-000000000001'::uuid, 'pgtap-hi-LA', 'none_fcfs', '{}', null::timestamptz),
 ('b2050000-0000-4000-8000-000000000002'::uuid, 'pgtap-hi-LW', 'faab',
  '{"waiver_run_days": ["sun","mon","tue","wed","thu","fri","sat"], "waiver_run_time": "16:00", "waiver_time_zone": "UTC", "free_agency_opens": "after_waiver_run"}',
  '2026-10-18 16:00:00+00')
) as l(id, nm, wt, st, nx);

insert into teams (id, owner_id, name, league_id, status)
select t.id::uuid, ('92050000-0000-4000-8000-00000000000' || t.u)::uuid, t.nm, ('b2050000-0000-4000-8000-00000000000' || t.lg)::uuid, 'active'
from (values
 ('c2050000-0000-4000-8000-000000000011', 1, 'HI Commish', 1), ('c2050000-0000-4000-8000-000000000012', 2, 'HI Alpha', 1),
 ('c2050000-0000-4000-8000-000000000013', 3, 'HI Bravo', 1),   ('c2050000-0000-4000-8000-000000000014', 4, 'HI Charlie', 1),
 ('c2050000-0000-4000-8000-000000000015', 5, 'HI Delta', 1),   ('c2050000-0000-4000-8000-000000000016', 6, 'HI Echo', 1),
 ('c2050000-0000-4000-8000-000000000017', 7, 'HI Foxtrot', 1),
 ('c2050000-0000-4000-8000-000000000021', 1, 'HW Commish', 2), ('c2050000-0000-4000-8000-000000000022', 2, 'HW Alpha', 2),
 ('c2050000-0000-4000-8000-000000000023', 3, 'HW Bravo', 2),   ('c2050000-0000-4000-8000-000000000024', 8, 'HW Charlie', 2)
) as t(id, u, nm, lg);
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, t.owner_id, t.id,
       case when t.owner_id = '92050000-0000-4000-8000-000000000001' then 'commissioner' else 'manager' end, false, 100
from teams t where t.id::text like 'c2050000-%';

insert into league_weeks (league_id, season, week)
select l.id, 2026, w from leagues l cross join generate_series(1, 14) w where l.id::text like 'b2050000-%';
update league_weeks set status = 'live'              where league_id::text like 'b2050000-%' and week <= 6;
update league_weeks set status = 'correction_window' where league_id::text like 'b2050000-%' and week <= 5;
update league_weeks set status = 'final'             where league_id::text like 'b2050000-%' and week <= 5;
insert into drafts (league_id, status, completed_at, draft_order)
select l.id, 'complete', '2026-09-06 06:00:00+00', (select jsonb_agg(t.id order by t.id) from teams t where t.league_id = l.id)
from leagues l where l.id::text like 'b2050000-%';

insert into players (id, full_name, position, team, status, adp)
select p.id, p.nm, p.pos, 'HS', p.st, 50
from (values
 ('hi-a-qb', 'HI A QB', 'QB', 'Active'), ('hi-a-rb', 'HI A RB', 'RB', 'Active'), ('hi-a-bn', 'HI A Bench', 'RB', 'Active'),
 ('hi-a-out', 'HI A Out', 'RB', 'Out'), ('hi-a-irh', 'HI A IR (healthy)', 'RB', 'Active'),
 ('hi-b-qb', 'HI B QB', 'QB', 'Active'), ('hi-b-iro', 'HI B IR (Out)', 'RB', 'Out'), ('hi-b-dld', 'HI B DL (Doubtful)', 'RB', 'Doubtful'),
 ('hi-c-qb', 'HI C QB', 'QB', 'Active'), ('hi-c-dlh', 'HI C DL (healthy)', 'RB', 'Active'),
 ('hi-d-qb', 'HI D QB', 'QB', 'Active'), ('hi-d-ird', 'HI D IR (Doubtful)', 'RB', 'Doubtful'),
 ('hi-e-qb', 'HI E QB', 'QB', 'Active'), ('hi-e-irh', 'HI E IR (healthy)', 'RB', 'Active'),
 ('hi-k-qb', 'HI K QB', 'QB', 'Active'), ('hi-k-rb', 'HI K RB', 'RB', 'Active'),
 ('hi-fa1', 'HI FA One', 'RB', 'Active'), ('hi-fa2', 'HI FA Two', 'RB', 'Active'), ('hi-fa3', 'HI FA Three', 'RB', 'Active'),
 ('hi-fa4', 'HI FA Four', 'RB', 'Active'), ('hi-fa5', 'HI FA Five', 'RB', 'Active'),
 ('hi-f-qb', 'HI F QB', 'QB', 'Active'), ('hi-f-irh', 'HI F IR (healthy)', 'RB', 'Active'), ('hi-f-dlh', 'HI F DL (healthy)', 'RB', 'Active'),
 ('hi-fa6', 'HI FA Six', 'RB', 'Active'), ('hi-fa7', 'HI FA Seven', 'RB', 'Active'), ('hi-fa8', 'HI FA Eight', 'RB', 'Active'),
 ('hw-a-qb', 'HW A QB', 'QB', 'Active'), ('hw-a-irh', 'HW A IR (healthy)', 'RB', 'Out'),
 ('hw-b-qb', 'HW B QB', 'QB', 'Active'), ('hw-k-qb', 'HW K QB', 'QB', 'Active'),
 ('hw-c-qb', 'HW C QB', 'QB', 'Active'), ('hw-c-ird', 'HW C IR (Doubtful)', 'RB', 'Out'),
 ('hw-fa1', 'HW FA One', 'RB', 'Active'), ('hw-fa2', 'HW FA Two', 'RB', 'Active'),
 ('hw-fa3', 'HW FA Three', 'RB', 'Active'), ('hw-fa4', 'HW FA Four', 'RB', 'Active'), ('hw-fa5', 'HW FA Five', 'RB', 'Active')
) as p(id, nm, pos, st);

insert into league_rosters (league_id, team_id, player_id, slot_key, ir_placed_week, ir_lock_until_week)
select t.league_id, t.id, r.pid, r.sk, r.irw, r.lock
from (values
 ('HI Alpha', 'hi-a-qb', 'qb:0', null::int, null::int), ('HI Alpha', 'hi-a-rb', 'rb:0', null, null), ('HI Alpha', 'hi-a-bn', 'bn', null, null),
 ('HI Alpha', 'hi-a-out', 'bn', null, null), ('HI Alpha', 'hi-a-irh', 'ir:0', 5, null),
 ('HI Bravo', 'hi-b-qb', 'qb:0', null, null), ('HI Bravo', 'hi-b-iro', 'ir:0', 5, null), ('HI Bravo', 'hi-b-dld', 'dl:0', 5, 9),
 ('HI Charlie', 'hi-c-qb', 'qb:0', null, null), ('HI Charlie', 'hi-c-dlh', 'dl:0', 5, 9),
 ('HI Delta', 'hi-d-qb', 'qb:0', null, null), ('HI Delta', 'hi-d-ird', 'ir:0', 5, null),
 ('HI Echo', 'hi-e-qb', 'qb:0', null, null), ('HI Echo', 'hi-e-irh', 'ir:0', 5, null),
 ('HI Commish', 'hi-k-qb', 'qb:0', null, null), ('HI Commish', 'hi-k-rb', 'bn', null, null),
 -- Foxtrot's DL man went there in week 2; his stint ended with week 5 (he may leave from week 6).
 ('HI Foxtrot', 'hi-f-qb', 'qb:0', null, null), ('HI Foxtrot', 'hi-f-irh', 'ir:0', 5, null), ('HI Foxtrot', 'hi-f-dlh', 'dl:0', 2, 6),
 ('HW Alpha', 'hw-a-qb', 'qb:0', null, null), ('HW Alpha', 'hw-a-irh', 'ir:0', 5, null),
 ('HW Bravo', 'hw-b-qb', 'qb:0', null, null), ('HW Commish', 'hw-k-qb', 'qb:0', null, null),
 ('HW Charlie', 'hw-c-qb', 'qb:0', null, null), ('HW Charlie', 'hw-c-ird', 'ir:0', 5, null)
) as r(team, pid, sk, irw, lock)
join teams t on t.name = r.team and t.id::text like 'c2050000-%';
insert into league_player_pool (league_id, player_id, state)
select r.league_id, r.player_id, 'rostered' from league_rosters r where r.league_id::text like 'b2050000-%';

-- The stored week-6 lineups mirror the roster (IR spots as "<key>:0").
insert into team_lineups (team_id, season, week, slot_map, starters, bench)
select t.id, 2026, 6,
       (select coalesce(jsonb_object_agg(r.slot_key, r.player_id), '{}'::jsonb) from league_rosters r where r.team_id = t.id and r.slot_key <> 'bn'),
       '[]', '[]'
from teams t where t.id::text like 'c2050000-%';

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

create temp table r155 (tag text primary key, r jsonb not null);
create function pg_temp.lg(p_n int) returns uuid language sql as $$ select ('b2050000-0000-4000-8000-00000000000' || p_n)::uuid $$;
create function pg_temp.act(p_n int) returns uuid language sql as $$ select ('a2050000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.team(p_name text) returns uuid language sql as $$ select id from teams where name = p_name and id::text like 'c2050000-%' $$;
create function pg_temp.roster_of(p_pid text) returns text language sql as $$
  select coalesce((select t.name from league_rosters r join teams t on t.id = r.team_id where r.player_id = p_pid and r.league_id::text like 'b2050000-%'), '(none)') $$;
-- The team's IR blockers as "pid,pid" ("-" for none) at a given current week.
create function pg_temp.blk(p_team text, p_week int) returns text language sql as $$
  select coalesce(nullif((select string_agg(x ->> 'player_id', ',' order by x ->> 'player_id')
                          from jsonb_array_elements(public.ir_healthy_blockers_internal(l, pg_temp.team(p_team), p_week)) x), ''), '-')
  from leagues l where l.id = (select t.league_id from teams t where t.id = pg_temp.team(p_team)) $$;
-- One call as user p_user: the result, or {"error": <the refusal>} — so a
-- break probe reds the cell instead of aborting the run.
create function pg_temp.call(p_tag text, p_user int, p_sql text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '92050000-0000-4000-8000-00000000000' || p_user, 'role', 'authenticated')::text, true);
  begin
    execute p_sql into v;
  exception when others then
    v := jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate);
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into r155 (tag, r) values (p_tag, v);
  return v;
end $$;
create function pg_temp.said(p_tag text) returns text language sql as $$
  select coalesce((select 'refused: ' || (r ->> 'error') from r155 where tag = p_tag and r ? 'error'),
                  (select 'ok' from r155 where tag = p_tag), 'missing') $$;
create function pg_temp.ad(p_team text, p_add text, p_drop text, p_act int, p_at timestamptz) returns text language sql as $$
  select format('select public.roster_add_drop_internal(%L, %L, %L, %L, %L, %L)', pg_temp.lg(1), pg_temp.team(p_team), p_add, p_drop, pg_temp.act(p_act), p_at) $$;
create function pg_temp.sl(p_team text, p_map text, p_act int) returns text language sql as $$
  select format('select public.set_lineup_internal(%L, %L, 6, %L::jsonb, %L, %L, NULL)', pg_temp.lg(1), pg_temp.team(p_team), p_map, pg_temp.act(p_act), '2026-10-18 15:00:00+00') $$;
create function pg_temp.cl(p_team text, p_add text, p_bid int, p_act int, p_at timestamptz) returns text language sql as $$
  select format('select public.waiver_claim_submit_internal(%L, %L, %L, NULL, %s, %L, %L, NULL)', pg_temp.lg(2), pg_temp.team(p_team), p_add, p_bid, pg_temp.act(p_act), p_at) $$;

-- ---------------------------------------------------------------------------
-- B. THE CHECK — ir_healthy_blockers_internal, week 6
-- ---------------------------------------------------------------------------
select is(
  format('Alpha=%s Bravo=%s Charlie=%s Delta=%s Echo=%s Commish=%s',
         pg_temp.blk('HI Alpha', 6), pg_temp.blk('HI Bravo', 6), pg_temp.blk('HI Charlie', 6),
         pg_temp.blk('HI Delta', 6), pg_temp.blk('HI Echo', 6), pg_temp.blk('HI Commish', 6)),
  'Alpha=hi-a-irh Bravo=- Charlie=- Delta=hi-d-ird Echo=hi-e-irh Commish=-',
  'B1 the healthy man in the IR spot blocks Alpha and Echo; Bravo''s OUT man (IR) and Doubtful man (DL) still fit their spots; Charlie''s healthy DL man is mid-stint; Delta''s Doubtful man is in the plain IR spot, which takes OUT / IR only — PER-SPOT designations');
select is(
  format('wk8=%s wk9=%s', pg_temp.blk('HI Charlie', 8), pg_temp.blk('HI Charlie', 9)),
  'wk8=- wk9=hi-c-dlh',
  'B2 the Restricted stint: Charlie''s healthy DL man blocks nothing while he can''t leave (through week 8) and blocks from week 9, when he can');
select is(
  (select format('%s | %s | %s | %s | %s | %s', x ->> 'name', x ->> 'spot', x ->> 'label', coalesce(x ->> 'designation', 'none'), x -> 'eligible', x ->> 'why')
   from leagues l, jsonb_array_elements(public.ir_healthy_blockers_internal(l, pg_temp.team('HI Delta'), 6)) x
   where l.id = pg_temp.lg(1)),
  'HI D IR (Doubtful) | ir:0 | IR | Doubtful | ["OUT", "IR"] | listed Doubtful',
  'B3 …each blocker carries his name, spot, label, designation, the spot''s designations and why he no longer fits — "healthy" or "listed <tag>" (what a message or a screen names)');
select is(pg_temp.blk('HI Foxtrot', 6), 'hi-f-dlh,hi-f-irh',
  'B4 TWO BLOCKERS: Foxtrot''s healthy IR man, and his healthy DL man whose stint ended (current 6 is not before 6 — he may leave, so he must)');
-- B5: Alpha's IR man as the injury sync lists him — Active, then Questionable, Inactive, blank — and back to Active.
create function pg_temp.why(p_team text) returns text language sql as $$
  select coalesce(string_agg(x ->> 'player_id' || '=' || (x ->> 'why'), ',' order by x ->> 'player_id'), '-')
  from leagues l, jsonb_array_elements(public.ir_healthy_blockers_internal(l, pg_temp.team(p_team), 6)) x
  where l.id = (select t.league_id from teams t where t.id = pg_temp.team(p_team)) $$;
create temp table why155 (n int primary key, v text not null);
insert into why155 values (1, pg_temp.why('HI Alpha'));
update players set status = 'Questionable' where id = 'hi-a-irh';
insert into why155 values (2, pg_temp.why('HI Alpha'));
update players set status = 'Inactive' where id = 'hi-a-irh';
insert into why155 values (3, pg_temp.why('HI Alpha'));
update players set status = null where id = 'hi-a-irh';
insert into why155 values (4, pg_temp.why('HI Alpha'));
update players set status = 'Active' where id = 'hi-a-irh';
select is(
  (select string_agg(v, ' | ' order by n) from why155),
  'hi-a-irh=healthy | hi-a-irh=listed Questionable | hi-a-irh=listed Inactive | hi-a-irh=healthy',
  'B5 a Questionable (or Inactive) man in the IR spot blocks — no spot takes a status the bridge maps to no designation — and is named as he is listed, never "healthy"; "healthy" is a blank or Active status only');

-- ---------------------------------------------------------------------------
-- C. ADDS — roster_add_drop_internal (LA, no waivers), at P
-- ---------------------------------------------------------------------------
select pg_temp.call('c1', 2, pg_temp.ad('HI Alpha', 'hi-fa1', null, 1, '2026-10-18 15:00:00+00'));
select is(pg_temp.said('c1'),
  'refused: roster_add_drop: HI A IR (healthy) is healthy and still in HI Alpha''s IR spot — no adds while a player who isn''t IR-eligible holds an IR spot: move him to the bench (drop someone first if the roster is full), swap an IR-eligible player into his spot, or drop him (§7.3.2)',
  'C1 A HEALTHY MAN IN THE IR SPOT REFUSES AN ADD by name, in plain words, naming the ways out (dropping him among them — F692)');
select pg_temp.call('c2', 2, pg_temp.ad('HI Alpha', 'hi-fa1', 'hi-a-bn', 2, '2026-10-18 15:00:00+00'));
select is(split_part(pg_temp.said('c2'), ' — ', 1),
  'refused: roster_add_drop: HI A IR (healthy) is healthy and still in HI Alpha''s IR spot',
  'C2 …and an ADD + DROP of SOMEONE ELSE the same way (Chris: roster moves "mean adds and drops")');
select is(format('%s / %s', pg_temp.roster_of('hi-fa1'), pg_temp.roster_of('hi-a-bn')), '(none) / HI Alpha',
  'C2b …nothing written: the free agent is still unowned, the bench man still Alpha''s');
select pg_temp.call('c3', 2, pg_temp.ad('HI Alpha', null, 'hi-a-bn', 3, '2026-10-18 15:00:00+00'));
select is(format('%s | %s', pg_temp.said('c3'), pg_temp.roster_of('hi-a-bn')), 'ok | (none)',
  'C3 A PLAIN DROP LANDS while he is there — it is one of the ways out (room on a full roster), never blocked');
select pg_temp.call('c4', 5, pg_temp.ad('HI Delta', 'hi-fa2', null, 4, '2026-10-18 15:00:00+00'));
select is(split_part(pg_temp.said('c4'), ' — ', 1),
  'refused: roster_add_drop: HI D IR (Doubtful) is listed Doubtful and still in HI Delta''s IR spot',
  'C4 PER-SPOT DESIGNATIONS: a Doubtful man in the plain IR spot (OUT / IR) refuses Delta''s add, named for what he is — Doubtful fits only the DL spot');
select pg_temp.call('c5', 3, pg_temp.ad('HI Bravo', 'hi-fa3', null, 5, '2026-10-18 15:00:00+00'));
select is(format('%s | %s', pg_temp.said('c5'), pg_temp.roster_of('hi-fa3')), 'ok | HI Bravo',
  'C5 STILL-ELIGIBLE OCCUPANTS BLOCK NOTHING: Bravo (an OUT man in IR, a Doubtful man in DL) adds');
select pg_temp.call('c6', 4, pg_temp.ad('HI Charlie', 'hi-fa4', null, 6, '2026-10-18 15:00:00+00'));
select is(format('%s | %s', pg_temp.said('c6'), pg_temp.roster_of('hi-fa4')), 'ok | HI Charlie',
  'C6 A RESTRICTED STINT STILL RUNNING BLOCKS NOTHING: Charlie''s healthy DL man can''t leave before week 9, so Charlie adds (never demand the impossible)');
-- F692 (Chris 2026-10-21: "Yes the user can click on the player and drop them directly").
select pg_temp.call('c7', 7, pg_temp.ad('HI Foxtrot', 'hi-fa6', 'hi-f-dlh', 7, '2026-10-18 15:00:00+00'));
select is(format('%s | %s / %s', split_part(pg_temp.said('c7'), ' — ', 1), pg_temp.roster_of('hi-fa6'), pg_temp.roster_of('hi-f-dlh')),
  'refused: roster_add_drop: HI F IR (healthy) is healthy and still in HI Foxtrot''s IR spot | (none) / HI Foxtrot',
  'C7 F692 — dropping ONE of two blockers in an add + drop still refuses, naming the OTHER; nothing written');
select pg_temp.call('c8', 7, pg_temp.ad('HI Foxtrot', null, 'hi-f-dlh', 8, '2026-10-18 15:00:00+00'));
select is(format('%s | %s | blockers=%s', pg_temp.said('c8'), pg_temp.roster_of('hi-f-dlh'), pg_temp.blk('HI Foxtrot', 6)),
  'ok | (none) | blockers=hi-f-irh',
  'C8 …a plain drop of one of them lands (drops are never blocked); one blocker left');
select pg_temp.call('c9', 7, pg_temp.ad('HI Foxtrot', 'hi-fa6', 'hi-f-irh', 9, '2026-10-18 15:00:00+00'));
select is(format('%s | %s / %s | blockers=%s', pg_temp.said('c9'), pg_temp.roster_of('hi-fa6'), pg_temp.roster_of('hi-f-irh'), pg_temp.blk('HI Foxtrot', 6)),
  'ok | HI Foxtrot / (none) | blockers=-',
  'C9 F692 AS RULED — AN ADD + DROP WHOSE DROP IS THE HEALTHY IR MAN LANDS: dropping him clears the block in the same move, the add goes through');
select pg_temp.call('c10', 7, pg_temp.ad('HI Foxtrot', 'hi-fa7', null, 10, '2026-10-18 15:00:00+00'));
select is(format('%s | %s', pg_temp.said('c10'), pg_temp.roster_of('hi-fa7')), 'ok | HI Foxtrot',
  'C10 …and then a plain add lands too (the block is gone)');

-- ---------------------------------------------------------------------------
-- D. LINEUP MOVES WHILE BLOCKED — set_lineup_internal, at P
-- ---------------------------------------------------------------------------
select pg_temp.call('d1', 2, pg_temp.sl('HI Alpha', '{"qb:0": "hi-a-qb", "rb:0": "hi-a-out", "ir:0": "hi-a-irh"}', 11));
select is(
  coalesce((select 'refused: ' || (r ->> 'error') from r155 where tag = 'd1' and r ? 'error'),
           (select format('saved ir_ineligible=%s', r -> 'flags' -> 'ir_ineligible') from r155 where tag = 'd1')),
  'saved ir_ineligible=["hi-a-irh"]',
  'D1 A START / BENCH MOVE SAVES while he is there (Chris: "You can still change who''s on your bench and who''s in your starting lineup") — he keeps his ir_ineligible flag');
select pg_temp.call('d2', 2, pg_temp.sl('HI Alpha', '{"qb:0": "hi-a-qb", "rb:0": "hi-a-irh", "ir:0": "hi-a-out"}', 12));
select is(
  coalesce((select 'refused: ' || (r ->> 'error') from r155 where tag = 'd2' and r ? 'error'),
           (select format('placed %s removed %s', r -> 'ir_moves' -> 'placed' -> 0 ->> 'player_id', r -> 'ir_moves' -> 'removed' -> 0 ->> 'player_id')
            from r155 where tag = 'd2')),
  'placed hi-a-out removed hi-a-irh',
  'D2 THE WAY OUT: swapping an IR-eligible (OUT) player into the spot, the healthy man out of it, lands');
select pg_temp.call('d3', 2, pg_temp.ad('HI Alpha', 'hi-fa1', null, 13, '2026-10-18 15:00:00+00'));
select is(format('blockers=%s | %s | %s', pg_temp.blk('HI Alpha', 6), pg_temp.said('d3'), pg_temp.roster_of('hi-fa1')),
  'blockers=- | ok | HI Alpha',
  'D3 …and then ADDS WORK AGAIN: the same add C1 refused lands');
select pg_temp.call('d4', 5, pg_temp.sl('HI Delta', '{"qb:0": "hi-d-qb"}', 14));
select is(
  coalesce((select 'refused: ' || (r ->> 'error') from r155 where tag = 'd4' and r ? 'error'),
           (select format('removed %s', r -> 'ir_moves' -> 'removed' -> 0 ->> 'player_id') from r155 where tag = 'd4')),
  'removed hi-d-ird',
  'D4 THE OTHER WAY OUT: moving Delta''s man out of the IR spot to the bench lands');
select pg_temp.call('d5', 5, pg_temp.ad('HI Delta', 'hi-fa2', null, 15, '2026-10-18 15:00:00+00'));
select is(format('%s | %s', pg_temp.said('d5'), pg_temp.roster_of('hi-fa2')), 'ok | HI Delta',
  'D5 …and then Delta''s add lands');

-- ---------------------------------------------------------------------------
-- E. NOT BLOCKED — a trade, and the commissioner's own roster tool (Echo is blocked)
-- ---------------------------------------------------------------------------
select is(pg_temp.blk('HI Echo', 6), 'hi-e-irh', 'E0 PREMISE: Echo is blocked (a healthy man in the IR spot)');
select pg_temp.call('e1:p', 6, format('select public.trade_propose_internal(%L, %L, %L, %L::jsonb, NULL, NULL, %L, %L, NULL)',
  pg_temp.lg(1), pg_temp.team('HI Echo'), pg_temp.team('HI Commish'),
  jsonb_build_array(jsonb_build_object('player_id', 'hi-e-qb', 'from_team_id', pg_temp.team('HI Echo')),
                    jsonb_build_object('player_id', 'hi-k-rb', 'from_team_id', pg_temp.team('HI Commish'))),
  pg_temp.act(21), '2026-10-18 15:00:00+00'));
select pg_temp.call('e1', 1, format('select public.trade_respond_internal(%L, %L, ''accept'', NULL, NULL, NULL, %L, %L, NULL)',
  pg_temp.lg(1), (select (r #>> '{trade,id}')::uuid from r155 where tag = 'e1:p'), pg_temp.act(22), '2026-10-18 15:00:01+00'));
select is(
  coalesce((select 'refused: ' || (r ->> 'error') from r155 where tag in ('e1:p', 'e1') and r ? 'error' limit 1),
           format('%s | %s / %s', (select r #>> '{execution,outcome}' from r155 where tag = 'e1'), pg_temp.roster_of('hi-k-rb'), pg_temp.roster_of('hi-e-qb'))),
  'complete | HI Echo / HI Commish',
  'E1 A TRADE IS NOT BLOCKED (Chris: roster moves "mean adds and drops"): Echo trades its QB for an RB and it executes at once');
select pg_temp.call('e2', 1, format('select public.commish_roster_override_internal(%L, %L, %L, NULL, NULL, NULL, NULL, %L, %L, %L, %L)',
  pg_temp.lg(1), pg_temp.team('HI Echo'), 'hi-fa5', pg_temp.act(23), '2026-10-18 15:00:02+00', 'pgtap 155', 'commish_force_add_drop'));
select is(format('%s | %s', pg_temp.said('e2'), pg_temp.roster_of('hi-fa5')), 'ok | HI Echo',
  'E2 THE COMMISSIONER''S FORCE-ADD onto Echo lands — his own roster tools are not blocked (commissioner powers fix)');
-- F690 AS RULED (Chris 2026-10-21: "Nothing changes if the player is locked. that's tough luck."):
-- HS kicked off Sunday 17:00Z; at 17:30Z Echo's healthy IR man is locked.
select pg_temp.call('e3', 6, pg_temp.ad('HI Echo', 'hi-fa8', 'hi-e-irh', 24, '2026-10-18 17:30:00+00'));
select is(split_part(pg_temp.said('e3'), ' — ', 1),
  'refused: roster_add_drop: HI E IR (healthy) (hi-e-irh) is locked for drops',
  'E3 F690 — ONCE HIS GAME HAS KICKED OFF an add + drop of the healthy IR man is refused by the drop lock (F692 never reaches a locked man)');
select pg_temp.call('e4', 6, pg_temp.ad('HI Echo', 'hi-fa8', null, 25, '2026-10-18 17:30:00+00'));
select is(format('%s | %s / %s', split_part(pg_temp.said('e4'), ' — ', 1), pg_temp.roster_of('hi-e-irh'), pg_temp.roster_of('hi-fa8')),
  'refused: roster_add_drop: HI E IR (healthy) is healthy and still in HI Echo''s IR spot | HI Echo / (none)',
  'E4 …and an add alone is refused by the block — it STANDS while he is locked; nothing written');

-- ---------------------------------------------------------------------------
-- W. CLAIMS (LW) — the submit, the flip, the run, the fix
-- ---------------------------------------------------------------------------
-- W Alpha's and W Charlie's men are OUT (they fit the IR spot) when the claims go in at 14:00.
select pg_temp.call('w0a', 2, pg_temp.cl('HW Alpha', 'hw-fa1', 10, 31, '2026-10-18 14:00:00+00'));
select pg_temp.call('w0e', 2, pg_temp.cl('HW Alpha', 'hw-fa5', 1, 39, '2026-10-18 14:00:04+00'));
select pg_temp.call('w0b', 3, pg_temp.cl('HW Bravo', 'hw-fa1', 5, 32, '2026-10-18 14:00:01+00'));
select pg_temp.call('w0c', 8, pg_temp.cl('HW Charlie', 'hw-fa3', 4, 37, '2026-10-18 14:00:02+00'));
select pg_temp.call('w0d', 8, pg_temp.cl('HW Charlie', 'hw-fa4', 2, 38, '2026-10-18 14:00:03+00'));
select is(format('%s %s %s %s %s | blockers=%s %s', pg_temp.said('w0a'), pg_temp.said('w0e'), pg_temp.said('w0b'), pg_temp.said('w0c'), pg_temp.said('w0d'),
                 pg_temp.blk('HW Alpha', 6), pg_temp.blk('HW Charlie', 6)),
  'ok ok ok ok ok | blockers=- -',
  'W0 PREMISE: while their men are OUT, W Alpha''s two claims ($10, $1) and W Charlie''s two ($4, $2) are accepted; W Bravo claims W Alpha''s first free agent too ($5)');
-- FIXTURE STEP — the sync clears his tag: he is healthy, still in the IR spot.
update players set status = 'Active' where id = 'hw-a-irh';
select pg_temp.call('w1', 2, pg_temp.cl('HW Alpha', 'hw-fa2', 3, 33, '2026-10-18 15:00:00+00'));
select is(pg_temp.said('w1'),
  'refused: waiver_claim_submit: HW A IR (healthy) is healthy and still in HW Alpha''s IR spot — no claims while a player who isn''t IR-eligible holds an IR spot: move him to the bench (drop someone first if the roster is full), swap an IR-eligible player into his spot, or drop him (§7.3.2)',
  'W1 A NEW CLAIM IS REFUSED by name now that he is healthy (prevent: it would only fail at the run)');
select pg_temp.call('w2', 1, pg_temp.cl('HW Alpha', 'hw-fa2', 3, 34, '2026-10-18 15:00:01+00'));
select is(split_part(pg_temp.said('w2'), ' — ', 1),
  'refused: waiver_claim_submit: HW A IR (healthy) is healthy and still in HW Alpha''s IR spot',
  'W2 …the commissioner placing a claim FOR W Alpha the same way (the run would fail it — his force-add, E2, is the tool that stands outside)');
-- FIXTURE STEP — W Charlie's man is listed Doubtful (the plain IR spot takes OUT / IR only).
update players set status = 'Doubtful' where id = 'hw-c-ird';
select is(
  format('%s | blockers=%s %s | healthy_in_ir notices=%s',
         (select string_agg(t.name || ':' || c.add_player_id || '=' || c.status, ' ' order by t.name, c.add_player_id)
          from waiver_claims c join teams t on t.id = c.team_id where c.league_id = pg_temp.lg(2)),
         pg_temp.blk('HW Alpha', 6), pg_temp.blk('HW Charlie', 6),
         (select count(*) from notifications n where n.type = 'league_waiver_claim' and n.data ->> 'reason' = 'healthy_in_ir'
            and n.user_id in ('92050000-0000-4000-8000-000000000002', '92050000-0000-4000-8000-000000000008'))),
  'HW Alpha:hw-fa1=pending HW Alpha:hw-fa5=pending HW Bravo:hw-fa1=pending HW Charlie:hw-fa3=pending HW Charlie:hw-fa4=pending | blockers=hw-a-irh hw-c-ird | healthy_in_ir notices=0',
  'W3 F693 AS RULED ("the claims are not cancelled, they should fail when waivers run") — THE CLAIMS SURVIVE THE FLIP: both teams are blocked now, every claim is still pending and nobody has been told anything');
-- THE FIX BEFORE THE RUN — W Charlie moves his man out of the IR spot to the bench.
select pg_temp.call('w4', 8, format('select public.set_lineup_internal(%L, %L, 6, %L::jsonb, %L, %L, NULL)',
  pg_temp.lg(2), pg_temp.team('HW Charlie'), '{"qb:0": "hw-c-qb"}', pg_temp.act(40), '2026-10-18 15:30:00+00'));
select is(
  coalesce((select 'refused: ' || (r ->> 'error') from r155 where tag = 'w4' and r ? 'error'),
           format('removed %s | blockers=%s %s', (select r -> 'ir_moves' -> 'removed' -> 0 ->> 'player_id' from r155 where tag = 'w4'),
                  pg_temp.blk('HW Alpha', 6), pg_temp.blk('HW Charlie', 6))),
  'removed hw-c-ird | blockers=hw-a-irh -',
  'W4 W Charlie FIXES IT BEFORE THE RUN (his man to the bench); W Alpha does not');
insert into r155 select 'w5', public.process_waivers_internal(pg_temp.lg(2), '2026-10-18 16:00:00+00');
select is(
  (select string_agg(t.name || ':' || c.add_player_id || '=' || c.status || ':' || coalesce(c.result_reason, '-'), ' ' order by t.name, c.add_player_id)
   from waiver_claims c join teams t on t.id = c.team_id where c.league_id = pg_temp.lg(2)),
  'HW Alpha:hw-fa1=invalid:healthy_in_ir HW Alpha:hw-fa5=invalid:healthy_in_ir HW Bravo:hw-fa1=won:- HW Charlie:hw-fa3=won:- HW Charlie:hw-fa4=won:-',
  'W5 THE RUN: EACH of W Alpha''s claims FAILS — still an ineligible player in his IR spot — and his first free agent goes to the next claim in line (W Bravo''s, for less); W Charlie, fixed before the run, gets both of his');
select is(
  (select format('claims=%s won=%s lost=%s invalid=%s healthy_in_ir=%s notified=%s | %s %s | faab %s / %s / %s | failed settled at the run=%s',
                 r ->> 'claims', r ->> 'won', r ->> 'lost', r ->> 'invalid', r ->> 'healthy_in_ir', r ->> 'notified',
                 pg_temp.roster_of('hw-fa1'), pg_temp.roster_of('hw-fa5'),
                 (select m.faab_balance from league_members m where m.team_id = pg_temp.team('HW Alpha')),
                 (select m.faab_balance from league_members m where m.team_id = pg_temp.team('HW Bravo')),
                 (select m.faab_balance from league_members m where m.team_id = pg_temp.team('HW Charlie')),
                 (select bool_and(c.processed_at = '2026-10-18 16:00:00+00' and c.process_at = '2026-10-18 16:00:00+00' and c.cancelled_at is null)
                  from waiver_claims c where c.result_reason = 'healthy_in_ir' and c.league_id = pg_temp.lg(2)))
   from r155 where tag = 'w5'),
  'claims=5 won=3 lost=0 invalid=2 healthy_in_ir=2 notified=5 | HW Bravo (none) | faab 100 / 95 / 94 | failed settled at the run=t',
  'W6 …the run counts them (claims, invalid, healthy_in_ir) and its five notices; nothing is spent by W Alpha; W Bravo pays $5, W Charlie $4 + $2; the failed rows carry the run''s instant, never a cancel');
select is(
  (select format('%s | %s | %s', count(*),
                 string_agg(n.title, ' / ' order by n.title),
                 max(n.body) filter (where n.data ->> 'add_player_id' = 'hw-fa1'))
   from notifications n
   where n.type = 'league_waiver_claim' and n.data ->> 'reason' = 'healthy_in_ir'
     and n.user_id = '92050000-0000-4000-8000-000000000002'),
  '2 | Waiver claim didn''t go through: HW FA Five / Waiver claim didn''t go through: HW FA One | You had an ineligible player in your IR spot when waivers ran — HW A IR (healthy) was healthy — so the claim for HW FA One didn''t go through. To add players again, move him to your bench, swap an IR-eligible player into his spot, or drop him. Nothing was spent.',
  'W7 …and W Alpha is TOLD per claim, as every failed claim''s owner is, in plain words — the ruled headline, said of the run, naming the player in his IR spot');
select is(
  (select format('input claims=%s | W Charlie healthy_in_ir notices=%s', jsonb_array_length(w.input -> 'claims'),
                 (select count(*) from notifications n where n.type = 'league_waiver_claim' and n.data ->> 'reason' = 'healthy_in_ir'
                    and n.user_id = '92050000-0000-4000-8000-000000000008'))
   from waiver_runs w where w.league_id = pg_temp.lg(2)),
  'input claims=3 | W Charlie healthy_in_ir notices=0',
  'W8 the failed claims never reached the decision — the run''s logged input holds W Bravo''s and W Charlie''s alone (the resolver pair is untouched); W Charlie was never told of a block');
-- THE FIX AFTER THE RUN — W Alpha moves his man to the bench; a claim is accepted again.
select pg_temp.call('w9:fix', 2, format('select public.set_lineup_internal(%L, %L, 6, %L::jsonb, %L, %L, NULL)',
  pg_temp.lg(2), pg_temp.team('HW Alpha'), '{"qb:0": "hw-a-qb"}', pg_temp.act(35), '2026-10-18 16:30:00+00'));
select pg_temp.call('w9', 2, pg_temp.cl('HW Alpha', 'hw-fa2', 3, 36, '2026-10-18 16:30:01+00'));
select is(format('%s | %s | %s', pg_temp.said('w9:fix'), pg_temp.said('w9'),
                 (select c.status from waiver_claims c where c.add_player_id = 'hw-fa2' and c.team_id = pg_temp.team('HW Alpha'))),
  'ok | ok | pending',
  'W9 AFTER THE FIX (moved to the bench) W Alpha''s claim is accepted again, and stays pending');

select * from finish();
rollback;
