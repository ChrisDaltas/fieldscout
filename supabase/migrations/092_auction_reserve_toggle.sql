-- ============================================================================
-- 092 — `auction_min_bid` RETIRES; `auction_zero_dollar_nominations` ARRIVES
-- (task AP.1; spec v2.13 §7.3.8 (the removed row + the new toggle row + the
-- amended budget-floor bullet), §8.6.1–8.6.3, §8.6.8, E5/E68; D198; tasks-AP
-- §4 rules 1–11 = tasks-M3 §4's eight + the three AP rules). **Lane opener.**
-- Supersedes tasks-M3 **C38** as to its VEHICLE and promotes its substance.
--
-- CHRIS'S RULINGS, VERBATIM (2026-08-20 — they are the acceptance standard):
--   "you can't have a $0 minimum bid, those are two different settings"
--   "We can't have one function serving both. Nomination and Min Bid need to
--    be different."
--   "a nomination should allow any number that the player can afford"
--   "we only need a min bid of $1 more right now"
--   "with $0 nominations there is no $1 per slot reserve"
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 1 — THE THREE JOBS, AND WHICH TWO MOVE.
-- ---------------------------------------------------------------------------
-- `auction_min_bid` named one thing and did three (§7.3.8's removed row):
--
--   (A) THE PER-SLOT RESERVE in the §8.6.1 max-bid formula
--       `max_bid = remaining − (open_slots − 1) × N`, and the §8.6.8
--       solvency invariant `remaining >= open_slots × N` built on it.
--   (B) THE NOMINATION FLOOR — the least an opening bid may be, human
--       (`draft_nominate`), system (`draft_system_nominate_internal`,
--       `draft_tick` ARM 2.6(a)), commissioner (`draft_force_pick`), and the
--       price floor a re-entered pick must clear (`draft_reassign_pick` /
--       `draft_move_player`).
--   (C) THE BID INCREMENT — **it never did this one.** The raise floor has
--       always been `p_amount <= v_high_bid`, i.e. $1, at every value of the
--       field. A league that set "Minimum bid: $5" bought a $5 nomination
--       floor, $5 reserved per empty slot, and **$1 raises**. The control
--       lied about the job its name promised.
--
-- **(A) and (B) are the SAME derived number and now follow ONE toggle. (C)
-- is a fixed $1 and is not derived at all** — that is the distinction Chris
-- ruled ("Nomination and Min Bid need to be different"), and it is why this
-- migration adds a reserve/floor helper and touches no raise clause. The
-- increment stays the literal comparison in `draft_place_bid_internal`; grep
-- this file for `v_high_bid` and you will find it unchanged.
--
--   `auction_zero_dollar_nominations` OFF (the default, and today's
--   behaviour exactly): floor $1, reserve $1 — every stored number and every
--   golden is unchanged at the default, which is what makes this migration
--   mechanical rather than delicate.
--   ON: floor $0, reserve $0 ⇒ `max_bid = remaining` flat, and a nomination
--   may open at any amount the nominator can afford, including $0.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 2 — ONE AUTHORITY (D198(1); the §4.7 discipline, second
-- quantity).
-- ---------------------------------------------------------------------------
-- `draft_auction_reserve(p_config jsonb) → INTEGER` is the ONLY place the
-- number is derived. **A second COALESCE over the toggle anywhere in the
-- chain is a review finding.** Twelve function bodies read it; none keeps a
-- private default and none hardcodes `1`. The helper is deliberately NOT
-- STRICT: a NULL config must fall to the default reserve of 1, exactly as
-- `COALESCE((NULL::jsonb->>'x')::int, 1)` did (measured — see pgTAP 040 §A).
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 3 — THE SOLVENCY MACHINERY IS NOT TOUCHED, WEAKENED OR MADE
-- CONDITIONAL (D198(4); tasks-M3 §4 rule 7, never-weaken class).
-- ---------------------------------------------------------------------------
-- With the toggle ON the §8.6.8 invariant evaluates to `remaining >= 0`: it
-- STAYS CORRECT AND STOPS BINDING. Every arm survives — `draft_auction_solvent`'s
-- `bool_and` (still LOUD on an empty franchise set), E28's three arms in
-- `draft_adjust_budget`, `draft_start_internal`'s two start refusals,
-- `create_mock_draft`'s practice refusal, the award-time re-check in
-- `draft_tick`, E5 in `draft_place_bid_internal`, §8.6.7(a) in
-- `draft_nominate`. **Deleting any of them because "it can't fire with the
-- toggle on" is an automatic review finding.** pgTAP 040 §F pins each arm
-- PRESENT-AND-REFUSING with the toggle OFF and PRESENT-AND-VACUOUS with it ON.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 4 — THE DATA MIGRATION, AND WHY SKIPPING IT WOULD BREAK EVERY
-- LEAGUE THAT STORED THE KEY (D198(2); §7.3.8's removed row).
-- ---------------------------------------------------------------------------
-- `league-settings.ts`'s draft config is a `z.strictObject` and
-- `mergeSettings` parses the stored blob on EVERY read, so a leftover
-- `settings.draft.auction_min_bid` is a hard parse failure, not a harmless
-- extra. Section 14 below rewrites BOTH stores — `leagues.settings->'draft'`
-- and every `drafts.config` (the draft row snapshots the catalog at create) —
-- dropping the key and writing the toggle: stored `0` ⇒ **true**, stored
-- `>= 1` ⇒ **false**, exactly as §7.3.8's removed row prints.
-- It COUNTS and `RAISE NOTICE`s what it changed, and reports the `>= 2`
-- cohort SEPARATELY BY ID — those leagues are the only ones whose MEANING
-- changes (a $2–$5 reserve becomes $1), and a silent conversion of somebody's
-- settings is precisely the failure CLAUDE.md's "never let *nothing happened*
-- mean *it worked*" rule is about. It is idempotent: a second run finds
-- nothing and SAYS SO rather than printing a reassuring blank.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 5 — WHAT THIS FILE CONTAINS.
-- ---------------------------------------------------------------------------
--   NEW:
--     `draft_auction_reserve(jsonb) → INTEGER` — IMMUTABLE (not STRICT),
--     `SET search_path = ''`, REVOKEd from PUBLIC/anon/authenticated per
--     tasks-M1 §4.1. Pure over its argument; every consumer is a server
--     path that already holds the config.
--   REPLACED (D137 head rule — each body EXTRACTED from the current FILE
--   TEXT of the newest migration that defines it, never `pg_get_functiondef`
--   and never the migration that introduced it; the head set was resolved at
--   task time with `grep -lE '^CREATE (OR REPLACE )?FUNCTION +(public\.)?<name>\('
--   supabase/migrations/*.sql` and every range below was re-checked to land
--   on its own CREATE OR REPLACE line):
--     * `draft_team_budget`             <- 084:266–353   (its only definition)
--     * `draft_auction_solvent`         <- 084:361–406   (its only definition)
--     * `draft_start_internal`          <- 084:486–752   (084 replaced 066's)
--     * `draft_adjust_budget`           <- 087:650–818   (its only definition)
--     * `draft_force_pick`              <- 087:2042–2293 (087 replaced 069's)
--     * `create_mock_draft`             <- 089:759–1052  (089 replaced 071's)
--     * `draft_reassign_pick`           <- 090:564–839   (069 -> 087 -> 090)
--     * `draft_move_player`             <- 090:849–1085  (069 -> 087 -> 090)
--     * `draft_place_bid_internal`      <- 091:582–738   (089 -> 091)
--     * `draft_system_nominate_internal`<- 091:750–850   (089 -> 091)
--     * `draft_nominate`                <- 091:863–1111  (085 -> 089 -> 091)
--     * `draft_tick`                    <- 091:1128–2332 (068 -> 086 -> 087
--       -> 089 -> 091; **090 re-emits none of these five** — confirmed by
--       grep at task time, the same check 091's banner records)
--   Per-function `diff -u` hunk counts (the L.C1.5 recipe — body extracted
--   CREATE -> `$$;`, edited, diffed at standard context, `@@` counted), and
--   RE-DERIVED after every fix cycle in this session:
--     draft_team_budget               3 hunks (+8/-4)    declare - the read - the formula + its comment
--     draft_auction_solvent           2 hunks (+8/-3)    declare - the read + the never-weaken note
--     draft_start_internal            4 hunks (+12/-9)   declare - a stale example in a comment - both start refusals
--     draft_adjust_budget             3 hunks (+7/-6)    declare - the read - E28 arm 2
--     draft_force_pick                5 hunks (+16/-8)   declare - the read + the floor note - the refusal - the opening row - the chat line
--     create_mock_draft               3 hunks (+6/-5)    declare - a comment - the practice refusal
--     draft_reassign_pick             2 hunks (+13/-8)   declare - the price floor + the max-bid message
--     draft_move_player               2 hunks (+13/-8)   the same two, mirrored
--     draft_place_bid_internal        4 hunks (+10/-6)   declare - the read - the increment comment - E5
--     draft_system_nominate_internal  5 hunks (+13/-9)   declare - the read - a comment - the refusal - the two writes
--     draft_nominate                  3 hunks (+14/-7)   declare - the floor read + refusal - the max-bid message
--     draft_tick                      7 hunks (+11/-8)   declare - four comments - the read - the award refusal
--   TOTAL: 12 functions, 43 hunks, +131/-81.
--   Everything outside those hunks is byte-identical to the head text.
--   NOT replaced, and each for a reason: `draft_place_bid` (089's head body
--   delegates to `draft_place_bid_internal` and reads no reserve of its own —
--   085:646's read died with 089), `draft_nomination_order_internal`,
--   `draft_set_order`, `draft_undo`, `draft_set_clock`, `draft_start`,
--   `draft_complete_internal`, `draft_autopick_resolve`, the 088 broadcast
--   surface, and the three 089/091 mock-CPU helpers (none reads the field).
--   No signature changes ⇒ every replacement is `CREATE OR REPLACE`.
--
-- Grants doctrine (D18->D23 / tasks-M1 §4.1): no per-object GRANTs. Every
-- replaced RPC keeps its posture (SECURITY DEFINER + `SET search_path = ''` +
-- in-body auth + REVOKE FROM PUBLIC, anon — restated after each CREATE OR
-- REPLACE, belt-and-braces, 089/090/091's own form; CREATE OR REPLACE
-- preserves ACLs, so the restatement is documentation, not a fix). The new
-- helper is REVOKEd from every client role: it is a server derivation, and
-- the display-only TS mirror (`auction-budget.ts`) computes its own copy from
-- the config the room already holds, pinned to this SQL by the D90 fixture.
--
-- SQLSTATE convention (062/063 verbatim): 42501 auth + no-leak · P0002 -> 404
-- · P0001 friendly refusal · 22023 argument shape. Unchanged everywhere; the
-- two internal invariant failures (`draft_tick`'s award refusal,
-- `draft_system_nominate_internal`'s two arms) keep the default SQLSTATE.
--
-- REFUSAL COPY — the one behavioural change outside the arithmetic. Every
-- message that said "minimum bid" now says what it means: **"per-slot
-- reserve"** where the number is the §8.6.1 reserve term, **"nomination
-- floor"** where it is the §8.6.2 floor, and **"price floor"** for the
-- re-entered price of a moved pick. The two start refusals and
-- `create_mock_draft`'s practice refusal also stop sending a commissioner to
-- a knob that no longer exists ("lower the minimum bid" -> "allow $0
-- nominations"). D198(5) requires this; the pins that assert these strings
-- move with them (pgTAP 033/034/035/036/038/039 and the vitest mirrors).
--
-- Migration checklist (delivery plan §8.1 / tasks-M3 §4.4): NO DDL — no
-- table, no column, no policy, no index, no signature change; ONE new
-- function, TWELVE CREATE OR REPLACEs, and ONE data migration over two
-- existing jsonb stores · rollback = re-apply the twelve head bodies (the
-- extracted originals are the rollback text), drop `draft_auction_reserve`,
-- and reverse section 14 (`auction_zero_dollar_nominations` true -> 0, false
-- -> 1 — note the reverse cannot restore a stored 2–5, which is why section
-- 14 PRINTS that cohort by id before it converts them) · staging rehearsal:
-- **R6 waiver** — no staging clone exists (environments are local + prod
-- only); the recorded rehearsal is the fresh local `npx supabase db reset`
-- replay of the full 001–092 chain in this PR, plus pgTAP 033–040 ·
-- **D38 waiver does NOT apply here**: unlike 091 this migration DOES carry a
-- data backfill, so it is stated rather than waived — section 14, counted,
-- NOTICEd, idempotent, and covered by pgTAP 040 §G · F12 note: prod's
-- migration history still ends pre-league-schema, so no production league can
-- carry the retired key yet; this lands with the next normal push ·
-- typegen: one new function changes the PostgREST-visible surface ⇒
-- `src/types/database.ts` RE-GENERATED (`--local`) with the hand-written
-- alias block preserved and re-appended BYTE-IDENTICAL and the diff verified
-- additive-only (§4.4).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. draft_auction_reserve — THE ONE authority for the §8.6.1 per-slot
--    reserve and the §8.6.2 nomination floor (banner items 1–2; D198(1)).
--
--    NOT the bid increment. Raises are `> high_bid` — a fixed $1 in BOTH
--    toggle columns (§8.6.3) — and no caller of this function is a raise
--    clause. That separation is Chris's ruling of 2026-08-20 and the reason
--    the retired field is retired.
--
--    NOT STRICT on purpose: `draft_team_budget` and friends may hold a NULL
--    config on a malformed row, and the retired code fell to 1 there
--    (`COALESCE((NULL)::int, 1)`). A STRICT helper would return NULL and turn
--    every downstream max_bid into a silent unknown — the exact
--    "nothing happened means it worked" shape CLAUDE.md forbids. Pinned in
--    pgTAP 040 §A.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_auction_reserve(p_config JSONB)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
           WHEN COALESCE((p_config->>'auction_zero_dollar_nominations')::boolean, FALSE)
             THEN 0
           ELSE 1
         END;
$$;

REVOKE EXECUTE ON FUNCTION draft_auction_reserve(JSONB)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. draft_team_budget — the ONE budget derivation (D127; §8.6.1).
--    REPLACED FROM 084:266-353 (D137 head rule; its only definition). THREE
--    hunks: the declare, the read, and the max-bid formula with its comment.
--    The formula is UNCHANGED at the default (reserve 1); with the toggle ON
--    the reserve term is 0 and max_bid equals remaining flat (§8.6.1/E68).
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
  IF NOT EXISTS (
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

REVOKE EXECUTE ON FUNCTION draft_team_budget(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. draft_auction_solvent — §8.6.8, the never-weaken invariant.
--    REPLACED FROM 084:361-406 (D137 head rule; its only definition). TWO hunks:
--    the declare and the read. The `bool_and` and its LOUD empty-set guard are
--    byte-identical; with the toggle ON the predicate degenerates to
--    `remaining >= 0` and stops binding (banner item 3 / D198(4)).
-- ---------------------------------------------------------------------------
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

  SELECT bool_and(b.remaining >= b.open_slots * v_reserve)
    INTO v_ok
  FROM public.teams t
  CROSS JOIN LATERAL public.draft_team_budget(p_draft_id, t.id) b
  WHERE t.league_id = v_draft.league_id
    AND t.status <> 'retired';                   -- the capacity/order team set

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

REVOKE EXECUTE ON FUNCTION draft_auction_solvent(UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. draft_start_internal — §8.6.8's start-time backstop.
--    REPLACED FROM 084:486-752 (D137 head rule; 084 replaced 066:245-...). FOUR
--    hunks: the declare, a stale worked example inside a comment, and BOTH
--    start refusals (arithmetic + copy). The two-message structure of R318 is
--    preserved exactly — the settings arm and the per-franchise arm still say
--    two different things for two different causes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_start_internal(
  p_league_id UUID,
  p_require_commish BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league       public.leagues;
  v_draft        public.drafts;
  v_config       JSONB;
  v_order        JSONB;
  v_active_count INTEGER;
  v_total_rounds INTEGER;
  v_timer        INTEGER;
  v_first        UUID;
  -- 084 (L.C1.2) additions:
  v_type         TEXT;
  v_nom_order    JSONB;
  v_deadline     TIMESTAMPTZ;
  v_budget       INTEGER;
  v_reserve      INTEGER;
  v_bad_team     TEXT;
  v_bad_remaining INTEGER;
  v_bad_open     INTEGER;
BEGIN
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_start: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Re-gate under the league lock (R93); skipped for the system caller
  -- (068's tick — see draft_create_internal's note).
  IF p_require_commish AND NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'draft_start: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- PLAIN read for the idempotent arm — deliberately NOT locked (R122):
  -- taking the drafts-row lock here, while holding the leagues lock, races
  -- an in-flight draft_make_pick into a deadlock cycle — the pick holds the
  -- drafts row (its step 1) and its draft_picks INSERT takes an RI FOR KEY
  -- SHARE on the leagues row (the league_id FK, 065:152), which conflicts
  -- with our leagues lock. Live-proven 40P01 (the batch-2 R122 probe). The
  -- plain read is safe for the no-op arm: creates and starts serialize on
  -- the league lock held above, and the already-started shape's status
  -- truth is the LEAGUE row ('drafting'), read under its own lock.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.league_id = p_league_id
    AND d.is_mock = FALSE
    AND d.status IN ('scheduled', 'live', 'paused');

  -- Idempotent re-start (the D63 same-status class): a double-clicked
  -- Start must not error — even while a pick is mid-flight holding the
  -- drafts-row lock (R122: this arm returns without ever touching it). A
  -- started draft and its league move in ONE txn, so live/paused +
  -- 'drafting' is the only reachable already-started shape.
  IF FOUND AND v_draft.status IN ('live', 'paused') AND v_league.status = 'drafting' THEN
    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'started', FALSE);
  END IF;

  IF v_league.status <> 'scheduled' THEN
    RAISE EXCEPTION
      'draft_start: league % is in % — schedule the draft first (League settings → Draft setup), then start it',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  -- CREATE-IF-ABSENT (the D94 no-dead-end principle on the manual path): a
  -- league scheduled purely through the settings surface has no drafts row;
  -- the idempotent create-internal supplies it. Same txn — the league lock
  -- is already held and simply re-entered. p_require_commish FALSE: this
  -- caller's authorization is already established (wrapper fast-fail + the
  -- re-gate above when required).
  IF v_draft.id IS NULL THEN
    PERFORM public.draft_create_internal(p_league_id, FALSE);
  END IF;

  -- NOW lock the draft row — BELOW the 'scheduled' gate (R122): with the
  -- league locked at 'scheduled', no pick's INSERT can be in flight on this
  -- draft (picks require 'live', and start moves draft + league in one txn
  -- under the league lock), so this lock can never complete the
  -- FK-KEY-SHARE cycle described above.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.league_id = p_league_id
    AND d.is_mock = FALSE
    AND d.status IN ('scheduled', 'live', 'paused')
  FOR UPDATE;

  -- Defensive: a live/paused draft under a non-'drafting' league is
  -- unreachable (start moves both in one txn) — refuse LOUDLY rather than
  -- silently resetting a live board to pick 1. (Also catches the
  -- can't-happen empty re-read after create-if-absent.)
  IF v_draft.id IS NULL OR v_draft.status <> 'scheduled' THEN
    RAISE EXCEPTION
      'draft_start: draft % is % while league % is scheduled — inconsistent state; contact support',
      COALESCE(v_draft.id::text, '(missing)'), COALESCE(v_draft.status, '(missing)'), p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- D95: RE-HYDRATE from live settings — the fidelity moment.
  v_config := COALESCE(v_league.settings->'draft', '{}'::jsonb);
  v_type   := COALESCE(v_config->>'draft_type', 'snake');

  -- 084 (L.C1.2): the M2 seam refusal that stood here (066:640–644 —
  -- "the auction engine lands in M3") is GONE; §8.6's engine begins with
  -- this migration. The gates below are shared by both draft types and are
  -- unchanged from 066 — an auction is capacity-gated, snapshot-gated and
  -- rounds-gated exactly like a snake draft.

  -- Capacity (§7.2/D96): every franchise must exist before the draft.
  -- Orphaned seats count (they draft on autopilot — E48); retired do not.
  -- The audited "draft short" override is M6's (F45).
  SELECT count(*) INTO v_active_count
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.status <> 'retired';
  IF v_active_count <> v_league.team_count THEN
    RAISE EXCEPTION
      'draft_start: league % has % of % franchises seated — every seat must exist before the draft starts; add placeholder seats for the empty slots (League home → Invite) or invite managers (§7.2/D96)',
      p_league_id, v_active_count, v_league.team_count
      USING ERRCODE = 'P0001';
  END IF;

  -- Order resolution (D101/D105/R123/R126) via the ONE implementation
  -- (draft_resolve_order_internal — extracted at L.B1.6 amendment (e),
  -- logic verbatim; 071's create_mock_draft is the second consumer):
  -- candidate = the draft row's stored order (a pre-start randomize/order
  -- edit — it wins so the order the lobby displayed is the order that
  -- drafts), config fallback manual/custom-only, seed = the draft row's
  -- own id, label 'draft_start' (every pinned message unchanged).
  -- An auction resolves it too: `same_as_draft_order` feeds from it, and
  -- the commissioner's pre-draft order surface is one surface (§8.3).
  v_order := public.draft_resolve_order_internal(
    p_league_id,
    v_league.team_count,
    COALESCE(v_config->>'draft_order_mode', 'random'),
    v_draft.draft_order,
    v_config->'draft_order',
    v_draft.id,
    'draft_start');

  -- 084: nomination order (§8.3/§7.3.8) — auction only; snake/linear leave
  -- the column NULL.
  IF v_type = 'auction' THEN
    v_nom_order := public.draft_nomination_order_internal(
      p_league_id,
      v_league.team_count,
      COALESCE(v_config->>'nomination_order_mode', 'same_as_draft_order'),
      v_draft.nomination_order,
      v_order,
      v_draft.id,
      'draft_start');
  END IF;

  -- D91: rounds = starters + bench (IR excluded). For an auction this is
  -- the per-team roster CAPACITY the open-slots math counts down (D126).
  v_total_rounds := public.draft_rounds_from_roster(v_league.roster_settings);
  IF v_total_rounds IS NULL OR v_total_rounds < 1 THEN
    RAISE EXCEPTION
      'draft_start: league % roster settings produce no draftable rounds (rounds = starters + bench, D91) — fix the roster in League settings',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Clock + first seat, per draft type.
  IF v_type = 'auction' THEN
    -- §7.3.8's own clocks. An untimed pick_timer_seconds = 0 (§8.2's soft
    -- timer) does NOT null this one — see the banner, item 3(c).
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

  -- Snapshot BEFORE the transition (D43/D64(2)): we are in 'scheduled' —
  -- exactly 059's sanctioned window. A league that cannot snapshot (no
  -- scoring reference) fails LOUDLY here and nothing below runs; the D43
  -- trigger on the leagues UPDATE is the backstop either way. The INTERNAL
  -- (059, amended alongside 068): the wrapper's commissioner gate would
  -- refuse the cron auto-start caller (no JWT) — this caller's
  -- authorization is already established (see the re-gate above).
  PERFORM public.snapshot_league_scoring_internal(p_league_id);

  UPDATE public.drafts SET
    status               = 'live',
    draft_type           = v_type,
    config               = v_config,
    draft_order          = v_order,
    nomination_order     = v_nom_order,  -- auction only; NULL for snake/linear
    current_nomination   = NULL,         -- D126: NULL ⇒ NOMINATING phase
    total_rounds         = v_total_rounds,
    current_round        = 1,
    current_pick_number  = 1,            -- doubles as nomination seq 1 (D126)
    on_clock_team_id     = v_first,
    current_deadline     = v_deadline,
    paused_at            = NULL,
    deadline_remaining_ms = NULL,
    started_at           = now(),
    completed_at         = NULL,
    updated_at           = now()
  WHERE id = v_draft.id
  RETURNING * INTO v_draft;

  -- 084: the §8.6.8 start-time backstop (banner item 4) — read through the
  -- ONE derivation family, on the LIVE row, before the league transitions.
  -- TWO messages, because there are two causes and one of them is not the
  -- settings knobs (R318). The derivation reads budget_adjustments (line
  -- 263), so a per-team §8.7 delta can make a settings-LEGAL league
  -- insolvent — and printing "a $200 budget cannot fill 15 roster spots at
  -- a $1 per-slot reserve" about a league whose budget clears that floor by
  -- $185 is arithmetically false and sends the commissioner to the wrong
  -- knob. The unit is named too: these are D91 DRAFTABLE slots (starters +
  -- bench), which is not the settings validator's roster size (it counts
  -- IR as well — league-settings.ts:539), so the two layers print two
  -- numbers for one league unless each says which it means.
  IF v_type = 'auction' AND NOT public.draft_auction_solvent(v_draft.id) THEN
    v_budget  := COALESCE((v_config->>'auction_budget')::int, 200);
    -- 092/AP.1: the reserve, through the ONE authority (D198(1)). With
    -- auction_zero_dollar_nominations ON this arm reads 0 and can no longer
    -- fire — correct, and NOT a reason to delete it (§8.6.8/D198(4)).
    v_reserve := public.draft_auction_reserve(v_config);
    IF v_budget < v_total_rounds * v_reserve THEN
      RAISE EXCEPTION
        'draft_start: league % cannot start an auction — a $% budget cannot fill % draftable roster spots at a $% per-slot reserve (§8.6.8 solvency); raise the auction budget, or allow $0 nominations in League settings → Draft setup',
        p_league_id, v_budget, v_total_rounds, v_reserve
        USING ERRCODE = 'P0001';
    ELSE
      -- The settings floor HOLDS, so the shortfall is one franchise's own
      -- (a §8.7 budget adjustment; priced picks cannot exist on a
      -- 'scheduled' draft). Name the seat and its real numbers.
      SELECT t.name, b.remaining, b.open_slots
        INTO v_bad_team, v_bad_remaining, v_bad_open
      FROM public.teams t
      CROSS JOIN LATERAL public.draft_team_budget(v_draft.id, t.id) b
      WHERE t.league_id = p_league_id
        AND t.status <> 'retired'
        AND b.remaining < b.open_slots * v_reserve
      ORDER BY t.name, t.id
      LIMIT 1;
      RAISE EXCEPTION
        'draft_start: league % cannot start an auction — % has $% for % draftable roster spots at a $% per-slot reserve (§8.6.8 solvency). The league''s $% auction budget clears that floor, so the shortfall is this franchise''s own: clear its commissioner budget adjustment (§8.7), or allow $0 nominations in League settings → Draft setup',
        p_league_id, v_bad_team, v_bad_remaining, v_bad_open, v_reserve, v_budget
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- draft_start's OWN transition under the D43 guard (059's banner: M2
  -- removes the M1 refusal only via this path — set_league_status is NOT
  -- widened).
  UPDATE public.leagues
  SET status = 'drafting', updated_at = now()
  WHERE id = p_league_id;

  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'started', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_start_internal(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. draft_adjust_budget — §8.7's budget edit; E28's three arms.
--    REPLACED FROM 087:650-818 (D137 head rule; its only definition). THREE
--    hunks: the declare, the read, and E28 ARM 2. **Arms 1 and 3 are
--    untouched** and neither is deleted, narrowed or made conditional on the
--    toggle (banner item 3).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_adjust_budget(
  p_draft_id UUID,
  p_team_id  UUID,
  p_delta    INTEGER,
  p_reason   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft      public.drafts;
  v_team_name  TEXT;
  v_reserve    INTEGER;
  v_before     INTEGER;
  v_after      INTEGER;
  v_remaining  INTEGER;
  v_open       INTEGER;
  v_max_bid    INTEGER;
  v_committed  INTEGER;
BEGIN
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'draft_adjust_budget: team_id is required'
      USING ERRCODE = '22023';
  END IF;
  -- A zero delta is refused rather than treated as a D63-class no-op: the
  -- D63 convention is for a REPEATED command (double-tapped Pause), and a
  -- commissioner who typed 0 made a mistake we should not post about.
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION
      'draft_adjust_budget: delta must be a non-zero integer — say how many dollars to add or remove'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_adjust_budget: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_adjust_budget: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.draft_type <> 'auction' THEN
    RAISE EXCEPTION
      'draft_adjust_budget: this is a % draft — budgets apply to auctions only (§8.6)',
      v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION
      'draft_adjust_budget: the draft is complete — post-completion corrections arrive with the commissioner console (M6)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'draft_adjust_budget: the draft has not started yet — set the budget in League settings'
      USING ERRCODE = 'P0001';
  END IF;
  -- NOT pause-gated: D141's ruling names undo, Manual Edit Mode, current-
  -- nomination edits and timer edits. Budget adjust is deliberately absent
  -- from that list (banner item 4), and E28's arms below are what make it
  -- safe to run live.

  SELECT t.name INTO v_team_name
  FROM public.teams t
  WHERE t.id = p_team_id AND t.league_id = v_draft.league_id
    AND t.status <> 'retired';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_adjust_budget: team % is not an active franchise of this league', p_team_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 092/AP.1: the reserve, through the ONE authority (D198(1)).
  v_reserve := public.draft_auction_reserve(v_draft.config);
  v_before  := COALESCE((v_draft.budget_adjustments->>p_team_id::text)::int, 0);
  v_after   := v_before + p_delta;   -- CUMULATIVE: successive corrections compose.

  -- (3) WRITE FIRST, THEN RE-DERIVE. The ONE family (D127/§4.7) reads
  -- budget_adjustments, so the only way to validate the POST-edit world
  -- without re-implementing the arithmetic is to make the edit and ask.
  -- Every refusal below RAISEs, which rolls this write back inside the
  -- caller's transaction — the 084 start-backstop pattern (assert AFTER the
  -- transition write), and the reason no compensating math exists here.
  UPDATE public.drafts SET
    budget_adjustments = jsonb_set(budget_adjustments,
                                   ARRAY[p_team_id::text], to_jsonb(v_after), TRUE),
    updated_at         = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  SELECT b.remaining, b.open_slots, b.max_bid, b.committed
    INTO v_remaining, v_open, v_max_bid, v_committed
  FROM public.draft_team_budget(p_draft_id, p_team_id) b;

  -- E28 ARM 1 — below committed spend. Strictly a special case of arm 2, and
  -- kept separate ON PURPOSE: it is the arm with a different remedy, and a
  -- commissioner told "you are $12 under the solvency floor" when the real
  -- problem is that they cut a team below what it has already SPENT will fix
  -- the wrong thing.
  IF v_remaining < 0 THEN
    RAISE EXCEPTION
      'draft_adjust_budget: that leaves % $% short of the $% already spent — reverse a won bid instead, or make the adjustment smaller (E28)',
      v_team_name, -v_remaining, v_committed
      USING ERRCODE = 'P0001';
  END IF;

  -- E28 ARM 2 — below the §8.6.8 solvency floor. open_slots * reserve is the
  -- money the team must still be able to spend to finish a legal roster.
  IF v_remaining < v_open * v_reserve THEN
    RAISE EXCEPTION
      'draft_adjust_budget: that leaves % with $% for % open roster spots at a $% per-slot reserve — §8.6.8 needs at least $%; reverse a won bid to free a spot, or make the adjustment smaller (E28)',
      v_team_name, v_remaining, v_open, v_reserve, v_open * v_reserve
      USING ERRCODE = 'P0001';
  END IF;

  -- E28 ARM 3 (D131(4)) — insolvent against the LIVE high bid. A bid holds no
  -- money (D131(2)); the AWARD spends it. So an edit that is fine right now
  -- can still make the close unaffordable, and the close is a tick away.
  -- Same algebra as the award: price <= max_bid.
  --
  -- 087/R367: the comparison MOVED into draft_auction_high_bid_gate_internal
  -- (section 3b) because the two priced Manual Edit paths need the identical
  -- arm and had shipped without it. The rendered message is BYTE-IDENTICAL to
  -- the inline version this replaced — 036 §F's exact-message pins are
  -- unchanged, which is the check that the move was lossless.
  PERFORM public.draft_auction_high_bid_gate_internal(
    v_draft, p_team_id, 'draft_adjust_budget',
    'Void the nomination (pause, then Edit current nomination) or reverse a won bid first');

  -- Cross-team backstop (§4 rule 7): the arms above check the EDITED team;
  -- this proves the edit did not disturb anyone else's floor. It cannot fire
  -- today — budget_adjustments is per team and no other team's derivation
  -- reads this key — so it is a guard against a future edit to the family,
  -- not a live branch. Stated plainly rather than left to look like coverage.
  IF NOT public.draft_auction_solvent(p_draft_id) THEN
    RAISE EXCEPTION
      'draft_adjust_budget: that adjustment left auction % insolvent (§8.6.8) — refusing',
      p_draft_id
      USING ERRCODE = 'P0001';
  END IF;

  -- D97: the in-txn post, with the before/after numbers the task asks for.
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          'Budget adjusted by ' || public.draft_actor_name() || ': '
          || v_team_name || ' '
          || CASE WHEN p_delta > 0 THEN '+$' || p_delta ELSE '-$' || (-p_delta) END
          || ' (total adjustment '
          || CASE WHEN v_after >= 0 THEN '+$' || v_after ELSE '-$' || (-v_after) END
          || '; now $' || v_remaining || ' remaining for ' || v_open
          || ' open spots, max bid $' || v_max_bid || ').',
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object(
    'draft', to_jsonb(v_draft),
    'team_id', p_team_id,
    'adjustment_before', v_before,
    'adjustment_after', v_after,
    'remaining', v_remaining,
    'open_slots', v_open,
    'max_bid', v_max_bid);
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_adjust_budget(UUID, UUID, INTEGER, TEXT)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 6. draft_force_pick — the commissioner force-nomination (§8.7/§8.6.7(a)).
--    REPLACED FROM 087:2042-2293 (D137 head rule; 087 replaced 069's). FIVE
--    hunks: the declare, the read + the floor note, the affordability refusal,
--    the opening `draft_bids` row, and the system chat line — the last two
--    because a forced nomination OPENS AT the floor, so with the toggle ON it
--    opens at $0 and the chat line must say $0 (§8.6.2/E68).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_force_pick(
  p_draft_id UUID,
  p_player_id TEXT,
  p_action_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft       public.drafts;
  v_pick        public.draft_picks;
  v_player_name TEXT;
  v_team_name   TEXT;
  v_result      JSONB;
  v_bid         public.draft_bids;
  v_action      UUID;
  v_nom_floor   INTEGER;
  v_bid_seconds INTEGER;
  v_remaining   INTEGER;
  v_open        INTEGER;
  v_max_bid     INTEGER;
  v_live_name   TEXT;
BEGIN
  IF p_player_id IS NULL OR btrim(p_player_id) = '' THEN
    RAISE EXCEPTION 'draft_force_pick: player_id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_force_pick: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  -- MOCK GUARD (L.B1.6/071 — amended in place, F12; D103(2)/§8.8): §8.7
  -- is the REAL-draft commissioner surface. On a mock this control is
  -- interference with a member's solo practice (and for draft_reset an
  -- outright zero-side-effect breach — it writes leagues.status and the
  -- stored schedule instant). The launcher's controls are
  -- pause/resume/delete (069 mock arms + 071). Pinned in pgTAP 025.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_force_pick: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  -- =====================================================================
  -- 087/L.C1.5 — THE AUCTION ARM (R301): §8.7's "Pick for a manager" on an
  -- auction is a FORCE-NOMINATION, and only in the NOMINATING phase.
  -- THERE IS DELIBERATELY NO COMMISSIONER FORCE-BID: absent managers do not
  -- bid (§8.6.5/OQ 10), and the close needs no force because the clock
  -- awards the standing high bidder on its own (§8.6.7(b)). Recorded, not
  -- omitted.
  -- NOT pause-gated — D141's list does not name force pick, and this is the
  -- control a commissioner reaches for precisely while the clock runs.
  -- =====================================================================
  IF v_draft.draft_type = 'auction' THEN
    -- E2 replay, nomination edition: the opening bid IS a draft_bids row
    -- (D157(1)), so the replay lookup is the same select-then-insert shape
    -- 085 uses — never an ON CONFLICT arbiter against the PARTIAL
    -- uniq_draft_bid_action (42P10 — R310/D144(7)).
    IF p_action_id IS NOT NULL THEN
      SELECT b.* INTO v_bid
      FROM public.draft_bids b
      WHERE b.draft_id = p_draft_id AND b.action_id = p_action_id;
      IF FOUND THEN
        RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'bid', to_jsonb(v_bid));
      END IF;
    END IF;

    IF v_draft.status = 'paused' THEN
      RAISE EXCEPTION
        'draft_force_pick: the draft is paused — resume it first, then nominate for the team on the clock'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_draft.status <> 'live' THEN
      RAISE EXCEPTION 'draft_force_pick: the draft is % — there is no nomination on the clock', v_draft.status
        USING ERRCODE = 'P0001';
    END IF;

    -- PHASE (D126). A live nomination means bidding is open, and there is no
    -- force-bid to offer.
    IF v_draft.current_nomination IS NOT NULL THEN
      SELECT pl.full_name INTO v_live_name
      FROM public.players pl
      WHERE pl.id = v_draft.current_nomination->>'player_id';
      RAISE EXCEPTION
        'draft_force_pick: bidding is already open on % at $% — a commissioner cannot bid for a manager (§8.6.5); the clock awards the high bidder when it expires',
        COALESCE(v_live_name, 'the nominated player'),
        COALESCE(v_draft.current_nomination->>'high_bid', '0')
        USING ERRCODE = 'P0001';
    END IF;

    SELECT pl.full_name INTO v_player_name
    FROM public.players pl WHERE pl.id = p_player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'draft_force_pick: player % not found', p_player_id
        USING ERRCODE = 'P0002';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.draft_picks p
      WHERE p.draft_id = p_draft_id AND p.player_id = p_player_id
        AND p.is_undone = FALSE
    ) THEN
      RAISE EXCEPTION
        'draft_force_pick: % just went off the board — nominate another player',
        v_player_name
        USING ERRCODE = 'P0001';
    END IF;

    -- D129(1): validated EXACTLY as the on-clock team's own nomination would
    -- be, through the ONE family (§4.7) — capacity first, then the
    -- §8.6.7(a) affordability rule that makes a no-raise award legal.
    SELECT b.remaining, b.open_slots, b.max_bid
      INTO v_remaining, v_open, v_max_bid
    FROM public.draft_team_budget(p_draft_id, v_draft.on_clock_team_id) b;

    SELECT t.name INTO v_team_name
    FROM public.teams t WHERE t.id = v_draft.on_clock_team_id;

    IF v_open < 1 THEN
      RAISE EXCEPTION
        'draft_force_pick: %''s roster is complete — complete rosters are skipped in the nomination rotation (§8.6.7(c)/E27)',
        COALESCE(v_team_name, 'that team')
        USING ERRCODE = 'P0001';
    END IF;

    -- 092/AP.1: the NOMINATION FLOOR. It is the SAME derived number as the
    -- §8.6.1 per-slot reserve (§7.3.8's toggle sets both: $1 OFF, $0 ON), so
    -- it is read through the ONE authority — D198(1). It is NOT the bid
    -- increment: raises are `> high_bid`, i.e. a fixed $1 in BOTH columns
    -- (§8.6.3), which is the distinction the retired 0-5 min-bid field
    -- collapsed and Chris ruled apart ("Nomination and Min Bid need to be
    -- different", 2026-08-20). The retired key is named nowhere in any
    -- shipped body ON PURPOSE — pgTAP 040 §A pins `prosrc` clean of it.
    v_nom_floor   := public.draft_auction_reserve(v_draft.config);
    v_bid_seconds := COALESCE((v_draft.config->>'auction_bid_seconds')::int, 20);

    IF v_nom_floor > v_max_bid THEN
      RAISE EXCEPTION
        'draft_force_pick: % cannot afford the $% nomination floor — max bid is $% ($% for % open spots) (§8.6.7(a))',
        COALESCE(v_team_name, 'that team'), v_nom_floor, v_max_bid, v_remaining, v_open
        USING ERRCODE = 'P0001';
    END IF;

    -- ATTRIBUTION (D130 "per actor", read off the bid row at the award —
    -- D160(3)): a commissioner force-nomination is a HUMAN act, so the
    -- opening row must carry a non-NULL action_id or an unraised close would
    -- attribute it as an autopick. When the caller supplies none we MINT one
    -- rather than write NULL — the honest answer, at the cost of the E2
    -- replay this call never had anyway (069's snake arm behaves the same
    -- with a NULL action_id).
    v_action := COALESCE(p_action_id, gen_random_uuid());

    -- F62: every nomination opens with a draft_bids row.
    INSERT INTO public.draft_bids
      (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
    VALUES
      (p_draft_id, v_draft.league_id, v_draft.current_pick_number,
       p_player_id, v_draft.on_clock_team_id, v_nom_floor, v_action)
    RETURNING * INTO v_bid;

    -- Open the BIDDING phase (D126). current_pick_number is NOT advanced —
    -- it IS this nomination's sequence number until the award (D157(2)) —
    -- and on_clock stays the NOMINATOR.
    UPDATE public.drafts SET
      current_nomination = jsonb_build_object(
                             'player_id', p_player_id,
                             'high_bid', v_nom_floor,
                             'high_bidder_team_id', v_draft.on_clock_team_id),
      current_deadline   = now() + make_interval(secs => v_bid_seconds),
      updated_at         = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_draft;

    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (v_draft.league_id, auth.uid(),
            'Nomination ' || v_draft.current_pick_number || ' made by commissioner '
            || public.draft_actor_name() || ' for '
            || COALESCE(v_team_name, 'the team on the clock')
            || ': ' || v_player_name || ' at $' || v_nom_floor || '.',
            'draft:' || p_draft_id::text, TRUE);

    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'bid', to_jsonb(v_bid));
  END IF;

  -- SNAKE / LINEAR from here down — 069's text, unchanged.
  -- E2 replay short-circuit (optional idempotency — §4.6; the R125
  -- semantics apply: an action_id is consumed forever, undone or not).
  IF p_action_id IS NOT NULL THEN
    SELECT p.* INTO v_pick
    FROM public.draft_picks p
    WHERE p.draft_id = p_draft_id AND p.action_id = p_action_id;
    IF FOUND THEN
      RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'pick', to_jsonb(v_pick));
    END IF;
  END IF;

  IF v_draft.status = 'paused' THEN
    RAISE EXCEPTION
      'draft_force_pick: the draft is paused — resume it first, then pick for the team on the clock'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_draft.status <> 'live' THEN
    RAISE EXCEPTION 'draft_force_pick: the draft is % — there is no pick on the clock', v_draft.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pl.full_name INTO v_player_name
  FROM public.players pl WHERE pl.id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_force_pick: player % not found', p_player_id
      USING ERRCODE = 'P0002';
  END IF;

  -- E1 availability under the lock (friendly path; the partial unique is
  -- the guarantee).
  IF EXISTS (
    SELECT 1 FROM public.draft_picks p
    WHERE p.draft_id = p_draft_id AND p.player_id = p_player_id
      AND p.is_undone = FALSE
  ) THEN
    RAISE EXCEPTION
      'draft_force_pick: % just went off the board — pick another player',
      v_player_name
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.name INTO v_team_name
  FROM public.teams t WHERE t.id = v_draft.on_clock_team_id;

  -- The ONE advance path (reuse, never fork): §8.7 "Pick for a manager"
  -- shape — a deliberate human action, not an autopick (is_auto FALSE),
  -- made_via 'commissioner', picked_by = the commissioner (§12.4).
  BEGIN
    v_result := public.draft_apply_pick_internal(
      p_draft_id, p_player_id, FALSE, 'commissioner', auth.uid(), p_action_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION
      'draft_force_pick: % just went off the board — pick another player',
      v_player_name
      USING ERRCODE = 'P0001';
  END;

  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          'Pick ' || v_draft.current_pick_number || ' made by commissioner '
          || public.draft_actor_name() || ' for ' || COALESCE(v_team_name, 'the team on the clock')
          || ': ' || v_player_name || '.',
          'draft:' || p_draft_id::text, TRUE);

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_force_pick(UUID, TEXT, UUID, TEXT)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 7. create_mock_draft — §8.8's practice room, same engine.
--    REPLACED FROM 089:759-1052 (D137 head rule; 089 replaced 071's). THREE
--    hunks: the declare, the D95 hydration comment's knob list, and the
--    practice refusal. The §8.6.8 backstop itself is unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_mock_draft(
  p_league_id UUID,
  p_human_team_id UUID DEFAULT NULL,
  p_cpu_speed TEXT DEFAULT 'realistic',
  p_action_id UUID DEFAULT NULL
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
BEGIN
  -- Argument shape (22023) before any data access.
  IF p_cpu_speed IS NULL OR p_cpu_speed NOT IN ('realistic', 'fast') THEN
    RAISE EXCEPTION 'create_mock_draft: cpu_speed must be realistic or fast'
      USING ERRCODE = '22023';
  END IF;

  -- Fast-fail auth (no-leak: a nonexistent league answers 42501 too).
  IF NOT public.is_league_member(p_league_id) THEN
    RAISE EXCEPTION 'create_mock_draft: not a member of this league'
      USING ERRCODE = '42501';
  END IF;

  -- Cap-race serializer (banner item 1): same-user concurrent launches
  -- serialize here so the §22.5 caps cannot be double-tapped past. An
  -- ADVISORY lock, deliberately not a profiles-row lock (row locks on
  -- profiles join the FK KEY-SHARE graph chat INSERTs touch — the R122
  -- deadlock class; advisory locks live outside it).
  PERFORM pg_advisory_xact_lock(
    hashtextextended('create_mock_draft:' || auth.uid()::text, 0));

  -- §4 rule 6 (E2) idempotency — batch 7, R149 (banner item 1): a retry of
  -- an already-committed launch returns the ORIGINAL mock, not a second
  -- one (the 060 replay pattern). AFTER the advisory lock (a concurrent
  -- double-tap serializes into create-then-replay) and BEFORE league/cap
  -- validation (the same intent must not trip caps its own creation
  -- already passed). Launcher-scoped + TEXT-compared (R117): a foreign
  -- caller's lookup simply misses and falls through to their own
  -- validation. A deleted mock does not replay (row = ledger).
  IF p_action_id IS NOT NULL THEN
    SELECT d.* INTO v_draft
    FROM public.drafts d
    WHERE d.is_mock
      AND d.config->'mock'->>'launched_by' = auth.uid()::text
      AND d.config->'mock'->>'action_id' = p_action_id::text;
    IF FOUND THEN
      RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'created', FALSE);
    END IF;
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

  -- 089 (L.C1.7): the M3 seam is LIFTED — this is where 071 refused an
  -- auction config naming M3 (tests/025:400 flipped in the same PR). A mock
  -- auction launches through the same arm shape draft_start's auction arm
  -- has (084): the snapshot below already carries the whole §7.3.8 auction
  -- block (budget, the $0-nomination toggle, the three clocks, anti-snipe — D95: a mock never
  -- re-hydrates); the nomination order, the first nominator and the first
  -- clock are resolved per type further down.
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

  -- §22.5 caps, in-body (friendly refusals — §16.5.2 states). Counted
  -- across ALL leagues (per-user caps). The hourly count is over
  -- SURVIVING rows — recorded residual in the banner (F41 annotation).
  SELECT count(*) INTO v_active_mocks
  FROM public.drafts d
  WHERE d.is_mock
    AND d.status IN ('live', 'paused')
    AND d.config->'mock'->>'launched_by' = auth.uid()::text;
  IF v_active_mocks >= 3 THEN
    RAISE EXCEPTION
      'create_mock_draft: you already have 3 active mock drafts — finish or delete one first (§22.5)'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_hour_creates
  FROM public.drafts d
  WHERE d.is_mock
    AND d.config->'mock'->>'launched_by' = auth.uid()::text
    AND d.created_at > now() - interval '1 hour';
  IF v_hour_creates >= 5 THEN
    RAISE EXCEPTION
      'create_mock_draft: mock-draft creation is limited to 5 per hour — try again in a bit (§22.5)'
      USING ERRCODE = 'P0001';
  END IF;

  -- Seat resolution: default = the launcher's own franchise (§8.8 "their
  -- real seat by default"); ANY active seat selectable (placeholder or
  -- another member's franchise — authorization is launcher-keyed, D103).
  IF p_human_team_id IS NULL THEN
    SELECT m.team_id INTO v_human
    FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid();
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

  -- D91: rounds = starters + bench (IR excluded) — the same fn the real
  -- start uses.
  v_total_rounds := public.draft_rounds_from_roster(v_league.roster_settings);
  IF v_total_rounds IS NULL OR v_total_rounds < 1 THEN
    RAISE EXCEPTION
      'create_mock_draft: league % roster settings produce no draftable rounds (rounds = starters + bench, D91) — fix the roster in League settings',
      p_league_id
      USING ERRCODE = 'P0001';
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

  v_mock_id := gen_random_uuid();
  v_order := public.draft_resolve_order_internal(
    p_league_id,
    v_league.team_count,
    COALESCE(v_config->>'draft_order_mode', 'random'),
    v_real_order,
    v_config->'draft_order',
    v_mock_id,
    'create_mock_draft');

  -- 089: nomination order (§8.3/§7.3.8) — auction only, through 084's ONE
  -- implementation with the rules draft_start applies: same_as_draft_order
  -- copies the resolved draft order; random = the D105 shuffle seeded by
  -- the MOCK's own id (derived, so it is not a carbon copy of a random
  -- draft order — 084 banner item 2); manual = the real scheduled draft's
  -- stored nomination order, validated as a permutation. Snake/linear leave
  -- the column NULL.
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
  v_config := jsonb_set(v_config, '{mock}', jsonb_build_object(
    'human_team_id', v_human::text,
    'cpu_speed', p_cpu_speed,
    'launched_by', auth.uid()::text)
    || CASE WHEN p_action_id IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('action_id', p_action_id::text) END);

  -- Starts immediately (§8.8): live, pick 1 (= nomination sequence 1 for an
  -- auction — D126) on the clock; `current_nomination` NULL ⇒ the
  -- NOMINATING phase; `budget_adjustments` is the column default '{}' (a
  -- mock has no commissioner to adjust anything — D110(1)/D138). The D95
  -- partial unique ignores mocks — the league's real scheduled draft
  -- coexists (E60).
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
  -- one either: "Same engine, literally" (§8.8). The RAISE rolls the INSERT
  -- back.
  IF v_type = 'auction' AND NOT public.draft_auction_solvent(v_mock_id) THEN
    v_budget  := COALESCE((v_config->>'auction_budget')::int, 200);
    -- 092/AP.1: the reserve, through the ONE authority (D198(1)).
    v_reserve := public.draft_auction_reserve(v_config);
    RAISE EXCEPTION
      'create_mock_draft: league % cannot practice an auction — a $% budget cannot fill % draftable roster spots at a $% per-slot reserve (§8.6.8 solvency); raise the auction budget, or allow $0 nominations in League settings → Draft setup',
      p_league_id, v_budget, v_total_rounds, v_reserve
      USING ERRCODE = 'P0001';
  END IF;

  -- Launch is the launcher's first liveness beat (banner item 1): the E59
  -- stale clock starts honest even if the room never mounts, and the
  -- expiry idle definition always has a beat to read.
  INSERT INTO public.draft_liveness (draft_id, user_id, last_seen_at)
  VALUES (v_mock_id, auth.uid(), now())
  ON CONFLICT (draft_id, user_id) DO UPDATE SET last_seen_at = now();

  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'created', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION create_mock_draft(UUID, UUID, TEXT, UUID)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 8. draft_reassign_pick — §8.7 Manual Edit Mode, the priced re-entry.
--    REPLACED FROM 090:564-839 (D137 head rule; 069 -> 087 -> 090, and 090 is the
--    head because F57 gave it the pause-first gate). TWO hunks: the declare,
--    and the price floor + the max-bid message in one contiguous block. **F57
--    /L.C1.8's pause-first gate is untouched** — no line of it is inside a hunk.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_reassign_pick(
  p_draft_id UUID,
  p_pick_id UUID,
  p_team_id UUID DEFAULT NULL,
  p_player_id TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_price INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft         public.drafts;
  v_pick          public.draft_picks;
  v_new_player    TEXT;
  v_new_team      UUID;
  v_old_team      UUID;
  v_old_pl_name   TEXT;
  v_new_pl_name   TEXT;
  v_old_team_name TEXT;
  v_new_team_name TEXT;
  v_target_count  BIGINT;
  v_msg           TEXT;
  v_price_in      INTEGER := p_price;
  v_recv_team     UUID;
  v_old_owner     UUID;
  v_reserve       INTEGER;
  v_remaining     INTEGER;
  v_open          INTEGER;
  v_max_bid       INTEGER;
BEGIN
  IF p_team_id IS NULL AND p_player_id IS NULL AND p_price IS NULL THEN
    RAISE EXCEPTION 'draft_reassign_pick: provide a new team, a new player, or both'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_reassign_pick: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  -- MOCK GUARD (L.B1.6/071 — amended in place, F12; D103(2)/§8.8): §8.7
  -- is the REAL-draft commissioner surface. On a mock this control is
  -- interference with a member's solo practice (and for draft_reset an
  -- outright zero-side-effect breach — it writes leagues.status and the
  -- stored schedule instant). The launcher's controls are
  -- pause/resume/delete (069 mock arms + 071). Pinned in pgTAP 025.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_reassign_pick: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION
      'draft_reassign_pick: the draft is complete — post-completion corrections arrive with the commissioner console (M6)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'draft_reassign_pick: the draft has not started yet'
      USING ERRCODE = 'P0001';
  END IF;

  -- 090/L.C1.8 — D141 gate, F57 ALIGNED (Chris, 2026-08-18): pick edits
  -- are pause-first on EVERY draft type (§8.7 v2.12.5).
  PERFORM public.draft_auction_pause_gate_internal(v_draft, 'draft_reassign_pick');

  -- 087/L.C1.5 — a price on a SNAKE pick is a category error, refused HERE
  -- (immediately after the gate) rather than at the priced block far below:
  -- an argument that means nothing for this draft type should not depend on
  -- finding the row it would have been applied to.
  IF v_draft.draft_type <> 'auction' AND p_price IS NOT NULL THEN
    RAISE EXCEPTION
      'draft_reassign_pick: this is a % draft — its picks carry no price (§12.4)',
      v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  SELECT p.* INTO v_pick
  FROM public.draft_picks p
  WHERE p.id = p_pick_id AND p.draft_id = p_draft_id AND p.is_undone = FALSE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_reassign_pick: pick % is not a live pick of this draft', p_pick_id
      USING ERRCODE = 'P0002';
  END IF;

  v_new_player := COALESCE(p_player_id, v_pick.player_id);
  v_new_team   := COALESCE(p_team_id, v_pick.team_id);

  -- Before-values captured for the §8.7 before/after post.
  v_old_team := v_pick.team_id;
  SELECT pl.full_name INTO v_old_pl_name
  FROM public.players pl WHERE pl.id = v_pick.player_id;
  SELECT t.name INTO v_old_team_name
  FROM public.teams t WHERE t.id = v_pick.team_id;

  -- New player must exist…
  IF p_player_id IS NOT NULL THEN
    SELECT pl.full_name INTO v_new_pl_name
    FROM public.players pl WHERE pl.id = p_player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'draft_reassign_pick: player % not found', p_player_id
        USING ERRCODE = 'P0002';
    END IF;
    -- …and be exclusive: no live pick of this draft may already hold him
    -- (the pick's OWN row counts — a no-change reassign surfaces here).
    IF EXISTS (
      SELECT 1 FROM public.draft_picks p
      WHERE p.draft_id = p_draft_id AND p.player_id = p_player_id
        AND p.is_undone = FALSE
    ) THEN
      RAISE EXCEPTION
        'draft_reassign_pick: % is already on a roster in this draft — undo or reassign that pick first',
        v_new_pl_name
        USING ERRCODE = 'P0001';
    END IF;
    -- 087/R379-cycle (filed R380) — THE ONE PLAYER THE SWEEP ABOVE CANNOT
    -- SEE. On an auction the NOMINATED player has no draft_picks row yet: the
    -- tick writes it at the award (ARM 2.6's INSERT, 087:3497). So the
    -- exclusivity check passes
    -- for exactly the player who must not be assigned, and nothing else on
    -- this path looks at `current_nomination` — the E28 arms are about money,
    -- and the section-3b gate returns silently when the receiving team is not
    -- the high bidder. The award's INSERT then hits `uniq_draft_player_live`
    -- (`uniq_draft_player_live`, 065:178), ARM 2.6's containment — the
    -- `EXCEPTION WHEN OTHERS` at 087:3581 — swallows the unique_violation into
    -- `auction_failures`, the nomination is never cleared, and every 5s tick
    -- reproduces it: the D160(8) stuck clock reached through the board.
    -- draft_move_player cannot reach this — it requires the player to already
    -- hold a live pick — which is why the guard lives here and only here.
    IF v_draft.draft_type = 'auction'
       AND v_draft.current_nomination->>'player_id' = p_player_id THEN
      RAISE EXCEPTION
        'draft_reassign_pick: % is on the block right now — cancel the nomination first (Edit current nomination), then assign him (§8.7/D143)',
        v_new_pl_name
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- New team must be an active franchise of THIS league.
  IF p_team_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = p_team_id AND t.league_id = v_draft.league_id
        AND t.status <> 'retired'
    ) THEN
      RAISE EXCEPTION 'draft_reassign_pick: team % is not an active franchise of this league', p_team_id
        USING ERRCODE = 'P0002';
    END IF;
    -- Capacity (v2.8.11: slot validation at pick time = capacity only).
    IF p_team_id <> v_pick.team_id THEN
      SELECT count(*) INTO v_target_count
      FROM public.draft_picks p
      WHERE p.draft_id = p_draft_id AND p.team_id = p_team_id
        AND p.is_undone = FALSE;
      IF v_target_count >= v_draft.total_rounds THEN
        RAISE EXCEPTION
          'draft_reassign_pick: that team''s roster is already full (% of % picks) — move a player off it first',
          v_target_count, v_draft.total_rounds
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  v_recv_team := v_new_team;
  v_old_owner := v_pick.team_id;

  -- 087/L.C1.5 — D142's PRICED PATH. Manual Edit Mode's "Move player to a
  -- different team" charges the receiving team, so the commissioner
  -- RE-ENTERS the cost and that re-entered amount IS the validation input.
  IF v_draft.draft_type = 'auction' THEN
    -- The cost is re-entered when the pick CHANGES HANDS (D142's second
    -- choice). A same-team edit — swapping which player the pick took, or
    -- correcting the price alone — does not charge a new team, so demanding
    -- a price there would be ceremony rather than a check.
    IF v_price_in IS NULL AND v_recv_team IS DISTINCT FROM v_old_owner THEN
      RAISE EXCEPTION
        'draft_reassign_pick: this is an auction — re-enter the price this pick should cost the receiving team (§8.7 Manual Edit Mode)'
        USING ERRCODE = '22023';
    END IF;
    -- 092/AP.1: ONE derived number for BOTH jobs this line does (D198(1);
    -- §7.3.8's auction_zero_dollar_nominations row) — the floor a re-entered
    -- price must clear, and the §8.6.1 per-slot reserve the max-bid message
    -- below names. $1 with the toggle OFF, $0 with it ON. Neither is the bid
    -- increment, which is a fixed $1 (§8.6.3).
    v_reserve := public.draft_auction_reserve(v_draft.config);
    IF v_price_in IS NOT NULL AND v_price_in < v_reserve THEN
      RAISE EXCEPTION
        'draft_reassign_pick: $% is below this league''s $% price floor (§7.3.8)',
        v_price_in, v_reserve
        USING ERRCODE = 'P0001';
    END IF;
    -- E28-class: the same algebra the award uses (§8.6.8 rule 7). A team can
    -- afford `price` exactly when price <= max_bid, because paying it leaves
    -- remaining - price >= (open_slots - 1) * reserve.
    IF v_price_in IS NOT NULL AND v_recv_team IS DISTINCT FROM v_old_owner THEN
      SELECT b.remaining, b.open_slots, b.max_bid
        INTO v_remaining, v_open, v_max_bid
      FROM public.draft_team_budget(p_draft_id, v_recv_team) b;
      IF v_price_in > v_max_bid THEN
        RAISE EXCEPTION
          'draft_reassign_pick: $% is over that team''s max bid of $% — they have $% for % open roster spots at a $% per-slot reserve; reverse a won bid or adjust their budget first (E28/§8.6.8)',
          v_price_in, v_max_bid, v_remaining, v_open, v_reserve
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;   -- (the snake arm was refused right after the gate, above)

  SELECT t.name INTO v_new_team_name
  FROM public.teams t WHERE t.id = v_new_team;

  UPDATE public.draft_picks
  SET team_id   = v_new_team,
      player_id = v_new_player,
      -- 087: the auction's re-entered cost rides the row (§12.4's `price`);
      -- a snake pick keeps its NULL, because v_price_in is NULL there by the
      -- refusal above.
      price     = COALESCE(v_price_in, price)
  WHERE id = p_pick_id
  RETURNING * INTO v_pick;

  UPDATE public.drafts SET updated_at = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  -- 087/R367 — E28 ARM 3 (D131(4)), RE-ASKED AFTER THE WRITE. The pre-write
  -- `price <= max_bid` above measures the world BEFORE this pick lands, and
  -- it is guarded by `recv IS DISTINCT FROM old_owner` so a same-team
  -- price-only correction never reaches it at all. Both gaps are the same
  -- gap: the receiving team's max bid falls when the pick lands, and if that
  -- team is the LIVE HIGH BIDDER the close becomes unaffordable and the tick
  -- refuses the award forever (the D160(8) stuck clock). Unconditional here
  -- — no distinct-owner guard — so the price-only arm is covered too. The
  -- RAISE rolls the UPDATE back inside the caller's transaction.
  PERFORM public.draft_auction_high_bid_gate_internal(
    v_draft, v_recv_team, 'draft_reassign_pick',
    'Void the nomination (Edit current nomination — the board is already paused) or reverse a won bid first');

  -- 087 — §4 rule 7 backstop, through the ONE family: the targeted refusals
  -- above cover the receiving team, this proves nobody else's floor moved.
  IF v_draft.draft_type = 'auction'
     AND NOT public.draft_auction_solvent(p_draft_id) THEN
    RAISE EXCEPTION
      'draft_reassign_pick: that edit left auction % insolvent (§8.6.8) — refusing',
      p_draft_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Before/after in the post (§8.7 row 5) — built from the values captured
  -- BEFORE the update.
  v_msg := 'Pick ' || v_pick.pick_number || ' edited by ' || public.draft_actor_name();
  IF p_player_id IS NOT NULL THEN
    v_msg := v_msg || ': ' || COALESCE(v_old_pl_name, '?') || ' -> '
                   || COALESCE(v_new_pl_name, '?');
  END IF;
  IF p_team_id IS NOT NULL AND p_team_id <> v_old_team THEN
    v_msg := v_msg
      || CASE WHEN p_player_id IS NOT NULL THEN ';' ELSE ':' END
      || ' moved from ' || COALESCE(v_old_team_name, '?')
      || ' to ' || COALESCE(v_new_team_name, '?');
  END IF;
  IF v_price_in IS NOT NULL THEN
    v_msg := v_msg || CASE WHEN p_player_id IS NOT NULL
                             OR (p_team_id IS NOT NULL AND p_team_id <> v_old_team)
                           THEN '; ' ELSE ': ' END
                   || 'price set to $' || v_price_in;
  END IF;
  v_msg := v_msg || '.';

  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(), v_msg,
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'pick', to_jsonb(v_pick));
END;
$$;

REVOKE EXECUTE ON FUNCTION
  draft_reassign_pick(UUID, UUID, UUID, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 9. draft_move_player — §8.7 Manual Edit Mode, the cross-team move.
--    REPLACED FROM 090:849-1085 (D137 head rule; 069 -> 087 -> 090). TWO hunks,
--    the mirror of section 8. R367 ARM 2 and R378's capacity arm are outside
--    both hunks and are byte-identical.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_move_player(
  p_draft_id UUID,
  p_player_id TEXT,
  p_from_team UUID,
  p_to_team UUID,
  p_reason TEXT DEFAULT NULL,
  p_price INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft        public.drafts;
  v_pick         public.draft_picks;
  v_player_name  TEXT;
  v_from_name    TEXT;
  v_to_name      TEXT;
  v_target_count BIGINT;
  v_price_in     INTEGER := p_price;
  v_recv_team    UUID;
  v_old_owner    UUID;
  v_reserve      INTEGER;
  v_remaining    INTEGER;
  v_open         INTEGER;
  v_max_bid      INTEGER;
BEGIN
  IF p_player_id IS NULL OR btrim(p_player_id) = ''
     OR p_from_team IS NULL OR p_to_team IS NULL THEN
    RAISE EXCEPTION 'draft_move_player: player_id, from_team, and to_team are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_move_player: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  -- MOCK GUARD (L.B1.6/071 — amended in place, F12; D103(2)/§8.8): §8.7
  -- is the REAL-draft commissioner surface. On a mock this control is
  -- interference with a member's solo practice (and for draft_reset an
  -- outright zero-side-effect breach — it writes leagues.status and the
  -- stored schedule instant). The launcher's controls are
  -- pause/resume/delete (069 mock arms + 071). Pinned in pgTAP 025.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_move_player: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION
      'draft_move_player: the draft is complete — post-completion corrections arrive with the commissioner console (M6)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'draft_move_player: the draft has not started yet'
      USING ERRCODE = 'P0001';
  END IF;

  -- 090/L.C1.8 — D141 gate, F57 ALIGNED (Chris, 2026-08-18): pause-first
  -- on EVERY draft type (§8.7 v2.12.5). THIS
  -- IS ALSO THE ARM D160(8)/R364 NAMED: before 087 this function had no
  -- draft_type awareness at all, so a commissioner mis-click could move a
  -- priced player onto a team and shrink a live high bidder's max_bid below
  -- their standing bid — manufacturing exactly the insolvent award the tick
  -- then refuses forever.
  --
  -- R367 CORRECTION, and it is worth reading rather than trusting: this
  -- comment used to end "the gate, the priced validation and the solvency
  -- backstop below are what close that door", and that sentence was FALSE.
  -- The gate only decides WHEN the commissioner may act; the pre-write
  -- `price <= max_bid` measures the world before the pick lands; and
  -- `draft_auction_solvent` cannot see a bid at all, because bids hold no
  -- money (D131(2)). The door is closed by E28 arm 3, asked AFTER the write
  -- (section 3b) — which is the ONLY one of the four that compares the
  -- post-edit max bid against the STANDING bid.
  PERFORM public.draft_auction_pause_gate_internal(v_draft, 'draft_move_player');

  -- 087/L.C1.5 — a price on a SNAKE pick is a category error, refused HERE
  -- (immediately after the gate) rather than at the priced block far below:
  -- an argument that means nothing for this draft type should not depend on
  -- finding the row it would have been applied to.
  IF v_draft.draft_type <> 'auction' AND p_price IS NOT NULL THEN
    RAISE EXCEPTION
      'draft_move_player: this is a % draft — its picks carry no price (§12.4)',
      v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pl.full_name INTO v_player_name
  FROM public.players pl WHERE pl.id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_move_player: player % not found', p_player_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT t.name INTO v_to_name
  FROM public.teams t
  WHERE t.id = p_to_team AND t.league_id = v_draft.league_id
    AND t.status <> 'retired';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_move_player: team % is not an active franchise of this league', p_to_team
      USING ERRCODE = 'P0002';
  END IF;

  -- The task's exclusivity refusal (also the natural replay shape: after a
  -- successful move the player IS on p_to_team, so a replay lands here).
  IF p_to_team = p_from_team THEN
    RAISE EXCEPTION
      'draft_move_player: % is already on that team',
      v_player_name
      USING ERRCODE = 'P0001';
  END IF;

  SELECT p.* INTO v_pick
  FROM public.draft_picks p
  WHERE p.draft_id = p_draft_id AND p.player_id = p_player_id
    AND p.is_undone = FALSE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_move_player: % has not been drafted in this draft', v_player_name
      USING ERRCODE = 'P0001';
  END IF;
  IF v_pick.team_id <> p_from_team THEN
    SELECT t.name INTO v_from_name
    FROM public.teams t WHERE t.id = v_pick.team_id;
    RAISE EXCEPTION
      'draft_move_player: % is on % — not the team you are moving from',
      v_player_name, COALESCE(v_from_name, 'another team')
      USING ERRCODE = 'P0001';
  END IF;

  -- Capacity (v2.8.11: slot validation at pick time = capacity only).
  SELECT count(*) INTO v_target_count
  FROM public.draft_picks p
  WHERE p.draft_id = p_draft_id AND p.team_id = p_to_team
    AND p.is_undone = FALSE;
  IF v_target_count >= v_draft.total_rounds THEN
    RAISE EXCEPTION
      'draft_move_player: that team''s roster is already full (% of % picks) — move a player off it first',
      v_target_count, v_draft.total_rounds
      USING ERRCODE = 'P0001';
  END IF;

  v_recv_team := p_to_team;
  v_old_owner := p_from_team;

  -- 087/L.C1.5 — D142's PRICED PATH. Manual Edit Mode's "Move player to a
  -- different team" charges the receiving team, so the commissioner
  -- RE-ENTERS the cost and that re-entered amount IS the validation input.
  IF v_draft.draft_type = 'auction' THEN
    -- The cost is re-entered when the pick CHANGES HANDS (D142's second
    -- choice). A same-team edit — swapping which player the pick took, or
    -- correcting the price alone — does not charge a new team, so demanding
    -- a price there would be ceremony rather than a check.
    IF v_price_in IS NULL AND v_recv_team IS DISTINCT FROM v_old_owner THEN
      RAISE EXCEPTION
        'draft_move_player: this is an auction — re-enter the price this pick should cost the receiving team (§8.7 Manual Edit Mode)'
        USING ERRCODE = '22023';
    END IF;
    -- 092/AP.1: ONE derived number for BOTH jobs this line does (D198(1);
    -- §7.3.8's auction_zero_dollar_nominations row) — the floor a re-entered
    -- price must clear, and the §8.6.1 per-slot reserve the max-bid message
    -- below names. $1 with the toggle OFF, $0 with it ON. Neither is the bid
    -- increment, which is a fixed $1 (§8.6.3).
    v_reserve := public.draft_auction_reserve(v_draft.config);
    IF v_price_in IS NOT NULL AND v_price_in < v_reserve THEN
      RAISE EXCEPTION
        'draft_move_player: $% is below this league''s $% price floor (§7.3.8)',
        v_price_in, v_reserve
        USING ERRCODE = 'P0001';
    END IF;
    -- E28-class: the same algebra the award uses (§8.6.8 rule 7). A team can
    -- afford `price` exactly when price <= max_bid, because paying it leaves
    -- remaining - price >= (open_slots - 1) * reserve.
    IF v_price_in IS NOT NULL AND v_recv_team IS DISTINCT FROM v_old_owner THEN
      SELECT b.remaining, b.open_slots, b.max_bid
        INTO v_remaining, v_open, v_max_bid
      FROM public.draft_team_budget(p_draft_id, v_recv_team) b;
      IF v_price_in > v_max_bid THEN
        RAISE EXCEPTION
          'draft_move_player: $% is over that team''s max bid of $% — they have $% for % open roster spots at a $% per-slot reserve; reverse a won bid or adjust their budget first (E28/§8.6.8)',
          v_price_in, v_max_bid, v_remaining, v_open, v_reserve
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;   -- (the snake arm was refused right after the gate, above)

  SELECT t.name INTO v_from_name
  FROM public.teams t WHERE t.id = p_from_team;

  UPDATE public.draft_picks
  SET team_id = p_to_team,
      -- 087: D142's re-entered cost. NULL on snake by the refusal above, so
      -- COALESCE keeps 069's behaviour there exactly.
      price   = COALESCE(v_price_in, price)
  WHERE id = v_pick.id
  RETURNING * INTO v_pick;

  UPDATE public.drafts SET updated_at = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  -- 087/R367 — E28 ARM 3 (D131(4)), RE-ASKED AFTER THE WRITE. This is the
  -- arm that made the comment above false until R367: the gate + the
  -- pre-write `price <= max_bid` do NOT stop a commissioner shrinking the
  -- live high bidder's max bid below its own standing bid, because that
  -- shrink only happens once the pick lands. Driven, not reasoned — a move
  -- at $100 against a $150 high bid was ACCEPTED and left max_bid $99, and
  -- `draft_auction_solvent` stayed TRUE throughout (a bid holds no money, so
  -- no derivation sees it). The RAISE rolls the UPDATE back inside the
  -- caller's transaction.
  PERFORM public.draft_auction_high_bid_gate_internal(
    v_draft, v_recv_team, 'draft_move_player',
    'Void the nomination (Edit current nomination — the board is already paused) or reverse a won bid first');

  -- 087 — §4 rule 7 backstop, through the ONE family: the targeted refusals
  -- above cover the receiving team, this proves nobody else's floor moved.
  IF v_draft.draft_type = 'auction'
     AND NOT public.draft_auction_solvent(p_draft_id) THEN
    RAISE EXCEPTION
      'draft_move_player: that edit left auction % insolvent (§8.6.8) — refusing',
      p_draft_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Before/after in the post (§8.7 row 5).
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          v_player_name || ' moved from ' || COALESCE(v_from_name, '?')
          || ' to ' || v_to_name || ' by ' || public.draft_actor_name()
          || CASE WHEN v_price_in IS NOT NULL
                  THEN ' at $' || v_price_in ELSE '' END || '.',
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'pick', to_jsonb(v_pick));
END;
$$;

REVOKE EXECUTE ON FUNCTION
  draft_move_player(UUID, TEXT, UUID, UUID, TEXT, INTEGER)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 10. draft_place_bid_internal — the ONE bid validator/writer.
--    REPLACED FROM 091:582-738 (D137 head rule; 089 -> 091). FOUR hunks: the
--    declare, the read, the raise-floor comment, and E5. **THE RAISE FLOOR
--    ITSELF IS UNTOUCHED** — `IF p_amount <= v_high_bid` and its `v_high_bid + 1`
--    message are byte-identical, which is the whole point of Chris's ruling:
--    the increment is a fixed $1 and was never this field's job. 091/AP.3's
--    reactive-CPU arm is outside every hunk.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_place_bid_internal(
  p_draft_id UUID,
  p_team_id UUID,
  p_amount INTEGER,
  p_action_id UUID,
  p_label TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_draft         public.drafts;
  v_bid           public.draft_bids;
  v_high_name     TEXT;
  v_high_bid      INTEGER;
  v_high_team     UUID;
  v_player_id     TEXT;
  v_reserve       INTEGER;
  v_anti_snipe    INTEGER;
  v_deadline      TIMESTAMPTZ;
  v_remaining     INTEGER;
  v_open          INTEGER;
  v_max_bid       INTEGER;
BEGIN
  SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  IF NOT FOUND OR v_draft.current_nomination IS NULL THEN
    -- Caller-contract breach: the RPC and the tick both establish the
    -- bidding phase before calling. Loud, never a silent no-op.
    RAISE EXCEPTION
      '%: draft_place_bid_internal called outside the bidding phase on draft %',
      p_label, p_draft_id;
  END IF;

  v_player_id := v_draft.current_nomination->>'player_id';
  v_high_bid  := COALESCE((v_draft.current_nomination->>'high_bid')::int, 0);
  v_high_team := (v_draft.current_nomination->>'high_bidder_team_id')::uuid;
  -- 092/AP.1: read ONLY to print the E5 message's reserve term, through the
  -- ONE authority (D198(1)). It has never governed a raise and does not now:
  -- the raise floor is `p_amount <= v_high_bid` below — a fixed $1 increment
  -- in BOTH toggle columns (§8.6.3).
  v_reserve   := public.draft_auction_reserve(v_draft.config);

  -- A self-raise is a mis-click, not a bid: bidding against yourself only
  -- burns your own budget and the clock.
  IF p_team_id = v_high_team THEN
    RAISE EXCEPTION
      '%: you are already the high bidder at $% — wait for someone to raise you (§8.6.3)',
      p_label, v_high_bid
      USING ERRCODE = 'P0001';
  END IF;

  -- The ONE budget authority (084/§4.7) — capacity and money in one read.
  SELECT b.remaining, b.open_slots, b.max_bid
    INTO v_remaining, v_open, v_max_bid
  FROM public.draft_team_budget(p_draft_id, p_team_id) b;

  -- E27: a complete roster is skipped in the rotation AND cannot bid.
  IF v_open < 1 THEN
    RAISE EXCEPTION
      '%: your roster is complete — a complete roster cannot bid (§8.6.7(c)/E27)',
      p_label
      USING ERRCODE = 'P0001';
  END IF;

  -- THE RACE LOSER'S INSTANT REFUSAL (§16.3/rule 8; D136 — friendly
  -- P0001, never a 429). Integer raises only: the minimum legal bid is
  -- high + 1, in BOTH toggle columns (§8.6.3; C38/C40 promoted to law in
  -- v2.13 — a $0 opening is raised to $1, not to $0).
  IF p_amount <= v_high_bid THEN
    SELECT t.name INTO v_high_name
    FROM public.teams t WHERE t.id = v_high_team;
    RAISE EXCEPTION
      '%: outbid at $% — % holds the high bid; bid $% or more',
      p_label, v_high_bid, COALESCE(v_high_name, 'another team'), v_high_bid + 1
      USING ERRCODE = 'P0001';
  END IF;

  -- E5/§8.6.7(d) — the solvency clause at the bid layer (085 banner item
  -- 2). The message names the formula's number and the money behind it,
  -- so a manager can see WHY $N is their ceiling. THIS is the validator
  -- E62 says a CPU must pass — and the CPU sub-arm reaches it through this
  -- very line.
  IF p_amount > v_max_bid THEN
    RAISE EXCEPTION
      '%: $% is over your max bid of $% — you have $% for % open roster spots at a $% per-slot reserve (§8.6.1/E5)',
      p_label, p_amount, v_max_bid, v_remaining, v_open, v_reserve
      USING ERRCODE = 'P0001';
  END IF;

  -- (3) WRITE.
  INSERT INTO public.draft_bids
    (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
  VALUES
    (p_draft_id, v_draft.league_id, v_draft.current_pick_number,
     v_player_id, p_team_id, p_amount, p_action_id)
  RETURNING * INTO v_bid;

  -- (4) ADVANCE: new high bid + the D128 anti-snipe floor. Above the
  -- threshold GREATEST keeps the standing deadline; below it the floor
  -- wins — the clock can only be EXTENDED, never shortened.
  -- The ZERO branch (R329, rationale corrected): at anti_snipe 0 the two
  -- forms agree on every LIVE deadline (`now() + make_interval(secs => 0)`
  -- IS now(), and GREATEST of a future deadline and now() is that
  -- deadline). They differ only when the standing deadline is NOT in the
  -- future: an ALREADY-EXPIRED one, which an unconditional GREATEST would
  -- REWRITE forward to exactly now(), and a NULL one, which GREATEST
  -- (which ignores NULLs) would INVENT out of nothing. Extension is
  -- disabled, so this branch touches no clock at all. Pinned in 034 §I on
  -- both sides. NOTE the counterpart, deliberate and recorded: with
  -- anti_snipe > 0 a bid landing AFTER the clock already read zero DOES
  -- receive a full fresh window — D128's letter ("reset the remaining time
  -- TO anti_snipe"), and consistent with snake's posture that the TICK is
  -- the enforcer, not the deadline column. (A CPU never reaches this line
  -- after zero: ARM 2.6(c)'s claim requires a RUNNING clock — 089.)
  v_anti_snipe := COALESCE((v_draft.config->>'auction_anti_snipe_seconds')::int, 10);
  IF v_anti_snipe > 0 THEN
    v_deadline := GREATEST(v_draft.current_deadline,
                           now() + make_interval(secs => v_anti_snipe));
  ELSE
    v_deadline := v_draft.current_deadline;
  END IF;

  UPDATE public.drafts SET
    current_nomination = jsonb_build_object(
                           'player_id', v_player_id,
                           'high_bid', p_amount,
                           'high_bidder_team_id', p_team_id),
    current_deadline   = v_deadline,
    updated_at         = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  -- (6) THE REACTIVE CPU RESPONSE (091/AP.3; spec §8.8 "a CPU raise is
  -- provoked by the bid it answers, never by the sweep"; D200(1)(2)). In a
  -- MOCK auction the bid that just landed provokes the CPU seats HERE, in
  -- the transaction that caused them — a human's raise, another CPU's, and
  -- (through the nomination paths) the open itself. It lives at the ONE bid
  -- writer so the invariant is "every bid in a mock auction provokes a
  -- response", not "three call sites remembered to".
  --   * The re-entrancy guard is transaction-local: the responder's own
  --     writes come back through this line, and the LADDER is the
  --     responder's loop, so a nested responder would double-count and
  --     escape its own cap. set_config(..., is_local => TRUE) is rolled
  --     back with the (sub)transaction, so a trapped failure inside the
  --     tick's ARM 2.6(c) cannot leave the flag stuck on.
  --   * A real draft is untouched: no auto-bidder exists there (§8.6.5).
  --   * The draft row is RE-READ afterwards because the ladder moved the
  --     high bid — returning the pre-ladder row would hand the caller a
  --     state the server had already superseded (§8.1: the RPC returns the
  --     NEW authoritative state). `bid` stays the caller's own row.
  IF v_draft.is_mock AND v_draft.draft_type = 'auction'
     AND COALESCE(current_setting('fieldscout.mock_cpu_responding', TRUE), 'off')
         <> 'on' THEN
    PERFORM public.draft_mock_cpu_respond_internal(p_draft_id);
    SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  END IF;

  -- (5) RETURN the new authoritative state.
  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'bid', to_jsonb(v_bid));
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_place_bid_internal(UUID, UUID, INTEGER, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. draft_system_nominate_internal — §8.6.2's timeout nomination.
--    REPLACED FROM 091:750-850 (D137 head rule; 089 -> 091). FIVE hunks: the
--    declare, the read, the solvency-implication comment, the affordability
--    refusal, and the two writes that OPEN AT the floor (the `draft_bids` row
--    and `current_nomination.high_bid`). 091/AP.3's reactive arm is outside
--    every hunk.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_system_nominate_internal(p_draft_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_draft     public.drafts;
  v_nom_floor INTEGER;
  v_remaining INTEGER;
  v_open      INTEGER;
  v_max_bid   INTEGER;
  v_player    TEXT;
BEGIN
  SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  IF NOT FOUND OR v_draft.current_nomination IS NOT NULL
     OR v_draft.on_clock_team_id IS NULL THEN
    RAISE EXCEPTION
      'draft_tick: draft_system_nominate_internal called outside the nominating phase on draft %',
      p_draft_id;
  END IF;

  -- 092/AP.1: the NOMINATION FLOOR, through the ONE authority (D198(1)) —
  -- the same derived number as the §8.6.1 per-slot reserve, and never the
  -- bid increment (a fixed $1 in both columns — §8.6.3).
  v_nom_floor := public.draft_auction_reserve(v_draft.config);

  -- §8.6.8 through the ONE derivation family (rule 7 — no path
  -- computes budgets independently). Both arms are unreachable on a
  -- sound board (the rotation skip guarantees the first; solvency
  -- implies the second, since remaining >= open × reserve gives
  -- max_bid = remaining − (open − 1) × reserve >= reserve, and floor =
  -- reserve), so both
  -- are LOUD rather than silently skipped.
  SELECT b.remaining, b.open_slots, b.max_bid
    INTO v_remaining, v_open, v_max_bid
  FROM public.draft_team_budget(v_draft.id, v_draft.on_clock_team_id) b;

  IF v_open < 1 THEN
    RAISE EXCEPTION
      'draft_tick: the nominating team % in auction % has a complete roster — the §8.6.7(c) rotation skip is broken',
      v_draft.on_clock_team_id, v_draft.id;
  END IF;
  IF v_max_bid < v_nom_floor THEN
    RAISE EXCEPTION
      'draft_tick: the nominating team % in auction % cannot afford the $% nomination floor (max bid $%; $% for % open spots) — §8.6.8 solvency is broken',
      v_draft.on_clock_team_id, v_draft.id, v_nom_floor, v_max_bid,
      v_remaining, v_open;
  END IF;

  -- THE SYSTEM NOMINATION (D129(2); C33's erratum): the on-clock
  -- team's OWN resolve chain — the same brain a snake timeout uses,
  -- one implementation for both engines — so the nominated player
  -- fits the NOMINATOR's open slot. That is what satisfies
  -- §8.6.7(e)'s "fits *some* team's open slot" and what keeps
  -- §8.6.7(b)'s no-raise award to the nominator always legal. In a
  -- mock the resolve is mock-aware (071/086): the human seat reads the
  -- LAUNCHER's prep, a CPU seat reads ADP + need and never its real
  -- owner's queue/boards (D110(4)).
  v_player := public.draft_autopick_resolve(
    v_draft.id, v_draft.on_clock_team_id);
  IF v_player IS NULL THEN
    RAISE EXCEPTION
      'draft_tick: no available player to system-nominate in auction draft % (pool exhausted)',
      v_draft.id;
  END IF;

  -- F62 — every nomination opens with a draft_bids row (§12.5's one
  -- uniform history — the room's feed, the E2 replay lookup and
  -- idx_draft_bids_nom all read it). The system path carries action_id
  -- NULL, which is precisely why C39 made the column NULLable. Pinned in
  -- 035 §D; load-bearing at the award, which refuses without it.
  INSERT INTO public.draft_bids
    (draft_id, league_id, nomination_seq, player_id, team_id,
     amount, action_id)
  VALUES
    (v_draft.id, v_draft.league_id, v_draft.current_pick_number,
     v_player, v_draft.on_clock_team_id, v_nom_floor, NULL);

  -- Open the BIDDING phase (D126). current_pick_number is NOT
  -- advanced — it IS this nomination's sequence number until the
  -- award (D157(2)) — and on_clock stays the NOMINATOR.
  UPDATE public.drafts SET
    current_nomination = jsonb_build_object(
                           'player_id', v_player,
                           'high_bid', v_nom_floor,
                           'high_bidder_team_id',
                             v_draft.on_clock_team_id),
    current_deadline   = now() + make_interval(secs => COALESCE(
                           (v_draft.config->>'auction_bid_seconds')::int,
                           20)),
    updated_at         = now()
  WHERE id = v_draft.id;

  -- THE REACTIVE CPU RESPONSE on the OPEN (091/AP.3; §8.8/D200(1) — "the
  -- nomination that opened the market" is one of the three provocations).
  -- Both consumers of this internal get it: the §8.6.2 nomination TIMEOUT
  -- and the CPU's own think-time nomination. Guarded on is_mock — a real
  -- auction has no auto-bidder (§8.6.5).
  IF v_draft.is_mock THEN
    PERFORM public.draft_mock_cpu_respond_internal(v_draft.id);
  END IF;

  RETURN v_player;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_system_nominate_internal(UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. draft_nominate — the human nomination (§8.6.2/§8.6.7(a)).
--    REPLACED FROM 091:863-1111 (D137 head rule; 085 -> 089 -> 091). THREE hunks:
--    the declare, the floor read + its refusal, and the §8.6.7(a) max-bid
--    message. With the toggle ON the two clauses read "floor 0, ceiling
--    max_bid" — which IS "a nomination should allow any number that the
--    player can afford" (Chris, 2026-08-20). 091/AP.3's reactive arm is
--    outside every hunk.
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
  IF NOT FOUND OR NOT public.is_league_member(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_nominate: not a member of this draft''s league'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
  ) THEN
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

  -- (4) ADVANCE: open the BIDDING phase (D126) and start the bid clock.
  -- current_pick_number is NOT advanced — it is this nomination's
  -- sequence number until the award (086). on_clock_team_id stays the
  -- NOMINATOR through bidding: it is the seat the rotation advances FROM
  -- (D130) and the room's "X nominated" attribution.
  UPDATE public.drafts SET
    current_nomination = jsonb_build_object(
                           'player_id', p_player_id,
                           'high_bid', p_opening_bid,
                           'high_bidder_team_id', v_my_team),
    current_deadline   = now() + make_interval(secs => v_bid_seconds),
    updated_at         = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  -- (4b) THE REACTIVE CPU RESPONSE on the OPEN (091/AP.3; §8.8/D200(1)).
  -- The human's own nomination is a provocation like any other: the CPUs
  -- answer in THIS transaction rather than one 5-second sweep later. The
  -- draft row is re-read because the ladder moved the high bid (§8.1 — the
  -- RPC returns the NEW authoritative state); `bid` stays the caller's own
  -- opening row.
  IF v_draft.is_mock THEN
    PERFORM public.draft_mock_cpu_respond_internal(p_draft_id);
    SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  END IF;

  -- (5) RETURN the new authoritative state.
  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'bid', to_jsonb(v_bid));
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_nominate(UUID, TEXT, INTEGER, UUID)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 13. draft_tick — the ONE clock sweep (§22.3; one cron entry, untouched).
--    REPLACED FROM 091:1128-2332 (D137 head rule; 068 -> 086 -> 087 -> 089 -> 091,
--     and 090 re-emits none of them). SEVEN hunks: the declare, four stale
--     comments, the read, and the award-time solvency refusal. **No arm, no
--     branch and no schedule changes**: `cron.schedule('draft-tick', '5 seconds', ...)`
--     at 068:1265 is NOT re-issued here (§22.3 — one cron entry for the whole
--     system), and 091/AP.3's reactive-CPU call sites are outside every hunk.
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
  v_reserve        INTEGER;
  v_remaining      INTEGER;
  v_open           INTEGER;
  v_max_bid        INTEGER;
  v_price          INTEGER;
  v_win_team       UUID;
  v_win_player     TEXT;
  v_is_auto        BOOLEAN;
  v_order          JSONB;
  v_n              INTEGER;
  v_idx            INTEGER;
  v_step           INTEGER;
  v_next_team      UUID;
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
      AND EXISTS (
        SELECT 1 FROM public.leagues l
        WHERE l.id = d.league_id AND l.deleted_at IS NULL
      )
    LIMIT c_batch
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_od.id;
      IF v_draft.status <> 'live' THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.leagues l
        WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
      ) THEN
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
      AND EXISTS (
        SELECT 1 FROM public.leagues l
        WHERE l.id = d.league_id AND l.deleted_at IS NULL
      )
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
      IF NOT EXISTS (
        SELECT 1 FROM public.leagues l
        WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
      ) THEN
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
        IF NOT EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
        ) THEN
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
        AND EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = d.league_id AND l.deleted_at IS NULL
        )
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
        IF NOT EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
        ) THEN
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
        AND EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = d.league_id AND l.deleted_at IS NULL
        )
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
        IF NOT EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
        ) THEN
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
        AND EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = d.league_id AND l.deleted_at IS NULL
        )
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
        IF NOT EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
        ) THEN
          CONTINUE;
        END IF;

        -- 092/AP.1: read ONLY to print the award refusal's reserve term
        -- below, through the ONE authority (D198(1)). The system-nomination
        -- path reads its own floor inside draft_system_nominate_internal.
        v_reserve := public.draft_auction_reserve(v_draft.config);

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
          -- NO GRACE, deliberately (D129(4)/§8.6.5/OQ 10): the grace
          -- contract is a NOMINATION-clock rule. Nobody auto-bids for an
          -- absent manager and nobody can be timed INTO a bid, so a stale
          -- nominator or a stale high bidder delays nothing.
          -- E26 IS STRUCTURAL, NOT A BRANCH: 085 sets high_bidder_team_id
          -- to the NOMINATOR at nomination time, so "the clock expires with
          -- no raises ⇒ the nominator wins at the opening bid" is what
          -- awarding the standing high bidder already does.
          v_win_team   := (v_draft.current_nomination->>'high_bidder_team_id')::uuid;
          v_win_player := v_draft.current_nomination->>'player_id';
          v_price      := (v_draft.current_nomination->>'high_bid')::int;
          IF v_win_team IS NULL OR v_win_player IS NULL OR v_price IS NULL THEN
            RAISE EXCEPTION
              'draft_tick: auction % has a malformed current_nomination (%) — refusing to award',
              v_draft.id, v_draft.current_nomination;
          END IF;

          -- ATTRIBUTION (D130's "per actor"), read off the WINNING bid row:
          -- a system-opened nomination carries action_id NULL, so an
          -- unraised one is is_auto/'autopick' and anything a human
          -- nominated or raised is 'manager'. Its absence is engine
          -- corruption and refuses the award, which is what makes F62's
          -- invariant load-bearing.
          -- WHAT MAKES THE ROW UNAMBIGUOUS — NOT "unique by construction"
          -- (R363). An earlier draft of this comment claimed the triple
          -- (nomination_seq, team, amount) could only ever match one row
          -- because a raise must exceed the high bid and 085 refuses a
          -- self-raise. **D143 refutes that**: L.C1.5's
          -- `draft_cancel_nomination` voids a nomination and DOES NOT
          -- CONSUME the sequence number, so one `nomination_seq` can carry
          -- the bid rows of two successive nominations — on two different
          -- players, at the same amount, from the same team. `player_id`
          -- is therefore in the WHERE: it is the actual discriminator, and
          -- it is a column the row already carries (083). The remaining
          -- ordering is a chronological tiebreak only — `created_at DESC`
          -- prefers the live nomination's row because the voided one was
          -- written in an earlier transaction — and `b.id DESC` behind it
          -- decides NOTHING meaningful: `draft_bids.id` is
          -- `gen_random_uuid()` (083), so on a `created_at` tie it picks at
          -- random. That is exactly why the discriminator may not be the
          -- ordering. 035 §K pins the disambiguation with a same-second,
          -- same-(seq, team, amount) decoy on a DIFFERENT player whose id
          -- is chosen to WIN the UUID tiebreak.
          -- SETTLED BY 087/L.C1.5 (D162). D143's "open bids are voided" now
          -- HAS a representation: `draft_bids.voided_at`, stamped by the ONE
          -- void helper. `player_id` stays — it is the right discriminator
          -- for the different-player case and costs nothing — and
          -- `voided_at IS NULL` closes the case `player_id` could not: the
          -- SAME nominator renominating the SAME player at the SAME amount
          -- after a cancel, which ties every other column and left the
          -- ORDER BY carrying a correctness argument (the D161(2) rule).
          -- With both predicates the WHERE is sufficient on its own and the
          -- ordering decides nothing; it is kept only as a stable tiebreak.
          -- pgTAP 036 §G builds that state through the REAL verbs.
          SELECT b.action_id IS NULL INTO v_is_auto
          FROM public.draft_bids b
          WHERE b.draft_id = v_draft.id
            AND b.nomination_seq = v_draft.current_pick_number
            AND b.player_id = v_win_player          -- R363/D143: THE discriminator
            AND b.voided_at IS NULL                 -- D162: only LIVE bids resolve
            AND b.team_id = v_win_team
            AND b.amount = v_price
          ORDER BY b.created_at DESC, b.id DESC
          LIMIT 1;
          IF v_is_auto IS NULL THEN
            RAISE EXCEPTION
              'draft_tick: no draft_bids row backs the live high bid on auction % (nomination %, team %, $%) — refusing to award (F62)',
              v_draft.id, v_draft.current_pick_number, v_win_team, v_price;
          END IF;

          -- §8.6.8 AT THE AWARD (rule 7). Bids move no money (D131(2)); the
          -- AWARD does, so it re-reads the winner through the ONE family
          -- under the held lock. `price <= max_bid` is exactly the condition
          -- whose award leaves remaining' >= open_slots' × reserve — the
          -- algebra 085's bid clause exists to establish — so re-checking it
          -- HERE is what makes the award solvency-preserving by
          -- construction rather than by trust in an earlier validator. A
          -- violation is engine corruption (D131(4) makes commissioner
          -- budget edits refuse it) and is LOUD: no pick is written and the
          -- failure is recorded. THE REMEDY SHIPPED WITH 087 (L.C1.5),
          -- superseding D160(8)'s "no remedy exists": pause →
          -- `draft_cancel_nomination` → resume clears the standing
          -- nomination WITHOUT touching the board, and the next tick
          -- advances the rotation normally. Driven end to end, not reasoned
          -- — pgTAP 036 §E runs the whole loop on the same forged state
          -- D160(8) used. `draft_reset` is no longer the only exit.
          SELECT b.remaining, b.open_slots, b.max_bid
            INTO v_remaining, v_open, v_max_bid
          FROM public.draft_team_budget(v_draft.id, v_win_team) b;

          IF v_open < 1 THEN
            RAISE EXCEPTION
              'draft_tick: the winning team % on auction % has a complete roster — E27 says a complete roster cannot bid; refusing to award',
              v_win_team, v_draft.id;
          END IF;
          IF v_price > v_max_bid THEN
            RAISE EXCEPTION
              'draft_tick: awarding % at $% to team % on auction % would break §8.6.8 solvency (max bid $%; $% for % open spots at a $% per-slot reserve) — refusing the award',
              v_win_player, v_price, v_win_team, v_draft.id, v_max_bid,
              v_remaining, v_open, v_reserve;
          END IF;

          -- (3) WRITE — §12.4's auction shape. `round` NULL (D126: an
          -- auction has no rounds); `price` set; `picked_by`/`action_id`
          -- NULL because the CLOCK wrote this pick, not a user (ARM 2's
          -- posture) — and §12.5 carries no user column, so deriving one
          -- from league_members would misattribute the moment a seat
          -- changes hands (§7.2.1: franchises outlive managers).
          INSERT INTO public.draft_picks
            (draft_id, league_id, pick_number, round, team_id, player_id,
             price, is_auto, picked_by, made_via, action_id)
          VALUES
            (v_draft.id, v_draft.league_id, v_draft.current_pick_number,
             NULL, v_win_team, v_win_player, v_price, v_is_auto, NULL,
             CASE WHEN v_is_auto THEN 'autopick' ELSE 'manager' END, NULL);

          -- (4) ADVANCE — the rotation (§8.6.7(c)/E27), scanning from AFTER
          -- the NOMINATOR (on_clock stays the nominator through bidding —
          -- D157(2); it is the seat the rotation advances FROM) and skipping
          -- complete rosters. ONE statement through the ONE family, the
          -- CROSS JOIN LATERAL shape draft_auction_solvent itself uses, so
          -- rule 7 holds without n round trips inside the lock.
          -- RECORDED RESIDUAL (085 banner item 5's sibling): a RETIRED seat
          -- inside nomination_order would make draft_team_budget RAISE its
          -- P0002 ("not an ACTIVE franchise … outside the §8.6.8 team set",
          -- R321) and the whole award would be contained as an
          -- auction_failure. Unreachable in M3 — retirement is M4's
          -- `retire_franchise` and nomination_order is built at start from
          -- the active set — and a loud, honest raise is the right answer
          -- for a state whose correct rotation is genuinely undecided.
          v_order := v_draft.nomination_order;
          v_n := COALESCE(jsonb_array_length(v_order), 0);
          IF v_n < 1 THEN
            RAISE EXCEPTION
              'draft_tick: auction % has no nomination_order — cannot advance the rotation',
              v_draft.id;
          END IF;

          SELECT o.idx INTO v_idx
          FROM jsonb_array_elements_text(v_order)
               WITH ORDINALITY AS o(team, idx)
          WHERE o.team = v_draft.on_clock_team_id::text
          LIMIT 1;
          IF v_idx IS NULL THEN
            RAISE EXCEPTION
              'draft_tick: the nominating team % is not in auction %''s nomination_order — cannot advance the rotation',
              v_draft.on_clock_team_id, v_draft.id;
          END IF;

          v_next_team := NULL;
          v_step      := NULL;
          SELECT c.team, c.step
            INTO v_next_team, v_step
          FROM (
            SELECT (v_order->>((v_idx - 1 + s.i) % v_n))::uuid AS team,
                   s.i AS step
            FROM generate_series(1, v_n) AS s(i)
          ) c
          CROSS JOIN LATERAL public.draft_team_budget(v_draft.id, c.team) b
          WHERE b.open_slots >= 1
          ORDER BY c.step
          LIMIT 1;

          IF v_next_team IS NULL THEN
            -- COMPLETION (§8.6.6/D130): the rotation having nowhere to go IS
            -- "no team has open slots" — ONE computation, so the two can
            -- never disagree. §8.6.6's "or budgets exhausted" is unreachable
            -- by construction (solvency keeps every open slot affordable at
            -- the nomination floor); 035 §H spot-checks it on a greedy-spend board. The
            -- writer prices the rosters (D111(3)).
            PERFORM public.draft_complete_internal(v_draft.id);
            v_auc_completed := v_auc_completed + 1;
          ELSE
            UPDATE public.drafts SET
              current_nomination  = NULL,          -- back to NOMINATING
              current_pick_number = v_draft.current_pick_number + 1,
              -- the ROTATION LAP (D126 — display-only; item 3 removed its
              -- last engine consumer): +1 when the scan wrapped past the
              -- end of nomination_order.
              current_round       = COALESCE(v_draft.current_round, 1)
                                    + CASE WHEN (v_idx - 1 + v_step) >= v_n
                                           THEN 1 ELSE 0 END,
              on_clock_team_id    = v_next_team,
              current_deadline    = now() + make_interval(secs => COALESCE(
                                      (v_draft.config->>'auction_nomination_seconds')::int,
                                      30)),
              updated_at          = now()
            WHERE id = v_draft.id;
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
        AND EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = d.league_id AND l.deleted_at IS NULL
        )
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

-- Service-role/cron only (the 062-internal-helper narrowing — authenticated
-- is revoked too; the D100 harness drives it through the service role).
-- Restated after the CREATE OR REPLACE so the file shows its own posture;
-- CREATE OR REPLACE preserves ACLs, so this is belt-and-braces, not a fix.
REVOKE EXECUTE ON FUNCTION draft_tick() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 14. THE DATA MIGRATION — `auction_min_bid` leaves both stores and
--     `auction_zero_dollar_nominations` takes over its two real jobs
--     (banner item 4; D198(2); §7.3.8's removed row: stored `0` => toggle ON,
--     stored `>= 1` => toggle OFF).
--
--     TWO stores, because there are two: `leagues.settings->'draft'` is the
--     catalog a commissioner edits (and the ONLY one behind a
--     `z.strictObject`, so it is the one whose leftover key is a hard parse
--     failure), and `drafts.config` is the snapshot taken at draft create
--     (§8/D95) — not schema-validated, but a retired key sitting in it would
--     be read by the next person as live.
--
--     LOUD BEFORE LOADED (CLAUDE.md): a stored value that is not a plain
--     integer cannot be converted honestly, so it ABORTS the migration by
--     name instead of being COALESCEd into a plausible default.
--     The `>= 2` cohort is printed BY ID before conversion, because those are
--     the only leagues whose MEANING changes (a $2-$5 per-slot reserve becomes
--     $1) and the reverse of this migration cannot restore the number.
--     Idempotent: a second run matches nothing and SAYS SO.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad            TEXT;
  v_leagues_total  INTEGER := 0;
  v_leagues_on     INTEGER := 0;
  v_leagues_hi     INTEGER := 0;
  v_leagues_hi_ids TEXT;
  v_drafts_total   INTEGER := 0;
  v_drafts_on      INTEGER := 0;
  v_drafts_hi      INTEGER := 0;
  v_drafts_hi_ids  TEXT;
BEGIN
  -- (0) REFUSE TO GUESS. A non-integer stored value has no honest conversion.
  SELECT string_agg(x.what, '; ' ORDER BY x.what) INTO v_bad FROM (
    SELECT 'leagues.' || l.id::text || ' = '
           || COALESCE(l.settings->'draft'->>'auction_min_bid', 'null') AS what
    FROM public.leagues l
    WHERE l.settings->'draft' ? 'auction_min_bid'
      AND l.settings->'draft'->>'auction_min_bid' IS NOT NULL
      AND l.settings->'draft'->>'auction_min_bid' !~ '^-?[0-9]+$'
    UNION ALL
    SELECT 'drafts.' || d.id::text || ' = '
           || COALESCE(d.config->>'auction_min_bid', 'null') AS what
    FROM public.drafts d
    WHERE d.config ? 'auction_min_bid'
      AND d.config->>'auction_min_bid' IS NOT NULL
      AND d.config->>'auction_min_bid' !~ '^-?[0-9]+$'
  ) x;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '092/AP.1: refusing to retire auction_min_bid — these rows store a value that is not an integer and has no honest conversion to auction_zero_dollar_nominations: %',
      v_bad;
  END IF;

  -- (1) COUNT BEFORE, so the NOTICE reports work done rather than intent.
  --     A JSON null falls to the same default the retired code did
  --     (`COALESCE((...)::int, 1)`), i.e. reserve 1 => toggle OFF.
  SELECT count(*)::int,
         count(*) FILTER (
           WHERE COALESCE((l.settings->'draft'->>'auction_min_bid')::int, 1) = 0)::int,
         count(*) FILTER (
           WHERE COALESCE((l.settings->'draft'->>'auction_min_bid')::int, 1) >= 2)::int,
         string_agg(l.id::text || ' ($'
                    || (l.settings->'draft'->>'auction_min_bid') || ')', ', '
                    ORDER BY l.id)
           FILTER (WHERE COALESCE((l.settings->'draft'->>'auction_min_bid')::int, 1) >= 2)
    INTO v_leagues_total, v_leagues_on, v_leagues_hi, v_leagues_hi_ids
  FROM public.leagues l
  WHERE l.settings->'draft' ? 'auction_min_bid';

  SELECT count(*)::int,
         count(*) FILTER (WHERE COALESCE((d.config->>'auction_min_bid')::int, 1) = 0)::int,
         count(*) FILTER (WHERE COALESCE((d.config->>'auction_min_bid')::int, 1) >= 2)::int,
         string_agg(d.id::text || ' ($' || (d.config->>'auction_min_bid') || ')', ', '
                    ORDER BY d.id)
           FILTER (WHERE COALESCE((d.config->>'auction_min_bid')::int, 1) >= 2)
    INTO v_drafts_total, v_drafts_on, v_drafts_hi, v_drafts_hi_ids
  FROM public.drafts d
  WHERE d.config ? 'auction_min_bid';

  IF v_leagues_hi > 0 THEN
    RAISE NOTICE
      '092/AP.1: % league(s) stored auction_min_bid >= 2 — their MEANING changes (a $2-$5 per-slot reserve becomes $1; the $0-nomination toggle stays OFF). By id: %',
      v_leagues_hi, v_leagues_hi_ids;
  END IF;
  IF v_drafts_hi > 0 THEN
    RAISE NOTICE
      '092/AP.1: % draft(s) snapshot auction_min_bid >= 2 — same meaning change, and a LIVE one keeps the picks it already priced. By id: %',
      v_drafts_hi, v_drafts_hi_ids;
  END IF;

  -- (2) REWRITE. Drop the key, write the toggle. `-` removes, `||` merges.
  UPDATE public.leagues l
  SET settings = jsonb_set(
        l.settings, '{draft}',
        ((l.settings->'draft') - 'auction_min_bid')
        || jsonb_build_object(
             'auction_zero_dollar_nominations',
             COALESCE((l.settings->'draft'->>'auction_min_bid')::int, 1) = 0),
        TRUE),
      updated_at = now()
  WHERE l.settings->'draft' ? 'auction_min_bid';

  UPDATE public.drafts d
  SET config = (d.config - 'auction_min_bid')
      || jsonb_build_object(
           'auction_zero_dollar_nominations',
           COALESCE((d.config->>'auction_min_bid')::int, 1) = 0),
      updated_at = now()
  WHERE d.config ? 'auction_min_bid';

  -- (3) SAY WHAT HAPPENED — including when nothing did, which is the point.
  IF v_leagues_total = 0 AND v_drafts_total = 0 THEN
    RAISE NOTICE
      '092/AP.1: no stored auction_min_bid found in leagues.settings->draft or drafts.config — nothing to convert (this is what a re-run looks like; the retirement is idempotent).';
  ELSE
    RAISE NOTICE
      '092/AP.1: retired auction_min_bid from % league(s) (% => $0 nominations ON, % => OFF) and % draft config(s) (% ON, % OFF).',
      v_leagues_total, v_leagues_on, v_leagues_total - v_leagues_on,
      v_drafts_total, v_drafts_on, v_drafts_total - v_drafts_on;
  END IF;

  -- (4) PROVE THE REMOVAL. A row left carrying the key means the UPDATE's
  --     predicate and the count's predicate disagreed — never assume.
  IF EXISTS (SELECT 1 FROM public.leagues l WHERE l.settings->'draft' ? 'auction_min_bid')
     OR EXISTS (SELECT 1 FROM public.drafts d WHERE d.config ? 'auction_min_bid') THEN
    RAISE EXCEPTION
      '092/AP.1: auction_min_bid still present after the rewrite — refusing to report success (CLAUDE.md: never let "nothing happened" mean "it worked").';
  END IF;
END;
$$;
