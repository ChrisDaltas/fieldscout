-- ============================================================================
-- Harden notify_list_followers — review finding R5 (2026-07-19).
--
-- The function is SECURITY DEFINER (bypasses RLS by design — the notifications
-- table deliberately has no INSERT policy), but 019 shipped it with zero
-- in-body authorization and a caller-supplied p_actor, and the 037 grant model
-- versions anon EXECUTE on every routine. Net effect: any caller could insert
-- notifications attributed to arbitrary users.
--
-- Fix, per spec §12's v2.0 hardening pattern (authorization re-validated
-- inside every SECURITY DEFINER body; REVOKE EXECUTE from anon — plan §8.3):
--   1. In-body check: p_actor must equal auth.uid() — the actor is always the
--      authenticated caller. Every existing app caller (lists player routes
--      via notifyListFollowers) already passes user.id with a user JWT, so
--      behavior is unchanged for legitimate use. There is no service-role
--      caller today; if one appears it needs an explicit carve-out here.
--   2. REVOKE EXECUTE from PUBLIC and anon (deliberate narrowing of the 037
--      model, as 037's own header prescribes). authenticated/service_role
--      keep the grant; the in-body check is the effective gate.
--
-- Body otherwise identical to 019. This is the doctrine carve-out D23 needed:
-- "RLS is the only effective gate" holds for tables, NOT for SECURITY DEFINER
-- routines — those need in-body auth + REVOKE discipline (spec §12.0).
-- ============================================================================

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
  -- R5: SECURITY DEFINER bypasses RLS, so authorization lives here (spec §12).
  -- The actor must be the authenticated caller — no spoofed attribution.
  IF p_actor IS NULL OR auth.uid() IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'notify_list_followers: p_actor must be the authenticated caller'
      USING ERRCODE = '42501';
  END IF;

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

REVOKE EXECUTE ON FUNCTION notify_list_followers(uuid, uuid) FROM PUBLIC, anon;
