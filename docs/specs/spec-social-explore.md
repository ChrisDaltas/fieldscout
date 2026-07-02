# Spec: Full Social + Explore

## Phase
Phase 6 — Full Social + Explore

## Overview

Rich user profiles, follow graph, personalized home feed, and a full content discovery experience. The platform starts to feel like a community.

---

## Rich Profile Page

- Cred score + rank tier badge
- Accuracy stats: Big Board accuracy, submission accuracy, Start or Sit record
- Public lists grid
- Submission history
- Start or Sit history (questions asked + voting record)
- Follower / following counts with links to lists

---

## Follow / Unfollow

- Follow button on any profile page
- Follower and following lists (modal or dedicated page)
- Optimistic UI

---

## Home Feed Personalization

- When a user follows others, their home feed prioritizes followed users' content
- Still surfaces popular content from the broader community
- Guests and unfollowing users see the global chronological feed (Phase 1 behavior)

---

## Explore Page

- Trending lists (most liked/viewed in last 7 days)
- Browse by position and by week
- Trending tags row (horizontal scroll)
- Tag feed pages: `fieldscout.gg/tag/{slug}` — server-rendered for SEO
- Filters: recency, popularity, author cred score
- "Rising rankers" section (users with fast-growing cred)
- Weekly and season top scorers leaderboard
- Suggested users to follow

---

## Notifications

- Follow notifications ("@user started following you")
- Like notifications ("@user liked your list")
- Comment reply notifications
- Notification bell in nav with unread count badge

---

## SEO

- Server-rendered profile and list pages with OG tags
- Structured data (JSON-LD) on public pages
- Full sitemap

---

## Database

```sql
follows:
  id, follower_id, following_id, created_at
  UNIQUE(follower_id, following_id)

notifications:
  id, recipient_id, type (follow/like/comment_reply),
  actor_id, entity_id, entity_type, read_at, created_at
```

---

## UI Components

- `src/app/(app)/explore/page.tsx`
- `src/components/explore/trending-lists.tsx`
- `src/components/explore/trending-tags.tsx`
- `src/components/explore/rising-rankers.tsx`
- `src/components/profile/follow-button.tsx`
- `src/components/notifications/notification-bell.tsx`
- `src/components/notifications/notification-list.tsx`
- `src/hooks/use-follow.ts`
- `src/hooks/use-notifications.ts`
