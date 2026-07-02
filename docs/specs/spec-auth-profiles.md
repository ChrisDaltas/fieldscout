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
- Display name + username
- Bio (optional, max 160 chars)
- List of public lists (grid)
- Big Board link
- Cred score badge (shows "Freshie" until earned)

**Editing:**
- Update avatar: upload to Supabase Storage, circular crop
- Update bio and display name
- Username is read-only after selection

---

## Database

`profiles` table (created in Phase 0 migration):
- `id` (FK to auth.users)
- `username` (unique)
- `display_name`
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
