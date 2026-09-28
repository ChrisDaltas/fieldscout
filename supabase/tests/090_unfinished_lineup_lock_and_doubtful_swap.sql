-- ============================================================================
-- Q67 + Q68, AS RULED — pgTAP 090 (task L.E1.25; migration 142; spec v2.16.50
-- §7.2.1(c), §10.1 *Matchups & results*, §15.4's v2.16.42 ruling note;
-- PROGRESS §3 Q67 / Q68 (RULED 2026-09-27), F384, D372, D375, D376, D379,
-- R1097–R1103, R1123; tasks-M6A §12's 2026-09-27 amendment and §4 rules
-- 12-15).
--
-- Numbering: RESERVED by the orchestrator (PR #320 holds 089) ⇒ 090.
--
-- WHERE THE CELLS LIVE. Q67's behaviour cells are in pgTAP 083 (the Q61 suite
-- whose fixture they re-cut — after PR #321's fix round (R1140): C10, E1-E3,
-- G2 / G2a, N1-N4c, N3b, N6c / N6d, N7, N8-N8f, B1b, S5-S7). Q68's re-cut and its `allow_illegal_lineups = FALSE` cell are in 086
-- (§D7 / D7b / D7c / D7d — X10's family). THIS suite holds:
--   §A  the FORM PINS for 142's two CREATE OR REPLACEs (D137): each new
--       prosrc's md5 as a stored literal, and each one's hunks REVERSED back
--       to its predecessor's md5 byte for byte (135's helper
--       `9f921496…` — D372(11); 139's chooser `a4fc61e3…` — 087 A8), the
--       posture pins, and the untouched neighbours (the tick — ZERO hunks —
--       the read door, the verb, the matcher, the carry);
--   §B-§G  Q68's BOUNDARIES on the pure chooser, one team per cell, one
--       injected instant, own fixture league (qb ×1, flex ×2 [RB/WR/TE]);
--   §H  the REAL tick at the same instant writes exactly the chooser's maps,
--       and its report carries the Q68 swap through arm (c) verbatim.
--
-- Falsifiability notes (tasks-M1 §4.3; tasks-M6A §4 rules 14-15):
--   * EVERY PREMISE BY VALUE FIRST (§B): designations through the bridge,
--     the bye (GB has no week-3 game) and the lock (KC kicked off before P).
--   * NO CELL INFERS EMPTINESS (rule 15): every "left as he was" cell reads
--     the chooser's `restored[]` entry and its reason string beside the map.
--   * STORED LITERALS: every md5, every instant (P = 2026-09-25 12:00Z).
--   * BREAK PROBES (rule 14), shown red by name in the PR then restored with
--     `diff -q`: drop the deferral (a BLOCKED man restored at once, 139's
--     behaviour) ⇒ §C1 / §C5 red (and 086 §D7-§D7d); offer a RESTORED
--     Doubtful starter to pass 1b (drop its `v_seated` skip) ⇒ §C2 reds;
--     drop the pass-2 skip of a pass-1b man ⇒ §C5 reds; drop the pool's lock
--     test ⇒ §C3 reds; pass 1b iterates the Doubtful tail in REVERSE (the
--     reviewer's M1, R1142) ⇒ §C7 / C7b red.
--   * All work runs as postgres (`auth.uid()` NULL — the tick's own
--     precondition).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(34);

-- ---------------------------------------------------------------------------
-- A. FORM PINS — 142 replaces TWO bodies and nothing else (D137)
-- ---------------------------------------------------------------------------
select is(
  (select md5(p.prosrc) from pg_proc p where p.oid = 'public.commish_matchup_edit_lock_internal(uuid,uuid)'::regprocedure),
  '22e166d7b568e70ae6a24153d0f564fe',
  'A1 commish_matchup_edit_lock_internal is 142''s FILE TEXT (prosrc md5, a stored literal — re-pinned by PR #321''s fix round, R1140)');
select is(
  (select md5(replace(replace(p.prosrc,
  E'    FROM judged j\n    WHERE j.week_rows = 0 OR j.open_games > 0\n  ),\n  -- 142 (L.E1.25; Q67 RULED 2026-09-27 — "you cannot edit a score for a\n  -- matchup that has not finished yet" — as READ by R1140, the reading stated\n  -- to Chris 2026-09-27). A matchup has FINISHED when EITHER\n  --   (A) every NFL game of the league week is over: every in-week\n  --       `nfl_games` row reads `final` — a row that has LEFT the week (116\'s\n  --       `left_week`, the E43 predicate `judged` uses above) is not counted —\n  --       and at least one in-week row exists (zero rows is the emptiest\n  --       partial data, never "all over" — 116\'s `all_final`, §23.2); OR\n  --   (B) every STARTING slot on BOTH sides holds a player whose game is\n  --       final. An EMPTY starting slot, a starter with NO game this week (a\n  --       bye, a game that left the week, no club) and a side with NO lineup\n  --       row each keep the matchup OPEN under (B) — a manager could still\n  --       start a player who plays later — but (A) releases it as soon as the\n  --       week\'s games are all over. IR spots are not starting slots.\n  -- A FINAL league week is always editable (R1092 — unchanged, and first).\n  --\n  -- The league\'s STARTING SLOT instances, `<key>:<i>` for i < `count` — the\n  -- slot keys a stored `slot_map` uses (139\'s `v_slots`, 114).\n  slot_defs AS (\n    SELECT (s ->> \'key\') || \':\' || g.i AS slot,\n           COALESCE(s ->> \'label\', s ->> \'key\') AS label,\n           t.ord, g.i\n    FROM public.leagues l\n    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.roster_settings -> \'starting_slots\', \'[]\'::jsonb))\n      WITH ORDINALITY AS t(s, ord)\n    CROSS JOIN LATERAL generate_series(0, COALESCE((s ->> \'count\')::int, 0) - 1) AS g(i)\n    WHERE l.id = p_league_id AND (s ->> \'key\') IS NOT NULL\n  ),\n  -- (A): the week\'s own games. A NULL-kickoff postponed row is NOT "left the\n  -- week" here (COALESCE → FALSE): it holds (A) open, the conservative side.\n  week_games AS (\n    SELECT count(*) FILTER (WHERE NOT x.left_week)::int AS in_week,\n           count(*) FILTER (WHERE NOT x.left_week AND x.status IS DISTINCT FROM \'final\')::int AS open\n    FROM (\n      SELECT g.status,\n             COALESCE(g.status IS NOT DISTINCT FROM \'postponed\'\n                      AND b.next_starts_at IS NOT NULL\n                      AND g.kickoff_at >= b.next_starts_at, FALSE) AS left_week\n      FROM m\n      CROSS JOIN bound b\n      JOIN public.nfl_games g ON g.season = m.season AND g.week = m.week\n    ) x\n  ),\n  -- (B)\'s OPEN SLOTS, per side: an EMPTY starting slot on a side that HAS a\n  -- lineup row (a side with none is `no_lineup`, above), and a starter with\n  -- NO game this week in a week that HAS game rows (in a zero-rows week he is\n  -- already unfinished — `no_game_rows`).\n  open_slots AS (\n    SELECT s.team_id, s.side, COALESCE(t.name, s.team_id::text) AS team_name,\n           d.slot, d.label, d.ord, d.i,\n           NULL::text AS player_id, NULL::text AS name, NULL::text AS nfl_team,\n           \'empty_slot\'::text AS reason\n    FROM sides s\n    CROSS JOIN slot_defs d\n    LEFT JOIN public.teams t ON t.id = s.team_id\n    WHERE NOT EXISTS (SELECT 1 FROM no_lineup nl WHERE nl.team_id = s.team_id)\n      AND NOT EXISTS (SELECT 1 FROM starters st WHERE st.team_id = s.team_id AND st.slot = d.slot)\n    UNION ALL\n    SELECT j.team_id, j.side, COALESCE(t.name, j.team_id::text),\n           j.slot, COALESCE(d.label, split_part(j.slot, \':\', 1)), d.ord, d.i,\n           j.player_id, j.name, j.nfl_team,\n           \'no_game\'\n    FROM judged j\n    LEFT JOIN slot_defs d ON d.slot = j.slot\n    LEFT JOIN public.teams t ON t.id = j.team_id\n    WHERE j.week_rows > 0 AND j.games = 0\n  ),\n  verdict AS (\n    SELECT\n      (SELECT lw.status FROM lw) AS week_status,\n',
  E'    FROM judged j\n    WHERE j.week_rows = 0 OR j.open_games > 0\n  ),\n  verdict AS (\n    SELECT\n      (SELECT lw.status FROM lw) AS week_status,\n'),
  E'              ORDER BY nl.side = \'away\', nl.team_id), \'[]\'::jsonb)\n         FROM no_lineup nl) AS no_lineup,\n      (SELECT string_agg(nl.team_name, \', \' ORDER BY nl.side = \'away\', nl.team_id)\n         FROM no_lineup nl) AS no_lineup_names,\n      -- 142 (Q67 / R1140): (A), and (B)\'s open slots — named per side.\n      (SELECT wg.in_week > 0 AND wg.open = 0 FROM week_games wg) AS week_games_over,\n      (SELECT count(*)::int FROM open_slots) AS open_slots,\n      (SELECT COALESCE(jsonb_agg(jsonb_build_object(\n                \'team_id\',   o.team_id,\n                \'side\',      o.side,\n                \'team_name\', o.team_name,\n                \'slot\',      o.slot,\n                \'label\',     o.label,\n                \'reason\',    o.reason,\n                \'player_id\', o.player_id,\n                \'name\',      o.name,\n                \'nfl_team\',  o.nfl_team)\n              ORDER BY o.side = \'away\', o.team_id, o.ord NULLS LAST, o.i, o.slot), \'[]\'::jsonb)\n         FROM open_slots o) AS open_slot_list,\n      (SELECT COALESCE(jsonb_agg(jsonb_build_object(\n                \'team_id\',   x.team_id,\n                \'side\',      x.side,\n                \'team_name\', x.team_name)\n              ORDER BY x.side = \'away\', x.team_id), \'[]\'::jsonb)\n         FROM (SELECT DISTINCT o.team_id, o.side, o.team_name FROM open_slots o) x) AS no_starter_game_sides,\n      -- One entry per side, its empty slots by label in slot order, a label\n      -- empty more than once counted ("WR ×2").\n      (SELECT string_agg(y.team_name || \' (\' || y.labels || \')\', \', \' ORDER BY y.side = \'away\', y.team_id)\n         FROM (SELECT x.team_id, x.side, x.team_name,\n                      string_agg(x.label || CASE WHEN x.n > 1 THEN \' ×\' || x.n ELSE \'\' END, \', \'\n                                 ORDER BY x.ord NULLS LAST, x.label) AS labels\n               FROM (SELECT o.team_id, o.side, o.team_name, o.label, min(o.ord) AS ord, count(*) AS n\n                     FROM open_slots o\n                     WHERE o.reason = \'empty_slot\'\n                     GROUP BY o.team_id, o.side, o.team_name, o.label) x\n               GROUP BY x.team_id, x.side, x.team_name) y) AS empty_names,\n      (SELECT string_agg(o.team_name || \' (\' || o.name || \', \' || COALESCE(o.nfl_team, \'no team\') || \')\', \', \'\n                ORDER BY o.side = \'away\', o.team_id, o.ord NULLS LAST, o.i, o.slot)\n         FROM open_slots o\n         WHERE o.reason = \'no_game\') AS no_game_names\n  )\n  -- 142 (Q67 / R1140): the verdict, then the open slots on every answer —\n  -- EMPTY whenever the matchup is editable (nothing holds it open).\n  SELECT d.doc || jsonb_build_object(\n           \'week_games_over\',       v.week_games_over,\n           \'no_starter_game_sides\', CASE WHEN (d.doc ->> \'editable\')::boolean THEN \'[]\'::jsonb\n                                         ELSE v.no_starter_game_sides END,\n           \'open_slots\',            CASE WHEN (d.doc ->> \'editable\')::boolean THEN \'[]\'::jsonb\n                                         ELSE v.open_slot_list END)\n  FROM verdict v\n  -- The ONE refusal sentence: every reason that holds, named by team or\n  -- player, in this order (a NULL clause drops out).\n  CROSS JOIN LATERAL (SELECT \'This matchup can be corrected once every starter\'\'s game has finished — \'\n      || concat_ws(\'; \', \'no lineup set yet: \' || v.no_lineup_names,\n                         \'empty starting slot: \' || v.empty_names,\n                         \'starter with no game this week: \' || v.no_game_names,\n                         \'not finished yet: \' || v.names) AS refusal) r\n  CROSS JOIN LATERAL (SELECT CASE\n    -- PRECEDENCE (R1092): a FINAL week is always editable.\n    WHEN v.week_status = \'final\' THEN jsonb_build_object(\n      \'editable\', TRUE, \'why\', \'week_final\', \'week_status\', v.week_status,\n      \'starters\', v.starters, \'finished\', v.finished, \'not_finished\', 0,\n      \'still_playing\', \'[]\'::jsonb, \'no_lineup\', \'[]\'::jsonb, \'message\', NULL)\n    -- (B): both sides have a row, no starting slot is open, every starter\'s\n    -- game is final, and there is at least one.\n    WHEN v.lineups_missing = 0 AND v.open_slots = 0 AND v.not_finished = 0 AND v.finished > 0 THEN jsonb_build_object(\n      \'editable\', TRUE, \'why\', \'every_starter_finished\', \'week_status\', v.week_status,\n      \'starters\', v.starters, \'finished\', v.finished, \'not_finished\', 0,\n      \'still_playing\', \'[]\'::jsonb, \'no_lineup\', \'[]\'::jsonb, \'message\', NULL)\n    -- (A): every NFL game of the week is over — releases a missing row, an\n    -- empty slot and a no-game starter alike (none can score any more).\n    WHEN v.week_games_over THEN jsonb_build_object(\n      \'editable\', TRUE, \'why\', \'week_games_over\', \'week_status\', v.week_status,\n      \'starters\', v.starters, \'finished\', v.finished, \'not_finished\', v.not_finished,\n      \'still_playing\', v.still_playing, \'no_lineup\', \'[]\'::jsonb, \'message\', NULL)\n    -- R1097: a side with NO lineup row is NOT finished (never "no starters").\n    WHEN v.lineups_missing > 0 THEN jsonb_build_object(\n      \'editable\', FALSE, \'why\', \'lineup_not_set\', \'week_status\', v.week_status,\n      \'starters\', v.starters, \'finished\', v.finished, \'not_finished\', v.not_finished,\n      \'still_playing\', v.still_playing, \'no_lineup\', v.no_lineup,\n      \'message\', r.refusal)\n    -- (B) open: an empty starting slot, or a starter with no game this week.\n    WHEN v.open_slots > 0 THEN jsonb_build_object(\n      \'editable\', FALSE, \'why\', \'no_starter_game\', \'week_status\', v.week_status,\n      \'starters\', v.starters, \'finished\', v.finished, \'not_finished\', v.not_finished,\n      \'still_playing\', v.still_playing, \'no_lineup\', \'[]\'::jsonb,\n      \'message\', r.refusal)\n    WHEN v.not_finished > 0 THEN jsonb_build_object(\n      \'editable\', FALSE, \'why\', \'starters_not_finished\', \'week_status\', v.week_status,\n      \'starters\', v.starters, \'finished\', v.finished, \'not_finished\', v.not_finished,\n      \'still_playing\', v.still_playing, \'no_lineup\', \'[]\'::jsonb,\n      \'message\', r.refusal)\n    -- No side and no starting slot at all (a row the league does not hold, or\n    -- a league with no starting slots): REFUSED — never a vacuous yes.\n    ELSE jsonb_build_object(\n      \'editable\', FALSE, \'why\', \'no_starter_game\', \'week_status\', v.week_status,\n      \'starters\', v.starters, \'finished\', 0, \'not_finished\', 0,\n      \'still_playing\', \'[]\'::jsonb, \'no_lineup\', \'[]\'::jsonb,\n      \'message\', \'This matchup can be corrected once every starter\'\'s game has finished — no starting slot to judge\')\n  END AS doc) d;\n',
  E'              ORDER BY nl.side = \'away\', nl.team_id), \'[]\'::jsonb)\n         FROM no_lineup nl) AS no_lineup,\n      (SELECT string_agg(nl.team_name, \', \' ORDER BY nl.side = \'away\', nl.team_id)\n         FROM no_lineup nl) AS no_lineup_names\n  )\n  SELECT CASE\n    -- PRECEDENCE (R1092): a FINAL week is always editable.\n    WHEN v.week_status = \'final\' THEN jsonb_build_object(\n      \'editable\', TRUE, \'why\', \'week_final\', \'week_status\', v.week_status,\n      \'starters\', v.starters, \'finished\', v.finished, \'not_finished\', 0,\n      \'still_playing\', \'[]\'::jsonb, \'no_lineup\', \'[]\'::jsonb, \'message\', NULL)\n    -- R1097: a side with NO lineup row is NOT finished (never "no starters").\n    WHEN v.lineups_missing > 0 THEN jsonb_build_object(\n      \'editable\', FALSE, \'why\', \'lineup_not_set\', \'week_status\', v.week_status,\n      \'starters\', v.starters, \'finished\', v.finished, \'not_finished\', v.not_finished,\n      \'still_playing\', v.still_playing, \'no_lineup\', v.no_lineup,\n      \'message\', \'This matchup can be corrected once every starter\'\'s game has finished — \'\n                 || concat_ws(\'; \', \'no lineup set yet: \' || v.no_lineup_names,\n                                    \'not finished yet: \' || v.names))\n    WHEN v.not_finished > 0 THEN jsonb_build_object(\n      \'editable\', FALSE, \'why\', \'starters_not_finished\', \'week_status\', v.week_status,\n      \'starters\', v.starters, \'finished\', v.finished, \'not_finished\', v.not_finished,\n      \'still_playing\', v.still_playing, \'no_lineup\', \'[]\'::jsonb,\n      \'message\', \'This matchup can be corrected once every starter\'\'s game has finished — not finished yet: \' || v.names)\n    WHEN v.finished > 0 THEN jsonb_build_object(\n      \'editable\', TRUE, \'why\', \'every_starter_finished\', \'week_status\', v.week_status,\n      \'starters\', v.starters, \'finished\', v.finished, \'not_finished\', 0,\n      \'still_playing\', \'[]\'::jsonb, \'no_lineup\', \'[]\'::jsonb, \'message\', NULL)\n    ELSE jsonb_build_object(\n      \'editable\', TRUE, \'why\', \'no_starter_game\', \'week_status\', v.week_status,\n      \'starters\', v.starters, \'finished\', 0, \'not_finished\', 0,\n      \'still_playing\', \'[]\'::jsonb, \'no_lineup\', \'[]\'::jsonb, \'message\', NULL)\n  END\n  FROM verdict v;\n'))
   from pg_proc p where p.oid = 'public.commish_matchup_edit_lock_internal(uuid,uuid)'::regprocedure),
  '9f9214963f4b3084e00838c353ddf34b',
  'A2 …and 142''s TWO hunks (R1140''s re-cut) are its WHOLE change (D137): each reversed, the prosrc is 135''s helper md5 byte for byte (D372(11)''s recorded post-fix-round value)');
select ok(
  (select not p.prosecdef and p.provolatile = 's' and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p where p.oid = 'public.commish_matchup_edit_lock_internal(uuid,uuid)'::regprocedure)
  and not has_function_privilege('anon', 'public.commish_matchup_edit_lock_internal(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.commish_matchup_edit_lock_internal(uuid,uuid)', 'EXECUTE')
  and not exists (
    select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.commish_matchup_edit_lock_internal(uuid,uuid)'::regprocedure
      and a.privilege_type = 'EXECUTE' and a.grantee = 0)
  and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'commish_matchup_edit_lock_internal') = 1,
  'A3 the helper keeps 135''s posture: PLAIN, STABLE, search_path='''', TRIPLE-REVOKEd (PUBLIC, anon, authenticated), one overload');
-- RE-PINNED BY L.D2.14's fix round (migration 152 §5, R1206 — additive,
-- R992): 152 replaces the chooser with TWO hunks against 142's file text.
-- The live prosrc's md5 is pinned by pgTAP 100 G0c; here 152's two hunks are
-- REVERSED first, so A4 / A5 keep proving exactly what they proved.
-- RE-PINNED BY L.D2.15 (migration 154 — additive, the R992 shape): 154's
-- substitutions are reversed INNERMOST first, so this chain proves what it did.
select is(
  (select md5(replace(replace(replace(replace(replace(replace(replace(p.prosrc, E'          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_locked_out) x WHERE v_elig ? (x ->> \'position\') AND x ? \'started_by\')\n            THEN \'no eligible player at \' || upper(v_e ->> \'slot\') || \' free to start — another team of the league already starts him this week (F441 / F445)\'\n          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_locked_out) x WHERE v_elig ? (x ->> \'position\'))\n            THEN \'no unlocked eligible player at \'', E'          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_locked_out) x WHERE v_elig ? (x ->> \'position\'))\n            THEN \'no unlocked eligible player at \''), E'        \'reason\', \'his game had already kicked off at the tick instant (§11.2, lineup_lock = per_player_kickoff) — autopilot does not inherit the commissioner\'\'s exemption (D338)\');\n      CONTINUE;\n    END IF;\n    -- 154 / F441 · F445: ONE START PER PLAYER PER LEAGUE-WEEK. A candidate\n    -- another team of this league already STARTS this week (a start kept\n    -- after he left that team — D411 / D412(5)) is never offered: the write\n    -- would be refused by name (team_lineups\' trigger) and fail the league\'s\n    -- tick. Named in skipped_locked[] (the tick reports it), never silently\n    -- dropped (§4 rule 15).\n    v_else := public.lineup_started_elsewhere_internal(p_league_id, p_team_id, p_season, p_week, v_pid);\n    IF v_else IS NOT NULL THEN\n      v_locked_out := v_locked_out || jsonb_build_object(\n        \'player_id\', v_pid, \'name\', v_e ->> \'name\', \'position\', v_e ->> \'position\',\n        \'kickoff_at\', v_kick -> v_pid ->> \'kickoff_at\',\n        \'started_by\', v_else ->> \'team_id\',\n        \'reason\', \'already in \' || (v_else ->> \'team_name\') || \'\'\'s starting lineup for week \' || p_week\n                  || \' — a player starts for at most one team per league-week (F441 / F445)\');\n      CONTINUE;\n    END IF;\n', E'        \'reason\', \'his game had already kicked off at the tick instant (§11.2, lineup_lock = per_player_kickoff) — autopilot does not inherit the commissioner\'\'s exemption (D338)\');\n      CONTINUE;\n    END IF;\n'), E'    IF v_locked OR NOT v_unhealthy OR v_pid = ANY (v_kept) THEN   -- 154: a kept off-roster starter stays, unconditionally\n      v_seated := v_seated || v_pid;\n', E'    IF v_locked OR NOT v_unhealthy THEN\n      v_seated := v_seated || v_pid;\n'), E'    -- 154 / F441 · F442 · F445: the ONE shared judgment (set_lineup (4b)\'s and\n    -- the commissioner\'s editor\'s): he played (his current team\'s game, this\n    -- lineup\'s record of the slot, or a stat line for the week), or the week\n    -- closed to moves before he left and he has a game this week. A KEPT\n    -- starter is seated whatever his health or kickoff (the classification\n    -- below) — his start is the week\'s record, never autopilot\'s to change.\n    SELECT * INTO v_k FROM public.lineup_kept_starter_internal(p_season, p_week, v_pid, v_key, v_row.starters, p_at);\n    CONTINUE WHEN NOT v_k.kept;   -- a bye / a game gone from the week: the slot stays OPEN\n    v_kept := v_kept || v_pid;\n    v_by_pid := v_by_pid || jsonb_build_object(v_pid, v_e);\n', E'    SELECT * INTO v_k FROM public.lineup_kickoff_internal(p_season, p_week, v_e ->> \'nfl_team\', p_at);\n    CONTINUE WHEN v_k.kickoff_at IS NULL OR v_k.kickoff_at > p_at;   -- has not played: the slot stays OPEN\n    v_by_pid := v_by_pid || jsonb_build_object(v_pid, v_e);\n'), E'  v_d_in        TEXT[] := ARRAY[]::text[];   -- Doubtful men pass 1b seated (fixed in pass 2)\n  -- 154 / F441 · F445: stored off-roster starters KEPT for the week, and the\n  -- team (if any) that already starts a candidate this league-week.\n  v_kept        TEXT[] := ARRAY[]::text[];\n  v_else        JSONB;\nBEGIN\n', E'  v_d_in        TEXT[] := ARRAY[]::text[];   -- Doubtful men pass 1b seated (fixed in pass 2)\nBEGIN\n'),
  E'    v_kick := v_kick || jsonb_build_object(v_e ->> \'player_id\', jsonb_build_object(\n      \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n  END LOOP;\n\n  -- 152 / R1206 (Q32\'s amendment, verbatim: "if they are in the lineup they\n  -- are stuck in the lineup"; D411): A PLAYED STARTER STAYS EVEN AFTER HE\n  -- LEAVES THE ROSTER. After a week\'s last game a starter who played can be\n  -- dropped, claimed away or traded while the week is still current, and 152\n  -- keeps his start in that week\'s slot_map (the week is scored from it). A\n  -- stored STARTING slot whose player is off this roster and whose OWN game\n  -- for p_week has kicked off is his, not OPEN: he joins v_by_pid / v_kick\n  -- (never v_roster — he is nobody\'s candidate and on no bench), so the\n  -- classification below seats him as the locked starter he is (D338) and the\n  -- fit keeps him fixed at his key. One whose game has not kicked off (a bye)\n  -- did not play: his slot is OPEN, as before.\n  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP\n    v_pid := v_val #>> \'{}\';\n    CONTINUE WHEN v_by_pid ? v_pid;\n    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> \'key\' = v_key);\n    SELECT jsonb_build_object(\n             \'player_id\',   p.id,\n             \'name\',        p.full_name,\n             \'position\',    CASE WHEN p.position = \'DEF\' THEN \'DST\' ELSE p.position END,\n             \'designation\', public.lineup_designation_internal(p.status),\n             \'nfl_team\',    p.team,\n             \'off_roster\',  TRUE)\n    INTO v_e\n    FROM public.players p WHERE p.id = v_pid;\n    CONTINUE WHEN v_e IS NULL;\n    SELECT * INTO v_k FROM public.lineup_kickoff_internal(p_season, p_week, v_e ->> \'nfl_team\', p_at);\n    CONTINUE WHEN v_k.kickoff_at IS NULL OR v_k.kickoff_at > p_at;   -- has not played: the slot stays OPEN\n    v_by_pid := v_by_pid || jsonb_build_object(v_pid, v_e);\n    v_kick := v_kick || jsonb_build_object(v_pid, jsonb_build_object(\n      \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n  END LOOP;\n',
  E'    v_kick := v_kick || jsonb_build_object(v_e ->> \'player_id\', jsonb_build_object(\n      \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n  END LOOP;\n'),
  E'  --   · empty (or holding a player who has since left the roster WITHOUT\n  --     having played — 152 / R1206: a played one is in v_by_pid, locked) ⇒ OPEN;\n',
  E'  --   · empty (or holding a player who has since been dropped) ⇒ OPEN;\n')) from pg_proc p where p.oid = 'public.lineup_autopilot_internal(uuid,uuid,integer,integer,timestamptz)'::regprocedure),
  '181c55e23ddf2bd351dcd0f3dd0bd29d',
  'A4 lineup_autopilot_internal is 142''s FILE TEXT beneath 152''s two hunks (prosrc with 152''s hunks reversed — md5 a stored literal)');
-- RE-PINNED BY L.D2.15 (migration 154 — additive, the R992 shape): 154's
-- substitutions are reversed INNERMOST first, so this chain proves what it did.
select is(
  (select md5(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(p.prosrc, E'          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_locked_out) x WHERE v_elig ? (x ->> \'position\') AND x ? \'started_by\')\n            THEN \'no eligible player at \' || upper(v_e ->> \'slot\') || \' free to start — another team of the league already starts him this week (F441 / F445)\'\n          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_locked_out) x WHERE v_elig ? (x ->> \'position\'))\n            THEN \'no unlocked eligible player at \'', E'          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_locked_out) x WHERE v_elig ? (x ->> \'position\'))\n            THEN \'no unlocked eligible player at \''), E'        \'reason\', \'his game had already kicked off at the tick instant (§11.2, lineup_lock = per_player_kickoff) — autopilot does not inherit the commissioner\'\'s exemption (D338)\');\n      CONTINUE;\n    END IF;\n    -- 154 / F441 · F445: ONE START PER PLAYER PER LEAGUE-WEEK. A candidate\n    -- another team of this league already STARTS this week (a start kept\n    -- after he left that team — D411 / D412(5)) is never offered: the write\n    -- would be refused by name (team_lineups\' trigger) and fail the league\'s\n    -- tick. Named in skipped_locked[] (the tick reports it), never silently\n    -- dropped (§4 rule 15).\n    v_else := public.lineup_started_elsewhere_internal(p_league_id, p_team_id, p_season, p_week, v_pid);\n    IF v_else IS NOT NULL THEN\n      v_locked_out := v_locked_out || jsonb_build_object(\n        \'player_id\', v_pid, \'name\', v_e ->> \'name\', \'position\', v_e ->> \'position\',\n        \'kickoff_at\', v_kick -> v_pid ->> \'kickoff_at\',\n        \'started_by\', v_else ->> \'team_id\',\n        \'reason\', \'already in \' || (v_else ->> \'team_name\') || \'\'\'s starting lineup for week \' || p_week\n                  || \' — a player starts for at most one team per league-week (F441 / F445)\');\n      CONTINUE;\n    END IF;\n', E'        \'reason\', \'his game had already kicked off at the tick instant (§11.2, lineup_lock = per_player_kickoff) — autopilot does not inherit the commissioner\'\'s exemption (D338)\');\n      CONTINUE;\n    END IF;\n'), E'    IF v_locked OR NOT v_unhealthy OR v_pid = ANY (v_kept) THEN   -- 154: a kept off-roster starter stays, unconditionally\n      v_seated := v_seated || v_pid;\n', E'    IF v_locked OR NOT v_unhealthy THEN\n      v_seated := v_seated || v_pid;\n'), E'    -- 154 / F441 · F442 · F445: the ONE shared judgment (set_lineup (4b)\'s and\n    -- the commissioner\'s editor\'s): he played (his current team\'s game, this\n    -- lineup\'s record of the slot, or a stat line for the week), or the week\n    -- closed to moves before he left and he has a game this week. A KEPT\n    -- starter is seated whatever his health or kickoff (the classification\n    -- below) — his start is the week\'s record, never autopilot\'s to change.\n    SELECT * INTO v_k FROM public.lineup_kept_starter_internal(p_season, p_week, v_pid, v_key, v_row.starters, p_at);\n    CONTINUE WHEN NOT v_k.kept;   -- a bye / a game gone from the week: the slot stays OPEN\n    v_kept := v_kept || v_pid;\n    v_by_pid := v_by_pid || jsonb_build_object(v_pid, v_e);\n', E'    SELECT * INTO v_k FROM public.lineup_kickoff_internal(p_season, p_week, v_e ->> \'nfl_team\', p_at);\n    CONTINUE WHEN v_k.kickoff_at IS NULL OR v_k.kickoff_at > p_at;   -- has not played: the slot stays OPEN\n    v_by_pid := v_by_pid || jsonb_build_object(v_pid, v_e);\n'), E'  v_d_in        TEXT[] := ARRAY[]::text[];   -- Doubtful men pass 1b seated (fixed in pass 2)\n  -- 154 / F441 · F445: stored off-roster starters KEPT for the week, and the\n  -- team (if any) that already starts a candidate this league-week.\n  v_kept        TEXT[] := ARRAY[]::text[];\n  v_else        JSONB;\nBEGIN\n', E'  v_d_in        TEXT[] := ARRAY[]::text[];   -- Doubtful men pass 1b seated (fixed in pass 2)\nBEGIN\n'),
  E'    v_kick := v_kick || jsonb_build_object(v_e ->> \'player_id\', jsonb_build_object(\n      \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n  END LOOP;\n\n  -- 152 / R1206 (Q32\'s amendment, verbatim: "if they are in the lineup they\n  -- are stuck in the lineup"; D411): A PLAYED STARTER STAYS EVEN AFTER HE\n  -- LEAVES THE ROSTER. After a week\'s last game a starter who played can be\n  -- dropped, claimed away or traded while the week is still current, and 152\n  -- keeps his start in that week\'s slot_map (the week is scored from it). A\n  -- stored STARTING slot whose player is off this roster and whose OWN game\n  -- for p_week has kicked off is his, not OPEN: he joins v_by_pid / v_kick\n  -- (never v_roster — he is nobody\'s candidate and on no bench), so the\n  -- classification below seats him as the locked starter he is (D338) and the\n  -- fit keeps him fixed at his key. One whose game has not kicked off (a bye)\n  -- did not play: his slot is OPEN, as before.\n  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP\n    v_pid := v_val #>> \'{}\';\n    CONTINUE WHEN v_by_pid ? v_pid;\n    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> \'key\' = v_key);\n    SELECT jsonb_build_object(\n             \'player_id\',   p.id,\n             \'name\',        p.full_name,\n             \'position\',    CASE WHEN p.position = \'DEF\' THEN \'DST\' ELSE p.position END,\n             \'designation\', public.lineup_designation_internal(p.status),\n             \'nfl_team\',    p.team,\n             \'off_roster\',  TRUE)\n    INTO v_e\n    FROM public.players p WHERE p.id = v_pid;\n    CONTINUE WHEN v_e IS NULL;\n    SELECT * INTO v_k FROM public.lineup_kickoff_internal(p_season, p_week, v_e ->> \'nfl_team\', p_at);\n    CONTINUE WHEN v_k.kickoff_at IS NULL OR v_k.kickoff_at > p_at;   -- has not played: the slot stays OPEN\n    v_by_pid := v_by_pid || jsonb_build_object(v_pid, v_e);\n    v_kick := v_kick || jsonb_build_object(v_pid, jsonb_build_object(\n      \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n  END LOOP;\n',
  E'    v_kick := v_kick || jsonb_build_object(v_e ->> \'player_id\', jsonb_build_object(\n      \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n  END LOOP;\n'),
  E'  --   · empty (or holding a player who has since left the roster WITHOUT\n  --     having played — 152 / R1206: a played one is in v_by_pid, locked) ⇒ OPEN;\n',
  E'  --   · empty (or holding a player who has since been dropped) ⇒ OPEN;\n'),
  E'  -- 142 (L.E1.25, Q68 RULED): pass 1b — a Doubtful replacement for a BLOCKED\n  -- starter nobody healthy replaced.\n  v_defer       JSONB := \'{}\'::jsonb;        -- slot key → vacated BLOCKED starter with no healthy replacement\n  v_dslots      JSONB;                       -- pass 1b\'s slots: exactly those keys\n  v_players_d   JSONB := \'[]\'::jsonb;        -- pass 1b\'s candidates: the unseated Doubtful tail\n  v_fit_d       JSONB;\n  v_d_in        TEXT[] := ARRAY[]::text[];   -- Doubtful men pass 1b seated (fixed in pass 2)\n',
  E''),
  E'      -- 142 (L.E1.25, Q68 RULED 2026-09-27 — "yes, swap in the doubtful"): a\n      -- vacated starter who is BLOCKED (on bye, or OUT / IR / PUP / NFI /\n      -- Suspended) and whose key nobody healthy took is NOT restored yet — pass\n      -- 1b below offers his key to the Doubtful tail first. A vacated DOUBTFUL\n      -- starter is restored here as before: never one Doubtful for another.\n      IF COALESCE((v_kick -> v_pid ->> \'on_bye\')::boolean, FALSE)\n         OR COALESCE((v_by_pid -> v_pid ->> \'designation\') IN (\'OUT\', \'IR\', \'PUP\', \'NFI\', \'Suspended\'), FALSE) THEN\n        v_defer := v_defer || jsonb_build_object(v_key, v_pid);\n        CONTINUE;\n      END IF;\n',
  E''),
  E'  -- PASS 1b — 142 (L.E1.25, Q68 RULED 2026-09-27: "yes, swap in the\n  -- doubtful"). When no healthy, unlocked, eligible replacement exists, a\n  -- DOUBTFUL one replaces a starter who is OUT / on bye. The contest is\n  -- exactly the deferred BLOCKED keys (never an empty slot — pass 2 owns\n  -- those, unchanged) and its candidates are the Doubtful tail in Q62 order,\n  -- minus every man already staying where he is — so a restored Doubtful\n  -- starter is never moved to another key (never one Doubtful for another).\n  -- A locked man is never a candidate (the pool loop sent him to\n  -- skipped_locked[]) and a locked starter was never vacated (D338). The\n  -- Doubtful tail is a preference under BOTH `allow_illegal_lineups` values\n  -- (a Doubtful start is legal, 114:596), so this runs under both — which is\n  -- what restores production\'s (125) swap in a league that forbids illegal\n  -- lineups (R1123). A deferred key no Doubtful man takes is restored exactly\n  -- as Q63\'s clause restores it.\n  IF v_defer <> \'{}\'::jsonb THEN\n    SELECT COALESCE(jsonb_agg(t.s ORDER BY t.ord), \'[]\'::jsonb)\n    INTO v_dslots\n    FROM jsonb_array_elements(v_slots) WITH ORDINALITY AS t(s, ord)\n    WHERE v_defer ? (t.s ->> \'key\');\n    FOR v_e IN SELECT * FROM jsonb_array_elements(v_tail_d) LOOP\n      CONTINUE WHEN (v_e ->> \'player_id\') = ANY (v_seated);\n      v_players_d := v_players_d || v_e;\n    END LOOP;\n    v_fit_d := public.lineup_fit_internal(v_dslots, v_players_d);\n    FOR v_key, v_val IN SELECT * FROM jsonb_each(v_defer) LOOP\n      v_pid := v_val #>> \'{}\';\n      IF (v_fit_d -> \'assignment\' ->> v_key) IS NULL THEN\n        v_restored := v_restored || jsonb_build_object(\n          \'slot\', v_key, \'player_id\', v_pid, \'name\', v_by_pid -> v_pid ->> \'name\',\n          \'reason\', \'no healthy or Doubtful, unlocked, eligible replacement existed — left exactly as he was (Q63; Q68)\');\n        v_seated := v_seated || v_pid;\n        v_players_b := v_players_b || jsonb_build_object(\n          \'player_id\', v_pid, \'position\', v_by_pid -> v_pid ->> \'position\',\n          \'wanted\', v_key, \'fixed\', TRUE);\n      ELSE\n        v_d_in := v_d_in || (v_fit_d -> \'assignment\' ->> v_key);\n        v_players_b := v_players_b || jsonb_build_object(\n          \'player_id\', v_fit_d -> \'assignment\' ->> v_key,\n          \'position\', v_by_pid -> (v_fit_d -> \'assignment\' ->> v_key) ->> \'position\',\n          \'wanted\', v_key, \'fixed\', TRUE);\n        v_subbed := v_subbed || jsonb_build_object(\n          \'slot\', v_key, \'out\', v_pid, \'out_name\', v_by_pid -> v_pid ->> \'name\',\n          \'in\', v_fit_d -> \'assignment\' ->> v_key,\n          \'in_name\', v_by_pid -> (v_fit_d -> \'assignment\' ->> v_key) ->> \'name\',\n          \'reason\', CASE WHEN COALESCE((v_kick -> v_pid ->> \'on_bye\')::boolean, FALSE)\n                         THEN \'on bye\' ELSE \'designated \' || (v_by_pid -> v_pid ->> \'designation\') END,\n          \'why\', \'no healthy, unlocked, eligible replacement existed — a Doubtful one replaces a starter who cannot play (Q68, ruled 2026-09-27)\',\n          \'order\', v_by_pid -> (v_fit_d -> \'assignment\' ->> v_key) -> \'order\');\n      END IF;\n    END LOOP;\n  END IF;\n\n',
  E''),
  E'    -- 142 (Q68): a Doubtful man pass 1b seated is already fixed above.\n    CONTINUE WHEN (v_e ->> \'player_id\') = ANY (v_d_in);\n',
  E''))
   from pg_proc p where p.oid = 'public.lineup_autopilot_internal(uuid,uuid,integer,integer,timestamptz)'::regprocedure),
  'a4fc61e3f00b5ed91770c496045cd57c',
  'A5 …and 142''s FOUR hunks are its WHOLE change (D137): each reversed, the prosrc is 139''s chooser md5 (087 A8''s literal) byte for byte');
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p where p.oid = 'public.lineup_autopilot_internal(uuid,uuid,integer,integer,timestamptz)'::regprocedure)
  and not has_function_privilege('anon', 'public.lineup_autopilot_internal(uuid,uuid,integer,integer,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.lineup_autopilot_internal(uuid,uuid,integer,integer,timestamptz)', 'EXECUTE')
  and not exists (
    select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.lineup_autopilot_internal(uuid,uuid,integer,integer,timestamptz)'::regprocedure
      and a.privilege_type = 'EXECUTE' and a.grantee = 0)
  and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'lineup_autopilot_internal') = 1,
  'A6 the chooser keeps 139''s posture: PLAIN, search_path='''', TRIPLE-REVOKEd, one overload');
select is(
  (select format('tick=%s door=%s verb=%s fit=%s carry=%s',
     (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'lineup_lock_tick'),
     (select md5(p.prosrc) from pg_proc p where p.oid = 'public.commish_matchup_edit_lock(uuid,uuid)'::regprocedure),
     (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'commish_matchup_override_internal'),
     (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'lineup_fit_internal'),
     (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'lineup_carry_internal'))),
  'tick=540946257b7f6b2f2739e4d27f5cf584 door=d67c9f99211fb0bab6d08db376f5f6e2 verb=b3dc0e0f876a50465e81808cbc3fee38 fit=b291362e2263f2b987b413f3cb6b9580 carry=e38a18c80dde298b3ca69af93b77dac9',
  'A7 the NEIGHBOURS ARE UNTOUCHED (stored literals): the tick (139''s md5, 087 A7 — ZERO tick hunks), 135''s read door and verb (so the panel and the refusal flip together, through the one helper), the matcher and the carry');

-- ---------------------------------------------------------------------------
-- B. FIXTURES (postgres context)
--    Calendar (2026, stored literals — 086's): week 3 starts 09-23 04:00Z;
--    P = 09-25 12:00Z. Week-3 games: KC–BUF Thu 09-25 00:15Z (KICKED OFF
--    before P — a KC man is LOCKED), PHI–DAL Sun 09-27 17:00Z, SF–NYG Mon
--    09-28 00:15Z. GB has NO week-3 game (the BYE).
--    QA `ba…01` allow_illegal_lineups TRUE; QF `ba…02` FALSE. Slots
--    everywhere: qb ×1, flex ×2 [RB, WR, TE]. Every team an UNMANAGED
--    placeholder seat, switched ON (so §H's real tick evaluates it).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '9f000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'pgtap-q68@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', '{"username": "q68_user1"}'::jsonb, now(), now());

update nfl_weeks set first_kickoff_at = null where season = 2026;
update nfl_weeks set starts_at = '2026-09-09 04:00:00+00' where season = 2026 and week = 1;
update nfl_weeks set starts_at = '2026-09-23 04:00:00+00', last_game_ends_at = '2026-09-29 04:00:00+00', correction_window_ends_at = '2026-10-01 10:00:00+00' where season = 2026 and week = 3;
update nfl_weeks set starts_at = '2026-09-30 04:00:00+00' where season = 2026 and week = 4;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('q68-w3-thu', 2026, 3, 'KC',  'BUF', '2026-09-25 00:15:00+00', 'live'),
 ('q68-w3-sun', 2026, 3, 'PHI', 'DAL', '2026-09-27 17:00:00+00', 'scheduled'),
 ('q68-w3-mon', 2026, 3, 'SF',  'NYG', '2026-09-28 00:15:00+00', 'scheduled');

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings)
select l.id, '9f000000-0000-4000-8000-000000000001', l.nm, 2026, 'in_season', 8, 6, 0, 7,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', l.st,
       '{"starting_slots": [
           {"key": "qb",   "label": "QB",    "eligible": ["QB"],             "count": 1},
           {"key": "flex", "label": "W/R/T", "eligible": ["RB", "WR", "TE"], "count": 2}],
         "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb
from (values
 ('ba000000-0000-4000-8000-000000000001'::uuid, 'pgtap-q68-QA', '{"schedule_mode": "h2h", "allow_illegal_lineups": true}'::jsonb),
 ('ba000000-0000-4000-8000-000000000002'::uuid, 'pgtap-q68-QF', '{"schedule_mode": "h2h", "allow_illegal_lineups": false}'::jsonb)
) as l(id, nm, st);
insert into league_weeks (league_id, season, week, status)
select l, 2026, g, case when g < 3 then 'final' when g = 3 then 'live' else 'upcoming' end
from (values ('ba000000-0000-4000-8000-000000000001'::uuid), ('ba000000-0000-4000-8000-000000000002'::uuid)) v(l),
     generate_series(1, 6) g;

create temp table q68_team (tag text primary key, id uuid not null, league_id uuid not null);
insert into q68_team (tag, id, league_id) values
 ('Y1', 'ca000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001'),
 ('Y2', 'ca000000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-000000000001'),
 ('Y3', 'ca000000-0000-4000-8000-000000000003', 'ba000000-0000-4000-8000-000000000001'),
 ('Y4', 'ca000000-0000-4000-8000-000000000004', 'ba000000-0000-4000-8000-000000000001'),
 ('Y5', 'ca000000-0000-4000-8000-000000000005', 'ba000000-0000-4000-8000-000000000001'),
 ('Y6', 'ca000000-0000-4000-8000-000000000006', 'ba000000-0000-4000-8000-000000000002'),
 ('Y7', 'ca000000-0000-4000-8000-000000000007', 'ba000000-0000-4000-8000-000000000001');
insert into teams (id, owner_id, name, league_id)
select id, '9f000000-0000-4000-8000-000000000001', 'Q68 ' || tag, league_id from q68_team;
insert into league_members (league_id, user_id, team_id, role, is_placeholder)
select league_id, null, id, 'manager', true from q68_team;
insert into team_autopilot (team_id, is_on, set_at)
select id, true, '2026-09-23 04:00:00+00' from q68_team;

insert into players (id, full_name, position, team, status, adp) values
 -- Y1: a BYE starter at flex:0, a Doubtful RB on the bench.
 ('q68-y1-qb',   'Q68 Y1 QB',   'QB', 'DAL', 'Active',    10.0),
 ('q68-y1-bye',  'Q68 Y1 Bye',  'WR', 'GB',  'Active',     1.0),
 ('q68-y1-wr',   'Q68 Y1 WR',   'WR', 'NYG', 'Active',    11.0),
 ('q68-y1-dbt',  'Q68 Y1 Dbt',  'RB', 'SF',  'Doubtful',  12.0),
 -- Y2: a DOUBTFUL starter at flex:0 and an OUT starter at flex:1, no bench.
 ('q68-y2-qb',   'Q68 Y2 QB',   'QB', 'DAL', 'Active',    10.0),
 ('q68-y2-dbt',  'Q68 Y2 Dbt',  'WR', 'NYG', 'Doubtful',   1.0),
 ('q68-y2-out',  'Q68 Y2 Out',  'WR', 'NYG', 'Out',        2.0),
 -- Y3: an OUT starter at flex:0; the only bench man is Doubtful and LOCKED (KC).
 ('q68-y3-qb',   'Q68 Y3 QB',   'QB', 'DAL', 'Active',    10.0),
 ('q68-y3-out',  'Q68 Y3 Out',  'WR', 'NYG', 'Out',        1.0),
 ('q68-y3-wr',   'Q68 Y3 WR',   'WR', 'PHI', 'Active',    11.0),
 ('q68-y3-dbt',  'Q68 Y3 Dbt',  'RB', 'KC',  'Doubtful',   2.0),
 -- Y4: an OUT starter at flex:0; a HEALTHY RB (5.00) and a Doubtful RB (25.00).
 ('q68-y4-qb',   'Q68 Y4 QB',   'QB', 'DAL', 'Active',    10.0),
 ('q68-y4-out',  'Q68 Y4 Out',  'WR', 'NYG', 'Out',        1.0),
 ('q68-y4-wr',   'Q68 Y4 WR',   'WR', 'PHI', 'Active',    11.0),
 ('q68-y4-ok',   'Q68 Y4 Ok',   'RB', 'SF',  'Active',    90.0),
 ('q68-y4-dbt',  'Q68 Y4 Dbt',  'RB', 'SF',  'Doubtful',   2.0),
 -- Y5 (allow TRUE) / Y6 (allow FALSE): an OUT QB at qb:0, an OUT WR at flex:0,
 -- flex:1 EMPTY, ONE Doubtful WR on the bench.
 ('q68-y5-qbout','Q68 Y5 QB Out','QB', 'DAL', 'Out',       1.0),
 ('q68-y5-out',  'Q68 Y5 Out',  'WR', 'NYG', 'Out',        2.0),
 ('q68-y5-dbt',  'Q68 Y5 Dbt',  'WR', 'NYG', 'Doubtful',   3.0),
 ('q68-y6-qbout','Q68 Y6 QB Out','QB', 'DAL', 'Out',       1.0),
 ('q68-y6-out',  'Q68 Y6 Out',  'WR', 'NYG', 'Out',        2.0),
 ('q68-y6-dbt',  'Q68 Y6 Dbt',  'WR', 'NYG', 'Doubtful',   3.0),
 -- Y7 (R1142, PR #321's review): an OUT WR at flex:0 and TWO Doubtful bench
 -- men — RB Da (adp 2, projected 4.00) and TE Db (adp 80, projected 18.00).
 -- Q62 orders by projection first, so pass 1b must offer Db BEFORE Da.
 ('q68-y7-qb',   'Q68 Y7 QB',   'QB', 'DAL', 'Active',    10.0),
 ('q68-y7-out',  'Q68 Y7 Out',  'WR', 'NYG', 'Out',        1.0),
 ('q68-y7-wr',   'Q68 Y7 WR',   'WR', 'PHI', 'Active',    11.0),
 ('q68-y7-da',   'Q68 Y7 Da',   'RB', 'SF',  'Doubtful',   2.0),
 ('q68-y7-db',   'Q68 Y7 Db',   'TE', 'SF',  'Doubtful',  80.0);
insert into league_rosters (league_id, team_id, player_id, slot_key, ir_placed_week)
select t.league_id, t.id, p.id, 'bn', null
from q68_team t join players p on p.id like 'q68-' || lower(t.tag) || '-%';
-- Y4's values: the Doubtful man PROJECTS higher than the healthy one, and
-- his adp is better — so only "healthy first" seats the healthy man.
insert into league_player_values
  (league_id, season, week, player_id, projected_points, projected_missing, projected_unscored, projection_fetched_at,
   season_points, season_games, preseason_points, preseason_missing, preseason_unscored, computed_at)
values
 ('ba000000-0000-4000-8000-000000000001', 2026, 3, 'q68-y4-ok',   5.00, null, '{}'::text[], '2026-09-25 11:00:00+00', null, 0, null, 'no_line', null, '2026-09-25 11:00:00+00'),
 ('ba000000-0000-4000-8000-000000000001', 2026, 3, 'q68-y4-dbt', 25.00, null, '{}'::text[], '2026-09-25 11:00:00+00', null, 0, null, 'no_line', null, '2026-09-25 11:00:00+00'),
 ('ba000000-0000-4000-8000-000000000001', 2026, 3, 'q68-y7-da',   4.00, null, '{}'::text[], '2026-09-25 11:00:00+00', null, 0, null, 'no_line', null, '2026-09-25 11:00:00+00'),
 ('ba000000-0000-4000-8000-000000000001', 2026, 3, 'q68-y7-db',  18.00, null, '{}'::text[], '2026-09-25 11:00:00+00', null, 0, null, 'no_line', null, '2026-09-25 11:00:00+00');

-- THE LINEUP ROWS, written by the REAL carry, then each cell's stored map
-- planted over `slot_map` (086 §B's method).
select public.lineup_carry_internal(t.league_id, t.id, 2026, 3, '2026-09-23 04:00:00+00') from q68_team t;
update team_lineups tl set slot_map = m.map
from (values
 ('Y1', '{"qb:0": "q68-y1-qb", "flex:0": "q68-y1-bye", "flex:1": "q68-y1-wr"}'::jsonb),
 ('Y2', '{"qb:0": "q68-y2-qb", "flex:0": "q68-y2-dbt", "flex:1": "q68-y2-out"}'::jsonb),
 ('Y3', '{"qb:0": "q68-y3-qb", "flex:0": "q68-y3-out", "flex:1": "q68-y3-wr"}'::jsonb),
 ('Y4', '{"qb:0": "q68-y4-qb", "flex:0": "q68-y4-out", "flex:1": "q68-y4-wr"}'::jsonb),
 ('Y5', '{"qb:0": "q68-y5-qbout", "flex:0": "q68-y5-out"}'::jsonb),
 ('Y6', '{"qb:0": "q68-y6-qbout", "flex:0": "q68-y6-out"}'::jsonb),
 ('Y7', '{"qb:0": "q68-y7-qb", "flex:0": "q68-y7-out", "flex:1": "q68-y7-wr"}'::jsonb)
) as m(tag, map)
join q68_team t on t.tag = m.tag
where tl.team_id = t.id and tl.season = 2026 and tl.week = 3;

-- PREMISES, BY VALUE (rule 14(c)).
select is(
  (select string_agg(format('%s=%s', p.id, coalesce(public.lineup_designation_internal(p.status), 'healthy')), ' ' order by p.id)
   from players p where p.id in ('q68-y1-dbt', 'q68-y2-dbt', 'q68-y2-out', 'q68-y3-dbt', 'q68-y4-ok', 'q68-y5-qbout')),
  'q68-y1-dbt=Doubtful q68-y2-dbt=Doubtful q68-y2-out=OUT q68-y3-dbt=Doubtful q68-y4-ok=healthy q68-y5-qbout=OUT',
  'B1 PREMISE: the designations, through the bridge (112:337) — Doubtful, OUT and healthy as each cell needs');
select is(
  (select format('gb=%s kc=%s',
     (select on_bye from public.lineup_kickoff_internal(2026, 3, 'GB', '2026-09-25 12:00:00+00')),
     (select kickoff_at <= '2026-09-25 12:00:00+00'::timestamptz from public.lineup_kickoff_internal(2026, 3, 'KC', '2026-09-25 12:00:00+00')))),
  'gb=t kc=t',
  'B2 PREMISE: at P, GB is ON BYE (Y1''s starter) and KC''s game HAS KICKED OFF (Y3''s Doubtful bench man is LOCKED)');
select is(
  (select format('%s/%s', settings ->> 'allow_illegal_lineups', (select settings ->> 'allow_illegal_lineups' from leagues where id = 'ba000000-0000-4000-8000-000000000002'))
   from leagues where id = 'ba000000-0000-4000-8000-000000000001'),
  'true/false',
  'B3 PREMISE: QA allows illegal lineups, QF forbids them');
select is(
  (select string_agg(format('%s=%s/adp %s/proj %s', p.id, public.lineup_designation_internal(p.status), p.adp, v.projected_points), ' ' order by p.id)
   from players p join league_player_values v on v.player_id = p.id and v.league_id = 'ba000000-0000-4000-8000-000000000001' and v.week = 3
   where p.id in ('q68-y7-da', 'q68-y7-db')),
  'q68-y7-da=Doubtful/adp 2.0/proj 4.00 q68-y7-db=Doubtful/adp 80.0/proj 18.00',
  'B4 PREMISE (R1142): Y7''s two Doubtful bench men — Da the BETTER adp and the LOWER projection, Db the WORSE adp and the HIGHER projection (both fresh at P)');

create temp table q68_r (tag text primary key, r jsonb not null);
insert into q68_r (tag, r)
select t.tag, public.lineup_autopilot_internal(t.league_id, t.id, 2026, 3, '2026-09-25 12:00:00+00') from q68_team t;
create function pg_temp.r(p_tag text) returns jsonb language sql as $$ select r from q68_r where tag = p_tag $$;
create function pg_temp.subs(p_tag text) returns text language sql as $$
  select coalesce(string_agg(format('%s:%s>%s(%s)', x ->> 'slot', x ->> 'out', x ->> 'in', x ->> 'reason'), ' ' order by x ->> 'slot'), '-')
  from jsonb_array_elements(pg_temp.r(p_tag) -> 'substituted') x $$;
create function pg_temp.rest(p_tag text) returns text language sql as $$
  select coalesce(string_agg(format('%s:%s', x ->> 'slot', x ->> 'player_id'), ' ' order by x ->> 'slot'), '-')
  from jsonb_array_elements(pg_temp.r(p_tag) -> 'restored') x $$;

-- ---------------------------------------------------------------------------
-- C. Q68's BOUNDARIES — "yes, swap in the doubtful"
-- ---------------------------------------------------------------------------
select is(pg_temp.r('Y1') -> 'slot_map', '{"qb:0": "q68-y1-qb", "flex:0": "q68-y1-dbt", "flex:1": "q68-y1-wr"}'::jsonb,
  'C1 A BYE STARTER with no healthy replacement is SWAPPED for the Doubtful bench man (Q68 names "OUT / on bye" alike) — break probe: restore a blocked man at once ⇒ red');
select is(format('%s | restored=%s | why_q68=%s', pg_temp.subs('Y1'), pg_temp.rest('Y1'),
              (select strpos(x ->> 'why', 'Q68') > 0 from jsonb_array_elements(pg_temp.r('Y1') -> 'substituted') x)),
  'flex:0:q68-y1-bye>q68-y1-dbt(on bye) | restored=- | why_q68=t',
  'C1b …NAMED in substituted[] with the reason "on bye" and a `why` naming Q68; nothing restored');
select is(pg_temp.r('Y2') -> 'slot_map', '{"qb:0": "q68-y2-qb", "flex:0": "q68-y2-dbt", "flex:1": "q68-y2-out"}'::jsonb,
  'C2 NEVER ONE DOUBTFUL FOR ANOTHER, AND A RESTORED DOUBTFUL STARTER NEVER MOVES: the Doubtful starter at flex:0 stays; the OUT man at flex:1 stays too — the only Doubtful man is the one already starting (break probe: offer a restored Doubtful starter to pass 1b ⇒ he is seated twice ⇒ red)');
select is(format('%s | restored=%s | changed=%s/%s', pg_temp.subs('Y2'), pg_temp.rest('Y2'), pg_temp.r('Y2') ->> 'changed', pg_temp.r('Y2') ->> 'reason'),
  '- | restored=flex:0:q68-y2-dbt flex:1:q68-y2-out | changed=false/no_change',
  'C2b …both named in restored[], nothing substituted, and the pass SAYS it changed nothing (rule 15)');
select is(
  (select x ->> 'reason' from jsonb_array_elements(pg_temp.r('Y2') -> 'restored') x where x ->> 'slot' = 'flex:1'),
  'no healthy or Doubtful, unlocked, eligible replacement existed — left exactly as he was (Q63; Q68)',
  'C2c …and the OUT man''s restore says WHY in Q68''s words — neither a healthy nor a Doubtful replacement existed');
select is(pg_temp.r('Y3') -> 'slot_map', '{"qb:0": "q68-y3-qb", "flex:0": "q68-y3-out", "flex:1": "q68-y3-wr"}'::jsonb,
  'C3 NEVER A LOCKED PLAYER: the only Doubtful bench man''s game (KC) kicked off before P, so the OUT starter is NOT swapped — the lock binds autopilot (D338) (break probe: drop the pool''s lock test ⇒ red)');
select is(format('restored=%s locked=%s', pg_temp.rest('Y3'),
              (select string_agg(x ->> 'player_id', ',') from jsonb_array_elements(pg_temp.r('Y3') -> 'skipped_locked') x)),
  'restored=flex:0:q68-y3-out locked=q68-y3-dbt',
  'C3b …the OUT man is named in restored[] and the locked Doubtful man in skipped_locked[] — never silently dropped');
select is(pg_temp.r('Y4') -> 'slot_map', '{"qb:0": "q68-y4-qb", "flex:0": "q68-y4-ok", "flex:1": "q68-y4-wr"}'::jsonb,
  'C4 HEALTHY FIRST (unchanged): a healthy replacement (5.00 projected, adp 90) takes the OUT man''s key over a Doubtful one (25.00, adp 2) — Q68 reaches only where no healthy man exists');
select is(pg_temp.subs('Y4'), 'flex:0:q68-y4-out>q68-y4-ok(designated OUT)',
  'C4b …named in substituted[] as the healthy swap');
select is(pg_temp.r('Y5') -> 'slot_map', '{"qb:0": "q68-y5-qbout", "flex:0": "q68-y5-dbt", "flex:1": "q68-y5-out"}'::jsonb,
  'C5 TWO BLOCKED STARTERS, ONE DOUBTFUL MAN (allow TRUE): he takes the key he is eligible for (flex:0, the OUT WR''s); the OUT QB — no eligible replacement — is restored; the empty flex:1 then gets the displaced OUT WR as the tail (125''s "seated last, never an empty slot"), and nobody is seated twice (break probes: drop the deferral, or drop pass 2''s skip of a pass-1b man ⇒ red)');
select is(format('%s | restored=%s', pg_temp.subs('Y5'), pg_temp.rest('Y5')),
  'flex:0:q68-y5-out>q68-y5-dbt(designated OUT) | restored=qb:0:q68-y5-qbout',
  'C5b …the swap and the restore, each named');
select is(pg_temp.r('Y6') -> 'slot_map', '{"qb:0": "q68-y6-qbout", "flex:0": "q68-y6-dbt"}'::jsonb,
  'C6 THE SAME SHAPE WHERE ILLEGAL LINEUPS ARE FORBIDDEN (QF): the Doubtful man still replaces the OUT WR (a Doubtful start is legal); the OUT WR is NOT re-seated at flex:1 (the hard filter)');
select is(
  format('%s | unfillable=%s | flags=%s', pg_temp.subs('Y6'),
         (select string_agg(x ->> 'slot' || '=' || (x ->> 'reason'), ',') from jsonb_array_elements(pg_temp.r('Y6') -> 'unfillable') x),
         (select jsonb_object_agg(s ->> 'slot', s -> 'flags') from jsonb_array_elements(pg_temp.r('Y6') -> 'starters') s)),
  'flex:0:q68-y6-out>q68-y6-dbt(designated OUT) | unfillable=flex:1=no healthy eligible player at FLEX; league forbids illegal lineups | flags={"qb:0": ["out"], "flex:0": [], "flex:1": ["empty"]}',
  'C6b …named: the swap, flex:1 unfillable for 125''s one "forbids illegal lineups" reason (R1076''s pin, unchanged), and the flags — the Doubtful man clear, the restored OUT QB still flagged');

select is(pg_temp.r('Y7') -> 'slot_map', '{"qb:0": "q68-y7-qb", "flex:0": "q68-y7-db", "flex:1": "q68-y7-wr"}'::jsonb,
  'C7 (R1142) TWO DOUBTFUL CANDIDATES FOR ONE KEY: pass 1b offers them in Q62 order — projection first — so Db (18.00 projected, adp 80) takes the OUT WR''s flex:0 over Da (4.00, adp 2) (break probe: iterate the Doubtful tail in REVERSE in pass 1b ⇒ Da wins ⇒ red)');
select is(
  format('%s | ordered_by=%s | da=%s',
         pg_temp.subs('Y7'),
         (select x -> 'order' ->> 'ordered_by' from jsonb_array_elements(pg_temp.r('Y7') -> 'substituted') x),
         (select string_agg(b #>> '{}', ',') from jsonb_array_elements(pg_temp.r('Y7') -> 'bench') b where b #>> '{}' = 'q68-y7-da')),
  'flex:0:q68-y7-out>q68-y7-db(designated OUT) | ordered_by=projected_points | da=q68-y7-da',
  'C7b (R1142) …NAMED in substituted[] (out the OUT WR, in Db), the order key that ranked him is `projected_points`, and Da is on the bench');

-- ---------------------------------------------------------------------------
-- D. order_basis counts a pass-1b Doubtful man as a CANDIDATE (he was
--    ordered), and a deferred-then-restored man NOT (F392, unchanged)
-- ---------------------------------------------------------------------------
select is(
  format('Y1=%s Y2=%s Y5=%s', pg_temp.r('Y1') -> 'order_basis' ->> 'candidates', pg_temp.r('Y2') -> 'order_basis' ->> 'candidates',
         pg_temp.r('Y5') -> 'order_basis' ->> 'candidates'),
  'Y1=2 Y2=0 Y5=2',
  'D1 order_basis: Y1 counts the Doubtful man it seated AND the displaced bye man (both offered, neither fixed); Y2 counts NOBODY (both starters restored — F392); Y5 counts the Doubtful man and the displaced OUT WR, NOT the restored OUT QB');

-- ---------------------------------------------------------------------------
-- E. Every written map is legal, and no man sits twice
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from q68_r q
   where exists (select 1 from jsonb_each_text(q.r -> 'slot_map') a, jsonb_each_text(q.r -> 'slot_map') b
                 where a.key < b.key and a.value = b.value)),
  0, 'E1 no chooser result seats one player in two slots (D356(7c)''s defect class)');
select is(
  (select count(*)::int from q68_r where (r ->> 'changed')::boolean),
  5, 'E2 PREMISE for §H: 5 of the 7 results change their map — Y1, Y4, Y5, Y6, Y7 (Y2 and Y3 restore)');

-- ---------------------------------------------------------------------------
-- H. THE REAL TICK at the SAME instant writes exactly the chooser's maps, and
--    its report carries the Q68 swap through arm (c) — ZERO tick hunks
-- ---------------------------------------------------------------------------
select set_config('pgtap.ta', public.lineup_lock_tick('2026-09-25 12:00:00+00', 'ba000000-0000-4000-8000-000000000001')::text, true);
select set_config('pgtap.tf', public.lineup_lock_tick('2026-09-25 12:00:00+00', 'ba000000-0000-4000-8000-000000000002')::text, true);
select is(
  (select count(*)::int from q68_r q join q68_team t on t.tag = q.tag
     join team_lineups tl on tl.team_id = t.id and tl.season = 2026 and tl.week = 3
   where tl.slot_map = q.r -> 'slot_map'),
  7, 'H1 the REAL tick wrote, for all seven teams, EXACTLY the map the pure chooser returned');
select is(
  (select jsonb_array_length(current_setting('pgtap.ta')::jsonb -> 'autopiloted') + jsonb_array_length(current_setting('pgtap.tf')::jsonb -> 'autopiloted')),
  5, 'H2 …five teams written (Y1, Y4, Y5, Y6, Y7); Y2 and Y3 evaluated and left as they were');
select is(
  (select format('%s>%s:%s', x ->> 'out', x ->> 'in', strpos(x ->> 'why', 'Q68') > 0)
   from jsonb_array_elements(current_setting('pgtap.ta')::jsonb -> 'autopiloted') a,
        jsonb_array_elements(a -> 'substituted') x
   where a ->> 'team_id' = 'ca000000-0000-4000-8000-000000000001'),
  'q68-y1-bye>q68-y1-dbt:t',
  'H3 the TICK''s own report names Y1''s Q68 swap (out the bye man, in the Doubtful man, the `why` naming Q68) — forwarded verbatim by arm (c), with zero tick hunks');
select is(
  (select s -> 'flags' from team_lineups tl, jsonb_array_elements(tl.starters) s
   where tl.team_id = 'ca000000-0000-4000-8000-000000000006' and tl.week = 3 and s ->> 'slot' = 'flex:0'),
  '[]'::jsonb,
  'H4 the WRITTEN starters element of QF''s swapped-in Doubtful man carries no `out` flag');
select is(format('%s %s', current_setting('pgtap.ta')::jsonb -> 'failures', current_setting('pgtap.tf')::jsonb -> 'failures'),
  '[] []', 'H5 both ticks'' failures[] are EMPTY');

select * from finish();
rollback;
