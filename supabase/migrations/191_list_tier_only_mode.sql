-- ============================================================================
-- Migration 191: tiers without numbers
--
-- Chris, 2026-10-15: "allow tiers without numbers". A list's Ranked and Tiers
-- switches become independent, so a list can be grouped under Tier 1,
-- Tier 2… headings with no 1-2-3 numbers. `lists.ranking_mode` gains a fourth
-- value for it, 'tier_only'.
--
-- Migration 012 collapsed the legacy boolean pair (hide_order, tiers_enabled)
-- into ranking_mode because only three of its four combinations meant
-- anything. The fourth — no numbers, with tiers — is this mode, so the four
-- values are now exactly the four combinations, and the pair stays derived
-- from the mode on every path that writes it:
--
--   ranking_mode    hide_order  tiers_enabled   Ranked  Tiers
--   unranked        true        false           off     off
--   ranked          false       false           on      off
--   rank_and_tier   false       true            on      on
--   tier_only       true        true            off     on     (new)
--
-- hide_order = true is also what keeps a tier-only list out of
-- `consensus_rankings` (001: `WHERE l.hide_order = FALSE`): the order inside
-- a tier is not a ranking, so it must not count as one.
--
-- The CHECK keeps its name, `lists_ranking_mode_check`. Main deploys before
-- this migration is pushed, and the API recognises the older database by a
-- 23514 naming that constraint on a tier-only write — answering a clear 409
-- ("coming in the next update") rather than a 500.
--
-- No trigger derives the pair (the app writes it with the mode, via
-- `rankingModeToLegacyFlags`); `duplicate_list` is the one SQL path that
-- does, so it is redefined here. Authored against the HEAD body — 188, which
-- redefined 017 — with one change: the two derived flags treat 'tier_only'
-- as hide_order = true, tiers_enabled = true. Kept verbatim: the signature,
-- SECURITY INVOKER (RLS still applies to the caller), the search_path pin,
-- the error codes the route maps (28000, P0002), the cover colour copy (188)
-- and the grant. No other function, view or policy reads ranking_mode.
--
-- Existing rows are brought into line with that table (step 3). 012's
-- backfill let hide_order win ("an unranked list with tiers … hide_order as
-- the dominant signal"), so a legacy row stored (hide_order true,
-- tiers_enabled true) is `unranked` — and under this table that pair now
-- reads `tier_only`. The mode is the truth (every screen reads it), so the
-- pair is re-derived from it, never the other way round: such a row comes out
-- (unranked, true, false) and keeps looking exactly as it does today. Only
-- rows whose pair disagrees with their mode are touched.
--
-- That UPDATE fires the two lists row triggers. `guard_lists_ai_persona`
-- acts only for authenticated/anon callers and only on ai_persona_id, so it
-- is inert here. `enforce_free_list_caps` re-checks a non-Pro owner's team
-- (and, while a cap is on, private-list) count, and could refuse a row an old
-- Pro downgrade left over the cap — so each row is fixed on its own, a
-- refusal skips that row with a WARNING naming it, and the migration says how
-- many it fixed and skipped rather than failing the push over a legacy flag
-- nothing reads. No updated_at trigger exists, so no list jumps in "recent".
--
-- RLS: nothing to add — the lists policies are row-level (001).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The CHECK: a fourth value, same constraint name.
-- ----------------------------------------------------------------------------
ALTER TABLE lists
  DROP CONSTRAINT IF EXISTS lists_ranking_mode_check;
ALTER TABLE lists
  ADD CONSTRAINT lists_ranking_mode_check
  CHECK (ranking_mode IN ('unranked', 'ranked', 'rank_and_tier', 'tier_only'));

COMMENT ON COLUMN lists.ranking_mode IS
  'unranked (no numbers, no tiers) | ranked (numbered) | rank_and_tier (numbered, in tiers) | tier_only (in tiers, no numbers). Legacy hide_order = unranked or tier_only; tiers_enabled = rank_and_tier or tier_only.';

-- ----------------------------------------------------------------------------
-- 2. duplicate_list: the one SQL path that derives the pair.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION duplicate_list(
  p_source_id uuid,
  p_title text,
  p_slug text,
  p_force_public boolean DEFAULT false
)
RETURNS lists
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_source lists%ROWTYPE;
  v_new lists;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING errcode = '28000';
  END IF;

  -- RLS applies (SECURITY INVOKER): only a public or owned, non-deleted list
  -- is visible here. Anything else raises "not found" (mapped to 404).
  SELECT * INTO v_source
  FROM lists
  WHERE id = p_source_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'List not found' USING errcode = 'P0002';
  END IF;

  -- ranking_mode is the source of truth; keep the legacy boolean pair derived
  -- from it so the copied row stays internally consistent (191: hide_order =
  -- no numbers, tiers_enabled = tiers, so tier_only sets both). A duplicate is
  -- never itself a Big Board, and never inherits the source's folder. It
  -- keeps the source's cover colour (188), like its position group.
  INSERT INTO lists (
    owner_id, title, description, slug, position_filter, cover_color,
    ranking_mode, hide_order, tiers_enabled,
    is_private, is_team, roster_settings, is_big_board, comments_enabled
  )
  VALUES (
    v_owner, p_title, v_source.description, p_slug, v_source.position_filter,
    v_source.cover_color,
    v_source.ranking_mode,
    v_source.ranking_mode IN ('unranked', 'tier_only'),
    v_source.ranking_mode IN ('rank_and_tier', 'tier_only'),
    CASE WHEN p_force_public THEN false ELSE v_source.is_private END,
    COALESCE(v_source.is_team, false), v_source.roster_settings,
    false, v_source.comments_enabled
  )
  RETURNING * INTO v_new;

  -- Copy players, preserving order, tier, and roster-slot assignments.
  INSERT INTO list_players (
    list_id, player_id, position, tier, rank_in_tier, overall_rank, slot, notes
  )
  SELECT v_new.id, player_id, position, tier, rank_in_tier, overall_rank, slot, notes
  FROM list_players
  WHERE list_id = p_source_id;

  -- Copy tag associations.
  INSERT INTO list_tags (list_id, tag_id)
  SELECT v_new.id, tag_id
  FROM list_tags
  WHERE list_id = p_source_id;

  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION duplicate_list(uuid, text, text, boolean) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Existing rows: re-derive the legacy pair from the mode where they
--    disagree (see header). Idempotent — a second run finds nothing to fix.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_fixed integer := 0;
  v_skipped integer := 0;
BEGIN
  FOR r IN
    SELECT id, ranking_mode
      FROM lists
     WHERE hide_order IS DISTINCT FROM (ranking_mode IN ('unranked', 'tier_only'))
        OR tiers_enabled IS DISTINCT FROM (ranking_mode IN ('rank_and_tier', 'tier_only'))
     ORDER BY id
  LOOP
    BEGIN
      UPDATE lists
         SET hide_order    = r.ranking_mode IN ('unranked', 'tier_only'),
             tiers_enabled = r.ranking_mode IN ('rank_and_tier', 'tier_only')
       WHERE id = r.id;
      v_fixed := v_fixed + 1;
    EXCEPTION WHEN check_violation THEN
      v_skipped := v_skipped + 1;
      RAISE WARNING '191: list % (%) keeps its legacy flags — %', r.id, r.ranking_mode, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE '191: re-derived hide_order / tiers_enabled on % list(s); % skipped', v_fixed, v_skipped;
END;
$$;
