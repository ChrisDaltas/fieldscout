# Spec: Likes + Comments

## Phase
Phase 1 — MVP

## Overview

Users can like lists and leave comments on lists (if comments are enabled by the list owner). Likes use optimistic UI. Comments support one level of threaded replies.

---

## Likes

- Like/unlike button on list cards (feed) and list detail pages
- Optimistic UI — assume success, no loading state shown
- Like count shown on list cards and list detail page
- Users cannot like their own list (button hidden or disabled)

---

## Comments

- Comment form at the bottom of list detail pages (only if `comments_enabled = true` on the list)
- Threaded replies: 1 level deep only
- List owner can delete any comment on their list
- Comment authors can delete their own comments
- Comment count shown on list cards in the feed

---

## Database

```sql
list_likes:
  id, list_id, user_id, created_at
  UNIQUE(list_id, user_id)

list_comments:
  id, list_id, author_id, parent_id (nullable, for replies),
  body (text, max 500 chars), created_at, deleted_at
```

---

## UI Components

- `src/components/lists/like-button.tsx`
- `src/components/lists/comments-section.tsx`
- `src/components/lists/comment.tsx`
- `src/components/lists/comment-form.tsx`
- `src/hooks/use-like.ts`
- `src/hooks/use-comments.ts`
- `app/api/lists/[id]/like/route.ts`
- `app/api/lists/[id]/comments/route.ts`
