-- ============================================================================
-- The in-season tables — migration 109 (task L.D1.1; spec §12.8 / §12.9 /
-- §12.18 / §12.19 / §22.4 / §23.5; plan §8.1–8.2; tasks-M4 §4 standing
-- rules; D292/D294 (queue + pool law); D302; C59).
--
-- Numbering: pgTAP head measured 056 at task time (ls supabase/tests/ |
-- tail -1) ⇒ 057, the tasks-M4 §7 reservation confirmed, not inherited
-- (D161/D166).
--
-- Falsifiability notes (tasks-M1 §4.3, carried by tasks-M4 §4):
--   * ALL FIVE tables have NO client write path for ANY role — including
--     the commissioner (the 056/010 league_weeks shape): INSERT expects
--     42501; UPDATE/DELETE (RLS-filtered silently) use the RETURNING-count
--     pattern preceded by a same-role SELECT-sees-N pin so "0 affected"
--     cannot mask "0 rows" (§4.2). Roles walked: L1 commissioner, L1
--     manager (member, not commish), L2 commissioner (a NON-member of L1),
--     anon. The queue additionally proves the positive: service_role sees
--     every row and writes one (RETURNING 1) — the only role that can.
--   * THE UNIQUE PAIR FROM BOTH SIDES (§12.8's cleanup, task item 1):
--     (a) COEXIST — a `secondary` row with the SAME home team in the SAME
--     week as the primary lives (the plain UNIQUE the spec sanctioned
--     dropping would refuse it — pinned ABSENT from pg_constraint too);
--     (b) REFUSE — a duplicate primary home row 23505s on
--     uniq_matchup_home_per_week and a duplicate primary AWAY row 23505s on
--     uniq_matchup_away_per_week; (c) two byes (away NULL) in one week
--     coexist — the away index is partial on `away_team_id IS NOT NULL`.
--     The DoD break probe drops the away-side index: (b)'s away cell reds.
--   * CHECKs at boundaries (R43): every comment-only enum is walked — each
--     legal value inserted live, one past the edge ('banana') 23514; the
--     `away <> home` CHECK; the four NOT NULL tightenings (explicit NULL
--     23502; omitting the column still writes the DEFAULT — the one-unit
--     sibling, D146); `player_stats.advanced` accepts `{}` and an object,
--     refuses `[]` (23514), and a row written WITHOUT the column reads the
--     stored literal `{}` (C59's "missing key = not reported").
--   * Queue dedupe (D292): the SAME (season, week, player) enqueued twice
--     with ON CONFLICT DO NOTHING affects 0 rows the second time — a hot
--     player enqueues once per drain window — and a bare re-insert 23505s.
--   * §22.4 by prefix: an index on team_week_results whose LEADING columns
--     are (league_id, season) exists (idx_twr_league_season's first two
--     indkey entries) — the structural pin behind the banner's "satisfied
--     by prefix" claim; the EXPLAIN measurement lives in D302.
--   * All privileged-context work (fixtures + boundaries) runs BEFORE any
--     JWT claims are set — set_config(..., true) persists to txn end
--     (D49(7), the 007/009/010 precedent).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(212);

-- ---------------------------------------------------------------------------
-- A. Shape pins — §12.8 / §12.18 / §12.9 / §12.19 column-for-column, the
--    queue, the C59 column, and every index by name.
-- ---------------------------------------------------------------------------

-- A1. matchups
select has_table('public', 'matchups', 'matchups exists');
select columns_are('public', 'matchups',
  array['id', 'league_id', 'season', 'week', 'round_type', 'home_team_id',
        'away_team_id', 'home_score', 'away_score', 'status', 'result',
        'is_overridden', 'override_action_id', 'created_at', 'updated_at'],
  'exact §12.8 column set');
select col_is_pk('public', 'matchups', 'id', 'matchups PK id');
select fk_ok('public', 'matchups', 'league_id', 'public', 'leagues', 'id', 'matchups.league_id → leagues');
select fk_ok('public', 'matchups', 'home_team_id', 'public', 'teams', 'id', 'matchups.home_team_id → teams');
select fk_ok('public', 'matchups', 'away_team_id', 'public', 'teams', 'id', 'matchups.away_team_id → teams');
select col_is_null('public', 'matchups', 'away_team_id', 'away_team_id nullable (NULL = bye)');
select col_not_null('public', 'matchups', 'round_type', 'round_type NOT NULL (the unique pair''s key — D302 tightening)');
select col_default_is('public', 'matchups', 'round_type', 'regular', $$round_type defaults to 'regular'$$);
select col_not_null('public', 'matchups', 'status', 'status NOT NULL (the partial index predicate''s column — D302 tightening)');
select col_default_is('public', 'matchups', 'status', 'scheduled', $$status defaults to 'scheduled'$$);
select col_is_null('public', 'matchups', 'result', 'result nullable (NULL = undecided)');
select col_not_null('public', 'matchups', 'is_overridden', 'is_overridden NOT NULL (§22.2 — D302 tightening)');
select col_default_is('public', 'matchups', 'is_overridden', 'false', 'is_overridden defaults FALSE');
select col_is_null('public', 'matchups', 'home_score', 'home_score NULLABLE as printed — the column-level room for pending (E61/D295), deliberately NOT tightened');
select col_is_null('public', 'matchups', 'override_action_id', 'override_action_id nullable, FK-less until M6''s commissioner_actions');
select ok(
  not exists (
    select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
    where t.relname = 'matchups' and c.contype = 'f'
      and c.conkey = (select array_agg(attnum) from pg_attribute
                      where attrelid = t.oid and attname = 'override_action_id')),
  'override_action_id carries NO FK (commissioner_actions is M6''s table — the 056 reopened_by_action_id precedent)');
select has_index('public', 'matchups', 'uniq_matchup_home_per_week', 'uniq_matchup_home_per_week exists');
select has_index('public', 'matchups', 'uniq_matchup_away_per_week', 'uniq_matchup_away_per_week exists');
select ok(
  (select indisunique from pg_index i join pg_class c on c.oid = i.indexrelid
   where c.relname = 'uniq_matchup_home_per_week')
  and (select indisunique from pg_index i join pg_class c on c.oid = i.indexrelid
   where c.relname = 'uniq_matchup_away_per_week'),
  'both halves of the pair are UNIQUE indexes');
select ok(
  (select pg_get_indexdef(i.indexrelid) like '%WHERE (away_team_id IS NOT NULL)'
   from pg_index i join pg_class c on c.oid = i.indexrelid
   where c.relname = 'uniq_matchup_away_per_week'),
  'the away side is PARTIAL on away_team_id IS NOT NULL (byes never collide)');
select ok(
  not exists (
    select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
    where t.relname = 'matchups' and c.contype = 'u'
      and (select array_agg(a.attname::text order by a.attname)
           from unnest(c.conkey) k join pg_attribute a
             on a.attrelid = t.oid and a.attnum = k)
          = array['home_team_id', 'league_id', 'season', 'week']),
  'the plain UNIQUE(league_id, season, week, home_team_id) is ABSENT — dropped per §12.8''s own comment (a secondary row would collide with the primary)');
select has_index('public', 'matchups', 'idx_matchups_league_week', 'idx_matchups_league_week exists (§12.8)');
select has_index('public', 'matchups', 'idx_matchups_league_week_open', 'idx_matchups_league_week_open exists (§22.4)');
select ok(
  (select pg_get_indexdef(i.indexrelid) like $$%WHERE (status <> 'final'::text)$$
   from pg_index i join pg_class c on c.oid = i.indexrelid
   where c.relname = 'idx_matchups_league_week_open'),
  $$idx_matchups_league_week_open is PARTIAL on status <> 'final' (§22.4's printed predicate)$$);
select ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'matchups'),
  'RLS enabled on matchups');
select policies_are('public', 'matchups',
  array['Matchups viewable by league members'],
  'matchups: exactly ONE policy — member SELECT; no client write path for any role');
select policy_cmd_is('public', 'matchups', 'Matchups viewable by league members', 'SELECT',
  'matchups policy is SELECT-only');

-- A2. team_week_results
select has_table('public', 'team_week_results', 'team_week_results exists');
select columns_are('public', 'team_week_results',
  array['id', 'league_id', 'team_id', 'season', 'week', 'points',
        'opponent_team_id', 'h2h_result', 'median_result',
        'second_opponent_team_id', 'second_result', 'is_final'],
  'exact §12.18 column set');
select col_type_is('public', 'team_week_results', 'points', 'numeric(8,2)', 'points is NUMERIC(8,2)');
select col_not_null('public', 'team_week_results', 'points', 'points NOT NULL');
select col_default_is('public', 'team_week_results', 'points', '0', 'points defaults 0');
select col_not_null('public', 'team_week_results', 'is_final', 'is_final NOT NULL (§22.2 — D302 tightening)');
select col_default_is('public', 'team_week_results', 'is_final', 'false', 'is_final defaults FALSE');
select fk_ok('public', 'team_week_results', 'team_id', 'public', 'teams', 'id', 'twr.team_id → teams');
select fk_ok('public', 'team_week_results', 'opponent_team_id', 'public', 'teams', 'id', 'twr.opponent_team_id → teams');
select fk_ok('public', 'team_week_results', 'second_opponent_team_id', 'public', 'teams', 'id', 'twr.second_opponent_team_id → teams');
select col_is_unique('public', 'team_week_results', array['league_id', 'team_id', 'season', 'week'],
  'UNIQUE(league_id, team_id, season, week)');
select has_index('public', 'team_week_results', 'idx_twr_league_season', 'idx_twr_league_season exists (§12.18)');
select ok(
  exists (
    select 1 from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    where t.relname = 'team_week_results'
      and (select attname from pg_attribute where attrelid = t.oid and attnum = i.indkey[0]) = 'league_id'
      and (select attname from pg_attribute where attrelid = t.oid and attnum = i.indkey[1]) = 'season'),
  '§22.4''s team_week_results(league_id, season) is served by an index whose LEADING columns are (league_id, season) — satisfied by prefix, not by a duplicate btree (D302)');
select ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'team_week_results'),
  'RLS enabled on team_week_results');
select policies_are('public', 'team_week_results',
  array['Results viewable by members'],
  'team_week_results: exactly ONE policy — member SELECT; no client write path for any role');
select policy_cmd_is('public', 'team_week_results', 'Results viewable by members', 'SELECT',
  'team_week_results policy is SELECT-only');

-- A3. transactions
select has_table('public', 'transactions', 'transactions exists');
select columns_are('public', 'transactions',
  array['id', 'league_id', 'type', 'status', 'initiator_team_id',
        'initiated_by', 'payload', 'related_action_id', 'week', 'created_at'],
  'exact §12.9 column set');
select col_not_null('public', 'transactions', 'type', 'type NOT NULL');
select col_not_null('public', 'transactions', 'status', 'status NOT NULL');
select col_default_is('public', 'transactions', 'status', 'complete', $$status defaults to 'complete'$$);
select col_not_null('public', 'transactions', 'payload', 'payload NOT NULL');
select col_is_null('public', 'transactions', 'initiator_team_id', 'initiator_team_id nullable (commissioner-initiated)');
select fk_ok('public', 'transactions', 'initiator_team_id', 'public', 'teams', 'id', 'transactions.initiator_team_id → teams');
select fk_ok('public', 'transactions', 'initiated_by', 'public', 'profiles', 'id', 'transactions.initiated_by → profiles');
select has_index('public', 'transactions', 'idx_transactions_league', 'idx_transactions_league exists (§12.9 / §22.4)');
select ok(
  (select pg_get_indexdef(i.indexrelid) like '%(league_id, created_at DESC)'
   from pg_index i join pg_class c on c.oid = i.indexrelid
   where c.relname = 'idx_transactions_league'),
  'idx_transactions_league is (league_id, created_at DESC) — the activity feed''s order');
select ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'transactions'),
  'RLS enabled on transactions');
select policies_are('public', 'transactions',
  array['Transactions viewable by league members'],
  'transactions: exactly ONE policy — member SELECT; no client write path for any role');
select policy_cmd_is('public', 'transactions', 'Transactions viewable by league members', 'SELECT',
  'transactions policy is SELECT-only');

-- A4. league_player_pool
select has_table('public', 'league_player_pool', 'league_player_pool exists');
select columns_are('public', 'league_player_pool',
  array['league_id', 'player_id', 'state', 'waivers_until', 'locked_until', 'updated_at'],
  'exact §12.19 column set');
select col_is_pk('public', 'league_player_pool', array['league_id', 'player_id'], 'pool PK (league_id, player_id)');
select fk_ok('public', 'league_player_pool', 'player_id', 'public', 'players', 'id', 'pool.player_id → players');
select col_not_null('public', 'league_player_pool', 'state', 'state NOT NULL');
select col_default_is('public', 'league_player_pool', 'state', 'free_agent', $$state defaults to 'free_agent'$$);
select has_index('public', 'league_player_pool', 'idx_pool_waivers', 'idx_pool_waivers exists (§12.19)');
select ok(
  (select pg_get_indexdef(i.indexrelid) like $$%(league_id, waivers_until) WHERE (state = 'on_waivers'::text)$$
   from pg_index i join pg_class c on c.oid = i.indexrelid
   where c.relname = 'idx_pool_waivers'),
  $$idx_pool_waivers is PARTIAL on state = 'on_waivers' over (league_id, waivers_until)$$);
select ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'league_player_pool'),
  'RLS enabled on league_player_pool');
select policies_are('public', 'league_player_pool',
  array['Pool viewable by members'],
  'league_player_pool: exactly ONE policy — member SELECT; no client write path for any role');
select policy_cmd_is('public', 'league_player_pool', 'Pool viewable by members', 'SELECT',
  'league_player_pool policy is SELECT-only');

-- A5. score_fanout (the queue)
select has_table('public', 'score_fanout', 'score_fanout exists');
select columns_are('public', 'score_fanout',
  array['season', 'week', 'player_id', 'enqueued_at'],
  'exact queue column set (season, week, player_id, enqueued_at — task item 5)');
select col_is_pk('public', 'score_fanout', array['season', 'week', 'player_id'],
  'queue PK (season, week, player_id) — the dedupe key (D292)');
select fk_ok('public', 'score_fanout', 'player_id', 'public', 'players', 'id', 'queue.player_id → players');
select col_not_null('public', 'score_fanout', 'enqueued_at', 'enqueued_at NOT NULL');
select ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'score_fanout'),
  'RLS enabled on score_fanout (the 001 fail-open backstop would red otherwise)');
select policies_are('public', 'score_fanout', array[]::text[],
  'score_fanout: ZERO policies — deny-all for every client role; service_role alone (rolbypassrls) reads and writes');

-- A6. player_stats.advanced (C59) + idx_league_rosters_player (§22.4)
select has_column('public', 'player_stats', 'advanced', 'player_stats.advanced exists (C59 — §23.5''s storage rule, executed)');
select col_type_is('public', 'player_stats', 'advanced', 'jsonb', 'advanced is JSONB');
select col_not_null('public', 'player_stats', 'advanced', 'advanced NOT NULL');
select col_default_is('public', 'player_stats', 'advanced', '{}', $$advanced defaults to '{}'$$);
select has_index('public', 'league_rosters', 'idx_league_rosters_player',
  'idx_league_rosters_player exists (§22.4 — the fan-out map''s index, absent until 109)');
select ok(
  (select pg_get_indexdef(i.indexrelid) like '%league_rosters USING btree (player_id)'
   from pg_index i join pg_class c on c.oid = i.indexrelid
   where c.relname = 'idx_league_rosters_player'),
  'idx_league_rosters_player is a btree on (player_id) alone');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — before any JWT claims).
--    L1 (a4…0a): u1 commish, u2 manager; teams t1..t4.
--    L2 (a4…0b): u3 commish (NOT a member of L1); teams s1, s2.
--    Players p01..p03 for the pool / queue / player_stats cells.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '74000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-is1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "is_commish"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '74000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-is2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "is_manager"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '74000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'pgtap-is3@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "is_commish2"}', now(), now());

insert into leagues (id, owner_id, name, season) values
  ('a4000000-0000-4000-8000-00000000000a', '74000000-0000-4000-8000-000000000001', 'pgtap-is-1', 2026),
  ('a4000000-0000-4000-8000-00000000000b', '74000000-0000-4000-8000-000000000003', 'pgtap-is-2', 2026);

insert into teams (id, owner_id, name, league_id) values
  ('c4000000-0000-4000-8000-0000000000a1', '74000000-0000-4000-8000-000000000001', 'is-t1', 'a4000000-0000-4000-8000-00000000000a'),
  ('c4000000-0000-4000-8000-0000000000a2', '74000000-0000-4000-8000-000000000002', 'is-t2', 'a4000000-0000-4000-8000-00000000000a'),
  ('c4000000-0000-4000-8000-0000000000a3', '74000000-0000-4000-8000-000000000001', 'is-t3', 'a4000000-0000-4000-8000-00000000000a'),
  ('c4000000-0000-4000-8000-0000000000a4', '74000000-0000-4000-8000-000000000002', 'is-t4', 'a4000000-0000-4000-8000-00000000000a'),
  ('c4000000-0000-4000-8000-0000000000b1', '74000000-0000-4000-8000-000000000003', 'is-s1', 'a4000000-0000-4000-8000-00000000000b'),
  ('c4000000-0000-4000-8000-0000000000b2', '74000000-0000-4000-8000-000000000003', 'is-s2', 'a4000000-0000-4000-8000-00000000000b');

insert into league_members (league_id, user_id, team_id, role) values
  ('a4000000-0000-4000-8000-00000000000a', '74000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-0000000000a1', 'commissioner'),
  ('a4000000-0000-4000-8000-00000000000a', '74000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-0000000000a2', 'manager'),
  ('a4000000-0000-4000-8000-00000000000b', '74000000-0000-4000-8000-000000000003', 'c4000000-0000-4000-8000-0000000000b1', 'commissioner');

insert into players (id, full_name, position, adp) values
  ('is-p01', 'IS WR 01', 'WR', 0.001),
  ('is-p02', 'IS RB 02', 'RB', 0.002),
  ('is-p03', 'IS QB 03', 'QB', 0.003);

-- L1 week 1: two primary pairings + two SECONDARY pairings (the §11.7
-- second_opponent shape — t1 and t2 are home in BOTH round types).
insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id) values
  ('a4000000-0000-4000-8000-00000000000a', 2026, 1, 'regular',
   'c4000000-0000-4000-8000-0000000000a1', 'c4000000-0000-4000-8000-0000000000a2'),
  ('a4000000-0000-4000-8000-00000000000a', 2026, 1, 'regular',
   'c4000000-0000-4000-8000-0000000000a3', 'c4000000-0000-4000-8000-0000000000a4');
-- L2 week 1: one pairing (the cross-league counter-pin's nonzero side).
insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id) values
  ('a4000000-0000-4000-8000-00000000000b', 2026, 1, 'regular',
   'c4000000-0000-4000-8000-0000000000b1', 'c4000000-0000-4000-8000-0000000000b2');

insert into team_week_results (league_id, team_id, season, week, points, opponent_team_id, h2h_result) values
  ('a4000000-0000-4000-8000-00000000000a', 'c4000000-0000-4000-8000-0000000000a1', 2026, 1, 101.24,
   'c4000000-0000-4000-8000-0000000000a2', 'win'),
  ('a4000000-0000-4000-8000-00000000000a', 'c4000000-0000-4000-8000-0000000000a2', 2026, 1, 98.10,
   'c4000000-0000-4000-8000-0000000000a1', 'loss'),
  ('a4000000-0000-4000-8000-00000000000b', 'c4000000-0000-4000-8000-0000000000b1', 2026, 1, 77.00,
   'c4000000-0000-4000-8000-0000000000b2', 'tie');

insert into transactions (league_id, type, initiator_team_id, initiated_by, payload, week) values
  ('a4000000-0000-4000-8000-00000000000a', 'add_drop', 'c4000000-0000-4000-8000-0000000000a2',
   '74000000-0000-4000-8000-000000000002', '{"in": ["is-p01"], "out": ["is-p02"]}', 1),
  ('a4000000-0000-4000-8000-00000000000a', 'commissioner_move', null,
   '74000000-0000-4000-8000-000000000001', '{"in": [], "out": ["is-p03"], "team": "c4000000-0000-4000-8000-0000000000a3"}', 1),
  ('a4000000-0000-4000-8000-00000000000b', 'add', 'c4000000-0000-4000-8000-0000000000b1',
   '74000000-0000-4000-8000-000000000003', '{"in": ["is-p03"], "out": []}', 1);

insert into league_player_pool (league_id, player_id, state, waivers_until) values
  ('a4000000-0000-4000-8000-00000000000a', 'is-p02', 'on_waivers', now() + interval '2 days'),
  ('a4000000-0000-4000-8000-00000000000a', 'is-p03', 'free_agent', null),
  ('a4000000-0000-4000-8000-00000000000b', 'is-p01', 'rostered', null);

insert into score_fanout (season, week, player_id) values
  (2026, 1, 'is-p01'),
  (2026, 1, 'is-p02');

-- ---------------------------------------------------------------------------
-- C. Constraint boundaries (postgres context).
-- ---------------------------------------------------------------------------

-- C1. THE UNIQUE PAIR FROM BOTH SIDES.
-- (a) COEXIST: a `secondary` row with the SAME home team (t1) and the SAME
--     week as its primary row lives — the plain UNIQUE would have refused it.
select lives_ok(
  $$ insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id) values
     ('a4000000-0000-4000-8000-00000000000a', 2026, 1, 'secondary',
      'c4000000-0000-4000-8000-0000000000a1', 'c4000000-0000-4000-8000-0000000000a3') $$,
  'COEXIST: a secondary-round row with the same home team (t1) in the same week as the primary row is accepted — the printed plain UNIQUE(league_id, season, week, home_team_id) is gone, as §12.8''s comment sanctions');
select lives_ok(
  $$ insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id) values
     ('a4000000-0000-4000-8000-00000000000a', 2026, 1, 'secondary',
      'c4000000-0000-4000-8000-0000000000a2', 'c4000000-0000-4000-8000-0000000000a4') $$,
  'COEXIST: the second secondary pairing (t2 home again, t4 away again) is accepted — same week, different round_type');
select is(
  (select count(*) from matchups
   where league_id = 'a4000000-0000-4000-8000-00000000000a' and week = 1
     and home_team_id = 'c4000000-0000-4000-8000-0000000000a1'),
  2::bigint,
  'stored literal: t1 is home TWICE in week 1 (one regular, one secondary)');
-- (b) REFUSE, home side: a duplicate PRIMARY home row for t1.
select throws_ok(
  $$ insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id) values
     ('a4000000-0000-4000-8000-00000000000a', 2026, 1, 'regular',
      'c4000000-0000-4000-8000-0000000000a1', 'c4000000-0000-4000-8000-0000000000a4') $$,
  '23505', null,
  'REFUSE (home side): a second regular-round row with t1 at home in week 1 is rejected — uniq_matchup_home_per_week');
-- (b) REFUSE, away side: t2 is already the regular-round away team; a new
--     home team (t4, never home in the regular round) does not help.
select throws_ok(
  $$ insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id) values
     ('a4000000-0000-4000-8000-00000000000a', 2026, 1, 'regular',
      'c4000000-0000-4000-8000-0000000000a4', 'c4000000-0000-4000-8000-0000000000a2') $$,
  '23505', null,
  'REFUSE (away side): a second regular-round row with t2 AWAY in week 1 is rejected — uniq_matchup_away_per_week (the DoD break probe drops this index and this cell reds)');
-- One unit away (D146): the same away row in a DIFFERENT week is accepted —
-- the refusal above is the index, not the pairing.
select lives_ok(
  $$ insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id) values
     ('a4000000-0000-4000-8000-00000000000a', 2026, 2, 'regular',
      'c4000000-0000-4000-8000-0000000000a4', 'c4000000-0000-4000-8000-0000000000a2') $$,
  'one unit away: t4 home / t2 away in week 2 is accepted — the away refusal is per (league, season, week, round_type)');
-- (c) BYES: two byes in one week coexist (away NULL is outside the partial
--     away index); a bye for a team already at home that week refuses.
select lives_ok(
  $$ insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id) values
     ('a4000000-0000-4000-8000-00000000000a', 2026, 3, 'regular',
      'c4000000-0000-4000-8000-0000000000a1', null),
     ('a4000000-0000-4000-8000-00000000000a', 2026, 3, 'regular',
      'c4000000-0000-4000-8000-0000000000a2', null) $$,
  'two byes (away_team_id NULL) in the same week coexist — the away index is partial on IS NOT NULL');
select throws_ok(
  $$ insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id) values
     ('a4000000-0000-4000-8000-00000000000a', 2026, 3, 'regular',
      'c4000000-0000-4000-8000-0000000000a1', null) $$,
  '23505', null,
  'a second bye for t1 in week 3 refuses — the home index counts byes (a bye is a home row)');

-- C2. matchups CHECKs at the boundary.
select throws_ok(
  $$ insert into matchups (league_id, season, week, home_team_id, away_team_id) values
     ('a4000000-0000-4000-8000-00000000000a', 2026, 4,
      'c4000000-0000-4000-8000-0000000000a1', 'c4000000-0000-4000-8000-0000000000a1') $$,
  '23514', null,
  'away_team_id = home_team_id rejected (§12.8 CHECK)');
select lives_ok(
  $$ insert into matchups (league_id, season, week, round_type, home_team_id, away_team_id) values
     ('a4000000-0000-4000-8000-00000000000a', 2026, 4, 'playoff',
      'c4000000-0000-4000-8000-0000000000a1', 'c4000000-0000-4000-8000-0000000000a2'),
     ('a4000000-0000-4000-8000-00000000000a', 2026, 4, 'consolation',
      'c4000000-0000-4000-8000-0000000000a3', 'c4000000-0000-4000-8000-0000000000a4'),
     ('a4000000-0000-4000-8000-00000000000a', 2026, 4, 'third_place',
      'c4000000-0000-4000-8000-0000000000a2', 'c4000000-0000-4000-8000-0000000000a3') $$,
  $$round_type accepts 'playoff', 'consolation', 'third_place' (with 'regular' and 'secondary' already live above — all five)$$);
select throws_ok(
  $$ insert into matchups (league_id, season, week, round_type, home_team_id) values
     ('a4000000-0000-4000-8000-00000000000a', 2026, 5, 'banana',
      'c4000000-0000-4000-8000-0000000000a1') $$,
  '23514', null,
  $$round_type = 'banana' rejected (R43 — the comment-only enum in §12.8's printed DDL would accept it)$$);
select throws_ok(
  $$ insert into matchups (league_id, season, week, round_type, home_team_id) values
     ('a4000000-0000-4000-8000-00000000000a', 2026, 5, null,
      'c4000000-0000-4000-8000-0000000000a1') $$,
  '23502', null,
  'round_type explicit NULL rejected (D302 tightening — a NULL would be distinct from every NULL in the unique pair)');
select is(
  (select round_type from matchups
   where league_id = 'a4000000-0000-4000-8000-00000000000a' and week = 3
     and home_team_id = 'c4000000-0000-4000-8000-0000000000a2'),
  'regular',
  $$one unit away: a row written WITHOUT round_type reads the stored literal 'regular'$$);
select lives_ok(
  $$ update matchups set status = 'live'
     where league_id = 'a4000000-0000-4000-8000-00000000000a' and week = 1 and round_type = 'regular'
       and home_team_id = 'c4000000-0000-4000-8000-0000000000a1' $$,
  $$status = 'live' accepted$$);
select lives_ok(
  $$ update matchups set status = 'final', result = 'home'
     where league_id = 'a4000000-0000-4000-8000-00000000000a' and week = 1 and round_type = 'regular'
       and home_team_id = 'c4000000-0000-4000-8000-0000000000a1' $$,
  $$status = 'final' + result = 'home' accepted$$);
select lives_ok(
  $$ update matchups set result = 'away'
     where league_id = 'a4000000-0000-4000-8000-00000000000a' and week = 1 and round_type = 'regular'
       and home_team_id = 'c4000000-0000-4000-8000-0000000000a3' $$,
  $$result = 'away' accepted$$);
select lives_ok(
  $$ update matchups set result = 'tie'
     where league_id = 'a4000000-0000-4000-8000-00000000000a' and week = 1 and round_type = 'secondary'
       and home_team_id = 'c4000000-0000-4000-8000-0000000000a1' $$,
  $$result = 'tie' accepted$$);
select throws_ok(
  $$ update matchups set status = 'banana'
     where league_id = 'a4000000-0000-4000-8000-00000000000a' and week = 1 $$,
  '23514', null,
  $$status = 'banana' rejected$$);
select throws_ok(
  $$ update matchups set status = null
     where league_id = 'a4000000-0000-4000-8000-00000000000a' and week = 1 $$,
  '23502', null,
  'status explicit NULL rejected (D302 tightening — neither in the open partial index nor final)');
select throws_ok(
  $$ update matchups set result = 'banana'
     where league_id = 'a4000000-0000-4000-8000-00000000000a' and week = 1 $$,
  '23514', null,
  $$result = 'banana' rejected$$);
select throws_ok(
  $$ update matchups set is_overridden = null
     where league_id = 'a4000000-0000-4000-8000-00000000000a' and week = 1 $$,
  '23502', null,
  'is_overridden explicit NULL rejected (D302 tightening — §22.2''s "never an overridden cell" needs a two-valued flag)');
-- The §22.4 partial index tracks status: the finalized row left it.
select is(
  (select count(*) from matchups
   where league_id = 'a4000000-0000-4000-8000-00000000000a' and week = 1 and status <> 'final'),
  3::bigint,
  'stored literal: 3 of L1''s 4 week-1 rows are non-final (the open-matchups scan''s population; 1 finalized above)');

-- C3. team_week_results boundaries.
select throws_ok(
  $$ insert into team_week_results (league_id, team_id, season, week) values
     ('a4000000-0000-4000-8000-00000000000a', 'c4000000-0000-4000-8000-0000000000a1', 2026, 1) $$,
  '23505', null,
  'duplicate (league_id, team_id, season, week) rejected');
select lives_ok(
  $$ insert into team_week_results (league_id, team_id, season, week, h2h_result, median_result, second_result) values
     ('a4000000-0000-4000-8000-00000000000a', 'c4000000-0000-4000-8000-0000000000a3', 2026, 1, 'bye', 'win', 'loss'),
     ('a4000000-0000-4000-8000-00000000000a', 'c4000000-0000-4000-8000-0000000000a4', 2026, 1, null, 'tie', 'tie') $$,
  $$h2h_result 'bye' / NULL, median_result 'win'/'tie', second_result 'loss'/'tie' accepted (with win/loss/tie live above — the full vocabularies)$$);
select throws_ok(
  $$ update team_week_results set h2h_result = 'banana'
     where league_id = 'a4000000-0000-4000-8000-00000000000a' $$,
  '23514', null,
  $$h2h_result = 'banana' rejected$$);
select throws_ok(
  $$ update team_week_results set median_result = 'bye'
     where league_id = 'a4000000-0000-4000-8000-00000000000a' $$,
  '23514', null,
  $$median_result = 'bye' rejected — one past the edge: 'bye' is h2h-only vocabulary$$);
select throws_ok(
  $$ update team_week_results set second_result = 'banana'
     where league_id = 'a4000000-0000-4000-8000-00000000000a' $$,
  '23514', null,
  $$second_result = 'banana' rejected$$);
select throws_ok(
  $$ update team_week_results set is_final = null
     where league_id = 'a4000000-0000-4000-8000-00000000000a' $$,
  '23502', null,
  'is_final explicit NULL rejected (D302 tightening)');
select is(
  (select points::text from team_week_results
   where league_id = 'a4000000-0000-4000-8000-00000000000a'
     and team_id = 'c4000000-0000-4000-8000-0000000000a3' and week = 1),
  '0.00',
  $$stored literal: a row written without points reads 0.00 (NUMERIC(8,2) default 0)$$);
select is(
  (select points::text from team_week_results
   where league_id = 'a4000000-0000-4000-8000-00000000000a'
     and team_id = 'c4000000-0000-4000-8000-0000000000a1' and week = 1),
  '101.24',
  'stored literal: 101.24 round-trips at two decimals');

-- C4. transactions boundaries.
select lives_ok(
  $$ insert into transactions (league_id, type, status, payload) values
     ('a4000000-0000-4000-8000-00000000000a', 'drop', 'pending', '{}'),
     ('a4000000-0000-4000-8000-00000000000a', 'waiver_claim', 'reversed', '{}'),
     ('a4000000-0000-4000-8000-00000000000a', 'trade', 'failed', '{}'),
     ('a4000000-0000-4000-8000-00000000000a', 'add', 'vetoed', '{}') $$,
  'type drop/waiver_claim/trade/add + status pending/reversed/failed/vetoed accepted (add_drop/commissioner_move/complete live above — full vocabularies)');
select throws_ok(
  $$ insert into transactions (league_id, type, payload) values
     ('a4000000-0000-4000-8000-00000000000a', 'banana', '{}') $$,
  '23514', null,
  $$type = 'banana' rejected$$);
select throws_ok(
  $$ insert into transactions (league_id, type, status, payload) values
     ('a4000000-0000-4000-8000-00000000000a', 'add', 'banana', '{}') $$,
  '23514', null,
  $$status = 'banana' rejected$$);
select throws_ok(
  $$ insert into transactions (league_id, type) values
     ('a4000000-0000-4000-8000-00000000000a', 'add') $$,
  '23502', null,
  'payload NULL rejected (NOT NULL as printed)');
select is(
  (select status from transactions
   where league_id = 'a4000000-0000-4000-8000-00000000000a' and type = 'add_drop'),
  'complete',
  $$stored literal: a row written without status reads 'complete'$$);

-- C5. league_player_pool boundaries.
select throws_ok(
  $$ insert into league_player_pool (league_id, player_id) values
     ('a4000000-0000-4000-8000-00000000000a', 'is-p02') $$,
  '23505', null,
  'duplicate (league_id, player_id) rejected — one pool row per player per league');
select lives_ok(
  $$ insert into league_player_pool (league_id, player_id, state, locked_until) values
     ('a4000000-0000-4000-8000-00000000000a', 'is-p01', 'locked_in_game', now() + interval '3 hours') $$,
  $$state = 'locked_in_game' accepted (free_agent/on_waivers/rostered live above — all four)$$);
select throws_ok(
  $$ update league_player_pool set state = 'banana'
     where league_id = 'a4000000-0000-4000-8000-00000000000a' and player_id = 'is-p03' $$,
  '23514', null,
  $$state = 'banana' rejected$$);
select throws_ok(
  $$ insert into league_player_pool (league_id, player_id) values
     ('a4000000-0000-4000-8000-00000000000a', 'is-nobody') $$,
  '23503', null,
  'an unknown player_id rejected (FK → players)');
select is(
  (select state from league_player_pool
   where league_id = 'a4000000-0000-4000-8000-00000000000b' and player_id = 'is-p01'),
  'rostered',
  'stored literal: the same player carries an independent state in another league (per-league PK)');

-- C6. score_fanout dedupe (D292) — a hot player enqueues ONCE.
select results_eq(
  $$ with q as (insert into score_fanout (season, week, player_id) values (2026, 1, 'is-p01')
                on conflict do nothing returning 1)
     select count(*) from q $$,
  $$ values (0::bigint) $$,
  'ON CONFLICT DO NOTHING re-enqueue of (2026, 1, is-p01) affects 0 rows — the PK is the dedupe');
select throws_ok(
  $$ insert into score_fanout (season, week, player_id) values (2026, 1, 'is-p01') $$,
  '23505', null,
  'a bare re-insert of the same (season, week, player) 23505s');
select results_eq(
  $$ with q as (insert into score_fanout (season, week, player_id) values (2026, 2, 'is-p01')
                on conflict do nothing returning 1)
     select count(*) from q $$,
  $$ values (1::bigint) $$,
  'one unit away: the same player in week 2 enqueues (1 row) — dedupe is per (season, week)');
select is((select count(*) from score_fanout), 3::bigint,
  'stored literal: the queue holds exactly 3 rows after the dedupe cells (the SELECT-sees-N pin for §D5)');

-- C7. player_stats.advanced (C59 / §23.5).
select lives_ok(
  $$ insert into player_stats (player_id, season, week) values ('is-p01', 2026, 1) $$,
  'a player_stats row written WITHOUT advanced is accepted');
select is(
  (select advanced::text from player_stats where player_id = 'is-p01' and season = 2026 and week = 1),
  '{}',
  $$stored literal: it reads '{}' — every key missing = nothing reported yet (§23.5)$$);
select lives_ok(
  $$ update player_stats set advanced = '{"air_yards": 112, "yards_after_catch": 41}'
     where player_id = 'is-p01' and season = 2026 and week = 1 $$,
  'an object with the §23.5 tracking keys is accepted');
select is(
  (select (advanced->>'air_yards')::int from player_stats where player_id = 'is-p01' and season = 2026 and week = 1),
  112,
  'stored literal: air_yards 112 reads back');
select throws_ok(
  $$ update player_stats set advanced = '[]'
     where player_id = 'is-p01' and season = 2026 and week = 1 $$,
  '23514', null,
  $$advanced = '[]' rejected — the column is a key→value map by definition (player_stats_advanced_is_object)$$);
select throws_ok(
  $$ update player_stats set advanced = '"pending"'
     where player_id = 'is-p01' and season = 2026 and week = 1 $$,
  '23514', null,
  'advanced = a JSON scalar rejected');
select throws_ok(
  $$ update player_stats set advanced = null
     where player_id = 'is-p01' and season = 2026 and week = 1 $$,
  '23502', null,
  'advanced = NULL rejected (NOT NULL — "unknown" is spelled {} / a missing key, never NULL)');

-- ---------------------------------------------------------------------------
-- D. RLS per role (§4.2 pattern). L1's population after §C, derived by hand:
--    matchups 10 (wk1: 2 regular + 2 secondary; wk2: 1; wk3: 2 byes; wk4:
--    playoff + consolation + third_place — the away=home row was refused);
--    team_week_results 4; transactions 6; pool 3; queue 3 (global).
-- ---------------------------------------------------------------------------
-- Postgres-side ground truth first (the SELECT-sees-N literals every role
-- cell compares against — stored, not recomputed).
select is((select count(*) from matchups where league_id = 'a4000000-0000-4000-8000-00000000000a'), 10::bigint,
  'ground truth: L1 holds 10 matchups rows after §C');
select is((select count(*) from matchups where league_id = 'a4000000-0000-4000-8000-00000000000b'), 1::bigint,
  'ground truth: L2 holds 1 matchups row');
select is((select count(*) from team_week_results where league_id = 'a4000000-0000-4000-8000-00000000000a'), 4::bigint,
  'ground truth: L1 holds 4 team_week_results rows');
select is((select count(*) from transactions where league_id = 'a4000000-0000-4000-8000-00000000000a'), 6::bigint,
  'ground truth: L1 holds 6 transactions rows');
select is((select count(*) from league_player_pool where league_id = 'a4000000-0000-4000-8000-00000000000a'), 3::bigint,
  'ground truth: L1 holds 3 pool rows');

-- D1. L1 commissioner (u1): sees all of L1, none of L2; writes nothing.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "74000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is((select count(*) from matchups where league_id = 'a4000000-0000-4000-8000-00000000000a'), 10::bigint,
  'commish sees all 10 of L1''s matchups');
select is((select count(*) from matchups where league_id = 'a4000000-0000-4000-8000-00000000000b'), 0::bigint,
  'commish sees ZERO of L2''s matchups — cross-league counter-pin');
select is((select count(*) from team_week_results where league_id = 'a4000000-0000-4000-8000-00000000000a'), 4::bigint,
  'commish sees all 4 of L1''s results');
select is((select count(*) from transactions where league_id = 'a4000000-0000-4000-8000-00000000000a'), 6::bigint,
  'commish sees all 6 of L1''s transactions');
select is((select count(*) from league_player_pool where league_id = 'a4000000-0000-4000-8000-00000000000a'), 3::bigint,
  'commish sees all 3 of L1''s pool rows');
select throws_ok(
  $$ insert into matchups (league_id, season, week, home_team_id) values
     ('a4000000-0000-4000-8000-00000000000a', 2026, 6, 'c4000000-0000-4000-8000-0000000000a1') $$,
  '42501', null, 'COMMISSIONER INSERT into matchups denied — no client write path even for the commish (engine/commish RPCs only)');
select results_eq(
  $$ with w as (update matchups set home_score = 999
                where league_id = 'a4000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'commissioner UPDATE on matchups affects 0 rows (10 visible)');
select results_eq(
  $$ with d as (delete from matchups
                where league_id = 'a4000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'commissioner DELETE on matchups affects 0 rows');
select throws_ok(
  $$ insert into team_week_results (league_id, team_id, season, week) values
     ('a4000000-0000-4000-8000-00000000000a', 'c4000000-0000-4000-8000-0000000000a1', 2026, 9) $$,
  '42501', null, 'COMMISSIONER INSERT into team_week_results denied');
select results_eq(
  $$ with w as (update team_week_results set points = 999
                where league_id = 'a4000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'commissioner UPDATE on team_week_results affects 0 rows (4 visible)');
select results_eq(
  $$ with d as (delete from team_week_results
                where league_id = 'a4000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'commissioner DELETE on team_week_results affects 0 rows');
select throws_ok(
  $$ insert into transactions (league_id, type, payload) values
     ('a4000000-0000-4000-8000-00000000000a', 'add', '{}') $$,
  '42501', null, 'COMMISSIONER INSERT into transactions denied');
select results_eq(
  $$ with w as (update transactions set status = 'reversed'
                where league_id = 'a4000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'commissioner UPDATE on transactions affects 0 rows (6 visible)');
select results_eq(
  $$ with d as (delete from transactions
                where league_id = 'a4000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'commissioner DELETE on transactions affects 0 rows');
select throws_ok(
  $$ insert into league_player_pool (league_id, player_id) values
     ('a4000000-0000-4000-8000-00000000000a', 'is-p03') $$,
  '42501', null, 'COMMISSIONER INSERT into league_player_pool denied');
select results_eq(
  $$ with w as (update league_player_pool set state = 'free_agent'
                where league_id = 'a4000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'commissioner UPDATE on league_player_pool affects 0 rows (3 visible)');
select results_eq(
  $$ with d as (delete from league_player_pool
                where league_id = 'a4000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'commissioner DELETE on league_player_pool affects 0 rows');
-- The queue: a commissioner is just another client — nothing.
select is((select count(*) from score_fanout), 0::bigint,
  'commish sees ZERO queue rows (3 exist) — deny-all RLS');
select throws_ok(
  $$ insert into score_fanout (season, week, player_id) values (2026, 3, 'is-p01') $$,
  '42501', null, 'COMMISSIONER INSERT into score_fanout denied');
select results_eq(
  $$ with w as (update score_fanout set enqueued_at = now() returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$,
  'commissioner UPDATE on score_fanout affects 0 rows');
select results_eq(
  $$ with d as (delete from score_fanout returning 1) select count(*) from d $$,
  $$ values (0::bigint) $$,
  'commissioner DELETE on score_fanout affects 0 rows');

-- D2. L1 manager (u2): a MEMBER, not commish — same visibility, same zero writes.
select set_config('request.jwt.claims',
  '{"sub": "74000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is((select count(*) from matchups where league_id = 'a4000000-0000-4000-8000-00000000000a'), 10::bigint,
  'manager sees all 10 of L1''s matchups (is_league_member, not is_league_commish)');
select is((select count(*) from team_week_results where league_id = 'a4000000-0000-4000-8000-00000000000a'), 4::bigint,
  'manager sees all 4 of L1''s results');
select is((select count(*) from transactions where league_id = 'a4000000-0000-4000-8000-00000000000a'), 6::bigint,
  'manager sees all 6 of L1''s transactions (the activity feed is member-wide, §12.9)');
select is((select count(*) from league_player_pool where league_id = 'a4000000-0000-4000-8000-00000000000a'), 3::bigint,
  'manager sees all 3 of L1''s pool rows');
select is((select count(*) from matchups where league_id = 'a4000000-0000-4000-8000-00000000000b'), 0::bigint,
  'manager sees ZERO of L2''s matchups');
select throws_ok(
  $$ insert into matchups (league_id, season, week, home_team_id) values
     ('a4000000-0000-4000-8000-00000000000a', 2026, 6, 'c4000000-0000-4000-8000-0000000000a2') $$,
  '42501', null, 'manager INSERT into matchups denied');
select results_eq(
  $$ with w as (update matchups set home_score = 999
                where league_id = 'a4000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'manager UPDATE on matchups affects 0 rows');
select results_eq(
  $$ with d as (delete from matchups
                where league_id = 'a4000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'manager DELETE on matchups affects 0 rows');
select throws_ok(
  $$ insert into team_week_results (league_id, team_id, season, week) values
     ('a4000000-0000-4000-8000-00000000000a', 'c4000000-0000-4000-8000-0000000000a2', 2026, 9) $$,
  '42501', null, 'manager INSERT into team_week_results denied');
select results_eq(
  $$ with w as (update team_week_results set points = 999
                where league_id = 'a4000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'manager UPDATE on team_week_results affects 0 rows');
select results_eq(
  $$ with d as (delete from team_week_results
                where league_id = 'a4000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'manager DELETE on team_week_results affects 0 rows');
select throws_ok(
  $$ insert into transactions (league_id, type, payload, initiator_team_id, initiated_by) values
     ('a4000000-0000-4000-8000-00000000000a', 'add', '{}',
      'c4000000-0000-4000-8000-0000000000a2', '74000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'manager INSERT into transactions denied — even their OWN move is written by the RPC, never the client');
select results_eq(
  $$ with w as (update transactions set status = 'reversed'
                where league_id = 'a4000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'manager UPDATE on transactions affects 0 rows');
select results_eq(
  $$ with d as (delete from transactions
                where league_id = 'a4000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'manager DELETE on transactions affects 0 rows');
select throws_ok(
  $$ insert into league_player_pool (league_id, player_id) values
     ('a4000000-0000-4000-8000-00000000000a', 'is-p03') $$,
  '42501', null, 'manager INSERT into league_player_pool denied');
select results_eq(
  $$ with w as (update league_player_pool set state = 'free_agent'
                where league_id = 'a4000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'manager UPDATE on league_player_pool affects 0 rows');
select results_eq(
  $$ with d as (delete from league_player_pool
                where league_id = 'a4000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'manager DELETE on league_player_pool affects 0 rows');
select is((select count(*) from score_fanout), 0::bigint, 'manager sees ZERO queue rows');
select throws_ok(
  $$ insert into score_fanout (season, week, player_id) values (2026, 3, 'is-p01') $$,
  '42501', null, 'manager INSERT into score_fanout denied');
select results_eq(
  $$ with w as (update score_fanout set enqueued_at = now() returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$,
  'manager UPDATE on score_fanout affects 0 rows');
select results_eq(
  $$ with d as (delete from score_fanout returning 1) select count(*) from d $$,
  $$ values (0::bigint) $$,
  'manager DELETE on score_fanout affects 0 rows');

-- D3. L2 commissioner (u3) — a NON-member of L1: sees only L2, none of L1.
select set_config('request.jwt.claims',
  '{"sub": "74000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is((select count(*) from matchups where league_id = 'a4000000-0000-4000-8000-00000000000b'), 1::bigint,
  'L2 commish sees L2''s own matchup');
select is((select count(*) from matchups where league_id = 'a4000000-0000-4000-8000-00000000000a'), 0::bigint,
  'non-member sees ZERO of L1''s matchups');
select is((select count(*) from team_week_results where league_id = 'a4000000-0000-4000-8000-00000000000a'), 0::bigint,
  'non-member sees ZERO of L1''s results');
select is((select count(*) from transactions where league_id = 'a4000000-0000-4000-8000-00000000000a'), 0::bigint,
  'non-member sees ZERO of L1''s transactions');
select is((select count(*) from league_player_pool where league_id = 'a4000000-0000-4000-8000-00000000000a'), 0::bigint,
  'non-member sees ZERO of L1''s pool rows');
select is((select count(*) from league_player_pool where league_id = 'a4000000-0000-4000-8000-00000000000b'), 1::bigint,
  '…while seeing L2''s own 1 pool row (the SELECT-sees-N sibling)');
select throws_ok(
  $$ insert into matchups (league_id, season, week, home_team_id) values
     ('a4000000-0000-4000-8000-00000000000a', 2026, 6, 'c4000000-0000-4000-8000-0000000000a1') $$,
  '42501', null, 'non-member INSERT into L1 matchups denied');
select results_eq(
  $$ with w as (update matchups set home_score = 999 returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$,
  'non-member UPDATE across matchups affects 0 rows (L2''s own row included — no write policy anywhere)');
select results_eq(
  $$ with d as (delete from transactions returning 1) select count(*) from d $$,
  $$ values (0::bigint) $$,
  'non-member DELETE across transactions affects 0 rows');

-- D4. anon: sees nothing, writes nothing (auth.uid() NULL ⇒ is_league_member FALSE).
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*) from matchups), 0::bigint, 'anon sees zero matchups');
select is((select count(*) from team_week_results), 0::bigint, 'anon sees zero team_week_results');
select is((select count(*) from transactions), 0::bigint, 'anon sees zero transactions');
select is((select count(*) from league_player_pool), 0::bigint, 'anon sees zero pool rows');
select is((select count(*) from score_fanout), 0::bigint, 'anon sees zero queue rows');
select throws_ok(
  $$ insert into matchups (league_id, season, week, home_team_id) values
     ('a4000000-0000-4000-8000-00000000000a', 2026, 6, 'c4000000-0000-4000-8000-0000000000a1') $$,
  '42501', null, 'anon INSERT into matchups denied');
select throws_ok(
  $$ insert into team_week_results (league_id, team_id, season, week) values
     ('a4000000-0000-4000-8000-00000000000a', 'c4000000-0000-4000-8000-0000000000a1', 2026, 9) $$,
  '42501', null, 'anon INSERT into team_week_results denied');
select throws_ok(
  $$ insert into transactions (league_id, type, payload) values
     ('a4000000-0000-4000-8000-00000000000a', 'add', '{}') $$,
  '42501', null, 'anon INSERT into transactions denied');
select throws_ok(
  $$ insert into league_player_pool (league_id, player_id) values
     ('a4000000-0000-4000-8000-00000000000a', 'is-p03') $$,
  '42501', null, 'anon INSERT into league_player_pool denied');
select throws_ok(
  $$ insert into score_fanout (season, week, player_id) values (2026, 3, 'is-p01') $$,
  '42501', null, 'anon INSERT into score_fanout denied');
select results_eq(
  $$ with w as (update matchups set home_score = 999 returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'anon UPDATE on matchups affects 0 rows');
select results_eq(
  $$ with w as (update team_week_results set points = 999 returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'anon UPDATE on team_week_results affects 0 rows');
select results_eq(
  $$ with w as (update transactions set status = 'reversed' returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'anon UPDATE on transactions affects 0 rows');
select results_eq(
  $$ with w as (update league_player_pool set state = 'free_agent' returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'anon UPDATE on league_player_pool affects 0 rows');
select results_eq(
  $$ with w as (update score_fanout set enqueued_at = now() returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'anon UPDATE on score_fanout affects 0 rows');
select results_eq(
  $$ with d as (delete from matchups returning 1) select count(*) from d $$,
  $$ values (0::bigint) $$, 'anon DELETE on matchups affects 0 rows');
select results_eq(
  $$ with d as (delete from team_week_results returning 1) select count(*) from d $$,
  $$ values (0::bigint) $$, 'anon DELETE on team_week_results affects 0 rows');
select results_eq(
  $$ with d as (delete from transactions returning 1) select count(*) from d $$,
  $$ values (0::bigint) $$, 'anon DELETE on transactions affects 0 rows');
select results_eq(
  $$ with d as (delete from league_player_pool returning 1) select count(*) from d $$,
  $$ values (0::bigint) $$, 'anon DELETE on league_player_pool affects 0 rows');
select results_eq(
  $$ with d as (delete from score_fanout returning 1) select count(*) from d $$,
  $$ values (0::bigint) $$, 'anon DELETE on score_fanout affects 0 rows');
reset role;

-- D5. service_role — the queue's ONLY reader/writer (rolbypassrls, not
--     superuser): sees the 3 rows, enqueues one, drains one. The positive
--     that makes every 0 above a refusal rather than an empty table.
set local role service_role;
select is((select count(*) from score_fanout), 3::bigint,
  'service_role sees all 3 queue rows (the SELECT-sees-N pin behind the deny-all cells)');
select results_eq(
  $$ with q as (insert into score_fanout (season, week, player_id) values (2026, 3, 'is-p03')
                on conflict do nothing returning 1)
     select count(*) from q $$,
  $$ values (1::bigint) $$,
  'service_role enqueues (1 row) — ingestion''s path');
select results_eq(
  $$ with d as (delete from score_fanout where season = 2026 and week = 3 and player_id = 'is-p03' returning 1)
     select count(*) from d $$,
  $$ values (1::bigint) $$,
  'service_role drains (1 row) — the worker''s path');
reset role;

select * from finish();
rollback;
