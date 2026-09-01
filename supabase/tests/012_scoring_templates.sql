-- ============================================================================
-- scoring_systems.is_template + the 6 parity template rows — migration 058
-- (census cells count SEVEN template rows since 106's Scout Scoring — SC.1;
-- Scout's own golden pins live in pgTAP 054, not retrofitted here)
-- (spec §7.3.3/App B.1/B.4; task L.A1.9; PROGRESS D34/D59; standing rules
-- tasks-M1 §4).
--
-- Falsifiability notes (§4.3):
--   * Rules golden pins are the COMPLETE per-template JSONB as stored
--     literals (R23 ordered-literal pattern) — the same literals
--     templates.ts authors and templates-db.test.ts deep-equals, so a
--     drifted migration transcription fails here AND in vitest (the task's
--     deliberate-break probe flips one coefficient and shows both failing).
--   * Q8 doctrine (template rows client-immutable) is carried by ONE
--     mechanism — the `scoring_systems_template_ownerless` CHECK
--     (is_template ⇒ owner_id NULL) — plus 001's owner-scoped FOR ALL
--     policy being unable to reach owner_id-NULL rows. Both directions
--     probed: minting an owned template row (INSERT) and flipping
--     is_template on an own row (UPDATE) throw 23514 for clients AND for
--     postgres (the CHECK is role-independent); template UPDATE/DELETE by
--     clients are RLS-filtered silently → RETURNING-count 0, preceded by
--     same-role SELECT-sees-6 pins (§4.2).
--   * Counter-pins: anon sees ZERO non-template rows (the new SELECT
--     policy is is_template-scoped, not a blanket read); a non-template row
--     may freely reuse a template's name (partial-index scope — a
--     full-table UNIQUE(name) implementation fails this); owner steal
--     (UPDATE template SET owner_id = self) affects 0 rows; legit personal
--     CRUD still works (a fix that nukes 001's owner policy fails those).
--   * ESPN descriptions pinned as exact literals — the Q9 ruling's
--     user-visibility condition (the parity-exception line a commissioner
--     can read) is enforced here, not just in vitest.
--   * All privileged-context work (fixtures, constraint boundaries) runs
--     BEFORE any JWT claims are set — set_config persists to txn end
--     (D49(7) lesson).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(41);

-- ---------------------------------------------------------------------------
-- A. Shape: column, CHECK, partial unique index, policies.
-- ---------------------------------------------------------------------------
select has_column('public', 'scoring_systems', 'is_template', 'is_template column exists');
select col_type_is('public', 'scoring_systems', 'is_template', 'boolean', 'is_template is BOOLEAN');
select col_not_null('public', 'scoring_systems', 'is_template', 'is_template NOT NULL');
select col_default_is('public', 'scoring_systems', 'is_template', 'false', 'is_template defaults FALSE');

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.scoring_systems'::regclass
     and conname = 'scoring_systems_template_ownerless'),
  'CHECK (((is_template = false) OR (owner_id IS NULL)))',
  'template-ownerless CHECK pinned verbatim (is_template ⇒ owner_id NULL — the Q8 anti-shadow guard)');

select ok(
  (select indexdef from pg_indexes
   where schemaname = 'public' and tablename = 'scoring_systems'
     and indexname = 'idx_scoring_systems_template_name')
  ~ 'UNIQUE' and
  (select indexdef from pg_indexes
   where schemaname = 'public' and tablename = 'scoring_systems'
     and indexname = 'idx_scoring_systems_template_name')
  ~ '\(name\) WHERE is_template',
  'partial UNIQUE index on (name) WHERE is_template — predicate pinned from indexdef (D51(4) lesson)');

-- HAND-CLEARED ONCE, 2026-08-26 by SE.5 (migration 105 §4): this is an EXACT
-- list, so an additive policy is supposed to red it and a human is supposed to
-- read the addition before adding it here. §12.25's member SELECT policy is
-- that addition — league members must see their league's custom scoring rules
-- pre-draft. What the cell is really guarding is the three 001 policies staying
-- put, and they do: dropping 001's owner `FOR ALL` would look like tidying up
-- the §12.25 bypass and would silently break the D33 research world.
select policies_are('public', 'scoring_systems',
  array['System defaults are viewable by everyone',
        'Users can view own scoring systems',
        'Users can manage own scoring systems',
        'Templates viewable by everyone',
        'League members read league scoring'],
  'exact policy list: the three 001 policies + the 058 template SELECT + §12.25''s member SELECT (SE.5/105)');
select policy_cmd_is('public', 'scoring_systems', 'Templates viewable by everyone', 'SELECT',
  'template policy is SELECT-only');

-- ---------------------------------------------------------------------------
-- B. Seed content (postgres context): 6 rows, names, shape, full rules pins.
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from scoring_systems where is_template),
  7::bigint,
  'exactly 7 template rows seeded (058''s parity six + 106''s Scout Scoring — SC.1)');

select results_eq(
  $$ select name from scoring_systems where is_template order by name $$,
  $$ values ('ESPN Full PPR'), ('ESPN Standard'), ('Scout Scoring'),
            ('Sleeper Full PPR'), ('Sleeper Standard'), ('Yahoo Half PPR'),
            ('Yahoo Standard') $$,
  'template names are §7.3.3''s table verbatim (v2.16.9: + Scout Scoring)');

select is(
  (select count(*) from scoring_systems
   where is_template and (owner_id is not null or is_system_default)),
  0::bigint,
  'every template row is owner_id NULL and is_system_default FALSE (D34 — research-surface meaning untouched)');

select is(
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  '{"pass_yards": 0.04, "pass_tds": 4, "interceptions": -2, "pass_2pt": 2,
    "rush_yards": 0.1, "rush_tds": 6, "rush_2pt": 2,
    "receptions": 0, "receiving_yards": 0.1, "receiving_tds": 6, "rec_2pt": 2,
    "fumbles_lost": -2, "fumble_recovery_td": 6, "return_td": 6,
    "fg_0_39": 3, "fg_40_49": 4, "fg_50_plus": 5, "pat_made": 1, "fg_missed": -1,
    "def_sack": 1, "def_int": 2, "def_fumble_rec": 2, "def_td": 6,
    "def_safety": 2, "def_block": 2, "def_return_td": 6,
    "def_pa_0": 5, "def_pa_1_6": 4, "def_pa_7_13": 3, "def_pa_14_17": 1,
    "def_pa_18_27": 0, "def_pa_28_34": -1, "def_pa_35_45": -3, "def_pa_46_plus": -5,
    "def_ya_0_99": 5, "def_ya_100_199": 3, "def_ya_200_299": 2, "def_ya_300_349": 0,
    "def_ya_350_399": -1, "def_ya_400_449": -3, "def_ya_450_499": -5,
    "def_ya_500_549": -6, "def_ya_550_plus": -7}'::jsonb,
  'ESPN Standard rules — complete golden pin (Q9 evidence 2026-07-21; 60+ FG + PAT micro-categories are the NAMED exceptions, v2.8.5)');

select is(
  (select rules from scoring_systems where is_template and name = 'ESPN Full PPR'),
  '{"pass_yards": 0.04, "pass_tds": 4, "interceptions": -2, "pass_2pt": 2,
    "rush_yards": 0.1, "rush_tds": 6, "rush_2pt": 2,
    "receptions": 1, "receiving_yards": 0.1, "receiving_tds": 6, "rec_2pt": 2,
    "fumbles_lost": -2, "fumble_recovery_td": 6, "return_td": 6,
    "fg_0_39": 3, "fg_40_49": 4, "fg_50_plus": 5, "pat_made": 1, "fg_missed": -1,
    "def_sack": 1, "def_int": 2, "def_fumble_rec": 2, "def_td": 6,
    "def_safety": 2, "def_block": 2, "def_return_td": 6,
    "def_pa_0": 5, "def_pa_1_6": 4, "def_pa_7_13": 3, "def_pa_14_17": 1,
    "def_pa_18_27": 0, "def_pa_28_34": -1, "def_pa_35_45": -3, "def_pa_46_plus": -5,
    "def_ya_0_99": 5, "def_ya_100_199": 3, "def_ya_200_299": 2, "def_ya_300_349": 0,
    "def_ya_350_399": -1, "def_ya_400_449": -3, "def_ya_450_499": -5,
    "def_ya_500_549": -6, "def_ya_550_plus": -7}'::jsonb,
  'ESPN Full PPR rules — complete golden pin (differs from Standard by receptions = 1 only)');

select is(
  (select rules from scoring_systems where is_template and name = 'Yahoo Standard'),
  '{"pass_yards": 0.04, "pass_tds": 4, "interceptions": -1, "pass_2pt": 2,
    "rush_yards": 0.1, "rush_tds": 6, "rush_2pt": 2,
    "receptions": 0, "receiving_yards": 0.1, "receiving_tds": 6, "rec_2pt": 2,
    "fumbles_lost": -2, "fumble_recovery_td": 6, "return_td": 6,
    "fg_0_39": 3, "fg_40_49": 4, "fg_50_plus": 5, "pat_made": 1,
    "def_sack": 1, "def_int": 2, "def_fumble_rec": 2, "def_td": 6,
    "def_safety": 2, "def_block": 2, "def_return_td": 6,
    "def_pa_0": 10, "def_pa_1_6": 7, "def_pa_7_13": 4, "def_pa_14_20": 1,
    "def_pa_21_27": 0, "def_pa_28_34": -1, "def_pa_35_plus": -4}'::jsonb,
  'Yahoo Standard rules — complete golden pin (SLN6489: INT −1, no miss penalties, single PA model)');

select is(
  (select rules from scoring_systems where is_template and name = 'Yahoo Half PPR'),
  '{"pass_yards": 0.04, "pass_tds": 4, "interceptions": -1, "pass_2pt": 2,
    "rush_yards": 0.1, "rush_tds": 6, "rush_2pt": 2,
    "receptions": 0.5, "receiving_yards": 0.1, "receiving_tds": 6, "rec_2pt": 2,
    "fumbles_lost": -2, "fumble_recovery_td": 6, "return_td": 6,
    "fg_0_39": 3, "fg_40_49": 4, "fg_50_plus": 5, "pat_made": 1,
    "def_sack": 1, "def_int": 2, "def_fumble_rec": 2, "def_td": 6,
    "def_safety": 2, "def_block": 2, "def_return_td": 6,
    "def_pa_0": 10, "def_pa_1_6": 7, "def_pa_7_13": 4, "def_pa_14_20": 1,
    "def_pa_21_27": 0, "def_pa_28_34": -1, "def_pa_35_plus": -4}'::jsonb,
  'Yahoo Half PPR rules — complete golden pin (receptions 0.5 — Yahoo''s platform default)');

select is(
  (select rules from scoring_systems where is_template and name = 'Sleeper Standard'),
  '{"pass_yards": 0.04, "pass_tds": 4, "interceptions": -1, "pass_2pt": 2,
    "rush_yards": 0.1, "rush_tds": 6, "rush_2pt": 2,
    "receptions": 0, "receiving_yards": 0.1, "receiving_tds": 6, "rec_2pt": 2,
    "fumbles_lost": -2, "fumble_recovery_td": 6, "return_td": 6,
    "fg_0_39": 3, "fg_40_49": 4, "fg_50_plus": 5, "pat_made": 1,
    "fg_missed": -1, "pat_missed": -1,
    "def_sack": 1, "def_int": 2, "def_fumble_rec": 2, "def_td": 6,
    "def_safety": 2, "def_block": 2, "def_return_td": 6,
    "def_pa_0": 10, "def_pa_1_6": 7, "def_pa_7_13": 4, "def_pa_14_20": 1,
    "def_pa_21_27": 0, "def_pa_28_34": -1, "def_pa_35_plus": -4}'::jsonb,
  'Sleeper Standard rules — complete golden pin (App B best-known values, FLAGGED unverified — ledger F24)');

select is(
  (select rules from scoring_systems where is_template and name = 'Sleeper Full PPR'),
  '{"pass_yards": 0.04, "pass_tds": 4, "interceptions": -1, "pass_2pt": 2,
    "rush_yards": 0.1, "rush_tds": 6, "rush_2pt": 2,
    "receptions": 1, "receiving_yards": 0.1, "receiving_tds": 6, "rec_2pt": 2,
    "fumbles_lost": -2, "fumble_recovery_td": 6, "return_td": 6,
    "fg_0_39": 3, "fg_40_49": 4, "fg_50_plus": 5, "pat_made": 1,
    "fg_missed": -1, "pat_missed": -1,
    "def_sack": 1, "def_int": 2, "def_fumble_rec": 2, "def_td": 6,
    "def_safety": 2, "def_block": 2, "def_return_td": 6,
    "def_pa_0": 10, "def_pa_1_6": 7, "def_pa_7_13": 4, "def_pa_14_20": 1,
    "def_pa_21_27": 0, "def_pa_28_34": -1, "def_pa_35_plus": -4}'::jsonb,
  'Sleeper Full PPR rules — complete golden pin (App B best-known values, FLAGGED unverified — ledger F24)');

select is(
  (select description from scoring_systems where is_template and name = 'ESPN Standard'),
  'ESPN''s 2026 default scoring, 0 PPR — verified against ESPN''s published defaults (July 2026). Interceptions −2. Heads up on two tiny gaps our stat feed cannot see: ESPN awards 6 points for a 60+ yard field goal (scored here as a 50+ make, 5 points), and 1–2 points when a D/ST scores a safety or return on a PAT try (not scored here). Combined, that is roughly 5–15 plays across the entire NFL per season. Every other category matches ESPN to the cent.',
  'ESPN Standard description carries the Q9 parity-exception line verbatim (ruling''s user-visibility condition)');

select is(
  (select description from scoring_systems where is_template and name = 'ESPN Full PPR'),
  'ESPN''s 2026 default scoring with 1 point per reception — verified against ESPN''s published defaults (July 2026). Interceptions −2. Heads up on two tiny gaps our stat feed cannot see: ESPN awards 6 points for a 60+ yard field goal (scored here as a 50+ make, 5 points), and 1–2 points when a D/ST scores a safety or return on a PAT try (not scored here). Combined, that is roughly 5–15 plays across the entire NFL per season. Every other category matches ESPN to the cent.',
  'ESPN Full PPR description carries the Q9 parity-exception line verbatim');

select is(
  (select count(*) from scoring_systems where is_template and length(coalesce(description, '')) > 40),
  7::bigint,
  'every template has a commissioner-readable description');

-- ---------------------------------------------------------------------------
-- C. Fixtures + constraint boundaries (postgres context — BEFORE any claims).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '73000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-ss1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "ss_owner_one"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '73000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-ss2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "ss_owner_two"}', now(), now());

insert into scoring_systems (id, name, owner_id, rules) values
  ('d3000000-0000-4000-8000-000000000001', 'pgtap-personal-ss',
   '73000000-0000-4000-8000-000000000001', '{"pass_yards": 0.05}'::jsonb);

select throws_ok(
  $$ insert into scoring_systems (name, owner_id, is_template, rules) values
     ('pgtap-owned-template', '73000000-0000-4000-8000-000000000001', true, '{}'::jsonb) $$,
  '23514', null,
  'an OWNED template row is impossible even for postgres — the CHECK is role-independent (Q8 anti-shadow, privileged path)');

select throws_ok(
  $$ insert into scoring_systems (name, owner_id, is_template, rules) values
     ('ESPN Standard', null, true, '{}'::jsonb) $$,
  '23505', null,
  'a second template named ESPN Standard is rejected (partial UNIQUE — the seed''s natural key)');

select lives_ok(
  $$ insert into scoring_systems (id, name, owner_id, is_template, rules) values
     ('d3000000-0000-4000-8000-000000000002', 'ESPN Standard',
      '73000000-0000-4000-8000-000000000001', false, '{"pass_yards": 0.04}'::jsonb) $$,
  'a NON-template row may reuse a template name (index is partial — a full-table UNIQUE(name) fails this counter-pin)');

-- ---------------------------------------------------------------------------
-- D. RLS per role — anon.
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select is(
  (select count(*) from scoring_systems where is_template),
  7::bigint,
  'anon sees all 7 templates (world-readable — the picker''s pre-auth surface)');
select is(
  (select count(*) from scoring_systems where not is_template),
  0::bigint,
  'anon sees ZERO non-template rows — the 058 policy is is_template-scoped, not a blanket SELECT (counter-pin)');
select throws_ok(
  $$ insert into scoring_systems (name, owner_id, is_template, rules)
     values ('pgtap-anon-template', null, true, '{}'::jsonb) $$,
  '42501', null,
  'anon INSERT of a template-shaped row denied');
select results_eq(
  $$ with w as (update scoring_systems set rules = '{}'::jsonb where is_template returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'anon UPDATE of template rows affects 0 rows (RETURNING-count)');
select results_eq(
  $$ with d as (delete from scoring_systems where is_template returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'anon DELETE of template rows affects 0 rows');

-- ---------------------------------------------------------------------------
-- E. RLS per role — authenticated u1 (owns two personal rows).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "73000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select is(
  (select count(*) from scoring_systems where is_template),
  7::bigint,
  'u1 sees all 7 templates (SELECT-sees-N pin for the write probes below)');
select is(
  (select count(*) from scoring_systems where owner_id = '73000000-0000-4000-8000-000000000001'),
  2::bigint,
  'u1 sees both own personal rows');
select results_eq(
  $$ with w as (update scoring_systems set rules = '{"pass_yards": 99}'::jsonb
                where is_template returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'u1 UPDATE of template rows affects 0 rows — owner-scoped policies cannot reach owner_id NULL (Q8: client-immutable)');
select results_eq(
  $$ with d as (delete from scoring_systems where is_template returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'u1 DELETE of template rows affects 0 rows');
select results_eq(
  $$ with w as (update scoring_systems
                set owner_id = '73000000-0000-4000-8000-000000000001'
                where is_template returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'u1 cannot STEAL a template (owner_id grab affects 0 rows — USING is evaluated on the OLD row)');
select throws_ok(
  $$ insert into scoring_systems (name, owner_id, is_template, rules) values
     ('pgtap-shadow-template', '73000000-0000-4000-8000-000000000001', true, '{}'::jsonb) $$,
  '23514', null,
  'u1 cannot MINT a shadow template (own-owned INSERT with is_template — 23514, the Q8 anti-shadow probe)');
select throws_ok(
  $$ update scoring_systems set is_template = true
     where id = 'd3000000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'u1 cannot FLIP is_template on an own row (23514 — the exact forgery 001''s owner FOR ALL would otherwise allow)');
select throws_ok(
  $$ insert into scoring_systems (name, owner_id, rules)
     values ('pgtap-ownerless', null, '{}'::jsonb) $$,
  '42501', null,
  'u1 cannot mint an OWNERLESS row at all (42501 — WITH CHECK requires auth.uid() = owner_id)');
select results_eq(
  $$ with w as (update scoring_systems set rules = '{"pass_yards": 0.06}'::jsonb
                where id = 'd3000000-0000-4000-8000-000000000001' returning 1)
     select count(*) from w $$,
  $$ values (1::bigint) $$,
  'u1 UPDATE of an own personal row still works (legit CRUD intact — an over-broad fix fails this)');
select lives_ok(
  $$ insert into scoring_systems (name, owner_id, rules) values
     ('pgtap-personal-ss2', '73000000-0000-4000-8000-000000000001', '{"receptions": 1}'::jsonb) $$,
  'u1 INSERT of an own personal (non-template) row still works');

-- ---------------------------------------------------------------------------
-- F. RLS per role — authenticated u2 (non-owner).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "73000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

select is(
  (select count(*) from scoring_systems where is_template),
  7::bigint,
  'u2 sees all 7 templates');
select is(
  (select count(*) from scoring_systems
   where owner_id = '73000000-0000-4000-8000-000000000001'),
  0::bigint,
  'u2 sees NONE of u1''s personal rows (ownership read scope unchanged)');
select results_eq(
  $$ with w as (update scoring_systems set rules = '{}'::jsonb
                where id = 'd3000000-0000-4000-8000-000000000001' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'u2 UPDATE of u1''s personal row affects 0 rows');

select * from finish();
rollback;
