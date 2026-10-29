-- ============================================================================
-- 213 — comment rules (Community launch plan C2; readiness S2, S4, S15;
--       FULL rigour — permissions)
-- ============================================================================
--
-- Chris's go 2026-10-29 ("go on all of Community"), on the Community launch
-- plan (2026-10-27) and its defaults ("go with your recommendations on the
-- rest"): 5 comments a minute; reports 10 an hour; questions 10 an hour.
--
-- PART 1 — REMOVING A COMMENT (S2). Until now a client could UPDATE
--   list_comments through two policies with no WITH CHECK and no column
--   limit: a list owner could rewrite anyone's comment on his list (even who
--   it appears to be from); an author could edit his comment with no mark,
--   backdate it, move it to another list, or bring back a removed one.
--     * `remove_list_comment(p_list_id, p_comment_id)` — SECURITY DEFINER,
--       search_path '', in-body gate: signed in; the comment exists on that
--       list and is live; the caller is its author, the list's owner, or a
--       platform operator (`is_platform_operator()`, 182). Anything else
--       RAISES — a missing / already-removed comment P0002, someone else's
--       42501 — so "nothing was removed" is never answered as done. It sets
--       `deleted_at` (and `updated_at`) and nothing else, and answers who
--       removed it (author / list_owner / operator). An OPERATOR's removal
--       also writes one `platform_operator_actions` row (182's "one row per
--       operator change", through `log_operator_action_internal`; verb
--       remove_list_comment, scope platform, ids + the instant, never the
--       text), so it is on record however it was reached — not only when C10
--       stamps a report reviewed (plan correction 12 keeps that stamp too).
--     * Client UPDATE on list_comments is REVOKEd from anon and
--       authenticated, so the RPC is the only way a comment changes. The two
--       001 UPDATE policies are left in place (inert without the grant —
--       pgTAP 118's policy census names them; their COMMENTs say so).
--     * No client DELETE either: the grant stays (D23 — RLS is the gate)
--       and there is no DELETE policy, so a hard delete was and is refused.
--
-- PART 2 — READING (S2). A removed comment is hidden from EVERY reader: the
--   001 SELECT policy is re-created with `deleted_at IS NULL` in front of its
--   two branches (public list with comments on / the list's owner), which are
--   otherwise unchanged. The service role (admin pages) still reads them.
--
-- PART 3 — RATE LIMITS (S4; plan correction 3). 209's limiter gains three
--   buckets, keyed by the PERSON (scope = the user's own id):
--       comment   5 per 60 000 ms      (the agreed 5 a minute)
--       report   10 per 3 600 000 ms   (C9's report_content spends it)
--       ask      10 per 3 600 000 ms   (the start/sit ask RPC spends it)
--   Only the bucket CHECK and `rate_limit_rule_internal` change (209's
--   numbers byte-unchanged). The client-callable door `rate_limit_take` is
--   NOT touched: it still spends only 'mutation' | 'bid' in a league or
--   draft the caller belongs to, so nobody can drain someone's comment,
--   report or ask allowance from outside (the rule pgTAP 159 K6b pins for
--   chat). The new buckets are spent only inside definer bodies through
--   `rate_limit_take_internal`.
--     * `list_comment_insert_guard_internal()` — BEFORE INSERT on
--       list_comments, 209's chat-guard pattern (209 §5). A person's own
--       comment (auth.uid() = author_id — the only kind RLS lets a client
--       write) takes one 'comment' hit; over the limit the insert is refused
--       with SQLSTATE 'PGRST' and PostgREST's envelope: HTTP 429,
--       Retry-After, the reason in plain words, and
--       `retry_after_seconds=<n>` in `details` for the route to read. RLS
--       WITH CHECK runs after BEFORE triggers, so a comment RLS refuses rolls
--       its hit back with the statement. Service-role writes (no uid) are
--       never limited.
--       The same guard makes a new comment's server-owned columns honest:
--       `created_at` / `updated_at` are stamped now and `deleted_at` NULL, so
--       a client cannot post a backdated or pre-removed comment either. And
--       a reply's `parent_id` must be a LIVE comment on the SAME list (the
--       POST route's rule, which a direct PostgREST insert skipped): a
--       removed parent, one on another list or on a private list, and one
--       that does not exist all get the same 23503 "That comment isn't there
--       to reply to." — so it reveals nothing about hidden comments.
--
-- PART 4 — THE NEW-COMMENT ALERT (S15). `list_comment_notify_owner_
--   internal()` — AFTER INSERT on list_comments: the list's owner gets a
--   `list_comment` notification, "@x commented on <title>", data
--   { list_id, actor_id }. Not for his own comment; not for a comment that
--   is born removed. One unread alert per list (077's list_updated
--   pattern): a newer comment refreshes the unread one (title, actor, time)
--   instead of adding another; a transaction-scoped advisory lock per list
--   keeps two comments at the same instant from both inserting. No comment
--   text is copied into the notification, so a removed comment leaves no
--   copy behind. notifications has no type CHECK (measured), so no
--   constraint changes.
--
-- PART 5 — an index on list_comments (author_id, created_at): the comment
--   box reads the poster's own comments from the last minute to count down
--   before the server refuses, and author_id (an FK to profiles, ON DELETE
--   CASCADE) had no index.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4):
--   * D137 — newest definitions: list_comments' policies are 001's (only
--     001 and 003 touch the table; 003 only renamed a column and widened the
--     body CHECK). `rate_limit_rule_internal` and the bucket CHECK are 209's
--     (the only migration that defines them; grep -l rate_limit → 209 only).
--     210 and 212 define none of these objects.
--   * SECURITY DEFINER: the RPC (in-body gate, REVOKE PUBLIC / anon, EXECUTE
--     authenticated) and the two trigger functions (REVOKE ALL from PUBLIC /
--     anon / authenticated — triggers need no EXECUTE to fire), all
--     search_path '' with every name schema-qualified. The RPC calls 182's
--     PLAIN seam `log_operator_action_internal` (unchanged; it re-checks the
--     actor is an operator) on its operator branch only.
--   * Grants: UPDATE on list_comments REVOKEd from anon and authenticated
--     (pgTAP 081 C3 names the two triples). No other grant changes.
--   * Additive otherwise: one RPC, two trigger functions + triggers, one
--     index; one policy re-created; one function body replaced (rule
--     table), one CHECK widened.
--   * Deploy before push: the DELETE route calls the RPC and, while it is
--     missing (PGRST202 naming it), falls back to today's UPDATE with a
--     row-count check; the POST route turns the 429 into a 429 with
--     Retry-After (absent before the push — nothing refuses); the comment
--     box counts the poster's own recent comments either way.
--   * R6 / D38 waivers: none needed — no league table, no realtime, no
--     stored row changes meaning (removed comments were already filtered by
--     every app read).
--   * Rollback (hand-written, local): DROP the two triggers, the three
--     functions and the index; GRANT UPDATE ON list_comments TO anon,
--     authenticated; re-create 001's SELECT policy; delete rate_limit_hits
--     rows in the new buckets; restore 209's CHECK and rule body; drop the
--     two policy COMMENTs. (An operator removal's platform_operator_actions
--     row is append-only by 182's design and stays — a record, not schema.)
-- pgTAP 163_comment_rules.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PART 3a — the buckets (209's CHECK and rule table, widened)
-- ---------------------------------------------------------------------------
ALTER TABLE public.rate_limit_hits DROP CONSTRAINT rate_limit_hits_bucket_known;
ALTER TABLE public.rate_limit_hits ADD CONSTRAINT rate_limit_hits_bucket_known
  CHECK (bucket IN ('chat', 'mutation', 'bid', 'comment', 'report', 'ask'));

COMMENT ON TABLE public.rate_limit_hits IS
  'L.F2.6 (migration 209, spec §22.5): per-user sliding-window rate-limit ledger — the instants of '
  'the most recent ACCEPTED hits per (user, bucket, scope), at most the bucket''s limit of them. '
  'Server-owned: written only by rate_limit_take_internal; no client reads or writes. '
  'Scope: a league or draft id (chat / mutation / bid); the person''s own id (comment / report / ask, 213).';

-- 209's body with three rows added; 209's three rows byte-unchanged.
CREATE OR REPLACE FUNCTION public.rate_limit_rule_internal(p_bucket TEXT)
RETURNS TABLE (max_hits INTEGER, window_ms INTEGER)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT r.max_hits, r.window_ms
  FROM (VALUES ('chat', 5, 10000), ('mutation', 10, 10000), ('bid', 5, 1000),
               ('comment', 5, 60000), ('report', 10, 3600000), ('ask', 10, 3600000))
       AS r(bucket, max_hits, window_ms)
  WHERE r.bucket = p_bucket
$$;

REVOKE ALL ON FUNCTION public.rate_limit_rule_internal(TEXT) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.rate_limit_rule_internal(TEXT) IS
  'L.F2.6 (migration 209, spec §22.5): the per-bucket limits — chat 5/10s, mutation 10/10s, bid 5/1s; '
  '213 (Community): comment 5/60s, report 10/hour, ask 10/hour, each per person. PLAIN, REVOKEd.';

-- ---------------------------------------------------------------------------
-- PART 1 — removing a comment: the RPC, and no client UPDATE
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.remove_list_comment(p_list_id UUID, p_comment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_author  UUID;
  v_owner   UUID;
  v_as      TEXT;
  v_at      TIMESTAMPTZ := now();
  v_rows    INTEGER;
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

  -- An operator's removal is an operator change: one platform_operator_actions
  -- row (182's doctrine), however it was reached — Admin › Reports or a plain
  -- call, reported or not. Ids and the instant only; never the comment's text.
  -- The author's and the list owner's own removals write none.
  IF v_as = 'operator' THEN
    PERFORM public.log_operator_action_internal(
      pg_catalog.gen_random_uuid(), v_uid, 'remove_list_comment', 'platform', NULL, NULL,
      pg_catalog.jsonb_build_object('comment_id', p_comment_id, 'list_id', p_list_id,
                                    'author_id', v_author, 'deleted_at', NULL),
      pg_catalog.jsonb_build_object('comment_id', p_comment_id, 'list_id', p_list_id,
                                    'author_id', v_author, 'deleted_at', v_at));
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'comment_id', p_comment_id, 'list_id', p_list_id, 'removed_at', v_at, 'removed_as', v_as);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_list_comment(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_list_comment(UUID, UUID) TO authenticated;
COMMENT ON FUNCTION public.remove_list_comment(UUID, UUID) IS
  '213 (Community C2): remove (soft-delete) one live comment on a list — its author, the list''s owner, '
  'or a platform operator. Raises P0002 when there is no such live comment and 42501 when it is not the '
  'caller''s to remove; never answers done for nothing. The only way a comment changes (client UPDATE is revoked). '
  'An operator''s removal writes one platform_operator_actions row (verb remove_list_comment; ids only, no text).';

REVOKE UPDATE ON TABLE public.list_comments FROM anon, authenticated;

COMMENT ON POLICY "Authors can soft-delete own comments" ON public.list_comments IS
  '001. Inert since 213: anon / authenticated hold no UPDATE on list_comments; removal goes through remove_list_comment().';
COMMENT ON POLICY "List owners can soft-delete any comment on their list" ON public.list_comments IS
  '001. Inert since 213: anon / authenticated hold no UPDATE on list_comments; removal goes through remove_list_comment().';

-- ---------------------------------------------------------------------------
-- PART 2 — a removed comment is hidden from every reader (001's policy +
--          `deleted_at IS NULL`; its two branches unchanged)
-- ---------------------------------------------------------------------------
DROP POLICY "Comments on public lists are viewable by everyone" ON public.list_comments;
CREATE POLICY "Comments on public lists are viewable by everyone"
  ON public.list_comments FOR SELECT USING (
    list_comments.deleted_at IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.lists
        WHERE lists.id = list_comments.list_id
        AND lists.is_private = FALSE
        AND lists.comments_enabled = TRUE
        AND lists.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.lists WHERE lists.id = list_comments.list_id AND lists.owner_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- PART 3b — the comment limit on the insert path (209 §5's pattern)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.list_comment_insert_guard_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_take JSONB;
  v_secs INTEGER;
BEGIN
  -- Only a person's own comment counts. Service-role writes (no uid) are
  -- never limited; a row naming someone else is RLS's to refuse (WITH CHECK
  -- auth.uid() = author_id) and spends nothing.
  IF v_uid IS NULL OR NEW.author_id IS DISTINCT FROM v_uid THEN
    RETURN NEW;
  END IF;

  -- Server-owned columns: a new comment is live, and posted now.
  NEW.created_at := now();
  NEW.updated_at := now();
  NEW.deleted_at := NULL;

  -- A reply answers a live comment on the SAME list — the route's rule, held
  -- here for a direct insert too: never a removed comment, nor one on another
  -- list (a private one included). One answer for every case, so it says
  -- nothing about whether a hidden comment exists. Checked before the hit is
  -- taken (a refused statement rolls its hit back either way).
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.list_comments p
       WHERE p.id = NEW.parent_id AND p.list_id = NEW.list_id AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'That comment isn''t there to reply to.' USING ERRCODE = '23503';
  END IF;

  v_take := public.rate_limit_take_internal(v_uid, 'comment', v_uid, now());
  IF (v_take ->> 'allowed')::BOOLEAN THEN
    RETURN NEW;
  END IF;

  v_secs := GREATEST(1, CEIL((v_take ->> 'retry_after_ms')::NUMERIC / 1000)::INTEGER);
  -- PostgREST's raise-your-own-response envelope: HTTP 429 + Retry-After.
  RAISE SQLSTATE 'PGRST' USING
    MESSAGE = pg_catalog.json_build_object(
      'code', 'rate_limited',
      'message', 'You''re commenting too fast — you can comment again in ' || v_secs ||
                 CASE WHEN v_secs = 1 THEN ' second.' ELSE ' seconds.' END,
      'details', 'retry_after_seconds=' || v_secs,
      'hint', NULL)::TEXT,
    DETAIL = pg_catalog.json_build_object(
      'status', 429,
      'status_text', 'Too Many Requests',
      'headers', pg_catalog.json_build_object('Retry-After', v_secs::TEXT))::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.list_comment_insert_guard_internal() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.list_comment_insert_guard_internal() IS
  '213 (Community C2): BEFORE INSERT on list_comments — a person''s own comment is stamped now (created_at, '
  'updated_at; deleted_at NULL), a reply must answer a live comment on the same list (23503 otherwise, one '
  'answer for every case), and it takes one "comment" hit (5 per 60s per person); over the limit the insert '
  'is refused with HTTP 429 + Retry-After (PostgREST PGRST envelope). Service-role writes are never limited.';

CREATE TRIGGER tr_list_comments_insert_guard
  BEFORE INSERT ON public.list_comments
  FOR EACH ROW EXECUTE FUNCTION public.list_comment_insert_guard_internal();

-- ---------------------------------------------------------------------------
-- PART 4 — the new-comment alert to the list's owner (077's coalescing)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.list_comment_notify_owner_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner      UUID;
  v_title      TEXT;
  v_actor_name TEXT;
  v_message    TEXT;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT l.owner_id, l.title INTO v_owner, v_title
  FROM public.lists l WHERE l.id = NEW.list_id;
  -- Not for the owner's own comment (and nothing to tell a list with no owner).
  IF v_owner IS NULL OR v_owner = NEW.author_id THEN
    RETURN NULL;
  END IF;

  SELECT '@' || p.username INTO v_actor_name FROM public.profiles p WHERE p.id = NEW.author_id;
  v_message := COALESCE(v_actor_name, 'Someone') || ' commented on ' || COALESCE(v_title, 'your list');

  -- One unread alert per list: two comments at the same instant serialize
  -- here, so the second refreshes the first's alert instead of adding one.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('list_comment_notify:' || NEW.list_id::TEXT, 0));

  UPDATE public.notifications n
     SET created_at = now(),
         title = v_message,
         data = pg_catalog.jsonb_build_object('list_id', NEW.list_id, 'actor_id', NEW.author_id)
   WHERE n.user_id = v_owner
     AND n.type = 'list_comment'
     AND n.read = false
     AND n.data ->> 'list_id' = NEW.list_id::TEXT;

  IF NOT FOUND THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (v_owner, 'list_comment', v_message, NULL,
            pg_catalog.jsonb_build_object('list_id', NEW.list_id, 'actor_id', NEW.author_id));
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.list_comment_notify_owner_internal() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.list_comment_notify_owner_internal() IS
  '213 (Community C2): AFTER INSERT on list_comments — the list''s owner gets a list_comment notification '
  '("@x commented on <title>", data list_id + actor_id); never for his own comment; one unread per list (077 pattern).';

CREATE TRIGGER tr_list_comments_notify_owner
  AFTER INSERT ON public.list_comments
  FOR EACH ROW EXECUTE FUNCTION public.list_comment_notify_owner_internal();

-- ---------------------------------------------------------------------------
-- PART 5 — the poster's own recent comments (the comment box's countdown)
-- ---------------------------------------------------------------------------
CREATE INDEX idx_list_comments_author_created ON public.list_comments (author_id, created_at);
