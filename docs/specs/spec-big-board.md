# Spec: Big Board

## Phase
Phase 1 — MVP

## Overview

Every user has one Big Board — a season-long, drag-and-drop player ranking that serves as their master cheat sheet. It is auto-created on signup and cannot be deleted. The Big Board is public by default and lives at `fieldscout.gg/u/{username}/big-board`.

---

## Features

### Season-Long Big Board
- Full drag-and-drop ranking interface (dnd-kit)
- Configurable size: 10–300 players, default 25
- Explicit "Update Big Board" save button — working state vs. saved state are distinct
- Public URL: `fieldscout.gg/u/{username}/big-board`

### Weekly Big Boards
- Horizontal week selector (weeks 1–18) appears at the top of the Big Board tab once the NFL season starts
- Week 1 seeds from the season-long board
- Each subsequent week carries over from the prior week's saved state
- Only the current week is editable — future weeks are locked, past weeks are read-only

### Big Board Rollback
- Change history log with timestamps showing what moved
- Users can restore any prior saved state as their new working state

### Smart Order
- Sort the full board by: fantasy points, projected points, consensus rank, or ADP
- Players always go to the bottom of the list when added — no auto-sort on add

### Create List Fork
- Filter Big Board by position or criteria, hit "Create List" → forks into a new independent list
- Big Board itself is unchanged after the fork

---

## Business Rules

- Big Board cannot be deleted or made private
- One Big Board per user, auto-created on signup via `handle_new_user` trigger
- Big Board is always pinned at the top of My Lists

---

## Database

Migration adds `lists` and `list_players` tables:

```sql
lists:
  id, owner_id, title, slug, description, is_big_board (bool),
  is_ranked (bool), is_private (bool), position_filter,
  tiers_enabled (bool default false), player_count,
  created_at, updated_at, deleted_at

list_players:
  id, list_id, player_id, rank_position, tier, created_at
  UNIQUE(list_id, player_id)
```

---

## UI Components

- `src/app/(app)/big-board/page.tsx`
- `src/components/big-board/big-board.tsx`
- `src/components/big-board/week-selector.tsx`
- `src/components/big-board/smart-order-menu.tsx`
- `src/components/big-board/change-history.tsx`
- `src/components/lists/player-row.tsx` (shared with Player Lists)
- `src/hooks/use-big-board.ts`
