-- ============================================================================
-- Uncontestable nominations award instantly — migration 093 (task AP.2; spec
-- v2.13 **§8.6.9** + §8.6.1/§8.6.7(a)(b)(c)(d)/§8.6.8, §12.3, §16.5.4,
-- E67/E68; D199; tasks-AP §4 rules 1–11). pgTAP file is **041** (040 = the
-- reserve toggle; next free confirmed at task time with `ls supabase/tests/`).
--
-- CHRIS'S RULINGS THIS FILE EXISTS TO PIN (2026-08-20):
--   "at the end of an auction draft, a nomination might work as an instant
--    pick because no other teams have enough money, so the nomination is
--    instantly awarded."
--   "I might have $8, everyone else has $7 or less, if I only have two roster
--    spots left and there is one player I really want. I might nominate a
--    player for $7, knowing no one else can add $1 bid."
--   "No you've misunderstood. It awards the player immediately and then
--    displays that message for 3 seconds until the next nomination."
--   "it should apply no matter where it happens in the draft"
--
-- Falsifiability notes (§4.3 — every section names the defect it catches; the
-- shipped break probes are in the PR):
--   * §A FORM + THE NAMED INCREMENT: both new functions' volatility,
--     `search_path` and REVOKEs; the argument guards that keep a NULL answer
--     from silently opening a clock nobody can enter; the R381-form structural
--     pin that the predicate compares `p_high_bid + c_bid_increment` and NOT
--     `> p_high_bid` (§8.6.9's first bullet — the two agree only while the
--     increment is 1, which is why probe A moves it); and the pin that NO
--     endgame condition exists anywhere in the predicate or the three
--     nomination bodies (Chris: "no matter where it happens").
--   * §B CHRIS'S WORKED EXAMPLE, AS A FIXTURE, AND ITS ONE-DOLLAR PAIR: $8
--     against $7-or-less over two open spots, nominated at $7 — the predicate
--     is TRUE, and it stays TRUE with a rival at max_bid EXACTLY 7 and turns
--     FALSE at EXACTLY 8. That pair is the whole rule; a `> high_bid` form
--     answers the second one wrong the moment the increment moves.
--   * §C E27 IS FREE, AND THE MONEY TEST IS WHAT DOES IT (D199(2)): a
--     complete roster holding $98 reads max_bid 0 as a STORED LITERAL and
--     therefore cannot contest; give it one slot back and it contests at $99.
--     The `open_slots >= 1` term in the predicate is documentation, and this
--     section is the proof that correctness does not rest on it.
--   * §D BOTH TOGGLE COLUMNS, ON ONE BOARD, ONE VARIABLE (E68): the same $1
--     nomination on the same broke league is UNCONTESTABLE with
--     `auction_zero_dollar_nominations` OFF (reserve 1 ⇒ rivals' max_bid 1)
--     and CONTESTED with it ON (reserve 0 ⇒ rivals' max_bid 2). Plus
--     §8.6.7(d)'s literal $1-max-bid team, which CAN contest a $0 opening and
--     CANNOT contest a $1 one — the one-dollar pair inside the ON column.
--   * §E IT APPLIES ANYWHERE: the same predicate, TRUE at nomination 1 of a
--     board with every roster empty. A diff that gated the rule on
--     rounds-remaining reddens here and nowhere else.
--   * §F ALL THREE NOMINATION PATHS: `draft_nominate` (human, §B),
--     `draft_system_nominate_internal` through the tick's §8.6.2 timeout, and
--     `draft_force_pick`'s commissioner force-nomination — the path tasks-AP
--     §AP.2 item 3 did not list (banner item 5 / D214(1)'s precedent).
--   * §G ONE TRANSACTION, ONE AWARD (banner item 4): the award is already
--     durable when the RPC returns and NO bid window ever existed (the
--     deadline that comes back is the NOMINATION clock); E2 replay returns
--     the ORIGINAL row and writes no second pick; `draft_place_bid` finds
--     nothing to bid on; and the extracted award refuses outright when called
--     outside the bidding phase, with its exact message.
--   * §H THE WIRE (D199(4)/D134): the nomination emits TWO `drafts` events in
--     one commit — the first carrying `"uncontested": true` and a NULL
--     deadline, the second the awarded board — plus one `draft_picks` INSERT.
--     And the key NEVER COMES TO REST: the stored row's `current_nomination`
--     is NULL, which is what makes §16.5.4's "a reconnect cannot lose the
--     award" and "never show it twice" true by construction.
--   * §I THE CONTESTED PATH IS UNCHANGED: a contested nomination on the same
--     board writes EXACTLY 065:121's three printed keys — no `uncontested`
--     key — and opens the bid clock. The discriminator between "the rule
--     fires when it should" and "the rule fires always".
--
-- Conventions: fixtures in the postgres role BEFORE any JWT claims (D49(7));
-- goldens are stored literals (§4.3); the whole file rolls back.
-- ============================================================================
begin;
select plan(61);

-- ---------------------------------------------------------------------------
-- A. Form pins + the named increment + the absence of an endgame condition
-- ---------------------------------------------------------------------------
select has_function('public', 'draft_nomination_uncontestable',
  array['uuid', 'uuid', 'integer'],
  'draft_nomination_uncontestable(uuid, uuid, integer) exists (§8.6.9''s predicate — 093 item 2)');
select has_function('public', 'draft_award_nomination_internal', array['uuid'],
  'draft_award_nomination_internal(uuid) exists (ARM 2.6(b), extracted — 093 item 1)');
select is(
  (select p.provolatile::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_nomination_uncontestable'),
  's',
  'the predicate is STABLE — it reads the CURRENT statement''s snapshot, so a nomination body''s own writes are visible to it (the award''s rotation scan already depends on that)');
select ok(
  (select bool_and(array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('draft_nomination_uncontestable', 'draft_award_nomination_internal')),
  'both new functions pin search_path = '''' (§4.1)');
select ok(
  not has_function_privilege('authenticated',
    'public.draft_nomination_uncontestable(uuid,uuid,integer)', 'EXECUTE')
  and not has_function_privilege('anon',
    'public.draft_nomination_uncontestable(uuid,uuid,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated',
    'public.draft_award_nomination_internal(uuid)', 'EXECUTE')
  and not has_function_privilege('anon',
    'public.draft_award_nomination_internal(uuid)', 'EXECUTE'),
  'both are REVOKEd from anon AND authenticated — the SERVER decides an award and a client never asks (§4.1; tasks-AP §4 rule 11)');

-- THE NAMED INCREMENT (§8.6.9's first bullet; D199(1)), pinned at the source
-- in the R381 form — the CALL/expression, never a comment mention. A body
-- that regressed to `b.max_bid > p_high_bid` reddens here.
select ok(
  (select p.prosrc like '%c_bid_increment CONSTANT INTEGER := 1%'
      and p.prosrc like '%p_high_bid + c_bid_increment%'
      and p.prosrc not like '%max_bid > p_high_bid%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_nomination_uncontestable'),
  'THE INCREMENT IS A NAMED CONSTANT compared as `p_high_bid + c_bid_increment` — never the loose `> p_high_bid` form, which is only accidentally right while the increment is $1 (§8.6.9)');

-- NO ENDGAME CONDITION ANYWHERE (Chris: "no matter where it happens in the
-- draft"). The predicate never reads a round, and neither do the three
-- nomination bodies' uncontestable arms — measured over the shipped bodies.
select ok(
  (select p.prosrc not like '%current_round%'
      and p.prosrc not like '%total_rounds%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_nomination_uncontestable'),
  'the predicate reads NO round and NO roster capacity — §8.6.9 is not an endgame rule and there is no clause here that could make it one');

select throws_ok(
  $$ select public.draft_nomination_uncontestable(null, null, null) $$,
  '22023',
  'draft_nomination_uncontestable: draft, nominator and high bid are all required — an unknown answer would open a bid clock nobody can enter (§8.6.9)',
  'a NULL argument is LOUD, never a NULL answer — a NULL would fall to the contested branch and silently open an unenterable clock (CLAUDE.md''s "nothing happened means it worked")');
select throws_ok(
  $$ select public.draft_nomination_uncontestable(
       '00000000-0000-4000-8000-00000000dead', '00000000-0000-4000-8000-00000000beef', 1) $$,
  'P0002', 'draft_nomination_uncontestable: draft 00000000-0000-4000-8000-00000000dead not found',
  'an unknown draft is a 404-class P0002 (the 062/063 convention)');

-- ---------------------------------------------------------------------------
-- B. Fixtures + CHRIS'S WORKED EXAMPLE and its one-dollar pair
--
--    CH — "$8 vs $7 or less, two roster spots left, nominate at $7":
--    8 teams, total_rounds 2, auction_budget 7, toggle OFF (reserve $1).
--    t1 carries a +$1 commissioner adjustment ⇒ remaining 8, open 2,
--    max_bid 7 — he can spend his whole max bid on his own opening
--    (§8.6.7(a)). Every rival reads remaining 7, open 2, max_bid 6.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('8f000000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-uc' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       ('{"username": "uc_user_' || i || '"}')::jsonb, now(), now()
from generate_series(1, 2) i;

-- `team_count` is the catalog's number and must be one of 8/10/12/14/16
-- (leagues_team_count_check). It is metadata here: these drafts are hand-built
-- (034's posture), so the ENGINE's team set is the `teams` rows and the
-- `nomination_order` array, never this column (D96) — BR really has 4 seats
-- and CR really has 3.
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings)
values
  ('a9000000-0000-4000-8000-0000000000c1', '8f000000-0000-4000-8000-000000000001',
   'pgtap-uc-CH-chris', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'), '{}'),
  ('a9000000-0000-4000-8000-0000000000b2', '8f000000-0000-4000-8000-000000000001',
   'pgtap-uc-BR-broke', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'), '{}'),
  ('a9000000-0000-4000-8000-0000000000c3', '8f000000-0000-4000-8000-000000000001',
   'pgtap-uc-CR-complete', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'), '{}');

insert into teams (id, owner_id, name, league_id)
select ('c9000000-0000-4000-8000-00' || tag || lpad(i::text, 8, '0'))::uuid,
       '8f000000-0000-4000-8000-000000000001', 'pgtap-uc-' || tag || '-t' || i, lg
from (values ('c1', 'a9000000-0000-4000-8000-0000000000c1'::uuid, 8),
             ('b2', 'a9000000-0000-4000-8000-0000000000b2'::uuid, 4),
             ('c3', 'a9000000-0000-4000-8000-0000000000c3'::uuid, 3)) as f(tag, lg, n)
cross join lateral generate_series(1, f.n) i;

-- u1 holds t1 on every board and is the commissioner (the §F force path needs
-- one); u2 holds CH's t2 so the tick's §8.6.2 timeout arm has a seat that is
-- NOT a no-user seat to contrast with.
insert into league_members (league_id, user_id, team_id, role)
select lg, '8f000000-0000-4000-8000-000000000001',
       ('c9000000-0000-4000-8000-00' || tag || '00000001')::uuid, 'commissioner'
from (values ('c1', 'a9000000-0000-4000-8000-0000000000c1'::uuid),
             ('b2', 'a9000000-0000-4000-8000-0000000000b2'::uuid),
             ('c3', 'a9000000-0000-4000-8000-0000000000c3'::uuid)) as f(tag, lg);

insert into players (id, full_name, position, adp)
select 'pgtap-uc-p' || lpad(i::text, 2, '0'),
       'PgTap Uncontested ' || i,
       case when i % 3 = 0 then 'WR' else 'RB' end,
       i::numeric
from generate_series(1, 30) i;

insert into drafts (id, league_id, draft_type, status, is_mock, config, total_rounds,
                    nomination_order, on_clock_team_id, current_pick_number,
                    current_round, current_deadline, budget_adjustments, started_at)
values
  ('e9000000-0000-4000-8000-0000000000c1', 'a9000000-0000-4000-8000-0000000000c1',
   'auction', 'live', false,
   '{"auction_budget": 7, "auction_zero_dollar_nominations": false,
     "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
     "auction_anti_snipe_seconds": 10, "disconnect_grace_seconds": 30}', 2,
   (select jsonb_agg(('c9000000-0000-4000-8000-00c1' || lpad(i::text, 8, '0'))::text order by i)
    from generate_series(1, 8) i),
   'c9000000-0000-4000-8000-00c100000001', 1, 1, now() + interval '45 seconds',
   '{"c9000000-0000-4000-8000-00c100000001": 1}', now()),
  ('e9000000-0000-4000-8000-0000000000b2', 'a9000000-0000-4000-8000-0000000000b2',
   'auction', 'live', false,
   '{"auction_budget": 2, "auction_zero_dollar_nominations": false,
     "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
     "disconnect_grace_seconds": 30}', 2,
   (select jsonb_agg(('c9000000-0000-4000-8000-00b2' || lpad(i::text, 8, '0'))::text order by i)
    from generate_series(1, 4) i),
   'c9000000-0000-4000-8000-00b200000001', 1, 1, now() + interval '45 seconds',
   '{}', now()),
  ('e9000000-0000-4000-8000-0000000000c3', 'a9000000-0000-4000-8000-0000000000c3',
   'auction', 'live', false,
   '{"auction_budget": 100, "auction_zero_dollar_nominations": false,
     "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
     "disconnect_grace_seconds": 30}', 2,
   (select jsonb_agg(('c9000000-0000-4000-8000-00c3' || lpad(i::text, 8, '0'))::text order by i)
    from generate_series(1, 3) i),
   'c9000000-0000-4000-8000-00c300000001', 1, 1, now() + interval '45 seconds',
   '{}', now());

-- THE FIXTURE'S OWN NUMBERS, as stored literals — everything below reads off
-- these, so they are pinned rather than assumed.
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid
     from public.draft_team_budget('e9000000-0000-4000-8000-0000000000c1',
                                   'c9000000-0000-4000-8000-00c100000001') b $$,
  $$ values (8, 2, 7) $$,
  'CHRIS''S NOMINATOR, as he described him: $8 remaining, TWO open roster spots, max bid $7 (§8.6.1 — 8 − (2−1)×1)');
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid
     from public.draft_team_budget('e9000000-0000-4000-8000-0000000000c1',
                                   'c9000000-0000-4000-8000-00c100000002') b $$,
  $$ values (7, 2, 6) $$,
  '…and a rival exactly as he described: $7 remaining over two spots ⇒ max bid $6');
select ok(
  public.draft_nomination_uncontestable(
    'e9000000-0000-4000-8000-0000000000c1',
    'c9000000-0000-4000-8000-00c100000001', 7),
  'CHRIS''S CASE: nominating at $7 is UNCONTESTABLE — "knowing no one else can add $1 bid" (§8.6.9/E67)');
select ok(
  not public.draft_nomination_uncontestable(
    'e9000000-0000-4000-8000-0000000000c1',
    'c9000000-0000-4000-8000-00c100000001', 5),
  '…and the SAME board at a $5 opening is ORDINARY — rivals reach $6, so the rule is about the number, not about the board');

-- THE ONE-DOLLAR PAIR ON THE PREDICATE ITSELF (D146). A rival at max_bid
-- EXACTLY 7 cannot contest a $7 opening; at EXACTLY 8 it can.
update drafts set budget_adjustments = budget_adjustments
  || '{"c9000000-0000-4000-8000-00c100000003": 1}'
where id = 'e9000000-0000-4000-8000-0000000000c1';
select is(
  (select b.max_bid from public.draft_team_budget(
     'e9000000-0000-4000-8000-0000000000c1', 'c9000000-0000-4000-8000-00c100000003') b),
  7,
  'BOUNDARY SETUP: t3 is lifted to max_bid EXACTLY $7 — the standing high bid itself');
select ok(
  public.draft_nomination_uncontestable(
    'e9000000-0000-4000-8000-0000000000c1',
    'c9000000-0000-4000-8000-00c100000001', 7),
  'ONE DOLLAR SHORT: a rival that can match $7 exactly still cannot RAISE it — the bid increment is $1 and 7 < 7 + 1, so the nomination stays uncontestable (§8.6.3/§8.6.9)');
update drafts set budget_adjustments = budget_adjustments
  || '{"c9000000-0000-4000-8000-00c100000003": 2}'
where id = 'e9000000-0000-4000-8000-0000000000c1';
select is(
  (select b.max_bid from public.draft_team_budget(
     'e9000000-0000-4000-8000-0000000000c1', 'c9000000-0000-4000-8000-00c100000003') b),
  8,
  'BOUNDARY SETUP, one dollar up: t3 reads max_bid EXACTLY $8 = high_bid + increment');
select ok(
  not public.draft_nomination_uncontestable(
    'e9000000-0000-4000-8000-0000000000c1',
    'c9000000-0000-4000-8000-00c100000001', 7),
  'ONE DOLLAR OVER: a rival that can reach EXACTLY $8 makes it an ORDINARY nomination — this is the assertion a `> high_bid` predicate gets wrong the moment the increment moves (§8.6.9)');
-- Back to Chris's board for the end-to-end run.
update drafts set budget_adjustments = '{"c9000000-0000-4000-8000-00c100000001": 1}'
where id = 'e9000000-0000-4000-8000-0000000000c1';

-- ---------------------------------------------------------------------------
-- C. E27 IS FREE, AND THE MONEY TEST IS WHAT DOES IT (D199(2))
--    CR: 3 teams, 2 slots, $100 each. t2 and t3 are FULL (two picks at $1),
--    so they hold $98 and cannot bid a cent of it.
-- ---------------------------------------------------------------------------
insert into draft_picks (draft_id, league_id, pick_number, round, team_id, player_id,
                         price, is_auto, made_via)
values
  ('e9000000-0000-4000-8000-0000000000c3', 'a9000000-0000-4000-8000-0000000000c3',
   1, null, 'c9000000-0000-4000-8000-00c300000002', 'pgtap-uc-p21', 1, false, 'manager'),
  ('e9000000-0000-4000-8000-0000000000c3', 'a9000000-0000-4000-8000-0000000000c3',
   2, null, 'c9000000-0000-4000-8000-00c300000002', 'pgtap-uc-p22', 1, false, 'manager'),
  ('e9000000-0000-4000-8000-0000000000c3', 'a9000000-0000-4000-8000-0000000000c3',
   3, null, 'c9000000-0000-4000-8000-00c300000003', 'pgtap-uc-p23', 1, false, 'manager'),
  ('e9000000-0000-4000-8000-0000000000c3', 'a9000000-0000-4000-8000-0000000000c3',
   4, null, 'c9000000-0000-4000-8000-00c300000003', 'pgtap-uc-p24', 1, false, 'manager');
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid
     from public.draft_team_budget('e9000000-0000-4000-8000-0000000000c3',
                                   'c9000000-0000-4000-8000-00c300000002') b $$,
  $$ values (98, 0, 0) $$,
  'E27 AS A STORED LITERAL: a COMPLETE roster holding $98 reads max_bid 0 — §8.6.1''s one special case, and the reason §8.6.9 needs no capacity clause of its own (D199(2))');
select ok(
  public.draft_nomination_uncontestable(
    'e9000000-0000-4000-8000-0000000000c3',
    'c9000000-0000-4000-8000-00c300000001', 50),
  'so a $50 nomination is UNCONTESTABLE in a room holding $196 of unspendable money — the MONEY test excludes the full rosters, exactly as the correctness argument claims (E27/§8.6.7(c))');
update draft_picks set is_undone = true
where draft_id = 'e9000000-0000-4000-8000-0000000000c3' and player_id = 'pgtap-uc-p24';
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid
     from public.draft_team_budget('e9000000-0000-4000-8000-0000000000c3',
                                   'c9000000-0000-4000-8000-00c300000003') b $$,
  $$ values (99, 1, 99) $$,
  'ONE SLOT BACK (D131 — an undone pick refunds by derivation): the same team reads open 1 / max_bid 99');
select ok(
  not public.draft_nomination_uncontestable(
    'e9000000-0000-4000-8000-0000000000c3',
    'c9000000-0000-4000-8000-00c300000001', 50),
  '…and the same $50 nomination becomes ORDINARY — capacity moved, and it moved through max_bid, which is the whole point');
update draft_picks set is_undone = false
where draft_id = 'e9000000-0000-4000-8000-0000000000c3' and player_id = 'pgtap-uc-p24';

-- ---------------------------------------------------------------------------
-- D. BOTH TOGGLE COLUMNS, ON ONE BOARD, ONE VARIABLE (E68)
--    BR: 4 teams, 2 slots, $2 each. OFF ⇒ reserve 1 ⇒ max_bid 1 all round.
--    ON  ⇒ reserve 0 ⇒ max_bid 2 all round.
-- ---------------------------------------------------------------------------
select is(
  (select b.max_bid from public.draft_team_budget(
     'e9000000-0000-4000-8000-0000000000b2', 'c9000000-0000-4000-8000-00b200000002') b),
  1,
  'TOGGLE OFF: a $2 purse over two open spots reads max_bid $1 — §8.6.7(d)''s "$1 max bid" team, literally');
select ok(
  public.draft_nomination_uncontestable(
    'e9000000-0000-4000-8000-0000000000b2',
    'c9000000-0000-4000-8000-00b200000001', 1),
  'TOGGLE OFF: a $1 nomination is UNCONTESTABLE — every rival tops out at $1 and $1 < $2');
update drafts set config = config || '{"auction_zero_dollar_nominations": true}'
where id = 'e9000000-0000-4000-8000-0000000000b2';
select is(
  (select b.max_bid from public.draft_team_budget(
     'e9000000-0000-4000-8000-0000000000b2', 'c9000000-0000-4000-8000-00b200000002') b),
  2,
  'TOGGLE ON, SAME BOARD, ONE VARIABLE: the reserve term vanishes and the same purse reads max_bid $2 (§8.6.1/E68)');
select ok(
  not public.draft_nomination_uncontestable(
    'e9000000-0000-4000-8000-0000000000b2',
    'c9000000-0000-4000-8000-00b200000001', 1),
  'TOGGLE ON: the IDENTICAL $1 nomination is now CONTESTED — with $0 nominations on, more teams can afford a bid and FEWER nominations are uncontestable. The toggle''s effect on §8.6.9 is real and it is this.');
-- §8.6.7(d)'s $1-max-bid team INSIDE the ON column, one dollar either side.
update drafts set budget_adjustments = '{"c9000000-0000-4000-8000-00b200000002": -1}'
where id = 'e9000000-0000-4000-8000-0000000000b2';
update drafts set budget_adjustments = budget_adjustments
  || '{"c9000000-0000-4000-8000-00b200000003": -2, "c9000000-0000-4000-8000-00b200000004": -2}'
where id = 'e9000000-0000-4000-8000-0000000000b2';
select is(
  (select b.max_bid from public.draft_team_budget(
     'e9000000-0000-4000-8000-0000000000b2', 'c9000000-0000-4000-8000-00b200000002') b),
  1,
  'TOGGLE ON: a team down to $1 reads max_bid $1 (reserve 0 ⇒ max_bid = remaining) — §8.6.7(d) in the ON column');
select ok(
  not public.draft_nomination_uncontestable(
    'e9000000-0000-4000-8000-0000000000b2',
    'c9000000-0000-4000-8000-00b200000001', 0),
  'a $0 OPENING is CONTESTED by that $1 team — it can reach 0 + 1 exactly, which is the §8.6.7(d) case E67''s negative control names');
select ok(
  public.draft_nomination_uncontestable(
    'e9000000-0000-4000-8000-0000000000b2',
    'c9000000-0000-4000-8000-00b200000001', 1),
  '…and ONE DOLLAR UP the same $1 team cannot reach $2, so the $1 opening is uncontestable — the increment is $1 in BOTH columns (§8.6.3/E68)');
-- Restore BR to the OFF column for §F's force-nomination run.
update drafts set config = config || '{"auction_zero_dollar_nominations": false}',
                  budget_adjustments = '{}'
where id = 'e9000000-0000-4000-8000-0000000000b2';

-- ---------------------------------------------------------------------------
-- E. IT APPLIES ANYWHERE (Chris: "no matter where it happens in the draft")
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from draft_picks
   where draft_id = 'e9000000-0000-4000-8000-0000000000c1'),
  0,
  'CH is at nomination 1 with EVERY roster empty and no pick on the board — the least endgame-like state an auction has');
select ok(
  public.draft_nomination_uncontestable(
    'e9000000-0000-4000-8000-0000000000c1',
    'c9000000-0000-4000-8000-00c100000001', 7),
  '…and the rule fires there anyway. It is a rule about MONEY, not about how far along the draft is (§8.6.9 third bullet).');

-- ---------------------------------------------------------------------------
-- F. THE THREE NOMINATION PATHS
--    (1) draft_nominate — the human path, on Chris's own board.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (public.draft_nominate('e9000000-0000-4000-8000-0000000000c1',
     'pgtap-uc-p01', 7, 'a9000000-0000-4000-8000-00000000000f')
   #> '{draft,current_nomination}'),
  'null'::jsonb,
  'CHRIS''S CASE, END TO END: draft_nominate at $7 returns a board with NO live nomination — the award already happened inside the call (§8.6.9/E67)');
reset role;
select results_eq(
  $$ select pick_number, round, team_id, player_id, price, is_auto, made_via
     from draft_picks where draft_id = 'e9000000-0000-4000-8000-0000000000c1' $$,
  $$ values (1, null::integer, 'c9000000-0000-4000-8000-00c100000001'::uuid,
             'pgtap-uc-p01', 7, false, 'manager') $$,
  '…and the board carries the ORDINARY award row: §12.4''s auction shape, priced at the opening bid, attributed to the manager who nominated (D130 — no second kind of award)');
select results_eq(
  $$ select nomination_seq, player_id, team_id, amount
     from draft_bids where draft_id = 'e9000000-0000-4000-8000-0000000000c1' $$,
  $$ values (1, 'pgtap-uc-p01', 'c9000000-0000-4000-8000-00c100000001'::uuid, 7) $$,
  '…and the opening bid is STILL a draft_bids row (F62/§12.5''s one uniform history) — the award''s attribution lookup reads it');
select is(
  (select on_clock_team_id::text || '|' || current_pick_number::text
   from drafts where id = 'e9000000-0000-4000-8000-0000000000c1'),
  'c9000000-0000-4000-8000-00c100000002|2',
  '…and the rotation ADVANCED to t2 at sequence 2 (§8.6.7(c)) — the same advance a bid-clock expiry performs');
select is(
  (select current_deadline from drafts where id = 'e9000000-0000-4000-8000-0000000000c1'),
  now() + interval '45 seconds',
  'NO BID WINDOW EVER EXISTED: the deadline that comes back is the 45s NOMINATION clock, not the 30s bid clock (E67 — "no bid clock is ever opened")');
select is(
  (select current_nomination from drafts where id = 'e9000000-0000-4000-8000-0000000000c1'),
  null::jsonb,
  'and the `uncontested` key NEVER COMES TO REST — the stored row is back in the nominating phase, which is what makes a reconnect during the room''s 3-second beat unable to lose the award (§16.5.4)');

--    (2) draft_force_pick — the COMMISSIONER force-nomination (087/R301), the
--    third live nomination path and the one tasks-AP §AP.2 item 3 did not
--    list. BR is the broke board: floor $1, every rival capped at $1.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (public.draft_force_pick('e9000000-0000-4000-8000-0000000000b2',
     'pgtap-uc-p11', 'a9000000-0000-4000-8000-0000000000f2', 'pgtap force')
   #> '{draft,current_nomination}'),
  'null'::jsonb,
  'THE COMMISSIONER PATH: a force-nomination nobody can answer is awarded in the same call — §8.6.9 is a rule about NOMINATIONS, with no qualifier on who opened one (banner item 5)');
reset role;
select results_eq(
  $$ select pick_number, team_id, player_id, price, is_auto, made_via
     from draft_picks where draft_id = 'e9000000-0000-4000-8000-0000000000b2' $$,
  $$ values (1, 'c9000000-0000-4000-8000-00b200000001'::uuid, 'pgtap-uc-p11', 1, false, 'manager') $$,
  '…the ordinary award row again, at the $1 nomination floor, attributed as a HUMAN act (D160(3) — the commissioner''s minted action_id keeps it off ''autopick'')');
select is(
  (select count(*)::int from league_chat
   where context = 'draft:e9000000-0000-4000-8000-0000000000b2'
     and is_system and message like 'Nomination 1 made by commissioner%at $1.'),
  1,
  '…and 087''s system chat line still names NOMINATION 1 — it is written before the award so the sentence cannot be silently renumbered by the rotation advance (D157(2))');

--    (3) draft_system_nominate_internal — the §8.6.2 timeout, through the tick.
--    The force award above advanced BR's rotation to t2, which has NO
--    league_members row: E48's no-user seat, system-nominated AT the deadline
--    with no grace hold (D129(3)). Every seat on this board is still capped at
--    $1, so the opening the system writes at the $1 floor is uncontestable too.
select is(
  (select on_clock_team_id::text || '|' || current_pick_number::text
   from drafts where id = 'e9000000-0000-4000-8000-0000000000b2'),
  'c9000000-0000-4000-8000-00b200000002|2',
  'TIMEOUT SETUP: the force award advanced BR to t2 at sequence 2 — an E48 no-user seat');
update drafts set current_deadline = now() - interval '1 second'
where id = 'e9000000-0000-4000-8000-0000000000b2';
-- MEASURED, and worth stating precisely rather than rounding to "it works":
-- the tick reports auction_nominated 1 and auction_awarded **0**. Both numbers
-- are correct and the pair IS the point. ARM 2.6(a) counts the nomination it
-- opened; ARM 2.6(b) counts the clocks it CLOSED, and this sweep closed none —
-- the award happened inside draft_system_nominate_internal, in the same
-- transaction, so the sweep never had to come back for it. A design that
-- deferred the award to the tick would show the mirror image.
select is(
  (select (t.j->>'auction_nominated') || '|' || (t.j->>'auction_awarded')
   from (select public.draft_tick() as j) t),
  '1|0',
  'THE TIMEOUT PATH: one sweep NOMINATES once (auction_nominated 1) and CLOSES no clock (auction_awarded 0) — because the award it produced landed inside the nomination itself (§8.6.2 + §8.6.9)');
select is(
  (select count(*)::int from draft_picks
   where draft_id = 'e9000000-0000-4000-8000-0000000000b2' and is_undone = false),
  2,
  '…and the board has a SECOND ordinary award row — draft_system_nominate_internal takes the identical arm draft_nominate does (one rule, every nomination path)');
select is(
  (select current_nomination from drafts where id = 'e9000000-0000-4000-8000-0000000000b2'),
  null::jsonb,
  '…leaving no live nomination behind: the system nomination opened no clock either');

-- ---------------------------------------------------------------------------
-- G. ONE TRANSACTION, ONE AWARD (banner item 4 — what stands, and why)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (public.draft_nominate('e9000000-0000-4000-8000-0000000000c1',
     'pgtap-uc-p01', 7, 'a9000000-0000-4000-8000-00000000000f')
   #>> '{bid,player_id}'),
  'pgtap-uc-p01',
  'E2 REPLAY (§8.1/R125): the SAME action_id replayed returns the ORIGINAL opening-bid row, short-circuiting before the predicate ever runs');
reset role;
select is(
  (select count(*)::int from draft_picks
   where draft_id = 'e9000000-0000-4000-8000-0000000000c1' and player_id = 'pgtap-uc-p01'),
  1,
  '…and writes NO second pick — the award cannot fire twice, and the first thing that stops it is idempotency, not a bespoke guard');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_place_bid('e9000000-0000-4000-8000-0000000000b2', 2,
       'a9000000-0000-4000-8000-0000000000f3', 1, 'pgtap-uc-p11') $$,
  'P0001',
  'draft_place_bid: no player is up for bid right now — pgtap-uc-b2-t3 is on the clock to nominate (§8.6.2)',
  'A BID CAN NEVER MEET AN UNCONTESTABLE NOMINATION: by the time any caller can act, the market is closed and the rotation has moved on');
reset role;
select throws_ok(
  $$ select public.draft_award_nomination_internal('e9000000-0000-4000-8000-0000000000c1') $$,
  'draft_award_nomination_internal: called outside the bidding phase on draft e9000000-0000-4000-8000-0000000000c1',
  'the extracted award REFUSES outside the bidding phase — LOUD, never a silent no-op (CLAUDE.md), which is also why a second award of the same nomination is impossible');

-- ---------------------------------------------------------------------------
-- H. THE WIRE (D199(4)/D134): two `drafts` events in one commit, the first
--    carrying the announcement key and a NULL deadline.
-- ---------------------------------------------------------------------------
do $part$
declare d date; part_name text;
begin
  foreach d in array array[current_date, current_date + 1] loop
    part_name := 'messages_' || to_char(d, 'YYYY_MM_DD');
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'realtime' and c.relname = part_name) then
      execute format(
        'create table realtime.%I partition of realtime.messages for values from (%L) to (%L)',
        part_name, d::timestamp, (d + 1)::timestamp);
    end if;
  end loop;
end
$part$;
delete from realtime.messages
where topic = 'draft:e9000000-0000-4000-8000-0000000000c3';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_nominate('e9000000-0000-4000-8000-0000000000c3',
       'pgtap-uc-p05', 50, 'a9000000-0000-4000-8000-0000000000f5') $$,
  'CR: t1 nominates at $50 into a room of full rosters — uncontestable (§C''s board)');
reset role;
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:e9000000-0000-4000-8000-0000000000c3' and m.event = 'drafts'),
  2::bigint,
  'THE WIRE: EXACTLY TWO `drafts` events in the one commit — the nomination''s own phase flip and the award-and-advance (070''s AFTER UPDATE FOR EACH ROW trigger; no new event name, no new topic)');
-- MEASURED, and it changes what can be asserted: both rows carry the SAME
-- `inserted_at` (the transaction timestamp) and `id` is a random uuid, so
-- realtime.messages exposes NO ordering key for two events written in one
-- commit. The claim is therefore set membership, not a sequence — and under
-- Chris's ruling that is exactly right: the award is already committed, so a
-- client that processes the two payloads in either order paints the same
-- board and shows the same message. The room's beat depends on SEEING the
-- key, never on seeing it first.
select is(
  (select m.payload->'record'->'current_nomination' from realtime.messages m
   where m.topic = 'draft:e9000000-0000-4000-8000-0000000000c3' and m.event = 'drafts'
     and m.payload->'record'->'current_nomination' ? 'uncontested'),
  jsonb_build_object(
    'player_id', 'pgtap-uc-p05',
    'high_bid', 50,
    'high_bidder_team_id', 'c9000000-0000-4000-8000-00c300000001',
    'uncontested', true),
  'ONE of the two carries 065:121''s three printed keys PLUS the additive `"uncontested": true` — the room''s only signal that the award beside it wants §16.5.4''s message (D134 puts current_nomination on the wire whole, so this costs no new column)');
select is(
  (select m.payload->'record'->>'current_deadline' from realtime.messages m
   where m.topic = 'draft:e9000000-0000-4000-8000-0000000000c3' and m.event = 'drafts'
     and m.payload->'record'->'current_nomination' ? 'uncontested'),
  null,
  '…with a NULL deadline: E67''s "no bid clock is ever opened", made true ON THE WIRE and not only in the row (a deadline here is a countdown the room would render)');
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:e9000000-0000-4000-8000-0000000000c3' and m.event = 'drafts'
     and m.payload->'record'->'current_nomination' = 'null'::jsonb),
  1::bigint,
  '…and the OTHER is the awarded board — `current_nomination` null, the rotation advanced');
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:e9000000-0000-4000-8000-0000000000c3'
     and m.event = 'draft_picks' and m.payload->>'operation' = 'INSERT'),
  1::bigint,
  '…plus the ORDINARY `draft_picks` INSERT event (088/D134 — the award''s own realtime event is unchanged, because the award is unchanged)');

-- ---------------------------------------------------------------------------
-- I. THE CONTESTED PATH IS UNCHANGED (the discriminator)
-- ---------------------------------------------------------------------------
update draft_picks set is_undone = true
where draft_id = 'e9000000-0000-4000-8000-0000000000c3' and player_id = 'pgtap-uc-p24';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_nominate('e9000000-0000-4000-8000-0000000000c3',
       'pgtap-uc-p06', 50, 'a9000000-0000-4000-8000-0000000000f6') $$,
  'CR with one rival slot re-opened: the same $50 nomination is now CONTESTED');
reset role;
select is(
  (select current_nomination from drafts where id = 'e9000000-0000-4000-8000-0000000000c3'),
  jsonb_build_object(
    'player_id', 'pgtap-uc-p06',
    'high_bid', 50,
    'high_bidder_team_id', 'c9000000-0000-4000-8000-00c300000001'),
  'THE CONTESTED PATH IS BYTE-IDENTICAL TO 092: EXACTLY 065:121''s three printed keys and NO `uncontested` key — the rule fires when it should, not always (D126/§12.3)');
select is(
  (select current_deadline from drafts where id = 'e9000000-0000-4000-8000-0000000000c3'),
  now() + interval '30 seconds',
  '…and the 30s BID clock opens, exactly as it did before this migration (D128)');

-- ---------------------------------------------------------------------------
-- J. §8.8 ISOLATION ON THE NEW ROUTE (R467) — `draft_complete_internal` is now
--    reachable from inside a HUMAN `draft_nominate`, where before this
--    migration only the tick and `draft_end` could reach it. 038 §F already
--    runs the R383 composite over a completed mock auction, but it reaches
--    completion through the TICK. A guard that is newly load-bearing on an
--    uncovered path is how the next change breaks isolation silently, so the
--    composite is re-run HERE, over the path AP.2 created.
--
--    MK: a 3-seat MOCK auction, two slots each, one nomination from done —
--    t2 and t3 full (so the nomination is uncontestable for free, E27) and the
--    launcher's t1 holding the last open slot. Its award completes the board
--    inside `draft_nominate`.
-- ---------------------------------------------------------------------------
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings)
values
  ('a9000000-0000-4000-8000-0000000000ac', '8f000000-0000-4000-8000-000000000001',
   'pgtap-uc-AC-mockiso', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'), '{}');
insert into teams (id, owner_id, name, league_id)
select ('c9000000-0000-4000-8000-00ac' || lpad(i::text, 8, '0'))::uuid,
       '8f000000-0000-4000-8000-000000000001', 'pgtap-uc-ac-t' || i,
       'a9000000-0000-4000-8000-0000000000ac'
from generate_series(1, 3) i;
insert into league_members (league_id, user_id, team_id, role) values
  ('a9000000-0000-4000-8000-0000000000ac', '8f000000-0000-4000-8000-000000000001',
   'c9000000-0000-4000-8000-00ac00000001', 'commissioner');
insert into drafts (id, league_id, draft_type, status, is_mock, config, total_rounds,
                    nomination_order, on_clock_team_id, current_pick_number,
                    current_round, current_deadline, started_at)
values
  ('e9000000-0000-4000-8000-0000000000ac', 'a9000000-0000-4000-8000-0000000000ac',
   'auction', 'live', true,
   jsonb_build_object(
     'auction_budget', 100, 'auction_zero_dollar_nominations', false,
     'auction_nomination_seconds', 45, 'auction_bid_seconds', 30,
     'mock', jsonb_build_object(
       'launched_by', '8f000000-0000-4000-8000-000000000001',
       'human_team_id', 'c9000000-0000-4000-8000-00ac00000001')), 2,
   (select jsonb_agg(('c9000000-0000-4000-8000-00ac' || lpad(i::text, 8, '0'))::text order by i)
    from generate_series(1, 3) i),
   'c9000000-0000-4000-8000-00ac00000001', 6, 1, now() + interval '45 seconds', now());
insert into draft_picks (draft_id, league_id, pick_number, round, team_id, player_id,
                         price, is_auto, made_via)
values
  ('e9000000-0000-4000-8000-0000000000ac', 'a9000000-0000-4000-8000-0000000000ac',
   1, null, 'c9000000-0000-4000-8000-00ac00000001', 'pgtap-uc-p25', 1, false, 'manager'),
  ('e9000000-0000-4000-8000-0000000000ac', 'a9000000-0000-4000-8000-0000000000ac',
   2, null, 'c9000000-0000-4000-8000-00ac00000002', 'pgtap-uc-p26', 1, false, 'manager'),
  ('e9000000-0000-4000-8000-0000000000ac', 'a9000000-0000-4000-8000-0000000000ac',
   3, null, 'c9000000-0000-4000-8000-00ac00000002', 'pgtap-uc-p27', 1, false, 'manager'),
  ('e9000000-0000-4000-8000-0000000000ac', 'a9000000-0000-4000-8000-0000000000ac',
   4, null, 'c9000000-0000-4000-8000-00ac00000003', 'pgtap-uc-p28', 1, false, 'manager'),
  ('e9000000-0000-4000-8000-0000000000ac', 'a9000000-0000-4000-8000-0000000000ac',
   5, null, 'c9000000-0000-4000-8000-00ac00000003', 'pgtap-uc-p29', 1, false, 'manager');

-- THE BEFORE SNAPSHOT (038 §F's `ma_before` idiom).
create temporary table uc_ac_before on commit drop as
select (select to_jsonb(l) from leagues l
        where l.id = 'a9000000-0000-4000-8000-0000000000ac')          as league_row,
       (select count(*) from league_members
        where league_id = 'a9000000-0000-4000-8000-0000000000ac')      as members,
       (select count(*) from teams
        where league_id = 'a9000000-0000-4000-8000-0000000000ac')      as teams,
       (select count(*) from league_rosters
        where league_id = 'a9000000-0000-4000-8000-0000000000ac')      as rosters,
       (select count(*) from league_weeks
        where league_id = 'a9000000-0000-4000-8000-0000000000ac')      as weeks,
       (select count(*) from notifications where user_id in
        (select user_id from league_members
         where league_id = 'a9000000-0000-4000-8000-0000000000ac'))    as notifs;

select ok(
  public.draft_nomination_uncontestable(
    'e9000000-0000-4000-8000-0000000000ac',
    'c9000000-0000-4000-8000-00ac00000001', 5),
  'MK: the last nomination is uncontestable — both rivals are FULL, so E27 gives them max_bid 0 for free');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8f000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (public.draft_nominate('e9000000-0000-4000-8000-0000000000ac',
     'pgtap-uc-p30', 5, 'a9000000-0000-4000-8000-0000000000fa')
   #>> '{draft,status}'),
  'complete',
  'THE NEW ROUTE: a HUMAN nomination reaches draft_complete_internal — the award lands, the rotation finds nobody, and the board completes INSIDE draft_nominate (before 093 only the tick and draft_end could get here)');
reset role;
select is(
  (select count(*)::int from draft_picks
   where draft_id = 'e9000000-0000-4000-8000-0000000000ac' and is_undone = false),
  6,
  '…with the sixth and final pick on the board at its opening price');

-- THE COMPOSITE (R383/§8.8): a MOCK completing through the new route writes
-- NOTHING outside its own room. The completion writer's mock bypass (086) is
-- what holds this, and it had never been exercised from a human RPC.
select is(
  (select to_jsonb(l)::text from leagues l
   where l.id = 'a9000000-0000-4000-8000-0000000000ac')
  || '|' || (select count(*) from league_members
             where league_id = 'a9000000-0000-4000-8000-0000000000ac')
  || '/' || (select count(*) from teams
             where league_id = 'a9000000-0000-4000-8000-0000000000ac')
  || '/' || (select count(*) from league_rosters
             where league_id = 'a9000000-0000-4000-8000-0000000000ac')
  || '/' || (select count(*) from league_weeks
             where league_id = 'a9000000-0000-4000-8000-0000000000ac')
  || '/' || (select count(*) from notifications where user_id in
             (select user_id from league_members
              where league_id = 'a9000000-0000-4000-8000-0000000000ac')),
  (select league_row::text || '|' || members || '/' || teams || '/' || rosters
          || '/' || weeks || '/' || notifs
   from uc_ac_before),
  'ZERO SIDE EFFECTS (§8.8, the R383 composite) ON THE NEW ROUTE: the WHOLE leagues row (status — NO in_season transition; settings; updated_at) and every league-scoped count are byte-identical after a mock auction completed from inside a HUMAN draft_nominate');
select is(
  (select count(*)::int from league_rosters
   where league_id = 'a9000000-0000-4000-8000-0000000000ac'),
  0,
  '…and ZERO league_rosters — 086''s mock bypass in the completion writer held on a path that reached it for the first time (R467)');

select * from finish();
rollback;
