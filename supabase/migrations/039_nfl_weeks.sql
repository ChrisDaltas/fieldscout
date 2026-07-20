-- ============================================================================
-- nfl_weeks — global NFL calendar (spec-redraft-leagues.md §12.20; plan M0,
-- task L.A0.5b in docs/specs/tasks-M0-foundations.md §5/§6).
--
-- Week boundaries stop being implicit: all week-scoped jobs key off this
-- table; no code ever infers "current week" from wall-clock math (§23.3).
-- DDL is §12.20 column-for-column — no additions, no omissions.
--
-- World-readable reference data (§12.20): RLS enabled, one SELECT-for-all
-- policy, NO write policies — rows are managed by the service role only
-- (M0 seed below; first_kickoff_at / last_game_ends_at back-filled from
-- nfl_games by a later milestone, PROGRESS Q1/D16).
--
-- No realtime broadcast trigger: D10 waiver (PROGRESS §4) — no client
-- subscribes to nfl_weeks yet and the only write is this seed; the trigger
-- ships with the milestone that live-updates first_kickoff_at /
-- last_game_ends_at.
--
-- No per-object GRANTs: the 037 default-ACL model auto-exposes new tables
-- exactly as in prod; RLS is the effective gate (D23).
--
-- Staging-clone rehearsal (plan §8.1): WAIVED per the D23 go-forward rule —
-- no staging clone exists (environments are local + prod only); the fresh
-- local `supabase db reset` replay of 001–039 recorded in the L.A0.5b
-- session log serves as the rehearsal evidence.
--
-- 2026 seed derivation (task L.A0.5b item 2): Sleeper regular-season
-- schedule (day granularity — boundaries are day math), Week 1 verified
-- against the published 2026 opener (WEDNESDAY 2026-09-09, NE @ SEA Kickoff
-- Game — Super Bowl rematch; the Thursday SF @ LAR game is in Australia;
-- nfl.com 2026 schedule release, checked 2026-07-19). Timestamps are
-- explicit America/New_York-derived literals with per-date UTC offsets:
-- -04 (EDT) through the Nov 1, 2026 fall-back, -05 (EST) after.
--   starts_at                 = Wednesday 00:00 ET preceding the week's
--                               first game (same-day 00:00 for the two
--                               Wednesday slates, weeks 1 and 12) (§12.20)
--   correction_window_ends_at = following Thursday 06:00 ET (§23.4 default)
--   first_kickoff_at / last_game_ends_at = NULL until nfl_games is written
-- Full derivation table in the PR description.
-- ============================================================================

CREATE TABLE IF NOT EXISTS nfl_weeks (
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,                      -- 1..18
  starts_at TIMESTAMPTZ NOT NULL,             -- typically Wed 00:00 ET
  first_kickoff_at TIMESTAMPTZ,               -- updated from nfl_games (TNF)
  last_game_ends_at TIMESTAMPTZ,              -- updated as games finish (MNF)
  correction_window_ends_at TIMESTAMPTZ,      -- default: Thu 06:00 ET after the week (see §23.4)
  PRIMARY KEY (season, week)
);

ALTER TABLE nfl_weeks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nfl_weeks readable by everyone" ON nfl_weeks;
CREATE POLICY "nfl_weeks readable by everyone"
  ON nfl_weeks FOR SELECT USING (true);
-- No insert/update/delete policies: managed by service role only (seed below;
-- later milestones update first_kickoff_at / last_game_ends_at from nfl_games).

-- PK suffices for indexing; no FKs used in policies (plan §8.1 satisfied vacuously).

-- 2026 season seed (weeks 1–18; derivation in the banner above).
INSERT INTO nfl_weeks (season, week, starts_at, first_kickoff_at, last_game_ends_at, correction_window_ends_at)
VALUES
  (2026, 1, '2026-09-09 00:00:00-04', NULL, NULL, '2026-09-17 06:00:00-04'),
  (2026, 2, '2026-09-16 00:00:00-04', NULL, NULL, '2026-09-24 06:00:00-04'),
  (2026, 3, '2026-09-23 00:00:00-04', NULL, NULL, '2026-10-01 06:00:00-04'),
  (2026, 4, '2026-09-30 00:00:00-04', NULL, NULL, '2026-10-08 06:00:00-04'),
  (2026, 5, '2026-10-07 00:00:00-04', NULL, NULL, '2026-10-15 06:00:00-04'),
  (2026, 6, '2026-10-14 00:00:00-04', NULL, NULL, '2026-10-22 06:00:00-04'),
  (2026, 7, '2026-10-21 00:00:00-04', NULL, NULL, '2026-10-29 06:00:00-04'),
  (2026, 8, '2026-10-28 00:00:00-04', NULL, NULL, '2026-11-05 06:00:00-05'),
  (2026, 9, '2026-11-04 00:00:00-05', NULL, NULL, '2026-11-12 06:00:00-05'),
  (2026, 10, '2026-11-11 00:00:00-05', NULL, NULL, '2026-11-19 06:00:00-05'),
  (2026, 11, '2026-11-18 00:00:00-05', NULL, NULL, '2026-11-26 06:00:00-05'),
  (2026, 12, '2026-11-25 00:00:00-05', NULL, NULL, '2026-12-03 06:00:00-05'),
  (2026, 13, '2026-12-02 00:00:00-05', NULL, NULL, '2026-12-10 06:00:00-05'),
  (2026, 14, '2026-12-09 00:00:00-05', NULL, NULL, '2026-12-17 06:00:00-05'),
  (2026, 15, '2026-12-16 00:00:00-05', NULL, NULL, '2026-12-24 06:00:00-05'),
  (2026, 16, '2026-12-23 00:00:00-05', NULL, NULL, '2026-12-31 06:00:00-05'),
  (2026, 17, '2026-12-30 00:00:00-05', NULL, NULL, '2027-01-07 06:00:00-05'),
  (2026, 18, '2027-01-06 00:00:00-05', NULL, NULL, '2027-01-14 06:00:00-05')
ON CONFLICT (season, week) DO NOTHING;
