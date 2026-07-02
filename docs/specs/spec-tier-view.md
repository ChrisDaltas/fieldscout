# Spec: Tier View

## Phase
Phase 1 — MVP

## Overview

Tiers are a view mode overlay on lists and the Big Board — not a separate data structure. Toggling tiers on groups players visually into tier rows (S / A / B / C / D / F) without changing the underlying player order.

---

## Behavior

- Toggle tiers on/off per list. Stored as `tiers_enabled BOOLEAN DEFAULT FALSE` on the `lists` table.
- When enabled, players are grouped into tier rows with color-coded labels on the left side
- Tier assignment is derived from rank position — not manually assigned in V1
- Two sub-views available when tiers are on:

### Card View (default when tiers on)
- Players displayed as cards within each tier row
- Left-to-right = highest rank within that tier row

### List View (compact)
- Players displayed as a vertical stack
- Tier label shown on the left side of each group

Both views are available for all lists and the Big Board.

---

## Tier Colors

| Tier | Color | Hex |
|------|-------|-----|
| S | Gold | `#FFD700` |
| A | Green | `#1DB954` |
| B | Blue | `#3B82F6` |
| C | Yellow | `#EAB308` |
| D | Orange | `#F97316` |
| F | Red | `#E5534B` |

---

## Business Rules

- Tiers do not change the underlying player order
- Tier boundaries are user-adjustable via drag (drag the divider line between tiers)
- Tier state is per-list and persists across sessions

---

## UI Components

- `src/components/lists/tier-view.tsx`
- `src/components/lists/tier-row.tsx`
- `src/components/lists/tier-toggle.tsx`
- `src/components/lists/view-mode-toggle.tsx` (card vs. list sub-view)
