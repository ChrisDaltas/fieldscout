# Active build

> **This file decides what `/build-next` builds.** It is the single pointer the
> build loop reads before anything else. Change it here, and every future
> cycle — including an unattended `/loop /build-next` — follows.
>
> Exactly one build is active at a time. Pausing a milestone means pointing
> this file elsewhere; it does **not** mean editing that milestone's PROGRESS.

---

## Active: Redraft Leagues M2 — resumed at **L.B3.1**

*(Set 2026-08-13 — **ruled by Chris in-session** ("Resume M2 at L.B3.1", the
recommended option of the Round-2-complete question), recorded here per this
file's rule that the post-Round-2 direction is a Chris decision. M2 was paused
2026-08-09 at L.B3.1, mid-milestone, deliberately; nothing in its PROGRESS was
edited to pause it, so the loop picks up exactly where it left off.)*

| | |
| --- | --- |
| **PROGRESS (the loop's only memory)** | `docs/specs/PROGRESS-leagues.md` |
| **Delivery plan** | `docs/specs/delivery-plan-redraft-leagues.md` (v1.4) |
| **Spec (LAW)** | `docs/specs/spec-redraft-leagues.md` |
| **Task breakdown** | `docs/specs/tasks-M2-snake-draft.md` (task text §6; standing rules §4) |
| **Task id prefix** | `L.B` |

**Standing constraints:** the ones the M2 breakdown §4 and CLAUDE.md already
carry (spec is LAW; server-authoritative always; branch + PR per task; proof
chains shown, not claimed). The next task, **L.B3.1**, is the repo's first
realtime *client* work and a **re-skin in place** — the CLAUDE.md redesign
rules (single theme, tokens, no resting elevation) apply to all L.B3.x room UI.

**Do not build `LV.*` or Scout tasks while M2 is active.** If a cycle finds
itself editing the lists collection page or `src/lib/metrics/**`, it has read
the wrong PROGRESS — stop and re-read this file.

---

## Paused: Lists v2 — Round 2 complete, no Round 3 queued

*(Parked 2026-08-13 with **both rounds shipped**: Round 1 (LV.1 – LV.11)
completed 2026-08-11; Round 2 (LV.12 – LV.17) landed 2026-08-12. The seven
LV.7 follow-ups (F-LV7.1 – F-LV7.7) in `PROGRESS-lists-v2.md` §5 remain
**filed items, not queued tasks** — queueing them as a Round 3 is a Chris
decision this file would record.)*

| | |
| --- | --- |
| **PROGRESS** | `docs/specs/PROGRESS-lists-v2.md` |
| **Delivery plan** | `docs/specs/delivery-plan-lists-v2.md` |
| **Design LAW** | `docs/design/lists/README.md` (+ prototype in `docs/design/lists/design/`) |
| **Task text** | Round 2 was the plan's §6 (Round 1 was §4 — corrected 2026-08-11, LV.12 review R210) |
| **Task id prefix** | `LV.` |

**Standing constraints for any reactivation** (full text in the plan §1):

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
  the legacy components are deleted. Nothing left to gate. **Round 2 shipped
  unflagged too**, which is why LV.15's app-shell host renders nothing when
  no window is open.
- **Round 2 composed Round 1, never re-solved it** (plan §6, D11).
  Grouping is `list-buckets.ts`, rows are `list-row-parts.tsx`, covers are
  `cover-tile.tsx`, marks are `use-draft-mode.ts`, reorder is
  `use-list-drag.tsx`, the mode control is `Segment`. A new surface that
  quietly reimplements one of these is the LV.7 failure repeating.
- Keep the app's ×0.8 token scale; implement colors from tokens, not the
  handoff's literal hex.
- **Browser verification runs against the LOCAL Supabase stack, never hosted.**
  `.env.local` points at the **hosted production** project, so `npm run dev`
  straight out of the box drives a real users' database — LV.12 did exactly
  that and left seven soft-deleted `LV12 tmp` rows in production (**R207**).
  Use the gitignored `.claude/launch.json` config **`dev-local`** (port 3123),
  which overrides `NEXT_PUBLIC_SUPABASE_URL` to `http://127.0.0.1:54321` with
  the keys from `npx supabase status`; confirm it took by checking a network
  request goes to `127.0.0.1:54321`. **State the verification environment in
  the PR body and in PROGRESS §4** — the LV.12 PR disclosed neither, which is
  what made the finding a should-fix rather than a note.
- **The local stack carries a deliberate saved-list fixture, and
  `supabase db reset` destroys it.** LV.12's fix round (**R208**) left a public
  list owned by the *second* local account (`dev-pro@fieldscout.local`),
  favourited from `dev@`, in the **local** DB on purpose — so the `saved` half
  of the collection is non-empty by default, which is the one condition LV.12's
  original verification never had. After a reset, **re-create it before
  verifying anything about saved lists**: a public list on the `dev-pro`
  account, favourited as `dev@` through the shipped
  `POST /api/lists/[id]/favorite`. Skip that and the verification reproduces
  R208 exactly — every observation taken over an empty array, looking green.
  Full detail in `PROGRESS-lists-v2.md` §4 item 6. *(Added 2026-08-11, LV.12
  review **R215** — the same "put it where the next Builder reads it" argument
  R207 made, applied to R207's own round's artefact.)*
- **There is a second deliberate local fixture, and the same reset destroys
  it.** LV.13 left **`LV13 local fixture — round board`** in the **local** DB on
  purpose: owned by `dev@fieldscout.local`, 8 players carrying tiers `r1`–`r4`.
  It is the **only** list on the local stack that can render a *round*-grouped
  column, which is what makes "each column groups independently" observable —
  without it every column groups by tier and a build that ignored per-column
  grouping entirely would produce identical-looking evidence. To re-create it
  after a reset: make a list on `dev@` in the UI, add ~8 players, then set the
  rounds directly —
  `docker exec supabase_db_fieldscout psql -U postgres -d postgres -c "update list_players set tier = 'r' || ((position - 1) / 2 + 1) where list_id = '<id>'"`
  — and switch the column's `dots` menu to **Rounds**. (`r1`–`r30` are legal
  because LV.1.5 widened `list_players.tier`'s CHECK constraint to
  `^([SABCDF]|r([1-9]|[12][0-9]|30)|c[1-4])$`; that is exception (b) above, not
  a new one.) The `update` was run to verify it — `UPDATE 8`, reproducing the
  fixture's exact `r1,r1,r2,r2,r3,r3,r4,r4` — so it is a tested instruction, not
  a remembered one. *(Added 2026-08-12, LV.13 review
  **R219** — R215's argument applied to R215's own round's successor: the
  fixture was documented only in `PROGRESS-lists-v2.md` §4, which is the
  placement R215 corrected one task earlier.)*
- **A third local-fixture note, and this one is a correction rather than a
  creation.** `Secret sleepers` (`aaaa1111-…ab99`) carried
  `lists.player_count = 3` against **2** `list_players` rows, so every surface
  that reads the denormalised count — the picker card, the rail row, the gallery
  card — said *"3 players"* for a 2-player list. Corrected 2026-08-12 (LV.17
  review **R247**) with
  `update lists set player_count = (select count(*) from list_players lp where lp.list_id = lists.id) where id = '…ab99'`,
  and the whole table then checked for the same drift (**0 rows**). It is
  recorded here because a `supabase db reset` re-seeds the fixture from whatever
  produced the drift in the first place: **after a reset, re-check
  `player_count` against `list_players` across the table before trusting any
  count on screen.** Nothing in the app writes that column from the client, so a
  wrong count is always seed drift, never a bug you are looking at.

---

## Not yet active: Scout

*(Specced and prototyped; no code written into the app. `PROGRESS-scout.md`
committed 2026-08-13 — it was sitting untracked in the working tree; Chris
ruled it committed. Activation is a Chris decision recorded here.)*

| | |
| --- | --- |
| **PROGRESS** | `docs/specs/PROGRESS-scout.md` |
| **Delivery plan** | `docs/specs/delivery-plan-scout.md` (v2.7) |
| **Spec (LAW)** | `docs/specs/spec-scout.md` (v2.7) |
| **Content** | `docs/specs/scout-content/` (registry, trait model, guides, lesson copy — done) |

---

## Switching builds

1. Finish the current cycle (PROGRESS current, `main` clean, no open PRs).
2. Move the milestone's row from **Active** to **Paused**, noting the task id
   it paused at and the date.
3. Promote the incoming one to **Active**.
4. Do not edit either PROGRESS file as part of the switch — they are each
   milestone's own memory and stay truthful about their own state.
