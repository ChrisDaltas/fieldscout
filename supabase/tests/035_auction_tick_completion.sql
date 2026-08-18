-- ============================================================================
-- The auction clock + the priced completion writer — pgTAP 035 (migration
-- 086, task L.C1.4; spec §8.2, §8.6.2, §8.6.4, §8.6.6, §8.6.7(b)(c)(e),
-- §8.6.8, §12.4, §12.7, §14, §22.3; E26/E27/E30/E48;
-- D102/D111(3)/D126/D129(2)(3)(4)/D130/D137/D146). Discharges F62.
--
-- WHAT THIS FILE OWNS vs its neighbours: 022 owns `draft_autopick_resolve`'s
-- source priority, the greedy need-fit model and the SNAKE grace world;
-- 026 owns the snake completion → `league_rosters` → `in_season` chain;
-- 033 owns the budget derivation matrix and the auction start arm; 034 owns
-- `draft_nominate`/`draft_place_bid` end to end. THIS file owns everything
-- the CLOCK does to an auction: the nomination timeout (all seat classes,
-- both grace branches), the bid close and its award, the rotation, the
-- completion, and the two hunks 086 makes outside ARM 2.6 (ARM 2's auction
-- exclusion; the auction-only K/DST deferral).
--
-- FIXTURE ADP IS FRACTIONAL, DELIBERATELY (the R286 lesson / ledger F60).
-- Every player fixture here carries an adp in (0, 1), strictly below every
-- real ADP the projections sync can produce, so the ADP arm's
-- `ORDER BY pl.adp NULLS LAST, pl.id` resolves to a fixture BY VALUE and no
-- data refresh can take an assertion's player away. F60's sweep is L.C6.1's
-- to close; this file simply does not add to it.
--
-- Falsifiability notes (§4.3) — every count below was RUN, never predicted
-- (the R306/R314 lesson). Each probe was a LOCAL-ONLY `CREATE OR REPLACE`
-- from a patched copy of 086, reverted by re-applying the file unmutated;
-- 105/105 before each and again after each.
--   * **BREAK PROBE 1 — the DoD's, adapted and disclosed. AS RUN: 35 of
--     105 RED, and the file runs to the END** (23, 25–27, 29, 31–32,
--     35–36, 38, 40, 43–44, 46–47, 49, 51–52, 55, 60–61, 63, 65–67, 71,
--     79, 82–83, 86–91), plus 2 of the wire suite's 3 cases. The task
--     prints "award to high bidder even when no raises exist (drop the E26
--     branch)". There is no E26 branch in 086 to drop: 085 makes the
--     NOMINATOR the high bidder at nomination time, so awarding the
--     standing high bidder IS §8.6.7(b). The mutation carrying the same
--     meaning is a guard that refuses to award a nomination holding only
--     its opening row — §8.6.7(b) deleted — which is exactly the defect
--     the E26 goldens exist to catch (pin 46 is §E's human $7 award, the
--     one the DoD names; pin 31 is the system half). The radius is wide
--     because a system nomination IS a no-raise award — the arm's normal
--     mode. GREEN BY CONSTRUCTION, named so nobody counts them as
--     coverage: §A's form pins, §G's resolve pins and §I's
--     completion-writer pins never route through the award, and the wire
--     suite's nomination case does not either.
--   * **BREAK PROBE 2 — the E27 rotation skip. AS RUN: 9 of 105 RED**
--     (60, 63, 65–67, 71, 79, 87–88) plus 1 of the wire suite's 3.
--     Dropping `open_slots >= 1` from ARM 2.6's rotation scan lands the
--     rotation on a complete roster (§F) and completion is never reached.
--     Pins 89–91 stay GREEN by construction and are named: the greedy
--     board still FILLS all 24 spots, it just never COMPLETES — pin 88.
--   * **BREAK PROBE 3 — the award's §8.6.8 guard, loosened by ONE DOLLAR**
--     (`price > max_bid` → `price > max_bid + 1`). **AS RUN: 13 of 105
--     RED** (78–80, 82–84, 86–92) and **0 of 3** in the wire suite. Pin 78
--     is the discriminator ($199 lands against a $198 max) and pin 92 is
--     the doctrine's payoff — `draft_auction_solvent` goes FALSE on the
--     finished board. The wire suite is GREEN by construction because its
--     fixture cannot produce an over-max high bid (085's clause refuses
--     one); the state exists only under §H's privileged simulation, which
--     is why the pin lives here and not there.
--   * **ONE UNIT SHORT, EVERYWHERE (D146 / the R320 doctrine).** Every
--     ≥/≤/< comparison 086 makes is bracketed by a pin false by exactly
--     one unit of the thing compared:
--       now() < deadline + grace   → deadline+grace−1s HOLDS the
--                                    nomination, deadline+grace+1s
--                                    nominates (§D, LN seq 1)
--       the 45s freshness constant → a beat 44s before the deadline is
--                                    FRESH and nominates at deadline+1s;
--                                    46s before is STALE and holds (§D,
--                                    LN seq 3 vs seq 4)
--       open_slots >= 1 (rotation) → a 0-slot team is SKIPPED and the
--                                    1-slot team after it is chosen (§F)
--       price <= max_bid (award)   → max_bid awards and leaves solvency
--                                    TRUE at equality; max_bid+1 is
--                                    refused and writes no pick (§H)
--       completion (no slots left) → ONE team holding ONE slot keeps the
--                                    board LIVE; that slot filling
--                                    completes it (§F)
--       K/DST forced-only, auction → remaining = unfilled + 1 still
--                                    defers; remaining = unfilled admits
--                                    (§G), with the SNAKE counterpart in
--                                    the identical state admitting it
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(105);

-- ---------------------------------------------------------------------------
-- A. Function form + grants (§4.1 grants doctrine; plan §8.3; D137)
-- ---------------------------------------------------------------------------
select has_function('public', 'draft_complete_internal', array['uuid'],
  'draft_complete_internal(uuid) exists — THE ONE completion writer (086, extracted from 066)');
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_complete_internal'),
  'draft_complete_internal is SECURITY INVOKER with search_path='''' — the draft_apply_pick_internal posture (its callers are the DEFINER RPCs)');
select ok(
  not has_function_privilege('anon', 'public.draft_complete_internal(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_complete_internal(uuid)', 'EXECUTE'),
  '…and it is TRIPLE revoked (no client consumer exists or will — §4.1)');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_tick'),
  'draft_tick survives its CREATE OR REPLACE still SECURITY DEFINER + search_path='''' (D137)');
select ok(
  not has_function_privilege('anon', 'public.draft_tick()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_tick()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.draft_tick()', 'EXECUTE'),
  '…and 068''s cron/service-only narrowing survives it too');
select ok(
  (select array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_autopick_resolve')
  and not has_function_privilege('authenticated', 'public.draft_autopick_resolve(uuid,uuid)', 'EXECUTE'),
  'draft_autopick_resolve survives its CREATE OR REPLACE with 068''s search_path pin and triple revoke');

-- The ONE-completion-writer structure, pinned at the source (the 065/070
-- inventory-pin pattern): a future session that re-forks the completion arm
-- into either caller fails here rather than at a divergence six months on.
select ok(
  (select p.prosrc like '%draft_complete_internal%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_apply_pick_internal'),
  'draft_apply_pick_internal DELEGATES its completion to draft_complete_internal (no fork — the snake board and the auction award share one writer)');
select ok(
  (select p.prosrc like '%draft_complete_internal%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_tick'),
  '…and so does draft_tick''s ARM 2.6 (the same writer L.C1.5''s draft_end will call for its partial board)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — BEFORE any JWT claims; D49(7)).
--    LN  a7…aa  the seat-class world: 8 teams, 2 draftable slots, $200/min-1,
--               grace 30s. u1 commissions t1; u2 (autodraft) t2; u3 t3;
--               u4 t4; u6 t6; t5/t7/t8 are placeholders (no member row —
--               E48's no-user seats). Sections C, D, E.
--    LR  a7…bb  the rotation/completion world: 8 teams, ONE draftable slot,
--               every seat a placeholder. t2's roster is pre-filled by a
--               privileged pick so the E27 skip is reachable at seq 1. §F.
--    LX  a7…cc  the solvency world: 8 teams, 3 draftable slots. §H.
--    LK  a7…dd  auction resolve world (rb+k starters + 1 bench = 3 slots),
--               live but current_deadline NULL so NO tick arm claims it —
--               resolve() is called directly (022's LA pattern). §G.
--    LS  a7…ee  the SNAKE twin of LK, identical in every other respect. §G.
--    LP  a7…ff  partial-completion world (the C41/draft_end entry). §I.
--    LQ  a7…a1  mock world (the §8.8 zero-side-effect bypass). §I.
--    LT  a7…a2  snake world for the D111(3) NULL half. §I.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('8e000000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-tk26-u' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       ('{"username": "tk26_user_' || i || '"}')::jsonb, now(), now()
from generate_series(1, 6) i;

-- Players. Fractional adp (see the header): the K is the GLOBAL minimum on
-- purpose — §G needs the snake side to reach for it, and every auction
-- fixture here must decline it, which is the hunk under test.
insert into players (id, full_name, position, adp) values
  ('tk26-k01',   'TK26 Kicker 01',  'K',   0.0001),
  ('tk26-dst01', 'TK26 Defense 01', 'DEF', 0.0002);
insert into players (id, full_name, position, adp)
select 'tk26-rb' || lpad(i::text, 2, '0'), 'TK26 RB ' || lpad(i::text, 2, '0'),
       'RB', i / 1000.0
from generate_series(1, 60) i;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings)
values
  ('a7000000-0000-4000-8000-0000000000aa', '8e000000-0000-4000-8000-000000000001',
   'pgtap-tk26-LN-seats', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "manual",
     "draft_order": ["c7000000-0000-4000-8000-00aa00000001","c7000000-0000-4000-8000-00aa00000002",
                     "c7000000-0000-4000-8000-00aa00000003","c7000000-0000-4000-8000-00aa00000004",
                     "c7000000-0000-4000-8000-00aa00000005","c7000000-0000-4000-8000-00aa00000006",
                     "c7000000-0000-4000-8000-00aa00000007","c7000000-0000-4000-8000-00aa00000008"],
     "nomination_order_mode": "same_as_draft_order",
     "auction_budget": 200, "auction_min_bid": 1,
     "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
     "auction_anti_snipe_seconds": 10, "disconnect_grace_seconds": 30,
     "pick_timer_seconds": 90}}'),
  ('a7000000-0000-4000-8000-0000000000bb', '8e000000-0000-4000-8000-000000000001',
   'pgtap-tk26-LR-rotation', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "manual",
     "draft_order": ["c7000000-0000-4000-8000-00bb00000001","c7000000-0000-4000-8000-00bb00000002",
                     "c7000000-0000-4000-8000-00bb00000003","c7000000-0000-4000-8000-00bb00000004",
                     "c7000000-0000-4000-8000-00bb00000005","c7000000-0000-4000-8000-00bb00000006",
                     "c7000000-0000-4000-8000-00bb00000007","c7000000-0000-4000-8000-00bb00000008"],
     "nomination_order_mode": "same_as_draft_order",
     "auction_budget": 200, "auction_min_bid": 1,
     "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
     "auction_anti_snipe_seconds": 10, "disconnect_grace_seconds": 30,
     "pick_timer_seconds": 90}}'),
  ('a7000000-0000-4000-8000-0000000000cc', '8e000000-0000-4000-8000-000000000001',
   'pgtap-tk26-LX-solvency', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "manual",
     "draft_order": ["c7000000-0000-4000-8000-00cc00000001","c7000000-0000-4000-8000-00cc00000002",
                     "c7000000-0000-4000-8000-00cc00000003","c7000000-0000-4000-8000-00cc00000004",
                     "c7000000-0000-4000-8000-00cc00000005","c7000000-0000-4000-8000-00cc00000006",
                     "c7000000-0000-4000-8000-00cc00000007","c7000000-0000-4000-8000-00cc00000008"],
     "nomination_order_mode": "same_as_draft_order",
     "auction_budget": 200, "auction_min_bid": 1,
     "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
     "auction_anti_snipe_seconds": 10, "disconnect_grace_seconds": 30,
     "pick_timer_seconds": 90}}'),
  ('a7000000-0000-4000-8000-0000000000dd', '8e000000-0000-4000-8000-000000000001',
   'pgtap-tk26-LK-auction-resolve', 2026, 'scheduled', 8, null, '{}'),
  ('a7000000-0000-4000-8000-0000000000ee', '8e000000-0000-4000-8000-000000000001',
   'pgtap-tk26-LS-snake-resolve', 2026, 'scheduled', 8, null, '{}'),
  ('a7000000-0000-4000-8000-0000000000a1', '8e000000-0000-4000-8000-000000000001',
   'pgtap-tk26-LQ-mock', 2026, 'scheduled', 8, null, '{}');

-- LP/LT are born in 'drafting', so the D43 guard (059) demands a snapshot ON
-- THE INSERT ITSELF — the trigger fires BEFORE INSERT OR UPDATE, so a
-- snapshot added afterwards is too late (D43: the guard holds even against
-- privileged paths).
insert into leagues (id, owner_id, name, season, status, team_count,
                     scoring_system_id, settings, scoring_rules_snapshot)
values
  ('a7000000-0000-4000-8000-0000000000ff', '8e000000-0000-4000-8000-000000000001',
   'pgtap-tk26-LP-partial', 2026, 'drafting', 8, null, '{}', '{}'::jsonb),
  ('a7000000-0000-4000-8000-0000000000a2', '8e000000-0000-4000-8000-000000000001',
   'pgtap-tk26-LT-snake-complete', 2026, 'drafting', 8, null, '{}', '{}'::jsonb);

-- Roster shapes (D91: rounds = Σ starting-slot counts + bench; IR excluded).
update leagues
set roster_settings = '{"starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                        "bench": 1, "ir_slots": [], "swap_spots": 0}'::jsonb   -- 2 draftable slots
where id = 'a7000000-0000-4000-8000-0000000000aa';
update leagues
set roster_settings = '{"starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                        "bench": 0, "ir_slots": [], "swap_spots": 0}'::jsonb   -- 1 draftable slot
where id = 'a7000000-0000-4000-8000-0000000000bb';
update leagues
set roster_settings = '{"starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                        "bench": 2, "ir_slots": [], "swap_spots": 0}'::jsonb   -- 3 draftable slots
where id = 'a7000000-0000-4000-8000-0000000000cc';
update leagues
set roster_settings = '{"starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1},
                                            {"key": "k",  "label": "K",  "eligible": ["K"],  "count": 1}],
                        "bench": 1, "ir_slots": [], "swap_spots": 0}'::jsonb   -- 3 draftable slots
where id in ('a7000000-0000-4000-8000-0000000000dd',
             'a7000000-0000-4000-8000-0000000000ee');

insert into teams (id, owner_id, name, league_id)
select ('c7000000-0000-4000-8000-00aa000000' || lpad(i::text, 2, '0'))::uuid,
       '8e000000-0000-4000-8000-000000000001', 'pgtap-tk26-LN-t' || i,
       'a7000000-0000-4000-8000-0000000000aa'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c7000000-0000-4000-8000-00bb000000' || lpad(i::text, 2, '0'))::uuid,
       '8e000000-0000-4000-8000-000000000001', 'pgtap-tk26-LR-t' || i,
       'a7000000-0000-4000-8000-0000000000bb'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c7000000-0000-4000-8000-00cc000000' || lpad(i::text, 2, '0'))::uuid,
       '8e000000-0000-4000-8000-000000000001', 'pgtap-tk26-LX-t' || i,
       'a7000000-0000-4000-8000-0000000000cc'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id) values
  ('c7000000-0000-4000-8000-00dd00000001', '8e000000-0000-4000-8000-000000000001',
   'pgtap-tk26-LK-t1', 'a7000000-0000-4000-8000-0000000000dd'),
  ('c7000000-0000-4000-8000-00ee00000001', '8e000000-0000-4000-8000-000000000001',
   'pgtap-tk26-LS-t1', 'a7000000-0000-4000-8000-0000000000ee'),
  ('c7000000-0000-4000-8000-00ff00000001', '8e000000-0000-4000-8000-000000000001',
   'pgtap-tk26-LP-t1', 'a7000000-0000-4000-8000-0000000000ff'),
  ('c7000000-0000-4000-8000-00ff00000002', '8e000000-0000-4000-8000-000000000001',
   'pgtap-tk26-LP-t2', 'a7000000-0000-4000-8000-0000000000ff'),
  ('c7000000-0000-4000-8000-00ff00000003', '8e000000-0000-4000-8000-000000000001',
   'pgtap-tk26-LP-t3', 'a7000000-0000-4000-8000-0000000000ff'),
  ('c7000000-0000-4000-8000-00a100000001', '8e000000-0000-4000-8000-000000000001',
   'pgtap-tk26-LQ-t1', 'a7000000-0000-4000-8000-0000000000a1'),
  ('c7000000-0000-4000-8000-00a200000001', '8e000000-0000-4000-8000-000000000001',
   'pgtap-tk26-LT-t1', 'a7000000-0000-4000-8000-0000000000a2');

-- LN memberships. u1 commissions (t1); u2/u3/u4/u6 manage t2/t3/t4/t6.
-- t5/t7/t8 deliberately have NO member row — E48's no-user seats.
-- No commissioner ever heartbeats this draft, so ARM 1.5's outage arm never
-- establishes supervision and can never pause it (D94's unattended
-- autopilot — the exemption 068's banner records).
insert into league_members (league_id, user_id, team_id, role) values
  ('a7000000-0000-4000-8000-0000000000aa', '8e000000-0000-4000-8000-000000000001',
   'c7000000-0000-4000-8000-00aa00000001', 'commissioner'),
  ('a7000000-0000-4000-8000-0000000000aa', '8e000000-0000-4000-8000-000000000002',
   'c7000000-0000-4000-8000-00aa00000002', 'manager'),
  ('a7000000-0000-4000-8000-0000000000aa', '8e000000-0000-4000-8000-000000000003',
   'c7000000-0000-4000-8000-00aa00000003', 'manager'),
  ('a7000000-0000-4000-8000-0000000000aa', '8e000000-0000-4000-8000-000000000004',
   'c7000000-0000-4000-8000-00aa00000004', 'manager'),
  ('a7000000-0000-4000-8000-0000000000aa', '8e000000-0000-4000-8000-000000000006',
   'c7000000-0000-4000-8000-00aa00000006', 'manager');

insert into drafts (id, league_id, draft_type, status, is_mock, config) values
  ('e7000000-0000-4000-8000-0000000000aa', 'a7000000-0000-4000-8000-0000000000aa',
   'auction', 'scheduled', false, '{}'),
  ('e7000000-0000-4000-8000-0000000000bb', 'a7000000-0000-4000-8000-0000000000bb',
   'auction', 'scheduled', false, '{}'),
  ('e7000000-0000-4000-8000-0000000000cc', 'a7000000-0000-4000-8000-0000000000cc',
   'auction', 'scheduled', false, '{}');

-- LK/LS: fabricated LIVE drafts with current_deadline NULL — no tick arm can
-- claim them (ARM 2/2.6 both require a non-NULL due deadline), so §G's
-- resolve() calls read a state nothing is racing.
insert into drafts (id, league_id, draft_type, status, is_mock, config,
                    total_rounds, current_round, current_pick_number,
                    on_clock_team_id, current_deadline) values
  ('e7000000-0000-4000-8000-0000000000dd', 'a7000000-0000-4000-8000-0000000000dd',
   'auction', 'live', false, '{}', 3, 1, 1,
   'c7000000-0000-4000-8000-00dd00000001', null),
  ('e7000000-0000-4000-8000-0000000000ee', 'a7000000-0000-4000-8000-0000000000ee',
   'snake', 'live', false, '{}', 3, 1, 1,
   'c7000000-0000-4000-8000-00ee00000001', null);

-- LP: an auction mid-board with a LIVE nomination and a FUTURE deadline (so
-- no tick claims it) and 3 of its 24 possible picks made — §I calls the
-- completion writer on it directly, which is exactly the shape L.C1.5's
-- draft_end will hand it.
insert into drafts (id, league_id, draft_type, status, is_mock, config,
                    total_rounds, current_round, current_pick_number,
                    on_clock_team_id, current_nomination, current_deadline) values
  ('e7000000-0000-4000-8000-0000000000ff', 'a7000000-0000-4000-8000-0000000000ff',
   'auction', 'live', false, '{"auction_budget": 200, "auction_min_bid": 1}', 3, 1, 4,
   'c7000000-0000-4000-8000-00ff00000001',
   '{"player_id": "tk26-rb59", "high_bid": 4, "high_bidder_team_id": "c7000000-0000-4000-8000-00ff00000002"}',
   now() + interval '1 hour');
insert into draft_picks (draft_id, league_id, pick_number, round, team_id,
                         player_id, price, is_auto, made_via) values
  ('e7000000-0000-4000-8000-0000000000ff', 'a7000000-0000-4000-8000-0000000000ff',
   1, null, 'c7000000-0000-4000-8000-00ff00000001', 'tk26-rb51', 5, false, 'manager'),
  ('e7000000-0000-4000-8000-0000000000ff', 'a7000000-0000-4000-8000-0000000000ff',
   2, null, 'c7000000-0000-4000-8000-00ff00000002', 'tk26-rb52', 3, true,  'autopick'),
  ('e7000000-0000-4000-8000-0000000000ff', 'a7000000-0000-4000-8000-0000000000ff',
   3, null, 'c7000000-0000-4000-8000-00ff00000003', 'tk26-rb53', 1, true,  'autopick');

-- LQ: a live MOCK (on_clock NULL + no deadline ⇒ no arm claims it).
insert into drafts (id, league_id, draft_type, status, is_mock, config,
                    total_rounds, on_clock_team_id, current_deadline) values
  ('e7000000-0000-4000-8000-0000000000a1', 'a7000000-0000-4000-8000-0000000000a1',
   'auction', 'live', true, '{"auction_budget": 200, "auction_min_bid": 1}', 3, null, null);
insert into draft_picks (draft_id, league_id, pick_number, round, team_id,
                         player_id, price, is_auto, made_via) values
  ('e7000000-0000-4000-8000-0000000000a1', 'a7000000-0000-4000-8000-0000000000a1',
   1, null, 'c7000000-0000-4000-8000-00a100000001', 'tk26-rb54', 9, true, 'autopick'),
  ('e7000000-0000-4000-8000-0000000000a1', 'a7000000-0000-4000-8000-0000000000a1',
   2, null, 'c7000000-0000-4000-8000-00a100000001', 'tk26-rb55', 2, true, 'autopick');

-- LT: a SNAKE board (price NULL on every row — the D111(3) NULL half).
insert into drafts (id, league_id, draft_type, status, is_mock, config,
                    total_rounds, on_clock_team_id, current_deadline) values
  ('e7000000-0000-4000-8000-0000000000a2', 'a7000000-0000-4000-8000-0000000000a2',
   'snake', 'live', false, '{"pick_timer_seconds": 90}', 2, null, null);
insert into draft_picks (draft_id, league_id, pick_number, round, team_id,
                         player_id, price, is_auto, made_via) values
  ('e7000000-0000-4000-8000-0000000000a2', 'a7000000-0000-4000-8000-0000000000a2',
   1, 1, 'c7000000-0000-4000-8000-00a200000001', 'tk26-rb56', null, false, 'manager'),
  ('e7000000-0000-4000-8000-0000000000a2', 'a7000000-0000-4000-8000-0000000000a2',
   2, 1, 'c7000000-0000-4000-8000-00a200000001', 'tk26-rb57', null, true,  'autopick');

-- ---------------------------------------------------------------------------
-- C. ARM 2 NO LONGER SNAKE-AUTOPICKS AN AUCTION (the measured defect —
--    086's banner records the probe that produced it on main @ 9c81f7c).
-- ---------------------------------------------------------------------------
select is(
  (public.draft_start_internal('a7000000-0000-4000-8000-0000000000aa', false)->>'started')::boolean,
  true,
  'LN: the auction starts (084''s arm) — t1 on the clock to nominate at sequence 1');

-- t1's manager (the commissioner) NEVER heartbeats this draft, so the seat is
-- unconditionally STALE and the D129(3) grace hold is in play at both sides
-- of its boundary. (No commissioner heartbeat also means ARM 1.5 can never
-- establish supervision, so the outage arm cannot pause LN mid-file — 068's
-- never-connected exemption, D94's unattended autopilot.)
update drafts set current_deadline = now() - interval '29 seconds'
where id = 'e7000000-0000-4000-8000-0000000000aa';
select set_config('pgtap.tk26_c0', public.draft_tick()::text, true);
select ok(
  (select current_nomination is null from drafts where id = 'e7000000-0000-4000-8000-0000000000aa'),
  'GRACE BOUNDARY, one unit short: at deadline + grace − 1s a STALE human seat''s nomination is HELD OPEN (grace 30s — D102''s contract carried to the nomination clock, D129(3))');
select is(
  (current_setting('pgtap.tk26_c0')::jsonb->>'auction_held_for_grace')::int,
  1,
  '…and the tick summary counted the hold rather than silently skipping the draft');
select is(
  (select count(*) from draft_bids where draft_id = 'e7000000-0000-4000-8000-0000000000aa'),
  0::bigint,
  '…a held nomination writes NOTHING — no phantom opening bid, no pick');

-- One second the other side of the same boundary. This is ALSO the exact
-- state that, before 086, handed the on-clock team a free player through
-- ARM 2 (see the migration banner's measured probe).
update drafts set current_deadline = now() - interval '31 seconds'
where id = 'e7000000-0000-4000-8000-0000000000aa';
select set_config('pgtap.tk26_c1', public.draft_tick()::text, true);
select is(
  (current_setting('pgtap.tk26_c1')::jsonb->>'auction_held_for_grace')::int,
  0,
  'GRACE BOUNDARY, the other side: at deadline + grace + 1s the hold is over');

select is(
  (select count(*) from draft_picks
   where draft_id = 'e7000000-0000-4000-8000-0000000000aa'),
  0::bigint,
  'ARM 2 wrote NO pick on the auction — the pre-086 behaviour (draft_picks round=1, price=NULL, is_auto=t) is gone');
select is(
  (select current_pick_number from drafts
   where id = 'e7000000-0000-4000-8000-0000000000aa'),
  1,
  '…and current_pick_number is still 1 — nothing advanced it through draft_apply_pick_internal''s snake path');
select ok(
  (current_setting('pgtap.tk26_c1')::jsonb->>'auction_claimed_due')::int >= 1
  and (current_setting('pgtap.tk26_c1')::jsonb->>'auction_nominated')::int >= 1,
  'the AUCTION arm claimed it and system-nominated instead (the tick summary''s new counters)');
select is(
  current_setting('pgtap.tk26_c1')::jsonb->>'auction_failures',
  '[]',
  '…with no recorded auction failure');

-- ---------------------------------------------------------------------------
-- D. NOMINATION TIMEOUT — every seat class, both grace branches, the 45s
--    constant from both sides, and F62's system opening-bid row.
--    (§C's tick already produced seq 1's nomination for t1, a STALE human
--    seat pushed past deadline + grace; §D re-walks the boundary below.)
-- ---------------------------------------------------------------------------
select is(
  (select current_nomination->>'player_id' || '|' || (current_nomination->>'high_bid')
          || '|' || (current_nomination->>'high_bidder_team_id')
   from drafts where id = 'e7000000-0000-4000-8000-0000000000aa'),
  'tk26-rb01|1|c7000000-0000-4000-8000-00aa00000001',
  'seq 1: the SYSTEM nomination opened on the resolve chain''s player at the $1 minimum, with the NOMINATOR as high bidder (D129(2)/§8.6.7(e))');
select is(
  (select on_clock_team_id from drafts where id = 'e7000000-0000-4000-8000-0000000000aa'),
  'c7000000-0000-4000-8000-00aa00000001'::uuid,
  '…on_clock stays the NOMINATOR through the bidding phase (D157(2) — the seat the rotation advances FROM)');
select is(
  (select current_deadline from drafts where id = 'e7000000-0000-4000-8000-0000000000aa'),
  now() + interval '30 seconds',
  '…and the BID clock is auction_bid_seconds (30s) from the server instant, not the nomination clock');

-- F62 — DISCHARGED: the system nomination writes an opening draft_bids row
-- with a NULL action_id (the reason C39 made the column NULLable).
select is(
  (select nomination_seq::text || '|' || player_id || '|' || team_id::text
          || '|' || amount::text || '|' || coalesce(action_id::text, 'NULL')
   from draft_bids where draft_id = 'e7000000-0000-4000-8000-0000000000aa'),
  '1|tk26-rb01|c7000000-0000-4000-8000-00aa00000001|1|NULL',
  'F62: the system nomination opened with a draft_bids row — nomination_seq 1, the minimum bid, action_id NULL (§12.5''s one uniform history)');
select is(
  (select count(*) from draft_bids where draft_id = 'e7000000-0000-4000-8000-0000000000aa'),
  1::bigint,
  '…exactly one row: a nomination opens with ONE opening bid, never zero and never two');

-- The award of seq 1. t1 is STALE and never heartbeats — and the BID clock
-- gets NO grace (D129(4)/§8.6.5): nobody is auto-bid for, so nobody can be
-- timed into one, and a stale nominator delays nothing.
update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000aa';
select set_config('pgtap.tk26_d1', public.draft_tick()::text, true);
select is(
  (select pick_number::text || '|' || coalesce(round::text, 'NULL') || '|' || team_id::text
          || '|' || player_id || '|' || price::text || '|' || is_auto::text
          || '|' || made_via || '|' || coalesce(picked_by::text, 'NULL')
          || '|' || coalesce(action_id::text, 'NULL')
   from draft_picks where draft_id = 'e7000000-0000-4000-8000-0000000000aa'),
  '1|NULL|c7000000-0000-4000-8000-00aa00000001|tk26-rb01|1|true|autopick|NULL|NULL',
  'seq 1 AWARD: §12.4''s auction shape — round NULL (D126), price set, is_auto/autopick (the opening row carried action_id NULL), picked_by and action_id NULL (the clock wrote it)');
select is(
  (current_setting('pgtap.tk26_d1')::jsonb->>'auction_held_for_grace')::int,
  0,
  '…and the BID clock took NO grace hold despite a STALE nominator (D129(4): the grace contract is a NOMINATION-clock rule)');
select is(
  (select current_pick_number::text || '|' || current_round::text || '|' || on_clock_team_id::text
          || '|' || coalesce(current_nomination::text, 'NULL')
   from drafts where id = 'e7000000-0000-4000-8000-0000000000aa'),
  '2|1|c7000000-0000-4000-8000-00aa00000002|NULL',
  '…the rotation advanced to t2 at sequence 2, back in the NOMINATING phase (D126), still on lap 1');
select is(
  (select current_deadline from drafts where id = 'e7000000-0000-4000-8000-0000000000aa'),
  now() + interval '45 seconds',
  '…on a fresh auction_nomination_seconds clock (45s), not the bid clock');
select is(
  (select b.remaining::text || '|' || b.open_slots::text || '|' || b.max_bid::text || '|' || b.committed::text
   from public.draft_team_budget('e7000000-0000-4000-8000-0000000000aa',
                                 'c7000000-0000-4000-8000-00aa00000001') b),
  '199|1|199|1',
  '…and the award MOVED MONEY through the ONE derivation family: $1 committed, 1 slot left, max bid $199 (D127/§8.6.1)');
select ok(
  public.draft_auction_solvent('e7000000-0000-4000-8000-0000000000aa'),
  '…§8.6.8 still holds after the first award');

-- seq 2 — t2 is is_autodraft AND stale: it nominates AT the deadline, with
-- no grace hold (the branch discriminator, §8.4/D102).
update league_members set is_autodraft = true
where league_id = 'a7000000-0000-4000-8000-0000000000aa'
  and user_id = '8e000000-0000-4000-8000-000000000002';
update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000aa';
select set_config('pgtap.tk26_d2', public.draft_tick()::text, true);
select is(
  (select current_nomination->>'high_bidder_team_id'
   from drafts where id = 'e7000000-0000-4000-8000-0000000000aa'),
  'c7000000-0000-4000-8000-00aa00000002',
  'seq 2: an is_autodraft seat system-nominates AT the deadline even though it is STALE (no grace — §8.4)');
select is(
  (current_setting('pgtap.tk26_d2')::jsonb->>'auction_held_for_grace')::int,
  0,
  '…the tick recorded no hold for it');
update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000aa';
select set_config('pgtap.tk26_d2b', public.draft_tick()::text, true);
select is(
  (select team_id::text || '|' || player_id || '|' || price::text
   from draft_picks where draft_id = 'e7000000-0000-4000-8000-0000000000aa' and pick_number = 2),
  'c7000000-0000-4000-8000-00aa00000002|tk26-rb02|1',
  '…and its no-raise nomination awards back to it at the opening bid (E26/§8.6.7(b))');

-- seq 3 — t3's manager beat 44s before the deadline: FRESH by one second,
-- so it nominates AT the deadline (the 45s constant, side one).
insert into draft_liveness (draft_id, user_id, last_seen_at) values
  ('e7000000-0000-4000-8000-0000000000aa', '8e000000-0000-4000-8000-000000000003',
   now() - interval '45 seconds');
update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000aa';
select set_config('pgtap.tk26_d3', public.draft_tick()::text, true);
select is(
  (select current_nomination->>'high_bidder_team_id'
   from drafts where id = 'e7000000-0000-4000-8000-0000000000aa'),
  'c7000000-0000-4000-8000-00aa00000003',
  'seq 3: a beat 44s BEFORE the deadline is FRESH as of the deadline (R132) — the seat nominates at deadline+1s, no hold');
select is(
  (current_setting('pgtap.tk26_d3')::jsonb->>'auction_held_for_grace')::int,
  0,
  '…the tick recorded no hold for the fresh seat either');
update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000aa';
select lives_ok(
  $$ select public.draft_tick() $$,
  '…and its nomination closes on the next tick');

-- seq 4 — t4's manager beat 46s before the deadline: STALE by one second,
-- so it is HELD (the 45s constant, side two — one unit short of side one).
insert into draft_liveness (draft_id, user_id, last_seen_at) values
  ('e7000000-0000-4000-8000-0000000000aa', '8e000000-0000-4000-8000-000000000004',
   now() - interval '47 seconds');
update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000aa';
select set_config('pgtap.tk26_d4', public.draft_tick()::text, true);
select ok(
  (select current_nomination is null from drafts where id = 'e7000000-0000-4000-8000-0000000000aa'),
  'seq 4: a beat 46s BEFORE the deadline is STALE — the nomination is HELD OPEN, exactly one second the other side of the 45s constant');
select is(
  (current_setting('pgtap.tk26_d4')::jsonb->>'auction_held_for_grace')::int,
  1,
  '…and the tick summary counted the hold (the D102 contract carried to the nomination clock — D129(3))');
select is(
  (select count(*) from draft_bids
   where draft_id = 'e7000000-0000-4000-8000-0000000000aa' and nomination_seq = 4),
  0::bigint,
  '…a held nomination writes NOTHING at sequence 4 either — no phantom opening bid');

-- Advance the fixture past seq 4. NOTE the freshness window MOVES WITH THE
-- DEADLINE (it is measured as of the deadline instant — R132), so simply
-- rewinding further would make u4''s 47s-old beat FRESH again relative to the
-- new deadline and it would nominate for the wrong reason. Drop the beat to
-- make the seat unconditionally stale, then step past deadline + grace.
delete from draft_liveness
where draft_id = 'e7000000-0000-4000-8000-0000000000aa'
  and user_id = '8e000000-0000-4000-8000-000000000004';
update drafts set current_deadline = now() - interval '31 seconds'
where id = 'e7000000-0000-4000-8000-0000000000aa';
select set_config('pgtap.tk26_d6', public.draft_tick()::text, true);
select is(
  (select current_nomination->>'high_bidder_team_id'
   from drafts where id = 'e7000000-0000-4000-8000-0000000000aa'),
  'c7000000-0000-4000-8000-00aa00000004',
  '…and with no beat at all, past deadline + grace, the seat system-nominates (the §C boundary re-reached from a second seat)');
update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000aa';
select lives_ok(
  $$ select public.draft_tick() $$,
  '…seq 4 closes');

-- seq 5 — t5 is a NO-USER placeholder seat: E48's autopilot, at the
-- deadline, no grace.
update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000aa';
select set_config('pgtap.tk26_d7', public.draft_tick()::text, true);
select is(
  (select current_nomination->>'high_bidder_team_id'
   from drafts where id = 'e7000000-0000-4000-8000-0000000000aa'),
  'c7000000-0000-4000-8000-00aa00000005',
  'seq 5: a NO-USER placeholder seat system-nominates AT the deadline (E48 autopilot — no user, no grace)');
select is(
  (current_setting('pgtap.tk26_d7')::jsonb->>'auction_held_for_grace')::int,
  0,
  '…with no hold: there is no manager to wait for');
update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000aa';
select lives_ok(
  $$ select public.draft_tick() $$,
  '…seq 5 closes; the board now stands at five awards and t6 on the clock');
select is(
  (select count(*)::text || '|' || current_pick_number::text || '|' || on_clock_team_id::text
   from draft_picks p, drafts d
   where d.id = 'e7000000-0000-4000-8000-0000000000aa' and p.draft_id = d.id
   group by d.current_pick_number, d.on_clock_team_id),
  '5|6|c7000000-0000-4000-8000-00aa00000006',
  'five system nominations, five awards, sequence 6 open with t6 nominating — every seat class walked');

-- ---------------------------------------------------------------------------
-- E. THE AWARD'S ATTRIBUTION RULE, all three actors (D130 "per actor"),
--    with the E26 golden the task's DoD names.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8e000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_nominate('e7000000-0000-4000-8000-0000000000aa',
       'tk26-rb20', 7, 'a8000000-0000-4000-8000-000000000001') $$,
  'seq 6: t6''s manager nominates MANUALLY at an opening bid of $7 (085''s verb)');
reset role;
update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000aa';
select lives_ok($$ select public.draft_tick() $$, '…and the bid clock expires with no raises');
select is(
  (select team_id::text || '|' || player_id || '|' || price::text || '|' || is_auto::text
          || '|' || made_via || '|' || coalesce(round::text, 'NULL')
   from draft_picks where draft_id = 'e7000000-0000-4000-8000-0000000000aa' and pick_number = 6),
  'c7000000-0000-4000-8000-00aa00000006|tk26-rb20|7|false|manager|NULL',
  'E26 GOLDEN (§8.6.7(b)): opening $7, no raises → the NOMINATOR wins at $7 — and because a HUMAN opened it the row is is_auto=false / made_via=manager');
select is(
  (select b.remaining::text || '|' || b.open_slots::text || '|' || b.max_bid::text
   from public.draft_team_budget('e7000000-0000-4000-8000-0000000000aa',
                                 'c7000000-0000-4000-8000-00aa00000006') b),
  '193|1|193',
  '…and $7 left t6''s budget through the ONE family, not a stored counter (D127)');

-- seq 7 — a SYSTEM nomination RAISED by a human: the winner is the raiser
-- and the row is a manager row, because attribution reads the WINNING bid.
update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000aa';
select lives_ok($$ select public.draft_tick() $$, 'seq 7: t7 (placeholder) is system-nominated');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8e000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_place_bid('e7000000-0000-4000-8000-0000000000aa', 5,
       'a8000000-0000-4000-8000-000000000002', 7, 'tk26-rb06') $$,
  '…and t6''s manager RAISES to $5 with the R330 identity pair');
reset role;
update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000aa';
select lives_ok($$ select public.draft_tick() $$, '…the bid clock expires');
select is(
  (select team_id::text || '|' || player_id || '|' || price::text || '|' || is_auto::text || '|' || made_via
   from draft_picks where draft_id = 'e7000000-0000-4000-8000-0000000000aa' and pick_number = 7),
  'c7000000-0000-4000-8000-00aa00000006|tk26-rb06|5|false|manager',
  'ATTRIBUTION, third actor: a SYSTEM nomination won by a HUMAN raise is the raiser''s pick at the raise price, is_auto=false / made_via=manager (the winning draft_bids row decides — D130)');
select is(
  (select on_clock_team_id from drafts where id = 'e7000000-0000-4000-8000-0000000000aa'),
  'c7000000-0000-4000-8000-00aa00000008'::uuid,
  'the rotation advanced from the NOMINATOR (t7 → t8), NOT from the winner (t6) — D157(2)/D130');
select is(
  (select current_round from drafts where id = 'e7000000-0000-4000-8000-0000000000aa'),
  1,
  '…still lap 1: the scan did not wrap');
select ok(
  public.draft_auction_solvent('e7000000-0000-4000-8000-0000000000aa'),
  '…and §8.6.8 holds across a mixed board of system and human awards');

-- t6 is now FULL (2 of 2). The next lap must skip it — pinned on LR below,
-- where the skip is reachable at the first award instead of the thirteenth.
select is(
  (select b.open_slots from public.draft_team_budget(
     'e7000000-0000-4000-8000-0000000000aa', 'c7000000-0000-4000-8000-00aa00000006') b),
  0,
  't6''s roster is complete after two buys — the E27 state whose rotation consequence §F pins');

-- ---------------------------------------------------------------------------
-- F. LR — THE ROTATION SKIP (E27/§8.6.7(c)) AND THE PRICED COMPLETION.
--    t2's roster is pre-filled by a privileged pick so the skip is reachable
--    at sequence 1: the rotation must step OVER a 0-slot team and land on
--    the 1-slot team behind it — the D146 pair on `open_slots >= 1`.
-- ---------------------------------------------------------------------------
select is(
  (public.draft_start_internal('a7000000-0000-4000-8000-0000000000bb', false)->>'started')::boolean,
  true,
  'LR: a one-slot-per-team auction starts');
insert into draft_picks (draft_id, league_id, pick_number, round, team_id,
                         player_id, price, is_auto, made_via) values
  ('e7000000-0000-4000-8000-0000000000bb', 'a7000000-0000-4000-8000-0000000000bb',
   100, null, 'c7000000-0000-4000-8000-00bb00000002', 'tk26-rb40', 10, false, 'manager');
select is(
  (select (select b.open_slots from public.draft_team_budget(
             'e7000000-0000-4000-8000-0000000000bb', 'c7000000-0000-4000-8000-00bb00000002') b)::text
       || '|' ||
   (select b.open_slots from public.draft_team_budget(
             'e7000000-0000-4000-8000-0000000000bb', 'c7000000-0000-4000-8000-00bb00000003') b)::text),
  '0|1',
  'LR fixture: t2 has ZERO open slots and t3 has exactly ONE — the one-unit pair the rotation scan must separate');

update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000bb';
select lives_ok($$ select public.draft_tick() $$, 'LR seq 1: t1 is system-nominated');
update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000bb';
select lives_ok($$ select public.draft_tick() $$, '…and awarded');
select is(
  (select on_clock_team_id from drafts where id = 'e7000000-0000-4000-8000-0000000000bb'),
  'c7000000-0000-4000-8000-00bb00000003'::uuid,
  'E27 SKIP (§8.6.7(c)): the rotation stepped over the complete t2 and landed on t3');
select is(
  (select current_pick_number from drafts where id = 'e7000000-0000-4000-8000-0000000000bb'),
  2,
  '…the nomination sequence advanced by ONE, not by the number of teams skipped');

-- Drive LR to ONE SLOT SHORT of completion (t1, t3–t7 bought; t8 open).
do $$
declare v_status text; v_picks int; v_i int;
begin
  for v_i in 1..40 loop
    select count(*) into v_picks from public.draft_picks
    where draft_id = 'e7000000-0000-4000-8000-0000000000bb' and is_undone = false;
    exit when v_picks >= 7;
    update public.drafts set current_deadline = now() - interval '1 second'
    where id = 'e7000000-0000-4000-8000-0000000000bb' and status = 'live';
    perform public.draft_tick();
    select status into v_status from public.drafts
    where id = 'e7000000-0000-4000-8000-0000000000bb';
    exit when v_status <> 'live';
  end loop;
end $$;
select is(
  (select status from drafts where id = 'e7000000-0000-4000-8000-0000000000bb'),
  'live',
  'COMPLETION, one unit short: with exactly ONE roster slot left in the whole league the draft is STILL live');
select is(
  (select count(*) from teams t
   cross join lateral public.draft_team_budget('e7000000-0000-4000-8000-0000000000bb', t.id) b
   where t.league_id = 'a7000000-0000-4000-8000-0000000000bb' and b.open_slots >= 1),
  1::bigint,
  '…and exactly one franchise still holds it (t8) — the completion condition is false by exactly one slot');
select is(
  (select status from leagues where id = 'a7000000-0000-4000-8000-0000000000bb'),
  'drafting',
  '…the league has NOT transitioned yet');

do $$
declare v_status text; v_i int;
begin
  for v_i in 1..10 loop
    update public.drafts set current_deadline = now() - interval '1 second'
    where id = 'e7000000-0000-4000-8000-0000000000bb' and status = 'live';
    perform public.draft_tick();
    select status into v_status from public.drafts
    where id = 'e7000000-0000-4000-8000-0000000000bb';
    exit when v_status = 'complete';
  end loop;
end $$;
select is(
  (select status || '|' || coalesce(on_clock_team_id::text, 'NULL')
          || '|' || coalesce(current_deadline::text, 'NULL')
          || '|' || coalesce(current_nomination::text, 'NULL')
          || '|' || (completed_at is not null)::text
   from drafts where id = 'e7000000-0000-4000-8000-0000000000bb'),
  'complete|NULL|NULL|NULL|true',
  'COMPLETION: that last slot filling ends the draft — cleared clock, cleared nomination, completed_at stamped (§8.6.6/D130)');
select is(
  (select status from leagues where id = 'a7000000-0000-4000-8000-0000000000bb'),
  'in_season',
  '…and the league flipped to in_season in the same transaction (§8.5 step 6 via the ONE completion writer)');
select is(
  (select count(*) from league_rosters where league_id = 'a7000000-0000-4000-8000-0000000000bb'),
  8::bigint,
  '…with one league_rosters row per franchise');
select is(
  (select count(*) from league_rosters r
   join draft_picks p on p.league_id = r.league_id and p.player_id = r.player_id
   where r.league_id = 'a7000000-0000-4000-8000-0000000000bb'
     and p.draft_id = 'e7000000-0000-4000-8000-0000000000bb'
     and (r.acquisition_cost is distinct from p.price
          or r.acquisition_type <> 'draft'
          or r.team_id <> p.team_id)),
  0::bigint,
  'D111(3)/§12.7: EVERY roster row carries acquisition_cost = its pick''s price (including the $10 privileged row) with acquisition_type ''draft'' — zero mismatches');
select is(
  (select count(*) from league_rosters
   where league_id = 'a7000000-0000-4000-8000-0000000000bb' and acquisition_cost is null),
  0::bigint,
  '…and NOT ONE auction roster row was written with a NULL cost (the pre-086 snake literal)');
select ok(
  public.draft_auction_solvent('e7000000-0000-4000-8000-0000000000bb'),
  '…§8.6.8 holds on the completed board');
select is(
  (select count(*) from draft_bids
   where draft_id = 'e7000000-0000-4000-8000-0000000000bb' and action_id is null),
  7::bigint,
  'F62 at board scale: seven system nominations, seven opening bid rows, every one with a NULL action_id');

-- ---------------------------------------------------------------------------
-- G. K/DST DEFERRAL — the auction is FORCED-ONLY (D129(2)); the snake keeps
--    its round window. Same league shape, same pool, same picks; the ONLY
--    difference between LK and LS is draft_type, which is the hunk.
-- ---------------------------------------------------------------------------
select is(
  public.draft_autopick_resolve('e7000000-0000-4000-8000-0000000000ee',
                                'c7000000-0000-4000-8000-00ee00000001'),
  'tk26-k01',
  'SNAKE control: at round 1 of 3 the E30 window is open (current_round > total_rounds − 3), so the lowest-ADP player — a KICKER — is resolved. 022''s behaviour, unchanged by 086');
select is(
  public.draft_autopick_resolve('e7000000-0000-4000-8000-0000000000dd',
                                'c7000000-0000-4000-8000-00dd00000001'),
  'tk26-rb01',
  'AUCTION, identical state: the kicker is DEFERRED and an RB is resolved — the round window is snake/linear''s only (D129(2))');

insert into draft_picks (draft_id, league_id, pick_number, round, team_id,
                         player_id, price, is_auto, made_via) values
  ('e7000000-0000-4000-8000-0000000000dd', 'a7000000-0000-4000-8000-0000000000dd',
   1, null, 'c7000000-0000-4000-8000-00dd00000001', 'tk26-rb30', 1, true, 'autopick');
select is(
  public.draft_autopick_resolve('e7000000-0000-4000-8000-0000000000dd',
                                'c7000000-0000-4000-8000-00dd00000001'),
  'tk26-rb01',
  'ONE UNIT SHORT of FORCED (remaining 2 vs unfilled 1): the auction seat still declines the kicker and takes an RB');
insert into draft_picks (draft_id, league_id, pick_number, round, team_id,
                         player_id, price, is_auto, made_via) values
  ('e7000000-0000-4000-8000-0000000000dd', 'a7000000-0000-4000-8000-0000000000dd',
   2, null, 'c7000000-0000-4000-8000-00dd00000001', 'tk26-rb31', 1, true, 'autopick');
select is(
  public.draft_autopick_resolve('e7000000-0000-4000-8000-0000000000dd',
                                'c7000000-0000-4000-8000-00dd00000001'),
  'tk26-k01',
  'FORCED (remaining 1 = unfilled 1, a K seat among them): the deferral lifts and the kicker is resolved — exactly one unit the other side (D129(2)''s forced-only arm)');

-- ---------------------------------------------------------------------------
-- H. LX — §8.6.8 AT THE AWARD, one dollar either side (D146), the F62
--    load-bearing half, and the "budgets exhausted is unreachable" spot
--    check (D130): a team that spends to its ceiling still fills a legal
--    roster at the minimum bid.
-- ---------------------------------------------------------------------------
select is(
  (public.draft_start_internal('a7000000-0000-4000-8000-0000000000cc', false)->>'started')::boolean,
  true,
  'LX: a three-slot auction starts ($200/min-1 ⇒ max bid $198)');
update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000cc';
select lives_ok($$ select public.draft_tick() $$, 'LX seq 1: t1 is system-nominated at $1');

-- A privileged "simulated over-bid" — the state 085's max-bid clause refuses
-- to create, built by hand exactly as 034 builds its simulated closes, so
-- the AWARD's own guard is the only thing under test.
update draft_bids set amount = 199
where draft_id = 'e7000000-0000-4000-8000-0000000000cc' and nomination_seq = 1;
update drafts
set current_nomination = jsonb_set(current_nomination, '{high_bid}', '199'::jsonb)
where id = 'e7000000-0000-4000-8000-0000000000cc';
update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000cc';
select set_config('pgtap.tk26_h1', public.draft_tick()::text, true);
select is(
  (select count(*) from draft_picks where draft_id = 'e7000000-0000-4000-8000-0000000000cc'),
  0::bigint,
  'AWARD SOLVENCY GUARD, one dollar OVER (max_bid $198, high bid $199): NO pick is written — the never-weaken invariant refuses rather than records an unaffordable buy');
select ok(
  current_setting('pgtap.tk26_h1')::jsonb->'auction_failures'->0->>'error'
    like '%would break §8.6.8 solvency%',
  '…and the refusal is LOUD in the tick summary, naming the invariant (never a silent skip — CLAUDE.md)');
select ok(
  (select current_nomination is not null from drafts where id = 'e7000000-0000-4000-8000-0000000000cc'),
  '…the nomination is left standing for a commissioner to cancel, not silently voided');

update draft_bids set amount = 198
where draft_id = 'e7000000-0000-4000-8000-0000000000cc' and nomination_seq = 1;
update drafts
set current_nomination = jsonb_set(current_nomination, '{high_bid}', '198'::jsonb)
where id = 'e7000000-0000-4000-8000-0000000000cc';
update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000cc';
select lives_ok($$ select public.draft_tick() $$, 'the same nomination at EXACTLY max_bid ($198)');
select is(
  (select price from draft_picks
   where draft_id = 'e7000000-0000-4000-8000-0000000000cc' and pick_number = 1),
  198,
  'AWARD SOLVENCY GUARD, one dollar UNDER: at exactly max_bid the award LANDS — a clause tightened by a dollar would refuse here');
select is(
  (select b.remaining::text || '|' || b.open_slots::text || '|' || b.max_bid::text
   from public.draft_team_budget('e7000000-0000-4000-8000-0000000000cc',
                                 'c7000000-0000-4000-8000-00cc00000001') b),
  '2|2|1',
  '…leaving the winner EXACTLY on the §8.6.8 floor: $2 for 2 slots at a $1 minimum (this is what max_bid means — §8.6.1)');
select ok(
  public.draft_auction_solvent('e7000000-0000-4000-8000-0000000000cc'),
  '…and solvency is TRUE at that equality — the consequence 085''s bid clause exists to guarantee');

-- F62's LOAD-BEARING half: with the opening row deleted, the award has no
-- attribution source and refuses rather than guessing.
update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000cc';
select lives_ok($$ select public.draft_tick() $$, 'LX seq 2: t2 is system-nominated');
delete from draft_bids
where draft_id = 'e7000000-0000-4000-8000-0000000000cc' and nomination_seq = 2;
update drafts set current_deadline = now() - interval '1 second'
where id = 'e7000000-0000-4000-8000-0000000000cc';
select set_config('pgtap.tk26_h2', public.draft_tick()::text, true);
select is(
  (select count(*) from draft_picks where draft_id = 'e7000000-0000-4000-8000-0000000000cc'),
  1::bigint,
  'F62 IS LOAD-BEARING: with the nomination''s opening draft_bids row removed, the award writes nothing');
select ok(
  current_setting('pgtap.tk26_h2')::jsonb->'auction_failures'->0->>'error'
    like '%no draft_bids row backs the live high bid%',
  '…refusing by name rather than defaulting the attribution (the invariant is enforced, not merely pinned)');
insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
select 'e7000000-0000-4000-8000-0000000000cc', 'a7000000-0000-4000-8000-0000000000cc',
       2, d.current_nomination->>'player_id',
       (d.current_nomination->>'high_bidder_team_id')::uuid,
       (d.current_nomination->>'high_bid')::int, null
from drafts d where d.id = 'e7000000-0000-4000-8000-0000000000cc';

-- Drive LX to completion: t1 has $2 left for 2 slots and must still fill
-- them. §8.6.6's "or budgets exhausted" is unreachable by construction.
do $$
declare v_status text; v_i int;
begin
  for v_i in 1..120 loop
    update public.drafts set current_deadline = now() - interval '1 second'
    where id = 'e7000000-0000-4000-8000-0000000000cc' and status = 'live';
    perform public.draft_tick();
    select status into v_status from public.drafts
    where id = 'e7000000-0000-4000-8000-0000000000cc';
    exit when v_status = 'complete';
  end loop;
end $$;
select is(
  (select status from drafts where id = 'e7000000-0000-4000-8000-0000000000cc'),
  'complete',
  'GREEDY-SPEND PROPERTY (D130): a board where one team bought at its ceiling still runs to completion — "budgets exhausted" (§8.6.6) is unreachable');
select is(
  (select count(*) from draft_picks
   where draft_id = 'e7000000-0000-4000-8000-0000000000cc' and is_undone = false),
  24::bigint,
  '…all 8 × 3 roster spots filled — every team completed a LEGAL roster (the §18 Phase C gate''s own sentence)');
select is(
  (select count(*) from teams t
   cross join lateral public.draft_team_budget('e7000000-0000-4000-8000-0000000000cc', t.id) b
   where t.league_id = 'a7000000-0000-4000-8000-0000000000cc' and b.open_slots <> 0),
  0::bigint,
  '…with no franchise left holding an open slot');
select is(
  (select sum(price)::int from draft_picks
   where draft_id = 'e7000000-0000-4000-8000-0000000000cc'
     and team_id = 'c7000000-0000-4000-8000-00cc00000001'),
  200,
  '…and the ceiling-spender''s three buys total exactly its $200 budget ($198 + $1 + $1) — it never overspent and never stalled');
select ok(
  public.draft_auction_solvent('e7000000-0000-4000-8000-0000000000cc'),
  '…§8.6.8 holds on the completed greedy board');
select is(
  (select count(*) from draft_picks
   where draft_id = 'e7000000-0000-4000-8000-0000000000cc' and price < 1),
  0::bigint,
  '…and every price is at or above the $1 minimum bid (§7.3.8)');

-- ---------------------------------------------------------------------------
-- I. THE COMPLETION WRITER ITSELF — the partial board L.C1.5's draft_end
--    hands it (C41's end-as-is), the §8.8 mock bypass, and D111(3)'s NULL
--    half on a snake row.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.draft_complete_internal('e7000000-0000-4000-8000-0000000000ff') $$,
  'LP: the completion writer accepts a PARTIAL board — 3 of 24 spots filled, a LIVE nomination standing (C41''s end-as-is entry, L.C1.5''s draft_end)');
select is(
  (select status || '|' || coalesce(on_clock_team_id::text, 'NULL')
          || '|' || coalesce(current_deadline::text, 'NULL')
          || '|' || coalesce(current_nomination::text, 'NULL')
   from drafts where id = 'e7000000-0000-4000-8000-0000000000ff'),
  'complete|NULL|NULL|NULL',
  '…the live nomination is CLEARED with the clock (no ghost nomination survives a completed board)');
select is(
  (select count(*) from league_rosters where league_id = 'a7000000-0000-4000-8000-0000000000ff'),
  3::bigint,
  '…exactly three roster rows: unfilled slots stay EMPTY rather than being invented (C41 ruled — free agency fills them)');
select is(
  (select string_agg(acquisition_cost::text, ',' order by acquisition_cost desc)
   from league_rosters where league_id = 'a7000000-0000-4000-8000-0000000000ff'),
  '5,3,1',
  '…each priced from its own pick (D111(3)), not defaulted to the column''s 0');
select is(
  (select status from leagues where id = 'a7000000-0000-4000-8000-0000000000ff'),
  'in_season',
  '…and the league flips to in_season REGARDLESS of the unfilled slots (C41''s ruling, verbatim)');

select lives_ok(
  $$ select public.draft_complete_internal('e7000000-0000-4000-8000-0000000000a1') $$,
  'LQ: a MOCK completes through the same writer');
select is(
  (select status from drafts where id = 'e7000000-0000-4000-8000-0000000000a1'),
  'complete',
  '…the mock draft row IS marked complete (recap retention — §8.8)');
select is(
  (select count(*) from league_rosters where league_id = 'a7000000-0000-4000-8000-0000000000a1'),
  0::bigint,
  '…and writes ZERO league_rosters rows (the §8.8 zero-side-effect contract, re-pinned from the completion side)');
select is(
  (select status from leagues where id = 'a7000000-0000-4000-8000-0000000000a1'),
  'scheduled',
  '…with the league untouched — no status transition from a practice room');

select lives_ok(
  $$ select public.draft_complete_internal('e7000000-0000-4000-8000-0000000000a2') $$,
  'LT: a SNAKE board completes through the same writer');
select is(
  (select count(*) from league_rosters
   where league_id = 'a7000000-0000-4000-8000-0000000000a2' and acquisition_cost is null),
  2::bigint,
  'D111(3)''s NULL half: snake rosters still carry acquisition_cost NULL — `p.price` is NULL on every snake pick, so the one expression reproduces the literal NULL 066 wrote (026 owns the full snake chain)');
select is(
  (select status from leagues where id = 'a7000000-0000-4000-8000-0000000000a2'),
  'in_season',
  '…and the snake league transitions exactly as 072 shipped it');

select * from finish();
rollback;
