-- ============================================================================
-- `commish_edit_bracket` — hand-pick a playoff matchup — migration 134
-- (task L.E1.16 of M6A; tasks-M6A §6 "L.E1.16 (proposed)" amendment note
-- under L.E1.14 — APPROVED by Chris 2026-09-16; §3 D336 / D348 / D350 /
-- D353; §4 rules 1-15; PROGRESS §3 STANDING RULE clauses (a), (b), (g), (i);
-- PROGRESS **F360** (RULED WANTED 2026-09-16, R1047); spec §11.5 "Bracket is
-- commissioner-editable", §11.5's Q39 mechanics (seeds FROZEN on the rows, a
-- bye row is `away_team_id NULL` with `home_seed`, the survivors feed the
-- next round), §10.3, §12.12, §15.4 (Q66: a reason is optional), §22.2.)
--
-- WHAT THIS MIGRATION DOES
--   0. `matchups.pairing_set_by_action_id UUID REFERENCES
--      commissioner_actions(id)` — the PER-ROUND "hand-picked" MARK, carried
--      on every seeded row of the round (the Architect's second option in the
--      task text; chosen over a DELETE-excluding column because a partial
--      exclusion would leave the engine re-INSERTing pairings that seat teams
--      the manual rows already seat — one round has ONE owner). NULL = the
--      engine paired the round. 126's `override_action_id` is the precedent
--      (the receipt's id on the row, an FK to the audit log).
--   1. `commish_bracket_actions` — this verb's OWN zero-policy replay ledger
--      (D350), `UNIQUE (league_id, action_id)`.
--   2. `commish_edit_bracket_internal` + `commish_edit_bracket` — the 123
--      template in all seven parts (D336): re-pairs ONE playoff PAIRING of
--      ONE round (every week's row of it — a two-week round is one pairing
--      on two rows, and `playoff_bracket_state_internal` groups them as one
--      game, 118:1154-1178) over the round's OWN SUBSET of teams, with its
--      own re-validation; the timing gates are lifted and NAMED in
--      `bypassed[]`, the re-seed it told to stand down is NAMED there too.
--   3. `playoff_bracket_sync_internal` — `CREATE OR REPLACE` against
--      **118:1279-1651's FILE TEXT** (D137), **EXACTLY ONE NEW HUNK**: a round
--      whose seeded rows carry the mark is never compared, never DELETEd and
--      re-INSERTed (118:1573-1594), never refused as played — it stands as
--      picked and its survivors feed the next round.
--   4. `playoff_bracket_state_internal` — `CREATE OR REPLACE` against
--      **118:1016-1269's FILE TEXT** (D137), **EXACTLY ONE HUNK**: each stored
--      week entry of a game carries `hand_picked_action_id`, so the member
--      read (`league_playoff_bracket`, untouched) shows who hand-picked it.
--
-- ---------------------------------------------------------------------------
-- WHAT A COMMISSIONER CAN AND CANNOT DO HERE (the product rule, derived —
-- never invented — from the approved task text and §11.5)
-- ---------------------------------------------------------------------------
-- The approved task text (tasks-M6A §6, L.E1.16): *"re-pairs ONE bracket row
-- for ONE round with its own re-validation over the round's SUBSET of
-- teams"*, *"the subset re-validation refuses a team from outside the round
-- by name"*. So:
--   • WHO plays WHOM within a round is the commissioner's (§11.5 "Bracket is
--     commissioner-editable"). He names the target pairing's new home and
--     away (or a bye: away NULL); the teams he displaces take the slots the
--     new teams vacated — 130's permutation (130:490-551) carried over in
--     meaning, with byes as slots.
--   • WHO IS IN the round is NOT his here: the entrants are the standings'
--     (round 1) or the prior round's survivors, i.e. the teams seated on the
--     round's seeded rows. A team from outside that set is refused BY NAME
--     (step 10). Changing who qualified is `commish_edit_score` /
--     `commish_set_result` on the games that decided it (126).
--   • The round keeps its SHAPE: the same number of pairings, every entrant
--     exactly once per week, seeds FROZEN and following their teams (a seed
--     is the team's, not the slot's — 118 rider (iii)). A request that would
--     drop a team (a pairing turned into a bye with nowhere for the displaced
--     team to go) or empty a pairing (two bye teams paired together, leaving
--     a slot with nobody) is refused BY NAME — that is the bracket's
--     arithmetic (§11.5: bracket = 2^⌈log₂ playoff_teams⌉), a VALIDITY wall
--     that binds the commissioner too (standing rule (i)).
--   • A pairing that has been PLAYED — any of its rows carries a score, a
--     result or `is_overridden` — is never re-paired (§22.2 / rule 9, the
--     same wall 130 keeps at 111:894): the numbers on the row belong to the
--     teams that played it. Correct the numbers with 126; re-pair a clean
--     pairing. A pairing whose week has merely OPENED or KICKED OFF (default
--     0 scores, nothing written) is re-pairable — those are TIMING gates and
--     are lifted and named (standing rule (g), D335).
--   • The engine STANDS DOWN on a hand-picked round (§3 above): the
--     correction-close rebuild (§11.5 (E)) and the rollover compare no longer
--     touch it. That is the point of the feature and it is named in
--     `bypassed[]` and in the §10.3 post, so the league can see the seeds no
--     longer follow a late correction for that round.
--
-- THE GATES, ONE BY ONE — LIFTED (timing / reachability) vs KEPT (legality)
-- | gate                                             | here |
-- |--------------------------------------------------|------|
-- | league status ≠ playoffs                         | KEPT, by name — no bracket row exists to hand-pick before the rollover writes round 1 (the pre-rollover bracket is a PROJECTED VIEW, §11.5 (E)); a complete league's rounds are all decided |
-- | not a `playoff` row / a seedless `playoff` row   | KEPT, by name — a regular row is 130's; a seedless row is `foreign_rows` (D318(5)), not the engine's, and this verb never adopts it |
-- | a team outside the round's entrants              | KEPT, by name — the task text's subset rule |
-- | a played pairing (score / result / overridden)   | KEPT, by name — §22.2 / rule 9 (130's 111:894 / 111:999) |
-- | the round's shape (drop a team / empty a pairing)| KEPT, by name — bracket arithmetic |
-- | matchup status ≠ scheduled                       | LIFTED → `bypassed` `matchup_status_gate:<status>` |
-- | week status ≠ upcoming                           | LIFTED → `bypassed` `week_status_gate:<week>:<status>` |
-- | the week's own kickoff has passed                | LIFTED → `bypassed` `kickoff_lock:<week>` (standing rule (g)) |
-- | the engine's next re-seed of this round          | STOOD DOWN → `bypassed` `bracket_sync_rebuild:stood_down` (the stand-down §3 builds) |
-- | the no-op                                        | not a refusal: `no_changes: true`, ledger row written, no receipt, no post, no mark |
--
-- WHAT THIS VERB DOES NOT DO, SAID OUT LOUD (§4 rule 15)
--   It re-pairs rows that carry NO score and NO result (the kept gate is the
--   PREMISE), so nothing stored is stale. On a `live` week the next score
--   drain scores the NEW pairing. It never writes `is_overridden`, never
--   touches `league_weeks`, never changes the entrant SET, never re-pairs a
--   LATER round (the engine builds that from this round's survivors, hand-
--   picked or not — pgTAP 082 §J shows it), and never un-marks a round (a
--   hand-picked round stays the commissioner's until the season ends; a
--   second hand-pick re-stamps every row with the newer receipt).
--
-- D137 PROVENANCE
--   `playoff_bracket_sync_internal`: authored against
--   `supabase/migrations/118_playoffs.sql` lines 1279-1651 (the newest and
--   ONLY defining migration — `grep -ln playoff_bracket_sync_internal
--   supabase/migrations/*.sql` → 118 defines, 129/130 only cite). Pre-134
--   `md5(prosrc)` on the local chain 001-133: `237506f3fdd5dca306536a957d641057`
--   (17789 chars). **HUNK COUNT: 1** (`diff -u` → one `@@`, ZERO `-` lines);
--   the DECLARE block is untouched on purpose (`v_cnt` reused).
--   `playoff_bracket_state_internal`: authored against 118:1016-1269. Pre-134
--   md5 `6de204dd58c06174eef8fa307198e59a` (10796 chars). **HUNK COUNT: 1**
--   (one `@@`, ONE `-` line — the closing parenthesis of the weeks object
--   moved down two lines to admit the new key).
--   Both REVOKEs (118:1268-1269, 118:1650-1651) survive CREATE OR REPLACE and
--   are re-stated below anyway. `league_playoff_bracket`, `league_week_advance`
--   and `finalize_matchups` are byte-untouched: a `round_hand_picked` reason
--   falls through their `ELSIF` chains as the every-hour normal, exactly as
--   `round_in_progress` does (118:1885-1898).
--
-- MIGRATION CHECKLIST (tasks-M* §4.4): additive — one new nullable FK column
-- on `matchups` (no backfill: NULL means "the engine's", which every existing
-- row is), one new table, two new functions — plus TWO `CREATE OR REPLACE`s
-- with stated one-hunk diffs. No column dropped, no policy dropped, no
-- signature changed. RLS enabled with ZERO policies on the new table;
-- `REVOKE TRUNCATE` per D350 (optional since 133's schema-wide sweep, kept —
-- harmless; pgTAP 081 §A is the enforcer). Typegen: `matchups` gains one
-- nullable field; the alias block is re-appended byte-identical.
-- **NO `HELD-FROM-PRODUCTION.txt` ENTRY** — the hold is over (PR #282).
-- Push debt after merge: 125-134 (Chris's `npx supabase db push`).
-- WAIVERS: none. R6 / D38 not engaged (nothing backfilled, no CHECK tightened).
--
-- D336's SEVEN PARTS, AND WHERE EACH ONE IS
--   (1) the ledger      → §1, `commish_bracket_actions`
--   (2) ONE audit row   → §2 step (16), through `log_commissioner_action_internal`
--                         (`123:417-453`), INSIDE the no-op guard, AFTER the
--                         pairing write and its re-validation, `IF v_audit_id
--                         IS NULL RAISE`; the MARK (step 17) is stamped after
--                         it because the mark IS the receipt's id (126:929's
--                         posture for `override_action_id`)
--   (3) the no-op       → §2 step (12): the requested pairing equals the
--                         stored one (home, away — the dimensions this verb
--                         changes; a sibling moves only when the target
--                         does); ledger row written anyway, no mark stamped
--   (4) the chat post   → §2 step (18), in-txn and non-disableable (§10.3)
--   (5) the posture     → PLAIN `search_path=''` internal taking `p_at`,
--                         triple-REVOKEd, under a SECURITY DEFINER wrapper
--                         passing `now()`; in-body auth as ONE no-leak 42501
--   (6) the reason      → §2 step (4): OPTIONAL (Q66) — normalised in the
--                         explicit `E' \t\r\n'` class (blank ⇒ NULL), 500 bound
--   (7) the result      → names every gate bypassed and WHY, the stand-down,
--                         the affected teams (D353), what scoring did not
--                         do, `commissioner_action_id` NULL on a no-op
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. The mark. NULL = the engine paired this row's round. Non-NULL = the
--    `commissioner_actions` receipt of the hand-pick; the sync (§3) reads it
--    per ROUND (any seeded row of the round marked ⇒ the round is his).
-- ---------------------------------------------------------------------------
ALTER TABLE matchups
  ADD COLUMN pairing_set_by_action_id UUID REFERENCES commissioner_actions(id);
COMMENT ON COLUMN matchups.pairing_set_by_action_id IS
  'Migration 134 (M6A L.E1.16, PROGRESS F360; spec §11.5 "Bracket is commissioner-editable"): the commissioner_actions receipt of the hand-pick that last set this round''s pairings — stamped on EVERY seeded playoff row of the round by commish_edit_bracket, NULL when the playoffs engine paired it. playoff_bracket_sync_internal STANDS DOWN on a round with any marked row: no compare, no DELETE-and-re-INSERT, no rebuild_refused_round_played — it stands as picked; its survivors feed the next round as usual. Never written by the engine; never cleared.';

-- ---------------------------------------------------------------------------
-- 1. commish_bracket_actions — this verb's OWN replay ledger (D350).
-- ---------------------------------------------------------------------------
CREATE TABLE commish_bracket_actions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  matchup_id  UUID NOT NULL,                     -- the ONE row this submit named (no FK: the receipt outlives the rows)
  action_id   UUID NOT NULL,                     -- client-minted; dedupes retries (E2/D68)
  actor_id    UUID NOT NULL REFERENCES profiles(id),
  result      JSONB NOT NULL,                    -- the verb's returned jsonb, replayed byte-identically
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, action_id)
);
CREATE INDEX idx_commish_bracket_actions_league_matchup ON commish_bracket_actions(league_id, matchup_id);

COMMENT ON TABLE commish_bracket_actions IS
  'Idempotency ledger for commish_edit_bracket (migration 134, D350). ZERO policies: the DEFINER verb is the only reader and writer. NOT the audit log (§12.26: "an action_id is an idempotency key, not an audit record") — a row is written for a NO-OP too, while commissioner_actions is not. Its own namespace, never shared with another verb''s ledger (D350).';

ALTER TABLE commish_bracket_actions ENABLE ROW LEVEL SECURITY;
-- ZERO policies. 133's schema-wide sweep already denies TRUNCATE to new
-- tables; D350's per-table REVOKE is kept (harmless) and asserted in 082 §A.
REVOKE TRUNCATE ON TABLE commish_bracket_actions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. commish_edit_bracket_internal — PLAIN, search_path='', takes the
--    instant as an argument (the TimeProvider seam pgTAP drives).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_edit_bracket_internal(
  p_league_id  UUID,
  p_matchup_id UUID,
  p_home       UUID,
  p_away       UUID,            -- NULL = give p_home a bye
  p_action_id  UUID,
  p_at         TIMESTAMPTZ,
  p_reason     TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_found       BOOLEAN;
  v_m           public.matchups;
  v_reason      TEXT;
  v_result      JSONB;
  v_state       JSONB;
  v_round       JSONB;
  v_r           INTEGER;
  v_wpr         INTEGER;
  v_wk_first    INTEGER;
  v_wk_last     INTEGER;
  v_old_home    UUID;
  v_old_away    UUID;
  v_seeds       JSONB;                       -- team_id → seed, from the round's rows
  v_entrants    JSONB;                       -- the round's teams (sorted by seed)
  v_pairings    INTEGER;                     -- pairings per week BEFORE
  v_new_ids     UUID[] := ARRAY[]::uuid[];
  v_disp_ids    UUID[] := ARRAY[]::uuid[];
  v_sibs        JSONB := '[]'::jsonb;        -- [{home_before, away_before, home_after, away_after, vacated_sides[]}]
  v_i           INTEGER;
  v_t           UUID;
  v_d           UUID;
  v_side        TEXT;
  v_sib         RECORD;
  v_row         RECORD;
  v_wk          RECORD;
  v_w           RECORD;
  v_cnt         INTEGER;
  v_n           INTEGER;
  v_expected    INTEGER;
  v_sh          UUID;
  v_sa          UUID;
  v_message     TEXT;
  v_names       JSONB;
  v_no_changes  BOOLEAN;
  v_bypassed    JSONB := '[]'::jsonb;
  v_bypassed_why JSONB := '{}'::jsonb;
  v_week_status JSONB := '{}'::jsonb;
  v_affected    JSONB;
  v_audit_id    UUID;
  v_scoring     JSONB;
  v_stamped     INTEGER := 0;
  v_ids         UUID[] := ARRAY[]::uuid[];   -- every row this call rewrites (target + siblings, all weeks)
  v_after       JSONB := '[]'::jsonb;        -- [{id, home, away}] the write plan
BEGIN
  -- (0) SHAPE. A malformed call is refused BY NAME, never answered with
  --     `no_changes: true` (§4 rule 15).
  IF p_matchup_id IS NULL THEN
    RAISE EXCEPTION 'commish_edit_bracket: p_matchup_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'commish_edit_bracket: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_home IS NULL THEN
    RAISE EXCEPTION 'commish_edit_bracket: p_home is required — a bracket row always has a home side; a bye is p_away NULL (§11.5 rider (iii))'
      USING ERRCODE = '22023';
  END IF;
  IF p_home = p_away THEN
    RAISE EXCEPTION 'commish_edit_bracket: a team cannot play itself (§11.7 "no self-matchups")'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (rule 8). Every read below is after it.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — ONE no-leak 42501 (D336 part 5).
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_edit_bracket: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY, after auth and before every business gate (`123:602-609`).
  SELECT a.result INTO v_result
  FROM public.commish_bracket_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  -- (4) THE REASON — OPTIONAL (Q66; spec v2.16.41). Explicit class; blank ⇒
  --     NULL; 500 bound by name.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'commish_edit_bracket: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) KEPT (standing rule (a)'s "meaningful state"): a bracket row exists
  --     to be hand-picked only while the league is in its playoffs.
  IF v_league.status <> 'playoffs' THEN
    RAISE EXCEPTION
      'commish_edit_bracket: league % is % — playoff matchups can be hand-picked only while the league is in playoffs (§11.5: before the rollover the bracket is a projected view and no round is written; after the champion the rounds are all decided)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  -- (6) THE ROW, read after the lock; a bracket row the ENGINE wrote.
  SELECT m.* INTO v_m
  FROM public.matchups m
  WHERE m.id = p_matchup_id AND m.league_id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commish_edit_bracket: matchup % is not a matchup of league %', p_matchup_id, p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_m.round_type <> 'playoff' THEN
    RAISE EXCEPTION
      'commish_edit_bracket: matchup % is a % row — only playoff bracket rows are hand-picked here; a regular-season pairing is commish_edit_schedule''s (130)',
      p_matchup_id, v_m.round_type
      USING ERRCODE = 'P0001';
  END IF;
  IF v_m.home_seed IS NULL THEN
    RAISE EXCEPTION
      'commish_edit_bracket: matchup % is a playoff row with NO seed — not the engine''s (a foreign row, §11.5 / D318(5)); the sync names it and this verb does not adopt it. Remove it or let the engine write the round',
      p_matchup_id
      USING ERRCODE = 'P0001';
  END IF;

  -- (7) THE ROUND — from the engine's own reading of the bracket, so a
  --     two-week round is one pairing on `weeks_per_round` rows.
  v_state := public.playoff_bracket_state_internal(p_league_id);
  IF v_state ->> 'kind' <> 'bracket' THEN
    RAISE EXCEPTION 'commish_edit_bracket: league % has no bracket (kind %) — nothing to hand-pick (§11.5 (C)/(D))', p_league_id, v_state ->> 'kind'
      USING ERRCODE = 'P0001';
  END IF;
  v_wpr := (v_state ->> 'weeks_per_round')::int;
  v_r   := NULL;
  FOR v_row IN SELECT x AS r FROM jsonb_array_elements(v_state -> 'round_list') x LOOP
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_row.r -> 'weeks') w WHERE (w ->> 'week')::int = v_m.week) THEN
      v_round := v_row.r;
      v_r     := (v_row.r ->> 'round')::int;
    END IF;
  END LOOP;
  IF v_r IS NULL THEN
    RAISE EXCEPTION 'commish_edit_bracket: matchup % sits in week %, which is no playoff round of league % (playoff_start_week %, % rounds × % weeks) — the plan is defective',
      p_matchup_id, v_m.week, p_league_id, v_state ->> 'playoff_start_week', v_state ->> 'rounds', v_wpr
      USING ERRCODE = 'P0001';
  END IF;
  v_wk_first := (v_state ->> 'playoff_start_week')::int + (v_r - 1) * v_wpr;
  v_wk_last  := v_wk_first + v_wpr - 1;
  v_old_home := v_m.home_team_id;
  v_old_away := v_m.away_team_id;

  -- (8) THE ROUND's ENTRANTS and their FROZEN seeds — read from the seeded
  --     rows (every week must agree: the engine writes each pairing once per
  --     week, 118:1578-1590; a round whose weeks disagree is not one this
  --     verb can reason about and is refused by name).
  SELECT COALESCE(jsonb_object_agg(x.team_id::text, x.seed), '{}'::jsonb), count(*)::int
    INTO v_seeds, v_n
  FROM (
    SELECT DISTINCT team_id, seed FROM (
      SELECT m.home_team_id AS team_id, m.home_seed AS seed FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week BETWEEN v_wk_first AND v_wk_last
        AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL
      UNION ALL
      SELECT m.away_team_id, m.away_seed FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week BETWEEN v_wk_first AND v_wk_last
        AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL AND m.away_team_id IS NOT NULL) s
  ) x;
  IF v_n <> (SELECT count(DISTINCT k) FROM jsonb_object_keys(v_seeds) k) THEN
    RAISE EXCEPTION 'commish_edit_bracket: round % of league % carries a team under two different seeds across its rows — refusing to reason about a round the engine did not write consistently', v_r, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(jsonb_agg(k ORDER BY (v_seeds ->> k)::int), '[]'::jsonb) INTO v_entrants FROM jsonb_object_keys(v_seeds) k;
  -- Pairings per week, before (the SHAPE this verb preserves).
  SELECT count(*)::int INTO v_pairings
  FROM public.matchups m
  WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week = v_m.week
    AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL;
  FOR v_w IN SELECT g FROM generate_series(v_wk_first, v_wk_last) g LOOP
    SELECT count(*)::int INTO v_cnt
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week = v_w.g
      AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL;
    IF v_cnt <> v_pairings THEN
      RAISE EXCEPTION 'commish_edit_bracket: round % of league % holds % pairings in week % but % in week % — refusing (the engine writes every week of a round alike, 118:1578-1590)',
        v_r, p_league_id, v_pairings, v_m.week, v_cnt, v_w.g
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- (9) KEPT — a PLAYED pairing (any row of it across the round's weeks
  --     carries a score, a result or the override flag) is never re-paired
  --     (§22.2 / rule 9 — 130's 111:894). The numbers belong to the teams
  --     that played it; correcting them is 126's.
  SELECT count(*)::int INTO v_cnt
  FROM public.matchups m
  WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week BETWEEN v_wk_first AND v_wk_last
    AND m.round_type = 'playoff'
    AND m.home_team_id = v_old_home AND m.away_team_id IS NOT DISTINCT FROM v_old_away
    AND (m.is_overridden OR m.result IS NOT NULL
         OR COALESCE(m.home_score, 0) <> 0 OR COALESCE(m.away_score, 0) <> 0);
  IF v_cnt > 0 THEN
    RAISE EXCEPTION
      'commish_edit_bracket: the round-% pairing on matchup % carries a result or score on % of its % row(s) — a played pairing is never re-paired (§22.2/rule 9): the numbers belong to the teams that played it. Correct them with commish_edit_score / commish_set_result (126); hand-pick a pairing that carries none',
      v_r, p_matchup_id, v_cnt, v_wpr
      USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*)::int INTO v_cnt
  FROM public.matchups m
  WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week BETWEEN v_wk_first AND v_wk_last
    AND m.round_type = 'playoff'
    AND m.home_team_id = v_old_home AND m.away_team_id IS NOT DISTINCT FROM v_old_away;
  IF v_cnt <> v_wpr THEN
    RAISE EXCEPTION 'commish_edit_bracket: the pairing on matchup % appears on % row(s) of round % but the round is % week(s) wide — refusing (118:1578-1590 writes one row per week)',
      p_matchup_id, v_cnt, v_r, v_wpr
      USING ERRCODE = 'P0001';
  END IF;

  -- (10) KEPT — the SUBSET rule (the task text): both named teams must be
  --      entrants of THIS round. Who qualified is the standings' / the prior
  --      round's, never this verb's.
  FOR v_t IN SELECT unnest(ARRAY[p_home, p_away]) LOOP
    IF v_t IS NOT NULL AND NOT (v_seeds ? v_t::text) THEN
      RAISE EXCEPTION
        'commish_edit_bracket: team % is not in round % of league % — the round''s entrants are the % teams seeded on its rows (%), and who qualifies is decided by the standings and the prior round''s results, not here. Re-pair among those teams; to change who is in, correct the games that decided it (commish_edit_score / commish_set_result)',
        v_t, v_r, p_league_id, v_n, (SELECT string_agg(e #>> '{}', ', ') FROM jsonb_array_elements(v_entrants) e)
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- (11) LIFTED, NAMED — the timing gates (standing rule (g)/(i)): the
  --      pairing's row status, each week's status, each week's own kickoff.
  IF v_m.status <> 'scheduled' THEN
    v_bypassed := v_bypassed || to_jsonb(('matchup_status_gate:' || v_m.status)::text);
    v_bypassed_why := v_bypassed_why || jsonb_build_object('matchup_status_gate',
      'the pairing''s row is ' || v_m.status || ' — a TIMING gate (standing rule (i)); the commissioner override stands outside it, and the pairing carries no score and no result (step 9), so nothing stored is rewritten');
  END IF;
  FOR v_w IN
    SELECT lw.week, lw.status FROM public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_m.season AND lw.week BETWEEN v_wk_first AND v_wk_last
    ORDER BY lw.week
  LOOP
    v_week_status := v_week_status || jsonb_build_object(v_w.week::text, v_w.status);
    IF v_w.status <> 'upcoming' THEN
      v_bypassed := v_bypassed || to_jsonb(('week_status_gate:' || v_w.week || ':' || v_w.status)::text);
      v_bypassed_why := v_bypassed_why || jsonb_build_object('week_status_gate:' || v_w.week,
        'week ' || v_w.week || ' is ' || v_w.status || ' — the week gate is a TIMING constraint (standing rule (i)) and does not bind the commissioner override');
    END IF;
    SELECT * INTO v_wk FROM public.schedule_window_internal(v_m.season, v_w.week, p_at);
    IF NOT v_wk.free THEN
      v_bypassed := v_bypassed || to_jsonb(('kickoff_lock:' || v_w.week)::text);
      v_bypassed_why := v_bypassed_why || jsonb_build_object('kickoff_lock:' || v_w.week,
        'week ' || v_w.week || ' kicked off at ' || v_wk.first_kickoff_at || ' (' || v_wk.datum_arm || ') — the game-day lock does not bind the commissioner (standing rule (g), D335)');
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_object_keys(v_week_status)) <> v_wpr THEN
    RAISE EXCEPTION 'commish_edit_bracket: round % of league % spans weeks %..% but league_weeks holds % of % rows (§12.17) — refusing rather than re-pairing a week the engine never opened',
      v_r, p_league_id, v_wk_first, v_wk_last, (SELECT count(*) FROM jsonb_object_keys(v_week_status)), v_wpr
      USING ERRCODE = 'P0001';
  END IF;

  -- (12) THE NO-OP, DETECTED BY VALUE (D336 part 3): the requested pairing
  --      equals the stored one on both dimensions this verb changes.
  v_no_changes := (p_home = v_old_home AND p_away IS NOT DISTINCT FROM v_old_away);

  IF NOT v_no_changes THEN
    -- (13) THE PERMUTATION — 130:490-551 in meaning, with a BYE as a slot.
    --      New teams not already in this pairing; the teams they displace
    --      (home first on both sides). A displaced team takes the slot the
    --      new team vacated; a slot with no displaced team to take it
    --      becomes a bye (normalised to the home side — a bye row is
    --      `away_team_id NULL`); a pairing left with NOBODY is refused; a
    --      displaced team with NOWHERE to go is refused.
    IF p_home <> v_old_home AND p_home IS DISTINCT FROM v_old_away THEN v_new_ids := array_append(v_new_ids, p_home); END IF;
    IF p_away IS NOT NULL AND p_away <> v_old_home AND p_away IS DISTINCT FROM v_old_away THEN v_new_ids := array_append(v_new_ids, p_away); END IF;
    IF v_old_home <> p_home AND v_old_home IS DISTINCT FROM p_away THEN v_disp_ids := array_append(v_disp_ids, v_old_home); END IF;
    IF v_old_away IS NOT NULL AND v_old_away <> p_home AND v_old_away IS DISTINCT FROM p_away THEN v_disp_ids := array_append(v_disp_ids, v_old_away); END IF;

    IF COALESCE(array_length(v_disp_ids, 1), 0) > COALESCE(array_length(v_new_ids, 1), 0) THEN
      RAISE EXCEPTION
        'commish_edit_bracket: the request would drop % from round % — every entrant plays (or holds a bye) exactly once, and no slot opens for it (§11.5 bracket arithmetic). To give a team a bye, hand-pick the BYE row and name that team; the team it displaces then takes the vacated slot',
        v_disp_ids[array_length(v_disp_ids, 1)], v_r
        USING ERRCODE = 'P0001';
    END IF;

    FOR v_i IN 1..COALESCE(array_length(v_new_ids, 1), 0) LOOP
      v_t := v_new_ids[v_i];
      v_d := v_disp_ids[v_i];   -- NULL when there is no displaced team for this slot ⇒ a bye
      -- The sibling pairing (in the target's week — every week mirrors it).
      SELECT m.home_team_id, m.away_team_id INTO v_sib
      FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week = v_m.week
        AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL AND m.id <> p_matchup_id
        AND (m.home_team_id = v_t OR m.away_team_id = v_t);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'commish_edit_bracket: team % is seeded in round % but sits on no other pairing of week % — the round is not the engine''s one-per-team shape', v_t, v_r, v_m.week
          USING ERRCODE = 'P0001';
      END IF;
      v_side := CASE WHEN v_sib.home_team_id = v_t THEN 'home' ELSE 'away' END;
      -- KEPT — a PLAYED sibling pairing (any of its rows across the weeks).
      SELECT count(*)::int INTO v_cnt
      FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week BETWEEN v_wk_first AND v_wk_last
        AND m.round_type = 'playoff'
        AND m.home_team_id = v_sib.home_team_id AND m.away_team_id IS NOT DISTINCT FROM v_sib.away_team_id
        AND (m.is_overridden OR m.result IS NOT NULL
             OR COALESCE(m.home_score, 0) <> 0 OR COALESCE(m.away_score, 0) <> 0);
      IF v_cnt > 0 THEN
        RAISE EXCEPTION
          'commish_edit_bracket: %''s current round-% pairing carries a result or score — a played pairing is never re-paired (§22.2/rule 9), and the edit would have to move % out of it',
          v_t, v_r, v_t
          USING ERRCODE = 'P0001';
      END IF;
      -- One entry PER SIBLING PAIRING: two new teams drawn from the same
      -- pairing (a pairing swap) merge into one entry.
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_sibs) s
                 WHERE (s ->> 'home_before')::uuid = v_sib.home_team_id
                   AND (s ->> 'away_before')::uuid IS NOT DISTINCT FROM v_sib.away_team_id) THEN
        SELECT jsonb_agg(
                 CASE WHEN (s ->> 'home_before')::uuid = v_sib.home_team_id
                       AND (s ->> 'away_before')::uuid IS NOT DISTINCT FROM v_sib.away_team_id
                      THEN jsonb_set(
                             jsonb_set(s, ARRAY[v_side || '_after'], COALESCE(to_jsonb(v_d), 'null'::jsonb), TRUE),
                             ARRAY['vacated_sides'], (s -> 'vacated_sides') || to_jsonb(v_side), TRUE)
                      ELSE s END)
          INTO v_sibs
        FROM jsonb_array_elements(v_sibs) s;
      ELSE
        v_sibs := v_sibs || jsonb_build_object(
          'home_before',   v_sib.home_team_id,
          'away_before',   v_sib.away_team_id,
          'home_after',    CASE WHEN v_side = 'home' THEN v_d ELSE v_sib.home_team_id END,
          'away_after',    CASE WHEN v_side = 'away' THEN v_d ELSE v_sib.away_team_id END,
          'vacated_sides', jsonb_build_array(v_side));
      END IF;
    END LOOP;

    -- Bye normalisation and the EMPTY-pairing refusal, per sibling.
    SELECT COALESCE(jsonb_agg(
             CASE WHEN (s ->> 'home_after') IS NULL AND (s ->> 'away_after') IS NULL THEN s
                  WHEN (s ->> 'home_after') IS NULL
                  THEN jsonb_set(jsonb_set(s, '{home_after}', s -> 'away_after', TRUE), '{away_after}', 'null'::jsonb, TRUE) || '{"bye_normalised": true}'::jsonb
                  ELSE s END), '[]'::jsonb)
      INTO v_sibs
    FROM jsonb_array_elements(v_sibs) s;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_sibs) s WHERE (s ->> 'home_after') IS NULL) THEN
      RAISE EXCEPTION
        'commish_edit_bracket: the request would leave a round-% pairing with NOBODY in it (both of its teams were named into matchup %) — a round keeps its % pairings (§11.5: bracket = 2^⌈log₂ playoff_teams⌉, the byes are slots). Pair a bye team with a team that has an opponent, not with another bye team',
        v_r, p_matchup_id, v_pairings
        USING ERRCODE = 'P0001';
    END IF;

    -- (14) THE WRITE PLAN — every row of the target pairing and of each
    --      sibling pairing, in every week of the round.
    FOR v_row IN
      SELECT m.id, m.week, m.home_team_id, m.away_team_id
      FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week BETWEEN v_wk_first AND v_wk_last
        AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL
        AND (   (m.home_team_id = v_old_home AND m.away_team_id IS NOT DISTINCT FROM v_old_away)
             OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_sibs) s
                        WHERE (s ->> 'home_before')::uuid = m.home_team_id
                          AND (s ->> 'away_before')::uuid IS NOT DISTINCT FROM m.away_team_id))
    LOOP
      IF v_row.home_team_id = v_old_home AND v_row.away_team_id IS NOT DISTINCT FROM v_old_away THEN
        v_sh := p_home; v_sa := p_away;
      ELSE
        SELECT (s ->> 'home_after')::uuid, (s ->> 'away_after')::uuid INTO v_sh, v_sa
        FROM jsonb_array_elements(v_sibs) s
        WHERE (s ->> 'home_before')::uuid = v_row.home_team_id
          AND (s ->> 'away_before')::uuid IS NOT DISTINCT FROM v_row.away_team_id;
      END IF;
      v_ids   := array_append(v_ids, v_row.id);
      v_after := v_after || jsonb_build_object('id', v_row.id, 'week', v_row.week, 'home', v_sh, 'away', v_sa);
    END LOOP;
    v_expected := v_wpr * (1 + jsonb_array_length(v_sibs));
    IF COALESCE(array_length(v_ids, 1), 0) <> v_expected THEN
      RAISE EXCEPTION 'commish_edit_bracket: the write plan covers % rows, expected % (% pairings × % weeks) — refusing', COALESCE(array_length(v_ids, 1), 0), v_expected, 1 + jsonb_array_length(v_sibs), v_wpr
        USING ERRCODE = 'P0001';
    END IF;

    -- (15) THE WRITE — 111:1030-1070's parking permutation under the
    --      IMMEDIATE per-side unique indexes (109:179-183): every rewritten
    --      row parks on a game type this round holds no row of (asserted),
    --      then returns as a `playoff` row with its new teams and THEIR
    --      frozen seeds (a seed follows its team — rider (iii)).
    IF EXISTS (SELECT 1 FROM public.matchups m
               WHERE m.league_id = p_league_id AND m.season = v_m.season
                 AND m.week BETWEEN v_wk_first AND v_wk_last AND m.round_type = 'third_place') THEN
      RAISE EXCEPTION
        'commish_edit_bracket: weeks %..% of league % hold third_place rows — the edit''s parking step cannot use that game type; refusing (§11.5)',
        v_wk_first, v_wk_last, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.matchups SET round_type = 'third_place' WHERE id = ANY(v_ids);
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> v_expected THEN
      RAISE EXCEPTION 'commish_edit_bracket: parked % rows, expected %', v_cnt, v_expected USING ERRCODE = 'P0001';
    END IF;
    FOR v_row IN SELECT (a ->> 'id')::uuid AS id, (a ->> 'home')::uuid AS home, (a ->> 'away')::uuid AS away FROM jsonb_array_elements(v_after) a LOOP
      UPDATE public.matchups
      SET round_type   = 'playoff',
          home_team_id = v_row.home,
          away_team_id = v_row.away,
          home_seed    = (v_seeds ->> v_row.home::text)::smallint,
          away_seed    = CASE WHEN v_row.away IS NULL THEN NULL ELSE (v_seeds ->> v_row.away::text)::smallint END,
          updated_at   = p_at
      WHERE id = v_row.id;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'commish_edit_bracket: rewriting row % touched % rows, expected 1', v_row.id, v_cnt USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    -- KEPT — the round's OWN re-validation, per week: every entrant exactly
    -- once across home ∪ away of the seeded playoff rows, no stranger, the
    -- pairing count unchanged, every seed the team's own.
    FOR v_w IN SELECT g FROM generate_series(v_wk_first, v_wk_last) g LOOP
      SELECT count(*)::int INTO v_cnt
      FROM (
        SELECT app.team_id
        FROM (SELECT m.home_team_id AS team_id FROM public.matchups m
              WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week = v_w.g AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL
              UNION ALL
              SELECT m.away_team_id FROM public.matchups m
              WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week = v_w.g AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL AND m.away_team_id IS NOT NULL) app
        WHERE v_seeds ? app.team_id::text
        GROUP BY app.team_id HAVING count(*) = 1
      ) once;
      IF v_cnt <> v_n THEN
        RAISE EXCEPTION
          'commish_edit_bracket: after the edit, week % of round % does not seat every entrant exactly once (% of % appear exactly once) — refusing (§11.5)',
          v_w.g, v_r, v_cnt, v_n
          USING ERRCODE = 'P0001';
      END IF;
      SELECT count(*)::int INTO v_cnt
      FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week = v_w.g AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL;
      IF v_cnt <> v_pairings THEN
        RAISE EXCEPTION 'commish_edit_bracket: after the edit, week % of round % holds % pairings, expected % — refusing', v_w.g, v_r, v_cnt, v_pairings
          USING ERRCODE = 'P0001';
      END IF;
      IF EXISTS (SELECT 1 FROM public.matchups m
                 WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week = v_w.g AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL
                   AND (   m.home_seed <> (v_seeds ->> m.home_team_id::text)::smallint
                        OR m.away_seed IS DISTINCT FROM CASE WHEN m.away_team_id IS NULL THEN NULL ELSE (v_seeds ->> m.away_team_id::text)::smallint END)) THEN
        RAISE EXCEPTION 'commish_edit_bracket: after the edit, week % of round % carries a seed that is not its team''s frozen seed — refusing (rider (iii))', v_w.g, v_r
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    -- THE AFFECTED TEAMS (D353): both sides of the target and of every
    -- sibling, before and after, distinct, non-null.
    SELECT COALESCE(jsonb_agg(DISTINCT x.t), '[]'::jsonb) INTO v_affected
    FROM (
      SELECT unnest(ARRAY[v_old_home, v_old_away, p_home, p_away]) AS t
      UNION
      SELECT (s ->> 'home_before')::uuid FROM jsonb_array_elements(v_sibs) s
      UNION
      SELECT (s ->> 'away_before')::uuid FROM jsonb_array_elements(v_sibs) s
    ) x WHERE x.t IS NOT NULL;

    -- WHAT SCORING DID NOT DO (§4 rule 15). The kept gate (9) is the premise.
    v_scoring := jsonb_build_object(
      'stored_cells_rewritten', 0,
      'week_status',            v_week_status,
      'why',
        'every re-paired row carried no score and no result (the §22.2 gate this verb KEEPS — step 9), so no stored score is stale; '
        || CASE WHEN jsonb_array_length(v_bypassed) = 0
                THEN 'no week of the round has opened or kicked off — nothing downstream has read the pairing'
                ELSE 'a week of the round is under way — the next score drain / finalize scores the NEW pairing; per-team points rows are per-team, not pairings, and are untouched' END);

    -- The STAND-DOWN is named as a bypass BEFORE the receipt is written, so
    -- the receipt carries it (D336 part 7: "bypassed[] names the re-seed it
    -- told to stand down").
    v_bypassed := v_bypassed || to_jsonb('bracket_sync_rebuild:stood_down'::text);
    v_bypassed_why := v_bypassed_why || jsonb_build_object('bracket_sync_rebuild',
      'playoff_bracket_sync_internal would otherwise rewrite round ' || v_r || ' from the prior stage''s verdict at its next run (the rollover compare and the correction-close rebuild, 118:1573-1594 — §11.5 (E)); every seeded row of the round now carries pairing_set_by_action_id = this receipt, and the sync (134 §3) leaves a hand-picked round as written: no compare, no rewrite, no rebuild_refused_round_played. A late correction that moves a seed no longer moves THIS round; the next round is still built from its survivors');

    -- (16) D336 part 2 — EXACTLY ONE audit row, INSIDE the no-op guard,
    --      AFTER the state write and its re-validation.
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'edit_bracket', 'bracket', p_matchup_id::text, v_reason,
      jsonb_build_object('home_team_id', v_old_home, 'away_team_id', v_old_away,
                         'home_seed', v_m.home_seed, 'away_seed', v_m.away_seed),
      jsonb_build_object('home_team_id', p_home, 'away_team_id', p_away,
                         'home_seed', (v_seeds ->> p_home::text)::int,
                         'away_seed', CASE WHEN p_away IS NULL THEN NULL ELSE (v_seeds ->> p_away::text)::int END),
      jsonb_build_object(
        'verb',              'commish_edit_bracket',
        'season',            v_m.season,
        'action_id',         p_action_id,
        'round',             v_r,
        'weeks',             jsonb_build_array(v_wk_first, v_wk_last),
        'week',              v_m.week,
        'week_status',       v_week_status,
        'matchup_status',    v_m.status,
        'round_type',        'playoff',
        'entrants',          v_entrants,
        'seeds',             v_seeds,
        'affected_team_ids', v_affected,          -- D353
        'bypassed',          v_bypassed,
        'bypassed_why',      v_bypassed_why,
        'siblings',          v_sibs,
        'rows_changed',      v_expected,
        'scoring',           v_scoring),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_edit_bracket: the audit row was not written — refusing to let the edit stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- (17) THE MARK — every seeded row of the round, every week (the round
    --      is hand-picked as a whole; the sync reads it per round). Stamped
    --      AFTER the receipt because the mark IS the receipt's id (126:929).
    UPDATE public.matchups m
    SET pairing_set_by_action_id = v_audit_id
    WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week BETWEEN v_wk_first AND v_wk_last
      AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL;
    GET DIAGNOSTICS v_stamped = ROW_COUNT;
    IF v_stamped <> v_pairings * v_wpr THEN
      RAISE EXCEPTION 'commish_edit_bracket: stamped % rows with the hand-pick mark, expected % (% pairings × % weeks)', v_stamped, v_pairings * v_wpr, v_pairings, v_wpr
        USING ERRCODE = 'P0001';
    END IF;

    -- (18) §10.3: the in-txn, non-disableable system post — before/after,
    --      the bypassed gates named, the reason last WHEN one was given.
    SELECT jsonb_object_agg(t.id::text, t.name) INTO v_names
    FROM public.teams t WHERE t.league_id = p_league_id;
    v_message := 'Playoff round ' || v_r || ' (week ' || v_wk_first || CASE WHEN v_wpr > 1 THEN '–' || v_wk_last ELSE '' END || ') matchup hand-picked by '
      || public.draft_actor_name() || ' (commissioner override): '
      || (v_names ->> p_home::text) || ' vs ' || COALESCE(v_names ->> p_away::text, 'bye')
      || ' (was ' || (v_names ->> v_old_home::text) || ' vs ' || COALESCE(v_names ->> v_old_away::text, 'bye') || ')'
      || COALESCE((SELECT '; ' || string_agg(
                     (v_names ->> (s ->> 'home_after')) || ' vs ' || COALESCE(v_names ->> (s ->> 'away_after'), 'bye')
                     || ' (was ' || (v_names ->> (s ->> 'home_before')) || ' vs ' || COALESCE(v_names ->> (s ->> 'away_before'), 'bye') || ')', '; ')
                   FROM jsonb_array_elements(v_sibs) s), '')
      || ' — lifted: ' || (SELECT string_agg(b #>> '{}', ', ') FROM jsonb_array_elements(v_bypassed) b)
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
  END IF;

  -- (19) THE RESULT — D336 part 7.
  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   'commish_edit_bracket',
    'action_type',            'edit_bracket',
    'action_id',              p_action_id,
    'season',                 v_m.season,
    'round',                  v_r,
    'weeks',                  jsonb_build_array(v_wk_first, v_wk_last),
    'week',                   v_m.week,
    'week_status',            v_week_status,
    'matchup_status',         v_m.status,
    'round_type',             'playoff',
    'entrants',               v_entrants,
    'matchup', jsonb_build_object(
      'matchup_id', v_m.id,
      'before', jsonb_build_object('home_team_id', v_old_home, 'away_team_id', v_old_away,
                                   'home_seed', v_m.home_seed, 'away_seed', v_m.away_seed),
      'after',  jsonb_build_object('home_team_id', p_home, 'away_team_id', p_away,
                                   'home_seed', (v_seeds ->> p_home::text)::int,
                                   'away_seed', CASE WHEN p_away IS NULL THEN NULL ELSE (v_seeds ->> p_away::text)::int END)),
    'siblings',               v_sibs,
    'rows_changed',           CASE WHEN v_no_changes THEN 0 ELSE v_expected END,
    'rows_marked',            v_stamped,
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN
                                'pairing_already_as_asked — matchup ' || v_m.id || ' already pairs ' || p_home || ' (home) vs ' || COALESCE(p_away::text, 'bye') || ', so nothing was written, no receipt was issued and the round was not marked (PROGRESS standing rule (b))' END,
    'commissioner_action_id', v_audit_id,            -- NULL on a no-op
    'pairing_set_by_action_id', v_audit_id,          -- the mark now on every seeded row of the round (NULL on a no-op)
    'bypassed',               v_bypassed,
    'bypassed_why',           v_bypassed_why,
    'affected_team_ids',      COALESCE(v_affected, '[]'::jsonb),
    'scoring',                v_scoring,             -- NULL on a no-op
    'reason_required',        FALSE,                 -- Q66
    'reason',                 v_reason,
    'system_post',            v_message,             -- NULL on a no-op
    'evaluated_at',           p_at);

  -- The ledger row is written for a NO-OP TOO (`123:1259-1266`).
  INSERT INTO public.commish_bracket_actions (league_id, matchup_id, action_id, actor_id, result)
  VALUES (p_league_id, p_matchup_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_edit_bracket_internal(UUID, UUID, UUID, UUID, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The client door. Transaction `now()` (D307(3)); SECURITY DEFINER; the
--    in-body auth is the internal's step (2). 130:781's argument order.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_edit_bracket(
  p_league_id  UUID,
  p_matchup_id UUID,
  p_home       UUID,
  p_away       UUID DEFAULT NULL,   -- NULL = a bye for p_home
  p_reason     TEXT DEFAULT NULL,   -- OPTIONAL (Q66): blank ⇒ NULL, never refused; ≤ 500 when given
  p_action_id  UUID DEFAULT NULL    -- REQUIRED in-body (22023)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.commish_edit_bracket_internal(
    p_league_id, p_matchup_id, p_home, p_away, p_action_id, now(), p_reason);
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_edit_bracket(UUID, UUID, UUID, UUID, TEXT, UUID)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 4. playoff_bracket_sync_internal — CREATE OR REPLACE against 118:1279-1651's
--    FILE TEXT, EXACTLY ONE NEW HUNK (the stand-down), inserted after the
--    decided-round block (118:1430-1447) and before R840's pending check
--    (118:1449). See the banner's D137 PROVENANCE. The text below is the
--    extraction, not a re-typing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION playoff_bracket_sync_internal(
  p_league_id UUID,
  p_now       TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league    public.leagues;
  v_settings  JSONB;
  v_mode      TEXT;
  v_pt        INTEGER;
  v_wpr       INTEGER;
  v_reseed    BOOLEAN;
  v_key       TEXT;
  v_b         INTEGER;
  v_rounds    INTEGER;
  v_state     JSONB;
  v_st        JSONB;
  v_round     JSONB;
  v_r         INTEGER;
  v_prev_rolled BOOLEAN;
  v_prev_final  BOOLEAN;
  v_prev_roll_at TIMESTAMPTZ;
  v_entrants  JSONB;
  v_desired   JSONB;
  v_desired_txt TEXT;
  v_stored_txt  TEXT;
  v_decided   INTEGER;
  v_cnt       INTEGER;
  v_expected  INTEGER;
  v_wk_first  INTEGER;
  v_wk_last   INTEGER;
  v_champion  UUID;
  v_n         INTEGER;
  v_open      JSONB;
  v_played    INTEGER;
  v_pending   JSONB;
  v_pend      JSONB;
  v_w         RECORD;
  v_prev_wk_first INTEGER;
  v_prev_wk_last  INTEGER;
BEGIN
  -- Rule 8: the league row first (the jobs hold it already — free).
  SELECT l.* INTO v_league FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'playoff_bracket_sync_internal: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  -- (vi) forward only: a complete league is never claimed; a pre-season one
  -- has nothing to sync.
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RETURN jsonb_build_object('reason', 'not_in_play', 'status', v_league.status);
  END IF;

  v_settings := COALESCE(v_league.settings, '{}'::jsonb);
  v_mode     := COALESCE(v_settings ->> 'schedule_mode', 'h2h');
  v_pt       := COALESCE(v_league.playoff_teams, 0);
  v_wpr      := COALESCE((v_settings ->> 'playoff_weeks_per_round')::int, 1);
  v_reseed   := COALESCE((v_settings ->> 'playoff_reseed')::boolean, TRUE);
  v_key      := CASE WHEN v_reseed THEN 'seed' ELSE 'line' END;
  v_b        := public.playoff_bracket_size_internal(v_pt);
  v_rounds   := public.schedule_playoff_rounds(v_pt);

  v_state := public.playoff_bracket_state_internal(p_league_id);
  IF (v_state -> 'regular_season' ->> 'first_week') IS NULL THEN
    RETURN jsonb_build_object('reason', 'no_season');
  END IF;

  -- (C)/(D): NO bracket. The champion is standings rank 1 through the FULL
  -- chain (117's final arm — never the projection) at the instant the LAST
  -- regular-season week is `final` — every regular week final, so a held
  -- earlier week (a named finalize skip) still waits; in_season → complete
  -- in this transaction.
  IF v_mode <> 'h2h' OR v_pt < 2 THEN
    IF v_league.status <> 'in_season' THEN
      -- A total_points / no-playoff league is never `playoffs` by any job
      -- path; if one is, say so rather than crown anybody.
      RETURN jsonb_build_object('reason', 'no_bracket_league_not_in_season', 'status', v_league.status,
                                'kind', v_state ->> 'kind');
    END IF;
    IF NOT (v_state ->> 'regular_season_final')::boolean THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('week', lw.week, 'status', lw.status) ORDER BY lw.week), '[]'::jsonb)
        INTO v_open
      FROM public.league_weeks lw
      WHERE lw.league_id = p_league_id AND lw.season = v_league.season
        AND lw.week >= (v_state -> 'regular_season' ->> 'first_week')::int
        AND lw.week <= (v_state -> 'regular_season' ->> 'last_week')::int
        AND lw.status <> 'final';
      RETURN jsonb_build_object('reason', 'waiting_regular_season', 'kind', v_state ->> 'kind', 'open_weeks', v_open);
    END IF;
    v_st := public.league_standings_internal(p_league_id, FALSE);
    v_champion := (v_st -> 'standings' -> 0 ->> 'team_id')::uuid;
    IF v_champion IS NULL THEN
      RAISE EXCEPTION 'playoff_bracket_sync_internal: league % — the regular season is final but the standings hold no row (no seated team?)', p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.leagues
    SET status = 'complete', champion_team_id = v_champion, updated_at = p_now
    WHERE id = p_league_id AND status = 'in_season';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'playoff_bracket_sync_internal: completing league % touched % rows, expected 1', p_league_id, v_cnt
        USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'action', 'complete', 'kind', v_state ->> 'kind', 'basis', 'standings_rank_1',
      'champion_team_id', v_champion, 'from_status', 'in_season',
      'separated_by', v_st -> 'standings' -> 0 -> 'separated_by');
  END IF;

  -- The bracket. Round r is due the moment its prior stage (the regular
  -- season for r = 1, round r − 1 after) has ROLLED — every week closed at
  -- last_game_ends_at; built from the PROVISIONAL verdict then and REBUILT
  -- from the FINAL one at the close if the pairing moved. A round holding a
  -- decided row (final / overridden / a written result) is history.
  IF NOT (v_state ->> 'regular_season_rolled')::boolean THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('week', lw.week, 'status', lw.status) ORDER BY lw.week), '[]'::jsonb)
      INTO v_open
    FROM public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season
      AND lw.week >= (v_state -> 'regular_season' ->> 'first_week')::int
      AND lw.week <= (v_state -> 'regular_season' ->> 'last_week')::int
      AND lw.status NOT IN ('correction_window', 'final');
    RETURN jsonb_build_object('reason', 'waiting_regular_season', 'kind', 'bracket', 'open_weeks', v_open);
  END IF;

  v_prev_rolled  := TRUE;
  v_prev_final   := (v_state ->> 'regular_season_final')::boolean;
  v_prev_roll_at := (v_state ->> 'rollover_at')::timestamptz;
  v_entrants     := NULL;

  FOR v_r IN 1 .. v_rounds LOOP
    v_round    := v_state -> 'round_list' -> (v_r - 1);
    v_wk_first := (v_state ->> 'playoff_start_week')::int + (v_r - 1) * v_wpr;
    v_wk_last  := v_wk_first + v_wpr - 1;

    -- A playoff row the engine did not write (no seed) — named, never
    -- touched; the round is left alone until a human removes or seeds it.
    IF (v_round ->> 'foreign_rows')::int > 0 THEN
      RETURN jsonb_build_object('reason', 'bracket_foreign_rows', 'round', v_r,
                                'rows', (v_round ->> 'foreign_rows')::int,
                                'weeks', jsonb_build_array(v_wk_first, v_wk_last));
    END IF;

    IF NOT v_prev_rolled THEN
      RETURN jsonb_build_object('reason', 'waiting_round', 'round', v_r - 1);
    END IF;

    -- A decided round is history (rider (iii)): never recomputed, never
    -- compared — its survivors feed the next round.
    SELECT count(*)::int INTO v_decided
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season
      AND m.week >= v_wk_first AND m.week <= v_wk_last
      AND m.round_type = 'playoff'
      AND (m.status = 'final' OR m.is_overridden OR m.result IS NOT NULL);
    IF v_decided > 0 THEN
      IF v_r = v_rounds AND (v_round ->> 'final')::boolean THEN
        EXIT;   -- the champion, below
      END IF;
      v_entrants    := v_round -> 'survivors';
      v_prev_rolled := (v_round ->> 'rolled')::boolean;
      v_prev_final  := (v_round ->> 'final')::boolean;
      v_prev_roll_at := (v_round ->> 'rollover_at')::timestamptz;
      CONTINUE;
    END IF;

    -- L.E1.16 (migration 134, PROGRESS F360 — RULED WANTED, R1047): a round a
    -- COMMISSIONER HAND-PICKED is his, not the engine's. `commish_edit_bracket`
    -- stamps EVERY seeded row of the round with `pairing_set_by_action_id`
    -- (the commissioner_actions receipt), and this is the STAND-DOWN it
    -- named in its `bypassed[]`: the round is never compared against the
    -- prior stage's verdict, never DELETEd and re-INSERTed (the write below)
    -- and never refused as "played" — it stands as picked, its survivors
    -- feed the next round exactly as a decided round's do. An open
    -- hand-picked round returns by name (the `round_in_progress` shape); a
    -- rolled one CONTINUEs. Reused `v_cnt` on purpose: ONE hunk (D137).
    SELECT count(*)::int INTO v_cnt
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season
      AND m.week >= v_wk_first AND m.week <= v_wk_last
      AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL
      AND m.pairing_set_by_action_id IS NOT NULL;
    IF v_cnt > 0 THEN
      IF NOT (v_round ->> 'rolled')::boolean THEN
        RETURN jsonb_build_object('reason', 'round_hand_picked', 'round', v_r,
                                  'source', CASE WHEN v_prev_final THEN 'final' ELSE 'provisional' END,
                                  'weeks', jsonb_build_array(v_wk_first, v_wk_last),
                                  'rows', v_cnt,
                                  'set_by_action_id',
                                    (SELECT max(m.pairing_set_by_action_id::text)
                                     FROM public.matchups m
                                     WHERE m.league_id = p_league_id AND m.season = v_league.season
                                       AND m.week >= v_wk_first AND m.week <= v_wk_last
                                       AND m.round_type = 'playoff' AND m.pairing_set_by_action_id IS NOT NULL));
      END IF;
      v_entrants     := v_round -> 'survivors';
      v_prev_rolled  := TRUE;
      v_prev_final   := (v_round ->> 'final')::boolean;
      v_prev_roll_at := (v_round ->> 'rollover_at')::timestamptz;
      CONTINUE;
    END IF;

    -- R840 (§23.2 / E61): a PROVISIONAL build or rebuild is never seeded
    -- from an ABSENT score. "Provisional" means every score of the prior
    -- stage is WRITTEN and none is yet final — so before either write the
    -- prior stage's non-final weeks are asked the ONE pending question
    -- finalization asks (`week_results_pending_internal`, D137: a NULL
    -- score on any matchup / a seated team without a result row); any
    -- pending ⇒ the bracket WAITS by name — nothing written, no status
    -- flip, retried next run. (The projected READ still shows 0.00 so far —
    -- a view, never a write.) A FINAL prior stage passed this gate when it
    -- finalized.
    IF NOT v_prev_final THEN
      IF v_r = 1 THEN
        v_prev_wk_first := (v_state -> 'regular_season' ->> 'first_week')::int;
        v_prev_wk_last  := (v_state -> 'regular_season' ->> 'last_week')::int;
      ELSE
        v_prev_wk_first := v_wk_first - v_wpr;
        v_prev_wk_last  := v_wk_first - 1;
      END IF;
      v_pending := '[]'::jsonb;
      FOR v_w IN
        SELECT lw.week
        FROM public.league_weeks lw
        WHERE lw.league_id = p_league_id AND lw.season = v_league.season
          AND lw.week >= v_prev_wk_first AND lw.week <= v_prev_wk_last
          AND lw.status <> 'final'
        ORDER BY lw.week
      LOOP
        v_pend := public.week_results_pending_internal(p_league_id, v_league.season, v_w.week);
        IF v_pend IS NOT NULL THEN
          v_pending := v_pending || (jsonb_build_object('week', v_w.week) || v_pend);
        END IF;
      END LOOP;
      IF jsonb_array_length(v_pending) > 0 THEN
        RETURN jsonb_build_object('reason', 'bracket_waiting', 'round', v_r, 'source', 'provisional',
                                  'weeks', jsonb_build_array(v_wk_first, v_wk_last),
                                  'pending', v_pending);
      END IF;
    END IF;

    -- The entrants: round 1 from the standings (the FINAL arm once the
    -- regular season is final, the PROJECTED arm while it is in its
    -- correction window — (E)); a later round from the prior round's
    -- survivors (provisional or final by its rows).
    IF v_r = 1 THEN
      v_st := public.league_standings_internal(p_league_id, NOT v_prev_final);
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'team_id', x ->> 'team_id', 'seed', (x ->> 'rank')::int, 'line', (x ->> 'rank')::int)
               ORDER BY (x ->> 'rank')::int), '[]'::jsonb), count(*)::int
        INTO v_entrants, v_n
      FROM jsonb_array_elements(v_st -> 'standings') x
      WHERE (x ->> 'rank')::int <= v_pt;
      IF v_n <> v_pt THEN
        RAISE EXCEPTION 'playoff_bracket_sync_internal: league % seats % ranked teams for % playoff spots — a bracket cannot be seeded (§7.3.1 playoff_teams ≤ team_count; a retired seat is never seeded)', p_league_id, v_n, v_pt
          USING ERRCODE = 'P0001';
      END IF;
    ELSE
      v_entrants := v_state -> 'round_list' -> (v_r - 2) -> 'survivors';
    END IF;

    v_desired := public.playoff_round_pairs_internal(v_entrants, v_b / (2 ^ (v_r - 1))::int, v_key);
    SELECT string_agg(
             (g -> 'home' ->> 'seed') || ':' || (g -> 'home' ->> 'team_id') || 'v' ||
             COALESCE((g -> 'away' ->> 'seed') || ':' || (g -> 'away' ->> 'team_id'), 'bye'),
             ',' ORDER BY (g -> 'home' ->> 'seed')::int)
      INTO v_desired_txt
    FROM jsonb_array_elements(v_desired) g;
    SELECT string_agg(
             (g ->> 'home_seed') || ':' || (g ->> 'home_team_id') || 'v' ||
             COALESCE((g ->> 'away_seed') || ':' || (g ->> 'away_team_id'), 'bye'),
             ',' ORDER BY (g ->> 'home_seed')::int)
      INTO v_stored_txt
    FROM jsonb_array_elements(v_round -> 'games') g;

    IF v_stored_txt IS NOT NULL AND v_stored_txt = v_desired_txt THEN
      -- Built as the prior stage now says; nothing to write.
      IF NOT (v_round ->> 'rolled')::boolean THEN
        RETURN jsonb_build_object('reason', 'round_in_progress', 'round', v_r,
                                  'source', CASE WHEN v_prev_final THEN 'final' ELSE 'provisional' END);
      END IF;
      v_prev_rolled := TRUE;
      v_prev_final  := (v_round ->> 'final')::boolean;
      v_prev_roll_at := (v_round ->> 'rollover_at')::timestamptz;
      CONTINUE;
    END IF;

    -- R839: a round is HISTORY once it has ROLLED (every week of it
    -- `correction_window` / `final`) OR any of its rows carries a WRITTEN
    -- score (non-NULL and not 109's untouched DEFAULT 0) — its games have
    -- been played. A prior verdict that moves AFTER that (the F238 / Q37
    -- family: a held finalization on the last regular week outliving the
    -- round's kickoff) is REFUSED BY NAME: nothing deleted, nothing
    -- re-paired, later rounds not revisited — the bracket stands as played
    -- until a commissioner acts (M6 §10: a row written with seeds is the
    -- engine's) or the round finalizes (then it is decided, above, and its
    -- survivors feed the next). The ruled rebuild ((E): the correction
    -- close, Thursday 06:00 ET, before any playoff kickoff) meets neither
    -- arm — an open week with the default scores is rewritable.
    IF v_stored_txt IS NOT NULL THEN
      SELECT count(*)::int INTO v_played
      FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = v_league.season
        AND m.week >= v_wk_first AND m.week <= v_wk_last
        AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL
        AND (   (m.home_score IS NOT NULL AND m.home_score <> 0)
             OR (m.away_score IS NOT NULL AND m.away_score <> 0));
      IF (v_round ->> 'rolled')::boolean OR v_played > 0 THEN
        RAISE WARNING 'playoff_bracket_sync_internal: league % round % is HISTORY (rolled %, % scored rows) but the prior stage''s verdict now says % (stored %) — the rewrite is REFUSED; the bracket stands as played until a commissioner acts (M6 §10) or the round finalizes',
          p_league_id, v_r, (v_round ->> 'rolled')::boolean, v_played, v_desired_txt, v_stored_txt;
        RETURN jsonb_build_object(
          'reason',      'rebuild_refused_round_played',
          'round',       v_r,
          'source',      CASE WHEN v_prev_final THEN 'final' ELSE 'provisional' END,
          'weeks',       jsonb_build_array(v_wk_first, v_wk_last),
          'rolled',      (v_round ->> 'rolled')::boolean,
          'scored_rows', v_played,
          'stored',      v_stored_txt,
          'desired',     v_desired_txt);
      END IF;
    END IF;

    -- Write (round empty) or REWRITE (open round, the verdict moved): the
    -- rows per week, seeds frozen, `scheduled` into an upcoming week and
    -- `live` into an open one (116's (a) flips the former at open).
    IF v_stored_txt IS NOT NULL THEN
      DELETE FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = v_league.season
        AND m.week >= v_wk_first AND m.week <= v_wk_last
        AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL;
    END IF;
    INSERT INTO public.matchups
      (league_id, season, week, round_type, home_team_id, away_team_id, home_seed, away_seed, status, created_at, updated_at)
    SELECT p_league_id, v_league.season, lw.week, 'playoff',
           (g -> 'home' ->> 'team_id')::uuid,
           (g -> 'away' ->> 'team_id')::uuid,
           (g -> 'home' ->> 'seed')::smallint,
           (g -> 'away' ->> 'seed')::smallint,
           CASE WHEN lw.status = 'upcoming' THEN 'scheduled' ELSE 'live' END,
           p_now, p_now
    FROM jsonb_array_elements(v_desired) g
    CROSS JOIN public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season
      AND lw.week >= v_wk_first AND lw.week <= v_wk_last;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_expected := jsonb_array_length(v_desired) * v_wpr;
    IF v_cnt <> v_expected THEN
      RAISE EXCEPTION 'playoff_bracket_sync_internal: league % round % wrote % rows, expected % (% pairings × % weeks)', p_league_id, v_r, v_cnt, v_expected, jsonb_array_length(v_desired), v_wpr
        USING ERRCODE = 'P0001';
    END IF;

    -- (vi) in_season → playoffs with the FIRST bracket write, one legal step.
    IF v_r = 1 AND v_league.status = 'in_season' THEN
      UPDATE public.leagues SET status = 'playoffs', updated_at = p_now
      WHERE id = p_league_id AND status = 'in_season';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'playoff_bracket_sync_internal: flipping league % to playoffs touched % rows, expected 1', p_league_id, v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'action',         CASE WHEN v_stored_txt IS NULL THEN 'built' ELSE 'rebuilt' END,
      'round',          v_r,
      'source',         CASE WHEN v_prev_final THEN 'final' ELSE 'provisional' END,
      'key',            v_key,
      'weeks',          jsonb_build_array(v_wk_first, v_wk_last),
      'pairings',       jsonb_array_length(v_desired),
      'rows',           v_expected,
      'status_flipped', (v_r = 1 AND v_league.status = 'in_season'),
      'rollover_at',    v_prev_roll_at,
      'games',          v_desired_txt,
      'replaced',       v_stored_txt);
  END LOOP;

  -- The champion: the last round FINAL — playoffs → complete.
  v_round := v_state -> 'round_list' -> (v_rounds - 1);
  IF (v_round ->> 'final')::boolean THEN
    v_champion := (v_state ->> 'bracket_champion_team_id')::uuid;
    IF v_champion IS NULL THEN
      RAISE EXCEPTION 'playoff_bracket_sync_internal: league % — the last round is final but no winner was read (%)', p_league_id, v_round -> 'games'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_league.status <> 'playoffs' THEN
      RETURN jsonb_build_object('reason', 'champion_decided_but_status_not_playoffs', 'status', v_league.status);
    END IF;
    UPDATE public.leagues
    SET status = 'complete', champion_team_id = v_champion, updated_at = p_now
    WHERE id = p_league_id AND status = 'playoffs';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'playoff_bracket_sync_internal: completing league % touched % rows, expected 1', p_league_id, v_cnt
        USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'action', 'complete', 'kind', 'bracket', 'basis', 'bracket',
      'champion_team_id', v_champion, 'from_status', 'playoffs',
      'decided_by', v_round -> 'games' -> 0 ->> 'decided_by');
  END IF;
  RETURN jsonb_build_object('reason', 'awaiting_final_round', 'round', v_rounds);
END;
$$;
REVOKE EXECUTE ON FUNCTION playoff_bracket_sync_internal(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. playoff_bracket_state_internal — CREATE OR REPLACE against
--    118:1016-1269's FILE TEXT, EXACTLY ONE HUNK (`hand_picked_action_id` on
--    each stored week entry of a game, 118:1163-1167).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION playoff_bracket_state_internal(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_league     public.leagues;
  v_settings   JSONB;
  v_mode       TEXT;
  v_pt         INTEGER;
  v_wpr        INTEGER;
  v_reseed     BOOLEAN;
  v_b          INTEGER;
  v_rounds     INTEGER;
  v_first      INTEGER;
  v_last_reg   INTEGER;
  v_pstart     INTEGER;
  v_reg_rolled BOOLEAN;
  v_reg_final  BOOLEAN;
  v_reg_weeks  INTEGER;
  v_reg_roll_at TIMESTAMPTZ;
  v_reg_close  TIMESTAMPTZ;
  v_r          INTEGER;
  v_wk_first   INTEGER;
  v_wk_last    INTEGER;
  v_weeks      JSONB;
  v_wcount     INTEGER;
  v_rolled     BOOLEAN;
  v_roll_at    TIMESTAMPTZ;
  v_close_at   TIMESTAMPTZ;
  v_foreign    INTEGER;
  v_pair       RECORD;
  v_rows       JSONB;
  v_home_total NUMERIC;
  v_away_total NUMERIC;
  v_pair_final BOOLEAN;
  v_pair_weeks INTEGER;
  v_winner     UUID;
  v_winner_seed INTEGER;
  v_decided    TEXT;
  v_games      JSONB;
  v_all_final  BOOLEAN;
  v_survivors  JSONB;
  v_round_list JSONB := '[]'::jsonb;
  v_built      BOOLEAN;
  v_next_round INTEGER := NULL;
  v_prev_rolled BOOLEAN;
  v_prev_final BOOLEAN;
  v_entrants   JSONB := NULL;
  v_champion   UUID := NULL;
BEGIN
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'playoff_bracket_state_internal: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  v_settings := COALESCE(v_league.settings, '{}'::jsonb);
  v_mode     := COALESCE(v_settings ->> 'schedule_mode', 'h2h');
  v_pt       := COALESCE(v_league.playoff_teams, 0);
  v_wpr      := COALESCE((v_settings ->> 'playoff_weeks_per_round')::int, 1);
  v_reseed   := COALESCE((v_settings ->> 'playoff_reseed')::boolean, TRUE);
  v_b        := public.playoff_bracket_size_internal(v_pt);
  v_rounds   := public.schedule_playoff_rounds(v_pt);

  -- The season in NFL-week terms (D288): first week … first + rsw − 1 is
  -- the regular season; the bracket starts the week after.
  SELECT min(lw.week) INTO v_first
  FROM public.league_weeks lw WHERE lw.league_id = p_league_id AND lw.season = v_league.season;
  v_last_reg := v_first + v_league.regular_season_weeks - 1;
  v_pstart   := v_last_reg + 1;

  -- The regular season's stage: ROLLED when every regular week has closed
  -- (correction_window / final — 116's (b) at last_game_ends_at); FINAL when
  -- every one is final. The instants are the LAST regular week's.
  SELECT bool_and(lw.status IN ('correction_window', 'final')), bool_and(lw.status = 'final'), count(*)::int
    INTO v_reg_rolled, v_reg_final, v_reg_weeks
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season
    AND lw.week >= v_first AND lw.week <= v_last_reg;
  SELECT w.last_game_ends_at, w.correction_window_ends_at INTO v_reg_roll_at, v_reg_close
  FROM public.nfl_weeks w WHERE w.season = v_league.season AND w.week = v_last_reg;
  v_reg_rolled := COALESCE(v_reg_rolled, FALSE) AND v_reg_weeks = v_league.regular_season_weeks;
  v_reg_final  := COALESCE(v_reg_final, FALSE)  AND v_reg_weeks = v_league.regular_season_weeks;

  -- (C)/(D): no bracket — the points race / the standings are the playoff.
  IF v_mode <> 'h2h' OR v_pt < 2 THEN
    RETURN jsonb_build_object(
      'league_id',              p_league_id,
      'season',                 v_league.season,
      'kind',                   CASE WHEN v_mode <> 'h2h' THEN 'points_race' ELSE 'no_playoffs' END,
      'status',                 v_league.status,
      'schedule_mode',          v_mode,
      'playoff_teams',          v_pt,
      'regular_season',         jsonb_build_object('first_week', v_first, 'last_week', v_last_reg),
      'regular_season_rolled',  v_reg_rolled,
      'regular_season_final',   v_reg_final,
      'rollover_week',          v_last_reg,
      'rollover_at',            v_reg_roll_at,
      'corrections_close_at',   v_reg_close,
      'champion_team_id',       v_league.champion_team_id);
  END IF;

  v_prev_rolled := v_reg_rolled;
  v_prev_final  := v_reg_final;

  FOR v_r IN 1 .. v_rounds LOOP
    v_wk_first := v_pstart + (v_r - 1) * v_wpr;
    v_wk_last  := v_wk_first + v_wpr - 1;

    SELECT jsonb_agg(jsonb_build_object(
             'week', lw.week, 'status', lw.status,
             'rollover_at', w.last_game_ends_at, 'corrections_close_at', w.correction_window_ends_at)
             ORDER BY lw.week),
           count(*)::int,
           bool_and(lw.status IN ('correction_window', 'final'))
      INTO v_weeks, v_wcount, v_rolled
    FROM public.league_weeks lw
    JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season
      AND lw.week >= v_wk_first AND lw.week <= v_wk_last;
    IF v_wcount <> v_wpr THEN
      RAISE EXCEPTION 'playoff_bracket_state_internal: league % round % spans NFL weeks %..% but league_weeks holds % of % rows — the plan (110) is defective', p_league_id, v_r, v_wk_first, v_wk_last, v_wcount, v_wpr
        USING ERRCODE = 'P0001';
    END IF;
    v_rolled := COALESCE(v_rolled, FALSE);
    SELECT w.last_game_ends_at, w.correction_window_ends_at INTO v_roll_at, v_close_at
    FROM public.nfl_weeks w WHERE w.season = v_league.season AND w.week = v_wk_last;

    SELECT count(*)::int INTO v_foreign
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season
      AND m.week >= v_wk_first AND m.week <= v_wk_last
      AND m.round_type = 'playoff' AND m.home_seed IS NULL;

    v_games := '[]'::jsonb;
    v_survivors := '[]'::jsonb;
    v_all_final := TRUE;
    FOR v_pair IN
      SELECT m.home_team_id, m.away_team_id, m.home_seed, m.away_seed
      FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = v_league.season
        AND m.week >= v_wk_first AND m.week <= v_wk_last
        AND m.round_type = 'playoff' AND m.home_seed IS NOT NULL
      GROUP BY m.home_team_id, m.away_team_id, m.home_seed, m.away_seed
      ORDER BY m.home_seed, m.away_seed NULLS FIRST
    LOOP
      SELECT jsonb_agg(jsonb_build_object(
               'week', m.week, 'matchup_id', m.id,
               'home_score', m.home_score, 'away_score', m.away_score,
               'status', m.status, 'result', m.result, 'is_overridden', m.is_overridden,
               -- L.E1.16 (migration 134, F360): the receipt of the commissioner
               -- who HAND-PICKED this round, NULL when the engine paired it.
               'hand_picked_action_id', m.pairing_set_by_action_id)
               ORDER BY m.week),
             sum(round(COALESCE(m.home_score, 0), 2)),
             sum(round(COALESCE(m.away_score, 0), 2)),
             bool_and(m.status = 'final'),
             count(*)::int
        INTO v_rows, v_home_total, v_away_total, v_pair_final, v_pair_weeks
      FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = v_league.season
        AND m.week >= v_wk_first AND m.week <= v_wk_last
        AND m.round_type = 'playoff'
        AND m.home_team_id = v_pair.home_team_id
        AND m.away_team_id IS NOT DISTINCT FROM v_pair.away_team_id;

      -- The verdict — (B) the sum; (A) equal ⇒ the higher seed (the smaller
      -- number); a bye ⇒ the home side. The stored `result` is NOT consulted
      -- and never rewritten: each week's row keeps its own W/L/T (E38).
      IF v_pair.away_team_id IS NULL THEN
        v_winner := v_pair.home_team_id; v_winner_seed := v_pair.home_seed; v_decided := 'bye';
      ELSIF v_home_total > v_away_total THEN
        v_winner := v_pair.home_team_id; v_winner_seed := v_pair.home_seed; v_decided := 'points';
      ELSIF v_home_total < v_away_total THEN
        v_winner := v_pair.away_team_id; v_winner_seed := v_pair.away_seed; v_decided := 'points';
      ELSIF v_pair.home_seed < v_pair.away_seed THEN
        v_winner := v_pair.home_team_id; v_winner_seed := v_pair.home_seed; v_decided := 'higher_seed';
      ELSE
        v_winner := v_pair.away_team_id; v_winner_seed := v_pair.away_seed; v_decided := 'higher_seed';
      END IF;
      v_pair_final := v_pair_final AND v_pair_weeks = v_wpr;

      v_games := v_games || jsonb_build_object(
        'home_team_id',   v_pair.home_team_id,
        'home_seed',      v_pair.home_seed,
        'away_team_id',   v_pair.away_team_id,
        'away_seed',      v_pair.away_seed,
        'weeks',          v_rows,
        'home_total',     v_home_total,
        'away_total',     v_away_total,
        'winner_team_id', v_winner,
        'decided_by',     v_decided,
        'final',          v_pair_final);
      v_all_final := v_all_final AND v_pair_final;
      v_survivors := v_survivors || jsonb_build_object(
        'team_id', v_winner,
        'seed',    v_winner_seed,
        'line',    LEAST(v_pair.home_seed, COALESCE(v_pair.away_seed, v_pair.home_seed)));
    END LOOP;

    v_built := jsonb_array_length(v_games) > 0;
    IF v_next_round IS NULL AND NOT v_built THEN
      v_next_round := v_r;
    END IF;
    v_round_list := v_round_list || jsonb_build_object(
      'round',                v_r,
      'weeks',                v_weeks,
      'rollover_at',          v_roll_at,
      'corrections_close_at', v_close_at,
      'rolled',               v_rolled,
      'built',                v_built,
      'final',                v_built AND v_all_final,
      'source',               CASE WHEN NOT v_built THEN NULL WHEN v_prev_final THEN 'final' ELSE 'provisional' END,
      'prior_stage_rolled',   v_prev_rolled,
      'prior_stage_final',    v_prev_final,
      'expected_games',       v_b / (2 ^ v_r)::int,
      'foreign_rows',         v_foreign,
      'games',                v_games,
      'survivors',            v_survivors);
    IF v_built THEN
      v_entrants := v_survivors;
    END IF;
    IF v_r = v_rounds AND v_built AND v_all_final AND jsonb_array_length(v_games) = 1 THEN
      v_champion := (v_games -> 0 ->> 'winner_team_id')::uuid;
    END IF;
    v_prev_rolled := v_built AND v_rolled;
    v_prev_final  := v_built AND v_all_final;
  END LOOP;

  RETURN jsonb_build_object(
    'league_id',              p_league_id,
    'season',                 v_league.season,
    'kind',                   'bracket',
    'status',                 v_league.status,
    'schedule_mode',          v_mode,
    'playoff_teams',          v_pt,
    'bracket_size',           v_b,
    'rounds',                 v_rounds,
    'weeks_per_round',        v_wpr,
    'reseed',                 v_reseed,
    'playoff_start_week',     v_pstart,
    'regular_season',         jsonb_build_object('first_week', v_first, 'last_week', v_last_reg),
    'regular_season_rolled',  v_reg_rolled,
    'regular_season_final',   v_reg_final,
    'rollover_week',          v_last_reg,
    'rollover_at',            v_reg_roll_at,
    'corrections_close_at',   v_reg_close,
    'round_list',             v_round_list,
    'next_round',             v_next_round,
    'entrants_next',          v_entrants,
    'champion_team_id',       v_league.champion_team_id,
    'bracket_champion_team_id', v_champion);
END;
$$;
REVOKE EXECUTE ON FUNCTION playoff_bracket_state_internal(UUID)
  FROM PUBLIC, anon, authenticated;
