-- ============================================================================
-- 118 — THE BACKSTOP PROOF (migration 170; M6 L.E1.31; tasks-M6 TD10 (i)–(iii)
--       and TD16; spec §10.3, §12.12, §15.4; PROGRESS D441, D343, D449,
--       D450, D451; F513, F515; standing rules (a), (b), (h), (i))
-- ============================================================================
-- "No override path can mutate state without a log row" (M6 exit criterion
-- 2), proven three ways, plus the manager-verb census:
--
--   §C  TD10 (i) THE CATALOG CENSUS over pg_proc. Every function whose CODE
--       (comments and string literals stripped) checks is_league_commish( or
--       compares a role to 'commissioner' / 'co_commissioner', and that
--       writes a table (itself or through anything it calls), must reach
--       log_commissioner_action_internal through its call graph — or sit on
--       a four-entry allowlist, each entry with its reason. The census is
--       pinned as a stored literal (58 writers, 54 receipt, 4 allowlisted —
--       56 / 52 until 171 made the two draft-room manager verbs doors); a
--       new unreceipted gated writer reds C5 BY NAME (C9 proves the query
--       names a planted one, C1–C3 prove the instrument reads code); C11 /
--       C12 make a new gate shape red too — every function carrying a
--       commissioner role literal is gated or named as a literal (R1332).
--   §M  TD10 (ii) THE BEHAVIOURAL MATRIX. Every receipt-reaching writer the
--       census found is called for real (M1 proves coverage both ways), 61
--       calls across five worlds, each run as the commissioner through its
--       DEFINER door: a change writes EXACTLY one receipt of its type,
--       acting for the right team (D451); its no-op (a replay, the same
--       value again, the verb's own early return) lands and writes none; the
--       tick's system arms write none. A raise is caught and named in the
--       failing cell, so one broken verb reds its own rows, not the file.
--   §T  TD16 THE MANAGER-VERB CENSUS. Fifteen manager verbs, each with how
--       the commissioner does it for ANY team: the verb's own commissioner
--       arm, or override mode's twin (roster_add_drop → commish_force_add_
--       drop, rename_own_team → commish_rename_team — the manager verbs keep
--       their manager-only gate by design and their refusal copy names the
--       twin), or not delegable (trade_vote — a ballot takes no team; approve
--       / veto act on the trade). The F521 defect (draft_place_bid,
--       draft_queue_replace — pinned as they stood, T8 / T9, until 171) is
--       built: both are arms now (L.E1.38, D452). A manager verb
--       that refuses him reds T2 BY NAME.
--   §G  TD10 (iii) THE LOG-POINTER GUARDS (170). The five columns that point
--       at the log are written by their verbs through the guards (G1–G4);
--       a direct owner-role write of each, outside a verb, is refused BY NAME
--       (G5–G9); the one shape that passes is the pointer equal to the
--       receipt the transaction holds in app.commish_action_id, of the row's
--       own league (G10–G14); a clear, another receipt, another league's
--       receipt are refused (G15–G17); INSERT is guarded (G18–G19); the
--       service role and replica mode do not stand outside it (G20–G21);
--       144's backfill is held to its own shape — an empty week, a ledgered
--       receipt — and a set pointer is never re-pointed that way (G22–G27,
--       R1329); a week stamped at open, relabelled backfill, is refused
--       too (G26c / G26d, R1336).
--   §Q  THE POLICY ROUTE (R1330). A league's scoring rules written straight
--       through the table by its commissioner are refused by name; the same
--       change through scoring_update_rules lands with its receipt; a
--       personal system stays editable. And a POLICY CENSUS: EVERY client
--       write policy in public and on storage.objects carries a verdict, so
--       no table rule decides what counts as league state (Q11–Q14, R1337).
--   §A  Form, D137 in the database (pg_temp.un170 reverses 170 to each
--       newest definer's file text), the pointer census (every FK into the
--       log is guarded), the guards' firing order.
--
-- Worlds (all fabricated inside this rolled-back transaction; u1 is the
-- commissioner of every one; each world sets the calendar it needs, in
-- order — the calls of a world run before the next rewrites nfl_weeks):
--   S  LS b118…11 setup, LZ b118…12 (deleted) — membership, invites, setup
--   D  LD b118…21 snake (scheduled), LA b118…22 auction (live), LT b118…23
--      (the tick's arms) — the season far ahead (116's calendar)
--   R  LR b118…31 in season, every week ahead — the Remix
--   I  LI b118…51 in season, week 8 live, weeks 1–7 final (074's relative
--      calendar) — the overrides, the lineup arm, claims, trades
--   P  LP b118…41 playoffs, round 1 built by the jobs (082's L1, shifted to
--      the transaction instant) — the bracket hand-pick
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(252);

-- pg_temp.un170 — 170's three hunks reversed (generated by derive_170.py
-- with the migration; each replacement text is unique to its body).

create function pg_temp.un170(p_src text) returns text language sql as $un170$
  select replace(replace(replace(p_src,
    -- commish_edit_lineup_internal
    E'        \'score_stale_reason\',  v_stale_why),\n      -- 170/L.E1.31 (D451) — acting_as_team_id = THE TEAM. The commissioner\n      -- set this team\'s lineup: a manager\'s act done for the team (§10.3:711\n      -- "set when the commissioner acts on behalf of any team, most commonly\n      -- an orphaned one"). set_lineup\'s commissioner arm has written the same\n      -- action_type with it since 169; one action_type, one shape. His OWN\n      -- team is his own act, not one on its behalf: NULL (169\'s arm, R1334).\n      CASE WHEN EXISTS (SELECT 1 FROM public.league_members m\n                        WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id)\n           THEN NULL ELSE p_team_id END);\n    IF v_audit_id IS NULL THEN',
    E'        \'score_stale_reason\',  v_stale_why),\n      NULL);\n    IF v_audit_id IS NULL THEN'),
    -- commish_roster_override_internal
    E'        \'score_stale_reason\',  v_stale_why),\n      -- 170/L.E1.31 (D451) — acting_as_team_id = THE TEAM on the force\n      -- add / drop arm: the commissioner made this team\'s roster move, the\n      -- act roster_add_drop gives its manager (§10.3:711; TD16 — the manager\n      -- verb\'s commissioner door is this override, standing rule (h)). A MOVE\n      -- acts on two teams and for neither: NULL, both ride in\n      -- affected_team_ids (D353). His OWN team is his own act: NULL (R1334).\n      CASE WHEN v_is_move OR EXISTS (SELECT 1 FROM public.league_members m\n                                     WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id)\n           THEN NULL ELSE p_team_id END);\n    IF v_audit_id IS NULL THEN',
    E'        \'score_stale_reason\',  v_stale_why),\n      NULL);\n    IF v_audit_id IS NULL THEN'),
    -- commish_rename_team_internal
    E'        \'frozen_receipts_for_this_team\', v_frozen),\n      -- 170/L.E1.31 (D451) — acting_as_team_id = THE TEAM: the commissioner\n      -- renamed it, the act rename_own_team gives its manager (§10.3:711;\n      -- TD16 — the manager verb\'s commissioner door is this override). His\n      -- OWN team is his own act: NULL (R1334).\n      CASE WHEN EXISTS (SELECT 1 FROM public.league_members m\n                        WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id)\n           THEN NULL ELSE p_team_id END);\n    IF v_audit_id IS NULL THEN',
    E'        \'frozen_receipts_for_this_team\', v_frozen),\n      NULL);\n    IF v_audit_id IS NULL THEN')
$un170$;

-- ---------------------------------------------------------------------------
-- 0. THE INSTRUMENTS
-- ---------------------------------------------------------------------------
-- pg_temp.src_code(prosrc): the body with every -- line comment, every /* */
-- block comment and every '…' string literal replaced by a space — one
-- left-to-right regex pass, so a quote inside a comment and a -- inside a
-- string are each swallowed by whichever token opened first. What is left
-- is CODE: a helper named only in a comment or a message is not a call.
create function pg_temp.src_code(p_src text) returns text language sql immutable as $f$
  select regexp_replace(
           regexp_replace(p_src, $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g'),
           '\s+', ' ', 'g')
$f$;
-- pg_temp.src_nc(prosrc): comments stripped, string literals KEPT (a role
-- literal such as 'co_commissioner' is code there).
create function pg_temp.src_nc(p_src text) returns text language sql immutable as $f$
  select regexp_replace(p_src, $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/$re$, ' ', 'g')
$f$;

-- pg_temp.census(): TD10 (i) over pg_proc, schema public, extension objects
-- excluded. A function is COMMISSIONER-GATED when its code calls
-- is_league_commish( or compares a role to 'commissioner' /
-- 'co_commissioner'; it is a WRITER when its code — or the code of any
-- function it reaches — INSERTs into, UPDATEs or DELETEs FROM a public table;
-- it REACHES THE RECEIPT when log_commissioner_action_internal is in its
-- transitive call graph (a call = the callee's name followed by "(" in CODE,
-- so the seams draft_commish_receipt_internal / trade_receipt_internal /
-- waiver_claim_receipt_internal are followed through, F513(a) / F515(a)).
create function pg_temp.census()
returns table (fn text, writes text, receipt boolean)
language plpgsql stable as $f$
#variable_conflict use_column
begin
  -- plpgsql, so the planner cannot inline the recursive graph into a caller
  -- and re-walk it per outer row.
  return query
  with recursive
  fnx as (
    select p.proname::text as fn,
           pg_temp.src_nc(p.prosrc) as nc,
           pg_temp.src_code(p.prosrc) as code
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  ),
  tabs as (
    select c.relname::text as t from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  ),
  -- ONE regex per body (a constant pattern — compiled once): every
  -- identifier followed by "(" is a call site; the names of public
  -- functions among them are the edges. (A pairwise body × name match is
  -- 90,000 regexes with a new pattern each — minutes, not milliseconds.)
  calls as (
    select distinct f.fn, m[1] as callee
    from fnx f, regexp_matches(lower(f.code), '([a-z_][a-z0-9_]*)\s*\(', 'g') m
  ),
  edge as (
    select distinct c.fn as src, c.callee as dst
    from calls c where c.callee <> c.fn and exists (select 1 from fnx x where x.fn = c.callee)
  ),
  reach(src, dst) as (
    select src, dst from edge
    union
    select r.src, e.dst from reach r join edge e on e.src = r.dst
  ),
  direct_w as (
    select distinct f.fn, m[3] as t
    from fnx f, regexp_matches(lower(f.code), '(insert\s+into|update|delete\s+from)\s+(public\.)?([a-z_][a-z0-9_]*)', 'g') m
    where exists (select 1 from tabs where tabs.t = m[3])
  ),
  gated as (
    select fnx.fn from fnx
    where fnx.nc ~ 'is_league_commish\s*\('
       or fnx.nc ~* $re$role\s*(=|<>|in)\s*\(?\s*'(co_)?commissioner'$re$
  )
  select g.fn,
         (select string_agg(distinct w.t, ',' order by w.t) from direct_w w
          where w.fn = g.fn or w.fn in (select r.dst from reach r where r.src = g.fn)),
         exists (select 1 from reach r where r.src = g.fn and r.dst = 'log_commissioner_action_internal')
  from gated g;
end
$f$;

-- THE ALLOWLIST (short; each entry says why — TD10 (i), F513, F515).
create temp table _allow (fn text primary key, why text not null);
insert into _allow values
  ('leave_league',            'a manager leaving is his own act, not a commissioner action (the log is the commissioner''s, D338; F515(b)) — its role check only stops a commissioner leaving his own league'),
  ('claim_league_invite',     'the joiner''s own act (F515(b)) — its role check reads who the commissioner is, to notify him'),
  ('trade_vote_internal',     'a manager''s own ballot for his own team (Q77 / D415(1)); is_league_commish only words the refusal a teamless commissioner meets — his power over a vote is approve / veto, receipted by commish_force_or_reverse_trade'),
  ('snapshot_league_scoring', 'derived, pre-draft only: copies the rules the league already references into leagues.scoring_rules_snapshot (setup / scheduled), which draft start re-takes before anything scores (110:1138 / 168:3190) — no commissioner input reaches game state; the rules edits themselves are receipted (fork_scoring / edit_scoring / change_settings, 169)');

-- THE MATRIX (TD10 (ii)): one row per verb, filled by pg_temp.mx below.
create temp table _mx (
  seq         serial primary key,
  census_fns  text[] not null,   -- the census functions this call exercises (gate + receipt)
  verb        text not null,     -- the door called
  league      uuid not null,
  change_err  text,
  change_n    int,
  new_type    text,
  new_acting  uuid,
  want_n      int not null,      -- receipts a change writes: 1, or 0 for a system act
  want_type   text,
  want_acting uuid,
  noop_sql    text,
  noop_err    text,
  noop_n      int,
  noop_why    text
);

create function pg_temp.ids(p_league uuid) returns uuid[] language sql stable as $f$
  select coalesce(array_agg(c.id), '{}'::uuid[]) from public.commissioner_actions c where c.league_id = p_league
$f$;

-- pg_temp.mx: as p_uid (the JWT subject — auth.uid() in every verb), run the
-- CHANGE and count the receipts the league gained; read the new row's type
-- and acting_as_team_id; then run the NO-OP (a replay, the same value again,
-- or the verb's own early return) and count again. A raise is caught and
-- recorded by name — one broken verb reds its own cells, not the file.
create function pg_temp.mx(p_census text[], p_verb text, p_league uuid, p_uid uuid,
                           p_change text, p_noop text, p_want_type text, p_want_acting uuid,
                           p_noop_why text default null, p_want_n int default 1)
returns void language plpgsql as $f$
declare
  v_b uuid[]; v_a uuid[]; v_err text; v_nerr text; v_n int; v_nn int; v_type text; v_act uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  v_b := pg_temp.ids(p_league);
  begin
    execute p_change;
  exception when others then
    v_err := sqlstate || ' ' || sqlerrm;
  end;
  v_a := pg_temp.ids(p_league);
  v_n := cardinality(v_a) - cardinality(v_b);
  select c.action_type, c.acting_as_team_id into v_type, v_act
  from public.commissioner_actions c
  where c.league_id = p_league and not (c.id = any (v_b))
  order by c.id limit 1;
  if p_noop is not null then
    begin
      execute p_noop;
    exception when others then
      v_nerr := sqlstate || ' ' || sqlerrm;
    end;
    v_nn := cardinality(pg_temp.ids(p_league)) - cardinality(v_a);
  end if;
  insert into _mx (census_fns, verb, league, change_err, change_n, new_type, new_acting, want_n, want_type, want_acting,
                   noop_sql, noop_err, noop_n, noop_why)
  values (p_census, p_verb, p_league, v_err, v_n, v_type, v_act, p_want_n, p_want_type, p_want_acting,
          p_noop, v_nerr, v_nn, p_noop_why);
  perform set_config('request.jwt.claims', '', true);
end
$f$;

-- ---------------------------------------------------------------------------
-- A. Form, and D137 in the database
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_action_pointer_guard_internal', 'commish_edit_lineup_internal',
                       'commish_roster_override_internal', 'commish_rename_team_internal',
                       'scoring_systems_league_rules_guard_internal', 'scoring_system_league_use_internal')),
  'commish_action_pointer_guard_internal:f:search_path="":f:f commish_edit_lineup_internal:f:search_path="":f:f '
  || 'commish_rename_team_internal:f:search_path="":f:f commish_roster_override_internal:f:search_path="":f:f '
  || 'scoring_system_league_use_internal:t:search_path="":f:t scoring_systems_league_rules_guard_internal:f:search_path="":f:f',
  'A1 the two trigger functions and the three replaced bodies: one overload each, PLAIN, search_path empty, closed to anon and authenticated; the one helper DEFINER, search_path empty, callable by authenticated only (the scoring trigger runs as the caller)');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and a.privilege_type = 'EXECUTE' and a.grantee = 0
      and p.proname in ('commish_action_pointer_guard_internal', 'commish_edit_lineup_internal',
                        'commish_roster_override_internal', 'commish_rename_team_internal',
                        'scoring_systems_league_rules_guard_internal', 'scoring_system_league_use_internal')),
  'A2 PUBLIC holds EXECUTE on none of the six (REVOKEs restated)');
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un170(p.prosrc)), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_edit_lineup_internal', 'commish_roster_override_internal', 'commish_rename_team_internal')),
  'commish_edit_lineup_internal=cee39d868365ebe257365cfc56804ad3 commish_rename_team_internal=7c4a25c57ce299c0e80d7d9b4482c994 '
  || 'commish_roster_override_internal=a078d3e98fd386bdf4d77c587f87523e',
  'A3 D137: each live body with 170 reversed is its NEWEST definer FILE TEXT (166:144 / 131:2304 / 164:209 — stored md5 literals)');
select is(
  (select string_agg(p.proname || '=' || md5(p.prosrc), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_action_pointer_guard_internal', 'commish_edit_lineup_internal',
                       'commish_roster_override_internal', 'commish_rename_team_internal',
                       'scoring_systems_league_rules_guard_internal', 'scoring_system_league_use_internal')),
  'commish_action_pointer_guard_internal=069afb1780a25cf45852683947cd7b7d commish_edit_lineup_internal=dfef11dc37d1770ef64f1b876185e39c '
  || 'commish_rename_team_internal=5248f36bd9f29217c7775d3d24fe9776 commish_roster_override_internal=c5ccb46010badc722cd77c356cd0bd15 '
  || 'scoring_system_league_use_internal=e04d488051a3a637c5f6d87312284254 scoring_systems_league_rules_guard_internal=9464bce068098165c39590bc49a19f11',
  'A4 the six live prosrc md5s — 170 as written (stored literals)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname not in ('commish_edit_lineup_internal', 'commish_roster_override_internal', 'commish_rename_team_internal')
     and pg_temp.un170(p.prosrc) <> p.prosrc),
  0,
  'A5 un170 is an identity on every other body in the schema — so the older suites that apply it innermost pin exactly what they pinned (additive, R992)');
select is(
  (select format('%s:%s', count(*), md5(string_agg(t.tgenabled::text || ':' || pg_get_triggerdef(t.oid), ' '
                                                   order by t.tgrelid::regclass::text, t.tgname)))
   from pg_trigger t where t.tgname like 'trg\_zz\_%\_guard\_%' and not t.tgisinternal),
  '10:f1f0bdabf56bbe3c829897e7ac316799',
  'A6 the ten pointer guards as 170 wrote them (stored md5 of every definition): BEFORE INSERT / UPDATE, FOR EACH ROW, the WHEN clause, ENABLE ALWAYS');
select is(
  (select count(*)::int from pg_trigger t where t.tgname like 'trg\_zz\_%\_guard\_%' and t.tgenabled = 'A'),
  10, 'A7 all ten are ENABLE ALWAYS (R616 — the default O is skipped under replica mode)');
-- A8: THE POINTER CENSUS — every column outside the log that holds a
-- foreign key INTO commissioner_actions is guarded on INSERT and on UPDATE
-- (a new pointer column with no guard reds here BY NAME).
select is(
  (select string_agg(format('%s.%s:%s', c.conrelid::regclass, a.attname,
                            (select count(*) from pg_trigger t
                             where t.tgrelid = c.conrelid and t.tgname like 'trg\_zz\_' || a.attname || '\_guard\_%' and t.tgenabled = 'A')),
                     ' ' order by c.conrelid::regclass::text, a.attname)
   from pg_constraint c
   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.contype = 'f' and c.confrelid = 'public.commissioner_actions'::regclass
     and c.conrelid <> 'public.commissioner_actions'::regclass),
  'league_weeks.reopened_by_action_id:2 league_weeks.scoring_rules_action_id:2 matchups.override_action_id:2 '
  || 'matchups.pairing_set_by_action_id:2 transactions.related_action_id:2',
  'A8 POINTER CENSUS: the five columns that point at the log (every FK into commissioner_actions outside the log itself) each carry both guards');
-- A9: each guard fires AFTER every other BEFORE row trigger on its table
-- (name order): it judges the row as 144 and 110 leave it, and their
-- refusals keep their own words.
select is(
  (select string_agg(x.rel || ':' || x.ok, ' ' order by x.rel)
   from (select t.tgrelid::regclass::text as rel,
                (coalesce(max(t.tgname) filter (where t.tgname not like 'trg\_zz\_%'), '') < min(t.tgname) filter (where t.tgname like 'trg\_zz\_%'))::text as ok
         from pg_trigger t
         where t.tgrelid in ('public.matchups'::regclass, 'public.league_weeks'::regclass, 'public.transactions'::regclass)
           and not t.tgisinternal and (t.tgtype & 2) = 2 and (t.tgtype & 1) = 1
         group by t.tgrelid) x),
  'league_weeks:true matchups:true transactions:true',
  'A9 on each guarded table the guards fire after every other BEFORE row trigger');

-- ---------------------------------------------------------------------------
-- B. The accounts, and the premise every count below rests on
-- ---------------------------------------------------------------------------

-- The accounts: u1 the commissioner of every world, u2 / u3 managers, u4 / u5
-- seatless (assign / takeover), u6 an outsider, u7 the username invite.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('98118000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-x118-u' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       ('{"username": "x118_user_' || i || '"}')::jsonb, now(), now()
from generate_series(1, 7) i;

select is((select count(*)::int from leagues where id::text like 'b1180000-%'), 0,
  'B1 PREMISE: no fixture league exists before this file makes it — every receipt counted below is a delta this file caused');

-- ---------------------------------------------------------------------------
-- S. THE SETUP WORLD (LS, LZ — pre-draft): membership, invites, settings,
--    scoring, profile, lifecycle (169's fifteen). u1 commissioner (t1), u2
--    (t2), u3 (t3); LZ is deleted.
-- ---------------------------------------------------------------------------
insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams,
                     playoff_start_week, scoring_system_id, faab_budget, settings) values
  ('b1180000-0000-4000-8000-000000000011', '98118000-0000-4000-8000-000000000001', 'pgtap-x118-LS', 2026, 'setup', 8, 14, 4, 15,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'), 100,
   '{"median_game": false, "draft": {"draft_type": "snake", "draft_scheduled_at": "2099-09-01T18:00:00+00:00"}}'),
  ('b1180000-0000-4000-8000-000000000012', '98118000-0000-4000-8000-000000000001', 'pgtap-x118-LZ', 2026, 'setup', 8, 14, 4, 15,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'), 100, '{}');
insert into teams (id, owner_id, name, league_id)
select ('c118001' || l || '-0000-4000-8000-00000000000' || i)::uuid,
       ('98118000-0000-4000-8000-00000000000' || i)::uuid,
       'x118-S' || l || '-t' || i, ('b1180000-0000-4000-8000-00000000001' || l)::uuid
from generate_series(1, 2) l, generate_series(1, 3) i;
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, t.owner_id, t.id,
       case when t.owner_id = '98118000-0000-4000-8000-000000000001' then 'commissioner' else 'manager' end, false, 100
from teams t where t.id::text like 'c118001%';
insert into team_managers (league_id, team_id, user_id, role)
select t.league_id, t.id, t.owner_id, 'manager' from teams t where t.id::text like 'c118001%';

-- update_league_settings with the stored values, overridden by a patch
-- (117's pg_temp.save).
create function pg_temp.save(p_league uuid, p_patch jsonb) returns void language plpgsql as $f$
declare l public.leagues;
begin
  select * into l from public.leagues where id = p_league;
  perform public.update_league_settings(
    p_league, coalesce((p_patch ->> 'team_count')::int, l.team_count),
    l.settings || coalesce(p_patch -> 'settings', '{}'::jsonb), l.roster_settings, null,
    l.format, l.regular_season_weeks, l.playoff_teams, l.playoff_start_week, l.waiver_type,
    coalesce((p_patch ->> 'faab_budget')::int, l.faab_budget), l.trade_review, l.trade_deadline_week, l.lineup_lock);
end
$f$;

select pg_temp.mx('{add_placeholder_seat}', 'add_placeholder_seat', 'b1180000-0000-4000-8000-000000000011', '98118000-0000-4000-8000-000000000001',
  $$ select public.add_placeholder_seat('b1180000-0000-4000-8000-000000000011', '') $$,
  null, 'add_seat', null, 'none exists — every call adds a seat');
select pg_temp.mx('{set_member_role}', 'set_member_role', 'b1180000-0000-4000-8000-000000000011', '98118000-0000-4000-8000-000000000001',
  $$ select public.set_member_role('b1180000-0000-4000-8000-000000000011',
       (select id from league_members where league_id = 'b1180000-0000-4000-8000-000000000011' and user_id = '98118000-0000-4000-8000-000000000003'),
       'co_commissioner') $$,
  $$ select public.set_member_role('b1180000-0000-4000-8000-000000000011',
       (select id from league_members where league_id = 'b1180000-0000-4000-8000-000000000011' and user_id = '98118000-0000-4000-8000-000000000003'),
       'co_commissioner') $$,
  'promote_member', null);
select pg_temp.mx('{assign_manager}', 'assign_manager', 'b1180000-0000-4000-8000-000000000011', '98118000-0000-4000-8000-000000000001',
  $$ select public.assign_manager('b1180000-0000-4000-8000-000000000011',
       (select t.id from teams t where t.league_id = 'b1180000-0000-4000-8000-000000000011' and t.name = 'Team 4'),
       '98118000-0000-4000-8000-000000000004') $$,
  $$ select public.assign_manager('b1180000-0000-4000-8000-000000000011',
       (select t.id from teams t where t.league_id = 'b1180000-0000-4000-8000-000000000011' and t.name = 'Team 4'),
       '98118000-0000-4000-8000-000000000004') $$,
  'assign_manager', null);
select pg_temp.mx('{remove_manager}', 'remove_manager', 'b1180000-0000-4000-8000-000000000011', '98118000-0000-4000-8000-000000000001',
  $$ select public.remove_manager('b1180000-0000-4000-8000-000000000011',
       (select id from league_members where league_id = 'b1180000-0000-4000-8000-000000000011' and user_id = '98118000-0000-4000-8000-000000000004'),
       'vacate', null, null) $$,
  $$ select public.remove_manager('b1180000-0000-4000-8000-000000000011',
       (select m.id from league_members m join teams t on t.id = m.team_id
        where m.league_id = 'b1180000-0000-4000-8000-000000000011' and t.name = 'Team 4'),
       'vacate', null, null) $$,
  'vacate_seat', null);
select pg_temp.mx('{create_league_invite}', 'create_league_invite', 'b1180000-0000-4000-8000-000000000011', '98118000-0000-4000-8000-000000000001',
  $$ select public.create_league_invite('b1180000-0000-4000-8000-000000000011', null, null, null, 5) $$,
  null, 'create_invite', null, 'none exists — every call makes an invite (or re-sends one, itself a change)');
select pg_temp.mx('{revoke_league_invite}', 'revoke_league_invite', 'b1180000-0000-4000-8000-000000000011', '98118000-0000-4000-8000-000000000001',
  $$ select public.revoke_league_invite('b1180000-0000-4000-8000-000000000011',
       (select i.id from league_invites i where i.league_id = 'b1180000-0000-4000-8000-000000000011' limit 1)) $$,
  $$ select public.revoke_league_invite('b1180000-0000-4000-8000-000000000011',
       (select i.id from league_invites i where i.league_id = 'b1180000-0000-4000-8000-000000000011' limit 1)) $$,
  'revoke_invite', null);
select pg_temp.mx('{rotate_invite_code}', 'rotate_invite_code', 'b1180000-0000-4000-8000-000000000011', '98118000-0000-4000-8000-000000000001',
  $$ select public.rotate_invite_code('b1180000-0000-4000-8000-000000000011') $$,
  null, 'rotate_invite_code', null, 'none exists — every rotation mints a new code');
select pg_temp.mx('{set_league_invite_slug}', 'set_league_invite_slug', 'b1180000-0000-4000-8000-000000000011', '98118000-0000-4000-8000-000000000001',
  $$ select public.set_league_invite_slug('b1180000-0000-4000-8000-000000000011', 'pgtap-x118-slug') $$,
  $$ select public.set_league_invite_slug('b1180000-0000-4000-8000-000000000011', 'pgtap-x118-slug') $$,
  'set_invite_slug', null);
select pg_temp.mx('{update_league_settings}', 'update_league_settings', 'b1180000-0000-4000-8000-000000000011', '98118000-0000-4000-8000-000000000001',
  $$ select pg_temp.save('b1180000-0000-4000-8000-000000000011', '{"faab_budget": 150}') $$,
  $$ select pg_temp.save('b1180000-0000-4000-8000-000000000011', '{}') $$,
  'change_settings', null);
select pg_temp.mx('{scoring_fork_template}', 'scoring_fork_template', 'b1180000-0000-4000-8000-000000000011', '98118000-0000-4000-8000-000000000001',
  $$ select public.scoring_fork_template('b1180000-0000-4000-8000-000000000011',
       (select id from scoring_systems where is_template and name = 'ESPN Standard')) $$,
  $$ select public.scoring_fork_template('b1180000-0000-4000-8000-000000000011',
       (select id from scoring_systems where is_template and name = 'ESPN Standard')) $$,
  'fork_scoring', null);
select pg_temp.mx('{scoring_update_rules}', 'scoring_update_rules', 'b1180000-0000-4000-8000-000000000011', '98118000-0000-4000-8000-000000000001',
  $$ select public.scoring_update_rules('b1180000-0000-4000-8000-000000000011',
       (select jsonb_set(s.rules, '{base,receptions}', '1') from scoring_systems s
        where s.id = (select scoring_system_id from leagues where id = 'b1180000-0000-4000-8000-000000000011'))) $$,
  $$ select public.scoring_update_rules('b1180000-0000-4000-8000-000000000011',
       (select s.rules from scoring_systems s where s.id = (select scoring_system_id from leagues where id = 'b1180000-0000-4000-8000-000000000011'))) $$,
  'edit_scoring', null);
select pg_temp.mx('{update_league_profile}', 'update_league_profile', 'b1180000-0000-4000-8000-000000000011', '98118000-0000-4000-8000-000000000001',
  $$ select public.update_league_profile('b1180000-0000-4000-8000-000000000011', 'pgtap-x118-LS renamed') $$,
  $$ select public.update_league_profile('b1180000-0000-4000-8000-000000000011', 'pgtap-x118-LS renamed') $$,
  'edit_league_profile', null);
select pg_temp.mx('{set_league_status}', 'set_league_status', 'b1180000-0000-4000-8000-000000000011', '98118000-0000-4000-8000-000000000001',
  $$ select public.set_league_status('b1180000-0000-4000-8000-000000000011', 'scheduled') $$,
  $$ select public.set_league_status('b1180000-0000-4000-8000-000000000011', 'scheduled') $$,
  'lifecycle_change', null);
select pg_temp.mx('{soft_delete_league}', 'soft_delete_league', 'b1180000-0000-4000-8000-000000000012', '98118000-0000-4000-8000-000000000001',
  $$ select public.soft_delete_league('b1180000-0000-4000-8000-000000000012') $$,
  $$ select public.soft_delete_league('b1180000-0000-4000-8000-000000000012') $$,
  'delete_league', null);

-- ---------------------------------------------------------------------------
-- D. THE DRAFT WORLD (168's sixteen): LD a scheduled snake draft, LA a live
--    auction in its nominating phase, LT a league the tick starts. The
--    calendar the draft room needs (116's): the season-2026 weeks far ahead,
--    so a real start and a draft end fit at any wall clock.
-- ---------------------------------------------------------------------------
update nfl_weeks
set starts_at = starts_at + interval '73 years',
    correction_window_ends_at = correction_window_ends_at + interval '73 years'
where season = 2026;

insert into players (id, full_name, position, adp)
select 'x118-d' || lpad(i::text, 2, '0'), 'X118 Draftee ' || lpad(i::text, 2, '0'), 'RB', i
from generate_series(1, 40) i;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings) values
  ('b1180000-0000-4000-8000-000000000021', '98118000-0000-4000-8000-000000000001', 'pgtap-x118-LD-snake', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "snake", "snake_reversal": false, "draft_order_mode": "manual",
     "draft_order": ["c1180021-0000-4000-8000-000000000001","c1180021-0000-4000-8000-000000000002",
                     "c1180021-0000-4000-8000-000000000003","c1180021-0000-4000-8000-000000000004",
                     "c1180021-0000-4000-8000-000000000005","c1180021-0000-4000-8000-000000000006",
                     "c1180021-0000-4000-8000-000000000007","c1180021-0000-4000-8000-000000000008"],
     "pick_timer_seconds": 30, "disconnect_grace_seconds": 30}}'),
  ('b1180000-0000-4000-8000-000000000023', '98118000-0000-4000-8000-000000000001', 'pgtap-x118-LT-tick', 2026, 'scheduled', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "snake", "pick_timer_seconds": 30, "draft_scheduled_at": "2000-01-01T00:00:00+00:00"}}');
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings, scoring_rules_snapshot) values
  ('b1180000-0000-4000-8000-000000000022', '98118000-0000-4000-8000-000000000001', 'pgtap-x118-LA-auction', 2026, 'drafting', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   '{"draft": {"draft_type": "auction", "auction_budget": 200, "auction_zero_dollar_nominations": false,
     "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
     "auction_anti_snipe_seconds": 10, "disconnect_grace_seconds": 30, "pick_timer_seconds": 90}}', '{}');
update leagues
set roster_settings = '{"starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1}],
                        "bench": 2, "ir_slots": [], "swap_spots": 0}'::jsonb
where id::text like 'b1180000-0000-4000-8000-00000000002%';
insert into teams (id, owner_id, name, league_id)
select ('c118002' || l || '-0000-4000-8000-00000000000' || i)::uuid, '98118000-0000-4000-8000-000000000001',
       'x118-D' || l || '-t' || i, ('b1180000-0000-4000-8000-00000000002' || l)::uuid
from generate_series(1, 3) l, generate_series(1, 8) i;
-- u1 commissioner (t1), u2 manager (t2) in each; t3–t8 placeholder rows. t2
-- is u2's franchise row too (the draft queue gates on teams.owner_id — T9).
update teams set owner_id = '98118000-0000-4000-8000-000000000002'
where id::text like 'c118002_-0000-4000-8000-000000000002';
insert into league_members (league_id, user_id, team_id, role, is_placeholder)
select ('b1180000-0000-4000-8000-00000000002' || l)::uuid,
       case i when 1 then '98118000-0000-4000-8000-000000000001'::uuid when 2 then '98118000-0000-4000-8000-000000000002'::uuid end,
       ('c118002' || l || '-0000-4000-8000-00000000000' || i)::uuid,
       case i when 1 then 'commissioner' else 'manager' end, i > 2
from generate_series(1, 3) l, generate_series(1, 8) i;

-- LA: a live auction in the NOMINATING phase at nomination 2, t1 on the
-- clock; nomination 1 was won by t3 at 7 dollars (116's LA).
insert into drafts (id, league_id, draft_type, status, is_mock, config,
                    draft_order, nomination_order, total_rounds, current_round,
                    current_pick_number, on_clock_team_id, current_deadline, started_at)
values ('e1180000-0000-4000-8000-000000000022', 'b1180000-0000-4000-8000-000000000022',
        'auction', 'live', false,
        '{"auction_budget": 200, "auction_zero_dollar_nominations": false,
          "auction_nomination_seconds": 45, "auction_bid_seconds": 30,
          "auction_anti_snipe_seconds": 10, "disconnect_grace_seconds": 30,
          "pick_timer_seconds": 90}',
        (select jsonb_agg(t.id order by t.name) from teams t where t.league_id = 'b1180000-0000-4000-8000-000000000022'),
        (select jsonb_agg(t.id order by t.name) from teams t where t.league_id = 'b1180000-0000-4000-8000-000000000022'),
        3, 1, 2, 'c1180022-0000-4000-8000-000000000001', now() + interval '1 hour', now() - interval '1 minute');
insert into draft_bids (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
values ('e1180000-0000-4000-8000-000000000022', 'b1180000-0000-4000-8000-000000000022',
        1, 'x118-d31', 'c1180022-0000-4000-8000-000000000003', 7, 'a1180022-0000-4000-8000-0000000000f1');
insert into draft_picks (id, draft_id, league_id, pick_number, round, team_id, player_id, price, is_auto, made_via)
values ('d1180022-0000-4000-8000-000000000001', 'e1180000-0000-4000-8000-000000000022',
        'b1180000-0000-4000-8000-000000000022', 1, null,
        'c1180022-0000-4000-8000-000000000003', 'x118-d31', 7, false, 'manager');

create function pg_temp.ld() returns uuid language sql stable as $f$
  select d.id from public.drafts d where d.league_id = 'b1180000-0000-4000-8000-000000000021' and not d.is_mock
$f$;

-- LD — create, start, and the snake controls (116 §C / §D / §F's order)
select pg_temp.mx('{draft_create,draft_create_internal}', 'draft_create', 'b1180000-0000-4000-8000-000000000021', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_create('b1180000-0000-4000-8000-000000000021') $$,
  $$ select public.draft_create('b1180000-0000-4000-8000-000000000021') $$,
  'draft_create', null);
select pg_temp.mx('{draft_start,draft_start_internal}', 'draft_start', 'b1180000-0000-4000-8000-000000000021', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_start('b1180000-0000-4000-8000-000000000021') $$,
  $$ select public.draft_start('b1180000-0000-4000-8000-000000000021') $$,
  'draft_start', null);
select pg_temp.mx('{draft_force_pick}', 'draft_force_pick', 'b1180000-0000-4000-8000-000000000021', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_force_pick(pg_temp.ld(), 'x118-d01', 'a1180021-0000-4000-8000-000000000001') $$,
  $$ select public.draft_force_pick(pg_temp.ld(), 'x118-d01', 'a1180021-0000-4000-8000-000000000001') $$,
  'draft_force_pick', 'c1180021-0000-4000-8000-000000000001', 'the replay of the same action id');
-- the manager makes his own pick 2; the commissioner picks 3 for the
-- placeholder t3 — the subjects of undo / reassign / move below.
select set_config('request.jwt.claims', '{"sub": "98118000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select public.draft_make_pick(pg_temp.ld(), 'x118-d02', 'a1180021-0000-4000-8000-000000000002');
select set_config('request.jwt.claims', '', true);
-- …and picks 3 FOR the placeholder t3 on the clock — the pick a manager
-- makes with draft_make_pick, done for a team he does not manage (TD16).
select pg_temp.mx('{draft_force_pick}', 'draft_force_pick', 'b1180000-0000-4000-8000-000000000021', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_force_pick(pg_temp.ld(), 'x118-d03', 'a1180021-0000-4000-8000-000000000003') $$,
  $$ select public.draft_force_pick(pg_temp.ld(), 'x118-d03', 'a1180021-0000-4000-8000-000000000003') $$,
  'draft_force_pick', 'c1180021-0000-4000-8000-000000000003', 'the replay of the same action id');
select pg_temp.mx('{draft_pause}', 'draft_pause', 'b1180000-0000-4000-8000-000000000021', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_pause(pg_temp.ld()) $$,
  $$ select public.draft_pause(pg_temp.ld()) $$,
  'draft_pause', null);
select pg_temp.mx('{draft_set_clock}', 'draft_set_clock', 'b1180000-0000-4000-8000-000000000021', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_set_clock(pg_temp.ld(), 45, false, null) $$,
  $$ select public.draft_set_clock(pg_temp.ld(), 45, false, null) $$,
  'draft_set_clock', null);
select pg_temp.mx('{draft_undo}', 'draft_undo', 'b1180000-0000-4000-8000-000000000021', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_undo(pg_temp.ld()) $$,
  null, 'draft_undo', null, 'none exists — each undo reverts the newest live pick');
select pg_temp.mx('{draft_reassign_pick}', 'draft_reassign_pick', 'b1180000-0000-4000-8000-000000000021', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_reassign_pick(pg_temp.ld(),
       (select p.id from draft_picks p where p.draft_id = pg_temp.ld() and p.pick_number = 1 and not p.is_undone), null, 'x118-d05') $$,
  $$ select public.draft_reassign_pick(pg_temp.ld(),
       (select p.id from draft_picks p where p.draft_id = pg_temp.ld() and p.pick_number = 1 and not p.is_undone),
       'c1180021-0000-4000-8000-000000000001') $$,
  'draft_reassign', null);
select pg_temp.mx('{draft_move_player}', 'draft_move_player', 'b1180000-0000-4000-8000-000000000021', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_move_player(pg_temp.ld(), 'x118-d05', 'c1180021-0000-4000-8000-000000000001', 'c1180021-0000-4000-8000-000000000004', null) $$,
  null, 'draft_move_player', null, 'none exists — a move names the team the player is on, so a second one is a different move');
select pg_temp.mx('{draft_set_order}', 'draft_set_order', 'b1180000-0000-4000-8000-000000000021', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_set_order(pg_temp.ld(),
       array['c1180021-0000-4000-8000-000000000002','c1180021-0000-4000-8000-000000000001','c1180021-0000-4000-8000-000000000003',
             'c1180021-0000-4000-8000-000000000004','c1180021-0000-4000-8000-000000000005','c1180021-0000-4000-8000-000000000006',
             'c1180021-0000-4000-8000-000000000007','c1180021-0000-4000-8000-000000000008']::uuid[]) $$,
  $$ select public.draft_set_order(pg_temp.ld(),
       array['c1180021-0000-4000-8000-000000000002','c1180021-0000-4000-8000-000000000001','c1180021-0000-4000-8000-000000000003',
             'c1180021-0000-4000-8000-000000000004','c1180021-0000-4000-8000-000000000005','c1180021-0000-4000-8000-000000000006',
             'c1180021-0000-4000-8000-000000000007','c1180021-0000-4000-8000-000000000008']::uuid[]) $$,
  'draft_set_order', null);
select pg_temp.mx('{set_team_autodraft}', 'set_team_autodraft', 'b1180000-0000-4000-8000-000000000021', '98118000-0000-4000-8000-000000000001',
  $$ select public.set_team_autodraft('b1180000-0000-4000-8000-000000000021', 'c1180021-0000-4000-8000-000000000002', true) $$,
  $$ select public.set_team_autodraft('b1180000-0000-4000-8000-000000000021', 'c1180021-0000-4000-8000-000000000002', true) $$,
  'set_autodraft', 'c1180021-0000-4000-8000-000000000002');
select pg_temp.mx('{draft_resume}', 'draft_resume', 'b1180000-0000-4000-8000-000000000021', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_resume(pg_temp.ld()) $$,
  $$ select public.draft_resume(pg_temp.ld()) $$,
  'draft_resume', null);
-- 171/L.E1.38 (F521): the commissioner sets the Targets of u2's team t2 — the
-- queue a manager sets with draft_queue_replace, done for a team he does not
-- manage (TD16's arm); the same queue again is the no-op.
select pg_temp.mx('{draft_queue_replace}', 'draft_queue_replace', 'b1180000-0000-4000-8000-000000000021', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_queue_replace(pg_temp.ld(), 'c1180021-0000-4000-8000-000000000002', array['x118-d20']) $$,
  $$ select public.draft_queue_replace(pg_temp.ld(), 'c1180021-0000-4000-8000-000000000002', array['x118-d20']) $$,
  'draft_set_queue', 'c1180021-0000-4000-8000-000000000002', 'the same queue again');
select pg_temp.mx('{draft_reset}', 'draft_reset', 'b1180000-0000-4000-8000-000000000021', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_reset(pg_temp.ld()) $$,
  null, 'draft_reset', null, 'none exists — a reset of a draft with nothing to clear is refused, not a no-op');

-- LA — the auction controls (116 §G's order): the force-nomination, then
-- pause (setup), cancel, budget, reverse, end.
select pg_temp.mx('{draft_force_pick}', 'draft_force_pick', 'b1180000-0000-4000-8000-000000000022', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_force_pick('e1180000-0000-4000-8000-000000000022', 'x118-d10', 'a1180022-0000-4000-8000-000000000010') $$,
  $$ select public.draft_force_pick('e1180000-0000-4000-8000-000000000022', 'x118-d10', 'a1180022-0000-4000-8000-000000000010') $$,
  'draft_force_pick', 'c1180022-0000-4000-8000-000000000001', 'the replay of the same action id');
-- 171/L.E1.38 (F521): …and bids $2 on it FOR the placeholder t3 — the bid a
-- manager makes with draft_place_bid, done for a team he does not manage
-- (TD16's arm); the replay is the no-op.
select pg_temp.mx('{draft_place_bid}', 'draft_place_bid', 'b1180000-0000-4000-8000-000000000022', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_place_bid('e1180000-0000-4000-8000-000000000022', 2, 'a1180022-0000-4000-8000-000000000012',
       2, 'x118-d10', 'c1180022-0000-4000-8000-000000000003') $$,
  $$ select public.draft_place_bid('e1180000-0000-4000-8000-000000000022', 2, 'a1180022-0000-4000-8000-000000000012',
       2, 'x118-d10', 'c1180022-0000-4000-8000-000000000003') $$,
  'draft_bid', 'c1180022-0000-4000-8000-000000000003', 'the replay of the same action id');
select set_config('request.jwt.claims', '{"sub": "98118000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select public.draft_pause('e1180000-0000-4000-8000-000000000022');
select set_config('request.jwt.claims', '', true);
select pg_temp.mx('{draft_cancel_nomination}', 'draft_cancel_nomination', 'b1180000-0000-4000-8000-000000000022', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_cancel_nomination('e1180000-0000-4000-8000-000000000022') $$,
  null, 'draft_cancel_nomination', null, 'none exists — with the block empty a second cancel is refused by name');
select pg_temp.mx('{draft_adjust_budget}', 'draft_adjust_budget', 'b1180000-0000-4000-8000-000000000022', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_adjust_budget('e1180000-0000-4000-8000-000000000022', 'c1180022-0000-4000-8000-000000000002', 10, null,
       'a1180022-0000-4000-8000-000000000011') $$,
  $$ select public.draft_adjust_budget('e1180000-0000-4000-8000-000000000022', 'c1180022-0000-4000-8000-000000000002', 10, null,
       'a1180022-0000-4000-8000-000000000011') $$,
  'draft_adjust_budget', null, 'the replay of the same action id');
select pg_temp.mx('{draft_reverse_won_bid}', 'draft_reverse_won_bid', 'b1180000-0000-4000-8000-000000000022', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_reverse_won_bid('e1180000-0000-4000-8000-000000000022', 'd1180022-0000-4000-8000-000000000001') $$,
  null, 'draft_reverse_bid', null, 'none exists — a reversed pick is refused by name the second time');
select pg_temp.mx('{draft_end}', 'draft_end', 'b1180000-0000-4000-8000-000000000022', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_end('e1180000-0000-4000-8000-000000000022') $$,
  null, 'draft_end', null, 'none exists — a complete draft cannot be ended again');

-- LT — the tick's two arms (draft_tick creates and starts a draft whose
-- time has come through draft_create_internal / draft_start_internal with
-- p_require_commish FALSE; the tick itself sweeps every draft in the
-- database, so the suite drives its arms, as 116 §I does): a SYSTEM act with
-- no actor (§10.3, D338) — it reaches the seam and writes NOTHING (F513(b)).
select pg_temp.mx('{draft_tick}', 'draft_tick: create + start arms', 'b1180000-0000-4000-8000-000000000023', '98118000-0000-4000-8000-000000000001',
  $$ select public.draft_create_internal('b1180000-0000-4000-8000-000000000023', false),
            public.draft_start_internal('b1180000-0000-4000-8000-000000000023', false, now()) $$,
  null, null, null, 'none — the tick is a system act; its change writes no receipt either', 0);

-- ---------------------------------------------------------------------------
-- R. THE REMIX WORLD (LR — 111's Remix, 059's shape): every 2026 week ahead
--    of the transaction instant, the schedule generated, then remixed.
-- ---------------------------------------------------------------------------
update nfl_weeks w
set starts_at = now() + (w.week * interval '7 days'), first_kickoff_at = null, last_game_ends_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot, settings)
values ('b1180000-0000-4000-8000-000000000031', '98118000-0000-4000-8000-000000000001', 'pgtap-x118-LR', 2026, 'in_season', 8,
        (select id from scoring_systems where is_template and name = 'ESPN Standard'),
        (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
        '{"second_opponent": false, "schedule_seed": 20260902}'::jsonb);
insert into teams (id, owner_id, name, league_id)
select ('c1180031-0000-4000-8000-00000000000' || i)::uuid, '98118000-0000-4000-8000-000000000001',
       'x118-R-t' || i, 'b1180000-0000-4000-8000-000000000031'
from generate_series(1, 8) i;
insert into league_members (league_id, user_id, team_id, role) values
  ('b1180000-0000-4000-8000-000000000031', '98118000-0000-4000-8000-000000000001', 'c1180031-0000-4000-8000-000000000001', 'commissioner'),
  ('b1180000-0000-4000-8000-000000000031', '98118000-0000-4000-8000-000000000002', 'c1180031-0000-4000-8000-000000000002', 'manager');
select public.league_generate_schedule('b1180000-0000-4000-8000-000000000031', now());

select pg_temp.mx('{schedule_remix_confirm}', 'schedule_remix_confirm', 'b1180000-0000-4000-8000-000000000031', '98118000-0000-4000-8000-000000000001',
  $$ select public.schedule_remix_confirm('b1180000-0000-4000-8000-000000000031', 777, null, 'a1180031-0000-4000-8000-000000000001') $$,
  $$ select public.schedule_remix_confirm('b1180000-0000-4000-8000-000000000031', 777, null, 'a1180031-0000-4000-8000-000000000001') $$,
  'edit_schedule', null, 'the replay of the same action id');

-- ---------------------------------------------------------------------------
-- I. THE IN-SEASON WORLD (LI) — the §15.4 overrides, the manager arms, the
--    trades and claims. The calendar is RELATIVE to now() (074's shape):
--    the current week is 8, weeks 1–7 are past, week 9 is ahead.
-- ---------------------------------------------------------------------------
update nfl_weeks w
set starts_at                 = now() + ((w.week - 8) * interval '7 days') - interval '1 day',
    first_kickoff_at          = null,
    last_game_ends_at         = case when w.week <= 7 then now() + ((w.week - 8) * interval '7 days') + interval '5 days' end,
    correction_window_ends_at = now() + ((w.week - 8) * interval '7 days') + interval '6 days'
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status)
select 'x118-g' || w, 2026, w, 'ZZ', 'ZY',
       now() + ((w - 8) * interval '7 days') + interval '2 days',
       case when w <= 7 then 'final' else 'scheduled' end
from generate_series(1, 14) w;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, waiver_type, faab_budget, trade_review,
                     trade_deadline_week, settings, roster_settings)
values ('b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001', 'pgtap-x118-LI', 2026, 'in_season', 8, 14, 0, 15,
        (select id from scoring_systems where is_template and name = 'ESPN Standard'),
        (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
        'per_player_kickoff', 'faab', 100, 'commissioner', 13,
        '{"schedule_mode": "h2h", "median_game": false, "second_opponent": false, "allow_illegal_lineups": true,
          "waiver_run_days": ["sun", "mon", "tue", "wed", "thu", "fri", "sat"], "waiver_run_time": "10:00",
          "waiver_time_zone": "UTC", "free_agency_opens": "after_waiver_run"}'::jsonb,
        '{"starting_slots": [{"key": "rb", "label": "RB", "eligible": ["RB"], "count": 2}], "bench": 4, "ir_slots": [], "swap_spots": 0}'::jsonb);
insert into teams (id, owner_id, name, league_id)
select ('c1180051-0000-4000-8000-00000000000' || i)::uuid, '98118000-0000-4000-8000-000000000001',
       'x118-I-t' || i, 'b1180000-0000-4000-8000-000000000051'
from generate_series(1, 8) i;
update teams set owner_id = '98118000-0000-4000-8000-000000000002' where id = 'c1180051-0000-4000-8000-000000000002';
update teams set owner_id = '98118000-0000-4000-8000-000000000003' where id = 'c1180051-0000-4000-8000-000000000003';
-- u1 commissioner (t1), u2 (t2), u3 (t3); t4–t8 placeholder rows, no manager.
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select 'b1180000-0000-4000-8000-000000000051',
       case i when 1 then '98118000-0000-4000-8000-000000000001'::uuid
              when 2 then '98118000-0000-4000-8000-000000000002'::uuid
              when 3 then '98118000-0000-4000-8000-000000000003'::uuid end,
       ('c1180051-0000-4000-8000-00000000000' || i)::uuid,
       case i when 1 then 'commissioner' else 'manager' end, i > 3, 100
from generate_series(1, 8) i;
insert into team_managers (league_id, team_id, user_id, role)
select m.league_id, m.team_id, m.user_id, 'manager' from league_members m
where m.league_id = 'b1180000-0000-4000-8000-000000000051' and m.user_id is not null;

insert into league_weeks (league_id, season, week)
select 'b1180000-0000-4000-8000-000000000051', 2026, w from generate_series(1, 14) w;
update league_weeks set status = 'live'              where league_id = 'b1180000-0000-4000-8000-000000000051' and week <= 8;
update league_weeks set status = 'correction_window' where league_id = 'b1180000-0000-4000-8000-000000000051' and week <= 7;
update league_weeks set status = 'final'             where league_id = 'b1180000-0000-4000-8000-000000000051' and week <= 7;

insert into players (id, full_name, position, team, status)
select 'x118-p' || lpad(i::text, 2, '0'), 'X118 Player ' || i, 'RB', 'ZZ', 'Active' from generate_series(1, 30) i;
-- t2: p01–p04; t3: p05–p08; t1: p09–p10; p11+ free agents.
insert into league_rosters (league_id, team_id, player_id, slot_key)
select 'b1180000-0000-4000-8000-000000000051',
       case when i <= 4 then 'c1180051-0000-4000-8000-000000000002'::uuid
            when i <= 8 then 'c1180051-0000-4000-8000-000000000003'::uuid
            else 'c1180051-0000-4000-8000-000000000001'::uuid end,
       'x118-p' || lpad(i::text, 2, '0'), 'bn'
from generate_series(1, 10) i;
insert into league_player_pool (league_id, player_id, state)
select r.league_id, r.player_id, 'rostered' from league_rosters r where r.league_id = 'b1180000-0000-4000-8000-000000000051';

-- Week 5 (FINAL): four final matchups, results consistent with the scores
-- (a final week is always editable — Q67's "final wins").
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status, result)
select ('d1180051-0000-4000-8000-00000000005' || i)::uuid, 'b1180000-0000-4000-8000-000000000051', 2026, 5, 'regular',
       ('c1180051-0000-4000-8000-00000000000' || (2 * i - 1))::uuid, ('c1180051-0000-4000-8000-00000000000' || (2 * i))::uuid,
       100 + i, 90, 'final', 'home'
from generate_series(1, 4) i;
-- Week 9 (UPCOMING, ahead): the schedule-edit subjects.
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, status)
select ('d1180051-0000-4000-8000-00000000009' || i)::uuid, 'b1180000-0000-4000-8000-000000000051', 2026, 9, 'regular',
       ('c1180051-0000-4000-8000-00000000000' || (2 * i - 1))::uuid, ('c1180051-0000-4000-8000-00000000000' || (2 * i))::uuid,
       'scheduled'
from generate_series(1, 4) i;

-- LI — every call below is the commissioner u1 acting on a team he does not
-- manage (t1 is his), through the real DEFINER door (now()).
select pg_temp.mx('{set_lineup_internal}', 'set_lineup', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.set_lineup('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000002', 8,
       '{"rb:0": "x118-p01", "rb:1": "x118-p02"}', 'a1180051-0000-4000-8000-000000000001', null) $$,
  $$ select public.set_lineup('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000002', 8,
       '{"rb:0": "x118-p01", "rb:1": "x118-p02"}', 'a1180051-0000-4000-8000-000000000002', null) $$,
  'edit_lineup', 'c1180051-0000-4000-8000-000000000002');
select pg_temp.mx('{commish_edit_lineup_internal}', 'commish_edit_lineup', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.commish_edit_lineup('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000003', 8,
       '{"rb:0": "x118-p05", "rb:1": "x118-p07"}', null, 'a1180051-0000-4000-8000-000000000003') $$,
  $$ select public.commish_edit_lineup('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000003', 8,
       '{"rb:0": "x118-p05", "rb:1": "x118-p07"}', null, 'a1180051-0000-4000-8000-000000000004') $$,
  'edit_lineup', 'c1180051-0000-4000-8000-000000000003');
select pg_temp.mx('{commish_roster_override_internal}', 'commish_force_add_drop', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.commish_force_add_drop('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000002',
       'x118-p11', null, null, 'a1180051-0000-4000-8000-000000000005') $$,
  $$ select public.commish_force_add_drop('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000002',
       'x118-p11', null, null, 'a1180051-0000-4000-8000-000000000005') $$,
  'force_add', 'c1180051-0000-4000-8000-000000000002', 'the replay of the same action id');
select pg_temp.mx('{commish_roster_override_internal}', 'commish_move_player', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.commish_move_player('b1180000-0000-4000-8000-000000000051', 'x118-p06',
       'c1180051-0000-4000-8000-000000000003', 'c1180051-0000-4000-8000-000000000004', null, 'a1180051-0000-4000-8000-000000000006') $$,
  $$ select public.commish_move_player('b1180000-0000-4000-8000-000000000051', 'x118-p06',
       'c1180051-0000-4000-8000-000000000003', 'c1180051-0000-4000-8000-000000000004', null, 'a1180051-0000-4000-8000-000000000006') $$,
  'move_player', null, 'the replay of the same action id');
select pg_temp.mx('{commish_rename_team_internal}', 'commish_rename_team', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.commish_rename_team('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000004',
       'x118 Four Renamed', null, 'a1180051-0000-4000-8000-000000000007') $$,
  $$ select public.commish_rename_team('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000004',
       'x118 Four Renamed', null, 'a1180051-0000-4000-8000-000000000008') $$,
  'reassign_team', 'c1180051-0000-4000-8000-000000000004');
-- R1334: the same three override twins on the commissioner's OWN team
-- (t1) — his own act, not one on its behalf: acting for no team.
select pg_temp.mx('{commish_edit_lineup_internal}', 'commish_edit_lineup', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.commish_edit_lineup('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000001', 8,
       '{"rb:0": "x118-p09", "rb:1": "x118-p10"}', null, 'a1180051-0000-4000-8000-000000000040') $$,
  $$ select public.commish_edit_lineup('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000001', 8,
       '{"rb:0": "x118-p09", "rb:1": "x118-p10"}', null, 'a1180051-0000-4000-8000-000000000040') $$,
  'edit_lineup', null, 'the replay of the same action id');
select pg_temp.mx('{commish_roster_override_internal}', 'commish_force_add_drop', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.commish_force_add_drop('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000001',
       'x118-p15', null, null, 'a1180051-0000-4000-8000-000000000041') $$,
  $$ select public.commish_force_add_drop('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000001',
       'x118-p15', null, null, 'a1180051-0000-4000-8000-000000000041') $$,
  'force_add', null, 'the replay of the same action id');
select pg_temp.mx('{commish_rename_team_internal}', 'commish_rename_team', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.commish_rename_team('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000001',
       'x118 One Renamed', null, 'a1180051-0000-4000-8000-000000000042') $$,
  $$ select public.commish_rename_team('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000001',
       'x118 One Renamed', null, 'a1180051-0000-4000-8000-000000000043') $$,
  'reassign_team', null);
select pg_temp.mx('{commish_edit_faab_internal}', 'commish_edit_faab', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.commish_edit_faab('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000002', 80, null,
       'a1180051-0000-4000-8000-000000000009') $$,
  $$ select public.commish_edit_faab('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000002', 80, null,
       'a1180051-0000-4000-8000-000000000010') $$,
  'edit_faab', null);
select pg_temp.mx('{commish_set_autopilot_internal}', 'commish_set_autopilot', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.commish_set_autopilot('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000005', true, null,
       'a1180051-0000-4000-8000-000000000011') $$,
  $$ select public.commish_set_autopilot('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000005', true, null,
       'a1180051-0000-4000-8000-000000000012') $$,
  'set_autopilot', null);
select pg_temp.mx('{commish_change_setting_internal}', 'commish_change_setting', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.commish_change_setting('b1180000-0000-4000-8000-000000000051', 'trade_review_period_hours', '72'::jsonb, false, null,
       'a1180051-0000-4000-8000-000000000013') $$,
  $$ select public.commish_change_setting('b1180000-0000-4000-8000-000000000051', 'trade_review_period_hours', '72'::jsonb, false, null,
       'a1180051-0000-4000-8000-000000000014') $$,
  'change_setting', null);
select pg_temp.mx('{commish_matchup_override_internal}', 'commish_edit_score', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.commish_edit_score('b1180000-0000-4000-8000-000000000051', 'd1180051-0000-4000-8000-000000000051', 120, 90, null,
       'a1180051-0000-4000-8000-000000000015') $$,
  $$ select public.commish_edit_score('b1180000-0000-4000-8000-000000000051', 'd1180051-0000-4000-8000-000000000051', 120, 90, null,
       'a1180051-0000-4000-8000-000000000016') $$,
  'edit_score', null);
select pg_temp.mx('{commish_matchup_override_internal}', 'commish_set_result', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.commish_set_result('b1180000-0000-4000-8000-000000000051', 'd1180051-0000-4000-8000-000000000052',
       'c1180051-0000-4000-8000-000000000004', null, 'a1180051-0000-4000-8000-000000000017') $$,
  $$ select public.commish_set_result('b1180000-0000-4000-8000-000000000051', 'd1180051-0000-4000-8000-000000000052',
       'c1180051-0000-4000-8000-000000000004', null, 'a1180051-0000-4000-8000-000000000018') $$,
  'set_result', null);
select pg_temp.mx('{commish_edit_schedule_internal}', 'commish_edit_schedule', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.commish_edit_schedule('b1180000-0000-4000-8000-000000000051', 'd1180051-0000-4000-8000-000000000091',
       'c1180051-0000-4000-8000-000000000001', 'c1180051-0000-4000-8000-000000000003', null, 'a1180051-0000-4000-8000-000000000019') $$,
  $$ select public.commish_edit_schedule('b1180000-0000-4000-8000-000000000051', 'd1180051-0000-4000-8000-000000000091',
       'c1180051-0000-4000-8000-000000000001', 'c1180051-0000-4000-8000-000000000003', null, 'a1180051-0000-4000-8000-000000000020') $$,
  'edit_schedule', null);
select pg_temp.mx('{schedule_edit_matchup}', 'schedule_edit_matchup', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.schedule_edit_matchup('b1180000-0000-4000-8000-000000000051', 'd1180051-0000-4000-8000-000000000093',
       'c1180051-0000-4000-8000-000000000005', 'c1180051-0000-4000-8000-000000000007', null, 'a1180051-0000-4000-8000-000000000021') $$,
  $$ select public.schedule_edit_matchup('b1180000-0000-4000-8000-000000000051', 'd1180051-0000-4000-8000-000000000093',
       'c1180051-0000-4000-8000-000000000005', 'c1180051-0000-4000-8000-000000000007', null, 'a1180051-0000-4000-8000-000000000021') $$,
  'edit_schedule', null, 'the replay of the same action id');
-- claims (FAAB): the commissioner for t2
select pg_temp.mx('{waiver_claim_submit_internal}', 'waiver_claim_submit', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.waiver_claim_submit('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000002',
       'x118-p12', null, 5, 'a1180051-0000-4000-8000-000000000022', null) $$,
  $$ select public.waiver_claim_submit('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000002',
       'x118-p12', null, 5, 'a1180051-0000-4000-8000-000000000022', null) $$,
  'submit_waiver_claim', 'c1180051-0000-4000-8000-000000000002', 'the replay of the same action id');

-- a second claim for t2, made by its own manager (no receipt — the manager arm)
select set_config('request.jwt.claims', '{"sub": "98118000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select public.waiver_claim_submit('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000002',
  'x118-p13', null, 7, 'a1180051-0000-4000-8000-000000000023', null);
select set_config('request.jwt.claims', '', true);
create temp table _claim as
select c.id, c.add_player_id as player_id from waiver_claims c where c.league_id = 'b1180000-0000-4000-8000-000000000051';
select pg_temp.mx('{waiver_claim_edit_internal}', 'waiver_claim_edit', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.waiver_claim_edit('b1180000-0000-4000-8000-000000000051', (select id from _claim where player_id = 'x118-p12'),
       7, null, 'a1180051-0000-4000-8000-000000000024', null) $$,
  $$ select public.waiver_claim_edit('b1180000-0000-4000-8000-000000000051', (select id from _claim where player_id = 'x118-p12'),
       7, null, 'a1180051-0000-4000-8000-000000000024', null) $$,
  'edit_waiver_claim', 'c1180051-0000-4000-8000-000000000002', 'the replay of the same action id');
select pg_temp.mx('{waiver_claim_reorder_internal}', 'waiver_claim_reorder', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.waiver_claim_reorder('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000002',
       array[(select id from _claim where player_id = 'x118-p12'), (select id from _claim where player_id = 'x118-p13')],
       'a1180051-0000-4000-8000-000000000025', null) $$,
  $$ select public.waiver_claim_reorder('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000002',
       array[(select id from _claim where player_id = 'x118-p12'), (select id from _claim where player_id = 'x118-p13')],
       'a1180051-0000-4000-8000-000000000025', null) $$,
  'reorder_waiver_claims', 'c1180051-0000-4000-8000-000000000002', 'the replay of the same action id');
select pg_temp.mx('{waiver_claim_cancel_internal}', 'waiver_claim_cancel', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.waiver_claim_cancel('b1180000-0000-4000-8000-000000000051', (select id from _claim where player_id = 'x118-p13'),
       'a1180051-0000-4000-8000-000000000026', null) $$,
  $$ select public.waiver_claim_cancel('b1180000-0000-4000-8000-000000000051', (select id from _claim where player_id = 'x118-p13'),
       'a1180051-0000-4000-8000-000000000026', null) $$,
  'cancel_waiver_claim', 'c1180051-0000-4000-8000-000000000002', 'the replay of the same action id');
-- trades: the commissioner proposes FOR t2 and accepts FOR t3 (commissioner review)
select pg_temp.mx('{trade_propose_internal}', 'trade_propose', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.trade_propose('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000002', 'c1180051-0000-4000-8000-000000000003',
       jsonb_build_array(jsonb_build_object('player_id', 'x118-p03', 'from_team_id', 'c1180051-0000-4000-8000-000000000002'),
                         jsonb_build_object('player_id', 'x118-p08', 'from_team_id', 'c1180051-0000-4000-8000-000000000003')),
       null, null, 'a1180051-0000-4000-8000-000000000027', null) $$,
  $$ select public.trade_propose('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000002', 'c1180051-0000-4000-8000-000000000003',
       jsonb_build_array(jsonb_build_object('player_id', 'x118-p03', 'from_team_id', 'c1180051-0000-4000-8000-000000000002'),
                         jsonb_build_object('player_id', 'x118-p08', 'from_team_id', 'c1180051-0000-4000-8000-000000000003')),
       null, null, 'a1180051-0000-4000-8000-000000000027', null) $$,
  'propose_trade', 'c1180051-0000-4000-8000-000000000002', 'the replay of the same action id');
create temp table _trade as select t.id from trades t where t.league_id = 'b1180000-0000-4000-8000-000000000051';
select pg_temp.mx('{trade_respond_internal}', 'trade_respond', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.trade_respond('b1180000-0000-4000-8000-000000000051', (select id from _trade), 'accept', null, null, null,
       'a1180051-0000-4000-8000-000000000028', null) $$,
  $$ select public.trade_respond('b1180000-0000-4000-8000-000000000051', (select id from _trade), 'accept', null, null, null,
       'a1180051-0000-4000-8000-000000000028', null) $$,
  'accept_trade', 'c1180051-0000-4000-8000-000000000003', 'the replay of the same action id');
select pg_temp.mx('{commish_force_or_reverse_trade_internal}', 'commish_force_or_reverse_trade', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.commish_force_or_reverse_trade('b1180000-0000-4000-8000-000000000051', (select id from _trade), 'approve', null,
       'a1180051-0000-4000-8000-000000000029') $$,
  $$ select public.commish_force_or_reverse_trade('b1180000-0000-4000-8000-000000000051', (select id from _trade), 'approve', null,
       'a1180051-0000-4000-8000-000000000029') $$,
  'approve_trade', null, 'the replay of the same action id');
select pg_temp.mx('{commish_force_or_reverse_trade_internal}', 'commish_force_or_reverse_trade', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  $$ select public.commish_force_or_reverse_trade('b1180000-0000-4000-8000-000000000051', (select id from _trade), 'reverse', null,
       'a1180051-0000-4000-8000-000000000030') $$,
  $$ select public.commish_force_or_reverse_trade('b1180000-0000-4000-8000-000000000051', (select id from _trade), 'reverse', null,
       'a1180051-0000-4000-8000-000000000030') $$,
  'reverse_trade', null, 'the replay of the same action id');

-- The scoring change with re-score on: the live week 8 takes the new rules
-- and names this receipt in league_weeks.scoring_rules_action_id (that
-- pointer's one verb writer — §G reads it back).
select pg_temp.mx('{commish_change_setting_internal}', 'commish_change_setting', 'b1180000-0000-4000-8000-000000000051', '98118000-0000-4000-8000-000000000001',
  format($$ select public.commish_change_setting('b1180000-0000-4000-8000-000000000051', 'scoring_system_id', %L::jsonb, true, null,
       'a1180051-0000-4000-8000-000000000031') $$, to_jsonb((select id from scoring_systems where is_template and name = 'ESPN Full PPR'))),
  format($$ select public.commish_change_setting('b1180000-0000-4000-8000-000000000051', 'scoring_system_id', %L::jsonb, true, null,
       'a1180051-0000-4000-8000-000000000031') $$, to_jsonb((select id from scoring_systems where is_template and name = 'ESPN Full PPR'))),
  'change_setting', null, 'the replay of the same action id');

-- ---------------------------------------------------------------------------
-- P. THE PLAYOFF WORLD (LP — 082's L1, walked by the jobs to a built round
--    1). 082 pins its calendar to absolute 2026 instants; here every instant
--    is moved by (now() − 2026-09-30) so the world has the same shape
--    relative to the transaction instant whatever day the suite runs.
-- ---------------------------------------------------------------------------
create function pg_temp.at(p text) returns timestamptz language sql stable as $f$
  select p::timestamptz + (now() - timestamptz '2026-09-30 00:00:00+00')
$f$;
update nfl_weeks set first_kickoff_at = null, last_game_ends_at = null where season = 2026;
update nfl_weeks w
set starts_at = pg_temp.at('2026-09-23 04:00:00+00') + ((w.week - 3) * interval '7 days'),
    last_game_ends_at = pg_temp.at('2026-09-29 04:00:00+00') + ((w.week - 3) * interval '7 days'),
    correction_window_ends_at = pg_temp.at('2026-10-01 10:00:00+00') + ((w.week - 3) * interval '7 days')
where w.season = 2026 and w.week between 3 and 12;
update nfl_weeks set last_game_ends_at = starts_at + interval '6 days' where season = 2026 and week in (1, 2);
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status)
select 'x118-eb-w' || w, 2026, w, 'BUF', 'KC', (select starts_at + interval '2 days' from nfl_weeks where season = 2026 and week = w), 'final'
from generate_series(3, 12) w;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings) values
 ('b1180000-0000-4000-8000-000000000041', '98118000-0000-4000-8000-000000000001', 'pgtap-x118-LP', 2026, 'in_season', 8, 4, 6, 5,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff',
  '{"schedule_mode": "h2h", "median_game": false, "second_opponent": false, "schedule_seed": 134134, "playoff_weeks_per_round": 1, "playoff_reseed": true}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}');
insert into teams (id, owner_id, name, league_id)
select ('c1180041-0000-4000-8000-00000000000' || i)::uuid, '98118000-0000-4000-8000-000000000001', 'x118-P-' || chr(64 + i),
       'b1180000-0000-4000-8000-000000000041'
from generate_series(1, 8) i;
update teams set status = 'retired' where id = 'c1180041-0000-4000-8000-000000000008';
insert into league_members (league_id, user_id, team_id, role) values
 ('b1180000-0000-4000-8000-000000000041', '98118000-0000-4000-8000-000000000001', 'c1180041-0000-4000-8000-000000000001', 'commissioner'),
 ('b1180000-0000-4000-8000-000000000041', '98118000-0000-4000-8000-000000000002', 'c1180041-0000-4000-8000-000000000002', 'manager');
insert into league_weeks (league_id, season, week) select 'b1180000-0000-4000-8000-000000000041', 2026, g from generate_series(3, 9) g;
update league_weeks set status = 'live'              where league_id = 'b1180000-0000-4000-8000-000000000041' and week between 3 and 5;
update league_weeks set status = 'correction_window' where league_id = 'b1180000-0000-4000-8000-000000000041' and week between 3 and 5;
-- 082's L1 regular season (A=1 … H=8), score for score — the same six seeds.
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status)
select ('d1180041-0000-4000-8000-0000000000' || m.w || m.k)::uuid, 'b1180000-0000-4000-8000-000000000041', 2026, m.w, 'regular',
       ('c1180041-0000-4000-8000-00000000000' || m.h)::uuid, ('c1180041-0000-4000-8000-00000000000' || m.a)::uuid,
       m.hs, m.as_, case when m.w <= 5 then 'live' else 'scheduled' end
from (values
  (3, 1, 1, 2, 100.00,  90.00), (3, 2, 3, 4, 100.00,  80.00), (3, 3, 5, 6,  95.00,  85.00), (3, 4, 7, 8,  70.00, 110.00),
  (4, 1, 1, 3, 100.00,  90.00), (4, 2, 2, 4, 100.00,  70.00), (4, 3, 5, 7, 100.00,  80.00), (4, 4, 6, 8,  90.00, 120.00),
  (5, 1, 1, 4, 110.00, 100.00), (5, 2, 2, 3,  80.00, 100.00), (5, 3, 5, 8,  90.00, 130.00), (5, 4, 6, 7, 100.00,  95.00),
  (6, 1, 1, 5, 100.00,  90.00), (6, 2, 2, 6, 100.00,  70.00), (6, 3, 3, 7,  90.00,  95.00), (6, 4, 4, 8, 100.00, 105.00)
) as m(w, k, h, a, hs, as_);
-- The jobs walk LP to a built round 1 (082 / 066's instants, shifted).
select public.finalize_matchups(pg_temp.at('2026-10-15 10:00:00+00'));
select public.league_week_advance(pg_temp.at('2026-10-14 04:00:00+00'));
select public.league_week_advance(pg_temp.at('2026-10-20 04:00:00+00'));

create function pg_temp.lp_m(p_seed int) returns uuid language sql stable as $f$
  select id from public.matchups
  where league_id = 'b1180000-0000-4000-8000-000000000041' and week = 7 and round_type = 'playoff' and home_seed = p_seed
$f$;
-- 082 C1: E(3) v G(6) becomes E v F — the commissioner hand-picks a pairing.
select pg_temp.mx('{commish_edit_bracket_internal}', 'commish_edit_bracket', 'b1180000-0000-4000-8000-000000000041', '98118000-0000-4000-8000-000000000001',
  $$ select public.commish_edit_bracket('b1180000-0000-4000-8000-000000000041', pg_temp.lp_m(3),
       'c1180041-0000-4000-8000-000000000005', 'c1180041-0000-4000-8000-000000000006', null, 'a1180041-0000-4000-8000-000000000001') $$,
  $$ select public.commish_edit_bracket('b1180000-0000-4000-8000-000000000041', pg_temp.lp_m(3),
       'c1180041-0000-4000-8000-000000000005', 'c1180041-0000-4000-8000-000000000006', null, 'a1180041-0000-4000-8000-000000000002') $$,
  'edit_bracket', null);

-- ---------------------------------------------------------------------------
-- C. TD10 (i) — THE CATALOG CENSUS: every commissioner-gated writer reaches
--    the receipt helper or sits on the short allowlist with its reason.
-- ---------------------------------------------------------------------------
create temp table _census as select * from pg_temp.census();

-- C1–C3: the instrument itself, asserted before anything is read from it.
select ok(
  pg_temp.src_code($x$ v := 1; -- PERFORM public.log_commissioner_action_internal(
    /* log_commissioner_action_internal( */ RAISE EXCEPTION 'no log_commissioner_action_internal( here'; $x$)
    !~ 'log_commissioner_action_internal',
  'C1 INSTRUMENT: a helper named only in a line comment, a block comment or a string literal is not code — the census reads CODE');
select ok(
  (select p.prosrc ~ 'log_commissioner_action_internal' and pg_temp.src_code(p.prosrc) !~ 'log_commissioner_action_internal'
   from pg_proc p where p.oid = 'public.rebuild_team_week_results(uuid, integer)'::regprocedure),
  'C2 INSTRUMENT, on a real body: rebuild_team_week_results names the helper in its comments (126) and calls it nowhere — the stripped code does not match');
select is(
  (select format('%s|%s', pg_temp.src_code(p.prosrc) ~ 'log_commissioner_action_internal\s*\(',
                          c.receipt)
   from pg_proc p join _census c on c.fn = 'set_lineup_internal'
   where p.oid = 'public.set_lineup_internal(uuid, uuid, integer, jsonb, uuid, timestamptz, text)'::regprocedure),
  'f|t',
  'C3 INSTRUMENT: set_lineup_internal calls the helper only through the seam (draft_commish_receipt_internal, F513(a) / F515(a)) — the census follows the call graph');

-- C4: THE CENSUS, AS A STORED LITERAL — every commissioner-gated writer and
-- its verdict (receipt = reaches log_commissioner_action_internal;
-- allowlisted = named in _allow with its reason). A new gated writer, or a
-- verdict that moves, reds this cell by name.
select is(
  (select string_agg(c.fn || '=' || case when c.receipt then 'receipt' when a.fn is not null then 'allowlisted' else 'OFFENDER' end,
                     ' ' order by c.fn)
   from _census c left join _allow a on a.fn = c.fn
   where c.writes is not null),
  'add_placeholder_seat=receipt assign_manager=receipt claim_league_invite=allowlisted commish_change_setting_internal=receipt '
  || 'commish_edit_bracket_internal=receipt commish_edit_faab_internal=receipt commish_edit_lineup_internal=receipt '
  || 'commish_edit_schedule_internal=receipt commish_force_or_reverse_trade_internal=receipt commish_matchup_override_internal=receipt '
  || 'commish_rename_team_internal=receipt commish_roster_override_internal=receipt commish_set_autopilot_internal=receipt '
  || 'create_league_invite=receipt draft_adjust_budget=receipt draft_cancel_nomination=receipt draft_create=receipt '
  || 'draft_create_internal=receipt draft_end=receipt draft_force_pick=receipt draft_move_player=receipt draft_pause=receipt '
  || 'draft_place_bid=receipt draft_queue_replace=receipt draft_reassign_pick=receipt draft_reset=receipt draft_resume=receipt draft_reverse_won_bid=receipt draft_set_clock=receipt '
  || 'draft_set_order=receipt draft_start=receipt draft_start_internal=receipt draft_tick=receipt draft_undo=receipt '
  || 'leave_league=allowlisted remove_manager=receipt revoke_league_invite=receipt rotate_invite_code=receipt '
  || 'schedule_edit_matchup=receipt schedule_remix_confirm=receipt scoring_fork_template=receipt scoring_update_rules=receipt '
  || 'set_league_invite_slug=receipt set_league_status=receipt set_lineup_internal=receipt set_member_role=receipt '
  || 'set_team_autodraft=receipt snapshot_league_scoring=allowlisted soft_delete_league=receipt trade_propose_internal=receipt '
  || 'trade_respond_internal=receipt trade_vote_internal=allowlisted update_league_profile=receipt update_league_settings=receipt '
  || 'waiver_claim_cancel_internal=receipt waiver_claim_edit_internal=receipt waiver_claim_reorder_internal=receipt '
  || 'waiver_claim_submit_internal=receipt',
  'C4 THE CENSUS (stored literal): 58 commissioner-gated writers — 54 reach the receipt, 4 are allowlisted (171 added the two draft-room manager verbs, F521)');

-- C5: THE BACKSTOP CELL. A gated writer that reaches no receipt and is not
-- on the allowlist is an OFFENDER, named here. ***The task probe target.***
select is(
  (select coalesce(string_agg(c.fn, ' ' order by c.fn), '')
   from _census c
   where c.writes is not null and not c.receipt and not exists (select 1 from _allow a where a.fn = c.fn)),
  '',
  'C5 no commissioner-gated writer changes league state without reaching the receipt helper, except the allowlisted (a new one reds here BY NAME)');
-- C6: the allowlist is short and still true — every entry is a gated writer
-- that reaches no receipt (a stale entry, or one that gains a receipt, reds).
select is(
  (select string_agg(a.fn || ':' || coalesce((c.writes is not null and not c.receipt)::text, 'absent'), ' ' order by a.fn)
   from _allow a left join _census c on c.fn = a.fn),
  'claim_league_invite:true leave_league:true snapshot_league_scoring:true trade_vote_internal:true',
  'C6 the allowlist is four entries, each still a gated writer with no receipt — none stale');
select is((select count(*)::int from _allow where length(why) < 60), 0,
  'C7 every allowlist entry says why, in a sentence (no bare names)');
-- C8: gated functions that write nothing are outside the census, named.
select is(
  (select string_agg(c.fn, ' ' order by c.fn) from _census c where c.writes is null),
  'commish_matchup_edit_lock is_league_commish schedule_preview',
  'C8 the three gated functions that write no table (the edit-lock read, the gate itself, the Remix preview) are outside the census, by name');

-- C9 / C10: POSITIVE CONTROLS — the census catches a planted offender, and
-- a helper named only in its comment and a string does not save it.
create function public.zz_x118_census_control(p_league_id uuid) returns void
language plpgsql security definer set search_path = '' as $ctl$
begin
  -- PERFORM public.log_commissioner_action_internal( … )  (a comment is not a call)
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'log_commissioner_action_internal( is not called here' USING ERRCODE = '42501';
  END IF;
  UPDATE public.leagues SET name = name WHERE id = p_league_id;
end
$ctl$;
select is(
  (select coalesce(string_agg(c.fn, ' ' order by c.fn), '')
   from pg_temp.census() c
   where c.writes is not null and not c.receipt and not exists (select 1 from _allow a where a.fn = c.fn)),
  'zz_x118_census_control',
  'C9 POSITIVE CONTROL: a planted commissioner-gated writer with no receipt is NAMED by the C5 query (the helper in its comment and message does not hide it)');
create or replace function public.zz_x118_census_control(p_league_id uuid) returns void
language plpgsql security definer set search_path = '' as $ctl$
begin
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'not a commissioner' USING ERRCODE = '42501';
  END IF;
  UPDATE public.leagues SET name = name WHERE id = p_league_id;
  PERFORM public.draft_commish_receipt_internal(p_league_id, FALSE, 'zz', 'zz', 'league', p_league_id::text, NULL, NULL, NULL, NULL, NULL);
end
$ctl$;
select is(
  (select format('%s|%s', c.receipt, c.writes) from pg_temp.census() c where c.fn = 'zz_x118_census_control'),
  't|commissioner_actions,leagues',
  'C10 POSITIVE CONTROL: the same writer calling the seam is a receipt writer — two hops, followed');
drop function public.zz_x118_census_control(uuid);

-- C11 / C12 (R1332): A NEW GATE SHAPE CANNOT HIDE. Every function whose code
-- carries a 'commissioner' / 'co_commissioner' role literal is either gated
-- (C4's census reads it) or on this named list of literals that are NOT a
-- gate, each with why.
create temp table _literal (fn text primary key, why text not null);
insert into _literal values
  ('commish_setting_canon_internal', 'commissioner is a value of the trade_review setting (none / commissioner / league_vote), not a role'),
  ('commish_trade_reverse_internal', 'commissioner is the acquisition_type the reversal stamps on the rows it moves back, not a role'),
  ('create_league',                  'seats the creator AS the commissioner (a role written, not checked) — there is no commissioner yet (F515(b))'),
  ('trade_tick',                     'commissioner is the trade_review default value the tick reads, not a role'),
  ('trade_vote_veto_internal',       'commissioner is the trade_review default value, not a role'),
  ('trade_vote_view_internal',       'commissioner is the trade_review default value, not a role');
create temp table _litscan as
select p.proname::text as fn,
       pg_temp.src_nc(p.prosrc) ~ $re$'(co_)?commissioner'$re$ as has_literal,
       (pg_temp.src_nc(p.prosrc) ~ 'is_league_commish\s*\('
        or pg_temp.src_nc(p.prosrc) ~* $re$role\s*(=|<>|in)\s*\(?\s*'(co_)?commissioner'$re$) as gated
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
select is(
  (select coalesce(string_agg(l.fn, ' ' order by l.fn), '') from _litscan l
   where l.has_literal and not l.gated and not exists (select 1 from _literal x where x.fn = l.fn)),
  '',
  'C11 (R1332) every function carrying a commissioner role literal is gated or named as a literal-not-a-gate (a new gate shape reds here BY NAME)');
select is(
  (select string_agg(x.fn || ':' || coalesce((l.has_literal and not l.gated)::text, 'absent'), ' ' order by x.fn)
   from _literal x left join _litscan l on l.fn = x.fn),
  'commish_setting_canon_internal:true commish_trade_reverse_internal:true create_league:true trade_tick:true '
  || 'trade_vote_veto_internal:true trade_vote_view_internal:true',
  'C12 the literal-not-a-gate list is six entries, each still carrying the literal and still ungated — none stale');

-- ---------------------------------------------------------------------------
-- M. TD10 (ii) — THE BEHAVIOURAL MATRIX, read back. One row per verb (the
--    worlds above filled _mx); per row: the change writes exactly its
--    receipts, the receipt has its type and acting_as_team_id, the no-op
--    writes none.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from _mx), 61,
  'M0 PREMISE: the matrix holds 61 calls — 14 setup, 21 draft room, 1 Remix, 24 in season, 1 bracket');
-- M1: COVERAGE — the matrix exercises every receipt-reaching function the
-- census found, and names nothing the census does not know.
select is(
  (select coalesce(string_agg(c.fn, ' ' order by c.fn), '') from _census c
   where c.receipt and c.writes is not null
     and not exists (select 1 from _mx m where c.fn = any (m.census_fns))),
  '',
  'M1 COVERAGE: every one of the 54 receipt-reaching commissioner writers is called by the matrix (a new verb with no matrix row reds here BY NAME)');
select is(
  (select coalesce(string_agg(distinct f, ' ' order by f), '') from _mx m, unnest(m.census_fns) f
   where not exists (select 1 from _census c where c.fn = f and c.receipt)),
  '',
  'M2 COVERAGE: every function the matrix claims to exercise is a receipt writer of the census');
-- M3: the rows with no no-op form, and why (stored literal).
select is(
  (select string_agg(m.verb, ' ' order by m.seq) from _mx m where m.noop_sql is null),
  'add_placeholder_seat create_league_invite rotate_invite_code draft_undo draft_move_player draft_reset '
  || 'draft_cancel_nomination draft_reverse_won_bid draft_end draft_tick: create + start arms',
  'M3 ten calls have no no-op form (each call is a new act or a refusal the second time) — named, each with its reason in the matrix');

-- M-rows: the change.
select is(m.change_n, m.want_n,
  format('M%s %s: a change writes exactly %s receipt%s%s', m.seq, m.verb, m.want_n,
         case when m.want_n = 1 then '' else 's (a system act has no actor)' end,
         coalesce(' — THE CALL RAISED ' || m.change_err, '')))
from _mx m order by m.seq;
-- M-rows: what the receipt is, and who it acts for (D451).
select is(format('%s|%s', m.new_type, coalesce(m.new_acting::text, 'no team')),
          format('%s|%s', m.want_type, coalesce(m.want_acting::text, 'no team')),
          format('M%s %s: the receipt is %s, acting for %s', m.seq, m.verb, m.want_type, coalesce(m.want_acting::text, 'no team')))
from _mx m where m.want_n = 1 order by m.seq;
-- M-rows: the no-op.
select is(format('%s|%s', m.noop_n, coalesce(m.noop_err, 'lands')), '0|lands',
  format('M%s %s: the no-op (%s) lands and writes none', m.seq, m.verb, coalesce(m.noop_why, 'the same value again')))
from _mx m where m.noop_sql is not null order by m.seq;

-- ---------------------------------------------------------------------------
-- T. TD16 — THE MANAGER-VERB CENSUS: every manager verb, and how the
--    commissioner does it for ANY team (standing rule (a)). "arm" = the
--    manager verb itself accepts him on a team he does not manage and writes
--    acting_as_team_id; "override twin" = the manager verb declines to be his
--    door BY DESIGN and override mode's twin does the same act for the team
--    (standing rule (h); TD16 "delivered by override mode"); "not delegable"
--    = there is no act for a team to do on its behalf. (Until 171 a fourth
--    verdict, "defect F521", named the bid and the queue verbs — a manager
--    act the commissioner could not do for another team; L.E1.38 built both
--    arms, D452. A new verdict of that kind reds T1 by name.)
-- ---------------------------------------------------------------------------
create temp table _mv (manager_verb text primary key, verdict text not null, door text not null, why text not null);
insert into _mv values
  ('set_lineup',           'arm',           'set_lineup',
   'the commissioner arm of set_lineup_internal (D363(2); its receipt since 169, F514); commish_edit_lineup is its lock-exempt override twin (standing rule (g)) and acts for the team too (D451)'),
  ('roster_add_drop',      'override twin', 'commish_force_add_drop',
   'roster_add_drop keeps the manager-only gate by design (115, standing rule (c)); its refusal copy sends the commissioner to override mode, whose force add / drop stands outside the waiver and lock timing and acts for the team (D451)'),
  ('waiver_claim_submit',  'arm',           'waiver_claim_submit',  'M5 TD5 — the claim arms, acting for the team'),
  ('waiver_claim_edit',    'arm',           'waiver_claim_edit',    'M5 TD5 — the claim arms, acting for the team'),
  ('waiver_claim_reorder', 'arm',           'waiver_claim_reorder', 'M5 TD5 — the claim arms, acting for the team'),
  ('waiver_claim_cancel',  'arm',           'waiver_claim_cancel',  'M5 TD5 — the claim arms, acting for the team'),
  ('trade_propose',        'arm',           'trade_propose',        'M5 TD5 — the trade arms, acting for the team'),
  ('trade_respond',        'arm',           'trade_respond',        'M5 TD5 — the trade arms, acting for the team'),
  ('trade_vote',           'not delegable', 'commish_force_or_reverse_trade',
   'a vote is a manager ballot for his own team (Q77, D415(1)) — it takes no team; the commissioner acts on the trade itself (approve / veto), receipted and acting for no team'),
  ('rename_own_team',      'override twin', 'commish_rename_team',
   'rename_own_team is the manager own-team door by design (128, D359); its refusal copy names override mode, whose rename acts for the team (D451)'),
  ('set_team_autodraft',   'arm',           'set_team_autodraft',   'the commissioner path of set_team_autodraft, acting for the team (168, D449(3))'),
  ('draft_make_pick',      'override twin', 'draft_force_pick',
   'a pick takes no team — it is the team on the clock; the commissioner picks for whichever team is on the clock with draft_force_pick, acting for it (168, D449(3))'),
  ('draft_nominate',       'override twin', 'draft_force_pick',
   'the auction arm of draft_force_pick nominates for the team on the clock, acting for it (168)'),
  ('draft_place_bid',      'arm',           'draft_place_bid',
   'the commissioner arm of draft_place_bid (171, F521): p_team_id names the team he bids for, every validity rule of a bid binding him, acting for the team (D452)'),
  ('draft_queue_replace',  'arm',           'draft_queue_replace',
   'the commissioner arm of draft_queue_replace (171, F521): the Targets of a team he does not manage, the shape rules binding him, acting for the team (D452)');

select is(
  (select string_agg(manager_verb || ':' || verdict || ':' || door, ' ' order by manager_verb) from _mv),
  'draft_make_pick:override twin:draft_force_pick draft_nominate:override twin:draft_force_pick '
  || 'draft_place_bid:arm:draft_place_bid draft_queue_replace:arm:draft_queue_replace '
  || 'rename_own_team:override twin:commish_rename_team roster_add_drop:override twin:commish_force_add_drop '
  || 'set_lineup:arm:set_lineup set_team_autodraft:arm:set_team_autodraft trade_propose:arm:trade_propose '
  || 'trade_respond:arm:trade_respond trade_vote:not delegable:commish_force_or_reverse_trade '
  || 'waiver_claim_cancel:arm:waiver_claim_cancel waiver_claim_edit:arm:waiver_claim_edit '
  || 'waiver_claim_reorder:arm:waiver_claim_reorder waiver_claim_submit:arm:waiver_claim_submit',
  'T1 THE MANAGER-VERB CENSUS (stored literal): fifteen manager verbs, each with how the commissioner does it for any team — none refuses him (F521 built, 171)');
-- T2: every ARM verb accepted the commissioner on a team he does not manage
-- and wrote ONE receipt acting for it. ***A manager verb that refuses him
-- reds here BY NAME (standing rule (a)).***
select is(
  (select coalesce(string_agg(v.manager_verb, ' ' order by v.manager_verb), '')
   from _mv v
   where v.verdict = 'arm'
     and not exists (
       select 1 from _mx m
       where m.verb = v.door and m.change_err is null and m.change_n = 1 and m.new_acting is not null
         and not exists (select 1 from league_members lm
                         where lm.team_id = m.new_acting and lm.user_id = '98118000-0000-4000-8000-000000000001'))),
  '',
  'T2 every ARM manager verb accepts the commissioner on a team he does not manage and writes one receipt acting for it (a refusal reds here by name)');
-- T3: every OVERRIDE TWIN did the same act for the team, acting for it.
select is(
  (select coalesce(string_agg(v.manager_verb, ' ' order by v.manager_verb), '')
   from _mv v
   where v.verdict = 'override twin'
     and not exists (
       select 1 from _mx m
       where m.verb = v.door and m.change_err is null and m.change_n = 1 and m.new_acting is not null
         and not exists (select 1 from league_members lm
                         where lm.team_id = m.new_acting and lm.user_id = '98118000-0000-4000-8000-000000000001'))),
  '',
  'T3 every OVERRIDE TWIN does the manager act for a team the commissioner does not manage and writes one receipt acting for it (D451)');
-- T4 / T5: the two twins' manager verbs decline him BY DESIGN (a change of
-- that design reds here, and T1's verdict moves with it).
select set_config('request.jwt.claims', '{"sub": "98118000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.roster_add_drop('b1180000-0000-4000-8000-000000000051', 'c1180051-0000-4000-8000-000000000002',
       'x118-p14', null, 'a1180051-0000-4000-8000-0000000000d1') $$,
  '42501', 'roster_add_drop: not the manager of this team',
  'T4 roster_add_drop declines the commissioner on another team BY DESIGN (115) — his door is the override twin (T3)');
select throws_ok(
  $$ select public.rename_own_team('c1180051-0000-4000-8000-000000000002', 'x118 not his') $$,
  '42501', 'rename_own_team: not the manager of this team',
  'T5 rename_own_team declines the commissioner on another team BY DESIGN (128) — his door is the override twin (T3)');
select set_config('request.jwt.claims', '', true);
-- T6: the vote takes no team, and the commissioner power over a vote landed.
select is(
  (select pg_get_function_identity_arguments('public.trade_vote(uuid, uuid, text, uuid)'::regprocedure))
    || ' / ' || (select string_agg(m.new_type || ':' || coalesce(m.new_acting::text, 'no team'), ' ' order by m.seq)
                 from _mx m where m.verb = 'commish_force_or_reverse_trade'),
  'p_league_id uuid, p_trade_id uuid, p_vote text, p_action_id uuid / approve_trade:no team reverse_trade:no team',
  'T6 trade_vote takes no team (a vote is the caller own ballot, Q77) — the commissioner acts on the trade itself, approve and reverse landed, acting for no team');
-- T7: every door in the census is callable by a signed-in user (the in-body
-- check decides) and by no anonymous one.
select is(
  (select coalesce(string_agg(d, ' ' order by d), '')
   from (select manager_verb as d from _mv union select door from _mv where door <> 'none') x
   where not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = x.d
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and not has_function_privilege('anon', p.oid, 'EXECUTE'))),
  '',
  'T7 every manager verb and every commissioner door in the census is EXECUTE-able by authenticated and not by anon');
-- T8 / T9: F521, BUILT (171 / L.E1.38; D452). Until 171 these two cells
-- pinned the defect as it stood (the bid took no team; the queue refused the
-- commissioner 42501); T1 moved both verbs to "arm" and T2 now proves the
-- doors land for a team he does not manage. What stays true, pinned here:
-- the bid names its team as a sixth, defaulted argument, and the door is the
-- commissioner alone — a manager naming another team is still refused.
select is(
  (select pg_get_function_identity_arguments('public.draft_place_bid(uuid, integer, uuid, integer, text, uuid)'::regprocedure)),
  'p_draft_id uuid, p_amount integer, p_action_id uuid, p_nomination_seq integer, p_player_id text, p_team_id uuid',
  'T8 (F521 built) draft_place_bid names the team to bid for — the commissioner arm (171)');
select set_config('request.jwt.claims', '{"sub": "98118000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.draft_queue_replace(pg_temp.ld(), 'c1180021-0000-4000-8000-000000000003', array['x118-d21']) $$,
  '42501', 'You do not manage this queue.',
  'T9 (F521 built) the door is the commissioner alone — a manager on another team queue is still refused 42501');
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- G. TD10 (iii) — THE LOG-POINTER GUARDS (170). The verbs above wrote their
--    pointers through the guards; now the owner (and the service role)
--    tries to write one outside a verb.
-- ---------------------------------------------------------------------------
-- The GUC the last verb left behind is cleared first: every cell below says
-- what it sets.
select set_config('app.commish_action_id', '', true);
select set_config('request.jwt.claims', '', true);
create function pg_temp.rid(p_league uuid, p_type text, p_action text default null) returns uuid language sql stable as $f$
  select c.id from public.commissioner_actions c
  where c.league_id = p_league and c.action_type = p_type
    and (p_action is null or c.metadata ->> 'action_id' = p_action)
  order by c.id limit 1
$f$;
-- A second LP receipt, written by the owner straight into the append-only
-- log (an INSERT is what the log allows).
insert into commissioner_actions (id, league_id, actor_id, action_type, target_type, target_id) values
  ('a1180000-0000-4000-8000-0000000000c1', 'b1180000-0000-4000-8000-000000000041', '98118000-0000-4000-8000-000000000001',
   'edit_bracket', 'bracket', 'x118-control');

-- G1–G4: each verb wrote its pointer = its own receipt (the guards let the
-- audited writers through).
select is(
  (select override_action_id from matchups where id = 'd1180051-0000-4000-8000-000000000051'),
  pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'edit_score'),
  'G1 commish_edit_score wrote matchups.override_action_id = its own receipt, through the guard');
select is(
  (select string_agg(distinct m.pairing_set_by_action_id::text, ',') from matchups m
   where m.league_id = 'b1180000-0000-4000-8000-000000000041' and m.week = 7 and m.round_type = 'playoff'),
  pg_temp.rid('b1180000-0000-4000-8000-000000000041', 'edit_bracket', 'a1180041-0000-4000-8000-000000000001')::text,
  'G2 commish_edit_bracket marked every row of the round with matchups.pairing_set_by_action_id = its own receipt');
select is(
  (select string_agg(c.action_type, ' ' order by c.action_type) from transactions t
   join commissioner_actions c on c.id = t.related_action_id and c.league_id = t.league_id
   where t.league_id = 'b1180000-0000-4000-8000-000000000051'),
  'force_add force_add move_player reverse_trade',
  'G3 the two force adds (for t2 and for his own t1), the move and the trade reversal each INSERTed a transactions row whose related_action_id is its own receipt');
select is(
  (select scoring_rules_action_id from league_weeks where league_id = 'b1180000-0000-4000-8000-000000000051' and week = 8),
  pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'change_setting', 'a1180051-0000-4000-8000-000000000031'),
  'G4 the scoring change with re-score wrote league_weeks.scoring_rules_action_id = its own receipt on the live week');

-- G5–G9: A DIRECT OWNER-ROLE WRITE OF EACH POINTER, OUTSIDE A VERB, IS
-- REFUSED BY NAME (no GUC). ***The task probe targets: disable one guard and
-- its cell reds.***
select throws_like(
  format($$ update matchups set override_action_id = %L where id = 'd1180051-0000-4000-8000-000000000051' $$,
         pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'set_result')),
  '%matchups.override_action_id on row d1180051-0000-4000-8000-000000000051 was written%app.commish_action_id unset%',
  'G5 matchups.override_action_id — an owner UPDATE outside a verb is refused by name');
select throws_like(
  $$ update matchups set pairing_set_by_action_id = 'a1180000-0000-4000-8000-0000000000c1'
     where league_id = 'b1180000-0000-4000-8000-000000000041' and week = 7 and round_type = 'playoff' and home_seed = 1 $$,
  '%matchups.pairing_set_by_action_id on row % was written%app.commish_action_id unset%',
  'G6 matchups.pairing_set_by_action_id — an owner UPDATE outside a verb is refused by name');
select throws_like(
  format($$ update transactions set related_action_id = %L
            where league_id = 'b1180000-0000-4000-8000-000000000051' and related_action_id is not null $$,
         pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'set_result')),
  '%transactions.related_action_id on row % was written%app.commish_action_id unset%',
  'G7 transactions.related_action_id — an owner UPDATE outside a verb is refused by name');
select throws_like(
  format($$ update league_weeks set reopened_by_action_id = %L
            where league_id = 'b1180000-0000-4000-8000-000000000051' and week = 7 $$,
         pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'set_result')),
  '%league_weeks.reopened_by_action_id on row % was written NULL → %app.commish_action_id unset%',
  'G8 league_weeks.reopened_by_action_id — an owner UPDATE outside a verb is refused by name (it has no writer at all — Q64)');
select throws_like(
  format($$ update league_weeks set scoring_rules_action_id = %L
            where league_id = 'b1180000-0000-4000-8000-000000000051' and week = 8 $$,
         pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'set_result')),
  '%league_weeks.scoring_rules_action_id on row % was written%app.commish_action_id unset%',
  'G9 league_weeks.scoring_rules_action_id — an owner UPDATE outside a verb is refused by name');

-- G10–G14: the ONE shape that passes — the pointer IS the receipt this
-- transaction holds in app.commish_action_id, of the row own league (what an
-- audited verb does after log_commissioner_action_internal).
select set_config('app.commish_action_id', pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'set_result')::text, true);
select lives_ok(
  format($$ update matchups set override_action_id = %L where id = 'd1180051-0000-4000-8000-000000000051' $$, pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'set_result')),
  'G10 matchups.override_action_id set to the receipt the transaction holds (same league) lands');
select lives_ok(
  format($$ update transactions set related_action_id = %L
                       where league_id = 'b1180000-0000-4000-8000-000000000051' and related_action_id is not null $$, pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'set_result')),
  'G11 transactions.related_action_id set to the held receipt lands');
select lives_ok(
  format($$ update league_weeks set reopened_by_action_id = %L
                       where league_id = 'b1180000-0000-4000-8000-000000000051' and week = 7 $$, pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'set_result')),
  'G12 league_weeks.reopened_by_action_id set to the held receipt lands');
select lives_ok(
  format($$ update league_weeks set scoring_rules_action_id = %L
                       where league_id = 'b1180000-0000-4000-8000-000000000051' and week = 8 $$, pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'set_result')),
  'G13 league_weeks.scoring_rules_action_id set to the held receipt lands');
select set_config('app.commish_action_id', 'a1180000-0000-4000-8000-0000000000c1', true);
select lives_ok(
  $$ update matchups set pairing_set_by_action_id = 'a1180000-0000-4000-8000-0000000000c1'
                where league_id = 'b1180000-0000-4000-8000-000000000041' and week = 7 and round_type = 'playoff' and home_seed = 1 $$,
  'G14 matchups.pairing_set_by_action_id set to the held receipt lands');
select is(
  format('%s|%s|%s|%s|%s',
    (select m.override_action_id = pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'set_result')
     from matchups m where m.id = 'd1180051-0000-4000-8000-000000000051'),
    (select count(*) from transactions t where t.league_id = 'b1180000-0000-4000-8000-000000000051'
       and t.related_action_id = pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'set_result')),
    (select w.reopened_by_action_id = pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'set_result')
     from league_weeks w where w.league_id = 'b1180000-0000-4000-8000-000000000051' and w.week = 7),
    (select w.scoring_rules_action_id = pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'set_result')
     from league_weeks w where w.league_id = 'b1180000-0000-4000-8000-000000000051' and w.week = 8),
    (select m.pairing_set_by_action_id = 'a1180000-0000-4000-8000-0000000000c1'
     from matchups m where m.league_id = 'b1180000-0000-4000-8000-000000000041' and m.week = 7
       and m.round_type = 'playoff' and m.home_seed = 1)),
  't|4|t|t|t',
  'G14b …and all five writes are really there (not vacuous: four transactions rows, one row of each other kind)');

-- G15–G17: WHAT THE GUC DOES NOT BUY — a clear, a pointer at another
-- receipt, a receipt of another league.
select throws_like(
  $$ update matchups set pairing_set_by_action_id = null
     where league_id = 'b1180000-0000-4000-8000-000000000041' and week = 7 and round_type = 'playoff' and home_seed = 1 $$,
  '%matchups.pairing_set_by_action_id on row % was written a1180000-0000-4000-8000-0000000000c1 → NULL%',
  'G15 a CLEAR of a pointer is refused, GUC or none (a pointer may only be set to the held receipt)');
select throws_like(
  format($$ update matchups set override_action_id = %L where id = 'd1180051-0000-4000-8000-000000000051' $$,
         pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'edit_score')),
  '%matchups.override_action_id on row % was written%with app.commish_action_id a1180000-0000-4000-8000-0000000000c1%',
  'G16 a pointer at a receipt OTHER than the held one is refused');
select set_config('app.commish_action_id', pg_temp.rid('b1180000-0000-4000-8000-000000000011', 'add_seat')::text, true);
select throws_like(
  format($$ update matchups set override_action_id = %L where id = 'd1180051-0000-4000-8000-000000000051' $$,
         pg_temp.rid('b1180000-0000-4000-8000-000000000011', 'add_seat')),
  '%matchups.override_action_id on row % may only name a receipt of its own league%',
  'G17 the held receipt of ANOTHER league is refused — the pointer names its own league receipt');

-- G18–G19: INSERT is guarded too (related_action_id is only ever written on
-- INSERT).
select set_config('app.commish_action_id', '', true);
select throws_like(
  format($$ insert into transactions (league_id, type, status, initiator_team_id, initiated_by, payload, week, related_action_id)
            values ('b1180000-0000-4000-8000-000000000051', 'commissioner_move', 'complete', null,
                    '98118000-0000-4000-8000-000000000001', '{}'::jsonb, 8, %L) $$,
         pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'set_result')),
  '%transactions.related_action_id on row % was written NULL → %app.commish_action_id unset%',
  'G18 an owner INSERT of a transactions row pointing at the log, outside a verb, is refused by name');
select set_config('app.commish_action_id', pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'set_result')::text, true);
select lives_ok(
  format($$ insert into transactions (league_id, type, status, initiator_team_id, initiated_by, payload, week, related_action_id)
            values ('b1180000-0000-4000-8000-000000000051', 'commissioner_move', 'complete', null,
                    '98118000-0000-4000-8000-000000000001', '{}'::jsonb, 8, %L) $$,
         pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'set_result')),
  'G19 …and the same INSERT holding that receipt lands');

-- G20–G21: NO ROLE STANDS OUTSIDE IT — the service role (rolbypassrls), and
-- replica mode (ENABLE ALWAYS — R616: db push, pg_restore, logical apply).
select set_config('app.commish_action_id', '', true);
set local role service_role;
select throws_like(
  format($$ update matchups set override_action_id = %L where id = 'd1180051-0000-4000-8000-000000000051' $$,
         pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'edit_faab')),
  '%matchups.override_action_id on row % was written%',
  'G20 the SERVICE ROLE writing a pointer outside a verb is refused by name (RLS does not bind it; the trigger does)');
reset role;
set local session_replication_role = replica;
select throws_like(
  format($$ update league_weeks set scoring_rules_action_id = %L
            where league_id = 'b1180000-0000-4000-8000-000000000051' and week = 8 $$,
         pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'edit_score')),
  '%league_weeks.scoring_rules_action_id on row % was written%',
  'G21 under session_replication_role = replica the guard still fires (ENABLE ALWAYS)');
set local session_replication_role = origin;

-- G22–G27: THE ONE JOB, held to its own shape (TD10; R1329) — 144's backfill
-- fills a week whose rules AND pointer are both still NULL, sourced backfill /
-- backfill_ambiguous, naming a scoring-system change the league's own
-- commish_setting_actions ledger records. Nothing wider passes with no GUC.
select is(
  (select count(*)::int from commish_setting_actions s
   where s.league_id = 'b1180000-0000-4000-8000-000000000051' and s.setting_key = 'scoring_system_id'
     and s.result ->> 'no_changes' = 'false'
     and s.result ->> 'commissioner_action_id'
         = pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'change_setting', 'a1180051-0000-4000-8000-000000000031')::text),
  1,
  'G22 PREMISE: the verb recorded LI scoring change in the league ledger — so G23 fails for the SHAPE, not for the receipt');
select throws_like(
  format($$ update league_weeks set scoring_rules_source = 'backfill', scoring_rules_action_id = %L
            where league_id = 'b1180000-0000-4000-8000-000000000051' and week = 8 $$,
         pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'change_setting', 'a1180051-0000-4000-8000-000000000031')),
  '%league_weeks.scoring_rules_action_id on row % was written%app.commish_action_id unset%',
  'G23 (R1329) RE-POINTING a set pointer dressed as a backfill is refused — even naming a real, ledgered scoring-change receipt of the league');
-- LB: a league with no frozen rules and one opened week holding none — the
-- shape the backfill exists for.
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id) values
  ('b1180000-0000-4000-8000-000000000061', '98118000-0000-4000-8000-000000000001', 'pgtap-x118-LB', 2026, 'setup', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'));
insert into league_weeks (league_id, season, week, status)
values ('b1180000-0000-4000-8000-000000000061', 2026, 1, 'live');
insert into commissioner_actions (id, league_id, actor_id, action_type, target_type, target_id) values
  ('a1180000-0000-4000-8000-0000000000c2', 'b1180000-0000-4000-8000-000000000061', '98118000-0000-4000-8000-000000000001',
   'change_setting', 'setting', 'scoring_system_id'),
  ('a1180000-0000-4000-8000-0000000000c3', 'b1180000-0000-4000-8000-000000000061', '98118000-0000-4000-8000-000000000001',
   'change_setting', 'setting', 'scoring_system_id');
insert into commish_setting_actions (league_id, setting_key, action_id, actor_id, result) values
  ('b1180000-0000-4000-8000-000000000061', 'scoring_system_id', 'a1180061-0000-4000-8000-000000000001',
   '98118000-0000-4000-8000-000000000001',
   '{"no_changes": false, "commissioner_action_id": "a1180000-0000-4000-8000-0000000000c2"}'::jsonb);
select is(
  (select format('%s|%s|%s', w.status, w.scoring_rules_snapshot is null, w.scoring_rules_action_id is null)
   from league_weeks w where w.league_id = 'b1180000-0000-4000-8000-000000000061' and w.week = 1),
  'live|t|t',
  'G24 PREMISE: LB week 1 is opened and holds no rules and no pointer (the backfill shape)');
select throws_like(
  $$ update league_weeks
     set scoring_rules_snapshot = (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
         scoring_system_id = (select id from scoring_systems where is_template and name = 'ESPN Standard'),
         scoring_rules_source = 'backfill', scoring_rules_action_id = 'a1180000-0000-4000-8000-0000000000c3'
     where league_id = 'b1180000-0000-4000-8000-000000000061' and week = 1 $$,
  '%league_weeks.scoring_rules_action_id on row % was written NULL → a1180000-0000-4000-8000-0000000000c3%',
  'G25 …the right shape naming a receipt the league ledger does NOT record is refused (the backfill copies only what the ledger says)');
select lives_ok(
  $$ update league_weeks
     set scoring_rules_snapshot = (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
         scoring_system_id = (select id from scoring_systems where is_template and name = 'ESPN Standard'),
         scoring_rules_source = 'backfill', scoring_rules_action_id = 'a1180000-0000-4000-8000-0000000000c2'
     where league_id = 'b1180000-0000-4000-8000-000000000061' and week = 1 $$,
  'G26 the backfill shape lands with no GUC: an empty week, source backfill, the ledgered scoring-change receipt');
select is(
  (select w.scoring_rules_source || '|' || w.scoring_rules_action_id from league_weeks w
   where w.league_id = 'b1180000-0000-4000-8000-000000000061' and w.week = 1),
  'backfill|a1180000-0000-4000-8000-0000000000c2',
  'G26b …and the backfill write is really there');
-- G26c (R1336): a LIVE week stamped at open (source week_open, rules set,
-- pointer NULL) relabelled backfill with a LEDGERED receipt and no GUC is
-- refused — the backfill only ever fills a week that holds no rules.
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot) values
  ('b1180000-0000-4000-8000-000000000062', '98118000-0000-4000-8000-000000000001', 'pgtap-x118-LC', 2026, 'setup', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'),
   (select rules from scoring_systems where is_template and name = 'ESPN Standard'));
insert into league_weeks (league_id, season, week, status)
values ('b1180000-0000-4000-8000-000000000062', 2026, 1, 'live');
insert into commissioner_actions (id, league_id, actor_id, action_type, target_type, target_id) values
  ('a1180000-0000-4000-8000-0000000000c4', 'b1180000-0000-4000-8000-000000000062', '98118000-0000-4000-8000-000000000001',
   'change_setting', 'setting', 'scoring_system_id');
insert into commish_setting_actions (league_id, setting_key, action_id, actor_id, result) values
  ('b1180000-0000-4000-8000-000000000062', 'scoring_system_id', 'a1180062-0000-4000-8000-000000000001',
   '98118000-0000-4000-8000-000000000001',
   '{"no_changes": false, "commissioner_action_id": "a1180000-0000-4000-8000-0000000000c4"}'::jsonb);
select is(
  (select format('%s|%s|%s|%s', w.status, w.scoring_rules_source, w.scoring_rules_snapshot is not null, w.scoring_rules_action_id is null)
   from league_weeks w where w.league_id = 'b1180000-0000-4000-8000-000000000062' and w.week = 1),
  'live|week_open|t|t',
  'G26c PREMISE: LC week 1 is live and was stamped at open — rules set, source week_open, no pointer');
select throws_like(
  $$ update league_weeks set scoring_rules_source = 'backfill', scoring_rules_action_id = 'a1180000-0000-4000-8000-0000000000c4'
     where league_id = 'b1180000-0000-4000-8000-000000000062' and week = 1 $$,
  '%league_weeks.scoring_rules_action_id on row % was written NULL → a1180000-0000-4000-8000-0000000000c4%app.commish_action_id unset%',
  'G26d (R1336) a week stamped at open, relabelled backfill with a ledgered receipt and no GUC, is refused — the backfill fills only a week holding no rules');
select throws_like(
  format($$ update league_weeks set scoring_rules_source = 'rescore', scoring_rules_action_id = %L
            where league_id = 'b1180000-0000-4000-8000-000000000051' and week = 8 $$,
         pg_temp.rid('b1180000-0000-4000-8000-000000000051', 'change_setting', 'a1180051-0000-4000-8000-000000000031')),
  '%league_weeks.scoring_rules_action_id on row % was written%',
  'G27 …and a rescore-sourced pointer with no GUC is refused (the rescore is the verb, which holds its receipt)');

-- ---------------------------------------------------------------------------
-- Q. THE POLICY ROUTE (R1330): a league's scoring rules written straight
--    through the table, and the census of every client write POLICY — a
--    route the pg_proc census cannot see.
-- ---------------------------------------------------------------------------
select is(
  (select format('%s:%s:%s', t.tgenabled, (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16,
                 t.tgname > (select max(x.tgname) from pg_trigger x
                             where x.tgrelid = t.tgrelid and not x.tgisinternal and x.tgname <> t.tgname))
   from pg_trigger t where t.tgrelid = 'public.scoring_systems'::regclass and t.tgname = 'trg_zz_scoring_systems_league_rules'),
  'A:t:t',
  'Q1 the scoring guard is a BEFORE UPDATE row trigger, ENABLE ALWAYS, firing after the validator (an invalid document keeps its own refusal)');
-- LS plays by a fork u1 owns (sS forked it and edited it through the door).
select is(
  (select format('%s|%s', s.owner_id, s.is_template) from scoring_systems s
   join leagues l on l.scoring_system_id = s.id where l.id = 'b1180000-0000-4000-8000-000000000011'),
  '98118000-0000-4000-8000-000000000001|f',
  'Q2 PREMISE: LS plays by a forked custom system its commissioner owns — the row the owner policy lets him write');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "98118000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ update scoring_systems set rules = jsonb_set(rules, '{base,receptions}', '0.5')
     where id = (select scoring_system_id from leagues where id = 'b1180000-0000-4000-8000-000000000011') $$,
  '%is the scoring of league "pgtap-x118-LS renamed" — its rules change only through the league scoring editor (scoring_update_rules)%',
  'Q3 THE HOLE, CLOSED: the commissioner writing his league scoring rules straight into the table (the owner policy) is refused by name (42501)');
select lives_ok(
  $$ update scoring_systems set name = 'pgtap-x118-LS fork renamed'
     where id = (select scoring_system_id from leagues where id = 'b1180000-0000-4000-8000-000000000011') $$,
  'Q4 …only the RULES are guarded: renaming the row lands');
reset role;
select is(
  (select format('%s|%s', s.rules #>> '{base,receptions}',
                 (select count(*) from commissioner_actions where league_id = 'b1180000-0000-4000-8000-000000000011' and action_type = 'edit_scoring'))
   from scoring_systems s join leagues l on l.scoring_system_id = s.id where l.id = 'b1180000-0000-4000-8000-000000000011'),
  '1|1',
  'Q5 …the rules are as the receipted edit left them (receptions 1) and the log holds that one edit_scoring receipt');
select set_config('request.jwt.claims', '{"sub": "98118000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.scoring_update_rules('b1180000-0000-4000-8000-000000000011',
       (select jsonb_set(s.rules, '{base,receptions}', '0.5') from scoring_systems s
        where s.id = (select scoring_system_id from leagues where id = 'b1180000-0000-4000-8000-000000000011'))) $$,
  'Q6 …and the same change through the door lands (the door runs as its owner)');
select set_config('request.jwt.claims', '', true);
select is(
  (select format('%s|%s', s.rules #>> '{base,receptions}',
                 (select count(*) from commissioner_actions where league_id = 'b1180000-0000-4000-8000-000000000011' and action_type = 'edit_scoring'))
   from scoring_systems s join leagues l on l.scoring_system_id = s.id where l.id = 'b1180000-0000-4000-8000-000000000011'),
  '0.5|2',
  'Q7 …with its receipt: two edit_scoring rows now');
-- A personal system no league plays by stays the owner own (the research editor).
insert into scoring_systems (id, name, owner_id, is_template, rules) values
  ('51180000-0000-4000-8000-000000000001', 'pgtap-x118-personal', '98118000-0000-4000-8000-000000000002', false,
   '{"passing_yards": 0.04}'::jsonb);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "98118000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$ update scoring_systems set rules = '{"passing_yards": 0.05}'::jsonb where id = '51180000-0000-4000-8000-000000000001' $$,
  'Q8 a personal scoring system no league plays by is still its owner to edit');
reset role;
select is((select rules ->> 'passing_yards' from scoring_systems where id = '51180000-0000-4000-8000-000000000001'), '0.05',
  'Q9 …and the edit is really there');
select lives_ok(
  $$ update scoring_systems set rules = jsonb_set(rules, '{base,receptions}', '0.75')
     where id = (select scoring_system_id from leagues where id = 'b1180000-0000-4000-8000-000000000011') $$,
  'Q10 the table owner stands outside the guard as it stands outside RLS (R1010 — the route closed is the client one)');

-- Q11–Q14: THE POLICY CENSUS (R1330, widened by R1337). EVERY client write
-- policy (INSERT / UPDATE / DELETE / ALL) in schema public — and on
-- storage.objects — carries a verdict. No table rule decides what is league
-- state: a future league table linked only through another table cannot
-- slip past, because every policy must be named here.
create temp table _polv (tbl text, pol text, verdict text not null, why text not null, primary key (tbl, pol));
insert into _polv values
  -- league state, each with how it stays honest
  ('public.commissioner_actions', 'Only commish can append',              'the log itself',   'the audit log §12.12 prints — a row written this way is attributed to its writer (actor_id = auth.uid()) and changes no state'),
  ('public.draft_dnd_marks',      'Own DND marks',                        'own act',          'a user own do-not-draft marks, visible to him alone'),
  ('public.draft_queues',         'Own queue write',                      'own act',          'a manager own draft queue (the commissioner sets another team queue only through draft_queue_replace, which writes his receipt — 171, F521)'),
  ('public.league_chat',          'Members post their own chat',          'own act',          'a member own chat post (is_system false, bounded) — never a system or commissioner post'),
  ('public.league_lists',         'Members manage their own attachments', 'own act',          'a member own list attachments to a league'),
  ('public.scoring_systems',      'Users can manage own scoring systems', 'guarded by 170',   'a league scoring rules change is refused on the client route (trg_zz_scoring_systems_league_rules — Q3); personal systems stay editable'),
  ('public.teams',                'Users can delete own standalone teams', 'standalone only', 'league_id IS NULL in the policy — a league franchise matches none'),
  ('public.teams',                'Users can insert own standalone teams', 'standalone only', 'league_id IS NULL in the policy — a league franchise matches none'),
  ('public.teams',                'Users can update own standalone teams', 'standalone only', 'league_id IS NULL in the policy — a league franchise matches none'),
  ('storage.objects',             'league-avatars commish delete',        'cosmetic (F522)',  'the league picture file — no game state; an in-place overwrite has no receipt (F522)'),
  ('storage.objects',             'league-avatars commish insert',        'cosmetic (F522)',  'the league picture file — no game state; the profile receipt fires when avatar_url changes (169)'),
  ('storage.objects',             'league-avatars commish update',        'cosmetic (F522)',  'the league picture file — no game state; an in-place overwrite has no receipt (F522)');
-- outside any league: lists, social, research, rankings, a user own profile
insert into _polv (tbl, pol, verdict, why)
select v.tbl, v.pol, 'not league state', 'user content outside any league (lists, social, research, rankings, own profile and files)'
from (values
  ('public.big_board_snapshots', 'Snapshots: owner write'),
  ('public.big_board_weekly', 'Weekly: owner write'),
  ('public.expert_claim_requests', 'Users can submit claim requests'),
  ('public.expert_follows', 'Users can manage own expert follows'),
  ('public.expert_profiles', 'Claimed experts can update their profile'),
  ('public.follows', 'Users can manage own follows'),
  ('public.list_comments', 'Authenticated users can comment on lists with comments enabled'),
  ('public.list_comments', 'Authors can soft-delete own comments'),
  ('public.list_comments', 'List owners can soft-delete any comment on their list'),
  ('public.list_favorites', 'list_favorites self delete'),
  ('public.list_favorites', 'list_favorites self write'),
  ('public.list_folders', 'list_folders owner all'),
  ('public.list_likes', 'Users can manage own likes'),
  ('public.list_links', 'list_links owner delete'),
  ('public.list_links', 'list_links owner insert'),
  ('public.list_links', 'list_links owner update'),
  ('public.list_player_drafted', 'list_player_drafted self delete'),
  ('public.list_player_drafted', 'list_player_drafted self insert'),
  ('public.list_players', 'Users can manage players in own lists'),
  ('public.list_tags', 'List owners can manage tags on their lists'),
  ('public.lists', 'Users can manage own lists'),
  ('public.notifications', 'Users can update own notifications'),
  ('public.profiles', 'Users can update own profile'),
  ('public.research_configs', 'Users can manage own research configs'),
  ('public.start_sit_questions', 'Authenticated users can post questions'),
  ('public.start_sit_questions', 'Posters can update their own questions (before voting closes)'),
  ('public.start_sit_votes', 'Users can cast their own vote'),
  ('public.tags', 'Authenticated users can create custom tags'),
  ('public.weekly_rankings', 'Users can manage own weekly rankings'),
  ('storage.objects', 'folder-thumbnails owner delete'),
  ('storage.objects', 'folder-thumbnails owner insert'),
  ('storage.objects', 'folder-thumbnails owner update'),
  ('storage.objects', 'list-thumbnails owner delete'),
  ('storage.objects', 'list-thumbnails owner insert'),
  ('storage.objects', 'list-thumbnails owner update'),
  ('storage.objects', 'user-avatars owner delete'),
  ('storage.objects', 'user-avatars owner insert'),
  ('storage.objects', 'user-avatars owner update')
) as v(tbl, pol);
create temp table _polscan as
select n.nspname || '.' || c.relname as tbl, p.polname::text as pol, p.polcmd::text as cmd
from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
where p.polcmd in ('a', 'w', 'd', '*')
  and (n.nspname = 'public' or (n.nspname = 'storage' and c.relname = 'objects'));
select is(
  (select coalesce(string_agg(s.tbl || '.' || s.pol, ' | ' order by s.tbl, s.pol), '') from _polscan s
   where not exists (select 1 from _polv v where v.tbl = s.tbl and v.pol = s.pol)),
  '',
  'Q11 POLICY CENSUS: every client write policy in public and on storage.objects has a verdict (a new policy route reds here BY NAME)');
select is(
  (select coalesce(string_agg(v.tbl || '.' || v.pol, ' | ' order by v.tbl, v.pol), '') from _polv v
   where not exists (select 1 from _polscan s where s.tbl = v.tbl and s.pol = v.pol)),
  '',
  'Q12 …and no verdict is stale (every named policy still exists)');
select is(
  (select string_agg(v.tbl || '.' || v.pol || ':' || s.cmd || '=' || v.verdict, ' | ' order by v.tbl, v.pol)
   from _polv v join _polscan s on s.tbl = v.tbl and s.pol = v.pol
   where v.verdict <> 'not league state'),
  'public.commissioner_actions.Only commish can append:a=the log itself | public.draft_dnd_marks.Own DND marks:*=own act | '
  || 'public.draft_queues.Own queue write:*=own act | public.league_chat.Members post their own chat:a=own act | '
  || 'public.league_lists.Members manage their own attachments:*=own act | '
  || 'public.scoring_systems.Users can manage own scoring systems:*=guarded by 170 | '
  || 'public.teams.Users can delete own standalone teams:d=standalone only | public.teams.Users can insert own standalone teams:a=standalone only | '
  || 'public.teams.Users can update own standalone teams:w=standalone only | '
  || 'storage.objects.league-avatars commish delete:d=cosmetic (F522) | storage.objects.league-avatars commish insert:a=cosmetic (F522) | '
  || 'storage.objects.league-avatars commish update:w=cosmetic (F522)',
  'Q13 THE LEAGUE-STATE VERDICTS (stored literal): twelve client write policies touch league state, each with how — none a commissioner route without a receipt');
select is(
  (select format('%s|%s', count(*) filter (where verdict = 'not league state'),
                 count(*) filter (where verdict not in ('the log itself', 'own act', 'not league state', 'guarded by 170', 'standalone only', 'cosmetic (F522)')
                                     or length(why) < 20))
   from _polv),
  '38|0',
  'Q14 thirty-eight policies are outside any league (lists, social, research, own files), and every verdict is one of the six named kinds with a reason');

select * from finish();
rollback;
