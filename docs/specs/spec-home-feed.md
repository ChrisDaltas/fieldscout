# Spec: Home Feed

## Phase
Phase 1 — MVP

## Overview

The home feed is a simple chronological stream of all public lists created or updated by any user on the platform. No algorithm in V1 — newest first. It is the default landing page for logged-in users and visible to guests.

---

## Feed Items

Each item is a list card showing:
- List title
- Author (avatar + username)
- Position filter (if set)
- Tags (chips)
- Like count + comment count
- Time since posted (relative, e.g. "2h ago")

---

## Behavior

- Newest first, no algorithmic sorting in Phase 1
- Infinite scroll or paginated (page size: 20)
- Guest users see the same feed — no personalization
- Feed personalization (based on follows) added in Phase 6

---

## Server Rendering

Home feed page is server-rendered for performance and SEO. Initial payload comes from a server component. Client-side pagination uses React Query for subsequent pages.

---

## UI Components

- `src/app/(app)/page.tsx` — home feed page (server component)
- `src/components/feed/feed.tsx`
- `src/components/feed/feed-item.tsx`
- `src/components/lists/list-card.tsx` (shared with My Lists)
- `src/hooks/use-feed.ts`
