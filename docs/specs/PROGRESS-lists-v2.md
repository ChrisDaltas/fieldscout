# PROGRESS — Lists v2

> **The build loop's only memory for this build.** Re-read at the start of
> every cycle; never rely on chat history. Every cycle ends at a task boundary
> with this file current and `main` clean, so a session can be compacted or
> killed at any point and a fresh one resumes losslessly.
>
> **Authority:** design LAW (`docs/design/lists/README.md`) > delivery plan
> (`docs/specs/delivery-plan-lists-v2.md` v3.2) > this file.
>
> Active per `docs/specs/ACTIVE-BUILD.md`. Task ids are `LV.*`. **`L.*` tasks
> belong to the paused leagues build — never pick one from here.**

---

## 1. Milestone status

| Round | Contents | Exit criteria | Status |
| --- | --- | --- | --- |
| **Round 1** | Lists page (rail + cards) and list detail (hero, tabs, toolbar, three view styles, drag-and-drop, stats picker, notes, drafted) in the new design language | Both screens match the handoff at desktop and mobile; `featureFlags.listsV2` flipped on; old components retired | 🟡 Not started |
| **Round 2** | Side-by-side compare; pop-out windows (app-shell hosted) | — | ⚪ Deferred (plan §6) |

Nothing is blocked. No open questions.

---

## 2. Round 1 task checklist

Task text: **delivery plan §4**, read with the handoff section each task cites.
Dependencies in parentheses; pick the first unchecked task whose dependencies
are all checked.

**Phase 1 — foundations**

- [ ] **LV.1.1** — `featureFlags.listsV2` + route-level branch so old and new Lists coexist
- [ ] **LV.1.2** — migration: `list_player_drafted (user_id, list_id, player_id)` + RLS + indexes, and its read/toggle route (D2)
- [ ] **LV.1.3** — point `use-draft-mode.ts` **only** at the new server source (LV.1.2)
- [ ] **LV.1.4** — session-only display state: `view`, `cols`, band labels, `budget`; **no `persist` middleware** (D3)
- [ ] **LV.1.5** — widen the tier route's Zod enum for round/band buckets beyond six; S–F stays valid (D4)

**Phase 2 — Lists page**

- [ ] **LV.2.1** — page header: heading, view-mode segmented control, My lists / Saved tabs, New list (LV.1.1)
- [ ] **LV.2.2** — rail mode: 200px sticky rail, shared edge, selected-row treatment (LV.2.1)
- [ ] **LV.2.3** — cards mode: responsive gallery, flat at rest, lift on hover (LV.2.1)

**Phase 3 — list detail**

- [ ] **LV.3.1** — hero: cover, inline rename, byline, action cluster, options menu (LV.1.1)
- [ ] **LV.3.2** — tabs + toolbar: grouping dropdown, view-style toggle, Stats, Add players (LV.3.1, LV.1.4)
- [ ] **LV.3.3** — view style List: 60px rows, stat cells, computed `minWidth` (LV.3.2)
- [ ] **LV.3.4** — view style Table: 44px rows, sticky header (LV.3.2)
- [ ] **LV.3.5** — view style Cards: corner cells, stat strip, label rail (LV.3.2)
- [ ] **LV.3.6** — drag-and-drop across all three views; header drop assigns the bucket (LV.3.3–3.5, LV.1.5)
- [ ] **LV.3.7** — stats picker modal: grouped catalog, search, reorderable chips (LV.3.2)
- [ ] **LV.3.8** — notes: accent mark + body-portalled hover card (LV.3.3)
- [ ] **LV.3.9** — drafted checkbox + "Clear drafted" (LV.1.3, LV.3.3)

**Phase 4 — states and cutover**

- [ ] **LV.4.1** — loading / empty / error / overflow states (LV.3.*)
- [ ] **LV.4.2** — AI list generation + persona surfaces restyled (LV.3.*)
- [ ] **LV.4.3** — public share view, still server-rendered (LV.3.*)
- [ ] **LV.4.4** — flag flip + retire old components (all)

**Lane note:** LV.1.1, LV.1.2, LV.1.4 and LV.1.5 are independent and may be
picked in any order. LV.1.2 is the only schema task in the build.

---

## 3. Design questions

*(A Builder that finds the handoff wrong or ambiguous files the question here
with a recommendation and HALTs — it never improvises.)*

None open.

---

## 4. Decisions log

Design decisions D1–D7 live in delivery plan §3 and are not duplicated here.
This section records decisions made **during** the build.

- *(none yet)*

---

## 5. Blockers

None.

---

## 6. Review findings

*(Reviewer findings per cycle, in house format. Empty until the first cycle.)*
