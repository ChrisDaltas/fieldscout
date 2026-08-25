-- ============================================================================
-- A STANDALONE PRACTICE AUCTION HAS BIDDING — migration 096, ledger **F121**
-- (spec §8.6.9 / §8.6.1 / §8.6.3; tasks-MP §4 rules 1-16; D137, D146,
-- D245(7) and its R523 correction). pgTAP file is **044** (043 = MP.3's
-- standalone mock; next free confirmed with `ls supabase/tests/`).
--
-- WHAT THIS FILE PINS, AND THE DEFECT EACH SECTION CATCHES (§4.3: a pin is
-- not a pin until it has been shown RED against the thing it claims to
-- catch; the RED run is in the PR body).
--
--   §A THE FIXTURE, AND ITS PREMISE. **TWO** standalone auction mocks, by
--      two different launchers, both minted through `create_mock_draft`.
--      The second one is not decoration: **a count taken on a database
--      holding exactly one standalone mock cannot distinguish a correctly-
--      scoped scan from an unscoped one** (D245(7)), so the fixture is
--      asserted to CONTAIN the thing the scope is supposed to exclude —
--      16 league-less `teams` rows, of which mock A's seat map names 8.
--      That premise is asserted, never assumed (F94).
--
--   §B THE STANDALONE PREDICATE. Chris's worked example replayed LEAGUE-
--      FREE ($8 nominator vs $7 rivals, two roster spots, nominate at $7),
--      its ordinary twin one dollar down, and the D146 one-dollar pair on
--      the predicate itself. **Reinstall 093's NULL-blind scan and every
--      "ORDINARY" assertion here goes RED** — under it the answer is `t`
--      whatever the board says, because `t.league_id = NULL` matches no
--      seat and `NOT EXISTS` over zero rows is TRUE.
--
--   §C THE TWO-MOCK DISCRIMINATOR — the section that makes §B falsifiable.
--      Mock B's seats are RICH (max_bid 199) and would contest every
--      opening in §B. They must be INVISIBLE to mock A's scan, and mock A's
--      seats equally invisible to B's. The ruled-wrong
--      `IS NOT DISTINCT FROM` widening fails this section TWICE OVER: it
--      admits 15 teams for an 8-seat mock (8 of them foreign — measured),
--      and `draft_team_budget` RAISES P0002 on the first foreign seat, so
--      the widened predicate ABORTS rather than answering. Both halves are
--      pinned: the answer, and the fact that asking is not an error.
--
--   §D THE LEAGUE ARM IS UNTOUCHED (§4 rule 11). The same boundary driven
--      on a real league's auction — the pins 041 owns, re-driven here so
--      "no diff is visible on a league draft" is a test rather than a
--      sentence — plus a STRUCTURAL pin that 093's `t.league_id =
--      v_league_id` scan is still in the body and no `IS NOT DISTINCT
--      FROM` ever entered it.
--
--   §E THE HEADLINE, END TO END. On a standalone auction: a nomination
--      with an affordable rival **opens a bid clock** (`current_nomination`
--      is NOT NULL and no pick row was written) — the F121 measurement
--      inverted — and the genuine uncontestable case **still instant-awards
--      standalone** (§8.6.9 keeps working; the fix restores bidding without
--      removing the award).
--
--   §F FORM AND GRANTS (§4.1 / D18->D23) after the CREATE OR REPLACE.
--
-- FIXTURE NOTE (D235/F110): every fixture ADP is in the fractional band
-- (0, 1) — 0.401…0.420 — strictly below the real pool's measured global
-- minimum, so a fixture player wins BY VALUE on a seeded machine and, being
-- the only players in play, on an empty one too. No assertion states a
-- premise about what the shared `players` table does NOT contain.
--
-- BUDGETS: §7.3.8 clamps `auction_budget` to 50-1000, so Chris's $7 board
-- is reached the way 041 reaches its boundaries — through
-- `budget_adjustments` (D127), which `draft_team_budget` reads on BOTH
-- arms. The resulting numbers are pinned as stored literals before anything
-- rests on them.
--
-- Conventions: fixtures in the postgres role BEFORE any JWT claims (D49(7));
-- goldens are stored literals (§4.3); the whole file rolls back.
-- ============================================================================
begin;
select plan(33);

-- ---------------------------------------------------------------------------
-- §A FIXTURE. u01 launches mock A, u02 launches mock B. Neither is in a
--    league; LZ exists only for §D's league arm.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('96100000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated',
  'pgtap-f121-' || lpad(i::text, 2, '0') || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  jsonb_build_object('username', 'pgtap_f121_user_' || lpad(i::text, 2, '0')),
  now(), now()
from generate_series(1, 3) i;

insert into players (id, full_name, position, adp)
select 'f121-rb' || lpad(i::text, 2, '0'), 'F121 RB ' || lpad(i::text, 2, '0'), 'RB',
       0.400 + i / 1000.0
from generate_series(1, 20) i;

-- MOCK A — u01. 8 seats, one RB starter + one bench => total_rounds 2.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "96100000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft(
       p_settings := '{"team_count": 8,
                       "roster_settings": {"starting_slots": [
                          {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                          "bench": 1, "ir_slots": [], "swap_spots": 0},
                       "draft": {"draft_type": "auction",
                                 "auction_budget": 50,
                                 "auction_zero_dollar_nominations": false,
                                 "auction_nomination_seconds": 30,
                                 "auction_bid_seconds": 20,
                                 "auction_anti_snipe_seconds": 10,
                                 "disconnect_grace_seconds": 30}}'::jsonb,
       p_cpu_speed := 'fast') $$,
  'MOCK A: a user in zero leagues launches a standalone AUCTION (095/MP.3)');
reset role;

-- MOCK B — u02. The seat set that MUST be invisible to A. Budget 200.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "96100000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft(
       p_settings := '{"team_count": 8,
                       "roster_settings": {"starting_slots": [
                          {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                          "bench": 1, "ir_slots": [], "swap_spots": 0},
                       "draft": {"draft_type": "auction",
                                 "auction_budget": 200,
                                 "auction_zero_dollar_nominations": false,
                                 "auction_nomination_seconds": 30,
                                 "auction_bid_seconds": 20,
                                 "auction_anti_snipe_seconds": 10,
                                 "disconnect_grace_seconds": 30}}'::jsonb,
       p_cpu_speed := 'fast') $$,
  'MOCK B: a SECOND standalone auction, a DIFFERENT launcher — the seat set §C proves invisible');
reset role;

create temp table f121_mocks as
select case when d.config->'mock'->>'launched_by' = '96100000-0000-4000-8000-000000000001'
            then 'A' else 'B' end as tag,
       d.id,
       (d.config->'mock'->>'human_team_id')::uuid as human,
       -- A seat that is NOT the nominator. Taken by NAME rather than by
       -- index: `draft_order` is a RANDOM permutation, so `->>1` is the
       -- human roughly one time in eight and the D146 pair below would then
       -- move the nominator instead of a rival — a boundary test that
       -- silently tests nothing (measured: it did, on the first run).
       (select s.seat::uuid
          from jsonb_array_elements_text(d.draft_order) as s(seat)
         where s.seat <> d.config->'mock'->>'human_team_id'
         limit 1) as rival
from drafts d
where d.is_mock and d.league_id is null
  and d.config->'mock'->>'launched_by' in
      ('96100000-0000-4000-8000-000000000001', '96100000-0000-4000-8000-000000000002');
grant select on f121_mocks to authenticated;

-- THE PREMISE §C rests on, asserted rather than assumed (F94 / D245(7)).
select is((select count(*) from f121_mocks), 2::bigint,
  'PREMISE: the fixture holds TWO standalone mocks. One is not enough — a count taken on a database holding exactly one cannot tell a correctly-scoped scan from an unscoped one (D245(7)/R523)');
select is(
  (select count(*) from teams t
    where t.league_id is null
      and t.owner_id in ('96100000-0000-4000-8000-000000000001',
                         '96100000-0000-4000-8000-000000000002')),
  16::bigint,
  '…16 league-less `teams` rows exist, 8 per mock — so a scan that ignores the mock boundary has EIGHT foreign seats available to be wrong with');
select is(
  (select jsonb_array_length(d.draft_order) from drafts d join f121_mocks m on m.id = d.id
    where m.tag = 'A'),
  8,
  '…and mock A''s OWN seat map names exactly 8 of them — the set 096''s standalone arm scans (`drafts.draft_order`, 095 banner item 4''s authority)');

-- Chris's board, league-free: nominator $8/2 spots/max $7, rivals $7/2/$6.
-- §7.3.8 clamps auction_budget to 50-1000, so the numbers are reached
-- through budget_adjustments (D127), exactly as 041 reaches its boundaries.
update drafts d
set budget_adjustments = (
      select jsonb_object_agg(s.seat,
               case when s.seat = m.human::text then -42 else -43 end)
      from jsonb_array_elements_text(d.draft_order) as s(seat))
from f121_mocks m
where d.id = m.id and m.tag = 'A';

-- ---------------------------------------------------------------------------
-- §B THE STANDALONE PREDICATE — CHRIS'S EXAMPLE, LEAGUE-FREE.
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid
       from f121_mocks m,
            lateral public.draft_team_budget(m.id, m.human) b
      where m.tag = 'A' $$,
  $$ values (8, 2, 7) $$,
  'CHRIS''S NOMINATOR, ON A DRAFT WITH NO LEAGUE: $8 remaining, TWO open roster spots, max bid $7 (§8.6.1). Before 096 this number was already right — it is the PREDICATE that could not see it');
select results_eq(
  $$ select distinct b.remaining, b.open_slots, b.max_bid
       from f121_mocks m,
            lateral jsonb_array_elements_text(
              (select d.draft_order from drafts d where d.id = m.id)) as s(seat),
            lateral public.draft_team_budget(m.id, s.seat::uuid) b
      where m.tag = 'A' and s.seat::uuid <> m.human $$,
  $$ values (7, 2, 6) $$,
  '…and every one of his SEVEN rivals reads $7 over two spots => max bid $6, as a stored literal');

select ok(
  (select public.draft_nomination_uncontestable(m.id, m.human, 7) from f121_mocks m where m.tag = 'A'),
  'CHRIS''S CASE, REPLAYED LEAGUE-FREE: nominating at $7 is UNCONTESTABLE — §8.6.9 still fires on a standalone mock, so the fix restores bidding WITHOUT removing the instant award');
select ok(
  NOT (select public.draft_nomination_uncontestable(m.id, m.human, 5) from f121_mocks m where m.tag = 'A'),
  'THE HEADLINE OF F121: the SAME board at a $5 opening is ORDINARY — seven rivals reach $6, so THE BID CLOCK OPENS. Under 093''s NULL-blind scan this answered `t` and the player was awarded instantly at $5 (measured before the fix)');

-- D146: one dollar either side of the affordability boundary, on the
-- STANDALONE arm. Seat #2 of the order is lifted to max_bid EXACTLY 7, then
-- EXACTLY 8, against a standing $7 opening.
update drafts d
set budget_adjustments = d.budget_adjustments
      || jsonb_build_object(m.rival::text, -42)
from f121_mocks m where d.id = m.id and m.tag = 'A';
select is(
  (select b.max_bid from f121_mocks m,
     lateral public.draft_team_budget(m.id, m.rival) b
    where m.tag = 'A'),
  7,
  'BOUNDARY SETUP (D146): one rival is lifted to max_bid EXACTLY $7 — the standing high bid itself');
select ok(
  (select public.draft_nomination_uncontestable(m.id, m.human, 7) from f121_mocks m where m.tag = 'A'),
  'ONE DOLLAR SHORT, STANDALONE: a rival that can MATCH $7 exactly still cannot RAISE it — the increment is the named $1 of §8.6.3, and 7 < 7 + 1. This is the assertion a `> high_bid` predicate gets wrong');
update drafts d
set budget_adjustments = d.budget_adjustments
      || jsonb_build_object(m.rival::text, -41)
from f121_mocks m where d.id = m.id and m.tag = 'A';
select is(
  (select b.max_bid from f121_mocks m,
     lateral public.draft_team_budget(m.id, m.rival) b
    where m.tag = 'A'),
  8,
  'BOUNDARY SETUP, one dollar up: the same rival reads max_bid EXACTLY $8 = high_bid + increment');
select ok(
  NOT (select public.draft_nomination_uncontestable(m.id, m.human, 7) from f121_mocks m where m.tag = 'A'),
  'ONE DOLLAR OVER, STANDALONE: a rival that reaches EXACTLY $8 makes it an ORDINARY nomination — the boundary is the rule, and it is the same rule on both arms');
-- Back to Chris's board.
update drafts d
set budget_adjustments = d.budget_adjustments
      || jsonb_build_object(m.rival::text, -43)
from f121_mocks m where d.id = m.id and m.tag = 'A';

-- ---------------------------------------------------------------------------
-- §C THE TWO-MOCK DISCRIMINATOR. Without this section §B is unfalsifiable:
--    a scan that saw EVERY standalone team in the database would pass every
--    assertion above on a machine that held only mock A.
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select distinct b.remaining, b.open_slots, b.max_bid
       from f121_mocks m,
            lateral jsonb_array_elements_text(
              (select d.draft_order from drafts d where d.id = m.id)) as s(seat),
            lateral public.draft_team_budget(m.id, s.seat::uuid) b
      where m.tag = 'B' $$,
  $$ values (200, 2, 199) $$,
  'MOCK B''S SEATS ARE RICH: $200 over two spots => max bid $199. Every one of them WOULD contest every opening in §B — which is exactly why they must be invisible');
select ok(
  (select public.draft_nomination_uncontestable(m.id, m.human, 7) from f121_mocks m where m.tag = 'A'),
  'THE DISCRIMINATOR: mock A''s $7 opening is STILL uncontestable with eight $199 seats sitting in the same table. A scan that ignored the mock boundary would answer `f` here');
select lives_ok(
  $$ select public.draft_nomination_uncontestable(m.id, m.human, 7) from f121_mocks m where m.tag = 'A' $$,
  '…and ASKING is not an error, which is the second half of the discriminator: the ruled-wrong `IS NOT DISTINCT FROM` widening admits 15 teams for this 8-seat mock (8 foreign, measured) and `draft_team_budget` RAISES P0002 on the first foreign seat, so it would ABORT the predicate rather than answer it (095 banner item 4)');
select ok(
  NOT (select public.draft_nomination_uncontestable(m.id, m.human, 7) from f121_mocks m where m.tag = 'B'),
  'AND IT READS EACH MOCK''S OWN SET, BOTH WAYS: the SAME $7 opening on mock B is ORDINARY, because B''s own rivals reach $199. A scan hard-wired to A''s seats would be wrong here in the other direction');

-- ---------------------------------------------------------------------------
-- §D THE LEAGUE ARM IS UNTOUCHED (§4 rule 11). 041 owns these pins; they are
--    re-driven here so "no diff is visible on a league draft" is measured
--    beside the standalone claim rather than argued from it.
-- ---------------------------------------------------------------------------
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings)
values ('bf000000-0000-4000-8000-0000000000f1', '96100000-0000-4000-8000-000000000003',
        'pgtap-f121-LZ', 2026, 'scheduled', 8,
        (select id from scoring_systems where is_template and name = 'ESPN Standard'), '{}');
insert into teams (id, owner_id, name, league_id)
select ('cf000000-0000-4000-8000-00f10000000' || i)::uuid,
       '96100000-0000-4000-8000-000000000003', 'pgtap-f121-lz-t' || i,
       'bf000000-0000-4000-8000-0000000000f1'
from generate_series(1, 8) i;
insert into league_members (league_id, user_id, team_id, role) values
  ('bf000000-0000-4000-8000-0000000000f1', '96100000-0000-4000-8000-000000000003',
   'cf000000-0000-4000-8000-00f100000001', 'commissioner');
insert into drafts (id, league_id, draft_type, status, is_mock, config, total_rounds,
                    nomination_order, on_clock_team_id, current_pick_number,
                    current_round, current_deadline, budget_adjustments, started_at)
values ('ef000000-0000-4000-8000-0000000000f1', 'bf000000-0000-4000-8000-0000000000f1',
        'auction', 'live', false,
        '{"auction_budget": 7, "auction_zero_dollar_nominations": false,
          "auction_nomination_seconds": 30, "auction_bid_seconds": 20,
          "auction_anti_snipe_seconds": 10, "disconnect_grace_seconds": 30}', 2,
        (select jsonb_agg(('cf000000-0000-4000-8000-00f10000000' || i)::text order by i)
           from generate_series(1, 8) i),
        'cf000000-0000-4000-8000-00f100000001', 1, 1, now() + interval '30 seconds',
        '{"cf000000-0000-4000-8000-00f100000001": 1}', now());

select results_eq(
  $$ select b.remaining, b.open_slots, b.max_bid
       from public.draft_team_budget('ef000000-0000-4000-8000-0000000000f1',
                                     'cf000000-0000-4000-8000-00f100000001') b $$,
  $$ values (8, 2, 7) $$,
  'THE LEAGUE BOARD, same numbers: the nominator reads $8 / 2 spots / max $7');
select ok(
  public.draft_nomination_uncontestable(
    'ef000000-0000-4000-8000-0000000000f1', 'cf000000-0000-4000-8000-00f100000001', 7),
  '§4 RULE 11: a LEAGUE auction answers exactly what 041 pinned — $7 is uncontestable. The new arm is guarded by `v_league_id IS NULL` and a real draft''s league_id is never NULL, so it is provably unreachable here');
select ok(
  NOT public.draft_nomination_uncontestable(
    'ef000000-0000-4000-8000-0000000000f1', 'cf000000-0000-4000-8000-00f100000001', 5),
  '…and $5 is ordinary on the league board too. Sixteen league-less seats exist in this same fixture and NONE of them reached the league scan');
select is(
  (select count(*) from teams t
    where t.league_id is null
      and t.status <> 'retired'
      and t.id <> 'cf000000-0000-4000-8000-00f100000001'),
  16::bigint,
  'THE LEAGUE ARM''S OWN NEGATIVE PREMISE, stated so the pin above is not vacuous: 16 league-less seats were available for a NULL-blind league scan to pick up, and the assertions still hold (F94)');

-- STRUCTURAL: 093's scan is still the league branch, and the widening never
-- entered the body.
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
     lateral unnest(string_to_array(p.prosrc, E'\n')) as l
    where n.nspname = 'public' and p.proname = 'draft_nomination_uncontestable'
      and l ~ 't\.league_id = v_league_id' and btrim(l) !~ '^--'),
  1::bigint,
  'STRUCTURAL PIN: 093''s league scan line `t.league_id = v_league_id` survives the CREATE OR REPLACE exactly once — 096 INSERTED an arm above it and rewrote none of it');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
     lateral unnest(string_to_array(p.prosrc, E'\n')) as l
    where n.nspname = 'public' and p.proname = 'draft_nomination_uncontestable'
      and l ~ 'IS NOT DISTINCT FROM' and btrim(l) !~ '^--'),
  0::bigint,
  '…and NO executable line widens with `IS NOT DISTINCT FROM`. 095 banner item 4 rules that wrong for this unanchored `FROM public.teams` shape, and this pin is what stops the next edit reaching for the one-liner');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
     lateral unnest(string_to_array(p.prosrc, E'\n')) as l
    where n.nspname = 'public' and p.proname = 'draft_nomination_uncontestable'
      and l ~ 'jsonb_array_elements_text' and btrim(l) !~ '^--'),
  1::bigint,
  '…and the standalone arm scans `drafts.draft_order` on exactly one executable line — the 095 §17 idiom, one authority for the team set, not a second copy of it');

-- ---------------------------------------------------------------------------
-- §E THE HEADLINE, END TO END. F121's wire measurement, inverted.
-- ---------------------------------------------------------------------------
update drafts d
set on_clock_team_id = m.human,
    current_nomination = null,
    current_deadline = now() + interval '5 minutes'
from f121_mocks m where d.id = m.id and m.tag = 'A';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "96100000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_nominate((select id from f121_mocks where tag = 'A'),
                                  'f121-rb01', 5, gen_random_uuid()) $$,
  'THE LAUNCHER NOMINATES AT $5 on their own standalone auction');
reset role;
select isnt(
  (select d.current_nomination from drafts d join f121_mocks m on m.id = d.id where m.tag = 'A'),
  null,
  'A BID CLOCK IS OPEN. This is F121''s wire measurement inverted: before 096 the same call returned 200 with `current_nomination: null` because the player had already been awarded to the nominator at $1');
select is(
  (select count(*) from draft_picks p join f121_mocks m on p.draft_id = m.id
    where m.tag = 'A' and p.player_id = 'f121-rb01'),
  0::bigint,
  '…and NO pick row was written — there is a market to raise into, which is the whole of what a practice auction is for');

-- The genuine uncontestable case still instant-awards, standalone.
update drafts d
set current_nomination = null, on_clock_team_id = m.human,
    current_deadline = now() + interval '5 minutes'
from f121_mocks m where d.id = m.id and m.tag = 'A';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "96100000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_nominate((select id from f121_mocks where tag = 'A'),
                                  'f121-rb02', 7, gen_random_uuid()) $$,
  'THE SAME LAUNCHER NOMINATES AT $7 — the price no rival can raise');
reset role;
select is(
  (select d.current_nomination from drafts d join f121_mocks m on m.id = d.id where m.tag = 'A'),
  null::jsonb,
  '§8.6.9 STILL FIRES STANDALONE: no clock opened');
select results_eq(
  $$ select p.team_id, p.price from draft_picks p, f121_mocks m
      where p.draft_id = m.id and m.tag = 'A' and p.player_id = 'f121-rb02' $$,
  $$ select m.human, 7 from f121_mocks m where m.tag = 'A' $$,
  '…and the player was awarded to the nominator at his own $7. 096 gave the predicate the right team set; it did not soften the rule');

-- ---------------------------------------------------------------------------
-- §F FORM AND GRANTS after the CREATE OR REPLACE (§4.1 / D18->D23).
-- ---------------------------------------------------------------------------
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'draft_nomination_uncontestable'),
  false,
  'FORM: still a PLAIN function, not SECURITY DEFINER — 093''s reasoning stands, no client ever asks this question and the server answers it under the lock');
select is(
  (select p.proconfig::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'draft_nomination_uncontestable'),
  '{"search_path=\"\""}',
  'FORM: `search_path = ''''` survived the replace (§4.1)');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
     lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and p.proname = 'draft_nomination_uncontestable'
      and a.grantee::regrole::text in ('public', 'anon', 'authenticated')),
  0::bigint,
  'GRANTS: the REVOKE was re-issued after the replace — PUBLIC, anon and authenticated hold no EXECUTE (D18->D23; a CREATE OR REPLACE does not restore a grant, but re-stating the posture is 093/095''s own precedent and this pin is what makes it checkable)');

select * from finish();
rollback;
