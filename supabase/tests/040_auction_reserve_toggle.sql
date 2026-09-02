-- ============================================================================
-- `auction_min_bid` retires, `auction_zero_dollar_nominations` arrives —
-- migration 092 (task AP.1; spec v2.13 §7.3.8 (the removed row + the new
-- toggle + the amended budget-floor bullet), §8.6.1–8.6.3, §8.6.8, E5/E68;
-- D198; tasks-AP §4 rules 1–11). Supersedes tasks-M3 **C38** as to its
-- vehicle and RE-POINTS its substance (D198(3) — C38's pins in 032/033/034
-- were moved to the toggle in this PR, not deleted). pgTAP file is **040**
-- (039 = reactive CPU bidding; next free confirmed at task time with `ls`).
--
-- CHRIS'S RULINGS THIS FILE EXISTS TO PIN (2026-08-20):
--   "you can't have a $0 minimum bid, those are two different settings"
--   "Nomination and Min Bid need to be different"
--   "a nomination should allow any number that the player can afford"
--   "we only need a min bid of $1 more right now"
--   "with $0 nominations there is no $1 per slot reserve"
--
-- Falsifiability notes (§4.3 — every section names the defect it catches, and
-- the shipped break probe is the DoD's: make `draft_auction_reserve` return
-- `1` unconditionally):
--   * §A THE ONE AUTHORITY (D198(1)): the helper's two answers as stored
--     literals, its NOT-STRICT NULL behaviour (a STRICT helper would return
--     NULL and turn every downstream max_bid into a silent unknown — the
--     "nothing happened means it worked" shape), the full `::boolean` literal
--     domain, and the proof that the RETIRED key is INERT (a stale
--     `auction_min_bid` in a config cannot move the reserve). Plus the
--     structural pin that NO function body in the schema still reads
--     `auction_min_bid` and that every one of the twelve replaced bodies
--     calls the helper — the R381 "the call, not a comment mention" form.
--   * §B THE MAX-BID GOLDENS, BOTH STATES, ON ONE DRAFT ROW (the point of the
--     task): 200/16/185 with the toggle OFF and 200/16/200 with it ON, as
--     stored literals, flipped on the SAME draft so the toggle is the only
--     variable. The one-unit boundary is pinned from both sides (185 is false
--     at 184 and 186) and the LAST-SLOT negative control is pinned too — with
--     one slot open the reserve term vanishes and the two states AGREE, which
--     is the shape that would make a naive "the toggle does something" test
--     pass for the wrong reason. **The break probe reddens §B's ON pin.**
--   * §C §8.6.8 STAYS CORRECT AND STOPS BINDING (D198(4); never-weaken):
--     `draft_auction_solvent` still answers on the same boards, still RAISES
--     on an empty franchise set, and the INSOLVENT board it calls false with
--     the toggle OFF it calls true with the toggle ON — the machinery is
--     present in both columns, not deleted in one.
--   * §D THE START GATE, ONE DOLLAR EITHER SIDE AND ONE FLAG EITHER SIDE:
--     $15 against 16 draftable slots is refused with the toggle OFF (exact
--     message, so the copy that used to send a commissioner to a RETIRED knob
--     cannot come back) and starts with it ON; $16 — one dollar up — starts
--     with the toggle OFF.
--   * §E E28'S ARMS, PRESENT IN BOTH COLUMNS: arm 2 refuses at reserve 1 and
--     is VACUOUS at reserve 0, while arm 1 (below committed spend) still
--     binds at reserve 0 — the discriminator between "the invariant went
--     slack" (correct) and "the invariant was removed" (a review finding).
--   * §F THE TWO SETTINGS ARE TWO SETTINGS (Chris's ruling, pinned as
--     behaviour): on ONE league toggled, the NOMINATION FLOOR moves ($0
--     refused OFF, accepted ON) while the BID INCREMENT does not (a $0
--     standing bid is raised to $1 and never to $0, in BOTH columns). A diff
--     that threaded the toggle into the raise clause reddens the second half.
--   * §G THE DATA MIGRATION (D198(2)): the mapping `0 => true`, `>= 1 =>
--     false` over planted rows, the `>= 2` cohort's boundary (a stored 1 is
--     NOT in it, a stored 2 is), and the whole-database post-condition that
--     no `leagues.settings->'draft'` and no `drafts.config` still carries the
--     retired key after the chain replays. The authoritative rehearsal of
--     section 14 itself — planted rows, three NOTICEs, an idempotent re-run
--     and the loud refusal of a non-integer value — is the transcript in the
--     AP.1 PR body; what a per-run test can hold is the mapping and the
--     post-condition, and this section says which is which rather than
--     implying the DO block re-ran.
--   * §H POSTURE (tasks-M1 §4.1): the helper is IMMUTABLE, carries
--     `search_path=''`, and is REVOKEd from PUBLIC/anon/authenticated.
-- ============================================================================
begin;
select plan(36);

-- ---------------------------------------------------------------------------
-- A. draft_auction_reserve — the ONE authority (D198(1))
-- ---------------------------------------------------------------------------
select is(public.draft_auction_reserve('{"auction_zero_dollar_nominations": false}'::jsonb), 1,
  'RESERVE GOLDEN, toggle OFF: $1 — the §8.6.1 per-slot reserve and the §8.6.2 nomination floor, one derived number');
select is(public.draft_auction_reserve('{"auction_zero_dollar_nominations": true}'::jsonb), 0,
  'RESERVE GOLDEN, toggle ON: $0 — "with $0 nominations there is no $1 per slot reserve"');
select is(public.draft_auction_reserve('{}'::jsonb), 1,
  'ABSENT ⇒ 1: the §7.3.8 default, so every league that never touched the setting keeps today''s behaviour exactly');
select is(public.draft_auction_reserve(NULL), 1,
  'NULL config ⇒ 1, NOT NULL: the helper is deliberately not STRICT — a NULL answer would make every downstream max_bid a silent unknown (the retired code fell to 1 here too, via COALESCE)');
select is(public.draft_auction_reserve('{"auction_min_bid": 0}'::jsonb), 1,
  'THE RETIRED KEY IS INERT: a stale auction_min_bid left in a config cannot resurrect the old floor — it is read by nothing');
select is(
  (select string_agg(public.draft_auction_reserve(v)::text, ',' order by ord)
   from unnest(array['{"auction_zero_dollar_nominations": true}',
                     '{"auction_zero_dollar_nominations": "true"}',
                     '{"auction_zero_dollar_nominations": "t"}',
                     '{"auction_zero_dollar_nominations": "yes"}',
                     '{"auction_zero_dollar_nominations": "on"}',
                     '{"auction_zero_dollar_nominations": "1"}',
                     '{"auction_zero_dollar_nominations": false}',
                     '{"auction_zero_dollar_nominations": "f"}',
                     '{"auction_zero_dollar_nominations": "off"}',
                     '{"auction_zero_dollar_nominations": "0"}',
                     '{"auction_zero_dollar_nominations": null}']::jsonb[])
        with ordinality as u(v, ord)),
  '0,0,0,0,0,0,1,1,1,1,1',
  'THE `::boolean` DOMAIN, as a stored literal: every truthy Postgres literal reads ON, every falsy one and a JSON null read OFF — the row the TS mirror''s boolOrDefault is pinned against');

-- The structural half (R381 — the CALL, never a comment mention). Twelve
-- bodies were replaced; each must call the helper and none may still read the
-- retired key. `prosrc` is the shipped body, so this is the schema speaking.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%auction_min_bid%'),
  0,
  'NO function body in public still reads auction_min_bid — the retirement reached every read site, not just the ones a planning document listed');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('draft_team_budget','draft_auction_solvent','draft_start_internal',
                       'draft_adjust_budget','draft_force_pick','create_mock_draft',
                       'draft_reassign_pick','draft_move_player','draft_place_bid_internal',
                       'draft_system_nominate_internal','draft_nominate',
                       -- 093/AP.2: draft_tick's ONE reserve read served ARM
                       -- 2.6(b)'s award refusal and moved WITH that arm into
                       -- draft_award_nomination_internal. The list swaps one
                       -- name for the other; the count and the claim stand.
                       'draft_award_nomination_internal')
     and p.prosrc like '%draft_auction_reserve(%'),
  12,
  'ALL TWELVE bodies that read the reserve call draft_auction_reserve — one authority, no private COALESCE (D198(1)); 093/AP.2 moved the twelfth read out of draft_tick and into the extracted award');
select ok(
  (select p.prosrc not like '%draft_auction_reserve(%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_tick'),
  '…and draft_tick no longer reads the reserve AT ALL — it delegates the only arm that needed it, so the swap above is a move and not a dropped call (093/AP.2)');

-- ---------------------------------------------------------------------------
-- B. Fixtures + the max-bid goldens, both toggle states, ONE draft row
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
select '00000000-0000-0000-0000-000000000000',
       ('8e000000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-rt' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       ('{"username": "rt_user_' || i || '"}')::jsonb, now(), now()
from generate_series(1, 2) i;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings)
values
  -- LA: the shipped default shape — 12 teams, $200, the default roster's 16
  -- DRAFTABLE slots (D91: starters + bench, IR excluded; 16 since SC.2 —
  -- the v2.16.9 Scout default roster, wr 2 → 3).
  ('a7000000-0000-4000-8000-0000000000aa', '8e000000-0000-4000-8000-000000000001',
   'pgtap-rt-LA-main', 2026, 'scheduled', 12,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "random",
     "nomination_order_mode": "same_as_draft_order",
     "auction_budget": 200, "auction_zero_dollar_nominations": false,
     "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
     "auction_anti_snipe_seconds": 10, "pick_timer_seconds": 90}}'),
  -- LB: ONE DOLLAR SHORT of the derived floor — $15 against 16 slots. The
  -- budget is under the catalog's own min(50) deliberately: pgTAP writes the
  -- blob directly, so this is the cheapest shape that reaches the ENGINE's
  -- start gate, which counts D91 draftable slots (starters + bench, no IR).
  -- **Not a claim that the gate is unreachable otherwise (R456)** — that
  -- claim was made about the SETTINGS layer, was false, and is withdrawn by
  -- spec v2.13.3; the settings validator's own solvency arm fires on a
  -- schema-valid object with a big enough roster. Two layers, two counts.
  ('a7000000-0000-4000-8000-0000000000bb', '8e000000-0000-4000-8000-000000000001',
   'pgtap-rt-LB-short', 2026, 'scheduled', 12,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "random",
     "nomination_order_mode": "same_as_draft_order",
     "auction_budget": 15, "auction_zero_dollar_nominations": false,
     "pick_timer_seconds": 90}}'),
  -- LC: LB one dollar up — EXACTLY at the floor with the toggle OFF.
  ('a7000000-0000-4000-8000-0000000000cc', '8e000000-0000-4000-8000-000000000001',
   'pgtap-rt-LC-atfloor', 2026, 'scheduled', 12,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "random",
     "nomination_order_mode": "same_as_draft_order",
     "auction_budget": 16, "auction_zero_dollar_nominations": false,
     "pick_timer_seconds": 90}}'),
  -- LD: the nomination-floor / increment world — $200, ONE draftable slot is
  -- not enough for §F's raise, so it keeps the default roster and gets a
  -- second seat that can bid.
  ('a7000000-0000-4000-8000-0000000000dd', '8e000000-0000-4000-8000-000000000001',
   'pgtap-rt-LD-floor', 2026, 'scheduled', 12,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "manual",
     "draft_order": ["c7000000-0000-4000-8000-00dd00000001","c7000000-0000-4000-8000-00dd00000002",
                     "c7000000-0000-4000-8000-00dd00000003","c7000000-0000-4000-8000-00dd00000004",
                     "c7000000-0000-4000-8000-00dd00000005","c7000000-0000-4000-8000-00dd00000006",
                     "c7000000-0000-4000-8000-00dd00000007","c7000000-0000-4000-8000-00dd00000008",
                     "c7000000-0000-4000-8000-00dd00000009","c7000000-0000-4000-8000-00dd00000010",
                     "c7000000-0000-4000-8000-00dd00000011","c7000000-0000-4000-8000-00dd00000012"],
     "nomination_order_mode": "same_as_draft_order",
     "auction_budget": 200, "auction_zero_dollar_nominations": true,
     "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
     "auction_anti_snipe_seconds": 10, "pick_timer_seconds": 90}}');

insert into teams (id, owner_id, name, league_id)
select ('c7000000-0000-4000-8000-00' || tag || lpad(i::text, 8, '0'))::uuid,
       '8e000000-0000-4000-8000-000000000001', 'pgtap-rt-' || tag || '-t' || i, lg
from (values ('aa', 'a7000000-0000-4000-8000-0000000000aa'::uuid),
             ('bb', 'a7000000-0000-4000-8000-0000000000bb'::uuid),
             ('cc', 'a7000000-0000-4000-8000-0000000000cc'::uuid),
             ('dd', 'a7000000-0000-4000-8000-0000000000dd'::uuid)) as f(tag, lg)
cross join generate_series(1, 12) i;

insert into league_members (league_id, user_id, team_id, role)
select lg, '8e000000-0000-4000-8000-000000000001',
       ('c7000000-0000-4000-8000-00' || tag || '00000001')::uuid, 'commissioner'
from (values ('aa', 'a7000000-0000-4000-8000-0000000000aa'::uuid),
             ('bb', 'a7000000-0000-4000-8000-0000000000bb'::uuid),
             ('cc', 'a7000000-0000-4000-8000-0000000000cc'::uuid),
             ('dd', 'a7000000-0000-4000-8000-0000000000dd'::uuid)) as f(tag, lg);
insert into league_members (league_id, user_id, team_id, role) values
  ('a7000000-0000-4000-8000-0000000000dd', '8e000000-0000-4000-8000-000000000002',
   'c7000000-0000-4000-8000-00dd00000002', 'manager');

insert into players (id, full_name, position)
select 'pgtap-rt-p' || lpad(i::text, 2, '0'), 'PgTap Reserve ' || i, 'RB'
from generate_series(1, 20) i;

select is(
  (public.draft_start_internal('a7000000-0000-4000-8000-0000000000aa', false)->>'started')::boolean,
  true,
  'LA: the shipped default auction starts (12 × $200 over 16 draftable slots)');

select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid, b.committed
     from drafts d
     cross join lateral public.draft_team_budget(d.id, 'c7000000-0000-4000-8000-00aa00000001') b
     where d.league_id = 'a7000000-0000-4000-8000-0000000000aa' $$,
  $$ values (200, 16, 185, 0) $$,
  'GOLDEN, $0 NOMINATIONS OFF: 200 / 16 / 185 (200 − 15 × $1) / 0 — the shipped default, byte-for-byte what 033 §D has always answered');

-- THE DISCRIMINATOR: flip the toggle on the SAME draft row and nothing else.
update drafts set config = jsonb_set(config, '{auction_zero_dollar_nominations}', 'true'::jsonb)
where league_id = 'a7000000-0000-4000-8000-0000000000aa';
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid, b.committed
     from drafts d
     cross join lateral public.draft_team_budget(d.id, 'c7000000-0000-4000-8000-00aa00000001') b
     where d.league_id = 'a7000000-0000-4000-8000-0000000000aa' $$,
  $$ values (200, 16, 200, 0) $$,
  'GOLDEN, $0 NOMINATIONS ON: 200 / 16 / 200 — max_bid IS remaining, flat (§8.6.1/E68). Same row, same budget, same slots: the ONLY thing that moved is the toggle. **THE BREAK PROBE REDDENS HERE.**');
select is(
  (select b.max_bid from drafts d
   cross join lateral public.draft_team_budget(d.id, 'c7000000-0000-4000-8000-00aa00000001') b
   where d.league_id = 'a7000000-0000-4000-8000-0000000000aa') - 185,
  15,
  'D146, the gap is exactly (open_slots − 1) × $1 = 15 — false at 14 and at 16, so a reserve of $0.5 or $2 could not pass this pin');

-- THE NEGATIVE CONTROL (the pin that must NOT discriminate). With ONE slot
-- open the reserve term is (1 − 1) × reserve = 0 whichever the reserve is, so
-- the two states AGREE — a test that "the toggle changes max_bid" would pass
-- here for the wrong reason, and this pin says so out loud.
update drafts set total_rounds = 1 where league_id = 'a7000000-0000-4000-8000-0000000000aa';
select is(
  (select b.max_bid from drafts d
   cross join lateral public.draft_team_budget(d.id, 'c7000000-0000-4000-8000-00aa00000001') b
   where d.league_id = 'a7000000-0000-4000-8000-0000000000aa'),
  200,
  'LAST-SLOT NEGATIVE CONTROL, toggle ON: one open slot ⇒ max_bid 200 (the reserve term vanishes)');
update drafts set config = jsonb_set(config, '{auction_zero_dollar_nominations}', 'false'::jsonb)
where league_id = 'a7000000-0000-4000-8000-0000000000aa';
select is(
  (select b.max_bid from drafts d
   cross join lateral public.draft_team_budget(d.id, 'c7000000-0000-4000-8000-00aa00000001') b
   where d.league_id = 'a7000000-0000-4000-8000-0000000000aa'),
  200,
  '…and toggle OFF answers 200 TOO — the one shape where the toggle cannot show, pinned so a passing test is never mistaken for a discriminating one');
update drafts set total_rounds = 16 where league_id = 'a7000000-0000-4000-8000-0000000000aa';

-- ---------------------------------------------------------------------------
-- C. §8.6.8 stays correct and stops binding (D198(4) — never-weaken)
-- ---------------------------------------------------------------------------
update drafts set budget_adjustments = '{"c7000000-0000-4000-8000-00aa00000002": -185}'::jsonb
where league_id = 'a7000000-0000-4000-8000-0000000000aa';
select is(
  public.draft_auction_solvent(
    (select id from drafts where league_id = 'a7000000-0000-4000-8000-0000000000aa')),
  false,
  '§8.6.8 with the toggle OFF: a seat cut to $15 against 16 open slots is INSOLVENT (15 < 16 × $1) — one dollar short, the discriminating state');
update drafts set config = jsonb_set(config, '{auction_zero_dollar_nominations}', 'true'::jsonb)
where league_id = 'a7000000-0000-4000-8000-0000000000aa';
select is(
  public.draft_auction_solvent(
    (select id from drafts where league_id = 'a7000000-0000-4000-8000-0000000000aa')),
  true,
  '…and with the toggle ON the SAME board is solvent (15 ≥ 16 × $0): the invariant did not go away, it went slack — every team can fill every slot at $0');
update drafts set budget_adjustments = '{"c7000000-0000-4000-8000-00aa00000002": -201}'::jsonb
where league_id = 'a7000000-0000-4000-8000-0000000000aa';
select is(
  public.draft_auction_solvent(
    (select id from drafts where league_id = 'a7000000-0000-4000-8000-0000000000aa')),
  false,
  '…AND IT STILL FIRES AT reserve 0: a seat cut to −$1 is insolvent against `remaining >= 0`, so §8.6.8 is running in BOTH columns rather than short-circuited in one');
update drafts set budget_adjustments = '{}'::jsonb,
    config = jsonb_set(config, '{auction_zero_dollar_nominations}', 'false'::jsonb)
where league_id = 'a7000000-0000-4000-8000-0000000000aa';

-- ---------------------------------------------------------------------------
-- D. The start gate — one dollar either side, one flag either side
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.draft_start_internal('a7000000-0000-4000-8000-0000000000bb', false) $$,
  'P0001',
  'draft_start: league a7000000-0000-4000-8000-0000000000bb cannot start an auction — a $15 budget cannot fill 16 draftable roster spots at a $1 per-slot reserve (§8.6.8 solvency); raise the auction budget, or allow $0 nominations in League settings → Draft setup',
  'START GATE, toggle OFF, ONE DOLLAR SHORT: refused with the numbers, the UNIT (D91 draftable slots) and a remedy that names a knob that EXISTS — the retired "lower the minimum bid" sentence cannot come back without reddening this');
select is(
  (public.draft_start_internal('a7000000-0000-4000-8000-0000000000cc', false)->>'started')::boolean,
  true,
  '…and ONE DOLLAR UP ($16 for 16 slots, exactly at the floor) starts — the pair brackets the gate (D146)');
update leagues
set settings = jsonb_set(settings, '{draft,auction_zero_dollar_nominations}', 'true'::jsonb)
where id = 'a7000000-0000-4000-8000-0000000000bb';
select is(
  (public.draft_start_internal('a7000000-0000-4000-8000-0000000000bb', false)->>'started')::boolean,
  true,
  '…and the SAME $15 league starts once $0 nominations are allowed — one flag, no other change (§8.6.8 stops binding)');

-- ---------------------------------------------------------------------------
-- E. E28's arms, present in BOTH columns (D198(4))
-- ---------------------------------------------------------------------------
update drafts set status = 'live' where league_id = 'a7000000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_adjust_budget(
       (select id from drafts where league_id = 'a7000000-0000-4000-8000-0000000000aa'),
       'c7000000-0000-4000-8000-00aa00000003', -187, 'pgtap') $$,
  'P0001',
  'draft_adjust_budget: that leaves pgtap-rt-aa-t3 with $13 for 16 open roster spots at a $1 per-slot reserve — §8.6.8 needs at least $16; reverse a won bid to free a spot, or make the adjustment smaller (E28)',
  'E28 ARM 2 with the toggle OFF: still refusing, and the message names the RESERVE rather than a "minimum bid" the league does not have');
reset role;
update drafts set config = jsonb_set(config, '{auction_zero_dollar_nominations}', 'true'::jsonb)
where league_id = 'a7000000-0000-4000-8000-0000000000aa';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (public.draft_adjust_budget(
     (select id from drafts where league_id = 'a7000000-0000-4000-8000-0000000000aa'),
     'c7000000-0000-4000-8000-00aa00000003', -187, 'pgtap')
   #>> '{remaining}'),
  '13',
  'E28 ARM 2 with the toggle ON: the SAME edit is accepted — the arm is VACUOUS, not removed ($13 ≥ 16 × $0)');
select throws_ok(
  $$ select public.draft_adjust_budget(
       (select id from drafts where league_id = 'a7000000-0000-4000-8000-0000000000aa'),
       'c7000000-0000-4000-8000-00aa00000003', -14, 'pgtap') $$,
  'P0001',
  'draft_adjust_budget: that leaves pgtap-rt-aa-t3 $1 short of the $0 already spent — reverse a won bid instead, or make the adjustment smaller (E28)',
  'E28 ARM 1 STILL BINDS AT reserve 0: "you cannot un-spend money" is not a solvency rule and never goes slack — the discriminator between a slack invariant and a deleted one');
reset role;

-- ---------------------------------------------------------------------------
-- F. Two settings are two settings — the floor moves, the increment does not
-- ---------------------------------------------------------------------------
select is(
  (public.draft_start_internal('a7000000-0000-4000-8000-0000000000dd', false)->>'started')::boolean,
  true,
  'LD starts with $0 nominations ON — the board §F drives');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (public.draft_nominate(
     (select id from drafts where league_id = 'a7000000-0000-4000-8000-0000000000dd'),
     'pgtap-rt-p01', 0, 'a7000000-0000-4000-8000-00000000000a')
   #>> '{draft,current_nomination,high_bid}'),
  '0',
  'THE FLOOR MOVES: with $0 nominations ON a $0 opening is ACCEPTED — "a nomination should allow any number that the player can afford" (Chris, 2026-08-20)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8e000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_place_bid(
       (select id from drafts where league_id = 'a7000000-0000-4000-8000-0000000000dd'),
       0, 'a7000000-0000-4000-8000-00000000000b') $$,
  'P0001',
  'draft_place_bid: outbid at $0 — pgtap-rt-dd-t1 holds the high bid; bid $1 or more',
  'THE INCREMENT DOES NOT: over a $0 standing bid the least legal raise is still $1, and the refusal still names $1 — the toggle reaches the FLOOR and never the increment (§8.6.3; "you can''t have a $0 minimum bid, those are two different settings")');
select is(
  (public.draft_place_bid(
     (select id from drafts where league_id = 'a7000000-0000-4000-8000-0000000000dd'),
     1, 'a7000000-0000-4000-8000-00000000000c')
   #>> '{draft,current_nomination,high_bid}'),
  '1',
  '…and $1 — one dollar up — is accepted: the $1 increment is the SAME number in both toggle columns');
reset role;

-- The mirror-image half on a toggle-OFF league: the floor refuses $0. LC
-- resolved a RANDOM order, so the seat is put on the clock explicitly — the
-- 034:470 form; the pin under test is the floor, not the rotation.
update drafts set on_clock_team_id = 'c7000000-0000-4000-8000-00cc00000001'
where league_id = 'a7000000-0000-4000-8000-0000000000cc';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_nominate(
       (select id from drafts where league_id = 'a7000000-0000-4000-8000-0000000000cc'),
       'pgtap-rt-p02', 0, 'a7000000-0000-4000-8000-00000000000d') $$,
  'P0001',
  'draft_nominate: an opening bid of $0 is below this league''s $1 nomination floor (§7.3.8)',
  'THE FLOOR, the other side: with $0 nominations OFF a $0 opening is refused, one dollar short of the $1 floor (D146)');
reset role;

-- ---------------------------------------------------------------------------
-- G. The data migration's mapping and post-condition (D198(2))
-- ---------------------------------------------------------------------------
-- The MAPPING, as section 14 computes it. This expression is quoted from
-- 092 §14's UPDATE; the authoritative rehearsal of the DO BLOCK ITSELF —
-- planted rows, the three NOTICEs, an idempotent second run and the loud
-- refusal of a non-integer value — is the transcript in the AP.1 PR body. A
-- one-shot DO block cannot be re-run by a per-run test, and this file says so
-- rather than implying otherwise.
select is(
  (select string_agg((COALESCE((v->>'auction_min_bid')::int, 1) = 0)::text, ',' order by ord)
   from unnest(array['{"auction_min_bid": 0}', '{"auction_min_bid": 1}',
                     '{"auction_min_bid": 2}', '{"auction_min_bid": 5}',
                     '{"auction_min_bid": null}', '{}']::jsonb[])
        with ordinality as u(v, ord)),
  'true,false,false,false,false,false',
  'THE MAPPING (§7.3.8''s removed row): a stored 0 becomes the toggle ON and everything ≥ 1 becomes OFF, with a JSON null falling to the same default the retired COALESCE gave it (1 ⇒ OFF)');
select is(
  (select string_agg((COALESCE((v->>'auction_min_bid')::int, 1) >= 2)::text, ',' order by ord)
   from unnest(array['{"auction_min_bid": 1}', '{"auction_min_bid": 2}']::jsonb[])
        with ordinality as u(v, ord)),
  'false,true',
  'THE `>= 2` COHORT BOUNDARY, one unit either side: a stored 1 keeps its meaning and is NOT reported, a stored 2 loses it ($2 reserve ⇒ $1) and IS reported by id');
select is(
  (select count(*)::int from public.leagues l where l.settings->'draft' ? 'auction_min_bid'),
  0,
  'POST-CONDITION: after the full 001–092 chain replays, NO leagues.settings->draft carries the retired key — the z.strictObject parse failure D198(2) exists to prevent');
select is(
  (select count(*)::int from public.drafts d where d.config ? 'auction_min_bid'),
  0,
  '…and NO drafts.config carries it either — both stores, which is the half that is easy to skip');

-- ---------------------------------------------------------------------------
-- H. Posture (tasks-M1 §4.1 / grants doctrine D18→D23)
-- ---------------------------------------------------------------------------
select ok(
  (select p.provolatile = 'i' and not p.prosecdef
      and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_auction_reserve'),
  'draft_auction_reserve is IMMUTABLE, plain (not SECURITY DEFINER — it reads nothing) and carries the exact spec-form SET search_path = "" (R70)');
select ok(
  (select not p.proisstrict
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_auction_reserve'),
  '…and is NOT STRICT — the property §A''s NULL pin depends on, asserted at the catalog so a future STRICT is caught here too');
select ok(
  not has_function_privilege('anon', 'public.draft_auction_reserve(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_auction_reserve(jsonb)', 'EXECUTE'),
  '…and is REVOKEd from anon AND authenticated: it is a server derivation, and the room''s copy is the display-only TS mirror pinned to it by the D90 fixture');

select * from finish();
rollback;
