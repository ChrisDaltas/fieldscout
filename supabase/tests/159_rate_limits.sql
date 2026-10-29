-- ============================================================================
-- 159 — rate limits (migration 209; M7 L.F2.6; spec §22.5; ledger F41;
--       PROGRESS D700–D706)
-- ============================================================================
-- What this file proves, in one rolled-back transaction:
--   §A  FORM — the door DEFINER + search_path '' + EXECUTE authenticated only;
--       the rule, the internal and the chat guard closed to anon /
--       authenticated, all search_path ''; the table RLS on, NO policy,
--       TRUNCATE revoked; the trigger is BEFORE INSERT on
--       league_chat; the numbers are §22.5's (golden).
--   §K  THE GATE — anon cannot run the door; a JWT with no user is refused by
--       name; authenticated cannot run the internal; an unknown scope / an
--       unknown bucket are refused by name; over a seeded row, anon and
--       authenticated read none, insert none (RLS), update / delete 0 rows
--       (§4.2 RETURNING counts) and cannot truncate.
--   §L  THE LIMIT HOLDS — at one instant: mutation 10 then refused, bid 5
--       then refused, chat 5 then refused (golden results incl. Retry-After).
--       A refusal writes nothing.
--   §W  THE WINDOW RESETS — boundary instants: one millisecond before the
--       oldest hit leaves, still refused (retry 1 ms); AT the boundary,
--       allowed (a hit at t counts for [t, t + window)); a staggered
--       one-per-second run frees exactly one slot per second.
--   §I  ISOLATION — another user, another league, another bucket each have
--       their own allowance.
--   §D  THE DOOR — the signed-in caller spends HIS OWN allowance (10 then a
--       refusal), a practice draft's id is a scope of its own.
--   §C  CHAT ON THE INSERT PATH — a member's 6th post in 10 s is refused with
--       SQLSTATE PGRST + PostgREST's 429 / Retry-After envelope (golden),
--       nothing posted; system lines and service-role writes are never
--       limited; another member is unaffected; a post RLS refuses does not
--       spend allowance.
-- Break probes (§4.3, shown in the PR, reverted): (1) `>=` → `>` in the
-- internal's limit test ⇒ L/W/D/C red (an 11th mutation admitted); (2) the
-- guard's `NEW.is_system` clause removed ⇒ C4 red.
-- World (season 2097): u1, u2 members of L1 (u1 commissioner, u2 manager);
-- u3 in no league. L2 a second league (u1 commissioner). D1 a draft of L1;
-- E2 a standalone practice draft launched by u3.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(61);

create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.err(text) to anon, authenticated, service_role;

-- One take at an instant offset (ms) from T0, as one comparable string.
create function pg_temp.take(p_user uuid, p_bucket text, p_scope uuid, p_ms integer) returns text
language sql as $$
  select format('%s:%s:%s',
    case when (r ->> 'allowed')::boolean then 'ok' else 'no' end, r ->> 'remaining', r ->> 'retry_after_ms')
  from (select public.rate_limit_take_internal(p_user, p_bucket, p_scope,
          '2097-01-01 12:00:00+00'::timestamptz + make_interval(secs => p_ms / 1000.0)) r) x
$$;
-- N takes at one instant; the outcomes joined.
create function pg_temp.burst(p_user uuid, p_bucket text, p_scope uuid, p_ms integer, p_n integer) returns text
language plpgsql as $$
declare v text := ''; i integer;
begin
  for i in 1..p_n loop
    v := v || case when i > 1 then ' ' else '' end || pg_temp.take(p_user, p_bucket, p_scope, p_ms);
  end loop;
  return v;
end;
$$;
create function pg_temp.stored(p_user uuid, p_bucket text, p_scope uuid) returns integer language sql stable as $$
  select coalesce((select cardinality(hits) from public.rate_limit_hits
                   where user_id = p_user and bucket = p_bucket and scope = p_scope), -1)
$$;

-- ---------------------------------------------------------------------------
-- A. Form
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s=%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                 has_function_privilege('anon', p.oid, 'EXECUTE'),
                 has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'rate\_limit\_%' or p.proname = 'league_chat_rate_limit_guard_internal')),
  'league_chat_rate_limit_guard_internal=t:search_path="":f:f rate_limit_rule_internal=f:search_path="":f:f '
  || 'rate_limit_take=t:search_path="":f:t rate_limit_take_internal=f:search_path="":f:f',
  'A1 the door DEFINER + search_path '''' + authenticated only; the rule / internal / chat guard closed');
select is(
  (select format('rls=%s policies=%s', c.relrowsecurity,
     (select count(*) from pg_policy pol where pol.polrelid = c.oid))
   from pg_class c where c.oid = 'public.rate_limit_hits'::regclass),
  'rls=t policies=0', 'A2 the table: RLS on, NO policy (server-owned)');
select is(
  (select string_agg(r || '=' || has_table_privilege(r, 'public.rate_limit_hits', 'TRUNCATE')::text, ' ' order by r)
   from unnest(array['anon', 'authenticated']) r),
  'anon=false authenticated=false',
  'A3 TRUNCATE (which RLS does not gate) is revoked from anon and authenticated (133''s rule); the seven other grants stay — RLS is the gate (D18 → D23, pgTAP 081 C3)');
select is(
  (select format('%s:%s:%s', t.tgname, t.tgtype, p.proname)
   from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.league_chat'::regclass and t.tgname = 'tr_league_chat_rate_limit'),
  'tr_league_chat_rate_limit:7:league_chat_rate_limit_guard_internal',
  'A4 the chat guard is a BEFORE INSERT ROW trigger on league_chat (tgtype 7 = ROW|BEFORE|INSERT)');
select is(
  (select string_agg(format('%s=%s/%s', b, r.max_hits, r.window_ms), ' ' order by b)
   from unnest(array['ask', 'bid', 'chat', 'comment', 'mutation', 'report']) b, lateral public.rate_limit_rule_internal(b) r),
  'ask=10/3600000 bid=5/1000 chat=5/10000 comment=5/60000 mutation=10/10000 report=10/3600000',
  'A5 §22.5''s numbers, golden: bids 5/s, chat 5 per 10 s, mutations 10 per 10 s; 213''s per-person buckets: comment 5 a minute, report and ask 10 an hour (pgTAP 163)');
select is((select count(*)::int from public.rate_limit_rule_internal('pick')), 0,
  'A6 an unknown bucket has no rule');

-- ---------------------------------------------------------------------------
-- World
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000'::uuid, ('99159000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-x159-u' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, json_build_object('username', 'x159_user' || i)::jsonb, now(), now()
from generate_series(1, 3) i;

insert into leagues (id, owner_id, name, season, status, team_count, settings, roster_settings)
select v.id::uuid, '99159000-0000-4000-8000-000000000001'::uuid, v.nm, 2097, 'setup', 8, '{}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 4, "ir_slots": [], "swap_spots": 0}'
from (values
  ('b1590000-0000-4000-8000-000000000001', 'x159 One'),
  ('b1590000-0000-4000-8000-000000000002', 'x159 Two')
) v(id, nm);
insert into league_members (league_id, user_id, role) values
  ('b1590000-0000-4000-8000-000000000001', '99159000-0000-4000-8000-000000000001', 'commissioner'),
  ('b1590000-0000-4000-8000-000000000001', '99159000-0000-4000-8000-000000000002', 'manager'),
  ('b1590000-0000-4000-8000-000000000002', '99159000-0000-4000-8000-000000000001', 'commissioner');
insert into drafts (id, league_id, status, is_mock) values
  ('e1590000-0000-4000-8000-000000000001', 'b1590000-0000-4000-8000-000000000001', 'scheduled', false);
-- E2: a standalone practice draft (no league) launched by u3.
insert into drafts (id, league_id, status, is_mock, config) values
  ('e1590000-0000-4000-8000-000000000002', null, 'scheduled', true,
   '{"mock": {"launched_by": "99159000-0000-4000-8000-000000000003"}}');

-- ---------------------------------------------------------------------------
-- K. The gate
-- ---------------------------------------------------------------------------
set local role anon;
select alike(pg_temp.err($$select rate_limit_take('mutation', 'b1590000-0000-4000-8000-000000000001')$$),
  '42501: permission denied for function rate_limit_take%', 'K1 anon cannot run the door');
reset role;

select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$select rate_limit_take('mutation', 'b1590000-0000-4000-8000-000000000001')$$),
  '42501: rate_limit: sign in first', 'K2 a JWT with no user is refused by name');
reset role;

select set_config('request.jwt.claims', '{"sub": "99159000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select alike(pg_temp.err($$select rate_limit_take_internal('99159000-0000-4000-8000-000000000002', 'mutation', 'b1590000-0000-4000-8000-000000000001', now())$$),
  '42501: permission denied for function rate_limit_take_internal%', 'K3 the internal is closed to authenticated (no spending another user''s allowance)');
select alike(pg_temp.err($$select rate_limit_rule_internal('mutation')$$),
  '42501: permission denied for function rate_limit_rule_internal%', 'K4 the rule is closed to authenticated');
select is(pg_temp.err($$select rate_limit_take('mutation', 'b1590000-0000-4000-8000-0000000000ff')$$),
  '22023: rate_limit: unknown league or draft', 'K5 an unknown scope is refused by name (no rows minted under made-up ids)');
select is(pg_temp.err($$select rate_limit_take('pick', 'b1590000-0000-4000-8000-000000000001')$$),
  '22023: rate_limit: unknown bucket pick', 'K6 an unknown bucket is refused by name');
select is(pg_temp.err($$select rate_limit_take('chat', 'b1590000-0000-4000-8000-000000000001')$$),
  '22023: rate_limit: unknown bucket chat', 'K6b R1687: chat is not the door''s (the insert-path guard owns it) — no draining a member''s chat from outside');
reset role;
-- R1687: membership of the scope.
select set_config('request.jwt.claims', '{"sub": "99159000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$select rate_limit_take('mutation', 'b1590000-0000-4000-8000-000000000001')$$),
  '42501: rate_limit: not a member of this league or draft', 'K6c R1687: a non-member of the league is refused by name');
reset role;
select set_config('request.jwt.claims', '{"sub": "99159000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$select rate_limit_take('mutation', 'e1590000-0000-4000-8000-000000000002')$$),
  '42501: rate_limit: not a member of this league or draft', 'K6d R1687: a practice draft someone else launched is refused');
select is(pg_temp.err($$select rate_limit_take('mutation', 'e1590000-0000-4000-8000-000000000001')$$),
  '42501: rate_limit: not a member of this league or draft', 'K6e R1687: a league draft''s id is not a scope a member can spend (league writes are keyed by the league)');
reset role;
select is((select count(*)::int from rate_limit_hits where user_id in
  ('99159000-0000-4000-8000-000000000001', '99159000-0000-4000-8000-000000000002', '99159000-0000-4000-8000-000000000003')),
  0, 'K6f the refused doors wrote nothing');

-- §4.2 no-write-policy per role, with RETURNING counts. A SEED row first, so
-- a 0 is "RLS hid it", never "there was nothing to see".
insert into rate_limit_hits (user_id, bucket, scope, hits) values
  ('99159000-0000-4000-8000-000000000002', 'bid', 'b1590000-0000-4000-8000-000000000002',
   array['2097-01-01 11:00:00+00', '2097-01-01 11:00:01+00', '2097-01-01 11:00:02+00']::timestamptz[]);
create function pg_temp.val(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return coalesce(v, '<null>');
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.val(text) to anon, authenticated;
select is(pg_temp.val($$select count(*) from rate_limit_hits$$), '1', 'K7 premise: postgres sees the seed row');
set local role anon;
select is(pg_temp.val($$select count(*) from rate_limit_hits$$), '0', 'K8 anon reads no row');
select alike(pg_temp.val($$with x as (insert into rate_limit_hits (user_id, bucket, scope) values ('99159000-0000-4000-8000-000000000001', 'mutation', 'b1590000-0000-4000-8000-000000000001') returning 1) select count(*) from x$$),
  '42501: new row violates row-level security policy%', 'K9 anon cannot insert');
select is(pg_temp.val($$with x as (update rate_limit_hits set hits = '{}' returning 1) select count(*) from x$$), '0', 'K10 anon updates 0 rows');
reset role;
select set_config('request.jwt.claims', '{"sub": "99159000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.val($$select count(*) from rate_limit_hits$$), '0', 'K11 the seed''s OWN user reads no row (nobody reads the ledger)');
select alike(pg_temp.val($$with x as (insert into rate_limit_hits (user_id, bucket, scope) values ('99159000-0000-4000-8000-000000000002', 'mutation', 'b1590000-0000-4000-8000-000000000001') returning 1) select count(*) from x$$),
  '42501: new row violates row-level security policy%', 'K12 authenticated cannot insert (no self-granted allowance)');
select is(pg_temp.val($$with x as (update rate_limit_hits set hits = '{}' returning 1) select count(*) from x$$), '0',
  'K13 authenticated updates 0 rows (no clearing his own wait)');
select is(pg_temp.val($$with x as (delete from rate_limit_hits returning 1) select count(*) from x$$), '0', 'K14 authenticated deletes 0 rows');
select alike(pg_temp.val($$truncate rate_limit_hits$$), '42501: permission denied for table rate_limit_hits%', 'K15 authenticated cannot truncate');
reset role;
select is(
  (select format('rows=%s seed=%s', count(*), max(cardinality(hits))) from rate_limit_hits where user_id in
    ('99159000-0000-4000-8000-000000000001', '99159000-0000-4000-8000-000000000002', '99159000-0000-4000-8000-000000000003')),
  'rows=1 seed=3', 'K16 nothing was written by any refused call, and the seed is intact');

-- ---------------------------------------------------------------------------
-- L. The limit holds (at T0, through the internal)
-- ---------------------------------------------------------------------------
select is(pg_temp.burst('99159000-0000-4000-8000-000000000001', 'mutation', 'b1590000-0000-4000-8000-000000000001', 0, 11),
  'ok:9:0 ok:8:0 ok:7:0 ok:6:0 ok:5:0 ok:4:0 ok:3:0 ok:2:0 ok:1:0 ok:0:0 no:0:10000',
  'L1 mutations: 10 accepted, the 11th refused with a 10 s wait (golden)');
select is(
  public.rate_limit_take_internal('99159000-0000-4000-8000-000000000001', 'mutation',
    'b1590000-0000-4000-8000-000000000001', '2097-01-01 12:00:00+00'),
  '{"allowed": false, "bucket": "mutation", "limit": 10, "window_ms": 10000, "remaining": 0, "retry_after_ms": 10000}'::jsonb,
  'L2 the refusal, golden');
select is(pg_temp.stored('99159000-0000-4000-8000-000000000001', 'mutation', 'b1590000-0000-4000-8000-000000000001'),
  10, 'L3 refusals wrote nothing: exactly the 10 accepted hits are stored');
select is(pg_temp.burst('99159000-0000-4000-8000-000000000001', 'bid', 'b1590000-0000-4000-8000-000000000001', 0, 6),
  'ok:4:0 ok:3:0 ok:2:0 ok:1:0 ok:0:0 no:0:1000',
  'L4 bids: 5 accepted, the 6th refused with a 1 s wait');
select is(pg_temp.burst('99159000-0000-4000-8000-000000000003', 'chat', 'b1590000-0000-4000-8000-000000000002', 0, 6),
  'ok:4:0 ok:3:0 ok:2:0 ok:1:0 ok:0:0 no:0:10000',
  'L5 chat: 5 accepted, the 6th refused with a 10 s wait');
select is(pg_temp.err($$select rate_limit_take_internal('99159000-0000-4000-8000-000000000001', 'mutation', 'b1590000-0000-4000-8000-000000000001', null)$$),
  '22023: rate_limit: p_now is required (the TimeProvider seam)', 'L6 no instant, no take');

-- ---------------------------------------------------------------------------
-- W. The window resets (boundary instants)
-- ---------------------------------------------------------------------------
select is(pg_temp.take('99159000-0000-4000-8000-000000000001', 'mutation', 'b1590000-0000-4000-8000-000000000001', 9999),
  'no:0:1', 'W1 9.999 s after the burst: still refused, 1 ms to wait');
select is(pg_temp.take('99159000-0000-4000-8000-000000000001', 'mutation', 'b1590000-0000-4000-8000-000000000001', 10000),
  'ok:9:0', 'W2 AT 10 s the whole burst has left the window: allowed, 9 left (a hit at t counts for [t, t + 10 s))');
select is(pg_temp.stored('99159000-0000-4000-8000-000000000001', 'mutation', 'b1590000-0000-4000-8000-000000000001'),
  1, 'W3 the expired hits are trimmed on the next accepted take — the row never grows past the limit');
select is(pg_temp.take('99159000-0000-4000-8000-000000000001', 'bid', 'b1590000-0000-4000-8000-000000000001', 999),
  'no:0:1', 'W4 bids: 0.999 s later still refused');
select is(pg_temp.take('99159000-0000-4000-8000-000000000001', 'bid', 'b1590000-0000-4000-8000-000000000001', 1000),
  'ok:4:0', 'W5 bids: at 1 s, allowed again');
-- Staggered: u2 takes one mutation per second, 0 s … 9 s.
select is(
  (select string_agg(pg_temp.take('99159000-0000-4000-8000-000000000002', 'mutation', 'b1590000-0000-4000-8000-000000000001', s * 1000), ' ' order by s)
   from generate_series(0, 9) s),
  'ok:9:0 ok:8:0 ok:7:0 ok:6:0 ok:5:0 ok:4:0 ok:3:0 ok:2:0 ok:1:0 ok:0:0',
  'W6 one per second for 10 s: all 10 accepted');
select is(pg_temp.take('99159000-0000-4000-8000-000000000002', 'mutation', 'b1590000-0000-4000-8000-000000000001', 9500),
  'no:0:500', 'W7 at 9.5 s: refused, the 0 s hit leaves in 0.5 s');
select is(pg_temp.burst('99159000-0000-4000-8000-000000000002', 'mutation', 'b1590000-0000-4000-8000-000000000001', 10000, 2),
  'ok:0:0 no:0:1000', 'W8 at 10 s exactly ONE slot frees (the 0 s hit), the next waits for the 1 s hit');

-- ---------------------------------------------------------------------------
-- I. Isolation
-- ---------------------------------------------------------------------------
select is(pg_temp.take('99159000-0000-4000-8000-000000000003', 'mutation', 'b1590000-0000-4000-8000-000000000001', 0),
  'ok:9:0', 'I1 another user in the same league at the same instant: his own full allowance');
select is(pg_temp.take('99159000-0000-4000-8000-000000000001', 'mutation', 'b1590000-0000-4000-8000-000000000002', 0),
  'ok:9:0', 'I2 the same user in another league: a separate allowance (per league)');
select is(pg_temp.take('99159000-0000-4000-8000-000000000001', 'mutation', 'e1590000-0000-4000-8000-000000000001', 0),
  'ok:9:0', 'I3 a draft id is a scope of its own (practice drafts)');
select is(
  (select string_agg(bucket || '=' || cardinality(hits), ' ' order by bucket)
   from rate_limit_hits where user_id = '99159000-0000-4000-8000-000000000001' and scope = 'b1590000-0000-4000-8000-000000000001'),
  'bid=1 mutation=1', 'I4 each bucket is counted on its own (u1''s bids never spent his mutations — W2 / W5)');

-- ---------------------------------------------------------------------------
-- D. The door — the caller's own allowance, at now()
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "99159000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
create temp table d159 as
  select i, rate_limit_take('mutation', 'e1590000-0000-4000-8000-000000000002') r from generate_series(1, 11) i;
reset role;
select is(
  (select string_agg(format('%s:%s', r ->> 'allowed', r ->> 'remaining'), ' ' order by i) from d159),
  'true:9 true:8 true:7 true:6 true:5 true:4 true:3 true:2 true:1 true:0 false:0',
  'D1 through the door: 10 accepted, the 11th refused');
select is((select (r ->> 'retry_after_ms')::int from d159 where i = 11), 10000,
  'D2 the refusal names a 10 s wait (all 10 at one instant)');
select is((select string_agg(user_id::text, ',' order by user_id) from rate_limit_hits where scope = 'e1590000-0000-4000-8000-000000000002'),
  '99159000-0000-4000-8000-000000000003',
  'D3 the door wrote only the CALLER''s row (u3, the launcher of his practice draft)');
select set_config('request.jwt.claims', '{"sub": "99159000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select is((rate_limit_take('bid', 'b1590000-0000-4000-8000-000000000001') ->> 'allowed'), 'true',
  'D4 a manager (u2) of the league spends his own bid allowance');
reset role;

-- ---------------------------------------------------------------------------
-- C. Chat on the insert path (now() is the transaction's — one instant)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "99159000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
-- C0 (R1686): a league-less post never reaches the limiter — RLS answers it.
select alike(pg_temp.err($$insert into league_chat (league_id, user_id, message, context, is_system)
  values (null, '99159000-0000-4000-8000-000000000002', 'nowhere', 'league', false)$$),
  '42501: new row violates row-level security policy%', 'C0 R1686: a post with no league is RLS''s refusal, not the limiter''s 22023');
-- C1: a post RLS refuses (an empty message — the 065 policy) does not spend.
select alike(pg_temp.err($$insert into league_chat (league_id, user_id, message, context, is_system)
  values ('b1590000-0000-4000-8000-000000000001', '99159000-0000-4000-8000-000000000002', '', 'league', false)$$),
  '42501: new row violates row-level security policy%', 'C1 an empty post is refused by RLS');
select is(
  (select string_agg(pg_temp.err(format($f$insert into league_chat (league_id, user_id, message, context, is_system)
     values ('b1590000-0000-4000-8000-000000000001', '99159000-0000-4000-8000-000000000002', 'msg %s', 'league', false)$f$, i)), ' | ' order by i)
   from generate_series(1, 5) i),
  'no error | no error | no error | no error | no error',
  'C2 five posts in one instant all land (the RLS-refused post spent nothing)');
select is(pg_temp.err($$insert into league_chat (league_id, user_id, message, context, is_system)
  values ('b1590000-0000-4000-8000-000000000001', '99159000-0000-4000-8000-000000000002', 'msg 6', 'league', false)$$),
  'PGRST: {"code" : "rate_limited", "message" : "You''re sending messages too fast. Wait 10 seconds and send it again — that message wasn''t posted.", "details" : null, "hint" : null}',
  'C3 the 6th post is refused: SQLSTATE PGRST, plain words, the wait named (golden)');
reset role;
-- C4: a system line written by an RPC (definer, is_system) as the same user.
select set_config('request.jwt.claims', '{"sub": "99159000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(pg_temp.err($$insert into league_chat (league_id, user_id, message, context, is_system)
  values ('b1590000-0000-4000-8000-000000000001', '99159000-0000-4000-8000-000000000002', 'x159 paused the draft.', 'league', true)$$),
  'no error', 'C4 a system line for the same user is never limited');
-- C5: a service-role write (no auth.uid()).
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(pg_temp.err($$insert into league_chat (league_id, user_id, message, context, is_system)
  values ('b1590000-0000-4000-8000-000000000001', '99159000-0000-4000-8000-000000000002', 'seeded', 'league', false)$$),
  'no error', 'C5 a service-role write is never limited');
reset role;
select set_config('request.jwt.claims', '{"sub": "99159000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.err($$insert into league_chat (league_id, user_id, message, context, is_system)
  values ('b1590000-0000-4000-8000-000000000001', '99159000-0000-4000-8000-000000000001', 'hi from u1', 'league', false)$$),
  'no error', 'C6 another member of the same league has his own allowance');
reset role;
select is(
  (select format('u2=%s system=%s service=%s u1=%s',
     count(*) filter (where user_id = '99159000-0000-4000-8000-000000000002' and not is_system and message like 'msg %'),
     count(*) filter (where is_system),
     count(*) filter (where message = 'seeded'),
     count(*) filter (where user_id = '99159000-0000-4000-8000-000000000001'))
   from league_chat where league_id = 'b1590000-0000-4000-8000-000000000001'),
  'u2=5 system=1 service=1 u1=1', 'C7 what landed: u2''s five (not the 6th), the system line, the seeded line, u1''s post');
select is(pg_temp.stored('99159000-0000-4000-8000-000000000002', 'chat', 'b1590000-0000-4000-8000-000000000001'),
  5, 'C8 u2''s chat allowance holds exactly his five posts (the refused ones, RLS and limit, spent nothing)');

-- The refusal's response envelope (the DETAIL PostgREST reads for status + headers).
create function pg_temp.detail_of(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v = pg_exception_detail;
  return v;
end;
$$;
grant execute on function pg_temp.detail_of(text) to authenticated;
select set_config('request.jwt.claims', '{"sub": "99159000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.detail_of($$insert into league_chat (league_id, user_id, message, context, is_system)
  values ('b1590000-0000-4000-8000-000000000001', '99159000-0000-4000-8000-000000000002', 'msg 7', 'league', false)$$),
  '{"status" : 429, "status_text" : "Too Many Requests", "headers" : {"Retry-After" : "10"}}',
  'C9 the envelope: HTTP 429 + Retry-After 10 (golden)');
reset role;

-- The chat guard in another league is a separate allowance.
select set_config('request.jwt.claims', '{"sub": "99159000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select is(
  (select string_agg(pg_temp.err(format($f$insert into league_chat (league_id, user_id, message, context, is_system)
     values ('b1590000-0000-4000-8000-000000000002', '99159000-0000-4000-8000-000000000001', 'L2 %s', 'league', false)$f$, i)), ' | ' order by i)
   from generate_series(1, 5) i),
  'no error | no error | no error | no error | no error',
  'C10 u1 in league 2: a full five of his own');
select alike(pg_temp.err($$insert into league_chat (league_id, user_id, message, context, is_system)
  values ('b1590000-0000-4000-8000-000000000002', '99159000-0000-4000-8000-000000000001', 'L2 6', 'league', false)$$),
  'PGRST: %rate_limited%', 'C11 and his 6th there is refused');
reset role;

select * from finish();
rollback;
