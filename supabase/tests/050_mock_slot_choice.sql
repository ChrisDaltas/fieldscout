-- ============================================================================
-- Choose your slot when you launch a mock — pgTAP 050 (migration 102, task
-- MS.8; spec v2.15 §8.8 parity block + E77; D223; PROGRESS D261).
--
-- WHAT THIS FILE PINS, AND THE DEFECT EACH SECTION CATCHES (§4.3):
--
--   §A FORM. One create_mock_draft, one resolver, one nomination internal —
--      the D201(2) overload trap pinned as a COUNT (a CREATE OR REPLACE
--      that appended a parameter would leave two and every named call would
--      start failing "function is not unique"). Grants re-asserted: the
--      DROP+CREATE reset each ACL, so the REVOKEs are load-bearing.
--
--   §B THE UNIT GOLDENS, AS STORED LITERALS. draft_resolve_order_internal
--      over FIXED team ids with a FIXED seed: the unpinned shuffle is the
--      pre-102 formula's literal (the byte-for-byte backward-compat pin,
--      MS.8 item 4), the pinned shuffle is that literal minus the pinned
--      seat spliced at its slot (D223(5): a CONSTRAINT on the one shuffle,
--      never a second randomizer), and the same (seed, slot) replays
--      identically. The 7-arg call text still binds (D201(2)).
--
--   §C STANDALONE SLOTS END TO END. Slot 1, slot 4 (middle), slot 8 (= N)
--      each place the human's minted seat at exactly that index; the other
--      seats are a permutation of the rest (none dropped, none duplicated);
--      the stored order equals its own seeded recomputation (the ids are
--      minted at launch, so the golden is the FORMULA over this mock's own
--      id — determinism per (mock_id, slot), which a wall-clock or
--      random() shuffle would fail). Default (no slot) equals the PRE-102
--      formula over all seats. D146 boundaries: 0 and N+1 refuse BY NAME
--      one unit either side of the legal edge; 1 and N are the legal edges
--      and they are the slots §C launches.
--
--   §D THE AUCTION MEANING (D261): the slot is the NOMINATION position
--      too. same_as_draft_order: both orders carry the human at the slot
--      and are equal by construction. Independently-random nomination:
--      the human sits at the slot in BOTH orders, each over its own seed.
--
--   §E THE LEAGUE ARM. An UNDRAWN league (the normal preseason case —
--      "there is no real draft order, most drafts will set the order right
--      before"): the launcher's franchise lands at the slot, the other
--      SEVEN franchises shuffle around it, and the league row is
--      byte-identical around the launch (§8.8; the R383 whole-row
--      composite, not a count). A DRAWN league (stored lobby order on the
--      real draft row): a requested slot REFUSES by name — the mock
--      INHERITS a drawn order (§8.8 fidelity) — and a slotless launch
--      still inherits it verbatim (stored literal); the REAL draft row is
--      byte-identical around both. A manual-mode league refuses a slot the
--      same way (unit, §B). Range check runs on the league's own board.
--
--   §F THE 5-ARG CALL TEXT STILL BINDS: a positional 5-argument league
--      launch (the pre-102 signature) works, p_slot defaulting to NULL —
--      the AP.5/D201(2) still-binds pin at the RPC the wire actually calls.
--
-- FIXTURE NOTE (F94): every section asserts its fixture is non-empty (seat
-- counts, premise rows) before asserting anything about it. §22.5 caps are
-- respected by construction: no user launches more than 3 mocks or creates
-- more than 5 in the file (u1: 3, u2: 3, u3: 2, u4: 2).
--
-- Conventions: fixtures in the postgres role BEFORE any JWT claims (D49(7));
-- goldens are stored literals where ids are fixed and the seeded FORMULA
-- where ids are minted at launch (stated per pin); the whole file rolls back.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
select plan(43);

-- ---------------------------------------------------------------------------
-- Fixtures. u1/u3/u4 launch standalone; u2 owns and commissions the four
-- leagues. LA = snake/random, UNDRAWN (no real draft row at all). LC =
-- snake/random with a real scheduled draft holding a DRAWN order. LD =
-- manual mode with a stored settings order. LB = auction (same_as nom).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('90500000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-ms8-u' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       ('{"username": "ms8_user_' || i || '"}')::jsonb, now(), now()
from generate_series(1, 4) i;

insert into leagues (id, owner_id, name, season, status, team_count,
                     scoring_system_id, settings, scoring_rules_snapshot)
values
  ('b0500000-0000-4000-8000-0000000000aa', '90500000-0000-4000-8000-000000000002',
   'pgtap-ms8-undrawn', 2026, 'setup', 8, null,
   '{"draft": {"draft_type": "snake", "draft_order_mode": "random", "pick_timer_seconds": 90}}'::jsonb, '{}'::jsonb),
  ('b0500000-0000-4000-8000-0000000000cc', '90500000-0000-4000-8000-000000000002',
   'pgtap-ms8-drawn', 2026, 'setup', 8, null,
   '{"draft": {"draft_type": "snake", "draft_order_mode": "random", "pick_timer_seconds": 90}}'::jsonb, '{}'::jsonb),
  ('b0500000-0000-4000-8000-0000000000dd', '90500000-0000-4000-8000-000000000002',
   'pgtap-ms8-manual', 2026, 'setup', 8, null,
   '{"draft": {"draft_type": "snake", "draft_order_mode": "manual", "pick_timer_seconds": 90}}'::jsonb, '{}'::jsonb),
  ('b0500000-0000-4000-8000-0000000000bb', '90500000-0000-4000-8000-000000000002',
   'pgtap-ms8-auction', 2026, 'setup', 8, null,
   '{"draft": {"draft_type": "auction", "auction_budget": 200,
      "auction_zero_dollar_nominations": false, "auction_nomination_seconds": 30,
      "auction_bid_seconds": 20, "auction_anti_snipe_seconds": 10}}'::jsonb, '{}'::jsonb);

update leagues
set roster_settings = '{"starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                        "bench": 1, "ir_slots": [], "swap_spots": 0}'::jsonb
where name like 'pgtap-ms8-%';

insert into teams (id, owner_id, name, league_id)
select ('d0500000-0000-4000-8000-00' || w.sfx || '0000000' || i)::uuid,
       '90500000-0000-4000-8000-000000000002',
       'pgtap-ms8-' || w.sfx || '-t' || i,
       ('b0500000-0000-4000-8000-0000000000' || w.sfx)::uuid
from (values ('aa'), ('cc'), ('dd'), ('bb')) as w(sfx), generate_series(1, 8) i;

insert into league_members (league_id, user_id, team_id, role)
select ('b0500000-0000-4000-8000-0000000000' || w.sfx)::uuid,
       '90500000-0000-4000-8000-000000000002',
       ('d0500000-0000-4000-8000-00' || w.sfx || '00000002')::uuid,
       'commissioner'
from (values ('aa'), ('cc'), ('dd'), ('bb')) as w(sfx);
insert into league_members (league_id, user_id, team_id, role) values
  ('b0500000-0000-4000-8000-0000000000aa', '90500000-0000-4000-8000-000000000003',
   'd0500000-0000-4000-8000-00aa00000003', 'manager');

-- LD's stored settings order (manual mode; a valid permutation).
update leagues
set settings = jsonb_set(settings, '{draft,draft_order}',
  (select jsonb_agg(to_jsonb(t.id) order by t.id)
     from teams t where t.league_id = 'b0500000-0000-4000-8000-0000000000dd'))
where id = 'b0500000-0000-4000-8000-0000000000dd';

-- LC's DRAWN order: a real scheduled draft row whose stored order is a
-- fixed literal — t8..t1 reversed, unmistakably not a fresh shuffle.
insert into drafts (id, league_id, draft_type, status, is_mock, config,
                    draft_order, total_rounds, current_round, current_pick_number)
values ('e0500000-0000-4000-8000-0000000000cc', 'b0500000-0000-4000-8000-0000000000cc',
        'snake', 'scheduled', false, '{"draft_type": "snake", "pick_timer_seconds": 90}'::jsonb,
        '["d0500000-0000-4000-8000-00cc00000008", "d0500000-0000-4000-8000-00cc00000007",
          "d0500000-0000-4000-8000-00cc00000006", "d0500000-0000-4000-8000-00cc00000005",
          "d0500000-0000-4000-8000-00cc00000004", "d0500000-0000-4000-8000-00cc00000003",
          "d0500000-0000-4000-8000-00cc00000002", "d0500000-0000-4000-8000-00cc00000001"]'::jsonb,
        2, 1, 1);

-- F94 premises.
select is((select count(*) from league_members where user_id = '90500000-0000-4000-8000-000000000001'),
  0::bigint, 'PREMISE (F94): u1 is a member of ZERO leagues — §C''s standalone launcher');
select is((select count(*) from teams where league_id = 'b0500000-0000-4000-8000-0000000000aa'),
  8::bigint, 'PREMISE (F94): LA seats all 8 franchises — the league arm''s full board');

-- ---------------------------------------------------------------------------
-- A. Form: one function each (the D201(2) overload trap as a count), and
--    the re-asserted grants (the DROP+CREATEs reset each ACL).
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(pg_get_function_identity_arguments(p.oid))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_mock_draft'),
  array['p_league_id uuid, p_human_team_id uuid, p_cpu_speed text, p_action_id uuid, p_settings jsonb, p_slot integer'],
  'EXACTLY ONE create_mock_draft, ending in p_slot integer — an appended overload beside the old signature would make every named call "not unique" (D201(2); the array_agg is the count assertion too)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('draft_resolve_order_internal', 'draft_nomination_order_internal')),
  2,
  'one resolver + one nomination internal — no overload left behind by the DROP+CREATEs');
select ok(
  (select has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_mock_draft'),
  'create_mock_draft: EXECUTE for authenticated, none for anon — the REVOKE is load-bearing after a DROP+CREATE (ACL reset)');
select ok(
  (select bool_and(not has_function_privilege('authenticated', p.oid, 'EXECUTE')
               and not has_function_privilege('anon', p.oid, 'EXECUTE'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('draft_resolve_order_internal', 'draft_nomination_order_internal')),
  '…and both internals are callable from DEFINER bodies only (§4.1)');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_mock_draft'),
  'create_mock_draft stays SECURITY DEFINER with a pinned search_path (§4.1)');

-- ---------------------------------------------------------------------------
-- B. Unit goldens over FIXED ids with a FIXED seed — stored literals.
-- ---------------------------------------------------------------------------
select is(
  public.draft_resolve_order_internal('b0500000-0000-4000-8000-0000000000aa', 8, 'random',
    null, null, '00000000-0000-4000-8000-000000000102', 'golden'),
  '["d0500000-0000-4000-8000-00aa00000003", "d0500000-0000-4000-8000-00aa00000002",
    "d0500000-0000-4000-8000-00aa00000005", "d0500000-0000-4000-8000-00aa00000004",
    "d0500000-0000-4000-8000-00aa00000001", "d0500000-0000-4000-8000-00aa00000007",
    "d0500000-0000-4000-8000-00aa00000006", "d0500000-0000-4000-8000-00aa00000008"]'::jsonb,
  'UNPINNED SHUFFLE = THE PRE-102 LITERAL (MS.8 item 4''s byte-for-byte backward-compat pin): no pin args, the shipped md5(seed || id) order verbatim');
select is(
  public.draft_resolve_order_internal('b0500000-0000-4000-8000-0000000000aa', 8, 'random',
    null, null, '00000000-0000-4000-8000-000000000102', 'golden',
    'd0500000-0000-4000-8000-00aa00000003', 3),
  '["d0500000-0000-4000-8000-00aa00000002", "d0500000-0000-4000-8000-00aa00000005",
    "d0500000-0000-4000-8000-00aa00000003", "d0500000-0000-4000-8000-00aa00000004",
    "d0500000-0000-4000-8000-00aa00000001", "d0500000-0000-4000-8000-00aa00000007",
    "d0500000-0000-4000-8000-00aa00000006", "d0500000-0000-4000-8000-00aa00000008"]'::jsonb,
  'PINNED SHUFFLE = THE SAME LITERAL minus the pinned seat, spliced at slot 3 (index 2) — the other seven keep their exact md5 order (D223(5): a constraint on the ONE shuffle, not a second randomizer)');
select is(
  public.draft_resolve_order_internal('b0500000-0000-4000-8000-0000000000aa', 8, 'random',
    null, null, '00000000-0000-4000-8000-000000000102', 'golden',
    'd0500000-0000-4000-8000-00aa00000003', 3),
  public.draft_resolve_order_internal('b0500000-0000-4000-8000-0000000000aa', 8, 'random',
    null, null, '00000000-0000-4000-8000-000000000102', 'golden',
    'd0500000-0000-4000-8000-00aa00000003', 3),
  'the same (seed, slot) replays IDENTICALLY — determinism is the contract the sim and mock replayability rest on (D223(5))');
select throws_ok(
  $$ select public.draft_resolve_order_internal('b0500000-0000-4000-8000-0000000000dd', 8, 'manual',
       null, (select settings->'draft'->'draft_order' from leagues
              where id = 'b0500000-0000-4000-8000-0000000000dd'),
       '00000000-0000-4000-8000-000000000102', 'create_mock_draft',
       'd0500000-0000-4000-8000-00dd00000002', 3) $$,
  'create_mock_draft: a stored order already covers this league — a practice draft inherits it (§8.8/D223); launch without a slot to practice from the stored order',
  'a MANUAL-mode league''s stored order + a requested slot = the drawn-order refusal (§8.8 fidelity: inherit, never silently ignore the slot)');
select throws_ok(
  $$ select public.draft_nomination_order_internal('b0500000-0000-4000-8000-0000000000dd', 8, 'manual',
       (select settings->'draft'->'draft_order' from leagues
        where id = 'b0500000-0000-4000-8000-0000000000dd'),
       null, '00000000-0000-4000-8000-000000000102', 'create_mock_draft', null,
       'd0500000-0000-4000-8000-00dd00000002', 3) $$,
  'create_mock_draft: a stored order already covers this league — a practice draft inherits it (§8.8/D223); launch without a slot to practice from the stored order',
  'a drawn MANUAL nomination order + a requested slot refuses with the SAME sentence — one refusal, both orders (D261: the auction''s slot is the nomination position)');
select lives_ok(
  $$ select public.draft_resolve_order_internal('b0500000-0000-4000-8000-0000000000aa', 8, 'random',
       null, null, '00000000-0000-4000-8000-000000000102', 'golden') $$,
  'THE 7-ARG CALL TEXT STILL BINDS (D201(2)/AP.5): draft_start''s own call shape, unchanged, defaults both pins to NULL');
select is(
  public.draft_nomination_order_internal('b0500000-0000-4000-8000-0000000000aa', 8, 'random',
    null, null, '00000000-0000-4000-8000-000000000102', 'golden', null,
    'd0500000-0000-4000-8000-00aa00000003', 5)->>4,
  'd0500000-0000-4000-8000-00aa00000003',
  'the nomination internal PASSES THE PIN THROUGH to the one shuffle: random mode, derived seed, human at slot 5 (index 4)');
select throws_ok(
  $$ select public.draft_resolve_order_internal('b0500000-0000-4000-8000-0000000000aa', 8, 'random',
       null, null, '00000000-0000-4000-8000-000000000102', 'golden',
       'd0500000-0000-4000-8000-00aa00000003', 9) $$,
  'golden: pin slot 9 is out of range for 8 teams',
  'the resolver''s own defensive bound (create_mock_draft refuses first on the wire; this floor covers any future internal caller)');

-- ---------------------------------------------------------------------------
-- C. Standalone slots end to end. u1 launches at 1, 4 and 8 (the D146 legal
--    edges plus a middle); u3 launches the default. The settings object is
--    one constant shape (8 teams, 1 RB + 1 bench).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90500000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft(
       p_settings := '{"team_count": 8,
                       "roster_settings": {"starting_slots": [
                          {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                          "bench": 1, "ir_slots": [], "swap_spots": 0},
                       "draft": {"draft_type": "snake", "pick_timer_seconds": 90}}'::jsonb,
       p_cpu_speed := 'fast', p_slot := 1) $$,
  'SLOT 1 LAUNCHES (D146: the low legal edge)');
select lives_ok(
  $$ select public.create_mock_draft(
       p_settings := '{"team_count": 8,
                       "roster_settings": {"starting_slots": [
                          {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                          "bench": 1, "ir_slots": [], "swap_spots": 0},
                       "draft": {"draft_type": "snake", "pick_timer_seconds": 90}}'::jsonb,
       p_cpu_speed := 'fast', p_slot := 4) $$,
  'SLOT 4 LAUNCHES (a middle slot)');
select lives_ok(
  $$ select public.create_mock_draft(
       p_settings := '{"team_count": 8,
                       "roster_settings": {"starting_slots": [
                          {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                          "bench": 1, "ir_slots": [], "swap_spots": 0},
                       "draft": {"draft_type": "snake", "pick_timer_seconds": 90}}'::jsonb,
       p_cpu_speed := 'fast', p_slot := 8) $$,
  'SLOT 8 = N LAUNCHES (D146: the high legal edge)');
-- The refusals, one unit past each edge — BEFORE any row exists to prove
-- nothing was minted by them.
select throws_ok(
  $$ select public.create_mock_draft(
       p_settings := '{"team_count": 8,
                       "roster_settings": {"starting_slots": [
                          {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                          "bench": 1, "ir_slots": [], "swap_spots": 0},
                       "draft": {"draft_type": "snake", "pick_timer_seconds": 90}}'::jsonb,
       p_slot := 0) $$,
  'create_mock_draft: slot 0 is out of range — this practice draft has 8 seats (pick 1..8, or leave the slot on Random)',
  'SLOT 0 REFUSES BY NAME (D146: one unit below the edge)');
select throws_ok(
  $$ select public.create_mock_draft(
       p_settings := '{"team_count": 8,
                       "roster_settings": {"starting_slots": [
                          {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                          "bench": 1, "ir_slots": [], "swap_spots": 0},
                       "draft": {"draft_type": "snake", "pick_timer_seconds": 90}}'::jsonb,
       p_slot := 9) $$,
  'create_mock_draft: slot 9 is out of range — this practice draft has 8 seats (pick 1..8, or leave the slot on Random)',
  'SLOT N+1 REFUSES BY NAME (D146: one unit above the edge)');
reset role;

create temp table ms8_mocks as
select d.id, d.draft_order, d.nomination_order, d.draft_type,
       (d.config->'mock'->>'human_team_id')::uuid as human,
       d.config->'mock'->'cpu_seats' as cpu_seats
from drafts d
where d.is_mock and d.league_id is null
  and d.config->'mock'->>'launched_by' = '90500000-0000-4000-8000-000000000001';

select is((select count(*) from ms8_mocks), 3::bigint,
  'exactly the three slotted launches exist for u1 — the two refusals minted NOTHING (never let "nothing happened" mean "it worked": asserted, with the refusal texts pinned above as the reason)');

-- Which mock is which is read off the human seat's index — that IS the pin.
select is(
  (select count(*) from ms8_mocks m where m.draft_order->>0 = m.human::text), 1::bigint,
  'ONE mock carries the human at index 0 — slot 1, exactly as chosen');
select is(
  (select count(*) from ms8_mocks m where m.draft_order->>3 = m.human::text), 1::bigint,
  'ONE mock carries the human at index 3 — slot 4, exactly as chosen');
select is(
  (select count(*) from ms8_mocks m where m.draft_order->>7 = m.human::text), 1::bigint,
  'ONE mock carries the human at index 7 — slot 8 = N, exactly as chosen');
select is(
  (select count(*) from ms8_mocks m
    where (select count(distinct e.val) from jsonb_array_elements_text(m.draft_order) e(val)) = 8
      and (select count(*) from jsonb_array_elements_text(m.draft_order) e(val)
            join teams t on t.id::text = e.val
           where t.league_id is null
             and t.owner_id = '90500000-0000-4000-8000-000000000001') = 8),
  3::bigint,
  'every order is a PERMUTATION of that mock''s own 8 minted seats — none dropped, none duplicated, none borrowed from anywhere else (§8.8)');
-- Determinism: the stored order IS the seeded formula — the same splice the
-- migration performs, recomputed here from the mock's own id. A shuffle
-- seeded by anything else (wall clock, random()) cannot reproduce it.
select is(
  (select count(*) from ms8_mocks m
    where m.draft_order->>3 = m.human::text
      and m.draft_order = jsonb_insert(
            (select coalesce(jsonb_agg(to_jsonb(s.id::uuid)
                      order by md5(m.id::text || s.id)), '[]'::jsonb)
               from jsonb_array_elements_text(m.cpu_seats) s(id)),
            array['3'], to_jsonb(m.human))),
  1::bigint,
  'the slot-4 order equals its own seeded recomputation — md5(mock_id || id) over the bots, human spliced at index 3: deterministic per (mock_id, slot), D223(5)');

-- u3's DEFAULT launch: no slot, the pre-102 formula byte-for-byte.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90500000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft(
       p_settings := '{"team_count": 8,
                       "roster_settings": {"starting_slots": [
                          {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                          "bench": 1, "ir_slots": [], "swap_spots": 0},
                       "draft": {"draft_type": "snake", "pick_timer_seconds": 90}}'::jsonb,
       p_cpu_speed := 'fast') $$,
  'a DEFAULT launch (no slot at all) still lives — the control ignored is the control unchanged');
reset role;
select is(
  (select count(*) from drafts d
    where d.is_mock and d.league_id is null
      and d.config->'mock'->>'launched_by' = '90500000-0000-4000-8000-000000000003'
      and d.draft_order = (
        select jsonb_agg(to_jsonb(t.id) order by md5(d.id::text || t.id::text))
          from teams t
         where t.league_id is null
           and t.owner_id = '90500000-0000-4000-8000-000000000003')),
  1::bigint,
  'DEFAULT RANDOM = THE PRE-102 FORMULA BYTE-FOR-BYTE: md5(mock_id || id) over ALL seats, human unpinned — the backward-compat equivalence (MS.8 item 4)');

-- ---------------------------------------------------------------------------
-- D. The auction meaning (D261): the slot is the nomination position too.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90500000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft(
       p_settings := '{"team_count": 8,
                       "roster_settings": {"starting_slots": [
                          {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                          "bench": 1, "ir_slots": [], "swap_spots": 0},
                       "draft": {"draft_type": "auction", "auction_budget": 200,
                                 "auction_nomination_seconds": 30, "auction_bid_seconds": 20,
                                 "auction_anti_snipe_seconds": 10}}'::jsonb,
       p_cpu_speed := 'fast', p_slot := 2) $$,
  'an auction mock launches at slot 2 (nomination mode = same_as_draft_order, the default)');
select lives_ok(
  $$ select public.create_mock_draft(
       p_settings := '{"team_count": 8,
                       "roster_settings": {"starting_slots": [
                          {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                          "bench": 1, "ir_slots": [], "swap_spots": 0},
                       "draft": {"draft_type": "auction", "nomination_order_mode": "random",
                                 "auction_budget": 200,
                                 "auction_nomination_seconds": 30, "auction_bid_seconds": 20,
                                 "auction_anti_snipe_seconds": 10}}'::jsonb,
       p_cpu_speed := 'fast', p_slot := 5) $$,
  '…and one with an INDEPENDENTLY-random nomination order, at slot 5');
reset role;

create temp table ms8_auctions as
select d.id, d.draft_order, d.nomination_order,
       (d.config->'mock'->>'human_team_id')::uuid as human,
       d.config->'mock'->'cpu_seats' as cpu_seats,
       d.config->>'nomination_order_mode' as nom_mode
from drafts d
where d.is_mock and d.league_id is null
  and d.config->'mock'->>'launched_by' = '90500000-0000-4000-8000-000000000004';

select is((select count(*) from ms8_auctions), 2::bigint,
  'both auction launches exist (F94)');
select is(
  (select count(*) from ms8_auctions m
    where m.nom_mode is distinct from 'random'
      and m.draft_order->>1 = m.human::text
      and m.nomination_order->>1 = m.human::text
      and m.nomination_order = m.draft_order),
  1::bigint,
  'SAME_AS_DRAFT_ORDER: slot 2 puts the human at index 1 in BOTH orders, which are equal by construction — "slot 2" means you nominate second (D261)');
select is(
  (select count(*) from ms8_auctions m
    where m.nom_mode = 'random'
      and m.draft_order->>4 = m.human::text
      and m.nomination_order->>4 = m.human::text
      and m.nomination_order = jsonb_insert(
            (select coalesce(jsonb_agg(to_jsonb(s.id::uuid)
                      order by md5(md5('nomination:' || m.id::text) || s.id)), '[]'::jsonb)
               from jsonb_array_elements_text(m.cpu_seats) s(id)),
            array['4'], to_jsonb(m.human))),
  1::bigint,
  'INDEPENDENT RANDOM: the human sits at slot 5 in BOTH orders, and the nomination order equals its own DERIVED-seed recomputation (084''s md5(''nomination:'' || id) seed — two shuffles, one slot, no carbon copy)');

-- ---------------------------------------------------------------------------
-- E. The league arm. LA is UNDRAWN (no real draft row — the normal case);
--    LC is DRAWN. u2 is a member of both; the launch takes their franchise.
-- ---------------------------------------------------------------------------
create temp table ms8_league_before as
select to_jsonb(l.*)::text as row_text, l.id
from leagues l where l.name like 'pgtap-ms8-%';
create temp table ms8_real_before as
select to_jsonb(d.*)::text as row_text
from drafts d where d.id = 'e0500000-0000-4000-8000-0000000000cc';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90500000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft(
       p_league_id := 'b0500000-0000-4000-8000-0000000000aa', p_slot := 3) $$,
  'THE UNDRAWN LEAGUE LAUNCH — the ruling''s motivating case: no real order exists ("most drafts will set the order right before"), and the launcher still practices from slot 3');
select throws_ok(
  $$ select public.create_mock_draft(
       p_league_id := 'b0500000-0000-4000-8000-0000000000cc', p_slot := 2) $$,
  'create_mock_draft: a stored order already covers this league — a practice draft inherits it (§8.8/D223); launch without a slot to practice from the stored order',
  'THE DRAWN LEAGUE + A SLOT REFUSES BY NAME: the mock inherits a drawn order (§8.8 fidelity "order incl. their actual slot") — a slot silently ignored would be a control that lies');
select lives_ok(
  $$ select public.create_mock_draft(
       p_league_id := 'b0500000-0000-4000-8000-0000000000cc') $$,
  '…and the slotless launch on the same league lives — inheritance is the sanctioned path');
select throws_ok(
  $$ select public.create_mock_draft(
       p_league_id := 'b0500000-0000-4000-8000-0000000000aa', p_slot := 9) $$,
  'create_mock_draft: slot 9 is out of range — this practice draft has 8 seats (pick 1..8, or leave the slot on Random)',
  'the league arm range-checks against ITS board (8 seats), same sentence as the standalone arm');
reset role;

select is(
  (select count(*) from drafts d
    where d.is_mock and d.league_id = 'b0500000-0000-4000-8000-0000000000aa'
      and d.config->'mock'->>'launched_by' = '90500000-0000-4000-8000-000000000002'
      and d.draft_order->>2 = 'd0500000-0000-4000-8000-00aa00000002'
      and d.draft_order = jsonb_insert(
            (select coalesce(jsonb_agg(to_jsonb(t.id)
                      order by md5(d.id::text || t.id::text)), '[]'::jsonb)
               from teams t
              where t.league_id = d.league_id and t.status <> 'retired'
                and t.id <> 'd0500000-0000-4000-8000-00aa00000002'),
            array['2'], to_jsonb('d0500000-0000-4000-8000-00aa00000002'::uuid))),
  1::bigint,
  'the league mock carries u2''s OWN franchise (the default seat) at index 2 = slot 3, with the other SEVEN league franchises in their exact seeded order around it');
select is(
  (select d.draft_order from drafts d
    where d.is_mock and d.league_id = 'b0500000-0000-4000-8000-0000000000cc'
      and d.config->'mock'->>'launched_by' = '90500000-0000-4000-8000-000000000002'),
  '["d0500000-0000-4000-8000-00cc00000008", "d0500000-0000-4000-8000-00cc00000007",
    "d0500000-0000-4000-8000-00cc00000006", "d0500000-0000-4000-8000-00cc00000005",
    "d0500000-0000-4000-8000-00cc00000004", "d0500000-0000-4000-8000-00cc00000003",
    "d0500000-0000-4000-8000-00cc00000002", "d0500000-0000-4000-8000-00cc00000001"]'::jsonb,
  'the slotless drawn-league mock INHERITS the drawn order VERBATIM — the stored literal, t8..t1 (§8.8 fidelity, unchanged by 102)');

-- §8.8 composites (R383 whole-row, not counts): every league row and the
-- real draft row are byte-identical around all six launches/refusals above.
select is(
  (select count(*) from ms8_league_before b
     join leagues l on l.id = b.id
    where to_jsonb(l.*)::text is distinct from b.row_text),
  0::bigint,
  'ALL FOUR league rows are byte-identical around every launch and refusal — the slot writes the MOCK''S OWN order and nothing else (§8.8; R383 whole-row composite)');
select is(
  (select to_jsonb(d.*)::text from drafts d
    where d.id = 'e0500000-0000-4000-8000-0000000000cc'),
  (select row_text from ms8_real_before),
  '…and the REAL drawn draft row is byte-identical too — its negotiated order was read as a candidate, never written (E77: the isolation assertion is over the stored order)');

-- ---------------------------------------------------------------------------
-- F. The 5-arg call text still binds at the wire RPC (D201(2)/AP.5).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90500000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft('b0500000-0000-4000-8000-0000000000aa',
       null, 'fast', null, null) $$,
  'A POSITIONAL 5-ARGUMENT CALL — the pre-102 signature text — still binds, p_slot defaulting to NULL: no caller anywhere is broken by the appended parameter');
reset role;
select is(
  (select count(*) from drafts d
    where d.is_mock and d.league_id = 'b0500000-0000-4000-8000-0000000000aa'
      and d.config->'mock'->>'launched_by' = '90500000-0000-4000-8000-000000000003'
      and d.draft_order = (
        select jsonb_agg(to_jsonb(t.id) order by md5(d.id::text || t.id::text))
          from teams t
         where t.league_id = d.league_id and t.status <> 'retired')),
  1::bigint,
  '…and its order is the pre-102 formula byte-for-byte over the league''s seats — the 5-arg path IS the old behaviour, both arms');

select * from finish();
rollback;
