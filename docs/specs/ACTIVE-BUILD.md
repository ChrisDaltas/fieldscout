# Active build

> **This file decides what `/build-next` builds.** It is the single pointer the
> build loop reads before anything else. Change it here, and every future
> cycle — including an unattended `/loop /build-next` — follows.
>
> Exactly one build is active at a time. Pausing a milestone means pointing
> this file elsewhere; it does **not** mean editing that milestone's PROGRESS.

---

## Active: Lists v2

*(Set 2026-08-09. Lists v2 ships ahead of M2 leagues — Chris, 2026-08-09.)*

| | |
| --- | --- |
| **PROGRESS (the loop's only memory)** | `docs/specs/PROGRESS-lists-v2.md` |
| **Delivery plan** | `docs/specs/delivery-plan-lists-v2.md` |
| **Design LAW** | `docs/design/lists/README.md` (+ prototype in `docs/design/lists/design/`) |
| **Task text** | Delivery plan **§4**, read together with the handoff section that task cites. There is no separate `tasks-*.md` breakdown — the handoff is detailed enough to serve as one. |
| **Task id prefix** | `LV.` |

**Standing constraints for every task in this build** (full text in the plan §1):

- UI/UX only, with **three** exceptions, each individually ruled by Chris:
  (a) the `drafted` table (LV.1.2, 2026-08-09); (b) widening
  `list_players.tier`'s CHECK constraint (LV.1.5, 2026-08-09 — one
  `ALTER TABLE`, no new table or column); and (c) the `list_links` table plus
  its routes (LV.8, 2026-08-11 — *"we need a way to link back to resources
  used and a way for creators to attached videos to their lists"*).
  **That is the whole budget** — no fourth schema change, no other new API
  route. A task that thinks it needs one has left scope: stop and raise it.
  *(This row said "two" until 2026-08-11. Each exception was raised by a
  Builder rather than improvised around, and ruled on its own merits — the
  count moving is the process working, not the budget eroding.)*
- **Boards are off limits.** No task opens `src/components/big-board/**`,
  `src/stores/board-labels-store.ts`, or `src/components/lists/draft-mode/**`.
- Everything lands behind `featureFlags.listsV2`.
- Keep the app's ×0.8 token scale; implement colors from tokens, not the
  handoff's literal hex.

---

## Paused: Redraft Leagues M2

*(Paused 2026-08-09 at task **L.B3.1**, mid-milestone, deliberately.)*

| | |
| --- | --- |
| **PROGRESS** | `docs/specs/PROGRESS-leagues.md` |
| **Delivery plan** | `docs/specs/delivery-plan-redraft-leagues.md` (v1.4) |
| **Spec (LAW)** | `docs/specs/spec-redraft-leagues.md` |
| **Task breakdown** | `docs/specs/tasks-M2-snake-draft.md` |
| **Task id prefix** | `L.B` |

M2 is **not** abandoned and its PROGRESS is accurate — it resumes by pointing
this file back at it. Nothing about the M2 state was edited to pause it, so
`/build-next` picks up at L.B3.1 exactly where it left off.

**Do not build `L.*` tasks while Lists v2 is active.** If a cycle finds itself
in `src/components/leagues/**` or `src/components/draft/**`, it has read the
wrong PROGRESS — stop and re-read this file.

---

## Switching builds

1. Finish the current cycle (PROGRESS current, `main` clean, no open PRs).
2. Move the milestone's row from **Active** to **Paused**, noting the task id
   it paused at and the date.
3. Promote the incoming one to **Active**.
4. Do not edit either PROGRESS file as part of the switch — they are each
   milestone's own memory and stay truthful about their own state.
