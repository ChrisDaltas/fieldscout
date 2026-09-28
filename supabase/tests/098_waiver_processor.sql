-- ============================================================================
-- The waiver processor + tick — pgTAP 098 (M5 task L.D2.9; migration 150;
-- spec §13.2 / §14 / §7.2.1(c) v2.16.60; PROGRESS F407 / F408 / F411 / F416 /
-- F417 / F421 / F422 / F423, D406).
--
-- Numbering: reserved 150 / 098 (heads measured 149 / 097).
-- OWN FIXTURE: users 998…, leagues b98…, teams c98…, claims d98…, action ids
-- a98…, players wp-*. The 2026 calendar is pinned INSIDE this transaction
-- (097's shape: weeks 1–7 end on their Tuesday floors, week 8 ends
-- 2026-11-03 08:00Z; one week-8 game, KC–BUF, kicked off Thursday
-- 2026-10-30 00:15Z) and every run / submit happens at an INJECTED instant,
-- so no pin rots with the wall clock. R = Sunday 2026-11-01 12:00Z — a
-- scheduled run of the fixture's daily 12:00 UTC schedule; at R a KC player
-- is locked (kicked off, week not over) and a SEA / DEN player is not (bye).
--
-- Falsifiability (tasks-M1 §4.3):
--   * STORED LITERALS: the run's decision sequence, reasons, balances,
--     rosters, the rolled priority, the seeded / advanced run instants — all
--     worked out by hand from the rules (and equal to what the TS resolver
--     gives the same input — the parity suite proves the twin in general).
--   * BOUNDARY INSTANTS: the tick at R−1s processes nothing; at R it settles.
--   * PER ROLE after processing (E13 / TD3): anon, a non-member, another
--     member, the owner, the commissioner; `waiver_runs` readable by nobody.
--   * BREAK PROBES shown red in the PR, then reverted (see the PR body).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(75);

-- ---------------------------------------------------------------------------
-- A. Form and posture
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s', column_name, data_type, is_nullable), ' ' order by ordinal_position)
   from information_schema.columns where table_schema = 'public' and table_name = 'waiver_runs'),
  'id:uuid:NO league_id:uuid:NO run_at:timestamp with time zone:NO status:text:NO processed_at:timestamp with time zone:YES attempts:integer:NO input:jsonb:YES result:jsonb:YES summary:jsonb:YES last_error:text:YES created_at:timestamp with time zone:NO updated_at:timestamp with time zone:NO',
  'A1 waiver_runs: one row per (league, scheduled run) — settled or refused');
select is(
  (select format('%s:%s', c.relrowsecurity, (select count(*) from pg_policy p where p.polrelid = c.oid))
   from pg_class c where c.oid = 'public.waiver_runs'::regclass),
  't:0', 'A2 waiver_runs has RLS ON and ZERO policies (it names every claim and bid — E13 / TD3)');
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '-'),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('waiver_resolve_run_internal', 'waiver_claim_notify_internal', 'process_waivers_internal',
                                                'waiver_tick', 'waiver_claim_edit', 'waiver_claim_edit_internal',
                                                'waiver_claim_submit_internal', 'waiver_claim_reorder_internal',
                                                'remove_manager', 'leave_league', 'draft_reset')),
  'draft_reset:t:search_path="":f:t leave_league:t:search_path="":f:t process_waivers_internal:f:search_path="":f:f remove_manager:t:search_path="":f:t waiver_claim_edit:t:search_path="":f:t waiver_claim_edit_internal:f:search_path="":f:f waiver_claim_notify_internal:f:search_path="":f:f waiver_claim_reorder_internal:f:search_path="":f:f waiver_claim_submit_internal:f:search_path="":f:f waiver_resolve_run_internal:f:search_path="":f:f waiver_tick:t:search_path="":f:f',
  'A3 one overload each; the doors SECURITY DEFINER (the tick closed to anon AND authenticated — a job), every internal PLAIN and closed to both; search_path empty everywhere');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and a.privilege_type = 'EXECUTE' and a.grantee = 0
      and p.proname in ('waiver_resolve_run_internal', 'waiver_claim_notify_internal', 'process_waivers_internal', 'waiver_tick',
                        'waiver_claim_edit', 'waiver_claim_edit_internal')),
  'A4 PUBLIC holds EXECUTE on none of the new functions');
select is(
  (select format('%s|%s', schedule, command) from cron.job where jobname = 'process-waivers'),
  '* * * * *|SELECT public.waiver_tick()', 'A5 pg_cron runs the tick every minute (TD6)');
select is(
  (select pg_get_constraintdef(c.oid) from pg_constraint c
   where c.conrelid = 'public.waiver_claim_actions'::regclass and c.conname = 'waiver_claim_actions_verb_check'),
  'CHECK ((verb = ANY (ARRAY[''waiver_claim_submit''::text, ''waiver_claim_cancel''::text, ''waiver_claim_reorder''::text, ''waiver_claim_edit''::text])))',
  'A6 the replay ledger admits the edit verb (F417), one namespace');
select throws_ok(
  $$ select public.process_waivers_internal('b9800000-0000-4000-8000-000000000001', null) $$,
  '22023', null, 'A7 the processor refuses a missing p_at BY NAME (the TimeProvider seam — it never reads a clock)');

-- ---------------------------------------------------------------------------
-- B. The SQL twin — the resolver's worked examples as STORED LITERALS (the
--    same literals resolve-waiver-run.test.ts pins in TS)
-- ---------------------------------------------------------------------------
create or replace function pg_temp.summary(p jsonb) returns text language sql as $$
  select string_agg(format('%s %s %s%s $%s', o ->> 'decision', o ->> 'claimId', o ->> 'status',
                           case when o ->> 'reason' is null then '' else ':' || (o ->> 'reason') end, o ->> 'faabSpent'),
                    ' | ' order by (o ->> 'decision')::int)
  from jsonb_array_elements(p -> 'outcomes') o
$$;
create or replace function pg_temp.inp(p_type text, p_tb text, p_teams jsonb, p_claims jsonb, p_draft jsonb,
                                       p_standings jsonb default 'null', p_rolling jsonb default 'null') returns jsonb language sql as $$
  select jsonb_build_object(
    'settings', jsonb_build_object('waiverType', p_type, 'faabTiebreaker', p_tb, 'rosterSize', 10,
                                   'acquisitionsPerWeek', null, 'acquisitionsPerSeason', null),
    'teams', p_teams, 'claims', p_claims,
    'priority', jsonb_build_object('draftOrder', p_draft, 'standings', p_standings, 'rolling', p_rolling),
    'lockedPlayerIds', '[]'::jsonb)
$$;
select is(
  pg_temp.summary(public.waiver_resolve_run_internal(pg_temp.inp('faab', 'reverse_standings',
    '[{"teamId":"A","roster":[],"faabBalance":50,"acquisitionsWeek":0,"acquisitionsSeason":0,"retired":false},
      {"teamId":"B","roster":[],"faabBalance":100,"acquisitionsWeek":0,"acquisitionsSeason":0,"retired":false}]',
    '[{"claimId":"a1","teamId":"A","addPlayerId":"X","dropPlayerId":null,"faabBid":10,"claimOrder":1},
      {"claimId":"a2","teamId":"A","addPlayerId":"Y","dropPlayerId":null,"faabBid":50,"claimOrder":2},
      {"claimId":"b1","teamId":"B","addPlayerId":"Y","dropPlayerId":null,"faabBid":55,"claimOrder":1}]',
    '["A","B"]'))),
  '1 b1 won $55 | 2 a2 lost:outbid $0 | 3 a1 won $10',
  'B1 F422(b) in Chris''s words: "you bid $50, someone else bids $55, you lose that bid and then the $10 bid becomes your top priority"');
select is(
  public.waiver_resolve_run_internal(pg_temp.inp('faab', 'rolling_priority',
    '[{"teamId":"A","roster":[],"faabBalance":100,"acquisitionsWeek":0,"acquisitionsSeason":0,"retired":false},
      {"teamId":"B","roster":[],"faabBalance":100,"acquisitionsWeek":0,"acquisitionsSeason":0,"retired":false}]',
    '[{"claimId":"a1","teamId":"A","addPlayerId":"P","dropPlayerId":null,"faabBid":10,"claimOrder":1},
      {"claimId":"a2","teamId":"A","addPlayerId":"Q","dropPlayerId":null,"faabBid":30,"claimOrder":2},
      {"claimId":"b1","teamId":"B","addPlayerId":"P","dropPlayerId":null,"faabBid":10,"claimOrder":1}]',
    '["A","B"]', 'null', '{"A":1,"B":2}')) - 'teams',
  jsonb_build_object(
    'outcomes', '[{"decision":1,"claimId":"a2","teamId":"A","addPlayerId":"Q","dropPlayerId":null,"status":"won","reason":null,"faabSpent":30},
                  {"decision":2,"claimId":"b1","teamId":"B","addPlayerId":"P","dropPlayerId":null,"status":"won","reason":null,"faabSpent":10},
                  {"decision":3,"claimId":"a1","teamId":"A","addPlayerId":"P","dropPlayerId":null,"status":"lost","reason":"lost_on_priority","faabSpent":0}]'::jsonb,
    'priority', '{"source":"rolling","persists":true,"before":["A","B"],"after":["A","B"]}'::jsonb),
  'B2 F422(a)+(b) — L.D2.8''s R1176 case FLIPPED: A''s $30 is its top choice, the win burns A''s priority, B takes the $10 tie');
select is(
  pg_temp.summary(public.waiver_resolve_run_internal(pg_temp.inp('reverse_standings', 'reverse_standings',
    '[{"teamId":"A","roster":[],"faabBalance":100,"acquisitionsWeek":0,"acquisitionsSeason":0,"retired":false},
      {"teamId":"B","roster":[],"faabBalance":100,"acquisitionsWeek":0,"acquisitionsSeason":0,"retired":false},
      {"teamId":"C","roster":[],"faabBalance":100,"acquisitionsWeek":0,"acquisitionsSeason":0,"retired":false}]',
    '[{"claimId":"b1","teamId":"B","addPlayerId":"P","dropPlayerId":null,"faabBid":0,"claimOrder":1},
      {"claimId":"b2","teamId":"B","addPlayerId":"Q","dropPlayerId":null,"faabBid":0,"claimOrder":2},
      {"claimId":"c1","teamId":"C","addPlayerId":"P","dropPlayerId":null,"faabBid":0,"claimOrder":1},
      {"claimId":"c2","teamId":"C","addPlayerId":"Q","dropPlayerId":null,"faabBid":0,"claimOrder":2}]',
    '["A","B","C"]', '["A","B","C"]'))),
  '1 c1 won $0 | 2 b1 lost:lost_on_priority $0 | 3 b2 won $0 | 4 c2 lost:lost_on_priority $0',
  'B3 F422(a) in a reverse-standings league: last-place C''s win burns its priority for the run, so B takes Q');
select throws_ok(
  $$ select public.waiver_resolve_run_internal(pg_temp.inp('faab', 'reverse_standings',
       '[{"teamId":"A","roster":["P"],"faabBalance":1,"acquisitionsWeek":0,"acquisitionsSeason":0,"retired":false},
         {"teamId":"B","roster":["P"],"faabBalance":1,"acquisitionsWeek":0,"acquisitionsSeason":0,"retired":false}]',
       '[]', '["A","B"]')) $$,
  '22023', 'resolveWaiverRun: player P is on two rosters (A and B) — exclusivity is already broken; refusing to resolve on corrupt rosters',
  'B4 corrupt input is refused BY NAME with the TS twin''s exact words (F421(g))');

-- ---------------------------------------------------------------------------
-- Fixtures (postgres context)
--   u1 commissioner of every league; u2 / u3 / u6 managers; u5 outsider.
--   LF b98…01 FAAB, daily 12:00 UTC, after_waiver_run; roster 1 QB + 4 bench.
--     TA c98…01 (u2)  TB c98…02 (u3)  TC c98…03 (u1)  TS c98…05 (u6)
--     TR c98…04 RETIRED, succeeded by TS (its seat moved there — 120).
--     draft_order [TA, TB, TC, TR] ⇒ reverse draft order [TS, TC, TB, TA].
--   LR b98…02 rolling_priority (RA u2, RB u3, RC u1), draft [RA, RB, RC].
--   LN b98…03 none_fcfs with a claim left pending (NA u2).
--   LU b98…04 FAAB, the catalog schedule, UNTRACKED (NULL next run) (UA u2).
--   LX b98…05 FAAB, a claim from a seat with NO balance on record (XA u2).
--   LE b98…06 FAAB — the claim verbs (EA u2, EB u3, EC u1).
--   LV b98…07 FAAB — vacate / leave (VC u1, VA u2, VB u3).
--   LD b98…08 drafting, a live draft, a stale pending run (DC u1).
-- ---------------------------------------------------------------------------
update nfl_weeks w
set last_game_ends_at = case
      when w.week <= 7 then w.starts_at + interval '6 days 3 hours'
      when w.week = 8 then '2026-11-03 08:00:00+00'::timestamptz
      when w.week = 9 then '2026-11-10 08:00:00+00'::timestamptz
    end,
    first_kickoff_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('wp-g8', 2026, 8, 'KC', 'BUF', '2026-10-30 00:15:00+00');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('99800000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-wp' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'wp_user' || i)::jsonb, now(), now()
from generate_series(1, 6) i;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot,
                     lineup_lock, waiver_type, faab_budget, settings, roster_settings, waiver_next_run_at)
select v.id::uuid, '99800000-0000-4000-8000-000000000001', v.nm, 2026, v.st, 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', v.wt, 100, v.s::jsonb,
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 4, "ir_slots": [], "swap_spots": 0}',
  v.nx::timestamptz
from (values
  ('b9800000-0000-4000-8000-000000000001', 'pgtap-wp-LF', 'in_season', 'faab',
   '{"waiver_run_days": ["sun","mon","tue","wed","thu","fri","sat"], "waiver_run_time": "12:00", "waiver_time_zone": "UTC", "free_agency_opens": "after_waiver_run"}',
   '2026-11-01 12:00:00+00'),
  ('b9800000-0000-4000-8000-000000000002', 'pgtap-wp-LR', 'in_season', 'rolling_priority',
   '{"waiver_run_days": ["sun","mon","tue","wed","thu","fri","sat"], "waiver_run_time": "12:00", "waiver_time_zone": "UTC", "free_agency_opens": "after_waiver_run"}',
   '2026-11-01 12:00:00+00'),
  ('b9800000-0000-4000-8000-000000000003', 'pgtap-wp-LN', 'in_season', 'none_fcfs', '{}', '2026-11-01 12:00:00+00'),
  ('b9800000-0000-4000-8000-000000000004', 'pgtap-wp-LU', 'in_season', 'faab', '{}', null),
  ('b9800000-0000-4000-8000-000000000005', 'pgtap-wp-LX', 'in_season', 'faab',
   '{"waiver_run_days": ["sun","mon","tue","wed","thu","fri","sat"], "waiver_run_time": "12:00", "waiver_time_zone": "UTC"}',
   '2026-11-01 12:00:00+00'),
  ('b9800000-0000-4000-8000-000000000006', 'pgtap-wp-LE', 'in_season', 'faab', '{}', null),
  ('b9800000-0000-4000-8000-000000000007', 'pgtap-wp-LV', 'in_season', 'faab', '{}', null),
  ('b9800000-0000-4000-8000-000000000008', 'pgtap-wp-LD', 'drafting', 'faab', '{}', '2026-11-01 12:00:00+00')
) v(id, nm, st, wt, s, nx);

insert into teams (id, owner_id, name, league_id, status) values
 ('c9800000-0000-4000-8000-000000000001', '99800000-0000-4000-8000-000000000002', 'WP Alpha',   'b9800000-0000-4000-8000-000000000001', 'active'),
 ('c9800000-0000-4000-8000-000000000002', '99800000-0000-4000-8000-000000000003', 'WP Bravo',   'b9800000-0000-4000-8000-000000000001', 'active'),
 ('c9800000-0000-4000-8000-000000000003', '99800000-0000-4000-8000-000000000001', 'WP Charlie', 'b9800000-0000-4000-8000-000000000001', 'active'),
 ('c9800000-0000-4000-8000-000000000004', '99800000-0000-4000-8000-000000000001', 'WP Retired', 'b9800000-0000-4000-8000-000000000001', 'retired'),
 ('c9800000-0000-4000-8000-000000000005', '99800000-0000-4000-8000-000000000006', 'WP Successor', 'b9800000-0000-4000-8000-000000000001', 'active'),
 ('c9800000-0000-4000-8000-000000000011', '99800000-0000-4000-8000-000000000002', 'WP RA', 'b9800000-0000-4000-8000-000000000002', 'active'),
 ('c9800000-0000-4000-8000-000000000012', '99800000-0000-4000-8000-000000000003', 'WP RB', 'b9800000-0000-4000-8000-000000000002', 'active'),
 ('c9800000-0000-4000-8000-000000000013', '99800000-0000-4000-8000-000000000001', 'WP RC', 'b9800000-0000-4000-8000-000000000002', 'active'),
 ('c9800000-0000-4000-8000-000000000021', '99800000-0000-4000-8000-000000000002', 'WP NA', 'b9800000-0000-4000-8000-000000000003', 'active'),
 ('c9800000-0000-4000-8000-000000000031', '99800000-0000-4000-8000-000000000002', 'WP UA', 'b9800000-0000-4000-8000-000000000004', 'active'),
 ('c9800000-0000-4000-8000-000000000041', '99800000-0000-4000-8000-000000000002', 'WP XA', 'b9800000-0000-4000-8000-000000000005', 'active'),
 ('c9800000-0000-4000-8000-000000000051', '99800000-0000-4000-8000-000000000002', 'WP EA', 'b9800000-0000-4000-8000-000000000006', 'active'),
 ('c9800000-0000-4000-8000-000000000052', '99800000-0000-4000-8000-000000000003', 'WP EB', 'b9800000-0000-4000-8000-000000000006', 'active'),
 ('c9800000-0000-4000-8000-000000000053', '99800000-0000-4000-8000-000000000001', 'WP EC', 'b9800000-0000-4000-8000-000000000006', 'active'),
 ('c9800000-0000-4000-8000-000000000061', '99800000-0000-4000-8000-000000000001', 'WP VC', 'b9800000-0000-4000-8000-000000000007', 'active'),
 ('c9800000-0000-4000-8000-000000000062', '99800000-0000-4000-8000-000000000002', 'WP VA', 'b9800000-0000-4000-8000-000000000007', 'active'),
 ('c9800000-0000-4000-8000-000000000063', '99800000-0000-4000-8000-000000000003', 'WP VB', 'b9800000-0000-4000-8000-000000000007', 'active'),
 ('c9800000-0000-4000-8000-000000000071', '99800000-0000-4000-8000-000000000001', 'WP DC', 'b9800000-0000-4000-8000-000000000008', 'active');
update teams set successor_team_id = 'c9800000-0000-4000-8000-000000000005' where id = 'c9800000-0000-4000-8000-000000000004';

insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance) values
 ('b9800000-0000-4000-8000-000000000001', '99800000-0000-4000-8000-000000000002', 'c9800000-0000-4000-8000-000000000001', 'manager',      false, 100),
 ('b9800000-0000-4000-8000-000000000001', '99800000-0000-4000-8000-000000000003', 'c9800000-0000-4000-8000-000000000002', 'manager',      false, 100),
 ('b9800000-0000-4000-8000-000000000001', '99800000-0000-4000-8000-000000000001', 'c9800000-0000-4000-8000-000000000003', 'commissioner', false, 100),
 ('b9800000-0000-4000-8000-000000000001', '99800000-0000-4000-8000-000000000006', 'c9800000-0000-4000-8000-000000000005', 'manager',      false, 100),
 ('b9800000-0000-4000-8000-000000000002', '99800000-0000-4000-8000-000000000002', 'c9800000-0000-4000-8000-000000000011', 'manager',      false, 100),
 ('b9800000-0000-4000-8000-000000000002', '99800000-0000-4000-8000-000000000003', 'c9800000-0000-4000-8000-000000000012', 'manager',      false, 100),
 ('b9800000-0000-4000-8000-000000000002', '99800000-0000-4000-8000-000000000001', 'c9800000-0000-4000-8000-000000000013', 'commissioner', false, 100),
 ('b9800000-0000-4000-8000-000000000003', '99800000-0000-4000-8000-000000000002', 'c9800000-0000-4000-8000-000000000021', 'commissioner', false, 100),
 ('b9800000-0000-4000-8000-000000000004', '99800000-0000-4000-8000-000000000002', 'c9800000-0000-4000-8000-000000000031', 'commissioner', false, 100),
 ('b9800000-0000-4000-8000-000000000005', '99800000-0000-4000-8000-000000000002', 'c9800000-0000-4000-8000-000000000041', 'commissioner', false, null),
 ('b9800000-0000-4000-8000-000000000006', '99800000-0000-4000-8000-000000000002', 'c9800000-0000-4000-8000-000000000051', 'manager',      false, 40),
 ('b9800000-0000-4000-8000-000000000006', '99800000-0000-4000-8000-000000000003', 'c9800000-0000-4000-8000-000000000052', 'manager',      false, 100),
 ('b9800000-0000-4000-8000-000000000006', '99800000-0000-4000-8000-000000000001', 'c9800000-0000-4000-8000-000000000053', 'commissioner', false, 100),
 ('b9800000-0000-4000-8000-000000000007', '99800000-0000-4000-8000-000000000001', 'c9800000-0000-4000-8000-000000000061', 'commissioner', false, 100),
 ('b9800000-0000-4000-8000-000000000007', '99800000-0000-4000-8000-000000000002', 'c9800000-0000-4000-8000-000000000062', 'manager',      false, 100),
 ('b9800000-0000-4000-8000-000000000007', '99800000-0000-4000-8000-000000000003', 'c9800000-0000-4000-8000-000000000063', 'manager',      false, 100),
 ('b9800000-0000-4000-8000-000000000008', '99800000-0000-4000-8000-000000000001', 'c9800000-0000-4000-8000-000000000071', 'commissioner', false, 100);

insert into league_weeks (league_id, season, week)
select l.id, 2026, g from leagues l, generate_series(1, 14) g where l.name like 'pgtap-wp-%' and l.status <> 'drafting';

insert into drafts (league_id, status, completed_at, draft_order) values
 ('b9800000-0000-4000-8000-000000000001', 'complete', '2026-09-06 06:00:00+00',
  '["c9800000-0000-4000-8000-000000000001", "c9800000-0000-4000-8000-000000000002", "c9800000-0000-4000-8000-000000000003", "c9800000-0000-4000-8000-000000000004"]'),
 ('b9800000-0000-4000-8000-000000000002', 'complete', '2026-09-06 06:00:00+00',
  '["c9800000-0000-4000-8000-000000000011", "c9800000-0000-4000-8000-000000000012", "c9800000-0000-4000-8000-000000000013"]'),
 ('b9800000-0000-4000-8000-000000000005', 'complete', '2026-09-06 06:00:00+00', '["c9800000-0000-4000-8000-000000000041"]');
insert into drafts (id, league_id, status) values
 ('e9800000-0000-4000-8000-000000000008', 'b9800000-0000-4000-8000-000000000008', 'live');

insert into players (id, full_name, position, team, status) values
 ('wp-x', 'WP Ex', 'WR', 'SEA', 'Active'),
 ('wp-y', 'WP Why', 'WR', 'SEA', 'Active'),
 ('wp-z', 'WP Zed', 'WR', 'SEA', 'Active'),
 ('wp-k', 'WP Kay', 'WR', 'KC', 'Active'),       -- kicked off Thursday of week 8
 ('wp-kd', 'WP Kay Drop', 'RB', 'KC', 'Active'),
 ('wp-cold', 'WP Cold', 'QB', 'DEN', 'Active'),
 ('wp-a1', 'WP A1', 'RB', 'DEN', 'Active'),
 ('wp-b1', 'WP B1', 'RB', 'DEN', 'Active'),
 ('wp-r1', 'WP R1', 'WR', 'SEA', 'Active'),
 ('wp-r2', 'WP R2', 'WR', 'SEA', 'Active'),
 ('wp-r3', 'WP R3', 'WR', 'SEA', 'Active'),
 ('wp-e1', 'WP E1', 'WR', 'SEA', 'Active'),
 ('wp-e2', 'WP E2', 'WR', 'SEA', 'Active'),
 ('wp-e3', 'WP E3', 'WR', 'SEA', 'Active'),
 ('wp-ed', 'WP ED', 'RB', 'DEN', 'Active'),
 ('wp-n1', 'WP N1', 'WR', 'SEA', 'Active');

insert into league_rosters (league_id, team_id, player_id, slot_key) values
 ('b9800000-0000-4000-8000-000000000001', 'c9800000-0000-4000-8000-000000000001', 'wp-a1', 'bn'),
 ('b9800000-0000-4000-8000-000000000001', 'c9800000-0000-4000-8000-000000000002', 'wp-b1', 'bn'),
 ('b9800000-0000-4000-8000-000000000001', 'c9800000-0000-4000-8000-000000000003', 'wp-cold', 'qb'),
 ('b9800000-0000-4000-8000-000000000001', 'c9800000-0000-4000-8000-000000000005', 'wp-kd', 'bn'),
 ('b9800000-0000-4000-8000-000000000006', 'c9800000-0000-4000-8000-000000000051', 'wp-ed', 'bn');
insert into team_lineups (team_id, season, week, starters, bench, slot_map) values
 ('c9800000-0000-4000-8000-000000000003', 2026, 8,
  '[{"slot": "qb", "player_id": "wp-cold", "position": "QB", "kickoff_at": null, "flags": []}]', '[]', '{"qb": "wp-cold"}');

-- LF's pending claims (placed earlier through the verb — written directly
-- here so the retired team's leftover claim can exist; TD9 ids chosen so the
-- id order is the listing order).
insert into waiver_claims (id, league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order, action_id, created_by) values
 ('d9800000-0000-4000-8000-000000000001', 'b9800000-0000-4000-8000-000000000001', 'c9800000-0000-4000-8000-000000000001', 'wp-x', null,      30, 1, 'a9800000-0000-4000-8000-000000000101', '99800000-0000-4000-8000-000000000002'),
 ('d9800000-0000-4000-8000-000000000002', 'b9800000-0000-4000-8000-000000000001', 'c9800000-0000-4000-8000-000000000001', 'wp-y', null,      10, 2, 'a9800000-0000-4000-8000-000000000102', '99800000-0000-4000-8000-000000000002'),
 ('d9800000-0000-4000-8000-000000000003', 'b9800000-0000-4000-8000-000000000001', 'c9800000-0000-4000-8000-000000000002', 'wp-x', null,      30, 1, 'a9800000-0000-4000-8000-000000000103', '99800000-0000-4000-8000-000000000003'),
 ('d9800000-0000-4000-8000-000000000004', 'b9800000-0000-4000-8000-000000000001', 'c9800000-0000-4000-8000-000000000003', 'wp-y', 'wp-cold', 12, 1, 'a9800000-0000-4000-8000-000000000104', '99800000-0000-4000-8000-000000000001'),
 ('d9800000-0000-4000-8000-000000000005', 'b9800000-0000-4000-8000-000000000001', 'c9800000-0000-4000-8000-000000000003', 'wp-k', null,      5,  2, 'a9800000-0000-4000-8000-000000000105', '99800000-0000-4000-8000-000000000001'),
 ('d9800000-0000-4000-8000-000000000006', 'b9800000-0000-4000-8000-000000000001', 'c9800000-0000-4000-8000-000000000004', 'wp-z', null,      50, 1, 'a9800000-0000-4000-8000-000000000106', '99800000-0000-4000-8000-000000000001'),
 ('d9800000-0000-4000-8000-000000000007', 'b9800000-0000-4000-8000-000000000001', 'c9800000-0000-4000-8000-000000000005', 'wp-z', 'wp-kd',   1,  1, 'a9800000-0000-4000-8000-000000000107', '99800000-0000-4000-8000-000000000006'),
 -- LR (rolling priority)
 ('d9800000-0000-4000-8000-000000000011', 'b9800000-0000-4000-8000-000000000002', 'c9800000-0000-4000-8000-000000000011', 'wp-r1', null, 0, 1, 'a9800000-0000-4000-8000-000000000111', '99800000-0000-4000-8000-000000000002'),
 ('d9800000-0000-4000-8000-000000000012', 'b9800000-0000-4000-8000-000000000002', 'c9800000-0000-4000-8000-000000000012', 'wp-r1', null, 0, 1, 'a9800000-0000-4000-8000-000000000112', '99800000-0000-4000-8000-000000000003'),
 ('d9800000-0000-4000-8000-000000000013', 'b9800000-0000-4000-8000-000000000002', 'c9800000-0000-4000-8000-000000000012', 'wp-r2', null, 0, 2, 'a9800000-0000-4000-8000-000000000113', '99800000-0000-4000-8000-000000000003'),
 ('d9800000-0000-4000-8000-000000000014', 'b9800000-0000-4000-8000-000000000002', 'c9800000-0000-4000-8000-000000000013', 'wp-r2', null, 0, 1, 'a9800000-0000-4000-8000-000000000114', '99800000-0000-4000-8000-000000000001'),
 -- LN (left pending by a switch to no waivers), LU (untracked), LX (no balance on record)
 ('d9800000-0000-4000-8000-000000000021', 'b9800000-0000-4000-8000-000000000003', 'c9800000-0000-4000-8000-000000000021', 'wp-n1', null, 0, 1, 'a9800000-0000-4000-8000-000000000121', '99800000-0000-4000-8000-000000000002'),
 ('d9800000-0000-4000-8000-000000000031', 'b9800000-0000-4000-8000-000000000004', 'c9800000-0000-4000-8000-000000000031', 'wp-n1', null, 3, 1, 'a9800000-0000-4000-8000-000000000131', '99800000-0000-4000-8000-000000000002'),
 ('d9800000-0000-4000-8000-000000000041', 'b9800000-0000-4000-8000-000000000005', 'c9800000-0000-4000-8000-000000000041', 'wp-n1', null, 2, 1, 'a9800000-0000-4000-8000-000000000141', '99800000-0000-4000-8000-000000000002'),
 -- LV (vacate / leave)
 ('d9800000-0000-4000-8000-000000000061', 'b9800000-0000-4000-8000-000000000007', 'c9800000-0000-4000-8000-000000000062', 'wp-n1', null, 1, 1, 'a9800000-0000-4000-8000-000000000161', '99800000-0000-4000-8000-000000000002'),
 ('d9800000-0000-4000-8000-000000000062', 'b9800000-0000-4000-8000-000000000007', 'c9800000-0000-4000-8000-000000000063', 'wp-n1', null, 2, 1, 'a9800000-0000-4000-8000-000000000162', '99800000-0000-4000-8000-000000000003');

create temp table r98 (tag text primary key, r jsonb not null);
grant select, insert on r98 to authenticated;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
create or replace function pg_temp.claims(p_league uuid) returns text language sql as $$
  select string_agg(format('%s:%s%s', right(c.id::text, 2), c.status, coalesce(':' || c.result_reason, '')), ' ' order by c.id)
  from public.waiver_claims c where c.league_id = p_league
$$;

-- ---------------------------------------------------------------------------
-- C. F407 — a claim on a player whose game has kicked off is refused at submit
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "99800000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  pg_temp.err($$ select public.waiver_claim_submit_internal('b9800000-0000-4000-8000-000000000006', 'c9800000-0000-4000-8000-000000000051',
                  'wp-k', null, 5, 'a9800000-0000-4000-8000-000000000201', '2026-11-01 12:00:00+00', null) $$),
  'P0001: waiver_claim_submit: WP Kay (wp-k) is locked for adds — kicked off at 2026-10-30T00:15:00+00:00 (nfl_games); week 8 clears at 2026-11-03T08:00:00+00:00 (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no in-game pickups',
  'C1 F407 / Q74: a claim on a player who kicked off Thursday is refused BY NAME on Sunday');
select is(
  regexp_replace(pg_temp.err($$ select public.waiver_claim_submit_internal('b9800000-0000-4000-8000-000000000006', 'c9800000-0000-4000-8000-000000000051',
                  'wp-k', null, 5, 'a9800000-0000-4000-8000-000000000202', '2026-11-01 12:00:00+00', null) $$), '^P0001: waiver_claim_submit: ', ''),
  regexp_replace(pg_temp.err($$ select public.roster_add_drop_internal('b9800000-0000-4000-8000-000000000006', 'c9800000-0000-4000-8000-000000000051',
                  'wp-k', null, 'a9800000-0000-4000-8000-000000000203', '2026-11-01 12:00:00+00') $$), '^P0001: roster_add_drop: ', ''),
  'C2 …with the PICKUP LOCK''s own words (the add path''s refusal, verb prefix aside) — one rule, whichever door');
select is(
  (select format('%s|%s', r #>> '{claim,add_player_id}', r #>> '{claim,claim_order}')
   from (select public.waiver_claim_submit_internal('b9800000-0000-4000-8000-000000000006', 'c9800000-0000-4000-8000-000000000051',
           'wp-e1', null, 5, 'a9800000-0000-4000-8000-000000000204', '2026-11-01 12:00:00+00', null) r) s),
  'wp-e1|1', 'C3 …and his unlocked twin (a SEA player on bye) at the same instant is accepted');
select is(
  (select format('%s|%s', r #>> '{claim,add_player_id}', r #>> '{claim,claim_order}')
   from (select public.waiver_claim_submit_internal('b9800000-0000-4000-8000-000000000006', 'c9800000-0000-4000-8000-000000000051',
           'wp-e2', null, 20, 'a9800000-0000-4000-8000-000000000205', '2026-11-01 12:00:01+00', null) r) s),
  'wp-e2|1', 'C4 F422(b): a later, BIGGER bid goes to the top of the team''s order (the order follows the bids)');
select is(
  (select string_agg(format('%s:%s:%s', add_player_id, faab_bid, claim_order), ' ' order by claim_order)
   from waiver_claims where team_id = 'c9800000-0000-4000-8000-000000000051' and status = 'pending'),
  'wp-e2:20:1 wp-e1:5:2', 'C5 …the stored order is dense and bid-sorted');

-- ---------------------------------------------------------------------------
-- D. Reorder — F422(b) enforced by name in a FAAB league
-- ---------------------------------------------------------------------------
select is(
  pg_temp.err(format($$ select public.waiver_claim_reorder_internal('b9800000-0000-4000-8000-000000000006', 'c9800000-0000-4000-8000-000000000051',
                  array['%s', '%s']::uuid[], 'a9800000-0000-4000-8000-000000000206', '2026-11-01 12:01:00+00', null) $$,
                  (select id from waiver_claims where add_player_id = 'wp-e1' and team_id = 'c9800000-0000-4000-8000-000000000051'),
                  (select id from waiver_claims where add_player_id = 'wp-e2' and team_id = 'c9800000-0000-4000-8000-000000000051'))),
  'P0001: waiver_claim_reorder: in a FAAB league your claims are ranked by bid — your top choice is the one you bid the most on, so the $5 claim for WP E1 can''t go above the $20 claim for WP E2; only claims with the same bid can be reordered (§13.2)',
  'D1 "you cannot have a $10 priority that is higher than $50": a smaller bid above a bigger one is refused BY NAME');
select is(
  (select public.waiver_claim_submit_internal('b9800000-0000-4000-8000-000000000006', 'c9800000-0000-4000-8000-000000000051',
     'wp-e3', null, 5, 'a9800000-0000-4000-8000-000000000207', '2026-11-01 12:02:00+00', null) #>> '{claim,claim_order}'),
  '3', 'D2 a third claim at an EQUAL bid ($5) goes after the $5 already there');
insert into r98 select 'D3', public.waiver_claim_reorder_internal('b9800000-0000-4000-8000-000000000006', 'c9800000-0000-4000-8000-000000000051',
  array[(select id from waiver_claims where add_player_id = 'wp-e2' and team_id = 'c9800000-0000-4000-8000-000000000051'),
        (select id from waiver_claims where add_player_id = 'wp-e3' and team_id = 'c9800000-0000-4000-8000-000000000051'),
        (select id from waiver_claims where add_player_id = 'wp-e1' and team_id = 'c9800000-0000-4000-8000-000000000051')]::uuid[],
  'a9800000-0000-4000-8000-000000000208', '2026-11-01 12:03:00+00', null);
select is(
  (select string_agg(format('%s:%s:%s', add_player_id, faab_bid, claim_order), ' ' order by claim_order)
   from waiver_claims where team_id = 'c9800000-0000-4000-8000-000000000051' and status = 'pending'),
  'wp-e2:20:1 wp-e3:5:2 wp-e1:5:3', 'D3 …and the manager may swap his EQUAL bids (his order settles ties only)');

-- ---------------------------------------------------------------------------
-- E. waiver_claim_edit — F417: bid / drop changed in ONE transaction
-- ---------------------------------------------------------------------------
insert into r98 select 'E1', public.waiver_claim_edit_internal('b9800000-0000-4000-8000-000000000006',
  (select id from waiver_claims where add_player_id = 'wp-e1' and team_id = 'c9800000-0000-4000-8000-000000000051'),
  30, 'wp-ed', 'a9800000-0000-4000-8000-000000000209', '2026-11-01 12:04:00+00', null);
select is(
  (select format('%s|%s|%s|%s|%s', r ->> 'no_changes', r #>> '{before,faab_bid}', r #>> '{claim,faab_bid}', r #>> '{claim,drop_player_id}', r #>> '{claim,claim_order}') from r98 where tag = 'E1'),
  'false|5|30|wp-ed|1', 'E1 the manager raises his $5 claim to $30 with a drop — in place, and it moves to the top (F422(b))');
select is(
  (select format('%s|%s', count(*), string_agg(format('%s:%s:%s', add_player_id, faab_bid, claim_order), ' ' order by claim_order))
   from waiver_claims where team_id = 'c9800000-0000-4000-8000-000000000051' and status = 'pending'),
  '3|wp-e1:30:1 wp-e2:20:2 wp-e3:5:3', 'E2 …the SAME claim row (no cancel, no resubmit — still three pending), the order re-derived');
select is(
  public.waiver_claim_edit_internal('b9800000-0000-4000-8000-000000000006',
    (select id from waiver_claims where add_player_id = 'wp-e1' and team_id = 'c9800000-0000-4000-8000-000000000051'),
    30, 'wp-ed', 'a9800000-0000-4000-8000-000000000209', '2026-11-01 12:05:00+00', null),
  (select r from r98 where tag = 'E1'), 'E3 a replay of the same action_id returns the stored result byte-identically');
select is(
  (select public.waiver_claim_edit_internal('b9800000-0000-4000-8000-000000000006',
     (select id from waiver_claims where add_player_id = 'wp-e1' and team_id = 'c9800000-0000-4000-8000-000000000051'),
     30, 'wp-ed', 'a9800000-0000-4000-8000-000000000210', '2026-11-01 12:06:00+00', null) ->> 'no_changes'),
  'true', 'E4 the same bid and drop again is a NO-OP by value (standing rule (b))');
select is(
  pg_temp.err($$ select public.waiver_claim_edit_internal('b9800000-0000-4000-8000-000000000006',
     (select id from waiver_claims where add_player_id = 'wp-e2' and team_id = 'c9800000-0000-4000-8000-000000000051'),
     41, null, 'a9800000-0000-4000-8000-000000000211', '2026-11-01 12:07:00+00', null) $$),
  'P0001: waiver_claim_edit: a bid of $41 is more than WP EA''s FAAB balance of $40 (§13.2)',
  'E5 a bid above the balance is refused BY NAME (submit''s rule, re-checked under the lock)');
select is(
  pg_temp.err($$ select public.waiver_claim_edit_internal('b9800000-0000-4000-8000-000000000006',
     (select id from waiver_claims where add_player_id = 'wp-e2' and team_id = 'c9800000-0000-4000-8000-000000000051'),
     10, 'wp-a1', 'a9800000-0000-4000-8000-000000000212', '2026-11-01 12:08:00+00', null) $$),
  'P0001: waiver_claim_edit: WP A1 (wp-a1) is not on WP EA''s roster — a claim can only drop one of the team''s own players (§13.2)',
  'E6 a drop that is not the team''s own is refused BY NAME');
select set_config('request.jwt.claims', '{"sub": "99800000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is(
  pg_temp.err($$ select public.waiver_claim_edit_internal('b9800000-0000-4000-8000-000000000006',
     (select id from waiver_claims where add_player_id = 'wp-e2' and team_id = 'c9800000-0000-4000-8000-000000000051'),
     10, null, 'a9800000-0000-4000-8000-000000000213', '2026-11-01 12:09:00+00', null) $$),
  '42501: waiver_claim_edit: not a manager of this claim''s team',
  'E7 another manager of the league gets the one no-leak 42501');
select set_config('request.jwt.claims', '{"sub": "99800000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
insert into r98 select 'E8', public.waiver_claim_edit_internal('b9800000-0000-4000-8000-000000000006',
  (select id from waiver_claims where add_player_id = 'wp-e2' and team_id = 'c9800000-0000-4000-8000-000000000051'),
  6, null, 'a9800000-0000-4000-8000-000000000214', '2026-11-01 12:10:00+00', null);
select is(
  (select format('%s|%s|%s', ca.action_type, ca.acting_as_team_id, (select count(*) from commissioner_actions x where x.league_id = 'b9800000-0000-4000-8000-000000000006'))
   from commissioner_actions ca where ca.id = ((select r from r98 where tag = 'E8') ->> 'commissioner_action_id')::uuid),
  'edit_waiver_claim|c9800000-0000-4000-8000-000000000051|1',
  'E8 the commissioner edits for the team (TD5): ONE audit row acting as that team');

-- ---------------------------------------------------------------------------
-- F. THE RUN — league LF at R (FAAB, reverse-draft-order tiebreak)
--   pending: 01 A X $30 · 02 A Y $10 · 03 B X $30 · 04 C Y $12 drop Cold ·
--            05 C Kay $5 (Kay kicked off) · 06 RETIRED Z $50 · 07 S Z $1 drop
--            Kay Drop (kicked off). Order [S, C, B, A].
--   by hand: step 1 fails 05 add_locked, 06 team_retired, 07 drop_locked;
--   X at $30 is a tie A/B — B ahead ⇒ 03 won, 01 lost_on_priority, B to the
--   back; Y: 04 ($12) beats 02 ($10) ⇒ 04 won, 02 outbid, C to the back.
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select public.waiver_tick('2026-11-01 11:59:59+00', 'b9800000-0000-4000-8000-000000000001') ->> 'why'),
  'no_league_due — no in-season league had a waiver run due, an untracked schedule, or claims left under no waivers',
  'F1 BOUNDARY: at R − 1s the run is not due — the tick says why and decides nothing');
select is(pg_temp.claims('b9800000-0000-4000-8000-000000000001'),
  '01:pending 02:pending 03:pending 04:pending 05:pending 06:pending 07:pending', 'F2 …every claim still pending');
insert into r98 select 'F3', public.waiver_tick('2026-11-01 12:00:00+00', 'b9800000-0000-4000-8000-000000000001');
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s', s ->> 'status', s ->> 'claims', s ->> 'won', s ->> 'lost', s ->> 'invalid', s ->> 'faab_spent', s ->> 'notified')
   from r98, jsonb_array_elements(r -> 'settled') s where tag = 'F3'),
  'settled|7|2|2|3|42|7', 'F3 AT R the tick settles LF: 7 claims — 2 won, 2 lost, 3 invalid, $42 spent, 7 owners told');
select is(pg_temp.claims('b9800000-0000-4000-8000-000000000001'),
  '01:lost:lost_on_priority 02:lost:outbid 03:won 04:won 05:invalid:add_locked 06:invalid:team_retired 07:invalid:drop_locked',
  'F4 E7 + Q71 + Q73 + Q74 + F408: the tie to the better priority, the higher bid, the locked add, the locked drop, the retired team');
select is(
  (select string_agg(format('%s:%s', right(t.id::text, 2), coalesce(m.faab_balance::text, '-')), ' ' order by t.id)
   from teams t left join league_members m on m.team_id = t.id where t.league_id = 'b9800000-0000-4000-8000-000000000001'),
  '01:100 02:70 03:88 04:- 05:100', 'F5 money: the winners paid exactly their bids ($30, $12); nobody else paid a cent');
select is(
  (select string_agg(format('%s:%s:%s', right(r.team_id::text, 2), r.player_id, r.acquisition_type), ' ' order by r.team_id, r.player_id)
   from league_rosters r where r.league_id = 'b9800000-0000-4000-8000-000000000001'),
  '01:wp-a1:draft 02:wp-b1:draft 02:wp-x:waiver 03:wp-y:waiver 05:wp-kd:draft',
  'F6 exclusivity: Ex to Bravo, Why to Charlie (Cold dropped), each once; the locked drop stayed');
select is(
  (select format('%s|%s', state, waivers_until) from league_player_pool
   where league_id = 'b9800000-0000-4000-8000-000000000001' and player_id = 'wp-cold'),
  'on_waivers|2026-11-02 12:00:00+00', 'F7 the dropped player is on waivers until the NEXT run (149''s rule)');
select is(
  (select format('%s|%s', slot_map, bench) from team_lineups where team_id = 'c9800000-0000-4000-8000-000000000003' and week = 8),
  '{}|["wp-y"]', 'F8 TD10: the dropped starter left the lineup; the claimed player sits on the bench');
select is(
  (select string_agg(format('%s|%s|%s|%s|%s|%s', t.type, t.status, right(t.initiator_team_id::text, 2), t.payload ->> 'faab_bid',
                            t.payload ->> 'faab_before', t.payload ->> 'faab_after'), ' ' order by t.initiator_team_id)
   from transactions t where t.league_id = 'b9800000-0000-4000-8000-000000000001'),
  'waiver_claim|complete|02|30|100|70 waiver_claim|complete|03|12|100|88',
  'F9 TD9 / TD3: ONE complete waiver_claim row per WON claim — and none for a lost or invalid one');
select is(
  (select format('%s|%s|%s|%s', t.payload -> 'add', t.payload #> '{drop,name}', t.payload ->> 'add_player_id', t.payload ->> 'claim_id')
   from transactions t where t.league_id = 'b9800000-0000-4000-8000-000000000001' and t.initiator_team_id = 'c9800000-0000-4000-8000-000000000003'),
  '{"name": "WP Why", "nfl_team": "SEA", "position": "WR", "slot_key": "bn", "to_state": "rostered", "player_id": "wp-y", "from_state": "free_agent", "acquired_at": "2026-11-01T12:00:00+00:00", "acquisition_type": "waiver"}|"WP Cold"|wp-y|d9800000-0000-4000-8000-000000000004',
  'F10 F416: the won claim''s payload carries 113''s add / drop objects (names for the feed) beside TD9''s ids (F227(a) — the caps count it)');
select is(
  (select string_agg(format('%s:%s', right(n.user_id::text, 1), n.data ->> 'claim_id'), ' ' order by n.data ->> 'claim_id')
   from notifications n where n.type = 'league_waiver_claim' and n.data ->> 'league_id' = 'b9800000-0000-4000-8000-000000000001'),
  '2:d9800000-0000-4000-8000-000000000001 2:d9800000-0000-4000-8000-000000000002 3:d9800000-0000-4000-8000-000000000003 1:d9800000-0000-4000-8000-000000000004 1:d9800000-0000-4000-8000-000000000005 6:d9800000-0000-4000-8000-000000000006 6:d9800000-0000-4000-8000-000000000007',
  'F11 TD16: every owner is told privately — and the RETIRED team''s claim is reported to its successor''s manager (F408)');
select is(
  (select n.body from notifications n where n.type = 'league_waiver_claim' and n.data ->> 'claim_id' = 'd9800000-0000-4000-8000-000000000001'),
  'WP Ex went to WP Bravo at the same bid of $30, on waiver priority. Nothing was spent.',
  'F12 the tie''s loser is told who won and why, in plain words');
select is(
  (select format('%s|%s', l.waiver_next_run_at, (select count(*) from league_members m where m.league_id = l.id and m.waiver_priority is not null))
   from leagues l where l.id = 'b9800000-0000-4000-8000-000000000001'),
  '2026-11-02 12:00:00+00|0', 'F13 F423: the pending run advances to the next scheduled run; a FAAB reverse-standings order does not persist (seats stay NULL)');
select is(
  (select format('%s|%s|%s|%s', w.status, w.attempts, w.result #>> '{priority,source}', w.result #> '{priority,after}')
   from waiver_runs w where w.league_id = 'b9800000-0000-4000-8000-000000000001'),
  'settled|1|reverse_draft_order|["c9800000-0000-4000-8000-000000000005", "c9800000-0000-4000-8000-000000000001", "c9800000-0000-4000-8000-000000000002", "c9800000-0000-4000-8000-000000000003"]',
  'F14 the run is logged once; before week 1 is final the order is reverse draft order with the retired team''s slot held by its successor (Q72 / F421(b)), rolled by the two wins');
select is(
  (select public.waiver_resolve_run_internal(w.input) = w.result from waiver_runs w where w.league_id = 'b9800000-0000-4000-8000-000000000001'),
  true, 'F15 the stored result is exactly what the twin gives the stored input (the parity suite compares that input with the TS resolver)');
select is(
  (select public.waiver_tick('2026-11-01 12:00:00+00', 'b9800000-0000-4000-8000-000000000001') ->> 'leagues'),
  '0', 'F16 EXACTLY ONCE: a second tick at the same instant finds nothing due');
select is(
  (select public.process_waivers_internal('b9800000-0000-4000-8000-000000000001', '2026-11-01 12:00:00+00') ->> 'status'),
  'not_due', 'F17 …and a direct re-run of the processor says not_due (no claim re-decided, no FAAB re-spent)');

-- ---------------------------------------------------------------------------
-- G. Blind after processing (E13 / TD3), per role
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from waiver_claims where league_id = 'b9800000-0000-4000-8000-000000000001'), 0,
  'G1 anon sees no claim');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99800000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select is((select count(*)::int from waiver_claims where league_id = 'b9800000-0000-4000-8000-000000000001'), 0,
  'G2 a non-member sees no claim');
select set_config('request.jwt.claims', '{"sub": "99800000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is(
  (select string_agg(right(id::text, 2) || ':' || status, ' ' order by id) from waiver_claims where league_id = 'b9800000-0000-4000-8000-000000000001'),
  '03:won', 'G3 another member (Bravo) sees ONLY his own claim — not Alpha''s lost $30 bid (TD3: blind after processing too)');
select is((select count(*)::int from waiver_runs), 0, 'G4 …and no run log row (zero policies)');
select set_config('request.jwt.claims', '{"sub": "99800000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  (select string_agg(right(id::text, 2) || ':' || status || ':' || faab_bid, ' ' order by id) from waiver_claims where league_id = 'b9800000-0000-4000-8000-000000000001'),
  '01:lost:30 02:lost:10', 'G5 the owner (Alpha) sees his own settled claims with their reasons');
select set_config('request.jwt.claims', '{"sub": "99800000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is((select count(*)::int from waiver_claims where league_id = 'b9800000-0000-4000-8000-000000000001'), 7,
  'G6 the commissioner sees every claim');
select is((select count(*)::int from waiver_runs), 0, 'G7 …but not the run log (it is the processor''s alone)');
select throws_ok(
  $$ insert into waiver_runs (league_id, run_at, status) values ('b9800000-0000-4000-8000-000000000001', '2030-01-01', 'refused') $$,
  '42501', null, 'G8 the commissioner cannot INSERT a run-log row (no write policy — 42501)');
select results_eq($$ with u as (update waiver_runs set attempts = 9 returning 1) select count(*)::int from u $$, $$ values (0) $$,
  'G9 …UPDATE touches 0 rows');
select results_eq($$ with d as (delete from waiver_runs returning 1) select count(*)::int from d $$, $$ values (0) $$,
  'G10 …DELETE touches 0 rows');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok(
  $$ insert into waiver_runs (league_id, run_at, status) values ('b9800000-0000-4000-8000-000000000001', '2030-01-01', 'refused') $$,
  '42501', null, 'G11 anon cannot INSERT a run-log row either');
select results_eq($$ with d as (delete from waiver_runs returning 1) select count(*)::int from d $$, $$ values (0) $$,
  'G12 …and anon DELETE touches 0 rows');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- H. E8 — a claim and an instant add on the same player (serialized by the
--    league row). After the run, Alpha's add of Ex (won by Bravo) refuses.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "99800000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  pg_temp.err($$ select public.roster_add_drop_internal('b9800000-0000-4000-8000-000000000001', 'c9800000-0000-4000-8000-000000000001',
                  'wp-x', null, 'a9800000-0000-4000-8000-000000000302', '2026-11-01 12:00:05+00') $$),
  'P0001: roster_add_drop: WP Ex (wp-x) is already on WP Bravo''s roster in this league — a player is on ONE roster per league (player exclusivity, §12.7 / CLAUDE.md rule 7)',
  'H1 E8: the run got there first — the add refuses cleanly, by name (never a raw 23505)');
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- I. Rolling priority persists (LR) — the first run SEEDS, the next reads it
-- ---------------------------------------------------------------------------
insert into r98 select 'I1', public.waiver_tick('2026-11-01 12:00:00+00', 'b9800000-0000-4000-8000-000000000002');
select is(pg_temp.claims('b9800000-0000-4000-8000-000000000002'),
  '11:lost:lost_on_priority 12:won 13:lost:lost_on_priority 14:won',
  'I1 rolling priority from reverse draft order [RC, RB, RA]: RC takes R2, burns its priority; RB then beats RA to R1 (F422(a))');
select is(
  (select string_agg(format('%s:%s', right(team_id::text, 2), waiver_priority), ' ' order by waiver_priority)
   from league_members where league_id = 'b9800000-0000-4000-8000-000000000002'),
  '11:1 13:2 12:3', 'I2 the first run SEEDS the stored order (F421(d)): the non-winner first, then the winners by their last win');
insert into waiver_claims (id, league_id, team_id, add_player_id, faab_bid, claim_order, action_id, created_by) values
 ('d9800000-0000-4000-8000-000000000015', 'b9800000-0000-4000-8000-000000000002', 'c9800000-0000-4000-8000-000000000013', 'wp-r3', 0, 1, 'a9800000-0000-4000-8000-000000000115', '99800000-0000-4000-8000-000000000001'),
 ('d9800000-0000-4000-8000-000000000016', 'b9800000-0000-4000-8000-000000000002', 'c9800000-0000-4000-8000-000000000011', 'wp-r3', 0, 1, 'a9800000-0000-4000-8000-000000000116', '99800000-0000-4000-8000-000000000002');
insert into r98 select 'I3', public.waiver_tick('2026-11-02 12:00:00+00', 'b9800000-0000-4000-8000-000000000002');
select is(
  (select format('%s|%s', w.result #>> '{priority,source}', pg_temp.claims('b9800000-0000-4000-8000-000000000002'))
   from waiver_runs w where w.league_id = 'b9800000-0000-4000-8000-000000000002' and w.run_at = '2026-11-02 12:00:00+00'),
  'rolling|11:lost:lost_on_priority 12:won 13:lost:lost_on_priority 14:won 15:lost:lost_on_priority 16:won',
  'I3 the next run starts from the STORED order: RA (now first) beats RC to R3');
select is(
  (select string_agg(format('%s:%s', right(team_id::text, 2), waiver_priority), ' ' order by waiver_priority)
   from league_members where league_id = 'b9800000-0000-4000-8000-000000000002'),
  '13:1 12:2 11:3', 'I4 …and RA goes to the back of the stored order');

-- ---------------------------------------------------------------------------
-- J. F423 seeding, F421(e) no waivers, draft reset
-- ---------------------------------------------------------------------------
insert into r98 select 'J1', public.waiver_tick('2026-11-01 12:00:30+00', 'b9800000-0000-4000-8000-000000000004');
select is(
  (select format('%s|%s|%s', s ->> 'status', s ->> 'next_run_at', pg_temp.claims('b9800000-0000-4000-8000-000000000004'))
   from r98, jsonb_array_elements(r -> 'seeded') s where tag = 'J1'),
  'seeded|2026-11-04T08:00:00+00:00|31:pending',
  'J1 F423: an UNTRACKED league is seeded at its first tick with the schedule''s next run (Wednesday 03:00 Eastern = 08:00Z after the fall-back) — nothing is decided');
select is(
  (select waiver_next_run_at from leagues where id = 'b9800000-0000-4000-8000-000000000004'),
  '2026-11-04 08:00:00+00'::timestamptz, 'J2 …the column holds it (the add path now counts that run only once settled — E8)');
insert into r98 select 'J3', public.waiver_tick('2026-11-01 12:00:00+00', 'b9800000-0000-4000-8000-000000000003');
select is(
  (select format('%s|%s|%s', s ->> 'status', s ->> 'claims_closed', pg_temp.claims('b9800000-0000-4000-8000-000000000003'))
   from r98, jsonb_array_elements(r -> 'no_waivers') s where tag = 'J3'),
  'no_waivers|1|21:invalid:no_waivers',
  'J3 F421(e) DECIDED: a claim left pending by a switch to no waivers CLOSES (invalid, no_waivers) — it can never be settled, and the player is now an instant pickup');
select is(
  (select format('%s|%s', l.waiver_next_run_at is null,
                 (select n.body from notifications n where n.data ->> 'claim_id' = 'd9800000-0000-4000-8000-000000000021'))
   from leagues l where l.id = 'b9800000-0000-4000-8000-000000000003'),
  't|This league switched to no waivers, so pending claims were closed. WP N1 can be added directly if he is still available. Nothing was spent.',
  'J4 …the pending run is cleared and the owner is told why');
select set_config('request.jwt.claims', '{"sub": "99800000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok($$ select public.draft_reset('e9800000-0000-4000-8000-000000000008') $$, 'J5 the commissioner resets a live draft');
select is(
  (select format('%s|%s', status, waiver_next_run_at is null) from leagues where id = 'b9800000-0000-4000-8000-000000000008'),
  'scheduled|t', 'J6 F423: back to pre-draft clears the pending waiver run');

-- ---------------------------------------------------------------------------
-- K. F411 — vacate and leave cancel the team's pending claims (§7.2.1(c))
-- ---------------------------------------------------------------------------
insert into r98 select 'K1', public.remove_manager('b9800000-0000-4000-8000-000000000007',
  (select id from league_members where team_id = 'c9800000-0000-4000-8000-000000000062'), 'vacate');
select is(
  (select format('%s|%s', r ->> 'mode', pg_temp.claims('b9800000-0000-4000-8000-000000000007')) from r98 where tag = 'K1'),
  'vacate|61:cancelled:seat_vacated 62:pending',
  'K1 vacate: the removed manager''s pending claim is cancelled (seat_vacated); the other team''s is untouched');
select is(
  (select format('%s|%s', cancelled_by, cancelled_at is not null) from waiver_claims where id = 'd9800000-0000-4000-8000-000000000061'),
  '99800000-0000-4000-8000-000000000001|t', 'K2 …cancelled by the acting commissioner, stamped');
select set_config('request.jwt.claims', '{"sub": "99800000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
insert into r98 select 'K3', public.leave_league('b9800000-0000-4000-8000-000000000007');
select is(
  (select format('%s|%s|%s', r ->> 'ok', pg_temp.claims('b9800000-0000-4000-8000-000000000007'),
                 (select cancelled_by from waiver_claims where id = 'd9800000-0000-4000-8000-000000000062')) from r98 where tag = 'K3'),
  'true|61:cancelled:seat_vacated 62:cancelled:manager_left|99800000-0000-4000-8000-000000000003',
  'K3 leave: the leaver''s pending claim is cancelled (manager_left), by him');
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- L. Failure isolation (F421(g)) and the kill switch
-- ---------------------------------------------------------------------------
insert into system_flags (key, value) values ('waivers_paused', '{"paused": true}')
on conflict (key) do update set value = excluded.value;
insert into r98 select 'L1', public.waiver_tick('2026-11-01 12:00:00+00', 'b9800000-0000-4000-8000-000000000005');
select is(
  (select format('%s|%s|%s', r ->> 'paused', r ->> 'leagues_waiting', pg_temp.claims('b9800000-0000-4000-8000-000000000005')) from r98 where tag = 'L1'),
  'true|1|41:pending', 'L1 waivers_paused: the tick processes NOTHING, says so, and counts the league waiting');
delete from system_flags where key = 'waivers_paused';
-- LF's NEXT run (Monday 12:00Z) and LX (due since Sunday) meet in ONE
-- unscoped tick. (Any other league in the database is processed too, inside
-- this rolled-back transaction; the cells read only these two.)
insert into waiver_claims (id, league_id, team_id, add_player_id, faab_bid, claim_order, action_id, created_by) values
 ('d9800000-0000-4000-8000-000000000008', 'b9800000-0000-4000-8000-000000000001', 'c9800000-0000-4000-8000-000000000001', 'wp-z', 3, 1, 'a9800000-0000-4000-8000-000000000108', '99800000-0000-4000-8000-000000000002');
insert into r98 select 'L2', public.waiver_tick('2026-11-02 12:00:00+00', null);
select is(
  (select format('%s|%s', f ->> 'sqlstate', f ->> 'error')
   from r98, jsonb_array_elements(r -> 'failures') f where tag = 'L2' and f ->> 'league_id' = 'b9800000-0000-4000-8000-000000000005'),
  '22023|resolveWaiverRun: team c9800000-0000-4000-8000-000000000041 has claims in a FAAB league but no FAAB balance on record — refusing to settle bids against money that is not recorded (§12.2)',
  'L2 a league whose input makes the resolver throw is refused BY NAME in the tick''s report');
select is(
  (select count(*)::int from r98, jsonb_array_elements(r -> 'settled') s
   where tag = 'L2' and s ->> 'league_id' = 'b9800000-0000-4000-8000-000000000001' and s ->> 'won' = '1'),
  1, 'L3 …and the SAME tick settles another league (LF''s next run: Alpha takes Zed for $3) — the failure is isolated');
select is(
  (select format('%s|%s|%s', pg_temp.claims('b9800000-0000-4000-8000-000000000005'), l.waiver_next_run_at,
                 (select format('%s:%s:%s', w.status, w.attempts,
                                w.last_error = '22023: resolveWaiverRun: team c9800000-0000-4000-8000-000000000041 has claims in a FAAB league but no FAAB balance on record — refusing to settle bids against money that is not recorded (§12.2)')
                  from waiver_runs w where w.league_id = l.id))
   from leagues l where l.id = 'b9800000-0000-4000-8000-000000000005'),
  '41:pending|2026-11-01 12:00:00+00|refused:1:t',
  'L4 …the refused league rolled back ALONE: its claim still pending, its run not advanced, the refusal recorded in waiver_runs');
insert into r98 select 'L5', public.waiver_tick('2026-11-02 12:01:00+00', 'b9800000-0000-4000-8000-000000000005');
select is(
  (select format('%s:%s', w.status, w.attempts) from waiver_runs w where w.league_id = 'b9800000-0000-4000-8000-000000000005'),
  'refused:2', 'L5 the next minute retries — still loud, attempts counted — until the data is repaired');

select * from finish();
rollback;
