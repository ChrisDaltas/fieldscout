-- ============================================================================
-- 136_player_weekly_projections.sql — THIS WEEK'S projected stat lines
-- (M6A task L.E1.19, added by ruling 2026-09-27; PROGRESS Q62 (RULED), F379
-- first third, D373; spec v2.16.44 §12.27 + §14's `sync-weekly-projections`
-- row; tasks-M6A §6's 2026-09-27 amendment).
--
-- Numbering (D161 — measured at task time, not trusted from any plan):
-- `ls supabase/migrations | tail -1` → 135_no_live_score_edits.sql ⇒ 136;
-- `ls supabase/tests | tail -1` → 083_no_live_score_edits.sql ⇒ pgTAP 084.
-- NOT held: the production hold is OVER (PR #282) — this reaches production
-- by `npx supabase db push` like any other migration (push debt 135–136).
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
-- Chris ruled Q62 on 2026-09-27: autopilot starts the eligible player with
-- the highest projected points — THIS WEEK's projection, scored through the
-- league's own scoring. The schema carries only the SEASON line
-- (`players.projected_stats` / `projected_pts_*`, the preseason sync). This
-- table is the weekly counterpart. It stores STAT LINES, never points:
-- L.E1.20 scores them through the canonical scorer (`calculator.ts`) under
-- each league's snapshot and persists the values L.E1.21's sort reads.
--
-- ---------------------------------------------------------------------------
-- WHAT
-- ---------------------------------------------------------------------------
-- `player_weekly_projections` — one row per (season, week, player) that the
-- source actually projected for that week:
--   * `stats`      — the line in the ONE canonical stat namespace (D33;
--                    spec §7.3.3 "rules keys ≡ stat keys, no translation"):
--                    Sleeper's fields through `SLEEPER_STAT_KEY_MAP`, the
--                    SAME map the actuals take on their way to
--                    `player_stats` (sleeper-stats-provider.ts), so a
--                    projected line and an actual line are commensurable
--                    key for key. Every value a JSON number (CHECK below).
--                    NOT `sleeperProjectionToStatRow` — the task text names
--                    it, but that helper emits the LEGACY research namespace
--                    (`xp_made`, `two_point_conversions`, `def_sacks`, …;
--                    calculator.test.ts pins those as legacy-only keys), so
--                    D33 and the helper cannot both be honoured; the spec
--                    wins — D373(2), flagged for the reviewer.
--   * `raw_stats`  — Sleeper's `stats` object VERBATIM (provenance, and the
--                    fields the canonical map does not carry — F386). It
--                    includes Sleeper's own preset totals (`pts_ppr` …):
--                    those are NOT a league value and nothing may read them
--                    as one (the league's scoring is L.E1.20's, D33).
--   * `source` / `source_updated_at` / `fetched_at` — who, Sleeper's own
--                    per-row modification instant, and the instant OUR fetch
--                    ran (from the TimeProvider; no column DEFAULT, so a
--                    writer that forgets it fails rather than stamping the
--                    database's clock).
-- A player the source did not project (a bye, a filler row, a player
-- ruled out) has NO row — absence is the fact, never a zero. A real
-- projected 0.00 is a row (the sync stores it).
-- The (season, week) FK to `nfl_weeks` makes a week the calendar does not
-- know unstorable (§23.3: week-scoped jobs key off `nfl_weeks`).
--
-- RLS (task text item (1)): SELECT for `authenticated`; NO write policy for
-- any role — written ONLY by the sync's service-role client (CLAUDE.md:
-- player data is read-only from the app). `anon` holds the table's default
-- SELECT grant (037's model — D23: RLS is the gate) and reads ZERO rows.
-- TRUNCATE: born without the grant for anon/authenticated since 133 (pgTAP
-- 081 §A enforces it schema-wide); the explicit REVOKE below is the D350
-- house form, kept — harmless, and it states the intent where the table is.
--
-- SCHEDULING — pg_cron + pg_net, the vehicle 124 built (Q43 option (c)):
-- `sync-weekly-projections-ping`, HOURLY at :40, calls
-- `cron_ping_route('/api/cron/sync-weekly-projections')` (124's INVOKER
-- helper — the secret read from Vault at call time; an absent secret RAISES
-- inside the job, never a silent 401). Why hourly: projections must exist
-- before Thursday's first lock and track injury news through Sunday's
-- inactives (~90 min before kickoff); Sleeper's CDN caches this endpoint for
-- 600 s (`s-maxage=600`, measured), so nothing finer than ~10 min could see
-- fresher data; an hour bounds staleness at one hour for ~12 small reads
-- (6 positions × the current and next calendar week). Why :40: clear of
-- :00 (the sync-live sweep, league-week-advance) and :05
-- (finalize-matchups). NO `vercel.json` entry: Hobby allows only daily
-- crons, and the table this route writes arrives with the same `db push`
-- that creates the job — there is no window a daily stopgap would cover
-- (unlike 124's F331 case, whose routes pre-existed).
--
-- MIGRATION CHECKLIST (tasks-M* §4.4): one NEW table + its RLS/policy + one
-- pg_cron row; NOTHING existing is altered or replaced (zero D137 hunks — no
-- function is redefined). No launch-surface table is touched: `players` and
-- `nfl_weeks` are only REFERENCED (FK), never altered.
-- WAIVERS: R6 — no staging clone; rehearsal evidence = the fresh local
-- `db reset` 001–136 + pgTAP 084 + the stack cell in the same PR. D38-style
-- realtime waiver — no broadcast trigger: no client subscribes to this table
-- (L.E1.20's job reads it server-side). No backfill (a new, empty table).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
CREATE TABLE public.player_weekly_projections (
  season            INTEGER     NOT NULL,
  week              INTEGER     NOT NULL,
  player_id         TEXT        NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  stats             JSONB       NOT NULL,
  raw_stats         JSONB       NOT NULL,
  source            TEXT        NOT NULL,
  source_updated_at TIMESTAMPTZ,
  fetched_at        TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (season, week, player_id),
  CONSTRAINT player_weekly_projections_week_fk
    FOREIGN KEY (season, week) REFERENCES public.nfl_weeks(season, week),
  CONSTRAINT player_weekly_projections_stats_object
    CHECK (jsonb_typeof(stats) = 'object'),
  CONSTRAINT player_weekly_projections_stats_numeric
    CHECK (NOT jsonb_path_exists(stats, '$.* ? (@.type() != "number")')),
  CONSTRAINT player_weekly_projections_raw_object
    CHECK (jsonb_typeof(raw_stats) = 'object'),
  CONSTRAINT player_weekly_projections_source_nonblank
    CHECK (btrim(source) <> '')
);

COMMENT ON TABLE public.player_weekly_projections IS
  'THIS WEEK''s projected stat line per (season, week, player) — 136, M6A L.E1.19 (Q62 RULED; PROGRESS F379 / D373; spec §12.27). `stats` = the canonical STAT_KEYS namespace (D33 — the Sleeper→canonical map the actuals use; every value a number); `raw_stats` = the source''s stats object verbatim (its pts_* are the SOURCE''s preset totals, never a league value — league points are L.E1.20''s, through calculator.ts). No row = not projected (bye / filler / ruled out), never zero. Written ONLY by the weekly projections sync as service_role (hourly, pg_cron `sync-weekly-projections-ping`); SELECT for authenticated; no write policy for any role.';
COMMENT ON COLUMN public.player_weekly_projections.stats IS
  'Canonical stat keys (src/lib/leagues/stats/stat-keys.ts) → projected value, via SLEEPER_STAT_KEY_MAP — the same map as the actuals. Numbers only (CHECK).';
COMMENT ON COLUMN public.player_weekly_projections.raw_stats IS
  'The source''s stats object verbatim. Carries fields the canonical map does not (PROGRESS F386) and the source''s own pts_* totals, which are NOT a league value.';
COMMENT ON COLUMN public.player_weekly_projections.fetched_at IS
  'The instant our sync fetched this line (TimeProvider — no column default by design).';
COMMENT ON COLUMN public.player_weekly_projections.source_updated_at IS
  'The source''s own last-modified instant for the row (Sleeper `updated_at`, ms epoch → timestamptz); NULL when the source sent none.';

-- ---------------------------------------------------------------------------
-- 2. RLS — SELECT for authenticated; no write policy for any role
-- ---------------------------------------------------------------------------
ALTER TABLE public.player_weekly_projections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "player_weekly_projections readable by signed-in users"
  ON public.player_weekly_projections FOR SELECT TO authenticated USING (true);
-- No INSERT / UPDATE / DELETE policy for any role: the service-role sync is
-- the only writer (it bypasses RLS). pgTAP 084 §B walks every role with
-- RETURNING counts.

REVOKE TRUNCATE ON public.player_weekly_projections FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. pg_cron — one entry, unschedule-first (068:1263 / 124's idempotent form)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-weekly-projections-ping') THEN
    PERFORM cron.unschedule('sync-weekly-projections-ping');
  END IF;
  PERFORM cron.schedule('sync-weekly-projections-ping', '40 * * * *',
    'SELECT public.cron_ping_route(''/api/cron/sync-weekly-projections'')');
END;
$do$;
