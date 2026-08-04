-- ============================================================================
-- league_lists + the shared-private list reads — migration 067 (spec §7.4,
-- §12.15 incl. the shared-private note, §15.5; tasks-M2 §4 standing rules,
-- D32/D106; task L.B4.1). pgTAP file is **021** (020 = draft core RPCs;
-- next free confirmed at task time).
--
-- Falsifiability notes (§4.3):
--   * PRIVACY, both directions at every layer (the DoD's break-probe
--     target): a NON-shared attachment is invisible to another member
--     (count-0 pin) beside the shared positive control (count-1); the
--     LIST behind a shared-private attachment is readable by a member
--     while the unshared/unattached/deleted/cross-league variants all
--     count 0; the companion `list_players` policy pinned the same way
--     (rows of the shared list readable, unshared/deleted/cross-league
--     0). Falsifiability map (probed live, both directions — L.B4.1
--     session log): dropping `shared_with_league = TRUE` from the
--     league_lists SELECT policy fails EXACTLY the link-visibility pins
--     (the shown break probe); the CONTENT pins are DOUBLY guarded —
--     the lists/list_players policies' EXISTS runs under league_lists's
--     own RLS, so a single conjunct drop there is masked (verified live:
--     021 stayed green with the lists-policy conjunct removed) and
--     content leaks only if BOTH layers loosen (defense in depth, D106).
--     The deleted_at conjunct is single-guard (league_lists has no
--     deleted awareness) — the deleted pins target it directly — and
--     dropping `is_league_member` fails the outsider pins.
--   * The D106 ownership invariant (§12.15's "matches lists.owner_id"
--     comment made a constraint — the R43 class): attaching someone
--     ELSE'S list is 23503 both privileged AND from the authenticated
--     role (the forced-share privacy hole closed at the DB, not the
--     route); constraintdef golden-pinned so a silent drop trips.
--   * One-primary-per-member at the exact boundary: a second primary for
--     the same (league, member) → 23505 privileged AND from the owner's
--     own client UPDATE; a DIFFERENT member's primary in the same league
--     coexists (per-member scope positive control); indexdef golden pin.
--   * §4.2 per-role: policies_are pins the exact policy set on all three
--     touched tables (the two 001 lists/list_players policy pairs are
--     UNTOUCHED — the new policies are additive rows beside them);
--     UPDATE/DELETE by non-owners use the RETURNING-count pattern
--     preceded by a same-role SELECT-sees-N pin (or the privileged
--     total-rows pin for roles that see nothing); INSERT expects 42501.
--   * Public-read regression guards: anon still reads a public list and
--     its players (the additive policies must not disturb 001's arms).
--   * All privileged fixture work runs BEFORE any JWT claims are set
--     (set_config persists to txn end — D49(7)). Fixture owners are
--     is_pro (the free-account private-list cap trigger predates leagues
--     and fires regardless of role).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(63);

-- ---------------------------------------------------------------------------
-- A. Shape (§12.15 verbatim + the D106 hardening + the §8.1 policy index)
-- ---------------------------------------------------------------------------
select has_table('public', 'league_lists', 'league_lists exists');
select columns_are('public', 'league_lists',
  array['id', 'league_id', 'list_id', 'owner_id', 'is_primary_board',
        'shared_with_league', 'created_at'],
  'exact §12.15 column set');
select col_is_pk('public', 'league_lists', 'id', 'PK id');
select fk_ok('public', 'league_lists', 'league_id', 'public', 'leagues', 'id',
  'league_id → leagues');
select fk_ok('public', 'league_lists', 'list_id', 'public', 'lists', 'id',
  'list_id → lists');
select fk_ok('public', 'league_lists', 'owner_id', 'public', 'profiles', 'id',
  'owner_id → profiles');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.league_lists'::regclass
     and conname = 'league_lists_list_owner_fkey'),
  'FOREIGN KEY (list_id, owner_id) REFERENCES lists(id, owner_id) ON DELETE CASCADE',
  'D106 composite FK golden-pinned — owner_id MUST match lists.owner_id (§12.15''s comment made a constraint, R43 class)');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.lists'::regclass
     and conname = 'lists_id_owner_unique'),
  'UNIQUE (id, owner_id)',
  'lists (id, owner_id) UNIQUE exists (the composite FK''s referenced key; trivially satisfied — id is the PK)');
select col_default_is('public', 'league_lists', 'is_primary_board', 'false',
  'is_primary_board defaults FALSE');
select col_default_is('public', 'league_lists', 'shared_with_league', 'false',
  'shared_with_league defaults FALSE (private-to-owner is the default posture, §7.4)');
select col_is_unique('public', 'league_lists',
  array['league_id', 'list_id', 'owner_id'],
  'UNIQUE(league_id, list_id, owner_id) — the attach natural key (retry-safe attach, DoD idempotency)');
select is(
  (select indexdef from pg_indexes
   where schemaname = 'public' and indexname = 'uniq_primary_board_per_member'),
  'CREATE UNIQUE INDEX uniq_primary_board_per_member ON public.league_lists USING btree (league_id, owner_id) WHERE (is_primary_board = true)',
  'uniq_primary_board_per_member golden-pinned — at most one primary board per member per league (§12.15)');
select has_index('public', 'league_lists', 'idx_league_lists_member',
  'idx_league_lists_member exists (§12.15)');
select has_index('public', 'league_lists', 'idx_league_lists_list',
  'idx_league_lists_list exists (§8.1 — the FK the shared-read policies probe by)');
select ok(
  (select rowsecurity from pg_tables
   where schemaname = 'public' and tablename = 'league_lists'),
  'RLS enabled on league_lists');
select policies_are('public', 'league_lists',
  array['Members manage their own attachments',
        'Own or shared league-list links readable'],
  'exactly TWO policies — the §12.15 printed pair (owner-scoped FOR ALL is the spec-named client-write exception, plan §8.2)');
select policy_cmd_is('public', 'league_lists',
  'Own or shared league-list links readable', 'SELECT',
  'the read policy is SELECT');
select policy_cmd_is('public', 'league_lists',
  'Members manage their own attachments', 'ALL',
  'the owner policy is FOR ALL — league_lists joins league_chat/draft_queues as spec-sanctioned client-writable');

-- ---------------------------------------------------------------------------
-- B. The ADDITIVE shared-private read policies (§12.15 note + D106) — the
--    001 pairs must survive untouched beside exactly one new policy each.
-- ---------------------------------------------------------------------------
select policies_are('public', 'lists',
  array['League-shared lists readable by league members',
        'Public lists are viewable by everyone',
        'Users can manage own lists'],
  'lists: the two 001 policies UNTOUCHED + exactly the one additive shared-private SELECT (§12.15 note)');
select policies_are('public', 'list_players',
  array['League-shared list players readable by league members',
        'List players follow list visibility',
        'Users can manage players in own lists'],
  'list_players: the two 001 policies UNTOUCHED + exactly the one additive companion SELECT (D106 — "opening" a shared list means reading its rows)');
select policy_cmd_is('public', 'lists',
  'League-shared lists readable by league members', 'SELECT',
  'the lists shared-read policy is SELECT-only');
select policy_cmd_is('public', 'list_players',
  'League-shared list players readable by league members', 'SELECT',
  'the list_players shared-read policy is SELECT-only');

-- ---------------------------------------------------------------------------
-- C. Fixtures (postgres context — BEFORE any claims, D49(7)).
--    u1 member L1, list owner · u2 member L1 · u3 OUTSIDER with a list ·
--    u4 member L2 with a shared list there (cross-league probes).
--    Lists (owner u1 unless noted): ls1 private SHARED in L1 · ls2 private
--    UNSHARED in L1 + u1''s PRIMARY · ls3 private unattached · ls4 PUBLIC
--    attached unshared · ls5 private soft-DELETED, attached SHARED ·
--    ls6/ls9 u2''s private (ls6 attached; ls9 attached primary in C2) ·
--    ls7 u3''s private (never attached) · ls8 u4''s private SHARED in L2.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '82000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-ll1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "ll_owner_one"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '82000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-ll2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "ll_member_two"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '82000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'pgtap-ll3@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "ll_outsider_three"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '82000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'pgtap-ll4@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "ll_l2member_four"}', now(), now());

-- The pre-league free-account cap trigger (one private list) fires for every
-- role; the fixture owners are pro so the multi-list matrix is seedable.
update profiles set is_pro = true
where id in ('82000000-0000-4000-8000-000000000001',
             '82000000-0000-4000-8000-000000000002',
             '82000000-0000-4000-8000-000000000003',
             '82000000-0000-4000-8000-000000000004');

insert into leagues (id, owner_id, name, season) values
  ('a2000000-0000-4000-8000-00000000000a', '82000000-0000-4000-8000-000000000001', 'pgtap-ll-1', 2026),
  ('a2000000-0000-4000-8000-00000000000b', '82000000-0000-4000-8000-000000000004', 'pgtap-ll-2', 2026);

insert into league_members (league_id, user_id, role) values
  ('a2000000-0000-4000-8000-00000000000a', '82000000-0000-4000-8000-000000000001', 'commissioner'),
  ('a2000000-0000-4000-8000-00000000000a', '82000000-0000-4000-8000-000000000002', 'manager'),
  ('a2000000-0000-4000-8000-00000000000b', '82000000-0000-4000-8000-000000000004', 'commissioner');

insert into players (id, full_name, position) values
  ('pgtap-ll-p1', 'PgTap LL RB', 'RB'),
  ('pgtap-ll-p2', 'PgTap LL WR', 'WR');

insert into lists (id, owner_id, title, slug, is_private, deleted_at) values
  ('92000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
   'll priv shared', 'll-ps', true, null),
  ('92000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001',
   'll priv unshared', 'll-pu', true, null),
  ('92000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000001',
   'll priv unattached', 'll-px', true, null),
  ('92000000-0000-4000-8000-000000000004', '82000000-0000-4000-8000-000000000001',
   'll public', 'll-pub', false, null),
  ('92000000-0000-4000-8000-000000000005', '82000000-0000-4000-8000-000000000001',
   'll priv deleted shared', 'll-del', true, now()),
  ('92000000-0000-4000-8000-000000000006', '82000000-0000-4000-8000-000000000002',
   'll u2 priv', 'll-u2a', true, null),
  ('92000000-0000-4000-8000-000000000007', '82000000-0000-4000-8000-000000000003',
   'll u3 priv', 'll-u3a', true, null),
  ('92000000-0000-4000-8000-000000000008', '82000000-0000-4000-8000-000000000004',
   'll u4 priv shared L2', 'll-u4a', true, null),
  ('92000000-0000-4000-8000-000000000009', '82000000-0000-4000-8000-000000000002',
   'll u2 priv two', 'll-u2b', true, null);

insert into list_players (list_id, player_id, position, overall_rank) values
  ('92000000-0000-4000-8000-000000000001', 'pgtap-ll-p1', 1, 1),
  ('92000000-0000-4000-8000-000000000001', 'pgtap-ll-p2', 2, 2),
  ('92000000-0000-4000-8000-000000000002', 'pgtap-ll-p1', 1, 1),
  ('92000000-0000-4000-8000-000000000004', 'pgtap-ll-p1', 1, 1),
  ('92000000-0000-4000-8000-000000000005', 'pgtap-ll-p1', 1, 1),
  ('92000000-0000-4000-8000-000000000008', 'pgtap-ll-p1', 1, 1);

insert into league_lists (id, league_id, list_id, owner_id, is_primary_board, shared_with_league) values
  -- u1's four L1 attachments: shared / unshared+primary / public / deleted+shared
  ('93000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-00000000000a',
   '92000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', false, true),
  ('93000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-00000000000a',
   '92000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', true, false),
  ('93000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-00000000000a',
   '92000000-0000-4000-8000-000000000004', '82000000-0000-4000-8000-000000000001', false, false),
  ('93000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-00000000000a',
   '92000000-0000-4000-8000-000000000005', '82000000-0000-4000-8000-000000000001', false, true),
  -- u2's own L1 attachment (unshared)
  ('93000000-0000-4000-8000-000000000006', 'a2000000-0000-4000-8000-00000000000a',
   '92000000-0000-4000-8000-000000000006', '82000000-0000-4000-8000-000000000002', false, false),
  -- u4's shared attachment in L2 (the cross-league probe target)
  ('93000000-0000-4000-8000-000000000008', 'a2000000-0000-4000-8000-00000000000b',
   '92000000-0000-4000-8000-000000000008', '82000000-0000-4000-8000-000000000004', false, true);

-- ---------------------------------------------------------------------------
-- C2. Constraint proofs (privileged — at the indexes/FK, role-independent).
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into league_lists (league_id, list_id, owner_id)
     values ('a2000000-0000-4000-8000-00000000000a',
             '92000000-0000-4000-8000-000000000001',
             '82000000-0000-4000-8000-000000000001') $$,
  '23505', null,
  'attach natural key: re-attaching the same list to the same league by the same owner is 23505 (retry-safe attach — DoD idempotency)');
select throws_ok(
  $$ insert into league_lists (league_id, list_id, owner_id, is_primary_board)
     values ('a2000000-0000-4000-8000-00000000000a',
             '92000000-0000-4000-8000-000000000003',
             '82000000-0000-4000-8000-000000000001', true) $$,
  '23505', null,
  'one-primary boundary: a SECOND primary board for the same (league, member) is 23505 (u1 already has ls2 primary)');
select lives_ok(
  $$ insert into league_lists (id, league_id, list_id, owner_id, is_primary_board)
     values ('93000000-0000-4000-8000-000000000009',
             'a2000000-0000-4000-8000-00000000000a',
             '92000000-0000-4000-8000-000000000009',
             '82000000-0000-4000-8000-000000000002', true) $$,
  'a DIFFERENT member''s primary in the SAME league coexists — the index scope is per (league, owner), not per league');
select throws_ok(
  $$ insert into league_lists (league_id, list_id, owner_id)
     values ('a2000000-0000-4000-8000-00000000000a',
             '92000000-0000-4000-8000-000000000007',
             '82000000-0000-4000-8000-000000000001') $$,
  '23503', null,
  'D106: attaching someone ELSE''S list (owner_id ≠ lists.owner_id) is 23503 even PRIVILEGED — the composite FK, not the route, closes the forced-share hole');
select is(
  (select count(*) from league_lists), 7::bigint,
  'privileged total-rows pin: 7 attachments exist (the row-exists guard behind every 0-affected RETURNING-count below)');

-- ---------------------------------------------------------------------------
-- D. u1 (list owner, member of L1) — owner-arm reads + the write surface.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "82000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select is(
  (select count(*) from league_lists
   where league_id = 'a2000000-0000-4000-8000-00000000000a'),
  4::bigint,
  'u1 sees exactly their own 4 L1 attachments — u2''s two UNSHARED attachments are invisible to a fellow member');
select is(
  (select count(*) from league_lists
   where league_id = 'a2000000-0000-4000-8000-00000000000b'),
  0::bigint,
  'u1 sees ZERO L2 attachments — u4''s share is member-gated and u1 is not an L2 member');
select lives_ok(
  $$ insert into league_lists (id, league_id, list_id, owner_id)
     values ('93000000-0000-4000-8000-000000000003',
             'a2000000-0000-4000-8000-00000000000a',
             '92000000-0000-4000-8000-000000000003',
             '82000000-0000-4000-8000-000000000001') $$,
  'a member attaches their OWN list (the sanctioned client write — §12.15 FOR ALL)');
select results_eq(
  $$ with d as (delete from league_lists
                where id = '93000000-0000-4000-8000-000000000003' returning 1)
     select count(*) from d $$,
  $$ values (1::bigint) $$,
  'the owner detaches their own attachment (RETURNING 1) — non-destructive, the list survives (net-zero for the counts above)');
select throws_ok(
  $$ insert into league_lists (league_id, list_id, owner_id)
     values ('a2000000-0000-4000-8000-00000000000a',
             '92000000-0000-4000-8000-000000000006',
             '82000000-0000-4000-8000-000000000002') $$,
  '42501', null,
  'owner_id spoof (u1 inserting a row AS u2) is 42501 — WITH CHECK pins owner_id = auth.uid()');
select throws_ok(
  $$ insert into league_lists (league_id, list_id, owner_id)
     values ('a2000000-0000-4000-8000-00000000000b',
             '92000000-0000-4000-8000-000000000003',
             '82000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'attaching into a league u1 does NOT belong to is 42501 — WITH CHECK pins is_league_member');
select throws_ok(
  $$ insert into league_lists (league_id, list_id, owner_id)
     values ('a2000000-0000-4000-8000-00000000000a',
             '92000000-0000-4000-8000-000000000007',
             '82000000-0000-4000-8000-000000000001') $$,
  '23503', null,
  'D106 from the CLIENT role: u1 attaching u3''s list under their own owner_id passes RLS but the composite FK refuses (23503) — no path can force-share another user''s list');
select is(
  (select count(*) from lists
   where id = '92000000-0000-4000-8000-000000000005'),
  1::bigint,
  'the OWNER still reads their own soft-deleted list (001 owner arm untouched by the additive policy)');

-- ---------------------------------------------------------------------------
-- E. u2 (fellow member of L1) — THE privacy matrix, all three layers.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "82000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

select is(
  (select count(*) from league_lists
   where league_id = 'a2000000-0000-4000-8000-00000000000a'),
  4::bigint,
  'u2 sees own 2 + u1''s 2 SHARED attachments = 4 (SELECT-sees-N pin for the writes below)');
select is(
  (select count(*) from league_lists
   where list_id = '92000000-0000-4000-8000-000000000002'),
  0::bigint,
  'PRIVACY PIN: u1''s NON-shared attachment is invisible to a fellow member (the DoD break-probe target)');
select is(
  (select count(*) from league_lists
   where list_id = '92000000-0000-4000-8000-000000000001'),
  1::bigint,
  'positive control: u1''s SHARED attachment IS visible to a fellow member');
select results_eq(
  $$ with w as (update league_lists set shared_with_league = false
                where list_id = '92000000-0000-4000-8000-000000000001' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'u2 UPDATE on u1''s (visible) shared attachment affects 0 rows — the FOR ALL policy is owner-scoped (RETURNING-count; sees 1, changes none)');
select results_eq(
  $$ with d as (delete from league_lists
                where list_id = '92000000-0000-4000-8000-000000000001' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'u2 DELETE on u1''s shared attachment affects 0 rows');
select throws_ok(
  $$ update league_lists set is_primary_board = true
     where id = '93000000-0000-4000-8000-000000000006' $$,
  '23505', null,
  'one-primary boundary from the OWNER''S OWN client write: promoting a second attachment while ls9 is primary is 23505 — the index, not the route''s clear-first, is the guarantee');
select results_eq(
  $$ with w as (update league_lists set shared_with_league = true
                where id = '93000000-0000-4000-8000-000000000006' returning 1)
     select count(*) from w $$,
  $$ values (1::bigint) $$,
  'u2 toggles THEIR OWN attachment shared (RETURNING 1) — the sanctioned §15.5 PATCH surface');

-- lists layer (the §12.15 note policy)
select is(
  (select count(*) from lists
   where id = '92000000-0000-4000-8000-000000000001'),
  1::bigint,
  'a member READS a PRIVATE list that is share-linked to their league (§12.15 note — the policy''s whole purpose)');
select is(
  (select count(*) from lists
   where id = '92000000-0000-4000-8000-000000000002'),
  0::bigint,
  'PRIVACY PIN: the UNSHARED private list stays invisible to a fellow member — attachment alone grants nothing');
select is(
  (select count(*) from lists
   where id = '92000000-0000-4000-8000-000000000003'),
  0::bigint,
  'baseline: an UNATTACHED private list is invisible (the additive policy requires a league_lists link)');
select is(
  (select count(*) from lists
   where id = '92000000-0000-4000-8000-000000000004'),
  1::bigint,
  'positive control: a PUBLIC attached list reads via 001''s public arm (unchanged)');
select is(
  (select count(*) from lists
   where id = '92000000-0000-4000-8000-000000000005'),
  0::bigint,
  'a soft-DELETED shared-private list is NOT readable by members (the deleted_at IS NULL conjunct — owner-only, mirroring 001''s public arm)');
select is(
  (select count(*) from lists
   where id = '92000000-0000-4000-8000-000000000008'),
  0::bigint,
  'a list shared with a DIFFERENT league (L2) is invisible — the share is league-scoped, not global');

-- list_players layer (the D106 companion policy)
select is(
  (select count(*) from list_players
   where list_id = '92000000-0000-4000-8000-000000000001'),
  2::bigint,
  'D106 companion: a member reads the ROWS of the share-linked private list ("opening" a list means its players)');
select is(
  (select count(*) from list_players
   where list_id = '92000000-0000-4000-8000-000000000002'),
  0::bigint,
  'PRIVACY PIN (companion): the unshared private list''s rows stay invisible to a fellow member');
select is(
  (select count(*) from list_players
   where list_id = '92000000-0000-4000-8000-000000000005'),
  0::bigint,
  'companion deleted conjunct: the soft-deleted shared list''s rows are NOT readable by members');
select is(
  (select count(*) from list_players
   where list_id = '92000000-0000-4000-8000-000000000008'),
  0::bigint,
  'companion league scope: rows of a list shared with a league u2 is not in are invisible');

-- ---------------------------------------------------------------------------
-- F. u3 (outsider with their own list) — non-member never, every layer.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "82000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);

select is(
  (select count(*) from league_lists), 0::bigint,
  'an outsider sees ZERO attachments anywhere (SELECT-sees-0; the privileged 7-row pin above is the row-exists guard)');
select throws_ok(
  $$ insert into league_lists (league_id, list_id, owner_id)
     values ('a2000000-0000-4000-8000-00000000000a',
             '92000000-0000-4000-8000-000000000007',
             '82000000-0000-4000-8000-000000000003') $$,
  '42501', null,
  'a NON-member attaching their own list is 42501 — WITH CHECK requires membership, not just ownership');
select is(
  (select count(*) from lists
   where id = '92000000-0000-4000-8000-000000000001'),
  0::bigint,
  'PRIVACY PIN: a non-member NEVER reads a shared-private list — the share reaches league members only');
select is(
  (select count(*) from list_players
   where list_id = '92000000-0000-4000-8000-000000000001'),
  0::bigint,
  'companion: a non-member never reads the shared-private list''s rows');
select results_eq(
  $$ with w as (update league_lists set shared_with_league = false returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'outsider UPDATE across ALL attachments affects 0 rows (RETURNING-count over the privileged 7)');
select results_eq(
  $$ with d as (delete from league_lists returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'outsider DELETE across ALL attachments affects 0 rows');

-- ---------------------------------------------------------------------------
-- G. anon — deny-by-default + the public-read regression guards.
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select is(
  (select count(*) from league_lists), 0::bigint,
  'anon sees zero attachments');
select throws_ok(
  $$ insert into league_lists (league_id, list_id, owner_id)
     values ('a2000000-0000-4000-8000-00000000000a',
             '92000000-0000-4000-8000-000000000001',
             '82000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'anon INSERT into league_lists denied');
select is(
  (select count(*) from lists
   where id = '92000000-0000-4000-8000-000000000001'),
  0::bigint,
  'anon never reads a shared-private list (auth.uid() is NULL on both arms)');
select is(
  (select count(*) from lists
   where id = '92000000-0000-4000-8000-000000000004'),
  1::bigint,
  'regression guard: anon still reads a PUBLIC list — the additive policy disturbed nothing in 001''s public arm');
select is(
  (select count(*) from list_players
   where list_id = '92000000-0000-4000-8000-000000000004'),
  1::bigint,
  'regression guard: anon still reads a public list''s rows (001''s list_players visibility arm untouched)');
reset role;

select * from finish();
rollback;
