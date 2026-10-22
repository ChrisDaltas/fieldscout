-- ============================================================================
-- 201 — a lineup save is never refused over a bye, an injury or an empty
--       slot: "Allow illegal lineups" is retired (live bug, SuperLeague v0.1
--       week 6, reported 2026-10-18; PROGRESS D591; spec v2.16.104 §7.3.6 /
--       §11.1 / §11.2)
-- ============================================================================
--
-- THE RULINGS (Chris, verbatim):
--   2026-10-18: "Injuries should not block roster moves and users are not
--   required to remove injured players from their lineups."
--   2026-10-20, on the "Allow illegal lineups" setting: "You can always start
--   a player on a buy [bye]. That's not against any rules. That's just not a
--   good idea. But if you're a Dumbo then you might accidentally start a
--   player on a buy. That shouldn't be blocking anyone from doing anything."
--   2026-10-20, on IR: "the only thing you can't do is put a player that's
--   not injured into an IR spot" — the IR rules stay exactly as they are.
--
-- THE DEFECT. With the league setting `allow_illegal_lineups` stored FALSE,
-- every lineup save re-checked every starter: ONE starter listed OUT / IR /
-- PUP / NFI / Suspended, or on a bye, in a slot whose game had not started
-- refused the WHOLE save — even when the manager only moved someone else,
-- and even for a save that changed nothing (the check ran before the no-op
-- test). The commissioner's lineup editor refused the same way, against
-- spec §7.3.6 / §11.1 ("never block the commissioner"). SuperLeague v0.1
-- stores it FALSE: "KC Concepcion is OUT, lineup not saved".
--
-- THE FIX — four bodies, each CREATE OR REPLACE against its NEWEST defining
-- migration's FILE TEXT (D137; `grep -n -i -E "function[[:space:]]+(public\.)?
-- <name>[[:space:]]*\("` over 001–200: 199 for the two lineup verbs, 157 for
-- autopilot, 180 for the policy — 200 touches none of them; each file body's
-- md5 equals the live prosrc on the local DB, head 200), derived by
-- derive_201.py; every added or changed line ends `-- 201 / D591`, and
-- pgTAP 151's pg_temp.un201 (the derivation's pairs reversed) gives each
-- source text back byte for byte and is an identity on every other body.
--   set_lineup_internal          199:5582-6268  md5 ebac166d… → 2 hunk(s) (+8 / -16)
--   commish_edit_lineup_internal 199:2498-3362  md5 6d14b2b4… → 2 hunk(s) (+8 / -32)
--   lineup_autopilot_internal    157:1090-1729  md5 544d32c6… → 7 hunk(s) (+12 / -15)
--   commish_setting_policy       180:46-108      md5 2550d16b… → 2 hunk(s) (+6 / -1)
--   1. set_lineup_internal (the manager's save, and set_lineup's commissioner
--      arm): the step (10) refusal is gone. A bye / OUT starter keeps his
--      `bye` / `out` flag on starters[] and in the result's flags, an empty
--      slot keeps `empty`, and the save is written (or is `no_changes` when
--      nothing changed). `v_allow` is the literal TRUE, so the result key
--      `allow_illegal_lineups` stays — always TRUE — for any reader of the
--      result shape (the app types it, nothing reads it; a replayed old
--      ledger row may still say FALSE).
--   2. commish_edit_lineup_internal: the same refusal is gone, the same way.
--   3. lineup_autopilot_internal: the setting-off branch is gone — a blocked
--      man (bye / OUT / IR / PUP / NFI / Suspended) is ALWAYS the tail,
--      seated LAST behind every healthy and Doubtful candidate (125 item 4c's
--      preference, now in every league), never filtered out; the
--      "…; league forbids illegal lineups" unfillable reason can no longer be
--      produced, so it is removed with v_filtered. Autopilot still prefers a
--      healthy man; its substitution and restore rules (Q63 / Q68) are
--      untouched.
--   4. commish_setting_policy: `allow_illegal_lineups` leaves the FREE list
--      and is refused BY NAME as a retired key (149's `bench_lock` pattern),
--      in plain words. A value already stored in `leagues.settings` is simply
--      ignored — no data rewrite and no CHECK (production holds FALSE in at
--      least SuperLeague v0.1; nothing reads it after this).
--
-- roster_add_drop_internal (the brief's "199 ~line 5735"): MEASURED, it does
-- NOT read the setting — 199:5735 is set_lineup_internal's read (5582–6268);
-- roster_add_drop_internal (199:5041–5577) has no `allow_illegal_lineups`,
-- and neither has any other live body but the four above and
-- commish_setting_canon_internal (its value-type check for the key, now
-- unreachable through the policy's refusal — left as is). So there is no
-- add / drop refusal over a bye / OUT / empty starter to retire; its IR and
-- lock rules are untouched.
--
-- WHAT IS UNCHANGED, STATED. Position eligibility and the fit (E16 — a WR
-- can't go in the K slot; Q59: it binds the commissioner too); the per-
-- player kickoff locks (§11.2) and the commissioner's timing override; one
-- start per player per league-week (154's trigger); the IR PLACEMENT rule
-- (only a player holding one of the spot's eligible designations moves INTO
-- an IR spot) and Restricted-IR stints, and the `ir_ineligible` flag on
-- results; the `bye` / `out` / `empty` flags and `flags.illegal`; scoring
-- (a bye / OUT starter scores what he scores — 0 if he does not play);
-- every other message. No new refusal is added (a healthy player left in an
-- IR spot blocking other moves is a separate follow-up).
--
-- DEPLOY BEFORE PUSH. SQL only — no signature, result key or type changes
-- shape (the policy's reply for one key moves from free to refused). Main
-- deploys before Chris's `db push`; until the push production keeps the old
-- refusal (its friendly-message phrase is gone from the app, so it reads in
-- the generic cleanup's words). Production gets 200 + 201 in one push.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4): four bodies replaced, signatures,
-- LANGUAGE, volatility (the lineup verbs and autopilot VOLATILE plpgsql, the
-- policy IMMUTABLE sql), SECURITY INVOKER (none of the four is DEFINER — the
-- `set_lineup` / `commish_edit_lineup` doors are, untouched), search_path ''
-- and ACLs unchanged (REVOKEs restated; autopilot's COMMENT restated with
-- its retired clause rewritten). No table, column, policy, index, grant,
-- trigger, realtime or cron change. No backfill. Typegen: unchanged.
-- pgTAP 151_lineup_saves_never_refused.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. set_lineup_internal — CREATE OR REPLACE against 199:5582-6268's FILE TEXT
--    (D137), 2 hunk(s) (+8 / -16): the bye / OUT refusal is gone; v_allow is TRUE.
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

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'set_lineup: league % has no season schedule yet, so there is no week to set a lineup in',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'set_lineup: week % is not on league %''s schedule for season % (it runs weeks %–%)',
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

  -- "Allow illegal lineups" is RETIRED (§7.3.6; Chris 2026-10-20: "That shouldn't be blocking   -- 201 / D591
  -- anyone from doing anything."): the stored value is ignored, and the result's   -- 201 / D591
  -- allow_illegal_lineups key stays for its readers, always TRUE.   -- 201 / D591
  v_allow := TRUE;   -- 201 / D591

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
  -- 157 / F447: each ROSTERED player's kickoff is judged per PLAYER — his
  -- current NFL team's game, or, when that is still ahead (or he has no
  -- team), a start this league recorded for a game that kicked off or his
  -- stat line for the week (lineup_player_kickoff_internal): a player the
  -- NFL released or traded AFTER he played is still locked for the week.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, p_week, v_e ->> 'player_id', p_at);
    v_kick := v_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    IF v_current <> p_week THEN
      SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, v_current, v_e ->> 'player_id', p_at);   -- 157 / F447
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
      -- The bye / OUT refusal that stood here is RETIRED with the setting: a bye or   -- 201 / D591
      -- injured starter, or an empty slot, never refuses a save. He keeps his flag (above)   -- 201 / D591
      -- and scores what he scores — 0 if he does not play. What still refuses a lineup:   -- 201 / D591
      -- the position fit (8), the kickoff locks (7), one start per week, and IR (9).   -- 201 / D591
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
      -- 169/L.E1.30 (F514) — THE RECEIPT: a commissioner setting a team he
      -- does not manage is a commissioner action (D363(2)) — one row per
      -- changed lineup, the team acted for in acting_as_team_id (§10.3). The
      -- no-op re-save wrote nothing above; a manager's own save (the
      -- commissioner's own team included) is not this arm.
      PERFORM public.draft_commish_receipt_internal(
        p_league_id, FALSE, 'set_lineup', 'edit_lineup', 'team', p_team_id::text, v_reason,
        jsonb_build_object('slot_map', v_stored),
        jsonb_build_object('slot_map', v_canon)
          || CASE WHEN jsonb_array_length(v_ir_placed) + jsonb_array_length(v_ir_removed) > 0
                  THEN jsonb_build_object('ir_moves', jsonb_build_object('placed', v_ir_placed, 'removed', v_ir_removed))
                  ELSE '{}'::jsonb END,
        jsonb_build_object('week', p_week, 'current_week', v_current, 'season', v_league.season,
                           'week_status', v_lw.status, 'team_name', v_team.name, 'action_id', p_action_id),
        p_team_id);
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
-- 2. commish_edit_lineup_internal — CREATE OR REPLACE against 199:2498-3362's
--    FILE TEXT (D137), 2 hunk(s) (+8 / -32): the same refusal is gone; v_allow is TRUE.
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
  v_kick        JSONB := '{}'::jsonb;   -- player_id → {kickoff_at, datum_arm, on_bye} for p_week (165 / F497: per PLAYER — 157's lineup_player_kickoff_internal; 164's receipt map folded in)
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

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'commish_edit_lineup: league % has no season schedule yet, so there is no week to set a lineup in',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'commish_edit_lineup: week % is not on league %''s schedule for season % (it runs weeks %–%)',
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

  -- "Allow illegal lineups" is RETIRED (§7.3.6; Chris 2026-10-20: "That shouldn't be blocking   -- 201 / D591
  -- anyone from doing anything."): the stored value is ignored, and the result's   -- 201 / D591
  -- allow_illegal_lineups key stays for its readers, always TRUE.   -- 201 / D591
  v_allow := TRUE;   -- 201 / D591

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
  -- 165 / F497: each player's kickoff is judged per PLAYER, exactly as
  -- set_lineup has recorded it since 157 (lineup_player_kickoff_internal —
  -- his current NFL team's game, or, when that is still ahead or he has no
  -- team, the kickoff he PLAYED in this week: a start this league recorded
  -- for a real, passed kickoff, or his stat line). A player the NFL released
  -- or traded after he played keeps his kickoff record, his place in
  -- locked_at and no bye flag through a commissioner edit (164 read his
  -- current team here: NULL + "bye" for a release, the new team's later
  -- game for a trade). The receipt reads the same map (164's parallel
  -- v_lock_kick / v_lock_kick_cur, folded in). Nothing here refuses.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, p_week, v_e ->> 'player_id', p_at);   -- 165 / F497
    v_kick := v_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    IF v_current <> p_week THEN
      SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, v_current, v_e ->> 'player_id', p_at);   -- 165 / F497
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
  --     164 / F467: judged per PLAYER — the lock a manager faces since 157 —
  --     so the record names every player a manager could not have moved
  --     (165 / F497: that datum is v_kick itself now; 164's parallel map
  --     is folded into it).
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
      -- The bye / OUT refusal that stood here is RETIRED with the setting (it refused the   -- 201 / D591
      -- commissioner too — spec §7.3.6 / §11.1 said he is never refused): a bye or injured   -- 201 / D591
      -- starter, or an empty slot, never refuses a save. He keeps his flag (above) and   -- 201 / D591
      -- scores what he scores. The position fit (8) and one start per week still bind.   -- 201 / D591
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
      -- 170/L.E1.31 (D451) — acting_as_team_id = THE TEAM. The commissioner
      -- set this team's lineup: a manager's act done for the team (§10.3:711
      -- "set when the commissioner acts on behalf of any team, most commonly
      -- an orphaned one"). set_lineup's commissioner arm has written the same
      -- action_type with it since 169; one action_type, one shape. His OWN
      -- team is his own act, not one on its behalf: NULL (169's arm, R1334).
      CASE WHEN EXISTS (SELECT 1 FROM public.league_members m
                        WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id)
           THEN NULL ELSE p_team_id END);
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
-- 3. lineup_autopilot_internal — CREATE OR REPLACE against 157:1090-1729's FILE
--    TEXT (D137; definers 125 / 138 / 139 / 142 / 152 / 154 / 157 — 157 newest),
--    7 hunk(s) (+12 / -15): the setting-off branch and its unfillable reason are gone.
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
  -- (v_filtered — the allow = FALSE hard filter's refusals — is gone with the setting)   -- 201 / D591
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

  -- §7.3.6's "Allow illegal lineups" is RETIRED (Chris 2026-10-20): the stored value is   -- 201 / D591
  -- ignored. A blocked man (bye / OUT / IR / PUP / NFI / Suspended) is always the TAIL —   -- 201 / D591
  -- seated LAST, behind every healthy and Doubtful candidate, never filtered out — and   -- 201 / D591
  -- the result's allow_illegal_lineups key stays for its readers, always TRUE.   -- 201 / D591
  v_allow := TRUE;   -- 201 / D591

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
  -- 157 / F447: judged per PLAYER (set_lineup's step (6) helper) — a player
  -- the NFL released or traded after he played is locked, never OPEN.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, p_season, p_week, v_e ->> 'player_id', p_at);
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
      ELSE   -- a blocked man is always the tail: the allow = FALSE hard filter is retired   -- 201 / D591
        -- A PREFERENCE, not a filter: seated LAST, never left out, because an
        -- empty slot is the zero this task exists to remove (item 4c).
        v_tail := v_tail || jsonb_build_object(
          'player_id', v_pid, 'position', v_e ->> 'position', 'wanted', NULL, 'fixed', FALSE);
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
  -- remaining slots are offered to the unhealthy tail — the Doubtful men first, then   -- 201 / D591
  -- the blocked men — so a slot any unlocked eligible man could take is filled.   -- 201 / D591
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
          -- (the "league forbids illegal lineups" reason is retired with the setting)   -- 201 / D591
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
  -- `v_tail`. An IR-held man, a seated (fixed) starter and a locked man are   -- 201 / D591
  -- never ordered by this pass, so they   -- 201 / D591
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
COMMENT ON FUNCTION lineup_autopilot_internal(UUID, UUID, INTEGER, INTEGER, TIMESTAMPTZ) IS
  '§7.2.1(c) autopilot (125, L.E1.4 — D337/D338/D339/D340/D354; 138, L.E1.21 — Q62/Q63 RULED, D375; 201, D591). PURE: reads the roster, the slots, the designations, the per-player kickoffs and the league-scored values (137) at p_at and RETURNS the 114-shaped row it would write (slot_map/starters/bench/locked_at) plus filled[]/substituted[] (each with its `order`)/unfillable[]/skipped_locked[]/restored[]/order_basis/changed/reason. Writes nothing — lineup_lock_tick arm (c) is the writer. Places exclusively through lineup_fit_internal (D340); candidate order is ONE lexicographic clause (Q62: this week''s projected points DESC, season-to-date points DESC, preseason points DESC — each NULLS LAST, a values row or projection older than 6h at p_at treated as absent (F387/F389) — then adp ASC NULLS LAST, player_id ASC); never lifts the per-player kickoff lock (D338); substitutes only an unlocked bye/blocked/Doubtful starter and only when a HEALTHY replacement takes the key, else restores him (Q63; "yes start the doubtful"); Doubtful is a preference, never the out flag; a blocked man (bye / OUT / IR / PUP / NFI / Suspended) is always seated LAST, behind every healthy and Doubtful candidate, and never filtered out — the allow_illegal_lineups setting is retired (201, Chris 2026-10-20).';

-- ---------------------------------------------------------------------------
-- 4. commish_setting_policy — CREATE OR REPLACE against 180:46-108's FILE TEXT
--    (D137; definers 129 / 149 / 180 — 180 newest), 2 hunk(s) (+6 / -1): allow_illegal_lineups
--    is a retired key, refused by name.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_setting_policy(p_key TEXT)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    -- FREE, typed columns
    WHEN p_key IN ('waiver_type')          THEN jsonb_build_object('storage', 'column', 'class', 'free', 'refused_why', NULL)
    WHEN p_key IN ('faab_budget')          THEN jsonb_build_object('storage', 'column', 'class', 'free', 'refused_why', NULL)
    WHEN p_key IN ('trade_review')         THEN jsonb_build_object('storage', 'column', 'class', 'free', 'refused_why', NULL)
    WHEN p_key IN ('trade_deadline_week')  THEN jsonb_build_object('storage', 'column', 'class', 'free', 'refused_why', NULL)
    WHEN p_key IN ('roster_settings')      THEN jsonb_build_object('storage', 'column', 'class', 'free', 'refused_why', NULL)
    -- FREE, blob
    WHEN p_key IN ('faab_min_bid', 'faab_tiebreaker',
         'waiver_run_days', 'waiver_run_time', 'waiver_time_zone',            -- 149 (Q70)
         'free_agency_opens', 'free_agency_open_day', 'free_agency_open_time', -- 149 (Q70)
         'acquisitions_per_week', 'acquisitions_per_season',
         'fa_hold_hours',
         'trade_veto_votes', 'trade_review_period_hours', 'allow_faab_in_trades',
         'allow_future_considerations', 'trade_lock_behavior',
         'auto_sub_inactives', 'stat_correction_window',   -- 201 / D591: allow_illegal_lineups is retired, refused below
         'tiebreakers', 'playoff_reseed')
                                THEN jsonb_build_object('storage', 'blob', 'class', 'free', 'refused_why', NULL)
    -- RESCORE
    WHEN p_key IN ('scoring_system_id')    THEN jsonb_build_object('storage', 'column', 'class', 'rescore', 'refused_why', NULL)
    -- BRACKET (refused once the bracket exists — the verb decides by status)
    WHEN p_key IN ('playoff_teams')        THEN jsonb_build_object('storage', 'column', 'class', 'bracket', 'refused_why',
                                  'The playoff bracket has already been set from this, so it can''t change once the playoffs start.')
    WHEN p_key IN ('playoff_weeks_per_round', 'consolation_bracket', 'third_place_game')
                                THEN jsonb_build_object('storage', 'blob', 'class', 'bracket', 'refused_why',
                                  'The playoff bracket has already been set from this, so it can''t change once the playoffs start.')
    -- REFUSED, always through this verb
    WHEN p_key IN ('regular_season_weeks', 'playoff_start_week')
                                THEN jsonb_build_object('storage', 'column', 'class', 'refused', 'refused_why',
                                  'The season''s weeks and matchups are already set, so the length of the regular season and when the playoffs start can only change before the draft.')
    WHEN p_key IN ('team_count')           THEN jsonb_build_object('storage', 'column', 'class', 'refused', 'refused_why',
                                  'The number of teams can only change before the draft — every team already has its place and its schedule.')
    WHEN p_key IN ('schedule_mode', 'median_game', 'second_opponent')
                                THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'The schedule has already been made from this, so it can only change before the draft.')
    WHEN p_key IN ('format')               THEN jsonb_build_object('storage', 'column', 'class', 'refused', 'refused_why',
                                  'Leagues are redraft only for now — there''s nothing else to switch to.')
    WHEN p_key IN ('lineup_lock')          THEN jsonb_build_object('storage', 'column', 'class', 'refused', 'refused_why',
                                  'Each player''s lineup spot always locks when his own game kicks off — this can''t be changed.')
    WHEN p_key IN ('divisions')            THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'Divisions aren''t available yet — the whole league plays as one group.')
    WHEN p_key IN ('playoff_byes')         THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'Playoff byes come from the number of playoff teams — change that instead.')
    WHEN p_key IN ('schedule_seed')        THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'This is set automatically when the schedule is made or reshuffled.')
    -- 149: RETIRED keys, refused BY NAME with their replacement (the table's
    -- CHECK refuses them too — leagues_settings_no_retired_waiver_keys).
    WHEN p_key IN ('waiver_process_day', 'waiver_process_time', 'waiver_period_hours', 'free_agency')
                                THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'This setting has been replaced: pick the days and time waivers run, and when free agency opens, instead. A dropped player stays on waivers until the next waiver run.')
    WHEN p_key IN ('bench_lock')           THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'This setting has been retired: a waiver claim always fails if the player you''d drop has already played this week, just like a regular drop.')
    -- Chris 2026-10-20: "You can always start a player on a buy [bye]. … That shouldn't be blocking anyone   -- 201 / D591
    -- from doing anything." A lineup save is never refused over a bye or injured starter, or an empty   -- 201 / D591
    -- slot; a value already stored is simply ignored (no data rewrite, no CHECK).   -- 201 / D591
    WHEN p_key IN ('allow_illegal_lineups') THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',   -- 201 / D591
                                  'This setting has been retired: a lineup always saves, even with a player who is on a bye or injured — he scores only if he plays.')   -- 201 / D591
    WHEN p_key IN ('draft')                THEN jsonb_build_object('storage', 'blob', 'class', 'refused', 'refused_why',
                                  'The draft is over, so its settings can''t change now.')
    ELSE NULL
  END;
$$;
REVOKE EXECUTE ON FUNCTION commish_setting_policy(TEXT) FROM PUBLIC, anon;
