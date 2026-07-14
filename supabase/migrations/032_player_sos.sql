-- Strength of schedule (sync-sos.ts): team-level rank 1-32 stamped on every
-- rostered player. 1 = easiest schedule, 32 = hardest. Computed as the
-- average opponent strength across the team's scheduled games, where a
-- team's strength is the sum of its top projected players.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS sos INTEGER;
