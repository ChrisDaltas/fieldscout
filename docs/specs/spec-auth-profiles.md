# Spec: Authentication + Profiles

## Phase
Phase 1 — MVP

## Overview

Email and Google OAuth sign-up and login, username selection post-signup, and basic public profile pages.

---

## Authentication

- Sign up page: email + password, Google OAuth button
- Login page: email + password, Google OAuth button
- Username selection flow: shown once after first sign-up before entering the app. Username is permanent (cannot be changed in V1).
- Auth middleware protecting all routes under `(app)/`
- Supabase SSR auth helpers (`createServerClient`, `createBrowserClient`)
- `handle_new_user` trigger auto-creates a `profiles` row on signup

---

## Profile Page

**URL:** `fieldscout.gg/u/{username}`

**Contents:**
- Avatar (circular, 80px)
- @username — the only name shown anywhere (ruling 2026-08-05)
- Bio (optional, max 160 chars)
- List of public lists (grid)
- Big Board link
- Cred score badge (shows "Freshie" until earned)

**Editing:**
- Update avatar: upload to Supabase Storage, circular crop
- Update bio
- **No name field.** FieldScout stores no display name and no full name for a
  person (ruling 2026-08-05) — an account is an email, a password and a
  username. Do not add one back.
- Username is read-only after selection

---

## Database

`profiles` table (created in Phase 0 migration):
- `id` (FK to auth.users)
- `username` (unique) — the displayed name; we do not call it that
- ~~`display_name`~~ — RETIRED (ruling 2026-08-05, migration 075). The column still exists but is never written and never read; `handle_new_user` no longer seeds it from the OAuth `full_name` claim. Nothing may reintroduce a name for a person.
- `avatar_url`
- `bio`
- `is_pro` (boolean, default false)
- `cred_score` (integer, default 0)
- `created_at`

---

## UI Components

- `src/app/(auth)/signup/page.tsx`
- `src/app/(auth)/login/page.tsx`
- `src/app/(auth)/username/page.tsx`
- `src/app/(app)/u/[username]/page.tsx`
- `src/app/(app)/settings/profile/page.tsx`
- `src/components/profile/avatar-upload.tsx`
