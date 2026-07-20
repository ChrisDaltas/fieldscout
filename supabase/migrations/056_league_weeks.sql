-- ============================================================================
-- league_weeks — M1 task L.A1.5 (tasks-M1-league-foundation.md §6/§7:
-- migration 056, was 044 — renumbered same as every schema-lane task after
-- 054 took the batch-2 review-fix slot); spec-redraft-leagues.md §12.17
-- (per-league week state) + §23.4 (correction window / finalization).
--
-- 1. league_weeks per §12.17 verbatim: one row per (league, season, week),
--    tracking finalization state, median score (median_game), and waiver/
--    reopen bookkeeping. Populated by M4's schedule engine + the
--    `league-week-advance`/`finalize-matchups` cron jobs (§23.4) — nothing
--    in M1 writes this table.
--
-- 2. Two additive deviations from the spec's printed DDL, both cheap and
--    scoped to what's already true elsewhere in the schema (R43/D53-style
--    gap-fixes, not new product surface — recorded in PROGRESS D55):
--      a. `status` gets a CHECK enumerating the four values the column
--         comment already names. §12.17 prints the values only as a SQL
--         comment, which is not a constraint — R43 found exactly this
--         pattern on `teams.status`/`team_managers.role`/`end_reason`
--         (silently accepted 'banana') and fixed it there (054); the same
--         gap on a fresh table gets fixed at creation instead of waiting
--         for a review pass. Legal *transitions* (upcoming → live →
--         correction_window → final) are NOT enforced here: no writer of
--         any kind exists yet in M1 (RLS denies every client write below,
--         and no RPC in this task's scope ever calls one) — a transition
--         trigger would have no legitimate caller to validate against.
--         That belongs with whichever M4 job (`league-week-advance`,
--         §23.3) actually performs transitions, same scope-cut logic as
--         D42/D53.
--      b. `FOREIGN KEY (season, week) REFERENCES nfl_weeks(season, week)`.
--         §12.17 prints season/week as plain integers with no FK to the
--         `nfl_weeks` calendar (039/§12.20) they're conceptually drawn
--         from — every other week-scoped consumer in the spec keys off
--         `nfl_weeks` as the calendar backbone (§23.3: "no code ever infers
--         'current week' from wall-clock math"). Leaving season/week
--         unconstrained would let a league_weeks row name a week the NFL
--         calendar has no record of. The composite FK closes that gap for
--         free — `nfl_weeks(season, week)` is its PRIMARY KEY, so no new
--         index is needed on that side.
--
-- 3. RLS: ONE policy, "League weeks viewable by members" (SELECT). NO write
--    policy for any role, including the commissioner — same shape as
--    team_managers (053) and league_invites (055): the task text and
--    §12.17 name no legitimate client-write path (population is cron-only,
--    §23.4), so there's nothing to carve a write policy for.
--
-- Grants: none — 037 default-ACL model (D23); no new functions in this
-- migration, so the §4.1 REVOKE discipline has no target here. No realtime
-- triggers (D38 waiver: no live subscriber in the M1 UI slice — triggers
-- ship with M2's channel-auth work).
--
-- §8.1 staging-rehearsal waiver (R6 rule): no staging clone exists; the
-- fresh local `db reset` over 001–056 + the pgTAP suite is the rehearsal
-- evidence. Prod-safe: one new table, RLS enabled with its policy in the
-- same migration, no existing table altered.
-- ============================================================================

CREATE TABLE league_weeks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming', 'live', 'correction_window', 'final')),
  median_score NUMERIC(8,2),                 -- set at finalization when median_game is on
  waivers_processed_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  reopened_by_action_id UUID,                -- commissioner reopen (audited)
  UNIQUE(league_id, season, week),
  FOREIGN KEY (season, week) REFERENCES nfl_weeks(season, week)
);

CREATE INDEX idx_league_weeks_league ON league_weeks(league_id);

ALTER TABLE league_weeks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "League weeks viewable by members"
  ON league_weeks FOR SELECT USING (is_league_member(league_id));
-- No write policy for any role: populated by M4's schedule engine +
-- league-week-advance/finalize-matchups cron jobs (§23.4), not by any
-- client or RPC in M1's scope.
