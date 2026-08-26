-- ============================================================================
-- 105 — the FRONT DOORS (SE.5): `scoring_fork_template` + `scoring_update_rules`
--       + §12.25's member SELECT policy + D169's 061 attach amendment, and the
--       F147 lock decision that 104 deliberately deferred to this task.
--
--       104 made an invalid league scoring document UNREPRESENTABLE. This
--       migration makes a VALID one REACHABLE: the §7.3.3.1 entry point (fork a
--       template into the league's own row) and the editor's save, both
--       SECURITY DEFINER, both commissioner-only, both inside the §7.3
--       `setup`/`scheduled` window — with the walls behind them as the law and
--       these RPCs as the front door that carries the user-facing error.
--
--       tasks-SE §5 SE.5; spec §12.25 (the policy SQL is printed there and is
--       copied here BY NAME, never by line — see §3's banner), §7.3.3.1's
--       entry-point + lifecycle bullets, §7.3 header (`setup`/`scheduled`),
--       §7.3.8's v2.11 bullet; PROGRESS D169/D170/D175, D273.
-- ============================================================================
--
-- ── THE REACHABILITY ASSUMPTION THIS MIGRATION EXPIRES (SE.5(3)) ───────────
-- Every "not reachable today" in 104, in D272 and in F142/F151 rests on ONE
-- fact: `public.leagues` carries a single SELECT-only policy, and BOTH attach
-- RPCs restrict `p_scoring_system_id` to `is_template = TRUE AND owner_id IS
-- NULL`, so no application role can put a user-writable row in front of a
-- league. **§2 and §6 below remove exactly the second half of that** (the fork
-- RPC mints the row; D169's amendment lets the settings path re-attach it). After this
-- migration a league can reference a row its own commissioner writes through
-- 001:623's `FOR ALL` policy. The confinement argument is therefore RE-DERIVED
-- here rather than inherited:
--
--   • The row is user-writable — and every write to it goes through WALL 1,
--     which matches it by TWO profile arms at once (it is a format-2 envelope,
--     arm (b), AND live-league-referenced, arm (c)). D175's guarantee is
--     unchanged: the document cannot become invalid, by any role or path.
--   • The reference is user-reachable — and every write to
--     `leagues.scoring_system_id` still goes through WALL 3, which re-validates
--     the referenced document on assignment. §4's new arm widens WHICH row an
--     RPC will point a league at; it does not widen what a league may end up
--     pointing at, because wall 3 is downstream of every one of them.
--   • CONCURRENCY changes, and that is §5's subject: a commissioner's save is
--     now a multi-statement transaction that writes `scoring_systems` while a
--     league write may be resolving the same row. That is the leg F151 was
--     filed for, and it is measured rather than argued — see §5.
--   • **AND THE §7.3 LIFECYCLE WINDOW STOPS BEING STRUCTURAL (R645).** An
--     earlier form of this list ended at concurrency and claimed a
--     completeness it did not have. Before 105 no league could reference a
--     client-writable row, so "scoring is editable only in setup/scheduled" was
--     airtight by unreachability. It is now a check in `scoring_update_rules`,
--     and the row's OWNER — not any commissioner — can still write the row
--     directly through 001:623 at any status. Deliberately NOT closed here, and
--     the reason is the spec: §7.3's header makes post-draft scoring an
--     *allowed* commissioner override, and §7.3.3.1 scopes the window to the
--     EDITOR SURFACE. Nothing reads the live row post-draft either —
--     `useLeagueScoringFamily` short-circuits on a non-NULL snapshot, which
--     059's guard makes non-NULL from `drafting` on. A status predicate on wall
--     1 would make a commissioner's own row un-writable through a route the
--     override law contemplates, to close a drift nothing reads. **Revisit when
--     SE.7's editor and a member-facing league-scoring view land** — at that
--     point §12.25's policy (which has no status predicate) makes the drift
--     member-visible and the guard would earn its keep.
--   • The checklist this list is an instance of, so the next task does not
--     enumerate from memory: when a row becomes client-writable in front of a
--     league, ask **who else reads this namespace** (→ F156), **what invariants
--     were enforced by unreachability** (→ the lifecycle bullet above), and
--     **what referential-integrity edges become reachable** (→ the FK lock
--     direction in this file's header).
--
-- ── LOCK ORDER, STATED ONCE AND HELD BY EVERY FUNCTION HERE ────────────────
-- **`leagues` FIRST, `scoring_systems` SECOND.** Both new RPCs take the league
-- row `FOR UPDATE` (061's step-2 idiom) before they touch `scoring_systems`,
-- and `update_league_settings` already did. Wall 1 — the only GUARD that reads
-- in the opposite direction — takes NO lock at all: its arm (c) is a bare
-- `EXISTS` with no `FOR` clause, which is the fact F148 corrected. **A `FOR`
-- clause added to wall 1 would create a cycle**, so that absence is pinned in
-- pgTAP 053 §G rather than left to this comment.
--
-- **THAT IS THE PL/pgSQL LOCK GRAPH AND NOT THE WHOLE ONE (R644).**
-- `leagues_scoring_system_id_fkey` is `ON DELETE NO ACTION`, so deleting a
-- referenced `scoring_systems` row locks the scoring row first and then takes
-- `FOR KEY SHARE` on the referencing `leagues` row — the reverse direction,
-- executed by RI machinery that appears in no `prosrc` and that no catalog pin
-- can reach. **SE.5 is what makes it reachable at all**, because §2 is the
-- first thing in the chain to put an owner-owned — hence owner-DELETABLE — row
-- in front of a live league; before 105 the reference was always an ownerless
-- template that `authenticated` cannot delete. It is named rather than fixed:
-- the DELETE that opens it is refused by the FK itself 100% of the time
-- (23503), the resulting 40P01 is a transient abort with no partial write, no
-- DELETE route exists, and §12.25's own hygiene case (deleting an ORPHANED
-- fork) takes no RI lock at all. See §5's body comment for the full statement.
--
-- Migration checklist (§8.1 / §4.4):
--   • Additive-first: three new functions, one new policy, one `CREATE OR
--     REPLACE` of 061's `update_league_settings` (D169) and one of 104's
--     `leagues_scoring_reference_guard` (F147). No table, column or index
--     changes. No existing policy is altered or dropped.
--   • RLS: ONE additive SELECT policy on `scoring_systems` (§12.25), copied
--     from the spec by policy NAME. The no-write-policy pattern is pinned per
--     role with RETURNING counts in pgTAP 053 §D (§4.2): the new policy grants
--     SELECT and nothing else, and 058's `scoring_systems_template_ownerless`
--     CHECK still refuses minting a template through the fork RPC.
--     **R6 waiver:** no staging clone exists; the rehearsal evidence is this
--     migration applied forward over the 001–104 chain plus the full pgTAP +
--     vitest suites, shown in the SE.5 PR. **D38 waiver:** no new table ⇒ no
--     realtime work owed.
--   • Indexes: none added. `idx_leagues_scoring_system` (104 §1) is the index
--     §12.25's policy scans, and it already ships — re-measured, not assumed:
--         \d public.leagues  →  "idx_leagues_scoring_system" btree (scoring_system_id)
--   • Grants: no per-object GRANT (D18/D23 — 037's default ACLs). Explicit
--     REVOKE FROM PUBLIC, anon on both new RPCs and on the detection helper
--     (the 038/059/061/103/104 precedent), pinned in pgTAP 053 §A.
--   • SECURITY DEFINER triad (§4.1), discharged per function rather than as a
--     posture: `search_path = ''` ✓ · REVOKE ✓ · **in-body authorization** ✓ —
--     both RPCs open with `public.is_league_commish(p_league_id)` and raise
--     42501, and a nonexistent league yields the same 42501 (no existence
--     leak, 061's rule). `scoring_detect_tier_cuts` is a pure function of its
--     argument and is deliberately NOT `SECURITY DEFINER`.
--   • Typegen: RE-RUN. Two new PostgREST-exposed functions change the
--     generated `Functions` surface (R68's lesson; contrast 104, whose
--     `RETURNS TRIGGER` functions are never in it). The hand-written alias
--     block is preserved and re-appended, its md5 identical either side; the
--     diff is verified additive-only. Numbers in the PR.
--   • `CREATE OR REPLACE` head provenance — MEASURED, per D137 and CLAUDE.md's
--     migration-073 rule (author against the newest migration FILE that defines
--     the function, never against `pg_get_functiondef`):
--         grep -rln "FUNCTION update_league_settings" supabase/migrations/
--             →  061_update_league_settings.sql   (ONLY, across 001–104)
--         grep -rln "FUNCTION public.leagues_scoring_reference_guard" \
--             supabase/migrations/
--             →  104_scoring_write_walls.sql      (ONLY)
--     Both bodies below are transcribed from those two FILES. The sweep was
--     RUN, not inherited: `draft_start_internal`, swept in the same §1 pass of
--     the SE breakdown, moved 084 → 092 → 098 in seven days, and the SE doc's
--     own recorded sweep for `update_league_settings` has now been re-run
--     three times because a sweep is a claim with an expiry date.
--   • Chain heads measured at task time, never inherited (D166/D161):
--         ls supabase/migrations/ | tail -1  →  104_scoring_write_walls.sql
--         ls supabase/tests/      | tail -1  →  052_scoring_write_walls.sql
--     ⇒ this migration is 105 and its pgTAP is 053. Checked together with the
--     R/D/F/Q counters across `main` and the one open branch (PR #180,
--     docs-only: `git diff --name-only origin/main...pr180 -- supabase/` → 0).
--   • Prod-safe: three new functions, one new SELECT policy, two replacements
--     whose old bodies are transcribed here in full. No data is written.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. `scoring_detect_tier_cuts` — which published family a flat document's own
--    tier keys were cut on. The SQL twin of `detectTierCuts`
--    (src/lib/leagues/scoring/rules-doc.ts).
-- ---------------------------------------------------------------------------
--
-- §7.3.3.1(b): **the fork writes the STARTING TEMPLATE's cut lists**, so that
-- the generated key set is identical to the template's literal keys and the
-- document scores the same whether the engine derives from cuts or from
-- `derive-stats.ts`'s literals. That is the backward-compatibility argument,
-- and it only holds if the family is detected from THE KEYS. Matching on the
-- string 'ESPN' in the template's NAME would make it depend on a display
-- string; matching on keys makes it depend on the only thing that scores.
--
-- The two PA families share FOUR key names (`def_pa_0`, `def_pa_1_6`,
-- `def_pa_7_13`, `def_pa_28_34`), so a subset match can be AMBIGUOUS — a
-- document naming only those four belongs to both. That case RAISES rather
-- than picking one: guessing would silently re-cut a defense's tiers, and a
-- silently-wrong tier table is the F21 defect wearing a different hat. All six
-- shipped templates carry at least one divergent key and match exactly one
-- family (pinned, pgTAP 053 §B).
--
-- The YA slot is ALWAYS written — a single-model document simply pays none of
-- its `def_ya_*` keys, which is why `scoring_rules_validate` requires both
-- tables to be present. A document whose `def_ya_*` keys are NOT generated by
-- the published YA list would be RE-CUT by writing that list, so it raises
-- too; adding a YA table to a single-model document is F59's follow-up, not
-- this fork.
CREATE OR REPLACE FUNCTION public.scoring_detect_tier_cuts(p_rules JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  -- The three published cut lists (§23.5(b); `tier-cuts.ts`'s constants, and
  -- 103's own `c_shared_pa`/`c_espn_pa`/`c_ya`). Transcribed rather than
  -- imported because a PL/pgSQL function cannot read another's constants; the
  -- transcription is proved equal to the generator's output in pgTAP 053 §B.
  c_shared_pa CONSTANT JSONB := '[0, 1, 7, 14, 21, 28, 35]'::JSONB;
  c_espn_pa   CONSTANT JSONB := '[0, 1, 7, 14, 18, 28, 35, 46]'::JSONB;
  c_ya        CONSTANT JSONB := '[0, 100, 200, 300, 350, 400, 450, 500, 550]'::JSONB;

  v_pa_keys    TEXT[];
  v_ya_keys    TEXT[];
  v_stray      TEXT[];
  v_matches    JSONB[] := ARRAY[]::JSONB[];
  v_family     JSONB;
BEGIN
  IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'object' THEN
    RAISE EXCEPTION
      'scoring_detect_tier_cuts: expected a flat scoring document object, got %',
      COALESCE(jsonb_typeof(p_rules), 'NULL')
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::TEXT[]) INTO v_pa_keys
  FROM jsonb_object_keys(p_rules) k WHERE k LIKE 'def\_pa\_%';

  IF cardinality(v_pa_keys) = 0 THEN
    RAISE EXCEPTION
      'cannot fork a scoring document with no def_pa_* keys: its points-allowed cut list is undetectable, and guessing one would re-cut the defense''s tiers (§7.3.3.1(b))'
      USING ERRCODE = 'P0001', HINT = 'tier_cuts_undetectable', DETAIL = '(document)';
  END IF;

  FOREACH v_family IN ARRAY ARRAY[c_shared_pa, c_espn_pa] LOOP
    IF v_pa_keys <@ public.scoring_tier_keys_from_cuts('def_pa', v_family) THEN
      v_matches := v_matches || v_family;
    END IF;
  END LOOP;

  IF cardinality(v_matches) <> 1 THEN
    RAISE EXCEPTION
      'def_pa_* keys [%] match % published families — a fork must inherit exactly one cut list (§7.3.3.1(b); F21 guardrail 2)',
      array_to_string(v_pa_keys, ', '), cardinality(v_matches)
      USING ERRCODE = 'P0001', HINT = 'tier_cuts_undetectable', DETAIL = '(document)';
  END IF;

  SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::TEXT[]) INTO v_ya_keys
  FROM jsonb_object_keys(p_rules) k WHERE k LIKE 'def\_ya\_%';

  SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::TEXT[]) INTO v_stray
  FROM unnest(v_ya_keys) k
  WHERE NOT (k = ANY(public.scoring_tier_keys_from_cuts('def_ya', c_ya)));

  IF cardinality(v_stray) > 0 THEN
    RAISE EXCEPTION
      'def_ya_* keys [%] are not generated by the published yards-allowed cut list — forking would re-cut them (§7.3.3.1(b))',
      array_to_string(v_stray, ', ')
      USING ERRCODE = 'P0001', HINT = 'tier_cuts_undetectable', DETAIL = '(document)';
  END IF;

  RETURN jsonb_build_object('def_pa', v_matches[1], 'def_ya', c_ya);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.scoring_detect_tier_cuts(JSONB) FROM PUBLIC, anon;

COMMENT ON FUNCTION public.scoring_detect_tier_cuts(JSONB) IS
  'SE.5 / spec §7.3.3.1(b): flat scoring document -> its inherited tier_cuts, the SQL twin of detectTierCuts (src/lib/leagues/scoring/rules-doc.ts). Detected from the KEY SET, never from a template name, because §7.3.3.1(b)''s byte-exact-regeneration guarantee is the backward-compatibility argument. The two PA families share four key names, so an ambiguous document RAISES rather than being assigned a family — guessing would silently re-cut a defense''s tiers. Not SECURITY DEFINER: a pure function of its argument.';

-- ---------------------------------------------------------------------------
-- 2. `scoring_fork_template` — §7.3.3.1's ENTRY POINT (D170: league context
--    only; the create wizard stays templates-only and 060 is untouched)
-- ---------------------------------------------------------------------------
--
-- "Picking a template as the starting point FORKS it into a new
-- `scoring_systems` row (`owner_id` = commissioner, `is_template = FALSE`, name
-- defaulting to '<League> Custom'), which `leagues.scoring_system_id` then
-- references" — §7.3.3.1's entry-point bullet, in one transaction.
--
-- **IDEMPOTENCY (plan §2.3), and the natural key it uses.** A retried submit
-- must not mint a second row. There is no `action_id` column here and §12.25
-- forbids adding one ("no new columns"), so the natural key is the STATE: if
-- the league already references a non-template row owned by a commissioner of
-- this league whose `rules` deep-equal the document this call would build, the
-- fork already happened and its id is returned WITHOUT inserting. A deliberate
-- re-fork AFTER edits does not match (the rules differ), so it creates a fresh
-- row and orphans the old one — §12.25's accepted hygiene, stated there in
-- full: detached rows are left in place and the member SELECT policy stops
-- matching on its own.
--
-- **WHY "OWNED BY A COMMISSIONER OF THIS LEAGUE" AND NOT `= auth.uid()`.**
-- `is_league_commish` admits co_commissioners, so a co-commissioner may call
-- this. Under `owner_id = auth.uid()` their retry would MISS the idempotency
-- test and mint a duplicate row — the retry-safety hole this clause exists to
-- close, opened by the narrower predicate. The same predicate is used by
-- `scoring_update_rules` below, so both RPCs agree on what "the league's own
-- fork row" means; disagreeing would let one RPC edit a row the other would
-- not have forked.
CREATE OR REPLACE FUNCTION public.scoring_fork_template(
  p_league_id   UUID,
  p_template_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status        TEXT;
  v_name          TEXT;
  v_current       UUID;
  v_template      JSONB;
  v_doc           JSONB;
  v_existing      UUID;
  v_new_id        UUID;
  v_rows          INT;
BEGIN
  -- 1. In-body authorization (§4.1/§12.0; 061's shape). A nonexistent league
  --    yields FALSE here too — no existence leak.
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'scoring_fork_template: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- 2. The league row, LOCKED FIRST (the lock order stated in this file's
  --    banner: leagues before scoring_systems, every function, no exception).
  --    Soft-deleted leagues are not found.
  SELECT l.status, l.name, l.scoring_system_id
    INTO v_status, v_name, v_current
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scoring_fork_template: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. §7.3 header + §7.3.3.1's lifecycle bullet: the editor is a
  --    `setup`/`scheduled` surface. After draft start the doc is frozen
  --    verbatim in `scoring_rules_snapshot` and scoring changes are the
  --    existing commissioner-override law, which this surface does not expose.
  --    **This is the DoD break-probe target** (pgTAP 053 §B4/§B5).
  IF v_status NOT IN ('setup', 'scheduled') THEN
    RAISE EXCEPTION
      'scoring_fork_template: league % is in % — scoring can only be customized while the league is in setup or scheduled; once the draft starts the rules are frozen into the league''s snapshot (§7.3 header, §7.3.3.1 lifecycle)',
      p_league_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. The starting point must be a TEMPLATE (060/061's predicate, both
  --    conjuncts so the guard survives a change to 058's CHECK). §7.3.3.1: "a
  --    fork always starts from a template"; pre-existing personal systems stay
  --    unattachable (D33's one-namespace rule).
  SELECT s.rules INTO v_template
  FROM public.scoring_systems s
  WHERE s.id = p_template_id
    AND s.is_template = TRUE
    AND s.owner_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'scoring_fork_template: p_template_id must reference one of the scoring templates — a custom scoring system is always forked FROM a template, and personal scoring systems cannot be attached to a league (§7.3.3.1 entry point, §7.3.3)'
      USING ERRCODE = 'P0001';
  END IF;

  -- 4b. Templates are format 1 by construction, and this refuses rather than
  --     folds if that ever stops being true: folding a fork into a fork would
  --     quietly discard its overrides (`forkTemplateDoc`'s own refusal, mirrored).
  IF v_template ? 'format' THEN
    RAISE EXCEPTION
      'scoring_fork_template: template % already carries a "format" member — a fork always starts from a format-1 template document (§7.3.3.1)',
      p_template_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. The format-2 fork document (§7.3.3.1's printed shape). `base` is the
  --    template's flat map VERBATIM — which is what makes a fresh fork score
  --    identically to its template for every position (the fork-equivalence
  --    property). `positions` starts EMPTY: a fresh fork overrides nothing.
  --    `tier_cuts` is the inherited family, detected from the keys.
  v_doc := jsonb_build_object(
    'format',    2,
    'base',      v_template,
    'positions', '{}'::JSONB,
    'tier_cuts', public.scoring_detect_tier_cuts(v_template)
  );

  -- 6. IDEMPOTENCY, before any write (see this section's banner).
  SELECT s.id INTO v_existing
  FROM public.scoring_systems s
  WHERE s.id = v_current
    AND s.is_template = FALSE
    AND s.rules = v_doc
    AND EXISTS (
      SELECT 1 FROM public.league_members m
      WHERE m.league_id = p_league_id
        AND m.user_id = s.owner_id
        AND m.role IN ('commissioner', 'co_commissioner')
    );
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  -- 7. Defense in depth, not the guard: wall 1 refuses this document at the
  --    INSERT below whatever happens here. The RPC is the FRONT DOOR and this
  --    is where the error is raised with the caller's own action in view — the
  --    layered posture D175(1) describes. The contract is 103's, unwrapped:
  --    P0001 + MESSAGE (guardrail named) + DETAIL (dot path) + HINT (family).
  PERFORM public.scoring_rules_validate(v_doc);

  -- 8. The fork row. `is_template` is NOT settable by this RPC — it is written
  --    FALSE as a literal, so the fork can never mint a world-readable
  --    template (D59's ownerless CHECK is the second gate; pinned §D).
  --    `owner_id` is the CALLER, per §12.25 ("owner_id = commissioner").
  INSERT INTO public.scoring_systems (name, description, owner_id, is_template, rules)
  VALUES (
    v_name || ' Custom',
    'Custom scoring forked from a template for this league (§7.3.3.1).',
    (SELECT auth.uid()),
    FALSE,
    v_doc
  )
  RETURNING id INTO v_new_id;

  -- 9. The repoint, in the SAME transaction (§7.3.3.1: "which
  --    leagues.scoring_system_id then references"). This write goes through
  --    WALL 3, which re-resolves the row and re-validates its document — so the
  --    league's reference is checked by the same guard that checks every raw
  --    write, not by this function's say-so.
  UPDATE public.leagues
  SET scoring_system_id = v_new_id,
      updated_at = NOW()
  WHERE id = p_league_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- CLAUDE.md: never let "nothing happened" mean "it worked". The row is held
  -- FOR UPDATE above, so 0 rows here is impossible — which is exactly why a
  -- silent 0 would be the most dangerous outcome this function could produce.
  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'scoring_fork_template: repointing league % at the new scoring system matched % rows, expected 1',
      p_league_id, v_rows
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.scoring_fork_template(UUID, UUID) FROM PUBLIC, anon;

COMMENT ON FUNCTION public.scoring_fork_template(UUID, UUID) IS
  'SE.5 / spec §7.3.3.1 entry point + §12.25: forks a template into the league''s own format-2 scoring row (owner_id = the calling commissioner, is_template = FALSE, name "<League> Custom") and repoints leagues.scoring_system_id at it, in one transaction. Commissioner-only (42501), league in setup/scheduled (§7.3 header). Idempotent by natural key: if the league already references a commissioner-owned non-template row whose rules deep-equal the document this call would build, that id is returned without inserting. A deliberate re-fork after edits creates a fresh row and orphans the old one (§12.25 orphan hygiene). D170: league context only — create_league (060) is untouched.';

-- ---------------------------------------------------------------------------
-- 3. `scoring_update_rules` — the editor's SAVE (§12.25 "every rules edit goes
--    through SECURITY DEFINER RPCs")
-- ---------------------------------------------------------------------------
--
-- **IT REFUSES UN-NORMALIZED DOCUMENTS RATHER THAN NORMALIZING THEM.**
-- Normalization is the client's save-time duty (`normalizeScoringDoc`, SE.7),
-- and guardrail 4 is already one of the five families `scoring_rules_validate`
-- checks — so this RPC does not need its own clause, it needs to not swallow
-- the one that exists. The reason it refuses rather than rewrites is
-- CLAUDE.md's rule directly: **a server that silently rewrites what it was sent
-- is the "nothing happened" class** — the commissioner's All-Positions switch
-- state is DERIVED from the document (§7.3.3.1), so a server-side strip would
-- change what the editor shows next load with no error and no diff. One
-- canonical byte-shape in the database.
--
-- **What the refusal does NOT do, corrected in place (R648):** an earlier form
-- of this sentence said it "names `normalizeScoringDoc` so the client knows
-- whose job it skipped". It does not — measured on both guardrail-4 arms across
-- MESSAGE, DETAIL and HINT, the string appears nowhere; every occurrence of it
-- in 103 and 105 is a `--` comment. The refusal carries `HINT = normal_form`
-- and a DETAIL dot path, which is what a route has to map. **103's messages are
-- deliberately NOT edited to make the sentence true:** they are byte-identical
-- mirrors of `validate-rules-doc.ts`, and `scoring-parity-db.test.ts` compares
-- only `REJECT|hint|path` under a family regex that would still match an
-- appended function name — so a divergence introduced there would go unpinned.
-- Trimming a banner is free; editing a mirrored literal is not.
--
-- Naturally idempotent: the same document written twice leaves the same row
-- state, so a retried save needs no key.
CREATE OR REPLACE FUNCTION public.scoring_update_rules(
  p_league_id UUID,
  p_rules     JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status      TEXT;
  v_current     UUID;
  v_is_template BOOLEAN;
  v_owner       UUID;
  v_rows        INT;
BEGIN
  -- 1. In-body authorization, 061's shape (no existence leak).
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'scoring_update_rules: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- 2. The league row, LOCKED FIRST (this file's lock order).
  SELECT l.status, l.scoring_system_id INTO v_status, v_current
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scoring_update_rules: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. The same §7.3/§7.3.3.1 window as the fork.
  IF v_status NOT IN ('setup', 'scheduled') THEN
    RAISE EXCEPTION
      'scoring_update_rules: league % is in % — scoring can only be edited while the league is in setup or scheduled; once the draft starts the rules are frozen into the league''s snapshot (§7.3 header, §7.3.3.1 lifecycle)',
      p_league_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'scoring_update_rules: league % references no scoring system — fork a template first (§7.3.3.1 entry point)',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT s.is_template, s.owner_id INTO v_is_template, v_owner
  FROM public.scoring_systems s WHERE s.id = v_current;

  -- 4. Templates are never edited (§7.3.3.1: "Templates themselves are never
  --    edited (the D59 ownerless CHECK stands)"). The message is the editor's
  --    instruction, not a diagnosis.
  IF v_is_template THEN
    RAISE EXCEPTION
      'scoring_update_rules: league % is on a shared template — fork first, templates are immutable (§7.3.3.1)',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. …and the row must be the league's OWN fork, not some other row a
  --    privileged write left in front of the league. Same predicate as the
  --    fork RPC's idempotency clause (see §2's banner for why it is
  --    "a commissioner of this league" and not `= auth.uid()`).
  IF v_owner IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id
      AND m.user_id = v_owner
      AND m.role IN ('commissioner', 'co_commissioner')
  ) THEN
    RAISE EXCEPTION
      'scoring_update_rules: league % references scoring system %, which is not this league''s own forked custom row — only a system forked by this league''s commissioner can be edited here (§7.3.3.1, §12.25)',
      p_league_id, v_current
      USING ERRCODE = 'P0001';
  END IF;

  -- 6. The five guardrail families, INCLUDING normal form (see this section's
  --    banner). Front door; wall 1 is the law behind it.
  PERFORM public.scoring_rules_validate(p_rules);

  UPDATE public.scoring_systems
  SET rules = p_rules,
      updated_at = NOW()
  WHERE id = v_current;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'scoring_update_rules: writing scoring system % matched % rows, expected 1',
      v_current, v_rows
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_current;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.scoring_update_rules(UUID, JSONB) FROM PUBLIC, anon;

COMMENT ON FUNCTION public.scoring_update_rules(UUID, JSONB) IS
  'SE.5 / spec §12.25 ("every rules edit goes through SECURITY DEFINER RPCs") + §7.3.3.1: writes the league''s own forked scoring document. Commissioner-only (42501), league in setup/scheduled, the referenced row must be a non-template row owned by a commissioner of this league. REFUSES un-normalized documents rather than normalizing them (guardrail 4 inside scoring_rules_validate): normalization is the client''s save-time duty, and a server that silently rewrites what it was sent would change the derived All-Positions switch state with no error — CLAUDE.md''s "nothing happened" class. Naturally idempotent.';

-- ---------------------------------------------------------------------------
-- 4. §12.25's additive member SELECT policy
-- ---------------------------------------------------------------------------
--
-- **COPIED BY POLICY NAME, NOT BY LINE NUMBER, AND THAT IS THE POINT.** The SE
-- breakdown's original instruction was "copy verbatim from spec:1429–1434".
-- Those lines today return `CREATE INDEX idx_team_managers_league …` and
-- `CREATE POLICY "Stints viewable by league members"` — a DIFFERENT TABLE'S RLS
-- policy, plausible and syntactically valid. The text below was taken by
-- searching the spec for
--     CREATE POLICY "League members read league scoring" ON scoring_systems FOR SELECT
-- and copying to its closing `));` — §4 rule 9's cite-by-symbol rule earning its
-- keep on the one instruction in that document that could have produced a
-- wrong-outcome bug out of correct-looking obedience.
--
-- What it grants and what it deliberately does not: **SELECT only.** Members
-- must see their league's custom rules pre-draft (post-draft they read the
-- frozen snapshot). It adds NO write path — 001's owner `FOR ALL` remains the
-- only client write route and wall 1 remains the law over it. The
-- unreferenced-orphan property falls out of the predicate rather than being
-- implemented: the moment the league repoints away, the same member's SELECT
-- stops matching, which is §12.25's whole orphan-hygiene argument for leaving
-- detached rows in place.
--
-- `l.deleted_at IS NULL` is the same predicate wall 1's arm (c) and wall 3 use,
-- so "in the league profile" and "readable by a league member" are the same
-- population by construction rather than by coincidence.
CREATE POLICY "League members read league scoring" ON scoring_systems FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM leagues l
    JOIN league_members lm ON lm.league_id = l.id AND lm.user_id = (SELECT auth.uid())
    WHERE l.scoring_system_id = scoring_systems.id AND l.deleted_at IS NULL
  ));

-- ---------------------------------------------------------------------------
-- 5. F147 — WALL 3's LOCK, DECIDED. `FOR NO KEY UPDATE` → `FOR SHARE`.
-- ---------------------------------------------------------------------------
--
-- 104 shipped `FOR NO KEY UPDATE` and said, in the body itself, that the choice
-- of strength was **SE.5's to make** once a write pattern existed that made it
-- measurable: "this is *a* sufficient lock, not the minimal one … choosing
-- between it and `FOR SHARE` is SE.5's, with the trade named". This is that
-- decision, and it is made on measurements taken with this task's own write
-- pattern in place. Every number below was measured on the local stack against
-- the 001–105 chain; the harness and its outputs are in the SE.5 PR.
--
--   (i) BOTH MODES ARE EQUALLY PROTECTIVE — and the harness discriminates.
--       The seam: T1 makes an UNREFERENCED flat row invalid (wall 1 passes; the
--       row is outside the profile) while T2 repoints a live league at it.
--       Run in BOTH orderings, with the F21 double-pay PAIR as the invalid
--       document (each key ALONE is legal, so the probe measures the defect and
--       not the names):
--                              order (a)   order (b)
--         no lock at all        BREACH      BREACH     ← the discriminating control
--         FOR SHARE             refused     refused
--         FOR NO KEY UPDATE     refused     refused
--       The no-lock row is why the other two lines mean anything: without it,
--       "refused" would be equally consistent with a race that never happened.
--       The protective DIRECTION is intact under the weaker mode — a racing
--       `scoring_systems` rules-UPDATE blocks on wall 3's lock for the holder's
--       full duration (2017.9 ms under FOR SHARE, 1973.7 ms under FOR NO KEY
--       UPDATE).
--
--   (ii) THE CONTENTION IS NOT THEORETICAL AND IT IS ON THE HOTTEST PATH.
--       Wall 3's highest-frequency writer is `create_league`, whose INSERT arm
--       locks the referenced row — and the product has exactly **six template
--       rows**, so every league creation in the app contends on one of six.
--
--       **THE AXIS IS CONCURRENCY.** For each level W, W concurrent workers
--       each issue K = 20 `create_league` calls against the SAME template row;
--       the figure is the mean ms/call at that level, elapsed taken INSIDE the
--       database (`clock_timestamp`) so process startup is not in the number.
--       Two independent reps per arm:
--
--         W                    1     2     4     6     8    10
--         FOR NO KEY UPDATE  0.60  0.93  1.50  1.95  2.46  2.96   (rep 2: 0.85 1.02 1.55 1.91 2.41 2.94)
--         FOR SHARE          0.85  0.70  0.66  0.74  0.82  0.81   (rep 2: 0.55 0.65 0.66 0.68 0.69 0.76)
--
--       **`FOR NO KEY UPDATE` rises monotonically in W; `FOR SHARE` is flat.**
--       That, and not any single ratio, is the claim: each additional concurrent
--       creator adds one full call to every other creator's wait, so the gap
--       grows without bound in W (2.6x at W=6, 3.7x at W=10). Within a level the
--       per-worker elapsed under the strong lock is a DRAIN CASCADE — at W=6,
--       [11 23 33 44 54 64] ms sorted — while `FOR SHARE` is flat
--       ([13 13 13 14 14 14]); that spread is a second observation and not six
--       samples of one quantity.
--
--       **AN EARLIER FORM OF THIS BLOCK WAS MISLABELLED, AND THE CORRECTION IS
--       RECORDED RATHER THAN QUIETLY APPLIED (R647).** It printed
--       `20/37/53/70/88/104 ms` beside `19/19/19/19/19/19` as though both were
--       six comparable per-worker figures at a fixed W=6. They were the sorted
--       drain cascade at one level, and presenting them that way invited — and
--       got — the reading that they were a concurrency sweep. Worse, its
--       headline "~5.5x at 6-way" was `104/19`: the LAST element of a cascade
--       over the flat value, which is not a like-for-like ratio. Nothing about
--       the decision changes; the evidence for it is now stated on the axis it
--       actually varies.
--
--       **AND THE 8-WAY RUN THAT WAS ONCE "DISCARDED AS NOISE" IS NOW
--       MEASURED.** An early fixed-W=8 attempt showed the opposite sign and was
--       dropped as `docker exec` startup noise — justified in outcome, sloppy
--       in process, because a discarded measurement needs a stated exclusion
--       rule *or* a re-measurement, and it had neither. It has the second now:
--       the sweep above reaches **W = 8 and W = 10 and the sign holds in both
--       reps**. That is the sentence that belongs here, not "discarded".
--
--   (iii) THE MULTIXACT TRADE, MEASURED RATHER THAN NAMED. `FOR SHARE` is a
--       SHARED lock, so concurrent holders of one row go through a multixact —
--       cheaper contention, more bookkeeping. That it really happens is not
--       assumed: with two sessions holding the template row through wall 3,
--         select pg_get_multixact_members(s.xmax::text::xid) …
--             →  1454180/sh, 1454182/sh
--       Two `sh` members on the row, so the bookkeeping is real. Its COST is
--       inside the 19 ms figure above — i.e. it does not show up at this shape
--       — and the risk it carries (multixact member-space pressure) needs
--       long-lived overlapping sharers, while every wall-3 writer in this repo
--       is a short RPC transaction that releases at commit. If a long-running
--       league-write transaction is ever introduced, this trade is the thing to
--       re-measure.
--
--   (iv) WHY THIS IS SAFE TO WEAKEN AT ALL, in one sentence: the seam needs
--       wall 3 to hold the referenced row STILL between reading its `rules` and
--       committing, and `FOR SHARE` conflicts with `FOR NO KEY UPDATE` — which
--       is what every UPDATE of that row takes — so no concurrent transaction
--       can change the document underneath it. What `FOR SHARE` additionally
--       permits is other wall-3 READERS of the same row, and two transactions
--       each attaching a league to the same VALID document is not a breach in
--       any ordering.
--
-- Authored as a `CREATE OR REPLACE` against 104's FILE body (D137; CLAUDE.md's
-- migration-073 rule), with the sweep run rather than inherited:
--     grep -rln "FUNCTION public.leagues_scoring_reference_guard" supabase/migrations/
--         →  104_scoring_write_walls.sql  (ONLY)
-- Everything below is 104's body verbatim except the lock keyword and this
-- comment block. **pgTAP 052 §A22 is a GOLDEN pin on these bodies' md5s and it
-- reds here BY DESIGN** — its wall-3 literal is re-derived in this PR from a
-- database built out of the migration FILES, never read off a stack that
-- happened to have the new body loaded, and §K1's anchored regex is retargeted
-- to `FOR SHARE` in the same commit. §K2's ban list is unchanged and still
-- passes: it bans `FOR UPDATE` and `FOR KEY SHARE`, and deliberately does not
-- name `FOR SHARE`, precisely so this decision would not be a fight with a
-- green cell (F147's own instruction).
CREATE OR REPLACE FUNCTION public.leagues_scoring_reference_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rules JSONB;
BEGIN
  -- A soft-deleted league references nothing live: §12.25's own predicate, and
  -- the state §E5 pins as legitimately writable. The guard re-engages the
  -- instant it is revived, which is door 3.
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.scoring_system_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- ── R626 + F147: the lock is the point of the statement, and its STRENGTH is
  -- SE.5's decision (D273), taken on the measurements recorded in 105 §5.
  -- Wall 1's arm (c) reads `public.leagues` and this reads
  -- `public.scoring_systems`; each holds the row IN FRONT of it, and before
  -- this lock neither held still the PREMISE it reads from the other's table.
  -- Under READ COMMITTED two concurrent transactions therefore each passed on
  -- a stale snapshot and committed a live league referencing the F21 document.
  --
  -- **THE ARGUMENT IS THE CONFLICT TABLE, NOT THE STRENGTH ORDERING.** This
  -- statement's premise is exactly *"the row I just resolved does not change
  -- under me."* `FOR SHARE` conflicts with `FOR NO KEY UPDATE` and with
  -- `FOR UPDATE` — which are precisely the locks an UPDATE and a DELETE of that
  -- row acquire — so every WRITER is excluded and the premise holds. What
  -- `FOR NO KEY UPDATE` additionally excluded was other wall-3 invocations,
  -- and those are READERS: they cannot invalidate each other's premise. That
  -- extra exclusion buys nothing and costs the serialization.
  --
  -- Measured both ways, in both orderings, against a no-lock control that
  -- BREACHES in both. The mode this replaces turned wall 3's highest-frequency
  -- writer (`create_league`, six template rows for the whole product) into a
  -- global serialization point — swept over CONCURRENCY (W workers x 20 calls
  -- on one template, mean ms/call, two reps), `FOR NO KEY UPDATE` rises
  -- monotonically 0.60 → 2.96 ms across W = 1..10 while `FOR SHARE` stays flat
  -- at ~0.7; full table in 105 §5(ii). The multixact that shared holders create
  -- is real (`pg_get_multixact_members` → two `sh` members) and its cost is
  -- inside that flat figure; it would need long-lived overlapping sharers to
  -- matter, and every wall-3 writer in this repo is a short RPC transaction.
  --
  -- **The deadlock question — and the absolute that used to stand here was too
  -- strong (R644).** Among PL/pgSQL lock sites there is one direction: wall 1
  -- takes NO lock at all (its arm (c) is a bare `EXISTS` with no `FOR` clause),
  -- and SE.5's two new RPCs take `leagues` FOR UPDATE before they touch
  -- `scoring_systems`, the order `update_league_settings` has always used — so
  -- the multi-statement write pattern F151 was filed for adds no cycle
  -- (measured: both orderings, repeated, zero 40P01, against an inverted-order
  -- control that deadlocks 8/8). **But PL/pgSQL is not the whole lock graph.**
  -- `leagues_scoring_system_id_fkey` is `ON DELETE NO ACTION`, so a DELETE of a
  -- referenced `scoring_systems` row locks the scoring row FIRST and then takes
  -- `FOR KEY SHARE` on the referencing `leagues` row — scoring_systems →
  -- leagues, the reverse direction. That RI machinery is not `prosrc` and no
  -- catalog pin can see it. **SE.5 is what makes it reachable**: before 105 a
  -- league could only reference an ownerless template, which `authenticated`
  -- cannot delete. It is deliberately left alone — the DELETE it needs is
  -- refused by the FK 100% of the time (23503), 40P01 is a transient retryable
  -- abort with no partial write, no DELETE route exists, and adding an
  -- ON DELETE RESTRICT-shaped guard would be new surface on a security wall to
  -- defend against a statement that already fails (CLAUDE.md's "no defending
  -- against personal problems"). Named so the comment stops asserting an
  -- absolute it cannot support. The PL/pgSQL premises are pinned in pgTAP
  -- 053 §G, because those are the ones a future edit would silently break.
  SELECT s.rules INTO v_rules
  FROM public.scoring_systems s
  WHERE s.id = NEW.scoring_system_id
  FOR SHARE;

  IF NOT FOUND THEN
    -- Loud, never a silent skip. The FK would refuse this at statement end
    -- anyway, so this arm is defense in depth in 059's exact idiom — but a
    -- guard whose "I could not find it" branch returns NEW is the failure mode
    -- CLAUDE.md names, and it would become reachable the moment the FK changed.
    RAISE EXCEPTION
      'league %: scoring system % does not exist — a league cannot reference a scoring document that is not there (§7.3.8)',
      NEW.id, NEW.scoring_system_id
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.scoring_rules_validate(v_rules);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.leagues_scoring_reference_guard() IS
  'SE.4b / R618: BEFORE INSERT OR UPDATE OF scoring_system_id, deleted_at on leagues — resolves the referenced scoring_systems row and PERFORMs scoring_rules_validate on its rules. Closes the five raw-table doors D169''s RPC-shaped remedy is not in the path of (repoint, INSERT-carrying-a-reference, un-delete revive, detach-rewrite-reattach incl. mid-draft). Fires on ASSIGNMENT (UPDATE OF), so an ordinary league edit pays nothing. SECURITY DEFINER as a structural precaution (R636): wall 1''s DEFINER-ness is measured, wall 3''s has no constructible twin today because leagues is SELECT-only, but the predicate is a SYSTEM fact and must not become role-dependent the day a leagues write policy is added. [SE.5 / D273 / F147] The reference is resolved FOR SHARE, not FOR NO KEY UPDATE: the weaker mode still conflicts with every UPDATE of the referenced row (so the TOCTOU seam stays closed in both orderings, measured against a no-lock control that breaches in both), while the stronger one made create_league serialise globally on six template rows: swept over CONCURRENCY (W workers x 20 calls, mean ms/call), FOR NO KEY UPDATE rises monotonically 0.60 -> 2.96 ms across W = 1..10 while FOR SHARE stays flat at ~0.7. The argument is the conflict table, not the strength ordering: FOR SHARE excludes every WRITER of the resolved row, and what the stronger mode additionally excluded was other wall-3 invocations, which are readers. See migration 105 §5.';

-- ---------------------------------------------------------------------------
-- 6. D169 — the 061 attach amendment
-- ---------------------------------------------------------------------------
--
-- `CREATE OR REPLACE` authored against **061's FILE body at chain HEAD**, the
-- sweep run at task time rather than inherited:
--     grep -rln "FUNCTION update_league_settings" supabase/migrations/
--         →  061_update_league_settings.sql   (ONLY, 001–104)
-- Contrast `draft_start_internal`, swept in the same §1 pass of the SE
-- breakdown, which moved 084 → 092 → 098 in seven days. Everything below is
-- 061's body byte-identical except **step 5**, which gains two arms:
--
--   (a) THE ATTACH ARM (D169). `p_scoring_system_id` may reference a template
--       (061's predicate, unchanged) **OR the league's own currently-referenced
--       row**. §7.3.8 v2.11: "the referenced row is a template OR the league's
--       own §7.3.3.1 forked custom row — nothing else". Any OTHER non-template
--       row — a personal research system, another league's fork — keeps the
--       refusal, with the message re-cited to §7.3.8/§7.3.3.1. It is an
--       IDENTITY test (`= v_current_scoring`), not an ownership test, because
--       that is exactly what D169 says the arm is: a re-attach of what is
--       already attached. Re-picking a plain template still detaches the fork —
--       the repoint IS the detach (§12.25 orphan hygiene).
--
--   (b) THE VALIDATION ARM (D169; spec §7.3.3.1(5)'s "editor save + settings
--       attach" MUST). Whenever `p_scoring_system_id` is passed, the referenced
--       row's `rules` are PERFORMed through `scoring_rules_validate` BEFORE the
--       write. **With D175's wall in place this is defense in depth, not the
--       guard** — but it stays, for three reasons D169 gives: it is the
--       user-facing error surface at the settings panel, it is cheap, and
--       **step 6's re-freeze never fires on a same-row re-attach**
--       (`v_new_scoring IS DISTINCT FROM v_current_scoring` is FALSE), so on
--       the one path arm (a) newly admits there would otherwise be no check in
--       this function at all.
--
-- Note what is NOT changed: `create_league` (060) keeps its template-only
-- check — D170, a league is always BORN on a template — and step 6's re-freeze
-- is untouched, so a format-2 document re-frozen there meets wall 2 exactly as
-- SE.4b's pins already establish (cited, not re-proved).
CREATE OR REPLACE FUNCTION update_league_settings(
  p_league_id UUID,
  p_team_count INTEGER,
  p_settings JSONB,
  p_roster_settings JSONB,
  p_scoring_system_id UUID,  -- NULL = keep the current reference
  -- Remaining §12.1 typed columns, explicit and mandatory (splitSettings is
  -- the authority — the service maps every TYPED_COLUMN_KEY to p_<key>
  -- mechanically, exactly as create_league does. D68/D70).
  p_format TEXT,
  p_regular_season_weeks INTEGER,
  p_playoff_teams INTEGER,
  p_playoff_start_week INTEGER,
  p_waiver_type TEXT,
  p_faab_budget INTEGER,
  p_trade_review TEXT,
  p_trade_deadline_week INTEGER,
  p_lineup_lock TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
  v_current_scoring UUID;
  v_current_faab_budget INTEGER;
  v_snapshot JSONB;
  v_new_scoring UUID;
  v_seated INTEGER;
  v_attach_rules JSONB;   -- D169 arm (b)
BEGIN
  -- 1. In-body authorization (§12.0/§8.3): commissioner or co-commissioner.
  --    A nonexistent league yields FALSE here too — no existence leak.
  IF NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'update_league_settings: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Row lock (serializes with concurrent PATCHes and status transitions);
  --    soft-deleted leagues are not found.
  SELECT l.status, l.scoring_system_id, l.faab_budget, l.scoring_rules_snapshot
    INTO v_status, v_current_scoring, v_current_faab_budget, v_snapshot
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_league_settings: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. §7.3 header status gate: structural settings are editable only in
  --    setup/scheduled; the post-draft path is an audited commissioner
  --    override (M6). The route maps this to a clear 409.
  IF v_status NOT IN ('setup', 'scheduled') THEN
    RAISE EXCEPTION
      'update_league_settings: league % is in % — settings are locked once the draft starts; post-draft changes are audited commissioner overrides (M6) (§7.3)',
      p_league_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  -- 3.5 F28 shrink floor: team_count >= franchises already seated (retired
  --     franchises don't count — their slot was freed, §7.2.1(b)). The
  --     league-row lock above serializes this count with 062's join/claim
  --     capacity checks.
  SELECT count(*)::int INTO v_seated
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.status <> 'retired';
  IF p_team_count < v_seated THEN
    RAISE EXCEPTION 'update_league_settings: team_count % is below the % franchises already seated in this league — remove a team first (§7.2 capacity; F28)',
      p_team_count, v_seated
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Q10 backstops (R75/D69 — same order + shape as create_league).
  IF p_playoff_start_week < 13 OR p_playoff_start_week > 16 THEN
    RAISE EXCEPTION 'update_league_settings: playoff_start_week must be between 13 and 16 (currently week %) (§7.3.1, Q10/v2.8.6)',
      p_playoff_start_week
      USING ERRCODE = 'P0001';
  END IF;
  IF p_playoff_start_week <> p_regular_season_weeks + 1 THEN
    RAISE EXCEPTION 'update_league_settings: playoff_start_week must be the week after the regular season ends — week % for a %-week regular season (currently week %) (§7.3.8, Q10/v2.8.6)',
      p_regular_season_weeks + 1, p_regular_season_weeks, p_playoff_start_week
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. ATTACHABLE SCOPE (§7.3.8 v2.11 via D169; was v1 templates-only). A
  --    template — 061's original predicate, both conjuncts, unchanged — OR the
  --    league's own currently-referenced row, which is what makes a settings
  --    PATCH that merely re-sends the current custom reference legal. Anything
  --    else (a personal research system, another league's fork) still refuses.
  IF p_scoring_system_id IS NOT NULL
     AND p_scoring_system_id IS DISTINCT FROM v_current_scoring
     AND NOT EXISTS (
    SELECT 1 FROM public.scoring_systems s
    WHERE s.id = p_scoring_system_id
      AND s.is_template = TRUE
      AND s.owner_id IS NULL
  ) THEN
    RAISE EXCEPTION 'update_league_settings: scoring_system_id must reference one of the scoring templates, or the league''s own forked custom scoring system — personal scoring systems and other leagues'' systems cannot be attached (§7.3.8 v2.11, §7.3.3.1)'
      USING ERRCODE = 'P0001';
  END IF;

  -- 5b. D169's ATTACH-VALIDATION arm (spec §7.3.3.1(5): "the server write path
  --     (editor save + settings attach) MUST reject an invalid doc"). Defense
  --     in depth over D175's wall, and the ONLY check in this function on a
  --     same-row re-attach, because step 6's re-freeze does not fire there.
  IF p_scoring_system_id IS NOT NULL THEN
    SELECT s.rules INTO v_attach_rules
    FROM public.scoring_systems s WHERE s.id = p_scoring_system_id;
    -- SHADOWED, NOT UNREACHABLE — and it stays (R649). Step 5 above already
    -- refuses a nonexistent id that differs from the current reference, and the
    -- FK refuses the equal-to-current arm, so no probe reaches this RAISE
    -- today. But step 5's `NOT EXISTS` and this `SELECT … INTO` are SEPARATE
    -- STATEMENTS over separate snapshots under read committed, and step 5 takes
    -- no tuple lock — the same unlocked cross-table premise wall 3 bought a row
    -- lock for (R626). A template deleted and committed between the two lands
    -- here. Deleting it would also make the two walls disagree on an idiom 104
    -- carries byte-identically, and would downgrade an accurate message into
    -- `scoring_rules_validate(NULL)`'s "must be a JSON object; got nothing" —
    -- loud for the wrong reason, which is precisely what CLAUDE.md's
    -- assert-the-reason-for-emptiness rule points away from.
    IF NOT FOUND THEN
      RAISE EXCEPTION 'update_league_settings: scoring system % does not exist (§7.3.8)',
        p_scoring_system_id
        USING ERRCODE = 'P0001';
    END IF;
    -- No catch, no wrap: 103's P0001 + MESSAGE/DETAIL/HINT propagates, which is
    -- the contract the settings route turns into a per-field error.
    PERFORM public.scoring_rules_validate(v_attach_rules);
  END IF;

  v_new_scoring := COALESCE(p_scoring_system_id, v_current_scoring);

  -- 6. §7.3.3 pre-draft re-freeze: a scoring change with an existing snapshot
  --    refreshes it from the NEW template's rules; a NULL snapshot stays NULL.
  IF v_new_scoring IS DISTINCT FROM v_current_scoring AND v_snapshot IS NOT NULL THEN
    SELECT s.rules INTO v_snapshot
    FROM public.scoring_systems s
    WHERE s.id = v_new_scoring;
  END IF;

  -- 7. The atomic write: every §12.1 typed column + blob as passed, and
  --    max_teams = p_team_count IN THE SAME STATEMENT (§12.1 NOTE — this is
  --    the sync rule's second writer, after create_league).
  UPDATE public.leagues
  SET format = p_format,
      team_count = p_team_count,
      max_teams = p_team_count,
      regular_season_weeks = p_regular_season_weeks,
      playoff_teams = p_playoff_teams,
      playoff_start_week = p_playoff_start_week,
      waiver_type = p_waiver_type,
      faab_budget = p_faab_budget,
      trade_review = p_trade_review,
      trade_deadline_week = p_trade_deadline_week,
      lineup_lock = p_lineup_lock,
      roster_settings = p_roster_settings,
      settings = p_settings,
      scoring_system_id = v_new_scoring,
      scoring_rules_snapshot = v_snapshot,
      updated_at = NOW()
  WHERE id = p_league_id;

  -- 8. §12.2 invariant maintenance: pre-draft (guaranteed by the status gate),
  --    faab_balance carries no history — re-seed every seat when the budget
  --    changes so all balances match the create/join/claim seeding (D70).
  IF p_faab_budget IS DISTINCT FROM v_current_faab_budget THEN
    UPDATE public.league_members
    SET faab_balance = p_faab_budget
    WHERE league_id = p_league_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_league_settings(
  UUID, INTEGER, JSONB, JSONB, UUID,
  TEXT, INTEGER, INTEGER, INTEGER, TEXT, INTEGER, TEXT, INTEGER, TEXT
) FROM PUBLIC, anon;

COMMENT ON FUNCTION update_league_settings(
  UUID, INTEGER, JSONB, JSONB, UUID,
  TEXT, INTEGER, INTEGER, INTEGER, TEXT, INTEGER, TEXT, INTEGER, TEXT
) IS
  'L.A1.13 settings writer, amended by SE.5/D169 (migration 105). Step 5 now admits a template OR the league''s OWN currently-referenced row (§7.3.8 v2.11: "a template OR the league''s own §7.3.3.1 forked custom row — nothing else"); any other non-template row still refuses. Step 5b PERFORMs scoring_rules_validate on the referenced row whenever p_scoring_system_id is passed — defense in depth over migration 104''s walls, and the only check on a same-row re-attach, because step 6''s re-freeze does not fire when the reference is unchanged. create_league (060) is deliberately untouched: a league is always born on a template (D170).';
