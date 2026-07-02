# Spec: Guest Experience

## Phase
Phase 1 — MVP

## Overview

New visitors land on fieldscout.gg and can immediately start building a Big Board without signing up. Guest state persists in localStorage. On signup, guest state transfers automatically to the new account. CTAs are value-framed, not gate-framed.

---

## Behavior

1. A new visitor landing on fieldscout.gg is immediately placed into an interactive guest Big Board — no sign-up required
2. Guest state (Big Board, any lists created) is stored in `localStorage`
3. On signup, guest state transfers automatically to the new account — their guest Big Board becomes their real Big Board
4. CTAs are value-framed: "Save your rankings", "Share your Big Board", "Track your accuracy" — not "Create an account to continue"

---

## Key Rules

- Guest users see the same home feed as logged-in users (public content, no personalization)
- Guest Big Board is capped at 25 players (same default as logged-in users)
- No private lists for guests
- Guest state is browser-local — no server-side persistence until signup
