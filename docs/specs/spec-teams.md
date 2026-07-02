# Spec: Teams

## Phase
Phase 2 — Teams

## Overview

A team is a list with a scoring system locked in at creation time. Fantasy point values for every player on the team are always evaluated against that locked scoring system, regardless of the user's session-level scoring toggle. No leagues, lineups, or live mode yet — those come in Phase 8.

---

## Features

### Create Team From Scratch
- Same flow as creating a list, but with a required scoring system selector step
- Scoring system becomes permanent once the team is created — cannot be changed

### Convert List to Team
- Any existing list can be converted into a team
- User selects a scoring system at conversion time — this locks it permanently

### Team Page
- Identical to a list detail page but with the scoring system badge always visible
- Fantasy points for each player calculated against the team's locked scoring system at all times

### My Teams Page
- Teams listed separately from regular lists on the user's profile
- Teams always pinned above regular lists

---

## Business Rules

- Free users: 1 team max. Check `is_pro` before creating a second team.
- Scoring system is immutable after team creation
- Teams are soft-deleted (never hard-deleted)

---

## Database

```sql
teams:
  id, list_id (FK to lists), owner_id, scoring_system_id (FK, immutable),
  created_at, updated_at, deleted_at
```

---

## UI Components

- `src/app/(app)/teams/new/page.tsx`
- `src/app/(app)/teams/[id]/page.tsx`
- `src/app/(app)/teams/page.tsx` (My Teams)
- `src/components/teams/scoring-system-selector.tsx`
- `src/components/teams/team-card.tsx`
- `src/components/teams/convert-to-team-modal.tsx`
- `src/hooks/use-teams.ts`
- `app/api/teams/route.ts`
