-- Full projected stat line from Sleeper (sync-projections.ts), stored in the
-- app's StatRow convention (pass_yards, receiving_tds, …) so
-- calculateFantasyPoints() can score it under any scoring system — this is
-- what lets custom (Pro) scoring apply to projections, not just the three
-- preset totals.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS projected_stats JSONB;
