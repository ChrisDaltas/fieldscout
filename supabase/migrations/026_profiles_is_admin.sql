-- ============================================================================
-- PROFILES.IS_ADMIN (plan M5 — the editorial review gate needs a reviewer)
-- ============================================================================
-- Gates the admin surfaces (persona-post draft review at /app/admin/posts).
-- Server routes check this column with the user's own client; writes are
-- service-role only, guarded the same way as the billing columns (025) —
-- RLS alone can't express column-level protection, and "Users can manage own
-- profiles" would otherwise let anyone self-grant admin.

ALTER TABLE profiles ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION guard_profile_admin_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IN ('authenticated', 'anon') THEN
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
      RAISE EXCEPTION 'Admin status is managed by the system.'
        USING errcode = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_profile_admin
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION guard_profile_admin_column();
