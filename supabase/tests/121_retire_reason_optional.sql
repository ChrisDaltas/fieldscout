-- ============================================================================
-- 121 — retiring a team: the reason is OPTIONAL (migration 173; M6 L.E1.40;
--       F363(a), F546, F262(a); spec §7.2.1(b), §10.3, §12.12, §15.1, E49;
--       PROGRESS Q66 / C82, D290, D320, D450, D461)
-- ============================================================================
-- What this file proves, over REAL calls of remove_manager(mode = retire):
--   * no reason (absent / blank / whitespace / a tab and a newline) RETIRES
--     the team: the payload, the ledger row (transactions commissioner_move)
--     and the receipt (commissioner_actions retire_franchise) carry reason
--     NULL, the league post has NO "— reason:" tail, the removed manager is
--     still notified, and the audit is written all the same (E49's
--     "audited override" is the audit, not the reason);
--   * a reason given is stored TRIMMED on all three and closes the post;
--   * the 500 bound: 500 characters retire, 501 are refused BY NAME with the
--     seam's sentence and nothing is written;
--   * what did NOT move: the action_id is still required (22023 by name),
--     the replay returns the stored payload byte-identical, the playoffs
--     still refuse by name (pending Q41), before the draft still refuses
--     (D42's text), a complete league retires "after the season", and
--     vacate / takeover are untouched;
--   * D137 in the database: pg_temp.un173 reverses 173's three hunks to
--     169's live body (the md5 pgTAP 117 A4 stores).
--
-- Worlds (fabricated inside this rolled-back transaction):
--   LI b121…01  in_season, weeks 1–5 final, week 6 live — u1 commissioner
--               (t1), u2..u7 managers (t2..t7)
--   LP b121…02  playoffs — u1 (t1), u2 (t2)
--   LS b121…03  setup — u1 (t1), u2 (t2)
--   LC b121…04  complete, every week final — u1 (t1), u2 (t2)
--   u8 holds no seat (the takeover's successor).
-- Descriptions carry no bare apostrophes (house rule).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(41);

-- pg_temp.un173 — 173's three hunks reversed (derive_173.py; each
-- replacement text occurs once, in remove_manager only).
create function pg_temp.un173(s text) returns text language plpgsql as $un$
begin
  s := replace(s, $r$    -- (b) The audit stamp and the reason (E49 "audited override"; D290's
    --     interim posture: reason REQUIRED, stored on the ledger row).
    --     173 / F363(a) — Q66 (v2.16.41, C82): the reason is OPTIONAL. Blank
    --     or whitespace-only (the explicit class, 123:295 — R1328: the same
    --     class the receipt seam trims) is NULL; past 500 characters the
    --     receipt seam refuses it BY NAME (168:196) and the whole retirement
    --     rolls back. The action_id stays REQUIRED (the replay stamp).
$r$, $o$    -- (b) The audit stamp and the reason (E49 "audited override"; D290's
    --     interim posture: reason REQUIRED, stored on the ledger row).
$o$);
  s := replace(s, $r$    v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
$r$, $o$    v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'remove_manager: retiring a franchise is an audited override — a reason is required (E49 / D290)'
        USING ERRCODE = '22023';
    END IF;
$o$);
  s := replace(s, $r$      || ' (roster and record carry over for seeding only; head-to-head history does not — §7.2.1(b))'
      -- 173 / Q66: no reason, no "— reason:" tail (league_chat.message is
      -- NOT NULL — `|| NULL` would null the whole post).
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;
$r$, $o$      || ' (roster and record carry over for seeding only; head-to-head history does not — §7.2.1(b)) — reason: ' || v_reason;
$o$);
  return s;
end
$un$;

-- ---------------------------------------------------------------------------
-- A. Form, and D137 in the database
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', pg_get_function_identity_arguments(p.oid), p.prosecdef,
                            array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'remove_manager'),
  'p_league_id uuid, p_member_id uuid, p_mode text, p_successor_user_id uuid, p_reason text, p_action_id uuid:t:search_path="":f:t',
  'A1 remove_manager keeps ONE overload, its six arguments, SECURITY DEFINER, search_path empty, anon closed, authenticated open');
select is(
  (select md5(pg_temp.un173(p.prosrc)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'remove_manager'),
  '06921fe6b49594376fdf7f521ba41c36',
  'A2 D137: the live body with 173 reversed is 169 as written (the stored md5 pgTAP 117 A4 pins)');
select is(
  (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'remove_manager'),
  '3698941d72d6efa0f1f7fa599a607a40',
  'A3 the live prosrc md5 — 173 as written (stored literal)');
select ok(
  (select p.prosrc not like '%a reason is required%' and p.prosrc like '%CASE WHEN v_reason IS NOT NULL THEN %'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'remove_manager'),
  'A4 the retire arm no longer carries the reason-required refusal, and its post tail is conditional');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname <> 'remove_manager' and pg_temp.un173(p.prosrc) <> p.prosrc),
  0,
  'A5 un173 is an identity on every other body in the schema (the older suites apply it innermost — additive, R992)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (privileged, before any JWT claims — D49(7))
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('97121000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-e121-u' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       ('{"username": "e121_user_' || i || '"}')::jsonb, now(), now()
from generate_series(1, 8) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams,
                     playoff_start_week, scoring_system_id, scoring_rules_snapshot, faab_budget, settings)
select ('b1210000-0000-4000-8000-00000000000' || l)::uuid, '97121000-0000-4000-8000-000000000001',
       'pgtap-e121-L' || l, 2026,
       case l when 1 then 'in_season' when 2 then 'playoffs' when 3 then 'setup' else 'complete' end,
       8, 14, case when l = 2 then 4 else 0 end, 15,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       case when l <> 3 then (select rules from scoring_systems where is_template and name = 'ESPN Standard') end,
       100, '{}'::jsonb
from generate_series(1, 4) l;

-- LI seats t1..t7; LP / LS / LC seats t1..t2.
insert into teams (id, owner_id, name, league_id)
select ('c121000' || l || '-0000-4000-8000-00000000000' || i)::uuid,
       ('97121000-0000-4000-8000-00000000000' || i)::uuid,
       'e121-L' || l || '-t' || i,
       ('b1210000-0000-4000-8000-00000000000' || l)::uuid
from generate_series(1, 4) l, generate_series(1, 7) i
where l = 1 or i <= 2;
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, t.owner_id, t.id,
       case when t.owner_id = '97121000-0000-4000-8000-000000000001' then 'commissioner' else 'manager' end, false, 100
from teams t where t.id::text like 'c121000%';
insert into team_managers (league_id, team_id, user_id, role)
select t.league_id, t.id, t.owner_id, 'manager' from teams t where t.id::text like 'c121000%';

-- LI: weeks 1–5 final, week 6 live (the successor book opens at week 6).
insert into league_weeks (league_id, season, week)
select 'b1210000-0000-4000-8000-000000000001', 2026, w from generate_series(1, 14) w;
update league_weeks set status = 'live'              where league_id = 'b1210000-0000-4000-8000-000000000001' and week <= 6;
update league_weeks set status = 'correction_window' where league_id = 'b1210000-0000-4000-8000-000000000001' and week <= 5;
update league_weeks set status = 'final'             where league_id = 'b1210000-0000-4000-8000-000000000001' and week <= 5;
-- LC: every week final (no week left to open a book — "after the season").
insert into league_weeks (league_id, season, week)
select 'b1210000-0000-4000-8000-000000000004', 2026, w from generate_series(1, 14) w;
update league_weeks set status = 'live'              where league_id = 'b1210000-0000-4000-8000-000000000004';
update league_weeks set status = 'correction_window' where league_id = 'b1210000-0000-4000-8000-000000000004';
update league_weeks set status = 'final'             where league_id = 'b1210000-0000-4000-8000-000000000004';

-- The member id of league l, user i.
create function pg_temp.m(l int, i int) returns uuid language sql as $$
  select lm.id from public.league_members lm
  where lm.league_id = ('b1210000-0000-4000-8000-00000000000' || l)::uuid
    and lm.user_id = ('97121000-0000-4000-8000-00000000000' || i)::uuid
$$;
-- What the retirement of team (l, i) left behind — the ledger payload reason,
-- the receipt reason, and the post (one each, or the count when not one).
create function pg_temp.trail(l int, i int) returns jsonb language sql as $$
  select jsonb_build_object(
    'ledger', (select jsonb_agg(t.payload -> 'reason') from public.transactions t
               where t.league_id = ('b1210000-0000-4000-8000-00000000000' || l)::uuid
                 and t.type = 'commissioner_move'
                 and t.payload ->> 'retired_team_id' = 'c121000' || l || '-0000-4000-8000-00000000000' || i),
    'receipt', (select jsonb_agg(to_jsonb(ca.reason)) from public.commissioner_actions ca
                where ca.league_id = ('b1210000-0000-4000-8000-00000000000' || l)::uuid
                  and ca.action_type = 'retire_franchise'
                  and ca.target_id = 'c121000' || l || '-0000-4000-8000-00000000000' || i),
    'post', (select jsonb_agg(c.message) from public.league_chat c
             where c.league_id = ('b1210000-0000-4000-8000-00000000000' || l)::uuid
               and c.is_system and c.message like 'e121-L' || l || '-t' || i || ' was retired by %'))
$$;

-- ---------------------------------------------------------------------------
-- C. No reason RETIRES the team (LI, in season) — F363(a)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97121000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

-- C1–C4: the reason ABSENT (the route omits it) — t2.
create temp table _r2 as
select public.remove_manager('b1210000-0000-4000-8000-000000000001', pg_temp.m(1, 2), 'retire', NULL, NULL,
                             'a1210000-0000-4000-8000-000000000002') as r;
select is(
  (select jsonb_build_array(r ->> 'ok', r ->> 'verb', r ->> 'retired_team_name', r ->> 'successor_team_name',
                            r ->> 'retired_at_week', r ? 'reason', r -> 'reason') from _r2),
  '["true", "retire_franchise", "e121-L1-t2", "Team 8", "6", true, null]'::jsonb,
  'C1 no reason: the team RETIRES — sealed, its successor Team 8 from Week 6, and the payload reason is null (present, not missing)');
select is(pg_temp.trail(1, 2),
  '{"ledger": [null], "receipt": [null],
    "post": ["e121-L1-t2 was retired by e121_user_1 — the franchise is sealed under its final manager; Team 8 takes its slot from Week 6 (roster and record carry over for seeding only; head-to-head history does not — §7.2.1(b))"]}'::jsonb,
  'C2 the audit is written all the same — ONE ledger row and ONE receipt, each with reason null, and ONE league post with no reason tail');
reset role;
select is(
  (select count(*)::int from notifications n
   where n.user_id = '97121000-0000-4000-8000-000000000002' and n.data ->> 'event' = 'retired'
     and n.data ->> 'team_id' = 'c1210001-0000-4000-8000-000000000002'),
  1, 'C3 the retired manager is still notified (event retired)');
select is(
  (select t.status || ':' || coalesce(t.retired_at_week::text, 'null') from teams t where t.id = 'c1210001-0000-4000-8000-000000000002'),
  'retired:6', 'C4 the team is sealed as retired at week 6');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97121000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

-- C5–C6: a BLANK reason (spaces) — t3. Before 173 this was 068 C0d: 22023.
select is(
  (public.remove_manager('b1210000-0000-4000-8000-000000000001', pg_temp.m(1, 3), 'retire', NULL, '    ',
                         'a1210000-0000-4000-8000-000000000003') -> 'reason'),
  'null'::jsonb,
  'C5 a blank reason (spaces only) RETIRES the team with the reason null — never refused (Q66)');
select is(pg_temp.trail(1, 3) -> 'receipt', '[null]'::jsonb, 'C6 its receipt reason is NULL');

-- C7–C8: a tab and a newline only — t4 (R1328: 169 trimmed spaces only, so
-- this passed the check but was stored NULL on the receipt and posted blank).
select is(
  (public.remove_manager('b1210000-0000-4000-8000-000000000001', pg_temp.m(1, 4), 'retire', NULL, E'\t\n \r',
                         'a1210000-0000-4000-8000-000000000004') -> 'reason'),
  'null'::jsonb,
  'C7 a reason of only a tab, a newline and a return is no reason — the payload says null');
select is(pg_temp.trail(1, 4),
  '{"ledger": [null], "receipt": [null],
    "post": ["e121-L1-t4 was retired by e121_user_1 — the franchise is sealed under its final manager; Team 10 takes its slot from Week 6 (roster and record carry over for seeding only; head-to-head history does not — §7.2.1(b))"]}'::jsonb,
  'C8 …and the ledger, the receipt and the post agree (null, NULL, no tail)');

-- ---------------------------------------------------------------------------
-- D. A reason given is stored TRIMMED and closes the post — t5
-- ---------------------------------------------------------------------------
select is(
  (public.remove_manager('b1210000-0000-4000-8000-000000000001', pg_temp.m(1, 5), 'retire', NULL, E'  moving away \t',
                         'a1210000-0000-4000-8000-000000000005') ->> 'reason'),
  'moving away',
  'D1 a padded reason is stored trimmed on the payload');
select is(pg_temp.trail(1, 5),
  '{"ledger": ["moving away"], "receipt": ["moving away"],
    "post": ["e121-L1-t5 was retired by e121_user_1 — the franchise is sealed under its final manager; Team 11 takes its slot from Week 6 (roster and record carry over for seeding only; head-to-head history does not — §7.2.1(b)) — reason: moving away"]}'::jsonb,
  'D2 the ledger, the receipt and the post carry the trimmed reason — the post exactly as before 173');

-- ---------------------------------------------------------------------------
-- E. The 500 bound — 501 refused by name, nothing written; 500 retires (t6)
-- ---------------------------------------------------------------------------
reset role;
create temp table _before as
select (select count(*) from teams where league_id = 'b1210000-0000-4000-8000-000000000001') as teams,
       (select count(*) from transactions where league_id = 'b1210000-0000-4000-8000-000000000001') as tx,
       (select count(*) from commissioner_actions where league_id = 'b1210000-0000-4000-8000-000000000001') as ca,
       (select count(*) from league_chat where league_id = 'b1210000-0000-4000-8000-000000000001') as chat,
       (select count(*) from notifications where user_id = '97121000-0000-4000-8000-000000000006') as notes;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97121000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  format($$ select public.remove_manager('b1210000-0000-4000-8000-000000000001', %L, 'retire', NULL, %L,
                                          'a1210000-0000-4000-8000-000000000006') $$,
         pg_temp.m(1, 6), '  ' || repeat('x', 501) || '  '),
  '22023', 'remove_manager: the reason is 501 characters — at most 500 (the league_chat bound; §12.13)',
  'E1 a 501-character reason (after trimming) is refused BY NAME with the seam sentence');
reset role;
select is(
  (select jsonb_build_array(
     (select count(*) from teams where league_id = 'b1210000-0000-4000-8000-000000000001') - b.teams,
     (select count(*) from transactions where league_id = 'b1210000-0000-4000-8000-000000000001') - b.tx,
     (select count(*) from commissioner_actions where league_id = 'b1210000-0000-4000-8000-000000000001') - b.ca,
     (select count(*) from league_chat where league_id = 'b1210000-0000-4000-8000-000000000001') - b.chat,
     (select count(*) from notifications where user_id = '97121000-0000-4000-8000-000000000006') - b.notes,
     (select t.status from teams t where t.id = 'c1210001-0000-4000-8000-000000000006'))
   from _before b),
  '[0, 0, 0, 0, 0, "active"]'::jsonb,
  'E2 …and NOTHING was written: no successor, no ledger row, no receipt, no post, no notification; t6 still active');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97121000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select char_length(public.remove_manager('b1210000-0000-4000-8000-000000000001', pg_temp.m(1, 6), 'retire', NULL,
                                            repeat('y', 500), 'a1210000-0000-4000-8000-000000000006') ->> 'reason')),
  500,
  'E3 exactly 500 characters RETIRE the team (the boundary, one unit from E1)');
select is((select jsonb_array_length(pg_temp.trail(1, 6) -> 'receipt')), 1, 'E4 …with ONE receipt');

-- ---------------------------------------------------------------------------
-- F. What did not move (LI)
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ select public.remove_manager('b1210000-0000-4000-8000-000000000001', %L, 'retire', NULL, NULL) $$, pg_temp.m(1, 7)),
  '22023', 'remove_manager: retire requires action_id (idempotency key — one UUID per retirement, reused on retry; 113''s contract)',
  'F1 the action_id is still REQUIRED (the replay stamp) — refused by name, reason or no reason');
select is(
  (public.remove_manager('b1210000-0000-4000-8000-000000000001',
     (select m.id from league_members m join teams t on t.id = m.team_id
      where m.league_id = 'b1210000-0000-4000-8000-000000000001' and t.name = 'Team 8'),
     'retire', NULL, 'a reason on the retry', 'a1210000-0000-4000-8000-000000000002')),
  (select r from _r2),
  'F2 REPLAY: the same action_id returns the stored payload byte for byte (reason null — the retry reason is ignored)');
select is((select jsonb_array_length(pg_temp.trail(1, 2) -> 'receipt')), 1, 'F3 …and writes no second receipt');
select is(
  (select jsonb_build_array(r ->> 'mode', r ->> 'already_vacant', r ? 'reason')
   from (select public.remove_manager('b1210000-0000-4000-8000-000000000001', pg_temp.m(1, 7), 'vacate', NULL, '   ') as r) x),
  '["vacate", "false", false]'::jsonb,
  'F4 vacate is untouched: a blank reason lands and its seven-key result carries no reason (063 shape, 068 I1)');
select is(
  (select jsonb_build_array(ca.action_type, ca.reason)
   from commissioner_actions ca
   where ca.league_id = 'b1210000-0000-4000-8000-000000000001' and ca.target_id = 'c1210001-0000-4000-8000-000000000007'),
  '["vacate_seat", null]'::jsonb,
  'F5 …its receipt reason NULL (the seam, as 169 wrote it)');
select throws_ok(
  format($$ select public.remove_manager('b1210000-0000-4000-8000-000000000001', %L, 'retire', NULL, NULL,
                                          'a1210000-0000-4000-8000-0000000000f7') $$, pg_temp.m(1, 1)),
  '42501', 'remove_manager: you cannot retire your own franchise — a leaver has no choice of outcome (§7.2.1); leave the league, or have the commissioner act on your seat',
  'F6 the own-seat guard still fires first for the commissioner (R858) — with no reason too');

-- ---------------------------------------------------------------------------
-- G. The status gate, unchanged — with NO reason (LP / LS / LC)
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ select public.remove_manager('b1210000-0000-4000-8000-000000000002', %L, 'retire', NULL, NULL,
                                          'a1210000-0000-4000-8000-0000000000b2') $$, pg_temp.m(2, 2)),
  'P0001', 'remove_manager: retiring a franchise during the playoffs is not defined yet — what the bracket does with a retired franchise''s line is PROGRESS Q41; use takeover or vacate now, or retire the franchise after the season (§7.2.1(b))',
  'G1 the playoffs still refuse BY NAME (pending Q41) — the reason rule does not open them');
select throws_ok(
  format($$ select public.remove_manager('b1210000-0000-4000-8000-000000000003', %L, 'retire', NULL, NULL,
                                          'a1210000-0000-4000-8000-0000000000b3') $$, pg_temp.m(3, 2)),
  'P0001', 'remove_manager: retiring a franchise isn''t available before the draft — use takeover or vacate (§7.2.1; retire-and-succeed arrives with the in-season milestone)',
  'G2 before the draft still refuses (D42 text, byte for byte)');
select is(
  (select jsonb_build_array(r ->> 'successor_team_name', r -> 'retired_at_week', r -> 'reason')
   from (select public.remove_manager('b1210000-0000-4000-8000-000000000004', pg_temp.m(4, 2), 'retire', NULL, '',
                                      'a1210000-0000-4000-8000-0000000000b4') as r) x),
  '["Team 3", null, null]'::jsonb,
  'G3 a complete league retires with an empty reason — successor Team 3, no founding week (after the season), reason null');
select is(pg_temp.trail(4, 2) -> 'post',
  '["e121-L4-t2 was retired by e121_user_1 — the franchise is sealed under its final manager; Team 3 takes its slot after the season (roster and record carry over for seeding only; head-to-head history does not — §7.2.1(b))"]'::jsonb,
  'G4 …its post says after the season, with no reason tail');

-- ---------------------------------------------------------------------------
-- H. An UNMANAGED seat (F546 part 3) — the verb rule the UI reads, unchanged
-- ---------------------------------------------------------------------------
-- t7 was vacated in F4 (a closed stint): retirable with no reason, sealed
-- under its last manager, no one notified. Team 8 (t2 successor) has never
-- had a manager: refused by name.
select is(
  (select jsonb_build_array(r -> 'removed_user_id', r -> 'reason', r ->> 'retired_team_name')
   from (select public.remove_manager('b1210000-0000-4000-8000-000000000001',
           (select m.id from league_members m where m.team_id = 'c1210001-0000-4000-8000-000000000007'),
           'retire', NULL, NULL, 'a1210000-0000-4000-8000-0000000000c7') as r) x),
  '[null, null, "e121-L1-t7"]'::jsonb,
  'H1 a VACATED team (a closed stint) retires with no reason — sealed under its last manager, removed_user_id null');
select throws_ok(
  format($$ select public.remove_manager('b1210000-0000-4000-8000-000000000001', %L, 'retire', NULL, NULL,
                                          'a1210000-0000-4000-8000-0000000000c8') $$,
         (select m.id from league_members m join teams t on t.id = m.team_id
          where m.league_id = 'b1210000-0000-4000-8000-000000000001' and t.name = 'Team 8')),
  'P0001', 'remove_manager: Team 8 has never had a manager — there is no one to seal it under; use assign-manager to seat someone on it first (§7.2.1(b))',
  'H2 a team that NEVER had a manager (a successor) still refuses by name — the case the members page keeps closed (F548)');
reset role;
select is(
  (select count(*)::int from notifications n where n.user_id = '97121000-0000-4000-8000-000000000007' and n.data ->> 'event' = 'retired'),
  0, 'H3 no one is notified for the unmanaged retirement (its last manager heard at the vacate)');

-- ---------------------------------------------------------------------------
-- I. Totals — every retirement above wrote ONE ledger row and ONE receipt
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from transactions
   where league_id = 'b1210000-0000-4000-8000-000000000001' and type = 'commissioner_move' and payload ->> 'verb' = 'retire_franchise'),
  6, 'I1 LI: six retirements (t2 t3 t4 t5 t6 t7), six ledger rows — the refusals and the replay wrote none');
select is(
  (select count(*)::int from commissioner_actions
   where league_id = 'b1210000-0000-4000-8000-000000000001' and action_type = 'retire_franchise'),
  6, 'I2 LI: six retire_franchise receipts');
select is(
  (select count(*)::int from commissioner_actions
   where league_id = 'b1210000-0000-4000-8000-000000000001' and action_type = 'retire_franchise' and reason is null),
  4, 'I3 four of them with reason NULL (absent, blank, tab and newline, the vacated seat)');
select is(
  (select count(*)::int from league_chat
   where league_id = 'b1210000-0000-4000-8000-000000000001' and is_system and message like '% was retired by %'
     and message not like '% — reason: %'),
  4, 'I4 four posts without a reason tail, and (I5) two with one');
select is(
  (select count(*)::int from league_chat
   where league_id = 'b1210000-0000-4000-8000-000000000001' and is_system and message like '% was retired by %'
     and message like '% — reason: %'),
  2, 'I5 two posts with a reason tail (t5 moving away, t6 the 500 y)');
select is(
  (select count(*)::int from teams where league_id = 'b1210000-0000-4000-8000-000000000001' and status = 'retired'),
  6, 'I6 six teams sealed retired');
select is(
  (select count(*)::int from teams where league_id = 'b1210000-0000-4000-8000-000000000001' and status <> 'retired'),
  7, 'I7 the league still fields seven teams (every successor fills its slot)');
select is(
  (select count(*)::int from league_members where league_id = 'b1210000-0000-4000-8000-000000000001'),
  7, 'I8 still seven seats — no seat row minted or deleted');
select is(
  (select count(*)::int from team_managers
   where league_id = 'b1210000-0000-4000-8000-000000000001' and end_reason = 'seat_retired'),
  5, 'I9 five stints closed seat_retired (t2..t6) — t7 closed kicked at its vacate and was not touched');

select * from finish();
rollback;
