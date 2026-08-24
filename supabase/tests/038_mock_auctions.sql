-- ============================================================================
-- Mock auctions + CPU bidders — migration 089 (task L.C1.7; spec §8.8 (the
-- mock rules, CPU bidders "pass the same max-bid/solvency validator as
-- humans", zero side effects), §8.6 (the flow the mock runs unchanged),
-- §8.6.7(c)/E27, §8.6.8, §22.5 (caps unchanged), E59/E60/E62; tasks-M3 §4
-- standing rules, D103/D110/D128/D129/D130/D132/D137/D138/D146). Discharges
-- ledger row **F61** (the 085 mock seam lifted + the D103(2) launcher gate
-- landed in the same PR — pinned from BOTH sides in §C). pgTAP file is
-- **038** (037 = realtime; next free confirmed at task time).
--
-- Falsifiability notes (§4.3):
--   * THE LAUNCH ARM (§B, the tests/025:400 flip's full form): a REAL
--     `create_mock_draft` call on an auction-configured league — the exact
--     refusal 071 raised — now launches: type/phase/first nominator/clock/
--     config snapshot incl. anti-snipe/nomination order/budget_adjustments
--     pinned, the derivation family reading the mock (200/2/199/0), E60
--     (the real scheduled auction draft's WHOLE row byte-identical beside
--     the live mock), and the §8.6.8 start backstop mirrored from 084 at
--     its ONE-UNIT boundary (budget = slots × reserve launches; minus one
--     dollar refuses by name — D146).
--   * F61 BOTH SIDES at the strongest discriminator (§C, the 025 §E
--     pattern): the human seat is T3 — owned and managed by u03 — while u02
--     launched the mock. u03's nomination on their OWN on-clock franchise
--     is REFUSED (the normal turn check would pass it — only the launcher
--     gate refuses it); the commissioner is refused (no bypass); the
--     outsider gets the 42501 no-leak; the launcher u02, who does NOT
--     manage T3, nominates successfully FOR T3 — and their own follow-up
--     bid trips the SELF-RAISE refusal, which is only reachable if the
--     launcher's bidding franchise resolved to the human seat.
--   * CPU THINK-TIME AT ONE UNIT (§D, D146 in time): the same mock, the
--     same tick, due = now() + 1s → NOT claimed (auction_cpu_claimed 0 —
--     a healthy mock is never locked); due = now() → claimed and acted.
--     Both phases (the raise think and the nomination think).
--   * CLOCK OBEDIENCE (§D, D128): a CPU raise inside the final anti_snipe
--     seconds floors the deadline to EXACTLY now() + anti_snipe; outside
--     the window it leaves the deadline untouched; after the buzzer the
--     CPU sub-arm claims NOTHING and the award proceeds — no CPU ever
--     snipes after zero. ONE raise per pass even though every CPU
--     qualifies (the bid count grows by exactly 1 per tick).
--   * E62 (§E — the task's named break-probe target): a CPU pushed to its
--     budget edge by a scripted human bid-up: with $50 left and one open
--     slot (max_bid 50) the CPU raises to $49 when the human bids $48
--     (ONE UNDER the edge — "passes") and FOLDS cleanly when the human
--     bids $50 (its next raise would be $51 = max_bid + 1, ONE OVER — no
--     bid, no failure, because the cap IS the validator's own number), and
--     the validator the CPU reaches (`draft_place_bid_internal` with the
--     tick's label) REFUSES that $51 by name. Property: no bid in this
--     mock's history exceeds its bidder's max bid at the time it was placed
--     (bracketed by a population count — R307). The two break probes aim
--     here: widening the CPU's cap by $1 makes it PROPOSE $51 and the
--     validator refuses it LOUDLY (the fold pin turns red on the recorded
--     failure); removing the validator's clause too lets $51 LAND (the
--     property pin turns red).
--   * THE ZERO-SIDE-EFFECT COMPOSITE (§F, the 036 §M / R383 way): a mock
--     auction scripted LAUNCH → COMPLETION through the REAL tick — CPU
--     nominations, CPU raises, human-seat timeouts, awards, rotation,
--     completion — with a WHOLE-ROW capture of the leagues row and the real
--     scheduled draft's row plus counts (members/teams/stints/invites/
--     weeks/league_lists/notifications/chat outside the mock's room/the
--     real draft's picks AND bids/league_rosters) BEFORE, pinned identical
--     AFTER, with positive controls that the mock REALLY ran (16 priced
--     picks, every team full, CPU raises > 0, solvency TRUE, status
--     complete, zero league_rosters, no league transition). `draft_bids`
--     rows carry the MOCK's draft_id only.
--   * D138 AFTER CPU BIDS (§G): all ELEVEN §8.7 controls + cancel + end +
--     pause/resume by a non-launcher refuse the live mock auction whose
--     bid history already carries CPU raises, bracketed by the whole-row
--     composite of the mock + league + counts (R383) — CPU bidding opened
--     no door.
--   * STORED LITERALS (§A): `draft_mock_auction_cpu_due` (realistic/fast ×
--     nominating/bidding, the NULL-deadline guard, the config defaults),
--     `draft_mock_cpu_bid_value` (rank 1/8/16/17; need 1/0.5/0; pass 0 vs
--     1; the ±15% band over 200 (seq, pass) pairs; the 12×15 $200 top value
--     $50), `draft_mock_cpu_need` (OPEN 1.0 / 0.5 / 0 / K always 0 in §E;
--     FORCED 1.0-for-a-hole / 0-for-depth / K still 0 in §F0 — R406, the
--     D146 one-unit pair across §E and §F0) — a future tweak to the
--     heuristic is a deliberate change to these literals.
--   * THE FORCED RULE, WHOLE RUN (§F, R406 / D163): LB is {RB:1, K:1} /
--     bench 0, so every seat is forced from its first pick; the scripted
--     completion must end with EIGHT Ks (one per team), never raised on —
--     the assertion is over the whole finished board and the whole bid
--     history, not a spot check. The break probe (the forced arm removed
--     from draft_mock_cpu_need) turns the §F0 unit pins RED at the exact
--     values (0.5 where 0 is pinned) and the whole-run pins RED in most
--     runs (7 Ks — run-dependent, the PRNG seeds on the mock id); the fixed
--     function is deterministic: no noise can make a need-0 CPU raise.
--   * Source pins (the R381 call-form lesson): `draft_place_bid` delegates
--     to the internal and no longer INSERTs bids itself; `draft_tick` calls
--     the bid internal once and the nomination internal twice (timeout +
--     think-time) and carries NO mock exclusion in ARM 2.6.
--   * Fixture ADP is FRACTIONAL (the R286 lesson / F60): every fixture
--     player sits below every real ADP by value.
--   * All privileged fixture work runs BEFORE any JWT claims (D49(7));
--     mid-test privileged steps use `reset role` (013/.../025 pattern).
--     `now()` is transaction-stable, so every clock is pinned to the
--     second by construction (deadlines/updated_at set relative to now()).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(156);

-- ---------------------------------------------------------------------------
-- A. Form pins (§4.1 grants doctrine; D137; the helpers' stored literals)
-- ---------------------------------------------------------------------------
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_mock_draft'),
  'create_mock_draft (089 body) is SECURITY DEFINER + search_path=''''');
select ok(
  (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('draft_nominate', 'draft_place_bid')),
  'draft_nominate + draft_place_bid (089 bodies) are SECURITY DEFINER + search_path=''''');
select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('draft_place_bid_internal', 'draft_system_nominate_internal')),
  'the two extracted internals are plain (NOT definer) + search_path='''' — 086''s internal form');
select ok(
  not has_function_privilege('anon', 'public.draft_place_bid_internal(uuid, uuid, integer, uuid, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_place_bid_internal(uuid, uuid, integer, uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_system_nominate_internal(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_system_nominate_internal(uuid)', 'EXECUTE'),
  'the internals carry the 062-form triple REVOKE — no client role can EXECUTE them');
select ok(
  not has_function_privilege('anon', 'public.draft_nominate(uuid, text, integer, uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.draft_nominate(uuid, text, integer, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_place_bid(uuid, integer, uuid, integer, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.draft_place_bid(uuid, integer, uuid, integer, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_mock_draft(uuid, uuid, text, uuid, jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.create_mock_draft(uuid, uuid, text, uuid, jsonb)', 'EXECUTE'),
  'the three replaced RPCs keep their posture: anon none, authenticated EXECUTE (CREATE OR REPLACE preserved the ACLs; the REVOKEs restated)');
select ok(
  (select p.provolatile = 'i' and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_mock_auction_cpu_due')
  and (select p.provolatile = 'i' and p.proisstrict and array_to_string(p.proconfig, ',') = 'search_path=""'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'draft_mock_cpu_bid_value')
  and (select p.provolatile = 's' and array_to_string(p.proconfig, ',') = 'search_path=""'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'draft_mock_cpu_need'),
  'draft_mock_auction_cpu_due IMMUTABLE · draft_mock_cpu_bid_value IMMUTABLE STRICT · draft_mock_cpu_need STABLE — all search_path=''''');

-- Source pins (R381: the CALL FORM, not a comment mention).
select is(
  (select (length(p.prosrc) - length(replace(p.prosrc, 'public.draft_place_bid_internal(', ''))) / length('public.draft_place_bid_internal(')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_place_bid'),
  1,
  'draft_place_bid CALLS draft_place_bid_internal exactly once (the one validator + writer)');
select ok(
  (select p.prosrc not like '%INSERT INTO public.draft_bids%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_place_bid'),
  '…and no longer INSERTs draft_bids itself — there is ONE bid writer for humans and CPUs');
select is(
  (select (length(p.prosrc) - length(replace(p.prosrc, 'public.draft_system_nominate_internal(', ''))) / length('public.draft_system_nominate_internal(')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_tick'),
  2,
  'draft_tick CALLS draft_system_nominate_internal exactly twice — the nomination TIMEOUT and the CPU THINK-TIME nomination are one function');
select is(
  (select (length(p.prosrc) - length(replace(p.prosrc, 'public.draft_mock_cpu_respond_internal(', ''))) / length('public.draft_mock_cpu_respond_internal(')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_tick'),
  1,
  'draft_tick CALLS the CPU responder exactly once — 091/AP.3 moved the raise out of ARM 2.6(c2) into draft_mock_cpu_respond_internal, which still reaches draft_place_bid_internal, so a CPU raise still passes the human validator (the call form is pinned end to end in 039 §A)');
select ok(
  (select p.prosrc not like ('%AND d.draft_type = ''auction''' || E'\n' || '%AND d.is_mock = FALSE%')
          and p.prosrc not like ('%OR v_draft.draft_type <> ''auction''' || E'\n' || '%OR v_draft.is_mock' || E'\n%')
          and p.prosrc like '%AND d.is_mock = FALSE%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_tick'),
  'draft_tick''s ARM 2.6 carries NO mock exclusion — 086''s `AND d.is_mock = FALSE` claim line and `OR v_draft.is_mock` re-verify line after the auction predicates are GONE (the claim is OPEN to mocks); ARM 1.5''s own `is_mock = FALSE` (the commissioner-outage arm — a mock has no commissioner) still stands');

-- Stored literals: draft_mock_auction_cpu_due (the D93 pattern over the
-- auction clocks). Fixed inputs: draft e9…11, nomination 30s / bid 20s,
-- deadline 17:00:30, updated_at 17:00:00, seq 1. think_fraction(e9…11, 1)
-- = 0.338730; (e9…11, 1000) = 0.300865; (e9…11, 1003) = 0.567601.
select is(
  public.draft_mock_auction_cpu_due('e9000000-0000-4000-8000-000000000011',
    '{"auction_nomination_seconds": 30, "auction_bid_seconds": 20, "mock": {"cpu_speed": "realistic"}}',
    '2026-09-01T17:00:30+00', '2026-09-01T17:00:00+00', 1, false, 0),
  '2026-09-01T17:00:10.1619+00'::timestamptz,
  'cpu_due NOMINATING realistic = the nomination clock''s start (deadline − 30s) + 30 × 0.338730 = 17:00:10.1619 (stored literal)');
select is(
  public.draft_mock_auction_cpu_due('e9000000-0000-4000-8000-000000000011',
    '{"auction_nomination_seconds": 30, "auction_bid_seconds": 20, "mock": {"cpu_speed": "realistic"}}',
    '2026-09-01T17:00:30+00', '2026-09-01T17:00:00+00', 1, true, 0),
  '2026-09-01T17:00:06.0173+00'::timestamptz,
  'cpu_due BIDDING realistic, 0 bids = updated_at (the open instant) + 20 × 0.300865 = 17:00:06.0173 (seed seq × 1000 + bid count)');
select is(
  public.draft_mock_auction_cpu_due('e9000000-0000-4000-8000-000000000011',
    '{"auction_nomination_seconds": 30, "auction_bid_seconds": 20, "mock": {"cpu_speed": "realistic"}}',
    '2026-09-01T17:00:30+00', '2026-09-01T17:00:00+00', 1, true, 3),
  '2026-09-01T17:00:11.35202+00'::timestamptz,
  'cpu_due BIDDING realistic, 3 bids = updated_at + 20 × 0.567601 = 17:00:11.35202 — the bid count re-seeds the raise think');
select is(
  public.draft_mock_auction_cpu_due('e9000000-0000-4000-8000-000000000011',
    '{"auction_nomination_seconds": 30, "auction_bid_seconds": 20, "mock": {"cpu_speed": "fast"}}',
    '2026-09-01T17:00:30+00', '2026-09-01T17:00:00+00', 1, false, 0),
  '2026-09-01T17:00:02+00'::timestamptz,
  'cpu_due NOMINATING fast = clock start + 2s (the §8.8 speed toggle touches only the CPU''s think)');
select is(
  public.draft_mock_auction_cpu_due('e9000000-0000-4000-8000-000000000011',
    '{"auction_nomination_seconds": 30, "auction_bid_seconds": 20, "mock": {"cpu_speed": "fast"}}',
    '2026-09-01T17:00:30+00', '2026-09-01T17:00:00+00', 1, true, 0),
  '2026-09-01T17:00:02+00'::timestamptz,
  'cpu_due BIDDING fast = last bid + 2s');
select is(
  public.draft_mock_auction_cpu_due('e9000000-0000-4000-8000-000000000011',
    '{}', '2026-09-01T17:00:30+00', '2026-09-01T17:00:00+00', 1, false, 0),
  '2026-09-01T17:00:10.1619+00'::timestamptz,
  'cpu_due reads the §7.3.8 defaults (30s nomination, realistic) when the snapshot carries none');
select is(
  public.draft_mock_auction_cpu_due('e9000000-0000-4000-8000-000000000011',
    '{"auction_nomination_seconds": 30, "mock": {"cpu_speed": "realistic"}}',
    null, '2026-09-01T17:00:00+00', 1, false, 0),
  '2026-09-01T17:00:10.1619+00'::timestamptz,
  'cpu_due NOMINATING with a NULL deadline (a fixture shape — an auction clock is never NULL) falls back to updated_at as the origin');

-- Stored literals: draft_mock_cpu_bid_value (D132's model, finalized).
select is(
  public.draft_mock_cpu_bid_value('e9000000-0000-4000-8000-000000000011', 1,
    'c9000000-0000-4000-8000-000000000001', 0, 1, 200, 2, 8, 1.0),
  380,
  'value(rank 1, $200, 2 slots, 8 teams, need 1.0, pass 0) = 380 — base 4×200/2 = $400 × (1 + noise) (stored literal)');
select is(
  public.draft_mock_cpu_bid_value('e9000000-0000-4000-8000-000000000011', 1,
    'c9000000-0000-4000-8000-000000000001', 1, 1, 200, 2, 8, 1.0),
  456,
  '…pass 1 re-seeds the noise: 456 — deterministic per (draft, seq, team, pass), D132''s letter');
select is(
  public.draft_mock_cpu_bid_value('e9000000-0000-4000-8000-000000000011', 1,
    'c9000000-0000-4000-8000-000000000001', 0, 1, 200, 2, 8, 0.5),
  190,
  '…need 0.5 (the one bench-useful extra) halves it: 190');
select is(
  public.draft_mock_cpu_bid_value('e9000000-0000-4000-8000-000000000011', 1,
    'c9000000-0000-4000-8000-000000000001', 0, 8, 200, 2, 8, 1.0),
  67,
  'value(rank 8 of N=16) = 67 — the cubic decay toward the replacement line');
select is(
  public.draft_mock_cpu_bid_value('e9000000-0000-4000-8000-000000000011', 1,
    'c9000000-0000-4000-8000-000000000001', 0, 16, 200, 2, 8, 1.0),
  0,
  'value(rank N = 16) floors to 0 — the last draftable rank is worth nothing above the opening bid');
select is(
  public.draft_mock_cpu_bid_value('e9000000-0000-4000-8000-000000000011', 1,
    'c9000000-0000-4000-8000-000000000001', 0, 17, 200, 2, 8, 1.0),
  0,
  'value(rank N + 1) = 0 — beyond the draftable pool (and the rank the tick passes for a player with no ADP) nobody raises');
select is(
  public.draft_mock_cpu_bid_value('e9000000-0000-4000-8000-000000000011', 1,
    'c9000000-0000-4000-8000-000000000001', 0, 1, 200, 2, 8, 0),
  0,
  'need 0 ⇒ value 0 regardless of rank (a roster that cannot use the player never raises)');
select is(
  public.draft_mock_cpu_bid_value('e9000000-0000-4000-8000-000000000011', 1,
    'c9000000-0000-4000-8000-000000000001', 0, 1, 200, 15, 12, 1.0),
  50,
  'the canonical 12-team $200 × 15-slot room values its top-ranked player at $50 (base 4×200/15 ≈ $53 × noise) — the budget-scale input');
select ok(
  (select bool_and(v between floor(400 * 0.85) and floor(400 * 1.15))
   from (select public.draft_mock_cpu_bid_value('e9000000-0000-4000-8000-000000000011', s,
                  'c9000000-0000-4000-8000-000000000001', p, 1, 200, 2, 8, 1.0) as v
         from generate_series(1, 20) s, generate_series(0, 9) p) x),
  'the seeded noise stays inside ±15% of base across 200 (seq, pass) pairs — the band is a property, not an accident of one literal');
select is(
  public.draft_mock_cpu_bid_value('e9000000-0000-4000-8000-000000000011', 1,
    'c9000000-0000-4000-8000-000000000001', 0, 1, 200, 2, 8, 1.0),
  public.draft_mock_cpu_bid_value('e9000000-0000-4000-8000-000000000011', 1,
    'c9000000-0000-4000-8000-000000000001', 0, 1, 200, 2, 8, 1.0),
  'same inputs twice ⇒ the same value (IMMUTABLE — no wall-clock, no random)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — BEFORE any JWT claims; D49(7)).
--    Users u01..u08 (98…01..08) + outsider u99. Players: 40 RBs at
--    fractional ADP 0.001…0.040, TEN Ks (0.050…0.059 — LB's run buys eight
--    of them), one QB (0.045). Worlds:
--      LA b9…a1  the main world: 8 seats (u01 commish), {RB:1, bench:1} ⇒
--                2 slots; $200 / min 1 / nom 30 / bid 20 / anti-snipe 10;
--                MANUAL draft order [T3, T1, T2, T4..T8]; a REAL scheduled
--                auction draft d1 with that order stored (E60). u02
--                launches with human seat T3 (u03's franchise — D103's
--                "any seat selectable", the launcher-gate discriminator).
--      LB b9…b1  the scripted zero-side-effect world: 8 seats, $20 budget
--                (so the scripted run is short), order T1..T8, a real
--                scheduled draft d2; u01 launches on their own seat.
--                ROSTER {RB:1, K:1} / BENCH 0 ⇒ 2 slots (R406): every seat
--                is FORCED from its first pick (open_slots 2 = unfilled 2),
--                so the run is the D163 autodraft clause end to end — a CPU
--                that holds its RB must bring home a K, and the whole-run
--                assertion is EIGHT Ks, none raised on (§F).
--      LC b9…c1  the E62 edge world: same shape as LA, order [T2, T1,
--                T3..T8]; u02 launches on their own seat; privileged
--                fixture picks then fill every CPU roster except T3, which
--                holds ONE pick at $150 (remaining 50, open 1 ⇒ max_bid 50).
--      LD b9…d1  the §8.6.8 backstop world: 8 seats (owners u01..u08),
--                $1 budget / min 1 / 2 slots ⇒ insolvent by ONE dollar;
--                u05 launches (their own caps are untouched elsewhere).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('98000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated',
  'pgtap-ma' || lpad(i::text, 2, '0') || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  jsonb_build_object('username', 'ma_user_' || lpad(i::text, 2, '0')),
  now(), now()
from generate_series(1, 8) i;
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '98000000-0000-4000-8000-000000000099',
   'authenticated', 'authenticated', 'pgtap-ma99@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "ma_outsider_99"}',
   now(), now());

insert into players (id, full_name, position, adp)
select 'ma-rb' || lpad(i::text, 2, '0'), 'MA RB ' || lpad(i::text, 2, '0'), 'RB', i / 1000.0
from generate_series(1, 40) i;
insert into players (id, full_name, position, adp)
select 'ma-k' || lpad(i::text, 2, '0'), 'MA K ' || lpad(i::text, 2, '0'), 'K', 0.049 + i / 1000.0
from generate_series(1, 10) i;
insert into players (id, full_name, position, adp) values
  ('ma-qb01', 'MA QB 01', 'QB', 0.045);

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings) values
  ('b9000000-0000-4000-8000-0000000000a1', '98000000-0000-4000-8000-000000000001',
   'pgtap-ma-LA-main', 2026, 'setup', 8, null,
   '{"draft": {"draft_type": "auction", "draft_order_mode": "manual",
     "nomination_order_mode": "same_as_draft_order",
     "auction_budget": 200, "auction_zero_dollar_nominations": false, "auction_nomination_seconds": 30,
     "auction_bid_seconds": 20, "auction_anti_snipe_seconds": 10,
     "disconnect_grace_seconds": 30, "pick_timer_seconds": 90,
     "draft_order": ["c9000000-0000-4000-8000-00a100000003", "c9000000-0000-4000-8000-00a100000001",
                     "c9000000-0000-4000-8000-00a100000002", "c9000000-0000-4000-8000-00a100000004",
                     "c9000000-0000-4000-8000-00a100000005", "c9000000-0000-4000-8000-00a100000006",
                     "c9000000-0000-4000-8000-00a100000007", "c9000000-0000-4000-8000-00a100000008"]}}'),
  ('b9000000-0000-4000-8000-0000000000b1', '98000000-0000-4000-8000-000000000001',
   'pgtap-ma-LB-script', 2026, 'setup', 8, null,
   '{"draft": {"draft_type": "auction", "draft_order_mode": "manual",
     "nomination_order_mode": "same_as_draft_order",
     "auction_budget": 20, "auction_zero_dollar_nominations": false, "auction_nomination_seconds": 30,
     "auction_bid_seconds": 20, "auction_anti_snipe_seconds": 10,
     "disconnect_grace_seconds": 30, "pick_timer_seconds": 90,
     "draft_order": ["c9000000-0000-4000-8000-00b100000001", "c9000000-0000-4000-8000-00b100000002",
                     "c9000000-0000-4000-8000-00b100000003", "c9000000-0000-4000-8000-00b100000004",
                     "c9000000-0000-4000-8000-00b100000005", "c9000000-0000-4000-8000-00b100000006",
                     "c9000000-0000-4000-8000-00b100000007", "c9000000-0000-4000-8000-00b100000008"]}}'),
  ('b9000000-0000-4000-8000-0000000000c1', '98000000-0000-4000-8000-000000000001',
   'pgtap-ma-LC-edge', 2026, 'setup', 8, null,
   '{"draft": {"draft_type": "auction", "draft_order_mode": "manual",
     "nomination_order_mode": "same_as_draft_order",
     "auction_budget": 200, "auction_zero_dollar_nominations": false, "auction_nomination_seconds": 30,
     "auction_bid_seconds": 20, "auction_anti_snipe_seconds": 10,
     "disconnect_grace_seconds": 30, "pick_timer_seconds": 90,
     "draft_order": ["c9000000-0000-4000-8000-00c100000002", "c9000000-0000-4000-8000-00c100000001",
                     "c9000000-0000-4000-8000-00c100000003", "c9000000-0000-4000-8000-00c100000004",
                     "c9000000-0000-4000-8000-00c100000005", "c9000000-0000-4000-8000-00c100000006",
                     "c9000000-0000-4000-8000-00c100000007", "c9000000-0000-4000-8000-00c100000008"]}}'),
  ('b9000000-0000-4000-8000-0000000000d1', '98000000-0000-4000-8000-000000000005',
   'pgtap-ma-LD-backstop', 2026, 'setup', 8, null,
   '{"draft": {"draft_type": "auction", "draft_order_mode": "random",
     "auction_budget": 1, "auction_zero_dollar_nominations": false, "auction_nomination_seconds": 30,
     "auction_bid_seconds": 20, "auction_anti_snipe_seconds": 10}}');
update leagues
set roster_settings = '{"starting_slots": [
      {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
    "bench": 1, "ir_slots": [], "swap_spots": 0}'
where id in ('b9000000-0000-4000-8000-0000000000a1',
             'b9000000-0000-4000-8000-0000000000c1', 'b9000000-0000-4000-8000-0000000000d1');
-- LB: {RB:1, K:1} / bench 0 (R406 — the board on which the RAISE brain's
-- bench-useful 0.5 used to let a CPU fill its K seat with a second RB).
update leagues
set roster_settings = '{"starting_slots": [
      {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1},
      {"key": "k", "label": "K", "eligible": ["K"], "count": 1}],
    "bench": 0, "ir_slots": [], "swap_spots": 0}'
where id = 'b9000000-0000-4000-8000-0000000000b1';

insert into teams (id, owner_id, name, league_id)
select ('c9000000-0000-4000-8000-00' || w.code || '000000' || lpad(i::text, 2, '0'))::uuid,
       ('98000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'pgtap-ma-' || w.code || '-t' || lpad(i::text, 2, '0'),
       ('b9000000-0000-4000-8000-0000000000' || w.code)::uuid
from (values ('a1'), ('b1'), ('c1'), ('d1')) as w(code), generate_series(1, 8) i;

insert into league_members (league_id, user_id, team_id, role)
select ('b9000000-0000-4000-8000-0000000000' || w.code)::uuid,
       ('98000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c9000000-0000-4000-8000-00' || w.code || '000000' || lpad(i::text, 2, '0'))::uuid,
       case when (w.code <> 'd1' and i = 1) or (w.code = 'd1' and i = 5)
            then 'commissioner' else 'manager' end
from (values ('a1'), ('b1'), ('c1'), ('d1')) as w(code), generate_series(1, 8) i;

-- The REAL scheduled auction drafts (E60 / R151 — the rows the mock must
-- leave byte-identical). Stored draft_order = the manual order (the lobby
-- order — D101); nomination_order NULL until draft_start resolves it.
insert into drafts (id, league_id, draft_type, status, is_mock, config, draft_order) values
  ('e9000000-0000-4000-8000-0000000000d1', 'b9000000-0000-4000-8000-0000000000a1',
   'auction', 'scheduled', false, '{}',
   '["c9000000-0000-4000-8000-00a100000003", "c9000000-0000-4000-8000-00a100000001",
     "c9000000-0000-4000-8000-00a100000002", "c9000000-0000-4000-8000-00a100000004",
     "c9000000-0000-4000-8000-00a100000005", "c9000000-0000-4000-8000-00a100000006",
     "c9000000-0000-4000-8000-00a100000007", "c9000000-0000-4000-8000-00a100000008"]'),
  ('e9000000-0000-4000-8000-0000000000d2', 'b9000000-0000-4000-8000-0000000000b1',
   'auction', 'scheduled', false, '{}',
   '["c9000000-0000-4000-8000-00b100000001", "c9000000-0000-4000-8000-00b100000002",
     "c9000000-0000-4000-8000-00b100000003", "c9000000-0000-4000-8000-00b100000004",
     "c9000000-0000-4000-8000-00b100000005", "c9000000-0000-4000-8000-00b100000006",
     "c9000000-0000-4000-8000-00b100000007", "c9000000-0000-4000-8000-00b100000008"]');

-- The E60 capture: the real draft's WHOLE row before the mock launches.
create temp table ma_real_d1_before as
select to_jsonb(d) as row from drafts d where d.id = 'e9000000-0000-4000-8000-0000000000d1';

-- ---------------------------------------------------------------------------
-- B2. THE §8.6.8 START BACKSTOP, mirrored from 084 at its ONE-UNIT boundary
--     (LD — D146). A $1 budget cannot fill 2 slots at $1; a $2 budget can.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.create_mock_draft('b9000000-0000-4000-8000-0000000000d1') $$,
  'P0001',
  'create_mock_draft: league b9000000-0000-4000-8000-0000000000d1 cannot practice an auction — a $1 budget cannot fill 2 draftable roster spots at a $1 per-slot reserve (§8.6.8 solvency); raise the auction budget, or allow $0 nominations in League settings → Draft setup',
  'the §8.6.8 start backstop is mirrored into the launch arm: a league one dollar short of the floor cannot PRACTICE an auction (084 banner item 4, "Same engine, literally")');
select is(
  (select count(*) from drafts where league_id = 'b9000000-0000-4000-8000-0000000000d1' and is_mock),
  0::bigint,
  '…and the refusal rolled the INSERT back — no mock row survives');
reset role;
update leagues
set settings = jsonb_set(settings, '{draft,auction_budget}', '2')
where id = 'b9000000-0000-4000-8000-0000000000d1';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft('b9000000-0000-4000-8000-0000000000d1') $$,
  'budget = slots × reserve EXACTLY ($2 for 2 × $1) launches — the boundary from the other side (D146)');
reset role;
select ok(
  public.draft_auction_solvent((select id from drafts where league_id = 'b9000000-0000-4000-8000-0000000000d1' and is_mock)),
  '…and the launched $2 mock is solvent through the ONE family (remaining 2 = 2 open × $1)');

-- ---------------------------------------------------------------------------
-- B3. THE LAUNCH ARM — the tests/025:400 flip's full form (LA). u02 launches
--     with human seat T3 (u03's franchise).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft('b9000000-0000-4000-8000-0000000000a1',
       'c9000000-0000-4000-8000-00a100000003', 'realistic',
       'a9000000-0000-4000-8000-000000000001') $$,
  'THE 071 REFUSAL IS LIFTED: a mock of an AUCTION-configured league LAUNCHES (the exact call 025:400 pinned as "mock auctions land with the auction engine in M3")');
reset role;

create temp table ma_la as
select id from drafts where league_id = 'b9000000-0000-4000-8000-0000000000a1' and is_mock;
grant select on ma_la to authenticated;

select ok(
  (select d.status = 'live' and d.is_mock and d.draft_type = 'auction'
          and d.current_nomination is null
          and d.current_pick_number = 1 and d.current_round = 1
          and d.total_rounds = 2
          and d.budget_adjustments = '{}'::jsonb
          and d.started_at = now()
   from drafts d join ma_la on ma_la.id = d.id),
  'launch goldens: live, is_mock, draft_type auction, NOMINATING phase (current_nomination NULL — D126), sequence 1, lap 1, 2 draftable slots (D91), budget_adjustments ''{}''');
select is(
  (select d.nomination_order from drafts d join ma_la on ma_la.id = d.id),
  '["c9000000-0000-4000-8000-00a100000003", "c9000000-0000-4000-8000-00a100000001",
    "c9000000-0000-4000-8000-00a100000002", "c9000000-0000-4000-8000-00a100000004",
    "c9000000-0000-4000-8000-00a100000005", "c9000000-0000-4000-8000-00a100000006",
    "c9000000-0000-4000-8000-00a100000007", "c9000000-0000-4000-8000-00a100000008"]'::jsonb,
  'nomination_order = same_as_draft_order over the manual order — through 084''s ONE implementation (the real draft''s stored order is the candidate)');
select is(
  (select d.on_clock_team_id from drafts d join ma_la on ma_la.id = d.id),
  'c9000000-0000-4000-8000-00a100000003'::uuid,
  'the first NOMINATOR = nomination_order[0] = T3 (the human seat — D126)');
select is(
  (select d.current_deadline from drafts d join ma_la on ma_la.id = d.id),
  now() + interval '30 seconds',
  'the first clock is the NOMINATION clock: now() + auction_nomination_seconds (30), never the snake pick timer');
select is(
  -- 094/MP.2: `- 'roster'` joins the subtraction list. The roster SHAPE is now
  -- part of the launch snapshot (it never was, and both hot readers went back
  -- to the live league for it — the D95 hole this pin could not see). Its
  -- VALUE is asserted in 042 §A (the launch snapshot); here it is subtracted
  -- so this pin keeps testing exactly what it always tested: the §7.3.8
  -- draft block.
  (select d.config - 'mock' - 'draft_order' - 'roster' from drafts d join ma_la on ma_la.id = d.id),
  '{"draft_type": "auction", "draft_order_mode": "manual", "nomination_order_mode": "same_as_draft_order",
    "auction_budget": 200, "auction_zero_dollar_nominations": false, "auction_nomination_seconds": 30,
    "auction_bid_seconds": 20, "auction_anti_snipe_seconds": 10,
    "disconnect_grace_seconds": 30, "pick_timer_seconds": 90}'::jsonb,
  'the config snapshot carries the WHOLE §7.3.8 auction block incl. anti-snipe (D95 — a mock never re-hydrates)');
select is(
  (select d.config->'mock' from drafts d join ma_la on ma_la.id = d.id),
  '{"human_team_id": "c9000000-0000-4000-8000-00a100000003", "cpu_speed": "realistic",
    "launched_by": "98000000-0000-4000-8000-000000000002",
    "action_id": "a9000000-0000-4000-8000-000000000001"}'::jsonb,
  'config.mock = {human_team_id T3, cpu_speed, launched_by u02, action_id} — D103(2)''s key + the R149 replay ledger, unchanged by the arm');
select is(
  (select to_jsonb(b) from ma_la, public.draft_team_budget(ma_la.id, 'c9000000-0000-4000-8000-00a100000003') b),
  '{"remaining": 200, "open_slots": 2, "max_bid": 199, "committed": 0}'::jsonb,
  'the ONE derivation family reads the mock: (200, 2, 199, 0) — the mock''s budget is the snapshotted $200');
select is(
  (select to_jsonb(d) from drafts d where d.id = 'e9000000-0000-4000-8000-0000000000d1'),
  (select row from ma_real_d1_before),
  'E60: the league''s REAL scheduled auction draft is BYTE-IDENTICAL beside the live mock (the D95 partial unique ignores mocks; the launch touched it nowhere)');
select is(
  (select count(*) from draft_liveness dl join ma_la on ma_la.id = dl.draft_id
   where dl.user_id = '98000000-0000-4000-8000-000000000002'),
  1::bigint,
  'launch seeded the LAUNCHER''s liveness beat (E59''s stale clock starts honest) — unchanged by the arm');

-- ---------------------------------------------------------------------------
-- C. F61 — THE LAUNCHER GATE, BOTH SIDES (D103(2) extended to nominate AND
--    bid — D138). The human seat is T3 (u03's); u02 launched.
-- ---------------------------------------------------------------------------
set local role authenticated;
-- u03: T3's REAL manager, T3 on the clock. The normal turn check would
-- ADMIT this nomination — only the launcher gate refuses it.
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.draft_nominate('%s', 'ma-k01', 3, 'a9000000-0000-4000-8000-000000000010') $$,
         (select id from ma_la)),
  'P0001',
  'draft_nominate: this mock draft is another member''s solo practice (§8.8/D103)',
  'F61 (nominate, the STRONGEST discriminator): the human seat''s REAL MANAGER, on the clock in their own franchise, is REFUSED — the normal turn check would have passed; only the launcher gate refuses');
-- u01: the commissioner — no bypass.
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.draft_nominate('%s', 'ma-k01', 3, 'a9000000-0000-4000-8000-000000000011') $$,
         (select id from ma_la)),
  'P0001',
  'draft_nominate: this mock draft is another member''s solo practice (§8.8/D103)',
  'F61: the COMMISSIONER is refused too — no role bypass into a member''s solo practice');
-- u99: the outsider — the 42501 no-leak floor, unchanged.
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000099", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.draft_nominate('%s', 'ma-k01', 3, 'a9000000-0000-4000-8000-000000000012') $$,
         (select id from ma_la)),
  '42501',
  'draft_nominate: not a member of this draft''s league',
  'an outsider still gets the 42501 no-leak (membership answers before the mock branch)');
select is(
  (select count(*) from draft_bids b join ma_la on ma_la.id = b.draft_id),
  0::bigint,
  '…and none of the three refusals wrote a bid row');
-- u02: the LAUNCHER, who does NOT manage T3, nominates FOR T3.
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  format($$ select public.draft_nominate('%s', 'ma-k01', 3, 'a9000000-0000-4000-8000-000000000013') $$,
         (select id from ma_la)),
  'F61 (the admit side): the LAUNCHER nominates — for a franchise they do not manage (D103: authorization is launcher-keyed, never seat-keyed)');
reset role;
select is(
  (select jsonb_build_object('seq', b.nomination_seq, 'player', b.player_id, 'team', b.team_id,
                             'amount', b.amount, 'has_action', b.action_id is not null)
   from draft_bids b join ma_la on ma_la.id = b.draft_id),
  '{"seq": 1, "player": "ma-k01", "team": "c9000000-0000-4000-8000-00a100000003", "amount": 3, "has_action": true}'::jsonb,
  'the opening bid row is T3''s (the HUMAN seat, not the launcher''s own franchise T2) at $3 with the launcher''s action_id');
-- 091/AP.3 — WHY THIS MARKET STAYS AT THE OPENING BID, and why §C nominates a
-- KICKER. Since 091 a nomination provokes the CPUs in its own transaction
-- (§8.8/D200(1)), so on an ordinary player this row would already be buried
-- under a ladder and the launcher would not be the standing high bidder —
-- which is the ONLY state in which F61''s self-raise discriminator below is
-- reachable. draft_mock_cpu_need returns 0 for K/DST ALWAYS (D163/R406,
-- pinned in §E and §F0), so a kicker is a market no CPU will ever answer:
-- the gate pins keep their exact shape, and the contrast documents the new
-- behaviour instead of hiding from it. The RAISE side lives in 039.
select is(
  (select d.current_nomination from drafts d join ma_la on ma_la.id = d.id),
  '{"player_id": "ma-k01", "high_bid": 3, "high_bidder_team_id": "c9000000-0000-4000-8000-00a100000003"}'::jsonb,
  'BIDDING phase open: current_nomination = {ma-k01, $3, T3} (065:121''s printed shape) — and STILL the opening bid after 091''s reactive responder ran inside the nomination: every CPU prices a kicker at $0');
select is(
  (select count(*) from draft_bids b join ma_la on ma_la.id = b.draft_id),
  1::bigint,
  '…with exactly ONE bid row: the responder was invoked by draft_nominate and wrote nothing, because no candidate can beat $3 on a player worth $0 to every seat (E62''s ceiling doing its job at the bottom of the range)');
select is(
  (select d.current_deadline from drafts d join ma_la on ma_la.id = d.id),
  now() + interval '20 seconds',
  '…with the BID clock (auction_bid_seconds 20) — the mock''s human clocks are always real (§8.8)');

set local role authenticated;
-- Bids: the same three refusals, then the launcher's self-raise.
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.draft_place_bid('%s', 4, 'a9000000-0000-4000-8000-000000000014') $$,
         (select id from ma_la)),
  'P0001',
  'draft_place_bid: this mock draft is another member''s solo practice (§8.8/D103)',
  'F61 (bid): the human seat''s real manager cannot bid inside the launcher''s practice (D138 extends D103(2) to bids)');
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.draft_place_bid('%s', 4, 'a9000000-0000-4000-8000-000000000015') $$,
         (select id from ma_la)),
  'P0001',
  'draft_place_bid: this mock draft is another member''s solo practice (§8.8/D103)',
  'F61 (bid): the commissioner is refused — no bypass');
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000099", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.draft_place_bid('%s', 4, 'a9000000-0000-4000-8000-000000000016') $$,
         (select id from ma_la)),
  '42501',
  'draft_place_bid: not a member of this draft''s league',
  'an outsider''s bid is the 42501 no-leak');
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.draft_place_bid('%s', 4, 'a9000000-0000-4000-8000-000000000017') $$,
         (select id from ma_la)),
  'P0001',
  'draft_place_bid: you are already the high bidder at $3 — wait for someone to raise you (§8.6.3)',
  'the launcher''s bid resolves to the HUMAN SEAT (T3 — the standing high bidder): the self-raise refusal is reachable ONLY if the mock bidder-team resolution is the human seat, not league_members');
select throws_ok(
  format($$ select public.draft_make_pick('%s', 'ma-rb06', 'a9000000-0000-4000-8000-000000000018') $$,
         (select id from ma_la)),
  'P0001',
  'draft_make_pick: this is an auction draft — auction drafts pick via nominate and bid',
  'the launcher''s draft_make_pick on the mock AUCTION still meets 085''s permanent auction refusal (the mock branch admits the launcher, the type refuses the verb)');
reset role;
select is(
  (select count(*) from draft_bids b join ma_la on ma_la.id = b.draft_id),
  1::bigint,
  '…the bid history still holds exactly the opening row — none of the refused bids wrote');

-- ---------------------------------------------------------------------------
-- D. THE CPU SUB-ARM (ARM 2.6(c)): think-time at one unit, the FOLD, clock
--    obedience (D128), never after the buzzer, the CPU nomination on its
--    think-time, and E59 for an auction mock.
--    **091/AP.3 re-pointed this section, it was not weakened.** The arm's
--    THINK-TIME GATE, its claim scope, its buzzer discipline and its
--    nomination half are unchanged and still pinned here at their one-unit
--    boundaries. What moved is the RAISE: since 091 the arm calls
--    draft_mock_cpu_respond_internal instead of writing `+ $1` itself, and a
--    ladder normally resolves in the transaction that provoked it — so what
--    this arm meets in practice is the FOLD, which is what §D now pins, on a
--    kicker market where the fold is guaranteed rather than incidental. The
--    raise side — the selection rule, the jump curve, a raise's anti-snipe
--    floor, the ladder's termination and its bound — is pinned in **039**,
--    against the behaviour that actually ships.
-- ---------------------------------------------------------------------------
-- (D1) A HEALTHY mock (raise think-time not reached) is claimed by NO arm.
select ok(
  (select public.draft_mock_auction_cpu_due(d.id, d.config, d.current_deadline, d.updated_at,
                                             d.current_pick_number, true, 1) > now()
   from drafts d join ma_la on ma_la.id = d.id),
  'fixture: the raise think-time (seeded seq 1, bid count 1) is in the FUTURE right after the nomination');
select set_config('pgtap.ma_t0', public.draft_tick()::text, true);
select is(
  (current_setting('pgtap.ma_t0')::jsonb->>'auction_cpu_claimed')::int,
  0,
  'a healthy mock (think-time not reached, clock running) is claimed by NO arm — auction_cpu_claimed 0 (R135/R141: never locked)');
select is(
  (select count(*) from draft_bids b join ma_la on ma_la.id = b.draft_id),
  1::bigint,
  '…and nothing was written');

-- (D2) ONE UNIT SHORT in time: due = now() + 1s ⇒ not claimed.
update drafts d
set updated_at = now() - make_interval(secs => 20 * public.draft_mock_think_fraction(d.id, 1 * 1000 + 1)) + interval '1 second'
from ma_la where d.id = ma_la.id;
select ok(
  (select public.draft_mock_auction_cpu_due(d.id, d.config, d.current_deadline, d.updated_at,
                                             d.current_pick_number, true, 1) = now() + interval '1 second'
   from drafts d join ma_la on ma_la.id = d.id),
  'fixture: the raise think-time is now EXACTLY now() + 1s (ONE UNIT in the future)');
select set_config('pgtap.ma_t1', public.draft_tick()::text, true);
select is(
  (current_setting('pgtap.ma_t1')::jsonb->>'auction_cpu_claimed')::int
  + (current_setting('pgtap.ma_t1')::jsonb->>'auction_cpu_raised')::int,
  0,
  'ONE UNIT SHORT (D146, in time): a think-time one second away is NOT claimed and nothing is raised');

-- (D3) due = now() EXACTLY ⇒ claimed, ONE raise by the highest-value CPU.
update drafts d
set updated_at = now() - make_interval(secs => 20 * public.draft_mock_think_fraction(d.id, 1 * 1000 + 1))
from ma_la where d.id = ma_la.id;
select ok(
  (select public.draft_mock_auction_cpu_due(d.id, d.config, d.current_deadline, d.updated_at,
                                             d.current_pick_number, true, 1) = now()
   from drafts d join ma_la on ma_la.id = d.id),
  'fixture: the raise think-time is now EXACTLY now()');
select set_config('pgtap.ma_t2', public.draft_tick()::text, true);
select is(
  jsonb_build_object(
    'claimed', (current_setting('pgtap.ma_t2')::jsonb->>'auction_cpu_claimed')::int,
    'raised',  (current_setting('pgtap.ma_t2')::jsonb->>'auction_cpu_raised')::int,
    'folded',  (current_setting('pgtap.ma_t2')::jsonb->>'auction_cpu_folded')::int,
    'failures', current_setting('pgtap.ma_t2')::jsonb->'auction_cpu_failures'),
  '{"claimed": 1, "raised": 0, "folded": 1, "failures": []}'::jsonb,
  'due = now(): CLAIMED 1 — the think-time boundary from the other side (D146) — and the arm calls the responder, which FOLDS: no raise, no failure');
select is(
  (select count(*) from draft_bids b join ma_la on ma_la.id = b.draft_id),
  1::bigint,
  '…and a fold writes NOTHING: the history is still the single opening row, the clock runs on, and the human (or the buzzer) decides');
-- WHY it folded, pinned against the model itself rather than asserted: every
-- eligible CPU prices this kicker at $0 (draft_mock_cpu_need''s K/DST rule —
-- R406/D163), so no candidate can reach high + 1 and the candidate scan is
-- empty. This is the same argmax rule the raise path uses, read from the
-- bottom of its range.
select is(
  (select count(*)::int
   from drafts d join ma_la on ma_la.id = d.id,
        lateral (
          select (o.team)::uuid as team,
                 public.draft_mock_cpu_bid_value(d.id, 1, (o.team)::uuid, 1,
                   (select count(*)::int + 1 from players pl where pl.adp is not null
                      and (pl.adp < 0.050 or (pl.adp = 0.050 and pl.id < 'ma-k01'))),
                   200, 2, 8, public.draft_mock_cpu_need(d.id, (o.team)::uuid, 'ma-k01')) as value
          from jsonb_array_elements_text(d.nomination_order) with ordinality as o(team, idx)
          where o.team <> 'c9000000-0000-4000-8000-00a100000003'
        ) c
   where c.value > 0),
  0,
  'THE SELECTION RULE, at the bottom of its range: ZERO eligible CPUs value ma-k01 above $0, which is exactly why the responder found no candidate — a CPU never raises on a kicker (D163''s autodraft clause; the raise-side argmax is pinned in 039)');
select is(
  (select d.current_nomination from drafts d join ma_la on ma_la.id = d.id),
  '{"player_id": "ma-k01", "high_bid": 3, "high_bidder_team_id": "c9000000-0000-4000-8000-00a100000003"}'::jsonb,
  'current_nomination is unmoved by the fold — the human seat still holds the high bid at $3');
select is(
  (select d.current_deadline from drafts d join ma_la on ma_la.id = d.id),
  now() + interval '20 seconds',
  'A FOLD NEVER TOUCHES THE CLOCK (D128): 20s left before the pass, 20s left after — the arm claimed the row, decided nothing was worth bidding, and released it');

-- (D4) CLOCK OBEDIENCE, the fold side (D128). A CPU that decides not to bid
-- must not touch the clock EITHER WAY — not floor it, not extend it — even
-- when it deliberates inside the anti-snipe window. (The RAISE side of D128 —
-- a CPU bid inside the window flooring the deadline to exactly now() +
-- anti_snipe — is pinned in 039 against a market a CPU will actually answer.)
update drafts d
set current_deadline = now() + interval '3 seconds',
    updated_at = now() - make_interval(secs => 20 * public.draft_mock_think_fraction(d.id, 1 * 1000 + 1))
from ma_la where d.id = ma_la.id;
select set_config('pgtap.ma_t3', public.draft_tick()::text, true);
select is(
  (current_setting('pgtap.ma_t3')::jsonb->>'auction_cpu_folded')::int, 1,
  'the arm claims and folds with 3s left (think-time due, clock still running)');
select is(
  (select d.current_deadline from drafts d join ma_la on ma_la.id = d.id),
  now() + interval '3 seconds',
  'ANTI-SNIPE IS A BID''S DOING, NOT A CLAIM''S (D128/E6): a fold inside the final 10s leaves 3s as 3s — the arm never extends a clock it merely looked at');
select is(
  (select max(b.amount) from draft_bids b join ma_la on ma_la.id = b.draft_id), 3,
  '…and the high bid is still the $3 opening');
-- Outside the window: 15s left, a due pass still leaves the deadline alone.
update drafts d
set current_deadline = now() + interval '15 seconds',
    updated_at = now() - make_interval(secs => 20 * public.draft_mock_think_fraction(d.id, 1 * 1000 + 1))
from ma_la where d.id = ma_la.id;
select set_config('pgtap.ma_t4', public.draft_tick()::text, true);
select is(
  (current_setting('pgtap.ma_t4')::jsonb->>'auction_cpu_folded')::int, 1,
  'the arm claims and folds with 15s left');
select is(
  (select d.current_deadline from drafts d join ma_la on ma_la.id = d.id),
  now() + interval '15 seconds',
  '…and above the threshold the clock is equally untouched (15s stays 15s)');

-- (D5) NEVER AFTER THE BUZZER: think-time due but the clock has run out —
-- the CPU sub-arm claims NOTHING; the expiry loop awards in the same pass.
update drafts d
set current_deadline = now() - interval '1 second',
    updated_at = now() - make_interval(secs => 20 * public.draft_mock_think_fraction(d.id, 1 * 1000 + 1))
from ma_la where d.id = ma_la.id;
select ok(
  (select public.draft_mock_auction_cpu_due(d.id, d.config, d.current_deadline, d.updated_at,
                                             d.current_pick_number, true, 1) <= now()
   from drafts d join ma_la on ma_la.id = d.id),
  'fixture: the raise think-time IS due while the bid clock has already expired');
create temp table ma_pre_award as
select b.team_id, b.amount from draft_bids b join ma_la on ma_la.id = b.draft_id
where b.amount = (select max(amount) from draft_bids b2 join ma_la on ma_la.id = b2.draft_id);
select set_config('pgtap.ma_t5', public.draft_tick()::text, true);
select is(
  jsonb_build_object(
    'cpu_claimed', (current_setting('pgtap.ma_t5')::jsonb->>'auction_cpu_claimed')::int,
    'cpu_raised',  (current_setting('pgtap.ma_t5')::jsonb->>'auction_cpu_raised')::int,
    'awarded',     (current_setting('pgtap.ma_t5')::jsonb->>'auction_awarded')::int),
  '{"cpu_claimed": 0, "cpu_raised": 0, "awarded": 1}'::jsonb,
  'NO CPU SNIPES AFTER ZERO: the sub-arm claims nothing once the clock has run out (its claim requires a RUNNING clock), and ARM 2.6(b) awards in the same pass — the mock IS in the expiry claim now (086 excluded it)');
select is(
  (select jsonb_build_object('team', p.team_id, 'price', p.price, 'round', p.round,
                             'is_auto', p.is_auto, 'made_via', p.made_via, 'seq', p.pick_number)
   from draft_picks p join ma_la on ma_la.id = p.draft_id),
  (select jsonb_build_object('team', team_id, 'price', amount, 'round', null,
                             'is_auto', false, 'made_via', 'manager', 'seq', 1)
   from ma_pre_award),
  'the award: the uncontested nominator (the HUMAN seat T3) wins ma-k01 at its $3 opening, round NULL — is_auto FALSE / manager, because the winning row carries the launcher''s action_id (D130''s actor matrix, read off the row; §8.6.7(b)/E26)');
select ok(
  (select d.current_nomination is null and d.current_pick_number = 2
          and d.on_clock_team_id = 'c9000000-0000-4000-8000-00a100000001'
          and d.current_deadline = now() + interval '30 seconds'
   from drafts d join ma_la on ma_la.id = d.id),
  'rotation advanced from the NOMINATOR (T3) to T1 (a CPU seat) — NOMINATING phase, sequence 2, a fresh 30s nomination clock');

-- (D6) THE CPU NOMINATION on its think-time — one unit short, then due.
update drafts d
set current_deadline = now() + interval '30 seconds'
                       - make_interval(secs => 30 * public.draft_mock_think_fraction(d.id, 2))
                       + interval '1 second'
from ma_la where d.id = ma_la.id;
select ok(
  (select public.draft_mock_auction_cpu_due(d.id, d.config, d.current_deadline, d.updated_at,
                                             d.current_pick_number, false, 0) = now() + interval '1 second'
   from drafts d join ma_la on ma_la.id = d.id),
  'fixture: T1''s nomination think-time is EXACTLY now() + 1s');
select set_config('pgtap.ma_t6', public.draft_tick()::text, true);
select is(
  (current_setting('pgtap.ma_t6')::jsonb->>'auction_cpu_claimed')::int
  + (current_setting('pgtap.ma_t6')::jsonb->>'auction_cpu_nominated')::int, 0,
  'ONE UNIT SHORT: a nomination think-time one second away is not claimed (the healthy mock stays unlocked)');
update drafts d
set current_deadline = now() + interval '30 seconds'
                       - make_interval(secs => 30 * public.draft_mock_think_fraction(d.id, 2))
from ma_la where d.id = ma_la.id;
select set_config('pgtap.ma_t7', public.draft_tick()::text, true);
select is(
  jsonb_build_object(
    'claimed',   (current_setting('pgtap.ma_t7')::jsonb->>'auction_cpu_claimed')::int,
    'nominated', (current_setting('pgtap.ma_t7')::jsonb->>'auction_cpu_nominated')::int,
    'timeouts',  (current_setting('pgtap.ma_t7')::jsonb->>'auction_nominated')::int,
    'failures',  current_setting('pgtap.ma_t7')::jsonb->'auction_cpu_failures'),
  '{"claimed": 1, "nominated": 1, "timeouts": 0, "failures": []}'::jsonb,
  'due = now(): the CPU NOMINATES on its think-time (the sub-arm, not the timeout arm — auction_nominated stays 0), no failure');
select is(
  (select jsonb_build_object('seq', b.nomination_seq, 'player', b.player_id, 'team', b.team_id,
                             'amount', b.amount, 'action_null', b.action_id is null)
   from draft_bids b join ma_la on ma_la.id = b.draft_id
   where b.nomination_seq = 2 order by b.amount limit 1),
  '{"seq": 2, "player": "ma-rb01", "team": "c9000000-0000-4000-8000-00a100000001", "amount": 1, "action_null": true}'::jsonb,
  'the CPU nomination = the seat''s OWN resolve chain at the nomination floor (D129(2)): lowest-ADP available RB (ma-rb01), T1, $1, action_id NULL — the identical OPENING row a timeout writes (F62)');
select ok(
  (select count(*) > 1 from draft_bids b join ma_la on ma_la.id = b.draft_id
   where b.nomination_seq = 2),
  '…and 091/AP.3''s reactive responder ran INSIDE draft_system_nominate_internal: this RB market is already contested when the nomination returns, in the same tick pass that opened it (§8.8/D200(1) — "the nomination that opened the market" is a provocation)');
select ok(
  (select d.current_nomination->>'player_id' = 'ma-rb01'
          and (d.current_nomination->>'high_bid')::int > 1
          and d.current_deadline = now() + interval '20 seconds'
          and d.on_clock_team_id = 'c9000000-0000-4000-8000-00a100000001'
          and d.current_pick_number = 2
   from drafts d join ma_la on ma_la.id = d.id),
  '…BIDDING phase open on T1''s nomination above its $1 opening, with the 20s bid clock UNTOUCHED (the whole ladder landed above the anti-snipe threshold — D128 unchanged); on_clock stays the nominator; the sequence is still 2 (D157(2))');

-- (D7) E59 carries to an auction mock: a stale LAUNCHER pauses it (ARM
-- 1.6, launcher-keyed) with the BID clock''s remaining persisted; the
-- launcher resumes it.
update draft_liveness dl
set last_seen_at = now() - interval '36 seconds'
from ma_la where dl.draft_id = ma_la.id and dl.user_id = '98000000-0000-4000-8000-000000000002';
select set_config('pgtap.ma_t8', public.draft_tick()::text, true);
select ok(
  (current_setting('pgtap.ma_t8')::jsonb->>'mock_paused')::int >= 1
  and (select d.status = 'paused' and d.deadline_remaining_ms = 20000
       from drafts d join ma_la on ma_la.id = d.id),
  'E59 on an auction mock: the launcher 36s stale (grace 30 + one tick 5) ⇒ ARM 1.6 pauses it with the BID clock''s 20 000ms remaining persisted');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  format($$ select public.draft_resume('%s') $$, (select id from ma_la)),
  '…and the LAUNCHER resumes it (069''s mock-launcher arm — unchanged)');
reset role;
select ok(
  (select d.status = 'live' and d.current_deadline = now() + interval '20 seconds'
          and d.current_nomination->>'player_id' = 'ma-rb01'
   from drafts d join ma_la on ma_la.id = d.id),
  '…live again with the same 20s bid clock and the same live nomination');
update draft_liveness dl set last_seen_at = now()
from ma_la where dl.draft_id = ma_la.id;

-- ---------------------------------------------------------------------------
-- E. E62 — THE BUDGET EDGE (LC): a CPU pushed to max_bid by a scripted human
--    bid-up passes at the edge, folds one dollar past it, and the validator
--    it reaches refuses by name.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft('b9000000-0000-4000-8000-0000000000c1') $$,
  'LC: u02 launches on their own seat (T2 — the default, order[0])');
reset role;
create temp table ma_lc as
select id from drafts where league_id = 'b9000000-0000-4000-8000-0000000000c1' and is_mock;
grant select on ma_lc to authenticated;

-- Privileged fixture picks: every CPU seat COMPLETE (2 picks) except T3 —
-- one pick at $150 (remaining 50, open 1 ⇒ max_bid 50). The human T2 holds
-- none. Sequence numbers 1..13 consumed; the live sequence becomes 14.
insert into draft_picks (draft_id, league_id, pick_number, round, team_id, player_id, price, is_auto, made_via)
select ma_lc.id, 'b9000000-0000-4000-8000-0000000000c1', s.n, null,
       ('c9000000-0000-4000-8000-00c1000000' || lpad(s.t::text, 2, '0'))::uuid,
       'ma-rb' || lpad((20 + s.n)::text, 2, '0'),
       case when s.t = 3 then 150 else 10 end, true, 'autopick'
from ma_lc,
     (values (1, 1), (2, 1), (3, 4), (4, 4), (5, 5), (6, 5), (7, 6), (8, 6),
             (9, 7), (10, 7), (11, 8), (12, 8), (13, 3)) as s(n, t);
update drafts d set current_pick_number = 14, current_round = 7 from ma_lc where d.id = ma_lc.id;
select is(
  (select to_jsonb(b) from ma_lc, public.draft_team_budget(ma_lc.id, 'c9000000-0000-4000-8000-00c100000003') b),
  '{"remaining": 50, "open_slots": 1, "max_bid": 50, "committed": 150}'::jsonb,
  'E62 fixture: T3 sits at the budget edge — $50 left, one open slot ⇒ max_bid $50 (the ONE family)');
select is(
  public.draft_mock_cpu_need((select id from ma_lc), 'c9000000-0000-4000-8000-00c100000003', 'ma-rb01'),
  0.5::numeric,
  'need(T3, RB) = 0.5 — its RB starter is filled, the bench-useful extra remains: OPEN arm, open_slots 1 = unfilled 0 + 1 (the D146 one-unit pair with §F0, where open_slots 1 = unfilled 1 reads 0) (stored literal)');
select is(
  public.draft_mock_cpu_need((select id from ma_lc), 'c9000000-0000-4000-8000-00c100000002', 'ma-rb01'),
  1.0::numeric,
  'need(T2 — the human, 0 picks, RB) = 1.0 — an unfilled starting seat');
select is(
  public.draft_mock_cpu_need((select id from ma_lc), 'c9000000-0000-4000-8000-00c100000001', 'ma-rb01'),
  0::numeric,
  'need(T1, complete with 2 RBs) = 0 — a full roster is FORCED (open 0 = unfilled 0) with no unfilled seat to fill (the OPEN arm would say 0 too: beyond starters + 1)');
select is(
  public.draft_mock_cpu_need((select id from ma_lc), 'c9000000-0000-4000-8000-00c100000002', 'ma-k01'),
  0::numeric,
  'need(any team, K) = 0 ALWAYS — a CPU never raises on a kicker (its forced-arm nomination buys one at the nomination floor)');
select is(
  public.draft_mock_cpu_need((select id from ma_lc), 'c9000000-0000-4000-8000-00c100000002', 'ma-qb01'),
  0.5::numeric,
  'need(T2, QB — a position with NO starting slot) = 0.5 — bench-useful only: OPEN arm, open_slots 2 = unfilled 1 + 1 (the D146 pair with §F0''s need(T3, QB) = 0 at open_slots 2 = unfilled 2)');

-- The human nominates the rank-1 player at $1 (T3 values it far above $50).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  format($$ select public.draft_nominate('%s', 'ma-rb01', 1, 'a9000000-0000-4000-8000-000000000020') $$,
         (select id from ma_lc)),
  'E62: the human nominates the top-ranked player at $1');
reset role;
select ok(
  (select public.draft_mock_cpu_bid_value(d.id, 14, 'c9000000-0000-4000-8000-00c100000003', 1, 1, 200, 2, 8, 0.5) > 50
   from drafts d join ma_lc on ma_lc.id = d.id),
  'fixture: T3''s VALUE for the player (rank 1, need 0.5, pass 1) exceeds its $50 max bid — the cap, not the value, is the binding constraint');
-- 091/AP.3 — THE ANSWER IS ALREADY THERE. The nomination above provoked the
-- responder in its own transaction, so T3 (the ONLY CPU with an open slot —
-- E27 excludes the six complete rosters from candidacy) has already answered,
-- and **draft_tick() has not been called since the nomination**. That is the
-- discriminator: before 091 this row could only exist after a sweep.
-- The amount is pinned AGAINST THE CURVE rather than as a literal, because
-- create_mock_draft mints a fresh UUID per run and the UUID is in the seed —
-- so the honest pin here is "the ladder IS the function", and the curve's own
-- stored literals live in 039 §B where the draft id is fixed.
select is(
  (select count(*) from draft_bids b join ma_lc on ma_lc.id = b.draft_id
   where b.nomination_seq = 14),
  2::bigint,
  'PROVOKED, NOT SWEPT: the $1 nomination is already contested — two rows, written in one transaction, with no tick between them');
select is(
  (select b.amount from draft_bids b join ma_lc on ma_lc.id = b.draft_id
   where b.nomination_seq = 14 and b.team_id = 'c9000000-0000-4000-8000-00c100000003'),
  (select public.draft_mock_cpu_raise_amount(d.id, 14, 'c9000000-0000-4000-8000-00c100000003'::uuid, 1, 1, 50)
   from drafts d join ma_lc on ma_lc.id = d.id),
  '…and T3''s answer is EXACTLY what draft_mock_cpu_raise_amount says for (this draft, nomination 14, T3, pass 1, high $1, ceiling $50) — the ladder is the curve');
select ok(
  (select b.amount <= 50 from draft_bids b join ma_lc on ma_lc.id = b.draft_id
   where b.nomination_seq = 14 and b.team_id = 'c9000000-0000-4000-8000-00c100000003'),
  'E62 AT THE TOP OF THE JUMP: whatever it drew, it is at or under T3''s $50 max bid — the jump is clamped at LEAST(value, max_bid), and the cap is the binding constraint here (its VALUE is far above $50, pinned two assertions up)');
-- The sweep now finds nothing to do — the arm it used to drive has become the
-- safety net (AP.3 item 4 / D200(1)): T3 is the only eligible seat and a CPU
-- never raises itself, so the market is settled.
update drafts d
set updated_at = now() - make_interval(secs => 20 * public.draft_mock_think_fraction(d.id, 14 * 1000 + 2))
from ma_lc where d.id = ma_lc.id;
select set_config('pgtap.ma_e1', public.draft_tick()::text, true);
select is(
  jsonb_build_object(
    'raised', (current_setting('pgtap.ma_e1')::jsonb->>'auction_cpu_raised')::int,
    'folded', (current_setting('pgtap.ma_e1')::jsonb->>'auction_cpu_folded')::int),
  '{"raised": 0, "folded": 1}'::jsonb,
  'THE SWEEP IS NO LONGER THE HEARTBEAT: a tick over a market whose ladder already resolved claims it, folds, and writes nothing');

-- THE ONE-UNIT EDGE (D146), made deterministic. The market is moved to $49 by
-- fixture so the gap to T3's $50 ceiling is EXACTLY ONE DOLLAR — the curve's
-- short-circuit arm, which takes no draw at all, so the two E62 answers below
-- are exact rather than seeded.
reset role;
update drafts d set
  current_nomination = jsonb_build_object(
    'player_id', 'ma-rb01', 'high_bid', 49,
    'high_bidder_team_id', 'c9000000-0000-4000-8000-00c100000002'),
  current_deadline = now() + interval '20 seconds'
from ma_lc where d.id = ma_lc.id;
insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
select ma_lc.id, 'b9000000-0000-4000-8000-0000000000c1', 14, 'ma-rb01',
       'c9000000-0000-4000-8000-00c100000002', 49, 'a9000000-0000-4000-8000-000000000021'
from ma_lc;
select is(
  public.draft_mock_cpu_respond_internal((select id from ma_lc)),
  1,
  'E62 "PASSES" AT THE EDGE: with one dollar of headroom the responder writes exactly ONE raise — high + 1 = $50 = max_bid, the last legal dollar');
select is(
  (select b.amount from draft_bids b join ma_lc on ma_lc.id = b.draft_id
   where b.nomination_seq = 14 and b.team_id = 'c9000000-0000-4000-8000-00c100000003'
   order by b.amount desc limit 1),
  50,
  '…at $50 exactly — no draw was taken (headroom 1 short-circuits), so this is the curve''s one-unit boundary and not a lucky seed');
-- ONE OVER: the human bids $51, so T3's next raise would be $52 = max_bid + 2.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  format($$ select public.draft_place_bid('%s', 51, 'a9000000-0000-4000-8000-000000000022', 14, 'ma-rb01') $$,
         (select id from ma_lc)),
  'the human bids $51 — one dollar past the CPU''s ceiling (with the R330 identity pair)');
reset role;
select is(
  (select count(*) from draft_bids b join ma_lc on ma_lc.id = b.draft_id
   where b.nomination_seq = 14 and b.amount > 50),
  1::bigint,
  'E62 "FOLDS", ONE OVER THE EDGE, INSIDE THE HUMAN''S OWN TRANSACTION: the $51 grew the history by exactly one row — the responder ran and wrote nothing, because T3''s cap IS the validator''s own max bid');
update drafts d
set updated_at = now() - make_interval(secs => 20 * public.draft_mock_think_fraction(d.id, 14 * 1000 + 5))
from ma_lc where d.id = ma_lc.id;
select set_config('pgtap.ma_e3', public.draft_tick()::text, true);
select is(
  jsonb_build_object(
    'claimed', (current_setting('pgtap.ma_e3')::jsonb->>'auction_cpu_claimed')::int,
    'raised', (current_setting('pgtap.ma_e3')::jsonb->>'auction_cpu_raised')::int,
    'folded', (current_setting('pgtap.ma_e3')::jsonb->>'auction_cpu_folded')::int,
    'failures', current_setting('pgtap.ma_e3')::jsonb->'auction_cpu_failures'),
  '{"claimed": 1, "raised": 0, "folded": 1, "failures": []}'::jsonb,
  '…and the safety-net arm agrees on the next sweep: claimed (the think-time was due), NO raise, ONE fold, NO failure');
-- The validator the CPU reaches, asked directly for the dollar it folded on.
-- ($52 rather than $51 because the human's $51 now stands as the high bid, so
-- $51 would meet the raise-floor clause first and prove nothing about E62.)
select throws_ok(
  format($$ select public.draft_place_bid_internal('%s', 'c9000000-0000-4000-8000-00c100000003', 52, null, 'draft_mock_cpu') $$,
         (select id from ma_lc)),
  'P0001',
  'draft_mock_cpu: $52 is over your max bid of $50 — you have $50 for 1 open roster spots at a $1 per-slot reserve (§8.6.1/E5)',
  'E62 — THE VALIDATOR THE CPU PASSES THROUGH refuses $52 (the dollar the responder folded on) by name, under the RESPONDER''s own label: the same E5 clause, the same number, the same function a human''s bid meets. 091 renamed the label from ''draft_tick'' because a reactive response is no longer the tick''s doing — it is the responder''s, whichever transaction provoked it.');
select is(
  (select count(*) from draft_bids b join ma_lc on ma_lc.id = b.draft_id where b.nomination_seq = 14),
  5::bigint,
  '…and the refusal wrote nothing: five rows — the $1 opening, T3''s jump, the $49 fixture bid, T3''s $50 edge raise and the human''s $51');
-- The property, bracketed (R307): across LA + LC, no CPU bid ever exceeded
-- its bidder's max bid AT THE TIME — every CPU row ≤ remaining − (open − 1) ×
-- the nomination floor given the picks on the board when it bid; here no award landed
-- between rows, so the live derivation is the derivation at the time.
select is(
  (select count(*) from draft_bids b join ma_lc on ma_lc.id = b.draft_id
   where b.team_id = 'c9000000-0000-4000-8000-00c100000003'),
  2::bigint,
  'population: T3 placed two bids on this nomination — the jump and the edge raise');
select is(
  (select count(*) from draft_bids b join ma_lc on ma_lc.id = b.draft_id
   where b.team_id = 'c9000000-0000-4000-8000-00c100000003'
     and b.amount > (select max_bid from public.draft_team_budget(ma_lc.id, b.team_id))),
  0::bigint,
  'PROPERTY: none of them exceeds T3''s max bid — no CPU bid above its bidder''s ceiling exists in history (E62''s pgTAP half)');
-- Award: the human wins at $50; T3 keeps its $50 and its open slot.
update drafts d set current_deadline = now() - interval '1 second' from ma_lc where d.id = ma_lc.id;
select set_config('pgtap.ma_e4', public.draft_tick()::text, true);
select is(
  (select jsonb_build_object('team', p.team_id, 'price', p.price, 'is_auto', p.is_auto, 'made_via', p.made_via)
   from draft_picks p join ma_lc on ma_lc.id = p.draft_id where p.pick_number = 14),
  '{"team": "c9000000-0000-4000-8000-00c100000002", "price": 51, "is_auto": false, "made_via": "manager"}'::jsonb,
  'the award goes to the human at $51 as a MANAGER pick (the winning row carries an action_id — D130 read off the row), and the board stays solvent');
select ok(
  public.draft_auction_solvent((select id from ma_lc)),
  '…§8.6.8 holds across the whole LC board after the edge play');

-- ---------------------------------------------------------------------------
-- F. THE SCRIPTED MOCK AUCTION TO COMPLETION + the zero-side-effect
--    composite (LB; §8.8 — the 025 §F contract re-run for an auction, the
--    036 §M / R383 whole-row way).
-- ---------------------------------------------------------------------------
create temp table ma_before as
select
  (select to_jsonb(l) from leagues l where l.id = 'b9000000-0000-4000-8000-0000000000b1') as league_row,
  (select to_jsonb(d) from drafts d where d.id = 'e9000000-0000-4000-8000-0000000000d2') as real_draft_row,
  (select count(*) from league_members where league_id = 'b9000000-0000-4000-8000-0000000000b1') as members,
  (select count(*) from teams where league_id = 'b9000000-0000-4000-8000-0000000000b1') as teams,
  (select count(*) from team_managers tm join teams t on t.id = tm.team_id
    where t.league_id = 'b9000000-0000-4000-8000-0000000000b1') as stints,
  (select count(*) from league_invites where league_id = 'b9000000-0000-4000-8000-0000000000b1') as invites,
  (select count(*) from league_weeks where league_id = 'b9000000-0000-4000-8000-0000000000b1') as weeks,
  (select count(*) from league_lists where league_id = 'b9000000-0000-4000-8000-0000000000b1') as llists,
  (select count(*) from league_rosters where league_id = 'b9000000-0000-4000-8000-0000000000b1') as rosters,
  (select count(*) from notifications where user_id in
    (select user_id from league_members
     where league_id = 'b9000000-0000-4000-8000-0000000000b1')) as notifs,
  (select count(*) from league_chat
    where league_id = 'b9000000-0000-4000-8000-0000000000b1') as chat_rows,
  (select count(*) from draft_picks
    where draft_id = 'e9000000-0000-4000-8000-0000000000d2') as real_picks,
  (select count(*) from draft_bids
    where league_id = 'b9000000-0000-4000-8000-0000000000b1') as league_bids;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft('b9000000-0000-4000-8000-0000000000b1') $$,
  'LB: u01 launches with the DEFAULT seat (their own franchise T1 — order[0], so the human seat opens)');
reset role;
create temp table ma_lb as
select id from drafts where league_id = 'b9000000-0000-4000-8000-0000000000b1' and is_mock;

-- F0. THE FORCED RULE IN THE RAISE BRAIN (R406; D163's autodraft clause; the
--     086:648 rule `forced := remaining <= unfilled` mirrored into
--     draft_mock_cpu_need). Staged on a privileged fixture pick that is
--     REMOVED before the drive, so the scripted run below still starts from
--     an empty board. T2 holds ONE RB at $5 ⇒ open_slots 1 = unfilled 1 (the
--     K seat): the NOMINATION brain is forced to a K, so the RAISE brain must
--     value a second RB at 0 — the bench-useful 0.5 cannot fire on a board
--     with no bench. D146 one-unit pair: LC §E's T3 holds one RB on
--     {RB:1, bench:1} ⇒ open_slots 1 = unfilled 0 + 1 ⇒ 0.5 (the 0.5 still
--     PERMITTED one unit short of forced); LB's T2 here ⇒ open_slots 1 =
--     unfilled 1 ⇒ 0. Same holdings, one unit apart in `open − unfilled`.
insert into draft_picks (draft_id, league_id, pick_number, round, team_id, player_id, price, is_auto, made_via)
select ma_lb.id, 'b9000000-0000-4000-8000-0000000000b1', 1, null,
       'c9000000-0000-4000-8000-00b100000002', 'ma-rb40', 5, true, 'autopick'
from ma_lb;
select is(
  (select to_jsonb(b) from ma_lb, public.draft_team_budget(ma_lb.id, 'c9000000-0000-4000-8000-00b100000002') b),
  '{"remaining": 15, "open_slots": 1, "max_bid": 15, "committed": 5}'::jsonb,
  'R406 fixture: T2 holds one RB at $5 on {RB:1, K:1}/bench 0 — remaining 15, ONE open slot, max_bid 15 (the ONE family)');
select is(
  public.draft_autopick_resolve((select id from ma_lb), 'c9000000-0000-4000-8000-00b100000002'),
  'ma-k01',
  'the NOMINATION brain is FORCED (086:648 — remaining 1 <= unfilled 1): T2''s resolve chain answers the top K, not the top RB');
select is(
  public.draft_mock_cpu_need((select id from ma_lb), 'c9000000-0000-4000-8000-00b100000002', 'ma-rb01'),
  0::numeric,
  'R406 — THE RAISE BRAIN OBEYS THE SAME FORCED RULE: need(T2, a 2nd RB) = 0 when open_slots 1 = unfilled 1 — a second RB fills no unfilled seat, so the bench-useful 0.5 does NOT fire on a bench-0 board (D146: LC §E''s T3, open 1 = unfilled 0 + 1, keeps its 0.5)');
select is(
  public.draft_mock_cpu_need((select id from ma_lb), 'c9000000-0000-4000-8000-00b100000002', 'ma-k01'),
  0::numeric,
  'need(T2, K) = 0 STILL — even when the K seat IS the unfilled seat a CPU never RAISES on a kicker; it buys its own through the forced-arm nomination at min_bid');
select is(
  public.draft_mock_cpu_need((select id from ma_lb), 'c9000000-0000-4000-8000-00b100000003', 'ma-rb01'),
  1.0::numeric,
  'need(T3, 0 picks, RB) = 1.0 — forced too (open 2 <= unfilled 2) but an RB FILLS an unfilled seat: the forced arm values exactly what 086''s forced arm would nominate');
select is(
  public.draft_mock_cpu_need((select id from ma_lb), 'c9000000-0000-4000-8000-00b100000003', 'ma-qb01'),
  0::numeric,
  'need(T3, 0 picks, QB — no starting slot) = 0 in the forced state: the bench-0 0.5 is RETIRED (D146 pair: LC §E''s need(T2, QB) = 0.5 at open 2 = unfilled 1 + 1)');
delete from draft_picks p using ma_lb where p.draft_id = ma_lb.id;
select is(
  (select count(*) from draft_picks p join ma_lb on ma_lb.id = p.draft_id),
  0::bigint,
  '…the staging pick is REMOVED: the scripted run below starts from an EMPTY board (the fixture proved the rule, it does not shape the run)');

-- Script to completion through the REAL tick. CPU nominations land on
-- their think-time (the deadline is set 1s out, which puts every think
-- fraction in the past while the clock still runs); the human seat's
-- nominations time out through ARM 2.6(a)'s mock branch (deadline 120s
-- past — the launcher's beat is not fresh AS OF that deadline, so the
-- grace hold runs and expires); raises land on their think-time (updated_at
-- 20s back); when a pass folds, the clock is expired and the award lands.
create function pg_temp.ma_drive(p_draft_id uuid, p_max int) returns int
language plpgsql as $fn$
declare
  v_d public.drafts;
  v_human text;
  v_bids int;
  v_after int;
  i int := 0;
begin
  loop
    i := i + 1;
    select * into v_d from public.drafts where id = p_draft_id;
    exit when v_d.status = 'complete' or i > p_max;
    v_human := v_d.config->'mock'->>'human_team_id';
    if v_d.current_nomination is null then
      if v_d.on_clock_team_id::text = v_human then
        update public.drafts set current_deadline = now() - interval '120 seconds'
        where id = p_draft_id and status = 'live';
      else
        update public.drafts set current_deadline = now() + interval '1 second'
        where id = p_draft_id and status = 'live';
      end if;
      perform public.draft_tick();
    else
      select count(*) into v_bids from public.draft_bids
      where draft_id = p_draft_id and nomination_seq = v_d.current_pick_number;
      update public.drafts set updated_at = now() - interval '20 seconds'
      where id = p_draft_id and status = 'live';
      perform public.draft_tick();
      select count(*) into v_after from public.draft_bids
      where draft_id = p_draft_id and nomination_seq = v_d.current_pick_number;
      if v_after = v_bids then
        update public.drafts set current_deadline = now() - interval '1 second'
        where id = p_draft_id and status = 'live';
        perform public.draft_tick();
      end if;
    end if;
  end loop;
  return i;
end;
$fn$;
select ok(
  pg_temp.ma_drive((select id from ma_lb), 400) <= 400,
  'the scripted mock AUCTION drove to completion through the real tick (CPU nominations, CPU raises, human-seat timeouts, awards, rotation)');
select ok(
  (select d.status = 'complete' and d.completed_at is not null
          and d.current_nomination is null
          and d.on_clock_team_id is null and d.current_deadline is null
   from drafts d join ma_lb on ma_lb.id = d.id),
  'mock completion: status complete + completed_at, nomination cleared, clocks NULL — the recap survives (§8.8 retention)');
select is(
  (select count(*) from draft_picks p join ma_lb on ma_lb.id = p.draft_id where p.is_undone = false),
  16::bigint,
  'the full board bought: 8 teams × 2 slots = 16 priced picks (the composite''s positive control — the mock really ran)');
select is(
  (select count(*) from (
     select p.team_id from draft_picks p join ma_lb on ma_lb.id = p.draft_id
     where p.is_undone = false group by p.team_id having count(*) = 2) s),
  8::bigint,
  'every team''s roster is FULL — the E27 rotation skip and the completion detector agree on an auction mock');
select ok(
  (select bool_and(p.price >= 1 and p.round is null) from draft_picks p join ma_lb on ma_lb.id = p.draft_id),
  'every pick is priced (≥ the nomination floor) with round NULL — §12.4''s auction shape');
select ok(
  (select bool_and(s.spent <= 20) from (
     select sum(p.price) as spent from draft_picks p join ma_lb on ma_lb.id = p.draft_id
     where p.is_undone = false group by p.team_id) s),
  'no team overspent its $20 — every team''s Σ price ≤ budget');
select ok(
  public.draft_auction_solvent((select id from ma_lb)),
  'solvency (§8.6.8) holds on the finished board through the ONE family — E62''s property on a bot-driven mock');
select ok(
  (select max(p.price) <= 19 from draft_picks p join ma_lb on ma_lb.id = p.draft_id),
  'no price exceeds $19 = a fresh $20 team''s max bid (budget − (2 − 1) × $1): the CPU ladders climb AT MOST to the cap, never past it');
select ok(
  (select count(*) from draft_bids b join ma_lb on ma_lb.id = b.draft_id
   where b.action_id is null and b.amount > 1) > 0,
  'THE CPUs REALLY BID: raises above the $1 opening with action_id NULL exist in the history (positive control — a run in which no CPU ever raised cannot pass)');
select ok(
  (select bool_and(b.action_id is null) from draft_bids b join ma_lb on ma_lb.id = b.draft_id),
  '…and EVERY bid row is a system row — the human never acted; the whole run was engine-made');
select ok(
  (select bool_and(p.is_auto and p.made_via = 'autopick')
   from draft_picks p join ma_lb on ma_lb.id = p.draft_id),
  '…so every award is is_auto/autopick (D130 read off the winning rows)');
-- THE WHOLE-RUN FORCED ASSERTION (R406 / D163): on {RB:1, K:1}/bench 0 every
-- seat is forced from its first pick, so a finished board is EIGHT RBs and
-- EIGHT Ks — one each per team — and no K was ever raised on (the Ks arrive
-- through the forced-arm nominations at the nomination floor, nothing else). Before the
-- fix a CPU holding its RB valued a second RB at 0.5 × base, raised on the
-- human seat's RB nomination, won, and completed with NO K (7 of 8 Ks in
-- the reviewer's run — run-dependent: the PRNG seeds on the mock id).
select is(
  (select count(*) from draft_picks p join ma_lb on ma_lb.id = p.draft_id
   join players pl on pl.id = p.player_id
   where p.is_undone = false and pl.position = 'K'),
  8::bigint,
  'R406 WHOLE RUN: EIGHT Ks bought — every team brought its kicker home (the forced rule in the RAISE brain: a CPU holding its RB never raised on a second RB, so no K seat was ever filled by an RB)');
select is(
  (select count(*) from (
     select p.team_id
     from draft_picks p join ma_lb on ma_lb.id = p.draft_id
     join players pl on pl.id = p.player_id
     where p.is_undone = false
     group by p.team_id
     having count(*) filter (where pl.position = 'RB') = 1
        and count(*) filter (where pl.position = 'K') = 1) s),
  8::bigint,
  '…EIGHT teams hold exactly ONE RB + ONE K — the autodraft clause of D163 end to end ("fill the holes with the final picks"), measured on every roster');
select is(
  (select count(*) from draft_bids b join ma_lb on ma_lb.id = b.draft_id
   join players pl on pl.id = b.player_id
   where pl.position = 'K'),
  8::bigint,
  '…the Ks were NEVER RAISED ON: exactly eight bid rows on kickers across the whole history — the eight $1 opening bids of their forced-arm nominations, nothing after');
select ok(
  (select bool_and(p.price = 1)
   from draft_picks p join ma_lb on ma_lb.id = p.draft_id
   join players pl on pl.id = p.player_id
   where p.is_undone = false and pl.position = 'K'),
  '…and every K was bought at the $1 nomination floor');
-- R408 — the known property, NAMED: a mock''s draft_bids rows carry the REAL
-- league''s league_id (083 RLS keys on it), so a league-scoped reader that
-- does not also filter draft_id (or is_mock through the drafts join) sees
-- practice bids. Readers MUST be draft-scoped — the award lookup is (source
-- pin below); the client feed is (use-draft-feed-sink.test.ts).
select ok(
  (select count(*) from draft_bids b join ma_lb on ma_lb.id = b.draft_id
   where b.league_id = 'b9000000-0000-4000-8000-0000000000b1') > 0
  and (select bool_and(b.league_id = 'b9000000-0000-4000-8000-0000000000b1')
       from draft_bids b join ma_lb on ma_lb.id = b.draft_id),
  'R408 PROPERTY (named, not fixed): every one of the mock''s draft_bids rows carries the REAL league''s league_id — a reader scoped by league alone WOULD see practice bids; the reader-discipline rule is draft_id (or is_mock via drafts) on every league-scoped read');
-- 093/AP.2 RE-POINT: the award lookup is byte-identical, it just lives in
-- draft_award_nomination_internal now (ARM 2.6(b) extracted — D199(3)). The
-- claim is unchanged and so is the regex.
select ok(
  substring(pg_get_functiondef('public.draft_award_nomination_internal(uuid)'::regprocedure)
            from 'SELECT b\.action_id IS NULL INTO v_is_auto.*?LIMIT 1')
    ~ 'b\.draft_id = v_draft\.id',
  'R408 source pin: the AWARD LOOKUP over draft_bids filters `b.draft_id = v_draft.id` — draft-scoped, never league-scoped (093/AP.2: extracted out of draft_tick, same bytes)');
-- THE COMPOSITE (R383): whole rows + counts, byte-identical after.
select is(
  (select to_jsonb(l)::text from leagues l where l.id = 'b9000000-0000-4000-8000-0000000000b1')
  || '|' || (select to_jsonb(d)::text from drafts d where d.id = 'e9000000-0000-4000-8000-0000000000d2')
  || '|' || (select count(*) from league_members where league_id = 'b9000000-0000-4000-8000-0000000000b1')
  || '/' || (select count(*) from teams where league_id = 'b9000000-0000-4000-8000-0000000000b1')
  || '/' || (select count(*) from team_managers tm join teams t on t.id = tm.team_id
             where t.league_id = 'b9000000-0000-4000-8000-0000000000b1')
  || '/' || (select count(*) from league_invites where league_id = 'b9000000-0000-4000-8000-0000000000b1')
  || '/' || (select count(*) from league_weeks where league_id = 'b9000000-0000-4000-8000-0000000000b1')
  || '/' || (select count(*) from league_lists where league_id = 'b9000000-0000-4000-8000-0000000000b1')
  || '/' || (select count(*) from league_rosters where league_id = 'b9000000-0000-4000-8000-0000000000b1')
  || '/' || (select count(*) from notifications where user_id in
             (select user_id from league_members where league_id = 'b9000000-0000-4000-8000-0000000000b1'))
  || '/' || (select count(*) from league_chat where league_id = 'b9000000-0000-4000-8000-0000000000b1'
             and context <> 'draft:' || (select id from ma_lb)::text)
  || '/' || (select count(*) from draft_picks where draft_id = 'e9000000-0000-4000-8000-0000000000d2')
  || '/' || (select count(*) from draft_bids where league_id = 'b9000000-0000-4000-8000-0000000000b1'
             and draft_id <> (select id from ma_lb)),
  (select league_row::text || '|' || real_draft_row::text || '|' || members || '/' || teams || '/' || stints
          || '/' || invites || '/' || weeks || '/' || llists || '/' || rosters || '/' || notifs
          || '/' || chat_rows || '/' || real_picks || '/' || league_bids
   from ma_before),
  'ZERO SIDE EFFECTS (§8.8, the R383 composite): the WHOLE leagues row (status — no transition; settings; updated_at), the WHOLE real scheduled draft row (E60), and every league-scoped count — members/teams/stints/invites/weeks/league_lists/league_rosters/notifications/chat outside the mock''s room/the real draft''s picks/league bids outside the mock — are byte-identical after a completed mock auction; draft_bids rows carry the MOCK''s draft_id only');
select is(
  (select count(*) from league_rosters where league_id = 'b9000000-0000-4000-8000-0000000000b1'),
  0::bigint,
  '…ZERO league_rosters after the completed mock auction — the completion writer''s mock bypass (086) held for the priced path');
select is(
  (select status from leagues where id = 'b9000000-0000-4000-8000-0000000000b1'),
  'setup',
  '…and the league is still in setup — no in_season transition');
select is(
  (select count(*) from draft_liveness dl join ma_lb on ma_lb.id = dl.draft_id),
  1::bigint,
  '…the only liveness row is the launcher''s — CPUs heartbeat nothing');

-- ---------------------------------------------------------------------------
-- G. D138 AFTER CPU BIDS — every commissioner verb refuses the LIVE mock
--    auction (LA: bidding phase, CPU raises in history, a CPU award on the
--    board), bracketed by the whole-row composite (R383). The commissioner
--    u01 is refused though they ARE the commissioner — a mock has no
--    commissioner, only a launcher (D110(1)). Pause/resume by a
--    non-launcher refuse too.
-- ---------------------------------------------------------------------------
create temp table ma_g_before as
select
  (select to_jsonb(d) from drafts d join ma_la on ma_la.id = d.id)              as draft_row,
  (select to_jsonb(l) from leagues l where l.id = 'b9000000-0000-4000-8000-0000000000a1') as league_row,
  (select count(*) from draft_picks p join ma_la on ma_la.id = p.draft_id)     as picks,
  (select count(*) from draft_bids b join ma_la on ma_la.id = b.draft_id)      as bids,
  (select count(*) from league_chat c join ma_la on c.context = 'draft:' || ma_la.id::text) as chat,
  (select count(*) from draft_liveness dl join ma_la on ma_la.id = dl.draft_id) as liveness;
-- The bid COUNT is structural rather than a literal: 091's ladder length is a
-- function of the draft's UUID (create_mock_draft mints a fresh one per run),
-- so what is pinned is that CPU raises exist, an award landed and a market is
-- live — the conditions §G's refusals must hold against.
select is(
  (select jsonb_build_object('bids_at_least_3', bids >= 3, 'picks', picks,
                             'live_nomination', draft_row->>'current_nomination' is not null,
                             'has_cpu_raises', (select count(*) from draft_bids b join ma_la on ma_la.id = b.draft_id
                                                where b.action_id is null and b.amount > 1) > 0)
   from ma_g_before),
  '{"bids_at_least_3": true, "picks": 1, "live_nomination": true, "has_cpu_raises": true}'::jsonb,
  'fixture: LA''s mock holds CPU raises in its history, an award on the board and a live nomination — the sweep runs against a mock the CPUs have already acted in');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.draft_reverse_won_bid('%s', (select id from draft_picks where draft_id = '%s' limit 1)) $$,
         (select id from ma_la), (select id from ma_la)),
  'P0001',
  'draft_reverse_won_bid: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_reverse_won_bid refuses the mock (the CPU''s won bid is not reversible by anyone)');
select throws_ok(
  format($$ select public.draft_adjust_budget('%s', 'c9000000-0000-4000-8000-00a100000001', 10) $$,
         (select id from ma_la)),
  'P0001',
  'draft_adjust_budget: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_adjust_budget refuses the mock');
select throws_ok(
  format($$ select public.draft_cancel_nomination('%s') $$, (select id from ma_la)),
  'P0001',
  'draft_cancel_nomination: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_cancel_nomination refuses the mock (the live CPU nomination cannot be voided by a commissioner)');
select throws_ok(
  format($$ select public.draft_end('%s') $$, (select id from ma_la)),
  'P0001',
  'draft_end: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_end refuses the mock');
select throws_ok(
  format($$ select public.draft_set_clock('%s', 60) $$, (select id from ma_la)),
  'P0001',
  'draft_set_clock: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_set_clock refuses the mock');
select throws_ok(
  format($$ select public.draft_undo('%s') $$, (select id from ma_la)),
  'P0001',
  'draft_undo: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_undo refuses the mock');
select throws_ok(
  format($$ select public.draft_reassign_pick('%s', (select id from draft_picks where draft_id = '%s' limit 1),
       p_team_id => 'c9000000-0000-4000-8000-00a100000002') $$,
         (select id from ma_la), (select id from ma_la)),
  'P0001',
  'draft_reassign_pick: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_reassign_pick refuses the mock');
select throws_ok(
  format($$ select public.draft_move_player('%s', 'ma-rb05',
       (select team_id from draft_picks where draft_id = '%s' limit 1), 'c9000000-0000-4000-8000-00a100000002') $$,
         (select id from ma_la), (select id from ma_la)),
  'P0001',
  'draft_move_player: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_move_player refuses the mock');
select throws_ok(
  format($$ select public.draft_force_pick('%s', 'ma-rb07') $$, (select id from ma_la)),
  'P0001',
  'draft_force_pick: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_force_pick refuses the mock (no force-nominate into a practice)');
select throws_ok(
  format($$ select public.draft_set_order('%s',
       (select array_agg(t.id order by t.name) from teams t where t.league_id = 'b9000000-0000-4000-8000-0000000000a1')) $$,
         (select id from ma_la)),
  'P0001',
  'draft_set_order: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_set_order refuses the mock');
select throws_ok(
  format($$ select public.draft_reset('%s') $$, (select id from ma_la)),
  'P0001',
  'draft_reset: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)',
  'D138: draft_reset refuses the mock — the verb whose bypass would be an outright §8.8 breach');
select throws_ok(
  format($$ select public.draft_pause('%s') $$, (select id from ma_la)),
  'P0001',
  'draft_pause: only the member practicing this mock can pause it (§8.8/D103)',
  'the commissioner cannot even PAUSE another member''s practice (069''s launcher arm — unchanged)');
select throws_ok(
  format($$ select public.draft_resume('%s') $$, (select id from ma_la)),
  'P0001',
  'draft_resume: only the member practicing this mock can resume it (§8.8/D103)',
  '…nor resume it');
reset role;
select is(
  (select to_jsonb(d)::text from drafts d join ma_la on ma_la.id = d.id)
  || '|' || (select to_jsonb(l)::text from leagues l where l.id = 'b9000000-0000-4000-8000-0000000000a1')
  || '|' || (select count(*) from draft_picks p join ma_la on ma_la.id = p.draft_id)
  || '/' || (select count(*) from draft_bids b join ma_la on ma_la.id = b.draft_id)
  || '/' || (select count(*) from league_chat c join ma_la on c.context = 'draft:' || ma_la.id::text)
  || '/' || (select count(*) from draft_liveness dl join ma_la on ma_la.id = dl.draft_id),
  (select draft_row::text || '|' || league_row::text || '|' || picks || '/' || bids || '/' || chat || '/' || liveness
   from ma_g_before),
  '…and the mock is UNTOUCHED by all THIRTEEN — the WHOLE drafts row, the WHOLE leagues row, and the pick/bid/chat/liveness counts (R383): CPU bidding opened no commissioner door');

-- ---------------------------------------------------------------------------
-- H. The 034 §D counterpart on a config-less fixture mock: launched_by NULL
--    ⇒ EVERY member is refused (D110(9) — tick-only, the safe default).
-- ---------------------------------------------------------------------------
insert into drafts (id, league_id, draft_type, status, is_mock, config, total_rounds,
                    current_round, current_pick_number, on_clock_team_id, current_deadline, started_at)
values ('e9000000-0000-4000-8000-0000000000ee', 'b9000000-0000-4000-8000-0000000000c1',
        'auction', 'live', true, '{"auction_budget": 200, "auction_zero_dollar_nominations": false}', 2, 1, 1,
        'c9000000-0000-4000-8000-00c100000001', now() + interval '1 hour', now());
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_nominate('e9000000-0000-4000-8000-0000000000ee', 'ma-rb09', 1, 'a9000000-0000-4000-8000-000000000030') $$,
  'P0001',
  'draft_nominate: this mock draft is another member''s solo practice (§8.8/D103)',
  'a config-less fixture mock (launched_by NULL) refuses every human nominator — tick-only, D110(9)''s safe default (034 §D''s flipped pin, mirrored)');
select throws_ok(
  $$ select public.draft_place_bid('e9000000-0000-4000-8000-0000000000ee', 5, 'a9000000-0000-4000-8000-000000000031') $$,
  'P0001',
  'draft_place_bid: this mock draft is another member''s solo practice (§8.8/D103)',
  '…and every human bidder');
reset role;

select * from finish();
rollback;
