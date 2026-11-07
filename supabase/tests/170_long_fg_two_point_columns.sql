-- ============================================================================
-- pgTAP 170 — migrations 217 and 218: the 60+ yard field goal and the D/ST
-- two-point return (PROGRESS F871, D834, D835; F870 / F871 design PRs 3-4;
-- spec v2.16.114-115). 217 added the columns (§A-§C); 218 makes them pay
-- (§D-§G).
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
--   §D  218 (a) THE VALIDATOR — an override of fg_60_plus is legal on the K
--       page and refused on QB; def_2pt_return on D/ST and refused on K;
--       both payable in a flat map. 218 (b) THE WORDS. The two replaced
--       functions keep their form; the two new helpers are plain, search_path
--       '', REVOKEd.
--   §E  218 (c) THE TEMPLATE ROWS — ESPN Standard / Full PPR are their 058
--       bodies plus exactly {fg_60_plus 1, def_2pt_return 2} and the new note;
--       Scout Standard / PPR plus exactly {def_2pt_return 2} (Q2), descriptions
--       unchanged; the four Yahoo / Sleeper rows byte-unchanged.
--   §F  218 (d) THE REWRITE on fixtures, every document pre-218 shaped: an
--       ESPN template league; an ESPN fork by receipt; an ESPN fork with a
--       customised fg_50_plus (no top-up, value kept); a fork with no receipt
--       (ESPN kicking by value); a Scout template league and a Scout fork
--       (def_2pt_return only); a no-receipt fork with Scout's D/ST by value; a
--       league whose live week is on its OLD system (each document on its
--       own); a fork shared with a league outside the change (kept); Yahoo
--       and Sleeper untouched; archived, complete and 2025 leagues untouched
--       and named. Every final and correction-window week BYTE-IDENTICAL; the
--       live week changed; upcoming weeks still hold nothing; exactly one
--       system post per rewritten league, in its words; none elsewhere; no
--       commissioner_actions row.
--   §G  218 (e) THE RE-QUEUE — the live week's lines holding either stat, at
--       their own updated_at, and nothing else; a second run changes nothing.
--
-- Break probes (§4.3, reverted): 217 without `def_2pt_return` ⇒ only 011 and
-- this file red (PROGRESS D834). 218's probes: PROGRESS D835.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(63);

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


-- ---------------------------------------------------------------------------
-- D. 218 (a) THE VALIDATOR AND (b) THE WORDS
-- ---------------------------------------------------------------------------
-- The validator's answer: 'ACCEPT', or its HINT (the family) | DETAIL (the path).
create function pg_temp.verdict(p_doc jsonb) returns text language plpgsql as $v$
declare v_hint text; v_detail text;
begin
  perform public.scoring_rules_validate(p_doc);
  return 'ACCEPT';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return coalesce(v_hint, '?') || '|' || coalesce(v_detail, '?');
end;
$v$;
-- A format-2 envelope on ESPN Standard's 218 row with the given overrides.
create function pg_temp.env(p_positions jsonb) returns jsonb language sql as $e$
  select jsonb_build_object('format', 2,
    'base', (select rules from public.scoring_systems where is_template and name = 'ESPN Standard'),
    'positions', p_positions,
    'tier_cuts', public.scoring_detect_tier_cuts((select rules from public.scoring_systems where is_template and name = 'ESPN Standard')));
$e$;

select is(pg_temp.verdict(pg_temp.env('{"K": {"fg_60_plus": 2}}')), 'ACCEPT',
  'D1 a K override of fg_60_plus is accepted (c_kicking gained it)');
select is(pg_temp.verdict(pg_temp.env('{"QB": {"fg_60_plus": 2}}')), 'position_scope|positions.QB.fg_60_plus',
  'D2 …a QB override of it is refused BY NAME (guardrail 3: K-only)');
select is(pg_temp.verdict(pg_temp.env('{"DST": {"def_2pt_return": 3}}')), 'ACCEPT',
  'D3 a D/ST override of def_2pt_return is accepted (c_dst_events gained it)');
select is(pg_temp.verdict(pg_temp.env('{"K": {"def_2pt_return": 3}}')), 'position_scope|positions.K.def_2pt_return',
  'D4 …a K override of it is refused BY NAME (guardrail 3: D/ST-only)');
select is(
  pg_temp.verdict('{"fg_50_plus": 5, "fg_60_plus": 1, "def_2pt_return": 2}'::jsonb) || ','
  || pg_temp.verdict('{"fg_70_plus": 1}'::jsonb),
  'ACCEPT,scorable_allowlist|fg_70_plus',
  'D5 both keys are payable in a flat (format-1) map (c_scorable), and the allowlist is still a membership test');
select is(
  public.stat_key_label_internal('fg_60_plus') || ' / ' || public.stat_key_label_internal('def_2pt_return')
  || ' / ' || public.stat_key_label_internal('fg_50_plus'),
  'FG made (60+) / two-point return (D/ST) / FG made (50+)',
  'D6 218 (b): the plain words of the two keys (registry labels, sentence case), and an old one unchanged');
select ok(
  (select bool_and(p.provolatile = 'i' and p.proconfig @> array['search_path=""'] and not p.prosecdef
                   and not has_function_privilege('anon', p.oid, 'execute'))
     from pg_proc p where p.oid in ('public.scoring_rules_validate(jsonb)'::regprocedure, 'public.stat_key_label_internal(text)'::regprocedure))
  and not has_function_privilege('authenticated', 'public.stat_key_label_internal(text)', 'execute'),
  'D7 both replaced functions stay IMMUTABLE, plain, search_path empty, REVOKEd as at the head (validator: anon; labels: anon and authenticated)');
select ok(
  (select bool_and(not p.prosecdef and p.proconfig @> array['search_path=""']
                   and not has_function_privilege('anon', p.oid, 'execute')
                   and not has_function_privilege('authenticated', p.oid, 'execute'))
     from pg_proc p
    where p.oid in ('public.long_fg_two_point_doc_plan_internal(jsonb, uuid)'::regprocedure,
                    'public.long_fg_two_point_rules_add_internal()'::regprocedure)),
  'D8 the two 218 helpers are plain (no DEFINER), search_path empty, and REVOKEd from anon and authenticated (160''s shape)');

-- ---------------------------------------------------------------------------
-- E. 218 (c) THE TEMPLATE ROWS
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(name || ':' || md5((rules - 'fg_60_plus' - 'def_2pt_return')::text) || ':' || (rules ->> 'fg_60_plus') || ':' || (rules ->> 'def_2pt_return'), ',' order by name)
     from scoring_systems where is_template and name like 'ESPN %'),
  'ESPN Full PPR:7a448a2aaa6997cc8e734a52b6231e17:1:2,ESPN Standard:924bff8a8c664badf14685a236c2274e:1:2',
  'E1 both ESPN rows are their 058 bodies (md5 of the row minus the two keys = the pre-218 literal, 092''s) plus exactly fg_60_plus 1 and def_2pt_return 2');
select is(
  (select string_agg(name || ':' || md5((rules - 'def_2pt_return')::text) || ':' || (rules ? 'fg_60_plus')::text || ':' || (rules ->> 'def_2pt_return') || ':' || md5(description), ',' order by name)
     from scoring_systems where is_template and name like 'Scout %'),
  'Scout PPR:78ac971c53af861bc1e9ff77a139693b:false:2:89898043a7c1a5ce7a32e4b48dfd99df,'
  'Scout Standard:86133bf6d838a5e50dc8ba8017a5a0ce:false:2:4f51ad7361c2f576263ffd87b328ca19',
  'E2 both Scout rows are their 106 / 108 bodies plus exactly def_2pt_return 2 (Q2, Chris 2026-11-05 "yes") — NO fg_60_plus (every Scout field goal pays a flat 3) — and their descriptions are unchanged');
select is(
  (select string_agg(name || ':' || md5(rules::text) || ':' || md5(description), ',' order by name)
     from scoring_systems where is_template and (name like 'Yahoo %' or name like 'Sleeper %')),
  'Sleeper Full PPR:79cfc4e1eb330ad79873adf816a7bf89:3bc8741952c295ee425051cdfd10eeaa,'
  'Sleeper Standard:d32ffe68b5513b1a7a3b52f8b090d84e:eb832206b5d5ecf828f7c57c9f45a8d4,'
  'Yahoo Half PPR:f6a10e87490bde3f85204213d1c18b47:5d0c9e0848c6feec7769143f92e2ddd8,'
  'Yahoo Standard:21f213104422db39bf145b7fae9bc206:b50dad625543d2bac39e8658d5caa09b',
  'E3 the four Yahoo / Sleeper rows are byte-unchanged, rules and description (stored-literal md5s)');
select is(
  (select string_agg(name || ': ' || description, ' || ' order by name) from scoring_systems where is_template and name like 'ESPN %'),
  'ESPN Full PPR: ESPN''s 2026 default scoring with 1 point per reception — verified against ESPN''s published defaults (July 2026). Interceptions −2. Heads up on one tiny gap our stat feed cannot see: ESPN awards 1 point when a D/ST scores a safety on a PAT try (not scored here). Our stats come from one feed, so on a rare play our count can differ from ESPN''s.'
  || ' || ESPN Standard: ESPN''s 2026 default scoring, 0 PPR — verified against ESPN''s published defaults (July 2026). Interceptions −2. Heads up on one tiny gap our stat feed cannot see: ESPN awards 1 point when a D/ST scores a safety on a PAT try (not scored here). Our stats come from one feed, so on a rare play our count can differ from ESPN''s.',
  'E4 the ESPN descriptions carry the new note: the 60+ and PAT-return exceptions closed, PAT-safety the one named gap left (Q9''s user-visibility condition)');

-- ---------------------------------------------------------------------------
-- F. 218 (d) THE REWRITE ON FIXTURES (postgres, JWT cleared). Every document
--    is pre-218 shaped: the template row minus the two keys.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
create function pg_temp.tpl(p_name text) returns uuid language sql as $t$
  select id from public.scoring_systems where is_template and owner_id is null and name = p_name;
$t$;
create function pg_temp.pre(p_name text) returns jsonb language sql as $t$
  select rules - 'fg_60_plus' - 'def_2pt_return' from public.scoring_systems where is_template and owner_id is null and name = p_name;
$t$;
create function pg_temp.fork(p_name text, p_positions jsonb) returns jsonb language sql as $t$
  select jsonb_build_object('format', 2, 'base', pg_temp.pre(p_name), 'positions', p_positions,
                            'tier_cuts', public.scoring_detect_tier_cuts(pg_temp.pre(p_name)));
$t$;
create function pg_temp.lg(n int) returns uuid language sql as $t$
  select ('e1700000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid;
$t$;
create function pg_temp.fk(n int) returns uuid language sql as $t$
  select ('e1710000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid;
$t$;

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'f1700000-0000-4000-8000-000000000001',
        'authenticated', 'authenticated', 'pgtap-170@fieldscout.local', 'x', now(),
        '{"provider": "email", "providers": ["email"]}', '{"username": "p170_user"}', now(), now());

-- The forks (format 2): F2 ESPN Full PPR by receipt; F3 ESPN Standard by
-- receipt, K's 50+ customised to 6; F4 no receipt, ESPN kicking by value;
-- F6 Scout PPR by receipt; F7 no receipt, Scout's D/ST by value (Scout's
-- kicking is not ESPN's); F9 Sleeper Standard by receipt; F15 ESPN Standard
-- by receipt, shared with a COMPLETE league.
insert into scoring_systems (id, name, description, owner_id, is_template, rules)
select pg_temp.fk(f.n), 'P170 fork ' || f.n, 'pgTAP 170', 'f1700000-0000-4000-8000-000000000001', false, pg_temp.fork(f.tpl, f.pos::jsonb)
from (values (2, 'ESPN Full PPR', '{}'), (3, 'ESPN Standard', '{"K": {"fg_50_plus": 6}}'), (4, 'ESPN Standard', '{}'),
             (6, 'Scout PPR', '{}'), (7, 'Scout Standard', '{}'), (9, 'Sleeper Standard', '{}'),
             (15, 'ESPN Standard', '{}'), (18, 'Scout Standard', '{"K": {"fg_50_plus": 5}}')) f(n, tpl, pos);
-- F17: an ESPN fork that ALREADY holds both keys at its commissioner's own
-- values (base def_2pt_return 3, K's 60+ top-up 2) — possible only once 218's
-- validator accepts them; 218 must never overwrite either.
insert into scoring_systems (id, name, description, owner_id, is_template, rules)
values (pg_temp.fk(17), 'P170 fork 17', 'pgTAP 170', 'f1700000-0000-4000-8000-000000000001', false,
        jsonb_set(pg_temp.fork('ESPN Standard', '{"K": {"fg_60_plus": 2}}'), '{base}', pg_temp.pre('ESPN Standard') || '{"def_2pt_return": 3}'));

-- The leagues. Week 3 is the NFL week being played.
--   1 ESPN Standard template, in season: weeks 1 final, 2 correction window, 3 live, 4 upcoming
--   2 fork F2, in season: 1 final, 2 correction window, 3 upcoming (no live week: Tuesday)
--   3 fork F3, in season: 3 live, 4 upcoming
--   4 fork F4, in season: no week rows
--   5 Scout Standard template, in season: 1 and 2 final, 3 live
--   6 fork F6, drafting: no week rows
--   7 fork F7, in season: 3 live
--   8 Yahoo Standard template, in season: 3 live
--   9 fork F9, in season: 3 live
--  10 ESPN Standard template, in season, ARCHIVED
--  11 ESPN Standard template, complete
--  12 ESPN Standard template, season 2025, in season
--  13 ESPN Standard template now, in season — its live week 3 opened on Scout Standard (switched, re-score off); 4 upcoming
--  15 fork F15, in season (F15 is shared with 16)
--  16 fork F15, complete
--  17 fork F17 (already holds both keys), in season
--  18 fork F18 (Scout by receipt, its commissioner set K's 50+ to 5), in season
insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks,
                     playoff_teams, playoff_start_week, faab_budget, scoring_system_id, scoring_rules_snapshot,
                     lineup_lock, settings, roster_settings, deleted_at, created_at, updated_at)
select pg_temp.lg(l.n), 'f1700000-0000-4000-8000-000000000001', 'pgtap-170-L' || l.n, l.season, l.status,
       8, 10, 4, 11, 100, l.sys, l.doc, 'per_player_kickoff', '{"schedule_mode": "h2h"}',
       '{"starting_slots": [{"key": "k", "label": "K", "eligible": ["K"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}',
       l.archived, now() - interval '10 days', now() - interval '10 days'
from (values
  (1,  2026, 'in_season', pg_temp.tpl('ESPN Standard'),    pg_temp.pre('ESPN Standard'),    null::timestamptz),
  (2,  2026, 'in_season', pg_temp.fk(2),                   pg_temp.fork('ESPN Full PPR', '{}'), null),
  (3,  2026, 'in_season', pg_temp.fk(3),                   pg_temp.fork('ESPN Standard', '{"K": {"fg_50_plus": 6}}'), null),
  (4,  2026, 'in_season', pg_temp.fk(4),                   pg_temp.fork('ESPN Standard', '{}'), null),
  (5,  2026, 'in_season', pg_temp.tpl('Scout Standard'),   pg_temp.pre('Scout Standard'),   null),
  (6,  2026, 'drafting',  pg_temp.fk(6),                   pg_temp.fork('Scout PPR', '{}'), null),
  (7,  2026, 'in_season', pg_temp.fk(7),                   pg_temp.fork('Scout Standard', '{}'), null),
  (8,  2026, 'in_season', pg_temp.tpl('Yahoo Standard'),   pg_temp.pre('Yahoo Standard'),   null),
  (9,  2026, 'in_season', pg_temp.fk(9),                   pg_temp.fork('Sleeper Standard', '{}'), null),
  (10, 2026, 'in_season', pg_temp.tpl('ESPN Standard'),    pg_temp.pre('ESPN Standard'),    now() - interval '1 day'),
  (11, 2026, 'complete',  pg_temp.tpl('ESPN Standard'),    pg_temp.pre('ESPN Standard'),    null),
  (12, 2025, 'in_season', pg_temp.tpl('ESPN Standard'),    pg_temp.pre('ESPN Standard'),    null),
  (13, 2026, 'in_season', pg_temp.tpl('Scout Standard'),   pg_temp.pre('Scout Standard'),   null),
  (15, 2026, 'in_season', pg_temp.fk(15),                  pg_temp.fork('ESPN Standard', '{}'), null),
  (16, 2026, 'complete',  pg_temp.fk(15),                  pg_temp.fork('ESPN Standard', '{}'), null),
  (17, 2026, 'in_season', pg_temp.fk(17),                  (select rules from scoring_systems where id = pg_temp.fk(17)), null),
  (18, 2026, 'in_season', pg_temp.fk(18),                  pg_temp.fork('Scout Standard', '{"K": {"fg_50_plus": 5}}'), null)
) l(n, season, status, sys, doc, archived);

-- The fork receipts (169's fork_scoring shape: after.scoring_system_id, metadata.template_id).
insert into commissioner_actions (league_id, actor_id, action_type, target_type, target_id, before, after, metadata, created_at)
select pg_temp.lg(r.n), 'f1700000-0000-4000-8000-000000000001', 'fork_scoring', 'league', pg_temp.lg(r.n)::text,
       jsonb_build_object('scoring_system_id', pg_temp.tpl(r.tpl)), jsonb_build_object('scoring_system_id', pg_temp.fk(r.f)),
       jsonb_build_object('verb', 'scoring_fork_template', 'bypassed', '[]'::jsonb, 'template_id', pg_temp.tpl(r.tpl), 'scoring_system_name', r.tpl || ' Custom'),
       '2026-08-20 12:00:00+00'
from (values (2, 2, 'ESPN Full PPR'), (3, 3, 'ESPN Standard'), (6, 6, 'Scout PPR'), (9, 9, 'Sleeper Standard'), (15, 15, 'ESPN Standard'), (17, 17, 'ESPN Standard'), (18, 18, 'Scout Standard')) r(n, f, tpl);

-- The weeks, walked one legal step at a time (110), each stamped at open
-- with its league's snapshot (144).
insert into league_weeks (league_id, season, week)
select pg_temp.lg(w.n), 2026, g
from (values (1, 1, 4), (2, 1, 3), (3, 3, 4), (5, 1, 3), (7, 3, 3), (8, 3, 3), (9, 3, 3), (13, 3, 4)) w(n, lo, hi),
     generate_series(w.lo, w.hi) g;
update league_weeks set status = 'live'
 where league_id in (select pg_temp.lg(n) from unnest(array[1, 2, 3, 5, 7, 8, 9, 13]) n)
   and week <= 3 and not (league_id = pg_temp.lg(2) and week = 3);
update league_weeks set status = 'correction_window'
 where league_id in (pg_temp.lg(1), pg_temp.lg(2), pg_temp.lg(5)) and week <= 2;
update league_weeks set status = 'final'
 where (league_id in (pg_temp.lg(1), pg_temp.lg(2)) and week = 1) or (league_id = pg_temp.lg(5) and week <= 2);
-- League 13 switches from Scout to ESPN with re-score off: its live week keeps Scout.
update leagues set scoring_system_id = pg_temp.tpl('ESPN Standard'), scoring_rules_snapshot = pg_temp.pre('ESPN Standard')
 where id = pg_temp.lg(13);

-- Week 3's lines (the live week): a 60-yarder, a two-point return, a line
-- with neither; and a 60-yarder in week 2 (a correction-window week).
insert into players (id, full_name, position, team, status) values
 ('p170-k1', 'P170 Long Kicker', 'K', 'ZZA', 'Active'),
 ('p170-d1', 'P170 Defense', 'DEF', 'ZZB', 'Active'),
 ('p170-k2', 'P170 Short Kicker', 'K', 'ZZC', 'Active');
insert into player_stats (player_id, season, week, stat_type, fg_made, fg_made_50_plus, fg_60_plus, def_2pt_return, updated_at) values
 ('p170-k1', 2026, 3, 'weekly', 2, 1, 1, 0, '2026-09-21 20:10:00+00'),
 ('p170-d1', 2026, 3, 'weekly', 0, 0, 0, 1, '2026-09-21 20:20:00+00'),
 ('p170-k2', 2026, 3, 'weekly', 3, 0, 0, 0, '2026-09-21 20:30:00+00'),
 ('p170-k1', 2026, 2, 'weekly', 1, 1, 1, 0, '2026-09-14 20:10:00+00');
delete from score_fanout where season = 2026 and week in (2, 3);

create temp table pre170 on commit drop as
  select 'league' as kind, l.id::text as id, to_jsonb(l) as row from leagues l where l.name like 'pgtap-170-L%'
  union all select 'week', lw.league_id::text || ':' || lw.week, to_jsonb(lw) from league_weeks lw where lw.league_id in (select id from leagues where name like 'pgtap-170-L%')
  union all select 'fork', s.id::text, to_jsonb(s) from scoring_systems s where s.name like 'P170 fork %';

select is(
  (select string_agg(right(lw.league_id::text, 2) || ':' || lw.week || ':' || lw.status || ':' || coalesce(s.name, '-'), ',' order by lw.league_id, lw.week)
     from league_weeks lw left join scoring_systems s on s.id = lw.scoring_system_id
    where lw.league_id in (pg_temp.lg(1), pg_temp.lg(2), pg_temp.lg(13))),
  '01:1:final:ESPN Standard,01:2:correction_window:ESPN Standard,01:3:live:ESPN Standard,01:4:upcoming:-,'
  '02:1:final:P170 fork 2,02:2:correction_window:P170 fork 2,02:3:upcoming:-,'
  '13:3:live:Scout Standard,13:4:upcoming:-',
  'F0 PREMISE BY VALUE: the weeks as described, each opened week stamped with its league''s system at open (league 13''s live week on Scout, its league now ESPN)');
select is(
  (select count(*)::int from (select scoring_rules_snapshot d from leagues where name like 'pgtap-170-L%' and id <> pg_temp.lg(17)
                              union all select scoring_rules_snapshot from league_weeks where league_id in (select id from leagues where name like 'pgtap-170-L%')
                              union all select rules from scoring_systems where name like 'P170 fork %' and id <> pg_temp.fk(17)) x
    where d::text ~ 'fg_60_plus|def_2pt_return'),
  0, 'F0b PREMISE: no fixture document holds either key yet (every one is pre-218 shaped), league 17 and its fork aside');

create temp table r170 on commit drop as select public.long_fg_two_point_rules_add_internal() as v;

select is(
  (select l.scoring_rules_snapshot from leagues l where l.id = pg_temp.lg(1)),
  pg_temp.pre('ESPN Standard') || '{"fg_60_plus": 1, "def_2pt_return": 2}',
  'F1 ESPN template league: its snapshot (the rules every week from the next takes) gains BOTH keys, nothing else');
select is(
  (select lw.scoring_rules_snapshot || jsonb_build_object('~source', lw.scoring_rules_source, '~system', lw.scoring_system_id = pg_temp.tpl('ESPN Standard'))
     from league_weeks lw where lw.league_id = pg_temp.lg(1) and lw.week = 3),
  pg_temp.pre('ESPN Standard') || '{"fg_60_plus": 1, "def_2pt_return": 2, "~source": "week_open", "~system": true}',
  'F2 …its LIVE week 3 gains both keys too (144''s guard allows live → live); its source and system stay');
select is(
  (select count(*)::int from league_weeks lw join pre170 p on p.kind = 'week' and p.id = lw.league_id::text || ':' || lw.week
    where lw.league_id in (select id from leagues where name like 'pgtap-170-L%')
      and lw.status in ('final', 'correction_window') and to_jsonb(lw) <> p.row),
  0,
  'F3 EVERY final and correction-window week of every fixture league is BYTE-IDENTICAL (Q64 / Q69; 216''s digest and close pass see no change)');
select is(
  (select count(*)::int from league_weeks lw
    where lw.league_id in (select id from leagues where name like 'pgtap-170-L%')
      and lw.status in ('final', 'correction_window')),
  6, 'F3b …and there are six such weeks to check (non-vacuity: weeks 1-2 of leagues 1, 2 and 5)');
select is(
  (select count(*)::int from league_weeks lw
    where lw.league_id in (select id from leagues where name like 'pgtap-170-L%')
      and lw.status = 'upcoming' and lw.scoring_rules_snapshot is not null),
  0, 'F3c upcoming weeks still hold no rules (144''s CHECK): they take the rewritten league snapshot when they open');
select is(
  (select l.scoring_rules_snapshot from leagues l where l.id = pg_temp.lg(2)) || '{}'
  || jsonb_build_object('~fork', (select rules from scoring_systems where id = pg_temp.fk(2))),
  jsonb_set(pg_temp.fork('ESPN Full PPR', '{}'), '{base}', pg_temp.pre('ESPN Full PPR') || '{"fg_60_plus": 1, "def_2pt_return": 2}')
  || jsonb_build_object('~fork', jsonb_set(pg_temp.fork('ESPN Full PPR', '{}'), '{base}', pg_temp.pre('ESPN Full PPR') || '{"fg_60_plus": 1, "def_2pt_return": 2}')),
  'F4 ESPN fork (by its fork_scoring receipt): the snapshot''s base and the fork row''s base gain both keys; positions and tier_cuts untouched');
select is(
  (select jsonb_build_object('league', l.scoring_rules_snapshot, 'week3', (select scoring_rules_snapshot from league_weeks where league_id = l.id and week = 3))
     from leagues l where l.id = pg_temp.lg(3)),
  jsonb_build_object(
    'league', jsonb_set(pg_temp.fork('ESPN Standard', '{"K": {"fg_50_plus": 6}}'), '{base}', pg_temp.pre('ESPN Standard') || '{"def_2pt_return": 2}'),
    'week3',  jsonb_set(pg_temp.fork('ESPN Standard', '{"K": {"fg_50_plus": 6}}'), '{base}', pg_temp.pre('ESPN Standard') || '{"def_2pt_return": 2}')),
  'F5 ESPN fork whose commissioner set K''s 50+ to 6: def_2pt_return is added, fg_60_plus is NOT (a 60-yarder keeps paying the 6 they chose), and the 6 is kept — league and live week');
select is(
  (select l.scoring_rules_snapshot from leagues l where l.id = pg_temp.lg(4)),
  jsonb_set(pg_temp.fork('ESPN Standard', '{}'), '{base}', pg_temp.pre('ESPN Standard') || '{"fg_60_plus": 1, "def_2pt_return": 2}'),
  'F6 a fork with NO receipt whose kicking is ESPN''s by value (3/4/5/1/-1, no PAT miss) takes both keys');
select is(
  (select jsonb_build_object('league', l.scoring_rules_snapshot, 'week3', (select scoring_rules_snapshot from league_weeks where league_id = l.id and week = 3))
     from leagues l where l.id = pg_temp.lg(5)),
  jsonb_build_object('league', pg_temp.pre('Scout Standard') || '{"def_2pt_return": 2}',
                     'week3',  pg_temp.pre('Scout Standard') || '{"def_2pt_return": 2}'),
  'F7 Scout template league: def_2pt_return ONLY (Q2), league and live week — no fg_60_plus');
select is(
  (select l.scoring_rules_snapshot || jsonb_build_object('~fork', (select rules from scoring_systems where id = pg_temp.fk(6))) from leagues l where l.id = pg_temp.lg(6)),
  jsonb_set(pg_temp.fork('Scout PPR', '{}'), '{base}', pg_temp.pre('Scout PPR') || '{"def_2pt_return": 2}')
  || jsonb_build_object('~fork', jsonb_set(pg_temp.fork('Scout PPR', '{}'), '{base}', pg_temp.pre('Scout PPR') || '{"def_2pt_return": 2}')),
  'F8 Scout fork (by receipt), DRAFTING: def_2pt_return only, snapshot and fork row');
select is(
  (select l.scoring_rules_snapshot from leagues l where l.id = pg_temp.lg(7)),
  jsonb_set(pg_temp.fork('Scout Standard', '{}'), '{base}', pg_temp.pre('Scout Standard') || '{"def_2pt_return": 2}'),
  'F9 a fork with NO receipt whose D/ST is Scout''s by value (its kicking is not ESPN''s): def_2pt_return only');
select is(
  (select l.scoring_rules_snapshot from leagues l where l.id = pg_temp.lg(18)),
  jsonb_set(pg_temp.fork('Scout Standard', '{"K": {"fg_50_plus": 5}}'), '{base}', pg_temp.pre('Scout Standard') || '{"def_2pt_return": 2}'),
  'F9b a Scout fork whose commissioner set K''s 50+ to 5 still gets NO fg_60_plus — the 60+ top-up is ESPN''s alone; def_2pt_return only');
select is(
  (select count(*)::int from (
     select 1 from leagues l join pre170 p on p.kind = 'league' and p.id = l.id::text
      where l.id in (pg_temp.lg(8), pg_temp.lg(9), pg_temp.lg(10), pg_temp.lg(11), pg_temp.lg(12), pg_temp.lg(16)) and to_jsonb(l) = p.row
     union all
     select 1 from league_weeks lw join pre170 p on p.kind = 'week' and p.id = lw.league_id::text || ':' || lw.week
      where lw.league_id in (pg_temp.lg(8), pg_temp.lg(9)) and to_jsonb(lw) = p.row
     union all
     select 1 from scoring_systems s join pre170 p on p.kind = 'fork' and p.id = s.id::text
      where s.id in (pg_temp.fk(9), pg_temp.fk(15)) and to_jsonb(s) = p.row) x),
  10,
  'F10 BYTE-UNTOUCHED: the Yahoo league and the Sleeper fork league (rows, live weeks, the Sleeper fork), the archived, complete and 2025 leagues, the complete league sharing fork 15, and fork 15 itself (shared with a league outside the change) — 6 leagues + 2 weeks + 2 forks');
select is(
  (select jsonb_build_object('league13', l.scoring_rules_snapshot,
                             'week3', (select lw.scoring_rules_snapshot || jsonb_build_object('~scout', lw.scoring_system_id = pg_temp.tpl('Scout Standard'))
                                        from league_weeks lw where lw.league_id = l.id and lw.week = 3),
                             'league15', (select scoring_rules_snapshot from leagues where id = pg_temp.lg(15)))
     from leagues l where l.id = pg_temp.lg(13)),
  jsonb_build_object('league13', pg_temp.pre('ESPN Standard') || '{"fg_60_plus": 1, "def_2pt_return": 2}',
                     'week3', pg_temp.pre('Scout Standard') || '{"def_2pt_return": 2, "~scout": true}',
                     'league15', jsonb_set(pg_temp.fork('ESPN Standard', '{}'), '{base}', pg_temp.pre('ESPN Standard') || '{"fg_60_plus": 1, "def_2pt_return": 2}')),
  'F11 EACH DOCUMENT ON ITS OWN: league 13''s snapshot (ESPN now) takes both keys, its live week (still Scout) takes def_2pt_return only; league 15''s snapshot takes both though its shared fork row is kept');
select is(
  (select string_agg(right(c.league_id::text, 2) || ' ' || c.message, ' | ' order by c.league_id)
     from league_chat c where c.league_id in (select id from leagues where name like 'pgtap-170-L%')),
  '01 Scoring update from Week 3 on: a field goal of 60+ yards pays 1 more point (6 in all), and a D/ST two-point return pays 2, matching ESPN. Finished weeks keep their scoring.'
  || ' | 02 Scoring update from Week 3 on: a field goal of 60+ yards pays 1 more point (6 in all), and a D/ST two-point return pays 2, matching ESPN. Finished weeks keep their scoring.'
  || ' | 03 Scoring update from Week 3 on: a D/ST two-point return pays 2 points. Finished weeks keep their scoring.'
  || ' | 04 Scoring update from the next week on: a field goal of 60+ yards pays 1 more point (6 in all), and a D/ST two-point return pays 2, matching ESPN. Finished weeks keep their scoring.'
  || ' | 05 Scoring update from Week 3 on: a D/ST two-point return pays 2 points. Finished weeks keep their scoring.'
  || ' | 06 Scoring update from Week 1 on: a D/ST two-point return pays 2 points. Finished weeks keep their scoring.'
  || ' | 07 Scoring update from Week 3 on: a D/ST two-point return pays 2 points. Finished weeks keep their scoring.'
  || ' | 13 Scoring update from Week 4 on: a field goal of 60+ yards pays 1 more point (6 in all), and a D/ST two-point return pays 2, matching ESPN. Finished weeks keep their scoring.'
  || ' | 15 Scoring update from the next week on: a field goal of 60+ yards pays 1 more point (6 in all), and a D/ST two-point return pays 2, matching ESPN. Finished weeks keep their scoring.'
  || ' | 18 Scoring update from the next week on: a D/ST two-point return pays 2 points. Finished weeks keep their scoring.',
  'F12 EXACTLY ONE post per rewritten league, in plain words naming the week the rule starts (the live week when it took the same keys; else the next to open — league 2 on a Tuesday, league 13 whose live week is on Scout; a drafting league Week 1) — and NONE in the Yahoo, Sleeper, archived, complete or 2025 leagues');
select is(
  (select count(*)::int from league_chat c where c.league_id in (select id from leagues where name like 'pgtap-170-L%')
     and (c.user_id is not null or not c.is_system or c.context <> 'league')),
  0, 'F13 …each is a system line (no author, is_system, the league context): 212 / 216''s shape');
select is(
  (select count(*)::int from commissioner_actions a where a.league_id in (select id from leagues where name like 'pgtap-170-L%') and a.action_type <> 'fork_scoring'),
  0, 'F14 NO commissioner_actions row: a migration has no actor (160''s precedent) — the migration, its NOTICE and the post are the record');
select is(
  (select jsonb_build_object(
     'rewritten', (select jsonb_agg(right(x ->> 'league_id', 2) order by x ->> 'league_id') from jsonb_array_elements(v -> 'rewritten') x where x ->> 'league_id' like 'e1700000-%'),
     'kept',      (select jsonb_agg(right(x ->> 'league_id', 2) || ':' || (x #>> '{league,descent}') order by x ->> 'league_id') from jsonb_array_elements(v -> 'kept') x where x ->> 'league_id' like 'e1700000-%'),
     'archived',  (select jsonb_agg(right(x #>> '{}', 2)) from jsonb_array_elements(v -> 'archived_untouched') x where x #>> '{}' like 'e1700000-%'),
     'outside',   (v -> 'outside_the_change') @> '{"complete": 2, "season 2025": 1}')
   from r170),
  '{"rewritten": ["01", "02", "03", "04", "05", "06", "07", "13", "15", "18"], "kept": ["08:other", "09:other", "17:espn"], "archived": ["10"], "outside": true}'::jsonb,
  'F15 the NOTICE''s record: the leagues rewritten, the leagues kept (Yahoo and Sleeper descent: other; league 17, ESPN, already holding both keys), the archived league named untouched, and the complete / 2025 leagues counted outside the change');
select is(
  (select count(*)::int from (
     select 1 from leagues l join pre170 p on p.kind = 'league' and p.id = l.id::text where l.id = pg_temp.lg(17) and to_jsonb(l) = p.row
     union all
     select 1 from scoring_systems s join pre170 p on p.kind = 'fork' and p.id = s.id::text where s.id = pg_temp.fk(17) and to_jsonb(s) = p.row) x)
  || ':' || (select count(*) from league_chat where league_id = pg_temp.lg(17))
  || ':' || (select (scoring_rules_snapshot #>> '{base,def_2pt_return}') || '/' || (scoring_rules_snapshot #>> '{positions,K,fg_60_plus}') from leagues where id = pg_temp.lg(17)),
  '2:0:3/2',
  'F16 NEVER OVERWRITE: a document already holding either key at its commissioner''s own value (base def_2pt_return 3, K''s 60+ top-up 2) is left byte-identical — league and fork — and gets no post');

-- ---------------------------------------------------------------------------
-- G. 218 (e) THE RE-QUEUE, AND A SECOND RUN
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(f.week || ':' || f.player_id || ':' || to_char(f.enqueued_at at time zone 'UTC', 'HH24:MI'), ',' order by f.week, f.player_id)
     from score_fanout f where f.season = 2026 and f.week in (2, 3)),
  '3:p170-d1:20:20,3:p170-k1:20:10',
  'G1 the rewritten live week''s lines holding either stat are re-queued at their own updated_at (149''s shape) — the line with neither, and the correction-window week''s 60-yarder, are not');
select is((select (v ->> 'requeued_lines')::int || ':' || (v -> 'requeued_weeks')::text from r170), '2:[{"week": 3, "season": 2026}]',
  'G2 …and the run reports the 2 lines and the one week');
select is(
  (select jsonb_array_length(v -> 'rewritten') from (select public.long_fg_two_point_rules_add_internal() v) x),
  0, 'G3 a SECOND run rewrites nothing (only absent keys are ever added)…');
select is(
  (select count(*)::int from league_chat c where c.league_id in (select id from leagues where name like 'pgtap-170-L%')),
  10, 'G4 …and posts nothing more: still the ten posts');

select * from finish();
rollback;
