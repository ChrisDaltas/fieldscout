-- ============================================================================
-- The §7.3.3.1 guardrail validator, SQL side — pgTAP 051 (migration 103, task
-- SE.4; spec §7.3.3.1's F21-guardrails bullet + §7.3.3.1(a)/(c); D168/D175;
-- PROGRESS D270).
--
-- WHAT THIS FILE PINS, AND THE DEFECT EACH SECTION CATCHES (§4.3):
--
--   §A FORM. One function each — a COUNT, because a later `CREATE OR REPLACE`
--      that changed a parameter type would leave two and every named call
--      would start failing "function is not unique". Neither is SECURITY
--      DEFINER (they read no table and carry no in-body auth, so a promotion
--      to DEFINER would create a confused deputy with no subject to check —
--      it reds HERE), both pin `search_path=''`, both are IMMUTABLE, and the
--      REVOKEs are load-bearing: anon holds no EXECUTE, `authenticated` and
--      `service_role` still do through 037's default ACLs — which is what
--      SE.4b's triggers need, since a trigger runs as the writing role.
--
--   §B THE GENERATOR (SE.4(2)). `scoring_tier_keys_from_cuts` regenerates the
--      three published families BYTE-EXACTLY, against stored literals — the
--      SE.1 pin at the second layer, and §7.3.3.1(a)'s whole
--      backward-compatibility argument. Cross-checked against the keys the
--      SEEDED ESPN Standard row actually references, so the pin cannot drift
--      into agreeing with a wrong constant. Then the naming rule at shapes the
--      three families do not contain (interior single-value tier, negative
--      first cut, a two-cut list, an integer written `7.0` — `${7}` is "7" in
--      JS but `7.0::text` is "7.0", and `def_pa_7.0_13` would be a key nothing
--      ever looks at again), and the three §7.3.3.1(c) preconditions raising
--      22023 instead of generating a plausible name.
--
--   §C THE ACCEPTANCE FLOOR, READ FROM THE TABLE. All seven seeded template
--      `rules` ACCEPT — SELECTed from `scoring_systems`, never re-authored, so
--      this is the document D175's wall will actually meet. Plus the
--      fork-shaped format-2 envelope built from a seeded row, which is what
--      SE.5's fork RPC will insert.
--
--   §D A NAMED REJECTION PER GUARDRAIL (the §7.3.3.1 QA bullet, E75). Seven
--      families, each asserted on all three axes: the family code (HINT), the
--      dot path (DETAIL), and a MESSAGE that names its own guardrail. A
--      refusal that says only "invalid scoring rules" is the failure mode the
--      whole section exists to prevent.
--
--   §E D146(1) ONE-UNIT PINS. Every ≥/≤/count/boundary the validator owns,
--      with a fixture exactly one unit either side: |coef| 100.00 / 100.01 and
--      -100 / -100.01 · 2dp 0.01 / 0.001 · cuts 2 / 1 · the PA floor 0 / 1 and
--      0 / -1 · format 2 / 1 and 2 / 3 · the position vocabulary QB / qb · the
--      K↔DST scope clause both ways.
--
--   §F THE F21 LITERAL, AT EVERY LAYER, plus F137's own documents (F5–F10).
--      The cause there is SCOPE, not order (R604): guardrail 2 accepts a
--      re-cut key — its own cuts generate it — so reordering the families
--      changes nothing; guardrail 1 is a membership test against §23.5's
--      CLOSED 20-name list. §F7 is the one document here that breaks TWO
--      families and therefore the only one that pins precedence at all;
--      §F8–F10 use §7.3.3.1(c)'s OWN printed example cut list (R607).
--      The ruling this raises is PROGRESS §3 Q26 — not F59's to choose.
--
--   §B/§D THE 2^53 DOMAIN BOUNDARY (R599). `def_pa_14_20` + `def_pa_18_27` in one
--      document — the pair the ledger row was filed for — refused flat, in a
--      format-2 `base`, and in a `positions.DST` override (R593: the same
--      defect one layer down, which had no fixture until the SE.3 review).
--
--   §G THE MAGNITUDE/PRECISION ARM IS EXACT. All 20,001 legal 2dp values in
--      [-100, 100] accept — zero false rejections, the property SE.3 measured
--      in TS, re-measured against the SQL rule — and the two values one unit
--      outside refuse.
--
--   §H THE ALLOWLIST'S TIER HALF ≡ THE GENERATOR'S OUTPUT. The 48-key allowlist
--      is a transcription of the registry; its 20 tier keys are also derivable
--      from the three cut lists, and the two SQL sources are made to agree
--      here (near-miss names — `def_pa_0_13`, `def_ya_0_50` — draw guardrail 1
--      by name, so the allowlist is not merely a prefix match).
--
--   §H4 THE PREMISE THAT MAKES ONE ARM UNREACHABLE (R603). Guardrail 2's
--      format-1 `def_ya` arm cannot fire today and deleting it is invisible to
--      every test in this repo — because every `def_ya_*` name that clears
--      guardrail 1 is one the published cut list generates. That is a PREMISE,
--      and §H2 only proves one direction of it. §H4 reads the allowlist out of
--      the DEPLOYED FUNCTION BODY and set-compares its `def_ya` half against
--      the generator, so the day §23.5 carries a re-cut YA key (§3 Q26) this
--      cell reds and the arm goes live. Shipping a guard whose fixture cannot
--      reach it is only honest if the reason it cannot is itself pinned.
--
--   §J THE DETAIL SENTINEL IS INJECTIVE (R602). `(document)` has to mean the
--      document and nothing else, because SE.5/SE.6 turn DETAIL into a field
--      path. `""` is a legal JSON key, and the first cut of the rule ("empty
--      path ⇒ (document)") reported `{"": 1}` — a real field violation — as a
--      document-level one. Pinned as the PROPERTY (J4: no field violation can
--      be mistaken for a document-level one), not as two examples.
--
--   §I THE POSITION MAP, AS A HAND-COMPUTED HISTOGRAM. The full 6 × 48 matrix
--      through the validator, summarised per position into ACCEPT /
--      tier_exclusivity / position_scope counts that are STORED LITERALS
--      derived by hand from §7.3.3.1's section catalog (15 offense · 6 K · 27
--      D/ST; the 3 shared-only PA keys draw guardrail 2 first because the
--      fixture's own cuts are ESPN's). A drift in the transcription moves a
--      number here.
--
-- NOT PINNED HERE, AND SAID SO: TS≡SQL. That is `scoring-parity-db.test.ts`
-- (SE.4(4)) — pgTAP cannot run the TS validator, and a SQL file asserting SQL
-- against SQL-derived expectations would be the self-comparison this house
-- does not accept. Everything above is SQL against a stored literal, a
-- hand-computed count, or a row read from the database.
--
-- Conventions: no fixtures are written (the validator reads no table; the seven
-- template rows are migrations 058 + 106's seeds, read not created), so there is
-- no role/JWT dance and nothing to clean up; the whole file rolls back anyway.
-- Non-vacuity (F94): §C asserts the seven template rows EXIST before asserting
-- anything about them, and §G/§I assert their sweep sizes.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
select plan(130);

-- ---------------------------------------------------------------------------
-- Helpers. `verdict` collapses a call into `ACCEPT` or `<family>|<path>` so a
-- pin can assert the family AND the dot path in one comparison; `refusal`
-- returns the message for the E75 checks. Both are read-only wrappers around
-- the function under test — they add no rule of their own.
-- ---------------------------------------------------------------------------
create function pg_temp.verdict(d jsonb) returns text language plpgsql as $$
declare v_hint text; v_detail text;
begin
  perform public.scoring_rules_validate(d);
  return 'ACCEPT';
exception when others then
  if sqlstate <> 'P0001' then return 'ERROR|' || sqlstate || '|' || sqlerrm; end if;
  get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return coalesce(v_hint, '?') || '|' || coalesce(v_detail, '?');
end;
$$;

create function pg_temp.refusal(d jsonb) returns text language plpgsql as $$
begin
  perform public.scoring_rules_validate(d);
  return '(accepted)';
exception when others then
  return sqlerrm;
end;
$$;

-- A fresh format-2 envelope over an arbitrary base map — the shape
-- `forkTemplateDoc` produces and SE.5's fork RPC will insert.
create function pg_temp.env(p_base jsonb, p_positions jsonb default '{}'::jsonb,
                            p_pa jsonb default '[0,1,7,14,18,28,35,46]'::jsonb,
                            p_ya jsonb default '[0,100,200,300,350,400,450,500,550]'::jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object('format', 2, 'base', p_base, 'positions', p_positions,
                            'tier_cuts', jsonb_build_object('def_pa', p_pa, 'def_ya', p_ya));
$$;

-- ===========================================================================
-- §A FORM — the deployed shape of both functions
-- ===========================================================================

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'scoring_rules_validate'),
  1::bigint,
  'A1: exactly ONE scoring_rules_validate in public — a second overload would make every named call fail "function is not unique"');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'scoring_tier_keys_from_cuts'),
  1::bigint,
  'A2: exactly ONE scoring_tier_keys_from_cuts in public');

select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('scoring_rules_validate', 'scoring_tier_keys_from_cuts')
        and p.prosecdef $$,
  'A3: NEITHER function is SECURITY DEFINER — they read no table and carry no in-body auth, so a promotion to DEFINER would be a deputy with nothing to check (SE.4(1); tasks-M1 §4 rule 1)');

select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('scoring_rules_validate', 'scoring_tier_keys_from_cuts')
        and not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']) $$,
  'A4: both pin search_path to the spec form '''' (plan §8.3 / spec §12.0)');

select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('scoring_rules_validate', 'scoring_tier_keys_from_cuts')
        and p.provolatile <> 'i' $$,
  'A5: both are IMMUTABLE — a pure function of its argument, as SE.4(1) specifies');

select is(
  (select pg_catalog.pg_get_function_result(p.oid) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'scoring_rules_validate'),
  'void',
  'A6: scoring_rules_validate RETURNS void — it answers by RAISEing, never by a value a caller can forget to read');

select is(
  (select pg_catalog.pg_get_function_result(p.oid) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'scoring_tier_keys_from_cuts'),
  'text[]',
  'A7: scoring_tier_keys_from_cuts RETURNS text[]');

select ok(
  not has_function_privilege('anon', 'public.scoring_rules_validate(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.scoring_tier_keys_from_cuts(text, jsonb)', 'EXECUTE'),
  'A8: anon holds EXECUTE on NEITHER — the REVOKE is load-bearing (038/059 precedent); the editor is a commissioner surface');

select ok(
  has_function_privilege('authenticated', 'public.scoring_rules_validate(jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.scoring_rules_validate(jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.scoring_tier_keys_from_cuts(text, jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.scoring_tier_keys_from_cuts(text, jsonb)', 'EXECUTE'),
  'A9: authenticated and service_role DO hold EXECUTE (037 default ACLs) — SE.4b''s triggers run as the writing role, so a blanket revoke would break the wall');

-- ===========================================================================
-- §B THE GENERATOR (SE.4(2)) — byte-exact regeneration, then the naming rule
-- ===========================================================================

select is(
  public.scoring_tier_keys_from_cuts('def_pa', '[0,1,7,14,21,28,35]'::jsonb),
  array['def_pa_0','def_pa_1_6','def_pa_7_13','def_pa_14_20','def_pa_21_27',
        'def_pa_28_34','def_pa_35_plus']::text[],
  'B1: the SHARED (Yahoo/Sleeper) PA cut list regenerates today''s 7 key names byte-exactly (§7.3.3.1(a) — the whole backward-compatibility argument)');

select is(
  public.scoring_tier_keys_from_cuts('def_pa', '[0,1,7,14,18,28,35,46]'::jsonb),
  array['def_pa_0','def_pa_1_6','def_pa_7_13','def_pa_14_17','def_pa_18_27',
        'def_pa_28_34','def_pa_35_45','def_pa_46_plus']::text[],
  'B2: the ESPN PA cut list regenerates today''s 8 key names byte-exactly');

select is(
  public.scoring_tier_keys_from_cuts('def_ya', '[0,100,200,300,350,400,450,500,550]'::jsonb),
  array['def_ya_0_99','def_ya_100_199','def_ya_200_299','def_ya_300_349',
        'def_ya_350_399','def_ya_400_449','def_ya_450_499','def_ya_500_549',
        'def_ya_550_plus']::text[],
  'B3: the YA cut list regenerates today''s 9 key names byte-exactly');

-- Cross-check against the DATABASE, not against another constant: the ESPN
-- Standard seed's own def_pa_* / def_ya_* keys ARE the generated sets. A pin
-- that only compared two literals in this file could agree on a wrong pair.
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
     (select rules from public.scoring_systems where name = 'ESPN Standard' and is_template)) k
    where starts_with(k, 'def_pa_')),
  (select array_agg(k order by k) from unnest(
     public.scoring_tier_keys_from_cuts('def_pa', '[0,1,7,14,18,28,35,46]'::jsonb)) k),
  'B4: the SEEDED ESPN Standard row''s PA keys ARE the ESPN generation (the derive-agreement invariant, measured against the table)');

select is(
  (select array_agg(k order by k) from jsonb_object_keys(
     (select rules from public.scoring_systems where name = 'ESPN Standard' and is_template)) k
    where starts_with(k, 'def_ya_')),
  (select array_agg(k order by k) from unnest(
     public.scoring_tier_keys_from_cuts('def_ya', '[0,100,200,300,350,400,450,500,550]'::jsonb)) k),
  'B5: the SEEDED ESPN Standard row''s YA keys ARE the YA generation');

select is(
  (select array_agg(k order by k) from jsonb_object_keys(
     (select rules from public.scoring_systems where name = 'Yahoo Standard' and is_template)) k
    where starts_with(k, 'def_pa_')),
  (select array_agg(k order by k) from unnest(
     public.scoring_tier_keys_from_cuts('def_pa', '[0,1,7,14,21,28,35]'::jsonb)) k),
  'B6: the SEEDED Yahoo Standard row''s PA keys ARE the shared generation');

select is(
  public.scoring_tier_keys_from_cuts('def_pa', '[0,1]'::jsonb),
  array['def_pa_0','def_pa_1_plus']::text[],
  'B7: a two-cut list generates a single-value first tier plus the open last tier (D146: two cuts is the legal floor, and it is the shape that names both special cases at once)');

select is(
  public.scoring_tier_keys_from_cuts('def_pa', '[0,10,11,20]'::jsonb),
  array['def_pa_0_9','def_pa_10','def_pa_11_19','def_pa_20_plus']::text[],
  'B8: an INTERIOR single-value tier also collapses to <prefix>_<lo> — the strict generalization tier-cuts.ts documents, unobservable in the three shipped families and first constructible by F59');

select is(
  public.scoring_tier_keys_from_cuts('def_ya', '[-5,0,5]'::jsonb),
  array['def_ya_-5_-1','def_ya_0_4','def_ya_5_plus']::text[],
  'B9: negative cuts render with their sign (YA''s first tier is open below — D174 — so a negative first cut is a real shape there)');

select is(
  public.scoring_tier_keys_from_cuts('def_pa', '[0,7.0,14]'::jsonb),
  array['def_pa_0_6','def_pa_7_13','def_pa_14_plus']::text[],
  'B10: an integer written 7.0 renders as `7`, never `7.0` — ${7} is "7" in JS but (7.0)::text is "7.0", and def_pa_7.0_13 would be a plausible name nothing ever looks at again');

select throws_ok(
  $$ select public.scoring_tier_keys_from_cuts('def_pa', '[0]'::jsonb) $$,
  '22023', null,
  'B11: ONE cut refuses — one unit below the >= 2 floor (§7.3.3.1(c); D146)');

select lives_ok(
  $$ select public.scoring_tier_keys_from_cuts('def_pa', '[0,7]'::jsonb) $$,
  'B12: TWO cuts live — the legal edge itself (D146''s other side)');

select throws_ok(
  $$ select public.scoring_tier_keys_from_cuts('def_pa', '[0,7,7]'::jsonb) $$,
  '22023', null,
  'B13: a FLAT pair refuses — ascending must be STRICT (equal cuts would mint a duplicate key)');

select throws_ok(
  $$ select public.scoring_tier_keys_from_cuts('def_pa', '[0,7,6]'::jsonb) $$,
  '22023', null,
  'B14: a DESCENDING pair refuses — it would mint def_pa_7_5, a tier whose hi is below its lo');

select throws_ok(
  $$ select public.scoring_tier_keys_from_cuts('def_pa', '[0,7.5,14]'::jsonb) $$,
  '22023', null,
  'B15: a NON-INTEGER cut refuses (§7.3.3.1(c); R58/D58 — the published tables'' domain is the integers)');

select throws_ok(
  $$ select public.scoring_tier_keys_from_cuts('def_pa', '[0,1e400]'::jsonb) $$,
  '22023', null,
  'B16: a cut that parses to Infinity in TS refuses — Number.isInteger(Infinity) is FALSE, and numeric has no such range');

-- ── THE 2^53 DOMAIN BOUNDARY (R599), one unit either side ─────────────────
-- The cut-point domain here is `numeric`; the domain the engine SCORES in is
-- IEEE-754 double. Above 2^53 `numeric` separates integers a double cannot,
-- which is what made the strictly-ascending residual unmirrorable: `[0, 2^53,
-- 2^53+1]` ascends in numeric and collapses to a REPEATED cut in JS. The old
-- clause was `> 1e308` and never saw it.
select is(
  public.scoring_tier_keys_from_cuts('def_pa', '[0,9007199254740992]'::jsonb),
  array['def_pa_0_9007199254740991','def_pa_9007199254740992_plus']::text[],
  'B16a: 2^53 EXACTLY is legal — it is exactly representable as a double, and so is cut-1 at that bound, so both layers read the same list (D146, from inside the boundary)');

select throws_ok(
  $$ select public.scoring_tier_keys_from_cuts('def_pa', '[0,9007199254740993]'::jsonb) $$,
  '22023', null,
  'B16b: 2^53 + 1 refuses — ONE unit past, and the first magnitude at which numeric and double stop agreeing about which integer this is');

select throws_like(
  $$ select public.scoring_tier_keys_from_cuts('def_pa', '[0,1.5e308]'::jsonb) $$,
  '%exactly-representable integer range%',
  'B16c: …and the refusal names MAGNITUDE, not integrality (R600''s E75 half): 1.5e308 IS an integer and IS a finite JS number, and the first cut of this clause refused it with "must be integers", which is a false statement about the value');

select is(
  public.scoring_tier_keys_from_cuts('def_pa', '[0,9007199254740990,9007199254740992]'::jsonb),
  array['def_pa_0_9007199254740989','def_pa_9007199254740990_9007199254740991',
        'def_pa_9007199254740992_plus']::text[],
  'B16d: the RENDERING agrees with the TS generator right up to the boundary (R606) — above it SQL used to mint names TS cannot produce (`1e20 - 1 === 1e20` in JS, and 1e21 renders as `1e+21`), which the 2^53 cap now makes unconstructible at both doors');

select throws_ok(
  $$ select public.scoring_tier_keys_from_cuts('def_pa', '"nope"'::jsonb) $$,
  '22023', null,
  'B17: a non-array cut list refuses rather than returning an empty key set');

select throws_ok(
  $$ select public.scoring_tier_keys_from_cuts('def_pa', '[0,"7"]'::jsonb) $$,
  '22023', null,
  'B18: a STRING cut refuses — JSON type, not just JSON value');

-- ===========================================================================
-- §C THE ACCEPTANCE FLOOR, READ FROM THE TABLE (SE.4(3))
-- ===========================================================================

select is(
  (select count(*) from public.scoring_systems where is_template),
  8::bigint,
  'C1: the eight seeded template rows exist (058''s six + the Scout pair, 106/108) — the premise, asserted before anything is asserted about them (F94)');

select is_empty(
  $$ select s.name || ' -> ' || pg_temp.verdict(s.rules)
       from public.scoring_systems s
      where s.is_template and pg_temp.verdict(s.rules) <> 'ACCEPT' $$,
  'C2: ALL SEVEN seeded template `rules` ACCEPT — read from the table, never re-authored. These are the documents D175''s wall meets first (every league reference today is a template row)');

select is_empty(
  $$ select s.name || ' -> ' || pg_temp.verdict(pg_temp.env(s.rules))
       from public.scoring_systems s
      where s.name in ('ESPN Standard', 'ESPN Full PPR')
        and s.is_template
        and pg_temp.verdict(pg_temp.env(s.rules)) <> 'ACCEPT' $$,
  'C3: a FORK-SHAPED format-2 envelope over a seeded ESPN row ACCEPTS — the document SE.5''s fork RPC will insert');

select is_empty(
  $$ select s.name || ' -> ' || pg_temp.verdict(pg_temp.env(s.rules, '{}'::jsonb, '[0,1,7,14,21,28,35]'::jsonb))
       from public.scoring_systems s
      where s.name in ('Yahoo Standard', 'Yahoo Half PPR')
        and s.is_template
        and pg_temp.verdict(pg_temp.env(s.rules, '{}'::jsonb, '[0,1,7,14,21,28,35]'::jsonb)) <> 'ACCEPT' $$,
  'C4: a fork of a SHARED-family template carries the shared cuts and accepts — §7.3.3.1(b), the fork writes the STARTING template''s cut lists');

select is(
  pg_temp.verdict(pg_temp.env(
    (select rules from public.scoring_systems where name = 'ESPN Full PPR' and is_template),
    '{"TE": {"receptions": 1.5}}'::jsonb)),
  'ACCEPT',
  'C5: the editor''s headline legal edit — receptions worth more to a TE — accepts (§7.3.3.1''s own worked example)');

-- ===========================================================================
-- §D A NAMED REJECTION PER GUARDRAIL (the §7.3.3.1 QA bullet; E75)
-- ===========================================================================

select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb) || '{"postions": {"QB": {"receptions": 99}}}'::jsonb),
  'document_shape|postions',
  'D1 document_shape: a stray envelope member is refused BY NAME — `postions`, one transposed letter, would otherwise discard the commissioner''s whole override map while the save reported success (R588)');
select matches(
  pg_temp.refusal(pg_temp.env('{"pass_tds": 4}'::jsonb) || '{"postions": {"QB": {"receptions": 99}}}'::jsonb),
  'Document shape \(§7\.3\.3\.1',
  'D1m: …and the message names its own guardrail (E75)');

select is(
  pg_temp.verdict(pg_temp.env('{"def_points_allowed": 1}'::jsonb)),
  'scorable_allowlist|base.def_points_allowed',
  'D2 scorable_allowlist: the RAW SOURCE F21 is about is refused at `base` — paying it beside the tiers derived FROM it is the double-count');
select matches(
  pg_temp.refusal(pg_temp.env('{"def_points_allowed": 1}'::jsonb)),
  'Scorable allowlist \(§7\.3\.3\.1 guardrail 1\).*context key.*double-count',
  'D2m: …and the message names guardrail 1, says it is a context key, and says WHY');

select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{"K": {"fg_made": 3}}'::jsonb)),
  'scorable_allowlist|positions.K.fg_made',
  'D3 scorable_allowlist: an AGGREGATE in an override (fg_made beside its split tiers) is refused at its own path');

select is(
  pg_temp.verdict('{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
  'tier_exclusivity|(document)',
  'D4 tier_exclusivity: the format-1 arm refuses the mixed-family document at the DOCUMENT level (the keys are individually legal; the pair is not)');
select matches(
  pg_temp.refusal('{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
  'Tier exclusivity \(§7\.3\.3\.1 guardrail 2\).*F21 defect',
  'D4m: …and the message names guardrail 2 and the ledger row it closes');

select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{"QB": {"fg_0_39": 4}}'::jsonb)),
  'position_scope|positions.QB.fg_0_39',
  'D5 position_scope: a KICKING key under QB is refused at its own path (§7.3.3.1 guardrail 3''s third clause)');
select matches(
  pg_temp.refusal(pg_temp.env('{"pass_tds": 4}'::jsonb, '{"QB": {"fg_0_39": 4}}'::jsonb)),
  'Position scope \(§7\.3\.3\.1 guardrail 3\).*belongs to K',
  'D5m: …and the message names guardrail 3 and where the key DOES belong');

select is(
  pg_temp.verdict(pg_temp.env('{"receptions": 1}'::jsonb, '{"TE": {"receptions": 1}}'::jsonb)),
  'normal_form|positions.TE.receptions',
  'D6 normal_form: an override repeating the base value is refused per KEY — the All-Positions switch is derived state, so a no-op override would make it read OFF for a section whose values are in fact uniform');
select matches(
  pg_temp.refusal(pg_temp.env('{"receptions": 1}'::jsonb, '{"TE": {"receptions": 1}}'::jsonb)),
  'Normal form \(§7\.3\.3\.1 guardrail 4\).*All-Positions switch',
  'D6m: …and the message names guardrail 4 and the state it protects');

select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{"QB": {}}'::jsonb)),
  'normal_form|positions.QB',
  'D6b normal_form: an EMPTY override object is refused at the object path (its own arm — there is no key to name)');

select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": 100.01}'::jsonb)),
  'bounds|base.pass_tds',
  'D7 bounds: |coef| > 100 is refused at `base` — the layer a fork writes the whole template into (R590: every SE.3 bounds fixture had sat at positions.QB.*)');
select matches(
  pg_temp.refusal(pg_temp.env('{"pass_tds": 100.01}'::jsonb)),
  'Bounds \(§7\.3\.3\.1 guardrail 5\).*100\.01.*\|coef\| ≤ 100',
  'D7m: …and the message names guardrail 5, the offending value, and the bound');

select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{}'::jsonb, '[0,7,7]'::jsonb)),
  'tier_cuts|tier_cuts.def_pa',
  'D8 tier_cuts: a non-ascending cut list is refused at its table''s path — §7.3.3.1(c)''s residual, evaluated BEFORE guardrail 2 could generate from it');
select matches(
  pg_temp.refusal(pg_temp.env('{"pass_tds": 4}'::jsonb, '{}'::jsonb, '[0,7,7]'::jsonb)),
  'Tier cuts \(§7\.3\.3\.1\(c\)\).*ascend strictly',
  'D8m: …and the message names the residual and the condition');

select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb) || '{"tier_cuts": {"def_pa": [0,1,7,14,18,28,35,46], "def_ya": [0,100,200,300,350,400,450,500,550], "def_zz": [0,1]}}'::jsonb),
  'tier_cuts|tier_cuts.def_zz',
  'D8b tier_cuts: a STRAY TABLE inside tier_cuts is refused — normalizeScoringDoc passes tier_cuts through BY REFERENCE, so a stray there is a FIXED POINT of the normal form and needs its own member check (R588''s second half)');

-- ── The arms that had no pin until a probe proved they had none ──────────
-- Each block below was added because a deliberate weakening of the arm it
-- covers left this file FULLY GREEN. By this lane's twice-earned rule, an arm
-- whose removal costs nothing is not shipped.

select is(pg_temp.verdict('null'::jsonb), 'document_shape|(document)',
  'D0a front door: a JSON null is answered, not thrown — the input is a request body or a column, so "this is nonsense" is an ordinary answer');
select is(pg_temp.verdict('[]'::jsonb), 'document_shape|(document)',
  'D0b front door: an array is answered');
select is(pg_temp.verdict('42'::jsonb), 'document_shape|(document)',
  'D0c front door: a bare number is answered');
select is(pg_temp.verdict('"rules"'::jsonb), 'document_shape|(document)',
  'D0d front door: a bare string is answered');

select is(
  pg_temp.verdict('{"base": {}, "positions": {}, "tier_cuts": {}}'::jsonb),
  'document_shape|(document)',
  'D1b: an envelope whose `format` member was DELETED is diagnosed as such (R597) — it would otherwise read as a flat map whose keys happen to be base/positions/tier_cuts and answer with allowlist violations naming nothing a commissioner could act on');

select is(
  pg_temp.verdict('{"format": 2, "positions": {}, "tier_cuts": {"def_pa": [0,1], "def_ya": [0,1]}}'::jsonb),
  'document_shape|base',
  'D1c: a format-2 document with no `base` object is refused at `base`');
select is(
  pg_temp.verdict('{"format": 2, "base": {}, "tier_cuts": {"def_pa": [0,1], "def_ya": [0,1]}}'::jsonb),
  'document_shape|positions',
  'D1d: …and one with no `positions` object is refused at `positions`');
select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{"QB": 5}'::jsonb)),
  'document_shape|positions.QB',
  'D1e: a NON-OBJECT position override is a shape violation at its own path — and it is caught HERE rather than by guardrail 4, which would otherwise be asked to normalise it');

select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{}'::jsonb, '[0,7.5,14]'::jsonb)),
  'tier_cuts|tier_cuts.def_pa',
  'D8c: a NON-INTEGER cut is refused at the document level — the residual arm, distinct from the generator''s own precondition (B15). Without it a fractional cut reaches scoring_tier_keys_from_cuts and the validator THROWS where it must answer');
select matches(
  pg_temp.refusal(pg_temp.env('{"pass_tds": 4}'::jsonb, '{}'::jsonb, '[0,7.5,14]'::jsonb)),
  'Tier cuts \(§7\.3\.3\.1\(c\)\).*must be integers; index 1',
  'D8cm: …and the message names the residual and the offending INDEX');

select is(
  pg_temp.verdict(pg_temp.env('{"def_pa_0": 5}'::jsonb, '{}'::jsonb, '[0,7.5,14]'::jsonb)),
  'tier_cuts|tier_cuts.def_pa',
  'D8d: THE ORDERING CONTRACT (D269(4)) — the same malformed list in a document that DOES name a def_pa key still ANSWERS. The residuals are evaluated before guardrail 2 generates, so a user-shaped document never reaches the generator''s throw');

select is(
  pg_temp.verdict(pg_temp.env('{"def_pa_0": 5}'::jsonb, '{}'::jsonb, '[0,7,6]'::jsonb)),
  'tier_cuts|tier_cuts.def_pa',
  'D8e: …the same, for a descending list');

select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{}'::jsonb, '[0,1e400]'::jsonb)),
  'tier_cuts|tier_cuts.def_pa',
  'D8f: a cut that parses to Infinity in TS is refused at the document level too — Number.isInteger(Infinity) is false, so without this arm SQL would accept a cut list TS refuses');

-- ── R599: THE CLAIM D8f USED TO CARRY WAS FALSE, AND THIS IS THE DOCUMENT
--    THAT FALSIFIED IT ─────────────────────────────────────────────────────
-- D8f used to end "…the only place the two number models could differ in the
-- UNSAFE direction". It was not. The list below ASCENDS in `numeric` and
-- collapses to a repeated cut in JS, so SQL ACCEPTED it (HTTP 204 over
-- PostgREST) while TS refused it — and `tierKeysFromCuts`, on the production
-- scoring path via `tierBucketsFromCuts` → `deriveTierIndicators`, then THREW.
-- `> 1e308` could never have caught it. The clause is now `> 2^53`.
select is(
  pg_temp.verdict(pg_temp.env('{}'::jsonb, '{}'::jsonb,
                              '[0,9007199254740992,9007199254740993]'::jsonb)),
  'tier_cuts|tier_cuts.def_pa',
  'D8f2 (R599): a cut list that ascends in `numeric` but REPEATS a cut once parsed as doubles is refused — same family and same path as TS, which refuses it for the ascending residual. This exact document was an ACCEPT before the fix');

select is(
  pg_temp.verdict(pg_temp.env('{}'::jsonb, '{}'::jsonb, '[0,9007199254740992]'::jsonb)),
  'ACCEPT',
  'D8f3: 2^53 EXACTLY accepts at the document level too — the boundary is inclusive, and TS accepts the same bytes (D146, from inside)');

select is(
  pg_temp.verdict(pg_temp.env('{}'::jsonb, '{}'::jsonb, '[0,9007199254740993]'::jsonb)),
  'tier_cuts|tier_cuts.def_pa',
  'D8f4: 2^53 + 1 refuses — one unit past. TS ACCEPTS this one (it cannot see the difference), so here SQL is deliberately the STRICTER side: the wall fails loud rather than admitting a list the engine would read as something else');

select is(
  pg_temp.verdict('{"format": 2, "base": {}, "positions": {}}'::jsonb),
  'tier_cuts|tier_cuts',
  'D8g: a format-2 document with NO tier_cuts member is refused at tier_cuts');
select is(
  pg_temp.verdict('{"format": 2, "base": {}, "positions": {}, "tier_cuts": {"def_pa": [0,1,7,14,18,28,35,46]}}'::jsonb),
  'tier_cuts|tier_cuts.def_ya',
  'D8h: BOTH tables are always written (R577/SE.1) — "this league pays no yards-allowed table" is expressed by paying none of its keys, never by dropping its cut list, because guardrail 2''s format-2 arm would otherwise be unevaluable for that table');
select is(
  pg_temp.verdict('{"format": 2, "base": {}, "positions": {}, "tier_cuts": [1,2]}'::jsonb),
  'tier_cuts|tier_cuts',
  'D8i: a tier_cuts that is not an object is refused at tier_cuts');
select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{}'::jsonb, '"nope"'::jsonb)),
  'tier_cuts|tier_cuts.def_pa',
  'D8j: a cut LIST that is not an array is refused at its table''s path');

select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": "4"}'::jsonb)),
  'bounds|base.pass_tds',
  'D7b: a NON-NUMBER coefficient is guardrail 5''s finiteness arm — at `base`');
select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{"QB": {"pass_tds": null}}'::jsonb)),
  'bounds|positions.QB.pass_tds',
  'D7c: …and in an override');
select matches(
  pg_temp.refusal(pg_temp.env('{"pass_tds": "4"}'::jsonb)),
  'Bounds \(§7\.3\.3\.1 guardrail 5\).*must be a finite number',
  'D7cm: …named as guardrail 5''s finiteness arm, with the offending value quoted');

-- The seven families, all present and all distinct — the ordering contract
-- SE.4 inherits from D269(7), asserted as a set rather than as a habit.
select is(
  (select array_agg(distinct split_part(v, '|', 1) order by split_part(v, '|', 1))
     from unnest(array[
       pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb) || '{"postions": {}}'::jsonb),
       pg_temp.verdict(pg_temp.env('{"def_points_allowed": 1}'::jsonb)),
       pg_temp.verdict('{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
       pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{"QB": {"fg_0_39": 4}}'::jsonb)),
       pg_temp.verdict(pg_temp.env('{"receptions": 1}'::jsonb, '{"TE": {"receptions": 1}}'::jsonb)),
       pg_temp.verdict(pg_temp.env('{"pass_tds": 100.01}'::jsonb)),
       pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{}'::jsonb, '[0,7,7]'::jsonb))
     ]) v),
  array['bounds','document_shape','normal_form','position_scope',
        'scorable_allowlist','tier_cuts','tier_exclusivity']::text[],
  'D9: all SEVEN families are reachable and mutually distinct — no family is dead code, and none of them answers for another');

-- ===========================================================================
-- §E D146(1) ONE-UNIT PINS — every boundary, one unit either side
-- ===========================================================================

select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 100}'::jsonb)), 'ACCEPT',
  'E1: |coef| = 100.00 ACCEPTS — the legal edge itself');
select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 100.01}'::jsonb)), 'bounds|base.pass_tds',
  'E2: |coef| = 100.01 REFUSES — one unit past');
select is(pg_temp.verdict(pg_temp.env('{"pass_tds": -100}'::jsonb)), 'ACCEPT',
  'E3: -100.00 ACCEPTS — the bound is on the MAGNITUDE, both signs');
select is(pg_temp.verdict(pg_temp.env('{"pass_tds": -100.01}'::jsonb)), 'bounds|base.pass_tds',
  'E4: -100.01 REFUSES');
select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 0.01}'::jsonb)), 'ACCEPT',
  'E5: 0.01 ACCEPTS — the 2dp step itself');
select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 0.001}'::jsonb)), 'bounds|base.pass_tds',
  'E6: 0.001 REFUSES — one decimal place past');
select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 0.100}'::jsonb)), 'ACCEPT',
  'E7: 0.100 ACCEPTS — TRAILING ZEROS ARE NOT DECIMAL PLACES, and this is the pin that says WHICH mirror shipped. jsonb preserves the literal byte-exactly (scale() = 3 here), so D269(6)''s hand-off — a bare scale(p) <= 2 — would REFUSE a value the TS rule accepts, because String() renders the shortest round-tripping decimal. The mirror is scale(trim_scale(v)) <= 2. NOTE the digit: 0.10 has scale 2 and would pass either rule, so it would have been a decoration');
select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 4.0}'::jsonb)), 'ACCEPT',
  'E7b: …and an INTEGER written with a trailing zero accepts too — the shape a hand-authored or psql-authored document actually takes');
select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 0.07}'::jsonb)), 'ACCEPT',
  'E8: 0.07 ACCEPTS — the value that reds a naive (v*100) % 1 = 0 implementation in floating point');

select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{}'::jsonb, '[0,7]'::jsonb)), 'ACCEPT',
  'E9: a TWO-cut PA table ACCEPTS — the >= 2 floor, from above');
select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{}'::jsonb, '[0]'::jsonb)), 'tier_cuts|tier_cuts.def_pa',
  'E10: a ONE-cut PA table REFUSES — one unit below');

select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{}'::jsonb, '[0,7,14]'::jsonb)), 'ACCEPT',
  'E11: a PA table starting at exactly 0 ACCEPTS (R592/D174 — the derive-agreement clause)');
select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{}'::jsonb, '[1,7,14]'::jsonb)), 'tier_cuts|tier_cuts.def_pa',
  'E12: a PA table starting at 1 REFUSES — one unit above 0: it puts a FALSE E61 pending badge on an ordinary low-scoring week without moving any total');
select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{}'::jsonb, '[-1,0,7]'::jsonb)), 'tier_cuts|tier_cuts.def_pa',
  'E13: a PA table starting at -1 REFUSES — one unit below 0: R58/D58 rules a negative points-allowed UNMAPPABLE, so it would pay a tier for data the derivation refuses to map');
select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{}'::jsonb,
                              '[0,1,7,14,18,28,35,46]'::jsonb, '[-100,0,100]'::jsonb)),
  'ACCEPT',
  'E14: a YARDS-allowed table starting BELOW 0 accepts — D174: YA''s first tier is genuinely open below, because a negative-total-yards game is real. The floor is a PA rule, not a global one');

select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb)), 'ACCEPT',
  'E15: format 2 ACCEPTS');
select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb) || '{"format": 1}'::jsonb),
  'document_shape|format',
  'E16: format 1 REFUSES — one unit below. Format 1 IS the flat map, identified by carrying NO version member, so a document that NAMES version 1 is not one (R597)');
select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb) || '{"format": 3}'::jsonb),
  'document_shape|format',
  'E17: format 3 REFUSES — one unit above. A future format is a future validator, never a silent pass');
select matches(
  pg_temp.refusal(pg_temp.env('{"pass_tds": 4}'::jsonb) || '{"format": 3}'::jsonb),
  'never a silent pass',
  'E17m: …and it says so — reading an unknown version as "flat" or "base-only" would score an entire league wrong with no error anywhere');

select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{"QB": {"pass_tds": 5}}'::jsonb)), 'ACCEPT',
  'E18: positions.QB ACCEPTS — the exact vocabulary');
select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{"qb": {"pass_tds": 5}}'::jsonb)), 'position_scope|positions.qb',
  'E19: positions.qb REFUSES — case-sensitively, on purpose (R594): a forgiving upper(trim(p)) would ACCEPT this while resolveRules'' own-property lookup pays it NOTHING');
select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{"DEF": {"def_sack": 2}}'::jsonb)), 'position_scope|positions.DEF',
  'E20: positions.DEF REFUSES — the six names are DST, not DEF');

select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{"K": {"fg_0_39": 4}}'::jsonb)), 'ACCEPT',
  'E21: a kicking key under K ACCEPTS');
select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{"DST": {"fg_0_39": 4}}'::jsonb)), 'position_scope|positions.DST.fg_0_39',
  'E22: the same key under DST REFUSES — the K↔DST clause, one way (R594)');
select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{"DST": {"def_sack": 2}}'::jsonb)), 'ACCEPT',
  'E23: a D/ST key under DST ACCEPTS');
select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{"K": {"def_sack": 2}}'::jsonb)), 'position_scope|positions.K.def_sack',
  'E24: the same key under K REFUSES — the K↔DST clause, the other way');
select is(pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{"K": {"pass_tds": 5}}'::jsonb)), 'position_scope|positions.K.pass_tds',
  'E25: an OFFENSE key under K REFUSES — the clause''s third arm ("offense keys never under K/DST")');

-- ===========================================================================
-- §F THE F21 LITERAL, AT EVERY LAYER
-- ===========================================================================

select is(
  pg_temp.verdict('{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
  'tier_exclusivity|(document)',
  'F1: FLAT — the pair F21 was filed for. A PA=18–20 week one-hots BOTH families'' buckets and pays twice');

select is(
  pg_temp.verdict(pg_temp.env('{"def_pa_14_20": 4}'::jsonb)),
  'tier_exclusivity|base.def_pa_14_20',
  'F2: FORMAT-2 `base` — a document cannot name a tier its OWN cuts do not cut (this envelope carries ESPN''s), which is how §7.3.3.1 makes the double-pay INEXPRESSIBLE rather than merely refused');

select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb, '{"DST": {"def_pa_14_20": 4}}'::jsonb)),
  'tier_exclusivity|positions.DST.def_pa_14_20',
  'F3: a positions.DST OVERRIDE — the same defect one layer down (R593), doc-wide as the changelog''s "bucketization-set exclusivity DOC-WIDE" requires');

select is(
  pg_temp.verdict('{"def_pa_0": 5, "def_pa_1_6": 4, "def_pa_7_13": 3, "def_pa_28_34": -1}'::jsonb),
  'ACCEPT',
  'F4: the FOUR SHARED key names alone ACCEPT — D269(3)''s relaxed reading, mirrored verbatim and not re-litigated: they are a subset of BOTH families and cannot double-pay anything, because within one family the tiers are non-overlapping by construction');

-- ── F137: THE CAUSE IS SCOPE, NOT ORDER (R604 corrected an earlier reading) ─
-- These two cells were first written the other way round, and the correction
-- after that was ALSO wrong: it said guardrail 1 "runs ahead of" guardrail 2,
-- as though precedence were the mechanism. It is not. Measured: the F5
-- document draws exactly ONE violation, because `def_pa_0_13` IS in the set
-- its own cuts generate (`scoring_tier_keys_from_cuts('def_pa','[0,14,28]')` →
-- `def_pa_0_13, def_pa_14_27, def_pa_28_plus`) and both layers `continue` on a
-- generated key. Guardrail 2 has no complaint at any position in the sequence,
-- so REORDERING THE FAMILIES WOULD CHANGE NOTHING.
-- The cause is SCOPE: guardrail 1 is a membership test against §23.5's CLOSED
-- 20-name registry list, so it refuses a re-cut name wherever it runs. That is
-- why resolution (b) — carve `def_pa_*`/`def_ya_*` out of guardrail 1 and let
-- guardrail 2 own them — is the one that follows from the diagnosis. Ledger
-- **F137**, and the spec question it raises is PROGRESS §3 (Q26).
select is(
  pg_temp.verdict(pg_temp.env('{"def_pa_0_13": 5}'::jsonb, '{}'::jsonb, '[0,14,28]'::jsonb)),
  'scorable_allowlist|base.def_pa_0_13',
  'F5: a key a RE-CUT table generates but the REGISTRY does not carry is refused by guardrail 1 — a SCOPE refusal, not a precedence one: guardrail 2 accepts this key (its own cuts generate it) and TS returns exactly ONE violation for this document');

select is(
  pg_temp.verdict(pg_temp.env('{"def_pa_1_6": 5}'::jsonb, '{}'::jsonb, '[0,14,28]'::jsonb)),
  'tier_exclusivity|base.def_pa_1_6',
  'F6: …and a PUBLISHED key the document''s OWN cuts do not generate is refused by guardrail 2 — it clears guardrail 1 (it IS in the registry), so the format-2 arm is doing exactly its job');

-- The document that DOES exercise precedence, added because the F5/F6 pair
-- was described as pinning it and does not: neither of them violates two
-- families, so no precedence is ever taken. This one violates BOTH (TS returns
-- 2 violations, allowlist first), so it is the cell that would red if the
-- family ORDER ever changed.
select is(
  pg_temp.verdict(pg_temp.env('{"def_pa_0_13": 5}'::jsonb, '{}'::jsonb, '[0,1,7,14,18,28,35,46]'::jsonb)),
  'scorable_allowlist|base.def_pa_0_13',
  'F7: the one document here that breaks TWO families — a registry-absent key under the PUBLISHED cuts, which guardrail 1 refuses for scope AND guardrail 2 refuses for exclusivity (TS: 2 violations, allowlist first). This is the cell that pins WHICH family answers');

-- R607: §7.3.3.1(c) prints its own example cut list — `0, 7, 14, 18, 28, 35,
-- 46` — as the shape F59's boundary editor takes. Using the spec's own list
-- rather than an invented one costs nothing and makes the ledger row concrete.
-- Precision, because it is easy to overstate: the cut LIST alone is fine, and
-- paying only the six PUBLISHED tiers it generates is fine. What is refused is
-- paying the FIRST tier it generates, `def_pa_0_6`, which no registry entry
-- carries.
select is(
  pg_temp.verdict(pg_temp.env('{}'::jsonb, '{}'::jsonb, '[0,7,14,18,28,35,46]'::jsonb)),
  'ACCEPT',
  'F8: §7.3.3.1(c)''s OWN printed cut list is accepted as a cut list — F59''s input shape is legal today');

select is(
  pg_temp.verdict(pg_temp.env('{"def_pa_7_13": 3, "def_pa_14_17": 1, "def_pa_18_27": 0, "def_pa_28_34": -1, "def_pa_35_45": -3, "def_pa_46_plus": -5}'::jsonb,
                              '{}'::jsonb, '[0,7,14,18,28,35,46]'::jsonb)),
  'ACCEPT',
  'F9: …and paying the six PUBLISHED tiers it generates is accepted too');

select is(
  pg_temp.verdict(pg_temp.env('{"def_pa_0_6": 5}'::jsonb, '{}'::jsonb, '[0,7,14,18,28,35,46]'::jsonb)),
  'scorable_allowlist|base.def_pa_0_6',
  'F10: …but paying the FIRST tier it generates is refused — the whole of F137 in the spec''s own example: a commissioner who cuts PA where §7.3.3.1(c) says they may cannot pay the tier that cut creates');

-- ===========================================================================
-- §G THE MAGNITUDE/PRECISION ARM IS EXACT
-- ===========================================================================

select is(
  (select count(*) from generate_series(-10000, 10000) k),
  20001::bigint,
  'G1: the sweep is 20,001 values wide — the premise, so G2''s empty result cannot mean "nothing was swept" (F94/CLAUDE.md)');

select is_empty(
  $$ select (k::numeric / 100)::text
       from generate_series(-10000, 10000) k
      where pg_temp.verdict(jsonb_build_object('format', 2,
              'base', jsonb_build_object('pass_tds', k::numeric / 100),
              'positions', '{}'::jsonb,
              'tier_cuts', jsonb_build_object('def_pa', '[0,1,7,14,18,28,35,46]'::jsonb,
                                              'def_ya', '[0,100,200,300,350,400,450,500,550]'::jsonb)))
            <> 'ACCEPT' $$,
  'G2: ZERO false rejections across ALL 20,001 legal 2dp VALUES in [-100, 100] — the exactness property SE.3 measured in TS, re-measured against the SQL rule. (`k::numeric / 100` yields a scale-TWENTY numeric — `select scale(10::numeric/100)` → 20 — so this is simultaneously a 20,001-wide sweep of the TRAILING-ZERO class, and it is the sweep that reds when the mirror is weakened to a bare scale().)');

select is_empty(
  $$ select (round(k::numeric / 100, 2))::text
       from generate_series(-10000, 10000) k
      where pg_temp.verdict(jsonb_build_object('format', 2,
              'base', jsonb_build_object('pass_tds', round(k::numeric / 100, 2)),
              'positions', '{}'::jsonb,
              'tier_cuts', jsonb_build_object('def_pa', '[0,1,7,14,18,28,35,46]'::jsonb,
                                              'def_ya', '[0,100,200,300,350,400,450,500,550]'::jsonb)))
            <> 'ACCEPT' $$,
  'G2b: …and the same 20,001 values written at EXACTLY scale 2 also all accept — the other reading of "legal 2dp value", so G2 cannot be passing for a reason peculiar to how the division stores its result');

select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": 100.01}'::jsonb)) || ' / ' ||
  pg_temp.verdict(pg_temp.env('{"pass_tds": -100.01}'::jsonb)),
  'bounds|base.pass_tds / bounds|base.pass_tds',
  'G3: …and the two values one step OUTSIDE the swept range refuse, so G2 is a boundary and not a vacuum');

-- ===========================================================================
-- §H THE ALLOWLIST'S TIER HALF ≡ THE GENERATOR'S OUTPUT
-- ===========================================================================

select is(
  (select count(distinct k) from unnest(
      public.scoring_tier_keys_from_cuts('def_pa', '[0,1,7,14,21,28,35]'::jsonb)
   || public.scoring_tier_keys_from_cuts('def_pa', '[0,1,7,14,18,28,35,46]'::jsonb)
   || public.scoring_tier_keys_from_cuts('def_ya', '[0,100,200,300,350,400,450,500,550]'::jsonb)) k),
  20::bigint,
  'H1: the three published families name 20 DISTINCT tier keys (7 + 8 - 4 shared + 9) — the count §23.5(b) implies, as a stored literal');

select is_empty(
  $$ select k from unnest(
        public.scoring_tier_keys_from_cuts('def_pa', '[0,1,7,14,21,28,35]'::jsonb)
     || public.scoring_tier_keys_from_cuts('def_pa', '[0,1,7,14,18,28,35,46]'::jsonb)
     || public.scoring_tier_keys_from_cuts('def_ya', '[0,100,200,300,350,400,450,500,550]'::jsonb)) k
      where pg_temp.verdict(jsonb_build_object(k, 1)) <> 'ACCEPT' $$,
  'H2: EVERY generated tier key is in the validator''s scorable allowlist — the allowlist''s tier half and the generator agree, so the two SQL sources cannot drift apart');

-- ── R603: THE PREMISE THAT MAKES ONE ARM UNREACHABLE, PINNED BOTH WAYS ────
-- Guardrail 2's format-1 `def_ya` arm (migration 103, the `v_strays` block)
-- currently cannot fire: deleting it leaves this file at 114/114 and the
-- parity suite at 78/78, because every `def_ya_*` name that clears guardrail 1
-- is one the published cut list generates, so there is nothing left for
-- guardrail 2 to refuse. That is a PREMISE, not a property — and §H2 only
-- proves one direction (generated ⊆ allowlist). This proves the other, by
-- reading the allowlist out of the DEPLOYED FUNCTION BODY and set-comparing it
-- against the generator's output. The day §23.5 carries a re-cut YA key (F137
-- / the §3 question it raises), this cell reds and the arm goes live — which
-- is the honest way to ship a guard whose fixture cannot reach it.
-- (The extraction is body-wide on purpose: a `def_ya_*` name hard-coded
-- anywhere in this function other than the allowlist is itself a finding.)
select is(
  (select array_agg(m[1] order by m[1])
     from (select p.prosrc t from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'scoring_rules_validate') src,
          regexp_matches(src.t, '''(def_ya_[a-z0-9_]+)''', 'g') m),
  (select array_agg(k order by k)
     from unnest(public.scoring_tier_keys_from_cuts(
       'def_ya', '[0,100,200,300,350,400,450,500,550]'::jsonb)) k),
  'H4 (R603): the allowlist''s def_ya half is SET-EQUAL to the generator''s output — the premise that makes guardrail 2''s format-1 def_ya arm unreachable today, pinned in the direction §H2 does not cover. Deleting that arm is invisible to every test in this repo; deleting this premise is not');

select is(
  (select array_agg(pg_temp.verdict(jsonb_build_object(k, 1)) order by k)
     from unnest(array['def_pa_0_13','def_ya_0_50','def_pa_2','def_ya_600_plus']) k),
  array['scorable_allowlist|def_pa_0_13','scorable_allowlist|def_pa_2',
        'scorable_allowlist|def_ya_0_50','scorable_allowlist|def_ya_600_plus']::text[],
  'H3: …and NEAR-MISS tier names draw guardrail 1 BY NAME — the allowlist is a membership test, not a `def_pa_%` prefix match');

-- ===========================================================================
-- §I THE POSITION MAP, AS A HAND-COMPUTED HISTOGRAM (§7.3.3.1's catalog)
-- ===========================================================================
--
-- The full 6 x 48 matrix, one key per position override, over an envelope
-- whose own cuts are ESPN's. Hand-computed from the section catalog:
--   legal(QB/RB/WR/TE) = 15 offense keys · legal(K) = 6 · legal(DST) = 27
--     (7 events + 11 distinct PA + 9 YA)
--   the 3 SHARED-ONLY PA keys (def_pa_14_20, def_pa_21_27, def_pa_35_plus) are
--     not generated by this envelope's ESPN cuts, so they draw guardrail 2
--     BEFORE guardrail 3 gets a turn — at every position, legal or not.
-- ⇒ QB/RB/WR/TE: 15 ACCEPT · 3 tier_exclusivity · 30 position_scope
--   K:            6 ACCEPT · 3 tier_exclusivity · 39 position_scope
--   DST:         24 ACCEPT · 3 tier_exclusivity · 21 position_scope
--                (27 legal minus the 3 shared-only; 21 = the 15 offense + 6 K)

create temp view pg_temp_matrix as
  select p.position, k.key,
         split_part(pg_temp.verdict(pg_temp.env('{}'::jsonb,
           jsonb_build_object(p.position, jsonb_build_object(k.key, 0.25)))), '|', 1) as family
    from unnest(array['QB','RB','WR','TE','K','DST']) as p(position)
   cross join unnest(
     array['pass_yards','pass_tds','interceptions','pass_2pt','qb_sack_taken',
           'rush_yards','rush_tds','rush_2pt','receptions','receiving_yards',
           'receiving_tds','rec_2pt','return_td','fumbles_lost','fumble_recovery_td',
           'fg_0_39','fg_40_49','fg_50_plus','pat_made','fg_missed','pat_missed',
           'def_sack','def_int','def_fumble_rec','def_td','def_safety','def_block',
           'def_return_td',
           'def_pa_0','def_pa_1_6','def_pa_7_13','def_pa_14_20','def_pa_21_27',
           'def_pa_28_34','def_pa_35_plus','def_pa_14_17','def_pa_18_27',
           'def_pa_35_45','def_pa_46_plus',
           'def_ya_0_99','def_ya_100_199','def_ya_200_299','def_ya_300_349',
           'def_ya_350_399','def_ya_400_449','def_ya_450_499','def_ya_500_549',
           'def_ya_550_plus']) as k(key);

select is((select count(*) from pg_temp_matrix), 288::bigint,
  'I1: the matrix is 6 x 48 = 288 cells — the premise (F94)');

select is(
  (select array_agg(position || ':' || family || '=' || n
                    order by position, family)
     from (select position, family, count(*) as n from pg_temp_matrix
            group by position, family) s),
  array[
    'DST:ACCEPT=24','DST:position_scope=21','DST:tier_exclusivity=3',
    'K:ACCEPT=6','K:position_scope=39','K:tier_exclusivity=3',
    'QB:ACCEPT=15','QB:position_scope=30','QB:tier_exclusivity=3',
    'RB:ACCEPT=15','RB:position_scope=30','RB:tier_exclusivity=3',
    'TE:ACCEPT=15','TE:position_scope=30','TE:tier_exclusivity=3',
    'WR:ACCEPT=15','WR:position_scope=30','WR:tier_exclusivity=3'
  ]::text[],
  'I2: the histogram matches the hand-computed catalog EXACTLY — 15 offense / 6 kicking / 27 D-ST legal keys, with the 3 shared-only PA keys answered by guardrail 2 first. A drift in the SQL transcription of the section catalog moves a number here');

select is(
  (select count(*) from pg_temp_matrix where family = 'ACCEPT'),
  90::bigint,
  'I3: 90 of the 288 cells accept (15x4 + 6 + 24) — the same total from the other direction, so I2 cannot pass by two errors cancelling');

select is_empty(
  $$ select position || '.' || key || ' -> ' || family from pg_temp_matrix
      where family not in ('ACCEPT', 'position_scope', 'tier_exclusivity') $$,
  'I4: no cell answers with any OTHER family — in particular none errors out (an ERROR| verdict would prove the validator THREW where it must answer)');

-- ===========================================================================
-- §J THE DETAIL SENTINEL IS INJECTIVE (R602)
-- ===========================================================================
--
-- `(document)` has to mean the document and nothing else, because SE.5's RPCs
-- and SE.6's routes turn DETAIL into a form-field path. The first cut of the
-- rule was "empty path ⇒ (document)" — and `""` is a LEGAL JSON key, so
-- `{"": 1}`, a concrete allowlist violation at a real field, was reported as a
-- document-level refusal. The document-level sites now carry a NULL path.

select is(
  pg_temp.verdict('{"": 1}'::jsonb),
  'scorable_allowlist|',
  'J1: the empty-string KEY reports an EMPTY path — a field violation, not a document one');

select is(
  pg_temp.verdict('{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
  'tier_exclusivity|(document)',
  'J2: …and a genuine document-level refusal still reports `(document)`, so the two are distinguishable — which is exactly what the pair proves and what a single `= ''''` test could not');

select is(
  pg_temp.verdict(pg_temp.env('{"pass_tds": 4}'::jsonb) || '{"": 1}'::jsonb),
  'document_shape|',
  'J3: the same, one layer up — a format-2 stray member NAMED "" reports its own (empty) name, not `(document)`');

select isnt(
  pg_temp.verdict('{"": 1}'::jsonb),
  pg_temp.verdict('{"def_pa_14_20": 4, "def_pa_18_27": 3}'::jsonb),
  'J4: stated as the property rather than as two examples — no field violation can be mistaken for a document-level one through the DETAIL channel');

select * from finish();
rollback;
