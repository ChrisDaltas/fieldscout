-- ============================================================================
-- `commish_rename_team` + `rename_own_team` — the team-name verbs, neither of
-- which existed — migration 128
-- (task L.E1.7 of M6A; tasks-M6A §6 "L.E1.7", §5's contractual shapes, §3
-- D335 / D336 / D350; §4 rules 1-15; PROGRESS §3 STANDING RULE clauses (b),
-- (d), (g), (i) and Q53(e)(i); `spec:183` (§7.2.1(b)); §10.3, §12.12, §12.26).
--
-- WHAT THIS MIGRATION DOES
--   1. `commish_team_actions` — this verb family's OWN zero-policy replay
--      ledger (D350), `UNIQUE (league_id, action_id)` + `REVOKE TRUNCATE`.
--   2. `team_rename_normalize_internal` — the shared name gate (trim with the
--      EXPLICIT whitespace class, 1..100), so both doors bound the name the
--      same way and a future third door cannot drift.
--   3. `commish_rename_team_internal` + `commish_rename_team` — the audited
--      commissioner verb, the 123 template in all seven parts.
--   4. `rename_own_team_internal` + `rename_own_team` — the MANAGER's own
--      rename. Not audited, no reason, no receipt (see THE AUTHORITY GAP and
--      THE DROP SEAM below).
--
-- ---------------------------------------------------------------------------
-- THE AUTHORITY GAP, SAID PLAINLY, BECAUSE §15.4 DOES NOT LIST EITHER VERB
-- ---------------------------------------------------------------------------
-- `commish_rename_team` RIDES STANDING RULE (d), WHICH NAMES IT BY NAME.
-- PROGRESS §3's standing rule, clause (d) (`PROGRESS-leagues.md`, grep
-- *"(d) SO M6A's SCOPE"*): M6A's scope is *"§15.4 IN FULL … plus
-- **`commish_rename_team`**, which §15.4 does NOT list and which no verb
-- anywhere provides (Q53(e)(i)) — under this rule its absence is a defect."*
-- Q53(e)(i) is where it surfaced: Chris's own sentence — *the commissioner
-- names every team* — is impossible today, because the single naming door is
-- `add_placeholder_seat`'s optional `p_team_name` (`063:451`), which refuses
-- outside setup/scheduled (`063:435-438`), and the shipped invite UI sends no
-- name at all. Folded to the spec as the v2.16.39 erratum (F338). Standing
-- rule (i) is satisfied in the other direction too: a rename REPAIRS a state
-- the rules already contemplate (§7.2.1(a) says a takeover inherits the name,
-- *"renameable"*), it does not redefine the game.
--
-- `rename_own_team` RIDES NOTHING. There is no §15.4 line and no ruling
-- behind it — only F338's measurement that the gap is TOTAL, for a manager
-- exactly as for a commissioner. tasks-M6A §6 L.E1.7 item 2 puts it here
-- because *"building the commissioner's half while leaving a manager unable
-- to name his own franchise is the odder of the two outcomes"*, and says in
-- the same breath that dropping it *"is a one-line answer at approval, not a
-- Q"*. It is built; the seam below is how it comes out.
--
-- ---------------------------------------------------------------------------
-- THE GAP, PROVEN BY EXHAUSTION (F338) — re-measured this session against
-- migrations 001-127, not copied from the breakdown
-- ---------------------------------------------------------------------------
--   * `grep -n 'UPDATE public\.teams'` over `supabase/migrations/` returns
--     **ELEVEN** statements across **FOUR** migrations — `062:282`,
--     `063:903`, `063:928`, `063:947`, `063:1073`, `063:1089`, `077:442`,
--     `120:454`, `120:540`, `120:656`, `120:675` — and every one of their SET
--     lists was opened and read. They write only `owner_id`, `status`,
--     `retired_at_week`, `successor_team_id` and `updated_at`. **NOT ONE
--     TOUCHES `name`.**
--   * And no client can rename either. `grep -n 'ON teams FOR UPDATE'` returns
--     exactly ONE policy in the whole chain, `095:636-639`:
--         USING (auth.uid() = owner_id AND league_id IS NULL)
--     whose SECOND conjunct excludes every league franchise. A team with a
--     non-NULL `league_id` matches **no UPDATE policy at all**, so its `name`
--     is written once at INSERT (`060:292` / `063:455-456` / `077:339` /
--     `118:2412` / `120:531`) and is thereafter unchangeable by any role short
--     of the table owner.
--   * pgTAP 076 §C asserts that gap **before this migration closes it**, with
--     its premise and a positive control, so the 0-row UPDATE says WHY and
--     never merely THAT (§4 rules 14(c) and 15).
--
-- ---------------------------------------------------------------------------
-- THE DROP SEAM — EXACTLY WHAT TO DELETE IF CHRIS WANTS ONLY THE
-- COMMISSIONER'S HALF (tasks-M6A §6 L.E1.7 item 2)
-- ---------------------------------------------------------------------------
-- Four deletions, no edits anywhere else, and nothing in M6A moves:
--   (1) §4 of this file — `rename_own_team_internal` + `rename_own_team` and
--       their REVOKEs. The file's §§1-3 do not reference them.
--   (2) pgTAP 076: delete §F (`F1`-`F12`, its fixture premise F10 included)
--       whole; in §A take A6's expected function count 5 → 3, drop the two
--       `rename_own_team%` names from A7 / A8 / A11 / A12's lists, and
--       delete A10 and A14; in §J delete **J6** (the anon probe of the
--       manager door — R1030: the first cut's seam omitted it, and a seam
--       executed as written left the suite red on `42883 function
--       public.rename_own_team does not exist`); then `plan(92)` →
--       `plan(77)` (92 − 12 − 2 − 1). §B's fixture rows for T6/u6 and cell
--       B1 may stay — they are fixture, not manager-verb, cells. **EXECUTED
--       ON A SCRATCH COPY in the R1030 fix round: 77/77 green, nothing
--       dangling.**
--   (3) `src/types/database.ts` — REGENERATE, never hand-edit. `supabase gen
--       types` emits every public-schema function REGARDLESS OF GRANTS
--       (measured on this migration: all five of its functions appear under
--       `Functions`, including the three triple-REVOKEd internals), so
--       dropping §4 removes exactly TWO entries, `rename_own_team` and
--       `rename_own_team_internal`. The hand-written alias block at the foot
--       of that file — 42 exports, 41 `export type` + 1 `export interface`,
--       measured, not copied — names neither verb but IS clobbered by the
--       generator and must be re-appended.
--   (4) The `rename_own_team` sentences in PROGRESS §4's D359.
-- Nothing else in this migration, in 123-127, or in L.E1.8-L.E1.14 depends on
-- the manager arm: `team_rename_normalize_internal` is SHARED but is called by
-- the commissioner path too and stays, and `commish_team_actions` is the
-- commissioner verb's ledger alone (the manager verb writes no ledger row —
-- see §4's header).
--
-- ---------------------------------------------------------------------------
-- THE ONE REFUSAL, AND IT IS THE SPEC'S OWN (item 3)
-- ---------------------------------------------------------------------------
-- `spec:183` (§7.2.1(b), *"Retire & succeed"*): a retired franchise's identity
-- is *"**sealed**"* — *"`teams.status='retired'`, name/record frozen"*. So
-- `commish_rename_team` refuses a `retired` team BY NAME. This is a LEGALITY
-- gate and not a timing one, so PROGRESS standing rule (i) says it binds the
-- commissioner too: *"it's not fixing something that's broken, it's changing
-- the game entirely"* — the sealed franchise IS the record, and renaming it
-- would rewrite what History Mode shows under its last manager's name. The
-- refusal names **F354** (no verb un-retires a franchise) rather than telling
-- the commissioner to un-retire first, which R1020 already had to correct once
-- in 127: a remedy that does not exist is a route to nowhere.
--
-- **THE MANAGER PATH CARRIES THE SAME RETIRED GUARD (R1029, the fix round of
-- PR #298).** `spec:183` freezes a retired franchise's name FOR EVERYONE, so
-- `rename_own_team_internal` step (3b) refuses `status = 'retired'` BY NAME
-- with the same F354-naming message shape as the commissioner arm's step (6),
-- so a future reader finds one truth, not two.
--
-- WHAT THE FIRST CUT SAID, RETRACTED IN PLACE (the F342 precedent — struck,
-- with the correction beside it): ~~"the manager path carries no retired
-- guard, and that is a measurement, not an omission (§4 rule 14(b) / D267):
-- `120:565-570` re-points the seat at the successor with `user_id = NULL`, so
-- a retired franchise has no `league_members` row naming any user, the auth
-- predicate can never match one, a guard after it could not execute, and a
-- pgTAP cell for it would need a fixture the product cannot produce"~~.
-- THE CORRECTION: that exclusion was never STRUCTURAL — it was an invariant
-- maintained by three OTHER verbs' guards (`create_league_invite` `062:378`,
-- `claim_league_invite` `062:865`, `assign_manager` `063:688`, each refusing
-- `retired` before `seat_league_member_internal`'s branch (b) is reached),
-- and that helper's fallback at `077:428-437` does an UNCONDITIONAL
-- `INSERT INTO league_members (…, team_id = p_team_id)` when its UPDATE
-- matches 0 rows — which is exactly what happens for a retired team, whose
-- row was re-pointed at the successor. None of those three guards was pinned
-- by 076, and F7's fixture omitted the seated row BY HAND, so F7 asserted its
-- own premise rather than anything `remove_manager` produced. The Reviewer
-- planted a `retired` team plus a seated `league_members` row in a rolled-back
-- transaction and renamed it through the manager door: `Unsealed By Manager |
-- retired`. The state IS reachable in SQL, so the guard IS provable — which is
-- also why this is not rule 14(b)'s species: that rule is about a guard an
-- outer condition IN THE SAME FUNCTION has excluded, not one that three
-- remote verbs happen to keep out today. pgTAP 076 **F10-F12** use exactly
-- that fixture (T6 `retired`, seated by u6): F10 asserts the seated row is
-- there, F11 the refusal BY NAME, F12 the sealed name untouched. **F7** stays
-- and now says what it proves — that a retired franchise with NO seat is
-- answered by the auth 42501 (auth runs before the guard, and a stranger
-- learns nothing) — not that the guard is unnecessary.
--
-- ---------------------------------------------------------------------------
-- THE PROPAGATION FINDING (item 4) — A RECEIPT RECORDS WHAT WAS TRUE
-- ---------------------------------------------------------------------------
-- `teams.name` is read LIVE at every call site, so a rename mostly propagates
-- for free and this migration writes NO propagation pass. Measured examples:
-- `123:1155` stamps `metadata.team_name` by joining `teams` at write time;
-- `127:1413-1416` does the same for `from_team_name` / `to_team_name`;
-- `120:531` reads the live franchise count to name a successor;
-- `league_standings_internal` and the box score join `teams` per read.
--
-- The FROZEN copies are the two that were already written, and they MUST keep
-- the OLD name:
--   * `league_chat` system posts already in the log (§10.3's non-disableable
--     override messages, and every D97 post before them); and
--   * `commissioner_actions.metadata.team_name` on receipts already issued.
-- Rewriting either would make an audit log say something that was never true,
-- which §18 / §12.12 exist to prevent — and `commissioner_actions` physically
-- refuses it anyway (`123:339-410`'s `ENABLE ALWAYS` BEFORE UPDATE OR DELETE
-- trigger). So the rename REPORTS them rather than touching them:
-- `propagation.frozen_receipts_for_this_team` is a MEASURED count of receipts
-- already issued ABOUT THIS FRANCHISE that record a name it no longer carries,
-- and `propagation.history_rewritten` is FALSE with its reason spelled out
-- (§4 rule 15 — name every downstream that did NOT follow). pgTAP 076 §H
-- asserts an existing receipt AND an existing chat post still read the OLD
-- name after a second rename, with the premise asserted first.
--
-- ---------------------------------------------------------------------------
-- `action_type = 'reassign_team'`, AND WHY THAT IS THE STRING (F355)
-- ---------------------------------------------------------------------------
-- tasks-M6A §5's audit-row table is explicit and is called *"contractual, so
-- the activity feed can render them without a special case"*: the rename verb
-- stamps `action_type = 'reassign_team'`, `target_type = 'team'`,
-- `target_id = team_id::text`, `before`/`after` = `{name}`, with `team_name`
-- (the OLD one) and `action_id` in `metadata`. That is what ships. It is also
-- the only string available: §12.12's printed vocabulary (`spec:1189-1193`,
-- re-stated at `123:280-286`) has a `reassign_team` and **no** `rename_team`,
-- and `action_type` is deliberately NOT a CHECK so that adding one would not
-- be a schema change (`123:279-286`). The word nevertheless reads like "give
-- this franchise to someone else" rather than "rename it", so **F355** is
-- filed for L.E1.11's `GET /commish/log` and L.E1.13's copy: the feed must
-- render `reassign_team` from its `before`/`after` keys (a `{name}` pair is a
-- rename), never from the verb string alone.
--
-- ---------------------------------------------------------------------------
-- NO STATUS GATE, AND THAT IS DELIBERATE (stated so the absence is not read as
-- an oversight). A rename is meaningful in every league status — a league in
-- `setup` is exactly where Chris's *"the commissioner names every team"*
-- lives, and one that is `complete` may still be tidied. Standing rule (a)
-- scopes the power to *"any time the league is in a state where the action is
-- meaningful"*; the only state where it is not is the sealed franchise above.
-- Nothing about a name touches scoring, the lock, or the calendar, so there is
-- nothing for standing rule (g) to exempt: `bypassed` is `[]` and the result
-- says WHY it is empty rather than leaving an empty array to be guessed at.
--
-- NAME UNIQUENESS IS REPORTED, NEVER REFUSED. Measured: there is no UNIQUE
-- index or CHECK on `teams.name` anywhere in 001-127, and `add_placeholder_seat`
-- happily mints a second *"Team 3"* if one was renamed away. Inventing a
-- refusal here would be new product on a verb that exists to remove a
-- restriction, so `name_collides_with[]` carries the ids of the other
-- franchises in the league already using the name (case-insensitively) and the
-- caller decides. Both doors report it.
--
-- ---------------------------------------------------------------------------
-- D137 PROVENANCE: **THIS MIGRATION REPLACES NOTHING. ZERO HUNKS.**
-- Every function below is NEW — `commish_team_actions`,
-- `team_rename_normalize_internal`, `commish_rename_team_internal`,
-- `commish_rename_team`, `rename_own_team_internal`, `rename_own_team` are
-- each defined for the first time in the whole chain (`grep -rn` over
-- `supabase/migrations/` returns them only here). No `CREATE OR REPLACE`
-- against another migration's file text, so there is no decoy head to get
-- wrong and no hunk count to state beyond zero. In particular **062, 063, 077,
-- 095, 114, 115, 120 and 123 are all BYTE-UNTOUCHED**, and §4 rule 13's
-- never-weaken pins for the two that matter — `095`'s standalone UPDATE policy
-- and `set_lineup_internal`'s manager auth — are pgTAP 076 §I.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4): additive only (one new table, six new
-- functions); no column dropped, no policy dropped, no function replaced; RLS
-- enabled with ZERO policies on the new table plus the per-role
-- `REVOKE TRUNCATE` (D350 — RLS does not cover TRUNCATE and the Supabase
-- default grants it to `anon`/`authenticated`, which is why pgTAP asserts it
-- with `has_table_privilege` per role and not through `pg_policies`);
-- **NO `HELD-FROM-PRODUCTION.txt` ENTRY — the hold is over (PR #282), and the
-- file is retired.** Migrations 125, 126, 127 and now 128 all await Chris's
-- `npx supabase db push`; 128 is authored against the repo's chain and never
-- against a deployed body (CLAUDE.md migration discipline).
--
-- WAIVERS: none. R6 (the mock-seat carve-out) and D38 (the legacy `teams`
-- rows) are not engaged — this migration adds no constraint to an existing
-- table and backfills nothing.
--
-- D336's SEVEN PARTS, AND WHERE EACH ONE IS
--   (1) the ledger      → §1, `commish_team_actions` (its own namespace; the
--                         pre-planted-row attack `123:333-335` makes possible
--                         is why it is not `commissioner_actions`)
--   (2) ONE audit row   → §3 step (9), through `log_commissioner_action_internal`
--                         (`123:417-453`), INSIDE the no-op guard and AFTER
--                         the state write, with `IF v_audit_id IS NULL RAISE`
--   (3) the no-op       → §3 step (8), DETECTED by value across every
--                         dimension this verb can change — which is exactly
--                         one, `name` — ledger row written anyway
--   (4) the chat post   → §3 step (10), in-txn and non-disableable (§10.3)
--   (5) the posture     → PLAIN `search_path=''` internals taking `p_at`,
--                         triple-REVOKEd, under SECURITY DEFINER wrappers
--                         passing `now()` (D307(3)); in-body auth as ONE
--                         no-leak 42501
--   (6) the reason gate → §3 step (4), the explicit `E' \t\r\n'` class at the
--                         RPC layer, matching the table CHECK (`123:295-296`)
--   (7) the result      → names the empty `bypassed` and WHY, the propagation
--                         that did not need to happen and the history that
--                         deliberately did not follow, and
--                         `commissioner_action_id`, NULL on a no-op
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. commish_team_actions — this verb family's OWN replay ledger (D350).
--    Never shared with commish_lineup_actions / commish_matchup_actions /
--    commish_roster_actions, and never folded into commissioner_actions:
--    §12.12 ships a client INSERT policy (`123:333-335`), so a commissioner
--    could pre-plant a row carrying an action_id his client is about to send
--    and a fabricated `result`, and the replay would return it having renamed
--    nothing. A separate ZERO-POLICY table makes that impossible rather than
--    merely refused.
--
--    ONLY the commissioner verb writes here. `rename_own_team` takes no
--    action_id at all (tasks-M6A §5 prints `rename_own_team(p_team_id,
--    p_name)`) and needs none: setting a name to a value is idempotent by
--    construction — a retry writes the same string, detects the no-op and
--    returns the same document — while the commissioner verb's receipt is
--    NOT idempotent (a second audit row and a second chat post would be two
--    receipts for one act), which is what the ledger prevents.
-- ---------------------------------------------------------------------------
CREATE TABLE commish_team_actions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,  -- the franchise renamed
  action_id  UUID NOT NULL,                       -- client-minted; dedupes retries (the E2/D68 replay key)
  actor_id   UUID NOT NULL REFERENCES profiles(id),
  result     JSONB NOT NULL,                      -- the verb's returned jsonb, replayed byte-identically
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, action_id)                   -- the race backstop behind the select-then-insert
);
CREATE INDEX idx_commish_team_actions_team ON commish_team_actions(team_id);

COMMENT ON TABLE commish_team_actions IS
  'Idempotency ledger for commish_rename_team (migration 128, D350). ZERO policies: the DEFINER verb is the only reader and writer. NOT the audit log — §12.26: "an action_id is an idempotency key, not an audit record" — so a row is written for a NO-OP too, while commissioner_actions is not.';

ALTER TABLE commish_team_actions ENABLE ROW LEVEL SECURITY;
-- ZERO policies (112:330's posture). RLS does NOT cover TRUNCATE and the
-- Supabase default grants it to anon and authenticated (R967, measured on
-- commish_lineup_actions at `123:485-491`), so a client could otherwise have
-- emptied a ledger it can read nothing in. Taken away here — §4 rule 12, and
-- F349's app-wide sweep (deferred by Chris's ruling 2026-09-13, "we currently
-- have no users so it's fine") is deliberately NOT widened by this table.
-- Asserted PER ROLE with has_table_privilege in pgTAP 076 §A: a pg_policies
-- cell structurally cannot see a TRUNCATE grant, which is how F348's hole
-- survived 070.
REVOKE TRUNCATE ON TABLE commish_team_actions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. team_rename_normalize_internal — the SHARED name gate, so both doors
--    bound the name identically and a third door cannot drift from them.
--
--    THE BOUND IS `z.string().trim().min(1).max(100)` — tasks-M6A §6 L.E1.7
--    item 3, *"the league-rename bound"*, which is
--    `createLeagueInputSchema.name` (`leagues-service.ts`, grep
--    `createLeagueInputSchema`). The service-layer mirror of this gate lands
--    with L.E1.11's `POST /api/leagues/[id]/commish/team`; until then the RPC
--    IS the whole gate, which is the right order — server-authoritative
--    always.
--
--    THE TRIM CLASS IS EXPLICIT, for the reason 123's reason CHECK is
--    (`123:290-294`, DEVIATION 1): plain `btrim` strips SPACES ONLY, so a
--    tab- or newline-only name would pass a naive `NULLIF(btrim(x), '')` and
--    a franchise would end up named E'\t'. That is R745's hole, already fixed
--    twice (`112:756`, `114:316`), and it is not re-opened here.
--
--    NOTE ON THE EXISTING 60-CHARACTER TEAM-NAME BOUND. `createLeagueInput`'s
--    OPTIONAL `team_name` is `.max(60)` while the LEAGUE name is `.max(100)`,
--    and no SQL bound exists on either (measured: no CHECK and no UNIQUE on
--    `teams.name` in 001-127; `060:292` / `063:455-456` / `077:339` / `118:2412`
--    only `btrim` it). The breakdown chose 100 for this verb explicitly, so
--    100 is what ships; the divergence is recorded as **F356** for L.E1.11 to
--    settle in one place rather than have two client schemas disagree.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION team_rename_normalize_internal(
  p_name TEXT,
  p_verb TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_name TEXT;
BEGIN
  v_name := NULLIF(btrim(COALESCE(p_name, ''), E' \t\r\n'), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION
      '%: a team name is required — blank, or nothing but whitespace (spaces, tabs, newlines), is not a name', COALESCE(p_verb, 'team_rename')
      USING ERRCODE = '22023';
  END IF;
  IF char_length(v_name) > 100 THEN
    RAISE EXCEPTION
      '%: the name is % characters — at most 100 (the league-rename bound, createLeagueInputSchema.name)', COALESCE(p_verb, 'team_rename'), char_length(v_name)
      USING ERRCODE = '22023';
  END IF;
  RETURN v_name;
END;
$$;
REVOKE EXECUTE ON FUNCTION team_rename_normalize_internal(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. commish_rename_team_internal — the audited commissioner verb (123's
--    template; D336's seven parts are mapped in the banner). PLAIN,
--    search_path='', takes the instant as an argument so pgTAP can drive the
--    TimeProvider seam.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_rename_team_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_name      TEXT,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league     public.leagues;
  v_found      BOOLEAN;
  v_team       public.teams;
  v_reason     TEXT;
  v_new_name   TEXT;
  v_old_name   TEXT;
  v_no_changes BOOLEAN;
  v_collides   JSONB;
  v_frozen     INTEGER;
  v_audit_id   UUID;
  v_message    TEXT;
  v_result     JSONB;
  v_cnt        INTEGER;
BEGIN
  -- (0) SHAPE. A malformed call is refused BY NAME and is never answered with
  --     `no_changes: true` — a success document for a request that never said
  --     what it wanted is 126's rule, and it is this verb's too.
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'commish_rename_team: p_team_id is required — an override that names no franchise is not an override'
      USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'commish_rename_team: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8 — the same
  --     serialization point every in-season verb takes). A rename is a
  --     read-then-write over `teams.name`, so without it two concurrent
  --     renames could each observe a change and each write one, and the
  --     LOSER's audit row would claim a `before` that was never the row's
  --     value by the time it landed. The receipt has to be true.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — COMMISSIONER ONLY, in-body, as ONE no-leak 42501 covering "no
  --     such league" and "not a commissioner" alike (D336 part 5). The
  --     manager's door is §4's `rename_own_team`, which this verb does not
  --     widen and does not replace.
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_rename_team: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2), placed AFTER auth but BEFORE every business gate
  --     (`123:602-609`'s placement), so a retry replays byte-identically even
  --     when the league has since moved on — including after the franchise
  --     has been renamed again by someone else.
  SELECT a.result INTO v_result
  FROM public.commish_team_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  -- (4) THE REASON, required unconditionally (§15.4:1690's header, "all
  --     require reason"; standing rule (b) is the condition on the power).
  --     Blank = nothing but whitespace INCLUDING tabs and newlines (R745 —
  --     plain btrim strips SPACES only); bounded at 500, which is the
  --     league_chat bound and the commissioner_actions CHECK (`123:295-296`).
  --     PROGRESS (h)/F343: the reason is a client-supplied LABEL, never a
  --     prompt — the commissioner is not asked for prose.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION
      'commish_rename_team: a reason is required — this verb writes an audited commissioner_actions row the whole league can read (§15.4, §10.3)'
      USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      'commish_rename_team: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (4b) THE NAME, through the shared gate (§2).
  v_new_name := public.team_rename_normalize_internal(p_name, 'commish_rename_team');

  -- (5) THE FRANCHISE. Locked in its own right so the before/after pair the
  --     receipt carries is the value this statement actually replaced.
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id FOR UPDATE;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'commish_rename_team: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  v_old_name := v_team.name;

  -- (6) THE ONE REFUSAL, AND IT IS THE SPEC'S OWN (`spec:183`, §7.2.1(b)):
  --     a retired franchise is SEALED and its "name/record frozen". A
  --     LEGALITY gate, not a timing one, so PROGRESS standing rule (i) binds
  --     the commissioner too — the sealed franchise IS the record History
  --     Mode shows under its last manager's name, and renaming it changes
  --     what the league's history says rather than fixing what went wrong.
  --     The message names F354 instead of a remedy nobody built (R1020's
  --     lesson from 127): NO verb un-retires a franchise today.
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION
      'commish_rename_team: franchise % is RETIRED — its name is FROZEN, because a sealed franchise is the record History Mode shows under its last manager (spec:183, §7.2.1(b)). This is a legality gate and it binds the commissioner too (PROGRESS standing rule (i)). NO VERB UN-RETIRES A FRANCHISE TODAY (F354), so there is no "un-retire first" to offer; rename the SUCCESSOR franchise (%) instead',
      p_team_id, COALESCE(v_team.successor_team_id::text, 'none recorded')
      USING ERRCODE = 'P0001';
  END IF;

  -- (7) THE COLLISION REPORT — measured, never a refusal. There is no UNIQUE
  --     index and no CHECK on `teams.name` anywhere in 001-127, and inventing
  --     one inside a verb that exists to REMOVE a restriction would be new
  --     product. So the other franchises already using this name are named
  --     and the caller decides (§4 rule 15: say what is true out loud).
  SELECT COALESCE(jsonb_agg(t.id ORDER BY t.name, t.id), '[]'::jsonb) INTO v_collides
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.id <> p_team_id
    AND lower(t.name) = lower(v_new_name);

  -- (8) THE NO-OP, DETECTED BY VALUE across every dimension this verb can
  --     change — which is exactly ONE, `name` (D336 part 3, §4 rule 15).
  --     Never inferred from an empty write: the UPDATE below sits INSIDE the
  --     guard, so `updated_at` does not move for a no-op either.
  v_no_changes := (v_old_name = v_new_name);

  IF NOT v_no_changes THEN
    -- (8b) THE STATE WRITE, with the loud ROW_COUNT assertion the house uses
    --      (`119:882-886`'s shape). The row is already locked by (5), so a
    --      count other than 1 means the row vanished under us, not a race we
    --      can paper over.
    UPDATE public.teams
    SET name = v_new_name,
        updated_at = p_at
    WHERE id = p_team_id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'commish_rename_team: the rename touched % rows, expected exactly 1 (franchise %)', v_cnt, p_team_id
        USING ERRCODE = 'P0001';
    END IF;

    -- (8c) THE FROZEN COPIES, COUNTED BEFORE THIS ACT'S OWN RECEIPT IS
    --      WRITTEN. Receipts already issued in this league that carry the OLD
    --      name keep carrying it — a receipt records what was true (§18,
    --      §12.12), and `123:339-410`'s ENABLE ALWAYS trigger refuses an
    --      UPDATE of one anyway. Counted, not asserted, so the number in the
    --      document is measured (§4 rule 15).
    --
    --      SCOPE, STATED so the number is readable: receipts already issued
    --      ABOUT THIS FRANCHISE (`target_type = 'team'`, `target_id` = this
    --      id) whose recorded `metadata.team_name` is not the name the
    --      franchise carries after this statement. Those are exactly the rows
    --      a reader might expect a propagation pass to have rewritten, and
    --      exactly the rows that must not be.
    SELECT count(*)::int INTO v_frozen
    FROM public.commissioner_actions c
    WHERE c.league_id = p_league_id
      AND c.target_type = 'team'
      AND c.target_id = p_team_id::text
      AND c.metadata ->> 'team_name' IS NOT NULL
      AND c.metadata ->> 'team_name' IS DISTINCT FROM v_new_name;

    -- (9) D336 part 2 — EXACTLY ONE audit row, through the ONE shared logging
    --     helper (`123:417-453`), INSIDE the no-op guard and AFTER the state
    --     write. tasks-M6A §5's contractual shape for this verb.
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'reassign_team', 'team', p_team_id::text, v_reason,
      jsonb_build_object('name', v_old_name),
      jsonb_build_object('name', v_new_name),
      jsonb_build_object(
        'verb',                'commish_rename_team',
        'season',              v_league.season,
        'action_id',           p_action_id,
        -- §5's contractual extra: the OLD name, which is also the value this
        -- receipt freezes for ever.
        'team_name',           v_old_name,
        'new_team_name',       v_new_name,
        'team_status',         v_team.status,
        'name_collides_with',  v_collides,
        'bypassed',            '[]'::jsonb,
        'frozen_receipts_for_this_team', v_frozen),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_rename_team: the audit row was not written — refusing to let the rename stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- (10) §10.3: override system messages auto-post to league chat and CANNOT
    --      be disabled. D97/D290's in-txn post, worded as the rename.
    v_message := v_old_name || ' is now ' || v_new_name
      || ' — renamed by ' || public.draft_actor_name() || ' (commissioner override)'
      || ' — reason: ' || v_reason;
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   'commish_rename_team',
    'action_type',            'reassign_team',       -- tasks-M6A §5's contractual string; F355
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'team_id',                p_team_id,
    'team_status',            v_team.status,
    'name',                   CASE WHEN v_no_changes THEN v_old_name ELSE v_new_name END,
    'previous_name',          v_old_name,
    'requested_name',         v_new_name,
    'name_collides_with',     v_collides,
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN
                                'name_already_set — the franchise already carried this exact name (compared after the same trim), so nothing was written and no receipt was issued (PROGRESS standing rule (b))' END,
    'commissioner_action_id', v_audit_id,            -- NULL on a no-op, and that is the point
    -- Standing rule (g) exempts the commissioner from the game-day lock for
    -- every verb in this slice — but a NAME touches no lock, no week gate and
    -- no scoring door, so there is nothing here to walk past. The empty array
    -- is EXPLAINED rather than left to be guessed at (§4 rule 15).
    'bypassed',               '[]'::jsonb,
    'bypassed_why',           'nothing to bypass — a franchise name is not gated by the per-player kickoff lock (114:449-476), the week status, or the scoring snapshot; the only gate on it is the sealed-franchise refusal above, which is a LEGALITY gate and binds the commissioner too (standing rule (i))',
    'propagation', jsonb_build_object(
      -- Item 4's finding, in the document as well as the banner.
      'live',                     TRUE,
      'live_why',                 'teams.name is read LIVE at every call site (123:1155 and 127:1413-1416 stamp it by joining teams at write time; standings and box scores join per read), so no propagation pass is written and none is needed',
      'frozen_receipts_for_this_team', CASE WHEN v_no_changes THEN 0 ELSE v_frozen END,
      'history_rewritten',        FALSE,
      'history_not_rewritten_why','already-written league_chat system posts and commissioner_actions.metadata.team_name KEEP THE OLD NAME on purpose — a receipt records what was true (§18, §12.12), and 123:339-410''s ENABLE ALWAYS trigger refuses an UPDATE of one in any case'),
    'reason',                 v_reason,
    'system_post',            v_message,             -- NULL on a no-op: no receipt if nothing is done
    'evaluated_at',           p_at);

  -- The idempotency ledger row is written for a NO-OP TOO (`123:1259-1266`'s
  -- posture): an action_id is consumed by its submit whether or not anything
  -- moved, so a retry replays instead of re-evaluating. This is the OPPOSITE
  -- rule from the audit row above, and deliberately so — §12.26: "an action_id
  -- is an idempotency key, not an audit record".
  INSERT INTO public.commish_team_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_rename_team_internal(UUID, UUID, TEXT, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- The client door. Transaction `now()`, never a caller-supplied instant
-- (D307(3)); SECURITY DEFINER; in-body auth is the internal's step (2).
-- tasks-M6A §5's printed argument order is kept exactly, which is why the two
-- required tail arguments carry DEFAULT NULL and are refused in-body instead.
CREATE OR REPLACE FUNCTION commish_rename_team(
  p_league_id UUID,
  p_team_id   UUID,
  p_name      TEXT DEFAULT NULL,
  p_reason    TEXT DEFAULT NULL,  -- REQUIRED in-body (22023) — §15.4:1690, "all require reason"
  p_action_id UUID DEFAULT NULL   -- REQUIRED in-body (22023)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.commish_rename_team_internal(
    p_league_id, p_team_id, p_name, p_action_id, now(), p_reason);
END;
$$;
-- `authenticated` keeps EXECUTE; the in-body commissioner gate is the
-- authorization (112:1237's posture).
REVOKE EXECUTE ON FUNCTION commish_rename_team(UUID, UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 4. rename_own_team — THE MANAGER'S OWN RENAME. ***THIS SECTION IS THE DROP
--    SEAM*** (see the banner for the exact list): delete §4 in full, pgTAP
--    076 §F + A10 + A14 + J6 (and the §A list edits), the two generated
--    `rename_own_team` entries in `src/types/database.ts`, and D359's
--    `rename_own_team` sentences, and nothing else moves.
--
--    IT RIDES NO AUTHORITY. No §15.4 line, no ruling — only F338's
--    measurement that the gap is total for a manager exactly as for a
--    commissioner. It is here because the alternative shape (a commissioner
--    who can name any franchise, a manager who can never name his own) is the
--    odder of the two, and because tasks-M6A §6 L.E1.7 item 2 says dropping it
--    "is a one-line answer at approval, not a Q".
--
--    IT IS NOT A §10.1 POWER, so it carries NONE of the commissioner
--    apparatus, and every omission is deliberate:
--      * NO reason — he is not exercising an override, and §15.4's "all
--        require reason" governs commissioner verbs;
--      * NO `commissioner_actions` row — an actor renaming his OWN franchise
--        is not an override of anyone, and a receipt for it would make the
--        audit log a change feed (which the activity feed already is);
--      * NO `league_chat` system post — §10.3's non-disableable post is for
--        OVERRIDE messages; auto-posting an ordinary manager action would be
--        new product, not the closing of a gap;
--      * NO replay ledger and NO action_id — setting a name to a value is
--        idempotent by construction, and the verb has no second effect to
--        dedupe (see §1's header).
--    All four are REPORTED in the returned document (`audited`,
--    `audited_why`, `system_post`, `system_post_why`) so the absence is
--    legible to a reader of the response and not only to a reader of this
--    comment (§4 rule 15).
--
--    A STANDALONE TEAM IS ROUTED, NOT SILENTLY HANDLED. `league_id IS NULL`
--    teams already have a working door — `095:636-639`'s UPDATE policy — so
--    this verb refuses them BY NAME and says which door to use, rather than
--    becoming a second writer for a surface that is not broken (§4 rule 13's
--    spirit: close the gap, do not widen anything else).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rename_own_team_internal(
  p_team_id UUID,
  p_name    TEXT,
  p_at      TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_team       public.teams;
  v_new_name   TEXT;
  v_old_name   TEXT;
  v_no_changes BOOLEAN;
  v_collides   JSONB;
  v_cnt        INTEGER;
BEGIN
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'rename_own_team: p_team_id is required'
      USING ERRCODE = '22023';
  END IF;

  -- (1) THE FRANCHISE, read first because the caller supplies no league id.
  --     A team that does not exist is answered with the SAME no-leak 42501 as
  --     one the caller does not manage.
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rename_own_team: not the manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- (2) STANDALONE TEAMS ARE ROUTED, not handled twice. Authorize as the
  --     owner first so a stranger still gets the no-leak 42501 and learns
  --     nothing about which teams exist.
  IF v_team.league_id IS NULL THEN
    IF v_team.owner_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'rename_own_team: not the manager of this team'
        USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION
      'rename_own_team: team % is a STANDALONE team, not a league franchise — rename it with a direct UPDATE, which its own RLS policy already allows (095:636-639, USING (auth.uid() = owner_id AND league_id IS NULL)). This verb exists because a LEAGUE franchise matches no UPDATE policy at all (F338)', p_team_id
      USING ERRCODE = 'P0001';
  END IF;

  -- (3) AUTH — the exact complement of `set_lineup_internal`'s own manager
  --     check (`114:240-243`, under the F35 doctrine comment at `114:237`:
  --     league_members' cache column, NEVER a stint). One no-leak 42501
  --     covering "no such team" and "not your seat" alike. Auth runs BEFORE
  --     the retired guard below, so a stranger probing a sealed franchise
  --     still learns nothing (pgTAP 076 F7).
  IF NOT EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.team_id = p_team_id AND m.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'rename_own_team: not the manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- (3b) THE SEALED FRANCHISE — the same refusal the commissioner arm makes
  --      at its step (6), because `spec:183` freezes the name FOR EVERYONE.
  --      Added in the R1029 fix round: the first cut omitted it on the claim
  --      that `120:565-570` made a seated retired franchise structurally
  --      unreachable — it does not (see THE MANAGER PATH in the banner:
  --      `077:428-437`'s fallback INSERT seats whatever team id it is handed,
  --      and only three OTHER verbs' guards keep a retired one out). One
  --      message shape for both doors, so a reader finds one truth.
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION
      'rename_own_team: franchise % is RETIRED — its name is FROZEN, because a sealed franchise is the record History Mode shows under its last manager (spec:183, §7.2.1(b)). This is a legality gate and it binds everyone, commissioner and manager alike. NO VERB UN-RETIRES A FRANCHISE TODAY (F354), so there is no "un-retire first" to offer; the seat now lives on the SUCCESSOR franchise (%)',
      p_team_id, COALESCE(v_team.successor_team_id::text, 'none recorded')
      USING ERRCODE = 'P0001';
  END IF;

  -- (4) THE NAME, through the SAME shared gate the commissioner's verb uses
  --     (§2) — one bound, one trim class, one message shape.
  v_new_name := public.team_rename_normalize_internal(p_name, 'rename_own_team');

  -- (5) Re-read under a row lock so the reported `previous_name` is the value
  --     this statement actually replaced. The LEAGUE row is locked first, in
  --     the house order (rule 8), so this verb and `commish_rename_team` —
  --     which can both target the same franchise — acquire their two locks in
  --     the same sequence and cannot deadlock against each other.
  PERFORM 1 FROM public.leagues l WHERE l.id = v_team.league_id FOR UPDATE;
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id FOR UPDATE;
  v_old_name := v_team.name;

  SELECT COALESCE(jsonb_agg(t.id ORDER BY t.name, t.id), '[]'::jsonb) INTO v_collides
  FROM public.teams t
  WHERE t.league_id = v_team.league_id AND t.id <> p_team_id
    AND lower(t.name) = lower(v_new_name);

  -- (6) THE NO-OP, detected by value over the one dimension this verb can
  --     change. The UPDATE sits inside the guard, so `updated_at` does not
  --     move either.
  v_no_changes := (v_old_name = v_new_name);
  IF NOT v_no_changes THEN
    UPDATE public.teams
    SET name = v_new_name,
        updated_at = p_at
    WHERE id = p_team_id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'rename_own_team: the rename touched % rows, expected exactly 1 (franchise %)', v_cnt, p_team_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'verb',               'rename_own_team',
    'team_id',            p_team_id,
    'league_id',          v_team.league_id,
    'name',               CASE WHEN v_no_changes THEN v_old_name ELSE v_new_name END,
    'previous_name',      v_old_name,
    'requested_name',     v_new_name,
    'name_collides_with', v_collides,
    'no_changes',         v_no_changes,
    'no_changes_why',     CASE WHEN v_no_changes THEN
                            'name_already_set — your franchise already carried this exact name (compared after the same trim), so nothing was written' END,
    -- Every piece of commissioner apparatus this verb deliberately does NOT
    -- carry, named in the response rather than only in a comment (§4 rule 15).
    'audited',            FALSE,
    'audited_why',        'a manager renaming his OWN franchise is not exercising a §10.1 commissioner power, so no commissioner_actions row is written, no reason is required and no action_id is consumed. The commissioner''s equivalent is commish_rename_team, which is audited, reason-required and replay-keyed',
    'system_post',        NULL,
    'system_post_why',    '§10.3''s non-disableable league_chat post is for OVERRIDE messages; an ordinary manager action does not write one',
    'evaluated_at',       p_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION rename_own_team_internal(UUID, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION rename_own_team(
  p_team_id UUID,
  p_name    TEXT DEFAULT NULL   -- REQUIRED in-body (22023)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.rename_own_team_internal(p_team_id, p_name, now());
END;
$$;
REVOKE EXECUTE ON FUNCTION rename_own_team(UUID, TEXT) FROM PUBLIC, anon;
