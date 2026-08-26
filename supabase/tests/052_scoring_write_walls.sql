-- ============================================================================
-- The two write walls — pgTAP 052 (migration 104, task SE.4b; D175 (Chris,
-- 2026-08-18: "creating an invalid scoring system should not be possible") +
-- D168(2); spec §7.3.3.1(5), §12.25, §7.3.8's v2.11 bullet; PROGRESS D272).
--
-- 051 proved the VALIDATOR. This file proves the WALLS — that the validator is
-- actually called, by every path and every role, at the two places a scoring
-- document can enter the system. Nothing here calls `scoring_rules_validate`
-- directly: every assertion is a WRITE, and the verdict is what the write did.
--
-- WHAT THIS FILE PINS, AND THE DEFECT EACH SECTION CATCHES (§4.3):
--
--   §A FORM. One function each (a COUNT — a later CREATE OR REPLACE that
--      changed a signature would leave two). Wall 1 is SECURITY DEFINER and
--      wall 2 is not, and BOTH facts are pinned, because they are a design
--      decision and not an accident: wall 1 reads `public.leagues`, which has
--      RLS, so an INVOKER read would make its reference arm role-dependent and
--      silently empty for exactly the writer it exists to stop. §4.1's DEFINER
--      triad is discharged including the part that does not apply: a
--      `RETURNS TRIGGER` function has no callable surface to authorize, and
--      that is PINNED (`0A000`) rather than asserted. 059's own trigger is
--      still there — this migration stands beside it, never replaces it
--      (D137). And the index the reference arm probes exists.
--
--   §B THE D175(4) CENSUS, TAKEN BEFORE ANY FIXTURE EXISTS. "At build time the
--      profile matches exactly the template rows" is a claim about the live
--      database, so it is MEASURED here as a set equality — not a count that
--      two compensating errors could satisfy — and every profile document is
--      then pushed THROUGH the trigger with the failure count asserted at 0.
--      §B4's first form was vacuous and says so in place: re-writing a row's
--      own `rules` is precisely the write the wall's identity short-circuit
--      skips, so it would have passed against an empty trigger body.
--
--   §C WALL 1, REFUSING THE 001:623 BYPASS **AS THE AUTHENTICATED OWNER**.
--      `"Users can manage own scoring systems" FOR ALL` is the policy §12.25
--      names as the reason a backstop was needed; D175 says the write itself
--      must fail. Seven guardrail families, each asserted on all three axes
--      (family = HINT, dot path = DETAIL, and a MESSAGE naming its own
--      guardrail) THROUGH the trigger, with the row proved unchanged in the
--      same assertion. **An accept reports its ROW COUNT** (`ACCEPT(1)`), so a
--      write that silently matched no row can never read as a pass — the
--      CLAUDE.md "nothing happened" trap, closed by construction.
--
--   §D THE D33 PROTECTION, AND WHY IT IS NOT A SELF-COMPARISON. A legacy
--      research row takes a legacy-namespace document happily — and the SAME
--      document is refused on a row that IS in the profile. Without that
--      control, §D would pass just as well if the wall did nothing at all.
--      Its premises (not a template · no `format` member · zero live leagues
--      referencing it) are asserted, because a fixture that is accidentally
--      out of the profile for the wrong reason proves nothing.
--      **[D175(6)] The second reference path is pinned too:** a row referenced
--      only from `drafts.config->>'scoring_system_id'` (MP.4's standalone
--      mocks, which arm (c)'s `FROM leagues` cannot see) stays writable.
--
--   §E THE REFERENCE ARM AND THE PROFILE-ENTRY ARM — the two arms a fixture
--      most easily makes unreachable. §E1's row is NOT a template and carries
--      NO `format` member, so the reference arm is the only thing that can
--      catch it (premise asserted in §E2); §E3 is this file's break-probe
--      target. **§E4b/§E4c are what make §A3 mean something:** the writer there
--      owns the scoring row but CANNOT SEE the league referencing it, so an
--      INVOKER trigger's arm would read empty and wave the write through —
--      without those two cells, demoting wall 1 to SECURITY INVOKER reds one
--      catalog assertion and nothing that exercises the wall. §E5 pins that
--      the arm is LIVE-only by soft-deleting the league and watching the same
--      write become legal. §E6 is the arm the narrow reading of SE.4b(1) would
--      miss entirely: a row ENTERING the profile via `is_template` without its
--      `rules` ever being touched — with §E7 as its control, so the refusal is
--      provably about the document.
--
--   §F WALL 2. The snapshot backstop refuses a privileged write (triggers bind
--      every role) and — the pin that makes 103's grant load-bearing rather
--      than decorative — refuses a **service_role** write with `P0001` and not
--      `42501`. `service_role` is `rolbypassrls` and NOT superuser, and
--      `leagues` carries only a SELECT policy, so service_role is the one
--      client role that reaches this trigger at all.
--
--   §G F21, AT BOTH WALLS, WITH THE CONTROL. The literal double-pay document
--      cannot enter `scoring_systems` and cannot enter
--      `leagues.scoring_rules_snapshot` — and each key ALONE is accepted on
--      the same row by the same wall, so the refusal is provably about the
--      PAIR (the defect) and not about the names.
--
--   §H THE ROLE SWEEP (§4.2's no-write pattern, RETURNING counts). `anon` can
--      neither insert, update nor delete a scoring system, and cannot touch a
--      league — which is what makes "anon has no EXECUTE on the validator"
--      harmless rather than a hole. A non-owner `authenticated` UPDATE of the
--      fork row affects 0 rows: RLS is still the first gate and the wall is
--      the second.
--
-- NOT PINNED HERE, AND SAID SO: the PostgREST wire path. pgTAP reaches
-- `authenticated` with `set local role` + JWT claims, which is the same
-- in-database subject, but it is not an HTTP request. The client-path proof —
-- the commissioner's own signed-in client attempting the double-pay write and
-- seeing what a caller actually gets back — is `scoring-walls-db.test.ts`
-- (SE.4b(5)). A wall proved only in psql is not proved at the layer that
-- matters.
--
-- Conventions: fixtures created in the `postgres` role BEFORE any JWT claims
-- (D49(7)); every section asserts its own premise before asserting anything
-- about it (F94); the whole file rolls back.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
select plan(63);

-- ---------------------------------------------------------------------------
-- Helpers. Every one of them performs a WRITE and reports what the write did.
--
-- `w1`/`w2` collapse an attempted write into a single comparable string:
--     ACCEPT(<rows>)                    — the write landed, and how many rows
--     <family>|<path>|UNCHANGED         — refused, and the row is proved intact
--     ERROR|<sqlstate>                  — refused for some OTHER reason
-- Folding the unchanged-proof INTO the verdict is deliberate: a trailing
-- "and the row is unchanged" assertion can pass because the write never
-- matched a row, and reporting the row count on the accept side closes the
-- same hole from the other direction (CLAUDE.md: never let "nothing happened"
-- mean "it worked").
-- ---------------------------------------------------------------------------
create function pg_temp.w1(p_id uuid, p_doc jsonb) returns text language plpgsql as $$
declare v_hint text; v_detail text; v_before jsonb; v_after jsonb; v_verdict text; v_rows int;
begin
  select rules into v_before from public.scoring_systems where id = p_id;
  begin
    update public.scoring_systems set rules = p_doc where id = p_id;
    get diagnostics v_rows = row_count;
    return 'ACCEPT(' || v_rows || ')';
  exception when others then
    if sqlstate <> 'P0001' then
      v_verdict := 'ERROR|' || sqlstate;
    else
      get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
      v_verdict := coalesce(v_hint, '?') || '|' || coalesce(v_detail, '?');
    end if;
  end;
  select rules into v_after from public.scoring_systems where id = p_id;
  return v_verdict || '|'
      || case when v_after is not distinct from v_before then 'UNCHANGED' else 'MUTATED' end;
end;
$$;

/** The refusal MESSAGE of a wall-1 write (the E75 axis). */
create function pg_temp.w1msg(p_id uuid, p_doc jsonb) returns text language plpgsql as $$
begin
  update public.scoring_systems set rules = p_doc where id = p_id;
  return '(accepted)';
exception when others then
  return sqlerrm;
end;
$$;

/** Wall 1's INSERT arm. */
create function pg_temp.w1ins(p_name text, p_owner uuid, p_template boolean, p_doc jsonb)
returns text language plpgsql as $$
declare v_hint text; v_detail text;
begin
  insert into public.scoring_systems (name, owner_id, is_template, rules)
  values (p_name, p_owner, p_template, p_doc);
  return 'ACCEPT(1)';
exception when others then
  if sqlstate <> 'P0001' then return 'ERROR|' || sqlstate; end if;
  get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return coalesce(v_hint, '?') || '|' || coalesce(v_detail, '?');
end;
$$;

/** Wall 1's profile-ENTRY arm: flip a row INTO the profile without touching
 *  `rules` at all. (058's `scoring_systems_template_ownerless` CHECK forces
 *  `owner_id = NULL` alongside, which is why the narrow "rules changed"
 *  reading would let this through.) */
create function pg_temp.w1flip(p_id uuid) returns text language plpgsql as $$
declare v_hint text; v_detail text; v_before boolean; v_after boolean;
begin
  select is_template into v_before from public.scoring_systems where id = p_id;
  begin
    update public.scoring_systems set is_template = true, owner_id = null where id = p_id;
    return 'ACCEPT(1)';
  exception when others then
    if sqlstate <> 'P0001' then
      select is_template into v_after from public.scoring_systems where id = p_id;
      return 'ERROR|' || sqlstate;
    end if;
    get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
    v_hint := coalesce(v_hint, '?') || '|' || coalesce(v_detail, '?');
  end;
  select is_template into v_after from public.scoring_systems where id = p_id;
  return v_hint || '|'
      || case when v_after is not distinct from v_before then 'UNCHANGED' else 'MUTATED' end;
end;
$$;

/** Wall 2: an attempted `scoring_rules_snapshot` write on a league. */
create function pg_temp.w2(p_id uuid, p_snap jsonb) returns text language plpgsql as $$
declare v_hint text; v_detail text; v_before jsonb; v_after jsonb; v_verdict text; v_rows int;
begin
  select scoring_rules_snapshot into v_before from public.leagues where id = p_id;
  begin
    update public.leagues set scoring_rules_snapshot = p_snap where id = p_id;
    get diagnostics v_rows = row_count;
    return 'ACCEPT(' || v_rows || ')';
  exception when others then
    if sqlstate <> 'P0001' then
      v_verdict := 'ERROR|' || sqlstate;
    else
      get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
      v_verdict := coalesce(v_hint, '?') || '|' || coalesce(v_detail, '?');
    end if;
  end;
  select scoring_rules_snapshot into v_after from public.leagues where id = p_id;
  return v_verdict || '|'
      || case when v_after is not distinct from v_before then 'UNCHANGED' else 'MUTATED' end;
end;
$$;

create function pg_temp.w2msg(p_id uuid, p_snap jsonb) returns text language plpgsql as $$
begin
  update public.leagues set scoring_rules_snapshot = p_snap where id = p_id;
  return '(accepted)';
exception when others then
  return sqlerrm;
end;
$$;

/** Wall 2's INSERT arm — a league born carrying a snapshot. */
create function pg_temp.w2ins(p_id uuid, p_owner uuid, p_name text, p_snap jsonb)
returns text language plpgsql as $$
declare v_hint text; v_detail text;
begin
  insert into public.leagues (id, owner_id, name, season, status, team_count, scoring_rules_snapshot)
  values (p_id, p_owner, p_name, 2026, 'setup', 8, p_snap);
  return 'ACCEPT(1)';
exception when others then
  if sqlstate <> 'P0001' then return 'ERROR|' || sqlstate; end if;
  get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return coalesce(v_hint, '?') || '|' || coalesce(v_detail, '?');
end;
$$;

-- The format-2 envelope shape `forkTemplateDoc` produces and SE.5's fork RPC
-- will insert. LIFTED from pgTAP 051's helper of the same name (SE.4), not
-- re-derived — the two files must agree about what a fork document looks like.
create function pg_temp.env(p_base jsonb, p_positions jsonb default '{}'::jsonb,
                            p_pa jsonb default '[0,1,7,14,18,28,35,46]'::jsonb,
                            p_ya jsonb default '[0,100,200,300,350,400,450,500,550]'::jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object('format', 2, 'base', p_base, 'positions', p_positions,
                            'tier_cuts', jsonb_build_object('def_pa', p_pa, 'def_ya', p_ya));
$$;

-- ===========================================================================
-- §A FORM — the deployed shape of both walls
-- ===========================================================================

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'scoring_systems_rules_guard'),
  1, 'A1: exactly one scoring_systems_rules_guard (a COUNT — a CREATE OR REPLACE that changed the signature would leave two and the trigger would bind the wrong one)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'leagues_scoring_rules_valid'),
  1, 'A2: exactly one leagues_scoring_rules_valid');

select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'scoring_systems_rules_guard'),
  true,
  'A3: wall 1 IS SECURITY DEFINER — it reads public.leagues, which has RLS, so an INVOKER read would make D175(2)''s reference arm role-dependent and silently EMPTY for exactly the writer it exists to stop. Demoting it to INVOKER reds here');
select is(
  (select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'scoring_systems_rules_guard'),
  array['search_path=""'],
  'A4: …with search_path pinned empty (§4.1''s other half — a DEFINER function with a mutable search_path is the whole point of the rule)');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'leagues_scoring_rules_valid'),
  false,
  'A5: wall 2 is NOT SECURITY DEFINER — it reads no table, so it borrows no privileges (059''s leagues_snapshot_guard shape, deliberately)');
select is(
  (select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'leagues_scoring_rules_valid'),
  array['search_path=""'],
  'A6: …and still pins search_path empty');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('scoring_systems_rules_guard', 'leagues_scoring_rules_valid')
      and p.prorettype = 'pg_catalog.trigger'::regtype),
  2, 'A7: both return `trigger` — which is what makes them uncallable, pinned next');

select throws_ok(
  $$ select public.scoring_systems_rules_guard() $$,
  '0A000', null,
  'A8: wall 1 is NOT CALLABLE outside a trigger context. This is §4.1''s in-body-authorization requirement DISCHARGED rather than waived: there is no subject to authorize because there is no caller, and the reason is pinned instead of asserted');
select throws_ok(
  $$ select public.leagues_scoring_rules_valid() $$,
  '0A000', null,
  'A9: …and so is wall 2');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
        lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public'
      and p.proname in ('scoring_systems_rules_guard', 'leagues_scoring_rules_valid')
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0 or a.grantee = 'anon'::regrole::oid)),
  0, 'A10: neither wall function is EXECUTEable by PUBLIC or anon (the REVOKEs are emitted, the 038/059/103 precedent)');

select is(
  (select count(distinct a.grantee)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
        lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and p.proname = 'scoring_rules_validate'
      and a.privilege_type = 'EXECUTE'
      and a.grantee in ('authenticated'::regrole::oid, 'service_role'::regrole::oid)),
  2,
  'A11: `authenticated` AND `service_role` still hold EXECUTE on scoring_rules_validate (103, via 037''s default ACLs). This is LOAD-BEARING for wall 2, which is INVOKER: service_role is rolbypassrls and writes `leagues` straight through PostgREST, so without this grant the wall would refuse with 42501 instead of the P0001 field-path contract SE.5/SE.6 consume. §F6 pins the consequence');

select is(
  (select count(*)::int from pg_trigger t
    where t.tgrelid = 'public.scoring_systems'::regclass
      and t.tgname = 'trg_scoring_systems_rules_guard'
      and not t.tgisinternal
      and (t.tgtype & 2) = 2       -- BEFORE
      and (t.tgtype & 1) = 1       -- FOR EACH ROW
      and (t.tgtype & 4) = 4       -- INSERT
      and (t.tgtype & 16) = 16),   -- UPDATE
  1, 'A12: trg_scoring_systems_rules_guard is BEFORE INSERT OR UPDATE ... FOR EACH ROW on scoring_systems (the timing matters: an AFTER trigger would refuse only after the row had been written and the statement''s other effects had fired)');
select is(
  (select count(*)::int from pg_trigger t
    where t.tgrelid = 'public.leagues'::regclass
      and t.tgname = 'trg_leagues_scoring_rules_valid'
      and not t.tgisinternal
      and (t.tgtype & 2) = 2 and (t.tgtype & 1) = 1
      and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16),
  1, 'A13: trg_leagues_scoring_rules_valid, same shape, on leagues');

select is(
  (select count(*)::int from pg_trigger t
    where t.tgrelid = 'public.leagues'::regclass
      and t.tgname = 'trg_leagues_snapshot_guard' and not t.tgisinternal),
  1, 'A14: 059''s trg_leagues_snapshot_guard is STILL THERE — 104 stands beside it and does not replace it (D137''s no-in-place posture; 059 makes the snapshot non-NULL in drafting+, 104 makes it VALID)');

select is(
  (select count(*)::int from pg_index i
     join pg_class c on c.oid = i.indexrelid
    where i.indrelid = 'public.leagues'::regclass
      and c.relname = 'idx_leagues_scoring_system'
      and i.indnatts = 1
      and (select attname from pg_attribute
            where attrelid = 'public.leagues'::regclass and attnum = i.indkey[0]) = 'scoring_system_id'),
  1, 'A15: idx_leagues_scoring_system exists on leagues(scoring_system_id) — absent since 001, probed by wall 1''s reference arm on every in-profile write and scanned by §12.25''s member policy (plan §8.1)');

-- ===========================================================================
-- §B THE D175(4) CENSUS — taken BEFORE this file creates a single fixture row
-- ===========================================================================

select cmp_ok(
  (select count(*) from scoring_systems), '>=', 6::bigint,
  'B1 (non-vacuity, F94): scoring_systems is not empty — every claim below is about real rows');

select is(
  (select count(*)::int from scoring_systems where is_template),
  6, 'B2: 058''s six parity template rows, the stored literal');

select is(
  (select array_agg(id order by id) from scoring_systems s
    where s.is_template
       or s.rules ? 'format'
       or exists (select 1 from leagues l where l.scoring_system_id = s.id and l.deleted_at is null)),
  (select array_agg(id order by id) from scoring_systems where is_template),
  'B3 (D175(4)): the league PROFILE is EXACTLY the template rows at build time — a SET equality, not a count, so two compensating errors cannot satisfy it. Everything else in the table is the D33 research world and is untouched by this migration');

-- B4 — and this cell was VACUOUS in its first form, which is recorded rather
-- than quietly fixed (§4 rule 9). It re-wrote each profile row's own `rules`
-- back onto itself and asserted the write landed — but the wall's identity
-- short-circuit SKIPS exactly that write ("already in the profile, carrying
-- the identical document"), so the validator was never reached and the cell
-- would have passed against a trigger body that was entirely empty. It now
-- INSERTS a template copy of each profile document under a fresh name, which
-- is an INSERT into the profile through arm (a) and therefore genuinely
-- validated.
select is(
  (select count(*)::int from scoring_systems s
    cross join lateral (
      select pg_temp.w1ins('pgtap-052-census-' || s.id::text, null, true, s.rules) as v
    ) c
   where (s.is_template
          or s.rules ? 'format'
          or exists (select 1 from leagues l where l.scoring_system_id = s.id and l.deleted_at is null))
     and c.v <> 'ACCEPT(1)'),
  0, 'B4 (D175(4)): every document in the profile is pushed THROUGH the trigger (as a fresh template INSERT — arm (a), which the identity short-circuit cannot skip) and lands. "Existing rows are never retroactively invalidated" is measured here, not assumed');
delete from scoring_systems where name like 'pgtap-052-census-%';

-- ---------------------------------------------------------------------------
-- Fixtures (postgres role, BEFORE any JWT claims — D49(7))
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('90520000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-se4b-u' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       ('{"username": "se4b_user_' || i || '"}')::jsonb, now(), now()
from generate_series(1, 4) i;

-- s1 — THE FORK ROW. Commissioner-owned, format 2, and referenced by a live
-- league: in the profile by TWO arms at once, which is the shape the editor
-- actually produces.
insert into scoring_systems (id, name, owner_id, is_template, rules) values
  ('50520000-0000-4000-8000-000000000001', 'pgtap-se4b-fork',
   '90520000-0000-4000-8000-000000000001', false,
   pg_temp.env('{"pass_yards": 0.04, "pass_tds": 4, "receptions": 1}'::jsonb));

-- s2 — THE RESEARCH ROW (D33). Legacy column-name namespace, no owner-league,
-- no `format` member: outside the profile entirely.
insert into scoring_systems (id, name, owner_id, is_template, rules) values
  ('50520000-0000-4000-8000-000000000002', 'pgtap-se4b-research',
   '90520000-0000-4000-8000-000000000002', false,
   '{"passing_yards": 0.04, "rushing_yards": 0.1, "receiving_yards": 0.1}'::jsonb);

-- s3 — THE MOCK-REFERENCED ROW (D175(6)). Referenced ONLY from
-- drafts.config->>'scoring_system_id', which arm (c)'s `FROM leagues` cannot
-- see. Deliberately outside the profile.
insert into scoring_systems (id, name, owner_id, is_template, rules) values
  ('50520000-0000-4000-8000-000000000003', 'pgtap-se4b-mockref',
   '90520000-0000-4000-8000-000000000003', false,
   '{"passing_yards": 0.05}'::jsonb);

-- s4 — THE FLAT ATTACHED ROW. NOT a template and carrying NO `format` member,
-- so ONLY the live-league-referenced arm can ever put it in the profile. This
-- is the arm the DoD break probe deletes.
insert into scoring_systems (id, name, owner_id, is_template, rules) values
  ('50520000-0000-4000-8000-000000000004', 'pgtap-se4b-flat-attached',
   '90520000-0000-4000-8000-000000000001', false,
   '{"pass_yards": 0.04, "receptions": 1}'::jsonb);

-- s6 — THE CELL THAT MAKES `SECURITY DEFINER` FALSIFIABLE BEHAVIOURALLY.
-- Owned by user 4, and referenced by a league owned by user 1 that user 4
-- cannot see (leagues' only policy is `is_league_member(id) OR owner_id =
-- auth.uid()`). An INVOKER trigger's reference arm would read EMPTY for user 4
-- and let the corrupt write through; a DEFINER one sees the whole table.
insert into scoring_systems (id, name, owner_id, is_template, rules) values
  ('50520000-0000-4000-8000-000000000006', 'pgtap-se4b-foreign-owner',
   '90520000-0000-4000-8000-000000000004', false,
   '{"pass_yards": 0.04}'::jsonb);

-- s5 — a second research row, carrying a VALID league document. §E6's control:
-- the profile-entry arm refuses because of the DOCUMENT, not because it is a
-- flip.
insert into scoring_systems (id, name, owner_id, is_template, rules) values
  ('50520000-0000-4000-8000-000000000005', 'pgtap-se4b-flip-control',
   '90520000-0000-4000-8000-000000000002', false,
   '{"pass_yards": 0.04}'::jsonb);

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings) values
  ('b0520000-0000-4000-8000-0000000000aa', '90520000-0000-4000-8000-000000000001',
   'pgtap-se4b-fork-league', 2026, 'setup', 8,
   '50520000-0000-4000-8000-000000000001', '{}'::jsonb),
  ('b0520000-0000-4000-8000-0000000000bb', '90520000-0000-4000-8000-000000000001',
   'pgtap-se4b-flat-league', 2026, 'setup', 8,
   '50520000-0000-4000-8000-000000000004', '{}'::jsonb),
  ('b0520000-0000-4000-8000-0000000000cc', '90520000-0000-4000-8000-000000000001',
   'pgtap-se4b-snapshot-league', 2026, 'setup', 8, null, '{}'::jsonb),
  ('b0520000-0000-4000-8000-0000000000ff', '90520000-0000-4000-8000-000000000001',
   'pgtap-se4b-foreign-league', 2026, 'setup', 8,
   '50520000-0000-4000-8000-000000000006', '{}'::jsonb);

-- The standalone mock (MP.4/095: league_id IS NULL) whose config carries s3.
insert into drafts (id, league_id, draft_type, status, is_mock, config) values
  ('e0520000-0000-4000-8000-0000000000f1', null, 'snake', 'scheduled', true,
   '{"scoring_system_id": "50520000-0000-4000-8000-000000000003"}'::jsonb);

-- ===========================================================================
-- §C WALL 1 — the 001:623 `FOR ALL` bypass, refused AT THE TABLE, as the
--    AUTHENTICATED OWNER (D175(1); §12.25's "001's owner FOR ALL would let a
--    commissioner hand-write an arbitrary doc")
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90520000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000001',
             pg_temp.env('{"pass_tds": 4}'::jsonb) || '{"postions": {"QB": {"receptions": 99}}}'::jsonb),
  'document_shape|postions|UNCHANGED',
  'C1 document_shape: a stray envelope member (`postions`, one transposed letter) is refused at the WRITE — R588''s defect, which would otherwise have discarded the commissioner''s whole override map while the save reported success');

select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000001',
             pg_temp.env('{"def_points_allowed": 1}'::jsonb)),
  'scorable_allowlist|base.def_points_allowed|UNCHANGED',
  'C2 scorable_allowlist: the RAW SOURCE — paying `def_points_allowed` beside the tiers derived from it is the double-count F21 is about');
select matches(
  pg_temp.w1msg('50520000-0000-4000-8000-000000000001',
                pg_temp.env('{"def_points_allowed": 1}'::jsonb)),
  'Scorable allowlist \(§7\.3\.3\.1 guardrail 1\).*context key.*double-count',
  'C2m (E75): the message that comes back OUT OF THE WRITE names guardrail 1, says it is a context key, and says why — the wall preserves 103''s contract instead of re-raising its own');

select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000001',
             pg_temp.env('{"def_pa_14_20": 4}'::jsonb)),
  'tier_exclusivity|base.def_pa_14_20|UNCHANGED',
  'C3 tier_exclusivity: a document cannot name a tier its OWN cuts do not cut — the mechanism that makes F21 inexpressible rather than merely refused');
select matches(
  pg_temp.w1msg('50520000-0000-4000-8000-000000000001',
                '{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
  'Tier exclusivity \(§7\.3\.3\.1 guardrail 2\).*F21 defect',
  'C3m (E75): …and the flat-arm message names guardrail 2 and the ledger row it closes');

select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000001',
             pg_temp.env('{"pass_tds": 4}'::jsonb, '{"QB": {"fg_0_39": 4}}'::jsonb)),
  'position_scope|positions.QB.fg_0_39|UNCHANGED',
  'C4 position_scope: a KICKING key under QB, refused at its own dot path');

select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000001',
             pg_temp.env('{"receptions": 1}'::jsonb, '{"TE": {"receptions": 1}}'::jsonb)),
  'normal_form|positions.TE.receptions|UNCHANGED',
  'C5 normal_form: a no-op override, refused per key — the All-Positions switch is derived state and would read OFF for a section whose values are in fact uniform');

select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000001',
             pg_temp.env('{"pass_tds": 100.01}'::jsonb)),
  'bounds|base.pass_tds|UNCHANGED',
  'C6 bounds: |coef| one unit over 100, refused at `base` — the layer a fork writes the whole template into');
select matches(
  pg_temp.w1msg('50520000-0000-4000-8000-000000000001',
                pg_temp.env('{"pass_tds": 100.01}'::jsonb)),
  'Bounds \(§7\.3\.3\.1 guardrail 5\).*100\.01.*\|coef\| ≤ 100',
  'C6m (E75): …naming guardrail 5, the offending value, and the bound');

select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000001',
             pg_temp.env('{"pass_tds": 4}'::jsonb, '{}'::jsonb, '[0,7,7]'::jsonb)),
  'tier_cuts|tier_cuts.def_pa|UNCHANGED',
  'C7 tier_cuts: §7.3.3.1(c)''s residual — a non-ascending cut list, refused at its table''s path');

select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000001',
             pg_temp.env('{"pass_yards": 0.04, "pass_tds": 6}'::jsonb)),
  'ACCEPT(1)',
  'C8: and a VALID edit LANDS — one row. Without this the seven refusals above are equally consistent with a wall that refuses everything, and the row count is what stops a silently-unmatched write from reading as a pass');

-- ===========================================================================
-- §D THE D33 PROTECTION — the research world is untouched, and the control
--    that makes that claim mean something (§4: never a self-comparison)
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub": "90520000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

select is(
  (select (not is_template)
          and not (rules ? 'format')
          and not exists (select 1 from leagues l
                           where l.scoring_system_id = s.id and l.deleted_at is null)
     from scoring_systems s where s.id = '50520000-0000-4000-8000-000000000002'),
  true,
  'D1 (premise, F94): the research row is outside ALL THREE profile arms — not a template, no `format` member, referenced by no live league. A fixture that fell outside for the wrong reason would prove nothing');

-- The shared control document carries EXACTLY ONE league-invalid key, on
-- purpose: 103's banner records that SQL raises on the FIRST violation in
-- `jsonb` STORAGE order (shortest key first), so a document with three
-- violations would pin storage order rather than the wall. One violation, one
-- unambiguous dot path, three cells that can be compared to each other.
select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000002', '{"passing_yards": 0.05}'::jsonb),
  'ACCEPT(1)',
  'D2 (D175(2), the boundary charter): a LEGACY-NAMESPACE document lands on a research row. `passing_yards` is not a §23.5 key at all — under the league validator it is a named refusal — and that is exactly why the profile exists. No legacy-row migration, no retroactive invalidation');

set local role postgres;
select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000001', '{"passing_yards": 0.05}'::jsonb),
  'scorable_allowlist|passing_yards|UNCHANGED',
  'D3 (THE CONTROL): the IDENTICAL document, written to a row that IS in the profile, is refused by name. §D2 passes because of the PROFILE, not because the document is harmless — and without this cell §D2 would pass just as well if the trigger did nothing at all');

select is(
  (select count(*)::int from drafts d
    where d.config->>'scoring_system_id' = '50520000-0000-4000-8000-000000000003'
      and d.league_id is null and d.is_mock),
  1, 'D4 (premise, D175(6)): exactly one standalone mock references s3 through drafts.config, and it has no league at all');
select is(
  (select count(*)::int from leagues l
    where l.scoring_system_id = '50520000-0000-4000-8000-000000000003' and l.deleted_at is null),
  0, 'D5 (premise): …and no league references it, so arm (c) genuinely cannot see this reference');
select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000003',
             '{"passing_yards": 0.06, "touchdowns": 6}'::jsonb),
  'ACCEPT(1)',
  'D6 (D175(6)): a MOCK-only reference stays writable with a legacy-shaped flat doc. This is the correct outcome and it is pinned so the silence does not read as an oversight — standalone mocks pick from the six shipped templates (arm (a) anyway), the reference is deliberately unvalidated server-side (tasks-MP §4 rule 10), and a mock scores nothing that persists');

-- ===========================================================================
-- §E THE REFERENCE ARM (the DoD break-probe target) AND THE PROFILE-ENTRY ARM
-- ===========================================================================

select is(
  (select (not is_template) and not (rules ? 'format')
     from scoring_systems where id = '50520000-0000-4000-8000-000000000004'),
  true,
  'E1 (premise): s4 is NOT a template and carries NO `format` member — so arms (a) and (b) are both dark and the LIVE-LEAGUE-REFERENCED arm is the only thing that can put it in the profile');
select is(
  (select count(*)::int from leagues l
    where l.scoring_system_id = '50520000-0000-4000-8000-000000000004' and l.deleted_at is null),
  1, 'E2 (premise): …and exactly one live league references it');

select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000004',
             '{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
  'tier_exclusivity|(document)|UNCHANGED',
  'E3 (D175(2) arm (c) — THE HOLE A FORMAT-ONLY PROFILE WOULD LEAVE): a fork row REWRITTEN as an invalid flat map WHILE IT IS STILL ATTACHED. Only the reference arm catches this; delete that arm and this cell is the one that goes red');

select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000004', '{"pass_yards": 0.05, "receptions": 0.5}'::jsonb),
  'ACCEPT(1)',
  'E4: …and a VALID flat edit to the same attached row lands');

-- ── E4b/E4c: the reference arm has to work for a writer who CANNOT SEE the
--    referencing league. This is §A3's structural DEFINER pin made
--    behavioural — without it, demoting wall 1 to SECURITY INVOKER reds
--    exactly one catalog cell and NOTHING that exercises the wall, because
--    every other writer in this file is either postgres or the league's own
--    owner. `leagues` policy: `is_league_member(id) OR owner_id = auth.uid()`.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90520000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select is(
  (select count(*)::int from leagues
    where scoring_system_id = '50520000-0000-4000-8000-000000000006'),
  0, 'E4b (premise): user 4 owns s6 but CANNOT SEE the league referencing it — their own SELECT on `leagues` returns zero rows, so an INVOKER reference arm would evaluate to FALSE and wave the next write through');
select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000006',
             '{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
  'tier_exclusivity|(document)|UNCHANGED',
  'E4c: …and the corrupt write is refused ANYWAY. The profile is a SYSTEM fact (D175(2) writes the EXISTS with no membership join), so the wall must read `leagues` past RLS — which is the whole reason wall 1 is SECURITY DEFINER');
set local role postgres;

update leagues set deleted_at = now() where id = 'b0520000-0000-4000-8000-0000000000bb';
select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000004',
             '{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
  'ACCEPT(1)',
  'E5: the reference arm is LIVE-only (`deleted_at IS NULL`, §12.25''s own predicate). Soft-delete the league and the very same write becomes legal — the row is a personal one again, and D175(3) says re-attach validates (D169''s arm) and any snapshot validates (D168''s wall), so an invalid doc still can never score');
update leagues set deleted_at = null where id = 'b0520000-0000-4000-8000-0000000000bb';
update scoring_systems set rules = '{"pass_yards": 0.04, "receptions": 1}'::jsonb
  where id = '50520000-0000-4000-8000-000000000004';

select is(
  pg_temp.w1flip('50520000-0000-4000-8000-000000000002'),
  'scorable_allowlist|passing_yards|UNCHANGED',
  'E6 (THE ARM THE NARROW READING MISSES): a research row ENTERING the profile via `is_template` — with `rules` never touched. D175(1) says the trigger validates "whenever the row is in the league profile"; SE.4b(1)''s "and rules is new or changed" alone would mint a world-readable, league-attachable template carrying a legacy document the wall had never seen. Only service_role/postgres can reach it (058''s ownerless CHECK forces owner_id = NULL, which 001:623 re-uses as its WITH CHECK) — and D175 says the wall binds every role');
select is(
  pg_temp.w1flip('50520000-0000-4000-8000-000000000005'),
  'ACCEPT(1)',
  'E7 (the control for E6): the same flip on a row whose document IS valid succeeds. E6 refuses because of the DOCUMENT, not because flipping is forbidden');

-- ===========================================================================
-- §F WALL 2 — the snapshot backstop (D168(2), §12.25's integrity backstop)
-- ===========================================================================

select is(
  pg_temp.w2('b0520000-0000-4000-8000-0000000000cc',
             '{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
  'tier_exclusivity|(document)|UNCHANGED',
  'F1: a PRIVILEGED write of an invalid snapshot is refused — as `postgres`, because triggers bind every role and ignore BYPASSRLS (the D43 argument). A league can therefore never enter `drafting` on an invalid document, loudly, whatever writes it');
select matches(
  pg_temp.w2msg('b0520000-0000-4000-8000-0000000000cc',
                '{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
  'Tier exclusivity \(§7\.3\.3\.1 guardrail 2\).*F21 defect',
  'F1m (E75): …with 103''s message intact through the trigger');

select is(
  pg_temp.w2('b0520000-0000-4000-8000-0000000000cc', '{"pass_yards": 0.04, "receptions": 1}'::jsonb),
  'ACCEPT(1)',
  'F2: a VALID snapshot lands');
select is(
  (select scoring_rules_snapshot from leagues where id = 'b0520000-0000-4000-8000-0000000000cc'),
  '{"pass_yards": 0.04, "receptions": 1}'::jsonb,
  'F3: …and it is frozen VERBATIM — jsonb equality against the literal that was written (§7.3.3.1''s freeze-verbatim law: the wall validates, it never rewrites what it was sent)');

select is(
  pg_temp.w2ins('b0520000-0000-4000-8000-0000000000dd', '90520000-0000-4000-8000-000000000001',
                'pgtap-se4b-born-invalid', '{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
  'tier_exclusivity|(document)',
  'F4: the INSERT arm — a league BORN carrying an invalid snapshot is refused too (059''s guard checks NEW on both operations for the same reason; a guard that only watched UPDATE would be one INSERT away from useless)');
select is(
  pg_temp.w2ins('b0520000-0000-4000-8000-0000000000ee', '90520000-0000-4000-8000-000000000001',
                'pgtap-se4b-born-valid', '{"pass_yards": 0.04}'::jsonb),
  'ACCEPT(1)',
  'F5: …and a league born with a VALID snapshot lands');

select lives_ok(
  $$ update leagues set name = 'pgtap-se4b-snapshot-league-renamed'
      where id = 'b0520000-0000-4000-8000-0000000000cc' $$,
  'F6: an UPDATE that does not touch the snapshot is not revalidated — the wall fires on new or CHANGED snapshots, so ordinary league edits pay nothing');
select is(
  pg_temp.w2('b0520000-0000-4000-8000-0000000000cc', null),
  'ACCEPT(1)',
  'F7: a NULL snapshot is not a document and is left alone — the column is nullable pre-drafting, and 059''s guard (still present, A14) is what forbids NULL in drafting+');

set local role service_role;
select is(
  pg_temp.w2('b0520000-0000-4000-8000-0000000000cc',
             '{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
  'tier_exclusivity|(document)|UNCHANGED',
  'F8 (WHY A11 IS LOAD-BEARING): as `service_role` — rolbypassrls, NOT superuser, and the ONE client role that can write `leagues` at all now that only a SELECT policy remains — the refusal is P0001 with the field path, not 42501. Wall 2 is INVOKER, so it calls the validator as the writing role; REVOKE EXECUTE from service_role and this cell reds with ERROR|42501');
set local role postgres;

-- ===========================================================================
-- §G F21 AT BOTH WALLS — the ledger row's own evidence, with its control
-- ===========================================================================

select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000001',
             '{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
  'tier_exclusivity|(document)|UNCHANGED',
  'G1 (F21): the literal double-pay document — `def_pa_14_20` + `def_pa_18_27`, the pair the ledger row was filed for in R55 — cannot be written into a league scoring system. A PA=18–20 week one-hots BOTH families and pays twice; SE.3 measured it at 7 = 4 + 3 through the shipped derivation and the shipped calculator');
select is(
  pg_temp.w2('b0520000-0000-4000-8000-0000000000cc',
             '{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
  'tier_exclusivity|(document)|UNCHANGED',
  'G2 (F21): …and it cannot reach `leagues.scoring_rules_snapshot` either, so it can never be frozen into a draft');

select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000001', '{"def_pa_14_20": 4}'::jsonb),
  'ACCEPT(1)',
  'G3 (the control): `def_pa_14_20` ALONE is accepted by the same wall on the same row');
select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000001', '{"def_pa_18_27": 3}'::jsonb),
  'ACCEPT(1)',
  'G4 (the control): so is `def_pa_18_27` alone. The refusal is provably about the PAIR — the defect — and not about either name, which is the difference between a guardrail and a blocklist');

-- ===========================================================================
-- §H THE ROLE SWEEP (§4.2's no-write pattern, RETURNING counts)
-- ===========================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select results_eq(
  $$ with w as (update scoring_systems set rules = '{"pass_yards": 9}'::jsonb
                 where id = '50520000-0000-4000-8000-000000000001' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'H1: anon UPDATE of a league scoring system affects 0 rows (RLS is the first gate; the wall is the second)');
select throws_ok(
  $$ insert into scoring_systems (name, owner_id, rules)
     values ('pgtap-se4b-anon', null, '{"pass_yards": 9}'::jsonb) $$,
  '42501', null,
  'H2: anon INSERT into scoring_systems denied');
select results_eq(
  $$ with w as (delete from scoring_systems
                 where id = '50520000-0000-4000-8000-000000000001' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'H3: anon DELETE affects 0 rows');
select results_eq(
  $$ with w as (update leagues set scoring_rules_snapshot = '{"pass_yards": 9}'::jsonb
                 where id = 'b0520000-0000-4000-8000-0000000000cc' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'H4: anon cannot write a league snapshot at all — which is what makes "anon holds no EXECUTE on scoring_rules_validate" (103) harmless rather than a hole in wall 2');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "90520000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select results_eq(
  $$ with w as (update scoring_systems set rules = '{"pass_yards": 9}'::jsonb
                 where id = '50520000-0000-4000-8000-000000000001' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'H5: a NON-OWNER authenticated user''s UPDATE of the commissioner''s fork row affects 0 rows — 001:623 is scoped to the owner, and the wall does not replace that scoping, it stands behind it');

set local role postgres;
select * from finish();
rollback;
