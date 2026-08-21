-- ============================================================================
-- Draft core RPCs — migration 066 (spec §8.1/§8.3/§8.5/§7.2/§7.3.8,
-- §12.3–12.4; tasks-M2 §3 D90/D91/D94/D95/D96/D101 + §4.6; task L.B1.2).
-- pgTAP file is **020** (019 = draft tables; next free confirmed at task
-- time).
--
-- Falsifiability notes (§4.3):
--   * ORDER MATH GOLDEN PINS (task item 3): stored-literal pick→team tables
--     for rounds 1–4 — 8-team no-reversal (32 rows), 12-team 3RR (48 rows),
--     linear (32 rows) — pinned TWICE: directly at the D90 helper
--     (draft_team_for_pick) AND from real `draft_picks` rows produced by
--     driving the REAL draft_make_pick RPC as each seat's manager (so the
--     RPC wiring cannot drift from the helper). The DoD break probe
--     (invert the reversal parity in 066) fails exactly these pins.
--   * E1 single-session analogue: the second pick of an already-taken
--     player refuses with the EXACT friendly message ("… just went off the
--     board — pick another player"); the index remains the guarantee
--     (proven at the index in 019).
--   * E2 replay: the same action_id called twice returns a BYTE-IDENTICAL
--     response (text-compared via a captured GUC), inserts nothing, and
--     advances nothing.
--   * Wrong-turn refusal names the on-clock team; the COMMISSIONER gets the
--     same refusal when not on the clock (no role bypass — commissioners
--     use L.B1.4's force path).
--   * Capacity boundary (D96): team_count−1 franchises → the friendly
--     refusal naming placeholder seats; == team_count → start succeeds.
--   * D43 order probe, BOTH ways: (a) a normal start on a snapshot-NULL
--     league succeeds BECAUSE draft_start snapshots BEFORE the transition
--     (snapshot pinned non-NULL after); (b) a league that CANNOT snapshot
--     (scoring_system_id NULL) fails LOUDLY with 059's message and leaves
--     league + drafts untouched; (c) the privileged forced flip to
--     'drafting' with a NULL snapshot raises from the 059 trigger (the
--     backstop shown live).
--   * Untimed (§8.2 soft timer): pick_timer_seconds = 0 leaves
--     current_deadline NULL at start AND after a pick.
--   * Completion: all total_rounds × team_count live picks → 'complete' +
--     completed_at; the league moves to 'in_season' in the same txn (the
--     pin 020 originally held at 'drafting' as the L.B1.7 cross-reference
--     — FLIPPED by 072/L.B1.7 exactly as promised, F12; the roster-side
--     completion pins live in 026).
--   * D95 re-hydration: a drafts row pre-created with a STALE config
--     (timer 90) starts under the LIVE settings value (120) — pinned on
--     config and on the actual deadline.
--   * D94 no-dead-end (manual path): draft_start on a scheduled league
--     with NO drafts row creates + starts it in one call.
--   * Random order (D101/D105/R123): the generated draft_order is a
--     permutation of the active team ids (length/distinct/membership
--     pinned, LJ); random mode IGNORES a settings-blob draft_order
--     leftover (R123) — LK pre-creates the drafts row with a FIXED id so
--     the seeded md5 shuffle is a stored literal, pinned equal to the
--     shuffle and UNEQUAL to the stale config array (the batch-2 break
--     probe restores the config fallback under random and flips both RED).
--   * Lock order (R122): exactly one FOR UPDATE (the leagues lock)
--     precedes the scheduled gate in draft_start's body — the drafts-row
--     lock sits below it (taking it above deadlocks an in-flight pick's
--     FK KEY SHARE on the leagues row: 40P01, live-proven in the batch-2
--     R122 probe and demonstrated fixed in the same session).
--   * Mock branch (D103(2), landed by L.B1.6/071 — the seam pin this file
--     originally carried FLIPPED with it): a non-launcher member's pick on
--     an is_mock draft gets the friendly solo-practice refusal (the
--     fixture mock is config-less, so launched_by NULL keeps it
--     tick-only); the launcher-positive + CPU-seat sides live in pgTAP
--     025. Auction PICK still refuses — permanently: an auction never
--     picks through this RPC — but 085/L.C1.3 REWORDED the message from
--     the milestone promise ("the auction engine lands in M3") to the
--     standing truth ("auction drafts pick via nominate and bid"), and
--     this file's assertion moved with it in that PR. Auction START no
--     longer refuses at all — 084/L.C1.2 landed the engine and that
--     assertion is now a start-SUCCEEDS pin (LM, the seated auction
--     league). The auction ACTION verbs (draft_nominate/draft_place_bid)
--     are pgTAP 034's, not this file's.
--   * The SNAKE side of 084's shared write (R324): 084's drafts UPDATE
--     writes `nomination_order` on BOTH paths, so LB's row carries a stale
--     stored order before its start and §G pins that the start CLEARS it.
--     An auction-arm value leaking onto a snake start fails there. The
--     auction MATRIX (derivation goldens, nomination modes, solvency, the
--     D96 capacity refusal on an auction) is pgTAP 033's, not this file's.
--   * All privileged fixture work runs BEFORE any JWT claims (D49(7));
--     mid-test privileged pins use `reset role` (013/014/018/019 pattern).
--     The pick-drive helper (pg_temp.dc_drive) runs privileged and sets
--     per-pick claims itself — draft_make_pick reads only auth.uid(), so
--     the SECURITY DEFINER path under test is identical to the wire path.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(94);

-- ---------------------------------------------------------------------------
-- A. Function form (§4.1 grants doctrine; plan §8.3)
-- ---------------------------------------------------------------------------
select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_create'),
  'draft_create is SECURITY DEFINER');
select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_start'),
  'draft_start is SECURITY DEFINER');
select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_make_pick'),
  'draft_make_pick is SECURITY DEFINER');
select ok(
  (select count(*) = 3 and coalesce(bool_and(array_to_string(p.proconfig, ',') = 'search_path=""'), false)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('draft_create', 'draft_start', 'draft_make_pick')),
  'all three RPCs carry the exact spec-form SET search_path = '''' (R70 pin)');
select ok(
  not has_function_privilege('anon', 'public.draft_create(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_start(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.draft_make_pick(uuid,text,uuid)', 'EXECUTE'),
  'anon holds EXECUTE on none of the three RPCs (explicit REVOKE — §4.1/038 precedent)');
select ok(
  has_function_privilege('authenticated', 'public.draft_create(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.draft_start(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.draft_make_pick(uuid,text,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.draft_create(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.draft_start(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.draft_make_pick(uuid,text,uuid)', 'EXECUTE'),
  'authenticated + service_role keep EXECUTE (in-body checks are the gate)');
select has_function('public', 'draft_team_for_pick',
  array['jsonb', 'text', 'boolean', 'integer'],
  'draft_team_for_pick(jsonb,text,boolean,integer) exists — the ONE D90 order-math implementation');
select has_function('public', 'draft_rounds_from_roster', array['jsonb'],
  'draft_rounds_from_roster(jsonb) exists — the ONE D91 implementation');
select ok(
  (select count(*) = 2
      and bool_and(not p.prosecdef)
      and bool_and(p.provolatile = 'i')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('draft_team_for_pick', 'draft_rounds_from_roster')),
  'both helpers are plain (non-SECURITY-DEFINER) IMMUTABLE functions — pure math, no data access (D49(3))');

-- R122 structural pin (the R101 bounded-window pattern): in the start
-- body, exactly ONE 'FOR UPDATE' — the leagues lock — may precede the
-- scheduled-gate message; the drafts-row lock must sit BELOW the gate
-- (taking it above, under the held league lock, deadlocks against an
-- in-flight pick's FK KEY SHARE on the leagues row — live-proven 40P01).
-- Deliberately strict: the count includes comments, so even MENTIONING a
-- pre-gate FOR UPDATE forces a look at this invariant. Target retargeted
-- to draft_start_internal by the L.B1.3 amendment (a): draft_start is now
-- a thin auth wrapper and the ONE start body — locks included — lives in
-- the internal (066 banner).
select is(
  (select (length(pre) - length(replace(pre, 'FOR UPDATE', ''))) / length('FOR UPDATE')
   from (select split_part(p.prosrc, 'schedule the draft first', 1) as pre
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'draft_start_internal') s),
  1,
  'R122: exactly one FOR UPDATE (the leagues lock) precedes the scheduled gate in draft_start_internal — the drafts-row lock sits below it (no FK-KEY-SHARE deadlock window)');

-- ---------------------------------------------------------------------------
-- B. D91: total_rounds = starters + bench, IR EXCLUDED
-- ---------------------------------------------------------------------------
select is(
  public.draft_rounds_from_roster('{
    "starting_slots": [
      {"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1},
      {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 2},
      {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 2},
      {"key": "te", "label": "TE", "eligible": ["TE"], "count": 1},
      {"key": "flex", "label": "FLEX (W/R/T)", "eligible": ["WR", "RB", "TE"], "count": 1},
      {"key": "k", "label": "K", "eligible": ["K"], "count": 1},
      {"key": "dst", "label": "D/ST", "eligible": ["DST"], "count": 1}
    ],
    "bench": 6,
    "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}],
    "swap_spots": 0
  }'::jsonb),
  15,
  'default roster → 15 rounds (9 starters + 6 bench; the 1 IR spot EXCLUDED — a naive +IR implementation returns 16, D91)');
select is(
  public.draft_rounds_from_roster('{
    "starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 2}],
    "bench": 0, "ir_slots": [], "swap_spots": 0
  }'::jsonb),
  2,
  'minimal roster (2 starters + 0 bench) → 2 rounds');
select is(
  public.draft_rounds_from_roster('{
    "starting_slots": [], "bench": 3,
    "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT"]},
                 {"key": "ir2", "type": "unrestricted", "eligible_designations": ["OUT"]}],
    "swap_spots": 0
  }'::jsonb),
  3,
  'bench-only roster → 3 rounds (both IR spots excluded)');

-- ---------------------------------------------------------------------------
-- C. D90 order-math golden pins at the helper — stored-literal pick→team
--    tables, rounds 1–4 (the break probe''s primary target)
-- ---------------------------------------------------------------------------

-- C1. 8-team snake, NO reversal.
select results_eq(
  $$ select p, public.draft_team_for_pick(
       '["00000000-0000-4000-8000-000000000001",
         "00000000-0000-4000-8000-000000000002",
         "00000000-0000-4000-8000-000000000003",
         "00000000-0000-4000-8000-000000000004",
         "00000000-0000-4000-8000-000000000005",
         "00000000-0000-4000-8000-000000000006",
         "00000000-0000-4000-8000-000000000007",
         "00000000-0000-4000-8000-000000000008"]'::jsonb,
       'snake', false, p)
     from generate_series(1, 32) p $$,
  $$ values
     ( 1, '00000000-0000-4000-8000-000000000001'::uuid),
     ( 2, '00000000-0000-4000-8000-000000000002'::uuid),
     ( 3, '00000000-0000-4000-8000-000000000003'::uuid),
     ( 4, '00000000-0000-4000-8000-000000000004'::uuid),
     ( 5, '00000000-0000-4000-8000-000000000005'::uuid),
     ( 6, '00000000-0000-4000-8000-000000000006'::uuid),
     ( 7, '00000000-0000-4000-8000-000000000007'::uuid),
     ( 8, '00000000-0000-4000-8000-000000000008'::uuid),
     ( 9, '00000000-0000-4000-8000-000000000008'::uuid),
     (10, '00000000-0000-4000-8000-000000000007'::uuid),
     (11, '00000000-0000-4000-8000-000000000006'::uuid),
     (12, '00000000-0000-4000-8000-000000000005'::uuid),
     (13, '00000000-0000-4000-8000-000000000004'::uuid),
     (14, '00000000-0000-4000-8000-000000000003'::uuid),
     (15, '00000000-0000-4000-8000-000000000002'::uuid),
     (16, '00000000-0000-4000-8000-000000000001'::uuid),
     (17, '00000000-0000-4000-8000-000000000001'::uuid),
     (18, '00000000-0000-4000-8000-000000000002'::uuid),
     (19, '00000000-0000-4000-8000-000000000003'::uuid),
     (20, '00000000-0000-4000-8000-000000000004'::uuid),
     (21, '00000000-0000-4000-8000-000000000005'::uuid),
     (22, '00000000-0000-4000-8000-000000000006'::uuid),
     (23, '00000000-0000-4000-8000-000000000007'::uuid),
     (24, '00000000-0000-4000-8000-000000000008'::uuid),
     (25, '00000000-0000-4000-8000-000000000008'::uuid),
     (26, '00000000-0000-4000-8000-000000000007'::uuid),
     (27, '00000000-0000-4000-8000-000000000006'::uuid),
     (28, '00000000-0000-4000-8000-000000000005'::uuid),
     (29, '00000000-0000-4000-8000-000000000004'::uuid),
     (30, '00000000-0000-4000-8000-000000000003'::uuid),
     (31, '00000000-0000-4000-8000-000000000002'::uuid),
     (32, '00000000-0000-4000-8000-000000000001'::uuid) $$,
  '8-team snake no-reversal: pick→team table rounds 1–4 (stored literal — fwd/rev/fwd/rev)');

-- C2. 12-team snake WITH 3rd-round reversal (§8.3: r1 fwd, r2 rev, r3 REV
--     — the flip — r4 fwd).
select results_eq(
  $$ select p, public.draft_team_for_pick(
       '["00000000-0000-4000-8000-000000000001",
         "00000000-0000-4000-8000-000000000002",
         "00000000-0000-4000-8000-000000000003",
         "00000000-0000-4000-8000-000000000004",
         "00000000-0000-4000-8000-000000000005",
         "00000000-0000-4000-8000-000000000006",
         "00000000-0000-4000-8000-000000000007",
         "00000000-0000-4000-8000-000000000008",
         "00000000-0000-4000-8000-000000000009",
         "00000000-0000-4000-8000-000000000010",
         "00000000-0000-4000-8000-000000000011",
         "00000000-0000-4000-8000-000000000012"]'::jsonb,
       'snake', true, p)
     from generate_series(1, 48) p $$,
  $$ values
     ( 1, '00000000-0000-4000-8000-000000000001'::uuid),
     ( 2, '00000000-0000-4000-8000-000000000002'::uuid),
     ( 3, '00000000-0000-4000-8000-000000000003'::uuid),
     ( 4, '00000000-0000-4000-8000-000000000004'::uuid),
     ( 5, '00000000-0000-4000-8000-000000000005'::uuid),
     ( 6, '00000000-0000-4000-8000-000000000006'::uuid),
     ( 7, '00000000-0000-4000-8000-000000000007'::uuid),
     ( 8, '00000000-0000-4000-8000-000000000008'::uuid),
     ( 9, '00000000-0000-4000-8000-000000000009'::uuid),
     (10, '00000000-0000-4000-8000-000000000010'::uuid),
     (11, '00000000-0000-4000-8000-000000000011'::uuid),
     (12, '00000000-0000-4000-8000-000000000012'::uuid),
     (13, '00000000-0000-4000-8000-000000000012'::uuid),
     (14, '00000000-0000-4000-8000-000000000011'::uuid),
     (15, '00000000-0000-4000-8000-000000000010'::uuid),
     (16, '00000000-0000-4000-8000-000000000009'::uuid),
     (17, '00000000-0000-4000-8000-000000000008'::uuid),
     (18, '00000000-0000-4000-8000-000000000007'::uuid),
     (19, '00000000-0000-4000-8000-000000000006'::uuid),
     (20, '00000000-0000-4000-8000-000000000005'::uuid),
     (21, '00000000-0000-4000-8000-000000000004'::uuid),
     (22, '00000000-0000-4000-8000-000000000003'::uuid),
     (23, '00000000-0000-4000-8000-000000000002'::uuid),
     (24, '00000000-0000-4000-8000-000000000001'::uuid),
     (25, '00000000-0000-4000-8000-000000000012'::uuid),
     (26, '00000000-0000-4000-8000-000000000011'::uuid),
     (27, '00000000-0000-4000-8000-000000000010'::uuid),
     (28, '00000000-0000-4000-8000-000000000009'::uuid),
     (29, '00000000-0000-4000-8000-000000000008'::uuid),
     (30, '00000000-0000-4000-8000-000000000007'::uuid),
     (31, '00000000-0000-4000-8000-000000000006'::uuid),
     (32, '00000000-0000-4000-8000-000000000005'::uuid),
     (33, '00000000-0000-4000-8000-000000000004'::uuid),
     (34, '00000000-0000-4000-8000-000000000003'::uuid),
     (35, '00000000-0000-4000-8000-000000000002'::uuid),
     (36, '00000000-0000-4000-8000-000000000001'::uuid),
     (37, '00000000-0000-4000-8000-000000000001'::uuid),
     (38, '00000000-0000-4000-8000-000000000002'::uuid),
     (39, '00000000-0000-4000-8000-000000000003'::uuid),
     (40, '00000000-0000-4000-8000-000000000004'::uuid),
     (41, '00000000-0000-4000-8000-000000000005'::uuid),
     (42, '00000000-0000-4000-8000-000000000006'::uuid),
     (43, '00000000-0000-4000-8000-000000000007'::uuid),
     (44, '00000000-0000-4000-8000-000000000008'::uuid),
     (45, '00000000-0000-4000-8000-000000000009'::uuid),
     (46, '00000000-0000-4000-8000-000000000010'::uuid),
     (47, '00000000-0000-4000-8000-000000000011'::uuid),
     (48, '00000000-0000-4000-8000-000000000012'::uuid) $$,
  '12-team 3RR: pick→team table rounds 1–4 (stored literal — fwd/rev/REV-flip/fwd)');

-- C3. Linear: the same order EVERY round (§8.3/§7.3.8).
select results_eq(
  $$ select p, public.draft_team_for_pick(
       '["00000000-0000-4000-8000-000000000001",
         "00000000-0000-4000-8000-000000000002",
         "00000000-0000-4000-8000-000000000003",
         "00000000-0000-4000-8000-000000000004",
         "00000000-0000-4000-8000-000000000005",
         "00000000-0000-4000-8000-000000000006",
         "00000000-0000-4000-8000-000000000007",
         "00000000-0000-4000-8000-000000000008"]'::jsonb,
       'linear', false, p)
     from generate_series(1, 32) p $$,
  $$ values
     ( 1, '00000000-0000-4000-8000-000000000001'::uuid),
     ( 2, '00000000-0000-4000-8000-000000000002'::uuid),
     ( 3, '00000000-0000-4000-8000-000000000003'::uuid),
     ( 4, '00000000-0000-4000-8000-000000000004'::uuid),
     ( 5, '00000000-0000-4000-8000-000000000005'::uuid),
     ( 6, '00000000-0000-4000-8000-000000000006'::uuid),
     ( 7, '00000000-0000-4000-8000-000000000007'::uuid),
     ( 8, '00000000-0000-4000-8000-000000000008'::uuid),
     ( 9, '00000000-0000-4000-8000-000000000001'::uuid),
     (10, '00000000-0000-4000-8000-000000000002'::uuid),
     (11, '00000000-0000-4000-8000-000000000003'::uuid),
     (12, '00000000-0000-4000-8000-000000000004'::uuid),
     (13, '00000000-0000-4000-8000-000000000005'::uuid),
     (14, '00000000-0000-4000-8000-000000000006'::uuid),
     (15, '00000000-0000-4000-8000-000000000007'::uuid),
     (16, '00000000-0000-4000-8000-000000000008'::uuid),
     (17, '00000000-0000-4000-8000-000000000001'::uuid),
     (18, '00000000-0000-4000-8000-000000000002'::uuid),
     (19, '00000000-0000-4000-8000-000000000003'::uuid),
     (20, '00000000-0000-4000-8000-000000000004'::uuid),
     (21, '00000000-0000-4000-8000-000000000005'::uuid),
     (22, '00000000-0000-4000-8000-000000000006'::uuid),
     (23, '00000000-0000-4000-8000-000000000007'::uuid),
     (24, '00000000-0000-4000-8000-000000000008'::uuid),
     (25, '00000000-0000-4000-8000-000000000001'::uuid),
     (26, '00000000-0000-4000-8000-000000000002'::uuid),
     (27, '00000000-0000-4000-8000-000000000003'::uuid),
     (28, '00000000-0000-4000-8000-000000000004'::uuid),
     (29, '00000000-0000-4000-8000-000000000005'::uuid),
     (30, '00000000-0000-4000-8000-000000000006'::uuid),
     (31, '00000000-0000-4000-8000-000000000007'::uuid),
     (32, '00000000-0000-4000-8000-000000000008'::uuid) $$,
  'linear 8-team: pick→team table rounds 1–4 (stored literal — same order every round)');

-- ---------------------------------------------------------------------------
-- D. Fixtures (postgres context — BEFORE any JWT claims; D49(7)).
--    Users u01–u12 + outsider u99. Leagues:
--      LA b2…a1 12-team 3RR drive (manual order t01..t12)
--      LB b2…a2  8-team no-reversal drive + capacity boundary (7 teams at
--                first; t08 arrives mid-test) + E1/E2/wrong-turn surface
--      LC b2…a3  8-team LINEAR drive + the D95 re-hydration pin (drafts row
--                pre-created with STALE config timer 90; live settings 120)
--      LD b2…a4  8-team completion + untimed (roster override → 2 rounds;
--                pick_timer_seconds 0)
--      LE b2…a5  the D43 order probe (scoring_system_id NULL, snapshot
--                NULL, NO drafts row)
--      LG b2…a6  'setup' league (draft_create pins; start refusal)
--      LH b2…a7  auction league, ZERO franchises (M3 seam refusal — the
--                draft_make_pick one ONLY; its start refusal flipped at
--                084 and moved to LM, which is seated. LH is deliberately
--                unchanged so 085 can reword the pick refusal in place)
--      LI b2…a8  manual mode with an INVALID stored order (dup + missing)
--      LJ b2…a9  random mode, NO drafts row (D94 no-dead-end + D101/D105
--                permutation pin)
--      LK b2…aa  random mode with a STALE settings-blob draft_order
--                leftover (a prior manual/custom episode's); drafts row
--                pre-created with a FIXED id so the seeded md5 shuffle is
--                a stored literal (R123)
--      LM b2…ab  084/L.C1.2: a SEATED 8-team AUCTION league (manual order,
--                45s nomination clock, pick_timer_seconds 0) — the league
--                the flipped M3 seam assertion now STARTS (R325: this map
--                was not extended when LM landed)
--    All 'scheduled' (privileged insert) except LG; scoring = the ESPN
--    Standard template except LE (NULL). scoring_rules_snapshot NULL
--    everywhere — the post-start NOT-NULL pin proves draft_start took it.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('90000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated',
  'pgtap-dc' || lpad(i::text, 2, '0') || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  jsonb_build_object('username', 'dc_user_' || lpad(i::text, 2, '0')),
  now(), now()
from generate_series(1, 12) i;
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000099',
   'authenticated', 'authenticated', 'pgtap-dc99@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "dc_outsider_99"}',
   now(), now());

insert into players (id, full_name, position)
select 'pgtap-dc-p' || lpad(i::text, 3, '0'),
       'PgTap DC Player ' || lpad(i::text, 3, '0'),
       'RB'
from generate_series(1, 48) i;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings) values
  ('b2000000-0000-4000-8000-0000000000a1', '90000000-0000-4000-8000-000000000001',
   'pgtap-dc-LA-3rr', 2026, 'scheduled', 12,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "snake", "snake_reversal": true, "draft_order_mode": "manual",
     "draft_order": ["c3000000-0000-4000-8000-00a100000001","c3000000-0000-4000-8000-00a100000002",
                     "c3000000-0000-4000-8000-00a100000003","c3000000-0000-4000-8000-00a100000004",
                     "c3000000-0000-4000-8000-00a100000005","c3000000-0000-4000-8000-00a100000006",
                     "c3000000-0000-4000-8000-00a100000007","c3000000-0000-4000-8000-00a100000008",
                     "c3000000-0000-4000-8000-00a100000009","c3000000-0000-4000-8000-00a100000010",
                     "c3000000-0000-4000-8000-00a100000011","c3000000-0000-4000-8000-00a100000012"],
     "pick_timer_seconds": 90, "draft_scheduled_at": "2026-09-01T17:00:00+00:00"}}'),
  ('b2000000-0000-4000-8000-0000000000a2', '90000000-0000-4000-8000-000000000001',
   'pgtap-dc-LB-snake', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "snake", "snake_reversal": false, "draft_order_mode": "manual",
     "draft_order": ["c3000000-0000-4000-8000-00a200000001","c3000000-0000-4000-8000-00a200000002",
                     "c3000000-0000-4000-8000-00a200000003","c3000000-0000-4000-8000-00a200000004",
                     "c3000000-0000-4000-8000-00a200000005","c3000000-0000-4000-8000-00a200000006",
                     "c3000000-0000-4000-8000-00a200000007","c3000000-0000-4000-8000-00a200000008"],
     "pick_timer_seconds": 90, "draft_scheduled_at": "2026-09-01T17:00:00+00:00"}}'),
  ('b2000000-0000-4000-8000-0000000000a3', '90000000-0000-4000-8000-000000000001',
   'pgtap-dc-LC-linear', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "linear", "snake_reversal": false, "draft_order_mode": "manual",
     "draft_order": ["c3000000-0000-4000-8000-00a300000001","c3000000-0000-4000-8000-00a300000002",
                     "c3000000-0000-4000-8000-00a300000003","c3000000-0000-4000-8000-00a300000004",
                     "c3000000-0000-4000-8000-00a300000005","c3000000-0000-4000-8000-00a300000006",
                     "c3000000-0000-4000-8000-00a300000007","c3000000-0000-4000-8000-00a300000008"],
     "pick_timer_seconds": 120, "draft_scheduled_at": "2026-09-01T17:00:00+00:00"}}'),
  ('b2000000-0000-4000-8000-0000000000a4', '90000000-0000-4000-8000-000000000001',
   'pgtap-dc-LD-untimed', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "snake", "snake_reversal": false, "draft_order_mode": "manual",
     "draft_order": ["c3000000-0000-4000-8000-00a400000001","c3000000-0000-4000-8000-00a400000002",
                     "c3000000-0000-4000-8000-00a400000003","c3000000-0000-4000-8000-00a400000004",
                     "c3000000-0000-4000-8000-00a400000005","c3000000-0000-4000-8000-00a400000006",
                     "c3000000-0000-4000-8000-00a400000007","c3000000-0000-4000-8000-00a400000008"],
     "pick_timer_seconds": 0, "draft_scheduled_at": "2026-09-01T17:00:00+00:00"}}'),
  ('b2000000-0000-4000-8000-0000000000a5', '90000000-0000-4000-8000-000000000001',
   'pgtap-dc-LE-nosnap', 2026, 'scheduled', 8, null,
   '{"draft": {"draft_order_mode": "random", "pick_timer_seconds": 90}}'),
  ('b2000000-0000-4000-8000-0000000000a6', '90000000-0000-4000-8000-000000000001',
   'pgtap-dc-LG-setup', 2026, 'setup', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{}'),
  ('b2000000-0000-4000-8000-0000000000a7', '90000000-0000-4000-8000-000000000001',
   'pgtap-dc-LH-auction', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "pick_timer_seconds": 90}}'),
  ('b2000000-0000-4000-8000-0000000000a8', '90000000-0000-4000-8000-000000000001',
   'pgtap-dc-LI-badorder', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "snake", "draft_order_mode": "manual",
     "draft_order": ["c3000000-0000-4000-8000-00a800000001","c3000000-0000-4000-8000-00a800000001",
                     "c3000000-0000-4000-8000-00a800000002","c3000000-0000-4000-8000-00a800000003",
                     "c3000000-0000-4000-8000-00a800000004","c3000000-0000-4000-8000-00a800000005",
                     "c3000000-0000-4000-8000-00a800000006","c3000000-0000-4000-8000-00a800000007"],
     "pick_timer_seconds": 90}}'),
  ('b2000000-0000-4000-8000-0000000000a9', '90000000-0000-4000-8000-000000000001',
   'pgtap-dc-LJ-random', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_order_mode": "random", "pick_timer_seconds": 90}}'),
  ('b2000000-0000-4000-8000-0000000000aa', '90000000-0000-4000-8000-000000000001',
   'pgtap-dc-LK-stalecfg', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_order_mode": "random", "pick_timer_seconds": 90,
     "draft_order": ["c3000000-0000-4000-8000-00aa00000008","c3000000-0000-4000-8000-00aa00000007",
                     "c3000000-0000-4000-8000-00aa00000006","c3000000-0000-4000-8000-00aa00000005",
                     "c3000000-0000-4000-8000-00aa00000004","c3000000-0000-4000-8000-00aa00000003",
                     "c3000000-0000-4000-8000-00aa00000002","c3000000-0000-4000-8000-00aa00000001"]}}');

-- LM (084/L.C1.2): a SEATED auction league — the league the flipped
-- start-refusal assertion now STARTS. Manual draft order + the default
-- nomination_order_mode (same_as_draft_order) make the first nominator a
-- stored literal; pick_timer_seconds 0 with a 45s nomination clock pins
-- §7.3.8's "an untimed pick timer does not null an auction clock".
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings) values
  ('b2000000-0000-4000-8000-0000000000ab', '90000000-0000-4000-8000-000000000001',
   'pgtap-dc-LM-auction-seated', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "draft_order_mode": "manual",
     "draft_order": ["c3000000-0000-4000-8000-00ab00000001","c3000000-0000-4000-8000-00ab00000002",
                     "c3000000-0000-4000-8000-00ab00000003","c3000000-0000-4000-8000-00ab00000004",
                     "c3000000-0000-4000-8000-00ab00000005","c3000000-0000-4000-8000-00ab00000006",
                     "c3000000-0000-4000-8000-00ab00000007","c3000000-0000-4000-8000-00ab00000008"],
     "auction_budget": 200, "auction_zero_dollar_nominations": false, "auction_nomination_seconds": 45,
     "pick_timer_seconds": 0}}');

-- LD: roster override → exactly 2 draftable rounds (D91).
update leagues
set roster_settings = '{"starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 2}],
                       "bench": 0, "ir_slots": [], "swap_spots": 0}'
where id = 'b2000000-0000-4000-8000-0000000000a4';

-- Teams. LA t01..t12 · LB t01..t07 (t08 mid-test) · LC/LD/LE/LI/LJ t01..t08.
insert into teams (id, owner_id, name, league_id)
select ('c3000000-0000-4000-8000-00a1000000' || lpad(i::text, 2, '0'))::uuid,
       ('90000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'pgtap-dc-a1-t' || lpad(i::text, 2, '0'),
       'b2000000-0000-4000-8000-0000000000a1'
from generate_series(1, 12) i;
insert into teams (id, owner_id, name, league_id)
select ('c3000000-0000-4000-8000-00a2000000' || lpad(i::text, 2, '0'))::uuid,
       ('90000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'pgtap-dc-a2-t' || lpad(i::text, 2, '0'),
       'b2000000-0000-4000-8000-0000000000a2'
from generate_series(1, 7) i;
insert into teams (id, owner_id, name, league_id)
select ('c3000000-0000-4000-8000-00a3000000' || lpad(i::text, 2, '0'))::uuid,
       ('90000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'pgtap-dc-a3-t' || lpad(i::text, 2, '0'),
       'b2000000-0000-4000-8000-0000000000a3'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c3000000-0000-4000-8000-00a4000000' || lpad(i::text, 2, '0'))::uuid,
       ('90000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'pgtap-dc-a4-t' || lpad(i::text, 2, '0'),
       'b2000000-0000-4000-8000-0000000000a4'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c3000000-0000-4000-8000-00a5000000' || lpad(i::text, 2, '0'))::uuid,
       '90000000-0000-4000-8000-000000000001',
       'pgtap-dc-a5-t' || lpad(i::text, 2, '0'),
       'b2000000-0000-4000-8000-0000000000a5'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c3000000-0000-4000-8000-00a8000000' || lpad(i::text, 2, '0'))::uuid,
       '90000000-0000-4000-8000-000000000001',
       'pgtap-dc-a8-t' || lpad(i::text, 2, '0'),
       'b2000000-0000-4000-8000-0000000000a8'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c3000000-0000-4000-8000-00a9000000' || lpad(i::text, 2, '0'))::uuid,
       '90000000-0000-4000-8000-000000000001',
       'pgtap-dc-a9-t' || lpad(i::text, 2, '0'),
       'b2000000-0000-4000-8000-0000000000a9'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c3000000-0000-4000-8000-00aa000000' || lpad(i::text, 2, '0'))::uuid,
       '90000000-0000-4000-8000-000000000001',
       'pgtap-dc-aa-t' || lpad(i::text, 2, '0'),
       'b2000000-0000-4000-8000-0000000000aa'
from generate_series(1, 8) i;
-- LM (084/L.C1.2): the seated auction league's eight franchises.
insert into teams (id, owner_id, name, league_id)
select ('c3000000-0000-4000-8000-00ab000000' || lpad(i::text, 2, '0'))::uuid,
       '90000000-0000-4000-8000-000000000001',
       'pgtap-dc-ab-t' || lpad(i::text, 2, '0'),
       'b2000000-0000-4000-8000-0000000000ab'
from generate_series(1, 8) i;

-- Members (u01 commissioner everywhere; managers hold their seat's team).
insert into league_members (league_id, user_id, team_id, role)
select 'b2000000-0000-4000-8000-0000000000a1',
       ('90000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c3000000-0000-4000-8000-00a1000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 12) i;
insert into league_members (league_id, user_id, team_id, role)
select 'b2000000-0000-4000-8000-0000000000a2',
       ('90000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c3000000-0000-4000-8000-00a2000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 7) i;
insert into league_members (league_id, user_id, team_id, role)
select 'b2000000-0000-4000-8000-0000000000a3',
       ('90000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c3000000-0000-4000-8000-00a3000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 8) i;
insert into league_members (league_id, user_id, team_id, role)
select 'b2000000-0000-4000-8000-0000000000a4',
       ('90000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c3000000-0000-4000-8000-00a4000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 8) i;
insert into league_members (league_id, user_id, team_id, role) values
  ('b2000000-0000-4000-8000-0000000000a5', '90000000-0000-4000-8000-000000000001',
   'c3000000-0000-4000-8000-00a500000001', 'commissioner'),
  ('b2000000-0000-4000-8000-0000000000a6', '90000000-0000-4000-8000-000000000001',
   null, 'commissioner'),
  ('b2000000-0000-4000-8000-0000000000a7', '90000000-0000-4000-8000-000000000001',
   null, 'commissioner'),
  ('b2000000-0000-4000-8000-0000000000a8', '90000000-0000-4000-8000-000000000001',
   'c3000000-0000-4000-8000-00a800000001', 'commissioner'),
  ('b2000000-0000-4000-8000-0000000000a9', '90000000-0000-4000-8000-000000000001',
   'c3000000-0000-4000-8000-00a900000001', 'commissioner'),
  ('b2000000-0000-4000-8000-0000000000aa', '90000000-0000-4000-8000-000000000001',
   'c3000000-0000-4000-8000-00aa00000001', 'commissioner'),
  ('b2000000-0000-4000-8000-0000000000ab', '90000000-0000-4000-8000-000000000001',
   'c3000000-0000-4000-8000-00ab00000001', 'commissioner');

-- Pre-created drafts rows. LC's carries a STALE config (timer 90 vs the
-- live settings' 120) — the D95 re-hydration pin. LE/LJ deliberately have
-- NO row (create-if-absent probes). LK's exists ONLY to fix the draft id
-- (the md5 shuffle seed) so the R123 pin is a stored literal; its
-- draft_order is NULL — the stale order lives in the league SETTINGS blob.
insert into drafts (id, league_id, draft_type, status, is_mock, config) values
  ('e2000000-0000-4000-8000-0000000000a1', 'b2000000-0000-4000-8000-0000000000a1',
   'snake', 'scheduled', false, '{}'),
  ('e2000000-0000-4000-8000-0000000000a2', 'b2000000-0000-4000-8000-0000000000a2',
   'snake', 'scheduled', false, '{}'),
  ('e2000000-0000-4000-8000-0000000000a3', 'b2000000-0000-4000-8000-0000000000a3',
   'linear', 'scheduled', false, '{"draft_type": "linear", "pick_timer_seconds": 90}'),
  ('e2000000-0000-4000-8000-0000000000a4', 'b2000000-0000-4000-8000-0000000000a4',
   'snake', 'scheduled', false, '{}'),
  ('e2000000-0000-4000-8000-0000000000aa', 'b2000000-0000-4000-8000-0000000000aa',
   'snake', 'scheduled', false, '{}');
-- LB carries a STALE stored nomination_order (084/L.C1.2, R324): 084's
-- shared drafts UPDATE writes `nomination_order` on BOTH paths — NULL on
-- snake/linear — so a snake start must CLEAR this, and an auction-arm
-- value leaking onto a snake start would fail the pin in §G. Nothing else
-- in this file reads the column.
update drafts
set nomination_order = '["c3000000-0000-4000-8000-00a200000008",
                         "c3000000-0000-4000-8000-00a200000001"]'::jsonb
where id = 'e2000000-0000-4000-8000-0000000000a2';

-- The pick-drive helper: authenticates as the on-clock seat's manager for
-- every pick (per-pick claims), calls the REAL RPC, and fails LOUDLY on any
-- unexpected board position. Runs privileged — draft_make_pick reads only
-- auth.uid(), so the path under test is the wire path.
create function pg_temp.dc_drive(p_draft_id uuid, p_from int, p_to int) returns void
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
      raise exception 'dc_drive: expected pick % on the clock, found %', v_i, v_d.current_pick_number;
    end if;
    select m.user_id into v_uid from public.league_members m
    where m.league_id = v_d.league_id and m.team_id = v_d.on_clock_team_id;
    if v_uid is null then
      raise exception 'dc_drive: no manager for on-clock team % at pick %', v_d.on_clock_team_id, v_i;
    end if;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    perform public.draft_make_pick(p_draft_id,
      'pgtap-dc-p' || lpad(v_i::text, 3, '0'), gen_random_uuid());
  end loop;
  perform set_config('request.jwt.claims', '', true);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- E. draft_create (JWT claims from here on; privileged pins via reset role)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

select throws_ok(
  $$ select public.draft_create('b2000000-0000-4000-8000-0000000000a6') $$,
  '42501', 'draft_create: not a commissioner of this league',
  'non-member draft_create → 42501 (u02 is not in LG)');

select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000099", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_create('b2000000-0000-4000-8000-0000000000a1') $$,
  '42501', 'draft_create: not a commissioner of this league',
  'outsider draft_create on LA → 42501');
select throws_ok(
  $$ select public.draft_create('99999999-0000-4000-8000-000000000000') $$,
  '42501', 'draft_create: not a commissioner of this league',
  'nonexistent league draft_create → the SAME 42501 (no existence leak)');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok(
  $$ select public.draft_create('b2000000-0000-4000-8000-0000000000a1') $$,
  '42501', null,
  'anon draft_create → 42501 (EXECUTE revoked)');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select is(
  (public.draft_create('b2000000-0000-4000-8000-0000000000a6')->>'created')::boolean,
  true,
  'commish draft_create on LG (setup) → created (a draft may be created pre-schedule, D95)');
select is(
  (select count(*) from drafts where league_id = 'b2000000-0000-4000-8000-0000000000a6'),
  1::bigint,
  'exactly one LG draft row exists');
select is(
  (select total_rounds from drafts where league_id = 'b2000000-0000-4000-8000-0000000000a6'),
  15,
  'LG draft total_rounds hydrated at create = 15 (default roster, D91)');
select is(
  (public.draft_create('b2000000-0000-4000-8000-0000000000a6')->>'created')::boolean,
  false,
  'replayed draft_create → created=false (idempotent vs the D95 partial unique)');
select is(
  (select count(*) from drafts where league_id = 'b2000000-0000-4000-8000-0000000000a6'),
  1::bigint,
  'replay inserted nothing — still one LG draft row');

-- ---------------------------------------------------------------------------
-- F. draft_start refusals (still u01, the commissioner everywhere)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.draft_start('b2000000-0000-4000-8000-0000000000a6') $$,
  'P0001',
  'draft_start: league b2000000-0000-4000-8000-0000000000a6 is in setup — schedule the draft first (League settings → Draft setup), then start it',
  'start on a setup league → friendly refusal (schedule first)');
-- THE M3 SEAM, FLIPPED (084/L.C1.2): what stood here was the auction
-- start-refusal ("the auction engine lands in M3" — 066:640–644). §8.6's
-- engine has landed, so the assertion is now the positive: an auction
-- league STARTS through the same commissioner wrapper a snake league does.
-- The exhaustive auction matrix (derivation goldens, all three
-- nomination_order modes, solvency both ways) is pgTAP 033's; this is the
-- WRAPPER-path pin the flip owes.
select is(
  (public.draft_start('b2000000-0000-4000-8000-0000000000ab')->>'started')::boolean,
  true,
  'auction start SUCCEEDS through the commissioner wrapper (the M3 seam refusal is gone — migration 084)');
select is(
  (select status || '|' || draft_type from drafts
   where league_id = 'b2000000-0000-4000-8000-0000000000ab'),
  'live|auction',
  '…the draft is live and typed auction');
select ok(
  (select current_nomination is null from drafts
   where league_id = 'b2000000-0000-4000-8000-0000000000ab'),
  '…and opens in the NOMINATING phase (D126: current_nomination NULL is the phase)');
select is(
  (select on_clock_team_id from drafts
   where league_id = 'b2000000-0000-4000-8000-0000000000ab'),
  'c3000000-0000-4000-8000-00ab00000001'::uuid,
  '…on the clock is nomination_order[0] — the first NOMINATOR (nomination_order_mode defaults to same_as_draft_order)');
select is(
  (select current_deadline from drafts
   where league_id = 'b2000000-0000-4000-8000-0000000000ab'),
  now() + interval '45 seconds',
  '…with a nomination deadline of auction_nomination_seconds, set even though pick_timer_seconds = 0 (§7.3.8: an auction is never untimed)');
select throws_ok(
  $$ select public.draft_start('b2000000-0000-4000-8000-0000000000a8') $$,
  'P0001',
  'draft_start: league b2000000-0000-4000-8000-0000000000a8 has draft_order_mode=manual but the stored draft order does not cover every active franchise exactly once — re-save the order in Draft setup (§8.3)',
  'manual mode with a duplicate/missing team in the stored order → friendly refusal');

-- The D43 order probe (b): a league that CANNOT snapshot fails LOUDLY
-- before any transition (059's message, fixed league id).
select throws_ok(
  $$ select public.draft_start('b2000000-0000-4000-8000-0000000000a5') $$,
  'P0001',
  'snapshot_league_scoring: league b2000000-0000-4000-8000-0000000000a5 has no scoring_system_id — nothing to snapshot (§7.3.8: exactly one scoring system referenced)',
  'D43 order probe: draft_start on an unsnapshottable league raises 059''s LOUD error');
select is(
  (select status from leagues where id = 'b2000000-0000-4000-8000-0000000000a5'),
  'scheduled',
  'the failed start left LE in scheduled — no partial transition');
select is(
  (select count(*) from drafts where league_id = 'b2000000-0000-4000-8000-0000000000a5'),
  0::bigint,
  'the failed start rolled back its create-if-absent draft row — no orphan state');

-- The D43 order probe (c): the 059 backstop trigger shown live.
reset role;
select throws_ok(
  $$ update leagues set status = 'drafting'
     where id = 'b2000000-0000-4000-8000-0000000000a5' $$,
  'P0001', null,
  'forced privileged flip to drafting with a NULL snapshot → the D43 guard trigger raises (the backstop)');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_start('b2000000-0000-4000-8000-0000000000a2') $$,
  '42501', 'draft_start: not a commissioner of this league',
  'non-commish draft_start → 42501 (u02 is a manager in LB)');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok(
  $$ select public.draft_start('b2000000-0000-4000-8000-0000000000a2') $$,
  '42501', null,
  'anon draft_start → 42501 (EXECUTE revoked)');
reset role;

-- ---------------------------------------------------------------------------
-- G. Capacity boundary (D96) + the LB start pins
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_start('b2000000-0000-4000-8000-0000000000a2') $$,
  'P0001',
  'draft_start: league b2000000-0000-4000-8000-0000000000a2 has 7 of 8 franchises seated — every seat must exist before the draft starts; add placeholder seats for the empty slots (League home → Invite) or invite managers (§7.2/D96)',
  'capacity boundary: team_count−1 franchises → friendly refusal naming placeholder seats (D96)');

-- The 8th franchise arrives (privileged), then == team_count succeeds.
reset role;
insert into teams (id, owner_id, name, league_id) values
  ('c3000000-0000-4000-8000-00a200000008', '90000000-0000-4000-8000-000000000008',
   'pgtap-dc-a2-t08', 'b2000000-0000-4000-8000-0000000000a2');
insert into league_members (league_id, user_id, team_id, role) values
  ('b2000000-0000-4000-8000-0000000000a2', '90000000-0000-4000-8000-000000000008',
   'c3000000-0000-4000-8000-00a200000008', 'manager');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (public.draft_start('b2000000-0000-4000-8000-0000000000a2')->>'started')::boolean,
  true,
  'capacity boundary: == team_count franchises → start succeeds');
select is(
  (select status from leagues where id = 'b2000000-0000-4000-8000-0000000000a2'),
  'drafting',
  'LB league transitioned to drafting (draft_start''s own path — set_league_status untouched)');
select ok(
  (select scoring_rules_snapshot from leagues
   where id = 'b2000000-0000-4000-8000-0000000000a2') is not null,
  'D43 order probe (a): the snapshot is non-NULL after start — draft_start snapshotted BEFORE transitioning');
select is(
  (select status || '|' || current_pick_number::text || '|' || current_round::text
          || '|' || on_clock_team_id::text
   from drafts where id = 'e2000000-0000-4000-8000-0000000000a2'),
  'live|1|1|c3000000-0000-4000-8000-00a200000001',
  'LB draft live at pick 1, round 1, order[1] on the clock');
select is(
  (select current_deadline from drafts where id = 'e2000000-0000-4000-8000-0000000000a2'),
  now() + interval '90 seconds',
  'pick-1 deadline = now() + pick_timer_seconds (90s, txn-frozen now)');
select is(
  (select draft_order from drafts where id = 'e2000000-0000-4000-8000-0000000000a2'),
  '["c3000000-0000-4000-8000-00a200000001","c3000000-0000-4000-8000-00a200000002",
    "c3000000-0000-4000-8000-00a200000003","c3000000-0000-4000-8000-00a200000004",
    "c3000000-0000-4000-8000-00a200000005","c3000000-0000-4000-8000-00a200000006",
    "c3000000-0000-4000-8000-00a200000007","c3000000-0000-4000-8000-00a200000008"]'::jsonb,
  'LB draft_order = the stored manual order (validated permutation, written verbatim)');
select is(
  (select total_rounds from drafts where id = 'e2000000-0000-4000-8000-0000000000a2'),
  15,
  'LB total_rounds = 15 at start (default roster, D91)');
select ok(
  (select nomination_order is null from drafts where id = 'e2000000-0000-4000-8000-0000000000a2'),
  'LB (SNAKE) start writes nomination_order NULL and CLEARS the stale stored one — 084''s shared drafts UPDATE writes the column on both paths, so an auction-arm value leaking onto a snake start fails here (R324)');

-- ---------------------------------------------------------------------------
-- H. draft_make_pick: turn/E1/E2/shape/no-leak on the live LB draft
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_make_pick('e2000000-0000-4000-8000-0000000000a2',
       'pgtap-dc-p001', 'a4000000-0000-4000-8000-000000000099') $$,
  'P0001', 'draft_make_pick: it is not your turn — pgtap-dc-a2-t01 is on the clock',
  'wrong-turn refusal names the on-clock team (u02 at pick 1)');
select throws_ok(
  $$ select public.draft_make_pick('e2000000-0000-4000-8000-0000000000a2',
       'pgtap-dc-p001', null) $$,
  '22023', 'draft_make_pick: action_id is required — client picks are idempotent (§8.1/E2)',
  'NULL action_id → 22023 argument shape');
select throws_ok(
  $$ select public.draft_make_pick('e2000000-0000-4000-8000-0000000000a2',
       '', 'a4000000-0000-4000-8000-000000000098') $$,
  '22023', 'draft_make_pick: player_id is required',
  'empty player_id → 22023 argument shape');

select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000099", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_make_pick('e2000000-0000-4000-8000-0000000000a2',
       'pgtap-dc-p001', 'a4000000-0000-4000-8000-000000000097') $$,
  '42501', 'draft_make_pick: not a member of this draft''s league',
  'non-member pick → 42501');
select throws_ok(
  $$ select public.draft_make_pick('99999999-0000-4000-8000-000000000000',
       'pgtap-dc-p001', 'a4000000-0000-4000-8000-000000000096') $$,
  '42501', 'draft_make_pick: not a member of this draft''s league',
  'nonexistent draft id → the SAME 42501 (no existence leak)');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok(
  $$ select public.draft_make_pick('e2000000-0000-4000-8000-0000000000a2',
       'pgtap-dc-p001', 'a4000000-0000-4000-8000-000000000095') $$,
  '42501', null,
  'anon pick → 42501 (EXECUTE revoked)');
reset role;

-- Pick 1 (u01/t01 → p001).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select ok(
  public.draft_make_pick('e2000000-0000-4000-8000-0000000000a2',
    'pgtap-dc-p001', 'a4000000-0000-4000-8000-000000000001') is not null,
  'pick 1 lands (u01, the on-clock manager)');
select is(
  (select team_id::text || '|' || player_id || '|' || made_via || '|' || is_auto::text
          || '|' || picked_by::text
   from draft_picks where draft_id = 'e2000000-0000-4000-8000-0000000000a2' and pick_number = 1),
  'c3000000-0000-4000-8000-00a200000001|pgtap-dc-p001|manager|false|90000000-0000-4000-8000-000000000001',
  'pick-1 row: on-clock team, chosen player, made_via=manager, is_auto=false, picked_by=caller');
select is(
  (select current_pick_number::text || '|' || current_round::text || '|' || on_clock_team_id::text
   from drafts where id = 'e2000000-0000-4000-8000-0000000000a2'),
  '2|1|c3000000-0000-4000-8000-00a200000002',
  'advance: pick 2, round 1, order[2] on the clock (§8.1 step 4)');
select is(
  (select current_deadline from drafts where id = 'e2000000-0000-4000-8000-0000000000a2'),
  now() + interval '90 seconds',
  'the clock reset for pick 2');

-- The commissioner gets NO bypass on this RPC (L.B1.4's force path is the
-- commissioner vehicle): u01 tries again while t02 is on the clock.
select throws_ok(
  $$ select public.draft_make_pick('e2000000-0000-4000-8000-0000000000a2',
       'pgtap-dc-p002', 'a4000000-0000-4000-8000-000000000094') $$,
  'P0001', 'draft_make_pick: it is not your turn — pgtap-dc-a2-t02 is on the clock',
  'commissioner off the clock → the SAME wrong-turn refusal (no role bypass)');

-- E1 (single-session analogue) + unknown player, as u02 (now on the clock).
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_make_pick('e2000000-0000-4000-8000-0000000000a2',
       'pgtap-dc-p001', 'a4000000-0000-4000-8000-000000000093') $$,
  'P0001', 'draft_make_pick: PgTap DC Player 001 just went off the board — pick another player',
  'E1: the race loser''s friendly message, pinned verbatim (§8.1)');
select throws_ok(
  $$ select public.draft_make_pick('e2000000-0000-4000-8000-0000000000a2',
       'pgtap-dc-nope', 'a4000000-0000-4000-8000-000000000092') $$,
  'P0002', 'draft_make_pick: player pgtap-dc-nope not found',
  'unknown player → P0002');

-- E2: same action_id → no-op, byte-identical response.
select set_config('pgtap.dc_r1',
  public.draft_make_pick('e2000000-0000-4000-8000-0000000000a2',
    'pgtap-dc-p002', 'a4000000-0000-4000-8000-000000000002')::text,
  true);
select is(
  public.draft_make_pick('e2000000-0000-4000-8000-0000000000a2',
    'pgtap-dc-p002', 'a4000000-0000-4000-8000-000000000002')::text,
  current_setting('pgtap.dc_r1'),
  'E2: the replayed action_id returns the byte-identical response (no-op)');
select is(
  (select count(*) from draft_picks
   where draft_id = 'e2000000-0000-4000-8000-0000000000a2' and is_undone = false),
  2::bigint,
  'E2: the replay inserted nothing (still 2 live picks)');
select is(
  (select current_pick_number from drafts where id = 'e2000000-0000-4000-8000-0000000000a2'),
  3,
  'E2: the replay advanced nothing (still pick 3)');

-- ---------------------------------------------------------------------------
-- I. Idempotent re-start (the D63 class)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (public.draft_start('b2000000-0000-4000-8000-0000000000a2')->>'started')::boolean,
  false,
  'draft_start on an already-live draft → no-op (started=false, the D63 double-click rule)');
select is(
  (select current_pick_number from drafts where id = 'e2000000-0000-4000-8000-0000000000a2'),
  3,
  're-start reset nothing — the board is still at pick 3');

-- ---------------------------------------------------------------------------
-- J. Paused/mock/auction refusals + drive LB through round 4
-- ---------------------------------------------------------------------------
reset role;
update drafts set status = 'paused' where id = 'e2000000-0000-4000-8000-0000000000a2';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_make_pick('e2000000-0000-4000-8000-0000000000a2',
       'pgtap-dc-p003', 'a4000000-0000-4000-8000-000000000091') $$,
  'P0001', 'draft_make_pick: the draft is paused',
  'pick on a paused draft → friendly refusal');
reset role;
update drafts set status = 'live' where id = 'e2000000-0000-4000-8000-0000000000a2';

-- Mock branch (D103(2) — the L.B1.6 seam pin FLIPPED when 071 landed the
-- branch, as the 066 banner's cross-reference anticipated): a live mock
-- coexists (D95 exempts mocks). This fixture mock carries NO config.mock
-- (a privileged fixture shape — every RPC writer stamps it), so
-- launched_by is NULL and ANY human caller gets the solo-practice
-- refusal: the tick-only safe default. Both REAL sides of D103(2) — the
-- launcher picking their chosen seat, other members refused on a
-- config-carrying mock — are pinned in pgTAP 025.
insert into drafts (id, league_id, draft_type, status, is_mock) values
  ('e2000000-0000-4000-8000-0000000000ee', 'b2000000-0000-4000-8000-0000000000a2',
   'snake', 'live', true);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_make_pick('e2000000-0000-4000-8000-0000000000ee',
       'pgtap-dc-p003', 'a4000000-0000-4000-8000-000000000090') $$,
  'P0001', 'draft_make_pick: this mock draft is another member''s solo practice (§8.8/D103)',
  'D103(2): a member''s pick on a mock they did not launch (here: a config-less fixture mock — launched_by NULL) is refused');
reset role;

-- Auction seam: a live auction draft (LH — no other active draft there).
insert into drafts (id, league_id, draft_type, status, is_mock) values
  ('e2000000-0000-4000-8000-0000000000a7', 'b2000000-0000-4000-8000-0000000000a7',
   'auction', 'live', false);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_make_pick('e2000000-0000-4000-8000-0000000000a7',
       'pgtap-dc-p003', 'a4000000-0000-4000-8000-000000000089') $$,
  'P0001', 'draft_make_pick: this is an auction draft — auction drafts pick via nominate and bid',
  'pick on an auction draft → friendly refusal naming the auction verbs (085/L.C1.3 reworded it: the refusal is permanent, the milestone promise is gone)');
reset role;

-- Drive LB picks 3..32 through the REAL RPC, then pin the whole table.
select pg_temp.dc_drive('e2000000-0000-4000-8000-0000000000a2', 3, 32);
select results_eq(
  $$ select pick_number, team_id from draft_picks
     where draft_id = 'e2000000-0000-4000-8000-0000000000a2' and is_undone = false
     order by pick_number $$,
  $$ values
     ( 1, 'c3000000-0000-4000-8000-00a200000001'::uuid),
     ( 2, 'c3000000-0000-4000-8000-00a200000002'::uuid),
     ( 3, 'c3000000-0000-4000-8000-00a200000003'::uuid),
     ( 4, 'c3000000-0000-4000-8000-00a200000004'::uuid),
     ( 5, 'c3000000-0000-4000-8000-00a200000005'::uuid),
     ( 6, 'c3000000-0000-4000-8000-00a200000006'::uuid),
     ( 7, 'c3000000-0000-4000-8000-00a200000007'::uuid),
     ( 8, 'c3000000-0000-4000-8000-00a200000008'::uuid),
     ( 9, 'c3000000-0000-4000-8000-00a200000008'::uuid),
     (10, 'c3000000-0000-4000-8000-00a200000007'::uuid),
     (11, 'c3000000-0000-4000-8000-00a200000006'::uuid),
     (12, 'c3000000-0000-4000-8000-00a200000005'::uuid),
     (13, 'c3000000-0000-4000-8000-00a200000004'::uuid),
     (14, 'c3000000-0000-4000-8000-00a200000003'::uuid),
     (15, 'c3000000-0000-4000-8000-00a200000002'::uuid),
     (16, 'c3000000-0000-4000-8000-00a200000001'::uuid),
     (17, 'c3000000-0000-4000-8000-00a200000001'::uuid),
     (18, 'c3000000-0000-4000-8000-00a200000002'::uuid),
     (19, 'c3000000-0000-4000-8000-00a200000003'::uuid),
     (20, 'c3000000-0000-4000-8000-00a200000004'::uuid),
     (21, 'c3000000-0000-4000-8000-00a200000005'::uuid),
     (22, 'c3000000-0000-4000-8000-00a200000006'::uuid),
     (23, 'c3000000-0000-4000-8000-00a200000007'::uuid),
     (24, 'c3000000-0000-4000-8000-00a200000008'::uuid),
     (25, 'c3000000-0000-4000-8000-00a200000008'::uuid),
     (26, 'c3000000-0000-4000-8000-00a200000007'::uuid),
     (27, 'c3000000-0000-4000-8000-00a200000006'::uuid),
     (28, 'c3000000-0000-4000-8000-00a200000005'::uuid),
     (29, 'c3000000-0000-4000-8000-00a200000004'::uuid),
     (30, 'c3000000-0000-4000-8000-00a200000003'::uuid),
     (31, 'c3000000-0000-4000-8000-00a200000002'::uuid),
     (32, 'c3000000-0000-4000-8000-00a200000001'::uuid) $$,
  '8-team no-reversal DRIVEN table: 32 real picks land exactly on the stored literal (D90 — the RPC path, not just the helper)');
select is(
  (select current_pick_number::text || '|' || current_round::text || '|' || on_clock_team_id::text
   from drafts where id = 'e2000000-0000-4000-8000-0000000000a2'),
  '33|5|c3000000-0000-4000-8000-00a200000001',
  'after round 4 the board sits at pick 33, round 5, forward again (t01)');

-- ---------------------------------------------------------------------------
-- K. LA: the 12-team 3RR drive
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_make_pick('e2000000-0000-4000-8000-0000000000a1',
       'pgtap-dc-p001', 'a4000000-0000-4000-8000-000000000088') $$,
  'P0001', 'draft_make_pick: the draft has not started yet',
  'pick on a scheduled draft → friendly refusal');
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (public.draft_start('b2000000-0000-4000-8000-0000000000a1')->>'started')::boolean,
  true,
  'LA (12-team 3RR) starts');
reset role;
select pg_temp.dc_drive('e2000000-0000-4000-8000-0000000000a1', 1, 48);
select results_eq(
  $$ select pick_number, team_id from draft_picks
     where draft_id = 'e2000000-0000-4000-8000-0000000000a1' and is_undone = false
     order by pick_number $$,
  $$ values
     ( 1, 'c3000000-0000-4000-8000-00a100000001'::uuid),
     ( 2, 'c3000000-0000-4000-8000-00a100000002'::uuid),
     ( 3, 'c3000000-0000-4000-8000-00a100000003'::uuid),
     ( 4, 'c3000000-0000-4000-8000-00a100000004'::uuid),
     ( 5, 'c3000000-0000-4000-8000-00a100000005'::uuid),
     ( 6, 'c3000000-0000-4000-8000-00a100000006'::uuid),
     ( 7, 'c3000000-0000-4000-8000-00a100000007'::uuid),
     ( 8, 'c3000000-0000-4000-8000-00a100000008'::uuid),
     ( 9, 'c3000000-0000-4000-8000-00a100000009'::uuid),
     (10, 'c3000000-0000-4000-8000-00a100000010'::uuid),
     (11, 'c3000000-0000-4000-8000-00a100000011'::uuid),
     (12, 'c3000000-0000-4000-8000-00a100000012'::uuid),
     (13, 'c3000000-0000-4000-8000-00a100000012'::uuid),
     (14, 'c3000000-0000-4000-8000-00a100000011'::uuid),
     (15, 'c3000000-0000-4000-8000-00a100000010'::uuid),
     (16, 'c3000000-0000-4000-8000-00a100000009'::uuid),
     (17, 'c3000000-0000-4000-8000-00a100000008'::uuid),
     (18, 'c3000000-0000-4000-8000-00a100000007'::uuid),
     (19, 'c3000000-0000-4000-8000-00a100000006'::uuid),
     (20, 'c3000000-0000-4000-8000-00a100000005'::uuid),
     (21, 'c3000000-0000-4000-8000-00a100000004'::uuid),
     (22, 'c3000000-0000-4000-8000-00a100000003'::uuid),
     (23, 'c3000000-0000-4000-8000-00a100000002'::uuid),
     (24, 'c3000000-0000-4000-8000-00a100000001'::uuid),
     (25, 'c3000000-0000-4000-8000-00a100000012'::uuid),
     (26, 'c3000000-0000-4000-8000-00a100000011'::uuid),
     (27, 'c3000000-0000-4000-8000-00a100000010'::uuid),
     (28, 'c3000000-0000-4000-8000-00a100000009'::uuid),
     (29, 'c3000000-0000-4000-8000-00a100000008'::uuid),
     (30, 'c3000000-0000-4000-8000-00a100000007'::uuid),
     (31, 'c3000000-0000-4000-8000-00a100000006'::uuid),
     (32, 'c3000000-0000-4000-8000-00a100000005'::uuid),
     (33, 'c3000000-0000-4000-8000-00a100000004'::uuid),
     (34, 'c3000000-0000-4000-8000-00a100000003'::uuid),
     (35, 'c3000000-0000-4000-8000-00a100000002'::uuid),
     (36, 'c3000000-0000-4000-8000-00a100000001'::uuid),
     (37, 'c3000000-0000-4000-8000-00a100000001'::uuid),
     (38, 'c3000000-0000-4000-8000-00a100000002'::uuid),
     (39, 'c3000000-0000-4000-8000-00a100000003'::uuid),
     (40, 'c3000000-0000-4000-8000-00a100000004'::uuid),
     (41, 'c3000000-0000-4000-8000-00a100000005'::uuid),
     (42, 'c3000000-0000-4000-8000-00a100000006'::uuid),
     (43, 'c3000000-0000-4000-8000-00a100000007'::uuid),
     (44, 'c3000000-0000-4000-8000-00a100000008'::uuid),
     (45, 'c3000000-0000-4000-8000-00a100000009'::uuid),
     (46, 'c3000000-0000-4000-8000-00a100000010'::uuid),
     (47, 'c3000000-0000-4000-8000-00a100000011'::uuid),
     (48, 'c3000000-0000-4000-8000-00a100000012'::uuid) $$,
  '12-team 3RR DRIVEN table: 48 real picks — r1 fwd, r2 rev, r3 REV (the flip), r4 fwd (D90/§8.3)');
select is(
  (select current_pick_number::text || '|' || current_round::text || '|' || on_clock_team_id::text
   from drafts where id = 'e2000000-0000-4000-8000-0000000000a1'),
  '49|5|c3000000-0000-4000-8000-00a100000012',
  '3RR round 5 is reversed again — pick 49 belongs to t12');
select is(
  (select status from drafts where id = 'e2000000-0000-4000-8000-0000000000a1'),
  'live',
  'LA is still live after round 4 (total_rounds 15 — completion untouched)');

-- ---------------------------------------------------------------------------
-- L. LC: linear drive + the D95 re-hydration pin
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select ok(
  public.draft_start('b2000000-0000-4000-8000-0000000000a3') is not null,
  'LC (linear) starts');
select is(
  (select config->>'pick_timer_seconds' from drafts where id = 'e2000000-0000-4000-8000-0000000000a3'),
  '120',
  'D95 re-hydration: the STALE pre-created config (90) was replaced by the LIVE settings value (120) at start');
select is(
  (select current_deadline from drafts where id = 'e2000000-0000-4000-8000-0000000000a3'),
  now() + interval '120 seconds',
  'the pick-1 deadline uses the re-hydrated timer (120s)');
reset role;
select pg_temp.dc_drive('e2000000-0000-4000-8000-0000000000a3', 1, 16);
select results_eq(
  $$ select pick_number, team_id from draft_picks
     where draft_id = 'e2000000-0000-4000-8000-0000000000a3' and is_undone = false
     order by pick_number $$,
  $$ values
     ( 1, 'c3000000-0000-4000-8000-00a300000001'::uuid),
     ( 2, 'c3000000-0000-4000-8000-00a300000002'::uuid),
     ( 3, 'c3000000-0000-4000-8000-00a300000003'::uuid),
     ( 4, 'c3000000-0000-4000-8000-00a300000004'::uuid),
     ( 5, 'c3000000-0000-4000-8000-00a300000005'::uuid),
     ( 6, 'c3000000-0000-4000-8000-00a300000006'::uuid),
     ( 7, 'c3000000-0000-4000-8000-00a300000007'::uuid),
     ( 8, 'c3000000-0000-4000-8000-00a300000008'::uuid),
     ( 9, 'c3000000-0000-4000-8000-00a300000001'::uuid),
     (10, 'c3000000-0000-4000-8000-00a300000002'::uuid),
     (11, 'c3000000-0000-4000-8000-00a300000003'::uuid),
     (12, 'c3000000-0000-4000-8000-00a300000004'::uuid),
     (13, 'c3000000-0000-4000-8000-00a300000005'::uuid),
     (14, 'c3000000-0000-4000-8000-00a300000006'::uuid),
     (15, 'c3000000-0000-4000-8000-00a300000007'::uuid),
     (16, 'c3000000-0000-4000-8000-00a300000008'::uuid) $$,
  'linear DRIVEN table: rounds 1–2 repeat the same order (D90 — the RPC path)');

-- ---------------------------------------------------------------------------
-- M. LD: untimed (§8.2 soft timer) + completion
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select ok(
  public.draft_start('b2000000-0000-4000-8000-0000000000a4') is not null,
  'LD (untimed, 2-round) starts');
select ok(
  (select current_deadline from drafts
   where id = 'e2000000-0000-4000-8000-0000000000a4') is null,
  'untimed: pick_timer_seconds 0 → NULL deadline at start (§8.2 — the clock is informational only)');
select is(
  (select total_rounds from drafts where id = 'e2000000-0000-4000-8000-0000000000a4'),
  2,
  'LD total_rounds = 2 (roster override: 2 starters + 0 bench, D91)');
reset role;
select pg_temp.dc_drive('e2000000-0000-4000-8000-0000000000a4', 1, 1);
select ok(
  (select current_deadline from drafts
   where id = 'e2000000-0000-4000-8000-0000000000a4') is null,
  'untimed: the deadline stays NULL after a pick too');
select pg_temp.dc_drive('e2000000-0000-4000-8000-0000000000a4', 2, 16);
select is(
  (select status || '|' || coalesce(on_clock_team_id::text, 'NULL')
          || '|' || coalesce(current_deadline::text, 'NULL')
   from drafts where id = 'e2000000-0000-4000-8000-0000000000a4'),
  'complete|NULL|NULL',
  'completion: all total_rounds × team_count (16) live picks → complete, clock cleared, nobody on the clock');
select is(
  (select completed_at from drafts where id = 'e2000000-0000-4000-8000-0000000000a4'),
  now(),
  'completed_at stamped (txn-frozen now)');
select is(
  (select count(*) from draft_picks
   where draft_id = 'e2000000-0000-4000-8000-0000000000a4' and is_undone = false),
  16::bigint,
  'the completed board holds exactly 16 live picks');
select is(
  (select status from leagues where id = 'b2000000-0000-4000-8000-0000000000a4'),
  'in_season',
  'the league moves to in_season at completion (§8.5 step 6 — the 072/L.B1.7 completion arm; this pin held ''drafting'' until 072 flipped it as promised)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_make_pick('e2000000-0000-4000-8000-0000000000a4',
       'pgtap-dc-p017', 'a4000000-0000-4000-8000-000000000087') $$,
  'P0001', 'draft_make_pick: the draft is complete',
  'pick 17 on a complete draft → friendly refusal');

-- ---------------------------------------------------------------------------
-- N. LJ: D94 no-dead-end (no drafts row) + D101/D105 random order
-- ---------------------------------------------------------------------------
reset role;
select is(
  (select count(*) from drafts where league_id = 'b2000000-0000-4000-8000-0000000000a9'),
  0::bigint,
  'LJ has NO drafts row before start (scheduled through settings alone)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (public.draft_start('b2000000-0000-4000-8000-0000000000a9')->>'started')::boolean,
  true,
  'D94 no-dead-end (manual path): draft_start creates the missing row and starts it in one call');
select ok(
  (select jsonb_array_length(d.draft_order) = 8
      and (select count(distinct e.val)
           from jsonb_array_elements_text(d.draft_order) e(val)) = 8
      and not exists (
            select 1 from jsonb_array_elements_text(d.draft_order) e(val)
            where e.val not in (select t.id::text from teams t
                                where t.league_id = 'b2000000-0000-4000-8000-0000000000a9'))
   from drafts d
   where d.league_id = 'b2000000-0000-4000-8000-0000000000a9' and d.status = 'live'),
  'random order (D101/D105): the generated draft_order is a permutation of the 8 active team ids');

-- ---------------------------------------------------------------------------
-- O. LK: R123 — random mode ignores the settings-blob draft_order.
--    The league settings carry a STALE draft_order leftover (the reversed
--    t08..t01 array — what a prior manual/custom episode leaves behind and
--    the settings PATCH stores); the drafts row was pre-created with the
--    FIXED id e2…aa so the seeded md5(draft_id||team_id) shuffle is a
--    stored literal. Under the pre-R123 code the reversed array started
--    VERBATIM; under the fix it is ignored.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select ok(
  public.draft_start('b2000000-0000-4000-8000-0000000000aa') is not null,
  'LK (random mode + a stale settings-blob draft_order) starts');
select is(
  (select draft_order from drafts where id = 'e2000000-0000-4000-8000-0000000000aa'),
  '["c3000000-0000-4000-8000-00aa00000005", "c3000000-0000-4000-8000-00aa00000004",
    "c3000000-0000-4000-8000-00aa00000001", "c3000000-0000-4000-8000-00aa00000003",
    "c3000000-0000-4000-8000-00aa00000007", "c3000000-0000-4000-8000-00aa00000002",
    "c3000000-0000-4000-8000-00aa00000008", "c3000000-0000-4000-8000-00aa00000006"]'::jsonb,
  'R123: random mode ignores the settings-blob draft_order — the started order is the seeded md5(draft_id||team_id) shuffle (stored literal; seed = the fixed draft id)');
select isnt(
  (select draft_order from drafts where id = 'e2000000-0000-4000-8000-0000000000aa'),
  '["c3000000-0000-4000-8000-00aa00000008", "c3000000-0000-4000-8000-00aa00000007",
    "c3000000-0000-4000-8000-00aa00000006", "c3000000-0000-4000-8000-00aa00000005",
    "c3000000-0000-4000-8000-00aa00000004", "c3000000-0000-4000-8000-00aa00000003",
    "c3000000-0000-4000-8000-00aa00000002", "c3000000-0000-4000-8000-00aa00000001"]'::jsonb,
  'R123: the started order is NOT the stale config array (restoring the config fallback under random flips this pin RED — the batch-2 break probe)');

select * from finish();
rollback;
