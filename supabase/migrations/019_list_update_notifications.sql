-- ============================================================================
-- Migration 019: "list updated" notifications for followers (pinners)
--
-- When a list owner adds/removes players, every user who has pinned (favorited)
-- that list gets a notification. To avoid spamming on a burst of edits, unread
-- "list_updated" notifications are COALESCED: at most one unread per
-- (recipient, list). A partial unique index enforces that; the function bumps
-- an existing unread row's timestamp instead of inserting a duplicate.
--
-- notify_list_followers runs SECURITY DEFINER so it can insert notifications
-- for other users (the notifications table has no INSERT policy by design).
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_unread_list
  ON notifications (user_id, (data->>'list_id'))
  WHERE type = 'list_updated' AND read = false;

CREATE OR REPLACE FUNCTION notify_list_followers(p_list_id uuid, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_title text;
  v_actor_name text;
  v_message text;
BEGIN
  SELECT title INTO v_title
  FROM lists WHERE id = p_list_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(display_name, '@' || username) INTO v_actor_name
  FROM profiles WHERE id = p_actor;
  v_message := COALESCE(v_actor_name, 'Someone') || ' updated ' || v_title;

  -- Refresh any existing unread notification for this list (coalesce a burst).
  UPDATE notifications n
  SET created_at = now(), title = v_message
  FROM list_favorites f
  WHERE f.list_id = p_list_id
    AND f.user_id <> p_actor
    AND n.user_id = f.user_id
    AND n.type = 'list_updated'
    AND n.read = false
    AND n.data->>'list_id' = p_list_id::text;

  -- Insert for followers who don't already have an unread one.
  INSERT INTO notifications (user_id, type, title, body, data)
  SELECT f.user_id,
         'list_updated',
         v_message,
         NULL,
         jsonb_build_object('list_id', p_list_id, 'actor_id', p_actor)
  FROM list_favorites f
  WHERE f.list_id = p_list_id
    AND f.user_id <> p_actor
    AND NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.user_id = f.user_id
        AND n.type = 'list_updated'
        AND n.read = false
        AND n.data->>'list_id' = p_list_id::text
    )
  ON CONFLICT DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION notify_list_followers(uuid, uuid) TO authenticated;
