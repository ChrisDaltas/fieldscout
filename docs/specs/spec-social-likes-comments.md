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

### Comment rules (migration 213 — Community launch plan C2, 2026-10-29)

- **Removing** is a soft delete through `remove_list_comment(p_list_id, p_comment_id)` only: the comment's author, the list's owner, or a platform operator. A missing, already-removed or not-yours comment is refused by name — never answered as done.
- **No edits.** Nobody can change a comment after posting (no client UPDATE): not its words, its date, its list, or bring a removed one back. A new comment is stamped with the time it was posted.
- **Removed comments are hidden from everyone** — readers, the list's owner and the author alike. Counts are live comments only.
- **5 comments a minute** per person, across every list. The comment box holds Post with "You can comment again in 20s" once you've used them; if the server refuses first, the ink toast says so, with the wait, and your text stays in the box.
- **New-comment alert:** the list's owner gets "@x commented on <list>" (a `list_comment` notification linking to the list). Never for your own comment; one unread alert per list — a newer comment refreshes it.

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
