-- ============================================================================
-- 198 — PLAYER NEWS (F575 / F641; Chris's rulings 2026-10-18; PROGRESS D550).
--
-- Two NEW tables + one pg_cron row. Nothing existing is altered or replaced
-- (zero CREATE OR REPLACE hunks, D137).
--
--   player_news          one story (headline, source label, link out, time).
--                        Plain-text headline only; no article body is stored.
--                        UNIQUE (source_key, external_id) = the dedupe key —
--                        a re-ingest upserts the same row.
--   player_news_players  story ↔ player link, PK (news_id, player_id), with
--                        the rule that matched ('name_team' | 'unique_name').
--
-- RLS (tasks-M* §4.2 pattern): SELECT for `authenticated` only; NO write
-- policy for any role, and INSERT/UPDATE/DELETE privileges REVOKEd from anon
-- and authenticated. The only writer is the ingest route as service_role.
--
-- Scheduling: pg_cron `ingest-player-news-ping` every 30 minutes →
-- `public.cron_ping_route('/api/cron/ingest-player-news')` (124's vehicle,
-- unschedule-first like 136). No vercel.json entry (Hobby = daily only).
--
-- Checklist (§4.4): no SECURITY DEFINER function added; no stat namespace
-- touched (D33 n/a); no clock read in SQL defaults beyond fetched_at's
-- now() as a storage default (the ingest always passes the TimeProvider's
-- instant). R6/D38 waivers: none needed.
-- ============================================================================

CREATE TABLE public.player_news (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key    TEXT NOT NULL CHECK (char_length(source_key) BETWEEN 1 AND 100),
  source_label  TEXT NOT NULL CHECK (char_length(source_label) BETWEEN 1 AND 100),
  external_id   TEXT NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 500),
  url           TEXT NOT NULL CHECK (url ~ '^https?://' AND char_length(url) <= 2000),
  headline      TEXT NOT NULL CHECK (char_length(headline) BETWEEN 1 AND 300),
  published_at  TIMESTAMPTZ NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT player_news_source_item_key UNIQUE (source_key, external_id)
);

CREATE TABLE public.player_news_players (
  news_id    UUID NOT NULL REFERENCES public.player_news(id) ON DELETE CASCADE,
  player_id  TEXT NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  rule       TEXT NOT NULL CHECK (rule IN ('name_team', 'unique_name')),
  PRIMARY KEY (news_id, player_id)
);

CREATE INDEX player_news_players_player_idx ON public.player_news_players (player_id);
CREATE INDEX player_news_published_idx ON public.player_news (published_at DESC, id DESC);

ALTER TABLE public.player_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_news_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY player_news_read ON public.player_news
  FOR SELECT TO authenticated USING (true);
CREATE POLICY player_news_players_read ON public.player_news_players
  FOR SELECT TO authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.player_news, public.player_news_players FROM anon, authenticated;
REVOKE ALL ON public.player_news, public.player_news_players FROM anon;

COMMENT ON TABLE public.player_news IS
  'Player news stories (198, F575/D550): headline (plain text), source label, link out, published time — from free public RSS feeds and Bluesky reporters (src/lib/news/sources.ts). UNIQUE (source_key, external_id) is the dedupe key. SELECT for authenticated; written ONLY by /api/cron/ingest-player-news as service_role (pg_cron ingest-player-news-ping, every 30 min); no write policy for any role.';
COMMENT ON TABLE public.player_news_players IS
  'Story ↔ player link (198, F575/D550). rule = how the free name matcher tied them (name_team: full name + his team named; unique_name: full name unique among rostered players). SELECT for authenticated; service_role writes only.';

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ingest-player-news-ping') THEN
    PERFORM cron.unschedule('ingest-player-news-ping');
  END IF;
  PERFORM cron.schedule('ingest-player-news-ping', '*/30 * * * *',
    'SELECT public.cron_ping_route(''/api/cron/ingest-player-news'')');
END;
$do$;
