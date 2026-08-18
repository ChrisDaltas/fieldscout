-- ============================================================================
-- Draft completion → league_rosters + in_season + set_team_autodraft —
-- migration 072 + the L.B1.7 in-place amendment to 066's
-- draft_apply_pick_internal (spec §8.5 step 6, §12.7, §12.2, §12.14, §8.4/
-- §8.7 toggle row, E48; tasks-M2 §3 D88/D96/D97 + §4 standing rules; task
-- L.B1.7; PROGRESS D88/D97/D102/F33/F40). pgTAP file is **026** (025 =
-- mock mode; next free confirmed at task time).
--
-- Falsifiability notes (§4.3):
--   * THE COMPLETION GOLDEN FIXTURE (§D): an 8-team × 3-round draft driven
--     through the REAL RPC path (draft_start + 24 draft_make_pick calls as
--     the seat managers) with ONE mid-draft undo + repick — so the
--     is_undone exclusion pin discriminates: rosters hold the REPLACEMENT
--     (lr-p035) and NOT the undone player (lr-p009), per-team counts stay
--     3, and the roster player set equals the non-undone pick set exactly.
--     THE DoD BREAK-PROBE TARGET: drop `AND p.is_undone = FALSE` from the
--     completion INSERT → the undone-player-absent pin, the 24-count pin,
--     the per-team pin, and the set-equality pin go RED (shown + reverted
--     in the session log).
--   * D43 HELD AT THE FLIP: the league lands 'in_season' WITH its snapshot
--     non-NULL — pinned together, so a completion path that somehow
--     reached the flip snapshot-less would have raised (059's guard is the
--     backstop, proven in 020; here we pin the guard's precondition
--     survived to completion).
--   * THE MOCK BYPASS RE-PINNED FROM THE COMPLETION SIDE (§C): a fixture
--     mock's FINAL pick is applied through the SAME amended internal
--     (draft_apply_pick_internal, privileged) — drafts.complete happens,
--     league_rosters stays EMPTY and the league stays 'scheduled'. The
--     positive control is §D completing the same league's REAL draft into
--     24 rows minutes later — same league, same arm, opposite branch.
--   * E48 END-TO-END (§F): vacate mid-draft (063) → the seat autopicks AT
--     a deadline only 1s past (grace 30s — a STALE HUMAN would be held,
--     022's ground; the no-user seat is picked immediately, the
--     discriminator) → a seat-targeted invite claim mid-draft (062,
--     status-unrestricted) seats u14 → u14's MANUAL pick lands (E3/E48
--     "resume picking manually") → completion includes both picks.
--   * TOGGLE PER-ROLE SWEEP (§E): self vs commish vs fellow-manager vs
--     outsider vs anon; the D97 commissioner post pinned by EXACT message
--     + user_id + context + is_system on a LIVE draft, the self path
--     pinned post-less ON THE SAME LIVE DRAFT (the discriminator: only
--     actor≠seat posts), the no-draft commish toggle pinned post-less
--     (posted=false), D63 no-op pinned changed=false.
--   * Broadcast (task item 3b): 24 league_rosters events on league:<id>
--     with the exact column-selected record keys; the in_season leagues
--     event on the same topic (070's trigger — the home-hero flip).
--   * All privileged fixture work runs BEFORE any JWT claims (D49(7));
--     mid-test privileged steps use `reset role` (013/.../025 pattern).
--     Summary assertions on shared surfaces are scoped to THIS file's
--     rows (the 022 containment rule).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(70);

-- ---------------------------------------------------------------------------
-- A. Form pins (§4.1 grants doctrine; §12.7 DDL; the 3b trigger; D89)
-- ---------------------------------------------------------------------------
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_team_autodraft'),
  'set_team_autodraft is SECURITY DEFINER with the exact spec-form search_path');
select ok(
  not has_function_privilege('anon', 'public.set_team_autodraft(uuid,uuid,boolean,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_team_autodraft(uuid,uuid,boolean,text)', 'EXECUTE'),
  'set_team_autodraft: anon revoked, authenticated keeps EXECUTE (in-body auth is the gate)');
select ok(
  (select not p.prosecdef
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'league_roster_broadcast_payload')
  and not has_function_privilege('anon', 'public.league_roster_broadcast_payload(league_rosters)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.league_roster_broadcast_payload(league_rosters)', 'EXECUTE'),
  'league_roster_broadcast_payload is a plain internal with the 062-form triple REVOKE (070 payload-fn pattern)');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'broadcast_league_roster_change')
  and not has_function_privilege('authenticated', 'public.broadcast_league_roster_change()', 'EXECUTE'),
  'broadcast_league_roster_change is SECURITY DEFINER + search_path='''' + revoked (the §9.2 printed pattern)');
select has_trigger('public', 'league_rosters', 'tr_broadcast_league_rosters',
  'league_rosters carries its broadcast trigger AT CREATION (§12.14 row; task 3b — F42 never carries this table)');
select is(
  (select array_agg(event_manipulation::text order by event_manipulation)
   from information_schema.triggers
   where trigger_schema = 'public' and trigger_name = 'tr_broadcast_league_rosters'),
  array['INSERT', 'UPDATE'],
  'tr_broadcast_league_rosters fires on INSERT + UPDATE (M2 writer = completion INSERT; M4 extends for its own writers)');
select ok(
  (select c.relrowsecurity from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'league_rosters'),
  'league_rosters has RLS ENABLED');
select policies_are('public', 'league_rosters',
  array['Rosters viewable by league members'],
  'league_rosters carries EXACTLY the §12.7 member SELECT policy — NO client write policy of any kind');
select ok(
  (select count(*) = 1 from pg_indexes
   where schemaname = 'public' and tablename = 'league_rosters'
     and indexname = 'idx_league_rosters_team')
  and (select count(*) = 1 from pg_indexes
   where schemaname = 'public' and tablename = 'league_rosters'
     and indexname = 'idx_league_rosters_league'),
  'both §12.7 printed indexes exist (idx_league_rosters_team + idx_league_rosters_league)');
select ok(
  exists (select 1 from pg_constraint c
   join pg_class t on t.oid = c.conrelid
   where t.relname = 'league_rosters' and c.contype = 'u'
     and (select array_agg(a.attname::text order by a.attname)
          from unnest(c.conkey) k join pg_attribute a
            on a.attrelid = t.oid and a.attnum = k) = array['league_id', 'player_id']),
  'UNIQUE(league_id, player_id) — §12.7''s in-league player exclusivity, a constraint not a comment');
select is(
  (select count(*) from pg_publication_tables
   where pubname = 'supabase_realtime' and tablename = 'league_rosters'),
  0::bigint,
  'league_rosters is NOT in the supabase_realtime publication (D89 — Broadcast-from-DB needs no publication membership)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — BEFORE any JWT claims; D49(7)).
--    Worlds:
--      LR   b8…a1  completion golden (8 teams, {QB:1,RB:1,bench:1} → 3
--                  rounds; custom order t01..t08; ALSO hosts §C's fixture
--                  mock and §E's live-draft toggle pins)
--      LE48 b8…b1  the E48 world (8 teams, {QB:1,bench:1} → 2 rounds)
--      LT   b8…c1  toggle world with NO draft (self/commish/no-op/roles)
--      LDEL b8…d1  soft-deleted league (P0002)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('95000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated',
  'pgtap-lr' || lpad(i::text, 2, '0') || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  jsonb_build_object('username', 'lr_user_' || lpad(i::text, 2, '0')),
  now(), now()
from generate_series(1, 14) i;
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-4000-8000-000000000099',
   'authenticated', 'authenticated', 'pgtap-lr99@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lr_outsider_99"}',
   now(), now());

-- Pool: 20 QBs at ADP 1..20 (lr-p001..020) + 20 RBs at ADP 101..120
-- (lr-p021..040) — the E48 autopick lands lr-p003 (lowest available ADP,
-- fits the open QB slot) deterministically.
insert into players (id, full_name, position, adp)
select 'lr-p' || lpad(i::text, 3, '0'), 'LR QB ' || lpad(i::text, 3, '0'), 'QB', i
from generate_series(1, 20) i;
insert into players (id, full_name, position, adp)
select 'lr-p' || lpad(i::text, 3, '0'), 'LR RB ' || lpad(i::text, 3, '0'), 'RB', 80 + i
from generate_series(21, 40) i;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings) values
  ('b8000000-0000-4000-8000-0000000000a1', '95000000-0000-4000-8000-000000000001',
   'pgtap-lr-LR-golden', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "snake", "snake_reversal": false, "draft_order_mode": "custom",
     "pick_timer_seconds": 90, "disconnect_grace_seconds": 30,
     "draft_order": ["c8000000-0000-4000-8000-00a100000001", "c8000000-0000-4000-8000-00a100000002",
       "c8000000-0000-4000-8000-00a100000003", "c8000000-0000-4000-8000-00a100000004",
       "c8000000-0000-4000-8000-00a100000005", "c8000000-0000-4000-8000-00a100000006",
       "c8000000-0000-4000-8000-00a100000007", "c8000000-0000-4000-8000-00a100000008"]}}'),
  ('b8000000-0000-4000-8000-0000000000b1', '95000000-0000-4000-8000-000000000001',
   'pgtap-lr-LE48', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "snake", "snake_reversal": false, "draft_order_mode": "custom",
     "pick_timer_seconds": 90, "disconnect_grace_seconds": 30,
     "draft_order": ["c8000000-0000-4000-8000-00b100000001", "c8000000-0000-4000-8000-00b100000002",
       "c8000000-0000-4000-8000-00b100000003", "c8000000-0000-4000-8000-00b100000004",
       "c8000000-0000-4000-8000-00b100000005", "c8000000-0000-4000-8000-00b100000006",
       "c8000000-0000-4000-8000-00b100000007", "c8000000-0000-4000-8000-00b100000008"]}}'),
  ('b8000000-0000-4000-8000-0000000000c1', '95000000-0000-4000-8000-000000000009',
   'pgtap-lr-LT-nodraft', 2026, 'setup', 8, null, '{}'),
  ('b8000000-0000-4000-8000-0000000000d1', '95000000-0000-4000-8000-000000000009',
   'pgtap-lr-LDEL', 2026, 'setup', 8, null, '{}');
update leagues set deleted_at = now()
where id = 'b8000000-0000-4000-8000-0000000000d1';
-- LR: {QB:1, RB:1, bench:1} → 3 rounds (D91); LE48: {QB:1, bench:1} → 2.
update leagues
set roster_settings = '{"starting_slots": [
      {"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1},
      {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
    "bench": 1, "ir_slots": [], "swap_spots": 0}'
where id = 'b8000000-0000-4000-8000-0000000000a1';
update leagues
set roster_settings = '{"starting_slots": [
      {"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}],
    "bench": 1, "ir_slots": [], "swap_spots": 0}'
where id = 'b8000000-0000-4000-8000-0000000000b1';

insert into teams (id, owner_id, name, league_id)
select ('c8000000-0000-4000-8000-00a1000000' || lpad(i::text, 2, '0'))::uuid,
       ('95000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'pgtap-lr-a1-t' || lpad(i::text, 2, '0'),
       'b8000000-0000-4000-8000-0000000000a1'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c8000000-0000-4000-8000-00b1000000' || lpad(i::text, 2, '0'))::uuid,
       ('95000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'pgtap-lr-b1-t' || lpad(i::text, 2, '0'),
       'b8000000-0000-4000-8000-0000000000b1'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c8000000-0000-4000-8000-00c1000000' || lpad(i::text, 2, '0'))::uuid,
       ('95000000-0000-4000-8000-0000000000' || lpad((i + 8)::text, 2, '0'))::uuid,
       'pgtap-lr-c1-t' || lpad(i::text, 2, '0'),
       'b8000000-0000-4000-8000-0000000000c1'
from generate_series(1, 3) i;

insert into league_members (league_id, user_id, team_id, role)
select 'b8000000-0000-4000-8000-0000000000a1',
       ('95000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c8000000-0000-4000-8000-00a1000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 8) i;
insert into league_members (league_id, user_id, team_id, role)
select 'b8000000-0000-4000-8000-0000000000b1',
       ('95000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c8000000-0000-4000-8000-00b1000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 8) i;
insert into league_members (league_id, user_id, team_id, role)
select 'b8000000-0000-4000-8000-0000000000c1',
       ('95000000-0000-4000-8000-0000000000' || lpad((i + 8)::text, 2, '0'))::uuid,
       ('c8000000-0000-4000-8000-00c1000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 3) i;
insert into league_members (league_id, user_id, team_id, role) values
  ('b8000000-0000-4000-8000-0000000000d1', '95000000-0000-4000-8000-000000000009',
   null, 'commissioner');

-- §C's fixture mock in LR: 7 of 8 picks already made; the FINAL pick is
-- applied below through the amended internal (the completion-side bypass
-- probe). Only reachable by privileged inserts — exactly the harness move.
insert into drafts (id, league_id, draft_type, status, is_mock, config, draft_order,
                    total_rounds, current_round, current_pick_number, on_clock_team_id,
                    current_deadline, started_at) values
  ('e8000000-0000-4000-8000-0000000000f1', 'b8000000-0000-4000-8000-0000000000a1',
   'snake', 'live', true,
   '{"pick_timer_seconds": 90,
     "mock": {"human_team_id": "c8000000-0000-4000-8000-00a100000001",
              "cpu_speed": "fast",
              "launched_by": "95000000-0000-4000-8000-000000000001"}}',
   '["c8000000-0000-4000-8000-00a100000001", "c8000000-0000-4000-8000-00a100000002",
     "c8000000-0000-4000-8000-00a100000003", "c8000000-0000-4000-8000-00a100000004",
     "c8000000-0000-4000-8000-00a100000005", "c8000000-0000-4000-8000-00a100000006",
     "c8000000-0000-4000-8000-00a100000007", "c8000000-0000-4000-8000-00a100000008"]',
   1, 1, 8, 'c8000000-0000-4000-8000-00a100000008', now() + interval '90 seconds', now());
insert into draft_picks (draft_id, league_id, pick_number, round, team_id, player_id, is_auto, made_via)
select 'e8000000-0000-4000-8000-0000000000f1', 'b8000000-0000-4000-8000-0000000000a1',
       i, 1, ('c8000000-0000-4000-8000-00a1000000' || lpad(i::text, 2, '0'))::uuid,
       'lr-p' || lpad(i::text, 3, '0'), true, 'autopick'
from generate_series(1, 7) i;

-- Post-reset race guard (the 024 pattern): today's + tomorrow's
-- realtime.messages partitions exist so the broadcast pins can read rows.
do $part$
declare
  d date;
  part_name text;
begin
  foreach d in array array[current_date, current_date + 1] loop
    part_name := 'messages_' || to_char(d, 'YYYY_MM_DD');
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'realtime' and c.relname = part_name
    ) then
      execute format(
        'create table realtime.%I partition of realtime.messages for values from (%L) to (%L)',
        part_name, d::timestamp, (d + 1)::timestamp);
    end if;
  end loop;
end
$part$;

-- The pick-drive helper (020's dc_drive shape): pick N takes player
-- lr-p<N> as the on-clock seat's manager through the REAL RPC.
create function pg_temp.lr_drive(p_draft_id uuid, p_from int, p_to int) returns void
language plpgsql as $fn$
declare
  v_d record;
  v_uid uuid;
  v_i int;
begin
  for v_i in p_from..p_to loop
    select d.current_pick_number, d.league_id, d.on_clock_team_id
      into v_d from public.drafts d where d.id = p_draft_id;
    if v_d.current_pick_number is distinct from v_i then
      raise exception 'lr_drive: expected pick % on the clock, found %', v_i, v_d.current_pick_number;
    end if;
    select m.user_id into v_uid from public.league_members m
    where m.league_id = v_d.league_id and m.team_id = v_d.on_clock_team_id;
    if v_uid is null then
      raise exception 'lr_drive: no manager for on-clock team % at pick %', v_d.on_clock_team_id, v_i;
    end if;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    perform public.draft_make_pick(p_draft_id,
      'lr-p' || lpad(v_i::text, 3, '0'), gen_random_uuid());
  end loop;
  perform set_config('request.jwt.claims', '', true);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- C. The mock bypass, RE-PINNED FROM THE COMPLETION SIDE: the final mock
--    pick runs through the SAME amended internal — complete, NO rosters,
--    NO league transition (§8.8; the §D positive control is the same
--    league's REAL draft filling 24 rows through the same arm).
-- ---------------------------------------------------------------------------
select ok(
  public.draft_apply_pick_internal('e8000000-0000-4000-8000-0000000000f1',
    'lr-p008', true, 'autopick', null, null) is not null,
  'the fixture mock''s final (8th) pick applies through the amended internal');
select is(
  (select status || '|' || coalesce(completed_at::text, 'NULL')
   from drafts where id = 'e8000000-0000-4000-8000-0000000000f1'),
  'complete|' || now()::text,
  'the mock COMPLETES through the one advance path (status complete + completed_at)');
select is(
  (select count(*) from league_rosters
   where league_id = 'b8000000-0000-4000-8000-0000000000a1'),
  0::bigint,
  'MOCK BYPASS: zero league_rosters rows from a completed mock (§8.8 zero side effects — the completion-side re-pin)');
select is(
  (select status from leagues where id = 'b8000000-0000-4000-8000-0000000000a1'),
  'scheduled',
  'MOCK BYPASS: the league does NOT transition (stays scheduled — no in_season, no notifications, nothing)');

-- ---------------------------------------------------------------------------
-- D. Completion golden fixture (LR): start → 8 picks → undo pick 9''s
--    predecessor… precisely: drive 1–9, undo 9, repick 9 with lr-p035,
--    drive 10–24 → complete → rosters/exclusivity/status pins.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select ok(
  (public.draft_start('b8000000-0000-4000-8000-0000000000a1')->>'started')::boolean,
  'LR starts (commish; custom order t01..t08; snapshot taken in 059''s window)');
reset role;

create temp table lr_draft as
select id from drafts
where league_id = 'b8000000-0000-4000-8000-0000000000a1' and is_mock = false;
grant select on lr_draft to authenticated;

select is(
  (select total_rounds from drafts d join lr_draft on lr_draft.id = d.id),
  3,
  'LR total_rounds = 3 (D91: QB+RB starters + 1 bench; IR excluded)');

-- §E's live-draft toggle pins interleave here (the draft must be LIVE).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select public.set_team_autodraft('b8000000-0000-4000-8000-0000000000a1',
     'c8000000-0000-4000-8000-00a100000002', true, 'went AFK')
   - 'member_id'),
  '{"team_id": "c8000000-0000-4000-8000-00a100000002", "is_autodraft": true,
    "changed": true, "posted": true}'::jsonb,
  'COMMISH PATH on a live draft: the toggle lands and POSTS (D97 — §8.7 "Toggle autopick for any team")');
reset role;
select is(
  (select count(*) from league_members
   where league_id = 'b8000000-0000-4000-8000-0000000000a1'
     and team_id = 'c8000000-0000-4000-8000-00a100000002'
     and is_autodraft),
  1::bigint,
  'the seat''s is_autodraft flag is TRUE after the commissioner toggle (052''s column was always real — nothing DB-side replaced)');
select is(
  (select c.user_id::text || '|' || c.context || '|' || c.is_system::text || '|' || c.message
   from league_chat c join lr_draft on 'draft:' || lr_draft.id::text = c.context
   where c.message like 'Autopick%'),
  '95000000-0000-4000-8000-000000000001|draft:'
    || (select id from lr_draft)::text
    || '|true|Autopick turned on for pgtap-lr-a1-t02 by lr_user_01.',
  'the D97 system post: exact message, acting commissioner as author, the draft''s own context, is_system TRUE');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "95000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select is(
  (select public.set_team_autodraft('b8000000-0000-4000-8000-0000000000a1',
     'c8000000-0000-4000-8000-00a100000004', true)
   - 'member_id'),
  '{"team_id": "c8000000-0000-4000-8000-00a100000004", "is_autodraft": true,
    "changed": true, "posted": false}'::jsonb,
  'SELF PATH on the SAME live draft: the toggle lands and posts NOTHING (toggling yourself is not an override — the discriminator)');
select is(
  (select public.set_team_autodraft('b8000000-0000-4000-8000-0000000000a1',
     'c8000000-0000-4000-8000-00a100000004', true)
   - 'member_id'),
  '{"team_id": "c8000000-0000-4000-8000-00a100000004", "is_autodraft": true,
    "changed": false, "posted": false}'::jsonb,
  'D63 no-op: re-setting the current value returns changed=false and posts nothing (a double-tap never spams the room)');
reset role;
select is(
  (select count(*) from league_chat
   where league_id = 'b8000000-0000-4000-8000-0000000000a1'
     and message like 'Autopick%'),
  1::bigint,
  'exactly ONE Autopick system post exists — the commish toggle; neither self call posted');

-- Drive to completion with the mid-draft undo + repick. The undo happens
-- behind a pause (F57 ALIGNED, migration 090 — snake commissioner edits are
-- pause-first everywhere now); resume before the repick, because
-- draft_make_pick needs the live board.
select pg_temp.lr_drive((select id from lr_draft), 1, 9);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_pause((select id from lr_draft)) $$,
  'pause for the mid-draft undo (F57/090 pause-first)');
select ok(
  public.draft_undo((select id from lr_draft)) is not null,
  'commish undoes pick 9 (single undo — lr-p009 returns to the pool, t08 back on the clock)');
select lives_ok(
  $$ select public.draft_resume((select id from lr_draft)) $$,
  'resume for the repick');
select set_config('request.jwt.claims',
  '{"sub": "95000000-0000-4000-8000-000000000008", "role": "authenticated"}', true);
select ok(
  public.draft_make_pick((select id from lr_draft), 'lr-p035',
    'a8000000-0000-4000-8000-000000000001') is not null,
  't08 repicks pick 9 with lr-p035 (the undone board slot refills with a DIFFERENT player)');
reset role;
select pg_temp.lr_drive((select id from lr_draft), 10, 24);

select is(
  (select d.status || '|' || coalesce(d.on_clock_team_id::text, 'NULL')
          || '|' || coalesce(d.current_deadline::text, 'NULL')
   from drafts d join lr_draft on lr_draft.id = d.id),
  'complete|NULL|NULL',
  'COMPLETION: all 24 live picks in → drafts complete, clock cleared, nobody on the clock');
select is(
  (select status from leagues where id = 'b8000000-0000-4000-8000-0000000000a1'),
  'in_season',
  'THE §8.5-STEP-6 FLIP: leagues.status = in_season in the completion txn (D88)');
select ok(
  (select scoring_rules_snapshot is not null
   from leagues where id = 'b8000000-0000-4000-8000-0000000000a1'),
  'D43 HELD: the league landed in_season WITH its scoring snapshot (taken at draft_start — the guard''s precondition survived to the flip)');
select is(
  (select count(*) from league_rosters
   where league_id = 'b8000000-0000-4000-8000-0000000000a1'),
  24::bigint,
  'league_rosters holds EXACTLY 24 rows (8 teams × 3 rounds; the undone pick 9 is EXCLUDED — the DoD break-probe pin)');
select is(
  (select count(*) from (
     select r.team_id from league_rosters r
     where r.league_id = 'b8000000-0000-4000-8000-0000000000a1'
     group by r.team_id having count(*) = 3) s),
  8::bigint,
  'every one of the 8 teams holds exactly total_rounds (3) players');
select is(
  (select count(distinct player_id) from league_rosters
   where league_id = 'b8000000-0000-4000-8000-0000000000a1'),
  24::bigint,
  'EXCLUSIVITY: 24 distinct players — no player on two teams (§12.7''s UNIQUE, observed)');
select is(
  (select count(*) from league_rosters
   where league_id = 'b8000000-0000-4000-8000-0000000000a1'
     and player_id = 'lr-p009'),
  0::bigint,
  'THE UNDONE PICK IS NOT A ROSTER ROW: lr-p009 (undone at pick 9) is absent (the break-probe target)');
select is(
  (select r.team_id from league_rosters r
   where r.league_id = 'b8000000-0000-4000-8000-0000000000a1'
     and r.player_id = 'lr-p035'),
  'c8000000-0000-4000-8000-00a100000008'::uuid,
  'the REPLACEMENT pick (lr-p035) IS rostered, on the team that repicked (t08)');
select results_eq(
  $$ select r.team_id, r.player_id from league_rosters r
     where r.league_id = 'b8000000-0000-4000-8000-0000000000a1'
     order by r.player_id $$,
  $$ select p.team_id, p.player_id from draft_picks p join lr_draft on lr_draft.id = p.draft_id
     where p.is_undone = false
     order by p.player_id $$,
  'SET EQUALITY: league_rosters ≡ the draft''s non-undone picks, team by team (the population is the board, nothing else)');
select ok(
  (select bool_and(r.acquisition_type = 'draft'
       and r.acquisition_cost is null
       and r.slot_key is null
       and r.ir_placed_week is null
       and r.ir_lock_until_week is null
       and r.acquired_at = now())
   from league_rosters r
   where r.league_id = 'b8000000-0000-4000-8000-0000000000a1'),
  'row shape: acquisition_type=draft, cost NULL (snake — D88), slot_key/IR columns NULL (M4''s), acquired_at = the completion txn instant');
select throws_ok(
  $$ insert into league_rosters (league_id, team_id, player_id)
     values ('b8000000-0000-4000-8000-0000000000a1',
             'c8000000-0000-4000-8000-00a100000001', 'lr-p001') $$,
  '23505', null,
  'exclusivity direct probe: a privileged duplicate (league, player) insert trips the §12.7 UNIQUE (23505)');

-- Broadcast (task 3b) behavioral pins.
select is(
  (select count(*) from realtime.messages
   where topic = 'league:b8000000-0000-4000-8000-0000000000a1'
     and event = 'league_rosters'),
  24::bigint,
  'completion broadcast: one league_rosters event per roster row on league:<id> (the §12.14 trigger, live)');
select is(
  (select array_agg(k order by k)
   from (select payload->'record' rec from realtime.messages
         where topic = 'league:b8000000-0000-4000-8000-0000000000a1'
           and event = 'league_rosters' limit 1) m,
        jsonb_object_keys(m.rec) k),
  array['acquired_at', 'acquisition_type', 'id', 'player_id', 'slot_key', 'team_id'],
  'the roster record is COLUMN-SELECTED: exactly {id, team_id, player_id, slot_key, acquisition_type, acquired_at} — no league_id, no cost, no IR columns (§9.2 nothing blind)');
select ok(
  exists (select 1 from realtime.messages
   where topic = 'league:b8000000-0000-4000-8000-0000000000a1'
     and event = 'leagues'
     and payload->'record'->>'status' = 'in_season'),
  'the in_season flip broadcasts on league:<id> via 070''s status-column trigger (the home-hero/draft-bar flip rides the existing event)');

-- ---------------------------------------------------------------------------
-- E. set_team_autodraft — the remaining per-role sweep (no-draft world LT,
--    soft-deleted LDEL, shape, outsiders, anon; live-draft pins ran in §D)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "95000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
select is(
  (select public.set_team_autodraft('b8000000-0000-4000-8000-0000000000c1',
     'c8000000-0000-4000-8000-00c100000002', true)
   - 'member_id'),
  '{"team_id": "c8000000-0000-4000-8000-00c100000002", "is_autodraft": true,
    "changed": true, "posted": false}'::jsonb,
  'self toggle with NO draft anywhere: lands, posts nothing (there is no room to tell)');
select set_config('request.jwt.claims',
  '{"sub": "95000000-0000-4000-8000-000000000009", "role": "authenticated"}', true);
select is(
  (select public.set_team_autodraft('b8000000-0000-4000-8000-0000000000c1',
     'c8000000-0000-4000-8000-00c100000002', false)
   - 'member_id'),
  '{"team_id": "c8000000-0000-4000-8000-00c100000002", "is_autodraft": false,
    "changed": true, "posted": false}'::jsonb,
  'commish toggle OFF with no draft: lands (§8.4 "for any team"), changed=true, posted=false — the D97 post exists only when a live draft exists');
reset role;
select is(
  (select count(*) from league_members
   where league_id = 'b8000000-0000-4000-8000-0000000000c1'
     and team_id = 'c8000000-0000-4000-8000-00c100000002'
     and is_autodraft = false),
  1::bigint,
  'the flag reads FALSE after the commissioner OFF toggle');
select is(
  (select count(*) from league_chat
   where league_id = 'b8000000-0000-4000-8000-0000000000c1'),
  0::bigint,
  'no chat rows in the no-draft league at all — the commish path posts only when a live draft exists');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "95000000-0000-4000-8000-000000000011", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.set_team_autodraft('b8000000-0000-4000-8000-0000000000c1',
       'c8000000-0000-4000-8000-00c100000002', true) $$,
  '42501',
  'set_team_autodraft: only that seat''s manager or a commissioner can toggle autodraft (§8.4)',
  'a FELLOW MANAGER cannot toggle another seat (42501 — not self, not commish)');
select set_config('request.jwt.claims',
  '{"sub": "95000000-0000-4000-8000-000000000099", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.set_team_autodraft('b8000000-0000-4000-8000-0000000000c1',
       'c8000000-0000-4000-8000-00c100000002', true) $$,
  '42501', 'set_team_autodraft: not a member of this league',
  'outsider → 42501 (the member floor)');
select throws_ok(
  $$ select public.set_team_autodraft('99999999-0000-4000-8000-000000000000',
       'c8000000-0000-4000-8000-00c100000002', true) $$,
  '42501', 'set_team_autodraft: not a member of this league',
  'nonexistent league → the SAME 42501 (no existence leak)');
select set_config('request.jwt.claims',
  '{"sub": "95000000-0000-4000-8000-000000000009", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.set_team_autodraft('b8000000-0000-4000-8000-0000000000d1',
       'c8000000-0000-4000-8000-00c100000001', true) $$,
  'P0002',
  'set_team_autodraft: league b8000000-0000-4000-8000-0000000000d1 not found',
  'soft-deleted league → P0002 for a legitimate member (063 rule)');
select throws_ok(
  $$ select public.set_team_autodraft('b8000000-0000-4000-8000-0000000000c1',
       'c8000000-0000-4000-8000-00a100000001', true) $$,
  'P0002',
  'set_team_autodraft: team c8000000-0000-4000-8000-00a100000001 has no seat in league b8000000-0000-4000-8000-0000000000c1',
  'a foreign league''s team → P0002 (unknown target, 404 class)');
select throws_ok(
  $$ select public.set_team_autodraft('b8000000-0000-4000-8000-0000000000c1',
       'c8000000-0000-4000-8000-00c100000002', null) $$,
  '22023', 'set_team_autodraft: league_id, team_id, and on are required',
  'NULL p_on → 22023 (argument shape before any data access)');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok(
  $$ select public.set_team_autodraft('b8000000-0000-4000-8000-0000000000c1',
       'c8000000-0000-4000-8000-00c100000002', true) $$,
  '42501', null,
  'anon → 42501 (EXECUTE revoked)');
reset role;

-- ---------------------------------------------------------------------------
-- F. E48 end-to-end (LE48): vacate mid-draft → no-grace autopick at the
--    deadline → seat-invite claim mid-draft → manual pick → completion.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select ok(
  (public.draft_start('b8000000-0000-4000-8000-0000000000b1')->>'started')::boolean,
  'LE48 starts (2 rounds × 8 teams)');
reset role;
create temp table le_draft as
select id from drafts
where league_id = 'b8000000-0000-4000-8000-0000000000b1' and is_mock = false;
grant select on le_draft to authenticated;

select pg_temp.lr_drive((select id from le_draft), 1, 2);

-- Vacate u03 mid-draft (league is 'drafting' — 063 has no status gate;
-- the §7.2.1 mechanics keep the franchise and open the seat).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "95000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select ok(
  public.remove_manager('b8000000-0000-4000-8000-0000000000b1',
    (select id from league_members
     where league_id = 'b8000000-0000-4000-8000-0000000000b1'
       and user_id = '95000000-0000-4000-8000-000000000003'),
    'vacate') is not null,
  'E48: remove_manager(vacate) succeeds MID-DRAFT (063 permits it — the removal is a league-lock affair, not a status gate)');
reset role;
select is(
  (select count(*) from league_members
   where league_id = 'b8000000-0000-4000-8000-0000000000b1'
     and team_id = 'c8000000-0000-4000-8000-00b100000003'
     and user_id is null),
  1::bigint,
  'the seat survives with NO user (franchise kept, stint closed — §7.2.1(c))');

-- No-grace discriminator: the deadline is only 1s past (grace 30s). A
-- STALE HUMAN seat would be HELD (022's ground); the no-user seat
-- autopicks IMMEDIATELY (D102/§8.5.5 — E48's autopilot).
update drafts set current_deadline = now() - interval '1 second'
where id = (select id from le_draft);
select ok(public.draft_tick() is not null, 'draft_tick runs (privileged — the cron caller)');
select is(
  (select p.team_id::text || '|' || p.player_id || '|' || p.is_auto::text
          || '|' || p.made_via || '|' || coalesce(p.picked_by::text, 'NULL')
   from draft_picks p join le_draft on le_draft.id = p.draft_id
   where p.pick_number = 3),
  'c8000000-0000-4000-8000-00b100000003|lr-p003|true|autopick|NULL',
  'E48 AUTOPILOT: the vacated seat autopicked AT the deadline, no grace hold — lowest available ADP filling the open QB slot (lr-p003), §12.4 system-pick shape');

select pg_temp.lr_drive((select id from le_draft), 4, 13);

-- Replacement GM: seat-targeted invite + claim, mid-draft (062 is
-- status-unrestricted — the §7.2.1 replacement path).
select set_config('request.jwt.claims',
  json_build_object('sub', '95000000-0000-4000-8000-000000000001',
                    'role', 'authenticated')::text, true);
create temp table le_tok as
select public.create_league_invite('b8000000-0000-4000-8000-0000000000b1',
  'c8000000-0000-4000-8000-00b100000003')->>'token' as token;
grant select on le_tok to authenticated;
select set_config('request.jwt.claims', '', true);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "95000000-0000-4000-8000-000000000014", "role": "authenticated"}', true);
select ok(
  public.claim_league_invite((select token from le_tok)) is not null,
  'E48: the seat-targeted claim succeeds MID-DRAFT (062''s claim is status-unrestricted — the replacement-GM path)');
reset role;
select is(
  (select count(*) from league_members
   where league_id = 'b8000000-0000-4000-8000-0000000000b1'
     and team_id = 'c8000000-0000-4000-8000-00b100000003'
     and user_id = '95000000-0000-4000-8000-000000000014'),
  1::bigint,
  'u14 fills the vacated seat row (cache updated, stint opened — one seat, new manager)');

-- Manual control restored: t03 is on the clock at pick 14 (round 2
-- reversed) and the CLAIMER picks manually.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "95000000-0000-4000-8000-000000000014", "role": "authenticated"}', true);
select ok(
  public.draft_make_pick((select id from le_draft), 'lr-p040',
    'a8000000-0000-4000-8000-000000000002') is not null,
  'E48 MANUAL CONTROL RESTORED: the replacement GM''s own pick lands at pick 14 (E3 — no autopilot residue)');
reset role;
select is(
  (select p.is_auto::text || '|' || p.made_via || '|' || coalesce(p.picked_by::text, 'NULL')
   from draft_picks p join le_draft on le_draft.id = p.draft_id
   where p.pick_number = 14),
  'false|manager|95000000-0000-4000-8000-000000000014',
  'pick 14 is a MANUAL pick by u14 (is_auto false, made_via manager)');

select pg_temp.lr_drive((select id from le_draft), 15, 16);
select is(
  (select status from leagues where id = 'b8000000-0000-4000-8000-0000000000b1'),
  'in_season',
  'LE48 completes → in_season (the second completion fixture — the arm is the same for every finisher)');
select is(
  (select count(*) from league_rosters
   where league_id = 'b8000000-0000-4000-8000-0000000000b1'),
  16::bigint,
  'LE48 rosters: 16 rows (8 × 2)');
select ok(
  (select count(*) = 1 from league_rosters
   where league_id = 'b8000000-0000-4000-8000-0000000000b1'
     and team_id = 'c8000000-0000-4000-8000-00b100000003'
     and player_id = 'lr-p003')
  and (select count(*) = 1 from league_rosters
   where league_id = 'b8000000-0000-4000-8000-0000000000b1'
     and team_id = 'c8000000-0000-4000-8000-00b100000003'
     and player_id = 'lr-p040'),
  'the E48 seat''s roster holds BOTH the autopilot pick (lr-p003) and the replacement GM''s manual pick (lr-p040)');

-- ---------------------------------------------------------------------------
-- G. league_rosters per-role §4.2 sweep (deny-by-default; RETURNING-counts)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "95000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  (select count(*) from league_rosters
   where league_id = 'b8000000-0000-4000-8000-0000000000a1'),
  24::bigint,
  'a league MEMBER reads the full roster surface (§12.7 SELECT policy)');
select throws_ok(
  $$ insert into league_rosters (league_id, team_id, player_id)
     values ('b8000000-0000-4000-8000-0000000000a1',
             'c8000000-0000-4000-8000-00a100000002', 'lr-p036') $$,
  '42501', null,
  'member INSERT on league_rosters → 42501 (NO client write policy — writes only via RPCs)');
select results_eq(
  $$ with u as (update league_rosters set slot_key = 'qb'
                where league_id = 'b8000000-0000-4000-8000-0000000000a1' returning 1)
     select count(*) from u $$,
  $$ values (0::bigint) $$,
  'member UPDATE on league_rosters affects 0 rows (RETURNING-count; sees 24, changes none)');
select results_eq(
  $$ with d as (delete from league_rosters
                where league_id = 'b8000000-0000-4000-8000-0000000000a1' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'member DELETE on league_rosters affects 0 rows (RETURNING-count)');
select set_config('request.jwt.claims',
  '{"sub": "95000000-0000-4000-8000-000000000099", "role": "authenticated"}', true);
select is(
  (select count(*) from league_rosters),
  0::bigint,
  'a NON-member sees zero roster rows (RLS scope)');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(
  (select count(*) from league_rosters),
  0::bigint,
  'anon sees zero roster rows');
reset role;

select * from finish();
rollback;
