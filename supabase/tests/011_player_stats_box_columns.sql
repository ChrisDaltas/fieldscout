-- ============================================================================
-- player_stats box-score columns — migration 057 (task L.A1.7; D41/D56;
-- R52 closure, M1 batch-4 review findings remediation 2026-07-20).
--
-- Origin: 057 shipped under a citable pgTAP waiver ("additive columns on an
-- already-tested table; coverage via registry golden pins + vitest upsert
-- continuity"). R52 falsified the waiver's coverage claim: nothing executable
-- touched the 11 columns IN THE DATABASE — vitest never opens a DB
-- connection, type-check reads the committed database.ts (regenerated only
-- manually), and no pgTAP file referenced any of the columns. Deleting 057's
-- ALTER TABLE (or typo'ing a column name in it) failed zero tests; the only
-- consistency proof was the one-time typegen at build time. These pins close
-- exactly that gap, following the house columns_are precedent (005/009/010).
-- The 057 banner's waiver paragraph is annotated retired in the same PR.
--
-- Numbering note: next free pgTAP number at task time is 011 (010 taken by
-- league_weeks). tasks-M1's task-text pgTAP numbers for L.A1.9/L.A1.11 read
-- through the standing drift policy ("Builders confirm the next free numbers
-- at task time") — L.A1.9's file becomes 012.
--
-- Falsifiability notes (§4.3):
--   * The columns_are golden pin asserts the EXACT 49-column set — a dropped,
--     renamed, or typo'd 057 column fails it loudly (as does any future
--     undocumented column, the 005 invite_slug maintenance pattern).
--   * Per-column type + default pins catch a retype (e.g. INTEGER → NUMERIC)
--     or a dropped DEFAULT 0 that the set-level pin would miss.
--   * No policy/RLS asserts here: player_stats RLS/grants are unchanged by
--     057 and already pinned elsewhere (000/001); this file is shape-only.
--   * Break probe for this file: DROP one 057 column live → the columns_are
--     pin + that column's three per-column pins fail; restore via db reset.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(34);

-- ---------------------------------------------------------------------------
-- A. Full-table shape golden pin: the pre-057 surface + 057's 11 additive
--    columns, as one exact set (house precedent: 005/009/010).
-- ---------------------------------------------------------------------------
select columns_are('public', 'player_stats',
  array['id', 'player_id', 'season', 'week', 'stat_type', 'game_id',
        'is_live', 'pass_attempts', 'pass_completions', 'pass_yards',
        'pass_tds', 'interceptions', 'sacks_taken', 'rush_attempts',
        'rush_yards', 'rush_tds', 'fumbles_lost', 'targets', 'receptions',
        'receiving_yards', 'receiving_tds', 'fg_made', 'fg_attempted',
        'fg_made_40_plus', 'fg_made_50_plus', 'xp_made', 'xp_attempted',
        'def_sacks', 'def_interceptions', 'def_fumble_recoveries', 'def_tds',
        'def_safeties', 'def_points_allowed', 'two_point_conversions',
        'game_quarter', 'game_clock', 'player_game_status', 'updated_at',
        'source',
        -- 057's 11 (names = canonical registry keys, D56(4)):
        'pass_2pt', 'rush_2pt', 'rec_2pt', 'fg_0_39', 'fg_missed',
        'pat_missed', 'def_block', 'def_return_td', 'fumble_recovery_td',
        'return_td', 'def_yards_allowed'],
  'exact player_stats column set (pre-057 surface + 057''s 11)');

-- ---------------------------------------------------------------------------
-- B. Per-column pins for 057's 11: INTEGER DEFAULT 0 (001's convention,
--    per the 057 banner).
-- ---------------------------------------------------------------------------
select col_type_is('public', 'player_stats', 'pass_2pt', 'integer', 'pass_2pt is INTEGER');
select col_default_is('public', 'player_stats', 'pass_2pt', 0, 'pass_2pt defaults to 0');
select col_type_is('public', 'player_stats', 'rush_2pt', 'integer', 'rush_2pt is INTEGER');
select col_default_is('public', 'player_stats', 'rush_2pt', 0, 'rush_2pt defaults to 0');
select col_type_is('public', 'player_stats', 'rec_2pt', 'integer', 'rec_2pt is INTEGER');
select col_default_is('public', 'player_stats', 'rec_2pt', 0, 'rec_2pt defaults to 0');
select col_type_is('public', 'player_stats', 'fg_0_39', 'integer', 'fg_0_39 is INTEGER');
select col_default_is('public', 'player_stats', 'fg_0_39', 0, 'fg_0_39 defaults to 0');
select col_type_is('public', 'player_stats', 'fg_missed', 'integer', 'fg_missed is INTEGER');
select col_default_is('public', 'player_stats', 'fg_missed', 0, 'fg_missed defaults to 0');
select col_type_is('public', 'player_stats', 'pat_missed', 'integer', 'pat_missed is INTEGER');
select col_default_is('public', 'player_stats', 'pat_missed', 0, 'pat_missed defaults to 0');
select col_type_is('public', 'player_stats', 'def_block', 'integer', 'def_block is INTEGER');
select col_default_is('public', 'player_stats', 'def_block', 0, 'def_block defaults to 0');
select col_type_is('public', 'player_stats', 'def_return_td', 'integer', 'def_return_td is INTEGER');
select col_default_is('public', 'player_stats', 'def_return_td', 0, 'def_return_td defaults to 0');
select col_type_is('public', 'player_stats', 'fumble_recovery_td', 'integer', 'fumble_recovery_td is INTEGER');
select col_default_is('public', 'player_stats', 'fumble_recovery_td', 0, 'fumble_recovery_td defaults to 0');
select col_type_is('public', 'player_stats', 'return_td', 'integer', 'return_td is INTEGER');
select col_default_is('public', 'player_stats', 'return_td', 0, 'return_td defaults to 0');
select col_type_is('public', 'player_stats', 'def_yards_allowed', 'integer', 'def_yards_allowed is INTEGER');
select col_default_is('public', 'player_stats', 'def_yards_allowed', 0, 'def_yards_allowed defaults to 0');

-- ---------------------------------------------------------------------------
-- C. Column presence for 057's 11 (redundant with A by construction, kept as
--    named single-column failures so a break names the exact column).
-- ---------------------------------------------------------------------------
select has_column('public', 'player_stats', 'pass_2pt', 'pass_2pt exists');
select has_column('public', 'player_stats', 'rush_2pt', 'rush_2pt exists');
select has_column('public', 'player_stats', 'rec_2pt', 'rec_2pt exists');
select has_column('public', 'player_stats', 'fg_0_39', 'fg_0_39 exists');
select has_column('public', 'player_stats', 'fg_missed', 'fg_missed exists');
select has_column('public', 'player_stats', 'pat_missed', 'pat_missed exists');
select has_column('public', 'player_stats', 'def_block', 'def_block exists');
select has_column('public', 'player_stats', 'def_return_td', 'def_return_td exists');
select has_column('public', 'player_stats', 'fumble_recovery_td', 'fumble_recovery_td exists');
select has_column('public', 'player_stats', 'return_td', 'return_td exists');
select has_column('public', 'player_stats', 'def_yards_allowed', 'def_yards_allowed exists');

select * from finish();
rollback;
