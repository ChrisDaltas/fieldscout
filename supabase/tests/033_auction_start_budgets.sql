-- ============================================================================
-- Auction budget derivation family + draft_start's auction arm — pgTAP 033
-- (migration 084, task L.C1.2; spec §8.6.1/§8.6.7(d)/§8.6.8, §8.3, §7.3.8,
-- §12.3; D126/D127/D129(1)/D91/D101/D105; E25/E27).
--
-- WHAT THIS FILE OWNS vs its neighbours: 020 owns draft_start's WRAPPER
-- path (commissioner gate, capacity boundary, D43 probes, order goldens)
-- and now also the auction START-SUCCEEDS pin through the real
-- `draft_start` as a signed-in commissioner; this file drives the ENGINE
-- privileged through `draft_start_internal(league, FALSE)` (the D107(2)
-- wrapper/internal split — the same call 068's D94 tick arm makes), so no
-- JWT claims are set anywhere here and every fixture stays in the
-- privileged context (D49(7) is satisfied trivially). The auction edition
-- of the D94 no-dead-end proof is this task's stack vitest
-- (auction-start-db.test.ts).
--
-- Falsifiability notes (§4.3):
--   * DERIVATION GOLDENS ARE STORED LITERALS, one set per size/config —
--     12-team $200/min-1 (remaining 200, open 16, max_bid 185),
--     8-team $300/min-2 (max_bid 272), $200/min-0 (max_bid 200 — C38's
--     degenerate floor), $50/min-3 (max_bid 8), and E25's $3-with-3-slots
--     (max_bid 1 — §8.6.7(d)'s "$1 max bid admits only $1").
--     **BREAK PROBE 1 (the max-bid formula), AS RUN:** dropping the `− 1`
--     from 084's max-bid formula turned **12 of these 71 pins RED** —
--     every pin whose max_bid is PRODUCED BY THE FORMULA BRANCH, which is
--     12 of the 14 assertions carrying a max_bid at all (the 12-team
--     golden + its all-twelve sweep, the four spend/undo/adjustment
--     quadruples, the per-team-adjustment pin, the $300/min-2 golden, the
--     negative-max_bid insolvency pin, E25, the ONE-SLOT-SHORT tuple, and
--     $50/min-3). The claim used to read "every pin whose tuple carries
--     max_bid", which was literally false and contradicted its own next
--     sentence (M3 batch-2 review, R322). The two that LOOK like max-bid
--     coverage and are not: E27's complete-roster tuple takes max_bid
--     from the open_slots ≤ 0 branch the probe never reaches, and the C38
--     min_bid-0 golden is blind to the probe by arithmetic (× 0 makes
--     both formulas read 200). Everything else here — the start shape,
--     the three nomination-order modes, the solvency booleans, the
--     loudness arms — is independent of the formula and stayed green.
--   * **BREAK PROBE 2 (the §8.6.8 floor itself) — the pin this file was
--     MISSING (M3 batch-2 review, R320).** Loosening the invariant to
--     `remaining >= (open_slots - 1) * min_bid` was invisible to the
--     original 66 pins: three fixtures LOOK like solvency coverage and
--     none discriminates — LE sits $25 BELOW the floor (both formulas
--     refuse), the FALSE pin has remaining 0 against 15 open slots (both
--     say false), and LG's E25 case sits exactly ON equality, 3 ≥ 3×1
--     (both say true). The two formulas disagree in exactly one place —
--     ONE SLOT SHORT — so this file now pins that state at BOTH layers:
--     the FUNCTION (a −$1 adjustment on an untouched LG seat: remaining 2
--     against 3 open slots → INSOLVENT) and the ENGINE (LN: a
--     settings-LEGAL $200/min-1 league whose pre-start −$185 adjustment
--     leaves $15 against 16 slots → the start REFUSES). Under the
--     loosened floor exactly those two go RED; reverted, 71/71 green.
--     Reproduced against the pre-fix file for the record: the shipped 66
--     pins have the SAME failure set with and without the mutation.
--   * SPEND, UNDO AND ADJUSTMENTS move the goldens in the printed
--     direction (D127): a $50 buy, an IS_UNDONE row that must NOT count,
--     and negative/positive budget_adjustments — each pinned as a literal
--     quadruple, so a derivation that silently ignored one of the three
--     inputs fails here rather than in a live auction.
--   * SOLVENCY IS PINNED BOTH WAYS (§8.6.8): TRUE on every fresh start
--     incl. the exact-equality boundary (E25's $3/3 slots is
--     remaining = open × min_bid to the dollar), FALSE the moment a
--     privileged over-spend row lands, and — the probe-2 pair above —
--     FALSE one dollar below that same equality with the AT-floor TRUE
--     restored immediately after, so the floor is bracketed from both
--     sides one slot apart. An invariant function that could only ever
--     say TRUE would prove nothing; one whose only negatives sit far from
--     the boundary proves almost as little.
--   * EVERY LOUD ARM IS PINNED (CLAUDE.md "never let nothing happened
--     mean it worked"): missing draft, foreign team, RETIRED seat (R321 —
--     it sits outside the invariant's team set, so a full-budget answer
--     for one would be the same trap as a foreign team's), snake draft,
--     unset capacity, and — the one that matters most — an auction with
--     NO active franchises raises instead of reporting a vacuous TRUE
--     from `bool_and` over zero rows.
--   * THE START BACKSTOP HAS TWO MESSAGES AND BOTH ARE PINNED (R318):
--     the settings-cause sentence (LE) names the budget, the D91
--     DRAFTABLE-slot count and the min bid; the per-team-cause sentence
--     (LN) names the franchise and its real numbers, because a
--     settings-legal league made insolvent by a §8.7 adjustment would
--     otherwise be refused by an arithmetically FALSE sentence pointing
--     at the wrong knob.
--   * THE RANDOM NOMINATION ORDER IS A STORED LITERAL against a FIXED
--     draft id (the 020 LK precedent), pinned equal to the seeded shuffle
--     AND **not equal to that same draft's own random draft order** —
--     which is what makes 084's derived-seed decision falsifiable: seed
--     the nomination shuffle with the draft id itself and the two orders
--     collapse into one, turning the inequality pin RED.
--   * THE §8.6.8 START BACKSTOP is pinned from both sides: a legal
--     at-the-settings-floor league starts, a below-floor league (only
--     constructible by bypassing the API validator, which is where
--     §7.3.8's floor lives — 061/D68(3)) is refused with the remedy in
--     the message and leaves NO partial state.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(71);

-- ---------------------------------------------------------------------------
-- A. Function form (§4.1 grants doctrine; plan §8.3)
-- ---------------------------------------------------------------------------
select has_function('public', 'draft_team_budget', array['uuid', 'uuid'],
  'draft_team_budget(uuid,uuid) exists — the ONE budget derivation (D127/§4.7)');
select has_function('public', 'draft_auction_solvent', array['uuid'],
  'draft_auction_solvent(uuid) exists — the §8.6.8 invariant');
select has_function('public', 'draft_nomination_order_internal',
  array['uuid', 'integer', 'text', 'jsonb', 'jsonb', 'uuid', 'text', 'jsonb', 'uuid', 'integer'],
  'draft_nomination_order_internal(...) exists — §8.3/§7.3.8 nomination-order resolution (098/AP.5 + 102/MS.8: trailing DEFAULTed p_config_order + slot pin — 7- and 8-arg call texts still bind)');
select ok(
  (select count(*) = 2 and bool_and(p.provolatile = 's') and bool_and(not p.prosecdef)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('draft_team_budget', 'draft_auction_solvent')),
  'both derivation functions are STABLE and SECURITY INVOKER (no DEFINER ⇒ no in-body auth owed — §4.1)');
select ok(
  (select count(*) = 3
      and coalesce(bool_and(array_to_string(p.proconfig, ',') = 'search_path=""'), false)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('draft_team_budget', 'draft_auction_solvent',
                       'draft_nomination_order_internal')),
  'all three carry the exact spec-form SET search_path = '''' (R70 pin)');
select ok(
  not has_function_privilege('anon', 'public.draft_team_budget(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_team_budget(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_auction_solvent(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_auction_solvent(uuid)', 'EXECUTE')
  and not has_function_privilege('anon',
        'public.draft_nomination_order_internal(uuid,integer,text,jsonb,jsonb,uuid,text,jsonb,uuid,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated',
        'public.draft_nomination_order_internal(uuid,integer,text,jsonb,jsonb,uuid,text,jsonb,uuid,integer)', 'EXECUTE'),
  'anon AND authenticated hold EXECUTE on none of the three (engine internals — triple REVOKE, the 062 form)');
select ok(
  has_function_privilege('service_role', 'public.draft_team_budget(uuid,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.draft_auction_solvent(uuid)', 'EXECUTE'),
  'service_role keeps EXECUTE (037''s explicit default ACL survives a PUBLIC revoke — the 020 mechanism)');
select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_start'),
  'draft_start (the wrapper) is untouched by 084 and still SECURITY DEFINER (D137: only the internal was replaced)');
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_start_internal'),
  'draft_start_internal keeps 066''s plain-function + search_path='''' posture after the CREATE OR REPLACE');
select ok(
  not has_function_privilege('anon', 'public.draft_start_internal(uuid,boolean,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_start_internal(uuid,boolean,timestamptz)', 'EXECUTE'),
  '…and 066''s triple REVOKE on the internal survives the replace');

-- ---------------------------------------------------------------------------
-- B. Fixtures (privileged; NO JWT claims are ever set in this file).
--    LA 12-team $200/min-1, manual order, nomination same_as_draft_order,
--       pick_timer_seconds 0 (the untimed-does-not-null-auction-clocks pin)
--    LB  8-team $300/min-2, nomination_order_mode random, drafts row
--        pre-created with a FIXED id so the shuffle is a stored literal
--    LC  8-team nomination_order_mode manual (refusal, then a valid order)
--    LD  8-team $200/min-0 (C38's degenerate floor)
--    LE  8-team $20/min-3 — BELOW the §7.3.8 floor (which lives API-side,
--        so this shape is constructible here): the start backstop refuses
--    LF  8-team $50/min-3 — legal at the settings floor (16 × 3 = 48 ≤ 50)
--    LG  8-team roster of THREE draftable slots, $3/min-1 — E25/§8.6.7(d)
--    LH  ZERO ACTIVE franchises (one RETIRED seat) + a hand-built auction
--        draft — the empty-set trap AND the R321 retired-seat arm
--    LI  one franchise + a hand-built draft with NULL total_rounds
--    LJ  one franchise, no draft row — the D96 capacity gate on an auction
--    LN  8-team $200/min-1 (settings-LEGAL) whose pre-created drafts row
--        carries a −$185 budget_adjustment on t1 — the ONE-SLOT-SHORT
--        start refusal and the R318 second message (M3 batch-2 review)
-- ---------------------------------------------------------------------------
-- 110/L.D1.2 (F215 / R724): THE CALENDAR THIS FIXTURE STARTS ON. Starting a
-- real draft now pre-flights the §11.7 fit against nfl_weeks at now() (Q31
-- rider (1)) — a season-2026 fixture is refused from 2026-12-16 00:00 ET and
-- dead from 2027-01-06 unless it owns its calendar. Pinning season 2026
-- far-future inside this rolled-back txn makes every start below fit at ANY
-- wall clock. A fixture change forced by 110, not a drive-by.
update nfl_weeks
set starts_at = starts_at + interval '73 years',
    correction_window_ends_at = correction_window_ends_at + interval '73 years'
where season = 2026;

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '8c000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-as1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "as_commish"}', now(), now());

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings)
values
  ('a5000000-0000-4000-8000-0000000000aa', '8c000000-0000-4000-8000-000000000001',
   'pgtap-as-LA-12team', 2026, 'scheduled', 12,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "manual",
     "draft_order": ["c5000000-0000-4000-8000-00aa00000001","c5000000-0000-4000-8000-00aa00000002",
                     "c5000000-0000-4000-8000-00aa00000003","c5000000-0000-4000-8000-00aa00000004",
                     "c5000000-0000-4000-8000-00aa00000005","c5000000-0000-4000-8000-00aa00000006",
                     "c5000000-0000-4000-8000-00aa00000007","c5000000-0000-4000-8000-00aa00000008",
                     "c5000000-0000-4000-8000-00aa00000009","c5000000-0000-4000-8000-00aa00000010",
                     "c5000000-0000-4000-8000-00aa00000011","c5000000-0000-4000-8000-00aa00000012"],
     "nomination_order_mode": "same_as_draft_order",
     "auction_budget": 200, "auction_zero_dollar_nominations": false, "auction_nomination_seconds": 45,
     "pick_timer_seconds": 0}}'),
  ('a5000000-0000-4000-8000-0000000000bb', '8c000000-0000-4000-8000-000000000001',
   'pgtap-as-LB-random', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "random",
     "nomination_order_mode": "random",
     "auction_budget": 300, "pick_timer_seconds": 90}}'),
  ('a5000000-0000-4000-8000-0000000000cc', '8c000000-0000-4000-8000-000000000001',
   'pgtap-as-LC-manualnom', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "random",
     "nomination_order_mode": "manual", "pick_timer_seconds": 90}}'),
  ('a5000000-0000-4000-8000-0000000000dd', '8c000000-0000-4000-8000-000000000001',
   'pgtap-as-LD-minbid0', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "random",
     "auction_budget": 200, "auction_zero_dollar_nominations": true, "pick_timer_seconds": 90}}'),
  ('a5000000-0000-4000-8000-0000000000ee', '8c000000-0000-4000-8000-000000000001',
   'pgtap-as-LE-belowfloor', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   -- 092/AP.1: the below-floor world used to be bought with min_bid 3 ($20 <
   -- 15 × $3). The reserve is now DERIVED and at most $1, so the only way
   -- below the floor is a budget under the slot count: $15 against 16
   -- draftable slots (16 since SC.2 — the v2.16.9 Scout default roster),
   -- i.e. EXACTLY ONE DOLLAR SHORT (D146 — LF below is the
   -- same league one dollar up, and starts). The budget is under the
   -- catalog's own `min(50)` on purpose: pgTAP writes the blob directly, so
   -- this is the cheapest shape that reaches the ENGINE's start gate.
   -- **Not a claim that the gate is otherwise unreachable (R456):** the gate
   -- counts D91 draftable slots and the settings layer caps a starting
   -- lineup at 20 — an ARM of the settings validator, never a schema bound —
   -- so a settings-legal league simply cannot get here, while a big enough
   -- roster can reach the settings layer's own solvency arm. The two layers
   -- count different things; see the corrected note in
   -- `validate-league-settings.test.ts` and spec v2.13.3.
   '{"draft": {"draft_type": "auction", "draft_order_mode": "random",
     "auction_budget": 15, "pick_timer_seconds": 90}}'),
  ('a5000000-0000-4000-8000-0000000000ff', '8c000000-0000-4000-8000-000000000001',
   'pgtap-as-LF-atfloor', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   -- 092/AP.1: EXACTLY AT the floor on the derived scale — $16 for 16
   -- draftable slots at a $1 reserve. LE above is the same shape one dollar
   -- down and is refused; this one starts. The pair brackets the start gate.
   '{"draft": {"draft_type": "auction", "draft_order_mode": "random",
     "auction_budget": 16, "pick_timer_seconds": 90}}'),
  ('a5000000-0000-4000-8000-0000000000e2', '8c000000-0000-4000-8000-000000000001',
   'pgtap-as-LG-e25', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "random",
     "auction_budget": 3, "auction_zero_dollar_nominations": false, "pick_timer_seconds": 90}}'),
  ('a5000000-0000-4000-8000-0000000000e3', '8c000000-0000-4000-8000-000000000001',
   'pgtap-as-LH-noteams', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "pick_timer_seconds": 90}}'),
  ('a5000000-0000-4000-8000-0000000000e4', '8c000000-0000-4000-8000-000000000001',
   'pgtap-as-LI-nocapacity', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "pick_timer_seconds": 90}}'),
  ('a5000000-0000-4000-8000-0000000000e5', '8c000000-0000-4000-8000-000000000001',
   'pgtap-as-LJ-short', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "pick_timer_seconds": 90}}'),
  ('a5000000-0000-4000-8000-0000000000e7', '8c000000-0000-4000-8000-000000000001',
   'pgtap-as-LN-adjshort', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "random",
     "auction_budget": 200, "auction_zero_dollar_nominations": false, "pick_timer_seconds": 90}}');

-- LG's roster: THREE draftable slots (2 RB starters + 1 bench, IR excluded
-- per D91) — E25's "$3 budget, 3 open slots" fixture.
update leagues
set roster_settings = '{"starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 2}],
                        "bench": 1, "ir_slots": [], "swap_spots": 0}'::jsonb
where id = 'a5000000-0000-4000-8000-0000000000e2';

insert into teams (id, owner_id, name, league_id)
select ('c5000000-0000-4000-8000-00aa000000' || lpad(i::text, 2, '0'))::uuid,
       '8c000000-0000-4000-8000-000000000001', 'pgtap-as-LA-t' || i,
       'a5000000-0000-4000-8000-0000000000aa'
from generate_series(1, 12) i;
insert into teams (id, owner_id, name, league_id)
select ('c5000000-0000-4000-8000-00bb000000' || lpad(i::text, 2, '0'))::uuid,
       '8c000000-0000-4000-8000-000000000001', 'pgtap-as-LB-t' || i,
       'a5000000-0000-4000-8000-0000000000bb'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c5000000-0000-4000-8000-00cc000000' || lpad(i::text, 2, '0'))::uuid,
       '8c000000-0000-4000-8000-000000000001', 'pgtap-as-LC-t' || i,
       'a5000000-0000-4000-8000-0000000000cc'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c5000000-0000-4000-8000-00dd000000' || lpad(i::text, 2, '0'))::uuid,
       '8c000000-0000-4000-8000-000000000001', 'pgtap-as-LD-t' || i,
       'a5000000-0000-4000-8000-0000000000dd'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c5000000-0000-4000-8000-00ee000000' || lpad(i::text, 2, '0'))::uuid,
       '8c000000-0000-4000-8000-000000000001', 'pgtap-as-LE-t' || i,
       'a5000000-0000-4000-8000-0000000000ee'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c5000000-0000-4000-8000-00ff000000' || lpad(i::text, 2, '0'))::uuid,
       '8c000000-0000-4000-8000-000000000001', 'pgtap-as-LF-t' || i,
       'a5000000-0000-4000-8000-0000000000ff'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c5000000-0000-4000-8000-00e2000000' || lpad(i::text, 2, '0'))::uuid,
       '8c000000-0000-4000-8000-000000000001', 'pgtap-as-LG-t' || i,
       'a5000000-0000-4000-8000-0000000000e2'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id) values
  ('c5000000-0000-4000-8000-00e400000001', '8c000000-0000-4000-8000-000000000001',
   'pgtap-as-LI-t1', 'a5000000-0000-4000-8000-0000000000e4'),
  ('c5000000-0000-4000-8000-00e500000001', '8c000000-0000-4000-8000-000000000001',
   'pgtap-as-LJ-t1', 'a5000000-0000-4000-8000-0000000000e5');
insert into teams (id, owner_id, name, league_id) values
  ('c5000000-0000-4000-8000-00e700000001', '8c000000-0000-4000-8000-000000000001',
   'pgtap-as-LN-t1', 'a5000000-0000-4000-8000-0000000000e7');
insert into teams (id, owner_id, name, league_id)
select ('c5000000-0000-4000-8000-00e7000000' || lpad(i::text, 2, '0'))::uuid,
       '8c000000-0000-4000-8000-000000000001', 'pgtap-as-LN-t' || i,
       'a5000000-0000-4000-8000-0000000000e7'
from generate_series(2, 8) i;
-- LH's ONE seat is RETIRED (R321): it keeps the league's ACTIVE franchise
-- set empty (so the empty-set trap below still fires — and now proves the
-- retired filter is what empties it), and it is the subject of the
-- retired-seat loudness pin in §G.
insert into teams (id, owner_id, name, league_id, status) values
  ('c5000000-0000-4000-8000-00e300000001', '8c000000-0000-4000-8000-000000000001',
   'pgtap-as-LH-retired', 'a5000000-0000-4000-8000-0000000000e3', 'retired');

insert into league_members (league_id, user_id, team_id, role) values
  ('a5000000-0000-4000-8000-0000000000aa', '8c000000-0000-4000-8000-000000000001',
   'c5000000-0000-4000-8000-00aa00000001', 'commissioner');

-- LB's drafts row exists ONLY to FIX the draft id, so the seeded md5
-- shuffle is a stored literal (the 020 LK precedent).
insert into drafts (id, league_id, draft_type, status, is_mock, config) values
  ('e5000000-0000-4000-8000-0000000000bb', 'a5000000-0000-4000-8000-0000000000bb',
   'auction', 'scheduled', false, '{}');
-- LN's drafts row exists to carry a PRE-START budget_adjustment (D127's
-- storage half). The league itself is settings-LEGAL ($200 ≥ 16 × $1); the
-- −$185 delta leaves t1 with $15 against 16 open slots — EXACTLY ONE SLOT
-- SHORT of §8.6.8's floor, which is the only place the shipped invariant
-- and a floor loosened by one slot disagree (M3 batch-2 review, R320).
-- It also proves the derivation HONORS a pre-start adjustment, which is
-- what makes 087/R302's "draft_reset clears budget_adjustments" a real
-- obligation rather than housekeeping (R319).
insert into drafts (id, league_id, draft_type, status, is_mock, config, budget_adjustments) values
  ('e5000000-0000-4000-8000-0000000000e7', 'a5000000-0000-4000-8000-0000000000e7',
   'auction', 'scheduled', false, '{}',
   '{"c5000000-0000-4000-8000-00e700000001": -185}'::jsonb);
-- LH/LI: hand-built rows for the two loudness probes (never started).
insert into drafts (id, league_id, draft_type, status, is_mock, config, total_rounds) values
  ('e5000000-0000-4000-8000-0000000000e3', 'a5000000-0000-4000-8000-0000000000e3',
   'auction', 'live', false, '{"auction_budget": 200, "auction_zero_dollar_nominations": false}', 15),
  ('e5000000-0000-4000-8000-0000000000e4', 'a5000000-0000-4000-8000-0000000000e4',
   'auction', 'live', false, '{"auction_budget": 200, "auction_zero_dollar_nominations": false}', null),
  ('e5000000-0000-4000-8000-0000000000e6', 'a5000000-0000-4000-8000-0000000000e4',
   'snake', 'live', true, '{}', 15);

insert into players (id, full_name, position) values
  ('pgtap-as-p1', 'PgTap Auction Start One', 'RB'),
  ('pgtap-as-p2', 'PgTap Auction Start Two', 'RB'),
  ('pgtap-as-p3', 'PgTap Auction Start Three', 'WR'),
  ('pgtap-as-p4', 'PgTap Auction Start Four', 'TE');

-- ---------------------------------------------------------------------------
-- C. The auction start arm (LA — the D126 shape end to end)
-- ---------------------------------------------------------------------------
select is(
  (public.draft_start_internal('a5000000-0000-4000-8000-0000000000aa', false)->>'started')::boolean,
  true,
  'LA: draft_start_internal STARTS an auction (the 066:640–644 M3 refusal is now the engine)');
select is(
  (select status || '|' || draft_type || '|' || total_rounds::text
   from drafts where league_id = 'a5000000-0000-4000-8000-0000000000aa'),
  'live|auction|16',
  '…draft is live, typed auction, total_rounds 16 (D91 draftable slots = the auction''s roster capacity, D126; 16 since SC.2 — the v2.16.9 Scout default roster, wr 2 → 3)');
select is(
  (select status from leagues where id = 'a5000000-0000-4000-8000-0000000000aa'),
  'drafting',
  '…the league transitioned to drafting (the shared D43-guarded path)');
select ok(
  (select scoring_rules_snapshot is not null
   from leagues where id = 'a5000000-0000-4000-8000-0000000000aa'),
  '…snapshot taken BEFORE the transition, auction included (D43/D64(2) unchanged)');
select ok(
  (select current_nomination is null from drafts
   where league_id = 'a5000000-0000-4000-8000-0000000000aa'),
  'D126 phase rule: current_nomination NULL ⇒ the draft opens in the NOMINATING phase');
select is(
  (select current_round::text || '|' || current_pick_number::text
   from drafts where league_id = 'a5000000-0000-4000-8000-0000000000aa'),
  '1|1',
  '…current_pick_number 1 = nomination sequence #1 (§12.4''s "sequence # (auction)", D126)');
select is(
  (select nomination_order from drafts
   where league_id = 'a5000000-0000-4000-8000-0000000000aa'),
  (select draft_order from drafts
   where league_id = 'a5000000-0000-4000-8000-0000000000aa'),
  'nomination_order_mode=same_as_draft_order COPIES the resolved draft order (§7.3.8 default)');
select is(
  (select on_clock_team_id from drafts
   where league_id = 'a5000000-0000-4000-8000-0000000000aa'),
  'c5000000-0000-4000-8000-00aa00000001'::uuid,
  '…on_clock_team_id = nomination_order[0] — the first NOMINATOR, not draft_team_for_pick''s pick-1 seat');
select is(
  (select current_deadline from drafts
   where league_id = 'a5000000-0000-4000-8000-0000000000aa'),
  now() + interval '45 seconds',
  'pick-1 deadline = now() + auction_nomination_seconds (45), NOT the pick timer — and NOT NULL despite pick_timer_seconds = 0 (§7.3.8/§8.2: an auction is never untimed)');

-- ---------------------------------------------------------------------------
-- D. Derivation goldens — stored literals per size/config (§8.6.1/D127).
--    THE MAX-BID PINS ARE THE DoD BREAK PROBE'S TARGET (drop the `− 1`).
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid, b.committed
     from drafts d
     cross join lateral public.draft_team_budget(d.id, 'c5000000-0000-4000-8000-00aa00000001') b
     where d.league_id = 'a5000000-0000-4000-8000-0000000000aa' $$,
  $$ values (200, 16, 185, 0) $$,
  'GOLDEN 12-team $200/min-1: remaining 200, open 16, max_bid 185 (200 − 15×1), committed 0');
select ok(
  (select bool_and(b.remaining = 200 and b.open_slots = 16 and b.max_bid = 185)
   from drafts d
   join teams t on t.league_id = d.league_id
   cross join lateral public.draft_team_budget(d.id, t.id) b
   where d.league_id = 'a5000000-0000-4000-8000-0000000000aa'),
  '…and EVERY one of the twelve franchises reads the same fresh-start numbers (§8.6.1: each team shows remaining budget and max bid)');

-- A $50 buy, then an UNDONE row that must not count, then adjustments.
insert into draft_picks (draft_id, league_id, team_id, player_id, pick_number, round, price, made_via)
select d.id, d.league_id, 'c5000000-0000-4000-8000-00aa00000001', 'pgtap-as-p1', 1, null, 50, 'manager'
from drafts d where d.league_id = 'a5000000-0000-4000-8000-0000000000aa';
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid, b.committed
     from drafts d
     cross join lateral public.draft_team_budget(d.id, 'c5000000-0000-4000-8000-00aa00000001') b
     where d.league_id = 'a5000000-0000-4000-8000-0000000000aa' $$,
  $$ values (150, 15, 136, 50) $$,
  'after a $50 buy: remaining 150, open 15, max_bid 136 (150 − 14×1), committed 50');
insert into draft_picks (draft_id, league_id, team_id, player_id, pick_number, round, price, made_via, is_undone)
select d.id, d.league_id, 'c5000000-0000-4000-8000-00aa00000001', 'pgtap-as-p2', 2, null, 999, 'manager', true
from drafts d where d.league_id = 'a5000000-0000-4000-8000-0000000000aa';
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid, b.committed
     from drafts d
     cross join lateral public.draft_team_budget(d.id, 'c5000000-0000-4000-8000-00aa00000001') b
     where d.league_id = 'a5000000-0000-4000-8000-0000000000aa' $$,
  $$ values (150, 15, 136, 50) $$,
  '…an IS_UNDONE $999 row changes NOTHING — undo refunds by derivation, never by a counter (D127/D131)');
update drafts
set budget_adjustments = '{"c5000000-0000-4000-8000-00aa00000001": -20}'::jsonb
where league_id = 'a5000000-0000-4000-8000-0000000000aa';
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid, b.committed
     from drafts d
     cross join lateral public.draft_team_budget(d.id, 'c5000000-0000-4000-8000-00aa00000001') b
     where d.league_id = 'a5000000-0000-4000-8000-0000000000aa' $$,
  $$ values (130, 15, 116, 50) $$,
  '…a −$20 commissioner adjustment lands in remaining and max_bid (D127''s storage half, read here)');
update drafts
set budget_adjustments = '{"c5000000-0000-4000-8000-00aa00000001": 25}'::jsonb
where league_id = 'a5000000-0000-4000-8000-0000000000aa';
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid, b.committed
     from drafts d
     cross join lateral public.draft_team_budget(d.id, 'c5000000-0000-4000-8000-00aa00000001') b
     where d.league_id = 'a5000000-0000-4000-8000-0000000000aa' $$,
  $$ values (175, 15, 161, 50) $$,
  '…and a +$25 adjustment moves them the other way');
select ok(
  (select b.remaining = 200 and b.max_bid = 185
   from drafts d
   cross join lateral public.draft_team_budget(d.id, 'c5000000-0000-4000-8000-00aa00000002') b
   where d.league_id = 'a5000000-0000-4000-8000-0000000000aa'),
  '…a per-team adjustment is PER TEAM: team 2 still reads the untouched 200/185');
update drafts set budget_adjustments = '{}'::jsonb
where league_id = 'a5000000-0000-4000-8000-0000000000aa';

-- ---------------------------------------------------------------------------
-- E. nomination_order_mode — all three modes (§7.3.8/§8.3)
-- ---------------------------------------------------------------------------
-- (1) random: a stored-literal seeded shuffle, and NOT the draft order.
select is(
  (public.draft_start_internal('a5000000-0000-4000-8000-0000000000bb', false)->>'started')::boolean,
  true,
  'LB: an auction with nomination_order_mode=random starts');
select is(
  (select nomination_order from drafts where id = 'e5000000-0000-4000-8000-0000000000bb'),
  '["c5000000-0000-4000-8000-00bb00000005", "c5000000-0000-4000-8000-00bb00000006", "c5000000-0000-4000-8000-00bb00000002", "c5000000-0000-4000-8000-00bb00000003", "c5000000-0000-4000-8000-00bb00000007", "c5000000-0000-4000-8000-00bb00000004", "c5000000-0000-4000-8000-00bb00000001", "c5000000-0000-4000-8000-00bb00000008"]'::jsonb,
  'GOLDEN: the random nomination order is the md5(''nomination:'' || draft_id) shuffle — a stored literal against a fixed draft id (the 020 LK precedent; D105: no wall clock, no random())');
select isnt(
  (select nomination_order from drafts where id = 'e5000000-0000-4000-8000-0000000000bb'),
  (select draft_order from drafts where id = 'e5000000-0000-4000-8000-0000000000bb'),
  '…and it is NOT this draft''s random draft order — the DERIVED seed is what keeps "random" from silently meaning same_as_draft_order');
select ok(
  (select jsonb_array_length(nomination_order) = 8
      and (select count(distinct e.val) from jsonb_array_elements_text(nomination_order) e(val)) = 8
      and not exists (
            select 1 from jsonb_array_elements_text(nomination_order) e(val)
            where not exists (select 1 from teams t
                              where t.id::text = e.val
                                and t.league_id = 'a5000000-0000-4000-8000-0000000000bb'))
   from drafts where id = 'e5000000-0000-4000-8000-0000000000bb'),
  '…and it is a permutation of LB''s eight franchises (§8.3 "circular" needs every seat exactly once)');
select is(
  (select on_clock_team_id from drafts where id = 'e5000000-0000-4000-8000-0000000000bb'),
  (select (nomination_order->>0)::uuid from drafts where id = 'e5000000-0000-4000-8000-0000000000bb'),
  '…the first nominator is nomination_order[0] of the SHUFFLED order');
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid
     from public.draft_team_budget('e5000000-0000-4000-8000-0000000000bb',
                                   'c5000000-0000-4000-8000-00bb00000001') b $$,
  $$ values (300, 16, 285) $$,
  'GOLDEN 8-team $300: max_bid 285 (300 − 15×$1 reserve) — 092/AP.1 retired the 0–5 min-bid field, so the reserve is the DERIVED $1 (§8.6.1/§7.3.8)');

-- (2) manual: refuses without a stored permutation, then honors one.
select throws_ok(
  $$ select public.draft_start_internal('a5000000-0000-4000-8000-0000000000cc', false) $$,
  'P0001',
  'draft_start: league a5000000-0000-4000-8000-0000000000cc has nomination_order_mode=manual but the stored nomination order does not cover every active franchise exactly once — set the nomination order in the commissioner panel, or switch nomination_order_mode to same_as_draft_order (§8.3)',
  'LC: nomination_order_mode=manual with NO stored order → a friendly refusal naming nomination_order_mode (not draft_order_mode — error strings are UX)');
select is(
  (select status || '|' || (select count(*) from drafts
     where league_id = 'a5000000-0000-4000-8000-0000000000cc')::text
   from leagues where id = 'a5000000-0000-4000-8000-0000000000cc'),
  'scheduled|0',
  '…and the refused start left NO partial state (league scheduled, zero drafts rows — the refusal precedes the transition)');
insert into drafts (id, league_id, draft_type, status, is_mock, config, nomination_order) values
  ('e5000000-0000-4000-8000-0000000000cc', 'a5000000-0000-4000-8000-0000000000cc',
   'auction', 'scheduled', false, '{}',
   '["c5000000-0000-4000-8000-00cc00000008","c5000000-0000-4000-8000-00cc00000007",
     "c5000000-0000-4000-8000-00cc00000006","c5000000-0000-4000-8000-00cc00000005",
     "c5000000-0000-4000-8000-00cc00000004","c5000000-0000-4000-8000-00cc00000003",
     "c5000000-0000-4000-8000-00cc00000002","c5000000-0000-4000-8000-00cc00000001"]'::jsonb);
select is(
  (public.draft_start_internal('a5000000-0000-4000-8000-0000000000cc', false)->>'started')::boolean,
  true,
  '…with a valid stored permutation the manual mode starts');
select is(
  (select nomination_order->>0 || '|' || (nomination_order->>7)
   from drafts where id = 'e5000000-0000-4000-8000-0000000000cc'),
  'c5000000-0000-4000-8000-00cc00000008|c5000000-0000-4000-8000-00cc00000001',
  '…the stored manual order is used VERBATIM (reversed seats — provably neither the shuffle nor the draft order)');
select is(
  (select on_clock_team_id from drafts where id = 'e5000000-0000-4000-8000-0000000000cc'),
  'c5000000-0000-4000-8000-00cc00000008'::uuid,
  '…and the first nominator is its head');
select ok(
  (select nomination_order is distinct from draft_order
   from drafts where id = 'e5000000-0000-4000-8000-0000000000cc'),
  '…manual nomination order is independent of the (random) draft order — §8.3''s two orders are two settings');
-- The manual arm rejects a MALFORMED order as loudly as a missing one
-- (R117: TEXT comparison, never a ::uuid cast blowing up).
select throws_ok(
  $$ select public.draft_nomination_order_internal(
       'a5000000-0000-4000-8000-0000000000cc', 8, 'manual',
       '["not-a-uuid","c5000000-0000-4000-8000-00cc00000007","c5000000-0000-4000-8000-00cc00000006",
         "c5000000-0000-4000-8000-00cc00000005","c5000000-0000-4000-8000-00cc00000004",
         "c5000000-0000-4000-8000-00cc00000003","c5000000-0000-4000-8000-00cc00000002",
         "c5000000-0000-4000-8000-00cc00000001"]'::jsonb,
       null, 'e5000000-0000-4000-8000-0000000000cc', 'draft_start') $$,
  'P0001', null,
  'a malformed entry fails VALIDATION (the R117 TEXT compare), never a cast error');
select throws_ok(
  $$ select public.draft_nomination_order_internal(
       'a5000000-0000-4000-8000-0000000000cc', 8, 'manual',
       '["c5000000-0000-4000-8000-00cc00000001","c5000000-0000-4000-8000-00cc00000001",
         "c5000000-0000-4000-8000-00cc00000006","c5000000-0000-4000-8000-00cc00000005",
         "c5000000-0000-4000-8000-00cc00000004","c5000000-0000-4000-8000-00cc00000003",
         "c5000000-0000-4000-8000-00cc00000002","c5000000-0000-4000-8000-00cc00000007"]'::jsonb,
       null, 'e5000000-0000-4000-8000-0000000000cc', 'draft_start') $$,
  'P0001', null,
  '…and a duplicated seat (right length, wrong distinctness) is refused too');
-- (3) same_as_draft_order is LA's pin above; here is the unit-level proof
--     that the copy is the DRAFT ORDER argument, not a re-derivation.
select is(
  public.draft_nomination_order_internal(
    'a5000000-0000-4000-8000-0000000000cc', 8, 'same_as_draft_order',
    null, '["x","y","z"]'::jsonb, 'e5000000-0000-4000-8000-0000000000cc', 'draft_start'),
  '["x", "y", "z"]'::jsonb,
  'same_as_draft_order returns the passed draft order VERBATIM (a copy, not a second shuffle)');
select is(
  public.draft_nomination_order_internal(
    'a5000000-0000-4000-8000-0000000000cc', 8, 'not_a_mode',
    null, '["x","y","z"]'::jsonb, 'e5000000-0000-4000-8000-0000000000cc', 'draft_start'),
  '["x", "y", "z"]'::jsonb,
  '…and an unrecognized mode falls back to the §7.3.8 default rather than returning NULL');

-- ---------------------------------------------------------------------------
-- F. §8.6.8 solvency — both ways, plus the start-time backstop
-- ---------------------------------------------------------------------------
-- NB the state at this line: LA started fresh, then §D's spend sweep left
-- team 1 holding one $50 buy (its budget reads 150/15 here) and every
-- other seat untouched at 200/16. The invariant holds for both shapes —
-- 150 ≥ 15 × 1 and 200 ≥ 16 × 1 (description corrected, M3 batch-2
-- review R323: it used to describe the pre-spend state).
select ok(
  public.draft_auction_solvent(
    (select id from drafts where league_id = 'a5000000-0000-4000-8000-0000000000aa')),
  'LA is solvent AFTER the §D spend sweep: the spender reads 150 ≥ 15 × 1 and every other seat 200 ≥ 16 × 1');
insert into draft_picks (draft_id, league_id, team_id, player_id, pick_number, round, price, made_via)
select d.id, d.league_id, 'c5000000-0000-4000-8000-00aa00000002', 'pgtap-as-p3', 3, null, 200, 'manager'
from drafts d where d.league_id = 'a5000000-0000-4000-8000-0000000000aa';
select is(
  public.draft_auction_solvent(
    (select id from drafts where league_id = 'a5000000-0000-4000-8000-0000000000aa')),
  false,
  '…and FALSE the instant one team spends its whole budget with 15 slots open — the invariant fn is falsifiable, not decorative');
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid
     from drafts d
     cross join lateral public.draft_team_budget(d.id, 'c5000000-0000-4000-8000-00aa00000002') b
     where d.league_id = 'a5000000-0000-4000-8000-0000000000aa' $$,
  $$ values (0, 15, -14) $$,
  '…and max_bid goes NEGATIVE rather than clamping to 0 — an insolvent state stays visible (D127/§4.7)');
delete from draft_picks
where team_id = 'c5000000-0000-4000-8000-00aa00000002' and player_id = 'pgtap-as-p3';
select ok(
  public.draft_auction_solvent(
    (select id from drafts where league_id = 'a5000000-0000-4000-8000-0000000000aa')),
  '…removing the over-spend restores solvency (the derivation has no memory to drift)');

-- E27 / §8.6.7(d): a complete roster bids nothing; E25's $3-and-3-slots.
select is(
  (public.draft_start_internal('a5000000-0000-4000-8000-0000000000e2', false)->>'started')::boolean,
  true,
  'LG starts: a $3 budget with THREE draftable slots is solvent at exact equality (3 ≥ 3×1) — the §8.6.8 floor boundary');
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid, b.committed
     from drafts d
     cross join lateral public.draft_team_budget(d.id, 'c5000000-0000-4000-8000-00e200000001') b
     where d.league_id = 'a5000000-0000-4000-8000-0000000000e2' $$,
  $$ values (3, 3, 1, 0) $$,
  'E25 GOLDEN (§8.6.7(d)): $3 across 3 open slots ⇒ max_bid $1 — a $1-max team can bid exactly $1 and no more');

-- THE BOUNDARY-ADJACENT NEGATIVE (M3 batch-2 review, R320). Every other
-- solvency fixture in this file sits either far below the floor (LE is $25
-- short), far above it, or exactly ON it (LG's $3/3 slots) — and a floor
-- loosened by one slot (`remaining >= (open_slots - 1) * min_bid`) agrees
-- with §8.6.8 at all three, so none of them can detect that weakening. The
-- ONLY discriminating state is ONE SLOT SHORT: a −$1 adjustment on an
-- untouched LG seat leaves remaining 2 against 3 open slots, where §8.6.8
-- says FALSE (2 < 3 × 1) and the loosened floor says TRUE (2 ≥ 2 × 1).
-- THE SECOND NAMED BREAK PROBE targets these two pins.
update drafts set budget_adjustments = '{"c5000000-0000-4000-8000-00e200000002": -1}'::jsonb
where league_id = 'a5000000-0000-4000-8000-0000000000e2';
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid, b.committed
     from drafts d
     cross join lateral public.draft_team_budget(d.id, 'c5000000-0000-4000-8000-00e200000002') b
     where d.league_id = 'a5000000-0000-4000-8000-0000000000e2' $$,
  $$ values (2, 3, 0, 0) $$,
  'ONE SLOT SHORT: a −$1 adjustment leaves $2 against 3 open slots (max_bid 0 — the reserve eats it all)');
select is(
  public.draft_auction_solvent(
    (select id from drafts where league_id = 'a5000000-0000-4000-8000-0000000000e2')),
  false,
  '…and §8.6.8 calls that INSOLVENT (2 < 3 × 1) — the boundary-adjacent negative a floor loosened by ONE SLOT would call solvent');
update drafts set budget_adjustments = '{}'::jsonb
where league_id = 'a5000000-0000-4000-8000-0000000000e2';
select ok(
  public.draft_auction_solvent(
    (select id from drafts where league_id = 'a5000000-0000-4000-8000-0000000000e2')),
  '…and the matching AT-floor state one dollar up (3 ≥ 3 × 1) is solvent again — the pair brackets the floor from both sides');

insert into draft_picks (draft_id, league_id, team_id, player_id, pick_number, round, price, made_via)
select d.id, d.league_id, 'c5000000-0000-4000-8000-00e200000001', p.pid, p.n, null, 1, 'manager'
from drafts d
cross join (values ('pgtap-as-p1', 1), ('pgtap-as-p2', 2), ('pgtap-as-p3', 3)) as p(pid, n)
where d.league_id = 'a5000000-0000-4000-8000-0000000000e2';
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid, b.committed
     from drafts d
     cross join lateral public.draft_team_budget(d.id, 'c5000000-0000-4000-8000-00e200000001') b
     where d.league_id = 'a5000000-0000-4000-8000-0000000000e2' $$,
  $$ values (0, 0, 0, 3) $$,
  'E27: a COMPLETE roster reads open_slots 0 and max_bid 0 (the one special case in the formula — a full team cannot bid)');
select ok(
  public.draft_auction_solvent(
    (select id from drafts where league_id = 'a5000000-0000-4000-8000-0000000000e2')),
  '…and a fully-spent, fully-rostered team is still SOLVENT (0 ≥ 0×1) — completion is not insolvency');

-- 092/AP.1 — C38's SUBSTANCE, re-pointed at the toggle rather than deleted
-- (D198(3)): `auction_zero_dollar_nominations` ON degenerates the §8.6.8
-- floor to ≥ 0, and max_bid to the whole remaining budget.
select is(
  (public.draft_start_internal('a5000000-0000-4000-8000-0000000000dd', false)->>'started')::boolean,
  true,
  'LD starts with auction_zero_dollar_nominations ON (§7.3.8 v2.13; C38 promoted to law)');
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid
     from drafts d
     cross join lateral public.draft_team_budget(d.id, 'c5000000-0000-4000-8000-00dd00000001') b
     where d.league_id = 'a5000000-0000-4000-8000-0000000000dd' $$,
  $$ values (200, 16, 200) $$,
  '$0-NOMINATIONS GOLDEN: with the toggle ON the whole remaining budget is bidable (200 − 15×0) — "with $0 nominations there is no $1 per slot reserve" (Chris, 2026-08-20)');

-- The start-time backstop, both sides.
select is(
  (public.draft_start_internal('a5000000-0000-4000-8000-0000000000ff', false)->>'started')::boolean,
  true,
  'LF starts: $16 across 16 draftable slots is EXACTLY at the §8.6.8 floor (16 ≥ 16 × $1) — the POSITIVE control one dollar above LE (D146)');
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid
     from drafts d
     cross join lateral public.draft_team_budget(d.id, 'c5000000-0000-4000-8000-00ff00000001') b
     where d.league_id = 'a5000000-0000-4000-8000-0000000000ff' $$,
  $$ values (16, 16, 1) $$,
  '…GOLDEN at the floor: max_bid $1 (16 − 15×$1) — the reserve keeps the other fifteen slots affordable, and there is exactly one dollar of room');
select throws_ok(
  $$ select public.draft_start_internal('a5000000-0000-4000-8000-0000000000ee', false) $$,
  'P0001',
  'draft_start: league a5000000-0000-4000-8000-0000000000ee cannot start an auction — a $15 budget cannot fill 16 draftable roster spots at a $1 per-slot reserve (§8.6.8 solvency); raise the auction budget, or allow $0 nominations in League settings → Draft setup',
  'LE: a BELOW-floor auction is refused by the §8.6.8 start backstop, with the numbers, the UNIT (D91 draftable slots — not the settings validator''s IR-inclusive roster size) and a remedy that names a knob that EXISTS (092/AP.1: "lower the minimum bid" pointed at a retired field)');
select is(
  (select status || '|' || (select count(*) from drafts
     where league_id = 'a5000000-0000-4000-8000-0000000000ee')::text
   from leagues where id = 'a5000000-0000-4000-8000-0000000000ee'),
  'scheduled|0',
  '…and the refusal left NO partial state — league still scheduled, zero drafts rows');
select ok(
  (select scoring_rules_snapshot is null
   from leagues where id = 'a5000000-0000-4000-8000-0000000000ee'),
  '…including the snapshot the arm had already taken (the whole txn unwinds — nothing half-started)');
-- LN: the SECOND backstop message (R318). The settings floor HOLDS here
-- ($200 ≥ 16 × $1), so the LE sentence would have been arithmetically
-- FALSE about this league and would have sent the commissioner to the
-- budget knob instead of the §8.7 adjustment that actually caused it.
-- The state is also EXACTLY ONE SLOT SHORT ($15 against 16 slots at $1),
-- so a floor loosened by one slot would let this start (R320).
select throws_ok(
  $$ select public.draft_start_internal('a5000000-0000-4000-8000-0000000000e7', false) $$,
  'P0001',
  'draft_start: league a5000000-0000-4000-8000-0000000000e7 cannot start an auction — pgtap-as-LN-t1 has $15 for 16 draftable roster spots at a $1 per-slot reserve (§8.6.8 solvency). The league''s $200 auction budget clears that floor, so the shortfall is this franchise''s own: clear its commissioner budget adjustment (§8.7), or allow $0 nominations in League settings → Draft setup',
  'LN: a settings-LEGAL league made insolvent by a PRE-START budget adjustment is refused by the named franchise and its real numbers — never by the settings sentence, which is false for this league (R318); the state is one slot short, so a floor loosened by one slot would start it (R320)');

-- ---------------------------------------------------------------------------
-- G. Loudness: every "nothing happened" path RAISES (CLAUDE.md)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select * from public.draft_team_budget(
       'e5000000-0000-4000-8000-000000000999', 'c5000000-0000-4000-8000-00aa00000001') $$,
  'P0002', null,
  'draft_team_budget on a missing draft RAISES (never a plausible-looking zero row)');
select throws_ok(
  $$ select * from public.draft_team_budget(
       (select id from drafts where league_id = 'a5000000-0000-4000-8000-0000000000aa'),
       'c5000000-0000-4000-8000-00bb00000001') $$,
  'P0002', null,
  '…a team from ANOTHER league RAISES (a foreign team would otherwise read a full untouched budget)');
select throws_ok(
  $$ select * from public.draft_team_budget(
       'e5000000-0000-4000-8000-0000000000e3', 'c5000000-0000-4000-8000-00e300000001') $$,
  'P0002', null,
  '…and a RETIRED seat RAISES exactly like a foreign one (R321): it sits OUTSIDE draft_auction_solvent''s team set, so a plausible full budget for it would be an answer the invariant never checks');
select throws_ok(
  $$ select * from public.draft_team_budget(
       'e5000000-0000-4000-8000-0000000000e6', 'c5000000-0000-4000-8000-00e400000001') $$,
  'P0001', null,
  '…and a SNAKE draft RAISES: price is NULL there, so any budget it produced would be fiction');
select throws_ok(
  $$ select public.draft_auction_solvent('e5000000-0000-4000-8000-0000000000e6') $$,
  'P0001', null,
  'draft_auction_solvent on a snake draft RAISES (§8.6.8 is an auction invariant)');
select throws_ok(
  $$ select public.draft_auction_solvent('e5000000-0000-4000-8000-000000000999') $$,
  'P0002', null,
  '…on a missing draft it RAISES rather than answering TRUE about nothing');
select throws_ok(
  $$ select public.draft_auction_solvent('e5000000-0000-4000-8000-0000000000e3') $$,
  'P0001',
  'draft_auction_solvent: draft e5000000-0000-4000-8000-0000000000e3 has no active franchises to check — refusing to report solvency over an empty set',
  'THE EMPTY-SET TRAP: an auction whose only seat is RETIRED RAISES — the retired filter is what empties the set, bool_and over no rows is NULL, and `IF NOT solvent` would sail straight past it');
select throws_ok(
  $$ select * from public.draft_team_budget(
       'e5000000-0000-4000-8000-0000000000e4', 'c5000000-0000-4000-8000-00e400000001') $$,
  'P0001', null,
  '…and an unset total_rounds RAISES: open_slots would be NULL and every downstream comparison silently unknown');

-- ---------------------------------------------------------------------------
-- H. The shared gates still gate the auction arm (the D96/F45 mirror)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.draft_start_internal('a5000000-0000-4000-8000-0000000000e5', false) $$,
  'P0001',
  'draft_start: league a5000000-0000-4000-8000-0000000000e5 has 1 of 8 franchises seated — every seat must exist before the draft starts; add placeholder seats for the empty slots (League home → Invite) or invite managers (§7.2/D96)',
  'the D96 capacity gate applies to auctions unchanged — the audited draft-short override stays M6''s F45');
select is(
  (select count(*) from drafts where league_id = 'a5000000-0000-4000-8000-0000000000e5'),
  0::bigint,
  '…and that refusal rolled back its create-if-absent row too');

select * from finish();
rollback;
