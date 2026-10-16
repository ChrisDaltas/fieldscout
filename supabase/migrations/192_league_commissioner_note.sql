-- ============================================================================
-- Migration 192: the commissioner note (gap list #13)
--
-- Chris, 2026-10-15: one short note the commissioner pins for the whole
-- league — ESPN's "LM Note" ("Trade deadline is Nov 24", "Dues by Friday").
-- It shows on the LEAGUE home (not the app Home), and members get a
-- notification when it changes. Not chat — the league board is chat.
--
-- 1. THREE COLUMNS ON `leagues`, not a reuse of `leagues.description`.
--    `description` is 001's column, listed by spec §12.1 among the existing
--    columns the league keeps ("existing columns reused: … name,
--    description, …") — the league's "about" line. No verb writes it today,
--    but a note is a different thing (dated, signed, pinned for now), and it
--    needs who-and-when anyway, so it gets its own three columns:
--      commissioner_note            TEXT     — NULL = no note
--      commissioner_note_updated_at TIMESTAMPTZ — the last set / clear
--      commissioner_note_updated_by UUID → profiles (SET NULL) — who did it
--    A CHECK holds the stored shape on every path: NULL, or 1..500 characters
--    with no leading / trailing space, tab or newline.
--
-- 2. READS ride the existing `leagues` SELECT policy ("Leagues viewable by
--    members": is_league_member(id) OR owner_id = auth.uid() — §12.1). A
--    non-member reads no row, so no note. Nothing to add.
--
-- 3. WRITES: no client can UPDATE `leagues` (v2.8.2 — no UPDATE policy), so
--    the ONE door is `commish_set_league_note(p_league_id, p_note, p_reason)`,
--    SECURITY DEFINER, search_path '' — over a PLAIN, REVOKEd
--    `commish_set_league_note_internal(…, p_at)` (the house TimeProvider seam,
--    D307(3)). In order:
--      (1) lock the league row (the house lock order) — a soft-deleted league
--          is "no such league";
--      (2) auth: commissioner OR co-commissioner (`is_league_commish` — §4
--          "Co-Commissioner: same powers, same audit trail"); ONE no-leak
--          42501 for "no such league" and "not a commissioner" alike;
--      (3) reason OPTIONAL (Q66 / 131): trimmed, ≤ 500, blank = none;
--      (4) the note: trimmed (spaces, tabs, newlines — the explicit class,
--          R745), ≤ 500 characters (22023 by name); EMPTY CLEARS it;
--      (5) the no-op by value: the same note again writes NOTHING (no
--          receipt, no notification) and says so;
--      (6) the state write, ROW_COUNT asserted;
--      (7) ONE commissioner_actions row through the shared helper — action
--          `set_league_note`, target `league`, before/after `{note}` — the
--          receipt League Home's activity shows (Q66); its absence raises;
--      (8) on EVERY real change — a set, an edit or a clear (the ruling:
--          "members get a notification when it changes"; a clear is a
--          change): every member with a user (not the author, not a
--          placeholder seat) gets ONE unread `league_commissioner_note`
--          notification — "Commissioner note updated", the note as the body
--          (a clear: "The commissioner cleared the note."), `data.league_id`
--          for the league-home link, `data.cleared`. A member who already
--          has an UNREAD one for this league gets it REPLACED (new text, new
--          time) rather than a second row, so three quick edits are one ping
--          and a clear never leaves a stale note in the bell.
--          Counts asserted: every recipient got exactly one.
--    No action_id / replay ledger: setting a note to a value is idempotent
--    by value (the 128 `rename_own_team` argument) — a retry of the same
--    text is step (5)'s no-op.
--    No league-chat post: §10.3's non-disableable post is for OVERRIDES of
--    the game; a note overrides nothing (the receipt + the notification are
--    the trail).
--
-- 4. DEPLOY BEFORE PUSH: the app reads the columns through
--    GET /api/leagues/[id]/commish/note, which answers `available: false`
--    on a database without them (42703), and the write route answers a named
--    503 while the door is missing (PGRST202). Nothing else reads them.
--
-- Authored against the chain's HEAD: every function here is NEW (no
-- CREATE OR REPLACE of another migration's body); `log_commissioner_action_
-- internal` (123) and `is_league_commish` (052) are called, not replaced.
-- pgTAP 139_league_commissioner_note.sql; pgTAP 005's exact-column pin of
-- `leagues` extended by the three columns.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS commissioner_note            TEXT,
  ADD COLUMN IF NOT EXISTS commissioner_note_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS commissioner_note_updated_by UUID;

ALTER TABLE leagues
  ADD CONSTRAINT leagues_commissioner_note_updated_by_fkey
    FOREIGN KEY (commissioner_note_updated_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE leagues
  ADD CONSTRAINT leagues_commissioner_note_shape CHECK (
    commissioner_note IS NULL
    OR (char_length(commissioner_note) BETWEEN 1 AND 500
        AND commissioner_note = btrim(commissioner_note, E' \t\r\n'))
  );

COMMENT ON COLUMN leagues.commissioner_note IS
  'Migration 192 (gap list #13, Chris 2026-10-15): the commissioner note pinned for the whole league — NULL = none; 1..500 chars, trimmed. Written ONLY by commish_set_league_note; read by members through the leagues SELECT policy.';
COMMENT ON COLUMN leagues.commissioner_note_updated_at IS
  'Migration 192: when the commissioner note was last set or cleared.';
COMMENT ON COLUMN leagues.commissioner_note_updated_by IS
  'Migration 192: who last set or cleared the commissioner note (a commissioner or co-commissioner); NULL if that profile is gone.';

-- ---------------------------------------------------------------------------
-- 2. commish_set_league_note_internal — PLAIN, search_path '', takes the
--    instant (the tests' TimeProvider seam). Reached only through the door.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_set_league_note_internal(
  p_league_id UUID,
  p_note      TEXT,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league     public.leagues;
  v_found      BOOLEAN;
  v_actor      UUID := auth.uid();
  v_reason     TEXT;
  v_note       TEXT;
  v_old        TEXT;
  v_cnt        INTEGER;
  v_audit_id   UUID;
  v_recipients UUID[] := '{}';
  v_replaced   INTEGER := 0;
  v_inserted   INTEGER := 0;
  v_body       TEXT;
  v_data       JSONB;
BEGIN
  -- (1) LOCK the league row first (the house lock order) so two
  --     commissioners' writes serialize and each receipt's `before` is the
  --     value it actually replaced.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — commissioner or co-commissioner; one no-leak 42501.
  IF v_actor IS NULL OR NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_set_league_note: only this league''s commissioner or a co-commissioner can change the commissioner note'
      USING ERRCODE = '42501';
  END IF;

  -- (3) THE REASON — optional (Q66 / 131).
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'commish_set_league_note: the reason is % characters — keep it to 500 or fewer', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (4) THE NOTE — trimmed; empty clears it; at most 500 characters.
  v_note := NULLIF(btrim(COALESCE(p_note, ''), E' \t\r\n'), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'commish_set_league_note: the note is % characters — keep it to 500 or fewer', char_length(v_note)
      USING ERRCODE = '22023';
  END IF;

  v_old := v_league.commissioner_note;

  -- (5) THE NO-OP, by value: nothing written, nobody notified, and it says so.
  IF v_old IS NOT DISTINCT FROM v_note THEN
    RETURN jsonb_build_object(
      'league_id',              p_league_id,
      'verb',                   'commish_set_league_note',
      'action_type',            'set_league_note',
      'note',                   v_old,
      'previous_note',          v_old,
      'cleared',                FALSE,
      'updated_at',             v_league.commissioner_note_updated_at,
      'updated_by',             v_league.commissioner_note_updated_by,
      'no_changes',             TRUE,
      'no_changes_why',         CASE WHEN v_note IS NULL
                                  THEN 'there was no note to clear'
                                  ELSE 'the note already says exactly this' END,
      'commissioner_action_id', NULL,
      'notified',               0,
      'reason',                 v_reason,
      'evaluated_at',           p_at);
  END IF;

  -- (6) THE STATE WRITE.
  UPDATE public.leagues
  SET commissioner_note            = v_note,
      commissioner_note_updated_at = p_at,
      commissioner_note_updated_by = v_actor
  WHERE id = p_league_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'commish_set_league_note: the note write touched % rows, expected exactly 1 (league %)', v_cnt, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- (7) ONE receipt — what League Home's activity shows (Q66).
  v_audit_id := public.log_commissioner_action_internal(
    p_league_id, v_actor, 'set_league_note', 'league', p_league_id::text, v_reason,
    jsonb_build_object('note', v_old),
    jsonb_build_object('note', v_note),
    jsonb_build_object(
      'verb',    'commish_set_league_note',
      'season',  v_league.season,
      'cleared', v_note IS NULL),
    NULL);
  IF v_audit_id IS NULL THEN
    RAISE EXCEPTION 'commish_set_league_note: the receipt was not written — refusing to change the note without it'
      USING ERRCODE = 'P0001';
  END IF;

  -- (8) THE NOTIFICATION — on every real change (a set, an edit or a clear:
  --     "when it changes"); every member with a user except the author; one
  --     unread row per member per league.
  v_recipients := ARRAY(
    SELECT DISTINCT m.user_id
    FROM public.league_members m
    WHERE m.league_id = p_league_id
      AND m.user_id IS NOT NULL
      AND m.user_id <> v_actor
    ORDER BY m.user_id);

  IF v_note IS NULL THEN
    v_body := 'The commissioner cleared the note.';
  ELSE
    v_body := regexp_replace(v_note, E'[\\r\\n\\t ]+', ' ', 'g');
    IF char_length(v_body) > 160 THEN
      v_body := rtrim(left(v_body, 159)) || '…';
    END IF;
  END IF;
  v_data := jsonb_build_object(
    'league_id', p_league_id,
    'actor_id',  v_actor,
    'cleared',   v_note IS NULL,
    'commissioner_action_id', v_audit_id);

  IF cardinality(v_recipients) > 0 THEN
    WITH replaced AS (
      UPDATE public.notifications n
      SET title = 'Commissioner note updated',
          body = v_body,
          data = v_data,
          created_at = p_at
      WHERE n.user_id = ANY (v_recipients)
        AND n.type = 'league_commissioner_note'
        AND n.read = FALSE
        AND n.data ->> 'league_id' = p_league_id::text
      RETURNING n.user_id
    )
    SELECT count(DISTINCT r.user_id)::int INTO v_replaced FROM replaced r;

    INSERT INTO public.notifications (user_id, type, title, body, data, read, created_at)
    SELECT u, 'league_commissioner_note', 'Commissioner note updated', v_body, v_data, FALSE, p_at
    FROM unnest(v_recipients) u
    WHERE NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = u
        AND n.type = 'league_commissioner_note'
        AND n.read = FALSE
        AND n.data ->> 'league_id' = p_league_id::text);
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_replaced + v_inserted <> cardinality(v_recipients) THEN
      RAISE EXCEPTION 'commish_set_league_note: notified % of % members (% replaced, % new)',
        v_replaced + v_inserted, cardinality(v_recipients), v_replaced, v_inserted
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   'commish_set_league_note',
    'action_type',            'set_league_note',
    'note',                   v_note,
    'previous_note',          v_old,
    'cleared',                v_note IS NULL,
    'updated_at',             p_at,
    'updated_by',             v_actor,
    'no_changes',             FALSE,
    'no_changes_why',         NULL,
    'commissioner_action_id', v_audit_id,
    'notified',               v_replaced + v_inserted,
    'notified_why',           CASE
                                WHEN cardinality(v_recipients) = 0 THEN 'no other member with an account to notify'
                                ELSE NULL END,
    'reason',                 v_reason,
    'evaluated_at',           p_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_set_league_note_internal(UUID, TEXT, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION commish_set_league_note_internal(UUID, TEXT, TIMESTAMPTZ, TEXT) IS
  'Migration 192 (gap list #13): the body of commish_set_league_note at an injected instant. PLAIN, REVOKEd — reached through the door and the tests only.';

-- ---------------------------------------------------------------------------
-- 3. commish_set_league_note — the client door. SECURITY DEFINER, now().
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_set_league_note(
  p_league_id UUID,
  p_note      TEXT DEFAULT NULL,   -- NULL / blank clears the note
  p_reason    TEXT DEFAULT NULL    -- OPTIONAL (Q66)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.commish_set_league_note_internal(p_league_id, p_note, now(), p_reason);
END;
$$;
-- `authenticated` keeps EXECUTE; the in-body commissioner gate is the
-- authorization (112:1237's posture).
REVOKE EXECUTE ON FUNCTION commish_set_league_note(UUID, TEXT, TEXT) FROM PUBLIC, anon;
COMMENT ON FUNCTION commish_set_league_note(UUID, TEXT, TEXT) IS
  'Migration 192 (gap list #13, Chris 2026-10-15): set or clear the league''s commissioner note. Commissioner or co-commissioner; trimmed, ≤ 500 chars, empty clears; no-op by value; one commissioner_actions row (set_league_note, {note} before/after); on every real change (set, edit or clear), one unread league_commissioner_note notification per other member (an unread one is replaced); reason optional (Q66).';
