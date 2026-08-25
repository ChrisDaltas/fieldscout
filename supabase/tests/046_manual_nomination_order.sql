-- ============================================================================
-- The auction's manual nomination order becomes reachable — pgTAP 046
-- (migration 098, task AP.5; spec v2.16 §7.3.8 `nomination_order` row + its
-- validation bullet, §8.3's auction line; D101/D201; ledger F80).
--
-- WHAT THIS FILE OWNS vs its neighbours: 033 §E owns the three
-- nomination_order_mode arms AS 084 SHIPPED THEM — the random shuffle
-- golden, the manual candidate path, and the refusal with NO order anywhere
-- (its 033:518 text pin passes UNTOUCHED after 098, which is the
-- byte-identical-RAISE requirement made executable). This file owns what 098
-- ADDS: the settings-catalog fallback. The exact league that F80 recorded as
-- UNSTARTABLE — `nomination_order_mode: manual` stored, an order saved in
-- League settings, nothing on the draft row — now starts, and every
-- neighbouring behaviour is pinned unchanged.
--
-- Falsifiability notes (§4.3):
--   * THE HYDRATED ORDERS ARE STORED LITERALS (MA's settings array verbatim;
--     MB's draft-row candidate verbatim; MD's seeded shuffle), never
--     re-derivations.
--   * CANDIDATE-WINS IS PINNED AS A DIFFERENCE: MB stores BOTH a draft-row
--     candidate and a settings order and the candidate hydrates — a
--     resolution that read the settings first would go RED on the literal.
--   * RANDOM IGNORES THE FIELD (R123/R126's manual-only rule, carried over
--     from draft_order): MD stores a settings order under `random` and the
--     result is the seeded shuffle, pinned equal to its literal AND distinct
--     from the stored settings array.
--   * THE REFUSAL SURVIVES: MC has an INVALID settings order (7 of 8) and no
--     candidate — the byte-identical 084 text raises and no partial state is
--     left (CLAUDE.md: never let "nothing happened" mean "it worked").
--   * THE 7-ARGUMENT CALL TEXT STILL BINDS (the DROP+CREATE added
--     `p_config_order` LAST and DEFAULTed, D201(2)): called with 7 args and
--     no candidate, the manual arm refuses exactly as pre-098.
--   * BREAK PROBE (shown RED in the PR, then reverted): removing the
--     settings-fallback WHEN arm from 098's CASE turns MA's start, MB's
--     nothing (candidate), and the unit fallback pin RED with the pinned
--     text — the probe run names the exact failures.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(21);

-- ---------------------------------------------------------------------------
-- A. Function form (§4.1; D201(2)'s DROP+CREATE)
-- ---------------------------------------------------------------------------
select has_function('public', 'draft_nomination_order_internal',
  array['uuid', 'integer', 'text', 'jsonb', 'jsonb', 'uuid', 'text', 'jsonb'],
  'draft_nomination_order_internal grew the trailing p_config_order (098/AP.5)');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_nomination_order_internal'),
  1::bigint,
  'exactly ONE definition — the 7-arg signature was DROPPED, not overloaded (the 087 ambiguity trap, D201(2))');
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_nomination_order_internal'),
  'still a plain internal (callers are DEFINER) with search_path='''' after the re-create');
select ok(
  not has_function_privilege('anon',
    'public.draft_nomination_order_internal(uuid,integer,text,jsonb,jsonb,uuid,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated',
    'public.draft_nomination_order_internal(uuid,integer,text,jsonb,jsonb,uuid,text,jsonb)', 'EXECUTE'),
  'the REVOKE was re-emitted for the NEW signature (a dropped function forgets its ACL)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (privileged except §F; league letters in the header comment)
--    MA manual + settings order, nothing on the draft row  ← F80's trap
--    MB manual + settings order + a DIFFERENT draft-row candidate (D101)
--    MC manual + INVALID settings order (7 of 8), no candidate
--    MD random + a settings order it must ignore (R123/R126)
--    ME MA's shape again, practiced in via create_mock_draft (the second
--       call site of D201(2))
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '8d000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-mn1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "mn_commish"}', now(), now());

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings)
values
  ('a6000000-0000-4000-8000-0000000000aa', '8d000000-0000-4000-8000-000000000001',
   'pgtap-mn-MA-settings-order', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "random",
     "nomination_order_mode": "manual",
     "nomination_order": ["c6000000-0000-4000-8000-00aa00000008","c6000000-0000-4000-8000-00aa00000007",
                          "c6000000-0000-4000-8000-00aa00000006","c6000000-0000-4000-8000-00aa00000005",
                          "c6000000-0000-4000-8000-00aa00000004","c6000000-0000-4000-8000-00aa00000003",
                          "c6000000-0000-4000-8000-00aa00000002","c6000000-0000-4000-8000-00aa00000001"],
     "auction_budget": 200, "pick_timer_seconds": 90}}'),
  ('a6000000-0000-4000-8000-0000000000bb', '8d000000-0000-4000-8000-000000000001',
   'pgtap-mn-MB-candidate-wins', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "random",
     "nomination_order_mode": "manual",
     "nomination_order": ["c6000000-0000-4000-8000-00bb00000008","c6000000-0000-4000-8000-00bb00000007",
                          "c6000000-0000-4000-8000-00bb00000006","c6000000-0000-4000-8000-00bb00000005",
                          "c6000000-0000-4000-8000-00bb00000004","c6000000-0000-4000-8000-00bb00000003",
                          "c6000000-0000-4000-8000-00bb00000002","c6000000-0000-4000-8000-00bb00000001"],
     "auction_budget": 200, "pick_timer_seconds": 90}}'),
  ('a6000000-0000-4000-8000-0000000000cc', '8d000000-0000-4000-8000-000000000001',
   'pgtap-mn-MC-invalid-settings', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   -- SEVEN entries against team_count 8 — array-shaped, wrong coverage.
   '{"draft": {"draft_type": "auction", "draft_order_mode": "random",
     "nomination_order_mode": "manual",
     "nomination_order": ["c6000000-0000-4000-8000-00cc00000007","c6000000-0000-4000-8000-00cc00000006",
                          "c6000000-0000-4000-8000-00cc00000005","c6000000-0000-4000-8000-00cc00000004",
                          "c6000000-0000-4000-8000-00cc00000003","c6000000-0000-4000-8000-00cc00000002",
                          "c6000000-0000-4000-8000-00cc00000001"],
     "auction_budget": 200, "pick_timer_seconds": 90}}'),
  ('a6000000-0000-4000-8000-0000000000dd', '8d000000-0000-4000-8000-000000000001',
   'pgtap-mn-MD-random-ignores', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "random",
     "nomination_order_mode": "random",
     "nomination_order": ["c6000000-0000-4000-8000-00dd00000008","c6000000-0000-4000-8000-00dd00000007",
                          "c6000000-0000-4000-8000-00dd00000006","c6000000-0000-4000-8000-00dd00000005",
                          "c6000000-0000-4000-8000-00dd00000004","c6000000-0000-4000-8000-00dd00000003",
                          "c6000000-0000-4000-8000-00dd00000002","c6000000-0000-4000-8000-00dd00000001"],
     "auction_budget": 200, "pick_timer_seconds": 90}}'),
  ('a6000000-0000-4000-8000-0000000000ee', '8d000000-0000-4000-8000-000000000001',
   'pgtap-mn-ME-mock-arm', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "random",
     "nomination_order_mode": "manual",
     "nomination_order": ["c6000000-0000-4000-8000-00ee00000008","c6000000-0000-4000-8000-00ee00000007",
                          "c6000000-0000-4000-8000-00ee00000006","c6000000-0000-4000-8000-00ee00000005",
                          "c6000000-0000-4000-8000-00ee00000004","c6000000-0000-4000-8000-00ee00000003",
                          "c6000000-0000-4000-8000-00ee00000002","c6000000-0000-4000-8000-00ee00000001"],
     "auction_budget": 200, "pick_timer_seconds": 90}}');

insert into teams (id, owner_id, name, league_id)
select ('c6000000-0000-4000-8000-00' || sfx || '000000' || lpad(i::text, 2, '0'))::uuid,
       '8d000000-0000-4000-8000-000000000001', 'pgtap-mn-' || sfx || '-t' || i,
       ('a6000000-0000-4000-8000-0000000000' || sfx)::uuid
from unnest(array['aa', 'bb', 'cc', 'dd', 'ee']) sfx, generate_series(1, 8) i;

-- Fixed draft ids so every hydrated order is pinned against a literal.
-- MA: NOTHING on the draft row — the settings order is all there is.
-- MB: a candidate (rotate-by-one) that must WIN over the settings order.
-- MD: random mode; the settings order below it must be ignored.
-- ME: the real draft row a league mock snapshots from — still scheduled,
--     still empty-handed, exactly the pre-draft-day practice situation.
insert into drafts (id, league_id, draft_type, status, is_mock, config, nomination_order) values
  ('e6000000-0000-4000-8000-0000000000aa', 'a6000000-0000-4000-8000-0000000000aa',
   'auction', 'scheduled', false, '{}', null),
  ('e6000000-0000-4000-8000-0000000000bb', 'a6000000-0000-4000-8000-0000000000bb',
   'auction', 'scheduled', false, '{}',
   '["c6000000-0000-4000-8000-00bb00000002","c6000000-0000-4000-8000-00bb00000003",
     "c6000000-0000-4000-8000-00bb00000004","c6000000-0000-4000-8000-00bb00000005",
     "c6000000-0000-4000-8000-00bb00000006","c6000000-0000-4000-8000-00bb00000007",
     "c6000000-0000-4000-8000-00bb00000008","c6000000-0000-4000-8000-00bb00000001"]'::jsonb),
  ('e6000000-0000-4000-8000-0000000000dd', 'a6000000-0000-4000-8000-0000000000dd',
   'auction', 'scheduled', false, '{}', null),
  ('e6000000-0000-4000-8000-0000000000ee', 'a6000000-0000-4000-8000-0000000000ee',
   'auction', 'scheduled', false, '{}', null);

-- ---------------------------------------------------------------------------
-- C. MA — F80's exact trap starts (manual + settings order, empty draft row)
-- ---------------------------------------------------------------------------
select is(
  (public.draft_start_internal('a6000000-0000-4000-8000-0000000000aa', false)->>'started')::boolean,
  true,
  'MA: manual + an order saved ONLY in League settings STARTS — the league F80 recorded as unstartable');
select is(
  (select nomination_order from drafts where id = 'e6000000-0000-4000-8000-0000000000aa'),
  '["c6000000-0000-4000-8000-00aa00000008", "c6000000-0000-4000-8000-00aa00000007", "c6000000-0000-4000-8000-00aa00000006", "c6000000-0000-4000-8000-00aa00000005", "c6000000-0000-4000-8000-00aa00000004", "c6000000-0000-4000-8000-00aa00000003", "c6000000-0000-4000-8000-00aa00000002", "c6000000-0000-4000-8000-00aa00000001"]'::jsonb,
  'GOLDEN: the settings order hydrates into drafts.nomination_order VERBATIM (§7.3.8: "hydrated … at start")');
select is(
  (select on_clock_team_id from drafts where id = 'e6000000-0000-4000-8000-0000000000aa'),
  'c6000000-0000-4000-8000-00aa00000008'::uuid,
  '…and the first nominator is the settings order''s head');
select ok(
  (select nomination_order is distinct from draft_order
   from drafts where id = 'e6000000-0000-4000-8000-0000000000aa'),
  '…independent of the (random) draft order — §8.3''s two orders stay two settings');

-- ---------------------------------------------------------------------------
-- D. MB — the draft-row candidate WINS over the settings order (D101)
-- ---------------------------------------------------------------------------
select is(
  (public.draft_start_internal('a6000000-0000-4000-8000-0000000000bb', false)->>'started')::boolean,
  true,
  'MB: manual with BOTH a draft-row candidate and a settings order starts');
select is(
  (select nomination_order from drafts where id = 'e6000000-0000-4000-8000-0000000000bb'),
  '["c6000000-0000-4000-8000-00bb00000002", "c6000000-0000-4000-8000-00bb00000003", "c6000000-0000-4000-8000-00bb00000004", "c6000000-0000-4000-8000-00bb00000005", "c6000000-0000-4000-8000-00bb00000006", "c6000000-0000-4000-8000-00bb00000007", "c6000000-0000-4000-8000-00bb00000008", "c6000000-0000-4000-8000-00bb00000001"]'::jsonb,
  'GOLDEN: the CANDIDATE hydrates (rotate-by-one), NOT the settings array (reversed) — D101 candidate-wins, the draft_order rule unforked');

-- ---------------------------------------------------------------------------
-- E. MC — an invalid settings order still refuses, byte-identically
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.draft_start_internal('a6000000-0000-4000-8000-0000000000cc', false) $$,
  'P0001',
  'draft_start: league a6000000-0000-4000-8000-0000000000cc has nomination_order_mode=manual but the stored nomination order does not cover every active franchise exactly once — set the nomination order in the commissioner panel, or switch nomination_order_mode to same_as_draft_order (§8.3)',
  'MC: a 7-of-8 settings order is refused with 084''s text BYTE-IDENTICAL (the AP.5 requirement; 033:518 pins the no-order-anywhere arm)');
select is(
  (select status || '|' || (select count(*) from drafts
     where league_id = 'a6000000-0000-4000-8000-0000000000cc')::text
   from leagues where id = 'a6000000-0000-4000-8000-0000000000cc'),
  'scheduled|0',
  '…and the refused start left NO partial state (never let "nothing happened" mean "it worked")');

-- ---------------------------------------------------------------------------
-- F. MD — `random` IGNORES the settings field (R123/R126: fallback is
--    manual-only, carried over from draft_order)
-- ---------------------------------------------------------------------------
select is(
  (public.draft_start_internal('a6000000-0000-4000-8000-0000000000dd', false)->>'started')::boolean,
  true,
  'MD: random mode with a settings nomination_order present still starts');
select is(
  (select nomination_order from drafts where id = 'e6000000-0000-4000-8000-0000000000dd'),
  '["c6000000-0000-4000-8000-00dd00000008", "c6000000-0000-4000-8000-00dd00000004", "c6000000-0000-4000-8000-00dd00000002", "c6000000-0000-4000-8000-00dd00000006", "c6000000-0000-4000-8000-00dd00000005", "c6000000-0000-4000-8000-00dd00000001", "c6000000-0000-4000-8000-00dd00000003", "c6000000-0000-4000-8000-00dd00000007"]'::jsonb,
  'GOLDEN: the result is the md5(''nomination:'' || draft_id) SHUFFLE — a random league''s stored settings order changes nothing (a stored literal, the 020 LK precedent)');
select ok(
  (select nomination_order <> '["c6000000-0000-4000-8000-00dd00000008", "c6000000-0000-4000-8000-00dd00000007", "c6000000-0000-4000-8000-00dd00000006", "c6000000-0000-4000-8000-00dd00000005", "c6000000-0000-4000-8000-00dd00000004", "c6000000-0000-4000-8000-00dd00000003", "c6000000-0000-4000-8000-00dd00000002", "c6000000-0000-4000-8000-00dd00000001"]'::jsonb
   from drafts where id = 'e6000000-0000-4000-8000-0000000000dd'),
  '…and it is NOT the stored settings array — the discriminating half of the golden above');

-- ---------------------------------------------------------------------------
-- G. Unit level — the resolution CASE itself
-- ---------------------------------------------------------------------------
select is(
  public.draft_nomination_order_internal(
    'a6000000-0000-4000-8000-0000000000cc', 8, 'manual',
    null, null, 'e6000000-0000-4000-8000-0000000000cc', 'draft_start',
    '["c6000000-0000-4000-8000-00cc00000001","c6000000-0000-4000-8000-00cc00000002",
      "c6000000-0000-4000-8000-00cc00000003","c6000000-0000-4000-8000-00cc00000004",
      "c6000000-0000-4000-8000-00cc00000005","c6000000-0000-4000-8000-00cc00000006",
      "c6000000-0000-4000-8000-00cc00000007","c6000000-0000-4000-8000-00cc00000008"]'::jsonb),
  '["c6000000-0000-4000-8000-00cc00000001", "c6000000-0000-4000-8000-00cc00000002", "c6000000-0000-4000-8000-00cc00000003", "c6000000-0000-4000-8000-00cc00000004", "c6000000-0000-4000-8000-00cc00000005", "c6000000-0000-4000-8000-00cc00000006", "c6000000-0000-4000-8000-00cc00000007", "c6000000-0000-4000-8000-00cc00000008"]'::jsonb,
  'NULL candidate + valid p_config_order → the settings order, verbatim (the 098 fallback at unit level)');
select is(
  public.draft_nomination_order_internal(
    'a6000000-0000-4000-8000-0000000000cc', 8, 'manual',
    '["c6000000-0000-4000-8000-00cc00000008","c6000000-0000-4000-8000-00cc00000007",
      "c6000000-0000-4000-8000-00cc00000006","c6000000-0000-4000-8000-00cc00000005",
      "c6000000-0000-4000-8000-00cc00000004","c6000000-0000-4000-8000-00cc00000003",
      "c6000000-0000-4000-8000-00cc00000002","c6000000-0000-4000-8000-00cc00000001"]'::jsonb,
    null, 'e6000000-0000-4000-8000-0000000000cc', 'draft_start',
    '["c6000000-0000-4000-8000-00cc00000001","c6000000-0000-4000-8000-00cc00000002",
      "c6000000-0000-4000-8000-00cc00000003","c6000000-0000-4000-8000-00cc00000004",
      "c6000000-0000-4000-8000-00cc00000005","c6000000-0000-4000-8000-00cc00000006",
      "c6000000-0000-4000-8000-00cc00000007","c6000000-0000-4000-8000-00cc00000008"]'::jsonb),
  '["c6000000-0000-4000-8000-00cc00000008", "c6000000-0000-4000-8000-00cc00000007", "c6000000-0000-4000-8000-00cc00000006", "c6000000-0000-4000-8000-00cc00000005", "c6000000-0000-4000-8000-00cc00000004", "c6000000-0000-4000-8000-00cc00000003", "c6000000-0000-4000-8000-00cc00000002", "c6000000-0000-4000-8000-00cc00000001"]'::jsonb,
  'BOTH present → the candidate wins (D101, the resolve-order CASE verbatim)');
select throws_ok(
  $$ select public.draft_nomination_order_internal(
       'a6000000-0000-4000-8000-0000000000cc', 8, 'manual',
       null, null, 'e6000000-0000-4000-8000-0000000000cc', 'draft_start') $$,
  'P0001', null,
  'a SEVEN-argument call still binds (p_config_order defaults to NULL) and refuses exactly as pre-098 — the D201(2) compatibility decision, executable');
select throws_ok(
  $$ select public.draft_nomination_order_internal(
       'a6000000-0000-4000-8000-0000000000cc', 8, 'manual',
       null, null, 'e6000000-0000-4000-8000-0000000000cc', 'draft_start',
       '["not-a-uuid","c6000000-0000-4000-8000-00cc00000002",
         "c6000000-0000-4000-8000-00cc00000003","c6000000-0000-4000-8000-00cc00000004",
         "c6000000-0000-4000-8000-00cc00000005","c6000000-0000-4000-8000-00cc00000006",
         "c6000000-0000-4000-8000-00cc00000007","c6000000-0000-4000-8000-00cc00000008"]'::jsonb) $$,
  'P0001', null,
  'a malformed SETTINGS order fails VALIDATION (the R117 TEXT compare reaches the fallback path too), never a cast error');

-- ---------------------------------------------------------------------------
-- H. ME — the SECOND call site (create_mock_draft's league arm, D201(2)):
--    a member practices in a pre-start manual league and the mock resolves
--    the SAME order draft_start will
-- ---------------------------------------------------------------------------
insert into league_members (league_id, user_id, team_id, role)
values ('a6000000-0000-4000-8000-0000000000ee', '8d000000-0000-4000-8000-000000000001',
        'c6000000-0000-4000-8000-00ee00000001', 'commissioner');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8d000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (public.create_mock_draft('a6000000-0000-4000-8000-0000000000ee',
                            'c6000000-0000-4000-8000-00ee00000001')->>'created')::boolean,
  true,
  'ME: a league mock launches in a manual league whose real draft row has hydrated NOTHING yet (pre-098 this raised the 084 text)');
reset role;
select is(
  (select d.nomination_order from drafts d
   where d.league_id = 'a6000000-0000-4000-8000-0000000000ee' and d.is_mock),
  '["c6000000-0000-4000-8000-00ee00000008", "c6000000-0000-4000-8000-00ee00000007", "c6000000-0000-4000-8000-00ee00000006", "c6000000-0000-4000-8000-00ee00000005", "c6000000-0000-4000-8000-00ee00000004", "c6000000-0000-4000-8000-00ee00000003", "c6000000-0000-4000-8000-00ee00000002", "c6000000-0000-4000-8000-00ee00000001"]'::jsonb,
  'GOLDEN: the mock practices under the settings order VERBATIM — the same order draft_start will hydrate (§8.8: practice is the real thing''s shape)');

select * from finish();
rollback;
