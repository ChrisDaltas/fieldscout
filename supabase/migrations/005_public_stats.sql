-- ============================================================================
-- Allow anonymous reads on player_stats and nfl_games.
--
-- F0 (guest experience) requires public-facing pages — consensus rankings,
-- player profiles, and the guest Big Board's player modal — to read stats
-- without an account. The original 001 policies restricted these to
-- authenticated users; relaxing them matches the documented product behavior.
-- Stats and games are public NFL data, not user-owned records.
-- ============================================================================

DROP POLICY IF EXISTS "Stats are viewable by authenticated users" ON player_stats;
CREATE POLICY "Stats are viewable by everyone"
  ON player_stats FOR SELECT USING (true);

DROP POLICY IF EXISTS "Games are viewable by authenticated users" ON nfl_games;
CREATE POLICY "Games are viewable by everyone"
  ON nfl_games FOR SELECT USING (true);
