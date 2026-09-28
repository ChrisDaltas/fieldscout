-- ============================================================================
-- 154_one_start_per_week.sql — a player holds a STARTING slot for at most ONE
-- team per league-week, and a start the week keeps is never erased by a fix
-- (PROGRESS F441 + F445 + F442; task L.D2.15, FULL rigour — scoring
-- integrity: a player must never score for two teams in one week, and a
-- played starter must never be erased).
-- Spec §7.3.3 / §22.2 (a week is scored from THAT week's stored slot_map —
-- score-week-worker.ts `startersOf`), §11.2 (Q32's amendment: "if they are in
-- the lineup they are stuck in the lineup"; the Release bullet — Q78's
-- ceiling), §15.4 (the commissioner's lineup override); PROGRESS D411 (152:
-- lineups change from the first unfinished week; (7) a played starter who
-- left stays), D412(5) (153: after the ceiling no move changes the week's
-- stored lineups — a player of the unplayed game stays in the lineup that
-- started him), R1206 (152 §§4–5), R1208 / R1209 / R1210 / R1213 (the
-- reviews that filed F441 / F442 / F445), F440 (NOT changed here — below).
--
-- Numbering: measured at build time (D161) — `ls supabase/migrations | tail
-- -1` → 153_week_ceiling.sql, `ls supabase/tests | tail -1` →
-- 101_week_ceiling.sql; so 154 / pgTAP 102. NOT held: reaches production by
-- `npx supabase db push` only (push debt: 135–154).
--
-- THE DEFECTS (each reproduced by a reviewer; pgTAP 102 re-runs every probe).
--   (a) R1208 — `commish_edit_lineup_internal` (131, untouched by 152) could
--       START a player for his NEW team in a finished week that his old team
--       still starts him in (152 keeps the old start) ⇒ both lineups hold him
--       and the worker scores him twice.
--   (b) R1209 — its roster check REFUSED keeping that dropped-but-played
--       starter, and the editor never holds an unrostered player, so any
--       commissioner fix to that week silently erased his points.
--   (c) F445 (R1213) — in a league's FINAL week after the Wednesday ceiling
--       (153), a player of the UNPLAYED (postponed) game dropped and picked
--       up could be started by his new team the same week — through
--       `set_lineup`, the commissioner's editor, or `lineup_autopilot_
--       internal` (a force-add to an autopilot seat) ⇒ a double score when
--       the game is played; and when the OLD team re-saved its lineup, 152's
--       step (4b) opened his slot (he "had not played").
--   (d) F442 (R1210) — "has he played" was judged from `players.team`, so a
--       player released or traded after playing read as not-played and his
--       slot opened.
--
-- THE FIX — ONE RULE, ENFORCED WHERE EVERY WRITER CONVERGES.
--   §3 below: a BEFORE INSERT / UPDATE trigger on `team_lineups` refuses, BY
--   NAME, any write that puts a player into a STARTING slot of one team's
--   lineup while another team of the same league holds him in a starting slot
--   for the same season-week. "Starting slot" is the score worker's own
--   definition (`startersOf`): every `slot_map` value whose key is not an IR
--   spot (`roster_settings.ir_slots[].key`). Bench and IR are untouched by
--   construction (neither is a start). Only a player ENTERING a starting slot
--   of the row is judged — a start the row already held is never re-judged,
--   so the score worker's writes, the tick's kickoff refresh, a retire
--   re-point (`team_id` moves, the map does not) and any re-save of an
--   unchanged start pass untouched. A trigger, not a check in each writer,
--   because it cannot be bypassed: it binds every writer measured below AND
--   the service role, AND any writer added later.
--   WHO WRITES `team_lineups` (measured: every INSERT / UPDATE of the table in
--   001–153, newest definer each):
--     set_lineup_internal (152)            — starts players      ⇒ judged
--     commish_edit_lineup_internal (131)   — starts players      ⇒ judged
--     lineup_lock_tick (139) → autopilot   — starts players      ⇒ judged
--       (lineup_autopilot_internal, 152, chooses; the tick writes)
--     lineup_carry_internal (116)          — copies the previous week's
--       ROSTERED starters into a new row   ⇒ judged (never trips: a start
--       kept on another team is of a player that team no longer rosters, so
--       he is not carried there, and a rostered player is on one team)
--     roster_add_drop_internal (153), commish_roster_override_internal (153)
--       via commish_roster_lineup_sync_internal (127), process_waivers_
--       internal (153), trade_execute_internal (153) — CLEAR a moved player
--       and add to the BENCH only        ⇒ no player enters a slot
--     lineup_lock_tick (139) arm (b)     — `starters` / `locked_at` only
--     remove_manager (150) / 120 / 146's re-point — `team_id` only
--     the score worker (TS) — `total_points` only (column list: not fired)
--   LOCK ORDER: the trigger re-takes the league row (`FOR UPDATE`) before it
--   reads the other lineups, so two concurrent writers can never both pass.
--   Every writer that starts a player already holds that lock (rule 8 —
--   set_lineup / commish_edit_lineup lock `leagues` first; the tick and the
--   week advance hold it through `FOR UPDATE SKIP LOCKED`), so for them the
--   re-take is a no-op. A future writer MUST take the league row first.
--   A writer that moves a start from one team to another in one transaction
--   must clear the old row first (the check is per row, immediate).
--
--   THE FLIP SIDE — WHO KEEPS HIM. §1 below, ONE judgment shared by the three
--   writers that read a stored lineup back (set_lineup (4b), the
--   commissioner's editor's new (4b), autopilot's classification):
--   `lineup_kept_starter_internal`. A stored starting slot whose player has
--   LEFT the team's roster since is KEPT — the week's record — when he
--     · PLAYED: his current NFL team's game for the week kicked off (152's
--       arm), OR the lineup's own record of that slot (`starters[].kickoff_at`)
--       says it did, OR he has a stat line for the week (F442: a player
--       released or traded after playing still reads as played — `players.
--       team` no longer names the team he played for, and 139's tick
--       re-reads `starters[].kickoff_at` from `players.team` every minute, so
--       the record alone would not survive; the stat line does, measured); OR
--     · the week CLOSED to moves before he left and he has a game this week:
--       `week_lock_release_internal` (153 — the recorded last-game end, or the
--       Wednesday 00:00 Pacific ceiling) ≤ the instant, and his current NFL
--       team is not on a bye (D412(5): a player of the unplayed game stays in
--       the lineup that started him, his points pending with that team —
--       F445's flip side).
--   Otherwise (a bye, a game gone from the week — E43: he scores nothing) his
--   slot OPENS, exactly as 152 did (D411(7); pgTAP 100 G6–G8 unchanged).
--   WHY THOSE ARE THE ONLY CASES: every roster writer clears a moved player
--   from the first UNFINISHED week (152 / 153 — before the lock release that
--   is the current week), so an off-roster player can sit in a week's stored
--   starting slot only when he left AFTER that week closed to moves, or in a
--   past week (history — he played for them, or scored nothing).
--   SEMANTICS BY WRITER (stated, from Q32 / D411 / D412(5)):
--     set_lineup (manager) — 152's (4b), judged by the helper: a kept starter
--       is carried when omitted and FIXED; a submit that replaces or moves
--       him is refused by name (the 152 text when he kicked off; a new text
--       naming the closed week otherwise). A kept starter is exempt from
--       §7.3.6's submit gate, as a locked one is (R739).
--     commish_edit_lineup (commissioner) — NEW (4b): a kept starter is
--       carried when omitted and ACCEPTED at his own key (R1209 — before,
--       refused); the commissioner walks past the lock as 123 designed
--       (difference (A)): giving his key to someone else or seating him
--       elsewhere does exactly that and is recorded in `locked_players_
--       moved` (a deliberate, audited change of the week — F440's own note
--       names this verb as the one for it). An IR spot for him is refused.
--       The one-start rule binds the commissioner too (a VALIDITY rule —
--       R1208's double start is refused by the trigger).
--     autopilot — a kept starter is SEATED unconditionally; a candidate
--       another team already STARTS this league-week is never offered and is
--       NAMED in skipped_locked[] (`started_by`), so the tick never trips
--       the trigger (F445's autopilot path).
--   NOT CHANGED: F440 (a commissioner's force-drop / move of a played
--   starter in a week still in progress takes his points — pinned in pgTAP
--   100 C1–C2, awaiting Chris); the roster writers; 153's ceiling; scoring.
--   No backfill: a double start already stored (measured locally: none —
--   `team_lineups` holds 0 rows on the reset stack; production not queried)
--   is not re-judged until one of its rows gains that start again.
--
-- D137 — each replaced body is derived from its NEWEST definer's FILE TEXT
-- (measured by grep: no migration after 152 / 131 defines any of them) by an
-- exact-match script (derive_154.py — every substitution asserted to hit
-- once, and its reversal asserted to reproduce the source byte for byte;
-- sources md5-asserted; hunks counted with difflib). pgTAP 102 §A reverses
-- every substitution on the LIVE prosrc and pins the source md5:
--   set_lineup_internal           152:2216-2868 md5 25d7f8a7… → 5 hunks (+24 / -6)
--       (3 substitutions: (4b)'s judgment + the closed-week refusal; step
--       (8)'s `fixed`; step (10)'s R739 exemption)
--   lineup_autopilot_internal     152:2881-3489 md5 7c126d65… → 5 hunks (+32 / -3)
--       (DECLARE; the judgment; the classification; the started-elsewhere
--       candidate filter; its unfillable reason)
--   commish_edit_lineup_internal  131:136-905   md5 6df2375e… → 7 hunks (+65 / -5)
--       (DECLARE; the new (4b); step (6)'s fold; step (7)'s record; step
--       (10)'s gate; step (12)'s slot_key loop)
--
-- DEPLOY SAFETY. SQL plus one sim-harness constant (AUTOPILOT_UNFILLABLE_REASONS — read only by sim files, D413(7); R1218). Service-role direct writers (sim, dev scripts) take the row lock before the league lock the trigger then takes — a deadlock is possible only with the tick, only locally, and Postgres breaks it. Merging deploys nothing the
-- app reads differently; the hosted database gets 154 at Chris's `db push`.
-- Every RPC document keeps its keys (autopilot's skipped_locked[] elements
-- may carry one more key, `started_by`; measured — `grep -rn skipped_locked
-- src`: the only reader is the sim harness's selection grade
-- (season-runner.ts `gradeAutopilotPicks`), which treats a skipped player as
-- no witness — exactly right for a player who cannot be started). A refusal
-- is a P0001 the lineup routes already map to 409 with its message.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   New: two PLAIN helpers (`lineup_kept_starter_internal`,
--   `lineup_started_elsewhere_internal` — reads only, STABLE, search_path '',
--   REVOKEd from PUBLIC / anon / authenticated); one trigger function
--   (`team_lineups_one_start_per_week` — SECURITY DEFINER so its read of the
--   OTHER teams' lineups is never narrowed by a caller's RLS; search_path '';
--   no in-body auth because it is not callable as an RPC — a trigger
--   function — and REVOKEd from PUBLIC / anon / authenticated all the same;
--   the 148 precedent) and one trigger, ENABLE ALWAYS (R616: the invariant
--   holds on a replica-mode path too). Three bodies replaced, signatures
--   unchanged (ACLs kept; REVOKEs restated). No table, column, policy, index
--   or grant. Time only through p_at (the trigger reads no clock). Typegen:
--   the two helpers join `Functions` (additive; alias block re-appended).
--   Realtime: none. WAIVERS: R6 — no staging clone; rehearsal evidence = the
--   fresh local `db reset` 001–154 and the full pgTAP run in the PR. D38 —
--   nothing to backfill (above).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. lineup_kept_starter_internal — does a stored STARTING slot whose player
--    has left the roster keep him for the week? (the ONE judgment)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_kept_starter_internal(
  p_season    INTEGER,
  p_week      INTEGER,
  p_player_id TEXT,
  p_slot      TEXT,          -- the slot_map key he holds ("<slot_key>:<index>")
  p_starters  JSONB,         -- the lineup row's stored starters[] (its record of each slot), or NULL
  p_at        TIMESTAMPTZ
) RETURNS TABLE (
  kept       BOOLEAN,
  kickoff_at TIMESTAMPTZ,    -- his game's kickoff as known (NULL when only a stat line says he played)
  datum_arm  TEXT,           -- lineup_kickoff_internal's arm, 'lineup_record' or 'stat_line'
  on_bye     BOOLEAN,        -- FALSE whenever kept (a kept start is never a bye)
  why        TEXT,           -- kept: 'kicked_off' | 'stat_line' | 'week_closed'; not: 'bye' | 'not_played'
  detail     TEXT            -- the reason in words, for a refusal
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_team    TEXT;
  v_live    RECORD;
  v_rec     JSONB;
  v_rec_at  TIMESTAMPTZ;
  v_stat    BOOLEAN;
  v_release TIMESTAMPTZ;
BEGIN
  -- (i) his CURRENT NFL team's game for the week (152's arm; E42: read now).
  SELECT p.team INTO v_team FROM public.players p WHERE p.id = p_player_id;
  SELECT * INTO v_live FROM public.lineup_kickoff_internal(p_season, p_week, v_team, p_at);
  -- (ii) the lineup's own record of this slot (set by the writer that seated
  --      him, re-read by the tick from players.team — so it helps only until
  --      the tick re-reads a released player, which is why (iii) exists).
  SELECT s INTO v_rec
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_starters) = 'array' THEN p_starters ELSE '[]'::jsonb END) s
  WHERE s ->> 'slot' = p_slot AND s ->> 'player_id' = p_player_id
  LIMIT 1;
  v_rec_at := (v_rec ->> 'kickoff_at')::timestamptz;
  -- (iii) F442: a stat line of his for the week — he played, for whichever
  --       NFL team he was on then (player_stats is keyed player/season/week;
  --       the StatsProvider's store, read in SQL as 131's score enqueue does).
  v_stat := EXISTS (SELECT 1 FROM public.player_stats ps
                    WHERE ps.player_id = p_player_id AND ps.season = p_season AND ps.week = p_week);
  -- (iv) the week's lock release (153): the recorded end, or the ceiling.
  SELECT public.week_lock_release_internal(w.last_game_ends_at, w.starts_at) INTO v_release
  FROM public.nfl_weeks w
  WHERE w.season = p_season AND w.week = p_week;

  on_bye := FALSE;
  IF v_live.kickoff_at IS NOT NULL AND v_live.kickoff_at <= p_at THEN
    kept := TRUE; kickoff_at := v_live.kickoff_at; datum_arm := v_live.datum_arm; why := 'kicked_off';
    detail := format('his game kicked off at %s (%s)', v_live.kickoff_at, v_live.datum_arm);
  ELSIF v_rec_at IS NOT NULL AND v_rec_at <= p_at THEN
    kept := TRUE; kickoff_at := v_rec_at; datum_arm := 'lineup_record'; why := 'kicked_off';
    detail := format('his game kicked off at %s (lineup_record)', v_rec_at);
  ELSIF v_stat THEN
    kept := TRUE; kickoff_at := NULL; datum_arm := 'stat_line'; why := 'stat_line';
    detail := format('he has a week-%s stat line — he played, for the NFL team he was on then (F442)', p_week);
  ELSIF v_release IS NOT NULL AND v_release <= p_at AND NOT v_live.on_bye THEN
    kept := TRUE; kickoff_at := v_live.kickoff_at; datum_arm := v_live.datum_arm; why := 'week_closed';
    detail := format('week %s closed to moves at %s (its lock release — the last game''s end or the Wednesday 00:00 Pacific ceiling, §11.2 / Q78) before he left, and his game (kickoff %s) is still to be played: its points stay with this lineup (D412(5))',
                     p_week, v_release, COALESCE(v_live.kickoff_at::text, 'not scheduled'));
  ELSE
    kept := FALSE; kickoff_at := v_live.kickoff_at; datum_arm := v_live.datum_arm; on_bye := v_live.on_bye;
    why := CASE WHEN v_live.on_bye THEN 'bye' ELSE 'not_played' END;
    detail := CASE WHEN v_live.on_bye THEN 'no game this week (a bye) — he scores nothing; the slot opens'
                   ELSE 'his game has not kicked off and the week is open to moves' END;
  END IF;
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_kept_starter_internal(INTEGER, INTEGER, TEXT, TEXT, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION lineup_kept_starter_internal(INTEGER, INTEGER, TEXT, TEXT, JSONB, TIMESTAMPTZ) IS
  '§11.2 / Q32 / D411 / D412(5) (migration 154, L.D2.15 — F441 / F442 / F445): does a stored STARTING slot whose player has left the roster keep him for the week? Kept when he played (his current team''s kickoff, the lineup''s record of the slot, or a stat line for the week) or when the week''s lock release has passed and he has a game this week; else (a bye) the slot opens. The one judgment set_lineup, commish_edit_lineup and autopilot share.';

-- ---------------------------------------------------------------------------
-- 2. lineup_started_elsewhere_internal — the team (if any) of the league that
--    holds this player in a STARTING slot for the season-week, other than
--    p_team_id. NULL = nobody. "Starting" = the score worker's `startersOf`:
--    a slot_map key that is not an IR spot.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_started_elsewhere_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_season    INTEGER,
  p_week      INTEGER,
  p_player_id TEXT
) RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object('team_id', t.id, 'team_name', t.name, 'slot', e.key, 'lineup_id', tl.id)
  FROM public.team_lineups tl
  JOIN public.teams t ON t.id = tl.team_id
  JOIN public.leagues l ON l.id = t.league_id
  CROSS JOIN LATERAL jsonb_each_text(COALESCE(tl.slot_map, '{}'::jsonb)) e
  WHERE t.league_id = p_league_id
    AND tl.team_id <> p_team_id
    AND tl.season = p_season
    AND tl.week = p_week
    AND e.value = p_player_id
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(l.roster_settings -> 'ir_slots', '[]'::jsonb)) s
                    WHERE s ->> 'key' = split_part(e.key, ':', 1))
  ORDER BY t.id, e.key
  LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION lineup_started_elsewhere_internal(UUID, UUID, INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION lineup_started_elsewhere_internal(UUID, UUID, INTEGER, INTEGER, TEXT) IS
  '§7.3.3 (migration 154, L.D2.15 — F441 / F445): {team_id, team_name, slot, lineup_id} of the OTHER team of the league that holds the player in a starting slot (a slot_map key that is not an IR spot — score-week-worker.ts startersOf) for the season-week, or NULL. Read by team_lineups'' one-start trigger and by autopilot''s candidate filter.';

-- ---------------------------------------------------------------------------
-- 3. THE RULE — one starting slot per player per league-week, on
--    `team_lineups` itself (every writer, the service role included).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION team_lineups_one_start_per_week()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league_id UUID;
  v_team_name TEXT;
  v_ir        TEXT[];
  v_key       TEXT;
  v_pid       TEXT;
  v_else      JSONB;
  v_name      TEXT;
  v_locked    BOOLEAN := FALSE;
BEGIN
  IF NEW.slot_map IS NULL OR jsonb_typeof(NEW.slot_map) <> 'object' OR NEW.slot_map = '{}'::jsonb THEN
    RETURN NEW;
  END IF;
  SELECT t.league_id, t.name INTO v_league_id, v_team_name FROM public.teams t WHERE t.id = NEW.team_id;
  IF v_league_id IS NULL THEN
    RETURN NEW;   -- a standalone (legacy) team has no league-week (112 banner §2)
  END IF;
  SELECT COALESCE(array_agg(s ->> 'key'), ARRAY[]::text[]) INTO v_ir
  FROM public.leagues l, jsonb_array_elements(COALESCE(l.roster_settings -> 'ir_slots', '[]'::jsonb)) s
  WHERE l.id = v_league_id;

  FOR v_key, v_pid IN SELECT e.key, e.value FROM jsonb_each_text(NEW.slot_map) e ORDER BY e.key LOOP
    CONTINUE WHEN split_part(v_key, ':', 1) = ANY (v_ir);            -- IR is roster state, not a start
    -- Only a player ENTERING a starting slot of this row is judged: a start
    -- the row already held (same season-week) is never re-judged.
    CONTINUE WHEN TG_OP = 'UPDATE'
      AND (SELECT t.league_id FROM public.teams t WHERE t.id = OLD.team_id)
          = (SELECT t.league_id FROM public.teams t WHERE t.id = NEW.team_id)   -- R1217: a row moved into ANOTHER LEAGUE is judged; a same-league re-point (retire-and-succeed, F5) is not
      AND OLD.season = NEW.season AND OLD.week = NEW.week
      AND OLD.slot_map IS NOT NULL AND jsonb_typeof(OLD.slot_map) = 'object'
      AND EXISTS (SELECT 1 FROM jsonb_each_text(OLD.slot_map) o
                  WHERE o.value = v_pid AND NOT (split_part(o.key, ':', 1) = ANY (v_ir)));
    IF NOT v_locked THEN
      -- The house lock order (rule 8): the league row, which every writer
      -- that starts a player already holds — a no-op for them; it serializes
      -- any two writers so both can never pass this read.
      PERFORM 1 FROM public.leagues l WHERE l.id = v_league_id FOR UPDATE;
      v_locked := TRUE;
    END IF;
    v_else := public.lineup_started_elsewhere_internal(v_league_id, NEW.team_id, NEW.season, NEW.week, v_pid);
    IF v_else IS NOT NULL THEN
      SELECT p.full_name INTO v_name FROM public.players p WHERE p.id = v_pid;
      RAISE EXCEPTION
        '% (%) is already in %''s starting lineup for week % (slot "%") — a player starts for at most one team per league-week, so % cannot start him at "%" (§7.3.3 / §11.2; PROGRESS F441 / F445): that start stays, and so do its points',
        COALESCE(v_name, v_pid), v_pid, v_else ->> 'team_name', NEW.week, v_else ->> 'slot', v_team_name, v_key
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION team_lineups_one_start_per_week() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION team_lineups_one_start_per_week() IS
  '§7.3.3 / §11.2 (migration 154, L.D2.15 — F441 / F445): refuses, by name, any team_lineups write that puts a player into a starting slot (a slot_map key that is not an IR spot) while another team of the same league starts him in the same season-week. Judges only players ENTERING a start of the row. Takes the league row lock first (rule 8).';

CREATE TRIGGER trg_team_lineups_one_start_per_week
  BEFORE INSERT OR UPDATE OF slot_map, team_id, season, week ON team_lineups
  FOR EACH ROW EXECUTE FUNCTION team_lineups_one_start_per_week();
-- R616's shape: a replica-mode session (db push, pg_restore, logical apply)
-- skips an ORIGIN-enabled trigger; the invariant must hold on every path.
ALTER TABLE team_lineups ENABLE ALWAYS TRIGGER trg_team_lineups_one_start_per_week;

-- ---------------------------------------------------------------------------
-- 4. set_lineup_internal — CREATE OR REPLACE against 152:2216-2868's FILE
--    TEXT (D137; definers 112 / 114 / 131 / 152 — 152 newest, measured by
--    grep), 5 hunks (+24 / -6) from 3 substitutions: (4b) judges through the
--    shared helper and names a closed week in its refusal; step (8)'s
--    `fixed` includes a kept starter; step (10)'s R739 exemption includes
--    him. The DEFINER wrapper set_lineup (112) is untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_lineup_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_week      INTEGER,
  p_slot_map  JSONB,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT DEFAULT NULL   -- REQUIRED (non-blank) when the actor is not the team's manager (R738 / D290)
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_team        public.teams;
  v_row         public.team_lineups;
  v_lw          public.league_weeks;
  v_found       BOOLEAN;
  v_is_manager  BOOLEAN;
  v_is_commish  BOOLEAN;
  v_result      JSONB;
  v_current     INTEGER;
  v_allow       BOOLEAN;
  v_roster      JSONB;
  v_slots       JSONB;
  v_ir_spots    JSONB;
  v_stored      JSONB;
  v_key         TEXT;
  v_val         JSONB;
  v_pid         TEXT;
  v_e           JSONB;
  v_p           JSONB;
  v_seen        JSONB := '{}'::jsonb;
  v_by_pid      JSONB := '{}'::jsonb;   -- player_id → roster element
  v_kick        JSONB := '{}'::jsonb;   -- player_id → {kickoff_at, datum_arm, on_bye} for p_week
  v_kick_cur    JSONB := '{}'::jsonb;   -- the same for the CURRENT week (IR moves)
  v_window      RECORD;
  v_window_cur  RECORD;   -- the CURRENT week's datum (IR moves are judged against it — R736)
  v_k           RECORD;
  v_reason      TEXT;
  v_message     TEXT;
  v_fit_players JSONB := '[]'::jsonb;
  v_fit         JSONB;
  v_canon       JSONB := '{}'::jsonb;
  v_starters    JSONB := '[]'::jsonb;
  v_bench       JSONB := '[]'::jsonb;
  v_ir_out      JSONB := '[]'::jsonb;
  v_flags_bye   JSONB := '[]'::jsonb;
  v_flags_out   JSONB := '[]'::jsonb;
  v_flags_empty JSONB := '[]'::jsonb;
  v_flags_irin  JSONB := '[]'::jsonb;
  v_ir_placed   JSONB := '[]'::jsonb;
  v_ir_removed  JSONB := '[]'::jsonb;
  v_pflags      JSONB;
  v_locked_at   TIMESTAMPTZ;
  v_no_changes  BOOLEAN;
  v_cnt         INTEGER;
  v_expected    INTEGER;
  v_spot        JSONB;
  v_started     TEXT[] := ARRAY[]::text[];
  v_ir_now      TEXT[] := ARRAY[]::text[];  -- player ids under an IR key in the submitted map
  v_stored_at   TEXT;
  v_locked      BOOLEAN;
  v_min_weeks   INTEGER;
  v_msg         TEXT;
  -- 152 / R1206: stored starters who PLAYED and have left this roster since
  -- (player_id → {kickoff_at, datum_arm, on_bye}) — fixed for the week.
  v_gone_kick   JSONB := '{}'::jsonb;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      'set_lineup: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_slot_map IS NULL OR jsonb_typeof(p_slot_map) <> 'object' THEN
    RAISE EXCEPTION
      'set_lineup: p_slot_map must be a JSON object of "<slot_key>:<index>" → player_id (§12.13); got %',
      COALESCE(jsonb_typeof(p_slot_map), 'null')
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;

  -- (2) AUTH, in-body (F35: league_members' cache column, never a stint).
  --     One no-leak 42501 for "no such league", "not a member", "not this
  --     team's manager and not a commissioner".
  v_found := FOUND;
  v_is_manager := v_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT (v_is_manager OR v_is_commish) THEN
    RAISE EXCEPTION 'set_lineup: not a manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- REPLAY (099/E2): the same action_id returns the stored result, byte-
  -- identically — nothing re-evaluated, nothing written.
  SELECT a.result INTO v_result
  FROM public.lineup_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'set_lineup: league % is % — lineups are set only while in_season or in playoffs (§11.2)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'set_lineup: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'set_lineup: team % is retired — a sealed franchise has no lineup to set (§7.2.1)', p_team_id
      USING ERRCODE = 'P0001';
  END IF;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'set_lineup: league % has no league_weeks rows — no season calendar to set a lineup against (§12.17)',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'set_lineup: week % is not on league %''s calendar (season %; league_weeks holds weeks %–%)',
      p_week, p_league_id, v_league.season,
      (SELECT min(week) FROM public.league_weeks WHERE league_id = p_league_id),
      (SELECT max(week) FROM public.league_weeks WHERE league_id = p_league_id)
      USING ERRCODE = 'P0001';
  END IF;
  IF p_week < v_current THEN
    RAISE EXCEPTION
      'set_lineup: week % is in the past (the current week is %) — a past week''s lineup changes only through the audited commissioner override (§11.2, M6)',
      p_week, v_current
      USING ERRCODE = 'P0001';
  END IF;
  IF v_lw.status IN ('correction_window', 'final') THEN
    RAISE EXCEPTION
      'set_lineup: week % of league % is % — a closed week''s lineup changes only through the audited commissioner override (§11.2, M6)',
      p_week, p_league_id, v_lw.status
      USING ERRCODE = 'P0001';
  END IF;

  v_allow := COALESCE((v_league.settings ->> 'allow_illegal_lineups')::boolean, TRUE);

  -- The COMMISSIONER ARM carries the D290 interim audit posture (R738 / F40):
  -- a real change by an actor who is not this team's manager posts the
  -- in-txn system message below. RE-READ UNDER Q66 (migration 131 / L.E1.15,
  -- F362; spec v2.16.41 §10.3 / §15.4 — a commissioner setting another
  -- team's lineup IS a commissioner action): the reason is OPTIONAL, so it is
  -- NORMALISED here and never refused. Blank = nothing but whitespace
  -- INCLUDING tabs/newlines (R745) ⇒ NULL; bounded at 500 characters below,
  -- the client chat policy's own bound, so the system post stays bounded
  -- (R746) — that check is NULL-safe as written.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      'set_lineup: the reason is % characters — at most 500 (the league_chat bound; §12.13)',
      char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (3) THE ROSTER (positions normalized to the roster vocabulary — DEF → DST,
  --     the 086 shape; designations bridged).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',          r.player_id,
           'name',               p.full_name,
           'position',           CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
           'designation',        public.lineup_designation_internal(p.status),
           'nfl_team',           p.team,
           'ir_placed_week',     r.ir_placed_week,
           'ir_lock_until_week', r.ir_lock_until_week,
           'slot_key',           r.slot_key) ORDER BY r.player_id), '[]'::jsonb)
  INTO v_roster
  FROM public.league_rosters r
  JOIN public.players p ON p.id = r.player_id
  WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  IF jsonb_array_length(v_roster) = 0 THEN
    RAISE EXCEPTION
      'set_lineup: team % has no rostered players in league % — a lineup exists only over a roster (§11.1)',
      p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_by_pid := v_by_pid || jsonb_build_object(v_e ->> 'player_id', v_e);
  END LOOP;

  -- Slot instances in canonical order + IR spots.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',      (s ->> 'key') || ':' || i,
           'slot',     s ->> 'key',
           'label',    s ->> 'label',
           'eligible', s -> 'eligible') ORDER BY ord, i), '[]'::jsonb)
  INTO v_slots
  FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') WITH ORDINALITY AS t(s, ord),
       LATERAL generate_series(0, COALESCE((s ->> 'count')::int, 0) - 1) i;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',          (s ->> 'key') || ':0',
           'spot',         s ->> 'key',
           'type',         s ->> 'type',
           'designations', s -> 'eligible_designations',
           'min_weeks',    (s ->> 'min_weeks')::int) ORDER BY ord), '[]'::jsonb)
  INTO v_ir_spots
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord);

  -- (4) THE LINEUP ROW — created on first touch, then locked (rule 8: after
  --     the league row). Loud emptiness: FOUND is asserted.
  INSERT INTO public.team_lineups (team_id, season, week, starters, bench)
  VALUES (p_team_id, v_league.season, p_week, '[]'::jsonb, '[]'::jsonb)
  ON CONFLICT (team_id, season, week) DO NOTHING;
  SELECT tl.* INTO v_row
  FROM public.team_lineups tl
  WHERE tl.team_id = p_team_id AND tl.season = v_league.season AND tl.week = p_week
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_lineup: no lineup row for team % season % week % after create — refusing to continue',
      p_team_id, v_league.season, p_week
      USING ERRCODE = 'P0001';
  END IF;
  v_stored := COALESCE(v_row.slot_map, '{}'::jsonb);

  -- (4b) 152 / R1206 (Q32's amendment, verbatim: "if they are in the lineup
  --      they are stuck in the lineup"; D411): A PLAYED STARTER STAYS EVEN
  --      AFTER HE LEAVES THE ROSTER. Once a week's last game has ended the
  --      lock releases (E32 / 115) and a starter who played can be dropped,
  --      claimed away or traded, while the week is still current (live)
  --      until the next week starts; 152 keeps his finished-week start (the
  --      week is scored and re-scored from this slot_map). A stored STARTING
  --      slot whose player is not on this roster and whose OWN game for
  --      p_week has kicked off is therefore FIXED: carried through unchanged
  --      (the editor never holds an unrostered player — placementFromStored
  --      — so an omitted key is carried, not read as "empty it"), and a
  --      submit that puts anyone else there, or moves him, is refused by
  --      name. He joins v_by_pid (never v_roster: no bench, no roster write)
  --      so steps 7–10 treat him as the locked starter he is. A stored
  --      unrostered player whose game has NOT kicked off (a bye) did not
  --      play: his slot opens, as before.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN v_by_pid ? v_pid;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key);
    SELECT jsonb_build_object(
             'player_id',          p.id,
             'name',               p.full_name,
             'position',           CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
             'designation',        public.lineup_designation_internal(p.status),
             'nfl_team',           p.team,
             'ir_placed_week',     NULL,
             'ir_lock_until_week', NULL,
             'slot_key',           NULL,
             'off_roster',         TRUE)
    INTO v_e
    FROM public.players p WHERE p.id = v_pid;
    CONTINUE WHEN v_e IS NULL;
    -- 154 / F441 · F442 · F445: ONE judgment, shared with the commissioner's
    -- editor and autopilot (lineup_kept_starter_internal). He STAYS when he
    -- PLAYED — his current NFL team's game kicked off, this lineup's own
    -- record of the slot says so, or he has a stat line for the week (F442: a
    -- player released or traded after playing still reads as played) — or
    -- when the week CLOSED to moves (its lock release: the last game's end or
    -- the Wednesday ceiling) before he left and he has a game this week
    -- (D412(5) / F445: a player of the unplayed game stays in the lineup that
    -- started him). A bye, or a game gone from the week, scores nothing: his
    -- slot opens, as before (D411(7)).
    SELECT * INTO v_k FROM public.lineup_kept_starter_internal(v_league.season, p_week, v_pid, v_key, v_row.starters, p_at);
    CONTINUE WHEN NOT v_k.kept;
    IF ((p_slot_map ? v_key) AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid)
       OR EXISTS (SELECT 1 FROM jsonb_each(p_slot_map) x WHERE x.key <> v_key AND (x.value #>> '{}') = v_pid) THEN
      IF v_k.why = 'kicked_off' THEN
        RAISE EXCEPTION
          'set_lineup: % already played this week — his start stays (slot "%": his game kicked off at % (%); he has left %''s roster since, and a played starter is stuck in the lineup for the week — §11.2, Q32; the week is scored from this lineup, §7.3.3)',
          v_e ->> 'name', v_key, v_k.kickoff_at, v_k.datum_arm, v_team.name
          USING ERRCODE = 'P0001';
      END IF;
      RAISE EXCEPTION
        'set_lineup: % is held in this week''s lineup — his start stays (slot "%": %; he has left %''s roster since, and no move changes the start he holds this week — §11.2, Q32, D412(5); the week is scored from this lineup, §7.3.3)',
        v_e ->> 'name', v_key, v_k.detail, v_team.name
        USING ERRCODE = 'P0001';
    END IF;
    v_by_pid := v_by_pid || jsonb_build_object(v_pid, v_e);
    v_gone_kick := v_gone_kick || jsonb_build_object(v_pid, jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    p_slot_map := p_slot_map || jsonb_build_object(v_key, v_pid);   -- carried
  END LOOP;

  -- (5) VALIDATE THE SUBMITTED MAP: keys are slot instances or IR spots,
  --     values are this team's rostered players, each player exactly once.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
    IF jsonb_typeof(v_val) <> 'string' THEN
      RAISE EXCEPTION 'set_lineup: slot % must map to a player_id string (§12.13); got %', v_key, jsonb_typeof(v_val)
        USING ERRCODE = '22023';
    END IF;
    v_pid := v_val #>> '{}';
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      RAISE EXCEPTION
        'set_lineup: "%" is not a slot of league %''s roster (§7.3.2 starting_slots: %; IR spots: %)',
        v_key, p_league_id,
        (SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_slots) s),
        COALESCE((SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_ir_spots) s), 'none')
        USING ERRCODE = '22023';
    END IF;
    IF NOT (v_by_pid ? v_pid) THEN
      RAISE EXCEPTION 'set_lineup: player % is not on team %''s roster in league % (§11.1)', v_pid, p_team_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_seen ? v_pid THEN
      RAISE EXCEPTION
        'set_lineup: % (%) appears at both "%" and "%" — each player fills exactly one slot (E16)',
        v_by_pid -> v_pid ->> 'name', v_pid, v_seen ->> v_pid, v_key
        USING ERRCODE = 'P0001';
    END IF;
    v_seen := v_seen || jsonb_build_object(v_pid, v_key);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      v_ir_now := v_ir_now || v_pid;
      v_canon := v_canon || jsonb_build_object(v_key, v_pid);
    ELSE
      v_started := v_started || v_pid;
    END IF;
  END LOOP;

  -- (6) KICKOFF DATA, read NOW from nfl_games (E42/§23.3) — for p_week (the
  --     starters) and for the current week (IR moves) when they differ.
  SELECT * INTO v_window FROM public.schedule_window_internal(v_league.season, p_week, p_at);
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, p_week, v_e ->> 'nfl_team', p_at);
    v_kick := v_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    IF v_current <> p_week THEN
      SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_current, v_e ->> 'nfl_team', p_at);
      v_kick_cur := v_kick_cur || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
        'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    END IF;
  END LOOP;
  v_kick := v_kick || v_gone_kick;   -- 152 / R1206: (4b)'s played, since-unrostered starters
  IF v_current = p_week THEN
    v_kick_cur := v_kick;
    v_window_cur := v_window;
  ELSE
    SELECT * INTO v_window_cur FROM public.schedule_window_internal(v_league.season, v_current, p_at);
  END IF;

  -- (7) LOCKED PLAYERS NEVER MOVE (per_player_kickoff — the ONLY lineup lock,
  --     Q34(A)). Evaluated BEFORE the fit so a locked stored starter is a
  --     FIXED vertex, and a played player can neither enter nor change slots.
  --     114: the mode test that used to guard this block is gone — it is
  --     unconditional.
    -- (a) every stored starter whose game has kicked off must sit at the
    --     same key in the submitted map.
    FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
      v_pid := v_val #>> '{}';
      CONTINUE WHEN NOT (v_by_pid ? v_pid);                       -- off the roster and NOT played (a played one is in v_by_pid since (4b) — 152 / R1206)
      CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
      v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
      IF v_locked AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid THEN
        RAISE EXCEPTION
          'set_lineup: slot % is locked — % kicked off at % (%) and a locked slot''s player never moves (§11.2, lineup_lock = per_player_kickoff); every other unlocked slot stays editable',
          v_key, v_by_pid -> v_pid ->> 'name', v_kick -> v_pid ->> 'kickoff_at', v_kick -> v_pid ->> 'datum_arm'
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    -- (b) a player whose game has kicked off never enters a slot he was not
    --     already stored at.
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
      v_pid := v_val #>> '{}';
      CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
      v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
      IF v_locked AND (v_stored ->> v_key) IS DISTINCT FROM v_pid THEN
        RAISE EXCEPTION
          'set_lineup: %''s game kicked off at % (%) — a player whose game has started cannot enter or move slots (§11.2, lineup_lock = per_player_kickoff); wanted "%"',
          v_by_pid -> v_pid ->> 'name', v_kick -> v_pid ->> 'kickoff_at', v_kick -> v_pid ->> 'datum_arm', v_key
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

  -- (8) THE FIT (E16). Input order: fixed (locked) players first, then the
  --     rest in submitted-key order — deterministic.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id', v_by_pid -> x.pid ->> 'player_id',
           'position',  v_by_pid -> x.pid ->> 'position',
           'wanted',    x.key,
           'fixed',     x.fixed) ORDER BY x.fixed DESC, x.ord), '[]'::jsonb)
  INTO v_fit_players
  FROM (
    SELECT e.key, e.value #>> '{}' AS pid, e.ord,
           -- fixed = locked: the player's OWN kickoff has passed (R737 — a
           -- locked placement is a fact; 114: the whole-week arm is gone).
           ((v_kick -> (e.value #>> '{}') ->> 'kickoff_at') IS NOT NULL
            AND (v_kick -> (e.value #>> '{}') ->> 'kickoff_at')::timestamptz <= p_at)
           OR v_gone_kick ? (e.value #>> '{}') AS fixed   -- 154 / F445: a kept off-roster starter is FIXED even while his (postponed) game is ahead
    FROM jsonb_each(p_slot_map) WITH ORDINALITY AS e(key, value, ord)
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = e.key)
  ) x;
  v_fit := public.lineup_fit_internal(v_slots, v_fit_players);
  IF jsonb_array_length(v_fit -> 'unplaced') > 0 THEN
    v_pid := v_fit -> 'unplaced' ->> 0;
    v_key := v_seen ->> v_pid;
    RAISE EXCEPTION
      'set_lineup: % (%) cannot be placed — no legal arrangement of the started players fills the slots (E16): "%" accepts % and every slot % could take is held by a player with nowhere else to go (unplaced: %)',
      v_by_pid -> v_pid ->> 'name', v_by_pid -> v_pid ->> 'position', v_key,
      (SELECT string_agg(x #>> '{}', '/') FROM jsonb_array_elements((SELECT s -> 'eligible' FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)) x),
      v_by_pid -> v_pid ->> 'name',
      v_fit -> 'unplaced'
      USING ERRCODE = 'P0001';
  END IF;
  v_canon := v_canon || (v_fit -> 'assignment');

  -- 114 (Q34(A)): the whole-week refusal that stood here is RETIRED. After the
  -- week's first kickoff every UNLOCKED slot of the lineup stays editable;
  -- only a slot whose own player has kicked off is closed (step 7).

  -- (9) IR MOVES, against the CURRENT week (banner: IR LAW).
  --     Placements: under an IR key now, not on IR (or on a different spot) before.
  FOR v_spot IN SELECT * FROM jsonb_array_elements(v_ir_spots) LOOP
    v_pid := v_canon ->> (v_spot ->> 'key');
    CONTINUE WHEN v_pid IS NULL;
    v_e := v_by_pid -> v_pid;
    IF (v_e ->> 'ir_placed_week') IS NULL OR (v_e ->> 'slot_key') IS DISTINCT FROM (v_spot ->> 'key') THEN
      -- a NEW placement (or a spot change, which is removal + placement)
      IF (v_e ->> 'ir_placed_week') IS NOT NULL AND (v_e ->> 'ir_lock_until_week') IS NOT NULL
         AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
        RAISE EXCEPTION
          'set_lineup: % entered restricted IR spot % in week % and may not leave it before week % (min_weeks stint, §11.2/§7.3.2) — the current week is %; commissioner override is M6''s',
          v_e ->> 'name', v_e ->> 'slot_key', v_e ->> 'ir_placed_week', v_e ->> 'ir_lock_until_week', v_current
          USING ERRCODE = 'P0001';
      END IF;
      IF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
        RAISE EXCEPTION
          'set_lineup: % holds designation % — IR spot % accepts only % (§7.3.2 IR slot rules)',
          v_e ->> 'name', COALESCE(v_e ->> 'designation', 'none'), v_spot ->> 'spot',
          (SELECT string_agg(x #>> '{}', ', ') FROM jsonb_array_elements(v_spot -> 'designations') x)
          USING ERRCODE = 'P0001';
      END IF;
      IF (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
         AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
        RAISE EXCEPTION
          'set_lineup: %''s lock for week % has passed (kickoff %) — IR moves respect lineup-lock timing (§7.3.2)',
          v_e ->> 'name', v_current, v_kick_cur -> v_pid ->> 'kickoff_at'
          USING ERRCODE = 'P0001';
      END IF;
      v_ir_placed := v_ir_placed || jsonb_build_object(
        'player_id', v_pid, 'spot', v_spot ->> 'key', 'type', v_spot ->> 'type',
        'ir_placed_week', v_current,
        'ir_lock_until_week', CASE WHEN v_spot ->> 'type' = 'restricted'
                                   THEN v_current + COALESCE((v_spot ->> 'min_weeks')::int, 4) END);
    ELSIF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
      v_flags_irin := v_flags_irin || to_jsonb(v_pid);
    END IF;
    v_ir_out := v_ir_out || jsonb_build_object(
      'slot', v_spot ->> 'key', 'player_id', v_pid, 'position', v_e ->> 'position',
      'designation', v_e ->> 'designation',
      'ir_placed_week', COALESCE((SELECT (x ->> 'ir_placed_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid), (v_e ->> 'ir_placed_week')::int),
      'ir_lock_until_week', CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 THEN (SELECT (x ->> 'ir_lock_until_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 ELSE (v_e ->> 'ir_lock_until_week')::int END,
      'flags', CASE WHEN v_flags_irin ? v_pid THEN '["ir_ineligible"]'::jsonb ELSE '[]'::jsonb END);
  END LOOP;
  --     Removals: on IR before, not under any IR key now.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    CONTINUE WHEN (v_e ->> 'ir_placed_week') IS NULL;
    v_pid := v_e ->> 'player_id';
    CONTINUE WHEN v_pid = ANY (v_ir_now);
    IF (v_e ->> 'ir_lock_until_week') IS NOT NULL AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
      RAISE EXCEPTION
        'set_lineup: % entered restricted IR spot % in week % and may not leave it before week % (min_weeks stint, §11.2/§7.3.2) — the current week is %; commissioner override is M6''s',
        v_e ->> 'name', v_e ->> 'slot_key', v_e ->> 'ir_placed_week', v_e ->> 'ir_lock_until_week', v_current
        USING ERRCODE = 'P0001';
    END IF;
    IF (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
       AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
      RAISE EXCEPTION
        'set_lineup: %''s lock for week % has passed (kickoff %) — IR moves respect lineup-lock timing (§7.3.2)',
        v_e ->> 'name', v_current, v_kick_cur -> v_pid ->> 'kickoff_at'
        USING ERRCODE = 'P0001';
    END IF;
    v_ir_removed := v_ir_removed || jsonb_build_object('player_id', v_pid, 'spot', v_e ->> 'slot_key');
  END LOOP;

  -- (10) STARTERS (derived render state) + flags; bench = roster − starters − IR.
  v_locked_at := NULL;   -- 114: the earliest STARTED player's kickoff (below), never a week datum
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_canon ->> v_key;
    v_pflags := '[]'::jsonb;
    IF v_pid IS NULL THEN
      v_pflags := v_pflags || '"empty"'::jsonb;
      v_flags_empty := v_flags_empty || to_jsonb(v_key);
    ELSE
      v_p := v_by_pid -> v_pid;
      IF (v_kick -> v_pid ->> 'on_bye')::boolean THEN
        v_pflags := v_pflags || '"bye"'::jsonb;
        v_flags_bye := v_flags_bye || to_jsonb(v_pid);
      END IF;
      IF (v_p ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended') THEN
        v_pflags := v_pflags || '"out"'::jsonb;
        v_flags_out := v_flags_out || to_jsonb(v_pid);
      END IF;
      IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL THEN
        v_locked_at := LEAST(v_locked_at, (v_kick -> v_pid ->> 'kickoff_at')::timestamptz);
      END IF;
      -- §7.3.6 allow_illegal_lineups = FALSE: a bye/OUT starter in an
      -- UNLOCKED slot blocks the submit by name.
      -- (a locked slot's bye/OUT player is not the manager's to change:
      --  exempt when the stored player's own game has kicked off, R739.)
      IF NOT v_allow AND jsonb_array_length(v_pflags) > 0
         AND NOT ((v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at
                  AND (v_stored ->> v_key) = v_pid)
         AND NOT (v_gone_kick ? v_pid) THEN   -- 154 / F445: a kept off-roster starter is not the manager's to change
        RAISE EXCEPTION
          'set_lineup: % is % for week % and allow_illegal_lineups is off — slot "%" is blocked at submit (§7.3.6); bench him or start someone who plays',
          v_p ->> 'name', CASE WHEN v_pflags ? 'bye' THEN 'on bye' ELSE 'OUT (' || (v_p ->> 'designation') || ')' END,
          p_week, v_key
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    v_starters := v_starters || jsonb_build_object(
      'slot', v_key, 'slot_key', v_e ->> 'slot', 'label', v_e ->> 'label',
      'player_id', v_pid,
      'position', CASE WHEN v_pid IS NULL THEN NULL ELSE v_by_pid -> v_pid ->> 'position' END,
      'kickoff_at', CASE WHEN v_pid IS NULL THEN NULL ELSE v_kick -> v_pid ->> 'kickoff_at' END,
      'flags', v_pflags);
  END LOOP;
  SELECT COALESCE(jsonb_agg(to_jsonb(e ->> 'player_id') ORDER BY e ->> 'player_id'), '[]'::jsonb)
  INTO v_bench
  FROM jsonb_array_elements(v_roster) e
  WHERE NOT ((e ->> 'player_id') = ANY (v_started))
    AND NOT ((e ->> 'player_id') = ANY (v_ir_now));

  -- (11) NO-OP BY NAME (rule 10): the canonical map equals the stored map
  --      and no IR move — nothing is written but the ledger row.
  v_no_changes := (v_canon = v_stored)
                  AND jsonb_array_length(v_ir_placed) = 0
                  AND jsonb_array_length(v_ir_removed) = 0;

  IF NOT v_no_changes THEN
    -- (12) WRITE — the lineup row, then the roster's slot_key/IR columns.
    UPDATE public.team_lineups
    SET slot_map          = v_canon,
        starters          = v_starters,
        bench             = v_bench,
        locked_at         = v_locked_at,
        edited_by_commish = NOT v_is_manager,
        set_at            = now()
    WHERE id = v_row.id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'set_lineup: updated % lineup rows for team % week %, expected 1', v_cnt, p_team_id, p_week
        USING ERRCODE = 'P0001';
    END IF;

    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_placed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week     = (v_e ->> 'ir_placed_week')::int,
          ir_lock_until_week = (v_e ->> 'ir_lock_until_week')::int,
          slot_key           = v_e ->> 'spot'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'set_lineup: IR placement of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_removed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week = NULL, ir_lock_until_week = NULL, slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'set_lineup: IR removal of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    -- R738 / D290 / D97: a commissioner's change posts in-txn, reason in the
    -- text (the interim audit until commissioner_actions exists — F40).
    IF NOT v_is_manager THEN
      v_message := 'Week ' || p_week || ' lineup for ' || v_team.name || ' set by '
        || public.draft_actor_name() || ' (commissioner)'
        || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional
      INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
      VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
    END IF;

    IF p_week = v_current THEN
      -- slot_key describes the ACTIVE week: starters → instance key, the rest
      -- (not on IR) → 'bn'. Counts asserted against the roster.
      v_expected := 0;
      FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit -> 'assignment') LOOP
        CONTINUE WHEN v_gone_kick ? (v_val #>> '{}');   -- 152 / R1206: off this roster — no roster row of his to write
        UPDATE public.league_rosters r SET slot_key = v_key
        WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = (v_val #>> '{}');
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        v_expected := v_expected + v_cnt;
      END LOOP;
      IF v_expected <> COALESCE(array_length(v_started, 1), 0) - (SELECT count(*)::int FROM jsonb_object_keys(v_gone_kick)) THEN
        RAISE EXCEPTION 'set_lineup: wrote slot_key for % starters, expected %', v_expected,
          COALESCE(array_length(v_started, 1), 0) - (SELECT count(*)::int FROM jsonb_object_keys(v_gone_kick))
          USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.league_rosters r SET slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id
        AND r.player_id = ANY (SELECT x #>> '{}' FROM jsonb_array_elements(v_bench) x);
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> jsonb_array_length(v_bench) THEN
        RAISE EXCEPTION 'set_lineup: wrote slot_key = bn for % players, expected %', v_cnt, jsonb_array_length(v_bench)
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'team_id',                p_team_id,
    'season',                 v_league.season,
    'week',                   p_week,
    'current_week',           v_current,
    'action_id',              p_action_id,
    'lineup_lock',            v_league.lineup_lock,   -- 114: the CHECK-constrained column value (only 'per_player_kickoff' exists)
    'allow_illegal_lineups',  v_allow,
    'no_changes',             v_no_changes,
    'rearranged',             (v_fit ->> 'rearranged')::boolean,
    'moved',                  v_fit -> 'moved',
    'slot_map',               v_canon,
    'starters',               v_starters,
    'bench',                  v_bench,
    'ir',                     v_ir_out,
    'ir_moves',               jsonb_build_object('placed', v_ir_placed, 'removed', v_ir_removed),
    'flags', jsonb_build_object(
      'illegal',       jsonb_array_length(v_flags_bye) + jsonb_array_length(v_flags_out) + jsonb_array_length(v_flags_irin) > 0,
      'bye',           v_flags_bye,
      'out',           v_flags_out,
      'empty',         v_flags_empty,
      'ir_ineligible', v_flags_irin),
    'locked_at',              v_locked_at,
    'edited_by_commish',      NOT v_is_manager,
    'reason',                 v_reason,
    'system_post',            v_message,
    'evaluated_at',           p_at,
    'week_datum', jsonb_build_object(
      'first_kickoff_at', v_window.first_kickoff_at,
      'datum_arm',        v_window.datum_arm,
      'kicked_off',       NOT v_window.free),
    'current_week_datum', jsonb_build_object(
      'first_kickoff_at', v_window_cur.first_kickoff_at,
      'datum_arm',        v_window_cur.datum_arm,
      'kicked_off',       NOT v_window_cur.free)
  );

  INSERT INTO public.lineup_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION set_lineup_internal(UUID, UUID, INTEGER, JSONB, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. commish_edit_lineup_internal — CREATE OR REPLACE against 131:136-905's
--    FILE TEXT (D137; definers 123 / 131 — 131 newest, measured by grep),
--    7 hunks (+65 / -5): DECLARE; the new step (4b) — a kept starter is
--    carried / accepted at his key (R1209), an IR spot refused for him;
--    step (6) folds his kickoff into v_kick; step (7) records his move or
--    removal; step (10)'s gate exempts him where he stands; step (12)'s
--    slot_key loop skips him and its count excludes him. The DEFINER wrapper
--    commish_edit_lineup (123) is untouched. R1208's double start is refused
--    by §3's trigger (a validity rule binds the commissioner too).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_edit_lineup_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_week      INTEGER,
  p_slot_map  JSONB,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_team        public.teams;
  v_row         public.team_lineups;
  v_lw          public.league_weeks;
  v_found       BOOLEAN;
  v_result      JSONB;
  v_current     INTEGER;
  v_allow       BOOLEAN;
  v_roster      JSONB;
  v_slots       JSONB;
  v_ir_spots    JSONB;
  v_stored      JSONB;
  v_key         TEXT;
  v_val         JSONB;
  v_pid         TEXT;
  v_e           JSONB;
  v_p           JSONB;
  v_seen        JSONB := '{}'::jsonb;
  v_by_pid      JSONB := '{}'::jsonb;   -- player_id → roster element
  v_kick        JSONB := '{}'::jsonb;   -- player_id → {kickoff_at, datum_arm, on_bye} for p_week
  v_kick_cur    JSONB := '{}'::jsonb;   -- the same for the CURRENT week (IR moves)
  v_window      RECORD;
  v_window_cur  RECORD;
  v_k           RECORD;
  v_reason      TEXT;
  v_message     TEXT;
  v_fit_players JSONB := '[]'::jsonb;
  v_fit         JSONB;
  v_canon       JSONB := '{}'::jsonb;
  v_starters    JSONB := '[]'::jsonb;
  v_bench       JSONB := '[]'::jsonb;
  v_ir_out      JSONB := '[]'::jsonb;
  v_flags_bye   JSONB := '[]'::jsonb;
  v_flags_out   JSONB := '[]'::jsonb;
  v_flags_empty JSONB := '[]'::jsonb;
  v_flags_irin  JSONB := '[]'::jsonb;
  v_ir_placed   JSONB := '[]'::jsonb;
  v_ir_removed  JSONB := '[]'::jsonb;
  v_pflags      JSONB;
  v_locked_at   TIMESTAMPTZ;
  v_no_changes  BOOLEAN;
  v_cnt         INTEGER;
  v_expected    INTEGER;
  v_spot        JSONB;
  v_started     TEXT[] := ARRAY[]::text[];
  v_ir_now      TEXT[] := ARRAY[]::text[];  -- player ids under an IR key in the submitted map
  -- NEW in 123 (the differences)
  v_audit_id    UUID;
  v_bypassed    JSONB := '[]'::jsonb;   -- every lock/stint gate this edit walked past, NAMED
  v_moved_lock  JSONB := '[]'::jsonb;   -- the players a manager could not have moved
  v_old_start   TEXT[] := ARRAY[]::text[];
  v_rescore     TEXT[] := ARRAY[]::text[];
  v_enqueued    JSONB := '[]'::jsonb;
  v_not_enq     JSONB := '[]'::jsonb;   -- rescore players with NO queue row, each with its reason
  v_unstamped   TEXT[] := ARRAY[]::text[];
  v_score_stale BOOLEAN;
  v_stale_why   TEXT;
  v_before      JSONB;
  -- 154 / F441 (R1209): stored STARTERS off this roster whom the week keeps
  -- (player_id → {kickoff_at, datum_arm, on_bye}).
  v_gone_kick   JSONB := '{}'::jsonb;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      'commish_edit_lineup: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_slot_map IS NULL OR jsonb_typeof(p_slot_map) <> 'object' THEN
    RAISE EXCEPTION
      'commish_edit_lineup: p_slot_map must be a JSON object of "<slot_key>:<index>" → player_id (§12.13); got %',
      COALESCE(jsonb_typeof(p_slot_map), 'null')
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8). Every other
  --     row lock in this body comes after it — reversing them would invert the
  --     lock order against every other league RPC.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;

  -- (2) AUTH — COMMISSIONER ONLY (difference (C)). A manager, including this
  --     team's own manager, uses `set_lineup`; this verb is the exception
  --     path and it is audited. One no-leak 42501 for "no such league" and
  --     "not a commissioner" alike.
  v_found := FOUND;
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_edit_lineup: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- REPLAY (099/E2): the same action_id returns the stored result, byte-
  -- identically — nothing re-evaluated, nothing written. Placed BEFORE every
  -- business gate exactly as 114:250-257 places it, so a retry replays even
  -- when the league or the week has since moved on.
  SELECT a.result INTO v_result
  FROM public.commish_lineup_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'commish_edit_lineup: league % is % — a lineup has no meaning outside a season (§11.2)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'commish_edit_lineup: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'commish_edit_lineup: team % is retired — a sealed franchise has no lineup to set (§7.2.1)', p_team_id
      USING ERRCODE = 'P0001';
  END IF;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'commish_edit_lineup: league % has no league_weeks rows — no season calendar to set a lineup against (§12.17)',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'commish_edit_lineup: week % is not on league %''s calendar (season %; league_weeks holds weeks %–%)',
      p_week, p_league_id, v_league.season,
      (SELECT min(week) FROM public.league_weeks WHERE league_id = p_league_id),
      (SELECT max(week) FROM public.league_weeks WHERE league_id = p_league_id)
      USING ERRCODE = 'P0001';
  END IF;
  -- DIFFERENCE (B): 114:293-305's past-week and closed-week refusals are NOT
  -- copied. Both of them say, in their own text, that the change goes
  -- "through the audited commissioner override (§11.2, M6)". This is it.
  -- §11.2:730: "Commissioner can edit any lineup, including retroactively and
  -- past lock (audited)."
  IF p_week < v_current THEN
    v_bypassed := v_bypassed || to_jsonb('past_week'::text);
  END IF;
  IF v_lw.status IN ('correction_window', 'final') THEN
    v_bypassed := v_bypassed || to_jsonb(('closed_week:' || v_lw.status)::text);
  END IF;

  v_allow := COALESCE((v_league.settings ->> 'allow_illegal_lineups')::boolean, TRUE);

  -- DIFFERENCE (D), RE-READ UNDER Q66 (migration 131 / L.E1.15, PROGRESS
  -- F362; spec v2.16.41 §10.3 / §15.4): the reason is OPTIONAL. It is
  -- NORMALISED here, never refused — absent or nothing but whitespace in the
  -- explicit E' \t\r\n' class (R745) ⇒ NULL, which 130 §0's column change
  -- stores; otherwise trimmed and bounded at 500 below (the league_chat
  -- bound, R746, and the table CHECK's). The 500 check is NULL-safe as
  -- written (char_length(NULL) > 500 is NULL, and IF NULL does not fire).
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      'commish_edit_lineup: the reason is % characters — at most 500 (the league_chat bound; §12.13)',
      char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (3) THE ROSTER (positions normalized to the roster vocabulary — DEF → DST,
  --     the 086 shape; designations bridged). Verbatim 114:329-349 — the DST
  --     normalisation is what `lineup_fit_internal`'s eligibility test matches
  --     on, so a defense is unplaceable without it.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',          r.player_id,
           'name',               p.full_name,
           'position',           CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
           'designation',        public.lineup_designation_internal(p.status),
           'nfl_team',           p.team,
           'ir_placed_week',     r.ir_placed_week,
           'ir_lock_until_week', r.ir_lock_until_week,
           'slot_key',           r.slot_key) ORDER BY r.player_id), '[]'::jsonb)
  INTO v_roster
  FROM public.league_rosters r
  JOIN public.players p ON p.id = r.player_id
  WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  IF jsonb_array_length(v_roster) = 0 THEN
    RAISE EXCEPTION
      'commish_edit_lineup: team % has no rostered players in league % — a lineup exists only over a roster (§11.1)',
      p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_by_pid := v_by_pid || jsonb_build_object(v_e ->> 'player_id', v_e);
  END LOOP;

  -- Slot instances in canonical order + IR spots (verbatim 114:350-370). The
  -- canonical order of v_slots IS the order starters[] is emitted in.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',      (s ->> 'key') || ':' || i,
           'slot',     s ->> 'key',
           'label',    s ->> 'label',
           'eligible', s -> 'eligible') ORDER BY ord, i), '[]'::jsonb)
  INTO v_slots
  FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') WITH ORDINALITY AS t(s, ord),
       LATERAL generate_series(0, COALESCE((s ->> 'count')::int, 0) - 1) i;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',          (s ->> 'key') || ':0',
           'spot',         s ->> 'key',
           'type',         s ->> 'type',
           'designations', s -> 'eligible_designations',
           'min_weeks',    (s ->> 'min_weeks')::int) ORDER BY ord), '[]'::jsonb)
  INTO v_ir_spots
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord);

  -- (4) THE LINEUP ROW — created on first touch, then locked (rule 8: after
  --     the league row). Loud emptiness: FOUND is asserted.
  INSERT INTO public.team_lineups (team_id, season, week, starters, bench)
  VALUES (p_team_id, v_league.season, p_week, '[]'::jsonb, '[]'::jsonb)
  ON CONFLICT (team_id, season, week) DO NOTHING;
  SELECT tl.* INTO v_row
  FROM public.team_lineups tl
  WHERE tl.team_id = p_team_id AND tl.season = v_league.season AND tl.week = p_week
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commish_edit_lineup: no lineup row for team % season % week % after create — refusing to continue',
      p_team_id, v_league.season, p_week
      USING ERRCODE = 'P0001';
  END IF;
  v_stored := COALESCE(v_row.slot_map, '{}'::jsonb);
  -- The `before` image the audit row carries — captured before anything moves.
  v_before := jsonb_build_object(
    'slot_map', v_stored, 'starters', COALESCE(v_row.starters, '[]'::jsonb),
    'bench', COALESCE(v_row.bench, '[]'::jsonb), 'locked_at', v_row.locked_at,
    'edited_by_commish', v_row.edited_by_commish, 'set_at', v_row.set_at);

  -- (4b) 154 / F441 (R1209) — A START THE WEEK KEEPS IS NOT ERASED BY A FIX.
  --      A stored STARTING slot whose player has left this roster since — a
  --      player who played, or whose week closed to moves before he left
  --      (lineup_kept_starter_internal: the ONE judgment set_lineup (4b) and
  --      autopilot share — F442 / F445) — is the week's record: 152 / 153
  --      keep it there, and the week is scored from it. The editor never
  --      holds an unrostered player (placementFromStored), so an OMITTED key
  --      is CARRIED, never read as "empty it", and a submit that names him at
  --      his key is accepted (131's roster check refused it — so any
  --      commissioner fix to that week silently dropped his points). The
  --      commissioner still walks past the lock (difference (A)): a submit
  --      that gives his key to someone else, or seats him at another key,
  --      does exactly that and is recorded in locked_players_moved. An IR
  --      spot is roster state, so it is refused for him. He joins v_by_pid
  --      (never v_roster: no bench, no roster write).
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN v_by_pid ? v_pid;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key);
    SELECT jsonb_build_object(
             'player_id',          p.id,
             'name',               p.full_name,
             'position',           CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
             'designation',        public.lineup_designation_internal(p.status),
             'nfl_team',           p.team,
             'ir_placed_week',     NULL,
             'ir_lock_until_week', NULL,
             'slot_key',           NULL,
             'off_roster',         TRUE)
    INTO v_e
    FROM public.players p WHERE p.id = v_pid;
    CONTINUE WHEN v_e IS NULL;
    SELECT * INTO v_k FROM public.lineup_kept_starter_internal(v_league.season, p_week, v_pid, v_key, v_row.starters, p_at);
    CONTINUE WHEN NOT v_k.kept;   -- a bye / a game gone from the week: the slot opens, as before
    IF EXISTS (SELECT 1 FROM jsonb_each(p_slot_map) x
               WHERE (x.value #>> '{}') = v_pid
                 AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = x.key)) THEN
      RAISE EXCEPTION
        'commish_edit_lineup: % has left %''s roster — an IR spot holds only a rostered player (§11.2); his week-% start at "%" can stay, move or be removed, never go to IR',
        v_e ->> 'name', v_team.name, p_week, v_key
        USING ERRCODE = 'P0001';
    END IF;
    v_by_pid := v_by_pid || jsonb_build_object(v_pid, v_e);
    v_gone_kick := v_gone_kick || jsonb_build_object(v_pid, jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    IF NOT (p_slot_map ? v_key)
       AND NOT EXISTS (SELECT 1 FROM jsonb_each(p_slot_map) x WHERE (x.value #>> '{}') = v_pid) THEN
      p_slot_map := p_slot_map || jsonb_build_object(v_key, v_pid);   -- carried
    END IF;
  END LOOP;

  -- (5) VALIDATE THE SUBMITTED MAP (verbatim 114:388-422): keys are slot
  --     instances or IR spots, values are this team's rostered players, each
  --     player exactly once. These are SHAPE and OWNERSHIP gates, not timing
  --     gates — they bind the commissioner (see WHAT IS NOT LIFTED).
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
    IF jsonb_typeof(v_val) <> 'string' THEN
      RAISE EXCEPTION 'commish_edit_lineup: slot % must map to a player_id string (§12.13); got %', v_key, jsonb_typeof(v_val)
        USING ERRCODE = '22023';
    END IF;
    v_pid := v_val #>> '{}';
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      RAISE EXCEPTION
        'commish_edit_lineup: "%" is not a slot of league %''s roster (§7.3.2 starting_slots: %; IR spots: %)',
        v_key, p_league_id,
        (SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_slots) s),
        COALESCE((SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_ir_spots) s), 'none')
        USING ERRCODE = '22023';
    END IF;
    IF NOT (v_by_pid ? v_pid) THEN
      RAISE EXCEPTION 'commish_edit_lineup: player % is not on team %''s roster in league % (§11.1)', v_pid, p_team_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_seen ? v_pid THEN
      RAISE EXCEPTION
        'commish_edit_lineup: % (%) appears at both "%" and "%" — each player fills exactly one slot (E16)',
        v_by_pid -> v_pid ->> 'name', v_pid, v_seen ->> v_pid, v_key
        USING ERRCODE = 'P0001';
    END IF;
    v_seen := v_seen || jsonb_build_object(v_pid, v_key);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      v_ir_now := v_ir_now || v_pid;
      v_canon := v_canon || jsonb_build_object(v_key, v_pid);
    ELSE
      v_started := v_started || v_pid;
    END IF;
  END LOOP;

  -- (6) KICKOFF DATA, read NOW from nfl_games (E42/§23.3) — verbatim
  --     114:424-442. Still needed in full even though the lock is lifted:
  --     v_kick feeds locked_at, starters[].kickoff_at and the bye flag.
  SELECT * INTO v_window FROM public.schedule_window_internal(v_league.season, p_week, p_at);
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, p_week, v_e ->> 'nfl_team', p_at);
    v_kick := v_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    IF v_current <> p_week THEN
      SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_current, v_e ->> 'nfl_team', p_at);
      v_kick_cur := v_kick_cur || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
        'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    END IF;
  END LOOP;
  v_kick := v_kick || v_gone_kick;   -- 154 / F441: (4b)'s kept, since-unrostered starters
  IF v_current = p_week THEN
    v_kick_cur := v_kick;
    v_window_cur := v_window;
  ELSE
    SELECT * INTO v_window_cur FROM public.schedule_window_internal(v_league.season, v_current, p_at);
  END IF;

  -- (7) THE LOCK — DIFFERENCE (A1)/(A2). 114:444-476's two arms are NOT here.
  --     A stored starter whose game kicked off MAY leave his key, and a
  --     player whose game has started MAY enter or move slots. That is the
  --     entire purpose of this verb (PROGRESS §3 clause (g), Chris: "an LM
  --     should be able to set the lineup even after the games have started").
  --     The arms stay byte-identical in `set_lineup_internal` for every
  --     caller, commissioner included — never weaken the rule, add the
  --     exception path.
  --     What replaces them is a RECORD, not a refusal: every player this edit
  --     moved whose game had already kicked off is named, and rides into the
  --     audit row's metadata so the league can see exactly what the override
  --     did that a manager could not have.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN NOT (v_by_pid ? v_pid);
    CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
    IF (((v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
         AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at)
        OR v_gone_kick ? v_pid)   -- 154 / F441: a kept off-roster starter moved or removed is recorded too
       AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid THEN
      v_moved_lock := v_moved_lock || jsonb_build_object(
        'player_id', v_pid, 'name', v_by_pid -> v_pid ->> 'name',
        'from', v_key, 'to', v_seen ->> v_pid,
        'kickoff_at', v_kick -> v_pid ->> 'kickoff_at',
        'datum_arm', v_kick -> v_pid ->> 'datum_arm');
    END IF;
  END LOOP;
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
    IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
       AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at
       AND (v_stored ->> v_key) IS DISTINCT FROM v_pid
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_moved_lock) m WHERE m ->> 'player_id' = v_pid) THEN
      v_moved_lock := v_moved_lock || jsonb_build_object(
        'player_id', v_pid, 'name', v_by_pid -> v_pid ->> 'name',
        -- His PRIOR slot, or NULL when he was on the bench. (R970: this was
        -- wrapped in `CASE WHEN v_stored ? v_pid THEN NULL ELSE …` — a
        -- key-existence test against a slot_map keyed by SLOT, so it asked
        -- whether a PLAYER ID was a slot key and was dead by construction.
        -- The subquery alone was always the whole computation; the guard only
        -- misled, in the permanent record of what the override did.)
        'from', (SELECT e.key FROM jsonb_each(v_stored) e WHERE e.value #>> '{}' = v_pid LIMIT 1),
        'to', v_key,
        'kickoff_at', v_kick -> v_pid ->> 'kickoff_at',
        'datum_arm', v_kick -> v_pid ->> 'datum_arm');
    END IF;
  END LOOP;
  IF jsonb_array_length(v_moved_lock) > 0 THEN
    v_bypassed := v_bypassed || to_jsonb('per_player_kickoff_lock'::text);
  END IF;

  -- (8) THE FIT (E16) — 114:479-496 with DIFFERENCE (A3): every player is
  --     passed `fixed = FALSE`. THIS IS LOAD-BEARING, not cosmetic. In
  --     `lineup_fit_internal` a fixed player is seeded at his `wanted` slot
  --     UNCONDITIONALLY (112:498-505) and a fixed-owned slot is never
  --     traversed by the BFS (112:518) — `fixed` IS the matcher's own copy of
  --     the lock. Carrying 114's computation here would silently re-pin every
  --     kicked-off player at his stored slot, and the verb would look like it
  --     worked while refusing to move the one player it exists to move.
  --     With FALSE throughout, `lineup_fit_internal` is reused BYTE-UNCHANGED
  --     and still enforces position eligibility.
  --     Input order is then just submitted-key ordinality — still deterministic.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id', v_by_pid -> x.pid ->> 'player_id',
           'position',  v_by_pid -> x.pid ->> 'position',
           'wanted',    x.key,
           'fixed',     FALSE) ORDER BY x.ord), '[]'::jsonb)
  INTO v_fit_players
  FROM (
    SELECT e.key, e.value #>> '{}' AS pid, e.ord
    FROM jsonb_each(p_slot_map) WITH ORDINALITY AS e(key, value, ord)
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = e.key)
  ) x;
  v_fit := public.lineup_fit_internal(v_slots, v_fit_players);
  -- E16 is NOT lifted — see WHAT IS NOT LIFTED in the banner (season gate
  -- invariant 2 reds on any stored lineup the fit cannot seat, F324).
  IF jsonb_array_length(v_fit -> 'unplaced') > 0 THEN
    v_pid := v_fit -> 'unplaced' ->> 0;
    v_key := v_seen ->> v_pid;
    RAISE EXCEPTION
      'commish_edit_lineup: % (%) cannot be placed — no legal arrangement fills the slots (E16): "%" accepts % and every slot % could take is held by a player with nowhere else to go (unplaced: %)',
      v_by_pid -> v_pid ->> 'name', v_by_pid -> v_pid ->> 'position', v_key,
      (SELECT string_agg(x #>> '{}', '/') FROM jsonb_array_elements((SELECT s -> 'eligible' FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)) x),
      v_by_pid -> v_pid ->> 'name',
      v_fit -> 'unplaced'
      USING ERRCODE = 'P0001';
  END IF;
  v_canon := v_canon || (v_fit -> 'assignment');

  -- (9) IR MOVES, against the CURRENT week — 114:514-579 with DIFFERENCE (A4):
  --     the two Restricted-IR STINT refusals and the two IR LOCK-TIMING
  --     refusals are NOT copied. §11.2:727 names the stint override in so many
  --     words ("Restricted stint still applies; commissioner can override");
  --     the timing gates are the IR analogue of the two lock arms. The
  --     DESIGNATION eligibility gate IS kept — it is a legality rule, and the
  --     already-placed-but-ineligible case stays a FLAG exactly as 114 has it.
  --     Every gate walked past is recorded in v_bypassed.
  FOR v_spot IN SELECT * FROM jsonb_array_elements(v_ir_spots) LOOP
    v_pid := v_canon ->> (v_spot ->> 'key');
    CONTINUE WHEN v_pid IS NULL;
    v_e := v_by_pid -> v_pid;
    IF (v_e ->> 'ir_placed_week') IS NULL OR (v_e ->> 'slot_key') IS DISTINCT FROM (v_spot ->> 'key') THEN
      IF (v_e ->> 'ir_placed_week') IS NOT NULL AND (v_e ->> 'ir_lock_until_week') IS NOT NULL
         AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
        v_bypassed := v_bypassed || to_jsonb(('ir_restricted_stint:' || v_pid)::text);
      END IF;
      IF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
        RAISE EXCEPTION
          'commish_edit_lineup: % holds designation % — IR spot % accepts only % (§7.3.2 IR slot rules)',
          v_e ->> 'name', COALESCE(v_e ->> 'designation', 'none'), v_spot ->> 'spot',
          (SELECT string_agg(x #>> '{}', ', ') FROM jsonb_array_elements(v_spot -> 'designations') x)
          USING ERRCODE = 'P0001';
      END IF;
      IF (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
         AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
        v_bypassed := v_bypassed || to_jsonb(('ir_lock_timing:' || v_pid)::text);
      END IF;
      v_ir_placed := v_ir_placed || jsonb_build_object(
        'player_id', v_pid, 'spot', v_spot ->> 'key', 'type', v_spot ->> 'type',
        'ir_placed_week', v_current,
        'ir_lock_until_week', CASE WHEN v_spot ->> 'type' = 'restricted'
                                   THEN v_current + COALESCE((v_spot ->> 'min_weeks')::int, 4) END);
    ELSIF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
      v_flags_irin := v_flags_irin || to_jsonb(v_pid);
    END IF;
    v_ir_out := v_ir_out || jsonb_build_object(
      'slot', v_spot ->> 'key', 'player_id', v_pid, 'position', v_e ->> 'position',
      'designation', v_e ->> 'designation',
      'ir_placed_week', COALESCE((SELECT (x ->> 'ir_placed_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid), (v_e ->> 'ir_placed_week')::int),
      'ir_lock_until_week', CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 THEN (SELECT (x ->> 'ir_lock_until_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 ELSE (v_e ->> 'ir_lock_until_week')::int END,
      'flags', CASE WHEN v_flags_irin ? v_pid THEN '["ir_ineligible"]'::jsonb ELSE '[]'::jsonb END);
  END LOOP;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    CONTINUE WHEN (v_e ->> 'ir_placed_week') IS NULL;
    v_pid := v_e ->> 'player_id';
    CONTINUE WHEN v_pid = ANY (v_ir_now);
    IF (v_e ->> 'ir_lock_until_week') IS NOT NULL AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
      v_bypassed := v_bypassed || to_jsonb(('ir_restricted_stint:' || v_pid)::text);
    END IF;
    IF (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
       AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
      v_bypassed := v_bypassed || to_jsonb(('ir_lock_timing:' || v_pid)::text);
    END IF;
    v_ir_removed := v_ir_removed || jsonb_build_object('player_id', v_pid, 'spot', v_e ->> 'slot_key');
  END LOOP;

  -- (10) STARTERS (derived render state) + flags; bench = roster − starters − IR.
  --      Verbatim 114:581-631. The starters[] element shape
  --      {slot, slot_key, label, player_id, position, kickoff_at, flags} is a
  --      HARD cross-file contract: `lineup_lock_tick` walks each element,
  --      reads `player_id`, compares `kickoff_at` as an INSTANT and rewrites
  --      it in place (116:701-726). A different shape either crashes that
  --      league's arm of the hourly job — whose handler swallows it into a
  --      WARNING (116:734-738), so the failure would be SILENT — or churns the
  --      row every hour.
  --      `locked_at` is the LEAST over EVERY occupied starting slot whose
  --      player has a non-NULL kickoff — NOT only those already kicked off.
  --      The tick recomputes it the same way (116:718-720) and would overwrite
  --      any other value.
  v_locked_at := NULL;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_canon ->> v_key;
    v_pflags := '[]'::jsonb;
    IF v_pid IS NULL THEN
      v_pflags := v_pflags || '"empty"'::jsonb;
      v_flags_empty := v_flags_empty || to_jsonb(v_key);
    ELSE
      v_p := v_by_pid -> v_pid;
      IF (v_kick -> v_pid ->> 'on_bye')::boolean THEN
        v_pflags := v_pflags || '"bye"'::jsonb;
        v_flags_bye := v_flags_bye || to_jsonb(v_pid);
      END IF;
      IF (v_p ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended') THEN
        v_pflags := v_pflags || '"out"'::jsonb;
        v_flags_out := v_flags_out || to_jsonb(v_pid);
      END IF;
      IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL THEN
        v_locked_at := LEAST(v_locked_at, (v_kick -> v_pid ->> 'kickoff_at')::timestamptz);
      END IF;
      -- §7.3.6 allow_illegal_lineups = FALSE. KEPT (see WHAT IS NOT LIFTED).
      -- 114's R739 clause is dropped from the predicate rather than carried:
      -- it exempts "the stored player's own game has kicked off and he is the
      -- stored occupant", i.e. "not the manager's to change" — and for a verb
      -- with no lock there is no such thing, so carrying it would be a clause
      -- that means nothing. The gate is therefore the plain one.
      IF NOT v_allow AND jsonb_array_length(v_pflags) > 0
         AND NOT (v_gone_kick ? v_pid AND (v_stored ->> v_key) = v_pid) THEN   -- 154 / F441: a kept start where it stands is the week's record, not a submit
        RAISE EXCEPTION
          'commish_edit_lineup: % is % for week % and allow_illegal_lineups is off — slot "%" is blocked at submit (§7.3.6); bench him, start someone who plays, or turn the setting on',
          v_p ->> 'name', CASE WHEN v_pflags ? 'bye' THEN 'on bye' ELSE 'OUT (' || (v_p ->> 'designation') || ')' END,
          p_week, v_key
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    v_starters := v_starters || jsonb_build_object(
      'slot', v_key, 'slot_key', v_e ->> 'slot', 'label', v_e ->> 'label',
      'player_id', v_pid,
      'position', CASE WHEN v_pid IS NULL THEN NULL ELSE v_by_pid -> v_pid ->> 'position' END,
      'kickoff_at', CASE WHEN v_pid IS NULL THEN NULL ELSE v_kick -> v_pid ->> 'kickoff_at' END,
      'flags', v_pflags);
  END LOOP;
  SELECT COALESCE(jsonb_agg(to_jsonb(e ->> 'player_id') ORDER BY e ->> 'player_id'), '[]'::jsonb)
  INTO v_bench
  FROM jsonb_array_elements(v_roster) e
  WHERE NOT ((e ->> 'player_id') = ANY (v_started))
    AND NOT ((e ->> 'player_id') = ANY (v_ir_now));

  -- (11) NO-OP BY NAME (rule 10, and Chris's one condition). DETECTED, never
  --      inferred from an empty write: the canonical map equals the stored map
  --      and no IR move. jsonb equality, so key order is irrelevant.
  v_no_changes := (v_canon = v_stored)
                  AND jsonb_array_length(v_ir_placed) = 0
                  AND jsonb_array_length(v_ir_removed) = 0;

  -- Which starters changed — the enqueue set (see SCORING). Computed here so
  -- the result can report it whether or not the write happens.
  SELECT COALESCE(array_agg(e.value #>> '{}'), ARRAY[]::text[])
  INTO v_old_start
  FROM jsonb_each(v_stored) e
  WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = e.key);
  v_rescore := ARRAY(
    SELECT x FROM unnest(v_old_start) x WHERE NOT (x = ANY (v_started))
    UNION
    SELECT x FROM unnest(v_started) x WHERE NOT (x = ANY (v_old_start)));

  v_score_stale := FALSE;
  v_stale_why   := NULL;

  IF NOT v_no_changes THEN
    -- (12) WRITE — the lineup row, then the roster's slot_key/IR columns.
    --       DIFFERENCE (E): edited_by_commish is the literal TRUE.
    --       DIFFERENCE (G): set_at rides the seam.
    UPDATE public.team_lineups
    SET slot_map          = v_canon,
        starters          = v_starters,
        bench             = v_bench,
        locked_at         = v_locked_at,
        edited_by_commish = TRUE,
        set_at            = p_at
    WHERE id = v_row.id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'commish_edit_lineup: updated % lineup rows for team % week %, expected 1', v_cnt, p_team_id, p_week
        USING ERRCODE = 'P0001';
    END IF;

    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_placed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week     = (v_e ->> 'ir_placed_week')::int,
          ir_lock_until_week = (v_e ->> 'ir_lock_until_week')::int,
          slot_key           = v_e ->> 'spot'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'commish_edit_lineup: IR placement of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_removed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week = NULL, ir_lock_until_week = NULL, slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'commish_edit_lineup: IR removal of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    -- (12b) THE SCORE. A lineup edit enqueues nothing on its own and the
    --       worker only notices a team through a STARTER's stat delta, so
    --       without this a post-kickoff edit moves the lineup and never moves
    --       the score. Read SCORING in the banner before touching the stamp.
    IF v_lw.status IN ('live', 'correction_window') AND array_length(v_rescore, 1) > 0 THEN
      INSERT INTO public.score_fanout (season, week, player_id, enqueued_at)
      SELECT v_league.season, p_week, ps.player_id, min(ps.updated_at)
      FROM public.player_stats ps
      WHERE ps.season = v_league.season AND ps.week = p_week
        AND ps.player_id = ANY (v_rescore)
        AND ps.updated_at IS NOT NULL
      GROUP BY ps.player_id
      ON CONFLICT (season, week, player_id) DO NOTHING;   -- never re-stamp a healthy row
      -- WHAT THIS FIELD MEANS, because a receipt that over-claims is the bug
      -- this whole banner is about: "a claimable queue row EXISTS for him",
      -- not "this statement inserted one". An untouched healthy row left by
      -- ON CONFLICT drains just as well, so it counts — but a player the
      -- INSERT could not queue is NEVER folded into silence.
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x), '[]'::jsonb) INTO v_enqueued
      FROM unnest(v_rescore) x
      WHERE EXISTS (SELECT 1 FROM public.score_fanout f
                    WHERE f.season = v_league.season AND f.week = p_week AND f.player_id = x);
      -- R968 — THE OMISSION, NAMED. `player_stats.updated_at` is NULLABLE
      -- (measured: information_schema.columns → is_nullable = YES), so a
      -- partial ingestion can leave a scoreable line the enqueue cannot stamp.
      -- That player is dropped from the queue silently unless we say so.
      SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::text[]) INTO v_unstamped
      FROM unnest(v_rescore) x
      WHERE EXISTS (SELECT 1 FROM public.player_stats ps
                    WHERE ps.season = v_league.season AND ps.week = p_week AND ps.player_id = x)
        AND NOT EXISTS (SELECT 1 FROM public.player_stats ps
                        WHERE ps.season = v_league.season AND ps.week = p_week AND ps.player_id = x
                          AND ps.updated_at IS NOT NULL);
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'player_id', x,
               'why', CASE WHEN x = ANY (v_unstamped) THEN 'stats_unstamped' ELSE 'no_stat_row' END) ORDER BY x), '[]'::jsonb)
      INTO v_not_enq
      FROM unnest(v_rescore) x
      WHERE NOT EXISTS (SELECT 1 FROM public.score_fanout f
                        WHERE f.season = v_league.season AND f.week = p_week AND f.player_id = x);
      IF array_length(v_unstamped, 1) > 0 THEN
        -- A line exists and may carry points; we could not give it a
        -- claimable stamp. That is a lineup that moved and a score that may
        -- not follow — the one thing this verb must never report as success.
        v_score_stale := TRUE;
        v_stale_why   := 'stats_unstamped';
      END IF;
      -- A rescore player with NO stat line at all is NOT stale: the worker
      -- scores an absent line as 0 (`no_stat_row`), so adding or removing him
      -- moves no points. He is still named in `score_not_enqueued` rather
      -- than inferred from an empty array.
    ELSIF v_lw.status = 'final' AND array_length(v_rescore, 1) > 0 THEN
      -- The write door raises `week_final` (119:566-568) and the worker
      -- consumes the queue row with no cell changed (:892-895) — an enqueue
      -- here would delete itself having done nothing. Say so instead.
      -- R969: gated on v_rescore like the other two arms. A pure slot
      -- rearrangement or an IR-only move on a final week changes NO starter
      -- set, so there is no score to chase and a `score_stale` there is a
      -- false alarm in the one field whose whole job is to be believed.
      v_score_stale := TRUE;
      v_stale_why   := 'week_final';
    ELSIF array_length(v_rescore, 1) > 0 THEN
      -- `upcoming`: nothing has been scored yet, so there is nothing stale.
      v_stale_why := NULL;
    END IF;

    -- (12c) THE RECEIPT (§10.3, §15.4:1689). Exactly one audit row, in THIS
    --       transaction, INSIDE the no-op guard — Chris's one condition:
    --       "no receipt if nothing is done. only when something is done."
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'edit_lineup', 'team', p_team_id::text, v_reason,
      v_before,
      jsonb_build_object(
        'slot_map', v_canon, 'starters', v_starters, 'bench', v_bench,
        'locked_at', v_locked_at, 'edited_by_commish', TRUE, 'set_at', p_at),
      jsonb_build_object(
        'week',                p_week,
        'current_week',        v_current,
        'season',              v_league.season,
        'week_status',         v_lw.status,
        'team_name',           v_team.name,
        'action_id',           p_action_id,
        -- The whole point of the verb, made legible: every rule this edit
        -- walked past, and every kicked-off player it moved.
        'bypassed',            v_bypassed,
        'locked_players_moved', v_moved_lock,
        'ir_moves',            jsonb_build_object('placed', v_ir_placed, 'removed', v_ir_removed),
        'flags',               jsonb_build_object('bye', v_flags_bye, 'out', v_flags_out,
                                                  'empty', v_flags_empty, 'ir_ineligible', v_flags_irin),
        'score_enqueued',      v_enqueued,
        'score_not_enqueued',  v_not_enq,
        'score_stale',         v_score_stale,
        'score_stale_reason',  v_stale_why),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_edit_lineup: the audit row was not written — refusing to let the edit stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- §10.3: override system messages auto-post to league chat and CANNOT be
    -- disabled. D97/D290's in-txn post, reworded as the override post.
    v_message := 'Week ' || p_week || ' lineup for ' || v_team.name || ' edited by '
      || public.draft_actor_name() || ' (commissioner override'
      || CASE WHEN jsonb_array_length(v_moved_lock) > 0
              THEN ', ' || jsonb_array_length(v_moved_lock) || ' player'
                   || CASE WHEN jsonb_array_length(v_moved_lock) = 1 THEN '' ELSE 's' END
                   || ' moved after kickoff'
              ELSE '' END
      || ')' || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional, never 'reason: <NULL>'
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);

    IF p_week = v_current THEN
      -- slot_key describes the ACTIVE week only, so a RETROACTIVE edit
      -- correctly leaves it alone — 114's guard is right as written.
      v_expected := 0;
      FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit -> 'assignment') LOOP
        CONTINUE WHEN v_gone_kick ? (v_val #>> '{}');   -- 154 / F441: off this roster — no roster row of his to write
        UPDATE public.league_rosters r SET slot_key = v_key
        WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = (v_val #>> '{}');
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        v_expected := v_expected + v_cnt;
      END LOOP;
      IF v_expected <> COALESCE(array_length(v_started, 1), 0)
                       - (SELECT count(*)::int FROM jsonb_object_keys(v_gone_kick) g WHERE g = ANY (v_started)) THEN
        RAISE EXCEPTION 'commish_edit_lineup: wrote slot_key for % starters, expected %', v_expected,
          COALESCE(array_length(v_started, 1), 0) - (SELECT count(*)::int FROM jsonb_object_keys(v_gone_kick) g WHERE g = ANY (v_started))
          USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.league_rosters r SET slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id
        AND r.player_id = ANY (SELECT x #>> '{}' FROM jsonb_array_elements(v_bench) x);
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> jsonb_array_length(v_bench) THEN
        RAISE EXCEPTION 'commish_edit_lineup: wrote slot_key = bn for % players, expected %', v_cnt, jsonb_array_length(v_bench)
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'team_id',                p_team_id,
    'season',                 v_league.season,
    'week',                   p_week,
    'current_week',           v_current,
    'action_id',              p_action_id,
    'lineup_lock',            v_league.lineup_lock,
    'allow_illegal_lineups',  v_allow,
    'no_changes',             v_no_changes,
    'rearranged',             (v_fit ->> 'rearranged')::boolean,
    'moved',                  v_fit -> 'moved',
    'slot_map',               v_canon,
    'starters',               v_starters,
    'bench',                  v_bench,
    'ir',                     v_ir_out,
    'ir_moves',               jsonb_build_object('placed', v_ir_placed, 'removed', v_ir_removed),
    'flags', jsonb_build_object(
      'illegal',       jsonb_array_length(v_flags_bye) + jsonb_array_length(v_flags_out) + jsonb_array_length(v_flags_irin) > 0,
      'bye',           v_flags_bye,
      'out',           v_flags_out,
      'empty',         v_flags_empty,
      'ir_ineligible', v_flags_irin),
    'locked_at',              v_locked_at,
    'edited_by_commish',      TRUE,
    'reason',                 v_reason,
    'system_post',            v_message,
    'evaluated_at',           p_at,
    'week_datum', jsonb_build_object(
      'first_kickoff_at', v_window.first_kickoff_at,
      'datum_arm',        v_window.datum_arm,
      'kicked_off',       NOT v_window.free),
    'current_week_datum', jsonb_build_object(
      'first_kickoff_at', v_window_cur.first_kickoff_at,
      'datum_arm',        v_window_cur.datum_arm,
      'kicked_off',       NOT v_window_cur.free),
    -- 123's own keys. The receipt, what the override walked past, and whether
    -- the SCORE followed — said by name, never left to be inferred.
    'commissioner_action_id', v_audit_id,      -- NULL on a no-op, and that is the point
    'week_status',            v_lw.status,
    'bypassed',               v_bypassed,
    'locked_players_moved',   v_moved_lock,
    'score_enqueued',         v_enqueued,
    'score_not_enqueued',     v_not_enq,
    'score_stale',            v_score_stale,
    'score_stale_reason',     v_stale_why
  );

  -- The idempotency ledger row is written for a NO-OP TOO (114:748's posture):
  -- an action_id is consumed by its submit whether or not anything moved, so a
  -- retry replays instead of re-evaluating. This is the OPPOSITE rule from the
  -- audit row above, and deliberately so — §12.26: "an action_id is an
  -- idempotency key, not an audit record".
  INSERT INTO public.commish_lineup_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_edit_lineup_internal(UUID, UUID, INTEGER, JSONB, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. lineup_autopilot_internal — CREATE OR REPLACE against 152:2881-3489's
--    FILE TEXT (D137; definers 125 / 138 / 139 / 142 / 152 — 152 newest,
--    measured by grep), 5 hunks (+32 / -3): DECLARE; the kept judgment
--    through the shared helper; a kept starter is seated unconditionally; a
--    candidate another team already starts this league-week is never offered
--    (named in skipped_locked[] with `started_by`); its unfillable reason.
--    The caller (lineup_lock_tick, 139) is untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_autopilot_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_season    INTEGER,
  p_week      INTEGER,
  p_at        TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_row         public.team_lineups;
  v_allow       BOOLEAN;
  v_roster      JSONB;
  v_by_pid      JSONB := '{}'::jsonb;
  v_slots       JSONB;
  v_ir_spots    JSONB;
  v_stored      JSONB;
  v_kick        JSONB := '{}'::jsonb;
  v_map         JSONB := '{}'::jsonb;
  v_ir_held     TEXT[] := ARRAY[]::text[];
  v_seated      TEXT[] := ARRAY[]::text[];   -- players staying where they are
  v_fixed       JSONB := '[]'::jsonb;        -- fit input: those same players
  v_free        JSONB := '[]'::jsonb;        -- fit input: HEALTHY unlocked candidates
  v_tail        JSONB := '[]'::jsonb;        -- fit input: the unhealthy tail (allow = TRUE)
  v_displace    JSONB := '{}'::jsonb;        -- slot key → vacated unhealthy starter
  v_restored    JSONB := '[]'::jsonb;
  v_locked_out  JSONB := '[]'::jsonb;        -- skipped_locked[]
  v_filtered    JSONB := '[]'::jsonb;        -- refused by the allow = FALSE hard filter
  v_fit_a       JSONB;
  v_fit_b       JSONB;
  v_players_b   JSONB := '[]'::jsonb;
  v_assign      JSONB;
  v_filled      JSONB := '[]'::jsonb;
  v_subbed      JSONB := '[]'::jsonb;
  v_unfill      JSONB := '[]'::jsonb;
  v_starters    JSONB := '[]'::jsonb;
  v_bench       JSONB;
  v_started     TEXT[] := ARRAY[]::text[];
  v_locked_at   TIMESTAMPTZ;
  v_pflags      JSONB;
  v_empties     INTEGER := 0;
  v_sick        INTEGER := 0;               -- unhealthy UNLOCKED seated starters
  v_e           JSONB;
  v_p           JSONB;
  v_k           RECORD;
  v_key         TEXT;
  v_val         JSONB;
  v_pid         TEXT;
  v_elig        JSONB;
  v_locked      BOOLEAN;
  v_unhealthy   BOOLEAN;
  v_changed     BOOLEAN;
  v_reason      TEXT;
  -- 138 (L.E1.21, Q62): the read-side freshness bound (F387's read half /
  -- F389(c)) — the SAME six hours as the compute half's
  -- `PROJECTION_MAX_AGE_MS` (`player-values.ts`), pinned equal by a unit cell.
  c_max_age     CONSTANT INTERVAL := interval '6 hours';
  v_tail_d      JSONB := '[]'::jsonb;        -- fit input: the DOUBTFUL tail — ahead of v_tail, under BOTH settings
  v_blocked     BOOLEAN;                     -- bye or a §7.3.6 blocking designation (Doubtful is NOT one)
  v_basis       JSONB;                       -- order_basis: what ordered this pass, and why a key was absent
  -- 142 (L.E1.25, Q68 RULED): pass 1b — a Doubtful replacement for a BLOCKED
  -- starter nobody healthy replaced.
  v_defer       JSONB := '{}'::jsonb;        -- slot key → vacated BLOCKED starter with no healthy replacement
  v_dslots      JSONB;                       -- pass 1b's slots: exactly those keys
  v_players_d   JSONB := '[]'::jsonb;        -- pass 1b's candidates: the unseated Doubtful tail
  v_fit_d       JSONB;
  v_d_in        TEXT[] := ARRAY[]::text[];   -- Doubtful men pass 1b seated (fixed in pass 2)
  -- 154 / F441 · F445: stored off-roster starters KEPT for the week, and the
  -- team (if any) that already starts a candidate this league-week.
  v_kept        TEXT[] := ARRAY[]::text[];
  v_else        JSONB;
BEGIN
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lineup_autopilot_internal: league % not found', p_league_id USING ERRCODE = 'P0002';
  END IF;

  -- The row must EXIST. D354 puts materialization in the caller, under the
  -- league lock, through the unchanged carry — so an absent row here is a
  -- caller bug and must be loud, never a silently invented lineup.
  SELECT tl.* INTO v_row
  FROM public.team_lineups tl
  WHERE tl.team_id = p_team_id AND tl.season = p_season AND tl.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'lineup_autopilot_internal: no team_lineups row for team % season % week % — the caller materializes through lineup_carry_internal first (D354); refusing to invent one',
      p_team_id, p_season, p_week
      USING ERRCODE = 'P0002';
  END IF;
  v_stored := COALESCE(v_row.slot_map, '{}'::jsonb);

  -- §7.3.6's per-league setting, read the way `set_lineup` reads it
  -- (`114:307`): absent ⇒ TRUE.
  v_allow := COALESCE((v_league.settings ->> 'allow_illegal_lineups')::boolean, TRUE);

  -- THE ROSTER, in 114/116's shape (positions normalised DEF → DST;
  -- designations bridged through `lineup_designation_internal`, 112:337),
  -- plus the four keys of the one sort below and an `order` object that says
  -- which key ordered each player and why an earlier key was absent.
  --
  -- Q62's SORT, AS RULED (Chris 2026-09-27; 138, L.E1.21), AND IT IS STILL
  -- THE WHOLE SELECTION POLICY. Placement is free (D340 — the matcher
  -- CHOOSES, and greedy-by-input-order over a transversal matroid is
  -- optimal), so "which players start" is this ORDER BY and nothing else:
  -- (1) THIS week's projected points, (2) season-to-date points, (3) preseason
  -- projected points — each under the league's scoring (§12.28, 137) — then
  -- (4) ADP, then player_id. POINTS, never ranks: across positions (a FLEX
  -- slot) Chris ruled "total scored points", and within a position points
  -- order exactly as positional rank does. ONE LEXICOGRAPHIC ORDER BY, PER
  -- PLAYER (the task's READING, flagged): a player with a key outranks every
  -- player without it; the later keys order only what the earlier leave NULL.
  --
  -- F389's JOIN CONTRACT. (a) A LEFT JOIN — a rostered player with no values
  -- row (acquired since the last hourly run; a league-week the job failed)
  -- stays in the pool with all three keys NULL and is NAMED in order_basis;
  -- (b) only the POINTS columns are sort keys — `*_missing` / `*_unscored`
  -- never are; (c) F387's READ HALF — a row whose `computed_at` is older than
  -- `c_max_age` at `p_at` is ABSENT (the values job has died), and a
  -- projection whose `projection_fetched_at` is older than `c_max_age` at
  -- `p_at` is ABSENT (the projections sync has died) ⇒ the next key orders.
  -- ALL FOUR JOIN PREDICATES ARE LOAD-BEARING (R1120, #316's fix round).
  -- The job writes the CURRENT and the NEXT week for every rostered player of
  -- every league, and one real player is rostered in many leagues: without
  -- `v.week = p_week` (or the season) he joins TWICE — two roster entries, and
  -- the matcher could seat one man in two slots — and without the league
  -- predicate he is ordered by ANOTHER league's scoring. pgTAP 086 gives a
  -- §C1 player a reversing row in each of those three places.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',      r.player_id,
           'name',           p.full_name,
           'position',       CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
           'designation',    public.lineup_designation_internal(p.status),
           'nfl_team',       p.team,
           'adp',            p.adp,
           'ir_placed_week', r.ir_placed_week,
           'slot_key',       r.slot_key,
           'order',          jsonb_build_object(
             'ordered_by',       CASE WHEN k.projected_points IS NOT NULL THEN 'projected_points'
                                      WHEN k.season_points    IS NOT NULL THEN 'season_points'
                                      WHEN k.preseason_points IS NOT NULL THEN 'preseason_points'
                                      WHEN p.adp              IS NOT NULL THEN 'adp'
                                      ELSE 'player_id' END,
             'projected_points', k.projected_points,
             'season_points',    k.season_points,
             'preseason_points', k.preseason_points,
             'adp',              p.adp,
             'value_row',        f.value_row,
             'projected_why',    CASE WHEN k.projected_points IS NOT NULL THEN NULL
                                      WHEN f.value_row <> 'fresh' THEN f.value_row
                                      WHEN v.projected_points IS NULL THEN v.projected_missing
                                      ELSE 'stale_line_at_read' END))
           ORDER BY k.projected_points DESC NULLS LAST, k.season_points DESC NULLS LAST,
                    k.preseason_points DESC NULLS LAST, p.adp ASC NULLS LAST, r.player_id ASC), '[]'::jsonb)
  INTO v_roster
  FROM public.league_rosters r
  JOIN public.players p ON p.id = r.player_id
  LEFT JOIN public.league_player_values v
    ON v.league_id = r.league_id AND v.season = p_season AND v.week = p_week AND v.player_id = r.player_id
  CROSS JOIN LATERAL (SELECT CASE WHEN v.player_id IS NULL THEN 'no_value_row'
                                  WHEN v.computed_at < p_at - c_max_age THEN 'stale_row'
                                  ELSE 'fresh' END AS value_row) f
  CROSS JOIN LATERAL (SELECT
           CASE WHEN f.value_row = 'fresh' AND v.projection_fetched_at >= p_at - c_max_age
                THEN v.projected_points END AS projected_points,
           CASE WHEN f.value_row = 'fresh' THEN v.season_points END AS season_points,
           CASE WHEN f.value_row = 'fresh' THEN v.preseason_points END AS preseason_points) k
  WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_by_pid := v_by_pid || jsonb_build_object(v_e ->> 'player_id', v_e);
  END LOOP;

  -- Slot instances in canonical order WITH their eligibility (the matcher's
  -- input, `114:355-362`), and the IR spots by key.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',      (s ->> 'key') || ':' || i,
           'slot',     s ->> 'key',
           'label',    s ->> 'label',
           'eligible', s -> 'eligible') ORDER BY ord, i), '[]'::jsonb)
  INTO v_slots
  FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') WITH ORDINALITY AS t(s, ord),
       LATERAL generate_series(0, COALESCE((s ->> 'count')::int, 0) - 1) i;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', (s ->> 'key') || ':0', 'spot', s ->> 'key') ORDER BY ord), '[]'::jsonb)
  INTO v_ir_spots
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord);

  -- A team with no roster has nothing to seat. Reported, never raised: one
  -- empty roster must not fail a league's whole tick.
  IF jsonb_array_length(v_roster) = 0 THEN
    RETURN jsonb_build_object(
      'league_id', p_league_id, 'team_id', p_team_id, 'season', p_season, 'week', p_week,
      'source', 'autopilot', 'slot_map', v_stored, 'starters', v_row.starters,
      'bench', v_row.bench, 'locked_at', v_row.locked_at,
      'filled', '[]'::jsonb, 'substituted', '[]'::jsonb, 'unfillable', '[]'::jsonb,
      'skipped_locked', '[]'::jsonb, 'restored', '[]'::jsonb,
      'allow_illegal_lineups', v_allow, 'changed', FALSE,
      'reason', 'empty_roster', 'evaluated_at', p_at);
  END IF;

  -- THE PER-PLAYER LOCK DATUM, read NOW from `nfl_games` at the injected
  -- instant (E42/§23.3) — the same helper and the same rendering 114 and 116
  -- use, so arm (b) finds nothing to change next minute.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_kickoff_internal(p_season, p_week, v_e ->> 'nfl_team', p_at);
    v_kick := v_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
  END LOOP;

  -- 152 / R1206 (Q32's amendment, verbatim: "if they are in the lineup they
  -- are stuck in the lineup"; D411): A PLAYED STARTER STAYS EVEN AFTER HE
  -- LEAVES THE ROSTER. After a week's last game a starter who played can be
  -- dropped, claimed away or traded while the week is still current, and 152
  -- keeps his start in that week's slot_map (the week is scored from it). A
  -- stored STARTING slot whose player is off this roster and whose OWN game
  -- for p_week has kicked off is his, not OPEN: he joins v_by_pid / v_kick
  -- (never v_roster — he is nobody's candidate and on no bench), so the
  -- classification below seats him as the locked starter he is (D338) and the
  -- fit keeps him fixed at his key. One whose game has not kicked off (a bye)
  -- did not play: his slot is OPEN, as before.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN v_by_pid ? v_pid;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key);
    SELECT jsonb_build_object(
             'player_id',   p.id,
             'name',        p.full_name,
             'position',    CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
             'designation', public.lineup_designation_internal(p.status),
             'nfl_team',    p.team,
             'off_roster',  TRUE)
    INTO v_e
    FROM public.players p WHERE p.id = v_pid;
    CONTINUE WHEN v_e IS NULL;
    -- 154 / F441 · F442 · F445: the ONE shared judgment (set_lineup (4b)'s and
    -- the commissioner's editor's): he played (his current team's game, this
    -- lineup's record of the slot, or a stat line for the week), or the week
    -- closed to moves before he left and he has a game this week. A KEPT
    -- starter is seated whatever his health or kickoff (the classification
    -- below) — his start is the week's record, never autopilot's to change.
    SELECT * INTO v_k FROM public.lineup_kept_starter_internal(p_season, p_week, v_pid, v_key, v_row.starters, p_at);
    CONTINUE WHEN NOT v_k.kept;   -- a bye / a game gone from the week: the slot stays OPEN
    v_kept := v_kept || v_pid;
    v_by_pid := v_by_pid || jsonb_build_object(v_pid, v_e);
    v_kick := v_kick || jsonb_build_object(v_pid, jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
  END LOOP;

  -- IR KEYS ARE CARRIED VERBATIM. IR occupancy is ROSTER-level state
  -- (D308/§11.2) and autopilot never moves it; its occupants are not
  -- candidates for a starting slot.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      v_pid := v_val #>> '{}';
      v_map := v_map || jsonb_build_object(v_key, v_pid);
      v_ir_held := v_ir_held || v_pid;
    END IF;
  END LOOP;

  -- CLASSIFY EVERY STARTING SLOT.
  --   · empty (or holding a player who has since left the roster WITHOUT
  --     having played — 152 / R1206: a played one is in v_by_pid, locked) ⇒ OPEN;
  --   · holding a LOCKED player ⇒ he stays, unconditionally (D338 — the lock
  --     binds autopilot exactly as it binds a manager);
  --   · holding a HEALTHY unlocked player ⇒ he stays (D340 — a carried or
  --     manager-set placement is NEVER overridden on value);
  --   · holding an UNLOCKED player who is on bye or carries a blocking
  --     designation ⇒ VACATED for the substitution pass, and restored below
  --     if no healthy replacement takes the key (Q63).
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_stored ->> v_key;
    IF v_pid IS NULL OR NOT (v_by_pid ? v_pid) THEN
      v_empties := v_empties + 1;
      CONTINUE;
    END IF;
    v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
    -- THE `COALESCE` AROUND THE `IN` IS LOAD-BEARING, AND IT WAS MISSING UNTIL
    -- #295's fix round CAUGHT IT WITH §J. `lineup_designation_internal`
    -- returns NULL for a healthy player (112:337 — measured: 'Active' ⇒ NULL),
    -- and `NULL IN (…)` is NULL, not FALSE. Unguarded, `v_unhealthy` was NULL
    -- for EVERY healthy seated starter, `NOT NULL` is NULL, and the `IF` fell
    -- to the ELSE: a healthy, manager-set or carried starter was DISPLACED and
    -- re-contested on value — a D340 violation — and, because such a man also
    -- re-entered the candidate pool below, `v_restored` could seat him at his
    -- old key while pass 1 had already placed him elsewhere, writing ONE PLAYER
    -- INTO TWO SLOTS. Invisible to every other cell in 073 because no other
    -- fixture ran the pass over a map with a HEALTHY SEATED STARTER in it; §J
    -- is that fixture, and it reds on the unguarded form.
    -- 138 (L.E1.21, Q62 RULED): `Doubtful` SITS — an unlocked Doubtful
    -- starter is VACATED here like a bye/OUT man, and pass 1 below either
    -- gives his key to a HEALTHY replacement or the restore clause puts him
    -- back ("yes start the doubtful"). He is NOT in the `out` starter flag
    -- further down: a Doubtful start is legal for a manager (114:596).
    v_unhealthy := COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                   OR COALESCE((v_by_pid -> v_pid ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended', 'Doubtful'), FALSE);
    IF v_locked OR NOT v_unhealthy OR v_pid = ANY (v_kept) THEN   -- 154: a kept off-roster starter stays, unconditionally
      v_seated := v_seated || v_pid;
      v_fixed := v_fixed || jsonb_build_object(
        'player_id', v_pid, 'position', v_by_pid -> v_pid ->> 'position',
        'wanted', v_key, 'fixed', TRUE);
    ELSE
      v_displace := v_displace || jsonb_build_object(v_key, v_pid);
      v_sick := v_sick + 1;
    END IF;
  END LOOP;

  -- THE SHORT-CIRCUIT (tasks-M6A L.E1.4 item 2), BEFORE ANY FIT CALL. Nothing
  -- to fill and nobody to substitute ⇒ no matcher runs and the caller writes
  -- nothing. It lives HERE, in the one place that holds both halves of the
  -- predicate, rather than being half-duplicated in the tick where the
  -- designations and kickoffs are not in scope — the load mitigation is the
  -- predicate, not the cadence.
  IF v_empties = 0 AND v_sick = 0 THEN
    RETURN jsonb_build_object(
      'league_id', p_league_id, 'team_id', p_team_id, 'season', p_season, 'week', p_week,
      'source', 'autopilot', 'slot_map', v_stored, 'starters', v_row.starters,
      'bench', v_row.bench, 'locked_at', v_row.locked_at,
      'filled', '[]'::jsonb, 'substituted', '[]'::jsonb, 'unfillable', '[]'::jsonb,
      'skipped_locked', '[]'::jsonb, 'restored', '[]'::jsonb,
      'allow_illegal_lineups', v_allow, 'changed', FALSE,
      'reason', 'no_empty_slot_and_no_unhealthy_unlocked_starter', 'evaluated_at', p_at);
  END IF;

  -- THE CANDIDATE POOLS, in the roster's Q62 order.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_pid := v_e ->> 'player_id';
    CONTINUE WHEN v_pid = ANY (v_ir_held);
    CONTINUE WHEN v_pid = ANY (v_seated);
    v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
    IF v_locked THEN
      -- D338: never lifted, and never silently dropped.
      v_locked_out := v_locked_out || jsonb_build_object(
        'player_id', v_pid, 'name', v_e ->> 'name', 'position', v_e ->> 'position',
        'kickoff_at', v_kick -> v_pid ->> 'kickoff_at',
        'reason', 'his game had already kicked off at the tick instant (§11.2, lineup_lock = per_player_kickoff) — autopilot does not inherit the commissioner''s exemption (D338)');
      CONTINUE;
    END IF;
    -- 154 / F441 · F445: ONE START PER PLAYER PER LEAGUE-WEEK. A candidate
    -- another team of this league already STARTS this week (a start kept
    -- after he left that team — D411 / D412(5)) is never offered: the write
    -- would be refused by name (team_lineups' trigger) and fail the league's
    -- tick. Named in skipped_locked[] (the tick reports it), never silently
    -- dropped (§4 rule 15).
    v_else := public.lineup_started_elsewhere_internal(p_league_id, p_team_id, p_season, p_week, v_pid);
    IF v_else IS NOT NULL THEN
      v_locked_out := v_locked_out || jsonb_build_object(
        'player_id', v_pid, 'name', v_e ->> 'name', 'position', v_e ->> 'position',
        'kickoff_at', v_kick -> v_pid ->> 'kickoff_at',
        'started_by', v_else ->> 'team_id',
        'reason', 'already in ' || (v_else ->> 'team_name') || '''s starting lineup for week ' || p_week
                  || ' — a player starts for at most one team per league-week (F441 / F445)');
      CONTINUE;
    END IF;
    -- Same `COALESCE` as the classification loop above, for the same reason and
    -- stated once there. Benign on this side (`IF NULL THEN` does not fire, so a
    -- healthy man landed in `v_free` anyway) and written explicitly regardless:
    -- the two loops must classify one player identically or the pools disagree.
    -- 138 (L.E1.21): the SAME unhealthy test as the classification loop
    -- (Doubtful included), split in two because the two halves take different
    -- paths. A BLOCKED man (bye / OUT / IR / PUP / NFI / Suspended) keeps
    -- 125's item-4c split exactly. A DOUBTFUL man is a PREFERENCE under BOTH
    -- settings — never the hard filter, since a Doubtful start is legal
    -- (114:596) — and his tail is offered AHEAD of the blocked tail, which is
    -- where he stood before this migration (he was healthy then): Doubtful
    -- now sits behind every healthy candidate and nothing else changed.
    v_blocked := COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                 OR COALESCE((v_e ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended'), FALSE);
    v_unhealthy := v_blocked OR COALESCE((v_e ->> 'designation') = 'Doubtful', FALSE);
    IF v_unhealthy THEN
      IF NOT v_blocked THEN
        v_tail_d := v_tail_d || jsonb_build_object(
          'player_id', v_pid, 'position', v_e ->> 'position', 'wanted', NULL, 'fixed', FALSE);
      ELSIF v_allow THEN
        -- A PREFERENCE, not a filter: seated LAST, never left out, because an
        -- empty slot is the zero this task exists to remove (item 4c).
        v_tail := v_tail || jsonb_build_object(
          'player_id', v_pid, 'position', v_e ->> 'position', 'wanted', NULL, 'fixed', FALSE);
      ELSE
        v_filtered := v_filtered || jsonb_build_object(
          'player_id', v_pid, 'position', v_e ->> 'position');
      END IF;
      CONTINUE;
    END IF;
    v_free := v_free || jsonb_build_object(
      'player_id', v_pid, 'position', v_e ->> 'position', 'wanted', NULL, 'fixed', FALSE);
  END LOOP;

  -- PASS 1 — the HEALTHY pass. Seated players are `fixed` at their own key;
  -- every vacated slot and every empty slot is contested by the healthy
  -- candidates in priority order. This is the pass that decides whether a
  -- substitution happens at all.
  v_fit_a := public.lineup_fit_internal(v_slots, v_fixed || v_free);

  -- Q63's RESTORE. A vacated unhealthy starter whose key nobody healthy took
  -- goes straight back where he was: autopilot substitutes only when a
  -- healthy, unlocked, eligible replacement ACTUALLY takes the slot, and it
  -- never turns an occupied slot into an empty one.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_displace) LOOP
    v_pid := v_val #>> '{}';
    IF (v_fit_a -> 'assignment' ->> v_key) IS NULL THEN
      -- 142 (L.E1.25, Q68 RULED 2026-09-27 — "yes, swap in the doubtful"): a
      -- vacated starter who is BLOCKED (on bye, or OUT / IR / PUP / NFI /
      -- Suspended) and whose key nobody healthy took is NOT restored yet — pass
      -- 1b below offers his key to the Doubtful tail first. A vacated DOUBTFUL
      -- starter is restored here as before: never one Doubtful for another.
      IF COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
         OR COALESCE((v_by_pid -> v_pid ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended'), FALSE) THEN
        v_defer := v_defer || jsonb_build_object(v_key, v_pid);
        CONTINUE;
      END IF;
      v_restored := v_restored || jsonb_build_object(
        'slot', v_key, 'player_id', v_pid, 'name', v_by_pid -> v_pid ->> 'name',
        'reason', 'no healthy, unlocked, eligible replacement existed — left exactly as he was (Q63)');
      v_seated := v_seated || v_pid;
      v_players_b := v_players_b || jsonb_build_object(
        'player_id', v_pid, 'position', v_by_pid -> v_pid ->> 'position',
        'wanted', v_key, 'fixed', TRUE);
    ELSE
      v_subbed := v_subbed || jsonb_build_object(
        'slot', v_key, 'out', v_pid, 'out_name', v_by_pid -> v_pid ->> 'name',
        'in', v_fit_a -> 'assignment' ->> v_key,
        'in_name', v_by_pid -> (v_fit_a -> 'assignment' ->> v_key) ->> 'name',
        'reason', CASE WHEN COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                       THEN 'on bye' ELSE 'designated ' || (v_by_pid -> v_pid ->> 'designation') END,
        -- 138: which Q62 key ordered the man who came IN, and why an earlier
        -- key was absent (§4 rule 15) — rides through the tick's autopiloted[].
        'order', v_by_pid -> (v_fit_a -> 'assignment' ->> v_key) -> 'order');
    END IF;
  END LOOP;

  -- PASS 1b — 142 (L.E1.25, Q68 RULED 2026-09-27: "yes, swap in the
  -- doubtful"). When no healthy, unlocked, eligible replacement exists, a
  -- DOUBTFUL one replaces a starter who is OUT / on bye. The contest is
  -- exactly the deferred BLOCKED keys (never an empty slot — pass 2 owns
  -- those, unchanged) and its candidates are the Doubtful tail in Q62 order,
  -- minus every man already staying where he is — so a restored Doubtful
  -- starter is never moved to another key (never one Doubtful for another).
  -- A locked man is never a candidate (the pool loop sent him to
  -- skipped_locked[]) and a locked starter was never vacated (D338). The
  -- Doubtful tail is a preference under BOTH `allow_illegal_lineups` values
  -- (a Doubtful start is legal, 114:596), so this runs under both — which is
  -- what restores production's (125) swap in a league that forbids illegal
  -- lineups (R1123). A deferred key no Doubtful man takes is restored exactly
  -- as Q63's clause restores it.
  IF v_defer <> '{}'::jsonb THEN
    SELECT COALESCE(jsonb_agg(t.s ORDER BY t.ord), '[]'::jsonb)
    INTO v_dslots
    FROM jsonb_array_elements(v_slots) WITH ORDINALITY AS t(s, ord)
    WHERE v_defer ? (t.s ->> 'key');
    FOR v_e IN SELECT * FROM jsonb_array_elements(v_tail_d) LOOP
      CONTINUE WHEN (v_e ->> 'player_id') = ANY (v_seated);
      v_players_d := v_players_d || v_e;
    END LOOP;
    v_fit_d := public.lineup_fit_internal(v_dslots, v_players_d);
    FOR v_key, v_val IN SELECT * FROM jsonb_each(v_defer) LOOP
      v_pid := v_val #>> '{}';
      IF (v_fit_d -> 'assignment' ->> v_key) IS NULL THEN
        v_restored := v_restored || jsonb_build_object(
          'slot', v_key, 'player_id', v_pid, 'name', v_by_pid -> v_pid ->> 'name',
          'reason', 'no healthy or Doubtful, unlocked, eligible replacement existed — left exactly as he was (Q63; Q68)');
        v_seated := v_seated || v_pid;
        v_players_b := v_players_b || jsonb_build_object(
          'player_id', v_pid, 'position', v_by_pid -> v_pid ->> 'position',
          'wanted', v_key, 'fixed', TRUE);
      ELSE
        v_d_in := v_d_in || (v_fit_d -> 'assignment' ->> v_key);
        v_players_b := v_players_b || jsonb_build_object(
          'player_id', v_fit_d -> 'assignment' ->> v_key,
          'position', v_by_pid -> (v_fit_d -> 'assignment' ->> v_key) ->> 'position',
          'wanted', v_key, 'fixed', TRUE);
        v_subbed := v_subbed || jsonb_build_object(
          'slot', v_key, 'out', v_pid, 'out_name', v_by_pid -> v_pid ->> 'name',
          'in', v_fit_d -> 'assignment' ->> v_key,
          'in_name', v_by_pid -> (v_fit_d -> 'assignment' ->> v_key) ->> 'name',
          'reason', CASE WHEN COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE)
                         THEN 'on bye' ELSE 'designated ' || (v_by_pid -> v_pid ->> 'designation') END,
          'why', 'no healthy, unlocked, eligible replacement existed — a Doubtful one replaces a starter who cannot play (Q68, ruled 2026-09-27)',
          'order', v_by_pid -> (v_fit_d -> 'assignment' ->> v_key) -> 'order');
      END IF;
    END LOOP;
  END IF;

  -- PASS 2 — the TAIL pass. Pass 1's whole assignment is re-seeded `fixed`
  -- (112:501-505 seeds a fixed player at his wanted key unconditionally, so
  -- pass 1's result is reproduced exactly), the restored men with it, and the
  -- remaining slots are offered to the unhealthy tail — which, when the
  -- league forbids illegal lineups, holds only the Doubtful men (138), so a
  -- slot only a BLOCKED man could take stays `unfillable`.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit_a -> 'assignment') LOOP
    v_players_b := v_players_b || jsonb_build_object(
      'player_id', v_val #>> '{}',
      'position', v_by_pid -> (v_val #>> '{}') ->> 'position',
      'wanted', v_key, 'fixed', TRUE);
  END LOOP;
  -- 138: the Doubtful tail FIRST, then the blocked tail (see the pool loop).
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_tail_d || v_tail) LOOP
    CONTINUE WHEN (v_e ->> 'player_id') = ANY (v_seated);
    -- 142 (Q68): a Doubtful man pass 1b seated is already fixed above.
    CONTINUE WHEN (v_e ->> 'player_id') = ANY (v_d_in);
    v_players_b := v_players_b || v_e;
  END LOOP;
  v_fit_b := public.lineup_fit_internal(v_slots, v_players_b);
  v_assign := v_fit_b -> 'assignment';
  v_map := v_map || v_assign;

  -- WHAT WAS FILLED, AND WHAT COULD NOT BE — with the slot KEY and a REASON
  -- string, never merely a short map (§4 rule 15).
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_elig := v_e -> 'eligible';
    v_pid := v_assign ->> v_key;
    IF v_pid IS NULL THEN
      v_unfill := v_unfill || jsonb_build_object('slot', v_key, 'slot_key', v_e ->> 'slot',
        'reason', CASE
          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_filtered) x WHERE v_elig ? (x ->> 'position'))
            THEN 'no healthy eligible player at ' || upper(v_e ->> 'slot') || '; league forbids illegal lineups'
          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_locked_out) x WHERE v_elig ? (x ->> 'position') AND x ? 'started_by')
            THEN 'no eligible player at ' || upper(v_e ->> 'slot') || ' free to start — another team of the league already starts him this week (F441 / F445)'
          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_locked_out) x WHERE v_elig ? (x ->> 'position'))
            THEN 'no unlocked eligible player at ' || upper(v_e ->> 'slot') || '; every candidate''s game had kicked off'
          ELSE 'no eligible player at ' || upper(v_e ->> 'slot') || ' on the roster' END);
    ELSIF (v_stored ->> v_key) IS DISTINCT FROM v_pid AND NOT (v_displace ? v_key) THEN
      v_filled := v_filled || jsonb_build_object('slot', v_key, 'player_id', v_pid,
        'name', v_by_pid -> v_pid ->> 'name', 'position', v_by_pid -> v_pid ->> 'position',
        'order', v_by_pid -> v_pid -> 'order');
    END IF;
  END LOOP;

  -- STARTERS + flags + `locked_at`, 114 (10)'s shape byte-for-byte
  -- (`114:618-624` / `116:528-533`). `bench` = roster − starters − IR.
  v_locked_at := NULL;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_map ->> v_key;
    v_pflags := '[]'::jsonb;
    IF v_pid IS NULL THEN
      v_pflags := v_pflags || '"empty"'::jsonb;
    ELSE
      v_p := v_by_pid -> v_pid;
      v_started := v_started || v_pid;
      IF COALESCE((v_kick -> v_pid ->> 'on_bye')::boolean, FALSE) THEN
        v_pflags := v_pflags || '"bye"'::jsonb;
      END IF;
      IF (v_p ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended') THEN
        v_pflags := v_pflags || '"out"'::jsonb;
      END IF;
      IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL THEN
        v_locked_at := LEAST(v_locked_at, (v_kick -> v_pid ->> 'kickoff_at')::timestamptz);
      END IF;
    END IF;
    v_starters := v_starters || jsonb_build_object(
      'slot', v_key, 'slot_key', v_e ->> 'slot', 'label', v_e ->> 'label',
      'player_id', v_pid,
      'position', CASE WHEN v_pid IS NULL THEN NULL ELSE v_by_pid -> v_pid ->> 'position' END,
      'kickoff_at', CASE WHEN v_pid IS NULL THEN NULL ELSE v_kick -> v_pid ->> 'kickoff_at' END,
      'flags', v_pflags);
  END LOOP;
  SELECT COALESCE(jsonb_agg(to_jsonb(e ->> 'player_id') ORDER BY e ->> 'player_id'), '[]'::jsonb)
  INTO v_bench
  FROM jsonb_array_elements(v_roster) e
  WHERE NOT ((e ->> 'player_id') = ANY (v_started))
    AND NOT ((e ->> 'player_id') = ANY (v_ir_held));

  -- THE NO-OP, BY VALUE. jsonb equality over the map — the same test
  -- `set_lineup` uses (`114:633`); the other three columns are projections of
  -- it, and arm (b) owns the kickoff refresh of an unchanged row.
  v_changed := (v_map IS DISTINCT FROM v_stored);
  v_reason := CASE
    WHEN v_changed THEN NULL
    WHEN jsonb_array_length(v_unfill) > 0 THEN 'nothing_fillable'
    ELSE 'no_change' END;

  -- 138 (L.E1.21): WHAT ORDERED THIS PASS, AND WHY A KEY WAS ABSENT (§4 rule
  -- 15; F389(a)). Over this pass's CANDIDATES: how many players each Q62 key
  -- ordered, every candidate with NO values row and every candidate whose row
  -- was STALE at `p_at` by name, and — when no candidate had any points key at
  -- all — that the pass FELL BACK TO ADP and the measured reason, never a
  -- quiet ADP order that looks like a projection order.
  -- THE CANDIDATES, NOT THE ROSTER (R1125, #316's fix round): only the men the
  -- pass actually OFFERED to the matcher un-fixed — `v_free`, `v_tail_d`,
  -- `v_tail`. An IR-held man, a seated (fixed) starter, a locked man and one
  -- the allow = FALSE filter refused are never ordered by this pass, so they
  -- are never counted: one valued IR man must not report "ordered by
  -- projection" for a pass whose every real candidate was ordered by ADP. A
  -- pass with NO candidate (an empty slot and nobody left to offer) says
  -- `candidates = 0` and did not fall back — nothing was ordered.
  SELECT jsonb_build_object(
           'candidates',        count(*),
           'by_key',            jsonb_build_object(
             'projected_points', count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'projected_points'),
             'season_points',    count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'season_points'),
             'preseason_points', count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'preseason_points'),
             'adp',              count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'adp'),
             'player_id',        count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by' = 'player_id')),
           'no_value_row',      COALESCE(jsonb_agg(e ->> 'player_id' ORDER BY e ->> 'player_id')
                                  FILTER (WHERE e -> 'order' ->> 'value_row' = 'no_value_row'), '[]'::jsonb),
           'stale_value_row',   COALESCE(jsonb_agg(e ->> 'player_id' ORDER BY e ->> 'player_id')
                                  FILTER (WHERE e -> 'order' ->> 'value_row' = 'stale_row'), '[]'::jsonb),
           'max_age',           c_max_age::text,
           'fell_back_to_adp',  count(*) > 0 AND count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by'
                                  IN ('projected_points', 'season_points', 'preseason_points')) = 0,
           'fallback_why',      CASE
             WHEN count(*) = 0 THEN NULL
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'ordered_by'
                    IN ('projected_points', 'season_points', 'preseason_points')) > 0 THEN NULL
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'value_row' = 'no_value_row') = count(*)
               THEN 'no_value_rows: league_player_values holds no row for any of this pass''s candidates for this league-week — the league-player-values job has not valued them; every candidate was ordered by ADP, then player_id (Q62 key 4)'
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'value_row' = 'stale_row') = count(*)
               THEN 'all_value_rows_stale: every one of this pass''s candidates'' league_player_values rows for this league-week was computed more than ' || c_max_age::text || ' before the tick instant — the job has stopped landing, so the rows were treated as absent (F387) and every candidate was ordered by ADP, then player_id'
             WHEN count(*) FILTER (WHERE e -> 'order' ->> 'value_row' = 'fresh') = 0
               THEN 'no_fresh_value_row: every candidate''s values row was absent or stale at the tick instant; every candidate was ordered by ADP, then player_id'
             ELSE 'no_points_in_any_value_row: fresh values rows exist but none carries a usable projected, season-to-date or preseason value (see each player''s order.projected_why); every candidate was ordered by ADP, then player_id' END)
  INTO v_basis
  FROM jsonb_array_elements(v_roster) e
  WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_free || v_tail_d || v_tail) c
                WHERE c ->> 'player_id' = e ->> 'player_id')
    -- 139 (L.E1.22, F392 / R1126): a vacated-then-RESTORED starter is back in
    -- `v_seated` and pass 2 skips him as seated, so the pass never ORDERED him —
    -- he is not a candidate, and counting him let one valued restored man
    -- report "ordered by projection" for a pass whose every real candidate
    -- was ordered by ADP (spec §7.2.1(c): "counted over the pass's candidates
    -- only").
    AND NOT ((e ->> 'player_id') = ANY (v_seated));

  RETURN jsonb_build_object(
    'league_id', p_league_id, 'team_id', p_team_id, 'season', p_season, 'week', p_week,
    'source', 'autopilot',
    'slot_map', v_map, 'starters', v_starters, 'bench', v_bench, 'locked_at', v_locked_at,
    'filled', v_filled, 'substituted', v_subbed, 'unfillable', v_unfill,
    'skipped_locked', v_locked_out, 'restored', v_restored,
    'allow_illegal_lineups', v_allow,
    'order_basis', v_basis,
    'changed', v_changed, 'reason', v_reason, 'evaluated_at', p_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_autopilot_internal(UUID, UUID, INTEGER, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
