-- ============================================================================
-- pgTAP 115 — migration 167: STAT-CORRECTION EVENTS + THE ONE-TRANSACTION
-- INGEST DOOR (M6 task L.E2.1, FULL rigour — scoring inputs and the
-- production stats poll; tasks-M6 TD2 / TD3; PROGRESS F267 / F268 / D432;
-- spec §12.21 / §23.4).
--
--   §A  form: the table (columns, CHECKs, the natural key, the FK), its two
--       indexes, RLS + the ONE SELECT policy, the door (DEFINER, search_path
--       empty, REVOKEd, service role keeps EXECUTE, one overload, the body a
--       STORED-LITERAL md5), no other body replaced (158''s scoring door md5
--       unchanged — it still refuses a final week), no TRUNCATE.
--   §C  THE DOOR: a first line is written, stamped and queued with no event;
--       a correction writes one event per MOVED key (old from the stored
--       line, new from the line written; a named key that did not move is
--       counted, not recorded), re-stamps the queue and clears its deferral
--       (the lease pair untouched); a metaOnly line is written and not
--       queued; a REPLAYED batch records nothing twice (the natural key); a
--       gap filled late records from NULL; the week state at detection
--       (window boundary D146 pair; a live game; a league week still open);
--       THE TRANSACTION (a failing enqueue rolls the line and the events
--       back); the table''s own CHECKs; every malformed batch refused by
--       name, nothing written.
--   §B  per role (anon, a signed-in user, the service role): SELECT, NO
--       write with RETURNING counts; the door refused to anon and to a
--       signed-in user (REVOKE), refused in-body to a JWT-bearing caller,
--       run by the service role.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(73);

-- ---------------------------------------------------------------------------
-- A. FORM
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position)
   from information_schema.columns where table_schema = 'public' and table_name = 'stat_correction_events'),
  'id:uuid:NO,season:integer:NO,week:integer:NO,player_id:text:NO,stat_key:text:NO,old_value:numeric:YES,new_value:numeric:YES,detected_at:timestamp with time zone:NO,applied_at:timestamp with time zone:YES,game_id:text:YES,week_state:text:NO,source:text:NO',
  'A1 stat_correction_events: the §12.21 columns plus game_id, week_state, source (C80); detected_at NOT NULL with no default (the door stamps p_now)');
select is(
  (select string_agg(pg_get_constraintdef(c.oid), ' | ' order by c.contype, c.conname) from pg_constraint c
   where c.conrelid = 'public.stat_correction_events'::regclass),
  'CHECK ((old_value IS DISTINCT FROM new_value)) | CHECK ((btrim(source) <> ''''::text)) | CHECK ((stat_key ~ ''^[a-z0-9_]{1,64}$''::text)) | '
  'CHECK (((week >= 1) AND (week <= 22))) | CHECK ((week_state = ANY (ARRAY[''open''::text, ''final''::text]))) | '
  'FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE | PRIMARY KEY (id) | UNIQUE (season, week, player_id, stat_key, detected_at)',
  'A2 five CHECKs (a moved value, a provider, a canonical key, a week, open / final), the player FK (cascades as player_stats does), the NATURAL KEY');
select is(
  (select string_agg(indexname, ',' order by indexname) from pg_indexes where schemaname = 'public' and tablename = 'stat_correction_events'),
  'idx_stat_corrections_week,stat_correction_events_natural_key,stat_correction_events_pkey',
  'A3 §12.21''s week index, the natural key, the PK');
select is(
  (select relrowsecurity::text || ':' || (select string_agg(polname || '=' || polcmd::text || '=' || pg_get_expr(polqual, polrelid), ',') from pg_policy where polrelid = c.oid)
   from pg_class c where c.oid = 'public.stat_correction_events'::regclass),
  'true:Stat corrections viewable by signed-in users=r=(auth.role() = ''authenticated''::text)',
  'A4 RLS on, exactly ONE policy and it is SELECT for signed-in users (NFL data, the player_stats shape) — no write policy for any role');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
          and not has_function_privilege('anon', p.oid, 'EXECUTE')
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
          and has_function_privilege('service_role', p.oid, 'EXECUTE')
   from pg_proc p where p.oid = 'public.ingest_write_batch(jsonb, timestamptz)'::regprocedure),
  'A5 ingest_write_batch: SECURITY DEFINER, search_path empty, REVOKEd from anon and authenticated, EXECUTE kept by the service role');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'ingest_write_batch'),
  1, 'A6 one overload');
select is(
  (select md5(prosrc) from pg_proc where oid = 'public.ingest_write_batch(jsonb, timestamptz)'::regprocedure),
  '097b59192ea1e4b0e1755ec34d36c843',
  'A7 the door''s body is 167''s — a STORED-LITERAL md5');
select is(
  (select md5(prosrc) from pg_proc where oid = 'public.score_write_week_batch(uuid,integer,jsonb)'::regprocedure),
  '548958d0a402c352c91c23fa924a2a0f',
  'A8 no other body replaced: the scoring door is still 158''s byte for byte (pgTAP 106 A7) — a final week is still refused by name');
select ok(
  not has_table_privilege('anon', 'public.stat_correction_events', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.stat_correction_events', 'TRUNCATE')
  and (select count(*) from pg_trigger where tgrelid = 'public.stat_correction_events'::regclass and not tgisinternal) = 0,
  'A9 no TRUNCATE for anon or authenticated (133''s default ACL); no trigger on the table');

-- ---------------------------------------------------------------------------
-- FIXTURES (postgres context, JWT cleared). Season 2093 — its own calendar:
-- week 1''s window ends at week 2''s first kickoff (158''s trigger).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
insert into nfl_weeks (season, week, starts_at, first_kickoff_at, last_game_ends_at, correction_window_ends_at) values
 (2093, 1, '2093-09-09T04:00:00Z', '2093-09-13T17:00:00Z', '2093-09-15T07:00:00Z', '2093-09-17T10:00:00Z'),
 (2093, 2, '2093-09-16T04:00:00Z', '2093-09-18T00:15:00Z', null, '2093-09-24T10:00:00Z');
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('pgtap-sce-g1', 2093, 1, 'SCA', 'SCB', '2093-09-13T17:00:00Z', 'final');
insert into players (id, full_name, position, team, status) values
 ('pgtap-sce-w1', 'SCE WR One', 'WR', 'SCA', 'Active'),
 ('pgtap-sce-w2', 'SCE WR Two', 'WR', 'SCB', 'Active'),
 ('pgtap-sce-k1', 'SCE K One', 'K', 'SCA', 'Active');
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '9f700000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
        'pgtap-sce1@fieldscout.local', 'x', now(), '{"provider": "email", "providers": ["email"]}', '{"username": "sce_user1"}', now(), now());
insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week, faab_budget,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings)
select l.id::uuid, '9f700000-0000-4000-8000-000000000001', l.name, 2093, l.status, 8, 10, 0, 11, 100,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', '{"schedule_mode": "h2h"}',
       '{"starting_slots": [{"key": "wr", "label": "WR", "eligible": ["WR"], "count": 2}], "bench": 3, "ir_slots": [], "swap_spots": 0}'
from (values ('b9700000-0000-4000-8000-00000000000a', 'pgtap-sce-LA', 'in_season'),   -- week 1 FINAL
             ('b9700000-0000-4000-8000-00000000000b', 'pgtap-sce-LB', 'complete')) l(id, name, status);  -- a leftover OPEN week 1
insert into league_weeks (league_id, season, week, status) values
 ('b9700000-0000-4000-8000-00000000000a', 2093, 1, 'final'),
 ('b9700000-0000-4000-8000-00000000000b', 2093, 1, 'correction_window');

select is((select correction_window_ends_at from nfl_weeks where season = 2093 and week = 1), '2093-09-18T00:15:00Z'::timestamptz,
  'C0 (premise) week 1''s window ends at week 2''s first kickoff');

-- The ingest surface of one line (what ingestWeek sends, minus the box columns it does not need here).
create function pg_temp.line(p_player text, p_rec int, p_yds int, p_adv jsonb default '{}', p_source text default 'fixture', p_live boolean default false)
returns jsonb language sql as $ln$
  select jsonb_build_object('player_id', p_player, 'season', 2093, 'week', 1, 'stat_type', 'weekly', 'game_id', 'pgtap-sce-g1',
                            'is_live', p_live, 'source', p_source, 'advanced', p_adv, 'receptions', p_rec, 'receiving_yards', p_yds,
                            'receiving_tds', 0);
$ln$;
create function pg_temp.ev() returns text language sql as $ev$
  select coalesce(string_agg(player_id || ':' || stat_key || ' ' || coalesce(old_value::text, 'null') || '>' || coalesce(new_value::text, 'null')
                             || ' ' || week_state || ' ' || source || ' ' || coalesce(game_id, 'null') || ' @' || to_char(detected_at at time zone 'UTC', 'MM-DD"T"HH24:MI'),
                             ', ' order by detected_at, player_id, stat_key), 'none')
  from stat_correction_events where player_id like 'pgtap-sce-%';
$ev$;

-- ---------------------------------------------------------------------------
-- C. THE DOOR
-- ---------------------------------------------------------------------------
-- C1 a first line: written, stamped p_now, queued — no correction named, no event.
select is(
  public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w1', 5, 97), 'enqueue', true, 'corrections', '[]'::jsonb)),
                            '2093-09-13T20:00:00Z'),
  '{"week": 1, "season": 2093, "enqueued": 1, "received": 1, "restamped": 0, "week_state": null, "stats_written": 1, "events_written": 0, "events_replayed": 0, "events_unchanged": 0}'::jsonb,
  'C1 a first line: one line written, one delta enqueued, no event (none named — week_state is only computed for corrections)');
select is(
  (select receptions || '/' || receiving_yards || '/' || source || '/' || is_live::text || '/' || game_id || '/' || updated_at::text from player_stats where player_id = 'pgtap-sce-w1' and season = 2093),
  '5/97/fixture/false/pgtap-sce-g1/2093-09-13 20:00:00+00', 'C2 …the line is the one sent, stamped p_now (never the wall clock)');
select is(
  (select enqueued_at::text || '/' || coalesce(deferred_until::text, 'null') from score_fanout where player_id = 'pgtap-sce-w1' and season = 2093),
  '2093-09-13 20:00:00+00/null', 'C3 …its queue row carries the SAME instant (the readiness predicate true by construction, F218)');
select is(pg_temp.ev(), 'none', 'C4 …and no event');

-- Hold the queue row the way the worker would (a lease + a deferral) before the correction.
update score_fanout set deferred_until = '2093-09-14T00:00:00Z', claimed_at = '2093-09-13T21:00:00Z', claim_token = '5e700000-0000-4000-8000-0000000000c1'
 where player_id = 'pgtap-sce-w1' and season = 2093;

-- C5 THE CORRECTION (Tuesday, window open): 97 > 95 moves, receptions is NAMED but did not move, an advanced key arrives.
select is(
  public.ingest_write_batch(jsonb_build_array(jsonb_build_object(
     'stat', pg_temp.line('pgtap-sce-w1', 5, 95, '{"example_tracking_yards": 3}'), 'enqueue', true,
     'corrections', '[{"stat_key": "receiving_yards", "column": "receiving_yards"}, {"stat_key": "receptions", "column": "receptions"}, {"stat_key": "example_tracking_yards", "advanced": true}]'::jsonb)),
    '2093-09-15T16:00:00Z'),
  '{"week": 1, "season": 2093, "enqueued": 0, "received": 1, "restamped": 1, "week_state": "open", "stats_written": 1, "events_written": 2, "events_replayed": 0, "events_unchanged": 1}'::jsonb,
  'C5 a correction: TWO events (the moved box column, the arrived advanced key), the unmoved named key counted not recorded, the queue row re-stamped, week open');
select is(pg_temp.ev(),
  'pgtap-sce-w1:example_tracking_yards null>3 open fixture pgtap-sce-g1 @09-15T16:00, pgtap-sce-w1:receiving_yards 97>95 open fixture pgtap-sce-g1 @09-15T16:00',
  'C6 …each event: OLD from the stored line, NEW from the line written, the game, the provider, detected at p_now, in the canonical key');
select is(
  (select enqueued_at::text || '/' || coalesce(deferred_until::text, 'null') || '/' || claimed_at::text || '/' || claim_token::text from score_fanout where player_id = 'pgtap-sce-w1' and season = 2093),
  '2093-09-15 16:00:00+00/null/2093-09-13 21:00:00+00/5e700000-0000-4000-8000-0000000000c1',
  'C7 …the queue row re-stamped to the correction''s instant (D321(2)), its deferral CLEARED (122), the lease pair UNTOUCHED (121)');
select is((select receiving_yards || '/' || advanced::text || '/' || updated_at::text from player_stats where player_id = 'pgtap-sce-w1' and season = 2093),
  '95/{"example_tracking_yards": 3}/2093-09-15 16:00:00+00', 'C8 …and the line moved with them (research stays right)');

-- C9 metaOnly: a provenance-only rewrite of w1 is written, NOT enqueued, no event; a live line of w2 is enqueued, no event.
delete from score_fanout where player_id = 'pgtap-sce-w1' and season = 2093;
select is(
  public.ingest_write_batch(jsonb_build_array(
     jsonb_build_object('stat', pg_temp.line('pgtap-sce-w1', 5, 95, '{"example_tracking_yards": 3}', 'fixture:renamed'), 'enqueue', false, 'corrections', '[]'::jsonb),
     jsonb_build_object('stat', pg_temp.line('pgtap-sce-w2', 2, 20), 'enqueue', true, 'corrections', '[]'::jsonb)),
    '2093-09-15T17:00:00Z') - 'week_state',
  '{"week": 1, "season": 2093, "enqueued": 1, "received": 2, "restamped": 0, "stats_written": 2, "events_written": 0, "events_replayed": 0, "events_unchanged": 0}'::jsonb,
  'C9 a metaOnly line and an ordinary delta in one batch: both written, only the delta queued, no event');
select is((select string_agg(player_id, ',' order by player_id) from score_fanout where player_id like 'pgtap-sce-%'), 'pgtap-sce-w2',
  'C10 …the metaOnly line is not in the queue');
select is((select source from player_stats where player_id = 'pgtap-sce-w1' and season = 2093), 'fixture:renamed', 'C11 …but it IS written (F13 provenance)');

-- C12 THE NATURAL KEY: put the stored yards back to 97 by hand, then REPLAY C5''s batch at C5''s instant —
-- the transition is the same one, at the same instant: recorded ONCE.
update player_stats set receiving_yards = 97 where player_id = 'pgtap-sce-w1' and season = 2093;
select is(
  public.ingest_write_batch(jsonb_build_array(jsonb_build_object(
     'stat', pg_temp.line('pgtap-sce-w1', 5, 95, '{"example_tracking_yards": 3}'), 'enqueue', true,
     'corrections', '[{"stat_key": "receiving_yards", "column": "receiving_yards"}, {"stat_key": "receptions", "column": "receptions"}, {"stat_key": "example_tracking_yards", "advanced": true}]'::jsonb)),
    '2093-09-15T16:00:00Z') - 'week_state' - 'enqueued' - 'restamped',
  '{"week": 1, "season": 2093, "received": 1, "stats_written": 1, "events_written": 0, "events_replayed": 1, "events_unchanged": 2}'::jsonb,
  'C12 a REPLAYED batch records nothing twice: the moved key hits the natural key (replayed 1), the others are unchanged at write');
select is((select count(*)::int from stat_correction_events where player_id like 'pgtap-sce-%'), 2, 'C13 …still exactly two events');

-- C14 a gap filled late (F269(a)): a FIRST line for the kicker of a final game — every named key records from NULL.
select is(
  public.ingest_write_batch(jsonb_build_array(jsonb_build_object(
     'stat', jsonb_build_object('player_id', 'pgtap-sce-k1', 'season', 2093, 'week', 1, 'stat_type', 'weekly', 'game_id', 'pgtap-sce-g1',
                                'is_live', false, 'source', 'fixture', 'advanced', '{}'::jsonb, 'fg_made', 1, 'xp_made', 2),
     'enqueue', true,
     'corrections', '[{"stat_key": "fg_made", "column": "fg_made"}, {"stat_key": "pat_made", "column": "xp_made"}]'::jsonb)),
    '2093-09-15T19:00:00Z') ->> 'events_written',
  '2', 'C14 a gap filled late: both named keys recorded');
select is(
  (select string_agg(stat_key || ' ' || coalesce(old_value::text, 'null') || '>' || new_value::text, ', ' order by stat_key) from stat_correction_events where player_id = 'pgtap-sce-k1'),
  'fg_made null>1, pat_made null>2', 'C15 …from NULL (no line stored), under the CANONICAL key (pat_made, stored in xp_made — D33)');

-- C15b / C15c (R1317): a STORED line's NULL box column is the column's DEFAULT (0) — what the scorer and
-- ingestWeek's readStats read, so the event agrees with the poll's report — EXCEPT a column with no default
-- (143's def_yards_allowed: NULL is "not delivered", F390), which stays NULL.
update player_stats set fg_made = null, def_yards_allowed = null where player_id = 'pgtap-sce-k1' and season = 2093;
select is(
  public.ingest_write_batch(jsonb_build_array(jsonb_build_object(
     'stat', jsonb_build_object('player_id', 'pgtap-sce-k1', 'season', 2093, 'week', 1, 'stat_type', 'weekly', 'game_id', 'pgtap-sce-g1',
                                'is_live', false, 'source', 'fixture', 'advanced', '{}'::jsonb, 'fg_made', 2, 'xp_made', 2, 'def_yards_allowed', 300),
     'enqueue', true,
     'corrections', '[{"stat_key": "fg_made", "column": "fg_made"}, {"stat_key": "def_yards_allowed", "column": "def_yards_allowed"}]'::jsonb)),
    '2093-09-15T20:00:00Z') ->> 'events_written',
  '2', 'C15b a stored NULL moved: both keys recorded');
select is(
  (select string_agg(stat_key || ' ' || coalesce(old_value::text, 'null') || '>' || new_value::text, ', ' order by stat_key)
     from stat_correction_events where player_id = 'pgtap-sce-k1' and detected_at = '2093-09-15T20:00:00Z'),
  'def_yards_allowed null>300, fg_made 0>2',
  'C15c …a defaulted column''s stored NULL is recorded as its DEFAULT 0 (as readStats reads it); def_yards_allowed (no default — not delivered) stays NULL');

-- C16 THE WEEK STATE — the window''s end, the D146 pair: one second before it is open …
select is(
  public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w2', 2, 21), 'enqueue', true,
     'corrections', '[{"stat_key": "receiving_yards", "column": "receiving_yards"}]'::jsonb)), '2093-09-18T00:14:59Z') ->> 'week_state',
  'open', 'C16 one second before the window closes: open');
-- … AT its end, every game final and the one league''s week final: final (no league can re-score it — recorded only).
select is(
  public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w2', 2, 22), 'enqueue', true,
     'corrections', '[{"stat_key": "receiving_yards", "column": "receiving_yards"}]'::jsonb)), '2093-09-18T00:15:00Z') ->> 'week_state',
  'final', 'C17 AT the window''s end, all games final, every in-season league''s week final (a complete league''s leftover open week ignored): final');
-- (C17''s LB is a COMPLETE league: its leftover open week 1 did not count.) An IN-SEASON league whose week is
-- still open (held on pending scores / not yet finalized) keeps it open …
update leagues set status = 'in_season' where id = 'b9700000-0000-4000-8000-00000000000b';
select is(
  public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w2', 2, 23), 'enqueue', true,
     'corrections', '[{"stat_key": "receiving_yards", "column": "receiving_yards"}]'::jsonb)), '2093-09-19T12:00:00Z') ->> 'week_state',
  'open', 'C18 past the window, a league''s week still open: open (finality governs, not the clock — TD4)');
-- … but not once that league is no longer in season.
update leagues set status = 'complete' where id = 'b9700000-0000-4000-8000-00000000000b';
select is(
  public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w2', 2, 24), 'enqueue', true,
     'corrections', '[{"stat_key": "receiving_yards", "column": "receiving_yards"}]'::jsonb)), '2093-09-19T12:01:00Z') ->> 'week_state',
  'final', 'C19 …a complete league''s leftover open week does not (the worker only scores in_season / playoffs leagues)');
-- A game of the week not yet final (postponed within the week, Q82 / E43) keeps it open past the window.
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values ('pgtap-sce-g2', 2093, 1, 'SCC', 'SCD', '2093-09-20T17:00:00Z', 'scheduled');
select is(
  public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w2', 2, 25), 'enqueue', true,
     'corrections', '[{"stat_key": "receiving_yards", "column": "receiving_yards"}]'::jsonb)), '2093-09-19T12:02:00Z') ->> 'week_state',
  'open', 'C20 past the window, a game of the week still to play: open');
delete from nfl_games where id = 'pgtap-sce-g2';
-- finalize_matchups' OWN test decides what is still in the week (116's week_games_state_internal): a game
-- POSTPONED within the week (kickoff before week 2 starts) still holds it open …
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values ('pgtap-sce-g3', 2093, 1, 'SCE', 'SCF', '2093-09-15T23:00:00Z', 'postponed');
select is(
  public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w2', 2, 26), 'enqueue', true,
     'corrections', '[{"stat_key": "receiving_yards", "column": "receiving_yards"}]'::jsonb)), '2093-09-19T12:03:00Z') ->> 'week_state',
  'open', 'C20b a game postponed WITHIN the week (still in it — §23.4''s held week): open');
-- … and once its kickoff moves past the next week's start it has LEFT the week (E43): final.
update nfl_games set kickoff_at = '2093-09-16T04:00:00Z' where id = 'pgtap-sce-g3';
select is(
  public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w2', 2, 27), 'enqueue', true,
     'corrections', '[{"stat_key": "receiving_yards", "column": "receiving_yards"}]'::jsonb)), '2093-09-19T12:04:00Z') ->> 'week_state',
  'final', 'C20c …postponed to exactly the next week''s start: it has left the week — final (the D146 instant)');
delete from nfl_games where id = 'pgtap-sce-g3';
select is(
  (select string_agg(old_value::text || '>' || new_value::text || ' ' || week_state, ', ' order by detected_at) from stat_correction_events where player_id = 'pgtap-sce-w2'),
  '20>21 open, 21>22 final, 22>23 open, 23>24 final, 24>25 open, 25>26 open, 26>27 final', 'C21 …each event carries the state it was detected in');

-- C22 THE TRANSACTION: an enqueue that fails rolls the line AND the events back (nothing half-written).
create function pg_temp.boom() returns trigger language plpgsql as $b$ begin raise exception 'pgtap: the enqueue fails'; end $b$;
create trigger pgtap_boom before insert on score_fanout for each row execute function pg_temp.boom();
select throws_ok(
  $$ select public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w1', 5, 90), 'enqueue', true,
       'corrections', '[{"stat_key": "receiving_yards", "column": "receiving_yards"}]'::jsonb)), '2093-09-20T12:00:00Z') $$,
  'P0001', 'pgtap: the enqueue fails', 'C22 a failing enqueue fails the whole call');
drop trigger pgtap_boom on score_fanout;
select is((select receiving_yards || '/' || updated_at::text from player_stats where player_id = 'pgtap-sce-w1' and season = 2093),
  '95/2093-09-15 16:00:00+00', 'C23 …the line is NOT moved (still C12''s replayed state and its stamp)');
select is((select count(*)::int from stat_correction_events where player_id = 'pgtap-sce-w1' and detected_at = '2093-09-20T12:00:00Z'), 0,
  'C24 …and no event was recorded');

-- C25 the table''s own guards (as postgres, bypassing the door).
select throws_ok(
  $$ insert into stat_correction_events (season, week, player_id, stat_key, old_value, new_value, detected_at, week_state, source)
     values (2093, 1, 'pgtap-sce-w1', 'receiving_yards', 97, 95, '2093-09-15T16:00:00Z', 'open', 'fixture') $$,
  '23505', null, 'C25 the natural key refuses a second row for the same (season, week, player, key, instant)');
select throws_ok(
  $$ insert into stat_correction_events (season, week, player_id, stat_key, old_value, new_value, detected_at, week_state, source)
     values (2093, 1, 'pgtap-sce-w1', 'receiving_yards', 95, 95, '2093-09-21T00:00:00Z', 'open', 'fixture') $$,
  '23514', null, 'C26 an event that moved nothing is refused (old = new)');
select throws_ok(
  $$ insert into stat_correction_events (season, week, player_id, stat_key, old_value, new_value, week_state, source)
     values (2093, 1, 'pgtap-sce-w1', 'receiving_yards', 95, 96, 'open', 'fixture') $$,
  '23502', null, 'C27 no detection instant, no row — the column has no wall-clock default');

-- C28… every malformed batch is refused BY NAME (22023) and writes nothing.
select set_config('pgtap.before', (select count(*) from stat_correction_events)::text || '/' || (select count(*) from player_stats where season = 2093)::text, true);
select throws_ok($$ select public.ingest_write_batch(null, '2093-09-20T12:00:00Z') $$, '22023', 'ingest_write_batch: p_rows and p_now are required', 'C28 null rows');
select throws_ok($$ select public.ingest_write_batch('[]', null) $$, '22023', 'ingest_write_batch: p_rows and p_now are required', 'C29 no instant (time only via p_now)');
select throws_ok($$ select public.ingest_write_batch('{}', '2093-09-20T12:00:00Z') $$, '22023', 'ingest_write_batch: p_rows must be a JSON array of {stat, enqueue, corrections} (got object)', 'C30 not an array');
select throws_ok($$ select public.ingest_write_batch('[]', '2093-09-20T12:00:00Z') $$, '22023', 'ingest_write_batch: p_rows is empty — a batch carries at least one line', 'C31 empty');
select throws_ok($$ select public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w1', 1, 1), 'corrections', '[]'::jsonb)), '2093-09-20T12:00:00Z') $$,
  '22023', 'ingest_write_batch: element 1 must be {stat: object, enqueue: boolean, corrections: array}', 'C32 an element without its enqueue flag');
select throws_ok($$ select public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w1', 1, 1) || '{"updated_at": "2093-09-20T12:00:00Z"}', 'enqueue', true, 'corrections', '[]'::jsonb)), '2093-09-20T12:00:00Z') $$,
  '22023', 'ingest_write_batch: element 1 carries key(s) the door does not write: updated_at (id and updated_at are the table''s and the door''s; every other key must be a player_stats column)', 'C33 a caller-supplied updated_at (the door stamps p_now)');
select throws_ok($$ select public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w1', 1, 1) || '{"bogus; drop table players": 1}', 'enqueue', true, 'corrections', '[]'::jsonb)), '2093-09-20T12:00:00Z') $$,
  '22023', 'ingest_write_batch: element 1 carries key(s) the door does not write: bogus; drop table players (id and updated_at are the table''s and the door''s; every other key must be a player_stats column)', 'C34 a key that is not a player_stats column (never interpolated)');
select throws_ok($$ select public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w1', 1, 1) - 'source', 'enqueue', true, 'corrections', '[]'::jsonb)), '2093-09-20T12:00:00Z') $$,
  '22023', 'ingest_write_batch: element 1 lacks the ingest metadata: source', 'C35 a line without its provenance');
select throws_ok($$ select public.ingest_write_batch(jsonb_build_array(
    jsonb_build_object('stat', pg_temp.line('pgtap-sce-w1', 1, 1), 'enqueue', true, 'corrections', '[]'::jsonb),
    jsonb_build_object('stat', pg_temp.line('pgtap-sce-w2', 1, 1) - 'receiving_tds', 'enqueue', true, 'corrections', '[]'::jsonb)), '2093-09-20T12:00:00Z') $$,
  '22023', 'ingest_write_batch: element 2 carries a different key set from element 1 — every line of a batch carries the same surface', 'C36 two surfaces in one batch');
select throws_ok($$ select public.ingest_write_batch(jsonb_build_array(
    jsonb_build_object('stat', pg_temp.line('pgtap-sce-w1', 1, 1), 'enqueue', true, 'corrections', '[]'::jsonb),
    jsonb_build_object('stat', pg_temp.line('pgtap-sce-w2', 1, 1) || '{"week": 2}', 'enqueue', true, 'corrections', '[]'::jsonb)), '2093-09-20T12:00:00Z') $$,
  '22023', 'ingest_write_batch: element 2 is not season 2093 week 1 — a batch is one (season, week)', 'C37 two weeks in one batch');
select throws_ok($$ select public.ingest_write_batch(jsonb_build_array(
    jsonb_build_object('stat', pg_temp.line('pgtap-sce-w1', 1, 1), 'enqueue', true, 'corrections', '[]'::jsonb),
    jsonb_build_object('stat', pg_temp.line('pgtap-sce-w1', 2, 2), 'enqueue', true, 'corrections', '[]'::jsonb)), '2093-09-20T12:00:00Z') $$,
  '22023', 'ingest_write_batch: player pgtap-sce-w1 appears twice in the batch', 'C38 a player twice');
select throws_ok($$ select public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w1', 1, 1) || '{"stat_type": "season"}', 'enqueue', true, 'corrections', '[]'::jsonb)), '2093-09-20T12:00:00Z') $$,
  '22023', 'ingest_write_batch: element 1 stat_type must be weekly', 'C39 not a weekly line');
select throws_ok($$ select public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w1', 1, 1), 'enqueue', false,
    'corrections', '[{"stat_key": "receiving_yards", "column": "receiving_yards"}]'::jsonb)), '2093-09-20T12:00:00Z') $$,
  '22023', 'ingest_write_batch: element 1 (pgtap-sce-w1) carries corrections but is not enqueued — a correction is a scoring delta', 'C40 a correction on an unqueued line');
select throws_ok($$ select public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w1', 1, 1), 'enqueue', true,
    'corrections', '[{"stat_key": "Receiving Yards", "column": "receiving_yards"}]'::jsonb)), '2093-09-20T12:00:00Z') $$,
  '22023', 'ingest_write_batch: element 1 (pgtap-sce-w1) has a correction without a canonical stat_key', 'C41 a key outside the canonical namespace');
select throws_ok($$ select public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w1', 1, 1), 'enqueue', true,
    'corrections', '[{"stat_key": "receiving_yards", "column": "receiving_yards", "advanced": true}]'::jsonb)), '2093-09-20T12:00:00Z') $$,
  '22023', 'ingest_write_batch: element 1 (pgtap-sce-w1) correction receiving_yards must name exactly one of column / advanced', 'C42 both a column and advanced');
select throws_ok($$ select public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w1', 1, 1), 'enqueue', true,
    'corrections', '[{"stat_key": "is_live", "column": "is_live"}]'::jsonb)), '2093-09-20T12:00:00Z') $$,
  '22023', 'ingest_write_batch: element 1 (pgtap-sce-w1) correction is_live names column is_live — not a stat column of this batch', 'C43 a metadata column is never a correction (metaOnly, F268)');
select throws_ok($$ select public.ingest_write_batch(jsonb_build_array(jsonb_build_object('stat', pg_temp.line('pgtap-sce-w1', 1, 1), 'enqueue', true,
    'corrections', '[{"stat_key": "rec_yd", "column": "receiving_yards"}, {"stat_key": "rec_yd", "column": "receiving_yards"}]'::jsonb)), '2093-09-20T12:00:00Z') $$,
  '22023', 'ingest_write_batch: element 1 (pgtap-sce-w1) names correction rec_yd twice', 'C44 a key named twice');
select is((select count(*) from stat_correction_events)::text || '/' || (select count(*) from player_stats where season = 2093)::text, current_setting('pgtap.before'),
  'C45 …and none of C28–C44 wrote a line or an event');

-- ---------------------------------------------------------------------------
-- B. ROLES — signed-in users read, nobody writes (RETURNING counts); the door is the service role''s
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from stat_correction_events), 0, 'B1 anon reads no events');
select results_eq($$ with w as (update stat_correction_events set new_value = 0 returning 1) select count(*) from w $$, $$ values (0::bigint) $$, 'B2 anon: UPDATE touches 0 rows');
select results_eq($$ with w as (delete from stat_correction_events returning 1) select count(*) from w $$, $$ values (0::bigint) $$, 'B3 anon: DELETE touches 0 rows');
select throws_ok($$ insert into stat_correction_events (season, week, player_id, stat_key, old_value, new_value, detected_at, week_state, source)
  values (2093, 1, 'pgtap-sce-w1', 'receptions', 1, 2, '2093-09-21T00:00:00Z', 'open', 'x') $$, '42501', null, 'B4 anon: INSERT refused (RLS, 42501)');
select throws_ok($$ select public.ingest_write_batch('[]', '2093-09-20T12:00:00Z') $$, '42501', null, 'B5 anon cannot run the door (REVOKEd)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9f700000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is((select count(*)::int from stat_correction_events where player_id like 'pgtap-sce-%'), 13, 'B6 a signed-in user reads the events (NFL data, as player_stats — research)');
select results_eq($$ with w as (update stat_correction_events set new_value = 0 returning 1) select count(*) from w $$, $$ values (0::bigint) $$, 'B7 the signed-in user: UPDATE touches 0 rows');
select results_eq($$ with w as (delete from stat_correction_events returning 1) select count(*) from w $$, $$ values (0::bigint) $$, 'B8 the signed-in user: DELETE touches 0 rows');
select throws_ok($$ insert into stat_correction_events (season, week, player_id, stat_key, old_value, new_value, detected_at, week_state, source)
  values (2093, 1, 'pgtap-sce-w1', 'receptions', 1, 2, '2093-09-21T00:00:00Z', 'open', 'x') $$, '42501', null, 'B9 the signed-in user: INSERT refused (RLS, 42501)');
select throws_ok($$ select public.ingest_write_batch('[]', '2093-09-20T12:00:00Z') $$, '42501', null, 'B10 the signed-in user cannot run the door (REVOKEd)');
reset role;
-- The in-body refusal (rule 2): a JWT reaching the door as a privileged role, and an anon claim.
select set_config('request.jwt.claims', '{"sub": "9f700000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok($$ select public.ingest_write_batch('[]', '2093-09-20T12:00:00Z') $$, '42501',
  'ingest_write_batch: the ingest write door is the stats poll''s (service role), never a signed-in or anonymous caller''s', 'B11 the door refuses a signed-in caller IN-BODY (before any shape check)');
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select public.ingest_write_batch('[]', '2093-09-20T12:00:00Z') $$, '42501',
  'ingest_write_batch: the ingest write door is the stats poll''s (service role), never a signed-in or anonymous caller''s', 'B12 …and an anon claim IN-BODY');
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select is(
  public.ingest_write_batch('[{"stat": {"player_id": "pgtap-sce-w1", "season": 2093, "week": 1, "stat_type": "weekly", "game_id": "pgtap-sce-g1", "is_live": false,
      "source": "fixture", "advanced": {}, "receptions": 5, "receiving_yards": 96, "receiving_tds": 0}, "enqueue": true,
      "corrections": [{"stat_key": "receiving_yards", "column": "receiving_yards"}]}]', '2093-09-21T12:00:00Z') ->> 'events_written',
  '1', 'B13 the SERVICE ROLE runs the door (the stats poll): 95 > 96 recorded');
select is((select count(*)::int from stat_correction_events where player_id like 'pgtap-sce-%'), 14, 'B14 …and reads every event');
reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
