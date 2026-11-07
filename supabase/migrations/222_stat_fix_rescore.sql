-- ============================================================================
-- 222_stat_fix_rescore.sql — OUR OWN STAT FIXES RE-SCORE FINAL WEEKS,
-- AUTOMATICALLY AND QUIETLY, IN EVERY LEAGUE (F870 / F871 / F890 follow-on;
-- FULL rigour — scoring, results, standings, production writes). PROGRESS
-- D836–D839; spec v2.16.118 (§7.3.3, §10.1, §11.4, §23.4 amended).
--
-- THE RULINGS (Chris, the product owner, in chat, verbatim):
--   2026-11-07: "the stats need to be correct. that should be done
--               automatically, we should not be doing this is as some live
--               code change."
--   2026-11-07: "stat and scoring changes are all platform wide by the way,
--               they are not gated to users or leagues."
--   2026-11-07: "fixing stats should not go to some user, i'm not following"
--   2026-11-07: "just update the points as they should be so we can move on."
--   2026-11-06: "as long as all the players have the right stats and scores
--               as a result, then the "team" scores do not matter."
--   Standing and unchanged: F405 / Q81 / §23.4 — the STAT PROVIDER's own late
--   corrections after a week's correction window never change a final week.
--   This migration keeps that true (below: the delta, and the worker's door).
--
-- WHAT A STAT FIX IS. A durable record of OUR change to stored stats (our
-- feed map or ingestion, or the engine — never a provider correction): lines
-- (season, week, player, stat column, before → after) plus a plain reason.
-- The quiet fill (`sync:fill-ruled`) records one on every --apply, before it
-- writes, and marks it written once its after-write checks pass; the operator
-- CLI (`npm run stat-fix`) records one for an engine fix or a backlog. Only a
-- WRITTEN fix is ever applied.
--
-- HOW IT PAYS ONLY OUR CHANGE (TS, the one scorer — §7.3.3, D33; SQL scores
-- nothing). For each STORED starter row of a final week (slot, player — what
-- was actually scored, never `team_lineups.slot_map`, which a commissioner may
-- have edited after the week was final — 201), the score-week pass computes
--   delta = points(today's line with the fix's keys at AFTER)
--         − points(today's line with the fix's keys at BEFORE)
-- under that week's frozen rules, and the new stored points = stored + delta.
-- A provider's late correction sits in BOTH terms and cancels: it is never
-- paid (F405 / Q81 hold). This door takes the result, checks it against what
-- is stored and writes it.
--
-- WHAT THIS MIGRATION DOES
--   §1 `stat_fixes`, `stat_fix_lines`, `stat_fix_rescores` (the receipt) —
--      RLS on, ZERO policies, every client privilege revoked; append-only by
--      trigger (ENABLE ALWAYS): a fix's one change is written_at NULL → set;
--      a fix applied nowhere may be withdrawn, one applied anywhere may not;
--      a line or a receipt goes only with its fix or its league (cascade).
--      No actor column anywhere: a stat fix is the platform's, never a
--      member's ("fixing stats should not go to some user").
--   §2 `league_week_player_points.source` gains `stat_fix`.
--   §3 THE LOCK — `league_week_player_points_lock()` REPLACED against 161's
--      FILE TEXT (D137): ONE inserted hunk (the stat-fix exit) and its
--      refusal's words (a provider's correction never moves a locked week;
--      only our own stat fix does). Every other byte 161's.
--   §4 `record_stat_fix`, `mark_stat_fix_written`, `stat_fix_targets` —
--      service role only, JWT refused in-body.
--   §5 `apply_stat_fix_week` — THE DOOR, modelled on 161's validated body
--      (`admin_rescore_final_week`, 161:265-889), changed where the rulings
--      ask: the lineup is the stored rows; the fix must be written; a receipt
--      for (fix, league, week) replays; the receipt is written even when
--      nothing changed (the pass never retries a done week); NO
--      commissioner_actions row, NO league_chat post, NO notification.
--
-- MATCHUPS, RESULTS, WEEKS: no final-week lock of their own (measured:
-- 110's transition guard fires only on a status change, 126's override guard
-- only when is_overridden moves, 144's rules guards only when the rules move,
-- 170's pointer guards only when an action pointer moves; 212's archive
-- guard refuses an archived league, which this door never reaches — it reads
-- the league with `deleted_at IS NULL`). So the lock above is the only exit
-- this door needs. `admin_rescore_final_week` (161) and its retirement (164)
-- are NOT touched; `score_write_week_batch` (newest: 221) is NOT touched —
-- the worker still refuses a final week with `week_final`.
--
-- ELIGIBLE (each one checked again by the door, by name): the league is not
-- archived, is `in_season`, its season is the fix's, no playoff row exists
-- (`bracket_built` — a bracket was seeded from standings this would move),
-- the week is `final`, and it was finalized at or before the fix LANDED
-- (`week_finalized_after_fix` — a week that closed after our change was
-- scored with it already; paying it again would pay it twice). An ineligible
-- league-week gets no receipt, so it is still owed if it ever becomes
-- eligible (a restored league).
--
-- Numbering: migration 222 (223 spare) and pgTAP 171–172 reserved by the
-- orchestrator; production head 221. NOT held: reaches production by
-- `npx supabase db push` only.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   New: three tables (RLS on, zero policies, REVOKE ALL from PUBLIC / anon /
--   authenticated; append-only triggers ENABLE ALWAYS; the receipt carries
--   212's archive freeze — pgTAP 162 A3's census), one CHECK widened, one
--   trigger function body replaced (DEFINER as in 158 / 161, search_path '',
--   signature unchanged — trigger kept, ENABLE ALWAYS unchanged; REVOKE
--   restated), four new DEFINER functions (in-body JWT refusal, search_path
--   '', REVOKEd from PUBLIC / anon / authenticated; the service role keeps
--   EXECUTE). Time: no clock is read for a scoring decision — `now()` only as
--   a write stamp (119 / 158 / 161's precedent) and as record_stat_fix's
--   default landing instant (the fill passes its injected instant). Lock
--   order: the league row FOR UPDATE before any write (rule 8); the rebuild
--   takes the league and the week row after it (126's order). Typegen: the
--   tables and the functions (additive; alias block kept). Realtime: none
--   new — the matchups / team_week_results UPDATEs fire 119's broadcasts, so
--   open boxes and standings refetch; no post, no notification. WAIVERS: R6 —
--   no staging clone; rehearsal = a fresh local `db reset` 001–222, the full
--   pgTAP run and the stack suite (stat-fix-rescore-db). D38: no data
--   backfill in the migration — the backlog is recorded with `npm run
--   stat-fix -- record` after the push and applied by the score-week pass.
--   DEPLOY BEFORE PUSH: the pass reads `stat_fix_targets` and is a silent
--   no-op while it is absent; the fill refuses --apply by name while
--   `record_stat_fix` is absent.
-- ============================================================================

-- Bounded wait (216 / 217 / 218 / 221's precedent, R1797): the CHECK swap and
-- the trigger function take locks on hot tables; queued behind a long
-- transaction this fails fast rather than stalling the push. This
-- transaction only.
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. THE RECORD OF OUR FIXES, AND THE RECEIPTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stat_fixes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season     INTEGER NOT NULL CHECK (season BETWEEN 2000 AND 2100),
  reason     TEXT NOT NULL CHECK (btrim(reason) <> '' AND char_length(reason) <= 500),
  landed_at  TIMESTAMPTZ NOT NULL,              -- when OUR change reached the stats (or the engine): a week finalized after it was already scored with it
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  written_at TIMESTAMPTZ,                       -- NULL = recorded, not yet confirmed written; only a written fix is ever applied
  CHECK (written_at IS NULL OR written_at >= created_at)
);
COMMENT ON TABLE stat_fixes IS
  'Migration 222 (PROGRESS D836; spec v2.16.118): a stat fix of OUR OWN — our feed map, our ingestion or the engine, never a provider correction — recorded with its lines (stat_fix_lines) and a plain reason. Chris 2026-11-07, verbatim: "the stats need to be correct. that should be done automatically, we should not be doing this is as some live code change." Written by record_stat_fix (the quiet fill on every --apply, or npm run stat-fix) and confirmed by mark_stat_fix_written; the score-week pass applies every WRITTEN fix to every eligible final league-week (apply_stat_fix_week). No actor: "fixing stats should not go to some user". ZERO policies; append-only (the one change is written_at NULL → set).';

CREATE TABLE IF NOT EXISTS stat_fix_lines (
  fix_id       UUID NOT NULL REFERENCES stat_fixes(id) ON DELETE CASCADE,
  season       INTEGER NOT NULL,
  week         INTEGER NOT NULL CHECK (week BETWEEN 1 AND 22),
  player_id    TEXT NOT NULL REFERENCES players(id),
  stat_key     TEXT NOT NULL,                   -- a numeric player_stats stat column (record_stat_fix refuses any other by name)
  before_value NUMERIC NOT NULL,                -- the stored value our fix replaced (0 for a line that had no row)
  after_value  NUMERIC NOT NULL,                -- what our fix wrote
  PRIMARY KEY (fix_id, week, player_id, stat_key),
  CHECK (before_value <> after_value)
);
COMMENT ON TABLE stat_fix_lines IS
  'Migration 222 (D836): one moved stat of a stat fix — (week, player, player_stats column, before → after). The pass pays exactly this move: points(today''s line with these keys at after) − points(today''s line with these keys at before), under each week''s own rules, so a provider correction on the same line cancels and is never paid (F405 / Q81). ZERO policies; goes only with its fix.';

CREATE TABLE IF NOT EXISTS stat_fix_rescores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fix_id          UUID NOT NULL REFERENCES stat_fixes(id),
  league_id       UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  season          INTEGER NOT NULL,
  week            INTEGER NOT NULL,
  applied_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  players_changed INTEGER NOT NULL CHECK (players_changed >= 0),
  scores_changed  INTEGER NOT NULL CHECK (scores_changed >= 0),
  result          JSONB NOT NULL,               -- the door's document, replayed byte for byte
  UNIQUE (fix_id, league_id, week)              -- one receipt per (fix, league-week): the pass's idempotency
);
COMMENT ON TABLE stat_fix_rescores IS
  'Migration 222 (D836): the SYSTEM receipt of one stat fix applied to one final league-week by apply_stat_fix_week — written even when nothing changed, so the pass never retries a done week. No actor: Chris 2026-11-07, verbatim, "fixing stats should not go to some user, i''m not following". Not the commissioner log (no member is named, nothing is posted, nobody is notified). ZERO policies; append-only; goes only with its league.';

ALTER TABLE stat_fixes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE stat_fix_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE stat_fix_rescores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE stat_fixes, stat_fix_lines, stat_fix_rescores FROM PUBLIC, anon, authenticated;

-- 212's freeze, like every table with a league_id (pgTAP 162 A3's census): an
-- archived league's receipts never change.
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON stat_fix_rescores
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');

-- Append-only (§12.12's posture for a record of what was done — 123's shape):
-- each guard names its one exit.
CREATE OR REPLACE FUNCTION stat_fixes_guard_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- The one change a fix ever takes: confirmed written, once, nothing else moving.
    IF OLD.written_at IS NULL AND NEW.written_at IS NOT NULL
       AND (to_jsonb(NEW) - 'written_at') = (to_jsonb(OLD) - 'written_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'stat_fixes is append-only: a fix''s one change is written_at, once (NULL → set) — a wrong fix is answered by a NEW fix, never an edit'
      USING ERRCODE = 'P0001';
  END IF;
  -- DELETE: a fix applied nowhere may be withdrawn (its lines go with it); one
  -- applied anywhere is history — its receipts would point at nothing.
  IF NOT EXISTS (SELECT 1 FROM public.stat_fix_rescores r WHERE r.fix_id = OLD.id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'stat_fixes is append-only: fix % has been applied to a league-week and can never be removed — a correction is a NEW fix', OLD.id
    USING ERRCODE = 'P0001';
END;
$$;
REVOKE EXECUTE ON FUNCTION stat_fixes_guard_internal() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_stat_fixes_guard
  BEFORE UPDATE OR DELETE ON stat_fixes
  FOR EACH ROW EXECUTE FUNCTION stat_fixes_guard_internal();
ALTER TABLE stat_fixes ENABLE ALWAYS TRIGGER trg_stat_fixes_guard;

CREATE OR REPLACE FUNCTION stat_fix_lines_guard_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- The cascade from a withdrawn fix: its row is already gone when this fires (123's measured fact).
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.stat_fixes f WHERE f.id = OLD.fix_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'stat_fix_lines is append-only: a % on a fix''s line is refused — a line goes only with its fix', TG_OP
    USING ERRCODE = 'P0001';
END;
$$;
REVOKE EXECUTE ON FUNCTION stat_fix_lines_guard_internal() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_stat_fix_lines_guard
  BEFORE UPDATE OR DELETE ON stat_fix_lines
  FOR EACH ROW EXECUTE FUNCTION stat_fix_lines_guard_internal();
ALTER TABLE stat_fix_lines ENABLE ALWAYS TRIGGER trg_stat_fix_lines_guard;

CREATE OR REPLACE FUNCTION stat_fix_rescores_guard_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- The cascade from a deleted league (123's one exemption, the same fact):
  -- a receipt dies with its league and only with it.
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = OLD.league_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'stat_fix_rescores is append-only: a % on a stat-fix receipt is refused — removing one would make the pass apply its fix a second time', TG_OP
    USING ERRCODE = 'P0001';
END;
$$;
REVOKE EXECUTE ON FUNCTION stat_fix_rescores_guard_internal() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_stat_fix_rescores_guard
  BEFORE UPDATE OR DELETE ON stat_fix_rescores
  FOR EACH ROW EXECUTE FUNCTION stat_fix_rescores_guard_internal();
ALTER TABLE stat_fix_rescores ENABLE ALWAYS TRIGGER trg_stat_fix_rescores_guard;

-- TRUNCATE is the same hole one operation over (R967): a row trigger never sees it.
CREATE OR REPLACE FUNCTION stat_fix_no_truncate_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: a TRUNCATE is refused (a row trigger never sees it)', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$;
REVOKE EXECUTE ON FUNCTION stat_fix_no_truncate_internal() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_stat_fixes_no_truncate BEFORE TRUNCATE ON stat_fixes
  FOR EACH STATEMENT EXECUTE FUNCTION stat_fix_no_truncate_internal();
CREATE TRIGGER trg_stat_fix_lines_no_truncate BEFORE TRUNCATE ON stat_fix_lines
  FOR EACH STATEMENT EXECUTE FUNCTION stat_fix_no_truncate_internal();
CREATE TRIGGER trg_stat_fix_rescores_no_truncate BEFORE TRUNCATE ON stat_fix_rescores
  FOR EACH STATEMENT EXECUTE FUNCTION stat_fix_no_truncate_internal();
ALTER TABLE stat_fixes        ENABLE ALWAYS TRIGGER trg_stat_fixes_no_truncate;
ALTER TABLE stat_fix_lines    ENABLE ALWAYS TRIGGER trg_stat_fix_lines_no_truncate;
ALTER TABLE stat_fix_rescores ENABLE ALWAYS TRIGGER trg_stat_fix_rescores_no_truncate;

-- ---------------------------------------------------------------------------
-- 2. league_week_player_points.source gains `stat_fix`
-- ---------------------------------------------------------------------------
ALTER TABLE league_week_player_points DROP CONSTRAINT league_week_player_points_source_check;
ALTER TABLE league_week_player_points ADD CONSTRAINT league_week_player_points_source_check
  CHECK (source IN ('worker', 'backfill', 'backfill_unrecoverable', 'rescore', 'stat_fix'));
COMMENT ON COLUMN league_week_player_points.source IS
  'worker = written with the score by the scoring door; backfill = recomputed once by the 158 backfill and EQUAL to the stored score (recoverable: the stats had not moved); backfill_unrecoverable = a final week whose stats moved after it was scored (the old line was overwritten — F268), so the rows are the corrected recompute and do NOT add up to the stored score, named as such; rescore = written WITH the re-scored score by admin_rescore_final_week (migration 161, a recorded product ruling — PROGRESS D425), so they add up to it; stat_fix = a final week''s row moved by one of OUR stat fixes (migration 222, apply_stat_fix_week — PROGRESS D836): stored + exactly our change, written with the team''s score, so they add up to it.';

-- ---------------------------------------------------------------------------
-- 3. THE LOCK — CREATE OR REPLACE against 161's FILE TEXT (D137): one hunk
--    inserted before the refusal (the stat-fix exit), and the refusal's
--    words. Every other byte 161's (pgTAP 171 reverses both on the LIVE body
--    and pins 161's md5).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_week_player_points_lock() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER   -- the lock reads the week as it IS, whoever writes (a trigger — never callable directly); RLS stays a client's gate
SET search_path = ''
AS $$
DECLARE
  v_row    public.league_week_player_points;
  v_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
    -- The cascade: the league, its week row or the team is being deleted —
    -- the rows go with it (nothing to protect once their week is gone).
    IF NOT EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = OLD.league_id)
       OR NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = OLD.team_id) THEN
      RETURN OLD;
    END IF;
  ELSE
    v_row := NEW;
    IF TG_OP = 'UPDATE'
       AND (NEW.league_id, NEW.season, NEW.week, NEW.team_id) IS DISTINCT FROM (OLD.league_id, OLD.season, OLD.week, OLD.team_id) THEN
      RAISE EXCEPTION 'league_week_player_points: a row never moves to another league, week or team — delete and write it through the door'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT lw.status INTO v_status
  FROM public.league_weeks lw
  WHERE lw.league_id = v_row.league_id AND lw.season = v_row.season AND lw.week = v_row.week;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;   -- the week row's own cascade
    END IF;
    RAISE EXCEPTION 'league_week_player_points: league % has no league_weeks row for season % week %', v_row.league_id, v_row.season, v_row.week
      USING ERRCODE = 'P0001';
  END IF;

  IF v_status = 'upcoming' THEN
    RAISE EXCEPTION 'league_week_player_points: week_not_open — league % week % is upcoming; nothing has been scored', v_row.league_id, v_row.week
      USING ERRCODE = 'P0001';
  END IF;

  IF v_status = 'final' THEN
    -- The one-time backfill (§5) — INSERT only (a row that did not exist:
    -- "recompute once"), only while its door holds the transaction-local
    -- setting. A convention for the ordinary paths, not a boundary (R1262):
    -- the service role could set it; it can never open an UPDATE or DELETE.
    IF TG_OP = 'INSERT'
       AND NEW.source IN ('backfill', 'backfill_unrecoverable')
       AND current_setting('fieldscout.player_points_backfill', true) = 'on' THEN
      RETURN NEW;
    END IF;
    -- 161 (M5 L.D3.13 — Chris 2026-09-29: "re-score weeks 1 and 2 with the
    -- actual yards"): THE RULED RE-SCORE EXIT. Open only while
    -- admin_rescore_final_week holds the transaction-local setting naming ITS
    -- audit row — a `rescore_final_week` commissioner_actions row of THIS
    -- league, season and week, written earlier in the same transaction — and
    -- only for a row it writes as `rescore` (INSERT / UPDATE) or a row it
    -- removes (DELETE: a slot the team no longer starts). Like 158's backfill
    -- exit it is a convention for the ordinary paths, not a boundary against
    -- the service role (R1262's reading, unchanged); what it adds is that the
    -- audit row must exist, so no locked week changes without its receipt.
    IF current_setting('fieldscout.final_week_rescore', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND (TG_OP = 'DELETE' OR v_row.source = 'rescore')
       AND EXISTS (
         SELECT 1 FROM public.commissioner_actions a
         WHERE a.id = current_setting('fieldscout.final_week_rescore', true)::uuid
           AND a.league_id = v_row.league_id
           AND a.action_type = 'rescore_final_week'
           AND a.metadata ->> 'season' = v_row.season::text
           AND a.metadata ->> 'week' = v_row.week::text) THEN
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    -- 222 (F870 follow-on — Chris 2026-11-07: "the stats need to be correct.
    -- that should be done automatically"): OUR OWN STAT FIX's exit. Open only
    -- while apply_stat_fix_week holds the transaction-local setting naming ITS
    -- receipt — a stat_fix_rescores row of THIS league, season and week,
    -- written earlier in the same transaction — and only for an UPDATE that
    -- keeps the row's slot and starter (the lineup is what was scored) and
    -- marks it `stat_fix`. Never an INSERT, never a DELETE. Like the two exits
    -- above it is a convention for the ordinary paths, not a boundary against
    -- the service role (R1262's reading); the provider's late corrections
    -- never reach it (the worker's door still refuses a final week).
    -- (Two IFs, not one AND: SQL does not promise to read the setting's shape
    -- before the cast below, and a cleared setting is '' — never a uuid.)
    IF TG_OP = 'UPDATE'
       AND NEW.source = 'stat_fix'
       AND (NEW.slot, NEW.player_id) IS NOT DISTINCT FROM (OLD.slot, OLD.player_id)
       AND current_setting('fieldscout.stat_fix_rescore', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      IF EXISTS (
           SELECT 1 FROM public.stat_fix_rescores r
           WHERE r.id = current_setting('fieldscout.stat_fix_rescore', true)::uuid
             AND r.league_id = v_row.league_id
             AND r.season = v_row.season
             AND r.week = v_row.week) THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'league_week_player_points: week_locked — league % week % is final; its stored per-player points never change (F405: a provider''s later stat correction updates player_stats, never a locked week — only a stat fix of our own re-scores one, through apply_stat_fix_week, §11.4 / §23.4)', v_row.league_id, v_row.week
      USING ERRCODE = 'P0001';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE EXECUTE ON FUNCTION league_week_player_points_lock() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. RECORDING A FIX, CONFIRMING IT, AND WHAT IS OWED
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_stat_fix(
  p_season    INTEGER,
  p_reason    TEXT,         -- plain words: what we fixed and why (≤ 500)
  p_lines     JSONB,        -- [{week, player_id, stat_key, before, after}] — every moved value
  p_landed_at TIMESTAMPTZ DEFAULT NULL   -- when the change reached the stats (the fill: its own instant); NULL = now
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reason  TEXT;
  v_landed  TIMESTAMPTZ;
  v_e       JSONB;
  v_i       INTEGER := 0;
  v_week    INTEGER;
  v_player  TEXT;
  v_key     TEXT;
  v_keys    TEXT[];
  v_seen    TEXT[] := '{}';
  v_fix_id  UUID;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'record_stat_fix: a stat fix is the platform''s (service role), never a signed-in user''s'
      USING ERRCODE = '42501';
  END IF;
  IF p_season IS NULL OR p_season NOT BETWEEN 2000 AND 2100 THEN
    RAISE EXCEPTION 'record_stat_fix: p_season is required (2000–2100, got %)', p_season
      USING ERRCODE = '22023';
  END IF;
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'record_stat_fix: the reason (plain words — what we fixed and why) is required and at most 500 characters (got %)', COALESCE(char_length(v_reason), 0)
      USING ERRCODE = '22023';
  END IF;
  -- The landing instant is the caller's (the fill passes its injected instant,
  -- the instant its writes are stamped with); NULL is now.
  v_landed := COALESCE(p_landed_at, now());
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'record_stat_fix: p_lines must be a non-empty JSON array of {week, player_id, stat_key, before, after}'
      USING ERRCODE = '22023';
  END IF;

  -- The stat columns a fix may name: player_stats' numeric columns, measured from
  -- the catalog (so a column a later migration adds is one), less the key and the
  -- game-state columns, which are not stats.
  SELECT array_agg(c.column_name::text ORDER BY c.column_name) INTO v_keys
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'player_stats'
    AND c.data_type IN ('integer', 'numeric', 'smallint', 'bigint', 'real', 'double precision')
    AND c.column_name NOT IN ('season', 'week', 'game_quarter');

  FOR v_e IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_e) <> 'object' THEN
      RAISE EXCEPTION 'record_stat_fix: line % is not an object', v_i
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_e -> 'week') IS DISTINCT FROM 'number' OR (v_e ->> 'week')::numeric <> trunc((v_e ->> 'week')::numeric)
       OR (v_e ->> 'week')::numeric NOT BETWEEN 1 AND 22 THEN
      RAISE EXCEPTION 'record_stat_fix: line % week must be a whole number 1–22 (got %)', v_i, COALESCE(v_e ->> 'week', 'nothing')
        USING ERRCODE = '22023';
    END IF;
    v_week := (v_e ->> 'week')::integer;
    v_player := NULLIF(btrim(COALESCE(v_e ->> 'player_id', '')), '');
    IF jsonb_typeof(v_e -> 'player_id') IS DISTINCT FROM 'string' OR v_player IS NULL THEN
      RAISE EXCEPTION 'record_stat_fix: line % has no player_id', v_i
        USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = v_player) THEN
      RAISE EXCEPTION 'record_stat_fix: line % names player %, whom players does not know', v_i, v_player
        USING ERRCODE = '22023';
    END IF;
    v_key := v_e ->> 'stat_key';
    IF jsonb_typeof(v_e -> 'stat_key') IS DISTINCT FROM 'string' OR NOT (v_key = ANY (v_keys)) THEN
      RAISE EXCEPTION 'record_stat_fix: line % stat_key % is not a numeric player_stats stat column', v_i, COALESCE(v_key, 'nothing')
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_e -> 'before') IS DISTINCT FROM 'number' OR jsonb_typeof(v_e -> 'after') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'record_stat_fix: line % (week %, %, %) before and after must be JSON numbers (a line that had no row is before 0)', v_i, v_week, v_player, v_key
        USING ERRCODE = '22023';
    END IF;
    IF (v_e ->> 'before')::numeric = (v_e ->> 'after')::numeric THEN
      RAISE EXCEPTION 'record_stat_fix: line % (week %, %, %) does not move (% → %) — a fix names only what it changed', v_i, v_week, v_player, v_key, v_e ->> 'before', v_e ->> 'after'
        USING ERRCODE = '22023';
    END IF;
    IF (v_week || '|' || v_player || '|' || v_key) = ANY (v_seen) THEN
      RAISE EXCEPTION 'record_stat_fix: week % player % stat % appears twice', v_week, v_player, v_key
        USING ERRCODE = '22023';
    END IF;
    v_seen := v_seen || (v_week || '|' || v_player || '|' || v_key);
  END LOOP;

  INSERT INTO public.stat_fixes (season, reason, landed_at)
  VALUES (p_season, v_reason, v_landed)
  RETURNING id INTO v_fix_id;
  INSERT INTO public.stat_fix_lines (fix_id, season, week, player_id, stat_key, before_value, after_value)
  SELECT v_fix_id, p_season, (e ->> 'week')::integer, btrim(e ->> 'player_id'), e ->> 'stat_key',
         (e ->> 'before')::numeric, (e ->> 'after')::numeric
  FROM jsonb_array_elements(p_lines) e;
  RETURN v_fix_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION record_stat_fix(INTEGER, TEXT, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION record_stat_fix(INTEGER, TEXT, JSONB, TIMESTAMPTZ) IS
  'Migration 222 (D836): records a stat fix of our own — every moved value, before → after — and returns its id, NOT yet written (nothing is applied from it until mark_stat_fix_written). Each stat_key must be a numeric player_stats stat column, each player known, each line a real move. Service role only. Chris 2026-11-07, verbatim: "the stats need to be correct. that should be done automatically, we should not be doing this is as some live code change."';

CREATE OR REPLACE FUNCTION mark_stat_fix_written(
  p_fix_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_fix public.stat_fixes;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'mark_stat_fix_written: a stat fix is the platform''s (service role), never a signed-in user''s'
      USING ERRCODE = '42501';
  END IF;
  IF p_fix_id IS NULL THEN
    RAISE EXCEPTION 'mark_stat_fix_written: p_fix_id is required'
      USING ERRCODE = '22023';
  END IF;
  SELECT f.* INTO v_fix FROM public.stat_fixes f WHERE f.id = p_fix_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mark_stat_fix_written: stat fix % not found', p_fix_id
      USING ERRCODE = 'P0002';
  END IF;
  -- Idempotent, and says so: a second call changes nothing and names the first.
  IF v_fix.written_at IS NOT NULL THEN
    RETURN jsonb_build_object('fix_id', v_fix.id, 'written_at', v_fix.written_at, 'already_written', TRUE);
  END IF;
  UPDATE public.stat_fixes SET written_at = now() WHERE id = p_fix_id
  RETURNING * INTO v_fix;
  RETURN jsonb_build_object('fix_id', v_fix.id, 'written_at', v_fix.written_at, 'already_written', FALSE);
END;
$$;
REVOKE EXECUTE ON FUNCTION mark_stat_fix_written(UUID) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION mark_stat_fix_written(UUID) IS
  'Migration 222 (D836): confirms a recorded stat fix WRITTEN — its stat change has landed and been checked (the fill calls it only after its after-write checks pass). From then on the score-week pass applies it to every eligible final league-week. Idempotent. Service role only.';

CREATE OR REPLACE FUNCTION stat_fix_targets(
  p_owed_only  BOOLEAN DEFAULT TRUE,
  p_limit      INTEGER DEFAULT 10,
  p_league_ids UUID[]  DEFAULT NULL
) RETURNS TABLE (
  fix_id    UUID,
  league_id UUID,
  season    INTEGER,
  week      INTEGER,
  state     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'stat_fix_targets: the stat-fix pass is the worker''s (service role), never a signed-in user''s'
      USING ERRCODE = '42501';
  END IF;
  IF p_owed_only IS NULL OR (p_owed_only AND (p_limit IS NULL OR p_limit < 1)) THEN
    RAISE EXCEPTION 'stat_fix_targets: p_owed_only is required, and a positive p_limit with it'
      USING ERRCODE = '22023';
  END IF;

  -- Every WRITTEN fix × every league of its season holding one of its weeks.
  -- state: applied (a receipt exists) · league_archived · league_not_in_season
  -- · bracket_built · week_not_final · week_finalized_after_fix · owed. An
  -- ineligible league-week has no receipt, so it is still owed if it ever
  -- becomes eligible (a restored league).
  RETURN QUERY
    WITH fw AS (
      SELECT DISTINCT f.id AS fid, f.season AS sn, ln.week AS wk, f.landed_at, f.created_at
      FROM public.stat_fixes f
      JOIN public.stat_fix_lines ln ON ln.fix_id = f.id
      WHERE f.written_at IS NOT NULL
    ), t AS (
      SELECT fw.fid, lw.league_id AS lid, fw.sn, fw.wk, fw.created_at,
             CASE WHEN EXISTS (SELECT 1 FROM public.stat_fix_rescores r
                               WHERE r.fix_id = fw.fid AND r.league_id = lw.league_id AND r.week = fw.wk) THEN 'applied'
                  WHEN lg.deleted_at IS NOT NULL THEN 'league_archived'
                  WHEN lg.status <> 'in_season' THEN 'league_not_in_season'
                  WHEN EXISTS (SELECT 1 FROM public.matchups m
                               WHERE m.league_id = lg.id AND m.season = lg.season
                                 AND m.round_type IN ('playoff', 'consolation', 'third_place')) THEN 'bracket_built'
                  WHEN lw.status <> 'final' THEN 'week_not_final'
                  WHEN lw.finalized_at > fw.landed_at THEN 'week_finalized_after_fix'
                  ELSE 'owed' END AS st
      FROM fw
      JOIN public.league_weeks lw ON lw.season = fw.sn AND lw.week = fw.wk
      JOIN public.leagues lg ON lg.id = lw.league_id AND lg.season = fw.sn
      WHERE p_league_ids IS NULL OR lg.id = ANY (p_league_ids)
    )
    SELECT t.fid, t.lid, t.sn, t.wk, t.st
    FROM t
    WHERE NOT p_owed_only OR t.st = 'owed'
    ORDER BY CASE WHEN p_owed_only THEN random() END,   -- a league-week that keeps failing can't starve the rest of a capped pass (216's idiom)
             t.created_at, t.fid, t.lid, t.wk
    LIMIT CASE WHEN p_owed_only THEN p_limit END;
END;
$$;
REVOKE EXECUTE ON FUNCTION stat_fix_targets(BOOLEAN, INTEGER, UUID[]) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION stat_fix_targets(BOOLEAN, INTEGER, UUID[]) IS
  'Migration 222 (D836): every (written stat fix, league, week) and its state — applied, owed, or why not (league_archived, league_not_in_season, bracket_built, week_not_final, week_finalized_after_fix). p_owed_only: the owed ones only, in random order, at most p_limit (the score-week pass); else all of them (npm run stat-fix -- status). Platform-wide: Chris 2026-11-07, verbatim, "stat and scoring changes are all platform wide by the way, they are not gated to users or leagues." Service role only.';

-- ---------------------------------------------------------------------------
-- 5. apply_stat_fix_week — THE DOOR
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_stat_fix_week(
  p_fix_id    UUID,       -- a WRITTEN stat fix; NULL only for a dry run of lines not yet recorded (the CLI's plan)
  p_league_id UUID,
  p_week      INTEGER,
  p_teams     JSONB,      -- [{team_id, points: number, players: [{slot, player_id, points, pending, reason, stored}]}] — every team of the week; `stored` = the points the plan read
  p_dry_run   BOOLEAN DEFAULT TRUE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league       public.leagues;
  v_lw           public.league_weeks;
  v_fix          public.stat_fixes;
  v_receipt      public.stat_fix_rescores;
  v_mode         TEXT;
  v_e            JSONB;
  v_x            JSONB;
  v_i            INTEGER := 0;
  v_tid          UUID;
  v_team_ids     UUID[] := '{}';
  v_week_teams   UUID[];
  v_missing      UUID[];
  v_extra        UUID[];
  v_cnt          INTEGER;
  v_want_s       TEXT;
  v_got_s        TEXT;
  v_bad          JSONB;
  v_plan         JSONB := '[]'::jsonb;   -- h2h: every NON-overridden row, before → after; total_points: every results row
  v_overridden   JSONB := '[]'::jsonb;   -- the commissioner's numbers, kept
  v_cells        INTEGER := 0;           -- cells (rows) the plan changes
  v_pp_write     UUID[] := '{}';         -- teams whose per-player rows this door writes (158's rule)
  v_want         JSONB := '[]'::jsonb;   -- the rows of those teams that change
  v_pp_update    INTEGER := 0;
  v_team_lines   JSONB := '[]'::jsonb;   -- per team: stored cells → recomputed
  v_scores_moved INTEGER := 0;
  v_no_changes   BOOLEAN;
  v_twr_before   JSONB;
  v_twr_after    JSONB;
  v_median_b     NUMERIC;
  v_median_a     NUMERIC;
  v_rebuild      JSONB;
  v_changes      JSONB := '[]'::jsonb;   -- per team whose result changed
  v_flips        JSONB := '[]'::jsonb;   -- per matchup whose result changed
  v_receipt_id   UUID;
  v_result       JSONB;
BEGIN
  -- A JWT-bearing caller is refused in-body (rule 2); the REVOKE below narrows
  -- EXECUTE to the service role — this says why.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'apply_stat_fix_week: a stat fix is the platform''s (service role), never a signed-in user''s'
      USING ERRCODE = '42501';
  END IF;

  -- (1) SHAPE (22023), before anything is read or locked.
  IF p_league_id IS NULL OR p_week IS NULL OR p_teams IS NULL OR p_dry_run IS NULL THEN
    RAISE EXCEPTION 'apply_stat_fix_week: p_league_id, p_week, p_teams and p_dry_run are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_fix_id IS NULL AND NOT p_dry_run THEN
    RAISE EXCEPTION 'apply_stat_fix_week: p_fix_id is required to apply (only a dry run plans lines not yet recorded)'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_teams) <> 'array' OR jsonb_array_length(p_teams) = 0 THEN
    RAISE EXCEPTION 'apply_stat_fix_week: p_teams must be a non-empty JSON array of {team_id, points, players}'
      USING ERRCODE = '22023';
  END IF;
  FOR v_e IN SELECT value FROM jsonb_array_elements(p_teams) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_e) <> 'object' THEN
      RAISE EXCEPTION 'apply_stat_fix_week: element % is not an object', v_i
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_tid := (v_e ->> 'team_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_tid := NULL;
    END;
    IF v_tid IS NULL THEN
      RAISE EXCEPTION 'apply_stat_fix_week: element % has no valid team_id', v_i
        USING ERRCODE = '22023';
    END IF;
    IF v_tid = ANY (v_team_ids) THEN
      RAISE EXCEPTION 'apply_stat_fix_week: team % appears twice in the batch', v_tid
        USING ERRCODE = '22023';
    END IF;
    v_team_ids := v_team_ids || v_tid;
    IF jsonb_typeof(v_e -> 'points') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'apply_stat_fix_week: element % (team %) points must be a JSON number — a final week is never re-scored to pending (E61)', v_i, v_tid
        USING ERRCODE = '22023';
    END IF;
    IF scale((v_e ->> 'points')::numeric) > 2 THEN
      RAISE EXCEPTION 'apply_stat_fix_week: element % (team %) points % has more than two decimals — the scorer rounds (F22); the door never does', v_i, v_tid, v_e ->> 'points'
        USING ERRCODE = '22023';
    END IF;
    PERFORM public.player_points_rows_check_internal('apply_stat_fix_week', v_i, v_tid, v_e -> 'points', v_e -> 'players');
    FOR v_x IN SELECT value FROM jsonb_array_elements(v_e -> 'players') LOOP
      IF jsonb_typeof(v_x -> 'stored') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'apply_stat_fix_week: element % (team %) slot % has no stored number — every row names the points the plan read', v_i, v_tid, v_x ->> 'slot'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;

  -- (2) The LEAGUE row FIRST (rule 8). An archived league is not found.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_stat_fix_week: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- (3) THE FIX, and REPLAY by its receipt — after the league lock, before every
  --     business gate, so a second pass returns the first one's document
  --     whatever has moved since.
  IF p_fix_id IS NOT NULL THEN
    SELECT f.* INTO v_fix FROM public.stat_fixes f WHERE f.id = p_fix_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'apply_stat_fix_week: stat fix % not found', p_fix_id
        USING ERRCODE = 'P0002';
    END IF;
    SELECT r.* INTO v_receipt
    FROM public.stat_fix_rescores r
    WHERE r.fix_id = p_fix_id AND r.league_id = p_league_id AND r.week = p_week;
    IF FOUND THEN
      RETURN v_receipt.result || jsonb_build_object('replayed', TRUE, 'receipt_id', v_receipt.id);
    END IF;
    IF v_fix.written_at IS NULL THEN
      RAISE EXCEPTION 'apply_stat_fix_week: fix_not_written — stat fix % is recorded but not confirmed written; nothing is applied from it', p_fix_id
        USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.stat_fix_lines ln WHERE ln.fix_id = p_fix_id AND ln.week = p_week) THEN
      RAISE EXCEPTION 'apply_stat_fix_week: week_not_in_fix — stat fix % moves nothing in week %', p_fix_id, p_week
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (4) The league, its season, the bracket, the week.
  IF v_league.status <> 'in_season' THEN
    RAISE EXCEPTION 'apply_stat_fix_week: league_not_in_season — league % is % (a bracket or a champion already reads these results)', p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;
  IF p_fix_id IS NOT NULL AND v_fix.season <> v_league.season THEN
    RAISE EXCEPTION 'apply_stat_fix_week: fix_other_season — stat fix % is for season %, league % plays %', p_fix_id, v_fix.season, p_league_id, v_league.season
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.matchups m
             WHERE m.league_id = p_league_id AND m.season = v_league.season
               AND m.round_type IN ('playoff', 'consolation', 'third_place')) THEN
    RAISE EXCEPTION 'apply_stat_fix_week: bracket_built — league % already has playoff rows for season %; they were seeded from the standings this would change', p_league_id, v_league.season
      USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_cnt FROM public.teams t WHERE t.league_id = p_league_id AND t.id = ANY (v_team_ids);
  IF v_cnt <> cardinality(v_team_ids) THEN
    RAISE EXCEPTION 'apply_stat_fix_week: the batch names % team(s) that are not league %''s', cardinality(v_team_ids) - v_cnt, p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_stat_fix_week: week_not_scheduled — league % has no league_weeks row for season % week %', p_league_id, v_league.season, p_week
      USING ERRCODE = 'P0001';
  END IF;
  IF v_lw.status <> 'final' THEN
    RAISE EXCEPTION 'apply_stat_fix_week: week_not_final — league % week % is %; an open week is the score worker''s', p_league_id, p_week, v_lw.status
      USING ERRCODE = 'P0001';
  END IF;
  IF p_fix_id IS NOT NULL AND v_lw.finalized_at > v_fix.landed_at THEN
    RAISE EXCEPTION 'apply_stat_fix_week: week_finalized_after_fix — league % week % was finalized %, after stat fix % landed (%): it was scored with the fix already', p_league_id, p_week, v_lw.finalized_at, p_fix_id, v_fix.landed_at
      USING ERRCODE = 'P0001';
  END IF;
  v_mode := COALESCE(COALESCE(v_league.settings, '{}'::jsonb) ->> 'schedule_mode', 'h2h');

  -- (5) COVERAGE — exactly the week's teams.
  IF v_mode = 'total_points' THEN
    SELECT COALESCE(array_agg(DISTINCT r.team_id), '{}') INTO v_week_teams
    FROM public.team_week_results r
    WHERE r.league_id = p_league_id AND r.season = v_league.season AND r.week = p_week;
  ELSE
    SELECT COALESCE(array_agg(DISTINCT x.team_id), '{}') INTO v_week_teams
    FROM (SELECT m.home_team_id AS team_id FROM public.matchups m
          WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
          UNION
          SELECT m.away_team_id FROM public.matchups m
          WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week AND m.away_team_id IS NOT NULL) x;
  END IF;
  SELECT COALESCE(array_agg(t ORDER BY t), '{}') INTO v_missing FROM unnest(v_week_teams) t WHERE NOT (t = ANY (v_team_ids));
  SELECT COALESCE(array_agg(t ORDER BY t), '{}') INTO v_extra FROM unnest(v_team_ids) t WHERE NOT (t = ANY (v_week_teams));
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'apply_stat_fix_week: batch_incomplete — league % week % has % team(s) the batch does not name (%); a week is fixed whole or not at all', p_league_id, p_week, cardinality(v_missing), v_missing
      USING ERRCODE = 'P0001';
  END IF;
  IF cardinality(v_extra) > 0 THEN
    RAISE EXCEPTION 'apply_stat_fix_week: team_not_in_week — team(s) % have no stored score in league % week %', v_extra, p_league_id, p_week
      USING ERRCODE = 'P0001';
  END IF;

  -- LINEUP — what was SCORED: each team's rows are exactly its STORED rows'
  -- (slot, player). Never team_lineups.slot_map: a commissioner may edit a
  -- final week's lineup and is told its score will not follow (201); a stat
  -- fix must not make that edit count.
  FOR v_e IN SELECT value FROM jsonb_array_elements(p_teams) LOOP
    v_tid := (v_e ->> 'team_id')::uuid;
    SELECT COALESCE(string_agg(p.slot || '=' || p.player_id, ',' ORDER BY p.slot), '') INTO v_want_s
    FROM public.league_week_player_points p
    WHERE p.league_id = p_league_id AND p.season = v_league.season AND p.week = p_week AND p.team_id = v_tid;
    SELECT COALESCE(string_agg((x ->> 'slot') || '=' || (x ->> 'player_id'), ',' ORDER BY x ->> 'slot'), '') INTO v_got_s
    FROM jsonb_array_elements(v_e -> 'players') x;
    IF v_want_s IS DISTINCT FROM v_got_s THEN
      RAISE EXCEPTION 'apply_stat_fix_week: lineup_mismatch — team % week %: the stored rows score [%] but the batch scores [%]', v_tid, p_week, v_want_s, v_got_s
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- STALE PLAN — every row names the points the plan read; a row that has moved
  -- since (another fix of the same week, applied in between) is refused, so a
  -- fix is never written over another one.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('team_id', b ->> 'team_id', 'slot', x ->> 'slot',
                                               'planned_from', (x ->> 'stored')::numeric, 'stored', p.points)
                            ORDER BY b ->> 'team_id', x ->> 'slot'), '[]'::jsonb)
    INTO v_bad
  FROM jsonb_array_elements(p_teams) b
  CROSS JOIN LATERAL jsonb_array_elements(b -> 'players') x
  JOIN public.league_week_player_points p
    ON p.league_id = p_league_id AND p.season = v_league.season AND p.week = p_week
   AND p.team_id = (b ->> 'team_id')::uuid AND p.slot = x ->> 'slot'
  WHERE p.points IS DISTINCT FROM (x ->> 'stored')::numeric;
  IF jsonb_array_length(v_bad) > 0 THEN
    RAISE EXCEPTION 'apply_stat_fix_week: plan_stale — league % week %: % stored row(s) moved since the plan read them (%); plan again', p_league_id, p_week, jsonb_array_length(v_bad), v_bad
      USING ERRCODE = 'P0001';
  END IF;

  -- (6) THE PLAN, BY VALUE.
  IF v_mode = 'total_points' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'team_id', r.team_id, 'before', r.points, 'after', (b.e ->> 'points')::numeric,
             'changed', r.points IS DISTINCT FROM (b.e ->> 'points')::numeric) ORDER BY r.team_id), '[]'::jsonb)
      INTO v_plan
    FROM public.team_week_results r
    JOIN jsonb_array_elements(p_teams) b(e) ON (b.e ->> 'team_id')::uuid = r.team_id
    WHERE r.league_id = p_league_id AND r.season = v_league.season AND r.week = p_week;
    SELECT count(*) INTO v_cells FROM jsonb_array_elements(v_plan) p WHERE (p ->> 'changed')::boolean;
    v_pp_write := v_team_ids;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'matchup_id', m.id, 'round_type', m.round_type,
             'home_team_id', m.home_team_id, 'away_team_id', m.away_team_id,
             'before', jsonb_build_object('home_score', m.home_score, 'away_score', m.away_score, 'result', m.result),
             'after',  jsonb_build_object('home_score', n.home, 'away_score', n.away,
                                          'result', public.matchup_result_internal(n.home, n.away, m.away_team_id)),
             'changed', (n.home IS DISTINCT FROM m.home_score OR n.away IS DISTINCT FROM m.away_score
                         OR public.matchup_result_internal(n.home, n.away, m.away_team_id) IS DISTINCT FROM m.result),
             'result_changed', public.matchup_result_internal(n.home, n.away, m.away_team_id) IS DISTINCT FROM m.result)
             ORDER BY m.round_type, m.id), '[]'::jsonb)
      INTO v_plan
    FROM public.matchups m
    CROSS JOIN LATERAL (
      SELECT (SELECT (b ->> 'points')::numeric FROM jsonb_array_elements(p_teams) b WHERE (b ->> 'team_id')::uuid = m.home_team_id) AS home,
             CASE WHEN m.away_team_id IS NULL THEN m.away_score
                  ELSE (SELECT (b ->> 'points')::numeric FROM jsonb_array_elements(p_teams) b WHERE (b ->> 'team_id')::uuid = m.away_team_id) END AS away
    ) n
    WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
      AND NOT m.is_overridden;
    SELECT count(*) INTO v_cells FROM jsonb_array_elements(v_plan) p WHERE (p ->> 'changed')::boolean;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'matchup_id', m.id, 'round_type', m.round_type,
             'home_team_id', m.home_team_id, 'away_team_id', m.away_team_id,
             'home_score', m.home_score, 'away_score', m.away_score, 'result', m.result,
             'why', 'overridden — the commissioner''s number stands; a stat fix never writes it (§22.2)')
             ORDER BY m.round_type, m.id), '[]'::jsonb)
      INTO v_overridden
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
      AND m.is_overridden;

    -- 158's rule: a team's rows follow a score this door may write (≥ 1 non-overridden cell).
    SELECT COALESCE(array_agg(t.id), '{}') INTO v_pp_write
    FROM unnest(v_team_ids) t(id)
    WHERE EXISTS (SELECT 1 FROM public.matchups m
                  WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
                    AND (m.home_team_id = t.id OR m.away_team_id = t.id) AND NOT m.is_overridden);
  END IF;

  -- DRIFT — a team this door writes must store a score its rows add up to (the
  -- rows ARE the score, F405), so stored + our change is the whole story. A team
  -- whose rows do not (a backfill_unrecoverable week, a pre-158 week never
  -- backfilled) is refused by name — never "fixed" silently.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('team_id', d.team_id, 'cell', d.cell, 'rows_sum', d.rows_sum) ORDER BY d.team_id), '[]'::jsonb)
    INTO v_bad
  FROM (
    SELECT t.id AS team_id, c.cell,
           (SELECT COALESCE(sum(p.points), 0) FROM public.league_week_player_points p
            WHERE p.league_id = p_league_id AND p.season = v_league.season AND p.week = p_week AND p.team_id = t.id) AS rows_sum
    FROM unnest(v_pp_write) t(id)
    CROSS JOIN LATERAL (
      SELECT r.points AS cell FROM public.team_week_results r
      WHERE v_mode = 'total_points' AND r.league_id = p_league_id AND r.season = v_league.season AND r.week = p_week AND r.team_id = t.id
      UNION ALL
      SELECT CASE WHEN m.home_team_id = t.id THEN m.home_score ELSE m.away_score END FROM public.matchups m
      WHERE v_mode <> 'total_points' AND m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
        AND (m.home_team_id = t.id OR m.away_team_id = t.id) AND NOT m.is_overridden
    ) c
  ) d
  WHERE d.cell IS DISTINCT FROM d.rows_sum;
  IF jsonb_array_length(v_bad) > 0 THEN
    RAISE EXCEPTION 'apply_stat_fix_week: rows_drift — league % week %: % stored score(s) are not the sum of their stored rows (%); a stat fix adds our change to what was scored and cannot here', p_league_id, p_week, jsonb_array_length(v_bad), v_bad
      USING ERRCODE = 'P0001';
  END IF;

  -- Per team: its stored (non-overridden) cells → the batch's score.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'team_id', tt.id,
           'stored', cells.stored, 'recomputed', (b ->> 'points')::numeric,
           'score_changed', cells.moved) ORDER BY tt.id), '[]'::jsonb),
         count(*) FILTER (WHERE cells.moved)
    INTO v_team_lines, v_scores_moved
  FROM jsonb_array_elements(p_teams) b
  JOIN public.teams tt ON tt.id = (b ->> 'team_id')::uuid
  CROSS JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(c.cell), '[]'::jsonb) AS stored,
           COALESCE(bool_or(c.cell IS DISTINCT FROM (b ->> 'points')::numeric), FALSE) AS moved
    FROM (
      SELECT r.points AS cell FROM public.team_week_results r
      WHERE v_mode = 'total_points' AND r.league_id = p_league_id AND r.season = v_league.season AND r.week = p_week AND r.team_id = tt.id
      UNION ALL
      SELECT CASE WHEN m.home_team_id = tt.id THEN m.home_score ELSE m.away_score END FROM public.matchups m
      WHERE v_mode <> 'total_points' AND m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
        AND (m.home_team_id = tt.id OR m.away_team_id = tt.id) AND NOT m.is_overridden
    ) c
  ) cells;

  -- The rows that change: of a team this door writes, the stored row whose
  -- points, pending or reason differ from the batch's.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'team_id', b ->> 'team_id', 'slot', x ->> 'slot', 'player_id', x ->> 'player_id',
           'stored', p.points, 'points', (x ->> 'points')::numeric, 'pending', x -> 'pending', 'reason', x ->> 'reason')
           ORDER BY b ->> 'team_id', x ->> 'slot'), '[]'::jsonb)
    INTO v_want
  FROM jsonb_array_elements(p_teams) b
  CROSS JOIN LATERAL jsonb_array_elements(b -> 'players') x
  JOIN public.league_week_player_points p
    ON p.league_id = p_league_id AND p.season = v_league.season AND p.week = p_week
   AND p.team_id = (b ->> 'team_id')::uuid AND p.slot = x ->> 'slot'
  WHERE (b ->> 'team_id')::uuid = ANY (v_pp_write)
    AND (p.points, p.pending, p.reason)
        IS DISTINCT FROM ((x ->> 'points')::numeric, ARRAY(SELECT jsonb_array_elements_text(x -> 'pending')), x ->> 'reason');
  v_pp_update := jsonb_array_length(v_want);

  -- NO CHANGE IN ANY DIMENSION — detected by value, never inferred from an
  -- empty write (CLAUDE.md "never let nothing happened mean it worked").
  v_no_changes := (v_cells = 0 AND v_pp_update = 0);

  SELECT COALESCE(jsonb_object_agg(r.team_id::text, jsonb_build_object(
           'points', r.points, 'opponent_team_id', r.opponent_team_id, 'h2h_result', r.h2h_result,
           'median_result', r.median_result, 'second_opponent_team_id', r.second_opponent_team_id,
           'second_result', r.second_result, 'is_final', r.is_final)), '{}'::jsonb)
    INTO v_twr_before
  FROM public.team_week_results r
  WHERE r.league_id = p_league_id AND r.season = v_league.season AND r.week = p_week;
  v_median_b := v_lw.median_score;

  IF v_no_changes THEN
    v_result := jsonb_build_object(
      'fix_id', p_fix_id, 'league_id', p_league_id, 'season', v_league.season, 'week', p_week, 'schedule_mode', v_mode,
      'dry_run', p_dry_run, 'receipt_id', NULL, 'replayed', FALSE, 'no_changes', TRUE,
      'reason', 'no_changes — every score, result and stored player line of the week already equals stored + this fix',
      'team_scores', v_team_lines, 'scores_changed', 0, 'players_changed', 0, 'player_rows', '[]'::jsonb,
      'matchups', v_plan, 'overridden', v_overridden, 'results_changed', '[]'::jsonb, 'flips', '[]'::jsonb,
      'median_score_before', v_median_b, 'median_score_after', v_median_b,
      'standings_rebuilt', FALSE, 'rebuild', NULL);
    -- The receipt even so: this league-week is done for this fix, and the pass
    -- must not ask again every minute.
    IF NOT p_dry_run THEN
      INSERT INTO public.stat_fix_rescores (fix_id, league_id, season, week, players_changed, scores_changed, result)
      VALUES (p_fix_id, p_league_id, v_league.season, p_week, 0, 0, v_result)
      RETURNING id INTO v_receipt_id;
      v_result := v_result || jsonb_build_object('receipt_id', v_receipt_id);
    END IF;
    RETURN v_result;
  END IF;

  -- (7) THE WRITE — in a sub-block, so a DRY RUN is the apply itself, rolled back.
  BEGIN
    -- (7a) The cells: the scores and the result that goes with them, one statement (F245).
    IF v_mode = 'total_points' THEN
      UPDATE public.team_week_results r
      SET points = p.after
      FROM jsonb_to_recordset(v_plan) AS p(team_id uuid, after numeric, changed boolean)
      WHERE r.league_id = p_league_id AND r.season = v_league.season AND r.week = p_week
        AND r.team_id = p.team_id AND p.changed;
    ELSE
      UPDATE public.matchups m
      SET home_score = (p.after ->> 'home_score')::numeric,
          away_score = (p.after ->> 'away_score')::numeric,
          result     = p.after ->> 'result',
          updated_at = now()
      FROM jsonb_to_recordset(v_plan) AS p(matchup_id uuid, after jsonb, changed boolean)
      WHERE m.id = p.matchup_id AND p.changed
        AND m.league_id = p_league_id AND NOT m.is_overridden;
    END IF;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> v_cells THEN
      RAISE EXCEPTION 'apply_stat_fix_week: the plan changes % cell(s) but the write touched % — refusing', v_cells, v_cnt
        USING ERRCODE = 'P0001';
    END IF;

    -- (7b) THE RESULTS MATH finalization calls (126 → week_results_write_internal):
    -- W/L/T, second-opponent and median results, league_weeks.median_score.
    v_rebuild := public.rebuild_team_week_results(p_league_id, p_week);

    SELECT COALESCE(jsonb_object_agg(r.team_id::text, jsonb_build_object(
             'points', r.points, 'opponent_team_id', r.opponent_team_id, 'h2h_result', r.h2h_result,
             'median_result', r.median_result, 'second_opponent_team_id', r.second_opponent_team_id,
             'second_result', r.second_result, 'is_final', r.is_final)), '{}'::jsonb)
      INTO v_twr_after
    FROM public.team_week_results r
    WHERE r.league_id = p_league_id AND r.season = v_league.season AND r.week = p_week;
    SELECT lw.median_score INTO v_median_a FROM public.league_weeks lw WHERE lw.id = v_lw.id;

    -- Every team whose RESULT changed (h2h, second-opponent, median) — recorded, never announced.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'team_id', t.id, 'before', v_twr_before -> (t.id::text), 'after', v_twr_after -> (t.id::text)) ORDER BY t.id), '[]'::jsonb)
      INTO v_changes
    FROM public.teams t
    WHERE t.league_id = p_league_id
      AND (v_twr_before ? (t.id::text) OR v_twr_after ? (t.id::text))
      AND ((v_twr_before -> (t.id::text) ->> 'h2h_result')    IS DISTINCT FROM (v_twr_after -> (t.id::text) ->> 'h2h_result')
        OR (v_twr_before -> (t.id::text) ->> 'median_result') IS DISTINCT FROM (v_twr_after -> (t.id::text) ->> 'median_result')
        OR (v_twr_before -> (t.id::text) ->> 'second_result') IS DISTINCT FROM (v_twr_after -> (t.id::text) ->> 'second_result'));
    SELECT COALESCE(jsonb_agg(p ORDER BY p ->> 'round_type', p ->> 'matchup_id'), '[]'::jsonb) INTO v_flips
    FROM jsonb_array_elements(v_plan) p
    WHERE (p ->> 'result_changed')::boolean;

    v_result := jsonb_build_object(
      'fix_id', p_fix_id, 'league_id', p_league_id, 'season', v_league.season, 'week', p_week, 'schedule_mode', v_mode,
      'dry_run', p_dry_run, 'receipt_id', NULL, 'replayed', FALSE, 'no_changes', FALSE, 'reason', NULL,
      'team_scores', v_team_lines, 'scores_changed', v_scores_moved, 'players_changed', v_pp_update, 'player_rows', v_want,
      'matchups', v_plan, 'overridden', v_overridden, 'results_changed', v_changes, 'flips', v_flips,
      'median_score_before', v_median_b, 'median_score_after', v_median_a,
      'standings_rebuilt', TRUE, 'rebuild', v_rebuild);

    -- (7c) THE RECEIPT — the system's, no actor; it arms the lock's exit for THIS
    -- league-week. A dry run of lines not yet recorded has no fix to receipt:
    -- it runs the cells and the results math and reports the rows it would write.
    IF p_fix_id IS NOT NULL THEN
      INSERT INTO public.stat_fix_rescores (fix_id, league_id, season, week, players_changed, scores_changed, result)
      VALUES (p_fix_id, p_league_id, v_league.season, p_week, v_pp_update, v_scores_moved, v_result)
      RETURNING id INTO v_receipt_id;

      -- (7d) The rows: stored + our change, marked `stat_fix` (the lock's 222 exit).
      PERFORM set_config('fieldscout.stat_fix_rescore', v_receipt_id::text, true);
      UPDATE public.league_week_player_points p
      SET points     = w.points,
          pending    = ARRAY(SELECT jsonb_array_elements_text(w.pending)),
          reason     = w.reason,
          source     = 'stat_fix',
          updated_at = now()
      FROM jsonb_to_recordset(v_want) w(team_id uuid, slot text, player_id text, points numeric, pending jsonb, reason text)
      WHERE p.league_id = p_league_id AND p.season = v_league.season AND p.week = p_week
        AND p.team_id = w.team_id AND p.slot = w.slot AND p.player_id = w.player_id;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> v_pp_update THEN
        RAISE EXCEPTION 'apply_stat_fix_week: the plan writes % per-player row(s) but the update touched % — refusing', v_pp_update, v_cnt
          USING ERRCODE = 'P0001';
      END IF;
      PERFORM set_config('fieldscout.stat_fix_rescore', '', true);
    END IF;

    IF p_dry_run THEN
      RAISE EXCEPTION 'apply_stat_fix_week: dry run — rolled back' USING ERRCODE = 'FSDRY';
    END IF;
  EXCEPTION WHEN SQLSTATE 'FSDRY' THEN
    -- The DRY RUN: every write above is rolled back with this sub-block (the
    -- cells, the rebuild, the receipt, the rows, their broadcasts and the
    -- transaction-local setting); the document is kept. Any OTHER error
    -- propagates — a dry run that would fail as an apply fails the same way.
    v_receipt_id := NULL;
  END;

  RETURN v_result || jsonb_build_object('receipt_id', v_receipt_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION apply_stat_fix_week(UUID, UUID, INTEGER, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION apply_stat_fix_week(UUID, UUID, INTEGER, JSONB, BOOLEAN) IS
  'Migration 222 (PROGRESS D836; spec v2.16.118): writes ONE stat fix of our own into ONE final league-week, quietly — Chris 2026-11-07, verbatim: "just update the points as they should be so we can move on." and "fixing stats should not go to some user, i''m not following". The batch is every team of the week, each stored starter row at stored + exactly our change (computed by the score-week pass through the worker''s scorer under the week''s own rules); checked against the STORED rows (the lineup that was scored, the points the plan read, rows that add up to the score); the non-overridden scores written with their E38 result, the rows marked stat_fix, then the results math finalization calls (rebuild_team_week_results). One system receipt (stat_fix_rescores), written even when nothing changed; NO commissioner_actions row, NO league post, NO notification. Refused by name: an archived or not-in-season league, a built bracket, a week not final or finalized after the fix landed, an unwritten fix. Replays by receipt. Dry run (the default) = the apply rolled back. Service role only.';
