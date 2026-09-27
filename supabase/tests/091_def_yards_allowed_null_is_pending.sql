-- ============================================================================
-- 091 — migration 143: `player_stats.def_yards_allowed` has NO DEFAULT and
-- NULL means "not delivered" (M6A task L.E1.26; PROGRESS F390, D380).
--
-- Numbering: RESERVED by the orchestrator (143 / 091; PR #320 holds 141 / 089).
--
-- What is pinned, and why each cell can fail (tasks-M6A §4 rule 14):
--   A. The column contract as 143 leaves it — INTEGER, nullable, NO default,
--      and the column comment naming the NULL-is-pending rule. Break probe
--      (shown in the PR): restoring `DEFAULT 0` reds A2 and B1.
--   B. The behaviour a writer sees — a row inserted WITHOUT the column
--      stores NULL (not 0); a row inserted with 355 stores 355; a DELIVERED
--      0 stays 0 (NULL and 0 are distinct facts). Premise asserted first:
--      the fixture player exists, and no stat row exists for it before the
--      inserts (rule 14(c)).
--   C. The neighbours are untouched — 057's other ten columns (and 001's
--      def_points_allowed) still DEFAULT 0, so 143 moved exactly one column
--      (a DROP DEFAULT typo'd onto a sibling reds here).
--   The backfill (143's one-shot UPDATE of the pre-existing zeros) is NOT
--   cellable here: a fresh `db reset` chain holds no `player_stats` rows, so
--   any "no zero survives" cell would pass with the UPDATE deleted (rule
--   14(b) — replaced, and said so). It is evidenced instead by the
--   migration's own in-body ASSERT (RAISE EXCEPTION if a zero survives) and
--   by the rehearsal on the local restored pool recorded in the PR.
--
-- pgTAP descriptions are SQL literals: no bare apostrophes.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

-- ---------------------------------------------------------------------------
-- A. The column contract.
-- ---------------------------------------------------------------------------
select col_type_is('public', 'player_stats', 'def_yards_allowed', 'integer',
  'A1: def_yards_allowed is INTEGER');
select col_hasnt_default('public', 'player_stats', 'def_yards_allowed',
  'A2: def_yards_allowed has NO default (143) - an absent value is NULL, never 0');
select col_is_null('public', 'player_stats', 'def_yards_allowed',
  'A3: def_yards_allowed is nullable - NULL is the not-delivered state');
select ok(
  col_description('public.player_stats'::regclass,
    (select attnum from pg_attribute
      where attrelid = 'public.player_stats'::regclass and attname = 'def_yards_allowed'))
    like '%NULL = not delivered, scored as PENDING%',
  'A4: the column comment states the NULL-is-pending contract');

-- ---------------------------------------------------------------------------
-- B. What a writer sees. Fixture: one D/ST player, three weeks.
-- ---------------------------------------------------------------------------
insert into public.players (id, full_name, position, team, status)
values ('le126-dst', 'LE126 Fixture DST', 'DEF', 'LEX', 'Active');

select is((select count(*)::int from public.players where id = 'le126-dst'), 1,
  'B0: premise - the fixture D/ST player exists');
select is((select count(*)::int from public.player_stats where player_id = 'le126-dst'), 0,
  'B0b: premise - no stat row exists for the fixture player before the inserts');

-- A line without yards allowed (the writer omits the column entirely).
insert into public.player_stats (player_id, season, week, stat_type, def_sacks, def_points_allowed)
values ('le126-dst', 2099, 1, 'weekly', 2, 17);
-- A delivered value.
insert into public.player_stats (player_id, season, week, stat_type, def_sacks, def_points_allowed, def_yards_allowed)
values ('le126-dst', 2099, 2, 'weekly', 3, 20, 355);
-- A delivered ZERO (distinct from not delivered).
insert into public.player_stats (player_id, season, week, stat_type, def_sacks, def_points_allowed, def_yards_allowed)
values ('le126-dst', 2099, 3, 'weekly', 1, 0, 0);

select ok((select def_yards_allowed is null from public.player_stats where player_id = 'le126-dst' and season = 2099 and week = 1),
  'B1: a row inserted without def_yards_allowed stores NULL, not 0');
select is((select def_points_allowed from public.player_stats where player_id = 'le126-dst' and season = 2099 and week = 1), 17,
  'B1b: the same row keeps its delivered points allowed (only yards is absent)');
select is((select def_yards_allowed from public.player_stats where player_id = 'le126-dst' and season = 2099 and week = 2), 355,
  'B2: a delivered 355 is stored as 355');
select is((select def_yards_allowed from public.player_stats where player_id = 'le126-dst' and season = 2099 and week = 3), 0,
  'B3: a delivered 0 stays 0 - NULL and 0 are distinct facts');
select is((select count(*)::int from public.player_stats where player_id = 'le126-dst' and def_yards_allowed is null), 1,
  'B4: exactly one of the three fixture rows is NULL (the one that omitted the column)');

-- An update that sets it back to NULL is allowed (a withdrawn value is not delivered).
update public.player_stats set def_yards_allowed = null
 where player_id = 'le126-dst' and season = 2099 and week = 2;
select ok((select def_yards_allowed is null from public.player_stats where player_id = 'le126-dst' and season = 2099 and week = 2),
  'B5: the column accepts NULL on UPDATE (no NOT NULL crept in)');

-- ---------------------------------------------------------------------------
-- C. The neighbours still DEFAULT 0 — 143 moved exactly one column.
-- ---------------------------------------------------------------------------
select col_default_is('public', 'player_stats', 'def_points_allowed', 0, 'C1: def_points_allowed still defaults to 0');
select col_default_is('public', 'player_stats', 'fg_0_39', 0, 'C2: fg_0_39 still defaults to 0');
select col_default_is('public', 'player_stats', 'fg_missed', 0, 'C3: fg_missed still defaults to 0');
select col_default_is('public', 'player_stats', 'pat_missed', 0, 'C4: pat_missed still defaults to 0');
select col_default_is('public', 'player_stats', 'def_block', 0, 'C5: def_block still defaults to 0');
select col_default_is('public', 'player_stats', 'def_return_td', 0, 'C6: def_return_td still defaults to 0');
select col_default_is('public', 'player_stats', 'def_sacks', 0, 'C7: def_sacks still defaults to 0');
-- C8 golden set: the integer columns of player_stats with NO default are
-- exactly the three that never had one (season, week, game_quarter - all
-- three from 001) plus def_yards_allowed (143). A DROP DEFAULT on any sibling reds it.
select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.columns
    where table_schema = 'public' and table_name = 'player_stats'
      and data_type = 'integer' and column_default is null),
  array['def_yards_allowed', 'game_quarter', 'season', 'week'],
  'C8: the integer columns without a default are exactly def_yards_allowed plus the three that never had one');

select * from finish();
rollback;
