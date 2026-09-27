-- ============================================================================
-- 142_unfinished_lineup_lock_and_doubtful_swap.sql — Q67 + Q68, AS RULED
-- (M6A task L.E1.25; tasks-M6A §12's 2026-09-27 amendment; PROGRESS §3 Q67 /
-- Q68 (both RULED by Chris 2026-09-27), F384 (discharged here), D372 (135's
-- helper), D375 / D376 (the chooser), R1097–R1103 (L.E1.18's reviews), R1123
-- (Q68's measured facts), D379; spec v2.16.50 §7.2.1(c), §10.1 *Matchups &
-- results*, §15.4's v2.16.42 ruling note).
--
-- Numbering: RESERVED by the orchestrator, not measured-and-taken — PR #320
-- (L.E1.24, open) holds 141 / pgTAP 089, this task holds **142 / pgTAP 090**.
-- Built and tested on main @ f730c2a (heads 140 / 088); the gap at 141 is
-- expected until #320 merges. Nothing here depends on 141 (141 replaces
-- `commish_change_setting_internal` only). NOT held: reaches production by
-- `npx supabase db push`. Production is at 134 — push debt becomes 135–142
-- once #320 and this merge.
--
-- ---------------------------------------------------------------------------
-- THE RULINGS (Chris, 2026-09-27, in chat)
-- ---------------------------------------------------------------------------
-- Q67: "you cannot edit a score for a matchup that has not finished yet."
--   BUILT AS READ BY R1140 (PR #321's review; the orchestrator's reading of
--   Chris's rule, stated to him 2026-09-27 and open for him to correct): a
--   matchup has FINISHED when EITHER
--     (A) every NFL game of the league week is over — every `nfl_games` row
--         of the week `final` or moved out of the week (116's `left_week`),
--         and at least one in-week row — OR
--     (B) every STARTING slot on BOTH sides holds a player whose game is
--         final.
--   An empty starting slot, a starter on bye (or whose game left the week),
--   or a side with no lineup row / no starter keeps the matchup OPEN under
--   (B) — a manager could still add a player who plays later — but (A)
--   releases it as soon as the week's games are all over. A FINAL league
--   week is always editable (precedence unchanged). IR slots are not
--   starting slots. (The FIRST build of this migration read "the week is
--   done" as the league week being FINAL and let a bye / empty slot beside a
--   finished starter hold nothing open; R1140 replaced both readings in the
--   fix round, in place — 142 is unpushed.)
-- Q68: "yes, swap in the doubtful." When no healthy, unlocked, eligible
--   replacement exists, a Doubtful one replaces a starter who is OUT / on
--   bye — never one Doubtful player for another, never a locked player.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES (two CREATE OR REPLACEs; no table, no column, no
-- policy, no grant, no signature changes — typegen 0-line)
-- ---------------------------------------------------------------------------
--   1. `commish_matchup_edit_lock_internal` — CREATE OR REPLACE against the
--      NEWEST definer's FILE TEXT, **135:190-353 on this branch** (= 135:182-345
--      at f730c2a; this PR's comment-only banner edits in 135 shifted it by
--      eight lines — R1143) (135 is its only definer — measured by grep over
--      supabase/migrations). **TWO `diff -u` hunks** (142 `+` lines / 14 `-`
--      lines):
--        (i)   after `unfinished`, three NEW CTEs: `slot_defs` (the league's
--              STARTING slot instances, `<key>:<i>` from
--              `roster_settings.starting_slots` — never an IR spot),
--              `week_games` ((A): the week's in-week games and how many are
--              not `final`, a left-the-week game excluded by 116's predicate,
--              a NULL-kickoff postponed row held IN the week — the
--              conservative side), and `open_slots` ((B)'s open slots, per
--              side: an EMPTY starting slot on a side that has a row, and a
--              starter with NO game this week in a week that has game rows —
--              the bye, the left-the-week game, the no-club player);
--        (ii)  `verdict` gains `week_games_over`, `open_slots`, the list, the
--              sides, and the two name strings; the CASE is rewritten as a
--              LATERAL `doc` with the ONE refusal sentence computed once,
--              and every answer gains `week_games_over`, `open_slots[]` and
--              `no_starter_game_sides[]` (both EMPTY whenever editable).
--      PRECEDENCE: `week_final` > (B) `every_starter_finished` > (A)
--      `week_games_over` (NEW `why`, editable) > `lineup_not_set` >
--      `no_starter_game` (an open slot — now a REFUSAL) >
--      `starters_not_finished`; the ELSE (no side / no starting slot at all)
--      REFUSES — never a vacuous yes. (B) before (A) keeps a matchup whose
--      starters all finished reading `every_starter_finished` whatever the
--      rest of the week does (074 C5c, unchanged).
--      THE SENTENCE (one, every reason that holds, NULL clauses dropped):
--      "This matchup can be corrected once every starter's game has finished
--      — no lineup set yet: <team>; empty starting slot: <team> (<slot
--      label>, …); starter with no game this week: <team> (<player>,
--      <club>); not finished yet: <player> (<club>)".
--      The read door (135 §2) and the verb (135 §3) are UNTOUCHED — both call
--      the helper, so the panel and the refusal flip together.
--   2. `lineup_autopilot_internal` — CREATE OR REPLACE against the NEWEST
--      definer's FILE TEXT, **139:527-1033** (definers 125 / 138 / 139;
--      126 / 127 only name it). **FOUR `diff -u` hunks**:
--        (i)   DECLARE — five variables for pass 1b;
--        (ii)  the Q63 restore loop DEFERS a vacated BLOCKED starter (bye or
--              OUT / IR / PUP / NFI / Suspended) whose key no healthy man
--              took, instead of restoring him at once; a vacated DOUBTFUL
--              starter is restored exactly as before (never one Doubtful for
--              another);
--        (iii) NEW PASS 1b: the deferred keys ONLY, contested by the Doubtful
--              tail in Q62 order minus every man staying where he is; a key
--              a Doubtful man takes is `substituted[]` (the same entry shape
--              plus a `why` naming Q68), one nobody takes is `restored[]`
--              (reason naming Q63; Q68). Runs under BOTH
--              `allow_illegal_lineups` values — a Doubtful start is legal
--              (114:596) — which restores production's (125) swap in a league
--              that forbids illegal lineups (R1123(b));
--        (iv)  pass 2's tail loop skips a man pass 1b already seated.
--      Everything else is 139's, byte for byte: the Q62 sort (one clause),
--      the 6 h read bound, the three `unfillable[]` reason strings (R1076's
--      file-text pin), both early RETURNs, the lock (D338 — a locked man is
--      never a candidate and a locked starter is never vacated), the IR
--      carry, the `out` flag (Doubtful still not in it), `order_basis` (a
--      pass-1b Doubtful man is a candidate the pass ORDERED, so he is
--      counted; a deferred-then-restored man is in `v_seated`, so he is not —
--      F392 unchanged). Empty slots are unchanged: pass 2 still offers them
--      the Doubtful tail ahead of the blocked tail (086 D8 — unchanged).
--   `lineup_lock_tick` (139:1045-…) is NOT replaced: arm (c) forwards the
--   chooser's `substituted[]` / `restored[]` verbatim, so the swap reaches the
--   tick's report with zero tick hunks (pgTAP 090 proves it on a real tick).
--
-- ---------------------------------------------------------------------------
-- MIGRATION CHECKLIST (tasks-M* §4.4)
-- ---------------------------------------------------------------------------
-- Additive in shape: two `CREATE OR REPLACE`s with the hunk counts above
-- (D137 — each against the newest definer's FILE TEXT, never
-- `pg_get_functiondef`). Both functions keep 135's / 139's posture verbatim:
-- PLAIN (never DEFINER), `search_path = ''`, triple-REVOKEd (PUBLIC, anon,
-- authenticated) — re-issued below after each body. No table, column,
-- policy, CHECK, grant or signature changes (typegen 0-line; the alias block
-- untouched). WAIVERS: none. R6 / D38 not engaged (nothing backfilled, no
-- CHECK tightened, no data rewritten). No `HELD-FROM-PRODUCTION.txt` entry.
-- R1101 (F384's second half): 135's banner stated two premises as fact that
-- are not — "lineup rows only appear once a week opens" (a manager can
-- pre-set one) and "an existing all-empty row is a set lineup" (the carry
-- writes them empty for a team that never set one). This PR corrects those
-- banner lines in 135 as COMMENT-ONLY edits (135 is unpushed — the 129 / 135
-- precedent; no statement outside a comment changed), and says it here.
-- md5(prosrc) of both new bodies are pinned as stored literals in pgTAP 090
-- §A, with each hunk reversed back to 135's / 139's md5 byte for byte; 087
-- A8 / A8b are re-pinned THROUGH that reversal (D379). EDITED IN PLACE in
-- PR #321's fix round (R1140 — 142 is unpushed): §1 only; §2 is
-- byte-identical to the reviewed text.
--
-- WHAT PUSHING THIS DOES IN PRODUCTION, IN WORDS: (1) a commissioner can no
-- longer correct a matchup while the week still has NFL games to play AND a
-- starting slot on either side is empty, holds a player on bye (or whose
-- game left the week), or a side has no lineup (week 1 before lineups are
-- set; a commissioner-managed seat with an empty carried lineup) — the panel
-- shows the server's sentence naming the team and why; once every game of
-- the week is over (the correction window) the matchup opens whatever its
-- slots hold, and a FINAL week is unaffected. (2) An autopilot seat's OUT / bye starter
-- is swapped for a Doubtful bench player when no healthy one exists — what
-- production (125) already does today, so for production this is not a
-- change; it undoes 138's regression before 138 is pushed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. commish_matchup_edit_lock_internal — Q67 as READ by R1140: a matchup is
--    editable once (A) every NFL game of its week is over, or (B) every
--    starting slot on both sides holds a player whose game is final.
--    CREATE OR REPLACE against 135:190-353's FILE TEXT on this branch
--    (= 135:182-345 at f730c2a — the banner's comment-only edits above it
--    shifted it eight lines; D137), TWO hunks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_matchup_edit_lock_internal(
  p_league_id  UUID,
  p_matchup_id UUID
) RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH m AS (
    SELECT mm.season, mm.week, mm.home_team_id, mm.away_team_id
    FROM public.matchups mm
    WHERE mm.id = p_matchup_id AND mm.league_id = p_league_id
  ),
  lw AS (
    SELECT lw.status
    FROM public.league_weeks lw
    JOIN m ON lw.league_id = p_league_id AND lw.season = m.season AND lw.week = m.week
  ),
  -- The IR spot keys (§7.3.2 `ir_slots[].key`) — a value under one is NOT a
  -- starter (score-week-worker.ts `irKeysOf` / `startersOf`).
  ir AS (
    SELECT s ->> 'key' AS key
    FROM public.leagues l
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.roster_settings -> 'ir_slots', '[]'::jsonb)) s
    WHERE l.id = p_league_id AND (s ->> 'key') IS NOT NULL
  ),
  sides AS (
    SELECT m.home_team_id AS team_id, 'home'::text AS side FROM m
    UNION ALL
    SELECT m.away_team_id, 'away'::text FROM m WHERE m.away_team_id IS NOT NULL
  ),
  -- R1097: a side with NO stored lineup row for the week. Outside a FINAL
  -- week it is NOT finished (`lineup_not_set`) — never "no starters".
  no_lineup AS (
    SELECT s.team_id, s.side, COALESCE(t.name, s.team_id::text) AS team_name
    FROM sides s
    CROSS JOIN m
    LEFT JOIN public.teams t ON t.id = s.team_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.team_lineups tl
      WHERE tl.team_id = s.team_id AND tl.season = m.season AND tl.week = m.week)
  ),
  starters AS (
    SELECT s.team_id, s.side, e.key AS slot, e.value #>> '{}' AS player_id
    FROM sides s
    CROSS JOIN m
    JOIN public.team_lineups tl
      ON tl.team_id = s.team_id AND tl.season = m.season AND tl.week = m.week
    CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(tl.slot_map) = 'object' THEN tl.slot_map ELSE '{}'::jsonb END) e
    WHERE jsonb_typeof(e.value) = 'string'
      AND (e.value #>> '{}') <> ''
      AND NOT EXISTS (SELECT 1 FROM ir WHERE ir.key = split_part(e.key, ':', 1))
  ),
  -- E43: a game has LEFT the week only when it is `postponed` AND its kickoff
  -- lies at/after the next calendar week's start — 116:340's predicate.
  bound AS (
    SELECT min(w.starts_at) AS next_starts_at
    FROM public.nfl_weeks w
    CROSS JOIN m
    WHERE w.season = m.season AND w.week > m.week
  ),
  week_rows AS (
    SELECT count(g.id)::int AS n
    FROM m
    LEFT JOIN public.nfl_games g ON g.season = m.season AND g.week = m.week
  ),
  judged AS (
    SELECT st.team_id, st.side, st.slot, st.player_id,
           COALESCE(p.full_name, st.player_id) AS name,
           p.team AS nfl_team,
           gm.games,
           gm.open_games,
           gm.open_kickoff,
           gm.open_status,
           wr.n AS week_rows
    FROM starters st
    CROSS JOIN m
    CROSS JOIN bound b
    CROSS JOIN week_rows wr
    LEFT JOIN public.players p ON p.id = st.player_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS games,
             count(*) FILTER (WHERE g.status IS DISTINCT FROM 'final')::int AS open_games,
             min(g.kickoff_at) FILTER (WHERE g.status IS DISTINCT FROM 'final') AS open_kickoff,
             (array_agg(COALESCE(g.status, 'null') ORDER BY g.kickoff_at, g.id)
                FILTER (WHERE g.status IS DISTINCT FROM 'final'))[1] AS open_status
      FROM public.nfl_games g
      WHERE g.season = m.season AND g.week = m.week
        AND p.team IS NOT NULL
        AND (g.home_team = p.team OR g.away_team = p.team)
        AND NOT (g.status IS NOT DISTINCT FROM 'postponed'
                 AND b.next_starts_at IS NOT NULL
                 AND g.kickoff_at >= b.next_starts_at)
    ) gm ON TRUE
  ),
  unfinished AS (
    SELECT j.*,
           CASE WHEN j.week_rows = 0 THEN 'no_game_rows' ELSE j.open_status END AS game_status
    FROM judged j
    WHERE j.week_rows = 0 OR j.open_games > 0
  ),
  -- 142 (L.E1.25; Q67 RULED 2026-09-27 — "you cannot edit a score for a
  -- matchup that has not finished yet" — as READ by R1140, the reading stated
  -- to Chris 2026-09-27). A matchup has FINISHED when EITHER
  --   (A) every NFL game of the league week is over: every in-week
  --       `nfl_games` row reads `final` — a row that has LEFT the week (116's
  --       `left_week`, the E43 predicate `judged` uses above) is not counted —
  --       and at least one in-week row exists (zero rows is the emptiest
  --       partial data, never "all over" — 116's `all_final`, §23.2); OR
  --   (B) every STARTING slot on BOTH sides holds a player whose game is
  --       final. An EMPTY starting slot, a starter with NO game this week (a
  --       bye, a game that left the week, no club) and a side with NO lineup
  --       row each keep the matchup OPEN under (B) — a manager could still
  --       start a player who plays later — but (A) releases it as soon as the
  --       week's games are all over. IR spots are not starting slots.
  -- A FINAL league week is always editable (R1092 — unchanged, and first).
  --
  -- The league's STARTING SLOT instances, `<key>:<i>` for i < `count` — the
  -- slot keys a stored `slot_map` uses (139's `v_slots`, 114).
  slot_defs AS (
    SELECT (s ->> 'key') || ':' || g.i AS slot,
           COALESCE(s ->> 'label', s ->> 'key') AS label,
           t.ord, g.i
    FROM public.leagues l
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.roster_settings -> 'starting_slots', '[]'::jsonb))
      WITH ORDINALITY AS t(s, ord)
    CROSS JOIN LATERAL generate_series(0, COALESCE((s ->> 'count')::int, 0) - 1) AS g(i)
    WHERE l.id = p_league_id AND (s ->> 'key') IS NOT NULL
  ),
  -- (A): the week's own games. A NULL-kickoff postponed row is NOT "left the
  -- week" here (COALESCE → FALSE): it holds (A) open, the conservative side.
  week_games AS (
    SELECT count(*) FILTER (WHERE NOT x.left_week)::int AS in_week,
           count(*) FILTER (WHERE NOT x.left_week AND x.status IS DISTINCT FROM 'final')::int AS open
    FROM (
      SELECT g.status,
             COALESCE(g.status IS NOT DISTINCT FROM 'postponed'
                      AND b.next_starts_at IS NOT NULL
                      AND g.kickoff_at >= b.next_starts_at, FALSE) AS left_week
      FROM m
      CROSS JOIN bound b
      JOIN public.nfl_games g ON g.season = m.season AND g.week = m.week
    ) x
  ),
  -- (B)'s OPEN SLOTS, per side: an EMPTY starting slot on a side that HAS a
  -- lineup row (a side with none is `no_lineup`, above), and a starter with
  -- NO game this week in a week that HAS game rows (in a zero-rows week he is
  -- already unfinished — `no_game_rows`).
  open_slots AS (
    SELECT s.team_id, s.side, COALESCE(t.name, s.team_id::text) AS team_name,
           d.slot, d.label, d.ord, d.i,
           NULL::text AS player_id, NULL::text AS name, NULL::text AS nfl_team,
           'empty_slot'::text AS reason
    FROM sides s
    CROSS JOIN slot_defs d
    LEFT JOIN public.teams t ON t.id = s.team_id
    WHERE NOT EXISTS (SELECT 1 FROM no_lineup nl WHERE nl.team_id = s.team_id)
      AND NOT EXISTS (SELECT 1 FROM starters st WHERE st.team_id = s.team_id AND st.slot = d.slot)
    UNION ALL
    SELECT j.team_id, j.side, COALESCE(t.name, j.team_id::text),
           j.slot, COALESCE(d.label, split_part(j.slot, ':', 1)), d.ord, d.i,
           j.player_id, j.name, j.nfl_team,
           'no_game'
    FROM judged j
    LEFT JOIN slot_defs d ON d.slot = j.slot
    LEFT JOIN public.teams t ON t.id = j.team_id
    WHERE j.week_rows > 0 AND j.games = 0
  ),
  verdict AS (
    SELECT
      (SELECT lw.status FROM lw) AS week_status,
      (SELECT count(*)::int FROM judged) AS starters,
      (SELECT count(*)::int FROM judged j WHERE j.week_rows > 0 AND j.games > 0 AND j.open_games = 0) AS finished,
      (SELECT count(*)::int FROM unfinished) AS not_finished,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'team_id',     u.team_id,
                'side',        u.side,
                'slot',        u.slot,
                'player_id',   u.player_id,
                'name',        u.name,
                'nfl_team',    u.nfl_team,
                'game_status', u.game_status,
                'kickoff_at',  u.open_kickoff)
              ORDER BY u.open_kickoff NULLS LAST, u.name, u.player_id), '[]'::jsonb)
         FROM unfinished u) AS still_playing,
      (SELECT string_agg(u.name || ' (' || COALESCE(u.nfl_team, 'no team') || ')', ', '
                ORDER BY u.open_kickoff NULLS LAST, u.name, u.player_id)
         FROM unfinished u) AS names,
      (SELECT count(*)::int FROM no_lineup) AS lineups_missing,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'team_id',   nl.team_id,
                'side',      nl.side,
                'team_name', nl.team_name)
              ORDER BY nl.side = 'away', nl.team_id), '[]'::jsonb)
         FROM no_lineup nl) AS no_lineup,
      (SELECT string_agg(nl.team_name, ', ' ORDER BY nl.side = 'away', nl.team_id)
         FROM no_lineup nl) AS no_lineup_names,
      -- 142 (Q67 / R1140): (A), and (B)'s open slots — named per side.
      (SELECT wg.in_week > 0 AND wg.open = 0 FROM week_games wg) AS week_games_over,
      (SELECT count(*)::int FROM open_slots) AS open_slots,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'team_id',   o.team_id,
                'side',      o.side,
                'team_name', o.team_name,
                'slot',      o.slot,
                'label',     o.label,
                'reason',    o.reason,
                'player_id', o.player_id,
                'name',      o.name,
                'nfl_team',  o.nfl_team)
              ORDER BY o.side = 'away', o.team_id, o.ord NULLS LAST, o.i, o.slot), '[]'::jsonb)
         FROM open_slots o) AS open_slot_list,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'team_id',   x.team_id,
                'side',      x.side,
                'team_name', x.team_name)
              ORDER BY x.side = 'away', x.team_id), '[]'::jsonb)
         FROM (SELECT DISTINCT o.team_id, o.side, o.team_name FROM open_slots o) x) AS no_starter_game_sides,
      -- One entry per side, its empty slots by label in slot order, a label
      -- empty more than once counted ("WR ×2").
      (SELECT string_agg(y.team_name || ' (' || y.labels || ')', ', ' ORDER BY y.side = 'away', y.team_id)
         FROM (SELECT x.team_id, x.side, x.team_name,
                      string_agg(x.label || CASE WHEN x.n > 1 THEN ' ×' || x.n ELSE '' END, ', '
                                 ORDER BY x.ord NULLS LAST, x.label) AS labels
               FROM (SELECT o.team_id, o.side, o.team_name, o.label, min(o.ord) AS ord, count(*) AS n
                     FROM open_slots o
                     WHERE o.reason = 'empty_slot'
                     GROUP BY o.team_id, o.side, o.team_name, o.label) x
               GROUP BY x.team_id, x.side, x.team_name) y) AS empty_names,
      (SELECT string_agg(o.team_name || ' (' || o.name || ', ' || COALESCE(o.nfl_team, 'no team') || ')', ', '
                ORDER BY o.side = 'away', o.team_id, o.ord NULLS LAST, o.i, o.slot)
         FROM open_slots o
         WHERE o.reason = 'no_game') AS no_game_names
  )
  -- 142 (Q67 / R1140): the verdict, then the open slots on every answer —
  -- EMPTY whenever the matchup is editable (nothing holds it open).
  SELECT d.doc || jsonb_build_object(
           'week_games_over',       v.week_games_over,
           'no_starter_game_sides', CASE WHEN (d.doc ->> 'editable')::boolean THEN '[]'::jsonb
                                         ELSE v.no_starter_game_sides END,
           'open_slots',            CASE WHEN (d.doc ->> 'editable')::boolean THEN '[]'::jsonb
                                         ELSE v.open_slot_list END)
  FROM verdict v
  -- The ONE refusal sentence: every reason that holds, named by team or
  -- player, in this order (a NULL clause drops out).
  CROSS JOIN LATERAL (SELECT 'This matchup can be corrected once every starter''s game has finished — '
      || concat_ws('; ', 'no lineup set yet: ' || v.no_lineup_names,
                         'empty starting slot: ' || v.empty_names,
                         'starter with no game this week: ' || v.no_game_names,
                         'not finished yet: ' || v.names) AS refusal) r
  CROSS JOIN LATERAL (SELECT CASE
    -- PRECEDENCE (R1092): a FINAL week is always editable.
    WHEN v.week_status = 'final' THEN jsonb_build_object(
      'editable', TRUE, 'why', 'week_final', 'week_status', v.week_status,
      'starters', v.starters, 'finished', v.finished, 'not_finished', 0,
      'still_playing', '[]'::jsonb, 'no_lineup', '[]'::jsonb, 'message', NULL)
    -- (B): both sides have a row, no starting slot is open, every starter's
    -- game is final, and there is at least one.
    WHEN v.lineups_missing = 0 AND v.open_slots = 0 AND v.not_finished = 0 AND v.finished > 0 THEN jsonb_build_object(
      'editable', TRUE, 'why', 'every_starter_finished', 'week_status', v.week_status,
      'starters', v.starters, 'finished', v.finished, 'not_finished', 0,
      'still_playing', '[]'::jsonb, 'no_lineup', '[]'::jsonb, 'message', NULL)
    -- (A): every NFL game of the week is over — releases a missing row, an
    -- empty slot and a no-game starter alike (none can score any more).
    WHEN v.week_games_over THEN jsonb_build_object(
      'editable', TRUE, 'why', 'week_games_over', 'week_status', v.week_status,
      'starters', v.starters, 'finished', v.finished, 'not_finished', v.not_finished,
      'still_playing', v.still_playing, 'no_lineup', '[]'::jsonb, 'message', NULL)
    -- R1097: a side with NO lineup row is NOT finished (never "no starters").
    WHEN v.lineups_missing > 0 THEN jsonb_build_object(
      'editable', FALSE, 'why', 'lineup_not_set', 'week_status', v.week_status,
      'starters', v.starters, 'finished', v.finished, 'not_finished', v.not_finished,
      'still_playing', v.still_playing, 'no_lineup', v.no_lineup,
      'message', r.refusal)
    -- (B) open: an empty starting slot, or a starter with no game this week.
    WHEN v.open_slots > 0 THEN jsonb_build_object(
      'editable', FALSE, 'why', 'no_starter_game', 'week_status', v.week_status,
      'starters', v.starters, 'finished', v.finished, 'not_finished', v.not_finished,
      'still_playing', v.still_playing, 'no_lineup', '[]'::jsonb,
      'message', r.refusal)
    WHEN v.not_finished > 0 THEN jsonb_build_object(
      'editable', FALSE, 'why', 'starters_not_finished', 'week_status', v.week_status,
      'starters', v.starters, 'finished', v.finished, 'not_finished', v.not_finished,
      'still_playing', v.still_playing, 'no_lineup', '[]'::jsonb,
      'message', r.refusal)
    -- No side and no starting slot at all (a row the league does not hold, or
    -- a league with no starting slots): REFUSED — never a vacuous yes.
    ELSE jsonb_build_object(
      'editable', FALSE, 'why', 'no_starter_game', 'week_status', v.week_status,
      'starters', v.starters, 'finished', 0, 'not_finished', 0,
      'still_playing', '[]'::jsonb, 'no_lineup', '[]'::jsonb,
      'message', 'This matchup can be corrected once every starter''s game has finished — no starting slot to judge')
  END AS doc) d;
$$;
REVOKE EXECUTE ON FUNCTION commish_matchup_edit_lock_internal(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. lineup_autopilot_internal — Q68: a Doubtful man replaces an OUT / bye
--    starter when no healthy, unlocked, eligible replacement exists.
--    CREATE OR REPLACE against 139:527-1033's FILE TEXT (D137), FOUR hunks.
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
  --   · empty (or holding a player who has since been dropped) ⇒ OPEN;
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
    IF v_locked OR NOT v_unhealthy THEN
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
