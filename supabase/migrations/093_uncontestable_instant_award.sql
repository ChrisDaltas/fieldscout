-- ============================================================================
-- 093 — UNCONTESTABLE NOMINATIONS AWARD INSTANTLY (task AP.2; spec v2.13
-- **§8.6.9** + §8.6.1/§8.6.7(b)(c)(d)/§8.6.8, §12.3, §16.5.4, E67/E68;
-- D199; tasks-AP §4 rules 1–11 = tasks-M3 §4's eight + the three AP rules).
--
-- CHRIS'S RULING, VERBATIM (2026-08-20 — it is the acceptance standard, not
-- a paraphrase of one):
--   "at the end of an auction draft, a nomination might work as an instant
--    pick because no other teams have enough money, so the nomination is
--    instantly awarded."
--   "I might have $8, everyone else has $7 or less, if I only have two roster
--    spots left and there is one player I really want. I might nominate a
--    player for $7, knowing no one else can add $1 bid."
--   "I would prefer a 3 second tick with the message. 'No one can bid.
--    Awarding Player Name to the Nominator.'"
--   "it should apply no matter where it happens in the draft — it's most
--    likely in the final 30ish picks, but that doesn't matter, the rule
--    should be true anytime it occurs."
-- His worked example is a pinned fixture (pgTAP 041 §B) and it is the reason
-- the predicate is written against `high_bid + increment` and not `> high_bid`
-- (§8.6.9 first bullet): at $7 the question is whether anyone can reach $8,
-- and $7-vs-$8 is a boundary, not a comparison.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 1 — THE PREDICATE, STATED EXACTLY.
-- ---------------------------------------------------------------------------
-- A nomination is UNCONTESTABLE when no OTHER eligible franchise can reach
-- `high_bid + increment`. Three words in that sentence do work:
--
--   * **OTHER** — the nominator is excluded. It already holds the standing
--     high bid (085 writes `high_bidder_team_id` = the nominator at the open),
--     so "nobody can outbid it" is exactly "nobody but it can reach high + 1".
--   * **ELIGIBLE** — active franchises only (`t.status <> 'retired'`, the
--     §8.6.8 team set 084/087 already sweep), and complete rosters excluded.
--     E27/§8.6.7(c)'s rotation-skip needs NO clause of its own here:
--     `draft_team_budget` forces `max_bid = 0` when `open_slots <= 0`
--     (092 §2's CASE), and `high_bid + 1 >= 1 > 0` at every legal floor
--     including the $0 one, so a full roster fails the MONEY test on its own.
--     The `b.open_slots >= 1` term IS in the query and is DOCUMENTATION
--     (D199(2)) — the correctness argument does not rest on it, and pgTAP 041
--     §C proves the money test alone by pinning `max_bid = 0` as a stored
--     literal on a complete-roster team holding a full purse.
--   * **REACH** — `max_bid`, read through the ONE derivation family
--     (`draft_team_budget`, D127/§4.7), which since 092/AP.1 depends on
--     `draft_auction_reserve(config)`. **No second budget formula is added by
--     this migration**: the predicate CALLS the family, it does not restate
--     it. With `auction_zero_dollar_nominations` ON the reserve is 0, so
--     `max_bid = remaining` flat, MORE teams can afford a bid and FEWER
--     nominations are uncontestable — the toggle's effect on this rule is
--     real and both columns are pinned (041 §D, and E68's own row).
--
-- The increment is a NAMED CONSTANT `1` compared as `p_high_bid + increment`
-- (§8.6.9/D199(1)), never `> p_high_bid`. Today the two forms agree, which is
-- exactly why the break probe has to MOVE the increment to be falsifiable —
-- see the DoD note in the PR.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 2 — THE AWARD IS EXTRACTED, NOT REIMPLEMENTED (D199(3)).
-- ---------------------------------------------------------------------------
-- `draft_tick`'s ARM 2.6(b) was ~190 inline lines. They are now
-- `draft_award_nomination_internal(UUID) → BOOLEAN` and the arm calls it —
-- the same extraction 089 performed on `draft_system_nominate_internal` the
-- day a second consumer appeared, for the same reason. THE MOVE IS PROVED
-- LOSSLESS THE WAY 087/R367 PROVED ITS OWN, not asserted:
--   * the body was lifted from 092:3471–3661 and DE-INDENTED by exactly 8
--     spaces; `sed 's/^[[:space:]]*//'` over the before and after is
--     byte-identical, so the move changed no non-whitespace character;
--   * exactly ONE substantive line differs — `v_auc_completed := … + 1`
--     becomes `v_completed := TRUE`, because the completion COUNTER belongs
--     to the sweep and the ANSWER belongs to the award. The arm counts what
--     the function returns;
--   * **the six MOVED RAISE texts keep their `draft_tick:` prefix,
--     byte-for-byte**, so 035 §E/§K and 036 §E/§G keep pinning the strings
--     they always pinned. That prefix is now slightly misattributed on the
--     three NOMINATION callers — recorded as ledger row **F96**, not silently
--     "fixed", because re-wording six engine-corruption raises to buy a
--     prefix would trade a proven-lossless extraction for a prettier message.
--     All six are unreachable from a nomination: the malformed-nomination and
--     missing-bid guards fire on rows this transaction just wrote, the
--     complete-roster and over-max-bid guards are pre-checked by every caller
--     (`v_open < 1`, `p_opening_bid > v_max_bid`), and the two rotation guards
--     need a corrupt `nomination_order`. **The phase guard below is the ONE
--     raise this migration AUTHORS rather than moves (R465), so the
--     byte-for-byte constraint never applied to it and it is named correctly
--     from the start: `draft_award_nomination_internal:`. F96 therefore covers
--     SIX messages and FOUR pins, not seven and five;**
--   * the arm's twelve now-unused locals moved WITH it. `v_win_player` stayed
--     — ARM 2.6(c) reads it too (measured: `grep -c` over the arm-less body
--     returns 4 for `v_win_player` and 1, the declare, for the other twelve).
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 3 — THE ORDER, RULED BY CHRIS: AWARD FIRST, MESSAGE AFTER.
-- ---------------------------------------------------------------------------
-- Chris's correction, verbatim (2026-08-20, on a first reading of this task
-- that had the message running BEFORE the award):
--   "No you've misunderstood. It awards the player immediately and then
--    displays that message for 3 seconds until the next nomination."
-- So the sequence is: (1) the server finds the nomination uncontestable;
-- (2) **the award happens immediately**, in that same determination, in one
-- transaction; (3) THEN the room shows *"No one can bid. Awarding {Player} to
-- {Team}."* for 3 seconds; (4) then the next nomination opens. The 3 seconds
-- is a display/pacing beat living in the gap that already exists before the
-- next nomination — **it is not a decision window and it is not on the award
-- path.** It is client-held (§16.5.4; tasks-AP §4 rule 11): there is no
-- `pg_sleep`, no scheduled action, no `pg_net`, no second cron here.
--
-- **THE AWARD IS THE ORDINARY AWARD.** Same extracted implementation, same
-- `draft_picks` write, same §8.6.8 re-check under the held lock, same
-- rotation advance, same completion call, same realtime events. There is no
-- second kind of award and no pending-award state anywhere in this file.
--
-- What the uncontestable path adds is exactly two things, both small:
--   (a) an ADDITIVE `"uncontested": true` key on the NOMINATION's own phase
--       flip — the event every nomination already emits (070's
--       `tr_broadcast_drafts` is AFTER UPDATE FOR EACH ROW; 088/D134 puts
--       `current_nomination` on the wire whole). That is the room's only
--       signal that the award it is about to see needs the message. **No new
--       column, no new event name, no new topic, no new trigger.**
--   (b) `current_deadline` NULL on that flip, because E67 says *no bid clock
--       is ever opened*. A deadline on the wire is a clock the room would
--       render, however briefly, and it is inert for the sweep besides (ARM
--       2.6's claim query requires `current_deadline IS NOT NULL`).
--
-- The phase flip is a step, not a state: the extracted award reads
-- `current_nomination` to learn who won at what price, so the flip has to
-- precede it, and both statements commit together. **THE KEY THEREFORE
-- EXISTS ONLY ON THE WIRE, NEVER AT REST** — by the time any SELECT can run,
-- `current_nomination` is already NULL. That is what makes §16.5.4's three
-- obligations true by construction rather than by client discipline: a
-- reconnect during the beat cannot lose the award (it re-reads a board that
-- already has the pick), a late joiner sees the completed award (correct),
-- and the message cannot be shown twice (exactly one payload carries it).
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 4 — THERE IS NO WINDOW, AND NOTHING DEFENDS ONE.
-- ---------------------------------------------------------------------------
-- Because the determination and the award are the same transaction under the
-- `drafts` row lock every nomination path already takes (`SELECT … FOR
-- UPDATE`), there is no interval in which the board can "stop being
-- uncontestable". Every other writer — `draft_adjust_budget`,
-- `draft_reverse_bid`, `draft_cancel_nomination`, `draft_undo`,
-- `draft_place_bid`, `draft_force_pick`, the tick — takes the SAME row lock
-- first, so each runs entirely before the predicate (and is seen by it) or
-- entirely after the award (and acts on a board where the player is already
-- bought). There is no third possibility.
--
-- **SO NOTHING HERE DEFENDS AGAINST A PERSON CHANGING THEIR MIND OR LOSING
-- WIFI, AND THAT IS DELIBERATE.** Chris, same session:
--   "but a commish can pause a draft and change anything or someone can
--    disconnect at any time. TBH in drafts that's known as a 'personal
--    problem'"
-- The sanctioned mechanism for changing anything mid-draft is PAUSE → change
-- → resume (§8.7), and a mid-auction disconnect is what §8.4/§8.6.2's
-- system nomination exists for. This file therefore adds **no pending state,
-- no re-check-at-expiry, no cancellation path, no reconciliation path** — and
-- a future session should read their absence as a ruling, not an oversight.
-- If the award needs to come back, the shipped remedy is unchanged and is
-- `draft_undo` (the pick returns to the pool, the rotation rewinds).
--
-- What DOES stand, unchanged, because it defends against two WRITERS rather
-- than against a change of mind: (a) the `drafts` row lock; (b) E2 — a
-- retried `draft_nominate` with the same `action_id` short-circuits on the
-- opening `draft_bids` row and returns the ORIGINAL result before any
-- predicate runs (§8.1/R125); (c) `uniq_draft_player_live` (065:178) refuses
-- a second live pick of the same player; (d) the extracted award refuses
-- outright when `current_nomination` is NULL, which is what it is
-- immediately after an award. Pinned in 041 §G.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 5 — IT APPLIES ANYWHERE, AND TO EVERY NOMINATION PATH.
-- ---------------------------------------------------------------------------
-- "it should apply no matter where it happens in the draft" is implemented as
-- the ABSENCE of an endgame condition: there is no round check, no
-- picks-remaining check and no "final N nominations" clause anywhere in this
-- file. 041 §E drives the identical predicate on nomination #1 of a fresh
-- board and on a late one and asserts the same outcome.
--
-- THE PATH LIST IS THREE, NOT TWO. tasks-AP §AP.2 item 3 names
-- `draft_nominate` and `draft_system_nominate_internal`; the third live
-- nomination writer is **`draft_force_pick`'s auction arm** (087/R301 — a
-- commissioner "pick for a manager" on an auction IS a force-nomination, and
-- 092 §6 shows it opening AT the floor with its own `draft_bids` row and its
-- own phase flip). §8.6.9 is written about NOMINATIONS with no qualifier on
-- who opened one, and tasks-AP's own preamble says the spec wins where the
-- two disagree. The precedent for the breakdown missing a live site in this
-- exact family is **D214(1)**, where AP.1 found §1.3's read-site table had
-- missed this same function. All three paths are wired and all three are
-- pinned (041 §B/§E/§F).
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 6 — WHAT IS NOT CHANGED (the scope guard).
-- ---------------------------------------------------------------------------
--   * **§8.6.8 solvency.** The award's re-check under the held lock is inside
--     the extracted body, byte-for-byte, and now runs on the instant path too
--     — an instant award is re-validated exactly like a clock-expiry award.
--     No arm is removed, weakened or made conditional (D198(4)).
--   * **The bid path.** `draft_place_bid` / `draft_place_bid_internal` are NOT
--     replaced. A bid cannot land on an uncontestable nomination because the
--     nomination is over before the transaction commits.
--   * **The sweep.** `cron.schedule('draft-tick','5 seconds')` at 068:1265 is
--     NOT re-issued (§22.3 — one cron entry for the whole system). ARM 2.6
--     keeps owning expiry for every contested nomination; this migration
--     removes work from it, never scheduling.
--   * **No server-side sleep, no scheduled action, no `pg_net`, no second
--     cron** (tasks-AP §4 rule 11 / D199(5)). The 3 seconds is the room's.
--   * **The contested path is byte-identical.** Every hunk in
--     `draft_nominate` / `draft_system_nominate_internal` / `draft_force_pick`
--     is inside a `CASE WHEN v_uncontested` or an `IF v_uncontested` branch;
--     with the predicate false, the statements executed are the ones 092
--     executed.
--   * **091/AP.3's reactive CPU arms** keep their behaviour. They are skipped
--     on the uncontestable path only, and the file states — with 091's own
--     source clauses — why skipping them cannot change an outcome.
--   * `draft_team_budget`, `draft_auction_reserve`, `draft_auction_solvent`,
--     the 088 broadcast surface, every other commissioner control, and the
--     settings catalog: untouched. No new setting, no new knob (§7.3.8 is not
--     amended — this is not configurable, per Chris's ruling).
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 7 — WHAT THIS FILE CONTAINS.
-- ---------------------------------------------------------------------------
--   NEW:
--     1. `draft_award_nomination_internal(UUID) → BOOLEAN` — ARM 2.6(b),
--        extracted (banner item 2). Returns TRUE when it completed the draft.
--        Plain function, `search_path = ''`, REVOKEd from PUBLIC/anon/
--        authenticated — 086's internal form, as 089's and 091's internals.
--     2. `draft_nomination_uncontestable(UUID, UUID, INTEGER) → BOOLEAN` —
--        the §8.6.9 predicate (banner item 1). STABLE, `search_path = ''`,
--        REVOKEd. ONE lateral scan, the shape `draft_auction_solvent`
--        (084:386) and `draft_end` (087:1004) already use.
--   REPLACED (D137 head rule — each body EXTRACTED from the current FILE TEXT
--   of the newest migration that DEFINES it, never `pg_get_functiondef`. The
--   head set was RE-DERIVED at task time, not inherited from a planning
--   document (AP.1's own finding, D214(1)), with
--   `grep -lE '^CREATE (OR REPLACE )?FUNCTION +(public\.)?<name>\(' supabase/migrations/*.sql`
--   and every claimed range re-checked to start on its own CREATE OR REPLACE
--   line. **All four heads are 092**, which is newer than the 089/091 ranges
--   tasks-AP §AP.2 cites:
--     * `draft_tick`                     ← 092:2542–3749 (068 → 086 → 087 →
--        089 → 091 → 092; 090 re-emits none of them)
--     * `draft_nominate`                 ← 092:2273–2529 (085 → 089 → 091 → 092)
--     * `draft_system_nominate_internal` ← 092:2155–2260 (089 → 091 → 092)
--     * `draft_force_pick`               ← 092:858–1117  (087 → 092)
--   Per-function `diff -u` hunk counts (the L.C1.5 recipe — body extracted
--   CREATE → `$$;`, edited, diffed at standard context, `@@` counted),
--   re-derived from the SHIPPED file text:
--     draft_tick                      3 hunks (+17/−195) declares · the
--       now-orphaned `v_reserve` read · ARM 2.6(b) → one call
--     draft_nominate                  2 hunks (+51/−9)   the declare · the
--       predicate + announcement + instant-award branch
--     draft_system_nominate_internal  2 hunks (+33/−10)  same two
--     draft_force_pick                3 hunks (+29/−2)   same two, split by
--       the chat line that sits between them
--   Everything outside those hunks is byte-identical to 092.
--   NOT replaced: `draft_place_bid` / `draft_place_bid_internal` (a bid can
--   never meet an uncontestable nomination), `draft_team_budget`,
--   `draft_auction_reserve`, `draft_auction_solvent`, `draft_start_internal`,
--   `draft_adjust_budget`, `draft_reassign_pick`, `draft_move_player`,
--   `create_mock_draft`, `draft_complete_internal`, the 088 broadcast surface.
--   No signature changes ⇒ every replacement is `CREATE OR REPLACE`.
--
-- Grants doctrine (D18→D23 / tasks-M1 §4.1): no per-object GRANTs. The
-- replaced RPCs keep their posture (SECURITY DEFINER + `SET search_path = ''`
-- + in-body auth + REVOKE FROM PUBLIC, anon — restated after each CREATE OR
-- REPLACE, belt-and-braces, 089/090/091/092's own form). Both new functions
-- are internals: `search_path = ''`, plain (not SECURITY DEFINER — they are
-- called from inside SECURITY DEFINER bodies that have already authenticated
-- the caller), REVOKEd from PUBLIC, anon and authenticated.
-- **TYPEGEN IS NOT A NO-OP HERE, AND THE OBVIOUS REASONING SAYS IT IS.** A
-- REVOKE from `authenticated` keeps a function off the CALLABLE surface, but
-- the generator enumerates `public` regardless of ACL — MEASURED, not
-- assumed: `grep -n 'draft_complete_internal\|draft_mock_cpu_respond_internal\|
-- draft_system_nominate_internal' src/types/database.ts` returns three hits
-- (3292 / 3398 / 3532), every one a REVOKEd internal, and 092's REVOKEd
-- `draft_auction_reserve` sits at 3270. So `src/types/database.ts` IS
-- regenerated here.
--
-- SQLSTATE convention (062/063 verbatim): 42501 auth + no-leak · P0002 → 404
-- · P0001 friendly refusal · 22023 argument shape. The predicate's NULL-input
-- guard is 22023; its unknown-draft guard is P0002; the extracted award's
-- engine-corruption raises keep 092's defaults, unchanged.
--
-- Migration checklist (delivery plan §8.1 / tasks-M3 §4.4): NO DDL — no
-- table, no column, no policy, no index, no signature change; two new
-- functions and four CREATE OR REPLACEs · rollback = re-apply 092's four
-- bodies and drop the two new functions (092's text IS the rollback text) ·
-- staging rehearsal: **R6 waiver** — no staging clone exists (environments are
-- local + prod only); the recorded rehearsal is the fresh local
-- `npx supabase db reset` replay of the full 001–093 chain in this PR, plus
-- pgTAP 035/036/038/039/040 unchanged and 041 new · **D38 waiver**: no data
-- backfill (functions only, no DDL; nothing stored changes shape — the
-- `uncontested` key never comes to rest) · F12 note: prod's migration history
-- still ends pre-league-schema; this lands with the next normal push ·
-- typegen: RE-RUN (`--local`) — two new `public` functions enter the generated
-- Functions map (see the grants paragraph: the generator ignores ACLs, and
-- that was MEASURED rather than reasoned about). Hand-written alias block
-- preserved and re-appended BYTE-IDENTICAL; diff verified additive-only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. draft_award_nomination_internal — THE ONE auction award (banner item 2;
--    D199(3)). EXTRACTED BYTE-FOR-BYTE from `draft_tick` ARM 2.6(b)
--    (092:3471–3661) because a second consumer appeared — §8.6.9's instant
--    award — which is exactly why 089 extracted
--    `draft_system_nominate_internal` out of ARM 2.6(a). The body below is
--    092's, de-indented by 8 spaces and otherwise untouched; the ONE
--    substantive change is the completion counter, which became this
--    function's RETURN VALUE so the sweep can keep counting its own work.
--
--    The `draft_tick:` prefixes on the six RAISE texts are DELIBERATELY kept
--    (035 §E/§K, 036 §E/§G pin them). All six are engine-corruption guards
--    and none is reachable from a nomination path — recorded as F96 rather
--    than re-worded, because a proven-lossless move is worth more than a
--    prettier prefix on an unreachable line.
--
--    The caller holds the `drafts` row lock (`FOR UPDATE`) in every path —
--    the tick's claim loop, `draft_nominate`, `draft_system_nominate_internal`
--    and `draft_force_pick` all take it before they get here — so this
--    function does not re-take it and must never be called without it.
--    Internal form (086/089/091): plain function, `search_path = ''`, REVOKEd.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_award_nomination_internal(p_draft_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_draft      public.drafts;
  v_reserve    INTEGER;
  v_remaining  INTEGER;
  v_open       INTEGER;
  v_max_bid    INTEGER;
  v_price      INTEGER;
  v_win_team   UUID;
  v_win_player TEXT;
  v_is_auto    BOOLEAN;
  v_order      JSONB;
  v_n          INTEGER;
  v_idx        INTEGER;
  v_step       INTEGER;
  v_next_team  UUID;
  v_completed  BOOLEAN := FALSE;
BEGIN
  SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  -- The phase guard, in the form 089 gave the sibling internal
  -- (`draft_system_nominate_internal`'s "called outside the nominating
  -- phase"). It is a MISUSE guard, not a race guard: the tick's ELSE arm
  -- cannot reach it (it branched on `current_nomination IS NULL`) and the
  -- three nomination paths cannot either (they just wrote one). It is LOUD
  -- rather than a silent RETURN because an award that quietly did nothing is
  -- the exact "nothing happened means it worked" failure CLAUDE.md names.
  IF NOT FOUND OR v_draft.current_nomination IS NULL THEN
    RAISE EXCEPTION
      'draft_award_nomination_internal: called outside the bidding phase on draft %',
      p_draft_id;
  END IF;

  -- 092/AP.1: read ONLY to print the award refusal's reserve term below,
  -- through the ONE authority (D198(1)). Moved here from the tick with the
  -- arm it exists to serve.
  v_reserve := public.draft_auction_reserve(v_draft.config);

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
    v_completed := TRUE;                 -- the caller keeps its own counter
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


  RETURN v_completed;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_award_nomination_internal(UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. draft_nomination_uncontestable — THE §8.6.9 PREDICATE (banner item 1;
--    D199(1)/(2); E67/E68). ONE lateral scan, never a loop: the shape
--    `draft_auction_solvent` (084:386–392) and `draft_end`'s unfilled-slot
--    sum (087:1004–1007) already use, and the shape 092's ARM 2.6(b)
--    rotation scan uses — `FROM public.teams t CROSS JOIN LATERAL
--    public.draft_team_budget(…) b WHERE t.league_id = … AND t.status <>
--    'retired'`. The single-table quals on `teams` are what keep
--    `draft_team_budget`'s retired-seat P0002 (R321) out of the lateral, the
--    same posture `draft_auction_solvent` has shipped since 084.
--
--    STABLE, and that matters: called from inside a VOLATILE nomination body
--    AFTER that body's own writes, a STABLE function reads the CURRENT
--    statement's snapshot and therefore sees them. The award's rotation scan
--    (092:3615) already depends on exactly that — it must see the
--    `draft_picks` row inserted 30 lines above it — so this is the family's
--    established behaviour, not a new assumption.
--
--    It is NOT the place to be clever about NULLs. A NULL answer would make
--    `IF v_uncontested THEN` fall to the contested branch and silently open a
--    clock nobody can enter — the "nothing happened means it worked" shape
--    CLAUDE.md forbids — so the arguments are checked and the draft must
--    exist. LOUD, in both cases.
--
--    Internal form: plain function, `search_path = ''`, REVOKEd. No client
--    ever asks this question; the server answers it, once, under the lock
--    (tasks-AP §4 rule 11 — the client never decides an award).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_nomination_uncontestable(
  p_draft_id UUID,
  p_nominator UUID,
  p_high_bid INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  -- §8.6.3/§8.6.9: THE BID INCREMENT IS $1, FIXED, IN EVERY LEAGUE AND IN
  -- BOTH COLUMNS OF THE $0 TOGGLE. It is NAMED here and compared as
  -- `p_high_bid + c_bid_increment` rather than written as `> p_high_bid`,
  -- per §8.6.9's first bullet: the two forms agree only while the increment
  -- is 1, and the loose form would be a latent bug with no symptom. It is
  -- deliberately NOT a setting and NOT the nomination floor — 092/D214(2)
  -- separated those jobs and this constant is the third one.
  c_bid_increment CONSTANT INTEGER := 1;
  v_league_id UUID;
BEGIN
  IF p_draft_id IS NULL OR p_nominator IS NULL OR p_high_bid IS NULL THEN
    RAISE EXCEPTION
      'draft_nomination_uncontestable: draft, nominator and high bid are all required — an unknown answer would open a bid clock nobody can enter (§8.6.9)'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.league_id INTO v_league_id FROM public.drafts d WHERE d.id = p_draft_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'draft_nomination_uncontestable: draft % not found', p_draft_id
      USING ERRCODE = 'P0002';
  END IF;

  -- "No OTHER eligible franchise can reach high + increment."
  --   t.id <> p_nominator   — the nominator holds the standing high bid and
  --                           cannot outbid itself (085's self-raise refusal).
  --   t.status <> 'retired' — the §8.6.8 team set (§7.2/D96), the same set
  --                           draft_auction_solvent sweeps.
  --   b.open_slots >= 1     — DOCUMENTATION (D199(2)). E27's complete rosters
  --                           already fail the money test, because
  --                           draft_team_budget forces max_bid = 0 at
  --                           open_slots <= 0 and high + 1 >= 1 > 0 at every
  --                           legal floor, the $0 one included. Kept because
  --                           saying what you mean is free; NEVER removed on
  --                           the grounds that it is redundant (v2.13.3 —
  --                           redundancy between two arms is not vacuity),
  --                           and never what correctness rests on.
  --   b.max_bid >= …        — §8.6.7(d)'s $1-max-bid team is a CONTESTANT at
  --                           a $0 opening and is not one at a $1 opening.
  --                           That boundary is the rule (041 §D).
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.teams t
    CROSS JOIN LATERAL public.draft_team_budget(p_draft_id, t.id) b
    WHERE t.league_id = v_league_id
      AND t.status <> 'retired'
      AND t.id <> p_nominator
      AND b.open_slots >= 1
      AND b.max_bid >= p_high_bid + c_bid_increment
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_nomination_uncontestable(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. draft_tick — the ONE clock sweep (§22.3; one cron entry, untouched).
--    REPLACED FROM 092:2542-3749 (D137 head rule; 068 -> 086 -> 087 -> 089 ->
--    091 -> 092, and 090 re-emits none of them). THREE hunks: the declares the
--    extraction took with it, the now-orphaned `v_reserve` read, and ARM
--    2.6(b) collapsing to one call. **No arm, no branch and no schedule
--    changes**: `cron.schedule(...)` at 068:1265 is NOT re-issued (§22.3), and
--    091/AP.3's reactive-CPU call sites are outside every hunk.
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
-- 4. draft_nominate — the human nomination (§8.6.2/§8.6.7(a)).
--    REPLACED FROM 092:2273-2529 (D137 head rule; 085 -> 089 -> 091 -> 092).
--    TWO hunks: the declare, and the §8.6.9 predicate + announcement key +
--    instant-award branch. Every other clause, refusal string and the E2
--    replay are byte-identical to 092; the CONTESTED path executes exactly
--    the statements 092 executed.
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


REVOKE EXECUTE ON FUNCTION draft_nominate(UUID, TEXT, INTEGER, UUID)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 5. draft_system_nominate_internal — §8.6.2's timeout nomination (and the
--    mock CPU's think-time nomination, its second consumer).
--    REPLACED FROM 092:2155-2260 (D137 head rule; 089 -> 091 -> 092). TWO
--    hunks, the same two draft_nominate takes. §8.6.9 is a rule about
--    NOMINATIONS, not about who typed one.
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
  v_uncontested BOOLEAN;
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

  -- 093/AP.2 — §8.6.9/E67 on the SYSTEM path too. The rule is about a
  -- nomination, not about who typed it: a timeout nomination (and a mock
  -- CPU's think-time nomination, this internal's second consumer) that
  -- nobody can answer is awarded in this same transaction. Asked before the
  -- phase flip so the ONE flip statement can carry the announcement key.
  v_uncontested := public.draft_nomination_uncontestable(
                     v_draft.id, v_draft.on_clock_team_id, v_nom_floor);

  -- Open the BIDDING phase (D126). current_pick_number is NOT
  -- advanced — it IS this nomination's sequence number until the
  -- award (D157(2)) — and on_clock stays the NOMINATOR.
  -- 093/AP.2: the uncontestable arm adds the ADDITIVE `"uncontested": true`
  -- key the room reads (D199(4)) and opens NO bid clock (E67) — see
  -- draft_nominate for the full reasoning; one mechanism, three callers.
  UPDATE public.drafts SET
    current_nomination = jsonb_build_object(
                           'player_id', v_player,
                           'high_bid', v_nom_floor,
                           'high_bidder_team_id',
                             v_draft.on_clock_team_id)
                         || CASE WHEN v_uncontested
                                 THEN jsonb_build_object('uncontested', TRUE)
                                 ELSE '{}'::jsonb END,
    current_deadline   = CASE WHEN v_uncontested THEN NULL
                              ELSE now() + make_interval(secs => COALESCE(
                                     (v_draft.config->>'auction_bid_seconds')::int,
                                     20))
                         END,
    updated_at         = now()
  WHERE id = v_draft.id;

  IF v_uncontested THEN
    -- THE INSTANT AWARD (§8.6.9/E67) — the same extracted award every other
    -- close takes (D199(3)). No clock was opened, so nothing expires.
    PERFORM public.draft_award_nomination_internal(v_draft.id);
  ELSIF v_draft.is_mock THEN
    -- THE REACTIVE CPU RESPONSE on the OPEN (091/AP.3; §8.8/D200(1) — "the
    -- nomination that opened the market" is one of the three provocations).
    -- Both consumers of this internal get it: the §8.6.2 nomination TIMEOUT
    -- and the CPU's own think-time nomination. Guarded on is_mock — a real
    -- auction has no auto-bidder (§8.6.5). Skipped on the uncontestable
    -- path for the reason draft_nominate's (4c) sets out: 091's candidate
    -- scan needs a non-high-bidder seat with `max_bid >= high + 1`, which is
    -- the witness the predicate has just proved absent.
    PERFORM public.draft_mock_cpu_respond_internal(v_draft.id);
  END IF;

  RETURN v_player;
END;
$$;


REVOKE EXECUTE ON FUNCTION draft_system_nominate_internal(UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. draft_force_pick — §8.7's "pick for a manager", whose AUCTION arm is a
--    commissioner FORCE-NOMINATION (087/R301) and is therefore the THIRD
--    nomination path (banner item 5).
--    REPLACED FROM 092:858-1117 (D137 head rule; 087 -> 092). THREE hunks:
--    the declare, the predicate + announcement key, and the instant award
--    after the system chat line (which names this nomination's sequence
--    number and would be silently renumbered by an earlier award).
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
  v_uncontested BOOLEAN;
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

    -- 093/AP.2 — §8.6.9/E67 on the COMMISSIONER path too. tasks-AP §AP.2
    -- item 3 named two nomination paths; this is the third, and §8.6.9 is
    -- written about NOMINATIONS with no qualifier on who opened one (Chris:
    -- "it should apply no matter where it happens in the draft"). The
    -- precedent for the breakdown missing a live site in this exact family
    -- is D214(1), where §1.3's read-site table missed this same function.
    -- The spec wins where the two disagree (tasks-AP preamble).
    v_uncontested := public.draft_nomination_uncontestable(
                       p_draft_id, v_draft.on_clock_team_id, v_nom_floor);

    -- Open the BIDDING phase (D126). current_pick_number is NOT advanced —
    -- it IS this nomination's sequence number until the award (D157(2)) —
    -- and on_clock stays the NOMINATOR.
    -- 093/AP.2: the uncontestable arm adds the ADDITIVE `"uncontested"` key
    -- the room reads and opens NO bid clock (D199(4)/E67) — draft_nominate
    -- carries the full reasoning; one mechanism, three callers.
    UPDATE public.drafts SET
      current_nomination = jsonb_build_object(
                             'player_id', p_player_id,
                             'high_bid', v_nom_floor,
                             'high_bidder_team_id', v_draft.on_clock_team_id)
                           || CASE WHEN v_uncontested
                                   THEN jsonb_build_object('uncontested', TRUE)
                                   ELSE '{}'::jsonb END,
      current_deadline   = CASE WHEN v_uncontested THEN NULL
                                ELSE now() + make_interval(secs => v_bid_seconds)
                           END,
      updated_at         = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_draft;

    -- The system chat line is written BEFORE the instant award on purpose:
    -- it names `v_draft.current_pick_number`, which IS this nomination's
    -- sequence number until the award advances it (D157(2)). Awarding first
    -- would silently renumber the sentence.
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (v_draft.league_id, auth.uid(),
            'Nomination ' || v_draft.current_pick_number || ' made by commissioner '
            || public.draft_actor_name() || ' for '
            || COALESCE(v_team_name, 'the team on the clock')
            || ': ' || v_player_name || ' at $' || v_nom_floor || '.',
            'draft:' || p_draft_id::text, TRUE);

    IF v_uncontested THEN
      -- THE INSTANT AWARD (§8.6.9/E67) — the same extracted award (D199(3)).
      PERFORM public.draft_award_nomination_internal(p_draft_id);
      SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
    END IF;

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
