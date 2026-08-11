-- ============================================================================
-- list_players.tier — migration 081, the widened bucket vocabulary (Lists v2
-- **LV.1.5**; Chris's ruling 2026-08-09: *"That's fine, do the database
-- change."*). pgTAP file is **030** (029 = list_links; next free at task time).
--
-- What this file has to make impossible to break silently:
--
--   * **THAT THE CONSTRAINT ACTUALLY CHANGED.** Before 081 the column was
--     pinned to NULL or S–F (`003_lists.sql:40-43`), live locally and on
--     hosted production. The whole task is that predicate, so it is
--     golden-pinned as a stored literal — `pg_get_constraintdef` compared to
--     the exact text — and then exercised against real rows at every boundary.
--     A golden pin alone would pass if the constraint existed but was NOT
--     VALID; a boundary probe alone would pass against a dropped constraint
--     for the accept cases. Both are here.
--
--   * **BOTH EDGES OF EVERY RANGE.** r0/r1 and r30/r31, c0/c1 and c4/c5,
--     S…F versus the letters next to them in the alphabet (E, G). An
--     off-by-one in a character class is the single most likely way this
--     predicate is wrong, and it is invisible in the middle of a range.
--
--   * **THAT EXISTING S–F DATA STILL WORKS.** The new predicate is a strict
--     superset, so every write that works today must still work: the six
--     letters, NULL, and clearing a bucket back to NULL. If that were false
--     the widening would be a regression dressed as a feature.
--
--   * **THE PATHS THAT NEVER SEE ZOD.** Every probe here runs PRIVILEGED, i.e.
--     nowhere near the route's validation — and section E drives
--     `duplicate_list` (017), which copies `tier` verbatim and is this
--     codebase's standing proof that such a path exists. That is the concrete
--     reason §3 Q2 chose "widen the CHECK" (option A) over "drop it and let
--     Zod be the only gate" (option B).
--
--   * **THAT THE SHAPE RULES OUT WHAT IT CLAIMS TO.** §3 Q2 point 4 argues the
--     closed set makes whitespace, control characters, Unicode, bidi
--     overrides, over-long strings and `__proto__` unreachable *by shape*
--     rather than by a comment. Each of those is a rejection pin here, at the
--     database, so the argument is measured rather than asserted.
--
--   * **ADDITIVITY.** 081 is one ALTER on one constraint. No policy, no
--     column, no index, no grant moves — pinned, because a `DROP CONSTRAINT`
--     migration is exactly the shape that can take something else with it.
--
-- Falsifiability map (probed live — see the PR):
--   reverting 081's predicate to 003's `tier IN ('S',…,'F')` fails the golden
--   pin plus every accept pin in section C (r1/r30/c1/c4 and the update path);
--   widening `[12][0-9]` to `[0-9][0-9]` fails the r0 and r99 rejections;
--   widening `c[1-4]` to `c[1-9]` fails the c5 rejection; dropping the
--   anchors fails the whitespace, newline and long-string rejections;
--   dropping the constraint entirely fails every pin in section D.
--
-- Determinism: fixed ids, fixed literals, no wall-clock. All work is
-- privileged — this file is about a CHECK, not about RLS, and 028 already
-- pins list_players-adjacent policy behaviour.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(53);

-- ---------------------------------------------------------------------------
-- A. The constraint itself, golden-pinned
-- ---------------------------------------------------------------------------
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.list_players'::regclass
     and conname = 'list_players_tier_check'),
  'CHECK (((tier IS NULL) OR (tier ~ ''^([SABCDF]|r([1-9]|[12][0-9]|30)|c[1-4])$''::text)))',
  'tier CHECK golden-pinned as a stored literal — S-F tiers, r1-r30 rounds, c1-c4 cost bands, NULL for ungrouped. This is the ONE predicate LV.1.5 exists to change, and it mirrors BUCKET_KEY_PATTERN in src/types/schemas/lists.ts character for character');

select ok(
  (select convalidated from pg_constraint
   where conrelid = 'public.list_players'::regclass
     and conname = 'list_players_tier_check'),
  'the constraint is VALIDATED, not NOT VALID — 081 does not use NOT VALID, so it was checked against every existing row when it was added');

select is(
  (select contype::text from pg_constraint
   where conrelid = 'public.list_players'::regclass
     and conname = 'list_players_tier_check'),
  'c',
  'it is still a CHECK constraint under the SAME NAME, so every existing reference to list_players_tier_check stays true');

select col_type_is('public', 'list_players', 'tier', 'text',
  'the column is still plain text — 081 changed the CHECK and nothing else');

-- Additivity: a DROP CONSTRAINT migration is exactly the shape that can take
-- something else with it, so the neighbours are pinned.
select policies_are('public', 'list_players',
  array['League-shared list players readable by league members',
        'List players follow list visibility',
        'Users can manage players in own lists'],
  'list_players policy set UNTOUCHED by 081 (001''s two + 067''s one)');
select ok(
  (select count(*) = 1 from pg_constraint
   where conrelid = 'public.list_players'::regclass and conname = 'list_players_slot_check'),
  'list_players_slot_check survives — 081 dropped ONE constraint by name, not every CHECK on the table');
select ok(
  (select count(*) = 1 from pg_constraint
   where conrelid = 'public.list_players'::regclass
     and conname = 'list_players_list_id_player_id_key'),
  'the (list_id, player_id) uniqueness survives (Key Business Rule 1)');
select ok(has_table_privilege('authenticated', 'public.list_players', 'UPDATE'),
  'authenticated still has UPDATE — the tier route writes through it, and no RLS pin can see a missing grant (D18-D23)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (privileged; the CHECK is not an RLS question)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '86000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-tier1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "tier_owner_one"}', now(), now());

update profiles set is_pro = true
where id = '86000000-0000-4000-8000-000000000001';

insert into players (id, full_name, position) values
  ('pgtap-tier-p1', 'PgTap Tier RB', 'RB'),
  ('pgtap-tier-p2', 'PgTap Tier WR', 'WR');

insert into lists (id, owner_id, title, slug, is_private, ranking_mode) values
  ('96000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000001',
   'tier vocabulary', 'tier-vocab', false, 'rank_and_tier');

-- p1 is the row every probe below UPDATEs; it starts on a tier letter, which
-- is what every list in every database looks like before this migration.
insert into list_players (id, list_id, player_id, position, tier) values
  ('a6000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001',
   'pgtap-tier-p1', 1, 'S');

select is(
  (select tier from list_players where id = 'a6000000-0000-4000-8000-000000000001'),
  'S', 'positive control: the fixture row really exists and really holds a tier letter, so a later 0-row result cannot be mistaken for a passing guard (CLAUDE.md — never let "nothing happened" mean "it worked")');

-- ---------------------------------------------------------------------------
-- C. ACCEPTED — the widening, and the proof that nothing existing broke
-- ---------------------------------------------------------------------------
-- Rounds: both edges of the range, plus the two-digit forms in between.
select lives_ok(
  $$ update list_players set tier = 'r1'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  'r1 ACCEPTED — the whole point of LV.1.5: a fantasy draft runs 12-16 rounds and could not be represented against six buckets');
select is(
  (select tier from list_players where id = 'a6000000-0000-4000-8000-000000000001'),
  'r1', 'and it is actually STORED — lives_ok on an UPDATE that matched no row would pass without this');
select lives_ok(
  $$ update list_players set tier = 'r10'
     where id = 'a6000000-0000-4000-8000-000000000001' $$, 'r10 accepted');
select lives_ok(
  $$ update list_players set tier = 'r29'
     where id = 'a6000000-0000-4000-8000-000000000001' $$, 'r29 accepted');
select lives_ok(
  $$ update list_players set tier = 'r30'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  'r30 ACCEPTED — the ceiling, and the deepest draft league-settings.ts can construct (bench capped at 20, plus starters)');
select is(
  (select tier from list_players where id = 'a6000000-0000-4000-8000-000000000001'),
  'r30', 'r30 is stored');

-- Cost bands: adopted on the wire so every accepted key has a default label in
-- DEFAULT_COST_BANDS and resolveBandLabel can never render a raw key.
select lives_ok(
  $$ update list_players set tier = 'c1'
     where id = 'a6000000-0000-4000-8000-000000000001' $$, 'c1 accepted');
select lives_ok(
  $$ update list_players set tier = 'c4'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  'c4 ACCEPTED — the last band with a default label. c5 has none and is rejected below');

-- S-F: the regression half. Everything that writes tier today must still work.
select lives_ok(
  $$ update list_players set tier = 'S'
     where id = 'a6000000-0000-4000-8000-000000000001' $$, 'S still accepted');
select lives_ok(
  $$ update list_players set tier = 'A'
     where id = 'a6000000-0000-4000-8000-000000000001' $$, 'A still accepted');
select lives_ok(
  $$ update list_players set tier = 'B'
     where id = 'a6000000-0000-4000-8000-000000000001' $$, 'B still accepted');
select lives_ok(
  $$ update list_players set tier = 'C'
     where id = 'a6000000-0000-4000-8000-000000000001' $$, 'C still accepted');
select lives_ok(
  $$ update list_players set tier = 'D'
     where id = 'a6000000-0000-4000-8000-000000000001' $$, 'D still accepted');
select lives_ok(
  $$ update list_players set tier = 'F'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  'F still accepted — the six letters are a strict SUBSET of the new predicate, which is why 081 needs no backfill');

-- NULL is ungrouped, and clearing a bucket is the tier route's `tier: null`.
select lives_ok(
  $$ update list_players set tier = null
     where id = 'a6000000-0000-4000-8000-000000000001' $$, 'NULL accepted — ungrouped');
select is(
  (select tier from list_players where id = 'a6000000-0000-4000-8000-000000000001'),
  null, 'clearing a bucket back to NULL really clears it');

-- The INSERT path, not just UPDATE: bulk add and duplicate both insert.
select lives_ok(
  $$ insert into list_players (id, list_id, player_id, position, tier)
     values ('a6000000-0000-4000-8000-000000000002',
             '96000000-0000-4000-8000-000000000001', 'pgtap-tier-p2', 2, 'r12') $$,
  'INSERT with a round key accepted — the CHECK applies to both paths, and duplicate_list INSERTs');
select is(
  (select tier from list_players where id = 'a6000000-0000-4000-8000-000000000002'),
  'r12', 'the inserted round key is stored');

-- ---------------------------------------------------------------------------
-- D. REJECTED — every boundary, and everything the closed shape claims to rule
--    out. All 23514, all PRIVILEGED (i.e. with no Zod anywhere near them).
-- ---------------------------------------------------------------------------
-- Round boundaries, both edges.
select throws_ok(
  $$ update list_players set tier = 'r0'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'r0 REJECTED — rounds are 1-based; an off-by-one at the bottom of [1-9] would let it through');
select throws_ok(
  $$ update list_players set tier = 'r31'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'r31 REJECTED — one past the ceiling');
select throws_ok(
  $$ update list_players set tier = 'r99'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'r99 REJECTED — widening [12][0-9] to [0-9][0-9] would let this through, and list-buckets.ts would then render a 99th section');
select throws_ok(
  $$ update list_players set tier = 'r01'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'r01 REJECTED — one key per round, so r1 and r01 cannot both exist and split a section in two');
select throws_ok(
  $$ update list_players set tier = 'r'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a bare r REJECTED');

-- Cost-band boundaries, both edges.
select throws_ok(
  $$ update list_players set tier = 'c0'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'c0 REJECTED');
select throws_ok(
  $$ update list_players set tier = 'c5'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'c5 REJECTED — a fifth band has no default label in DEFAULT_COST_BANDS and would render the literal "c5" in the rail (the R181/R183 failure mode)');

-- Letters either side of the tier set, and the wrong case.
select throws_ok(
  $$ update list_players set tier = 'E'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'E REJECTED — it sits between D and F in the alphabet but not in the grade scale');
select throws_ok(
  $$ update list_players set tier = 'G'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'G REJECTED');
select throws_ok(
  $$ update list_players set tier = 'Z'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'Z REJECTED');
select throws_ok(
  $$ update list_players set tier = 's'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'lowercase s REJECTED — the class is [SABCDF], not case-insensitive, so one key per bucket');
select throws_ok(
  $$ update list_players set tier = 'R1'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'uppercase R1 REJECTED, same reason');

-- The empty string is NOT a bucket: ungrouped is NULL, as it always was.
select throws_ok(
  $$ update list_players set tier = ''
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'the empty string REJECTED — ungrouped is NULL, and an empty key would render a nameless section header');

-- Whitespace and control characters: the anchors are what stop these, and a
-- newline is the one that catches out a regex engine with a line-sensitive mode.
select throws_ok(
  $$ update list_players set tier = ' S'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'leading space REJECTED');
select throws_ok(
  $$ update list_players set tier = 'S '
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'trailing space REJECTED');
select throws_ok(
  $$ update list_players set tier = E'S\n'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a trailing NEWLINE REJECTED — Postgres ARE has a newline-sensitive mode and Python''s $ matches before a trailing newline; this pin is what proves ours does not');
select throws_ok(
  $$ update list_players set tier = E'S\nr1'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'two valid keys separated by a NEWLINE REJECTED — the ^...$ anchors are per-string here, not per-line');
select throws_ok(
  $$ update list_players set tier = E'\tS'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a leading TAB REJECTED — the browser strips TAB out of a scheme, which is how java<TAB>script: gets through naive guards (the LV.8 lesson)');

-- Prototype pollution: unreachable by shape, asserted anyway (R181/R183).
select throws_ok(
  $$ update list_players set tier = '__proto__'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, '__proto__ REJECTED at the database — bucket keys index band-label records in the client, and R181 measured that reaching one through a plain object is silent');
select throws_ok(
  $$ update list_players set tier = 'constructor'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'constructor REJECTED — reaching it made resolveBandLabel return a FUNCTION out of a `: string` API');

-- Injection-shaped and long.
select throws_ok(
  $$ update list_players set tier = 'S''; DROP TABLE list_players; --'
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'an injection-shaped payload REJECTED');
select throws_ok(
  $$ update list_players set tier = repeat('r1', 100)
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a 200-character key REJECTED — every accepted key is at most 3 chars, which is what stops one overflowing a section header or the Cards view''s 62px label rail');
select throws_ok(
  $$ update list_players set tier = repeat('S', 200)
     where id = 'a6000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a 200-character run of a VALID character REJECTED — an unanchored pattern would accept this');

-- A rejected write leaves the row alone: the transaction-level proof that the
-- CHECK refuses rather than truncates or coerces.
select is(
  (select tier from list_players where id = 'a6000000-0000-4000-8000-000000000001'),
  null, 'after every rejection above, the row still holds its last ACCEPTED value (NULL) — nothing was partially written');

-- ---------------------------------------------------------------------------
-- E. duplicate_list — the path that never sees Zod
--
--    017's RPC copies `tier` verbatim from the source list. It is SECURITY
--    INVOKER, so it runs as the caller with RLS applied, and it applies NO
--    validation of its own. This is the concrete reason §3 Q2 chose to widen
--    the CHECK rather than drop it: if the database stopped guarding the
--    column, this path would be completely unguarded.
-- ---------------------------------------------------------------------------
update list_players set tier = 'r7'
where id = 'a6000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"86000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$ select duplicate_list('96000000-0000-4000-8000-000000000001',
                           'tier vocabulary copy', 'tier-vocab-copy', false) $$,
  'duplicate_list still works over a round-bucketed list — a copy is one of the ways a round key reaches a row without passing through the tier route');

select is(
  (select count(*) from list_players lp
   join lists l on l.id = lp.list_id
   where l.slug = 'tier-vocab-copy' and lp.tier = 'r7'),
  1::bigint,
  'the round key survived the copy VERBATIM — which is exactly why the guard has to live at the database and not only in the route');

reset role;

select * from finish();
rollback;
