-- ============================================================================
-- 184 — game status: an operator marks an NFL game (M8 L.G1.4; spec §24.4
--       v2.16.89 "Game status", §23.4 held-week bullet, E43; tasks-M8 TD6 /
--       TD7; Q99 (a) / Q100 ruled 2026-10-08 — answers Q37, discharges
--       F243; PROGRESS D513; FULL rigour — scoring, standings, NFL data)
-- ============================================================================
--
-- THE RULING (Q100, Chris 2026-10-08): an operator may mark a game
--   moved later this week — the week waits for it;
--   moved out of the week  — its players score 0, the week closes (E43);
--   cancelled              — the same as moved out;
-- the stat sync must not overwrite the mark; switching back clears it. Q99
-- (a): there is NO forced finalize — after the mark, the NORMAL path
-- (league_week_advance → finalize_matchups, E43) closes the week, and
-- standings rebuild through the existing chain. Nothing here finalizes.
--
-- WHAT THIS ADDS
--
--   1. `nfl_games.operator_hold` — NULL (no mark) or 'in_week' |
--      'out_of_week' | 'cancelled', with `operator_hold_at` and
--      `operator_hold_prior_status` (the provider status the first mark
--      replaced — what "back to normal" restores). The mark WRITES the row's
--      status in the provider vocabulary the whole chain already reads
--      (001's `status` has no `cancelled`, StatsProvider's union neither):
--        in_week     → status 'scheduled' (an open, in-week game: it holds
--                      the week in SQL — 116 — and in the sync's release
--                      stamp — ingest-week `weekBounds`);
--        out_of_week → status 'postponed' (E43's vocabulary: the lineup
--        cancelled     helpers 157 / 166 release its records, the sync's
--                      `weekBounds` already excludes it, its players are
--                      never `is_live`) — and the HOLD itself makes it LEFT
--                      THE WEEK in the two SQL predicates that also demand a
--                      kickoff past the next week's start (below), so a game
--                      whose kickoff never moves — NFL week 18 included, the
--                      F243 case with no later calendar row — still leaves.
--      The kickoff is NEVER rewritten (no invented instant).
--
--   2. Two predicates gain ONE arm each (D137 — CREATE OR REPLACE against
--      the newest definer's FILE TEXT; every hunk is one INSERTED line
--      ending `-- 184 / L.G1.4 (TD7)`, so removing those lines is the
--      predecessor byte for byte — pgTAP 132 A-cells):
--        week_games_state_internal          116:317-359  md5 9c9b591a… → 1 hunk (+1 / -0)
--          (finalize_matchups' §23.2 gate — `left_week`)
--        commish_matchup_edit_lock_internal 142:156-450  md5 0ce42ac9… → 2 hunks (+2 / -0)
--          (the Q61 / Q67 correction lock — F243's "one arm in 135", R1099)
--      No other SQL decides "left the week" (measured: every `'postponed'`
--      reader over supabase/migrations — 116 / 142 carry the kickoff-bound
--      predicate; 157 / 166 read `status = 'postponed'` alone, which the
--      mark writes; finalize_matchups 117 / 118 / 180 / 183 reads 116's
--      helper and is NOT edited).
--
--   3. `op_set_game_status(game_id, status, action_id, reason)` — status
--      'in_week' | 'out_of_week' | 'cancelled' | 'normal'. SECURITY DEFINER,
--      search_path '', the operator gate in-body (TD1), idempotent on
--      action_id (a replay returns the receipt and writes nothing), reason
--      optional. A no-op (the same mark again; 'normal' on an unmarked game)
--      writes NOTHING and says why. A change writes the game row, ONE
--      `platform_operator_actions` receipt (scope 'platform' — an NFL edit
--      reaches every league) and ONE "FieldScout" line in each league still
--      playing that week (TD11, through 183's `op_league_line_internal`).
--      REFUSED BY NAME: a `final` game (it was played — nothing to mark), and
--      any change once a league has made that week FINAL (§23.4: "only a
--      final week never changes"). The door passes the database clock
--      (`now()`); the plain `_internal` takes the instant (the TimeProvider
--      seam the tests use) — no identity swap (R1545).
--
--   NOT HERE — `op_force_week_close` (PROGRESS Q103, filed by this task: what
--   "close a week, ignoring the Wednesday ceiling only" does to a game still
--   unplayed is not settled by §24.4 / §11.2 — HALTED, not improvised).
--
-- THE SYNC (TD7 / Q100 — "the sync respects operator_hold"):
-- `src/lib/sync/ingest-week.ts` reads the hold and never writes a held row
-- (counted `games.held`, named in `reasons`); the stored row stays in the
-- week's bounds, so the release stamp follows the mark. Switching back
-- clears the hold, and the next poll writes the provider's row again.
-- `src/lib/leagues/scoring/reconcile.ts` (the calendar alert) reads the
-- hold too, so a cancelled game is never named as holding its week.
--
-- DEPLOY BEFORE PUSH (TD9 / D506). Production is at 183. The app reads
-- `nfl_games` with `select('*')` in the two TS readers, so a row without the
-- column reads `operator_hold` undefined = no hold — the sync and the alert
-- behave exactly as today until the push. No client calls the door yet.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4): three nullable columns on one
-- existing table (no default, no rewrite; RLS unchanged — 005's read policy;
-- no client write path exists or is added) + two CHECKs; one DEFINER door
-- (in-body gate, search_path '', EXECUTE authenticated only) over one PLAIN
-- internal (REVOKEd from PUBLIC / anon / authenticated); two plain bodies
-- replaced with signatures, volatility and ACL unchanged (REVOKEs restated).
-- No trigger, policy, grant to anon, cron row or realtime change. Time only
-- through p_at. Typegen: the columns + the two functions (additive; alias
-- block re-appended). WAIVERS: R6 — no staging clone; rehearsal evidence =
-- the fresh local `db reset` 001–184 and the full pgTAP run in the PR. D38 —
-- nothing to backfill: every existing row reads NULL = no mark, which is
-- exactly today's behaviour.
-- pgTAP 132_game_status.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The mark (TD7)
-- ---------------------------------------------------------------------------
ALTER TABLE nfl_games
  ADD COLUMN operator_hold TEXT
    CHECK (operator_hold IS NULL OR operator_hold IN ('in_week', 'out_of_week', 'cancelled')),
  ADD COLUMN operator_hold_at TIMESTAMPTZ,
  ADD COLUMN operator_hold_prior_status TEXT,
  ADD CONSTRAINT nfl_games_operator_hold_whole
    CHECK ((operator_hold IS NULL) = (operator_hold_at IS NULL)
       AND (operator_hold IS NOT NULL OR operator_hold_prior_status IS NULL));

COMMENT ON COLUMN nfl_games.operator_hold IS
  'M8 TD7 / Q100 (migration 184): a platform operator''s mark — NULL = none; in_week (moved later this week: the week waits), out_of_week / cancelled (its players score 0 and the week closes under E43). Written only by op_set_game_status; the stat sync never writes a held row. Switching back clears it.';
COMMENT ON COLUMN nfl_games.operator_hold_prior_status IS
  'M8 TD7 (migration 184): the provider status the first mark replaced — what op_set_game_status(…, ''normal'') restores. NULL whenever operator_hold is NULL.';

-- ---------------------------------------------------------------------------
-- 2. week_games_state_internal — CREATE OR REPLACE against 116:317-359's
--    FILE TEXT (D137), 1 hunk (+1 / -0) marked `184 / L.G1.4 (TD7)`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION week_games_state_internal(
  p_season INTEGER,
  p_week   INTEGER
) RETURNS TABLE (
  total_games     INTEGER,
  final_games     INTEGER,
  postponed_games INTEGER,
  open_games      INTEGER,
  all_final       BOOLEAN,
  postponed_list  TEXT
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH bound AS (
    -- The week ends where the next calendar week starts (§23.3's datum).
    SELECT min(w.starts_at) AS next_starts_at
    FROM public.nfl_weeks w
    WHERE w.season = p_season AND w.week > p_week
  ),
  g AS (
    SELECT g.id, g.status, g.kickoff_at, g.home_team, g.away_team,
           COALESCE(g.operator_hold IN ('out_of_week', 'cancelled'), FALSE) OR   -- 184 / L.G1.4 (TD7)
           (g.status = 'postponed'
              AND b.next_starts_at IS NOT NULL
              AND g.kickoff_at >= b.next_starts_at) AS left_week
    FROM public.nfl_games g
    CROSS JOIN bound b
    WHERE g.season = p_season AND g.week = p_week
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE g.status = 'final')::int,
    count(*) FILTER (WHERE g.left_week)::int,
    count(*) FILTER (WHERE NOT g.left_week AND g.status <> 'final')::int,
    -- At least one in-week game, and every in-week game final. Zero rows is
    -- the emptiest partial data there is (§23.2) — never finalizable.
    (count(*) FILTER (WHERE NOT g.left_week)) > 0
      AND (count(*) FILTER (WHERE NOT g.left_week AND g.status <> 'final')) = 0,
    string_agg(g.away_team || ' @ ' || g.home_team, ', ' ORDER BY g.kickoff_at, g.id)
      FILTER (WHERE g.left_week)
  FROM g;
$$;
REVOKE EXECUTE ON FUNCTION week_games_state_internal(INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. commish_matchup_edit_lock_internal — CREATE OR REPLACE against
--    142:156-450's FILE TEXT (D137), 2 hunks (+2 / -0) marked
--    `184 / L.G1.4 (TD7)`: the judged starters' games and (A)'s week games
--    both treat an out-of-week / cancelled mark as LEFT THE WEEK.
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
        AND g.operator_hold IS DISTINCT FROM 'out_of_week' AND g.operator_hold IS DISTINCT FROM 'cancelled'   -- 184 / L.G1.4 (TD7)
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
             COALESCE(g.operator_hold IN ('out_of_week', 'cancelled'), FALSE) OR   -- 184 / L.G1.4 (TD7)
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
-- 4. op_set_game_status (TD7 / Q100)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION op_set_game_status_internal(
  p_game_id TEXT, p_status TEXT, p_action_id UUID, p_reason TEXT, p_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_replay  JSONB;
  v_actor   UUID := auth.uid();
  v_g       public.nfl_games;
  v_hold    TEXT;
  v_status  TEXT;
  v_prior   TEXT;
  v_final   INTEGER;
  v_game    TEXT;
  v_text    TEXT;
  v_lg      RECORD;
  v_told    INTEGER := 0;
  v_before  JSONB;
  v_after   JSONB;
BEGIN
  v_replay := public.op_verb_prelude_internal('set_game_status', NULL, p_action_id, p_reason);
  IF v_replay IS NOT NULL THEN
    IF v_replay ->> 'game_id' IS DISTINCT FROM p_game_id THEN
      RAISE EXCEPTION 'set_game_status: action id % was already used for a different game', p_action_id
        USING ERRCODE = '22023';
    END IF;
    RETURN v_replay;
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('in_week', 'out_of_week', 'cancelled', 'normal') THEN
    RAISE EXCEPTION 'set_game_status: status must be in_week (moved later this week), out_of_week (moved out of the week), cancelled, or normal (back to normal) — got %', COALESCE(p_status, 'NULL')
      USING ERRCODE = '22023';
  END IF;
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'set_game_status: p_at is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  -- The row lock: a concurrent mark of the same game waits.
  SELECT * INTO v_g FROM public.nfl_games g WHERE g.id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_game_status: game % does not exist', p_game_id USING ERRCODE = 'P0002';
  END IF;
  v_game := v_g.away_team || ' @ ' || v_g.home_team || ' game (week ' || v_g.week || ')';
  v_hold := CASE WHEN p_status = 'normal' THEN NULL ELSE p_status END;

  -- The same mark again (or 'normal' on an unmarked game): nothing to do.
  IF v_g.operator_hold IS NOT DISTINCT FROM v_hold THEN
    RETURN jsonb_build_object('changed', FALSE, 'game_id', p_game_id, 'operator_hold', v_hold,
      'why', CASE WHEN v_hold IS NULL THEN 'not_marked — the game has no operator mark; nothing was written'
                  ELSE 'already_marked — the game already carries this mark; nothing was written' END);
  END IF;
  -- A played game has nothing to mark (its players' points are real).
  IF v_g.operator_hold IS NULL AND v_g.status IS NOT DISTINCT FROM 'final' THEN
    RAISE EXCEPTION 'set_game_status: the % is final — it was played, so it cannot be marked moved or cancelled', v_game
      USING ERRCODE = '22023';
  END IF;
  -- §23.4: only a final week never changes — once any league has made the
  -- week final, its games are settled for every league.
  SELECT count(*)::int INTO v_final
  FROM public.league_weeks lw
  JOIN public.leagues l ON l.id = lw.league_id AND l.season = lw.season
  WHERE lw.season = v_g.season AND lw.week = v_g.week AND lw.status = 'final' AND l.deleted_at IS NULL;
  IF v_final > 0 THEN
    RAISE EXCEPTION 'set_game_status: week % of % is already final in % league(s) — a final week never changes (§23.4), so the % cannot be re-marked',
      v_g.week, v_g.season, v_final, v_game
      USING ERRCODE = '22023';
  END IF;

  v_prior  := CASE WHEN v_g.operator_hold IS NULL THEN v_g.status ELSE v_g.operator_hold_prior_status END;
  v_status := CASE p_status
    WHEN 'normal'  THEN v_g.operator_hold_prior_status
    WHEN 'in_week' THEN 'scheduled'
    ELSE 'postponed' END;
  v_before := jsonb_build_object('game_id', p_game_id, 'status', v_g.status, 'operator_hold', v_g.operator_hold,
    'kickoff_at', v_g.kickoff_at, 'season', v_g.season, 'week', v_g.week);

  UPDATE public.nfl_games
  SET status = v_status,
      operator_hold = v_hold,
      operator_hold_at = CASE WHEN v_hold IS NULL THEN NULL ELSE p_at END,
      operator_hold_prior_status = CASE WHEN v_hold IS NULL THEN NULL ELSE v_prior END,
      updated_at = p_at
  WHERE id = p_game_id;

  v_text := 'FieldScout marked the ' || v_game || CASE p_status
    WHEN 'in_week'     THEN ' as moved later this week. The week waits for it before it finishes.'
    WHEN 'out_of_week' THEN ' as moved out of the week. Its players score 0 this week and the week finishes without it.'
    WHEN 'cancelled'   THEN ' as cancelled. Its players score 0 this week and the week finishes without it.'
    ELSE ' back to normal. It counts in its week as usual.' END;
  -- Every league still playing that week hears it.
  FOR v_lg IN
    SELECT DISTINCT l.id
    FROM public.leagues l
    JOIN public.league_weeks lw ON lw.league_id = l.id AND lw.season = l.season
    WHERE l.season = v_g.season AND lw.week = v_g.week
      AND l.status IN ('in_season', 'playoffs') AND l.deleted_at IS NULL
      AND lw.status <> 'final'
    ORDER BY l.id
  LOOP
    PERFORM public.op_league_line_internal(v_lg.id, v_text);
    v_told := v_told + 1;
  END LOOP;

  v_after := jsonb_build_object('changed', TRUE, 'game_id', p_game_id, 'status', v_status,
    'operator_hold', v_hold, 'kickoff_at', v_g.kickoff_at, 'season', v_g.season, 'week', v_g.week,
    'leagues_told', v_told, 'marked_at', p_at);
  PERFORM public.log_operator_action_internal(p_action_id, v_actor, 'set_game_status',
    'platform', NULL, p_reason, v_before, v_after);
  RETURN v_after;
END;
$$;
REVOKE ALL ON FUNCTION op_set_game_status_internal(TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION op_set_game_status_internal(TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ) IS
  'M8 TD7 / Q100 (migration 184): the body of op_set_game_status at an injected instant. PLAIN, REVOKEd — reached through the door and the tests only.';

CREATE OR REPLACE FUNCTION op_set_game_status(
  p_game_id TEXT, p_status TEXT, p_action_id UUID DEFAULT NULL, p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'set_game_status: only a platform operator can mark a game (M8 TD1)' USING ERRCODE = '42501';
  END IF;
  RETURN public.op_set_game_status_internal(p_game_id, p_status, p_action_id, p_reason, now());
END;
$$;
REVOKE ALL ON FUNCTION op_set_game_status(TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION op_set_game_status(TEXT, TEXT, UUID, TEXT) TO authenticated;
COMMENT ON FUNCTION op_set_game_status(TEXT, TEXT, UUID, TEXT) IS
  'M8 §24.4 (migration 184, TD7 / Q100): mark an NFL game in_week (moved later this week — the week waits), out_of_week or cancelled (its players score 0 and the normal E43 path closes the week), or normal (clears the mark, restores the provider status). Operators only (in-body gate); idempotent on p_action_id; the same mark again = no-op, nothing written; a final game or a week final in any league is refused. One platform receipt + a "FieldScout" line in each league still playing that week. No finalize (Q99 (a)).';
