-- ============================================================================
-- Mock Draft Mode — migration 071 + the L.B1.6 in-place amendments to
-- 065/066/068/069 (spec §8.8 ALL, §22.5 caps, E59/E60; tasks-M2 §3
-- D93/D95/D102/D103 + §4 standing rules; task L.B1.6; PROGRESS D110).
-- pgTAP file is **025** (024 = realtime; next free confirmed at task time).
--
-- Falsifiability notes (§4.3):
--   * THE ZERO-SIDE-EFFECT DIFF PIN (§8.8, the task's contract): §F
--     snapshots league-scoped state (the leagues row as jsonb + row counts
--     for league_members/teams/team_managers/league_invites/league_weeks/
--     league_rosters/league_lists/notifications/league-context chat)
--     BEFORE a scripted mock, drives it launch → completion through the
--     REAL tick, and pins every count identical after — with the drafts/
--     draft_picks positive control proving the mock actually ran (a diff
--     that passes because nothing happened cannot pass the control).
--   * THE SHARED-STRATEGY BOARD PIN (plan §4.2 "one implementation, two
--     consumers" — the DoD break-probe target): the §F scripted board is
--     drafted on a {QB:1, RB:1, bench:1} roster over a pool whose 20 best
--     ADPs are ALL QBs — the shared autopick brain yields exactly
--     {QB:2, RB:1} per team (open-mode S+1 cap + FORCED-mode need-fit),
--     while a forked raw-ADP CPU drafts QBs only (0 RBs). Break probe
--     (shown + reverted in the session log): point ARM 2.5's resolve call
--     at a raw lowest-ADP subquery → the per-team RB pins go RED.
--   * D103(2) BOTH SIDES at the strongest discriminator (§E): the mock's
--     HUMAN seat is T2 — owned and managed by u02 — while u03 launched
--     the mock. u02's pick on their OWN on-clock franchise is REFUSED
--     (the normal turn check would have passed — only the mock branch
--     refuses it); the commissioner is refused (no bypass); the launcher
--     u03, who does NOT manage T2, picks successfully.
--   * D103(3) at the discriminator (§E): u03 does not own T2, so the
--     printed owner arm can never admit them — the queue INSERT/SELECT
--     succeeding proves the carve-out arm alone; the CPU-seat INSERT
--     refusal + the fellow-member zero-read pin the carve-out's bounds.
--   * CPU-NEVER-READS-OWNER-PREP (D93, §E): u01 (T1's owner) carries a
--     primary league board topped mk-rb01; T1's CPU pick takes mk-qb02
--     (ADP+need) — a resolve that consulted the seat owner's board would
--     take mk-rb01. The human-seat inverse: the LAUNCHER's queue top
--     (mk-rb05) IS honored on the human seat's timeout autopick.
--   * CPU DETERMINISM (D93): draft_mock_think_fraction pinned as STORED
--     LITERALS for a fixed (draft_id, pick) — 0.242865 / 0.339449 /
--     0.402973 — plus a 200-pick range sweep inside [0.20, 0.70);
--     draft_mock_cpu_due pinned as literals for realistic/fast/untimed.
--   * E59 BOUNDARY (§E): threshold = grace(30) + one tick(5) = 35s of
--     launcher-heartbeat staleness — beat 34s old → tick leaves the mock
--     LIVE; 36s old → PAUSED with remaining persisted and the actorless
--     system post in the mock's own context. Human-never-CPU-picked: a
--     fresh human seat on the clock with a future deadline survives a
--     tick untouched (ARM 2.5 excludes the human seat; ARM 2 not due) —
--     and the timer-fidelity inverse (fresh at an expired deadline →
--     §8.5.4 autopick) is pinned at pick 16.
--   * 72H IDLE BOUNDARY (§I; the D110 definition — idle_since =
--     GREATEST(updated_at, launcher beat)): 71h idle survives the expiry;
--     updated_at 73h + beat 71h SURVIVES (the beat resets idleness —
--     GREATEST pinned discriminatively); both 73h → deleted with children
--     + mock-context chat; a COMPLETE mock at 100h idle is KEPT (§8.8
--     recap retention).
--   * CAP DISCRIMINATORS (§G): the 4th-active refusal fires with only 3
--     rows created in the hour (< 5 — the active message is the only
--     reachable refusal); the 6th-in-hour refusal fires with only 2
--     actives (< 3 — the hourly message is the only reachable refusal);
--     the hourly boundary is pinned by aging one creation past 60min.
--   * Summary/tick assertions are containment/≥-based where committed
--     wire-suite leftovers could contribute (the 022 rule); every pin on
--     THIS file's mocks reads their rows directly.
--   * All privileged fixture work runs BEFORE any JWT claims (D49(7));
--     mid-test privileged steps use `reset role` (013/.../022 pattern).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(115);

-- ---------------------------------------------------------------------------
-- A. Form pins (§4.1 grants doctrine; D93 constants; the cron entry)
-- ---------------------------------------------------------------------------
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_mock_draft'),
  'create_mock_draft is SECURITY DEFINER with the exact spec-form search_path');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'delete_mock_draft'),
  'delete_mock_draft is SECURITY DEFINER with the exact spec-form search_path');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mock_draft_expire'),
  'mock_draft_expire is SECURITY DEFINER with the exact spec-form search_path');
select ok(
  not has_function_privilege('anon', 'public.create_mock_draft(uuid,uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.create_mock_draft(uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.delete_mock_draft(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.delete_mock_draft(uuid)', 'EXECUTE'),
  'create/delete_mock_draft: anon revoked, authenticated keeps EXECUTE (in-body auth is the gate)');
select ok(
  not has_function_privilege('anon', 'public.mock_draft_expire()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.mock_draft_expire()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.mock_draft_expire()', 'EXECUTE'),
  'mock_draft_expire: anon AND authenticated revoked, service_role keeps EXECUTE (cron/service — the draft_tick narrowing)');
select ok(
  (select not p.prosecdef
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_resolve_order_internal')
  and not has_function_privilege('anon',
    'public.draft_resolve_order_internal(uuid,integer,text,jsonb,jsonb,uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated',
    'public.draft_resolve_order_internal(uuid,integer,text,jsonb,jsonb,uuid,text)', 'EXECUTE'),
  'draft_resolve_order_internal is plain (non-SECURITY-DEFINER) with the 062-form triple REVOKE');
select ok(
  (select count(*) = 2 and bool_and(p.provolatile = 'i') and bool_and(not p.prosecdef)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('draft_mock_think_fraction', 'draft_mock_cpu_due')),
  'draft_mock_think_fraction + draft_mock_cpu_due are IMMUTABLE pure helpers (no data access; the draft_team_for_pick breadth precedent)');
select is(
  (select schedule || '|' || command from cron.job where jobname = 'mock-expiry'),
  '0 3 * * *|SELECT public.mock_draft_expire()',
  'ONE cron entry: mock-expiry daily at 03:00 calling public.mock_draft_expire() (§8.8 "daily cleanup cron")');

-- D93 determinism: stored-literal think fractions (same inputs, same
-- fraction, forever) + the 20–70% envelope.
select is(
  public.draft_mock_think_fraction('e7000000-0000-4000-8000-0000000000a1', 1),
  0.242865,
  'think fraction (fixed draft, pick 1) = 0.242865 — stored literal (D93 determinism)');
select is(
  public.draft_mock_think_fraction('e7000000-0000-4000-8000-0000000000a1', 2),
  0.339449,
  'think fraction (fixed draft, pick 2) = 0.339449 — stored literal (distinct per pick)');
select is(
  public.draft_mock_think_fraction('e7000000-0000-4000-8000-0000000000a1', 5),
  0.402973,
  'think fraction (fixed draft, pick 5) = 0.402973 — stored literal');
select ok(
  (select bool_and(f >= 0.20 and f < 0.70)
   from (select public.draft_mock_think_fraction(
           'e7000000-0000-4000-8000-0000000000a1', n) f
         from generate_series(1, 200) n) s),
  '200-pick sweep: every think fraction lies in [0.20, 0.70) — the §8.8 20–70%-of-clock envelope');
select is(
  public.draft_mock_cpu_due('e7000000-0000-4000-8000-0000000000a1',
    '{"pick_timer_seconds": 90, "mock": {"cpu_speed": "realistic"}}'::jsonb,
    '2026-09-01T17:01:30Z'::timestamptz, '2026-09-01T16:00:00Z'::timestamptz, 1),
  '2026-09-01 17:00:21.85785+00'::timestamptz,
  'cpu_due realistic = pick start + 0.242865 × 90s (stored literal)');
select is(
  public.draft_mock_cpu_due('e7000000-0000-4000-8000-0000000000a1',
    '{"pick_timer_seconds": 90, "mock": {"cpu_speed": "fast"}}'::jsonb,
    '2026-09-01T17:01:30Z'::timestamptz, '2026-09-01T16:00:00Z'::timestamptz, 1),
  '2026-09-01 17:00:02+00'::timestamptz,
  'cpu_due fast = pick start + 2s (§8.8 speed toggle — CPU think-time only)');
select is(
  public.draft_mock_cpu_due('e7000000-0000-4000-8000-0000000000a1',
    '{"pick_timer_seconds": 0, "mock": {"cpu_speed": "realistic"}}'::jsonb,
    null, '2026-09-01T16:00:00Z'::timestamptz, 1),
  '2026-09-01 16:00:02+00'::timestamptz,
  'cpu_due untimed = updated_at (the advance instant) + 2s — no clock to take a fraction of (recorded)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — BEFORE any JWT claims; D49(7)).
--    Users u01..u12 + outsider u99. Worlds:
--      LA b7…a1  capacity (7 of 8 seats → refusal; seat 8 added mid-test)
--      LB b7…b1  the D103(2)/(3) world (real draft d1 with stored order
--                [T2,T1,T3..T8]; u03 launches, human seat = u02's T2)
--      LZ b7…c1  zero-side-effect scripted world (real draft d2, order
--                T1..T8; u01 launches on their own seat by default)
--      LC b7…e1  caps world (u09 active-cap; u10 hourly; u11 seatless)
--      LD b7…f1  'drafting' league (status refusal; snapshot set so the
--                D43 guard admits the fixture)
--      LE b7…f2  auction-configured league (M3 refusal)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('94000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated',
  'pgtap-mk' || lpad(i::text, 2, '0') || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  jsonb_build_object('username', 'mk_user_' || lpad(i::text, 2, '0')),
  now(), now()
from generate_series(1, 12) i;
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000099',
   'authenticated', 'authenticated', 'pgtap-mk99@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "mk_outsider_99"}',
   now(), now());

-- Pool: the 20 best ADPs are ALL QBs (the shared-strategy discriminator —
-- raw ADP drafts QBs only); RBs sit at 101+.
insert into players (id, full_name, position, adp)
select 'mk-qb' || lpad(i::text, 2, '0'), 'MK QB ' || lpad(i::text, 2, '0'), 'QB', i
from generate_series(1, 20) i;
insert into players (id, full_name, position, adp)
select 'mk-rb' || lpad(i::text, 2, '0'), 'MK RB ' || lpad(i::text, 2, '0'), 'RB', 100 + i
from generate_series(1, 12) i;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings) values
  ('b7000000-0000-4000-8000-0000000000a1', '94000000-0000-4000-8000-000000000001',
   'pgtap-mk-LA-capacity', 2026, 'setup', 8, null, '{}'),
  ('b7000000-0000-4000-8000-0000000000b1', '94000000-0000-4000-8000-000000000001',
   'pgtap-mk-LB-d103', 2026, 'setup', 8, null,
   '{"draft": {"draft_type": "snake", "snake_reversal": false, "draft_order_mode": "random",
     "pick_timer_seconds": 90, "disconnect_grace_seconds": 30}}'),
  ('b7000000-0000-4000-8000-0000000000c1', '94000000-0000-4000-8000-000000000001',
   'pgtap-mk-LZ-diff', 2026, 'setup', 8, null,
   '{"draft": {"draft_type": "snake", "snake_reversal": false, "draft_order_mode": "random",
     "pick_timer_seconds": 90, "disconnect_grace_seconds": 30}}'),
  ('b7000000-0000-4000-8000-0000000000e1', '94000000-0000-4000-8000-000000000005',
   'pgtap-mk-LC-caps', 2026, 'setup', 8, null, '{}'),
  ('b7000000-0000-4000-8000-0000000000f1', '94000000-0000-4000-8000-000000000001',
   'pgtap-mk-LD-drafting', 2026, 'setup', 8, null, '{}'),
  ('b7000000-0000-4000-8000-0000000000f2', '94000000-0000-4000-8000-000000000001',
   'pgtap-mk-LE-auction', 2026, 'setup', 8, null,
   '{"draft": {"draft_type": "auction"}}');
-- LD → 'drafting' with its snapshot in the SAME statement (the D43 guard
-- checks the NEW row on INSERT and UPDATE alike — a born-in-drafting
-- insert or a two-step flip refuses).
update leagues
set status = 'drafting',
    scoring_rules_snapshot = '{"rules": {}, "fixture": "mk-LD"}'
where id = 'b7000000-0000-4000-8000-0000000000f1';
-- LB + LZ rosters: {QB:1, RB:1, bench:1} → 3 rounds (D91).
update leagues
set roster_settings = '{"starting_slots": [
      {"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1},
      {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
    "bench": 1, "ir_slots": [], "swap_spots": 0}'
where id in ('b7000000-0000-4000-8000-0000000000b1',
             'b7000000-0000-4000-8000-0000000000c1');

-- Teams. LA t01..t07 (u01..u07 — one short); LB + LZ t01..t08 (u01..u08);
-- LC t01..t08 (u05..u10, u12, u04 — u11 is deliberately SEATLESS).
insert into teams (id, owner_id, name, league_id)
select ('c7000000-0000-4000-8000-00a1000000' || lpad(i::text, 2, '0'))::uuid,
       ('94000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'pgtap-mk-a1-t' || lpad(i::text, 2, '0'),
       'b7000000-0000-4000-8000-0000000000a1'
from generate_series(1, 7) i;
insert into teams (id, owner_id, name, league_id)
select ('c7000000-0000-4000-8000-00b1000000' || lpad(i::text, 2, '0'))::uuid,
       ('94000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'pgtap-mk-b1-t' || lpad(i::text, 2, '0'),
       'b7000000-0000-4000-8000-0000000000b1'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c7000000-0000-4000-8000-00c1000000' || lpad(i::text, 2, '0'))::uuid,
       ('94000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'pgtap-mk-c1-t' || lpad(i::text, 2, '0'),
       'b7000000-0000-4000-8000-0000000000c1'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c7000000-0000-4000-8000-00e1000000' || lpad(i::text, 2, '0'))::uuid,
       (case i
          when 1 then '94000000-0000-4000-8000-000000000005'
          when 2 then '94000000-0000-4000-8000-000000000006'
          when 3 then '94000000-0000-4000-8000-000000000007'
          when 4 then '94000000-0000-4000-8000-000000000008'
          when 5 then '94000000-0000-4000-8000-000000000009'
          when 6 then '94000000-0000-4000-8000-000000000010'
          when 7 then '94000000-0000-4000-8000-000000000012'
          when 8 then '94000000-0000-4000-8000-000000000004'
        end)::uuid,
       'pgtap-mk-e1-t' || lpad(i::text, 2, '0'),
       'b7000000-0000-4000-8000-0000000000e1'
from generate_series(1, 8) i;

-- Members.
insert into league_members (league_id, user_id, team_id, role)
select 'b7000000-0000-4000-8000-0000000000a1',
       ('94000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c7000000-0000-4000-8000-00a1000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 7) i;
insert into league_members (league_id, user_id, team_id, role)
select 'b7000000-0000-4000-8000-0000000000b1',
       ('94000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c7000000-0000-4000-8000-00b1000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 8) i;
insert into league_members (league_id, user_id, team_id, role)
select 'b7000000-0000-4000-8000-0000000000c1',
       ('94000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c7000000-0000-4000-8000-00c1000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 8) i;
insert into league_members (league_id, user_id, team_id, role)
select 'b7000000-0000-4000-8000-0000000000e1',
       t.owner_id, t.id,
       case when t.owner_id = '94000000-0000-4000-8000-000000000005'
            then 'commissioner' else 'manager' end
from teams t where t.league_id = 'b7000000-0000-4000-8000-0000000000e1';
-- u11: an LC member with NO franchise (the default-seat refusal fixture).
insert into league_members (league_id, user_id, team_id, role) values
  ('b7000000-0000-4000-8000-0000000000e1', '94000000-0000-4000-8000-000000000011',
   null, 'manager');
-- LD + LE: one member each (status/auction refusals fire before capacity).
insert into league_members (league_id, user_id, team_id, role) values
  ('b7000000-0000-4000-8000-0000000000f1', '94000000-0000-4000-8000-000000000001',
   null, 'commissioner'),
  ('b7000000-0000-4000-8000-0000000000f2', '94000000-0000-4000-8000-000000000001',
   null, 'commissioner');

-- Real scheduled drafts with stored orders (the lobby order the mock must
-- snapshot — D101/§8.8 "order incl. their actual slot"). LB: T2 FIRST
-- (the human seat opens the draft — the D103(2) discriminator); LZ:
-- identity T1..T8 (deterministic board for the diff script).
insert into drafts (id, league_id, draft_type, status, is_mock, config, draft_order) values
  ('e7000000-0000-4000-8000-0000000000d1', 'b7000000-0000-4000-8000-0000000000b1',
   'snake', 'scheduled', false, '{}',
   '["c7000000-0000-4000-8000-00b100000002", "c7000000-0000-4000-8000-00b100000001",
     "c7000000-0000-4000-8000-00b100000003", "c7000000-0000-4000-8000-00b100000004",
     "c7000000-0000-4000-8000-00b100000005", "c7000000-0000-4000-8000-00b100000006",
     "c7000000-0000-4000-8000-00b100000007", "c7000000-0000-4000-8000-00b100000008"]'),
  ('e7000000-0000-4000-8000-0000000000d2', 'b7000000-0000-4000-8000-0000000000c1',
   'snake', 'scheduled', false, '{}',
   '["c7000000-0000-4000-8000-00c100000001", "c7000000-0000-4000-8000-00c100000002",
     "c7000000-0000-4000-8000-00c100000003", "c7000000-0000-4000-8000-00c100000004",
     "c7000000-0000-4000-8000-00c100000005", "c7000000-0000-4000-8000-00c100000006",
     "c7000000-0000-4000-8000-00c100000007", "c7000000-0000-4000-8000-00c100000008"]');

-- u01's primary league board in LB, topped with mk-rb01 (the
-- CPU-never-reads-owner-prep discriminator: T1 is u01's franchise and a
-- CPU seat in u03's mock). Public non-team list (the 018 cap rule).
insert into lists (id, owner_id, title, slug, is_private, is_team, is_big_board) values
  ('d7000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001',
   'mk board u1', 'mk-board-u1', false, false, false);
insert into league_lists (league_id, list_id, owner_id, is_primary_board, shared_with_league) values
  ('b7000000-0000-4000-8000-0000000000b1', 'd7000000-0000-4000-8000-000000000001',
   '94000000-0000-4000-8000-000000000001', true, false);
insert into list_players (list_id, player_id, position) values
  ('d7000000-0000-4000-8000-000000000001', 'mk-rb01', 1);

-- ---------------------------------------------------------------------------
-- C. D103(1) capacity boundary: 7 of 8 seats → refused naming placeholder
--    seats; the 8th seat added → launch succeeds.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000a1') $$,
  'P0001',
  'create_mock_draft: league b7000000-0000-4000-8000-0000000000a1 has 7 of 8 franchises seated — a mock drafts the full board, so every seat must exist; add placeholder seats for the empty slots (League home → Invite) (§8.8/D103)',
  'D103(1): a below-capacity launch is refused, naming placeholder seats as the remedy');
reset role;
insert into teams (id, owner_id, name, league_id) values
  ('c7000000-0000-4000-8000-00a100000008', '94000000-0000-4000-8000-000000000008',
   'pgtap-mk-a1-t08', 'b7000000-0000-4000-8000-0000000000a1');
insert into league_members (league_id, user_id, team_id, role) values
  ('b7000000-0000-4000-8000-0000000000a1', '94000000-0000-4000-8000-000000000008',
   'c7000000-0000-4000-8000-00a100000008', 'manager');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000a1') $$,
  'D103(1): the at-capacity launch succeeds (any member — u06 is an ordinary manager)');
reset role;
select is(
  (select count(*) from drafts
   where league_id = 'b7000000-0000-4000-8000-0000000000a1'
     and is_mock and status = 'live'),
  1::bigint,
  'the LA mock is live immediately (§8.8 — starts at launch, no lobby)');

-- ---------------------------------------------------------------------------
-- D. Launch-shape refusals (status / auction / args / auth)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000f1') $$,
  'P0001',
  'create_mock_draft: league b7000000-0000-4000-8000-0000000000f1 is in drafting — practice drafts run before draft day (setup/scheduled)',
  '§8.8: mocks launch from a PRE-DRAFT league only (drafting refused)');
select throws_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000f2') $$,
  'P0001',
  'create_mock_draft: league b7000000-0000-4000-8000-0000000000f2 is configured for an auction draft — mock auctions land with the auction engine in M3',
  'the M3 seam: a mock of an auction league refuses naming M3 (mock auctions are Phase C''s gate)');
select throws_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000b1', null, 'warp') $$,
  '22023',
  'create_mock_draft: cpu_speed must be realistic or fast',
  'argument shape: an unknown cpu_speed is 22023');
select throws_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000b1',
       'c7000000-0000-4000-8000-00a100000001') $$,
  'P0001',
  'create_mock_draft: team c7000000-0000-4000-8000-00a100000001 is not an active franchise of league b7000000-0000-4000-8000-0000000000b1',
  'seat validation: a foreign league''s team is refused as the human seat');
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000011", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000e1') $$,
  'P0001',
  'create_mock_draft: pick a seat to practice from — you have no franchise in this league',
  'default-seat resolution: a seatless member must name a seat (friendly refusal)');
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000099", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000b1') $$,
  '42501',
  'create_mock_draft: not a member of this league',
  'no-leak: an outsider''s launch is 42501 (same refusal as a nonexistent league)');
reset role;

-- ---------------------------------------------------------------------------
-- E. The D103(2)/(3) world (LB): launcher-keyed authorization, the queue
--    carve-out, CPU behavior, E59, the launcher control surface.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
-- u03 (ordinary manager) launches on u02's franchise T2 (§8.8 "any seat
-- selectable").
select lives_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000b1',
       'c7000000-0000-4000-8000-00b100000002', 'realistic') $$,
  '§8.8: any member launches a mock, choosing any active seat (u03 on u02''s T2)');
reset role;

create temp table mk_lb as
select id from drafts
where league_id = 'b7000000-0000-4000-8000-0000000000b1' and is_mock;
grant select on mk_lb to authenticated;  -- the JWT-context reads below

select is(
  (select d.draft_order from drafts d join mk_lb on mk_lb.id = d.id),
  '["c7000000-0000-4000-8000-00b100000002", "c7000000-0000-4000-8000-00b100000001",
    "c7000000-0000-4000-8000-00b100000003", "c7000000-0000-4000-8000-00b100000004",
    "c7000000-0000-4000-8000-00b100000005", "c7000000-0000-4000-8000-00b100000006",
    "c7000000-0000-4000-8000-00b100000007", "c7000000-0000-4000-8000-00b100000008"]'::jsonb,
  'the mock SNAPSHOTS the real draft row''s stored order verbatim (D101/§8.8 — the order the lobby shows is the order the mock drafts)');
select is(
  (select d.config->'mock' from drafts d join mk_lb on mk_lb.id = d.id),
  jsonb_build_object(
    'human_team_id', 'c7000000-0000-4000-8000-00b100000002',
    'cpu_speed', 'realistic',
    'launched_by', '94000000-0000-4000-8000-000000000003'),
  'config.mock = {human_team_id, cpu_speed, launched_by} — §8.8 + D103(2)''s authorization key (erratum v2.8.16), no schema change');
select ok(
  (select d.status = 'live'
      and d.total_rounds = 3
      and d.current_pick_number = 1
      and d.on_clock_team_id = 'c7000000-0000-4000-8000-00b100000002'
      and d.current_deadline is not null
      and d.started_at is not null
   from drafts d join mk_lb on mk_lb.id = d.id),
  'the mock starts immediately: live, D91 rounds (3), pick 1 on the HUMAN seat (order[1] = T2), a real deadline on the clock');
select is(
  (select count(*) from draft_liveness dl join mk_lb on mk_lb.id = dl.draft_id
   where dl.user_id = '94000000-0000-4000-8000-000000000003'),
  1::bigint,
  'launch seeds the launcher''s draft_liveness beat (the E59 stale clock starts honest before the room mounts)');
select is(
  (select status from drafts where id = 'e7000000-0000-4000-8000-0000000000d1'),
  'scheduled',
  'E60: the league''s REAL scheduled draft is untouched by the mock launch');
select is(
  (select count(*) from drafts where league_id = 'b7000000-0000-4000-8000-0000000000b1'),
  2::bigint,
  'E60: a live mock and the real scheduled draft coexist (one_active_real_draft_per_league ignores mocks — the RPC-path re-pin of 019''s index pin)');

-- D103(2) both sides at the strongest discriminator: T2 (the human seat,
-- on the clock) is u02's OWN franchise — the normal turn check would have
-- passed for them; only the mock branch refuses.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.draft_make_pick('%s', 'mk-qb01', 'a7000000-0000-4000-8000-000000000001') $$,
         (select id from mk_lb)),
  'P0001',
  'draft_make_pick: this mock draft is another member''s solo practice (§8.8/D103)',
  'D103(2): the on-clock seat''s REAL manager (u02, on their own franchise) is refused — nobody drives another member''s practice');
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.draft_make_pick('%s', 'mk-qb01', 'a7000000-0000-4000-8000-000000000002') $$,
         (select id from mk_lb)),
  'P0001',
  'draft_make_pick: this mock draft is another member''s solo practice (§8.8/D103)',
  'D103(2): the commissioner is refused too — no role bypass into a mock');
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000099", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.draft_make_pick('%s', 'mk-qb01', 'a7000000-0000-4000-8000-000000000003') $$,
         (select id from mk_lb)),
  '42501',
  'draft_make_pick: not a member of this draft''s league',
  'no-leak: an outsider''s mock pick is 42501 (the membership floor holds for mocks)');
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select lives_ok(
  format($$ select public.draft_make_pick('%s', 'mk-qb01', 'a7000000-0000-4000-8000-000000000004') $$,
         (select id from mk_lb)),
  'D103(2): the LAUNCHER picks on their chosen seat — a seat they do NOT manage (u03 on u02''s T2)');
reset role;
select ok(
  (select p.pick_number = 1
      and p.team_id = 'c7000000-0000-4000-8000-00b100000002'
      and p.player_id = 'mk-qb01'
      and p.made_via = 'manager'
      and p.picked_by = '94000000-0000-4000-8000-000000000003'
      and p.is_auto = false
   from draft_picks p join mk_lb on mk_lb.id = p.draft_id
   where p.pick_number = 1),
  'the launcher''s pick lands as an ordinary MANAGER pick (made_via manager, picked_by = the launcher, is_auto false)');

-- The human-seat-only half: T1 (a CPU seat) is now on the clock.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.draft_make_pick('%s', 'mk-qb02', 'a7000000-0000-4000-8000-000000000005') $$,
         (select id from mk_lb)),
  'P0001',
  'draft_make_pick: a CPU seat is on the clock — CPU picks land on their own (§8.8)',
  'D103(2): even the launcher cannot pick for a CPU seat — every other seat is tick-only');

-- D103(3): the launcher (who does NOT own T2 — the owner arm can never
-- admit them) writes the human seat's queue through the carve-out alone.
select results_eq(
  format($$ with w as (
       insert into draft_queues (draft_id, team_id, player_id, rank)
       values ('%s', 'c7000000-0000-4000-8000-00b100000002', 'mk-rb05', 1),
              ('%s', 'c7000000-0000-4000-8000-00b100000002', 'mk-rb06', 2)
       returning 1)
     select count(*)::bigint from w $$,
     (select id from mk_lb), (select id from mk_lb)),
  $$ values (2::bigint) $$,
  'D103(3): the launcher INSERTs the human seat''s queue — the mock carve-out is the only admitting arm (u03 does not own T2; RETURNING-count 2)');
-- The negative uses T4 (u04's franchise) — NOT T3, which u03 happens to
-- OWN (the printed owner arm legitimately admits an owner's queue writes
-- against any draft_id, the recorded R120 class; the carve-out's bound is
-- only visible on a seat the launcher neither owns nor practices).
select throws_ok(
  format($$ insert into draft_queues (draft_id, team_id, player_id, rank)
            values ('%s', 'c7000000-0000-4000-8000-00b100000004', 'mk-rb07', 1) $$,
         (select id from mk_lb)),
  '42501',
  'new row violates row-level security policy for table "draft_queues"',
  'D103(3) bound: the carve-out covers ONLY the human seat — the launcher cannot write an unowned CPU seat''s queue');
select is(
  (select count(*) from draft_queues q join mk_lb on mk_lb.id = q.draft_id),
  2::bigint,
  'D103(3): the launcher READS the human seat''s queue rows back (the carve-out''s SELECT arm)');
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select is(
  (select count(*) from draft_queues q join mk_lb on mk_lb.id = q.draft_id),
  0::bigint,
  'a fellow member (u05 — not launcher, not T2''s owner) sees ZERO mock queue rows');
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  (select count(*) from draft_queues q join mk_lb on mk_lb.id = q.draft_id),
  2::bigint,
  'the seat''s REAL owner (u02) also reads them via the printed owner arm — the recorded R120-class overlap (advisory rows; the autopick reads launcher-keyed)');
reset role;

-- CPU think-time: at the frozen now the CPU''s think has NOT elapsed
-- (due ≥ pick start + 20% of 90s) — a tick leaves the mock untouched.
select ok(
  (select (public.draft_tick()->>'mock_cpu_picked')::int >= 0),
  'tick invoked (think-time not yet elapsed for the LB mock — count owned by other worlds is legal)');
select is(
  (select d.current_pick_number from drafts d join mk_lb on mk_lb.id = d.id),
  2,
  'a CPU pick never lands before its think-time: the LB mock is still on pick 2 after a tick at launch instant');

-- Rewind the deadline 89s (deadline stays 1s in the FUTURE → the timeout
-- arm skips; the think-due is past → ARM 2.5 picks): the CPU pick flows
-- through the SHARED BRAIN.
update drafts set current_deadline = current_deadline - interval '89 seconds'
where id = (select id from mk_lb);
select ok(
  (select (public.draft_tick()->>'mock_cpu_picked')::int >= 1),
  'ARM 2.5 claims the due mock and the summary records the CPU pick');
select ok(
  (select p.team_id = 'c7000000-0000-4000-8000-00b100000001'
      and p.player_id = 'mk-qb02'
      and p.is_auto = true
      and p.made_via = 'autopick'
      and p.picked_by is null
      and p.action_id is null
   from draft_picks p join mk_lb on mk_lb.id = p.draft_id
   where p.pick_number = 2),
  'the CPU pick is the §12.4 system shape via the SHARED autopick brain: T1 takes mk-qb02 (ADP + need) — NOT mk-rb01, the top of its real owner''s primary board (D93: a CPU seat never reads the seat owner''s prep)');

-- Drive picks 3..15 (all CPU) to bring the HUMAN seat back on the clock
-- at pick 16 (snake round 2 ends where it started — T2).
create function pg_temp.mk_drive_cpu(p_draft_id uuid, p_max int) returns void
language plpgsql as $fn$
declare
  v_d public.drafts;
  v_human text;
  i int := 0;
begin
  loop
    i := i + 1;
    select * into v_d from public.drafts where id = p_draft_id;
    v_human := v_d.config->'mock'->>'human_team_id';
    exit when v_d.status <> 'live'
           or v_d.on_clock_team_id::text = v_human
           or i > p_max;
    update public.drafts set current_deadline = current_deadline - interval '89 seconds'
    where id = p_draft_id and status = 'live';
    perform public.draft_tick();
  end loop;
end;
$fn$;
select pg_temp.mk_drive_cpu((select id from mk_lb), 20);
select ok(
  (select d.current_pick_number = 16
      and d.on_clock_team_id = 'c7000000-0000-4000-8000-00b100000002'
   from drafts d join mk_lb on mk_lb.id = d.id),
  'the CPU seats drafted picks 3–15 one think-time apiece; the human seat is back on the clock at pick 16 (snake round 2 closes on T2)');

-- Timer fidelity (§8.5.4/§8.8 "the human''s clock always runs real"): the
-- human times out FRESH (a beat inside (deadline−45s, deadline]) → the
-- autopick lands AT the deadline and honors the LAUNCHER''s queue.
update drafts set current_deadline = now() - interval '1 second'
where id = (select id from mk_lb);
update draft_liveness set last_seen_at = now() - interval '6 seconds'
where draft_id = (select id from mk_lb)
  and user_id = '94000000-0000-4000-8000-000000000003';
select ok(
  (select (public.draft_tick()->>'autopicked')::int >= 1),
  'the fresh human seat''s expired deadline autopicks through ARM 2 (timer fidelity — a mock that never punishes a blown clock is not practice)');
select ok(
  (select p.player_id = 'mk-rb05' and p.is_auto = true and p.made_via = 'autopick'
   from draft_picks p join mk_lb on mk_lb.id = p.draft_id
   where p.pick_number = 16),
  'the human seat''s autopick honors the LAUNCHER''s queue top (mk-rb05) — sources resolve under launched_by, not the seat owner (D93/D103)');

-- Human never CPU-picked while fresh: pick 17 = T2 again (round 3 opens
-- on T2), fresh beat, future deadline → a tick changes nothing.
select ok(
  (select (public.draft_tick()) is not null),
  'tick invoked against the fresh human seat (pick 17, future deadline)');
select ok(
  (select d.status = 'live' and d.current_pick_number = 17
   from drafts d join mk_lb on mk_lb.id = d.id),
  'the human seat is NEVER CPU-picked while its heartbeat is fresh: on the clock, mid-timer — the tick leaves the mock untouched');

-- E59 boundary: threshold = grace(30) + one tick(5) = 35s of launcher
-- staleness. 34s → still live; 36s → auto-paused.
update draft_liveness set last_seen_at = now() - interval '34 seconds'
where draft_id = (select id from mk_lb)
  and user_id = '94000000-0000-4000-8000-000000000003';
select ok(
  (select (public.draft_tick()) is not null),
  'tick at 34s launcher staleness (one below the 35s threshold)');
select is(
  (select d.status from drafts d join mk_lb on mk_lb.id = d.id),
  'live',
  'E59 boundary: 34s stale (< grace + one tick) — the mock stays live');
update draft_liveness set last_seen_at = now() - interval '36 seconds'
where draft_id = (select id from mk_lb)
  and user_id = '94000000-0000-4000-8000-000000000003';
select ok(
  (select (public.draft_tick()->>'mock_paused')::int >= 1),
  'E59: 36s stale (> grace + one tick) — the tick auto-pauses the mock');
select ok(
  (select d.status = 'paused'
      and d.deadline_remaining_ms is not null
      and d.current_deadline is null
   from drafts d join mk_lb on mk_lb.id = d.id),
  'the auto-pause rides the ONE pause bookkeeping (069): remaining persisted, deadline NULLed — the human''s clock survives the disconnect');
select is(
  (select c.user_id is null::text || '|' || c.is_system::text || '|' || c.message
   from league_chat c join mk_lb on mk_lb.id::text = split_part(c.context, ':', 2)
   where c.context like 'draft:%'
   limit 1),
  'true|true|Mock draft auto-paused — you left the room. Resume your practice from the league page.',
  'the E59 pause posts an ACTORLESS system message into the mock''s own chat context (zero league-room noise)');

-- Resume is the LAUNCHER''s (069 mock arm): members and commissioners
-- refused; the launcher resumes; manual pause is the launcher''s too.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.draft_resume('%s') $$, (select id from mk_lb)),
  'P0001',
  'draft_resume: only the member practicing this mock can resume it (§8.8/D103)',
  'a fellow member cannot resume someone''s mock');
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.draft_resume('%s') $$, (select id from mk_lb)),
  'P0001',
  'draft_resume: only the member practicing this mock can resume it (§8.8/D103)',
  'the commissioner cannot resume someone''s mock either (D103(2) — no role bypass)');
select throws_ok(
  format($$ select public.draft_pause('%s') $$, (select id from mk_lb)),
  'P0001',
  'draft_pause: only the member practicing this mock can pause it (§8.8/D103)',
  'the commissioner cannot pause someone''s mock (launcher-only surface)');
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select lives_ok(
  format($$ select public.draft_resume('%s') $$, (select id from mk_lb)),
  'the LAUNCHER resumes their auto-paused mock (E59 "resumable from the league page")');
select ok(
  (select d.status = 'live' and d.current_deadline is not null
      and d.deadline_remaining_ms is null
   from drafts d join mk_lb on mk_lb.id = d.id),
  'resume restores the clock from the persisted remaining (the ONE §8.7 v2.0 bookkeeping — same engine, literally)');
select lives_ok(
  format($$ select public.draft_pause('%s') $$, (select id from mk_lb)),
  'the LAUNCHER pauses manually (§8.8 "pause/leave anytime")');
reset role;
select is(
  (select d.status from drafts d join mk_lb on mk_lb.id = d.id),
  'paused',
  'the manual pause holds (and parks the LB mock out of later ticks'' way)');

-- §8.7 controls refuse mocks (the launcher surface is pause/resume/
-- delete; draft_reset on a mock was the live-proven league write).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.draft_reset('%s') $$, (select id from mk_lb)),
  'P0001',
  'draft_reset: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'draft_reset refuses mocks — the zero-side-effect breach (league status + schedule write) is closed');
select throws_ok(
  format($$ select public.draft_undo('%s') $$, (select id from mk_lb)),
  'P0001',
  'draft_undo: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'draft_undo refuses mocks');
select throws_ok(
  format($$ select public.draft_force_pick('%s', 'mk-qb18') $$, (select id from mk_lb)),
  'P0001',
  'draft_force_pick: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'draft_force_pick refuses mocks (no commissioner completes someone''s practice)');
select throws_ok(
  format($$ select public.draft_set_clock('%s', 60) $$, (select id from mk_lb)),
  'P0001',
  'draft_set_clock: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'draft_set_clock refuses mocks');
select throws_ok(
  format($$ select public.draft_reassign_pick('%s', 'a7000000-0000-4000-8000-000000000099',
       'c7000000-0000-4000-8000-00b100000003') $$,
         (select id from mk_lb)),
  'P0001',
  'draft_reassign_pick: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'draft_reassign_pick refuses mocks (a well-formed request — the arg-shape check precedes the guard)');
select throws_ok(
  format($$ select public.draft_move_player('%s', 'mk-qb01',
       'c7000000-0000-4000-8000-00b100000002', 'c7000000-0000-4000-8000-00b100000001') $$,
         (select id from mk_lb)),
  'P0001',
  'draft_move_player: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'draft_move_player refuses mocks');
select throws_ok(
  format($$ select public.draft_set_order('%s', array[
       'c7000000-0000-4000-8000-00b100000001', 'c7000000-0000-4000-8000-00b100000002',
       'c7000000-0000-4000-8000-00b100000003', 'c7000000-0000-4000-8000-00b100000004',
       'c7000000-0000-4000-8000-00b100000005', 'c7000000-0000-4000-8000-00b100000006',
       'c7000000-0000-4000-8000-00b100000007', 'c7000000-0000-4000-8000-00b100000008']::uuid[]) $$,
         (select id from mk_lb)),
  'P0001',
  'draft_set_order: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'draft_set_order refuses mocks');
reset role;
select is(
  (select status from leagues where id = 'b7000000-0000-4000-8000-0000000000b1'),
  'setup',
  'after every refused control the LEAGUE is untouched (the reset breach stays closed)');

-- ---------------------------------------------------------------------------
-- F. The zero-side-effect diff (§8.8''s contract, pinned): scripted mock
--    launch → completion in LZ; league-scoped state identical outside the
--    exempt tables.
-- ---------------------------------------------------------------------------
create temp table mk_before as
select
  (select to_jsonb(l) from leagues l where l.id = 'b7000000-0000-4000-8000-0000000000c1') as league_row,
  (select count(*) from league_members where league_id = 'b7000000-0000-4000-8000-0000000000c1') as members,
  (select count(*) from teams where league_id = 'b7000000-0000-4000-8000-0000000000c1') as teams,
  (select count(*) from team_managers tm join teams t on t.id = tm.team_id
    where t.league_id = 'b7000000-0000-4000-8000-0000000000c1') as stints,
  (select count(*) from league_invites where league_id = 'b7000000-0000-4000-8000-0000000000c1') as invites,
  (select count(*) from league_weeks where league_id = 'b7000000-0000-4000-8000-0000000000c1') as weeks,
  (select count(*) from league_lists where league_id = 'b7000000-0000-4000-8000-0000000000c1') as llists,
  (select count(*) from notifications where user_id in
    (select user_id from league_members
     where league_id = 'b7000000-0000-4000-8000-0000000000c1')) as notifs,
  (select count(*) from league_chat
    where league_id = 'b7000000-0000-4000-8000-0000000000c1'
      and context = 'league') as league_chat_rows,
  (select count(*) from draft_picks
    where league_id = 'b7000000-0000-4000-8000-0000000000c1') as picks;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000c1') $$,
  'LZ: u01 launches with the DEFAULT seat (their own franchise)');
reset role;

create temp table mk_lz as
select id from drafts
where league_id = 'b7000000-0000-4000-8000-0000000000c1' and is_mock;
grant select on mk_lz to authenticated;  -- the JWT-context reads below

select is(
  (select d.config->'mock'->>'human_team_id' from drafts d join mk_lz on mk_lz.id = d.id),
  'c7000000-0000-4000-8000-00c100000001',
  'the default human seat resolves to the launcher''s own franchise (§8.8 "their real seat by default")');

-- Script to completion through the REAL tick: CPU picks via think-time
-- (deadline − 89s keeps the deadline 1s in the future → ARM 2.5), the
-- human via the expired stale hold (deadline − 120s > grace → ARM 2).
create function pg_temp.mk_drive_all(p_draft_id uuid, p_max int) returns int
language plpgsql as $fn$
declare
  v_d public.drafts;
  v_human text;
  i int := 0;
begin
  loop
    i := i + 1;
    select * into v_d from public.drafts where id = p_draft_id;
    exit when v_d.status = 'complete' or i > p_max;
    v_human := v_d.config->'mock'->>'human_team_id';
    if v_d.on_clock_team_id::text = v_human then
      update public.drafts set current_deadline = current_deadline - interval '120 seconds'
      where id = p_draft_id and status = 'live';
    else
      update public.drafts set current_deadline = current_deadline - interval '89 seconds'
      where id = p_draft_id and status = 'live';
    end if;
    perform public.draft_tick();
  end loop;
  return i;
end;
$fn$;
select ok(
  pg_temp.mk_drive_all((select id from mk_lz), 40) <= 40,
  'the scripted mock drove to completion through the real tick (one pick per pass)');
select ok(
  (select d.status = 'complete' and d.completed_at is not null
      and d.on_clock_team_id is null and d.current_deadline is null
   from drafts d join mk_lz on mk_lz.id = d.id),
  'mock completion: status complete + completed_at — the recap survives (retention until owner-deleted, §8.8)');
select is(
  (select count(*) from draft_picks p join mk_lz on mk_lz.id = p.draft_id
   where p.is_undone = false),
  24::bigint,
  'the full board drafted: 8 teams × 3 rounds = 24 live picks (the diff''s positive control — the mock really ran)');
select is(
  (select count(*) from draft_picks p join mk_lz on mk_lz.id = p.draft_id
   where p.is_undone = false and p.is_auto = false),
  0::bigint,
  'every scripted pick was engine-made (CPU think-time or human timeout) — zero manual picks in the diff run');

-- THE SHARED-STRATEGY BOARD PINS (the DoD break-probe target): raw ADP
-- over this pool drafts QBs only; the shared brain fills every roster.
select is(
  (select count(*) from (
     select p.team_id
     from draft_picks p
     join mk_lz on mk_lz.id = p.draft_id
     join players pl on pl.id = p.player_id
     where p.is_undone = false and pl.position = 'RB'
     group by p.team_id
     having count(*) = 1) s),
  8::bigint,
  'SHARED STRATEGY: every one of the 8 teams drafted EXACTLY one RB (need-fit — a raw-ADP fork drafts zero RBs from this pool)');
select is(
  (select count(*) from (
     select p.team_id
     from draft_picks p
     join mk_lz on mk_lz.id = p.draft_id
     join players pl on pl.id = p.player_id
     where p.is_undone = false and pl.position = 'QB'
     group by p.team_id
     having count(*) = 2) s),
  8::bigint,
  'SHARED STRATEGY: every team holds exactly 2 QBs (the §8.4 S+1 useful cap through the ONE autopick brain)');

-- The diff proper: everything league-scoped outside the exempt tables is
-- byte-identical.
select is(
  (select to_jsonb(l) from leagues l where l.id = 'b7000000-0000-4000-8000-0000000000c1'),
  (select league_row from mk_before),
  'ZERO SIDE EFFECTS: the leagues row is byte-identical (no status transition, no settings write, no updated_at bump)');
select is(
  (select count(*) from league_members where league_id = 'b7000000-0000-4000-8000-0000000000c1'),
  (select members from mk_before),
  'zero side effects: league_members unchanged');
select is(
  (select count(*) from teams where league_id = 'b7000000-0000-4000-8000-0000000000c1'),
  (select teams from mk_before),
  'zero side effects: teams unchanged');
select is(
  (select count(*) from team_managers tm join teams t on t.id = tm.team_id
    where t.league_id = 'b7000000-0000-4000-8000-0000000000c1'),
  (select stints from mk_before),
  'zero side effects: team_managers stints unchanged');
select is(
  (select count(*) from league_invites where league_id = 'b7000000-0000-4000-8000-0000000000c1'),
  (select invites from mk_before),
  'zero side effects: league_invites unchanged');
select is(
  (select count(*) from league_weeks where league_id = 'b7000000-0000-4000-8000-0000000000c1'),
  (select weeks from mk_before),
  'zero side effects: league_weeks unchanged');
select is(
  (select count(*) from pg_tables
   where schemaname = 'public' and tablename = 'league_rosters'),
  0::bigint,
  'zero side effects: league_rosters cannot have been written — the table does not exist until 072/L.B1.7, whose completion arm must keep the mock bypass (re-pinned there from the completion side)');
select is(
  (select count(*) from league_lists where league_id = 'b7000000-0000-4000-8000-0000000000c1'),
  (select llists from mk_before),
  'zero side effects: league_lists unchanged');
select is(
  (select count(*) from notifications where user_id in
    (select user_id from league_members
     where league_id = 'b7000000-0000-4000-8000-0000000000c1')),
  (select notifs from mk_before),
  'zero side effects: NO notifications to any member (§8.8 — nobody hears about someone''s practice)');
select is(
  (select count(*) from league_chat
    where league_id = 'b7000000-0000-4000-8000-0000000000c1'
      and context = 'league'),
  (select league_chat_rows from mk_before),
  'zero side effects: the league''s own chat context is untouched (mock chat lives only under draft:<mock_id>)');
select is(
  (select status from drafts where id = 'e7000000-0000-4000-8000-0000000000d2'),
  'scheduled',
  'E60: the LZ real scheduled draft ran the whole mock beside it, untouched');

-- ---------------------------------------------------------------------------
-- G. §22.5 caps (in-body, per-user, friendly refusals — discriminating
--    sequences: each refusal is reachable only via its own cap)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000009", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000e1'),
            public.create_mock_draft('b7000000-0000-4000-8000-0000000000e1'),
            public.create_mock_draft('b7000000-0000-4000-8000-0000000000e1') $$,
  'u09 launches 3 active mocks (the cap''s inside edge — 3 created in the hour, under the 5-cap)');
select throws_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000e1') $$,
  'P0001',
  'create_mock_draft: you already have 3 active mock drafts — finish or delete one first (§22.5)',
  '§22.5: the 4th ACTIVE mock is refused (only 3 created this hour — the active cap is the one that fired)');
reset role;
update drafts set status = 'complete', completed_at = now()
where id in (
  select id from drafts
  where is_mock and status = 'live'
    and config->'mock'->>'launched_by' = '94000000-0000-4000-8000-000000000009'
  limit 1);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000009", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000e1') $$,
  'a COMPLETED mock frees its active slot (active = live|paused; recaps don''t count) — the 4th create now lands');
-- Hourly cap (u10): 2 create → complete both → 2 more → complete one →
-- 1 more = 5 created / 2 active → the 6th is unreachable except via the
-- hourly cap.
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000e1'),
            public.create_mock_draft('b7000000-0000-4000-8000-0000000000e1') $$,
  'u10 creates 2');
reset role;
update drafts set status = 'complete', completed_at = now()
where is_mock and status = 'live'
  and config->'mock'->>'launched_by' = '94000000-0000-4000-8000-000000000010';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000e1'),
            public.create_mock_draft('b7000000-0000-4000-8000-0000000000e1') $$,
  'u10 creates 2 more (4 in the hour)');
reset role;
update drafts set status = 'complete', completed_at = now()
where is_mock and status = 'live'
  and config->'mock'->>'launched_by' = '94000000-0000-4000-8000-000000000010'
  and id in (
    select id from drafts
    where is_mock and status = 'live'
      and config->'mock'->>'launched_by' = '94000000-0000-4000-8000-000000000010'
    limit 1);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000e1') $$,
  'u10 creates a 5th (2 active — the active cap cannot fire next)');
select throws_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000e1') $$,
  'P0001',
  'create_mock_draft: mock-draft creation is limited to 5 per hour — try again in a bit (§22.5)',
  '§22.5: the 6th creation inside the hour is refused (only 2 active — the HOURLY cap is the one that fired)');
reset role;
-- Boundary: age one creation past the hour → the window holds 4 → OK.
update drafts set created_at = now() - interval '61 minutes'
where is_mock
  and config->'mock'->>'launched_by' = '94000000-0000-4000-8000-000000000010'
  and id in (
    select id from drafts
    where is_mock and status = 'complete'
      and config->'mock'->>'launched_by' = '94000000-0000-4000-8000-000000000010'
    limit 1);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000e1') $$,
  'the hourly window boundary: a creation aged past 60 minutes leaves the window (4 within the hour → the 6th-overall create lands)');
reset role;

-- ---------------------------------------------------------------------------
-- H. delete_mock_draft: launcher-only; children + mock chat cleaned;
--    league chat survives; real drafts protected.
-- ---------------------------------------------------------------------------
create temp table mk_la as
select id from drafts
where league_id = 'b7000000-0000-4000-8000-0000000000a1' and is_mock;
grant select on mk_la to authenticated;  -- the JWT-context reads below
-- Plant residue: mock-context + league-context chat, plus liveness/queue
-- (queue via the launcher, chat privileged — the cleanup must reach all).
insert into league_chat (league_id, user_id, message, context)
select 'b7000000-0000-4000-8000-0000000000a1', '94000000-0000-4000-8000-000000000006',
       'mock room residue', 'draft:' || mk_la.id::text
from mk_la;
insert into league_chat (league_id, user_id, message, context) values
  ('b7000000-0000-4000-8000-0000000000a1', '94000000-0000-4000-8000-000000000006',
   'league room keeper', 'league');
insert into draft_queues (draft_id, team_id, player_id, rank)
select mk_la.id, 'c7000000-0000-4000-8000-00a100000006', 'mk-rb08', 1 from mk_la;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.delete_mock_draft('%s') $$, (select id from mk_la)),
  'P0001',
  'delete_mock_draft: only the member who launched this mock can delete it (§8.8/D103)',
  'a fellow member (u05) cannot delete someone''s mock');
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000099", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.delete_mock_draft('%s') $$, (select id from mk_la)),
  '42501',
  'delete_mock_draft: not a member of this draft''s league',
  'no-leak: an outsider''s delete is 42501');
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.delete_mock_draft('e7000000-0000-4000-8000-0000000000d1') $$,
  'P0001',
  'delete_mock_draft: draft e7000000-0000-4000-8000-0000000000d1 is not a mock draft',
  'a REAL draft can never ride the mock delete path');
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select lives_ok(
  format($$ select public.delete_mock_draft('%s') $$, (select id from mk_la)),
  'the LAUNCHER deletes their mock (abandon + recap-delete are the same path)');
reset role;
select is(
  (select count(*) from drafts d join mk_la on mk_la.id = d.id),
  0::bigint,
  'the mock row is gone');
select is(
  (select count(*)
   from (select p.draft_id from draft_picks p join mk_la on mk_la.id = p.draft_id
         union all
         select q.draft_id from draft_queues q join mk_la on mk_la.id = q.draft_id
         union all
         select dl.draft_id from draft_liveness dl join mk_la on mk_la.id = dl.draft_id) s),
  0::bigint,
  'picks + queues + liveness are gone (ON DELETE CASCADE — the child sweep)');
select is(
  (select count(*) from league_chat c join mk_la on 'draft:' || mk_la.id::text = c.context),
  0::bigint,
  'the mock''s chat context is gone (EXPLICIT delete — the chat FK is to the league, CASCADE can''t reach it)');
select is(
  (select count(*) from league_chat
   where league_id = 'b7000000-0000-4000-8000-0000000000a1'
     and context = 'league' and message = 'league room keeper'),
  1::bigint,
  'the league''s own chat survives the mock delete (the cleanup is surgical)');

-- ---------------------------------------------------------------------------
-- I. The 72h expiry (idle = GREATEST(updated_at, launcher beat) — D110;
--    boundaries pinned; recaps immortal until owner-deleted)
-- ---------------------------------------------------------------------------
create temp table mk_exp as
select id from drafts
where is_mock and status = 'live'
  and config->'mock'->>'launched_by' = '94000000-0000-4000-8000-000000000009'
limit 1;
grant select on mk_exp to authenticated;  -- the JWT-context reads below
create temp table mk_done as
select id from drafts
where is_mock and status = 'complete'
  and config->'mock'->>'launched_by' = '94000000-0000-4000-8000-000000000009'
limit 1;
grant select on mk_done to authenticated;  -- the JWT-context reads below
insert into league_chat (league_id, user_id, message, context)
select 'b7000000-0000-4000-8000-0000000000e1', '94000000-0000-4000-8000-000000000009',
       'expiring mock residue', 'draft:' || mk_exp.id::text
from mk_exp;

-- 71h idle: kept.
update drafts set updated_at = now() - interval '71 hours'
where id = (select id from mk_exp);
update draft_liveness set last_seen_at = now() - interval '71 hours'
where draft_id = (select id from mk_exp);
select ok((select (public.mock_draft_expire()->>'expired')::int >= 0),
  'expiry sweep at 71h idle');
select is(
  (select count(*) from drafts d join mk_exp on mk_exp.id = d.id),
  1::bigint,
  '72h boundary: a mock idle 71h SURVIVES the daily sweep');
-- updated_at 73h, launcher beat 71h: GREATEST keeps it.
update drafts set updated_at = now() - interval '73 hours'
where id = (select id from mk_exp);
select ok((select (public.mock_draft_expire()->>'expired')::int >= 0),
  'expiry sweep with updated_at 73h / beat 71h');
select is(
  (select count(*) from drafts d join mk_exp on mk_exp.id = d.id),
  1::bigint,
  'the IDLE DEFINITION is GREATEST(updated_at, launcher beat): a 71h-old heartbeat keeps a 73h-quiet mock alive (D110 — either signal resets the clock)');
-- Both 73h: deleted with residue.
update draft_liveness set last_seen_at = now() - interval '73 hours'
where draft_id = (select id from mk_exp);
select ok((select (public.mock_draft_expire()->>'expired')::int >= 1),
  'expiry sweep at 73h idle both signals — the mock expires');
select is(
  (select count(*) from drafts d join mk_exp on mk_exp.id = d.id),
  0::bigint,
  'the abandoned mock is deleted at > 72h idle (§8.8/E59)');
select is(
  (select count(*) from league_chat c join mk_exp on 'draft:' || mk_exp.id::text = c.context),
  0::bigint,
  'the expiry sweeps the mock''s chat context too (same cleanup as delete)');
-- A COMPLETE mock never expires.
update drafts set updated_at = now() - interval '100 hours'
where id = (select id from mk_done);
update draft_liveness set last_seen_at = now() - interval '100 hours'
where draft_id = (select id from mk_done);
select ok((select (public.mock_draft_expire()->>'expired')::int >= 0),
  'expiry sweep against a 100h-idle COMPLETE mock');
select is(
  (select count(*) from drafts d join mk_done on mk_done.id = d.id),
  1::bigint,
  '§8.8 recap retention: a COMPLETED mock is kept until the owner deletes it — the expiry only takes incomplete rooms');

select * from finish();
rollback;
