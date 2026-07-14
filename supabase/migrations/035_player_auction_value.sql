-- Average auction value in dollars from ESPN live draft data
-- (sync-auction.ts): ownership.auctionValueAverage across real ESPN
-- auction drafts, refreshed with the weekly pipeline.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS auction_value NUMERIC,
  ADD COLUMN IF NOT EXISTS auction_updated_at TIMESTAMPTZ;
