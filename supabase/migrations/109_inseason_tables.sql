-- ============================================================================
-- The in-season tables — migration 109 (task L.D1.1, the M4 schema-lane
-- opener; tasks-M4-inseason.md §6 L.D1.1 + §7 row 109; spec
-- spec-redraft-leagues.md v2.16.11 §12.8 (`matchups`), §12.9
-- (`transactions`), §12.18 (`team_week_results`), §12.19
-- (`league_player_pool`), §22.4 (hot-path indexes), §23.5 (the
-- `player_stats.advanced` storage rule); delivery plan §8.1–8.2; tasks-M4
-- §2 (survey), §3 D292/D294/D296/D300, §4 standing rules, §9 C51/C59;
-- PROGRESS D302 (build mechanics), F131 (discharged by this PR's typegen).
--
-- TABLES, CONSTRAINTS, INDEXES, RLS ONLY — NO RPCs. Nothing in this
-- migration writes a row; every writer of these tables is a later M4
-- migration (110 schedule engine → 111 remix → 112 lineups → 113 pool +
-- add/drop → 114 week workers → 115 standings → 116 playoffs → 117 realtime
-- + the scoring write door → 118 retire) or the L.D2.x TS worker through
-- 117's door. Until then the four member tables are empty machinery with a
-- member SELECT and NO write path for any client role (the 056 league_weeks
-- shape), and the queue is service-role-only by RLS.
--
-- What ships here:
--   1. `matchups` — §12.8 with the spec's OWN printed cleanup executed:
--      the `round_type`-aware unique PAIR (`uniq_matchup_home_per_week`,
--      `uniq_matchup_away_per_week`, the away side partial on
--      `away_team_id IS NOT NULL` so byes never collide) ships, and the
--      plain `UNIQUE(league_id, season, week, home_team_id)` is DROPPED —
--      §12.8's closing comment sanctions exactly this ("keep both or drop
--      the plain one in the migration"), and keeping it would be WRONG:
--      §11.7's `second_opponent` materializes a `secondary` row for the same
--      home team in the same week (D289), which the plain UNIQUE would
--      refuse. pgTAP 057 proves the pair from both sides (a `secondary` row
--      coexists with the primary; a duplicate primary home row AND a
--      duplicate away row each refuse 23505; two byes coexist).
--      `override_action_id` carries NO FK: `commissioner_actions` is M6's
--      table (tasks-M4 §7 "Not in M4"); M6 adds the FK when the target
--      exists — the 056 `reopened_by_action_id` precedent.
--      Indexes: `idx_matchups_league_week` (§12.8) + the §22.4 hot-path
--      partial `idx_matchups_league_week_open` (`WHERE status <> 'final'`)
--      — the worker's "non-final matchups for this league-week" scan.
--   2. `team_week_results` — §12.18 verbatim + `idx_twr_league_season`
--      (league_id, season, week). §22.4's additive
--      `team_week_results(league_id, season)` is SATISFIED BY PREFIX: a
--      btree on (league_id, season, week) serves every (league_id, season)
--      predicate, so a second index would be a strict-prefix duplicate
--      costing every write for nothing — measured with EXPLAIN in the
--      session log (D302) and pinned structurally in 057 (an index whose
--      LEADING columns are (league_id, season) exists).
--   3. `transactions` — §12.9 verbatim + `idx_transactions_league`
--      (league_id, created_at DESC). `related_action_id` FK-less for the
--      same M6 reason as `override_action_id`.
--   4. `league_player_pool` — §12.19 verbatim + the partial waivers index
--      `idx_pool_waivers` (`WHERE state = 'on_waivers'`). Rows are LAZY
--      (D294): no row = `free_agent` if unowned; 113's writers create rows
--      on first transition; the `rostered` mirror is asserted by L.D2.3's
--      reconciliation, never trusted.
--   5. `score_fanout` — the delta queue (D292/C51: a plain table drained
--      with `FOR UPDATE SKIP LOCKED` — pgmq does not exist on this stack,
--      §22.2's printed vehicle is an erratum folded when the worker lands).
--      `PRIMARY KEY (season, week, player_id)` IS the dedupe: a hot player
--      whose stats move ten times inside one drain window enqueues ONCE
--      (`INSERT … ON CONFLICT DO NOTHING` is the enqueue idiom — pinned in
--      057 as a 0-row second insert). Service-role only: RLS ENABLED with
--      ZERO policies (deny-all for anon/authenticated; `service_role`
--      bypasses RLS by role attribute and is the only writer/reader —
--      ingestion enqueues, the worker drains). No REVOKE: the grants
--      doctrine (D18→D23, tasks-M1 §4.1) makes RLS the only gate for
--      TABLES and forbids per-object GRANT/REVOKE on them.
--   6. `player_stats.advanced JSONB NOT NULL DEFAULT '{}'` — C59: §23.5's
--      storage rule ("all advanced stats … live in `player_stats.advanced
--      JSONB DEFAULT '{}'`; a missing key means not-yet-reported") was
--      never executed. Additive (`ADD COLUMN IF NOT EXISTS`), so every
--      existing row reads `{}` = nothing reported. Plus a CHECK that the
--      value is a JSON OBJECT — the column is a key→value map by
--      definition (§23.5's "missing key" semantics are meaningless on an
--      array or scalar), so the R43 rule applies: the constraint lands at
--      creation, not after a review finds `'[]'` accepted. The D15
--      placeholder keys stay machinery-proof only (C59).
--      `idx_league_rosters_player ON league_rosters(player_id)` — §22.4's
--      fan-out map index (player delta → affected (league, team)), measured
--      ABSENT in tasks-M4 §2 (072 shipped only the team/league indexes).
--
-- R43 / D55-class tightenings at creation (recorded in D302, each pinned in
-- 057 at the boundary — one legal value lives, one past the edge refuses):
--   * Every comment-only enum in the printed DDL becomes a CHECK:
--     `matchups.round_type` (regular|playoff|consolation|third_place|
--     secondary), `matchups.status` (scheduled|live|final),
--     `matchups.result` (home|away|tie, NULL = not yet decided),
--     `transactions.type` (add|drop|add_drop|waiver_claim|trade|
--     commissioner_move), `transactions.status` (pending|complete|reversed|
--     failed|vetoed), `team_week_results.h2h_result` (win|loss|tie|bye),
--     `.median_result` / `.second_result` (win|loss|tie),
--     `league_player_pool.state` (free_agent|on_waivers|rostered|
--     locked_in_game). §12.17's printed form on `league_weeks` accepted
--     'banana' until 056 fixed it at creation; same fix, same place.
--   * Four DEFAULTed columns gain NOT NULL because a NULL there is not a
--     state, it is a hole the in-season law would fall through:
--     `matchups.round_type` (a NULL is DISTINCT from every other NULL in a
--     unique index — the pair would stop deduplicating), `matchups.status`
--     (a NULL row is neither in the `<> 'final'` partial index nor final),
--     `matchups.is_overridden` and `team_week_results.is_final` (§22.2's
--     "never auto-recompute an overridden cell / a final matchup" — `NOT
--     NULL` is neither TRUE nor FALSE, so a NULL would be skipped by one
--     reading and recomputed by another). Omitting the column still writes
--     the DEFAULT; only an explicit NULL is refused (23502, pinned).
--   * `home_score`/`away_score` stay NULLABLE as printed — deliberately: E61
--     / D295 make "pending" (no delivered stat) distinct from 0.00, and a
--     NULLable score is the column-level room for that distinction; the
--     write door (117) decides the representation. NOT tightened here.
--
-- What this migration deliberately does NOT do:
--   * No composite FK from `matchups`/`team_week_results` (season, week) to
--     `nfl_weeks` or `league_weeks` — considered (056/D55 did it for
--     `league_weeks`; D288 makes every M4 week an NFL week) and routed to
--     the first writer as a ledger row (F213) rather than decided by the
--     table task: the schedule engine (110) owns the "every matchup week
--     has a league_weeks row" invariant and its write order.
--   * No realtime triggers — D296 lands the four in-season triggers
--     (`matchups`, `team_week_results`, `transactions`, `league_weeks`)
--     in 117 (L.D1.9) together with the write door they broadcast for; an
--     empty table with no writer has nothing to broadcast (the D38 shape,
--     with the landing migration named). §8.1's realtime line is disposed
--     by that pointer, not waived open-endedly.
--   * No `player_stats` partitioning (C52 — created unpartitioned in 001;
--     repartitioning a live table is not additive; M7 re-evaluates).
--
-- RLS/grants doctrine (tasks-M1 §4.1, D18→D23): all five tables ride 037's
-- default ACLs; RLS is the gate. Member tables: ONE policy each, member
-- SELECT via `is_league_member` (052), NO client write policy for any role
-- including the commissioner — every writer is a SECURITY DEFINER RPC or
-- the service-role worker (§12.8/§12.9/§12.18/§12.19 print exactly one
-- SELECT policy apiece). Queue: zero policies. No functions are created, so
-- the §4.1 REVOKE discipline has no target here.
--
-- §8.1 staging-rehearsal waiver (R6 go-forward rule): no staging clone
-- exists; the rehearsal evidence is the fresh local `npx supabase db reset`
-- replay of 001–109 + the full pgTAP suite (000–057) + the stack-backed
-- vitest suites, recorded in this PR's session-log row, plus CI's
-- from-scratch replay (the Database lane). Prod-safe: five new tables with
-- RLS enabled + policies in this same migration, one additive DEFAULTed
-- column on `player_stats`, one new index on `league_rosters`; no existing
-- function replaced (D137 n/a), no row written. Registered in
-- supabase/HELD-FROM-PRODUCTION.txt in the same PR (the closed-range rule).
-- Typegen RE-RUN (five new tables + one new column); the hand-written alias
-- block re-appended with `Matchup`, `TeamWeekResult`, `LeagueTransaction`,
-- `LeaguePlayerPoolRow` added and F131's stray blank line dropped —
-- additive-only diff attested in the PR.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. `matchups` — §12.8 with the printed cleanup executed (the plain UNIQUE
--    dropped; the round_type-aware pair kept)
-- ---------------------------------------------------------------------------

CREATE TABLE matchups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  round_type TEXT NOT NULL DEFAULT 'regular'
    CHECK (round_type IN ('regular', 'playoff', 'consolation', 'third_place', 'secondary')),
  home_team_id UUID REFERENCES teams(id) NOT NULL,
  away_team_id UUID REFERENCES teams(id),          -- NULL = bye
  home_score NUMERIC DEFAULT 0,                    -- nullable as printed: room for "pending" (E61/D295)
  away_score NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'live', 'final')),
  result TEXT                                      -- home | away | tie (computed OR overridden); NULL = undecided
    CHECK (result IS NULL OR result IN ('home', 'away', 'tie')),
  is_overridden BOOLEAN NOT NULL DEFAULT FALSE,    -- TRUE if a commissioner set the result/score (§22.2: never auto-recomputed)
  override_action_id UUID,                         -- FK → commissioner_actions(id) — M6 adds the FK with the table
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (away_team_id IS NULL OR away_team_id <> home_team_id)
  -- The printed `UNIQUE(league_id, season, week, home_team_id)` is DROPPED
  -- per §12.8's own comment: a `secondary` row (§11.7 second_opponent)
  -- shares the home team with the primary row in the same week.
);

-- v2.0: a team appears at most once per week on either side (per round_type).
CREATE UNIQUE INDEX uniq_matchup_away_per_week
  ON matchups(league_id, season, week, round_type, away_team_id)
  WHERE away_team_id IS NOT NULL;
CREATE UNIQUE INDEX uniq_matchup_home_per_week
  ON matchups(league_id, season, week, round_type, home_team_id);

CREATE INDEX idx_matchups_league_week ON matchups(league_id, season, week);
-- §22.4 hot path: the worker's "open matchups for this league-week" scan.
CREATE INDEX idx_matchups_league_week_open
  ON matchups(league_id, season, week)
  WHERE status <> 'final';

ALTER TABLE matchups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Matchups viewable by league members"
  ON matchups FOR SELECT USING (is_league_member(league_id));
-- No write policy for any role: written by the schedule engine (110), Remix
-- / manual edit (111), the scoring write door (117) and finalization (114)
-- — engine/commissioner RPCs only, never a client.

-- ---------------------------------------------------------------------------
-- 2. `team_week_results` — §12.18 verbatim (derived; rebuildable from
--    matchups via 115's rebuild_team_week_results)
-- ---------------------------------------------------------------------------

CREATE TABLE team_week_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  points NUMERIC(8,2) NOT NULL DEFAULT 0,          -- counted once/week for Points For (§11.7)
  opponent_team_id UUID REFERENCES teams(id),
  h2h_result TEXT                                  -- win | loss | tie | bye | NULL (pending)
    CHECK (h2h_result IS NULL OR h2h_result IN ('win', 'loss', 'tie', 'bye')),
  median_result TEXT                               -- win | loss | tie | NULL (median_game off / pending)
    CHECK (median_result IS NULL OR median_result IN ('win', 'loss', 'tie')),
  second_opponent_team_id UUID REFERENCES teams(id),
  second_result TEXT                               -- win | loss | tie | NULL
    CHECK (second_result IS NULL OR second_result IN ('win', 'loss', 'tie')),
  is_final BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(league_id, team_id, season, week)
);

-- §12.18's index; its (league_id, season) prefix is §22.4's standings-scan
-- index — one btree serves both (see banner item 2).
CREATE INDEX idx_twr_league_season ON team_week_results(league_id, season, week);

ALTER TABLE team_week_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Results viewable by members"
  ON team_week_results FOR SELECT USING (is_league_member(league_id));
-- No write policy for any role: written by the scoring worker through
-- 117's door (live, provisional) and finalize_matchups (114); rebuilt by
-- 115's rebuild_team_week_results.

-- ---------------------------------------------------------------------------
-- 3. `transactions` — §12.9 verbatim (the unified in-season activity log)
-- ---------------------------------------------------------------------------

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL                               -- add | drop | add_drop | waiver_claim | trade | commissioner_move
    CHECK (type IN ('add', 'drop', 'add_drop', 'waiver_claim', 'trade', 'commissioner_move')),
  status TEXT NOT NULL DEFAULT 'complete'          -- pending | complete | reversed | failed | vetoed
    CHECK (status IN ('pending', 'complete', 'reversed', 'failed', 'vetoed')),
  initiator_team_id UUID REFERENCES teams(id),     -- NULL when commissioner-initiated
  initiated_by UUID REFERENCES profiles(id),
  payload JSONB NOT NULL,                          -- normalized: players in/out, teams, faab, slot, etc.
  related_action_id UUID,                          -- FK → commissioner_actions(id) — M6 adds the FK with the table
  week INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_league ON transactions(league_id, created_at DESC);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Transactions viewable by league members"
  ON transactions FOR SELECT USING (is_league_member(league_id));
-- No write policy for any role: every executed move writes its row inside
-- the executing RPC's transaction (113's roster_add_drop first; M5/M6 add
-- waiver/trade/commissioner writers).

-- ---------------------------------------------------------------------------
-- 4. `league_player_pool` — §12.19 verbatim (lazy rows, D294)
-- ---------------------------------------------------------------------------

CREATE TABLE league_player_pool (
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  player_id TEXT REFERENCES players(id) NOT NULL,
  state TEXT NOT NULL DEFAULT 'free_agent'         -- free_agent | on_waivers | rostered | locked_in_game
    CHECK (state IN ('free_agent', 'on_waivers', 'rostered', 'locked_in_game')),
  waivers_until TIMESTAMPTZ,                       -- when the player clears (NULL unless on_waivers)
  locked_until TIMESTAMPTZ,                        -- game-day add lock (player_game_lock=on): kickoff → week clear
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (league_id, player_id)
);

CREATE INDEX idx_pool_waivers ON league_player_pool(league_id, waivers_until)
  WHERE state = 'on_waivers';

ALTER TABLE league_player_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Pool viewable by members"
  ON league_player_pool FOR SELECT USING (is_league_member(league_id));
-- No write policy for any role: maintained by 113's add/drop path and
-- 114's lineup_lock_tick (locked_until refresh, E42); M5's waiver
-- processor joins them.

-- ---------------------------------------------------------------------------
-- 5. `score_fanout` — the delta queue (D292/C51); service-role only
-- ---------------------------------------------------------------------------

CREATE TABLE score_fanout (
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  player_id TEXT REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The PK is the dedupe: one row per (season, week, player) per drain
  -- window. Ingestion enqueues with ON CONFLICT DO NOTHING; the worker
  -- deletes what it drains (FOR UPDATE SKIP LOCKED, §22.3).
  PRIMARY KEY (season, week, player_id)
);

-- Deny-all for every client role: RLS on, zero policies. service_role
-- bypasses RLS (rolbypassrls) and is the queue's only reader and writer.
ALTER TABLE score_fanout ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 6. `player_stats.advanced` (C59, §23.5) + `idx_league_rosters_player`
--    (§22.4)
-- ---------------------------------------------------------------------------

ALTER TABLE player_stats
  ADD COLUMN IF NOT EXISTS advanced JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE player_stats
  ADD CONSTRAINT player_stats_advanced_is_object
  CHECK (jsonb_typeof(advanced) = 'object');

COMMENT ON COLUMN player_stats.advanced IS
  '§23.5 storage rule: every advanced stat (air_yards, yards_after_catch, rush_yards_after_contact, and every future key) lives here as a key→value map. A MISSING key means not-yet-reported (≠ 0; renders as pending). New stats need no migration. Object-typed by CHECK.';

CREATE INDEX idx_league_rosters_player ON league_rosters(player_id);
