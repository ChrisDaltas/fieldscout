-- Depth chart position from Sleeper's roster feed (sync-players.ts).
-- depth_chart_order: 1 = starter at the position; NULL = not on a depth chart.
-- depth_chart_position: the slot the order applies to (e.g. RB, WR, SWR).
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS depth_chart_order INTEGER,
  ADD COLUMN IF NOT EXISTS depth_chart_position TEXT;
