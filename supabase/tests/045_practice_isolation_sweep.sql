-- ============================================================================
-- The practice isolation sweep — MP.11 item 2 (tasks-MP §5; spec v2.16 §8.8;
-- D231(2); §4 rule 10; R383/R499's whole-row instrument, widened to the
-- whole schema).
--
-- THE CLAIM, FRAMED PER §4 RULE 10 — NAME THE PARTY BEFORE THE PROTECTION:
-- this file protects the LEAGUE PRODUCT (and every other table in the app)
-- from practice residue. It does NOT defend a mock against anybody — a mock
-- has one human and eleven bots, and there is no adversary. The assertion is
-- the delta: across a standalone mock's ENTIRE lifecycle — launch, ticks,
-- the human's own verbs, pause/resume, completion, delete — every one of the
-- 56 `public` tables comes back byte-identical, measured as a whole-row
-- digest per table (count + md5 over sorted `to_jsonb` rows), because R499
-- proved a row COUNT cannot see an in-place UPDATE and `leagues.status` /
-- `.settings` / `.updated_at` are exactly the writes §8.8 forbids and
-- exactly the ones a count sails past.
--
-- TWO HARNESSES, DELIBERATELY (tasks-MP §7 / MS.6 row): MS.6's §8.8 harness
-- measures a league-attached mock's isolation FROM ITS OWN league; this file
-- measures that a league-LESS mock's lifecycle leaks into NOTHING. Different
-- assertion, different fixture, do not merge them.
--
-- WHAT EACH SECTION CATCHES (§4.3 — a pin is named by the defect it reddens
-- on):
--   §A THE INSTRUMENT AND ITS PRECONDITIONS. The 56-table census as a stored
--      literal (a migration that adds a table must re-derive the mid-state
--      allowlist in §C — deliberately a conversation with this file), and
--      two quiescence preconditions with their reasons printed: this file
--      runs under REPEATABLE READ so the live 5s cron's concurrent commits
--      cannot move the digests between snapshots, which in exchange means a
--      committed draft that is DUE (or a scheduled league past its D94
--      auto-start instant) would be claimed by OUR tick inside the snapshot
--      — a write-conflict or a false delta, diagnosed here by name instead
--      of surfacing as an inscrutable digest mismatch ("never let 'nothing
--      happened' mean 'it worked'", inverted: never let a mystery red stand
--      for a diagnosable one).
--   §B THE LIFECYCLE, DRIVEN FOR REAL. A user in ZERO leagues launches an
--      8-seat snake mock and it is driven to COMPLETE through the real
--      engine (deadline rewinds + draft_tick — the D100 harness idiom), with
--      the launcher's own verbs exercised mid-flight: touch, a real pick,
--      pause, resume. 16 picks, status 'complete'.
--   §C THE MID-STATE DELTA IS EXACTLY THE ENGINE'S OWN TABLES. With the mock
--      complete but not yet deleted, the set of tables that moved is a
--      stored literal: the draft-family tables the engine writes plus the
--      practice seats — and NOT ONE league-product table. Reddens if any
--      live function grows a league write reachable from a standalone mock
--      (the F109 species, as a permanent assertion).
--   §D ZERO DELTA AFTER DELETE — THE HEADLINE. The launcher deletes their
--      practice; every one of the 56 tables' count AND whole-row digest
--      equals the baseline. Reddens on: a leaked bot seat (R473/D227(6)'s
--      cleanup), an orphaned chat post (the NULL-safe sweep), an in-place
--      UPDATE anywhere (R499), a new FK child of `drafts` that does not
--      cascade, a leak into ANY table this file has never heard of.
--
-- FIXTURES COME BEFORE THE BASELINE, on purpose: the fixture user's profiles
-- trigger row and the fixture players are part of the 'before' snapshot, so
-- the deltas measure the LIFECYCLE and nothing else. Fixture ADP is in the
-- fractional band (0, 1) below the real pool's minimum (D235/F110) — no
-- assertion states a premise about what the shared `players` table contains,
-- and the file is green on an empty post-reset pool and on a restored one.
--
-- Conventions: fixtures in the postgres role BEFORE any JWT claims (D49(7));
-- goldens are stored literals (§4.3); the whole file rolls back.
-- ============================================================================
begin;
-- REPEATABLE READ, and it must be the transaction's first statement: the
-- live 5s pg_cron tick is a legal concurrent actor on this database, and a
-- three-snapshot instrument is only meaningful over ONE frozen snapshot —
-- under READ COMMITTED a cron commit landing between 'before' and 'after'
-- would surface as a phantom leak in tables this file never touched.
set transaction isolation level repeatable read;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(24);

-- ---------------------------------------------------------------------------
-- Fixtures. One user, u01, in NO league (asserted below — F94). 20 players:
-- 10 QBs (0.601…0.610), 10 RBs (0.611…0.620); the mock's roster is
-- {QB:1, bench:1} over 8 seats ⇒ 2 rounds ⇒ 16 picks ⇒ the pool suffices
-- with 4 spare.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000',
   '9b100000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated',
   'pgtap-mp11-01@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}',
   '{"username": "pgtap_mp11_user_01"}',
   now(), now());

insert into players (id, full_name, position, adp)
select 'mp11-qb' || lpad(i::text, 2, '0'), 'MP11 QB ' || lpad(i::text, 2, '0'), 'QB',
       0.600 + i / 1000.0
from generate_series(1, 10) i;
insert into players (id, full_name, position, adp)
select 'mp11-rb' || lpad(i::text, 2, '0'), 'MP11 RB ' || lpad(i::text, 2, '0'), 'RB',
       0.610 + i / 1000.0
from generate_series(1, 10) i;

select is(
  (select count(*) from league_members where user_id = '9b100000-0000-4000-8000-000000000001'),
  0::bigint,
  'PREMISE (F94): the launcher is a member of ZERO leagues — the user the lane exists for');

-- ---------------------------------------------------------------------------
-- A. THE INSTRUMENT AND ITS PRECONDITIONS.
-- ---------------------------------------------------------------------------
create temp table mp11_tables on commit drop as
select tablename::text as tbl from pg_tables where schemaname = 'public';

select is((select count(*) from mp11_tables), 56::bigint,
  'THE CENSUS, as a stored literal: 56 public tables. A migration that adds or drops one moves this number — re-derive §C''s mid-state allowlist in the same PR, deliberately (the F84 enumerate-don''t-glob discipline applied to a schema)');

-- The instrument: count + whole-row digest per table (R383/R499 — a count
-- cannot see an in-place UPDATE; the digest is md5 over the table's rows as
-- sorted jsonb text, so ANY cell moving anywhere moves it).
create temp table mp11_snap (phase text, tbl text, n bigint, digest text)
  on commit drop;
create function pg_temp.mp11_take(p_phase text) returns void
language plpgsql as $fn$
declare
  r record;
  v_n bigint;
  v_d text;
begin
  for r in select tbl from mp11_tables order by tbl loop
    execute format(
      'select count(*), coalesce(md5(string_agg(j, '''' order by j)), ''empty'')
         from (select to_jsonb(t)::text as j from public.%I t) s', r.tbl)
      into v_n, v_d;
    insert into mp11_snap values (p_phase, r.tbl, v_n, v_d);
  end loop;
end $fn$;

-- QUIESCENCE PRECONDITIONS, diagnosed by name (the F110/F118 species handled
-- the honest way round: a delta-based sweep tolerates any amount of
-- QUIESCENT residue — pre-existing rows cancel out — but a committed draft
-- that is DUE would be claimed by OUR OWN tick inside this transaction's
-- snapshot, and its writes would land in the deltas as a false leak).
select is(
  (select count(*) from drafts where status in ('live', 'drafting')
     and current_deadline is not null and current_deadline < now()),
  0::bigint,
  'PRECONDITION: no committed draft is DUE. If this reds, a prior session left a running draft behind — sweep it (delete the mock / finish the draft), do not touch this file. The zero-sweep discipline (F118) is what keeps this green');
select is(
  (select count(*) from leagues l where l.status = 'scheduled'
     and coalesce(l.settings->'draft'->>'draft_scheduled_at', '') <> ''
     and (l.settings->'draft'->>'draft_scheduled_at')::timestamptz < now()),
  0::bigint,
  'PRECONDITION: no committed scheduled league is past its D94 auto-start instant — our tick would start it inside the snapshot (the F49 fixture-instant class, asserted rather than assumed)');

select lives_ok($$ select pg_temp.mp11_take('before') $$,
  'BASELINE: all 56 tables snapshotted (count + whole-row digest each)');
select is((select count(*) from mp11_snap where phase = 'before'), 56::bigint,
  '…one row per table');

-- ---------------------------------------------------------------------------
-- B. THE LIFECYCLE, DRIVEN FOR REAL.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9b100000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.create_mock_draft(
       p_settings := '{"team_count": 8,
                       "roster_settings": {"starting_slots": [
                          {"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}],
                          "bench": 1, "ir_slots": [], "swap_spots": 0},
                       "draft": {"draft_type": "snake", "pick_timer_seconds": 90}}'::jsonb,
       p_cpu_speed := 'fast') $$,
  'LAUNCH: a user in zero leagues starts an 8-seat snake practice draft (§8.8 as amended by v2.16)');
reset role;

create temp table mp11_mock on commit drop as
select id from drafts
 where is_mock and league_id is null
   and config->'mock'->>'launched_by' = '9b100000-0000-4000-8000-000000000001';
grant select on mp11_mock to authenticated;

select is((select count(*) from mp11_mock), 1::bigint, 'exactly one standalone mock exists');

-- The launcher's own verbs, mid-flight (the RPCs a real practice session
-- uses — each one is a writer whose residue §D must catch if delete misses
-- it): liveness beat, a real human pick, pause, resume.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9b100000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_touch((select id from mp11_mock)) $$,
  'the launcher''s liveness beat lands (draft_liveness — a table delete must cascade)');
reset role;
update drafts d
   set on_clock_team_id = (d.config->'mock'->>'human_team_id')::uuid,
       current_deadline = now() + interval '5 minutes'
  from mp11_mock m where d.id = m.id;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9b100000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_make_pick((select id from mp11_mock), 'mp11-qb09', gen_random_uuid()) $$,
  'the human''s own pick lands (draft_picks, league_id NULL)');
select lives_ok(
  $$ select public.draft_pause((select id from mp11_mock), null) $$,
  'pause lands (a league_chat system post with NULL league_id — F109(c)''s writer)');
select lives_ok(
  $$ select public.draft_resume((select id from mp11_mock), null) $$,
  '…and resume (the second post)');
reset role;

-- Drive to COMPLETE through the real engine: rewind the deadline, tick,
-- repeat (the D100 harness idiom — no wall clock, the SERVER's own writes
-- rewound). 16 picks at 8 seats × 2 rounds; 40 passes is head-room, and the
-- loop exits the moment the completion writer has run.
do $drive$
declare
  v_id uuid;
  v_status text;
  i int;
begin
  select id into v_id from mp11_mock;
  for i in 1..40 loop
    select status into v_status from drafts where id = v_id;
    exit when v_status = 'complete';
    update drafts set current_deadline = now() - interval '5 minutes'
     where id = v_id and status = 'live';
    perform public.draft_tick();
  end loop;
end $drive$;

select is(
  (select status from drafts d join mp11_mock m on d.id = m.id),
  'complete',
  'DRIVEN TO COMPLETE through the real tick — not a status flip by hand');
select is(
  (select count(*) from draft_picks p join mp11_mock m on p.draft_id = m.id
    where not p.is_undone),
  16::bigint,
  '…all 16 picks on the board (8 seats × 2 rounds), every one written by the engine or the human''s own verb');

-- ---------------------------------------------------------------------------
-- C. THE MID-STATE DELTA IS EXACTLY THE ENGINE'S OWN TABLES.
-- ---------------------------------------------------------------------------
select lives_ok($$ select pg_temp.mp11_take('during') $$,
  'MID-STATE: snapshot taken with the mock complete but not yet deleted');

select is(
  (select array_agg(b.tbl order by b.tbl)
     from mp11_snap b join mp11_snap d on d.tbl = b.tbl and d.phase = 'during'
    where b.phase = 'before' and (b.n, b.digest) is distinct from (d.n, d.digest)),
  array['draft_liveness', 'draft_picks', 'drafts', 'league_chat', 'teams'],
  'THE MID-STATE ALLOWLIST, as a stored literal: a COMPLETE standalone mock has touched exactly five tables — drafts (its own row), draft_picks (the board), draft_liveness (the launcher''s beat), league_chat (the pause/resume system posts, league_id NULL), teams (the practice seats). NOT leagues, NOT league_members/rosters/weeks/lists/invites, NOT scoring_systems, NOT players — a live function that grows a league write reachable from a standalone mock reddens HERE, before §D even runs (the F109 species as a permanent assertion). league_chat''s rows carry NULL league_id by §12''s amended arm; the five-table set is the engine''s own storage per D234 and nothing else');

select is(
  (select count(*) from league_chat c join mp11_mock m
       on c.context = 'draft:' || m.id::text
    where c.league_id is not null),
  0::bigint,
  '…and every chat row the lifecycle wrote is league-less — the delta above could not have hidden a league-keyed post');

-- ---------------------------------------------------------------------------
-- D. ZERO DELTA AFTER DELETE — THE HEADLINE.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "9b100000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.delete_mock_draft((select id from mp11_mock)) $$,
  'the launcher deletes their own practice');
reset role;

select lives_ok($$ select pg_temp.mp11_take('after') $$,
  'FINAL: all 56 tables snapshotted again');

select is(
  (select coalesce(array_agg(b.tbl order by b.tbl), '{}'::text[])
     from mp11_snap b join mp11_snap a on a.tbl = b.tbl and a.phase = 'after'
    where b.phase = 'before' and (b.n, b.digest) is distinct from (a.n, a.digest)),
  '{}'::text[],
  'ZERO DELTA OVER THE WHOLE SCHEMA: after launch → ticks → touch → pick → pause → resume → complete → delete, all 56 public tables are byte-identical to the baseline — count AND whole-row digest, so a leaked bot seat, an orphaned NULL-league chat post, a non-cascading FK child of drafts, or an in-place UPDATE anywhere (R499) all name their table here. Nothing leaks into the league product — or anywhere else (§4 rule 10; §8.8)');

-- The count-vs-digest decomposition, so a future red diagnoses itself: which
-- kind of leak was it?
select is(
  (select count(*) from mp11_snap b join mp11_snap a on a.tbl = b.tbl and a.phase = 'after'
    where b.phase = 'before' and b.n <> a.n),
  0::bigint,
  '…decomposed: zero tables changed ROW COUNT (a leftover or missing row would name itself here)');
select is(
  (select count(*) from mp11_snap b join mp11_snap a on a.tbl = b.tbl and a.phase = 'after'
    where b.phase = 'before' and b.n = a.n and b.digest <> a.digest),
  0::bigint,
  '…and zero tables changed CONTENT at the same count (an in-place UPDATE — the R499 blind spot a count-only sweep would have sailed past)');

-- The named cleanup halves, pinned individually so a §D red is diagnosable
-- (the same two 043 §G pins, re-asserted against THIS lifecycle):
select is(
  (select count(*) from teams t
    where t.league_id is null and t.owner_id = '9b100000-0000-4000-8000-000000000001'),
  0::bigint,
  'the practice seats are gone — draft first, then seats, one transaction (D227(6))');
select is(
  (select count(*) from league_chat c join mp11_mock m
       on c.context = 'draft:' || m.id::text),
  0::bigint,
  '…and the chat sweep reached the NULL-league posts (`IS NOT DISTINCT FROM`, not `= NULL`)');

select * from finish();
rollback;
