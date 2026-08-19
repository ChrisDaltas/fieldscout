-- ============================================================================
-- Auction realtime — migration 088 (task L.C1.6; spec §9 ALL — the v2.0
-- transport rule — §9.1/§9.2/§9.3, §12.5 (the v2.12.2/v2.12.4 `voided_at`
-- row), §12.14 (the Broadcast-from-DB trigger inventory — its `draft_bids`
-- row is filled in by this migration, spec changelog v2.12.6), §16.3;
-- delivery plan §8.4; tasks-M3 §2 (070's payload/exclusion lines + the
-- inert-default pin), §4 standing rules (rule 5 — the realtime doctrine —
-- LITERAL here), §5 channels/payloads, §6 L.C1.6 AS AMENDED (R372/R379);
-- D133 (Client Broadcast STAYS CLOSED), D134 (the payload extensions),
-- D137 (CREATE OR REPLACE at the chain HEAD), D109 (070's mechanics —
-- the envelope, the send-vs-broadcast_changes adaptation, event = table
-- name), D162 (`voided_at` — three writers); PROGRESS F58 + F69 (both
-- discharged by this migration's pgTAP 037 / this banner); D184.
--
-- What ships here:
--   1. `draft_bid_broadcast_payload(draft_bids)` — the column-select unit
--      for a bid row (the §9.2 "broadcast only the columns clients render"
--      rule made a TESTABLE UNIT, the 070 pattern) — EXACTLY
--      {nomination_seq, player_id, team_id, amount, created_at, voided_at}.
--      NEVER action_id (another client's idempotency key — the DoD break
--      probe target), never id / draft_id / league_id (the topic identifies
--      the draft; a bid row is identified on the wire by the tuple it
--      carries — D109(2)'s no-row-id posture, the draft_picks precedent).
--      `voided_at` is IN the key set (F69 (a)): it is NULL on every INSERT
--      (085's bid verbs and 086's system opening never write it), and it is
--      carried anyway so the bid record has ONE shape and a client that
--      re-reads a row by REST sees exactly the fields it saw on the wire.
--   2. `broadcast_draft_bid_insert()` + `tr_broadcast_draft_bids` — AFTER
--      INSERT FOR EACH ROW on draft_bids → topic `draft:<draft_id>`, EVENT
--      'draft_bids' (the name the M2 client's inert-default pin proves
--      harmless — use-draft-ops.test.ts fires literally 'draft_bids'),
--      operation 'INSERT', the envelope 070 composes ({operation, table,
--      schema, record} via realtime.send — D109(1)). A bid is never bulk
--      (one opening row per nomination, one row per raise), so per-row is
--      the honest granularity for INSERT.
--   3. `draft_bid_void_broadcast_payload(draft_bids[])` +
--      `broadcast_draft_bid_void()` + `tr_broadcast_draft_bids_void` — THE
--      F69 DECISION, banner item 2 below: a void DOES emit an event, ONE per
--      void STATEMENT (never one per row), event 'draft_bids', operation
--      'UPDATE', record = {voided_at, voided_count, nominations:[{
--      nomination_seq, player_id} …]}.
--   4. `CREATE OR REPLACE draft_broadcast_payload` (+= current_nomination,
--      budget_adjustments) and `draft_pick_broadcast_payload` (+= price) —
--      D134, authored against 070's CURRENT bodies (D137; banner item 5).
--      The 070 trigger functions (`broadcast_draft_update`,
--      `broadcast_draft_pick_change`) are NOT replaced — they call the
--      payload functions by name and pick the new bodies up at runtime.
--   5. NO realtime.messages policy change — D133 recorded in banner item 4.
--      Client Broadcast stays presence-only; pgTAP 037 re-runs 070's
--      negative (a member's extension='broadcast' INSERT refused) ON AN
--      AUCTION TOPIC.
--   6. NO DDL. No table, column, index, or policy is created or changed.
--      Two new payload functions, two new trigger functions, two new
--      triggers, two CREATE OR REPLACEs of shipped payload functions.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 1 — WHAT THE WIRE CARRIES, AND WHAT IT NEVER CARRIES (D134 +
-- the §9.2 "columns clients render" rule, re-stated with the auction
-- columns now IN the inventory).
-- ---------------------------------------------------------------------------
-- `drafts` UPDATE (event 'drafts'), after this migration — 10 keys:
--   status · current_pick_number · current_round · on_clock_team_id ·
--   current_deadline · paused_at · deadline_remaining_ms · updated_at
--   (the 070 eight: the §5 inventory + deadline_remaining_ms, D109(2))
--   + current_nomination (D134 — the high bid IS the auction room's
--     centerpiece: {player_id, high_bid, high_bidder_team_id} per 065:121's
--     printed shape; NULL ⇔ nominating phase, D126) — every bid raises it,
--     so every bid ALREADY produces a 'drafts' event; this is the event the
--     bid-clock/anti-snipe display and the high-bid stage render from
--   + budget_adjustments (D134 — §8.7 transparency wants commissioner
--     budget edits room-visible; the room's per-team budgets are DERIVED
--     client-side from picks(price) + this map by L.C2.1's TS mirror of
--     084's family, display math only — the server never trusts it).
--   STAYS OUT (re-enumerated): config (the §7.3.8 blob — blind; the auction
--   clocks/budget/min-bid the room needs are read once from the fetched
--   league settings, not per event), is_mock, id, league_id (the topic
--   identifies the draft), draft_order and nomination_order (not in D134's
--   list; not per-event render data — on_clock_team_id IS broadcast and is
--   what the rotation display needs each event; the full order lives on the
--   fetched row and is re-read on every confirmed (re)join per §9.3),
--   started_at / completed_at / created_at (lifecycle stamps nothing
--   renders live — see banner item 3 for why started_at in particular is
--   NOT put on the wire as a "run key").
-- `draft_picks` INSERT/UPDATE (event 'draft_picks') — 7 keys: the §5 six
--   (pick_number, round, team_id, player_id, is_auto, is_undone)
--   + price (D134 — the auction board renders spend; NULL on every snake
--     row, which is exactly what 066 writes there).
--   STAYS OUT: action_id (another client's idempotency key), picked_by,
--   made_via (the board renders is_auto), id / draft_id / league_id.
-- `draft_bids` INSERT (event 'draft_bids', operation 'INSERT') — 6 keys:
--   nomination_seq, player_id, team_id, amount, created_at, voided_at.
--   STAYS OUT: action_id, id, draft_id, league_id.
-- `draft_bids` void (event 'draft_bids', operation 'UPDATE') — 3 keys:
--   voided_at, voided_count, nominations (see item 2).
-- `league_chat`, `leagues`, `league_rosters`, 'tick' — unchanged.
-- Never broadcast, unchanged: draft_queues, draft_liveness, and
-- draft_dnd_marks (§9.2 blind prep; C42 — the engine never reads it). THIS
-- migration is the first that makes broadcast real for the 083 schema
-- family, so pgTAP 037 is where F58's two ABSENCE pins land: after the
-- draft_bids triggers exist, draft_dnd_marks still carries NO broadcast
-- trigger and appears in NO publication, and no pg_proc body in `public`
-- references it (the 065/070 inventory-pin pattern).
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 2 — THE F69 DECISION: A VOID EMITS AN EVENT — ONE PER VOID
-- STATEMENT, NEVER ONE PER ROW — AND HERE IS WHAT IT CARRIES AND WHY.
-- ---------------------------------------------------------------------------
-- The problem, as F69/R372 and the R379 amendment state it: 087 gave
-- `draft_bids` a `voided_at` and THREE writers stamp it (D162/§12.5 v2.12.4:
-- (a) `draft_void_nomination_internal` — cancel + draft_end's un-awarded
-- close, one nomination's rows; (b) `draft_undo`'s rewind sweep — every live
-- row above the rewind point; (c) `draft_reset`'s end-of-run sweep — EVERY
-- live row of the run). A void is an UPDATE, and an INSERT-only trigger
-- would leave a client that saw a bid never learning it was struck. The
-- three candidate answers the task banner names, adjudicated:
--
--   * "an UPDATE OF voided_at arm" — RIGHT IN KIND, WRONG IN GRANULARITY if
--     taken per row: situation (c) stamps an arbitrary number of rows in one
--     statement (a 12-team auction carries hundreds of bid rows), and the
--     R379 amendment rules out "one event per row" for exactly that case.
--     THE SHAPE TAKEN: a STATEMENT-LEVEL AFTER UPDATE trigger with
--     transition tables (REFERENCING OLD TABLE … NEW TABLE …), which sees the
--     whole set of rows the statement touched and emits ONE event carrying
--     the DISTINCT nominations that were voided. Postgres does not allow a
--     column list (`UPDATE OF voided_at`) on a trigger that declares
--     transition tables (SQLSTATE 0A000, verified live), so the column
--     discrimination is done IN-BODY instead: a row counts as VOIDED only
--     when its OLD.voided_at IS NULL and NEW.voided_at IS NOT NULL (the
--     before/after transition tables joined on id). An UPDATE that touches
--     any other column, or a stamp that matches zero rows (the helper's
--     `voided_at IS NULL` guard on a second cancel; a reset on a snake
--     draft, which has no bid rows), emits NOTHING — pinned both ways.
--   * "a drafts payload carrying the voided seq" — REJECTED as the vehicle.
--     Every void site does update the drafts row in the same transaction,
--     so a 'drafts' event always ACCOMPANIES a void, but a client would have
--     to INFER the void from side effects (current_nomination went NULL
--     without current_pick_number advancing; current_pick_number decreased;
--     status left live/paused) and could not tell WHICH rows were struck
--     without a refetch. A void is a fact about bid rows; it belongs on the
--     bid event, stated, not inferred. (The accompanying 'drafts' event is
--     still useful to the client: it is the phase/clock truth.)
--   * "the room re-reads history on the next draft_bids INSERT and that is
--     sufficient" — REJECTED. It is sufficient for the CANCEL case only by
--     accident (cancel is paused-only and the next INSERT is the same
--     nominator's renomination on resume), and it is wrong for reset (the
--     next INSERT is the NEXT RUN's opening bid — a client holding the
--     previous run's rows would merge two runs at seq 1 until it noticed)
--     and silent for draft_end (no INSERT ever follows). §9's "cache hint +
--     refetch on doubt" does not license leaving a client with no signal
--     that doubt exists.
--
-- THE RECORD of a void event — {voided_at, voided_count, nominations}:
--   voided_at     the stamp (max over the statement's rows — one statement
--                 writes one now(), so max = the value);
--   voided_count  how many bid rows the statement voided (the same number
--                 087's system posts print — "N bids are voided");
--   nominations   the DISTINCT (nomination_seq, player_id) pairs voided,
--                 ordered by seq then player — bounded by the number of
--                 NOMINATIONS, not bids (a reset of a 180-nomination
--                 auction lists ≤ 180 pairs in one event), and exactly the
--                 identity a client's feed needs to strike the right rows:
--                 every writer voids WHOLE nominations, and at any instant
--                 at most ONE nomination's rows are live at a given seq
--                 (a seq's earlier nomination was voided when the seq was
--                 cleared or rewound onto — the D162 invariant), so a
--                 (seq, player) pair names an unambiguous row set.
--   NOT carried: amounts, team_ids, created_ats of the voided rows (the
--   client already holds them from the INSERT events or its REST read —
--   repeating them per row is the per-row payload the bulk rule forbids by
--   another name), action_id (never), the run key (item 3).
--
-- WHY event 'draft_bids' with operation 'UPDATE' rather than a new event
-- name: D109(1) — EVENT = the table name, the operation inside the payload;
-- the client discriminates on operation exactly as it does for
-- 'draft_picks' INSERT vs UPDATE. The record shape differs by operation
-- (a row for INSERT, a void summary for UPDATE) and that is stated here and
-- in the client reducer's types; an M2-era client ignores both (the inert
-- default), a post-088 client dispatches on operation.
--
-- Consequence for the three writers (no change to any of them): cancel /
-- draft_end emit ONE void event (the helper's single UPDATE); draft_undo on
-- an auction emits up to TWO (the helper's live-nomination void, then the
-- rewind sweep — two statements, each its own event; zero when a statement
-- matches no rows); draft_reset emits ONE for the whole run (one sweep
-- statement) and ZERO on a snake draft. The 'draft_picks' UPDATE events a
-- reset/undo already emit per undone pick row are M2's shipped per-row
-- posture and are untouched.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 3 — THE CROSS-RUN QUESTION (R379 (b)): NO RUN KEY RIDES THE
-- WIRE; `voided_at` + the reset's bulk void event ARE the discriminators.
-- ---------------------------------------------------------------------------
-- The amendment asks whether a client-side bid cache keyed on
-- nomination_seq needs `drafts.started_at` in the payload to stay
-- unambiguous across a reset. The answer is NO, for two reasons that are
-- each sufficient:
--   (i)  The only reader that must SEE voided rows — 087's `draft_undo`
--        on-clock recovery — is server-side and scopes by started_at
--        itself. A CLIENT never needs voided rows: the room's feed holds
--        LIVE rows only (`voided_at IS NULL`), and a live set is run-pure by
--        construction — situation (c) stamps the WHOLE previous run before
--        the next run writes a row.
--   (ii) The client does not have to "notice" a reset to drop its rows:
--        the reset's sweep emits ONE void event naming every live
--        nomination it struck (item 2), so the client's cache is emptied by
--        the same event stream that filled it; and §9.3's fetch-first on
--        every confirmed (re)join re-reads `voided_at IS NULL` history,
--        which after a reset is the new run's alone.
-- Putting started_at on the wire would carry a column no client renders
-- (§9.2) to solve a problem the event stream already closes. If a future
-- consumer wants struck-through HISTORY in the room (voided rows rendered,
-- not dropped), it reads them by REST scoped by the fetched row's
-- started_at — the same key the engine uses — and that is a feature
-- decision for the room task, recorded here so it is not re-derived as a
-- payload gap.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 4 — D133, RECORDED: CLIENT BROADCAST STAYS CLOSED.
-- ---------------------------------------------------------------------------
-- This migration adds NO `extension = 'broadcast'` INSERT policy on
-- realtime.messages. The "bid-button pulse" §9's Client Broadcast row names
-- IS the authoritative draft_bids INSERT broadcast above — sub-second and
-- fan-out-cheap — and v1 auction has no typing indicator. A member who
-- could client-broadcast could forge a server-shaped 'drafts' /
-- 'draft_picks' / 'draft_bids' event to the whole room (the same spoof
-- D109(5) refused in 070). The four 070 policies stand byte-identical
-- (pgTAP 037 re-pins the policy count + the member extension='broadcast'
-- refusal on an AUCTION topic, and the presence INSERT still allowed).
-- Revisit only with a named consumer + a forgery-safe event namespace
-- (v1.1 at earliest — D133's own clause).
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 5 — D137 HEAD-RULE PROVENANCE, PER REPLACED FUNCTION.
-- ---------------------------------------------------------------------------
-- Headship established by `grep -n 'FUNCTION <name>' supabase/migrations/
-- *.sql`: BOTH payload functions have their ONLY prior definition in 070;
-- no later migration re-emits either (the trigger functions that call them
-- are likewise 070-only and are not replaced here).
--   draft_broadcast_payload       ← 070:139–155 (only definition)
--   draft_pick_broadcast_payload  ← 070:163–177 (only definition)
-- Each body below was extracted from that exact CREATE → `$$;` range and
-- edited; the PR body carries the `diff -u` hunk counts (the L.C1.5
-- recipe: extract both bodies CREATE→`$$;`, `diff -u`, count `@@`):
--   draft_broadcast_payload       1 hunk (+2/−0 over the 16-line head
--                                 body: two keys appended)
--   draft_pick_broadcast_payload  1 hunk (+1/−0 over the 14-line head
--                                 body: one key appended)
--   (the comment blocks ABOVE each CREATE are outside the measured body and
--   are rewritten freely — they restate the inventory with the auction
--   columns IN it)
-- Re-derived whenever either body changes in this PR's fix cycles.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 6 — WHAT THE CLIENT DOES WITH THIS (recorded here so the wire
-- contract and its consumer are one record; built in the same PR).
-- ---------------------------------------------------------------------------
-- `use-draft.ts` subscribes 'draft_bids' on the SAME `draft:<id>` channel
-- — §9.3's ≤ 3-channel budget is untouched: the room still opens exactly
-- ONE channel (the DR.6 sweep pin `.channel(` = 1 in src/ stands; the
-- topic now multiplexes drafts / draft_picks / draft_bids / league_chat /
-- tick + Presence). The room reducer patches current_nomination +
-- budget_adjustments into the cached draft and price into the cached pick
-- (the D134 fields made live); the bid FEED is NOT room state (the chat
-- precedent, L.B3.3): `use-draft-bids.ts` owns the live-history query
-- (RLS member SELECT, `voided_at IS NULL`) and a pure reducer that appends
-- INSERT rows (tuple-deduped) and strikes UPDATE-void nominations by
-- (seq, player). The M2 reducer fed these payloads is pinned inert/stripping
-- cleanly (tasks-M3 §2's forward-compat claim, made falsifiable — and
-- CORRECTED: the record types are plain TypeScript interfaces with
-- structural guards, not Zod parses; additive keys are ignored because the
-- reducer copies NAMED fields, which the pin now states).
--
-- Grants doctrine (tasks-M1 §4.1, D18→D23; M3 §4 rule 1): the payload
-- functions are plain (non-SECURITY-DEFINER) STABLE internals under triple
-- REVOKE (the 062/070 form; no client consumer — the trigger functions are
-- their only caller besides pgTAP); the trigger functions are SECURITY
-- DEFINER `SET search_path = ''` per the §9.2 printed pattern and are
-- REVOKEd from PUBLIC/anon/authenticated as hygiene (they fire as owner and
-- are uncallable as triggers anyway). No table grant changes; realtime.
-- messages keeps its platform grants — RLS with the 070 policies is the
-- effective gate.
--
-- Lock/latency (§4.6): both triggers run AFTER ROW / AFTER STATEMENT inside
-- the writing transaction, under the already-held draft-row lock — one
-- jsonb build + one realtime.messages INSERT per bid (~sub-ms; the 085 wire
-- suite's held-lock < 50ms bound for the BID family runs with this trigger
-- LIVE from here on), and one aggregate over the voided rows + one INSERT
-- per void statement. realtime.send() traps its own errors (D109(1)), so a
-- realtime outage can never fail a bid, a cancel, an undo, or a reset.
--
-- Migration checklist (plan §8.1 / tasks-M3 §4.4): NO DDL (functions +
-- triggers only; no table/column/index/policy created or changed) · no
-- data change · additive on the wire (old clients strip the new keys and
-- ignore the new event — pinned) · staging rehearsal: R6 waiver — no
-- staging clone exists (local + prod only); the recorded rehearsal is the
-- fresh local `npx supabase db reset` replay of the full 001–090 chain in
-- this PR, plus pgTAP 037 (and 024's pins amended in place to the new key
-- sets — tests are tests, D137's note) · typegen re-run with the
-- hand-written alias block re-appended byte-identical (additive-only diff:
-- the two new payload functions; trigger functions are not emitted).
-- Hosted note: realtime.send + transition-table triggers exist on every
-- current hosted project (Postgres ≥ 10; local is 17) — applies cleanly
-- under the migration role.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The bid payload unit (§9.2 "nothing blind", D134; banner item 1)
-- ---------------------------------------------------------------------------

-- draft_bids → exactly {nomination_seq, player_id, team_id, amount,
-- created_at, voided_at}. NOT broadcast: action_id (another client's
-- idempotency key — THE break-probe target), id / draft_id / league_id
-- (the topic identifies the draft; the tuple identifies the row on the
-- wire — D109(2)). voided_at rides every INSERT as NULL on purpose (F69
-- (a)): one record shape, and the REST row a client re-reads matches.
CREATE OR REPLACE FUNCTION draft_bid_broadcast_payload(b draft_bids)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'nomination_seq', b.nomination_seq,
    'player_id',      b.player_id,
    'team_id',        b.team_id,
    'amount',         b.amount,
    'created_at',     b.created_at,
    'voided_at',      b.voided_at);
$$;

REVOKE EXECUTE ON FUNCTION draft_bid_broadcast_payload(draft_bids)
  FROM PUBLIC, anon, authenticated;

-- The VOID summary unit (banner item 2) over the rows ONE statement voided:
-- {voided_at, voided_count, nominations:[{nomination_seq, player_id} …]}
-- with the pairs DISTINCT and ordered (seq, player) — deterministic for the
-- stored-literal pins and for the client's strike loop. An empty array in
-- yields a well-formed object (count 0, nominations []) — the trigger never
-- sends it, but the unit is total.
CREATE OR REPLACE FUNCTION draft_bid_void_broadcast_payload(p_rows draft_bids[])
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'voided_at',    (SELECT max(b.voided_at) FROM unnest(p_rows) b),
    'voided_count', (SELECT count(*) FROM unnest(p_rows) b),
    'nominations',  COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object('nomination_seq', s.nomination_seq,
                                   'player_id',      s.player_id)
                ORDER BY s.nomination_seq, s.player_id)
         FROM (SELECT DISTINCT b.nomination_seq, b.player_id
                 FROM unnest(p_rows) b) s),
      '[]'::jsonb));
$$;

REVOKE EXECUTE ON FUNCTION draft_bid_void_broadcast_payload(draft_bids[])
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Trigger functions (§9.2 printed pattern: SECURITY DEFINER,
--    search_path = '', RETURN NULL) + triggers on draft_bids
-- ---------------------------------------------------------------------------

-- INSERT: one event per bid row (opening bids and raises are single-row
-- writes — 085's verbs, 086's system opening, 087's force-nominate).
CREATE OR REPLACE FUNCTION broadcast_draft_bid_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'operation', TG_OP,
      'table',     TG_TABLE_NAME,
      'schema',    TG_TABLE_SCHEMA,
      'record',    public.draft_bid_broadcast_payload(NEW)),
    'draft_bids',
    'draft:' || NEW.draft_id::text,
    true);
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION broadcast_draft_bid_insert()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_broadcast_draft_bids
  AFTER INSERT ON draft_bids
  FOR EACH ROW EXECUTE FUNCTION broadcast_draft_bid_insert();

-- VOID: ONE event per UPDATE STATEMENT that stamps voided_at on ≥ 1 row
-- (banner item 2). Statement-level with OLD/NEW transition tables; the
-- column discrimination is in-body (Postgres forbids `UPDATE OF col` with
-- transition tables): a row is VOIDED by this statement iff OLD.voided_at
-- IS NULL AND NEW.voided_at IS NOT NULL. Grouped by draft_id (every writer
-- is draft-scoped, so one group — written as a loop so the trigger is
-- correct even for a privileged cross-draft statement). Zero voided rows
-- ⇒ no send.
CREATE OR REPLACE FUNCTION broadcast_draft_bid_void() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_group RECORD;
BEGIN
  FOR v_group IN
    SELECT n.draft_id, array_agg(n::public.draft_bids) AS voided_rows
    FROM   after_rows n
    JOIN   before_rows o ON o.id = n.id
    WHERE  o.voided_at IS NULL
      AND  n.voided_at IS NOT NULL
    GROUP BY n.draft_id
  LOOP
    PERFORM realtime.send(
      jsonb_build_object(
        'operation', TG_OP,
        'table',     TG_TABLE_NAME,
        'schema',    TG_TABLE_SCHEMA,
        'record',    public.draft_bid_void_broadcast_payload(v_group.voided_rows)),
      'draft_bids',
      'draft:' || v_group.draft_id::text,
      true);
  END LOOP;
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION broadcast_draft_bid_void()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_broadcast_draft_bids_void
  AFTER UPDATE ON draft_bids
  REFERENCING OLD TABLE AS before_rows NEW TABLE AS after_rows
  FOR EACH STATEMENT EXECUTE FUNCTION broadcast_draft_bid_void();

-- ---------------------------------------------------------------------------
-- 3. D134 — the drafts + draft_picks payload extensions (CREATE OR REPLACE
--    against 070's CURRENT bodies, D137 — banner item 5). 070's trigger
--    functions call these by name and pick the new bodies up unchanged.
-- ---------------------------------------------------------------------------

-- drafts → the §5 inventory columns + deadline_remaining_ms (rendered by
-- the §16.5.2 pause overlay — "broadcast only the columns clients render"
-- INCLUDES it; recorded extension, D109) + the D134 auction pair:
-- current_nomination (the room's centerpiece — {player_id, high_bid,
-- high_bidder_team_id}, NULL ⇔ nominating phase per D126) and
-- budget_adjustments (§8.7 transparency — the room derives budgets from
-- picks(price) + this map, display math only). updated_at is the D92
-- state_version. NOT broadcast: config (§7.3.8 blob — blind), is_mock/ids
-- (the topic identifies the draft), draft_order/nomination_order (not per-
-- event render data; read from the fetched row), lifecycle stamps.
CREATE OR REPLACE FUNCTION draft_broadcast_payload(d drafts)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'status',                d.status,
    'current_pick_number',   d.current_pick_number,
    'current_round',         d.current_round,
    'on_clock_team_id',      d.on_clock_team_id,
    'current_deadline',      d.current_deadline,
    'paused_at',             d.paused_at,
    'deadline_remaining_ms', d.deadline_remaining_ms,
    'updated_at',            d.updated_at,
    'current_nomination',    d.current_nomination,
    'budget_adjustments',    d.budget_adjustments);
$$;

REVOKE EXECUTE ON FUNCTION draft_broadcast_payload(drafts)
  FROM PUBLIC, anon, authenticated;

-- draft_picks → the §5 six + price (D134 — the auction board renders
-- spend; NULL on every snake row, the literal NULL 066 writes). NOT
-- broadcast: action_id (another client's idempotency key is nobody's
-- business), picked_by/made_via (not in the inventory; the board renders
-- is_auto), ids (topic + pick_number identify the cell).
CREATE OR REPLACE FUNCTION draft_pick_broadcast_payload(p draft_picks)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'pick_number', p.pick_number,
    'round',       p.round,
    'team_id',     p.team_id,
    'player_id',   p.player_id,
    'is_auto',     p.is_auto,
    'is_undone',   p.is_undone,
    'price',       p.price);
$$;

REVOKE EXECUTE ON FUNCTION draft_pick_broadcast_payload(draft_picks)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. realtime.messages: NO policy change (D133 — banner item 4). The four
--    070 policies stand; pgTAP 037 re-pins the count and the
--    extension='broadcast' member refusal on an auction topic.
-- ---------------------------------------------------------------------------
