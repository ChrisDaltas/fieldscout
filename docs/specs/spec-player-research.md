# Spec: Player Research + Scoring Systems

## Phase
Phase 3 — Player Research + Scoring

## Overview

A powerful stat exploration tool with custom scoring. Users can filter and sort all players by stats, apply their league's scoring rules, and compare players side-by-side. Custom scoring systems let users see exactly what each player is worth under their league's rules.

---

## Research Table

- Filterable, sortable table of all active NFL players with stats
- Column customization: users choose which stat columns to show
- Filters: position, team, bye week, experience
- Per-game vs. season-total toggle
- Historical data: toggle between current season and past 3 seasons
- Quick-add button on each player row to add to any list

---

## Compare Mode

- Select 2–4 players for a side-by-side comparison view
- Shows all stat columns and fantasy point values head-to-head

---

## Scoring System Selector

- Session-level dropdown to apply different scoring systems
- Resets when user leaves the page (not persisted to profile)
- Dynamic fantasy points column recalculates instantly based on selected system
- Custom Scoring badge on lists when a non-default system is applied, with a hover pane showing how each player's value shifts vs. the platform default

---

## Custom Scoring Systems

- Free users: 1 custom system. No limit for Pro users.
- Users define scoring by stat category (e.g. 0.5 pts/reception, 6 pts/passing TD)
- Custom systems can be named and reused across sessions

---

## Player Detail Drawer

A slide-in drawer on any player row providing:
- Full stat breakdown (season + per-game)
- Injury history
- YouTube Highlights button (Phase 1 behavior: opens YouTube search in new tab)
- Recent news (Phase 7)
- Add to list quick-action

---

## Business Rules

- Custom scoring systems: free users max 1. `is_pro` check before allowing creation of additional systems.
- Player data is read-only — populated by sync scripts only

---

## Database

```sql
scoring_systems:
  id, owner_id (nullable for platform defaults), name,
  rules (jsonb — stat_key: points_per_unit),
  is_default (bool), created_at
```

---

## UI Components

- `src/app/(app)/research/page.tsx`
- `src/components/research/research-table.tsx`
- `src/components/research/column-picker.tsx`
- `src/components/research/filter-bar.tsx`
- `src/components/research/compare-view.tsx`
- `src/components/research/player-drawer.tsx`
- `src/components/research/scoring-selector.tsx`
- `src/components/research/custom-scoring-modal.tsx`
- `src/hooks/use-research.ts`
- `src/hooks/use-scoring-systems.ts`
