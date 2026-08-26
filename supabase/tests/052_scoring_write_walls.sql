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
--   ── THE FIX ROUND'S ADDITIONS, AND THE RULE THEY COME FROM ──────────────
--   Review of the first cut found one breach and three decorations, and they
--   were the SAME THREE LINES: every vacuity in this lane sits on a
--   **permissive** branch — a short-circuit or a skip — because permissive
--   branches are invisible to a suite built from refusal assertions. A wall
--   whose refusals are heavily pinned and whose skips are unpinned is exactly
--   a wall that lets one write through, and it did. **The standing rule
--   adopted here: every skip/short-circuit clause gets a `lives_ok` fixture
--   that reds when the clause is deleted, and the probe list enumerates every
--   disjunct of every profile predicate.**
--
--   **That last half was OVERSTATED and is corrected in place (R629): it is
--   true of the NEW-side predicate and was false of the OLD-side one.** The
--   OLD-side disjunction turned out to be a tautology — control cannot reach
--   it unless NEW is in the profile, and the conjuncts above it hold every
--   input the predicate reads equal — so its arms were unreachable, deleting
--   any one of them red nothing, and deleting the whole block left 052 green
--   AND CORRECT. It is deleted in 104 rather than pinned: a clause that cannot
--   change an outcome cannot be given a killing cell, and pinning it would
--   have manufactured exactly the decoration this rule exists to prevent.
--   **The generalisation the second review drew, which is the real rule: the
--   suite pins what the guards DO and not what determines WHETHER they run.**
--   Event mask, enablement mode, early returns, skip clauses and cross-table
--   premises are all part of the guard. Concretely:
--
--   §E5c–§E5f  the forged corrupt-while-attached state, built by disabling
--              WALL 3 and nothing else, so the next four cells measure the
--              other walls independently of it. §E5d is the identity
--              short-circuit's first killing cell in either suite (`lives_ok`
--              — D175(4) says a non-`rules` edit must LAND); §E5e is R615's
--              TWO-step `is_template` escape, which the one-step §E6 could
--              never reach because neither of its flip targets was
--              league-referenced; §E5f is R617 at the actual writer,
--              `snapshot_league_scoring_internal`.
--   §E5b       door 3 — soft-delete, legally rewrite, revive — which this file
--              used to walk through in its own cleanup while asserting nothing
--              about it.
--   §E8/§E9    profile arm (b). The mutant matrix had arm (a) → 1 red, arm (c)
--              → 5 reds, **arm (b) → 0**: the file's only format-2 row was also
--              league-referenced, so arm (c) caught everything.
--   §F9–§F11   wall 2's `UPDATE OF` clause, with a forged INVALID resting
--              snapshot — without which revalidation is a no-op and the branch
--              cannot fail. §F10 is the `lives_ok`; §F11 is R617's
--              identical-value re-freeze.
--   §F12       `session_replication_role = 'replica'` (R616) behaviourally,
--              because §A16's catalog flag certifies the keyword, not the
--              consequence.
--   §A16–§A21  ENABLE ALWAYS · the completed REVOKE · wall 2's column scope ·
--              wall 3's form and its two columns · wall 3's 0A000.
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
select plan(93);

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

/** Does a DOCUMENT fail the validator? A premise helper only — it performs no
 *  write and asserts nothing about the walls; it exists so a forged-state
 *  premise can say "and the stored document really is invalid" without going
 *  through a write the identity short-circuit would skip. */
create function pg_temp.docfails(d jsonb) returns boolean language plpgsql as $$
begin
  perform public.scoring_rules_validate(d);
  return false;
exception when others then
  return true;
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

/** WALL 3 (R618): an attempted `leagues.scoring_system_id` / `deleted_at`
 *  write. Same verdict grammar; the unchanged-proof is on the league row. */
create function pg_temp.w3(p_id uuid, p_ref uuid, p_undelete boolean default false)
returns text language plpgsql as $$
declare v_hint text; v_detail text; v_before uuid; v_del_before timestamptz;
        v_after uuid; v_del_after timestamptz; v_verdict text; v_rows int;
begin
  select scoring_system_id, deleted_at into v_before, v_del_before
    from public.leagues where id = p_id;
  begin
    if p_undelete then
      update public.leagues set deleted_at = null where id = p_id;
    else
      update public.leagues set scoring_system_id = p_ref where id = p_id;
    end if;
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
  select scoring_system_id, deleted_at into v_after, v_del_after
    from public.leagues where id = p_id;
  return v_verdict || '|'
      || case when v_after is not distinct from v_before
                and v_del_after is not distinct from v_del_before
              then 'UNCHANGED' else 'MUTATED' end;
end;
$$;

/** WALL 3's INSERT arm (R627, door 2): a `leagues` row born already carrying a
 *  `scoring_system_id`. `create_league` is its production writer, but the raw
 *  table takes one too and no RPC is in that path. */
create function pg_temp.w3ins(p_id uuid, p_owner uuid, p_name text, p_ref uuid)
returns text language plpgsql as $$
declare v_hint text; v_detail text;
begin
  insert into public.leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings)
  values (p_id, p_owner, p_name, 2026, 'setup', 8, p_ref, '{}'::jsonb);
  return 'ACCEPT(1)';
exception when others then
  if sqlstate <> 'P0001' then return 'ERROR|' || sqlstate; end if;
  get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return coalesce(v_hint, '?') || '|' || coalesce(v_detail, '?');
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

-- ── A16–A21: the fix round's structural pins (R616, R620, R617/R621, R618) ──

select is(
  (select count(*)::int from pg_trigger t
    where not t.tgisinternal
      and t.tgname in ('trg_scoring_systems_rules_guard',
                       'trg_leagues_scoring_rules_valid',
                       'trg_leagues_scoring_reference_guard')
      and t.tgenabled = 'A'),
  3, 'A16 (R616): all three triggers are ENABLE **ALWAYS**, not the default ''O''. A trigger at ''O'' is skipped ENTIRELY under session_replication_role = ''replica'' — the mode pg_restore and logical apply run in, and one `postgres` can set. Measured before the fix: an invalid is_template row COMMITTED in replica mode and read back over anon PostgREST. This is the door a restore repopulates the guarded column through');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
        lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public'
      and p.proname in ('scoring_systems_rules_guard', 'leagues_scoring_rules_valid',
                        'leagues_scoring_reference_guard')
      and a.privilege_type = 'EXECUTE'
      and a.grantee <> 'postgres'::regrole::oid),
  0, 'A17 (R620): ZERO non-postgres grantees on all three wall functions — not merely "not PUBLIC, not anon". `authenticated` holds TEMP on the database, so EXECUTE on a SECURITY DEFINER function that reads past RLS is a one-bit ORACLE over `public.leagues`: CREATE TRIGGER it onto a temp table and read the landed-row count. Postgres checks EXECUTE at CREATE TRIGGER time, not at fire time, so the walls lose nothing');

select is(
  (select (select string_agg(a.attname, ',' order by a.attnum)
             from unnest(t.tgattr) c join pg_attribute a
               on a.attrelid = t.tgrelid and a.attnum = c)
     from pg_trigger t
    where t.tgrelid = 'public.leagues'::regclass
      and t.tgname = 'trg_leagues_scoring_rules_valid'),
  'scoring_rules_snapshot',
  'A18 (R617/R621): wall 2 fires on the column being ASSIGNED (`UPDATE OF scoring_rules_snapshot`), not on its value CHANGING. The difference was a breach: a pre-104 invalid snapshot is a copy of its system''s rules, so draft_start''s re-freeze writes the IDENTICAL value and an `IS DISTINCT FROM OLD` body test skipped it — the league entered `drafting` on an invalid document, silently. Putting the test in the trigger keeps D175(4) (an ordinary edit does not name the column) and makes the skip structural instead of an unpinned body branch');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'leagues_scoring_reference_guard'
      and p.prosecdef and p.proconfig = array['search_path=""']),
  1, 'A19 (R618): wall 3 exists, is SECURITY DEFINER (it resolves a reference in RLS-protected `scoring_systems`) and pins search_path empty');

select is(
  (select (select string_agg(a.attname, ',' order by a.attnum)
             from unnest(t.tgattr) c join pg_attribute a
               on a.attrelid = t.tgrelid and a.attnum = c)
     from pg_trigger t
    where t.tgrelid = 'public.leagues'::regclass
      and t.tgname = 'trg_leagues_scoring_reference_guard'),
  'scoring_system_id,deleted_at',
  'A20 (R618): …on BOTH columns. `scoring_system_id` covers the repoint, the reference-carrying INSERT and the re-attach; `deleted_at` covers the un-delete revive — a door that never touches scoring_system_id at all, and one this very file used to walk through in its own cleanup while asserting nothing about it');

select throws_ok(
  $$ select public.leagues_scoring_reference_guard() $$,
  '0A000', null,
  'A21: wall 3 is not callable outside a trigger context either — the same §4.1 discharge as A8/A9');

-- ── A22 (R635): THE BEFORE-ROW TRIGGER SET, BY NAME **AND BY BODY**. ────────
-- 104's own argument for putting the guard on the column is that "a guard on
-- the column needs no author to remember it". Measured, that is true only with
-- a proviso: Postgres fires BEFORE ROW triggers in **name order**, and 059's
-- `trg_leagues_snapshot_guard` already sorts AFTER `trg_leagues_scoring_rules_valid`.
-- A body edit to 059's function that assigned `NEW.scoring_rules_snapshot`
-- would overwrite the value AFTER wall 2 validated it; the invalid document
-- would COMMIT, the trigger CATALOG would be byte-identical, and all 53 pgTAP
-- files and 9 client cells would stay green. So the set is pinned by name in
-- fire order AND by the md5 of each trigger function's `prosrc` — a new
-- later-sorting trigger moves the first half, a body edit moves the second.
-- This is a GOLDEN pin: a legitimate future edit to any of these four bodies
-- is SUPPOSED to red it, and whoever makes that edit re-reads this cell and
-- re-derives the literal deliberately (the 073 lesson, mechanised).
select is(
  (select string_agg(t.tgrelid::regclass::text || '.' || t.tgname || '=' || md5(p.prosrc),
                     ' | ' order by t.tgrelid::regclass::text, t.tgname)
     from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal
      and (t.tgtype & 2) = 2 and (t.tgtype & 1) = 1
      and t.tgrelid in ('public.leagues'::regclass, 'public.scoring_systems'::regclass)),
  'leagues.trg_leagues_scoring_reference_guard=ad626c38ca8a2d70f9cc0a860adac47d | leagues.trg_leagues_scoring_rules_valid=8eefa42191daba5ae5d9db5e5ef0c67d | leagues.trg_leagues_snapshot_guard=769a68bcfb6bb599732f68c3c507c94d | scoring_systems.trg_scoring_systems_rules_guard=009f9c68b41f1ff6fb58dfcc3d7725b1',
  'A22 (R635): the BEFORE ROW trigger set on `leagues` and `scoring_systems`, in FIRE ORDER, each with the md5 of its function body. Triggers fire in NAME order, so a trigger that sorts after a wall and assigns the column the wall guards silently un-does it — with an identical catalog. Both halves of that are pinned here');

select is(
  (select (t.tgtype & 2) = 2 and (t.tgtype & 1) = 1
          and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16
     from pg_trigger t
    where t.tgrelid = 'public.leagues'::regclass
      and t.tgname = 'trg_leagues_scoring_reference_guard'),
  true,
  'A23 (R627): wall 3''s EVENT MASK — BEFORE, FOR EACH ROW, on INSERT **and** UPDATE, the same assertion A12/A13 make for walls 1 and 2. §A20 pins the COLUMN list and would not notice INSERT being dropped from the mask; with INSERT dropped there were ZERO killing cells across all 53 pgTAP files (swept), and door 2 — a `leagues` row born carrying a bad reference — reopens silently');

-- ===========================================================================
-- §B THE D175(4) CENSUS — taken BEFORE this file creates a single fixture row
-- ===========================================================================

select cmp_ok(
  (select count(*) from scoring_systems), '>=', 6::bigint,
  'B1 (non-vacuity, F94): scoring_systems is not empty — every claim below is about real rows');

select is(
  (select array_agg(name order by name) from scoring_systems
    where is_template
      and name in ('ESPN Standard', 'ESPN Full PPR', 'Yahoo Standard', 'Yahoo Half PPR',
                   'Sleeper Standard', 'Sleeper Full PPR')),
  array['ESPN Full PPR', 'ESPN Standard', 'Sleeper Full PPR', 'Sleeper Standard',
        'Yahoo Half PPR', 'Yahoo Standard'],
  'B2 (R624): 058''s six parity templates, pinned BY NAME rather than by a count of the whole table. The count form asserted the AMBIENT contents of whatever database the suite ran against — measured red at have:7/want:6 the moment a seventh template existed — and §B wraps outside nothing this file''s rollback restores');

-- B3 (R624). The old form compared the whole profile to the whole template set
-- — an identity that is true only while NO FORK ROW EXISTS ANYWHERE, which is
-- precisely the condition SE.5 is chartered to end: one legitimate,
-- wall-approved, SE.5-canonical fork row present and this cell went red at
-- have:7/want:6. It asserted the ambient database, not the wall. Two halves
-- replace it, and both are invariant.
select is(
  (select count(*)::int from scoring_systems s
    where s.is_template
      and not (s.is_template
               or s.rules ? 'format'
               or exists (select 1 from leagues l
                           where l.scoring_system_id = s.id and l.deleted_at is null))),
  0, 'B3a: PROFILE ⊇ TEMPLATES — every template row is inside the league profile, forever, whatever else the table holds. This is the containment D175(2) arm (a) asserts, and no future fork row can falsify it');

select is(
  (select array_agg(s.id order by s.id) from scoring_systems s
    where s.created_at <= (select max(created_at) from scoring_systems where is_template)
      and (s.is_template
           or s.rules ? 'format'
           or exists (select 1 from leagues l
                       where l.scoring_system_id = s.id and l.deleted_at is null))),
  (select array_agg(id order by id) from scoring_systems where is_template),
  'B3b (D175(4), scoped to the population the sentence is ABOUT): among rows that existed when 058 seeded the templates — the BUILD-TIME population — the profile is exactly the template rows. Rows created later (a fork, a research system) are outside the claim by construction, so this survives SE.5 instead of reding on the first row SE.5 exists to create');

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
  0, 'B4 (D175(4), retitled per R622 to what it actually measures): EVERY PROFILE DOCUMENT STILL PASSES THE VALIDATOR ON A FRESH INSERT THROUGH ARM (a). It is a live "the shipped documents are legal" check and it reds on a validator that would refuse one — what it is NOT is a pin on the identity short-circuit, which an INSERT can never reach (TG_OP <> ''UPDATE''); the rewrite that fixed the FIFTH vacuity MOVED that hole rather than closing it, and E5d closes it');
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

-- ── E5b: DOOR 3, WHICH THIS FILE USED TO WALK THROUGH IN ITS OWN CLEANUP AND
--    ASSERT NOTHING ABOUT (R618). The line that used to sit here was a bare
--    `update leagues set deleted_at = null`, executed while s4 still carried
--    the document §E5 had just legitimately accepted. Soft-delete, rewrite,
--    revive: three legal writes, and the league comes back live in front of an
--    invalid document without either of the first two walls firing — neither
--    guards `leagues`. WALL 3 does.
select is(
  pg_temp.w3('b0520000-0000-4000-8000-0000000000bb', null, true),
  'tier_exclusivity|(document)|UNCHANGED',
  'E5b (R618, door 3): the UN-DELETE is refused. It never touches `scoring_system_id`, so a reference guard watching only that column would miss it entirely — which is why wall 3 fires on `deleted_at` too. The league stays soft-deleted');

-- ── E5b2 (R627, door 2): WALL 3's **INSERT** ARM. §A20 pins the column list and
--    §A23 the event mask; this is the behaviour behind them. A `leagues` row
--    born already carrying a bad reference needs no UPDATE at all, and with
--    INSERT dropped from the mask it landed with ZERO killing cells in 53
--    files.
select is(
  pg_temp.w3ins('b0520000-0000-4000-8000-0000000000f9',
                '90520000-0000-4000-8000-000000000001', 'pgtap-se4b-born-bad-ref',
                '50520000-0000-4000-8000-000000000004'),
  'tier_exclusivity|(document)',
  'E5b2 (R627): a league BORN carrying a reference to an invalid document is refused. This is door 2 of F142''s inventory, and `create_league` is not in its path — the raw table takes an INSERT too');
select is(
  (select count(*)::int from leagues where id = 'b0520000-0000-4000-8000-0000000000f9'),
  0, 'E5b3: …and no row was left behind (BEFORE, not AFTER — the §A12 argument, at wall 3)');

-- ── E5b4 (R631): WALL 3 IN REPLICA MODE. Walls 1 and 2 each have a behavioural
--    replica cell; wall 3 had only the catalog flag. **Placed here, ABOVE the
--    §E5c forge**, and the placement is the finding: that forge does
--    `enable always` on wall 3, so a cell below it would measure a trigger
--    state this FILE set rather than the one the MIGRATION set — the exact
--    trap the note above §F9 documents, which this file has now walked into
--    once and must not again.
set local session_replication_role = 'replica';
select is(
  pg_temp.w3('b0520000-0000-4000-8000-0000000000bb', null, true),
  'tier_exclusivity|(document)|UNCHANGED',
  'E5b4 (R631): the un-delete is still refused in REPLICA MODE — `ENABLE ALWAYS` on wall 3, proved by consequence and not by catalog flag alone');
set local session_replication_role = 'origin';

-- ── E5b5 (R628): WALL 3's `deleted_at` EARLY RETURN — the last permissive
--    branch in the migration with a killing cell NOWHERE in 53 files. A write
--    that leaves the league SOFT-DELETED must land even when the referenced
--    document is invalid: a soft-deleted league references nothing live, and
--    refusing here would make an archived league un-archivable because of a
--    document nothing reads. Delete the early return and this throws.
select lives_ok(
  $$ update leagues set deleted_at = now()
      where id = 'b0520000-0000-4000-8000-0000000000bb' $$,
  'E5b5 (R628): a write that leaves the league soft-deleted LANDS, even though its referenced document is one the validator refuses — wall 3''s `deleted_at` early return, which had no killing cell anywhere');

-- ── E5c: THE FORGE. With wall 3 shipped there is no un-privileged path left to
--    the corrupt-while-attached state — that is the point of it — so the state
--    is forged by disabling wall 3 and nothing else. This is the
--    `DISABLE TRIGGER` forge tasks-SE §5 SE.4b(5) prescribed, used where it
--    belongs: to isolate ONE wall so the next two cells measure the OTHER
--    walls independently of it.
alter table leagues disable trigger trg_leagues_scoring_reference_guard;
update leagues set deleted_at = null where id = 'b0520000-0000-4000-8000-0000000000bb';
alter table leagues enable always trigger trg_leagues_scoring_reference_guard;

select is(
  (select pg_temp.docfails(s.rules)
          and exists (select 1 from leagues l
                       where l.scoring_system_id = s.id and l.deleted_at is null)
     from scoring_systems s where s.id = '50520000-0000-4000-8000-000000000004'),
  true,
  'E5c (premise for E5d/E5e/E5f): the forged state EXISTS — s4 is live-league-referenced (in the profile via arm (c)) AND its stored document is one the validator refuses. Asserted, not assumed: the four cells below are about that state, and over a state that never got built they would all be green for the wrong reason');

-- ── E5d: THE IDENTITY SHORT-CIRCUIT'S FIRST KILLING CELL (R622). The headline
--    design decision of this migration had ZERO cells anywhere: `w1ins` is an
--    INSERT (TG_OP <> 'UPDATE'), `w1flip` is the ENTRY arm (OLD outside the
--    profile), and `w1`/`w1msg` always assign `rules`. Deleting the whole
--    block left 052 at 63/63, `test:db` at 3503/PASS and vitest at 8 passed.
--    Here is a rules-untouched UPDATE on a row that IS in the profile carrying
--    a document the validator refuses: D175(4) says it must LAND, and it reds
--    the moment the short-circuit is removed.
select lives_ok(
  $$ update scoring_systems set description = 'E5d: a rules-untouched edit'
      where id = '50520000-0000-4000-8000-000000000004' $$,
  'E5d (R622): a NON-rules edit on an in-profile row whose stored document is invalid still LANDS — D175(4)''s never-retroactively-invalidate guarantee, which is what the identity short-circuit exists for. Delete the short-circuit and this cell throws');
select is(
  (select rules from scoring_systems where id = '50520000-0000-4000-8000-000000000004'),
  '{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb,
  'E5d2: …and the document is still the one it was — the wall validates, it never rewrites (and the edit did not quietly repair it)');

-- ── E5e: R615 — THE TWO-STEP `is_template` ESCAPE. §E6 below pins the ONE-step
--    flip, which the guard always refused. The two-step was live in the first
--    cut and was measured end to end over PostgREST: private invalid row →
--    put it in the profile via arm (c) (a `leagues` write, which fires nothing
--    on this table) → `PATCH {is_template: true, owner_id: null}` → HTTP 200,
--    world-readable template, attached by an ordinary commissioner through
--    `create_league`. 052 could not reach it because neither flip target was
--    league-referenced. This one is.
select is(
  pg_temp.w1flip('50520000-0000-4000-8000-000000000004'),
  'tier_exclusivity|(document)|UNCHANGED',
  'E5e (R615): promoting an IN-PROFILE row to a template is refused. `rules` is untouched and OLD was already in the profile, so the identity short-circuit would skip it — the `IS NOT DISTINCT FROM` conjunct on `is_template` is what stops it, and removing it reds exactly here. (R630: an earlier version of this sentence said "removing EITHER" conjunct reds this cell. Only `is_template` does — this write does not change `id`, so the `id` conjunct is not the one being exercised. The `id` conjunct is NOT inert and is not deleted: forge an invalid template and a fresh-id change is refused P0001 with it and succeeds without it, measured by three reviewers on arm (a). It simply has no cell of its own here.)');

-- ── E5f: R617 AT THE ACTUAL WRITER. `snapshot_league_scoring_internal` is what
--    `draft_start_internal` PERFORMs, and it copies the referenced document
--    into the guarded column verbatim.
select throws_ok(
  $$ select public.snapshot_league_scoring_internal('b0520000-0000-4000-8000-0000000000bb') $$,
  'P0001', null,
  'E5f (R617/D168(2)): the draft-start snapshot writer itself is refused on an invalid document — the §7.3.8 sentence proved at the function that would otherwise freeze it, not merely at a hand-written UPDATE');
select is(
  (select scoring_rules_snapshot from leagues where id = 'b0520000-0000-4000-8000-0000000000bb'),
  null,
  'E5f2: …and the snapshot is still NULL, so the league cannot reach `drafting` (059''s guard) — loudly, which is the whole shape of §7.3.8');

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

-- ── E8/E9 (R623): PROFILE ARM (b), `NEW.rules ? 'format'`, HAD ZERO KILLING
--    CELLS IN THIS FILE. The mutant matrix is unambiguous: arm (a) → FALSE reds
--    1 cell, arm (c) → FALSE reds 5, **arm (b) → FALSE reds 0** — because the
--    file's only format-2 row (s1) is ALSO league-referenced, so arm (c)
--    catches every §C and §G write, and §B4 goes through arm (a). Nothing
--    inserted or updated an UNREFERENCED, NON-TEMPLATE, format-2 row: the one
--    shape only arm (b) can see, and the one the banner calls the definitional
--    league document.
select is(
  pg_temp.w1ins('pgtap-se4b-armb-control', '90520000-0000-4000-8000-000000000002', false,
                pg_temp.env('{"pass_yards": 0.04}'::jsonb)),
  'ACCEPT(1)',
  'E8 (premise): an UNREFERENCED, NON-TEMPLATE, format-2 row is insertable at all — arms (a) and (c) are both dark for it, so whatever happens next is arm (b)''s doing');
select is(
  (select (not is_template) and (rules ? 'format')
          and not exists (select 1 from leagues l
                           where l.scoring_system_id = s.id and l.deleted_at is null)
     from scoring_systems s where s.name = 'pgtap-se4b-armb-control'),
  true,
  'E8b (premise): …and it really is that shape — not a template, carries `format`, referenced by no live league');
select is(
  pg_temp.w1ins('pgtap-se4b-armb', '90520000-0000-4000-8000-000000000002', false,
                pg_temp.env('{"def_points_allowed": 1}'::jsonb)),
  'scorable_allowlist|base.def_points_allowed',
  'E9 (R623): the same shape carrying an INVALID document is refused — by arm (b) and by nothing else. With arm (b) forced FALSE this row LANDS and reads back (measured), while 052 stayed 63/63 green');

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
  'F6: an UPDATE that does not NAME the snapshot column is not revalidated. The reason this branch exists is not performance (R621): it is D175(4) — under a future stricter validator, revalidating on every league edit would retroactively brick ordinary edits on rows that were legal when they were written. §F9 is the cell that can actually fail if the branch goes');
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

-- ── F12 (R616): THE REPLICA-MODE DOOR, PINNED BEHAVIOURALLY. `ENABLE ALWAYS`
--    is asserted structurally at §A16; a catalog flag on its own certifies the
--    keyword, not the consequence (the §A3/§E4c lesson, applied again).
set local session_replication_role = 'replica';
select is(
  pg_temp.w2('b0520000-0000-4000-8000-0000000000cc',
             '{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
  'tier_exclusivity|(document)|UNCHANGED',
  'F12 (R616): the same write in REPLICA MODE is still refused. At the default `tgenabled = ''O''` this write COMMITTED and was read back over anon PostgREST — the mode `pg_restore` and logical apply run in, on the very column a restore rewrites');
select is(
  pg_temp.w1('50520000-0000-4000-8000-000000000001',
             '{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
  'tier_exclusivity|(document)|UNCHANGED',
  'F12b (R616): …and so is wall 1''s');
set local session_replication_role = 'origin';

-- ── ORDERING NOTE, AND IT IS LOAD-BEARING (found by this round's own probe
--    round — the eighth decoration). The §F9 forge below restores wall 2 with
--    `ENABLE ALWAYS`, which means every cell AFTER it observes a trigger state
--    THIS FILE set rather than the one the MIGRATION set. §F12 was originally
--    written below the forge and could not fail: probe 13 (ENABLE ALWAYS →
--    plain ENABLE, i.e. the repo default) red §A16 and §F12b and left §F12
--    green, even though the same write in replica mode at `tgenabled = 'O'`
--    lands and persists (measured directly). The replica cells therefore run
--    BEFORE any ALTER TRIGGER in this file.
-- ── F9–F11 (R621/R617): THE WALL-2 FORGE AND ITS TWO KILLING CELLS.
--    Wall 2's change-detection had zero killing cells: replacing the body with
--    an unconditional revalidation left 052 at 63/63, `test:db` at
--    `Files=53, Tests=3503 PASS` and vitest at 8 passed, and a cell-by-cell TAP
--    diff showed 0 of 63 cells differing. The reason is that at §F6 the resting
--    snapshot is §F2's VALID document, so revalidating it is a no-op. A
--    forged INVALID resting snapshot is what makes the branch measurable — and
--    the only way to build one now is to disable the wall, because that is
--    what a wall is for.
alter table leagues disable trigger trg_leagues_scoring_rules_valid;
update leagues set scoring_rules_snapshot = '{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb
  where id = 'b0520000-0000-4000-8000-0000000000cc';
alter table leagues enable always trigger trg_leagues_scoring_rules_valid;

select is(
  (select pg_temp.docfails(scoring_rules_snapshot)
     from leagues where id = 'b0520000-0000-4000-8000-0000000000cc'),
  true,
  'F9 (premise): the league now RESTS on a snapshot the validator refuses — the pre-104 population D175(4) protects and R617 turned into a silent `drafting` breach');

select lives_ok(
  $$ update leagues set name = 'pgtap-se4b-snapshot-league-legacy'
      where id = 'b0520000-0000-4000-8000-0000000000cc' $$,
  'F10 (R621, THE KILLING CELL): an ordinary edit on a league resting on an INVALID snapshot still LANDS. That is D175(4), and it is the whole job of the `UPDATE OF scoring_rules_snapshot` clause — widen the trigger to all columns and this cell throws');

select is(
  pg_temp.w2('b0520000-0000-4000-8000-0000000000cc',
             '{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
  'tier_exclusivity|(document)|UNCHANGED',
  'F11 (R617, THE OTHER KILLING CELL): re-writing the snapshot with the IDENTICAL invalid value is REFUSED. Under the old `IS DISTINCT FROM OLD` body test this was skipped — and that is exactly what `draft_start` does, because a pre-104 snapshot is a copy of its system''s rules, so the re-freeze writes the same bytes. The league entered `drafting` on an invalid document, silently, with draft_start as the writer');

update leagues set scoring_rules_snapshot = null
  where id = 'b0520000-0000-4000-8000-0000000000cc';

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

-- ===========================================================================
-- §K WALL 3's ROW LOCK — the cross-table premise, held still (R626)
-- ===========================================================================
--
-- Walls 1 and 3 are each correct about the row IN FRONT of them. What neither
-- held still, before this lock, was the PREMISE it reads from the other's
-- table — wall 1 asks `public.leagues` "is this row referenced?", wall 3 asks
-- `public.scoring_systems` "is this document valid?". Under READ COMMITTED two
-- concurrent transactions each passed on a stale snapshot and committed a live
-- league in front of the F21 document. `FOR NO KEY UPDATE` in wall 3's
-- `SELECT` serialises both orderings.
--
-- **THIS IS A STRUCTURAL PIN AND THE REGISTER IS DELIBERATE.** A race needs two
-- transactions, and a pgTAP file is one. The three in-file instruments were
-- each tried and each measured USELESS here, which is why the honest cell is a
-- catalog one:
--   • `dblink` IS installable on this stack but cannot connect — `postgres` is
--     not superuser and the local `pg_hba` is trust, so it refuses with
--     *"Non-superusers may only connect using credentials they provide"*
--     (measured; a password in the string does not help, because trust auth
--     never consumes it).
--   • `xmax` on the referenced row does not discriminate: the FK's own
--     `FOR KEY SHARE` sets it on the same write, to the same xid.
--   • a same-transaction `NOWAIT` probe never conflicts with its own locks.
-- The BEHAVIOURAL proof — the race reproducing before the lock and serialising
-- after — is a two-session measurement recorded in the PR body and in
-- PROGRESS D272, where a measurement that cannot live in the suite belongs.
--
-- **The deadlock surface is real and is named rather than pinned:** this is a
-- two-direction lock pattern (wall 1 reads `leagues` while holding
-- `scoring_systems`; wall 3 the reverse), so a genuinely concurrent pair can
-- deadlock. A deadlock is a clean rollback with `40P01`, not corruption — the
-- outcome this seam is being traded UP to from a committed invalid state.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'leagues_scoring_reference_guard'
      and p.prosrc ~ 'SELECT\s+s\.rules\s+INTO\s+v_rules(.|\n)*FOR NO KEY UPDATE'),
  1, 'K1 (R626): wall 3 resolves the reference `FOR NO KEY UPDATE` — the lock is on the SELECT that reads the other table''s premise, not merely somewhere in the body. Two concurrent transactions committed a live league in front of the F21 document without it (reproduced by four reviewers in both orderings); with it, both orderings serialise');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'leagues_scoring_reference_guard'
      and p.prosrc ~ 'FOR (UPDATE|SHARE|KEY SHARE)(\s|;)'),
  0, 'K2: …and it is that lock and not a stronger or weaker one. `FOR UPDATE` would conflict with the FK''s own `FOR KEY SHARE` and serialise ordinary league writes behind scoring edits; `FOR KEY SHARE` would not conflict with the rules-UPDATE this seam races, and would be a lock that reads as protection while providing none');

select * from finish();
rollback;
