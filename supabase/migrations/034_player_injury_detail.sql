-- Injury detail from Sleeper's roster feed (sync-players.ts). The status
-- column already carries the headline (Questionable/IR/...); these add the
-- context: what's hurt, latest note, when it started, practice level.
-- Also espn_id: the cross-provider key the auction-value sync joins on.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS injury_body_part TEXT,
  ADD COLUMN IF NOT EXISTS injury_notes TEXT,
  ADD COLUMN IF NOT EXISTS injury_start_date DATE,
  ADD COLUMN IF NOT EXISTS practice_participation TEXT,
  ADD COLUMN IF NOT EXISTS espn_id TEXT;
