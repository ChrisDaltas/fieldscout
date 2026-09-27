-- ============================================================================
-- The played-round refusal's WARNING quieted to a NOTICE — pgTAP 088
-- (task L.E1.23; migration 140; spec §11.5 R839; PROGRESS F377 (ruled
-- 2026-09-27: (a) "bracket stands as played", (b) "re-pairing by hand is
-- fine"), D370, D371(6), D377; tasks-M6A §6 L.E1.23 and §4 rules 11-15).
--
-- Numbering: pgTAP head measured `087_autopilot_switch.sql` by
-- `ls supabase/tests/ | tail -1` at task time ⇒ 088.
--
-- WHAT THIS SUITE PROVES — a FORM pin, because the change is one line of
-- one function's source and a NOTICE cannot be captured from SQL:
--   A1-A2  posture unchanged (one overload; PLAIN, `search_path=''`, no
--          EXECUTE for PUBLIC / anon / authenticated).
--   A3     ***BREAK PROBE's TARGET***: the function carries NO `RAISE
--          WARNING` anywhere (the R839 arm was its only one — 134:822-1230
--          grepped).
--   A4     the corrected copy is carried, ONCE, at NOTICE level.
--   A5     the promise the ruling rules out ("until a commissioner acts
--          (M6 §10) or the round finalizes") is gone from the MESSAGE. (The
--          R839 comment above the arm keeps its 118-era wording — 140's
--          banner says why; its text differs: "(M6 §10: a row …".)
--   A6     ***ONE LINE AND NOTHING ELSE***: the post-140 body with the one
--          new line swapped back for 134's line hashes to the PRE-140 md5
--          measured on the local chain 001-139 (a stored literal). So every
--          other byte — the RETURN document `rebuild_refused_round_played`
--          and all its fields, the stand-down, the DELETE — is 134's.
--   A7     the post-140 body's own md5 (stored literal), so a later edit
--          is a visible re-pin, never a silent drift.
-- The return document's BEHAVIOUR is proven, unmodified, by pgTAP 066 L6e /
-- L6f (the refusal fires, by name, idempotently) and 082 A6 (the prosrc
-- still carries the refusal and the stand-down). Neither file is edited.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(8);

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'playoff_bracket_sync_internal'), 1,
  'A1 playoff_bracket_sync_internal has exactly one overload');
select ok(
  (select not p.prosecdef and p.proconfig = array['search_path=""']
   from pg_proc p where p.proname = 'playoff_bracket_sync_internal'),
  'A2a …PLAIN (not DEFINER) with search_path pinned empty, as 134 left it');
select ok(
  not has_function_privilege('authenticated', 'public.playoff_bracket_sync_internal(uuid,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.playoff_bracket_sync_internal(uuid,timestamptz)', 'EXECUTE'),
  'A2b …no EXECUTE for anon or authenticated (the jobs are its only callers)');

select is(
  (select prosrc like '%RAISE WARNING%' from pg_proc where proname = 'playoff_bracket_sync_internal'),
  false,
  'A3 the sync raises NO WARNING anywhere — the played-round refusal (R839) no longer writes an hourly WARNING to the server log (F377, D371(6))');

select is(
  (select (length(prosrc) - length(replace(prosrc,
     'RAISE NOTICE ''playoff_bracket_sync_internal: league % round % is HISTORY (rolled %, % scored rows) but the prior stage''''s verdict now says % (stored %) — the rewrite is REFUSED; the bracket stands as played (F377(a), ruled 2026-09-27)''',
     ''))) / length(
     'RAISE NOTICE ''playoff_bracket_sync_internal: league % round % is HISTORY (rolled %, % scored rows) but the prior stage''''s verdict now says % (stored %) — the rewrite is REFUSED; the bracket stands as played (F377(a), ruled 2026-09-27)''')
   from pg_proc where proname = 'playoff_bracket_sync_internal'),
  1,
  'A4 the refusal is a NOTICE carrying the corrected copy — "stands as played (F377(a), ruled 2026-09-27)" — exactly once');

select is(
  (select prosrc like '%until a commissioner acts (M6 §10) or the round finalizes%' from pg_proc where proname = 'playoff_bracket_sync_internal'),
  false,
  'A5 the message no longer promises "until a commissioner acts (M6 §10)" — an act ruled out by F377(a)');

select is(
  (select md5(replace(prosrc,
     'RAISE NOTICE ''playoff_bracket_sync_internal: league % round % is HISTORY (rolled %, % scored rows) but the prior stage''''s verdict now says % (stored %) — the rewrite is REFUSED; the bracket stands as played (F377(a), ruled 2026-09-27)''',
     'RAISE WARNING ''playoff_bracket_sync_internal: league % round % is HISTORY (rolled %, % scored rows) but the prior stage''''s verdict now says % (stored %) — the rewrite is REFUSED; the bracket stands as played until a commissioner acts (M6 §10) or the round finalizes'''))
   from pg_proc where proname = 'playoff_bracket_sync_internal'),
  '78ff08b46ff8004e8a7a1127f70726a6',
  'A6 ONE LINE AND NOTHING ELSE: with that one line swapped back, the body is BYTE-IDENTICAL to its pre-140 self (stored md5 literal, local chain 001-139) — the RETURN document rebuild_refused_round_played and every field of it are 134''s');

select is(
  (select md5(prosrc) from pg_proc where proname = 'playoff_bracket_sync_internal'),
  '6ea667003195c7b2d45eb5e4e40ca9c4',
  'A7 the post-140 body, pinned (stored md5 literal) — a later edit re-pins here in the open');

select * from finish();
rollback;
