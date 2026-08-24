# Active build

> **This file decides what `/build-next` builds.** It is the single pointer the
> build loop reads before anything else. Change it here, and every future
> cycle — including an unattended `/loop /build-next` — follows.
>
> Exactly one build is active at a time. Pausing a milestone means pointing
> this file elsewhere; it does **not** mean editing that milestone's PROGRESS.

---

## Active: Redraft Leagues M3 — Auction engine (in build)

*(Set 2026-08-14 — **ruled by Chris in-session** ("M3 — Auction engine", the
recommended option of the M2-gate-passed question), recorded here per this
file's rule. **M2 passed its gate 2026-08-14** (L.B7.1, `npm run test:gate:m2`
green end-to-end — see the PROGRESS §1 row and the gate session-log entry).
In the same ruling Chris settled **R278**: D39-class browser-pass evidence is
**prose + DB corroboration** (the merged-PR precedent) — recorded at the
standing sites in PROGRESS.)*

**The breakdown is LAW — Chris approved and merged PR #150 (2026-08-16).**
`docs/specs/tasks-M3-auction.md` sequences the milestone (15 tasks, 5 lanes;
spec at **v2.10.1** with every C-row resolved or ruled); PROGRESS §2 carries
the M3 checklist and §4/§6 carry D126–D143 + F57. **The loop builds `L.C*`
tasks in lane order, starting L.C1.1** (migration 083 — schema lane opener).
The C43 projections-splits sync runs as an authorized standalone data-task PR
in parallel with the loop, never an `L.C` dependency.

| | |
| --- | --- |
| **PROGRESS (the loop's only memory)** | `docs/specs/PROGRESS-leagues.md` |
| **Delivery plan** | `docs/specs/delivery-plan-redraft-leagues.md` (v1.4 — §3 M3 row: Phase C gate; solvency property test incl. bot-driven mocks; bid-storm E2E) |
| **Spec (LAW)** | `docs/specs/spec-redraft-leagues.md` — **v2.13** (§8.6 auction incl. §8.6.7–8 endgame/solvency and **§8.6.9 the uncontestable instant award**; §8.8's pacing bar; L.C1) |
| **Task breakdown** | `docs/specs/tasks-M3-auction.md` (Architect; **approved & merged 2026-08-16**, PR #150) |
| **Task id prefix** | `L.C` |

**Standing constraints:** CLAUDE.md + the M2-era standing rules carry forward
(spec is LAW; server-authoritative always; branch + PR per task; proof chains
shown, not claimed; the realtime doctrine and draft-lock discipline as landed).
Inherited M3 notes already recorded: tasks-M2 §11's M3-inherits line
(presence-only `realtime.messages` INSERT posture — M3's auction realtime
decides whether to open Client Broadcast for bid-pulse UX, deliberately);
auction refusal seams in 066/071 name M3; the 2026 test-cohort note (CLAUDE.md)
makes **auction + custom scoring the headline feedback goals** — ~~the custom
scoring editor un-punt still needs its spec changelog entry (Architect) before
any build touches it~~ *(satisfied 2026-08-18: spec v2.11/§7.3.3.1 merged as
PR #152, and the SE lane block below carries the build — no editor build until
Chris also merges the SE breakdown PR)*.

**Lane precedence — TWO lanes under one active build (added 2026-08-17; takes effect when
the draft-room redesign PR merges, and is part of what Chris approves with it).**
Chris used the shipped M2 draft room live and ordered a **layout redesign**, ruling it runs
**AHEAD of the auction UI** so the auction room is built into the new shell rather than the
old one — **with the M3 engine lane continuing behind it**. That is not a build swap, so this
file's pointer does not move: **M3 stays the active build and gains a second lane.**

| | |
| --- | --- |
| **Redesign breakdown** | `docs/specs/tasks-DR-draft-room-redesign.md` (Architect, 2026-08-17) |
| **Redesign task id prefix** | `DR.` |
| **Spec fold** | `spec-redraft-leagues.md` **v2.12** (§16.1/§16.2/§16.3/§16.4/§16.5, §8.7, §9.3) |
| **PROGRESS** | the same file — `docs/specs/PROGRESS-leagues.md` §2 carries both checklists |

**Third concurrent lane — SE, the custom scoring editor (added 2026-08-18; takes effect
when the SE breakdown PR merges, and is part of what Chris approves with it).**
Spec **v2.11** (§7.3.3.1, approved & merged 2026-08-18 as PR #152) made the test-cohort
custom scoring editor LAW and required a follow-up Architect breakdown before build; that
breakdown exists and this row activates it. SE is the **C37 separate parallel track — never
an M3 lane**: it never blocks and is never blocked by `DR.*` or `L.C*` (its schema work is
additive; SE migration numbers stay **above tasks-M3 §7's 088/089 reservations**). The only
shared surface is `PROGRESS-leagues.md` (append-collisions resolved at merge, the
established two-lane pattern).

| | |
| --- | --- |
| **SE breakdown** | `docs/specs/tasks-SE-scoring-editor.md` (Architect, 2026-08-18) |
| **SE task id prefix** | `SE.` |
| **Spec fold** | `spec-redraft-leagues.md` **v2.11** (§7.3.3.1, §7.3.8, §12.25, §16.2, §23.5, App B.4) |
| **PROGRESS** | the same file — `docs/specs/PROGRESS-leagues.md` §2 carries all three checklists |

**Fourth lane — AP, auction pacing (added 2026-08-20; takes effect when the AP breakdown PR
merges, and is part of what Chris approves with it).**
Chris drove the **finished** M3 auction room on 2026-08-20 and ruled six changes to it — bot
pacing with a number on it (a mock under 45 minutes, a live draft under 90), instant awards for
uncontestable nominations, `$0` nominations as a per-league toggle with `auction_min_bid`
retired, the auction's manual nomination order, the six projection split columns that have
data, and idempotent budget adjustments. Spec **v2.13** is the fold. **This is not a build swap
and the pointer does not move: M3 stays the active build and gains a fourth lane** — the DR
precedent, applied again.

**AP runs AHEAD of M3's remaining three tasks — Chris ruled that order in-session.** `L.C4.1`
(sim + the solvency property test), `L.C5.1` (auction E2E incl. the bid storm) and `L.C6.1` (the
gate) all encode current behaviour as assertions, and **the bid-storm spec in particular assumes
today's bot cadence**; writing them against behaviour about to change buys a suite that must be
rewritten and, worse, a green gate certifying the wrong thing. Reasoning recorded at PROGRESS
**D197(4)**.

| | |
| --- | --- |
| **AP breakdown** | `docs/specs/tasks-AP-auction-pacing.md` (Architect, 2026-08-20) |
| **AP task id prefix** | `AP.` |
| **Spec fold** | `spec-redraft-leagues.md` **v2.13** (§7.3.8 · §8.3 · §8.6.1–8.6.3 · §8.6.8 · NEW §8.6.9 · §8.8 · §16.2 · §16.4 · §16.5.4 · E67–E70 · App A.4) |
| **MS breakdown** | `docs/specs/tasks-MS-mock-sandbox.md` (Architect, 2026-08-20; PR #184) |
| **MS task id prefix** | `MS.` |
| **MS spec fold** | `spec-redraft-leagues.md` **v2.15** (§8.7 · §8.8 · §19.2 · E75–E77) |
| **MP breakdown** | `docs/specs/tasks-MP-mock-practice.md` (Architect, 2026-08-21; PR #187 — **standalone mocks, base scoring templates, no league inheritance**; the league-attached practice launch is DEFERRED until league demand, per Chris) |
| **MP task id prefix** | `MP.` |
| **MP spec fold** | `spec-redraft-leagues.md` **v2.16** (§8.8 · E78–E80; Q23 lapsed, F85 de-targeted) |
| **MP release gate** | `NEXT_PUBLIC_FLAG_MOCK_DRAFTS` — never the `leagues` flag; everything must work with `leagues` OFF (E79) |
| **PROGRESS** | the same file — `docs/specs/PROGRESS-leagues.md` §2 carries all six checklists |

**The loop's order, precisely:**

1. Take the next unblocked **`DR.*`** task (dependency order in tasks-DR §5).
   *(**The DR lane is COMPLETE — DR.1–DR.8 all landed 2026-08-18**, so this step
   never fires again; the DR prerequisites in step 3 are all satisfied.)*
1a. **THE MOCK TRACK RUNS AHEAD OF THE LEAGUE LANES — take the next unblocked `MP.*` task
   first** (dependency order in `tasks-MP-mock-practice.md` §5; **D225–D233**, spec **v2.16**).
   Chris's ruling, 2026-08-21: standalone mocks are what users are invited to during the
   2026 launch, while league work waits for demand (*"until then we can invite users to come
   do mocks for practice"*) — and he opened the build in-session (*"perfect, lets build"*).
   `MP.1` (the storage investigation) is first and writes no code; its finding gates the
   lane's shape. **The lane's one cross-lane constraint: MP.4's launch dialog/RPC and MS.8's
   slot picker compose — one dialog, one RPC; whichever lands second composes, never forks.**
1b. **When no `MP.*` task is unblocked, take the next unblocked `AP.*` task** (dependency
   order in tasks-AP §7) before any remaining `L.C*` task. **`AP.4` is CLOSED with no code**
   (Q17's numbers already ship; Q23 lapsed with the standalone rewrite; the measurement is
   banked in the AP.4 closure row — do NOT re-run a ~52-minute mock to re-derive it). The
   remaining AP tasks are **AP.5 / AP.6 / AP.7**.
1c. **When no `MP.*` or `AP.*` task is unblocked, take the next unblocked `MS.*` task**
   (dependency order in `tasks-MS-mock-sandbox.md` §5, as re-read by tasks-MP §7) **before any
   remaining `L.C*` task.** The lane makes the mock launcher the commissioner of their own mock
   (**D216–D223**, spec **v2.15**). **MS.1, MS.4 and MS.6 serve the DEFERRED league-attached
   feature and are parked with it** (tasks-MP §7) — skip them until that feature returns.
   **One hard ordering constraint, and it is the only correctness-affecting one in the lane:
   `MS.7` must land BEFORE `MS.5` renders the order control.** `draft_set_order`'s route
   resolves `.eq('is_mock', false)`, so today the control is aimed at the REAL draft; it is
   live but latent, and rendering it in a mock room first makes the bug one click away
   (R468/D222).
2. When no `MP.*`, `AP.*` or `MS.*` task is unblocked, take the next **`L.C*`** engine task (tasks-M3 §6).
   **The three that remain — `L.C4.1`, `L.C5.1`, `L.C6.1` — must not be started while any
   `AP.*` task is unblocked** (the ordering above). `L.C6.1` additionally owes **F84**: the gate
   composes the AP suites by name.
3. When **all three** are blocked — or when Chris directs by name ("build SE.x") — take the
   next unblocked **`SE.*`** task (dependency order in tasks-SE §5). *(Its breakdown PR #161
   **merged 2026-08-19**, so this clause is live.)* The pure-TS opener
   chain (SE.1 → SE.2 → SE.3) touches no migration, so it is always safe to take while
   the schema lanes are contended. **AP and SE contend for migration numbers 091+ and pgTAP
   039+** — both lanes confirm the real next-free with `ls supabase/migrations/` at task time
   (D161/D166); neither trusts a number written in a planning document.
4. **Do not start `L.C3.1` until DR.1, DR.4 and DR.5 have landed** — it builds into the
   new shell (tasks-M3 §6's amended banners carry the dependency). `L.C3.2` additionally
   waits on DR.3; `L.C3.3` on DR.5.
5. The M3 **engine** lane — `L.C1.3` → `L.C1.7`, `L.C2.1`, `L.C2.2` — has **no `DR.`
   dependency** and is never blocked by the redesign. Exception: **`L.C1.8`** (added
   2026-08-18, F57 ruled — snake pause-first alignment) is engine work that runs
   **AFTER DR.2 lands**, per its own banner's sequencing note (it resets the local DB
   and DR.2's browser fixtures live on the stack).

**Do not build `LV.*` or Scout tasks while M3 is active.**

---

## Completed: Redraft Leagues M2 — Snake draft engine

*(🟢 **Gate passed 2026-08-14** — L.B7.1, `npm run test:gate:m2` green
end-to-end in one run; every §2 checkbox checked; F49/F52/F53/F54 discharged.
PROGRESS-leagues.md §1 + the 2026-08-14 session-log entry are the record.
M3 continues in the same PROGRESS file under the `L.C` prefix.)*

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
