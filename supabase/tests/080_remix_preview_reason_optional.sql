-- ============================================================================
-- pgTAP 080 — migration 132: THE REMIX PREVIEW STOPS SAYING A REASON IS
-- REQUIRED (task L.E1.13 of M6A; PROGRESS F363(c) / F361's remainder / R1056;
-- Q66 — Chris, 2026-09-16; spec v2.16.41 §10 / §11.7 / E41).
--
-- WHAT THIS SUITE PROVES, and what it leaves to its neighbour:
--   §A  THE SOURCE SHAPE of the one replaced body,
--       `schedule_remix_plan_internal`: the field is the literal FALSE, the
--       old `NOT v_window.free` expression is GONE, and `window.free` — E41's
--       datum — is STILL reported from `v_window.free` (132 removed a
--       report of a gate that no longer exists; it did not touch the window).
--   §B  NOTHING CHANGED SHAPE: one overload; EXECUTE still revoked from
--       anon AND authenticated (it is an internal — `schedule_preview` is the
--       door); `schedule_window_internal` still carries no such field.
--
-- The BEHAVIOURAL proof — the preview answering `free = false,
-- reason_required = false` post-kickoff on a real league, beside the confirm
-- that lands with no reason — lives on 059's own fixture (its §F3 post-kickoff
-- block, re-cut in the same PR), the 079 posture.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(6);

-- ---------------------------------------------------------------------------
-- A. THE SOURCE SHAPE.
-- ---------------------------------------------------------------------------
select ok(
  (select p.prosrc like '%''reason_required'',  FALSE)%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'schedule_remix_plan_internal'),
  'A1 schedule_remix_plan_internal: window.reason_required is the literal FALSE (132 / Q66)');

select ok(
  (select p.prosrc not like '%NOT v_window.free%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'schedule_remix_plan_internal'),
  'A2 …and the old expression `NOT v_window.free` is GONE from the body — the preview can no longer disagree with 131''s confirm (R1056)');

select ok(
  (select p.prosrc like '%''free'',             v_window.free,%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'schedule_remix_plan_internal'),
  'A3 …while window.free is STILL E41''s datum, read from schedule_window_internal — 132 did not touch the window');

-- ---------------------------------------------------------------------------
-- B. NOTHING CHANGED SHAPE.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'schedule_remix_plan_internal'),
  1, 'B1 schedule_remix_plan_internal is still ONE overload (CREATE OR REPLACE on the same signature — typegen is a 0-line diff)');

select ok(
  not has_function_privilege('anon', 'public.schedule_remix_plan_internal(uuid,bigint,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.schedule_remix_plan_internal(uuid,bigint,timestamptz)', 'EXECUTE'),
  'B2 …and still an INTERNAL: EXECUTE revoked from anon and authenticated (schedule_preview is the door)');

select ok(
  (select p.prosrc not like '%reason_required%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'schedule_window_internal'),
  'B3 schedule_window_internal never carried the field — F363(c)''s "111:508" is a line of the PLAN function, which is the body 132 replaced');

select * from finish();
rollback;
