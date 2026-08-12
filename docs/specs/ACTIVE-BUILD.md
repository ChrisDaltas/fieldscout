# Active build

> **This file decides what `/build-next` builds.** It is the single pointer the
> build loop reads before anything else. Change it here, and every future
> cycle — including an unattended `/loop /build-next` — follows.
>
> Exactly one build is active at a time. Pausing a milestone means pointing
> this file elsewhere; it does **not** mean editing that milestone's PROGRESS.

---

## Active: Lists v2 — **Round 2** (side by side + pop-outs)

*(Set 2026-08-09. Lists v2 ships ahead of M2 leagues — Chris, 2026-08-09.
Round 1 completed 2026-08-11; **Round 2 opened the same day on Chris's
"round 2, go"**.)*

**Round 1 is done and stays done** — LV.1 – LV.11 all landed. The queue is now
the plan's **§6**, tasks **LV.12 – LV.17**, in that order:

| | |
| --- | --- |
| **LV.12** | Side by side — the picker (replaces `SideBySidePlaceholder`) |
| **LV.13** | Side by side — the 300px columns, full-bleed scroller, per-column grouping menu |
| **LV.14** | Drafted **fan-out across the comparison set** (D12) |
| **LV.15** | Pop-outs — the store + the **app-shell host** |
| **LV.16** | Pop-outs — dark-inverted window content |
| **LV.17** | Pop-outs — wiring, states, and the mobile answer |

The seven LV.7 follow-ups (F-LV7.1 – F-LV7.7) in `PROGRESS-lists-v2.md` §5 are
still **filed items, not queued tasks** — Round 2 does not absorb them.
Switching to Redraft Leagues M2 (paused at L.B3.1) remains a Chris decision.

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
- ~~Everything lands behind `featureFlags.listsV2`.~~ **The flag was removed at
  LV.7 (2026-08-11)** — `/app/lists` serves the rebuilt page unconditionally and
  the legacy components are deleted. Nothing left to gate. **Round 2 ships
  unflagged too**, which is why LV.15's app-shell host must render nothing when
  no window is open.
- **Round 2 only: compose Round 1, do not re-solve it** (plan §6, D11).
  Grouping is `list-buckets.ts`, rows are `list-row-parts.tsx`, covers are
  `cover-tile.tsx`, marks are `use-draft-mode.ts`, reorder is
  `use-list-drag.tsx`, the mode control is `Segment`. A new surface that
  quietly reimplements one of these is the LV.7 failure repeating.
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
