-- ============================================================================
-- Local-dev seed — applied automatically by `supabase db reset` (config.toml
-- [db.seed].sql_paths). LOCAL ONLY: never pushed to hosted (db push ignores
-- seeds), never referenced by migrations.
--
-- Purpose: a reset must never lock the developer out again (2026-08-03: a
-- pgTAP session's reset wiped auth.users and login broke with no hint). This
-- recreates the two dev users the app's dev-auth flow expects, matching
-- scripts/seed-dev-user.ts (which stays for hosted/manual use and remains
-- idempotent alongside this).
--
--   dev@fieldscout.local      username dev_user  (free)
--   dev-pro@fieldscout.local  username devpro    (is_pro, active sub)
--   password (both): dev-password-1234
--
-- Deterministic UUIDs so reruns and cross-references are stable. The 049
-- handle_new_user trigger fires on the auth.users insert and creates a
-- placeholder-username profile; the profiles upsert below then enforces the
-- real dev usernames/flags (same order as seed-dev-user.ts).
-- ============================================================================

-- GoTrue scans the token columns into non-nullable Go strings, so they must
-- be '' and never NULL. Omitting them here lets them default to NULL, and
-- GET /auth/v1/admin/users then 500s with
--   Scan error on column "confirmation_token": converting NULL to string
-- which breaks `npm run restore:dev` (and the Studio user list) after every
-- `supabase db reset`. GoTrue's own signup path writes '' — this matches it.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token
)
VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-4111-8111-111111111111',
    'authenticated', 'authenticated',
    'dev@fieldscout.local',
    extensions.crypt('dev-password-1234', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"dev_user"}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-4222-8222-222222222222',
    'authenticated', 'authenticated',
    'dev-pro@fieldscout.local',
    extensions.crypt('dev-password-1234', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"devpro"}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
VALUES
  (
    extensions.gen_random_uuid(),
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    '{"sub":"11111111-1111-4111-8111-111111111111","email":"dev@fieldscout.local","email_verified":true}'::jsonb,
    'email', now(), now(), now()
  ),
  (
    extensions.gen_random_uuid(),
    '22222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222222',
    '{"sub":"22222222-2222-4222-8222-222222222222","email":"dev-pro@fieldscout.local","email_verified":true}'::jsonb,
    'email', now(), now(), now()
  )
ON CONFLICT (provider_id, provider) DO NOTHING;

-- The 049 trigger swallows exceptions and assigns a placeholder username —
-- enforce the dev identities and Pro flags on top (id-keyed, rerun-safe).
-- No name column is seeded: FieldScout stores no name for a person (ruling
-- 2026-08-05, migration 075) — an account is an email, a password and a
-- permanent username, and every surface renders the handle.
INSERT INTO public.profiles (id, username, is_pro, subscription_status)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'dev_user', false, 'free'),
  ('22222222-2222-4222-8222-222222222222', 'devpro', true, 'active')
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username,
  is_pro = EXCLUDED.is_pro,
  subscription_status = EXCLUDED.subscription_status;
