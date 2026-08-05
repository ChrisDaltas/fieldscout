-- ============================================================================
-- 076: handle_new_user — final definition. Stores NO name, and restores the
-- username-contract guards.
--
-- This migration exists because the signup trigger has been redefined four
-- times by different changes that each knew only part of the intent:
--
--   049/050/051  added the username-contract guards
--   073          (hotfix, 2026-08-05) pinned search_path to fix broken signups,
--                but was authored against the 006-era body and silently
--                DROPPED the 049/050/051 guards
--   075-hotfix   (hand-applied to production 2026-08-05 22:26) stopped writing
--                a name, per the identity ruling — and deliberately did NOT
--                re-import the guards, flagging them as a separate bug
--
-- Migrations 048-051 run *after* the production hotfixes in numeric order, so
-- replaying the chain re-introduces name-writing. This file is the single
-- authoritative definition that ends that ping-pong. It must be the LAST
-- migration that touches handle_new_user.
--
-- Two properties, both required:
--
--   1. NO NAME IS STORED. An account is an email, a password and a username
--      (Chris's ruling, 2026-08-05). The provider's full_name claim is
--      ignored. profiles.display_name is left NULLABLE and inert — dropping
--      the column is a separate, later change, which keeps this migration
--      order-independent against the running site.
--
--   2. THE USERNAME CONTRACT IS ENFORCED (restores 049/050):
--      · client metadata may only claim a HUMAN-pattern handle
--        (^[a-z0-9_]{5,20}$). The signup-trigger context has auth.role() NULL,
--        so the 040 namespace guard cannot gate this path — without the
--        in-body check an anonymous signup carrying
--        user_metadata.username = 'evil-ai' mints a persona-pattern handle
--        (D49(9); reproduced live in review).
--      · the 'user_' || 8 hex placeholder shape is RESERVED — metadata can
--        never claim it; only the id-derived fallback below may assign it
--        (R32 / migration 050).
--
-- search_path is pinned to '' with every reference schema-qualified — the 073
-- fix, kept. That is what makes real GoTrue signups work at all.
--
-- Grants/ACL: CREATE OR REPLACE preserves the existing ACL and the
-- on_auth_user_created trigger binding. No schema change, no table rewrite.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  new_user_id UUID := NEW.id;
  new_username TEXT := NEW.raw_user_meta_data->>'username';
  effective_username TEXT;
BEGIN
  effective_username := COALESCE(new_username, 'user_' || substr(new_user_id::text, 1, 8));

  -- Restored from 049/050. Client metadata may only claim a human-pattern
  -- handle, and may never claim the reserved placeholder shape.
  IF effective_username !~ '^[a-z0-9_]{5,20}$'
     OR effective_username ~ '^user_[0-9a-f]{8}$' THEN
    effective_username := 'user_' || substr(new_user_id::text, 1, 8);
  END IF;

  -- No name is written. The provider's full_name claim is ignored.
  INSERT INTO public.profiles (id, username, avatar_url)
  VALUES (
    new_user_id,
    effective_username,
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Insert Big Board if the user doesn't already have one.
  INSERT INTO public.lists (
    owner_id, title, slug, hide_order, is_big_board, is_private, comments_enabled
  )
  SELECT new_user_id, 'My Big Board', 'big-board', FALSE, TRUE, FALSE, TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM public.lists WHERE owner_id = new_user_id AND is_big_board = TRUE
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't block account creation if profile setup hits a race or transient
  -- error. Recovery is a re-run of this function on next sign-in.
  RAISE WARNING 'handle_new_user failed for %: %', new_user_id, SQLERRM;
  RETURN NEW;
END;
$function$;
