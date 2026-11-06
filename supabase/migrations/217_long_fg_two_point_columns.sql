-- ============================================================================
-- 217 — player_stats columns for the 60+ yard field goal and the D/ST
--       two-point return (PROGRESS F871, D834; F870 / F871 design, PR 3;
--       spec §23.5, v2.16.114). COLUMNS ONLY: no application code reads or
--       writes them until PR 4 (migration 218).
-- ============================================================================
--
-- THE RULINGS (Chris, verbatim, in the owner's session):
--   2026-11-05, on the questions asked 2026-11-04 (PROGRESS F870, F871):
--     "go on league kickers and the other plays"
--   2026-11-06, told that the next piece is "the extra point for a 60+ yard
--   field goal and a D/ST two-point return ... two database updates":
--     "Okay, go do it."
--   This file is the first of those two database updates.
--
-- WHAT. Two additive box-score columns, the shape of 057's eleven
-- (057:95-129): INTEGER DEFAULT 0, nullable, a COMMENT each.
--   fg_60_plus      FG made, 60+ yards (Sleeper `fgm_60p`). A TOP-UP count:
--                   `fg_made_50_plus` stays inclusive of 60+ (on the saved
--                   feed `fgm_50p` = `fgm_50_59 + fgm_60p` on 954 of 954
--                   kicker lines), so a rules document that names the new key
--                   pays it ON TOP of its 50+ value, and a document that does
--                   not name it pays a 60-yarder exactly what it pays today.
--   def_2pt_return  D/ST two-point return: the defense returns a two-point
--                   try for 2 (Sleeper `def_2pt`).
-- Existing rows read 0 at once: a constant DEFAULT is stored in the catalog
-- (Postgres 11+), so there is no table rewrite and no backfill. The ALTER
-- holds ACCESS EXCLUSIVE on player_stats only for the catalog change.
--
-- WHY (F871). ESPN's defaults pay a 60+ yard field goal 6 (one more than 50+)
-- and a D/ST two-point return 2. Spec Q9 (v2.8.5) made both named parity
-- exceptions because no feed signal was known; the feed does send both
-- (`fgm_60p`, `def_2pt`, F871 / F10), so they get a stored count each. Which
-- rules documents pay them, and from which week, is migration 218 (PR 4),
-- not this file.
--
-- WHY A COLUMN, NOT `advanced` — a named exception to spec §23.5, as F390's
-- was. §23.5 puts every future stat in `player_stats.advanced`, where a
-- missing key means "not yet reported" and scores PENDING, and an advanced
-- key applies to every position. Sleeper omits a zero-valued stat, so
-- nearly every kicker and D/ST line would carry no such key: the starter,
-- and their team, would read pending every week. As a column, absent reads 0,
-- like the other box-score counts (057's eleven).
--
-- PUSH ORDER (merge, deploy, push — every step keeps the running app working):
--   1. Merge this file (no code reads the columns; the app runs unchanged).
--   2. Chris pushes 217. Confirm the columns on production THROUGH PostgREST
--      (a `select=fg_60_plus,def_2pt_return` on player_stats), not only SQL.
--   3. Only then may PR 4 merge: it spreads these columns into about ten
--      readers through `STAT_LINE_COLUMNS` / `PRESET_LINE_COLUMNS` (the
--      scoring worker, box scores, reconcile, the ingest's `readStats`, the
--      stats pages). On a schema without them those reads fail, and the
--      ingest door (167) refuses any batch that names them (22023, "carries
--      key(s) the door does not write"): scoring and stats pages together.
--   4. Merge PR 4, confirm the deployed SHA, then push 218, so the deployed
--      rules validator accepts the two keys before 218 adds them to any live
--      week's rules (R1794(b)).
--   db-drift.yml reads red from step 1 to step 2: expected.
--
-- CHECKLIST. RLS on player_stats unchanged (005's public SELECT covers the
-- columns); no GRANT (037's default ACLs; the table-level privileges cover
-- new columns, as 057:85 says); no function, trigger, policy, index, DEFINER
-- or realtime change. The ingest door (167, ingest_write_batch) checks each
-- key it is sent against pg_attribute and writes exactly the columns sent,
-- so it writes these once PR 4 sends them, with no body change. pgTAP 011
-- (the exact column set) and 170 (this file; PR 4 extends it for 218).
-- R6 waiver: no staging clone; rehearsal = a fresh local `db reset` over
-- 001-217, `migration up` from 216 over a stored line, and the full pgTAP run
-- (PROGRESS D834).
-- ============================================================================

ALTER TABLE public.player_stats
  ADD COLUMN fg_60_plus INTEGER DEFAULT 0,
  ADD COLUMN def_2pt_return INTEGER DEFAULT 0;

COMMENT ON COLUMN public.player_stats.fg_60_plus IS
  'FG made, 60+ yards (canonical fg_60_plus, migration 217, F871; Sleeper fgm_60p). Counted ALSO in fg_made_50_plus, which stays inclusive: a rules document pays fg_60_plus on top of fg_50_plus. Not read by the app until migration 218 (PR 4).';
COMMENT ON COLUMN public.player_stats.def_2pt_return IS
  'D/ST two-point return (canonical def_2pt_return, migration 217, F871; Sleeper def_2pt). Not read by the app until migration 218 (PR 4).';
