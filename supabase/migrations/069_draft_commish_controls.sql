-- ============================================================================
-- Commissioner live draft controls + in-txn system chat posts — migration
-- 069 (task L.B1.4; spec §8.7 (the FULL control table + v2.0 pause
-- bookkeeping + the robustness bullets), §8.8 (system posts), §8.1 five-step
-- contract, §12.4 (soft undo), §17 (commish/co-commish row), E4/E15/E31 +
-- E29's snake half; tasks-M2 §3 D97/D101/D102 + §4.6 lock discipline, §5
-- sketch — names contractual). The §8.7 snake-draft control surface, each
-- RPC writing a mandatory in-transaction `league_chat` system post (D97 —
-- the interim transparency until M6's `commissioner_actions`, F40); the
-- auction rows ("Adjust auction budget / undo a won bid") are M3's. Two
-- §8.7 snake rows deliberately live ELSEWHERE (R140): "Toggle autopick for
-- any team" is L.B1.7's autodraft-toggle RPC (migration 072 — the F33
-- route), and "Reassign a draft seat" is already satisfied by 063's
-- `assign_manager`/`remove_manager` seat mechanics + E48's vacated-seat
-- autopilot (M1 — swapping which user controls a team never was a
-- draft-room RPC).
--
-- Contents:
--   1. `league_chat.user_id` DROP NOT NULL: genuine system posts written by
--      the TICK (the §8.7 commissioner-outage auto-pause, item 11) have no
--      acting user (cron has no JWT) — user_id NULL = "the system".
--      Commissioner-action posts carry the ACTING commissioner's user_id +
--      is_system = TRUE (auditable actor; the message also names them). No
--      client can forge either shape: the 065 INSERT policy pins
--      user_id = auth.uid() (NULL never passes) AND is_system = FALSE.
--      Prod-safe (constraint drop on a live table; §12.13 is silent on the
--      nullability — recorded in D108).
--   2. `draft_pause_internal(p_draft_id, p_actor, p_message)` — the ONE
--      pause-bookkeeping implementation (the 066/068 wrapper/internal
--      precedent; reuse-never-fork): persists `deadline_remaining_ms` =
--      round(ms until current_deadline) computed against the txn's now(),
--      NULLs current_deadline (a paused draft shows remaining from the
--      persisted column, §16.5.2; the tick claims status='live' only, so a
--      paused draft is never claimed), status='paused', paused_at=now(),
--      and writes the system post. Consumers: `draft_pause` (the RPC) and
--      the tick's commissioner-outage arm (068, amended alongside this
--      migration). CALLER CONTRACT: drafts row locked, status='live'.
--      REMAINING MAY BE NEGATIVE (recorded semantics, D108): pausing during
--      a D102 grace hold captures deadline − now() < 0, and resume restores
--      a deadline that many ms in the past — the elapsed hold survives the
--      pause ("clocks never gain or lose time across pauses", §8.7 v2.0,
--      applied to the grace clock too). The R132 as-of-deadline freshness
--      window shifts with the restored deadline; both directions come out
--      right: a seat that heartbeat during the pause is CONNECTED and
--      classifies fresh against the restored deadline (§8.5.4 autopick — a
--      present manager past deadline autopicks); a seat silent through the
--      pause stays stale and serves the REMAINDER of its hold.
--   3. `draft_pause(p_draft_id, p_reason)` / `draft_resume(p_draft_id,
--      p_reason)` — §8.7 row 1 (v2.0 bookkeeping). Resume:
--      current_deadline = now() + deadline_remaining_ms × 1ms (exact
--      integer-millisecond interval math — no float seconds), remaining and
--      paused_at cleared, status='live'. Untimed drafts (§8.2 soft timer)
--      pause/resume with NULL remaining ⇒ NULL deadline restored. A
--      double-pause / double-resume is a D63-class idempotent no-op
--      (`{paused|resumed: false}`, NO second chat post). Pause of a
--      scheduled/complete draft → friendly P0001; resume of same → P0001.
--   4. `draft_set_clock(p_draft_id, p_pick_timer_seconds, p_extend_current,
--      p_reason)` — §8.7 row 2 / E15, exact semantics (D108):
--        * writes `config.pick_timer_seconds` on the DRAFTS row — the
--          room's post-start authority (D95: league settings are the
--          PRE-start store; the draft's config snapshot governs the live
--          room; league settings untouched). Subsequent deadlines pick it
--          up mechanically (draft_apply_pick_internal reads the config).
--        * p_extend_current = TRUE (live only, timer > 0):
--          current_deadline := GREATEST(current_deadline, now() + timer) —
--          extend-only, NEVER shortens (E15: "may extend the current
--          deadline"; a shorter timer with extend leaves the deadline
--          alone). timer = 0 + extend ⇒ current_deadline := NULL (§8.2
--          untimed semantics applied to the current pick — removing the
--          clock is not shortening it). UNTIMED CURRENT + extend (R138,
--          M2 batch 5 — decided KEEP + pin, recorded D108(3)): when the
--          current pick has NO deadline, GREATEST(NULL, now()+timer)
--          IMPOSES now()+timer — nominally the one finite-ward move under
--          extend-only, but it is the commissioner's EXPLICIT request
--          (extend_current=TRUE with a positive timer on an untimed pick
--          has exactly one meaning: put this pick on the clock), it is the
--          §8.2-symmetric inverse of the timer-0 arm, it grants the pick a
--          FULL fresh timer (no mid-countdown clock is cut — the harm E15
--          guards), and refusing would leave a stalled untimed room no
--          recourse short of force-pick. The system post says "The current
--          pick is now on the clock." for this arm (vs "was extended.") —
--          both messages pgTAP-pinned.
--        * on a PAUSED draft the new timer applies to subsequent picks;
--          the PERSISTED remaining is untouched (clocks never gain/lose
--          across pauses) and p_extend_current → friendly P0001 directing
--          resume-then-extend (extending a frozen clock would silently
--          rewrite the pause bookkeeping).
--        * 22023 on NULL/negative; catalog membership (PICK_TIMER_SECONDS)
--          is the route's Zod (L.B2.3 — the F32 layering).
--   5. `draft_undo(p_draft_id, p_to_pick_number DEFAULT NULL, p_reason)` —
--      §8.7 rows 3–4 (single + cascade, E4/E29-snake). p_to NULL ⇒ single:
--      the highest LIVE pick reverts. p_to = N ⇒ cascade: every live pick
--      with pick_number > N reverts (E4's "undo pick #40" ≡ p_to = 39;
--      the task's golden "undo to pick 3 of 8 → picks 4–8 undone"). Soft
--      undo per §12.4: is_undone = TRUE, rows kept for audit; pool return
--      is the partial index (uniq_draft_player_live WHERE is_undone=FALSE
--      frees the players mechanically). Clock rewind: current_pick_number =
--      first reverted number, round recomputed, on_clock via
--      draft_team_for_pick (the ONE order-math implementation), a FRESH
--      full clock for the rewound team (live: now() + timer; paused:
--      deadline_remaining_ms := timer × 1000 with the deadline staying
--      NULL — resume starts the fresh clock). live/paused only; a COMPLETE
--      draft refuses naming M6 (the F44 post-completion boundary — undo
--      would be the same backward move as post-completion reset).
--      THE R125 DECISION (routed here by M2 batch 2; pinned in pgTAP 023,
--      recorded in 066's banner at its replay arm): an action_id is
--      CONSUMED FOREVER — draft_make_pick's E2 replay arm deliberately
--      does NOT filter is_undone. A stale client retry of a pick the
--      commissioner later undid returns the historical (undone) row + the
--      current authoritative state as a success-shaped no-op and can NEVER
--      silently re-apply the undone pick — filtering the lookup instead
--      would route the retry into a fresh INSERT against uniq_draft_action
--      (undone rows KEEP their action_id) ⇒ 23505 ⇒ the misleading "just
--      went off the board" message. The manager re-picks with a FRESH
--      action_id (their client mints one per submit — D68(1)).
--   6. `draft_reassign_pick(p_draft_id, p_pick_id, p_team_id DEFAULT NULL,
--      p_player_id DEFAULT NULL, p_reason)` — §8.7 row 5 first half: change
--      what a pick selected and/or which team it belongs to. At least one
--      of team/player required (22023); the pick must be a LIVE (non-
--      undone) pick of THIS draft (P0002 otherwise — no-leak with the
--      42501 gate ahead of it). Exclusivity: the new player must not be
--      held by any live pick of the draft (friendly refusal; the pick's
--      own row counts, so a replay/no-change reassign surfaces as the same
--      refusal — safe by state, never double-applied). Slot validation =
--      CAPACITY (v2.8.11: at pick time "fits roster" means capacity only;
--      need-fit is §8.4 autopick's rule) — the receiving team's live picks
--      must be < total_rounds. Before/after in the system post.
--   7. `draft_move_player(p_draft_id, p_player_id, p_from_team, p_to_team,
--      p_reason)` — §8.7 row 5 second half ("move a drafted player between
--      teams if something breaks"): locates the player's live pick,
--      validates it belongs to p_from_team (friendly refusal), p_to_team
--      is an active franchise of the league, p_to_team ≠ p_from_team (the
--      task's "target already has the player" friendly refusal — also the
--      replay shape), capacity as above; reassigns the pick row's team.
--      Before/after in the system post.
--   8. `draft_force_pick(p_draft_id, p_player_id, p_action_id DEFAULT
--      NULL, p_reason)` — §8.7 row 6 ("Pick for a manager"): the current
--      pick on behalf of the on-clock team. LIVE only (paused → friendly
--      refusal directing resume: apply-pick sets a now()-based deadline
--      that would corrupt the pause bookkeeping). Writes through 066's
--      `draft_apply_pick_internal` — the ONE advance path (reuse, never
--      fork): is_auto = FALSE, made_via = 'commissioner', picked_by = the
--      commissioner, action_id = p_action_id (optional §4.6 idempotency:
--      draft_picks HAS the column, so the force button gets the same E2
--      replay no-op as a manual pick — the same R125 semantics apply).
--      E1 availability under the lock + the unique_violation fallback,
--      exactly like draft_make_pick.
--   9. `draft_set_order(p_draft_id, p_order uuid[], p_reason)` — §8.7 via
--      §8.3 ("edit order … and after, as an override") / E31. The array
--      must be a PERMUTATION of the league's active franchises (length,
--      distinct, membership — typed uuid[] at the boundary, so malformed
--      input fails the cast at the wire, never inside). scheduled: writes
--      draft_order (the lobby order; draft_start honors the draft-row
--      candidate, D101/R123 — L.B2.1's pre-start PATCH remains the
--      ordinary no-ceremony surface). live/paused (E31): COMPLETED picks
--      untouched (stored rows), draft_order := the new array, on_clock
--      re-derived for the CURRENT pick number under the new order;
--      remaining picks re-derive mechanically (advance reads
--      drafts.draft_order). If the on-clock TEAM changes, the clock
--      RESETS to a fresh full timer (live: now() + timer; paused:
--      remaining := timer × 1000) — the incoming team never had the
--      clock; an unchanged team keeps its running clock. RECORDED
--      RESIDUAL (D108): a MID-ROUND order edit can leave per-team totals
--      uneven (a team may finish above/below total_rounds picks) — E31
--      sanctions the edit as printed, §10.4's "full power + audit log"
--      philosophy owns the risk, completion counts the BOARD
--      (total_rounds × team_count live picks, 066), the system post is
--      the room's transparency, and M6's audit row (F40) is the record.
--  10. `draft_reset(p_draft_id, p_reason)` — §8.7 last row. live/paused
--      only: a COMPLETE draft refuses naming M6 (F44 — post-completion
--      reset is an audited backward transition); scheduled refuses ("has
--      not started"). In ONE transaction: every live pick soft-undone
--      (§12.4 audit trail), the drafts row back to 'scheduled' (counters
--      reset; on_clock/current_deadline/paused_at/deadline_remaining_ms/
--      started_at/completed_at NULL; draft_order KEPT — D101: the shown
--      order stays the order across a reset, and manual/custom orders
--      survive), this draft's `draft_liveness` rows DELETED (fresh room
--      state — the outage arm's "supervision established" memory starts
--      clean on a re-run), `leagues.status = 'scheduled'` (sanctioned by
--      §8.7's own row "status → scheduled" + §7.1's re-open arrow; the
--      D43 guard is indifferent — the snapshot survives, and 'scheduled'
--      is below the guard's drafting+ set), AND
--      `settings.draft.draft_scheduled_at` REMOVED from the league
--      settings blob — THE D107(5) AUTO-START↔RESET SEAM CLOSURE (D108):
--      under a PAST instant the D94 tick arm would RE-START the reset
--      draft within 5 seconds; clearing the instant disarms auto-start
--      until the commissioner re-schedules through the ordinary settings
--      picker (which re-arms D94) or clicks Start (the manual path needs
--      no instant — 066's create-if-absent). The post-reset state —
--      league 'scheduled' + draft row 'scheduled' + NO stored instant —
--      is a state only reset produces ("awaiting re-schedule or manual
--      start"); set_league_status's setup→scheduled instant requirement
--      (059) is untouched. The system post says exactly this.
--      LOCK ORDER (the R122 class, banner-stated): draft_reset takes the
--      DRAFTS row FIRST, then the LEAGUES row — the ONLY control needing
--      the leagues FOR UPDATE, and taking leagues first would recreate
--      the R122 cycle (an in-flight pick holds drafts and wants the
--      leagues KEY SHARE via the league_id FK). The inversion cannot
--      deadlock against 066's leagues → drafts direction: draft_create/
--      draft_start reach their drafts lock only under a league gate of
--      'scheduled', and draft_reset only runs on live/paused drafts,
--      which coexist only with a 'drafting' league (start moves both in
--      one txn) — the two hold-and-want profiles are disjoint. Every
--      OTHER control locks the drafts row only (its chat INSERT takes the
--      same implicit leagues KEY SHARE as a pick — the drafts →
--      leagues(share) direction every writer already follows).
--  10b. `draft_actor_name()` — chat-post helper: COALESCE(display_name,
--      username) of the caller, 'a commissioner' for a system caller.
--      STABLE, plain, broad EXECUTE (reads only the caller's own name —
--      the draft_team_for_pick breadth precedent).
--  11. THE §8.7 COMMISSIONER-OUTAGE ARM lands in `draft_tick` — 068
--      AMENDED IN PLACE alongside this migration (the unreleased-chain
--      precedent, F12; see 068's banner): a live NON-mock draft auto-
--      pauses when supervision was ESTABLISHED and then LOST — at least
--      one commissioner/co-commissioner heartbeat row exists for the
--      draft AND none is newer than now() − (draft_liveness_freshness()
--      + disconnect_grace_seconds). The arm's CLAIM locks only outage
--      candidates (that same predicate in the claim WHERE, re-verified
--      under the lock, LIMIT 25 — R135, M2 batch 5; pre-fix it locked
--      every live non-mock draft each tick). Pause via
--      draft_pause_internal (the ONE bookkeeping path), system post with
--      user_id NULL, resume is a commissioner action (the tick NEVER
--      auto-resumes). Full rationale incl. the as-of-NOW vs as-of-deadline
--      freshness contrast and the never-connected exemption in 068's
--      banner + D108.
--
-- AUTH MODEL (§17 "Draft: pause/undo/reassign/move/reset" — co-commish ✓):
-- every RPC locks the drafts row FIRST (§4.6), then answers ONE 42501 for
-- {nonexistent draft, non-member, member-but-not-commish} via
-- is_league_commish (052 — commissioner OR co_commissioner), the no-leak
-- shape 063/066 pinned. The league row is NOT locked outside reset (the
-- R122 lesson); a role demotion racing a control serializes on the league
-- row elsewhere (R93) and at most one in-flight control lands under the
-- old role — the same §7.2.1-class semantics 066's removal-race note
-- records for picks. Argument-shape errors are 22023 before any data
-- access; unknown players/picks P0002; friendly refusals P0001 with
-- pgTAP-pinned messages (they are UX — §8.3 checklist).
--
-- `p_reason` (D97/F32/F40): accepted on EVERY control, TEXT DEFAULT NULL,
-- validated at the route (Zod, L.B2.3), STORED NOWHERE — not even in the
-- chat post (the post is the ACTION's transparency; the reason's home is
-- M6's commissioner_actions row, F40). The 063 remove_manager precedent.
--
-- SYSTEM POSTS (D97, §8.8, §16.3): one INSERT per state-changing call, in
-- the same transaction, context = 'draft:<draft_id>', is_system = TRUE,
-- human-readable (actor named via COALESCE(display_name, username) — they
-- are UX and are pinned in pgTAP 023). Idempotent no-ops (double pause/
-- resume) post NOTHING — the room sees every change exactly once. Every
-- control bumps drafts.updated_at (the D92 state_version).
--
-- Grants doctrine (D18→D23 / tasks-M1 §4.1): no per-object GRANTs; all
-- nine RPCs are SECURITY DEFINER + SET search_path = '' + in-body auth +
-- REVOKE FROM PUBLIC, anon. `draft_pause_internal` follows the 062/068
-- internal form: plain (executes under its SECURITY DEFINER callers), SET
-- search_path = '', REVOKE FROM PUBLIC, anon, authenticated.
--
-- Realtime (standing rule 5): drafts/draft_picks/league_chat writes here
-- get their Broadcast-from-DB triggers in migration 070 (L.B1.5) — no
-- subscriber exists until L.B3.1; nothing in this migration writes a table
-- a client currently renders live.
--
-- Typegen: RE-RUN (nine new PostgREST-exposed functions + the league_chat
-- nullability change); alias block re-appended, diff verified
-- additive-only (§4.4).
--
-- §8.1 staging-rehearsal waiver (R6 rule): no staging clone exists
-- (environments are local + prod only); the recorded rehearsal evidence is
-- the fresh local `npx supabase db reset` replay of the full 001–069 chain
-- plus pgTAP 023 in the same PR. Prod-safe: new functions + one constraint
-- drop. F12 note: prod's migration history still ends pre-league-schema;
-- this lands with the next normal push.
--
-- AMENDED IN PLACE 2026-08-04 (L.B1.6/071 — the unreleased-chain amend
-- precedent, F12; see 071's banner + PROGRESS D110). Mock Draft Mode made
-- mocks REACHABLE, so every control here needed a mock posture (§8.8 +
-- D103(2) — nobody but the launcher drives a solo practice):
--   * `draft_pause` / `draft_resume` gained the MOCK-LAUNCHER ARM: on an
--     is_mock draft the ONLY legal human caller is config.mock.launched_by
--     (§8.8 "pause/leave anytime … resumable from the league page" +
--     "Same engine, literally: … pause/resume"; E59's auto-pause — 068
--     ARM 1.6 — needs a resume path that cannot dead-end on a
--     non-commissioner launcher). Commissioners have NO bypass (friendly
--     P0001). The 42501 no-leak floor + message are UNCHANGED for real
--     drafts (023's pins hold; the member gate keeps nonexistent and
--     non-member answering the same refusal).
--   * The other seven controls (set_clock/undo/reassign/move/force/
--     set_order/reset) REFUSE mocks with a friendly P0001: §8.7 is the
--     REAL-draft surface, and `draft_reset` on a mock would be an
--     outright zero-side-effect breach (live-verified before guarding:
--     unguarded, reset(mock) flipped leagues.status to 'scheduled' and
--     REMOVED settings.draft.draft_scheduled_at — exactly the league
--     write §8.8 bans). Non-commish callers keep the 42501 gate (a
--     launcher without the commissioner role gets 42501 on these — the
--     controls simply do not exist for mocks; recorded).
--   All mock-posture refusals pinned in pgTAP 025; 023 untouched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. league_chat.user_id nullable — system posts from the tick have no
--    acting user (item 1; forge-proof via the 065 INSERT policy) — and the
--    author FK moves CASCADE → SET NULL (R137, M2 batch 5): 001's ON DELETE
--    CASCADE meant deleting the acting commissioner's account hard-deleted
--    their system posts — against §12.13's "(non-deletable)" system posts,
--    D99's append-only chat, and D97's interim-audit purpose. SET NULL
--    applies to ALL chat rows deliberately (a plain FK cannot be partial,
--    and splitting system from ordinary rows would need a trigger for no
--    principled gain): account deletion removes the IDENTITY, not the
--    room's history — the same rule the M1 membership work applies to
--    teams/picks a departed member leaves behind, and consistent with D99
--    (chat rows are never deleted). An authorless ordinary message renders
--    by its is_system=FALSE shape (a "former member" fallback is the chat
--    UI's job, L.B3.3); user_id NULL was already a legal, forge-proof
--    shape after the DROP NOT NULL below. Full reasoning: D108(15).
-- ---------------------------------------------------------------------------

ALTER TABLE league_chat ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE league_chat DROP CONSTRAINT league_chat_user_id_fkey;
ALTER TABLE league_chat
  ADD CONSTRAINT league_chat_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2. draft_pause_internal — the ONE pause-bookkeeping implementation
--    (consumers: draft_pause + the 068 outage arm)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_pause_internal(
  p_draft_id UUID,
  p_actor UUID,
  p_message TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_draft     public.drafts;
  v_remaining INTEGER;
BEGIN
  -- Plain re-read: the caller holds the drafts-row lock (§4.6) and has
  -- validated status = 'live'.
  SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;

  -- §8.7 v2.0 bookkeeping: remaining persisted to the millisecond against
  -- the txn's now(). MAY BE NEGATIVE (a pause during a D102 grace hold —
  -- see the banner; clocks never gain or lose time, the grace clock
  -- included). NULL for an untimed draft (§8.2 soft timer).
  v_remaining := CASE
    WHEN v_draft.current_deadline IS NOT NULL
    THEN round(EXTRACT(EPOCH FROM (v_draft.current_deadline - now())) * 1000)::int
  END;

  UPDATE public.drafts SET
    status                = 'paused',
    paused_at             = now(),
    deadline_remaining_ms = v_remaining,
    current_deadline      = NULL,
    updated_at            = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  -- The D97 system post (in-txn; user_id NULL when the tick is the actor).
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, p_actor, p_message,
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'paused', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_pause_internal(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. draft_pause / draft_resume — §8.7 row 1 (v2.0 pause bookkeeping)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_pause(
  p_draft_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft public.drafts;
BEGIN
  -- (1) LOCK the drafts row FIRST (§4.6).
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  -- (2) VALIDATE. One 42501 for nonexistent/non-member/non-commish
  -- (no-leak; is_league_commish(NULL) is FALSE). MOCK ARM (L.B1.6/071 —
  -- amended in place, F12; §8.8 "pause/leave anytime … resumable" +
  -- D103(2)): on a mock the authority is the LAUNCHER, not the
  -- commissioner — the member gate keeps the no-leak floor (nonexistent
  -- and non-member answer the same 42501, message unchanged for 023's
  -- pins), the commissioner gate applies to REAL drafts only, and a
  -- member who is not the launcher gets the friendly refusal below
  -- (commissioners have NO bypass — nobody else drives a solo practice).
  IF NOT FOUND
     OR NOT public.is_league_member(v_draft.league_id)
     OR (NOT v_draft.is_mock AND NOT public.is_league_commish(v_draft.league_id)) THEN
    RAISE EXCEPTION 'draft_pause: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  IF v_draft.is_mock
     AND v_draft.config->'mock'->>'launched_by' IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION
      'draft_pause: only the member practicing this mock can pause it (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent no-op (D63 class): a double-tapped Pause must not error —
  -- and must NOT re-run the bookkeeping (recomputing remaining on an
  -- already-paused draft would corrupt it) or post twice.
  IF v_draft.status = 'paused' THEN
    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'paused', FALSE);
  END IF;

  IF v_draft.status <> 'live' THEN
    RAISE EXCEPTION
      'draft_pause: the draft is % — only a live draft can be paused',
      v_draft.status
      USING ERRCODE = 'P0001';
  END IF;

  RETURN public.draft_pause_internal(
    p_draft_id, auth.uid(),
    'Draft paused by ' || public.draft_actor_name() || '.');
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_pause(UUID, TEXT) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION draft_resume(
  p_draft_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft public.drafts;
BEGIN
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  -- MOCK ARM (L.B1.6/071 — the draft_pause mirror; E59's auto-pause needs
  -- a resume path that cannot dead-end on a non-commissioner launcher).
  IF NOT FOUND
     OR NOT public.is_league_member(v_draft.league_id)
     OR (NOT v_draft.is_mock AND NOT public.is_league_commish(v_draft.league_id)) THEN
    RAISE EXCEPTION 'draft_resume: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  IF v_draft.is_mock
     AND v_draft.config->'mock'->>'launched_by' IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION
      'draft_resume: only the member practicing this mock can resume it (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent no-op: resume of a live draft.
  IF v_draft.status = 'live' THEN
    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'resumed', FALSE);
  END IF;

  IF v_draft.status <> 'paused' THEN
    RAISE EXCEPTION
      'draft_resume: the draft is % — only a paused draft can be resumed',
      v_draft.status
      USING ERRCODE = 'P0001';
  END IF;

  -- §8.7 v2.0: current_deadline = now() + remaining, restored with exact
  -- integer-millisecond interval math (never float seconds). NULL
  -- remaining (untimed) restores a NULL deadline.
  UPDATE public.drafts SET
    status                = 'live',
    current_deadline      = CASE
                              WHEN v_draft.deadline_remaining_ms IS NOT NULL
                              THEN now() + v_draft.deadline_remaining_ms * interval '1 millisecond'
                            END,
    deadline_remaining_ms = NULL,
    paused_at             = NULL,
    updated_at            = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          'Draft resumed by ' || public.draft_actor_name() || '.',
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'resumed', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_resume(UUID, TEXT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 4. draft_actor_name — chat-post helper (the acting user's display name)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_actor_name()
RETURNS TEXT
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  -- COALESCE chain: display_name → username → 'a commissioner' (a system
  -- caller with no JWT). Pure read of the caller's own profile row;
  -- EXECUTE left broad deliberately (leaks nothing beyond the caller's own
  -- name — the draft_team_for_pick breadth precedent).
  SELECT COALESCE(
    (SELECT COALESCE(NULLIF(p.display_name, ''), p.username)
     FROM public.profiles p WHERE p.id = auth.uid()),
    'a commissioner');
$$;

-- ---------------------------------------------------------------------------
-- 5. draft_set_clock — §8.7 row 2 / E15 (subsequent picks; extend-only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_set_clock(
  p_draft_id UUID,
  p_pick_timer_seconds INTEGER,
  p_extend_current BOOLEAN DEFAULT FALSE,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft public.drafts;
  v_note  TEXT := '';
BEGIN
  IF p_pick_timer_seconds IS NULL OR p_pick_timer_seconds < 0 THEN
    RAISE EXCEPTION 'draft_set_clock: pick_timer_seconds must be a non-negative integer'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_set_clock: not a commissioner of this draft''s league'
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
      'draft_set_clock: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION
      'draft_set_clock: the draft is % — the pick clock can only be edited mid-draft (E15); pre-draft, edit it in League settings',
      v_draft.status
      USING ERRCODE = 'P0001';
  END IF;

  IF p_extend_current AND v_draft.status = 'paused' THEN
    RAISE EXCEPTION
      'draft_set_clock: the draft is paused — resume first, then extend the current pick (the paused clock keeps its stored remaining time)'
      USING ERRCODE = 'P0001';
  END IF;

  -- E15: the new timer governs SUBSEQUENT picks — the drafts.config
  -- snapshot is the live room's authority (D95); league settings untouched.
  UPDATE public.drafts SET
    config     = jsonb_set(config, '{pick_timer_seconds}',
                           to_jsonb(p_pick_timer_seconds)),
    updated_at = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  IF p_extend_current AND v_draft.status = 'live' THEN
    IF p_pick_timer_seconds = 0 THEN
      -- Untimed (§8.2 soft timer) applied to the current pick: the clock
      -- comes off — removing a clock is not shortening it (E15).
      UPDATE public.drafts SET current_deadline = NULL, updated_at = now()
      WHERE id = p_draft_id
      RETURNING * INTO v_draft;
      v_note := ' The current pick is now untimed.';
    ELSE
      -- Extend-only: GREATEST — a shorter timer never silently shortens
      -- the running clock (E15). R138: on an UNTIMED current pick
      -- (current_deadline NULL) GREATEST(NULL, now()+timer) IMPOSES the
      -- new timer — the commissioner's explicit request (extend_current on
      -- an untimed pick means "put this pick on the clock"; the
      -- §8.2-symmetric inverse of the timer-0 arm; the pick gets a FULL
      -- fresh timer, so no running countdown is ever cut). Decided + pinned
      -- M2 batch 5; the post names the imposition distinctly. See the
      -- banner + D108(3).
      IF v_draft.current_deadline IS NULL THEN
        v_note := ' The current pick is now on the clock.';
      ELSE
        v_note := ' The current pick was extended.';
      END IF;
      UPDATE public.drafts SET
        current_deadline = GREATEST(current_deadline,
                                    now() + make_interval(secs => p_pick_timer_seconds)),
        updated_at       = now()
      WHERE id = p_draft_id
      RETURNING * INTO v_draft;
    END IF;
  END IF;

  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          'Pick clock set to ' ||
          CASE WHEN p_pick_timer_seconds = 0 THEN 'untimed'
               ELSE p_pick_timer_seconds || ' seconds' END ||
          ' by ' || public.draft_actor_name() ||
          ' (applies to upcoming picks).' || v_note,
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object('draft', to_jsonb(v_draft));
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_set_clock(UUID, INTEGER, BOOLEAN, TEXT)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 6. draft_undo — §8.7 rows 3–4 (single + cascade; E4; the R125 decision)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_undo(
  p_draft_id UUID,
  p_to_pick_number INTEGER DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft      public.drafts;
  v_max_live   INTEGER;
  v_to         INTEGER;
  v_first      INTEGER;
  v_undone     INTEGER;
  v_team_count INTEGER;
  v_timer      INTEGER;
  v_team_name  TEXT;
BEGIN
  IF p_to_pick_number IS NOT NULL AND p_to_pick_number < 0 THEN
    RAISE EXCEPTION 'draft_undo: to_pick_number must be >= 0'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_undo: not a commissioner of this draft''s league'
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
      'draft_undo: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION
      'draft_undo: the draft is complete — post-completion corrections arrive with the commissioner console (M6)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'draft_undo: the draft has not started yet — nothing to undo'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT max(p.pick_number) INTO v_max_live
  FROM public.draft_picks p
  WHERE p.draft_id = p_draft_id AND p.is_undone = FALSE;

  IF v_max_live IS NULL THEN
    RAISE EXCEPTION 'draft_undo: no picks have been made yet — nothing to undo'
      USING ERRCODE = 'P0001';
  END IF;

  -- p_to NULL ⇒ single undo of the highest live pick (§8.7 row 3).
  v_to := COALESCE(p_to_pick_number, v_max_live - 1);
  IF v_to >= v_max_live THEN
    RAISE EXCEPTION
      'draft_undo: nothing to undo after pick % — the last completed pick is pick %',
      v_to, v_max_live
      USING ERRCODE = 'P0001';
  END IF;

  -- E4: soft-undo everything after pick v_to. Pool return is the partial
  -- index (undone rows free their players); rows are KEPT (§12.4 audit).
  UPDATE public.draft_picks
  SET is_undone = TRUE
  WHERE draft_id = p_draft_id AND is_undone = FALSE AND pick_number > v_to;
  GET DIAGNOSTICS v_undone = ROW_COUNT;

  -- Clock rewind to the first reverted pick (E4: "clock rewound to that
  -- team") with a FRESH full timer — live now; paused on resume.
  v_first := v_to + 1;
  v_team_count := jsonb_array_length(v_draft.draft_order);
  v_timer := COALESCE((v_draft.config->>'pick_timer_seconds')::int, 90);

  UPDATE public.drafts SET
    current_pick_number   = v_first,
    current_round         = ((v_first - 1) / v_team_count) + 1,
    on_clock_team_id      = public.draft_team_for_pick(
                              draft_order, draft_type,
                              COALESCE((config->>'snake_reversal')::boolean, FALSE),
                              v_first),
    current_deadline      = CASE WHEN status = 'live' AND v_timer > 0
                                 THEN now() + make_interval(secs => v_timer)
                            END,
    deadline_remaining_ms = CASE WHEN status = 'paused' AND v_timer > 0
                                 THEN v_timer * 1000
                            END,
    completed_at          = NULL,
    updated_at            = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  SELECT t.name INTO v_team_name
  FROM public.teams t WHERE t.id = v_draft.on_clock_team_id;

  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          CASE WHEN v_undone = 1
            THEN 'Pick ' || v_first || ' undone by ' || public.draft_actor_name()
                 || ' — ' || COALESCE(v_team_name, 'the team') || ' is back on the clock.'
            ELSE 'Picks ' || v_first || '-' || v_max_live || ' undone by '
                 || public.draft_actor_name() || ' (' || v_undone
                 || ' picks reverted) — ' || COALESCE(v_team_name, 'the team')
                 || ' is back on the clock at pick ' || v_first || '.'
          END,
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object(
    'draft', to_jsonb(v_draft),
    'undone_count', v_undone,
    'rewound_to_pick', v_first);
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_undo(UUID, INTEGER, TEXT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 7. draft_reassign_pick — §8.7 row 5 first half (edit what/who a pick
--    selected; exclusivity + capacity; before/after in the post)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_reassign_pick(
  p_draft_id UUID,
  p_pick_id UUID,
  p_team_id UUID DEFAULT NULL,
  p_player_id TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
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
BEGIN
  IF p_team_id IS NULL AND p_player_id IS NULL THEN
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

  SELECT t.name INTO v_new_team_name
  FROM public.teams t WHERE t.id = v_new_team;

  UPDATE public.draft_picks
  SET team_id = v_new_team, player_id = v_new_player
  WHERE id = p_pick_id
  RETURNING * INTO v_pick;

  UPDATE public.drafts SET updated_at = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

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
  v_msg := v_msg || '.';

  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(), v_msg,
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'pick', to_jsonb(v_pick));
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_reassign_pick(UUID, UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 8. draft_move_player — §8.7 row 5 second half ("move players between
--    teams easily if something breaks")
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_move_player(
  p_draft_id UUID,
  p_player_id TEXT,
  p_from_team UUID,
  p_to_team UUID,
  p_reason TEXT DEFAULT NULL
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

  SELECT t.name INTO v_from_name
  FROM public.teams t WHERE t.id = p_from_team;

  UPDATE public.draft_picks
  SET team_id = p_to_team
  WHERE id = v_pick.id
  RETURNING * INTO v_pick;

  UPDATE public.drafts SET updated_at = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  -- Before/after in the post (§8.7 row 5).
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          v_player_name || ' moved from ' || COALESCE(v_from_name, '?')
          || ' to ' || v_to_name || ' by ' || public.draft_actor_name() || '.',
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'pick', to_jsonb(v_pick));
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_move_player(UUID, TEXT, UUID, UUID, TEXT)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 9. draft_force_pick — §8.7 row 6 ("Pick for a manager"; the ONE advance
--    path via draft_apply_pick_internal)
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
-- 10. draft_set_order — §8.3 order edit / E31 (post-start re-derive)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_set_order(
  p_draft_id UUID,
  p_order UUID[],
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft      public.drafts;
  v_league     public.leagues;
  v_new_order  JSONB;
  v_valid      BOOLEAN;
  v_timer      INTEGER;
  v_new_onclock UUID;
BEGIN
  IF p_order IS NULL OR cardinality(p_order) = 0 THEN
    RAISE EXCEPTION 'draft_set_order: a non-empty draft order is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_set_order: not a commissioner of this draft''s league'
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
      'draft_set_order: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION 'draft_set_order: the draft is complete — the order cannot change'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_set_order: league % not found', v_draft.league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Permutation of the active franchises (066's validation, typed at the
  -- boundary — uuid[] means malformed entries failed at the wire cast).
  v_valid := (
    SELECT count(*) = v_league.team_count
       AND count(DISTINCT e.id) = v_league.team_count
       AND bool_and(EXISTS (
             SELECT 1 FROM public.teams t
             WHERE t.league_id = v_draft.league_id
               AND t.status <> 'retired'
               AND t.id = e.id))
    FROM unnest(p_order) AS e(id)
  );
  IF NOT v_valid THEN
    RAISE EXCEPTION
      'draft_set_order: the order must include every active franchise exactly once (§8.3)'
      USING ERRCODE = 'P0001';
  END IF;

  v_new_order := to_jsonb(p_order);
  v_timer := COALESCE((v_draft.config->>'pick_timer_seconds')::int, 90);

  IF v_draft.status = 'scheduled' THEN
    -- Pre-start: just the stored order — the lobby shows it and
    -- draft_start honors the draft-row candidate (D101/R123).
    UPDATE public.drafts SET
      draft_order = v_new_order,
      updated_at  = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_draft;
  ELSE
    -- E31 (live/paused): completed picks are STORED rows and stay
    -- untouched; remaining picks re-derive mechanically because advance
    -- reads drafts.draft_order. The CURRENT pick's team re-derives NOW; a
    -- CHANGED on-clock team gets a FRESH full clock (it never had the
    -- clock), an unchanged team keeps its running clock. RESIDUAL: a
    -- mid-round edit can leave per-team totals uneven — E31 sanctions it
    -- (see the banner).
    v_new_onclock := public.draft_team_for_pick(
      v_new_order, v_draft.draft_type,
      COALESCE((v_draft.config->>'snake_reversal')::boolean, FALSE),
      v_draft.current_pick_number);

    UPDATE public.drafts SET
      draft_order           = v_new_order,
      on_clock_team_id      = v_new_onclock,
      current_deadline      = CASE
                                WHEN v_new_onclock IS DISTINCT FROM v_draft.on_clock_team_id
                                     AND status = 'live' AND v_timer > 0
                                THEN now() + make_interval(secs => v_timer)
                                WHEN v_new_onclock IS DISTINCT FROM v_draft.on_clock_team_id
                                THEN NULL
                                ELSE current_deadline
                              END,
      deadline_remaining_ms = CASE
                                WHEN v_new_onclock IS DISTINCT FROM v_draft.on_clock_team_id
                                     AND status = 'paused' AND v_timer > 0
                                THEN v_timer * 1000
                                WHEN v_new_onclock IS DISTINCT FROM v_draft.on_clock_team_id
                                     AND status = 'paused'
                                THEN NULL
                                ELSE deadline_remaining_ms
                              END,
      updated_at            = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_draft;
  END IF;

  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          CASE WHEN v_draft.status = 'scheduled'
            THEN 'Draft order updated by ' || public.draft_actor_name() || '.'
            ELSE 'Draft order changed by ' || public.draft_actor_name()
                 || ' at pick ' || v_draft.current_pick_number
                 || ' — remaining picks follow the new order.'
          END,
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object('draft', to_jsonb(v_draft));
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_set_order(UUID, UUID[], TEXT)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 11. draft_reset — §8.7 last row (drafts + league back to 'scheduled';
--     the D107(5) auto-start seam closed by clearing the stored instant)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_reset(
  p_draft_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft  public.drafts;
  v_undone INTEGER;
BEGIN
  -- LOCK ORDER (banner item 10): the DRAFTS row FIRST — serializing with
  -- in-flight picks — then the LEAGUES row. Taking leagues first would
  -- recreate the R122 FK-KEY-SHARE cycle against a pick in flight.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_reset: not a commissioner of this draft''s league'
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
      'draft_reset: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION
      'draft_reset: the draft is complete — a post-completion reset is an audited override that arrives with the commissioner console (M6)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'draft_reset: the draft has not started — nothing to reset'
      USING ERRCODE = 'P0001';
  END IF;

  -- Now the league row (drafts → leagues — see the banner's lock-order
  -- analysis).
  PERFORM 1 FROM public.leagues l
  WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_reset: league % not found', v_draft.league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Soft-undo every live pick (§12.4 audit trail; pool return is the
  -- partial index).
  UPDATE public.draft_picks
  SET is_undone = TRUE
  WHERE draft_id = p_draft_id AND is_undone = FALSE;
  GET DIAGNOSTICS v_undone = ROW_COUNT;

  -- The system post BEFORE the drafts-row context anchor changes nothing —
  -- same txn; written first so the room's transcript reads
  -- action-then-state.
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          'Draft reset by ' || public.draft_actor_name() || ' — ' || v_undone
          || ' picks cleared; the draft is back to scheduled. Re-schedule it in Draft setup or start it manually when ready.',
          'draft:' || p_draft_id::text, TRUE);

  -- The drafts row back to pre-draft. draft_order KEPT (D101 — the shown
  -- order survives a reset; manual/custom orders are not lost).
  UPDATE public.drafts SET
    status                = 'scheduled',
    current_round         = 1,
    current_pick_number   = 1,
    on_clock_team_id      = NULL,
    current_deadline      = NULL,
    paused_at             = NULL,
    deadline_remaining_ms = NULL,
    started_at            = NULL,
    completed_at          = NULL,
    updated_at            = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  -- Fresh room state: this draft's heartbeats go too (the outage arm's
  -- "supervision established" memory starts clean on a re-run — D108).
  DELETE FROM public.draft_liveness WHERE draft_id = p_draft_id;

  -- League back to 'scheduled' (§8.7's own row; §7.1's re-open arrow; the
  -- D43 guard is indifferent — the snapshot survives) AND the stored
  -- auto-start instant REMOVED — the D107(5) seam closure: a PAST
  -- draft_scheduled_at would re-start this draft on the next 5s tick
  -- (D94). Auto-start re-arms only when the commissioner re-schedules
  -- through the settings picker; the Start button works without an
  -- instant (066 create-if-absent).
  UPDATE public.leagues SET
    status     = 'scheduled',
    settings   = settings #- '{draft,draft_scheduled_at}',
    updated_at = now()
  WHERE id = v_draft.league_id;

  RETURN jsonb_build_object(
    'draft', to_jsonb(v_draft),
    'reset', TRUE,
    'picks_cleared', v_undone);
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_reset(UUID, TEXT) FROM PUBLIC, anon;
