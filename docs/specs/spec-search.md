# Spec: Search

## Phase
Phase 1 — MVP

## Overview

Basic search across players, lists, and users. Accessible from the top navigation bar on all pages.

---

## Search Scope

- **Players** — search by name. Results show position badge, team, headshot.
- **Lists** — search by list title. Results show author, tags, like count.
- **Users** — search by username or display name. Results show avatar, cred badge.

---

## Results Page

- URL: `fieldscout.gg/search?q={query}`
- Tabs: Players / Lists / Users
- Each tab shows up to 20 results, with a "load more" option
- Empty state per tab if no results found

---

## Search Input

- Persistent in the top navigation bar
- Keyboard shortcut: `⌘K` / `Ctrl+K` to focus
- Debounced at 300ms for live preview dropdown (top 5 results across all types)
- Full results page on Enter or "See all results"

---

## Implementation

- Player search: Supabase full-text search on `players.full_name`
- List search: Supabase full-text search on `lists.title`
- User search: Supabase full-text search on `profiles.username` and `profiles.display_name`
- All queries filtered to exclude soft-deleted content

---

## UI Components

- `src/components/search/search-bar.tsx`
- `src/components/search/search-dropdown.tsx` (live preview)
- `src/app/(app)/search/page.tsx`
- `src/components/search/player-result.tsx`
- `src/components/search/list-result.tsx`
- `src/components/search/user-result.tsx`
- `app/api/search/route.ts`
