# Spec: Start or Sit

## Phase
Phase 5 — Submissions + Cred + Start or Sit

## Overview

Users post public Start or Sit questions, the community votes, and after games resolve the votes are scored. Correct voters earn cred with a contrarian bonus for going against the majority.

---

## Posting a Question

- Search two players, add optional context, post publicly
- Questions are open for voting until Sunday kickoff

---

## Voting

- Feed of open questions — browse by most votes, most recent, by position, by week
- Tap to vote for one player
- See the vote split after voting
- Cannot vote on your own question
- Votes are unlimited (no free tier restriction)

---

## Resolution

- After games complete, the player with higher actual fantasy points is scored as the correct pick
- Voters who picked the correct player earn cred
- Contrarian bonus: extra cred for voting with the minority that turned out to be right
- Resolution handled by a scheduled cron after Sunday games

---

## Browse Page

- `/start-or-sit` — browse all questions
- Filters: most votes, most recent, by position, by week
- Post-resolution: show outcome, vote breakdown, and cred awarded

---

## Feed Integration

- Hot Start or Sit questions surface in the home feed

---

## Database

```sql
start_sit_questions:
  id, author_id, player_a_id, player_b_id, context (text, optional),
  week, season, is_resolved (bool), winner_player_id,
  created_at

start_sit_votes:
  id, question_id, voter_id, voted_for_player_id, created_at
  UNIQUE(question_id, voter_id)
```

---

## UI Components

- `src/app/(app)/start-or-sit/page.tsx`
- `src/components/start-sit/question-card.tsx`
- `src/components/start-sit/vote-bar.tsx`
- `src/components/start-sit/post-question-modal.tsx`
- `src/hooks/use-start-sit.ts`
- `app/api/start-sit/route.ts`
- `app/api/start-sit/[id]/vote/route.ts`
- `scripts/resolve-start-sit.ts` (cron)
