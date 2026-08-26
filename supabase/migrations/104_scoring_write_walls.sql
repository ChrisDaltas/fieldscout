-- ============================================================================
-- 104 — the two write walls (SE.4b): an invalid league scoring document is
--       UNREPRESENTABLE. `scoring_systems_rules_guard()` on `scoring_systems`
--       (D175 — Chris's 2026-08-18 ruling, verbatim: "creating an invalid
--       scoring system should not be possible") + `leagues_scoring_rules_valid()`
--       on `leagues.scoring_rules_snapshot` (D168(2)), plus the FK index the
--       first wall's reference arm and §12.25's member policy both need.
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
--     049/050/051's username guards. **A guard on the column needs no author to
--     remember it.**
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
--                                  the census is pinned in pgTAP 052 §C)
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
-- wall binds every role. The profile-ENTRY arm is pinned in pgTAP 052 §D6 and
-- is one of the two break probes.
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
--   • Prod-safe: two new functions + two new triggers on tables whose existing
--     rows all pass (the census is asserted, not assumed — pgTAP 052 §C), and
--     one index on a 0-row-to-small table.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The FK index wall 1's reference arm and §12.25's policy both need
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_leagues_scoring_system
  ON leagues (scoring_system_id);

COMMENT ON INDEX idx_leagues_scoring_system IS
  'SE.4b (104): leagues.scoring_system_id had no index since 001. Probed by scoring_systems_rules_guard()''s live-league-referenced arm (D175(2)) on every in-profile scoring_systems write, and scanned by §12.25''s "League members read league scoring" SELECT policy (SE.5). Plan §8.1: an index for every FK used in policies/joins.';

-- ---------------------------------------------------------------------------
-- 2. WALL 1 — the table wall (D175). An invalid LEAGUE scoring document is
--    unrepresentable in `scoring_systems`, for every role and every path.
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
     AND (
          COALESCE(OLD.is_template, FALSE)
       OR (OLD.rules ? 'format')
       OR EXISTS (
            SELECT 1 FROM public.leagues l
            WHERE l.scoring_system_id = OLD.id
              AND l.deleted_at IS NULL
          )
     )
  THEN
    RETURN NEW;
  END IF;

  -- No catch, no wrap, no re-word: P0001 + MESSAGE/DETAIL/HINT propagates
  -- exactly as 103 raised it, which is the contract SE.5/SE.6 turn into a
  -- field path.
  PERFORM public.scoring_rules_validate(NEW.rules);

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.scoring_systems_rules_guard() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.scoring_systems_rules_guard() IS
  'SE.4b / D175 (Chris, 2026-08-18: "creating an invalid scoring system should not be possible"): BEFORE INSERT OR UPDATE on scoring_systems, PERFORMs scoring_rules_validate(NEW.rules) whenever the row is in the LEAGUE PROFILE — is_template, or a format-2 envelope, or referenced by a live league (D175(2)). Legacy research rows match none of the three and stay writable under their own D33 namespace; a mock-only reference (drafts.config->>scoring_system_id) is deliberately outside the profile (D175(6)). SECURITY DEFINER because it reads public.leagues, which has RLS — an INVOKER read would make the reference arm role-dependent and silently empty for exactly the writer it exists to stop. Not callable outside a trigger context (0A000), so there is no subject to authorize in-body; pinned in pgTAP 052 §A.';

CREATE TRIGGER trg_scoring_systems_rules_guard
  BEFORE INSERT OR UPDATE ON scoring_systems
  FOR EACH ROW
  EXECUTE FUNCTION public.scoring_systems_rules_guard();

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
  IF NEW.scoring_rules_snapshot IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.scoring_rules_snapshot IS DISTINCT FROM OLD.scoring_rules_snapshot)
  THEN
    PERFORM public.scoring_rules_validate(NEW.scoring_rules_snapshot);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.leagues_scoring_rules_valid() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.leagues_scoring_rules_valid() IS
  'SE.4b / D168(2) + §12.25: BEFORE INSERT OR UPDATE on leagues, PERFORMs scoring_rules_validate on any new or changed non-NULL scoring_rules_snapshot. The §7.3.8/§12.25 draft-start backstop, placed on the COLUMN rather than in draft_start_internal — which was replaced twice (092, 098) by lanes that had never read the SE breakdown, and a guard in that body would have needed both authors to carry it forward blind (CLAUDE.md''s migration-073 lesson). Additive beside 059''s trg_leagues_snapshot_guard (non-NULL in drafting+); 059 is not edited.';

CREATE TRIGGER trg_leagues_scoring_rules_valid
  BEFORE INSERT OR UPDATE ON leagues
  FOR EACH ROW
  EXECUTE FUNCTION public.leagues_scoring_rules_valid();
