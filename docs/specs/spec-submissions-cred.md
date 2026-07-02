# Spec: Ranking Submissions + Cred

## Phase
Phase 5 — Submissions + Cred + Start or Sit

## Overview

Users submit their rankings for real evaluation against actual NFL results, earn cred for accuracy, and build a reputation on the platform. Cred scores weight each user's contribution to the platform-wide consensus rankings.

---

## Submission Flow

- Any ranked list has a "Submit" button during open windows (Tuesday open → Sunday kickoff lock)
- Submission is a frozen snapshot of the list's current order — immutable after submission
- Season-long submission: submit before Week 1 kickoff, evaluated against cumulative season totals
- Free tier: 2 position submissions per week

---

## Accuracy Scoring

- Spearman rank correlation scoring after games complete
- Displayed as a percentage on profile ("73% accurate this season")
- Evaluated weekly and season-long

---

## Cred System

- Base participation cred: awarded per "Update Big Board" action and per submission
- Accuracy bonus: proportional to Spearman score
- Cred rank tiers (in order):
  1. Freshie
  2. Sophomore
  3. JV
  4. Varsity
  5. Rookie
  6. Veteran
  7. All Pro
  8. Local Legend
  9. Hall of Famer
  10. GOAT
- Tier displayed as a badge on profiles, list cards, and comments

---

## Consensus Rankings

- Materialized view of all user Big Boards weighted by cred score
- New users (cred = 0) contribute with a weight of 1
- Public page: `fieldscout.gg/consensus`
- Refreshed via scheduled cron
- "My rank vs. consensus" side-by-side comparison view on list pages

---

## Leaderboards

- Weekly top scorers
- Season top scorers
- All-time leaderboard

---

## Database

```sql
submissions:
  id, user_id, list_id, week, season, snapshot (jsonb — ordered player IDs),
  score (float, set after evaluation), submitted_at

cred_scores:
  id, user_id, total_cred, weekly_cred, season_cred,
  accuracy_pct, tier, updated_at

ranking_history:
  id, user_id, list_id, snapshot (jsonb), saved_at
```

---

## UI Components

- `src/components/submissions/submit-button.tsx`
- `src/components/submissions/submission-window-badge.tsx`
- `src/app/(app)/consensus/page.tsx`
- `src/components/consensus/consensus-table.tsx`
- `src/components/cred/cred-badge.tsx`
- `src/app/(app)/leaderboard/page.tsx`
- `app/api/submissions/route.ts`
- `scripts/score-submissions.ts` (cron)
- `scripts/refresh-consensus.ts` (cron)
