-- ============================================================================
-- pgTAP 170 — migration 217: player_stats.fg_60_plus and
-- player_stats.def_2pt_return (PROGRESS F871, D834; F870 / F871 design PR 3;
-- spec §23.5's named exception, v2.16.114). PR 4 EXTENDS THIS FILE for
-- migration 218 (the validator, the labels, the rules documents, the live
-- week); until then it pins the columns only.
--
--   §A  FORM — both columns exist, INTEGER, DEFAULT 0, nullable (057's
--       eleven's shape); the door's old-value read of a stored NULL (167,
--       R1317) reads the DEFAULT as 0 for both; fg_60_plus's comment says it
--       is a top-up on the inclusive fg_made_50_plus.
--   §B  RLS AND GRANTS UNCHANGED — RLS on, exactly 005's one SELECT policy,
--       the 037 / 133 table privileges (001's shape), no column-level ACL on
--       the two (the table grants are what reach them), every API role reads
--       them, no trigger; as anon a stored line's two columns read 0 / 0 and
--       an update moves nothing.
--   §C  THE INGEST DOOR (167, body unchanged) — a batch that sends the two
--       keys writes them (quiet: `enqueue: false`, no corrections, no queue
--       row); a later batch on today's surface (no such keys) leaves them as
--       stored; a new line written without them reads 0 / 0.
--
-- Break probe (§4.3, run 2026-11-06, reverted; PROGRESS D834): 217 without
-- `def_2pt_return` ⇒ only 011 (test 1, the exact column set) and this file
-- red: A2 A4 A6 A8 A9 by name, then B5 raises on the missing column and the
-- plan stops (17 of 26 not passed).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(26);

-- ---------------------------------------------------------------------------
-- A. FORM
-- ---------------------------------------------------------------------------
select has_column('public', 'player_stats', 'fg_60_plus', 'A1 fg_60_plus exists');
select has_column('public', 'player_stats', 'def_2pt_return', 'A2 def_2pt_return exists');
select col_type_is('public', 'player_stats', 'fg_60_plus', 'integer', 'A3 fg_60_plus is INTEGER');
select col_type_is('public', 'player_stats', 'def_2pt_return', 'integer', 'A4 def_2pt_return is INTEGER');
select col_default_is('public', 'player_stats', 'fg_60_plus', 0, 'A5 fg_60_plus defaults to 0 (absent reads 0, like 057''s counts; never pending)');
select col_default_is('public', 'player_stats', 'def_2pt_return', 0, 'A6 def_2pt_return defaults to 0');
select col_is_null('public', 'player_stats', 'fg_60_plus', 'A7 fg_60_plus is nullable (057''s shape)');
select col_is_null('public', 'player_stats', 'def_2pt_return', 'A8 def_2pt_return is nullable (057''s shape)');
select is(
  (select string_agg(a.attname || '=' || pg_catalog.pg_get_expr(d.adbin, d.adrelid)::numeric, ',' order by a.attname)
     from pg_catalog.pg_attrdef d
     join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where d.adrelid = 'public.player_stats'::regclass and a.attname in ('fg_60_plus', 'def_2pt_return')),
  'def_2pt_return=0,fg_60_plus=0',
  'A9 the ingest door''s R1317 read (167: a stored NULL reads the column DEFAULT, cast to numeric) gives 0 for both');
select ok(
  col_description('public.player_stats'::regclass,
    (select attnum from pg_attribute where attrelid = 'public.player_stats'::regclass and attname = 'fg_60_plus'))
    ~ 'Counted ALSO in fg_made_50_plus',
  'A10 fg_60_plus''s comment records the top-up: fg_made_50_plus stays inclusive of 60+');

-- ---------------------------------------------------------------------------
-- B. RLS AND GRANTS ON player_stats UNCHANGED BY 217
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.player_stats'::regclass),
  'B1 RLS stays enabled on player_stats');
select policies_are('public', 'player_stats', array['Stats are viewable by everyone'],
  'B2 player_stats keeps exactly 005''s world-readable SELECT policy');
select ok(
  (select bool_and(has_table_privilege(r.rolename, 'public.player_stats', p.priv)
                   = not (p.priv = 'TRUNCATE' and r.rolename <> 'service_role'))
   from (values ('anon'), ('authenticated'), ('service_role')) r(rolename)
   cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
               ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) p(priv)),
  'B3 table privileges as 001 pins them: service_role all 8; anon / authenticated the 7 that are not TRUNCATE (037, 133)');
select is(
  (select count(*)::int from pg_attribute
    where attrelid = 'public.player_stats'::regclass and attname in ('fg_60_plus', 'def_2pt_return') and attacl is not null),
  0, 'B4 no column-level GRANT or REVOKE on the two columns: the table privileges are what reach them');
select ok(
  (select bool_and(has_column_privilege(r.rolename, 'public.player_stats', c.col, 'SELECT'))
   from (values ('anon'), ('authenticated'), ('service_role')) r(rolename)
   cross join (values ('fg_60_plus'), ('def_2pt_return')) c(col)),
  'B5 every API role can SELECT both columns (stats are public, 005)');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.player_stats'::regclass and not tgisinternal), 0,
  'B6 still no trigger on player_stats');

-- Fixtures (postgres, JWT cleared): one kicker, one D/ST, one stored line.
select set_config('request.jwt.claims', '', true);
insert into players (id, full_name, position, team, status) values
 ('pgtap-170-k', 'P170 Kicker', 'K', 'ZZA', 'Active'),
 ('pgtap-170-dst', 'P170 Defense', 'DEF', 'ZZB', 'Active');
insert into player_stats (player_id, season, week, stat_type, fg_made, fg_made_50_plus)
values ('pgtap-170-k', 2094, 1, 'weekly', 2, 1);

set local role anon;
select is(
  (select fg_60_plus || '/' || def_2pt_return from player_stats where player_id = 'pgtap-170-k' and season = 2094),
  '0/0', 'B7 as anon, a stored line''s two columns read 0 / 0 (a line written without them, through 005''s policy)');
with u as (update player_stats set fg_60_plus = 5 where player_id = 'pgtap-170-k' and season = 2094 returning 1)
select is(count(*)::int, 0, 'B8 as anon, an update of fg_60_plus moves no row (RLS: no write policy)') from u;
reset role;
select is(
  (select fg_60_plus from player_stats where player_id = 'pgtap-170-k' and season = 2094),
  0, 'B9 …and the stored value is still 0');

-- ---------------------------------------------------------------------------
-- C. THE INGEST DOOR WRITES THE TWO ONCE THEY ARE SENT (PR 4's surface)
-- ---------------------------------------------------------------------------
create function pg_temp.line(p_player text, p_extra jsonb) returns jsonb language sql as $ln$
  select jsonb_build_object('player_id', p_player, 'season', 2094, 'week', 1, 'stat_type', 'weekly', 'game_id', null,
                            'is_live', false, 'source', 'fixture', 'advanced', '{}'::jsonb) || p_extra;
$ln$;

-- (Each door call is its own statement: a read in the SAME statement would
-- see the snapshot from before the door's write.)
select is(
  public.ingest_write_batch(jsonb_build_array(
     jsonb_build_object('stat', pg_temp.line('pgtap-170-k', '{"fg_made": 2, "fg_made_50_plus": 1, "fg_60_plus": 1, "def_2pt_return": 0}'), 'enqueue', false, 'corrections', '[]'::jsonb),
     jsonb_build_object('stat', pg_temp.line('pgtap-170-dst', '{"fg_made": 0, "fg_made_50_plus": 0, "fg_60_plus": 0, "def_2pt_return": 1}'), 'enqueue', false, 'corrections', '[]'::jsonb)),
   '2094-09-15T12:00:00Z') - 'season' - 'week' - 'week_state',
  '{"enqueued": 0, "received": 2, "restamped": 0, "stats_written": 2, "events_written": 0, "events_replayed": 0, "events_unchanged": 0}'::jsonb,
  'C1 a quiet batch naming fg_60_plus and def_2pt_return is written by 167''s door, body unchanged (its key check reads pg_attribute): 2 lines');
select is((select count(*)::int from score_fanout where season = 2094), 0,
  'C2 …and queues nothing (enqueue false)');
select is(
  (select string_agg(player_id || ' ' || fg_made_50_plus || '/' || fg_60_plus || '/' || def_2pt_return, ', ' order by player_id)
     from player_stats where season = 2094),
  'pgtap-170-dst 0/0/1, pgtap-170-k 1/1/0',
  'C3 …each line stores what was sent (the kicker''s 60-yarder is counted in fg_made_50_plus AND fg_60_plus)');
select is(
  public.ingest_write_batch(jsonb_build_array(
     jsonb_build_object('stat', pg_temp.line('pgtap-170-k', '{"fg_made": 3, "fg_made_50_plus": 1}'), 'enqueue', false, 'corrections', '[]'::jsonb)),
   '2094-09-15T13:00:00Z') ->> 'stats_written',
  '1', 'C4 a batch on today''s surface (no such keys) is written');
select is(
  (select fg_made || '/' || fg_60_plus || '/' || def_2pt_return from player_stats where player_id = 'pgtap-170-k' and season = 2094),
  '3/1/0', 'C5 …and sets only the columns it sends: fg_made moves, fg_60_plus and def_2pt_return stay as stored');
insert into players (id, full_name, position, team, status) values ('pgtap-170-k2', 'P170 Kicker Two', 'K', 'ZZA', 'Active');
select is(
  public.ingest_write_batch(jsonb_build_array(
     jsonb_build_object('stat', pg_temp.line('pgtap-170-k2', '{"fg_made": 1}'), 'enqueue', false, 'corrections', '[]'::jsonb)),
   '2094-09-15T14:00:00Z') ->> 'stats_written',
  '1', 'C6 a new line on today''s surface is written');
select is(
  (select fg_60_plus || '/' || def_2pt_return from player_stats where player_id = 'pgtap-170-k2' and season = 2094),
  '0/0', 'C7 …and reads 0 / 0 in the two columns (the DEFAULT)');

select * from finish();
rollback;
