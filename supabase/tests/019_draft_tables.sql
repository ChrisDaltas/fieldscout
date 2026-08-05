-- ============================================================================
-- Draft tables + league_chat draft extension — migration 065 (spec
-- §12.3/§12.4/§12.6/§12.13, §8.1, §9.2; tasks-M2 §4 standing rules,
-- D95/D99; task L.B1.1). pgTAP file is **019** (018 = league profile;
-- next free confirmed at task time).
--
-- Falsifiability notes (§4.3):
--   * The E1 index (uniq_draft_player_live) is proven DIRECTLY at the
--     index, not via an RPC (none exists yet): privileged double-insert of
--     the same live (draft_id, player_id) → 23505, while an UNDONE pick for
--     the same player COEXISTS in both directions (undone-then-live re-pick
--     AND live-then-undone) — dropping the WHERE is_undone = FALSE clause
--     fails the coexistence pins and the indexdef golden pin.
--   * uniq_draft_action: same action_id twice → 23505; TWO NULL-action_id
--     picks coexist (system/cron picks, §12.4) — a non-partial unique fails
--     the NULL-coexistence count.
--   * one_active_real_draft_per_league (D95): a second non-mock
--     scheduled/live/paused draft in the league → 23505; a mock AND a
--     complete draft coexist with the scheduled real one (E60) — indexdef
--     golden-pinned so predicate drift trips even without a probe.
--   * R43-lesson CHECKs proven behaviorally: status 'in_season' and
--     draft_type 'keeper' both → 23514 (the printed enum comments are
--     constraints, not documentation).
--   * league_chat policy swap pinned BOTH directions (the 052 pattern): a
--     member with NO teams row reads + posts (the old 001 teams-keyed
--     policy DENIED this), and a teams-row owner with NO membership — the
--     C11 ghost — reads NOTHING and posting raises 42501 (the old policy
--     GRANTED both). Re-pointing either policy at the old check breaks both
--     directions.
--   * Chat INSERT boundaries: empty message refused (R119) / 500-char
--     succeeds / 501 refused; is_system forge refused; user_id spoof
--     refused; draft-context validity refused for a cross-league draft, a
--     nonexistent draft, a garbage context ('lobby'), a TRAILING-JUNK
--     context ('draft:<valid-id>:junk' — R117: the policy exact-matches
--     the §12.13 grammar, not just segment 2), and NULL — and ACCEPTED for
--     a same-league real AND mock draft (D99: mock chat is member-visible).
--     Loosening the exact match back to split_part segment-2 validation
--     fails the trailing-junk pin.
--   * drafts.is_mock is NOT NULL (R118 — shape + behavioral 23502): a
--     NULL is_mock can no longer escape the D95 partial predicate.
--   * No UPDATE/DELETE for anyone on league_chat (append-only, D99) — the
--     policies_are pin (exactly 2 policies) plus RETURNING-count zeros.
--   * F48 counter-pin: the commissioner reads NOTHING of another team's
--     queue — §12.6's read-all comment is deliberately NOT shipped until
--     M6's console consumes it (policies_are pins exactly 2 policies).
--   * Writes RLS silently filters (UPDATE/DELETE) use the RETURNING-count
--     pattern preceded by a same-role SELECT-sees-N pin (or a privileged
--     row-exists pin for cross-team rows the role cannot see); INSERT
--     expects 42501 (standing rule §4.2).
--   * All privileged fixture work runs BEFORE any JWT claims are set
--     (set_config persists to txn end — D49(7)); mid-test privileged pins
--     use `reset role` (013/014/018 pattern).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(144);

-- ---------------------------------------------------------------------------
-- A. drafts shape (§12.3 + the R43 CHECKs + D95/§22.3 indexes)
-- ---------------------------------------------------------------------------
select has_table('public', 'drafts', 'drafts exists');
select columns_are('public', 'drafts',
  array['id', 'league_id', 'draft_type', 'status', 'is_mock', 'config',
        'draft_order', 'nomination_order', 'total_rounds', 'current_round',
        'current_pick_number', 'on_clock_team_id', 'current_nomination',
        'current_deadline', 'paused_at', 'deadline_remaining_ms',
        'started_at', 'completed_at', 'created_at', 'updated_at'],
  'exact §12.3 column set');
select col_is_pk('public', 'drafts', 'id', 'PK id');
select col_type_is('public', 'drafts', 'league_id', 'uuid', 'league_id is UUID');
select col_not_null('public', 'drafts', 'league_id', 'league_id NOT NULL');
select fk_ok('public', 'drafts', 'league_id', 'public', 'leagues', 'id', 'league_id → leagues');
select fk_ok('public', 'drafts', 'on_clock_team_id', 'public', 'teams', 'id', 'on_clock_team_id → teams');
select col_type_is('public', 'drafts', 'config', 'jsonb', 'config is JSONB');
select col_type_is('public', 'drafts', 'current_deadline', 'timestamp with time zone',
  'current_deadline is TIMESTAMPTZ (the server-authoritative clock end, §8.1)');
select col_type_is('public', 'drafts', 'deadline_remaining_ms', 'integer',
  'deadline_remaining_ms is INTEGER (v2.0 pause bookkeeping, §8.7)');
select col_default_is('public', 'drafts', 'draft_type', 'snake', $$draft_type defaults 'snake'$$);
select col_default_is('public', 'drafts', 'status', 'scheduled', $$status defaults 'scheduled'$$);
select col_default_is('public', 'drafts', 'is_mock', 'false', 'is_mock defaults FALSE');
select col_not_null('public', 'drafts', 'is_mock',
  'is_mock NOT NULL (R118 — a NULL is_mock would escape the D95 partial predicate)');
select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'drafts' and column_name = 'config'),
  $$'{}'::jsonb$$,
  $$config defaults '{}' (information_schema pin — col_default_is would cast the expectation to jsonb)$$);
select col_default_is('public', 'drafts', 'current_round', '1', 'current_round defaults 1');
select col_default_is('public', 'drafts', 'current_pick_number', '1', 'current_pick_number defaults 1');
select ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'drafts'),
  'RLS enabled on drafts');
select policies_are('public', 'drafts',
  array['Drafts viewable by league members'],
  'exactly ONE policy: the member SELECT — no client writes (§8.1/§12.3)');
select policy_cmd_is('public', 'drafts', 'Drafts viewable by league members', 'SELECT',
  'the drafts policy is SELECT-only');
select has_index('public', 'drafts', 'idx_drafts_league', 'idx_drafts_league exists');
select is(
  (select indexdef from pg_indexes
   where schemaname = 'public' and indexname = 'idx_drafts_active'),
  'CREATE INDEX idx_drafts_active ON public.drafts USING btree (status) WHERE (status = ANY (ARRAY[''live''::text, ''paused''::text]))',
  'idx_drafts_active partial predicate golden-pinned (§12.3)');
select is(
  (select indexdef from pg_indexes
   where schemaname = 'public' and indexname = 'idx_drafts_due'),
  'CREATE INDEX idx_drafts_due ON public.drafts USING btree (current_deadline) WHERE (status = ''live''::text)',
  'idx_drafts_due golden-pinned — the §22.3 draft-tick scan target (live-only)');
select is(
  (select indexdef from pg_indexes
   where schemaname = 'public' and indexname = 'one_active_real_draft_per_league'),
  'CREATE UNIQUE INDEX one_active_real_draft_per_league ON public.drafts USING btree (league_id) WHERE ((is_mock = false) AND (status = ANY (ARRAY[''scheduled''::text, ''live''::text, ''paused''::text])))',
  'one_active_real_draft_per_league golden-pinned — D95 predicate exact (mock-exempt, complete-exempt)');

-- ---------------------------------------------------------------------------
-- B. draft_picks shape (§12.4)
-- ---------------------------------------------------------------------------
select has_table('public', 'draft_picks', 'draft_picks exists');
select columns_are('public', 'draft_picks',
  array['id', 'draft_id', 'league_id', 'pick_number', 'round', 'team_id',
        'player_id', 'price', 'is_auto', 'is_undone', 'picked_by',
        'made_via', 'action_id', 'created_at'],
  'exact §12.4 column set');
select col_is_pk('public', 'draft_picks', 'id', 'PK id');
select fk_ok('public', 'draft_picks', 'draft_id', 'public', 'drafts', 'id', 'draft_id → drafts');
select fk_ok('public', 'draft_picks', 'league_id', 'public', 'leagues', 'id', 'league_id → leagues');
select fk_ok('public', 'draft_picks', 'team_id', 'public', 'teams', 'id', 'team_id → teams');
select fk_ok('public', 'draft_picks', 'player_id', 'public', 'players', 'id', 'player_id → players (TEXT id)');
select fk_ok('public', 'draft_picks', 'picked_by', 'public', 'profiles', 'id', 'picked_by → profiles');
select col_not_null('public', 'draft_picks', 'pick_number', 'pick_number NOT NULL');
select col_is_null('public', 'draft_picks', 'action_id',
  'action_id nullable (system/cron picks carry NULL — §12.4)');
select col_default_is('public', 'draft_picks', 'is_auto', 'false', 'is_auto defaults FALSE');
select col_default_is('public', 'draft_picks', 'is_undone', 'false', 'is_undone defaults FALSE');
select col_default_is('public', 'draft_picks', 'made_via', 'manager', $$made_via defaults 'manager'$$);
select ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'draft_picks'),
  'RLS enabled on draft_picks');
select policies_are('public', 'draft_picks',
  array['Picks viewable by league members'],
  'exactly ONE policy: the member SELECT — picks are written only by the draft RPCs');
select policy_cmd_is('public', 'draft_picks', 'Picks viewable by league members', 'SELECT',
  'the draft_picks policy is SELECT-only');
select is(
  (select indexdef from pg_indexes
   where schemaname = 'public' and indexname = 'uniq_draft_player_live'),
  'CREATE UNIQUE INDEX uniq_draft_player_live ON public.draft_picks USING btree (draft_id, player_id) WHERE (is_undone = false)',
  'uniq_draft_player_live golden-pinned — the E1 partial predicate exact (§8.1/§12.4)');
select is(
  (select indexdef from pg_indexes
   where schemaname = 'public' and indexname = 'uniq_draft_action'),
  'CREATE UNIQUE INDEX uniq_draft_action ON public.draft_picks USING btree (draft_id, action_id) WHERE (action_id IS NOT NULL)',
  'uniq_draft_action golden-pinned — the E2 idempotency predicate exact');
select has_index('public', 'draft_picks', 'idx_draft_picks_draft', 'idx_draft_picks_draft exists');

-- ---------------------------------------------------------------------------
-- C. draft_queues shape (§12.6; F48 — no commissioner policy)
-- ---------------------------------------------------------------------------
select has_table('public', 'draft_queues', 'draft_queues exists');
select columns_are('public', 'draft_queues',
  array['id', 'draft_id', 'team_id', 'player_id', 'rank', 'created_at'],
  'exact §12.6 column set');
select col_is_pk('public', 'draft_queues', 'id', 'PK id');
select fk_ok('public', 'draft_queues', 'draft_id', 'public', 'drafts', 'id', 'draft_id → drafts');
select fk_ok('public', 'draft_queues', 'team_id', 'public', 'teams', 'id', 'team_id → teams');
select fk_ok('public', 'draft_queues', 'player_id', 'public', 'players', 'id', 'player_id → players');
select col_not_null('public', 'draft_queues', 'rank', 'rank NOT NULL');
select col_is_unique('public', 'draft_queues', array['draft_id', 'team_id', 'player_id'],
  'UNIQUE(draft_id, team_id, player_id) — one queue row per player per team per draft');
select ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'draft_queues'),
  'RLS enabled on draft_queues');
select policies_are('public', 'draft_queues',
  array['Own queue read', 'Own queue write'],
  'exactly TWO policies: own-team SELECT + own-team FOR ALL (§12.6 printed set; the commissioner read-all comment is deliberately NOT a policy — F48 → M6 console)');
select policy_cmd_is('public', 'draft_queues', 'Own queue read', 'SELECT', 'Own queue read is SELECT');
select policy_cmd_is('public', 'draft_queues', 'Own queue write', 'ALL',
  'Own queue write is FOR ALL — the one spec-sanctioned client-writable draft table (plan §8.2)');
select has_index('public', 'draft_queues', 'idx_draft_queues_team', 'idx_draft_queues_team exists');

-- ---------------------------------------------------------------------------
-- D. league_chat extension (§12.13) + the D99 policy surface
-- ---------------------------------------------------------------------------
select has_column('public', 'league_chat', 'context', 'league_chat.context added (§12.13)');
select has_column('public', 'league_chat', 'is_system', 'league_chat.is_system added (§12.13)');
select col_default_is('public', 'league_chat', 'context', 'league', $$context defaults 'league'$$);
select col_default_is('public', 'league_chat', 'is_system', 'false', 'is_system defaults FALSE');
select policies_are('public', 'league_chat',
  array['Chat viewable by league members', 'Members post their own chat'],
  'exactly TWO policies: membership SELECT + guarded INSERT — the 001 teams-keyed pair is GONE (C11/F18 chat half) and there is NO UPDATE/DELETE for anyone (append-only, D99)');
select policy_cmd_is('public', 'league_chat', 'Chat viewable by league members', 'SELECT',
  'chat SELECT policy is SELECT');
select policy_cmd_is('public', 'league_chat', 'Members post their own chat', 'INSERT',
  'chat INSERT policy is INSERT');

-- ---------------------------------------------------------------------------
-- E. Fixtures (postgres context — before any JWT claims; D49(7)).
--    u1 commish L1 (team t1) · u2 manager L1 (team t2) · u3 GHOST: owns
--    teams row t3 in L1, NOT a member (the C11 fixture) · u4 outsider ·
--    u5 commish L2 (team t4) · u6 manager L1 with NO teams row.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-dr1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "dr_commish"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-dr2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "dr_member"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'pgtap-dr3@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "dr_ghostown"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'pgtap-dr4@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "dr_outsider"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000005',
   'authenticated', 'authenticated', 'pgtap-dr5@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "dr_l2commish"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000006',
   'authenticated', 'authenticated', 'pgtap-dr6@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "dr_teamless"}', now(), now());

insert into leagues (id, owner_id, name, season) values
  ('a1000000-0000-4000-8000-00000000000a', '80000000-0000-4000-8000-000000000001', 'pgtap-dr-1', 2026),
  ('a1000000-0000-4000-8000-00000000000b', '80000000-0000-4000-8000-000000000005', 'pgtap-dr-2', 2026);

insert into teams (id, owner_id, name, league_id) values
  ('c1000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001',
   'pgtap-dr-t1', 'a1000000-0000-4000-8000-00000000000a'),
  ('c1000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000002',
   'pgtap-dr-t2', 'a1000000-0000-4000-8000-00000000000a'),
  ('c1000000-0000-4000-8000-000000000003', '80000000-0000-4000-8000-000000000003',
   'pgtap-dr-t3', 'a1000000-0000-4000-8000-00000000000a'),
  ('c1000000-0000-4000-8000-000000000004', '80000000-0000-4000-8000-000000000005',
   'pgtap-dr-t4', 'a1000000-0000-4000-8000-00000000000b');

-- u3 (t3's owner) is deliberately NOT here — the C11 ghost.
insert into league_members (league_id, user_id, team_id, role) values
  ('a1000000-0000-4000-8000-00000000000a', '80000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000001', 'commissioner'),
  ('a1000000-0000-4000-8000-00000000000a', '80000000-0000-4000-8000-000000000002',
   'c1000000-0000-4000-8000-000000000002', 'manager'),
  ('a1000000-0000-4000-8000-00000000000a', '80000000-0000-4000-8000-000000000006',
   null, 'manager'),
  ('a1000000-0000-4000-8000-00000000000b', '80000000-0000-4000-8000-000000000005',
   'c1000000-0000-4000-8000-000000000004', 'commissioner');

insert into players (id, full_name, position) values
  ('pgtap-dr-p1', 'PgTap Draft QB', 'QB'),
  ('pgtap-dr-p2', 'PgTap Draft RB', 'RB'),
  ('pgtap-dr-p3', 'PgTap Draft WR', 'WR'),
  ('pgtap-dr-p4', 'PgTap Draft TE', 'TE');

-- d1: L1's real scheduled draft · dm: a live MOCK in L1 (coexists — E60;
-- launched by u1 the commissioner, practicing from t2 — U2'S franchise —
-- the D103 "any seat selectable" shape that makes the F51 owner-arm
-- exclusion pins discriminating: launcher ≠ owner on the human seat) ·
-- d2: L2's real draft (cross-league chat probe target).
insert into drafts (id, league_id, draft_type, status, is_mock, config) values
  ('e0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000000a',
   'snake', 'scheduled', false, '{}'),
  ('e0000000-0000-4000-8000-00000000000e', 'a1000000-0000-4000-8000-00000000000a',
   'snake', 'live', true,
   '{"mock": {"launched_by": "80000000-0000-4000-8000-000000000001",
              "human_team_id": "c1000000-0000-4000-8000-000000000002",
              "cpu_speed": "realistic"}}'),
  ('e0000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-00000000000b',
   'snake', 'scheduled', false, '{}');

-- Picks in d1: p1 live (action A1) · p2 undone THEN p2 live (the re-pick
-- after an undo — §8.7) · p3/p4 live with NULL action_id (system picks).
insert into draft_picks (draft_id, league_id, pick_number, round, team_id, player_id,
                         is_undone, picked_by, made_via, action_id) values
  ('e0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000000a',
   1, 1, 'c1000000-0000-4000-8000-000000000001', 'pgtap-dr-p1',
   false, '80000000-0000-4000-8000-000000000001', 'manager',
   'f0000000-0000-4000-8000-0000000000a1'),
  ('e0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000000a',
   2, 1, 'c1000000-0000-4000-8000-000000000002', 'pgtap-dr-p2',
   true, '80000000-0000-4000-8000-000000000002', 'manager',
   'f0000000-0000-4000-8000-0000000000a2'),
  ('e0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000000a',
   2, 1, 'c1000000-0000-4000-8000-000000000002', 'pgtap-dr-p2',
   false, '80000000-0000-4000-8000-000000000002', 'manager',
   'f0000000-0000-4000-8000-0000000000a3'),
  ('e0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000000a',
   3, 2, 'c1000000-0000-4000-8000-000000000001', 'pgtap-dr-p3',
   false, null, 'autopick', null),
  ('e0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000000a',
   4, 2, 'c1000000-0000-4000-8000-000000000002', 'pgtap-dr-p4',
   false, null, 'autopick', null);

-- Queues: t2 (u2) has 2 rows; t1 (u1) has 1.
insert into draft_queues (draft_id, team_id, player_id, rank) values
  ('e0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002',
   'pgtap-dr-p3', 1),
  ('e0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002',
   'pgtap-dr-p4', 2),
  ('e0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
   'pgtap-dr-p2', 1);

-- Chat: a normal member post + a SYSTEM post in the draft context (seeded
-- privileged — the only legal writer of is_system rows is a §8.7 RPC, D97),
-- plus an L2 post the L1 roles must never see.
insert into league_chat (league_id, user_id, message, context, is_system) values
  ('a1000000-0000-4000-8000-00000000000a', '80000000-0000-4000-8000-000000000001',
   'hello league', 'league', false),
  ('a1000000-0000-4000-8000-00000000000a', '80000000-0000-4000-8000-000000000001',
   'Draft paused by the commissioner', 'draft:e0000000-0000-4000-8000-000000000001', true),
  ('a1000000-0000-4000-8000-00000000000b', '80000000-0000-4000-8000-000000000005',
   'hello league two', 'league', false);

-- ---------------------------------------------------------------------------
-- F. Constraint proofs (privileged — direct at the indexes/CHECKs; no RPC
--    exists yet, 066 is L.B1.2's).
-- ---------------------------------------------------------------------------

-- D95: one active real draft per league.
select throws_ok(
  $$ insert into drafts (league_id, status, is_mock)
     values ('a1000000-0000-4000-8000-00000000000a', 'live', false) $$,
  '23505', null,
  'D95: a second non-mock active draft in the league is impossible (scheduled + live both inside the partial predicate)');
select lives_ok(
  $$ insert into drafts (id, league_id, status, is_mock)
     values ('e0000000-0000-4000-8000-00000000000f',
             'a1000000-0000-4000-8000-00000000000a', 'live', true) $$,
  'a SECOND live mock coexists with the scheduled real draft (E60 — mocks are exempt from the D95 index)');
select lives_ok(
  $$ insert into drafts (id, league_id, status, is_mock)
     values ('e0000000-0000-4000-8000-00000000000c',
             'a1000000-0000-4000-8000-00000000000a', 'complete', false) $$,
  'a COMPLETE non-mock draft coexists with the scheduled real draft (complete is outside the D95 predicate — a draft history accumulates)');
select throws_ok(
  $$ insert into drafts (league_id, status, is_mock)
     values ('a1000000-0000-4000-8000-00000000000a', 'live', null) $$,
  '23502', null,
  'R118: an explicit NULL is_mock is refused (23502) — the review-probed D95 predicate escape (a NULL-is_mock live draft beside the real scheduled one) is closed');

-- R43-lesson CHECKs, behaviorally.
select throws_ok(
  $$ insert into drafts (league_id, status)
     values ('a1000000-0000-4000-8000-00000000000b', 'in_season') $$,
  '23514', null,
  $$drafts.status CHECK: 'in_season' (a leagues status, not a drafts one) refused$$);
select throws_ok(
  $$ insert into drafts (league_id, draft_type)
     values ('a1000000-0000-4000-8000-00000000000b', 'keeper') $$,
  '23514', null,
  $$drafts.draft_type CHECK: 'keeper' refused (snake | auction | linear only)$$);

-- E1 at the index: double-pick impossible; undone picks coexist BOTH ways.
select throws_ok(
  $$ insert into draft_picks (draft_id, league_id, pick_number, team_id, player_id)
     values ('e0000000-0000-4000-8000-000000000001',
             'a1000000-0000-4000-8000-00000000000a',
             9, 'c1000000-0000-4000-8000-000000000002', 'pgtap-dr-p1') $$,
  '23505', null,
  'E1: a second LIVE pick of the same player in the same draft → 23505 (uniq_draft_player_live)');
select lives_ok(
  $$ insert into draft_picks (draft_id, league_id, pick_number, team_id, player_id, is_undone, action_id)
     values ('e0000000-0000-4000-8000-000000000001',
             'a1000000-0000-4000-8000-00000000000a',
             9, 'c1000000-0000-4000-8000-000000000002', 'pgtap-dr-p1', true,
             'f0000000-0000-4000-8000-0000000000a4') $$,
  'an UNDONE pick of an already-live-picked player coexists (live-then-undone direction; carries its own action_id so the NULL-coexistence count below stays the two seeded system picks)');
select is(
  (select count(*) from draft_picks
   where draft_id = 'e0000000-0000-4000-8000-000000000001'
     and player_id = 'pgtap-dr-p2'),
  2::bigint,
  'undone-then-live: the fixture re-pick of p2 after its undo coexists — dropping WHERE is_undone = FALSE makes this fixture unseedable');

-- E2 idempotency index: replays collide; system picks (NULL) never do.
select throws_ok(
  $$ insert into draft_picks (draft_id, league_id, pick_number, team_id, player_id, action_id)
     values ('e0000000-0000-4000-8000-000000000001',
             'a1000000-0000-4000-8000-00000000000a',
             9, 'c1000000-0000-4000-8000-000000000001', 'pgtap-dr-p2',
             'f0000000-0000-4000-8000-0000000000a1') $$,
  '23505', null,
  'E2: a replayed action_id in the same draft → 23505 (uniq_draft_action)');
select is(
  (select count(*) from draft_picks
   where draft_id = 'e0000000-0000-4000-8000-000000000001' and action_id is null),
  2::bigint,
  'TWO NULL-action_id picks coexist (system/cron picks — the partial predicate excludes NULLs; a non-partial unique fails here)');

-- ---------------------------------------------------------------------------
-- G. RLS per role (§4.2 pattern; JWT claims from here on).
-- ---------------------------------------------------------------------------

-- u2: member (manager, owns t2).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "80000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

-- drafts
select is(
  (select count(*) from drafts where league_id = 'a1000000-0000-4000-8000-00000000000a'),
  4::bigint,
  'member sees all 4 L1 drafts (scheduled real + 2 mocks + complete — SELECT-sees-N pin)');
select is(
  (select count(*) from drafts where league_id = 'a1000000-0000-4000-8000-00000000000b'),
  0::bigint,
  'member sees zero drafts of a league they are not in');
select throws_ok(
  $$ insert into drafts (league_id) values ('a1000000-0000-4000-8000-00000000000a') $$,
  '42501', null, 'member INSERT into drafts denied — no client write policy (§8.1)');
select results_eq(
  $$ with w as (update drafts set status = 'paused'
                where league_id = 'a1000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'member UPDATE on drafts affects 0 rows (RETURNING-count; sees 4, changes none)');
select results_eq(
  $$ with d as (delete from drafts
                where league_id = 'a1000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'member DELETE on drafts affects 0 rows (RETURNING-count)');

-- draft_picks
select is(
  (select count(*) from draft_picks where draft_id = 'e0000000-0000-4000-8000-000000000001'),
  6::bigint,
  'member sees all 6 pick rows of the league draft incl. undone ones (SELECT-sees-N pin; the board renders undo history, §12.4)');
select throws_ok(
  $$ insert into draft_picks (draft_id, league_id, pick_number, team_id, player_id)
     values ('e0000000-0000-4000-8000-000000000001',
             'a1000000-0000-4000-8000-00000000000a',
             10, 'c1000000-0000-4000-8000-000000000002', 'pgtap-dr-p4') $$,
  '42501', null,
  'member INSERT into draft_picks denied — clients never write picks directly (CLAUDE.md/§8.1)');
select results_eq(
  $$ with w as (update draft_picks set is_undone = true
                where draft_id = 'e0000000-0000-4000-8000-000000000001' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'member UPDATE on draft_picks affects 0 rows (RETURNING-count; sees 6, changes none)');
select results_eq(
  $$ with d as (delete from draft_picks
                where draft_id = 'e0000000-0000-4000-8000-000000000001' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'member DELETE on draft_picks affects 0 rows (RETURNING-count)');

-- draft_queues: own-team read/write; other teams invisible + unwritable.
select is(
  (select count(*) from draft_queues where team_id = 'c1000000-0000-4000-8000-000000000002'),
  2::bigint,
  'manager sees own queue (2 rows — SELECT-sees-N pin)');
select is(
  (select count(*) from draft_queues where team_id != 'c1000000-0000-4000-8000-000000000002'),
  0::bigint,
  'manager sees NOTHING of any other team''s queue (§12.6 own-team scope; queues are blind data, §9.2)');
select lives_ok(
  $$ insert into draft_queues (draft_id, team_id, player_id, rank)
     values ('e0000000-0000-4000-8000-000000000001',
             'c1000000-0000-4000-8000-000000000002', 'pgtap-dr-p1', 3) $$,
  'manager INSERTs into own queue — the one spec-sanctioned client-writable draft table');
select results_eq(
  $$ with w as (update draft_queues set rank = 4
                where team_id = 'c1000000-0000-4000-8000-000000000002'
                  and player_id = 'pgtap-dr-p1' returning 1)
     select count(*) from w $$,
  $$ values (1::bigint) $$,
  'manager UPDATEs own queue row (reorder — RETURNING-count 1)');
select results_eq(
  $$ with d as (delete from draft_queues
                where team_id = 'c1000000-0000-4000-8000-000000000002'
                  and player_id = 'pgtap-dr-p1' returning 1)
     select count(*) from d $$,
  $$ values (1::bigint) $$,
  'manager DELETEs own queue row (RETURNING-count 1; queue back to 2)');
select throws_ok(
  $$ insert into draft_queues (draft_id, team_id, player_id, rank)
     values ('e0000000-0000-4000-8000-000000000001',
             'c1000000-0000-4000-8000-000000000001', 'pgtap-dr-p4', 9) $$,
  '42501', null,
  'manager INSERT into ANOTHER team''s queue denied (WITH CHECK inherits the own-team USING)');

-- Cross-team UPDATE is silently filtered: privileged row-exists pin first.
reset role;
select is(
  (select count(*) from draft_queues where team_id = 'c1000000-0000-4000-8000-000000000001'),
  1::bigint,
  't1''s queue row EXISTS (privileged pin — the 0-affected below is RLS filtering, not an empty table)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "80000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select results_eq(
  $$ with w as (update draft_queues set rank = 99
                where team_id = 'c1000000-0000-4000-8000-000000000001' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'manager UPDATE on another team''s queue affects 0 rows (RETURNING-count against the pinned existing row)');

-- ---------------------------------------------------------------------------
-- H. Chat behavior (still u2 — the member surface).
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from league_chat where league_id = 'a1000000-0000-4000-8000-00000000000a'),
  2::bigint,
  'member sees both L1 chat rows incl. the SYSTEM post (SELECT-sees-N pin; §16.3 — the room sees every override)');
select is(
  (select count(*) from league_chat
   where league_id = 'a1000000-0000-4000-8000-00000000000a' and is_system = true),
  1::bigint,
  'member READS system posts (write-forge is what is forbidden, not visibility)');
select lives_ok(
  $$ insert into league_chat (league_id, user_id, message)
     values ('a1000000-0000-4000-8000-00000000000a',
             '80000000-0000-4000-8000-000000000002', 'league context post') $$,
  'member posts in the league context (the §9.3 sanctioned direct client INSERT; context defaults ''league'')');
select lives_ok(
  $$ insert into league_chat (league_id, user_id, message, context)
     values ('a1000000-0000-4000-8000-00000000000a',
             '80000000-0000-4000-8000-000000000002', 'draft room post',
             'draft:e0000000-0000-4000-8000-000000000001') $$,
  'member posts into a REAL draft context of their own league (D99 validity)');
select lives_ok(
  $$ insert into league_chat (league_id, user_id, message, context)
     values ('a1000000-0000-4000-8000-00000000000a',
             '80000000-0000-4000-8000-000000000002', 'mock room post',
             'draft:e0000000-0000-4000-8000-00000000000e') $$,
  'member posts into a MOCK draft context (D99: mock chat scopes by context and is member-visible)');
select throws_ok(
  $$ insert into league_chat (league_id, user_id, message, context)
     values ('a1000000-0000-4000-8000-00000000000a',
             '80000000-0000-4000-8000-000000000002', 'cross-league smuggle',
             'draft:e0000000-0000-4000-8000-000000000002') $$,
  '42501', null,
  'a draft context naming ANOTHER league''s draft is refused (D99 draft-context validity)');
select throws_ok(
  $$ insert into league_chat (league_id, user_id, message, context)
     values ('a1000000-0000-4000-8000-00000000000a',
             '80000000-0000-4000-8000-000000000002', 'ghost draft',
             'draft:e0000000-0000-4000-8000-0000000000dd') $$,
  '42501', null,
  'a draft context naming a NONEXISTENT draft is refused');
select throws_ok(
  $$ insert into league_chat (league_id, user_id, message, context)
     values ('a1000000-0000-4000-8000-00000000000a',
             '80000000-0000-4000-8000-000000000002', 'garbage context', 'lobby') $$,
  '42501', null,
  $$a context outside 'league' | 'draft:<id>' is refused$$);
select throws_ok(
  $$ insert into league_chat (league_id, user_id, message, context)
     values ('a1000000-0000-4000-8000-00000000000a',
             '80000000-0000-4000-8000-000000000002', 'trailing junk smuggle',
             'draft:e0000000-0000-4000-8000-000000000001:junk') $$,
  '42501', null,
  $$R117: a TRAILING-JUNK context ('draft:<valid-id>:junk') is refused — the policy exact-matches the full §12.13 grammar; segment-2-only validation (split_part) passes this$$);
select throws_ok(
  $$ insert into league_chat (league_id, user_id, message, context)
     values ('a1000000-0000-4000-8000-00000000000a',
             '80000000-0000-4000-8000-000000000002', 'null context', null) $$,
  '42501', null,
  'an explicit NULL context is refused (WITH CHECK treats NULL as failure)');
select throws_ok(
  $$ insert into league_chat (league_id, user_id, message, is_system)
     values ('a1000000-0000-4000-8000-00000000000a',
             '80000000-0000-4000-8000-000000000002', 'forged system post', true) $$,
  '42501', null,
  'is_system forge refused — system posts are written only by the §8.7 RPCs (D97/D99)');
select throws_ok(
  $$ insert into league_chat (league_id, user_id, message)
     values ('a1000000-0000-4000-8000-00000000000a',
             '80000000-0000-4000-8000-000000000001', 'spoofed author') $$,
  '42501', null,
  'posting under ANOTHER user_id refused (own user_id only)');
select throws_ok(
  $$ insert into league_chat (league_id, user_id, message)
     values ('a1000000-0000-4000-8000-00000000000a',
             '80000000-0000-4000-8000-000000000002', '') $$,
  '42501', null,
  'R119: an empty-string message is refused (char_length >= 1 — the lower boundary edge)');
select lives_ok(
  $$ insert into league_chat (league_id, user_id, message)
     values ('a1000000-0000-4000-8000-00000000000a',
             '80000000-0000-4000-8000-000000000002', repeat('x', 500)) $$,
  'a 500-char message succeeds (the boundary edge)');
select throws_ok(
  $$ insert into league_chat (league_id, user_id, message)
     values ('a1000000-0000-4000-8000-00000000000a',
             '80000000-0000-4000-8000-000000000002', repeat('x', 501)) $$,
  '42501', null,
  'a 501-char message is refused (char_length ≤ 500, one past the edge)');
-- Append-only: u2 sees 6 L1 rows now (2 seeded + 4 posted) — then 0 writable.
select is(
  (select count(*) from league_chat where league_id = 'a1000000-0000-4000-8000-00000000000a'),
  6::bigint,
  'member sees 6 L1 chat rows after posting (SELECT-sees-N pin for the zeros below)');
select results_eq(
  $$ with w as (update league_chat set message = 'edited'
                where league_id = 'a1000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'member UPDATE on chat affects 0 rows — append-only, even on own messages (D99)');
select results_eq(
  $$ with d as (delete from league_chat
                where league_id = 'a1000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'member DELETE on chat affects 0 rows — append-only (D99)');

-- ---------------------------------------------------------------------------
-- I. Commissioner (u1): no special draft/chat writes; F48 counter-pin.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "80000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select count(*) from draft_queues where team_id = 'c1000000-0000-4000-8000-000000000001'),
  1::bigint,
  'commissioner sees OWN queue (1 row)');
select is(
  (select count(*) from draft_queues where team_id = 'c1000000-0000-4000-8000-000000000002'),
  0::bigint,
  'F48 counter-pin: the commissioner reads NOTHING of another team''s queue — §12.6''s read-all comment is deliberately NOT shipped until M6''s console consumes it');
select throws_ok(
  $$ insert into drafts (league_id) values ('a1000000-0000-4000-8000-00000000000a') $$,
  '42501', null,
  'commissioner INSERT into drafts denied too — draft creation is RPC-only (066/L.B1.2)');
select results_eq(
  $$ with w as (update drafts set status = 'live'
                where league_id = 'a1000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'commissioner UPDATE on drafts affects 0 rows — start/pause go through RPCs (sees 4, changes none)');
select results_eq(
  $$ with w as (update league_chat set is_system = false
                where league_id = 'a1000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'commissioner UPDATE on chat affects 0 rows (append-only binds the commissioner too)');
select results_eq(
  $$ with d as (delete from league_chat
                where league_id = 'a1000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'commissioner DELETE on chat affects 0 rows (system posts are non-deletable, §12.13)');

-- ---------------------------------------------------------------------------
-- I2. F51 (R157, M2 batch 10; 065 amended in place by L.B2.3): the owner
--     arm is EXCLUDED on mocks — the D103(3) launcher arm is the ONLY mock
--     admit. Fixture: dm is launched by u1 (still the active JWT) with
--     human seat t2 — U2'S franchise — so launcher ≠ owner and each arm is
--     pinned alone. Both sides per the F51 row: launcher path intact;
--     seat-owner INSERT/SELECT refused on the mock (RETURNING-counts per
--     §4.2); the real-draft own-queue arm untouched.
-- ---------------------------------------------------------------------------
select results_eq(
  $$ with w as (
       insert into draft_queues (draft_id, team_id, player_id, rank)
       values ('e0000000-0000-4000-8000-00000000000e',
               'c1000000-0000-4000-8000-000000000002', 'pgtap-dr-p1', 1)
       returning 1)
     select count(*)::bigint from w $$,
  $$ values (1::bigint) $$,
  'F51 launcher path intact: u1 (launcher, NOT t2''s owner) INSERTs the mock human seat''s queue — the carve-out is the only arm that can admit this');
select is(
  (select count(*) from draft_queues
   where draft_id = 'e0000000-0000-4000-8000-00000000000e'),
  1::bigint,
  'F51 launcher path intact: the launcher READS the mock queue row back');
select set_config('request.jwt.claims',
  '{"sub": "80000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  (select count(*) from draft_queues
   where draft_id = 'e0000000-0000-4000-8000-00000000000e'),
  0::bigint,
  'F51: the human seat''s REAL owner (u2) sees ZERO mock queue rows — the owner arm no longer reads the launcher''s practice prep (D103(2))');
select throws_ok(
  $$ insert into draft_queues (draft_id, team_id, player_id, rank)
     values ('e0000000-0000-4000-8000-00000000000e',
             'c1000000-0000-4000-8000-000000000002', 'pgtap-dr-p4', 1) $$,
  '42501', null,
  'F51: the seat owner''s INSERT into the mock queue is REFUSED — an owner-injected row can no longer steer the launcher''s human-seat autopick (068 resolves writer-blind, ORDER BY rank)');
select results_eq(
  $$ with w as (update draft_queues set rank = 99
                where draft_id = 'e0000000-0000-4000-8000-00000000000e' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'F51: the seat owner''s UPDATE on mock queue rows affects 0 rows (RETURNING-count against the launcher-seeded row pinned above)');
select results_eq(
  $$ with d as (delete from draft_queues
                where draft_id = 'e0000000-0000-4000-8000-00000000000e' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'F51: the seat owner''s DELETE on mock queue rows affects 0 rows (RETURNING-count)');
select is(
  (select count(*) from draft_queues
   where draft_id = 'e0000000-0000-4000-8000-000000000001'
     and team_id = 'c1000000-0000-4000-8000-000000000002'),
  2::bigint,
  'F51 boundary: u2''s own-queue read on the REAL draft is untouched (the NOT is_mock guard narrows mocks only)');

-- ---------------------------------------------------------------------------
-- J. Teamless member (u6): the policy-swap NEW-semantics direction.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "80000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select is(
  (select count(*) from drafts where league_id = 'a1000000-0000-4000-8000-00000000000a'),
  4::bigint,
  'a member with NO teams row sees the league''s drafts (membership truth, not team ownership)');
select is(
  (select count(*) from league_chat where league_id = 'a1000000-0000-4000-8000-00000000000a'),
  6::bigint,
  'NEW semantics: a member with NO teams row reads chat (the old 001 teams-keyed policy DENIED this — 052 pattern, direction 1)');
select lives_ok(
  $$ insert into league_chat (league_id, user_id, message)
     values ('a1000000-0000-4000-8000-00000000000a',
             '80000000-0000-4000-8000-000000000006', 'teamless member posts') $$,
  'NEW semantics: a member with NO teams row POSTS (the old policy denied this too)');

-- ---------------------------------------------------------------------------
-- K. The C11 ghost (u3): teams-row owner, NO membership — sees nothing.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "80000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is(
  (select count(*) from drafts), 0::bigint,
  'ghost teams-row owner sees zero drafts');
select is(
  (select count(*) from draft_picks), 0::bigint,
  'ghost teams-row owner sees zero picks');
select is(
  (select count(*) from league_chat), 0::bigint,
  'OLD semantics now fail: a teams-row owner with NO membership reads NO chat (the 001 policy GRANTED this — 052 pattern, direction 2; the C11 fix)');
select throws_ok(
  $$ insert into league_chat (league_id, user_id, message)
     values ('a1000000-0000-4000-8000-00000000000a',
             '80000000-0000-4000-8000-000000000003', 'ghost post') $$,
  '42501', null,
  'OLD semantics now fail: the ghost cannot POST either (the 001 INSERT policy granted this — the C11 fix, write direction)');

-- ---------------------------------------------------------------------------
-- L. Outsider (u4) + anon: deny-by-default sweep.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "80000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select is((select count(*) from drafts), 0::bigint, 'outsider sees zero drafts');
select is((select count(*) from draft_picks), 0::bigint, 'outsider sees zero picks');
select is((select count(*) from draft_queues), 0::bigint, 'outsider sees zero queue rows');
select is((select count(*) from league_chat), 0::bigint, 'outsider sees zero chat rows');
select throws_ok(
  $$ insert into league_chat (league_id, user_id, message)
     values ('a1000000-0000-4000-8000-00000000000a',
             '80000000-0000-4000-8000-000000000004', 'outsider post') $$,
  '42501', null, 'outsider chat INSERT denied (42501)');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*) from drafts), 0::bigint, 'anon sees zero drafts');
select is((select count(*) from draft_picks), 0::bigint, 'anon sees zero picks');
select is((select count(*) from draft_queues), 0::bigint, 'anon sees zero queue rows');
select is((select count(*) from league_chat), 0::bigint, 'anon sees zero chat rows');
select throws_ok(
  $$ insert into drafts (league_id) values ('a1000000-0000-4000-8000-00000000000a') $$,
  '42501', null, 'anon INSERT into drafts denied');
select throws_ok(
  $$ insert into draft_picks (draft_id, league_id, pick_number, team_id, player_id)
     values ('e0000000-0000-4000-8000-000000000001',
             'a1000000-0000-4000-8000-00000000000a',
             11, 'c1000000-0000-4000-8000-000000000001', 'pgtap-dr-p1') $$,
  '42501', null, 'anon INSERT into draft_picks denied');
select throws_ok(
  $$ insert into draft_queues (draft_id, team_id, player_id, rank)
     values ('e0000000-0000-4000-8000-000000000001',
             'c1000000-0000-4000-8000-000000000001', 'pgtap-dr-p1', 1) $$,
  '42501', null, 'anon INSERT into draft_queues denied');
select throws_ok(
  $$ insert into league_chat (league_id, user_id, message)
     values ('a1000000-0000-4000-8000-00000000000a', null, 'anon post') $$,
  '42501', null, 'anon INSERT into league_chat denied');
select results_eq(
  $$ with w as (update league_chat set message = 'anon edit' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'anon UPDATE on chat affects 0 rows');
select results_eq(
  $$ with d as (delete from league_chat returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'anon DELETE on chat affects 0 rows');
reset role;

select * from finish();
rollback;
