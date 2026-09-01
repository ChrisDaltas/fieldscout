-- ============================================================================
-- The FRONT DOORS — pgTAP 053 (migration 105, task SE.5; spec §12.25,
-- §7.3.3.1's entry-point + lifecycle bullets, §7.3 header, §7.3.8 v2.11;
-- PROGRESS D169/D170/D175, D273; ledger F147/F151/F155).
--
-- 052 proved the WALLS — that an invalid league scoring document cannot be
-- represented. This file proves the DOORS: that a valid one can be created and
-- edited, by exactly the people and in exactly the window §7.3.3.1 says, and
-- that the surface those doors open does not open anything else.
--
-- WHAT THIS FILE PINS, AND THE DEFECT EACH SECTION CATCHES (§4.3):
--
--   §A FORM. One function each (a COUNT, so a signature-changing CREATE OR
--      REPLACE that left an overload behind is visible), the §4.1 DEFINER
--      triad per function including the part that differs
--      (`scoring_detect_tier_cuts` is deliberately NOT DEFINER — it reads no
--      table), the REVOKE narrowing, and the GRANT that is LOAD-BEARING rather
--      than incidental: `authenticated` must keep EXECUTE on both RPCs or the
--      whole surface is unreachable. `update_league_settings` is pinned as ONE
--      function with its 14-argument signature intact, because D169's amendment
--      is a CREATE OR REPLACE and a changed arg list would silently fork an
--      overload that PostgREST would then choose between. 060's `create_league`
--      is pinned to STILL carry the template-only predicate (D170).
--
--   §B THE INHERITED FAMILY (§7.3.3.1(b)). `scoring_detect_tier_cuts` is
--      checked against ALL SEVEN shipped templates as a set equality — each maps
--      to exactly one family and the family it maps to REGENERATES that
--      template's own `def_pa_*` keys byte-exactly. That equivalence is the
--      whole backward-compatibility argument, so it is measured against the
--      shipped rows and not against a transcription. The two refusals it owes
--      are pinned with their reasons: an AMBIGUOUS document (naming only the
--      four key names both families share) and a STRAY `def_ya_*` key. Both
--      exist because guessing would silently re-cut a defense's tiers.
--
--   §C THE FORK. Auth, window, template predicate, the document's shape, the
--      same-transaction repoint, and idempotency. **The window is enumerated,
--      not sampled:** all four out-of-window statuses refuse AND both in-window
--      statuses succeed, because a gate pinned only on its refusals is a gate
--      whose skip nobody measured (D272(20) — the standing rule this lane
--      adopted after the same shape let a write through twice). §C4 is the DoD
--      break-probe target.
--
--   §D THE SAVE. The same auth/window, plus the three refusals that are
--      peculiar to it: a template-referenced league (fork first), a row that is
--      not the league's own fork, and — the one that is a design decision
--      rather than a guard — an UN-NORMALIZED document, refused rather than
--      normalized. §D8 is its control: the same document normalized is
--      accepted by the same call, so the refusal is provably about the normal
--      form and not about the keys.
--
--   §E §12.25's MEMBER SELECT POLICY. A member of the referencing league reads
--      the row; a non-member does not; and the two clauses that decide whether
--      the policy matches AT ALL each get a killing cell — repoint away
--      (`l.scoring_system_id = scoring_systems.id`) and soft-delete
--      (`l.deleted_at IS NULL`). That is the unreferenced-orphan property
--      §12.25 relies on for its "leave detached rows in place" ruling, so it is
--      measured rather than asserted. Then the **no-write pattern per role with
--      RETURNING counts** (§4.2): the new policy grants SELECT and NOTHING
--      else, so a member who is not the owner writes 0 rows on every verb, and
--      `anon` writes 0 rows on every verb and reads nothing.
--
--   §F THE 061 AMENDMENT (D169). The new arm ACCEPTS the league's own current
--      reference, three neighbouring rows still REFUSE, and a template still
--      accepts and detaches the fork. **§F6 is the attach-validation arm proved
--      INDEPENDENTLY of wall 3** — the state is forged privileged (wall 3
--      disabled and nothing else), the re-attach is refused with wall 3 still
--      down, and the trigger is restored with `ENABLE ALWAYS` and re-asserted
--      at `tgenabled = 'A'`, because a plain `ENABLE` would silently downgrade
--      migration 104's R616 posture and no other cell would notice.
--      §F8 is the arm's `lives_ok`: `p_scoring_system_id` NULL means keep the
--      current reference, the skip clause fires, and nothing is validated.
--
--   §G F147 + F151 — THE LOCK, AND THE CYCLE THAT DOES NOT EXIST. The lock's
--      own clause is pinned in 052 §K (K1 anchored to the statement, K2 the ban
--      list). What lives HERE is the premise that makes the choice safe and
--      that no cell anywhere pinned before: **wall 1 takes NO row lock**, so
--      there is only one direction and no cycle to deadlock — and **both new
--      RPCs take `leagues` FOR UPDATE strictly BEFORE they touch
--      `scoring_systems`**, the order `update_league_settings` already used.
--      Add a `FOR` clause to wall 1, or move either RPC's league lock after its
--      scoring write, and a deadlock becomes constructible; both go red here.
--      The BEHAVIOURAL half — the two-session race, and the repeated
--      both-orderings deadlock sweep — is a multi-session measurement that a
--      single-session pgTAP file cannot host; it is in the SE.5 PR and in
--      PROGRESS D273, the 066/084/098 idiom this lane uses for exactly that.
--
-- Conventions: fixtures created in the `postgres` role BEFORE any JWT claims
-- (D49(7)); every section asserts its own premise before asserting anything
-- about it (F94); accepts report their ROW COUNT so a write that matched
-- nothing can never read as a pass (CLAUDE.md); the whole file rolls back.
--
-- ⚠ **READING A MUTANT RUN OF THIS FILE: TAKE THE TOTAL, NOT THE NOT-OK COUNT.**
-- Several cells resolve a fixture by NAME through a scalar subquery
-- (`(select id from scoring_systems where name = 'pgtap-se5-setup Custom')`),
-- and that is deliberate — §C11/§C13 are only meaningful while that name
-- identifies exactly one row. The consequence is that a mutant which makes the
-- fork mint DUPLICATES aborts the file with `more than one row returned by a
-- subquery` partway through. Measured on two probes: deleting the fork's
-- commissioner check reports `ok=41 not_ok=7`, and deleting its idempotency
-- clause reports `ok=40 not_ok=3` — against a control of `ok=71 not_ok=0`. The
-- red cells that DO appear are real and they are the cells that detect the
-- mutation; the truncation is a second-order consequence of the same defect.
-- **A reader who checks only `not ok` will read a truncated run as a milder
-- result than it is** — and a reader who checks only `ok` on a run that ends
-- early will read it as a PASS. Compare `ok + not_ok` against `plan()`.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
select plan(71);

-- ---------------------------------------------------------------------------
-- Helpers. Each performs a REAL call and collapses it into one comparable
-- string, so a refusal's identity and an accept's row count are both in the
-- verdict rather than in a trailing assertion that a no-op write would satisfy.
--
--   OK|<uuid>            — the RPC returned an id
--   <sqlstate>|<hint>    — it raised, and which guardrail family said so
--   <sqlstate>|MSG:<...> — it raised without a HINT (an RPC-level refusal)
--   …|raised_in:<layer>   — WHICH layer raised it
--
-- ── WHY EVERY HELPER REPORTS THE RAISER (the SE.5 review's §6 shape) ────────
-- **In a defence-in-depth design where every layer raises the same error
-- family, an assertion on the OUTCOME cannot localize.** That convergence is a
-- FEATURE — one user-facing error however you arrive at it, which is why TS↔SQL
-- guardrail parity is pinned byte-for-byte — and it is exactly what makes this
-- surface untestable by outcome. The review found six cells whose observable
-- alphabet was coarser than the distinction the cell's own text claimed to
-- make: three `scoring_update_rules` refusals collapsed to one string because
-- `left(sqlerrm, 44)` ends 22 characters before they diverge; the front door's
-- `PERFORM scoring_rules_validate` and wall 1 behind it emit the same SQLSTATE,
-- HINT **and MESSAGE**, because they call the same validator.
--
-- The instrument already existed — `pg_temp.attach` read `pg_exception_context`
-- — and was applied to one helper of three. It is now shared by all of them.
-- Two moves, and both are needed: **report the raiser**, and **strip the league
-- uuid before truncating** so the 36 characters that are identical in every
-- message stop consuming the budget.
-- ---------------------------------------------------------------------------

/** The INNERMOST named frame of an exception context, as a short token.
 *  `scoring_rules_validate` is deliberately skipped: it is the shared validator
 *  every layer calls, so it is the one frame that can never discriminate. */
create function pg_temp.raiser(p_ctx text) returns text language plpgsql as $$
declare ln text;
begin
  foreach ln in array string_to_array(coalesce(p_ctx, ''), E'\n') loop
    if ln ~ 'scoring_rules_validate|scoring_tier_keys_from_cuts' then continue; end if;
    if ln ~ 'scoring_fork_template'            then return 'scoring_fork_template';   end if;
    if ln ~ 'scoring_update_rules'             then return 'scoring_update_rules';    end if;
    if ln ~ 'update_league_settings'           then return 'update_league_settings';  end if;
    if ln ~ 'scoring_detect_tier_cuts'         then return 'scoring_detect_tier_cuts';end if;
    if ln ~ 'scoring_systems_rules_guard'      then return 'wall1';                   end if;
    if ln ~ 'leagues_scoring_rules_valid'      then return 'wall2';                   end if;
    if ln ~ 'leagues_scoring_reference_guard'  then return 'wall3';                   end if;
  end loop;
  return 'other';
end;
$$;

/** MESSAGE, with EVERY uuid stripped and then truncated. All three moves are
 *  load-bearing: every `scoring_update_rules` refusal opens with
 *  `scoring_update_rules: league <36-char uuid>`, so an un-stripped 44-char
 *  window ends before any distinguishing word — the three refusals were one
 *  byte-identical string and two guards had no mutation coverage at all.
 *  **`p_league` is not the only uuid a message carries (widened 2026-08-26,
 *  R-item 8).** §D6's refusal names the SCORING SYSTEM as well, and with only
 *  `p_league` stripped the 60-char window ended ONE CHARACTER into a fixture
 *  uuid: discriminating against today's fixtures and brittle to renumbering
 *  them, which is a pin that would move for a reason that is not a code change.
 *  Every remaining uuid therefore becomes `<S>`, and the window is 72 so that
 *  no expectation in this file terminates inside a placeholder. */
create function pg_temp.msg(p_err text, p_league uuid) returns text
language sql immutable as $$
  select 'MSG:' || left(
    regexp_replace(replace(p_err, p_league::text, '<L>'),
                   '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
                   '<S>', 'g'), 72);
$$;

create function pg_temp.fork(p_league uuid, p_template uuid) returns text
language plpgsql as $$
declare v_id uuid; v_hint text; v_ctx text;
begin
  v_id := public.scoring_fork_template(p_league, p_template);
  return 'OK|' || v_id::text;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_ctx = pg_exception_context;
  return sqlstate || '|' || coalesce(nullif(v_hint, ''), pg_temp.msg(sqlerrm, p_league))
      || '|raised_in:' || pg_temp.raiser(v_ctx);
end;
$$;

create function pg_temp.save(p_league uuid, p_doc jsonb) returns text
language plpgsql as $$
declare v_id uuid; v_hint text; v_ctx text;
begin
  v_id := public.scoring_update_rules(p_league, p_doc);
  return 'OK|' || v_id::text;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_ctx = pg_exception_context;
  return sqlstate || '|' || coalesce(nullif(v_hint, ''), pg_temp.msg(sqlerrm, p_league))
      || '|raised_in:' || pg_temp.raiser(v_ctx);
end;
$$;

/** `update_league_settings` with every non-scoring argument read back from the
 *  league itself, so the call changes exactly ONE thing — which is what makes
 *  its verdict about the attach arm rather than about some other backstop. */
create function pg_temp.attach(p_league uuid, p_scoring uuid) returns text
language plpgsql as $$
declare l record; v_hint text; v_ctx text; v_after uuid;
begin
  select * into l from public.leagues where id = p_league;
  begin
    perform public.update_league_settings(
      p_league, l.team_count, l.settings, l.roster_settings, p_scoring,
      l.format, l.regular_season_weeks, l.playoff_teams, l.playoff_start_week,
      l.waiver_type, l.faab_budget, l.trade_review, l.trade_deadline_week, l.lineup_lock);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_ctx = pg_exception_context;
    return sqlstate || '|' || coalesce(nullif(v_hint, ''), pg_temp.msg(sqlerrm, p_league))
        || '|raised_in:' || pg_temp.raiser(v_ctx);
  end;
  select scoring_system_id into v_after from public.leagues where id = p_league;
  return 'OK|ref=' || coalesce(v_after::text, 'NULL');
end;
$$;

/** `scoring_detect_tier_cuts`, forced into a VARIABLE.
 *  The first cut of §B called it inside `select count(*) from (select f(x)) q`
 *  and every cell reported "1 rows" — the planner elides an unreferenced
 *  subquery output column, so the function was never called and three refusal
 *  pins were VACUOUS. Assigning the result makes the call unremovable. */
/**  …and its verdict carries a MESSAGE FRAGMENT, not just the HINT (R646).
 *   All three refusal arms of `scoring_detect_tier_cuts` share one HINT, so the
 *   HINT alone cannot separate them — and B5's arm was measured satisfiable by
 *   a DIFFERENT arm: delete the no-PA-keys guard and `'{}' <@ anything` is TRUE
 *   for BOTH published families, so the ambiguity arm raises with the identical
 *   hint. `raised_in:` is no help here — all three arms live in one function —
 *   so this is the same widening applied on the message axis. */
create function pg_temp.detect(p_doc jsonb) returns text language plpgsql as $$
declare v jsonb; v_hint text;
begin
  v := public.scoring_detect_tier_cuts(p_doc);
  return 'OK|' || v::text;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || '|' || coalesce(nullif(v_hint, ''), '?')
      || '|' || case when sqlerrm ~ 'no def_pa_\* keys'      then 'ARM:no_pa_keys'
                     when sqlerrm ~ 'match [0-9]+ published' then 'ARM:ambiguous'
                     when sqlerrm ~ 'yards-allowed cut list' then 'ARM:stray_ya'
                     else 'ARM:?' end;
end;
$$;

/** The SAVE's window verdict, discriminating on WHICH guard refused.
 *  §D2's first form compared only the SQLSTATE, and the probe that deletes the
 *  window check red NOTHING: the leagues it uses reference no scoring system,
 *  so the very next guard raises P0001 too and the cell could not tell the two
 *  apart. A refusal pin that any refusal satisfies is a decoration. */
create function pg_temp.savewindow(p_league uuid) returns text language plpgsql as $$
declare v_status text;
begin
  select status into v_status from public.leagues where id = p_league;
  perform public.scoring_update_rules(p_league, '{}'::jsonb);
  return v_status || '=ACCEPTED';
exception when others then
  return v_status || '=' || sqlstate
      || case when sqlerrm like '%is in ' || v_status || ' —%' then '|window' else '|other:' || left(sqlerrm, 30) end;
end;
$$;

/** Does this role's write land? Reports the ROW COUNT the write returned
 *  (§4.2's no-write pattern), so "refused by RLS" and "matched nothing" are the
 *  same measurable number and neither can hide behind the other. */
create function pg_temp.wrote(p_sql text) returns text language plpgsql as $$
declare v_n int;
begin
  execute p_sql into v_n;
  return v_n::text || ' rows';
exception when others then
  return 'ERROR|' || sqlstate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (postgres role, BEFORE any JWT claims — D49(7))
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('90530000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-se5-u' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       ('{"username": "se5_user_' || i || '"}')::jsonb, now(), now()
from generate_series(1, 5) i;

-- u1 commissioner · u2 co-commissioner · u3 plain manager · u4 outsider ·
-- u5 commissioner of a DIFFERENT league (whose fork must stay unattachable here)

-- The two window statuses get a league each; the four out-of-window statuses
-- get one each, so §C4/§C5 can enumerate the gate instead of sampling it.
insert into leagues (id, owner_id, name, season, status, team_count, settings, scoring_rules_snapshot)
select ('b0530000-0000-4000-8000-0000000000' || v.sfx)::uuid,
       '90530000-0000-4000-8000-000000000001', v.nm, 2026, v.st, 8, '{}'::jsonb,
       -- 059's trg_leagues_snapshot_guard demands a non-NULL snapshot in
       -- drafting+, and 104's wall 2 demands it be VALID: a real template doc.
       case when v.st in ('setup','scheduled') then null
            else (select rules from scoring_systems where name = 'ESPN Full PPR') end
from (values ('a1','pgtap-se5-setup','setup'),
             ('a2','pgtap-se5-scheduled','scheduled'),
             ('a3','pgtap-se5-drafting','drafting'),
             ('a4','pgtap-se5-inseason','in_season'),
             ('a5','pgtap-se5-playoffs','playoffs'),
             ('a6','pgtap-se5-complete','complete'),
             ('a7','pgtap-se5-deleted','setup'),
             ('a8','pgtap-se5-other','setup')) v(sfx, nm, st);

update leagues set deleted_at = now() where id = 'b0530000-0000-4000-8000-0000000000a7';

insert into league_members (league_id, user_id, role)
select l.id, m.uid::uuid, m.role
from leagues l
cross join (values ('90530000-0000-4000-8000-000000000001','commissioner'),
                   ('90530000-0000-4000-8000-000000000002','co_commissioner'),
                   ('90530000-0000-4000-8000-000000000003','manager')) m(uid, role)
where l.name like 'pgtap-se5-%' and l.name <> 'pgtap-se5-other';

insert into league_members (league_id, user_id, role) values
  ('b0530000-0000-4000-8000-0000000000a8', '90530000-0000-4000-8000-000000000005', 'commissioner');

-- A personal research row owned by the OUTSIDER: the "any other non-template
-- row" §F2 proves still refuses.
insert into scoring_systems (id, name, owner_id, is_template, rules) values
  ('50530000-0000-4000-8000-000000000001', 'pgtap-se5-personal',
   '90530000-0000-4000-8000-000000000004', false,
   '{"pass_yards": 0.04, "receptions": 1}'::jsonb);

-- Template ids, by NAME rather than by literal uuid (058 seeds them; a uuid
-- literal here would be a second source of truth for which row is which).
create temporary table t_ids as
select name, id from scoring_systems where is_template;
-- Readable from the JWT roles below: the sections that call the RPCs run as
-- `authenticated`/`anon`, and a temp table created by `postgres` is otherwise
-- invisible to them.
grant select on t_ids to public;

-- ===========================================================================
-- §A FORM (§4.1: the DEFINER triad, per function, including where it differs)
-- ===========================================================================
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('scoring_fork_template','scoring_update_rules','scoring_detect_tier_cuts')),
  3, 'A1: exactly three new functions, one each — a COUNT, because a CREATE OR REPLACE that changed a signature would leave the old overload behind and PostgREST would then have two candidates to choose between');

select is(
  (select string_agg(p.proname || '=' || p.prosecdef::text, ' | ' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('scoring_fork_template','scoring_update_rules','scoring_detect_tier_cuts')),
  'scoring_detect_tier_cuts=false | scoring_fork_template=true | scoring_update_rules=true',
  'A2: the two RPCs are SECURITY DEFINER and the detection helper deliberately is NOT. It reads no table and has no subject to authorize, so DEFINER would be a borrowed privilege with nothing to spend it on — §4.1 asks for the posture to be a decision, and the difference is the evidence that it was one');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('scoring_fork_template','scoring_update_rules','scoring_detect_tier_cuts')
      and p.proconfig = ARRAY['search_path=""']),
  3, 'A3 (§4.1): all three pin search_path to the empty string. A DEFINER function without it is a privilege-escalation surface, and the helper gets it too because it is called FROM the DEFINER pair');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('scoring_fork_template','scoring_update_rules','scoring_detect_tier_cuts')
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('public', p.oid, 'EXECUTE'))),
  0, 'A4 (§4.1/D18-D23): neither anon nor PUBLIC holds EXECUTE on any of the three — the explicit REVOKE narrowing, no per-object GRANT');

select is(
  (select string_agg(p.proname || '=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text, ' | ' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('scoring_fork_template','scoring_update_rules')),
  'scoring_fork_template=true | scoring_update_rules=true',
  'A5: …and `authenticated` DOES keep EXECUTE through 037''s default ACLs. This is the LOAD-BEARING half of the REVOKE and it is pinned in its own cell: narrow it by one more role and the entire editor surface becomes unreachable, with the in-body commissioner checks — not the grant — as the effective gate (D23)');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_league_settings'),
  1, 'A6 (D137/D169): `update_league_settings` is still exactly ONE function after the CREATE OR REPLACE. A changed argument list would not replace — it would OVERLOAD, leaving 061''s template-only body live beside the amended one and PostgREST resolving between them by argument names');

select is(
  (select pg_get_function_identity_arguments(p.oid)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_league_settings'),
  'p_league_id uuid, p_team_count integer, p_settings jsonb, p_roster_settings jsonb, p_scoring_system_id uuid, p_format text, p_regular_season_weeks integer, p_playoff_teams integer, p_playoff_start_week integer, p_waiver_type text, p_faab_budget integer, p_trade_review text, p_trade_deadline_week integer, p_lineup_lock text',
  'A7: …and its 14-argument signature is byte-identical to 061''s, argument names included — the service maps every TYPED_COLUMN_KEY to p_<key> mechanically, so a renamed argument is a silent PostgREST 404 rather than a type error');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_league'
      and regexp_replace(p.prosrc, '--[^\n]*', '', 'g')
          ~ 'is_template\s*=\s*TRUE'),
  1, 'A8 (D170): `create_league` still carries the template-only predicate. SE.5 widens the ATTACH path and deliberately not the BIRTH path — a league is always born on a template, and the fork needs a league row to exist before it can own one. **MATCHED OVER `prosrc` WITH LINE COMMENTS STRIPPED (2026-08-26, R661/F159) — this cell was the FIFTH occurrence of the class and it was in the file its own PR swept.** Measured before the strip: delete `AND s.is_template = TRUE` from `create_league` with no comment and 053 reds here (71 / 1), correctly; delete it and leave `-- (the template arm: s.is_template = TRUE, kept ownerless by 058)` and the **whole file is green (71 / 0) with the template predicate gone** — D170''s birth-path boundary, unpinned, in the exact shape of §K1. With the strip the decoy reds (71 / 1). F159 originally scoped its inventory to the cells *outside* 052–053 and that sentence is struck: **a sweep that exempts its own file is not a sweep**');

select is(
  (select polcmd::text from pg_policy
    where polrelid = 'public.scoring_systems'::regclass
      and polname = 'League members read league scoring'),
  'r', 'A9 (§12.25): the new policy exists and is FOR SELECT. Found and copied from the spec BY POLICY NAME — the breakdown''s original "copy verbatim from spec:1429-1434" now resolves to a `team_managers` policy, which is plausible, syntactically valid, and about a different table');

select ok(
  (select polwithcheck is null from pg_policy
    where polrelid = 'public.scoring_systems'::regclass
      and polname = 'League members read league scoring'),
  'A10: …and it carries no WITH CHECK, because a SELECT policy that grew one would be the first hint that someone had widened it into a write path. §E pins the consequence behaviourally; this pins the shape');

select is(
  (select string_agg(polname || '=' || polcmd::text, ' | ' order by polname)
     from pg_policy where polrelid = 'public.scoring_systems'::regclass),
  'League members read league scoring=r | System defaults are viewable by everyone=r | Templates viewable by everyone=r | Users can manage own scoring systems=* | Users can view own scoring systems=r',
  'A11: the WHOLE policy set on scoring_systems, by name and command. 001''s owner `FOR ALL` is still there — it is the §12.25 bypass D175''s wall exists to stand behind, and a PR that "fixed" it by dropping the policy would break the research world silently; 058''s template read is still there; and exactly one policy was added');

select ok(
  (select count(*) > 0 from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname = 'idx_leagues_scoring_system'),
  'A12: `idx_leagues_scoring_system` (104 §1) is present — the index §12.25''s policy scans on every read of a scoring row, asserted here because the policy that needs it lands in a different migration than the index does');

-- ===========================================================================
-- §B THE INHERITED FAMILY — §7.3.3.1(b)'s byte-exact regeneration
-- ===========================================================================
select is(
  (select count(*)::int from t_ids), 8,
  'B1 (premise, F94): eight shipped templates (058''s six + the Scout pair, 106/108) — the population §B2/§B3 quantify over. A set that had silently shrunk would make the next two cells vacuously true');

select is(
  (select string_agg(t.name || '=' || (public.scoring_detect_tier_cuts(s.rules) -> 'def_pa')::text, ' | ' order by t.name)
     from t_ids t join scoring_systems s on s.id = t.id),
  'ESPN Full PPR=[0, 1, 7, 14, 18, 28, 35, 46] | ESPN Standard=[0, 1, 7, 14, 18, 28, 35, 46] | Scout PPR=[0, 1, 7, 14, 18, 28, 35, 46] | Scout Standard=[0, 1, 7, 14, 18, 28, 35, 46] | Sleeper Full PPR=[0, 1, 7, 14, 21, 28, 35] | Sleeper Standard=[0, 1, 7, 14, 21, 28, 35] | Yahoo Half PPR=[0, 1, 7, 14, 21, 28, 35] | Yahoo Standard=[0, 1, 7, 14, 21, 28, 35]',
  'B2 (§7.3.3.1(b), D44): every shipped template resolves to exactly one points-allowed family, and to the RIGHT one — the two ESPN rows AND the Scout pair (B.5''s split markup ruling SC.1; one body one value apart, B.5.1/SC.4 — Scout PPR name-sorts between ESPN Standard and Scout Standard) to the 8-cut ESPN list, the four single-model rows to the 7-cut shared list. Detected from the KEY SET; matching on the word "ESPN" in the name would make the fork depend on a display string a commissioner can rename');

-- MATERIALIZED is load-bearing here, not style: with the predicate written
-- against `scoring_systems` directly, the planner pushed
-- `scoring_detect_tier_cuts` BELOW the template filter and ran it over EVERY
-- row in the table — including §C7's personal research fixture, which has no
-- def_pa_* keys and therefore RAISES. A probe evaluated over rows the test
-- never chose is not the probe the test describes. The fence makes the
-- population this cell quantifies over the population it actually reads.
select is(
  (with tpl as materialized (select s.id, s.rules from scoring_systems s where s.is_template)
   select count(*)::int from tpl
    where not (
      (select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(tpl.rules) k where k like 'def\_pa\_%')
      <@ public.scoring_tier_keys_from_cuts('def_pa', public.scoring_detect_tier_cuts(tpl.rules) -> 'def_pa'))),
  0, 'B3: …and the family it resolves to REGENERATES that template''s own def_pa_* keys — every one of them, for all seven. **This is the whole backward-compatibility argument** (§7.3.3.1(a): "a doc carrying tier_cuts scores the same whether the engine derives from cuts or from derive-stats.ts''s literals"), measured against the shipped rows rather than against a transcription of them');

select is(
  pg_temp.detect('{"def_pa_0": 1, "def_pa_1_6": 1, "def_pa_7_13": 1, "def_pa_28_34": 1}'::jsonb),
  'P0001|tier_cuts_undetectable|ARM:ambiguous',
  'B4: a document naming ONLY the four key names the two PA families SHARE is a member of both, and it RAISES rather than being assigned one. Guessing would silently re-cut a defense''s tiers — the F21 defect wearing a different hat, and invisible afterwards because the resulting document is perfectly valid');

select is(
  pg_temp.detect('{"pass_yards": 0.04}'::jsonb),
  'P0001|tier_cuts_undetectable|ARM:no_pa_keys',
  'B5: a document with NO def_pa_* keys has no detectable cut list, and the fork refuses rather than defaulting to a family');

select is(
  pg_temp.detect('{"def_pa_0": 1, "def_pa_14_17": 1, "def_ya_0_150": 2}'::jsonb),
  'P0001|tier_cuts_undetectable|ARM:stray_ya',
  'B6: a def_ya_* key the published yards-allowed cut list does not generate refuses too — writing the published list over it would RE-CUT that table. Adding or re-cutting a YA table is F59''s follow-up, explicitly not this fork (§7.3.3.1(b))');

-- ===========================================================================
-- §C THE FORK RPC (§7.3.3.1's entry point; D170)
-- ===========================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"90530000-0000-4000-8000-000000000004","role":"authenticated"}';

select is(pg_temp.fork('b0530000-0000-4000-8000-0000000000a1', (select id from t_ids where name = 'ESPN Full PPR')),
  '42501|MSG:scoring_fork_template: not a commissioner of this league|raised_in:scoring_fork_template',
  'C1 (§4.1 in-body authorization): an outsider is refused 42501 — the RPC is SECURITY DEFINER, so RLS protects nothing here and the in-body check is the ONLY gate');

select is(pg_temp.fork('b0530000-0000-4000-8000-00000000dead', (select id from t_ids where name = 'ESPN Full PPR')),
  '42501|MSG:scoring_fork_template: not a commissioner of this league|raised_in:scoring_fork_template',
  'C2: a NONEXISTENT league yields the same 42501 and the same message — 061''s no-existence-leak rule. A distinct "not found" here would let any signed-in user enumerate league ids');

set local "request.jwt.claims" = '{"sub":"90530000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(pg_temp.fork('b0530000-0000-4000-8000-0000000000a1', (select id from t_ids where name = 'ESPN Full PPR')),
  '42501|MSG:scoring_fork_template: not a commissioner of this league|raised_in:scoring_fork_template',
  'C3: a plain MANAGER of the league is refused too. §7.3.3.1''s access bullet: the commissioner edits, members view — and membership is not the predicate');

-- ── C4: THE WINDOW, ENUMERATED. The DoD break-probe target. ────────────────
set local "request.jwt.claims" = '{"sub":"90530000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select string_agg(l.status || '=' || left(pg_temp.fork(l.id, (select id from t_ids where name = 'ESPN Full PPR')), 5), ' | ' order by l.status)
     from leagues l where l.name in ('pgtap-se5-drafting','pgtap-se5-inseason','pgtap-se5-playoffs','pgtap-se5-complete')),
  'complete=P0001 | drafting=P0001 | in_season=P0001 | playoffs=P0001',
  'C4 (§7.3 header + §7.3.3.1''s lifecycle bullet): ALL FOUR out-of-window statuses refuse, enumerated rather than sampled. Once the draft starts the document is frozen verbatim in scoring_rules_snapshot and scoring changes are the existing commissioner-override law, which this surface does not expose. **This is the DoD break probe''s target: delete the status check and these four cells go red at exactly this count**');

select is(left(pg_temp.fork('b0530000-0000-4000-8000-0000000000a2', (select id from t_ids where name = 'Yahoo Standard')), 2),
  'OK',
  'C5 (the gate''s OTHER disjunct — a `lives_ok`, D272(20)): `scheduled` SUCCEEDS. A window pinned only by its refusals is a window whose skip nobody measured, and this lane has now twice found the bug on the permissive branch. §C8 covers `setup`');

select is(left(pg_temp.fork('b0530000-0000-4000-8000-0000000000a7', (select id from t_ids where name = 'ESPN Full PPR')), 5),
  'P0002',
  'C6: a SOFT-DELETED league refuses — and WHICH guard refuses it was measured rather than predicted. `is_league_commish` does NOT filter deleted_at, so the commissioner still passes step 1; it is step 2''s `WHERE deleted_at IS NULL ... FOR UPDATE` that finds nothing and raises P0002. The distinction matters because it means the deleted-league defense lives in the lock, not in the auth check — move the lock and this protection moves with it');

select is(pg_temp.fork('b0530000-0000-4000-8000-0000000000a1', '50530000-0000-4000-8000-000000000001'),
  'P0001|MSG:scoring_fork_template: p_template_id must reference one of the scoring t|raised_in:scoring_fork_template',
  'C7 (§7.3.3.1 + D33): a personal research row cannot be a fork''s STARTING POINT. "A fork always starts from a template"; pre-existing personal systems live in the legacy namespace and stay unattachable');

-- ── C8: the document the fork actually writes ──────────────────────────────
select is(left(pg_temp.fork('b0530000-0000-4000-8000-0000000000a1', (select id from t_ids where name = 'ESPN Full PPR')), 2),
  'OK', 'C8: `setup` succeeds — the window''s first disjunct, and the fixture the rest of §C reads');

select is(
  (select jsonb_build_object(
            'format', s.rules -> 'format',
            'positions', s.rules -> 'positions',
            'tier_cuts', s.rules -> 'tier_cuts',
            'base_is_template_verbatim', (s.rules -> 'base') = (select rules from t_ids t join scoring_systems x on x.id = t.id where t.name = 'ESPN Full PPR'))::text
     from leagues l join scoring_systems s on s.id = l.scoring_system_id
    where l.id = 'b0530000-0000-4000-8000-0000000000a1'),
  '{"format": 2, "positions": {}, "tier_cuts": {"def_pa": [0, 1, 7, 14, 18, 28, 35, 46], "def_ya": [0, 100, 200, 300, 350, 400, 450, 500, 550]}, "base_is_template_verbatim": true}',
  'C9 (§7.3.3.1''s printed shape): the fork document — format 2, `base` the template''s flat map VERBATIM, `positions` EMPTY, `tier_cuts` the inherited family. `base` verbatim + no overrides is exactly why a fresh fork scores identically to its template for every position (the fork-equivalence property), and `positions: {}` is why: an override is the only thing that could change an outcome');

select is(
  (select s.is_template::text || '|' || (s.owner_id = '90530000-0000-4000-8000-000000000001')::text || '|' || s.name
     from leagues l join scoring_systems s on s.id = l.scoring_system_id
    where l.id = 'b0530000-0000-4000-8000-0000000000a1'),
  'false|true|pgtap-se5-setup Custom',
  'C10 (§12.25 + D59): the fork row is NOT a template, is owned by the CALLING commissioner, and is named "<League> Custom". `is_template` is written FALSE as a literal — the RPC has no parameter that could set it — so the fork can never mint a world-readable, league-attachable template');

select is(
  (select count(*)::int from scoring_systems where name = 'pgtap-se5-setup Custom'),
  1, 'C11: …and exactly ONE row was created. A fork that inserted twice would still leave the league correctly referenced, so the reference alone cannot see it');

-- ── C12/C13: idempotency (plan §2.3) ───────────────────────────────────────
select is(
  (select pg_temp.fork('b0530000-0000-4000-8000-0000000000a1', (select id from t_ids where name = 'ESPN Full PPR'))
        = 'OK|' || (select scoring_system_id::text from leagues where id = 'b0530000-0000-4000-8000-0000000000a1'))::text,
  'true',
  'C12 (plan §2.3): a retried fork returns THE SAME id. §12.25 forbids a new column, so there is no action_id to dedupe on and the natural key is the STATE — the league already references a commissioner-owned non-template row whose rules deep-equal the document this call would build');

select is(
  (select count(*)::int from scoring_systems where name = 'pgtap-se5-setup Custom'),
  1, 'C13: …and it inserted NOTHING. This is the cell that makes C12 mean something: returning the right id while quietly minting a second row would satisfy C12 and leave an orphan behind on every retry');

set local "request.jwt.claims" = '{"sub":"90530000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select pg_temp.fork('b0530000-0000-4000-8000-0000000000a1', (select id from t_ids where name = 'ESPN Full PPR'))
        = 'OK|' || (select scoring_system_id::text from leagues where id = 'b0530000-0000-4000-8000-0000000000a1'))::text,
  'true',
  'C14: a CO-COMMISSIONER''s retry is idempotent too, and this is why the idempotency predicate is "owned by a commissioner of this league" and not "owner_id = auth.uid()". Under the narrower reading this call would miss the test and mint a duplicate — a retry-safety hole opened by the tighter-looking predicate');

-- ── C15 (R639): THE SAVE'S CO-COMMISSIONER ARM — the `lives_ok` §C14 has and
-- §D did not. `scoring_update_rules` step 5 uses the same "owned by a
-- commissioner of this league" predicate the fork's idempotency clause uses,
-- and PROGRESS D273(4) says the two RPCs AGREE on it — but only the fork half
-- was pinned. Narrowing the SAVE's predicate alone to `= auth.uid()` red
-- NOTHING while the capability demonstrably regressed: a co-commissioner could
-- no longer save the league's own fork, and the refusal told them the row "is
-- not this league's own forked custom row", which is false and unactionable.
-- Still running as u2 from §C14, and league …a1 still references its own fork.
select is(
  left(pg_temp.save('b0530000-0000-4000-8000-0000000000a1',
    (select s.rules from leagues l join scoring_systems s on s.id = l.scoring_system_id
      where l.id = 'b0530000-0000-4000-8000-0000000000a1')), 2),
  'OK',
  'C15 (R639 — the standing rule at PROGRESS §(20) applied to the arm that was missing it): a CO-COMMISSIONER can SAVE the league''s own fork, not only fork it idempotently. The predicate is shared between the two RPCs deliberately, so that they cannot disagree about what "the league''s own fork row" is — and a shared predicate needs a `lives_ok` on BOTH sides, because a narrowing applied to one is invisible to the other''s cell');

-- ===========================================================================
-- §D THE SAVE RPC (§12.25 "every rules edit goes through SECURITY DEFINER RPCs")
-- ===========================================================================
set local "request.jwt.claims" = '{"sub":"90530000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(pg_temp.save('b0530000-0000-4000-8000-0000000000a1', '{}'::jsonb),
  '42501|MSG:scoring_update_rules: not a commissioner of this league|raised_in:scoring_update_rules',
  'D1: a plain manager cannot save — same in-body gate, same SQLSTATE');

set local "request.jwt.claims" = '{"sub":"90530000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select string_agg(pg_temp.savewindow(l.id), ' | ' order by l.status)
     from leagues l where l.name in ('pgtap-se5-drafting','pgtap-se5-inseason','pgtap-se5-playoffs','pgtap-se5-complete')),
  'complete=P0001|window | drafting=P0001|window | in_season=P0001|window | playoffs=P0001|window',
  'D2: the save carries the SAME §7.3 window as the fork, enumerated the same way — a surface with two doors and one lock is a surface with no lock. **The verdict names WHICH guard refused, and that is the whole cell (measured, not styled):** its first form compared only the SQLSTATE, and the probe that deletes the window check red NOTHING, because these leagues reference no scoring system and the very next guard raises P0001 too. Now the refusal must name the league''s own status, so only the window can produce it');

select is(
  left(pg_temp.save('b0530000-0000-4000-8000-0000000000a2',
    (select s.rules from leagues l join scoring_systems s on s.id = l.scoring_system_id
      where l.id = 'b0530000-0000-4000-8000-0000000000a2')), 2),
  'OK',
  'D3 (D2''s CONTROL, and the save window''s `lives_ok`): the same call on a `scheduled` league — forked in §C5 — SUCCEEDS. Without it D2''s four refusals would be equally consistent with a save that refuses everything, which is the failure mode a suite built only from refusals cannot see (D272(20))');

-- pgtap-se5-other is on no scoring system at all.
set local "request.jwt.claims" = '{"sub":"90530000-0000-4000-8000-000000000005","role":"authenticated"}';
select is(pg_temp.save('b0530000-0000-4000-8000-0000000000a8', '{}'::jsonb),
  'P0001|MSG:scoring_update_rules: league <L> references no scoring system — fork a t|raised_in:scoring_update_rules',
  'D4: a league referencing NO scoring system is told to fork first, not handed a NULL dereference');

-- Put the "other" league on a plain template so D5 can refuse it.
set local role postgres;
update leagues set scoring_system_id = (select id from t_ids where name = 'Yahoo Standard')
 where id = 'b0530000-0000-4000-8000-0000000000a8';
set local role authenticated;
select is(pg_temp.save('b0530000-0000-4000-8000-0000000000a8',
    (select rules from t_ids t join scoring_systems s on s.id = t.id where t.name = 'Yahoo Standard')),
  'P0001|MSG:scoring_update_rules: league <L> is on a shared template — fork first, t|raised_in:scoring_update_rules',
  'D5 (§7.3.3.1 + D59): a league sitting on a shared TEMPLATE cannot be edited in place — "templates themselves are never edited". Without this the first commissioner to save would rewrite the scoring of every other league on that template');

set local role postgres;
-- A row owned by the OUTSIDER, put in front of u5's league by a privileged
-- write, is not that league's own fork — the state §D6 refuses.
update leagues set scoring_system_id = '50530000-0000-4000-8000-000000000001'
 where id = 'b0530000-0000-4000-8000-0000000000a8';
set local role authenticated;
select is(pg_temp.save('b0530000-0000-4000-8000-0000000000a8', '{"pass_yards": 0.05}'::jsonb),
  'P0001|MSG:scoring_update_rules: league <L> references scoring system <S>, which is|raised_in:scoring_update_rules',
  'D6: a referenced row that is NOT owned by a commissioner of this league is refused. The commissioner may not edit someone else''s scoring document just because a privileged write pointed their league at it');

-- ── D7/D8: un-normalized refused, and its control ──────────────────────────
set local "request.jwt.claims" = '{"sub":"90530000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  pg_temp.save('b0530000-0000-4000-8000-0000000000a1',
    (select jsonb_set(s.rules, '{positions,QB}',
       jsonb_build_object('pass_tds', s.rules -> 'base' -> 'pass_tds'))
       from leagues l join scoring_systems s on s.id = l.scoring_system_id
      where l.id = 'b0530000-0000-4000-8000-0000000000a1')),
  'P0001|normal_form|raised_in:scoring_update_rules',
  'D7 (§7.3.3.1 guardrail 4; the SE.5(2) decision): an override EQUAL to the base value is refused, not silently stripped. Normalization is the client''s save-time duty and the All-Positions switch state is DERIVED from the document — a server that quietly rewrote what it was sent would change what the editor shows on the next load, with no error and no diff. CLAUDE.md''s "nothing happened" class, refused loudly instead. **`raised_in:` is what makes this cell about the FRONT DOOR** (R641): delete the RPC''s own `PERFORM scoring_rules_validate` and wall 1 refuses the identical document with the same SQLSTATE, the same HINT *and the same MESSAGE* — because both call the same validator — so the verdict changes only in the raiser');

select is(
  left(pg_temp.save('b0530000-0000-4000-8000-0000000000a1',
    (select jsonb_set(s.rules, '{positions,QB}', '{"pass_tds": 6}')
       from leagues l join scoring_systems s on s.id = l.scoring_system_id
      where l.id = 'b0530000-0000-4000-8000-0000000000a1')), 2),
  'OK',
  'D8 (D7''s CONTROL): the same override with a DIFFERENT value — a real per-position customization — is accepted by the same call on the same row. So D7''s refusal is provably about the NORMAL FORM and not about `positions.QB` being unwelcome');

select is(
  (select (s.rules -> 'positions')::text from leagues l join scoring_systems s on s.id = l.scoring_system_id
    where l.id = 'b0530000-0000-4000-8000-0000000000a1'),
  '{"QB": {"pass_tds": 6}}',
  'D9: …and the accepted document actually LANDED, byte-for-byte as sent. The RPC returns an id, so a save that validated and then wrote nothing would look identical to a save that worked');

select is(
  pg_temp.save('b0530000-0000-4000-8000-0000000000a1',
    (select jsonb_set(s.rules, '{base,def_pa_14_20}', '2')
       from leagues l join scoring_systems s on s.id = l.scoring_system_id
      where l.id = 'b0530000-0000-4000-8000-0000000000a1')),
  'P0001|tier_exclusivity|raised_in:scoring_update_rules',
  'D10 (F21, at the front door): the save refuses a def_pa key the document''s own cut list does not generate, and the HINT is the guardrail FAMILY — so the route can turn it into a field-level error rather than a toast. The error contract is 103''s, propagated unwrapped through the RPC exactly as it is through the walls — and, per §D7, the raiser is what distinguishes the front door from the wall standing behind it emitting the byte-identical error');

-- ===========================================================================
-- §E §12.25's MEMBER SELECT POLICY
-- ===========================================================================
-- Premise (F94): the fork row is referenced by a LIVE league whose members are
-- u1/u2/u3 — otherwise every cell below is vacuous.
select is(
  (select count(*)::int from leagues l
    where l.id = 'b0530000-0000-4000-8000-0000000000a1' and l.deleted_at is null
      and l.scoring_system_id = (select id from scoring_systems where name = 'pgtap-se5-setup Custom')),
  1, 'E1 (premise, F94): the fork row is referenced by a live league — the population §12.25''s policy quantifies over');

set local "request.jwt.claims" = '{"sub":"90530000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::int from scoring_systems where name = 'pgtap-se5-setup Custom'),
  1, 'E2 (§12.25): a plain MEMBER — not the owner, not a commissioner — can READ the league''s custom scoring row. Members must see their league''s rules pre-draft; post-draft they read the frozen snapshot');

set local "request.jwt.claims" = '{"sub":"90530000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(
  (select count(*)::int from scoring_systems where name = 'pgtap-se5-setup Custom'),
  0, 'E3: a NON-MEMBER cannot — **and the mechanism is NOT the one an earlier draft of this cell claimed** (R640). This cell passes even with §12.25''s identity clause deleted, because the policy''s own subquery reads `leagues` and `league_members`, both of which are RLS-protected, and `league_members`'' `is_league_member(league_id)` is itself an `auth.uid()` test that empties the join for an outsider. So what E3 measures is "an outsider reads 0" — an answer THREE independent tables'' policies can produce. §E3b is the cell that isolates this one');

-- ── E3b (R640): THE IDENTITY CLAUSE'S KILLING CELL. ────────────────────────
-- §12.25's policy has three clauses. Two were already pinned — `deleted_at IS
-- NULL` by §E5 and `scoring_system_id = …id` by §E4/§E5 — and the third, the
-- one that decides **who** may read, had none: deleting
-- `lm.user_id = (SELECT auth.uid())` left all 69 cells green.
--
-- It is masked, and by the OTHER tables rather than by this one. Measured: the
-- dominant masker is `league_members`'' `is_league_member(league_id)`; widening
-- `leagues` alone still yields 0 under the mutant. And the obvious fixture —
-- "give the outsider membership in a DIFFERENT live league" — is measured
-- NON-KILLING, because `l.scoring_system_id = scoring_systems.id` pins `l` to
-- the target league; 053 already carries that fixture (u5, commissioner of live
-- league …a8) and it reads 0 under the mutant too. Writing it would have added
-- a cell that passes for an unrelated reason: the exact vacuity class this lane
-- has spent three rounds removing.
--
-- So the fixture DEFEATS the other two tables' policies and leaves this one as
-- the only thing standing. That is also the stronger invariant to own: **this
-- policy denies a non-member even if `leagues` and `league_members` were
-- world-readable** — which is what a future public-league browse surface would
-- make true.
set local role postgres;
create policy tmp_open_l  on leagues        for select using (true);
create policy tmp_open_lm on league_members for select using (true);
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"90530000-0000-4000-8000-000000000004","role":"authenticated"}';

select is(
  (select count(*)::int from scoring_systems where name = 'pgtap-se5-setup Custom'),
  0, 'E3b (R640): with `leagues` AND `league_members` temporarily world-readable, the outsider STILL reads 0 — so the denial is §12.25''s own `lm.user_id = (SELECT auth.uid())` and not a borrowed one. Shipped 0 / mutant 1, measured. This is the only cell in the file that reds when that clause is deleted');

set local role postgres;
drop policy tmp_open_l  on leagues;
drop policy tmp_open_lm on league_members;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"90530000-0000-4000-8000-000000000004","role":"authenticated"}';

-- ── E4/E5: the two clauses that decide whether the policy matches AT ALL ────
set local role postgres;
update leagues set scoring_system_id = (select id from t_ids where name = 'Yahoo Standard')
 where id = 'b0530000-0000-4000-8000-0000000000a1';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"90530000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::int from scoring_systems where name = 'pgtap-se5-setup Custom'),
  0, 'E4 (THE UNREFERENCED-ORPHAN PROPERTY — a killing cell for `l.scoring_system_id = scoring_systems.id`): the league repoints away and the SAME member''s SELECT stops matching. §12.25 leans on exactly this to justify leaving detached rows in place: "the member SELECT policy stops matching the moment it is unreferenced, so the only cost is clutter in the owner''s personal-systems list"');

set local role postgres;
update leagues set scoring_system_id = (select id from scoring_systems where name = 'pgtap-se5-setup Custom')
 where id = 'b0530000-0000-4000-8000-0000000000a1';
update leagues set deleted_at = now() where id = 'b0530000-0000-4000-8000-0000000000a1';
set local role authenticated;
select is(
  (select count(*)::int from scoring_systems where name = 'pgtap-se5-setup Custom'),
  0, 'E5 (a killing cell for `l.deleted_at IS NULL`): re-attached but the league SOFT-DELETED, and the member''s SELECT stops matching again. Delete that one clause and this cell alone catches it — it is the same predicate wall 1''s arm (c) and wall 3 use, so "in the league profile" and "readable by a member" stay the same population by construction');

set local role postgres;
update leagues set deleted_at = null where id = 'b0530000-0000-4000-8000-0000000000a1';
set local role authenticated;
select is(
  (select count(*)::int from scoring_systems where name = 'pgtap-se5-setup Custom'),
  1, 'E6 (E4/E5''s shared control): revived and re-attached, the member reads it again. Without this, E4 and E5 would pass equally well against a policy that never matched anything');

select is(
  (select count(*)::int from scoring_systems where is_template),
  8, 'E7 (058 + 106 + 108, untouched): templates stay world-readable to this same non-owner member. The additive policy adds a population; it does not narrow one');

-- ── E8–E12: the no-write sweep, per role, with RETURNING counts (§4.2) ─────
select is(
  pg_temp.wrote($$with u as (update public.scoring_systems set rules = '{"pass_yards": 9}'::jsonb
                              where name = 'pgtap-se5-setup Custom' returning 1) select count(*)::int from u$$),
  '0 rows',
  'E8 (§4.2 no-write pattern): the MEMBER who can now READ the row writes 0 rows on UPDATE. The new policy grants SELECT and nothing else — 001''s owner FOR ALL is still the only write route and it is scoped to the owner');

select is(
  pg_temp.wrote($$with d as (delete from public.scoring_systems
                              where name = 'pgtap-se5-setup Custom' returning 1) select count(*)::int from d$$),
  '0 rows',
  'E9: …and 0 rows on DELETE. A read policy that leaked a delete would destroy the league''s scoring document, and the FK would not stop it — `leagues.scoring_system_id` has no ON DELETE clause, so the delete would simply be refused by the FK for the WRONG reason. 0 rows here is the right one');

set local role anon;
set local "request.jwt.claims" = '';
select is(
  (select count(*)::int from scoring_systems where name = 'pgtap-se5-setup Custom'),
  0, 'E10: `anon` reads nothing. **Stated as what it measures rather than as a mechanism it does not isolate** (R640): `anon` is denied by every policy in the stack at once — this one''s `(SELECT auth.uid())` is NULL, and so is `is_league_member`''s inside the subquery''s own RLS, and `anon` holds no table grant besides. The cell is worth keeping as a role-sweep entry; it is §E3b, not this, that isolates §12.25''s identity clause');

select is(
  pg_temp.wrote($$with u as (update public.scoring_systems set rules = '{"pass_yards": 9}'::jsonb
                              where name = 'pgtap-se5-setup Custom' returning 1) select count(*)::int from u$$),
  '0 rows', 'E11: `anon` writes 0 rows on UPDATE');

select is(
  pg_temp.wrote($$with d as (delete from public.scoring_systems
                              where name = 'pgtap-se5-setup Custom' returning 1) select count(*)::int from d$$),
  '0 rows', 'E12: `anon` writes 0 rows on DELETE — the three-verb sweep, each measured as a COUNT rather than as an absence of error');

-- RESET first: `anon` is not a member of `authenticated`, so SET ROLE straight
-- across raises 42501 — and a permission error inside pg_temp.wrote() would have
-- read as "the write was refused", which is the answer this cell is looking for.
-- A probe that passes for the wrong reason is the failure mode §E13 is about.
set local role postgres;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"90530000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  pg_temp.wrote($$with u as (update public.scoring_systems set is_template = true, owner_id = null
                              where name = 'pgtap-se5-setup Custom' returning 1) select count(*)::int from u$$),
  'ERROR|42501',
  'E13 (D59''s ownerless CHECK, still standing): even the OWNER cannot promote their fork into a template — and the SHAPE of the refusal was measured, not predicted. 058''s scoring_systems_template_ownerless forces owner_id = NULL alongside, and 001:623''s `USING (auth.uid() = owner_id)` is re-used as that policy''s WITH CHECK, so the row MATCHES on the way in and fails on the way out: RLS raises **42501** rather than quietly affecting 0 rows. That is the louder outcome and the better one — the write that would have minted a world-readable, league-attachable template carrying the commissioner''s own document fails in the caller''s face. It also fires BEFORE 058''s CHECK constraint would have (23514), which is why the SQLSTATE here is a policy''s and not a constraint''s');

-- ===========================================================================
-- §F THE 061 ATTACH AMENDMENT (D169)
-- ===========================================================================
select is(
  pg_temp.attach('b0530000-0000-4000-8000-0000000000a1',
                 (select id from scoring_systems where name = 'pgtap-se5-setup Custom')),
  'OK|ref=' || (select id::text from scoring_systems where name = 'pgtap-se5-setup Custom'),
  'F1 (D169''s NEW ARM — a `lives_ok`): re-attaching the league''s OWN currently-referenced custom row is ACCEPTED. Before this amendment 061 refused every non-template row, so a settings PATCH that merely re-sent the current reference would have failed once a league was customized — §7.3.8 v2.11: "a template OR the league''s own §7.3.3.1 forked custom row"');

select is(
  pg_temp.attach('b0530000-0000-4000-8000-0000000000a1', '50530000-0000-4000-8000-000000000001'),
  'P0001|MSG:update_league_settings: scoring_system_id must reference one of the scor|raised_in:update_league_settings',
  'F2: a PERSONAL research system still refuses — "nothing else" is the other half of §7.3.8''s sentence, and D33''s one-namespace rule is what it protects');

select is(
  pg_temp.attach('b0530000-0000-4000-8000-0000000000a1',
       (select id from scoring_systems where name = 'pgtap-se5-scheduled Custom')),
  'P0001|MSG:update_league_settings: scoring_system_id must reference one of the scor|raised_in:update_league_settings',
  'F3: ANOTHER LEAGUE''S FORK refuses too — and it is the cell that proves F1''s arm is an IDENTITY test on this league''s current reference rather than a blanket "any non-template row owned by a commissioner"');

select is(
  pg_temp.attach('b0530000-0000-4000-8000-0000000000a1', (select id from t_ids where name = 'Sleeper Standard')),
  'OK|ref=' || (select id::text from t_ids where name = 'Sleeper Standard'),
  'F4 (§12.25 orphan hygiene): re-picking a plain TEMPLATE is accepted and the repoint IS the detach. The fork row is left in place deliberately — scoring_systems has no deleted_at and a fork-created row is indistinguishable from a personal one, so deleting it would risk user data');

select is(
  (select count(*)::int from scoring_systems where name = 'pgtap-se5-setup Custom'),
  1, 'F5: …and the detached fork row still EXISTS. "Left in place" is a §12.25 ruling, not an accident, and a future cleanup that started hard-deleting orphans would red here');

-- ── F6: the attach-validation arm, proved INDEPENDENTLY of wall 3 ──────────
-- The mechanism, stated by what it IS: with wall 3 disabled, write the corrupt
-- document to the row while it is UNREFERENCED (legal — it is a D33 research
-- row at that moment and wall 1's profile does not reach it), then attach it.
-- Wall 3 stays down through the assertion, so ONLY the attach arm can refuse.
set local role postgres;
insert into scoring_systems (id, name, owner_id, is_template, rules) values
  ('50530000-0000-4000-8000-000000000009', 'pgtap-se5-forged',
   '90530000-0000-4000-8000-000000000001', false,
   '{"pass_yards": 0.04, "def_pa_14_20": 2, "def_pa_18_27": 3}'::jsonb);

select is(
  (select count(*)::int from leagues where scoring_system_id = '50530000-0000-4000-8000-000000000009'),
  0, 'F6a (premise, F94): the forged row is UNREFERENCED, which is why wall 1 let the F21 double-pay document be written to it at all — a research row is valid under its own D33 namespace');

alter table public.leagues disable trigger trg_leagues_scoring_reference_guard;
update leagues set scoring_system_id = '50530000-0000-4000-8000-000000000009'
 where id = 'b0530000-0000-4000-8000-0000000000a1';
set local role authenticated;

select is(
  pg_temp.attach('b0530000-0000-4000-8000-0000000000a1', '50530000-0000-4000-8000-000000000009'),
  'P0001|tier_exclusivity|raised_in:update_league_settings',
  'F6 (D169''s VALIDATION ARM, spec §7.3.3.1(5) "the server write path — editor save + settings attach — MUST reject an invalid doc"): the re-attach is refused, with the guardrail family in the HINT and — the half that makes this independent rather than incidental — **the exception raised inside `update_league_settings` itself, with WALL 3 STILL DISABLED**. Step 6''s re-freeze never fires on a same-row re-attach (`v_new_scoring IS DISTINCT FROM v_current_scoring` is FALSE), so without this arm there would be no check in this function at all on the one path D169''s other arm newly admits');

set local role postgres;
alter table public.leagues enable always trigger trg_leagues_scoring_reference_guard;
select is(
  (select tgenabled::text from pg_trigger
    where tgrelid = 'public.leagues'::regclass and tgname = 'trg_leagues_scoring_reference_guard'),
  'A', 'F7: the forge is restored with ENABLE **ALWAYS**, not a plain ENABLE. At the default `tgenabled = ''O''` the trigger is skipped wholesale under session_replication_role = ''replica'' — the mode a restore runs in — so a plain ENABLE here would silently downgrade migration 104''s R616 posture, leave 052 §A16 green in its own file, and be invisible everywhere else');

update leagues set scoring_system_id = (select id from scoring_systems where name = 'pgtap-se5-setup Custom')
 where id = 'b0530000-0000-4000-8000-0000000000a1';
delete from scoring_systems where id = '50530000-0000-4000-8000-000000000009';
set local role authenticated;

select is(
  pg_temp.attach('b0530000-0000-4000-8000-0000000000a1', null),
  'OK|ref=' || (select id::text from scoring_systems where name = 'pgtap-se5-setup Custom'),
  'F8 (the arm''s `lives_ok` — D272(20)): `p_scoring_system_id` NULL means KEEP THE CURRENT REFERENCE, so the whole attach block is skipped and the settings write lands untouched. Every other cell in §F is a refusal, and a validation arm that had grown a NOT NULL assumption would be invisible to all of them');

-- ===========================================================================
-- §G F147 + F151 — THE LOCK, AND THE CYCLE THAT DOES NOT EXIST
-- ===========================================================================
--
-- 052 §K pins wall 3's own lock clause. What is pinned HERE is the structural
-- premise that makes the F147 choice safe and that nothing pinned before:
-- among PL/pgSQL lock sites there is ONE direction.
--
-- **"IN THIS SYSTEM" WAS TOO STRONG AND IS CORRECTED IN PLACE (R644).**
-- `leagues_scoring_system_id_fkey` is `ON DELETE NO ACTION`, so a DELETE of a
-- referenced `scoring_systems` row locks the scoring row first and then takes
-- `FOR KEY SHARE` on the referencing `leagues` row — the reverse direction,
-- run by RI machinery that lives in no `prosrc`, which is the only place these
-- two cells look. **SE.5 is what makes it reachable**, because §2 is the first
-- thing in the chain to put an owner-DELETABLE row in front of a live league.
-- It is deliberately not defended against (the DELETE fails 23503 anyway; see
-- 105 §5), and it is deliberately not pinned here: a catalog cell over
-- `prosrc` structurally cannot see it, and writing one that appeared to would
-- be worse than the sentence it replaced.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'scoring_systems_rules_guard'
      and regexp_replace(p.prosrc, '--[^\n]*', '', 'g')
          ~ 'FOR\s+(NO\s+KEY\s+)?(UPDATE|SHARE|KEY\s+SHARE)'),
  0, 'G1 (F148/F151 — THE PREMISE THE PL/pgSQL HALF OF THE DEADLOCK ARGUMENT RESTS ON; see this section''s banner for the FK-induced direction it does NOT cover, R644): **wall 1 takes NO row lock at all.** Its arm (c) is a bare EXISTS with no FOR clause, so the second direction of a lock cycle does not exist and wall 3''s lock — whatever its strength — cannot deadlock against it. F148 was filed because 104 once claimed a "two-direction lock pattern" that had never existed. Add a FOR clause to wall 1 and this cell goes red: it is the single edit that would turn F147''s choice from a performance question into a correctness one. **MATCHED OVER `prosrc` WITH LINE COMMENTS STRIPPED (2026-08-26, F159).** This cell is a BAN (expected 0), so over raw body text it is false-POSITIVE-prone in 052 §K2''s exact shape — measured, ONE comment line added to wall 1 reading `-- Lock note: this guard takes no FOR UPDATE and no FOR SHARE anywhere.` reds it against a 71/0 control, with wall 1 unchanged and correct. The strip is LOSSLESS on what the cell is actually for: add a real `PERFORM 1 FROM public.leagues l WHERE l.scoring_system_id = NEW.id FOR UPDATE;` to wall 1 and it reds with the strip in place exactly as it did without it');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral (select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') as src) c
    where n.nspname = 'public'
      and p.proname in ('scoring_fork_template','scoring_update_rules','update_league_settings')
      and position('FROM public.leagues' in c.src) > 0
      and position('FOR UPDATE' in c.src) > 0
      and position('FOR UPDATE' in c.src) < position('public.scoring_systems' in c.src)),
  3, 'G2 (F151 — LOCK ORDER, PINNED STRUCTURALLY): all three league-writing RPCs take the `leagues` row FOR UPDATE **before** they touch `public.scoring_systems`. One global order, leagues then scoring_systems, is what makes the multi-statement write pattern SE.5 introduces deadlock-free — F151 was filed precisely because `scoring_update_rules` is the leg that made the reverse order assemblable for the first time. Move either RPC''s league lock after its scoring write and this count drops. The BEHAVIOURAL half — both orderings, repeated, zero 40P01 — is a multi-session measurement a one-session pgTAP file cannot host; it is in the SE.5 PR and PROGRESS D273 (the 066/084/098 idiom). **MATCHED OVER `prosrc` WITH LINE COMMENTS STRIPPED (2026-08-26, F159), and this is the cell that made the sweep worth running:** three raw `position()` probes over body text that INCLUDES comments are false-NEGATIVE-prone in 052 §K1''s exact shape. Measured — delete `scoring_update_rules`'' real `FOR UPDATE` and leave behind two comment lines naming `FROM public.leagues`, `FOR UPDATE` and `public.scoring_systems` in that order, and this cell reported **3 and stayed GREEN** (71 total, 0 not-ok) with the league lock GONE. With the strip it reports 2 and reds. Stripping costs nothing: the unmutated control is 71/0 either way, which is also a measurement that all three RPCs establish their lock ORDER in code rather than in prose');

select is(
  (select string_agg(tgname || '=' || tgenabled::text, ' | ' order by tgname) from pg_trigger
    where tgname in ('trg_leagues_scoring_reference_guard', 'trg_leagues_scoring_rules_valid',
                     'trg_scoring_systems_rules_guard')),
  'trg_leagues_scoring_reference_guard=A | trg_leagues_scoring_rules_valid=A | trg_scoring_systems_rules_guard=A',
  'G3 (R616, re-asserted after §F6''s forge and at the END of the file): SE.4b''s THREE wall triggers are all still ENABLE ALWAYS. Scoped to those three by name and not to "every trigger on both tables", because F144 records that every OTHER non-internal trigger in `public` sits at the default ''O'' — the broader form would have asserted something this PR neither owns nor fixes, and would have read as a finding about SE.5. 052 §A16 asserts this in its own transaction; this file DISABLES one of them mid-run, so it owes its own closing check — a forge that restored the wrong enablement would otherwise be invisible until the next migration');

-- ── G4/G5: SE.5(3)'s REACHABILITY RE-DERIVATION, made falsifiable ──────────
-- Every "not reachable today" in 104, D272 and F142/F151 rested on one fact:
-- `leagues` is SELECT-only to clients AND both attach RPCs restricted
-- p_scoring_system_id to `is_template = TRUE AND owner_id IS NULL`, so no
-- application role could put a USER-WRITABLE row in front of a league.
-- **§F1's arm removes exactly that restriction**, so the argument expires and
-- is re-derived here instead of inherited: the row is user-writable, and it is
-- STILL not corruptible, because a fork is a format-2 envelope and therefore in
-- wall 1's profile by arm (b) whether or not anyone is looking at arm (c).
set local role postgres;
update leagues set scoring_system_id = (select id from scoring_systems where name = 'pgtap-se5-setup Custom')
 where id = 'b0530000-0000-4000-8000-0000000000a1';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"90530000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select (s.rules ? 'format')::text || '|' ||
          exists(select 1 from leagues l where l.scoring_system_id = s.id and l.deleted_at is null)::text
     from scoring_systems s where s.name = 'pgtap-se5-setup Custom'),
  'true|true',
  'G4 (premise, F94): the row `scoring_fork_template` created is in wall 1''s league profile by TWO arms at once — it carries a `format` member (arm b) AND it is referenced by a live league (arm c). Two arms matter: arm (c) alone would lapse the moment the league detached, and arm (b) alone would lapse if a future fork wrote a flat document. The fork is covered by either');

select is(
  pg_temp.wrote($$with u as (update public.scoring_systems
                                set rules = jsonb_set(rules, '{base,def_pa_14_20}', '2')
                              where name = 'pgtap-se5-setup Custom' returning 1) select count(*)::int from u$$),
  'ERROR|P0001',
  'G5 (SE.5(3) — THE CONFINEMENT ARGUMENT, RE-DERIVED RATHER THAN INHERITED): the commissioner writes to their OWN fork row through 001:623''s `FOR ALL` — no RPC anywhere in the path, and this is the route SE.5 newly makes reachable against a LEAGUE-REFERENCED row — and the write is REFUSED at the table. So the surface this task opens is "a user-writable row in front of a league" and NOT "a corruptible one". Delete either profile arm and §G4 still passes while this cell is what goes red');

select * from finish();
rollback;
