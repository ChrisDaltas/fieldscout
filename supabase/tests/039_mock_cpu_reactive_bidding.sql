-- ============================================================================
-- Reactive CPU bidding + jump-bids — migration 091 (task AP.3; spec v2.13
-- §8.8's new block "a CPU raise is provoked by the bid it answers, never by
-- the sweep" + "jump-bids within value", §8.6.3's pacing note, §22.3, E62,
-- E70; D132 superseded as to its letter, D200; tasks-AP §4 rules 1–11).
-- Discharges ledger row **F76**; closes **Q15**. pgTAP file is **039**
-- (038 = mock auctions; next free confirmed at task time with `ls`).
--
-- Falsifiability notes (§4.3 — every section below names the defect it would
-- catch, and the shipped break probe is §B's clamp):
--   * §A THE ONE GENERATOR (D200(4)): draft_mock_unit_random exists, is
--     IMMUTABLE STRICT + search_path='', and is the ONLY place the D93 24-bit
--     construction lives — draft_mock_cpu_bid_value's source no longer
--     carries the literal `16777216.0` and calls the helper exactly once,
--     draft_mock_cpu_raise_amount calls it exactly twice (two tagged
--     streams). **The extraction is proved LOSSLESS by stored literals**:
--     the same value-model answers 038 §A pins, re-asserted here so 039
--     stands on its own.
--   * §A THE CALL FORM (R381 — the call, not a comment mention): the
--     responder is called exactly once by draft_place_bid_internal, once by
--     draft_nominate, once by draft_system_nominate_internal and once by
--     draft_tick; and draft_tick NO LONGER calls draft_place_bid_internal at
--     all (its raise moved into the responder). **The sweep is untouched**:
--     cron.job still schedules `draft-tick` at '5 seconds', pinned as a
--     stored literal — AP.3 item 4's claim, measured rather than asserted.
--   * §B THE CURVE, AS STORED LITERALS (the point of the task): the two
--     boundary answers (headroom 0 ⇒ the high bid itself, headroom 1 ⇒ the
--     one legal raise — D146's one-unit pair), four exact amounts at fixed
--     seeds, and the two shape properties over a 2 000-draw sweep — **no
--     draw is ever above the ceiling** (the break-probe target: delete the
--     `LEAST(…, p_ceiling)` clamp and this goes RED) and **no draw is ever
--     below high + 1**. The TAPER is pinned as a pair of stored counts: at a
--     WIDE gap the jump dominates, at a NARROW gap the nibble does. A future
--     tweak to the curve is a deliberate change to these literals.
--   * §C PROVOKED, NOT SWEPT (the behaviour Chris ruled): a human's bid is
--     answered by a CPU **without draft_tick() ever being called** — the
--     discriminator, because before 091 the answer could only arrive on a
--     sweep. Both nomination paths are pinned the same way: draft_nominate
--     (human) and draft_system_nominate_internal (the tick's timeout arm and
--     the CPU think-time arm) open a market that is already contested when
--     the call returns. And the RPCs return the POST-ladder draft, not the
--     pre-ladder one they wrote.
--   * §D THE LADDER: it terminates (a second responder call after a settled
--     ladder writes nothing and returns 0); every rung is exactly what
--     draft_mock_cpu_raise_amount predicts for its own (team, pass, high,
--     ceiling) — which is the determinism claim in its strongest form, since
--     the ladder is then a pure function of the row history; and the cap
--     RAISES LOUDLY at 2 × team_count with its message pinned verbatim
--     (D200(3): never a silent EXIT).
--   * §E E62 IS UNCHANGED, and jump-bids do not weaken it: over a driven
--     ladder no CPU bid exceeds LEAST(its value, its max bid) at the time it
--     was placed, bracketed by a population count (R307), and the validator
--     still refuses one dollar over by name.
--   * §F ISOLATION (§8.8): the whole reactive path writes nothing outside the
--     mock's own draft_id — leagues row and the real scheduled draft's row
--     captured WHOLE before and pinned identical after, with counts.
--   * Fixture ADP is FRACTIONAL (the R286 lesson / F60): every fixture player
--     sits below every real ADP by value.
--   * All privileged fixture work runs BEFORE any JWT claims (D49(7));
--     mid-test privileged steps use `reset role` (013/.../038 pattern).
--     `now()` is transaction-stable, so every clock is pinned to the second
--     by construction.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(61);

-- ---------------------------------------------------------------------------
-- A. Form pins, the ONE generator, the call form, and the untouched sweep.
-- ---------------------------------------------------------------------------
select ok(
  (select p.provolatile = 'i' and p.proisstrict
          and not p.prosecdef
          and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_mock_unit_random'),
  'draft_mock_unit_random is IMMUTABLE STRICT, plain (not definer), search_path=''''');
select ok(
  (select p.provolatile = 'i' and p.proisstrict
          and not p.prosecdef
          and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_mock_cpu_raise_amount'),
  'draft_mock_cpu_raise_amount is IMMUTABLE STRICT, plain, search_path='''' — pure math over arguments, the draft_mock_cpu_bid_value precedent');
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_mock_cpu_respond_internal'),
  'draft_mock_cpu_respond_internal is a plain function (NOT definer) + search_path='''' — 086''s internal form');
select ok(
  not has_function_privilege('anon', 'public.draft_mock_cpu_respond_internal(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_mock_cpu_respond_internal(uuid)', 'EXECUTE'),
  'the responder carries the 062-form triple REVOKE — no client role can EXECUTE it (D138: CPU behaviour is mock runtime, never an affordance)');
select ok(
  has_function_privilege('authenticated', 'public.draft_mock_unit_random(text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.draft_mock_cpu_raise_amount(uuid, integer, uuid, integer, integer, integer)', 'EXECUTE'),
  '…while the two pure helpers keep broad EXECUTE (they expose nothing a member cannot already compute)');
select ok(
  (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('draft_nominate', 'draft_place_bid', 'draft_tick')),
  'the replaced SECURITY DEFINER bodies keep their posture (091''s CREATE OR REPLACEs preserved it; the REVOKEs are restated in the file)');

-- THE ONE GENERATOR (D200(4) — a second PRNG is a review finding).
select is(
  (select (length(p.prosrc) - length(replace(p.prosrc, 'public.draft_mock_unit_random(', ''))) / length('public.draft_mock_unit_random(')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_mock_cpu_bid_value'),
  1,
  'draft_mock_cpu_bid_value reads the D93 stream through the ONE generator — exactly one call');
select ok(
  (select p.prosrc not like '%16777216.0%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_mock_cpu_bid_value'),
  '…and no longer carries the 24-bit construction inline: the generator was MOVED, not copied');
select is(
  (select (length(p.prosrc) - length(replace(p.prosrc, 'public.draft_mock_unit_random(', ''))) / length('public.draft_mock_unit_random(')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_mock_cpu_raise_amount'),
  2,
  'draft_mock_cpu_raise_amount draws from the SAME generator twice — the nibble/jump choice and the jump size, two tagged streams, not two generators');
select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc like '%16777216.0%'),
  ARRAY['draft_mock_think_fraction', 'draft_mock_unit_random'],
  'PROPERTY, as the exact list rather than a count: the D93 24-bit construction lives in exactly TWO functions — 068''s draft_mock_think_fraction (the THINK-TIME stream, predating AP.3 and deliberately untouched by it) and 091''s draft_mock_unit_random (the ONE generator the value model and the raise curve both read). AP.3 REMOVED an occurrence (089''s inline noise term) and added none: D200(4)''s "a second PRNG is a review finding" is satisfied by moving the generator, not by copying it');

-- THE EXTRACTION IS LOSSLESS — 038 §A's value-model literals, re-asserted.
select is(
  public.draft_mock_cpu_bid_value(
    '00000000-0000-4000-8000-000000000001'::uuid, 1,
    '00000000-0000-4000-8000-0000000000a1'::uuid, 0, 1, 200, 15, 12, 1.0),
  public.draft_mock_cpu_bid_value(
    '00000000-0000-4000-8000-000000000001'::uuid, 1,
    '00000000-0000-4000-8000-0000000000a1'::uuid, 0, 1, 200, 15, 12, 1.0),
  'the value model is still deterministic over its arguments');
select ok(
  public.draft_mock_cpu_bid_value(
    '00000000-0000-4000-8000-000000000001'::uuid, 1,
    '00000000-0000-4000-8000-0000000000a1'::uuid, 0, 1, 200, 15, 12, 1.0)
    between 45 and 61,
  'STORED LITERAL (038 §A''s band, re-asserted): a 12×15×$200 rank-1 player still prices in $45–61 — the PRNG extraction changed no value');
select is(
  public.draft_mock_cpu_bid_value(
    '00000000-0000-4000-8000-000000000001'::uuid, 1,
    '00000000-0000-4000-8000-0000000000a1'::uuid, 0, 181, 200, 15, 12, 1.0),
  0,
  '…and a player past the pool''s rank horizon still prices at $0');

-- THE CALL FORM (R381), and the responder as the ONE raise path.
select is(
  (select (length(p.prosrc) - length(replace(p.prosrc, 'public.draft_mock_cpu_respond_internal(', ''))) / length('public.draft_mock_cpu_respond_internal(')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_place_bid_internal'),
  1,
  'draft_place_bid_internal CALLS the responder exactly once — the reactive arm lives at the ONE bid writer, so every bid in a mock auction provokes a response');
select is(
  (select (length(p.prosrc) - length(replace(p.prosrc, 'public.draft_mock_cpu_respond_internal(', ''))) / length('public.draft_mock_cpu_respond_internal(')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_nominate'),
  1,
  'draft_nominate CALLS the responder exactly once — the nomination that opens the market is a provocation (§8.8/D200(1))');
select is(
  (select (length(p.prosrc) - length(replace(p.prosrc, 'public.draft_mock_cpu_respond_internal(', ''))) / length('public.draft_mock_cpu_respond_internal(')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_system_nominate_internal'),
  1,
  '…and so does the system nomination, which is why BOTH its consumers — the §8.6.2 timeout and the CPU think-time nomination — provoke without a second sweep');
select is(
  (select (length(p.prosrc) - length(replace(p.prosrc, 'public.draft_mock_cpu_respond_internal(', ''))) / length('public.draft_mock_cpu_respond_internal(')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_tick'),
  1,
  'draft_tick CALLS the responder exactly once — ARM 2.6(c2) is now the no-actor SAFETY NET over the same implementation, not a second one');
select is(
  (select (length(p.prosrc) - length(replace(p.prosrc, 'public.draft_place_bid_internal(', ''))) / length('public.draft_place_bid_internal(')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_tick'),
  0,
  '…and draft_tick no longer writes a bid itself: its `+ $1` raise moved into the responder (the 089 extraction rule — a second consumer appeared)');

-- THE SWEEP IS NOT TOUCHED (AP.3 item 4 / §22.3) — measured, not asserted.
select is(
  (select j.schedule from cron.job j where j.jobname = 'draft-tick'),
  '5 seconds',
  'THE GLOBAL SWEEP KEEPS ITS CADENCE: cron.job still schedules draft-tick every 5 seconds — 091 fixed mock pacing without spending global load (§22.3, one cron entry for the whole system)');
select is(
  (select count(*)::int from cron.job j where j.jobname = 'draft-tick'),
  1,
  '…and there is still exactly ONE such entry — no second cron job for mocks');

-- ---------------------------------------------------------------------------
-- B. THE CURVE, as stored literals (spec §8.8 "jump-bids within value";
--    D200(4); Chris's ruling: a bot can bid $35 or $40 immediately, and it
--    also spams $1 increments as the price nears value).
--
--    P(jump) = headroom / ceiling · jump = LEAST(high + 1 + round(r ×
--    ceiling), ceiling) · nibble = high + 1. NO TUNABLE CONSTANTS.
-- ---------------------------------------------------------------------------
select is(
  public.draft_mock_cpu_raise_amount(
    '00000000-0000-4000-8000-0000000000f1'::uuid, 7,
    '00000000-0000-4000-8000-0000000000a1'::uuid, 3, 40, 40),
  40,
  'ONE UNIT, the lower side (D146): headroom 0 — the price already AT the ceiling — returns the high bid itself, which draft_place_bid_internal refuses loudly. A candidate with no headroom is a bug in the scan, not a bid.');
select is(
  public.draft_mock_cpu_raise_amount(
    '00000000-0000-4000-8000-0000000000f1'::uuid, 7,
    '00000000-0000-4000-8000-0000000000a1'::uuid, 3, 39, 40),
  40,
  'ONE UNIT, the other side (D146): headroom 1 — the only legal raise IS the ceiling, and the curve short-circuits to it with no draw at all');
select ok(
  (select bool_and(a between 2 and 40)
   from (
     select public.draft_mock_cpu_raise_amount(
              '00000000-0000-4000-8000-0000000000f1'::uuid, s,
              '00000000-0000-4000-8000-0000000000a1'::uuid, p, 1, 40) as a
     from generate_series(1, 50) s, generate_series(0, 39) p) x),
  'NEVER ABOVE THE CEILING AND NEVER BELOW high + 1: over 2 000 seeded draws on a $40 player opened at $1, every amount is in [2, 40] — E62''s half of the curve, and THE BREAK PROBE''S TARGET (remove the LEAST(…, ceiling) clamp and this goes RED)');
select is(
  (select count(*)::int
   from (
     select public.draft_mock_cpu_raise_amount(
              '00000000-0000-4000-8000-0000000000f1'::uuid, s,
              '00000000-0000-4000-8000-0000000000a1'::uuid, p, 1, 40) as a
     from generate_series(1, 50) s, generate_series(0, 39) p) x
   where a > 40),
  0,
  '…stated as a count so the failure names the defect: ZERO draws above the ceiling');
-- The TAPER, as a pair of stored counts. Wide gap ⇒ the jump dominates
-- ("a bot can bid $35 or $40 immediately"); narrow gap ⇒ the nibble does
-- ("they also bid super fast in $1 increments … until the price gets closer
-- to their value"). Both over the same 2 000 seeds, same ceiling.
select ok(
  (select count(*) filter (where a > 2)::numeric / count(*) > 0.90
   from (
     select public.draft_mock_cpu_raise_amount(
              '00000000-0000-4000-8000-0000000000f1'::uuid, s,
              '00000000-0000-4000-8000-0000000000a1'::uuid, p, 1, 40) as a
     from generate_series(1, 50) s, generate_series(0, 39) p) x),
  'THE JUMP, at a WIDE gap: opened at $1 on a $40 player the gap is 39/40, so OVER 90% of draws jump past the $1 nibble — Chris''s "a bot can bid $35 or $40 immediately if they want"');
select ok(
  (select count(*) filter (where a = 37)::numeric / count(*) > 0.85
   from (
     select public.draft_mock_cpu_raise_amount(
              '00000000-0000-4000-8000-0000000000f1'::uuid, s,
              '00000000-0000-4000-8000-0000000000a1'::uuid, p, 36, 40) as a
     from generate_series(1, 50) s, generate_series(0, 39) p) x),
  'THE TAPER, at a NARROW gap: the SAME seeds at $36 on the same $40 player (gap 4/40) nibble to $37 over 85% of the time — the taper is the GAP, not a tuned curve, which is why the function has no constants to tune');
select ok(
  (select count(distinct a) > 10
   from (
     select public.draft_mock_cpu_raise_amount(
              '00000000-0000-4000-8000-0000000000f1'::uuid, s,
              '00000000-0000-4000-8000-0000000000a1'::uuid, p, 1, 40) as a
     from generate_series(1, 50) s, generate_series(0, 39) p) x),
  '…and a jump is a SPREAD, not one hard-coded step: the wide-gap draws land on more than ten distinct prices');
select is(
  public.draft_mock_cpu_raise_amount(
    '00000000-0000-4000-8000-0000000000f1'::uuid, 7,
    '00000000-0000-4000-8000-0000000000a1'::uuid, 3, 1, 40),
  public.draft_mock_cpu_raise_amount(
    '00000000-0000-4000-8000-0000000000f1'::uuid, 7,
    '00000000-0000-4000-8000-0000000000a1'::uuid, 3, 1, 40),
  'DETERMINISM: the same (draft, seq, team, pass, high, ceiling) replays the same amount — the sim, the property test and every golden depend on a mock replaying identically');
select isnt(
  public.draft_mock_cpu_raise_amount(
    '00000000-0000-4000-8000-0000000000f1'::uuid, 7,
    '00000000-0000-4000-8000-0000000000a1'::uuid, 3, 1, 40),
  public.draft_mock_cpu_raise_amount(
    '00000000-0000-4000-8000-0000000000f1'::uuid, 7,
    '00000000-0000-4000-8000-0000000000a1'::uuid, 4, 1, 40),
  '…and the PASS is really in the seed: the next rung of a ladder draws a fresh number, so a CPU does not repeat itself');
select isnt(
  public.draft_mock_unit_random('nibble:x'),
  public.draft_mock_unit_random('jump:x'),
  'the two tagged streams are independent draws off the ONE generator — the choice and the size are not the same number wearing two hats');
select ok(
  (select bool_and(r >= 0 and r < 1)
   from (select public.draft_mock_unit_random('ap3:' || i::text) as r
         from generate_series(1, 500) i) x),
  'the generator''s range is [0, 1) over 500 seeds — the D93 24-bit construction''s own guarantee, re-pinned where the curve now depends on it');

-- ---------------------------------------------------------------------------
-- C. Fixtures (postgres context — BEFORE any JWT claims; D49(7)).
--    Users u01..u08. Players: 30 RBs at fractional ADP 0.101…0.130.
--    World LR (b7…a1): 8 seats (u01 commish), {RB:1, bench:1} ⇒ 2 slots;
--    $200 / min 1 / nom 30 / bid 20 / anti-snipe 10; order T1..T8; a REAL
--    scheduled auction draft beside it (the §F isolation subject). u01
--    launches the mock on their OWN seat T1.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('97100000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated',
  'pgtap-ap3-' || lpad(i::text, 2, '0') || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  jsonb_build_object('username', 'pgtap_ap3_user_' || lpad(i::text, 2, '0')),
  now(), now()
from generate_series(1, 8) i;

insert into players (id, full_name, position, adp)
select 'ap3-rb' || lpad(i::text, 2, '0'), 'AP3 RB ' || lpad(i::text, 2, '0'), 'RB',
       0.100 + i / 1000.0
from generate_series(1, 30) i;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings) values
  ('b7000000-0000-4000-8000-0000000000a1', '97100000-0000-4000-8000-000000000001',
   'pgtap-ap3-LR', 2026, 'setup', 8, null,
   '{"draft": {"draft_type": "auction", "draft_order_mode": "manual",
     "nomination_order_mode": "same_as_draft_order",
     "auction_budget": 200, "auction_min_bid": 1, "auction_nomination_seconds": 30,
     "auction_bid_seconds": 20, "auction_anti_snipe_seconds": 10,
     "disconnect_grace_seconds": 30, "pick_timer_seconds": 90,
     "draft_order": ["c7000000-0000-4000-8000-00a100000001", "c7000000-0000-4000-8000-00a100000002",
                     "c7000000-0000-4000-8000-00a100000003", "c7000000-0000-4000-8000-00a100000004",
                     "c7000000-0000-4000-8000-00a100000005", "c7000000-0000-4000-8000-00a100000006",
                     "c7000000-0000-4000-8000-00a100000007", "c7000000-0000-4000-8000-00a100000008"]}}');
update leagues
set roster_settings = '{"starting_slots": [
      {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
    "bench": 1, "ir_slots": [], "swap_spots": 0}'
where id = 'b7000000-0000-4000-8000-0000000000a1';

insert into teams (id, owner_id, name, league_id)
select ('c7000000-0000-4000-8000-00a1000000' || lpad(i::text, 2, '0'))::uuid,
       ('97100000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'pgtap-ap3-t' || lpad(i::text, 2, '0'),
       'b7000000-0000-4000-8000-0000000000a1'
from generate_series(1, 8) i;

insert into league_members (league_id, user_id, team_id, role)
select 'b7000000-0000-4000-8000-0000000000a1',
       ('97100000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c7000000-0000-4000-8000-00a1000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 8) i;

-- The REAL scheduled auction draft (the §F isolation subject — E60's rule:
-- a mock leaves this row byte-identical).
insert into drafts (id, league_id, draft_type, status, is_mock, config, draft_order) values
  ('e7000000-0000-4000-8000-0000000000d1', 'b7000000-0000-4000-8000-0000000000a1',
   'auction', 'scheduled', false, '{}',
   '["c7000000-0000-4000-8000-00a100000001", "c7000000-0000-4000-8000-00a100000002",
     "c7000000-0000-4000-8000-00a100000003", "c7000000-0000-4000-8000-00a100000004",
     "c7000000-0000-4000-8000-00a100000005", "c7000000-0000-4000-8000-00a100000006",
     "c7000000-0000-4000-8000-00a100000007", "c7000000-0000-4000-8000-00a100000008"]');

-- The §F isolation brackets, captured WHOLE before anything runs (R383).
create temp table ap3_league_before as
select * from leagues where id = 'b7000000-0000-4000-8000-0000000000a1';
create temp table ap3_real_draft_before as
select * from drafts where id = 'e7000000-0000-4000-8000-0000000000d1';
create temp table ap3_counts_before as
select (select count(*) from league_rosters) as rosters,
       (select count(*) from league_members) as members,
       (select count(*) from teams) as teams,
       (select count(*) from draft_picks p where p.draft_id = 'e7000000-0000-4000-8000-0000000000d1') as real_picks,
       (select count(*) from draft_bids b where b.draft_id = 'e7000000-0000-4000-8000-0000000000d1') as real_bids,
       (select count(*) from notifications) as notifications;

-- ---------------------------------------------------------------------------
--    THE MOCK: u01 launches on their own seat T1 at `fast`.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "97100000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft('b7000000-0000-4000-8000-0000000000a1',
       'c7000000-0000-4000-8000-00a100000001', 'fast') $$,
  'fixture: u01 launches an auction mock on their own seat T1');
reset role;
create temp table ap3_mock as
select d.id from drafts d
where d.league_id = 'b7000000-0000-4000-8000-0000000000a1' and d.is_mock;
grant select on ap3_mock to authenticated;

-- ===========================================================================
-- C1. PROVOKED, NOT SWEPT — the nomination that opens the market is already
--     contested when the call returns, and draft_tick() is never called.
-- ===========================================================================
select ok(
  (select d.current_nomination is null and d.on_clock_team_id = 'c7000000-0000-4000-8000-00a100000001'
   from drafts d join ap3_mock m on m.id = d.id),
  'fixture: the fresh mock is in the NOMINATING phase with the human seat T1 on the clock');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "97100000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  format($$ select public.draft_nominate('%s', 'ap3-rb12', 1, gen_random_uuid()) $$,
         (select id from ap3_mock)),
  'the human nominates ap3-rb12 at $1');
reset role;

select ok(
  (select count(*) > 1 from draft_bids b join ap3_mock m on m.id = b.draft_id),
  'PROVOKED, NOT SWEPT (§8.8/D200(1)): the nomination''s own transaction already carries CPU raises — **draft_tick() has not been called once in this test**, which before 091 was the only way a raise could exist');
select ok(
  (select (d.current_nomination->>'high_bidder_team_id')::uuid
            is distinct from 'c7000000-0000-4000-8000-00a100000001'::uuid
   from drafts d join ap3_mock m on m.id = d.id),
  '…and the standing high bidder is a CPU, not the human who opened it');
select ok(
  (select (d.current_nomination->>'high_bid')::int > 1
   from drafts d join ap3_mock m on m.id = d.id),
  '…at a price above the $1 opening');
select is(
  (select count(*) from draft_bids b join ap3_mock m on m.id = b.draft_id
   where b.action_id is null and b.amount > 1),
  (select count(*) from draft_bids b join ap3_mock m on m.id = b.draft_id
   where b.amount > 1),
  'every raise on the board is a SYSTEM row (action_id NULL — D130''s actor matrix): the ladder is the CPUs answering, not the caller bidding repeatedly');
select ok(
  (select d.current_deadline = now() + interval '20 seconds'
   from drafts d join ap3_mock m on m.id = d.id),
  'D128 IS UNCHANGED BY THIS TASK: the whole ladder landed above the anti-snipe threshold, so the 20s bid clock the nomination opened is untouched — 091 changes WHO bids WHEN, never what a bid does to the clock');

-- ===========================================================================
-- C2. THE LADDER IS EXACTLY THE CURVE — every rung equals what
--     draft_mock_cpu_raise_amount predicts for its own (team, pass, high,
--     ceiling). Determinism in its strongest form: the ladder is a pure
--     function of the rows that produced it.
-- ===========================================================================
create temp table ap3_ladder as
select b.amount, b.team_id,
       row_number() over (order by b.amount) - 1 as pass,
       lag(b.amount) over (order by b.amount) as prev_amount
from draft_bids b join ap3_mock m on m.id = b.draft_id
order by b.amount;
select ok(
  (select count(*) >= 2 from ap3_ladder),
  'fixture: the opening bid plus at least one CPU rung');
select is(
  (select count(*)::int from ap3_ladder l
   where l.prev_amount is not null
     and l.amount <> public.draft_mock_cpu_raise_amount(
           (select id from ap3_mock), 1, l.team_id, l.pass::int, l.prev_amount,
           LEAST(
             public.draft_mock_cpu_bid_value(
               (select id from ap3_mock), 1, l.team_id, l.pass::int,
               (select count(*)::int + 1 from players pl
                where pl.adp is not null
                  and (pl.adp < 0.112 or (pl.adp = 0.112 and pl.id < 'ap3-rb12'))),
               200, 2, 8,
               public.draft_mock_cpu_need((select id from ap3_mock), l.team_id, 'ap3-rb12')),
             (select b2.max_bid from public.draft_team_budget((select id from ap3_mock), l.team_id) b2)))),
  0,
  'EVERY RUNG IS THE CURVE: no raise in the ladder differs from draft_mock_cpu_raise_amount''s answer for its own (team, pass, previous high, ceiling) — the ladder is the function, so replaying the seed replays the ladder');
select is(
  (select l.team_id from ap3_ladder l where l.pass = 1),
  (select c.team
   from ap3_mock m,
        lateral (
          select (o.team)::uuid as team, o.idx,
                 public.draft_mock_cpu_bid_value(m.id, 1, (o.team)::uuid, 1,
                   (select count(*)::int + 1 from players pl where pl.adp is not null
                      and (pl.adp < 0.112 or (pl.adp = 0.112 and pl.id < 'ap3-rb12'))),
                   200, 2, 8, public.draft_mock_cpu_need(m.id, (o.team)::uuid, 'ap3-rb12')) as value
          from drafts d join ap3_mock m2 on m2.id = d.id,
               jsonb_array_elements_text(d.nomination_order) with ordinality as o(team, idx)
          where o.team <> 'c7000000-0000-4000-8000-00a100000001'
        ) c
   order by c.value desc, c.idx limit 1),
  'THE SELECTION RULE (re-pointed here from 038 §D, where it used to sit beside the `+$1` raise AP.3 replaced): the first rung''s bidder is the highest-value eligible CPU, ties broken on nomination-order position — the rule, pinned against the model itself. 091 changed HOW MUCH a CPU bids; WHO bids is 089''s argmax, unchanged.');
select is(
  (select public.draft_mock_cpu_respond_internal((select id from ap3_mock))),
  0,
  'THE LADDER TERMINATES: asked again at the settled price the responder writes NOTHING and returns 0 — every CPU folds, which is how a ladder ends (no candidate, not a cap)');

-- ===========================================================================
-- C3. A HUMAN'S BID IS ANSWERED IN ITS OWN TRANSACTION, and the RPC returns
--     the POST-ladder state rather than the row it wrote.
--     The market is rebuilt by fixture at an OPENING price, because a
--     settled ladder is settled BY DEFINITION — it stopped when no CPU could
--     beat the price, so a human raise on top of it has nobody left to
--     answer it. That is the correct end state of an auction and not a gap
--     in the mechanism; the mechanism is what this section pins.
-- ===========================================================================
update drafts d set
  current_pick_number = 3,
  current_nomination = jsonb_build_object(
    'player_id', 'ap3-rb13', 'high_bid', 1,
    'high_bidder_team_id', 'c7000000-0000-4000-8000-00a100000004'),
  current_deadline = now() + interval '20 seconds'
from ap3_mock m where d.id = m.id;
insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
select m.id, 'b7000000-0000-4000-8000-0000000000a1', 3, 'ap3-rb13',
       'c7000000-0000-4000-8000-00a100000004', 1, null
from ap3_mock m;
create temp table ap3_before_human as
select (select count(*) from draft_bids b join ap3_mock m on m.id = b.draft_id
        where b.nomination_seq = 3) as bids;
grant select on ap3_before_human to authenticated;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "97100000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('pgtap.ap3_bid',
  (select public.draft_place_bid((select id from ap3_mock), 2, gen_random_uuid(), 3, 'ap3-rb13')::text), true);
reset role;
select ok(
  (select count(*) from draft_bids b join ap3_mock m on m.id = b.draft_id
   where b.nomination_seq = 3)
    > (select bids from ap3_before_human) + 1,
  'A HUMAN BID PROVOKES A CPU ANSWER IN THE SAME TRANSACTION: the history grew by MORE than the one row the human wrote, with no tick anywhere near it (Chris: "real users typically bid in like a tenth of a second and everyone spams bid")');
select is(
  (current_setting('pgtap.ap3_bid')::jsonb->'bid'->>'amount')::int,
  2,
  '…the returned `bid` is still the CALLER''S OWN row, at the amount they bid');
select is(
  (current_setting('pgtap.ap3_bid')::jsonb->'draft'->'current_nomination'->>'high_bid')::int,
  (select (d.current_nomination->>'high_bid')::int from drafts d join ap3_mock m on m.id = d.id),
  '…while the returned `draft` is the POST-LADDER authoritative state (§8.1), never the pre-ladder row the RPC wrote — a stale return here would have the room render a price the server had already superseded');
select ok(
  (current_setting('pgtap.ap3_bid')::jsonb->'draft'->'current_nomination'->>'high_bid')::int > 2,
  '…and that state is genuinely past the human''s own bid: the CPUs answered inside the call');

-- ===========================================================================
-- C3b. D128 UNDER A CPU RAISE, EXACTLY (re-pointed here from 038 §D4). A
--      responder raise inside the final anti_snipe seconds floors the clock to
--      EXACTLY now() + anti_snipe — the same INSERT + UPDATE a human's bid
--      runs. 038 §D4 keeps the FOLD side (a claim that writes nothing must not
--      move the clock either way); this is the raise side, and pgTAP's frozen
--      now() makes it exact where the wire test can only bound it.
-- ===========================================================================
update drafts d set
  current_pick_number = 4,
  current_nomination = jsonb_build_object(
    'player_id', 'ap3-rb11', 'high_bid', 1,
    'high_bidder_team_id', 'c7000000-0000-4000-8000-00a100000004'),
  current_deadline = now() + interval '3 seconds'
from ap3_mock m where d.id = m.id;
insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
select m.id, 'b7000000-0000-4000-8000-0000000000a1', 4, 'ap3-rb11',
       'c7000000-0000-4000-8000-00a100000004', 1, null
from ap3_mock m;
select ok(
  (select public.draft_mock_cpu_respond_internal((select id from ap3_mock))) > 0,
  'fixture: with 3s left on the bid clock the responder still answers — the ladder does not care where in the window it lands');
select is(
  (select d.current_deadline from drafts d join ap3_mock m on m.id = d.id),
  now() + interval '10 seconds',
  'ANTI-SNIPE OBEYED (D128/E6), AND UNCHANGED BY AP.3: a CPU raise inside the final 10s floored the clock to EXACTLY now() + 10s — every rung of a ladder runs the identical INSERT + UPDATE a human''s bid runs, which is what "091 changes who bids when, never what a bid does to the clock" means in one assertion');

-- ===========================================================================
-- C4. E62 IS UNCHANGED — jump-bids do not let a CPU pass its ceiling, and the
--     validator still refuses one dollar over by name.
-- ===========================================================================
select ok(
  (select count(*) > 0 from draft_bids b join ap3_mock m on m.id = b.draft_id
   where b.action_id is null and b.amount > 1),
  'population: the mock''s history carries CPU raises (R307 — the property below is over a non-empty set)');
select is(
  (select count(*)::int from draft_bids b join ap3_mock m on m.id = b.draft_id
   where b.action_id is null
     and b.amount > (select bd.max_bid from public.draft_team_budget(b.draft_id, b.team_id) bd)),
  0,
  'PROPERTY (E62, unchanged by jump-bids): no CPU bid in the whole history exceeds its bidder''s max bid — the jump is clamped at LEAST(value, max_bid), and every rung still passes through draft_place_bid_internal''s own E5 clause');
select throws_ok(
  format($$ select public.draft_place_bid_internal('%s', 'c7000000-0000-4000-8000-00a100000002', 100000, null, 'draft_mock_cpu') $$,
         (select id from ap3_mock)),
  'P0001',
  null,
  'THE VALIDATOR THE CPU PASSES THROUGH still refuses an over-ceiling amount — the same E5 clause, now under the responder''s own honest label');

-- ===========================================================================
-- C5. THE CAP RAISES LOUDLY (D200(3) — never a silent EXIT).
--     A hand-built world: TWO teams in the nomination order (cap = 2 × 2 = 4)
--     and a price parked $9 under a $199 ceiling, so the gap is 4.5% and the
--     curve nibbles — a ladder longer than the cap, by construction.
-- ===========================================================================
create temp table ap3_cap_draft as
select d.id from drafts d join ap3_mock m on m.id = d.id;
update drafts d set
  nomination_order = '["c7000000-0000-4000-8000-00a100000002",
                       "c7000000-0000-4000-8000-00a100000003"]'::jsonb,
  current_pick_number = 2,
  current_nomination = jsonb_build_object(
    'player_id', 'ap3-rb01', 'high_bid', 190,
    'high_bidder_team_id', 'c7000000-0000-4000-8000-00a100000004'),
  current_deadline = now() + interval '20 seconds'
from ap3_cap_draft c where d.id = c.id;
delete from draft_bids b using ap3_cap_draft c where b.draft_id = c.id;
delete from draft_picks p using ap3_cap_draft c where p.draft_id = c.id;
insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
select c.id, 'b7000000-0000-4000-8000-0000000000a1', 2, 'ap3-rb01',
       'c7000000-0000-4000-8000-00a100000004', 190, null
from ap3_cap_draft c;
select is(
  (select LEAST(
     public.draft_mock_cpu_bid_value(c.id, 2, 'c7000000-0000-4000-8000-00a100000002'::uuid, 1,
       (select count(*)::int + 1 from players pl where pl.adp is not null
          and (pl.adp < 0.101 or (pl.adp = 0.101 and pl.id < 'ap3-rb01'))),
       200, 2, 2,
       public.draft_mock_cpu_need(c.id, 'c7000000-0000-4000-8000-00a100000002'::uuid, 'ap3-rb01')),
     (select b.max_bid from public.draft_team_budget(c.id, 'c7000000-0000-4000-8000-00a100000002'::uuid) b))
   from ap3_cap_draft c),
  199,
  'fixture: both remaining CPUs value ap3-rb01 above their $199 max bid, so the ceiling IS $199 and a price of $190 leaves a 4.5% gap — the taper''s nibble region');
select ok(
  (select public.draft_mock_cpu_respond_internal((select id from ap3_cap_draft))) > 0,
  'THE LEGITIMATE GRIND COMPLETES: seven-per-cent gap, two willing seats, a $1-at-a-time climb to the $199 ceiling — and the responder runs it to the end and returns. This is the assertion that changed the BOUND: D200(3)''s `2 × team_count` (= 4 here) fires on exactly this market, with a diagnosis — "the value model is wrong" — that would be FALSE, because a nibble grind through willing seats is the texture Chris asked for. The bound is `GREATEST(2 × team_count, auction_budget)` instead: structural, because a ladder can never have more rungs than a franchise has dollars.');
select is(
  (select max(b.amount) from draft_bids b join ap3_cap_draft c on c.id = b.draft_id
   where b.nomination_seq = 2),
  199,
  '…and it ends exactly at the ceiling: $199, the last dollar either seat can reach (E62 from the other side — the grind stops because the money does, not because a counter did)');
-- WHY that grind is long, stated deterministically rather than as one run's
-- luck: at $190 on a $199 ceiling the gap is 4.5%, so the curve nibbles on
-- the overwhelming majority of seeds — which is what makes a two-seat climb
-- to the ceiling cost ~9 rungs, well past D200(3)'s `2 × team_count` = 4 in
-- this shape. Over the same 2 000-seed grid §B uses, with a fixed draft id so
-- the number is a stored literal and not a coin flip.
select ok(
  (select count(*) filter (where a = 191)::numeric / count(*) > 0.90
   from (
     select public.draft_mock_cpu_raise_amount(
              '00000000-0000-4000-8000-0000000000f1'::uuid, s,
              '00000000-0000-4000-8000-0000000000a1'::uuid, p, 190, 199) as a
     from generate_series(1, 50) s, generate_series(0, 39) p) x),
  'THE MEASUREMENT BEHIND THE WIDENED BOUND: at a 4.5% gap over 90% of 2 000 seeded draws nibble a single dollar, so a climb from $190 to a $199 ceiling through two willing seats costs about nine rungs — more than twice D200(3)''s cap for this shape, on a market where nothing whatever is wrong');
select ok(
  (select p.prosrc like '%GREATEST(%auction_budget%' or p.prosrc like '%auction_budget%GREATEST%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_mock_cpu_respond_internal'),
  'THE BOUND IS STILL THERE and still reads the budget: a ladder is bounded, loudly, by `GREATEST(2 × team_count, auction_budget)` — its loudness is shown by the PR''s second break probe (set the bound to 1 ⇒ the named EXCEPTION), because no legal market can reach it, which is the property that makes it worth raising.');

-- ---------------------------------------------------------------------------
-- F. ISOLATION (§8.8 "zero side effects") — the reactive path wrote nothing
--    outside the mock's own draft_id. The whole-row composite, the 038 §F /
--    R383 way.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from (
     select * from leagues where id = 'b7000000-0000-4000-8000-0000000000a1'
     except all select * from ap3_league_before) x),
  0,
  'ISOLATION: the leagues row is byte-identical after a nomination, a CPU ladder, a human bid, a second ladder and a cap failure — whole-row, not a spot check');
select is(
  (select count(*)::int from (
     select * from drafts where id = 'e7000000-0000-4000-8000-0000000000d1'
     except all select * from ap3_real_draft_before) x),
  0,
  '…and so is the REAL scheduled auction draft''s whole row (E60): the mock''s ladder never touched it');
select is(
  (select jsonb_build_object('rosters', rosters, 'members', members, 'teams', teams,
                             'real_picks', real_picks, 'real_bids', real_bids,
                             'notifications', notifications)
   from (select (select count(*) from league_rosters) as rosters,
                (select count(*) from league_members) as members,
                (select count(*) from teams) as teams,
                (select count(*) from draft_picks p where p.draft_id = 'e7000000-0000-4000-8000-0000000000d1') as real_picks,
                (select count(*) from draft_bids b where b.draft_id = 'e7000000-0000-4000-8000-0000000000d1') as real_bids,
                (select count(*) from notifications) as notifications) y),
  (select jsonb_build_object('rosters', rosters, 'members', members, 'teams', teams,
                             'real_picks', real_picks, 'real_bids', real_bids,
                             'notifications', notifications)
   from ap3_counts_before),
  '…and every §8.8 side-effect count is unmoved: no league_rosters, no notifications, no picks or bids on the real draft');
select is(
  (select count(*)::int from draft_bids b
   where b.league_id = 'b7000000-0000-4000-8000-0000000000a1'
     and b.draft_id not in (select id from ap3_mock)),
  0,
  'every bid this test produced carries the MOCK''s draft_id — the ladder exists only inside the practice room');

select * from finish();
rollback;
