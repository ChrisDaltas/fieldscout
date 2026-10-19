-- ============================================================================
-- Migration 198 — player news (F575; PROGRESS D550).
--
-- Pinned here:
--   1. Dedupe: UNIQUE (source_key, external_id) refuses a second copy of a
--      story (23505); the same external_id under ANOTHER source is a new row;
--      ON CONFLICT upsert keeps exactly one row; the link PK refuses a
--      duplicate (story, player); a bad rule / non-http url is refused.
--   2. RLS (default grants kept, no write policy): authenticated reads both
--      tables; anon sees 0 rows; INSERT is refused by RLS (42501); UPDATE /
--      DELETE touch 0 rows (RETURNING counts); TRUNCATE is refused (42501);
--      anon / authenticated INSERT refused (42501), UPDATE / DELETE touch 0
--      rows or are refused — RETURNING counts; no write policy exists.
--   3. The pg_cron job pings the route.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(22);

insert into players (id, full_name, position, team) values ('pn148-a', 'PN148 Alpha', 'WR', 'BUF');
insert into player_news (id, source_key, source_label, external_id, url, headline, published_at)
values ('00000000-0000-0000-0000-000000001481', 'espn', 'ESPN', 'guid-1', 'https://www.espn.com/a', 'PN148 Alpha scores', '2026-10-18T12:00:00Z');
insert into player_news_players (news_id, player_id, rule) values ('00000000-0000-0000-0000-000000001481', 'pn148-a', 'unique_name');

-- 1. Dedupe ------------------------------------------------------------------
select throws_ok($$ insert into player_news (source_key, source_label, external_id, url, headline, published_at)
  values ('espn', 'ESPN', 'guid-1', 'https://www.espn.com/b', 'again', now()) $$, '23505', null,
  'a second copy of (source_key, external_id) is refused');
select lives_ok($$ insert into player_news (source_key, source_label, external_id, url, headline, published_at)
  values ('cbs', 'CBS Sports', 'guid-1', 'https://www.cbssports.com/a', 'other outlet', now()) $$,
  'the same external_id under another source is a different story');
select lives_ok($$ insert into player_news (source_key, source_label, external_id, url, headline, published_at)
  values ('espn', 'ESPN', 'guid-1', 'https://www.espn.com/a', 'PN148 Alpha scores twice', '2026-10-18T12:00:00Z')
  on conflict (source_key, external_id) do update set headline = excluded.headline $$, 'the ingest upsert re-runs cleanly');
select is((select count(*)::int from player_news where source_key = 'espn' and external_id = 'guid-1'), 1, '… and still exactly one row');
select is((select id from player_news where source_key = 'espn' and external_id = 'guid-1'), '00000000-0000-0000-0000-000000001481'::uuid, '… the same row (id kept, links survive)');
select throws_ok($$ insert into player_news_players values ('00000000-0000-0000-0000-000000001481', 'pn148-a', 'name_team') $$, '23505', null,
  'a duplicate (story, player) link is refused');
select lives_ok($$ insert into player_news_players values ('00000000-0000-0000-0000-000000001481', 'pn148-a', 'name_team') on conflict do nothing $$,
  'the ingest link insert (ON CONFLICT DO NOTHING) is a no-op');
select throws_ok($$ insert into player_news (source_key, source_label, external_id, url, headline, published_at)
  values ('espn', 'ESPN', 'guid-js', 'javascript:alert(1)', 'x', now()) $$, '23514', null, 'a non-http(s) link is refused');
select throws_ok($$ insert into player_news_players (news_id, player_id, rule) select id, 'pn148-a', 'ai' from player_news where source_key = 'cbs' $$,
  '23514', null, 'a rule other than name_team / unique_name is refused');

-- 2. RLS ---------------------------------------------------------------------
set local role authenticated;
select ok((select count(*) from player_news) >= 2, 'authenticated reads player_news');
select is((select count(*)::int from player_news_players where player_id = 'pn148-a'), 1, 'authenticated reads player_news_players');
select throws_ok($$ insert into player_news (source_key, source_label, external_id, url, headline, published_at)
  values ('x', 'X', 'y', 'https://x.test', 'h', now()) $$, '42501', null, 'authenticated INSERT into player_news is refused');
select throws_ok($$ insert into player_news_players select id, 'pn148-a', 'name_team' from player_news where source_key = 'cbs' $$,
  '42501', null, 'authenticated INSERT into player_news_players is refused');
select results_eq($$ with w as (update player_news set headline = 'hacked' returning 1) select count(*) from w $$, $$ values (0::bigint) $$, 'authenticated UPDATE of player_news touches 0 rows');
select results_eq($$ with w as (delete from player_news_players returning 1) select count(*) from w $$, $$ values (0::bigint) $$, 'authenticated DELETE of player_news_players touches 0 rows');
reset role;

set local role anon;
select is((select count(*)::int from player_news), 0, 'anon sees no player_news rows');
select throws_ok($$ truncate player_news_players $$, '42501', null, 'anon TRUNCATE is refused (RLS does not gate it — the revoke does)');
select throws_ok($$ insert into player_news (source_key, source_label, external_id, url, headline, published_at)
  values ('x', 'X', 'y', 'https://x.test', 'h', now()) $$, '42501', null, 'anon INSERT is refused');
reset role;

select is((select headline from player_news where id = '00000000-0000-0000-0000-000000001481'), 'PN148 Alpha scores twice', 'the row is unchanged by every client attempt');
select is((select count(*)::int from pg_policy where polrelid in ('public.player_news'::regclass, 'public.player_news_players'::regclass) and polcmd <> 'r'), 0,
  'no write policy exists on either table');
select is((select count(*)::int from pg_policy where polrelid in ('public.player_news'::regclass, 'public.player_news_players'::regclass)), 2,
  'exactly one (SELECT) policy per table');

-- 3. Schedule ----------------------------------------------------------------
select is((select command from cron.job where jobname = 'ingest-player-news-ping'),
  'SELECT public.cron_ping_route(''/api/cron/ingest-player-news'')', 'pg_cron pings the ingest route');

select * from finish();
rollback;
