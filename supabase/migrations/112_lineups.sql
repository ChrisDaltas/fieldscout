-- ============================================================================
-- Lineups — migration 112 (task L.D1.4; spec v2.16.15 → v2.16.16 by this PR's
-- fold-back (§11.2/§12.13 annotations, no rule change); the #253 fix round
-- (R736–R742) amended IN PLACE — unreleased chain; §11.2 lineups & lock /
-- §12.13 `team_lineups` extension / §7.3.6 `lineup_lock` + `allow_illegal_
-- lineups` / §7.3.2 slot config + IR slot rules / §11.1 roster legality
-- (bipartite fit) / E16 / E42 / §23.3; tasks-M4 §4 standing rules 1–11;
-- D291 / D293; ledger F18 (the C12 half — DISCHARGED here) / F35 (re-affirmed:
-- NO predicate below reads `team_managers`; access derives from
-- `league_members`); D308).
--
-- Numbering: migration head measured 111 at task time (ls supabase/migrations/
-- | tail -1) ⇒ 112, pgTAP head 059 ⇒ 060 — the tasks-M4 §7 reservations
-- CONFIRMED, not inherited (D161/D166).
--
-- D137 provenance: NO existing function is replaced. `schedule_window_internal`
-- (111) is CALLED by name for the week datum, never copied. `is_league_member`
-- / `is_league_commish` (052) are called by name. The two 001 policies on
-- `team_lineups` (001:853–861) are DROPPED by name and replaced — that is
-- the F18 swap, not a function replacement.
--
-- WHAT THIS MIGRATION DOES
--   1. `team_lineups` §12.13 ALTER — `slot_map JSONB` (the canonical lineup:
--      "<slot_key>:<index>" → player_id; slots with count > 1 expand to
--      indexed instances; IR spots are "<ir_key>:0"), `locked_at`,
--      `edited_by_commish` (R43-class: NOT NULL DEFAULT FALSE — a two-valued
--      flag, the D302(2) shape) + an is-object CHECK on `slot_map`.
--   2. THE F18 SWAP (C12). 001's world-readable SELECT ("Lineups follow team
--      visibility", USING (true)) and its owner-keyed FOR ALL ("Users can
--      manage own team lineups", keyed on `teams.owner_id`) are DROPPED.
--      Replaced by ONE member-truth SELECT — `is_league_member(
--      team_league_id(team_id))` — and NO client write policy for any role:
--      lineups are written by `set_lineup` only (server-authoritative, §12).
--      LEGACY ROWS (the pre-league teams feature): a `team_lineups` row whose
--      team has `league_id IS NULL` is reachable by NO policy after this
--      migration — EXPLICITLY ORPHANED, not owner-readable. Measured on the
--      local stack 2026-09-02: `team_lineups` holds 0 rows (0 standalone, 0
--      league); production was NOT queried from this session (the Builder
--      cannot) and may differ — the disposition is safe either way because
--      NO application code reads or writes `team_lineups` (`grep -rn
--      team_lineups src e2e scripts` → only `src/types/database.ts`; 053's
--      banner: "no app code writes teams"), so an orphaned legacy row is a
--      row nobody could see before through any product surface either. If
--      the standalone teams feature returns, it gets its own policy then
--      (recorded in PROGRESS D308 + F224). pgTAP 060 pins the orphan: a
--      standalone team's owner reads 0 of its own legacy lineup rows while
--      postgres sees them.
--   3. `lineup_actions` — the idempotency ledger for `set_lineup` (the 111
--      `schedule_actions` shape, D307(2)): a lineup's domain row is
--      OVERWRITTEN by every later set, so an action_id stamped on the row
--      would be erased by the next edit and a stale retry of an EARLIER
--      submit would re-execute over the newer lineup. A ledger row survives
--      every later action; the replay is exact (the stored jsonb returned
--      byte-identically). RLS on with ZERO policies (the 109 score_fanout
--      shape). Not an audit (no reason/before/after — `commissioner_actions`
--      is M6's).
--   4. `set_lineup(p_league_id, p_team_id, p_week, p_slot_map, p_action_id)`
--      — SECURITY DEFINER, `search_path = ''`, in-body auth, REVOKE FROM
--      PUBLIC/anon — the ONLY writer of `team_lineups`. It reads transaction
--      `now()` for every lock instant (the D307(3) precedent: a client-facing
--      verb never takes a caller-supplied instant — a manager could pick the
--      free window) and calls `set_lineup_internal(…, p_at)` — the internal
--      seam pgTAP drives at kickoff±1s. Both stated here per rule 10.
--      Pipeline (D293 / the §5 sketch): lock the LEAGUE row first (rule 8),
--      then the lineup row → membership/ownership (manager of THIS team via
--      `league_members.team_id`, or a commissioner — NEVER a stint, F35) →
--      replay lookup → league in_season/playoffs → week on the league's
--      calendar and not in the past → every started/IR'd player rostered by
--      the team → the BIPARTITE fit (E16; below) → lock refusals per
--      `lineup_lock` (E42: every instant read from `nfl_games.kickoff_at`
--      at evaluation time) → IR law (§11.2) → `allow_illegal_lineups`
--      semantics (§7.3.6) → ONE write of `slot_map` + derived `starters`/
--      `bench` + `locked_at` + `edited_by_commish`, `league_rosters.slot_key`
--      / IR columns maintained in the same txn, the ledger row, the result.
--
-- THE BIPARTITE FIT (E16 / §11.1), and why the RPC does the fitting.
--   `lineup_fit_internal(slots, players)` is a pure augmenting-path matcher
--   (BFS over alternating paths — ≤ ~10 starters, ≤ ~12 slot instances).
--   The submitted `slot_map` KEYS are the manager's placement; every
--   placement that is valid per slot (position ∈ slot.eligible) is seeded
--   verbatim and kept unless an augmenting path NEEDS to move it; a player
--   whose placement is per-slot invalid is re-seated along an augmenting
--   path if ANY legal arrangement of the started players exists, and the
--   canonical (server) `slot_map` is returned (`rearranged: true`, the
--   moves named). A player for whom no augmenting path exists is REFUSED by
--   name with the slot he wanted and what it accepts (the E16 "names the
--   unfillable slot"). Each player fills exactly one slot (a duplicate value
--   refuses before the fit). A greedy first-eligible assignment fails the
--   two-flex trap (RB wanted at W/T beside a WR at W/R/T: bipartite re-seats
--   WR → W/T and RB → W/R/T; greedy reports RB unplaceable) — that is the
--   DoD break probe. LOCKED players are FIXED vertices: the matcher may not
--   route an augmenting path through a slot a locked player owns (a locked
--   slot's player never moves — rule 9).
--
-- LOCK SEMANTICS (§11.2 / §7.3.6 / E42 / §23.3 — rule 9, never-weaken).
--   Every instant is read from `nfl_games.kickoff_at` AT EVALUATION TIME —
--   never from a precomputed flag. `locked_at` on the row is the RECORD of
--   the lock instant evaluated at write time (the earliest instant any slot
--   of this lineup locks: the week datum under `first_game_of_week`, the
--   earliest started player's kickoff under `per_player_kickoff`), never the
--   decider — the next call re-evaluates from the games table, so a moved
--   kickoff (E42) moves the lock and a stale `locked_at` decides nothing.
--   * `per_player_kickoff` (default): a slot is locked iff its STORED
--     player's game for that week has kicked off (kickoff_at ≤ now); a
--     locked slot's player never moves (replacing him, moving him to another
--     slot, or benching him refuses, naming the player and the kickoff); a
--     player whose game has kicked off never ENTERS or moves slots; every
--     unlocked slot of the same lineup stays editable. The per-player datum
--     is `lineup_kickoff_internal`: min `nfl_games.kickoff_at` of the
--     player's NFL team's game(s) that week; a week with game rows but none
--     for the team is a BYE (no lock, flagged); a week with NO game rows at
--     all falls back to the week datum chain (`schedule_window_internal`:
--     `nfl_weeks.first_kickoff_at` → `starts_at`) for EVERY player — the
--     conservative direction (D307(3): with no game rows the window only
--     narrows). `players.team` joins `nfl_games.home_team/away_team` (both
--     Sleeper abbreviations — L.D2.1's `ingestWeek` writes the game rows
--     from the same provider vocabulary). `players.bye_week` is NOT read:
--     §23.3 makes all logic kickoff-driven.
--   * `first_game_of_week`: the whole lineup locks at the week's first
--     kickoff (the `schedule_window_internal` datum for that week); after it
--     ANY change refuses (an identical submit is `no_changes`, never a
--     refusal — under BOTH `allow_illegal_lineups` settings: a starter ruled
--     OUT after the lock is not the manager's to change, R739 — and once the
--     week is locked EVERY submitted player is a fixed vertex of the fit, so
--     a mid-week position relisting neither re-seats nor unseats a locked
--     starter, R744).
--   * AT the kickoff instant the slot is locked (closed interval on the
--     kickoff side, the E41 convention: "until" is strictly before).
--   * IR moves respect lock timing for the CURRENT week (below) — under BOTH
--     modes: `first_game_of_week` judges an IR move against the CURRENT
--     week's first kickoff (`v_week_locked_cur`), never p_week's, so a
--     future-week submit cannot stash or free a roster spot after the live
--     week has locked (R736 — the #253 fix round).
--   * NO GAME ROWS AND NO `nfl_weeks.first_kickoff_at` ⇒ the CURRENT week is
--     locked for every player from its `starts_at` (Wednesday 00:00 ET):
--     on a stack with no ingested games (the local stack today: 0
--     `nfl_games`, 18 NULL 2026 rows) a current-week lineup cannot be set
--     at all — the conservative posture, said out loud (R740). L.D6.x's
--     sim/gate must seed game rows (or `first_kickoff_at`) before it sets
--     lineups; production has both once L.D2.1/L.D2.3 run.
--   * A LOCKED placement is a FACT: `lineup_fit_internal` seeds a fixed
--     player at his stored slot unconditionally, so a mid-week position
--     relisting cannot make the matcher move him (R737) — in BOTH modes: a
--     player is fixed when his own kickoff has passed (per_player_kickoff)
--     or when the whole week is locked (first_game_of_week — R744).
--
-- THE CURRENT WEEK (for IR tenure and `slot_key` maintenance).
--   `lineup_current_week_internal(league, at)` = the league's greatest
--   `league_weeks.week` whose `nfl_weeks.starts_at` ≤ at (clamped to the
--   league's first week before the season). It reads the NFL calendar TABLE
--   at the week boundaries §23.3 names — the same boundaries L.D1.6's
--   `league_week_advance` (114) will flip `league_weeks.status` on. It is
--   NOT wall-clock arithmetic (no "days since kickoff / 7"). When 114 lands
--   it may replace this read with `league_weeks.status` or keep it — the two
--   derive from the same rows; F224(a) hands that decision to 114's Builder.
--   `league_weeks.status` is NOT read for tenure here because it has no
--   writer on this chain (every row is `upcoming` — R730's lesson).
--
-- IR LAW (§11.2 / §7.3.2 IR slot rules; the columns exist since 072).
--   IR spots are roster-level state (`league_rosters.ir_placed_week`,
--   `ir_lock_until_week`, `slot_key`), NOT per-week lineup state — so an IR
--   move is judged against the CURRENT week whatever `p_week` the submit is
--   for, and the submitted `slot_map` is the WHOLE picture: an IR spot key
--   absent from the map is a REMOVAL from IR (the L.D4.1/L.D5.1 clients
--   always send the full canonical map; the result echoes it).
--   * Placement requires the player to HOLD one of the spot's
--     `eligible_designations` at call time; the vocabulary bridge is
--     `lineup_designation_internal`: the feed writes Sleeper's spellings into
--     `players.status` (C56 — measured on the stack: Active, Questionable,
--     IR, Inactive, PUP, Sus, DNR, NA; the feed's `Out`/`Doubtful`/`NFI`/
--     `COV` when they occur) and the catalog's `IR_DESIGNATIONS` are
--     OUT / IR / Doubtful / PUP / NFI / Suspended (§7.3.2). The bridge maps
--     case-insensitively and `Sus` → `Suspended`; anything else (Active,
--     Questionable, Inactive, NA, DNR, …) is NO designation. F224(b) asks
--     the sync layer to normalize at ingestion so this bridge becomes the
--     identity; until then it is pinned in 060.
--   * Placement sets `ir_placed_week = current week`; a Restricted spot also
--     sets `ir_lock_until_week = ir_placed_week + min_weeks`; removal from a
--     Restricted spot REFUSES while `current_week < ir_lock_until_week`
--     (commissioner override is M6's — this verb has no override arm);
--     Unrestricted spots allow free in/out before the player's lock.
--   * An IR'd player who has lost eligibility STAYS (kept, flagged
--     `ir_ineligible` — "the roster is flagged illegal until moved off"), and
--     a Restricted stint still binds him.
--   * IR'd players never count toward the lineup: a player under an IR key
--     and a starting key in the same map refuses ("exactly one slot").
--   * An IR move whose player's game has kicked off (current week, per the
--     league's lock mode) refuses — "all IR moves respect lineup-lock timing".
--
-- `allow_illegal_lineups` (§7.3.6).
--   A started player is flagged `bye` (the week has game rows and none for
--   his team) or `out` (designation in the non-playing set OUT / IR / PUP /
--   NFI / Suspended — Doubtful and Questionable PLAY as far as the lock is
--   concerned); an empty slot instance is flagged `empty` (allowed under
--   both settings — the setting governs byes/OUT, not vacancies; an empty
--   slot scores 0 like everywhere in the industry). TRUE (default): the
--   lineup is accepted, the flags are stored on `starters[].flags` and
--   returned. FALSE: a submit that would leave a bye/OUT player in an
--   UNLOCKED starting slot is REFUSED by name — "the slot is blocked at
--   submit"; a locked slot's bye/OUT player is not the manager's to change
--   and is only flagged.
--
-- COMMISSIONER ARM (D293 "membership/ownership (or commissioner)"; tasks-M4
--   §12; the D290 interim audit posture — R738). A commissioner may set ANY
--   team's lineup through this verb under the SAME lock law as the manager
--   (no past-lock edit, no past-week edit). An actor who is not the team's
--   manager MUST give `p_reason` — non-blank after trimming spaces, tabs,
--   CR and LF (R745), at most 500 characters (the client chat policy's
--   bound; the DEFINER post bypasses that policy and `league_chat.message`
--   has no CHECK, R746) — 22023 by name otherwise; a real change
--   posts the D97 in-txn `league_chat` system message carrying the reason
--   ("Week N lineup for <team> set by <actor> (commissioner) — reason: …"),
--   and the row records `edited_by_commish = TRUE`. F40's control list
--   GROWS with `set_lineup` (commissioner arm) so M6 wires the audit row.
--   A `no_changes` submit posts nothing (nothing changed); a replay posts
--   nothing (the ledger answers first). The AUDITED override (past lock,
--   retroactive — §11.2's last bullet / §10.2) is M6's path and does not
--   exist here; F224(c) names it — and the commissioner inherits the
--   manager's `allow_illegal_lineups = FALSE` and E16 refusals until then.
--
-- IDEMPOTENCY (rule 10; D68/E2). `p_action_id` REQUIRED (22023). A replay
--   returns the ledger's stored result byte-identically and writes nothing.
--   A submit whose canonical map equals the stored map with no IR move is
--   `no_changes: true` BY NAME (returned, ledgered, nothing else written) —
--   never a silent success. LOUD EMPTINESS: the lineup row is created on
--   first touch (INSERT … ON CONFLICT DO NOTHING, then locked FOR UPDATE and
--   asserted FOUND); every UPDATE's row count is asserted; a week off the
--   league's calendar, a team not in the league, a past week, an empty
--   roster, an unknown slot key, an unrostered player, a duplicated player
--   all refuse BY NAME.
--
-- `slot_key` MAINTENANCE on `league_rosters` (072's "M4 manages" column —
--   "current slot assignment for the active week"): when `p_week` is the
--   CURRENT week, starters take their instance key (`rb:1`), the rest `bn`;
--   IR keys (`ir1:0`) are written on placement and `bn` on removal whatever
--   the week (roster-level). A future-week submit leaves the starters'
--   `slot_key` alone (it describes the active week).
--
-- Falsifiability (rule 9 / §4.3): pgTAP 060 pins the F18 swap from BOTH
-- directions (a member with no teams row reads; a teams-row owner who is not
-- a member reads nothing and writes raise; the legacy orphan), the E16
-- goldens as stored literals (the two-flex trap and its satisfiable twin, a
-- superflex config, the lone-WR pin, the unfillable-slot refusal by name),
-- every lock boundary at kickoff−1s / AT / +1s per mode (the datum moved
-- inside the txn — now() is frozen, D307(3)), E42 (a kickoff moved back to
-- the future re-opens the slot), IR at `ir_lock_until_week`−1 / +0, the
-- designation gate + the vocabulary bridge, illegal lineups under both
-- settings, `no_changes` by name, replay byte-identity, every role, the
-- held lock < 50 ms (min RTT of three). Break probe (PR body): the fit's
-- augmentation replaced by greedy first-eligible → the two-flex golden reds.
--
-- Migration checklist (plan §8.1): additive (three columns + one table + six
-- functions + a policy swap; no column dropped); RLS in the same migration;
-- `IF NOT EXISTS` on every ADD COLUMN; staging-clone rehearsal disposed via
-- the R6 rule (fresh local `db reset` 001–112 is the recorded rehearsal);
-- realtime: NO trigger here — D296 lands the in-season triggers in 117 and
-- `team_lineups` has no broadcast subscriber until L.D5.1 (the D38 dated
-- disposition: 117/L.D1.9 decides whether lineup writes broadcast);
-- typegen + alias-block re-append in the same PR; grants doctrine
-- (D18→D23): no per-object GRANT on any table — RLS is the gate; REVOKE on
-- every function.
--
-- HELD-FROM-PRODUCTION: this migration is registered (range → 082-112) in
-- the same PR. No launch-surface table is touched: the only reads outside
-- the leagues chain are SELECTs on `players`, `nfl_games`, `nfl_weeks`,
-- `teams`; `team_lineups` is 001's but has no launch-surface reader or
-- writer (measured above).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. team_lineups — §12.13 verbatim + the R43-class tightening
-- ---------------------------------------------------------------------------
ALTER TABLE team_lineups
  ADD COLUMN IF NOT EXISTS slot_map JSONB,            -- canonical: "<slot_key>:<index>" → player_id (IR spots "<ir_key>:0")
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,      -- the RECORD of the lock instant evaluated at write time (never the decider)
  ADD COLUMN IF NOT EXISTS edited_by_commish BOOLEAN DEFAULT FALSE;

UPDATE team_lineups SET edited_by_commish = FALSE WHERE edited_by_commish IS NULL;
ALTER TABLE team_lineups ALTER COLUMN edited_by_commish SET NOT NULL;

ALTER TABLE team_lineups
  ADD CONSTRAINT team_lineups_slot_map_is_object
    CHECK (slot_map IS NULL OR jsonb_typeof(slot_map) = 'object');

-- ---------------------------------------------------------------------------
-- 2. THE F18 SWAP (C12): membership truth in, teams-keyed policies out
-- ---------------------------------------------------------------------------
-- The league a team belongs to (NULL for a standalone/legacy team). `teams`
-- is world-readable since 001 (kept by 053 §2 deliberately), so a DEFINER
-- read of `league_id` exposes nothing new; DEFINER + search_path='' is the
-- 052 helper shape so the policy can call a helper rather than inline a
-- subquery (plan §8.2).
CREATE OR REPLACE FUNCTION team_league_id(p_team_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.league_id FROM public.teams t WHERE t.id = p_team_id;
$$;
-- DELIBERATE DEVIATION from rule 1's REVOKE discipline, documented (the
-- 052:27–29 precedent for `is_league_member`/`is_league_commish`): NO
-- "REVOKE EXECUTE … FROM anon" on `team_league_id` — it is an RLS policy
-- predicate, evaluated as the calling role, not an RPC; 037's default ACL is
-- what lets the policy below call it.

DROP POLICY IF EXISTS "Lineups follow team visibility" ON team_lineups;      -- 001:853–854 (world-readable)
DROP POLICY IF EXISTS "Users can manage own team lineups" ON team_lineups;   -- 001:856–861 (owner-keyed FOR ALL)

CREATE POLICY "Lineups viewable by league members"
  ON team_lineups FOR SELECT
  USING (is_league_member(team_league_id(team_id)));
-- NO client write policy for ANY role: `set_lineup` (below) is the only
-- writer. A legacy row on a standalone team (league_id NULL) satisfies no
-- policy — explicitly orphaned (banner §2).

-- ---------------------------------------------------------------------------
-- 3. lineup_actions — the idempotency ledger (the 111 shape; D307(2))
-- ---------------------------------------------------------------------------
CREATE TABLE lineup_actions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  action_id  UUID NOT NULL,                       -- client-minted; dedupes retries (the E2/D68 replay key)
  actor_id   UUID NOT NULL REFERENCES profiles(id),
  result     JSONB NOT NULL,                      -- the verb's returned jsonb, replayed byte-identically
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, action_id)                   -- the race backstop behind the select-then-insert
);
CREATE INDEX idx_lineup_actions_team ON lineup_actions(team_id);

ALTER TABLE lineup_actions ENABLE ROW LEVEL SECURITY;
-- ZERO policies: the DEFINER RPC is the only reader and writer.

-- ---------------------------------------------------------------------------
-- 4. lineup_designation_internal — the players.status → §7.3.2 designation
--    bridge (C56; F224(b))
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_designation_internal(p_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE lower(btrim(COALESCE(p_status, '')))
    WHEN 'out'       THEN 'OUT'
    WHEN 'ir'        THEN 'IR'
    WHEN 'doubtful'  THEN 'Doubtful'
    WHEN 'pup'       THEN 'PUP'
    WHEN 'nfi'       THEN 'NFI'
    WHEN 'sus'       THEN 'Suspended'
    WHEN 'suspended' THEN 'Suspended'
    ELSE NULL
  END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_designation_internal(TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. lineup_current_week_internal — the league's current week from the NFL
--    calendar table at the §23.3 boundaries (banner: THE CURRENT WEEK)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_current_week_internal(
  p_league_id UUID,
  p_at        TIMESTAMPTZ
) RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT max(lw.week)::int
       FROM public.league_weeks lw
       JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
      WHERE lw.league_id = p_league_id AND w.starts_at <= p_at),
    (SELECT min(lw.week)::int FROM public.league_weeks lw WHERE lw.league_id = p_league_id));
$$;
REVOKE EXECUTE ON FUNCTION lineup_current_week_internal(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. lineup_kickoff_internal — the per-player lock datum (E42/§23.3)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_kickoff_internal(
  p_season   INTEGER,
  p_week     INTEGER,
  p_nfl_team TEXT,
  p_at       TIMESTAMPTZ
) RETURNS TABLE (
  kickoff_at TIMESTAMPTZ,
  datum_arm  TEXT,
  on_bye     BOOLEAN
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_week_games INTEGER;
  v_window     RECORD;
BEGIN
  SELECT count(*) INTO v_week_games
  FROM public.nfl_games g
  WHERE g.season = p_season AND g.week = p_week;

  IF v_week_games = 0 THEN
    -- No game rows for the week: the week datum chain decides for EVERY
    -- player (nfl_weeks.first_kickoff_at → starts_at) — conservative.
    SELECT * INTO v_window FROM public.schedule_window_internal(p_season, p_week, p_at);
    kickoff_at := v_window.first_kickoff_at;
    datum_arm  := v_window.datum_arm;
    on_bye     := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT min(g.kickoff_at) INTO kickoff_at
  FROM public.nfl_games g
  WHERE g.season = p_season AND g.week = p_week
    AND p_nfl_team IS NOT NULL
    AND (g.home_team = p_nfl_team OR g.away_team = p_nfl_team);

  IF kickoff_at IS NULL THEN
    datum_arm := 'bye';
    on_bye    := TRUE;
  ELSE
    datum_arm := 'nfl_games';
    on_bye    := FALSE;
  END IF;
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_kickoff_internal(INTEGER, INTEGER, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. lineup_fit_internal — the pure bipartite matcher (E16 / §11.1)
--    p_slots:   [{key, eligible: [pos…]}]                 (canonical order)
--    p_players: [{player_id, position, wanted, fixed}]    (wanted = slot key
--               or null; fixed = locked — must already sit at `wanted`)
--    returns {assignment: {key → player_id}, unplaced: [player_id…],
--             rearranged: bool, moved: [{player_id, from, to}]}
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_fit_internal(
  p_slots   JSONB,
  p_players JSONB
) RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_ns      INTEGER := COALESCE(jsonb_array_length(p_slots), 0);
  v_np      INTEGER := COALESCE(jsonb_array_length(p_players), 0);
  v_skey    TEXT[]    := ARRAY[]::text[];
  v_selig   JSONB[]   := ARRAY[]::jsonb[];
  v_pid     TEXT[]    := ARRAY[]::text[];
  v_ppos    TEXT[]    := ARRAY[]::text[];
  v_pwant   INTEGER[] := ARRAY[]::int[];
  v_pfixed  BOOLEAN[] := ARRAY[]::boolean[];
  v_owner   INTEGER[];      -- slot → player index (0 = free)
  v_match   INTEGER[];      -- player → slot index (0 = none)
  v_visited BOOLEAN[];
  v_parent  INTEGER[];      -- slot → the player that reached it
  v_queue   INTEGER[];
  v_head    INTEGER;
  v_u       INTEGER;
  v_s       INTEGER;
  v_found   INTEGER;
  v_prev    INTEGER;
  v_i       INTEGER;
  v_j       INTEGER;
  v_e       JSONB;
  v_unplaced JSONB := '[]'::jsonb;
  v_assign  JSONB := '{}'::jsonb;
  v_moved   JSONB := '[]'::jsonb;
BEGIN
  FOR v_i IN 1..v_ns LOOP
    v_e := p_slots -> (v_i - 1);
    v_skey  := v_skey  || (v_e ->> 'key');
    v_selig := v_selig || (v_e -> 'eligible');
  END LOOP;
  FOR v_i IN 1..v_np LOOP
    v_e := p_players -> (v_i - 1);
    v_pid   := v_pid   || (v_e ->> 'player_id');
    v_ppos  := v_ppos  || (v_e ->> 'position');
    v_pfixed := v_pfixed || COALESCE((v_e ->> 'fixed')::boolean, FALSE);
    v_j := 0;
    IF v_e ->> 'wanted' IS NOT NULL THEN
      FOR v_s IN 1..v_ns LOOP
        IF v_skey[v_s] = (v_e ->> 'wanted') THEN v_j := v_s; EXIT; END IF;
      END LOOP;
    END IF;
    v_pwant := v_pwant || v_j;
  END LOOP;

  v_owner := array_fill(0, ARRAY[GREATEST(v_ns, 1)]);
  v_match := array_fill(0, ARRAY[GREATEST(v_np, 1)]);

  -- SEED: fixed (locked) players first, UNCONDITIONALLY — a locked placement
  -- is a fact, not a candidate: even if the player's listed position no
  -- longer fits the slot (a mid-week relisting), he stays where he is (R737;
  -- "a locked slot's player never moves"). Then every per-slot-valid free
  -- placement is honored verbatim.
  FOR v_i IN 1..v_np LOOP
    IF v_pfixed[v_i] AND v_pwant[v_i] > 0 AND v_owner[v_pwant[v_i]] = 0 THEN
      v_owner[v_pwant[v_i]] := v_i;
      v_match[v_i] := v_pwant[v_i];
    END IF;
  END LOOP;
  FOR v_i IN 1..v_np LOOP
    IF NOT v_pfixed[v_i] AND v_pwant[v_i] > 0 AND v_owner[v_pwant[v_i]] = 0
       AND v_selig[v_pwant[v_i]] ? v_ppos[v_i] THEN
      v_owner[v_pwant[v_i]] := v_i;
      v_match[v_i] := v_pwant[v_i];
    END IF;
  END LOOP;

  -- AUGMENT: BFS over alternating paths for every unmatched player. A slot
  -- owned by a FIXED player is never traversed (a locked slot's player never
  -- moves). This is the E16 bipartite fit; the DoD break probe replaces it
  -- with "first free eligible slot, else unplaced" and the two-flex golden
  -- reds.
  FOR v_i IN 1..v_np LOOP
    CONTINUE WHEN v_match[v_i] > 0;
    v_visited := array_fill(FALSE, ARRAY[GREATEST(v_ns, 1)]);
    v_parent  := array_fill(0, ARRAY[GREATEST(v_ns, 1)]);
    v_queue := ARRAY[v_i];
    v_head := 1;
    v_found := 0;
    WHILE v_head <= array_length(v_queue, 1) AND v_found = 0 LOOP
      v_u := v_queue[v_head];
      v_head := v_head + 1;
      FOR v_s IN 1..v_ns LOOP
        CONTINUE WHEN v_visited[v_s];
        CONTINUE WHEN NOT (v_selig[v_s] ? v_ppos[v_u]);
        CONTINUE WHEN v_owner[v_s] > 0 AND v_pfixed[v_owner[v_s]];
        v_visited[v_s] := TRUE;
        v_parent[v_s] := v_u;
        IF v_owner[v_s] = 0 THEN
          v_found := v_s;
          EXIT;
        END IF;
        v_queue := v_queue || v_owner[v_s];
      END LOOP;
    END LOOP;
    IF v_found = 0 THEN
      v_unplaced := v_unplaced || to_jsonb(v_pid[v_i]);
    ELSE
      v_s := v_found;
      LOOP
        v_u := v_parent[v_s];
        v_prev := v_match[v_u];
        v_match[v_u] := v_s;
        v_owner[v_s] := v_u;
        EXIT WHEN v_u = v_i;
        v_s := v_prev;
      END LOOP;
    END IF;
  END LOOP;

  FOR v_s IN 1..v_ns LOOP
    IF v_owner[v_s] > 0 THEN
      v_assign := v_assign || jsonb_build_object(v_skey[v_s], v_pid[v_owner[v_s]]);
    END IF;
  END LOOP;
  FOR v_i IN 1..v_np LOOP
    IF v_match[v_i] > 0 AND v_match[v_i] <> v_pwant[v_i] THEN
      v_moved := v_moved || jsonb_build_object(
        'player_id', v_pid[v_i],
        'from', CASE WHEN v_pwant[v_i] > 0 THEN v_skey[v_pwant[v_i]] END,
        'to',   v_skey[v_match[v_i]]);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'assignment', v_assign,
    'unplaced',   v_unplaced,
    'rearranged', jsonb_array_length(v_moved) > 0,
    'moved',      v_moved);
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_fit_internal(JSONB, JSONB) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. set_lineup_internal — the body, at an injected instant (the test seam)
-- ---------------------------------------------------------------------------
-- R747: the #253 fix rounds amended the signatures IN PLACE (unreleased
-- chain); a stack that applied e0518bd's shapes must not keep them as
-- overloads (an ambiguous 5-arg call). The 110 DROP-then-CREATE shape.
DROP FUNCTION IF EXISTS set_lineup_internal(UUID, UUID, INTEGER, JSONB, UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS set_lineup(UUID, UUID, INTEGER, JSONB, UUID);

CREATE OR REPLACE FUNCTION set_lineup_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_week      INTEGER,
  p_slot_map  JSONB,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT DEFAULT NULL   -- REQUIRED (non-blank) when the actor is not the team's manager (R738 / D290)
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_team        public.teams;
  v_row         public.team_lineups;
  v_lw          public.league_weeks;
  v_found       BOOLEAN;
  v_is_manager  BOOLEAN;
  v_is_commish  BOOLEAN;
  v_result      JSONB;
  v_current     INTEGER;
  v_mode        TEXT;
  v_allow       BOOLEAN;
  v_roster      JSONB;
  v_slots       JSONB;
  v_ir_spots    JSONB;
  v_stored      JSONB;
  v_key         TEXT;
  v_val         JSONB;
  v_pid         TEXT;
  v_e           JSONB;
  v_p           JSONB;
  v_seen        JSONB := '{}'::jsonb;
  v_by_pid      JSONB := '{}'::jsonb;   -- player_id → roster element
  v_kick        JSONB := '{}'::jsonb;   -- player_id → {kickoff_at, datum_arm, on_bye} for p_week
  v_kick_cur    JSONB := '{}'::jsonb;   -- the same for the CURRENT week (IR moves)
  v_window      RECORD;
  v_window_cur  RECORD;   -- the CURRENT week's datum (IR moves are judged against it — R736)
  v_k           RECORD;
  v_week_locked BOOLEAN;
  v_week_locked_cur BOOLEAN;
  v_reason      TEXT;
  v_message     TEXT;
  v_fit_players JSONB := '[]'::jsonb;
  v_fit         JSONB;
  v_canon       JSONB := '{}'::jsonb;
  v_starters    JSONB := '[]'::jsonb;
  v_bench       JSONB := '[]'::jsonb;
  v_ir_out      JSONB := '[]'::jsonb;
  v_flags_bye   JSONB := '[]'::jsonb;
  v_flags_out   JSONB := '[]'::jsonb;
  v_flags_empty JSONB := '[]'::jsonb;
  v_flags_irin  JSONB := '[]'::jsonb;
  v_ir_placed   JSONB := '[]'::jsonb;
  v_ir_removed  JSONB := '[]'::jsonb;
  v_pflags      JSONB;
  v_locked_at   TIMESTAMPTZ;
  v_no_changes  BOOLEAN;
  v_cnt         INTEGER;
  v_expected    INTEGER;
  v_spot        JSONB;
  v_started     TEXT[] := ARRAY[]::text[];
  v_ir_now      TEXT[] := ARRAY[]::text[];  -- player ids under an IR key in the submitted map
  v_stored_at   TEXT;
  v_locked      BOOLEAN;
  v_min_weeks   INTEGER;
  v_msg         TEXT;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      'set_lineup: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_slot_map IS NULL OR jsonb_typeof(p_slot_map) <> 'object' THEN
    RAISE EXCEPTION
      'set_lineup: p_slot_map must be a JSON object of "<slot_key>:<index>" → player_id (§12.13); got %',
      COALESCE(jsonb_typeof(p_slot_map), 'null')
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;

  -- (2) AUTH, in-body (F35: league_members' cache column, never a stint).
  --     One no-leak 42501 for "no such league", "not a member", "not this
  --     team's manager and not a commissioner".
  v_found := FOUND;
  v_is_manager := v_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT (v_is_manager OR v_is_commish) THEN
    RAISE EXCEPTION 'set_lineup: not a manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- REPLAY (099/E2): the same action_id returns the stored result, byte-
  -- identically — nothing re-evaluated, nothing written.
  SELECT a.result INTO v_result
  FROM public.lineup_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'set_lineup: league % is % — lineups are set only while in_season or in playoffs (§11.2)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'set_lineup: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'set_lineup: team % is retired — a sealed franchise has no lineup to set (§7.2.1)', p_team_id
      USING ERRCODE = 'P0001';
  END IF;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'set_lineup: league % has no league_weeks rows — no season calendar to set a lineup against (§12.17)',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'set_lineup: week % is not on league %''s calendar (season %; league_weeks holds weeks %–%)',
      p_week, p_league_id, v_league.season,
      (SELECT min(week) FROM public.league_weeks WHERE league_id = p_league_id),
      (SELECT max(week) FROM public.league_weeks WHERE league_id = p_league_id)
      USING ERRCODE = 'P0001';
  END IF;
  IF p_week < v_current THEN
    RAISE EXCEPTION
      'set_lineup: week % is in the past (the current week is %) — a past week''s lineup changes only through the audited commissioner override (§11.2, M6)',
      p_week, v_current
      USING ERRCODE = 'P0001';
  END IF;
  IF v_lw.status IN ('correction_window', 'final') THEN
    RAISE EXCEPTION
      'set_lineup: week % of league % is % — a closed week''s lineup changes only through the audited commissioner override (§11.2, M6)',
      p_week, p_league_id, v_lw.status
      USING ERRCODE = 'P0001';
  END IF;

  v_mode  := COALESCE(v_league.lineup_lock, 'per_player_kickoff');
  v_allow := COALESCE((v_league.settings ->> 'allow_illegal_lineups')::boolean, TRUE);

  -- The COMMISSIONER ARM carries the D290 interim audit posture (R738 / F40):
  -- an actor who is not this team's manager must give a reason, and a real
  -- change posts the in-txn system message below. The manager's own set
  -- needs neither.
  -- Blank = nothing but whitespace INCLUDING tabs/newlines (R745 — btrim's
  -- default strips spaces only); bounded at 500 characters, the client
  -- chat policy's own bound, so the system post stays bounded (R746).
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF NOT v_is_manager AND v_reason IS NULL THEN
    RAISE EXCEPTION
      'set_lineup: a commissioner setting another team''s lineup must give a reason (the D290 interim audit posture — the reason is posted to league chat; F40)'
      USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      'set_lineup: the reason is % characters — at most 500 (the league_chat bound; §12.13)',
      char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (3) THE ROSTER (positions normalized to the roster vocabulary — DEF → DST,
  --     the 086 shape; designations bridged).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',          r.player_id,
           'name',               p.full_name,
           'position',           CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
           'designation',        public.lineup_designation_internal(p.status),
           'nfl_team',           p.team,
           'ir_placed_week',     r.ir_placed_week,
           'ir_lock_until_week', r.ir_lock_until_week,
           'slot_key',           r.slot_key) ORDER BY r.player_id), '[]'::jsonb)
  INTO v_roster
  FROM public.league_rosters r
  JOIN public.players p ON p.id = r.player_id
  WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  IF jsonb_array_length(v_roster) = 0 THEN
    RAISE EXCEPTION
      'set_lineup: team % has no rostered players in league % — a lineup exists only over a roster (§11.1)',
      p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_by_pid := v_by_pid || jsonb_build_object(v_e ->> 'player_id', v_e);
  END LOOP;

  -- Slot instances in canonical order + IR spots.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',      (s ->> 'key') || ':' || i,
           'slot',     s ->> 'key',
           'label',    s ->> 'label',
           'eligible', s -> 'eligible') ORDER BY ord, i), '[]'::jsonb)
  INTO v_slots
  FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') WITH ORDINALITY AS t(s, ord),
       LATERAL generate_series(0, COALESCE((s ->> 'count')::int, 0) - 1) i;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',          (s ->> 'key') || ':0',
           'spot',         s ->> 'key',
           'type',         s ->> 'type',
           'designations', s -> 'eligible_designations',
           'min_weeks',    (s ->> 'min_weeks')::int) ORDER BY ord), '[]'::jsonb)
  INTO v_ir_spots
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord);

  -- (4) THE LINEUP ROW — created on first touch, then locked (rule 8: after
  --     the league row). Loud emptiness: FOUND is asserted.
  INSERT INTO public.team_lineups (team_id, season, week, starters, bench)
  VALUES (p_team_id, v_league.season, p_week, '[]'::jsonb, '[]'::jsonb)
  ON CONFLICT (team_id, season, week) DO NOTHING;
  SELECT tl.* INTO v_row
  FROM public.team_lineups tl
  WHERE tl.team_id = p_team_id AND tl.season = v_league.season AND tl.week = p_week
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_lineup: no lineup row for team % season % week % after create — refusing to continue',
      p_team_id, v_league.season, p_week
      USING ERRCODE = 'P0001';
  END IF;
  v_stored := COALESCE(v_row.slot_map, '{}'::jsonb);

  -- (5) VALIDATE THE SUBMITTED MAP: keys are slot instances or IR spots,
  --     values are this team's rostered players, each player exactly once.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
    IF jsonb_typeof(v_val) <> 'string' THEN
      RAISE EXCEPTION 'set_lineup: slot % must map to a player_id string (§12.13); got %', v_key, jsonb_typeof(v_val)
        USING ERRCODE = '22023';
    END IF;
    v_pid := v_val #>> '{}';
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      RAISE EXCEPTION
        'set_lineup: "%" is not a slot of league %''s roster (§7.3.2 starting_slots: %; IR spots: %)',
        v_key, p_league_id,
        (SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_slots) s),
        COALESCE((SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_ir_spots) s), 'none')
        USING ERRCODE = '22023';
    END IF;
    IF NOT (v_by_pid ? v_pid) THEN
      RAISE EXCEPTION 'set_lineup: player % is not on team %''s roster in league % (§11.1)', v_pid, p_team_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_seen ? v_pid THEN
      RAISE EXCEPTION
        'set_lineup: % (%) appears at both "%" and "%" — each player fills exactly one slot (E16)',
        v_by_pid -> v_pid ->> 'name', v_pid, v_seen ->> v_pid, v_key
        USING ERRCODE = 'P0001';
    END IF;
    v_seen := v_seen || jsonb_build_object(v_pid, v_key);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      v_ir_now := v_ir_now || v_pid;
      v_canon := v_canon || jsonb_build_object(v_key, v_pid);
    ELSE
      v_started := v_started || v_pid;
    END IF;
  END LOOP;

  -- (6) KICKOFF DATA, read NOW from nfl_games (E42/§23.3) — for p_week (the
  --     starters) and for the current week (IR moves) when they differ.
  SELECT * INTO v_window FROM public.schedule_window_internal(v_league.season, p_week, p_at);
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, p_week, v_e ->> 'nfl_team', p_at);
    v_kick := v_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    IF v_current <> p_week THEN
      SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_current, v_e ->> 'nfl_team', p_at);
      v_kick_cur := v_kick_cur || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
        'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    END IF;
  END LOOP;
  IF v_current = p_week THEN
    v_kick_cur := v_kick;
    v_window_cur := v_window;
  ELSE
    SELECT * INTO v_window_cur FROM public.schedule_window_internal(v_league.season, v_current, p_at);
  END IF;
  v_week_locked     := (v_mode = 'first_game_of_week') AND NOT v_window.free;       -- p_week's starters
  v_week_locked_cur := (v_mode = 'first_game_of_week') AND NOT v_window_cur.free;   -- IR moves (R736)

  -- (7) LOCKED PLAYERS NEVER MOVE (per_player_kickoff). Evaluated BEFORE the
  --     fit so a locked stored starter is a FIXED vertex, and a played player
  --     can neither enter nor change slots.
  IF v_mode = 'per_player_kickoff' THEN
    -- (a) every stored starter whose game has kicked off must sit at the
    --     same key in the submitted map.
    FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
      v_pid := v_val #>> '{}';
      CONTINUE WHEN NOT (v_by_pid ? v_pid);                       -- dropped since (113) — nothing to lock
      CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
      v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
      IF v_locked AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid THEN
        RAISE EXCEPTION
          'set_lineup: slot % is locked — % kicked off at % (%) and a locked slot''s player never moves (§11.2, lineup_lock = per_player_kickoff); every other unlocked slot stays editable',
          v_key, v_by_pid -> v_pid ->> 'name', v_kick -> v_pid ->> 'kickoff_at', v_kick -> v_pid ->> 'datum_arm'
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    -- (b) a player whose game has kicked off never enters a slot he was not
    --     already stored at.
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
      v_pid := v_val #>> '{}';
      CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
      v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
      IF v_locked AND (v_stored ->> v_key) IS DISTINCT FROM v_pid THEN
        RAISE EXCEPTION
          'set_lineup: %''s game kicked off at % (%) — a player whose game has started cannot enter or move slots (§11.2, lineup_lock = per_player_kickoff); wanted "%"',
          v_by_pid -> v_pid ->> 'name', v_kick -> v_pid ->> 'kickoff_at', v_kick -> v_pid ->> 'datum_arm', v_key
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  -- (8) THE FIT (E16). Input order: fixed (locked) players first, then the
  --     rest in submitted-key order — deterministic.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id', v_by_pid -> x.pid ->> 'player_id',
           'position',  v_by_pid -> x.pid ->> 'position',
           'wanted',    x.key,
           'fixed',     x.fixed) ORDER BY x.fixed DESC, x.ord), '[]'::jsonb)
  INTO v_fit_players
  FROM (
    SELECT e.key, e.value #>> '{}' AS pid, e.ord,
           -- fixed = locked: the player's own kickoff has passed (per_player_
           -- kickoff) OR the whole week is locked (first_game_of_week — R744:
           -- every submitted player is then a fixed vertex, so a mid-week
           -- relisting cannot re-seat or unseat a locked starter; a changed
           -- map is refused by the week lock right after the fit).
           ((v_mode = 'per_player_kickoff'
             AND (v_kick -> (e.value #>> '{}') ->> 'kickoff_at') IS NOT NULL
             AND (v_kick -> (e.value #>> '{}') ->> 'kickoff_at')::timestamptz <= p_at)
            OR v_week_locked) AS fixed
    FROM jsonb_each(p_slot_map) WITH ORDINALITY AS e(key, value, ord)
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = e.key)
  ) x;
  v_fit := public.lineup_fit_internal(v_slots, v_fit_players);
  IF jsonb_array_length(v_fit -> 'unplaced') > 0 THEN
    v_pid := v_fit -> 'unplaced' ->> 0;
    v_key := v_seen ->> v_pid;
    RAISE EXCEPTION
      'set_lineup: % (%) cannot be placed — no legal arrangement of the started players fills the slots (E16): "%" accepts % and every slot % could take is held by a player with nowhere else to go (unplaced: %)',
      v_by_pid -> v_pid ->> 'name', v_by_pid -> v_pid ->> 'position', v_key,
      (SELECT string_agg(x #>> '{}', '/') FROM jsonb_array_elements((SELECT s -> 'eligible' FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)) x),
      v_by_pid -> v_pid ->> 'name',
      v_fit -> 'unplaced'
      USING ERRCODE = 'P0001';
  END IF;
  v_canon := v_canon || (v_fit -> 'assignment');

  -- first_game_of_week: after the week's first kickoff ANY change refuses.
  IF v_week_locked AND v_canon <> v_stored THEN
    RAISE EXCEPTION
      'set_lineup: week %''s first kickoff was at % (%) — the whole lineup is locked (§11.2, lineup_lock = first_game_of_week)',
      p_week, v_window.first_kickoff_at, v_window.datum_arm
      USING ERRCODE = 'P0001';
  END IF;

  -- (9) IR MOVES, against the CURRENT week (banner: IR LAW).
  --     Placements: under an IR key now, not on IR (or on a different spot) before.
  FOR v_spot IN SELECT * FROM jsonb_array_elements(v_ir_spots) LOOP
    v_pid := v_canon ->> (v_spot ->> 'key');
    CONTINUE WHEN v_pid IS NULL;
    v_e := v_by_pid -> v_pid;
    IF (v_e ->> 'ir_placed_week') IS NULL OR (v_e ->> 'slot_key') IS DISTINCT FROM (v_spot ->> 'key') THEN
      -- a NEW placement (or a spot change, which is removal + placement)
      IF (v_e ->> 'ir_placed_week') IS NOT NULL AND (v_e ->> 'ir_lock_until_week') IS NOT NULL
         AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
        RAISE EXCEPTION
          'set_lineup: % entered restricted IR spot % in week % and may not leave it before week % (min_weeks stint, §11.2/§7.3.2) — the current week is %; commissioner override is M6''s',
          v_e ->> 'name', v_e ->> 'slot_key', v_e ->> 'ir_placed_week', v_e ->> 'ir_lock_until_week', v_current
          USING ERRCODE = 'P0001';
      END IF;
      IF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
        RAISE EXCEPTION
          'set_lineup: % holds designation % — IR spot % accepts only % (§7.3.2 IR slot rules)',
          v_e ->> 'name', COALESCE(v_e ->> 'designation', 'none'), v_spot ->> 'spot',
          (SELECT string_agg(x #>> '{}', ', ') FROM jsonb_array_elements(v_spot -> 'designations') x)
          USING ERRCODE = 'P0001';
      END IF;
      IF v_week_locked_cur OR (v_mode = 'per_player_kickoff'
         AND (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
         AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at) THEN
        RAISE EXCEPTION
          'set_lineup: %''s lock for week % has passed (kickoff %) — IR moves respect lineup-lock timing (§7.3.2)',
          v_e ->> 'name', v_current,
          CASE WHEN v_week_locked_cur THEN v_window_cur.first_kickoff_at::text ELSE v_kick_cur -> v_pid ->> 'kickoff_at' END
          USING ERRCODE = 'P0001';
      END IF;
      v_ir_placed := v_ir_placed || jsonb_build_object(
        'player_id', v_pid, 'spot', v_spot ->> 'key', 'type', v_spot ->> 'type',
        'ir_placed_week', v_current,
        'ir_lock_until_week', CASE WHEN v_spot ->> 'type' = 'restricted'
                                   THEN v_current + COALESCE((v_spot ->> 'min_weeks')::int, 4) END);
    ELSIF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
      v_flags_irin := v_flags_irin || to_jsonb(v_pid);
    END IF;
    v_ir_out := v_ir_out || jsonb_build_object(
      'slot', v_spot ->> 'key', 'player_id', v_pid, 'position', v_e ->> 'position',
      'designation', v_e ->> 'designation',
      'ir_placed_week', COALESCE((SELECT (x ->> 'ir_placed_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid), (v_e ->> 'ir_placed_week')::int),
      'ir_lock_until_week', CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 THEN (SELECT (x ->> 'ir_lock_until_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 ELSE (v_e ->> 'ir_lock_until_week')::int END,
      'flags', CASE WHEN v_flags_irin ? v_pid THEN '["ir_ineligible"]'::jsonb ELSE '[]'::jsonb END);
  END LOOP;
  --     Removals: on IR before, not under any IR key now.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    CONTINUE WHEN (v_e ->> 'ir_placed_week') IS NULL;
    v_pid := v_e ->> 'player_id';
    CONTINUE WHEN v_pid = ANY (v_ir_now);
    IF (v_e ->> 'ir_lock_until_week') IS NOT NULL AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
      RAISE EXCEPTION
        'set_lineup: % entered restricted IR spot % in week % and may not leave it before week % (min_weeks stint, §11.2/§7.3.2) — the current week is %; commissioner override is M6''s',
        v_e ->> 'name', v_e ->> 'slot_key', v_e ->> 'ir_placed_week', v_e ->> 'ir_lock_until_week', v_current
        USING ERRCODE = 'P0001';
    END IF;
    IF v_week_locked_cur OR (v_mode = 'per_player_kickoff'
       AND (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
       AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at) THEN
      RAISE EXCEPTION
        'set_lineup: %''s lock for week % has passed (kickoff %) — IR moves respect lineup-lock timing (§7.3.2)',
        v_e ->> 'name', v_current,
        CASE WHEN v_week_locked_cur THEN v_window_cur.first_kickoff_at::text ELSE v_kick_cur -> v_pid ->> 'kickoff_at' END
        USING ERRCODE = 'P0001';
    END IF;
    v_ir_removed := v_ir_removed || jsonb_build_object('player_id', v_pid, 'spot', v_e ->> 'slot_key');
  END LOOP;

  -- (10) STARTERS (derived render state) + flags; bench = roster − starters − IR.
  v_locked_at := CASE WHEN v_mode = 'first_game_of_week' THEN v_window.first_kickoff_at END;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_canon ->> v_key;
    v_pflags := '[]'::jsonb;
    IF v_pid IS NULL THEN
      v_pflags := v_pflags || '"empty"'::jsonb;
      v_flags_empty := v_flags_empty || to_jsonb(v_key);
    ELSE
      v_p := v_by_pid -> v_pid;
      IF (v_kick -> v_pid ->> 'on_bye')::boolean THEN
        v_pflags := v_pflags || '"bye"'::jsonb;
        v_flags_bye := v_flags_bye || to_jsonb(v_pid);
      END IF;
      IF (v_p ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended') THEN
        v_pflags := v_pflags || '"out"'::jsonb;
        v_flags_out := v_flags_out || to_jsonb(v_pid);
      END IF;
      IF v_mode = 'per_player_kickoff' AND (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL THEN
        v_locked_at := LEAST(v_locked_at, (v_kick -> v_pid ->> 'kickoff_at')::timestamptz);
      END IF;
      -- §7.3.6 allow_illegal_lineups = FALSE: a bye/OUT starter in an
      -- UNLOCKED slot blocks the submit by name.
      -- (a locked slot's bye/OUT player is not the manager's to change:
      --  exempt under per_player_kickoff when the stored player's game has
      --  kicked off, and under first_game_of_week once the week is locked —
      --  the map already equals the stored map there, R739.)
      IF NOT v_allow AND jsonb_array_length(v_pflags) > 0
         AND NOT v_week_locked
         AND NOT (v_mode = 'per_player_kickoff'
                  AND (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at
                  AND (v_stored ->> v_key) = v_pid) THEN
        RAISE EXCEPTION
          'set_lineup: % is % for week % and allow_illegal_lineups is off — slot "%" is blocked at submit (§7.3.6); bench him or start someone who plays',
          v_p ->> 'name', CASE WHEN v_pflags ? 'bye' THEN 'on bye' ELSE 'OUT (' || (v_p ->> 'designation') || ')' END,
          p_week, v_key
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    v_starters := v_starters || jsonb_build_object(
      'slot', v_key, 'slot_key', v_e ->> 'slot', 'label', v_e ->> 'label',
      'player_id', v_pid,
      'position', CASE WHEN v_pid IS NULL THEN NULL ELSE v_by_pid -> v_pid ->> 'position' END,
      'kickoff_at', CASE WHEN v_pid IS NULL THEN NULL ELSE v_kick -> v_pid ->> 'kickoff_at' END,
      'flags', v_pflags);
  END LOOP;
  SELECT COALESCE(jsonb_agg(to_jsonb(e ->> 'player_id') ORDER BY e ->> 'player_id'), '[]'::jsonb)
  INTO v_bench
  FROM jsonb_array_elements(v_roster) e
  WHERE NOT ((e ->> 'player_id') = ANY (v_started))
    AND NOT ((e ->> 'player_id') = ANY (v_ir_now));

  -- (11) NO-OP BY NAME (rule 10): the canonical map equals the stored map
  --      and no IR move — nothing is written but the ledger row.
  v_no_changes := (v_canon = v_stored)
                  AND jsonb_array_length(v_ir_placed) = 0
                  AND jsonb_array_length(v_ir_removed) = 0;

  IF NOT v_no_changes THEN
    -- (12) WRITE — the lineup row, then the roster's slot_key/IR columns.
    UPDATE public.team_lineups
    SET slot_map          = v_canon,
        starters          = v_starters,
        bench             = v_bench,
        locked_at         = v_locked_at,
        edited_by_commish = NOT v_is_manager,
        set_at            = now()
    WHERE id = v_row.id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'set_lineup: updated % lineup rows for team % week %, expected 1', v_cnt, p_team_id, p_week
        USING ERRCODE = 'P0001';
    END IF;

    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_placed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week     = (v_e ->> 'ir_placed_week')::int,
          ir_lock_until_week = (v_e ->> 'ir_lock_until_week')::int,
          slot_key           = v_e ->> 'spot'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'set_lineup: IR placement of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_removed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week = NULL, ir_lock_until_week = NULL, slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'set_lineup: IR removal of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    -- R738 / D290 / D97: a commissioner's change posts in-txn, reason in the
    -- text (the interim audit until commissioner_actions exists — F40).
    IF NOT v_is_manager THEN
      v_message := 'Week ' || p_week || ' lineup for ' || v_team.name || ' set by '
        || public.draft_actor_name() || ' (commissioner) — reason: ' || v_reason;
      INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
      VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
    END IF;

    IF p_week = v_current THEN
      -- slot_key describes the ACTIVE week: starters → instance key, the rest
      -- (not on IR) → 'bn'. Counts asserted against the roster.
      v_expected := 0;
      FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit -> 'assignment') LOOP
        UPDATE public.league_rosters r SET slot_key = v_key
        WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = (v_val #>> '{}');
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        v_expected := v_expected + v_cnt;
      END LOOP;
      IF v_expected <> COALESCE(array_length(v_started, 1), 0) THEN
        RAISE EXCEPTION 'set_lineup: wrote slot_key for % starters, expected %', v_expected, COALESCE(array_length(v_started, 1), 0)
          USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.league_rosters r SET slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id
        AND r.player_id = ANY (SELECT x #>> '{}' FROM jsonb_array_elements(v_bench) x);
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> jsonb_array_length(v_bench) THEN
        RAISE EXCEPTION 'set_lineup: wrote slot_key = bn for % players, expected %', v_cnt, jsonb_array_length(v_bench)
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'team_id',                p_team_id,
    'season',                 v_league.season,
    'week',                   p_week,
    'current_week',           v_current,
    'action_id',              p_action_id,
    'lineup_lock',            v_mode,
    'allow_illegal_lineups',  v_allow,
    'no_changes',             v_no_changes,
    'rearranged',             (v_fit ->> 'rearranged')::boolean,
    'moved',                  v_fit -> 'moved',
    'slot_map',               v_canon,
    'starters',               v_starters,
    'bench',                  v_bench,
    'ir',                     v_ir_out,
    'ir_moves',               jsonb_build_object('placed', v_ir_placed, 'removed', v_ir_removed),
    'flags', jsonb_build_object(
      'illegal',       jsonb_array_length(v_flags_bye) + jsonb_array_length(v_flags_out) + jsonb_array_length(v_flags_irin) > 0,
      'bye',           v_flags_bye,
      'out',           v_flags_out,
      'empty',         v_flags_empty,
      'ir_ineligible', v_flags_irin),
    'locked_at',              v_locked_at,
    'edited_by_commish',      NOT v_is_manager,
    'reason',                 v_reason,
    'system_post',            v_message,
    'evaluated_at',           p_at,
    'week_datum', jsonb_build_object(
      'first_kickoff_at', v_window.first_kickoff_at,
      'datum_arm',        v_window.datum_arm,
      'kicked_off',       NOT v_window.free),
    'current_week_datum', jsonb_build_object(
      'first_kickoff_at', v_window_cur.first_kickoff_at,
      'datum_arm',        v_window_cur.datum_arm,
      'kicked_off',       NOT v_window_cur.free)
  );

  INSERT INTO public.lineup_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION set_lineup_internal(UUID, UUID, INTEGER, JSONB, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. set_lineup — the client-facing verb: transaction now(), never a
--    caller-supplied instant (D307(3)); SECURITY DEFINER; in-body auth is
--    the internal body's step (2)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_lineup(
  p_league_id UUID,
  p_team_id   UUID,
  p_week      INTEGER,
  p_slot_map  JSONB,
  p_action_id UUID DEFAULT NULL,  -- REQUIRED in-body (22023); DEFAULT NULL only so the sketch's order is kept
  p_reason    TEXT DEFAULT NULL   -- REQUIRED in-body for a non-manager actor (the commissioner arm — R738/D290)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.set_lineup_internal(p_league_id, p_team_id, p_week, p_slot_map, p_action_id, now(), p_reason);
END;
$$;
REVOKE EXECUTE ON FUNCTION set_lineup(UUID, UUID, INTEGER, JSONB, UUID, TEXT) FROM PUBLIC, anon;
