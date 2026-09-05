-- ============================================================================
-- update_league_settings — migration 061 (spec §15.1 PATCH / §7.3 header /
-- §7.3.3 / §7.3.8 / §12.1–12.2; task L.A1.13; PROGRESS D70; standing rules
-- tasks-M1 §4). pgTAP file is **015** (014 = create_league; next free
-- confirmed at task time).
--
-- Falsifiability notes (§4.3):
--   * Post-update row pins are GOLDEN: every §12.1 typed column equals the
--     passed literal, max_teams = team_count in the SAME statement (the
--     §12.1 sync's SECOND writer — a two-statement or forgotten sync fails),
--     blob/roster byte-equal the passed jsonb (a re-splitting implementation
--     fails).
--   * p_scoring_system_id NULL = keep-current is counter-pinned (the scoring
--     reference survives a NULL byte-for-byte), and a real change is pinned
--     both with a NULL snapshot (stays NULL — no premature freeze) and with
--     an existing snapshot (re-frozen to the NEW template's rules, §7.3.3 —
--     a keep-the-old implementation fails the deep-equal).
--   * §12.2 re-seed: faab_balance is pinned to the NEW budget after a budget
--     change (a create-only seeding implementation fails).
--   * R75-class traps run the RPC DIRECTLY as authenticated (no API layer in
--     the loop): §7.3-header status gate (forced drafting league — settings
--     locked, exact message + no-write), Q10 overlap pair 15+14 (exact
--     message + no-write), range one-past both directions (12 via
--     seam-consistent 11+12, 17 via 16+17 — the RANGE half refuses).
--   * The status gate has a positive counter-pin: a 'scheduled' league still
--     accepts updates (§7.3 header names BOTH setup and scheduled) — an
--     over-broad gate fails it.
--   * Error messages exact-matched (golden) where the route maps on them.
--   * All privileged fixture work runs BEFORE any JWT claims are set
--     (set_config persists to txn end — D49(7)); mid-test privileged
--     forcing uses `reset role` (013/014 pattern).
--   * §4.2 note: no new table, no policy changes — the no-write-policy
--     pattern has no new target here.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(35);

-- ---------------------------------------------------------------------------
-- A. Shape: function, SECURITY DEFINER + exact search_path, ACLs.
-- ---------------------------------------------------------------------------
select has_function('public', 'update_league_settings',
  array['uuid','integer','jsonb','jsonb','uuid',
        'text','integer','integer','integer','text','integer','text','integer','text'],
  'update_league_settings(14 args — league_id + splitSettings columns + blob + scoring ref) exists');
select is_definer('public', 'update_league_settings',
  array['uuid','integer','jsonb','jsonb','uuid',
        'text','integer','integer','integer','text','integer','text','integer','text'],
  'update_league_settings is SECURITY DEFINER');
select is(
  (select array_to_string(p.proconfig, ',') from pg_proc p
   where p.oid = ('public.update_league_settings(uuid,integer,jsonb,jsonb,uuid,'
     || 'text,integer,integer,integer,text,integer,text,integer,text)')::regprocedure),
  'search_path=""',
  'update_league_settings pins search_path='''' exactly (§12.0; R70 form)');
select ok(
  not has_function_privilege('anon',
    ('public.update_league_settings(uuid,integer,jsonb,jsonb,uuid,'
     || 'text,integer,integer,integer,text,integer,text,integer,text)')::regprocedure, 'EXECUTE'),
  'anon holds no EXECUTE on update_league_settings (061 REVOKE — §4.1)');
select ok(
  has_function_privilege('authenticated',
    ('public.update_league_settings(uuid,integer,jsonb,jsonb,uuid,'
     || 'text,integer,integer,integer,text,integer,text,integer,text)')::regprocedure, 'EXECUTE')
  and has_function_privilege('service_role',
    ('public.update_league_settings(uuid,integer,jsonb,jsonb,uuid,'
     || 'text,integer,integer,integer,text,integer,text,integer,text)')::regprocedure, 'EXECUTE'),
  'authenticated + service_role keep EXECUTE (in-body checks are the gate)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — BEFORE any claims, D49(7)).
--    u1 = commissioner-to-be; u2 = outsider + owner of a PERSONAL scoring
--    system (the v1 templates-only negative).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '88000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-ul1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "ul_commish_one"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '88000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-ul2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "ul_outsider_two"}', now(), now());

insert into scoring_systems (id, owner_id, name, rules) values
  ('5d000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000002',
   'pgtap-ul-personal-system', '{"passing_yards": 0.05}'::jsonb);

-- ---------------------------------------------------------------------------
-- C. anon: EXECUTE revoked (behavioral half of the ACL pin).
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select throws_ok(
  $$ select update_league_settings('ea000000-0000-4000-8000-0000000000aa', 12,
       '{}'::jsonb, '{}'::jsonb, null,
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  '42501', null,
  'anon cannot even EXECUTE update_league_settings (061 REVOKE)');

-- ---------------------------------------------------------------------------
-- D. u1 (authenticated commissioner): create via create_league, then update.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "88000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

create temp table _cl as
select public.create_league(
  'pgtap-update-league', 2026, 12,
  '{"divisions": 1, "median_game": false}'::jsonb,
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
  (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
  'Update Crushers',
  'ad100000-0000-4000-8000-000000000001',
  'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff'
) as r;

-- 1. Happy full update: EVERY typed column changed to a distinctive literal;
--    p_scoring_system_id NULL (keep current); faab_budget 100 → 250.
--    (114 / L.D1.5b: `lineup_lock` has ONE legal value — `per_player_kickoff`,
--    CHECK-enforced — so it is the one typed column that cannot change; the
--    retired value's 23514 through this RPC is pinned in 062.)
select lives_ok(
  $$ select public.update_league_settings(
       (select (r->>'league_id')::uuid from _cl), 14,
       '{"divisions": 2, "second_opponent": true, "draft": {"draft_type": "auction"}}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 3}], "bench": 5, "ir_slots": [], "swap_spots": 1}'::jsonb,
       null,
       'redraft', 13, 4, 14, 'rolling_priority', 250, 'league_vote', 10, 'per_player_kickoff') $$,
  'the commissioner updates settings (full column + blob write)');

select results_eq(
  $$ select team_count, max_teams, format, regular_season_weeks, playoff_teams,
            playoff_start_week, waiver_type, faab_budget, trade_review,
            trade_deadline_week, lineup_lock, status
     from leagues where creation_action_id = 'ad100000-0000-4000-8000-000000000001' $$,
  $$ values (14, 14, 'redraft', 13, 4, 14, 'rolling_priority', 250, 'league_vote',
             10, 'per_player_kickoff', 'setup') $$,
  'every §12.1 typed column stored as passed; max_teams = team_count in the SAME statement (the sync''s second writer, §12.1 NOTE)');
select is(
  (select settings from leagues where creation_action_id = 'ad100000-0000-4000-8000-000000000001'),
  '{"divisions": 2, "second_opponent": true, "draft": {"draft_type": "auction"}}'::jsonb,
  'settings blob stored EXACTLY as passed — the RPC never re-splits or reshapes (D60 authority)');
select is(
  (select roster_settings from leagues where creation_action_id = 'ad100000-0000-4000-8000-000000000001'),
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 3}], "bench": 5, "ir_slots": [], "swap_spots": 1}'::jsonb,
  'roster_settings stored exactly as passed');
select is(
  (select scoring_system_id from leagues where creation_action_id = 'ad100000-0000-4000-8000-000000000001'),
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  'p_scoring_system_id NULL keeps the current reference (counter-pin)');
select ok(
  (select scoring_rules_snapshot from leagues where creation_action_id = 'ad100000-0000-4000-8000-000000000001') is null,
  'snapshot still NULL after a no-scoring-change update (no premature freeze)');

-- §12.2 re-seed: the budget changed 100 → 250, so every seat's faab_balance
-- re-seeds to the new budget (pre-draft, balances carry no history — D70).
select results_eq(
  $$ select lm.faab_balance from league_members lm
     join leagues l on l.id = lm.league_id
     where l.creation_action_id = 'ad100000-0000-4000-8000-000000000001' $$,
  $$ values (250) $$,
  'faab_balance re-seeded to the NEW budget on a budget change (§12.2 invariant, D70)');

-- 2. Scoring change with a NULL snapshot: reference moves, snapshot stays NULL.
select lives_ok(
  $$ select public.update_league_settings(
       (select (r->>'league_id')::uuid from _cl), 14,
       '{"divisions": 2, "second_opponent": true, "draft": {"draft_type": "auction"}}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 3}], "bench": 5, "ir_slots": [], "swap_spots": 1}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'Yahoo Standard'),
       'redraft', 13, 4, 14, 'rolling_priority', 250, 'league_vote', 10, 'per_player_kickoff') $$,
  'the commissioner switches the scoring template (§7.3.3 template choice)');
select is(
  (select scoring_system_id from leagues where creation_action_id = 'ad100000-0000-4000-8000-000000000001'),
  (select id from scoring_systems where is_template and name = 'Yahoo Standard'),
  'scoring_system_id updated to the new template');
select ok(
  (select scoring_rules_snapshot from leagues where creation_action_id = 'ad100000-0000-4000-8000-000000000001') is null,
  'a scoring change with NO existing snapshot leaves it NULL (draft-start freeze is M2''s)');

-- 3. Pre-draft re-freeze (§7.3.3 "on any commissioner scoring change"):
--    freeze first (legal in setup, 059/R69), then change scoring — the
--    snapshot must follow the NEW template.
select lives_ok(
  $$ select public.snapshot_league_scoring((select (r->>'league_id')::uuid from _cl)) $$,
  'pre-draft freeze via snapshot_league_scoring (setup — legal per 059/R69)');
select is(
  (select scoring_rules_snapshot from leagues where creation_action_id = 'ad100000-0000-4000-8000-000000000001'),
  (select rules from scoring_systems where is_template and name = 'Yahoo Standard'),
  'frozen snapshot deep-equals the current (Yahoo Standard) template rules');
select lives_ok(
  $$ select public.update_league_settings(
       (select (r->>'league_id')::uuid from _cl), 14,
       '{"divisions": 2, "second_opponent": true, "draft": {"draft_type": "auction"}}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 3}], "bench": 5, "ir_slots": [], "swap_spots": 1}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'Sleeper Standard'),
       'redraft', 13, 4, 14, 'rolling_priority', 250, 'league_vote', 10, 'per_player_kickoff') $$,
  'scoring changes again WITH an existing snapshot');
select is(
  (select scoring_rules_snapshot from leagues where creation_action_id = 'ad100000-0000-4000-8000-000000000001'),
  (select rules from scoring_systems where is_template and name = 'Sleeper Standard'),
  'the existing snapshot is RE-FROZEN to the NEW template''s rules (§7.3.3 — a keep-the-old implementation fails)');

-- 4. ATTACHABLE-SCOPE negative (§7.3.8 v2.11 via D169; was "v1 templates-only",
--    §7.3.3): a personal system refused, no write.
--    **The MESSAGE was hand-cleared once, 2026-08-26 by SE.5 (migration 105 §6).**
--    061's step 5 now admits a template OR the league's own currently-referenced
--    row, so the refusal it raises is re-cited to §7.3.8 v2.11 and names both
--    admissible shapes. What this cell measures is unchanged and is the point:
--    a PERSONAL row is still refused, and the next cell still proves no write
--    landed. The fixture id here is neither a template nor this league's
--    reference, so it falls outside BOTH arms — which is exactly the case D169
--    left alone.
select throws_ok(
  $$ select public.update_league_settings(
       (select (r->>'league_id')::uuid from _cl), 14,
       '{}'::jsonb, '{"bench": 5}'::jsonb,
       '5d000000-0000-4000-8000-000000000001',
       'redraft', 13, 4, 14, 'rolling_priority', 250, 'league_vote', 10, 'per_player_kickoff') $$,
  'P0001',
  'update_league_settings: scoring_system_id must reference one of the scoring templates, or the league''s own forked custom scoring system — personal scoring systems and other leagues'' systems cannot be attached (§7.3.8 v2.11, §7.3.3.1)',
  'a personal (owner-scoped, non-template) scoring_systems id is rejected with the friendly field-named message (§7.3.8 v2.11 wording after D169)');
select is(
  (select scoring_system_id from leagues where creation_action_id = 'ad100000-0000-4000-8000-000000000001'),
  (select id from scoring_systems where is_template and name = 'Sleeper Standard'),
  'NO write on the rejected personal-scoring update (scoring reference unchanged)');

-- 5. R75-class Q10 traps — direct RPC as authenticated, no API layer.
select throws_ok(
  $$ select public.update_league_settings(
       (select (r->>'league_id')::uuid from _cl), 14,
       '{}'::jsonb, '{"bench": 5}'::jsonb, null,
       'redraft', 15, 4, 14, 'rolling_priority', 250, 'league_vote', 10, 'per_player_kickoff') $$,
  'P0001',
  'update_league_settings: playoff_start_week must be the week after the regular season ends — week 16 for a 15-week regular season (currently week 14) (§7.3.8, Q10/v2.8.6)',
  'direct-RPC overlap pair (15+14 — the R75 bypass class) is refused in-body');
select is(
  (select regular_season_weeks from leagues where creation_action_id = 'ad100000-0000-4000-8000-000000000001'),
  13,
  'NO write on the refused overlap pair (regular_season_weeks unchanged)');
select throws_ok(
  $$ select public.update_league_settings(
       (select (r->>'league_id')::uuid from _cl), 14,
       '{}'::jsonb, '{"bench": 5}'::jsonb, null,
       'redraft', 11, 4, 12, 'rolling_priority', 250, 'league_vote', 10, 'per_player_kickoff') $$,
  'P0001',
  'update_league_settings: playoff_start_week must be between 13 and 16 (currently week 12) (§7.3.1, Q10/v2.8.6)',
  'playoff_start_week 12 (one past the low edge, seam-consistent 11+12) hits the range backstop');
select throws_ok(
  $$ select public.update_league_settings(
       (select (r->>'league_id')::uuid from _cl), 14,
       '{}'::jsonb, '{"bench": 5}'::jsonb, null,
       'redraft', 16, 4, 17, 'rolling_priority', 250, 'league_vote', 10, 'per_player_kickoff') $$,
  'P0001',
  'update_league_settings: playoff_start_week must be between 13 and 16 (currently week 17) (§7.3.1, Q10/v2.8.6)',
  'playoff_start_week 17 (one past the high edge, seam-consistent 16+17) hits the range backstop');

-- 6. 040's team_count CHECK surfaces through the RPC (DB backstop).
select throws_ok(
  $$ select public.update_league_settings(
       (select (r->>'league_id')::uuid from _cl), 9,
       '{}'::jsonb, '{"bench": 5}'::jsonb, null,
       'redraft', 13, 4, 14, 'rolling_priority', 250, 'league_vote', 10, 'per_player_kickoff') $$,
  '23514', null,
  'team_count 9 violates the v1 {8,10,12,14,16} CHECK (23514) through the RPC');

-- ---------------------------------------------------------------------------
-- E. §7.3-header status gate: forced drafting league refuses settings writes
--    (exact message → the route's 409); scheduled still accepts (counter-pin).
-- ---------------------------------------------------------------------------
reset role;
update leagues
set scoring_rules_snapshot = '{"receptions": 1}'::jsonb, status = 'drafting'
where creation_action_id = 'ad100000-0000-4000-8000-000000000001';

set local role authenticated;
select throws_ok(
  $$ select public.update_league_settings(
       (select (r->>'league_id')::uuid from _cl), 14,
       '{}'::jsonb, '{"bench": 5}'::jsonb, null,
       'redraft', 13, 4, 14, 'rolling_priority', 250, 'league_vote', 10, 'per_player_kickoff') $$,
  'P0001',
  'update_league_settings: league ' ||
    (select (r->>'league_id') from _cl) ||
    ' is in drafting — settings are locked once the draft starts; post-draft changes are audited commissioner overrides (M6) (§7.3)',
  'settings are LOCKED in drafting — the §7.3-header gate refuses in-body (the route maps this to 409)');
select is(
  (select settings from leagues where creation_action_id = 'ad100000-0000-4000-8000-000000000001'),
  '{"divisions": 2, "second_opponent": true, "draft": {"draft_type": "auction"}}'::jsonb,
  'NO write on the refused mid-draft update (blob unchanged)');

reset role;
update leagues set status = 'scheduled'
where creation_action_id = 'ad100000-0000-4000-8000-000000000001';

set local role authenticated;
select lives_ok(
  $$ select public.update_league_settings(
       (select (r->>'league_id')::uuid from _cl), 12,
       '{"divisions": 1}'::jsonb, '{"bench": 6}'::jsonb, null,
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'a SCHEDULED league still accepts settings updates (§7.3 header names setup AND scheduled — over-broad gate fails here)');
select results_eq(
  $$ select team_count, max_teams from leagues
     where creation_action_id = 'ad100000-0000-4000-8000-000000000001' $$,
  $$ values (12, 12) $$,
  'the scheduled-state update landed (team_count + max_teams re-synced to 12)');

-- ---------------------------------------------------------------------------
-- F. u2 (non-commish): denied; nonexistent league leaks nothing.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "88000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

select throws_ok(
  $$ select public.update_league_settings(
       (select (r->>'league_id')::uuid from _cl), 12,
       '{}'::jsonb, '{"bench": 6}'::jsonb, null,
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  '42501',
  'update_league_settings: not a commissioner of this league',
  'a non-member cannot update settings (42501, exact message)');
select throws_ok(
  $$ select public.update_league_settings(
       'ea000000-0000-4000-8000-00000000dead', 12,
       '{}'::jsonb, '{"bench": 6}'::jsonb, null,
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  '42501',
  'update_league_settings: not a commissioner of this league',
  'nonexistent league yields the SAME 42501 — no existence leak');

-- ---------------------------------------------------------------------------
-- G. Soft-deleted league: not found (P0002).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "88000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.soft_delete_league((select (r->>'league_id')::uuid from _cl)) $$,
  'the commissioner soft-deletes the league');
select throws_ok(
  $$ select public.update_league_settings(
       (select (r->>'league_id')::uuid from _cl), 12,
       '{}'::jsonb, '{"bench": 6}'::jsonb, null,
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'P0002', null,
  'a soft-deleted league is NOT FOUND (P0002) — membership survives but the row is gone from the RPC''s view');

select * from finish();
rollback;
