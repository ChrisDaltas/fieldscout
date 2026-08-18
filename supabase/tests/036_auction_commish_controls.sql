-- ============================================================================
-- Auction commissioner controls — pgTAP 036 (migration 087, task L.C1.5;
-- spec §8.7 incl. the v2.10 pause-first ruling + Manual Edit Mode + End
-- draft (C41/v2.10.1), §8.6.7(a)(c), §8.6.8, §12.4, §12.5, §12.7, §17;
-- E4/E15/E28/E29/E31; D97/D127/D131/D137/D138/D141/D142/D143/D146/D162;
-- R301/R302/R363/R364). Grows ledger row F40.
--
-- WHAT THIS FILE OWNS vs its neighbours: 023 owns the SNAKE §8.7 surface end
-- to end (and keeps owning it — this file only pins that snake did not
-- change); 032 owns draft_bids' shape and its per-role write matrix; 033
-- owns the budget derivation matrix; 034 owns nominate/bid; 035 owns the
-- clock. THIS file owns everything a COMMISSIONER can do to an auction: the
-- D141 pause gate, the four new verbs, the auction arms bolted onto the
-- seven 069 controls, and D162's void representation.
--
-- M3 BATCH-5 FIX CYCLE (R367-R373) added §I(b) — the priced Manual Edit
-- paths measured against a LIVE HIGH BID (E28 arm 3, the blocker) — extended
-- §B to the outsider and anon roles the 087 banner claimed but never ran
-- (R369a), extended §M's mock sweep from four verbs to the eleven the banner
-- claimed (R369b), pinned draft_set_order's scheduled-auction refusal beside
-- §K (R373), and gave the new E28 arm-3 helper its own §A form pin and
-- no-drift source pin. 150 -> 181 asserts; every previously-recorded probe count
-- was re-run against the enlarged file (D161(5)).
--
-- FIXTURE ADP IS FRACTIONAL (the R286 lesson / ledger F60), same as 035:
-- every player here carries an adp in (0, 1) so the §8.4 ADP arm resolves to
-- a fixture BY VALUE and no projections refresh can take an assertion's
-- player away. Nothing is added to F60's sweep; closing it stays L.C6.1's.
--
-- FIXTURES ARE BORN WITH FUTURE (or NULL) DEADLINES, deliberately — the 035
-- LM/LV lesson. draft_tick claims every due live auction in the database, so
-- a fixture that is due at file start would be moved by whichever section
-- ticks first and every later assertion would be reading someone else's
-- board. Each section makes its OWN world due immediately before its OWN
-- tick.
--
-- Falsifiability notes (§4.3) — every count below was RUN, never predicted
-- (the R306/R314 lesson). Each probe was a LOCAL-ONLY `CREATE OR REPLACE`
-- from a patched copy of 087, reverted by re-applying the file unmutated;
-- 181/181 before and after each.
--
-- **THE COUNTS BELOW ARE THE M3 BATCH-5 RE-RUN (D161(5)).** This file grew
-- 150 -> 181 in the R367-R374 fix cycle, so every previously-recorded "N of
-- 150" was unreproducible and all five original probes were RE-RUN against
-- the enlarged file. **Every original RED SET reproduced exactly** — same
-- assertions, shifted numbers — which is the evidence that the first record
-- was honest rather than fitted.
--   * **BREAK PROBE 1 — the DoD's: E28's live-high-bid arm (D131(4))
--     disabled for draft_adjust_budget** (the `PERFORM` of the section-3b
--     helper removed from that verb only). **AS RUN: 3 of 181 RED** (85 the
--     refusal, 86 the state pin behind it — the adjustment must not have
--     landed — and 88, the boundary's MEASUREMENT pin, which goes red
--     because the arm-3 refusal is what kept the -$50 edit from composing
--     into the -$49 one; pin 87, the boundary's own `lives_ok`, stays GREEN
--     and is named). **wire 0 of 3**, GREEN BY CONSTRUCTION and named: the wire suite
--     drives no budget edit against a live high bidder. Arms 1 and 2 are
--     separate branches above arm 3 and stay green, which is what proves the
--     three arms are three arms rather than one message with three
--     phrasings. **§I(b)'s pins also stay green** — they call the SAME helper
--     through the two priced verbs, which is exactly the point of probe 6.
--   * **BREAK PROBE 2 — D162's `voided_at IS NULL` removed from ARM 2.6's
--     award attribution lookup** (the D161(2) defect this task exists to
--     close). **AS RUN: 2 of 181 RED** (94/95 — `made_via` flips 'autopick'
--     -> 'manager' and `is_auto` true -> false: the VOIDED HUMAN row is
--     attributed instead of the live SYSTEM one, so a manager is publicly
--     credited with a nomination they cancelled). **wire 0 of 3**, GREEN BY
--     CONSTRUCTION: the wire fixture's cancelled nomination is never
--     renominated on the same player at the same amount, so it contains no
--     decoy — only 036 §G builds one. Pin 96 stays green and is named — the
--     award still lands on the right player at the right price, so ONLY the
--     attribution moves — and so do the decoy-construction pins 92/93, which
--     describe the fixture rather than the lookup. §G forces the UUID tiebreak
--     deterministically (see its own note) precisely so this probe yields a
--     stable number, not a coin flip.
--   * **BREAK PROBE 3 — the D141 gate helper made a no-op** (its RAISE
--     bypassed). **AS RUN: 10 of 181 RED** (31-36 the six gated verbs' live
--     refusals; 49 the cancel-while-running refusal; 51 and 57, because a
--     cancel that is no longer forced to happen while paused leaves the
--     board in a different state than D143 describes; 135, the force-pick
--     phase refusal downstream of it) **plus 1 of 3 wire cases** — the gate
--     case, which is the one the routes and L.C3.2's disabled-button copy
--     will read. Pins 37 and 38 — the SNAKE counterparts (set_clock and undo)
--     succeeding LIVE — stay GREEN BY CONSTRUCTION and are named: the helper
--     never fires on snake, so disabling it cannot move them. That is F57's
--     divergence, pinned from both sides.
--   * **BREAK PROBE 4 — R302's two clears dropped from draft_reset.**
--     **AS RUN: 2 of 181 RED** (146, 147); **wire 0 of 3**, green by
--     construction — the wire suite never resets. R373's new set_order
--     divergence pin (149) sits two lines after them and stays GREEN: it
--     reads `status`, which the mutation does not touch.
--   * **BREAK PROBE 5 — the PRE-WRITE priced-move max-bid refusal dropped
--     from draft_move_player. AS RUN: 1 of 181 RED** (111); **wire 0 of 3**.
--     **THIS PROBE FOUND A DEFECT IN THIS FILE AND IS RECORDED BECAUSE IT
--     DID.** On its first run it turned **0 of 150** red. The pin passed a
--     mutation that deleted the very clause it names, because it was written
--     `throws_ok(sql, 'P0001', null, …)` — a NULL expected message accepts
--     ANY error of that SQLSTATE, and the §4-rule-7 solvency backstop three
--     statements later was still refusing the move with a different message.
--     The pin could not detect its own advertised mutation (the R329
--     species). Every refusal in this file whose IDENTITY matters now names
--     its exact message; there are no NULL-message P0001 pins left. The
--     backstop is not redundant — it is what makes the failure safe — but a
--     pin aimed at the targeted refusal has to be able to tell the two
--     apart. **§I(b)'s pins stay GREEN under this probe and that is not an
--     accident**: the pre-write check and E28 arm 3 answer different
--     questions, and probe 5 / probe 6 are what keep them from being
--     mistaken for one guard with two names.
--   * **BREAK PROBE 6 — E28 ARM 3 REMOVED FROM THE TWO PRICED MANUAL EDIT
--     PATHS** (the `PERFORM` of the section-3b helper deleted from
--     draft_move_player AND draft_reassign_pick; draft_adjust_budget keeps
--     its call). This is R367's probe — the blocker this fix cycle exists
--     for. **AS RUN: 10 of 181 RED** — **13**, §A's no-drift source pin (the
--     one that keeps this fix from un-fixing itself: it asserts all THREE
--     money-moving verbs reference the helper), then 123/124 the same-team
--     price-only arm and its state pin, 127/128 the cross-team move, 129/130
--     the cross-team reassign, and 131-133 downstream — once the refused edits
--     land, the board the boundary pins measure is a different board. **wire 0 of 3**,
--     GREEN BY CONSTRUCTION and named: no wire case drives a priced edit
--     against a live high bidder, and the refusal is a single-transaction
--     property that PostgREST adds nothing to. **Pins 121/122 stay GREEN and
--     they are the load-bearing pair**: they measure the FORGED post-edit
--     world and say `draft_auction_solvent` is TRUE there while max_bid is
--     $149 against a standing $150 bid. A probe cannot move them because
--     they are not asking the verb anything — they are the reason the verb
--     needs an arm the §4-rule-7 backstop cannot supply. Pins 125/126 (the
--     $49 boundary that LANDS) also stay green by construction: a deleted
--     refusal cannot break a success.
--   * **ONE UNIT SHORT, EVERYWHERE (D146 / the R320 doctrine).** Every
--     >=/<=/< comparison 087 makes is bracketed by a pin false by exactly one
--     unit of the thing compared:
--       E28 solvency floor      → an adjustment leaving remaining = open ×
--                                 min_bid EXACTLY lands (§F pin 79); one
--                                 dollar less is refused (pin 77)
--       E28 live high bid       → an adjustment leaving max_bid = high_bid
--                                 EXACTLY lands (pin 87); one dollar less is
--                                 refused (pin 85)
--       priced move ≤ max_bid   → price = max_bid lands (pin 114); max_bid+1
--                                 is refused (pin 111)
--       E28 arm 3 on the priced → §I(b): $49 lands at max_bid = high_bid
--         paths (R367)            EXACTLY (125) and $50 is refused (123);
--                                 from the move side $1 lands (131) and $2 is
--                                 refused (127)
--       force-nominate §8.6.7(a)→ min_bid = max_bid lands (pin 144); a seat
--                                 one dollar short is refused (pin 143)
--       draft_end unfilled count→ counted from the ONE family, pinned as a
--                                 stored literal (pin 151) so an off-by-one
--                                 in the sum is visible
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(181);

-- ---------------------------------------------------------------------------
-- A. Function form + grants (§4.1 grants doctrine; plan §8.3; D137)
-- ---------------------------------------------------------------------------
select ok(
  (select count(*) = 4 and bool_and(p.prosecdef)
       and bool_and(array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('draft_reverse_won_bid', 'draft_adjust_budget',
                       'draft_cancel_nomination', 'draft_end')),
  'all four NEW §8.7 auction RPCs are SECURITY DEFINER with the exact spec-form search_path');
select ok(
  not has_function_privilege('anon', 'public.draft_reverse_won_bid(uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_adjust_budget(uuid,uuid,integer,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_cancel_nomination(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_end(uuid,text)', 'EXECUTE'),
  'anon is revoked on all four');
select ok(
  has_function_privilege('authenticated', 'public.draft_reverse_won_bid(uuid,uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.draft_adjust_budget(uuid,uuid,integer,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.draft_cancel_nomination(uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.draft_end(uuid,text)', 'EXECUTE'),
  '…and authenticated keeps EXECUTE (in-body auth is the gate, §4.1)');
-- The two internals: SECURITY INVOKER, triple-revoked (no client consumer).
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_void_nomination_internal')
  and not has_function_privilege('authenticated', 'public.draft_void_nomination_internal(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_void_nomination_internal(uuid)', 'EXECUTE'),
  'draft_void_nomination_internal is INVOKER + search_path='''' + triple revoked (the ONE void implementation)');
select ok(
  (select array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_auction_pause_gate_internal')
  and not has_function_privilege('authenticated', 'public.draft_auction_pause_gate_internal(public.drafts,text)', 'EXECUTE'),
  'draft_auction_pause_gate_internal is search_path='''' + revoked (the ONE D141 implementation)');
select ok(
  (select array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_auction_high_bid_gate_internal')
  and not has_function_privilege('authenticated',
        'public.draft_auction_high_bid_gate_internal(public.drafts,uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon',
        'public.draft_auction_high_bid_gate_internal(public.drafts,uuid,text,text)', 'EXECUTE'),
  'draft_auction_high_bid_gate_internal is search_path='''' + revoked (the ONE E28 arm-3 implementation — R367)');

-- THE THREE WIDENED SIGNATURES (banner item 3): the new arity exists and the
-- OLD arity is GONE. A leftover 4-arg draft_set_clock would make every
-- shipped call site ambiguous ("function is not unique"), so its ABSENCE is
-- the load-bearing half of this pin, not its presence.
select ok(
  to_regprocedure('public.draft_set_clock(uuid,integer,boolean,text,integer,integer,integer)') is not null
  and to_regprocedure('public.draft_set_clock(uuid,integer,boolean,text)') is null,
  'draft_set_clock was DROP+CREATEd to the 7-arg auction-timer signature and the 4-arg overload is GONE');
select ok(
  to_regprocedure('public.draft_move_player(uuid,text,uuid,uuid,text,integer)') is not null
  and to_regprocedure('public.draft_move_player(uuid,text,uuid,uuid,text)') is null,
  'draft_move_player carries D142''s p_price and the old 5-arg overload is GONE');
select ok(
  to_regprocedure('public.draft_reassign_pick(uuid,uuid,uuid,text,text,integer)') is not null
  and to_regprocedure('public.draft_reassign_pick(uuid,uuid,uuid,text,text)') is null,
  'draft_reassign_pick carries D142''s p_price and the old 5-arg overload is GONE');
-- A DROP takes the ACL with it; 087 re-issues the REVOKEs. Prove it.
select ok(
  not has_function_privilege('anon', 'public.draft_set_clock(uuid,integer,boolean,text,integer,integer,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_move_player(uuid,text,uuid,uuid,text,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_reassign_pick(uuid,uuid,uuid,text,text,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.draft_set_clock(uuid,integer,boolean,text,integer,integer,integer)', 'EXECUTE'),
  '…and the re-issued REVOKEs survived the DROP+CREATE (anon out, authenticated in)');

-- The ONE-void-implementation and ONE-gate structure, pinned at the source
-- (the 035 §A / 065 inventory-pin pattern): a future session that inlines a
-- second copy fails here rather than at a divergence six months on.
select ok(
  (select bool_and(p.prosrc like '%draft_auction_pause_gate_internal%')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('draft_undo', 'draft_reverse_won_bid', 'draft_set_clock',
                       'draft_cancel_nomination', 'draft_reassign_pick',
                       'draft_move_player')),
  'all SIX D141-gated verbs call the ONE gate helper — the ruling cannot drift apart verb by verb');
select ok(
  (select bool_and(p.prosrc like '%draft_void_nomination_internal%')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('draft_cancel_nomination', 'draft_undo', 'draft_end')),
  'all THREE voiding verbs call the ONE void helper (D162)');
select ok(
  (select bool_and(p.prosrc like '%draft_auction_high_bid_gate_internal%')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('draft_adjust_budget', 'draft_move_player', 'draft_reassign_pick')),
  'all THREE money-moving verbs call the ONE E28 arm-3 helper — R367 is precisely what happens when two of them do not, so this is the pin that keeps the fix from un-fixing itself');
select ok(
  (select p.prosrc like '%draft_complete_internal%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_end'),
  'draft_end uses the L.C1.4 completion writer''s sanctioned partial entry — not a second implementation (D160(1))');
select ok(
  (select p.prosrc like '%voided_at IS NULL%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_tick'),
  'ARM 2.6''s award attribution lookup filters voided rows (D162) — the source pin behind §G''s behavioural one');

-- ---------------------------------------------------------------------------
-- B. draft_bids' CLIENT-FACING posture is UNCHANGED by voided_at (D162's
--    append-only claim, checked rather than asserted). 032 owns this matrix;
--    it is re-run HERE because 087 is the migration that could have broken
--    it, and a claim about the post-change world must be measured in the
--    post-change world. Fixtures land first (they are shared by every
--    section), then the sweep.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('9f000000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-cm5-u' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       ('{"username": "cm5_user_' || i || '"}')::jsonb, now(), now()
from generate_series(1, 6) i;

insert into players (id, full_name, position, adp)
select 'cm5-rb' || lpad(i::text, 2, '0'), 'CM5 RB ' || lpad(i::text, 2, '0'),
       'RB', i / 1000.0
from generate_series(1, 60) i;

-- Ten worlds, 8 seats each (the smallest legal league — team_count is a
-- CHECK over {8,10,12,14,16}, and draft_set_order's permutation validator
-- reads it, so the fixtures must match reality rather than shrink below it).
-- Eight seats per league (leagues_team_count_check admits only 8/10/12/14/16).
--   LA aa  the D141 gate world (auction, live, mid-BIDDING)          §C, §J
--   LB bb  the SNAKE twin of LA — the divergence, pinned live        §C
--   LC cc  cancel-and-renominate + D162 attribution                  §D, §G
--   LD dd  the STUCK CLOCK (D160(8)/R364) — forged over-max award    §E
--   LE ee  E28's three arms                                          §F
--   LF ff  reverse-won-bid + the E29 cascade                         §H
--   LG a1  the priced Manual Edit Mode paths                         §I
--   LH a5  the priced paths against a LIVE HIGH BID (E28 arm 3)       §I
--   LI a2  draft_end's partial board (C41)                           §L
--   LK a3  draft_reset mid-bidding (R302)                            §K
--   LJ a4  the auction MOCK — D138's refusal sweep                   §M
insert into leagues (id, owner_id, name, season, status, team_count,
                     scoring_system_id, settings, scoring_rules_snapshot)
select ('b8000000-0000-4000-8000-0000000000' || w.sfx)::uuid,
       '9f000000-0000-4000-8000-000000000001',
       'pgtap-cm5-' || w.nm, 2026, 'drafting', 8, null,
       ('{"draft": {"auction_budget": 200, "auction_min_bid": 1,
          "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
          "auction_anti_snipe_seconds": 10, "disconnect_grace_seconds": 30,
          "pick_timer_seconds": 90}}')::jsonb,
       '{}'::jsonb
from (values ('aa','LA-gate'), ('bb','LB-snake'), ('cc','LC-cancel'),
             ('dd','LD-stuck'), ('ee','LE-e28'), ('ff','LF-reverse'),
             ('a1','LG-priced'), ('a2','LI-end'), ('a3','LK-reset'),
             ('a4','LJ-mock'), ('a5','LH-highbid')) as w(sfx, nm);

-- 3 draftable slots everywhere except LC (2 — it needs a short board so §G's
-- renomination cannot run the roster out) — D91: rounds = Σ starting slots +
-- bench, IR excluded.
update leagues
set roster_settings = '{"starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                        "bench": 2, "ir_slots": [], "swap_spots": 0}'::jsonb
where name like 'pgtap-cm5-%';
update leagues
set roster_settings = '{"starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                        "bench": 1, "ir_slots": [], "swap_spots": 0}'::jsonb
where id = 'b8000000-0000-4000-8000-0000000000cc';

insert into teams (id, owner_id, name, league_id)
select ('d8000000-0000-4000-8000-00' || w.sfx || '0000000' || i)::uuid,
       '9f000000-0000-4000-8000-000000000001',
       'pgtap-cm5-' || w.sfx || '-t' || i,
       ('b8000000-0000-4000-8000-0000000000' || w.sfx)::uuid
from (values ('aa'), ('bb'), ('cc'), ('dd'), ('ee'), ('ff'),
             ('a1'), ('a2'), ('a3'), ('a4'), ('a5')) as w(sfx),
     generate_series(1, 8) i;

-- u1 commissions every world on t1; u2/u3 manage t2/t3. t4 is deliberately a
-- placeholder (no member row — E48's no-user seat), which is what lets §E's
-- recovery tick system-nominate at the deadline with no grace hold.
insert into league_members (league_id, user_id, team_id, role)
select ('b8000000-0000-4000-8000-0000000000' || w.sfx)::uuid,
       ('9f000000-0000-4000-8000-00000000000' || m.u)::uuid,
       ('d8000000-0000-4000-8000-00' || w.sfx || '0000000' || m.t)::uuid,
       m.r
from (values ('aa'), ('bb'), ('cc'), ('dd'), ('ee'), ('ff'),
             ('a1'), ('a2'), ('a3'), ('a4'), ('a5')) as w(sfx),
     (values (1, 1, 'commissioner'), (2, 2, 'manager'), (3, 3, 'manager')) as m(u, t, r);

-- The auction drafts. FUTURE deadlines (see the header) except where a
-- section rewinds its own. nomination_order = t1..t4 everywhere.
insert into drafts (id, league_id, draft_type, status, is_mock, config,
                    draft_order, nomination_order, total_rounds, current_round,
                    current_pick_number, on_clock_team_id, current_deadline,
                    started_at)
select ('e8000000-0000-4000-8000-0000000000' || w.sfx)::uuid,
       ('b8000000-0000-4000-8000-0000000000' || w.sfx)::uuid,
       'auction', 'live', w.sfx = 'a4',
       '{"auction_budget": 200, "auction_min_bid": 1,
         "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
         "auction_anti_snipe_seconds": 10, "disconnect_grace_seconds": 30,
         "pick_timer_seconds": 90}'::jsonb,
       (select jsonb_agg(t.id order by t.name) from teams t
        where t.league_id = ('b8000000-0000-4000-8000-0000000000' || w.sfx)::uuid),
       (select jsonb_agg(t.id order by t.name) from teams t
        where t.league_id = ('b8000000-0000-4000-8000-0000000000' || w.sfx)::uuid),
       case when w.sfx = 'cc' then 2 else 3 end,
       1, 1,
       ('d8000000-0000-4000-8000-00' || w.sfx || '00000001')::uuid,
       now() + interval '1 hour', now()
from (values ('aa'), ('cc'), ('dd'), ('ee'), ('ff'),
             ('a1'), ('a2'), ('a3'), ('a4'), ('a5')) as w(sfx);

-- LB: the SNAKE twin. Same league shape, same seats, live, future deadline.
insert into drafts (id, league_id, draft_type, status, is_mock, config,
                    draft_order, total_rounds, current_round,
                    current_pick_number, on_clock_team_id, current_deadline,
                    started_at)
values ('e8000000-0000-4000-8000-0000000000bb',
        'b8000000-0000-4000-8000-0000000000bb', 'snake', 'live', false,
        '{"pick_timer_seconds": 90}'::jsonb,
        (select jsonb_agg(t.id order by t.name) from teams t
         where t.league_id = 'b8000000-0000-4000-8000-0000000000bb'),
        3, 1, 2,
        'd8000000-0000-4000-8000-00bb00000002',
        now() + interval '1 hour', now());
-- One live snake pick so draft_undo has something to undo.
insert into draft_picks (draft_id, league_id, pick_number, round, team_id,
                         player_id, price, is_auto, made_via)
values ('e8000000-0000-4000-8000-0000000000bb',
        'b8000000-0000-4000-8000-0000000000bb', 1, 1,
        'd8000000-0000-4000-8000-00bb00000001', 'cm5-rb01', null, false, 'manager');

-- LA: mid-BIDDING at seq 1 — t1 nominated cm5-rb02 at $5, t2 raised to $9.
-- Every nomination opens with a bid row (F62), so the fixture writes both.
update drafts set current_nomination =
  '{"player_id": "cm5-rb02", "high_bid": 9,
    "high_bidder_team_id": "d8000000-0000-4000-8000-00aa00000002"}'::jsonb
where id = 'e8000000-0000-4000-8000-0000000000aa';
insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id,
                        amount, action_id) values
  ('e8000000-0000-4000-8000-0000000000aa', 'b8000000-0000-4000-8000-0000000000aa',
   1, 'cm5-rb02', 'd8000000-0000-4000-8000-00aa00000001', 5,
   '11111111-0000-4000-8000-00000000aa01'),
  ('e8000000-0000-4000-8000-0000000000aa', 'b8000000-0000-4000-8000-0000000000aa',
   1, 'cm5-rb02', 'd8000000-0000-4000-8000-00aa00000002', 9,
   '11111111-0000-4000-8000-00000000aa02');
-- One settled pick on LA so the Manual Edit Mode verbs have a target.
insert into draft_picks (draft_id, league_id, pick_number, round, team_id,
                         player_id, price, is_auto, made_via)
values ('e8000000-0000-4000-8000-0000000000aa',
        'b8000000-0000-4000-8000-0000000000aa', 1, null,
        'd8000000-0000-4000-8000-00aa00000003', 'cm5-rb03', 7, false, 'manager');
update drafts set current_pick_number = 2
where id = 'e8000000-0000-4000-8000-0000000000aa';
update draft_bids set nomination_seq = 2
where draft_id = 'e8000000-0000-4000-8000-0000000000aa';
update drafts set current_nomination = current_nomination
where id = 'e8000000-0000-4000-8000-0000000000aa';

-- §B's sweep. draft_bids gained a column; it must NOT have gained a write
-- path. Each zero is bracketed by a privileged count BEFORE and AFTER, so a
-- refusal is proven rather than an empty target (the R307 discipline).
select is((select count(*) from draft_bids
           where draft_id = 'e8000000-0000-4000-8000-0000000000aa'),
          2::bigint, 'LA carries exactly 2 bid rows before the write sweep (the bracket''s BEFORE half)');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is((select count(*) from draft_bids
           where draft_id = 'e8000000-0000-4000-8000-0000000000aa'),
          2::bigint, 'a MEMBER can SELECT the league''s bids (§12.5 — bids are public in an open auction)');
select results_eq(
  $$ with w as (update draft_bids set voided_at = now()
                where draft_id = 'e8000000-0000-4000-8000-0000000000aa' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'a member CANNOT stamp voided_at — 087 added no UPDATE policy (D162/D131(2))');
select results_eq(
  $$ with d as (delete from draft_bids
                where draft_id = 'e8000000-0000-4000-8000-0000000000aa' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  '…and cannot DELETE');
select throws_ok(
  $$ insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount)
     values ('e8000000-0000-4000-8000-0000000000aa', 'b8000000-0000-4000-8000-0000000000aa',
             9, 'cm5-rb04', 'd8000000-0000-4000-8000-00aa00000002', 1) $$,
  '42501', null, '…and cannot INSERT (bids land via RPC only — 085/086/087)');

-- The COMMISSIONER has no bypass either: 087 gave commissioners four new
-- RPCs, not a table write.
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select results_eq(
  $$ with w as (update draft_bids set voided_at = now()
                where draft_id = 'e8000000-0000-4000-8000-0000000000aa' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'the COMMISSIONER cannot stamp voided_at directly either — the verb is the only door');
select results_eq(
  $$ with d as (delete from draft_bids
                where draft_id = 'e8000000-0000-4000-8000-0000000000aa' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  '…and cannot DELETE');
select throws_ok(
  $$ insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount)
     values ('e8000000-0000-4000-8000-0000000000aa', 'b8000000-0000-4000-8000-0000000000aa',
             9, 'cm5-rb05', 'd8000000-0000-4000-8000-00aa00000002', 1) $$,
  '42501', null, '…and cannot INSERT either — 087 gave commissioners four RPCs, not a table write (R369: this cell was CLAIMED by the 087 banner and did not exist)');

-- R369(a): the banner said this sweep ran member/commissioner/OUTSIDER/ANON ×
-- INSERT/UPDATE/DELETE and it ran neither of the last two roles. They are
-- added rather than the claim narrowed, because the claim is the coverage you
-- would want: an outsider is the role RLS exists for, and `anon` is the one a
-- leaked publishable key reaches. u5 is a member of NO league in this file.
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select results_eq(
  $$ with w as (update draft_bids set voided_at = now()
                where draft_id = 'e8000000-0000-4000-8000-0000000000aa' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'an OUTSIDER cannot stamp voided_at');
select results_eq(
  $$ with d as (delete from draft_bids
                where draft_id = 'e8000000-0000-4000-8000-0000000000aa' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  '…and cannot DELETE');
select throws_ok(
  $$ insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount)
     values ('e8000000-0000-4000-8000-0000000000aa', 'b8000000-0000-4000-8000-0000000000aa',
             9, 'cm5-rb06', 'd8000000-0000-4000-8000-00aa00000002', 1) $$,
  '42501', null, '…and cannot INSERT');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select results_eq(
  $$ with w as (update draft_bids set voided_at = now()
                where draft_id = 'e8000000-0000-4000-8000-0000000000aa' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'ANON cannot stamp voided_at (the RETURNING-count form — a refusal, not an empty target)');
select results_eq(
  $$ with d as (delete from draft_bids
                where draft_id = 'e8000000-0000-4000-8000-0000000000aa' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  '…and cannot DELETE');
select throws_ok(
  $$ insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount)
     values ('e8000000-0000-4000-8000-0000000000aa', 'b8000000-0000-4000-8000-0000000000aa',
             9, 'cm5-rb07', 'd8000000-0000-4000-8000-00aa00000002', 1) $$,
  '42501', null, '…and cannot INSERT');
reset role;
select is((select count(*) from draft_bids
           where draft_id = 'e8000000-0000-4000-8000-0000000000aa'
             and voided_at is null),
          2::bigint, 'the bracket''s AFTER half: both rows survive un-voided — every zero above refused rather than matched nothing');

-- ---------------------------------------------------------------------------
-- C. THE D141 PAUSE-FIRST GATE (spec §8.7 v2.10, ruled 2026-08-15) — all six
--    gated verbs on a RUNNING auction, then the same verbs paused, then the
--    SNAKE counterparts still live-available. The divergence F57 records,
--    pinned from BOTH sides.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select throws_ok(
  $$ select public.draft_undo('e8000000-0000-4000-8000-0000000000aa') $$,
  'P0001',
  'draft_undo: pause the draft first — auction commissioner controls run on a paused board (§8.7 v2.10)',
  'D141: draft_undo refuses on a RUNNING auction, with the ruling''s own copy');
select throws_ok(
  $$ select public.draft_reverse_won_bid('e8000000-0000-4000-8000-0000000000aa',
       (select id from draft_picks where draft_id = 'e8000000-0000-4000-8000-0000000000aa')) $$,
  'P0001',
  'draft_reverse_won_bid: pause the draft first — auction commissioner controls run on a paused board (§8.7 v2.10)',
  'D141: draft_reverse_won_bid refuses on a RUNNING auction');
select throws_ok(
  $$ select public.draft_set_clock('e8000000-0000-4000-8000-0000000000aa',
       p_nomination_seconds => 60) $$,
  'P0001',
  'draft_set_clock: pause the draft first — auction commissioner controls run on a paused board (§8.7 v2.10)',
  'D141: ALL timer edits refuse on a RUNNING auction');
select throws_ok(
  $$ select public.draft_cancel_nomination('e8000000-0000-4000-8000-0000000000aa') $$,
  'P0001',
  'draft_cancel_nomination: pause the draft first — auction commissioner controls run on a paused board (§8.7 v2.10)',
  'D141: current-nomination edits refuse on a RUNNING auction');
select throws_ok(
  $$ select public.draft_reassign_pick('e8000000-0000-4000-8000-0000000000aa',
       (select id from draft_picks where draft_id = 'e8000000-0000-4000-8000-0000000000aa'),
       p_price => 4) $$,
  'P0001',
  'draft_reassign_pick: pause the draft first — auction commissioner controls run on a paused board (§8.7 v2.10)',
  'D141: Manual Edit Mode''s reassign path refuses on a RUNNING auction');
select throws_ok(
  $$ select public.draft_move_player('e8000000-0000-4000-8000-0000000000aa', 'cm5-rb03',
       'd8000000-0000-4000-8000-00aa00000003', 'd8000000-0000-4000-8000-00aa00000004', null, 7) $$,
  'P0001',
  'draft_move_player: pause the draft first — auction commissioner controls run on a paused board (§8.7 v2.10)',
  'D141: Manual Edit Mode''s move path refuses on a RUNNING auction');

-- The SNAKE side of the divergence, on a LIVE snake draft — F57's whole
-- point. If a future session "aligns" snake without a ruling, this fails.
select lives_ok(
  $$ select public.draft_set_clock('e8000000-0000-4000-8000-0000000000bb', 60) $$,
  'F57 DIVERGENCE, snake side: draft_set_clock still succeeds on a LIVE snake draft (M2''s shipped posture, untouched)');
select lives_ok(
  $$ select public.draft_undo('e8000000-0000-4000-8000-0000000000bb') $$,
  'F57 DIVERGENCE, snake side: draft_undo still succeeds on a LIVE snake draft');

-- Paused, the same auction verbs work. (Pause is NOT gated — D141's ruling
-- does not name it.)
select lives_ok(
  $$ select public.draft_pause('e8000000-0000-4000-8000-0000000000aa') $$,
  'draft_pause itself is NOT gated (the ruling names six verbs; pause is how you satisfy them)');
select lives_ok(
  $$ select public.draft_set_clock('e8000000-0000-4000-8000-0000000000aa',
       p_nomination_seconds => 60, p_bid_seconds => 25, p_anti_snipe_seconds => 0) $$,
  '…and the auction timer edit lands once PAUSED');
select is(
  (select (config->>'auction_nomination_seconds') || '/' || (config->>'auction_bid_seconds')
          || '/' || (config->>'auction_anti_snipe_seconds')
   from drafts where id = 'e8000000-0000-4000-8000-0000000000aa'),
  '60/25/0',
  '…writing all three auction timers into the drafts config snapshot (E15 analog: subsequent clocks, D95''s single authority)');
select throws_ok(
  $$ select public.draft_set_clock('e8000000-0000-4000-8000-0000000000aa', 45) $$,
  'P0001',
  'draft_set_clock: this is an auction — it has no pick clock; set the nomination, bid, or anti-snipe timers instead (§7.3.8)',
  'a pick-clock edit on an auction is refused by name rather than silently stored');
select throws_ok(
  $$ select public.draft_set_clock('e8000000-0000-4000-8000-0000000000bb',
       60, false, null, 30) $$,
  'P0001',
  'draft_set_clock: this is a snake draft — the auction timers apply to auction drafts only (§8.6)',
  '…and the converse: auction timers on a snake draft are refused');
select throws_ok(
  $$ select public.draft_set_clock('e8000000-0000-4000-8000-0000000000bb', -1) $$,
  '22023',
  'draft_set_clock: pick_timer_seconds must be a non-negative integer',
  '023''s NEGATIVE-timer message survives the widening unchanged, and still fires ahead of any data access');
select throws_ok(
  $$ select public.draft_set_clock('e8000000-0000-4000-8000-0000000000aa') $$,
  '22023',
  'draft_set_clock: name at least one timer to change',
  '…and a call naming NO timer at all is refused before any data access');

-- ---------------------------------------------------------------------------
-- D. draft_cancel_nomination — the D143 golden (voids, seq NOT consumed,
--    renomination on resume) plus its phase and status refusals.
-- ---------------------------------------------------------------------------
-- LC is driven through the REAL verbs from here: u1 manages t1 and t1 is on
-- the clock in the NOMINATING phase.
select lives_ok(
  $$ select public.draft_nominate('e8000000-0000-4000-8000-0000000000cc',
       'cm5-rb10', 5, '22222222-0000-4000-8000-00000000cc01') $$,
  'LC: the on-clock manager nominates cm5-rb10 at $5 through the real verb (085)');
select is(
  (select current_nomination->>'player_id' from drafts
   where id = 'e8000000-0000-4000-8000-0000000000cc'),
  'cm5-rb10', '…bidding is open on him (D126''s phase rule)');
select is(
  (select count(*) from draft_bids
   where draft_id = 'e8000000-0000-4000-8000-0000000000cc' and voided_at is null),
  1::bigint, '…and the opening bid row is LIVE (F62 + D162''s default)');

select throws_ok(
  $$ select public.draft_cancel_nomination('e8000000-0000-4000-8000-0000000000cc') $$,
  'P0001',
  'draft_cancel_nomination: pause the draft first — auction commissioner controls run on a paused board (§8.7 v2.10)',
  'cancel is PAUSED-only (D143''s "while paused") — the same gate, reached from the nomination side');
select lives_ok(
  $$ select public.draft_pause('e8000000-0000-4000-8000-0000000000cc') $$,
  'pause LC');
select lives_ok(
  $$ select public.draft_cancel_nomination('e8000000-0000-4000-8000-0000000000cc') $$,
  'D143: the commissioner cancels the live nomination on a PAUSED auction');
select is(
  (select current_nomination from drafts where id = 'e8000000-0000-4000-8000-0000000000cc'),
  null, 'D143 GOLDEN (1): current_nomination is cleared — the board is back in the NOMINATING phase');
select is(
  (select current_pick_number from drafts where id = 'e8000000-0000-4000-8000-0000000000cc'),
  1, 'D143 GOLDEN (2): the SEQUENCE NUMBER IS NOT CONSUMED — still 1, exactly as the ruling says');
select is(
  (select on_clock_team_id from drafts where id = 'e8000000-0000-4000-8000-0000000000cc'),
  'd8000000-0000-4000-8000-00cc00000001'::uuid,
  'D143 GOLDEN (3): the SAME nominator keeps the clock — cancel-and-renominate, not skip');
select is(
  (select count(*) from draft_bids
   where draft_id = 'e8000000-0000-4000-8000-0000000000cc' and voided_at is not null),
  1::bigint,
  'D162 GOLDEN: "open bids voided" now MEANS something — the row is stamped, not deleted (D131(2) append-only intact)');
select is(
  (select count(*) from draft_bids where draft_id = 'e8000000-0000-4000-8000-0000000000cc'),
  1::bigint,
  '…and the row STANDS: voiding annotates history, it does not rewrite it');
select is(
  (select deadline_remaining_ms from drafts where id = 'e8000000-0000-4000-8000-0000000000cc'),
  45000,
  'the stored remainder is LC''s NOMINATION clock (45s), NOT the 30s bid clock that was running: resuming into the nominating phase on a bid-clock remainder would hand the nominator the wrong window');
select throws_ok(
  $$ select public.draft_cancel_nomination('e8000000-0000-4000-8000-0000000000cc') $$,
  'P0001',
  'draft_cancel_nomination: no player is nominated right now — there is nothing to cancel (§8.6.2)',
  'a second cancel is refused by name — BIDDING-phase only (D126), never a silent no-op');
select throws_ok(
  $$ select public.draft_cancel_nomination('e8000000-0000-4000-8000-0000000000bb') $$,
  'P0001',
  'draft_cancel_nomination: this is a snake draft — only auction drafts have nominations (§8.6)',
  '…and a snake draft is refused by type');

-- ---------------------------------------------------------------------------
-- E. THE STUCK CLOCK — D160(8)/R364's recorded residual, DRIVEN end to end.
--    L.C1.4 measured that a refused insolvent award has no remedy but
--    draft_reset; this section is the proof that 087 changed that. The state
--    is FORGED the same way D160(8) forged it (085's bid clause refuses to
--    create it), so the award's own solvency guard is what refuses.
-- ---------------------------------------------------------------------------
reset role;
-- LD: 3 draftable slots, $200, min_bid 1 ⇒ max_bid = 200 − 2×1 = 198.
-- t4 is the no-user placeholder seat and holds the clock, so the recovery
-- tick system-nominates AT the deadline with no grace hold (D102/D129(3)).
update drafts set
  on_clock_team_id   = 'd8000000-0000-4000-8000-00dd00000004',
  current_nomination = '{"player_id": "cm5-rb20", "high_bid": 199,
                         "high_bidder_team_id": "d8000000-0000-4000-8000-00dd00000004"}'::jsonb,
  current_deadline   = now() - interval '1 second'
where id = 'e8000000-0000-4000-8000-0000000000dd';
insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id,
                        amount, action_id)
values ('e8000000-0000-4000-8000-0000000000dd', 'b8000000-0000-4000-8000-0000000000dd',
        1, 'cm5-rb20', 'd8000000-0000-4000-8000-00dd00000004', 199,
        '33333333-0000-4000-8000-00000000dd01');

select set_config('pgtap.cm5_e1', public.draft_tick()::text, true);
select ok(
  (select bool_or(f->>'error' like '%would break §8.6.8 solvency%')
   from jsonb_array_elements(current_setting('pgtap.cm5_e1')::jsonb->'auction_failures') f
   where f->>'draft_id' = 'e8000000-0000-4000-8000-0000000000dd'),
  'STUCK CLOCK step 1 — the tick REFUSES the insolvent award, loudly, naming §8.6.8 (failure scoped by draft_id, F67''s fix shape — never by array index)');
select is(
  (select count(*) from draft_picks where draft_id = 'e8000000-0000-4000-8000-0000000000dd'),
  0::bigint, '…and writes NO pick');
select ok(
  (select current_nomination is not null from drafts where id = 'e8000000-0000-4000-8000-0000000000dd'),
  '…and the nomination is left STANDING — which is what makes it a stuck clock rather than a skipped tick');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_pause('e8000000-0000-4000-8000-0000000000dd') $$,
  'STUCK CLOCK step 2a — pause (D160(8)''s measured non-remedy, reproduced here rather than quoted)');
select lives_ok(
  $$ select public.draft_resume('e8000000-0000-4000-8000-0000000000dd') $$,
  'STUCK CLOCK step 2b — resume');
select ok(
  (select current_nomination is not null and status = 'live'
   from drafts where id = 'e8000000-0000-4000-8000-0000000000dd'),
  '…and the SAME nomination is still standing: pause CONTAINS the retry loop, it does not clear it');
reset role;
update drafts set current_deadline = now() - interval '1 second'
where id = 'e8000000-0000-4000-8000-0000000000dd';
select set_config('pgtap.cm5_e2', public.draft_tick()::text, true);
select ok(
  (select bool_or(f->>'error' like '%would break §8.6.8 solvency%')
   from jsonb_array_elements(current_setting('pgtap.cm5_e2')::jsonb->'auction_failures') f
   where f->>'draft_id' = 'e8000000-0000-4000-8000-0000000000dd'),
  'STUCK CLOCK step 3 — the next tick reproduces the IDENTICAL failure (the loop D160(8) recorded)');

-- THE REMEDY — 087's whole reason for existing on this point.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_pause('e8000000-0000-4000-8000-0000000000dd') $$,
  'STUCK CLOCK step 4a — pause');
select lives_ok(
  $$ select public.draft_cancel_nomination('e8000000-0000-4000-8000-0000000000dd') $$,
  'STUCK CLOCK step 4b — draft_cancel_nomination, the verb D160(8) says "has not shipped"');
select is(
  (select current_nomination from drafts where id = 'e8000000-0000-4000-8000-0000000000dd'),
  null, 'STUCK CLOCK step 4c — the unaffordable nomination is GONE');
select is(
  (select count(*) from draft_picks where draft_id = 'e8000000-0000-4000-8000-0000000000dd'),
  0::bigint,
  '…AND THE BOARD SURVIVED: no pick was destroyed. draft_reset would have wiped it — that was the whole cost D160(8) priced');
select lives_ok(
  $$ select public.draft_resume('e8000000-0000-4000-8000-0000000000dd') $$,
  'STUCK CLOCK step 5 — resume');
reset role;
update drafts set current_deadline = now() - interval '1 second'
where id = 'e8000000-0000-4000-8000-0000000000dd';
select set_config('pgtap.cm5_e3', public.draft_tick()::text, true);
select is(
  (select count(*) from jsonb_array_elements(
     current_setting('pgtap.cm5_e3')::jsonb->'auction_failures') f
   where f->>'draft_id' = 'e8000000-0000-4000-8000-0000000000dd'),
  0::bigint,
  'STUCK CLOCK step 6 — the next tick has NOTHING to fail on: the clock is unstuck');
select ok(
  (select current_nomination->>'player_id' is not null and current_pick_number = 1
   from drafts where id = 'e8000000-0000-4000-8000-0000000000dd'),
  '…the nomination-expiry arm system-nominates for the no-user seat, still at sequence 1 (D143: the number was never consumed)');
select is(
  (select count(*) from draft_bids
   where draft_id = 'e8000000-0000-4000-8000-0000000000dd' and action_id is null
     and voided_at is null),
  1::bigint,
  '…writing its opening bid row with action_id NULL (F62 + D130''s per-actor attribution), while the forged $199 row stays VOIDED under the same sequence number');

-- ---------------------------------------------------------------------------
-- F. draft_adjust_budget — E28's three arms, each with its one-unit-short
--    partner (D146) and a positive control.
-- ---------------------------------------------------------------------------
-- LE: t1 has one $50 pick ⇒ committed 50, remaining 150, open 2, max_bid 149.
insert into draft_picks (draft_id, league_id, pick_number, round, team_id,
                         player_id, price, is_auto, made_via)
values ('e8000000-0000-4000-8000-0000000000ee',
        'b8000000-0000-4000-8000-0000000000ee', 1, null,
        'd8000000-0000-4000-8000-00ee00000001', 'cm5-rb30', 50, false, 'manager');
update drafts set current_pick_number = 2
where id = 'e8000000-0000-4000-8000-0000000000ee';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
-- The derivation family is TRIPLE-REVOKED (084/§4.1: no client consumer —
-- the room's budgets ride the D134 payloads), so its pins run privileged,
-- exactly as 033 runs them. reset role / re-auth brackets each one.
reset role;
select is(
  (select b.remaining || '/' || b.open_slots || '/' || b.max_bid
   from public.draft_team_budget('e8000000-0000-4000-8000-0000000000ee',
                                 'd8000000-0000-4000-8000-00ee00000001') b),
  '150/2/149',
  'LE baseline through the ONE family (D127): $50 spent of $200 ⇒ 150 remaining, 2 open, max bid 149');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select throws_ok(
  $$ select public.draft_adjust_budget('e8000000-0000-4000-8000-0000000000ee',
       'd8000000-0000-4000-8000-00ee00000001', -151) $$,
  'P0001',
  'draft_adjust_budget: that leaves pgtap-cm5-ee-t1 $1 short of the $50 already spent — reverse a won bid instead, or make the adjustment smaller (E28)',
  'E28 ARM 1 — an adjustment below COMMITTED SPEND is refused (its own message and its own remedy, not folded into arm 2)');
select throws_ok(
  $$ select public.draft_adjust_budget('e8000000-0000-4000-8000-0000000000ee',
       'd8000000-0000-4000-8000-00ee00000001', -149) $$,
  'P0001',
  'draft_adjust_budget: that leaves pgtap-cm5-ee-t1 with $1 for 2 open roster spots at a $1 minimum bid — §8.6.8 needs at least $2; reverse a won bid to free a spot, or make the adjustment smaller (E28)',
  'E28 ARM 2 — ONE DOLLAR SHORT of the §8.6.8 floor (remaining 1 vs 2 open spots at $1) is refused (D146)');
select is(
  (select budget_adjustments from drafts where id = 'e8000000-0000-4000-8000-0000000000ee'),
  '{}'::jsonb,
  '…and NEITHER refusal left a partial write behind: the RAISE rolls the edit back, which is why no compensating arithmetic exists');
select lives_ok(
  $$ select public.draft_adjust_budget('e8000000-0000-4000-8000-0000000000ee',
       'd8000000-0000-4000-8000-00ee00000001', -148) $$,
  'E28 BOUNDARY — one dollar MORE and the edit lands: remaining exactly equals the floor (D146''s discriminating pair)');
-- (privileged bracket — see the note at §F)
reset role;
select is(
  (select b.remaining || '/' || b.open_slots || '/' || b.max_bid
   from public.draft_team_budget('e8000000-0000-4000-8000-0000000000ee',
                                 'd8000000-0000-4000-8000-00ee00000001') b),
  '2/2/1',
  '…and the derivation reflects it instantly through the ONE family (no stored counter — D127)');
select ok(
  (select public.draft_auction_solvent('e8000000-0000-4000-8000-0000000000ee')),
  '…with §8.6.8 still TRUE at exact equality');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select budget_adjustments->>'d8000000-0000-4000-8000-00ee00000001'
   from drafts where id = 'e8000000-0000-4000-8000-0000000000ee'),
  '-148', 'the adjustment is STORED as a per-team delta (D127''s storage half, 083''s column)');
select lives_ok(
  $$ select public.draft_adjust_budget('e8000000-0000-4000-8000-0000000000ee',
       'd8000000-0000-4000-8000-00ee00000001', 148) $$,
  'adjustments are CUMULATIVE — a second edit composes with the first rather than replacing it');
select is(
  (select budget_adjustments->>'d8000000-0000-4000-8000-00ee00000001'
   from drafts where id = 'e8000000-0000-4000-8000-0000000000ee'),
  '0', '…back to zero, and the map keeps the key (an explicit 0 is a fact, not an absence)');

-- E28 ARM 3 (D131(4)): the live-high-bid arm — this is the DoD probe's target.
reset role;
update drafts set current_nomination =
  '{"player_id": "cm5-rb31", "high_bid": 100,
    "high_bidder_team_id": "d8000000-0000-4000-8000-00ee00000001"}'::jsonb
where id = 'e8000000-0000-4000-8000-0000000000ee';
insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id,
                        amount, action_id)
values ('e8000000-0000-4000-8000-0000000000ee', 'b8000000-0000-4000-8000-0000000000ee',
        2, 'cm5-rb31', 'd8000000-0000-4000-8000-00ee00000001', 100,
        '44444444-0000-4000-8000-00000000ee01');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_adjust_budget('e8000000-0000-4000-8000-0000000000ee',
       'd8000000-0000-4000-8000-00ee00000001', -50) $$,
  'P0001',
  'draft_adjust_budget: pgtap-cm5-ee-t1 is the high bidder on CM5 RB 31 at $100, and that leaves a max bid of $99 — the close would be unaffordable. Void the nomination (pause, then Edit current nomination) or reverse a won bid first (E28/D131(4))',
  'E28 ARM 3 (D131(4)) — ONE DOLLAR SHORT: the edit would leave max bid $99 against a standing $100 high bid, so the CLOSE would be unaffordable; refused (D146)');
select is(
  (select budget_adjustments->>'d8000000-0000-4000-8000-00ee00000001'
   from drafts where id = 'e8000000-0000-4000-8000-0000000000ee'),
  '0', '…and the edit did not land (the state pin behind the refusal — a message alone proves nothing)');
select lives_ok(
  $$ select public.draft_adjust_budget('e8000000-0000-4000-8000-0000000000ee',
       'd8000000-0000-4000-8000-00ee00000001', -49) $$,
  'E28 ARM 3 BOUNDARY — one dollar more and it lands: max bid falls to exactly the standing high bid (D146''s pair)');
-- (privileged bracket — see the note at §F)
reset role;
select is(
  (select b.max_bid from public.draft_team_budget('e8000000-0000-4000-8000-0000000000ee',
                                 'd8000000-0000-4000-8000-00ee00000001') b),
  100, '…max bid = high bid exactly, so the close is still affordable');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_adjust_budget('e8000000-0000-4000-8000-0000000000ee',
       'd8000000-0000-4000-8000-00ee00000001', 0) $$,
  '22023',
  'draft_adjust_budget: delta must be a non-zero integer — say how many dollars to add or remove',
  'a ZERO delta is refused rather than posted as a no-op (the D63 convention is for repeated commands, not degenerate arguments)');
select throws_ok(
  $$ select public.draft_adjust_budget('e8000000-0000-4000-8000-0000000000bb',
       'd8000000-0000-4000-8000-00bb00000001', 10) $$,
  'P0001',
  'draft_adjust_budget: this is a snake draft — budgets apply to auctions only (§8.6)',
  '…and a snake draft has no budget to adjust');

-- ---------------------------------------------------------------------------
-- G. D162 — THE AMBIGUITY R363 COULD NOT CLOSE, built through the REAL VERBS
--    and closed. `player_id` alone cannot separate a cancelled nomination
--    from its renomination when the SAME nominator renominates the SAME
--    player at the SAME amount; `voided_at` can.
-- ---------------------------------------------------------------------------
-- LC is paused, nominating, seq 1, t1 on the clock, one VOIDED $5 row on
-- cm5-rb10 from §D. Resume, then let the CLOCK nominate so the two rows
-- differ in the one column attribution reads (action_id NULL vs not).
select lives_ok(
  $$ select public.draft_resume('e8000000-0000-4000-8000-0000000000cc') $$,
  'LC resumes into the NOMINATING phase (D143''s "the same nominator renominates")');
reset role;
-- PAST deadline + disconnect_grace_seconds (30s), not merely past the
-- deadline: LC's on-clock seat is a HUMAN with no heartbeat row, so it is
-- STALE and D129(3)/§8.5.5 hold its nomination open through the grace window.
-- A −1s deadline would leave the tick reporting `auction_held_for_grace` and
-- every assertion below would then be reading a board nothing had moved.
update drafts set current_deadline = now() - interval '60 seconds'
where id = 'e8000000-0000-4000-8000-0000000000cc';
select set_config('pgtap.cm5_g1', public.draft_tick()::text, true);
-- Now seq 1 carries: the VOIDED human $5 row on cm5-rb10, and a LIVE system
-- row the clock just wrote. Force the clock's pick to be the same player at
-- the same amount so nothing but voided_at separates them, then make the
-- voided row WIN the tiebreak the ordering would otherwise apply.
update drafts set current_nomination =
  jsonb_build_object('player_id', 'cm5-rb10', 'high_bid', 5,
                     'high_bidder_team_id', 'd8000000-0000-4000-8000-00cc00000001')
where id = 'e8000000-0000-4000-8000-0000000000cc';
update draft_bids set player_id = 'cm5-rb10', amount = 5,
                      team_id = 'd8000000-0000-4000-8000-00cc00000001'
where draft_id = 'e8000000-0000-4000-8000-0000000000cc' and voided_at is null;
-- WHY THE ID IS REWRITTEN, stated rather than left to look arbitrary: `now()`
-- is transaction-stable inside a pgTAP file, so every row here shares one
-- created_at and ARM 2.6's `ORDER BY created_at DESC, id DESC` falls entirely
-- to a random gen_random_uuid(). Pinning the VOIDED row's id to the maximum
-- makes the ordering deterministically prefer the WRONG row — which is
-- exactly what turns break probe 2 into a stable single number instead of a
-- coin flip. (This is F67's mechanism, used deliberately instead of tripped
-- over.)
update draft_bids set id = 'ffffffff-ffff-4fff-bfff-ffffffffffff'
where draft_id = 'e8000000-0000-4000-8000-0000000000cc' and voided_at is not null;
select is(
  (select count(*) from draft_bids
   where draft_id = 'e8000000-0000-4000-8000-0000000000cc'
     and nomination_seq = 1 and player_id = 'cm5-rb10' and amount = 5
     and team_id = 'd8000000-0000-4000-8000-00cc00000001'),
  2::bigint,
  'D162 SETUP: ONE sequence number now carries TWO rows identical in every column R363''s lookup discriminates on — the state D143 makes reachable and `player_id` cannot separate');
select is(
  (select count(*) from draft_bids
   where draft_id = 'e8000000-0000-4000-8000-0000000000cc' and voided_at is not null),
  1::bigint, '…exactly one of them is VOIDED (the cancelled nomination''s), and it is the one the ORDER BY prefers');
update drafts set current_deadline = now() - interval '1 second'
where id = 'e8000000-0000-4000-8000-0000000000cc';
select set_config('pgtap.cm5_g2', public.draft_tick()::text, true);
select is(
  (select made_via from draft_picks
   where draft_id = 'e8000000-0000-4000-8000-0000000000cc' and is_undone = false),
  'autopick',
  'D162 PAYOFF: the award attributes the LIVE row''s actor — here the CLOCK, which made this nomination. Without `voided_at IS NULL` the ordering hands it the VOIDED human row and this reads ''manager'': a manager publicly credited with a nomination they cancelled, on a player the clock chose');
select is(
  (select is_auto from draft_picks
   where draft_id = 'e8000000-0000-4000-8000-0000000000cc' and is_undone = false),
  true, '…and is_auto follows the same row (D130 "per actor", D160(3))');
select is(
  (select player_id || '/' || price from draft_picks
   where draft_id = 'e8000000-0000-4000-8000-0000000000cc' and is_undone = false),
  'cm5-rb10/5',
  '…while the player and the price are unaffected either way — which is why ONLY the attribution pin moves under the probe (named so nobody counts these as coverage)');

-- ---------------------------------------------------------------------------
-- H. draft_reverse_won_bid (D131(1)) + the E29 cascade (D131(2)).
-- ---------------------------------------------------------------------------
reset role;
-- LF: three settled nominations, each with its opening bid row (F62), plus a
-- live nomination at seq 4. Nominators are t1, t2, t3, t4 in order.
insert into draft_picks (draft_id, league_id, pick_number, round, team_id,
                         player_id, price, is_auto, made_via) values
  ('e8000000-0000-4000-8000-0000000000ff', 'b8000000-0000-4000-8000-0000000000ff',
   1, null, 'd8000000-0000-4000-8000-00ff00000001', 'cm5-rb40', 30, false, 'manager'),
  ('e8000000-0000-4000-8000-0000000000ff', 'b8000000-0000-4000-8000-0000000000ff',
   2, null, 'd8000000-0000-4000-8000-00ff00000002', 'cm5-rb41', 20, false, 'manager'),
  ('e8000000-0000-4000-8000-0000000000ff', 'b8000000-0000-4000-8000-0000000000ff',
   3, null, 'd8000000-0000-4000-8000-00ff00000003', 'cm5-rb42', 10, true,  'autopick');
insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id,
                        amount, action_id)
select 'e8000000-0000-4000-8000-0000000000ff', 'b8000000-0000-4000-8000-0000000000ff',
       s.seq, s.pl, ('d8000000-0000-4000-8000-00ff0000000' || s.seq)::uuid, s.amt, null
from (values (1, 'cm5-rb40', 30), (2, 'cm5-rb41', 20),
             (3, 'cm5-rb42', 10), (4, 'cm5-rb43', 6)) as s(seq, pl, amt);
update drafts set current_pick_number = 4,
  on_clock_team_id   = 'd8000000-0000-4000-8000-00ff00000004',
  current_nomination = '{"player_id": "cm5-rb43", "high_bid": 6,
                         "high_bidder_team_id": "d8000000-0000-4000-8000-00ff00000004"}'::jsonb,
  status = 'paused', deadline_remaining_ms = 30000, current_deadline = null
where id = 'e8000000-0000-4000-8000-0000000000ff';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
-- (privileged bracket — see the note at §F)
reset role;
select is(
  (select b.remaining || '/' || b.open_slots
   from public.draft_team_budget('e8000000-0000-4000-8000-0000000000ff',
                                 'd8000000-0000-4000-8000-00ff00000002') b),
  '180/2', 'LF baseline: t2 spent $20 of $200 on 1 of 3 spots');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_reverse_won_bid('e8000000-0000-4000-8000-0000000000ff',
       (select id from draft_picks
        where draft_id = 'e8000000-0000-4000-8000-0000000000ff' and pick_number = 2)) $$,
  'D131(1): the commissioner reverses t2''s won bid on a PAUSED auction');
select is(
  (select is_undone from draft_picks
   where draft_id = 'e8000000-0000-4000-8000-0000000000ff' and pick_number = 2),
  true, 'REVERSE GOLDEN (1): the pick is SOFT-undone — the row stays for the §12.4 audit trail');
-- (privileged bracket — see the note at §F)
reset role;
select is(
  (select b.remaining || '/' || b.open_slots
   from public.draft_team_budget('e8000000-0000-4000-8000-0000000000ff',
                                 'd8000000-0000-4000-8000-00ff00000002') b),
  '200/3',
  'REVERSE GOLDEN (2): the budget is restored BY DERIVATION — nothing was written back, because there is no stored counter to write (D127)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select count(*) from draft_picks
   where draft_id = 'e8000000-0000-4000-8000-0000000000ff'
     and player_id = 'cm5-rb41' and is_undone = false),
  0::bigint, 'REVERSE GOLDEN (3): the player is back in the pool (the partial index frees him)');
select is(
  (select count(*) from draft_bids
   where draft_id = 'e8000000-0000-4000-8000-0000000000ff'
     and nomination_seq = 2 and voided_at is not null),
  0::bigint,
  'D162 SCOPE, stated as a pin: a REVERSAL does not void bids — it consumes no sequence number and rewinds nothing, so the reversal lives on draft_picks.is_undone where reversals have always lived');
-- (privileged bracket — see the note at §F)
reset role;
select ok(
  (select public.draft_auction_solvent('e8000000-0000-4000-8000-0000000000ff')),
  'REVERSE GOLDEN (4): §8.6.8 holds — a reversal is solvency-INCREASING by construction (D131(3)), asserted rather than assumed');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_reverse_won_bid('e8000000-0000-4000-8000-0000000000bb',
       '00000000-0000-4000-8000-0000000000b1') $$,
  'P0001',
  'draft_reverse_won_bid: this is a snake draft — there are no won bids to reverse; use Undo or Edit pick instead (§8.7)',
  'a SNAKE pick has no won bid to reverse — refused by type, with a pointer to Undo/Edit pick');

-- E29: the cascade voids the live nomination FIRST, then reverts.
select lives_ok(
  $$ select public.draft_undo('e8000000-0000-4000-8000-0000000000ff', 1) $$,
  'E29: cascade undo back to pick 1 on the paused auction');
select is(
  (select current_nomination from drafts where id = 'e8000000-0000-4000-8000-0000000000ff'),
  null, 'E29 GOLDEN (1): the live nomination is VOIDED FIRST (D131(2)) — no award, no money moved');
select is(
  (select count(*) from draft_picks
   where draft_id = 'e8000000-0000-4000-8000-0000000000ff' and is_undone = false),
  1::bigint, 'E29 GOLDEN (2): every pick after 1 is reverted');
select is(
  (select on_clock_team_id from drafts where id = 'e8000000-0000-4000-8000-0000000000ff'),
  'd8000000-0000-4000-8000-00ff00000002'::uuid,
  'E29 GOLDEN (3): on_clock rewinds to the TARGET NOMINATION''S NOMINATOR — read off the opening bid row (F62), because an auction has no positional derivation to redo');
select is(
  (select deadline_remaining_ms from drafts where id = 'e8000000-0000-4000-8000-0000000000ff'),
  45000, 'E29 GOLDEN (4): a FRESH NOMINATION clock (45s), not a stale pick-clock number');
select is(
  (select count(*) from draft_bids
   where draft_id = 'e8000000-0000-4000-8000-0000000000ff'
     and nomination_seq > 1 and voided_at is null),
  0::bigint,
  'D162: every rewound-onto sequence is voided — current_pick_number is about to re-issue those numbers, and leaving the rows live would merge two nominations under one seq');

-- ---------------------------------------------------------------------------
-- I. The priced Manual Edit Mode paths (D142) — max-bid validation with its
--    one-unit-short partner, plus the snake refusal.
-- ---------------------------------------------------------------------------
reset role;
-- LG: t1 holds cm5-rb50 at $50. t2 is untouched ⇒ remaining 200, open 3,
-- max_bid = 200 − 2×1 = 198.
insert into draft_picks (draft_id, league_id, pick_number, round, team_id,
                         player_id, price, is_auto, made_via)
values ('e8000000-0000-4000-8000-0000000000a1',
        'b8000000-0000-4000-8000-0000000000a1', 1, null,
        'd8000000-0000-4000-8000-00a100000001', 'cm5-rb50', 50, false, 'manager');
update drafts set status = 'paused', current_pick_number = 2,
                  current_deadline = null, deadline_remaining_ms = 45000
where id = 'e8000000-0000-4000-8000-0000000000a1';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_move_player('e8000000-0000-4000-8000-0000000000a1', 'cm5-rb50',
       'd8000000-0000-4000-8000-00a100000001', 'd8000000-0000-4000-8000-00a100000002',
       null, 199) $$,
  'P0001',
  'draft_move_player: $199 is over that team''s max bid of $198 — they have $200 for 3 open roster spots at a $1 minimum bid; reverse a won bid or adjust their budget first (E28/§8.6.8)',
  'D142 PRICED MOVE — ONE DOLLAR OVER the receiving team''s max bid ($198) is refused, the same algebra the award uses (E28-class, §8.6.8) (D146)');
select is(
  (select team_id from draft_picks
   where draft_id = 'e8000000-0000-4000-8000-0000000000a1' and pick_number = 1),
  'd8000000-0000-4000-8000-00a100000001'::uuid,
  '…and the player did NOT move (the state pin behind the refusal)');
select throws_ok(
  $$ select public.draft_move_player('e8000000-0000-4000-8000-0000000000a1', 'cm5-rb50',
       'd8000000-0000-4000-8000-00a100000001', 'd8000000-0000-4000-8000-00a100000002') $$,
  '22023',
  'draft_move_player: this is an auction — re-enter the price this pick should cost the receiving team (§8.7 Manual Edit Mode)',
  'D142: the cost must be RE-ENTERED on an auction — a silent price carry-over is what the ruling replaced');
select lives_ok(
  $$ select public.draft_move_player('e8000000-0000-4000-8000-0000000000a1', 'cm5-rb50',
       'd8000000-0000-4000-8000-00a100000001', 'd8000000-0000-4000-8000-00a100000002',
       null, 198) $$,
  'D142 BOUNDARY — one dollar less and it lands: price EQUALS max bid exactly (D146''s pair)');
select is(
  (select team_id::text || '/' || price from draft_picks
   where draft_id = 'e8000000-0000-4000-8000-0000000000a1' and pick_number = 1),
  'd8000000-0000-4000-8000-00a100000002/198',
  '…the pick changes hands AND carries the re-entered cost (§12.4''s price rides the row)');
-- (privileged bracket — see the note at §F)
reset role;
select ok(
  (select public.draft_auction_solvent('e8000000-0000-4000-8000-0000000000a1')),
  '…and §8.6.8 still holds at exact equality — the rule-7 backstop agreeing with the targeted check');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_move_player('e8000000-0000-4000-8000-0000000000bb', 'cm5-rb01',
       'd8000000-0000-4000-8000-00bb00000001', 'd8000000-0000-4000-8000-00bb00000002',
       null, 10) $$,
  'P0001',
  'draft_move_player: this is a snake draft — its picks carry no price (§12.4)',
  'the converse: a price on a SNAKE move is refused rather than silently stored on a column snake never reads');
select lives_ok(
  $$ select public.draft_reassign_pick('e8000000-0000-4000-8000-0000000000a1',
       (select id from draft_picks where draft_id = 'e8000000-0000-4000-8000-0000000000a1'
        and pick_number = 1),
       p_price => 20) $$,
  'a SAME-TEAM price correction needs no re-entry ceremony — nothing changes hands, so nothing is charged');
select is(
  (select price from draft_picks
   where draft_id = 'e8000000-0000-4000-8000-0000000000a1' and pick_number = 1),
  20, '…and the corrected price lands');

-- --- I(b). THE SAME PATHS AGAINST A LIVE HIGH BID — E28 ARM 3 (R367) ------
-- WHY THIS EXISTS AND WHY §I ABOVE COULD NOT HAVE CAUGHT IT: LG is paused
-- with NO live nomination, so every pin above runs in a world where E28's
-- third arm is vacuously satisfied. A reviewer drove the gap on a world that
-- HAS one: the commissioner moved a priced player onto the LIVE HIGH BIDDER,
-- the pre-write `price <= max_bid` passed (it measures the world BEFORE the
-- pick lands), `draft_auction_solvent` stayed TRUE (a bid holds no money —
-- D131(2) — so no derivation sees it), and the next tick then refused the
-- award forever: the D160(8) stuck clock, manufactured by the very verb whose
-- comment claimed the door was shut. LH is that world.
--
-- LH: 8 seats, budget $200, min_bid $1, 3 slots. t2 holds cm5-rb41 at $10 and
-- IS the live high bidder on cm5-rb40 at $150; t3 holds cm5-rb42 at $10.
--   t2 now:  committed 10, remaining 190, open 2, max_bid 190 − 1×1 = 189
--            ⇒ 150 <= 189, so the board is legal BEFORE any edit.
reset role;
insert into draft_picks (draft_id, league_id, pick_number, round, team_id,
                         player_id, price, is_auto, made_via) values
  ('e8000000-0000-4000-8000-0000000000a5', 'b8000000-0000-4000-8000-0000000000a5',
   1, null, 'd8000000-0000-4000-8000-00a500000002', 'cm5-rb41', 10, false, 'manager'),
  ('e8000000-0000-4000-8000-0000000000a5', 'b8000000-0000-4000-8000-0000000000a5',
   2, null, 'd8000000-0000-4000-8000-00a500000003', 'cm5-rb42', 10, false, 'manager');
-- The nomination and its bid rows (F62: every nomination opens with one).
insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id,
                        amount, action_id) values
  ('e8000000-0000-4000-8000-0000000000a5', 'b8000000-0000-4000-8000-0000000000a5',
   3, 'cm5-rb40', 'd8000000-0000-4000-8000-00a500000001', 1,
   '11111111-0000-4000-8000-00000000a501'),
  ('e8000000-0000-4000-8000-0000000000a5', 'b8000000-0000-4000-8000-0000000000a5',
   3, 'cm5-rb40', 'd8000000-0000-4000-8000-00a500000002', 150,
   '11111111-0000-4000-8000-00000000a502');
update drafts set status = 'paused', current_pick_number = 3,
                  current_deadline = null, deadline_remaining_ms = 30000,
                  current_nomination =
                    '{"player_id": "cm5-rb40", "high_bid": 150,
                      "high_bidder_team_id": "d8000000-0000-4000-8000-00a500000002"}'::jsonb
where id = 'e8000000-0000-4000-8000-0000000000a5';
select is(
  (select b.remaining || '/' || b.open_slots || '/' || b.max_bid
   from draft_team_budget('e8000000-0000-4000-8000-0000000000a5',
                          'd8000000-0000-4000-8000-00a500000002') b),
  '190/2/189',
  'LH BEFORE half: the high bidder can afford its own $150 bid (max bid $189) — the board this section edits is LEGAL to start with');

-- THE LOAD-BEARING MEASUREMENT: the rule-7 backstop CANNOT catch this class.
-- The post-edit world is FORGED privileged here (price 10 -> 50 on t2's pick),
-- measured, and restored — so the pins below are refusing something that
-- `draft_auction_solvent` demonstrably calls fine.
update draft_picks set price = 50
where draft_id = 'e8000000-0000-4000-8000-0000000000a5' and pick_number = 1;
select ok(
  (select draft_auction_solvent('e8000000-0000-4000-8000-0000000000a5')),
  'R367 (the reason arm 3 exists): in the POST-EDIT world draft_auction_solvent is TRUE — remaining $150 >= 2 open x $1 — so the §4-rule-7 backstop does NOT fire');
select is(
  (select b.max_bid from draft_team_budget('e8000000-0000-4000-8000-0000000000a5',
                                           'd8000000-0000-4000-8000-00a500000002') b),
  149,
  '…and yet the max bid is $149 against a STANDING $150 bid: solvent by the floor, unaffordable at the close — the stuck clock, one derivation apart');
update draft_picks set price = 10
where draft_id = 'e8000000-0000-4000-8000-0000000000a5' and pick_number = 1;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

-- ARM (1) — THE SAME-TEAM PRICE-ONLY PATH. The worst of the three: the
-- pre-write max-bid check is guarded by `recv IS DISTINCT FROM old_owner`, so
-- before R367 this path ran NO max-bid check of any kind.
select throws_ok(
  $$ select public.draft_reassign_pick('e8000000-0000-4000-8000-0000000000a5',
       (select id from draft_picks where draft_id = 'e8000000-0000-4000-8000-0000000000a5'
        and pick_number = 1),
       p_price => 50) $$,
  'P0001',
  'draft_reassign_pick: pgtap-cm5-a5-t2 is the high bidder on CM5 RB 40 at $150, and that leaves a max bid of $149 — the close would be unaffordable. Void the nomination (Edit current nomination — the board is already paused) or reverse a won bid first (E28/D131(4))',
  'R367 ARM 1 — a SAME-TEAM price correction that shrinks the live high bidder below its own standing bid is REFUSED (E28 arm 3, D131(4))');
select is(
  (select price from draft_picks
   where draft_id = 'e8000000-0000-4000-8000-0000000000a5' and pick_number = 1),
  10, '…and the price did NOT move (the state pin behind the refusal — the RAISE rolled the UPDATE back)');
select lives_ok(
  $$ select public.draft_reassign_pick('e8000000-0000-4000-8000-0000000000a5',
       (select id from draft_picks where draft_id = 'e8000000-0000-4000-8000-0000000000a5'
        and pick_number = 1),
       p_price => 49) $$,
  'ONE DOLLAR LESS AND IT LANDS (D146): $49 leaves max bid $150 — EQUAL to the high bid, which the award can pay');
-- (privileged bracket — draft_team_budget carries a triple REVOKE: it has no
-- client consumer, so only a privileged reader may ask it. Same pattern as §F.)
reset role;
select is(
  (select b.max_bid from draft_team_budget('e8000000-0000-4000-8000-0000000000a5',
                                           'd8000000-0000-4000-8000-00a500000002') b),
  150,
  '…and the boundary is measured through the ONE family: max bid EXACTLY equals the standing bid (D127/§4.7)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

-- ARM (2) — THE CROSS-TEAM MOVE, the arm the reviewer drove. t2 now sits at
-- remaining $151 / open 2 / max_bid $150, so a $2 move leaves max_bid $149.
select throws_ok(
  $$ select public.draft_move_player('e8000000-0000-4000-8000-0000000000a5', 'cm5-rb42',
       'd8000000-0000-4000-8000-00a500000003', 'd8000000-0000-4000-8000-00a500000002',
       null, 2) $$,
  'P0001',
  'draft_move_player: pgtap-cm5-a5-t2 is the high bidder on CM5 RB 40 at $150, and that leaves a max bid of $149 — the close would be unaffordable. Void the nomination (Edit current nomination — the board is already paused) or reverse a won bid first (E28/D131(4))',
  'R367 ARM 2 — a CROSS-TEAM move onto the live high bidder is REFUSED even at $2, because the SLOT it consumes is what shrinks the max bid');
select is(
  (select team_id from draft_picks
   where draft_id = 'e8000000-0000-4000-8000-0000000000a5' and pick_number = 2),
  'd8000000-0000-4000-8000-00a500000003'::uuid,
  '…and the player did NOT move');

-- ARM (3) — THE CROSS-TEAM REASSIGN. Same economics, different verb: the two
-- share the helper, so this pin is what proves they cannot drift apart.
select throws_ok(
  $$ select public.draft_reassign_pick('e8000000-0000-4000-8000-0000000000a5',
       (select id from draft_picks where draft_id = 'e8000000-0000-4000-8000-0000000000a5'
        and pick_number = 2),
       p_team_id => 'd8000000-0000-4000-8000-00a500000002', p_price => 2) $$,
  'P0001',
  'draft_reassign_pick: pgtap-cm5-a5-t2 is the high bidder on CM5 RB 40 at $150, and that leaves a max bid of $149 — the close would be unaffordable. Void the nomination (Edit current nomination — the board is already paused) or reverse a won bid first (E28/D131(4))',
  'R367 ARM 3 — the reassign twin refuses identically (ONE helper, D141''s no-drift pattern applied to E28 arm 3)');
select is(
  (select team_id from draft_picks
   where draft_id = 'e8000000-0000-4000-8000-0000000000a5' and pick_number = 2),
  'd8000000-0000-4000-8000-00a500000003'::uuid,
  '…and that pick did NOT change hands either');
select lives_ok(
  $$ select public.draft_move_player('e8000000-0000-4000-8000-0000000000a5', 'cm5-rb42',
       'd8000000-0000-4000-8000-00a500000003', 'd8000000-0000-4000-8000-00a500000002',
       null, 1) $$,
  'ONE DOLLAR LESS AND IT LANDS (D146): a $1 move leaves max bid $150 — equality again, from the move side');
select is(
  (select team_id::text || '/' || price from draft_picks
   where draft_id = 'e8000000-0000-4000-8000-0000000000a5' and pick_number = 2),
  'd8000000-0000-4000-8000-00a500000002/1',
  '…the pick changed hands and carries the re-entered cost');
reset role;
select is(
  (select b.remaining || '/' || b.open_slots || '/' || b.max_bid
   from draft_team_budget('e8000000-0000-4000-8000-0000000000a5',
                          'd8000000-0000-4000-8000-00a500000002') b)
  || '/' || (select draft_auction_solvent('e8000000-0000-4000-8000-0000000000a5'))::text,
  '150/1/150/true',
  'LH AFTER half: the high bidder can STILL afford its $150 bid at the boundary, and the board is solvent — the two edits that landed left the award payable');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

-- ---------------------------------------------------------------------------
-- J. draft_force_pick's auction arm (R301): force-NOMINATE in the nominating
--    phase; NO force-bid exists, deliberately.
-- ---------------------------------------------------------------------------
-- LA is paused mid-BIDDING from §C. Resume it: force pick is not pause-gated,
-- and the bidding-phase refusal needs a live board.
select lives_ok(
  $$ select public.draft_resume('e8000000-0000-4000-8000-0000000000aa') $$,
  'resume LA (force pick is NOT in D141''s gated set — it is the control you reach for while the clock runs)');
select throws_ok(
  $$ select public.draft_force_pick('e8000000-0000-4000-8000-0000000000aa', 'cm5-rb04') $$,
  'P0001',
  'draft_force_pick: bidding is already open on CM5 RB 02 at $9 — a commissioner cannot bid for a manager (§8.6.5); the clock awards the high bidder when it expires',
  'R301: in the BIDDING phase a commissioner force is REFUSED — absent managers do not bid (§8.6.5/OQ 10) and the close needs no force. There is deliberately no force-bid');
select lives_ok(
  $$ select public.draft_pause('e8000000-0000-4000-8000-0000000000aa') $$,
  'pause LA (cancel is gated, force is not — the two halves of D141''s list, side by side)');
select lives_ok(
  $$ select public.draft_cancel_nomination('e8000000-0000-4000-8000-0000000000aa') $$,
  'cancel LA back into the NOMINATING phase');
select lives_ok(
  $$ select public.draft_resume('e8000000-0000-4000-8000-0000000000aa') $$,
  'resume LA');
select lives_ok(
  $$ select public.draft_force_pick('e8000000-0000-4000-8000-0000000000aa', 'cm5-rb04') $$,
  'R301: in the NOMINATING phase the commissioner force-NOMINATES for the team on the clock');
select is(
  (select current_nomination->>'player_id' || '/' || (current_nomination->>'high_bid')
   from drafts where id = 'e8000000-0000-4000-8000-0000000000aa'),
  'cm5-rb04/1',
  'FORCE-NOMINATE GOLDEN: the nomination opens exactly as the seat''s own would — at auction_min_bid (D129(1))');
select is(
  (select count(*) from draft_bids
   where draft_id = 'e8000000-0000-4000-8000-0000000000aa'
     and player_id = 'cm5-rb04' and action_id is not null and voided_at is null),
  1::bigint,
  '…writing its opening bid row with a NON-NULL action_id — MINTED when the caller supplies none, because a commissioner nomination is a human act and a NULL would make an unraised close read as an autopick (D130/D160(3))');
-- The §8.6.7(a) affordability rule, one unit either side, on a starved seat.
reset role;
update drafts set budget_adjustments =
  jsonb_build_object('d8000000-0000-4000-8000-00aa00000004', -198)
where id = 'e8000000-0000-4000-8000-0000000000aa';
update drafts set current_nomination = null,
  on_clock_team_id = 'd8000000-0000-4000-8000-00aa00000004'
where id = 'e8000000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
-- (privileged bracket — see the note at §F)
reset role;
select is(
  (select b.remaining || '/' || b.open_slots || '/' || b.max_bid
   from public.draft_team_budget('e8000000-0000-4000-8000-0000000000aa',
                                 'd8000000-0000-4000-8000-00aa00000004') b),
  '2/3/0', 't4 is starved to $2 against 3 open spots — max bid $0, exactly ONE dollar short of the $1 minimum bid');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_force_pick('e8000000-0000-4000-8000-0000000000aa', 'cm5-rb05') $$,
  'P0001',
  'draft_force_pick: pgtap-cm5-aa-t4 cannot afford the $1 minimum bid — max bid is $0 ($2 for 3 open spots) (§8.6.7(a))',
  '§8.6.7(a) ONE UNIT SHORT: a force-nomination is validated exactly as the seat''s own would be, and a seat that cannot afford the minimum bid is REFUSED — no commissioner bypass (D146)');
reset role;
update drafts set budget_adjustments =
  jsonb_build_object('d8000000-0000-4000-8000-00aa00000004', -197)
where id = 'e8000000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_force_pick('e8000000-0000-4000-8000-0000000000aa', 'cm5-rb05') $$,
  '…and one dollar more — $3 remaining, max bid exactly $1 — it lands (D146''s discriminating pair)');

-- ---------------------------------------------------------------------------
-- K. draft_reset's auction hygiene (R302).
-- ---------------------------------------------------------------------------
reset role;
update drafts set current_nomination =
  '{"player_id": "cm5-rb55", "high_bid": 12,
    "high_bidder_team_id": "d8000000-0000-4000-8000-00a300000002"}'::jsonb,
  budget_adjustments = '{"d8000000-0000-4000-8000-00a300000002": 25}'::jsonb,
  current_pick_number = 3
where id = 'e8000000-0000-4000-8000-0000000000a3';
insert into draft_picks (draft_id, league_id, pick_number, round, team_id,
                         player_id, price, is_auto, made_via)
values ('e8000000-0000-4000-8000-0000000000a3',
        'b8000000-0000-4000-8000-0000000000a3', 1, null,
        'd8000000-0000-4000-8000-00a300000001', 'cm5-rb56', 8, false, 'manager');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_reset('e8000000-0000-4000-8000-0000000000a3') $$,
  'R302: reset a mid-BIDDING auction');
select is(
  (select current_nomination from drafts where id = 'e8000000-0000-4000-8000-0000000000a3'),
  null,
  'R302 (1): current_nomination is CLEARED — without this, D126''s phase rule resurrects a ghost nomination the moment the draft restarts');
select is(
  (select budget_adjustments from drafts where id = 'e8000000-0000-4000-8000-0000000000a3'),
  '{}'::jsonb,
  'R302 (2): budget_adjustments is CLEARED — they were corrections to a draft that no longer exists (§8.7''s own "back to pre-draft")');
select is(
  (select status || '/' || current_pick_number from drafts
   where id = 'e8000000-0000-4000-8000-0000000000a3'),
  'scheduled/1', '…and 069''s reset semantics are otherwise untouched');

-- R373 — A SECOND SNAKE/AUCTION COMMISSIONER-UX DIVERGENCE, PINNED RATHER
-- THAN ALIGNED. draft_set_order's auction arm REFUSES a pre-start edit and
-- points at League settings (nomination_order_mode lives there, §7.3.8);
-- 069's snake arm ACCEPTS one and stores it for draft_start to honor
-- (D101/R123, pinned in 023:1248 on a scheduled snake draft). It is a UX
-- asymmetry, not a hole — the auction's pre-start order has a real editor and
-- the message names it — so the divergence is PINNED here and recorded beside
-- F57 rather than changed: aligning it would be a behavior change to a
-- shipped verb in a fix cycle, and which way it should align is the same
-- standing product question F57 already carries. The reset above is what puts
-- an AUCTION back into `scheduled`, which is the only way to reach this arm.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_set_order('e8000000-0000-4000-8000-0000000000a3',
       (select array_agg(t.id order by t.name) from teams t
        where t.league_id = 'b8000000-0000-4000-8000-0000000000a3')) $$,
  'P0001',
  'draft_set_order: this auction has not started — set nomination_order_mode and its order in League settings before the draft (§7.3.8)',
  'R373: a SCHEDULED auction refuses a pre-start order edit — where a scheduled SNAKE draft accepts one (023:1248). Divergence pinned, F57-adjacent');
reset role;

-- ---------------------------------------------------------------------------
-- L. draft_end — C41's RULED end-as-is (spec v2.10.1 §8.7).
-- ---------------------------------------------------------------------------
reset role;
-- LI: 2 of 12 possible spots filled, and a live nomination that must NOT be
-- awarded.
insert into draft_picks (draft_id, league_id, pick_number, round, team_id,
                         player_id, price, is_auto, made_via) values
  ('e8000000-0000-4000-8000-0000000000a2', 'b8000000-0000-4000-8000-0000000000a2',
   1, null, 'd8000000-0000-4000-8000-00a200000001', 'cm5-rb57', 20, false, 'manager'),
  ('e8000000-0000-4000-8000-0000000000a2', 'b8000000-0000-4000-8000-0000000000a2',
   2, null, 'd8000000-0000-4000-8000-00a200000002', 'cm5-rb58', 15, true,  'autopick');
insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id,
                        amount, action_id)
values ('e8000000-0000-4000-8000-0000000000a2', 'b8000000-0000-4000-8000-0000000000a2',
        3, 'cm5-rb59', 'd8000000-0000-4000-8000-00a200000003', 4, null);
update drafts set current_pick_number = 3,
  on_clock_team_id   = 'd8000000-0000-4000-8000-00a200000003',
  current_nomination = '{"player_id": "cm5-rb59", "high_bid": 4,
                         "high_bidder_team_id": "d8000000-0000-4000-8000-00a200000003"}'::jsonb
where id = 'e8000000-0000-4000-8000-0000000000a2';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_end('e8000000-0000-4000-8000-0000000000bb') $$,
  'P0001',
  'draft_end: this is a snake draft — ending early as-is is an auction control (§8.7, ruled v2.10.1); use Reset to wipe a snake draft',
  'draft_end is an AUCTION control (C41 ruled it for the auction) — a snake draft is refused by type rather than given an unruled behaviour');
select is(
  (select (public.draft_end('e8000000-0000-4000-8000-0000000000a2'))->>'unfilled_slots'),
  '22',
  'C41 GOLDEN (1): END-AS-IS reports 22 unfilled spots (8 seats × 3 slots − 2 filled), counted through the ONE family rather than guessed — a stored literal, so an off-by-one in the sum is visible');
select is(
  (select status from drafts where id = 'e8000000-0000-4000-8000-0000000000a2'),
  'complete', 'C41 GOLDEN (2): the draft is complete');
select is(
  (select status from leagues where id = 'b8000000-0000-4000-8000-0000000000a2'),
  'in_season', 'C41 GOLDEN (3): the league moves to in_season in the SAME transaction (§8.5 step 6 / §8.6.6)');
select is(
  (select count(*) from league_rosters
   where league_id = 'b8000000-0000-4000-8000-0000000000a2'),
  2::bigint,
  'C41 GOLDEN (4): rosters carry EXACTLY the existing picks — unfilled slots stay empty for free agency, they are not invented');
select is(
  (select string_agg(acquisition_cost::text, ',' order by acquisition_cost)
   from league_rosters where league_id = 'b8000000-0000-4000-8000-0000000000a2'),
  '15,20',
  'C41 GOLDEN (5): each roster row carries its WINNING PRICE (acquisition_cost = price — D111(3)/§12.7)');
select is(
  (select count(*) from draft_picks
   where draft_id = 'e8000000-0000-4000-8000-0000000000a2' and player_id = 'cm5-rb59'),
  0::bigint,
  'C41 GOLDEN (6): the live nomination is voided UN-AWARDED — the high bidder does not get the player and no money moves');
select is(
  (select count(*) from draft_bids
   where draft_id = 'e8000000-0000-4000-8000-0000000000a2' and voided_at is not null),
  1::bigint, '…and its bid row is stamped voided (D162), standing as history');
-- (privileged bracket — see the note at §F)
reset role;
select ok(
  (select public.draft_auction_solvent('e8000000-0000-4000-8000-0000000000a2')),
  'C41 GOLDEN (7): §8.6.8 is trivially preserved — ending spends nothing — PINNED rather than asserted in prose (§4 rule 7)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_end('e8000000-0000-4000-8000-0000000000a2') $$,
  'P0001',
  'draft_end: the draft is already complete',
  'a second end is refused by name');

-- ---------------------------------------------------------------------------
-- M. The per-verb authorisation sweep: non-commissioner 42501 (no-leak) and
--    the D138 mock refusal. Eleven verbs, measured — not "the same as 069".
-- ---------------------------------------------------------------------------
-- A MANAGER (u2) against LF, which is still a live-ish paused auction.
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_reverse_won_bid('e8000000-0000-4000-8000-0000000000ff',
       (select id from draft_picks where draft_id = 'e8000000-0000-4000-8000-0000000000ff' limit 1)) $$,
  '42501', 'draft_reverse_won_bid: not a commissioner of this draft''s league',
  'manager → draft_reverse_won_bid 42501');
select throws_ok(
  $$ select public.draft_adjust_budget('e8000000-0000-4000-8000-0000000000ff',
       'd8000000-0000-4000-8000-00ff00000002', 10) $$,
  '42501', 'draft_adjust_budget: not a commissioner of this draft''s league',
  'manager → draft_adjust_budget 42501');
select throws_ok(
  $$ select public.draft_cancel_nomination('e8000000-0000-4000-8000-0000000000ff') $$,
  '42501', 'draft_cancel_nomination: not a commissioner of this draft''s league',
  'manager → draft_cancel_nomination 42501');
select throws_ok(
  $$ select public.draft_end('e8000000-0000-4000-8000-0000000000ff') $$,
  '42501', 'draft_end: not a commissioner of this draft''s league',
  'manager → draft_end 42501');
-- An OUTSIDER gets the SAME message — no-leak (a nonexistent draft and a
-- foreign one are indistinguishable).
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_end('e8000000-0000-4000-8000-0000000000ff') $$,
  '42501', 'draft_end: not a commissioner of this draft''s league',
  'OUTSIDER → the identical 42501: league membership never leaks through an error message');
select throws_ok(
  $$ select public.draft_end('e8000000-0000-4000-8000-000000000999') $$,
  '42501', 'draft_end: not a commissioner of this draft''s league',
  '…and a NONEXISTENT draft answers the same way (is_league_commish(NULL) is FALSE)');

-- D138: every auction commissioner verb refuses a MOCK. LJ is a live auction
-- mock; the commissioner is refused even though they are the commissioner,
-- because a mock has no commissioner — only a launcher (D110(1)/D103(2)).
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_reverse_won_bid('e8000000-0000-4000-8000-0000000000a4',
       '00000000-0000-4000-8000-000000000001') $$,
  'P0001',
  'draft_reverse_won_bid: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_reverse_won_bid refuses a mock');
select throws_ok(
  $$ select public.draft_adjust_budget('e8000000-0000-4000-8000-0000000000a4',
       'd8000000-0000-4000-8000-00a400000001', 10) $$,
  'P0001',
  'draft_adjust_budget: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_adjust_budget refuses a mock');
select throws_ok(
  $$ select public.draft_cancel_nomination('e8000000-0000-4000-8000-0000000000a4') $$,
  'P0001',
  'draft_cancel_nomination: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_cancel_nomination refuses a mock');
select throws_ok(
  $$ select public.draft_end('e8000000-0000-4000-8000-0000000000a4') $$,
  'P0001',
  'draft_end: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_end refuses a mock');
-- R369(b): the 087 banner claimed "036 §H sweeps all eleven" and §H is the
-- reverse-won-bid/E29 section — the sweep is HERE and it covered the FOUR new
-- verbs only. The other seven are the 069 controls, and 025 does pin their
-- mock refusals; but THREE of them (set_clock, reassign, move) were DROPped
-- and re-CREATEd by this migration with new signatures and new bodies, so
-- "025 already pins it" is a claim about a function that no longer exists.
-- The eleven are therefore swept here, in the post-087 world.
select throws_ok(
  $$ select public.draft_set_clock('e8000000-0000-4000-8000-0000000000a4', 60) $$,
  'P0001',
  'draft_set_clock: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_set_clock refuses a mock (NEW BODY — 087 DROPped and re-CREATEd it for the three auction timers)');
select throws_ok(
  $$ select public.draft_undo('e8000000-0000-4000-8000-0000000000a4') $$,
  'P0001',
  'draft_undo: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_undo refuses a mock');
select throws_ok(
  $$ select public.draft_reassign_pick('e8000000-0000-4000-8000-0000000000a4',
       '00000000-0000-4000-8000-000000000001',
       p_team_id => 'd8000000-0000-4000-8000-00a400000002') $$,
  'P0001',
  'draft_reassign_pick: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_reassign_pick refuses a mock (NEW BODY — p_price widened the signature)');
select throws_ok(
  $$ select public.draft_move_player('e8000000-0000-4000-8000-0000000000a4', 'cm5-rb01',
       'd8000000-0000-4000-8000-00a400000001', 'd8000000-0000-4000-8000-00a400000002') $$,
  'P0001',
  'draft_move_player: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_move_player refuses a mock (NEW BODY — p_price widened the signature)');
select throws_ok(
  $$ select public.draft_force_pick('e8000000-0000-4000-8000-0000000000a4', 'cm5-rb01') $$,
  'P0001',
  'draft_force_pick: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_force_pick refuses a mock');
select throws_ok(
  $$ select public.draft_set_order('e8000000-0000-4000-8000-0000000000a4',
       (select array_agg(t.id order by t.name) from teams t
        where t.league_id = 'b8000000-0000-4000-8000-0000000000a4')) $$,
  'P0001',
  'draft_set_order: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_set_order refuses a mock');
select throws_ok(
  $$ select public.draft_reset('e8000000-0000-4000-8000-0000000000a4') $$,
  'P0001',
  'draft_reset: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_reset refuses a mock — the one whose bypass would be an outright §8.8 zero-side-effect breach (it writes leagues.status)');
select is(
  (select count(*) from draft_picks where draft_id = 'e8000000-0000-4000-8000-0000000000a4')
  + (select count(*) from draft_bids where draft_id = 'e8000000-0000-4000-8000-0000000000a4'),
  0::bigint,
  '…and the mock is UNTOUCHED by all ELEVEN — the §8.8 zero-side-effect contract, measured rather than inferred from the refusals');

-- D97: the system posts. Every state change above posted in the SAME
-- transaction as the change (never a follow-up write) — so they are all
-- readable here, by a MEMBER, on the draft's own chat context.
select set_config('request.jwt.claims',
  '{"sub": "9f000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select ok(
  (select count(*) >= 1 from league_chat
   where context = 'draft:e8000000-0000-4000-8000-0000000000dd'
     and is_system and message like 'Nomination cancelled by %comes off the block at $199%'),
  'D97: draft_cancel_nomination posted IN-TXN, naming the player and the price a bidder needs to hear (§16.3) — and a MEMBER can read it');
select ok(
  (select count(*) = 1 from league_chat
   where context = 'draft:e8000000-0000-4000-8000-0000000000a2'
     and is_system and message like 'Draft ended by %22 roster spots stay empty for free agency%'),
  'D97: draft_end posted IN-TXN with the unfilled-slot count in it');
select ok(
  (select count(*) = 1 from league_chat
   where context = 'draft:e8000000-0000-4000-8000-0000000000ff'
     and is_system and message like 'Won bid reversed by %refunded $20 (now $200 for 3 open spots)%'),
  'D97: draft_reverse_won_bid posted IN-TXN with the before/after money (§8.7''s before/after requirement)');
select ok(
  (select count(*) >= 1 from league_chat
   where context = 'draft:e8000000-0000-4000-8000-0000000000ee'
     and is_system and message like 'Budget adjusted by %total adjustment%max bid%'),
  'D97: draft_adjust_budget posted IN-TXN with the before/after budget numbers');

reset role;
select * from finish();
rollback;
