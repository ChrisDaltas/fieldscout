-- ============================================================================
-- 159_faab_budget_range.sql — a league's FAAB budget is 0–1000 in the
-- database, refused BY NAME (PROGRESS F409 / R1165; task L.D3.10 — the M5
-- closeout, which F409's owner cell names when no M5 task replaces
-- `create_league` / `update_league_settings`; none did).
-- Spec §7.3.4 catalog row `faab_budget` — default 100, range **0–1000**;
-- §12.1 (the typed column); §12.2 (balances seeded from it).
--
-- Numbering: measured at build time (D161) — `ls supabase/migrations | tail
-- -1` → 158_stored_player_points.sql, `ls supabase/tests | tail -1` →
-- 106_stored_player_points.sql; so 159 / pgTAP 107. NOT held: reaches
-- production by `npx supabase db push` only (push debt: 135–159).
--
-- THE GAP (measured on the 158 chain before this file): the UI's Zod enforces
-- 0–1000 (`league-settings.ts`, pinned in league-settings.test.ts) and
-- `commish_change_setting` validates the catalog range (149), but the two
-- DEFINER verbs that WRITE the column from the setup screens —
-- `create_league` (118:2224) and `update_league_settings` (118:2438) — do not:
-- a direct RPC call stored $1001, and a negative budget was refused only by a
-- raw 23514 from `league_members_faab_balance_nonneg` (the seat's seeded
-- balance), never by a name that says "budget".
--
-- THE FIX: one named CHECK on the column — `leagues_faab_budget_range`
-- (`faab_budget BETWEEN 0 AND 1000`). It binds EVERY writer, service role
-- included, so no function body changes (no CREATE OR REPLACE — nothing to
-- author against the chain's HEAD). A refused write is 23514 whose message
-- names the constraint.
--
-- EXISTING ROWS: the constraint is added only after a pre-check that names
-- every league outside the range and RAISES — so a push against data that
-- would violate it stops loudly with the league ids, never with a bare
-- constraint error or a half-applied file. (Every writer so far defaulted to
-- 100 or went through the 0–1000 UI; none is expected.)
--
-- Checklist (tasks-M* §4.4): no new table ⇒ no RLS / policy / grant change;
-- no function ⇒ no DEFINER / search_path / REVOKE surface; idempotent (the
-- constraint is added only when absent); typegen unchanged (a CHECK does not
-- change the generated types — verified: `supabase gen types` diff empty).
-- R6 / D38 waivers: none needed.
-- ============================================================================

DO $$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(l.id::text || ' ($' || l.faab_budget || ')', ', ' ORDER BY l.id)
    INTO v_bad
  FROM public.leagues l
  WHERE l.faab_budget NOT BETWEEN 0 AND 1000;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '159: league(s) hold a FAAB budget outside 0–1000 (§7.3.4) — fix them before this constraint can be added: %', v_bad
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leagues_faab_budget_range' AND conrelid = 'public.leagues'::regclass
  ) THEN
    ALTER TABLE public.leagues
      ADD CONSTRAINT leagues_faab_budget_range CHECK (faab_budget BETWEEN 0 AND 1000);
  END IF;
END
$$;

COMMENT ON CONSTRAINT leagues_faab_budget_range ON public.leagues IS
  'F409 (159): a league''s FAAB budget is 0–1000 (spec §7.3.4) — binds every writer, refused by this name.';
