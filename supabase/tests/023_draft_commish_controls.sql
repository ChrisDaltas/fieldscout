-- ============================================================================
-- Commissioner live draft controls + system chat posts + the outage arm —
-- migration 069 (+ the 068 draft_tick outage amendment) (spec §8.7/§8.8/§17,
-- E4/E15/E31; tasks-M2 §3 D97/D101/D102 + §4.6; task L.B1.4). pgTAP file is
-- **023** (022 = draft tick/autopick; next free confirmed at task time).
--
-- Falsifiability notes (§4.3):
--   * MS-EXACT PAUSE/RESUME (the DoD pin): pgTAP's txn-frozen now() makes
--     boundary instants exact — a deadline planted at now() + 17234 ms must
--     pause to deadline_remaining_ms = 17234 EXACTLY and resume to
--     current_deadline = now() + interval '17234 milliseconds' EXACTLY
--     (integer-millisecond interval math; §8.7 v2.0 "clocks never gain or
--     lose time"). THE DoD BREAK PROBE (shown + reverted in the session
--     log): make draft_resume restore now() + the FULL configured timer
--     instead of the persisted remaining → the resume ms-exact pin fails.
--   * CASCADE GOLDEN (task item 4): 8 live picks, draft_undo(to_pick 3) →
--     EXACTLY picks 4–8 undone (5 rows), 1–3 live, on_clock rewound to the
--     pick-4 team, fresh full clock; pool restoration proven BEHAVIORALLY
--     (the on-clock manager re-picks an undone player).
--   * THE R125 DECISION PIN: pick 4's action_id is replayed AFTER its pick
--     was undone, while its caller IS on the clock and the player IS
--     available — the strongest discriminator: without the deliberate
--     no-is_undone-filter replay arm this exact call would insert a fresh
--     pick; instead it returns the historical (undone) row and writes
--     NOTHING.
--   * E31: after the live-order edit, completed picks are pinned unchanged,
--     the CURRENT pick's team re-derives (changed team ⇒ fresh full clock,
--     pinned exact), and the NEXT advance follows the new order.
--   * RESET + THE D107(5) SEAM: reset is performed under a PAST
--     settings.draft.draft_scheduled_at; the very next draft_tick() call
--     would auto-restart the draft if reset had kept the instant (the D94
--     arm is live in this same database) — the league + draft pinned STILL
--     'scheduled' after the tick IS the seam-closure proof. League-status
--     flip pinned (leagues.status = 'scheduled'); instant pinned CLEARED;
--     draft_order pinned KEPT; draft_liveness pinned wiped.
--   * OUTAGE ARM (068 amended; D102/§8.7:478), boundary-instant precision
--     at the 45s + grace = 75s threshold: fresh commish → never pauses;
--     stale commish + FRESH co-commish → keeps running; freshest commish
--     beat 74s old → keeps running; 76s old → PAUSED (remaining persisted
--     ms-exact, system post with user_id NULL — the tick has no acting
--     user); a fresh beat AFTER the pause does NOT auto-resume (resume is
--     a commissioner action, §8.7 — draft_resume by the commissioner is
--     the pinned exit); a NEVER-CONNECTED draft (zero commissioner
--     liveness rows) is never paused (the D94 unattended-autopilot
--     exemption — §8.7's "disconnects" presupposes a connection).
--   * SYSTEM POSTS (D97): one pinned row PER CONTROL (exact message — they
--     are UX), context = 'draft:<id>', is_system TRUE, the ACTING
--     commissioner's user_id (NULL for the tick's outage post). The
--     recipient-visible half: a plain MANAGER member reads the posts over
--     the authenticated role (the §16.3 room-transparency contract).
--     Idempotent no-ops (double pause/resume, force replay) pinned to add
--     NO post (exact context counts at checkpoints).
--   * league_chat.user_id DROP NOT NULL did not open a client hole: an
--     authenticated INSERT with user_id NULL is refused (the 065 policy
--     pins user_id = auth.uid(); NULL never passes) — pinned.
--   * Tick summary assertions stay containment/≥-based and world state is
--     asserted DIRECTLY on rows (the live 5s cron + committed wire-suite
--     leftovers are legal concurrent actors — the 022 rule; pgTAP fixtures
--     are uncommitted and invisible to the cron).
--   * All privileged fixture work runs BEFORE any JWT claims (D49(7));
--     mid-test privileged steps use `reset role` (013/019/020/022
--     pattern). draft_tick()/draft_apply_pick_internal run privileged
--     (both REVOKEd from authenticated — pinned).
--   * M2 BATCH-5 PINS (R135–R138):
--     - R136 ARM ORDERING (§H): a deadline planted 61s past (beyond the
--       30s grace) under a full commissioner outage → tick → PAUSED with
--       deadline_remaining_ms = -61000 (the D108(2) negative-remaining
--       bookkeeping, ms-exact) and ZERO picks. Falsifiable specifically
--       against arm reordering: had the timeout arm run first it would
--       have AUTOPICKED unconditionally (u05's beat is fresh-at-deadline;
--       even a stale classification's hold expired at deadline+30s) and
--       the pause would have persisted +30000, not -61000.
--     - R135 LOCK SCOPE (§H): pgrowlocks lock-visibility — after the
--       ticks, a fully SUPERVISED live draft (LP, fabricated in §B and
--       never touched by any control RPC — tuple locks carry forward
--       through same-txn updates, so legitimately-claimed rows like LO
--       cannot serve as negative probes) and the NEVER-CONNECTED one (LN)
--       are pinned free of any "For Update" mode (the outage claim is
--       filtered to outage candidates + LIMIT 25; pre-fix every live
--       non-mock draft was locked each tick and held for the rest of the
--       tick txn). PROBE-VALIDITY POSITIVE CONTROL: LR is made due with
--       on_clock NULL — ARM 2 claims it and body-skips WITHOUT writing,
--       so pgrowlocks must still see its FOR UPDATE after the tick (a
--       probe that cannot see tick-held locks fails here, never passes
--       vacuously).
--     - R137 (§I): league_chat.user_id FK is SET NULL (069) — a
--       commissioner-authored system post SURVIVES its author's account
--       deletion (user_id NULL; §12.13 non-deletable / D97 / D99), and an
--       ordinary message survives authorless too (all-rows decision,
--       D108(15)); form pin on confdeltype.
--     - R138 (§E): extend_current on an UNTIMED current pick IMPOSES the
--       full new timer (GREATEST(NULL, now()+45s)) — deadline pinned
--       exact, the distinct "now on the clock" post pinned.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
-- Lock-visibility for the R135 pins (contrib; reads tuple-header lock
-- state, so locks held by THIS txn — e.g. the tick's claims — are
-- observable in-session). Rolled back with the test txn.
create extension if not exists pgrowlocks with schema extensions;
set local search_path = public, extensions;

select plan(161);

-- ---------------------------------------------------------------------------
-- A. Form pins (§4.1 grants doctrine; the 069 surface)
-- ---------------------------------------------------------------------------
select ok(
  (select count(*) = 9 and bool_and(p.prosecdef)
       and bool_and(array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('draft_pause', 'draft_resume', 'draft_set_clock',
                       'draft_undo', 'draft_reassign_pick', 'draft_move_player',
                       'draft_force_pick', 'draft_set_order', 'draft_reset')),
  'all nine §8.7 control RPCs are SECURITY DEFINER with the exact spec-form search_path');
select ok(
  not has_function_privilege('anon', 'public.draft_pause(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_resume(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_set_clock(uuid,integer,boolean,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_undo(uuid,integer,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_reassign_pick(uuid,uuid,uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_move_player(uuid,text,uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_force_pick(uuid,text,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_set_order(uuid,uuid[],text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_reset(uuid,text)', 'EXECUTE'),
  'anon is revoked on all nine control RPCs');
select ok(
  has_function_privilege('authenticated', 'public.draft_pause(uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.draft_reset(uuid,text)', 'EXECUTE'),
  'authenticated keeps EXECUTE (the in-body commissioner check is the gate — no-leak 42501)');
select ok(
  (select not p.prosecdef
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_pause_internal'),
  'draft_pause_internal is plain (non-SECURITY-DEFINER — executes under its SECURITY DEFINER callers, 062 form)');
select ok(
  not has_function_privilege('anon', 'public.draft_pause_internal(uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_pause_internal(uuid,uuid,text)', 'EXECUTE'),
  'draft_pause_internal is revoked from anon AND authenticated (internal surface)');
select col_is_null('public', 'league_chat', 'user_id',
  'league_chat.user_id is nullable (069: the tick''s outage post has no acting user)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — BEFORE any JWT claims; D49(7)).
--    Users u01–u10 (u10 = the R137 FK-survival author, §I) + outsider u99.
--    Worlds:
--      LM b4…a1  main controls (REAL draft_start; u01 commish "Commish
--                Cara", u02 co-commish "Deputy Dana", u03/u04 managers,
--                t5–t8 placeholders; manual order t1..t8, timer 30, grace
--                30)
--      LR b4…b1  capacity mini-world (fabricated live draft e4…b1,
--                total_rounds 1; u07 commish)
--      LX b4…c1  complete-boundary world (fabricated COMPLETE draft e4…c1;
--                u08 commish)
--      LO b4…d1  outage world (REAL start; u05 commish, u06 co-commish,
--                rest placeholders)
--      LN b4…e1  never-connected world (REAL start; u09 commish; ZERO
--                draft_touch calls — the D94 exemption pin)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('93000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated',
  'pgtap-cc' || lpad(i::text, 2, '0') || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  jsonb_build_object('username', 'cc_user_' || lpad(i::text, 2, '0')),
  now(), now()
from generate_series(1, 10) i;
-- u10 exists ONLY as the R137 FK-survival author (§I): no memberships, no
-- teams, no lists — so deleting the account cascades nothing but the
-- profile, isolating the league_chat SET NULL under test.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000099',
   'authenticated', 'authenticated', 'pgtap-cc99@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "cc_outsider_99"}',
   now(), now());

-- Deterministic actor names for the message pins (they are UX).
update profiles set display_name = 'Commish Cara'
where id = '93000000-0000-4000-8000-000000000001';
update profiles set display_name = 'Deputy Dana'
where id = '93000000-0000-4000-8000-000000000002';
update profiles set display_name = 'Commish Otto'
where id = '93000000-0000-4000-8000-000000000005';

-- Players cc-rb01..cc-rb20 (RB, adp 1..20).
insert into players (id, full_name, position, adp)
select 'cc-rb' || lpad(i::text, 2, '0'), 'CC RB ' || lpad(i::text, 2, '0'), 'RB', i
from generate_series(1, 20) i;

-- Leagues.
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings) values
  ('b4000000-0000-4000-8000-0000000000a1', '93000000-0000-4000-8000-000000000001',
   'pgtap-cc-LM-controls', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "snake", "snake_reversal": false, "draft_order_mode": "manual",
     "draft_order": ["c5000000-0000-4000-8000-00a100000001","c5000000-0000-4000-8000-00a100000002",
                     "c5000000-0000-4000-8000-00a100000003","c5000000-0000-4000-8000-00a100000004",
                     "c5000000-0000-4000-8000-00a100000005","c5000000-0000-4000-8000-00a100000006",
                     "c5000000-0000-4000-8000-00a100000007","c5000000-0000-4000-8000-00a100000008"],
     "pick_timer_seconds": 30, "disconnect_grace_seconds": 30}}'),
  ('b4000000-0000-4000-8000-0000000000b1', '93000000-0000-4000-8000-000000000007',
   'pgtap-cc-LR-capacity', 2026, 'scheduled', 8, null, '{}'),
  ('b4000000-0000-4000-8000-0000000000c1', '93000000-0000-4000-8000-000000000008',
   'pgtap-cc-LX-complete', 2026, 'scheduled', 8, null, '{}'),
  ('b4000000-0000-4000-8000-0000000000d1', '93000000-0000-4000-8000-000000000005',
   'pgtap-cc-LO-outage', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "snake", "snake_reversal": false, "draft_order_mode": "manual",
     "draft_order": ["c5000000-0000-4000-8000-00d100000001","c5000000-0000-4000-8000-00d100000002",
                     "c5000000-0000-4000-8000-00d100000003","c5000000-0000-4000-8000-00d100000004",
                     "c5000000-0000-4000-8000-00d100000005","c5000000-0000-4000-8000-00d100000006",
                     "c5000000-0000-4000-8000-00d100000007","c5000000-0000-4000-8000-00d100000008"],
     "pick_timer_seconds": 30, "disconnect_grace_seconds": 30}}'),
  ('b4000000-0000-4000-8000-0000000000e1', '93000000-0000-4000-8000-000000000009',
   'pgtap-cc-LN-never', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "snake", "snake_reversal": false, "draft_order_mode": "manual",
     "draft_order": ["c5000000-0000-4000-8000-00e100000001","c5000000-0000-4000-8000-00e100000002",
                     "c5000000-0000-4000-8000-00e100000003","c5000000-0000-4000-8000-00e100000004",
                     "c5000000-0000-4000-8000-00e100000005","c5000000-0000-4000-8000-00e100000006",
                     "c5000000-0000-4000-8000-00e100000007","c5000000-0000-4000-8000-00e100000008"],
     "pick_timer_seconds": 30, "disconnect_grace_seconds": 30}}');

-- Teams. LM/LO/LN: t01..t08 per world; LR: t01..t08; LX: t01 only.
insert into teams (id, owner_id, name, league_id)
select ('c5000000-0000-4000-8000-00a1000000' || lpad(i::text, 2, '0'))::uuid,
       case
         when i = 1 then '93000000-0000-4000-8000-000000000001'::uuid
         when i = 2 then '93000000-0000-4000-8000-000000000002'::uuid
         when i = 3 then '93000000-0000-4000-8000-000000000003'::uuid
         when i = 4 then '93000000-0000-4000-8000-000000000004'::uuid
         else '93000000-0000-4000-8000-000000000001'::uuid end,
       'pgtap-cc-a1-t' || lpad(i::text, 2, '0'),
       'b4000000-0000-4000-8000-0000000000a1'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c5000000-0000-4000-8000-00b1000000' || lpad(i::text, 2, '0'))::uuid,
       '93000000-0000-4000-8000-000000000007',
       'pgtap-cc-r1-t' || lpad(i::text, 2, '0'),
       'b4000000-0000-4000-8000-0000000000b1'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id) values
  ('c5000000-0000-4000-8000-00c100000001', '93000000-0000-4000-8000-000000000008',
   'pgtap-cc-x1-t01', 'b4000000-0000-4000-8000-0000000000c1');
insert into teams (id, owner_id, name, league_id)
select ('c5000000-0000-4000-8000-00d1000000' || lpad(i::text, 2, '0'))::uuid,
       case
         when i = 1 then '93000000-0000-4000-8000-000000000005'::uuid
         when i = 2 then '93000000-0000-4000-8000-000000000006'::uuid
         else '93000000-0000-4000-8000-000000000005'::uuid end,
       'pgtap-cc-o1-t' || lpad(i::text, 2, '0'),
       'b4000000-0000-4000-8000-0000000000d1'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c5000000-0000-4000-8000-00e1000000' || lpad(i::text, 2, '0'))::uuid,
       '93000000-0000-4000-8000-000000000009',
       'pgtap-cc-n1-t' || lpad(i::text, 2, '0'),
       'b4000000-0000-4000-8000-0000000000e1'
from generate_series(1, 8) i;

-- Members. LM: u01 commish / u02 co-commish / u03 u04 managers / t5–t8
-- placeholders.
insert into league_members (league_id, user_id, team_id, role, is_placeholder) values
  ('b4000000-0000-4000-8000-0000000000a1', '93000000-0000-4000-8000-000000000001',
   'c5000000-0000-4000-8000-00a100000001', 'commissioner', false),
  ('b4000000-0000-4000-8000-0000000000a1', '93000000-0000-4000-8000-000000000002',
   'c5000000-0000-4000-8000-00a100000002', 'co_commissioner', false),
  ('b4000000-0000-4000-8000-0000000000a1', '93000000-0000-4000-8000-000000000003',
   'c5000000-0000-4000-8000-00a100000003', 'manager', false),
  ('b4000000-0000-4000-8000-0000000000a1', '93000000-0000-4000-8000-000000000004',
   'c5000000-0000-4000-8000-00a100000004', 'manager', false),
  ('b4000000-0000-4000-8000-0000000000a1', null,
   'c5000000-0000-4000-8000-00a100000005', 'manager', true),
  ('b4000000-0000-4000-8000-0000000000a1', null,
   'c5000000-0000-4000-8000-00a100000006', 'manager', true),
  ('b4000000-0000-4000-8000-0000000000a1', null,
   'c5000000-0000-4000-8000-00a100000007', 'manager', true),
  ('b4000000-0000-4000-8000-0000000000a1', null,
   'c5000000-0000-4000-8000-00a100000008', 'manager', true);
insert into league_members (league_id, user_id, team_id, role) values
  ('b4000000-0000-4000-8000-0000000000b1', '93000000-0000-4000-8000-000000000007',
   'c5000000-0000-4000-8000-00b100000001', 'commissioner'),
  ('b4000000-0000-4000-8000-0000000000c1', '93000000-0000-4000-8000-000000000008',
   'c5000000-0000-4000-8000-00c100000001', 'commissioner');
insert into league_members (league_id, user_id, team_id, role, is_placeholder) values
  ('b4000000-0000-4000-8000-0000000000d1', '93000000-0000-4000-8000-000000000005',
   'c5000000-0000-4000-8000-00d100000001', 'commissioner', false),
  ('b4000000-0000-4000-8000-0000000000d1', '93000000-0000-4000-8000-000000000006',
   'c5000000-0000-4000-8000-00d100000002', 'co_commissioner', false),
  ('b4000000-0000-4000-8000-0000000000d1', null,
   'c5000000-0000-4000-8000-00d100000003', 'manager', true),
  ('b4000000-0000-4000-8000-0000000000d1', null,
   'c5000000-0000-4000-8000-00d100000004', 'manager', true),
  ('b4000000-0000-4000-8000-0000000000d1', null,
   'c5000000-0000-4000-8000-00d100000005', 'manager', true),
  ('b4000000-0000-4000-8000-0000000000d1', null,
   'c5000000-0000-4000-8000-00d100000006', 'manager', true),
  ('b4000000-0000-4000-8000-0000000000d1', null,
   'c5000000-0000-4000-8000-00d100000007', 'manager', true),
  ('b4000000-0000-4000-8000-0000000000d1', null,
   'c5000000-0000-4000-8000-00d100000008', 'manager', true);
insert into league_members (league_id, user_id, team_id, role, is_placeholder)
select 'b4000000-0000-4000-8000-0000000000e1',
       case when i = 1 then '93000000-0000-4000-8000-000000000009'::uuid end,
       ('c5000000-0000-4000-8000-00e1000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end,
       i > 1
from generate_series(1, 8) i;

-- Fabricated drafts: LR live (deadline NULL — the tick's timeout arm never
-- claims it; no commissioner heartbeats — the outage arm's never-connected
-- exemption leaves it alone, which §H re-pins via LN) + LX complete.
insert into drafts (id, league_id, draft_type, status, is_mock, config,
                    draft_order, total_rounds, current_round, current_pick_number) values
  ('e4000000-0000-4000-8000-0000000000b1', 'b4000000-0000-4000-8000-0000000000b1',
   'snake', 'live', false, '{"pick_timer_seconds": 0}',
   to_jsonb(array['c5000000-0000-4000-8000-00b100000001','c5000000-0000-4000-8000-00b100000002',
                  'c5000000-0000-4000-8000-00b100000003','c5000000-0000-4000-8000-00b100000004',
                  'c5000000-0000-4000-8000-00b100000005','c5000000-0000-4000-8000-00b100000006',
                  'c5000000-0000-4000-8000-00b100000007','c5000000-0000-4000-8000-00b100000008']),
   1, 1, 3),
  ('e4000000-0000-4000-8000-0000000000c1', 'b4000000-0000-4000-8000-0000000000c1',
   'snake', 'complete', false, '{}', null, 1, 1, 2);

-- LP — the R135 LOCK-SCOPE probe world (§H): a live non-mock draft that is
-- FULLY SUPERVISED (fresh commissioner liveness row, planted directly) and
-- NOT due (deadline 1h out), and — decisively — whose drafts row is NEVER
-- touched by any control RPC or legitimate claim in this file, so its
-- tuple can carry NO "For Update" lock unless the tick's outage claim
-- wrongly took one (tuple locks carry forward through same-txn updates,
-- which is why LO — legitimately claimed by the R136 case — cannot serve
-- as this probe). The direct liveness INSERT leaves only an RI "For Key
-- Share" on the drafts row — the harmless share mode every FK write takes;
-- the R135 regression signature is "For Update".
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings) values
  ('b4000000-0000-4000-8000-0000000000f1', '93000000-0000-4000-8000-000000000004',
   'pgtap-cc-LP-lockprobe', 2026, 'scheduled', 8, null, '{}');
insert into teams (id, owner_id, name, league_id) values
  ('c5000000-0000-4000-8000-00f100000001', '93000000-0000-4000-8000-000000000004',
   'pgtap-cc-p1-t01', 'b4000000-0000-4000-8000-0000000000f1');
insert into league_members (league_id, user_id, team_id, role) values
  ('b4000000-0000-4000-8000-0000000000f1', '93000000-0000-4000-8000-000000000004',
   'c5000000-0000-4000-8000-00f100000001', 'commissioner');
insert into drafts (id, league_id, draft_type, status, is_mock, config,
                    draft_order, total_rounds, current_round, current_pick_number,
                    current_deadline) values
  ('e4000000-0000-4000-8000-0000000000f1', 'b4000000-0000-4000-8000-0000000000f1',
   'snake', 'live', false,
   '{"pick_timer_seconds": 30, "disconnect_grace_seconds": 30}',
   to_jsonb(array['c5000000-0000-4000-8000-00f100000001']), 1, 1, 1,
   now() + interval '1 hour');
insert into draft_liveness (draft_id, user_id, last_seen_at) values
  ('e4000000-0000-4000-8000-0000000000f1', '93000000-0000-4000-8000-000000000004', now());
-- LR: t1 holds cc-rb15 (pick 1), t2 holds cc-rb16 (pick 2) — t2 is AT
-- capacity (total_rounds 1).
insert into draft_picks (draft_id, league_id, pick_number, round, team_id, player_id, is_auto, made_via) values
  ('e4000000-0000-4000-8000-0000000000b1', 'b4000000-0000-4000-8000-0000000000b1',
   1, 1, 'c5000000-0000-4000-8000-00b100000001', 'cc-rb15', true, 'autopick'),
  ('e4000000-0000-4000-8000-0000000000b1', 'b4000000-0000-4000-8000-0000000000b1',
   2, 1, 'c5000000-0000-4000-8000-00b100000002', 'cc-rb16', true, 'autopick');

-- ---------------------------------------------------------------------------
-- C. LM starts (real draft_start); the non-commish per-control 42501 sweep
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (public.draft_start('b4000000-0000-4000-8000-0000000000a1')->>'started')::boolean,
  true,
  'LM starts (commissioner u01; manual order t1..t8, timer 30s)');
-- One heartbeat from the commissioner: (a) LM registers a liveness row the
-- reset-wipe pin can observe; (b) it stays FRESH under the frozen now(),
-- so the outage arm never touches LM during the §H ticks.
select lives_ok(
  $$ select public.draft_touch((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1')) $$,
  'the commissioner heartbeats LM (liveness row for the reset-wipe pin)');
reset role;

-- Plant a precise sub-second deadline for the ms-exact pins.
update drafts set current_deadline = now() + interval '17234 milliseconds'
where league_id = 'b4000000-0000-4000-8000-0000000000a1';

-- The sweep: a plain MANAGER member (u03) is refused on every control
-- (§17: pause/undo/reassign/move/reset are commish/co-commish only).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_pause((select id from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1')) $$,
  '42501', 'draft_pause: not a commissioner of this draft''s league',
  'manager draft_pause → 42501');
select throws_ok(
  $$ select public.draft_resume((select id from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1')) $$,
  '42501', 'draft_resume: not a commissioner of this draft''s league',
  'manager draft_resume → 42501');
select throws_ok(
  $$ select public.draft_set_clock((select id from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'), 60) $$,
  '42501', 'draft_set_clock: not a commissioner of this draft''s league',
  'manager draft_set_clock → 42501');
select throws_ok(
  $$ select public.draft_undo((select id from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1')) $$,
  '42501', 'draft_undo: not a commissioner of this draft''s league',
  'manager draft_undo → 42501');
select throws_ok(
  $$ select public.draft_reassign_pick((select id from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
       'a6000000-0000-4000-8000-000000000000', null, 'cc-rb09') $$,
  '42501', 'draft_reassign_pick: not a commissioner of this draft''s league',
  'manager draft_reassign_pick → 42501');
select throws_ok(
  $$ select public.draft_move_player((select id from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
       'cc-rb01', 'c5000000-0000-4000-8000-00a100000001', 'c5000000-0000-4000-8000-00a100000002') $$,
  '42501', 'draft_move_player: not a commissioner of this draft''s league',
  'manager draft_move_player → 42501');
select throws_ok(
  $$ select public.draft_force_pick((select id from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'), 'cc-rb01') $$,
  '42501', 'draft_force_pick: not a commissioner of this draft''s league',
  'manager draft_force_pick → 42501');
select throws_ok(
  $$ select public.draft_set_order((select id from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
       array['c5000000-0000-4000-8000-00a100000001']::uuid[]) $$,
  '42501', 'draft_set_order: not a commissioner of this draft''s league',
  'manager draft_set_order → 42501');
select throws_ok(
  $$ select public.draft_reset((select id from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1')) $$,
  '42501', 'draft_reset: not a commissioner of this draft''s league',
  'manager draft_reset → 42501');

-- No-leak: an outsider on the real draft AND anyone on a nonexistent draft
-- get the SAME 42501.
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000099", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_pause((select id from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1')) $$,
  '42501', 'draft_pause: not a commissioner of this draft''s league',
  'outsider draft_pause → the same 42501');
select throws_ok(
  $$ select public.draft_pause('99999999-0000-4000-8000-000000000000') $$,
  '42501', 'draft_pause: not a commissioner of this draft''s league',
  'nonexistent draft → the SAME 42501 (no existence leak)');
-- The league_chat.user_id nullability opened no client hole: a NULL-user
-- INSERT fails the 065 policy (user_id = auth.uid() is never TRUE on NULL).
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into league_chat (league_id, user_id, message, context)
     values ('b4000000-0000-4000-8000-0000000000a1', null, 'ghost post', 'league') $$,
  '42501', null,
  'client INSERT with user_id NULL → 42501 (069''s DROP NOT NULL is server-side only)');
reset role;

-- ---------------------------------------------------------------------------
-- D. Pause / resume — the ms-exact pins (§8.7 v2.0) + system posts (D97)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('cc.pause1',
  public.draft_pause((select id from drafts
    where league_id = 'b4000000-0000-4000-8000-0000000000a1'))::text, true);
reset role;
select is(
  (current_setting('cc.pause1')::jsonb->>'paused')::boolean, true,
  'draft_pause reports paused: true');
select is(
  (select status || '|' || deadline_remaining_ms::text || '|'
          || coalesce(current_deadline::text, 'NULL')
   from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  'paused|17234|NULL',
  'MS-EXACT PAUSE: a deadline 17234ms out persists deadline_remaining_ms = 17234 exactly; current_deadline NULLed (§8.7 v2.0)');
select is(
  (select paused_at from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  now(),
  'paused_at = now()');

-- Recipient-visible system post (a plain manager reads it — §16.3).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is(
  (select message || '|' || is_system::text || '|' || user_id::text
   from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000a1'
     and context = 'draft:' || (select id from drafts
           where league_id = 'b4000000-0000-4000-8000-0000000000a1')::text
     and is_system),
  'Draft paused by Commish Cara.|true|93000000-0000-4000-8000-000000000001',
  'the pause system post is RECIPIENT-VISIBLE to a plain manager: exact message, is_system, the acting commissioner''s user_id');

-- Double-pause: idempotent no-op — no bookkeeping re-run, no second post.
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('cc.pause2',
  public.draft_pause((select id from drafts
    where league_id = 'b4000000-0000-4000-8000-0000000000a1'))::text, true);
reset role;
select is(
  (current_setting('cc.pause2')::jsonb->>'paused')::boolean, false,
  'double-pause is a D63-class no-op (paused: false)');
select is(
  (select deadline_remaining_ms from drafts
   where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  17234,
  '…and the persisted remaining is NOT recomputed (bookkeeping uncorrupted)');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000a1' and is_system),
  1::bigint,
  '…and no second system post was written');

-- Resume — by the CO-COMMISSIONER (§17: co-commish retains controls).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select set_config('cc.resume1',
  public.draft_resume((select id from drafts
    where league_id = 'b4000000-0000-4000-8000-0000000000a1'))::text, true);
reset role;
select is(
  (current_setting('cc.resume1')::jsonb->>'resumed')::boolean, true,
  'draft_resume by the CO-commissioner succeeds (§17)');
select is(
  (select current_deadline from drafts
   where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  now() + interval '17234 milliseconds',
  'MS-EXACT RESUME: current_deadline = now() + 17234ms EXACTLY — clocks never gain or lose time (§8.7 v2.0; the DoD pin)');
select is(
  (select status || '|' || coalesce(deadline_remaining_ms::text, 'NULL') || '|'
          || coalesce(paused_at::text, 'NULL')
   from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  'live|NULL|NULL',
  '…status live, remaining and paused_at cleared');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000a1' and is_system
     and message = 'Draft resumed by Deputy Dana.'),
  1::bigint,
  'the resume system post names the acting co-commissioner');

-- Double-resume: no-op, no post.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select set_config('cc.resume2',
  public.draft_resume((select id from drafts
    where league_id = 'b4000000-0000-4000-8000-0000000000a1'))::text, true);
reset role;
select is(
  (current_setting('cc.resume2')::jsonb->>'resumed')::boolean, false,
  'double-resume is a no-op (resumed: false)');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000a1' and is_system),
  2::bigint,
  '…and posts nothing (2 system posts total)');

-- ---------------------------------------------------------------------------
-- E. draft_set_clock — E15 exact semantics
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_set_clock((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'), 60, false) $$,
  'set_clock 60s without extension lives');
reset role;
select is(
  (select (config->>'pick_timer_seconds') || '|' || current_deadline::text
   from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  '60|' || (now() + interval '17234 milliseconds')::text,
  'E15: the new timer lands in drafts.config for SUBSEQUENT picks; the current deadline is untouched');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000a1' and is_system
     and message = 'Pick clock set to 60 seconds by Commish Cara (applies to upcoming picks).'),
  1::bigint,
  'the set_clock system post (no-extension variant)');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_set_clock((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'), 60, true) $$,
  'set_clock 60s WITH extension lives');
reset role;
select is(
  (select current_deadline from drafts
   where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  now() + interval '60 seconds',
  'E15 extension: current_deadline = GREATEST(17.234s left, now()+60s) = now()+60s');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_set_clock((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'), 5, true) $$,
  'set_clock 5s with extension lives');
reset role;
select is(
  (select (config->>'pick_timer_seconds') || '|' || current_deadline::text
   from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  '5|' || (now() + interval '60 seconds')::text,
  'E15 NEVER-SHORTEN: a 5s timer with extension leaves the 60s deadline alone (GREATEST)');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_set_clock((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'), 0, true) $$,
  'set_clock 0 (untimed) with extension lives');
reset role;
select is(
  (select (config->>'pick_timer_seconds') || '|' || coalesce(current_deadline::text, 'NULL')
   from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  '0|NULL',
  'timer 0 + extend ⇒ the current pick goes UNTIMED (deadline NULL — §8.2 soft timer applied now)');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000a1' and is_system
     and message = 'Pick clock set to untimed by Commish Cara (applies to upcoming picks). The current pick is now untimed.'),
  1::bigint,
  'the set_clock system post (untimed variant)');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_set_clock((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'), 30, false) $$,
  'set_clock back to 30s for the pick sequence');
select throws_ok(
  $$ select public.draft_set_clock((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'), -1) $$,
  '22023', 'draft_set_clock: pick_timer_seconds must be a non-negative integer',
  'negative timer → 22023');
-- Paused + extend → friendly refusal (the frozen clock keeps its remaining).
select lives_ok(
  $$ select public.draft_pause((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1')) $$,
  'pause for the paused-extend refusal');
select throws_ok(
  $$ select public.draft_set_clock((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'), 45, true) $$,
  'P0001',
  'draft_set_clock: the draft is paused — resume first, then extend the current pick (the paused clock keeps its stored remaining time)',
  'extend-current on a PAUSED draft → friendly refusal (the pause bookkeeping is never rewritten)');
select set_config('cc.resume3',
  public.draft_resume((select id from drafts
    where league_id = 'b4000000-0000-4000-8000-0000000000a1'))::text, true);
reset role;
select is(
  (select status || '|' || coalesce(current_deadline::text, 'NULL')
   from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  'live|NULL',
  'the untimed pause round-trips: NULL remaining resumes to a NULL deadline (no invented time)');

-- R138 (M2 batch 5): an UNTIMED current pick + extend ⇒ the new timer is
-- IMPOSED on the current pick. Decided KEEP + pin (D108(3)): extend_current
-- with a positive timer on an untimed pick has exactly one meaning — put
-- this pick on the clock (the §8.2-symmetric inverse of the timer-0 arm
-- above; a stalled untimed room's only non-force recourse) — and the pick
-- gets a FULL fresh timer, so no running countdown is ever cut (the harm
-- E15's extend-only rule guards).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_set_clock((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'), 45, true) $$,
  'set_clock 45s + extend on an UNTIMED current pick lives (R138)');
reset role;
select is(
  (select (config->>'pick_timer_seconds') || '|' || current_deadline::text
   from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  '45|' || (now() + interval '45 seconds')::text,
  'R138: extend on a NULL deadline IMPOSES the full new timer exactly (GREATEST(NULL, now()+45s) = now()+45s — the current pick is clocked, not silently left untimed)');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000a1' and is_system
     and message = 'Pick clock set to 45 seconds by Commish Cara (applies to upcoming picks). The current pick is now on the clock.'),
  1::bigint,
  'the impose-variant system post says "now on the clock" (distinct from the "was extended." running-clock variant)');
-- Privileged fixture surgery: restore the state §F has always entered with
-- (timer 30, untimed current pick) — no extra post.
update drafts
set config = jsonb_set(config, '{pick_timer_seconds}', to_jsonb(30)),
    current_deadline = null,
    updated_at = now()
where league_id = 'b4000000-0000-4000-8000-0000000000a1';

-- ---------------------------------------------------------------------------
-- F. Picks + undo (cascade golden, single, R125) + reassign/move/force +
--    the E31 order edit
-- ---------------------------------------------------------------------------
-- Pick 1 as the real on-clock manager (u01/t1) carrying action_id A1 — the
-- R125 fixture. Picks 2–8 privileged through the ONE advance path
-- (draft_apply_pick_internal; §12.4 system shape) — board t1..t8 round 1.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_make_pick((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
       'cc-rb01', 'a6000000-0000-4000-8000-000000000001') $$,
  'pick 1 by the on-clock manager (action A1 — the R125 fixture)');
reset role;
select lives_ok(
  $$ select public.draft_apply_pick_internal((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
       'cc-rb' || lpad(i::text, 2, '0'), true, 'autopick', null, null)
     from generate_series(2, 8) i $$,
  'picks 2–8 land through the one advance path (privileged harness)');
select is(
  (select current_pick_number || '|' || current_round::text || '|' || on_clock_team_id::text
   from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  '9|2|c5000000-0000-4000-8000-00a100000008',
  'board at pick 9: round 2, snake-reversed onto t8');

-- CASCADE GOLDEN (E4; the task fixture): undo to pick 3 of 8.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('cc.undo1',
  public.draft_undo((select id from drafts
    where league_id = 'b4000000-0000-4000-8000-0000000000a1'), 3)::text, true);
reset role;
select is(
  (current_setting('cc.undo1')::jsonb->>'undone_count')::int, 5,
  'cascade undo to pick 3: exactly 5 picks reverted');
select is(
  (select array_agg(pick_number order by pick_number)
   from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b4000000-0000-4000-8000-0000000000a1' and p.is_undone),
  array[4, 5, 6, 7, 8],
  'EXACTLY picks 4–8 carry is_undone (the golden fixture; §12.4 soft undo — rows kept)');
select is(
  (select array_agg(pick_number order by pick_number)
   from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b4000000-0000-4000-8000-0000000000a1' and not p.is_undone),
  array[1, 2, 3],
  'picks 1–3 stay live');
select is(
  (select current_pick_number || '|' || current_round::text || '|' || on_clock_team_id::text
   from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  '4|1|c5000000-0000-4000-8000-00a100000004',
  'the clock rewound to pick 4 — t4 back on the clock (E4)');
select is(
  (select current_deadline from drafts
   where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  now() + interval '30 seconds',
  'the rewound team gets a FRESH full clock (now() + the 30s timer)');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000a1' and is_system
     and message = 'Picks 4-8 undone by Commish Cara (5 picks reverted) — pgtap-cc-a1-t04 is back on the clock at pick 4.'),
  1::bigint,
  'the cascade-undo system post (count + rewound team — §8.7''s clear confirm made visible)');

-- POOL RESTORED, behaviorally: the rewound manager picks a player the
-- cascade freed (cc-rb05 was pick 5).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_make_pick((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
       'cc-rb05', 'a6000000-0000-4000-8000-000000000002') $$,
  'POOL RESTORED: the on-clock manager re-picks a cascade-freed player (action A2)');
reset role;

-- SINGLE undo: the newest live pick (pick 4) reverts.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('cc.undo2',
  public.draft_undo((select id from drafts
    where league_id = 'b4000000-0000-4000-8000-0000000000a1'))::text, true);
reset role;
select is(
  (current_setting('cc.undo2')::jsonb->>'undone_count')::int
    * 100 + (current_setting('cc.undo2')::jsonb->>'rewound_to_pick')::int,
  104,
  'single undo (p_to NULL): exactly 1 pick reverted, rewound to pick 4');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000a1' and is_system
     and message = 'Pick 4 undone by Commish Cara — pgtap-cc-a1-t04 is back on the clock.'),
  1::bigint,
  'the single-undo system post');

-- THE R125 DECISION PIN: replay action A2 — its pick is now UNDONE, its
-- caller (u04) IS on the clock, and cc-rb05 IS available. Without the
-- deliberate no-is_undone-filter replay arm this exact call would insert a
-- fresh pick; instead: historical row back, nothing written.
select is(
  (select count(*) from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  9::bigint,
  'R125 baseline: 9 pick rows before the replay (8 + the re-pick)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select set_config('cc.replay',
  public.draft_make_pick((select id from drafts
    where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
    'cc-rb05', 'a6000000-0000-4000-8000-000000000002')::text, true);
reset role;
select is(
  (current_setting('cc.replay')::jsonb->'pick'->>'is_undone')::boolean, true,
  'R125: the replay returns the HISTORICAL (undone) pick as a success-shaped no-op — an action_id is consumed forever');
select is(
  (select count(*) from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  9::bigint,
  'R125: the replay wrote NOTHING (still 9 rows) — the commissioner''s undo is never silently re-applied by a stale retry');
select is(
  (select current_pick_number from drafts
   where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  4,
  'R125: the draft state is untouched (still pick 4)');

-- The manager re-picks with a FRESH action_id (the real product flow).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_make_pick((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
       'cc-rb05', 'a6000000-0000-4000-8000-000000000003') $$,
  'a FRESH action_id re-picks the same player (pick 4 live again)');
reset role;

-- REASSIGN: player change with before/after post.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_reassign_pick(
       (select id from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
       (select p.id from draft_picks p join drafts d on d.id = p.draft_id
        where d.league_id = 'b4000000-0000-4000-8000-0000000000a1'
          and p.pick_number = 4 and not p.is_undone),
       null, 'cc-rb09') $$,
  'reassign pick 4 to a new player lives');
reset role;
select is(
  (select p.player_id from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b4000000-0000-4000-8000-0000000000a1'
     and p.pick_number = 4 and not p.is_undone),
  'cc-rb09',
  'pick 4 now selects the new player');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000a1' and is_system
     and message = 'Pick 4 edited by Commish Cara: CC RB 05 -> CC RB 09.'),
  1::bigint,
  'the reassign system post carries BEFORE -> AFTER (§8.7 row 5)');

-- Exclusivity: reassigning to a player already held live is refused.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_reassign_pick(
       (select id from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
       (select p.id from draft_picks p join drafts d on d.id = p.draft_id
        where d.league_id = 'b4000000-0000-4000-8000-0000000000a1'
          and p.pick_number = 4 and not p.is_undone),
       null, 'cc-rb01') $$,
  'P0001', 'draft_reassign_pick: CC RB 01 is already on a roster in this draft — undo or reassign that pick first',
  'EXCLUSIVITY: reassigning to an already-held player → friendly refusal');
-- Team change.
select lives_ok(
  $$ select public.draft_reassign_pick(
       (select id from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
       (select p.id from draft_picks p join drafts d on d.id = p.draft_id
        where d.league_id = 'b4000000-0000-4000-8000-0000000000a1'
          and p.pick_number = 4 and not p.is_undone),
       'c5000000-0000-4000-8000-00a100000006', null) $$,
  'reassign pick 4 to a new team lives');
reset role;
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000a1' and is_system
     and message = 'Pick 4 edited by Commish Cara: moved from pgtap-cc-a1-t04 to pgtap-cc-a1-t06.'),
  1::bigint,
  'the team-reassign system post carries the before/after teams');

-- MOVE (drag between rosters).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_move_player(
       (select id from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
       'cc-rb09',
       'c5000000-0000-4000-8000-00a100000006',
       'c5000000-0000-4000-8000-00a100000005') $$,
  'move the drafted player from t6 to t5 lives');
reset role;
select is(
  (select p.team_id::text from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b4000000-0000-4000-8000-0000000000a1'
     and p.pick_number = 4 and not p.is_undone),
  'c5000000-0000-4000-8000-00a100000005',
  'the player''s pick row now belongs to t5');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000a1' and is_system
     and message = 'CC RB 09 moved from pgtap-cc-a1-t06 to pgtap-cc-a1-t05 by Commish Cara.'),
  1::bigint,
  'the move system post carries the before/after teams');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_move_player(
       (select id from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
       'cc-rb09',
       'c5000000-0000-4000-8000-00a100000005',
       'c5000000-0000-4000-8000-00a100000005') $$,
  'P0001', 'draft_move_player: CC RB 09 is already on that team',
  'the task''s exclusivity refusal: moving to the team that already has the player');
select throws_ok(
  $$ select public.draft_move_player(
       (select id from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
       'cc-rb09',
       'c5000000-0000-4000-8000-00a100000006',
       'c5000000-0000-4000-8000-00a100000005') $$,
  'P0001', 'draft_move_player: CC RB 09 is on pgtap-cc-a1-t05 — not the team you are moving from',
  'a replayed move surfaces as the wrong-from friendly refusal (safe by state)');

-- FORCE PICK (on-clock team is t5, pick 5).
select set_config('cc.force1',
  public.draft_force_pick((select id from drafts
    where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
    'cc-rb10', 'a6000000-0000-4000-8000-000000000011')::text, true);
reset role;
select is(
  (select p.team_id::text || '|' || p.player_id || '|' || p.is_auto::text || '|'
          || p.made_via || '|' || p.picked_by::text
   from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b4000000-0000-4000-8000-0000000000a1'
     and p.pick_number = 5 and not p.is_undone),
  'c5000000-0000-4000-8000-00a100000005|cc-rb10|false|commissioner|93000000-0000-4000-8000-000000000001',
  'FORCE PICK: the on-clock team gets the player — §12.4 commissioner shape (is_auto FALSE, made_via commissioner, picked_by = the commissioner)');
select is(
  (select current_pick_number || '|' || on_clock_team_id::text
   from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  '6|c5000000-0000-4000-8000-00a100000006',
  'the force pick advanced through the ONE path (pick 6, t6 on the clock)');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000a1' and is_system
     and message = 'Pick 5 made by commissioner Commish Cara for pgtap-cc-a1-t05: CC RB 10.'),
  1::bigint,
  'the force-pick system post');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000a1' and is_system),
  16::bigint,
  'system-post checkpoint before the force replay: 16 posts (15 + the R138 impose post)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('cc.force2',
  public.draft_force_pick((select id from drafts
    where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
    'cc-rb10', 'a6000000-0000-4000-8000-000000000011')::text, true);
reset role;
select is(
  (current_setting('cc.force2')::jsonb->'pick'->>'pick_number')::int, 5,
  'force-pick replay (same action_id) returns the ORIGINAL pick as a no-op (E2 on the force path)');
select is(
  (select current_pick_number from drafts
   where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  6,
  '…and the draft did not advance again');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000a1' and is_system),
  16::bigint,
  '…and no second system post was written (still 16)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_force_pick((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'), 'cc-rb01') $$,
  'P0001', 'draft_force_pick: CC RB 01 just went off the board — pick another player',
  'forcing a taken player → the friendly E1 refusal');
select lives_ok(
  $$ select public.draft_pause((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1')) $$,
  'pause for the force-while-paused refusal');
select throws_ok(
  $$ select public.draft_force_pick((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'), 'cc-rb11') $$,
  'P0001', 'draft_force_pick: the draft is paused — resume it first, then pick for the team on the clock',
  'force on a PAUSED draft → friendly refusal (apply-pick would corrupt the pause bookkeeping)');
select lives_ok(
  $$ select public.draft_resume((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1')) $$,
  'resume after the refusal');

-- SET ORDER post-start (E31): reverse the order at pick 6.
select set_config('cc.order1',
  public.draft_set_order((select id from drafts
    where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
    array['c5000000-0000-4000-8000-00a100000008','c5000000-0000-4000-8000-00a100000007',
          'c5000000-0000-4000-8000-00a100000006','c5000000-0000-4000-8000-00a100000005',
          'c5000000-0000-4000-8000-00a100000004','c5000000-0000-4000-8000-00a100000003',
          'c5000000-0000-4000-8000-00a100000002','c5000000-0000-4000-8000-00a100000001']::uuid[])::text,
  true);
reset role;
select is(
  (select p.team_id::text from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b4000000-0000-4000-8000-0000000000a1'
     and p.pick_number = 1 and not p.is_undone),
  'c5000000-0000-4000-8000-00a100000001',
  'E31: completed pick 1 is UNCHANGED (t1 keeps it)');
select is(
  (select p.team_id::text from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b4000000-0000-4000-8000-0000000000a1'
     and p.pick_number = 2 and not p.is_undone),
  'c5000000-0000-4000-8000-00a100000002',
  'E31: completed pick 2 is UNCHANGED');
select is(
  (select on_clock_team_id::text from drafts
   where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  'c5000000-0000-4000-8000-00a100000003',
  'E31: the CURRENT pick (6) re-derives under the new order — position 6 of the reversed order = t3');
select is(
  (select current_deadline from drafts
   where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  now() + interval '30 seconds',
  'the CHANGED on-clock team gets a fresh full clock (it never had the clock)');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000a1' and is_system
     and message = 'Draft order changed by Commish Cara at pick 6 — remaining picks follow the new order.'),
  1::bigint,
  'the post-start order-edit system post (E31: audited + announced)');
-- The NEXT advance follows the new order: pick 6 lands on t3, pick 7
-- derives to position 7 of the new order = t2.
select lives_ok(
  $$ select public.draft_apply_pick_internal((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
       'cc-rb11', true, 'autopick', null, null) $$,
  'pick 6 lands (privileged advance)');
select is(
  (select p.team_id::text from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b4000000-0000-4000-8000-0000000000a1'
     and p.pick_number = 6 and not p.is_undone),
  'c5000000-0000-4000-8000-00a100000003',
  'pick 6 recorded for the re-derived team (t3)');
select is(
  (select on_clock_team_id::text from drafts
   where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  'c5000000-0000-4000-8000-00a100000002',
  'REMAINING picks re-derive: pick 7 = position 7 of the new order (t2)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_set_order((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
       array['c5000000-0000-4000-8000-00a100000001','c5000000-0000-4000-8000-00a100000002',
             'c5000000-0000-4000-8000-00a100000003','c5000000-0000-4000-8000-00a100000004',
             'c5000000-0000-4000-8000-00a100000005','c5000000-0000-4000-8000-00a100000006',
             'c5000000-0000-4000-8000-00a100000007']::uuid[]) $$,
  'P0001', 'draft_set_order: the order must include every active franchise exactly once (§8.3)',
  'a 7-team order → friendly permutation refusal');
select throws_ok(
  $$ select public.draft_set_order((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
       array['c5000000-0000-4000-8000-00a100000001','c5000000-0000-4000-8000-00a100000001',
             'c5000000-0000-4000-8000-00a100000003','c5000000-0000-4000-8000-00a100000004',
             'c5000000-0000-4000-8000-00a100000005','c5000000-0000-4000-8000-00a100000006',
             'c5000000-0000-4000-8000-00a100000007','c5000000-0000-4000-8000-00a100000008']::uuid[]) $$,
  'P0001', 'draft_set_order: the order must include every active franchise exactly once (§8.3)',
  'a duplicated team → the same refusal');
select throws_ok(
  $$ select public.draft_set_order((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'), '{}'::uuid[]) $$,
  '22023', 'draft_set_order: a non-empty draft order is required',
  'an empty order → 22023');
reset role;

-- ---------------------------------------------------------------------------
-- G. Reset (+ THE D107(5) AUTO-START SEAM), the status boundaries, the LX
--    complete-boundary world, the LR capacity world
-- ---------------------------------------------------------------------------
-- Plant a PAST auto-start instant BEFORE the reset — the seam bait: if
-- reset kept it, the next tick would re-start the reset draft (D94).
update leagues
set settings = jsonb_set(settings, '{draft,draft_scheduled_at}',
                         to_jsonb('2026-01-01T00:00:00+00:00'::text))
where id = 'b4000000-0000-4000-8000-0000000000a1';
select is(
  (select status from leagues where id = 'b4000000-0000-4000-8000-0000000000a1'),
  'drafting',
  'pre-reset: the league is drafting (the §7.1 state reset re-opens)');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('cc.reset1',
  public.draft_reset((select id from drafts
    where league_id = 'b4000000-0000-4000-8000-0000000000a1'))::text, true);
reset role;
select is(
  (current_setting('cc.reset1')::jsonb->>'reset')::boolean::text || '|'
    || (current_setting('cc.reset1')::jsonb->>'picks_cleared'),
  'true|6',
  'reset reports reset: true with all 6 live picks cleared');
select is(
  (select count(*) filter (where not p.is_undone) || '|' || count(*)
   from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  '0|12',
  'every pick is soft-undone; ALL 12 rows kept (§12.4 — the audit trail survives the reset)');
select is(
  (select status || '|' || current_pick_number || '|' || current_round || '|'
          || coalesce(on_clock_team_id::text, 'NULL') || '|'
          || coalesce(current_deadline::text, 'NULL') || '|'
          || coalesce(paused_at::text, 'NULL') || '|'
          || coalesce(deadline_remaining_ms::text, 'NULL') || '|'
          || coalesce(started_at::text, 'NULL')
   from drafts where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  'scheduled|1|1|NULL|NULL|NULL|NULL|NULL',
  'the drafts row is back to pre-draft (status scheduled, counters 1/1, clock fields cleared)');
select is(
  (select draft_order->>0 from drafts
   where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  'c5000000-0000-4000-8000-00a100000008',
  'draft_order is KEPT across the reset (D101 — the shown order survives; the E31 reversed order still leads with t8)');
select is(
  (select status from leagues where id = 'b4000000-0000-4000-8000-0000000000a1'),
  'scheduled',
  'THE LEAGUE-STATUS FLIP PIN: leagues.status = scheduled in the same txn (§8.7''s own row; §7.1 re-open)');
select is(
  (select settings->'draft'->>'draft_scheduled_at'
   from leagues where id = 'b4000000-0000-4000-8000-0000000000a1'),
  null,
  'THE D107(5) SEAM CLOSURE: the stored draft_scheduled_at is CLEARED — auto-start is disarmed until the commissioner re-schedules');
select is(
  (select count(*) from draft_liveness dl
   where dl.draft_id = (select id from drafts
     where league_id = 'b4000000-0000-4000-8000-0000000000a1')),
  0::bigint,
  'this draft''s liveness rows are wiped (fresh room state; the outage arm''s supervision memory starts clean)');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000a1' and is_system
     and message = 'Draft reset by Commish Cara — 6 picks cleared; the draft is back to scheduled. Re-schedule it in Draft setup or start it manually when ready.'),
  1::bigint,
  'the reset system post (hard action, plainly announced)');

-- THE SEAM PIN: the very next tick must NOT restart the reset draft. (The
-- D94 arm is live in this database — with the instant cleared, LM is not
-- scanned; had reset kept the past instant, THIS call would re-start it.)
select lives_ok($$ select public.draft_tick() $$,
  'draft_tick runs after the reset');
select is(
  (select l.status || '|' || d.status
   from leagues l join drafts d on d.league_id = l.id
   where l.id = 'b4000000-0000-4000-8000-0000000000a1'),
  'scheduled|scheduled',
  'THE AUTO-START SEAM IS CLOSED: after a full tick the reset draft and league are STILL scheduled (no D94 re-start)');

-- Pre-start set_order on the reset (scheduled) draft.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_set_order((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
       array['c5000000-0000-4000-8000-00a100000001','c5000000-0000-4000-8000-00a100000002',
             'c5000000-0000-4000-8000-00a100000003','c5000000-0000-4000-8000-00a100000004',
             'c5000000-0000-4000-8000-00a100000005','c5000000-0000-4000-8000-00a100000006',
             'c5000000-0000-4000-8000-00a100000007','c5000000-0000-4000-8000-00a100000008']::uuid[]) $$,
  'pre-start set_order on the scheduled draft lives');
reset role;
select is(
  (select draft_order->>0 from drafts
   where league_id = 'b4000000-0000-4000-8000-0000000000a1'),
  'c5000000-0000-4000-8000-00a100000001',
  'the pre-start order landed (t1 first again — the lobby order draft_start will honor, D101)');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000a1' and is_system
     and message = 'Draft order updated by Commish Cara.'),
  1::bigint,
  'the pre-start order system post');

-- Status boundaries on the scheduled draft.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_reset((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1')) $$,
  'P0001', 'draft_reset: the draft has not started — nothing to reset',
  'reset of a scheduled draft → friendly refusal');
select throws_ok(
  $$ select public.draft_undo((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1')) $$,
  'P0001', 'draft_undo: the draft has not started yet — nothing to undo',
  'undo of a scheduled draft → friendly refusal');
select throws_ok(
  $$ select public.draft_pause((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1')) $$,
  'P0001', 'draft_pause: the draft is scheduled — only a live draft can be paused',
  'pause of a scheduled draft → friendly refusal');
select throws_ok(
  $$ select public.draft_resume((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000a1')) $$,
  'P0001', 'draft_resume: the draft is scheduled — only a paused draft can be resumed',
  'resume of a scheduled draft → friendly refusal');
reset role;

-- LX: the COMPLETE boundary (F44 — post-completion corrections are M6's).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000008", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_reset('e4000000-0000-4000-8000-0000000000c1') $$,
  'P0001', 'draft_reset: the draft is complete — a post-completion reset is an audited override that arrives with the commissioner console (M6)',
  'RESET BOUNDARY: a complete draft refuses, naming M6 (F44)');
select throws_ok(
  $$ select public.draft_undo('e4000000-0000-4000-8000-0000000000c1') $$,
  'P0001', 'draft_undo: the draft is complete — post-completion corrections arrive with the commissioner console (M6)',
  'undo of a complete draft → the same F44-class boundary');
select throws_ok(
  $$ select public.draft_reassign_pick('e4000000-0000-4000-8000-0000000000c1',
       'a6000000-0000-4000-8000-000000000000', null, 'cc-rb01') $$,
  'P0001', 'draft_reassign_pick: the draft is complete — post-completion corrections arrive with the commissioner console (M6)',
  'reassign on a complete draft → refused');
select throws_ok(
  $$ select public.draft_move_player('e4000000-0000-4000-8000-0000000000c1',
       'cc-rb01', 'c5000000-0000-4000-8000-00c100000001', 'c5000000-0000-4000-8000-00c100000001') $$,
  'P0001', 'draft_move_player: the draft is complete — post-completion corrections arrive with the commissioner console (M6)',
  'move on a complete draft → refused');
reset role;

-- LR: capacity (total_rounds 1; t2 is at cap with pick 2).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000007", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_move_player('e4000000-0000-4000-8000-0000000000b1',
       'cc-rb15', 'c5000000-0000-4000-8000-00b100000001', 'c5000000-0000-4000-8000-00b100000002') $$,
  'P0001', 'draft_move_player: that team''s roster is already full (1 of 1 picks) — move a player off it first',
  'CAPACITY (v2.8.11 slot validation): moving onto a full roster → friendly refusal');
select throws_ok(
  $$ select public.draft_reassign_pick('e4000000-0000-4000-8000-0000000000b1',
       (select p.id from draft_picks p
        where p.draft_id = 'e4000000-0000-4000-8000-0000000000b1' and p.pick_number = 1),
       'c5000000-0000-4000-8000-00b100000002', null) $$,
  'P0001', 'draft_reassign_pick: that team''s roster is already full (1 of 1 picks) — move a player off it first',
  'the same capacity refusal on the reassign path');
select lives_ok(
  $$ select public.draft_move_player('e4000000-0000-4000-8000-0000000000b1',
       'cc-rb15', 'c5000000-0000-4000-8000-00b100000001', 'c5000000-0000-4000-8000-00b100000003') $$,
  'POSITIVE CONTROL: moving onto a team with room succeeds');
reset role;
select is(
  (select p.team_id::text from draft_picks p
   where p.draft_id = 'e4000000-0000-4000-8000-0000000000b1' and p.pick_number = 1),
  'c5000000-0000-4000-8000-00b100000003',
  '…the pick row moved to t3');

-- ---------------------------------------------------------------------------
-- H. The §8.7 commissioner-outage arm (068 amended; D102; threshold =
--    freshness 45s + grace 30s = 75s, as-of-NOW)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select is(
  (public.draft_start('b4000000-0000-4000-8000-0000000000d1')->>'started')::boolean,
  true,
  'LO starts (commissioner u05)');
select lives_ok(
  $$ select public.draft_touch((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000d1')) $$,
  'the commissioner heartbeats LO');
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_touch((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000d1')) $$,
  'the co-commissioner heartbeats LO');
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000009", "role": "authenticated"}', true);
select is(
  (public.draft_start('b4000000-0000-4000-8000-0000000000e1')->>'started')::boolean,
  true,
  'LN starts (commissioner u09 — who never opens the room: ZERO draft_touch calls)');
reset role;

-- Fresh commissioners → never pauses.
select lives_ok($$ select public.draft_tick() $$, 'tick with fresh commissioners');
select is(
  (select status from drafts where league_id = 'b4000000-0000-4000-8000-0000000000d1'),
  'live',
  'FRESH commissioner → the outage arm never pauses');

-- Stale commish + FRESH co-commish → keeps running (§8.7: co-commissioners
-- retain controls).
update draft_liveness set last_seen_at = now() - interval '76 seconds'
where user_id = '93000000-0000-4000-8000-000000000005';
update draft_liveness set last_seen_at = now() - interval '5 seconds'
where user_id = '93000000-0000-4000-8000-000000000006';
select lives_ok($$ select public.draft_tick() $$, 'tick with a stale commish + fresh co-commish');
select is(
  (select status from drafts where league_id = 'b4000000-0000-4000-8000-0000000000d1'),
  'live',
  'stale commish + FRESH co-commish → keeps running');

-- Boundary, low side: the freshest commissioner beat 74s old (< 75s
-- threshold = 45s freshness + 30s grace) → still supervised.
update draft_liveness set last_seen_at = now() - interval '74 seconds'
where user_id = '93000000-0000-4000-8000-000000000006';
select lives_ok($$ select public.draft_tick() $$, 'tick at threshold − 1s');
select is(
  (select status from drafts where league_id = 'b4000000-0000-4000-8000-0000000000d1'),
  'live',
  'boundary: the freshest commissioner beat 74s old → NOT yet an outage (75s threshold)');

-- Boundary, high side: both stale past 75s → auto-pause.
update draft_liveness set last_seen_at = now() - interval '76 seconds'
where user_id = '93000000-0000-4000-8000-000000000006';
select set_config('cc.otick', public.draft_tick()::text, true);
select is(
  (select status || '|' || deadline_remaining_ms::text || '|'
          || coalesce(current_deadline::text, 'NULL')
   from drafts where league_id = 'b4000000-0000-4000-8000-0000000000d1'),
  'paused|30000|NULL',
  'BOTH STALE past 75s → AUTO-PAUSED; the full 30s clock persisted ms-exact (nothing runs unsupervised — §8.7:478)');
select ok(
  (current_setting('cc.otick')::jsonb->>'outage_paused')::int >= 1,
  'the tick summary counted the outage pause (≥-based — concurrent actors are legal)');
select is(
  (select message || '|' || is_system::text || '|' || coalesce(user_id::text, 'NULL')
   from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000d1' and is_system),
  'Draft auto-paused: no commissioner or co-commissioner is connected. A commissioner can resume from the draft room.|true|NULL',
  'the outage system post: exact message, is_system, user_id NULL (the tick has no acting user)');
select is(
  (select status from drafts where league_id = 'b4000000-0000-4000-8000-0000000000e1'),
  'live',
  'THE NEVER-CONNECTED EXEMPTION: LN (zero commissioner heartbeats, ever) ran through every tick above and is STILL live — D94''s unattended autopilot is never outage-paused');

-- A returning commissioner does NOT auto-resume the draft (resume is a
-- commissioner ACTION — §8.7).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_touch((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000d1')) $$,
  'the commissioner returns (fresh heartbeat)');
reset role;
select lives_ok($$ select public.draft_tick() $$, 'tick after the return');
select is(
  (select status from drafts where league_id = 'b4000000-0000-4000-8000-0000000000d1'),
  'paused',
  'NO AUTO-RESUME: the draft stays paused until a commissioner resumes it');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000d1' and is_system),
  1::bigint,
  '…and the paused draft is not re-paused (exactly one outage post)');

-- The commissioner resumes: the outage-persisted remaining restores exact.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "93000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_resume((select id from drafts
       where league_id = 'b4000000-0000-4000-8000-0000000000d1')) $$,
  'draft_resume by the commissioner (the sanctioned exit from an outage pause)');
reset role;
select is(
  (select status || '|' || current_deadline::text
   from drafts where league_id = 'b4000000-0000-4000-8000-0000000000d1'),
  'live|' || (now() + interval '30000 milliseconds')::text,
  'the resume restores the outage-persisted clock ms-exact (30000ms)');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000d1' and is_system
     and message = 'Draft resumed by Commish Otto.'),
  1::bigint,
  'the resume system post names the returning commissioner');
select lives_ok($$ select public.draft_tick() $$, 'tick after the resume');
select is(
  (select status from drafts where league_id = 'b4000000-0000-4000-8000-0000000000d1'),
  'live',
  'a fresh commissioner keeps the resumed draft running');

-- R136 (M2 batch 5) — THE ARM-ORDERING PIN: an EXPIRED deadline under an
-- outage PAUSES, never autopicks (the 068 banner's "runs BETWEEN auto-start
-- and timeout" claim, previously unpinned). The deadline is planted 61s
-- past — BEYOND deadline + grace (30s) — so the timeout arm, had it run
-- first, would have autopicked UNCONDITIONALLY: u05's 76s-old beat lands in
-- the (deadline−45s, deadline] = (−106s, −61s] window (fresh-at-deadline ⇒
-- immediate autopick), and even a stale classification's hold expired at
-- deadline+30s = 31s ago. Falsifiable specifically against arm reordering:
-- flipped arms give 'paused|30000' + 1 pick; the printed order gives
-- 'paused|-61000' + 0 picks. The -61000 is also THE D108(2) PIN: pause
-- bookkeeping persists NEGATIVE remaining ms-exact (the elapsed portion of
-- a grace clock survives the pause — clocks never gain or lose).
update draft_liveness set last_seen_at = now() - interval '76 seconds'
where user_id in ('93000000-0000-4000-8000-000000000005',
                  '93000000-0000-4000-8000-000000000006');
update drafts set current_deadline = now() - interval '61 seconds', updated_at = now()
where league_id = 'b4000000-0000-4000-8000-0000000000d1';
select set_config('cc.otick2', public.draft_tick()::text, true);
select is(
  (select status || '|' || deadline_remaining_ms::text || '|'
          || coalesce(current_deadline::text, 'NULL')
   from drafts where league_id = 'b4000000-0000-4000-8000-0000000000d1'),
  'paused|-61000|NULL',
  'R136: an expired-past-grace deadline under an outage PAUSES with the NEGATIVE remaining persisted ms-exact (-61000 — D108(2); the outage arm ran BEFORE the timeout arm)');
select is(
  (select count(*) from draft_picks p
   where p.draft_id = (select id from drafts
     where league_id = 'b4000000-0000-4000-8000-0000000000d1')),
  0::bigint,
  'R136: ZERO picks — nothing autopicked under the outage despite the long-expired deadline (§8.7:478 "nothing runs unsupervised")');
select ok(
  (current_setting('cc.otick2')::jsonb->>'outage_paused')::int >= 1,
  'R136: the tick summary counted the second outage pause (≥-based — concurrent actors are legal)');
select is(
  (select count(*) from league_chat
   where league_id = 'b4000000-0000-4000-8000-0000000000d1' and is_system
     and message = 'Draft auto-paused: no commissioner or co-commissioner is connected. A commissioner can resume from the draft room.'),
  2::bigint,
  'R136: a second outage system post (user-visible each time the arm fires)');

-- R135 (M2 batch 5) — THE LOCK-SCOPE PINS (pgrowlocks lock-visibility):
-- the outage arm's claim locks ONLY outage candidates. Pre-fix the
-- unfiltered claim FOR UPDATE'd EVERY live non-mock draft each tick and
-- held the locks for the rest of the tick transaction (a two-session live
-- probe showed a pick RPC on a fully supervised, not-due draft dying on
-- lock_timeout behind the batch — against the §22.3/§22.6 load posture and
-- the 25-draft M2 gate). pgrowlocks reads tuple-header lock state, so
-- locks taken by THIS session's draft_tick() calls — and still held after
-- they return — are observable here. Tuple locks CARRY FORWARD through
-- same-txn updates, so the negative probes must be rows no legitimate
-- claim ever touched: LP (fabricated in §B — live, fully supervised via a
-- planted fresh commissioner beat, not due, never touched by a control
-- RPC; LO cannot serve — the R136 case legitimately claimed it) and LN
-- (never-connected). The regression signature is a "For Update" mode on
-- the row ("For Key Share" members are the harmless RI shares every FK
-- write takes — LP carries one from its planted liveness row).
-- PROBE-VALIDITY POSITIVE CONTROL: LR is made DUE with on_clock NULL so
-- ARM 2 claims it and body-skips WITHOUT writing — its "For Update" MUST
-- be visible after the tick, so a probe that cannot see tick-held locks
-- fails loudly instead of passing vacuously.
update drafts set current_deadline = now() - interval '1 second', updated_at = now()
where id = 'e4000000-0000-4000-8000-0000000000b1';
select lives_ok($$ select public.draft_tick() $$,
  'the R135 probe tick (LP fully supervised + not due; LN never-connected; LR due-degenerate)');
select is(
  (select count(*) from extensions.pgrowlocks('public.drafts') rl
   where rl.locked_row = (select d.ctid from drafts d
     where d.id = 'e4000000-0000-4000-8000-0000000000f1')
     and ('For Update' = any(rl.modes) or 'For No Key Update' = any(rl.modes))),
  0::bigint,
  'R135 LOCK SCOPE: no tick ever FOR-UPDATE-locked the fully-SUPERVISED live draft LP (the outage claim filters to established-then-lost candidates — the supervised prong)');
select is(
  (select count(*) from extensions.pgrowlocks('public.drafts') rl
   where rl.locked_row = (select d.ctid from drafts d
     where d.league_id = 'b4000000-0000-4000-8000-0000000000e1')
     and ('For Update' = any(rl.modes) or 'For No Key Update' = any(rl.modes))),
  0::bigint,
  'R135 LOCK SCOPE: no tick ever FOR-UPDATE-locked the NEVER-CONNECTED live draft LN (the established prong — zero commissioner liveness rows never enter the claim)');
select is(
  (select count(*) from extensions.pgrowlocks('public.drafts') rl
   where rl.locked_row = (select d.ctid from drafts d
     where d.id = 'e4000000-0000-4000-8000-0000000000b1')
     and 'For Update' = any(rl.modes)),
  1::bigint,
  'PROBE VALIDITY (positive control): the due draft ARM 2 claimed and body-skipped (on_clock NULL) IS still For-Update-visible after the tick — the probe detects tick-held locks');

-- ---------------------------------------------------------------------------
-- I. R137 (M2 batch 5): league_chat.user_id FK = ON DELETE SET NULL — a
--    commissioner-authored system post survives its author's account
--    deletion (§12.13 "(non-deletable)"; D97 interim audit; D99
--    append-only). The all-rows decision (ordinary messages survive
--    authorless too — account deletion removes identity, not the room's
--    history) is D108(15).
-- ---------------------------------------------------------------------------
select is(
  (select confdeltype::text from pg_constraint
   where conrelid = 'public.league_chat'::regclass
     and conname = 'league_chat_user_id_fkey'),
  'n',
  'R137 form pin: league_chat.user_id FK is ON DELETE SET NULL (069 — 001''s CASCADE hard-deleted the author''s posts)');
-- u10 (no memberships, no teams, no lists) authors one post of each shape,
-- then the account is deleted (auth.users → profiles cascade → SET NULL).
insert into league_chat (league_id, user_id, message, context, is_system) values
  ('b4000000-0000-4000-8000-0000000000a1', '93000000-0000-4000-8000-000000000010',
   'pgtap-r137 system post', 'league', true),
  ('b4000000-0000-4000-8000-0000000000a1', '93000000-0000-4000-8000-000000000010',
   'pgtap-r137 ordinary message', 'league', false);
delete from auth.users where id = '93000000-0000-4000-8000-000000000010';
select is(
  (select coalesce(user_id::text, 'NULL') || '|' || is_system::text
   from league_chat where message = 'pgtap-r137 system post'),
  'NULL|true',
  'R137: the system post SURVIVES the author''s account deletion — user_id NULL, text intact (the message already names the actor)');
select is(
  (select coalesce(user_id::text, 'NULL') || '|' || is_system::text
   from league_chat where message = 'pgtap-r137 ordinary message'),
  'NULL|false',
  'R137: an ordinary message survives authorless too (the all-rows SET NULL — D99 append-only chat is never hard-deleted by identity removal; D108(15))');

select * from finish();
rollback;
