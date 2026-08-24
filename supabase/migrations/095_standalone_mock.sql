-- ============================================================================
-- 095 — A MOCK WITH NO LEAGUE: LAUNCH, BOTS, STORAGE, CLEANUP (task MP.3;
-- spec v2.16.1 §8.8 + §12; tasks-MP §5 MP.3 and §4 rules 1-16 = tasks-M3
-- §4's eight + tasks-DR §4 rule 9 + the MP lane's seven; D226/D227/D229/
-- D234/D236; F109 (a)-(d) and F112 discharged; D137 head rule throughout).
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 1 — WHAT THIS MIGRATION IS.
-- ---------------------------------------------------------------------------
-- After it, a `drafts` row may have `league_id IS NULL`. That single fact is
-- the whole feature and the whole cost: a mock draft becomes a thing a user
-- can run without being in a league (§8.8 as amended by v2.16), and eleven
-- engine bodies stop asking a question that no longer has an answer.
--
-- The storage shape is NOT decided here. **D234 decided it** (MP.1): the SAME
-- tables, `league_id` nullable, and the ownership arm scoped by
-- `league_id IS NULL`. Mock-owned tables were priced and REFUSED (37 of 58
-- live functions / 5,901 lines name one of the six draft tables across 206
-- literal references). This migration builds that decision and does not
-- revisit it.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 2 — THE `league_id IS NULL` CONJUNCT IS LOAD-BEARING (D234(7)).
-- ---------------------------------------------------------------------------
-- Every ownership arm below reads
--   `is_league_member(league_id) OR (league_id IS NULL AND <launcher>)`.
-- The truth table is one line: on any row where `league_id IS NOT NULL` the
-- second disjunct's FIRST CONJUNCT is FALSE BY CONSTRUCTION, so the predicate
-- reduces to the shipped one term for term. There is no real-league row the
-- new arm can contribute a TRUE for.
--
-- **Drop that conjunct and it stops being true.** MP.1 probed exactly that
-- (D234(7) arm C): an EX-MEMBER who launched a league-attached mock and then
-- LEFT the league keeps read on it — strictly more permissive on a row that
-- HAS a league, which is what D233(5) forbids. **That probe is now a
-- PERMANENT TEST** (pgTAP 043 §B), not a paragraph: remove the conjunct from
-- `is_standalone_mock_launcher` and 043 goes RED.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 3 — THE THREE BREAKS-ON-NULL CLASSES, AND THE ONE THAT WAS
-- UNDERCOUNTED (F109(a)).
-- ---------------------------------------------------------------------------
-- (a) THE `leagues`-EXISTENCE GUARDS. `EXISTS (SELECT 1 FROM public.leagues l
--     WHERE l.id = … AND l.deleted_at IS NULL)`. F109(a) named SIX sites in
--     `draft_tick` — the ones inside its `AND d.is_mock` scans. **Re-measured
--     against the deployed body, the number a standalone mock actually needs
--     is TEN, and twelve are amended.** The six F109 named (body lines
--     268/291 · 531/559 · 680/722) plus FOUR nobody had counted:
--       * ARM 2's snake/linear pick-timeout BODY re-check (body line 375) —
--         the claim above it carries NO leagues predicate, so a standalone
--         mock IS claimed and then silently skipped: its pick clock never
--         expires and the board never autopicks.
--       * ARM 2.6(a)/(b), the auction clocks (body 810/834) — scanned by
--         `draft_type = 'auction'`, not by `is_mock`, so a standalone mock
--         AUCTION was claimed and skipped the same way: no nomination
--         timeout, no bid close.
--       * ARM 3, the §9.1 heartbeat (body 961) — every live draft, mocks
--         included since 071. Without the arm the standalone room gets no
--         tick beat and its clock drifts unchecked (§9.3).
--     The remaining two (body 186/198, ARM 1.5/1.6's supervision-loss
--     auto-pause) are amended for uniformity and are **behaviourally inert**
--     on a standalone mock: that arm is gated on
--     `EXISTS (… draft_liveness JOIN league_members m ON m.league_id =
--     d.league_id …)`, which is empty when there is no league, so the arm
--     never claims one. Stated rather than skipped — a reader should not have
--     to re-derive why two of the twelve do nothing.
--     ARM 1's own two references (body 78/95) are NOT of this class: they
--     SCAN `public.leagues` for the D94 auto-start and never look at a mock
--     (`draft_start_internal` filters `is_mock = FALSE`). Untouched.
--     The same class in `draft_make_pick` / `draft_nominate` / `draft_place_bid`
--     is the SECOND, uncounted `P0002` guard sitting immediately after the
--     `is_league_member` site — probed by MP.1 as `f`/`f`/`t` over REAL /
--     MOCK-in-league / MOCK-standalone, i.e. the human's own pick 404s on
--     their own practice. Both sites in each body are amended here.
--
--     **`draft_end` and `draft_reset` are NOT amended, and this is a
--     MEASUREMENT, not an oversight.** F109(a) lists their `PERFORM …
--     FOR UPDATE; IF NOT FOUND` variants. On a standalone mock those lines
--     are UNREACHABLE: both bodies open with
--     `IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id)`,
--     and `is_league_commish(NULL)` is FALSE (measured:
--     `select public.is_league_commish(NULL)` → `f`), so the call raises
--     42501 four lines in and never reaches the leagues guard 30 lines
--     later. Amending a line that cannot execute would be a change to the
--     REAL commissioner path with no mock benefit (tasks-MP §4 rule 11).
--     Whether the launcher gets End/Reset on their own mock is the **MS
--     lane's** question (both bodies refuse `is_mock` explicitly today), not
--     this task's.
--
-- (b) THE UNGUARDED `league_chat` WRITE (F109(c)). `draft_pause_internal` and
--     `draft_resume` INSERT chat with `v_draft.league_id` and no `is_mock`
--     guard, so a standalone mock raised **23502 on pause and on resume**.
--     **THE DECISION, STATED AS THE TASK ASKS: the line is KEPT and the row
--     is written with a NULL `league_id`** — not skipped. Three reasons, in
--     order of weight:
--       1. Those rows are the D97 SYSTEM POSTS the room reads back — the
--          pause/resume/clock notices. Skipping the write does not remove a
--          message nobody wanted; it removes a message the room shows.
--          D226(2)'s "there is nobody to chat with" is an argument about
--          SENDING, and R490 already caught it being over-read as an
--          argument about READING.
--       2. The row's real key is `context = 'draft:<id>'`, not `league_id`.
--          Both cleanup paths already sweep chat by that context, and both
--          are made NULL-safe here (`league_id IS NOT DISTINCT FROM …`), so
--          a standalone mock's posts are deleted with it exactly like a
--          league mock's.
--       3. `league_chat.league_id`'s NOT NULL drop is priced by D234 BECAUSE
--          of these two writers. Dropping the constraint and then declining
--          to write through it would leave the drop with no justification and
--          the RLS SELECT arm below with no rows to govern.
--     The chat pane's READ is still league-keyed client-side
--     (`use-draft-chat.ts:44-50`) — that half is **MP.6's**, and F109(c)
--     records it. This migration makes the rows EXIST and READABLE; the hook
--     that asks for them by `league_id` is a surface, and surfaces are not
--     this task's (scope guard).
--
-- (c) R492's TWO `v_draft.league_id` PREDICATES in `draft_autopick_resolve`.
--     The queue source's `t.league_id = v_draft.league_id` (the R120 join)
--     becomes `IS NOT DISTINCT FROM` — identical for every non-NULL league
--     (both operands non-null ⇒ same answer; a NULL `t.league_id` against a
--     non-NULL draft is FALSE under both), and on a standalone mock it is
--     what makes the launcher's OWN QUEUE resolve instead of being silently
--     ignored while best-ADP wins. Pinned in 043 §E.
--     The primary-board source's `ll.league_id = v_draft.league_id` is
--     **deliberately left alone**: `league_lists` is a league-scoped table
--     and a league-less primary board is not a thing that exists. A
--     standalone launcher's board arrives through source 3 — their BIG BOARD
--     (`lists.is_big_board`), which is user-scoped and already works. Pinned
--     in 043 §E so the claim is a test rather than a sentence.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 4 — TWO MORE BREAKS-ON-NULL FOUND WHILE BUILDING, IN THE
-- AUCTION SOLVENCY FAMILY. Neither is in F109 and both are fatal.
-- ---------------------------------------------------------------------------
-- `draft_team_budget` (head 092:229-320) guards on
-- `t.league_id = v_draft.league_id`, and `draft_auction_solvent` (head
-- 092:332-382) sweeps `FROM public.teams t WHERE t.league_id =
-- v_draft.league_id`. With a NULL league the first raises P0002 for EVERY
-- seat and the second's `bool_and` over zero rows is NULL, which its own
-- (correct, CLAUDE.md-shaped) empty-set guard turns into a LOUD refusal — so
-- **a standalone auction would refuse itself at launch.** Widening either to
-- `IS NOT DISTINCT FROM` is WRONG: it would make "every standalone team in
-- the database" the team set. Both get a `league_id IS NULL` arm whose team
-- set is the mock's OWN seat map — `drafts.draft_order`, which
-- `create_mock_draft` built from the seats it minted. The league branch of
-- each is 092's text unchanged.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 5 — R473's WEDGE, AND WHY IT IS THE ONLY PROTECTION HERE.
-- ---------------------------------------------------------------------------
-- tasks-MP §4 rule 10: name the party before you build the protection. This
-- one protects **a user from breaking their own practice**, and nothing else.
-- `teams` carries "Users can manage own standalone teams" FOR ALL (053:69-71)
-- and `draft_picks.team_id`'s FK is plain `NO ACTION`, so the owner of a bot
-- seat can `DELETE 1` it before its first pick and **wedge the mock at that
-- seat's turn with no in-product recovery** (R473, live-probed).
-- Disposition per D227(4): the FOR ALL policy is split, DELETE is narrowed to
-- refuse a row named in a mock's `config.mock` (cpu seat or human seat),
-- **UPDATE stays** (renaming your own bot is cosmetic and self-inflicted),
-- and **world-readability stays and is stated**: "Teams are viewable by
-- everyone" (001:844, `USING true`) still covers SELECT, and a bot seat
-- carries a label and nothing else (§17).
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 6 — CLEANUP, AND THE SAFETY BELT (D227(6)).
-- ---------------------------------------------------------------------------
-- `draft_picks` / `_bids` / `_queues` / `_liveness` / `_dnd_marks` cascade
-- from `drafts`; `teams` does NOT. So the order is a constraint, not a
-- preference: **the draft first, the seats second**, in one transaction, or
-- the FK refuses. Both cleanup paths (`delete_mock_draft`,
-- `mock_draft_expire`) do exactly that, and both carry the
-- `t.league_id IS NULL` belt the task text asks for: **a malformed
-- `cpu_seats` array must be INCAPABLE of deleting a real franchise**,
-- whatever it happens to contain. The owner is checked too, so a forged
-- config cannot reach another user's standalone team either.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 7 — F112 (R497): `draft_mock_cpu_need` IS REVOKED.
-- ---------------------------------------------------------------------------
-- 089 shipped the helper with no REVOKE and 094 preserved that on purpose
-- (changing a grant is not a settings-reader fix). Measured before deciding:
-- `grep -rn ".rpc('draft_mock_cpu_need'" src` → **no matches**; the only two
-- mentions of the name in `src/` are the generated `types/database.ts` and a
-- comment in `mock-auction-db.test.ts`. **There is no client caller**, so
-- D18->D23 applies without a carve-out — the server picks, a client never
-- asks — and it joins `draft_autopick_resolve`'s posture. 042 §E pins the
-- OLD state as a measured fact, so that pin flips here and is updated in the
-- same PR (a pin that reddens without being read is how a REVOKE gets
-- discovered by an outage — the reason R497 wrote it down).
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 8 — §8.8's ZERO-SIDE-EFFECT RULE IS UNWEAKENED.
-- ---------------------------------------------------------------------------
-- A LEAGUE-attached mock mints nothing, stores no `cpu_seats`, and touches
-- no row it did not touch before this migration: every standalone behaviour
-- below sits behind `p_league_id IS NULL` / `league_id IS NULL`. The R383
-- whole-row composite runs on the new paths too (043 §F), and 043 §G is the
-- whole-schema delta the task asks for: a user in ZERO leagues launches,
-- drafts, completes and deletes a standalone mock, and the delta over all
-- `public` tables is confined to the mock's own rows and its bot seats — no
-- `leagues`, no `league_members`, no `league_rosters`, no `transactions`.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 9 — D137 HEAD PROVENANCE (re-derived here, not recalled).
-- ---------------------------------------------------------------------------
-- Every head below was re-derived with
--   `for f in supabase/migrations/*.sql; do grep -qE '^CREATE (OR REPLACE )?
--    FUNCTION +(public\.)?<fn>\(' "$f" && echo "$f"; done`
-- and the ranges read out of the winning FILE (never `pg_get_functiondef` —
-- CLAUDE.md's superseded-body rule):
--   create_mock_draft            071 -> 089 -> 092 -> **094:152-459**   (rewritten)
--   draft_autopick_resolve       068 -> 086 -> **094:511-740**          (1 hunk)
--   draft_tick                   068 -> 086 -> 087 -> 089 -> 091 -> 092
--                                -> **093:666-1685**                    (12 hunks)
--   draft_nominate               085 -> 089 -> 091 -> 092 -> **093:1701-2004** (2 hunks)
--   draft_make_pick              066 -> **085:811-981**                 (2 hunks)
--   draft_place_bid              085 -> **089:1311-1498**               (2 hunks)
--   draft_team_budget            084 -> **092:229-320**                 (1 hunk)
--   draft_auction_solvent        084 -> **092:332-382**                 (1 hunk)
--   draft_pause                  **069:378-435**                        (1 hunk)
--   draft_resume                 **069:439-504**                        (1 hunk)
--   draft_touch                  **068:428-454**                        (1 hunk)
--   delete_mock_draft            **071:469-515**                        (2 hunks)
--   mock_draft_expire            **071:524-607**                        (1 hunk)
-- Everything outside the counted hunks is the head's text verbatim; the
-- amended bodies were produced by textual substitution against those exact
-- ranges with the occurrence count asserted per hunk, never retyped.
--
-- ---------------------------------------------------------------------------
-- Migration checklist (delivery plan §8.1 / tasks-M3 §4.4):
--  * DDL: FOUR `DROP NOT NULL`s (widenings — no existing row can violate
--    one), NO new table, NO new column, NO index change. `drafts`'
--    `one_active_real_draft_per_league` is already `WHERE is_mock = false`,
--    so a NULL `league_id` cannot collide with it (D234(4), measured).
--  * Policies: 4 SELECT arms replaced (`drafts`, `draft_picks`,
--    `draft_bids`, `league_chat`), 1 `teams` FOR ALL policy split into
--    INSERT/UPDATE/DELETE, 2 `realtime.messages` `draft:%` policies replaced.
--  * Functions: 3 new helpers, 1 DROP+CREATE (signature change), 12
--    CREATE OR REPLACE. Every SECURITY DEFINER function keeps in-body auth +
--    `search_path = ''` + its REVOKE (tasks-M* §4.1).
--  * SIGNATURE CHANGE, stated plainly: `create_mock_draft` gains
--    `p_settings JSONB` and `p_league_id` gains a DEFAULT. This cannot be a
--    `CREATE OR REPLACE` — appending a defaulted parameter creates a second
--    OVERLOAD and every existing 4-arg named call then fails "function is
--    not unique". So the 4-arg form is DROPped and the 5-arg form created.
--    **Typegen therefore moves** and is re-run in this PR.
--  * D38 BACKFILL: none is owed and the reason is measured, not assumed —
--    every row this migration could need to fix would be a `drafts` row with
--    a NULL `league_id`, and there are none, because the column was NOT NULL
--    until this file ran. The four drops are widenings.
--  * Rollback = re-apply 094:152-459, 094:511-740, 093:666-1685,
--    093:1701-2004, 085:811-981, 089:1311-1498, 092:229-320, 092:332-382,
--    069:378-435, 069:439-504, 068:428-454, 071:469-515, 071:524-607
--    verbatim, restore the six policies from 001/053/088 and re-add the four
--    NOT NULLs (which requires deleting any standalone mock first — stated
--    so a rollback is not attempted blind).
--  * R6 STAGING WAIVER, cited: no staging clone exists (environments are
--    local + prod only). The recorded rehearsal is `npx supabase migration up`
--    against the local stack plus the FULL pgTAP suite and the stack-backed
--    vitest files. **NO `db reset` was run** — the chain-order rule calls for
--    reset-first only when a reset is otherwise required, and `migration up`
--    replays this file against the deployed chain (F110's lesson: destroying
--    the dev machine's login and data to rehearse what `migration up` already
--    exercises is a cost with no evidence attached).
--  * F12 note: prod's migration history still ends pre-league-schema; this
--    lands with the next normal push.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE FOUR `NOT NULL` DROPS (D234(4), confirmed exactly against
--    `information_schema.columns WHERE column_name = 'league_id'`: 11 rows,
--    `teams` already nullable, 10 NOT NULL, of which FOUR are on the draft
--    path). EVERY FOREIGN KEY IS KEPT — a NULL passes an FK, a WRONG id
--    still fails, and that is exactly the property this relies on.
-- ---------------------------------------------------------------------------
ALTER TABLE drafts       ALTER COLUMN league_id DROP NOT NULL;
ALTER TABLE draft_picks  ALTER COLUMN league_id DROP NOT NULL;
ALTER TABLE draft_bids   ALTER COLUMN league_id DROP NOT NULL;
ALTER TABLE league_chat  ALTER COLUMN league_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. THREE HELPERS. One ownership predicate, one liveness predicate, one
--    range guard — not a membership graph (D226(3)).
-- ---------------------------------------------------------------------------

-- 2a. THE OWNERSHIP PREDICATE. MS.2's gate idiom
-- (`config->'mock'->>'launched_by'`, TEXT-compared — R117), already shipped
-- in `draft_queues`' two policies, with the `league_id IS NULL` conjunct
-- that banner item 2 shows is load-bearing. `is_standalone_mock_launcher
-- (NULL)` is FALSE, never NULL — it is a `SELECT EXISTS(…)` — so every arm
-- built on it fails CLOSED.
CREATE OR REPLACE FUNCTION is_standalone_mock_launcher(p_draft_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.drafts d
    WHERE d.id = p_draft_id
      AND d.is_mock
      AND d.league_id IS NULL
      AND d.config->'mock'->>'launched_by' = auth.uid()::text
  );
$$;

-- GRANTS, and this one is a carve-out with a reason (D50). A
-- POLICY-PREDICATE helper is evaluated inside RLS as whatever role is
-- querying, so it must be EXECUTE-able by every role the policy applies to —
-- and these policies are `TO public`. `is_league_member` carries exactly this
-- posture for exactly this reason (037's default-ACL model, D23: grants are
-- uniform, RLS is the gate). REVOKing PUBLIC here does not narrow anything;
-- it turns "you see no rows" into "permission denied for function", which is
-- a worse answer to the same question. So the default ACL STANDS, stated
-- rather than left to look like an omission.

-- 2b. THE SEAT GUARD, for the narrowed `teams` DELETE policy (D227(4)).
-- SECURITY DEFINER on purpose: the answer must not depend on whether the
-- deleting user can SEE the draft that names the seat. A wedge caused by an
-- invisible row is still a wedge.
CREATE OR REPLACE FUNCTION team_is_mock_seat(p_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.drafts d
    WHERE d.is_mock
      AND (d.config->'mock'->>'human_team_id' = p_team_id::text
           OR (d.config->'mock'->'cpu_seats') ? p_team_id::text)
  );
$$;

-- Same carve-out, same reason: it is read inside the `teams` DELETE policy,
-- which is `TO public` (D50).

-- 2c. "THE LEAGUE, IF THERE IS ONE, IS ALIVE." The whole `leagues`-existence
-- guard class (banner item 3(a)) collapses to this one named idea, so the
-- twelve `draft_tick` sites and the three `P0002` guards become one-line
-- hunks against a shape that is stated once instead of restated fifteen
-- times. **A mock's existence check is the draft row itself, not its
-- league.**
--
-- LANGUAGE sql + STABLE + NO `SET` clause, deliberately: a SET clause blocks
-- inlining, and these calls sit inside `draft_tick`'s claim predicates where
-- the planner must keep folding them into the scan. Every reference is
-- schema-qualified, so there is no search-path hazard to pin against, and
-- the function is SECURITY INVOKER — which is exactly what the inlined
-- `EXISTS` was, running inside its DEFINER caller. Every call site is a
-- SECURITY DEFINER body owned by `postgres` (measured: `prosecdef` is true
-- for `draft_tick`, `draft_make_pick`, `draft_nominate`, `draft_place_bid`),
-- so the semantics are unchanged.
CREATE OR REPLACE FUNCTION draft_league_alive(p_league_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT p_league_id IS NULL
      OR EXISTS (
           SELECT 1 FROM public.leagues l
           WHERE l.id = p_league_id AND l.deleted_at IS NULL
         );
$$;

-- Engine-internal: no client asks whether a league is alive (D18->D23).
REVOKE EXECUTE ON FUNCTION draft_league_alive(UUID) FROM PUBLIC, anon, authenticated;

-- 2d. THE §7.3.8 RANGE GUARD for a caller-supplied settings object. The
-- ranges mirror the ONE catalog the app validates against —
-- `draftConfigSchema`, `src/lib/leagues/settings/league-settings.ts:244-259`
-- — and the mirroring is deliberate, not an accident of duplication:
-- `create_mock_draft` is EXECUTE-able by `authenticated`, so a client that
-- skips the route reaches it directly, and every knob below can WEDGE the
-- engine rather than merely look wrong (a 0-second bid clock never closes a
-- nomination; a budget under the reserve floor makes the board unfillable).
-- MP.4's launch form parses with the zod schema; this is the server floor
-- under it. Each bound is pinned one step either side in 043 §D (D146).
CREATE OR REPLACE FUNCTION draft_settings_range_guard(p_draft JSONB)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v INTEGER;
BEGIN
  IF p_draft ? 'pick_timer_seconds' THEN
    v := (p_draft->>'pick_timer_seconds')::int;
    IF v NOT IN (0, 30, 45, 60, 90, 120, 180, 300, 600, 3600, 14400, 28800, 86400) THEN
      RAISE EXCEPTION 'draft settings: pick_timer_seconds % is not one of the offered clocks (§7.3.8)', v
        USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_draft ? 'auction_budget' THEN
    v := (p_draft->>'auction_budget')::int;
    IF v < 50 OR v > 1000 THEN
      RAISE EXCEPTION 'draft settings: auction_budget % is outside 50-1000 (§7.3.8)', v
        USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_draft ? 'auction_nomination_seconds' THEN
    v := (p_draft->>'auction_nomination_seconds')::int;
    IF v < 10 OR v > 120 THEN
      RAISE EXCEPTION 'draft settings: auction_nomination_seconds % is outside 10-120 (§7.3.8)', v
        USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_draft ? 'auction_bid_seconds' THEN
    v := (p_draft->>'auction_bid_seconds')::int;
    IF v < 10 OR v > 60 THEN
      RAISE EXCEPTION 'draft settings: auction_bid_seconds % is outside 10-60 (§7.3.8)', v
        USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_draft ? 'auction_anti_snipe_seconds' THEN
    v := (p_draft->>'auction_anti_snipe_seconds')::int;
    IF v < 0 OR v > 15 THEN
      RAISE EXCEPTION 'draft settings: auction_anti_snipe_seconds % is outside 0-15 (§7.3.8)', v
        USING ERRCODE = '22023';
    END IF;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_settings_range_guard(JSONB) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE FOUR SELECT ARMS (D234(4): four required, not five). Each is the
--    shipped predicate OR the standalone-launcher arm, and banner item 2 is
--    why the `league_id IS NULL` conjunct inside the helper is not
--    decoration. A fifth arm — `league_chat`'s INSERT — is DECLINED with a
--    reason (D234(4) sanctions declining it): it governs a HUMAN typing into
--    a room, and D226(2) says there is nobody in a mock room to type to.
--    Every engine chat write reaching a mock is `SECURITY DEFINER` and owned
--    by `postgres` (measured), so it does not consult this policy at all.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Drafts viewable by league members" ON drafts;
CREATE POLICY "Drafts viewable by league members"
  ON drafts FOR SELECT
  USING (
    is_league_member(league_id)
    OR (league_id IS NULL
        AND is_mock
        AND config->'mock'->>'launched_by' = auth.uid()::text)
  );

DROP POLICY IF EXISTS "Picks viewable by league members" ON draft_picks;
CREATE POLICY "Picks viewable by league members"
  ON draft_picks FOR SELECT
  USING (
    is_league_member(league_id)
    OR (league_id IS NULL AND is_standalone_mock_launcher(draft_id))
  );

DROP POLICY IF EXISTS "Bids viewable by league members" ON draft_bids;
CREATE POLICY "Bids viewable by league members"
  ON draft_bids FOR SELECT
  USING (
    is_league_member(league_id)
    OR (league_id IS NULL AND is_standalone_mock_launcher(draft_id))
  );

-- `league_chat` has no `draft_id` column: the draft is in `context`, which
-- every writer stamps as `'draft:' || draft_id`. The regex is a guard, not
-- decoration — `context` is also the literal `'league'` for league-room
-- posts, and an unguarded `::uuid` cast on that would raise inside a policy
-- (the R117 lesson: validate as TEXT, never cast hopefully).
DROP POLICY IF EXISTS "Chat viewable by league members" ON league_chat;
CREATE POLICY "Chat viewable by league members"
  ON league_chat FOR SELECT
  USING (
    is_league_member(league_id)
    OR (league_id IS NULL
        AND context ~ '^draft:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        AND is_standalone_mock_launcher(substring(context from 7)::uuid))
  );

-- ---------------------------------------------------------------------------
-- 4. R473's WEDGE (D227(4)). 053's ONE `FOR ALL` policy becomes three, and
--    the DELETE arm is the only one that changes meaning.
--
--    KEPT, EXPLICITLY: **world-readable SELECT.** "Teams are viewable by
--    everyone" (001, `USING true`) still covers reads and is deliberately
--    untouched — a bot seat carries a label and nothing else (§17), and
--    hiding it would be a protection with no party to protect (rule 10).
--    KEPT, EXPLICITLY: **UPDATE.** Renaming your own `CPU 4` is cosmetic and
--    self-inflicted; it breaks nothing the product cannot recover from.
--    NARROWED: **DELETE.** Deleting a seat before its first pick is
--    permitted today (`draft_picks.team_id`'s FK is `NO ACTION`) and wedges
--    the mock at that seat's turn with no in-product recovery.
--    KEPT AS-IS: **INSERT** — the same predicate 053 wrote.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own standalone teams" ON teams;

DROP POLICY IF EXISTS "Users can insert own standalone teams" ON teams;
CREATE POLICY "Users can insert own standalone teams"
  ON teams FOR INSERT
  WITH CHECK (auth.uid() = owner_id AND league_id IS NULL);

DROP POLICY IF EXISTS "Users can update own standalone teams" ON teams;
CREATE POLICY "Users can update own standalone teams"
  ON teams FOR UPDATE
  USING (auth.uid() = owner_id AND league_id IS NULL)
  WITH CHECK (auth.uid() = owner_id AND league_id IS NULL);

DROP POLICY IF EXISTS "Users can delete own standalone teams" ON teams;
CREATE POLICY "Users can delete own standalone teams"
  ON teams FOR DELETE
  USING (auth.uid() = owner_id
         AND league_id IS NULL
         AND NOT team_is_mock_seat(id));

-- ---------------------------------------------------------------------------
-- 5. THE TWO `realtime.messages` `draft:%` POLICIES (F109(b)). Both gate on
--    `is_league_member(d.league_id)` through a subquery on `drafts`, so
--    without an arm **the launcher cannot subscribe to their own room and
--    the room is dead** — and the room is realtime-driven (tasks-M2 §4
--    rule 5). The four draft broadcast TRIGGER functions do not reference
--    `league_id` at all (measured, D234(5)), so the topic and payload layers
--    were already league-free: only these two read policies need the arm.
--    Replaced whole rather than patched, because a policy has no ALTER for
--    its expression; the league half is 088's text term for term.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "members read draft topics" ON realtime.messages;
CREATE POLICY "members read draft topics"
  ON realtime.messages FOR SELECT
  TO authenticated
  USING (
    (SELECT realtime.topic()) LIKE 'draft:%'
    AND EXISTS (
      SELECT 1 FROM public.drafts d
      WHERE 'draft:' || d.id::text = (SELECT realtime.topic())
        AND (public.is_league_member(d.league_id)
             OR public.is_standalone_mock_launcher(d.id))
    )
  );

DROP POLICY IF EXISTS "members track presence on draft topics" ON realtime.messages;
CREATE POLICY "members track presence on draft topics"
  ON realtime.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    extension = 'presence'
    AND (SELECT realtime.topic()) LIKE 'draft:%'
    AND EXISTS (
      SELECT 1 FROM public.drafts d
      WHERE 'draft:' || d.id::text = (SELECT realtime.topic())
        AND (public.is_league_member(d.league_id)
             OR public.is_standalone_mock_launcher(d.id))
    )
  );

-- ---------------------------------------------------------------------------
-- 6. F112 / R497 — `draft_mock_cpu_need` stops being client-callable.
--    089 shipped it with no REVOKE; 094 preserved that deliberately and
--    handed the question here. Measured before deciding: no `.rpc(
--    'draft_mock_cpu_need'` call site exists in `src/` (the only two
--    mentions are the generated `types/database.ts` and a test comment), so
--    D18->D23 applies with no carve-out — the server picks, a client never
--    asks — and it joins `draft_autopick_resolve`'s posture. The exposure
--    was a VALUE, not a write (the function is STABLE), which is why this is
--    a doctrine repair rather than an incident.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION draft_mock_cpu_need(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. create_mock_draft — DROP + CREATE (SIGNATURE CHANGE; head 094:152-459).
--    The league arm is 094's text; the standalone arm is new. The banner's
--    checklist says why this cannot be a CREATE OR REPLACE.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS create_mock_draft(UUID, UUID, TEXT, UUID);

CREATE FUNCTION create_mock_draft(
  p_league_id UUID DEFAULT NULL,
  p_human_team_id UUID DEFAULT NULL,
  p_cpu_speed TEXT DEFAULT 'realistic',
  p_action_id UUID DEFAULT NULL,
  p_settings JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league       public.leagues;
  v_active_count INTEGER;
  v_human        UUID;
  v_config       JSONB;
  v_real_order   JSONB;
  v_order        JSONB;
  v_mock_id      UUID;
  v_total_rounds INTEGER;
  v_timer        INTEGER;
  v_draft        public.drafts;
  v_active_mocks BIGINT;
  v_hour_creates BIGINT;
  -- 089 (L.C1.7) — the auction launch arm:
  v_type         TEXT;
  v_real_nom     JSONB;
  v_nom_order    JSONB;
  v_first        UUID;
  v_deadline     TIMESTAMPTZ;
  v_budget       INTEGER;
  v_reserve      INTEGER;
  -- 095 (MP.3) — the STANDALONE arm:
  v_uid          UUID;
  v_roster       JSONB;
  v_team_count   INTEGER;
  v_order_mode   TEXT;
  v_nom_mode     TEXT;
  v_seat_ids     UUID[] := '{}';
  v_seat         UUID;
  v_cpu_seats    JSONB := '[]'::jsonb;
  v_i            INTEGER;
  v_mock_block   JSONB;
BEGIN
  -- Argument shape (22023) before any data access.
  IF p_cpu_speed IS NULL OR p_cpu_speed NOT IN ('realistic', 'fast') THEN
    RAISE EXCEPTION 'create_mock_draft: cpu_speed must be realistic or fast'
      USING ERRCODE = '22023';
  END IF;

  -- 095/MP.3 — THE TWO ARMS ARE MUTUALLY EXCLUSIVE, AND SAYING SO IS THE
  -- WHOLE §4-rule-12 CONTRACT. A league mock's settings come from its
  -- league and are SNAPSHOTTED (D95: a mock never re-hydrates); a
  -- standalone mock's settings arrive as an OBJECT and the caller decides
  -- where the object came from. Accepting both at once would make the
  -- precedence a guess, and a caller who sent settings would silently get
  -- the league's instead.
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'create_mock_draft: must be signed in to practice'
      USING ERRCODE = '42501';
  END IF;
  IF p_league_id IS NOT NULL AND p_settings IS NOT NULL THEN
    RAISE EXCEPTION
      'create_mock_draft: a league mock takes its settings FROM the league — send settings only for a standalone practice draft (§8.8/D95)'
      USING ERRCODE = '22023';
  END IF;
  IF p_league_id IS NULL AND p_settings IS NULL THEN
    RAISE EXCEPTION
      'create_mock_draft: a standalone practice draft needs a settings object (team_count, roster_settings, draft)'
      USING ERRCODE = '22023';
  END IF;
  IF p_league_id IS NULL AND p_human_team_id IS NOT NULL THEN
    -- There is no franchise to borrow: this arm MINTS the human's seat.
    -- (MS.8's slot picker rides this same RPC as a future parameter — it
    -- chooses a POSITION in the order, never an existing team row.)
    RAISE EXCEPTION
      'create_mock_draft: a standalone practice draft mints its own seats — human_team_id applies to a league mock only'
      USING ERRCODE = '22023';
  END IF;

  -- Cap-race serializer (banner item 1): same-user concurrent launches
  -- serialize here so the §22.5 caps cannot be double-tapped past. An
  -- ADVISORY lock, deliberately not a profiles-row lock (row locks on
  -- profiles join the FK KEY-SHARE graph chat INSERTs touch — the R122
  -- deadlock class; advisory locks live outside it).
  PERFORM pg_advisory_xact_lock(
    hashtextextended('create_mock_draft:' || v_uid::text, 0));

  -- §4 rule 6 (E2) idempotency — batch 7, R149 (banner item 1): a retry of
  -- an already-committed launch returns the ORIGINAL mock, not a second
  -- one (the 060 replay pattern). AFTER the advisory lock (a concurrent
  -- double-tap serializes into create-then-replay) and BEFORE league/cap
  -- validation (the same intent must not trip caps its own creation
  -- already passed). Launcher-scoped + TEXT-compared (R117): a foreign
  -- caller's lookup simply misses and falls through to their own
  -- validation. A deleted mock does not replay (row = ledger). The replay
  -- is arm-agnostic on purpose — the action_id identifies the SUBMIT, and
  -- a retried submit must never mint a second set of seats.
  IF p_action_id IS NOT NULL THEN
    SELECT d.* INTO v_draft
    FROM public.drafts d
    WHERE d.is_mock
      AND d.config->'mock'->>'launched_by' = v_uid::text
      AND d.config->'mock'->>'action_id' = p_action_id::text;
    IF FOUND THEN
      RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'created', FALSE);
    END IF;
  END IF;

  v_mock_id := gen_random_uuid();

  IF p_league_id IS NULL THEN
    -- =====================================================================
    -- THE STANDALONE ARM (095/MP.3; D226/D227/D234; tasks-MP §4 rule 12).
    -- No league, no membership, no commissioner. The settings arrive as an
    -- object and are validated here; WHERE the object came from is the
    -- caller's business (MP.4 fills it from a base scoring template; league
    -- inheritance, when it returns, is a new SOURCE and not a rewrite).
    -- =====================================================================
    IF jsonb_typeof(p_settings) <> 'object' THEN
      RAISE EXCEPTION 'create_mock_draft: settings must be a JSON object'
        USING ERRCODE = '22023';
    END IF;

    -- team_count — the §7.2 v1 seat counts (league-settings.ts V1_TEAM_COUNTS).
    -- This is the one number that decides how many rows this transaction
    -- MINTS, so it is checked before anything is written.
    IF jsonb_typeof(p_settings->'team_count') <> 'number' THEN
      RAISE EXCEPTION 'create_mock_draft: settings.team_count is required (8, 10, 12, 14 or 16)'
        USING ERRCODE = '22023';
    END IF;
    v_team_count := (p_settings->>'team_count')::int;
    IF v_team_count NOT IN (8, 10, 12, 14, 16) THEN
      RAISE EXCEPTION
        'create_mock_draft: team_count % is not a v1 league size — practice with 8, 10, 12, 14 or 16 seats',
        v_team_count
        USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(p_settings->'roster_settings') <> 'object' THEN
      RAISE EXCEPTION 'create_mock_draft: settings.roster_settings is required (the roster shape MP.2 snapshots)'
        USING ERRCODE = '22023';
    END IF;
    v_roster := p_settings->'roster_settings';

    v_config := COALESCE(p_settings->'draft', '{}'::jsonb);
    IF jsonb_typeof(v_config) <> 'object' THEN
      RAISE EXCEPTION 'create_mock_draft: settings.draft must be a JSON object'
        USING ERRCODE = '22023';
    END IF;

    v_type := COALESCE(v_config->>'draft_type', 'snake');
    IF v_type NOT IN ('snake', 'linear', 'auction') THEN
      RAISE EXCEPTION 'create_mock_draft: draft_type % is not snake, linear or auction', v_type
        USING ERRCODE = '22023';
    END IF;

    -- The §7.3.8 ranges, mirrored from the ONE catalog the app validates
    -- against (`draftConfigSchema`, src/lib/leagues/settings/league-settings.ts
    -- :244-259). Mirrored DELIBERATELY rather than trusted: this RPC is
    -- EXECUTE-able by `authenticated`, so a client that skips the route
    -- reaches it directly, and every one of these knobs can WEDGE the
    -- engine (a 0-second bid clock never closes a nomination; a 0-round
    -- roster has nothing to draft). MP.4's form parses with the zod schema;
    -- this is the server floor under it, not a second opinion.
    PERFORM public.draft_settings_range_guard(v_config);

    v_order_mode := COALESCE(v_config->>'draft_order_mode', 'random');
    IF v_order_mode <> 'random' THEN
      -- A standalone mock has no stored league order to honour and no
      -- pre-draft lobby to have randomized one — `random` is the only mode
      -- that MEANS anything here. (MS.8's slot picker chooses the human's
      -- POSITION in that shuffle; it does not resurrect `manual`.)
      RAISE EXCEPTION
        'create_mock_draft: draft_order_mode % has no meaning without a league — a standalone practice draft shuffles its own seats',
        v_order_mode
        USING ERRCODE = '22023';
    END IF;
    v_nom_mode := COALESCE(v_config->>'nomination_order_mode', 'same_as_draft_order');
    IF v_nom_mode NOT IN ('same_as_draft_order', 'random') THEN
      RAISE EXCEPTION
        'create_mock_draft: nomination_order_mode % has no meaning without a league — use same_as_draft_order or random',
        v_nom_mode
        USING ERRCODE = '22023';
    END IF;

    -- MP.2's roster snapshot, written by this arm ITSELF — there is no
    -- league to copy it from, and both readers now RAISE on a mock whose
    -- config lacks the `roster` KEY (094 §2a/R491). Same key, same whole
    -- object, same reason.
    v_config := jsonb_set(v_config, '{roster}', v_roster);

  ELSE
    -- =====================================================================
    -- THE LEAGUE ARM — 092/094's text, unchanged (tasks-MP §4 rule 11).
    -- =====================================================================
    -- Fast-fail auth (no-leak: a nonexistent league answers 42501 too).
    IF NOT public.is_league_member(p_league_id) THEN
      RAISE EXCEPTION 'create_mock_draft: not a member of this league'
        USING ERRCODE = '42501';
    END IF;

    SELECT l.* INTO v_league
    FROM public.leagues l
    WHERE l.id = p_league_id AND l.deleted_at IS NULL;
    IF NOT FOUND THEN
      -- Soft-deleted league answers 404 for a legitimate member (063 rule).
      RAISE EXCEPTION 'create_mock_draft: league % not found', p_league_id
        USING ERRCODE = 'P0002';
    END IF;

    -- §8.8: mocks launch from a PRE-DRAFT league only.
    IF v_league.status NOT IN ('setup', 'scheduled') THEN
      RAISE EXCEPTION
        'create_mock_draft: league % is in % — practice drafts run before draft day (setup/scheduled)',
        p_league_id, v_league.status
        USING ERRCODE = 'P0001';
    END IF;

    -- D95: snapshot the REAL config at launch — a mock never re-hydrates.
    -- Read here so config-shape refusals (auction) answer before seat-map
    -- ones.
    v_config := COALESCE(v_league.settings->'draft', '{}'::jsonb);

    -- 094/MP.2 — the roster SHAPE joins the snapshot, because D95's promise
    -- was never true of it: `roster_settings` is a separate COLUMN on
    -- `leagues`, not part of `settings->'draft'`.
    v_config := jsonb_set(v_config, '{roster}',
                          COALESCE(v_league.roster_settings, '{}'::jsonb));
    v_roster := v_league.roster_settings;

    -- 089 (L.C1.7): the M3 seam is LIFTED — a mock auction launches through
    -- the same arm shape draft_start's auction arm has (084).
    v_type := COALESCE(v_config->>'draft_type', 'snake');

    -- D103(1): the full seat map must exist (draft_picks.team_id is NOT
    -- NULL and the order needs every seat) — the D96 mirror; friendly
    -- refusal names placeholder seats as the remedy.
    SELECT count(*) INTO v_active_count
    FROM public.teams t
    WHERE t.league_id = p_league_id AND t.status <> 'retired';
    IF v_active_count <> v_league.team_count THEN
      RAISE EXCEPTION
        'create_mock_draft: league % has % of % franchises seated — a mock drafts the full board, so every seat must exist; add placeholder seats for the empty slots (League home → Invite) (§8.8/D103)',
        p_league_id, v_active_count, v_league.team_count
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- §22.5 caps, in-body (friendly refusals — §16.5.2 states). Counted
  -- across ALL leagues AND standalone practice alike (per-USER caps — the
  -- cap has never been per-league, and a standalone mock costs the same
  -- tick budget as a league one).
  SELECT count(*) INTO v_active_mocks
  FROM public.drafts d
  WHERE d.is_mock
    AND d.status IN ('live', 'paused')
    AND d.config->'mock'->>'launched_by' = v_uid::text;
  IF v_active_mocks >= 3 THEN
    RAISE EXCEPTION
      'create_mock_draft: you already have 3 active mock drafts — finish or delete one first (§22.5)'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_hour_creates
  FROM public.drafts d
  WHERE d.is_mock
    AND d.config->'mock'->>'launched_by' = v_uid::text
    AND d.created_at > now() - interval '1 hour';
  IF v_hour_creates >= 5 THEN
    RAISE EXCEPTION
      'create_mock_draft: mock-draft creation is limited to 5 per hour — try again in a bit (§22.5)'
      USING ERRCODE = 'P0001';
  END IF;

  -- D91: rounds = starters + bench (IR excluded) — the same fn the real
  -- start uses, over the same object both arms just resolved.
  v_total_rounds := public.draft_rounds_from_roster(v_roster);
  IF v_total_rounds IS NULL OR v_total_rounds < 1 THEN
    -- The league arm's message is 092's, VERBATIM and golden-pinned
    -- (pgTAP 025). The standalone arm cannot use it — it names a league that
    -- does not exist and points at a settings screen that is not the one the
    -- caller used — so it gets its own, and the league text is untouched.
    IF p_league_id IS NULL THEN
      RAISE EXCEPTION
        'create_mock_draft: these roster settings produce no draftable rounds (rounds = starters + bench, D91) — add starting slots or bench spots'
        USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION
        'create_mock_draft: league % roster settings produce no draftable rounds (rounds = starters + bench, D91) — fix the roster in League settings',
        p_league_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_league_id IS NULL THEN
    -- ---------------------------------------------------------------------
    -- THE SEATS (D227). `draft_picks.team_id` is NOT NULL FK `teams`
    -- (065:160) and the order needs every seat, so a board with no league
    -- still needs N `teams` rows. They are standalone rows — `league_id
    -- NULL`, `list_id NULL`, owner = the launcher — minted INSIDE the
    -- launch transaction, so a failure anywhere below leaves none behind.
    -- The human's seat is minted too: with no league there is no franchise
    -- to borrow (D227(2)).
    -- ---------------------------------------------------------------------
    INSERT INTO public.teams (owner_id, name, league_id, list_id)
    VALUES (v_uid, 'My Team', NULL, NULL)
    RETURNING id INTO v_human;
    v_seat_ids := array_append(v_seat_ids, v_human);

    FOR v_i IN 1..(v_team_count - 1) LOOP
      -- D227(5): one naming rule, not a system. `CPU 1 … CPU N-1`. No
      -- avatars, no personas, no generated team names (tasks-MP §4 rule 16).
      INSERT INTO public.teams (owner_id, name, league_id, list_id)
      VALUES (v_uid, 'CPU ' || v_i::text, NULL, NULL)
      RETURNING id INTO v_seat;
      v_seat_ids := array_append(v_seat_ids, v_seat);
      v_cpu_seats := v_cpu_seats || to_jsonb(v_seat::text);
    END LOOP;

    -- The order: D105's deterministic md5 shuffle seeded by the MOCK's own
    -- id, over the seats this transaction just minted.
    --
    -- DELIBERATELY NOT `draft_resolve_order_internal` (066), and the reason
    -- matters more than the eleven lines it saves. That function resolves an
    -- order over a LEAGUE's seat table — every branch of it, including the
    -- shuffle, is `FROM public.teams t WHERE t.league_id = p_league_id`.
    -- Widening that to `IS NOT DISTINCT FROM` so it would accept a NULL
    -- league does not make it work: its shuffle branch would then select
    -- EVERY standalone team in the database. The candidate/manual/config
    -- machinery it exists for has no meaning here either — there is no
    -- stored league order and no lobby randomize to honour (D101), which is
    -- why `draft_order_mode` is refused above unless it is `random`. So the
    -- ONE implementation keeps the ONE question it answers, and this arm
    -- answers a different one over an array it holds in hand.
    SELECT jsonb_agg(to_jsonb(s.id) ORDER BY md5(v_mock_id::text || s.id::text))
      INTO v_order
    FROM unnest(v_seat_ids) AS s(id);

    IF v_type = 'auction' THEN
      IF v_nom_mode = 'random' THEN
        -- 084's derived seed, verbatim in shape: a random nomination order
        -- must not be a carbon copy of a random draft order (D105).
        SELECT jsonb_agg(to_jsonb(s.id)
                 ORDER BY md5(md5('nomination:' || v_mock_id::text) || s.id::text))
          INTO v_nom_order
        FROM unnest(v_seat_ids) AS s(id);
      ELSE
        v_nom_order := v_order;                  -- same_as_draft_order
      END IF;
    END IF;

  ELSE
    -- Seat resolution: default = the launcher's own franchise (§8.8 "their
    -- real seat by default"); ANY active seat selectable (placeholder or
    -- another member's franchise — authorization is launcher-keyed, D103).
    IF p_human_team_id IS NULL THEN
      SELECT m.team_id INTO v_human
      FROM public.league_members m
      WHERE m.league_id = p_league_id AND m.user_id = v_uid;
      IF v_human IS NULL THEN
        RAISE EXCEPTION
          'create_mock_draft: pick a seat to practice from — you have no franchise in this league'
          USING ERRCODE = 'P0001';
      END IF;
    ELSE
      SELECT t.id INTO v_human
      FROM public.teams t
      WHERE t.id = p_human_team_id
        AND t.league_id = p_league_id
        AND t.status <> 'retired';
      IF v_human IS NULL THEN
        RAISE EXCEPTION
          'create_mock_draft: team % is not an active franchise of league %',
          p_human_team_id, p_league_id
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- Order snapshot (§8.8 "order incl. their actual slot"): the real
    -- scheduled draft row's stored order is the candidate (the order the
    -- lobby shows — D101); resolution via the ONE implementation (066's
    -- draft_resolve_order_internal), seeded by the MOCK's own id so a
    -- never-randomized `random` league gets a fresh deterministic shuffle
    -- per mock (banner item 1).
    SELECT d.draft_order, d.nomination_order INTO v_real_order, v_real_nom
    FROM public.drafts d
    WHERE d.league_id = p_league_id
      AND d.is_mock = FALSE
      AND d.status IN ('scheduled', 'live', 'paused');

    v_order := public.draft_resolve_order_internal(
      p_league_id,
      v_league.team_count,
      COALESCE(v_config->>'draft_order_mode', 'random'),
      v_real_order,
      v_config->'draft_order',
      v_mock_id,
      'create_mock_draft');

    -- 089: nomination order (§8.3/§7.3.8) — auction only, through 084's ONE
    -- implementation with the rules draft_start applies.
    IF v_type = 'auction' THEN
      v_nom_order := public.draft_nomination_order_internal(
        p_league_id,
        v_league.team_count,
        COALESCE(v_config->>'nomination_order_mode', 'same_as_draft_order'),
        v_real_nom,
        v_order,
        v_mock_id,
        'create_mock_draft');
    END IF;
  END IF;

  -- Clock + first seat, per draft type (084's shape). An auction's first
  -- clock is the NOMINATION clock (§7.3.8's own catalog field) and is never
  -- NULL — an untimed pick_timer_seconds = 0 (§8.2's soft timer) is the
  -- snake clock's and does not touch it (084 banner item 3(c), mirrored).
  IF v_type = 'auction' THEN
    v_deadline := now() + make_interval(
      secs => COALESCE((v_config->>'auction_nomination_seconds')::int, 30));
    v_first    := (v_nom_order->>0)::uuid;        -- the first NOMINATOR (D126)
  ELSE
    v_timer    := COALESCE((v_config->>'pick_timer_seconds')::int, 90);
    v_deadline := CASE WHEN v_timer > 0
                       THEN now() + make_interval(secs => v_timer)
                       ELSE NULL END;             -- §8.2 soft timer: 0 ⇒ no clock
    v_first    := public.draft_team_for_pick(
      v_order, v_type,
      COALESCE((v_config->>'snake_reversal')::boolean, FALSE), 1);
  END IF;

  -- config.mock = {human_team_id, cpu_speed, launched_by} (§8.8 +
  -- D103(2)'s launched_by — erratum v2.8.16). Values stored as text
  -- (jsonb strings); every reader compares as TEXT (the R117 rule).
  -- action_id (the E2 replay ledger — R149) is stamped ONLY when the
  -- route sent one: the NULL path stores no key at all (pinned).
  --
  -- 095/MP.3 adds ONE key and only on the standalone arm: `cpu_seats`, the
  -- ids of the bot `teams` rows this transaction minted. It is not
  -- decoration — it is the DELETE authority for cleanup (delete_mock_draft
  -- / mock_draft_expire) and the predicate the narrowed teams policy reads
  -- (D227(4)). A league mock mints nothing, so it stores nothing: an unread
  -- stored field is a claim nobody checks (D236(4)).
  v_mock_block := jsonb_build_object(
    'human_team_id', v_human::text,
    'cpu_speed', p_cpu_speed,
    'launched_by', v_uid::text)
    || CASE WHEN p_action_id IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('action_id', p_action_id::text) END
    || CASE WHEN p_league_id IS NULL THEN jsonb_build_object('cpu_seats', v_cpu_seats)
            ELSE '{}'::jsonb END;
  v_config := jsonb_set(v_config, '{mock}', v_mock_block);

  -- Starts immediately (§8.8): live, pick 1 (= nomination sequence 1 for an
  -- auction — D126) on the clock; `current_nomination` NULL ⇒ the
  -- NOMINATING phase; `budget_adjustments` is the column default '{}' (a
  -- mock has no commissioner to adjust anything — D110(1)/D138). The D95
  -- partial unique ignores mocks — the league's real scheduled draft
  -- coexists (E60) — and it is `WHERE is_mock = false`, so a NULL
  -- `league_id` cannot collide with it either (measured, D234(4)).
  INSERT INTO public.drafts
    (id, league_id, draft_type, status, is_mock, config, draft_order,
     nomination_order, current_nomination,
     total_rounds, current_round, current_pick_number, on_clock_team_id,
     current_deadline, started_at)
  VALUES
    (v_mock_id, p_league_id,
     v_type,
     'live', TRUE, v_config, v_order,
     v_nom_order, NULL,
     v_total_rounds, 1, 1,
     v_first,
     v_deadline,
     now())
  RETURNING * INTO v_draft;

  -- 089: the §8.6.8 start-time backstop, mirrored from 084 (banner item 4)
  -- — read through the ONE derivation family on the LIVE mock row. A mock
  -- carries no budget_adjustments, so the only reachable cause is the
  -- settings knobs, and the message names them and the UNIT (D91 draftable
  -- slots — R318). A league that cannot START an auction cannot PRACTICE
  -- one either: "Same engine, literally" (§8.8) — and so, now, cannot a
  -- settings object (095: draft_auction_solvent sweeps the mock's own seat
  -- map when there is no league).
  IF v_type = 'auction' AND NOT public.draft_auction_solvent(v_mock_id) THEN
    v_budget  := COALESCE((v_config->>'auction_budget')::int, 200);
    -- 092/AP.1: the reserve, through the ONE authority (D198(1)).
    v_reserve := public.draft_auction_reserve(v_config);
    -- Same rule: 089's message is golden-pinned (pgTAP 038) and stays
    -- byte-for-byte on the league arm.
    IF p_league_id IS NULL THEN
      RAISE EXCEPTION
        'create_mock_draft: this setup cannot practice an auction — a $% budget cannot fill % draftable roster spots at a $% per-slot reserve (§8.6.8 solvency); raise the auction budget, or allow $0 nominations',
        v_budget, v_total_rounds, v_reserve
        USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION
        'create_mock_draft: league % cannot practice an auction — a $% budget cannot fill % draftable roster spots at a $% per-slot reserve (§8.6.8 solvency); raise the auction budget, or allow $0 nominations in League settings → Draft setup',
        p_league_id, v_budget, v_total_rounds, v_reserve
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Launch is the launcher's first liveness beat (banner item 1): the E59
  -- stale clock starts honest even if the room never mounts, and the
  -- expiry idle definition always has a beat to read.
  INSERT INTO public.draft_liveness (draft_id, user_id, last_seen_at)
  VALUES (v_mock_id, v_uid, now())
  ON CONFLICT (draft_id, user_id) DO UPDATE SET last_seen_at = now();

  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'created', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION create_mock_draft(UUID, UUID, TEXT, UUID, JSONB)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 8. delete_mock_draft — head 071:469-515. TWO hunks: the ownership arm,
--    and the cleanup (chat NULL-safe + the seats after the draft, with the
--    league_id IS NULL safety belt — banner item 6).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_mock_draft(p_draft_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft public.drafts;
BEGIN
  -- (1) LOCK the drafts row FIRST (§4.6) — a tick claim in flight
  -- serializes here; the SKIP LOCKED arms skip us symmetrically.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  -- (2) VALIDATE. No-leak: nonexistent draft and non-member get the same
  -- 42501. Deliberately NO deleted-league gate: deleting one's own mock
  -- under a soft-deleted league is cleanup and must not dead-end
  -- (membership rows survive the soft delete).
  IF NOT FOUND
     OR NOT (public.is_league_member(v_draft.league_id)
             OR public.is_standalone_mock_launcher(v_draft.id)) THEN
    RAISE EXCEPTION 'delete_mock_draft: not a member of this draft''s league'
      USING ERRCODE = '42501';
  END IF;

  IF NOT v_draft.is_mock THEN
    RAISE EXCEPTION 'delete_mock_draft: draft % is not a mock draft', p_draft_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Launcher-only (D103(2) doctrine) — commissioners included in the
  -- refusal: nobody else erases a member's solo practice.
  IF v_draft.config->'mock'->>'launched_by' IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION
      'delete_mock_draft: only the member who launched this mock can delete it (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  -- (3) Child cleanup: chat EXPLICITLY (FK is to the league — banner item
  -- 2), everything else rides ON DELETE CASCADE.
  DELETE FROM public.league_chat
  WHERE league_id IS NOT DISTINCT FROM v_draft.league_id
    AND context = 'draft:' || v_draft.id::text;

  DELETE FROM public.drafts WHERE id = v_draft.id;

  -- 095/MP.3 — THE SEATS, AFTER THE DRAFT (D227(6)). draft_picks/_bids/
  -- _queues cascade from `drafts`; `teams` does NOT, and draft_picks.team_id
  -- is a plain NO ACTION reference, so the order is not a preference: seats
  -- first would hit the FK. `league_id IS NULL` is the SAFETY BELT the task
  -- text asks for — a malformed cpu_seats array must be INCAPABLE of
  -- deleting a real franchise, whatever it contains. The human seat goes
  -- with them: on a standalone mock this RPC minted it, and no other draft
  -- can reference it (a seat belongs to exactly one mock).
  IF v_draft.league_id IS NULL THEN
    DELETE FROM public.teams t
    WHERE t.league_id IS NULL
      AND t.owner_id::text = v_draft.config->'mock'->>'launched_by'
      AND (t.id::text = v_draft.config->'mock'->>'human_team_id'
           OR (v_draft.config->'mock'->'cpu_seats') ? t.id::text);
  END IF;
END;
$$;

-- §4.1 posture restated after the replace (093 precedent).
REVOKE EXECUTE ON FUNCTION delete_mock_draft(UUID) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 9. mock_draft_expire — head 071:524-607. ONE hunk: the same cleanup, so
--    the 72h cron does not leave orphan seats behind forever.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mock_draft_expire()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_batch    CONSTANT INTEGER := 25;
  c_max_loops CONSTANT INTEGER := 40;
  v_row      RECORD;
  v_draft    public.drafts;
  v_idle     TIMESTAMPTZ;
  v_seen     UUID[] := '{}';
  v_pass     INTEGER;
  v_loops    INTEGER := 0;
  v_expired  INTEGER := 0;
  v_failures JSONB := '[]'::jsonb;
BEGIN
  LOOP
    v_loops := v_loops + 1;
    v_pass := 0;

    FOR v_row IN
      SELECT d.id
      FROM public.drafts d
      WHERE d.is_mock
        AND d.status <> 'complete'          -- recaps kept until owner-deleted
        AND NOT (d.id = ANY(v_seen))
        -- Idle > 72h: neither engine activity nor a launcher heartbeat.
        AND GREATEST(
              d.updated_at,
              COALESCE((SELECT dl.last_seen_at
                        FROM public.draft_liveness dl
                        WHERE dl.draft_id = d.id
                          AND dl.user_id::text = d.config->'mock'->>'launched_by'),
                       '-infinity'::timestamptz)
            ) < now() - interval '72 hours'
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_seen := v_seen || v_row.id;
      BEGIN
        SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_row.id;
        -- Re-verify under the held lock (authoritative — the claim is a
        -- snapshot pre-filter, the R135 discipline).
        IF v_draft.status = 'complete' OR NOT v_draft.is_mock THEN
          CONTINUE;
        END IF;
        v_idle := GREATEST(
          v_draft.updated_at,
          COALESCE((SELECT dl.last_seen_at
                    FROM public.draft_liveness dl
                    WHERE dl.draft_id = v_draft.id
                      AND dl.user_id::text = v_draft.config->'mock'->>'launched_by'),
                   '-infinity'::timestamptz));
        IF v_idle >= now() - interval '72 hours' THEN
          CONTINUE;
        END IF;

        -- Same cleanup as delete_mock_draft (chat explicit, CASCADE for
        -- the rest).
        DELETE FROM public.league_chat
        WHERE league_id IS NOT DISTINCT FROM v_draft.league_id
          AND context = 'draft:' || v_draft.id::text;
        DELETE FROM public.drafts WHERE id = v_draft.id;
        -- 095/MP.3 — the seats, after the draft, with the same
        -- `league_id IS NULL` safety belt delete_mock_draft carries
        -- (D227(6)). A cron that leaves orphan seats behind is a cron that
        -- grows the teams table forever.
        IF v_draft.league_id IS NULL THEN
          DELETE FROM public.teams t
          WHERE t.league_id IS NULL
            AND t.owner_id::text = v_draft.config->'mock'->>'launched_by'
            AND (t.id::text = v_draft.config->'mock'->>'human_team_id'
                 OR (v_draft.config->'mock'->'cpu_seats') ? t.id::text);
        END IF;
        v_expired := v_expired + 1;
      EXCEPTION WHEN OTHERS THEN
        v_failures := v_failures || jsonb_build_object(
          'draft_id', v_row.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'mock_draft_expire failed for draft %: % (%)',
          v_row.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass = 0 OR v_loops >= c_max_loops;
  END LOOP;

  RETURN jsonb_build_object(
    'expired', v_expired,
    'failures', v_failures,
    'loops', v_loops);
END;
$$;

-- §4.1 posture restated after the replace (093 precedent).
REVOKE EXECUTE ON FUNCTION mock_draft_expire() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. draft_tick — head 093:666-1685. TWELVE hunks, each the same one-line
--     substitution onto draft_league_alive(). Banner item 3(a) says which
--     TEN a standalone mock needs, which TWO are inert, and which TWO
--     references (ARM 1's league scan) are deliberately untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_tick()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_batch     CONSTANT INTEGER := 25;
  c_max_loops CONSTANT INTEGER := 40;
  v_lg             RECORD;
  v_at             TIMESTAMPTZ;
  v_res            JSONB;
  v_scanned        INTEGER := 0;
  v_started        INTEGER := 0;
  v_start_failures JSONB := '[]'::jsonb;
  v_seen           UUID[] := '{}';
  v_pass           INTEGER;
  v_row            RECORD;
  v_draft          public.drafts;
  v_user           UUID;
  v_autodraft      BOOLEAN;
  v_grace          INTEGER;
  v_fresh          BOOLEAN;
  v_player         TEXT;
  v_claimed        INTEGER := 0;
  v_picked         INTEGER := 0;
  v_held           INTEGER := 0;
  v_pick_failures  JSONB := '[]'::jsonb;
  v_loops          INTEGER := 0;
  v_od             RECORD;
  v_ograce         INTEGER;
  v_established    BOOLEAN;
  v_supervised     BOOLEAN;
  v_outage_paused  INTEGER := 0;
  v_outage_failures JSONB := '[]'::jsonb;
  v_hb             RECORD;
  v_heartbeats     INTEGER := 0;
  v_heartbeat_failures JSONB := '[]'::jsonb;
  v_mk             RECORD;
  v_mock_paused    INTEGER := 0;
  v_mock_pause_failures JSONB := '[]'::jsonb;
  v_mock_seen      UUID[] := '{}';
  v_mock_picked    INTEGER := 0;
  v_mock_cpu_failures JSONB := '[]'::jsonb;
  v_mock_loops     INTEGER := 0;
  -- 086 (L.C1.4) — ARM 2.6, the auction clock:
  v_auc_seen       UUID[] := '{}';
  v_auc_loops      INTEGER := 0;
  v_auc_claimed    INTEGER := 0;
  v_auc_nominated  INTEGER := 0;
  v_auc_awarded    INTEGER := 0;
  v_auc_held       INTEGER := 0;
  v_auc_completed  INTEGER := 0;
  v_auc_failures   JSONB := '[]'::jsonb;
  -- 093/AP.2: the award's own locals moved into
  -- `draft_award_nomination_internal` with the arm that used them
  -- (v_reserve / v_remaining / v_open / v_max_bid / v_price / v_win_team /
  -- v_is_auto / v_order / v_n / v_idx / v_step / v_next_team). `v_win_player`
  -- STAYS — ARM 2.6(c)'s candidate scan reads it too.
  v_win_player     TEXT;
  -- 089 (L.C1.7) — ARM 2.6(c), the mock CPU sub-arm (D132):
  v_cpu_seen       UUID[] := '{}';
  v_cpu_loops      INTEGER := 0;
  v_cpu_claimed    INTEGER := 0;
  v_cpu_nominated  INTEGER := 0;
  v_cpu_raised     INTEGER := 0;
  v_cpu_folded     INTEGER := 0;
  v_cpu_failures   JSONB := '[]'::jsonb;
  v_bid_count      INTEGER;
  v_high_team      UUID;
  -- 091 (AP.3) — the value model's inputs, the candidate scan and the raise
  -- amount all moved into draft_mock_cpu_respond_internal, so this arm's
  -- own state is now one integer: the number of raises the responder wrote.
  v_cpu_step       INTEGER;
BEGIN
  -- -------------------------------------------------------------------------
  -- ARM 1 — D94 auto-start: scan scheduled LEAGUES (never the drafts
  -- table), create the drafts row if absent, start. Failures recorded +
  -- retried every tick, never a silent skip.
  -- -------------------------------------------------------------------------
  FOR v_lg IN
    SELECT l.id, l.settings->'draft'->>'draft_scheduled_at' AS at_txt
    FROM public.leagues l
    WHERE l.status = 'scheduled'
      AND l.deleted_at IS NULL
      AND COALESCE(l.settings->'draft'->>'draft_scheduled_at', '') <> ''
  LOOP
    v_scanned := v_scanned + 1;
    BEGIN
      -- Cast inside the per-league subtransaction: a malformed stored
      -- instant becomes THIS league's recorded failure, never a scan
      -- abort.
      v_at := v_lg.at_txt::timestamptz;
      IF v_at > now() THEN
        CONTINUE;
      END IF;

      -- Claim without waiting (§4.6: the tick never blocks — or waits
      -- behind — a user action; a held league row retries next tick).
      PERFORM 1 FROM public.leagues l
      WHERE l.id = v_lg.id AND l.status = 'scheduled' AND l.deleted_at IS NULL
      FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      -- The ONE start implementation (066): create-if-absent + capacity +
      -- snapshot-before-transition, commissioner gate skipped (cron has no
      -- JWT; this RPC's authority is its REVOKE narrowing).
      v_res := public.draft_start_internal(v_lg.id, FALSE);
      IF (v_res->>'started')::boolean THEN
        v_started := v_started + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_start_failures := v_start_failures || jsonb_build_object(
        'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
      RAISE WARNING 'draft_tick auto-start failed for league %: % (%)',
        v_lg.id, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- ARM 1.5 — §8.7 commissioner-outage auto-pause (D102/§8.7:478; landed
  -- with L.B1.4/069 — see the banner). Runs BEFORE the timeout arm so an
  -- expired deadline under an outage pauses instead of autopicking (pinned:
  -- pgTAP 023 §H's R136 case — a deadline past deadline+grace under an
  -- outage pauses with NEGATIVE remaining and ZERO picks). The candidacy
  -- test covers ALL live non-mock drafts (not just due ones — the pause
  -- must freeze a still-running clock through the outage), but the CLAIM
  -- locks ONLY outage candidates (R135, M2 batch 5): the pre-fix
  -- unfiltered claim FOR UPDATE'd every live non-mock draft each tick and
  -- held the locks for the rest of the tick transaction, serializing every
  -- pick on every live draft behind the batch every 5s — against the
  -- §22.3/§22.6 load posture. The WHERE below is the same
  -- established-then-lost supervision predicate the body re-verifies UNDER
  -- the lock (claim = pre-filter against a snapshot; body = authoritative);
  -- a filter bug that over-claims costs only lock scope (pgTAP 023 §H's
  -- lock-visibility pins catch it), one that under-claims would miss the
  -- pause (023 §H's 76s-threshold pins catch that direction). Batch-capped
  -- at c_batch for symmetry with ARM 2 — no loop (an outage pause is
  -- idempotent and not deadline-urgent the way a timeout is). CORRECTED,
  -- R141 (batch-5 addendum): "overflow candidates are claimed on the next
  -- 5s tick" is guaranteed only INSIDE the ≤25-draft M2 gate, where the
  -- candidate set can never exceed c_batch. This claim has no ORDER BY, no
  -- loop, and no v_seen, so beyond the gate nothing rotates the batch:
  -- ≥ c_batch candidates that never leave the set (e.g. rows the body
  -- persistently fails on — recorded outage_failures) could recur in every
  -- batch while real outage candidates starve, and a starved candidate
  -- whose deadline is due is autopicked by ARM 2 in the SAME tick. The one
  -- known PERMANENT class (soft-deleted league) is excluded from the claim
  -- below; the beyond-gate rotation hazard is F50's (M7/L.F1 §22.6 load
  -- gate — the ARM-2 loop+v_seen shape is the fix when scale demands it).
  -- Freshness AS-OF-NOW; the never-connected exemption; resume is a
  -- commissioner action (the tick never auto-resumes).
  -- -------------------------------------------------------------------------
  FOR v_od IN
    SELECT d.id
    FROM public.drafts d
    WHERE d.status = 'live' AND d.is_mock = FALSE
      -- Supervision was ESTABLISHED (some commissioner/co-commissioner has
      -- heartbeat this draft at least once)…
      AND EXISTS (
        SELECT 1
        FROM public.draft_liveness dl
        JOIN public.league_members m
          ON m.league_id = d.league_id AND m.user_id = dl.user_id
        WHERE dl.draft_id = d.id
          AND m.role IN ('commissioner', 'co_commissioner')
      )
      -- …and then LOST (no commissioner beat within freshness + grace).
      AND NOT EXISTS (
        SELECT 1
        FROM public.draft_liveness dl
        JOIN public.league_members m
          ON m.league_id = d.league_id AND m.user_id = dl.user_id
        WHERE dl.draft_id = d.id
          AND m.role IN ('commissioner', 'co_commissioner')
          AND dl.last_seen_at > now() - (public.draft_liveness_freshness()
                + make_interval(secs => COALESCE(
                    (d.config->>'disconnect_grace_seconds')::int, 30)))
      )
      -- …and the league is ALIVE (R141, batch-5 addendum — the body's
      -- deleted-league re-check mirrored into the claim): without this, a
      -- live draft under a soft-deleted league matched the claim WHERE
      -- FOREVER (claimed + locked every tick, body-skipped by the
      -- deleted-league CONTINUE, never paused, never leaving the candidate
      -- set) — the permanent-candidate class that falsified the no-loop
      -- rationale below. Reachable today: soft_delete_league (060) has no
      -- draft-status gate.
      AND public.draft_league_alive(d.league_id)
    LIMIT c_batch
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_od.id;
      IF v_draft.status <> 'live' THEN
        CONTINUE;
      END IF;
      IF NOT public.draft_league_alive(v_draft.league_id) THEN
        CONTINUE;
      END IF;

      v_ograce := COALESCE(
        (v_draft.config->>'disconnect_grace_seconds')::int, 30);

      -- Supervision was ESTABLISHED: some commissioner/co-commissioner
      -- has heartbeat this draft at least once (else: D94's unattended
      -- autopilot — never paused; the banner's never-connected exemption).
      SELECT
        count(*) > 0,
        count(*) FILTER (
          WHERE dl.last_seen_at > now() - (public.draft_liveness_freshness()
                                           + make_interval(secs => v_ograce))
        ) > 0
      INTO v_established, v_supervised
      FROM public.draft_liveness dl
      JOIN public.league_members m
        ON m.league_id = v_draft.league_id AND m.user_id = dl.user_id
      WHERE dl.draft_id = v_draft.id
        AND m.role IN ('commissioner', 'co_commissioner');

      IF v_established AND NOT v_supervised THEN
        -- The ONE pause-bookkeeping path (069's draft_pause_internal);
        -- system post with NO acting user (the tick has no JWT).
        PERFORM public.draft_pause_internal(
          v_draft.id, NULL,
          'Draft auto-paused: no commissioner or co-commissioner is connected. '
          || 'A commissioner can resume from the draft room.');
        v_outage_paused := v_outage_paused + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_outage_failures := v_outage_failures || jsonb_build_object(
        'draft_id', v_od.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
      RAISE WARNING 'draft_tick outage arm failed for draft %: % (%)',
        v_od.id, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- ARM 1.6 — THE E59 MOCK STALE-PAUSE (L.B1.6/071 — amended in place,
  -- F12; D93/§8.8). A live MOCK auto-pauses when the LAUNCHER's heartbeat
  -- is stale past disconnect_grace_seconds + one tick (5s) — the D93
  -- threshold, keyed on config.mock.launched_by (never the on-clock
  -- seat's owner: the whole room is one human's practice, and without
  -- them watching there is no point burning CPU picks — E59). Runs
  -- BEFORE the timeout arm so the pause always preempts the grace-hold's
  -- deadline+grace autopick: a seat stale AS OF its deadline last beat at
  -- ≤ deadline − 45s, so the pause threshold (last beat + grace + 5s ≤
  -- deadline + grace − 40s) expires strictly before the hold does — the
  -- disconnected human never loses their pick to a timeout (pinned in
  -- 025). CLAIM SCOPE (the R135/R141 discipline — the task charge "mock
  -- arms must not widen any lock scope beyond due/claimable mocks"): the
  -- WHERE is the body's predicate — live + mock + alive league + stale
  -- launcher — so a healthy mock (fresh beat) is NEVER locked by this
  -- arm; COALESCE(beat, started_at, created_at) guards fixture mocks
  -- with no seeded beat (create_mock_draft always seeds one). Resume is
  -- the LAUNCHER's action (069's draft_resume mock arm) — the tick never
  -- auto-resumes (the ARM 1.5 symmetry: a deliberate pause must not be
  -- fought by the clock).
  -- -------------------------------------------------------------------------
  FOR v_mk IN
    SELECT d.id
    FROM public.drafts d
    WHERE d.status = 'live'
      AND d.is_mock
      AND public.draft_league_alive(d.league_id)
      AND COALESCE(
            (SELECT dl.last_seen_at
             FROM public.draft_liveness dl
             WHERE dl.draft_id = d.id
               AND dl.user_id::text = d.config->'mock'->>'launched_by'),
            d.started_at, d.created_at)
          < now() - (make_interval(secs => COALESCE(
                       (d.config->>'disconnect_grace_seconds')::int, 30))
                     + interval '5 seconds')
    LIMIT c_batch
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_mk.id;
      -- Re-verify under the held lock (claim = snapshot pre-filter; body =
      -- authoritative — the R135 discipline).
      IF v_draft.status <> 'live' OR NOT v_draft.is_mock THEN
        CONTINUE;
      END IF;
      IF NOT public.draft_league_alive(v_draft.league_id) THEN
        CONTINUE;
      END IF;
      IF COALESCE(
           (SELECT dl.last_seen_at
            FROM public.draft_liveness dl
            WHERE dl.draft_id = v_draft.id
              AND dl.user_id::text = v_draft.config->'mock'->>'launched_by'),
           v_draft.started_at, v_draft.created_at)
         >= now() - (make_interval(secs => COALESCE(
                       (v_draft.config->>'disconnect_grace_seconds')::int, 30))
                     + interval '5 seconds') THEN
        CONTINUE;
      END IF;

      -- The ONE pause-bookkeeping path (069's draft_pause_internal —
      -- call-time-resolved, the ARM 1.5 forward-reference rationale: no
      -- live mock can exist in the 068→071 window since create_mock_draft
      -- is 071's); system post with NO acting user, scoped to the mock's
      -- own chat context (zero league side effects).
      PERFORM public.draft_pause_internal(
        v_draft.id, NULL,
        'Mock draft auto-paused — you left the room. Resume your practice from the league page.');
      v_mock_paused := v_mock_paused + 1;
    EXCEPTION WHEN OTHERS THEN
      v_mock_pause_failures := v_mock_pause_failures || jsonb_build_object(
        'draft_id', v_mk.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
      RAISE WARNING 'draft_tick mock stale-pause failed for draft %: % (%)',
        v_mk.id, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- ARM 2 — timeout → autopick per the D102 contract; batch-limited loop
  -- until no due rows (§22.3), FOR UPDATE SKIP LOCKED claims (§4.6).
  -- 086/L.C1.4: AUCTIONS ARE EXCLUDED, in the claim AND in the under-lock
  -- re-verify. This arm is the SNAKE/LINEAR pick clock — it resolves one
  -- player and writes it through draft_apply_pick_internal, which advances
  -- by draft_team_for_pick and prices nothing. 068 had no draft_type
  -- awareness at all, and once 084 made auctions startable that was a live
  -- defect, measured before this migration was written: an auction whose
  -- NOMINATION clock expired past deadline + grace had a player handed to
  -- the on-clock team for free — draft_picks(round=1, price=NULL,
  -- is_auto=t), current_pick_number advanced, ZERO draft_bids rows and
  -- current_nomination still NULL. ARM 2.6 below owns both auction clocks;
  -- 035 §C pins that a due auction is not snake-autopicked.
  -- -------------------------------------------------------------------------
  LOOP
    v_loops := v_loops + 1;
    v_pass := 0;

    FOR v_row IN
      SELECT d.id
      FROM public.drafts d
      WHERE d.status = 'live'
        AND d.draft_type <> 'auction'          -- 086: ARM 2.6 owns auctions
        AND d.current_deadline IS NOT NULL
        AND d.current_deadline <= now()
        AND NOT (d.id = ANY(v_seen))
      ORDER BY d.current_deadline
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_claimed := v_claimed + 1;
      v_seen := v_seen || v_row.id;

      BEGIN
        SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_row.id;

        -- Re-verify under the held lock (the claim's snapshot may predate
        -- a concurrent pick that advanced the clock).
        IF v_draft.status <> 'live'
           OR v_draft.draft_type = 'auction'    -- 086: ARM 2.6 owns auctions
           OR v_draft.current_deadline IS NULL
           OR v_draft.current_deadline > now()
           OR v_draft.on_clock_team_id IS NULL THEN
          CONTINUE;
        END IF;
        -- Defensive: a live draft under a soft-deleted league is not ours
        -- to advance.
        IF NOT public.draft_league_alive(v_draft.league_id) THEN
          CONTINUE;
        END IF;

        -- Seat-user derivation. MOCK BRANCH (L.B1.6/071 — D93/D103): the
        -- HUMAN seat keys freshness/grace on the LAUNCHER (the seat's
        -- real owner and their is_autodraft are irrelevant inside a
        -- practice room — the launcher wants the clock pressure, §8.8);
        -- every CPU seat is a no-user seat here (immediate autopick —
        -- normally ARM 2.5 picks it BEFORE the deadline, so reaching this
        -- arm means the tick was down past the deadline, and the timeout
        -- semantics are identical).
        IF v_draft.is_mock THEN
          IF v_draft.config->'mock'->>'human_team_id'
             = v_draft.on_clock_team_id::text THEN
            v_user := (v_draft.config->'mock'->>'launched_by')::uuid;
          ELSE
            v_user := NULL;
          END IF;
          v_autodraft := FALSE;
        ELSE
          SELECT m.user_id, COALESCE(m.is_autodraft, FALSE)
            INTO v_user, v_autodraft
          FROM public.league_members m
          WHERE m.league_id = v_draft.league_id
            AND m.team_id = v_draft.on_clock_team_id;
        END IF;

        v_grace := COALESCE(
          (v_draft.config->>'disconnect_grace_seconds')::int, 30);

        -- D102: only a STALE HUMAN seat gets the grace hold. is_autodraft
        -- seats, no-user seats (placeholder/vacated — E48), and seats
        -- FRESH AS OF THE DEADLINE autopick AT the deadline (§8.5.4).
        IF v_user IS NOT NULL AND NOT COALESCE(v_autodraft, FALSE) THEN
          -- R132: the branch is decided from freshness AS OF THE DEADLINE
          -- INSTANT — a heartbeat in (deadline − freshness, deadline].
          -- Re-deriving it from now() each tick let a returning manager's
          -- own post-deadline heartbeat retroactively grant the
          -- fresh-at-expiry branch, and the next tick autopicked them
          -- INSIDE the grace window (§8.5.5/E3 defeated in exactly the
          -- scenario the hold exists for). The lower bound is STRICT so
          -- the pinned 45s constant keeps both behavioral sides against a
          -- 1s-past deadline (44s-old fresh / 46s-old stale — pgTAP 022);
          -- the upper bound is what makes a mid-hold reconnect unable to
          -- end the hold (it restores MANUAL control only —
          -- draft_make_pick never checks the deadline). Recorded
          -- residual: the PK upsert keeps ONE row per (draft, user), so a
          -- beat landing between the deadline and the tick OVERWRITES the
          -- pre-deadline evidence and that seat takes the hold — the
          -- error direction is the protective §8.5.5 hold, never an early
          -- autopick.
          v_fresh := EXISTS (
            SELECT 1 FROM public.draft_liveness dl
            WHERE dl.draft_id = v_draft.id
              AND dl.user_id = v_user
              AND dl.last_seen_at > v_draft.current_deadline
                                    - public.draft_liveness_freshness()
              AND dl.last_seen_at <= v_draft.current_deadline
          );
          IF NOT v_fresh
             AND now() < v_draft.current_deadline
                         + make_interval(secs => v_grace) THEN
            -- HELD OPEN: deadline stays past-due; a returning human may
            -- pick manually during the hold (§8.5.5/E3) — re-evaluated
            -- every tick until deadline + grace; a mid-hold heartbeat
            -- never ends the hold (R132).
            v_held := v_held + 1;
            CONTINUE;
          END IF;
        END IF;

        v_player := public.draft_autopick_resolve(
          v_draft.id, v_draft.on_clock_team_id);
        IF v_player IS NULL THEN
          RAISE EXCEPTION
            'draft_tick: no available player to autopick in draft % (pool exhausted)',
            v_draft.id;
        END IF;

        -- The SAME advance path as a manual pick (066 — reuse, never
        -- fork): §12.4 system-pick shape.
        PERFORM public.draft_apply_pick_internal(
          v_draft.id, v_player, TRUE, 'autopick', NULL, NULL);
        v_picked := v_picked + 1;
      EXCEPTION WHEN OTHERS THEN
        v_pick_failures := v_pick_failures || jsonb_build_object(
          'draft_id', v_row.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'draft_tick timeout arm failed for draft %: % (%)',
          v_row.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass = 0 OR v_loops >= c_max_loops;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- ARM 2.5 — MOCK CPU THINK-TIME PICKS (L.B1.6/071 — amended in place,
  -- F12; D93/§8.8, plan §4.2). Every non-human seat in a live mock picks
  -- when its think-time elapses: due = pick start + PRNG(draft_id,
  -- pick_number) → 20–70% of the clock (`realistic`) or ~2s (`fast`) —
  -- draft_mock_cpu_due, the ONE due computation for claim AND re-check.
  -- THE PICK ITSELF IS THE AUTOPICK STRATEGY FN (draft_autopick_resolve →
  -- draft_apply_pick_internal — the same brain and the same advance path
  -- as a live timeout; "one implementation, two consumers" — the DoD
  -- break-probe target: a forked raw-ADP CPU fails 025's need-fit board
  -- pins). The human seat is NEVER touched by this arm (its clock is
  -- always real — §8.8; ARM 2 owns its timeout at the deadline). CLAIM
  -- SCOPE (R135/R141 + the task charge): the WHERE is the body's
  -- predicate — live + mock + CPU on clock + due + alive league — so a
  -- mock whose CPU is still thinking is NEVER locked. One CPU pick per
  -- mock per pass (the think origin is the advance instant, so the next
  -- pick's due is always in the future at apply time): `fast` ≈ 2s
  -- think-time lands on the first tick after it elapses — effective
  -- cadence bounded by the 5s tick, the same granularity class D87
  -- records for timeout lag (recorded residual). Runs AFTER ARM 2 (a
  -- deadline-expired mock CPU seat is ARM 2's immediate autopick; the
  -- fresh deadline it writes puts the next due in the future) and BEFORE
  -- ARM 3 (a just-made CPU pick's fresh deadline beats in the same pass).
  -- 086/R362 — AUCTIONS ARE EXCLUDED HERE TOO, in the claim AND the
  -- under-lock re-verify, for the same reason ARM 2 is: this arm's pick
  -- path is draft_autopick_resolve → draft_apply_pick_internal, the SNAKE
  -- writer. The exclusion is not inferred from that intent — it was
  -- MEASURED on this branch before the two lines were added. A privileged
  -- fixture (a live is_mock=true, draft_type='auction' draft, a CPU seat
  -- on the clock, cpu_speed 'fast' so the think-time is due while the
  -- deadline is still 30s away, started_at fresh so ARM 1.6 cannot claim
  -- it) put through one draft_tick() returned "mock_cpu_picked": 1 and
  -- wrote draft_picks(pick_number=1, round=1, price=NULL, is_auto=t,
  -- made_via='autopick'), advanced current_pick_number to 2, recorded
  -- ZERO draft_bids and left current_nomination NULL — the EXACT shape
  -- this migration closes for ARM 2, reached through a second door.
  -- It is unreachable today (071's create_mock_draft refuses auction
  -- configs and a mock's draft_type is snapshotted at creation; 085's
  -- verbs refuse mocks — F61), so it was never a live defect; it is fixed
  -- rather than disclosed because an unfixed arm is a hand-off L.C1.7
  -- would have to remember (R51), and because the banner's seam statement
  -- is only true once BOTH snake arms decline auctions. 035 §J pins it.
  -- -------------------------------------------------------------------------
  LOOP
    v_mock_loops := v_mock_loops + 1;
    v_pass := 0;

    FOR v_row IN
      SELECT d.id
      FROM public.drafts d
      WHERE d.status = 'live'
        AND d.is_mock
        AND d.draft_type <> 'auction'          -- 086/R362: this arm is the SNAKE CPU clock
        AND d.on_clock_team_id IS NOT NULL
        AND d.config->'mock'->>'human_team_id'
            IS DISTINCT FROM d.on_clock_team_id::text
        AND NOT (d.id = ANY(v_mock_seen))
        AND public.draft_league_alive(d.league_id)
        AND now() >= public.draft_mock_cpu_due(
              d.id, d.config, d.current_deadline, d.updated_at,
              d.current_pick_number)
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_mock_seen := v_mock_seen || v_row.id;

      BEGIN
        SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_row.id;

        -- Re-verify under the held lock (claim = snapshot pre-filter).
        IF v_draft.status <> 'live'
           OR NOT v_draft.is_mock
           OR v_draft.draft_type = 'auction'    -- 086/R362: snake CPU clock only
           OR v_draft.on_clock_team_id IS NULL
           OR v_draft.config->'mock'->>'human_team_id'
              = v_draft.on_clock_team_id::text
           OR now() < public.draft_mock_cpu_due(
                v_draft.id, v_draft.config, v_draft.current_deadline,
                v_draft.updated_at, v_draft.current_pick_number) THEN
          CONTINUE;
        END IF;
        IF NOT public.draft_league_alive(v_draft.league_id) THEN
          CONTINUE;
        END IF;

        -- THE SHARED BRAIN (D93/plan §4.2 — never a fork): resolution +
        -- the ONE advance path, §12.4's system-pick shape.
        v_player := public.draft_autopick_resolve(
          v_draft.id, v_draft.on_clock_team_id);
        IF v_player IS NULL THEN
          RAISE EXCEPTION
            'draft_tick: no available player for the CPU pick in mock draft % (pool exhausted)',
            v_draft.id;
        END IF;
        PERFORM public.draft_apply_pick_internal(
          v_draft.id, v_player, TRUE, 'autopick', NULL, NULL);
        v_mock_picked := v_mock_picked + 1;
      EXCEPTION WHEN OTHERS THEN
        v_mock_cpu_failures := v_mock_cpu_failures || jsonb_build_object(
          'draft_id', v_row.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'draft_tick mock CPU arm failed for draft %: % (%)',
          v_row.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass = 0 OR v_mock_loops >= c_max_loops;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- ARM 2.6 — THE AUCTION CLOCK (086/L.C1.4; §8.6.2 nomination timeout,
  -- §8.6.4 bid close, §8.6.6 completion, §8.6.7(b)(c)(e), §8.6.8 solvency;
  -- D126/D129(2)(3)(4)/D130). TWO sub-arms on ONE claim, selected by D126's
  -- phase rule: `current_nomination` NULL ⇒ the NOMINATION clock expired;
  -- non-NULL ⇒ the BID clock expired. Runs AFTER ARM 2.5 and BEFORE ARM 3
  -- exactly as tasks-M3 §6 sequences it, so an award or a system nomination
  -- is reflected in the same pass's heartbeat.
  -- CLAIM SCOPE (R135/R141): the WHERE is the body's own predicate — live +
  -- auction + due + alive league — so an auction mid-clock is never locked
  -- by this arm, and every predicate is re-verified under the held lock
  -- below. The c_batch ceiling and its >25-candidate rotation behaviour are
  -- ARM 2's, inherited deliberately: tasks-M3 §10 routes that to F50 (M7)
  -- and says ARM 2.6 shares it with no new row.
  -- MOCKS ARE IN (089/L.C1.7 — D132/D138): 086 excluded them while they were
  -- unreachable (071 refused auction mocks; 085's verbs refused them —
  -- F61, now discharged) and D160(9) said this task opens the claim. A mock
  -- auction runs the SAME two sub-arms — its nomination timeouts (the human
  -- seat under the LAUNCHER's grace, a CPU seat immediately — ARM 2's mock
  -- branch, mirrored below), its awards, its rotation and its completion
  -- (the writer's §8.8 mock bypass: drafts.complete + recap, zero
  -- league_rosters, no league transition). What a mock ADDS is the CPU
  -- sub-arm, ARM 2.6(c) below: CPU nominations on their think-time and CPU
  -- raises on theirs, both through the extracted internals the human path
  -- uses (089 banner items 3–5).
  -- -------------------------------------------------------------------------

  -- -------------------------------------------------------------------------
  -- ARM 2.6(c) — THE MOCK CPU SUB-ARM (089/L.C1.7; §8.8 "auction bots bid
  -- value-based … and pass the same max-bid/solvency validator as humans";
  -- D132/D138; D128 — the clock rule is the same INSERT + UPDATE). Runs
  -- BEFORE the expiry loop and is DISJOINT from it by construction: this
  -- claim requires the clock to be RUNNING (`current_deadline > now()`), the
  -- expiry loop requires it to have run OUT (`<= now()`) — so no CPU ever
  -- nominates or raises after the buzzer (a think-time that lands past zero
  -- simply misses), and an award in the same pass is the expiry loop's.
  -- CLAIM SCOPE (R135/R141): the WHERE is the body's predicate — live + mock
  -- + auction + alive league + clock running + think-time DUE via the ONE
  -- due computation (`draft_mock_auction_cpu_due`, claim ≡ re-check) — so a
  -- HEALTHY mock (think-time not yet reached) is never locked by this arm.
  -- Recorded residual (089 banner): a bidding-phase mock past its raise
  -- think-time is re-claimed each pass until a raise lands or the clock
  -- expires, even when every CPU folds — the claim cannot see the value
  -- model; the lock is one short read per pass.
  -- Two phases (D126):
  --   NOMINATING, CPU seat on the clock, think-time due → the CPU nominates
  --     through draft_system_nominate_internal (its OWN resolve chain at
  --     the nomination floor — D129(2); a CPU seat resolves as a no-user seat: ADP +
  --     need, never its real owner's prep — D110(4)). Think-time = 20–70%
  --     of the NOMINATION clock (the D93 PRNG seeded (draft, sequence)
  --     exactly as a snake CPU pick is) or ~2s under `fast`.
  --   BIDDING, raise think-time due → THE RESPONDER, once
  --     (draft_mock_cpu_respond_internal — 091/AP.3, D200(2)). What used to
  --     live inline here (the candidate scan and a hard-coded `+ $1`) is now
  --     ONE function shared with the reactive path, and the raise amount is
  --     the seeded curve of draft_mock_cpu_raise_amount.
  --     **AFTER 091 THIS ARM IS THE NO-ACTOR SAFETY NET, NOT THE
  --     HEARTBEAT** (§8.8: "a CPU raise is provoked by the bid it answers,
  --     never by the sweep"; D200(1)). A ladder normally resolves inside the
  --     transaction that provoked it — the human's bid, another CPU's
  --     raise, or the nomination that opened the market — so a mock that
  --     still reaches this line is one where nothing has happened since the
  --     market opened, and the responder will usually FOLD here (no
  --     candidate can beat the standing price). It is kept because the
  --     no-actor case is real: a market opened by a path that predates 091,
  --     or a board whose budgets moved under a commissioner edit between
  --     the open and now.
  --     Raise think-time (unchanged) = 20–70% of the BID clock from the
  --     last bid / the open (drafts.updated_at), seeded (draft, seq × 1000
  --     + bid count), or ~2s under `fast`; it gates THIS arm only — a
  --     reactive response is not timed at all, which is the §8.8 ruling and
  --     the reason the `fast`/`realistic` toggle no longer has any raise
  --     think-time to shorten (it still governs the NOMINATION think and
  --     ARM 2.5's snake picks). E62 is structural and unchanged: the cap is
  --     the validator's own number and draft_place_bid_internal re-enforces
  --     it; a decision the validator would refuse is recorded LOUDLY in
  --     auction_cpu_failures and writes nothing.
  -- -------------------------------------------------------------------------
  LOOP
    v_cpu_loops := v_cpu_loops + 1;
    v_pass := 0;

    FOR v_row IN
      SELECT d.id
      FROM public.drafts d
      WHERE d.status = 'live'
        AND d.is_mock
        AND d.draft_type = 'auction'
        AND d.current_deadline IS NOT NULL
        AND d.current_deadline > now()
        AND NOT (d.id = ANY(v_cpu_seen))
        AND public.draft_league_alive(d.league_id)
        AND (
          (d.current_nomination IS NULL
           AND d.on_clock_team_id IS NOT NULL
           AND d.config->'mock'->>'human_team_id'
               IS DISTINCT FROM d.on_clock_team_id::text
           AND now() >= public.draft_mock_auction_cpu_due(
                 d.id, d.config, d.current_deadline, d.updated_at,
                 d.current_pick_number, FALSE, 0))
          OR
          (d.current_nomination IS NOT NULL
           AND now() >= public.draft_mock_auction_cpu_due(
                 d.id, d.config, d.current_deadline, d.updated_at,
                 d.current_pick_number, TRUE,
                 (SELECT count(*)::int FROM public.draft_bids b
                  WHERE b.draft_id = d.id
                    AND b.nomination_seq = d.current_pick_number
                    AND b.player_id = d.current_nomination->>'player_id'
                    AND b.voided_at IS NULL)))
        )
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_cpu_claimed := v_cpu_claimed + 1;
      v_cpu_seen := v_cpu_seen || v_row.id;

      BEGIN
        SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_row.id;

        -- Re-verify EVERY claim predicate under the held lock (claim =
        -- snapshot pre-filter; body = authoritative — the R135 discipline).
        IF v_draft.status <> 'live'
           OR NOT v_draft.is_mock
           OR v_draft.draft_type <> 'auction'
           OR v_draft.current_deadline IS NULL
           OR v_draft.current_deadline <= now() THEN
          CONTINUE;
        END IF;
        IF NOT public.draft_league_alive(v_draft.league_id) THEN
          CONTINUE;
        END IF;

        IF v_draft.current_nomination IS NULL THEN
          -- ===== (c1) CPU NOMINATION on its think-time (D132/D129(2)) =====
          IF v_draft.on_clock_team_id IS NULL
             OR v_draft.config->'mock'->>'human_team_id'
                = v_draft.on_clock_team_id::text
             OR now() < public.draft_mock_auction_cpu_due(
                  v_draft.id, v_draft.config, v_draft.current_deadline,
                  v_draft.updated_at, v_draft.current_pick_number, FALSE, 0) THEN
            CONTINUE;
          END IF;
          -- The ONE system nomination (089 banner item 4): the same row,
          -- the same state, the same function the timeout path uses.
          PERFORM public.draft_system_nominate_internal(v_draft.id);
          v_cpu_nominated := v_cpu_nominated + 1;
        ELSE
          -- ===== (c2) THE CPU RESPONSE on its think-time (D132; 091/AP.3
          -- — the no-actor safety net, one call into the ONE responder) ====
          v_win_player := v_draft.current_nomination->>'player_id';
          v_high_team  := (v_draft.current_nomination->>'high_bidder_team_id')::uuid;
          IF v_win_player IS NULL OR v_high_team IS NULL THEN
            RAISE EXCEPTION
              'draft_tick: mock auction % has a malformed current_nomination (%) — refusing to bid',
              v_draft.id, v_draft.current_nomination;
          END IF;

          -- 'pass' = the LIVE bid count on this nomination (D130/D162: the
          -- player-matched, un-voided rows — history-derived, so the
          -- decision is reproducible from the rows alone).
          SELECT count(*)::int INTO v_bid_count
          FROM public.draft_bids b
          WHERE b.draft_id = v_draft.id
            AND b.nomination_seq = v_draft.current_pick_number
            AND b.player_id = v_win_player
            AND b.voided_at IS NULL;

          IF now() < public.draft_mock_auction_cpu_due(
               v_draft.id, v_draft.config, v_draft.current_deadline,
               v_draft.updated_at, v_draft.current_pick_number, TRUE,
               v_bid_count) THEN
            CONTINUE;
          END IF;

          -- THE ONE RESPONDER (091 banner item 4): the candidate scan, the
          -- seeded raise amount and the write — the same function, the same
          -- decisions and the same validator the reactive path uses, so the
          -- swept path and the provoked path can never drift apart (the 089
          -- extraction rule: a second consumer appeared). It returns the
          -- number of raises it wrote; 0 means every CPU folded at this
          -- price, the clock runs on, and the human (or the buzzer) decides.
          v_cpu_step := public.draft_mock_cpu_respond_internal(v_draft.id);
          IF v_cpu_step = 0 THEN
            v_cpu_folded := v_cpu_folded + 1;
          ELSE
            v_cpu_raised := v_cpu_raised + v_cpu_step;
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_cpu_failures := v_cpu_failures || jsonb_build_object(
          'draft_id', v_row.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'draft_tick mock auction CPU arm failed for draft %: % (%)',
          v_row.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass = 0 OR v_cpu_loops >= c_max_loops;
  END LOOP;

  -- ARM 2.6 (a)/(b) — the clocks that ran OUT (086's two sub-arms, mocks
  -- included since 089).
  LOOP
    v_auc_loops := v_auc_loops + 1;
    v_pass := 0;

    FOR v_row IN
      SELECT d.id
      FROM public.drafts d
      WHERE d.status = 'live'
        AND d.draft_type = 'auction'
        AND d.current_deadline IS NOT NULL
        AND d.current_deadline <= now()
        AND NOT (d.id = ANY(v_auc_seen))
        AND public.draft_league_alive(d.league_id)
      ORDER BY d.current_deadline
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_auc_claimed := v_auc_claimed + 1;
      v_auc_seen := v_auc_seen || v_row.id;

      BEGIN
        SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_row.id;

        -- Re-verify EVERY claim predicate under the held lock (claim =
        -- snapshot pre-filter; body = authoritative — the R135 discipline).
        IF v_draft.status <> 'live'
           OR v_draft.draft_type <> 'auction'
           OR v_draft.current_deadline IS NULL
           OR v_draft.current_deadline > now()
           OR v_draft.on_clock_team_id IS NULL THEN
          CONTINUE;
        END IF;
        IF NOT public.draft_league_alive(v_draft.league_id) THEN
          CONTINUE;
        END IF;

        IF v_draft.current_nomination IS NULL THEN
          -- ===== (a) NOMINATION EXPIRY — §8.6.2's timeout; D129(2)(3) ====
          -- Seat derivation — ARM 2's two branches, verbatim. MOCK BRANCH
          -- (089 — D93/D103, mirrored from ARM 2): the HUMAN seat keys
          -- freshness/grace on the LAUNCHER (the seat's real owner and
          -- their is_autodraft are irrelevant inside a practice room — the
          -- launcher wants the clock pressure, §8.8); every CPU seat is a
          -- no-user seat here (immediate system nomination — normally ARM
          -- 2.6(c) nominates it on its think-time BEFORE the deadline, so
          -- reaching this arm means the tick was down past the deadline,
          -- and the timeout semantics are identical).
          IF v_draft.is_mock THEN
            IF v_draft.config->'mock'->>'human_team_id'
               = v_draft.on_clock_team_id::text THEN
              v_user := (v_draft.config->'mock'->>'launched_by')::uuid;
            ELSE
              v_user := NULL;
            END IF;
            v_autodraft := FALSE;
          ELSE
            SELECT m.user_id, COALESCE(m.is_autodraft, FALSE)
              INTO v_user, v_autodraft
            FROM public.league_members m
            WHERE m.league_id = v_draft.league_id
              AND m.team_id = v_draft.on_clock_team_id;
          END IF;

          v_grace := COALESCE(
            (v_draft.config->>'disconnect_grace_seconds')::int, 30);

          -- D102's contract carried to the NOMINATION clock (D129(3)):
          -- is_autodraft seats, no-user seats (placeholder/vacated — E48)
          -- and seats FRESH AS OF THE DEADLINE nominate AT the deadline; a
          -- STALE human seat is held to deadline + grace. Freshness is
          -- measured against the DEADLINE INSTANT (R132 — re-deriving it
          -- from now() would let a returning manager's post-deadline beat
          -- retroactively grant the fresh branch), through the SAME
          -- draft_liveness_freshness() constant every other arm reads. The
          -- manager may still nominate MANUALLY during the hold:
          -- draft_nominate never reads the deadline (085) — the E3 posture
          -- draft_make_pick has.
          IF v_user IS NOT NULL AND NOT COALESCE(v_autodraft, FALSE) THEN
            v_fresh := EXISTS (
              SELECT 1 FROM public.draft_liveness dl
              WHERE dl.draft_id = v_draft.id
                AND dl.user_id = v_user
                AND dl.last_seen_at > v_draft.current_deadline
                                      - public.draft_liveness_freshness()
                AND dl.last_seen_at <= v_draft.current_deadline
            );
            IF NOT v_fresh
               AND now() < v_draft.current_deadline
                           + make_interval(secs => v_grace) THEN
              -- HELD OPEN: the deadline stays past-due and this is
              -- re-evaluated every tick until deadline + grace.
              v_auc_held := v_auc_held + 1;
              CONTINUE;
            END IF;
          END IF;

          -- THE ONE SYSTEM NOMINATION (089 banner item 4 —
          -- draft_system_nominate_internal, extracted from this arm because
          -- the mock CPU think-time nomination is the second consumer): the
          -- §8.6.8 loud guards through the ONE derivation family (rule 7),
          -- the on-clock team's OWN resolve chain at the nomination floor
          -- (D129(2)/C33 — §8.6.7(e) satisfied a fortiori, §8.6.7(b)'s
          -- no-raise award always legal), the F62 opening-bid row with
          -- action_id NULL, and the D126 phase flip with the bid clock —
          -- byte-for-byte what this arm wrote inline before the extraction.
          PERFORM public.draft_system_nominate_internal(v_draft.id);

          v_auc_nominated := v_auc_nominated + 1;
        ELSE
          -- ===== (b) BID EXPIRY → THE AWARD — §8.6.4/§8.6.7(b); D130 =====
          -- 093/AP.2: EXTRACTED, not reimplemented (D199(3); the 089
          -- precedent — `draft_system_nominate_internal` came out of ARM
          -- 2.6(a) the day a second consumer appeared, and §8.6.9's instant
          -- award is this arm's second consumer). The ~190 lines that stood
          -- here are `draft_award_nomination_internal`, moved with every
          -- byte of their substance intact — the D143/D162 attribution
          -- lookup, the §8.6.8 re-check under the held lock, the §12.4
          -- write, the §8.6.7(c) rotation scan and the §8.6.6 completion —
          -- and the ONLY line that changed is the completion COUNTER, which
          -- belongs to this sweep and not to the award (it returns whether
          -- it completed the draft, and this arm counts it).
          IF public.draft_award_nomination_internal(v_draft.id) THEN
            v_auc_completed := v_auc_completed + 1;
          END IF;
          v_auc_awarded := v_auc_awarded + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_auc_failures := v_auc_failures || jsonb_build_object(
          'draft_id', v_row.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'draft_tick auction arm failed for draft %: % (%)',
          v_row.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass = 0 OR v_auc_loops >= c_max_loops;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- ARM 3 — the §9.1 tick heartbeat (amended in by L.B1.5/070 — see the
  -- banner). ONE realtime.send() per live draft per pass (~5s), event
  -- 'tick' on the draft topic, payload = server-now + the authoritative
  -- deadline (§9.3's clock-drift correction). LOCK-FREE by design
  -- (R135/R141: a PLAIN read — the beat claims nothing, locks nothing;
  -- a healthy live draft stays untouched by the tick's lock scope).
  -- Runs AFTER the state-changing arms so the beat reflects post-arm
  -- state. Deleted-league drafts excluded (the R141 discipline); paused
  -- drafts excluded (frozen clock — nothing to correct); mock drafts
  -- included once 071 makes them reachable (same room, same clock).
  -- realtime.send() traps its own errors; this block is containment
  -- symmetry with the other arms.
  -- -------------------------------------------------------------------------
  BEGIN
    FOR v_hb IN
      SELECT d.id, d.current_deadline
      FROM public.drafts d
      WHERE d.status = 'live'
        AND public.draft_league_alive(d.league_id)
    LOOP
      PERFORM realtime.send(
        jsonb_build_object(
          -- clock_timestamp(), not now(): the drift-correction beat must
          -- carry STATEMENT time — transaction_timestamp() is frozen at
          -- tick-txn start, so it would bake the txn's own runtime into
          -- the very drift figure the beat exists to correct (R146).
          'server_now', clock_timestamp(),
          'current_deadline', v_hb.current_deadline),
        'tick',
        'draft:' || v_hb.id::text,
        true);
      v_heartbeats := v_heartbeats + 1;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    v_heartbeat_failures := v_heartbeat_failures || jsonb_build_object(
      'sqlstate', SQLSTATE, 'error', SQLERRM);
    RAISE WARNING 'draft_tick heartbeat arm failed: % (%)', SQLERRM, SQLSTATE;
  END;

  RETURN jsonb_build_object(
    'scanned_scheduled_leagues', v_scanned,
    'auto_started', v_started,
    'start_failures', v_start_failures,
    'outage_paused', v_outage_paused,
    'outage_failures', v_outage_failures,
    'mock_paused', v_mock_paused,
    'mock_pause_failures', v_mock_pause_failures,
    'mock_cpu_picked', v_mock_picked,
    'mock_cpu_failures', v_mock_cpu_failures,
    'claimed_due', v_claimed,
    'autopicked', v_picked,
    'held_for_grace', v_held,
    'pick_failures', v_pick_failures,
    'heartbeats', v_heartbeats,
    'heartbeat_failures', v_heartbeat_failures,
    'auction_claimed_due', v_auc_claimed,
    'auction_nominated', v_auc_nominated,
    'auction_awarded', v_auc_awarded,
    'auction_held_for_grace', v_auc_held,
    'auction_completed', v_auc_completed,
    'auction_failures', v_auc_failures,
    'auction_loops', v_auc_loops,
    'auction_cpu_claimed', v_cpu_claimed,
    'auction_cpu_nominated', v_cpu_nominated,
    'auction_cpu_raised', v_cpu_raised,
    'auction_cpu_folded', v_cpu_folded,
    'auction_cpu_failures', v_cpu_failures,
    'auction_cpu_loops', v_cpu_loops,
    'loops', v_loops);
END;
$$;

-- §4.1 posture restated after the replace (093 precedent).
REVOKE EXECUTE ON FUNCTION draft_tick() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. draft_make_pick — head 085:811-981. TWO hunks: the ownership arm and
--     the second, uncounted P0002 guard behind it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_make_pick(
  p_draft_id UUID,
  p_player_id TEXT,
  p_action_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft         public.drafts;
  v_pick          public.draft_picks;
  v_my_team       UUID;
  v_on_clock_name TEXT;
  v_player_name   TEXT;
BEGIN
  -- Argument shape (22023) before any data access.
  IF p_player_id IS NULL OR btrim(p_player_id) = '' THEN
    RAISE EXCEPTION 'draft_make_pick: player_id is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'draft_make_pick: action_id is required — client picks are idempotent (§8.1/E2)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the drafts row FIRST (§4.6). The league row is deliberately
  -- NOT locked — see the banner's lock-order note.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  -- (2) VALIDATE. No-leak: a nonexistent draft and a non-member get the
  -- same 42501 (is_league_member(NULL) is FALSE).
  IF NOT FOUND
     OR NOT (public.is_league_member(v_draft.league_id)
             OR public.is_standalone_mock_launcher(v_draft.id)) THEN
    RAISE EXCEPTION 'draft_make_pick: not a member of this draft''s league'
      USING ERRCODE = '42501';
  END IF;

  -- A soft-deleted league answers 404 for a legitimate member (063 rule).
  IF NOT public.draft_league_alive(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_make_pick: league % not found', v_draft.league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- E2 replay short-circuit — BEFORE status/turn checks: a retried pick is
  -- a no-op returning its original pick + the current authoritative state,
  -- even if the clock has moved on (§8.1 idempotency). R125 DECIDED
  -- (L.B1.4/069): DELIBERATELY no is_undone filter — an action_id is
  -- consumed forever. A stale retry of a commissioner-undone pick returns
  -- the historical (undone) row as a no-op and never re-applies the pick;
  -- filtering would route the retry into a 23505 on uniq_draft_action
  -- (undone rows keep their action_id) surfaced as a misleading E1
  -- message. Pinned in pgTAP 023; the manager re-picks with a fresh
  -- action_id.
  SELECT p.* INTO v_pick
  FROM public.draft_picks p
  WHERE p.draft_id = p_draft_id AND p.action_id = p_action_id;
  IF FOUND THEN
    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'pick', to_jsonb(v_pick));
  END IF;

  -- THE D103(2) MOCK BRANCH (landed by L.B1.6/071 — this was the seam
  -- refusal 066 shipped; the 020 seam pin flipped with it): on a mock the
  -- ONLY legal human caller is the launcher (config.mock.launched_by,
  -- TEXT-compared — R117). Any other member — including the on-clock
  -- seat's REAL manager and the commissioner — is refused: nobody else
  -- drives a member's solo practice, and there is no force-path bypass
  -- for mocks (069's controls refuse them). A config-less mock (only
  -- reachable by privileged fixture inserts — every RPC writer stamps
  -- config.mock) has launched_by NULL and stays tick-only, the safe
  -- default. The human-seat-only half of D103(2) lives at the TURN step
  -- below (it needs status='live' established first so on_clock is real).
  IF v_draft.is_mock
     AND v_draft.config->'mock'->>'launched_by' IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION
      'draft_make_pick: this mock draft is another member''s solo practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  -- 085 (L.C1.3): the refusal STANDS — an auction draft never picks
  -- through this RPC — but the message no longer promises a milestone
  -- that has arrived. §8.6's engine is draft_nominate + draft_place_bid
  -- (085) plus the tick's award arm (086); this sentence is correct
  -- forever and tells the caller what to use instead.
  IF v_draft.draft_type = 'auction' THEN
    RAISE EXCEPTION
      'draft_make_pick: this is an auction draft — auction drafts pick via nominate and bid'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'scheduled' THEN
    RAISE EXCEPTION 'draft_make_pick: the draft has not started yet'
      USING ERRCODE = 'P0001';
  ELSIF v_draft.status = 'paused' THEN
    RAISE EXCEPTION 'draft_make_pick: the draft is paused'
      USING ERRCODE = 'P0001';
  ELSIF v_draft.status = 'complete' THEN
    RAISE EXCEPTION 'draft_make_pick: the draft is complete'
      USING ERRCODE = 'P0001';
  END IF;

  -- TURN. Mock branch (D103(2), the human-seat-only half): the launcher —
  -- already verified above — may pick ONLY while the HUMAN seat is on the
  -- clock (every other seat is tick-only, D93/071 ARM 2.5); the normal
  -- league_members turn check never runs for mocks (the chosen seat may
  -- be a placeholder or another member's franchise — "any seat
  -- selectable", §8.8). Real drafts: the caller manages the on-clock team
  -- (league_members cache — M1's access model). Commissioners use the
  -- L.B1.4 force path, not this RPC: no role bypass exists here.
  IF v_draft.is_mock THEN
    IF v_draft.config->'mock'->>'human_team_id'
       IS DISTINCT FROM v_draft.on_clock_team_id::text THEN
      RAISE EXCEPTION
        'draft_make_pick: a CPU seat is on the clock — CPU picks land on their own (§8.8)'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT m.team_id INTO v_my_team
    FROM public.league_members m
    WHERE m.league_id = v_draft.league_id AND m.user_id = auth.uid();
    IF v_my_team IS NULL OR v_my_team IS DISTINCT FROM v_draft.on_clock_team_id THEN
      SELECT t.name INTO v_on_clock_name
      FROM public.teams t WHERE t.id = v_draft.on_clock_team_id;
      RAISE EXCEPTION
        'draft_make_pick: it is not your turn — % is on the clock',
        COALESCE(v_on_clock_name, 'another team')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT pl.full_name INTO v_player_name
  FROM public.players pl WHERE pl.id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_make_pick: player % not found', p_player_id
      USING ERRCODE = 'P0002';
  END IF;

  -- E1 availability under the lock (friendly path); the partial unique is
  -- the guarantee (§8.1: lock + index make double-picks impossible).
  IF EXISTS (
    SELECT 1 FROM public.draft_picks p
    WHERE p.draft_id = p_draft_id
      AND p.player_id = p_player_id
      AND p.is_undone = FALSE
  ) THEN
    RAISE EXCEPTION
      'draft_make_pick: % just went off the board — pick another player',
      v_player_name
      USING ERRCODE = 'P0001';
  END IF;

  -- (3)+(4)+(5) via the ONE advance path (L.B1.3 amendment (b)): manual
  -- pick shape — is_auto FALSE, made_via 'manager', picked_by = caller.
  BEGIN
    RETURN public.draft_apply_pick_internal(
      p_draft_id, p_player_id, FALSE, 'manager', auth.uid(), p_action_id);
  EXCEPTION WHEN unique_violation THEN
    -- The exotic race loser (non-RPC interleavings the row lock cannot
    -- see) gets the same friendly E1 message (§8.1).
    RAISE EXCEPTION
      'draft_make_pick: % just went off the board — pick another player',
      v_player_name
      USING ERRCODE = 'P0001';
  END;
END;
$$;

-- §4.1 posture restated after the replace (093 precedent).
REVOKE EXECUTE ON FUNCTION draft_make_pick(UUID, TEXT, UUID) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 12. draft_nominate — head 093:1701-2004. TWO hunks, the same pair.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_nominate(
  p_draft_id UUID,
  p_player_id TEXT,
  p_opening_bid INTEGER,
  p_action_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft         public.drafts;
  v_bid           public.draft_bids;
  v_my_team       UUID;
  v_on_clock_name TEXT;
  v_player_name   TEXT;
  v_live_name     TEXT;
  v_nom_floor     INTEGER;
  v_bid_seconds   INTEGER;
  v_remaining     INTEGER;
  v_open          INTEGER;
  v_max_bid       INTEGER;
  v_uncontested   BOOLEAN;
BEGIN
  -- Argument shape (22023) before any data access.
  IF p_player_id IS NULL OR btrim(p_player_id) = '' THEN
    RAISE EXCEPTION 'draft_nominate: player_id is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_opening_bid IS NULL THEN
    RAISE EXCEPTION 'draft_nominate: opening_bid is required — a nomination always names its opening bid (§8.6.2)'
      USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'draft_nominate: action_id is required — client nominations are idempotent (§8.1/E2)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the drafts row FIRST (§4.6 rule 6). The league row is
  -- deliberately NOT locked (066's lock-order note: the leagues lock is
  -- draft_start's, and taking it here would re-open the R122 cycle).
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  -- (2) VALIDATE. No-leak: a nonexistent draft and a non-member get the
  -- same 42501 (is_league_member(NULL) is FALSE).
  IF NOT FOUND
     OR NOT (public.is_league_member(v_draft.league_id)
             OR public.is_standalone_mock_launcher(v_draft.id)) THEN
    RAISE EXCEPTION 'draft_nominate: not a member of this draft''s league'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.draft_league_alive(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_nominate: league % not found', v_draft.league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- E2 replay short-circuit — BEFORE status/phase/turn checks, so a
  -- retried nomination is a no-op even after the clock has moved on
  -- (§8.1 idempotency; R125: an action_id is consumed forever, no
  -- filters). The mechanism is the OPENING BID ROW this RPC writes — the
  -- select-then-insert house pattern (066:917), never an ON CONFLICT
  -- arbiter against the PARTIAL uniq_draft_bid_action (42P10 — R310).
  SELECT b.* INTO v_bid
  FROM public.draft_bids b
  WHERE b.draft_id = p_draft_id AND b.action_id = p_action_id;
  IF FOUND THEN
    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'bid', to_jsonb(v_bid));
  END IF;

  -- THE D103(2) MOCK BRANCH (089/L.C1.7 — F61 DISCHARGED: this was 085's
  -- seam refusal, built to flip the day 071's create refusal lifted): on a
  -- mock the ONLY legal human caller is the launcher
  -- (config.mock.launched_by, TEXT-compared — R117). Any other member —
  -- including the human seat's REAL manager and the commissioner — is
  -- refused: nobody else drives a member's solo practice, and there is no
  -- force-path bypass for mocks (087's controls refuse them — D138). A
  -- config-less mock (privileged fixtures only — every RPC writer stamps
  -- config.mock) has launched_by NULL and stays tick-only, the safe
  -- default (D110(9)). The human-seat-only half lives at the TURN step
  -- below (it needs status='live' established first so on_clock is real).
  IF v_draft.is_mock
     AND v_draft.config->'mock'->>'launched_by' IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION
      'draft_nominate: this mock draft is another member''s solo practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.draft_type <> 'auction' THEN
    RAISE EXCEPTION
      'draft_nominate: this is a % draft — only auction drafts nominate (§8.6)',
      v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'scheduled' THEN
    RAISE EXCEPTION 'draft_nominate: the draft has not started yet'
      USING ERRCODE = 'P0001';
  ELSIF v_draft.status = 'paused' THEN
    RAISE EXCEPTION 'draft_nominate: the draft is paused'
      USING ERRCODE = 'P0001';
  ELSIF v_draft.status = 'complete' THEN
    RAISE EXCEPTION 'draft_nominate: the draft is complete'
      USING ERRCODE = 'P0001';
  END IF;

  -- PHASE (D126): current_nomination NULL ⇒ nominating. A non-NULL one
  -- means bidding is live — the caller wants draft_place_bid.
  IF v_draft.current_nomination IS NOT NULL THEN
    SELECT pl.full_name INTO v_live_name
    FROM public.players pl
    WHERE pl.id = v_draft.current_nomination->>'player_id';
    RAISE EXCEPTION
      'draft_nominate: bidding is already open on % at $% — place a bid instead of nominating (§8.6.3)',
      COALESCE(v_live_name, 'the nominated player'),
      COALESCE(v_draft.current_nomination->>'high_bid', '0')
      USING ERRCODE = 'P0001';
  END IF;

  -- TURN. Mock branch (089 — D103(2), the human-seat-only half): the
  -- launcher — already verified above — nominates ONLY while the HUMAN
  -- seat is on the clock (every CPU seat nominates on its own think-time
  -- through the tick's ARM 2.6(c) — D132), and nominates FOR that seat: the
  -- normal league_members turn check never runs for mocks (the chosen seat
  -- may be a placeholder or another member's franchise — "any seat
  -- selectable", §8.8). Real drafts: the caller manages the on-clock
  -- (nominating) team — M1's access model, draft_make_pick's rule verbatim.
  -- Commissioners use 087's force-nominate path (R301); no role bypass
  -- exists here.
  IF v_draft.is_mock THEN
    IF v_draft.config->'mock'->>'human_team_id'
       IS DISTINCT FROM v_draft.on_clock_team_id::text THEN
      RAISE EXCEPTION
        'draft_nominate: a CPU seat is on the clock — CPU nominations land on their own (§8.8)'
        USING ERRCODE = 'P0001';
    END IF;
    v_my_team := (v_draft.config->'mock'->>'human_team_id')::uuid;
  ELSE
    SELECT m.team_id INTO v_my_team
    FROM public.league_members m
    WHERE m.league_id = v_draft.league_id AND m.user_id = auth.uid();
    IF v_my_team IS NULL OR v_my_team IS DISTINCT FROM v_draft.on_clock_team_id THEN
      SELECT t.name INTO v_on_clock_name
      FROM public.teams t WHERE t.id = v_draft.on_clock_team_id;
      RAISE EXCEPTION
        'draft_nominate: it is not your turn to nominate — % is on the clock',
        COALESCE(v_on_clock_name, 'another team')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT pl.full_name INTO v_player_name
  FROM public.players pl WHERE pl.id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_nominate: player % not found', p_player_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Availability under the lock (the E1 shape, nomination edition): a
  -- player already bought cannot be nominated again. uniq_draft_player_live
  -- is the backstop at the AWARD (086), which is the only writer of
  -- draft_picks on this path.
  IF EXISTS (
    SELECT 1 FROM public.draft_picks p
    WHERE p.draft_id = p_draft_id
      AND p.player_id = p_player_id
      AND p.is_undone = FALSE
  ) THEN
    RAISE EXCEPTION
      'draft_nominate: % just went off the board — nominate another player',
      v_player_name
      USING ERRCODE = 'P0001';
  END IF;

  -- The ONE budget authority (084/D127/§4.7). Capacity FIRST (see the
  -- banner): a complete roster reads max_bid 0, so bounds-first would
  -- refuse it with the wrong reason.
  SELECT b.remaining, b.open_slots, b.max_bid
    INTO v_remaining, v_open, v_max_bid
  FROM public.draft_team_budget(p_draft_id, v_my_team) b;

  IF v_open < 1 THEN
    RAISE EXCEPTION
      'draft_nominate: your roster is complete — complete rosters are skipped in the nomination rotation and cannot bid (§8.6.7(c)/E27)'
      USING ERRCODE = 'P0001';
  END IF;

  -- 092/AP.1: the NOMINATION FLOOR, through the ONE authority (D198(1);
  -- §7.3.8's auction_zero_dollar_nominations row). $1 with the toggle OFF,
  -- $0 with it ON — at which point "a nomination should allow any number
  -- that the player can afford" (Chris, 2026-08-20) is exactly what the two
  -- clauses below say: floor 0, ceiling max_bid. It is NOT the bid
  -- increment, which is a fixed $1 in both columns (§8.6.3) and lives in
  -- draft_place_bid_internal's `p_amount <= v_high_bid`.
  v_nom_floor   := public.draft_auction_reserve(v_draft.config);
  v_bid_seconds := COALESCE((v_draft.config->>'auction_bid_seconds')::int, 20);

  IF p_opening_bid < v_nom_floor THEN
    RAISE EXCEPTION
      'draft_nominate: an opening bid of $% is below this league''s $% nomination floor (§7.3.8)',
      p_opening_bid, v_nom_floor
      USING ERRCODE = 'P0001';
  END IF;

  -- §8.6.7(a): the nominator must be able to afford their own opening bid
  -- — which is what makes §8.6.7(b)'s no-raise award (E26) always legal.
  -- The message names the formula's number AND the money behind it.
  IF p_opening_bid > v_max_bid THEN
    RAISE EXCEPTION
      'draft_nominate: an opening bid of $% is over your max bid of $% — you have $% for % open roster spots at a $% per-slot reserve (§8.6.7(a))',
      p_opening_bid, v_max_bid, v_remaining, v_open, v_nom_floor
      USING ERRCODE = 'P0001';
  END IF;

  -- (3) WRITE. The opening bid is a draft_bids row like any other (banner
  -- item 3): one uniform history, one E2 mechanism, one feed.
  INSERT INTO public.draft_bids
    (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
  VALUES
    (p_draft_id, v_draft.league_id, v_draft.current_pick_number,
     p_player_id, v_my_team, p_opening_bid, p_action_id)
  RETURNING * INTO v_bid;

  -- (3b) 093/AP.2 — IS THIS NOMINATION UNCONTESTABLE? (§8.6.9/E67; D199(1);
  -- Chris, 2026-08-20: "a nomination might work as an instant pick because
  -- no other teams have enough money".) ONE lateral scan over the active
  -- franchises, inside the draft-row lock this RPC already holds, through
  -- the ONE budget family — never a loop, never a private budget formula.
  -- Asked HERE, between the opening-bid row and the phase flip, because a
  -- bid moves no money (D131(2)) so the answer is identical either side of
  -- the flip, and asking first lets the ONE phase-flip statement below
  -- carry the announcement key.
  v_uncontested := public.draft_nomination_uncontestable(
                     p_draft_id, v_my_team, p_opening_bid);

  -- (4) ADVANCE: open the BIDDING phase (D126) and start the bid clock.
  -- current_pick_number is NOT advanced — it is this nomination's
  -- sequence number until the award (086). on_clock_team_id stays the
  -- NOMINATOR through bidding: it is the seat the rotation advances FROM
  -- (D130) and the room's "X nominated" attribution.
  -- 093/AP.2: on the UNCONTESTABLE path this statement is a STEP, not a
  -- state. It carries an ADDITIVE `"uncontested": true` key — 088's `drafts`
  -- payload already broadcasts `current_nomination` whole (D134), so this is
  -- the room's only signal that the award landing in the same commit wants
  -- the §16.5.4 message, and it costs no new column, event or topic — and
  -- `current_deadline` is NULL because E67 says **no bid clock is ever
  -- opened**: a deadline on the wire is a clock the room would render,
  -- however briefly. The flip has to precede the award because the extracted
  -- award reads `current_nomination` to learn who won at what price.
  UPDATE public.drafts SET
    current_nomination = jsonb_build_object(
                           'player_id', p_player_id,
                           'high_bid', p_opening_bid,
                           'high_bidder_team_id', v_my_team)
                         || CASE WHEN v_uncontested
                                 THEN jsonb_build_object('uncontested', TRUE)
                                 ELSE '{}'::jsonb END,
    current_deadline   = CASE WHEN v_uncontested THEN NULL
                              ELSE now() + make_interval(secs => v_bid_seconds)
                         END,
    updated_at         = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  IF v_uncontested THEN
    -- (4b) THE INSTANT AWARD — §8.6.9/E67. Chris's order, verbatim: "It
    -- awards the player immediately and then displays that message for 3
    -- seconds until the next nomination." So the award is HERE, in this
    -- transaction, down the SAME path a bid-clock expiry takes (D199(3):
    -- ONE award implementation, extracted from ARM 2.6(b), never a second
    -- one) — same writes, same re-check, same rotation, same events. The 3
    -- seconds happens AFTER it, in the room, in the gap before the next
    -- nomination opens (§16.5.4; tasks-AP §4 rule 11). Nothing on the server
    -- waits, and there is no pending-award state to reconcile.
    PERFORM public.draft_award_nomination_internal(p_draft_id);
    SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  ELSIF v_draft.is_mock THEN
    -- (4c) THE REACTIVE CPU RESPONSE on the OPEN (091/AP.3; §8.8/D200(1)).
    -- The human's own nomination is a provocation like any other: the CPUs
    -- answer in THIS transaction rather than one 5-second sweep later. The
    -- draft row is re-read because the ladder moved the high bid (§8.1 — the
    -- RPC returns the NEW authoritative state); `bid` stays the caller's own
    -- opening row.
    -- 093/AP.2 — WHY SKIPPING IT ON THE UNCONTESTABLE PATH CHANGES NOTHING:
    -- 091's candidate scan admits a seat only when
    -- `v_high_bid + 1 <= LEAST(c.value, b.max_bid)` (so `max_bid >= high + 1`)
    -- AND `(o.team)::uuid IS DISTINCT FROM v_high_team` — which at the open
    -- IS the nominator. That is exactly the witness
    -- `draft_nomination_uncontestable` has just proved absent, so the ladder
    -- could only fold. 091 already exits on `current_nomination IS NULL` for
    -- this very case ("§8.6.9's instant award when AP.2 lands"); this branch
    -- only declines to pay for the round trip inside the held lock (rule 6).
    PERFORM public.draft_mock_cpu_respond_internal(p_draft_id);
    SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  END IF;

  -- (5) RETURN the new authoritative state.
  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'bid', to_jsonb(v_bid));
END;
$$;

-- §4.1 posture restated after the replace (093 precedent).
REVOKE EXECUTE ON FUNCTION draft_nominate(UUID, TEXT, INTEGER, UUID) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 13. draft_place_bid — head 089:1311-1498. TWO hunks, the same pair.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_place_bid(
  p_draft_id UUID,
  p_amount INTEGER,
  p_action_id UUID,
  p_nomination_seq INTEGER DEFAULT NULL,
  p_player_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft         public.drafts;
  v_bid           public.draft_bids;
  v_my_team       UUID;
  v_on_clock_name TEXT;
  v_high_bid      INTEGER;
  v_player_id     TEXT;
  v_live_name     TEXT;
  v_stale_name    TEXT;
BEGIN
  IF p_amount IS NULL THEN
    RAISE EXCEPTION 'draft_place_bid: amount is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'draft_place_bid: action_id is required — client bids are idempotent (§8.1/E2)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK — the serializer for the hottest path in the app (§22.1's
  -- burst row; D136: no route-layer limiter in M3, the lock is the
  -- answer).
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  -- (2) VALIDATE.
  IF NOT FOUND
     OR NOT (public.is_league_member(v_draft.league_id)
             OR public.is_standalone_mock_launcher(v_draft.id)) THEN
    RAISE EXCEPTION 'draft_place_bid: not a member of this draft''s league'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.draft_league_alive(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_place_bid: league % not found', v_draft.league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- E2 replay short-circuit (identical mechanism to draft_nominate's —
  -- banner item 3): the double-tapped bid returns its own row, never a
  -- second raise. This is THE reason a flaky network cannot bid twice.
  SELECT b.* INTO v_bid
  FROM public.draft_bids b
  WHERE b.draft_id = p_draft_id AND b.action_id = p_action_id;
  IF FOUND THEN
    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'bid', to_jsonb(v_bid));
  END IF;

  -- THE D103(2) MOCK BRANCH (089/L.C1.7 — F61 DISCHARGED: 085's seam
  -- refusal, built to flip the day 071's create refusal lifted): on a mock
  -- the ONLY legal human bidder is the launcher (config.mock.launched_by,
  -- TEXT-compared — R117); every other member — the human seat's REAL
  -- manager, the commissioner — is refused (D138 extends D103(2) to bids:
  -- nobody bids inside another member's solo practice). CPU seats bid
  -- through the tick (ARM 2.6(c), D132), never through this RPC. A
  -- config-less mock (launched_by NULL) stays tick-only (D110(9)).
  IF v_draft.is_mock
     AND v_draft.config->'mock'->>'launched_by' IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION
      'draft_place_bid: this mock draft is another member''s solo practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.draft_type <> 'auction' THEN
    RAISE EXCEPTION
      'draft_place_bid: this is a % draft — only auction drafts take bids (§8.6)',
      v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'scheduled' THEN
    RAISE EXCEPTION 'draft_place_bid: the draft has not started yet'
      USING ERRCODE = 'P0001';
  ELSIF v_draft.status = 'paused' THEN
    RAISE EXCEPTION 'draft_place_bid: the draft is paused'
      USING ERRCODE = 'P0001';
  ELSIF v_draft.status = 'complete' THEN
    RAISE EXCEPTION 'draft_place_bid: the draft is complete'
      USING ERRCODE = 'P0001';
  END IF;

  -- PHASE (D126): no live nomination ⇒ nothing to bid on.
  IF v_draft.current_nomination IS NULL THEN
    SELECT t.name INTO v_on_clock_name
    FROM public.teams t WHERE t.id = v_draft.on_clock_team_id;
    RAISE EXCEPTION
      'draft_place_bid: no player is up for bid right now — % is on the clock to nominate (§8.6.2)',
      COALESCE(v_on_clock_name, 'another team')
      USING ERRCODE = 'P0001';
  END IF;

  v_player_id := v_draft.current_nomination->>'player_id';
  v_high_bid  := COALESCE((v_draft.current_nomination->>'high_bid')::int, 0);

  -- NOMINATION IDENTITY (R330) — OPTIONAL arguments, and the reason they
  -- exist: a bid names an AMOUNT and nothing else, so without them a bid in
  -- flight across a nomination boundary is applied to whatever player is
  -- live when it EXECUTES, and a manager can become high bidder on a player
  -- they never saw. The insert below takes `player_id` from
  -- `current_nomination` and `nomination_seq` from `current_pick_number`,
  -- both read fresh under the lock — the RPC cannot otherwise know what the
  -- caller was looking at, and E2 does not help (a first-time submit carries
  -- a fresh action_id). This is the server-authoritative boundary, so the
  -- guard lives HERE rather than in a route: the sim, the tests and every
  -- future caller are covered, not only HTTP ones.
  --   * BOTH arguments are checked, and neither subsumes the other:
  --     `p_player_id` catches the ordinary case (the nomination moved on to
  --     a different player), and `p_nomination_seq` catches the two cases
  --     where the SAME player is live under a DIFFERENT nomination — D143's
  --     cancel-and-renominate (the sequence number is NOT consumed, so a
  --     re-nomination reuses it with a possibly different player) and an
  --     undone award returning a player to the pool at a later sequence.
  --   * When OMITTED (both NULL) behavior is exactly as shipped — no
  --     existing caller breaks. L.C2.1's route MUST always send them; that
  --     is where the guard becomes mandatory in practice (ledger row F64,
  --     and the read-list line in tasks-M3 §6 L.C2.1).
  --   * Checked the moment the live nomination is known and BEFORE the
  --     franchise/self-raise/raise/max-bid clauses, so a stale bid gets the
  --     TRUE reason (§16.3's "just went off the board" family) instead of
  --     "you are already the high bidder" or "outbid at $N" about a player
  --     the caller never named.
  IF p_player_id IS NOT NULL AND p_player_id IS DISTINCT FROM v_player_id THEN
    SELECT pl.full_name INTO v_stale_name
    FROM public.players pl WHERE pl.id = p_player_id;
    SELECT pl.full_name INTO v_live_name
    FROM public.players pl WHERE pl.id = v_player_id;
    RAISE EXCEPTION
      'draft_place_bid: % just went off the board — % is up for bid now at $% (§16.3)',
      COALESCE(v_stale_name, 'that player'),
      COALESCE(v_live_name, 'another player'),
      v_high_bid
      USING ERRCODE = 'P0001';
  END IF;
  IF p_nomination_seq IS NOT NULL
     AND p_nomination_seq IS DISTINCT FROM v_draft.current_pick_number THEN
    SELECT pl.full_name INTO v_live_name
    FROM public.players pl WHERE pl.id = v_player_id;
    RAISE EXCEPTION
      'draft_place_bid: that nomination just went off the board — % is up for bid now at $% (§16.3)',
      COALESCE(v_live_name, 'another player'),
      v_high_bid
      USING ERRCODE = 'P0001';
  END IF;

  -- The caller's franchise. Bidding has no turn (§8.6.3: ANY manager with
  -- sufficient max bid raises) — but it does require a franchise to bid
  -- FOR: a member without a seat has no budget and no roster. Mock branch
  -- (089 — D103(2)/D138): the launcher — already verified above — bids FOR
  -- the HUMAN seat, whoever owns it; league_members is never consulted
  -- inside a practice room.
  IF v_draft.is_mock THEN
    v_my_team := (v_draft.config->'mock'->>'human_team_id')::uuid;
  ELSE
    SELECT m.team_id INTO v_my_team
    FROM public.league_members m
    WHERE m.league_id = v_draft.league_id AND m.user_id = auth.uid();
    IF v_my_team IS NULL THEN
      RAISE EXCEPTION
        'draft_place_bid: you do not manage a franchise in this league — only franchise managers can bid (§8.6.3)'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (3)–(5) THE ONE BID VALIDATOR + WRITER (089 — draft_place_bid_internal,
  -- extracted from this body because the tick's CPU sub-arm is the second
  -- consumer): the self-raise refusal, the ONE-family budget read (E27 /
  -- the integer-raise floor / the E5 max-bid clause), the draft_bids
  -- INSERT and the D128 anti-snipe floor — every refusal message
  -- byte-identical to what this RPC raised before the extraction (the
  -- internal prefixes them with this label; 034 pins them verbatim).
  RETURN public.draft_place_bid_internal(
    p_draft_id, v_my_team, p_amount, p_action_id, 'draft_place_bid');
END;
$$;

-- §4.1 posture restated after the replace (093 precedent).
REVOKE EXECUTE ON FUNCTION draft_place_bid(UUID, INTEGER, UUID, INTEGER, TEXT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 14. draft_pause / draft_resume — heads 069:378-435 / 069:439-504. ONE
--     hunk each: the ownership arm. draft_pause_internal is NOT amended —
--     its unguarded league_chat write is LEGAL after §1's drop, and banner
--     item 3(b) states why writing the row is the decision.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_pause(
  p_draft_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft public.drafts;
BEGIN
  -- (1) LOCK the drafts row FIRST (§4.6).
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  -- (2) VALIDATE. One 42501 for nonexistent/non-member/non-commish
  -- (no-leak; is_league_commish(NULL) is FALSE). MOCK ARM (L.B1.6/071 —
  -- amended in place, F12; §8.8 "pause/leave anytime … resumable" +
  -- D103(2)): on a mock the authority is the LAUNCHER, not the
  -- commissioner — the member gate keeps the no-leak floor (nonexistent
  -- and non-member answer the same 42501, message unchanged for 023's
  -- pins), the commissioner gate applies to REAL drafts only, and a
  -- member who is not the launcher gets the friendly refusal below
  -- (commissioners have NO bypass — nobody else drives a solo practice).
  IF NOT FOUND
     OR NOT (public.is_league_member(v_draft.league_id)
             OR public.is_standalone_mock_launcher(v_draft.id))
     OR (NOT v_draft.is_mock AND NOT public.is_league_commish(v_draft.league_id)) THEN
    RAISE EXCEPTION 'draft_pause: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  IF v_draft.is_mock
     AND v_draft.config->'mock'->>'launched_by' IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION
      'draft_pause: only the member practicing this mock can pause it (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent no-op (D63 class): a double-tapped Pause must not error —
  -- and must NOT re-run the bookkeeping (recomputing remaining on an
  -- already-paused draft would corrupt it) or post twice.
  IF v_draft.status = 'paused' THEN
    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'paused', FALSE);
  END IF;

  IF v_draft.status <> 'live' THEN
    RAISE EXCEPTION
      'draft_pause: the draft is % — only a live draft can be paused',
      v_draft.status
      USING ERRCODE = 'P0001';
  END IF;

  RETURN public.draft_pause_internal(
    p_draft_id, auth.uid(),
    'Draft paused by ' || public.draft_actor_name() || '.');
END;
$$;

-- §4.1 posture restated after the replace (093 precedent).
REVOKE EXECUTE ON FUNCTION draft_pause(UUID, TEXT) FROM PUBLIC, anon;
CREATE OR REPLACE FUNCTION draft_resume(
  p_draft_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft public.drafts;
BEGIN
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  -- MOCK ARM (L.B1.6/071 — the draft_pause mirror; E59's auto-pause needs
  -- a resume path that cannot dead-end on a non-commissioner launcher).
  IF NOT FOUND
     OR NOT (public.is_league_member(v_draft.league_id)
             OR public.is_standalone_mock_launcher(v_draft.id))
     OR (NOT v_draft.is_mock AND NOT public.is_league_commish(v_draft.league_id)) THEN
    RAISE EXCEPTION 'draft_resume: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  IF v_draft.is_mock
     AND v_draft.config->'mock'->>'launched_by' IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION
      'draft_resume: only the member practicing this mock can resume it (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent no-op: resume of a live draft.
  IF v_draft.status = 'live' THEN
    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'resumed', FALSE);
  END IF;

  IF v_draft.status <> 'paused' THEN
    RAISE EXCEPTION
      'draft_resume: the draft is % — only a paused draft can be resumed',
      v_draft.status
      USING ERRCODE = 'P0001';
  END IF;

  -- §8.7 v2.0: current_deadline = now() + remaining, restored with exact
  -- integer-millisecond interval math (never float seconds). NULL
  -- remaining (untimed) restores a NULL deadline.
  UPDATE public.drafts SET
    status                = 'live',
    current_deadline      = CASE
                              WHEN v_draft.deadline_remaining_ms IS NOT NULL
                              THEN now() + v_draft.deadline_remaining_ms * interval '1 millisecond'
                            END,
    deadline_remaining_ms = NULL,
    paused_at             = NULL,
    updated_at            = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          'Draft resumed by ' || public.draft_actor_name() || '.',
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'resumed', TRUE);
END;
$$;

-- §4.1 posture restated after the replace (093 precedent).
REVOKE EXECUTE ON FUNCTION draft_resume(UUID, TEXT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 15. draft_touch — head 068:428-454. ONE hunk, and load-bearing: the mock
--     idle scan and the 72h expiry both read the LAUNCHER's beat, so a
--     standalone mock whose beat is refused looks idle while it is played.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_touch(p_draft_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league UUID;
BEGIN
  SELECT d.league_id INTO v_league
  FROM public.drafts d
  WHERE d.id = p_draft_id;
  -- No-leak: a nonexistent draft and a non-member get the same 42501
  -- (is_league_member(NULL) is FALSE).
  IF NOT FOUND
     OR NOT (public.is_league_member(v_league)
             OR public.is_standalone_mock_launcher(p_draft_id)) THEN
    RAISE EXCEPTION 'draft_touch: not a member of this draft''s league'
      USING ERRCODE = '42501';
  END IF;

  -- Never touches the drafts row (D102 — no contention with the draft-row
  -- lock; that is the whole reason this table exists).
  INSERT INTO public.draft_liveness (draft_id, user_id, last_seen_at)
  VALUES (p_draft_id, auth.uid(), now())
  ON CONFLICT (draft_id, user_id)
  DO UPDATE SET last_seen_at = now();
END;
$$;

-- §4.1 posture restated after the replace (093 precedent).
REVOKE EXECUTE ON FUNCTION draft_touch(UUID) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 16. draft_autopick_resolve — head 094:511-740. ONE hunk: R492's queue
--     join. Banner item 3(c) states why the board predicate is left alone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_autopick_resolve(
  p_draft_id UUID,
  p_team_id UUID
) RETURNS TEXT
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_draft    public.drafts;
  v_league   public.leagues;
  v_user     UUID;
  v_slots    JSONB;
  v_n_slots  INTEGER;
  v_counts   INTEGER[] := '{}';
  v_filled   INTEGER[] := '{}';
  v_have     JSONB := '{}';         -- normalized position -> count on team
  v_picks    INTEGER := 0;
  v_unfilled INTEGER := 0;
  v_remaining INTEGER;
  v_forced   BOOLEAN;
  v_need     TEXT[] := '{}';        -- positions accepted by unfilled slots
  v_i        INTEGER;
  v_placed   BOOLEAN;
  v_row      RECORD;
  v_ok       BOOLEAN;
  v_floor    TEXT;
BEGIN
  SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- The seat's user (NULL row or NULL user_id = no-user seat — E48).
  -- MOCK-AWARE (L.B1.6/071 — amended in place, F12; D93/D103): in a mock,
  -- the HUMAN seat resolves under the LAUNCHER's queue/boards — the
  -- launcher is the one practicing, and the chosen seat may be a
  -- placeholder or another member's franchise — while every CPU seat
  -- resolves as a NO-USER seat (ADP + need, §8.8's bot behavior per D93:
  -- a CPU seat must NEVER read its real owner's queue/boards — pinned in
  -- 025). launched_by is RPC-written (auth.uid()::text) so the cast is
  -- safe; a hand-crafted garbage value raises and is contained by the
  -- tick's per-draft subtransaction.
  IF v_draft.is_mock THEN
    IF v_draft.config->'mock'->>'human_team_id' = p_team_id::text THEN
      v_user := (v_draft.config->'mock'->>'launched_by')::uuid;
    ELSE
      v_user := NULL;
    END IF;
  ELSE
    SELECT m.user_id INTO v_user
    FROM public.league_members m
    WHERE m.league_id = v_draft.league_id AND m.team_id = p_team_id;
  END IF;

  -- Greedy model steps a–c (banner): capacities, then assign existing
  -- picks in pick order.
  -- 094/MP.2 — HUNK 2 of 2, and the pair is one change: 086's
  -- `SELECT l.* INTO v_league` (which stood immediately after the drafts
  -- read, hunk 1) moves INTO the non-mock arm below, because on a mock the
  -- league is no longer read at all.
  --   * A MOCK reads its OWN snapshot. `create_mock_draft` stores it at
  --     launch (094 §1) and 094 §2 backfilled every mock that predates this
  --     migration, so there is no legacy row without one and NO league
  --     fallback is written here — a fallback would re-open exactly the
  --     re-hydration D95 forbids, and would keep a league read on a mock's
  --     path that MP.2 exists to remove.
  --   * A REAL draft is UNCHANGED — same live read, same source, byte-for-
  --     byte the same behaviour (tasks-MP §4 rule 11). Snapshot-at-start for
  --     real drafts is a bigger question than this task (a real league's
  --     settings edits go through the D141 pause-first commissioner
  --     controls); it is deliberately NOT decided here.
  IF v_draft.is_mock THEN
    -- R491 — ASSERT THE REASON FOR EMPTINESS, NEVER INFER IT (CLAUDE.md).
    -- The COALESCE below cannot tell "this mock was never snapshotted" from
    -- "this roster legitimately has no starting slots" (an all-bench roster
    -- is legal), and the first of those collapses every need term to the
    -- SAME value — the exact failure this migration exists to eliminate,
    -- arriving silently. Unreachable today (§1 writes the key at launch, §2
    -- backfills every existing mock and then PROVES none is left), but MP.3
    -- makes `league_id` nullable and MP.4 adds a settings writer, so the
    -- guard must exist BEFORE the reachability does. Keyed on KEY ABSENCE,
    -- not on an empty array.
    IF NOT (v_draft.config ? 'roster') THEN
      RAISE EXCEPTION
        'draft_autopick_resolve: mock draft % carries no roster snapshot (config->''roster'') — refusing to price an unsnapshotted mock as if every seat were filled (MP.2/094, R491)',
        p_draft_id
        USING ERRCODE = 'P0001';
    END IF;
    v_slots := COALESCE(v_draft.config->'roster'->'starting_slots', '[]'::jsonb);
  ELSE
    SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_draft.league_id;
    v_slots := COALESCE(v_league.roster_settings->'starting_slots', '[]'::jsonb);
  END IF;
  v_n_slots := COALESCE(jsonb_array_length(v_slots), 0);
  FOR v_i IN 1..v_n_slots LOOP
    v_counts[v_i] := COALESCE((v_slots->(v_i - 1)->>'count')::int, 0);
    v_filled[v_i] := 0;
  END LOOP;

  FOR v_row IN
    SELECT CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END AS pos
    FROM public.draft_picks p
    JOIN public.players pl ON pl.id = p.player_id
    WHERE p.draft_id = p_draft_id AND p.team_id = p_team_id
      AND p.is_undone = FALSE
    ORDER BY p.pick_number
  LOOP
    v_picks := v_picks + 1;
    v_have := jsonb_set(v_have, ARRAY[v_row.pos],
                        to_jsonb(COALESCE((v_have->>v_row.pos)::int, 0) + 1));
    v_placed := FALSE;
    FOR v_i IN 1..v_n_slots LOOP
      IF NOT v_placed
         AND v_filled[v_i] < v_counts[v_i]
         AND (v_slots->(v_i - 1)->'eligible') ? v_row.pos THEN
        v_filled[v_i] := v_filled[v_i] + 1;
        v_placed := TRUE;
      END IF;
    END LOOP;
    -- not placed => bench (implicit)
  END LOOP;

  FOR v_i IN 1..v_n_slots LOOP
    IF v_filled[v_i] < v_counts[v_i] THEN
      v_unfilled := v_unfilled + (v_counts[v_i] - v_filled[v_i]);
      v_need := v_need || ARRAY(
        SELECT jsonb_array_elements_text(v_slots->(v_i - 1)->'eligible'));
    END IF;
  END LOOP;

  v_remaining := COALESCE(v_draft.total_rounds, 0) - v_picks;
  v_forced := v_remaining <= v_unfilled;   -- greedy step d

  -- Source-priority enumeration (banner item 4). Each branch is gated so a
  -- no-user seat (v_user NULL) resolves straight to ADP; the queue branch
  -- carries the R120 team -> draft-league join.
  FOR v_row IN
    SELECT c.player_id, c.pos
    FROM (
      SELECT 1 AS src,
             row_number() OVER (ORDER BY q.rank, q.player_id) AS ord,
             q.player_id,
             CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END AS pos
      FROM public.draft_queues q
      JOIN public.teams t
        ON t.id = q.team_id
       AND t.league_id IS NOT DISTINCT FROM v_draft.league_id  -- R120 + 095
      JOIN public.players pl ON pl.id = q.player_id
      WHERE v_user IS NOT NULL
        AND q.draft_id = p_draft_id AND q.team_id = p_team_id
      UNION ALL
      SELECT 2,
             row_number() OVER (ORDER BY lp.position, lp.player_id),
             lp.player_id,
             CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END
      FROM public.league_lists ll
      JOIN public.lists ls ON ls.id = ll.list_id AND ls.deleted_at IS NULL
      JOIN public.list_players lp ON lp.list_id = ll.list_id
      JOIN public.players pl ON pl.id = lp.player_id
      WHERE v_user IS NOT NULL
        AND ll.league_id = v_draft.league_id
        AND ll.owner_id = v_user
        AND ll.is_primary_board = TRUE
      UNION ALL
      SELECT 3,
             row_number() OVER (ORDER BY lp.position, lp.player_id),
             lp.player_id,
             CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END
      FROM public.lists b
      JOIN public.list_players lp ON lp.list_id = b.id
      JOIN public.players pl ON pl.id = lp.player_id
      WHERE v_user IS NOT NULL
        AND b.owner_id = v_user AND b.is_big_board = TRUE
        AND b.deleted_at IS NULL
      UNION ALL
      SELECT 4,
             row_number() OVER (ORDER BY pl.adp NULLS LAST, pl.id),
             pl.id,
             CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END
      FROM public.players pl
    ) c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.draft_picks dp
      WHERE dp.draft_id = p_draft_id AND dp.player_id = c.player_id
        AND dp.is_undone = FALSE
    )
    ORDER BY c.src, c.ord
  LOOP
    IF v_forced THEN
      -- Greedy step d: every remaining pick must fill a required seat
      -- (E30's "until forced" arm rides need membership).
      v_ok := v_row.pos = ANY(v_need);
    ELSE
      -- Greedy steps e–g: E30 deferral + the 3rd-QB useful cap (caps lift
      -- when no starting seat is unfilled).
      -- 086/L.C1.4 — THE ONE HUNK: the E30 round-window escape is
      -- SNAKE/LINEAR's. D129(2) rules that an auction's K/DST deferral maps
      -- to the FORCED-ONLY arm below: there are no rounds in an auction, and
      -- `current_round` there is the display-only ROTATION LAP (D126), so
      -- inheriting the window would let a lap counter unlock kickers. K/DST
      -- therefore stay ineligible in OPEN mode for the whole auction and
      -- become eligible exactly when FORCED mode engages with a K/DST seat
      -- unfilled (pinned one unit short both ways, 035 §G).
      v_ok := (v_row.pos NOT IN ('K', 'DST')
               OR (v_draft.draft_type <> 'auction'
                   AND v_draft.current_round > v_draft.total_rounds - 3))
          AND (v_unfilled = 0
               OR COALESCE((v_have->>v_row.pos)::int, 0) <
                  (SELECT COALESCE(SUM((s->>'count')::int), 0)
                   FROM jsonb_array_elements(v_slots) s
                   WHERE s->'eligible' ? v_row.pos) + 1);
    END IF;
    IF v_ok THEN
      RETURN v_row.player_id;
    END IF;
  END LOOP;

  -- Greedy step h — the FLOOR: never stall the draft (§22.3). Lowest-ADP
  -- available with NO filters; NULL only when the pool is exhausted.
  SELECT pl.id INTO v_floor
  FROM public.players pl
  WHERE NOT EXISTS (
    SELECT 1 FROM public.draft_picks dp
    WHERE dp.draft_id = p_draft_id AND dp.player_id = pl.id
      AND dp.is_undone = FALSE
  )
  ORDER BY pl.adp NULLS LAST, pl.id
  LIMIT 1;
  RETURN v_floor;
END;
$$;

-- §4.1 posture restated after the replace (093 precedent).
REVOKE EXECUTE ON FUNCTION draft_autopick_resolve(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 17. draft_team_budget / draft_auction_solvent — heads 092:229-320 /
--     092:332-382. ONE hunk each: the standalone team set (banner item 4).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_team_budget(
  p_draft_id UUID,
  p_team_id UUID
)
RETURNS TABLE (remaining INTEGER, open_slots INTEGER, max_bid INTEGER, committed INTEGER)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_draft      public.drafts;
  v_budget     INTEGER;
  v_reserve    INTEGER;
  v_adjustment INTEGER;
  v_committed  INTEGER;
  v_filled     INTEGER;
  v_open       INTEGER;
  v_remaining  INTEGER;
BEGIN
  SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_team_budget: draft % not found (or not visible)', p_draft_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Budgets are an auction concept: a snake board writes no price, so any
  -- number produced here for one would be a plausible-looking fiction.
  IF v_draft.draft_type <> 'auction' THEN
    RAISE EXCEPTION
      'draft_team_budget: draft % is a % draft — budgets apply to auctions only (§8.6)',
      p_draft_id, v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  -- The membership guard uses the SAME team set the invariant checks —
  -- active franchises only. A RETIRED seat is deliberately outside
  -- draft_auction_solvent's sweep (§7.2/D96's capacity/order set), so
  -- answering a plausible full budget for one would be exactly the
  -- "nothing happened means it worked" trap this family raises on
  -- everywhere else: the answer is unknown, so it is LOUD (R321).
  -- 095/MP.3 — a STANDALONE mock has no league, so "active franchise of the
  -- league" is not a question that can be asked of it. Its team set is the
  -- seat map it was launched with: `drafts.draft_order`, which
  -- create_mock_draft validated as a permutation of the seats it minted.
  -- Same loudness, same shape, a different authority for the set — and the
  -- league branch below is 092's text unchanged (tasks-MP §4 rule 11).
  IF v_draft.league_id IS NULL THEN
    IF NOT (COALESCE(v_draft.draft_order, '[]'::jsonb) ? p_team_id::text) THEN
      RAISE EXCEPTION
        'draft_team_budget: team % is not a seat in standalone mock % (the draft order IS the team set)',
        p_team_id, p_draft_id
        USING ERRCODE = 'P0002';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = p_team_id
      AND t.league_id = v_draft.league_id
      AND t.status <> 'retired'
  ) THEN
    RAISE EXCEPTION
      'draft_team_budget: team % is not an ACTIVE franchise in draft %''s league (retired seats are outside the §8.6.8 team set)',
      p_team_id, p_draft_id
      USING ERRCODE = 'P0002';
  END IF;

  -- total_rounds IS the auction's per-team roster capacity (D91/D126); an
  -- unset one would make open_slots NULL and every downstream comparison
  -- silently unknown.
  IF v_draft.total_rounds IS NULL OR v_draft.total_rounds < 1 THEN
    RAISE EXCEPTION
      'draft_team_budget: draft % has no roster capacity (total_rounds is %) — budgets are underivable',
      p_draft_id, COALESCE(v_draft.total_rounds::text, 'unset')
      USING ERRCODE = 'P0001';
  END IF;

  v_budget     := COALESCE((v_draft.config->>'auction_budget')::int, 200);   -- §7.3.8 defaults
  -- 092/AP.1: the per-slot RESERVE, through the ONE authority (D198(1);
  -- §7.3.8's auction_zero_dollar_nominations row). $1 with the toggle OFF,
  -- $0 with it ON — never a private COALESCE, and never the bid increment,
  -- which is the fixed $1 of §8.6.3 and lives nowhere near this line.
  v_reserve    := public.draft_auction_reserve(v_draft.config);
  v_adjustment := COALESCE((v_draft.budget_adjustments->>p_team_id::text)::int, 0);  -- D127

  SELECT COALESCE(SUM(p.price), 0)::int, COUNT(*)::int
    INTO v_committed, v_filled
  FROM public.draft_picks p
  WHERE p.draft_id = p_draft_id
    AND p.team_id = p_team_id
    AND p.is_undone = FALSE;                     -- undone picks refund by derivation (D131)

  v_remaining := v_budget + v_adjustment - v_committed;
  v_open      := v_draft.total_rounds - v_filled;

  RETURN QUERY SELECT
    v_remaining,
    v_open,
    -- §8.6.1: max_bid = remaining − (open_slots − 1) × reserve. A complete
    -- roster bids nothing at all (E27) — that is the ONLY special case;
    -- the formula is otherwise unclamped so an insolvent state stays
    -- visible to draft_auction_solvent instead of being rounded away.
    CASE WHEN v_open <= 0 THEN 0
         ELSE v_remaining - ((v_open - 1) * v_reserve) END,
    v_committed;
END;
$$;

-- §4.1 posture restated after the replace (093 precedent).
REVOKE EXECUTE ON FUNCTION draft_team_budget(UUID, UUID) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION draft_auction_solvent(p_draft_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_draft   public.drafts;
  v_reserve INTEGER;
  v_ok      BOOLEAN;
BEGIN
  SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_auction_solvent: draft % not found (or not visible)', p_draft_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_draft.draft_type <> 'auction' THEN
    RAISE EXCEPTION
      'draft_auction_solvent: draft % is a % draft — the solvency invariant applies to auctions only (§8.6.8)',
      p_draft_id, v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  -- 092/AP.1: the §8.6.8 reserve, through the ONE authority (D198(1)). The
  -- invariant is NOT made conditional and NOT weakened: with
  -- auction_zero_dollar_nominations ON the reserve is 0 and the whole
  -- expression degenerates to `remaining >= 0` — still checked, still loud
  -- on an empty franchise set, it simply stops binding (§8.6.8, D198(4)).
  v_reserve := public.draft_auction_reserve(v_draft.config);

  -- 095/MP.3 — the same team-set question draft_team_budget answers one
  -- level down: a league draft sweeps the league's ACTIVE franchises;
  -- a standalone mock sweeps its OWN seat map (`drafts.draft_order`).
  -- Without this arm the sweep over `t.league_id = NULL` returns zero rows,
  -- `bool_and` is NULL, and the LOUD empty-set RAISE below fires on every
  -- standalone auction — the launch would refuse itself. The league branch
  -- is 092's text unchanged (tasks-MP §4 rule 11).
  IF v_draft.league_id IS NULL THEN
    SELECT bool_and(b.remaining >= b.open_slots * v_reserve)
      INTO v_ok
    FROM jsonb_array_elements_text(COALESCE(v_draft.draft_order, '[]'::jsonb)) AS s(seat)
    CROSS JOIN LATERAL public.draft_team_budget(p_draft_id, s.seat::uuid) b;
  ELSE
    SELECT bool_and(b.remaining >= b.open_slots * v_reserve)
      INTO v_ok
    FROM public.teams t
    CROSS JOIN LATERAL public.draft_team_budget(p_draft_id, t.id) b
    WHERE t.league_id = v_draft.league_id
      AND t.status <> 'retired';                 -- the capacity/order team set
  END IF;

  -- bool_and over zero rows is NULL, and `IF NOT solvent` would sail
  -- straight past a NULL: an empty franchise set must be LOUD, never a
  -- vacuous TRUE (CLAUDE.md — "never let nothing happened mean it
  -- worked").
  IF v_ok IS NULL THEN
    RAISE EXCEPTION
      'draft_auction_solvent: draft % has no active franchises to check — refusing to report solvency over an empty set',
      p_draft_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_ok;
END;
$$;

-- §4.1 posture restated after the replace (093 precedent).
REVOKE EXECUTE ON FUNCTION draft_auction_solvent(UUID) FROM PUBLIC, anon, authenticated;
