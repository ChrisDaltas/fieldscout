-- ============================================================================
-- snapshot_league_scoring + set_league_status + D43 lifecycle guard —
-- migration 059 (spec §7.3.3/§7.3.8 final bullet/§7.1; task L.A1.11;
-- PROGRESS D43/D63; standing rules tasks-M1 §4). pgTAP file is **013** —
-- the task text's "pgTAP 011" predates two renumberings (011 = box-score
-- columns, 012 = scoring templates); next free confirmed at task time.
--
-- Falsifiability notes (§4.3):
--   * The force-transition probes run in the POSTGRES context — proving the
--     D43 guard catches even privileged paths (BYPASSRLS does not bypass
--     triggers). All four guarded statuses probed, plus the born-in-drafting
--     INSERT and the snapshot-nulling-while-drafting UPDATE (the §7.3.8
--     "must ALWAYS have" invariant, not just the transition edge).
--   * Counter-pin: a privileged INSERT/UPDATE into 'drafting' WITH a
--     snapshot succeeds — the guard checks the snapshot, it does not
--     blanket-refuse draft states (a trigger that always raises would pass
--     the probes above and fail here).
--   * Snapshot golden pins are the COMPLETE rules JSONB as stored literals
--     (the same literals pgTAP 012 pins on the seed rows) — the RPC's copy
--     is cross-pinned against 058's source of truth, both pre- and
--     post-re-snapshot (overwrite proven against a COALESCE-style
--     keep-the-old-snapshot implementation).
--   * Error messages are exact-matched (golden), not just SQLSTATE-matched —
--     two different P0001 raises cannot satisfy each other's probes.
--   * Boundary values for the draft_scheduled_at presence check: missing
--     key, jsonb null, empty string (all refuse), garbage date (22007),
--     valid instant (succeeds) — the exact edge and one past it.
--   * All privileged fixture work runs BEFORE any JWT claims are set
--     (set_config persists to txn end — D49(7)); the mid-test privileged
--     tweaks (settings/scoring_system_id flips) use `reset role`, which is
--     safe here because nothing in the touched paths consults auth.*.
--   * The deliberate-break probe (DoD): ALTER TABLE leagues DISABLE TRIGGER
--     trg_leagues_snapshot_guard → the force-transition probes fail (shown
--     in the session log, then re-enabled and re-proven green).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(51);

-- ---------------------------------------------------------------------------
-- A. Shape: functions, SECURITY DEFINER + search_path, ACLs, trigger, CHECK.
-- ---------------------------------------------------------------------------
select has_function('public', 'snapshot_league_scoring', array['uuid'],
  'snapshot_league_scoring(uuid) exists');
select has_function('public', 'set_league_status', array['uuid', 'text'],
  'set_league_status(uuid, text) exists');
select is_definer('public', 'snapshot_league_scoring', array['uuid'],
  'snapshot_league_scoring is SECURITY DEFINER');
select is_definer('public', 'set_league_status', array['uuid', 'text'],
  'set_league_status is SECURITY DEFINER');

select ok(
  (select array_to_string(p.proconfig, ',') from pg_proc p
   where p.oid = 'public.snapshot_league_scoring(uuid)'::regprocedure) ~ 'search_path=',
  'snapshot_league_scoring pins search_path (spec §12.0 hardening)');
select ok(
  (select array_to_string(p.proconfig, ',') from pg_proc p
   where p.oid = 'public.set_league_status(uuid,text)'::regprocedure) ~ 'search_path=',
  'set_league_status pins search_path');
select ok(
  (select array_to_string(p.proconfig, ',') from pg_proc p
   where p.oid = 'public.leagues_snapshot_guard()'::regprocedure) ~ 'search_path=',
  'leagues_snapshot_guard pins search_path (D49(3) plain-trigger-fn pattern)');

select ok(
  not has_function_privilege('anon', 'public.snapshot_league_scoring(uuid)', 'EXECUTE'),
  'anon holds no EXECUTE on snapshot_league_scoring (059 REVOKE — §4.1)');
select ok(
  not has_function_privilege('anon', 'public.set_league_status(uuid,text)', 'EXECUTE'),
  'anon holds no EXECUTE on set_league_status');
select ok(
  has_function_privilege('authenticated', 'public.snapshot_league_scoring(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_league_status(uuid,text)', 'EXECUTE'),
  'authenticated keeps EXECUTE on both (in-body checks are the gate)');
select ok(
  has_function_privilege('service_role', 'public.snapshot_league_scoring(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.set_league_status(uuid,text)', 'EXECUTE'),
  'service_role keeps EXECUTE on both');

select is(
  (select pg_get_triggerdef(oid) from pg_trigger
   where tgrelid = 'public.leagues'::regclass and tgname = 'trg_leagues_snapshot_guard'),
  'CREATE TRIGGER trg_leagues_snapshot_guard BEFORE INSERT OR UPDATE ON public.leagues FOR EACH ROW EXECUTE FUNCTION leagues_snapshot_guard()',
  'D43 guard trigger pinned verbatim from pg_get_triggerdef (BEFORE INSERT OR UPDATE — a narrowed rebuild fails here)');

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.leagues'::regclass and conname = 'leagues_status_valid'),
  'CHECK ((status = ANY (ARRAY[''setup''::text, ''scheduled''::text, ''drafting''::text, ''in_season''::text, ''playoffs''::text, ''complete''::text])))',
  '§7.1 status enum CHECK pinned verbatim (closes the R43 gap on leagues.status)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — BEFORE any claims, D49(7)).
--    u1 = commissioner of L1 + L2; u2 = plain manager in L1; u3 = outsider.
--    L1 references the seeded ESPN Standard template; L2 has no scoring ref.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '76000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-lc1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lc_commish_one"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '76000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-lc2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lc_member_two"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '76000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'pgtap-lc3@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lc_outsider3"}', now(), now());

insert into leagues (id, owner_id, name, season, scoring_system_id) values
  ('ea000000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000001',
   'pgtap-lifecycle-league', 2026,
   (select id from scoring_systems where is_template and name = 'ESPN Standard')),
  ('ea000000-0000-4000-8000-000000000002', '76000000-0000-4000-8000-000000000001',
   'pgtap-lifecycle-noscoring', 2026, null);

insert into league_members (league_id, user_id, role) values
  ('ea000000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000001', 'commissioner'),
  ('ea000000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000002', 'manager'),
  ('ea000000-0000-4000-8000-000000000002', '76000000-0000-4000-8000-000000000001', 'commissioner');

-- ---------------------------------------------------------------------------
-- C. The D43 guard against the PRIVILEGED path (postgres — task item 3's
--    headline probe: even service-role-class direct DML cannot force a
--    snapshotless league into drafting+).
-- ---------------------------------------------------------------------------
select is(
  (select status from leagues where id = 'ea000000-0000-4000-8000-000000000001'),
  'setup',
  'L1 starts in setup with a NULL snapshot (fixture pin for the force probes)');

select throws_ok(
  $$ update leagues set status = 'drafting'
     where id = 'ea000000-0000-4000-8000-000000000001' $$,
  'P0001',
  'league ea000000-0000-4000-8000-000000000001: cannot be in status drafting without scoring_rules_snapshot — call snapshot_league_scoring first (spec §7.3.8/D43)',
  'FORCED setup → drafting without snapshot raises — even for postgres (D43: triggers ignore BYPASSRLS)');
select throws_ok(
  $$ update leagues set status = 'in_season'
     where id = 'ea000000-0000-4000-8000-000000000001' $$,
  'P0001', null,
  'forced → in_season without snapshot raises');
select throws_ok(
  $$ update leagues set status = 'playoffs'
     where id = 'ea000000-0000-4000-8000-000000000001' $$,
  'P0001', null,
  'forced → playoffs without snapshot raises');
select throws_ok(
  $$ update leagues set status = 'complete'
     where id = 'ea000000-0000-4000-8000-000000000001' $$,
  'P0001', null,
  'forced → complete without snapshot raises');

select throws_ok(
  $$ insert into leagues (id, owner_id, name, season, status) values
     ('ea000000-0000-4000-8000-00000000000f', '76000000-0000-4000-8000-000000000001',
      'pgtap-born-drafting', 2026, 'drafting') $$,
  'P0001', null,
  'a league INSERTed directly into drafting with no snapshot raises (the BEFORE INSERT half of the guard)');

select throws_ok(
  $$ update leagues set status = 'banana'
     where id = 'ea000000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'a non-§7.1 status value violates leagues_status_valid (23514)');

-- Counter-pin: WITH a snapshot the privileged transition works — the guard
-- checks the invariant, it does not blanket-refuse draft states.
select lives_ok(
  $$ update leagues
     set scoring_rules_snapshot = '{"pass_yards": 0.04}'::jsonb, status = 'drafting'
     where id = 'ea000000-0000-4000-8000-000000000001' $$,
  'privileged setup → drafting WITH snapshot succeeds (counter-pin: an always-raise trigger fails here)');

select throws_ok(
  $$ update leagues set scoring_rules_snapshot = null
     where id = 'ea000000-0000-4000-8000-000000000001' $$,
  'P0001', null,
  'nulling the snapshot while drafting raises — §7.3.8 is "must ALWAYS have", not just a transition edge');

-- Reset L1 to the pre-draft state for the RPC phases.
update leagues set status = 'setup', scoring_rules_snapshot = null
where id = 'ea000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- D. anon: EXECUTE revoked on both RPCs (behavioral half of the ACL pins).
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select throws_ok(
  $$ select snapshot_league_scoring('ea000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'anon cannot even EXECUTE snapshot_league_scoring (059 REVOKE)');
select throws_ok(
  $$ select set_league_status('ea000000-0000-4000-8000-000000000001', 'scheduled') $$,
  '42501', null,
  'anon cannot even EXECUTE set_league_status');

-- ---------------------------------------------------------------------------
-- E. u3 (authenticated outsider): in-body commish check refuses both.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "76000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);

select throws_ok(
  $$ select snapshot_league_scoring('ea000000-0000-4000-8000-000000000001') $$,
  '42501',
  'snapshot_league_scoring: not a commissioner of this league',
  'outsider denied snapshot (in-body 42501)');
select throws_ok(
  $$ select set_league_status('ea000000-0000-4000-8000-000000000001', 'scheduled') $$,
  '42501',
  'set_league_status: not a commissioner of this league',
  'outsider denied set_league_status');

-- ---------------------------------------------------------------------------
-- F. u2 (member, role=manager): membership is NOT enough — commish only.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "76000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

select is(
  (select count(*) from leagues where id = 'ea000000-0000-4000-8000-000000000001'),
  1::bigint,
  'u2 CAN see L1 (member SELECT — so the denials below are auth, not visibility)');
select throws_ok(
  $$ select snapshot_league_scoring('ea000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'plain manager denied snapshot (commish-only, task item 3)');
select throws_ok(
  $$ select set_league_status('ea000000-0000-4000-8000-000000000001', 'scheduled') $$,
  '42501', null,
  'plain manager denied set_league_status');

-- ---------------------------------------------------------------------------
-- G. u1 (commissioner): set_league_status — §7.1 transitions available in M1.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "76000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

-- G1. setup → scheduled requires draft_scheduled_at: boundary sweep.
select throws_ok(
  $$ select set_league_status('ea000000-0000-4000-8000-000000000001', 'scheduled') $$,
  'P0001',
  'set_league_status: cannot schedule league ea000000-0000-4000-8000-000000000001 — settings.draft_scheduled_at is not set (§7.1: scheduled means the draft has a date/time)',
  'setup → scheduled with the key MISSING refuses (exact message — golden)');

reset role;
update leagues set settings = '{"draft_scheduled_at": null}'::jsonb
where id = 'ea000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok(
  $$ select set_league_status('ea000000-0000-4000-8000-000000000001', 'scheduled') $$,
  'P0001', null,
  'jsonb null draft_scheduled_at refuses (boundary)');

reset role;
update leagues set settings = '{"draft_scheduled_at": ""}'::jsonb
where id = 'ea000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok(
  $$ select set_league_status('ea000000-0000-4000-8000-000000000001', 'scheduled') $$,
  'P0001', null,
  'empty-string draft_scheduled_at refuses (boundary — NULLIF guard)');

reset role;
update leagues set settings = '{"draft_scheduled_at": "not-a-date"}'::jsonb
where id = 'ea000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok(
  $$ select set_league_status('ea000000-0000-4000-8000-000000000001', 'scheduled') $$,
  '22007', null,
  'garbage draft_scheduled_at raises loudly on the timestamptz cast (22007 — corrupt state never reaches scheduled)');

reset role;
update leagues set settings = '{"draft_scheduled_at": "2026-09-13T19:00:00+00:00"}'::jsonb
where id = 'ea000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok(
  $$ select set_league_status('ea000000-0000-4000-8000-000000000001', 'scheduled') $$,
  'setup → scheduled with a real draft instant succeeds (one past the boundary)');
select is(
  (select status from leagues where id = 'ea000000-0000-4000-8000-000000000001'),
  'scheduled',
  'status is scheduled after the transition (golden)');

-- G2. Idempotent no-op + the backward §7.1 move.
select lives_ok(
  $$ select set_league_status('ea000000-0000-4000-8000-000000000001', 'scheduled') $$,
  'scheduled → scheduled is an idempotent no-op success (retry-safe, D63)');
select lives_ok(
  $$ select set_league_status('ea000000-0000-4000-8000-000000000001', 'setup') $$,
  'scheduled → setup works (§7.1 backward move, pre-draft)');
select is(
  (select status from leagues where id = 'ea000000-0000-4000-8000-000000000001'),
  'setup',
  'status is back to setup (golden)');

-- G3. M1 refuses drafting+ even for the commissioner.
select throws_ok(
  $$ select set_league_status('ea000000-0000-4000-8000-000000000001', 'drafting') $$,
  'P0001',
  'set_league_status: cannot move league ea000000-0000-4000-8000-000000000001 to drafting — the draft engine lands in M2; only setup ↔ scheduled are available',
  'commissioner cannot reach drafting via set_league_status (M2''s draft_start is the sanctioned path — exact message)');
select throws_ok(
  $$ select set_league_status('ea000000-0000-4000-8000-000000000001', 'complete') $$,
  'P0001', null,
  '→ complete refused the same way');
select throws_ok(
  $$ select set_league_status('ea000000-0000-4000-8000-000000000001', 'banana') $$,
  '22023', null,
  'a non-§7.1 status literal is rejected before any state is read (22023)');
select throws_ok(
  $$ select set_league_status('00000000-0000-4000-8000-0000000000ff', 'scheduled') $$,
  '42501', null,
  'a nonexistent league yields the same 42501 as non-commish (no existence leak)');

-- ---------------------------------------------------------------------------
-- H. u1 (commissioner): snapshot_league_scoring — freeze, loud-NULL, overwrite.
-- ---------------------------------------------------------------------------
select is(
  (select scoring_rules_snapshot from leagues where id = 'ea000000-0000-4000-8000-000000000001'),
  null::jsonb,
  'L1 snapshot is NULL before the first freeze (SELECT-sees pin)');

select lives_ok(
  $$ select snapshot_league_scoring('ea000000-0000-4000-8000-000000000001') $$,
  'commissioner freezes the snapshot');

select is(
  (select scoring_rules_snapshot from leagues where id = 'ea000000-0000-4000-8000-000000000001'),
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
  'snapshot equals the COMPLETE ESPN Standard rules literal (stored literal — cross-pins the 058 seed through the RPC)');

-- Boundary: pre-draft scoring change → re-snapshot OVERWRITES (task item 3).
reset role;
update leagues
set scoring_system_id = (select id from scoring_systems where is_template and name = 'Yahoo Standard')
where id = 'ea000000-0000-4000-8000-000000000001';
set local role authenticated;

select lives_ok(
  $$ select snapshot_league_scoring('ea000000-0000-4000-8000-000000000001') $$,
  're-snapshot after a pre-draft scoring change succeeds');
select is(
  (select scoring_rules_snapshot from leagues where id = 'ea000000-0000-4000-8000-000000000001'),
  '{"pass_yards": 0.04, "pass_tds": 4, "interceptions": -1, "pass_2pt": 2,
    "rush_yards": 0.1, "rush_tds": 6, "rush_2pt": 2,
    "receptions": 0, "receiving_yards": 0.1, "receiving_tds": 6, "rec_2pt": 2,
    "fumbles_lost": -2, "fumble_recovery_td": 6, "return_td": 6,
    "fg_0_39": 3, "fg_40_49": 4, "fg_50_plus": 5, "pat_made": 1,
    "def_sack": 1, "def_int": 2, "def_fumble_rec": 2, "def_td": 6,
    "def_safety": 2, "def_block": 2, "def_return_td": 6,
    "def_pa_0": 10, "def_pa_1_6": 7, "def_pa_7_13": 4, "def_pa_14_20": 1,
    "def_pa_21_27": 0, "def_pa_28_34": -1, "def_pa_35_plus": -4}'::jsonb,
  're-snapshot OVERWROTE with the full Yahoo Standard literal (a keep-the-old COALESCE implementation fails this)');

-- L2 has no scoring_system_id: LOUD refusal, never a silent NULL write.
select throws_ok(
  $$ select snapshot_league_scoring('ea000000-0000-4000-8000-000000000002') $$,
  'P0001',
  'snapshot_league_scoring: league ea000000-0000-4000-8000-000000000002 has no scoring_system_id — nothing to snapshot (§7.3.8: exactly one scoring system referenced)',
  'NULL scoring_system_id refuses loudly (exact message — the task''s never-silently-NULL pin)');
select is(
  (select scoring_rules_snapshot from leagues where id = 'ea000000-0000-4000-8000-000000000002'),
  null::jsonb,
  'the refused league''s snapshot stays NULL — nothing was written');

-- Soft-deleted league = not found (both RPCs).
reset role;
update leagues set deleted_at = now()
where id = 'ea000000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok(
  $$ select snapshot_league_scoring('ea000000-0000-4000-8000-000000000002') $$,
  'P0002', null,
  'a soft-deleted league is not found to snapshot (P0002)');
select throws_ok(
  $$ select set_league_status('ea000000-0000-4000-8000-000000000002', 'scheduled') $$,
  'P0002', null,
  'a soft-deleted league is not found to transition (P0002)');

select * from finish();
rollback;
