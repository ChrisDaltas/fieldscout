# Spec: Leagues + Live Mode

## Phase
Phase 8 — Leagues + Live Mode

## Overview

Full league simulation and real-time game day scoring. Teams from Phase 2 now compete inside leagues, set weekly lineups, and watch their fantasy points update live on Sunday.

---

## Leagues

### Create a League
- League name, roster settings, scoring system, lineup slots, invite code
- Pro only — gate behind `is_pro` check

### Join a League
- Join via invite code
- Pro only

### League Standings
- W/L record, total points, weekly rank

### League Chat
- Simple real-time messaging via Supabase Realtime
- No threading — flat chat per league

### Player Exclusivity
- When adding a player to a team in a league, check that no other team in that league already has that player

---

## Team + Lineup

- Teams from Phase 2 now have roster slots (starters + bench) based on league format
- Weekly lineup: drag players between starter/bench slots before Sunday lock
- Team performance tracking: weekly points, season total, W/L record

---

## Live Mode

- "Go Live" button on team page — active only during NFL game windows (Sunday, Thursday, Monday)
- Players split into three groups: Now Playing / Done / Up Next
- Live stat lines and live fantasy points updated in real time
- Powered by Supabase Realtime subscriptions
- Free tier: Live Mode for 1 team. Pro: all teams simultaneously.

---

## Live Stats Pipeline

- `sync-live-stats` Edge Function polls live stats API every 30 seconds during game windows
- Upserts `player_stats` with live totals and game clock
- Updates `nfl_games` status (pre/live/final)
- Live stats provider: MySportsFeeds or equivalent (replaces mock data from Phase 0)

---

## Database

```sql
leagues:
  id, name, commissioner_id, scoring_system_id, roster_settings (jsonb),
  invite_code, created_at

league_members:
  id, league_id, user_id, team_id, joined_at

team_players:
  id, team_id, player_id, is_starter (bool), slot, acquired_at

nfl_games:
  id, home_team, away_team, week, season,
  status (pre/live/final), game_clock, quarter, kickoff_at
```

---

## UI Components

- `src/app/(app)/leagues/new/page.tsx`
- `src/app/(app)/leagues/[id]/page.tsx`
- `src/app/(app)/leagues/[id]/standings/page.tsx`
- `src/components/leagues/lineup-editor.tsx`
- `src/components/leagues/live-mode.tsx`
- `src/components/leagues/live-player-row.tsx`
- `src/components/leagues/league-chat.tsx`
- `supabase/functions/sync-live-stats/index.ts`
