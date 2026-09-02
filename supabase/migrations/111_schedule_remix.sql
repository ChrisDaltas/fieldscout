-- ============================================================================
-- Remix + manual matchup edit — §11.7's commissioner half — migration 111
-- (task L.D1.3, the M4 schema lane's third task; tasks-M4-inseason.md §6
-- L.D1.3 + §5 sketch + §7 row 111; spec spec-redraft-leagues.md v2.16.14
-- §11.7 **Remix (commissioner action)** (the three bullets: preview diff →
-- Confirm replaces `scheduled` matchups atomically + the non-disableable
-- system post; free until the first NFL kickoff of league Week 1, after
-- that an override with a reason and only `scheduled` future weeks change,
-- `live`/`final` never regenerate; manual per-matchup editing under the
-- same rules), E41, §15.3 (the remix/confirm routes — L.D4.2's, NOT here),
-- §12.8 (`matchups`), §12.17 (`league_weeks`), §8.7/§8.8 (D97 system
-- posts), §10.3 (the audit log — M6's; D290's interim posture applies);
-- PROGRESS D289 (preview = the same generator run WITHOUT writing; confirm
-- regenerates from the previewed seed in-body), D290 (the interim audit
-- posture), D291 (time discipline), D306(1) + R728 (the seed fold), F40
-- (GROWS here), F222(a)/(b) (the foreign-team refusal + `schedule_preview`
-- land here); D307 (this task's build mechanics).
--
-- Numbering: migration head measured `110_schedule_engine.sql` at task time
-- (`ls supabase/migrations/ | tail -1`) ⇒ **111**; pgTAP head
-- `058_schedule_engine.sql` ⇒ **059** — the tasks-M4 §7 reservations
-- CONFIRMED, not inherited (D161/D166).
--
-- WHAT SHIPS HERE (in file order):
--
--   1. `schedule_actions` — the IDEMPOTENCY LEDGER for the two commissioner
--      verbs below (the 099/C39 rule, verbatim: "an action_id is an
--      idempotency key, NOT an audit"). One row per (league, action_id) with
--      the verb's stored `result` jsonb so a replay returns it
--      BYTE-IDENTICALLY with no second regeneration and no second post
--      (tasks-M4 §4 rule 10). Why a table and not a stamp on the rows it
--      writes: a Remix replaces every `scheduled` row, so a later Remix
--      erases an earlier one's stamps and the earlier action_id would
--      re-execute on a stale retry — a ledger row cannot be erased by a
--      later action (D307(2)). RLS ON with ZERO policies (the 109
--      `score_fanout` shape): no client reads or writes it; the DEFINER RPCs
--      are its only writers and readers. It stores NO reason, NO
--      before/after, NO actor-facing surface — those are `commissioner_
--      actions`' (§10.3, M6). M6 folds this ledger into that table when it
--      lands (ledger F223(a)); until then F40's row carries both verbs.
--
--   2. `schedule_window_internal(season, first_week, at)` — E41's datum,
--      pure: the first kickoff of the league's FIRST week (league Week 1 —
--      for a mid-season league that is NFL week `first_week`, Q29/D288),
--      read from `nfl_games.kickoff_at` AT CALL TIME (E41/E42/D291: a moved
--      kickoff moves the window) with the SAME conservative fallback chain
--      the ruled datum uses (§11.7 Mid-season entry, Q31 rider (2) —
--      `nfl_weeks.first_kickoff_at`, then `starts_at`): with no game rows
--      the window closes at the week's Wednesday 00:00 ET, EARLIER than the
--      letter, never later — the window can only ever be narrower than the
--      truth, which is the never-weaken direction. `free = at <
--      first_kickoff_at` (AT the kickoff instant the window is closed).
--      Each arm is pinned in 059 with −1s/+1s twins.
--
--   3. `schedule_remix_plan_internal(league_id, seed)` — the ONE plan both
--      verbs share (D289's "the same generator run WITHOUT writing" IS
--      110's `schedule_build_internal`; this wraps it — F222(b)). Pure
--      reads: the league's seated franchises (the engine's own source —
--      same-league by construction, pinned), its EFFECTIVE plan
--      (`regular_season_weeks`, `second_opponent`, the season's first week
--      = min(`league_weeks.week`)), the current regular-season `matchups`,
--      and the window. Regenerates the WHOLE regular season through the
--      pure builder with `seed`, then classifies every regular-season week:
--      REGENERABLE iff its `league_weeks` row is `upcoming` AND every
--      matchup row in it is `scheduled` (both — a `live`/`correction_
--      window`/`final` week, or a week holding any non-`scheduled` row,
--      is FROZEN whole, with the reason named per week; a mixed week is
--      frozen entirely because replacing only its `scheduled` rows with a
--      generated week's rows would double-book the teams of the kept rows
--      — §11.7's own uniqueness invariants). Returns jsonb: the window, the
--      regenerable/frozen weeks, the FULL proposed set (kept rows for
--      frozen weeks, generated rows for regenerable ones, each tagged
--      `regenerated`), and the HUMAN DIFF — one row per (week, game type,
--      team) whose opponent or side changes ("Week 3: Team A now plays Team
--      D instead of Team B" / "Week 3: Team A now hosts Team B (was away)")
--      — with `change_count` and an EXPLICIT `no_changes` flag (an identical
--      seed is "no changes", never an empty array mistaken for success —
--      rule 10). `total_points` leagues and leagues with no regular-season
--      rows are refused BY NAME (nothing to remix).
--
--   4. `schedule_preview(p_league_id, p_seed)` — SECURITY DEFINER, commish
--      in-body (one no-leak 42501 for nonexistent / non-member /
--      non-commissioner — 069's shape), `in_season` only, seed range
--      checked, then the plan. NO writes (pinned by before/after digests of
--      every table it could touch).
--
--   5. `schedule_remix_confirm(p_league_id, p_seed, p_reason DEFAULT NULL,
--      p_action_id DEFAULT NULL)` — the §5 sketch's parameter ORDER kept
--      verbatim (Postgres forbids a defaulted parameter before a
--      non-defaulted one, so `p_action_id` is DEFAULT NULL in the signature
--      and REQUIRED in-body — the 077 `create_league` "p_action_id is
--      required" shape). Order of operations: seed/action validation →
--      league row locked FIRST (`FOR UPDATE`, the house lock order) →
--      commish → REPLAY (the ledger; returns the stored result) →
--      `in_season` → the plan (which refuses `total_points`, and is refused
--      here BY NAME when it holds zero regenerable weeks — a confirm that
--      would replace nothing is a refusal, never a silent success) → E41:
--      free window needs no reason; after it, `p_reason` is REQUIRED
--      (non-blank — D290) → DELETE the regenerable weeks' rows (count
--      asserted = the rows the plan counted) → INSERT the generated rows
--      for those weeks as `scheduled` (count asserted) → `schedule_seed`
--      RE-MINTED = the confirmed seed, written back to `leagues.settings`
--      (1 row asserted; the schedule stays reproducible from the stored
--      seed, §11.7) → the D97 in-txn system post to `league_chat`
--      (`context = 'league'`, `is_system = TRUE`, the numbers in the text,
--      the reason in the text after kickoff — the one place the reason
--      lives until M6) → the ledger row. Frozen weeks are never touched:
--      pinned BYTE-IDENTICAL over their raw row text (R601), and the DoD
--      break probe lets the DELETE reach a `live` week to show that pin
--      red. Post-kickoff invariants: within every regenerated week the
--      generator's per-week invariants hold (each team once per game type,
--      E40); ACROSS the frozen/regenerated seam the season-wide balance
--      (repeat spacing/spread, home/away alternation) is NOT re-established
--      — a post-kickoff Remix regenerates the future from a new seed while
--      the past stands, which is exactly E41's "affecting only `scheduled`
--      future weeks" and is said here so nobody reads §11.7's Generation
--      invariants as promises across a mid-season Remix (D307(4)).
--
--   6. `schedule_edit_matchup(p_league_id, p_matchup_id, p_home, p_away,
--      p_reason, p_action_id)` — the manual drag arm, same window / reason
--      / post / ledger law. Sets ONE `scheduled` matchup's pairing to
--      (`p_home`, `p_away`) and RE-SEATS the displaced teams into the slots
--      the new teams vacate in the same (week, game type) — every team
--      plays exactly once per week per game type (§11.7), so a pairing
--      change is a permutation over at most three rows, never a single-row
--      write: the team displaced from the home slot takes the new home
--      team's vacated slot, the displaced away team the new away team's
--      (a side flip displaces nobody; one new team displaces one; two new
--      teams from one matchup swap the two pairings). The permutation is
--      written under 109's IMMEDIATE per-side unique indexes by PARKING
--      the sibling rows on an empty game type for the duration (see the
--      in-body note — the ordering argument this design first relied on
--      was measured FALSE, D307(6)). Refusals BY NAME:
--      a team that is not a seated franchise of THIS league (F222(a) —
--      pinned; the composite FK is still not taken, the writer refuses),
--      `p_home = p_away`, a bye (NULL — v1 schedules even counts only),
--      the pairing already exactly as asked (a no-op edit is a refusal,
--      rule 10), a matchup that is not `scheduled` / not `regular`|
--      `secondary` (playoff rows are 116's) / in a week that is not
--      `upcoming`, a sibling row that is not `scheduled`, and — AFTER the
--      writes, IN-BODY (task item 3 "both unique constraints re-validated
--      in-body"): every team of the league exactly once across home ∪ away
--      for that (week, game type) — the cross-side pin (R703) — and E40
--      (no pair present in both game types that week). The unique indexes
--      stay the race backstop.
--
-- E41 IS EVALUATED AT TRANSACTION TIME (`now()`), NOT AT AN INJECTED
-- INSTANT — deliberately. D291's `p_now` is the front door of the JOB RPCs
-- (cron-driven, never client-callable); these two verbs are CLIENT-FACING
-- commissioner controls, and a caller-supplied instant would let a
-- commissioner pick the free window at will (110 kept `draft_start(uuid)`
-- injection-free for the same reason). The boundary pins in 059 move the
-- KICKOFF instead (`nfl_games.kickoff_at = now() ± 1s` inside the rolled-
-- back txn, where `now()` is frozen), which is the one-unit rule applied to
-- the datum rather than the clock (D307(3)).
--
-- THE SEED SPACE (R728, dispositioned): the builder folds `seed mod
-- 2^31−1` with 0 → 1, so THREE catalog seeds share LCG state 1 — 0, 1 and
-- 2^31−1 — not the one collision 110's comment (110:550–553) and D306(1)
-- named. 110 is merged and its comment is left as printed (this banner and
-- D307(5) carry the correction; 059 pins `build(2147483647) = build(1)` and
-- `build(0) = build(1)` beside 058's `build(0) ≠ build(2147483646)`).
-- DECIDED: the accepted seed space stays the catalog's [0, 2^31−1]
-- (`SCHEDULE_SEED_MAX`), NOT capped at 2^31−2 — the alias is behaviourally
-- harmless (two of 2^31 seeds reproduce another seed's schedule, and every
-- stored seed still reproduces ITS schedule, which is all §11.7 asks), and
-- a cap would have to move `mintScheduleSeed` and its pin for no product
-- effect. Both verbs refuse seeds OUTSIDE [0, 2^31−1] by name (22023), with
-- one-unit twins pinned (−1 / 0, 2^31−1 / 2^31).
--
-- R694/F202 guard-arm note: n/a — no function is replaced here (nothing
-- copied; 110's engine functions are REUSED by name — `schedule_build_
-- internal` is called, never copied, D137/rule 11).
--
-- Migration checklist (§8.1; tasks-M4 §4 rule 5): additive — one new
-- table (RLS on, ZERO policies, one UNIQUE), two plain helpers, three
-- SECURITY DEFINER RPCs; no existing table, column, index, policy or
-- function is altered. Grants doctrine (D18→D23): no per-object GRANT on
-- any table; the plain helpers triple-REVOKEd (`FROM PUBLIC, anon,
-- authenticated`), the three RPCs REVOKEd `FROM PUBLIC, anon`
-- (authenticated keeps EXECUTE — the client-facing shape; the commish check
-- is in-body). SECURITY DEFINER = in-body auth + `search_path = ''` +
-- REVOKE (rule 2). Realtime: NO trigger added — the system post rides
-- 070's existing `league_chat` broadcast; `matchups` has no trigger until
-- 117 (D296 — the schedule change reaches clients on refetch, the D38
-- landing named). Typegen RE-RUN (new table + three RPC signatures) with
-- the hand-written alias block re-appended, additive-only diff attested in
-- the PR. §8.1 staging-rehearsal waiver (R6 go-forward rule): no staging
-- clone exists; the rehearsal evidence is the fresh local `npx supabase db
-- reset` replay of 001–111 + the full pgTAP suite (000–059), recorded in
-- this PR's session-log row, plus CI's from-scratch replay. Prod-safe:
-- nothing here touches a launch-surface table (`lists`, `list_players`,
-- `players`, `player_stats`, `profiles`); the only reads outside the
-- leagues chain are SELECTs on `nfl_games`/`nfl_weeks`/`teams`. Registered
-- in supabase/HELD-FROM-PRODUCTION.txt (range → 082-111) in the same PR
-- (the closed-range rule).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. schedule_actions — the idempotency ledger (099/C39; D307(2))
-- ---------------------------------------------------------------------------
CREATE TABLE schedule_actions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  action_id  UUID NOT NULL,                       -- client-minted; dedupes retries (the E2/D68 replay key)
  kind       TEXT NOT NULL
    CHECK (kind IN ('remix', 'edit_matchup')),
  actor_id   UUID NOT NULL REFERENCES profiles(id),
  result     JSONB NOT NULL,                      -- the verb's returned jsonb, replayed byte-identically
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, action_id)                   -- the race backstop behind the select-then-insert
);

ALTER TABLE schedule_actions ENABLE ROW LEVEL SECURITY;
-- ZERO policies (the 109 score_fanout shape): the DEFINER RPCs are the only
-- readers and writers. Nothing here is a member-facing surface — the
-- league-visible audit timeline is commissioner_actions' (§10.3, M6).

-- ---------------------------------------------------------------------------
-- 2. schedule_window_internal — E41's datum, pure
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION schedule_window_internal(
  p_season     INTEGER,
  p_first_week INTEGER,
  p_at         TIMESTAMPTZ
) RETURNS TABLE (
  first_kickoff_at TIMESTAMPTZ,
  datum_arm        TEXT,
  free             BOOLEAN
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_games TIMESTAMPTZ;
  v_week  public.nfl_weeks;
BEGIN
  SELECT w.* INTO v_week
  FROM public.nfl_weeks w
  WHERE w.season = p_season AND w.week = p_first_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'schedule_window_internal: nfl_weeks has no row for season % week % — the league''s first week is not on the NFL calendar (§12.17/D288)',
      p_season, p_first_week
      USING ERRCODE = 'P0001';
  END IF;

  -- E41/E42/D291: nfl_games.kickoff_at at call time decides when present.
  SELECT min(g.kickoff_at) INTO v_games
  FROM public.nfl_games g
  WHERE g.season = p_season AND g.week = p_first_week;

  IF v_games IS NOT NULL THEN
    first_kickoff_at := v_games;
    datum_arm := 'nfl_games';
  ELSIF v_week.first_kickoff_at IS NOT NULL THEN
    first_kickoff_at := v_week.first_kickoff_at;
    datum_arm := 'nfl_weeks.first_kickoff_at';
  ELSE
    -- The conservative fallback (Wednesday 00:00 ET): earlier than the
    -- letter, never later — without game rows the window only narrows.
    first_kickoff_at := v_week.starts_at;
    datum_arm := 'nfl_weeks.starts_at';
  END IF;

  free := p_at < first_kickoff_at;   -- AT the kickoff instant the window is closed
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION schedule_window_internal(INTEGER, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. schedule_remix_plan_internal — the ONE plan (proposed set + human diff)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION schedule_remix_plan_internal(
  p_league_id UUID,
  p_seed      BIGINT,
  p_at        TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_league   public.leagues;
  v_ids      UUID[];
  v_n        INTEGER;
  v_settings JSONB;
  v_mode     TEXT;
  v_second   BOOLEAN;
  v_first    INTEGER;
  v_last     INTEGER;
  v_window   RECORD;
  v_frozen   JSONB;
  v_regen    INTEGER[];
  v_proposed JSONB;
  v_diff     JSONB;
  v_changes  INTEGER;
  v_current  INTEGER;
  v_regen_rows INTEGER;
BEGIN
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'schedule_remix_plan_internal: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  v_settings := COALESCE(v_league.settings, '{}'::jsonb);
  v_mode := COALESCE(v_settings ->> 'schedule_mode', 'h2h');
  IF v_mode <> 'h2h' THEN
    RAISE EXCEPTION
      'schedule_remix: league % is a % league — it has no matchups to remix (§11.7 "Total-points leagues generate no matchups")',
      p_league_id, v_mode
      USING ERRCODE = 'P0001';
  END IF;
  v_second := COALESCE((v_settings ->> 'second_opponent')::boolean, FALSE);

  -- The league's first week (league Week 1 — for a mid-season league an NFL
  -- week > 1, Q29/D288): the plan 110 materialized.
  SELECT min(w.week) INTO v_first
  FROM public.league_weeks w
  WHERE w.league_id = p_league_id AND w.season = v_league.season;
  IF v_first IS NULL THEN
    RAISE EXCEPTION
      'schedule_remix: league % has no league_weeks rows for season % — no schedule was generated (§11.4 generation is draft completion''s); nothing to remix',
      p_league_id, v_league.season
      USING ERRCODE = 'P0001';
  END IF;
  v_last := v_first + v_league.regular_season_weeks - 1;

  -- The seated franchises — the engine's own source (110:663–678), so the
  -- proposed set is same-league by construction (pinned in 059).
  SELECT array_agg(t.id ORDER BY t.id), count(*)::int
    INTO v_ids, v_n
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.status <> 'retired';
  IF v_n <> v_league.team_count THEN
    RAISE EXCEPTION
      'schedule_remix: league % has % of % franchises seated — a schedule needs every seat (§7.2/D96)',
      p_league_id, v_n, v_league.team_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::int INTO v_current
  FROM public.matchups m
  WHERE m.league_id = p_league_id AND m.season = v_league.season
    AND m.round_type IN ('regular', 'secondary');
  IF v_current = 0 THEN
    RAISE EXCEPTION
      'schedule_remix: league % has no regular-season matchup rows for season % — nothing to remix',
      p_league_id, v_league.season
      USING ERRCODE = 'P0001';
  END IF;

  -- E41: the window, evaluated at p_at against the FIRST week's kickoff.
  SELECT * INTO v_window FROM public.schedule_window_internal(v_league.season, v_first, p_at);

  -- Week classification: REGENERABLE iff the league_weeks row is `upcoming`
  -- AND every matchup row of the week is `scheduled`; otherwise FROZEN, whole,
  -- with the reason named (§11.7: live/final never regenerate; a mixed week
  -- cannot be part-replaced without double-booking the kept rows' teams).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'week', c.week, 'week_status', c.week_status, 'reason', c.reason)
           ORDER BY c.week) FILTER (WHERE c.reason IS NOT NULL), '[]'::jsonb),
         COALESCE(array_agg(c.week ORDER BY c.week) FILTER (WHERE c.reason IS NULL), ARRAY[]::int[])
    INTO v_frozen, v_regen
  FROM (
    SELECT w.week, w.status AS week_status,
           CASE
             WHEN w.status <> 'upcoming' THEN 'week_' || w.status
             WHEN EXISTS (SELECT 1 FROM public.matchups m
                          WHERE m.league_id = p_league_id AND m.season = v_league.season
                            AND m.week = w.week AND m.status <> 'scheduled')
               THEN 'matchup_not_scheduled'
             ELSE NULL
           END AS reason
    FROM public.league_weeks w
    WHERE w.league_id = p_league_id AND w.season = v_league.season
      AND w.week BETWEEN v_first AND v_last
  ) c;

  SELECT count(*)::int INTO v_regen_rows
  FROM public.matchups m
  WHERE m.league_id = p_league_id AND m.season = v_league.season
    AND m.round_type IN ('regular', 'secondary')
    AND m.week = ANY (v_regen);

  -- The proposed set: the pure builder over the whole regular season
  -- (D289 — the same generator, not writing), kept rows for frozen weeks.
  WITH built AS (
    SELECT b.week, b.round_type, b.home_team_id, b.away_team_id
    FROM public.schedule_build_internal(v_ids, p_seed, v_first, v_league.regular_season_weeks, v_second) b
  ),
  proposed AS (
    SELECT b.week, b.round_type, b.home_team_id, b.away_team_id, TRUE AS regenerated
    FROM built b WHERE b.week = ANY (v_regen)
    UNION ALL
    SELECT m.week, m.round_type, m.home_team_id, m.away_team_id, FALSE
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season
      AND m.round_type IN ('regular', 'secondary')
      AND NOT (m.week = ANY (v_regen))
  ),
  current_app AS (   -- one row per (week, type, team): opponent + side, today
    SELECT m.week, m.round_type, m.home_team_id AS team_id, m.away_team_id AS opp_id, 'home' AS side
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season
      AND m.round_type IN ('regular', 'secondary') AND m.week = ANY (v_regen)
    UNION ALL
    SELECT m.week, m.round_type, m.away_team_id, m.home_team_id, 'away'
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season
      AND m.round_type IN ('regular', 'secondary') AND m.week = ANY (v_regen)
  ),
  proposed_app AS (
    SELECT p.week, p.round_type, p.home_team_id AS team_id, p.away_team_id AS opp_id, 'home' AS side
    FROM proposed p WHERE p.regenerated
    UNION ALL
    SELECT p.week, p.round_type, p.away_team_id, p.home_team_id, 'away'
    FROM proposed p WHERE p.regenerated
  ),
  diff AS (
    SELECT c.week, c.round_type, c.team_id,
           tn.name AS team_name,
           c.opp_id AS old_opponent_id, o1.name AS old_opponent_name,
           n.opp_id AS new_opponent_id, o2.name AS new_opponent_name,
           c.side AS old_side, n.side AS new_side,
           CASE
             WHEN c.opp_id IS DISTINCT FROM n.opp_id THEN
               'Week ' || c.week || CASE WHEN c.round_type = 'secondary' THEN ' (second game)' ELSE '' END
               || ': ' || tn.name || ' now plays ' || o2.name || ' instead of ' || o1.name
             ELSE
               'Week ' || c.week || CASE WHEN c.round_type = 'secondary' THEN ' (second game)' ELSE '' END
               || ': ' || tn.name || ' now ' || CASE WHEN n.side = 'home' THEN 'hosts ' ELSE 'visits ' END
               || o2.name || ' (was ' || c.side || ')'
           END AS text
    FROM current_app c
    JOIN proposed_app n ON n.week = c.week AND n.round_type = c.round_type AND n.team_id = c.team_id
    JOIN public.teams tn ON tn.id = c.team_id
    JOIN public.teams o1 ON o1.id = c.opp_id
    JOIN public.teams o2 ON o2.id = n.opp_id
    WHERE c.opp_id IS DISTINCT FROM n.opp_id OR c.side <> n.side
  )
  SELECT
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'week', p.week, 'round_type', p.round_type,
              'home_team_id', p.home_team_id, 'away_team_id', p.away_team_id,
              'regenerated', p.regenerated)
              ORDER BY p.week, p.round_type, p.home_team_id), '[]'::jsonb)
     FROM proposed p),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'week', d.week, 'round_type', d.round_type,
              'team_id', d.team_id, 'team_name', d.team_name,
              'old_opponent_id', d.old_opponent_id, 'old_opponent_name', d.old_opponent_name,
              'new_opponent_id', d.new_opponent_id, 'new_opponent_name', d.new_opponent_name,
              'old_side', d.old_side, 'new_side', d.new_side,
              'text', d.text)
              ORDER BY d.week, d.round_type, d.team_name, d.team_id), '[]'::jsonb)
     FROM diff d),
    (SELECT count(*)::int FROM diff d)
  INTO v_proposed, v_diff, v_changes;

  RETURN jsonb_build_object(
    'league_id',            p_league_id,
    'season',               v_league.season,
    'seed',                 p_seed,
    'current_seed',         (v_settings ->> 'schedule_seed')::bigint,
    'first_week',           v_first,
    'last_regular_week',    v_last,
    'regular_season_weeks', v_league.regular_season_weeks,
    'second_opponent',      v_second,
    'team_count',           v_n,
    'window', jsonb_build_object(
      'evaluated_at',     p_at,
      'first_kickoff_at', v_window.first_kickoff_at,
      'datum_arm',        v_window.datum_arm,
      'free',             v_window.free,
      'reason_required',  NOT v_window.free),
    'weeks_regenerable',    to_jsonb(v_regen),
    'weeks_frozen',         v_frozen,
    'matchups_current',     v_current,
    'matchups_regenerable', v_regen_rows,
    'proposed',             v_proposed,
    'diff',                 v_diff,
    'change_count',         v_changes,
    'no_changes',           (v_changes = 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION schedule_remix_plan_internal(UUID, BIGINT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. schedule_preview — §11.7 "shows a preview diff before Confirm" (commish;
--    pure — no writes)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION schedule_preview(
  p_league_id UUID,
  p_seed      BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF p_seed IS NULL OR p_seed < 0 OR p_seed > 2147483647 THEN
    RAISE EXCEPTION
      'schedule_preview: seed % is outside the schedule seed space [0, 2147483647] (§11.7 / SCHEDULE_SEED_MAX)',
      p_seed
      USING ERRCODE = '22023';
  END IF;

  -- One no-leak 42501 for nonexistent / non-member / non-commissioner
  -- (is_league_commish(NULL) is FALSE) — 069's shape.
  SELECT l.status INTO v_status
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL;
  IF NOT FOUND OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'schedule_preview: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  IF v_status <> 'in_season' THEN
    RAISE EXCEPTION
      'schedule_preview: league % is % — the regular-season schedule can be remixed only while in_season (§11.7)',
      p_league_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  RETURN public.schedule_remix_plan_internal(p_league_id, p_seed, now());
END;
$$;

REVOKE EXECUTE ON FUNCTION schedule_preview(UUID, BIGINT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 5. schedule_remix_confirm — §11.7 "Confirm replaces all scheduled matchups
--    atomically and auto-posts a system message" (E41; D290; D97)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION schedule_remix_confirm(
  p_league_id UUID,
  p_seed      BIGINT,
  p_reason    TEXT DEFAULT NULL,
  p_action_id UUID DEFAULT NULL   -- REQUIRED in-body (the sketch's order kept; Postgres forbids a default before a non-default)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league   public.leagues;
  v_plan     JSONB;
  v_regen    INTEGER[];
  v_free     BOOLEAN;
  v_reason   TEXT;
  v_expected INTEGER;
  v_deleted  INTEGER;
  v_inserted INTEGER;
  v_cnt      INTEGER;
  v_result   JSONB;
  v_settings JSONB;
  v_message  TEXT;
BEGIN
  IF p_seed IS NULL OR p_seed < 0 OR p_seed > 2147483647 THEN
    RAISE EXCEPTION
      'schedule_remix_confirm: seed % is outside the schedule seed space [0, 2147483647] (§11.7 / SCHEDULE_SEED_MAX)',
      p_seed
      USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      'schedule_remix_confirm: p_action_id is required (idempotency key — one UUID per confirm, reused on retry)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, tasks-M4 §4 rule 8).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;

  -- (2) VALIDATE. One no-leak 42501 (069's shape).
  IF NOT FOUND OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'schedule_remix_confirm: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- REPLAY (099/E2): the same action_id returns the stored result, byte-
  -- identically — no second regeneration, no second post.
  SELECT a.result INTO v_result
  FROM public.schedule_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  IF v_league.status <> 'in_season' THEN
    RAISE EXCEPTION
      'schedule_remix_confirm: league % is % — the regular-season schedule can be remixed only while in_season (§11.7)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  -- The plan — the SAME function the preview served (D289: confirm regenerates
  -- from the previewed seed in-body; a client-supplied schedule is never read).
  v_plan := public.schedule_remix_plan_internal(p_league_id, p_seed, now());
  SELECT COALESCE(array_agg(x::int), ARRAY[]::int[]) INTO v_regen
  FROM jsonb_array_elements_text(v_plan -> 'weeks_regenerable') x;
  IF COALESCE(array_length(v_regen, 1), 0) = 0 THEN
    RAISE EXCEPTION
      'schedule_remix_confirm: league % has no regenerable week — every regular-season week is live, final or holds a non-scheduled matchup (weeks frozen: %); nothing to remix (§11.7: live/final weeks never regenerate)',
      p_league_id, v_plan -> 'weeks_frozen'
      USING ERRCODE = 'P0001';
  END IF;

  -- E41 / D290: free until the first kickoff of league Week 1; after that an
  -- override — reason REQUIRED (non-blank).
  v_free := (v_plan -> 'window' ->> 'free')::boolean;
  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF NOT v_free AND v_reason IS NULL THEN
    RAISE EXCEPTION
      'schedule_remix_confirm: league Week 1 kicked off at % (%) — a Remix after the first kickoff is a commissioner override and requires a reason (§11.7 / E41 / D290)',
      v_plan -> 'window' ->> 'first_kickoff_at', v_plan -> 'window' ->> 'datum_arm'
      USING ERRCODE = '22023';
  END IF;

  -- (3) WRITE. Replace the regenerable weeks' rows — ONLY `scheduled` rows
  -- (the plan classified the weeks so; the status predicate here makes the
  -- DELETE itself unable to reach a live/final row), counts asserted against
  -- the engine's arithmetic (weeks × n/2 pairings × game types): the rows
  -- being replaced must have that shape, and the rows written must too.
  v_expected := array_length(v_regen, 1) * ((v_plan ->> 'team_count')::int / 2)
                * (CASE WHEN (v_plan ->> 'second_opponent')::boolean THEN 2 ELSE 1 END);
  IF (v_plan ->> 'matchups_regenerable')::int <> v_expected THEN
    RAISE EXCEPTION
      'schedule_remix_confirm: league % holds % matchup rows across its % regenerable weeks, expected % (% pairings × % game types per week) — the weeks are not the engine''s shape; refusing to regenerate over them',
      p_league_id, (v_plan ->> 'matchups_regenerable')::int, array_length(v_regen, 1), v_expected,
      (v_plan ->> 'team_count')::int / 2,
      CASE WHEN (v_plan ->> 'second_opponent')::boolean THEN 2 ELSE 1 END
      USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.matchups m
  WHERE m.league_id = p_league_id AND m.season = v_league.season
    AND m.round_type IN ('regular', 'secondary')
    AND m.week = ANY (v_regen)
    AND m.status = 'scheduled';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> v_expected THEN
    RAISE EXCEPTION
      'schedule_remix_confirm: deleted % scheduled matchup rows for league %, expected % (the plan''s regenerable rows)',
      v_deleted, p_league_id, v_expected
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.matchups
    (league_id, season, week, round_type, home_team_id, away_team_id, status)
  SELECT p_league_id, v_league.season,
         (p ->> 'week')::int, p ->> 'round_type',
         (p ->> 'home_team_id')::uuid, (p ->> 'away_team_id')::uuid, 'scheduled'
  FROM jsonb_array_elements(v_plan -> 'proposed') p
  WHERE (p ->> 'regenerated')::boolean;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> v_expected THEN
    RAISE EXCEPTION
      'schedule_remix_confirm: inserted % matchup rows for league %, expected % (the plan''s regenerable rows)',
      v_inserted, p_league_id, v_expected
      USING ERRCODE = 'P0001';
  END IF;

  -- RE-MINT: the confirmed seed becomes the league's schedule_seed (§11.7 —
  -- the schedule stays reproducible from the stored seed). Exactly 1 row.
  v_settings := COALESCE(v_league.settings, '{}'::jsonb);
  UPDATE public.leagues
  SET settings   = jsonb_set(v_settings, ARRAY['schedule_seed'], to_jsonb(p_seed), TRUE),
      updated_at = now()
  WHERE id = p_league_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION
      'schedule_remix_confirm: the schedule_seed write-back touched % rows for league % (expected exactly 1)',
      v_cnt, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- D97: the non-disableable in-txn system post, the numbers in the text
  -- (§11.7 "auto-posts a system message to league chat"). The reason lives
  -- here until commissioner_actions exists (D290).
  v_message := 'Schedule remixed by ' || public.draft_actor_name() || ': '
    || array_length(v_regen, 1) || ' of ' || v_league.regular_season_weeks
    || ' regular-season weeks regenerated (weeks '
    || (SELECT string_agg(x::text, ', ' ORDER BY x) FROM unnest(v_regen) x)
    || '), ' || (v_plan ->> 'change_count') || ' team-week pairings changed'
    || CASE WHEN v_free THEN '.'
            ELSE ' — after Week 1 kickoff (commissioner override) — reason: ' || v_reason END;
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);

  v_result := jsonb_build_object(
    'league_id',            p_league_id,
    'season',               v_league.season,
    'action_id',            p_action_id,
    'schedule_seed',        p_seed,
    'previous_seed',        (v_settings ->> 'schedule_seed')::bigint,
    'first_week',           v_plan -> 'first_week',
    'regular_season_weeks', v_league.regular_season_weeks,
    'window',               v_plan -> 'window',
    'reason_required',      NOT v_free,
    'weeks_regenerated',    v_plan -> 'weeks_regenerable',
    'weeks_frozen',         v_plan -> 'weeks_frozen',
    'matchups_replaced',    v_inserted,
    'change_count',         v_plan -> 'change_count',
    'no_changes',           v_plan -> 'no_changes',
    'diff',                 v_plan -> 'diff',
    'system_post',          v_message
  );

  -- The ledger row (the league lock serializes the normal path; the UNIQUE is
  -- the race backstop).
  INSERT INTO public.schedule_actions (league_id, action_id, kind, actor_id, result)
  VALUES (p_league_id, p_action_id, 'remix', auth.uid(), v_result);

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION schedule_remix_confirm(UUID, BIGINT, TEXT, UUID) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 6. schedule_edit_matchup — §11.7 "Manual per-matchup editing (drag Team A ↔
--    Team C for Week 7) stays available in the same tool, same audit rules"
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION schedule_edit_matchup(
  p_league_id  UUID,
  p_matchup_id UUID,
  p_home       UUID,
  p_away       UUID,
  p_reason     TEXT,
  p_action_id  UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league    public.leagues;
  v_m         public.matchups;
  v_week_status TEXT;
  v_first     INTEGER;
  v_window    RECORD;
  v_free      BOOLEAN;
  v_reason    TEXT;
  v_result    JSONB;
  v_old_home  UUID;
  v_old_away  UUID;
  v_new_ids   UUID[] := ARRAY[]::uuid[];   -- new teams not already in the matchup (home first)
  v_disp_ids  UUID[] := ARRAY[]::uuid[];   -- displaced teams (home first)
  v_sib       public.matchups;
  v_sibs      JSONB := '[]'::jsonb;
  v_i         INTEGER;
  v_t         UUID;
  v_d         UUID;
  v_side      TEXT;
  v_cnt       INTEGER;
  v_n         INTEGER;
  v_message   TEXT;
  v_names     JSONB;
BEGIN
  IF p_matchup_id IS NULL THEN
    RAISE EXCEPTION 'schedule_edit_matchup: matchup_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: p_action_id is required (idempotency key — one UUID per edit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_home IS NULL OR p_away IS NULL THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: both teams are required — v1 schedules even counts only, a matchup has no bye (§7.3.1/§11.7)'
      USING ERRCODE = '22023';
  END IF;
  IF p_home = p_away THEN
    RAISE EXCEPTION 'schedule_edit_matchup: a team cannot play itself (§11.7 "no self-matchups")'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;

  -- (2) VALIDATE. One no-leak 42501.
  IF NOT FOUND OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'schedule_edit_matchup: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- REPLAY (099/E2).
  SELECT a.result INTO v_result
  FROM public.schedule_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  IF v_league.status <> 'in_season' THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: league % is % — regular-season matchups can be edited only while in_season (§11.7)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT m.* INTO v_m
  FROM public.matchups m
  WHERE m.id = p_matchup_id AND m.league_id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'schedule_edit_matchup: matchup % is not a matchup of league %', p_matchup_id, p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_m.round_type NOT IN ('regular', 'secondary') THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: matchup % is a % row — only regular-season pairings (regular / secondary) are edited here; brackets are the playoffs engine''s (§11.5)',
      p_matchup_id, v_m.round_type
      USING ERRCODE = 'P0001';
  END IF;
  IF v_m.status <> 'scheduled' THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: matchup % (week %) is % — only scheduled matchups may change; live/final never regenerate (§11.7/E41)',
      p_matchup_id, v_m.week, v_m.status
      USING ERRCODE = 'P0001';
  END IF;
  SELECT w.status INTO v_week_status
  FROM public.league_weeks w
  WHERE w.league_id = p_league_id AND w.season = v_m.season AND w.week = v_m.week;
  IF v_week_status IS DISTINCT FROM 'upcoming' THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: week % of league % is % — only an upcoming week''s matchups may change (§11.7/§12.17)',
      v_m.week, p_league_id, COALESCE(v_week_status, 'missing')
      USING ERRCODE = 'P0001';
  END IF;
  IF v_m.away_team_id IS NULL THEN
    RAISE EXCEPTION 'schedule_edit_matchup: matchup % is a bye row — v1 schedules have none to edit', p_matchup_id
      USING ERRCODE = 'P0001';
  END IF;

  -- F222(a): a foreign or retired team is refused BY NAME (the writer's
  -- refusal in place of the composite FK).
  FOR v_t IN SELECT unnest(ARRAY[p_home, p_away]) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.teams t
                   WHERE t.id = v_t AND t.league_id = p_league_id AND t.status <> 'retired') THEN
      RAISE EXCEPTION
        'schedule_edit_matchup: team % is not a seated franchise of league % — a matchup may only pair this league''s own teams (§11.7/F222)',
        v_t, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  v_old_home := v_m.home_team_id;
  v_old_away := v_m.away_team_id;
  IF p_home = v_old_home AND p_away = v_old_away THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: matchup % already pairs % (home) vs % (away) — nothing to change',
      p_matchup_id, p_home, p_away
      USING ERRCODE = 'P0001';
  END IF;

  -- E41 / D290: the window, from the league's FIRST week's kickoff, now.
  SELECT min(w.week) INTO v_first
  FROM public.league_weeks w
  WHERE w.league_id = p_league_id AND w.season = v_league.season;
  SELECT * INTO v_window FROM public.schedule_window_internal(v_league.season, v_first, now());
  v_free := v_window.free;
  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF NOT v_free AND v_reason IS NULL THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: league Week 1 kicked off at % (%) — a matchup edit after the first kickoff is a commissioner override and requires a reason (§11.7 / E41 / D290)',
      v_window.first_kickoff_at, v_window.datum_arm
      USING ERRCODE = '22023';
  END IF;

  -- The permutation: new teams not already in this matchup, and the teams
  -- they displace (home slot first on both sides). |new| = |displaced|.
  IF p_home <> v_old_home AND p_home <> v_old_away THEN v_new_ids := array_append(v_new_ids, p_home); END IF;
  IF p_away <> v_old_home AND p_away <> v_old_away THEN v_new_ids := array_append(v_new_ids, p_away); END IF;
  IF v_old_home <> p_home AND v_old_home <> p_away THEN v_disp_ids := array_append(v_disp_ids, v_old_home); END IF;
  IF v_old_away <> p_home AND v_old_away <> p_away THEN v_disp_ids := array_append(v_disp_ids, v_old_away); END IF;

  -- (3) WRITE — a permutation over up to three rows under IMMEDIATE per-side
  -- unique indexes (109). MEASURED, not assumed (D276): single-row UPDATEs
  -- in EITHER order collide when a team swaps places with a team on the
  -- SAME side of another row (M = (T2, T5), N = (T4, T3), new (T2, T3):
  -- writing M.away = T3 duplicates N's away T3; writing N.away = T5 first
  -- duplicates M's away T5). So the sibling rows PARK first — they step out
  -- of the week's (round_type, side) uniqueness space onto a round_type
  -- that holds no row in this week (asserted, never assumed) — then the
  -- edited row is written, then each sibling returns to its game type with
  -- its displaced team seated, one UPDATE per row. Every intermediate state
  -- is legal to both indexes; the whole permutation is one transaction.
  --
  -- First resolve every sibling (the row the new team vacates) BEFORE any
  -- write, so every refusal fires against an untouched week.
  FOR v_i IN 1..COALESCE(array_length(v_new_ids, 1), 0) LOOP
    v_t := v_new_ids[v_i];
    SELECT s.* INTO v_sib
    FROM public.matchups s
    WHERE s.league_id = p_league_id AND s.season = v_m.season AND s.week = v_m.week
      AND s.round_type = v_m.round_type AND s.id <> p_matchup_id
      AND (s.home_team_id = v_t OR s.away_team_id = v_t);
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'schedule_edit_matchup: team % has no other % matchup in week % of league % to vacate — the week''s rows are not the engine''s one-per-team shape (§11.7)',
        v_t, v_m.round_type, v_m.week, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_sib.status <> 'scheduled' THEN
      RAISE EXCEPTION
        'schedule_edit_matchup: matchup % (week %, %''s current game) is % — the edit would have to re-seat a team into it; only scheduled matchups may change (§11.7/E41)',
        v_sib.id, v_sib.week, v_t, v_sib.status
        USING ERRCODE = 'P0001';
    END IF;
    v_side := CASE WHEN v_sib.home_team_id = v_t THEN 'home' ELSE 'away' END;
    v_d := v_disp_ids[v_i];
    -- One entry PER SIBLING ROW: two new teams drawn from the same matchup
    -- (the pairing swap) merge into one entry with both slots re-seated.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_sibs) s WHERE (s ->> 'matchup_id')::uuid = v_sib.id) THEN
      SELECT jsonb_agg(
               CASE WHEN (s ->> 'matchup_id')::uuid = v_sib.id
                    THEN jsonb_set(
                           jsonb_set(s, ARRAY['after', v_side || '_team_id'], to_jsonb(v_d), TRUE),
                           ARRAY['vacated_sides'], (s -> 'vacated_sides') || to_jsonb(v_side), TRUE)
                    ELSE s END)
        INTO v_sibs
      FROM jsonb_array_elements(v_sibs) s;
    ELSE
      v_sibs := v_sibs || jsonb_build_object(
        'matchup_id', v_sib.id,
        'vacated_sides', jsonb_build_array(v_side),
        'before', jsonb_build_object('home_team_id', v_sib.home_team_id, 'away_team_id', v_sib.away_team_id),
        'after',  jsonb_build_object(
                    'home_team_id', CASE WHEN v_side = 'home' THEN v_d ELSE v_sib.home_team_id END,
                    'away_team_id', CASE WHEN v_side = 'away' THEN v_d ELSE v_sib.away_team_id END));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_sibs) > 0 THEN
    -- The parking type must be EMPTY in this week (a regular-season week
    -- holds regular/secondary rows only; playoff-family rows live in playoff
    -- weeks — 116's). Asserted: a row there would make parking collide.
    IF EXISTS (SELECT 1 FROM public.matchups m
               WHERE m.league_id = p_league_id AND m.season = v_m.season
                 AND m.week = v_m.week AND m.round_type = 'third_place') THEN
      RAISE EXCEPTION
        'schedule_edit_matchup: week % of league % holds third_place rows — the edit''s parking step cannot use that game type; refusing (§11.7/§11.5)',
        v_m.week, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.matchups
    SET round_type = 'third_place'
    WHERE id IN (SELECT (s ->> 'matchup_id')::uuid FROM jsonb_array_elements(v_sibs) s);
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> jsonb_array_length(v_sibs) THEN
      RAISE EXCEPTION 'schedule_edit_matchup: parked % sibling rows, expected %', v_cnt, jsonb_array_length(v_sibs)
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- The edited row (one UPDATE — a side flip is one row; its new teams are
  -- parked or already its own).
  UPDATE public.matchups
  SET home_team_id = p_home, away_team_id = p_away, updated_at = now()
  WHERE id = p_matchup_id;

  -- Each sibling returns to its game type with the displaced team seated.
  FOR v_sib IN
    SELECT m.* FROM public.matchups m
    WHERE m.id IN (SELECT (s ->> 'matchup_id')::uuid FROM jsonb_array_elements(v_sibs) s)
  LOOP
    UPDATE public.matchups
    SET round_type   = v_m.round_type,
        home_team_id = (s -> 'after' ->> 'home_team_id')::uuid,
        away_team_id = (s -> 'after' ->> 'away_team_id')::uuid,
        updated_at   = now()
    FROM jsonb_array_elements(v_sibs) s
    WHERE public.matchups.id = v_sib.id AND (s ->> 'matchup_id')::uuid = v_sib.id;
  END LOOP;

  -- IN-BODY RE-VALIDATION (task item 3). (a) Every seated franchise exactly
  -- once across home ∪ away in this (week, game type) — the cross-side pin
  -- (R703); the two unique indexes remain the race backstop.
  SELECT count(*)::int INTO v_n FROM public.teams t WHERE t.league_id = p_league_id AND t.status <> 'retired';
  SELECT count(*)::int INTO v_cnt
  FROM (
    SELECT app.team_id
    FROM (SELECT m.home_team_id AS team_id FROM public.matchups m
          WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week = v_m.week AND m.round_type = v_m.round_type
          UNION ALL
          SELECT m.away_team_id FROM public.matchups m
          WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week = v_m.week AND m.round_type = v_m.round_type) app
    GROUP BY app.team_id HAVING count(*) = 1
  ) once;
  IF v_cnt <> v_n THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: after the edit, week % (%) of league % does not seat every team exactly once (% of % teams appear exactly once) — refusing (§11.7 uniqueness)',
      v_m.week, v_m.round_type, p_league_id, v_cnt, v_n
      USING ERRCODE = 'P0001';
  END IF;
  -- (b) E40: no pair may appear in both game types that week.
  IF EXISTS (
    SELECT 1
    FROM public.matchups a
    JOIN public.matchups b
      ON b.league_id = a.league_id AND b.season = a.season AND b.week = a.week
     AND a.round_type = 'regular' AND b.round_type = 'secondary'
     AND least(a.home_team_id, a.away_team_id) = least(b.home_team_id, b.away_team_id)
     AND greatest(a.home_team_id, a.away_team_id) = greatest(b.home_team_id, b.away_team_id)
    WHERE a.league_id = p_league_id AND a.season = v_m.season AND a.week = v_m.week
  ) THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: after the edit, week % of league % would pair the same two teams in both game types — a second game is never the primary opponent (E40)',
      v_m.week, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- D97: the in-txn system post, before/after in the text.
  SELECT jsonb_object_agg(t.id::text, t.name) INTO v_names
  FROM public.teams t WHERE t.league_id = p_league_id;
  v_message := 'Week ' || v_m.week || CASE WHEN v_m.round_type = 'secondary' THEN ' (second game)' ELSE '' END
    || ' matchup edited by ' || public.draft_actor_name() || ': '
    || (v_names ->> p_home::text) || ' vs ' || (v_names ->> p_away::text)
    || ' (was ' || (v_names ->> v_old_home::text) || ' vs ' || (v_names ->> v_old_away::text) || ')'
    || COALESCE((SELECT '; ' || string_agg(
                   (v_names ->> (s -> 'after' ->> 'home_team_id')) || ' vs ' || (v_names ->> (s -> 'after' ->> 'away_team_id'))
                   || ' (was ' || (v_names ->> (s -> 'before' ->> 'home_team_id')) || ' vs '
                   || (v_names ->> (s -> 'before' ->> 'away_team_id')) || ')', '; ')
                 FROM jsonb_array_elements(v_sibs) s), '')
    || CASE WHEN v_free THEN '.'
            ELSE ' — after Week 1 kickoff (commissioner override) — reason: ' || v_reason END;
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);

  v_result := jsonb_build_object(
    'league_id',      p_league_id,
    'season',         v_m.season,
    'action_id',      p_action_id,
    'week',           v_m.week,
    'round_type',     v_m.round_type,
    'matchup', jsonb_build_object(
      'matchup_id', v_m.id,
      'before', jsonb_build_object('home_team_id', v_old_home, 'away_team_id', v_old_away),
      'after',  jsonb_build_object('home_team_id', p_home, 'away_team_id', p_away)),
    'siblings',       v_sibs,
    'rows_changed',   1 + jsonb_array_length(v_sibs),
    'reason_required', NOT v_free,
    'window', jsonb_build_object(
      'evaluated_at',     now(),
      'first_kickoff_at', v_window.first_kickoff_at,
      'datum_arm',        v_window.datum_arm,
      'free',             v_free,
      'reason_required',  NOT v_free),
    'system_post',    v_message
  );

  INSERT INTO public.schedule_actions (league_id, action_id, kind, actor_id, result)
  VALUES (p_league_id, p_action_id, 'edit_matchup', auth.uid(), v_result);

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION schedule_edit_matchup(UUID, UUID, UUID, UUID, TEXT, UUID) FROM PUBLIC, anon;
