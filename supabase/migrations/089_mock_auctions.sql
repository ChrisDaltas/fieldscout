-- ============================================================================
-- Mock auctions + CPU bidders — migration 089 (task L.C1.7; spec §8.8
-- (Mock Draft Mode — "auction bots bid value-based (ADP-derived values ±
-- noise) and pass the same max-bid/solvency validator as humans"; zero
-- side effects; the CPU speed toggle; "Same engine, literally"), §8.6 (the
-- auction flow the mock runs unchanged), §8.6.7(c)/E27, §8.6.8 (solvency),
-- §22.5 (caps — unchanged), §16.5.2 (the mock workflow row), E59/E60/E62;
-- tasks-M3 §4 standing rules (rule 6 lock discipline, rule 7 solvency
-- doctrine, rule 8 bid-path discipline), D103/D110 (the M2 mock rules, all
-- of which carry), D128 (the bid clock — CPU bids obey it, anti-snipe
-- included), D129(2)(3)(4), D130 (the actor matrix — a CPU bid row carries
-- `action_id` NULL, so a CPU's win awards as `is_auto`/'autopick' and the
-- launcher's as 'manager'), D132 (CPU bidders: tick-driven, value-based,
-- SAME validators), D137 (the head rule), D138 (every M2 mock rule
-- carries; the launcher is the only legal human nominator/bidder), D146
-- (one-unit pins). pgTAP file is **038** (037 = realtime; next free
-- confirmed at task time). Discharges ledger row **F61**.
--
-- WHAT THIS MIGRATION DOES (the L.C1.7 banner, item by item):
--   1. `create_mock_draft` — 071's auction REFUSAL ("mock auctions land with
--      the auction engine in M3") becomes the auction LAUNCH ARM: the real
--      §7.3.8 config is snapshotted as before (budget, min bid, the three
--      auction clocks, anti-snipe — D95: a mock never re-hydrates), the
--      `nomination_order` is resolved through 084's ONE implementation
--      (`draft_nomination_order_internal` — same_as_draft_order / random /
--      manual, exactly the rules `draft_start` applies, with the real
--      scheduled draft's stored nomination order as the candidate and the
--      MOCK's own id as the seed), the human takes their chosen seat,
--      `status='live'`, `on_clock_team_id = nomination_order[0]` (the first
--      NOMINATOR — D126), `current_nomination` NULL (NOMINATING phase),
--      the first nomination deadline = `auction_nomination_seconds` (an
--      untimed `pick_timer_seconds = 0` does NOT null an auction clock —
--      084's item 3(c), mirrored), `budget_adjustments` '{}' (the column
--      default — a mock has no commissioner to adjust anything). The
--      §8.6.8 start-time backstop is mirrored too (084 banner item 4): a
--      settings-insolvent league cannot practice what it cannot start.
--      Caps / the advisory-lock serializer / `launched_by` / the E2
--      `action_id` replay (D110(6)(11)) are UNTOUCHED. tests/025:400's
--      refusal assertion FLIPS to a launch-succeeds pin in this PR.
--   2. THE F61 DISCHARGE — `draft_nominate` + `draft_place_bid` (085) drop
--      their mock-seam refusal and gain the D103(2) LAUNCHER GATE, which is
--      `draft_make_pick`'s mock branch (066/071) verbatim in shape: on a
--      mock the ONLY legal human caller is `config.mock.launched_by`
--      (TEXT-compared — R117); every other member — including the human
--      seat's REAL manager and the commissioner — is refused with the same
--      friendly "another member's solo practice" P0001; the launcher acts
--      FOR the human seat (`config.mock.human_team_id`) and never through
--      `league_members` (the chosen seat may be a placeholder or another
--      member's franchise — "any seat selectable", §8.8); a CPU seat on
--      the nomination clock answers "CPU nominations land on their own".
--      pgTAP 034 §D's two seam pins flip to the launcher refusal in this
--      PR (the 020/025 seam-flip precedent). Pinned from BOTH sides in 038
--      (the seat's real manager refused, the launcher admitted).
--   3. `draft_place_bid_internal` — EXTRACTED from 085's `draft_place_bid`
--      because the second consumer arrived (the L.B1.3 / D160(1)
--      extraction rule): the self-raise refusal, the ONE-family budget
--      read (E27 capacity, the integer-raise floor, the E5/§8.6.7(d)
--      max-bid clause), the `draft_bids` INSERT and the D128 anti-snipe
--      floor now live in ONE body that both the human RPC and the tick's
--      CPU sub-arm call. THIS is what makes §8.8's "pass the same
--      max-bid/solvency validator as humans" and D132's "E62 by
--      construction" literally true: there is no second validator for a
--      CPU to pass and no second copy of the clock rule to drift. The
--      RPC's refusal messages are BYTE-IDENTICAL (the internal prefixes
--      them with the caller's label), so 034's exact-message pins stand
--      untouched. `draft_place_bid` keeps every check that is about the
--      CALLER — lock, membership, league, E2 replay, the launcher gate,
--      type, status, phase, the R330 identity guard, franchise — and
--      delegates the moment the bidding franchise is known.
--   4. `draft_system_nominate_internal` — EXTRACTED from 086's ARM 2.6(a)
--      for the same reason: the system nomination (the on-clock team's
--      OWN resolve chain at `auction_min_bid` — D129(2)/C33; the §8.6.8
--      loud guards; the F62 opening-bid row with `action_id` NULL; the
--      D126 phase flip) now has two consumers — the nomination TIMEOUT
--      (2.6(a), unchanged behaviour) and the mock CPU THINK-TIME
--      nomination (2.6(c), new). A CPU that nominates on its think-time
--      and a seat that times out produce the identical row and the
--      identical state, by the same function.
--   5. `draft_tick` — TWO changes inside ARM 2.6 and nothing outside it:
--      (a) ARM 2.6's claim and re-verify OPEN TO MOCKS (086 excluded them
--          with `is_mock = FALSE` while they were unreachable; D160(9) said
--          L.C1.7 opens the claim). The nomination-expiry sub-arm gains
--          ARM 2's MOCK BRANCH for the seat derivation — the HUMAN seat
--          keys freshness/grace on the LAUNCHER (D129(3) carried: a stale
--          launcher holds to deadline + grace, manual nomination open
--          during the hold; ARM 1.6's stale-pause preempts that hold by
--          the same 40s argument as snake), every CPU seat is a NO-USER
--          seat (immediate system nomination). The bid-expiry award, the
--          rotation scan and the completion call are UNCHANGED — the
--          completion writer (086's `draft_complete_internal`) already
--          carries the §8.8 mock bypass, so a finished mock auction stops
--          at `drafts.complete` + recap with ZERO `league_rosters` and no
--          league status transition (pinned by 038's scripted run).
--      (b) ARM 2.6(c) — THE MOCK CPU SUB-ARM (D132/D138), a claim of its
--          own, placed BEFORE the expiry loop and disjoint from it by
--          construction (it requires `current_deadline > now()`; the expiry
--          loop requires `<= now()`): live + mock + auction + alive league +
--          clock still running + think-time due. Two phases:
--            * NOMINATING with a CPU seat on the clock and
--              `draft_mock_auction_cpu_due(...)` reached → the CPU
--              nominates through `draft_system_nominate_internal` (its
--              own resolve chain at `min_bid` — D129(2); CPU seats resolve
--              as NO-USER seats, ADP + need, never their real owner's
--              prep — D110(4)). Think-time = the D93 PRNG over the
--              NOMINATION clock (20–70% of `auction_nomination_seconds`,
--              or ~2s under `cpu_speed = 'fast'`), seeded exactly as the
--              snake CPU's (draft_id, sequence number).
--            * BIDDING with the raise think-time reached → AT MOST ONE CPU
--              RAISE PER PASS PER NOMINATION (D132): every CPU seat that is
--              not the human, not the standing high bidder, has an open
--              slot, and whose `high_bid + 1 <= LEAST(value, max_bid)`
--              is a candidate; the candidate with the HIGHEST value (ties
--              → nomination-order position) raises by exactly $1 through
--              `draft_place_bid_internal` with `action_id` NULL (D130: a
--              system row). If no candidate exists the pass records a
--              FOLD and writes nothing. Raise think-time = the same PRNG
--              over the BID clock from the last bid (or the nomination
--              open — `drafts.updated_at`, the instant 085/086 stamp on
--              every bid/open; seed (draft_id, seq × 1000 + bid count)),
--              or ~2s under `fast`; the near-buzzer tail of that
--              distribution is what makes anti-snipe VISIBLE in a mock
--              (§8.8) — a CPU raise inside the final `anti_snipe` seconds
--              floors the clock exactly as a human's does, because it is
--              the same INSERT + UPDATE. A CPU whose think-time lands
--              AFTER the buzzer simply misses — the claim requires the
--              clock to be running, so no CPU ever snipes after zero
--              (pinned). One raise per pass bounds the pacing at the 5s
--              tick ("bids land ~5s apart" — D132's humanized pacing for
--              free).
--          THE VALUE MODEL (D132: "dollar value = f(ADP rank, budget scale,
--          roster needs) × (1 + seeded noise), deterministic per (draft_id,
--          nomination_seq, team_id, pass)"), finalized as ONE pure IMMUTABLE
--          function `draft_mock_cpu_bid_value` so a future tweak is a
--          deliberate, pinned change:
--            base(rank)  = 4 × budget / slots × (1 − (rank − 1) / N)^3,
--                          N = slots × teams; 0 beyond rank N or for a
--                          player with no ADP. (Σ over ranks 1..N ≈ N × V1
--                          / 4 = budget × teams: the model spends exactly
--                          the room's money, convex toward the top.)
--            need        = TWO ARMS under the NOMINATION brain's own forced
--                          rule (086:648 `remaining <= unfilled`; D163's
--                          autodraft clause — R406): FORCED (open_slots ≤
--                          unfilled starting seats, counted the way
--                          draft_autopick_resolve counts them) ⇒ 1.0 only
--                          for a position an unfilled seat accepts, else 0;
--                          OPEN ⇒ 1.0 while the team's starters at the
--                          player's position are unfilled · 0.5 for the one
--                          bench-useful extra (the §8.4 S+1 cap's shape) ·
--                          0 beyond that. 0 for K/DST always, both arms
--                          (CPUs never RAISE on a kicker or defense; their
--                          own forced-arm nomination buys theirs at
--                          `min_bid`). One unit: open_slots = unfilled + 1
--                          still permits the 0.5; = unfilled does not.
--            noise       = ±15% from md5(draft:seq:team:pass) — the D93
--                          24-bit construction, 'pass' = the live bid count
--                          on the nomination at decision time (history-
--                          derived, so the decision is reproducible from
--                          the rows and never from wall-clock).
--            value       = floor(base × need × (1 + noise)); the CPU raises
--                          only while high_bid + 1 ≤ min(value, max_bid).
--          `max_bid` comes from 084's ONE derivation family — the cap is
--          the SAME number the human RPC enforces, and the internal
--          re-enforces it on the way in. E62 is therefore structural:
--          no CPU decision can produce a bid the validator would refuse a
--          human, and if one ever did (a future tweak), the internal
--          refuses it LOUDLY into `auction_cpu_failures` rather than
--          writing it (038 §E/§F pin both halves and the break probes show
--          both layers catching it).
--      Tick summary gains `auction_cpu_claimed` / `auction_cpu_nominated` /
--      `auction_cpu_raised` / `auction_cpu_folded` / `auction_cpu_failures`
--      / `auction_cpu_loops` (the ARM 2.5 keys are untouched).
--      RECORDED RESIDUAL (lock scope, R135/R141): a bidding-phase mock
--      whose raise think-time has elapsed is claimed every pass until a
--      raise lands or the clock expires, even when every CPU folds — the
--      claim cannot evaluate the value model, so "due" means "a CPU may
--      act", not "a CPU will". The lock is held for one short read per
--      pass and released; a human bid waits milliseconds at most. A
--      HEALTHY mock (clock running, think-time not yet reached) is still
--      never locked by any arm.
--      RECORDED RESIDUAL (pacing): at $1 raises a contested player takes
--      (price − opening) raises at ≥ one tick each; a full auction mock is
--      a multi-hour practice at `realistic` and still long at `fast` — as
--      a real auction is. The launcher can jump-bid to shorten it or
--      delete the practice at any time; the one-raise-per-pass cap is
--      D132's letter and is not loosened here.
--
-- WHAT DOES NOT CHANGE (D138 — every M2 mock rule carries, measured):
--   * ARM 1.6 (E59 stale-pause, launcher-keyed), ARM 2 (snake timeouts,
--     auction-excluded), ARM 2.5 (snake CPU think-time, auction-excluded —
--     086/R362's two lines stand; 035 §J's texts are updated to the new
--     truth, its assertions unchanged), ARM 3 (heartbeat incl. mocks).
--   * The launcher-only control surface (D110(1)): `draft_pause` /
--     `draft_resume` / `delete_mock_draft` by `launched_by`; EVERY other
--     §8.7 control — the seven M2 verbs AND 087's four auction verbs
--     (`draft_reverse_won_bid`, `draft_adjust_budget`,
--     `draft_cancel_nomination`, `draft_end`) — refuses mocks. CPU bidding
--     opens no door: it is a tick-internal write under the draft lock, not
--     a commissioner action, and 038 re-runs the thirteen-verb refusal
--     sweep on a mock auction AFTER CPU bids have landed.
--   * Caps (3 active / 5 per hour), the advisory-lock serializer, the 72h
--     expiry (idle = GREATEST(updated_at, launcher beat)), recap retention,
--     `delete_mock_draft`'s child cleanup (`draft_bids` rides its
--     `ON DELETE CASCADE` FK — 083:116), E60 independence (the D95 partial
--     unique ignores mocks; a live mock auction and the league's real
--     scheduled auction coexist — re-pinned in 038).
--   * Broadcast (rule 5): a mock auction's `draft_bids` INSERTs and the
--     void summary ride 088's triggers on the SAME topic `draft:<mock_id>`
--     (one channel — DR.6's sweep pin); `drafts` UPDATEs carry the D134
--     keys. No new surface; Client Broadcast stays closed (D133).
--   * ZERO SIDE EFFECTS (§8.8): a mock auction's `draft_bids` rows carry the
--     MOCK's `draft_id` only; nothing league-scoped outside the mock's own
--     rows (`drafts` / `draft_picks` / `draft_bids` / `draft_queues` /
--     `draft_liveness` / `league_chat(context='draft:<mock_id>')`) is
--     written from launch to completion — no `league_rosters`, no league
--     status transition, no notifications, the leagues row AND the real
--     scheduled draft's row byte-identical. 038 pins it the 036 §M way: a
--     composite over WHOLE rows plus counts (R383's lesson), never a count
--     of two tables.
--
-- D137 HEAD RULE — the source of every replaced body, named, and why it is
-- the head (each verified with `grep -n 'FUNCTION <name>' supabase/migrations/*.sql`
-- rather than from `pg_get_functiondef`, per the CLAUDE.md 073 lesson):
--   * `create_mock_draft`  ← **071_mock_draft_mode.sql:228–460** (its ONLY
--     definition; signature unchanged ⇒ CREATE OR REPLACE).
--   * `draft_nominate`     ← **085_auction_nominate_bid.sql:320–531** (its
--     only definition).
--   * `draft_place_bid`    ← **085_auction_nominate_bid.sql:539–799** (its
--     only definition; the 5-arg signature from the R330 identity guard).
--   * `draft_tick`         ← **087_auction_commish_controls.sql:2626–3660**.
--     068 → 086 → 087 each re-emitted the whole body; 090 did NOT (it
--     replaces five commissioner bodies and the gate helper only), so 087
--     is the head.
--   Per-function `diff -u` hunk counts (the L.C1.5 recipe — body extracted
--   CREATE → `$$;`, edited, diffed at standard context, `@@` counted) are
--   in the PR body and PROGRESS; they are measurements and are re-derived
--   whenever any body here changes.
--   NOT replaced: `draft_make_pick`, `draft_autopick_resolve` (already
--   mock-aware — 071/086), `draft_complete_internal` (already carries the
--   mock bypass — 086), the derivation family (084), every commissioner
--   control (069/087/090), the 088 broadcast surface, 068's
--   `draft_mock_think_fraction` (REUSED as the PRNG — not redefined) and
--   `draft_mock_cpu_due` (ARM 2.5's, snake-only by R362 — untouched).
--
-- Grants doctrine (D18→D23 / tasks-M1 §4.1): no per-object GRANTs. The
-- replaced RPCs keep their posture (SECURITY DEFINER + SET search_path = ''
-- + in-body auth + REVOKE FROM PUBLIC, anon — restated after each CREATE OR
-- REPLACE, belt-and-braces). The two new internals follow 086's internal
-- form (plain function, SET search_path = '', REVOKE FROM PUBLIC, anon,
-- authenticated — callable only from the SECURITY DEFINER bodies). The
-- three new pure helpers keep broad EXECUTE (the draft_team_for_pick /
-- draft_mock_think_fraction precedent — pure math over arguments or a
-- STABLE read that exposes nothing a member cannot already SELECT).
--
-- SQLSTATE convention (062/063 verbatim): 42501 auth + no-leak · P0002 →
-- 404 · P0001 friendly refusal · 22023 argument shape. Every refusal string
-- is UX and pgTAP-pinned (038; 034 §D / 025 §D flipped in place).
--
-- Typegen: RE-RUN (`--local`; new functions change the generated surface);
-- the hand-written alias block at the bottom of src/types/database.ts is
-- re-appended BYTE-IDENTICAL and the diff verified additive-only (§4.4).
--
-- Staging rehearsal: R6 waiver — no staging clone exists (environments are
-- local + prod only); the recorded rehearsal evidence is the fresh local
-- `npx supabase db reset` replay of the full 001–090 chain (089 applied in
-- order) plus pgTAP 038 in the same PR (session log 2026-08-19). F12 note:
-- prod's migration history still ends pre-league-schema; this lands with
-- the next normal push. D38 waiver: no data backfill (no DDL; functions
-- only).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. draft_mock_auction_cpu_due — WHEN a mock auction CPU acts (the D93
--    pattern over the AUCTION clocks; banner item 5(b)). ONE implementation
--    for the ARM 2.6(c) claim WHERE and its under-lock re-check (R135's
--    claim ≡ body discipline — the draft_mock_cpu_due precedent).
--      nominating (p_bidding FALSE): origin = the nomination clock's start
--        (deadline − auction_nomination_seconds; an auction deadline is
--        never NULL, but a fixture's might be — updated_at then), think =
--        auction_nomination_seconds × think_fraction(draft, seq) at
--        `realistic`, 2s at `fast`.
--      bidding (p_bidding TRUE): origin = updated_at (the last bid / the
--        nomination open — the advance instant), think =
--        auction_bid_seconds × think_fraction(draft, seq × 1000 + p_bid_count)
--        at `realistic`, 2s at `fast`.
--    Pure over arguments — IMMUTABLE, broad EXECUTE (same precedent);
--    stored-literal-pinned in 038 §A.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_mock_auction_cpu_due(
  p_draft_id UUID,
  p_config JSONB,
  p_current_deadline TIMESTAMPTZ,
  p_updated_at TIMESTAMPTZ,
  p_nomination_seq INTEGER,
  p_bidding BOOLEAN,
  p_bid_count INTEGER
) RETURNS TIMESTAMPTZ
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  WITH s AS (
    SELECT COALESCE((p_config->>'auction_nomination_seconds')::int, 30) AS nom_secs,
           COALESCE((p_config->>'auction_bid_seconds')::int, 20)        AS bid_secs,
           COALESCE(p_config->'mock'->>'cpu_speed', 'realistic')        AS speed
  )
  SELECT CASE
           WHEN NOT COALESCE(p_bidding, FALSE) AND p_current_deadline IS NOT NULL
           THEN p_current_deadline - make_interval(secs => s.nom_secs)
           ELSE p_updated_at
         END
         + CASE
             WHEN s.speed = 'fast' THEN interval '2 seconds'
             WHEN NOT COALESCE(p_bidding, FALSE)
             THEN make_interval(secs =>
                    s.nom_secs * public.draft_mock_think_fraction(p_draft_id, p_nomination_seq))
             ELSE make_interval(secs =>
                    s.bid_secs * public.draft_mock_think_fraction(
                      p_draft_id, p_nomination_seq * 1000 + COALESCE(p_bid_count, 0)))
           END
  FROM s;
$$;

-- ---------------------------------------------------------------------------
-- 2. draft_mock_cpu_bid_value — THE value model (banner item 5(b); D132),
--    pure over arguments so a change to the curve, the need weights or the
--    noise band is a deliberate edit to ONE function with stored-literal
--    pins (038 §A). STRICT: a NULL input is a NULL value (the tick never
--    passes one — a player without ADP is passed rank N + 1 and values 0).
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
           -- the D93 24-bit construction: '00' + 6 hex ⇒ provably
           -- non-negative; /2^24 ⇒ [0, 1); ×0.30 − 0.15 ⇒ ±15%.
           (('x' || '00' || left(md5(p_draft_id::text || ':' || p_nomination_seq::text
                                     || ':' || p_team_id::text || ':' || p_pass::text), 6))
              ::bit(32)::int / 16777216.0) * 0.30 - 0.15 AS noise
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
-- 3. draft_mock_cpu_need — the roster-need weight for a CPU's valuation of
--    ONE player (banner item 5(b)). TWO ARMS, chosen by the SAME forced rule
--    the NOMINATION brain obeys (086:648 — `forced := remaining <= unfilled`,
--    D163's autodraft clause: "whenever autodraft is doing the picking or
--    nominating, fill the holes with the final picks" — a CPU bidder IS
--    autodraft doing the bidding; R406):
--      FORCED  (open_slots <= unfilled starting seats — counted exactly as
--              draft_autopick_resolve counts them: the team's picks placed
--              greedily in pick order into the first starting slot whose
--              `eligible` carries the position, the rest to the bench;
--              open_slots = total_rounds − picks, 084's D91 count)
--              ⇒ 1.0 for a position some UNFILLED seat accepts, else 0 —
--              every remaining dollar goes to a hole, never to depth. This
--              is what retires the "bench-useful extra" on a bench-0 board
--              (open_slots = unfilled from the first pick) and on every
--              board once picks-remaining equals holes.
--      OPEN    (open_slots > unfilled) ⇒ 1.0 while a starting seat eligible
--              for the position is unfilled (the S+1 count — Σ count over
--              starting slots whose `eligible` carries the position, so
--              FLEX seats weigh in), 0.5 for the one bench-useful extra, 0
--              beyond that.
--    0 for K/DST ALWAYS, in both arms (a CPU never RAISES on a kicker or
--    defense — its own forced-arm nomination buys one at min_bid when its
--    roster requires it; the only K/DST a CPU ever owns comes through
--    draft_autopick_resolve, the same chain a timed-out seat gets). The
--    boundary is one unit: open_slots = unfilled + 1 still permits the 0.5;
--    open_slots = unfilled does not (038 §E / §F0 — D146). STABLE (reads the
--    league's roster_settings, the draft's capacity, the player's position
--    and the team's live picks); broad EXECUTE (every input is
--    member-readable).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_mock_cpu_need(
  p_draft_id UUID,
  p_team_id UUID,
  p_player_id TEXT
) RETURNS NUMERIC
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
DECLARE
  v_pos       TEXT;
  v_slots     JSONB;
  v_n_slots   INTEGER;
  v_counts    INTEGER[] := '{}';
  v_filled    INTEGER[] := '{}';
  v_total     INTEGER;
  v_picks     INTEGER := 0;
  v_unfilled  INTEGER := 0;
  v_need      TEXT[] := '{}';      -- positions accepted by unfilled seats
  v_starters  INTEGER;
  v_have      INTEGER := 0;
  v_i         INTEGER;
  v_placed    BOOLEAN;
  v_row       RECORD;
BEGIN
  SELECT CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END
    INTO v_pos
  FROM public.players pl WHERE pl.id = p_player_id;
  IF v_pos IS NULL THEN
    RETURN 0;
  END IF;
  IF v_pos IN ('K', 'DST') THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(l.roster_settings->'starting_slots', '[]'::jsonb),
         COALESCE(d.total_rounds, 0)
    INTO v_slots, v_total
  FROM public.drafts d
  JOIN public.leagues l ON l.id = d.league_id
  WHERE d.id = p_draft_id;
  v_slots   := COALESCE(v_slots, '[]'::jsonb);
  v_n_slots := COALESCE(jsonb_array_length(v_slots), 0);

  -- 086's greedy steps a–c, verbatim in shape: capacities, then the team's
  -- picks placed in pick order into the first starting seat that accepts
  -- them; an unplaced pick sits on the bench.
  FOR v_i IN 1..v_n_slots LOOP
    v_counts[v_i] := COALESCE((v_slots->(v_i - 1)->>'count')::int, 0);
    v_filled[v_i] := 0;
  END LOOP;
  FOR v_row IN
    SELECT CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END AS pos
    FROM public.draft_picks p
    JOIN public.players pl ON pl.id = p.player_id
    WHERE p.draft_id = p_draft_id
      AND p.team_id = p_team_id
      AND p.is_undone = FALSE
    ORDER BY p.pick_number
  LOOP
    v_picks := v_picks + 1;
    IF v_row.pos = v_pos THEN
      v_have := v_have + 1;
    END IF;
    v_placed := FALSE;
    FOR v_i IN 1..v_n_slots LOOP
      IF NOT v_placed
         AND v_filled[v_i] < v_counts[v_i]
         AND (v_slots->(v_i - 1)->'eligible') ? v_row.pos THEN
        v_filled[v_i] := v_filled[v_i] + 1;
        v_placed := TRUE;
      END IF;
    END LOOP;
  END LOOP;
  FOR v_i IN 1..v_n_slots LOOP
    IF v_filled[v_i] < v_counts[v_i] THEN
      v_unfilled := v_unfilled + (v_counts[v_i] - v_filled[v_i]);
      v_need := v_need || ARRAY(
        SELECT jsonb_array_elements_text(v_slots->(v_i - 1)->'eligible'));
    END IF;
  END LOOP;

  -- 086's greedy step d — THE forced rule (R406 / D163): once the picks
  -- left equal the holes, only a hole-filler is worth anything.
  IF (v_total - v_picks) <= v_unfilled THEN
    IF v_pos = ANY(v_need) THEN
      RETURN 1.0;
    END IF;
    RETURN 0;
  END IF;

  -- OPEN mode: the S+1 weights.
  SELECT COALESCE(SUM((s->>'count')::int), 0) INTO v_starters
  FROM jsonb_array_elements(v_slots) s
  WHERE s->'eligible' ? v_pos;

  IF v_have < v_starters THEN
    RETURN 1.0;
  ELSIF v_have < v_starters + 1 THEN
    RETURN 0.5;
  ELSE
    RETURN 0;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. draft_place_bid_internal — THE ONE bid validator + writer (banner item
--    3): extracted from 085's draft_place_bid (085:710–797 — the self-raise
--    refusal through the RETURN) because the tick's CPU sub-arm is the
--    second consumer. CALLER CONTRACT: the drafts row is held FOR UPDATE;
--    the caller has established auction + live + BIDDING phase and
--    resolved the bidding franchise (the human RPC: the caller's
--    league_members seat, or the mock's human seat for the launcher; the
--    tick: the CPU seat). p_label prefixes every message so the RPC's
--    shipped strings are byte-identical ('draft_place_bid') and the tick's
--    are honest ('draft_tick'). p_action_id NULL = a system row (a CPU
--    raise — D130's actor matrix reads it at the award).
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

  -- (5) RETURN the new authoritative state.
  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'bid', to_jsonb(v_bid));
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_place_bid_internal(UUID, UUID, INTEGER, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. draft_system_nominate_internal — THE ONE system nomination (banner
--    item 4): extracted from 086's ARM 2.6(a) (087:3322–3386 in the head
--    body — the §8.6.8 guards, the resolve call, the F62 opening row, the
--    D126 phase flip) because the mock CPU think-time nomination is the
--    second consumer. CALLER CONTRACT: the drafts row is held FOR UPDATE;
--    the caller has established auction + live + NOMINATING phase and
--    decided (grace, think-time) that the on-clock seat nominates NOW.
--    Returns the nominated player id.
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

  RETURN v_player;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_system_nominate_internal(UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. create_mock_draft — REPLACED FROM 071:228–460 (D137 head rule; its only
--    definition). The auction REFUSAL becomes the auction LAUNCH ARM (banner
--    item 1); caps / serializer / launched_by / action_id replay untouched.
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
  v_min_bid      INTEGER;
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
  -- block (budget, min bid, the three clocks, anti-snipe — D95: a mock never
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
    v_min_bid := COALESCE((v_config->>'auction_min_bid')::int, 1);
    RAISE EXCEPTION
      'create_mock_draft: league % cannot practice an auction — a $% budget cannot fill % draftable roster spots at a $% minimum bid (§8.6.8 solvency); raise the auction budget or lower the minimum bid in League settings → Draft setup',
      p_league_id, v_budget, v_total_rounds, v_min_bid
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
-- 7. draft_nominate — REPLACED FROM 085:320–531 (D137 head rule; its only
--    definition). The mock SEAM becomes the D103(2) LAUNCHER GATE + the
--    human-seat-only turn branch (banner item 2; F61).
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

  -- (5) RETURN the new authoritative state.
  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'bid', to_jsonb(v_bid));
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_nominate(UUID, TEXT, INTEGER, UUID)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 8. draft_place_bid — REPLACED FROM 085:539–799 (D137 head rule; its only
--    definition). The mock SEAM becomes the D103(2) LAUNCHER GATE, the
--    franchise resolution gains the mock branch, and the tail delegates to
--    draft_place_bid_internal (banner items 2–3; F61). Signature unchanged
--    (the 5-arg R330 form) ⇒ CREATE OR REPLACE.
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
  IF NOT FOUND OR NOT public.is_league_member(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_place_bid: not a member of this draft''s league'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
  ) THEN
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
REVOKE EXECUTE ON FUNCTION draft_place_bid(UUID, INTEGER, UUID, INTEGER, TEXT)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 9. draft_tick — REPLACED FROM 087:2626–3660 (D137 head rule; 090 did not
--    re-emit it). Changes INSIDE ARM 2.6 only (banner item 5): the claim
--    opens to mocks, sub-arm (a) gains ARM 2's mock seat branch and calls
--    the extracted system-nomination internal, and ARM 2.6(c) — the mock CPU
--    sub-arm — is added before the expiry loop. ARMs 1/1.5/1.6/2/2.5/3 are
--    byte-identical. Signature unchanged ⇒ CREATE OR REPLACE; the whole body
--    is re-emitted because that is the D137 vehicle.
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
  v_high_bid       INTEGER;
  v_high_team      UUID;
  v_adp            NUMERIC;
  v_rank           INTEGER;
  v_budget         INTEGER;
  v_slots          INTEGER;
  v_teams          INTEGER;
  v_cand_team      UUID;
  v_cand_value     INTEGER;
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
  --   BIDDING, raise think-time due → AT MOST ONE CPU RAISE PER PASS PER
  --     NOMINATION (D132): candidates are the CPU seats that are not the
  --     human, not the standing high bidder, hold an open slot, and whose
  --     high_bid + 1 <= LEAST(value, max_bid) — value from the ONE pure
  --     model (draft_mock_cpu_bid_value: ADP rank × budget scale × roster
  --     need × seeded noise, deterministic per (draft, seq, team, pass =
  --     the live bid count)), max_bid from the ONE derivation family. The
  --     highest value raises by exactly $1 through draft_place_bid_internal
  --     with action_id NULL (D130: a system row — a CPU's win awards as
  --     is_auto/'autopick'); ties break on nomination-order position. No
  --     candidate ⇒ a FOLD, nothing written. Raise think-time = 20–70% of
  --     the BID clock from the last bid / the open (drafts.updated_at),
  --     seeded (draft, seq × 1000 + bid count), or ~2s under `fast`; the
  --     tail of that distribution lands inside the final anti_snipe
  --     seconds and the floor fires exactly as for a human — anti-snipe
  --     becomes VISIBLE in a mock (§8.8). E62 is structural: the cap is
  --     the validator's own number and the internal re-enforces it; a
  --     decision the validator would refuse is recorded LOUDLY in
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
          -- ===== (c2) ONE CPU RAISE, at most, on its think-time (D132) ====
          v_win_player := v_draft.current_nomination->>'player_id';
          v_high_bid   := COALESCE((v_draft.current_nomination->>'high_bid')::int, 0);
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

          -- The value model's shared inputs (089 banner item 5(b)): the
          -- nominated player's ADP RANK over the whole pool (NULL ADP ⇒
          -- rank N + 1 ⇒ value 0 — nobody raises on an unranked player),
          -- the snapshotted budget, the D91 slot count, the room size.
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

          -- The candidate: every CPU seat in nomination order that is not
          -- the human, not the standing high bidder, holds an open slot
          -- (E27 — through the ONE family), and whose high + 1 fits under
          -- LEAST(value, max_bid); the HIGHEST value raises, ties by
          -- position. ONE statement through the CROSS JOIN LATERAL shape
          -- the rotation scan and draft_auction_solvent use (rule 7, no n
          -- round trips inside the lock).
          v_cand_team  := NULL;
          v_cand_value := NULL;
          SELECT c.team, c.value
            INTO v_cand_team, v_cand_value
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

          IF v_cand_team IS NULL THEN
            -- Every CPU folds at this price: nothing written, the clock
            -- runs on, the human (or the buzzer) decides.
            v_cpu_folded := v_cpu_folded + 1;
          ELSE
            -- THE ONE BID VALIDATOR + WRITER (089 banner item 3): the same
            -- self-raise / E27 / raise-floor / E5 max-bid clauses and the
            -- same D128 anti-snipe floor a human's bid passes through.
            -- action_id NULL — a system row (D130's actor matrix).
            PERFORM public.draft_place_bid_internal(
              v_draft.id, v_cand_team, v_high_bid + 1, NULL, 'draft_tick');
            v_cpu_raised := v_cpu_raised + 1;
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
