-- ============================================================================
-- Broadcast-from-DB + realtime channel auth — migration 070 (+ the 068
-- draft_tick heartbeat amendment, ARM 3) (spec §9 ALL/§12.14+D89; delivery
-- plan §8.4; tasks-M2 §4.5 + §5, task L.B1.5; PROGRESS D109, F8/F42).
-- pgTAP file is **024** (023 = commissioner controls; next free confirmed
-- at task time).
--
-- AMENDED IN PLACE 2026-08-19 (L.C1.6 / migration 088 — tests are tests,
-- the D137 note): the drafts payload pins read 10 keys (+ current_nomination
-- + budget_adjustments, D134) and the draft_picks payload pins read 7 (+
-- price); `current_nomination` and `price` LEFT the named-negative lists
-- they sat in. Shown RED against 088 before the edit: exactly 6 of 63 (27,
-- 28, 29, 30, 35, 36). pgTAP 037 owns the auction-era inventory pins; this
-- file keeps the M2 surface + the amended key sets.
--
-- AMENDED IN PLACE 2026-09-07 (L.D1.9 / migration 119 — tests are tests,
-- the D137 note): the F42 trigger-less pin SHRINKS to the five tables still
-- re-waived (league_members / team_managers / teams / league_invites /
-- league_lists) — `league_weeks` gained its subscriber (L.D4.1 / L.D5.3)
-- and its trigger (`tr_broadcast_league_weeks`, 119). Shown RED against
-- 119 before the edit: exactly 1 of 63 (the F42 cell). pgTAP 067 pins the
-- shrunken set again beside the new inventory (both directions).
--
-- Falsifiability notes (§4.3):
--   * PAYLOAD-SHAPE UNIT PINS (task item 4): each column-select function's
--     EXACT jsonb key set is pinned against a stored-literal array, plus
--     NAMED sensitive-column negatives (leagues: settings /
--     scoring_rules_snapshot / invite_code / invite_slug /
--     creation_action_id — the §9.2 "nothing blind" rule made falsifiable).
--     THE DoD BREAK PROBE (shown + reverted in the session log): widen
--     league_broadcast_payload to to_jsonb(l) → the exact-key pin AND the
--     named negatives go RED.
--   * TRIGGER BEHAVIOR is proven END-TO-END in-DB: a privileged UPDATE/
--     INSERT on each broadcast table produces a realtime.messages row on
--     the RIGHT topic with the COLUMN-SELECTED record (uncommitted — the
--     whole file rolls back; the live Realtime service never sees these).
--     The leagues trigger's column list is pinned BOTH structurally
--     (triggered_update_columns) and behaviorally (a settings-only UPDATE
--     emits NOTHING — the discriminator).
--   * CHANNEL AUTH is proven at the realtime.messages surface per role:
--     member reads their league/draft topics, non-member and anon read
--     ZERO rows, a trailing-junk draft topic ('draft:<id>:junk') matches
--     NO policy (the R117 exact-grammar shape), and the spec-printed
--     league policy's malformed-topic residual is pinned HONESTLY as a
--     22P02 throw (refusal-by-error — 070 banner). Write side: presence
--     INSERT allowed for members on their topics; extension='broadcast'
--     INSERT refused even for members (the server-spoof channel stays
--     closed — 070 banner item 3); outsider/anon refused.
--   * HEARTBEAT (068 ARM 3): draft_tick() emits event 'tick' on the draft
--     topic for a LIVE draft (payload keys pinned exact — realtime.send
--     injects an 'id' key, documented), NOT for a scheduled draft, NOT
--     for a live draft under a soft-deleted league (R141 discipline).
--     Summary assertions stay containment/≥-based (the live 5s cron +
--     committed wire-suite leftovers are legal concurrent actors — the
--     022 rule); world state is asserted directly on rows.
--   * D89 MADE FALSIFIABLE: the supabase_realtime publication carries
--     NONE of the broadcast tables (the §12.14 ALTER is NOT executed).
--   * F42 MADE FALSIFIABLE: every no-subscriber table (league_members,
--     team_managers, teams, league_invites, league_weeks, league_lists)
--     plus the never-broadcast pair (draft_queues §9.2, draft_liveness
--     D102) is pinned trigger-less — a drive-by broadcast trigger cannot
--     land unnoticed.
--   * All privileged fixture work runs BEFORE any JWT claims (D49(7));
--     mid-test privileged pins use `reset role` (013/014/018 pattern).
--     realtime.send() does SET LOCAL realtime.topic as a side effect, so
--     every role-scoped read sets its own realtime.topic explicitly.
--   * A DO-block guard creates today's realtime.messages partition if the
--     realtime service hasn't yet (post-reset race) — rolled back with
--     the rest of the file.
-- ============================================================================
begin;
select plan(63);

-- ---------------------------------------------------------------------------
-- A. Form pins (§4.1 grants doctrine; §9.2 printed pattern)
-- ---------------------------------------------------------------------------
select has_function('public', 'draft_broadcast_payload', array['drafts'],
  'draft_broadcast_payload(drafts) exists (the drafts column-select unit)');
select has_function('public', 'draft_pick_broadcast_payload', array['draft_picks'],
  'draft_pick_broadcast_payload(draft_picks) exists');
select has_function('public', 'league_chat_broadcast_payload', array['league_chat'],
  'league_chat_broadcast_payload(league_chat) exists');
select has_function('public', 'league_broadcast_payload', array['leagues'],
  'league_broadcast_payload(leagues) exists');
select ok(
  (select count(*) = 4 and bool_and(not p.prosecdef)
       and bool_and(array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('draft_broadcast_payload', 'draft_pick_broadcast_payload',
                       'league_chat_broadcast_payload', 'league_broadcast_payload')),
  'the four payload functions are PLAIN (non-SECURITY-DEFINER internals, 062 form) with the exact search_path');
select ok(
  not has_function_privilege('anon', 'public.draft_broadcast_payload(public.drafts)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_broadcast_payload(public.drafts)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_pick_broadcast_payload(public.draft_picks)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_pick_broadcast_payload(public.draft_picks)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.league_chat_broadcast_payload(public.league_chat)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.league_chat_broadcast_payload(public.league_chat)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.league_broadcast_payload(public.leagues)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.league_broadcast_payload(public.leagues)', 'EXECUTE'),
  'all four payload functions are REVOKEd from anon AND authenticated');
select ok(
  (select count(*) = 4 and bool_and(p.prosecdef)
       and bool_and(array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('broadcast_draft_update', 'broadcast_draft_pick_change',
                       'broadcast_league_chat_insert', 'broadcast_league_update')),
  'the four trigger functions are SECURITY DEFINER with the exact §9.2 search_path (printed pattern)');
select ok(
  not has_function_privilege('anon', 'public.broadcast_draft_update()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.broadcast_draft_update()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.broadcast_draft_pick_change()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.broadcast_draft_pick_change()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.broadcast_league_chat_insert()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.broadcast_league_chat_insert()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.broadcast_league_update()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.broadcast_league_update()', 'EXECUTE'),
  'all four trigger functions are REVOKEd from anon AND authenticated (hygiene — they fire as owner)');

select has_trigger('public', 'drafts', 'tr_broadcast_drafts',
  'drafts carries its broadcast trigger (070; standing rule 5 — subscriber lands L.B3.1)');
select has_trigger('public', 'draft_picks', 'tr_broadcast_draft_picks',
  'draft_picks carries its broadcast trigger');
select has_trigger('public', 'league_chat', 'tr_broadcast_league_chat',
  'league_chat carries its broadcast trigger');
select has_trigger('public', 'leagues', 'tr_broadcast_leagues',
  'leagues carries its broadcast trigger');

select is(
  (select array_agg(distinct event_manipulation::text order by event_manipulation::text)
   from information_schema.triggers
   where trigger_schema = 'public' and trigger_name = 'tr_broadcast_drafts'),
  array['UPDATE'],
  'tr_broadcast_drafts fires on UPDATE only (§5 inventory: drafts UPDATE)');
select is(
  (select array_agg(distinct event_manipulation::text order by event_manipulation::text)
   from information_schema.triggers
   where trigger_schema = 'public' and trigger_name = 'tr_broadcast_draft_picks'),
  array['INSERT', 'UPDATE'],
  'tr_broadcast_draft_picks fires on INSERT + UPDATE (§5: picks + undo flips)');
select is(
  (select array_agg(distinct event_manipulation::text order by event_manipulation::text)
   from information_schema.triggers
   where trigger_schema = 'public' and trigger_name = 'tr_broadcast_league_chat'),
  array['INSERT'],
  'tr_broadcast_league_chat fires on INSERT only (chat is append-only, D99)');
select is(
  (select array_agg(distinct event_object_column::text order by event_object_column::text)
   from information_schema.triggered_update_columns
   where trigger_schema = 'public' and trigger_name = 'tr_broadcast_leagues'),
  array['avatar_url', 'name', 'status'],
  'tr_broadcast_leagues is COLUMN-TRIGGERED on exactly {avatar_url, name, status} (§5 "status/name/avatar_url only")');

-- realtime.messages policies (§9.2; golden-pinned definitions).
select policies_are('realtime', 'messages', array[
    'members read league topics',
    'members read draft topics',
    'members track presence on league topics',
    'members track presence on draft topics'],
  'realtime.messages carries EXACTLY the four 070 policies (platform default is zero)');
select is(
  (select qual from pg_policies
   where schemaname = 'realtime' and tablename = 'messages'
     and policyname = 'members read league topics'),
  $g$((( SELECT realtime.topic() AS topic) ~~ 'league:%'::text) AND is_league_member((split_part(( SELECT realtime.topic() AS topic), ':'::text, 2))::uuid))$g$,
  'league READ policy definition golden pin — the §9.2 PRINTED SQL verbatim (split_part + uuid cast)');
select is(
  (select qual from pg_policies
   where schemaname = 'realtime' and tablename = 'messages'
     and policyname = 'members read draft topics'),
  $g$((( SELECT realtime.topic() AS topic) ~~ 'draft:%'::text) AND (EXISTS ( SELECT 1
   FROM drafts d
  WHERE ((('draft:'::text || (d.id)::text) = ( SELECT realtime.topic() AS topic)) AND (is_league_member(d.league_id) OR is_standalone_mock_launcher(d.id))))))$g$,
  'draft READ policy definition golden pin — the drafts.league_id lookup in the R117 exact-grammar shape (no cast)');
select is(
  (select with_check from pg_policies
   where schemaname = 'realtime' and tablename = 'messages'
     and policyname = 'members track presence on league topics'),
  $g$((extension = 'presence'::text) AND (( SELECT realtime.topic() AS topic) ~~ 'league:%'::text) AND is_league_member((split_part(( SELECT realtime.topic() AS topic), ':'::text, 2))::uuid))$g$,
  'league WRITE policy golden pin — presence ONLY (client broadcast deliberately closed, 070 banner)');
select is(
  (select with_check from pg_policies
   where schemaname = 'realtime' and tablename = 'messages'
     and policyname = 'members track presence on draft topics'),
  $g$((extension = 'presence'::text) AND (( SELECT realtime.topic() AS topic) ~~ 'draft:%'::text) AND (EXISTS ( SELECT 1
   FROM drafts d
  WHERE ((('draft:'::text || (d.id)::text) = ( SELECT realtime.topic() AS topic)) AND (is_league_member(d.league_id) OR is_standalone_mock_launcher(d.id))))))$g$,
  'draft WRITE policy golden pin — presence ONLY');
select ok(
  (select count(*) = 4 and bool_and(roles::text[] = array['authenticated'])
       and count(*) filter (where cmd = 'SELECT') = 2
       and count(*) filter (where cmd = 'INSERT') = 2
   from pg_policies
   where schemaname = 'realtime' and tablename = 'messages'),
  'all four policies are TO authenticated; 2 SELECT + 2 INSERT — no UPDATE/DELETE surface opened');

-- D89 made falsifiable: the §12.14 publication ALTER is NOT executed.
select is(
  (select count(*) from pg_publication_tables
   where pubname = 'supabase_realtime'
     and schemaname = 'public'
     and tablename in ('drafts', 'draft_picks', 'draft_queues', 'draft_liveness',
                       'league_chat', 'leagues', 'league_lists')),
  0::bigint,
  'the supabase_realtime publication carries NONE of the league/draft tables (D89 — Broadcast-from-DB needs no publication; Postgres Changes stays off)');

-- Never-broadcast + F42 trigger-less pins (one per table).
select is(
  (select count(*) from pg_trigger t
   join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.draft_queues'::regclass and p.proname like 'broadcast%'),
  0::bigint,
  'draft_queues has NO broadcast trigger — §9.2 spec-named sensitive, NEVER broadcast (owners poll/refetch)');
select is(
  (select count(*) from pg_trigger t
   join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.draft_liveness'::regclass and p.proname like 'broadcast%'),
  0::bigint,
  'draft_liveness has NO broadcast trigger — D102/D107(3): deny-all heartbeat cell; Presence owns who''s-online');
select is(
  (select count(*) from pg_trigger t
   join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = any (array['public.league_members'::regclass, 'public.team_managers'::regclass,
                                'public.league_invites'::regclass, 'public.league_lists'::regclass])
     and p.proname like 'broadcast%'),
  0::bigint,
  'the F42 set (league_members/team_managers/league_invites/league_lists) stays trigger-less — re-waived per table (D38 rationale; F8 flips WITHOUT them; league_weeks LEFT the set at 119/L.D1.9 with its first subscriber — D296; teams LEFT it at 120/L.D1.10 — R856, pinned in 068 A11)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — BEFORE any JWT claims; D49(7)).
--    u01 commissioner + u02 manager of LR · u03 owns LS (foreign league) ·
--    u99 outsider. Drafts: DR1 live in LR (future deadline — never due),
--    DS scheduled in LS, DX live in LX (LX soft-deleted at insert — the
--    R141 heartbeat exclusion). One team + one player for the pick FK.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('94000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated',
  'pgtap-rt' || lpad(i::text, 2, '0') || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  jsonb_build_object('username', 'rt_user_' || lpad(i::text, 2, '0')),
  now(), now()
from unnest(array[1, 2, 3, 99]) i;

insert into players (id, full_name, position, adp) values
  ('rt-rb01', 'RT RB 01', 'RB', 1);

insert into leagues (id, owner_id, name, season, status, team_count, settings, deleted_at) values
  ('b9000000-0000-4000-8000-0000000000a1', '94000000-0000-4000-8000-000000000001',
   'pgtap-rt-LR', 2026, 'scheduled', 8, '{}', null),
  ('b9000000-0000-4000-8000-0000000000b1', '94000000-0000-4000-8000-000000000003',
   'pgtap-rt-LS-foreign', 2026, 'scheduled', 8, '{}', null),
  ('b9000000-0000-4000-8000-0000000000c1', '94000000-0000-4000-8000-000000000003',
   'pgtap-rt-LX-deleted', 2026, 'scheduled', 8, '{}', now());

insert into teams (id, owner_id, name, league_id) values
  ('c9000000-0000-4000-8000-0000000000a1', '94000000-0000-4000-8000-000000000001',
   'pgtap-rt-t01', 'b9000000-0000-4000-8000-0000000000a1');

insert into league_members (league_id, user_id, team_id, role) values
  ('b9000000-0000-4000-8000-0000000000a1', '94000000-0000-4000-8000-000000000001',
   'c9000000-0000-4000-8000-0000000000a1', 'commissioner'),
  ('b9000000-0000-4000-8000-0000000000a1', '94000000-0000-4000-8000-000000000002',
   null, 'manager'),
  ('b9000000-0000-4000-8000-0000000000b1', '94000000-0000-4000-8000-000000000003',
   null, 'commissioner');

insert into drafts (id, league_id, status, current_deadline) values
  ('d9000000-0000-4000-8000-0000000000a1', 'b9000000-0000-4000-8000-0000000000a1',
   'live', now() + interval '10 minutes'),
  ('d9000000-0000-4000-8000-0000000000b1', 'b9000000-0000-4000-8000-0000000000b1',
   'scheduled', null),
  ('d9000000-0000-4000-8000-0000000000c1', 'b9000000-0000-4000-8000-0000000000c1',
   'live', null);

-- Post-reset race guard: make sure today's (and tomorrow's, for a run
-- straddling midnight UTC) realtime.messages partitions exist — the
-- realtime service creates them at boot, but this file must not depend on
-- container timing. Rolled back with everything else if created here.
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

-- ---------------------------------------------------------------------------
-- C. Payload-shape unit pins (task item 4 — the column-select functions)
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(k order by k)
   from drafts d,
        jsonb_object_keys(public.draft_broadcast_payload(d)) k
   where d.id = 'd9000000-0000-4000-8000-0000000000a1'),
  array['budget_adjustments', 'current_deadline', 'current_nomination', 'current_pick_number',
        'current_round', 'deadline_remaining_ms', 'on_clock_team_id', 'paused_at', 'status',
        'updated_at'],
  'drafts payload = EXACTLY the §5 inventory + deadline_remaining_ms (recorded extension, D109) + the D134 auction pair current_nomination/budget_adjustments (088/L.C1.6) — 10 keys (amended in place from the 070-era 8: tests are tests, D137)');
select ok(
  (select not public.draft_broadcast_payload(d) ?| array['config', 'is_mock', 'id', 'league_id',
                                                         'nomination_order', 'draft_order',
                                                         'started_at']
   from drafts d where d.id = 'd9000000-0000-4000-8000-0000000000a1'),
  'drafts payload NEVER carries config (the §7.3.8 blob — blind), ids, the orders, or started_at (named negatives — current_nomination LEFT this list at 088/D134; 037 owns the auction-era inventory)');
select is(
  (select array_agg(k order by k)
   from (select row(gen_random_uuid(), 'd9000000-0000-4000-8000-0000000000a1'::uuid,
                    'b9000000-0000-4000-8000-0000000000a1'::uuid, 1, 1,
                    'c9000000-0000-4000-8000-0000000000a1'::uuid, 'rt-rb01', null::integer,
                    false, false, null::uuid, 'manager', null::uuid, now())::draft_picks as p) x,
        jsonb_object_keys(public.draft_pick_broadcast_payload(x.p)) k),
  array['is_auto', 'is_undone', 'pick_number', 'player_id', 'price', 'round', 'team_id'],
  'draft_picks payload = EXACTLY the §5 six (pick_number, round, team_id, player_id, is_auto, is_undone) + price (D134, 088/L.C1.6 — amended in place from six)');
select ok(
  (select not public.draft_pick_broadcast_payload(p) ?| array['action_id', 'picked_by', 'made_via',
                                                              'id', 'league_id', 'draft_id']
   from (select row(gen_random_uuid(), 'd9000000-0000-4000-8000-0000000000a1'::uuid,
                    'b9000000-0000-4000-8000-0000000000a1'::uuid, 1, 1,
                    'c9000000-0000-4000-8000-0000000000a1'::uuid, 'rt-rb01', null::integer,
                    false, false, null::uuid, 'manager', null::uuid, now())::draft_picks as p) x),
  'draft_picks payload NEVER carries action_id (another client''s idempotency key), picked_by, made_via, or ids (named negatives — price LEFT this list at 088/D134: the auction board renders spend)');
select is(
  (select array_agg(k order by k)
   from (select row(gen_random_uuid(), 'b9000000-0000-4000-8000-0000000000a1'::uuid,
                    '94000000-0000-4000-8000-000000000001'::uuid, 'hello', now(),
                    'league', false)::league_chat as c) x,
        jsonb_object_keys(public.league_chat_broadcast_payload(x.c)) k),
  array['context', 'created_at', 'id', 'is_system', 'message', 'user_id'],
  'league_chat payload = exactly what the chat pane renders (id/user_id/message/context/is_system/created_at)');
select is(
  (select public.league_broadcast_payload(l)
   from leagues l where l.id = 'b9000000-0000-4000-8000-0000000000a1'),
  '{"name": "pgtap-rt-LR", "status": "scheduled", "avatar_url": null}'::jsonb,
  'leagues payload = EXACTLY {status, name, avatar_url} — §5''s "only", exact-jsonb equality (THE break-probe pin)');
select ok(
  (select not public.league_broadcast_payload(l) ?| array['settings', 'scoring_rules_snapshot',
                                                          'invite_code', 'invite_slug',
                                                          'creation_action_id', 'owner_id', 'id']
   from leagues l where l.id = 'b9000000-0000-4000-8000-0000000000a1'),
  'leagues payload NEVER carries settings / scoring_rules_snapshot / invite_code / invite_slug / creation_action_id (the §9.2 "nothing blind" negatives)');

-- ---------------------------------------------------------------------------
-- D. Trigger behavior end-to-end in-DB (privileged writes → stored rows)
-- ---------------------------------------------------------------------------
update drafts set current_pick_number = 2
where id = 'd9000000-0000-4000-8000-0000000000a1';
select is(
  (select count(*) from realtime.messages
   where topic = 'draft:d9000000-0000-4000-8000-0000000000a1' and event = 'drafts'),
  1::bigint,
  'a drafts UPDATE broadcasts ONE event ''drafts'' on its draft:<id> topic');
select ok(
  (select m.payload->>'operation' = 'UPDATE'
       and m.payload->>'table' = 'drafts'
       and m.payload->>'schema' = 'public'
       and m.payload->'record'->>'current_pick_number' = '2'
       and not (m.payload->'record' ? 'config')
       and (select count(*) from jsonb_object_keys(m.payload->'record')) = 10
   from realtime.messages m
   where m.topic = 'draft:d9000000-0000-4000-8000-0000000000a1' and m.event = 'drafts'),
  'the drafts message carries the broadcast_changes-shaped envelope with the COLUMN-SELECTED record (10 keys after 088/D134, no config)');

insert into draft_picks (id, draft_id, league_id, pick_number, round, team_id, player_id)
values ('e9000000-0000-4000-8000-0000000000a1', 'd9000000-0000-4000-8000-0000000000a1',
        'b9000000-0000-4000-8000-0000000000a1', 1, 1,
        'c9000000-0000-4000-8000-0000000000a1', 'rt-rb01');
select is(
  (select m.payload->'record' from realtime.messages m
   where m.topic = 'draft:d9000000-0000-4000-8000-0000000000a1' and m.event = 'draft_picks'),
  '{"price": null, "round": 1, "is_auto": false, "team_id": "c9000000-0000-4000-8000-0000000000a1", "is_undone": false, "player_id": "rt-rb01", "pick_number": 1}'::jsonb,
  'a pick INSERT broadcasts the exact §5 six-column record + price (NULL on a snake row — D134/088) on the draft topic (exact-jsonb equality)');
update draft_picks set is_undone = true
where id = 'e9000000-0000-4000-8000-0000000000a1';
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d9000000-0000-4000-8000-0000000000a1' and m.event = 'draft_picks'
     and m.payload->>'operation' = 'UPDATE'
     and m.payload->'record'->>'is_undone' = 'true'),
  1::bigint,
  'a pick UPDATE (undo flip) broadcasts too — the board hears is_undone flips (§5: draft_picks INSERT/UPDATE)');

update leagues set name = 'pgtap-rt-LR-renamed'
where id = 'b9000000-0000-4000-8000-0000000000a1';
select is(
  (select m.payload->'record' from realtime.messages m
   where m.topic = 'league:b9000000-0000-4000-8000-0000000000a1' and m.event = 'leagues'),
  '{"name": "pgtap-rt-LR-renamed", "status": "scheduled", "avatar_url": null}'::jsonb,
  'a leagues name UPDATE broadcasts {status, name, avatar_url} ONLY on league:<id> (the home-hero/draft-bar flip)');
update leagues set settings = '{"probe": true}'
where id = 'b9000000-0000-4000-8000-0000000000a1';
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'league:b9000000-0000-4000-8000-0000000000a1' and m.event = 'leagues'),
  1::bigint,
  'a settings-only leagues UPDATE emits NOTHING — the column-trigger discriminator (nothing a client renders changed)');

-- The 069 system-post shape (definer INSERT, user_id NULL, is_system TRUE)
-- reaches the room through the same trigger.
insert into league_chat (league_id, user_id, message, context, is_system)
values ('b9000000-0000-4000-8000-0000000000a1', null,
        'System: probe post.', 'draft:d9000000-0000-4000-8000-0000000000a1', true);
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d9000000-0000-4000-8000-0000000000a1' and m.event = 'league_chat'
     and m.payload->'record'->>'is_system' = 'true'
     and m.payload->'record'->>'user_id' is null),
  1::bigint,
  'a SYSTEM post (user_id NULL — the tick/069 shape) broadcasts to the draft topic: the room sees every override (§16.3/D97)');

-- ---------------------------------------------------------------------------
-- E. Heartbeat (068 ARM 3) — lock-free beat on live drafts only
-- ---------------------------------------------------------------------------
create temporary table rt_tick_summary on commit drop as
select public.draft_tick() as s;
select ok(
  (select (s->>'heartbeats')::int >= 1 from rt_tick_summary),
  'draft_tick reports >= 1 heartbeat (containment — committed wire-suite leftovers are legal concurrent actors, 022 rule)');
select is(
  (select s->'heartbeat_failures' from rt_tick_summary),
  '[]'::jsonb,
  'zero heartbeat failures on the pass');
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d9000000-0000-4000-8000-0000000000a1' and m.event = 'tick'),
  1::bigint,
  'the LIVE draft got exactly one ''tick'' beat from the pass (§9.1 clock-drift heartbeat, per-pass vehicle — D109)');
select is(
  (select array_agg(k order by k)
   from realtime.messages m, jsonb_object_keys(m.payload) k
   where m.topic = 'draft:d9000000-0000-4000-8000-0000000000a1' and m.event = 'tick'),
  array['current_deadline', 'id', 'server_now'],
  'tick payload keys = {server_now, current_deadline} + the id realtime.send() injects (documented — 070 banner)');
select is(
  (select m.payload->'current_deadline' from realtime.messages m
   where m.topic = 'draft:d9000000-0000-4000-8000-0000000000a1' and m.event = 'tick'),
  (select to_jsonb(d.current_deadline) from drafts d
   where d.id = 'd9000000-0000-4000-8000-0000000000a1'),
  'the beat carries the AUTHORITATIVE deadline (server timestamps only — §9.3: clients never own the clock)');
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d9000000-0000-4000-8000-0000000000b1' and m.event = 'tick'),
  0::bigint,
  'a SCHEDULED draft gets NO beat (nothing live to correct)');
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'draft:d9000000-0000-4000-8000-0000000000c1' and m.event = 'tick'),
  0::bigint,
  'a live draft under a SOFT-DELETED league gets NO beat (the R141 deleted-league discipline; F50 owns the zombie class)');

-- ---------------------------------------------------------------------------
-- F. Probe rows for the channel-auth matrix (privileged, before claims)
-- ---------------------------------------------------------------------------
select realtime.send('{}'::jsonb, 'probe', 'league:b9000000-0000-4000-8000-0000000000a1', true);
select realtime.send('{}'::jsonb, 'probe', 'draft:d9000000-0000-4000-8000-0000000000a1', true);
select realtime.send('{}'::jsonb, 'probe', 'league:b9000000-0000-4000-8000-0000000000b1', true);
select realtime.send('{}'::jsonb, 'probe', 'draft:d9000000-0000-4000-8000-0000000000a1:junk', true);
select realtime.send('{}'::jsonb, 'probe', 'league:junk', true);

-- ---------------------------------------------------------------------------
-- G. Chat INSERT through the client surface fires the broadcast (u02 — the
--    one sanctioned direct client write, §9.3/D99). JWT claims from here.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
insert into league_chat (league_id, user_id, message, context)
values ('b9000000-0000-4000-8000-0000000000a1',
        '94000000-0000-4000-8000-000000000002', 'gl this season', 'league');
reset role;
select is(
  (select count(*) from realtime.messages m
   where m.topic = 'league:b9000000-0000-4000-8000-0000000000a1' and m.event = 'league_chat'
     and m.payload->'record'->>'user_id' = '94000000-0000-4000-8000-000000000002'),
  1::bigint,
  'a MEMBER''s direct chat INSERT (the sanctioned client write) broadcasts to league:<id> with the column-selected record');

-- ---------------------------------------------------------------------------
-- H. Channel-auth READ matrix (the behavioral topic-read — task item 4;
--    realtime.topic() reads the config Realtime sets per auth check)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('realtime.topic', 'league:b9000000-0000-4000-8000-0000000000a1', true);
select is(
  (select count(*) from realtime.messages
   where topic = 'league:b9000000-0000-4000-8000-0000000000a1' and event = 'probe'),
  1::bigint,
  'MEMBER reads their league topic (the §9.2 league policy passes)');
select set_config('realtime.topic', 'draft:d9000000-0000-4000-8000-0000000000a1', true);
select is(
  (select count(*) from realtime.messages
   where topic = 'draft:d9000000-0000-4000-8000-0000000000a1' and event = 'probe'),
  1::bigint,
  'MEMBER reads their draft topic (the drafts.league_id lookup passes)');
select set_config('realtime.topic', 'league:b9000000-0000-4000-8000-0000000000b1', true);
select is(
  (select count(*) from realtime.messages
   where topic = 'league:b9000000-0000-4000-8000-0000000000b1' and event = 'probe'),
  0::bigint,
  'member of LR reads ZERO rows on a FOREIGN league topic (membership is the gate)');
select set_config('realtime.topic', 'draft:d9000000-0000-4000-8000-0000000000a1:junk', true);
select is(
  (select count(*) from realtime.messages
   where topic = 'draft:d9000000-0000-4000-8000-0000000000a1:junk'),
  0::bigint,
  'a TRAILING-JUNK draft topic (''draft:<valid-id>:junk'') matches NO policy — the R117 exact-grammar shape, no shadow channel');
select set_config('realtime.topic', 'league:junk', true);
select throws_ok(
  $$ select count(*) from realtime.messages where topic = 'league:junk' $$,
  '22P02', null,
  'the spec-printed league policy ERRORS (22P02) on a malformed non-uuid topic — refusal-by-error, the recorded 070 residual');

-- Outsider u99: nothing, anywhere.
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000099", "role": "authenticated"}', true);
select set_config('realtime.topic', 'league:b9000000-0000-4000-8000-0000000000a1', true);
select is(
  (select count(*) from realtime.messages
   where topic = 'league:b9000000-0000-4000-8000-0000000000a1' and event = 'probe'),
  0::bigint,
  'NON-MEMBER reads ZERO rows on the league topic');
select set_config('realtime.topic', 'draft:d9000000-0000-4000-8000-0000000000a1', true);
select is(
  (select count(*) from realtime.messages
   where topic = 'draft:d9000000-0000-4000-8000-0000000000a1' and event = 'probe'),
  0::bigint,
  'NON-MEMBER reads ZERO rows on the draft topic (the behavioral half of the wire suite''s "gets nothing")');

-- Anon: the policies are TO authenticated — deny-by-default.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select set_config('realtime.topic', 'league:b9000000-0000-4000-8000-0000000000a1', true);
select is(
  (select count(*) from realtime.messages
   where topic = 'league:b9000000-0000-4000-8000-0000000000a1' and event = 'probe'),
  0::bigint,
  'ANON reads ZERO rows (policies are TO authenticated; platform grants alone open nothing)');
reset role;

-- ---------------------------------------------------------------------------
-- I. Channel-auth WRITE matrix (presence-only INSERT — 070 banner item 3)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('realtime.topic', 'draft:d9000000-0000-4000-8000-0000000000a1', true);
select lives_ok(
  $$ insert into realtime.messages (topic, extension, payload, event, private)
     values ('draft:d9000000-0000-4000-8000-0000000000a1', 'presence', '{}', 'presence', true) $$,
  'MEMBER may track presence on their draft topic (§9.1 Presence; INSERT policy passes)');
select throws_ok(
  $$ insert into realtime.messages (topic, extension, payload, event, private)
     values ('draft:d9000000-0000-4000-8000-0000000000a1', 'broadcast', '{}', 'drafts', true) $$,
  '42501', null,
  'MEMBER may NOT client-broadcast on the draft topic — the server-spoof channel stays closed (a forged ''drafts'' event is impossible)');
select set_config('realtime.topic', 'league:b9000000-0000-4000-8000-0000000000a1', true);
select lives_ok(
  $$ insert into realtime.messages (topic, extension, payload, event, private)
     values ('league:b9000000-0000-4000-8000-0000000000a1', 'presence', '{}', 'presence', true) $$,
  'MEMBER may track presence on their league topic');
select set_config('realtime.topic', 'league:b9000000-0000-4000-8000-0000000000b1', true);
select throws_ok(
  $$ insert into realtime.messages (topic, extension, payload, event, private)
     values ('league:b9000000-0000-4000-8000-0000000000b1', 'presence', '{}', 'presence', true) $$,
  '42501', null,
  'presence on a FOREIGN league topic refused (membership is the write gate too)');
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000099", "role": "authenticated"}', true);
select set_config('realtime.topic', 'draft:d9000000-0000-4000-8000-0000000000a1', true);
select throws_ok(
  $$ insert into realtime.messages (topic, extension, payload, event, private)
     values ('draft:d9000000-0000-4000-8000-0000000000a1', 'presence', '{}', 'presence', true) $$,
  '42501', null,
  'NON-MEMBER presence refused on the draft topic');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select set_config('realtime.topic', 'league:b9000000-0000-4000-8000-0000000000a1', true);
select throws_ok(
  $$ insert into realtime.messages (topic, extension, payload, event, private)
     values ('league:b9000000-0000-4000-8000-0000000000a1', 'presence', '{}', 'presence', true) $$,
  '42501', null,
  'ANON presence refused (deny-by-default per role — §4.2)');
reset role;

-- Presence rows are member-READABLE on their topic (presence sync rides the
-- same SELECT policies — no extension filter on the read side).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('realtime.topic', 'draft:d9000000-0000-4000-8000-0000000000a1', true);
select is(
  (select count(*) from realtime.messages
   where topic = 'draft:d9000000-0000-4000-8000-0000000000a1' and extension = 'presence'),
  1::bigint,
  'the member reads the presence row on their draft topic (presence sync readable — SELECT policies cover both extensions)');
reset role;

select * from finish();
rollback;
