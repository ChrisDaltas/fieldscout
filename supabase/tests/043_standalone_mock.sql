-- ============================================================================
-- A mock with no league — migration 095 (task MP.3; spec v2.16.1 §8.8 + §12;
-- D226/D227/D234/D236; F109(a)-(d), F112; tasks-MP §5 MP.3 and §4 rules 1-16).
-- pgTAP file is **043** (042 = MP.2's roster snapshot; next free confirmed
-- with `ls supabase/tests/` at task time).
--
-- WHAT THIS FILE PINS, AND THE DEFECT EACH SECTION CATCHES (§4.3: a pin is
-- not a pin until it has been shown RED against the thing it claims to catch;
-- the RED runs are in the PR body).
--
--   §A THE LAUNCH. A user in ZERO leagues launches a standalone mock: the
--      draft row carries `league_id IS NULL`, N seats are minted
--      (1 human + N-1 `CPU k`), `config.mock.cpu_seats` names the bots, and
--      MP.2's roster snapshot is written BY THIS ARM (there is no league to
--      copy it from). Reddens if any of those stop being true.
--
--   §B THE ARM-C PROBE, PROMOTED FROM A PROBE TO A PIN. D234(7) probed three
--      users against three drafts and showed that an ownership arm WITHOUT
--      the `league_id IS NULL` conjunct hands an EX-MEMBER read on a
--      LEAGUE-ATTACHED mock they launched before leaving. That was a
--      transaction that rolled back. Here it is a test: u04 launched the
--      league mock and then left the league, and must see NOTHING. Remove
--      the conjunct from `is_standalone_mock_launcher` and this section goes
--      RED — which is the whole point of writing it down.
--
--   §C THE ENGINE CLAIMS A STANDALONE MOCK. F109(a)'s silent failure: with
--      the `leagues`-existence guards unamended the tick never picks a
--      standalone mock up and says nothing. Pinned as behaviour (a pick
--      lands) AND as a structural fact (`draft_league_alive` is what the
--      guards call), plus the loud half — the human's own pick, nominate and
--      bid 404'd with P0002 on their own practice.
--
--   §D THE SETTINGS OBJECT (§4 rule 12) AND ITS BOUNDARIES (D146). The RPC
--      takes an object and validates it server-side; every §7.3.8 range is
--      pinned ONE STEP either side of the boundary, so a widened bound is
--      caught rather than a changed one.
--
--   §E R492's TWO PREDICATES. The launcher's own QUEUE resolves on a
--      standalone mock (the pin is a queue holding a specific player and
--      autopick returning it) and their BIG BOARD does too. Reddens if the
--      queue join goes back to `=`.
--
--   §F R473's WEDGE. The owner cannot DELETE a live mock's seat; they CAN
--      still rename it; the seat is still world-readable; a stranger still
--      cannot touch it. Nothing else — the zero-side-effect measurements live
--      where their launches do (§B and §G), and R499 is why this header no
--      longer claims one here.
--
--   §G THE ZERO-SIDE-EFFECT MEASUREMENT, WITH THE INSTRUMENT R383 EXISTS FOR.
--      A user in ZERO leagues launches, drafts and deletes; the delta over the
--      league product is taken as the **R383 WHOLE-ROW COMPOSITE** —
--      `to_jsonb(l)::text` plus the league-scoped counts, the 041:719-736
--      idiom — and NOT as a row count. R499: the first cut CLAIMED the
--      composite and compared five `count(*)`s, which is the exact instrument
--      R383 exists because it cannot see an in-place UPDATE; a regression
--      touching only `leagues.status` or `.updated_at` passed it. §B brackets
--      a LEAGUE-attached launch with the same composite, so the rule is
--      measured on the path where it has always had full force too. Fixture
--      asserted NON-EMPTY first (F94).
--
--   §H FORM AND GRANTS (§4.1 / D18->D23), including F112's flip.
--
-- FIXTURE NOTE (D235/F110, both halves): every fixture ADP is in the
-- fractional band (0, 1) — 0.501…0.520 — strictly below the real pool's
-- measured global minimum of 1.8, so a fixture wins BY VALUE on a seeded
-- machine and, being the only players in play, on an empty one too. No
-- assertion here states a premise about what the shared `players` table does
-- NOT contain.
--
-- Conventions: fixtures in the postgres role BEFORE any JWT claims (D49(7));
-- goldens are stored literals (§4.3); the whole file rolls back.
-- ============================================================================
begin;
select plan(97);

-- ---------------------------------------------------------------------------
-- Fixtures. Users u01…u04. u01 is in NO league at all — that is the point of
-- the lane and the premise §A/§G rest on, so it is ASSERTED, not assumed.
-- Players: 10 QBs (0.501…0.510) and 10 RBs (0.511…0.520).
-- League LX (b8…a1) exists only for §B's ex-member probe and §F's composite.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('97100000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated',
  'pgtap-mp3-' || lpad(i::text, 2, '0') || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  jsonb_build_object('username', 'pgtap_mp3_user_' || lpad(i::text, 2, '0')),
  now(), now()
from generate_series(1, 4) i;

insert into players (id, full_name, position, adp)
select 'mp3-qb' || lpad(i::text, 2, '0'), 'MP3 QB ' || lpad(i::text, 2, '0'), 'QB',
       0.500 + i / 1000.0
from generate_series(1, 10) i;
insert into players (id, full_name, position, adp)
select 'mp3-rb' || lpad(i::text, 2, '0'), 'MP3 RB ' || lpad(i::text, 2, '0'), 'RB',
       0.510 + i / 1000.0
from generate_series(1, 10) i;

-- League LX: 8 seats, u02 commissioner, u04 a member who will LEAVE.
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings) values
  ('b8000000-0000-4000-8000-0000000000a1', '97100000-0000-4000-8000-000000000002',
   'pgtap-mp3-LX', 2026, 'setup', 8, null,
   '{"draft": {"draft_type": "snake", "pick_timer_seconds": 90}}');
update leagues
set roster_settings = '{"starting_slots": [
      {"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}],
    "bench": 1, "ir_slots": [], "swap_spots": 0}'
where id = 'b8000000-0000-4000-8000-0000000000a1';

insert into teams (id, owner_id, name, league_id)
select ('c8000000-0000-4000-8000-00a1000000' || lpad(i::text, 2, '0'))::uuid,
       ('97100000-0000-4000-8000-0000000000' || lpad(((i % 3) + 2)::text, 2, '0'))::uuid,
       'pgtap-mp3-t' || lpad(i::text, 2, '0'),
       'b8000000-0000-4000-8000-0000000000a1'
from generate_series(1, 8) i;

insert into league_members (league_id, user_id, team_id, role) values
  ('b8000000-0000-4000-8000-0000000000a1', '97100000-0000-4000-8000-000000000002',
   'c8000000-0000-4000-8000-00a100000001', 'commissioner'),
  ('b8000000-0000-4000-8000-0000000000a1', '97100000-0000-4000-8000-000000000003',
   'c8000000-0000-4000-8000-00a100000002', 'manager'),
  ('b8000000-0000-4000-8000-0000000000a1', '97100000-0000-4000-8000-000000000004',
   'c8000000-0000-4000-8000-00a100000003', 'manager');

-- The premise, ASSERTED before anything rests on it (F94: never let an empty
-- fixture pass for a satisfied one).
select is(
  (select count(*) from league_members where user_id = '97100000-0000-4000-8000-000000000001'),
  0::bigint,
  'PREMISE: u01 is a member of ZERO leagues — the user this whole lane exists for. Asserted rather than assumed (F94)');

-- ---------------------------------------------------------------------------
-- A. THE LAUNCH. u01, no league, a settings OBJECT.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "97100000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft(
       p_settings := '{"team_count": 10,
                       "roster_settings": {"starting_slots": [
                          {"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}],
                          "bench": 1, "ir_slots": [], "swap_spots": 0},
                       "draft": {"draft_type": "snake", "pick_timer_seconds": 90}}'::jsonb,
       p_cpu_speed := 'fast') $$,
  'A USER IN ZERO LEAGUES LAUNCHES A MOCK — the sentence this migration exists to make true (§8.8 as amended by v2.16)');
reset role;

create temp table mp3_mock as
select id from drafts where is_mock and league_id is null
  and config->'mock'->>'launched_by' = '97100000-0000-4000-8000-000000000001';
grant select on mp3_mock to authenticated;

select is((select count(*) from mp3_mock), 1::bigint,
  'exactly one standalone mock exists');
select is(
  (select d.league_id from drafts d join mp3_mock m on m.id = d.id),
  null::uuid,
  'its league_id is NULL — the four NOT NULL drops are what make the row insertable at all');
select is(
  (select jsonb_array_length(d.draft_order) from drafts d join mp3_mock m on m.id = d.id),
  10,
  'the draft order covers all 10 seats');
select is(
  (select jsonb_array_length(d.config->'mock'->'cpu_seats') from drafts d join mp3_mock m on m.id = d.id),
  9,
  'config.mock.cpu_seats names N-1 = 9 bots (D227(3)) — the human gets a seat too, because with no league there is no franchise to borrow');
select is(
  (select count(*) from teams t
    where t.league_id is null and t.owner_id = '97100000-0000-4000-8000-000000000001'),
  10::bigint,
  '…and 10 standalone `teams` rows were minted in the launch transaction (draft_picks.team_id is NOT NULL FK teams — the one part of the old seat problem that survives, D227(1))');
select is(
  (select string_agg(t.name, ',' order by t.name)
     from teams t, drafts d, mp3_mock m
    where d.id = m.id and (d.config->'mock'->'cpu_seats') ? t.id::text),
  'CPU 1,CPU 2,CPU 3,CPU 4,CPU 5,CPU 6,CPU 7,CPU 8,CPU 9',
  'the bots are named CPU 1 … CPU 9, as a stored literal — one naming rule, not a system (D227(5); no explanatory copy, §4 rule 16)');
select is(
  (select t.name from teams t, drafts d, mp3_mock m
    where d.id = m.id and t.id::text = d.config->'mock'->>'human_team_id'),
  'My Team',
  '…and the human seat is one of the ten, minted the same way');
select is(
  (select d.config->'roster' from drafts d join mp3_mock m on m.id = d.id),
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}],
    "bench": 1, "ir_slots": [], "swap_spots": 0}'::jsonb,
  'MP.2''S ROSTER SNAPSHOT IS WRITTEN BY THIS ARM ITSELF, as a stored literal: there is no league to copy it from, and both readers RAISE on a mock whose config lacks the KEY (094 §2a/R491). The snapshot is what makes a league-less mock priceable at all');
select is(
  (select d.total_rounds from drafts d join mp3_mock m on m.id = d.id),
  2,
  'total_rounds = starters + bench = 1 + 1 (D91), derived from the object the caller sent');
select is(
  (select d.status from drafts d join mp3_mock m on m.id = d.id),
  'live',
  'it starts immediately (§8.8) — a practice draft has nobody to wait for');

-- ---------------------------------------------------------------------------
-- B. THE ARM-C PROBE AS A PERMANENT PIN (D234(7), banner item 2).
--    u04 launches a LEAGUE-attached mock, then LEAVES the league. Under the
--    shipped predicate they see nothing. Under an ownership arm missing the
--    `league_id IS NULL` conjunct they would keep read on a row that HAS a
--    league — strictly more permissive, which D233(5) forbids.
-- ---------------------------------------------------------------------------
-- The R383 composite, taken BEFORE the league-attached launch (041:719-736's
-- idiom). A count cannot see an in-place UPDATE and several of the writes this
-- rule forbids are in-place — `leagues.status`, `leagues.settings`,
-- `leagues.updated_at` — so the whole ROW goes into the comparison.
create temp table mp3_lx_before as
select (select to_jsonb(l)::text from leagues l where l.id = 'b8000000-0000-4000-8000-0000000000a1') as league_row,
       (select count(*) from league_members where league_id = 'b8000000-0000-4000-8000-0000000000a1') as members,
       (select count(*) from teams where league_id = 'b8000000-0000-4000-8000-0000000000a1') as teams,
       (select count(*) from league_rosters where league_id = 'b8000000-0000-4000-8000-0000000000a1') as rosters,
       (select count(*) from league_weeks where league_id = 'b8000000-0000-4000-8000-0000000000a1') as weeks,
       (select count(*) from league_lists where league_id = 'b8000000-0000-4000-8000-0000000000a1') as lists;
select isnt((select league_row from mp3_lx_before), null,
  'FIXTURE NON-EMPTY (F94): the league-attached bracket has a real leagues row to be wrong about');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "97100000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft('b8000000-0000-4000-8000-0000000000a1') $$,
  'u04 launches a LEAGUE-attached mock (the league arm is untouched — §4 rule 11)');
reset role;

select is(
  (select to_jsonb(l)::text from leagues l where l.id = 'b8000000-0000-4000-8000-0000000000a1')
    || '|' || (select count(*) from league_members where league_id = 'b8000000-0000-4000-8000-0000000000a1')
    || '/' || (select count(*) from teams where league_id = 'b8000000-0000-4000-8000-0000000000a1')
    || '/' || (select count(*) from league_rosters where league_id = 'b8000000-0000-4000-8000-0000000000a1')
    || '/' || (select count(*) from league_weeks where league_id = 'b8000000-0000-4000-8000-0000000000a1')
    || '/' || (select count(*) from league_lists where league_id = 'b8000000-0000-4000-8000-0000000000a1'),
  (select league_row || '|' || members || '/' || teams || '/' || rosters || '/' || weeks || '/' || lists
     from mp3_lx_before),
  '§8.8 ZERO SIDE EFFECTS ON THE LEAGUE-ATTACHED PATH, measured with the R383 COMPOSITE (041:719-736): the WHOLE `leagues` row — status, settings, updated_at — and every league-scoped count are byte-identical across a launch through the REWRITTEN RPC. A row count could not have seen any of the three (R499)');

create temp table mp3_lmock as
select id from drafts where is_mock and league_id = 'b8000000-0000-4000-8000-0000000000a1';
grant select on mp3_lmock to authenticated;

select is(
  (select count(*) from teams t
    where t.league_id is null and t.owner_id = '97100000-0000-4000-8000-000000000004'),
  0::bigint,
  '§8.8 ZERO SIDE EFFECTS, HALF ONE: a LEAGUE mock mints NO seats — every standalone behaviour sits behind `p_league_id IS NULL`');
select is(
  (select d.config->'mock' ? 'cpu_seats' from drafts d join mp3_lmock m on m.id = d.id),
  false,
  '…HALF TWO: and stores no cpu_seats key. An unread stored field is a claim nobody checks (D236(4))');

-- One pick on the LEAGUE mock, so the ex-member probe covers the CHILD
-- tables too. `drafts` carries the ownership arm INLINE (the row is the
-- draft); `draft_picks`/`draft_bids`/`league_chat` reach it through
-- is_standalone_mock_launcher — two places the same conjunct has to hold, and
-- a probe that only exercised one of them would leave the other unpinned.
insert into draft_picks (draft_id, league_id, pick_number, round, team_id, player_id, is_auto, made_via)
select m.id, 'b8000000-0000-4000-8000-0000000000a1', 1, 1,
       'c8000000-0000-4000-8000-00a100000003', 'mp3-qb01', true, 'autopick'
from mp3_lmock m;

delete from league_members
where league_id = 'b8000000-0000-4000-8000-0000000000a1'
  and user_id = '97100000-0000-4000-8000-000000000004';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "97100000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select is(
  (select count(*) from drafts d join mp3_lmock m on m.id = d.id),
  0::bigint,
  'THE ARM-C PIN: an EX-MEMBER who launched a league-attached mock and then LEFT sees NOTHING. Drop the `league_id IS NULL` conjunct from is_standalone_mock_launcher and this goes RED — the conjunct is load-bearing, not defensive decoration (D234(7))');
select is(
  (select count(*) from draft_picks p join mp3_lmock m on p.draft_id = m.id),
  0::bigint,
  '…AND THE SAME PIN ONE TABLE DOWN: the ex-member cannot read that mock''s PICKS either. Here the conjunct sits in the POLICY (`league_id IS NULL AND is_standalone_mock_launcher(draft_id)`), so this test pins the policy''s copy of it');
select ok(
  not public.is_standalone_mock_launcher((select id from mp3_lmock)),
  '…AND THE HELPER''S OWN COPY, PINNED DIRECTLY, because there is one place where it is the ONLY guard: the two `realtime.messages` `draft:%` policies read `is_league_member(d.league_id) OR is_standalone_mock_launcher(d.id)` with no outer conjunct of their own, so an ex-member who launched a league mock and then left would be able to SUBSCRIBE to its room. Remove the `league_id IS NULL` conjunct from the helper and this goes RED (D234(7) arm C, at the site where the policy cannot cover for it)');
select is(
  (select count(*) from drafts d join mp3_mock m on m.id = d.id),
  0::bigint,
  '…and one user''s practice is not another''s to read: u04 cannot see u01''s standalone mock either (D226(3): ONE ownership predicate, not a membership graph)');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "97100000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select count(*) from drafts d join mp3_mock m on m.id = d.id),
  1::bigint,
  'THE POSITIVE HALF: the launcher CAN read their own standalone mock — an arm that refused everyone would pass the negative pins and ship a dead room');
reset role;

-- THE REDUNDANT CONJUNCT, ALARMED (R504). The three CHILD policies carry
-- `league_id IS NULL` even though `is_standalone_mock_launcher` carries it
-- too, so removing either copy alone changes no query's answer — which means
-- a behavioural pin on them is impossible in principle, and leaving them
-- unalarmed would make "defence in depth" indistinguishable from "nobody
-- checks". So it is pinned STRUCTURALLY: an edit that "simplifies" the
-- conjunct away goes RED here even though nothing would have gone red at
-- runtime.
select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and (tablename, policyname) in (
        ('draft_picks', 'Picks viewable by league members'),
        ('draft_bids',  'Bids viewable by league members'),
        ('league_chat', 'Chat viewable by league members'))
      and qual like '%league_id IS NULL%'
      and qual like '%is_standalone_mock_launcher%'),
  3::bigint,
  'ALL THREE CHILD POLICIES CARRY BOTH HALVES (R504): the redundant `league_id IS NULL` conjunct AND the helper call. Redundant is not the same as unnecessary — the helper''s copy is the ONLY guard at the two `realtime.messages` policies, which is precisely why these three should not lean on it');

-- ---------------------------------------------------------------------------
-- C. THE ENGINE CLAIMS IT (F109(a)). Both halves: the SILENT one (the tick
--    skipping the mock and saying nothing) and the LOUD one (P0002 on the
--    human's own pick).
-- ---------------------------------------------------------------------------
update drafts d set current_deadline = now() - interval '5 minutes'
from mp3_mock m where d.id = m.id;
select lives_ok(
  $$ select public.draft_tick() $$,
  'the tick runs over a board that contains a standalone mock');
select cmp_ok(
  (select count(*) from draft_picks p join mp3_mock m on p.draft_id = m.id),
  '>=', 1::bigint,
  'THE SILENT FAILURE IS CLOSED: a pick LANDED on the standalone mock. Before 095 the six is_mock scan arms — and the four nobody had counted (ARM 2''s body re-check, ARM 2.6(a)/(b), ARM 3) — each carried `EXISTS (… public.leagues …)`, so the tick claimed nothing, picked nothing, and raised nothing (probed t/t/f in D234(5))');
select is(
  (select count(*) from draft_picks p join mp3_mock m on p.draft_id = m.id
    where p.league_id is null),
  (select count(*) from draft_picks p join mp3_mock m on p.draft_id = m.id),
  '…and every pick it wrote carries a NULL league_id — `draft_picks.league_id`''s NOT NULL drop is what lets the engine''s own writer through unchanged');

-- The LOUD half, at the RPC surface: the human's own verbs.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "97100000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
-- Put the human on the clock so the refusal under test is the league guard,
-- not the turn guard.
reset role;
update drafts d set on_clock_team_id = (d.config->'mock'->>'human_team_id')::uuid,
                    current_deadline = now() + interval '5 minutes'
from mp3_mock m where d.id = m.id;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "97100000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_make_pick((select id from mp3_mock), 'mp3-qb09', gen_random_uuid()) $$,
  'THE LOUD FAILURE IS CLOSED: the launcher''s OWN PICK lands. Before 095 both the is_league_member gate AND the second, uncounted P0002 `leagues` guard behind it refused it — the human 404''d on their own practice (probed f/f/t in D234(5))');
select lives_ok(
  $$ select public.draft_touch((select id from mp3_mock)) $$,
  '…and so does their liveness beat — load-bearing, because the mock idle scan and the 72h expiry both read the LAUNCHER''s beat, so a refused beat makes a mock that is being played look idle');
select lives_ok(
  $$ select public.draft_pause((select id from mp3_mock), null) $$,
  '…and PAUSE, which raised 23502 before the league_chat NOT NULL drop (F109(c))');
select lives_ok(
  $$ select public.draft_resume((select id from mp3_mock), null) $$,
  '…and RESUME, the same 23502');
reset role;
select is(
  (select count(*) from league_chat c, mp3_mock m
    where c.context = 'draft:' || m.id::text and c.league_id is null),
  2::bigint,
  'THE (b) DECISION, PINNED: the pause and resume SYSTEM POSTS are WRITTEN, with a NULL league_id — not skipped. They are the D97 notices the room reads back, their real key is `context`, and the NOT NULL drop exists BECAUSE of these two writers (banner item 3(b))');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "97100000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select count(*) from league_chat c, mp3_mock m where c.context = 'draft:' || m.id::text),
  2::bigint,
  '…and the launcher can READ them. D226(2)''s "nobody to chat with" is an argument about SENDING; R490 caught it being over-read as one about READING');
reset role;

-- The structural half: the guard class is now ONE named idea.
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
     lateral unnest(string_to_array(p.prosrc, E'\n')) as l
    where n.nspname = 'public' and p.proname = 'draft_tick'
      and l ~ 'public\.leagues' and btrim(l) !~ '^--'),
  2::bigint,
  'STRUCTURAL PIN: draft_tick names `public.leagues` on exactly TWO non-comment lines, down from 14. Both are ARM 1''s D94 auto-start, which SCANS scheduled leagues and reaches a draft only through draft_start_internal''s `is_mock = FALSE` filter — it never looks at a mock. The other twelve are draft_league_alive()');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
     lateral unnest(string_to_array(p.prosrc, E'\n')) as l
    where n.nspname = 'public' and p.proname = 'draft_tick'
      and l ~ 'draft_league_alive' and btrim(l) !~ '^--'),
  12::bigint,
  '…and it calls draft_league_alive() on exactly 12 lines — the count is the pin, so a site silently dropped in a later CREATE OR REPLACE reddens here');
select ok(
  (select public.draft_league_alive(null))
  and not (select public.draft_league_alive('00000000-0000-0000-0000-0000000000ff'::uuid))
  and (select public.draft_league_alive('b8000000-0000-4000-8000-0000000000a1')),
  'THE SHAPE, STATED ONCE: "the league, if there is one, is alive" — NULL is alive (a mock''s existence check is the draft row itself), a nonexistent league is not, a live league is. A real draft''s league_id is never NULL, so this is provably inert for one');

-- ---------------------------------------------------------------------------
-- D. THE SETTINGS OBJECT (§4 rule 12) AND ITS BOUNDARIES (D146 — one step
--    either side of EVERY bound, never the boundary alone).
--
--    D.1 is the ARM CONTRACT and D.3 the WIRING, both driven through
--    `create_mock_draft` because that is where a client reaches them. D.2 is
--    the BOUND SWEEP and it drives `draft_settings_range_guard` DIRECTLY —
--    measured at the layer the claim is about (tasks-DR §4 rule 9), and
--    cheap enough to be exhaustive because it mints no seats and trips no
--    §22.5 cap. R498/R500: the first cut bounded five knobs, pinned two of
--    them, and left `roster_settings` open on the same client-reachable arm.
-- ---------------------------------------------------------------------------

-- Two one-line drivers, so each pin below reads as the number it is about.
-- The "other half" of each call is a known-good object, so a failure can only
-- come from the half under test.
create function mp3_d(p jsonb) returns void language sql as
$$ select public.draft_settings_range_guard(p,
     '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}],
       "bench": 1, "ir_slots": [], "swap_spots": 0}'::jsonb) $$;
create function mp3_r(p jsonb) returns void language sql as
$$ select public.draft_settings_range_guard('{}'::jsonb, p) $$;

-- D.1 THE ARM CONTRACT ------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "97100000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.create_mock_draft('b8000000-0000-4000-8000-0000000000a1',
       p_settings := '{"team_count": 10}'::jsonb) $$,
  '22023',
  'create_mock_draft: a league mock takes its settings FROM the league — send settings only for a standalone practice draft (§8.8/D95)',
  'THE TWO ARMS ARE MUTUALLY EXCLUSIVE: sending both a league and a settings object is refused rather than silently resolved. A caller whose settings were quietly replaced by the league''s would have no way to notice');
select throws_ok(
  $$ select public.create_mock_draft() $$,
  '22023',
  'create_mock_draft: a standalone practice draft needs a settings object (team_count, roster_settings, draft)',
  '…and sending neither is refused too');
select throws_ok(
  $$ select public.create_mock_draft(p_settings := '{"team_count": 11,
       "roster_settings": {"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 1}}'::jsonb) $$,
  '22023',
  'create_mock_draft: team_count 11 is not a v1 league size — practice with 8, 10, 12, 14 or 16 seats',
  'BOUNDARY: team_count 11 is refused — the number that decides how many rows the transaction MINTS is checked before anything is written');
reset role;

-- D.2 THE BOUND SWEEP, one step either side of all NINE bounds --------------
select throws_ok($$ select mp3_d('{"pick_timer_seconds": 31}') $$, '22023',
  'draft settings: pick_timer_seconds 31 is not one of the offered clocks (§7.3.8)',
  'pick_timer_seconds: 31 is refused — the clock is a WHITELIST (PICK_TIMER_SECONDS), not a range, so "one step" means the value next to an offered one');
select lives_ok($$ select mp3_d('{"pick_timer_seconds": 30}') $$,
  '…and 30, the offered clock beside it, passes');
select lives_ok($$ select mp3_d('{"pick_timer_seconds": 86400}') $$,
  '…and 86400, the largest offered clock, passes');
select throws_ok($$ select mp3_d('{"pick_timer_seconds": 86401}') $$, '22023',
  'draft settings: pick_timer_seconds 86401 is not one of the offered clocks (§7.3.8)',
  '…and one second past it does not');

select throws_ok($$ select mp3_d('{"auction_budget": 49}') $$, '22023',
  'draft settings: auction_budget 49 is outside 50-1000 (§7.3.8)',
  'auction_budget: 49 refused one step below the floor');
select lives_ok($$ select mp3_d('{"auction_budget": 50}') $$, '…and 50, the floor itself, passes');
select lives_ok($$ select mp3_d('{"auction_budget": 1000}') $$, '…and 1000, the ceiling itself, passes');
select throws_ok($$ select mp3_d('{"auction_budget": 1001}') $$, '22023',
  'draft settings: auction_budget 1001 is outside 50-1000 (§7.3.8)',
  '…and 1001 refused one step above it');

select throws_ok($$ select mp3_d('{"auction_nomination_seconds": 9}') $$, '22023',
  'draft settings: auction_nomination_seconds 9 is outside 10-120 (§7.3.8)',
  'auction_nomination_seconds: 9 refused one step below the floor');
select lives_ok($$ select mp3_d('{"auction_nomination_seconds": 10}') $$, '…and 10 passes');
select lives_ok($$ select mp3_d('{"auction_nomination_seconds": 120}') $$, '…and 120 passes');
select throws_ok($$ select mp3_d('{"auction_nomination_seconds": 121}') $$, '22023',
  'draft settings: auction_nomination_seconds 121 is outside 10-120 (§7.3.8)',
  '…and 121 refused one step above the ceiling');

select throws_ok($$ select mp3_d('{"auction_bid_seconds": 9}') $$, '22023',
  'draft settings: auction_bid_seconds 9 is outside 10-60 (§7.3.8)',
  'auction_bid_seconds: 9 refused one step below the floor — a clock under it never closes a nomination');
select lives_ok($$ select mp3_d('{"auction_bid_seconds": 10}') $$, '…and 10 passes');
select lives_ok($$ select mp3_d('{"auction_bid_seconds": 60}') $$, '…and 60 passes');
select throws_ok($$ select mp3_d('{"auction_bid_seconds": 61}') $$, '22023',
  'draft settings: auction_bid_seconds 61 is outside 10-60 (§7.3.8)',
  '…and 61 refused one step above the ceiling');

select throws_ok($$ select mp3_d('{"auction_anti_snipe_seconds": -1}') $$, '22023',
  'draft settings: auction_anti_snipe_seconds -1 is outside 0-15 (§7.3.8)',
  'auction_anti_snipe_seconds: -1 refused one step below the floor');
select lives_ok($$ select mp3_d('{"auction_anti_snipe_seconds": 0}') $$,
  '…and 0 passes — anti-snipe OFF is a legal setting, not a missing one');
select lives_ok($$ select mp3_d('{"auction_anti_snipe_seconds": 15}') $$, '…and 15 passes');
select throws_ok($$ select mp3_d('{"auction_anti_snipe_seconds": 16}') $$, '22023',
  'draft settings: auction_anti_snipe_seconds 16 is outside 0-15 (§7.3.8)',
  '…and 16 refused one step above the ceiling');

select throws_ok($$ select mp3_d('{"disconnect_grace_seconds": -1}') $$, '22023',
  'draft settings: disconnect_grace_seconds -1 is outside 0-120 (§7.3.8)',
  'disconnect_grace_seconds: -1 refused (R498 — 999999 was stored VERBATIM before this bound existed)');
select lives_ok($$ select mp3_d('{"disconnect_grace_seconds": 0}') $$, '…and 0 passes');
select lives_ok($$ select mp3_d('{"disconnect_grace_seconds": 120}') $$, '…and 120 passes');
select throws_ok($$ select mp3_d('{"disconnect_grace_seconds": 121}') $$, '22023',
  'draft settings: disconnect_grace_seconds 121 is outside 0-120 (§7.3.8)',
  '…and 121 refused one step above the ceiling');

-- The roster half — R498's headline. These numbers ARE `total_rounds`, which
-- `draft_team_budget` reads as the auction's per-team capacity.
select throws_ok($$ select mp3_r('{"starting_slots": [{"key": "qb", "count": 1}], "bench": -1}') $$, '22023',
  'roster settings: bench -1 is outside 0-20 (§7.3.2)',
  'bench: -1 refused (R498 — it LAUNCHED before this bound existed)');
select lives_ok($$ select mp3_r('{"starting_slots": [{"key": "qb", "count": 1}], "bench": 0}') $$,
  '…and 0 passes — a bench-less roster is legal');
select lives_ok($$ select mp3_r('{"starting_slots": [{"key": "qb", "count": 1}], "bench": 20}') $$,
  '…and 20, the ceiling itself, passes');
select throws_ok($$ select mp3_r('{"starting_slots": [{"key": "qb", "count": 1}], "bench": 21}') $$, '22023',
  'roster settings: bench 21 is outside 0-20 (§7.3.2)',
  '…and 21 refused one step above it. `bench: 5000` launched a 5,010-round draft before R498');

select throws_ok($$ select mp3_r('{"starting_slots": [{"key": "qb", "count": 11}], "bench": 1}') $$, '22023',
  'roster settings: a starting slot count of 11 is outside 0-10 (§7.3.2)',
  'starting slot count: 11 refused one step above the ceiling (`count: 999` launched before R498)');
select lives_ok($$ select mp3_r('{"starting_slots": [{"key": "qb", "count": 10}], "bench": 1}') $$,
  '…and 10 passes');
select throws_ok($$ select mp3_r('{"starting_slots": [{"key": "qb", "count": -1}, {"key": "rb", "count": 2}], "bench": 1}') $$, '22023',
  'roster settings: a starting slot count of -1 is outside 0-10 (§7.3.2)',
  '…and -1 refused one step below the floor, on a roster whose SUM is legal — so the pin discriminates the per-slot bound from the sum bound');
select lives_ok($$ select mp3_r('{"starting_slots": [{"key": "qb", "count": 0}, {"key": "rb", "count": 2}], "bench": 1}') $$,
  '…and a 0-count slot passes: an EMPTY slot is legal, it just contributes nothing to the sum');

select throws_ok($$ select mp3_r('{"starting_slots": [{"key": "qb", "count": 0}], "bench": 5}') $$, '22023',
  'roster settings: the starting lineup totals 0 slots — it must total between 1 and 20 (§7.3.8)',
  'starting-lineup SUM: 0 refused one step below the floor (§7.3.8 has required 1-20 since it was written; this guard stops inventing a laxer rule for practice than a league gets)');
select lives_ok($$ select mp3_r('{"starting_slots": [{"key": "qb", "count": 1}], "bench": 5}') $$,
  '…and 1 passes');
select lives_ok($$ select mp3_r('{"starting_slots": [{"key": "qb", "count": 10}, {"key": "rb", "count": 10}], "bench": 5}') $$,
  '…and 20, the ceiling itself, passes');
select throws_ok($$ select mp3_r('{"starting_slots": [{"key": "qb", "count": 10}, {"key": "rb", "count": 10}, {"key": "wr", "count": 1}], "bench": 5}') $$, '22023',
  'roster settings: the starting lineup totals 21 slots — it must total between 1 and 20 (§7.3.8)',
  '…and 21 refused one step above it');
select throws_ok($$ select mp3_r('{"bench": 5}') $$, '22023',
  'roster settings: the starting lineup totals 0 slots — it must total between 1 and 20 (§7.3.8)',
  'THE EVASION IS CLOSED TOO: OMITTING `starting_slots` sums to 0 and is refused, exactly as draft_rounds_from_roster reads it. A bound that only runs `IF p_roster ? key` is R498''s own species one level down');

-- D.3 THE GUARD IS ACTUALLY WIRED INTO THE RPC ------------------------------
-- D.2 proves the function; these prove `create_mock_draft` calls it. Without
-- this pair the whole sweep above could pass against a function nothing runs.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "97100000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.create_mock_draft(p_settings := '{"team_count": 8,
       "roster_settings": {"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 1},
       "draft": {"draft_type": "auction", "auction_bid_seconds": 9}}'::jsonb) $$,
  '22023',
  'draft settings: auction_bid_seconds 9 is outside 10-60 (§7.3.8)',
  'WIRED, draft half: the RPC refuses a 9-second bid clock. This RPC is EXECUTE-able by `authenticated`, so a client that skips the route reaches it directly');
select throws_ok(
  $$ select public.create_mock_draft(p_settings := '{"team_count": 8,
       "roster_settings": {"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 5000},
       "draft": {"draft_type": "snake"}}'::jsonb) $$,
  '22023',
  'roster settings: bench 5000 is outside 0-20 (§7.3.2)',
  'WIRED, roster half — the exact probe R498 filed: `bench: 5000` LAUNCHED a 5,010-round draft before this bound existed');
select lives_ok(
  $$ select public.create_mock_draft(p_settings := '{"team_count": 8,
       "roster_settings": {"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 1},
       "draft": {"draft_type": "auction", "auction_budget": 200,
                 "auction_nomination_seconds": 30, "auction_bid_seconds": 20,
                 "auction_anti_snipe_seconds": 10}}'::jsonb) $$,
  'AND A SOLVENT STANDALONE AUCTION LAUNCHES — which is banner item 4''s pin, not a smoke test: before 095 `draft_auction_solvent` swept `t.league_id = NULL`, got zero rows, and its own (correct) empty-set guard refused EVERY standalone auction at launch');
reset role;

create temp table mp3_auc as
select d.id from drafts d
where d.is_mock and d.league_id is null and d.draft_type = 'auction'
  and d.config->'mock'->>'launched_by' = '97100000-0000-4000-8000-000000000002';
select is((select count(*) from mp3_auc), 1::bigint, 'exactly one standalone auction to measure');
select ok(
  (select public.draft_auction_solvent(a.id) from mp3_auc a),
  '…and `draft_auction_solvent` ANSWERS TRUE for it rather than raising — the standalone arm sweeps the mock''s own `draft_order`, which is the team set `create_mock_draft` built from the seats it minted');
select is(
  (select b.open_slots from mp3_auc a, drafts d,
     lateral public.draft_team_budget(a.id, (d.config->'mock'->>'human_team_id')::uuid) b
    where d.id = a.id),
  2,
  '…and `draft_team_budget` answers for a standalone seat instead of raising P0002: 2 open slots (1 starter + 1 bench), the same number `total_rounds` was derived from. Before 095 this raised for EVERY seat');

-- WHY THERE IS NO INSOLVENCY REFUSAL PINNED HERE, said out loud rather than
-- left as a gap: with the roster bounds in place (R498) the largest legal
-- roster is 20 starters + 20 bench = 40 draftable spots, and the smallest
-- legal budget is $50, so at the $1 reserve `remaining >= open_slots * 1`
-- holds for every settings object this guard admits. **The §8.6.8 refusal is
-- UNREACHABLE on the standalone arm — redundant with the roster bounds, which
-- is v2.13.3''s finding arriving on a second path.** The backstop is kept (it
-- is one `auction_zero_dollar_nominations` change and one bound change away
-- from mattering) and is deliberately NOT pinned: a pin on a line that cannot
-- execute is a pin that can never go red.

-- ---------------------------------------------------------------------------
-- E. R492's TWO PREDICATES. The launcher's QUEUE must be honoured on a
--    standalone mock; the BIG BOARD arrives through the user-scoped source.
-- ---------------------------------------------------------------------------
-- Clear the board first, DELIBERATELY. §C left picks on this mock — one from
-- the launcher and at least one from the tick — and WHICH seat the tick
-- autopicked depends on a shuffle seeded by a random uuid. A queue pin
-- computed on top of that would pass or fail by luck, which is the F113/F110
-- species. The premise here is "an empty seat with one queued player", so the
-- fixture makes that true rather than hoping for it.
delete from draft_picks p using mp3_mock m where p.draft_id = m.id;
update drafts d set current_round = 1, current_pick_number = 1
from mp3_mock m where d.id = m.id;

insert into draft_queues (draft_id, team_id, player_id, rank)
select m.id, (d.config->'mock'->>'human_team_id')::uuid, 'mp3-rb07', 1
from drafts d join mp3_mock m on m.id = d.id;
select is(
  (select public.draft_autopick_resolve(m.id, (d.config->'mock'->>'human_team_id')::uuid)
     from drafts d join mp3_mock m on m.id = d.id),
  'mp3-rb07',
  'R492 CLOSED: the launcher''s own QUEUE resolves on a standalone mock and returns the queued player — a specific RB, chosen so best-ADP (a QB) would be a different answer. The R120 join was `t.league_id = v_draft.league_id`, which on a NULL league silently yielded NOTHING while best-ADP quietly won');

-- ---------------------------------------------------------------------------
-- F. R473's WEDGE (D227(4)), and what is deliberately NOT narrowed.
--    The write probes run in DO blocks because a data-modifying CTE cannot
--    sit inside a subquery; `GET DIAGNOSTICS row_count` is the RETURNING-count
--    the no-write-policy pattern asks for (tasks-M1 §4.2), captured rather
--    than inferred from a later SELECT.
-- ---------------------------------------------------------------------------
create temp table mp3_probe (what text, n integer);
grant all on mp3_probe to authenticated;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "97100000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
do $$
declare v integer;
begin
  delete from public.teams t
   where t.id = (select (d.config->'mock'->'cpu_seats'->>0)::uuid
                   from public.drafts d join mp3_mock m on m.id = d.id);
  get diagnostics v = row_count;
  insert into mp3_probe values ('cpu_seat_delete', v);
end $$;
select is(
  (select n from mp3_probe where what = 'cpu_seat_delete'),
  0,
  'THE WEDGE IS CLOSED: the OWNER cannot DELETE a seat their own live mock is drafting into. `draft_picks.team_id`''s FK is plain NO ACTION, so before 095 this was `DELETE 1` and the mock stalled at that seat''s turn with no in-product recovery (R473, live-probed). The party protected is the user, from breaking their own practice (§4 rule 10)');
do $$
declare v integer;
begin
  update public.teams t set name = 'Renamed Bot'
   where t.id = (select (d.config->'mock'->'cpu_seats'->>0)::uuid
                   from public.drafts d join mp3_mock m on m.id = d.id);
  get diagnostics v = row_count;
  insert into mp3_probe values ('cpu_seat_update', v);
end $$;
select is(
  (select n from mp3_probe where what = 'cpu_seat_update'),
  1,
  '…and UPDATE is deliberately KEPT: renaming your own CPU 4 is cosmetic and self-inflicted, and breaks nothing the product cannot recover from (D227(4))');
reset role;
-- Captured as postgres: u03 cannot SELECT the standalone `drafts` row (that
-- is §B), so a join through it would prove nothing about `teams` visibility.
create temp table mp3_seats as
select (jsonb_array_elements_text(d.config->'mock'->'cpu_seats'))::uuid as id
from drafts d join mp3_mock m on m.id = d.id;
grant select on mp3_seats to authenticated;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "97100000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select cmp_ok(
  (select count(*) from teams t join mp3_seats s on s.id = t.id),
  '=', 9::bigint,
  '…and WORLD-READABILITY is kept and STATED: "Teams are viewable by everyone" (001, USING true) still covers SELECT, so another user sees the bot seats. A bot seat carries a label and nothing else (§17), and hiding it would be a protection with no party to protect');
do $$
declare v integer;
begin
  delete from public.teams t
   where t.id = (select t2.id from public.teams t2
                  where t2.league_id is null
                    and t2.owner_id = '97100000-0000-4000-8000-000000000001' limit 1);
  get diagnostics v = row_count;
  insert into mp3_probe values ('stranger_delete', v);
end $$;
select is(
  (select n from mp3_probe where what = 'stranger_delete'),
  0,
  '…and a STRANGER still cannot delete someone else''s standalone team — 053''s owner predicate is untouched by the split');
reset role;

-- ---------------------------------------------------------------------------
-- G. THE ZERO-SIDE-EFFECT MEASUREMENT, WITH THE INSTRUMENT R383 EXISTS FOR.
--    A user in ZERO leagues launches, drafts and deletes; nothing in the
--    league product moves. Taken as the R383 WHOLE-ROW COMPOSITE (041:719-736)
--    and NOT as a row count — R499: a count cannot see an in-place UPDATE, and
--    `leagues.status` / `.settings` / `.updated_at` are exactly the writes
--    §8.8 forbids and exactly the ones a count sails past.
-- ---------------------------------------------------------------------------
create temp table mp3_before as
select (select string_agg(to_jsonb(l)::text, '|' order by l.id) from leagues l) as league_rows,
       (select count(*) from leagues) as leagues,
       (select count(*) from league_members) as members,
       (select count(*) from league_rosters) as rosters,
       (select count(*) from league_weeks) as weeks,
       (select count(*) from league_lists) as lists,
       (select count(*) from teams where league_id is not null) as league_teams,
       (select string_agg(to_jsonb(t)::text, '|' order by t.id)
          from teams t where t.league_id is not null) as league_team_rows;
select isnt((select league_rows from mp3_before), null,
  'FIXTURE NON-EMPTY (F94): the before-composite carries real `leagues` rows, so the comparison below can be wrong about something');
select cmp_ok((select league_teams from mp3_before), '>', 0::bigint,
  '…and real league franchises too — the rows the cleanup safety belt must not reach');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "97100000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.delete_mock_draft((select id from mp3_mock)) $$,
  'the launcher deletes their own standalone mock');
reset role;

select is(
  (select count(*) from teams t
    where t.league_id is null and t.owner_id = '97100000-0000-4000-8000-000000000001'
      and t.name in ('My Team','Renamed Bot','CPU 1','CPU 2','CPU 3','CPU 4','CPU 5','CPU 6','CPU 7','CPU 8','CPU 9')),
  0::bigint,
  'CLEANUP: the draft first, then the seats, in one transaction (D227(6) — teams has NO cascade from drafts and draft_picks.team_id is NO ACTION, so seats-first would hit the FK). A task that creates rows and does not delete them is not done');
select is(
  (select count(*) from league_chat c, mp3_mock m where c.context = 'draft:' || m.id::text),
  0::bigint,
  '…and its chat goes with it: the sweep is NULL-safe now (`league_id IS NOT DISTINCT FROM`), where `= NULL` would have orphaned every standalone post');

-- THE COMPOSITE ITSELF.
select is(
  (select string_agg(to_jsonb(l)::text, '|' order by l.id) from leagues l)
    || '|' || (select count(*) from leagues)
    || '/' || (select count(*) from league_members)
    || '/' || (select count(*) from league_rosters)
    || '/' || (select count(*) from league_weeks)
    || '/' || (select count(*) from league_lists),
  (select league_rows || '|' || leagues || '/' || members || '/' || rosters
          || '/' || weeks || '/' || lists
     from mp3_before),
  '§8.8 ZERO SIDE EFFECTS over the WHOLE standalone lifecycle — launch, tick, human pick, pause, resume, delete — measured as the R383 COMPOSITE: EVERY `leagues` row entire (status, settings, updated_at) plus every league-scoped count, byte-identical. This is the assertion R499 found missing: the five `count(*)`s it replaces would have passed a regression that flipped a league to `in_season` and back, or that merely bumped `updated_at`');
select is(
  (select string_agg(to_jsonb(t)::text, '|' order by t.id) from teams t where t.league_id is not null),
  (select league_team_rows from mp3_before),
  '…AND EVERY LEAGUE FRANCHISE ROW ENTIRE — not a count of them. This is where the cleanup safety belt is really pinned: a malformed `cpu_seats` array is incapable of deleting a real franchise (`t.league_id IS NULL` + owner), and a count alone could not tell a deleted franchise from a renamed one');

-- ---------------------------------------------------------------------------
-- H. FORM AND GRANTS (§4.1 / D18->D23), including F112's flip.
-- ---------------------------------------------------------------------------
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_mock_draft')
  and (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_standalone_mock_launcher')
  and (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'team_is_mock_seat'),
  'FORM (§4.1): create_mock_draft and both policy helpers are SECURITY DEFINER with the exact spec-form search_path');
select ok(
  not has_function_privilege('anon', 'public.create_mock_draft(uuid, uuid, text, uuid, jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.create_mock_draft(uuid, uuid, text, uuid, jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.is_standalone_mock_launcher(uuid)', 'EXECUTE')
  and has_function_privilege('anon', 'public.is_standalone_mock_launcher(uuid)', 'EXECUTE')
  and has_function_privilege('anon', 'public.team_is_mock_seat(uuid)', 'EXECUTE'),
  'GRANTS: the DROP+CREATE did not lose the posture — create_mock_draft REVOKEd from anon only. The two POLICY-PREDICATE helpers keep the DEFAULT ACL on purpose (D50, `is_league_member`''s posture): they are evaluated inside `TO public` policies as whatever role is querying, so REVOKing PUBLIC would not narrow anything — it would turn "you see no rows" into "permission denied for function", a worse answer to the same question');
select ok(
  not has_function_privilege('authenticated', 'public.draft_league_alive(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_league_alive(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_settings_range_guard(jsonb, jsonb)', 'EXECUTE'),
  '…and the two engine-internal helpers are REVOKEd from every client role — no client asks whether a league is alive (D18->D23)');
select ok(
  not has_function_privilege('authenticated', 'public.draft_mock_cpu_need(uuid, uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_mock_cpu_need(uuid, uuid, text)', 'EXECUTE'),
  'F112 CLOSED: draft_mock_cpu_need is REVOKEd. R497 pinned the OPEN grant in 042 "so a future REVOKE reddens here and gets read" — this is that flip, taken deliberately after measuring that no client path calls it');

select * from finish();
rollback;
