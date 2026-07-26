-- ============================================================================
-- League invite RPCs — migration 062 (+ the F28 floor amended into 061).
-- Spec §7.2 (four invite paths; E53/E54/E65), §12.23/D48, §15.1, §16.1,
-- §22.5, §12.2, §12.22; task L.A1.14; PROGRESS D72; standing rules tasks-M1
-- §4. pgTAP file is **016** (015 = update_league_settings; next free
-- confirmed at task time).
--
-- Falsifiability notes (§4.3):
--   * F2 field-exposure pin: get_join_preview's return is asserted by EXACT
--     jsonb equality (key set + values) for the seat-invite case, plus a
--     named negative that none of invited_email / invited_username / token /
--     league id keys appear — run AS ANON (the carve-out's behavioral pin).
--   * F6 claim algebra: expiry is pinned at 1s-before (claims), EXACTLY-at
--     (refuses — the invite expires AT the instant, defined here), and
--     1s-past (refuses); pgTAP's txn-frozen now() makes the exact instant
--     deterministic. spent is pinned at use_count = max_uses with the edge
--     claim (2nd of 2) succeeding first. claimed-then-revoked multi-use:
--     revocation refuses FURTHER claims, prior claims keep their seats.
--   * E53 mismatch runs BEFORE the successful claim so "invite intact" is
--     falsifiable (use_count 0, no member row) — a mismatch that consumed
--     the invite fails the later E65 claim too.
--   * E54: the occupied-seat claim pins reason seat_filled AND the persisted
--     side effects (invite expires_at <= now(), commissioner notification
--     row) AND the no-seat outcome (one open stint, no member row) — an
--     implementation that raises instead of returning loses the side
--     effects and fails these.
--   * F3 re-claim: privileged unseat, re-invite, re-claim → TWO stint rows
--     on (team, user), exactly one open, distinct started_at (a now()-based
--     started_at would collide inside this txn's frozen now() — the exact
--     F3 failure clock_timestamp() exists to prevent).
--   * Capacity boundary (D47), BOTH paths: the team_count-th seat fills via
--     claim (L1) and via join (L2); the next attempt returns league_full
--     with NO teams row and the count pinned ≤ team_count.
--   * Rotation (§22.5): old code stops joining (not_found), new code joins,
--     custom slug still resolves (case-insensitively) after rotation.
--   * F28 floor: shrink below seated count refuses (exact message,
--     no-write); shrink to EXACTLY the seated count succeeds (boundary) and
--     re-syncs max_teams; a post-shrink join refuses league_full (the two
--     writers' invariant meets).
--   * C3/C4 regression: the two-league joiner's is_pro is pinned FALSE
--     first; both memberships + both teams exist (the 018 cap must not
--     fire — it targets lists.is_team only, D35).
--   * All auth.users fixtures run BEFORE any claims are set (D49(7));
--     mid-test privileged forcing uses `reset role` (013/014 pattern).
--   * §4.2 note: no new table, no policy changes — the no-write-policy
--     pattern has no new target here (055's league_invites posture was
--     pinned by pgTAP 009).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(115);

-- ---------------------------------------------------------------------------
-- A. Shape: functions, SECURITY DEFINER, exact search_path, ACLs (incl. the
--    get_join_preview anon carve-out and the internal helpers' lockdown).
-- ---------------------------------------------------------------------------
select has_function('public', 'create_league_invite',
  array['uuid','uuid','text','text','integer'], 'create_league_invite exists');
select has_function('public', 'revoke_league_invite',
  array['uuid'], 'revoke_league_invite exists');
select has_function('public', 'rotate_invite_code',
  array['uuid'], 'rotate_invite_code exists');
select has_function('public', 'set_league_invite_slug',
  array['uuid','text'], 'set_league_invite_slug exists');
select has_function('public', 'get_join_preview',
  array['text'], 'get_join_preview exists');
select has_function('public', 'claim_league_invite',
  array['text'], 'claim_league_invite exists');
select has_function('public', 'join_league_by_code',
  array['text'], 'join_league_by_code exists');
select has_function('public', 'seat_league_member_internal',
  array['uuid','uuid','integer'], 'seat_league_member_internal exists (internal)');
select has_function('public', 'notify_league_invite_internal',
  array['uuid','text','text','uuid','text'], 'notify_league_invite_internal exists (internal)');

select is_definer('public', 'create_league_invite',
  array['uuid','uuid','text','text','integer'], 'create_league_invite is SECURITY DEFINER');
select is_definer('public', 'revoke_league_invite', array['uuid'],
  'revoke_league_invite is SECURITY DEFINER');
select is_definer('public', 'rotate_invite_code', array['uuid'],
  'rotate_invite_code is SECURITY DEFINER');
select is_definer('public', 'set_league_invite_slug', array['uuid','text'],
  'set_league_invite_slug is SECURITY DEFINER');
select is_definer('public', 'get_join_preview', array['text'],
  'get_join_preview is SECURITY DEFINER');
select is_definer('public', 'claim_league_invite', array['text'],
  'claim_league_invite is SECURITY DEFINER');
select is_definer('public', 'join_league_by_code', array['text'],
  'join_league_by_code is SECURITY DEFINER');
select ok(
  not (select p.prosecdef from pg_proc p
       where p.oid = 'public.seat_league_member_internal(uuid,uuid,integer)'::regprocedure)
  and not (select p.prosecdef from pg_proc p
       where p.oid = 'public.notify_league_invite_internal(uuid,text,text,uuid,text)'::regprocedure),
  'the two internal helpers are PLAIN functions (they run inside the definer RPCs'' context)');

-- Exact search_path pins for all nine (R70 form — `SET search_path = ''`
-- stores as `search_path=""`; a rebuild pinning search_path=public fails).
select ok(
  (select count(*) = 9 and coalesce(bool_and(array_to_string(p.proconfig, ',') = 'search_path=""'), false)
     from pg_proc p
     where p.oid = any (array[
       'public.create_league_invite(uuid,uuid,text,text,integer)'::regprocedure,
       'public.revoke_league_invite(uuid)'::regprocedure,
       'public.rotate_invite_code(uuid)'::regprocedure,
       'public.set_league_invite_slug(uuid,text)'::regprocedure,
       'public.get_join_preview(text)'::regprocedure,
       'public.claim_league_invite(text)'::regprocedure,
       'public.join_league_by_code(text)'::regprocedure,
       'public.seat_league_member_internal(uuid,uuid,integer)'::regprocedure,
       'public.notify_league_invite_internal(uuid,text,text,uuid,text)'::regprocedure])),
  'all nine functions pin search_path='''' exactly (§12.0; R70 exact-value form, every proconfig = search_path="")');

-- ACLs (§4.1): anon revoked everywhere EXCEPT get_join_preview.
select ok(
  not has_function_privilege('anon', 'public.create_league_invite(uuid,uuid,text,text,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.revoke_league_invite(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.rotate_invite_code(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_league_invite_slug(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.claim_league_invite(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.join_league_by_code(text)', 'EXECUTE'),
  'anon holds no EXECUTE on any invite RPC except get_join_preview (062 REVOKEs — §4.1)');
select ok(
  has_function_privilege('anon', 'public.get_join_preview(text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_join_preview(text)', 'EXECUTE'),
  'get_join_preview: anon + authenticated HOLD EXECUTE — the documented pre-auth carve-out (§4.1 named exception; F2 is the compensating control)');
select ok(
  has_function_privilege('authenticated', 'public.create_league_invite(uuid,uuid,text,text,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.revoke_league_invite(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.rotate_invite_code(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_league_invite_slug(uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.claim_league_invite(text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.join_league_by_code(text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.claim_league_invite(text)', 'EXECUTE'),
  'authenticated (+ service_role) keep EXECUTE on the six user/commish RPCs (in-body checks are the gate)');
select ok(
  not has_function_privilege('anon', 'public.seat_league_member_internal(uuid,uuid,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.seat_league_member_internal(uuid,uuid,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.notify_league_invite_internal(uuid,text,text,uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.notify_league_invite_internal(uuid,text,text,uuid,text)', 'EXECUTE'),
  'internal helpers: NO client role holds EXECUTE (reachable only through the definer RPCs)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — BEFORE any claims, D49(7)). Twelve users:
--    u1 commish; u2 email-invitee; u3 wrong-account; u4 username-invitee;
--    u5 expiry-ok claimer; u6/u7 multi-use claimers; u8 claimed-then-revoked
--    claimer; u9 two-league joiner; u10 slug joiner; u11 boundary joiner;
--    u12 rejected joiner/claimer.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('99000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  'authenticated', 'authenticated',
  'pgtap-in' || n || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('username', uname), now(), now()
from (values
  (1, 'in_commish_one'), (2, 'in_email_two'), (3, 'in_wrong_three'),
  (4, 'in_named_four'), (5, 'in_expiry_five'), (6, 'in_multi_six'),
  (7, 'in_multi_seven'), (8, 'in_revd_eight'), (9, 'in_joiner_nine'),
  (10, 'in_slug_ten'), (11, 'in_bound_eleven'), (12, 'in_reject_twelve')
) as t(n, uname);

-- ---------------------------------------------------------------------------
-- C. u1 (commissioner): leagues + invite CRUD.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-in1@fieldscout.local"}', true);

create temp table _l1 as
select public.create_league(
  'pgtap-inv-league-1', 2026, 8,
  '{"divisions": 0}'::jsonb,
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
  (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
  'Inv Commish', 'b1000000-0000-4000-8000-000000000001',
  'redraft', 14, 6, 15, 'faab', 200, 'commissioner', null, 'per_player_kickoff') as r;
create temp table _l2 as
select public.create_league(
  'pgtap-inv-league-2', 2026, 8,
  '{"divisions": 0}'::jsonb,
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
  (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
  'Inv Commish II', 'b1000000-0000-4000-8000-000000000002',
  'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') as r;
create temp table _l3 as
select public.create_league(
  'pgtap-inv-league-3', 2026, 10,
  '{"divisions": 0}'::jsonb,
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
  (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
  'Inv Commish III', 'b1000000-0000-4000-8000-000000000003',
  'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') as r;

-- The seat-invite target franchise (T2 in L1). L.A1.15's placeholder-seat
-- RPC doesn't exist yet, so the franchise is a privileged fixture.
reset role;
insert into teams (id, owner_id, name, league_id, list_id)
values ('99110000-0000-4000-8000-000000000002',
        '99000000-0000-4000-8000-000000000001',
        'pgtap-seat-two', (select (r->>'league_id')::uuid from _l1), null);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-in1@fieldscout.local"}', true);

-- Seat-targeted EMAIL invite for T2 (uppercase input → case-insensitive
-- matching must still work, E65).
create temp table _inv_email as
select public.create_league_invite(
  (select (r->>'league_id')::uuid from _l1),
  '99110000-0000-4000-8000-000000000002',
  'PGTAP-IN2@FIELDSCOUT.LOCAL', null, 1) as r;

select is((select r->>'resent' from _inv_email), 'false',
  'email seat invite created (resent=false)');
select results_eq(
  $$ select i.target_team_id, i.invited_email::text, i.invited_username::text,
            i.max_uses, i.use_count, (i.revoked_at is null), (i.last_sent_at is null),
            (i.claimed_by is null), i.created_by
     from league_invites i where i.id = (select (r->>'invite_id')::uuid from _inv_email) $$,
  $$ values ('99110000-0000-4000-8000-000000000002'::uuid,
             'PGTAP-IN2@FIELDSCOUT.LOCAL', null::text, 1, 0, true, true, true,
             '99000000-0000-4000-8000-000000000001'::uuid) $$,
  'invite row: seat-targeted, email stored as given (CITEXT), single-use, unused, unrevoked; created_at is the initial-send record (last_sent_at NULL — D46)');
select ok(
  (select i.token ~ '^[0-9a-f]{32}$' from league_invites i
   where i.id = (select (r->>'invite_id')::uuid from _inv_email)),
  'token generated (32 lowercase hex)');
select is(
  (select i.expires_at from league_invites i
   where i.id = (select (r->>'invite_id')::uuid from _inv_email)),
  (select i.created_at + interval '14 days' from league_invites i
   where i.id = (select (r->>'invite_id')::uuid from _inv_email)),
  'default expiry = created_at + 14 days (§7.2; same-row relative pin, D54(4))');

-- RE-SEND (D46): the identical live invite is re-sent, not duplicated.
create temp table _inv_email2 as
select public.create_league_invite(
  (select (r->>'league_id')::uuid from _l1),
  '99110000-0000-4000-8000-000000000002',
  'pgtap-in2@fieldscout.local', null, 1) as r;
select is((select r->>'resent' from _inv_email2), 'true',
  're-creating the same live email invite RE-SENDS (resent=true, D46) — case-insensitive dedupe');
select is((select r->>'invite_id' from _inv_email2), (select r->>'invite_id' from _inv_email),
  're-send returns the SAME invite row (no duplicate minted)');
select ok(
  (select i.last_sent_at is not null from league_invites i
   where i.id = (select (r->>'invite_id')::uuid from _inv_email)),
  'last_sent_at stamped on re-send (created_at stays the initial send — D46)');
select is(
  (select count(*)::int from league_invites i
   where i.league_id = (select (r->>'league_id')::uuid from _l1)
     and i.invited_email is not null),
  1, 'still exactly ONE email invite row for the seat');

-- USERNAME invite (general; §7.2 path 3) — uppercase input, canonical stored.
create temp table _inv_user as
select public.create_league_invite(
  (select (r->>'league_id')::uuid from _l1),
  null, null, 'IN_NAMED_FOUR', 1) as r;
select is(
  (select i.invited_username::text from league_invites i
   where i.id = (select (r->>'invite_id')::uuid from _inv_user)),
  'in_named_four',
  'username invite stores the CANONICAL profiles.username (matched via lower() — D36)');
reset role;  -- notifications RLS is owner-scoped; privileged read (013/014 pattern)
select results_eq(
  $$ select n.type, n.title, n.data->>'event', n.data->>'token'
     from notifications n
     where n.user_id = '99000000-0000-4000-8000-000000000004' $$,
  $$ values ('league_invite', 'League invite', 'invited',
             (select r->>'token' from _inv_user)) $$,
  'username invite inserts an in-app notification (type league_invite, deep-link token in data — task item 3)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-in1@fieldscout.local"}', true);

-- Creation negatives (in-body backstops — R75 lesson: direct-RPC callers).
select throws_ok(
  $$ select public.create_league_invite(
       (select (r->>'league_id')::uuid from _l1), null, null, 'no_such_user_xx', 1) $$,
  'P0001',
  'create_league_invite: no FieldScout account with the username "no_such_user_xx" — username invites require an existing account (§7.2); use an email invite instead',
  'unknown username refuses (username invites require an existing account)');
select throws_ok(
  $$ select public.create_league_invite(
       (select (r->>'league_id')::uuid from _l1), null,
       'x@y.zz', 'in_named_four', 1) $$,
  'P0001',
  'create_league_invite: an invite targets an email OR a username, not both (§7.2)',
  'email + username together refuse');
select throws_ok(
  $$ select public.create_league_invite(
       (select (r->>'league_id')::uuid from _l1), null,
       'x@y.zz', null, 3) $$,
  'P0001',
  'create_league_invite: identity-restricted invites are single-use — max_uses must be 1 (§7.2)',
  'identity-restricted multi-use refuses');
select throws_ok(
  $$ select public.create_league_invite(
       (select (r->>'league_id')::uuid from _l1), null, null, null, 0) $$,
  '22023', null,
  'max_uses 0 refuses (22023)');
select throws_ok(
  $$ select public.create_league_invite(
       (select (r->>'league_id')::uuid from _l1),
       (select t.id from teams t where t.league_id = (select (r->>'league_id')::uuid from _l2) limit 1),
       null, null, 1) $$,
  'P0001',
  'create_league_invite: target_team_id is not a franchise of this league',
  'a target team from ANOTHER league refuses (cross-league seat forgery)');

-- Remaining fixtures for the claim matrix (all general L1 invites).
create temp table _inv_seat2 as  -- open seat invite for T2 (E54 later)
select public.create_league_invite(
  (select (r->>'league_id')::uuid from _l1),
  '99110000-0000-4000-8000-000000000002', null, null, 1) as r;
create temp table _inv_multi as  -- max_uses 2 (use_count/max_uses edge)
select public.create_league_invite(
  (select (r->>'league_id')::uuid from _l1), null, null, null, 2) as r;
create temp table _inv_rev3 as   -- max_uses 3 (claimed-then-revoked, F6)
select public.create_league_invite(
  (select (r->>'league_id')::uuid from _l1), null, null, null, 3) as r;
create temp table _inv_exp_ok as
select public.create_league_invite(
  (select (r->>'league_id')::uuid from _l1), null, null, null, 1) as r;
create temp table _inv_exp_at as
select public.create_league_invite(
  (select (r->>'league_id')::uuid from _l1), null, null, null, 1) as r;
create temp table _inv_exp_past as
select public.create_league_invite(
  (select (r->>'league_id')::uuid from _l1), null, null, null, 1) as r;
create temp table _inv_revoked as
select public.create_league_invite(
  (select (r->>'league_id')::uuid from _l1), null, null, null, 1) as r;

-- Revoke + idempotency (D63 doctrine).
select lives_ok(
  $$ select public.revoke_league_invite((select (r->>'invite_id')::uuid from _inv_revoked)) $$,
  'commissioner revokes an invite');
select ok(
  (select i.revoked_at is not null from league_invites i
   where i.id = (select (r->>'invite_id')::uuid from _inv_revoked)),
  'revoked_at set (§7.2 "revocable"; every revoke recorded)');
select lives_ok(
  $$ select public.revoke_league_invite((select (r->>'invite_id')::uuid from _inv_revoked)) $$,
  'revoking an already-revoked invite is an idempotent no-op (D63)');

-- Expiry-boundary manipulation (privileged): pgTAP's txn-frozen now() makes
-- the EXACT instant deterministic (F6 defined semantics: expires AT the
-- instant).
reset role;
update league_invites set expires_at = now() + interval '1 second'
  where id = (select (r->>'invite_id')::uuid from _inv_exp_ok);
update league_invites set expires_at = now()
  where id = (select (r->>'invite_id')::uuid from _inv_exp_at);
update league_invites set expires_at = now() - interval '1 second'
  where id = (select (r->>'invite_id')::uuid from _inv_exp_past);
set local role authenticated;

-- Custom slug on L2 (§7.2 path 1) — stored lowercased; mixed-case input.
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-in1@fieldscout.local"}', true);
select is(
  (select public.set_league_invite_slug((select (r->>'league_id')::uuid from _l2), 'PGTAP-League-Slug')),
  '{"invite_slug": "pgtap-league-slug"}'::jsonb,
  'commissioner sets a custom slug — stored lowercased (CITEXT uniqueness)');
select throws_ok(
  $$ select public.set_league_invite_slug((select (r->>'league_id')::uuid from _l2), 'ab') $$,
  'P0001',
  'set_league_invite_slug: invite_slug must be 3-40 characters of letters, numbers, and hyphens, starting and ending with a letter or number',
  'a 2-char slug refuses (format contract, D72)');
select throws_ok(
  $$ select public.set_league_invite_slug((select (r->>'league_id')::uuid from _l2), 'abcdef0123') $$,
  'P0001',
  'set_league_invite_slug: that invite_slug has the shape of a share code — use a different length or include a letter beyond a-f',
  'an exact 10-hex slug refuses (code-shadow guard — §16.1 resolves code before slug)');
select throws_ok(
  $$ select public.set_league_invite_slug((select (r->>'league_id')::uuid from _l3), 'pgtap-league-slug') $$,
  'P0001',
  'set_league_invite_slug: that invite_slug is already taken by another league',
  'a taken slug refuses with the friendly message');

-- Section D runs as anon but reads token/code fixtures from temp tables the
-- authenticated role owns — grant the reads (test plumbing, not app surface).
-- League codes are RLS-invisible to non-members, so they're captured
-- privileged here for the anon/joiner sections.
reset role;
create temp table _l2code as
select l.invite_code as c from leagues l
where l.id = (select (r->>'league_id')::uuid from _l2);
create temp table _l3code as
select l.invite_code as c from leagues l
where l.id = (select (r->>'league_id')::uuid from _l3);
grant select on _l2code, _l3code to public;
set local role authenticated;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
grant select on _inv_email, _inv_multi, _inv_revoked, _inv_exp_past, _l2 to public;

-- ---------------------------------------------------------------------------
-- D. get_join_preview — PRE-AUTH, run AS ANON (the carve-out's behavioral
--    pin). L1 currently seats 2 franchises (commish + T2) of 8.
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

-- F2: EXACT jsonb equality — key set AND values (never email/username/token).
select is(
  (select public.get_join_preview((select r->>'token' from _inv_email))),
  jsonb_build_object(
    'found', true, 'type', 'invite', 'status', 'ok',
    'league_name', 'pgtap-inv-league-1',
    'team_label', 'pgtap-seat-two',
    'inviter_name', 'in_commish_one',
    'seats_open', null),
  'seat-token preview: EXACTLY league name + team label + inviter display name (+ found/type/status) — §12.23/D48; F2 exact-shape pin, as anon');
select ok(
  not ((select public.get_join_preview((select r->>'token' from _inv_email)))
       ?| array['invited_email', 'invited_username', 'token', 'league_id', 'id', 'created_by']),
  'preview NEVER exposes invited_email / invited_username / token / ids (F2 named negative)');
select is(
  (select public.get_join_preview((select r->>'token' from _inv_multi))),
  jsonb_build_object(
    'found', true, 'type', 'invite', 'status', 'ok',
    'league_name', 'pgtap-inv-league-1',
    'team_label', null,
    'inviter_name', 'in_commish_one',
    'seats_open', 6),
  'general-invite token preview: seats-open in place of a team label (task item 1)');
select is(
  (select public.get_join_preview((select c from _l2code))),
  jsonb_build_object(
    'found', true, 'type', 'code', 'status', 'ok',
    'league_name', 'pgtap-inv-league-2',
    'team_label', null, 'inviter_name', null,
    'seats_open', 7),
  'invite-code preview resolves (type code, seats_open)');
select is(
  (select public.get_join_preview('PGTAP-LEAGUE-SLUG')),
  jsonb_build_object(
    'found', true, 'type', 'slug', 'status', 'ok',
    'league_name', 'pgtap-inv-league-2',
    'team_label', null, 'inviter_name', null,
    'seats_open', 7),
  'custom-slug preview resolves CASE-INSENSITIVELY (CITEXT semantics; §16.1)');
select is(
  (select public.get_join_preview('no-such-value-anywhere')),
  '{"found": false}'::jsonb,
  'unknown value → found:false (nothing else leaks)');
select is(
  (select (public.get_join_preview((select r->>'token' from _inv_revoked)))->>'status'),
  'revoked', 'revoked-invite preview surfaces status revoked (claim-page state)');
select is(
  (select (public.get_join_preview((select r->>'token' from _inv_exp_past)))->>'status'),
  'expired', 'expired-invite preview surfaces status expired');

-- anon cannot touch the auth-only RPCs (behavioral half of the ACL pins).
select throws_ok(
  $$ select public.claim_league_invite('deadbeef') $$, '42501', null,
  'anon cannot even EXECUTE claim_league_invite (062 REVOKE)');
select throws_ok(
  $$ select public.join_league_by_code('deadbeef') $$, '42501', null,
  'anon cannot even EXECUTE join_league_by_code (062 REVOKE)');

-- ---------------------------------------------------------------------------
-- E. Claims. E53 (mismatch, BEFORE the happy claim), E65 (email-locked,
--    case-insensitive), E54 (seat filled), F3 (re-claim), F6 (algebra).
-- ---------------------------------------------------------------------------
-- u3 = the WRONG signed-in account (E53).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000003", "role": "authenticated", "email": "pgtap-in3@fieldscout.local"}', true);

select is(
  (select (public.claim_league_invite((select r->>'token' from _inv_email)))->>'reason'),
  'mismatch',
  'E53: wrong signed-in EMAIL → friendly mismatch refusal');
reset role;  -- league_invites/league_members reads are RLS-scoped; privileged inspection
select results_eq(
  $$ select i.use_count, (i.claimed_by is null), (i.revoked_at is null),
            (i.expires_at > now())
     from league_invites i where i.id = (select (r->>'invite_id')::uuid from _inv_email) $$,
  $$ values (0, true, true, true) $$,
  'E53: the invite is INTACT after a mismatch (no use_count bump, unclaimed, unrevoked, unexpired)');
select is(
  (select count(*)::int from league_members lm
   where lm.league_id = (select (r->>'league_id')::uuid from _l1)
     and lm.user_id = '99000000-0000-4000-8000-000000000003'),
  0, 'E53: the mismatched claimer was NOT seated');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000003", "role": "authenticated", "email": "pgtap-in3@fieldscout.local"}', true);
select is(
  (select (public.claim_league_invite((select r->>'token' from _inv_user)))->>'reason'),
  'mismatch',
  'E53: wrong signed-in USERNAME → friendly mismatch refusal');

-- u2 = the invited account (E65: JWT email claim, case-insensitive — the
-- invite stored the UPPERCASE spelling).
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000002", "role": "authenticated", "email": "pgtap-in2@fieldscout.local"}', true);

create temp table _c_email as
select public.claim_league_invite((select r->>'token' from _inv_email)) as r;
select is(
  (select r->>'ok' || '/' || (r->>'already_member') || '/' || (r->>'team_id') from _c_email),
  'true/false/99110000-0000-4000-8000-000000000002',
  'E65: the invited account claims — email matched CASE-INSENSITIVELY against the JWT email claim; seated on the EXACT target franchise');
select results_eq(
  $$ select lm.role, lm.team_id, lm.faab_balance, lm.is_placeholder
     from league_members lm
     where lm.league_id = (select (r->>'league_id')::uuid from _l1)
       and lm.user_id = '99000000-0000-4000-8000-000000000002' $$,
  $$ values ('manager', '99110000-0000-4000-8000-000000000002'::uuid, 200, false) $$,
  'claim seats the member: role manager, target team, faab_balance seeded from faab_budget (200 — the NON-default literal, §12.2)');
select results_eq(
  $$ select tm.user_id, tm.role, (tm.ended_at is null), tm.started_week
     from team_managers tm
     where tm.team_id = '99110000-0000-4000-8000-000000000002' $$,
  $$ values ('99000000-0000-4000-8000-000000000002'::uuid, 'manager', true, null::integer) $$,
  'claim opens the manager stint in the same txn (§12.22/§12.2 v2.1 note)');
select is(
  (select t.owner_id from teams t where t.id = '99110000-0000-4000-8000-000000000002'),
  '99000000-0000-4000-8000-000000000002'::uuid,
  'teams.owner_id follows the claimer (informational — D35b/D72)');
reset role;
select results_eq(
  $$ select i.use_count, i.claimed_by, (i.claimed_at is not null)
     from league_invites i where i.id = (select (r->>'invite_id')::uuid from _inv_email) $$,
  $$ values (1, '99000000-0000-4000-8000-000000000002'::uuid, true) $$,
  'claim recorded: use_count 1, claimed_by/claimed_at set (§7.2 "every claim recorded")');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000002", "role": "authenticated", "email": "pgtap-in2@fieldscout.local"}', true);

-- Idempotent re-claim by the SAME user (D63): success, NO second bump.
select is(
  (select (public.claim_league_invite((select r->>'token' from _inv_email)))->>'already_member'),
  'true', 'an already-seated member re-claiming gets an idempotent success (D63)');
reset role;
select is(
  (select i.use_count from league_invites i
   where i.id = (select (r->>'invite_id')::uuid from _inv_email)),
  1, 'the idempotent re-claim did NOT bump use_count');
set local role authenticated;

-- E54: u3 claims the OTHER seat invite for the now-occupied T2.
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000003", "role": "authenticated", "email": "pgtap-in3@fieldscout.local"}', true);
select is(
  (select (public.claim_league_invite((select r->>'token' from _inv_seat2)))->>'reason'),
  'seat_filled',
  'E54: claiming a seat that filled first → friendly "seat already filled" (the one-open-stint index is the mechanism)');
reset role;  -- E54 inspection reads are RLS-scoped (invites commish-only, stints member-only)
select ok(
  (select i.expires_at <= now() from league_invites i
   where i.id = (select (r->>'invite_id')::uuid from _inv_seat2)),
  'E54: the losing invite is marked EXPIRED (expires_at = now() — instantly expired under the F6 semantics)');
select results_eq(
  $$ select n.type, n.data->>'event'
     from notifications n
     where n.user_id = '99000000-0000-4000-8000-000000000001'
       and n.data->>'event' = 'seat_conflict' $$,
  $$ values ('league_invite', 'seat_conflict') $$,
  'E54: the commissioner is notified (type league_invite, event seat_conflict — persisted DESPITE the refusal, the outcome-jsonb contract''s reason for existing)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000003", "role": "authenticated", "email": "pgtap-in3@fieldscout.local"}', true);
reset role;
select is(
  (select count(*)::int from team_managers tm
   where tm.team_id = '99110000-0000-4000-8000-000000000002' and tm.ended_at is null),
  1, 'E54: exactly ONE open stint on the contested franchise (the winner''s)');
select is(
  (select count(*)::int from league_members lm
   where lm.league_id = (select (r->>'league_id')::uuid from _l1)
     and lm.user_id = '99000000-0000-4000-8000-000000000003'),
  0, 'E54: the losing claimer holds NO membership (refusal wrote nothing to their seat)');
set local role authenticated;

-- u4: username-locked claim (general invite → auto-creates a franchise).
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000004", "role": "authenticated", "email": "pgtap-in4@fieldscout.local"}', true);
select is(
  (select (public.claim_league_invite((select r->>'token' from _inv_user)))->>'ok'),
  'true', 'the invited USERNAME claims successfully (lower(username) match — D36)');
select results_eq(
  $$ select (lm.team_id is not null), (tm.id is not null)
     from league_members lm
     left join team_managers tm
       on tm.team_id = lm.team_id and tm.user_id = lm.user_id and tm.ended_at is null
     where lm.league_id = (select (r->>'league_id')::uuid from _l1)
       and lm.user_id = '99000000-0000-4000-8000-000000000004' $$,
  $$ values (true, true) $$,
  'general claim auto-created a franchise + open stint (open seats remained — §7.2/D47)');

-- F6 expiry boundaries (u5 for the passing side; refusals consume nothing).
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000005", "role": "authenticated", "email": "pgtap-in5@fieldscout.local"}', true);
select is(
  (select (public.claim_league_invite((select r->>'token' from _inv_exp_at)))->>'reason'),
  'expired',
  'F6 boundary: a claim at EXACTLY expires_at refuses — the invite expires AT the instant (defined semantics)');
select is(
  (select (public.claim_league_invite((select r->>'token' from _inv_exp_past)))->>'reason'),
  'expired', 'F6 boundary: 1s past expires_at refuses');
select is(
  (select (public.claim_league_invite((select r->>'token' from _inv_exp_ok)))->>'ok'),
  'true', 'F6 boundary: 1s BEFORE expires_at claims successfully (the passing side)');

-- F6 use_count/max_uses edge (max_uses 2): 2nd claim consumes the last use;
-- 3rd refuses spent.
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000006", "role": "authenticated", "email": "pgtap-in6@fieldscout.local"}', true);
select is(
  (select (public.claim_league_invite((select r->>'token' from _inv_multi)))->>'ok'),
  'true', 'multi-use link: claim 1 of 2');
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000007", "role": "authenticated", "email": "pgtap-in7@fieldscout.local"}', true);
select is(
  (select (public.claim_league_invite((select r->>'token' from _inv_multi)))->>'ok'),
  'true', 'multi-use link: claim 2 of 2 — the EDGE use succeeds');
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000012", "role": "authenticated", "email": "pgtap-in12@fieldscout.local"}', true);
select is(
  (select (public.claim_league_invite((select r->>'token' from _inv_multi)))->>'reason'),
  'spent', 'F6: use_count = max_uses refuses (in-body, not a DB CHECK — R48 rationale)');
reset role;
select is(
  (select i.use_count from league_invites i
   where i.id = (select (r->>'invite_id')::uuid from _inv_multi)),
  2, 'use_count stopped exactly at max_uses');
set local role authenticated;

-- F6 claimed-then-revoked multi-use interaction: revocation stops FURTHER
-- claims; prior claims keep their seats (not retroactive).
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000008", "role": "authenticated", "email": "pgtap-in8@fieldscout.local"}', true);
select is(
  (select (public.claim_league_invite((select r->>'token' from _inv_rev3)))->>'ok'),
  'true', 'multi-use (3): claim 1 succeeds before revocation');
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-in1@fieldscout.local"}', true);
select lives_ok(
  $$ select public.revoke_league_invite((select (r->>'invite_id')::uuid from _inv_rev3)) $$,
  'commissioner revokes the partially-used multi-use invite');
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000012", "role": "authenticated", "email": "pgtap-in12@fieldscout.local"}', true);
select is(
  (select (public.claim_league_invite((select r->>'token' from _inv_rev3)))->>'reason'),
  'revoked',
  'F6: revocation refuses further claims even with uses remaining (revoked beats remaining max_uses — defined interaction)');
reset role;
select is(
  (select count(*)::int from league_members lm
   where lm.league_id = (select (r->>'league_id')::uuid from _l1)
     and lm.user_id = '99000000-0000-4000-8000-000000000008'),
  1, 'F6: the PRIOR claimer keeps their seat (revocation is not retroactive)');
set local role authenticated;

-- F3 re-claim: unseat u2 (privileged — remove_manager is L.A1.15), then a
-- fresh seat invite; the re-claim must open a SECOND stint row.
reset role;
update team_managers
  set ended_at = clock_timestamp(), end_reason = 'kicked',
      ended_by = '99000000-0000-4000-8000-000000000001'
  where team_id = '99110000-0000-4000-8000-000000000002' and ended_at is null;
delete from league_members
  where league_id = (select (r->>'league_id')::uuid from _l1)
    and user_id = '99000000-0000-4000-8000-000000000002';
update teams set owner_id = '99000000-0000-4000-8000-000000000001'
  where id = '99110000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-in1@fieldscout.local"}', true);
create temp table _inv_reclaim as
select public.create_league_invite(
  (select (r->>'league_id')::uuid from _l1),
  '99110000-0000-4000-8000-000000000002',
  'pgtap-in2@fieldscout.local', null, 1) as r;
select is((select r->>'resent' from _inv_reclaim), 'false',
  'the re-invite is a NEW invite (the old one is spent — the D46 dedupe only re-sends LIVE invites)');
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000002", "role": "authenticated", "email": "pgtap-in2@fieldscout.local"}', true);
select is(
  (select (public.claim_league_invite((select r->>'token' from _inv_reclaim)))->>'ok'),
  'true', 'F3/E51: the previously-removed manager re-claims their old franchise');
select results_eq(
  $$ select count(*)::int,
            count(*) filter (where tm.ended_at is null)::int,
            count(distinct tm.started_at)::int
     from team_managers tm
     where tm.team_id = '99110000-0000-4000-8000-000000000002'
       and tm.user_id = '99000000-0000-4000-8000-000000000002' $$,
  $$ values (2, 1, 2) $$,
  'F3/E51: TWO stint rows (no merge), exactly one open, DISTINCT started_at — clock_timestamp() means a re-claim can never reuse a prior stint''s started_at even inside one txn');

-- Capacity via the CLAIM path (D47). L1 seats now: u1, T2(u2), u4, u5, u6,
-- u7, u8 = 7 of 8. The next general claim takes the team_count-th seat;
-- the one after refuses with NO writes.
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-in1@fieldscout.local"}', true);
create temp table _inv_fill as
select public.create_league_invite(
  (select (r->>'league_id')::uuid from _l1), null, null, null, 2) as r;
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000009", "role": "authenticated", "email": "pgtap-in9@fieldscout.local"}', true);
select is(
  (select (public.claim_league_invite((select r->>'token' from _inv_fill)))->>'ok'),
  'true', 'capacity boundary: the claim with ONE seat open creates the team_count-th team');
select is(
  (select count(*)::int from teams t
   where t.league_id = (select (r->>'league_id')::uuid from _l1) and t.status <> 'retired'),
  8, 'L1 now seats exactly team_count (8) franchises');
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000012", "role": "authenticated", "email": "pgtap-in12@fieldscout.local"}', true);
select is(
  (select (public.claim_league_invite((select r->>'token' from _inv_fill)))->>'reason'),
  'league_full',
  'D47: a claim on a FULL league (multi-use link, max_uses NOT exhausted) returns the friendly "league is full"');
reset role;
select results_eq(
  $$ select
       (select count(*)::int from teams t
        where t.league_id = (select (r->>'league_id')::uuid from _l1) and t.status <> 'retired'),
       (select count(*)::int from league_members lm
        where lm.league_id = (select (r->>'league_id')::uuid from _l1)
          and lm.user_id = '99000000-0000-4000-8000-000000000012'),
       (select i.use_count from league_invites i
        where i.id = (select (r->>'invite_id')::uuid from _inv_fill)) $$,
  $$ values (8, 0, 1) $$,
  'D47: the full-league refusal wrote NOTHING — teams stay ≤ team_count, no member row, use_count unconsumed');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- F. Rotation (§7.2/§22.5), slug resolution, join_league_by_code, capacity
--    via the JOIN path (L2, team_count 8).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-in1@fieldscout.local"}', true);
create temp table _old_code as
select l.invite_code as c from leagues l
where l.id = (select (r->>'league_id')::uuid from _l2);
create temp table _rot as
select public.rotate_invite_code((select (r->>'league_id')::uuid from _l2)) as r;
select ok(
  (select r->>'invite_code' from _rot) <> (select c from _old_code),
  'rotation generated a NEW code');
select is(
  (select l.invite_code from leagues l where l.id = (select (r->>'league_id')::uuid from _l2)),
  (select r->>'invite_code' from _rot),
  'the new code is stored (and returned)');
select is(
  (select l.invite_slug::text from leagues l where l.id = (select (r->>'league_id')::uuid from _l2)),
  'pgtap-league-slug',
  'rotation leaves invite_slug UNTOUCHED (§7.2 "rotatable" is the code; task pin)');

-- u9 (already in L1 — the C3/C4 two-league joiner): old code dead, new code
-- joins.
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000009", "role": "authenticated", "email": "pgtap-in9@fieldscout.local"}', true);
select is(
  (select (public.join_league_by_code((select c from _old_code)))->>'reason'),
  'not_found', 'rotation: the OLD code stops joining the moment it rotates');
create temp table _j9 as
select public.join_league_by_code((select r->>'invite_code' from _rot)) as r;
select is((select r->>'ok' from _j9), 'true',
  'rotation: the NEW code joins');
select results_eq(
  $$ select lm.role, lm.faab_balance, (lm.team_id is not null), (tm.ended_at is null)
     from league_members lm
     join team_managers tm on tm.team_id = lm.team_id and tm.user_id = lm.user_id
     where lm.league_id = (select (r->>'league_id')::uuid from _l2)
       and lm.user_id = '99000000-0000-4000-8000-000000000009' $$,
  $$ values ('manager', 100, true, true) $$,
  'join-by-code creates team + membership + OPEN stint, faab seeded from faab_budget (task item 2)');
select is(
  (select (public.join_league_by_code((select r->>'invite_code' from _rot)))->>'already_member'),
  'true', 'joining again is an idempotent already-member success (D63); no duplicate team');

-- C3/C4 regression: u9 is a FREE user seated in TWO leagues (the 018 cap —
-- lists.is_team only, D35 — must not fire on league teams).
select is(
  (select p.is_pro from profiles p where p.id = '99000000-0000-4000-8000-000000000009'),
  false, 'the two-league joiner is a FREE user (pinned first so the pin is real — F5)');
select results_eq(
  $$ select count(distinct lm.league_id)::int, count(distinct t.id)::int
     from league_members lm
     join teams t on t.id = lm.team_id
     where lm.user_id = '99000000-0000-4000-8000-000000000009' $$,
  $$ values (2, 2) $$,
  'C3/C4: a FREE user holds seats + teams in TWO leagues — no Pro gate, no 018 cap (F5 join half)');

-- u10 joins via the slug, case-variant, post-rotation.
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000010", "role": "authenticated", "email": "pgtap-in10@fieldscout.local"}', true);
select is(
  (select (public.join_league_by_code('PGTAP-LEAGUE-SLUG'))->>'ok'),
  'true', 'the custom slug still resolves after rotation, case-insensitively (task pin; §16.1 fallback order)');
select is(
  (select (public.join_league_by_code('utterly-unknown-code'))->>'reason'),
  'not_found', 'an unknown code/slug refuses with not_found');

-- Fill L2 to 7 franchises (privileged fillers), then the JOIN-path capacity
-- boundary: u11 takes seat 8, u12 refuses league_full with no writes.
reset role;
insert into teams (owner_id, name, league_id, list_id)
select '99000000-0000-4000-8000-000000000001',
       'pgtap-l2-filler-' || g, (select (r->>'league_id')::uuid from _l2), null
from generate_series(1, 4) g;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000011", "role": "authenticated", "email": "pgtap-in11@fieldscout.local"}', true);
select is(
  (select (public.join_league_by_code((select r->>'invite_code' from _rot)))->>'ok'),
  'true', 'JOIN capacity boundary: the join with one seat open creates the team_count-th team');
select is(
  (select count(*)::int from teams t
   where t.league_id = (select (r->>'league_id')::uuid from _l2) and t.status <> 'retired'),
  8, 'L2 now seats exactly team_count (8)');
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000012", "role": "authenticated", "email": "pgtap-in12@fieldscout.local"}', true);
select is(
  (select (public.join_league_by_code((select r->>'invite_code' from _rot)))->>'reason'),
  'league_full', 'D47: joining a FULL league by code returns the friendly "league is full"');
select is(
  (select count(*)::int from teams t
   where t.league_id = (select (r->>'league_id')::uuid from _l2) and t.status <> 'retired'),
  8, 'the refused join created NO teams row — count stays ≤ team_count');

-- Commissioner-only negatives, exercised by a MEMBER (u10 is a plain
-- manager in L2 — the copy-pasted-is_league_member failure mode, D54(2)).
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000010", "role": "authenticated", "email": "pgtap-in10@fieldscout.local"}', true);
select throws_ok(
  $$ select public.create_league_invite((select (r->>'league_id')::uuid from _l2), null, null, null, 1) $$,
  '42501', null, 'a MEMBER (non-commish) cannot create invites');
select throws_ok(
  $$ select public.rotate_invite_code((select (r->>'league_id')::uuid from _l2)) $$,
  '42501', null, 'a member cannot rotate the code');
select throws_ok(
  $$ select public.set_league_invite_slug((select (r->>'league_id')::uuid from _l2), 'member-slug') $$,
  '42501', null, 'a member cannot set the slug');
select throws_ok(
  $$ select public.revoke_league_invite((select (r->>'invite_id')::uuid from _inv_fill)) $$,
  '42501', null, 'a member of ANOTHER league cannot revoke an L1 invite (in-body commish check)');
select throws_ok(
  $$ select public.revoke_league_invite('00000000-0000-4000-8000-00000000dead') $$,
  '42501', null, 'a nonexistent invite yields the SAME 42501 (no existence leak)');

-- ---------------------------------------------------------------------------
-- G. F28 shrink floor (061 amendment): L3 (team_count 10) gets 8 privileged
--    filler franchises → 9 seated; shrink below refuses, shrink to exactly
--    the seated count succeeds, and a post-shrink join refuses league_full.
-- ---------------------------------------------------------------------------
reset role;
insert into teams (owner_id, name, league_id, list_id)
select '99000000-0000-4000-8000-000000000001',
       'pgtap-l3-filler-' || g, (select (r->>'league_id')::uuid from _l3), null
from generate_series(1, 8) g;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-in1@fieldscout.local"}', true);

select throws_ok(
  $$ select public.update_league_settings(
       (select (r->>'league_id')::uuid from _l3), 8,
       '{"divisions": 0}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
       null, 'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'P0001',
  'update_league_settings: team_count 8 is below the 9 franchises already seated in this league — remove a team first (§7.2 capacity; F28)',
  'F28: shrinking team_count below the seated count refuses (exact message)');
select is(
  (select l.team_count from leagues l where l.id = (select (r->>'league_id')::uuid from _l3)),
  10, 'F28: the refused shrink wrote nothing (team_count still 10)');

reset role;
delete from teams
  where league_id = (select (r->>'league_id')::uuid from _l3)
    and name = 'pgtap-l3-filler-8';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-in1@fieldscout.local"}', true);
select lives_ok(
  $$ select public.update_league_settings(
       (select (r->>'league_id')::uuid from _l3), 8,
       '{"divisions": 0}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
       null, 'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'F28 boundary: shrinking to EXACTLY the seated count (8) succeeds');
select results_eq(
  $$ select l.team_count, l.max_teams from leagues l
     where l.id = (select (r->>'league_id')::uuid from _l3) $$,
  $$ values (8, 8) $$,
  'the boundary shrink landed with max_teams re-synced (§12.1)');
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000012", "role": "authenticated", "email": "pgtap-in12@fieldscout.local"}', true);
select is(
  (select (public.join_league_by_code((select c from _l3code)))->>'reason'),
  'league_full',
  'F28 ⇄ D47 coherence: after the shrink the league is exactly full — a join refuses league_full (both writers hold teams ≤ team_count)');

select * from finish();
rollback;
