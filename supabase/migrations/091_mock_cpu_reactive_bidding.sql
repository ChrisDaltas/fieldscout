-- ============================================================================
-- 091 — CPU bids are PROVOKED, not swept, and they JUMP (task AP.3; spec
-- v2.13 §8.8's new block, §8.6.3's pacing note, §8.2, §22.3, E70; D132
-- superseded as to its letter, D200; tasks-AP §4 rules 1–11 = tasks-M3 §4's
-- eight + the three AP rules). Discharges ledger row **F76**; closes **Q15**.
--
-- CHRIS'S RULING, VERBATIM (Q15, 2026-08-20 — it is the acceptance standard,
-- not a paraphrase of one):
--   "On other platforms the auto draft bots bid like normal people would so
--    if a player is valued at $40, two things can happen. 1 a bot can bid $35
--    or $40 immediately if they want, just like a real person can. They also
--    bid super fast in $1 increments, like real players do."
--   "real users typically bid in like a tenth of a second and everyone spams
--    bid until a player gets closer to the their average cost value"
-- With his targets, from real use on Sleeper at 12 teams × 16 spots: a live
-- draft under 90 minutes, a mock under 45. Ours measured 3–4 hours (F76).
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 1 — THE TWO MECHANISMS, AND WHY THE SWEEP IS NOT ONE OF THEM.
-- ---------------------------------------------------------------------------
-- (a) PROVOKED, NOT SWEPT. Before this migration a CPU raise rode the global
--     `cron.schedule('draft-tick', '5 seconds', …)` at 068:1265, so each $1
--     cost five seconds of wall clock and a $1 → $40 player took 39 raises ≈
--     3m15s of a room where nothing visibly happened. A CPU response now runs
--     **in the transaction that provoked it** — a human's bid, another CPU's
--     raise, or the nomination that opened the market — through
--     `draft_mock_cpu_respond_internal`, called from the ONE bid writer
--     (`draft_place_bid_internal`) and from BOTH nomination paths
--     (`draft_nominate`, `draft_system_nominate_internal`).
--     **THE 5-SECOND SWEEP IS NOT TOUCHED, DELIBERATELY** (§22.3 / AP.3 item
--     4): one cron entry sweeps every live draft in the system, so making it
--     faster to fix a mock-pacing problem would spend global load on a local
--     symptom. `cron.schedule` is not re-issued here; ARM 2.6(a)/(b) keep
--     owning expiry, and ARM 2.6(c1)/(c2) stay as the no-actor safety net.
--     Also NOT taken, and recorded so nobody re-proposes them as oversights
--     (tasks-AP §8 item 6): a second cron entry for mocks, `pg_net`
--     self-invocation, and any server-side `pg_sleep` (tasks-AP §4 rule 11 —
--     the clock stays server-authoritative and a "beat" is a client render
--     delay, never a transaction that waits).
--     **What "a tenth of a second" means here, precisely:** the response is
--     committed in the same transaction as the bid that caused it, so the
--     answer is on the wire in one round trip. There is no server-side delay
--     and no humanising jitter IN TIME — the humanising lives in the raise
--     amounts (mechanism (b)), which is the only place it can live without a
--     timer. The consequence — a multi-raise ladder arriving as one flush —
--     is honest and is ledger row **F86** (a client-side staggered reveal,
--     deliberately not folded in here).
-- (b) THEY JUMP. `draft_mock_cpu_raise_amount` replaces the hard-coded
--     `v_high_bid + 1` of 089's ARM 2.6(c2). THE CURVE, STATED SO A FUTURE
--     SESSION CAN TELL A DELIBERATE CHANGE FROM A DRIFT:
--
--       Let ceiling = LEAST(the CPU's computed value, its max bid) — the
--       number the candidate scan already used, and the number E62 forbids
--       it to pass. Let headroom = ceiling − high_bid (≥ 1 for a candidate).
--
--         P(jump) = headroom / ceiling        — the RELATIVE GAP, no constant
--         jump    = LEAST(high_bid + 1 + round(r × ceiling), ceiling)
--         nibble  = high_bid + 1
--
--       In one sentence: **a CPU jumps with probability equal to how far the
--       price still is from what the player is worth to it, and a jump is the
--       standing bid plus a seeded share of that worth, clamped at it;
--       otherwise it nibbles a dollar.** So a wide gap almost always jumps
--       ("a bot can bid $35 or $40 immediately"), a narrow one almost always
--       nibbles ("they also bid super fast in $1 increments"), and the taper
--       Chris described — "everyone spams bid until a player gets closer to
--       their average cost value" — is STRUCTURAL: it falls out of the gap
--       shrinking, not out of a tuned curve. **THE CURVE HAS NO TUNABLE
--       CONSTANTS**, which is the property that makes a future edit visible.
--       Pinned as stored literals in pgTAP 039 §B, the 038 §A way.
--     Both draws come from the SAME D93 24-bit construction the value model
--     already uses, now extracted into `draft_mock_unit_random` and read by
--     both — **a second PRNG would be a review finding** (D200(4)), so the
--     generator was moved rather than copied, and 038 §A's stored literals
--     over `draft_mock_cpu_bid_value` are the proof the move changed no
--     value. Seeded on (draft, nomination_seq, team, pass = the live bid
--     count) with a per-stream tag, so a mock replays identically — the sim,
--     the property test and every golden depend on that.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 2 — WHAT IS NOT CHANGED (the scope guard).
-- ---------------------------------------------------------------------------
--   * **D128's clock semantics.** A bid inside the anti-snipe window still
--     floors the deadline to now() + anti_snipe; above it the clock is
--     untouched. This task changes WHO bids WHEN, never what a bid does to
--     the clock. Every raise in a ladder runs the identical INSERT + UPDATE.
--   * **E27/E62.** A CPU still cannot bid past `LEAST(value, max_bid)` nor
--     with a complete roster: the candidate scan's predicate is 089's
--     verbatim, and every raise still goes through `draft_place_bid_internal`
--     — the same self-raise / E27 / raise-floor / E5 clauses a human meets.
--     The `LEAST(…, p_ceiling)` clamp in the raise curve is the load-bearing
--     one and is the break-probe target.
--   * **§8.8 isolation.** No `league_rosters`, no `transactions`, no league
--     status transition, no notification: nothing in this migration writes
--     outside the mock's own `draft_id`. 038 §F's whole-row composite is
--     re-run unchanged.
--   * **D138 / D110(1).** CPU behaviour is mock runtime and never a
--     commissioner affordance — no new setting, no new control, no new
--     column. `draft_mock_cpu_respond_internal` is REVOKEd from every client
--     role, exactly as 089's two internals are.
--   * **§22.5 / F41.** Reactive responses do not increase the number of
--     CLIENT requests — a human's one bid is still one request. They increase
--     the work inside one transaction, which is what the §4.6 held-lock
--     budget governs and what AP.3's DoD measures.
--   * The value model, the need weights, the think-time function, the
--     nomination brain, the award, the rotation and completion: untouched.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 3 — BOUNDED, AND BOUNDED LOUDLY (D200(3)).
-- ---------------------------------------------------------------------------
-- The responder writes the whole ladder inside one transaction, so it needs a
-- ceiling, and a `RAISE EXCEPTION` — never a silent `EXIT` — if it is ever
-- reached (CLAUDE.md: never let "nothing happened" mean "it worked").
--
-- **THE BOUND IS `GREATEST(2 × team_count, auction_budget)`, NOT D200(3)'s
-- `2 × team_count`, AND THE CHANGE WAS FORCED BY A MEASUREMENT.** D200(3)
-- fixed the number on the premise that "in practice jump-bids make the real
-- ladder a handful of steps", and on the shipped DEFAULT shape that is true:
-- a full 12-team × 15-slot × $200 mock measured a LONGEST ladder of **13
-- raises against a bound of 200**. It is NOT true one shape over. On an
-- 8-team × 2-slot × $200 board — a **legal** league in every clause
-- (`team_count` 8 is in §7.2's 8/10/12/14/16; `startingSum ≥ 1` and
-- `bench ≥ 0` at league-settings.ts:444) — every franchise can afford ~$199
-- for one player, so the price grinds up a dollar at a time through the seven
-- CPU seats. **Measured, 120 ladders swept over openings and seeds on that
-- board: mean 8.8 rungs, MAX 34, and 16 of 120 (13%) past `2 × team_count`
-- = 16.** pgTAP 039 §C5 pins one such grind as a stored literal (24 raises
-- from a $175 open) and reddens with "passed its bound of 16 raises" the
-- moment D200(3)'s number is reinstalled. **That is not a defect: it is exactly the texture
-- Chris asked for** ("everyone spams bid until a player gets closer to their
-- average cost value"), and `2 × team_count` fires on it with a diagnosis
-- ("the value model is wrong") that would be FALSE. A tripwire that trips on
-- correct behaviour and then lies about why is worse than no tripwire.
--
-- The bound used instead is STRUCTURAL: every rung raises by at least $1, no
-- rung exceeds its bidder's max bid, and no max bid exceeds the league's
-- budget, so a legitimate ladder can never have more rungs than a franchise
-- has dollars. `2 × team_count` is kept as the FLOOR (it is the larger of the
-- two in a tiny-budget league). D200(3)'s intent — bound it, and fail loudly
-- when the bound means something is genuinely wrong — is preserved exactly;
-- what changes is that the exception now only ever fires on something that
-- cannot legally happen, which is what makes it worth raising.
--
-- **Deviation from D200(3)'s described mechanism, stated rather than buried:**
-- D200(3) anticipated the responder RECURSING through
-- `draft_place_bid_internal`. It LOOPS instead. Both write the same ladder in
-- the same transaction with the same cap and the same loud failure; the loop
-- keeps the counter in one place and bounds the call stack, whereas recursion
-- would need an out-of-band depth counter to enforce a per-transaction cap at
-- all. What the loop costs is one transaction-local re-entrancy flag
-- (`fieldscout.mock_cpu_responding`, `set_config(..., is_local => TRUE)` — so
-- it is rolled back with the (sub)transaction and a trapped failure inside
-- ARM 2.6(c) cannot leave it stuck on), because the responder's own writes
-- come back through the bid writer's reactive arm.
--
-- **Failure containment, deliberately asymmetric:** inside `draft_tick` the
-- existing ARM 2.6(c) handler traps a responder failure per draft and records
-- it in `auction_cpu_failures` (089's contract, unchanged). On the HUMAN path
-- a responder failure propagates and rolls the human's own bid back. That is
-- the intended posture: a mock is practice, and a bot bug that silently ate
-- itself while the room carried on is the exact "nothing happened" failure
-- CLAUDE.md names. Loud beats plausible.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 4 — WHAT THIS FILE CONTAINS.
-- ---------------------------------------------------------------------------
--   NEW:
--     1. `draft_mock_unit_random(TEXT) → NUMERIC` — the D93 24-bit generator,
--        EXTRACTED verbatim from `draft_mock_cpu_bid_value`'s noise term.
--        IMMUTABLE STRICT, broad EXECUTE (pure math over an argument — the
--        `draft_mock_think_fraction` precedent).
--     2. `draft_mock_cpu_raise_amount(...) → INTEGER` — the curve of banner
--        item 1(b). IMMUTABLE STRICT, broad EXECUTE.
--     3. `draft_mock_cpu_respond_internal(UUID) → INTEGER` — the ONE CPU
--        responder (089's ARM 2.6(c2) candidate scan + raise, extracted and
--        then extended), returning the number of raises written. Plain
--        function, `search_path = ''`, REVOKEd from PUBLIC/anon/authenticated
--        — 086's internal form, exactly as 089's two internals.
--   REPLACED (D137 head rule — each body EXTRACTED from the current FILE TEXT
--   of the newest migration that defines it, never `pg_get_functiondef`; the
--   head set was resolved at task time with
--   `grep -ln 'FUNCTION <name>(' supabase/migrations/*.sql`):
--     * `draft_mock_cpu_bid_value`      ← 089:329–360   (its only definition)
--     * `draft_place_bid_internal`      ← 089:512–643   (its only definition)
--     * `draft_system_nominate_internal`← 089:658–749   (its only definition)
--     * `draft_nominate`                ← 089:1062–1299 (089 replaced 085's)
--     * `draft_tick`                    ← 089:1511–2758 (068 → 086 → 087 →
--        089 each re-emitted the whole body; **090 did NOT** — it replaces
--        five commissioner bodies and the pause gate only — so 089 is the
--        head. Confirmed by grep at task time.)
--   Per-function `diff -u` hunk counts (the L.C1.5 recipe — body extracted
--   CREATE → `$$;`, edited, diffed at standard context, `@@` counted), and
--   RE-DERIVED after every fix cycle in this session:
--     draft_mock_cpu_bid_value        1 hunk  (+10/−5)   the noise term
--     draft_place_bid_internal        1 hunk  (+25/−0)   the reactive arm
--     draft_system_nominate_internal  1 hunk  (+9/−0)    the reactive arm
--     draft_nominate                  1 hunk  (+11/−0)   the reactive arm
--     draft_tick                      4 hunks (+41/−84)  declares · the ARM
--       2.6(c) doc block's bidding half · the (c2) head · the (c2) body
--       (the inline value inputs + candidate scan + `+$1` raise become one
--       call into the responder)
--   Everything outside those hunks is byte-identical to 089.
--   NOT replaced: `draft_place_bid` (its tail already delegates to the
--   internal — the reactive arm is inherited for free, which is the reason
--   the arm went to the WRITER and not to three callers),
--   `draft_mock_auction_cpu_due`, `draft_mock_cpu_need`, `draft_team_budget`,
--   `draft_autopick_resolve`, `draft_complete_internal`, the 088 broadcast
--   surface, every commissioner control (069/087/090).
--   No signature changes ⇒ every replacement is `CREATE OR REPLACE`.
--
-- Grants doctrine (D18→D23 / tasks-M1 §4.1): no per-object GRANTs. The
-- replaced RPCs keep their posture (SECURITY DEFINER + `SET search_path = ''`
-- + in-body auth + REVOKE FROM PUBLIC, anon — restated after each CREATE OR
-- REPLACE, belt-and-braces, 089/090's own form). The new internal follows
-- 086's internal form; the two new pure helpers keep broad EXECUTE (the
-- `draft_mock_think_fraction` / `draft_mock_cpu_bid_value` precedent — pure
-- math over arguments, exposing nothing a member cannot already compute).
--
-- SQLSTATE convention (062/063 verbatim): 42501 auth + no-leak · P0002 → 404
-- · P0001 friendly refusal · 22023 argument shape. The responder's cap breach
-- is an INTERNAL invariant failure, not a user-facing refusal, so it raises
-- with the default SQLSTATE like 089's malformed-nomination guard does.
--
-- Migration checklist (delivery plan §8.1 / tasks-M3 §4.4): NO DDL — no
-- table, no column, no policy, no index, no signature change; three new
-- functions and five CREATE OR REPLACEs · rollback = re-apply 089's five
-- bodies and drop the three new functions (the extracted originals are the
-- rollback text) · staging rehearsal: **R6 waiver** — no staging clone exists
-- (environments are local + prod only); the recorded rehearsal is the fresh
-- local `npx supabase db reset` replay of the full 001–091 chain in this PR,
-- plus pgTAP 038 + 039 · **D38 waiver**: no data backfill (functions only, no
-- DDL) · F12 note: prod's migration history still ends pre-league-schema;
-- this lands with the next normal push · typegen: three new functions change
-- the PostgREST-visible surface ⇒ `src/types/database.ts` RE-GENERATED
-- (`--local`) with the hand-written alias block preserved and re-appended
-- BYTE-IDENTICAL and the diff verified additive-only (§4.4).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. draft_mock_unit_random — THE ONE pseudo-random generator for mock CPU
--    behaviour (banner item 1(b); D93's 24-bit construction, D200(4)).
--    EXTRACTED verbatim from draft_mock_cpu_bid_value's noise term
--    (089:346–350) because a second consumer appeared — the raise curve — and
--    a second PRNG is a review finding. The arithmetic is unchanged to the
--    character: '00' || 6 hex ⇒ provably non-negative bit(32) ⇒ /2^24 ⇒
--    a NUMERIC in [0, 1). Callers give it a seed STRING and tag their own
--    stream ('nibble:' / 'jump:'), so two decisions seeded on the same
--    (draft, seq, team, pass) tuple are independent draws rather than the
--    same number wearing two hats.
--    Pure over its argument — IMMUTABLE STRICT, broad EXECUTE (the
--    draft_mock_think_fraction precedent); stored-literal-pinned in 039 §A.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_mock_unit_random(p_seed TEXT)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE STRICT
SET search_path = ''
AS $$
  SELECT ('x' || '00' || left(md5(p_seed), 6))::bit(32)::int / 16777216.0;
$$;


-- ---------------------------------------------------------------------------
-- 1b. draft_mock_cpu_bid_value — REPLACED FROM 089:329–360 (D137 head rule;
--     its only definition). ONE hunk: the inline D93 noise expression becomes
--     a call to the extracted generator above. **The arithmetic is unchanged
--     and 038 §A's stored literals are the proof** — a NUMERIC division by
--     16777216.0 either side, the same seed string, the same × 0.30 − 0.15.
--     LANGUAGE sql IMMUTABLE STRICT is preserved (an IMMUTABLE function may
--     call an IMMUTABLE function).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_mock_cpu_bid_value(
  p_draft_id UUID,
  p_nomination_seq INTEGER,
  p_team_id UUID,
  p_pass INTEGER,
  p_adp_rank INTEGER,
  p_budget INTEGER,
  p_slots INTEGER,
  p_teams INTEGER,
  p_need NUMERIC
) RETURNS INTEGER
LANGUAGE sql IMMUTABLE STRICT
SET search_path = ''
AS $$
  WITH k AS (
    SELECT GREATEST(p_slots, 1) * GREATEST(p_teams, 1) AS n,
           -- the D93 24-bit construction, unchanged in arithmetic and now
           -- read through the ONE generator (091/AP.3 — D200(4): the raise
           -- curve needs the same stream, and a second PRNG is a review
           -- finding, so the expression was EXTRACTED verbatim into
           -- draft_mock_unit_random rather than copied). /2^24 ⇒ [0, 1);
           -- ×0.30 − 0.15 ⇒ ±15%. 038 §A's stored literals are the proof
           -- that this move changed no value.
           public.draft_mock_unit_random(
             p_draft_id::text || ':' || p_nomination_seq::text
             || ':' || p_team_id::text || ':' || p_pass::text) * 0.30 - 0.15 AS noise
  )
  SELECT CASE
           WHEN p_adp_rank < 1 OR p_adp_rank > k.n OR p_slots < 1 OR p_budget < 1 THEN 0
           ELSE GREATEST(0, floor(
                  (4.0 * p_budget / p_slots)
                  * power(1 - (p_adp_rank - 1)::numeric / k.n, 3)
                  * p_need
                  * (1 + k.noise)))::int
         END
  FROM k;
$$;
-- ---------------------------------------------------------------------------
-- 2. draft_mock_cpu_raise_amount — HOW MUCH a CPU raises (banner item 1(b);
--    spec v2.13 §8.8 "jump-bids within value"; D200(4); Q15's ruling).
--
--    THE RULE, in one sentence: a CPU jumps with probability equal to how far
--    the price still is from what the player is worth to it, and a jump is
--    the standing bid plus a seeded share of that worth, clamped at it;
--    otherwise it nibbles a dollar.
--
--      headroom := ceiling − high_bid                    (≥ 1 for a candidate)
--      P(jump)  := headroom / ceiling                    (the RELATIVE GAP)
--      jump     := LEAST(high_bid + 1 + round(r × ceiling), ceiling)
--      nibble   := high_bid + 1
--
--    Both textures Chris named are required and both are here: the jump is
--    "a bot can bid $35 or $40 immediately if they want", the nibble is "they
--    also bid super fast in $1 increments". The TAPER he described — "everyone
--    spams bid until a player gets closer to their average cost value" — is
--    STRUCTURAL rather than tuned: as the price approaches value the gap
--    shrinks, so the jump probability falls to nearly zero on its own and the
--    ladder ends in $1 spam. **There is no tunable constant in this function**
--    — that is the property that makes a future edit to the behaviour visible
--    as a deliberate change rather than a drift, and 039 §B pins the answers
--    as stored literals so the edit cannot be silent.
--
--    p_ceiling is LEAST(the CPU's computed value, its max bid) — the number
--    the candidate scan already used and the number E62 forbids a CPU to
--    exceed. **The LEAST(…, p_ceiling) clamp is load-bearing**: without it the
--    jump can propose more than the player is worth, which is precisely the
--    AP.3 break probe. headroom ≤ 1 short-circuits to high + headroom (so
--    headroom = 1 ⇒ the only legal raise, and headroom = 0 ⇒ high itself,
--    which draft_place_bid_internal refuses LOUDLY — a candidate with no
--    headroom is a bug in the scan, not a bid).
--
--    Deterministic per (draft, nomination_seq, team, pass): the same seed
--    replays the same ladder, which the sim, the property test and every
--    golden depend on. Pure over arguments — IMMUTABLE STRICT, broad EXECUTE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_mock_cpu_raise_amount(
  p_draft_id UUID,
  p_nomination_seq INTEGER,
  p_team_id UUID,
  p_pass INTEGER,
  p_high_bid INTEGER,
  p_ceiling INTEGER
) RETURNS INTEGER
LANGUAGE sql IMMUTABLE STRICT
SET search_path = ''
AS $$
  WITH k AS (
    SELECT GREATEST(p_ceiling - p_high_bid, 0) AS headroom,
           p_draft_id::text || ':' || p_nomination_seq::text || ':'
             || p_team_id::text || ':' || p_pass::text AS seed
  )
  SELECT CASE
           WHEN k.headroom <= 1 THEN p_high_bid + k.headroom
           WHEN public.draft_mock_unit_random('nibble:' || k.seed) * p_ceiling
                  >= k.headroom
             THEN p_high_bid + 1
           ELSE LEAST(
                  p_high_bid + 1
                    + round(public.draft_mock_unit_random('jump:' || k.seed)
                            * p_ceiling)::int,
                  p_ceiling)
         END
  FROM k;
$$;

-- ---------------------------------------------------------------------------
-- 3. draft_mock_cpu_respond_internal — THE ONE CPU responder (banner items
--    1(a) and 3; D200(1)(2)(3)). 089's ARM 2.6(c2) candidate scan and raise,
--    EXTRACTED (a second consumer appeared — the reactive path — which is the
--    same reason 089 extracted draft_system_nominate_internal and
--    draft_place_bid_internal) and then extended with the jump curve and the
--    ladder.
--
--    CALLER CONTRACT: the drafts row is held FOR UPDATE and the caller has
--    just written a bid or opened a nomination. The preconditions are
--    re-verified here and a miss RETURNS 0 rather than raising, because the
--    caller is the ONE bid writer, which also serves real drafts and can be
--    reached on a mock whose market closed inside the same transaction.
--
--    THE LADDER: each pass re-reads the draft (the previous raise moved the
--    high bid), scans for the highest-value CPU that can still beat the price,
--    and writes ONE raise through draft_place_bid_internal — the same
--    validator and the same D128 anti-snipe floor a human's bid runs. It stops
--    when nobody can answer. Bounded at GREATEST(2 × team_count,
--    auction_budget) with a LOUD failure (banner item 3 — the bound is
--    STRUCTURAL, and D200(3)'s narrower number is only its floor).
--
--    Returns the number of raises written; 0 = every CPU folded at this price.
--    Plain function (NOT definer) + search_path = '' + REVOKE from every
--    client role — 086's internal form, as 089's two internals.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_mock_cpu_respond_internal(p_draft_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_draft        public.drafts;
  v_raises       INTEGER := 0;
  v_cap          INTEGER;
  v_bid_count    INTEGER;
  v_high_bid     INTEGER;
  v_high_team    UUID;
  v_win_player   TEXT;
  v_adp          NUMERIC;
  v_rank         INTEGER;
  v_budget       INTEGER;
  v_slots        INTEGER;
  v_teams        INTEGER;
  v_cand_team    UUID;
  v_cand_ceiling INTEGER;
  v_amount       INTEGER;
BEGIN
  -- Re-entrancy: the raises this function writes come back through
  -- draft_place_bid_internal's reactive arm, and the LADDER is this loop.
  -- A nested responder would double-count and escape this call's cap.
  IF COALESCE(current_setting('fieldscout.mock_cpu_responding', TRUE), 'off')
     = 'on' THEN
    RETURN 0;
  END IF;

  SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  IF NOT FOUND
     OR v_draft.status <> 'live'
     OR NOT v_draft.is_mock
     OR v_draft.draft_type <> 'auction'
     OR v_draft.current_nomination IS NULL THEN
    RETURN 0;
  END IF;

  -- D200(3)'s ceiling, WIDENED to a bound a legitimate ladder cannot reach —
  -- see banner item 3 for the measurement that forced the change. The
  -- structural bound is MONEY: every rung raises by at least $1, no rung
  -- exceeds its bidder's max bid, and no max bid exceeds the league's budget,
  -- so a ladder can never have more rungs than there are dollars in a
  -- franchise's purse. `2 × team_count` stays as the FLOOR (D200(3)'s number,
  -- which is the larger of the two in a tiny-budget league).
  v_cap := GREATEST(
             2 * GREATEST(COALESCE(jsonb_array_length(v_draft.nomination_order), 0), 1),
             COALESCE((v_draft.config->>'auction_budget')::int, 200));

  PERFORM set_config('fieldscout.mock_cpu_responding', 'on', TRUE);

  LOOP
    SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
    -- The market can close inside this transaction (a cancelled nomination;
    -- §8.6.9's instant award when AP.2 lands) — then there is nothing to
    -- answer and the ladder is over.
    EXIT WHEN v_draft.current_nomination IS NULL OR v_draft.status <> 'live';

    v_win_player := v_draft.current_nomination->>'player_id';
    v_high_bid   := COALESCE((v_draft.current_nomination->>'high_bid')::int, 0);
    v_high_team  := (v_draft.current_nomination->>'high_bidder_team_id')::uuid;
    IF v_win_player IS NULL OR v_high_team IS NULL THEN
      RAISE EXCEPTION
        'draft_mock_cpu_respond_internal: mock auction % has a malformed current_nomination (%) — refusing to bid',
        v_draft.id, v_draft.current_nomination;
    END IF;

    -- 'pass' = the LIVE bid count on this nomination (D130/D162: the
    -- player-matched, un-voided rows — history-derived, so the decision is
    -- reproducible from the rows alone, and it advances by one per raise so
    -- every rung of the ladder draws a fresh seed).
    SELECT count(*)::int INTO v_bid_count
    FROM public.draft_bids b
    WHERE b.draft_id = v_draft.id
      AND b.nomination_seq = v_draft.current_pick_number
      AND b.player_id = v_win_player
      AND b.voided_at IS NULL;

    -- The value model's shared inputs (089 banner item 5(b)): the nominated
    -- player's ADP RANK over the whole pool (NULL ADP ⇒ rank N + 1 ⇒ value 0
    -- — nobody raises on an unranked player), the snapshotted budget, the D91
    -- slot count, the room size.
    v_budget := COALESCE((v_draft.config->>'auction_budget')::int, 200);
    v_slots  := COALESCE(v_draft.total_rounds, 0);
    v_teams  := COALESCE(jsonb_array_length(v_draft.nomination_order), 0);
    SELECT pl.adp INTO v_adp FROM public.players pl WHERE pl.id = v_win_player;
    IF v_adp IS NULL THEN
      v_rank := GREATEST(v_slots, 1) * GREATEST(v_teams, 1) + 1;
    ELSE
      SELECT count(*)::int + 1 INTO v_rank
      FROM public.players pl
      WHERE pl.adp IS NOT NULL
        AND (pl.adp < v_adp OR (pl.adp = v_adp AND pl.id < v_win_player));
    END IF;

    -- The candidate — 089's scan, verbatim in predicate: every CPU seat in
    -- nomination order that is not the human, not the standing high bidder,
    -- holds an open slot (E27 — through the ONE family), and whose high + 1
    -- fits under LEAST(value, max_bid); the HIGHEST value raises, ties by
    -- position. ONE statement through the CROSS JOIN LATERAL shape the
    -- rotation scan and draft_auction_solvent use (rule 7, no n round trips
    -- inside the lock). 091 adds ONE output — that same LEAST(...) as the
    -- raise curve's ceiling, so the amount can never disagree with the
    -- predicate that admitted the candidate.
    v_cand_team    := NULL;
    v_cand_ceiling := NULL;
    SELECT c.team, LEAST(c.value, b.max_bid)
      INTO v_cand_team, v_cand_ceiling
    FROM (
      SELECT (o.team)::uuid AS team, o.idx,
             public.draft_mock_cpu_bid_value(
               v_draft.id, v_draft.current_pick_number, (o.team)::uuid,
               v_bid_count, v_rank, v_budget, v_slots, v_teams,
               public.draft_mock_cpu_need(v_draft.id, (o.team)::uuid, v_win_player)
             ) AS value
      FROM jsonb_array_elements_text(v_draft.nomination_order)
           WITH ORDINALITY AS o(team, idx)
      WHERE o.team IS DISTINCT FROM v_draft.config->'mock'->>'human_team_id'
        AND (o.team)::uuid IS DISTINCT FROM v_high_team
    ) c
    CROSS JOIN LATERAL public.draft_team_budget(v_draft.id, c.team) b
    WHERE b.open_slots >= 1
      AND v_high_bid + 1 <= LEAST(c.value, b.max_bid)
    ORDER BY c.value DESC, c.idx
    LIMIT 1;

    -- Every CPU folds at this price: nothing written, the clock runs on, the
    -- human (or the buzzer) decides. This is how a ladder ENDS.
    EXIT WHEN v_cand_team IS NULL;

    -- HOW MUCH (091 — the jump curve; §8.8's "jump-bids within value").
    v_amount := public.draft_mock_cpu_raise_amount(
      v_draft.id, v_draft.current_pick_number, v_cand_team, v_bid_count,
      v_high_bid, v_cand_ceiling);

    -- THE ONE BID VALIDATOR + WRITER (089 banner item 3): the same self-raise
    -- / E27 / raise-floor / E5 max-bid clauses and the same D128 anti-snipe
    -- floor a human's bid passes through. action_id NULL — a system row
    -- (D130's actor matrix: a CPU's win awards as is_auto/'autopick').
    -- THE LABEL CHANGES, and it is the only shipped string this task moves:
    -- 089 passed 'draft_tick' because the tick was the only thing that could
    -- raise. It no longer is — a response belongs to whichever transaction
    -- provoked it — so the label names the ACTOR ('draft_mock_cpu') instead
    -- of a caller it may not have. p_label only ever prefixes a REFUSAL, and
    -- a CPU refusal is a bug report, never user-facing copy; the two pgTAP
    -- assertions that pin one (038 §E, 039 §C4) move with it.
    PERFORM public.draft_place_bid_internal(
      v_draft.id, v_cand_team, v_amount, NULL, 'draft_mock_cpu');
    v_raises := v_raises + 1;

    -- LOUD, never a silent EXIT (D200(3)). Reaching this line is IMPOSSIBLE
    -- for a well-formed ladder — every rung is strictly higher than the last
    -- and no rung exceeds the budget — so the message names what a breach
    -- actually implies rather than guessing: a raise that did not raise, a
    -- scan that admitted the standing high bidder, or a max bid above the
    -- league's budget (a commissioner adjustment can do that, §8.7).
    IF v_raises >= v_cap THEN
      RAISE EXCEPTION
        'draft_mock_cpu_respond_internal: the CPU ladder on draft % passed its bound of % raises in one transaction (player %, last amount $%) — a ladder cannot legally be this long, so the raise curve, the candidate scan or a franchise''s budget is wrong',
        v_draft.id, v_cap, v_win_player, v_amount;
    END IF;
  END LOOP;

  PERFORM set_config('fieldscout.mock_cpu_responding', 'off', TRUE);
  RETURN v_raises;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_mock_cpu_respond_internal(UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. draft_place_bid_internal — REPLACED FROM 089:512–643 (D137 head rule;
--    its only definition). ONE hunk: the reactive CPU arm before the RETURN
--    (banner item 1(a)). Every validation clause, every refusal string and
--    the D128 anti-snipe block are byte-identical to 089 — this task changes
--    who bids when, never what a bid does. Signature unchanged ⇒ CREATE OR
--    REPLACE; the REVOKE is restated so the file reads complete on its own.
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
  v_min_bid       INTEGER;
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
  v_min_bid   := COALESCE((v_draft.config->>'auction_min_bid')::int, 1);  -- §7.3.8 default; used by the E5 message

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
  -- high + 1, at every min_bid including 0 (C38/C40 — a $0 opening is
  -- raised to $1, not to $0).
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
      '%: $% is over your max bid of $% — you have $% for % open roster spots at a $% minimum bid (§8.6.1/E5)',
      p_label, p_amount, v_max_bid, v_remaining, v_open, v_min_bid
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
-- 6. draft_system_nominate_internal — REPLACED FROM 089:658–749 (D137 head
--    rule; its only definition). ONE hunk: the reactive CPU response after
--    the market opens, so BOTH consumers — the §8.6.2 nomination timeout and
--    the CPU's own think-time nomination — provoke the bidders in the same
--    transaction. Signature unchanged ⇒ CREATE OR REPLACE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_system_nominate_internal(p_draft_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_draft     public.drafts;
  v_min_bid   INTEGER;
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

  v_min_bid := COALESCE((v_draft.config->>'auction_min_bid')::int, 1);

  -- §8.6.8 through the ONE derivation family (rule 7 — no path
  -- computes budgets independently). Both arms are unreachable on a
  -- sound board (the rotation skip guarantees the first; solvency
  -- implies the second, since remaining >= open × min_bid gives
  -- max_bid = remaining − (open − 1) × min_bid >= min_bid), so both
  -- are LOUD rather than silently skipped.
  SELECT b.remaining, b.open_slots, b.max_bid
    INTO v_remaining, v_open, v_max_bid
  FROM public.draft_team_budget(v_draft.id, v_draft.on_clock_team_id) b;

  IF v_open < 1 THEN
    RAISE EXCEPTION
      'draft_tick: the nominating team % in auction % has a complete roster — the §8.6.7(c) rotation skip is broken',
      v_draft.on_clock_team_id, v_draft.id;
  END IF;
  IF v_max_bid < v_min_bid THEN
    RAISE EXCEPTION
      'draft_tick: the nominating team % in auction % cannot afford the $% minimum opening bid (max bid $%; $% for % open spots) — §8.6.8 solvency is broken',
      v_draft.on_clock_team_id, v_draft.id, v_min_bid, v_max_bid,
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
     v_player, v_draft.on_clock_team_id, v_min_bid, NULL);

  -- Open the BIDDING phase (D126). current_pick_number is NOT
  -- advanced — it IS this nomination's sequence number until the
  -- award (D157(2)) — and on_clock stays the NOMINATOR.
  UPDATE public.drafts SET
    current_nomination = jsonb_build_object(
                           'player_id', v_player,
                           'high_bid', v_min_bid,
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
-- 7. draft_nominate — REPLACED FROM 089:1062–1299 (D137 head rule; 089
--    replaced 085's). ONE hunk: the reactive CPU response after the market
--    opens, plus the re-read that keeps the returned draft the authoritative
--    post-ladder state. Every auth, mock-launcher, availability, budget and
--    floor clause is byte-identical to 089. Signature unchanged ⇒ CREATE OR
--    REPLACE.
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
  v_min_bid       INTEGER;
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

  v_min_bid     := COALESCE((v_draft.config->>'auction_min_bid')::int, 1);
  v_bid_seconds := COALESCE((v_draft.config->>'auction_bid_seconds')::int, 20);

  IF p_opening_bid < v_min_bid THEN
    RAISE EXCEPTION
      'draft_nominate: an opening bid of $% is below this league''s $% minimum bid (§7.3.8)',
      p_opening_bid, v_min_bid
      USING ERRCODE = 'P0001';
  END IF;

  -- §8.6.7(a): the nominator must be able to afford their own opening bid
  -- — which is what makes §8.6.7(b)'s no-raise award (E26) always legal.
  -- The message names the formula's number AND the money behind it.
  IF p_opening_bid > v_max_bid THEN
    RAISE EXCEPTION
      'draft_nominate: an opening bid of $% is over your max bid of $% — you have $% for % open roster spots at a $% minimum bid (§8.6.7(a))',
      p_opening_bid, v_max_bid, v_remaining, v_open, v_min_bid
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
-- 8. draft_tick — REPLACED FROM 089:1511–2758 (D137 head rule; 068 → 086 →
--    087 → 089 each re-emitted the whole body and 090 did NOT, so 089 is the
--    head — confirmed by grep at task time). FOUR hunks, all inside ARM
--    2.6(c): the declares this arm no longer needs, the arm's doc block, and
--    the (c2) body, which becomes ONE call into the responder. ARMs 1 / 1.5 /
--    1.6 / 2 / 2.5 / 2.6(a) / 2.6(b) / 3 are byte-identical, and
--    `cron.schedule('draft-tick', '5 seconds', …)` is NOT re-issued anywhere
--    in this file — the global sweep keeps its cadence (§22.3, banner item
--    1(a)). Signature unchanged ⇒ CREATE OR REPLACE; the whole body is
--    re-emitted because that is the D137 vehicle.
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
  v_min_bid        INTEGER;
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
  --     min_bid — D129(2); a CPU seat resolves as a no-user seat: ADP +
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

        v_min_bid := COALESCE((v_draft.config->>'auction_min_bid')::int, 1);

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
          -- the on-clock team's OWN resolve chain at auction_min_bid
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
          -- whose award leaves remaining' >= open_slots' × min_bid — the
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
              'draft_tick: awarding % at $% to team % on auction % would break §8.6.8 solvency (max bid $%; $% for % open spots at a $% minimum bid) — refusing the award',
              v_win_player, v_price, v_win_team, v_draft.id, v_max_bid,
              v_remaining, v_open, v_min_bid;
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
            -- min_bid); 035 §H spot-checks it on a greedy-spend board. The
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
