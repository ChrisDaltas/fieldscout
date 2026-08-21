-- ============================================================================
-- The serialized auction core — pgTAP 034 (migration 085, task L.C1.3;
-- spec §8.1, §8.6.2–§8.6.4, §8.6.7(a)/(c)/(d), §8.6.8, §12.5;
-- D126/D128/D129(1)/D136/D146; E2/E5/E6/E25/E27, C38/C40).
--
-- WHAT THIS FILE OWNS vs its neighbours: 033 owns the budget DERIVATION
-- matrix and the start arm; 020 owns draft_start's wrapper path and
-- draft_make_pick (including the auction refusal this PR REWORDS —
-- 020:1042–1046, the message on 020:1045 — cite it by its message text if
-- these lines move again (R336: this PR's own +5-line edit to 020's header
-- shifted the first citation); edited in place per D137's
-- tests-are-not-migrations rule);
-- this file owns the two new action RPCs end to end, driven AS SIGNED-IN
-- MANAGERS through the real `request.jwt.claims` dance (they are
-- SECURITY DEFINER with in-body auth, so a privileged caller would prove
-- nothing about the turn/franchise rules).
--
-- 086/L.C1.4 OWNS EVERY CLOSE. Nothing in 085 awards a player, advances
-- the rotation or bumps the nomination sequence, so where this file needs
-- a second nomination it performs a PRIVILEGED "simulated close" —
-- clearing `current_nomination` and bumping `current_pick_number` by hand,
-- each time with a comment saying so. That is deliberate: a pin that
-- depended on the tick's award arm would be pinning code that does not
-- exist yet, and would silently start passing/failing for 086's reasons.
--
-- Falsifiability notes (§4.3):
--   * **THREE BREAK PROBES, ALL AS RUN (not as predicted — the R306
--     lesson). Every number below was re-captured against THIS plan of
--     91 in the M3 batch-3 fix cycle.**
--     **(1) THE DoD PROBE — the max-bid clause dropped from
--     `draft_place_bid` (`IF p_amount > v_max_bid`): 6 of 91 RED**, and
--     the suite RUNS TO THE END rather than aborting (see the ordering
--     note below) — pins **48** (E5: LA's $187 against a $186 max),
--     **81** (E25's bid half: $2 against a $1-max seat), **87**
--     (§8.6.7(d) at min_bid 0: $2 against a $1-max seat), **66** and
--     **88** (the two population COUNTS: the refused bids landed), and
--     **89**, the property pin — "no bid above its bidder's max bid
--     exists in history", which is the clause's whole purpose and the
--     thing 086's award will be built on.
--     NAMED SO NOBODY COUNTS THEM AS COVERAGE THEY ARE NOT: the
--     NOMINATION-side max-bid pins stay GREEN under this probe (**29**
--     and **79**) — they are `draft_nominate`'s own §8.6.7(a) clause, a
--     different arm in a different function — and so does every phase,
--     turn, identity, raise, anti-snipe, E2 and solvency-consequence pin
--     (§G's award simulations are privileged inserts and never route
--     through the probed function at all). The wire suite
--     `auction-core-db.test.ts` fails **2 of its 3** cases under the same
--     probe (the over-max refusal, and the E2 case's high-bid
--     assertion).
--     **(2) THE R330 PROBE — the nomination-identity guard removed:
--     5 of 91 RED** — pins **44** and **45** (both refusal arms: the
--     stale bids are ACCEPTED instead), **46** (nomination 2 holds 5
--     rows where 3 belong), and the two population counts **66** and
--     **88**. Pin **43** (the matching-identity acceptance) stays GREEN
--     by construction — a guard that does nothing still lets a correct
--     bid through, which is exactly why the refusal arms are the
--     discriminators.
--     **(3) THE R329 PROBE — the anti-snipe ZERO BRANCH replaced by an
--     unconditional `GREATEST(deadline, now() + anti_snipe)`: exactly
--     1 of 91 RED — pin 61**, the expired-deadline case, which is the
--     entire reason that pin exists. Pin **60** (the shipped
--     anti-snipe-disabled pin, 1s left) stays GREEN under this probe,
--     which is the finding: it advertises a mutation it cannot detect.
--     All three reverted; 91/91 and 3/3 restored.
--   * **PROBE-ORDERING DISCIPLINE (why the ladders end with a refusal).**
--     In LA, LG and LD the over-max REFUSAL is the last act of its
--     nomination and is made by a seat that is NOT the standing high
--     bidder. Both properties are deliberate: under the probe the refused
--     bid LANDS, and if a later pin on the same nomination expected a
--     successful bid it would hit "you are already the high bidder"
--     — an ERROR outside `throws_ok`, which aborts the whole file at that
--     point (the first draft of this file did exactly that: 1 RED and 42
--     of its asserts never executed). A probe that kills the suite proves
--     less than one that leaves its wreckage on the floor to be counted.
--     §F's R330 identity block obeys the same rule for the same reason —
--     its ACCEPTED arm runs first and both refusals are made by seats
--     that are not the standing high bidder, which is why probe (2)
--     above leaves 5 pins RED instead of aborting the file.
--   * **ONE UNIT SHORT, EVERYWHERE (D146 — the R320 doctrine).** Every
--     ≥/≤/> comparison 085 makes is bracketed by a pin that is false by
--     exactly one unit of the thing compared, so a clause loosened or
--     tightened by one dollar, one slot or one second cannot pass:
--     (SECTION LETTERS BELOW WERE RE-POINTED IN THE BATCH-3 FIX CYCLE —
--     R333: seven of them named the wrong section of this same file, all
--     off by the amount the probe-ordering rework moved things. They are
--     verified against this file's own `^-- [A-O]\. ` anchors; re-verify
--     the same way if you move a section.)
--       · opening ≥ min_bid — $0 refused / $1 accepted at min_bid 1 (§E),
--         and −$1 refused / $0 accepted at min_bid 0 (§N, C38)
--       · opening ≤ max_bid — $187 refused / $186 accepted (§E), and
--         E25's $2 refused / $1 accepted on a $1-max team (§M)
--       · amount > high_bid — $1 refused ("outbid at $1") / $2 accepted
--         (§F), and at min_bid 0 the $0 raise refused / $1 accepted (§N)
--       · amount ≤ max_bid — $187 refused / $186 accepted (§F); §8.6.7(d)
--         exactly-$1 accepted / $2 refused (§N)
--       · open_slots ≥ 1 — a 14-of-15 team bids and a 15-of-15 team is
--         refused on the BID path (§H); the same pair on the NOMINATE
--         path is §K (§G is the solvency-CONSEQUENCE section, not this
--         boundary) (E27)
--       · remaining < anti_snipe — a bid at threshold − 1s FLOORS the
--         clock, at threshold + 1s does NOT move it, and exactly AT the
--         threshold is a no-op; with anti_snipe 0 even a 1s-left bid
--         moves nothing, and against an ALREADY-EXPIRED deadline the
--         zero branch leaves it untouched while anti_snipe 10 hands it a
--         full fresh window (§I, D128/E6 pinned to the second)
--   * **THE MAX-BID CLAUSE IS PINNED BY ITS CONSEQUENCE, not only by its
--     refusal (§G).** A bid accepted AT max_bid, awarded, leaves the team
--     EXACTLY at the §8.6.8 floor (remaining 14 ≥ 14 × $1) — and one
--     dollar more makes `draft_auction_solvent` FALSE. That pair is why
--     refusing above max_bid is what makes 086's award solvency-preserving
--     by construction, and it is what the DoD probe destroys.
--   * **BIDS NEVER MOVE MONEY (D131(2)/(3)).** After a nomination and six
--     raises, every bidder's `draft_team_budget` still reads its untouched
--     numbers and the draft is still solvent — the pin that keeps anyone
--     from "fixing" a future bug by decrementing a budget on bid.
--   * **THE E2 REPLAY ARM SITS ABOVE THE PHASE CHECK, and §J proves it:**
--     a replayed NOMINATION action_id during the BIDDING phase returns its
--     original row instead of the phase refusal. A replay arm placed after
--     the validations would fail there — which is exactly the reconnect
--     case E2 exists for. (The lookup is deliberately UNQUALIFIED on
--     `(draft_id, action_id)` and therefore VERB-BLIND — a recorded
--     residual with a per-verb contract enforced at the mint site: 085
--     banner item 6, ledger row F65/R331. Do not narrow it: the unqualified
--     lookup under the draft lock is what makes a duplicate action_id
--     un-insertable.)
--   * **NOMINATION IDENTITY ON THE BID PATH (R330), §F:** `draft_place_bid`
--     takes an optional `p_nomination_seq` / `p_player_id` pair, and both
--     arms are pinned — a MISMATCHED identity is refused with §16.3's "just
--     went off the board" copy, a MATCHING one is accepted, and the
--     omitted-both form (every other call in this file) still works
--     unchanged. Without the guard a bid in flight across a nomination
--     boundary lands on whatever player is live when it executes.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(91);

-- ---------------------------------------------------------------------------
-- A. Function form + grants (§4.1 grants doctrine; plan §8.3)
-- ---------------------------------------------------------------------------
select has_function('public', 'draft_nominate',
  array['uuid', 'text', 'integer', 'uuid'],
  'draft_nominate(uuid,text,integer,uuid) exists — §8.6.2''s action verb');
select has_function('public', 'draft_place_bid',
  array['uuid', 'integer', 'uuid', 'integer', 'text'],
  'draft_place_bid(uuid,integer,uuid,integer,text) exists — §8.6.3''s action verb, with the R330 nomination-identity pair (p_nomination_seq, p_player_id) as the two OPTIONAL trailing arguments');
select ok(
  (select count(*) = 2 and bool_and(p.prosecdef)
      and bool_and(array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('draft_nominate', 'draft_place_bid')),
  'both are SECURITY DEFINER with the exact spec-form SET search_path = '''' (R70) — they write append-only draft_bids rows that carry NO client write policy (083)');
select ok(
  not has_function_privilege('anon', 'public.draft_nominate(uuid,text,integer,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_place_bid(uuid,integer,uuid,integer,text)', 'EXECUTE'),
  'anon holds EXECUTE on neither (the REVOKE … FROM PUBLIC, anon half of the doctrine)');
select ok(
  has_function_privilege('authenticated', 'public.draft_nominate(uuid,text,integer,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.draft_place_bid(uuid,integer,uuid,integer,text)', 'EXECUTE'),
  '…and authenticated KEEPS it — these are the room''s own verbs (the draft_make_pick posture), reached through L.C2.1''s routes');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_make_pick'),
  'draft_make_pick survives its CREATE OR REPLACE still SECURITY DEFINER + search_path='''' (D137: only the refusal MESSAGE changed)');
select ok(
  not has_function_privilege('anon', 'public.draft_make_pick(uuid,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.draft_make_pick(uuid,text,uuid)', 'EXECUTE'),
  '…and 066''s grant posture survives it too (anon none, authenticated EXECUTE)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (five signed-in users; every draft row carries a FIXED id).
--    LA  8-team $200/min-1 auction — bid clock 30s, anti-snipe 10s, manual
--        order t1..t8; the main flow. u1..u5 manage t1..t5.
--    LG  8-team $3/min-1 auction with THREE draftable slots — E25 /
--        §8.6.7(d): every seat's max bid is $1.
--    LD  8-team $1/min-0 auction with THREE draftable slots — C38/C40's
--        degenerate floor: a $0 opening is legal, a raise is still +1.
--    LS  snake league (the wrong-type refusals).
--    LA also carries a MOCK auction row (the F61 seam — FLIPPED to the
--        D103(2) launcher gate by 089/L.C1.7) and, later, a
--        privileged paused/complete flip.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('8d000000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-ab' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       ('{"username": "ab_user_' || i || '"}')::jsonb, now(), now()
from generate_series(1, 6) i;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings)
values
  ('a6000000-0000-4000-8000-0000000000aa', '8d000000-0000-4000-8000-000000000001',
   'pgtap-ab-LA-main', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "manual",
     "draft_order": ["c6000000-0000-4000-8000-00aa00000001","c6000000-0000-4000-8000-00aa00000002",
                     "c6000000-0000-4000-8000-00aa00000003","c6000000-0000-4000-8000-00aa00000004",
                     "c6000000-0000-4000-8000-00aa00000005","c6000000-0000-4000-8000-00aa00000006",
                     "c6000000-0000-4000-8000-00aa00000007","c6000000-0000-4000-8000-00aa00000008"],
     "nomination_order_mode": "same_as_draft_order",
     "auction_budget": 200, "auction_zero_dollar_nominations": false,
     "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
     "auction_anti_snipe_seconds": 10, "pick_timer_seconds": 90}}'),
  ('a6000000-0000-4000-8000-0000000000bb', '8d000000-0000-4000-8000-000000000001',
   'pgtap-ab-LG-e25', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "manual",
     "draft_order": ["c6000000-0000-4000-8000-00bb00000001","c6000000-0000-4000-8000-00bb00000002",
                     "c6000000-0000-4000-8000-00bb00000003","c6000000-0000-4000-8000-00bb00000004",
                     "c6000000-0000-4000-8000-00bb00000005","c6000000-0000-4000-8000-00bb00000006",
                     "c6000000-0000-4000-8000-00bb00000007","c6000000-0000-4000-8000-00bb00000008"],
     "nomination_order_mode": "same_as_draft_order",
     "auction_budget": 3, "auction_zero_dollar_nominations": false,
     "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
     "auction_anti_snipe_seconds": 10, "pick_timer_seconds": 90}}'),
  ('a6000000-0000-4000-8000-0000000000cc', '8d000000-0000-4000-8000-000000000001',
   'pgtap-ab-LD-minbid0', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "manual",
     "draft_order": ["c6000000-0000-4000-8000-00cc00000001","c6000000-0000-4000-8000-00cc00000002",
                     "c6000000-0000-4000-8000-00cc00000003","c6000000-0000-4000-8000-00cc00000004",
                     "c6000000-0000-4000-8000-00cc00000005","c6000000-0000-4000-8000-00cc00000006",
                     "c6000000-0000-4000-8000-00cc00000007","c6000000-0000-4000-8000-00cc00000008"],
     "nomination_order_mode": "same_as_draft_order",
     "auction_budget": 1, "auction_zero_dollar_nominations": true,
     "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
     "auction_anti_snipe_seconds": 10, "pick_timer_seconds": 90}}'),
  ('a6000000-0000-4000-8000-0000000000dd', '8d000000-0000-4000-8000-000000000001',
   'pgtap-ab-LS-snake', 2026, 'scheduled', 8,   -- team_count is CHECK-constrained to 8/10/12/14/16; LS never starts, so its two seats are enough
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "snake", "pick_timer_seconds": 90}}');

-- LG/LD rosters: THREE draftable slots (2 RB starters + 1 bench, IR
-- excluded per D91) — E25's "$3 budget, 3 open slots" shape.
update leagues
set roster_settings = '{"starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 2}],
                        "bench": 1, "ir_slots": [], "swap_spots": 0}'::jsonb
where id in ('a6000000-0000-4000-8000-0000000000bb', 'a6000000-0000-4000-8000-0000000000cc');

insert into teams (id, owner_id, name, league_id)
select ('c6000000-0000-4000-8000-00aa000000' || lpad(i::text, 2, '0'))::uuid,
       '8d000000-0000-4000-8000-000000000001', 'pgtap-ab-LA-t' || i,
       'a6000000-0000-4000-8000-0000000000aa'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c6000000-0000-4000-8000-00bb000000' || lpad(i::text, 2, '0'))::uuid,
       '8d000000-0000-4000-8000-000000000001', 'pgtap-ab-LG-t' || i,
       'a6000000-0000-4000-8000-0000000000bb'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c6000000-0000-4000-8000-00cc000000' || lpad(i::text, 2, '0'))::uuid,
       '8d000000-0000-4000-8000-000000000001', 'pgtap-ab-LD-t' || i,
       'a6000000-0000-4000-8000-0000000000cc'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id) values
  ('c6000000-0000-4000-8000-00dd00000001', '8d000000-0000-4000-8000-000000000001',
   'pgtap-ab-LS-t1', 'a6000000-0000-4000-8000-0000000000dd'),
  ('c6000000-0000-4000-8000-00dd00000002', '8d000000-0000-4000-8000-000000000001',
   'pgtap-ab-LS-t2', 'a6000000-0000-4000-8000-0000000000dd');

-- Memberships: u1 commissions everything; u2..u5 manage LA's t2..t5;
-- u2/u3 manage LG's and LD's t2/t3. u6 is the OUTSIDER (no membership
-- anywhere — the 42501 no-leak arm).
insert into league_members (league_id, user_id, team_id, role) values
  ('a6000000-0000-4000-8000-0000000000aa', '8d000000-0000-4000-8000-000000000001',
   'c6000000-0000-4000-8000-00aa00000001', 'commissioner'),
  ('a6000000-0000-4000-8000-0000000000aa', '8d000000-0000-4000-8000-000000000002',
   'c6000000-0000-4000-8000-00aa00000002', 'manager'),
  ('a6000000-0000-4000-8000-0000000000aa', '8d000000-0000-4000-8000-000000000003',
   'c6000000-0000-4000-8000-00aa00000003', 'manager'),
  ('a6000000-0000-4000-8000-0000000000aa', '8d000000-0000-4000-8000-000000000004',
   'c6000000-0000-4000-8000-00aa00000004', 'manager'),
  ('a6000000-0000-4000-8000-0000000000aa', '8d000000-0000-4000-8000-000000000005',
   'c6000000-0000-4000-8000-00aa00000005', 'manager'),
  ('a6000000-0000-4000-8000-0000000000bb', '8d000000-0000-4000-8000-000000000001',
   'c6000000-0000-4000-8000-00bb00000001', 'commissioner'),
  ('a6000000-0000-4000-8000-0000000000bb', '8d000000-0000-4000-8000-000000000002',
   'c6000000-0000-4000-8000-00bb00000002', 'manager'),
  ('a6000000-0000-4000-8000-0000000000cc', '8d000000-0000-4000-8000-000000000001',
   'c6000000-0000-4000-8000-00cc00000001', 'commissioner'),
  ('a6000000-0000-4000-8000-0000000000cc', '8d000000-0000-4000-8000-000000000002',
   'c6000000-0000-4000-8000-00cc00000002', 'manager'),
  ('a6000000-0000-4000-8000-0000000000cc', '8d000000-0000-4000-8000-000000000003',
   'c6000000-0000-4000-8000-00cc00000003', 'manager'),
  ('a6000000-0000-4000-8000-0000000000dd', '8d000000-0000-4000-8000-000000000001',
   'c6000000-0000-4000-8000-00dd00000001', 'commissioner');

-- Fixed draft ids (the 033 LB precedent — every assertion below reads a
-- literal, never a lookup).
insert into drafts (id, league_id, draft_type, status, is_mock, config) values
  ('e6000000-0000-4000-8000-0000000000aa', 'a6000000-0000-4000-8000-0000000000aa',
   'auction', 'scheduled', false, '{}'),
  ('e6000000-0000-4000-8000-0000000000bb', 'a6000000-0000-4000-8000-0000000000bb',
   'auction', 'scheduled', false, '{}'),
  ('e6000000-0000-4000-8000-0000000000cc', 'a6000000-0000-4000-8000-0000000000cc',
   'auction', 'scheduled', false, '{}');
-- LS: a LIVE SNAKE draft (wrong-type refusals) and, in LA's league, a
-- MOCK auction (built by hand WITHOUT config.mock — it was the F61 seam
-- fixture while 071 refused auction configs; since 089 it is the
-- launched_by-NULL "tick-only" shape of D110(9), and §D pins that the
-- launcher gate refuses every human on it).
insert into drafts (id, league_id, draft_type, status, is_mock, config, total_rounds) values
  ('e6000000-0000-4000-8000-0000000000dd', 'a6000000-0000-4000-8000-0000000000dd',
   'snake', 'live', false, '{"pick_timer_seconds": 90}', 15),
  ('e6000000-0000-4000-8000-0000000000ee', 'a6000000-0000-4000-8000-0000000000aa',
   'auction', 'live', true, '{"auction_budget": 200, "auction_zero_dollar_nominations": false}', 15);

insert into players (id, full_name, position)
select 'pgtap-ab-p' || lpad(i::text, 2, '0'),
       'PgTap Auction Bid ' || i,
       case when i % 3 = 0 then 'WR' else 'RB' end
from generate_series(1, 40) i;

-- LA starts through the ENGINE (privileged — 033's posture; the wrapper
-- path is 020's). t1 nominates first, the clock is the 45s nomination
-- clock, and every seat reads 200/15/186/0.
select is(
  (public.draft_start_internal('a6000000-0000-4000-8000-0000000000aa', false)->>'started')::boolean,
  true,
  'LA: the auction starts (084''s arm) — the board this file drives');
select is(
  (select on_clock_team_id || '|' || current_pick_number::text
   from drafts where id = 'e6000000-0000-4000-8000-0000000000aa'),
  'c6000000-0000-4000-8000-00aa00000001|1',
  '…t1 is the first NOMINATOR at nomination sequence 1 (D126)');
select ok(
  (select current_nomination is null
   from drafts where id = 'e6000000-0000-4000-8000-0000000000aa'),
  '…and the draft opens in the NOMINATING phase (D126: current_nomination NULL)');

-- ---------------------------------------------------------------------------
-- C. Argument shape (22023) + the 42501 no-leak arm
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
       null, 1, 'a6000000-0000-4000-8000-000000000001') $$,
  '22023', 'draft_nominate: player_id is required',
  'draft_nominate: a NULL player_id is an argument-shape error (22023), before any data access');
select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
       'pgtap-ab-p01', null, 'a6000000-0000-4000-8000-000000000001') $$,
  '22023',
  'draft_nominate: opening_bid is required — a nomination always names its opening bid (§8.6.2)',
  '…and so is a NULL opening_bid (a nomination without a price is not a nomination — §8.6.2)');
select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
       'pgtap-ab-p01', 1, null) $$,
  '22023',
  'draft_nominate: action_id is required — client nominations are idempotent (§8.1/E2)',
  '…and a NULL action_id (E2 is not optional — every client action carries one)');
select throws_ok(
  $$ select public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
       null, 'a6000000-0000-4000-8000-000000000001') $$,
  '22023', 'draft_place_bid: amount is required',
  'draft_place_bid: a NULL amount is 22023');
select throws_ok(
  $$ select public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
       1, null) $$,
  '22023',
  'draft_place_bid: action_id is required — client bids are idempotent (§8.1/E2)',
  '…and a NULL action_id is too');

-- The no-leak arm: a nonexistent draft and a non-member answer IDENTICALLY
-- (42501), so neither call can be used to probe which drafts exist.
select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-000000000999',
       'pgtap-ab-p01', 1, 'a6000000-0000-4000-8000-000000000002') $$,
  '42501', 'draft_nominate: not a member of this draft''s league',
  'a MISSING draft answers 42501 with the non-member message (no-leak — is_league_member(NULL) is FALSE)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
       'pgtap-ab-p01', 1, 'a6000000-0000-4000-8000-000000000003') $$,
  '42501', 'draft_nominate: not a member of this draft''s league',
  '…and the OUTSIDER on a real draft gets the same 42501 — byte-identical to the missing-draft answer');
select throws_ok(
  $$ select public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
       5, 'a6000000-0000-4000-8000-000000000004') $$,
  '42501', 'draft_place_bid: not a member of this draft''s league',
  '…and the outsider cannot bid either');

-- ---------------------------------------------------------------------------
-- D. Wrong draft type / status / mock launcher gate — refused for BOTH verbs
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000dd',
       'pgtap-ab-p01', 1, 'a6000000-0000-4000-8000-000000000005') $$,
  'P0001', 'draft_nominate: this is a snake draft — only auction drafts nominate (§8.6)',
  'a SNAKE draft refuses a nomination by name (the mirror of draft_make_pick''s reworded auction refusal)');
select throws_ok(
  $$ select public.draft_place_bid('e6000000-0000-4000-8000-0000000000dd',
       5, 'a6000000-0000-4000-8000-000000000006') $$,
  'P0001', 'draft_place_bid: this is a snake draft — only auction drafts take bids (§8.6)',
  '…and refuses a bid');
-- F61 DISCHARGED (089/L.C1.7 — the seam pins FLIPPED in place, the 020/025
-- precedent): the mock seam refusal ("mock auctions are not open yet") is
-- gone and the D103(2) LAUNCHER GATE stands in its place. This fixture mock
-- is CONFIG-LESS (no config.mock ⇒ launched_by NULL), so it is tick-only
-- and EVERY human caller is refused — D110(9)'s safe default. The admit
-- side (the launcher nominates/bids FOR the human seat, the seat's real
-- manager is refused) is pinned in 038 §C on a mock launched through the
-- real verb.
select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000ee',
       'pgtap-ab-p01', 1, 'a6000000-0000-4000-8000-000000000007') $$,
  'P0001',
  'draft_nominate: this mock draft is another member''s solo practice (§8.8/D103)',
  'THE F61 SEAM, FLIPPED: a MOCK auction answers with the D103(2) launcher gate — a caller who is not config.mock.launched_by cannot nominate (this config-less fixture admits nobody)');
select throws_ok(
  $$ select public.draft_place_bid('e6000000-0000-4000-8000-0000000000ee',
       5, 'a6000000-0000-4000-8000-000000000008') $$,
  'P0001',
  'draft_place_bid: this mock draft is another member''s solo practice (§8.8/D103)',
  '…and cannot bid — so with 071''s refusal lifted, no league member can bid inside another member''s solo practice (D138 extends D103(2) to bids)');
select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000bb',
       'pgtap-ab-p01', 1, 'a6000000-0000-4000-8000-000000000009') $$,
  'P0001', 'draft_nominate: the draft has not started yet',
  'a SCHEDULED auction (LG, not started yet) refuses nominations');
select throws_ok(
  $$ select public.draft_place_bid('e6000000-0000-4000-8000-0000000000bb',
       1, 'a6000000-0000-4000-8000-00000000000a') $$,
  'P0001', 'draft_place_bid: the draft has not started yet',
  '…and bids');

-- ---------------------------------------------------------------------------
-- E. draft_nominate — turn, availability and the OPENING-BID BOUNDS
--    (§8.6.7(a); the one-unit-short pairs on both sides)
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
       'pgtap-ab-p01', 1, 'a6000000-0000-4000-8000-00000000000b') $$,
  'P0001', 'draft_nominate: it is not your turn to nominate — pgtap-ab-LA-t1 is on the clock',
  'TURN: a member who is not the nominator is refused, and the message NAMES who is on the clock (error strings are UX)');

-- NO COMMISSIONER BYPASS (R301, restated at 085:44–45) — and the pin the
-- suite lacked (R334): the refusal above is made by a plain MANAGER, while
-- u1 (the COMMISSIONER) is LA's on-clock nominator throughout this file, so
-- an off-clock commissioner never called the verb and an
-- `IF is_league_commish(...) THEN <bypass>` would have left the suite fully
-- green. t2 is put on the clock privileged for exactly one assertion, then
-- put back — force-nominate is 087/L.C1.5's OWN verb, which is the task
-- that introduces the bypass this pin exists to forbid here.
reset role;
update drafts set on_clock_team_id = 'c6000000-0000-4000-8000-00aa00000002'
where id = 'e6000000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
       'pgtap-ab-p01', 1, 'a6000000-0000-4000-8000-00000000002f') $$,
  'P0001', 'draft_nominate: it is not your turn to nominate — pgtap-ab-LA-t2 is on the clock',
  '…and THE COMMISSIONER gets the identical refusal off the clock — there is NO commissioner bypass in draft_nominate (R301/R334); the commissioner''s path is 087''s force-nominate verb');
reset role;
update drafts set on_clock_team_id = 'c6000000-0000-4000-8000-00aa00000001'
where id = 'e6000000-0000-4000-8000-0000000000aa';

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
       'pgtap-ab-nope', 1, 'a6000000-0000-4000-8000-00000000000c') $$,
  'P0002', 'draft_nominate: player pgtap-ab-nope not found',
  'an unknown player is a 404-class P0002, not a friendly refusal');
select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
       'pgtap-ab-p01', 0, 'a6000000-0000-4000-8000-00000000000d') $$,
  'P0001',
  'draft_nominate: an opening bid of $0 is below this league''s $1 nomination floor (§7.3.8)',
  'NOMINATION-FLOOR BOUNDARY, one dollar short: $0 is refused with $0 nominations OFF (floor $1)');
select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
       'pgtap-ab-p01', 187, 'a6000000-0000-4000-8000-00000000000e') $$,
  'P0001',
  'draft_nominate: an opening bid of $187 is over your max bid of $186 — you have $200 for 15 open roster spots at a $1 per-slot reserve (§8.6.7(a))',
  'MAX-BID BOUNDARY, one dollar over: $187 is refused against a $186 max bid, and the message names the formula''s number AND the money behind it (§8.6.7(a))');

-- The accepted side of the same boundary: EXACTLY max_bid opens bidding.
select is(
  (public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
     'pgtap-ab-p01', 186, 'a6000000-0000-4000-8000-00000000000f')
   #>> '{draft,current_nomination,high_bid}'),
  '186',
  '…and EXACTLY $186 is accepted — the nominator may spend their whole max bid on their own opening (§8.6.7(a))');
select is(
  (select current_nomination
   from drafts where id = 'e6000000-0000-4000-8000-0000000000aa'),
  jsonb_build_object(
    'player_id', 'pgtap-ab-p01',
    'high_bid', 186,
    'high_bidder_team_id', 'c6000000-0000-4000-8000-00aa00000001'),
  'D126 PHASE FLIP: current_nomination carries EXACTLY 065:121''s printed shape { player_id, high_bid, high_bidder_team_id } — the nominator is the standing high bidder (which is what makes §8.6.7(b)''s no-raise award, E26, well-defined)');
select is(
  (select current_deadline from drafts where id = 'e6000000-0000-4000-8000-0000000000aa'),
  now() + interval '30 seconds',
  '…and the clock becomes the BID clock (auction_bid_seconds = 30), not the 45s nomination clock — the D128 fixed window opens here');
select is(
  (select on_clock_team_id::text || '|' || current_pick_number::text
   from drafts where id = 'e6000000-0000-4000-8000-0000000000aa'),
  'c6000000-0000-4000-8000-00aa00000001|1',
  '…on_clock stays the NOMINATOR through bidding and the sequence number is NOT consumed — 086 owns both advances (D126/D130)');
select results_eq(
  $$ select nomination_seq, player_id, team_id, amount, action_id
     from draft_bids where draft_id = 'e6000000-0000-4000-8000-0000000000aa' $$,
  $$ values (1, 'pgtap-ab-p01', 'c6000000-0000-4000-8000-00aa00000001'::uuid, 186,
             'a6000000-0000-4000-8000-00000000000f'::uuid) $$,
  'THE OPENING BID IS A draft_bids ROW (§12.5 uniform history): seq 1, the nominator, the opening amount, and the caller''s action_id — which is also the E2 replay key');

-- Nominating again while bidding is open is the PHASE refusal.
select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
       'pgtap-ab-p02', 1, 'a6000000-0000-4000-8000-000000000010') $$,
  'P0001',
  'draft_nominate: bidding is already open on PgTap Auction Bid 1 at $186 — place a bid instead of nominating (§8.6.3)',
  'PHASE: nominating during BIDDING is refused, naming the live player and the standing high bid (D126)');


-- ---------------------------------------------------------------------------
-- F. draft_place_bid — raise semantics, self-raise, and the E5 max-bid
--    clause (both one-unit-short pairs), on nomination 2
-- ---------------------------------------------------------------------------
-- SIMULATED CLOSE of nomination 1 (086/L.C1.4 owns the real one — see the
-- header): clear the phase and consume the sequence number by hand, leaving
-- the seq-1 bid row standing as history.
reset role;
update drafts
set current_nomination  = null,
    current_pick_number = 2,
    current_deadline    = now() + interval '45 seconds'
where id = 'e6000000-0000-4000-8000-0000000000aa';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
       5, 'a6000000-0000-4000-8000-000000000011') $$,
  'P0001',
  'draft_place_bid: no player is up for bid right now — pgtap-ab-LA-t1 is on the clock to nominate (§8.6.2)',
  'PHASE, the other direction: bidding during the NOMINATING phase is refused and points at the nominator (§8.6.2)');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
     'pgtap-ab-p02', 1, 'a6000000-0000-4000-8000-000000000012')
   #>> '{bid,nomination_seq}'),
  '2',
  'NOMINATION SEQ MONOTONICITY: the next nomination writes seq 2 — bids are keyed to their nomination, which is what idx_draft_bids_nom orders (§12.5)');
select is(
  (select count(*)::int from draft_bids
   where draft_id = 'e6000000-0000-4000-8000-0000000000aa' and nomination_seq = 1),
  1,
  '…and nomination 1''s history is untouched by the new nomination (bids are append-only — 083 gives them no UPDATE/DELETE policy at all, D131(2))');

select throws_ok(
  $$ select public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
       2, 'a6000000-0000-4000-8000-000000000013') $$,
  'P0001',
  'draft_place_bid: you are already the high bidder at $1 — wait for someone to raise you (§8.6.3)',
  'SELF-RAISE is refused: bidding against yourself only burns your own budget and the clock');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
       1, 'a6000000-0000-4000-8000-000000000014') $$,
  'P0001',
  'draft_place_bid: outbid at $1 — pgtap-ab-LA-t1 holds the high bid; bid $2 or more',
  'RAISE BOUNDARY, one dollar short: MATCHING the high bid is refused — and this is the instant-loser path, a friendly P0001 naming the number and the next legal bid, never a 429 (D136/§16.3)');
select is(
  (public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
     2, 'a6000000-0000-4000-8000-000000000015')
   #>> '{draft,current_nomination,high_bid}'),
  '2',
  '…and one dollar more (+$1, the minimum legal raise) is accepted');
select is(
  (select current_nomination->>'high_bidder_team_id'
   from drafts where id = 'e6000000-0000-4000-8000-0000000000aa'),
  'c6000000-0000-4000-8000-00aa00000002',
  '…with the high bidder moving to the raiser (the room''s centerpiece value)');

-- NOMINATION IDENTITY (R330), all three arms, on the live nomination 2
-- (player p02, seq 2, standing high bid $2). A bid carries an AMOUNT and
-- nothing else, so without these arguments a bid submitted against
-- nomination 1 and executed after nomination 2 opened would be applied to
-- p02 — proven on this very fixture before the guard landed. Every OTHER
-- call in this file omits them, which is the third arm: omitted ⇒ shipped
-- behavior, so no existing caller breaks.
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
-- The ACCEPTED arm goes FIRST and the two refusals last, by the same
-- probe-ordering discipline the header states: with the guard removed the
-- two refused bids LAND, and if an accepted bid followed them it would hit
-- "you are already the high bidder"/"outbid at $N" — an ERROR outside
-- throws_ok, which would abort the file instead of leaving the probe's
-- wreckage on the floor to be counted. Each refusal is also made by a seat
-- that is NOT the standing high bidder, for the same reason.
select is(
  (public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
     3, 'a6000000-0000-4000-8000-000000000032', 2, 'pgtap-ab-p02')
   #>> '{draft,current_nomination,high_bid}'),
  '3',
  'IDENTITY, MATCHING: a bid that names the live nomination (seq 2, p02) is accepted and raises normally — the guard refuses stale targets, it does not make bidding harder (and every OTHER call in this file omits both arguments, which is the unchanged-by-default arm)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
       4, 'a6000000-0000-4000-8000-000000000030', 2, 'pgtap-ab-p01') $$,
  'P0001',
  'draft_place_bid: PgTap Auction Bid 1 just went off the board — PgTap Auction Bid 2 is up for bid now at $3 (§16.3)',
  'IDENTITY, player MISMATCH: a bid naming the PREVIOUS nomination''s player is refused with §16.3''s "just went off the board" copy, and the message names what IS up and at what price — the refusal that stops a manager becoming high bidder on a player they never saw');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
       5, 'a6000000-0000-4000-8000-000000000031', 1, 'pgtap-ab-p02') $$,
  'P0001',
  'draft_place_bid: that nomination just went off the board — PgTap Auction Bid 2 is up for bid now at $3 (§16.3)',
  '…and the SEQUENCE arm refuses independently, with the RIGHT player named: the two checks do not subsume each other — D143''s cancel-and-renominate reuses a sequence number with a different player, and an undone award returns a player to the pool at a LATER sequence');
select is(
  (select count(*)::int from draft_bids
   where draft_id = 'e6000000-0000-4000-8000-0000000000aa' and nomination_seq = 2),
  3,
  '…and BOTH refusals wrote NOTHING — nomination 2 holds exactly its opening, the $2 raise and the ONE accepted identity bid (three rows; the accepted bid above is what keeps this count from being a vacuous zero)');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is(
  (public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
     186, 'a6000000-0000-4000-8000-000000000017')
   #>> '{draft,current_nomination,high_bid}'),
  '186',
  'MAX-BID BOUNDARY, accepted side: EXACTLY $186 goes through — the formula is a ceiling, not a fence one dollar below it');
-- The refusal is deliberately the LADDER'S LAST ACT, and by a bidder who
-- is NOT the standing high bidder: under the DoD break probe the refused
-- bid LANDS instead, and because nothing after it on this nomination
-- depends on the high bid, the probe's damage stays observable (an extra
-- row, an over-max row in history) rather than aborting the suite on an
-- unexpected self-raise error. A probe that kills the file proves less
-- than one that leaves the wreckage on the floor.
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
       187, 'a6000000-0000-4000-8000-000000000016') $$,
  'P0001',
  'draft_place_bid: $187 is over your max bid of $186 — you have $200 for 15 open roster spots at a $1 per-slot reserve (§8.6.1/E5)',
  'E5 MAX-BID BOUNDARY, one dollar over: $187 is refused against a $186 max bid — THE DoD BREAK PROBE''S PRIMARY TARGET');

-- ---------------------------------------------------------------------------
-- G. THE CLAUSE'S CONSEQUENCE (§8.6.8): refusing above max_bid is exactly
--    what makes 086's award solvency-preserving. Both awards below are
--    PRIVILEGED SIMULATIONS of 086's write — this file never closes a
--    nomination for real.
-- ---------------------------------------------------------------------------
reset role;
insert into draft_picks (draft_id, league_id, team_id, player_id, pick_number, round, price, made_via)
values ('e6000000-0000-4000-8000-0000000000aa', 'a6000000-0000-4000-8000-0000000000aa',
        'c6000000-0000-4000-8000-00aa00000003', 'pgtap-ab-p02', 2, null, 186, 'manager');
select ok(
  public.draft_auction_solvent('e6000000-0000-4000-8000-0000000000aa'),
  'AWARDED AT EXACTLY max_bid, the winner lands EXACTLY on the §8.6.8 floor (remaining 14 ≥ 14 open × $1) — the equality the formula is built to reach');
update draft_picks set price = 187
where draft_id = 'e6000000-0000-4000-8000-0000000000aa' and player_id = 'pgtap-ab-p02';
select is(
  public.draft_auction_solvent('e6000000-0000-4000-8000-0000000000aa'),
  false,
  '…and ONE DOLLAR MORE breaks §8.6.8 (13 < 14 × $1) — so refusing above max_bid IS the invariant at the bid layer, not a nicety');
delete from draft_picks
where draft_id = 'e6000000-0000-4000-8000-0000000000aa' and player_id = 'pgtap-ab-p02';
select ok(
  public.draft_auction_solvent('e6000000-0000-4000-8000-0000000000aa'),
  '…removing the simulated award restores solvency (the derivation has no memory to drift — D127)');

-- BIDS NEVER MOVE MONEY (D131(2)/(3)): t3 holds a standing $186 high bid
-- and its budget is untouched. Only a WON pick spends.
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid, b.committed
     from public.draft_team_budget('e6000000-0000-4000-8000-0000000000aa',
                                   'c6000000-0000-4000-8000-00aa00000003') b $$,
  $$ values (200, 15, 186, 0) $$,
  'A STANDING $186 BID COSTS NOTHING: the high bidder still reads 200/15/186/0 — bids never hold budget, only won picks do (D131(2), which is why undo needs no refund bookkeeping)');

-- ---------------------------------------------------------------------------
-- H. E27 — a complete roster cannot bid; a team ONE SLOT from complete can
--    (the open_slots ≥ 1 pair, isolated from money)
-- ---------------------------------------------------------------------------
-- t4 fills 14 of 15 slots at $1 (remaining 186, open 1, max_bid 186); t5
-- fills all 15 (remaining 185, open 0, max_bid 0). Both stay solvent, so
-- this fixture tests CAPACITY and nothing else.
insert into draft_picks (draft_id, league_id, team_id, player_id, pick_number, round, price, made_via)
select 'e6000000-0000-4000-8000-0000000000aa', 'a6000000-0000-4000-8000-0000000000aa',
       'c6000000-0000-4000-8000-00aa00000004',
       'pgtap-ab-p' || lpad((i + 2)::text, 2, '0'), 100 + i, null, 1, 'manager'
from generate_series(1, 14) i;
insert into draft_picks (draft_id, league_id, team_id, player_id, pick_number, round, price, made_via)
select 'e6000000-0000-4000-8000-0000000000aa', 'a6000000-0000-4000-8000-0000000000aa',
       'c6000000-0000-4000-8000-00aa00000005',
       'pgtap-ab-p' || lpad((i + 16)::text, 2, '0'), 200 + i, null, 1, 'manager'
from generate_series(1, 15) i;
select results_eq(
  $$ select b.open_slots, b.remaining, b.max_bid from public.draft_team_budget(
       'e6000000-0000-4000-8000-0000000000aa', 'c6000000-0000-4000-8000-00aa00000005') b $$,
  $$ values (0, 185, 0) $$,
  'fixture check: t5''s roster is COMPLETE (0 open slots ⇒ max_bid 0 via 084''s E27 branch) and it is still solvent — capacity is the only thing that changed');

-- SIMULATED CLOSE of nomination 2 → nomination 3 opens at $1, so the pins
-- below test capacity against a LOW high bid rather than a $186 one.
update drafts
set current_nomination  = null,
    current_pick_number = 3,
    current_deadline    = now() + interval '45 seconds'
where id = 'e6000000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
     'pgtap-ab-p32', 1, 'a6000000-0000-4000-8000-00000000002e')
   #>> '{bid,nomination_seq}'),
  '3',
  'nomination 3 opens at $1 (seq 3 — the monotonic sequence again, and the low high bid the capacity pins need)');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
       2, 'a6000000-0000-4000-8000-000000000018') $$,
  'P0001',
  'draft_place_bid: your roster is complete — a complete roster cannot bid (§8.6.7(c)/E27)',
  'E27, zero slots: a COMPLETE roster is refused on the bid path by CAPACITY — checked before the money clauses, so the message names the true reason instead of "over your max bid of $0"');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select is(
  (public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
     2, 'a6000000-0000-4000-8000-000000000019')
   #>> '{draft,current_nomination,high_bid}'),
  '2',
  '…while ONE open slot is enough: t4 (14 of 15 filled) raises to $2 — the boundary is open_slots ≥ 1, not "an empty-ish roster"');

-- ---------------------------------------------------------------------------
-- I. The D128 anti-snipe floor, pinned TO THE SECOND (E6) — both sides of
--    the boundary, the exact instant, and the disabled case. Each case
--    sets the standing deadline privileged and then bids: now() is the
--    transaction instant, so every expectation below is exact.
-- ---------------------------------------------------------------------------
reset role;
update drafts set current_deadline = now() + interval '9 seconds'
where id = 'e6000000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
     3, 'a6000000-0000-4000-8000-00000000001a')
   #>> '{draft,current_deadline}')::timestamptz,
  now() + interval '10 seconds',
  'ANTI-SNIPE, one second INSIDE the window (9s left, threshold 10): the clock is FLOORED to 10s — E6''s printed case ("3s left, threshold 10 ⇒ reads 10s"), D128''s reset-TO semantics');

reset role;
update drafts set current_deadline = now() + interval '11 seconds'
where id = 'e6000000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  (public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
     4, 'a6000000-0000-4000-8000-00000000001b')
   #>> '{draft,current_deadline}')::timestamptz,
  now() + interval '11 seconds',
  '…one second OUTSIDE it (11s left): the deadline does NOT move — D128''s fixed window, and Chris''s own clarification that the countdown continues uninterrupted through bids above the threshold');

reset role;
update drafts set current_deadline = now() + interval '10 seconds'
where id = 'e6000000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is(
  (public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
     5, 'a6000000-0000-4000-8000-00000000001c')
   #>> '{draft,current_deadline}')::timestamptz,
  now() + interval '10 seconds',
  '…and EXACTLY AT the threshold the two readings agree (the boundary instant: flooring to 10s when 10s remain is a no-op — which is why the < / ≤ choice is unobservable here and the one-second pins above are the real discriminators)');

reset role;
update drafts
set config = jsonb_set(config, '{auction_anti_snipe_seconds}', '0'),
    current_deadline = now() + interval '1 second'
where id = 'e6000000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
     6, 'a6000000-0000-4000-8000-00000000001d')
   #>> '{draft,current_deadline}')::timestamptz,
  now() + interval '1 second',
  'ANTI-SNIPE DISABLED (auction_anti_snipe_seconds = 0 — §7.3.8''s floor): even a bid with ONE SECOND left moves nothing. A PURE FIXED WINDOW — note what this pin does and does NOT discriminate (R329): on a LIVE deadline an unconditional GREATEST(deadline, now() + 0s) gives the identical answer, because make_interval(secs => 0) is zero; the branch is only observable against a deadline that is NOT in the future, which the next two pins supply');

-- THE CASES THAT ACTUALLY DISCRIMINATE THE ZERO BRANCH (R329, added in the
-- batch-3 fix cycle). The branch and an unconditional GREATEST differ only
-- when the standing deadline has already passed — a bid that beat the tick
-- to the locked row. Both readings are pinned to the second, so the branch
-- cannot be replaced by a GREATEST, and the anti_snipe > 0 behavior against
-- an expired clock is recorded rather than left silent.
reset role;
update drafts
set config = jsonb_set(config, '{auction_anti_snipe_seconds}', '0'),
    current_deadline = now() - interval '5 seconds'
where id = 'e6000000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  (public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
     7, 'a6000000-0000-4000-8000-000000000033')
   #>> '{draft,current_deadline}')::timestamptz,
  now() - interval '5 seconds',
  'ANTI-SNIPE DISABLED against an ALREADY-EXPIRED deadline: the deadline is left EXACTLY where it was (−5s, still due). An unconditional GREATEST would REWRITE it forward to now() — this is the ONLY arithmetic difference the zero branch makes, and it is the pin that forbids the replacement');

reset role;
update drafts
set config = jsonb_set(config, '{auction_anti_snipe_seconds}', '10'),
    current_deadline = now() - interval '5 seconds'
where id = 'e6000000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is(
  (public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
     8, 'a6000000-0000-4000-8000-000000000034')
   #>> '{draft,current_deadline}')::timestamptz,
  now() + interval '10 seconds',
  'ANTI-SNIPE ENABLED against an ALREADY-EXPIRED deadline: the bid receives a FULL FRESH WINDOW (now + 10s) — D128''s letter ("reset the remaining time TO anti_snipe") and snake''s posture that the TICK is the enforcer of expiry, not the deadline column. Recorded deliberately (R329) rather than left as unpinned emergent behavior');
reset role;
update drafts set current_deadline = now() + interval '30 seconds'
where id = 'e6000000-0000-4000-8000-0000000000aa';

select is(
  (select count(*)::int from draft_bids
   where draft_id = 'e6000000-0000-4000-8000-0000000000aa' and nomination_seq = 3),
  8,
  'nomination 3''s history is the full ladder — 8 rows (opening + 7 accepted raises); every refused attempt above wrote NOTHING');
select ok(
  public.draft_auction_solvent('e6000000-0000-4000-8000-0000000000aa'),
  '…and the draft is STILL SOLVENT after the whole ladder (§8.6.8 across three nominations and thirteen bids — bids move no money, so solvency cannot be bid away)');

-- ---------------------------------------------------------------------------
-- J. E2 replays — both verbs, and the replay arm proven to sit ABOVE the
--    phase validations (the reconnect case E2 exists for)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
     999, 'a6000000-0000-4000-8000-00000000001d')
   #>> '{bid,amount}'),
  '6',
  'E2 (bid): a replayed action_id returns ITS OWN original row — even when the retry carries a different amount, which is what a double-tap on a flaky connection actually sends');
select is(
  (select count(*)::int from draft_bids
   where draft_id = 'e6000000-0000-4000-8000-0000000000aa'),
  13,
  '…and writes NOTHING: still 13 bid rows across the three nominations (1 + 4 + 8)');
select is(
  (select current_nomination->>'high_bid'
   from drafts where id = 'e6000000-0000-4000-8000-0000000000aa'),
  '8',
  '…and the standing high bid is unchanged at $8 — the replay is a no-op, not a $999 raise (the replayed ROW still reads its own $6; the two numbers differing is the point)');
select is(
  (public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
     'pgtap-ab-p40', 1, 'a6000000-0000-4000-8000-000000000012')
   #>> '{bid,player_id}'),
  'pgtap-ab-p02',
  'E2 (nominate): a replayed nomination returns ITS OWN opening row (p02, seq 2) — and note WHERE from: the phase is BIDDING, so a replay arm placed after the validations would have raised the phase refusal instead (R125 — an action_id is consumed forever)');
select ok(
  (select current_nomination->>'player_id' = 'pgtap-ab-p32'
   from drafts where id = 'e6000000-0000-4000-8000-0000000000aa'),
  '…and the live nomination is untouched by the replayed nomination');

-- ---------------------------------------------------------------------------
-- K. Availability + the D129(1) capacity fit on the NOMINATION path
-- ---------------------------------------------------------------------------
-- SIMULATED CLOSE of nomination 3 (privileged — 086 owns the real one).
reset role;
update drafts
set current_nomination  = null,
    current_pick_number = 4,
    current_deadline    = now() + interval '45 seconds'
where id = 'e6000000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
       'pgtap-ab-p03', 1, 'a6000000-0000-4000-8000-00000000001e') $$,
  'P0001',
  'draft_nominate: PgTap Auction Bid 3 just went off the board — nominate another player',
  'AVAILABILITY (the E1 shape, nomination edition): a player already bought cannot be nominated again, and the message names him');

-- Capacity fit (D129(1)). 086's rotation must never land on a full team
-- (§8.6.7(c)), but if it ever did, the nomination is refused rather than
-- opening bidding on a player the nominator could not be awarded.
reset role;
update drafts set on_clock_team_id = 'c6000000-0000-4000-8000-00aa00000005'
where id = 'e6000000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
       'pgtap-ab-p38', 1, 'a6000000-0000-4000-8000-00000000001f') $$,
  'P0001',
  'draft_nominate: your roster is complete — complete rosters are skipped in the nomination rotation and cannot bid (§8.6.7(c)/E27)',
  'CAPACITY, zero slots: a COMPLETE roster cannot nominate either — and capacity is checked BEFORE the bid bounds, so it is not reported as "over your max bid of $0"');
reset role;
update drafts set on_clock_team_id = 'c6000000-0000-4000-8000-00aa00000004'
where id = 'e6000000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select is(
  (public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
     'pgtap-ab-p38', 1, 'a6000000-0000-4000-8000-000000000020')
   #>> '{bid,nomination_seq}'),
  '4',
  '…while ONE open slot is enough to nominate (D129(1)''s capacity-ONLY fit: humans may buy a third QB — need-fit is the system path''s rule, §8.4)');

-- ---------------------------------------------------------------------------
-- L. Paused / complete refusals (both verbs), on the live LA board
-- ---------------------------------------------------------------------------
reset role;
update drafts set status = 'paused' where id = 'e6000000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
       2, 'a6000000-0000-4000-8000-000000000021') $$,
  'P0001', 'draft_place_bid: the draft is paused',
  'a PAUSED draft takes no bids (clocks are frozen — §8.7''s pause semantics)');
select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
       'pgtap-ab-p39', 1, 'a6000000-0000-4000-8000-000000000022') $$,
  'P0001', 'draft_nominate: the draft is paused',
  '…and no nominations');
reset role;
update drafts set status = 'complete' where id = 'e6000000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_place_bid('e6000000-0000-4000-8000-0000000000aa',
       2, 'a6000000-0000-4000-8000-000000000023') $$,
  'P0001', 'draft_place_bid: the draft is complete',
  'a COMPLETE draft takes no bids');
select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000aa',
       'pgtap-ab-p39', 1, 'a6000000-0000-4000-8000-000000000024') $$,
  'P0001', 'draft_nominate: the draft is complete',
  '…and no nominations');
reset role;
update drafts set status = 'live' where id = 'e6000000-0000-4000-8000-0000000000aa';

-- ---------------------------------------------------------------------------
-- M. E25 / §8.6.7(d) — the $1-max team (LG: $3 across THREE slots)
-- ---------------------------------------------------------------------------
select is(
  (public.draft_start_internal('a6000000-0000-4000-8000-0000000000bb', false)->>'started')::boolean,
  true,
  'LG starts: $3 across THREE draftable slots — E25''s fixture, solvent at exact equality (3 ≥ 3 × $1)');
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid from public.draft_team_budget(
       'e6000000-0000-4000-8000-0000000000bb', 'c6000000-0000-4000-8000-00bb00000001') b $$,
  $$ values (3, 3, 1) $$,
  '…and every seat''s max bid is $1 (§8.6.7(d): "when a team''s max bid is $1, only $1 bids are accepted for it")');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000bb',
       'pgtap-ab-p01', 2, 'a6000000-0000-4000-8000-000000000025') $$,
  'P0001',
  'draft_nominate: an opening bid of $2 is over your max bid of $1 — you have $3 for 3 open roster spots at a $1 per-slot reserve (§8.6.7(a))',
  'E25, one dollar over: the $1-max team cannot open at $2 — the endgame refusal that keeps its last two slots fillable');
select is(
  (public.draft_nominate('e6000000-0000-4000-8000-0000000000bb',
     'pgtap-ab-p01', 1, 'a6000000-0000-4000-8000-000000000026')
   #>> '{draft,current_nomination,high_bid}'),
  '1',
  '…and it CAN open at exactly $1 (§8.6.7(d)) — the formula admits its own boundary rather than fencing it off one dollar early');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_place_bid('e6000000-0000-4000-8000-0000000000bb',
       2, 'a6000000-0000-4000-8000-000000000027') $$,
  'P0001',
  'draft_place_bid: $2 is over your max bid of $1 — you have $3 for 3 open roster spots at a $1 per-slot reserve (§8.6.1/E5)',
  'E25''s bid half: a $1-max RIVAL cannot raise a $1 opening at all — when every seat is at its ceiling an opening simply stands (E26''s no-raise award is 086''s)');

-- ---------------------------------------------------------------------------
-- N. C38/C40, re-pointed at the toggle (092/AP.1/D198(3)) —
--    auction_zero_dollar_nominations ON (LD: $1 across THREE slots, floor $0)
-- ---------------------------------------------------------------------------
reset role;
select is(
  (public.draft_start_internal('a6000000-0000-4000-8000-0000000000cc', false)->>'started')::boolean,
  true,
  'LD starts with auction_zero_dollar_nominations ON (§7.3.8 v2.13 — the degenerate floor; solvency is 1 ≥ 3 × $0)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_nominate('e6000000-0000-4000-8000-0000000000cc',
       'pgtap-ab-p01', -1, 'a6000000-0000-4000-8000-000000000028') $$,
  'P0001',
  'draft_nominate: an opening bid of $-1 is below this league''s $0 nomination floor (§7.3.8)',
  'MIN-BID 0, one dollar short: −$1 is still refused — the floor moves with the setting, it does not vanish (and 083''s amount >= 0 CHECK would have caught it anyway, loudly instead of friendly)');
select is(
  (public.draft_nominate('e6000000-0000-4000-8000-0000000000cc',
     'pgtap-ab-p01', 0, 'a6000000-0000-4000-8000-000000000029')
   #>> '{draft,current_nomination,high_bid}'),
  '0',
  'a $0 OPENING is legal with $0 nominations ON — "a nomination should allow any number that the player can afford" (Chris, 2026-08-20)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_place_bid('e6000000-0000-4000-8000-0000000000cc',
       0, 'a6000000-0000-4000-8000-00000000002a') $$,
  'P0001',
  'draft_place_bid: outbid at $0 — pgtap-ab-LD-t1 holds the high bid; bid $1 or more',
  'C40 PROMOTED TO LAW (§8.6.3): THE INCREMENT IS A FIXED $1 IN BOTH COLUMNS — with $0 nominations ON a $0 "raise" is still refused and the message still names $1, because the toggle moves the FLOOR and never the increment');
select is(
  (public.draft_place_bid('e6000000-0000-4000-8000-0000000000cc',
     1, 'a6000000-0000-4000-8000-00000000002c')
   #>> '{draft,current_nomination,high_bid}'),
  '1',
  '§8.6.7(d) AT the boundary: the $1-max team bids EXACTLY $1 and takes the high bid — "a $1 max bid admits only $1", and it does admit it');
-- …and one dollar over, from a THIRD seat (not the standing high bidder,
-- so the probe cannot turn this into a self-raise error and abort the
-- file — the same ordering discipline as LA's ladder).
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_place_bid('e6000000-0000-4000-8000-0000000000cc',
       2, 'a6000000-0000-4000-8000-00000000002b') $$,
  'P0001',
  'draft_place_bid: $2 is over your max bid of $1 — you have $1 for 3 open roster spots at a $0 per-slot reserve (§8.6.1/E5)',
  '§8.6.7(d), one dollar over: with a $1 budget and $0 nominations ON the max bid is the whole $1, so $2 is refused');

-- ---------------------------------------------------------------------------
-- O. Cross-cutting: the max-bid property over EVERY bid this file wrote,
--    and the reworded draft_make_pick refusal
-- ---------------------------------------------------------------------------
reset role;
-- The property pin below is a NOT EXISTS, so it would pass vacuously over an
-- empty table (the "nothing happened means it worked" trap). Its target is
-- counted FIRST — the R307 bracketing rule.
select is(
  (select count(*)::int from draft_bids
   where draft_id in ('e6000000-0000-4000-8000-0000000000aa',
                      'e6000000-0000-4000-8000-0000000000bb',
                      'e6000000-0000-4000-8000-0000000000cc')),
  17,
  'the three auctions wrote 17 bid rows across 6 nominations (LA 1+4+8+1, LG 1, LD 2) — the population the property below is asserted over, counted so it cannot pass on an empty set');
select ok(
  not exists (
    select 1 from draft_bids b
    join lateral public.draft_team_budget(b.draft_id, b.team_id) t on true
    where b.draft_id in ('e6000000-0000-4000-8000-0000000000aa',
                         'e6000000-0000-4000-8000-0000000000bb',
                         'e6000000-0000-4000-8000-0000000000cc')
      and b.amount > t.max_bid),
  'NO BID ABOVE ITS BIDDER''S MAX BID EXISTS ANYWHERE IN HISTORY — the property the max-bid clause is FOR, asserted over all 17 rows; this is what 086''s award can safely be built on (D130)');
select ok(
  (select bool_and(public.draft_auction_solvent(d.id))
   from drafts d
   where d.id in ('e6000000-0000-4000-8000-0000000000aa',
                  'e6000000-0000-4000-8000-0000000000bb',
                  'e6000000-0000-4000-8000-0000000000cc')),
  '…and all three auctions are SOLVENT at the end of the file (§8.6.8 — the never-weaken invariant, unbroken by six nominations and seventeen bids)');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_make_pick('e6000000-0000-4000-8000-0000000000cc',
       'pgtap-ab-p05', 'a6000000-0000-4000-8000-00000000002d') $$,
  'P0001',
  'draft_make_pick: this is an auction draft — auction drafts pick via nominate and bid',
  'draft_make_pick STILL refuses an auction draft (the refusal is permanent — an auction never picks through this RPC) and now says what to use instead, with no milestone promise left in it (020 owns the same assertion; this is the auction-side cross-check that 085 reworded rather than removed it)');
reset role;

select * from finish();
rollback;
