-- ============================================================================
-- 137_league_player_values.sql — league-scored player values for autopilot
-- (M6A task L.E1.20, added by ruling 2026-09-27; PROGRESS Q62 (RULED), F379
-- second third, D374; discharges F385 / F386(b) / F387's compute half; spec
-- v2.16.45 §12.28 + §14's `league-player-values` row; tasks-M6A §6's
-- 2026-09-27 amendment).
--
-- Numbering (D161 — measured at task time, not trusted from any plan):
-- `ls supabase/migrations | tail -1` → 136_player_weekly_projections.sql ⇒
-- 137; `ls supabase/tests | tail -1` → 084_player_weekly_projections.sql ⇒
-- pgTAP 085. NOT held: reaches production by `npx supabase db push` like
-- any other migration. Production is at 134 — push debt becomes 135–137.
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
-- Chris ruled Q62 on 2026-09-27: autopilot starts the eligible player with
-- the highest projected points — this week's projection, else season-to-date
-- points, else the preseason projection — each "scored through the league's
-- own scoring settings", compared across positions as "total scored points".
-- Scoring exists ONLY in TypeScript (`src/lib/leagues/scoring/calculator.ts`,
-- the worker's engine); autopilot runs in SQL inside `lineup_lock_tick`. A
-- SQL re-implementation of the scorer is forbidden (D33 — one engine, one
-- namespace; D371(3)). So the TS job (`player-values-job.ts`) scores through
-- the canonical scorer under each league's FROZEN snapshot and PERSISTS the
-- points here; L.E1.21's one ORDER BY reads them.
--
-- ---------------------------------------------------------------------------
-- WHAT
-- ---------------------------------------------------------------------------
-- `league_player_values` — one row per (league, season, week, player) for
-- every player ROSTERED in an `in_season` / `playoffs` league, for the
-- current and next calendar week (the population autopilot can choose from;
-- because the sort keys are a player's OWN points, not a rank among others,
-- the population does not change any comparison — task text item (3)).
--   * projected_points  — THIS week's `player_weekly_projections` line
--                         through the league's scoring. NULL ⇔
--                         `projected_missing` names why: 'no_line' (the
--                         source did not project him) or 'stale_line' (the
--                         line's `fetched_at` was older than the freshness
--                         bound when computed — F387).
--   * projected_unscored — the applicable, non-zero rules keys the SOURCE
--                         cannot supply (F386(a): `fg_0_39`, `fg_missed`,
--                         `def_block`, `def_return_td`, the `def_ya_*`
--                         family, …) — a known under-count, NAMED on every
--                         value. NULL ⇔ no value.
--   * projection_fetched_at — the scored line's `fetched_at`, kept so the
--                         READ at lock (L.E1.21) can bound its age again.
--   * season_points / season_games — the player's `player_stats` rows for the
--                         season's weeks BEFORE `week`, each through the
--                         worker's own `scoreStarter`, summed. NULL ⇔ ZERO
--                         games (no stat line yet this season); a real 0.00
--                         has season_games ≥ 1. The two are different facts
--                         and a CHECK keeps them apart.
--   * preseason_points / preseason_missing / preseason_unscored — the season
--                         line `players.projected_stats` (the LEGACY
--                         namespace, translated through the STAT_KEYS column
--                         map — F385) through the league's scoring; NULL ⇔
--                         'no_line' or 'other_season' (a line from another
--                         season is not this season's preseason).
--   * computed_at        — the job's TimeProvider instant (no DEFAULT — a
--                         writer that forgets it fails rather than stamping
--                         the database's clock).
-- These are POINTS, never ranks (Chris 2026-09-27); `NUMERIC(8,2)` is
-- §7.3.3's stored precision. Nothing here is read by any scoring path — the
-- table is autopilot's input only.
--
-- RLS (task text item (1)): member-readable (`is_league_member`, 052 — the
-- in-season tables' own policy, 109); NO write policy for any role — written
-- ONLY by the job's service-role client. TRUNCATE: born without the grant for
-- anon/authenticated since 133 (pgTAP 081 §A enforces it schema-wide); the
-- explicit REVOKE below is the D350 house form, kept.
--
-- SCHEDULING — pg_cron + pg_net, 124's vehicle (as 136):
-- `league-player-values-ping`, HOURLY at :50, calls
-- `cron_ping_route('/api/cron/league-player-values')`. Why hourly at :50:
-- ten minutes after 136's projections sync (:40) lands the lines, clear of
-- :00 (league-week-advance, the sync-live sweep) and :05 (finalize); the
-- job values the current AND next calendar week, so the coming week's
-- values exist from the moment its projections do — days before Thursday's
-- first lock — and are refreshed hourly with injury news and rosters. NO
-- `vercel.json` entry (Hobby is daily-only, and this table ships with the
-- job — no window a daily stopgap would cover; 136's reasoning).
--
-- MIGRATION CHECKLIST (tasks-M* §4.4): one NEW table + its RLS/policy + one
-- pg_cron row; NOTHING existing is altered or replaced — ZERO D137 hunks (no
-- function is created or redefined). `leagues`, `players` and `nfl_weeks` are
-- only REFERENCED (FK), never altered.
-- WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
-- `db reset` 001–137 + pgTAP 085 + the stack suite in the same PR. D38-style
-- realtime waiver — no broadcast trigger: no client subscribes to this table
-- (autopilot reads it server-side, L.E1.21). No backfill (a new, empty table;
-- the first hourly run fills it).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
CREATE TABLE public.league_player_values (
  league_id             UUID          NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  season                INTEGER       NOT NULL,
  week                  INTEGER       NOT NULL,
  player_id             TEXT          NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  projected_points      NUMERIC(8,2),
  projected_missing     TEXT,
  projected_unscored    TEXT[],
  projection_fetched_at TIMESTAMPTZ,
  season_points         NUMERIC(8,2),
  season_games          INTEGER       NOT NULL,
  preseason_points      NUMERIC(8,2),
  preseason_missing     TEXT,
  preseason_unscored    TEXT[],
  computed_at           TIMESTAMPTZ   NOT NULL,
  PRIMARY KEY (league_id, season, week, player_id),
  CONSTRAINT league_player_values_week_fk
    FOREIGN KEY (season, week) REFERENCES public.nfl_weeks(season, week),
  -- A missing value always says why; a value never carries a reason.
  CONSTRAINT league_player_values_projected_named
    CHECK ((projected_points IS NULL) = (projected_missing IS NOT NULL)),
  CONSTRAINT league_player_values_projected_missing_vocab
    CHECK (projected_missing IS NULL OR projected_missing IN ('no_line', 'stale_line')),
  CONSTRAINT league_player_values_projected_unscored_iff_value
    CHECK ((projected_points IS NULL) = (projected_unscored IS NULL)),
  -- A scored or stale line carries its fetch instant; 'no_line' has none.
  CONSTRAINT league_player_values_fetched_iff_line
    CHECK ((projection_fetched_at IS NULL) = (projected_missing IS NOT DISTINCT FROM 'no_line')),
  -- NULL is not zero: no games ⇔ NULL; a real 0.00 has at least one game.
  CONSTRAINT league_player_values_season_games_nonneg
    CHECK (season_games >= 0),
  CONSTRAINT league_player_values_season_null_iff_no_games
    CHECK ((season_points IS NULL) = (season_games = 0)),
  CONSTRAINT league_player_values_preseason_named
    CHECK ((preseason_points IS NULL) = (preseason_missing IS NOT NULL)),
  CONSTRAINT league_player_values_preseason_missing_vocab
    CHECK (preseason_missing IS NULL OR preseason_missing IN ('no_line', 'other_season')),
  CONSTRAINT league_player_values_preseason_unscored_iff_value
    CHECK ((preseason_points IS NULL) = (preseason_unscored IS NULL))
);

COMMENT ON TABLE public.league_player_values IS
  'League-scored player values for autopilot — 137, M6A L.E1.20 (Q62 RULED; PROGRESS F379 / D374; spec §12.28). Per (league, season, week, rostered player): THIS week''s projected points, season-to-date points (weeks before `week`) and preseason projected points, each through the canonical TS scorer (calculator.ts) under the league''s FROZEN scoring_rules_snapshot — POINTS, never ranks. NULL is never zero: a missing projection/preseason value names why; season_points is NULL iff season_games = 0. Written ONLY by the league-player-values job as service_role (hourly, pg_cron `league-player-values-ping`); member-readable; no write policy for any role. Read by autopilot''s sort (L.E1.21), never by scoring.';
COMMENT ON COLUMN public.league_player_values.projected_unscored IS
  'Applicable, non-zero rules keys the projection SOURCE cannot supply (PROGRESS F386(a)) — each a known under-count, named. NULL iff projected_points is NULL.';
COMMENT ON COLUMN public.league_player_values.projection_fetched_at IS
  'The scored (or stale) weekly line''s fetched_at — kept so the read at lock can bound its age again (F387). NULL iff projected_missing = ''no_line''.';
COMMENT ON COLUMN public.league_player_values.season_games IS
  'Weeks before `week` with a player_stats line this season. 0 ⇔ season_points IS NULL (no games yet — never a 0.00).';
COMMENT ON COLUMN public.league_player_values.computed_at IS
  'The job''s TimeProvider instant (no column default by design).';

-- ---------------------------------------------------------------------------
-- 2. RLS — league members read; no write policy for any role
-- ---------------------------------------------------------------------------
ALTER TABLE public.league_player_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "League player values viewable by league members"
  ON public.league_player_values FOR SELECT TO authenticated
  USING (public.is_league_member(league_id));
-- No INSERT / UPDATE / DELETE policy for any role: the service-role job is
-- the only writer (it bypasses RLS). pgTAP 085 §C walks every role with
-- RETURNING counts.

REVOKE TRUNCATE ON public.league_player_values FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. pg_cron — one entry, unschedule-first (068:1263 / 124 / 136's form)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'league-player-values-ping') THEN
    PERFORM cron.unschedule('league-player-values-ping');
  END IF;
  PERFORM cron.schedule('league-player-values-ping', '50 * * * *',
    'SELECT public.cron_ping_route(''/api/cron/league-player-values'')');
END;
$do$;
