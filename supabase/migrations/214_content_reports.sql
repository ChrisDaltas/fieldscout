-- ============================================================================
-- 214 — content reports (Community launch plan C9; readiness S3;
--       FULL rigour — permissions)
-- ============================================================================
--
-- Chris's go 2026-10-29 ("go on all of Community"), on the Community launch
-- plan (2026-10-27) and its defaults ("go with your recommendations on the
-- rest"): a simple Report — optional reasons Spam / Abusive / Something
-- else, a limit of 10 reports an hour, one bell alert for new reports,
-- review in desktop Admin, start/sit questions reportable too, and an Admin
-- Remove for comments that marks the report reviewed by whoever removed it
-- (plan correction 12).
--
-- PART 1 — `content_reports`. One row per (reporter, thing reported):
--     reporter_id   who reported it (ON DELETE CASCADE with his account)
--     target_type   'list' | 'comment' | 'start_sit'
--     target_id     the list / comment / start-sit question's id (no FK — it
--                   points at one of three tables)
--     list_id       the list (for a list: itself; for a comment: its list;
--                   NULL for a start-sit question) — NO foreign key, on
--                   purpose (182's league_id reasoning): a report is the
--                   moderation record and must OUTLIVE what it reports. A
--                   list's owner can still hard-delete his own list today
--                   (001's FOR ALL policy; C2's review filed it for C11), and
--                   a CASCADE would erase the reports with it; SET NULL
--                   would break the list-matches-target CHECK and so block
--                   the delete. The id stays as a fact; Admin › Reports
--                   shows "no longer there".
--     reason        optional: 'spam' | 'abusive' | 'other' (Something else)
--     note          optional, at most 500 characters, never blank
--     created_at    when it was reported
--     reviewed_at / reviewed_by   when, and by which admin, it was reviewed —
--                   both or neither; stamped ONCE and never changed
--   UNIQUE (reporter_id, target_type, target_id): a person reports a thing
--   once. RLS ON with NO policy: anon / authenticated read no row and write
--   none (the D18 → D23 doctrine — RLS is the gate; the seven API-role
--   table grants stay, pgTAP 081 C3), TRUNCATE revoked by name (133). Nobody
--   reads reports from a client: Admin › Reports (C10) reads them with the
--   service role after `requireAdminUser`.
--   `content_reports_write_once_internal()` — BEFORE UPDATE, ENABLE ALWAYS:
--   a report is never edited; the only change is its review stamp, from
--   none to (when, who), once. Holds for the service role and the table
--   owner too, so the stamp — the record of who dealt with a report — can't
--   be rewritten. DELETE stays open to the server (the Preview walk-through's
--   test reports are deleted afterwards — switch-on step 3).
--
-- PART 2 — `report_content(p_target_type, p_target_id, p_reason, p_note)` —
--   SECURITY DEFINER, search_path '', in-body gate:
--     * signed in (42501 otherwise);
--     * the type, reason and note are checked (22023 / 22001), a blank note
--       is no note;
--     * the target must be VISIBLE to the caller — a definer skips RLS, so
--       the read rules are replicated here (newest definitions: lists 001 +
--       067, list_comments 213, start_sit_questions 001):
--         list       live (deleted_at NULL) and public, or private but
--                    shared with a league the caller belongs to (067); the
--                    owner's own (incl. soft-deleted) is caught as his own;
--         comment    live (213: a removed comment is hidden from every
--                    reader) and on a live public list with comments on, or
--                    on a list the caller owns (001's owner branch);
--         start_sit  any question (001: "Start or Sit questions are public").
--                    The Ask plan (A2) extends start_sit_questions in place;
--                    when it gives a question a removal or tighter reads, it
--                    re-creates this function from this file with that rule;
--       anything else — missing, private, removed, on a list the caller
--       can't see — gets ONE answer, P0002 "That isn't there to report", so
--       a report never reveals whether hidden content exists;
--     * and not the caller's own (42501, by name);
--     * a REPEAT report (the same person, the same thing) does nothing: no
--       second row, no allowance spent, no alert — and answers
--       `already_reported` (not an error) with the first report's id;
--     * otherwise one 'report' hit (213's bucket: 10 per hour, scope = the
--       person's own id, through `rate_limit_take_internal`); over the limit
--       it is refused with SQLSTATE 'PGRST' and PostgREST's envelope — HTTP
--       429, Retry-After, the reason in plain words and
--       `retry_after_seconds=<n>` in `details` (213's comment-guard shape) —
--       and nothing is written;
--     * the report is written and every admin (profiles.is_admin, 182's
--       operator switch) except the reporter gets the bell alert
--       `content_report` "New reports to review", data { link:
--       '/app/admin/reports' } — at most ONE unread per admin: while his
--       alert is unread a new report refreshes its time instead of adding
--       another (077's pattern; a transaction-scoped advisory lock keeps two
--       reports at once from both inserting). No report text is copied into
--       the alert.
--   A per-reporter advisory lock serializes one person's reports, so the
--   repeat check, the allowance and the insert agree; the UNIQUE constraint
--   is the backstop (a loud 23505, never a second row).
--   Answers { status: 'reported' | 'already_reported', report_id,
--   target_type, target_id, reported_at }.
--
-- PART 3 — `mark_content_report_reviewed(p_report_id)` — SECURITY DEFINER,
--   search_path '', for C10's "Mark reviewed": platform operators only
--   (`is_platform_operator()`, 182 — checked FIRST, so nobody else learns
--   whether a report id exists; 42501). A missing report is P0002. An open
--   report is stamped (now, the caller) and the change written to the
--   operator audit (182's "one row per operator change": verb
--   review_content_report, scope platform, ids + the stamp, never the note);
--   a report already reviewed is left exactly as it is and answers
--   `already_reviewed` with its original stamp — no write, no audit row.
--   Answers { status: 'reviewed' | 'already_reviewed', report_id,
--   reviewed_at, reviewed_by }.
--
-- PART 4 — `remove_list_comment` (213, C2's operator permission) re-created
--   from 213 — the NEWEST and only definition (grep -l remove_list_comment
--   supabase/migrations → 213 only; 210 and 212 define none of this file's
--   objects) — with ONE addition: when the removal is made AS an admin
--   (C2's operator permission, removed_as 'operator': the comment is neither
--   his nor on his list), every open report on that comment is stamped
--   reviewed by him at the removal's instant, in the same transaction (plan
--   correction 12: Remove "marks the report reviewed, with who and when").
--   That operator's audit row (213) carries `metadata.reports_reviewed` (the
--   count), and his answer gains `reports_reviewed`. A removal made as the
--   comment's author or the list's owner stamps nothing — an admin's
--   included — so the person reported is never recorded as the reviewer of
--   the reports against him, and every stamp has its audit row; those
--   reports stay open for Mark reviewed. Everything else — the gate, the
--   refusals and their words, the author / list-owner answers (pgTAP 163 R7
--   golden; 164 M1 / M2 / M4 / M4b), the audit row's before / after — is
--   213's, byte for byte, for every caller.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4):
--   * D137 — newest definitions: remove_list_comment 213 (only definer);
--     the visibility rules replicated from lists 001:628-635 + 067:130-139,
--     list_comments 213 PART 2, start_sit_questions 001:745-746; the
--     'report' bucket is 213's (rate_limit_rule_internal, untouched here).
--     Objects 210 / 212 define (notify_list_followers, guard_profile_*,
--     storage limits, profiles' column grants, the league archive) are not
--     touched.
--   * New table with RLS on in the same migration and NO policy; TRUNCATE
--     revoked by name. The UNIQUE leads with reporter_id (serves that FK);
--     list_id (no FK, by design) has its own index for Admin › Reports;
--     reviewed_by (an FK to profiles, NO ACTION like 182's actor_id) is
--     indexed for the FK check.
--   * SECURITY DEFINER: report_content, mark_content_report_reviewed and
--     remove_list_comment (in-body gates, REVOKE PUBLIC / anon, EXECUTE
--     authenticated), all search_path '' with every name schema-qualified.
--     The write-once trigger function is PLAIN, search_path '', REVOKEd from
--     PUBLIC / anon / authenticated (triggers need no EXECUTE to fire).
--     The operator branches call 182's PLAIN seam
--     `log_operator_action_internal` (unchanged; it re-checks the actor).
--   * notifications has no type CHECK (measured, as in 213), so the new
--     `content_report` type needs no constraint change.
--   * R6 / D38 waivers: none needed — no league table, no realtime, no
--     stored row changes meaning.
--   * Deploy before push: nothing in the app calls these yet except the
--     `reportContent` helper (src/lib/community/report-content.ts), which
--     answers "Reporting isn't available yet" while report_content is missing
--     (PGRST202 naming it — `isDoorNotPushed`); C10's UI is built on it. The
--     DELETE comment route reads only remove_list_comment's error, so its
--     wider operator answer changes nothing there.
--   * Rollback (hand-written, local): re-create remove_list_comment from
--     213's body; DROP the two RPCs, the table (its trigger goes with it)
--     and the trigger function; delete the 'content_report' alerts and the
--     'report' bucket's rate_limit_hits rows. (An operator's
--     review_content_report audit row is append-only by 182's design and
--     stays — a record, not schema.)
-- pgTAP 164_content_reports.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PART 1 — the table (server-owned; nobody reads it from a client)
-- ---------------------------------------------------------------------------
CREATE TABLE public.content_reports (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type TEXT        NOT NULL,
  target_id   UUID        NOT NULL,   -- a list, comment or start-sit question id (never an FK: one of three tables)
  list_id     UUID,                   -- the list's id (NO FK: the report outlives the list — banner)
  reason      TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID        REFERENCES public.profiles(id),
  CONSTRAINT content_reports_target_type_known
    CHECK (target_type IN ('list', 'comment', 'start_sit')),
  CONSTRAINT content_reports_reason_known
    CHECK (reason IS NULL OR reason IN ('spam', 'abusive', 'other')),
  CONSTRAINT content_reports_note_shape
    CHECK (note IS NULL OR (char_length(note) <= 500 AND length(btrim(note, E' \t\r\n')) > 0)),
  CONSTRAINT content_reports_list_matches_target
    CHECK ((target_type = 'start_sit') = (list_id IS NULL)
           AND (target_type <> 'list' OR list_id = target_id)),
  CONSTRAINT content_reports_review_pair
    CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL)),
  CONSTRAINT content_reports_once_per_target
    UNIQUE (reporter_id, target_type, target_id)
);

COMMENT ON TABLE public.content_reports IS
  '214 (Community C9): what people report — a list, a comment or a start/sit question — one row per '
  '(reporter, thing), optional reason (spam / abusive / other) and note (<= 500). Server-owned: RLS on '
  'with no policy (no client reads or writes); written only by report_content(); review stamped once by '
  'mark_content_report_reviewed() or an operator''s remove_list_comment(). Admin › Reports reads it with '
  'the service role.';
COMMENT ON COLUMN public.content_reports.target_id IS
  '214: the reported list / comment / start_sit_questions id, by target_type. No FK (three tables, and a report outlives what it reports).';
COMMENT ON COLUMN public.content_reports.list_id IS
  '214: the list the report is about — the list itself, or the reported comment''s list; NULL for a start/sit question. '
  'No FK on purpose: a report outlives the list it reports (a hard-deleted list keeps its reports).';
COMMENT ON COLUMN public.content_reports.reviewed_by IS
  '214: the admin who reviewed it (Mark reviewed, or Remove on a comment) — with reviewed_at, stamped once and never changed.';

CREATE INDEX idx_content_reports_target   ON public.content_reports (target_type, target_id);
CREATE INDEX idx_content_reports_created  ON public.content_reports (created_at DESC, id DESC);
CREATE INDEX idx_content_reports_list     ON public.content_reports (list_id) WHERE list_id IS NOT NULL;
CREATE INDEX idx_content_reports_reviewer ON public.content_reports (reviewed_by) WHERE reviewed_by IS NOT NULL;

ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policy: with RLS on, anon / authenticated see no row and
-- write none (D18 → D23 — RLS is the gate; the seven API-role table grants
-- stay, pgTAP 081 C3). TRUNCATE is not gated by RLS, so it is revoked by
-- name (133). The definer RPCs below are the only writers. Do not add a
-- policy: a report is never readable by anyone it is about, nor by the
-- reporter's browser.
REVOKE TRUNCATE ON TABLE public.content_reports FROM PUBLIC, anon, authenticated;

-- A report is never edited; its review is stamped once (none → when + who).
CREATE FUNCTION public.content_reports_write_once_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (NEW.id, NEW.reporter_id, NEW.target_type, NEW.target_id, NEW.list_id, NEW.reason, NEW.note, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.reporter_id, OLD.target_type, OLD.target_id, OLD.list_id, OLD.reason, OLD.note, OLD.created_at) THEN
    RAISE EXCEPTION 'A report is never edited — only its review is stamped, once.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.reviewed_at IS NOT NULL
     AND (NEW.reviewed_at, NEW.reviewed_by) IS DISTINCT FROM (OLD.reviewed_at, OLD.reviewed_by) THEN
    RAISE EXCEPTION 'This report was already reviewed — its review is never changed.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.content_reports_write_once_internal() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.content_reports_write_once_internal() IS
  '214 (Community C9): BEFORE UPDATE on content_reports, ENABLE ALWAYS — a report is never edited; its review '
  '(reviewed_at + reviewed_by) is stamped once and never changed, for every role (the stamp is the record of '
  'who dealt with it).';

CREATE TRIGGER trg_content_reports_write_once
  BEFORE UPDATE ON public.content_reports
  FOR EACH ROW EXECUTE FUNCTION public.content_reports_write_once_internal();
ALTER TABLE public.content_reports ENABLE ALWAYS TRIGGER trg_content_reports_write_once;

-- ---------------------------------------------------------------------------
-- PART 2 — report_content: the one way a report is made
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.report_content(
  p_target_type TEXT,
  p_target_id   UUID,
  p_reason      TEXT DEFAULT NULL,
  p_note        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_note     TEXT := NULLIF(btrim(p_note, E' \t\r\n'), '');
  v_owner    UUID;
  v_list_id  UUID;
  v_visible  BOOLEAN := FALSE;
  v_existing RECORD;
  v_take     JSONB;
  v_secs     INTEGER;
  v_wait     TEXT;
  v_id       UUID;
  v_at       TIMESTAMPTZ := now();
  v_admin    UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to report something.' USING ERRCODE = '42501';
  END IF;
  IF p_target_type IS NULL OR p_target_type NOT IN ('list', 'comment', 'start_sit') THEN
    RAISE EXCEPTION 'Only lists, comments and start/sit questions can be reported.' USING ERRCODE = '22023';
  END IF;
  IF p_target_id IS NULL THEN
    RAISE EXCEPTION 'That isn''t there to report — it may have been removed.' USING ERRCODE = 'P0002';
  END IF;
  IF p_reason IS NOT NULL AND p_reason NOT IN ('spam', 'abusive', 'other') THEN
    RAISE EXCEPTION 'Pick Spam, Abusive or Something else — or leave the reason out.' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'Keep the note to 500 characters or fewer.' USING ERRCODE = '22001';
  END IF;

  -- One person's reports serialize here, so the repeat check, the allowance
  -- and the insert below agree (two taps at once make one report).
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('content_report:' || v_uid::TEXT, 0));

  -- The target, and whether the CALLER can see it. A definer skips RLS, so
  -- the read rules are replicated here (see the banner); a row the caller
  -- can't see is treated exactly like a row that doesn't exist.
  IF p_target_type = 'list' THEN
    SELECT l.owner_id, l.id,
           (l.owner_id = v_uid)
           OR (l.deleted_at IS NULL AND l.is_private = FALSE)
           OR (l.deleted_at IS NULL AND EXISTS (
                 SELECT 1 FROM public.league_lists ll
                 JOIN public.league_members m ON m.league_id = ll.league_id AND m.user_id = v_uid
                 WHERE ll.list_id = l.id AND ll.shared_with_league = TRUE))
      INTO v_owner, v_list_id, v_visible
    FROM public.lists l
    WHERE l.id = p_target_id;
  ELSIF p_target_type = 'comment' THEN
    SELECT c.author_id, c.list_id,
           c.deleted_at IS NULL
           AND ((l.is_private = FALSE AND l.comments_enabled = TRUE AND l.deleted_at IS NULL)
                OR l.owner_id = v_uid)
      INTO v_owner, v_list_id, v_visible
    FROM public.list_comments c
    JOIN public.lists l ON l.id = c.list_id
    WHERE c.id = p_target_id;
  ELSE
    SELECT q.poster_id, NULL::UUID, TRUE
      INTO v_owner, v_list_id, v_visible
    FROM public.start_sit_questions q
    WHERE q.id = p_target_id;
  END IF;

  IF NOT FOUND OR NOT COALESCE(v_visible, FALSE) THEN
    RAISE EXCEPTION 'That isn''t there to report — it may have been removed.' USING ERRCODE = 'P0002';
  END IF;
  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'You can''t report your own %.',
      CASE p_target_type WHEN 'list' THEN 'list' WHEN 'comment' THEN 'comment' ELSE 'question' END
      USING ERRCODE = '42501';
  END IF;

  -- A repeat report does nothing: no second row, no allowance, no alert.
  SELECT r.id, r.created_at INTO v_existing
  FROM public.content_reports r
  WHERE r.reporter_id = v_uid AND r.target_type = p_target_type AND r.target_id = p_target_id;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'already_reported', 'report_id', v_existing.id,
      'target_type', p_target_type, 'target_id', p_target_id, 'reported_at', v_existing.created_at);
  END IF;

  -- 10 reports an hour, per person (213's 'report' bucket).
  v_take := public.rate_limit_take_internal(v_uid, 'report', v_uid, v_at);
  IF NOT (v_take ->> 'allowed')::BOOLEAN THEN
    v_secs := GREATEST(1, CEIL((v_take ->> 'retry_after_ms')::NUMERIC / 1000)::INTEGER);
    v_wait := CASE
      WHEN v_secs < 60 THEN v_secs || CASE WHEN v_secs = 1 THEN ' second' ELSE ' seconds' END
      ELSE CEIL(v_secs / 60.0)::INTEGER || CASE WHEN CEIL(v_secs / 60.0)::INTEGER = 1 THEN ' minute' ELSE ' minutes' END
    END;
    -- PostgREST's raise-your-own-response envelope: HTTP 429 + Retry-After.
    RAISE SQLSTATE 'PGRST' USING
      MESSAGE = pg_catalog.json_build_object(
        'code', 'rate_limited',
        'message', 'You''ve sent a lot of reports — you can report again in ' || v_wait || '.',
        'details', 'retry_after_seconds=' || v_secs,
        'hint', NULL)::TEXT,
      DETAIL = pg_catalog.json_build_object(
        'status', 429,
        'status_text', 'Too Many Requests',
        'headers', pg_catalog.json_build_object('Retry-After', v_secs::TEXT))::TEXT;
  END IF;

  INSERT INTO public.content_reports (reporter_id, target_type, target_id, list_id, reason, note, created_at)
  VALUES (v_uid, p_target_type, p_target_id, v_list_id, p_reason, v_note, v_at)
  RETURNING id INTO v_id;

  -- The admins' bell: one unread "New reports to review" each at most —
  -- while it is unread a new report refreshes its time. Never the reporter's
  -- own bell. Two reports at once serialize here.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('content_report_notify', 0));
  FOR v_admin IN
    SELECT p.id FROM public.profiles p WHERE p.is_admin AND p.id <> v_uid ORDER BY p.id
  LOOP
    UPDATE public.notifications n
       SET created_at = v_at
     WHERE n.user_id = v_admin AND n.type = 'content_report' AND n.read = FALSE;
    IF NOT FOUND THEN
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (v_admin, 'content_report', 'New reports to review', NULL,
              pg_catalog.jsonb_build_object('link', '/app/admin/reports'));
    END IF;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'reported', 'report_id', v_id,
    'target_type', p_target_type, 'target_id', p_target_id, 'reported_at', v_at);
END;
$$;

REVOKE ALL ON FUNCTION public.report_content(TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_content(TEXT, UUID, TEXT, TEXT) TO authenticated;
COMMENT ON FUNCTION public.report_content(TEXT, UUID, TEXT, TEXT) IS
  '214 (Community C9): report a list, comment or start/sit question (optional reason spam / abusive / other, '
  'optional note <= 500). Signed in; the target must be visible to the caller (the read rules replicated — '
  'anything hidden or missing is one P0002) and not his own (42501). A repeat report answers already_reported '
  'and does nothing. Spends one "report" hit (10 an hour, 429 + Retry-After beyond); alerts each admin once '
  '(one unread "New reports to review" at a time).';

-- ---------------------------------------------------------------------------
-- PART 3 — mark_content_report_reviewed: Admin › Reports' "Mark reviewed"
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.mark_content_report_reviewed(p_report_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_report RECORD;
  v_at     TIMESTAMPTZ := now();
BEGIN
  IF v_uid IS NULL OR NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'Only FieldScout admins can review reports.' USING ERRCODE = '42501';
  END IF;

  SELECT r.id, r.target_type, r.target_id, r.list_id, r.reviewed_at, r.reviewed_by INTO v_report
  FROM public.content_reports r
  WHERE r.id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That report isn''t there.' USING ERRCODE = 'P0002';
  END IF;

  -- Already reviewed: left exactly as it is, and said so (no write, no audit row).
  IF v_report.reviewed_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'already_reviewed', 'report_id', v_report.id,
      'reviewed_at', v_report.reviewed_at, 'reviewed_by', v_report.reviewed_by);
  END IF;

  UPDATE public.content_reports r
     SET reviewed_at = v_at, reviewed_by = v_uid
   WHERE r.id = p_report_id AND r.reviewed_at IS NULL;
  IF NOT FOUND THEN
    -- Unreachable under the lock above; never answer "reviewed" for nothing.
    RAISE EXCEPTION 'That report wasn''t marked reviewed — refresh and try again.' USING ERRCODE = 'P0001';
  END IF;

  -- One operator-audit row per operator change (182). Ids and the stamp only.
  PERFORM public.log_operator_action_internal(
    pg_catalog.gen_random_uuid(), v_uid, 'review_content_report', 'platform', NULL, NULL,
    pg_catalog.jsonb_build_object('report_id', v_report.id, 'target_type', v_report.target_type,
                                  'target_id', v_report.target_id, 'list_id', v_report.list_id,
                                  'reviewed_at', NULL, 'reviewed_by', NULL),
    pg_catalog.jsonb_build_object('report_id', v_report.id, 'target_type', v_report.target_type,
                                  'target_id', v_report.target_id, 'list_id', v_report.list_id,
                                  'reviewed_at', v_at, 'reviewed_by', v_uid));

  RETURN pg_catalog.jsonb_build_object(
    'status', 'reviewed', 'report_id', v_report.id, 'reviewed_at', v_at, 'reviewed_by', v_uid);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_content_report_reviewed(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_content_report_reviewed(UUID) TO authenticated;
COMMENT ON FUNCTION public.mark_content_report_reviewed(UUID) IS
  '214 (Community C9, for C10''s Admin › Reports): stamp one report reviewed by the calling platform operator, '
  'now. Operators only (42501, checked first); a missing report is P0002; an already-reviewed one is left as it '
  'is and answers already_reviewed. A stamp writes one platform_operator_actions row (verb review_content_report).';

-- ---------------------------------------------------------------------------
-- PART 4 — remove_list_comment (213's body + the operator's report stamp)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_list_comment(p_list_id UUID, p_comment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_author   UUID;
  v_owner    UUID;
  v_as       TEXT;
  v_at       TIMESTAMPTZ := now();
  v_rows     INTEGER;
  v_reviewed INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to remove a comment.' USING ERRCODE = '42501';
  END IF;

  -- Lock the comment so two removers cannot both "remove" it.
  SELECT c.author_id INTO v_author
  FROM public.list_comments c
  WHERE c.id = p_comment_id AND c.list_id = p_list_id AND c.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That comment isn''t there — it may already have been removed.' USING ERRCODE = 'P0002';
  END IF;

  SELECT l.owner_id INTO v_owner FROM public.lists l WHERE l.id = p_list_id;

  v_as := CASE
    WHEN v_author = v_uid THEN 'author'
    WHEN v_owner = v_uid THEN 'list_owner'
    WHEN public.is_platform_operator() THEN 'operator'
  END;
  IF v_as IS NULL THEN
    RAISE EXCEPTION 'You can only remove your own comments, or comments on your own list.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.list_comments c
     SET deleted_at = v_at,
         updated_at = v_at
   WHERE c.id = p_comment_id AND c.deleted_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    -- Unreachable under the lock above; never answer "removed" for nothing.
    RAISE EXCEPTION 'That comment isn''t there — it may already have been removed.' USING ERRCODE = 'P0002';
  END IF;

  -- 214 (C9): a removal made AS an admin (C2's operator permission — the
  -- comment is neither his nor on his list) is his review of every open
  -- report on that comment, stamped with who and when in this same
  -- transaction, and logged just below (plan correction 12). A removal made
  -- as the comment's author or the list's owner stamps none — even when that
  -- person is an admin — so the person reported is never recorded as the one
  -- who reviewed the reports against him, and no stamp is ever written
  -- without its operator-audit row. Those reports stay open for Mark
  -- reviewed (which logs every review).
  IF v_as = 'operator' THEN
    UPDATE public.content_reports r
       SET reviewed_at = v_at, reviewed_by = v_uid
     WHERE r.target_type = 'comment' AND r.target_id = p_comment_id AND r.reviewed_at IS NULL;
    GET DIAGNOSTICS v_reviewed = ROW_COUNT;

    -- An operator's removal is an operator change: one platform_operator_actions
    -- row (182's doctrine), however it was reached — Admin › Reports or a plain
    -- call, reported or not. Ids and the instant only; never the comment's text.
    -- The author's and the list owner's own removals write none (213).
    PERFORM public.log_operator_action_internal(
      pg_catalog.gen_random_uuid(), v_uid, 'remove_list_comment', 'platform', NULL, NULL,
      pg_catalog.jsonb_build_object('comment_id', p_comment_id, 'list_id', p_list_id,
                                    'author_id', v_author, 'deleted_at', NULL),
      pg_catalog.jsonb_build_object('comment_id', p_comment_id, 'list_id', p_list_id,
                                    'author_id', v_author, 'deleted_at', v_at),
      pg_catalog.jsonb_build_object('reports_reviewed', v_reviewed));

    RETURN pg_catalog.jsonb_build_object(
      'comment_id', p_comment_id, 'list_id', p_list_id, 'removed_at', v_at, 'removed_as', v_as,
      'reports_reviewed', v_reviewed);
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'comment_id', p_comment_id, 'list_id', p_list_id, 'removed_at', v_at, 'removed_as', v_as);
END;
$$;

-- CREATE OR REPLACE keeps 213's ACL (REVOKE PUBLIC / anon, EXECUTE
-- authenticated); restated so this file alone shows it.
REVOKE ALL ON FUNCTION public.remove_list_comment(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_list_comment(UUID, UUID) TO authenticated;
COMMENT ON FUNCTION public.remove_list_comment(UUID, UUID) IS
  '213 (Community C2): remove (soft-delete) one live comment on a list — its author, the list''s owner, '
  'or a platform operator. Raises P0002 when there is no such live comment and 42501 when it is not the '
  'caller''s to remove; never answers done for nothing. The only way a comment changes (client UPDATE is revoked). '
  'An operator''s removal writes one platform_operator_actions row (verb remove_list_comment; ids only, no text). '
  '214 (C9): an operator''s removal (removed_as operator) also stamps every open report on the comment reviewed by '
  'him at the removal''s instant (answer and audit metadata: reports_reviewed); a removal as author or list owner '
  'stamps none, an admin''s included.';
