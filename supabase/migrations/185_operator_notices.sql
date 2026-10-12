-- ============================================================================
-- 185 — hand-written notices: `op_send_notification` (M8 L.G1.2; spec §24.4
--       "Notices" v2.16.90; tasks-M8-admin-console.md §6 / TD3 / TD10 / TD11;
--       Q97 / Q101 ruled 2026-10-08; PROGRESS D516; FULL rigour — production
--       writes to every user)
-- ============================================================================
--
-- WHAT THIS ADDS — one operator verb. No table, no policy, no existing body
-- is replaced.
--
--   1. `op_notice_recipients_internal(audience, league)` — WHO a notice
--      reaches (Q97: the sender picks on every send):
--        • 'all_users'           — every app user: every `profiles` row
--                                  (each is an auth user, profiles_id_fkey),
--                                  EXCEPT the AI-expert system accounts
--                                  (username in the format CHECK's persona
--                                  arm, '…-ai' — 020's `fieldscout-ai`
--                                  owner), which no person reads;
--        • 'all_league_members'  — everyone in any league: each distinct
--                                  `league_members.user_id` (not NULL) of a
--                                  league that is not soft-deleted, whatever
--                                  its status;
--        • 'league'              — one league's members: that league's
--                                  `league_members.user_id` (not NULL).
--      Distinct user ids, ordered. PLAIN, REVOKEd.
--
--   2. `op_send_notification_internal(…, p_at)` / the DEFINER door
--      `op_send_notification(…)` (the door hands `now()` to the internal —
--      R1545; it never swaps identities):
--        • the shared prelude (183 / 184 `op_verb_prelude_internal`): the
--          operator gate in-body (TD1 — never `league_members` for the
--          gate), `p_action_id` required, `p_reason` optional, a replay
--          returns the earlier receipt's `after` + `replayed` and writes
--          NOTHING (no second notification for anyone), an action id reused
--          for another verb / actor / league is refused; a league-scoped send
--          takes the league row lock and refuses a missing / deleted league;
--        • channels (TD10): a set that today accepts ONLY 'in_app' (the bell).
--          Email / push are future members of that set and are NOT built — a
--          send naming any other channel, or none, is refused by name;
--        • the text: title required (non-blank, ≤ 120), body optional
--          (non-blank, ≤ 2000), link optional — an IN-APP path only
--          ('/…', never '//' or a scheme, no whitespace or backslash, ≤ 500),
--          so it opens inside the app;
--        • ZERO recipients refuses loudly (P0002) and writes nothing (§24.4
--          "refuses loudly on zero"; standing rule 6);
--        • the recipient list is read ONCE into an array, then written in
--          PAGES of 1000 rows; every page asserts it wrote exactly its slice
--          and the total must equal the count, so a send is never silently
--          capped (the CLAUDE.md "exactly 1000 rows" lesson);
--        • ONE `platform_operator_actions` receipt through
--          `log_operator_action_internal` (182) recording the recipient count
--          (scope 'league' for a league send, else 'platform'), written
--          BEFORE the pages so a concurrent replay of the same action id
--          meets the UNIQUE key, not a second set of rows (and an advisory
--          lock on the action id serialises the two first);
--        • a league send also posts ONE "FieldScout …" line in that league's
--          activity through `op_league_line_internal` (TD11 / Q101 (a); 183).
--          A platform send posts no league line (183's every-league rule).
--      Each notification row: type 'operator_notice', the title / body, and
--      `data` = { from: 'fieldscout', action_id, audience, channel: 'in_app',
--      league_id (league sends only), link (when given) }. The rail shows it
--      with a "From FieldScout" label.
--
-- CHECKLIST (tasks-M* §4.4): no new table; one grant narrowed on
-- `notifications` (R1558, §3 below); three new functions, all
-- search_path ''; DEFINER only on the door, with the in-body gate; EXECUTE on
-- the door for `authenticated` only, both internals REVOKEd from PUBLIC /
-- anon / authenticated. No existing function is CREATE OR REPLACE'd (the
-- prelude, the league-line writer and the audit seam are CALLED at their
-- 184 / 183 / 182 heads). No R6 / D38 waiver needed. `notifications` keeps
-- its 001 RLS (own rows SELECT / UPDATE; no INSERT policy), BUT its UPDATE
-- privilege is narrowed (R1558): authenticated may update only the `read`
-- column, anon nothing — so a user can mark their own rows read but can no
-- longer rewrite a row's type / title / body / data (e.g. relabel it "From
-- FieldScout"). The only client path (/api/notifications/read) sets `read`
-- only; every other writer (this verb, the league notifiers,
-- notify_list_followers) runs as the DEFINER owner and is unaffected.
-- DEPLOY BEFORE PUSH (TD9): the route answers 503 "not available yet" on
-- PGRST202 until this is pushed; nothing else calls it.
-- pgTAP 133_operator_notices.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Who a notice reaches (Q97)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION op_notice_recipients_internal(p_audience TEXT, p_league_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT r.user_id FROM (
    SELECT p.id AS user_id
    FROM public.profiles p
    WHERE p_audience = 'all_users'
      AND p.username !~ '^[a-z0-9]+(-[a-z0-9]+)*-ai$'   -- the reserved AI-account form (025 / guard_username_namespace)
    UNION
    SELECT m.user_id
    FROM public.league_members m
    JOIN public.leagues l ON l.id = m.league_id AND l.deleted_at IS NULL
    WHERE p_audience = 'all_league_members'
      AND m.user_id IS NOT NULL
    UNION
    SELECT m.user_id
    FROM public.league_members m
    WHERE p_audience = 'league'
      AND m.league_id = p_league_id
      AND m.user_id IS NOT NULL
  ) r
  ORDER BY r.user_id;
$$;
REVOKE ALL ON FUNCTION op_notice_recipients_internal(TEXT, UUID) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION op_notice_recipients_internal(TEXT, UUID) IS
  'M8 Q97 (migration 185): the distinct recipients of an operator notice — all_users (every profile except the ''…-ai'' AI-expert system accounts), all_league_members (every member of a non-deleted league), or league (one league''s members). PLAIN, REVOKEd.';

-- ---------------------------------------------------------------------------
-- 2. op_send_notification (TD10)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION op_send_notification_internal(
  p_audience  TEXT,
  p_league_id UUID,
  p_title     TEXT,
  p_body      TEXT,
  p_link      TEXT,
  p_channels  TEXT[],
  p_action_id UUID,
  p_reason    TEXT,
  p_at        TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  c_page     CONSTANT INTEGER := 1000;
  v_actor    UUID := auth.uid();
  v_replay   JSONB;
  v_ids      UUID[];
  v_total    INTEGER;
  v_written  INTEGER := 0;
  v_pages    INTEGER := 0;
  v_cnt      INTEGER;
  v_slice    UUID[];
  v_bad      TEXT;
  v_data     JSONB;
  v_after    JSONB;
BEGIN
  IF p_action_id IS NOT NULL THEN
    -- A concurrent replay of the same action id waits here, then finds the
    -- receipt in the prelude and writes nothing.
    PERFORM pg_advisory_xact_lock(hashtextextended('op_send_notification:' || p_action_id::text, 0));
  END IF;

  IF p_audience IS NULL OR p_audience NOT IN ('all_users', 'all_league_members', 'league') THEN
    RAISE EXCEPTION 'send_notification: audience must be all_users, all_league_members or league (got %)', p_audience
      USING ERRCODE = '22023';
  END IF;
  IF (p_audience = 'league') <> (p_league_id IS NOT NULL) THEN
    RAISE EXCEPTION 'send_notification: a league is named exactly when the audience is one league''s members'
      USING ERRCODE = '22023';
  END IF;

  v_replay := public.op_verb_prelude_internal('send_notification', p_league_id, p_action_id, p_reason);
  IF v_replay IS NOT NULL THEN
    -- R1557: a replay is the SAME notice. An action id reused for a
    -- different audience / league / text / link is refused, never answered
    -- with the earlier receipt as if the new notice had gone out.
    IF (v_replay ->> 'audience')  IS DISTINCT FROM p_audience
       OR (v_replay ->> 'league_id') IS DISTINCT FROM p_league_id::text
       OR (v_replay ->> 'title')     IS DISTINCT FROM p_title
       OR (v_replay ->> 'body')      IS DISTINCT FROM p_body
       OR (v_replay ->> 'link')      IS DISTINCT FROM p_link THEN
      RAISE EXCEPTION 'send_notification: action id % was already used for a different notice — nothing was sent', p_action_id
        USING ERRCODE = '22023';
    END IF;
    RETURN v_replay;
  END IF;

  IF p_at IS NULL THEN
    RAISE EXCEPTION 'send_notification: p_at is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  -- TD10: the channel set. Only the bell exists today.
  IF p_channels IS NULL OR cardinality(p_channels) = 0 THEN
    RAISE EXCEPTION 'send_notification: choose at least one channel — today only in_app (the bell)'
      USING ERRCODE = '22023';
  END IF;
  SELECT c INTO v_bad FROM unnest(p_channels) c WHERE c IS DISTINCT FROM 'in_app' LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'send_notification: channel "%" is not available — notices go to the in-app bell only; email and push are not built (Q97)', v_bad
      USING ERRCODE = '22023';
  END IF;

  IF p_title IS NULL OR length(btrim(p_title, E' \t\r\n')) = 0 OR length(p_title) > 120 THEN
    RAISE EXCEPTION 'send_notification: a title is required, at most 120 characters' USING ERRCODE = '22023';
  END IF;
  IF p_body IS NOT NULL AND (length(btrim(p_body, E' \t\r\n')) = 0 OR length(p_body) > 2000) THEN
    RAISE EXCEPTION 'send_notification: the message is optional, but when given it is non-blank and at most 2000 characters'
      USING ERRCODE = '22023';
  END IF;
  IF p_link IS NOT NULL AND (length(p_link) > 500 OR p_link !~ '^/([^/\\[:space:]][^\\[:space:]]*)?$') THEN
    RAISE EXCEPTION 'send_notification: a link must be a page inside FieldScout, starting with a single "/" (got %)', p_link
      USING ERRCODE = '22023';
  END IF;

  v_ids := ARRAY(SELECT public.op_notice_recipients_internal(p_audience, p_league_id));
  v_total := COALESCE(cardinality(v_ids), 0);
  IF v_total = 0 THEN
    RAISE EXCEPTION 'send_notification: this audience has no recipients — nothing was sent'
      USING ERRCODE = 'P0002';
  END IF;

  v_after := jsonb_build_object(
    'changed', TRUE, 'audience', p_audience, 'league_id', p_league_id,
    'channels', to_jsonb(ARRAY['in_app']), 'recipients', v_total,
    'pages', ((v_total + c_page - 1) / c_page),
    'title', p_title, 'body', p_body, 'link', p_link, 'sent_at', p_at);

  -- The receipt first: a racing duplicate meets action_id UNIQUE, not a
  -- second set of rows.
  PERFORM public.log_operator_action_internal(p_action_id, v_actor, 'send_notification',
    CASE WHEN p_audience = 'league' THEN 'league' ELSE 'platform' END, p_league_id, p_reason,
    jsonb_build_object('recipients', 0), v_after);

  v_data := jsonb_strip_nulls(jsonb_build_object(
    'from', 'fieldscout', 'action_id', p_action_id, 'audience', p_audience, 'channel', 'in_app',
    'league_id', p_league_id, 'link', p_link));

  -- Pages of 1000 — each asserts its own count; never silently capped.
  WHILE v_written < v_total LOOP
    v_slice := v_ids[v_written + 1 : v_written + c_page];
    INSERT INTO public.notifications (user_id, type, title, body, data, read, created_at)
    SELECT u, 'operator_notice', p_title, p_body, v_data, FALSE, p_at
    FROM unnest(v_slice) u;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> cardinality(v_slice) THEN
      RAISE EXCEPTION 'send_notification: page % wrote % notifications, expected %', v_pages + 1, v_cnt, cardinality(v_slice)
        USING ERRCODE = 'P0001';
    END IF;
    v_written := v_written + v_cnt;
    v_pages := v_pages + 1;
  END LOOP;
  IF v_written <> v_total OR v_pages <> (v_after ->> 'pages')::int THEN
    RAISE EXCEPTION 'send_notification: wrote % notifications in % pages, expected % in %', v_written, v_pages, v_total, v_after ->> 'pages'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_audience = 'league' THEN
    PERFORM public.op_league_line_internal(p_league_id,
      'FieldScout sent this league a notice: "' || p_title || '"');
  END IF;

  RETURN v_after;
END;
$$;
REVOKE ALL ON FUNCTION op_send_notification_internal(TEXT, UUID, TEXT, TEXT, TEXT, TEXT[], UUID, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION op_send_notification_internal(TEXT, UUID, TEXT, TEXT, TEXT, TEXT[], UUID, TEXT, TIMESTAMPTZ) IS
  'M8 TD10 / Q97 (migration 185): the body of op_send_notification at an injected instant. PLAIN, REVOKEd — reached through the door and the tests only.';

CREATE OR REPLACE FUNCTION op_send_notification(
  p_audience  TEXT,
  p_title     TEXT,
  p_body      TEXT    DEFAULT NULL,
  p_link      TEXT    DEFAULT NULL,
  p_league_id UUID    DEFAULT NULL,
  p_channels  TEXT[]  DEFAULT ARRAY['in_app'],
  p_action_id UUID    DEFAULT NULL,
  p_reason    TEXT    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'send_notification: only a platform operator can send a notice (M8 TD1)' USING ERRCODE = '42501';
  END IF;
  RETURN public.op_send_notification_internal(p_audience, p_league_id, p_title, p_body, p_link, p_channels,
    p_action_id, p_reason, now());
END;
$$;
REVOKE ALL ON FUNCTION op_send_notification(TEXT, TEXT, TEXT, TEXT, UUID, TEXT[], UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION op_send_notification(TEXT, TEXT, TEXT, TEXT, UUID, TEXT[], UUID, TEXT) TO authenticated;
COMMENT ON FUNCTION op_send_notification(TEXT, TEXT, TEXT, TEXT, UUID, TEXT[], UUID, TEXT) IS
  'M8 §24.4 (migration 185, TD10 / Q97 / Q101): send a hand-written notice to all_users, all_league_members or one league. Channel in_app only (email / push not built). Operators only (in-body gate); idempotent on p_action_id; zero recipients refuses (P0002); notifications written in pages of 1000; one platform_operator_actions receipt with the recipient count; a league send also posts a "FieldScout" league line.';

-- ---------------------------------------------------------------------------
-- 3. notifications: a user may only mark their own rows read (R1558)
-- ---------------------------------------------------------------------------
REVOKE UPDATE ON TABLE notifications FROM anon, authenticated;
GRANT UPDATE (read) ON TABLE notifications TO authenticated;
