-- ============================================================================
-- 155_trade_league_vote.sql — league-vote trade review (M5 task L.D3.4, FULL
-- rigour — permissions).
-- Spec §13.3 (`league_vote`), §7.3.5 (`trade_review`, `trade_veto_votes`,
-- `trade_review_period_hours`), §12.11, §14 (`trade-review-expiry`).
-- Breakdown tasks-M5-transactions.md §6 L.D3.4. Ruling Q77 (Chris
-- 2026-09-27, "approve M5, all recommendations"): every manager EXCEPT the
-- two teams in the trade may vote to veto; the trade is vetoed as soon as
-- veto votes reach the league's number (`trade_veto_votes`, default half the
-- league rounded up); otherwise it goes through when the review period ends;
-- a manager can change his vote until then; the league sees the COUNT only,
-- never who voted. F430 (ruled by Chris 2026-09-28, "Yes"): the veto count
-- is capped at the number of managers who can actually vote. Discharges
-- PROGRESS F430 and F435.
--
-- Numbering: RESERVED by the orchestrator (155 / pgTAP 103). NOT held:
-- reaches production by `npx supabase db push` only.
--
-- WHAT THIS MIGRATION DOES
--   1. `trade_votes` — ONE vote per (trade, voting team): `veto` or
--      `approve` (let it through), the manager who cast it (`voter_id`) and
--      when. RLS: the ONLY policy is SELECT of your OWN vote
--      (`voter_id = auth.uid()`) — nobody, the commissioner included, can
--      read who else voted or how (Q77: "the league sees the count, not who
--      voted"). No write policy for any role; written only by `trade_vote`.
--   2. WHO VOTES (Q77): the seated manager (`league_members.user_id` NOT
--      NULL) of a team in the league that is NOT one of the two teams in the
--      trade and not retired. A member with no team (a commissioner who does
--      not manage a team) does not vote — the commissioner's own approve /
--      veto is L.D3.5's commissioner tool, not a vote. A vote belongs to the
--      manager who cast it: it counts only while he still manages that team
--      (a successor votes for himself; a vacated seat's vote stops
--      counting).
--   3. THE NUMBER (F430): the veto number is `trade_veto_votes` (default
--      ⌈team_count / 2⌉, §7.3.5) CAPPED at the managers who can vote right
--      now — `LEAST(setting, eligible)`. The trade is vetoed when the
--      counted veto votes reach it (and at least one manager voted to
--      veto). The setting's own range (1–team_count, §7.3.5 / 129 / 149)
--      is NOT changed — the cap applies where the number is read.
--   4. `trade_vote(league, trade, vote, action_id)` — the door (DEFINER,
--      passes now()). League row locked FIRST; members only (no-leak 42501);
--      the trade under the lock; who-votes refusals by name; replay by
--      action_id through `trade_actions` (verb `trade_vote`, scoped to the
--      team, trade and vote — R732); the league must review trades by vote,
--      the trade must be `in_review`, and the vote must come BEFORE
--      `review_deadline` (the tick approves AT the deadline, inclusive —
--      151). Upsert; a vote may change until then. When the counted veto
--      votes reach the number the trade is VETOED in the same transaction
--      (F435): status `vetoed`, the reason gives the count and the number,
--      `resolved_by` NULL (naming the deciding voter would say who voted),
--      the §10.3 system post, both managers told (`league_trade_vetoed`).
--   5. `trade_vote_tally(trade)` — the league's read (DEFINER, members
--      only): veto votes counted, managers who can vote, the league's
--      setting, the number (after the cap), whether voting is open and
--      until when, and the CALLER's own vote. Never a voter id.
--   6. D137 — `trade_tick` (151:1587-1732): step (2b), before step (3)
--      could run a league-vote trade, vetoes every `in_review` trade whose
--      counted votes already reach the number — the cap can fall with no
--      vote cast (a seat empties), and "otherwise it goes through" must not
--      run a trade whose votes reach the league's number (F430 / F435). The
--      tick result gains a `vetoed` count.
--
-- D137 REPLACEMENT — against 151's FILE TEXT (151 is the newest definer:
-- `grep -n "FUNCTION trade_tick" supabase/migrations/*.sql | tail -1`),
-- derived by an exact-match script (every substitution asserted to hit
-- exactly once; the before/after diff is in the PR):
--   trade_tick   151:1587-1732   md5 f11fb508   3 substitutions (DECLARE
--                                              v_vetoed; step (2b) inserted
--                                              before step (3); the result's
--                                              `vetoed` key)
-- Nothing else is replaced: 148's doors, 151's executor (153's newest body),
-- close / lock / deadline internals and the E37 / E47 triggers are NOT
-- touched. `trade_actions_verb_check` gains `trade_vote` (the ledger is
-- shared, one namespace per league — R732).
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   One new table (`trade_votes`, RLS on + its one policy in this file,
--   indexes for its FKs and the policy column; TRUNCATE revoked). 045's
--   census 85 → 86. New functions: trade_vote_tally_internal,
--   trade_vote_veto_internal, trade_vote_internal, trade_vote_view_internal
--   (PLAIN, triple-REVOKEd), trade_vote and trade_vote_tally (DEFINER
--   doors, REVOKEd from PUBLIC + anon; the in-body gate authorizes). One
--   replaced (trade_tick, REVOKE restated). One CHECK widened.
--   Grants (D18 → D23 → 133) as 148. Realtime: the veto is a `trades`
--   status change and already broadcasts (148); a vote itself is NOT
--   broadcast (D38 waiver — no live subscriber until L.D3.7; PROGRESS F-row).
--   WAIVERS: R6 — no staging clone; the fresh local `db reset` 001–155 and
--   the full pgTAP run are the rehearsal. Backfill: none (no vote exists).
--   Typegen: additive (the table, the functions); the alias block
--   re-appended.
--
-- DEPLOY ORDER: no app code calls anything new here (the trade API is
-- L.D3.6), so the app deploys safely ahead of `db push`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. trade_votes — one vote per (trade, voting team)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trade_votes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id   UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,   -- the voting team (never a party — checked in-body)
  voter_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, -- the manager who cast (or last changed) it
  vote       TEXT NOT NULL
             CONSTRAINT trade_votes_vote_check CHECK (vote IN ('veto', 'approve')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT trade_votes_one_per_team UNIQUE (trade_id, team_id),
  CONSTRAINT trade_votes_updated_after CHECK (updated_at >= created_at)
);
CREATE INDEX IF NOT EXISTS idx_trade_votes_team  ON trade_votes(team_id);
CREATE INDEX IF NOT EXISTS idx_trade_votes_voter ON trade_votes(voter_id);   -- the policy column

COMMENT ON TABLE trade_votes IS
  'League-vote trade review (§13.3, Q77; migration 155): one veto / approve vote per (trade, voting team), cast by the team''s manager, changeable until the review period ends. The ONLY policy is SELECT of your own vote — the league sees the count (trade_vote_tally), never who voted. No write policy for any role: written only by trade_vote.';

ALTER TABLE trade_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own trade votes viewable by the voter" ON trade_votes FOR SELECT TO authenticated
  USING (voter_id = (SELECT auth.uid()));
-- No INSERT / UPDATE / DELETE policy for ANY role. pgTAP 103 §H walks anon,
-- a non-member, a party, a voter, a non-voting member and the commissioner
-- with RETURNING counts.
REVOKE TRUNCATE ON TABLE trade_votes FROM PUBLIC, anon, authenticated;

-- The shared replay ledger learns the new verb (one namespace per league).
ALTER TABLE trade_actions DROP CONSTRAINT IF EXISTS trade_actions_verb_check;
ALTER TABLE trade_actions ADD CONSTRAINT trade_actions_verb_check
  CHECK (verb IN ('trade_propose', 'trade_respond', 'trade_vote'));

-- ---------------------------------------------------------------------------
-- 2. trade_vote_tally_internal — the count and the number (Q77 / F430).
--    PLAIN, STABLE. Eligible = the seated manager of a non-party, non-retired
--    team of the league; a vote counts only while its voter still manages
--    the team it was cast for. number = LEAST(setting, eligible) (F430);
--    reached = at least one counted veto AND counted vetoes ≥ number.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_vote_tally_internal(p_trade public.trades, p_league public.leagues)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_eligible INTEGER;
  v_vetoes   INTEGER;
  v_approves INTEGER;
  v_setting  INTEGER;
  v_number   INTEGER;
BEGIN
  SELECT count(*)::int,
         count(*) FILTER (WHERE v.vote = 'veto')::int,
         count(*) FILTER (WHERE v.vote = 'approve')::int
  INTO v_eligible, v_vetoes, v_approves
  FROM public.league_members m
  JOIN public.teams tm ON tm.id = m.team_id
  LEFT JOIN public.trade_votes v ON v.trade_id = p_trade.id AND v.team_id = m.team_id AND v.voter_id = m.user_id
  WHERE m.league_id = p_league.id
    AND m.user_id IS NOT NULL
    AND m.team_id IS NOT NULL
    AND m.team_id NOT IN (p_trade.proposer_team_id, p_trade.recipient_team_id)
    AND tm.status <> 'retired';

  -- §7.3.5: default ⌈team_count / 2⌉ when the league never set it.
  v_setting := CASE WHEN jsonb_typeof(p_league.settings -> 'trade_veto_votes') = 'number'
                    THEN (p_league.settings ->> 'trade_veto_votes')::numeric::int
                    ELSE ceil(p_league.team_count / 2.0)::int END;
  v_number := LEAST(v_setting, v_eligible);   -- F430: capped at the managers who can vote

  RETURN jsonb_build_object(
    'veto_votes',      v_vetoes,
    'approve_votes',   v_approves,
    'eligible_voters', v_eligible,
    'setting',         v_setting,
    'veto_number',     v_number,
    'capped',          v_number < v_setting,
    'reached',         v_vetoes >= 1 AND v_vetoes >= v_number);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_vote_tally_internal(public.trades, public.leagues) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. trade_vote_veto_internal — if the counted vetoes reach the number,
--    close the in-review trade as VETOED (F435) and say so; otherwise NULL.
--    The caller holds the league lock. Called by trade_vote (at the vote)
--    and by trade_tick (2b) (when the number fell with no vote cast).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_vote_veto_internal(p_trade_id UUID, p_league public.leagues, p_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_trade    public.trades;
  v_tally    JSONB;
  v_reason   TEXT;
  v_summary  TEXT;
  v_post     TEXT;
  v_team     UUID;
  v_n        UUID;
  v_notified JSONB := '[]'::jsonb;
BEGIN
  IF p_trade_id IS NULL OR p_at IS NULL THEN
    RAISE EXCEPTION 'trade_vote_veto: the trade and the instant (p_at — the TimeProvider seam) are required'
      USING ERRCODE = '22023';
  END IF;
  SELECT t.* INTO v_trade FROM public.trades t WHERE t.id = p_trade_id AND t.league_id = p_league.id FOR UPDATE;
  IF NOT FOUND OR v_trade.status <> 'in_review' OR COALESCE(p_league.trade_review, 'commissioner') <> 'league_vote' THEN
    RETURN NULL;
  END IF;
  v_tally := public.trade_vote_tally_internal(v_trade, p_league);
  IF NOT (v_tally ->> 'reached')::boolean THEN
    RETURN NULL;
  END IF;

  v_reason := 'vetoed by league vote — ' || (v_tally ->> 'veto_votes') || ' of the '
    || (v_tally ->> 'eligible_voters') || ' managers who can vote voted to veto, and the league''s number is '
    || (v_tally ->> 'veto_number')
    || CASE WHEN (v_tally ->> 'capped')::boolean
            THEN ' (its setting of ' || (v_tally ->> 'setting') || ' is more than the managers who can vote)'
            ELSE '' END
    || ' (§13.3 / Q77)';
  UPDATE public.trades t
  SET status = 'vetoed', status_reason = v_reason, resolved_at = p_at, resolved_by = NULL
  WHERE t.id = p_trade_id AND t.status = 'in_review';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trade_vote_veto: trade % left review under the league lock — refusing to veto it twice', p_trade_id
      USING ERRCODE = 'P0001';
  END IF;

  v_summary := COALESCE(public.trade_summary_internal(p_trade_id), 'a trade');
  v_post := 'Trade vetoed by league vote: ' || v_summary;
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (p_league.id, NULL, v_post, 'league', TRUE);
  FOREACH v_team IN ARRAY ARRAY[v_trade.proposer_team_id, v_trade.recipient_team_id] LOOP
    v_n := public.trade_notify_team_internal(
      p_league.id, v_team, 'league_trade_vetoed', 'Your trade was vetoed by league vote',
      v_summary || ' — ' || v_reason,
      jsonb_build_object('trade_id', p_trade_id, 'status', 'vetoed'), FALSE);
    IF v_n IS NOT NULL THEN
      v_notified := v_notified || jsonb_build_array(v_n);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'trade_id',          p_trade_id,
    'status',            'vetoed',
    'status_reason',     v_reason,
    'tally',             v_tally,
    'system_post',       v_post,
    'notified_user_ids', v_notified,
    'evaluated_at',      p_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_vote_veto_internal(UUID, public.leagues, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. trade_vote_internal + trade_vote — cast or change a vote (Q77).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_vote_internal(
  p_league_id UUID,
  p_trade_id  UUID,
  p_vote      TEXT,
  p_action_id UUID,
  p_at        TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_verb      CONSTANT TEXT := 'trade_vote';
  v_league    public.leagues;
  v_found     BOOLEAN;
  v_member    public.league_members;
  v_is_member BOOLEAN := FALSE;
  v_trade     public.trades;
  v_team      public.teams;
  v_ledger    public.trade_actions;
  v_zone      TEXT;
  v_prev      TEXT;
  v_veto      JSONB;
  v_tally     JSONB;
  v_result    JSONB;
BEGIN
  -- (0) SHAPE.
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'trade_vote: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_trade_id IS NULL THEN
    RAISE EXCEPTION 'trade_vote: p_trade_id is required — name the trade you are voting on'
      USING ERRCODE = '22023';
  END IF;
  IF p_vote IS NULL OR p_vote NOT IN ('veto', 'approve') THEN
    RAISE EXCEPTION 'trade_vote: vote % is not veto / approve — a manager votes to veto a trade or to let it through (§13.3 / Q77)', COALESCE(p_vote, 'NULL')
      USING ERRCODE = '22023';
  END IF;
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'trade_vote: p_at is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the one serialization point every trade
  --     verb and the tick take — a vote and the tick's approval cannot
  --     interleave).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — league members only; anyone else learns nothing (42501).
  IF v_found AND auth.uid() IS NOT NULL THEN
    SELECT m.* INTO v_member
    FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid();
    v_is_member := FOUND;
  END IF;
  IF NOT v_is_member THEN
    RAISE EXCEPTION 'trade_vote: not a member of this league'
      USING ERRCODE = '42501';
  END IF;

  -- (3) THE TRADE, under the league lock.
  SELECT t.* INTO v_trade FROM public.trades t
  WHERE t.id = p_trade_id AND t.league_id = p_league_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trade_vote: no trade % in league %', p_trade_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- (4) A VOTE IS A TEAM MANAGER'S (Q77).
  IF v_member.team_id IS NULL THEN
    RAISE EXCEPTION '%',
      'trade_vote: only a team''s manager votes on a trade, and you do not manage a team in this league (§13.3 / Q77)'
      || CASE WHEN public.is_league_commish(p_league_id)
              THEN ' — the commissioner''s own approve / veto is a separate commissioner tool, not a vote' ELSE '' END
      USING ERRCODE = 'P0001';
  END IF;

  -- (5) REPLAY — verb, team, trade and vote scoped (R732). Before the state
  --     checks: a retry after the vote that vetoed the trade replays its
  --     answer instead of reporting "not under review".
  SELECT a.* INTO v_ledger
  FROM public.trade_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    IF v_ledger.verb <> v_verb OR v_ledger.team_id IS DISTINCT FROM v_member.team_id
       OR (v_ledger.result ->> 'trade_id') IS DISTINCT FROM p_trade_id::text
       OR (v_ledger.result ->> 'vote') IS DISTINCT FROM p_vote THEN
      RAISE EXCEPTION
        'trade_vote: action_id % already names a % for another request in this league — an action_id identifies ONE submit of ONE verb (R732)',
        p_action_id, v_ledger.verb
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_ledger.result;
  END IF;

  -- (6) WHO MAY VOTE ON THIS TRADE (Q77): not the two teams in it.
  IF v_member.team_id IN (v_trade.proposer_team_id, v_trade.recipient_team_id) THEN
    RAISE EXCEPTION 'trade_vote: your team is in this trade — the two teams in a trade do not vote on it; every other manager may (§13.3 / Q77)'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT tm.* INTO v_team FROM public.teams tm WHERE tm.id = v_member.team_id;
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'trade_vote: % is retired — a sealed franchise does not vote (§7.2.1)', v_team.name
      USING ERRCODE = 'P0001';
  END IF;

  -- (7) STATE: the league reviews trades by vote, the trade is in review,
  --     and its review period has not ended (the tick approves AT the
  --     deadline — 151 — so a vote at or after it is too late).
  IF COALESCE(v_league.trade_review, 'commissioner') <> 'league_vote' THEN
    RAISE EXCEPTION 'trade_vote: this league''s trades are %, not by a league vote (trade_review %, §7.3.5)',
      CASE COALESCE(v_league.trade_review, 'commissioner')
        WHEN 'commissioner' THEN 'reviewed by the commissioner'
        WHEN 'none' THEN 'not reviewed (they go through when accepted)'
        ELSE 'reviewed another way' END,
      COALESCE(v_league.trade_review, 'commissioner')
      USING ERRCODE = 'P0001';
  END IF;
  IF v_trade.status <> 'in_review' THEN
    RAISE EXCEPTION 'trade_vote: this trade is not up for a vote — %',
      CASE v_trade.status
        WHEN 'proposed'  THEN 'it has not been accepted yet; voting opens when it is'
        WHEN 'accepted'  THEN 'its review period is over and it is waiting to go through'
        WHEN 'complete'  THEN 'it already went through'
        WHEN 'vetoed'    THEN 'it was already vetoed'
        WHEN 'rejected'  THEN 'it was rejected'
        WHEN 'cancelled' THEN 'it was cancelled'
        WHEN 'invalid'   THEN 'it can no longer go through (' || COALESCE(v_trade.status_reason, 'no reason recorded') || ')'
        WHEN 'expired'   THEN 'it expired at the trade deadline'
        ELSE 'it is ' || v_trade.status END || ' (§13.3)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_trade.review_deadline IS NULL OR p_at >= v_trade.review_deadline THEN
    v_zone := COALESCE(NULLIF(v_league.settings ->> 'waiver_time_zone', ''), 'America/New_York');
    RAISE EXCEPTION 'trade_vote: voting on this trade closed at % — the review period is over (§13.3 / Q77)',
      COALESCE(to_char(v_trade.review_deadline AT TIME ZONE v_zone, 'Dy YYYY-MM-DD HH24:MI') || ' ' || v_zone, 'an unrecorded instant')
      USING ERRCODE = 'P0001';
  END IF;

  -- (8) CAST OR CHANGE THE VOTE (one per team; the manager who cast it).
  SELECT v.vote INTO v_prev FROM public.trade_votes v
  WHERE v.trade_id = p_trade_id AND v.team_id = v_member.team_id AND v.voter_id = auth.uid();
  INSERT INTO public.trade_votes (trade_id, team_id, voter_id, vote, created_at, updated_at)
  VALUES (p_trade_id, v_member.team_id, auth.uid(), p_vote, p_at, p_at)
  ON CONFLICT (trade_id, team_id) DO UPDATE
    SET vote = EXCLUDED.vote, voter_id = EXCLUDED.voter_id, updated_at = EXCLUDED.updated_at,
        created_at = CASE WHEN public.trade_votes.voter_id = EXCLUDED.voter_id
                          THEN public.trade_votes.created_at ELSE EXCLUDED.created_at END;

  -- (9) THE VOTE THAT REACHES THE NUMBER VETOES THE TRADE, here (F435).
  v_veto := public.trade_vote_veto_internal(p_trade_id, v_league, p_at);
  SELECT t.* INTO v_trade FROM public.trades t WHERE t.id = p_trade_id;
  v_tally := COALESCE(v_veto -> 'tally', public.trade_vote_tally_internal(v_trade, v_league));

  v_result := jsonb_build_object(
    'trade_id',      p_trade_id,
    'op',            'vote',
    'vote',          p_vote,
    'previous_vote', v_prev,
    'team_id',       v_member.team_id,
    'outcome',       CASE WHEN v_veto IS NOT NULL THEN 'vetoed' ELSE 'recorded' END,
    'tally',         jsonb_build_object(
                       'veto_votes',      (v_tally -> 'veto_votes'),
                       'eligible_voters', (v_tally -> 'eligible_voters'),
                       'setting',         (v_tally -> 'setting'),
                       'veto_number',     (v_tally -> 'veto_number'),
                       'capped',          (v_tally -> 'capped')),
    'trade',         public.trade_view_internal(p_trade_id),
    'veto',          v_veto,
    'evaluated_at',  p_at);

  INSERT INTO public.trade_actions (league_id, team_id, verb, action_id, actor_id, result, created_at)
  VALUES (p_league_id, v_member.team_id, v_verb, p_action_id, auth.uid(), v_result, p_at);
  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_vote_internal(UUID, UUID, TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION trade_vote(
  p_league_id UUID,
  p_trade_id  UUID,
  p_vote      TEXT,
  p_action_id UUID DEFAULT NULL   -- REQUIRED in-body (22023)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.trade_vote_internal(p_league_id, p_trade_id, p_vote, p_action_id, now());
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_vote(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon;
COMMENT ON FUNCTION trade_vote(UUID, UUID, TEXT, UUID) IS
  '§13.3 league-vote review (migration 155, L.D3.4; Q77, F430, F435): the seated manager of any team EXCEPT the two in the trade votes veto / approve while the trade is in review and before its review period ends, and may change his vote until then. The vote that brings the counted veto votes to the league''s number (trade_veto_votes, capped at the managers who can vote) vetoes the trade at once. Refuses by name: a party, a member with no team, a retired team, a league that does not review by vote, a trade not in review, a vote at or after the deadline. Non-members 42501. Replay by action_id is byte-identical.';

-- ---------------------------------------------------------------------------
-- 5. trade_vote_view_internal + trade_vote_tally — the league's read: the
--    COUNT, never who voted (Q77); plus the caller's own vote.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_vote_view_internal(p_trade_id UUID, p_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_trade  public.trades;
  v_league public.leagues;
  v_member public.league_members;
  v_tally  JSONB;
  v_mine   TEXT;
  v_open   BOOLEAN;
  v_can    TEXT;
BEGIN
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'trade_vote_tally: p_at is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;
  SELECT t.* INTO v_trade FROM public.trades t WHERE t.id = p_trade_id;
  IF FOUND THEN
    SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_trade.league_id AND l.deleted_at IS NULL;
  END IF;
  IF v_league.id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'trade_vote_tally: not a member of this league' USING ERRCODE = '42501';
  END IF;
  SELECT m.* INTO v_member FROM public.league_members m
  WHERE m.league_id = v_league.id AND m.user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trade_vote_tally: not a member of this league' USING ERRCODE = '42501';
  END IF;

  v_tally := public.trade_vote_tally_internal(v_trade, v_league);
  SELECT v.vote INTO v_mine FROM public.trade_votes v
  WHERE v.trade_id = p_trade_id AND v.team_id = v_member.team_id AND v.voter_id = auth.uid();
  v_open := COALESCE(v_league.trade_review, 'commissioner') = 'league_vote'
            AND v_trade.status = 'in_review'
            AND v_trade.review_deadline IS NOT NULL AND p_at < v_trade.review_deadline;
  v_can := CASE
    WHEN NOT v_open THEN 'voting_closed'
    WHEN v_member.team_id IS NULL THEN 'no_team'
    WHEN v_member.team_id IN (v_trade.proposer_team_id, v_trade.recipient_team_id) THEN 'party'
    WHEN EXISTS (SELECT 1 FROM public.teams tm WHERE tm.id = v_member.team_id AND tm.status = 'retired') THEN 'retired'
    ELSE NULL END;

  RETURN jsonb_build_object(
    'trade_id',        p_trade_id,
    'review',          COALESCE(v_league.trade_review, 'commissioner'),
    'status',          v_trade.status,
    'veto_votes',      (v_tally -> 'veto_votes'),
    'eligible_voters', (v_tally -> 'eligible_voters'),
    'setting',         (v_tally -> 'setting'),
    'veto_number',     (v_tally -> 'veto_number'),
    'capped',          (v_tally -> 'capped'),
    'voting_open',     v_open,
    'closes_at',       v_trade.review_deadline,
    'my_vote',         v_mine,
    'can_vote',        v_can IS NULL,
    'cannot_vote_because', v_can,
    'evaluated_at',    p_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_vote_view_internal(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION trade_vote_tally(p_trade_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.trade_vote_view_internal(p_trade_id, now());
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_vote_tally(UUID) FROM PUBLIC, anon;
COMMENT ON FUNCTION trade_vote_tally(UUID) IS
  '§13.3 league-vote review (migration 155, L.D3.4; Q77): for a league member, the trade''s veto votes counted, the managers who can vote, the league''s setting and its number after the F430 cap, whether voting is open and until when, and the caller''s OWN vote. Never who else voted. Non-members 42501.';

-- ---------------------------------------------------------------------------
-- 6. D137 — trade_tick (151:1587-1732, md5 f11fb508): step (2b) — a
--    league-vote trade whose counted vetoes reach the number is vetoed
--    before step (3) can run it (F430 / F435); the result's `vetoed` count.
--    Three substitutions; everything else byte-identical to 151.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trade_tick(p_now TIMESTAMPTZ DEFAULT now(), p_league_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_candidates INTEGER;
  v_lg         RECORD;
  v_league     public.leagues;
  v_deadline   JSONB;
  v_t          RECORD;
  v_reason     TEXT;
  v_res        JSONB;
  v_leagues    INTEGER := 0;
  v_expired    INTEGER := 0;
  v_swept      INTEGER := 0;
  v_executed   INTEGER := 0;
  v_deferred   INTEGER := 0;
  v_failed     INTEGER := 0;
  v_vetoed     INTEGER := 0;   -- 155 (L.D3.4): league-vote vetoes found by step (2b)
  v_actions    JSONB := '[]'::jsonb;
  v_failures   JSONB := '[]'::jsonb;
BEGIN
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'trade_tick: p_now is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT t.league_id)::int INTO v_candidates
  FROM public.trades t
  WHERE t.status IN ('proposed', 'accepted', 'in_review')
    AND (p_league_id IS NULL OR t.league_id = p_league_id);

  FOR v_lg IN
    SELECT l.id FROM public.leagues l
    WHERE (p_league_id IS NULL OR l.id = p_league_id)
      AND EXISTS (SELECT 1 FROM public.trades t
                  WHERE t.league_id = l.id AND t.status IN ('proposed', 'accepted', 'in_review'))
    ORDER BY l.id
    FOR UPDATE OF l SKIP LOCKED
  LOOP
    v_leagues := v_leagues + 1;
    BEGIN
      SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_lg.id;

      -- (1) Q76: every offer still pending at the deadline expires.
      v_deadline := public.trade_deadline_internal(v_league);
      IF (v_deadline ->> 'deadline_at')::timestamptz <= p_now THEN
        FOR v_t IN
          SELECT t.id FROM public.trades t
          WHERE t.league_id = v_league.id AND t.status = 'proposed'
          ORDER BY t.created_at, t.id
        LOOP
          v_res := public.trade_close_internal(
            v_t.id, 'expired',
            'the trade deadline passed — offers could be accepted until week ' || ((v_deadline ->> 'deadline_week')::int + 1)
              || ' began (' || (v_deadline ->> 'label') || '; trade_deadline_week ' || (v_deadline ->> 'deadline_week') || ', §13.3 / Q76)',
            p_now, 'league_trade_expired', 'A trade offer expired at the deadline');
          v_expired := v_expired + 1;
          v_actions := v_actions || jsonb_build_array(jsonb_build_object('league_id', v_league.id, 'trade_id', v_t.id, 'action', 'expired'));
        END LOOP;
      END IF;

      -- (2) THE BACKSTOP SWEEP (TD12): what the triggers cannot see.
      FOR v_t IN
        SELECT t.* FROM public.trades t
        WHERE t.league_id = v_league.id AND t.status IN ('proposed', 'accepted', 'in_review')
        ORDER BY t.created_at, t.id
      LOOP
        v_reason := NULL;
        IF v_league.deleted_at IS NOT NULL OR v_league.status NOT IN ('in_season', 'playoffs') THEN
          v_reason := 'the league is ' || CASE WHEN v_league.deleted_at IS NOT NULL THEN 'deleted' ELSE v_league.status END
                      || ' — a trade goes through only while the league is in season or in the playoffs (§7.1 / §13.3)';
        ELSE
          SELECT tm.name || ' is retired — a sealed franchise makes no trades (§7.2.1)' INTO v_reason
          FROM public.teams tm
          WHERE tm.id IN (v_t.proposer_team_id, v_t.recipient_team_id) AND tm.status = 'retired'
          ORDER BY tm.name LIMIT 1;
          IF v_reason IS NULL THEN
            SELECT tm.name || ' can no longer give $' || i.faab_amount || ' of FAAB — its balance is '
                   || COALESCE('$' || m.faab_balance, 'not recorded') || ' (§13.3)'
            INTO v_reason
            FROM public.trade_items i
            JOIN public.teams tm ON tm.id = i.from_team_id
            LEFT JOIN public.league_members m ON m.league_id = v_league.id AND m.team_id = i.from_team_id
            WHERE i.trade_id = v_t.id AND i.faab_amount IS NOT NULL
              AND (m.faab_balance IS NULL OR m.faab_balance < i.faab_amount)
            ORDER BY tm.name LIMIT 1;
          END IF;
        END IF;
        IF v_reason IS NOT NULL THEN
          v_res := public.trade_close_internal(v_t.id, 'invalid', 'the trade can no longer go through: ' || v_reason, p_now,
                                               'league_trade_invalid', 'A trade can no longer go through');
          v_swept := v_swept + 1;
          v_actions := v_actions || jsonb_build_array(jsonb_build_object('league_id', v_league.id, 'trade_id', v_t.id, 'action', 'invalid', 'reason', v_reason));
        END IF;
      END LOOP;

      -- (2b) 155 (L.D3.4, F430 / F435): a LEAGUE-VOTE trade in review whose
      --      counted veto votes already reach the league's number is
      --      vetoed here, before (3) could run it. A vote that reaches the
      --      number vetoes at the vote (trade_vote); this catches the number
      --      falling with no vote cast — it is capped at the managers who
      --      can vote, and that falls when a seat empties.
      IF COALESCE(v_league.trade_review, 'commissioner') = 'league_vote' THEN
        FOR v_t IN
          SELECT t.id FROM public.trades t
          WHERE t.league_id = v_league.id AND t.status = 'in_review'
          ORDER BY t.created_at, t.id
        LOOP
          v_res := public.trade_vote_veto_internal(v_t.id, v_league, p_now);
          IF v_res IS NOT NULL THEN
            v_vetoed := v_vetoed + 1;
            v_actions := v_actions || jsonb_build_array(jsonb_build_object('league_id', v_league.id, 'trade_id', v_t.id, 'action', 'vetoed', 'reason', v_res ->> 'status_reason'));
          END IF;
        END LOOP;
      END IF;

      -- (3) + (4) DUE EXECUTIONS: review period over; a deferred trade
      --     whose release has come (or is not yet recorded — re-read each
      --     minute; the executor re-parks it if still locked).
      FOR v_t IN
        SELECT t.id,
               CASE WHEN t.status = 'in_review' THEN 'review_elapsed' ELSE 'deferred_release' END AS via
        FROM public.trades t
        WHERE t.league_id = v_league.id
          AND ((t.status = 'in_review' AND t.review_deadline <= p_now)
            OR (t.status = 'accepted' AND (t.execute_after IS NULL OR t.execute_after <= p_now OR t.execute_after = 'infinity')))
        ORDER BY COALESCE(t.accepted_at, t.created_at), t.id
      LOOP
        v_res := public.trade_execute_internal(v_t.id, p_now, v_t.via);
        CASE v_res ->> 'outcome'
          WHEN 'complete' THEN v_executed := v_executed + 1;
          WHEN 'deferred' THEN v_deferred := v_deferred + 1;
          WHEN 'invalid'  THEN v_failed := v_failed + 1;
          ELSE NULL;
        END CASE;
        v_actions := v_actions || jsonb_build_array(jsonb_build_object(
          'league_id', v_league.id, 'trade_id', v_t.id, 'action', v_res ->> 'outcome', 'via', v_t.via,
          'execute_after', v_res -> 'execute_after', 'reason', v_res -> 'status_reason'));
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      v_failures := v_failures || jsonb_build_array(jsonb_build_object(
        'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM));
      RAISE WARNING 'trade_tick failed for league %: % (%)', v_lg.id, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'at',          p_now,
    'scope',       p_league_id,
    'candidates',  v_candidates,
    'leagues',     v_leagues,
    'skipped_locked', GREATEST(v_candidates - v_leagues, 0),
    'expired',     v_expired,
    'invalidated', v_swept,
    'executed',    v_executed,
    'deferred',    v_deferred,
    'failed_at_execution', v_failed,
    'vetoed',      v_vetoed,
    'actions',     v_actions,
    'failures',    v_failures,
    'reason', CASE
      WHEN v_candidates = 0 THEN 'no_trades_in_flight'
      WHEN v_leagues = 0 THEN 'every_league_busy'
      WHEN jsonb_array_length(v_actions) = 0 AND jsonb_array_length(v_failures) = 0 THEN 'nothing_due'
      ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_tick(TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION trade_tick(TIMESTAMPTZ, UUID) IS
  '§13.3 / §14 trade-review-expiry (migration 151, L.D3.3; 155, L.D3.4): every minute on pg_cron. Per league with a trade in flight (claimed FOR UPDATE SKIP LOCKED): expire offers at the deadline (Q76), invalidate trades a retired party / an unaffordable FAAB leg / an out-of-season league can no longer complete (TD12), veto league-vote trades whose counted veto votes reach the league''s number (Q77 / F430), run in_review trades whose review period ended (auto-approve) and deferred trades whose game-lock wait is over (Q75 / E35). Reports what it did and, when nothing, why.';
