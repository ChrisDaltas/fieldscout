-- ============================================================================
-- 104 — the THREE write walls (SE.4b): an invalid league scoring document is
--       UNREPRESENTABLE. `scoring_systems_rules_guard()` on `scoring_systems`
--       (D175 — Chris's 2026-08-18 ruling, verbatim: "creating an invalid
--       scoring system should not be possible") + `leagues_scoring_rules_valid()`
--       on `leagues.scoring_rules_snapshot` (D168(2)) + `leagues_scoring_
--       reference_guard()` on `leagues.scoring_system_id` / `deleted_at`
--       (R618 — the five raw-table doors no RPC fronts), plus the FK index the
--       first wall's reference arm and §12.25's member policy both need.
--
--       **"UNREPRESENTABLE" is scoped, and the scope was measured (R626):**
--       sequentially, for every role, every path and every replication mode.
--       Concurrency is carried by wall 3's `FOR NO KEY UPDATE`; before that
--       lock two interleaved privileged transactions could each pass on a
--       stale snapshot and commit a live league in front of an invalid
--       document. No application role could reach it then and none can now —
--       `public.leagues` carries one SELECT-only policy — but the sentence was
--       broader than the code, which is the thing this lane does not do.
--       tasks-SE §5 SE.4b; spec §7.3.3.1(5) + §12.25 ("the snapshot-time
--       re-validation in `draft_start` is the integrity backstop") + §7.3.8's
--       v2.11 bullet ("Exactly one scoring system referenced and readable by
--       the league…"); PROGRESS D272.
-- ============================================================================
--
-- WHAT THIS IS, AND WHY IT IS TWO TRIGGERS AND NOT AN RPC EDIT.
--
-- Migration 103 (SE.4) built `scoring_rules_validate(jsonb)` — the five
-- §7.3.3.1 guardrail families plus the (c) residuals, mirrored family-for-
-- family against the TS validator and measured over 668 documents on three
-- axes. It is a function, and **a function nothing calls is not a wall**
-- (F21's own row says exactly that). This migration is what calls it, at the
-- two places a document can enter the system:
--
--   WALL 1 — `scoring_systems`. D175 moves the guard INTO the table at the
--     write, so no path can create an invalid league document: not the editor
--     RPCs (SE.5), not the settings attach, not 001:623's legacy
--     `"Users can manage own scoring systems" FOR ALL` policy — the §12.25
--     bypass that motivated a backstop in the first place — and not
--     `service_role`, because a trigger fires for every role (the D43
--     argument; triggers ignore BYPASSRLS).
--
--     **"EVERY ROLE" IS NOT "EVERY MODE", AND THE FIRST CUT OF THIS BANNER
--     SAID SO TOO BROADLY (R616).** A trigger created with the default
--     `tgenabled = 'O'` is skipped WHOLESALE under
--     `session_replication_role = 'replica'`, and `postgres` can set that GUC
--     — it is the mode `pg_restore`, `supabase db push` and logical apply run
--     in. Measured, before the fix: an invalid `is_template` row COMMITTED in
--     replica mode and was read back from another session and over anon
--     PostgREST. Both walls, both operations. It is refused to
--     `service_role`, `authenticated` and `anon` (`permission denied to set
--     parameter`), so it is a privileged door — but it is precisely the door a
--     RESTORE repopulates the guarded columns through, which is the one place
--     it would be absurd to leave open. Every trigger here is therefore
--     `ENABLE ALWAYS`, pinned structurally (§A16) and behaviourally (§F12).
--
--   WALL 2 — `leagues.scoring_rules_snapshot`. D168(2) chose a column-level
--     trigger over a `CREATE OR REPLACE` of `draft_start_internal`, and the
--     seven days after that decision proved it: `draft_start_internal` was
--     replaced TWICE by lanes that had never read the SE breakdown
--     (`092_auction_reserve_toggle.sql:395`, `098_manual_nomination_order.sql:164`),
--     and the `snapshot_league_scoring_internal` PERFORM survived both only
--     because it was already in the body they copied. A guard written into
--     that body on 2026-08-19 would have needed two unrelated authors to carry
--     it forward blind — which is CLAUDE.md's migration-073 lesson, where a
--     `CREATE OR REPLACE` authored against the deployed body silently reverted
--     049/050/051's username guards.
--
--     **THE CLAIM THIS PARAGRAPH USED TO END WITH — "a guard on the column
--     needs no author to remember it" — IS TOO STRONG, AND MEASURING IT IS
--     WHAT NARROWED IT (R635).** Postgres fires BEFORE ROW triggers in NAME
--     order, and 059's `trg_leagues_snapshot_guard` already sorts AFTER
--     `trg_leagues_scoring_rules_valid`:
--         trg_leagues_scoring_reference_guard  <  trg_leagues_scoring_rules_valid
--                                              <  trg_leagues_snapshot_guard
--     So a body edit to 059's function that assigned `NEW.scoring_rules_snapshot`
--     would overwrite the value AFTER wall 2 validated it, the invalid document
--     would COMMIT, the trigger catalog would be byte-identical, and every one
--     of the 53 pgTAP files and 9 client cells would stay green. It needs DDL,
--     so it is not a security hole — all four tamper vectors are refused to
--     `service_role` and `authenticated` — but it is the same migration-073
--     exposure one function over, which is precisely the exposure D168(2) chose
--     this form to avoid. **The honest form of the claim: a guard on the column
--     needs no author to remember it, PROVIDED no BEFORE trigger sorting after
--     it assigns the column.** That proviso is not left to prose: pgTAP 052 §A22
--     pins the BEFORE ROW trigger SET on both tables by name AND by the md5 of
--     each trigger function's `prosrc`, so a new later-sorting trigger and a
--     body edit to an existing one each go red.
--
-- ── THE LEAGUE PROFILE (D175(2)) — WHY THE FIRST WALL IS NOT "VALIDATE
--    EVERYTHING" ──────────────────────────────────────────────────────────
-- `scoring_systems` holds two populations. The league world speaks §7.3.3.1's
-- registry namespace (D33's one canonical namespace). The legacy RESEARCH
-- world — `src/lib/scoring/default.ts`'s flat docs, `is_system_default` rows,
-- a user's personal research system — speaks the legacy column-name namespace,
-- and the strict league validator would wrongly refuse it. So "valid" is
-- context-dependent, and the trigger validates exactly the **league profile**:
--
--   (a) `is_template = TRUE`     — the canonical format-1 docs (all 6 pass;
--                                  the census is §1b's apply-time gate and
--                                  pgTAP 052 §B3b/§B4)
--   (b) `rules ? 'format'`       — a format-2 envelope is definitionally a
--                                  §7.3.3.1 league document: `format` is not a
--                                  registry key and no legacy doc carries it
--   (c) live-league-referenced   — `EXISTS (SELECT 1 FROM public.leagues
--                                  WHERE scoring_system_id = <id>
--                                    AND deleted_at IS NULL)`, §12.25's own
--                                  predicate; this arm closes the one hole a
--                                  format-only profile leaves — a fork row
--                                  REWRITTEN as an invalid flat map while it is
--                                  still attached to a league
--
-- A research row matches none of the three and stays writable under its own
-- rules — no legacy-row migration, no retroactive invalidation. Every door
-- INTO the profile validates on the way in: the fork INSERT is format 2 (arm
-- b), an editor save is format 2 AND referenced, and the settings attach
-- carries D169's own `PERFORM scoring_rules_validate` (SE.5).
--
-- **THE SECOND REFERENCE PATH IS DELIBERATELY NOT MATCHED (D175(6)).** MP.4
-- gave standalone mocks their own scoring reference at
-- `drafts.config->>'scoring_system_id'` (`src/components/draft/mock-launch-ops.ts`),
-- which arm (c)'s `FROM public.leagues` cannot see. That is the correct
-- outcome and it is stated here so the silence does not read as an oversight:
-- standalone mocks pick from the six shipped templates (which match arm (a)
-- anyway), the reference is deliberately unvalidated server-side (tasks-MP §4
-- rule 10 — `src/lib/leagues/api/draft-service.ts` records the reasoning; the
-- SHAPE is checked with `z.uuid()`), and a mock scores nothing that persists.
-- pgTAP 052 §E pins the D33 protection at this second reference path too.
--
-- ── FORM: WALL 1 IS `SECURITY DEFINER` AND WALL 2 IS NOT — MEASURED, NOT
--    COPIED (§4.1) ────────────────────────────────────────────────────────
-- Wall 2 reads no table (it looks only at NEW), so it is a plain function in
-- 059's exact shape — `leagues_snapshot_guard`'s sibling, additive beside it,
-- with 059 not edited (D137's no-in-place posture).
--
-- Wall 1 reads `public.leagues`, and **`leagues` has RLS** — 052 replaced
-- 001's policy with `USING (is_league_member(id) OR owner_id = auth.uid())`.
-- A plain (INVOKER) trigger function's `EXISTS` is therefore RLS-filtered, so
-- arm (c) would be **role-dependent**: invisible to exactly the writer it
-- exists to stop (an owner who is not a member of the league referencing their
-- row), and silently empty rather than loudly wrong. D175(2) states the arm as
-- a SYSTEM fact — `EXISTS (SELECT 1 FROM leagues WHERE scoring_system_id =
-- NEW.id AND deleted_at IS NULL)`, no membership join — so the function must
-- see the whole table. Hence `SECURITY DEFINER`, the 018/025/026/028
-- guard-trigger precedent, with the newer strict `SET search_path = ''` and
-- every reference schema-qualified.
--
-- §4.1's DEFINER triad is discharged, including the part that does not apply
-- and why: `search_path = ''` ✓ · REVOKE ✓ · **in-body authorization has no
-- subject and no callable surface** — a `RETURNS TRIGGER` function cannot be
-- invoked outside a trigger context at all (`SELECT
-- public.scoring_systems_rules_guard()` → `0A000`, "trigger functions can only
-- be called as triggers"; measured, and pinned in pgTAP 052 §A so the
-- exemption is falsifiable rather than asserted). The REVOKEs are emitted
-- anyway, the 038/059/103 precedent.
--
-- ── WHEN WALL 1 FIRES: "IN THE PROFILE" BEATS "RULES CHANGED" ─────────────
-- D175(1) says the trigger validates "whenever the row is in the league
-- profile". tasks-SE §5 SE.4b(1) adds "and `rules` is new or changed" as the
-- cheap case. Implemented as the UNION of both readings — skip ONLY when the
-- row was ALREADY in the profile carrying the IDENTICAL document, because that
-- document passed this wall on the write that put it there (D175(4)'s
-- never-retroactively-invalidate guarantee).
--
-- The difference is not theoretical. Under the narrow reading an
-- `UPDATE scoring_systems SET is_template = TRUE, owner_id = NULL` on a
-- research row **mints a world-readable, league-attachable template carrying a
-- legacy flat document without ever touching `rules`** — an in-profile row the
-- wall never saw. `authenticated` cannot do it (058's
-- `scoring_systems_template_ownerless` CHECK forces `owner_id = NULL`, which
-- 001:623's `FOR ALL USING (auth.uid() = owner_id)` re-uses as its WITH CHECK
-- and refuses), but `service_role` can — and D175's whole point is that the
-- wall binds every role. The profile-ENTRY arm is pinned at pgTAP 052 §E6
-- (one step) and §E5e (the TWO-step escape R615 measured over PostgREST), and
-- both are break-probe targets.
--
-- ── THE ERROR CONTRACT IS PRESERVED, NOT RE-RAISED ────────────────────────
-- Neither wall catches, wraps, or re-words anything: each `PERFORM`s
-- `scoring_rules_validate` and lets it raise. SE.5's RPCs and SE.6's routes
-- turn `P0001` + MESSAGE (guardrail named) + DETAIL (dot path) + HINT (family
-- code) into a field-level error, and a wall that raised its own shape would
-- break both tasks downstream. pgTAP 052 asserts all three axes THROUGH the
-- triggers, not just "it threw".
--
-- ── INDEX (SE.4b(3), plan §8.1's "indexes for every FK used in
--    policies/joins") ─────────────────────────────────────────────────────
-- `leagues.scoring_system_id` has had no index since 001. Re-measured at task
-- time rather than inherited (§4 rule 9):
--     grep -rn "idx_leagues_scoring\|INDEX.*scoring_system_id" \
--         supabase/migrations/*.sql        →  (no output, across 001–103)
-- Wall 1's arm (c) probes `leagues` by that column on every in-profile write,
-- and §12.25's member SELECT policy (SE.5) will scan it on every read.
--
-- Migration checklist (§8.1 / §4.4):
--   • Additive-first: two new functions, two new triggers, one new index. No
--     table, column, policy or existing function body is touched. 059's
--     `trg_leagues_snapshot_guard` is left exactly as it is (D137).
--   • RLS: unchanged — no policy added, altered or dropped. **R6 waiver:** no
--     staging clone exists; the rehearsal evidence is this migration applied
--     forward over the 001–103 chain plus the full pgTAP + vitest suites,
--     shown in the SE.4b PR. **D38 waiver:** no new table ⇒ no realtime work
--     and no new RLS/policy suite owed.
--   • Indexes: `idx_leagues_scoring_system` added with `IF NOT EXISTS`.
--   • Grants: no per-object GRANT (D18/D23 — 037's default ACLs). Explicit
--     REVOKE FROM PUBLIC, anon on both trigger functions, pinned in pgTAP 052
--     §A. `scoring_rules_validate`'s own `authenticated`/`service_role`
--     EXECUTE (103) is load-bearing for wall 2, which runs as the writing
--     role — pinned there and re-pinned here.
--   • Typegen: **not re-run, and that is a measured claim, not a habit.**
--     PostgREST exposes functions, not triggers; `RETURNS TRIGGER` functions
--     are never in the generated `Functions` surface, and no table, column or
--     view changes. `npx supabase gen types` was run anyway and the output
--     diffed against the committed `src/types/database.ts` — 0 lines — with
--     the alias-block md5 identical either side; the numbers are in the PR.
--   • Nothing above is `CREATE OR REPLACE`'d, and that was MEASURED (D137's
--     head rule; heads have moved under this lane before — D168's own
--     amendment records `draft_start_internal` going 084 → 092 → 098 in seven
--     days). With the commit pinned so the command survives this file:
--         git grep -c "scoring_systems_rules_guard\|leagues_scoring_rules_valid" \
--             8133431 -- supabase/migrations/            →  0 files
--         grep -rn "leagues_snapshot_guard" supabase/migrations/*.sql
--             →  059 only (defined once, never replaced)
--     Both new names are new; there is no head body to author against, and
--     059's guard is not being replaced but stood beside.
--   • Chain heads measured at task time, never inherited (D166/D161):
--         ls supabase/migrations/ | tail -1  →  103_scoring_rules_validate.sql
--         ls supabase/tests/      | tail -1  →  051_scoring_rules_validate.sql
--     ⇒ this migration is 104 and its pgTAP is 052.
--   • Prod-safe, and the claim is now MEASURED rather than asserted: §1b
--     pushes every existing league-profile `scoring_systems.rules` AND every
--     existing non-NULL `leagues.scoring_rules_snapshot` through the validator
--     before a single trigger is created, NOTICEs both population sizes, and
--     REFUSES TO APPLY if either carries a document the walls would reject.
--     The first cut of this banner claimed the walls land on "tables whose
--     existing rows all pass"; that was true of one table and **unmeasured for
--     the other** (R625.2) — and the `leagues` population is exactly the one
--     that turns `draft_start`'s re-freeze into a silent `drafting` breach
--     (R617). Three new functions, three new triggers, one index on a
--     0-row-to-small table.

-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The FK index wall 1's reference arm and §12.25's policy both need
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_leagues_scoring_system
  ON leagues (scoring_system_id);

COMMENT ON INDEX idx_leagues_scoring_system IS
  'SE.4b (104): leagues.scoring_system_id had no index since 001. Probed by scoring_systems_rules_guard()''s live-league-referenced arm (D175(2)) on every in-profile scoring_systems write, and scanned by §12.25''s "League members read league scoring" SELECT policy (SE.5). Plan §8.1: an index for every FK used in policies/joins.';

-- ---------------------------------------------------------------------------
-- 1b. THE CENSUS, AS A PRECONDITION OF APPLYING AT ALL (D175(4); R617/R625.2)
-- ---------------------------------------------------------------------------
--
-- D175(4) says existing rows are never retroactively invalidated, and the
-- first draft of this banner claimed the walls land on "tables whose existing
-- rows all pass". That was true of ONE table and unmeasured for the other:
-- nothing anywhere pushed an existing `leagues.scoring_rules_snapshot`
-- through the validator, and that is exactly the population that turns
-- `draft_start`'s re-freeze into a silent `drafting` breach (R617).
--
-- So the census lives HERE rather than in a test, and it is a GATE: if either
-- population carries a document the walls would refuse, this migration
-- refuses to apply. A test asserting "0 failures" over a table that happens
-- to be empty certifies nothing; a precondition that raises makes the banner's
-- sentence TRUE BY CONSTRUCTION wherever the migration succeeded.
--
-- **The population is stated, not dressed up.** Both counts are NOTICEd on
-- every apply, so "we found nothing" is always distinguishable from "we looked
-- at nothing" (CLAUDE.md: never let "nothing happened" mean "it worked"). On
-- this chain and in CI the NOTICE reads **`league-profile scoring_systems rows
-- = 6, failing = 0; non-NULL leagues.scoring_rules_snapshot rows = 0, failing
-- = 0`** — the six are 058's templates, and the snapshot population is the
-- empty one, because `supabase/seed.sql` seeds no league at all. (R632: an
-- earlier sentence here said "both populations are 0 rows", which this
-- migration's own NOTICE contradicts on every apply. The `scoring_systems`
-- half is therefore real local coverage; the `leagues` half is a gate for real
-- deployments and is honestly vacuous here.) Its reachability is proved by a probe that
-- forges an invalid row and shows the block refuse (recorded in the PR).
--
-- **The backfill decision, made explicitly rather than left implicit:** there
-- is NO automatic backfill, because a repair would have to invent the
-- document the commissioner meant and §7.3.3.1 has no defensible default. If
-- this gate ever fires, the rows are named in the error and a human decides.
-- That is the honest form: a wall that only guards new writes would leave old
-- rows invalid forever, and this converts that silence into a refusal to
-- deploy.
DO $census$
DECLARE
  v_profile_total INT;
  v_profile_bad   INT := 0;
  v_snap_total    INT;
  v_snap_bad      INT := 0;
  v_archived_total INT;
  v_archived_bad   INT := 0;
  v_bad_ids       TEXT := '';
  r               RECORD;
BEGIN
  SELECT count(*) INTO v_profile_total
  FROM public.scoring_systems s
  WHERE s.is_template
     OR s.rules ? 'format'
     OR EXISTS (SELECT 1 FROM public.leagues l
                 WHERE l.scoring_system_id = s.id AND l.deleted_at IS NULL);

  FOR r IN
    SELECT s.id, s.rules
    FROM public.scoring_systems s
    WHERE s.is_template
       OR s.rules ? 'format'
       OR EXISTS (SELECT 1 FROM public.leagues l
                   WHERE l.scoring_system_id = s.id AND l.deleted_at IS NULL)
  LOOP
    BEGIN
      PERFORM public.scoring_rules_validate(r.rules);
    EXCEPTION WHEN OTHERS THEN
      v_profile_bad := v_profile_bad + 1;
      v_bad_ids := v_bad_ids || ' scoring_systems.' || r.id::TEXT;
    END;
  END LOOP;

  SELECT count(*) INTO v_snap_total
  FROM public.leagues l WHERE l.scoring_rules_snapshot IS NOT NULL;

  FOR r IN
    SELECT l.id, l.scoring_rules_snapshot AS rules
    FROM public.leagues l WHERE l.scoring_rules_snapshot IS NOT NULL
  LOOP
    BEGIN
      PERFORM public.scoring_rules_validate(r.rules);
    EXCEPTION WHEN OTHERS THEN
      v_snap_bad := v_snap_bad + 1;
      v_bad_ids := v_bad_ids || ' leagues.' || r.id::TEXT;
    END;
  END LOOP;

  -- ── R637: THE POPULATION BOTH LOOPS ABOVE MISS, REPORTED BUT NOT GATED.
  -- Both reference arms are scoped `l.deleted_at IS NULL`, because that is the
  -- profile's own predicate — so a scoring system referenced ONLY by
  -- soft-deleted leagues is censused nowhere. It is also exactly the document
  -- wall 3 validates on an un-delete (door 3). Counted and NOTICEd so the
  -- number is never silent, and deliberately NOT part of the gate: those rows
  -- are outside the profile today, nothing scores from them, and refusing to
  -- DEPLOY over a document attached to an archived league would be a worse
  -- trade than refusing the REVIVE, which is what wall 3 already does, loudly.
  SELECT count(*) INTO v_archived_total
  FROM public.scoring_systems s
  WHERE NOT (s.is_template OR s.rules ? 'format')
    AND EXISTS (SELECT 1 FROM public.leagues l
                 WHERE l.scoring_system_id = s.id AND l.deleted_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM public.leagues l
                     WHERE l.scoring_system_id = s.id AND l.deleted_at IS NULL);

  FOR r IN
    SELECT s.id, s.rules
    FROM public.scoring_systems s
    WHERE NOT (s.is_template OR s.rules ? 'format')
      AND EXISTS (SELECT 1 FROM public.leagues l
                   WHERE l.scoring_system_id = s.id AND l.deleted_at IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM public.leagues l
                       WHERE l.scoring_system_id = s.id AND l.deleted_at IS NULL)
  LOOP
    BEGIN
      PERFORM public.scoring_rules_validate(r.rules);
    EXCEPTION WHEN OTHERS THEN
      v_archived_bad := v_archived_bad + 1;
    END;
  END LOOP;

  RAISE NOTICE
    '104 census (D175(4)): league-profile scoring_systems rows = %, failing = %; non-NULL leagues.scoring_rules_snapshot rows = %, failing = %; archived-only references (reported, NOT gated — wall 3 refuses these at un-delete) = %, failing = %',
    v_profile_total, v_profile_bad, v_snap_total, v_snap_bad,
    v_archived_total, v_archived_bad;

  IF v_profile_bad > 0 OR v_snap_bad > 0 THEN
    RAISE EXCEPTION
      '104 refuses to apply: % existing league-profile scoring document(s) and % existing league snapshot(s) would be refused by the walls this migration installs (§7.3.3.1). Offending rows:%. There is no automatic backfill — a repair would have to invent the intended document. Fix or detach these rows, then re-run.',
      v_profile_bad, v_snap_bad, v_bad_ids
      USING ERRCODE = 'P0001';
  END IF;
END;
$census$;

-- ---------------------------------------------------------------------------
-- 2. WALL 1 — the table wall (D175). An invalid LEAGUE scoring document is
--    unrepresentable in `scoring_systems`, for every role, every path and —
--    since R616 — every replication mode. **Sequentially.** Concurrency is
--    wall 3's `FOR NO KEY UPDATE` (R626); before that lock two interleaved
--    privileged transactions could each pass on a stale snapshot.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scoring_systems_rules_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new_in_profile BOOLEAN;
BEGIN
  -- ── Is the NEW row in the league profile? (D175(2), the three arms) ─────
  v_new_in_profile :=
       COALESCE(NEW.is_template, FALSE)
    OR (NEW.rules ? 'format')
    OR EXISTS (
         SELECT 1 FROM public.leagues l
         WHERE l.scoring_system_id = NEW.id
           AND l.deleted_at IS NULL
       );

  -- Outside the profile: the D33 research world. Legacy column-name docs are
  -- valid under their OWN rules and the league validator has no jurisdiction.
  -- This is also the arm that leaves a mock-only reference
  -- (`drafts.config->>'scoring_system_id'`, D175(6)) writable — deliberately.
  IF NOT v_new_in_profile THEN
    RETURN NEW;
  END IF;

  -- Already in the profile, carrying the IDENTICAL document: it passed this
  -- wall on the write that put it there, and D175(4) says existing rows are
  -- never retroactively invalidated. Anything else — an INSERT, a changed
  -- `rules`, or a row ENTERING the profile (e.g. an `is_template` flip that
  -- never touches `rules`) — is validated.
  IF TG_OP = 'UPDATE'
     AND NEW.rules IS NOT DISTINCT FROM OLD.rules
     -- ── R615: THE SKIP MUST NOT APPLY TO A ROW *ENTERING* AN ARM ──────────
     -- Without these two conjuncts the short-circuit is a two-step escape,
     -- and it was measured over PostgREST: put a private invalid row into the
     -- profile via arm (c) (a `leagues` write, which fires nothing here), then
     -- `PATCH {is_template: true, owner_id: null}` — `rules` untouched, OLD
     -- already in profile, so the guard skipped it and returned 200. The row
     -- is then a world-readable template (058's "Templates viewable by
     -- everyone") that an ORDINARY commissioner attaches through
     -- `create_league` / `update_league_settings`. §E6 pinned only the
     -- ONE-step flip, which the guard did refuse. One conjunct per arm whose
     -- membership can change without `rules` changing: `is_template` is arm
     -- (a); `id` is the SUBJECT the other two arms are read against, so a
     -- fresh-id write re-enters the predicate under a different identity.
     -- (R630 corrects an earlier sentence here that called `id` "arm (c)'s
     -- subject": arm (c) can never be the subject of a PK change — all five
     -- inbound FKs are `condeferrable = f, confupdtype = 'a'`, so a referenced
     -- row's id cannot move. The conjunct earns its place on arm (a): forge an
     -- invalid template and a fresh-id change is refused P0001 with it and
     -- succeeds without it — measured by three reviewers.)
     AND NEW.is_template IS NOT DISTINCT FROM OLD.is_template
     AND NEW.id IS NOT DISTINCT FROM OLD.id
  THEN
    -- ── R629: THE OLD-SIDE PROFILE DISJUNCTION USED TO BE RE-EVALUATED HERE,
    -- AND IT WAS A TAUTOLOGY. Deleted rather than pinned, because a clause
    -- that cannot change an outcome cannot be given a killing cell and would
    -- have stood forever as three unfalsifiable lines. The proof is two
    -- sentences: control has already returned unless NEW is in the profile,
    -- and the three conjuncts above hold `rules`, `is_template` and `id`
    -- equal — which are exactly the three inputs the profile predicate reads.
    -- So OLD-in-profile ≡ NEW-in-profile ≡ TRUE here, always. Measured:
    -- deleting the whole block leaves 052 at 85/85 and that green is CORRECT,
    -- while deleting any single disjunct from it changed behaviour and red
    -- nothing — the signature of a clause whose arms are unreachable.
    RETURN NEW;
  END IF;

  -- No catch, no wrap, no re-word: P0001 + MESSAGE/DETAIL/HINT propagates
  -- exactly as 103 raised it, which is the contract SE.5/SE.6 turn into a
  -- field path.
  PERFORM public.scoring_rules_validate(NEW.rules);

  RETURN NEW;
END;
$$;

-- R620: the REVOKE goes all the way. `authenticated` holds TEMP on the
-- database, so with EXECUTE it can `CREATE TRIGGER` this DEFINER function on
-- a temp table of its own and use it as a one-bit ORACLE over RLS-protected
-- `public.leagues` (measured in review: landed-rows 0 for a referenced uuid,
-- 1 for an unreferenced one). Postgres checks EXECUTE at CREATE TRIGGER time,
-- not at fire time, so revoking it costs the walls nothing — measured both
-- ways. `scoring_rules_validate`'s OWN grants are deliberately untouched:
-- wall 2 is INVOKER and needs them (§A11/§F8).
REVOKE EXECUTE ON FUNCTION public.scoring_systems_rules_guard()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.scoring_systems_rules_guard() IS
  'SE.4b / D175 (Chris, 2026-08-18: "creating an invalid scoring system should not be possible"): BEFORE INSERT OR UPDATE on scoring_systems, PERFORMs scoring_rules_validate(NEW.rules) whenever the row is in the LEAGUE PROFILE — is_template, or a format-2 envelope, or referenced by a live league (D175(2)). Legacy research rows match none of the three and stay writable under their own D33 namespace; a mock-only reference (drafts.config->>scoring_system_id) is deliberately outside the profile (D175(6)). SECURITY DEFINER because it reads public.leagues, which has RLS — an INVOKER read would make the reference arm role-dependent and silently empty for exactly the writer it exists to stop. Not callable outside a trigger context (0A000), so there is no subject to authorize in-body; pinned in pgTAP 052 §A.';

CREATE TRIGGER trg_scoring_systems_rules_guard
  BEFORE INSERT OR UPDATE ON scoring_systems
  FOR EACH ROW
  EXECUTE FUNCTION public.scoring_systems_rules_guard();

-- R616: `ENABLE ALWAYS`, not the default `ENABLE`. A trigger created with the
-- default `tgenabled = 'O'` (origin) is SKIPPED ENTIRELY under
-- `session_replication_role = 'replica'` — which `postgres` can set (it is
-- `rolsuper = f, rolbypassrls = t`, and the GUC's `superuser` context still
-- admits it), and which is the mode `pg_restore` and logical replication apply
-- run in. Measured: in replica mode an invalid `is_template` row COMMITTED and
-- was read back from a separate session and over anon PostgREST. `ALWAYS`
-- makes the trigger fire in both modes. **This is the door a restore
-- repopulates the guarded column through**, which is the one door it would be
-- absurd to leave open on the very column a restore rewrites. Contained
-- otherwise: `service_role`, `authenticated` and `anon` all get
-- `permission denied to set parameter` (measured).
ALTER TABLE scoring_systems
  ENABLE ALWAYS TRIGGER trg_scoring_systems_rules_guard;

-- ---------------------------------------------------------------------------
-- 3. WALL 2 — the snapshot backstop (D168(2)). Additive beside 059's
--    `trg_leagues_snapshot_guard`, which is NOT edited.
-- ---------------------------------------------------------------------------
--
-- 059 makes the snapshot NON-NULL in `drafting`+. This makes it VALID — the
-- D43 pattern extended from "non-NULL" to "non-NULL and legal", which is what
-- §12.25's "the snapshot-time re-validation in `draft_start` is the integrity
-- backstop" asks for, satisfied on the COLUMN so that every present and future
-- writer is covered mechanically. Today that is three: 059's
-- `snapshot_league_scoring` / `snapshot_league_scoring_internal`, and
-- `draft_start_internal`'s PERFORM of the latter (currently
-- `098_manual_nomination_order.sql:362`, a line that has already outlived two
-- rewrites of its own function).
--
-- Plain, not SECURITY DEFINER: it reads no table, so there is nothing RLS can
-- hide from it and no reason to borrow privileges. It therefore calls
-- `scoring_rules_validate` as the WRITING role, and **which role that is was
-- measured, not assumed** — `leagues` carries exactly ONE policy today and it
-- is a SELECT policy (001's `"League owners can manage" FOR ALL` is gone;
-- `select polname, polcmd from pg_policy where polrelid='public.leagues'::regclass`
-- → one row, `polcmd = 'r'`), so every league write is either a SECURITY
-- DEFINER RPC (running as postgres) or a `rolbypassrls` role. `service_role`
-- IS such a role (`rolbypassrls = t`, `rolsuper = f`) and writes `leagues`
-- straight through PostgREST — so 103's REVOKE stopping at PUBLIC/anon, and
-- leaving `service_role` holding EXECUTE through 037's default ACLs, is
-- **load-bearing**: without it this wall would refuse a service_role write
-- with `42501` instead of the P0001 field-path contract. pgTAP 052 §F pins the
-- service_role refusal on its SQLSTATE for exactly that reason. `anon` holds
-- neither EXECUTE nor any write path to `leagues`, so it cannot reach here at
-- all (pinned §H).
--
-- (Wall 1 is the other way round: being DEFINER it always calls the validator
-- as postgres, so no caller grant is load-bearing there. Stated because the
-- two walls differ and a reader should not carry one story across both.)
CREATE OR REPLACE FUNCTION public.leagues_scoring_rules_valid()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- No value comparison. The "did this write touch the snapshot?" question is
  -- answered by the TRIGGER's `UPDATE OF scoring_rules_snapshot` clause below,
  -- which fires on the column being ASSIGNED rather than on its value
  -- CHANGING — and the difference is a breach, not a nicety (R617): a
  -- pre-104 invalid snapshot is by construction a copy of its system's
  -- `rules`, so `draft_start`'s re-freeze writes the IDENTICAL value, an
  -- `IS DISTINCT FROM OLD` test is FALSE, and the league enters `drafting` on
  -- an invalid document — silently, with `draft_start` itself as the writer.
  -- Measured, and measured against its own control (the same call with the
  -- snapshot NULLed first RAISES). Moving the test into `UPDATE OF` keeps
  -- D175(4)'s never-retroactively-invalidate guarantee — an ordinary league
  -- edit does not name this column and does not fire — while making it
  -- structural rather than a body branch a later edit can delete unnoticed.
  IF NEW.scoring_rules_snapshot IS NOT NULL THEN
    PERFORM public.scoring_rules_validate(NEW.scoring_rules_snapshot);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.leagues_scoring_rules_valid()
  FROM PUBLIC, anon, authenticated, service_role;   -- R620, as above

COMMENT ON FUNCTION public.leagues_scoring_rules_valid() IS
  'SE.4b / D168(2) + §12.25: BEFORE INSERT OR UPDATE on leagues, PERFORMs scoring_rules_validate on any new or changed non-NULL scoring_rules_snapshot. The §7.3.8/§12.25 draft-start backstop, placed on the COLUMN rather than in draft_start_internal — which was replaced twice (092, 098) by lanes that had never read the SE breakdown, and a guard in that body would have needed both authors to carry it forward blind (CLAUDE.md''s migration-073 lesson). Additive beside 059''s trg_leagues_snapshot_guard (non-NULL in drafting+); 059 is not edited.';

CREATE TRIGGER trg_leagues_scoring_rules_valid
  BEFORE INSERT OR UPDATE OF scoring_rules_snapshot ON leagues
  FOR EACH ROW
  EXECUTE FUNCTION public.leagues_scoring_rules_valid();

ALTER TABLE leagues
  ENABLE ALWAYS TRIGGER trg_leagues_scoring_rules_valid;   -- R616, as above

-- ---------------------------------------------------------------------------
-- 4. WALL 3 — the REFERENCE guard on `leagues` (R618): D168(2)'s own argument
--    applied to the column D168(2) missed.
-- ---------------------------------------------------------------------------
--
-- Walls 1 and 2 guard `scoring_systems.rules` and
-- `leagues.scoring_rules_snapshot`. Between them sits the column that decides
-- WHICH document a league is governed by — `leagues.scoring_system_id` — and
-- nothing guarded it. The review of the first cut of this migration measured
-- **six** transitions that put an invalid document in front of a league
-- without either wall firing, and the ledger row filed for the first of them
-- called it "the one door":
--
--   1. `leagues.scoring_system_id` REPOINT to an invalid unreferenced row
--   2. `leagues` INSERT already carrying `scoring_system_id`
--   3. soft-delete → (legally) rewrite the now-unreferenced doc → **un-delete**
--      (`deleted_at` NOT NULL → NULL; no un-delete function exists in 001–104)
--   4. detach → rewrite → re-attach
--   5. the same, MID-DRAFT
--   6. an `is_template` promotion out of the profile (R615, fixed above)
--
-- **Why a trigger and not an RPC check.** D169 assigns the remedy to
-- `update_league_settings` — and that RPC is in the path of exactly ONE of
-- them. `leagues` carries a single SELECT policy, so every league write today
-- is a SECURITY DEFINER RPC or a `rolbypassrls` role, and five of the six are
-- raw-table writes no RPC is in front of. This repo's own migration-073 lesson
-- is this shape in reverse: a guard that lives in a function body has to be
-- re-remembered by whoever next writes the table. **A guard on the column does
-- not** — which is the argument D168(2) already won for the snapshot, applied
-- to the reference. D169's attach-time check stays as SE.5's user-facing error
-- surface; it is now defense in depth over this, not the only guard.
--
-- **It also makes wall 1's identity short-circuit HONEST.** That short-circuit
-- skips a rules-untouched write on a row already in the profile, justified as
-- "that document passed this wall on the write that put it there". For arm (c)
-- that justification was factually wrong before this trigger existed: entry via
-- arm (c) is a write to `leagues`, which fires nothing on `scoring_systems`, so
-- the document had never been validated. With this wall, entry via arm (c)
-- validates at the `leagues` write, and the justification is true for all three
-- arms. The two fixes compose; neither is sufficient alone.
--
-- **Fires on ASSIGNMENT, not on change** (`UPDATE OF …`), for the same reason
-- wall 2 does: an ordinary league edit names neither column and pays nothing,
-- while a write that names one is always revalidated. Both columns are needed —
-- door 3 never touches `scoring_system_id` at all.
--
-- `SECURITY DEFINER` **as a structural precaution, and the difference from
-- wall 1's case is stated rather than glossed (R636).** Wall 1's DEFINER-ness
-- is MEASURED: demote it to INVOKER and pgTAP 052 §E4c dies, because a writer
-- who owns the scoring row but cannot see the referencing league is an
-- ordinary `authenticated` user. Wall 3 has no such twin and cannot have one
-- today: `public.leagues` carries a single SELECT-only policy, so every writer
-- that reaches this trigger is `postgres` or a `rolbypassrls` role, both of
-- which see `public.scoring_systems` whole — an INVOKER wall 3 would behave
-- identically on every input this repo can construct. It is DEFINER because
-- the predicate it evaluates is a SYSTEM fact and must not become
-- role-dependent the day a `leagues` write policy is added (SE.5 does not add
-- one; a later league-admin surface might). Recorded as a precaution with no
-- behavioural pin, which is the honest register — not as a measured necessity.
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

  -- ── R626: `FOR NO KEY UPDATE`, AND THE LOCK IS THE POINT OF THE STATEMENT.
  -- Wall 1's arm (c) reads `public.leagues` and this reads
  -- `public.scoring_systems`; each holds the row IN FRONT of it, and before
  -- this lock neither held still the PREMISE it reads from the other's table.
  -- Under READ COMMITTED two concurrent transactions therefore each passed on
  -- a stale snapshot and committed a live league referencing the F21 document
  -- — reproduced by four reviewers, in BOTH orderings, first try each time,
  -- with single-transaction controls correctly refused in both orderings, so
  -- the interleave was the only variable. `FOR NO KEY UPDATE` is the weakest
  -- lock that conflicts with the rules-UPDATE this seam races (it does NOT
  -- conflict with the FK's `FOR KEY SHARE`, so ordinary league writes are not
  -- serialised behind scoring edits — measured at 1.162 ms through a held
  -- `FOR KEY SHARE`). Both orderings then serialise: the later transaction
  -- either blocks and re-reads the invalid document, or commits first and is
  -- caught by wall 1's arm (c) seeing the live league.
  --
  -- **It introduces a two-direction lock pattern and therefore a deadlock
  -- surface**, which is a clean rollback rather than corruption — pinned with
  -- its own isolation cell (pgTAP 052 §K) rather than landed as a drive-by.
  SELECT s.rules INTO v_rules
  FROM public.scoring_systems s
  WHERE s.id = NEW.scoring_system_id
  FOR NO KEY UPDATE;

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

REVOKE EXECUTE ON FUNCTION public.leagues_scoring_reference_guard()
  FROM PUBLIC, anon, authenticated, service_role;   -- R620

COMMENT ON FUNCTION public.leagues_scoring_reference_guard() IS
  'SE.4b / R618: BEFORE INSERT OR UPDATE OF scoring_system_id, deleted_at on leagues — resolves the referenced scoring_systems row and PERFORMs scoring_rules_validate on its rules. Closes the five raw-table doors D169''s RPC-shaped remedy is not in the path of (repoint, INSERT-carrying-a-reference, un-delete revive, detach-rewrite-reattach incl. mid-draft). Fires on ASSIGNMENT (UPDATE OF), so an ordinary league edit pays nothing. SECURITY DEFINER for wall 1''s reason: scoring_systems has RLS and a reference the writer cannot see must not read as nothing-to-validate.';

CREATE TRIGGER trg_leagues_scoring_reference_guard
  BEFORE INSERT OR UPDATE OF scoring_system_id, deleted_at ON leagues
  FOR EACH ROW
  EXECUTE FUNCTION public.leagues_scoring_reference_guard();

ALTER TABLE leagues
  ENABLE ALWAYS TRIGGER trg_leagues_scoring_reference_guard;   -- R616
