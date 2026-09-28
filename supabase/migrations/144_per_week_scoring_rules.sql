-- ============================================================================
-- 144_per_week_scoring_rules.sql — F397 + Q69 AS RULED: every league week
-- stores the scoring rules it is played with, and a scoring change never
-- re-scores a week in its stat-correction window (M6A task L.E1.27, added by
-- the L.E1.24 merge-forward session from Chris's two chat rulings of
-- 2026-09-27; PROGRESS F397 + F404 (both discharged here), Q69, Q64, D378,
-- D380(11), D381, D382, R1118(a); spec §7.3.3 / §10.1 / §15.4 v2.16.53;
-- tasks-M6A §6's L.E1.27 amendment note; tasks-M6A §4 rules 11-15).
--
-- Numbering (D161 — measured at task time, not trusted from any plan):
-- `ls supabase/migrations | tail -1` → 143_def_yards_allowed_null_is_pending.sql
-- ⇒ 144; `ls supabase/tests | tail -1` → 091_def_yards_allowed_null_is_pending.sql
-- ⇒ pgTAP 092. NOT held: reaches production by `npx supabase db push` like
-- any other migration. Production is at 134 — push debt becomes 135–144, and
-- **141 must not reach production without this migration** (F404: 141 alone
-- re-scores a correction-window week, which Q69 forbids).
--
-- ---------------------------------------------------------------------------
-- THE RULINGS (Chris, 2026-09-27, in chat)
-- ---------------------------------------------------------------------------
-- F397 — "F397 yes build it": each league week stores the scoring rules it
--   is played with; the score worker (live scoring AND stat corrections in
--   the correction window), the box score and the nightly reconcile read
--   THAT week's rules, never the league's current snapshot.
-- Q69 — "Q69 keep last week's scores" (option (b)): a scoring change with
--   re-score ON does not re-score a week in its stat-correction window
--   ("Final (pending corrections)"); it keeps its scores like the final
--   weeks, and the new rules start with the coming week. The LIVE week is
--   re-scored — Q64's chosen words "The new rule applies to this week and
--   later" cover the week in `live` status whether or not its games have
--   started (PROGRESS Q69's last bullet; not re-asked).
--
-- ---------------------------------------------------------------------------
-- §1 THE SCHEMA — `league_weeks` gains the week's rules and their provenance
-- ---------------------------------------------------------------------------
-- Modelled on §7.3.3's league snapshot: `scoring_rules_snapshot JSONB` (the
-- rules document, validated by 104's wall-2 function exactly as the league
-- column is), `scoring_system_id` (the system it was copied from),
-- `scoring_rules_source` (`week_open` | `rescore` | `backfill` |
-- `backfill_ambiguous`) and `scoring_rules_action_id` (the
-- `commissioner_actions` receipt of the change whose rules these are — set
-- by a rescore and by the backfill; NULL at a week's open, where the rules
-- are simply the league's snapshot at that instant). An UPCOMING week holds
-- no rules (a CHECK and the guard): it takes the league's when it opens.
-- `leagues.scoring_rules_snapshot` STAYS — it is the rules the next week to
-- open will take.
-- RLS: unchanged — 056's one SELECT policy ("League weeks viewable by
-- members") and NO write policy for any role; the new columns ride it (a
-- week's rules are league scoring, which §12.25 already shows members).
-- TRUNCATE: already revoked from anon / authenticated by 133's sweep (pgTAP
-- 092 §B pins it for this table). Written only by SECURITY DEFINER / job
-- paths: the week-open stamp (a trigger — §2), the rescore (§5, (13b)), the
-- backfill (§4). The realtime payload is explicit (119:268-280) — no rules
-- document reaches a socket.
--
-- ---------------------------------------------------------------------------
-- §2 THE ONE WRITE POINT AT OPEN — a BEFORE trigger on the status step
-- ---------------------------------------------------------------------------
-- The week's rules are stamped on the `upcoming → live` step (and on a direct
-- INSERT of an already-opened week), by `trg_league_weeks_rules_1_open`. WHY
-- a trigger rather than a hunk in `league_week_advance` (newest definer
-- 118:1725-1936): every road to `live` — the cron job, the sim, a fixture, any
-- future verb — is an UPDATE of `status` that 110's F4 guard already sees, so
-- the trigger is the ONE place no path can miss; a hunk in the job would
-- cover the job only, and 118 would need a D137 replacement for a one-line
-- copy. It is also the instant the worker first may score the week: the
-- worker HOLDS an upcoming week (`score-week-worker.ts`, `week_not_open`).
-- The stamp reads the league row WITHOUT a lock: `league_week_advance` holds
-- that row FOR UPDATE (118:1776) when it opens a week, and
-- `commish_change_setting` takes the same lock first, so the two serialize —
-- a change either sees the week upcoming (and the week takes the new rules
-- when it opens) or live (and a rescore re-writes them). A NULL league
-- snapshot (a pre-draft fixture only — 059 forbids it in-season) is copied
-- as NULL, and every reader then refuses the week BY NAME (`snapshot_missing`
-- — never a fallback to the league column).
-- `trg_league_weeks_rules_2_guard`: a week's stored rules NEVER change once
-- set, except while it is LIVE (the rescore); never cleared; an upcoming
-- week never holds any. So a final or correction-window week's rules are
-- structurally the rules it was played with (Q64 / Q69).
-- `trg_league_weeks_rules_3_valid_ins` / `_upd`: 104's WALL-2 FUNCTION
-- (`leagues_scoring_rules_valid()`, which reads `NEW.scoring_rules_snapshot`
-- — the column name is the same here) attached to `league_weeks` —
-- EXTENDED, not bypassed and not copied. The UPDATE trigger fires on a
-- CHANGED value (`WHEN … IS DISTINCT FROM …`, evaluated AFTER trigger 1 has
-- stamped NEW), not on `UPDATE OF scoring_rules_snapshot`: the open stamp
-- assigns the column inside a status-only UPDATE, which an `UPDATE OF`
-- trigger would never see (R617's lesson, read the other way). Every non-NULL
-- value arrives as a change from NULL, so each is validated at its first
-- write; a later status step never re-validates a stored document (D175(4)'s
-- never-retroactively-invalidate). Trigger names sort 1 → 2 → 3 → 110's
-- `trg_league_weeks_transition`, so PG fires them in that order; all ENABLE
-- ALWAYS (R616).
--
-- ---------------------------------------------------------------------------
-- §3 THE READERS (TypeScript — D33: scoring exists only there)
-- ---------------------------------------------------------------------------
-- One shared helper, `weekScoringRules` (`score-week-worker.ts`), used by the
-- worker (live polls AND correction-window stat corrections), the box score,
-- the nightly reconcile and L.E1.20's season-to-date values
-- (`player-values-job.ts`, R1118(a) — each past week under ITS rules; this
-- week's projection and the preseason value keep the league's current rules,
-- a ranking under the league's scoring now). An opened week with no stored
-- rules is LOUD (`snapshot_missing` — the D292 quarantine / E61 shape).
--
-- ---------------------------------------------------------------------------
-- §4 THE BACKFILL — every existing opened week gets the rules it was scored with
-- ---------------------------------------------------------------------------
-- `league_weeks_rules_backfill_internal(p_apply)`, run once below and
-- NOTICEd. Source of truth: the verb's OWN zero-policy replay ledger
-- (`commish_setting_actions`, 129) — each landed `scoring_system_id` change's
-- full document (previous_value, value, rescore_requested, evaluated_at, and
-- `consequences.final_weeks` / `open_weeks` / `rescored_weeks`: every week's
-- status AT THAT CHANGE). NOT `commissioner_actions`: a commissioner may
-- INSERT a row there directly (123:333-335), so a planted receipt must never
-- steer a week's rules. Replayed in order per week:
--   * no change this season ⇒ the league's current snapshot IS the draft-start
--     freeze ⇒ exact;
--   * a change while the week was UPCOMING ⇒ it opened later under that
--     change's rules ⇒ exact;
--   * a change that RE-SCORED the week (it is in `rescored_weeks`) ⇒ exact;
--   * a change while the week was FINAL ⇒ no effect;
--   * a change while the week was LIVE or in its CORRECTION WINDOW, WITHOUT a
--     rescore ⇒ MIXED: the pre-144 worker re-scored every team it touched
--     afterwards through the league's re-frozen column and left the rest
--     under the old rules. Stored as the NEWER rules — the ones every later
--     score of that week used — with source `backfill_ambiguous`, NAMED in
--     the NOTICE; the nightly reconcile then names exactly the teams that
--     kept the older rules (`drift`). Picking "the rules the stored team
--     scores match" needs the scorer, which lives in TypeScript (D33).
-- The rules a change froze: for the LAST change, the league's current
-- snapshot (exactly what it wrote); for an earlier one, its template's row
-- (templates are written by migrations only — 058 / 106 — both before 129).
-- The rules BEFORE the first change: the first change's `previous_value`
-- system's row — exact for a template; a non-template row is owner-writable
-- (105) and is read as it stands today, the week marked
-- `backfill_ambiguous` and named. A week whose rules cannot be read at all
-- stays NULL and is named UNRECOVERABLE — every reader then refuses it by
-- name. Locally (fresh chain) the backfill finds 0 opened weeks; pgTAP 092 §F
-- walks every arm on a fixture. PRODUCTION'S ROWS ARE CHRIS'S TO READ: the
-- `db push` output carries the NOTICE lines; nothing here queries hosted.
--
-- ---------------------------------------------------------------------------
-- §5 D137 PROVENANCE — `commish_change_setting_internal` (Q69 + the live week's rules)
-- ---------------------------------------------------------------------------
-- Authored against `supabase/migrations/141_rescore_skips_final_weeks.sql`
-- lines 133-612 (the NEWEST defining migration — `grep -ln
-- "commish_change_setting_internal" supabase/migrations/*` → 129, 131, 141,
-- 142; 142 names it in a comment only). The text below is the EXTRACTION
-- (`sed -n 133,612p`), not a re-typing, with NINE hunks applied (`diff -u` →
-- 9 `@@`, 29 `-` / 108 `+` lines):
--   1. DECLARE — `v_cw_weeks`, `v_live_weeks`, `v_skipped_cw`, `v_kept_words`,
--      `v_kept_count`, `v_rules_rewritten`.
--   2. (11) — the correction-window and live weeks read apart; the kept weeks
--      put in plain words (`league_week_list_words_internal`).
--   3. (11b) — `-- Q69 AS RULED`: the kept set is final + correction-window,
--      each named with its status; the why rewritten in plain words (R1139).
--   4. (12c) — the header comment, and the loop reads `live` ONLY.
--   5. (12c) — the live weeks recorded for (13b); the no-live-week arm
--      (`no_live_week — …`, naming every kept week); the `not_requested`
--      arm in plain words, and `score_stale` no longer set: with per-week
--      rules there is no MIXED open week (the worker never reads the
--      re-frozen league column for an opened week).
--   6. `consequences` — `rescore_skipped_correction_window_weeks`,
--      `week_rules_rewritten`, `week_rules_why`.
--   7. the receipt's metadata — `rescore_skipped_correction_window_weeks`;
--      and (13b), the LIVE week(s)' stored rules re-written to the new ones,
--      stamped with the receipt, count asserted.
--   8. the §10.3 post — the live week named; every kept week named with its
--      status; the rescore-off post says weeks already started keep their
--      scoring.
--   9. the result document — `rescore_skipped_correction_window_weeks`.
-- Field shape (the task let the builder pick): a SIBLING list, not a widened
-- one — `rescore_skipped_final_weeks` keeps its meaning (final weeks, ints),
-- so every 141 document and consumer still reads true, and
-- `rescore_skipped_correction_window_weeks` names the other kind; the ONE
-- sentence `rescore_skipped_final_weeks_why` (non-null when EITHER list is)
-- names both, with status, and is what the settings panel's
-- `rescore_skipped_final` arm renders verbatim — so the panel needs no new
-- arm. The route's F65(b) replay guard compares `rescore_requested` and the
-- value, both unchanged.
-- Everything else — the lock, auth, replay, reason, policy, value, no-op,
-- the write, the FAAB arm, the enqueue statements, the audit call, the
-- ledger — is 141's text byte-for-byte. Pre-144 `md5(prosrc)` on the local
-- chain 001-143: `05d2c7e4ae83506c113f7168d262a8b3` (089 A1's literal);
-- post-144: see pgTAP 092 §A (a stored literal). The DEFINER door
-- `commish_change_setting` (129) is NOT replaced; the signature is unchanged.
-- The REVOKE survives CREATE OR REPLACE and is re-stated.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4): four new columns (all NULLable — every
-- existing row valid as it stands: upcoming rows stay NULL, opened rows are
-- filled by §4) + four CHECKs; three new PLAIN functions with
-- `search_path = ''` REVOKEd from PUBLIC / anon / authenticated (two trigger
-- functions, the words helper, the backfill); four triggers ENABLE ALWAYS;
-- one `CREATE OR REPLACE` of an existing PLAIN internal (grants re-stated).
-- No policy added or changed; no realtime surface touched.
-- WAIVERS: R6 (the §8.1 staging rehearsal) — no staging clone exists; the
-- rehearsal is the fresh local `db reset` over 001–144, pgTAP 092 §F's
-- backfill fixture, and the local end-to-end in the PR. D38 not engaged.
-- TYPEGEN: additive — four `league_weeks` columns (Row / Insert / Update) and
-- the two new callable functions; the hand-written alias block re-appended.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE SCHEMA
-- ---------------------------------------------------------------------------
ALTER TABLE league_weeks
  ADD COLUMN scoring_rules_snapshot  JSONB,
  ADD COLUMN scoring_system_id       UUID REFERENCES scoring_systems(id),
  ADD COLUMN scoring_rules_source    TEXT,
  ADD COLUMN scoring_rules_action_id UUID REFERENCES commissioner_actions(id);

ALTER TABLE league_weeks
  ADD CONSTRAINT league_weeks_rules_source_check
    CHECK (scoring_rules_source IS NULL
           OR scoring_rules_source IN ('week_open', 'rescore', 'backfill', 'backfill_ambiguous')),
  ADD CONSTRAINT league_weeks_rules_source_matches_rules
    CHECK ((scoring_rules_snapshot IS NULL) = (scoring_rules_source IS NULL)),
  ADD CONSTRAINT league_weeks_upcoming_holds_no_rules
    CHECK (status <> 'upcoming' OR scoring_rules_snapshot IS NULL),
  ADD CONSTRAINT league_weeks_rescore_names_its_receipt
    CHECK (scoring_rules_source IS DISTINCT FROM 'rescore' OR scoring_rules_action_id IS NOT NULL);

COMMENT ON COLUMN league_weeks.scoring_rules_snapshot IS
  '144 / F397 (L.E1.27): the scoring rules THIS week is played with — copied from leagues.scoring_rules_snapshot when the week opens (upcoming → live), re-written only while the week is LIVE by a rescore, never after. The score worker (live + correction-window stat corrections), the box score, the nightly reconcile and the season-to-date values read THIS, never the league column. NULL exactly while the week is upcoming.';
COMMENT ON COLUMN league_weeks.scoring_system_id IS
  '144 / F397: the scoring system the week''s rules were copied from (provenance).';
COMMENT ON COLUMN league_weeks.scoring_rules_source IS
  '144 / F397: week_open (the league''s rules when the week opened) | rescore (a commissioner scoring change re-scored this live week) | backfill (144 recovered them exactly) | backfill_ambiguous (144 recovered them from a mixed or owner-editable history — named in its NOTICE).';
COMMENT ON COLUMN league_weeks.scoring_rules_action_id IS
  '144 / F397: the commissioner_actions receipt of the change whose rules these are (rescore, backfill); NULL at week open.';

-- ---------------------------------------------------------------------------
-- 2. A LIST OF WEEKS, IN WORDS — "week 3", "weeks 1 and 2", "weeks 1, 2 and 3"
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_week_list_words_internal(p_weeks JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_weeks IS NULL OR jsonb_typeof(p_weeks) <> 'array' OR jsonb_array_length(p_weeks) = 0 THEN NULL
    WHEN jsonb_array_length(p_weeks) = 1 THEN 'week ' || (p_weeks ->> 0)
    ELSE 'weeks '
      || (SELECT string_agg(x.v, ', ' ORDER BY x.o)
          FROM jsonb_array_elements_text(p_weeks) WITH ORDINALITY x(v, o)
          WHERE x.o < jsonb_array_length(p_weeks))
      || ' and ' || (p_weeks ->> (jsonb_array_length(p_weeks) - 1))
  END;
$$;

REVOKE EXECUTE ON FUNCTION league_week_list_words_internal(JSONB)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE WEEK-OPEN STAMP, THE GUARD, AND 104's WALL 2 ON THE NEW COLUMN
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_weeks_rules_on_open()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_rules  JSONB;
  v_system UUID;
BEGIN
  -- The week OPENS: the one legal step out of `upcoming` (110's F4 guard),
  -- or a row inserted already opened. It takes the league's rules as they
  -- stand at this instant (§7.3.3: the league snapshot is "the rules the
  -- next week to open will take").
  IF (TG_OP = 'UPDATE' AND OLD.status = 'upcoming' AND NEW.status <> 'upcoming')
     OR (TG_OP = 'INSERT' AND NEW.status <> 'upcoming' AND NEW.scoring_rules_snapshot IS NULL) THEN
    SELECT l.scoring_rules_snapshot, l.scoring_system_id INTO v_rules, v_system
    FROM public.leagues l
    WHERE l.id = NEW.league_id;
    NEW.scoring_rules_snapshot  := v_rules;
    NEW.scoring_system_id       := CASE WHEN v_rules IS NULL THEN NULL ELSE v_system END;
    NEW.scoring_rules_source    := CASE WHEN v_rules IS NULL THEN NULL ELSE 'week_open' END;
    NEW.scoring_rules_action_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION league_weeks_rules_on_open()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION league_weeks_rules_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- (Only on an INSERT or a row that WAS upcoming: a backwards step such as
  -- live → upcoming is 110's F4 guard's to name — it fires after this one —
  -- and 144's CHECK backs both.)
  IF NEW.status = 'upcoming' AND NEW.scoring_rules_snapshot IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.status = 'upcoming') THEN
    RAISE EXCEPTION
      'league_weeks %: week % (season %) is upcoming and holds no scoring rules — it takes the league''s rules when it opens (F397)',
      NEW.id, NEW.week, NEW.season
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.scoring_rules_snapshot IS NOT NULL
     AND (NEW.scoring_rules_snapshot, NEW.scoring_system_id, NEW.scoring_rules_source, NEW.scoring_rules_action_id)
         IS DISTINCT FROM
         (OLD.scoring_rules_snapshot, OLD.scoring_system_id, OLD.scoring_rules_source, OLD.scoring_rules_action_id) THEN
    IF NEW.scoring_rules_snapshot IS NULL THEN
      RAISE EXCEPTION
        'league_weeks %: week % (season %) cannot lose its scoring rules — a week is scored, box-scored and reconciled under the rules it was played with, for ever (F397)',
        NEW.id, NEW.week, NEW.season
        USING ERRCODE = 'P0001';
    END IF;
    IF OLD.status <> 'live' OR NEW.status <> 'live' THEN
      RAISE EXCEPTION
        'league_weeks %: week % (season %) is % — its scoring rules are the rules it was played with and never change (F397; a finished week keeps its scores, Q64 / Q69). Only the week being played now takes new rules, through a scoring change with re-score on',
        NEW.id, NEW.week, NEW.season, OLD.status
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION league_weeks_rules_guard()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_league_weeks_rules_1_open
  BEFORE INSERT OR UPDATE OF status ON league_weeks
  FOR EACH ROW
  EXECUTE FUNCTION league_weeks_rules_on_open();

CREATE TRIGGER trg_league_weeks_rules_2_guard
  BEFORE INSERT OR UPDATE ON league_weeks
  FOR EACH ROW
  EXECUTE FUNCTION league_weeks_rules_guard();

-- 104's wall-2 function, attached here (it validates NEW.scoring_rules_snapshot).
CREATE TRIGGER trg_league_weeks_rules_3_valid_ins
  BEFORE INSERT ON league_weeks
  FOR EACH ROW
  EXECUTE FUNCTION public.leagues_scoring_rules_valid();

CREATE TRIGGER trg_league_weeks_rules_3_valid_upd
  BEFORE UPDATE ON league_weeks
  FOR EACH ROW
  WHEN (NEW.scoring_rules_snapshot IS DISTINCT FROM OLD.scoring_rules_snapshot)
  EXECUTE FUNCTION public.leagues_scoring_rules_valid();

ALTER TABLE league_weeks ENABLE ALWAYS TRIGGER trg_league_weeks_rules_1_open;
ALTER TABLE league_weeks ENABLE ALWAYS TRIGGER trg_league_weeks_rules_2_guard;
ALTER TABLE league_weeks ENABLE ALWAYS TRIGGER trg_league_weeks_rules_3_valid_ins;
ALTER TABLE league_weeks ENABLE ALWAYS TRIGGER trg_league_weeks_rules_3_valid_upd;

-- ---------------------------------------------------------------------------
-- 4. THE BACKFILL (see the banner's §4)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_weeks_rules_backfill_internal(p_apply BOOLEAN DEFAULT TRUE)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_lw          RECORD;
  v_ch          RECORD;
  v_n           INTEGER;
  v_rules       JSONB;
  v_system      UUID;
  v_action      UUID;
  v_ambig       TEXT;
  v_unrec       TEXT;
  v_status_at   TEXT;
  v_new_rules   JSONB;
  v_is_template BOOLEAN;
  v_cnt         INTEGER;
  v_considered  INTEGER := 0;
  v_set         INTEGER := 0;
  v_weeks       JSONB := '[]'::jsonb;
  v_ambiguous   JSONB := '[]'::jsonb;
  v_unrecoverable JSONB := '[]'::jsonb;
BEGIN
  FOR v_lw IN
    SELECT lw.id, lw.league_id, lw.season, lw.week, lw.status,
           l.scoring_rules_snapshot AS league_rules, l.scoring_system_id AS league_system
    FROM public.league_weeks lw
    JOIN public.leagues l ON l.id = lw.league_id
    WHERE lw.status <> 'upcoming' AND lw.scoring_rules_snapshot IS NULL
    ORDER BY lw.league_id, lw.season, lw.week
    FOR UPDATE OF lw
  LOOP
    v_considered := v_considered + 1;
    v_n := 0; v_rules := NULL; v_system := NULL; v_action := NULL; v_ambig := NULL; v_unrec := NULL;

    -- The league's LANDED scoring changes of this season, oldest first, from
    -- the verb's own ledger (never commissioner_actions — see the banner).
    FOR v_ch IN
      SELECT s.result,
             (s.result ->> 'commissioner_action_id')::uuid                   AS receipt,
             (s.result #>> '{previous_value}')::uuid                         AS before_sys,
             (s.result #>> '{value}')::uuid                                  AS after_sys,
             COALESCE((s.result ->> 'rescore_requested')::boolean, FALSE)    AS rescore,
             row_number() OVER w                                             AS rn,
             count(*) OVER ()                                                AS total
      FROM public.commish_setting_actions s
      WHERE s.league_id = v_lw.league_id
        AND s.setting_key = 'scoring_system_id'
        AND s.result ->> 'no_changes' = 'false'
        AND (s.result ->> 'season')::int = v_lw.season
      WINDOW w AS (ORDER BY (s.result ->> 'evaluated_at')::timestamptz, s.created_at, s.id)
      ORDER BY (s.result ->> 'evaluated_at')::timestamptz, s.created_at, s.id
    LOOP
      v_n := v_n + 1;
      IF v_n = 1 THEN
        -- The rules in force BEFORE the first change: that change's previous system.
        SELECT s.rules, s.is_template INTO v_rules, v_is_template
        FROM public.scoring_systems s WHERE s.id = v_ch.before_sys;
        IF NOT FOUND THEN
          v_rules := NULL;
          v_unrec := 'the scoring system in force before the first change (' || COALESCE(v_ch.before_sys::text, 'none')
            || ') cannot be read, and the week was scored under it';
        ELSE
          v_system := v_ch.before_sys;
          IF NOT v_is_template THEN
            v_ambig := 'the rules in force before the first change come from a non-template scoring system ('
              || v_ch.before_sys || ') whose row its owner can still edit (105) — read as it stands today, exact only if unedited since the draft';
          END IF;
        END IF;
      END IF;

      -- The week's status when THIS change landed, from the verb's own document.
      v_status_at := CASE
        WHEN COALESCE(v_ch.result -> 'consequences' -> 'final_weeks', '[]'::jsonb) @> to_jsonb(v_lw.week) THEN 'final'
        ELSE COALESCE((SELECT x ->> 'status'
                       FROM jsonb_array_elements(COALESCE(v_ch.result -> 'consequences' -> 'open_weeks', '[]'::jsonb)) x
                       WHERE (x ->> 'week')::int = v_lw.week
                       LIMIT 1), 'upcoming') END;
      CONTINUE WHEN v_status_at = 'final';   -- a final week is untouched by a later change

      -- The rules this change froze: the LAST change's are exactly the league's
      -- current snapshot; an earlier one's are its template's row.
      IF v_ch.rn = v_ch.total THEN
        v_new_rules := v_lw.league_rules;
        IF v_lw.league_system IS DISTINCT FROM v_ch.after_sys THEN
          v_new_rules := NULL;   -- the ledger and the league disagree: never guess
        END IF;
      ELSE
        SELECT s.rules INTO v_new_rules FROM public.scoring_systems s WHERE s.id = v_ch.after_sys;
        IF NOT FOUND THEN v_new_rules := NULL; END IF;
      END IF;
      IF v_new_rules IS NULL THEN
        v_rules := NULL; v_ambig := NULL;
        v_unrec := 'the rules of change ' || COALESCE(v_ch.receipt::text, '?') || ' (to ' || COALESCE(v_ch.after_sys::text, 'none')
          || ') cannot be read, and the week was scored under them';
        CONTINUE;
      END IF;

      IF v_status_at = 'upcoming'
         OR (v_ch.rescore AND EXISTS (
               SELECT 1 FROM jsonb_array_elements(COALESCE(v_ch.result -> 'consequences' -> 'rescored_weeks', '[]'::jsonb)) x
               WHERE (x ->> 'week')::int = v_lw.week)) THEN
        -- EXACT: the week opened after this change, or this change re-scored it whole.
        v_ambig := NULL; v_unrec := NULL;
      ELSE
        -- MIXED: live / correction_window when it landed, not re-scored.
        v_unrec := NULL;
        v_ambig := 'week ' || v_lw.week || ' was ' || v_status_at || ' when scoring change ' || COALESCE(v_ch.receipt::text, '?')
          || ' (' || COALESCE(v_ch.before_sys::text, 'none') || ' -> ' || v_ch.after_sys
          || ') landed without re-scoring it: teams scored again afterwards took the new rules, the rest kept the old — stored as the NEWER rules (the ones every later score of the week used); the nightly reconcile names any team that kept the older ones';
      END IF;
      v_rules  := v_new_rules;
      v_system := v_ch.after_sys;
      v_action := (SELECT a.id FROM public.commissioner_actions a WHERE a.id = v_ch.receipt);
    END LOOP;

    IF v_n = 0 THEN
      -- No change this season: the league's snapshot IS the draft-start freeze.
      v_rules := v_lw.league_rules; v_system := v_lw.league_system;
      IF v_rules IS NULL THEN
        v_unrec := 'the league has no frozen scoring snapshot and no scoring change — nothing to copy';
      END IF;
    END IF;

    IF v_rules IS NULL THEN
      v_unrecoverable := v_unrecoverable || jsonb_build_object(
        'league_id', v_lw.league_id, 'season', v_lw.season, 'week', v_lw.week, 'status', v_lw.status,
        'why', COALESCE(v_unrec, 'no rules could be read'));
      CONTINUE;
    END IF;

    IF p_apply THEN
      UPDATE public.league_weeks
      SET scoring_rules_snapshot  = v_rules,
          scoring_system_id       = v_system,
          scoring_rules_source    = CASE WHEN v_ambig IS NULL THEN 'backfill' ELSE 'backfill_ambiguous' END,
          scoring_rules_action_id = v_action
      WHERE id = v_lw.id AND scoring_rules_snapshot IS NULL;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'league_weeks_rules_backfill: week % of league % touched % rows, expected 1', v_lw.week, v_lw.league_id, v_cnt
          USING ERRCODE = 'P0001';
      END IF;
      v_set := v_set + 1;
    END IF;
    v_weeks := v_weeks || jsonb_build_object(
      'league_id', v_lw.league_id, 'season', v_lw.season, 'week', v_lw.week, 'status', v_lw.status,
      'scoring_system_id', v_system, 'action_id', v_action,
      'source', CASE WHEN v_ambig IS NULL THEN 'backfill' ELSE 'backfill_ambiguous' END);
    IF v_ambig IS NOT NULL THEN
      v_ambiguous := v_ambiguous || jsonb_build_object(
        'league_id', v_lw.league_id, 'season', v_lw.season, 'week', v_lw.week, 'status', v_lw.status,
        'scoring_system_id', v_system, 'why', v_ambig);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'applied',            p_apply,
    'weeks_considered',   v_considered,
    'weeks_set',          v_set,
    'exact',              jsonb_array_length(v_weeks) - jsonb_array_length(v_ambiguous),
    'ambiguous',          v_ambiguous,
    'unrecoverable',      v_unrecoverable,
    'weeks',              v_weeks);
END;
$$;

REVOKE EXECUTE ON FUNCTION league_weeks_rules_backfill_internal(BOOLEAN)
  FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_report JSONB;
  v_row    JSONB;
BEGIN
  v_report := public.league_weeks_rules_backfill_internal(TRUE);
  RAISE NOTICE '144 backfill (F397): % opened week(s) without rules; % given the rules they were scored with — % exact, % AMBIGUOUS; % UNRECOVERABLE (left without rules — every reader refuses them by name)',
    v_report ->> 'weeks_considered', v_report ->> 'weeks_set', v_report ->> 'exact',
    jsonb_array_length(v_report -> 'ambiguous'), jsonb_array_length(v_report -> 'unrecoverable');
  FOR v_row IN SELECT x FROM jsonb_array_elements(v_report -> 'ambiguous') x LOOP
    RAISE NOTICE '144 backfill AMBIGUOUS: league % season % week % (%): %',
      v_row ->> 'league_id', v_row ->> 'season', v_row ->> 'week', v_row ->> 'status', v_row ->> 'why';
  END LOOP;
  FOR v_row IN SELECT x FROM jsonb_array_elements(v_report -> 'unrecoverable') x LOOP
    RAISE NOTICE '144 backfill UNRECOVERABLE: league % season % week % (%): %',
      v_row ->> 'league_id', v_row ->> 'season', v_row ->> 'week', v_row ->> 'status', v_row ->> 'why';
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. commish_change_setting_internal — CREATE OR REPLACE against 141:133-612's
--    FILE TEXT, NINE HUNKS (see the banner's §5 D137 PROVENANCE).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_change_setting_internal(
  p_league_id UUID,
  p_key       TEXT,
  p_value     JSONB,
  p_rescore   BOOLEAN,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league        public.leagues;
  v_found         BOOLEAN;
  v_reason        TEXT;
  v_key           TEXT;
  v_policy        JSONB;
  v_class         TEXT;
  v_storage       TEXT;
  v_rescore       BOOLEAN := COALESCE(p_rescore, FALSE);
  v_in_season     BOOLEAN;
  v_before        JSONB;
  v_canon         JSONB;
  v_no_changes    BOOLEAN;
  v_bypassed      JSONB;
  v_bypassed_why  TEXT;
  v_audit_id      UUID;
  v_message       TEXT;
  v_result        JSONB;
  v_cnt           INTEGER;
  -- scoring
  v_new_scoring   UUID;
  v_new_rules     JSONB;
  v_snapshot_refrozen BOOLEAN := FALSE;
  v_snapshot_why  TEXT;
  v_final_weeks   JSONB := '[]'::jsonb;
  v_open_weeks    JSONB := '[]'::jsonb;
  v_rescored      JSONB := '[]'::jsonb;
  v_rescore_done  BOOLEAN := FALSE;
  v_rescore_why   TEXT;
  v_skipped_final JSONB := '[]'::jsonb;   -- 141 / Q64 as ruled: the final weeks rescore left alone, NAMED
  v_skipped_why   TEXT;
  -- 144 / Q69 as ruled (L.E1.27): the correction-window weeks are kept too,
  -- and a week's stored rules (F397) move only for the LIVE week a rescore re-queues.
  v_cw_weeks      JSONB := '[]'::jsonb;
  v_live_weeks    JSONB := '[]'::jsonb;
  v_skipped_cw    JSONB := '[]'::jsonb;
  v_kept_words    TEXT;
  v_kept_count    INTEGER := 0;
  v_rules_rewritten JSONB := '[]'::jsonb;
  v_score_stale   BOOLEAN := FALSE;
  v_stale_why     TEXT;
  v_wk            RECORD;
  v_enq           INTEGER;
  v_not_enq       JSONB;
  v_ir_keys       TEXT[];
  -- faab
  v_faab_reseeded BOOLEAN := FALSE;
  v_faab_why      TEXT;
  v_faab_off      INTEGER := 0;
  -- roster
  v_not_refit     INTEGER := 0;
  v_consequences  JSONB;
BEGIN
  -- (0) SHAPE. A malformed call is refused BY NAME and never answered with
  --     `no_changes: true` (126's rule; §4 rule 15).
  IF NULLIF(btrim(COALESCE(p_key, ''), E' \t\r\n'), '') IS NULL THEN
    RAISE EXCEPTION 'commish_change_setting: p_key is required — an override that names no setting is not an override'
      USING ERRCODE = '22023';
  END IF;
  v_key := btrim(p_key, E' \t\r\n');
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'commish_change_setting: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8). Every gate
  --     below reads THIS row, never a pre-lock read (R1036's lesson).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — commissioner only, in-body, ONE no-leak 42501 covering "no
  --     such league" and "not a commissioner" alike (D336 part 5).
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_change_setting: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2), AFTER auth and BEFORE every business gate
  --     (`123:602-609`), so a retry replays byte-identically even when the
  --     league has since moved on.
  SELECT a.result INTO v_result
  FROM public.commish_setting_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  -- (4) THE REASON, OPTIONAL under Q66 (migration 131 / L.E1.15, F362;
  --     spec v2.16.41 §10.3 / §15.4): NORMALISED, never refused — absent or
  --     whitespace-only in the explicit class (R745) ⇒ NULL (130 §0 stores
  --     it); otherwise trimmed, bounded at 500 below (NULL-safe as written).
  --     F343 as amended by 131: the client may send nothing.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'commish_change_setting: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) THE KEY, against the policy table. An unknown key is refused BY NAME:
  --     this verb writes no key the catalog does not define.
  v_policy := public.commish_setting_policy(v_key);
  IF v_policy IS NULL THEN
    RAISE EXCEPTION 'commish_change_setting: % is not a league setting this verb knows — the catalog is leagueSettingsSchema (§7.3); no undefined key is ever written into leagues.settings', v_key
      USING ERRCODE = '22023';
  END IF;
  v_class   := v_policy ->> 'class';
  v_storage := v_policy ->> 'storage';
  v_in_season := v_league.status NOT IN ('setup', 'scheduled');

  -- (6) THE PER-KEY POLICY — refused-by-name classes (the banner's table).
  IF v_class = 'refused' THEN
    RAISE EXCEPTION 'commish_change_setting: % cannot be changed through this verb (league % is %). WHY: %',
      v_key, p_league_id, v_league.status, v_policy ->> 'refused_why'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_class = 'bracket' AND v_league.status IN ('playoffs', 'complete') THEN
    RAISE EXCEPTION 'commish_change_setting: % is REFUSED in-season once the bracket exists (league % is %). WHY: %',
      v_key, p_league_id, v_league.status, v_policy ->> 'refused_why'
      USING ERRCODE = 'P0001';
  END IF;

  -- (7) `rescore` has exactly one subject. On any other key the flag is a
  --     malformed call, refused by name — never accepted and ignored.
  IF v_rescore AND v_key <> 'scoring_system_id' THEN
    RAISE EXCEPTION 'commish_change_setting: rescore applies only to scoring_system_id — % has no stored score to recompute; resubmit without rescore',
      v_key
      USING ERRCODE = '22023';
  END IF;

  -- (8) THE VALUE, canonicalised (item 4) and range-checked against the
  --     LOCKED row; the CURRENT value read from the same row in the same
  --     canonical form.
  v_canon := public.commish_setting_canon_internal(v_key, p_value, v_league);
  IF v_storage = 'column' THEN
    v_before := to_jsonb(v_league) -> v_key;          -- typed column; uuid renders as a string
  ELSE
    v_before := COALESCE(v_league.settings -> v_key, 'null'::jsonb);  -- absent blob key = null
  END IF;

  -- (8b) scoring_system_id: 118 step 5's attachable scope, in meaning — a
  --      TEMPLATE, or the league's own currently-referenced row (the no-op).
  --      104's wall 3 (`trg_leagues_scoring_reference_guard`) additionally
  --      validates the referenced rules at the UPDATE; it is ridden, not
  --      duplicated.
  IF v_key = 'scoring_system_id' THEN
    v_new_scoring := (v_canon #>> '{}')::uuid;
    IF v_new_scoring IS DISTINCT FROM v_league.scoring_system_id THEN
      SELECT s.rules INTO v_new_rules
      FROM public.scoring_systems s
      WHERE s.id = v_new_scoring AND s.is_template = TRUE AND s.owner_id IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'commish_change_setting: scoring_system_id % must reference one of the scoring templates, or the league''s own current custom scoring system — personal scoring systems and other leagues'' systems cannot be attached (§7.3.8 v2.11, §7.3.3.1; 118 step 5''s scope)',
          v_new_scoring
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  -- (9) THE NO-OP, DETECTED BY VALUE — jsonb equality over the canonical
  --     form of the ONE dimension this verb changes (D336 part 3; `123:1016`).
  --     `2` and `"2"` both canonicalise to `2`, so a re-send in a different
  --     JSON type is a no-op too.
  v_no_changes := (v_canon = v_before);

  -- (10) THE LIFTED GATE, NAMED. Past `scheduled`, 118 step 3 would have
  --      refused this write (`118:2489-2497`); that is the rule this verb
  --      walks past, and the receipt says so (standing rule (g)'s shape).
  IF v_in_season THEN
    v_bypassed     := jsonb_build_array('settings_status_gate');
    v_bypassed_why := 'update_league_settings refuses every status past scheduled (118:2489-2497, "settings are locked once the draft starts; post-draft changes are audited commissioner overrides (M6) (§7.3)"); this verb IS that override (§7.3 header: "commissioner-override-only … allowed but logged and warned")';
  ELSE
    v_bypassed     := '[]'::jsonb;
    v_bypassed_why := 'nothing to bypass — in setup/scheduled the document path (update_league_settings) admits this key too; this verb was used for its per-key receipt';
  END IF;

  -- (11) THE SCORING CONSEQUENCES are computed BEFORE the write so the
  --      report at (12c) describes the weeks as they were.
  IF v_key = 'scoring_system_id' AND NOT v_no_changes THEN
    SELECT COALESCE(jsonb_agg(lw.week ORDER BY lw.week), '[]'::jsonb) INTO v_final_weeks
    FROM public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.status = 'final';
    SELECT COALESCE(jsonb_agg(jsonb_build_object('week', lw.week, 'status', lw.status) ORDER BY lw.week), '[]'::jsonb) INTO v_open_weeks
    FROM public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.status IN ('live', 'correction_window');
    -- 144 / Q69: the two halves of "open", split — a CORRECTION-WINDOW week
    -- (members see it as "Final (pending corrections)") is KEPT like a final
    -- one; only the LIVE week is re-scored ("this week and later", Q64).
    SELECT COALESCE(jsonb_agg(lw.week ORDER BY lw.week), '[]'::jsonb) INTO v_cw_weeks
    FROM public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.status = 'correction_window';
    SELECT COALESCE(jsonb_agg(lw.week ORDER BY lw.week), '[]'::jsonb) INTO v_live_weeks
    FROM public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.status = 'live';
    -- Every week already under way, in plain words ("week 1 (final) and
    -- week 2 (final, pending stat corrections)") — the post and the whys.
    v_kept_count := jsonb_array_length(v_final_weeks) + jsonb_array_length(v_cw_weeks);
    v_kept_words := NULLIF(concat_ws(' and ',
      public.league_week_list_words_internal(v_final_weeks) || ' (final)',
      public.league_week_list_words_internal(v_cw_weeks) || ' (final, pending stat corrections)'), '');

    -- (11b) ── Q64 AS RULED ── (Chris, 2026-09-27, option 1, going forward
    --       only: "The new rule applies to this week and later. Finished
    --       weeks keep their original scores and results."; spec §10.1
    --       v2.16.42: "a scoring change applies to open and future weeks; a
    --       final week is never re-scored"). Migration 141 (L.E1.24, F382)
    --       REPLACED the whole-call refusal that stood here: a FINAL week is
    --       SKIPPED and NAMED, never refused, and the change lands. Nothing
    --       below writes a final week — (12c)'s loop reads live /
    --       correction_window only, and the scoring worker refuses a final
    --       week at its door (`score_write_week_batch` → week_final,
    --       119:566-568). `reopen_week` is NOT built (Q64: not wanted).
    -- ── Q69 AS RULED ── (Chris, 2026-09-27, option (b): "Q69 keep last
    --       week's scores"). Migration 144 (L.E1.27, F404) widens the kept
    --       set from FINAL weeks to every FINISHED week — final AND in its
    --       stat-correction window — and names each with its status. Only the
    --       LIVE week is re-scored (12c); each kept week goes on being scored
    --       under ITS OWN stored rules by every later stat correction (F397,
    --       `league_weeks.scoring_rules_snapshot`), so keeping it is honest.
    IF v_rescore AND v_kept_count > 0 THEN
      v_skipped_final := v_final_weeks;
      v_skipped_cw    := v_cw_weeks;
      v_skipped_why   := 'finished_weeks_not_rescored — ' || v_kept_words
        || CASE WHEN v_kept_count = 1 THEN ' keeps its scores and results' ELSE ' keep their scores and results' END
        || '; the new scoring applies to '
        || CASE WHEN v_live_weeks <> '[]'::jsonb
             THEN public.league_week_list_words_internal(v_live_weeks)
                  || ' (being played now — re-scored under it) and to every later week (scored under it when it opens)'
             ELSE 'every later week (scored under it when it opens) — no week is being played right now' END;
    END IF;
  END IF;

  IF NOT v_no_changes THEN
    -- (12a) THE STATE WRITE — ONE key, read-modify-write (D347). Typed
    --       columns each by name; blob keys through `settings || {key: v}`
    --       so every OTHER key is byte-untouched. `updated_at = p_at`.
    CASE v_key
      WHEN 'waiver_type' THEN
        UPDATE public.leagues SET waiver_type = v_canon #>> '{}', updated_at = p_at WHERE id = p_league_id;
      WHEN 'faab_budget' THEN
        UPDATE public.leagues SET faab_budget = (v_canon #>> '{}')::int, updated_at = p_at WHERE id = p_league_id;
      WHEN 'trade_review' THEN
        UPDATE public.leagues SET trade_review = v_canon #>> '{}', updated_at = p_at WHERE id = p_league_id;
      WHEN 'trade_deadline_week' THEN
        UPDATE public.leagues SET trade_deadline_week = (v_canon #>> '{}')::int, updated_at = p_at WHERE id = p_league_id;
      WHEN 'roster_settings' THEN
        UPDATE public.leagues SET roster_settings = v_canon, updated_at = p_at WHERE id = p_league_id;
      WHEN 'playoff_teams' THEN
        UPDATE public.leagues SET playoff_teams = (v_canon #>> '{}')::int, updated_at = p_at WHERE id = p_league_id;
      WHEN 'scoring_system_id' THEN
        -- RE-DECISION 2: the reference and the re-frozen snapshot move in ONE
        -- statement (§7.3.3 — "on any commissioner scoring change"); a NULL
        -- snapshot stays NULL, exactly as 118:2586-2590 leaves it (draft_start
        -- is the freezer pre-draft). 104's two walls fire on this UPDATE.
        UPDATE public.leagues
        SET scoring_system_id      = v_new_scoring,
            scoring_rules_snapshot = CASE WHEN scoring_rules_snapshot IS NOT NULL THEN v_new_rules ELSE scoring_rules_snapshot END,
            updated_at             = p_at
        WHERE id = p_league_id;
        v_snapshot_refrozen := (v_league.scoring_rules_snapshot IS NOT NULL);
        v_snapshot_why := CASE WHEN v_snapshot_refrozen
          THEN 'scoring_rules_snapshot re-frozen from the new system''s rules in the same statement as the reference (§7.3.3, never-weaken; 118:2585-2590''s rule kept)'
          ELSE 'scoring_rules_snapshot is NULL (pre-draft) and stays NULL — draft_start freezes it (059/110), exactly as 118:2586 leaves it' END;
      ELSE
        UPDATE public.leagues
        SET settings   = settings || jsonb_build_object(v_key, v_canon),
            updated_at = p_at
        WHERE id = p_league_id;
    END CASE;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'commish_change_setting: the write touched % rows, expected exactly 1 (league %)', v_cnt, p_league_id
        USING ERRCODE = 'P0001';
    END IF;

    -- (12b) RE-DECISION 1 — THE FAAB RE-SEED, narrowed to the precondition
    --       118's own comment names: pre-draft ONLY. In-season every balance
    --       is byte-unchanged and the document says so with a MEASURED count.
    IF v_key = 'faab_budget' THEN
      IF NOT v_in_season THEN
        UPDATE public.league_members
        SET faab_balance = (v_canon #>> '{}')::int
        WHERE league_id = p_league_id;
        v_faab_reseeded := TRUE;
        v_faab_why := 'league is ' || v_league.status || ' (pre-draft): every seat re-seeded to the new budget so all balances match the create/join/claim seeding (§12.2 / D70 — 118:2617-2621''s rule, kept for the state it was written for)';
      ELSE
        SELECT count(*)::int INTO v_faab_off
        FROM public.league_members m
        WHERE m.league_id = p_league_id AND m.team_id IS NOT NULL
          AND m.faab_balance IS DISTINCT FROM (v_canon #>> '{}')::int;
        v_faab_why := 'league is ' || v_league.status || ' (in-season): faab_balance is the ledger of each team''s spend and is BYTE-UNCHANGED for every seat — re-seeding would wipe every team''s spend (118:2617-2621 was safe only behind the status gate this verb lifts). ' || v_faab_off || ' seat(s) now carry a balance that differs from the new budget; adjusting ONE team''s balance is commish_edit_faab (§15.4:1698 — M5, F340)';
      END IF;
    END IF;

    -- (12c) THE RESCORE — the LIVE week re-queued when asked (144 / Q69: a
    --       correction-window week is kept like a final one); the stored
    --       scores of every week left alone when not, and NAMED either way.
    IF v_key = 'scoring_system_id' THEN
      IF v_rescore THEN
        -- A FINAL week is never in this loop: (11b) skipped it by name (141).
        -- Nor, from 144 (Q69), a CORRECTION-WINDOW week: the LIVE week only.
        SELECT COALESCE(array_agg(s ->> 'key'), ARRAY[]::text[]) INTO v_ir_keys
        FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) s;
        FOR v_wk IN
          SELECT lw.week, lw.status
          FROM public.league_weeks lw
          WHERE lw.league_id = p_league_id AND lw.season = v_league.season
            AND lw.status = 'live'
          ORDER BY lw.week
        LOOP
          -- Starters of every team-week, derived from slot_map the way the
          -- worker derives them (`startersOf`: every non-empty value whose
          -- slot key's base is not an IR key), stamped with the player's own
          -- MIN(player_stats.updated_at) — never now() (123's SCORING rule).
          INSERT INTO public.score_fanout (season, week, player_id, enqueued_at)
          SELECT v_league.season, v_wk.week, ps.player_id, min(ps.updated_at)
          FROM public.team_lineups tl
          JOIN public.teams t ON t.id = tl.team_id AND t.league_id = p_league_id
          JOIN LATERAL jsonb_each_text(COALESCE(tl.slot_map, '{}'::jsonb)) sm(slot, pid) ON TRUE
          JOIN public.player_stats ps
            ON ps.season = v_league.season AND ps.week = v_wk.week AND ps.player_id = sm.pid
           AND ps.updated_at IS NOT NULL
          WHERE tl.season = v_league.season AND tl.week = v_wk.week
            AND sm.pid IS NOT NULL AND sm.pid <> ''
            AND NOT (split_part(sm.slot, ':', 1) = ANY (v_ir_keys))
          GROUP BY ps.player_id
          ON CONFLICT (season, week, player_id) DO NOTHING;   -- never re-stamp a healthy row
          -- "a claimable queue row EXISTS for him" (123:1088-1092's meaning),
          -- and the starters the INSERT could NOT queue, named (R968).
          SELECT count(DISTINCT sm.pid)::int INTO v_enq
          FROM public.team_lineups tl
          JOIN public.teams t ON t.id = tl.team_id AND t.league_id = p_league_id
          JOIN LATERAL jsonb_each_text(COALESCE(tl.slot_map, '{}'::jsonb)) sm(slot, pid) ON TRUE
          WHERE tl.season = v_league.season AND tl.week = v_wk.week
            AND sm.pid IS NOT NULL AND sm.pid <> ''
            AND NOT (split_part(sm.slot, ':', 1) = ANY (v_ir_keys))
            AND EXISTS (SELECT 1 FROM public.score_fanout f
                        WHERE f.season = v_league.season AND f.week = v_wk.week AND f.player_id = sm.pid);
          SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id', x.pid, 'why',
                   CASE WHEN EXISTS (SELECT 1 FROM public.player_stats ps
                                     WHERE ps.season = v_league.season AND ps.week = v_wk.week AND ps.player_id = x.pid)
                        THEN 'stats_unstamped' ELSE 'no_stat_row' END) ORDER BY x.pid), '[]'::jsonb)
          INTO v_not_enq
          FROM (SELECT DISTINCT sm.pid
                FROM public.team_lineups tl
                JOIN public.teams t ON t.id = tl.team_id AND t.league_id = p_league_id
                JOIN LATERAL jsonb_each_text(COALESCE(tl.slot_map, '{}'::jsonb)) sm(slot, pid) ON TRUE
                WHERE tl.season = v_league.season AND tl.week = v_wk.week
                  AND sm.pid IS NOT NULL AND sm.pid <> ''
                  AND NOT (split_part(sm.slot, ':', 1) = ANY (v_ir_keys))
                  AND NOT EXISTS (SELECT 1 FROM public.score_fanout f
                                  WHERE f.season = v_league.season AND f.week = v_wk.week AND f.player_id = sm.pid)) x;
          v_rescored := v_rescored || jsonb_build_object(
            'week', v_wk.week, 'status', v_wk.status,
            'starters_enqueued', v_enq, 'score_not_enqueued', v_not_enq);
        END LOOP;
        IF jsonb_array_length(v_rescored) > 0 THEN
          v_rescore_done := TRUE;
          v_rescore_why  := NULL;
          -- 144 / F397: exactly these LIVE weeks take the new rules — written
          -- at (13b), stamped with this change's receipt (the count asserted).
          v_rules_rewritten := v_live_weeks;
        ELSE
          v_rescore_done := FALSE;
          v_rescore_why  := CASE WHEN v_kept_count > 0
            THEN 'no_live_week — no week is being played right now, so nothing is re-scored: ' || v_kept_words
                 || CASE WHEN v_kept_count = 1 THEN ' keeps its scores and results' ELSE ' keep their scores and results' END
                 || ', and every later week is scored under the new scoring when it opens'
            ELSE 'nothing_scored_yet — this season has no live or correction_window week and no final week, so there is no stored score to recompute; the re-frozen snapshot governs every week from here' END;
        END IF;
      ELSE
        -- 144 / F397: with rescore NOT asked for, no started week's stored
        -- rules change — each goes on being scored (live polls AND stat
        -- corrections) under the rules it opened with, and the new rules
        -- start with the next week to open. So there is no MIXED week any
        -- more: 141's `score_stale` / 'snapshot_changed_without_rescore'
        -- described the worker reading the league's re-frozen column for an
        -- already-scored week, which it no longer does. `score_stale` stays
        -- FALSE (the field is kept — a replayed pre-144 document carries it).
        v_rescore_done := FALSE;
        v_rescore_why  := 'not_requested — rescore was not asked for, so no week already under way changes: '
          || COALESCE(NULLIF(concat_ws(' and ', v_kept_words,
               public.league_week_list_words_internal(v_live_weeks) || ' (being played now)'), ''), 'no week has started yet')
          || CASE WHEN v_kept_count + jsonb_array_length(v_live_weeks) = 0 THEN ''
                  WHEN v_kept_count + jsonb_array_length(v_live_weeks) = 1 THEN ' keeps the scoring it started with'
                  ELSE ' keep the scoring they started with' END
          || ', and the new scoring starts with the next week to open';
      END IF;
    END IF;

    -- (12d) ROSTER SHAPE: nothing re-fits a stored slot_map. Counted, so the
    --       §7.3 header's "warned" is a number.
    IF v_key = 'roster_settings' THEN
      SELECT count(*)::int INTO v_not_refit
      FROM public.team_lineups tl
      JOIN public.teams t ON t.id = tl.team_id AND t.league_id = p_league_id
      JOIN public.league_weeks lw ON lw.league_id = p_league_id AND lw.season = tl.season AND lw.week = tl.week
      WHERE tl.season = v_league.season AND lw.status IN ('upcoming', 'live');
    END IF;

    v_consequences := jsonb_build_object(
      'snapshot_refrozen',         v_snapshot_refrozen,
      'snapshot_why',              v_snapshot_why,
      'final_weeks',               v_final_weeks,
      'open_weeks',                v_open_weeks,
      'rescore_requested',         v_rescore,
      'rescore_performed',         v_rescore_done,
      'rescore_not_performed_why', v_rescore_why,
      'rescored_weeks',            v_rescored,
      'rescore_skipped_final_weeks',     v_skipped_final,   -- 141 / Q64 as ruled
      'rescore_skipped_correction_window_weeks', v_skipped_cw,  -- 144 / Q69 as ruled
      'rescore_skipped_final_weeks_why', v_skipped_why,     -- 144: names BOTH kept kinds
      'week_rules_rewritten',      v_rules_rewritten,       -- 144 / F397: the live week(s) whose stored rules are now the new ones
      'week_rules_why',            CASE WHEN v_key = 'scoring_system_id' THEN
                                     CASE WHEN v_rules_rewritten <> '[]'::jsonb
                                       THEN 'the week being played now takes the new rules (its league_weeks.scoring_rules_snapshot is re-written with this receipt); every week already finished keeps the rules it was played with, and every later week takes the new rules when it opens (F397)'
                                       ELSE 'no started week''s rules changed — each keeps the rules it was played with (league_weeks.scoring_rules_snapshot), and the next week to open takes the new rules (F397)' END END,
      'rescore_upcoming_weeks_why', CASE WHEN v_rescore THEN
                                     'upcoming weeks are not queued — nothing has been scored for them; each is scored under the new scoring when it opens' END,
      'score_stale',               v_score_stale,
      'score_stale_reason',        v_stale_why,
      'faab_reseeded',             v_faab_reseeded,
      'faab_reseed_why',           v_faab_why,
      'faab_seats_off_budget',     v_faab_off,
      'lineups_not_refit',         v_not_refit,
      'lineups_not_refit_why',     CASE WHEN v_key = 'roster_settings' THEN
                                     'no stored team_lineups.slot_map is re-fit by a roster change; the next set_lineup / autopilot pass fits against the new shape (§7.3 header: "allowed but logged and warned") — the count is the open/upcoming lineup rows of this season' END);

    -- (13) D336 part 2 — EXACTLY ONE audit row, through the ONE shared
    --      logging helper, INSIDE the no-op guard and AFTER the state write.
    --      §5's contractual shape: target_type 'setting', target_id = the
    --      key, before/after = {<key>: value} — THAT KEY ALONE.
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'change_setting', 'setting', v_key, v_reason,
      jsonb_build_object(v_key, v_before),
      jsonb_build_object(v_key, v_canon),
      jsonb_build_object(
        'verb',                      'commish_change_setting',
        'season',                    v_league.season,
        'action_id',                 p_action_id,
        'league_status',             v_league.status,
        'storage',                   v_storage,
        'policy_class',              v_class,
        'bypassed',                  v_bypassed,
        -- §5's three contractual extras for this verb:
        'rescore_requested',         v_rescore,
        'rescore_performed',         v_rescore_done,
        'rescore_not_performed_why', v_rescore_why,
        'rescore_skipped_final_weeks', v_skipped_final,        -- 141 / Q64 as ruled
        'rescore_skipped_correction_window_weeks', v_skipped_cw,  -- 144 / Q69 as ruled
        'consequences',              v_consequences),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_change_setting: the audit row was not written — refusing to let the change stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- (13b) 144 / F397 — THE LIVE WEEK'S STORED RULES. A rescore re-queued
    --       the live week(s) at (12c); in the same transaction, under the
    --       same league lock (league_week_advance takes it first, so no week
    --       changes status in between), those weeks' stored rules become the
    --       new ones, stamped with THIS receipt. Written after (13) only so
    --       the row can carry the receipt id; nothing can observe the queue
    --       rows without the rules — both commit together. With rescore off,
    --       or with no live week, NO opened week's rules move (144's guard
    --       trigger would refuse a finished week's anyway).
    IF v_rules_rewritten <> '[]'::jsonb THEN
      UPDATE public.league_weeks lw
      SET scoring_rules_snapshot  = v_new_rules,
          scoring_system_id       = v_new_scoring,
          scoring_rules_source    = 'rescore',
          scoring_rules_action_id = v_audit_id
      WHERE lw.league_id = p_league_id AND lw.season = v_league.season
        AND lw.status = 'live'
        AND lw.week IN (SELECT (x #>> '{}')::int FROM jsonb_array_elements(v_rules_rewritten) x);
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> jsonb_array_length(v_rules_rewritten) THEN
        RAISE EXCEPTION 'commish_change_setting: re-writing the live week(s) % rules touched % row(s), expected % — refusing to re-score a week that would go on being scored under its old rules (F397)',
          v_rules_rewritten, v_cnt, jsonb_array_length(v_rules_rewritten)
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- (14) §10.3: override system messages auto-post to league chat and
    --      CANNOT be disabled. The consequence is in the post, not only in
    --      the document (R971's shape).
    v_message := 'Setting ' || v_key || ' changed from ' || v_before::text || ' to ' || v_canon::text
      || ' by ' || public.draft_actor_name() || ' (commissioner override)'
      || CASE WHEN v_rescore_done THEN ' — ' || public.league_week_list_words_internal(v_live_weeks)
                                         || ' (being played now) will be re-scored under the new rules'
              WHEN v_score_stale THEN ' — stored scores were NOT recomputed'
              WHEN v_key = 'faab_budget' AND NOT v_faab_reseeded THEN ' — team balances unchanged'
              WHEN v_key = 'scoring_system_id' AND NOT v_rescore   -- 144 / F397: said in plain words
                   AND v_kept_count + jsonb_array_length(v_live_weeks) > 0
                THEN ' — weeks already started keep the scoring they started with; the new scoring starts with the next week'
              ELSE '' END
      || CASE WHEN v_skipped_final <> '[]'::jsonb OR v_skipped_cw <> '[]'::jsonb   -- 141 / 144: never a quiet partial
              THEN CASE WHEN v_rescore_done THEN '; ' ELSE ' — ' END
                   || v_kept_words
                   || CASE WHEN v_kept_count = 1 THEN ' keeps its scores and results' ELSE ' keep their scores and results' END
              ELSE '' END
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional, never 'reason: <NULL>'
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   'commish_change_setting',
    'action_type',            'change_setting',
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'league_status',          v_league.status,
    'key',                    v_key,
    'storage',                v_storage,
    'policy_class',           v_class,
    'value',                  CASE WHEN v_no_changes THEN v_before ELSE v_canon END,
    'previous_value',         v_before,
    'requested_value',        v_canon,
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN
                                'value_already_set — the league already stored this exact value for ' || v_key || ' (compared as canonical jsonb, so 2 and "2" are the same value), so nothing was written and no receipt was issued (PROGRESS standing rule (b))' END,
    'commissioner_action_id', v_audit_id,            -- NULL on a no-op, and that is the point
    'bypassed',               v_bypassed,
    'bypassed_why',           v_bypassed_why,
    'rescore_requested',      v_rescore,
    'rescore_performed',      v_rescore_done,
    'rescore_not_performed_why', CASE WHEN v_no_changes AND v_rescore THEN
                                'no_changes — the scoring reference is already this system, so there is nothing to re-score'
                                ELSE v_rescore_why END,
    'rescore_skipped_final_weeks',     v_skipped_final,      -- 141 / Q64 as ruled: [] unless rescore skipped a final week
    'rescore_skipped_correction_window_weeks', v_skipped_cw, -- 144 / Q69 as ruled: [] unless rescore skipped a correction-window week
    'rescore_skipped_final_weeks_why', v_skipped_why,        -- NULL exactly when BOTH lists are []
    'consequences',           CASE WHEN v_no_changes THEN NULL ELSE v_consequences END,
    'reason',                 v_reason,
    'system_post',            v_message,             -- NULL on a no-op
    'evaluated_at',           p_at);

  -- The idempotency ledger row is written for a NO-OP TOO (`123:1259-1266`):
  -- an action_id is consumed by its submit whether or not anything moved.
  INSERT INTO public.commish_setting_actions (league_id, setting_key, action_id, actor_id, result)
  VALUES (p_league_id, v_key, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION commish_change_setting_internal(UUID, TEXT, JSONB, BOOLEAN, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;
