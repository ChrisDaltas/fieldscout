# Spec: Player Lists

## Phase
Phase 1 — MVP

## Overview

Users can create named player lists, add and reorder players, apply tags, and share them publicly. Lists are the core content unit of FieldScout — everything from a "Top 10 WRs" to a deep sleeper watchlist.

---

## Features

### Create List Flow
- Fields: title (required), description (optional), position filter (optional), tags (up to 5, system + custom), comments toggle, private toggle
- Free tier enforcement: 1 private list max

### Managing Players
- Add players via search + autocomplete
- Players always go to the bottom of the list when added
- Drag-and-drop reorder (dnd-kit)
- Duplicate prevention — toast shown if player already on list
- Smart Order button: sort by fantasy points, projected points, consensus rank, or ADP

### List Detail Page
- Player rows: headshot, name, team, position, key stats
- Tags shown at top of page
- Comments section at bottom (if enabled by list owner)
- Public URL: `fieldscout.gg/u/{username}/lists/{slug}`

### My Lists Page
- Grid of user's lists sorted by recency
- Big Board always pinned at top

### List Actions
- Edit title, description, tags
- Duplicate list
- Soft delete (sets `deleted_at`)
- Toggle private (gated for free tier)
- Toggle comments on/off

### Tags System
- System tags seeded in migration (e.g. "PPR", "Dynasty", "Sleepers", "Rookies", "2QB")
- Users can create custom tags
- Tag chip display on list cards
- Tag feed pages: `fieldscout.gg/tag/{slug}` — server-rendered for SEO

---

## Business Rules

- Each player can only appear once per list (`UNIQUE(list_id, player_id)`)
- Free users: 1 private list max. Check `is_pro` before allowing `is_private = true`
- Soft deletes only — never hard-delete lists (`deleted_at` timestamp)
- Big Board cannot be deleted

---

## UI Components

- `src/app/(app)/lists/new/page.tsx`
- `src/app/(app)/u/[username]/lists/[slug]/page.tsx`
- `src/app/(app)/lists/page.tsx` (My Lists)
- `src/app/(app)/tag/[slug]/page.tsx`
- `src/components/lists/list-card.tsx`
- `src/components/lists/list-detail.tsx`
- `src/components/lists/player-row.tsx`
- `src/components/lists/add-player-search.tsx`
- `src/components/lists/create-list-modal.tsx`
- `src/components/lists/tag-chip.tsx`
- `src/hooks/use-lists.ts`
- `src/hooks/use-list-players.ts`
- `app/api/lists/route.ts`
- `app/api/lists/[id]/players/route.ts`
