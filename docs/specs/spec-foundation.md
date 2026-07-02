# Spec: Foundation (Phase 0)

## Overview

Working infrastructure with no user-facing features. A deployed skeleton that is ready to build on. Developers can sign up, log in, and see a searchable list of NFL players — nothing a real user would care about yet.

---

## Tasks

### 1. Initialize Project
- Create Next.js 14 app with App Router
- Configure TypeScript, Tailwind, ESLint, Prettier
- Install and configure shadcn/ui and theme tokens
- Set up Vercel project + GitHub repo

### 2. Supabase Setup
- Create Supabase project
- Run initial migration: `profiles`, `players`, `player_stats`, `scoring_systems` tables
- Set up RLS policies on all tables
- Create auth trigger for auto-creating a profile on signup
- Seed 2 platform default scoring systems (ESPN Standard, ESPN PPR)

### 3. Authentication
- Sign up page (email + Google OAuth)
- Login page
- Username selection flow (post-signup)
- Auth middleware for protected routes
- Supabase SSR auth helpers configured

### 4. NFL Player Data Pipeline
- **Layer 1 (Sleeper API — free):** `scripts/sync-players.ts` — fetch all active NFL players from `https://api.sleeper.app/v1/players/nfl`. No API key needed. Populates `players` table with profiles, headshots, injury status, ADP.
- **Layer 2 (nflverse — free):** `scripts/load-historical-stats.py` using `nfl_data_py` — backfill weekly stats for seasons 2022–2025 into `player_stats`. One-time load, refreshed each new season.
- **Layer 3 (mock data):** `scripts/generate-mock-current-stats.ts` — plausible 2026 season stats for development. Real live stats wired up in Phase 8.
- Player search endpoint (by name, position, team)

### 5. App Shell
- Root layout with navigation (sidebar on desktop, bottom tabs on mobile)
- Basic responsive layout
- Loading states and error boundaries
- Dark mode support from day one (`class` strategy)

---

## Deliverable

A deployed Vercel app where developers can sign up, log in, and see a searchable list of NFL players.
