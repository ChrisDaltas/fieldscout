-- ============================================================================
-- The commissioner audit spine + `commish_edit_lineup` — pgTAP 071
-- (migration 123; spec §10.3 / §12.12 / §11.2 / §15.4:1695; PROGRESS §3
-- STANDING RULE clauses (b), (e), (g); tasks-M4 §4 rules 1-11).
--
-- Numbering: pgTAP head measured 070 by `ls supabase/tests/ | tail` ⇒ 071.
--
-- Falsifiability notes (tasks-M1 §4.3, carried by tasks-M4 §4 rule 9):
--   * THE CLAIM RLS CANNOT MAKE, and it is the reason this suite exists.
--     §12.12 says "Because there is no UPDATE or DELETE policy, even a
--     commissioner cannot alter or remove an entry — Postgres denies it."
--     That is true for anon/authenticated/service_role and FALSE for the
--     table OWNER, which is the role every SECURITY DEFINER writer runs as.
--     §C therefore proves immutability TWICE: once through RLS (a
--     commissioner's UPDATE/DELETE affect 0 rows) and once through the
--     trigger (the SAME UPDATE and DELETE executed as postgres RAISE). An
--     all-green role matrix is exactly what this hazard would hide behind.
--     THE BREAK PROBE for this suite drops `trg_commish_actions_immutable`:
--     the two owner cells red BY NAME while every RLS cell still passes.
--   * THE LOCK CONTRAST IS PINNED AS A PAIR, never as a bare success. Every
--     cell where `commish_edit_lineup` moves a kicked-off player is preceded
--     by the SAME map through `set_lineup` being REFUSED by name — arm (a)
--     (a stored starter whose game kicked off leaving his key) and arm (b)
--     (a kicked-off player entering a slot). If a future edit weakened
--     `set_lineup`, the refusal cells red; if it broke the override, the
--     success cells red. Neither can drift silently.
--   * THE HIDDEN THIRD LOCK is pinned in §J, and §J had to be BUILT rather
--     than assumed. Carrying 114:490-493's `fixed` computation over is
--     INVISIBLE to §E's arm-(a)/arm-(b) cells — `wanted` comes from the
--     submitted map, so a locked player asked for a slot is seeded there
--     either way. It only becomes observable when the matcher must RE-SEAT
--     through a locked player's slot, which 112:518 refuses to traverse. §J
--     constructs exactly that: ce-wr1 submitted at an ineligible qb:0 whose
--     only escape runs through the locked ce-qb1's flex:0. fixed = TRUE ⇒
--     E16 raise; fixed = FALSE ⇒ both placed. Every §E cell still asserts the
--     canonical `slot_map` rather than merely that the call lived.
--   * CHRIS'S ONE CONDITION, asserted three ways (§G): an identical submit
--     returns `no_changes = true` BY NAME, writes NO commissioner_actions
--     row (count unchanged), and writes NO league_chat post (count
--     unchanged). Never inferred from an empty result.
--   * THE STARVATION TRAP (§H). A `score_fanout` row stamped `now()` is
--     `not_ready` forever (the worker demands
--     `player_stats.updated_at >= enqueued_at`). The cell asserts the
--     enqueued stamp is `<=` the player's own stats row — so a future
--     refactor to `now()` reds — and that a `final` week enqueues NOTHING
--     and says `score_stale = true` instead.
--   * REASON, one unit either side: blank as SPACE, as TAB and as NEWLINE
--     each refused (plain `btrim` strips spaces only — the R745 hole);
--     500 characters accepted, 501 refused.
--   * ROLES: a manager of the very team being edited is REFUSED by the
--     commissioner verb (he has `set_lineup`); an outsider, a non-managing
--     member and anon get the same no-leak 42501.
--   * NEVER-WEAKEN PIN (§I): `set_lineup_internal`'s prosrc still contains
--     BOTH lock refusal strings verbatim, and `set_lineup` is still ONE
--     overload with its 114 shape. A PR that "helpfully" added a
--     commissioner exemption to the manager verb reds here.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(126);

-- ---------------------------------------------------------------------------
-- A. Form pins — §12.12's table, its policies, the immutability trigger,
--    the helper, the ledger, the three parked FKs, grants (§4.1)
-- ---------------------------------------------------------------------------
select has_table('public', 'commissioner_actions', 'commissioner_actions exists (§12.12)');
select columns_are('public', 'commissioner_actions',
  array['id', 'league_id', 'actor_id', 'action_type', 'target_type', 'target_id',
        'reason', 'before', 'after', 'metadata', 'acting_as_team_id',
        'reverts_action_id', 'prev_hash', 'row_hash', 'created_at'],
  'commissioner_actions: §12.12''s columns PLUS acting_as_team_id (§10.3:701 lists it; the DDL''s omission is the erratum)');
-- [migration 130 §0 / PROGRESS Q66 (Chris, 2026-09-16; spec v2.16.41): a
-- reason is OPTIONAL on every commissioner action — 123:295's NOT NULL is
-- DROPPED by 130 and this pin flips with it. The explicit-class CHECK and the
-- 500 bound survive for a NON-NULL reason (pgTAP 078 §M pins the new text).]
select col_is_null('public', 'commissioner_actions', 'reason', 'reason NULLABLE since migration 130 (Q66 / spec v2.16.41 §10.3 — was NOT NULL at 123:295, §12.12:1195)');
select col_not_null('public', 'commissioner_actions', 'created_at',
  'created_at NOT NULL — TIGHTENED from §12.12:1202''s nullable (111:220/112:324 precedent; a NULL is unreachable by the activity feed''s composite cursor, R770)');
select col_type_is('public', 'commissioner_actions', 'target_id', 'text',
  'target_id is TEXT, not UUID — players.id is TEXT, so action_type = move_player must be representable');
select has_index('public', 'commissioner_actions', 'idx_commish_actions_league', 'idx_commish_actions_league exists (§12.12:1210)');

select is((select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'commissioner_actions'), true,
  'RLS enabled on commissioner_actions');
select policies_are('public', 'commissioner_actions',
  array['Audit log readable by all league members', 'Only commish can append'],
  'EXACTLY two policies — the member SELECT and the commissioner INSERT. The ABSENCE of UPDATE and DELETE policies IS §12.12''s immutability (spec:1205); a third policy here is a defect');
select policy_cmd_is('public', 'commissioner_actions', 'Audit log readable by all league members', 'SELECT',
  'the read policy is SELECT — visible to ALL members (§10.3:702 transparency), not commissioner-only');
select policy_cmd_is('public', 'commissioner_actions', 'Only commish can append', 'INSERT',
  'the write policy is INSERT only (§12.12:1208)');

-- The backstop RLS cannot provide. R616 (104:489): a trigger at the default
-- tgenabled='O' is SKIPPED under session_replication_role='replica' — the mode
-- `supabase db push` and `pg_restore` run in.
select is((select tgenabled from pg_trigger where tgname = 'trg_commish_actions_immutable'), 'A',
  'trg_commish_actions_immutable is ENABLE ALWAYS (R616) — an ''O'' trigger is skipped in replica mode, which is the mode db push itself runs in');
select ok(
  (select (tgtype & 1) > 0 and (tgtype & 2) > 0 and (tgtype & 8) > 0 and (tgtype & 16) > 0
   from pg_trigger where tgname = 'trg_commish_actions_immutable'),
  'trg_commish_actions_immutable is BEFORE UPDATE OR DELETE, FOR EACH ROW');

select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('log_commissioner_action_internal', 'commish_actions_immutable_internal', 'commish_edit_lineup_internal')),
  'the three seams are PLAIN (not DEFINER) with search_path='''' — reachable only through the DEFINER verb, or as postgres');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_edit_lineup'),
  'commish_edit_lineup is SECURITY DEFINER with search_path='''' (rule 2)');
select ok(
  not has_function_privilege('anon', 'public.commish_edit_lineup(uuid,uuid,integer,jsonb,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.commish_edit_lineup(uuid,uuid,integer,jsonb,text,uuid)', 'EXECUTE'),
  'commish_edit_lineup: anon holds no EXECUTE (REVOKE FROM PUBLIC, anon); authenticated may call — the commissioner check is IN-BODY');
select ok(
  not has_function_privilege('authenticated', 'public.commish_edit_lineup_internal(uuid,uuid,integer,jsonb,uuid,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.commish_edit_lineup_internal(uuid,uuid,integer,jsonb,uuid,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.log_commissioner_action_internal(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,uuid)', 'EXECUTE'),
  'the internal seam and the logging helper are triple-REVOKEd — no client can supply the instant or forge a log row through them');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('commish_edit_lineup', 'commish_edit_lineup_internal')),
  2, 'exactly ONE overload each of commish_edit_lineup / commish_edit_lineup_internal');

select has_table('public', 'commish_lineup_actions', 'commish_lineup_actions exists — the verb''s OWN ledger (§12.26: an action_id is an idempotency key, NOT an audit record)');
select policies_are('public', 'commish_lineup_actions', array[]::text[],
  'commish_lineup_actions: ZERO policies — the DEFINER RPC is its only reader and writer, which is what makes the replay unpoisonable (unlike commissioner_actions, which prints a client INSERT policy)');
select ok(
  exists (select 1 from pg_constraint c join pg_class r on r.oid = c.conrelid
          where r.relname = 'commish_lineup_actions' and c.contype = 'u'
            and (select array_agg(a.attname::text order by a.attnum)
                 from unnest(c.conkey) k join pg_attribute a on a.attrelid = r.oid and a.attnum = k)
                = array['league_id', 'action_id']),
  'UNIQUE (league_id, action_id) — the replay race backstop (the 111/112 shape)');

-- The three FKs 056/109 parked "M6 adds the FK with the table".
select ok(
  (select count(*)::int from pg_constraint c join pg_class t on t.oid = c.conrelid
   join pg_class f on f.oid = c.confrelid
   where c.contype = 'f' and f.relname = 'commissioner_actions'
     and t.relname in ('matchups', 'transactions', 'league_weeks')) = 4,
  'all THREE parked FKs land with the table: matchups.override_action_id (109:169), transactions.related_action_id (109:249), league_weeks.reopened_by_action_id (056:68) — plus 134''s matchups.pairing_set_by_action_id (M6A L.E1.16): four FKs from those three tables');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — before any JWT claims)
--    u1 commissioner of L1 (T1) · u2 manager of L1 (T2 — the roster under
--    test) · u3 outsider · u4 member of L1 with no team.
--    now() is frozen for this transaction (D307(3)), so kickoff ± 1s is an
--    exact boundary.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('94000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-ce' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'ce_user' || i)::jsonb, now(), now()
from generate_series(1, 4) i;

-- The calendar, RELATIVE to now(): current week 3.
update nfl_weeks w
set starts_at = now() + ((w.week - 3) * interval '7 days') - interval '1 day',
    first_kickoff_at = null, last_game_ends_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot,
                     lineup_lock, settings, roster_settings) values
 ('b4000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'pgtap-ce-L1', 2026, 'in_season', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"allow_illegal_lineups": true}',
  '{"starting_slots": [
      {"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1},
      {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1},
      {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 1},
      {"key": "flex", "label": "W/R/T", "eligible": ["WR", "RB", "TE"], "count": 1}],
    "bench": 4,
    "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}],
    "swap_spots": 0}');

insert into teams (id, owner_id, name, league_id) values
 ('c4000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'CE T1', 'b4000000-0000-4000-8000-000000000001'),
 ('c4000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000002', 'CE T2', 'b4000000-0000-4000-8000-000000000001');
insert into league_members (league_id, user_id, team_id, role) values
 ('b4000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 'commissioner'),
 ('b4000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000002', 'manager'),
 ('b4000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000004', null, 'manager');
insert into league_weeks (league_id, season, week)
select 'b4000000-0000-4000-8000-000000000001', 2026, g from generate_series(1, 8) g;

-- THE FIXTURE IS CHRIS'S TEAM 7. `ce-qb1` is the team's only STARTED
-- quarterback: his game kicked off one second ago, so under the lock his
-- slot is closed and no legal complete lineup exists for the week.
insert into players (id, full_name, position, team, status) values
 ('ce-qb1', 'CE QB1', 'QB', 'KC',  'Active'),   -- kicked off 1s ago  → LOCKED
 ('ce-qb2', 'CE QB2', 'QB', 'DAL', 'Active'),   -- kicks off in 1s    → not locked
 ('ce-rb1', 'CE RB1', 'RB', 'DAL', 'Active'),
 ('ce-rb2', 'CE RB2', 'RB', 'NYG', 'Active'),
 ('ce-wr1', 'CE WR1', 'WR', 'DAL', 'Active'),
 ('ce-wr2', 'CE WR2', 'WR', 'NYG', 'Active'),
 ('ce-te1', 'CE TE1', 'TE', 'NYG', 'Active');
insert into league_rosters (league_id, team_id, player_id)
select 'b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', id
from players where id like 'ce-%';

-- CE T3 — THE ACCEPTANCE FIXTURE, and it is Chris's league exactly: an
-- UNMANAGED seat (no league_members row for its owner) whose ONLY quarterback
-- kicked off one second ago, and whose stored qb:0 is EMPTY because the
-- manager's save was refused whole. There is no legal complete lineup for this
-- team this week under the lock, and no later week to carry from.
insert into teams (id, owner_id, name, league_id) values
 ('c4000000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000003', 'CE T3 (unmanaged)', 'b4000000-0000-4000-8000-000000000001');
insert into players (id, full_name, position, team, status) values
 ('ce2-qb1', 'CE2 QB1', 'QB', 'KC',  'Active'),   -- the ONLY QB on T3 — kicked off 1s ago
 ('ce2-rb1', 'CE2 RB1', 'RB', 'NYG', 'Active'),
 ('ce2-wr1', 'CE2 WR1', 'WR', 'NYG', 'Active'),
 ('ce2-wr2', 'CE2 WR2', 'WR', 'NYG', 'Active');
insert into league_rosters (league_id, team_id, player_id)
select 'b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000003', id
from players where id like 'ce2-%';

-- Week 3 games: KC kicked off ONE SECOND AGO; DAL kicks off in one second;
-- NYG in three hours.
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('ce-w3-a', 2026, 3, 'KC',  'BUF', now() - interval '1 second'),
 ('ce-w3-b', 2026, 3, 'DAL', 'PHI', now() + interval '1 second'),
 ('ce-w3-c', 2026, 3, 'NYG', 'SF',  now() + interval '3 hours');

-- The stored week-3 lineup: QB1 (already kicked off) at qb:0.
insert into team_lineups (team_id, season, week, slot_map, starters, bench) values
 ('c4000000-0000-4000-8000-000000000002', 2026, 3,
  '{"qb:0": "ce-qb1", "rb:0": "ce-rb1", "wr:0": "ce-wr1", "flex:0": "ce-wr2"}',
  '[]', '[]'),
 -- T3: qb:0 EMPTY. This is the state the atomic refusal leaves behind.
 ('c4000000-0000-4000-8000-000000000003', 2026, 3,
  '{"rb:0": "ce2-rb1", "wr:0": "ce2-wr1", "flex:0": "ce2-wr2"}',
  '[]', '[]');

-- A REAL matchup for the edited team-week. §12.12 sketches a backstop trigger
-- around `matchups.is_overridden`, and the cell below asserts this verb never
-- writes it — an assertion that is VACUOUS against an empty table (R972: the
-- first cut counted `matchups where is_overridden` over a fixture with ZERO
-- matchups rows, so it read 0 because the table was empty, not because the
-- verb declined). It has a row to be false about now.
insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id, status) values
 ('b4000000-0000-4000-8000-000000000001', 2026, 3, 'regular',
  'c4000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000003', 'live');

select is(public.lineup_current_week_internal('b4000000-0000-4000-8000-000000000001', now()), 3,
  'the current week is 3 by the nfl_weeks.starts_at boundary');

-- THE ACCEPTANCE PREMISE, asserted rather than assumed: T3 has exactly ONE
-- quarterback, his game has already kicked off, and his seat is empty.
select is(
  (select count(*)::int from league_rosters r join players p on p.id = r.player_id
   where r.team_id = 'c4000000-0000-4000-8000-000000000003' and p.position = 'QB'),
  1, 'ACCEPTANCE PREMISE: CE T3 has exactly ONE quarterback on its roster (Team 7 / Sam Darnold)');
select ok(
  (select g.kickoff_at <= now() from nfl_games g
   join players p on p.team = g.home_team or p.team = g.away_team
   where p.id = 'ce2-qb1' and g.season = 2026 and g.week = 3),
  '…and his week-3 game has ALREADY KICKED OFF — under the lock his seat is closed to every manager verb');
select is(
  (select slot_map -> 'qb:0' from team_lineups where team_id = 'c4000000-0000-4000-8000-000000000003' and week = 3),
  null::jsonb,
  '…and qb:0 is EMPTY: the atomic submit was refused whole, so nothing was stored. There is no legal complete lineup for this team this week, which is the situation the ruling exists to end');
select is((select count(*)::int from matchups where league_id = 'b4000000-0000-4000-8000-000000000001' and week = 3), 1,
  'the fixture HAS a week-3 matchup for the edited team — the premise that makes the is_overridden cell below falsifiable rather than an empty-table 0 (R972)');

-- ---------------------------------------------------------------------------
-- C. IMMUTABILITY, BOTH DIRECTIONS AND BOTH MECHANISMS (§12.12)
--    The RLS half is what the spec claims. The OWNER half is what the spec
--    ASSUMES and Postgres does not give it — and the owner is the role every
--    SECURITY DEFINER writer runs as.
-- ---------------------------------------------------------------------------
-- A seed row, written as postgres so §C's role cells start from a known count.
insert into commissioner_actions (id, league_id, actor_id, action_type, target_type, target_id, reason, before, after)
values ('a4000000-0000-4000-8000-00000000000f', 'b4000000-0000-4000-8000-000000000001',
        '94000000-0000-4000-8000-000000000001', 'edit_score', 'matchup', 'seed', 'seed row', '{}', '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is((select count(*)::int from commissioner_actions), 1,
  'the COMMISSIONER reads the audit log (the SELECT-sees-N premise)');
select lives_ok(
  $$ insert into commissioner_actions (league_id, actor_id, action_type, reason)
     values ('b4000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'change_setting', 'client append') $$,
  '§12.12:1208''s INSERT policy: a commissioner MAY append directly (the spec names this policy, so it ships — delivery plan §8.2)');
select is((select count(*)::int from commissioner_actions), 2, '…and the appended row is there');
-- IMMUTABLE to the commissioner: no UPDATE and no DELETE policy exists, so
-- the rows are not even visible to the statement — 0 rows affected, no error.
-- (A data-modifying CTE is legal only at the top level of a statement, so the
--  affected-row counts are captured into a scratch table rather than read from
--  a scalar subquery.)
create temp table _rls_probe (op text, n int);
with u as (update commissioner_actions set reason = 'tampered' returning 1)
insert into _rls_probe select 'update', count(*)::int from u;
with d as (delete from commissioner_actions returning 1)
insert into _rls_probe select 'delete', count(*)::int from d;
select is((select n from _rls_probe where op = 'update'), 0,
  'RLS HALF: the commissioner''s UPDATE affects ZERO rows — there is no UPDATE policy (§12.12:1205)');
select is((select n from _rls_probe where op = 'delete'), 0,
  'RLS HALF: the commissioner''s DELETE affects ZERO rows — there is no DELETE policy');
select is((select reason from commissioner_actions where id = 'a4000000-0000-4000-8000-00000000000f'), 'seed row',
  '…and the row is untouched');

select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select is((select count(*)::int from commissioner_actions), 2,
  'a league member with NO team reads the audit log — §10.3:702 visibility is MEMBER, not commissioner');
select throws_ok(
  $$ insert into commissioner_actions (league_id, actor_id, action_type, reason)
     values ('b4000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000004', 'edit_score', 'not mine') $$,
  '42501', null, 'a non-commissioner member cannot append (the INSERT policy''s is_league_commish half)');

select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is((select count(*)::int from commissioner_actions), 0, 'an OUTSIDER reads nothing (is_league_member)');
set local role anon;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from commissioner_actions), 0, 'anon reads nothing');
reset role;

-- THE OWNER HALF — the claim RLS cannot make, and the break probe's target.
select is((select count(*)::int from commissioner_actions), 2, 'postgres sees both rows (the SELECT-sees-N premise for the owner cells)');
select throws_ok(
  $$ update commissioner_actions set reason = 'tampered by the owner' where id = 'a4000000-0000-4000-8000-00000000000f' $$,
  'P0001', null,
  'OWNER HALF: an UPDATE as the TABLE OWNER is REFUSED by trg_commish_actions_immutable — RLS does not restrain the owner, and the owner is the role every SECURITY DEFINER writer runs as');
select throws_ok(
  $$ delete from commissioner_actions where id = 'a4000000-0000-4000-8000-00000000000f' $$,
  'P0001', null,
  'OWNER HALF: a DELETE as the TABLE OWNER is REFUSED by the same trigger (§12.12: "undoing" an override is a NEW row, never an edit)');
select is((select count(*)::int from commissioner_actions), 2, '…and nothing moved');

-- TRUNCATE — the same hole one operation over (R967). A FOR EACH ROW trigger
-- never fires for TRUNCATE and RLS does not apply to it at all, and Supabase's
-- default grants TRUNCATE on a new public table to anon and authenticated.
-- MEASURED before the fix: as `authenticated`, `DELETE` affected 0 rows (RLS,
-- as designed) and `TRUNCATE ... CASCADE` then SUCCEEDED, cascading into
-- league_weeks / matchups / transactions / team_week_results through the three
-- FKs this migration adds — while the RLS cells above stayed green the whole
-- time. That is the shape of the hazard: an all-green role matrix over an
-- erasable log.
select is((select tgenabled from pg_trigger where tgname = 'trg_commish_actions_no_truncate'), 'A',
  'trg_commish_actions_no_truncate is ENABLE ALWAYS (R616) — the same replica-mode reasoning as the row trigger');
select ok(
  (select (tgtype & 1) = 0 and (tgtype & 32) > 0
   from pg_trigger where tgname = 'trg_commish_actions_no_truncate'),
  'trg_commish_actions_no_truncate is a STATEMENT trigger on TRUNCATE — a row trigger cannot see TRUNCATE at all, which is why the log needed a second one');
-- CASCADE is the form the measurement used and the only form that reaches the
-- trigger at all: a bare TRUNCATE is refused first with 0A000 ("cannot
-- truncate a table referenced in a foreign key constraint") by the three FKs
-- this migration adds, and CASCADE is exactly what walks past that — taking
-- league_weeks / matchups / transactions / team_week_results with it.
select throws_ok(
  $$ truncate table commissioner_actions cascade $$,
  'P0001', null,
  'TRUNCATE ... CASCADE on the audit log is REFUSED, even as the table OWNER — §12.12''s "even a commissioner cannot alter or remove an entry" is only true once this trigger exists (before it, this statement succeeded and cascaded into four in-season tables)');
select ok(
  not has_table_privilege('anon', 'public.commissioner_actions', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.commissioner_actions', 'TRUNCATE')
  and not has_table_privilege('anon', 'public.commish_lineup_actions', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.commish_lineup_actions', 'TRUNCATE'),
  'and the GRANT itself is gone: neither client role holds TRUNCATE on the audit log or on the replay ledger (the Supabase default hands it to both)');

-- THE ONE EXEMPTION, and its boundary. `league_id ... ON DELETE CASCADE` and a
-- blanket DELETE refusal cannot both be true: a cascade IS an ordinary DELETE
-- on this table, so the trigger turned every hard league delete into a P0001
-- (R966 — MEASURED, and it is also the teardown ~10 db-integration suites run
-- as `service.from('leagues').delete()`). The arm fires only when the parent
-- league is ALREADY GONE, so the log dies WITH its league and never one entry
-- at a time. The cell above (a direct owner DELETE while the league lives,
-- REFUSED) is the other half of this pair and must stay green beside it.
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot) values
 ('b4000000-0000-4000-8000-0000000000ff', '94000000-0000-4000-8000-000000000001', 'pgtap-ce-doomed', 2026, 'setup', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'));
insert into commissioner_actions (league_id, actor_id, action_type, reason) values
 ('b4000000-0000-4000-8000-0000000000ff', '94000000-0000-4000-8000-000000000001', 'edit_score', 'a doomed league''s receipt');
select lives_ok(
  $$ delete from leagues where id = 'b4000000-0000-4000-8000-0000000000ff' $$,
  'a league that HAS been audited can still be hard-deleted: the declared ON DELETE CASCADE actually executes (before the exemption this raised P0001 and named the audit log rather than the cascade)');
select is((select count(*)::int from commissioner_actions where league_id = 'b4000000-0000-4000-8000-0000000000ff'), 0,
  '…and its audit rows went with it — the log dies WITH its league, which is the only way an entry can ever leave');

-- ---------------------------------------------------------------------------
-- D. The reason CHECK, one unit either side (R745 / F40's bound)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into commissioner_actions (league_id, actor_id, action_type, reason)
     values ('b4000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'change_setting', '   ') $$,
  '23514', null, 'reason of SPACES is refused by the CHECK');
select throws_ok(
  $$ insert into commissioner_actions (league_id, actor_id, action_type, reason)
     values ('b4000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'change_setting', E'\t\t') $$,
  '23514', null, 'reason of TABS is refused — plain btrim() strips spaces only, which is the R745 hole §12.12''s printed CHECK still has');
select throws_ok(
  $$ insert into commissioner_actions (league_id, actor_id, action_type, reason)
     values ('b4000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'change_setting', E'\n\r\n') $$,
  '23514', null, 'reason of NEWLINES is refused (the same class)');
select lives_ok(
  $$ insert into commissioner_actions (league_id, actor_id, action_type, reason)
     values ('b4000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'change_setting', repeat('r', 500)) $$,
  'reason of exactly 500 characters lives (the league_chat bound, F40)');
select throws_ok(
  $$ insert into commissioner_actions (league_id, actor_id, action_type, reason)
     values ('b4000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'change_setting', repeat('r', 501)) $$,
  '23514', null, 'reason of 501 characters is refused — one unit the other side');
-- NOTE: these probe rows are NOT cleaned up, because they CANNOT be — the
-- immutability trigger refuses a DELETE even as the owner. That is the
-- feature. Every count cell below is scoped to action_type = 'edit_lineup'
-- for exactly this reason.

-- A parked FK actually refuses an orphan.
select throws_ok(
  $$ update league_weeks set reopened_by_action_id = 'a4000000-0000-4000-8000-0000000000ee'
     where league_id = 'b4000000-0000-4000-8000-000000000001' and week = 1 $$,
  '23503', null, 'league_weeks.reopened_by_action_id now REFUSES an id no audit row has (056:68''s parked FK, landed)');

-- ---------------------------------------------------------------------------
-- E. THE LOCK CONTRAST — arm (a), then arm (b). Each `commish_edit_lineup`
--    success is paired with the SAME map REFUSED through `set_lineup`.
-- ---------------------------------------------------------------------------
set local role authenticated;

-- ARM (a): the stored starter ce-qb1 kicked off; moving him out of qb:0 is
-- refused for the MANAGER…
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select set_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "ce-qb2", "rb:0": "ce-rb1", "wr:0": "ce-wr1", "flex:0": "ce-wr2"}'::jsonb,
       'e4000000-0000-4000-8000-000000000001'::uuid) $$,
  'P0001',
  null,
  'ARM (a) STILL BINDS THE MANAGER: set_lineup refuses to move ce-qb1 out of a slot whose game has kicked off (§11.2; 114:449-462)');
-- …and refused for the COMMISSIONER through the manager's verb too. The
-- exemption is a property of the NEW verb, never a relaxation of the old one.
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select set_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "ce-qb2", "rb:0": "ce-rb1", "wr:0": "ce-wr1", "flex:0": "ce-wr2"}'::jsonb,
       'e4000000-0000-4000-8000-000000000002'::uuid, 'commish via the manager verb') $$,
  'P0001',
  null,
  'ARM (a) BINDS THE COMMISSIONER TOO when he uses set_lineup — 114:244-245 admits him at auth and the lock arms still refuse him. THIS IS THE DEFECT PROGRESS §3(g) NAMES, and it is deliberately still true here');

-- THE OVERRIDE. Same map, same instant, same commissioner — through the
-- audited verb it LANDS.
select lives_ok(
  $$ select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "ce-qb2", "rb:0": "ce-rb1", "wr:0": "ce-wr1", "flex:0": "ce-wr2"}'::jsonb,
       'manager never showed — QB1 already played', 'e4000000-0000-4000-8000-000000000003'::uuid) $$,
  'THE RULING: commish_edit_lineup moves a player out of a slot whose game has started (Chris 2026-09-09: "an LM should be able to set the lineup even after the games have started")');
-- …and it actually MOVED. This is the cell that catches the hidden third
-- lock: had `fixed` been carried from 114:490-493, lineup_fit_internal would
-- have re-pinned ce-qb1 at qb:0 (112:498-505) and the call would still have
-- LIVED, silently.
select is((select slot_map ->> 'qb:0' from team_lineups where team_id = 'c4000000-0000-4000-8000-000000000002' and week = 3),
  'ce-qb2',
  'THE HIDDEN THIRD LOCK IS OFF: the canonical slot_map actually holds ce-qb2 — passing fixed = TRUE into lineup_fit_internal would have re-pinned ce-qb1 here while the call still lived');
select is((select slot_map from team_lineups where team_id = 'c4000000-0000-4000-8000-000000000002' and week = 3),
  '{"qb:0": "ce-qb2", "rb:0": "ce-rb1", "wr:0": "ce-wr1", "flex:0": "ce-wr2"}'::jsonb,
  '…and the whole canonical map is the submitted one, byte for byte');
select is((select edited_by_commish from team_lineups where team_id = 'c4000000-0000-4000-8000-000000000002' and week = 3), true,
  'edited_by_commish is the literal TRUE (§11.2)');
select is((select locked_at from team_lineups where team_id = 'c4000000-0000-4000-8000-000000000002' and week = 3),
  now() + interval '1 second',
  'locked_at is the LEAST kickoff among players in STARTING slots — DAL''s +1s, not the KC game already played (114:600-602; lineup_lock_tick recomputes it identically at 116:718-720, so any other value would be overwritten hourly)');

-- ARM (b): ce-qb1 has kicked off and is now BENCHED. Putting him back into a
-- slot is refused for the manager…
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select set_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "ce-qb1", "rb:0": "ce-rb1", "wr:0": "ce-wr1", "flex:0": "ce-wr2"}'::jsonb,
       'e4000000-0000-4000-8000-000000000004'::uuid) $$,
  'P0001',
  null,
  'ARM (b) STILL BINDS THE MANAGER: a player whose game has kicked off cannot ENTER a slot (§11.2; 114:464-476) — this is exactly what refused Chris''s Teams 5-8');
-- …and lands through the override.
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "ce-qb1", "rb:0": "ce-rb1", "wr:0": "ce-wr1", "flex:0": "ce-wr2"}'::jsonb,
       'restoring the correct starter', 'e4000000-0000-4000-8000-000000000005'::uuid) $$,
  'THE RULING, arm (b): commish_edit_lineup SEATS a player whose game has already started — Team 7''s Sam Darnold case');
select is((select slot_map ->> 'qb:0' from team_lineups where team_id = 'c4000000-0000-4000-8000-000000000002' and week = 3),
  'ce-qb1', '…and he is actually in the seat');

-- The receipt names what it walked past.
select is(
  (select metadata -> 'bypassed' from commissioner_actions
   where action_type = 'edit_lineup' order by created_at desc, id desc limit 1),
  '["per_player_kickoff_lock"]'::jsonb,
  'the audit row NAMES the rule the override walked past — "per_player_kickoff_lock", never a silent success');
select is(
  (select jsonb_array_length(metadata -> 'locked_players_moved') from commissioner_actions
   where action_type = 'edit_lineup' order by created_at desc, id desc limit 1),
  1, '…and names the one kicked-off player it moved (a manager could not have)');

-- ---------------------------------------------------------------------------
-- F. AUTH — the commissioner verb is commissioner-only
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "ce-qb2"}'::jsonb, 'I am this team''s manager', 'e4000000-0000-4000-8000-000000000006'::uuid) $$,
  '42501', 'commish_edit_lineup: not a commissioner of this league',
  'THE TEAM''S OWN MANAGER is refused — the override is not a manager''s door; he has set_lineup');
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "ce-qb2"}'::jsonb, 'outsider', 'e4000000-0000-4000-8000-000000000007'::uuid) $$,
  '42501', 'commish_edit_lineup: not a commissioner of this league', 'an OUTSIDER gets the same no-leak 42501');
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "ce-qb2"}'::jsonb, 'a member, not a commish', 'e4000000-0000-4000-8000-000000000008'::uuid) $$,
  '42501', 'commish_edit_lineup: not a commissioner of this league', 'a non-managing MEMBER gets the same 42501');
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$ select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "ce-qb2"}'::jsonb, 'anon', 'e4000000-0000-4000-8000-000000000009'::uuid) $$,
  '42501', null, 'anon holds no EXECUTE on the verb at all');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

-- THE REASON IS OPTIONAL (Q66, migration 131 / L.E1.15, F362 — spec v2.16.41
-- §10.3 / §15.4). The two refusal cells that stood here are re-cut as SOURCE
-- pins (count-neutral for the §G premises below); the BEHAVIOURAL landings
-- are §Q at the end of this file. ***THE L.E1.15 BREAK PROBE'S TARGET*** for
-- this verb: re-add 123:666-670's gate and the first pin reds by name.
select ok(
  (select p.prosrc not like '%commish_edit_lineup: a reason is required%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_edit_lineup_internal'),
  'Q66 (131): commish_edit_lineup_internal no longer carries 123:668''s "a reason is required" refusal — the gate is a NORMALISATION now (§4 rule 12 re-read)');
select ok(
  (select p.prosrc like '%CASE WHEN v_reason IS NOT NULL THEN '' — reason: '' || v_reason ELSE '''' END%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_edit_lineup_internal'),
  'Q66 (131): …and its chat post''s "— reason:" clause is CONDITIONAL in the source (never "reason: <NULL>")');
select throws_ok(
  $$ select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "ce-qb2", "rb:0": "ce-rb1"}'::jsonb, repeat('x', 501), 'e4000000-0000-4000-8000-00000000000c'::uuid) $$,
  '22023', null, 'a 501-character reason is refused in-body before the CHECK ever sees it');
select throws_ok(
  $$ select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "ce-qb2"}'::jsonb, 'no action id', null) $$,
  '22023', null, 'a missing action_id is refused (the idempotency key is not optional)');

-- ---------------------------------------------------------------------------
-- G. CHRIS'S ONE CONDITION — "no receipt if nothing is done. only when
--    something is done." Asserted THREE ways, and DETECTED, never inferred.
-- ---------------------------------------------------------------------------
select is((select count(*)::int from commissioner_actions where action_type = 'edit_lineup'), 2,
  'two real edits so far ⇒ two receipts (the premise for the no-op cells)');
select is((select count(*)::int from league_chat where league_id = 'b4000000-0000-4000-8000-000000000001' and is_system), 2,
  '…and two system posts (§10.3: override posts auto-post and cannot be disabled)');
select is(
  (select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
     '{"qb:0": "ce-qb1", "rb:0": "ce-rb1", "wr:0": "ce-wr1", "flex:0": "ce-wr2"}'::jsonb,
     'submitting the identical map', 'e4000000-0000-4000-8000-00000000000d'::uuid) ->> 'no_changes'),
  'true',
  'an IDENTICAL submit reports no_changes = true BY NAME (rule 10 — detected, not inferred from an empty write)');
select is((select count(*)::int from commissioner_actions where action_type = 'edit_lineup'), 2,
  'CHRIS''S CONDITION: the no-op wrote NO audit row — "no receipt if nothing is done"');
select is((select count(*)::int from league_chat where league_id = 'b4000000-0000-4000-8000-000000000001' and is_system), 2,
  '…and NO system post either');
select is(
  (select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
     '{"qb:0": "ce-qb1", "rb:0": "ce-rb1", "wr:0": "ce-wr1", "flex:0": "ce-wr2"}'::jsonb,
     'still identical', 'e4000000-0000-4000-8000-00000000000e'::uuid) -> 'commissioner_action_id'),
  'null'::jsonb,
  '…and the result SAYS so: commissioner_action_id is null on a no-op, so the caller reads the absence rather than guessing at it');
select is((select count(*)::int from commish_lineup_actions), 0,
  'the ledger is INVISIBLE to a commissioner — zero policies, so no client can read (let alone pre-plant) a replay row; this is what commissioner_actions'' printed INSERT policy could not have given us');
reset role;
select is((select count(*)::int from commish_lineup_actions), 4,
  'the LEDGER row is written for a no-op too (114:748''s posture) — an action_id is consumed by its submit whether or not anything moved. This is the OPPOSITE rule from the audit row, deliberately (§12.26)');

-- REPLAY: the same action_id with a DIFFERENT map returns the stored result
-- byte-identically, and writes nothing.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
-- The call must run as the commissioner (auth is step 2, BEFORE the replay
-- lookup), but the stored row it is compared against is only readable by the
-- owner — so the returned document is captured, then the roles swap.
create temp table _replay as
select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
  '{"qb:0": "ce-qb2", "rb:0": "ce-rb2"}'::jsonb, 'a different map entirely',
  'e4000000-0000-4000-8000-000000000005'::uuid)::text as got;
select is((select slot_map ->> 'qb:0' from team_lineups where team_id = 'c4000000-0000-4000-8000-000000000002' and week = 3),
  'ce-qb1', 'the replay wrote nothing — the lineup is untouched');
reset role;
select is(
  (select got from _replay),
  (select result::text from commish_lineup_actions where action_id = 'e4000000-0000-4000-8000-000000000005'),
  'REPLAY (E2/D68): the same action_id returns the stored result BYTE-identically, even with a different map');
select is((select count(*)::int from commissioner_actions where action_type = 'edit_lineup'), 2,
  '…and no second receipt for a replayed action');

-- ---------------------------------------------------------------------------
-- H. THE SCORE FOLLOWS, OR THE VERB SAYS IT DID NOT (CLAUDE.md: never let
--    "nothing happened" mean "it worked")
-- ---------------------------------------------------------------------------
reset role;
update league_weeks set status = 'live'
where league_id = 'b4000000-0000-4000-8000-000000000001' and week = 3;
-- ce-rb2 has a stat line written an hour ago; ce-rb1 has one too. A row
-- stamped now() would be `not_ready` for the worker FOREVER.
insert into player_stats (player_id, season, week, stat_type, updated_at) values
 ('ce-rb1', 2026, 3, 'weekly', now() - interval '1 hour'),
 ('ce-rb2', 2026, 3, 'weekly', now() - interval '1 hour');
delete from score_fanout where season = 2026 and week = 3;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select lives_ok(
  $$ select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "ce-qb1", "rb:0": "ce-rb2", "wr:0": "ce-wr1", "flex:0": "ce-wr2"}'::jsonb,
       'swapping the running back', 'e4000000-0000-4000-8000-000000000010'::uuid) $$,
  'a LIVE week accepts the edit');
reset role;
select is((select count(*)::int from score_fanout where season = 2026 and week = 3), 2,
  'the SYMMETRIC DIFFERENCE of old and new starters is enqueued for re-scoring — a lineup edit enqueues NOTHING on its own (score_fanout''s only other writer is stat ingestion), so without this the lineup moves and the score silently does not');
select ok(
  (select bool_and(f.enqueued_at <= ps.updated_at)
   from score_fanout f
   join (select player_id, min(updated_at) updated_at from player_stats
         where season = 2026 and week = 3 group by player_id) ps on ps.player_id = f.player_id
   where f.season = 2026 and f.week = 3),
  'THE STARVATION TRAP: every enqueued row is stamped with the player''s OWN player_stats.updated_at, never now(). The worker''s readiness rule is `updated_at >= enqueued_at` (score-week-worker.ts:1142), so a now() stamp would be not_ready FOREVER — a poisoned queue row AND no re-score');

-- ---------------------------------------------------------------------------
-- H2. THE ACCEPTANCE TEST. It is 00:25 on game night. The week is the CURRENT
--     week and its status is `live`. Chris is the commissioner, on the page of
--     an unmanaged seat whose ONLY quarterback kicked off five minutes ago and
--     whose qb:0 is empty. He must be able to seat that quarterback, give a
--     reason, save a COMPLETE lineup, get an audit row, and have the SCORE
--     follow. Any step that stops him is still a blocker.
-- ---------------------------------------------------------------------------
reset role;
-- The four T3 players carry stat lines written an hour ago (the live-week
-- shape: the KC game is in progress, the NYG games are not).
insert into player_stats (player_id, season, week, stat_type, updated_at) values
 ('ce2-qb1', 2026, 3, 'weekly', now() - interval '1 hour'),
 ('ce2-rb1', 2026, 3, 'weekly', now() - interval '1 hour'),
 ('ce2-wr1', 2026, 3, 'weekly', now() - interval '1 hour'),
 ('ce2-wr2', 2026, 3, 'weekly', now() - interval '1 hour');
delete from score_fanout where season = 2026 and week = 3;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

-- THE CONTRAST FIRST: the manager's verb refuses this map for the
-- commissioner too, and the refusal is the one that cost Chris ten placements.
select throws_ok(
  $$ select set_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000003', 3,
       '{"qb:0": "ce2-qb1", "rb:0": "ce2-rb1", "wr:0": "ce2-wr1", "flex:0": "ce2-wr2"}'::jsonb,
       'e4000000-0000-4000-8000-000000000030'::uuid, 'seating the only QB after kickoff') $$,
  'P0001', null,
  'ACCEPTANCE, the contrast: on a LIVE current week set_lineup refuses to seat the kicked-off quarterback — for the commissioner as much as the manager, and the whole map goes with him');

select lives_ok(
  $$ select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000003', 3,
       '{"qb:0": "ce2-qb1", "rb:0": "ce2-rb1", "wr:0": "ce2-wr1", "flex:0": "ce2-wr2"}'::jsonb,
       'unmanaged seat — his only QB had already kicked off and qb:0 was empty',
       'e4000000-0000-4000-8000-000000000031'::uuid) $$,
  'THE ACCEPTANCE TEST: on the CURRENT week whose status is LIVE, the commissioner seats a kicked-off quarterback for an unmanaged seat');
select is((select slot_map from team_lineups where team_id = 'c4000000-0000-4000-8000-000000000003' and week = 3),
  '{"qb:0": "ce2-qb1", "rb:0": "ce2-rb1", "wr:0": "ce2-wr1", "flex:0": "ce2-wr2"}'::jsonb,
  '…and the stored lineup is COMPLETE — every starting slot filled, the quarterback in his seat');
reset role;
select is(
  (select metadata -> 'flags' -> 'empty' from commissioner_actions
   where action_type = 'edit_lineup' and target_id = 'c4000000-0000-4000-8000-000000000003'
   order by created_at desc, id desc limit 1),
  '[]'::jsonb,
  '…with NO empty starting slot left behind (the receipt''s own flags, not the test''s arithmetic)');
select is(
  (select count(*)::int from commissioner_actions
   where action_type = 'edit_lineup' and target_id = 'c4000000-0000-4000-8000-000000000003'),
  1, '…and exactly ONE audit row was written for this team');

-- THE SCORE FOLLOWS — the enqueue half, here; the drain half is
-- `score-week-worker-db.test.ts` (R965), and the two meet at these two facts.
select ok(
  exists (select 1 from score_fanout f where f.season = 2026 and f.week = 3 and f.player_id = 'ce2-qb1'),
  'THE SCORE FOLLOWS (1/2): the seated quarterback is ENQUEUED, so the drain will VISIT this league-week at all — a lineup edit enqueues nothing on its own (score_fanout''s only other writer is stat ingestion)');
select is((select edited_by_commish from team_lineups where team_id = 'c4000000-0000-4000-8000-000000000003' and week = 3), true,
  'THE SCORE FOLLOWS (2/2): the row the verb wrote carries `edited_by_commish`, which is what makes the drain compute THIS team once it is here (score-week-worker.ts step 5b) — step 5 alone reaches a team only through a CURRENT starter, and the starter an edit REMOVES is by definition not one');

-- ---------------------------------------------------------------------------
-- H3. THE BLOCKER ITSELF, reproduced. Bench the kicked-off quarterback and put
--     NOBODY in his seat. The symmetric difference is that one player, and he
--     now starts NOWHERE — so the drain's step (5) finds no affected team,
--     `toCompute.size === 0`, `outcome: 'skipped'`, and the queue row is
--     DELETED (score-week-worker.ts:982-986 / :1241-1251) with the benched
--     player's points still in `team_week_results` for ever. That is the state
--     these cells pin: the verb's half is correct and the drain's half is what
--     had to change.
-- ---------------------------------------------------------------------------
reset role;
delete from score_fanout where season = 2026 and week = 3;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000003', 3,
     '{"rb:0": "ce2-rb1", "wr:0": "ce2-wr1", "flex:0": "ce2-wr2"}'::jsonb,
     'benching the quarterback whose game is already played', 'e4000000-0000-4000-8000-000000000032'::uuid)
   ->> 'score_stale'),
  'false',
  'BLOCKER 1''s scenario: the locked quarterback is benched and qb:0 left EMPTY — the verb reports the score is NOT stale, and it must be able to keep that promise');
reset role;
select is((select array_agg(f.player_id order by f.player_id) from score_fanout f where f.season = 2026 and f.week = 3),
  array['ce2-qb1'],
  '…the enqueue is exactly the symmetric difference: the removed quarterback, alone');
select is(
  (select count(*)::int
   from score_fanout f
   join team_lineups tl on tl.season = f.season and tl.week = f.week
   join jsonb_each_text(tl.slot_map) e on true
   where f.season = 2026 and f.week = 3 and e.value = f.player_id
     and e.key not like 'ir%'),
  0,
  'THE PREMISE OF THE BLOCKER, measured: the ONE queued player is a starter of NO team this week. `affected` is empty, so the drain would report `skipped` and consume the row — which is why the recompute is forced from the lineup row''s `edited_by_commish` instead (R965; the drain half is pinned in score-week-worker-db.test.ts)');
select is((select edited_by_commish from team_lineups where team_id = 'c4000000-0000-4000-8000-000000000003' and week = 3), true,
  '…and the flag that forces it is on the row');

-- H4. THE OMISSION IS NAMED, never inferred from a short array (R968). Two
--     arms, and they are deliberately DIFFERENT: a changed starter with NO
--     stat line is not stale (the worker scores an absent line as 0, so no
--     points moved), while a changed starter whose line exists but carries a
--     NULL `updated_at` MAY carry points and could not be given a claimable
--     queue stamp — that one IS stale. Both are said by name.
reset role;
delete from score_fanout where season = 2026 and week = 3;
delete from player_stats where player_id = 'ce2-wr2' and season = 2026 and week = 3;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000003', 3,
     '{"rb:0": "ce2-rb1", "wr:0": "ce2-wr1"}'::jsonb,
     'dropping the flex starter who has no stat line', 'e4000000-0000-4000-8000-000000000033'::uuid)
   -> 'score_not_enqueued'),
  '[{"why": "no_stat_row", "player_id": "ce2-wr2"}]'::jsonb,
  'R968: a changed starter the enqueue could NOT queue is NAMED with its reason — never left to be inferred from a `score_enqueued` that is merely short');
select is(
  (select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000003', 3,
     '{"rb:0": "ce2-rb1", "wr:0": "ce2-wr1"}'::jsonb,
     'the same map again', 'e4000000-0000-4000-8000-000000000034'::uuid)
   ->> 'score_stale'),
  'false',
  '…and `no_stat_row` is NOT stale: the worker scores an absent line as 0, so adding or removing that player moves no points (this replays the previous action_id''s sibling — a no-op, which also proves the arm survives a second look)');

reset role;
-- The other arm: a line that EXISTS but cannot be stamped. player_stats.updated_at
-- is NULLABLE (measured: information_schema.columns → is_nullable = YES), so a
-- partial ingestion can leave a scoreable line the queue cannot take.
update player_stats set updated_at = null where player_id = 'ce2-wr1' and season = 2026 and week = 3;
delete from score_fanout where season = 2026 and week = 3;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
create temp table _unstamped as
select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000003', 3,
  '{"rb:0": "ce2-rb1"}'::jsonb, 'benching the starter whose line has no timestamp',
  'e4000000-0000-4000-8000-000000000035'::uuid) as got;
select is((select got ->> 'score_stale' from _unstamped), 'true',
  'R968, the other arm: a changed starter whose stat line exists but carries a NULL updated_at CANNOT be given a claimable queue stamp, so the verb reports score_stale = TRUE rather than folding the omission into silence');
select is((select got ->> 'score_stale_reason' from _unstamped), 'stats_unstamped',
  '…and the reason is NAMED, so the UI can say which of the two things went wrong (lineup-editor-ops.ts''s scoreStaleCopy has the arm)');
reset role;
update player_stats set updated_at = now() - interval '1 hour' where player_id = 'ce2-wr1' and season = 2026 and week = 3;

-- A FINAL week: the edit lands, and the verb SAYS the score did not follow.
reset role;
-- §12.17/F4 guards the ladder: upcoming → live → correction_window → final.
update league_weeks set status = 'correction_window'
where league_id = 'b4000000-0000-4000-8000-000000000001' and week = 3;
update league_weeks set status = 'final'
where league_id = 'b4000000-0000-4000-8000-000000000001' and week = 3;
delete from score_fanout where season = 2026 and week = 3;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
     '{"qb:0": "ce-qb1", "rb:0": "ce-rb1", "wr:0": "ce-wr1", "flex:0": "ce-wr2"}'::jsonb,
     'retroactive fix to a closed week', 'e4000000-0000-4000-8000-000000000011'::uuid) ->> 'score_stale'),
  'true',
  'a FINAL week reports score_stale = true — the verb NEVER reports plain success for a write whose score consequence did not happen');
reset role;
select is((select count(*)::int from score_fanout where season = 2026 and week = 3), 0,
  '…and enqueues NOTHING: the write door raises week_final (119:566-568) and the worker would consume the row with no cell changed (:892-895), so an enqueue here would be actively deceptive');
select is((select slot_map ->> 'rb:0' from team_lineups where team_id = 'c4000000-0000-4000-8000-000000000002' and week = 3),
  'ce-rb1',
  'THE CLOSED-WEEK GATE IS LIFTED: 114:299-305 refuses a correction_window/final week and says the change goes "through the audited commissioner override" — this is that override (§11.2:730, "including retroactively")');
-- R972 — NOT VACUOUS ANY MORE. The fixture carries a REAL week-3 matchup for
-- the edited team (asserted in §B), and the assertion is on THAT ROW rather
-- than on a count over a table that happened to be empty. A future revision
-- that added `UPDATE matchups SET is_overridden = TRUE` to the verb — which
-- §12.12 sketches a trigger around, so it is a plausible move — reds here.
select is(
  (select is_overridden from matchups
   where league_id = 'b4000000-0000-4000-8000-000000000001' and week = 3
     and home_team_id = 'c4000000-0000-4000-8000-000000000002'),
  false,
  'the verb NEVER sets matchups.is_overridden on the edited team''s OWN matchup row — on an open week that would freeze the cell out of the write door (119:634/:654), which is the exact recompute the edit exists to cause');
select is((select count(*)::int from matchups where is_overridden), 0,
  '…and it sets it on no other row either (the league-wide sweep, over a fixture that HAS matchups — R972)');
-- (Week 3 STAYS final — §12.17's ladder has no way back, and the past-week
--  cells below use week 2, whose own status is untouched.)
reset role;

-- THE PAST-WEEK GATE IS LIFTED TOO (week 2 < current week 3).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select set_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 2,
       '{"qb:0": "ce-qb2"}'::jsonb, 'e4000000-0000-4000-8000-000000000012'::uuid, 'past week via the manager verb') $$,
  'P0001', null, 'set_lineup still refuses a PAST week for everyone (114:293-298)');
select is(
  (select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 2,
     '{"qb:0": "ce-qb2"}'::jsonb, 'retroactive week-2 correction', 'e4000000-0000-4000-8000-000000000013'::uuid)
   -> 'bypassed'),
  '["past_week", "per_player_kickoff_lock"]'::jsonb,
  'THE PAST-WEEK GATE IS LIFTED and EVERY bypass is NAMED in the result and the receipt (§11.2:730). Both appear because week 2 has no nfl_games rows, so 115''s conservative fallback locks every player from the week datum — a retroactive edit is a lock bypass as well as a past-week one, and the receipt says both.');
select is((select slot_key from league_rosters where player_id = 'ce-qb1'), 'qb:0',
  'a RETROACTIVE edit leaves league_rosters.slot_key alone: it still names ce-qb1 from the CURRENT week''s lineup, not ce-qb2 whom the week-2 edit seated at qb:0. slot_key describes the ACTIVE week only, and 114''s `IF p_week = v_current` guard is correct as written');
select isnt((select slot_key from league_rosters where player_id = 'ce-qb2'), 'qb:0',
  '…and the retroactively-seated player did NOT take the current week''s slot_key');

-- ---------------------------------------------------------------------------
-- I. THE NEVER-WEAKEN PIN. `set_lineup` is on CLAUDE.md's never-weaken list.
--    A PR that added a commissioner exemption to the MANAGER's verb reds here.
-- ---------------------------------------------------------------------------
reset role;
select ok(
  (select p.prosrc like '%a locked slot''''s player never moves (§11.2, lineup_lock = per_player_kickoff); every other unlocked slot stays editable%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_lineup_internal'),
  'NEVER-WEAKEN: set_lineup_internal still carries ARM (a)''s refusal verbatim (114:457-461)');
select ok(
  (select p.prosrc like '%a player whose game has started cannot enter or move slots (§11.2, lineup_lock = per_player_kickoff)%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_lineup_internal'),
  'NEVER-WEAKEN: set_lineup_internal still carries ARM (b)''s refusal verbatim (114:471-475)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_lineup_internal' and p.prosrc like '%is_league_commish%'),
  1, 'set_lineup_internal names is_league_commish EXACTLY ONCE — at the auth gate (114:244-245), never inside a lock arm');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('set_lineup', 'set_lineup_internal')),
  2, 'set_lineup / set_lineup_internal are still ONE overload each — 123 added a verb beside them, it did not re-author them');
-- The new verb reuses the matcher UNCHANGED — no second matcher was written.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_fit_internal'),
  1, 'lineup_fit_internal is still ONE function — the override passes fixed = FALSE rather than forking the matcher or adding a parameter to it');
select ok(
  (select p.prosrc ~ '''fixed'',\s+FALSE'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_edit_lineup_internal'),
  'commish_edit_lineup_internal passes fixed = FALSE for EVERY player — the hidden third lock (112:498-505 / 112:518) is off by construction, not by accident');

-- ---------------------------------------------------------------------------
-- J. THE HIDDEN THIRD LOCK, proved BEHAVIOURALLY and not just by source text.
--    `fixed` only becomes observable when the matcher has to RE-SEAT someone,
--    because `wanted` comes from the SUBMITTED map — so a straight swap of two
--    kicked-off players looks identical either way. It bites here: ce-wr1 is
--    submitted at qb:0 (ineligible for a WR) and its only escape route runs
--    through flex:0, which the locked ce-qb1 occupies.
--      fixed = TRUE  → flex:0 is owned by a FIXED player, the BFS refuses to
--                      traverse it (112:518), ce-wr1 is unplaced, E16 RAISES.
--      fixed = FALSE → ce-qb1 re-seats to qb:0, ce-wr1 takes flex:0, all placed.
--    THE BREAK PROBE for this cell reinstates 114:490-493's `fixed`
--    computation: this cell and §I's source pin BOTH red.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "ce-wr1", "wr:0": "ce-wr2", "flex:0": "ce-qb1"}'::jsonb,
       'a re-seat that must route through the locked player''s slot',
       'e4000000-0000-4000-8000-000000000020'::uuid) $$,
  'THE HIDDEN THIRD LOCK IS OFF, behaviourally: the matcher re-seats the kicked-off ce-qb1 so ce-wr1 can be placed. With 114:490-493''s `fixed` carried over, flex:0 would be owned by a FIXED player, the BFS would refuse to traverse it (112:518) and this submit would RAISE E16');
select is((select slot_map from team_lineups where team_id = 'c4000000-0000-4000-8000-000000000002' and week = 3),
  '{"qb:0": "ce-qb1", "wr:0": "ce-wr2", "flex:0": "ce-wr1"}'::jsonb,
  '…and the canonical map is the re-seated one: the LOCKED ce-qb1 was moved by the matcher itself, which is precisely what a manager''s verb may never do');
reset role;

-- ---------------------------------------------------------------------------
-- Q. THE REASON IS OPTIONAL — Q66 (Chris, 2026-09-16; spec v2.16.41 §10.3 /
--    §15.4), landed for THIS verb by migration 131 (L.E1.15 / F362). The
--    proof shape the sweep prescribes, per verb: the no-reason call LANDS with
--    a receipt whose reason IS NULL; whitespace-only ⇒ NULL, not ''; a real
--    reason stored TRIMMED; 500 lives (§F above), 501 still refused; the chat
--    post carries NO "— reason:" clause on a no-reason call. Runs LAST so no
--    earlier count premise moves. The map edits are on T2 (c4…02), whose
--    week-3 map §J left as {qb:0 ce-qb1, wr:0 ce-wr2, flex:0 ce-wr1}.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "ce-qb1", "rb:0": "ce-rb1", "wr:0": "ce-wr2", "flex:0": "ce-wr1"}'::jsonb, null,
       'e4000000-0000-4000-8000-000000000040'::uuid) $$,
  'Q1 a NO-reason edit LANDS (Q66 — "we should not require a reason for anything"): rb:0 filled, nothing else moved. Re-adding 123:666-670''s refusal reds here');
select lives_ok(
  $$ select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "ce-qb1", "rb:0": "ce-rb2", "wr:0": "ce-wr2", "flex:0": "ce-wr1"}'::jsonb, E' \t\r\n ',
       'e4000000-0000-4000-8000-000000000041'::uuid) $$,
  'Q2 a reason of SPACE+TAB+CR+NEWLINE is treated as NO reason and LANDS (the explicit E'' \t\r\n'' class still decides "blank", R745)');
select lives_ok(
  $$ select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "ce-qb1", "rb:0": "ce-rb1", "wr:0": "ce-wr2", "flex:0": "ce-wr1"}'::jsonb, E'\t manager unreachable \n',
       'e4000000-0000-4000-8000-000000000042'::uuid) $$,
  'Q3 a real reason wrapped in tabs and newlines lands…');
select throws_ok(
  $$ select commish_edit_lineup('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "ce-qb1", "rb:0": "ce-rb2", "wr:0": "ce-wr2", "flex:0": "ce-wr1"}'::jsonb, repeat('x', 501),
       'e4000000-0000-4000-8000-000000000043'::uuid) $$,
  '22023', null, 'Q4 a 501-character reason is STILL refused in-body (the league_chat bound survives Q66; only the presence gate went)');
reset role;
select is(
  (select string_agg((metadata ->> 'action_id') || '=' || coalesce(reason, '<NULL>'), ' ' order by metadata ->> 'action_id')
   from commissioner_actions where action_type = 'edit_lineup'
     and metadata ->> 'action_id' in ('e4000000-0000-4000-8000-000000000040', 'e4000000-0000-4000-8000-000000000041',
                                      'e4000000-0000-4000-8000-000000000042', 'e4000000-0000-4000-8000-000000000043')),
  'e4000000-0000-4000-8000-000000000040=<NULL> e4000000-0000-4000-8000-000000000041=<NULL> e4000000-0000-4000-8000-000000000042=manager unreachable',
  'Q5 THE RECEIPTS: no reason ⇒ NULL, whitespace-only ⇒ NULL (not '''' — 130 §0''s CHECK still refuses ''''), tab-wrapped ⇒ stored TRIMMED; the 501 refusal wrote none');
select is(
  (select count(*)::int from league_chat where league_id = 'b4000000-0000-4000-8000-000000000001' and is_system
     and message like 'Week 3 lineup for CE T2 edited by ce_user1 (commissioner override%)' and message not like '%reason%'),
  2, 'Q6 …and EXACTLY the two no-reason landings (Q1, Q2) posted with the override marker and NO "— reason:" clause — every earlier T2 post in this file carried one (the clause is conditional: never "reason: <NULL>", never "reason: " with nothing after it)');
select is(
  (select count(*)::int from league_chat where league_id = 'b4000000-0000-4000-8000-000000000001' and is_system
     and message like 'Week 3 lineup for CE T2 edited by ce_user1 (commissioner override%) — reason: manager unreachable'),
  1, 'Q7 …while the reasoned landing''s post carries the trimmed reason after the marker — pinned by content');
select is(
  (select slot_map from team_lineups where team_id = 'c4000000-0000-4000-8000-000000000002' and week = 3),
  '{"qb:0": "ce-qb1", "rb:0": "ce-rb1", "wr:0": "ce-wr2", "flex:0": "ce-wr1"}'::jsonb,
  'Q8 …and the row holds Q3''s map: the three landings wrote, the refusal did not');

select * from finish();
rollback;
