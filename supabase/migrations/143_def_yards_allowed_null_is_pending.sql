-- ============================================================================
-- 143_def_yards_allowed_null_is_pending.sql — yards allowed: NULL means "not
-- delivered", never 0 (M6A task L.E1.26, added by ruling 2026-09-27; PROGRESS
-- F390 (RULED: "we need to get yards allowed"), F10, F386(a), D380; spec
-- v2.16.51 §23.5 note).
--
-- Numbering: RESERVED by the orchestrator — 143 / pgTAP 091. Measured at task
-- time: `ls supabase/migrations | tail -2` → 140, 142 on main (141 / pgTAP 089
-- are held by open PR #320 — L.E1.24), `ls supabase/tests | tail -1` → 090.
-- NOT held: the production hold is OVER (PR #282) — this reaches production by
-- `npx supabase db push` like any other migration (push debt 135–143).
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
-- 057 created `player_stats.def_yards_allowed INTEGER DEFAULT 0` and NOTHING
-- ever wrote it (no provider mapping until L.E1.26 — `git log -S` /
-- `grep -rn def_yards_allowed src scripts` find no writer). The scorer reads a
-- NULL/0 column as a DELIVERED 0 (D303(5)), `deriveTierIndicators` one-hots
-- 0 into `def_ya_0_99`, and every D/ST in a league scored with ESPN's or
-- Scout's yards-allowed table (four of the eight shipped templates) was paid
-- the "<100 yards" tier (+5) every week — R1119's measurement:
-- `scoreStarter(ESPN Standard, 'DST', {def_points_allowed:17, def_sacks:2})`
-- → 8 = 2 + 1 + 5, pending [].
--
-- L.E1.26 maps Sleeper's `yds_allow` into `def_yards_allowed` (the adapter
-- map, TS). That fixes every week whose line carries the stat. It does NOT fix
-- the week whose line LACKS it (a D/ST row early in a live game, measured
-- 2026-09-27 — 2026 wk3 ARI carried `gp` and return stats but no
-- `yds_allow`): with DEFAULT 0 that week would still read as "0 yards" and pay
-- +5. CLAUDE.md's "nothing happened ≠ it worked": absent must be PENDING. So:
--
-- ---------------------------------------------------------------------------
-- WHAT
-- ---------------------------------------------------------------------------
-- (1) DROP the column's DEFAULT. A writer that does not supply the value now
--     stores NULL ("not delivered"); the ingest (`ingest-week.ts`) writes NULL
--     explicitly for a line without `yds_allow`, and `deliveredLine`
--     (score-week-worker.ts) leaves a NULL `def_yards_allowed` ABSENT, so the
--     def_ya_* family is PENDING (§23.5 / E61) for a template that scores it
--     and irrelevant for one that does not. Every OTHER column keeps its
--     DEFAULT 0 and D303's "NULL reads 0" — this migration touches exactly
--     one column.
-- (2) BACKFILL: every existing `def_yards_allowed = 0` → NULL. Those zeros are
--     the DEFAULT, never a delivered value: no code path wrote the column
--     before L.E1.26 (above), so every pre-143 row is "absent" by
--     construction. Values other than 0 are left alone (none exist before
--     L.E1.26's code; after it they are real Sleeper values). The one
--     theoretical casualty is a GENUINE delivered 0 written by L.E1.26's code
--     between its deploy and this push — possible only in a live game's first
--     minutes (a final 0 is outside the real domain: 2026 wk1/wk2 minima 176 /
--     151), and self-healing: the next poll reads stored NULL ≠ incoming 0 (the
--     diff is exact for this column) and rewrites it.
--     Rows NULLed here stop paying the phantom +5 wherever they are re-read:
--     the SEASON key of `league_player_values` (L.E1.20 sums `scoreStarter`
--     over past weeks) and any NOT-final week the worker re-scores. A FINAL
--     league week is never re-scored (Q64), so stored matchup scores and
--     standings do not move.
--
--     ⚠ PUSH ORDER (R1149 / F400 / D380(11)) — this migration and the
--     re-ingest are ONE operation:
--       1. `npx supabase db push`                          (applies 143)
--       2. IMMEDIATELY: `npm run sync:reingest -- --season 2026
--          --weeks <every completed week> --confirm-target <hosted host>`
--     Nothing else re-polls a completed week (the live poll plans only HOT
--     weeks; its hourly sweep polls only the current calendar week). Until
--     step 2 runs, every D/ST starter of a completed week under a yards-
--     scoring template (Scout Standard — the DEFAULT template — Scout PPR,
--     ESPN Std / PPR) reads PENDING in the box score beside a stored final
--     score, and the nightly reconcile raises a `pending_vs_stored` ALERT
--     for every such cell. After step 2 the box score shows the REAL tier,
--     so a final week's box total can differ from its stored score (which
--     kept the +5 — F397); reconcile reads that as `post_window_correction`
--     (a WARN naming the delta) and checks that cell no further (F268).
--     The tool is idempotent (a second run writes and enqueues nothing).
-- (3) COMMENT the new contract on the column.
--
-- SLEEPER'S ZERO-OMISSION (R1150). Sleeper omits a zero-valued stat — a
-- finished shutout line carries no `pts_allow` (7 of 7 2025 shutouts), and
-- the convention applies to yards too: the live 2026 wk3 ARI row lacked
-- `yds_allow` but carried `yds_allow_0_100: 1`. The adapter therefore reads
-- "no `yds_allow` + `yds_allow_0_100: 1`" on an ACTUAL line as a DELIVERED
-- 0 (`readZeroOmittedYardsAllowed`, sleeper-stats-provider.ts). Only a line
-- with neither the value nor that indicator stays NULL / pending — a
-- DELIBERATE deviation from Sleeper's convention whose cost is a line that
-- never carries yards at all (never observed: every played D/ST row
-- measured carries exactly one `yds_allow_<tier>` indicator; the 2025
-- minimum is 75 yards). Points allowed keeps NULL-reads-0, which IS
-- Sleeper's convention and correct (F401 closed).
--
-- Loud (CLAUDE.md): the backfill counts its rows and RAISEs a NOTICE with
-- the count, then ASSERTS that no 0 survives (a trigger or rule rewriting
-- the UPDATE would otherwise pass silently).
--
-- MIGRATION CHECKLIST (tasks-M* §4.4): one ALTER COLUMN ... DROP DEFAULT +
-- one data UPDATE + one COMMENT on `player_stats`. No function is created or
-- replaced (zero D137 hunks). No RLS / policy / grant change: `player_stats`
-- RLS and grants are untouched (001 / 037) — so no no-write-policy cell is
-- owed (§4.2 is unchanged by a default drop). Typegen: the generated
-- `Insert` / `Update` types of a nullable column are identical with or
-- without a DEFAULT — `src/types/database.ts` diff 0 lines (measured).
-- WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
-- `db reset` 001–143 + pgTAP 091 + the backfill rehearsed on the local
-- restored pool (counts in the PR). D38-style realtime waiver — no broadcast
-- trigger: nothing subscribes to `player_stats` changes (the §23.2 queue is
-- written by the ingest itself).
-- ============================================================================

ALTER TABLE public.player_stats
  ALTER COLUMN def_yards_allowed DROP DEFAULT;

DO $$
DECLARE
  v_nulled integer;
  v_zero_left integer;
BEGIN
  UPDATE public.player_stats
     SET def_yards_allowed = NULL
   WHERE def_yards_allowed = 0;
  GET DIAGNOSTICS v_nulled = ROW_COUNT;
  RAISE NOTICE '143: def_yards_allowed — % never-ingested zero(s) set to NULL (not delivered)', v_nulled;

  SELECT count(*) INTO v_zero_left
    FROM public.player_stats
   WHERE def_yards_allowed = 0;
  IF v_zero_left <> 0 THEN
    RAISE EXCEPTION '143: % row(s) still hold def_yards_allowed = 0 after the backfill', v_zero_left;
  END IF;
END
$$;

COMMENT ON COLUMN public.player_stats.def_yards_allowed IS
  'Raw total yards allowed (canonical def_yards_allowed; Sleeper yds_allow, L.E1.26) — feeds the derived def_ya_* tier indicators (D44/Q3); the indicators themselves are never stored. NO DEFAULT (143): NULL = not delivered, scored as PENDING (the def_ya_* family is withheld), never as 0 yards. A stored number, including 0, is a delivered value.';
