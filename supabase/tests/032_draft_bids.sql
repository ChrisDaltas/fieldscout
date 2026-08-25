-- ============================================================================
-- Auction schema opener: draft_bids + drafts.budget_adjustments +
-- draft_dnd_marks — migration 083 (spec §12.5, §12.24 (v2.10), §8.6.8
-- context, §9.2; tasks-M3 §4 standing rules, D126/D127/D139, C39/C42;
-- task L.C1.1). pgTAP file is **032** (031 = draft_queue_replace; next
-- free confirmed at task time).
--
-- Falsifiability notes (§4.3):
--   * The C39 partial unique (uniq_draft_bid_action) is proven DIRECTLY at
--     the index, not via an RPC (none exists yet — 085 is L.C1.3's):
--     privileged double-insert of the same (draft_id, action_id) → 23505,
--     while a SECOND NULL-action_id row inserts cleanly and the NULL count
--     lands at exactly 2 (system rows — the tick's opening bids, D129(2)/
--     D130). **Break-probe routing (D144(2), corrected — read this before
--     designing a probe against this file):** dropping the
--     `WHERE action_id IS NOT NULL` clause does NOT turn the coexistence
--     pins RED. Postgres UNIQUE is NULLS DISTINCT by default, so a
--     NON-partial `UNIQUE(draft_id, action_id)` still admits BOTH NULL rows
--     and those pins stay GREEN (verified live: drop + recreate non-partial
--     → Failed 1/71, the indexdef golden ONLY). The WHERE-drop tripwire is
--     therefore the **indexdef golden pin** — this task's deliberate break
--     probe. The C39 regression itself (`action_id` back to §12.5's printed
--     NOT NULL) fails the `col_is_null` pin and kills the system-row fixture
--     with 23502, aborting the suite after 34 asserts — before section E's
--     coexistence pins ever run. *(019's banner carries the identical latent
--     misstatement about `uniq_draft_action`; record-only, D144(2).)*
--   * R43-lesson CHECKs proven behaviorally on BOTH sides of each
--     boundary: amount −1 → 23514 and amount 0 lives (C38: $0 opening
--     bids are legal with auction_zero_dollar_nominations ON); nomination_seq 0 → 23514
--     and nomination_seq 1 lives (D126: the sequence is 1-based).
--   * draft_bids per-role deny-by-default (§4.2): member SELECT positive
--     (SELECT-sees-N), cross-league + outsider + anon see ZERO, and
--     client INSERT/UPDATE/DELETE are refused for EVERY role incl. the
--     commissioner — bids are append-only via RPC (085); there is no
--     UPDATE/DELETE policy for anyone (bid history immutable, D131(2)).
--     Writes RLS silently filters (UPDATE/DELETE) use the RETURNING-count
--     pattern preceded by a same-role SELECT-sees-N pin (or a privileged
--     row-exists pin for rows the role cannot see); INSERT expects 42501.
--     **The matrix is LITERAL, not diagonal (R307):** all four roles ×
--     INSERT/UPDATE/DELETE are probed on `draft_bids`, and every role's
--     cross-user write is probed on `draft_dnd_marks` — the seven cells the
--     original sweep skipped (outsider UPDATE+DELETE on both tables, anon
--     DELETE on bids, anon UPDATE on marks, and every commissioner write
--     against another member's marks) now carry their own pins, each
--     bracketed by a privileged count BEFORE and AFTER so a zero-count
--     proves refusal rather than an empty target.
--   * draft_dnd_marks own-rows BOTH directions: the author reads/writes
--     their own marks (INSERT lives, UPDATE/DELETE RETURNING-1) while
--     ANOTHER member's marks are invisible (count 0) AND unwritable
--     (spoofed-user INSERT → 42501 via WITH CHECK; UPDATE/DELETE
--     RETURNING-0 against a privileged row-exists pin) — even for the
--     commissioner. Anon: zero rows, INSERT 42501.
--   * RECORDED residual pinned AS residual (the R120 class — 083 banner):
--     the §12.24 printed policy validates USER ownership only, so an
--     authenticated NON-member can insert a mark against a foreign
--     draft_id. Pinned lives_ok so the recorded behavior is falsifiable;
--     a future tightening is a spec change that flips that pin
--     deliberately. Harmless by construction: own-rows visibility, never
--     broadcast (§9.2), and the engine never reads the table (C42 —
--     display-only, ruled; no RPC/trigger/worker joins it, ever).
--   * drafts.budget_adjustments (D127 storage half): shape + NOT NULL +
--     '{}' default pinned (information_schema pin for the default — the
--     019 config precedent) plus a behavioral default probe on a fresh
--     row. No CHECK exists by design — legality is solvency-relative
--     (E28), owned by 084's derivation family + 087's validators.
--   * All privileged fixture work runs BEFORE any JWT claims are set
--     (set_config persists to txn end — D49(7)); mid-test privileged pins
--     use `reset role` (013/014/018/019 pattern).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(87);   -- 86 + 087/L.C1.5's voided_at nullability pin (D162)

-- ---------------------------------------------------------------------------
-- A. draft_bids shape (§12.5 + the C39 delta + the R43 CHECKs)
-- ---------------------------------------------------------------------------
select has_table('public', 'draft_bids', 'draft_bids exists');
-- AMENDED IN PLACE by 087/L.C1.5 (the D137 tests-edited-in-place note; the
-- same treatment 083 gave 019's columns_are). `voided_at` is D162's answer to
-- "what does §8.7's 'open bids voided' MEAN in the schema" — nullable, never
-- part of §12.5's printed shape, stamped only by draft_void_nomination_internal.
-- The exact-set assertion is kept exact rather than loosened: a future column
-- added without a decision still fails here.
select columns_are('public', 'draft_bids',
  array['id', 'draft_id', 'league_id', 'nomination_seq', 'player_id',
        'team_id', 'amount', 'action_id', 'created_at', 'voided_at'],
  'exact §12.5 column set + 087''s voided_at (D162)');
select col_is_null('public', 'draft_bids', 'voided_at',
  'voided_at is NULLABLE — NULL is the normal state of a live bid (D162)');
select col_is_pk('public', 'draft_bids', 'id', 'PK id');
select fk_ok('public', 'draft_bids', 'draft_id', 'public', 'drafts', 'id', 'draft_id → drafts');
select fk_ok('public', 'draft_bids', 'league_id', 'public', 'leagues', 'id', 'league_id → leagues (stored for the simple RLS policy, §12.5)');
select fk_ok('public', 'draft_bids', 'player_id', 'public', 'players', 'id', 'player_id → players (TEXT id)');
select fk_ok('public', 'draft_bids', 'team_id', 'public', 'teams', 'id', 'team_id → teams');
select col_not_null('public', 'draft_bids', 'draft_id', 'draft_id NOT NULL');
select col_is_null('public', 'draft_bids', 'league_id',
  'league_id is NULLABLE (095/MP.3, D234) — the engine''s own bid writer stamps the draft''s league_id, which is NULL on a standalone mock. FK kept');
select col_not_null('public', 'draft_bids', 'nomination_seq', 'nomination_seq NOT NULL');
select col_not_null('public', 'draft_bids', 'player_id', 'player_id NOT NULL');
select col_not_null('public', 'draft_bids', 'team_id', 'team_id NOT NULL');
select col_not_null('public', 'draft_bids', 'amount', 'amount NOT NULL');
select col_is_null('public', 'draft_bids', 'action_id',
  'action_id NULLABLE — the C39 delta: system rows (tick opening bids, D129(2)/D130) carry NULL; §12.5''s printed NOT NULL is the recorded erratum (v2.10.2)');
select ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'draft_bids'),
  'RLS enabled on draft_bids');
select policies_are('public', 'draft_bids',
  array['Bids viewable by league members'],
  'exactly ONE policy: the member SELECT (§12.5 printed — bids are public in an open auction) — no client writes, bids land via RPC only (085)');
select policy_cmd_is('public', 'draft_bids', 'Bids viewable by league members', 'SELECT',
  'the draft_bids policy is SELECT-only (append-only via RPC; no UPDATE/DELETE for anyone — D131(2))');
select is(
  (select indexdef from pg_indexes
   where schemaname = 'public' and indexname = 'uniq_draft_bid_action'),
  'CREATE UNIQUE INDEX uniq_draft_bid_action ON public.draft_bids USING btree (draft_id, action_id) WHERE (action_id IS NOT NULL)',
  'uniq_draft_bid_action golden-pinned — the C39/E2 idempotency predicate exact (the 065 uniq_draft_action pattern)');
select is(
  (select indexdef from pg_indexes
   where schemaname = 'public' and indexname = 'idx_draft_bids_nom'),
  'CREATE INDEX idx_draft_bids_nom ON public.draft_bids USING btree (draft_id, nomination_seq, amount DESC)',
  'idx_draft_bids_nom golden-pinned — §12.5''s high-bid-per-nomination scan (amount DESC)');

-- ---------------------------------------------------------------------------
-- B. drafts.budget_adjustments shape (D127 — migration 083 item 2)
-- ---------------------------------------------------------------------------
select has_column('public', 'drafts', 'budget_adjustments',
  'drafts.budget_adjustments added (D127 — the commissioner-edit storage half; budgets stay derived)');
select col_type_is('public', 'drafts', 'budget_adjustments', 'jsonb', 'budget_adjustments is JSONB');
select col_not_null('public', 'drafts', 'budget_adjustments', 'budget_adjustments NOT NULL');
select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'drafts' and column_name = 'budget_adjustments'),
  $$'{}'::jsonb$$,
  $$budget_adjustments defaults '{}' (information_schema pin — the 019 config precedent)$$);

-- ---------------------------------------------------------------------------
-- C. draft_dnd_marks shape (§12.24 VERBATIM — v2.10/D139; display-only, C42)
-- ---------------------------------------------------------------------------
select has_table('public', 'draft_dnd_marks', 'draft_dnd_marks exists');
select columns_are('public', 'draft_dnd_marks',
  array['id', 'draft_id', 'user_id', 'player_id', 'created_at'],
  'exact §12.24 column set');
select col_is_pk('public', 'draft_dnd_marks', 'id', 'PK id');
select fk_ok('public', 'draft_dnd_marks', 'draft_id', 'public', 'drafts', 'id', 'draft_id → drafts');
select fk_ok('public', 'draft_dnd_marks', 'user_id', 'public', 'profiles', 'id', 'user_id → profiles');
select fk_ok('public', 'draft_dnd_marks', 'player_id', 'public', 'players', 'id', 'player_id → players');
select col_is_unique('public', 'draft_dnd_marks', array['draft_id', 'user_id', 'player_id'],
  'UNIQUE(draft_id, user_id, player_id) — one mark per player per user per draft (§12.24)');
select ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'draft_dnd_marks'),
  'RLS enabled on draft_dnd_marks');
select policies_are('public', 'draft_dnd_marks',
  array['Own DND marks'],
  'exactly ONE policy: own-rows FOR ALL (§12.24 printed — the draft_queues client-write precedent, plan §8.2)');
select policy_cmd_is('public', 'draft_dnd_marks', 'Own DND marks', 'ALL',
  'Own DND marks is FOR ALL — own rows read and write, both gated on user_id = auth.uid()');
select has_index('public', 'draft_dnd_marks', 'idx_draft_dnd_user', 'idx_draft_dnd_user exists');

-- ---------------------------------------------------------------------------
-- D. Fixtures (postgres context — before any JWT claims; D49(7)).
--    u1 commish L1 (team t1) · u2 manager L1 (team t2) · u3 outsider ·
--    u4 manager L2 (team t4). d1 = L1's LIVE AUCTION draft; d2 = L2's.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '8b000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-ab1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "ab_commish"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '8b000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-ab2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "ab_member"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '8b000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'pgtap-ab3@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "ab_outsider"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '8b000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'pgtap-ab4@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "ab_l2member"}', now(), now());

insert into leagues (id, owner_id, name, season) values
  ('a3000000-0000-4000-8000-00000000000a', '8b000000-0000-4000-8000-000000000001', 'pgtap-ab-1', 2026),
  ('a3000000-0000-4000-8000-00000000000b', '8b000000-0000-4000-8000-000000000004', 'pgtap-ab-2', 2026);

insert into teams (id, owner_id, name, league_id) values
  ('c3000000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-000000000001',
   'pgtap-ab-t1', 'a3000000-0000-4000-8000-00000000000a'),
  ('c3000000-0000-4000-8000-000000000002', '8b000000-0000-4000-8000-000000000002',
   'pgtap-ab-t2', 'a3000000-0000-4000-8000-00000000000a'),
  ('c3000000-0000-4000-8000-000000000004', '8b000000-0000-4000-8000-000000000004',
   'pgtap-ab-t4', 'a3000000-0000-4000-8000-00000000000b');

insert into league_members (league_id, user_id, team_id, role) values
  ('a3000000-0000-4000-8000-00000000000a', '8b000000-0000-4000-8000-000000000001',
   'c3000000-0000-4000-8000-000000000001', 'commissioner'),
  ('a3000000-0000-4000-8000-00000000000a', '8b000000-0000-4000-8000-000000000002',
   'c3000000-0000-4000-8000-000000000002', 'manager'),
  ('a3000000-0000-4000-8000-00000000000b', '8b000000-0000-4000-8000-000000000004',
   'c3000000-0000-4000-8000-000000000004', 'commissioner');

insert into players (id, full_name, position) values
  ('pgtap-ab-p1', 'PgTap Auction QB', 'QB'),
  ('pgtap-ab-p2', 'PgTap Auction RB', 'RB'),
  ('pgtap-ab-p3', 'PgTap Auction WR', 'WR'),
  ('pgtap-ab-p4', 'PgTap Auction TE', 'TE');

insert into drafts (id, league_id, draft_type, status, is_mock, config) values
  ('e3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-00000000000a',
   'auction', 'live', false, '{}'),
  ('e3000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-00000000000b',
   'auction', 'scheduled', false, '{}');

-- Bids in d1 — nomination 1: a SYSTEM opening bid (NULL action_id — the
-- tick's D129(2) row) + u2's raise (action A1). Bid in d2: the
-- cross-league invisibility target.
insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id) values
  ('e3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-00000000000a',
   1, 'pgtap-ab-p1', 'c3000000-0000-4000-8000-000000000001', 1, null),
  ('e3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-00000000000a',
   1, 'pgtap-ab-p1', 'c3000000-0000-4000-8000-000000000002', 2,
   'f3000000-0000-4000-8000-0000000000a1'),
  ('e3000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-00000000000b',
   1, 'pgtap-ab-p2', 'c3000000-0000-4000-8000-000000000004', 1,
   'f3000000-0000-4000-8000-0000000000b1');

-- DND marks: u2 has 2 on d1 · u1 (commish) has 1 on d1 · u4 has 1 on d2.
insert into draft_dnd_marks (draft_id, user_id, player_id) values
  ('e3000000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-000000000002', 'pgtap-ab-p1'),
  ('e3000000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-000000000002', 'pgtap-ab-p2'),
  ('e3000000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-000000000001', 'pgtap-ab-p3'),
  ('e3000000-0000-4000-8000-000000000002', '8b000000-0000-4000-8000-000000000004', 'pgtap-ab-p1');

-- ---------------------------------------------------------------------------
-- E. Constraint proofs (privileged — direct at the index/CHECKs; no RPC
--    exists yet, 085 is L.C1.3's).
-- ---------------------------------------------------------------------------

-- C39 partial unique: replays collide; system rows (NULL) never do.
select throws_ok(
  $$ insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
     values ('e3000000-0000-4000-8000-000000000001',
             'a3000000-0000-4000-8000-00000000000a',
             1, 'pgtap-ab-p1', 'c3000000-0000-4000-8000-000000000002', 3,
             'f3000000-0000-4000-8000-0000000000a1') $$,
  '23505', null,
  'E2/C39: a replayed action_id in the same draft → 23505 (uniq_draft_bid_action)');
select lives_ok(
  $$ insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
     values ('e3000000-0000-4000-8000-000000000001',
             'a3000000-0000-4000-8000-00000000000a',
             2, 'pgtap-ab-p2', 'c3000000-0000-4000-8000-000000000001', 1, null) $$,
  'a SECOND NULL-action_id row inserts cleanly (system opening bids — the partial predicate excludes NULLs)');
select is(
  (select count(*) from draft_bids
   where draft_id = 'e3000000-0000-4000-8000-000000000001' and action_id is null),
  2::bigint,
  'TWO NULL-action_id bids coexist (C39 — the system-row property. NOT the WHERE-drop tripwire: a non-partial unique still admits both under NULLS DISTINCT, so this pin stays GREEN under that probe — the indexdef golden above is the tripwire. D144(2))');

-- R43 CHECK boundaries, both sides.
select throws_ok(
  $$ insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount)
     values ('e3000000-0000-4000-8000-000000000001',
             'a3000000-0000-4000-8000-00000000000a',
             3, 'pgtap-ab-p3', 'c3000000-0000-4000-8000-000000000001', -1) $$,
  '23514', null,
  'draft_bids.amount CHECK: −1 refused (bids are non-negative dollars)');
select lives_ok(
  $$ insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
     values ('e3000000-0000-4000-8000-000000000001',
             'a3000000-0000-4000-8000-00000000000a',
             3, 'pgtap-ab-p3', 'c3000000-0000-4000-8000-000000000001', 0,
             'f3000000-0000-4000-8000-0000000000a5') $$,
  'draft_bids.amount CHECK: 0 lives — the $0-opening boundary (legal with auction_zero_dollar_nominations ON; §7.3.8 v2.13)');
select throws_ok(
  $$ insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount)
     values ('e3000000-0000-4000-8000-000000000001',
             'a3000000-0000-4000-8000-00000000000a',
             0, 'pgtap-ab-p4', 'c3000000-0000-4000-8000-000000000001', 1) $$,
  '23514', null,
  'draft_bids.nomination_seq CHECK: 0 refused (the sequence is 1-based — D126)');
select lives_ok(
  $$ insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
     values ('e3000000-0000-4000-8000-000000000001',
             'a3000000-0000-4000-8000-00000000000a',
             1, 'pgtap-ab-p1', 'c3000000-0000-4000-8000-000000000001', 4,
             'f3000000-0000-4000-8000-0000000000a6') $$,
  'draft_bids.nomination_seq CHECK: 1 lives (the legal boundary side)');

-- budget_adjustments behavioral default on a fresh row (a COMPLETE draft —
-- outside the D95 one-active predicate, so L2''s scheduled d2 coexists).
insert into drafts (id, league_id, draft_type, status, is_mock)
values ('e3000000-0000-4000-8000-00000000000f',
        'a3000000-0000-4000-8000-00000000000b', 'auction', 'complete', false);
select is(
  (select budget_adjustments from drafts where id = 'e3000000-0000-4000-8000-00000000000f'),
  '{}'::jsonb,
  'budget_adjustments defaults to {} on a fresh row (behavioral — D127)');

-- ---------------------------------------------------------------------------
-- F. RLS per role — draft_bids (§4.2; JWT claims from here on).
--    d1 now carries 5 bid rows (2 fixture + 3 constraint-proof inserts).
-- ---------------------------------------------------------------------------

-- u2: member (manager, owns t2).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8b000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

select is(
  (select count(*) from draft_bids where draft_id = 'e3000000-0000-4000-8000-000000000001'),
  5::bigint,
  'member sees ALL 5 bid rows of the league draft (SELECT-sees-N pin — bids are public in an open auction, §12.5)');
select is(
  (select count(*) from draft_bids where draft_id = 'e3000000-0000-4000-8000-000000000002'),
  0::bigint,
  'member sees ZERO bids of a league they are not in');
select throws_ok(
  $$ insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
     values ('e3000000-0000-4000-8000-000000000001',
             'a3000000-0000-4000-8000-00000000000a',
             1, 'pgtap-ab-p1', 'c3000000-0000-4000-8000-000000000002', 9,
             'f3000000-0000-4000-8000-0000000000a7') $$,
  '42501', null,
  'member INSERT into draft_bids denied — bids land via draft_place_bid only (085; §8.1)');
select results_eq(
  $$ with w as (update draft_bids set amount = 99
                where draft_id = 'e3000000-0000-4000-8000-000000000001' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'member UPDATE on draft_bids affects 0 rows (RETURNING-count; sees 5, changes none — append-only history, D131(2))');
select results_eq(
  $$ with d as (delete from draft_bids
                where draft_id = 'e3000000-0000-4000-8000-000000000001' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'member DELETE on draft_bids affects 0 rows (RETURNING-count)');

-- draft_dnd_marks as u2: own rows both directions.
select is(
  (select count(*) from draft_dnd_marks
   where draft_id = 'e3000000-0000-4000-8000-000000000001'
     and user_id = '8b000000-0000-4000-8000-000000000002'),
  2::bigint,
  'author sees their own 2 DND marks (SELECT-sees-N pin)');
select is(
  (select count(*) from draft_dnd_marks
   where user_id != '8b000000-0000-4000-8000-000000000002'),
  0::bigint,
  'another member''s marks are INVISIBLE (blind prep data — §12.24 own-rows; the commish''s d1 mark exists and does not show)');
select lives_ok(
  $$ insert into draft_dnd_marks (draft_id, user_id, player_id)
     values ('e3000000-0000-4000-8000-000000000001',
             '8b000000-0000-4000-8000-000000000002', 'pgtap-ab-p4') $$,
  'author INSERTs their own mark — the §12.24-sanctioned client write (the draft_queues precedent)');
select throws_ok(
  $$ insert into draft_dnd_marks (draft_id, user_id, player_id)
     values ('e3000000-0000-4000-8000-000000000001',
             '8b000000-0000-4000-8000-000000000001', 'pgtap-ab-p4') $$,
  '42501', null,
  'a mark spoofing ANOTHER user_id is refused (WITH CHECK user_id = auth.uid())');
select results_eq(
  $$ with w as (update draft_dnd_marks set created_at = now()
                where user_id = '8b000000-0000-4000-8000-000000000002'
                  and player_id = 'pgtap-ab-p4' returning 1)
     select count(*) from w $$,
  $$ values (1::bigint) $$,
  'author UPDATEs their own mark (RETURNING-count 1)');
select results_eq(
  $$ with d as (delete from draft_dnd_marks
                where user_id = '8b000000-0000-4000-8000-000000000002'
                  and player_id = 'pgtap-ab-p4' returning 1)
     select count(*) from d $$,
  $$ values (1::bigint) $$,
  'author DELETEs their own mark (RETURNING-count 1 — the toggle-off path)');

-- Privileged row-exists pin for the cross-user write probes (mid-test
-- privileged per D49(7): reset role, then re-assume).
reset role;
select is(
  (select count(*) from draft_dnd_marks
   where draft_id = 'e3000000-0000-4000-8000-000000000001'
     and user_id = '8b000000-0000-4000-8000-000000000001'),
  1::bigint,
  'privileged: the commish''s d1 mark EXISTS (the row the next two zero-counts are probed against)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8b000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

select results_eq(
  $$ with w as (update draft_dnd_marks set created_at = now()
                where user_id = '8b000000-0000-4000-8000-000000000001' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'another member''s mark is UNWRITABLE: UPDATE affects 0 rows (RETURNING-count against the privileged row-exists pin)');
select results_eq(
  $$ with d as (delete from draft_dnd_marks
                where user_id = '8b000000-0000-4000-8000-000000000001' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'another member''s mark is UNDELETABLE: DELETE affects 0 rows (RETURNING-count)');

-- ---------------------------------------------------------------------------
-- G. u1: the COMMISSIONER is just a member here — client writes refused,
--    others' marks invisible (no commissioner carve-out exists on either
--    table; §12.24 prints none, and bids write via RPC only).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "8b000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select is(
  (select count(*) from draft_bids where draft_id = 'e3000000-0000-4000-8000-000000000001'),
  5::bigint,
  'commissioner sees the same 5 bid rows (member SELECT — no special write power rides it)');
select throws_ok(
  $$ insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
     values ('e3000000-0000-4000-8000-000000000001',
             'a3000000-0000-4000-8000-00000000000a',
             1, 'pgtap-ab-p1', 'c3000000-0000-4000-8000-000000000001', 9,
             'f3000000-0000-4000-8000-0000000000a8') $$,
  '42501', null,
  'commissioner INSERT into draft_bids denied — client writes are refused for EVERY role (append-only via RPC)');
select results_eq(
  $$ with w as (update draft_bids set amount = 99 returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'commissioner UPDATE on draft_bids affects 0 rows (RETURNING-count)');
select results_eq(
  $$ with d as (delete from draft_bids returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'commissioner DELETE on draft_bids affects 0 rows (RETURNING-count)');
select is(
  (select count(*) from draft_dnd_marks
   where draft_id = 'e3000000-0000-4000-8000-000000000001'),
  1::bigint,
  'commissioner sees ONLY their own d1 mark (1 row — u2''s 2 marks invisible even to the commish; no §12.6-style read-all comment exists on §12.24)');

-- The commissioner's DND writes against ANOTHER member's marks — the banner's
-- "even for the commissioner" claim made literal (R307; §4.2 full matrix).
-- Privileged baseline first: the rows the refusals are probed against.
-- F118 (2026-08-25, MP.11): every privileged baseline in this file is scoped
-- to the fixture's own two drafts. The whole-table form asserted a premise
-- about what the SHARED table does NOT contain (D235/F110's species) and
-- went RED at (11,2)-want-(6,2) against three live standalone mocks left by
-- a browser session — a green suite must not depend on an empty database.
reset role;
select results_eq(
  $$ select (select count(*) from draft_bids
            where draft_id in ('e3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002')),
            (select count(*) from draft_dnd_marks
             where user_id = '8b000000-0000-4000-8000-000000000002') $$,
  $$ values (6::bigint, 2::bigint) $$,
  'privileged baseline BEFORE the commissioner DND write sweep: 6 bid rows exist and u2 holds 2 marks (invisible to the commish — the rows the next three refusals are probed against)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8b000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select throws_ok(
  $$ insert into draft_dnd_marks (draft_id, user_id, player_id)
     values ('e3000000-0000-4000-8000-000000000001',
             '8b000000-0000-4000-8000-000000000002', 'pgtap-ab-p4') $$,
  '42501', null,
  'commissioner INSERT spoofing another user_id denied — no commissioner carve-out on §12.24''s WITH CHECK');
select results_eq(
  $$ with w as (update draft_dnd_marks set created_at = now()
                where user_id = '8b000000-0000-4000-8000-000000000002' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'commissioner UPDATE on another member''s marks affects 0 rows (RETURNING-count against the privileged baseline)');
select results_eq(
  $$ with d as (delete from draft_dnd_marks
                where user_id = '8b000000-0000-4000-8000-000000000002' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'commissioner DELETE on another member''s marks affects 0 rows (RETURNING-count)');

reset role;
select results_eq(
  $$ select (select count(*) from draft_bids
            where draft_id in ('e3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002')),
            (select count(*) from draft_dnd_marks
             where user_id = '8b000000-0000-4000-8000-000000000002') $$,
  $$ values (6::bigint, 2::bigint) $$,
  'privileged baseline AFTER the commissioner sweep: both counts unchanged — the writes were refused, not merely aimed at nothing');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- H. u3: OUTSIDER (authenticated, no membership anywhere).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "8b000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);

select is(
  (select count(*) from draft_bids),
  0::bigint,
  'outsider sees ZERO bid rows anywhere (deny-by-default)');
select throws_ok(
  $$ insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
     values ('e3000000-0000-4000-8000-000000000001',
             'a3000000-0000-4000-8000-00000000000a',
             1, 'pgtap-ab-p1', 'c3000000-0000-4000-8000-000000000002', 9,
             'f3000000-0000-4000-8000-0000000000a9') $$,
  '42501', null,
  'outsider INSERT into draft_bids denied');
select is(
  (select count(*) from draft_dnd_marks),
  0::bigint,
  'outsider sees ZERO DND marks (their own would show; they have none)');

-- Outsider client writes on BOTH tables — four of the seven cells the banner
-- claimed and the original sweep skipped (R307). Run BEFORE the residual
-- insert below, so the outsider owns no row of either table here.
reset role;
select results_eq(
  $$ select (select count(*) from draft_bids
            where draft_id in ('e3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002')),
            (select count(*) from draft_dnd_marks
             where draft_id in ('e3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002')) $$,
  $$ values (6::bigint, 4::bigint) $$,
  'privileged baseline BEFORE the outsider write sweep: 6 bid rows + 4 DND marks exist (all invisible to the outsider — the rows the next four zero-counts are probed against)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8b000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);

select results_eq(
  $$ with w as (update draft_bids set amount = 99 returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'outsider UPDATE on draft_bids affects 0 rows (RETURNING-count)');
select results_eq(
  $$ with d as (delete from draft_bids returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'outsider DELETE on draft_bids affects 0 rows (RETURNING-count)');
select results_eq(
  $$ with w as (update draft_dnd_marks set created_at = now() returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'outsider UPDATE on draft_dnd_marks affects 0 rows (RETURNING-count)');
select results_eq(
  $$ with d as (delete from draft_dnd_marks returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'outsider DELETE on draft_dnd_marks affects 0 rows (RETURNING-count)');

reset role;
select results_eq(
  $$ select (select count(*) from draft_bids
            where draft_id in ('e3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002')),
            (select count(*) from draft_dnd_marks
             where draft_id in ('e3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002')) $$,
  $$ values (6::bigint, 4::bigint) $$,
  'privileged baseline AFTER the outsider sweep: both counts unchanged — nothing was updated or deleted behind the zero-counts');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "8b000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);

select lives_ok(
  $$ insert into draft_dnd_marks (draft_id, user_id, player_id)
     values ('e3000000-0000-4000-8000-000000000001',
             '8b000000-0000-4000-8000-000000000003', 'pgtap-ab-p1') $$,
  'RECORDED RESIDUAL (R120 class — 083 banner): an outsider CAN insert their OWN mark against a foreign draft_id (§12.24 validates user ownership only). Pinned as residual: harmless by construction (own-rows visibility, never broadcast, engine never reads — C42); tightening it is a spec change that flips this pin deliberately');

-- ---------------------------------------------------------------------------
-- I. anon: nothing, both tables.
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select is((select count(*) from draft_bids), 0::bigint, 'anon sees zero bid rows');
select is((select count(*) from draft_dnd_marks), 0::bigint, 'anon sees zero DND marks');
select throws_ok(
  $$ insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount)
     values ('e3000000-0000-4000-8000-000000000001',
             'a3000000-0000-4000-8000-00000000000a',
             1, 'pgtap-ab-p1', 'c3000000-0000-4000-8000-000000000002', 9) $$,
  '42501', null, 'anon INSERT into draft_bids denied');
select throws_ok(
  $$ insert into draft_dnd_marks (draft_id, user_id, player_id)
     values ('e3000000-0000-4000-8000-000000000001',
             '8b000000-0000-4000-8000-000000000002', 'pgtap-ab-p1') $$,
  '42501', null, 'anon INSERT into draft_dnd_marks denied');

-- Privileged baseline for anon's write sweep (anon sees neither table, so the
-- zero-counts need a row-exists pin to discriminate — §4.2, R307).
reset role;
select results_eq(
  $$ select (select count(*) from draft_bids
            where draft_id in ('e3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002')),
            (select count(*) from draft_dnd_marks
             where draft_id in ('e3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002')) $$,
  $$ values (6::bigint, 5::bigint) $$,
  'privileged baseline BEFORE the anon write sweep: 6 bid rows + 5 DND marks exist (4 fixture + the outsider''s recorded residual) — the rows the next four zero-counts are probed against');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select results_eq(
  $$ with w as (update draft_bids set amount = 99 returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'anon UPDATE on draft_bids affects 0 rows');
select results_eq(
  $$ with d as (delete from draft_bids returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'anon DELETE on draft_bids affects 0 rows (RETURNING-count — the seventh skipped cell)');
select results_eq(
  $$ with w as (update draft_dnd_marks set created_at = now() returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'anon UPDATE on draft_dnd_marks affects 0 rows (RETURNING-count)');
select results_eq(
  $$ with d as (delete from draft_dnd_marks returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'anon DELETE on draft_dnd_marks affects 0 rows');

reset role;
select results_eq(
  $$ select (select count(*) from draft_bids
            where draft_id in ('e3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002')),
            (select count(*) from draft_dnd_marks
             where draft_id in ('e3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002')) $$,
  $$ values (6::bigint, 5::bigint) $$,
  'privileged baseline AFTER the anon sweep: both counts unchanged');

select * from finish();
rollback;
