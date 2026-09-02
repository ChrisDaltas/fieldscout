-- ============================================================================
-- Autopick + draft_liveness/draft_touch + draft_tick — migration 068 (spec
-- §8.2/§8.4 + E30/E3, §8.5.4–5, §14, §22.3; tasks-M2 §3 D87/D90/D93/D94/
-- D100/D102 + §4.6; task L.B1.3). pgTAP file is **022** (021 =
-- league_lists; next free confirmed at task time).
--
-- Falsifiability notes (§4.3):
--   * SOURCE-PRIORITY PINS (task item 4): four fixtures on ONE live draft
--     (LA), each falsifiable alone — distinct expected players: seat 1
--     queue+board+bigboard → the QUEUE top wins; seat 2 board+bigboard →
--     the BOARD top; seat 3 bigboard only → the BIG-BOARD top; seat 4
--     nothing → lowest ADP. Skip-drafted-within-source pinned by drafting
--     the seat-1 queue top mid-section (falls to queue #2, NOT the board).
--     The owner filter on boards is discriminated by seat 3: if
--     `ll.owner_id = v_user` were dropped, seat 3's resolve could surface
--     seat 2's primary board (tk-wr03) instead of its own big board
--     (tk-wr06).
--   * R120 (065 banner): the queue branch JOINs teams → the draft's league
--     (untrusted-hint discipline). HONEST SCOPE NOTE (the R84/R97 lesson):
--     the join is defense-in-depth BEHIND the no-user/team filters — the
--     tick only ever passes this draft's on-clock team, so no behavioral
--     probe reaches the join alone. Pinned structurally (prosrc carries
--     the league join) plus the blanket behavioral pin (resolve for a
--     FOREIGN team ignores a planted foreign queue row and answers the ADP
--     floor).
--   * THE DOCUMENTED GREEDY (068 banner steps a–h): 3rd-QB block (1-QB
--     league, 2 QBs held, needs open → queue's 3rd QB skipped) + the
--     POSITIVE control (1 QB held → the 2nd QB from queue IS taken — a cap
--     drifted tighter than S+1 fails it); E30 boundary at the EXACT rounds
--     (round = total_rounds−3 → K deferred; round = total_rounds−2 → K
--     taken; total_rounds 7 → rounds 4 vs 5); FORCED mode overrides E30
--     (remaining == unfilled K/DST seats at round total−3 → K taken) and
--     skips non-need queue entries; DEF→DST normalization (a
--     players.position='DEF' fixture fills a `dst` seat under forced mode
--     — normalization dropped ⇒ the floor player answers instead); the
--     never-stall FLOOR (a forced TE need with zero TEs in the pool →
--     lowest-ADP available, filters dropped).
--   * THE DoD BREAK PROBE (shown + reverted in the session log): disable
--     the E30 deferral clause in draft_autopick_resolve → the E30 boundary
--     pin (round total_rounds−3) fails: the K is taken a round early.
--   * D100 DEADLINE-REWIND HARNESS: every timeout scenario = privileged
--     `current_deadline` rewind → direct draft_tick() call → state
--     asserted. Production RPCs never accept a caller clock. All instants
--     compute against the txn-frozen now(), so boundaries are exact.
--   * BOTH GRACE BRANCHES (D102), boundary-instant precision: FRESH seat
--     (draft_touch'd; liveness pinned PRE-deadline — freshness is decided
--     AS OF the deadline instant, R132) autopicks at deadline+1s; STALE
--     seat NOT picked at deadline+grace−1s, picked at deadline+grace+1s;
--     a manual pick lands DURING a stale hold (§8.5.5/E3); an
--     `is_autodraft` STALE seat and a NO-USER placeholder seat autopick
--     at deadline+1s (no grace — the branch discriminator + E48's
--     autopilot). The 45s freshness constant pinned from BOTH sides
--     (liveness 46s old → stale/held; 44s old → fresh/picked, against a
--     1s-past deadline — the strict lower bound of the as-of-deadline
--     window keeps both sides) and as the literal interval.
--   * R132 RECONNECT-MID-HOLD PIN (M2 batch 4): a stale seat is held at
--     deadline+10s (baseline), the returning manager draft_touch'es —
--     a POST-deadline beat — and the next tick still holds (the beat
--     restores manual control only; it must NOT grant the fresh-at-expiry
--     branch); autopick lands only at deadline+grace+1s. THE R132 BREAK
--     PROBE (shown + reverted in the batch-4 record): re-derive the
--     branch from now()-freshness (the pre-fix form) → the held-after-
--     touch pin fails (the seat autopicks mid-hold).
--   * D94 AUTO-START PIN: a league in 'scheduled' with ONLY the settings
--     blob carrying a past draft_scheduled_at and NO drafts row (the
--     settings-surface end state — the 020 LJ fixture precedent) → one
--     tick creates AND starts it (row, live, league 'drafting', deadline,
--     rounds, order permutation, snapshot non-NULL — capacity+snapshot ≡
--     the manual path). A FUTURE instant is untouched. A capacity-short
--     league FAILS INTO THE SUMMARY (start_failures @> its league_id) and
--     is retried on the next tick — never a silent skip; a MALFORMED
--     stored instant is that league's recorded failure, never a scan
--     abort.
--   * Summary assertions are containment/≥-based: the tick also processes
--     any committed leftovers from wire suites (a legal concurrent actor).
--   * All privileged fixture work runs BEFORE any JWT claims (D49(7));
--     mid-test privileged steps use `reset role` (013/014/018/019/020
--     pattern). resolve()/tick() calls run privileged — both are REVOKEd
--     from authenticated (service-role/cron surface), which is itself
--     pinned.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(72);

-- ---------------------------------------------------------------------------
-- A. Form pins (§4.1 grants doctrine; D87/D102 constants)
-- ---------------------------------------------------------------------------
select has_table('public', 'draft_liveness', 'draft_liveness exists (D102 — its own table, never a drafts column)');
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'draft_liveness'),
  'draft_liveness has RLS enabled');
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'draft_liveness'),
  0::bigint,
  'draft_liveness carries ZERO policies — no client DML, no client SELECT (D102; writes via draft_touch only)');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_touch'),
  'draft_touch is SECURITY DEFINER with the exact spec-form search_path');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_tick'),
  'draft_tick is SECURITY DEFINER with the exact spec-form search_path');
select ok(
  not has_function_privilege('anon', 'public.draft_tick()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_tick()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.draft_tick()', 'EXECUTE'),
  'draft_tick: anon AND authenticated revoked, service_role keeps EXECUTE (cron/service surface — the 062-internal narrowing)');
select ok(
  not has_function_privilege('anon', 'public.draft_touch(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.draft_touch(uuid)', 'EXECUTE'),
  'draft_touch: anon revoked, authenticated keeps EXECUTE (in-body membership is the gate)');
select ok(
  not has_function_privilege('authenticated', 'public.draft_autopick_resolve(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_autopick_resolve(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_apply_pick_internal(uuid,text,boolean,text,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_apply_pick_internal(uuid,text,boolean,text,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_create_internal(uuid,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_create_internal(uuid,boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_start_internal(uuid,boolean,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_start_internal(uuid,boolean,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.snapshot_league_scoring_internal(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.snapshot_league_scoring_internal(uuid)', 'EXECUTE'),
  'every internal helper (resolve/apply-pick/create/start/snapshot) is revoked from anon AND authenticated');
select ok(
  (select count(*) = 5 and bool_and(not p.prosecdef)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('draft_autopick_resolve', 'draft_apply_pick_internal',
                       'draft_create_internal', 'draft_start_internal',
                       'snapshot_league_scoring_internal')),
  'the five internals are plain (non-SECURITY-DEFINER) — they execute under their SECURITY DEFINER callers (062 form)');
select is(
  public.draft_liveness_freshness(),
  interval '45 seconds',
  'THE D102 freshness constant: 45s = 3 × the 15s heartbeat cadence (fresh = <= 2 missed beats), pinned as a literal');
select is(
  (select count(*) from pg_extension where extname = 'pg_cron'),
  1::bigint,
  'pg_cron is installed (D87 — the tick vehicle)');
select is(
  (select schedule || '|' || command from cron.job where jobname = 'draft-tick'),
  '5 seconds|SELECT public.draft_tick()',
  'ONE cron entry: draft-tick every 5 seconds calling public.draft_tick() (D87/§22.3)');
select ok(
  (select p.prosrc like '%t.league_id IS NOT DISTINCT FROM v_draft.league_id%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_autopick_resolve'),
  'R120 structural pin, AMENDED BY 095/MP.3 (R492): the queue branch still joins teams to the DRAFT''s league — queue rows are untrusted hints (065 banner) — but with `IS NOT DISTINCT FROM`, which is term-for-term identical for every non-NULL league and is what lets a STANDALONE mock''s launcher have their own queue honoured instead of silently ignored while best-ADP wins (043 §E)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — BEFORE any JWT claims; D49(7)).
--    Users u01–u17 + outsider u99. Worlds:
--      LA b3…a1  source-priority (fabricated live draft e3…a1, deadline
--                NULL so the tick never claims it; resolve() called direct)
--      LC b3…c1  greedy world (1-QB roster, 7 rounds; fabricated live
--                draft e3…c1; seeded picks + queues per seat)
--      LD b3…d1  floor world (one-slot roster, 1 round; the slot's ONLY
--                eligible position is a token no player pool can carry, so
--                "nothing fits the forced need" is true BY CONSTRUCTION —
--                see the note at the roster_settings write, ledger F110)
--      LB b3…b1  grace world (REAL draft_start; deadline-rewind harness)
--      LE b3…e1  D94 auto-start (settings blob only, NO drafts row;
--                instant future at fixture time, flipped past in §G)
--      LF b3…f1  auto-start capacity failure (7 of 8 teams)
--      LG b3…e2  auto-start malformed instant
--    Every fixture list is public non-team (the 018 cap trigger caps
--    private/team lists only); big boards are the signup-auto-created rows
--    (partial unique — never insert a second one), populated in place.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('92000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated',
  'pgtap-tk' || lpad(i::text, 2, '0') || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  jsonb_build_object('username', 'tk_user_' || lpad(i::text, 2, '0')),
  now(), now()
from generate_series(1, 17) i;
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '92000000-0000-4000-8000-000000000099',
   'authenticated', 'authenticated', 'pgtap-tk99@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "tk_outsider_99"}',
   now(), now());

-- Players: RB/WR/QB/K plus DEF-position defenses (the research-surface
-- spelling — the DST normalization fixture) and one NULL-adp row.
--
-- FIXTURE ADP IS FRACTIONAL, DELIBERATELY (the R286 lesson / ledger F60/F110;
-- the same band 035 has carried since M3). Every value below is the former
-- INTEGER scale divided by 1000, so it lands in (0, 1) — strictly below the
-- real pool's global minimum ADP — while the order among fixtures is
-- unchanged. `draft_autopick_resolve` reads adp ONLY as an ordering key
-- (`ORDER BY pl.adp NULLS LAST, pl.id`, 086:692/742), so a fixture now wins
-- BY VALUE and this suite is green whether `players` is empty after a reset
-- (F94) or holds a seeded 1,000-row pool (F110). Do NOT restore integers.
insert into players (id, full_name, position, adp)
select 'tk-rb' || lpad(i::text, 2, '0'), 'TK RB ' || lpad(i::text, 2, '0'), 'RB', i / 1000.0
from generate_series(1, 17) i;
insert into players (id, full_name, position, adp)
select 'tk-wr' || lpad(i::text, 2, '0'), 'TK WR ' || lpad(i::text, 2, '0'), 'WR', (30 + i) / 1000.0
from generate_series(1, 10) i;
insert into players (id, full_name, position, adp)
select 'tk-qb' || lpad(i::text, 2, '0'), 'TK QB ' || lpad(i::text, 2, '0'), 'QB', (50 + i) / 1000.0
from generate_series(1, 7) i;
insert into players (id, full_name, position, adp) values
  ('tk-k01', 'TK K 01', 'K', 0.151),
  ('tk-k02', 'TK K 02', 'K', 0.152),
  ('tk-k03', 'TK K 03', 'K', 0.153),
  ('tk-dst01', 'TK DST 01', 'DEF', 0.161),
  ('tk-dst02', 'TK DST 02', 'DEF', 0.162),
  ('tk-nullap', 'TK NULL ADP', 'RB', null);

-- Leagues.
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings) values
  ('b3000000-0000-4000-8000-0000000000a1', '92000000-0000-4000-8000-000000000001',
   'pgtap-tk-LA-sources', 2026, 'scheduled', 8, null, '{}'),
  ('b3000000-0000-4000-8000-0000000000c1', '92000000-0000-4000-8000-000000000012',
   'pgtap-tk-LC-greedy', 2026, 'scheduled', 8, null, '{}'),
  ('b3000000-0000-4000-8000-0000000000d1', '92000000-0000-4000-8000-000000000017',
   'pgtap-tk-LD-floor', 2026, 'scheduled', 8, null, '{}'),
  ('b3000000-0000-4000-8000-0000000000b1', '92000000-0000-4000-8000-000000000005',
   'pgtap-tk-LB-grace', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "snake", "snake_reversal": false, "draft_order_mode": "manual",
     "draft_order": ["c4000000-0000-4000-8000-00b100000001","c4000000-0000-4000-8000-00b100000002",
                     "c4000000-0000-4000-8000-00b100000003","c4000000-0000-4000-8000-00b100000004",
                     "c4000000-0000-4000-8000-00b100000005","c4000000-0000-4000-8000-00b100000006",
                     "c4000000-0000-4000-8000-00b100000007","c4000000-0000-4000-8000-00b100000008"],
     "pick_timer_seconds": 30, "disconnect_grace_seconds": 30}}'),
  ('b3000000-0000-4000-8000-0000000000e1', '92000000-0000-4000-8000-000000000001',
   'pgtap-tk-LE-autostart', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   jsonb_build_object('draft', jsonb_build_object(
     'draft_type', 'snake', 'draft_order_mode', 'random',
     'pick_timer_seconds', 60,
     'draft_scheduled_at', (now() + interval '1 hour')::text))),
  ('b3000000-0000-4000-8000-0000000000f1', '92000000-0000-4000-8000-000000000001',
   'pgtap-tk-LF-short', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   jsonb_build_object('draft', jsonb_build_object(
     'draft_type', 'snake', 'draft_order_mode', 'random',
     'pick_timer_seconds', 60,
     'draft_scheduled_at', (now() + interval '1 hour')::text))),
  ('b3000000-0000-4000-8000-0000000000e2', '92000000-0000-4000-8000-000000000001',
   'pgtap-tk-LG-malformed', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   jsonb_build_object('draft', jsonb_build_object(
     'draft_type', 'snake', 'draft_order_mode', 'random',
     'pick_timer_seconds', 60,
     'draft_scheduled_at', (now() + interval '1 hour')::text)));

-- LC roster: 1-QB world, 7 rounds (qb+rb+wr+k+dst starters, bench 2 — D91).
update leagues
set roster_settings = '{"starting_slots": [
      {"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1},
      {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1},
      {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 1},
      {"key": "k", "label": "K", "eligible": ["K"], "count": 1},
      {"key": "dst", "label": "D/ST", "eligible": ["DST"], "count": 1}],
    "bench": 2, "ir_slots": [], "swap_spots": 0}'
where id = 'b3000000-0000-4000-8000-0000000000c1';
-- LD roster: te-only, 1 round (the floor world — zero TEs exist in the pool).
-- LD, the FLOOR world. The slot's single eligible position is the fabricated
-- token 'NOPOS', NOT 'TE' (ledger F110). What step h needs is a forced need
-- that NOTHING in the candidate set can fill; `eligible: ["TE"]` only
-- delivered that while `players` happened to hold zero TEs, which is a
-- statement about the WHOLE table and not about this fixture — on a seeded
-- dev pool (231 TEs, 94 with an ADP) a real TE fits the need, step h is never
-- reached, and the pin below went red. `draft_autopick_resolve` builds
-- v_need straight from this array and tests membership with
-- `v_row.pos = ANY(v_need)` (086:631/706) — no slot vocabulary is validated
-- and no other branch keys off 'TE' — so an unmatchable token reaches step h
-- by exactly the same path, in an empty pool and a full one alike.
update leagues
set roster_settings = '{"starting_slots": [
      {"key": "floor", "label": "FLOOR", "eligible": ["NOPOS"], "count": 1}],
    "bench": 0, "ir_slots": [], "swap_spots": 0}'
where id = 'b3000000-0000-4000-8000-0000000000d1';

-- Teams. LA t01..t08 (owners u01..u04 seated; t05..t08 fixture-owned by
-- u01) · LC t01..t05 (u12..u16) · LD t01 (u17) · LB t01..t08 (u05..u08 on
-- t1..t4, t5 placeholder-owned by the commish, u09..u11 on t6..t8) ·
-- LE t01..t08 · LF t01..t07 · LG t01..t08.
insert into teams (id, owner_id, name, league_id)
select ('c4000000-0000-4000-8000-00a1000000' || lpad(i::text, 2, '0'))::uuid,
       case when i <= 4
            then ('92000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid
            else '92000000-0000-4000-8000-000000000001'::uuid end,
       'pgtap-tk-a1-t' || lpad(i::text, 2, '0'),
       'b3000000-0000-4000-8000-0000000000a1'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c4000000-0000-4000-8000-00c1000000' || lpad(i::text, 2, '0'))::uuid,
       ('92000000-0000-4000-8000-0000000000' || lpad((11 + i)::text, 2, '0'))::uuid,
       'pgtap-tk-c1-t' || lpad(i::text, 2, '0'),
       'b3000000-0000-4000-8000-0000000000c1'
from generate_series(1, 5) i;
insert into teams (id, owner_id, name, league_id) values
  ('c4000000-0000-4000-8000-00d100000001', '92000000-0000-4000-8000-000000000017',
   'pgtap-tk-d1-t01', 'b3000000-0000-4000-8000-0000000000d1');
insert into teams (id, owner_id, name, league_id)
select ('c4000000-0000-4000-8000-00b1000000' || lpad(i::text, 2, '0'))::uuid,
       case
         when i <= 4 then ('92000000-0000-4000-8000-0000000000' || lpad((4 + i)::text, 2, '0'))::uuid
         when i = 5 then '92000000-0000-4000-8000-000000000005'::uuid
         else ('92000000-0000-4000-8000-0000000000' || lpad((3 + i)::text, 2, '0'))::uuid
       end,
       'pgtap-tk-b1-t' || lpad(i::text, 2, '0'),
       'b3000000-0000-4000-8000-0000000000b1'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c4000000-0000-4000-8000-00e1000000' || lpad(i::text, 2, '0'))::uuid,
       ('92000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'pgtap-tk-e1-t' || lpad(i::text, 2, '0'),
       'b3000000-0000-4000-8000-0000000000e1'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c4000000-0000-4000-8000-00f1000000' || lpad(i::text, 2, '0'))::uuid,
       ('92000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'pgtap-tk-f1-t' || lpad(i::text, 2, '0'),
       'b3000000-0000-4000-8000-0000000000f1'
from generate_series(1, 7) i;
insert into teams (id, owner_id, name, league_id)
select ('c4000000-0000-4000-8000-00e2000000' || lpad(i::text, 2, '0'))::uuid,
       ('92000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'pgtap-tk-e2-t' || lpad(i::text, 2, '0'),
       'b3000000-0000-4000-8000-0000000000e2'
from generate_series(1, 8) i;

-- Members.
insert into league_members (league_id, user_id, team_id, role)
select 'b3000000-0000-4000-8000-0000000000a1',
       ('92000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c4000000-0000-4000-8000-00a1000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 4) i;
insert into league_members (league_id, user_id, team_id, role)
select 'b3000000-0000-4000-8000-0000000000c1',
       ('92000000-0000-4000-8000-0000000000' || lpad((11 + i)::text, 2, '0'))::uuid,
       ('c4000000-0000-4000-8000-00c1000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 5) i;
insert into league_members (league_id, user_id, team_id, role) values
  ('b3000000-0000-4000-8000-0000000000d1', '92000000-0000-4000-8000-000000000017',
   'c4000000-0000-4000-8000-00d100000001', 'commissioner');
-- LB: u05 commissioner (t1), u06..u08 on t2..t4, t5 = PLACEHOLDER (user_id
-- NULL — the E48 no-user seat), u09..u11 on t6..t8.
insert into league_members (league_id, user_id, team_id, role, is_placeholder) values
  ('b3000000-0000-4000-8000-0000000000b1', '92000000-0000-4000-8000-000000000005',
   'c4000000-0000-4000-8000-00b100000001', 'commissioner', false),
  ('b3000000-0000-4000-8000-0000000000b1', '92000000-0000-4000-8000-000000000006',
   'c4000000-0000-4000-8000-00b100000002', 'manager', false),
  ('b3000000-0000-4000-8000-0000000000b1', '92000000-0000-4000-8000-000000000007',
   'c4000000-0000-4000-8000-00b100000003', 'manager', false),
  ('b3000000-0000-4000-8000-0000000000b1', '92000000-0000-4000-8000-000000000008',
   'c4000000-0000-4000-8000-00b100000004', 'manager', false),
  ('b3000000-0000-4000-8000-0000000000b1', null,
   'c4000000-0000-4000-8000-00b100000005', 'manager', true),
  ('b3000000-0000-4000-8000-0000000000b1', '92000000-0000-4000-8000-000000000009',
   'c4000000-0000-4000-8000-00b100000006', 'manager', false),
  ('b3000000-0000-4000-8000-0000000000b1', '92000000-0000-4000-8000-000000000010',
   'c4000000-0000-4000-8000-00b100000007', 'manager', false),
  ('b3000000-0000-4000-8000-0000000000b1', '92000000-0000-4000-8000-000000000011',
   'c4000000-0000-4000-8000-00b100000008', 'manager', false);
insert into league_members (league_id, user_id, team_id, role)
select 'b3000000-0000-4000-8000-0000000000e1',
       ('92000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c4000000-0000-4000-8000-00e1000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 8) i;
insert into league_members (league_id, user_id, team_id, role)
select 'b3000000-0000-4000-8000-0000000000f1',
       ('92000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c4000000-0000-4000-8000-00f1000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 7) i;
insert into league_members (league_id, user_id, team_id, role)
select 'b3000000-0000-4000-8000-0000000000e2',
       ('92000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c4000000-0000-4000-8000-00e2000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 8) i;

-- Fabricated LIVE drafts for the resolve-only worlds (deadline NULL — the
-- tick never claims them; leagues stay pre-drafting so the D43 guard is
-- untouched; a live draft under a scheduled league is a pure-fn fixture).
insert into drafts (id, league_id, draft_type, status, is_mock, config,
                    total_rounds, current_round, current_pick_number) values
  ('e3000000-0000-4000-8000-0000000000a1', 'b3000000-0000-4000-8000-0000000000a1',
   'snake', 'live', false, '{}', 15, 1, 1),
  ('e3000000-0000-4000-8000-0000000000c1', 'b3000000-0000-4000-8000-0000000000c1',
   'snake', 'live', false, '{}', 7, 4, 25),
  ('e3000000-0000-4000-8000-0000000000d1', 'b3000000-0000-4000-8000-0000000000d1',
   'snake', 'live', false, '{}', 1, 1, 1);

-- LA sources: u01 queue (t01) + primary board + big board; u02 primary
-- board + big board (no queue); u03 big board only; u04 nothing.
insert into lists (id, owner_id, title, slug, is_private, is_team, is_big_board) values
  ('d4000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001',
   'tk board u1', 'tk-board-u1', false, false, false),
  ('d4000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002',
   'tk board u2', 'tk-board-u2', false, false, false);
insert into league_lists (league_id, list_id, owner_id, is_primary_board, shared_with_league) values
  ('b3000000-0000-4000-8000-0000000000a1', 'd4000000-0000-4000-8000-000000000001',
   '92000000-0000-4000-8000-000000000001', true, false),
  ('b3000000-0000-4000-8000-0000000000a1', 'd4000000-0000-4000-8000-000000000002',
   '92000000-0000-4000-8000-000000000002', true, false);
insert into list_players (list_id, player_id, position) values
  ('d4000000-0000-4000-8000-000000000001', 'tk-wr01', 1),
  ('d4000000-0000-4000-8000-000000000002', 'tk-wr03', 1),
  ('d4000000-0000-4000-8000-000000000002', 'tk-wr04', 2);
-- Populate the signup-auto-created big boards in place (partial unique —
-- never a second is_big_board row per owner).
insert into list_players (list_id, player_id, position)
select l.id, 'tk-wr02', 1 from lists l
where l.owner_id = '92000000-0000-4000-8000-000000000001' and l.is_big_board;
insert into list_players (list_id, player_id, position)
select l.id, 'tk-wr05', 1 from lists l
where l.owner_id = '92000000-0000-4000-8000-000000000002' and l.is_big_board;
insert into list_players (list_id, player_id, position)
select l.id, 'tk-wr06', 1 from lists l
where l.owner_id = '92000000-0000-4000-8000-000000000003' and l.is_big_board;

insert into draft_queues (draft_id, team_id, player_id, rank) values
  ('e3000000-0000-4000-8000-0000000000a1', 'c4000000-0000-4000-8000-00a100000001', 'tk-rb05', 1),
  ('e3000000-0000-4000-8000-0000000000a1', 'c4000000-0000-4000-8000-00a100000001', 'tk-rb06', 2);
-- R120 blanket fixture: a queue row planted for a FOREIGN league's team
-- (LC's t01) against LA's draft — never honored.
insert into draft_queues (draft_id, team_id, player_id, rank) values
  ('e3000000-0000-4000-8000-0000000000a1', 'c4000000-0000-4000-8000-00c100000001', 'tk-rb02', 1);

-- LC seeded picks (privileged system rows — the resolve fn is pure over
-- table state; action_id NULL = the §12.4 system shape) + per-seat queues.
insert into draft_picks (draft_id, league_id, pick_number, round, team_id, player_id, is_auto, made_via) values
  ('e3000000-0000-4000-8000-0000000000c1', 'b3000000-0000-4000-8000-0000000000c1',
   1, 1, 'c4000000-0000-4000-8000-00c100000001', 'tk-qb01', true, 'autopick'),
  ('e3000000-0000-4000-8000-0000000000c1', 'b3000000-0000-4000-8000-0000000000c1',
   2, 1, 'c4000000-0000-4000-8000-00c100000001', 'tk-qb02', true, 'autopick'),
  ('e3000000-0000-4000-8000-0000000000c1', 'b3000000-0000-4000-8000-0000000000c1',
   3, 1, 'c4000000-0000-4000-8000-00c100000002', 'tk-qb04', true, 'autopick'),
  ('e3000000-0000-4000-8000-0000000000c1', 'b3000000-0000-4000-8000-0000000000c1',
   4, 2, 'c4000000-0000-4000-8000-00c100000004', 'tk-rb13', true, 'autopick'),
  ('e3000000-0000-4000-8000-0000000000c1', 'b3000000-0000-4000-8000-0000000000c1',
   5, 2, 'c4000000-0000-4000-8000-00c100000004', 'tk-wr07', true, 'autopick'),
  ('e3000000-0000-4000-8000-0000000000c1', 'b3000000-0000-4000-8000-0000000000c1',
   6, 2, 'c4000000-0000-4000-8000-00c100000004', 'tk-rb14', true, 'autopick'),
  ('e3000000-0000-4000-8000-0000000000c1', 'b3000000-0000-4000-8000-0000000000c1',
   7, 2, 'c4000000-0000-4000-8000-00c100000004', 'tk-wr08', true, 'autopick'),
  ('e3000000-0000-4000-8000-0000000000c1', 'b3000000-0000-4000-8000-0000000000c1',
   8, 3, 'c4000000-0000-4000-8000-00c100000004', 'tk-qb06', true, 'autopick'),
  ('e3000000-0000-4000-8000-0000000000c1', 'b3000000-0000-4000-8000-0000000000c1',
   9, 3, 'c4000000-0000-4000-8000-00c100000005', 'tk-qb07', true, 'autopick'),
  ('e3000000-0000-4000-8000-0000000000c1', 'b3000000-0000-4000-8000-0000000000c1',
   10, 3, 'c4000000-0000-4000-8000-00c100000005', 'tk-rb15', true, 'autopick'),
  ('e3000000-0000-4000-8000-0000000000c1', 'b3000000-0000-4000-8000-0000000000c1',
   11, 3, 'c4000000-0000-4000-8000-00c100000005', 'tk-wr10', true, 'autopick'),
  ('e3000000-0000-4000-8000-0000000000c1', 'b3000000-0000-4000-8000-0000000000c1',
   12, 4, 'c4000000-0000-4000-8000-00c100000005', 'tk-rb16', true, 'autopick'),
  ('e3000000-0000-4000-8000-0000000000c1', 'b3000000-0000-4000-8000-0000000000c1',
   13, 4, 'c4000000-0000-4000-8000-00c100000005', 'tk-rb17', true, 'autopick'),
  ('e3000000-0000-4000-8000-0000000000c1', 'b3000000-0000-4000-8000-0000000000c1',
   14, 4, 'c4000000-0000-4000-8000-00c100000005', 'tk-k03', true, 'autopick');
insert into draft_queues (draft_id, team_id, player_id, rank) values
  ('e3000000-0000-4000-8000-0000000000c1', 'c4000000-0000-4000-8000-00c100000001', 'tk-qb03', 1),
  ('e3000000-0000-4000-8000-0000000000c1', 'c4000000-0000-4000-8000-00c100000001', 'tk-rb10', 2),
  ('e3000000-0000-4000-8000-0000000000c1', 'c4000000-0000-4000-8000-00c100000002', 'tk-qb05', 1),
  ('e3000000-0000-4000-8000-0000000000c1', 'c4000000-0000-4000-8000-00c100000002', 'tk-rb11', 2),
  ('e3000000-0000-4000-8000-0000000000c1', 'c4000000-0000-4000-8000-00c100000003', 'tk-k01', 1),
  ('e3000000-0000-4000-8000-0000000000c1', 'c4000000-0000-4000-8000-00c100000003', 'tk-rb12', 2),
  ('e3000000-0000-4000-8000-0000000000c1', 'c4000000-0000-4000-8000-00c100000004', 'tk-wr09', 1),
  ('e3000000-0000-4000-8000-0000000000c1', 'c4000000-0000-4000-8000-00c100000004', 'tk-k02', 2),
  ('e3000000-0000-4000-8000-0000000000c1', 'c4000000-0000-4000-8000-00c100000005', 'tk-dst01', 1),
  ('e3000000-0000-4000-8000-0000000000d1', 'c4000000-0000-4000-8000-00d100000001', 'tk-wr01', 1);

-- ---------------------------------------------------------------------------
-- C. draft_touch + draft_liveness surfaces (LA's draft; JWT claims begin)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_touch('e3000000-0000-4000-8000-0000000000a1') $$,
  'member draft_touch succeeds (u01, LA)');
select is(
  (select count(*) from draft_liveness
   where draft_id = 'e3000000-0000-4000-8000-0000000000a1'
     and user_id = '92000000-0000-4000-8000-000000000001'),
  0::bigint,
  'the toucher''s OWN SELECT sees nothing — draft_liveness has no SELECT policy (D102)');
select throws_ok(
  $$ insert into draft_liveness (draft_id, user_id)
     values ('e3000000-0000-4000-8000-0000000000a1', '92000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'authenticated direct INSERT into draft_liveness → 42501 (no policy — writes via draft_touch only)');
select results_eq(
  $$ update draft_liveness set last_seen_at = now()
     where user_id = '92000000-0000-4000-8000-000000000001' returning 1 $$,
  $$ select 1 where false $$,
  'authenticated direct UPDATE on draft_liveness → zero rows (§4.2 RETURNING-counts pattern)');
select results_eq(
  $$ delete from draft_liveness
     where user_id = '92000000-0000-4000-8000-000000000001' returning 1 $$,
  $$ select 1 where false $$,
  'authenticated direct DELETE on draft_liveness → zero rows');

select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000099", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_touch('e3000000-0000-4000-8000-0000000000a1') $$,
  '42501', 'draft_touch: not a member of this draft''s league',
  'non-member draft_touch → 42501');
select throws_ok(
  $$ select public.draft_touch('99999999-0000-4000-8000-000000000000') $$,
  '42501', 'draft_touch: not a member of this draft''s league',
  'nonexistent draft → the SAME 42501 (no existence leak)');
select throws_ok(
  $$ select public.draft_tick() $$,
  '42501', null,
  'authenticated draft_tick → permission denied (EXECUTE revoked — cron/service only)');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok(
  $$ select public.draft_touch('e3000000-0000-4000-8000-0000000000a1') $$,
  '42501', null,
  'anon draft_touch → 42501 (EXECUTE revoked)');
reset role;

select is(
  (select count(*) from draft_liveness
   where draft_id = 'e3000000-0000-4000-8000-0000000000a1'
     and user_id = '92000000-0000-4000-8000-000000000001'
     and last_seen_at = now()),
  1::bigint,
  'the heartbeat row landed with last_seen_at = now() (privileged read; txn-frozen now)');
update draft_liveness set last_seen_at = now() - interval '10 minutes'
where draft_id = 'e3000000-0000-4000-8000-0000000000a1'
  and user_id = '92000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_touch('e3000000-0000-4000-8000-0000000000a1') $$,
  're-touch lives (upsert path)');
reset role;
select is(
  (select count(*) from draft_liveness
   where draft_id = 'e3000000-0000-4000-8000-0000000000a1'
     and user_id = '92000000-0000-4000-8000-000000000001'
     and last_seen_at = now()),
  1::bigint,
  're-touch UPDATED the existing row back to now() (one row per (draft,user) — the PK upsert)');

-- ---------------------------------------------------------------------------
-- D. Source-priority pins (LA — resolve() direct, privileged; task item 4)
-- ---------------------------------------------------------------------------
select is(
  public.draft_autopick_resolve('e3000000-0000-4000-8000-0000000000a1',
                                'c4000000-0000-4000-8000-00a100000001'),
  'tk-rb05',
  'source 1: the QUEUE top wins over primary board + big board + ADP (seat u01)');

-- The seat-1 queue top goes off the board (another seat drafts it).
insert into draft_picks (draft_id, league_id, pick_number, round, team_id, player_id, is_auto, made_via) values
  ('e3000000-0000-4000-8000-0000000000a1', 'b3000000-0000-4000-8000-0000000000a1',
   1, 1, 'c4000000-0000-4000-8000-00a100000008', 'tk-rb05', true, 'autopick');

select is(
  public.draft_autopick_resolve('e3000000-0000-4000-8000-0000000000a1',
                                'c4000000-0000-4000-8000-00a100000001'),
  'tk-rb06',
  'skip-drafted WITHIN the source: queue #2 answers — the source is not abandoned for the board');
select is(
  public.draft_autopick_resolve('e3000000-0000-4000-8000-0000000000a1',
                                'c4000000-0000-4000-8000-00a100000002'),
  'tk-wr03',
  'source 2: the PRIMARY league-tagged board beats the big board + ADP (seat u02, no queue)');
select is(
  public.draft_autopick_resolve('e3000000-0000-4000-8000-0000000000a1',
                                'c4000000-0000-4000-8000-00a100000003'),
  'tk-wr06',
  'source 3: the OWN big board beats ADP (seat u03 — also discriminates the board owner filter)');
select is(
  public.draft_autopick_resolve('e3000000-0000-4000-8000-0000000000a1',
                                'c4000000-0000-4000-8000-00a100000004'),
  'tk-rb01',
  'source 4: lowest players.adp (seat u04 — no queue, no boards)');
select is(
  public.draft_autopick_resolve('e3000000-0000-4000-8000-0000000000a1',
                                'c4000000-0000-4000-8000-00c100000001'),
  'tk-rb01',
  'R120 blanket: a FOREIGN team''s planted queue row (tk-rb02) is never honored — the no-user seat answers the ADP floor');

-- ---------------------------------------------------------------------------
-- E. The documented greedy: 3rd-QB + E30 + forced + normalization + floor
--    (LC/LD — resolve() direct)
-- ---------------------------------------------------------------------------
select is(
  public.draft_autopick_resolve('e3000000-0000-4000-8000-0000000000c1',
                                'c4000000-0000-4000-8000-00c100000001'),
  'tk-rb10',
  '3rd-QB BLOCK (§8.4, greedy step e): 1-QB league, 2 QBs held, needs open → the queue''s 3rd QB is skipped for the RB');
select is(
  public.draft_autopick_resolve('e3000000-0000-4000-8000-0000000000c1',
                                'c4000000-0000-4000-8000-00c100000002'),
  'tk-qb05',
  'POSITIVE CONTROL: 1 QB held → the 2nd QB (the backup, cap S+1) IS taken from the queue');
select is(
  public.draft_autopick_resolve('e3000000-0000-4000-8000-0000000000c1',
                                'c4000000-0000-4000-8000-00c100000003'),
  'tk-rb12',
  'E30 boundary, deferred side: round 4 = total_rounds−3 (7−3) → the queue-top K is skipped');
update drafts set current_round = 5
where id = 'e3000000-0000-4000-8000-0000000000c1';
select is(
  public.draft_autopick_resolve('e3000000-0000-4000-8000-0000000000c1',
                                'c4000000-0000-4000-8000-00c100000003'),
  'tk-k01',
  'E30 boundary, eligible side: round 5 = total_rounds−2 → round > total_rounds−3 → the K is taken');
update drafts set current_round = 4
where id = 'e3000000-0000-4000-8000-0000000000c1';
select is(
  public.draft_autopick_resolve('e3000000-0000-4000-8000-0000000000c1',
                                'c4000000-0000-4000-8000-00c100000004'),
  'tk-k02',
  'FORCED mode (remaining == unfilled K+DST seats) overrides E30 at round total_rounds−3 AND skips the non-need queue WR');
select is(
  public.draft_autopick_resolve('e3000000-0000-4000-8000-0000000000c1',
                                'c4000000-0000-4000-8000-00c100000005'),
  'tk-dst01',
  'DEF→DST normalization: a players.position=DEF fixture fills the forced dst seat (normalization dropped ⇒ the ADP floor answers)');
select is(
  public.draft_autopick_resolve('e3000000-0000-4000-8000-0000000000d1',
                                'c4000000-0000-4000-8000-00d100000001'),
  'tk-rb01',
  'the FLOOR (greedy step h): a forced need NO player in the pool can fill → lowest-ADP available, filters dropped — the draft never stalls (§22.3)');

-- ---------------------------------------------------------------------------
-- F. The grace world (LB): REAL draft_start + the D100 deadline-rewind
--    harness — both grace branches, autodraft, placeholder, the 45s
--    constant from both sides, the manual pick during a stale hold
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select is(
  (public.draft_start('b3000000-0000-4000-8000-0000000000b1')->>'started')::boolean,
  true,
  'LB starts (real draft_start — commissioner u05; timer 30s, grace 30s)');
-- u05 heartbeats (the room's draft_touch — FRESH seat).
select lives_ok(
  $$ select public.draft_touch((select id from drafts
       where league_id = 'b3000000-0000-4000-8000-0000000000b1')) $$,
  'the on-clock manager heartbeats via draft_touch (FRESH)');
reset role;

-- Pick 1 — FRESH seat autopicks AT the deadline (+1s): §8.5.4.
-- R132: the harness's txn-frozen now() would leave the touch's
-- last_seen_at AFTER the rewound deadline (now() vs now()−1s), which
-- post-R132 correctly reads as a mid-hold beat. The scenario's intent is
-- a heartbeat BEFORE expiry — pin the instant pre-deadline (5s before,
-- well inside the 45s window).
update draft_liveness set last_seen_at = now() - interval '5 seconds'
where user_id = '92000000-0000-4000-8000-000000000005';
update drafts set current_deadline = now() - interval '1 second'
where league_id = 'b3000000-0000-4000-8000-0000000000b1';
select set_config('pgtap.tk_tick1', public.draft_tick()::text, true);
select is(
  (select player_id || '|' || is_auto::text || '|' || made_via
          || '|' || coalesce(picked_by::text, 'NULL') || '|' || coalesce(action_id::text, 'NULL')
   from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b3000000-0000-4000-8000-0000000000b1' and p.pick_number = 1),
  'tk-rb01|true|autopick|NULL|NULL',
  'FRESH seat: autopick at deadline+1s — the §12.4 system shape (is_auto, made_via=autopick, NULL picked_by/action_id), ADP source');
select is(
  (select current_pick_number from drafts
   where league_id = 'b3000000-0000-4000-8000-0000000000b1'),
  2,
  'the autopick advanced through the SAME path as a manual pick (draft_apply_pick_internal — pick 2 on the clock)');

-- Pick 2 — STALE seat (u06, no heartbeat): HELD at deadline+grace−1s,
-- picked at +1s (D102 boundary instants).
update drafts set current_deadline = now() - interval '29 seconds'
where league_id = 'b3000000-0000-4000-8000-0000000000b1';
select set_config('pgtap.tk_tick2', public.draft_tick()::text, true);
select is(
  (select count(*) from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b3000000-0000-4000-8000-0000000000b1' and p.pick_number = 2),
  0::bigint,
  'STALE seat NOT picked at deadline+grace−1s — the pick is HELD OPEN (D102)');
select ok(
  (current_setting('pgtap.tk_tick2')::jsonb->>'held_for_grace')::int >= 1,
  'the tick summary counted the hold');
update drafts set current_deadline = now() - interval '31 seconds'
where league_id = 'b3000000-0000-4000-8000-0000000000b1';
select set_config('pgtap.tk_tick3', public.draft_tick()::text, true);
select is(
  (select player_id || '|' || made_via
   from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b3000000-0000-4000-8000-0000000000b1' and p.pick_number = 2),
  'tk-rb02|autopick',
  'STALE seat picked at deadline+grace+1s (§8.5.4 after the §8.5.5 hold)');

-- Pick 3 — a MANUAL pick lands DURING a stale hold (u07; §8.5.5/E3
-- "reconnect restores manual control" — draft_make_pick never checks the
-- deadline).
update drafts set current_deadline = now() - interval '10 seconds'
where league_id = 'b3000000-0000-4000-8000-0000000000b1';
select set_config('pgtap.tk_tick4', public.draft_tick()::text, true);
select is(
  (select count(*) from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b3000000-0000-4000-8000-0000000000b1' and p.pick_number = 3),
  0::bigint,
  'the stale hold is in effect for pick 3 (tick made no pick)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000007", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_make_pick(
       (select id from drafts where league_id = 'b3000000-0000-4000-8000-0000000000b1'),
       'tk-wr01', 'a5000000-0000-4000-8000-000000000001') $$,
  'the returning human picks MANUALLY during the hold');
reset role;
select is(
  (select player_id || '|' || is_auto::text || '|' || made_via
   from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b3000000-0000-4000-8000-0000000000b1' and p.pick_number = 3),
  'tk-wr01|false|manager',
  'the manual pick landed as a manager pick — the hold preserved manual control (E3)');

-- Pick 4 — is_autodraft seat (u08, STALE): picks AT the deadline, no grace
-- (the branch discriminator).
update league_members set is_autodraft = true
where league_id = 'b3000000-0000-4000-8000-0000000000b1'
  and user_id = '92000000-0000-4000-8000-000000000008';
update drafts set current_deadline = now() - interval '1 second'
where league_id = 'b3000000-0000-4000-8000-0000000000b1';
select set_config('pgtap.tk_tick5', public.draft_tick()::text, true);
select is(
  (select player_id || '|' || made_via
   from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b3000000-0000-4000-8000-0000000000b1' and p.pick_number = 4),
  'tk-rb03|autopick',
  'is_autodraft seat: autopick at deadline+1s despite being STALE (no grace hold — §8.4)');

-- Pick 5 — NO-USER placeholder seat: E48''s autopilot, at the deadline.
update drafts set current_deadline = now() - interval '1 second'
where league_id = 'b3000000-0000-4000-8000-0000000000b1';
select set_config('pgtap.tk_tick6', public.draft_tick()::text, true);
select is(
  (select player_id || '|' || made_via
   from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b3000000-0000-4000-8000-0000000000b1' and p.pick_number = 5),
  'tk-rb04|autopick',
  'NO-USER placeholder seat: autopick at deadline+1s, no grace (E48 autopilot)');

-- Pick 6 — the 45s freshness constant from BOTH sides (u09 on t6).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000009", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_touch((select id from drafts
       where league_id = 'b3000000-0000-4000-8000-0000000000b1')) $$,
  'seat u09 heartbeats');
reset role;
update draft_liveness set last_seen_at = now() - interval '46 seconds'
where user_id = '92000000-0000-4000-8000-000000000009';
update drafts set current_deadline = now() - interval '1 second'
where league_id = 'b3000000-0000-4000-8000-0000000000b1';
select set_config('pgtap.tk_tick7', public.draft_tick()::text, true);
select is(
  (select count(*) from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b3000000-0000-4000-8000-0000000000b1' and p.pick_number = 6),
  0::bigint,
  'liveness 46s old → STALE (> 45s = 3 missed beats) → held, not picked');
update draft_liveness set last_seen_at = now() - interval '44 seconds'
where user_id = '92000000-0000-4000-8000-000000000009';
select set_config('pgtap.tk_tick8', public.draft_tick()::text, true);
select is(
  (select player_id || '|' || made_via
   from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b3000000-0000-4000-8000-0000000000b1' and p.pick_number = 6),
  'tk-rb05|autopick',
  'liveness 44s old → FRESH (<= 2 missed beats) → autopick at the deadline — both sides of the pinned constant');

-- Pick 7 — RECONNECT MID-HOLD (u10 on t7; R132, M2 batch 4): the branch is
-- decided from freshness AS OF the deadline, so the returning manager's
-- own post-deadline heartbeat must NOT end the D102 hold (pre-R132 the
-- next tick autopicked them with ~2/3 of the grace remaining — E3's
-- "reconnect restores manual control" defeated in exactly the scenario
-- the hold exists for). Held before AND after the touch; autopick only at
-- deadline + grace.
update drafts set current_deadline = now() - interval '10 seconds'
where league_id = 'b3000000-0000-4000-8000-0000000000b1';
select set_config('pgtap.tk_tick9', public.draft_tick()::text, true);
select is(
  (select count(*) from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b3000000-0000-4000-8000-0000000000b1' and p.pick_number = 7),
  0::bigint,
  'stale seat u10 (no heartbeat at all): held at deadline+10s — the baseline hold');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "92000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_touch((select id from drafts
       where league_id = 'b3000000-0000-4000-8000-0000000000b1')) $$,
  'the returning manager heartbeats MID-HOLD (draft_touch — a post-deadline beat)');
reset role;
select set_config('pgtap.tk_tick10', public.draft_tick()::text, true);
select is(
  (select count(*) from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b3000000-0000-4000-8000-0000000000b1' and p.pick_number = 7),
  0::bigint,
  'R132: the mid-hold reconnect does NOT end the hold — no pick (the beat restores manual control, never the fresh-at-expiry branch)');
select ok(
  (current_setting('pgtap.tk_tick10')::jsonb->>'held_for_grace')::int >= 1,
  '…and the tick summary counted a HOLD, not a fresh-branch autopick');
update drafts set current_deadline = now() - interval '31 seconds'
where league_id = 'b3000000-0000-4000-8000-0000000000b1';
select set_config('pgtap.tk_tick11', public.draft_tick()::text, true);
select is(
  (select player_id || '|' || made_via
   from draft_picks p join drafts d on d.id = p.draft_id
   where d.league_id = 'b3000000-0000-4000-8000-0000000000b1' and p.pick_number = 7),
  'tk-rb06|autopick',
  '…and the held seat autopicks at deadline+grace+1s despite the mid-hold beat (§8.5.4 after the FULL §8.5.5 hold)');

-- ---------------------------------------------------------------------------
-- G. D94 auto-start (LE) + failure recording/retry (LF) + malformed
--    instant (LG)
-- ---------------------------------------------------------------------------
select set_config('pgtap.tk_tickg0', public.draft_tick()::text, true);
select is(
  (select status from leagues where id = 'b3000000-0000-4000-8000-0000000000e1'),
  'scheduled',
  'a FUTURE draft_scheduled_at leaves the league untouched');
select is(
  (select count(*) from drafts where league_id = 'b3000000-0000-4000-8000-0000000000e1'),
  0::bigint,
  '…and creates no drafts row');

-- The instant passes (the settings-surface end state: blob only, NO drafts
-- row — the 020 LJ precedent).
update leagues
set settings = jsonb_set(settings, '{draft,draft_scheduled_at}',
                         to_jsonb((now() - interval '5 minutes')::text))
where id = 'b3000000-0000-4000-8000-0000000000e1';
select set_config('pgtap.tk_tickg1', public.draft_tick()::text, true);
select ok(
  (current_setting('pgtap.tk_tickg1')::jsonb->>'auto_started')::int >= 1,
  'the tick reports an auto-start');
select is(
  (select count(*) from drafts where league_id = 'b3000000-0000-4000-8000-0000000000e1'),
  1::bigint,
  'D94 no-dead-end: the tick CREATED the missing drafts row (league scheduled via the settings surface alone)');
select is(
  (select status || '|' || total_rounds::text
   from drafts where league_id = 'b3000000-0000-4000-8000-0000000000e1'),
  'live|16',
  '…and STARTED it (live; total_rounds 16 per D91 from the default roster — 16 since SC.2, the v2.16.9 Scout default roster)');
select is(
  (select status from leagues where id = 'b3000000-0000-4000-8000-0000000000e1'),
  'drafting',
  '…league transitioned to drafting (draft_start_internal — the ONE start path)');
select ok(
  (select scoring_rules_snapshot is not null
   from leagues where id = 'b3000000-0000-4000-8000-0000000000e1'),
  '…snapshot taken BEFORE the transition (identical to the manual path — D43/D64(2))');
select is(
  (select current_deadline from drafts
   where league_id = 'b3000000-0000-4000-8000-0000000000e1'),
  now() + interval '60 seconds',
  '…pick-1 deadline = now() + the configured 60s timer');
select ok(
  (select jsonb_array_length(draft_order) = 8
      and (select count(distinct e.val) from jsonb_array_elements_text(draft_order) e(val)) = 8
      and not exists (
        select 1 from jsonb_array_elements_text(draft_order) e(val)
        where not exists (select 1 from teams t
                          where t.id::text = e.val
                            and t.league_id = 'b3000000-0000-4000-8000-0000000000e1'))
   from drafts where league_id = 'b3000000-0000-4000-8000-0000000000e1'),
  '…random draft_order is a permutation of LE''s eight franchises');

-- LF: capacity-short (7 of 8) → recorded failure, retried, never silent.
update leagues
set settings = jsonb_set(settings, '{draft,draft_scheduled_at}',
                         to_jsonb((now() - interval '5 minutes')::text))
where id = 'b3000000-0000-4000-8000-0000000000f1';
select set_config('pgtap.tk_tickg2', public.draft_tick()::text, true);
select ok(
  current_setting('pgtap.tk_tickg2')::jsonb->'start_failures'
    @> jsonb_build_array(jsonb_build_object('league_id', 'b3000000-0000-4000-8000-0000000000f1')),
  'a capacity-short scheduled league FAILS INTO THE SUMMARY (start_failures names it — D94, never a silent skip)');
select is(
  (select status || '|' || (select count(*) from drafts
       where league_id = 'b3000000-0000-4000-8000-0000000000f1')::text
   from leagues where id = 'b3000000-0000-4000-8000-0000000000f1'),
  'scheduled|0',
  '…the failed auto-start left no partial state (league scheduled, zero drafts rows — subtransaction rollback)');
select set_config('pgtap.tk_tickg3', public.draft_tick()::text, true);
select ok(
  current_setting('pgtap.tk_tickg3')::jsonb->'start_failures'
    @> jsonb_build_array(jsonb_build_object('league_id', 'b3000000-0000-4000-8000-0000000000f1')),
  '…and the NEXT tick retries and records it again (retried each tick)');

-- LG: a malformed stored instant is THAT league''s recorded failure, never
-- a scan abort (the cast runs inside the per-league subtransaction).
update leagues
set settings = jsonb_set(settings, '{draft,draft_scheduled_at}', '"not-a-date"')
where id = 'b3000000-0000-4000-8000-0000000000e2';
select set_config('pgtap.tk_tickg4', public.draft_tick()::text, true);
select ok(
  current_setting('pgtap.tk_tickg4')::jsonb->'start_failures'
    @> jsonb_build_array(jsonb_build_object('league_id', 'b3000000-0000-4000-8000-0000000000e2')),
  'a malformed draft_scheduled_at is recorded as that league''s failure — the scan survives');
select is(
  (select status from leagues where id = 'b3000000-0000-4000-8000-0000000000e2'),
  'scheduled',
  '…and the malformed-instant league is untouched');

select * from finish();
rollback;
