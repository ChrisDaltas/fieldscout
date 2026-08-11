-- ============================================================================
-- list_links — migration 080 (Lists v2; Chris's ruling 2026-08-11: *"lets
-- create the table for storing the link, we need a way to link back to
-- resources used and a way for creators to attached videos to their lists"*).
-- pgTAP file is **029** (028 = list_player_drafted; next free at task time).
--
-- What this file has to make impossible to break silently:
--
--   * **The read/write ASYMMETRY, which is the whole design.** Reads follow
--     the LIST's own visibility; writes are OWNER-ONLY. Those are two
--     different rules, and the interesting case is the row where they
--     disagree: a league member who CAN read a shared private list's links
--     must NOT be able to staple their own video onto it. Pinned as an
--     adjacent lives/throws pair in section E, on the SAME list, so neither
--     half can pass by accident.
--
--   * **The RLS-DEFERRING SELECT policy.** 080's `EXISTS (SELECT 1 FROM
--     lists ...)` carries no visibility conjunct: it runs under `lists`'s OWN
--     RLS, so "any list you can read" is the rule. Pinned in ALL THREE
--     directions — a stranger CAN read a public list's links, CANNOT read a
--     plain private list's, and CAN read a private list's when it is SHARED
--     with a league they both belong to (067). **That third pin is the
--     load-bearing one**, exactly as R173 was for 079: it is the ONLY
--     assertion in this file that distinguishes 080's policy from the inline
--     `is_private = FALSE OR owner_id = auth.uid()` form that 013
--     `list_favorites` uses. Substitute that form and this file stays green
--     everywhere else.
--
--   * **ANON CAN READ A PUBLIC LIST'S LINKS.** The share view
--     (`/u/[username]/lists/[slug]`) is server-rendered and SEO-critical
--     (plan D7), and it renders signed-out. A policy tightened to
--     `auth.uid() IS NOT NULL` would break that page and no RLS pin phrased
--     around signed-in users would notice.
--
--   * **The URL guard AT THE DATABASE.** `javascript:`, `data:`, `vbscript:`
--     and an embedded newline are all 23514 even PRIVILEGED — i.e. on paths
--     that never see the service's Zod. That is the `duplicate_list` lesson:
--     this codebase already has an RPC that copies a column verbatim past all
--     validation, so "the route checks it" is not a guarantee, and the CHECK
--     is what still holds when the next such path is written.
--
--   * **Isolation, both directions.** Every 0-count / 0-affected pin is paired
--     with a positive control proving the row it failed to touch actually
--     EXISTS. A policy that "blocks" an empty table proves nothing (CLAUDE.md
--     — "never let 'nothing happened' mean 'it worked'", applied to the test
--     suite itself).
--
--   * **Grants.** `authenticated` needs SELECT/INSERT/UPDATE/DELETE and `anon`
--     needs SELECT, via 037's default privileges (D18→D23: no per-object
--     GRANT). The feature 500s without them and no RLS pin would notice.
--
--   * **Additivity.** 080 touches no other table: the 001+067 policy sets on
--     `lists` and `list_players` are pinned unchanged.
--
-- Falsifiability map (probed live — see the PR):
--   replacing the SELECT policy's bare `EXISTS` with 013's hardcoded-
--   visibility form fails ONLY the league-shared-private read pin in section
--   E; dropping the SELECT policy's deference entirely fails the anon and
--   stranger read pins; dropping `owner_id = auth.uid()` from the INSERT
--   policy fails the two 42501 write pins in section E; dropping
--   `deleted_at IS NULL` from INSERT fails the soft-deleted pin in section D;
--   relaxing `list_links_url_scheme_check` fails the four scheme pins in
--   section C; dropping the unique constraint fails the 23505 pin.
--
-- Determinism: fixed UUIDs, fixed literals, no wall-clock. All privileged
-- fixture work runs BEFORE any JWT claims are set (set_config persists to txn
-- end — D49(7)). Fixture owners are is_pro: the pre-leagues free-account cap
-- trigger (one private list) fires for every role.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(56);

-- ---------------------------------------------------------------------------
-- A. Shape, policy set, grants, additivity
-- ---------------------------------------------------------------------------
select has_table('public', 'list_links', 'list_links exists');
select columns_are('public', 'list_links',
  array['id', 'list_id', 'kind', 'url', 'title', 'source_label',
        'duration_label', 'position', 'created_at', 'updated_at'],
  'exact column set — every one of them a fact the reference screen RENDERS (title, source, duration, order); nothing speculative');
select col_is_pk('public', 'list_links', 'id',
  'surrogate PK — unlike 079''s natural key, a link has a mutable payload and needs a stable handle for DELETE .../links/[linkId]');
select fk_ok('public', 'list_links', 'list_id', 'public', 'lists', 'id',
  'list_id → lists (a link belongs to the LIST, not to a viewer — the ruling)');

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.list_links'::regclass
     and conname = 'list_links_url_scheme_check'),
  'CHECK ((url ~* ''^https?://[^[:space:]]+$''::text))',
  'url scheme CHECK golden-pinned — http/https ONLY, no embedded whitespace. This is what still holds on a path that never sees Zod (the duplicate_list lesson)');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.list_links'::regclass
     and conname = 'list_links_url_length_check'),
  'CHECK (((char_length(url) >= 8) AND (char_length(url) <= 2048)))',
  'url length CHECK golden-pinned — mirrors MAX_URL_LENGTH in links-service.ts');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.list_links'::regclass
     and conname = 'list_links_kind_check'),
  'CHECK ((kind = ANY (ARRAY[''video''::text, ''article''::text])))',
  'kind CHECK golden-pinned — the handoff''s closed two-value union, so the renderer''s glyph switch is total');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.list_links'::regclass
     and conname = 'list_links_duration_label_check'),
  'CHECK (((duration_label IS NULL) OR (duration_label ~ ''^[0-9]{1,3}:[0-5][0-9](:[0-5][0-9])?$''::text)))',
  'duration CHECK golden-pinned — a CLOCK, not free text, so that line cannot become a second unbounded caption on a public page');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.list_links'::regclass
     and conname = 'list_links_list_url_key'),
  'UNIQUE (list_id, url)',
  'unique (list_id, url) golden-pinned — attaching the same resource twice is a mistake, and the service maps 23505 to a specific 409');
select is(
  (select indexdef from pg_indexes
   where schemaname = 'public' and indexname = 'idx_list_links_list_position'),
  'CREATE INDEX idx_list_links_list_position ON public.list_links USING btree (list_id, "position")',
  'idx_list_links_list_position golden-pinned — list_id is the FK every policy uses, with the sort key trailing so the read is an index-ordered range scan (§8.1)');

select ok(
  (select rowsecurity from pg_tables
   where schemaname = 'public' and tablename = 'list_links'),
  'RLS enabled on list_links');
select policies_are('public', 'list_links',
  array['list_links owner delete',
        'list_links owner insert',
        'list_links owner update',
        'list_links readable with the list'],
  'exactly FOUR policies — one permissive read, three owner-only writes');
select policy_cmd_is('public', 'list_links',
  'list_links readable with the list', 'SELECT', 'the read policy is SELECT');
select policy_cmd_is('public', 'list_links',
  'list_links owner insert', 'INSERT', 'the insert policy is INSERT');
select policy_cmd_is('public', 'list_links',
  'list_links owner update', 'UPDATE', 'the update policy is UPDATE (the reorder route''s only caller)');
select policy_cmd_is('public', 'list_links',
  'list_links owner delete', 'DELETE', 'the delete policy is DELETE');

-- Grants: RLS pins cannot see a missing grant — the feature would 500 for
-- every user with every policy still "passing" (D18→D23).
select ok(has_table_privilege('authenticated', 'public.list_links', 'SELECT'),
  'authenticated has SELECT (037 default privileges, no per-object GRANT)');
select ok(has_table_privilege('authenticated', 'public.list_links', 'INSERT'),
  'authenticated has INSERT');
select ok(has_table_privilege('authenticated', 'public.list_links', 'UPDATE'),
  'authenticated has UPDATE');
select ok(has_table_privilege('authenticated', 'public.list_links', 'DELETE'),
  'authenticated has DELETE');
select ok(has_table_privilege('anon', 'public.list_links', 'SELECT'),
  'ANON has SELECT — the server-rendered share view (plan D7) renders signed-out, and RLS still scopes it to lists anon can read');

-- Additivity (§8.1): 080 adds a table and NOTHING else.
select policies_are('public', 'lists',
  array['League-shared lists readable by league members',
        'Public lists are viewable by everyone',
        'Users can manage own lists'],
  'lists policy set UNTOUCHED by 080 (001''s two + 067''s one)');
select policies_are('public', 'list_players',
  array['League-shared list players readable by league members',
        'List players follow list visibility',
        'Users can manage players in own lists'],
  'list_players policy set UNTOUCHED by 080');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — BEFORE any claims, D49(7)).
--    u1 owns: ll1 PUBLIC · ll2 PRIVATE · ll3 PRIVATE soft-DELETED ·
--             ll5 PRIVATE but SHARED with league L1 (067) — the load-bearing pin
--    u2 owns: ll4 PUBLIC        u3 = a signed-in user, NOT a league member
--    League L1: u1 commissioner, u2 manager, u3 not a member.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '85000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-lnk1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lnk_owner_one"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '85000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-lnk2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lnk_other_two"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '85000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'pgtap-lnk3@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lnk_third_three"}', now(), now());

update profiles set is_pro = true
where id in ('85000000-0000-4000-8000-000000000001',
             '85000000-0000-4000-8000-000000000002',
             '85000000-0000-4000-8000-000000000003');

insert into lists (id, owner_id, title, slug, is_private, deleted_at) values
  ('95000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001',
   'lnk u1 public', 'lnk-u1-pub', false, null),
  ('95000000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000001',
   'lnk u1 private', 'lnk-u1-priv', true, null),
  ('95000000-0000-4000-8000-000000000003', '85000000-0000-4000-8000-000000000001',
   'lnk u1 private deleted', 'lnk-u1-del', true, now()),
  ('95000000-0000-4000-8000-000000000004', '85000000-0000-4000-8000-000000000002',
   'lnk u2 public', 'lnk-u2-pub', false, null),
  ('95000000-0000-4000-8000-000000000005', '85000000-0000-4000-8000-000000000001',
   'lnk u1 private league-shared', 'lnk-u1-priv-shared', true, null);

-- The 067 league-shared-private fixture. ll5 differs from ll2 in EXACTLY one
-- respect — u1 attached it to a league u2 is also in, with
-- shared_with_league = TRUE — so the pins in section E isolate the
-- RLS-deferring EXISTS and nothing else.
insert into leagues (id, owner_id, name, season) values
  ('a5000000-0000-4000-8000-00000000000a', '85000000-0000-4000-8000-000000000001',
   'pgtap-lnk-league', 2026);

insert into league_members (league_id, user_id, role) values
  ('a5000000-0000-4000-8000-00000000000a', '85000000-0000-4000-8000-000000000001', 'commissioner'),
  ('a5000000-0000-4000-8000-00000000000a', '85000000-0000-4000-8000-000000000002', 'manager');

insert into league_lists (league_id, list_id, owner_id, is_primary_board, shared_with_league) values
  ('a5000000-0000-4000-8000-00000000000a', '95000000-0000-4000-8000-000000000005',
   '85000000-0000-4000-8000-000000000001', false, true);

insert into list_links (id, list_id, kind, url, title, source_label, duration_label, position) values
  -- The reference screenshot's own card, stored verbatim.
  ('b5000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001',
   'video', 'https://youtube.com/watch?v=pgtap-lnk-1',
   'Round 1 walkthrough — every pick, ranked', 'Field Scout on YouTube', '18:42', 0),
  ('b5000000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000002',
   'article', 'https://example.com/pgtap-lnk-private', 'Private list article', null, null, 0),
  ('b5000000-0000-4000-8000-000000000005', '95000000-0000-4000-8000-000000000005',
   'video', 'https://youtube.com/watch?v=pgtap-lnk-shared', 'League-shared film', null, '2:05', 0);

-- ---------------------------------------------------------------------------
-- C. The URL guard and the payload constraints, PRIVILEGED — i.e. proven at
--    the CHECK, on paths that never touch the service's validation.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into list_links (list_id, kind, url, title)
     values ('95000000-0000-4000-8000-000000000001', 'video',
             'javascript:alert(document.cookie)', 'xss') $$,
  '23514', null,
  'javascript: is 23514 AT THE DATABASE — this url renders as an href on the PUBLIC share view (plan D7), so the scheme guard cannot live only in the route');
select throws_ok(
  $$ insert into list_links (list_id, kind, url, title)
     values ('95000000-0000-4000-8000-000000000001', 'video',
             'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'xss') $$,
  '23514', null,
  'data: is 23514 at the database');
select throws_ok(
  $$ insert into list_links (list_id, kind, url, title)
     values ('95000000-0000-4000-8000-000000000001', 'video',
             'vbscript:msgbox(1)', 'xss') $$,
  '23514', null,
  'vbscript: is 23514 at the database');
select throws_ok(
  $$ insert into list_links (list_id, kind, url, title)
     values ('95000000-0000-4000-8000-000000000001', 'video',
             E'https://ok.example.com/a\njavascript:alert(1)', 'smuggled') $$,
  '23514', null,
  'a url containing a NEWLINE is 23514 — the [^[:space:]] clause, which is what a smuggling attempt looks like after it survives a naive prefix test');
select lives_ok(
  $$ insert into list_links (id, list_id, kind, url, title)
     values ('b5000000-0000-4000-8000-0000000000ff',
             '95000000-0000-4000-8000-000000000001', 'article',
             'https://fieldscout.gg/ok', 'positive control: https is accepted') $$,
  'positive control — an ordinary https url IS accepted, so the four 23514s above are the scheme guard and not a broken INSERT');
select throws_ok(
  $$ insert into list_links (list_id, kind, url, title)
     values ('95000000-0000-4000-8000-000000000001', 'video',
             'https://youtube.com/watch?v=pgtap-lnk-1', 'the same video again') $$,
  '23505', null,
  'the same url twice on one list is 23505 — the service maps it to a specific 409, never a silent second identical card');
select throws_ok(
  $$ insert into list_links (list_id, kind, url, title)
     values ('95000000-0000-4000-8000-000000000001', 'podcast',
             'https://example.com/pod', 'wrong kind') $$,
  '23514', null,
  'a kind outside {video, article} is 23514 — keeps the renderer''s glyph switch total');
select throws_ok(
  $$ insert into list_links (list_id, kind, url, title)
     values ('95000000-0000-4000-8000-000000000001', 'video',
             'https://example.com/blank', '   ') $$,
  '23514', null,
  'a whitespace-only title is 23514 (btrim) — never an unlabelled card with a remove button');
select throws_ok(
  $$ insert into list_links (list_id, kind, url, title, duration_label)
     values ('95000000-0000-4000-8000-000000000001', 'video',
             'https://example.com/dur', 'bad duration', '18 minutes or so') $$,
  '23514', null,
  'a free-text duration is 23514 — that line is a clock, not a second caption');
select lives_ok(
  $$ insert into list_links (id, list_id, kind, url, title, duration_label)
     values ('b5000000-0000-4000-8000-0000000000fe',
             '95000000-0000-4000-8000-000000000001', 'video',
             'https://example.com/long', 'long film', '1:02:33') $$,
  'positive control — an h:mm:ss duration IS accepted, so the pin above is the format and not the column');
select is(
  (select count(*) from list_links
   where list_id in ('95000000-0000-4000-8000-000000000001',
                     '95000000-0000-4000-8000-000000000002',
                     '95000000-0000-4000-8000-000000000005')),
  5::bigint,
  'privileged row count for this suite''s lists: 3 seeded + 2 positive controls — the row-exists guard behind every 0-affected pin below');

-- ---------------------------------------------------------------------------
-- D. u1 — the owner. Reads, and all three sanctioned writes.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "85000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select is(
  (select count(*) from list_links
   where list_id = '95000000-0000-4000-8000-000000000002'),
  1::bigint,
  'u1 reads the links on their OWN private list');
select lives_ok(
  $$ insert into list_links (id, list_id, kind, url, title)
     values ('b5000000-0000-4000-8000-000000000010',
             '95000000-0000-4000-8000-000000000002', 'article',
             'https://example.com/u1-own', 'u1 attaches to their own list') $$,
  'u1 attaches a link to their own list — the ruling''s "creators attach videos to THEIR lists"');
select throws_ok(
  $$ insert into list_links (list_id, kind, url, title)
     values ('95000000-0000-4000-8000-000000000003', 'article',
             'https://example.com/u1-trashed', 'attach to a trashed list') $$,
  '42501', null,
  'attaching to a SOFT-DELETED list is 42501 even for its owner (who can still SELECT it under 001''s owner arm) — the INSERT policy''s deleted_at conjunct');
select results_eq(
  $$ with u as (update list_links set position = 3
                where id = 'b5000000-0000-4000-8000-000000000010' returning 1)
     select count(*) from u $$,
  $$ values (1::bigint) $$,
  'u1 reorders their own link (RETURNING 1) — the only caller of the UPDATE policy');
select results_eq(
  $$ with d as (delete from list_links
                where id = 'b5000000-0000-4000-8000-000000000010' returning 1)
     select count(*) from d $$,
  $$ values (1::bigint) $$,
  'u1 detaches their own link (RETURNING 1)');

-- ---------------------------------------------------------------------------
-- E. u2 — a stranger who is also a league-mate. THE ASYMMETRY LIVES HERE:
--    reads follow the list, writes do not.
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "85000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

select is(
  (select count(*) from list_links
   where list_id = '95000000-0000-4000-8000-000000000001'),
  3::bigint,
  'u2 reads a PUBLIC list''s links (the seeded card + the two positive controls) — "if you can see the list, you can see its links"');
select is(
  (select count(*) from list_links
   where list_id = '95000000-0000-4000-8000-000000000002'),
  0::bigint,
  'u2 CANNOT read u1''s plain PRIVATE list''s links — the SELECT''s EXISTS runs under lists'' own RLS, and that list is invisible');

-- THE PIN THAT MAKES THE DESIGN FALSIFIABLE. ll5 is every bit as PRIVATE and
-- as much u1's as ll2 above; the ONLY difference is that u1 attached it to
-- league L1 with shared_with_league = TRUE, which 067's policy makes readable
-- to fellow member u2. 080's bare EXISTS therefore passes for it. The
-- hardcoded `is_private = FALSE OR owner_id = auth.uid()` form that 013 uses —
-- the one 080's banner names as the wrong answer — would return 0 here and
-- would break NOTHING else in this file.
select is(
  (select count(*) from list_links
   where list_id = '95000000-0000-4000-8000-000000000005'),
  1::bigint,
  'u2 CAN read u1''s PRIVATE list''s links when it is SHARED with their league (067) — the RLS-deferring EXISTS covers it for free; spelling visibility out inline would silently exclude it');

-- ...and the other half of the asymmetry, on the SAME two lists.
select throws_ok(
  $$ insert into list_links (list_id, kind, url, title)
     values ('95000000-0000-4000-8000-000000000001', 'video',
             'https://example.com/u2-on-u1-public', 'u2 on u1''s public list') $$,
  '42501', null,
  'u2 CANNOT attach to u1''s PUBLIC list — readable is not writable. A link is the AUTHOR''s attribution, not a viewer''s annotation (the ruling)');
select throws_ok(
  $$ insert into list_links (list_id, kind, url, title)
     values ('95000000-0000-4000-8000-000000000005', 'video',
             'https://example.com/u2-on-shared', 'u2 on the league-shared list') $$,
  '42501', null,
  'u2 CANNOT attach to the league-shared private list they just read three assertions ago — the exact row where "readable" and "writable" disagree');
select results_eq(
  $$ with u as (update list_links set position = 99
                where list_id = '95000000-0000-4000-8000-000000000001' returning 1)
     select count(*) from u $$,
  $$ values (0::bigint) $$,
  'u2 reordering u1''s links affects 0 rows — and u2 can SEE those 3 rows, so this is refusal, not absence');
select results_eq(
  $$ with d as (delete from list_links
                where list_id = '95000000-0000-4000-8000-000000000001' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'u2 deleting u1''s links affects 0 rows — the epilogue proves those rows were there to delete');

-- ---------------------------------------------------------------------------
-- F. u3 (signed in, no league) and anon — deny-by-default per role (§4.2/§8.2).
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "85000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);

select is(
  (select count(*) from list_links
   where list_id = '95000000-0000-4000-8000-000000000005'),
  0::bigint,
  'u3 is NOT in the league, so the shared private list''s links are invisible — the league pin above is membership, not a hole');
select is(
  (select count(*) from list_links
   where list_id = '95000000-0000-4000-8000-000000000001'),
  3::bigint,
  'positive control: u3 CAN read the PUBLIC list''s links, so u3''s 0 above is isolation and not a blanket denial');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select is(
  (select count(*) from list_links
   where list_id = '95000000-0000-4000-8000-000000000001'),
  3::bigint,
  'ANON reads a PUBLIC list''s links — the server-rendered share view (plan D7) renders signed-out, and a policy tightened to auth.uid() IS NOT NULL would break that page silently');
select is(
  (select count(*) from list_links
   where list_id = '95000000-0000-4000-8000-000000000002'),
  0::bigint,
  'anon CANNOT read a private list''s links');
select throws_ok(
  $$ insert into list_links (list_id, kind, url, title)
     values ('95000000-0000-4000-8000-000000000001', 'video',
             'https://example.com/anon', 'anon attaches') $$,
  '42501', null,
  'anon INSERT is 42501 — deliberately onto the PUBLIC list anon can read, so the refusal can only be the owner conjunct');
select results_eq(
  $$ with u as (update list_links set position = 42 returning 1)
     select count(*) from u $$,
  $$ values (0::bigint) $$,
  'anon UPDATE across the whole table affects 0 rows');
select results_eq(
  $$ with d as (delete from list_links returning 1) select count(*) from d $$,
  $$ values (0::bigint) $$,
  'anon DELETE across the whole table affects 0 rows');

-- ---------------------------------------------------------------------------
-- G. Privileged epilogue — every 0-affected pin above failed against rows that
--    REALLY EXIST, and nothing above mutated anything.
-- ---------------------------------------------------------------------------
reset role;

-- Scoped to THIS suite's own lists (the R202 lesson): the epilogue runs with
-- RLS off, so an unscoped count would also count every other suite's rows and
-- report a false red whenever `test:stack` runs alongside.
select is(
  (select count(*) from list_links
   where list_id in ('95000000-0000-4000-8000-000000000001',
                     '95000000-0000-4000-8000-000000000002',
                     '95000000-0000-4000-8000-000000000005')),
  5::bigint,
  'total rows for this suite''s lists is still 5 — u1''s own attach/detach cancelled out, and every stranger and anon write above was a genuine no-op rather than a hit on an empty table');
select is(
  (select position from list_links
   where id = 'b5000000-0000-4000-8000-000000000001'),
  0,
  'u1''s seeded link still sits at position 0 — u2''s and anon''s UPDATEs changed nothing; the 0-affected pins were refusal, not absence');

-- The FK cascade, proven last because it destroys a fixture.
delete from lists where id = '95000000-0000-4000-8000-000000000002';
select is(
  (select count(*) from list_links
   where list_id = '95000000-0000-4000-8000-000000000002'),
  0::bigint,
  'hard-deleting a list cascades its links away — no orphan rows pointing at a list that is gone');

select * from finish();
rollback;
