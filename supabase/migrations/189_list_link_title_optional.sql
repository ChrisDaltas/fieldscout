-- ============================================================================
-- Migration 189: a video link's title is YouTube's real one, or nothing
--
-- Chris, 2026-10-15 (mobile gap list #11, correcting the first build):
--   "we need the actual YouTube titles or nothing. Having a bunch of videos
--   with the same title is useless."
--
-- The first build looked a phone-attached video's title up on YouTube (oEmbed)
-- and, when that failed, stored the placeholder 'YouTube video' — because 080
-- made `list_links.title` NOT NULL. So every failed lookup produced another
-- card with the same meaningless title. This migration lets the title be
-- absent instead:
--
--   1. `title` DROP NOT NULL. A video YouTube would not name is stored with
--      NULL, and every screen shows no title text for it.
--   2. 080's `list_links_title_check` — char_length(btrim(title)) BETWEEN 1
--      AND 200 — is KEPT, untouched. A CHECK passes on NULL, so it now reads
--      "a PRESENT title is 1–200 non-blank characters": blank is still not
--      "no title"; NULL is.
--   3. NEW `list_links_title_null_video_only_check`: only a VIDEO may go
--      untitled. The relaxation is exactly as wide as the ruling — an article
--      still needs its title on every write path (the API already requires
--      one; this holds it for seeds and future routes too, the reason 080
--      keeps its checks in the database).
--   4. The stored placeholder is cleared: every video whose title is exactly
--      'YouTube video' becomes NULL. The phone build that wrote it never
--      shipped to production, so this mainly cleans dev/test data; a person
--      typing exactly that title by hand on desktop is very unlikely, and if
--      one did, it said nothing about the video anyway.
--      The UPDATE picks its rows through `list_link_title_is_placeholder_
--      internal` (PLAIN, IMMUTABLE, search_path '', REVOKEd from every
--      client) so the match is PROVABLE: pgTAP 137 pins it on a placeholder
--      video against the near misses it must leave alone ('YouTube videos
--      and more', another casing, an article titled exactly that, an
--      untitled video) and runs it over seeded rows. A freshly reset
--      database has no placeholder rows, so "none left afterwards" proves
--      nothing on its own. The count cleared is RAISEd as a NOTICE at push
--      (measured 0 local at authoring; hosted not measured — the placeholder
--      never reached main, so expected 0 unless someone typed it).
--
-- Authored against the HEAD of the chain: 080 is the only migration that
-- defines or alters `list_links` (checked 001–188). No SQL function or view
-- reads the table — `duplicate_list` (017, redefined by 188) copies players
-- and tags only, never links — so nothing downstream assumes a non-NULL
-- title. RLS is unchanged: the policies (080) are row-level and never look
-- at `title`.
--
-- Deploy order (main reaches production before this is pushed): until 189
-- is applied, the API refuses a phone attach whose title lookup failed with
-- a retryable 503 ("Couldn't get this video's title from YouTube. Try again
-- in a moment.") on the old schema's not-null violation (23502) — it never
-- falls back to a placeholder. After the push the same attach stores NULL.
--
-- Re-runnable: DROP NOT NULL is idempotent, the predicate is CREATE OR
-- REPLACE with its REVOKE restated, the CHECK is dropped-if-exists then
-- added, and the UPDATE matches nothing the second time.
--
-- Reaches production via `npx supabase db push` — never by hand.
-- ============================================================================

ALTER TABLE list_links
  ALTER COLUMN title DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- The placeholder cleanup — its match is a named, tested predicate
-- ---------------------------------------------------------------------------
-- Exactly the string the first phone build stored, on a video only. Never
-- NULL (an untitled video is a plain false), so pgTAP can pin it as a
-- boolean. Internal: nothing in the app calls it.
CREATE OR REPLACE FUNCTION list_link_title_is_placeholder_internal(p_kind TEXT, p_title TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(p_kind = 'video' AND p_title = 'YouTube video', false)
$$;

REVOKE ALL ON FUNCTION list_link_title_is_placeholder_internal(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE list_links
     SET title = NULL
   WHERE list_link_title_is_placeholder_internal(kind, title);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '189: % video link(s) stored under the placeholder title are now untitled (measured 0 local at authoring; hosted not measured — the placeholder never reached main)', v_n;
END $$;

ALTER TABLE list_links
  DROP CONSTRAINT IF EXISTS list_links_title_null_video_only_check;
ALTER TABLE list_links
  ADD CONSTRAINT list_links_title_null_video_only_check
  CHECK (title IS NOT NULL OR kind = 'video');

COMMENT ON COLUMN list_links.title IS
  'The card''s title. For a video attached without one: YouTube''s real title (oEmbed), or NULL when YouTube would not give it — never a placeholder (Chris, 2026-10-15). Only a video may be NULL; a present title is 1–200 non-blank characters.';
