-- ============================================================================
-- 223 — player_stat_lines: every weekly stat line the provider sends, kept
--       VERBATIM (PROGRESS F916, D849).
-- ============================================================================
--
-- THE ASK (Chris, 2026-11-09, verbatim, in chat):
--   "what i want to do is check to make sure we are capturing every single
--    stat that is available"
-- and, on the stat-capture audit's third recommendation ("store Sleeper's
-- whole stat line exactly as sent, the way we already do for projections"):
--   "yes start on 1 then do 2 and 3"
--
-- WHY. The audit (2026-11-09) found that `player_stats` keeps the ~40 stats
-- our map names and drops the rest of Sleeper's line: about half of the 234
-- stat keys Sleeper sends (return yards, first downs, air yards, yards after
-- catch, D/ST tackles, special-teams plays, …), the line's own game id and
-- date, and every line that carries no mapped stat at all (a returner's
-- line, a player with snaps only). This table keeps the provider's line as
-- sent, so a stat we don't map today is never lost: choosing to show or
-- score one later is a map change plus a re-read, not a re-pull of history.
--
-- WHAT IT IS NOT. Never a scoring input: league points read `player_stats`
-- through the registry map, exactly as before. Sleeper's own `pts_*` totals
-- and `pos_rank_*` in `stats` are the SOURCE's numbers, never a league value.
-- No FK to `players`: every line is kept, a player we don't know yet
-- included (2026 wk2's late line, F895). No FK to `nfl_games`: `game_id` is
-- the provider's own id.
--
-- WRITER: `ingestWeek` (src/lib/sync/ingest-week.ts) as service_role, in the
-- same poll that writes `player_stats` — the lines it keeps are exactly the
-- answer the canonical stats came from. Diff-aware on `line_hash`: an
-- unchanged line is not rewritten. On a database without this table the poll
-- says so and keeps nothing (deploy before push); it never fails the poll.
--
-- READ: everyone, like `player_stats` (005: public NFL data, read by the
-- public player pages). WRITE: the service role only — RLS with NO write
-- policy for any role is the wall (a client INSERT is refused, an UPDATE or
-- DELETE matches nothing); the house pattern keeps the default grants and
-- revokes TRUNCATE only (136 / 198, pgTAP 081 C3), since TRUNCATE skips RLS.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   New: 1 table, its PK, 1 index, 1 policy, comments. No function, trigger,
--   cron row or change to any existing object. pgTAP: 045's census
--   100 → 101 (unreachable from a mock); 081's sweeps hold (TRUNCATE revoked,
--   the other grants default). Time: no column default (the
--   writer stamps from its injected clock). Typegen: the new table is added
--   to src/types/database.ts by hand in the same PR. Realtime: none.
--   DEGRADE-BEFORE-PUSH: main ships first; until 223 is on the database the
--   poll's lines step reports "table not on this database" and writes nothing.
-- Rollback = DROP TABLE public.player_stat_lines (nothing reads it yet).
-- ============================================================================

CREATE TABLE public.player_stat_lines (
  source              TEXT        NOT NULL,
  season              INTEGER     NOT NULL,
  season_type         TEXT        NOT NULL,
  week                INTEGER     NOT NULL,
  player_id           TEXT        NOT NULL,
  position            TEXT,
  team                TEXT,
  opponent            TEXT,
  game_id             TEXT,
  game_date           DATE,
  stats               JSONB       NOT NULL,
  meta                JSONB       NOT NULL,
  line_hash           TEXT        NOT NULL,
  source_updated_at   TIMESTAMPTZ,
  first_seen_at       TIMESTAMPTZ NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (source, season, season_type, week, player_id),
  CONSTRAINT player_stat_lines_stats_object CHECK (jsonb_typeof(stats) = 'object'),
  CONSTRAINT player_stat_lines_meta_object CHECK (jsonb_typeof(meta) = 'object'),
  CONSTRAINT player_stat_lines_source_nonblank CHECK (btrim(source) <> ''),
  CONSTRAINT player_stat_lines_week_positive CHECK (week > 0),
  CONSTRAINT player_stat_lines_seen_order CHECK (first_seen_at <= updated_at)
);

-- A player's lines across weeks (the player view's research reads).
CREATE INDEX player_stat_lines_player_idx ON public.player_stat_lines (player_id, season, week);

COMMENT ON TABLE public.player_stat_lines IS
  'Every weekly stat line the provider sends, kept verbatim — 223 (PROGRESS F916 / D849). One row per (source, season, season_type, week, player). `stats` = the provider''s stats object exactly as sent (every key, mapped or not; Sleeper''s pts_* / pos_rank_* are the SOURCE''s numbers, never a league value); `meta` = the rest of the provider''s row (game id, date, team, opponent, timestamps, …) minus its embedded player block. Never a scoring input: league points read player_stats. Written ONLY by the stats poll (ingestWeek) as service_role, diff-aware on line_hash; readable by everyone like player_stats; no write policy for any role (TRUNCATE revoked; RLS refuses every client write).';
COMMENT ON COLUMN public.player_stat_lines.source IS
  'The provider the line came from (''sleeper'').';
COMMENT ON COLUMN public.player_stat_lines.player_id IS
  'The provider''s player id (Sleeper''s = players.id). No FK: a line for a player not in players yet is kept too.';
COMMENT ON COLUMN public.player_stat_lines.position IS
  'The position list the provider served the line under (the poll asks per position).';
COMMENT ON COLUMN public.player_stat_lines.game_id IS
  'The provider''s own game id for the line, as sent — not nfl_games.id.';
COMMENT ON COLUMN public.player_stat_lines.stats IS
  'The provider''s stats object VERBATIM — every key, mapped by our registry or not. A NULL stats object is stored as {}.';
COMMENT ON COLUMN public.player_stat_lines.meta IS
  'The provider''s row VERBATIM minus `stats` and its embedded player block.';
COMMENT ON COLUMN public.player_stat_lines.line_hash IS
  'md5 of the line''s canonical JSON (stats, meta, position) — the writer''s diff key: an unchanged line is not rewritten.';
COMMENT ON COLUMN public.player_stat_lines.source_updated_at IS
  'The provider''s own last-modified instant for the line (Sleeper `updated_at`, ms epoch); NULL when it sent none.';
COMMENT ON COLUMN public.player_stat_lines.first_seen_at IS
  'The poll instant this line was first kept (the writer''s injected clock).';
COMMENT ON COLUMN public.player_stat_lines.updated_at IS
  'The poll instant this line last changed (the writer''s injected clock).';

ALTER TABLE public.player_stat_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Stat lines are viewable by everyone"
  ON public.player_stat_lines FOR SELECT USING (true);

REVOKE TRUNCATE ON public.player_stat_lines FROM PUBLIC, anon, authenticated;
