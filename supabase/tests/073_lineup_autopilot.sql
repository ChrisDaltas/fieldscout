-- ============================================================================
-- Lineup autopilot — pgTAP 073 (task L.E1.4; migration 125; spec §7.2.1(c)
-- `spec:185`, §11.3 `spec:733`, §23 `spec:1603`, §11.2, §7.3.6, §12.2;
-- PROGRESS Q56 / Q62 / Q63 / F334; tasks-M6A §3 D337 / D338 / D339 / D340 /
-- D354 and §4 rules 12-15).
--
-- Numbering: pgTAP head measured `072_cron_ping_and_stall_check.sql` by
-- `ls supabase/tests/ | tail -1` at task time ⇒ 073.
--
-- THIS SUITE HAS ITS OWN FIXTURE LEAGUES (`ba…`) AND EXTENDS NEITHER 064's
-- NOR 067's, per the task's own instruction. 064's and 067's goldens are
-- untouched by arm (c) for one asserted reason: L.E1.3 seated EVERY team in
-- both (064 §B1 `teams=18 managed=18`, 067 §C1 `teams=8 managed=8`), so
-- D339's predicate matches nothing there. That premise is theirs; this file
-- builds the unmanaged seats the arm is actually for.
--
-- Falsifiability notes (tasks-M1 §4.3; tasks-M6A §4 rules 14-15):
--   * EVERY INSTANT IS A STORED LITERAL on the 2026 calendar, injected as
--     `p_now`. The lock boundary is a −1s / +1s PAIR on one kickoff
--     (2026-09-25 00:15Z, Thursday): at −1s the KC man is SEATED, at +1s the
--     same fixture SKIPS him by name. Nothing reads a wall clock.
--   * THE PREDICATE IS TESTED, not assumed (cell §D1). T1 is MANAGED and T2
--     is UNMANAGED in the SAME league, the SAME week, off the SAME slate,
--     with the same seven starter-eligible players in the same positions on
--     the same NFL teams with the same `adp`s. If the arm ignored
--     `league_members`, T1 would be seated too and §D1 reds. This is the only
--     assertion in the file that tests the predicate at all.
--   * THE SORT KEY IS POPULATED AND REVERSED AGAINST `player_id` ORDER
--     (§4 rule 14(a) — the `064:235-243` trap, where every `adp` is NULL and
--     an `ORDER BY adp NULLS LAST, player_id` collapses to pure id order).
--     `ap-qb-a` sorts BEFORE `ap-qb-hi` by id and AFTER him by `adp`, so the
--     two disagree and only `adp` gives the right answer. The trap is set on
--     BOTH fallbacks a removed ORDER BY could land in: `ap-qb-a` is inserted
--     FIRST into `players` AND FIRST into `league_rosters`, so whichever side
--     the planner drives the join from, an unordered aggregate seats the WRONG
--     man. PR break probe 2 deletes the ORDER BY (measured: §D2 reds) and
--     probe 2b replaces it with `ORDER BY r.player_id` — the `064:235-243`
--     collapse in its exact deterministic form — which reds §D2 too.
--   * BIPARTITE PLACEMENT IS DISTINGUISHABLE FROM FIRST-FIT (§D3). That needs
--     a GENERAL slot ahead of a SPECIFIC one in canonical order, so these
--     leagues list `flex ×2` BEFORE `te` — said out loud because it is the
--     whole point of the shape: a first-fit clone lets the TE grab `flex:0`
--     and then strands the second RB, leaving `te:0` EMPTY, while the matcher
--     re-routes along an augmenting path and fills all four. PR break probe 1
--     replaces the `lineup_fit_internal` call with "first free eligible slot,
--     else unplaced" and §D3 reds.
--   * IDEMPOTENCE IS GENUINELY REACHABLE (§E). Arm (c)'s own driving query
--     re-visits every unmanaged seat unconditionally every minute — nothing
--     about a filled seat removes it from (c)'s FROM — so the second pass
--     really does execute the guard, and it reports WHY it wrote nothing.
--   * THE UNSAFE FAILURE DIRECTION IS ASSERTED (§D8, D339): a team with NO
--     `league_members` row at all is a NAMED, REPORTED state, never seized.
--   * NO CELL INFERS EMPTINESS (§4 rule 15): every "nothing happened" cell
--     asserts the REASON string beside it.
--   * EVERY `autopilot_reason` VALUE THE MIGRATION CAN EMIT HAS A CELL
--     (added in the #295 fix round — R1000 found two enumerated and asserted
--     by nothing): `disabled_by_system_flag:autopilot_disabled` §F1b ·
--     `no_unmanaged_seats_in_a_live_current_week` §I3b · `nothing_fillable`
--     §E1b/§H1b · `every_candidate_locked` §J2 ·
--     `every_unmanaged_looking_seat_declined_no_league_members_row` §K2/§K4 ·
--     `no_row_and_no_materialize` §L2 · NULL (work happened) §D10/§F2b.
--   * ONE CELL USES FAULT INJECTION AND SAYS SO (§L). `no_row_and_no_materialize`
--     is a contract check on `lineup_carry_internal`, unreachable while that
--     contract (INSERT-or-RAISE, `116:541-551`) holds — so rather than assert a
--     guard that cannot execute (§4 rule 14(b)), §L replaces the carry with a
--     non-inserting stub INSIDE THIS TRANSACTION, after §A10/§A11 have pinned
--     the real one, and the file's `rollback` restores it.
--   * §J IS ALSO THE ONLY CELL THAT RUNS THE PASS OVER A MAP CONTAINING A
--     HEALTHY SEATED STARTER, and adding it FOUND A DEFECT (see 125's note at
--     the classification loop): `lineup_designation_internal` returns NULL for a
--     healthy player, `NULL IN (…)` is NULL, and the unguarded
--     `IF v_locked OR NOT v_unhealthy` therefore DISPLACED every healthy
--     starter — re-contesting a manager-set placement on value (D340) and, via
--     the restore clause, writing one player into two slots. §J3/§J4 red on the
--     unguarded form (measured: `flex:1` and `te:0` both held `ap-lk-te`).
--   * THE KILL SWITCH'S GRANTS ARE MEASURED PER ROLE, NOT VIA `pg_policies`
--     (§F1e, R998): RLS does not cover TRUNCATE, so a policy-only assertion
--     cannot see the grant that let any signed-in user wipe the switch.
--   * All work runs as postgres (`auth.uid()` NULL — the job's own
--     precondition); the JWT-refusal cell sets a claim and resets it
--     (`set_config(..., true)` persists to txn end — D49(7)).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(103);

-- ---------------------------------------------------------------------------
-- A. Form pins — the new function's posture, the tick's unchanged posture,
--    the three functions 125 must NOT have touched (the `064:72-100` shape)
-- ---------------------------------------------------------------------------
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_autopilot_internal'),
  'p_league_id uuid, p_team_id uuid, p_season integer, p_week integer, p_at timestamp with time zone',
  'A1 lineup_autopilot_internal(league, team, season, week, at) — §5''s signature, with the instant INJECTED (the TimeProvider seam)');
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_autopilot_internal'),
  'A2 lineup_autopilot_internal is PLAIN (not DEFINER) with search_path='''' — lineup_carry_internal''s posture verbatim (116:369-383)');
select ok(
  not has_function_privilege('anon', 'public.lineup_autopilot_internal(uuid,uuid,integer,integer,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.lineup_autopilot_internal(uuid,uuid,integer,integer,timestamptz)', 'EXECUTE')
  and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and p.proname = 'lineup_autopilot_internal'
      and a.privilege_type = 'EXECUTE' and a.grantee = 0),
  'A3 the TRIPLE REVOKE: no EXECUTE for anon, for authenticated, or for PUBLIC (grantee 0) — a fresh CREATE grants PUBLIC by default, so this is load-bearing');
select ok(
  has_function_privilege('service_role', 'public.lineup_autopilot_internal(uuid,uuid,integer,integer,timestamptz)', 'EXECUTE'),
  'A4 …and the service role keeps it — postgres/service_role is the only door, through the DEFINER tick');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_autopilot_internal'),
  1, 'A5 exactly ONE overload of lineup_autopilot_internal');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_lock_tick'),
  'A6 lineup_lock_tick is STILL SECURITY DEFINER with search_path='''' after the CREATE OR REPLACE (119''s posture, unchanged)');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_lock_tick'),
  'p_now timestamp with time zone DEFAULT now(), p_league_id uuid DEFAULT NULL::uuid',
  'A7 …and its signature is byte-identical — the cron row (`SELECT public.lineup_lock_tick()`) still resolves');
select ok(
  not has_function_privilege('anon', 'public.lineup_lock_tick(timestamptz,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.lineup_lock_tick(timestamptz,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.lineup_lock_tick(timestamptz,uuid)', 'EXECUTE'),
  'A8 the tick''s grants survive the REPLACE — still REVOKEd from anon/authenticated, still service_role (a REPLACE keeps the ACL, but a future DROP+CREATE would not)');
select ok(
  (select p.prosrc like '%lineup_autopilot_internal%' and p.prosrc like '%autopilot_disabled%'
     and p.prosrc like '%lineup_carry_internal%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_lock_tick'),
  'A9 the tick''s body names the chooser, the kill-switch key and the carry it CALLS (D354) — arm (c) is wired, not merely declared');

-- §4 rule 13 / D337: 125 changes NOTHING about the carry, the week advance or
-- the carry's one live call site. Pinned by exhaustion the `071:835-867` way.
select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_carry_internal'),
  'A10 lineup_carry_internal is untouched by 125 — still PLAIN with search_path='''' (D337: the carry keeps doing "last valid" at week open)');
select ok(
  (select p.prosrc like '%a collision is a bug and must be loud (23505)%'
     and p.prosrc not like '%DO NOTHING%' and p.prosrc not like '%DO UPDATE%'
     and p.prosrc not like '%autopilot%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_carry_internal'),
  'A11 …and its INSERT still has NO ON CONFLICT and its body names no autopilot — arm (c) CALLS it, which is not CHANGING it (L.E1.4 item 5)');
select ok(
  (select p.prosrc not like '%autopilot%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'league_week_advance'),
  'A12 league_week_advance names no autopilot either — the superseded draft hooked all three of these and 125 hooks none (D337)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('lineup_carry_internal', 'league_week_advance', 'lineup_lock_tick', 'lineup_fit_internal')),
  4, 'A13 still exactly one overload each of the carry, the advance, the tick and the matcher (no accidental second signature)');

-- The job's in-body auth is untouched by the REPLACE.
select set_config('request.jwt.claims', '{"sub": "9a000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok($$ select public.lineup_lock_tick('2026-09-25 00:15:01+00') $$, '42501', null,
  'A14 lineup_lock_tick still refuses a JWT-bearing caller in-body (42501) — a job, not a user verb');
select set_config('request.jwt.claims', '', true);
select ok(auth.uid() is null, 'A15 the claim is reset — the rest of the suite runs as the job (auth.uid() NULL)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context)
--    Calendar (2026, stored literals): week 3 starts 2026-09-23 04:00Z, last
--    game ends 09-29 04:00Z, window closes 10-01 10:00Z; week 4 starts 09-30
--    (after every instant below, so `lineup_current_week_internal` returns 3
--    throughout). Games: KC@BUF Thu 09-25 00:15Z · DAL@PHI Sun 09-27 17:00Z ·
--    NYG@SF Mon 09-29 00:15Z. LAC has NO game row ⇒ BYE.
--
--    AL1 `ba…0001` — the main league, h2h, allow_illegal_lineups TRUE.
--      T1 `ca…0001` MANAGED   — the twin that must stay empty (§D1)
--      T2 `ca…0002` UNMANAGED — the subject: §D2 §D3 §D5 §D6 §D7 §E
--      T3 `ca…0003` UNMANAGED, one QB only — the unfillable slots (§D4)
--      T4 `ca…0004` UNMANAGED-LOOKING but with NO league_members row (§D8)
--      T5 `ca…0005` UNMANAGED, minted AFTER the week opened: no lineup row
--                   at all (§D9 — D354's materialize-then-fill)
--    AL2 `ba…0002` — allow_illegal_lineups FALSE, one seat: §G, both halves
--    AL3 `ba…0003` — allow_illegal_lineups FALSE, one OUT player: §H
--    AL4 `ba…0004` — week 3 in `correction_window`: §I, with the live
--                    positive control at the SAME instant
--    AL5 `ba…0005` — T50 `ca…0050`: every slot full, one UNLOCKED OUT starter,
--                    and the only other eligible candidate past kickoff: §J
--                    (`every_candidate_locked`)
--    AL6 `ba…0006` — T60 `ca…0060`: NO `league_members` row at all: §K (both
--                    shapes of the D339 decline), then §L adds a placeholder
--                    row and fault-injects the carry
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('9a000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-ap' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'ap_user' || i)::jsonb, now(), now()
from generate_series(1, 3) i;

update nfl_weeks set first_kickoff_at = null, last_game_ends_at = null where season = 2026;
update nfl_weeks set last_game_ends_at = starts_at + interval '6 days' where season = 2026 and week in (1, 2);
update nfl_weeks set starts_at = '2026-09-23 04:00:00+00', last_game_ends_at = '2026-09-29 04:00:00+00', correction_window_ends_at = '2026-10-01 10:00:00+00' where season = 2026 and week = 3;
update nfl_weeks set starts_at = '2026-09-30 04:00:00+00', last_game_ends_at = '2026-10-06 04:00:00+00', correction_window_ends_at = '2026-10-08 10:00:00+00' where season = 2026 and week = 4;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('ap-w3-thu', 2026, 3, 'BUF', 'KC',  '2026-09-25 00:15:00+00', 'final'),
 ('ap-w3-sun', 2026, 3, 'PHI', 'DAL', '2026-09-27 17:00:00+00', 'final'),
 ('ap-w3-mon', 2026, 3, 'SF',  'NYG', '2026-09-29 00:15:00+00', 'final');

-- The four leagues. Every one lists `flex ×2` BEFORE `te` — see the
-- falsifiability note: that ordering is what makes §D3 able to tell the
-- bipartite matcher apart from a first-fit clone.
insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings)
select l.id, '9a000000-0000-4000-8000-000000000001', l.nm, 2026, 'in_season', l.tc, 4, 0, 5,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', l.st,
       '{"starting_slots": [
           {"key": "qb",   "label": "QB",    "eligible": ["QB"],            "count": 1},
           {"key": "flex", "label": "W/R/T", "eligible": ["WR", "RB", "TE"], "count": 2},
           {"key": "te",   "label": "TE",    "eligible": ["TE"],            "count": 1}],
         "bench": 4,
         "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}],
         "swap_spots": 0}'::jsonb
from (values
 ('ba000000-0000-4000-8000-000000000001'::uuid, 'pgtap-ap-L1', 8, '{"schedule_mode": "h2h", "allow_illegal_lineups": true}'::jsonb),
 ('ba000000-0000-4000-8000-000000000002'::uuid, 'pgtap-ap-L2', 8, '{"schedule_mode": "h2h", "allow_illegal_lineups": false}'::jsonb),
 ('ba000000-0000-4000-8000-000000000003'::uuid, 'pgtap-ap-L3', 8, '{"schedule_mode": "h2h", "allow_illegal_lineups": false}'::jsonb),
 ('ba000000-0000-4000-8000-000000000004'::uuid, 'pgtap-ap-L4', 8, '{"schedule_mode": "h2h", "allow_illegal_lineups": true}'::jsonb),
 -- AL5 §J (R1000): every slot full, one unlocked OUT starter, and the ONLY
 -- other eligible candidate already kicked off ⇒ `every_candidate_locked`.
 ('ba000000-0000-4000-8000-000000000005'::uuid, 'pgtap-ap-L5', 8, '{"schedule_mode": "h2h", "allow_illegal_lineups": true}'::jsonb),
 -- AL6 §K/§L (R999): its one seat has NO league_members row at all, so every
 -- unmanaged-LOOKING seat in the league is declined.
 ('ba000000-0000-4000-8000-000000000006'::uuid, 'pgtap-ap-L6', 8, '{"schedule_mode": "h2h", "allow_illegal_lineups": true}'::jsonb)
) as l(id, nm, tc, st);

insert into teams (id, owner_id, name, league_id) values
 ('ca000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000001', 'AP T1 managed',   'ba000000-0000-4000-8000-000000000001'),
 ('ca000000-0000-4000-8000-000000000002', '9a000000-0000-4000-8000-000000000001', 'AP T2 unmanaged', 'ba000000-0000-4000-8000-000000000001'),
 ('ca000000-0000-4000-8000-000000000003', '9a000000-0000-4000-8000-000000000001', 'AP T3 short',     'ba000000-0000-4000-8000-000000000001'),
 ('ca000000-0000-4000-8000-000000000004', '9a000000-0000-4000-8000-000000000001', 'AP T4 no member', 'ba000000-0000-4000-8000-000000000001'),
 ('ca000000-0000-4000-8000-000000000005', '9a000000-0000-4000-8000-000000000001', 'AP T5 late seat', 'ba000000-0000-4000-8000-000000000001'),
 ('ca000000-0000-4000-8000-000000000020', '9a000000-0000-4000-8000-000000000001', 'AP T20 no-illegal',  'ba000000-0000-4000-8000-000000000002'),
 ('ca000000-0000-4000-8000-000000000030', '9a000000-0000-4000-8000-000000000001', 'AP T30 nothing ok',  'ba000000-0000-4000-8000-000000000003'),
 ('ca000000-0000-4000-8000-000000000040', '9a000000-0000-4000-8000-000000000001', 'AP T40 closed week', 'ba000000-0000-4000-8000-000000000004'),
 ('ca000000-0000-4000-8000-000000000050', '9a000000-0000-4000-8000-000000000001', 'AP T50 all locked',  'ba000000-0000-4000-8000-000000000005'),
 ('ca000000-0000-4000-8000-000000000060', '9a000000-0000-4000-8000-000000000001', 'AP T60 no member',   'ba000000-0000-4000-8000-000000000006');

-- AL1's week 3 is LIVE; AL4's is CORRECTION_WINDOW (§I flips it at the same
-- instant as its positive control). Weeks 4-6 exist so nothing about the
-- calendar is accidental.
insert into league_weeks (league_id, season, week, status)
select l, 2026, g, case when g = 3 then 'live' else 'upcoming' end
from (values ('ba000000-0000-4000-8000-000000000001'::uuid),
             ('ba000000-0000-4000-8000-000000000002'::uuid),
             ('ba000000-0000-4000-8000-000000000003'::uuid),
             ('ba000000-0000-4000-8000-000000000005'::uuid),
             ('ba000000-0000-4000-8000-000000000006'::uuid)) v(l),
     generate_series(3, 6) g;
-- AL4's week 3 starts LIVE and §I walks it to correction_window: the
-- league_weeks transition guard (§12.17/F4) permits only
-- upcoming → live → correction_window → final, so the POSITIVE CONTROL has to
-- come first and the closed-week cell second — which is also the stronger
-- order, since the control then proves the fixture was fillable at that very
-- instant before the status changed.
insert into league_weeks (league_id, season, week, status)
select 'ba000000-0000-4000-8000-000000000004', 2026, g, case when g = 3 then 'live' else 'upcoming' end
from generate_series(3, 6) g;

-- THE PLAYERS. `adp` is POPULATED on every row that an ordering assertion
-- depends on (§4 rule 14(a)) and the QB pair REVERSES id order:
-- 'ap-qb-a' < 'ap-qb-hi' by id, and adp 50 > adp 1 by value.
insert into players (id, full_name, position, team, status, adp) values
 -- T2 (UNMANAGED): the subject roster
 ('ap-qb-a',   'AP QB Alpha', 'QB', 'DAL', 'Active', 50.0),
 ('ap-qb-hi',  'AP QB High',  'QB', 'DAL', 'Active',  1.0),
 ('ap-te1',    'AP TE One',   'TE', 'PHI', 'Active',  2.0),
 ('ap-rb1',    'AP RB One',   'RB', 'SF',  'Active',  3.0),
 ('ap-rb2',    'AP RB Two',   'RB', 'NYG', 'Active',  4.0),
 ('ap-wr1',    'AP WR One',   'WR', 'DAL', 'Active',  5.0),
 ('ap-kc-wr',  'AP KC WR',    'WR', 'KC',  'Active',  0.5),   -- top of order, Thursday kickoff: the lock boundary
 ('ap-ir',     'AP IR Man',   'RB', 'LAC', 'IR',     60.0),   -- on T2's IR spot; LAC never plays ⇒ bye too
 -- T1 (MANAGED): the same seven, position for position, team for team, adp
 -- for adp. Identical fillability — which is what makes §D1 a test of the
 -- predicate and not of the roster. (No IR twin: IR occupancy is irrelevant
 -- to fillability and T2's IR man is there to pin that autopilot carries an
 -- IR key verbatim.)
 ('ap-m-qb-hi', 'AP M QB High',  'QB', 'DAL', 'Active',  1.0),
 ('ap-m-qb-a',  'AP M QB Alpha', 'QB', 'DAL', 'Active', 50.0),
 ('ap-m-te1',   'AP M TE One',   'TE', 'PHI', 'Active',  2.0),
 ('ap-m-rb1',   'AP M RB One',   'RB', 'SF',  'Active',  3.0),
 ('ap-m-rb2',   'AP M RB Two',   'RB', 'NYG', 'Active',  4.0),
 ('ap-m-wr1',   'AP M WR One',   'WR', 'DAL', 'Active',  5.0),
 ('ap-m-kc-wr', 'AP M KC WR',    'WR', 'KC',  'Active',  0.5),
 -- T3: deliberately short — one QB and nothing else
 ('ap-s-qb',   'AP Short QB', 'QB', 'DAL', 'Active', 10.0),
 -- T4: fillable on paper, never touched (no league_members row)
 ('ap-n-qb',   'AP NoMem QB', 'QB', 'DAL', 'Active', 11.0),
 -- T5: the late seat
 ('ap-l-qb',   'AP Late QB',  'QB', 'DAL', 'Active', 20.0),
 ('ap-l-wr',   'AP Late WR',  'WR', 'DAL', 'Active', 21.0),
 -- AL2: the blocking designation at the TOP of the order, and the next-best
 ('ap-f-out',  'AP Out WR',   'WR', 'DAL', 'Out',     1.0),
 ('ap-f-ok',   'AP Ok WR',    'WR', 'DAL', 'Active',  2.0),
 ('ap-f-qb',   'AP F QB',     'QB', 'DAL', 'Active',  3.0),
 -- AL3: nothing healthy at all
 ('ap-u-out',  'AP U Out WR', 'WR', 'DAL', 'Out',     1.0),
 -- AL4
 ('ap-p-qb',   'AP P QB',     'QB', 'DAL', 'Active',  1.0),
 -- AL5 §J: four seated men (one of them an unlocked OUT man at flex:0) and ONE
 -- other eligible candidate, whose KC game has already kicked off at the
 -- instant — so the pass has something to do, does it, and changes nothing.
 ('ap-lk-qb',  'AP LK QB',    'QB', 'DAL', 'Active',  1.0),
 ('ap-lk-out', 'AP LK Out',   'WR', 'DAL', 'Out',     2.0),
 ('ap-lk-rb',  'AP LK RB',    'RB', 'SF',  'Active',  3.0),
 ('ap-lk-te',  'AP LK TE',    'TE', 'PHI', 'Active',  4.0),
 ('ap-lk-kc',  'AP LK KC WR', 'WR', 'KC',  'Active',  0.5),
 -- AL6 §K/§L: fillable on paper, never evaluated (no league_members row)
 ('ap-x-qb',   'AP X QB',     'QB', 'DAL', 'Active',  1.0);

-- T2's roster. INSERT ORDER IS DELIBERATE: 'ap-qb-a' goes in FIRST, so that
-- with the Q62 ORDER BY deleted the aggregate falls back to a scan order that
-- seats HIM — which is exactly what break probe 2 must make §D2 red.
insert into league_rosters (league_id, team_id, player_id, slot_key, ir_placed_week) values
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002', 'ap-qb-a',  'bn',  null),
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002', 'ap-qb-hi', 'bn',  null),
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002', 'ap-te1',   'bn',  null),
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002', 'ap-rb1',   'bn',  null),
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002', 'ap-rb2',   'bn',  null),
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002', 'ap-wr1',   'bn',  null),
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002', 'ap-kc-wr', 'bn',  null),
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002', 'ap-ir',    'ir1', 3),
 -- T1, the managed twin
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'ap-m-qb-a',  'bn', null),
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'ap-m-qb-hi', 'bn', null),
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'ap-m-te1',   'bn', null),
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'ap-m-rb1',   'bn', null),
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'ap-m-rb2',   'bn', null),
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'ap-m-wr1',   'bn', null),
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'ap-m-kc-wr', 'bn', null),
 -- T3 / T4 / T5
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000003', 'ap-s-qb', 'bn', null),
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000004', 'ap-n-qb', 'bn', null),
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000005', 'ap-l-qb', 'bn', null),
 ('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000005', 'ap-l-wr', 'bn', null),
 -- AL2 / AL3 / AL4
 ('ba000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000020', 'ap-f-out', 'bn', null),
 ('ba000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000020', 'ap-f-ok',  'bn', null),
 ('ba000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000020', 'ap-f-qb',  'bn', null),
 ('ba000000-0000-4000-8000-000000000003', 'ca000000-0000-4000-8000-000000000030', 'ap-u-out', 'bn', null),
 ('ba000000-0000-4000-8000-000000000004', 'ca000000-0000-4000-8000-000000000040', 'ap-p-qb',  'bn', null),
 -- AL5 / AL6
 ('ba000000-0000-4000-8000-000000000005', 'ca000000-0000-4000-8000-000000000050', 'ap-lk-qb',  'bn', null),
 ('ba000000-0000-4000-8000-000000000005', 'ca000000-0000-4000-8000-000000000050', 'ap-lk-out', 'bn', null),
 ('ba000000-0000-4000-8000-000000000005', 'ca000000-0000-4000-8000-000000000050', 'ap-lk-rb',  'bn', null),
 ('ba000000-0000-4000-8000-000000000005', 'ca000000-0000-4000-8000-000000000050', 'ap-lk-te',  'bn', null),
 ('ba000000-0000-4000-8000-000000000005', 'ca000000-0000-4000-8000-000000000050', 'ap-lk-kc',  'bn', null),
 ('ba000000-0000-4000-8000-000000000006', 'ca000000-0000-4000-8000-000000000060', 'ap-x-qb',   'bn', null);

-- THE SEATS. T1 is a real manager; T2/T3/T5 are placeholder seats in
-- `add_placeholder_seat`'s own shape (063:459-465: user_id NULL,
-- is_placeholder TRUE, team_id SET); T4 gets NO ROW AT ALL, which is the
-- state D339 says must be reported and never autopiloted. Seat 1 of each
-- league is the commissioner (063:327's partial unique caps it at one).
insert into league_members (league_id, user_id, team_id, role, is_placeholder) values
 ('ba000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'commissioner', false),
 ('ba000000-0000-4000-8000-000000000001', null, 'ca000000-0000-4000-8000-000000000002', 'manager', true),
 ('ba000000-0000-4000-8000-000000000001', null, 'ca000000-0000-4000-8000-000000000003', 'manager', true),
 ('ba000000-0000-4000-8000-000000000001', null, 'ca000000-0000-4000-8000-000000000005', 'manager', true),
 ('ba000000-0000-4000-8000-000000000002', null, 'ca000000-0000-4000-8000-000000000020', 'manager', true),
 ('ba000000-0000-4000-8000-000000000003', null, 'ca000000-0000-4000-8000-000000000030', 'manager', true),
 ('ba000000-0000-4000-8000-000000000004', null, 'ca000000-0000-4000-8000-000000000040', 'manager', true),
 -- AL5's seat is a genuine placeholder; AL6's team gets NO ROW AT ALL (§K adds
 -- one only in §L, where the point is a seat that IS unmanaged).
 ('ba000000-0000-4000-8000-000000000005', null, 'ca000000-0000-4000-8000-000000000050', 'manager', true);

-- THE WEEK-OPEN STATE, WRITTEN BY THE REAL CARRY rather than hand-planted, so
-- every "empty" row below is byte-identical to what `league_week_advance`
-- produces (116:543-546) — and so T5's ABSENT row is a faithful mid-week
-- `add_placeholder_seat` (063:455-465), minted after the week's ONE-SHOT
-- carry loop (118:1816-1824) had already run.
select public.lineup_carry_internal(t.lg, t.tm, 2026, 3, '2026-09-23 04:00:00+00')
from (values
 ('ba000000-0000-4000-8000-000000000001'::uuid, 'ca000000-0000-4000-8000-000000000001'::uuid),
 ('ba000000-0000-4000-8000-000000000001'::uuid, 'ca000000-0000-4000-8000-000000000002'::uuid),
 ('ba000000-0000-4000-8000-000000000001'::uuid, 'ca000000-0000-4000-8000-000000000003'::uuid),
 ('ba000000-0000-4000-8000-000000000001'::uuid, 'ca000000-0000-4000-8000-000000000004'::uuid),
 ('ba000000-0000-4000-8000-000000000002'::uuid, 'ca000000-0000-4000-8000-000000000020'::uuid),
 ('ba000000-0000-4000-8000-000000000003'::uuid, 'ca000000-0000-4000-8000-000000000030'::uuid),
 ('ba000000-0000-4000-8000-000000000004'::uuid, 'ca000000-0000-4000-8000-000000000040'::uuid),
 ('ba000000-0000-4000-8000-000000000005'::uuid, 'ca000000-0000-4000-8000-000000000050'::uuid),
 ('ba000000-0000-4000-8000-000000000006'::uuid, 'ca000000-0000-4000-8000-000000000060'::uuid)
) as t(lg, tm);

-- §J's STORED MAP, hand-planted over the carry's empty row: all four starting
-- slots full, flex:0 holding the unlocked OUT man. Only `slot_map` is planted
-- because the pass under test must write NOTHING — §J asserts the row is
-- unchanged and the REPORT's reason, never the other projections (the carry
-- wrote those, and 125 does not touch a row it does not change).
update team_lineups
   set slot_map = '{"qb:0": "ap-lk-qb", "flex:0": "ap-lk-out", "flex:1": "ap-lk-rb", "te:0": "ap-lk-te"}'::jsonb
 where team_id = 'ca000000-0000-4000-8000-000000000050' and season = 2026 and week = 3;

-- The §4 rule 14(c) PREMISE BLOCK. Without these the whole file is
-- unfalsifiable: one mis-seated member row turns §D1 into a tautology.
select is(
  (select format('teams=%s managed=%s unmanaged=%s no_member_row=%s',
                 count(*),
                 count(*) filter (where m.user_id is not null),
                 count(*) filter (where m.id is not null and m.user_id is null),
                 count(*) filter (where m.id is null))
   from teams t left join league_members m on m.team_id = t.id
   where t.league_id = 'ba000000-0000-4000-8000-000000000001'),
  'teams=5 managed=1 unmanaged=3 no_member_row=1',
  'B1 SEATING PREMISE (AL1): 1 MANAGED seat, 3 placeholder seats, and exactly 1 team with NO league_members row — D339''s predicate read from the other side, one row per seat (§12.2, 120:558)');
select is(
  (select format('qb_by_id=%s qb_by_adp=%s',
                 (select string_agg(player_id, ',' order by player_id) from league_rosters
                  where team_id = 'ca000000-0000-4000-8000-000000000002' and player_id like 'ap-qb-%'),
                 (select string_agg(r.player_id, ',' order by p.adp) from league_rosters r join players p on p.id = r.player_id
                  where r.team_id = 'ca000000-0000-4000-8000-000000000002' and r.player_id like 'ap-qb-%'))),
  'qb_by_id=ap-qb-a,ap-qb-hi qb_by_adp=ap-qb-hi,ap-qb-a',
  'B2 ORDERING PREMISE: the two QBs'' adp order is the REVERSE of their player_id order, and adp is POPULATED — so §D2 cannot pass under a deleted ORDER BY (§4 rule 14(a), the 064:235-243 trap)');
select is(
  (select count(*)::int from team_lineups tl join teams t on t.id = tl.team_id
   where t.league_id = 'ba000000-0000-4000-8000-000000000001' and tl.week = 3),
  4, 'B3 MATERIALIZATION PREMISE: the carry wrote FOUR week-3 rows for AL1 (T1-T4) and none for T5 — the week''s one-shot carry had already run when T5 was minted');
select is(
  (select count(*)::int from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000005' and season = 2026 and week = 3),
  0, 'B4 …so T5 has ZERO lineup rows for (2026, 3), and the reason is stated rather than inferred (§4 rule 15)');
select is((select slot_map from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000002' and week = 3),
  '{"ir1:0": "ap-ir"}'::jsonb,
  'B5 T2''s week-open row seats only its IR man from the ROSTER''s IR columns (D308) with every starting slot empty — the `{}`-shaped zero Q56(b) measured');
select is((select count(*)::int from league_weeks where league_id = 'ba000000-0000-4000-8000-000000000001' and week = 3 and status = 'live'),
  1, 'B6 AL1''s week 3 is LIVE (arm (c) is bounded to a live week — §I pins the other side)');

-- The chooser's own refusal: no row ⇒ loud, never an invented lineup (D354
-- puts materialization in the caller).
select throws_ok(
  $$ select public.lineup_autopilot_internal('ba000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000005', 2026, 3, '2026-09-25 00:15:01+00') $$,
  'P0002', null,
  'B7 lineup_autopilot_internal RAISES on a missing lineup row — it never invents one; the caller materializes through the unchanged carry (D354)');

-- The oracle invariant 2 uses: the matcher re-run over a STORED map must
-- place everyone and move nobody (season-invariants.ts checkLineupLegality).
create function pg_temp.ap_fit(p_team uuid) returns jsonb language sql as $$
  select public.lineup_fit_internal(
    (select coalesce(jsonb_agg(jsonb_build_object('key', (s ->> 'key') || ':' || i, 'eligible', s -> 'eligible') order by ord, i), '[]'::jsonb)
     from leagues l
       cross join lateral jsonb_array_elements(l.roster_settings -> 'starting_slots') with ordinality as t(s, ord)
       cross join lateral generate_series(0, coalesce((s ->> 'count')::int, 0) - 1) i
     where l.id = (select league_id from teams where id = p_team)),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'player_id', e.value #>> '{}',
              'position', case when p.position = 'DEF' then 'DST' else p.position end,
              'wanted', e.key, 'fixed', false) order by e.key), '[]'::jsonb)
     from team_lineups tl
       cross join lateral jsonb_each(tl.slot_map) e
       join players p on p.id = e.value #>> '{}'
     where tl.team_id = p_team and tl.season = 2026 and tl.week = 3
       and e.key not like 'ir1:%'));
$$;

-- ---------------------------------------------------------------------------
-- C. THE LOCK BOUNDARY, first half: kickoff −1s. The KC man is the TOP of the
--    candidate order (adp 0.5) and at this instant he is UNLOCKED, so he IS
--    seated. The +1s twin in §D5 is the same fixture one second later.
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:14:59+00', 'ba000000-0000-4000-8000-000000000001')::text, true);
select is((select slot_map -> 'flex:0' from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000002' and week = 3),
  '"ap-kc-wr"'::jsonb,
  'C1 kickoff −1s: the top-of-order KC WR IS seated (flex:0) — his game has not started, so nothing excludes him');
select is(current_setting('pgtap.r')::jsonb -> 'skipped_locked', '[]'::jsonb,
  'C1b …and skipped_locked is EMPTY at −1s (the boundary''s other side is §D5)');
select is((select locked_at from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000002' and week = 3),
  '2026-09-25 00:15:00+00'::timestamptz,
  'C1c …locked_at = the earliest SEATED kickoff, which is now the KC game itself');

-- Reset AL1 to the week-open state and re-run the real carry, so §D reads a
-- pristine fixture at the +1s instant (T5's row is deleted again: §D9
-- re-proves the 0 → 1 materialize in the main pass).
delete from team_lineups tl using teams t where t.id = tl.team_id and t.league_id = 'ba000000-0000-4000-8000-000000000001';
select public.lineup_carry_internal('ba000000-0000-4000-8000-000000000001', t.tm, 2026, 3, '2026-09-23 04:00:00+00')
from (values ('ca000000-0000-4000-8000-000000000001'::uuid), ('ca000000-0000-4000-8000-000000000002'::uuid),
             ('ca000000-0000-4000-8000-000000000003'::uuid), ('ca000000-0000-4000-8000-000000000004'::uuid)) as t(tm);
select is((select count(*)::int from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000005' and week = 3), 0,
  'C2 fixture reset: AL1 is back at the week-open state and T5 again has NO row');

-- ---------------------------------------------------------------------------
-- D. THE MAIN PASS — kickoff +1s (2026-09-25 00:15:01Z)
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00', 'ba000000-0000-4000-8000-000000000001')::text, true);

-- (a) THE PREDICATE. The MANAGED twin, same league, same week, same slate,
--     same seven players position-for-position — untouched.
select is((select slot_map from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000001' and week = 3),
  '{}'::jsonb,
  'D1 THE PREDICATE: the MANAGED team''s lineup is STILL EMPTY after the tick — autopilot keys on the absence of a seated manager in league_members (D339), never on teams.status, and never on "this seat looks idle"');
select ok(
  not exists (select 1 from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'autopiloted') x
              where x ->> 'team_id' = 'ca000000-0000-4000-8000-000000000001'),
  'D1b …and the managed team appears NOWHERE in autopiloted[] — the report agrees with the table');

-- (b) THE SORT. adp beats player_id, and the fixture reverses them.
select is((select slot_map -> 'qb:0' from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000002' and week = 3),
  '"ap-qb-hi"'::jsonb,
  'D2 THE SORT (Q62): qb:0 holds the HIGHER-VALUED QB (adp 1.0) and not the one that sorts first by player_id — break probe 2 deletes the ORDER BY and this cell reds');

-- (c) BIPARTITE, NOT FIRST-FIT.
select is((select slot_map - 'ir1:0' from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000002' and week = 3),
  '{"qb:0": "ap-qb-hi", "flex:0": "ap-rb2", "flex:1": "ap-rb1", "te:0": "ap-te1"}'::jsonb,
  'D3 THE CONTESTED SHAPE: all four starting slots are filled, with the TE re-routed to te:0 along an augmenting path so BOTH flex slots take a running back — a first-fit clone lets the TE grab flex:0 and strands the second RB, leaving te:0 EMPTY (break probe 1 reds this)');
select is(current_setting('pgtap.r')::jsonb -> 'autopilot_unfillable',
  (select coalesce(jsonb_agg(x order by x ->> 'team_id', x ->> 'slot'), '[]'::jsonb)
   from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'autopilot_unfillable') x
   where x ->> 'team_id' <> 'ca000000-0000-4000-8000-000000000002'),
  'D3b …and T2 contributes NOTHING to autopilot_unfillable — a full map, not a short one');
select is((select slot_map -> 'ir1:0' from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000002' and week = 3),
  '"ap-ir"'::jsonb,
  'D3c …the IR key is carried VERBATIM (IR occupancy is roster-level state, D308) and its occupant is never a starting candidate');

-- (f) UNFILLABLE CARRIES THE SLOT KEY **AND** A REASON.
select is(
  (select string_agg(x ->> 'slot', ',' order by x ->> 'slot') from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'autopilot_unfillable') x
   where x ->> 'team_id' = 'ca000000-0000-4000-8000-000000000003'),
  'flex:0,flex:1,te:0',
  'D4 the short-rostered team names EVERY slot it could not fill, by KEY (§4 rule 15 — never merely a short map)');
select is(
  (select x ->> 'reason' from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'autopilot_unfillable') x
   where x ->> 'team_id' = 'ca000000-0000-4000-8000-000000000003' and x ->> 'slot' = 'flex:0'),
  'no eligible player at FLEX on the roster',
  'D4b …each with a REASON STRING that says which kind of emptiness this is');
select is((select slot_map from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000003' and week = 3),
  '{"qb:0": "ap-s-qb"}'::jsonb,
  'D4c …and the one slot it COULD fill is filled — an unfillable slot never blocks the rest');

-- (e) THE LOCK BOUNDARY, second half (+1s). D338: autopilot does NOT inherit
--     the commissioner's exemption; the lock is per-player, so the pass still
--     seats everybody else.
select is(
  (select string_agg(x ->> 'player_id', ',' order by x ->> 'player_id') from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'skipped_locked') x),
  'ap-kc-wr',
  'D5 THE LOCK (D338): at kickoff +1s the KC man is EXCLUDED and NAMED in skipped_locked — and he is the ONLY entry: T1''s identical KC twin never appears because a MANAGED seat is never evaluated at all (D339 again, from the other side)');
select ok(
  (select x ->> 'reason' like '%kicked off%' and (x ->> 'kickoff_at')::timestamptz = '2026-09-25 00:15:00+00'::timestamptz
   from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'skipped_locked') x
   where x ->> 'player_id' = 'ap-kc-wr'),
  'D5b …with his own kickoff INSTANT and a reason — never a silent drop');
select ok(
  (select not (slot_map::text like '%ap-kc-wr%') from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000002' and week = 3),
  'D5c …and the top-of-order KC WR is NOT in the map one second after his kickoff, though he WAS at −1s (§C1) — the boundary, both sides');

-- (h) THE THREE PROJECTIONS AGREE, AND locked_at IS THE EARLIEST SEATED KICKOFF.
select is(
  (select string_agg(s ->> 'player_id', ',' order by s ->> 'slot') from team_lineups tl, jsonb_array_elements(tl.starters) s
   where tl.team_id = 'ca000000-0000-4000-8000-000000000002' and tl.week = 3 and s ->> 'player_id' is not null),
  'ap-rb2,ap-rb1,ap-qb-hi,ap-te1',
  'D6 starters[] names exactly the players slot_map seats, in canonical slot order — the two projections agree (a partial write is silent until they disagree in front of a user)');
select is(
  (select string_agg(e.value, ',' order by e.value) from team_lineups tl, jsonb_each_text(tl.slot_map) e
   where tl.team_id = 'ca000000-0000-4000-8000-000000000002' and tl.week = 3),
  (select string_agg(u.v, ',' order by u.v) from (
     select s ->> 'player_id' as v from team_lineups tl, jsonb_array_elements(tl.starters) s
      where tl.team_id = 'ca000000-0000-4000-8000-000000000002' and tl.week = 3 and s ->> 'player_id' is not null
     union all select 'ap-ir') u),
  'D6b …and slot_map''s value set = starters[] ∪ the IR man, with nothing extra on either side');
select is((select bench from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000002' and week = 3),
  '["ap-kc-wr", "ap-qb-a", "ap-wr1"]'::jsonb,
  'D6c bench = roster − starters − IR, sorted by player_id (116:535-539''s shape) — the locked KC man and the two unplaced candidates');
select is((select locked_at from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000002' and week = 3),
  '2026-09-27 17:00:00+00'::timestamptz,
  'D6d locked_at = the EARLIEST SEATED kickoff (the Sunday DAL/PHI game) — not a week datum, and not the KC game nobody seated');

-- (i) THE ORACLE invariant 2 uses. Green BY CONSTRUCTION because the map was
--     built THROUGH lineup_fit_internal (D340) — and red under break probe 1.
select is(pg_temp.ap_fit('ca000000-0000-4000-8000-000000000002') -> 'unplaced', '[]'::jsonb,
  'D7 THE GATE ORACLE: lineup_fit_internal over the WRITTEN map places everyone — `unplaced = []`, the same check checkLineupLegality (invariant 2) reds on');
select is(pg_temp.ap_fit('ca000000-0000-4000-8000-000000000002') -> 'rearranged', 'false'::jsonb,
  'D7b …and `rearranged = false` — the M4 season gate is green by construction, not by exemption (D340)');

-- (j) D339's UNSAFE FAILURE DIRECTION.
select is(
  (select x - 'why' from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'skipped') x
   where x ->> 'team_id' = 'ca000000-0000-4000-8000-000000000004'),
  '{"reason": "no_league_members_row", "team_id": "ca000000-0000-4000-8000-000000000004", "league_id": "ba000000-0000-4000-8000-000000000001"}'::jsonb,
  'D8 a team with NO league_members row at all is REPORTED BY NAME in skipped[] — `NOT EXISTS (user_id IS NOT NULL)` is also true of "no row", and autopilot must not seize a human''s team on a zero-row read (D339)');
select ok(
  (select x ->> 'why' like '%§12.2%' from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'skipped') x
   where x ->> 'team_id' = 'ca000000-0000-4000-8000-000000000004'),
  'D8b …and the report says WHY, naming the one-row-per-seat invariant that the predicate relies on');
select is((select slot_map from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000004' and week = 3),
  '{}'::jsonb,
  'D8c …and it is NOT autopiloted, though its roster would have filled qb:0 — the refusal is real, not cosmetic');

-- (l) D354: THE SEAT WITH NO ROW AT ALL — materialized, then filled.
select is((select count(*)::int from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000005' and season = 2026 and week = 3),
  1, 'D9 D354: the late seat''s (team, season, week) row count went 0 → 1 — materialized through the UNCHANGED carry inside the tick (B4 asserted the 0, and WHY: the week''s one-shot carry loop had already run, 118:1816-1824)');
select is(
  (select x - 'why_absent' from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'seats_materialized') x),
  '{"week": 3, "team_id": "ca000000-0000-4000-8000-000000000005", "league_id": "ba000000-0000-4000-8000-000000000001"}'::jsonb,
  'D9b …and it is NAMED in seats_materialized[] — the arm that an UPDATE-only design would have matched 0 rows for, reporting nothing (the exact defect this task exists to prevent)');
select ok(
  (select (x ->> 'materialized')::boolean from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'autopiloted') x
   where x ->> 'team_id' = 'ca000000-0000-4000-8000-000000000005'),
  'D9c …and in autopiloted[] too, flagged as materialized — named in BOTH arrays, per the task''s own wording');
select is((select slot_map from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000005' and season = 2026 and week = 3),
  '{"qb:0": "ap-l-qb", "flex:0": "ap-l-wr"}'::jsonb,
  'D9d …and it ends the tick with a LEGAL NON-EMPTY slot_map — the zero Q56(b) measured is gone for this seat');
select is(pg_temp.ap_fit('ca000000-0000-4000-8000-000000000005') -> 'unplaced', '[]'::jsonb,
  'D9e …and that map passes the same gate oracle');

-- The report's own honesty: work happened, so autopilot_reason is NULL and
-- the arrays carry the detail.
select is(current_setting('pgtap.r')::jsonb -> 'autopilot_reason', 'null'::jsonb,
  'D10 autopilot_reason is NULL on a pass that DID fill seats — the reason field is for silence, and the arrays are the receipt');
select is((select jsonb_array_length(current_setting('pgtap.r')::jsonb -> 'autopiloted')), 3,
  'D10b three seats were autopiloted (T2, T3, T5) — the managed seat and the member-row-less seat are not among them');
select is(current_setting('pgtap.r')::jsonb ->> 'reason', null,
  'D10c the tick''s own `reason` is NOT `no_changes` — v_ap_writes joins 119''s two counters, so a pass that autopiloted can never claim nothing happened (H4)');

-- ---------------------------------------------------------------------------
-- E. IDEMPOTENCE, genuinely reachable: arm (c)'s driving query re-visits every
--    unmanaged seat unconditionally, so the guard really does execute.
-- ---------------------------------------------------------------------------
select set_config('pgtap.d1',
  (select md5(string_agg(tl.id::text || coalesce(tl.slot_map::text, '') || tl.starters::text || coalesce(tl.bench::text, '') || coalesce(tl.locked_at::text, ''), '|' order by tl.id))
   from team_lineups tl join teams t on t.id = tl.team_id where t.league_id = 'ba000000-0000-4000-8000-000000000001'), true);
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00', 'ba000000-0000-4000-8000-000000000001')::text, true);
select is(current_setting('pgtap.r')::jsonb -> 'autopiloted', '[]'::jsonb,
  'E1 IDEMPOTENCE: the second pass at the SAME instant autopilots NOTHING');
select is(current_setting('pgtap.r')::jsonb ->> 'autopilot_reason', 'nothing_fillable',
  'E1b …and it SAYS WHY rather than going quiet (§4 rule 15) — T3''s slots are still unfillable and nothing else has an empty slot or an unhealthy unlocked starter');
select is(current_setting('pgtap.r')::jsonb ->> 'reason', 'no_changes',
  'E1c …and the tick''s own reason is no_changes — zero pool writes, zero lineup-record writes, zero autopilot writes');
select is(
  (select md5(string_agg(tl.id::text || coalesce(tl.slot_map::text, '') || tl.starters::text || coalesce(tl.bench::text, '') || coalesce(tl.locked_at::text, ''), '|' order by tl.id))
   from team_lineups tl join teams t on t.id = tl.team_id where t.league_id = 'ba000000-0000-4000-8000-000000000001'),
  current_setting('pgtap.d1'),
  'E1d …and the team_lineups digest is byte-for-byte unchanged — asserted over the table, not inferred from the report');
select is((select jsonb_array_length(current_setting('pgtap.r')::jsonb -> 'seats_materialized')), 0,
  'E1e …and nothing is materialized twice (the carry has no ON CONFLICT: a second INSERT would be a loud 23505 in failures[], which is also empty)');
select is(current_setting('pgtap.r')::jsonb -> 'failures', '[]'::jsonb,
  'E1f …failures[] is empty — no league raised, so nothing was swallowed by the per-league handler');

-- ---------------------------------------------------------------------------
-- F. THE KILL SWITCH (item 4b) — `system_flags` key `autopilot_disabled`,
--    world-SELECT with NO write policy for any role (122:111-114), so an
--    operator sets it with a service_role write and nothing else.
-- ---------------------------------------------------------------------------
update team_lineups set slot_map = '{"ir1:0": "ap-ir"}'::jsonb
 where team_id = 'ca000000-0000-4000-8000-000000000002' and week = 3;
insert into system_flags (key, value) values ('autopilot_disabled', '{"disabled": true}');
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00', 'ba000000-0000-4000-8000-000000000001')::text, true);
select is((select slot_map from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000002' and week = 3),
  '{"ir1:0": "ap-ir"}'::jsonb,
  'F1 THE KILL SWITCH: with autopilot_disabled = {"disabled": true} the emptied seat is NOT refilled — not one lineup written');
select is(current_setting('pgtap.r')::jsonb ->> 'autopilot_reason', 'disabled_by_system_flag:autopilot_disabled',
  'F1b …and autopilot_reason NAMES THE FLAG, so an operator reading the tick''s output learns why it is doing nothing');
select is(current_setting('pgtap.r')::jsonb -> 'autopiloted', '[]'::jsonb,
  'F1c …autopiloted[] is empty (R1002: that alone does NOT show the short-circuit — an arm that ran its query and wrote nothing looks identical; F1c2 is the cell that tells them apart)');
select is(current_setting('pgtap.r')::jsonb -> 'skipped', '[]'::jsonb,
  'F1c2 …and skipped[] is EMPTY TOO, which is what distinguishes "the arm never ran" from "it ran and wrote nothing": T4 has no league_members row, so arm (c)''s driving query WOULD name it here the moment the `IF NOT v_ap_off` short-circuit (125, arm (c)''s first line) were removed');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'system_flags' and cmd <> 'SELECT'),
  0, 'F1d system_flags still has NO write policy for any role (122:111-114) — necessary for "a service_role write and nothing else", and NOT sufficient: RLS does not cover TRUNCATE, which is F1e''s subject');
-- R998: THE BANNER'S "AND NOTHING ELSE" IS MEASURED PER ROLE, the 071/123 way.
-- A `pg_policies` assertion structurally cannot see a TRUNCATE grant — which is
-- exactly how `anon`/`authenticated` kept TRUNCATE on this table from 122 until
-- migration 125 section 0 took it away (measured: `set local role
-- authenticated; truncate public.system_flags;` SUCCEEDED, 2 rows → 0).
select ok(
  not has_table_privilege('anon', 'public.system_flags', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.system_flags', 'TRUNCATE')
  and not exists (
    select 1 from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.system_flags'::regclass
      and a.privilege_type = 'TRUNCATE' and a.grantee = 0),
  'F1e THE KILL SWITCH CANNOT BE WIPED BY A CLIENT: TRUNCATE is revoked from anon, from authenticated AND from PUBLIC (grantee 0) — RLS does not cover TRUNCATE (D350, 123:485-491), so without this REVOKE any signed-in user could release the operator''s emergency brake and take stats_degraded and every ingest_poll:* key with it (125 §0, R998)');
select ok(
  has_table_privilege('service_role', 'public.system_flags', 'TRUNCATE')
  and has_table_privilege('postgres', 'public.system_flags', 'TRUNCATE'),
  'F1f …and the OPERATOR still can: service_role and the owner keep TRUNCATE, so the REVOKE narrowed the door without locking the recovery path out of it (the 123:491 shape — a REVOKE, not a BEFORE TRUNCATE trigger, because this is operational state and not the audit log)');
delete from system_flags where key = 'autopilot_disabled';
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00', 'ba000000-0000-4000-8000-000000000001')::text, true);
select is((select slot_map - 'ir1:0' from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000002' and week = 3),
  '{"qb:0": "ap-qb-hi", "flex:0": "ap-rb2", "flex:1": "ap-rb1", "te:0": "ap-te1"}'::jsonb,
  'F2 …and with the row DELETED the SAME instant fills the same seats again — the switch is reversible at the next minute, with no deploy');
select is(current_setting('pgtap.r')::jsonb -> 'autopilot_reason', 'null'::jsonb,
  'F2b …and the reason field goes back to NULL because work happened');

-- ---------------------------------------------------------------------------
-- G. `allow_illegal_lineups` — THE SPLIT, BOTH SIDES (item 4c). The same
--    fixture league is run twice: FALSE first, then TRUE, so the cell tests
--    the split rather than one side of it.
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00', 'ba000000-0000-4000-8000-000000000002')::text, true);
select is((select slot_map from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000020' and week = 3),
  '{"qb:0": "ap-f-qb", "flex:0": "ap-f-ok"}'::jsonb,
  'G1 allow_illegal_lineups = FALSE: the top-of-order candidate (adp 1.0) carrying a BLOCKING designation is NOT seated, and the next-best WR (adp 2.0) IS — naming both (§7.3.6, the split 114:603-616 takes)');
select is(
  (select x ->> 'reason' from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'autopilot_unfillable') x
   where x ->> 'team_id' = 'ca000000-0000-4000-8000-000000000020' and x ->> 'slot' = 'flex:1'),
  'no healthy eligible player at FLEX; league forbids illegal lineups',
  'G1b …and the slot the filtered man would have taken is named in autopilot_unfillable WITH THE LEAGUE SETTING as its reason — never left as a short map');
update leagues set settings = jsonb_set(settings, '{allow_illegal_lineups}', 'true'::jsonb)
 where id = 'ba000000-0000-4000-8000-000000000002';
update team_lineups set slot_map = '{}'::jsonb
 where team_id = 'ca000000-0000-4000-8000-000000000020' and week = 3;
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00', 'ba000000-0000-4000-8000-000000000002')::text, true);
select is((select slot_map from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000020' and week = 3),
  '{"qb:0": "ap-f-qb", "flex:0": "ap-f-ok", "flex:1": "ap-f-out"}'::jsonb,
  'G2 the SAME fixture with the setting TRUE: the blocking designation is a PREFERENCE, so he is seated LAST rather than left out — an empty slot is the zero this task exists to remove (item 4c)');
select is(
  (select s -> 'flags' from team_lineups tl, jsonb_array_elements(tl.starters) s
   where tl.team_id = 'ca000000-0000-4000-8000-000000000020' and tl.week = 3 and s ->> 'slot' = 'flex:1'),
  '["out"]'::jsonb,
  'G2b …AND HE IS FLAGGED — `out` in his starters element, the same flag a manager''s own illegal-but-legal lineup carries (114:596-599)');
select is(
  (select count(*)::int from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'autopilot_unfillable') x
   where x ->> 'team_id' = 'ca000000-0000-4000-8000-000000000020' and x ->> 'slot' = 'flex:1'),
  0, 'G2c …and flex:1 is no longer unfillable — the same slot, the same roster, the same instant, one setting apart');

-- ---------------------------------------------------------------------------
-- H. NOTHING HEALTHY AT ALL in an allow_illegal_lineups = FALSE league: the
--    reason is the league setting, and the pass SAYS it wrote nothing.
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00', 'ba000000-0000-4000-8000-000000000003')::text, true);
select is(
  (select string_agg(x ->> 'slot' || '=' || (x ->> 'reason'), ' | ' order by x ->> 'slot')
   from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'autopilot_unfillable') x),
  'flex:0=no healthy eligible player at FLEX; league forbids illegal lineups | flex:1=no healthy eligible player at FLEX; league forbids illegal lineups | qb:0=no eligible player at QB on the roster | te:0=no eligible player at TE on the roster',
  'H1 every slot is named with the reason that actually applies to IT — the league setting where a filtered candidate was eligible, an empty roster where none was (never one blanket string)');
select is(current_setting('pgtap.r')::jsonb ->> 'autopilot_reason', 'nothing_fillable',
  'H1b …and autopilot_reason is NOT the empty/absent value on a pass that filled nothing (item 4c''s closing clause)');
select is((select slot_map from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000030' and week = 3),
  '{}'::jsonb,
  'H1c …and the row is untouched — a refused slot is never written as a partial map');

-- ---------------------------------------------------------------------------
-- I. THE WEEK MUST BE LIVE (D354's `lw.status = 'live'` clause), with the
--    POSITIVE CONTROL AT THE SAME INSTANT so the cell cannot pass by seating
--    nothing at all. Order is forced by the transition guard (§12.17/F4):
--    `correction_window → live` is illegal, so the control runs first.
-- ---------------------------------------------------------------------------
select is((select status from league_weeks where league_id = 'ba000000-0000-4000-8000-000000000004' and week = 3), 'live',
  'I1 PREMISE: AL4''s week 3 is the CURRENT week (nfl_weeks.starts_at has passed) and it is LIVE');
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00', 'ba000000-0000-4000-8000-000000000004')::text, true);
select is((select slot_map from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000040' and week = 3),
  '{"qb:0": "ap-p-qb"}'::jsonb,
  'I2 THE POSITIVE CONTROL: with the week LIVE, this seat and this roster FILL at this instant — so I3 below pins the status clause and not an unfillable fixture');
update team_lineups set slot_map = '{}'::jsonb
 where team_id = 'ca000000-0000-4000-8000-000000000040' and week = 3;
update league_weeks set status = 'correction_window' where league_id = 'ba000000-0000-4000-8000-000000000004' and week = 3;
select is((select status from league_weeks where league_id = 'ba000000-0000-4000-8000-000000000004' and week = 3), 'correction_window',
  'I2b the week is now correction_window and STILL the current week — `tl.week = v_current` does NOT imply `live` (112:360-374 derives v_current from nfl_weeks.starts_at, so the current week sits here from the last whistle until finalize)');
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00', 'ba000000-0000-4000-8000-000000000004')::text, true);
select is((select slot_map from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000040' and week = 3),
  '{}'::jsonb,
  'I3 THE SAME FIXTURE AT THE SAME INSTANT is NOT touched once the week closes — filling a week that has been played is a scoring rewrite, not a fallback (break probe: drop the lw.status clause and this cell reds)');
select is(current_setting('pgtap.r')::jsonb ->> 'autopilot_reason', 'no_unmanaged_seats_in_a_live_current_week',
  'I3b …and the reason says precisely what the arm saw — not a bare "no unmanaged seats", which would be a plausible-looking silence about a seat that plainly does exist (§4 rule 15)');

-- ---------------------------------------------------------------------------
-- J. `every_candidate_locked` (R1000) — one of the five autopilot_reason values
--    item 4 enumerates, and it was asserted by NO cell. AL5: every starting
--    slot is full, flex:0 holds an unlocked OUT man (so the pass has work to
--    do and does NOT short-circuit), and the only other eligible candidate's
--    game has already kicked off — so Q63's restore puts the OUT man straight
--    back, the map is unchanged, and nothing is unfillable.
-- ---------------------------------------------------------------------------
select is(
  (select format('map=%s out_is_unlocked=%s only_other_wr_is_locked=%s',
                 (select slot_map::text from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000050' and week = 3),
                 (select (g.kickoff_at > '2026-09-25 00:15:01+00'::timestamptz)::text from nfl_games g
                   where g.season = 2026 and g.week = 3 and 'DAL' in (g.home_team, g.away_team)),
                 (select (g.kickoff_at <= '2026-09-25 00:15:01+00'::timestamptz)::text from nfl_games g
                   where g.season = 2026 and g.week = 3 and 'KC' in (g.home_team, g.away_team)))),
  'map={"qb:0": "ap-lk-qb", "te:0": "ap-lk-te", "flex:0": "ap-lk-out", "flex:1": "ap-lk-rb"} out_is_unlocked=true only_other_wr_is_locked=true',
  'J1 PREMISE (§4 rule 14(c)): AL5''s stored map fills ALL FOUR starting slots, the OUT man at flex:0 is UNLOCKED (his DAL game is Sunday, so the pass must evaluate him) and the ONLY other eligible WR''s KC game kicked off BEFORE the instant');
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00', 'ba000000-0000-4000-8000-000000000005')::text, true);
select is(current_setting('pgtap.r')::jsonb ->> 'autopilot_reason', 'every_candidate_locked',
  'J2 autopilot_reason = every_candidate_locked — the pass looked, found nobody it was ALLOWED to seat, and says which kind of emptiness that is (§4 rule 15); before this cell the value was enumerated by item 4 and asserted by nothing');
select is((select slot_map from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000050' and week = 3),
  '{"qb:0": "ap-lk-qb", "flex:0": "ap-lk-out", "flex:1": "ap-lk-rb", "te:0": "ap-lk-te"}'::jsonb,
  'J3 …and the row is BYTE-UNCHANGED: the displaced OUT man goes straight back where he was (Q63''s restore), because autopilot never turns an occupied slot into an empty one');
select is(current_setting('pgtap.r')::jsonb -> 'autopiloted', '[]'::jsonb,
  'J4 …nothing is in autopiloted[] — `changed` is FALSE by value (the map equals the stored map), so no UPDATE ran at all');
select ok(
  (select (x ->> 'team_id') = 'ca000000-0000-4000-8000-000000000050'
      and (x ->> 'kickoff_at')::timestamptz = '2026-09-25 00:15:00+00'::timestamptz
   from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'skipped_locked') x
   where x ->> 'player_id' = 'ap-lk-kc'),
  'J4b …and the one candidate the lock excluded is NAMED with his team and his kickoff instant — which is what makes the reason checkable rather than a mood');
select is(current_setting('pgtap.r')::jsonb -> 'autopilot_unfillable', '[]'::jsonb,
  'J4c …with NOTHING in autopilot_unfillable — that is precisely the difference between this arm and `nothing_fillable`: every slot IS filled, and the candidate who could have improved it was locked');

-- ---------------------------------------------------------------------------
-- K. THE D339 DECLINE REPORTS ITSELF (R999). Before the fix round the same
--    pass that correctly REFUSES to seize a team reported either a
--    materialization failure that did not happen (a seat with no lineup row)
--    or "nothing_fillable" about seats it never evaluated (a seat with one).
--    AL6's single seat has NO league_members row, so BOTH shapes are reachable
--    on one league: row-present first, then row-deleted.
-- ---------------------------------------------------------------------------
select is(
  (select format('member_rows=%s lineup_rows=%s week=%s',
                 (select count(*)::int from league_members where team_id = 'ca000000-0000-4000-8000-000000000060'),
                 (select count(*)::int from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000060' and season = 2026 and week = 3),
                 (select status from league_weeks where league_id = 'ba000000-0000-4000-8000-000000000006' and week = 3))),
  'member_rows=0 lineup_rows=1 week=live',
  'K1 PREMISE: AL6''s one team has ZERO league_members rows, DOES have a week-3 lineup row, and its week is LIVE — so the seat matches arm (c)''s predicate and is then declined by the has_member guard');
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00', 'ba000000-0000-4000-8000-000000000006')::text, true);
select is(current_setting('pgtap.r')::jsonb ->> 'autopilot_reason', 'every_unmanaged_looking_seat_declined_no_league_members_row',
  'K2 CASE 2 (lineup row PRESENT): the reason names the DECLINE. It used to read `nothing_fillable` — a statement about seats the pass deliberately never looked at (§4 rule 15''s own shape, in the field built to abolish it)');
select is(
  (select x - 'why' from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'skipped') x),
  '{"reason": "no_league_members_row", "team_id": "ca000000-0000-4000-8000-000000000060", "league_id": "ba000000-0000-4000-8000-000000000006"}'::jsonb,
  'K2b …and skipped[] still names the team and the reason (D339''s unsafe failure direction is reported per seat; the reason field describes the PASS)');
select is(current_setting('pgtap.r')::jsonb -> 'autopiloted', '[]'::jsonb,
  'K2c …and nothing was autopiloted — the refusal is real, not cosmetic');
delete from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000060' and season = 2026 and week = 3;
select is((select count(*)::int from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000060' and season = 2026 and week = 3),
  0, 'K3 PREMISE for CASE 1: the same seat now has NO lineup row either (the shape that used to be misreported)');
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00', 'ba000000-0000-4000-8000-000000000006')::text, true);
select is(current_setting('pgtap.r')::jsonb ->> 'autopilot_reason', 'every_unmanaged_looking_seat_declined_no_league_members_row',
  'K4 CASE 1 (lineup row ABSENT): the SAME decline reason — it used to read `no_row_and_no_materialize`, reporting a materialize that never ran, because the seat was declined BEFORE the carry was reached');
select is(current_setting('pgtap.r')::jsonb -> 'seats_materialized', '[]'::jsonb,
  'K4b …and seats_materialized[] is empty, which is the table-side proof that no materialize was attempted on a declined seat');

-- ---------------------------------------------------------------------------
-- L. `no_row_and_no_materialize`, NOW MEANING WHAT IT SAYS (R999/R1000). The
--    arm is a CONTRACT CHECK on `lineup_carry_internal`, whose own contract is
--    INSERT-or-RAISE (116:541-551) — so it is unreachable while that contract
--    holds, and §4 rule 14(b) forbids asserting a guard that cannot execute.
--    It is made reachable here by FAULT INJECTION: the carry is replaced, in
--    this transaction only, with a stub that returns without inserting. The
--    `rollback` at the end of this file restores the real function; §A10/§A11
--    pinned the real one at the top of the suite, before any of this.
-- ---------------------------------------------------------------------------
insert into league_members (league_id, user_id, team_id, role, is_placeholder) values
 ('ba000000-0000-4000-8000-000000000006', null, 'ca000000-0000-4000-8000-000000000060', 'manager', true);
select is(
  (select format('member_rows=%s seated=%s lineup_rows=%s',
                 (select count(*)::int from league_members where team_id = 'ca000000-0000-4000-8000-000000000060'),
                 (select count(*)::int from league_members where team_id = 'ca000000-0000-4000-8000-000000000060' and user_id is not null),
                 (select count(*)::int from team_lineups where team_id = 'ca000000-0000-4000-8000-000000000060' and season = 2026 and week = 3))),
  'member_rows=1 seated=0 lineup_rows=0',
  'L1 PREMISE: AL6''s seat is now a GENUINE unmanaged seat (one placeholder league_members row, no seated user) with NO lineup row — so the pass reaches the materialize step instead of declining');
create or replace function lineup_carry_internal(
  p_league_id uuid, p_team_id uuid, p_season integer, p_week integer, p_at timestamptz
) returns jsonb language sql as $stub$
  -- FAULT INJECTION (this transaction only): the carry returns a plausible
  -- result and writes NOTHING. This is the "nothing happened read as it
  -- worked" shape the arm under test exists to catch.
  select jsonb_build_object('team_id', p_team_id, 'week', p_week, 'stub', true);
$stub$;
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00', 'ba000000-0000-4000-8000-000000000006')::text, true);
select is(current_setting('pgtap.r')::jsonb ->> 'autopilot_reason', 'no_row_and_no_materialize',
  'L2 with the carry returning without inserting, autopilot_reason = no_row_and_no_materialize — the value now means exactly that: a seat that REACHED the materialize step and still had no row');
select is(
  (select x - 'why' from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'skipped') x),
  '{"week": 3, "reason": "no_row_and_no_materialize", "team_id": "ca000000-0000-4000-8000-000000000060", "league_id": "ba000000-0000-4000-8000-000000000006"}'::jsonb,
  'L2b …and the seat is NAMED in skipped[] with that reason — a 0-row read is reported, never inferred (§4 rule 15)');
select ok(
  (select x ->> 'why' like '%INSERT-or-RAISE%' from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'skipped') x
   where x ->> 'team_id' = 'ca000000-0000-4000-8000-000000000060'),
  'L2c …and the `why` names the CONTRACT that was broken (116:541-551), so an operator reading the tick output knows this is a bug in the carry and not a quiet league');
select is(current_setting('pgtap.r')::jsonb -> 'failures', '[]'::jsonb,
  'L3 failures[] is EMPTY: the post-carry existence check CONTINUEs before the chooser, so the P0002 "no team_lineups row" refusal (§B7) never fires and nothing is swallowed by the per-league handler as an opaque error');
select is(current_setting('pgtap.r')::jsonb -> 'seats_materialized', '[]'::jsonb,
  'L3b …and seats_materialized[] stays EMPTY — a seat is only claimed as materialized once its row has been read back');
select is(current_setting('pgtap.r')::jsonb -> 'autopiloted', '[]'::jsonb,
  'L3c …and nothing was autopiloted: no invented lineup, no partial write');

select * from finish();
rollback;
