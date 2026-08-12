# PROGRESS — Lists v2

> **The build loop's only memory for this build.** Re-read at the start of
> every cycle; never rely on chat history. Every cycle ends at a task boundary
> with this file current and `main` clean, so a session can be compacted or
> killed at any point and a fresh one resumes losslessly.
>
> **Authority:** design LAW (`docs/design/lists/README.md`) > delivery plan
> (`docs/specs/delivery-plan-lists-v2.md` v6.0) > this file. **That ordering is
> load-bearing, not decorative** — LV.12 used it to settle a plan clause the
> design package contradicts (§4).
>
> Active per `docs/specs/ACTIVE-BUILD.md`. Task ids are `LV.*`. **`L.*` tasks
> belong to the paused leagues build — never pick one from here.**

---

## 1. Milestone status

| Round | Contents | Exit criteria | Status |
| --- | --- | --- | --- |
| **Round 1** | Lists page (rail + cards) and list detail (hero, tabs, toolbar, three view styles, drag-and-drop, stats picker, notes, drafted) in the new design language | Both screens match the handoff at desktop and mobile; `featureFlags.listsV2` flipped on; old components retired | ✅ **COMPLETE 2026-08-11** (LV.1.1–LV.1.4 landed 2026-08-09; **LV.2 + LV.3 landed 2026-08-11**; **LV.8 (attached links) landed 2026-08-11**; **LV.4 (drag-and-drop) landed 2026-08-11**; **LV.2-fix (cover treatment → player headshots over a position-group fill) landed 2026-08-11**; **LV.9 (one tab/segment component) landed 2026-08-11**; **LV.10 (DEF → team logo + a real image fallback) landed 2026-08-11**; **LV.11 (single-select filter rows onto that control) landed 2026-08-11** — the screen exists, is comparable against `screens/`, and is now editable by dragging. **LV.1.5 (the tier CHECK widening) landed 2026-08-11** — the last schema task, and the one that turned Rounds from a rendering-complete empty section into a working grouping. **LV.5 (AI generation + persona surfaces) landed 2026-08-11** — and found the v2 screens carried **no** AI surfaces at all, so the launch-scope "AI stat lists" feature had no entry point behind the flag LV.7 flips; restored, restyled and guarded. **LV.6 (the public share view) landed 2026-08-11** — the only Lists surface a stranger sees, rebuilt as the detail panel minus what a stranger cannot do, with the LV.1.5 500 reproduced on the live route and shown fixed. **LV.7 (the cutover) landed 2026-08-11 and closes Round 1** — the flag is gone, the legacy tree is deleted, and the four capabilities Chris ruled must survive were *ported* rather than rebuilt) |
| **Round 2** | Side-by-side compare (LV.12–LV.14); pop-out windows, app-shell hosted (LV.15–LV.17) | Picker → columns match `screens/side-by-side-*.png`; a tick marks every column in the comparison and nothing outside it (**D12**); pop-outs survive navigation and the host renders nothing when empty (**D13**) | 🟡 **ACTIVE from 2026-08-11** — Chris: *"round 2, go"*. **LV.12 (the picker) landed 2026-08-11** — Side by side now opens on a working picker instead of a "not built yet" panel, and the plan's "honours the My lists / Saved tab" clause was found wrong against the design package and erratum'd rather than improvised around (§4, plan → v5.1). **Its review returned FIX-THEN-MERGE; the fix round (2026-08-11) closed R207–R212** — the erratum itself was re-verified and upheld, but the browser evidence behind it had been taken against **hosted production** over an empty `saved` set, so it was re-run against the local stack with a real saved list (§4, §6). **LV.13 (the columns) landed 2026-08-11** — the picker's CTA now opens real 240px full-bleed columns that group independently, `ComparisonPending` is deleted and `Change lists` is in the page header. **§3 Q4 was ruled the same day**: no cap, no search, no truncation — and no phone-specific treatment either (*"id say leave the phone version as is"*). **Its review returned FIX-THEN-MERGE with no blockers; the fix round (2026-08-12) closed R217–R223** without changing a line of behaviour — the headline was that the pin two documents cite as making the phone ruling un-re-addable caught only the desktop-first spelling of stacking, and the mobile-first one passed green (§6). **LV.14 (the drafted fan-out) landed 2026-08-12** — a tick now writes one row per list **in the comparison** that holds the player and none outside it, which is **D12**'s reconciliation of the design package's global rule with Chris's per-list ruling, shown live: three columns struck from one tick, three rows, and **zero** on a list that holds the same player and was left out of the picker. Partial failure rolls the refused column back on its own and says so once, by name. The **R220** obligation LV.13 recorded is discharged — the picker's sub-line now describes shipped behaviour, and the copy was never edited. **Its review returned CLEAN (R224–R225, two nits), both carried by LV.15's PR** (§6). **LV.15 (the pop-out store + the app-shell host) landed 2026-08-12 and opens Phase 8** — `list-windows-store.ts` is `player-windows-store.ts`'s shape plus size and collapse (**D13**), the handoff's `z` is the array index rather than a second source of truth for stacking, and the host **renders nothing at all** with no window open, measured on Home and Players with the host proven mounted at the same moment. Drag, both resize clamps (960 × 720 and 264 × 176, exactly), collapse, close, z-order and survival across three routes were measured on the **local** stack; a reload leaves a clean page with the geometry remembered. Two windowing systems now coexist at chosen depths — pop-outs 45, player mini cards 60. **Its review returned FIX-THEN-MERGE with no blockers; the fix round (2026-08-12) closed R226–R230** — the render-nothing pins anchored on the first `return null` rather than the guard's, so an effect firing on **every route in the app** passed them green; and Escape now closes the top pop-out, because a window met by a smaller viewport had no reachable close at all. **A second independent review returned FIX-THEN-MERGE with no blockers; the second fix round (2026-08-12) closed R231–R234** — that Escape guard covered Radix and *only* Radix, because `defaultPrevented` needs the consumer to have called `preventDefault()` and four of the app's own handlers do not, so an Escape typed into the player-search box **on `/app/players`** destroyed the pop-out; and `PROGRESS-scout.md`, an unrelated build's memory document, had been swept into the previous round's commit undisclosed and is now back out of the branch and untouched on disk (§6) **LV.16 (the window's content) landed 2026-08-12** — the pop-out is a working list now: the dark inversion is **one `fs-dark` wrapper** whose five values live as custom properties in `globals.css`, so the shared row parts invert with no dark variant of any of them (the same `text-n-3` class reads `#b3b9c0` inside the window and `rgb(95,100,109)` on the page behind it) — the LAW's mechanism implemented against a token layer that is **literal hex rather than custom properties**, which is the one thing the LAW's wording assumes and this app does not have. 29px rows, the 14px checkbox at 1:1 with its 75% white stroke, name at **Regular**, hover 9%, drafted 45% over 5%; drag-reorder through the shared gap model with the drop *commit* moved out of the detail panel into `use-list-drop.ts` so the two cannot drift; the Stats picker opens **light, outside the wrapper**, and it is the toolbar's own catalog; the footer's Share is ink-on-lime by the LAW's one sanctioned literal. **Both LV.15 hand-offs discharged** (F-LV15.1, F-LV15.2), and a tick here is one tick on one list — measured, with a list holding the same player gaining zero. **Its review returned FIX-THEN-MERGE with no blockers; the fix round (2026-08-12) closed R235–R242** — the headline is that this task made the app's **drag layer** ambiguous: `use-list-drag.tsx` read the live DOM through `document`, which was right while the detail panel was its only consumer, and a pop-out floats over the panel writing the same `data-drop-row="all:0"` into the same namespace, so a drop released over the *other* surface silently reordered the dragged list to the foreign surface's slot index and **persisted it** (shown both ways, then refused both ways). Every DOM read is now scoped to a root the drag context renders itself. The window also stopped handing out the viewer's own handle as the owner of a **saved** list once the collections cache ages out — that link was shown 404ing — and the hand-maintained `.fs-dark` redirect list is now **audited by a test**, which found `bg-n-4` already broken in the tree at 1.61:1 (§6). **A second independent review of that round returned CLEAN** (R243–R247, five nits), all five carried into LV.17's PR rather than re-opening a merged branch (§6). **LV.17 (wiring, states and the phone answer) landed 2026-08-12 and closes Round 2** — `pop out` is real in the hero and in a column's `dots` menu, both through one store; the window has four states with the branch order the data forces, two of them literally shared with the column; **6+ is "no cap"** (Q4 one screen along), measured with seven open and the seventh back at the cascade origin, all at one z layer, one Escape closing one. **Its review returned ESCALATE, and Chris ruled on both escalated questions (2026-08-12); the fix round closed R248–R255** — the two things LV.17 had *decided* rather than asked were both reversed, and both are now rulings in plan §1 (v6.0). **A pop-out of a list that is gone closes with a toast** reading *"This list is no longer available."* — neutral on purpose, because that is also the fix for the round's real finding: **the app was stating a cause it cannot know** (**R248**). A 404 from `GET /api/lists/[id]` collapses three situations and only one is a deletion — the third is a list **alive with `deleted_at` NULL** and merely no longer visible to the viewer, which the owner produces with one click; the shipped copy said *"Its owner deleted it."* over all three, and it was reproduced false twice, including live with the DOM and the DB side by side. That surface also **re-worded a merged one** (`Could not load` → `Deleted` in a Side by side column), now restored. **Phones get a real variant**: full width × 60% height, bottom-anchored, toolbar = `Options` + `Close` with everything else folded into that menu — one breakpoint at 768, executed in the store test, with desktop bit-identical and measured to the pixel. **F-LV15.3 stays discharged.** And **the record was corrected**: LV.17 wrote down that the deleted state was *"not reachable at all"*, which was **false** (**R249**) — it was reachable one retry later, and the `fetchStatus: 'paused'` behind that claim is React Query's *offline* pause, which a resolved 404 does not cause. `useList` still refuses to retry, now narrowed to **404 only** (**R252**), on the true and narrower argument: a 404 surfaced one retry late, and a shared hook was changed to make it immediate |

**✅ Round 1 is done, and the build is closed.** LV.7 landed 2026-08-11 with
every ruling taken. There is now exactly one Lists surface: `/app/lists` serves
the rebuilt page unconditionally, `featureFlags.listsV2` no longer exists, and
`list-detail-view.tsx`, `lists-browse.tsx`, `list-card.tsx`, the whole
`lists/draft-mode/**` tree and three orphaned components are deleted — 3,700
lines out.

**All four questions were ruled.** **Q4** (2026-08-11, Round 2) — Side by side
gets no cap, no search field and no truncation, and no phone-specific treatment;
revisit on real usage. **Q1** (2026-08-09) — build LV.1.3 as
written; no users exist, so there are no drafted marks to preserve. **Q2**
(2026-08-09) — widen the tier CHECK constraint, the build's second schema
exception. **Q3** (2026-08-11) — **keep all four**: folders, right-rail
dragging, the player mini card, and pin/unpin. See Q3's ruling block for what
that changed and why the recommendation was wrong.

**🟡 Round 2 opened 2026-08-11** on Chris's *"round 2, go"* — plan §6, tasks
**LV.12 – LV.17**. The follow-ups LV.7 filed rather than absorbed stay in §5 as
filed items; **Round 2 does not absorb them**.

Round 2 carries **one behavioural fork, already ruled, and a Builder must not
re-open it**: the handoff, its store (`toggleDrafted` — global) and
`screens/side-by-side-columns.png` all show a drafted tick striking a player in
**every list containing him**. Chris ruled the opposite on 2026-08-10 (*"per
user, per list… players will have multiple lists for multiple leagues"*), which
is the schema LV.1.2 shipped. `screens/README.md` already names this class of
collision: *screenshots outrank the prose, they do not outrank Chris.*
**Plan D12 reconciles them — the comparison set *is* the draft**, so a tick
writes one row per list *in the comparison* (every column on screen, which is
what the picker copy promises) and touches nothing outside it. No new table, no
new route: the schema budget stays closed at three.

---

## 2. Round 1 task checklist

Task text: **delivery plan §4**, read with the handoff section each task cites.
Dependencies in parentheses; pick the first unchecked task whose dependencies
are all checked.

**Phase 1 — foundations**

- [x] **LV.1.1** — `featureFlags.listsV2` + route-level branch so old and new Lists coexist (2026-08-09)
- [x] **LV.1.2** — migration: `list_player_drafted (user_id, list_id, player_id)` + RLS + indexes, and its read/toggle route (D2) (2026-08-09)
- [x] **LV.1.3** — `use-draft-mode.ts` points at the LV.1.2 server source; no file under `src/components/lists/draft-mode/**` was touched, and that surface's account-persisted marks were *shown* flowing through the shared hook (§3 Q1). Folded in nits R176 + R178; review findings **R190–R194**, re-review findings **R195–R198** and final-review findings **R199–R202** resolved on the same branch — the durable clear now refuses marks the read never delivered; the bit that decides that comes from the read itself rather than the query status (which an optimistic mark can forge), an aborted read cannot open it in *either* arm (R199), and it lives as long as the cache rather than as long as the mount (R200) (2026-08-09; round-3 fixes 2026-08-10)
- [x] **LV.1.4** — session-only display state: `view`, `cols`, band labels, `budget`; **no `persist` middleware** (D3) (2026-08-09)
- [x] **LV.1.5** — **LANDED 2026-08-11** (migration `081_list_players_tier_vocabulary.sql`; see §4). ✅ **Q2 RULED (widen the CHECK)** — one migration + widen the tier route's Zod enum for round/band buckets beyond six; S–F stays valid (D4). **Reconcile the bucket vocabulary with `DEFAULT_COST_BANDS` in `src/stores/list-display-store.ts`** — LV.1.4 chose `c1`–`c4` for cost bands as *session-local* keys that are explicitly **not on the wire**; this task owns what the route actually accepts, so either adopt them or decide the wire keys differ and say so. Widening the enum also turns bucket keys into DB-sourced free text, which is why `resolveBandLabel` is `hasOwnProperty`-guarded (R181/R183). **Includes one migration** — `list_players.tier` carries a live CHECK constraint (`list_players_tier_check`, `003_lists.sql:42-43`) pinning it to NULL or S–F on local **and** hosted production, so widening Zod alone would make every round write a Postgres `23514` returned as an HTTP 500. Vocabulary approved in §3 Q2

**Phase 2 — the screens** *(restructured 2026-08-10 — read the note at the end of this section)*

- [x] **LV.2** — **the Lists page, whole** (2026-08-11). Built from
  `docs/design/lists/screens/*.png`, not from the prose. Page header, rail mode
  with the **complete open list** in the right panel (§7 gap 1), cards gallery,
  and loading / empty / error states. **The cover it shipped was wrong and was
  corrected the same day** (`LV.2-fix`, §4): covers are player headshots over a
  `pos-*` fill keyed to `position_filter`, not a solid block with a glyph —
  §7 gap 2 is reversed. The warm `tier-1..7` ramp is used throughout (§7 gap 4). Shipped
  together with LV.3 in one PR, because §7 is explicit that they are one screen
  and splitting them is what guaranteed an empty frame. Original text:
- [x] ~~**LV.2** — **the Lists page, whole.**~~ Page header (heading, view-mode
  segmented control, My lists / Saved tabs, New list), rail mode (200px sticky
  rail, shared edge, selected-row treatment), cards gallery (responsive, flat
  at rest, lift on hover), and its loading / empty / error states. One branch,
  one PR. Needs only LV.1.1 (merged).
  **Handoff §"Lists page"** — and heed its critical note: resting/hover/active
  colors for the segmented and tab controls belong in **CSS classes, not inline
  styles**; an inline `background` outranks `:hover` and silently kills it.
- [x] **LV.3** — **list detail, whole** (2026-08-11, same PR as LV.2). Hero
  with inline rename and the Share / dots / expand / pop-out / close cluster,
  List · Details · Comments tabs, the toolbar, **all three view styles**, and
  **all five groupings** including the Avg cost band-rename and the Budget %
  share column. **Three carve-outs, all named rather than approximated:** the
  note *editor* (the mark and its hover card ship; writing a note does not),
  the searchable/grouped stat catalog (the picker ships over the seven stats
  the app holds data for), and drag-and-drop, which is LV.4. Original text:
- [x] ~~**LV.3** — **list detail, whole.**~~ Hero + inline rename, tabs, toolbar,
  all three view styles (list / table / cards), stats picker, notes, the
  drafted checkbox, and its states. One branch, one PR. Needs only LV.1.1.
  **Handoff §"List detail"**. Two things carried from earlier reviews:
  - **The grouping dropdown is data-driven.** Until LV.1.5 lands, only `tier`
    and plain `rank` can be written to the server — a Round/Cost entry would
    `23514` on first use. Build the option set so LV.1.5 opens it, don't
    hardcode all five.
  - **The drafted checkbox is permanent** (Chris, 2026-08-10 — no draft-mode
    gate; handoff §"Side by side"/§"Cards"). Read `use-draft-mode.ts`'s header
    before wiring "Clear drafted": it is *guarded* — it refuses when the read
    failed, is in flight, or never landed, returns `false` when it refused, and
    raises its own toast saying which. So (a) do not announce a clear you did
    not get — check the return value, as `list-detail-view.tsx`'s `handleReset`
    does; `true` means *permitted and issued*, not *rows gone* (R201), and the
    hook already reports a failed DELETE, so don't add a second message; and
    (b) do **not** gate the control on the rendered drafted count — that was
    the legacy view's accidental guard and R195 measured one optimistic mark
    re-opening it. Only the hook knows whether a read landed.

**Phase 3 — the rest** *(genuinely separate work, not screen slices)*
- [x] **LV.1.5** — **the tier CHECK is widened** (2026-08-11). Migration
  `081_list_players_tier_vocabulary.sql` + the route's Zod enum, from one shared
  vocabulary in `src/types/schemas/lists.ts`. The build's **second** schema
  exception, and with LV.8 the budget is now **spent**: three of three.
  Vocabulary exactly as §3 Q2 approved it. `TIER_BG`/`TIER_BAND_BG` were
  addressed rather than deferred — and the survey that went with it found the
  same widening would have **500'd the public share view**, which was a crash
  and not a colour (§4)
- [x] **LV.4** — **drag-and-drop across all three view styles** (2026-08-11).
  The handoff's drop-gap model, over the existing
  `PATCH …/players/reorder` and `…/players/[playerId]/tier` routes — **no
  migration, no schema change, no new API route**. Reordering works in List,
  Table and Cards; a drop on a section header assigns that bucket **in tier
  mode**, and the two modes that cannot be written say why rather than
  no-oping (see §4). Landed **without LV.1.5**: the dependency was on non-tier
  bucket *assignment*, which is refused with its reason, not faked.
  Original text: *"drag-and-drop across all three view styles (needs LV.3, and
  LV.1.5 for non-tier buckets). The handoff's drop-gap model: the gap opens
  where the player will land, sized to the dragged element's `offsetHeight` /
  `offsetWidth`, state updated **only** when the target slot changes —
  updating per `dragover` visibly janks. A drop onto a section header assigns
  that bucket, and under D4 that is the same write in all four modes"* — the
  last clause is wrong and the plan now carries the erratum (D4, plan v3.8):
  cost and budget membership is **computed**, so there is no write to make
- [x] **LV.5** — **AI list generation + persona surfaces in the new language**
  (2026-08-11). **UI/UX only — no migration, no schema change, no new API
  route**; the budget stays closed at three. The survey found something bigger
  than a restyle: **the v2 screens had no AI surfaces at all.** LV.2/LV.3 built
  `lists/v2/` as new files and neither carried the "Create with AI" trigger nor
  the build banner across, so behind `featureFlags.listsV2` — the launch
  configuration — AI list generation had **no entry point**, a queued job was
  never claimed, and the dialog's `router.push('/app/lists/<id>')` landed on the
  still-placeholder detail route. That is the removal CLAUDE.md → Redesign
  forbids, and nothing failed because nothing asked. Restored, restyled, and
  pinned by `src/components/lists/ai-surfaces.test.ts`. **Personas were taken
  shallow, deliberately and on the record** (§4). Original text: *"AI list
  generation + persona surfaces restyled into the new language (CLAUDE.md: never
  leave them in the old style, never remove them)"*
- [x] **LV.6** — **the public share view, in the new language and still
  server-rendered** (2026-08-11). **UI/UX only — no migration, no schema
  change, no new API route**; the budget stays closed at three. The screen is
  the signed-in open list with everything a stranger cannot do **subtracted**,
  not a second design: `ListHeroShell`, `ListToolbar`, `ListBody`,
  `ListDetailsTab`, `ListCommentsTab` and `ui/tabs` are the *same* components
  the app panel mounts (§4). The design package defines no share screen, so
  every subtraction is listed in `public-list-view.tsx`'s header and pinned by
  `public-share-view.test.ts`. **The LV.1.5 crash was reproduced on this route
  and shown fixed** — the pre-LV.1.5 `Map` shape reinstated for one run gives
  a live `HTTP 500 — Cannot read properties of undefined (reading 'push')` on
  a public list carrying `r1`/`c1` (§4). Original text: *"public share view
  `/u/[username]/lists/[slug]`, still server-rendered (D7)"*
- [x] **LV.8** — **attached links** (2026-08-11). Migration
  `080_list_links.sql` + RLS + indexes, the `/api/lists/[id]/links` routes
  (add / remove / reorder), and the Details tab wired to them. The **third and
  final** schema exception, ruled by Chris 2026-08-11 (plan **D8**, plan
  → v3.7). Closes the disabled action LV.3 shipped and flagged. Reads follow
  the list's own visibility; writes are owner-only. The reorder **route** is
  server-complete and stack-proven; its **client** waits for LV.4, because the
  reference screen shows no reorder affordance and inventing one would be UI
  the design LAW does not ask for
- [x] **LV.9** — **one tab/segment component** (2026-08-11, ruled by Chris the
  same day — plan **D9**, plan → v3.9). `src/components/ui/tabs.tsx` extended
  (never forked) into one style source with three content variations — icon +
  label, label only, icon only — each taking an optional count, and two
  wrappers over it: Radix `Tabs*` where the usage is a genuine tab set, and a
  presentational `Segment` / `SegmentItem` where there is no panel to associate.
  The four hand-rolled `lists/v2` controls and `player-detail-panels.tsx`'s
  Fantasy/NFL toggle converted; the six other Radix call sites picked up the
  look with no edit. `list-detail-view.tsx` (legacy, retired at LV.7) was **not
  opened** — it inherits the look through the primitive. **`week-tabs.tsx` and
  `public-big-board.tsx`'s week strip are the same look again and are deferred**
  to whichever task reopens `src/components/big-board/**` (§4)
- [x] **LV.10** — **DEF renders the team logo, and the image fallback actually
  fires** (2026-08-11, ruled by Chris the same day: *"for DEF use the team's
  logo — that's what all platforms do"*). UI/UX only — **no migration, no
  schema change, no new API route**; `players.headshot_url` is sync-owned and
  is *not* rewritten, the substitution happens at render.
  `src/lib/player-image.ts` is the one place that decides a player's picture
  (DEF → `…/team_logos/nfl/<abbr-lowercased>.png`; the path is case-sensitive
  and uppercase 404s, which is what the new `player-image.test.ts` pins), and
  `src/components/players/player-image.tsx` is the one component that renders
  it. Fourteen call sites converted. The second, larger fix: the two surfaces
  that had hand-rolled an `<img>` fell back to initials only on a **missing
  URL**, never on a **failed load** — they now use the shared `Avatar`
  primitive, which already handled both. **`lists/draft-mode/board-column.tsx`
  has the same bug and is off limits — LV.7 must take the conversion with it**
  (§4)
- [x] **LV.11** — **single-select `FilterChip` rows onto the shared tab/segment
  control** (2026-08-11, ruled by Chris the same day — plan **D10**, plan
  → v4.0). *"Use the tab component for now, we can create one for filters
  later."* This is the answer to the question LV.9 filed and refused to
  improvise around. **UI/UX only — no migration, no schema change, no new API
  route**; the budget stays closed at three. Eleven `FilterChip` rows were
  surveyed and classified before anything was edited: **seven converted**, two
  left multi-select, **two left because zero-selected is a valid state** (§4),
  and the two in `components/leagues/**` needed no edit because they are
  multi-select anyway. `src/components/ui/filter-chip-split.test.ts` pins the
  classification so a later "tidy-up" cannot fold the wrong rows in
- [x] **LV.7** — **the cutover LANDED 2026-08-11.** **UI/UX only — no
  migration, no schema change, no new API route**; the budget stays closed at
  three. Chris ruled §3 Q3 the same day and **all four survive**: *"Right rail
  dragging is a MUST. Yes mini player card 100%, MUST. Just use the one that's
  already there… Folders yes keep folders. Pin and Unpin great keep it."* So
  the task became a **port**, not a rebuild — every one of the four was mounted
  from the component or hook that already existed (§4). Also carried: the
  Recently-viewed push, a writer for `ranking_mode = 'rank_and_tier'` (the
  grouping control inherited the one write the retired Tiers tab made), and
  `/app/lists/[listId]` turned from a placeholder into a redirect that opens the
  panel on the right list. Deleted: the flag, its `.env.example` block, its
  test, `list-detail-view.tsx`, `lists-browse.tsx`, `list-card.tsx`,
  `comments-thread.tsx`, `customize-popover.tsx`, `editable-thumbnail.tsx`,
  `list-detail-page-v2.tsx` and the five-file `lists/draft-mode/**` tree.
  **Both parked obligations discharged by deletion** (LV.10's `board-column.tsx`
  DEF fix, R192's stale `use-board-marks.ts` header). Original text:
  🔴 **HALTED 2026-08-11 on §3 Q3 — nothing deleted, no flag
  flipped.** The capability diff the task text demands *before* the delete
  found one item in the "needs a ruling" bucket: **folders** live only in
  `lists-browse.tsx` + `list-card.tsx`, have no v2 equivalent and appear
  nowhere in the design package, so deleting those files removes a
  database-backed feature. Q3 carries the full three-file diff (every
  capability classified ported / dropped / ruling), the options, and four
  live behaviours LV.7 must carry across when it resumes. **Both parked
  obligations dissolve** — LV.10's `board-column.tsx` DEF fix and R192's stale
  `use-board-marks.ts` header are both inside the `draft-mode/**` tree this
  task deletes whole. Original text: cutover: flag flip, retire the old
  components, and **delete
  `use-board-marks.ts` and the old `/app/lists/draft-mode` 3-state cycle**
  (§1's boards amendment scopes this). Also fixes that file's now-false header
  comment (R192) — it claims parity with `use-draft-mode.ts`, which went false
  at LV.1.3 when that hook started writing to the database.
  **Carries LV.5's forward obligation (§4):** `/app/lists/[listId]` is still
  `ListDetailPageV2`, a placeholder, whenever the flag is ON — reachable from
  "Recently viewed", search and any saved link. Decide whether it renders the
  real panel or redirects to `/app/lists`. Also collapse the
  `featureFlags.listsV2` ternary in `generate-ai-modal.tsx` when the legacy arm
  goes

> **Why this was restructured (2026-08-10).** The previous breakdown cut two
> screens into **twelve** tasks — "page header" and "rail mode" as separate
> milestones — each carrying a full builder + reviewer cycle. Four cycles ran
> and produced only plumbing: a flag, a table, a store with no consumer, a
> rewired hook. Nothing visible. Chris: *"Claude Design was able to do all the
> front end work in my HTML prototype in a few minutes and this job has already
> been running for hours and we can't even see it yet."*
>
> Two compounding errors. **Sequencing** — Phase 2 depended only on LV.1.1 and
> was unblocked from the first merge, but the checklist ran top-down through the
> plumbing first. **Process** — the leagues review protocol (adversarial
> reviewer, break-probes, falsifiability proofs, multi-round fixes) was applied
> uniformly. It is right for a migration; it caught a real data-loss path three
> times. It is overhead on a page header, where the failure mode is "looks
> wrong" and a screenshot shows you that.
>
> **The unlock:** because LV.1.1 landed a route branch, the v2 screens are *new
> files* in `src/components/lists/v2/`. There is no legacy component to unpick —
> the old one serves production until LV.7 flips the flag. **Building them is
> greenfield**, the same job the prototype was, rendering real players instead of
> mock data. It was being treated as surgery on a running system; the surgery was
> LV.1.1 and it is done.
>
> **So for LV.2 and LV.3: build the screen, verify by looking** — screenshots at
> desktop and mobile against the handoff — **and one review pass on design
> fidelity**, not break-probes. Keep the heavy process for LV.1.5, which touches
> the database.

**Lane note:** LV.2 and LV.3 are independent of each other and of everything
outstanding — both need only LV.1.1, which merged first. LV.4 needs LV.3;
LV.1.5 is independent and is the only remaining schema task.

**Note on `budget` — ✅ RESOLVED 2026-08-10 by the screenshots.** Budget
grouping **does** render, and well: `docs/design/lists/screens/detail-grouping-budget-pct.png`
shows a *Share of budget* column — a filled bar plus a percentage per player,
under bucket headers "Over 20% of budget" / "10–20%". It is computed from
**`Cost PPR`, a selectable stat column**, not from a bucket assignment. So D4's
*"nothing is computed"* is true of bucket membership and false of stats.
**Budget grouping is in scope.**

*(This was six paragraphs until 2026-08-10. The length was the plan
manufacturing work — it ended by instructing a future agent to HALT over a
number no screen shows. Trimmed deliberately.)*

---

## 2b. Round 2 task checklist

Task text: **delivery plan §6**, read with the handoff section each task cites.
Pick the first unchecked task whose dependencies (in parentheses) are all
checked.

**Phase 7 — Side by side**

- [x] **LV.12** — **the picker** (2026-08-11). `SideBySidePlaceholder` deleted;
  `src/components/lists/v2/side-by-side-picker.tsx` renders the heading, the
  design's own sub-line, the 232px-min grid (186px at this app's ×0.8) of
  selectable cards, and the CTA that reads `Select at least one list` disabled
  at zero. **UI/UX only — no migration, no schema change, no new API route**;
  the budget stays closed at three. Composes Round 1 rather than re-solving it
  (D11): the cover is `ListCoverTile`, the CTA is `ui/button`, the list data is
  the collection `lists-page-v2.tsx` already holds. Selection is session-only
  (D3) — `React.useState`, no `persist`. **The plan's "honours the My lists /
  Saved tab" clause was wrong and is erratum'd** (plan §6, → v5.1): the picker
  offers every list on the page, own first then saved, which is what the
  prototype and `screens/side-by-side-picker.png` both do — see §4.
  **Fix round 2026-08-11 (R207–R212, §6):** the erratum was re-verified and
  upheld by the Reviewer, but the browser evidence behind it was re-taken —
  the original run was against **hosted production** and over a `saved` set
  that was empty every time, so it never once showed the behaviour the erratum
  exists to protect
- [x] **LV.13** — **the columns** (2026-08-11).
  `src/components/lists/v2/side-by-side-columns.tsx`: 240px fixed panels (the
  design's 300px at this app's ×0.8) in a full-bleed horizontal scroller whose
  negative margin is the **shell's own gutter** (`-mx-4 px-4 / lg:-mx-7
  lg:px-7`, and 28px *is* 36 × 0.8); column header with a 21px cover, the name,
  a live `N of M left` and the `dots` menu — the five grouping modes plus
  `Remove column` under a separator; 30px rows with the permanent drafted
  checkbox, `#N`, the name opening the mini card, position badge and team; and
  tier/round bands carrying their colour through. **UI/UX only — no migration,
  no schema change, no new API route**; the budget stays closed at three.
  **`ComparisonPending` and its `isList` guard are deleted**, and `Change lists`
  is in the page header beside `New list` (rendered twice, so a phone that has
  no shell header still has a way back to the picker). **Composes Round 1 rather
  than re-solving it (D11)**: `list-buckets.ts` groups, `list-row-parts.tsx`
  supplies the checkbox / name / meta / empty state, `cover-tile.tsx` covers,
  `use-draft-mode.ts` marks, `usePlayerWindowsStore` opens the mini card —
  and two shared rules moved *into* `list-buckets.ts` so the panel and a column
  cannot disagree (`bucketHeading`, `rankMap`; §4). **§3 Q4 ruled the same day
  (no cap, no search, no truncation) and the phone question with it (no
  breakpoint treatment)** — both are pinned, not merely obeyed.
  **A tick here is still one tick on one list**; the fan-out across the
  comparison set is LV.14's, governed by D12.
  **Fix round 2026-08-12 (R217–R223, §6):** no behaviour changed — the columns
  were upheld in full. The round widened the no-stacking pin, which caught only
  the desktop-first spelling while `flex flex-col lg:flex-row` (the one a
  developer reaches for) passed green **although two documents cite that pin as
  what makes Chris's phone ruling un-re-addable**; recorded that the picker's
  sub-line is a promise LV.14 has to keep; restored D13's closing paragraph,
  which D14 had been inserted into; and moved the new local fixture's
  re-creation steps into `ACTIVE-BUILD.md`
- [x] **LV.14** — **drafted fan-out across the comparison set** (2026-08-12)
  (D12) (LV.13, LV.1.3). One tick now writes one `list_player_drafted` row per
  list **in the comparison that contains the player**, and none outside it —
  measured live: A.J. Brown ticked in one column struck through in all three and
  wrote exactly **3** rows, while `Secret sleepers`, which holds him and was
  deliberately left out of the picker, gained **0** (§4). **UI/UX only — no
  migration, no schema change, no new API route**; N writes through LV.1.2's
  route, so the budget stays closed at three. The mechanism is a new
  `src/components/lists/v2/drafted-fan-out.ts` — a `.ts` with no JSX **on
  purpose**, so D12's set intersection, its partial-failure protocol and its copy
  are **executed** (28 of its 33 tests) rather than source-pinned. **Composes Round 1
  rather than re-solving it (D11)**: every column keeps its own
  `useDraftMode(listId)` and merely registers, so per-column optimism, rollback
  and invalidation are LV.1.3's, not a second copy. `use-draft-mode.ts` gained
  exactly two things — `setDrafted` (explicit state, awaited) and
  `desiredDraftedFor` — plus `markMutationOptions`, extracted so the per-column
  rollback could be **driven through five real caches** instead of argued from
  cache-key shape (the R190/R195/R199 family). **The forward obligation from
  R220 is discharged**: the picker's sub-line now describes shipped behaviour,
  `side-by-side-picker.tsx`'s JSDoc is in the present tense, and §4's LV.13
  interval note is closed. **The copy was not edited.** LV.13's
  *"a tick is one tick on one list"* pin block was **re-aimed, not deleted** —
  the property it guarded (a tick reaches exactly the lists it should) is the
  same one D12 governs; only the boundary moved

**Phase 8 — Pop-out windows**

- [x] **LV.15** — **the store + the app-shell host** (2026-08-12) (D13) (LV.7).
  `src/stores/list-windows-store.ts` and
  `src/components/lists/v2/{list-window,list-windows-host}.tsx`, mounted once in
  `app-shell.tsx`. **UI/UX only — no migration, no schema change, no new API
  route**; the budget stays closed at three, and the window reads its list
  through the shipped `useList`. **Composes rather than re-solves (D11/D13)**:
  the store is `player-windows-store.ts`'s shape with `w`/`h`/`min` added — same
  array-as-z-stack, same refocus-don't-duplicate, same `partialize` idiom — and
  the drag is `window-shell.tsx`'s pointer-capture, not the prototype's global
  listeners. **The handoff's `z` is the array index**, not a stored field, so
  nothing can disagree with the render order. **The host renders nothing at all
  when no window is open** — an early `return null` before any markup, no
  wrapper, no portal, no provider — *measured* on Home and Players (host
  reachable, **0** nodes, the shell's three children unchanged) and pinned three
  ways, each shown red first. Drag, both resize clamps (**960×720** and
  **264×176**, exactly), collapse, close, back-to-front z-order and survival
  across Players → Lists → Home were all measured live on the **local** stack
  (§4). **One deliberate concession to small screens, flagged for LV.17**: a
  *cascaded* window is pulled back so the whole of it fits when the viewport
  allows — at the design's `120,120` origin a 352px window on a 375px phone puts
  its own close button off-screen. A position the **user** dragged is never
  re-fitted, only rescued.
  **Its review returned FIX-THEN-MERGE with no blockers; the fix round
  (2026-08-12) closed R226–R230** — the headline was that both pins on the
  render-nothing contract anchored on the *first* `return null` rather than the
  guard's, so a `useEffect` running on every route in the app left the suite
  green; and the one behaviour change is **Escape closing the top pop-out**,
  because a window met by a smaller viewport had no reachable way to close (§6).
  **A second independent review then returned FIX-THEN-MERGE with no blockers;
  the second fix round closed R231–R234** — that new Escape guard covered Radix
  and *only* Radix, so an Escape typed into the player-search input on
  **`/app/players`** — a route the app-shell-hosted window survives to — closed
  the pop-out instead of the dropdown. It now also asks *where the key came
  from*, with `button` and `[role=dialog]` deliberately **out** of that selector
  because the window is itself a `role="dialog"` and focus rests on buttons
  constantly. The round also took `docs/specs/PROGRESS-scout.md` — another
  build's memory document, swept in undisclosed — back out of the branch (§6)
- [x] **LV.16** — **dark-inverted window content** (2026-08-12) (LV.15).
  `list-window.tsx`'s body, footer and the two missing header controls, plus the
  inversion itself: **one `fs-dark` wrapper**, its five values declared as custom
  properties in `src/app/globals.css`, and the handful of palette utilities that
  appear inside a pop-out pointed at them — so `PlayerName`, `PositionBadge`,
  `DropGap`, `DraftedCheckbox` and `EmptyListState` invert with **no dark variant
  of any of them** (measured: the same `text-n-3` class reads `#b3b9c0` inside the
  window and `rgb(95,100,109)` on the page behind it). The redirect list exists
  because **this app's palette is literal hex in `tailwind.config.ts`, not custom
  properties** — the LAW's mechanism, implemented against a token layer that is
  not var-backed; see §4. **UI/UX only — no migration, no schema change, no new
  API route**; the budget stays closed at three. **Composes rather than re-solves
  (D11)**: `list-buckets.ts` groups, `list-row-parts.tsx` supplies the checkbox /
  name / gap / empty state, `use-list-drag.tsx` runs the gesture, `use-draft-mode`
  marks, `list-display-store` says which grouping and which stats, and
  `list-toolbar.tsx`'s stat catalog is **exported** rather than copied. What a
  drop *writes* moved out of `list-detail-panel.tsx` into **`use-list-drop.ts`**,
  verbatim, so the panel and the window cannot drift on the refusal toast or the
  sequenced writes. **Both LV.15 hand-offs discharged**: `ListWindowBodyPending`
  is deleted outright (**F-LV15.1**) and the `gear` + `dots` are real, wired
  controls (**F-LV15.2**) — the gear opens that shared catalog *outside* the
  wrapper, as the LAW requires, and `dots` is `ORG_OPTIONS` + per-list `setOrg`.
  **A tick here is one tick on one list** — `use-draft-mode` directly, never
  `drafted-fan-out.ts`; measured live (one row written, and `Secret sleepers`,
  which also holds that player, gained **0**), and LV.14's boundary pin now
  covers this file too.
  **Fix round 2026-08-12 (R235–R242, §6):** the review returned FIX-THEN-MERGE
  with no blockers, and the headline is that **LV.16 made the app's drag layer
  ambiguous without anyone noticing**. `use-list-drag.tsx` read the live DOM
  through `document`, which was right while the detail panel was its only
  consumer; this task added a second surface that *floats over the first*, and
  both write `data-drop-row="all:0"…` into one namespace. A drop released over
  the other surface reordered the dragged list to the **foreign** surface's slot
  index and persisted it (**R235**, reproduced both ways), and a drag inside a
  29px window row opened a **48px** gap (**R236**). Both are closed by scoping
  every DOM read to a root the `ListDragContext` renders itself — no extra
  element, and a consumer cannot forget to attach it. The window also stopped
  offering the viewer's own handle as the owner of a **saved** list once the
  collections cache is gone (**R237** — that link 404s, shown), and the
  hand-maintained `.fs-dark` redirect list is now **audited by a test** rather
  than by memory, which found `bg-n-4` already broken in the tree at **1.61:1**
  (**R238**)
- [x] **LV.17** — **wiring, states, and the phone answer** (2026-08-12) (LV.16).
  `pop out` is real in **both** places the task text names: the detail hero's
  cluster (LV.15 shipped it *disabled behind a tooltip*, and that tooltip's claim
  is deleted, not decorated) and a Side by side column's `dots` menu, both
  through one `list-windows-store.open`. **UI/UX only — no migration, no schema
  change, no new API route**; the budget stays closed at three. **Composes rather
  than re-solves (D11)**: `ListReadFailure` and `ListRowsSkeleton` moved into
  `list-row-parts.tsx` and are rendered by the column *and* the window, so the two
  surfaces cannot spell one situation two ways, and the window's branch order is
  LV.13's — `error → !entries → empty → rows`, which is also the order the data
  forces. **A list that is gone is separated from a failed read** on the error's
  own 404 — and, since the fix round, **the window closes with a neutral toast**
  (*"This list is no longer available."*, Chris's own words, §3 **Q5**) rather
  than staying and naming a cause it cannot know (**R248**: that same 404 is also
  a list that is alive and merely no longer visible to you). **6+ windows: no
  cap** (Q4's ruling, one screen along); the cascade wraps after six, measured
  with **seven** open — the seventh back at `96,96`, all at `z-index: 45`, one
  Escape closing exactly one. **F-LV15.3 is discharged**, and the answer it was
  discharged with — *"the phone gets the same window"* — was **overruled by Chris
  (§3 Q6)** and rebuilt as a real bottom-sheet variant: full width × 60% height,
  toolbar = `Options` + `Close`, one breakpoint at **768**, desktop
  bit-identical. LV.15's size fit and the grip started from the painted corner
  are the desktop half and stand. Popping a column out **does not remove it** —
  the comparison set is what a tick fans out over (D12). **One change reaches
  outside the diff and is called out**: `useList` no longer retries a **404**
  (narrowed from `< 500` at **R252**). The premise recorded for it — that the
  state was *"not reachable at all"* — was **false and is corrected at R249**: it
  was reachable one retry later, and the change stands on being immediate.
  R243–R247 from LV.16's review are carried in §6, and **R248–R255 from LV.17's
  own review are resolved there too**

The seven LV.7 follow-ups (**F-LV7.1 – F-LV7.7**, §5) remain **filed items, not
queued tasks** — Round 2 does not absorb them.

---

## 3. Design questions

*(A Builder that finds the handoff wrong or ambiguous files the question here
with a recommendation and HALTs — it never improvises.)*

### Q1 — LV.1.3 cannot land as written (filed 2026-08-09, orchestrator)

**The conflict.** LV.1.3's task text says "point `use-draft-mode.ts` **only** at
the new server source". That hook has exactly two consumers:

| Consumer | Problem |
| --- | --- |
| `src/components/lists/list-detail-view.tsx:286` | the **legacy** detail view — serves production today behind flag OFF. LV.1.1 established that flag-OFF must be byte-for-byte the current experience, so rewiring it changes production |
| `src/components/lists/draft-mode/board-column.tsx:35` | inside `src/components/lists/draft-mode/**`, which ACTIVE-BUILD declares **off limits** |

There is also no v2 consumer yet — the v2 detail screen is LV.3.x, unbuilt — so a
server-backed `use-draft-mode` would today serve only the two surfaces it must not
change. The plan's dependency graph (LV.1.3 depends on LV.1.2 alone) is wrong: it
also depends on a v2 consumer existing.

**Recommendation.** Re-scope LV.1.3 to *add* a new server-backed hook (consuming
`src/lib/lists/drafted-service.ts` from LV.1.2) for the v2 surface, leaving
`use-draft-mode.ts` and both its consumers untouched. Legacy keeps localStorage
until LV.4.4 retires it wholesale. Also fold in nits **R176** (the GET path
collapses "no marks" with "not permitted") and **R178** (extra `auth.getUser()`
round-trip on the retry path), both of which land in this hook's code path.
Alternative if rejected: move LV.1.3 to depend on LV.3.9 and build it there.

#### ✅ RULED — Chris, 2026-08-09: **build it as originally written.**

*"We don't have any users yet so no one has marked anyone as drafted."*

That dissolves the premise the recommendation rested on. The objection was
"rewiring the shared hook changes production behavior" — but there are **no
users and therefore no existing drafted marks**, so there is no data to
preserve and no behavior anyone would notice changing. LV.1.3 is **unparked**
and proceeds as its task text says: point `use-draft-mode.ts` itself at the
server source. One mechanism, no duplicate hook to delete at LV.4.4.

**Accepted consequences, recorded so they are not rediscovered as bugs:**

1. **The Lists draft-mode board (`/app/lists/draft-mode`) also gains
   account-persisted marks**, because `draft-mode/board-column.tsx:35` consumes
   the same hook. **No file inside `src/components/lists/draft-mode/**` may be
   edited** — the boards-off-limits rule (§1) still holds on the *diff*. The
   behavior change flows through the shared hook and is accepted; it is
   arguably an improvement, and that surface is flag-gated at launch.
2. **The flag-OFF legacy list detail view starts making network calls** for
   drafted marks where it previously read localStorage. With no users this is
   tolerable, and LV.4.4 retires that view. It must still not throw — a failed
   read renders as "no marks", never a crashed page.
3. The migration from any existing localStorage marks is **not** required — no
   users, nothing to migrate. Do not build a migration path.

Also fold in the two open nits that land in this code path: **R176** (the GET
path collapses "no marks" with "not permitted") and **R178** (extra
`auth.getUser()` round-trip on the retry path).

### Q2 — LV.1.5 cannot land as written: `list_players.tier` has a CHECK constraint (filed 2026-08-09, Builder)

**The conflict.** Plan §3 **D4** says, of widening the tier route's Zod enum:

> The column is already `text`, so this is a validation change on an existing
> route — **not** a schema change, and inside UI-only scope.

**That premise is false.** The column is `text` **with a CHECK constraint**:

```
supabase/migrations/003_lists.sql:40-43
  ALTER TABLE list_players DROP COLUMN IF EXISTS tier;
  ALTER TABLE list_players
    ADD COLUMN tier TEXT
    CHECK (tier IS NULL OR tier IN ('S', 'A', 'B', 'C', 'D', 'F'));
```

No later migration alters it (`ALTER TABLE list_players` appears in only 001,
003 and 015; 015 touches `slot`, not `tier`). It is **live in both places**:

| Where | `pg_constraint` says |
| --- | --- |
| Local, fresh full chain | `list_players_tier_check` → `CHECK (((tier IS NULL) OR (tier = ANY (ARRAY['S','A','B','C','D','F']))))` |
| **Hosted production** | byte-identical (read via `pg_get_constraintdef`, read-only query) |

Proven end-to-end against a live DB, not inferred from the file — one real
`list_players` row, one transaction, rolled back:

```
tier = S  -> ACCEPTED
ERROR:  new row for relation "list_players" violates check constraint
        "list_players_tier_check"
DETAIL: Failing row contains (…, 1, r1, null).
psql exit=3
```

So widening the Zod enum alone does not deliver round buckets — it moves the
rejection from a clean **400** (Zod) to a Postgres `23514`, which
`…/tier/route.ts:56-58` returns as an **HTTP 500 with a raw database message**.
That is strictly worse than today. And the only way to make the widening
actually work is `ALTER TABLE … CONSTRAINT`, i.e. **a migration** — which plan
§1, **D6**, §5 DoD item 3 and `ACTIVE-BUILD.md` all forbid ("LV.1.2's table was
the ONLY permitted schema change"). Plan §5 DoD item 3 says what to do about
exactly this: *"A task that thinks it needs more has left scope: raise it, do
not proceed."*

This is a spec-vs-codebase conflict, not an implementation problem: **no
implementation exists** that widens the accepted bucket set without a schema
change.

**Blast radius, so the ruling is priced correctly.** Anything that widens the
*stored* set also touches, and none of it is optional:

| Surface | Why it is implicated |
| --- | --- |
| `src/types/schemas/lists.ts:4` `TIER_VALUES` | exported and **used nowhere**; the route inlines its own duplicate at `:7`. Whoever lands the widening should collapse these to one source rather than widening a second copy |
| `src/types/database.ts:3564` `ListTier = 'S'\|'A'\|…\|'F'` | hand-written alias block (the one typegen clobbers). Recommend it stays **exactly S–F** as the tier-mode subset, with a new `ListBucketKey` for the full wire set — so the legacy views keep compiling |
| `tier-badge.tsx` `TIER_BG` / `TIER_BAND_BG` (`Record<ListTier, string>`) | **total maps with no fallback.** `TIER_BAND_BG['r1']` is `undefined` → `cn(undefined)` → a silently uncolored band. Both the flag-OFF legacy detail view and the public share view (`/u/[username]/lists/[slug]`, SEO-critical per D7) render through these |
| `list-detail-view.tsx:103` `TIERS: ListTier[]` | the legacy six-section layout |
| `duplicate_list` RPC (`017_duplicate_list_rpc.sql:66-70`) | copies `tier` verbatim, bypassing Zod entirely — which is the concrete reason a DB-side CHECK is worth keeping rather than dropping |

Not implicated, checked: `/api/lists/big-board/route.ts` and
`/api/big-board/{route,save,week}` only **read** `tier` in a SELECT list or do
not mention it at all — no validation, no write. **A tier-vocabulary change
alters no board behaviour**, so nothing here requires opening the off-limits
board components.

**The vocabulary itself — designed, so the ruling is a yes/no and not a design
session.** One closed, bounded set; `null` stays "ungrouped".

| `org` label set | Wire keys | n | Rendered as |
| --- | --- | --- | --- |
| tier | `S` `A` `B` `C` `D` `F` | 6 | today's `TierBadge`, unchanged |
| round | `r1` … `r30` | 30 | "Round 1" … "Round 30" |
| cost | `c1` `c2` `c3` `c4` | 4 | `DEFAULT_COST_BANDS` labels, owner-renameable |
| budget | *(reuses `c1`–`c4`)* | 0 new | same buckets, different label set |

Matched by `^([SABCDF]|r([1-9]|[12][0-9]|30)|c[1-4])$` — 40 values plus `null`.

1. **`DEFAULT_COST_BANDS`' `c1`–`c4` are adopted on the wire** (the
   reconciliation the LV.1.5 task text demands, R183). There is no reason to
   mint a second alphabet, and adopting them means **every key the route
   accepts has a default label**, so `resolveBandLabel` never falls through to
   rendering a raw key — precisely the failure §2 records for the prototype's
   `b1`–`b4`. Deliberately **not** widened to `c5`+: a fifth band would have no
   default label and would render the literal `c5` in the rail.
2. **Budget mints no keys.** D4 makes budget a *label set* over the same
   bucket mechanism, and plan v3.4/R185 records that budget has no consumer at
   all. Minting `b1`–`b4` would create label-less keys for a mode that may not
   ship. If budget mode ever ships, it relabels `c1`–`c4`.
3. **Round ceiling 30, and it is a judgement call worth challenging.** D4 says
   a draft runs 12–16. Thirty is the deepest draft the app's own league
   settings can construct (`league-settings.ts:153` caps `bench` at 20, plus
   starting slots; D91: `total_rounds` = Σ starters + bench, IR excluded), it
   nearly doubles D4's stated range, and it keeps every key ≤ 3 characters.
   Raising it later is one edit to the regex and one to the CHECK.
4. **What must NOT be accepted is enforced by the shape, not by a comment.**
   The set is closed, so: max length **3** (nothing can overflow LV.3.5's 62px
   label rail or a section header); `[A-Za-z0-9]` only (no control characters,
   no whitespace, no Unicode, no bidi overrides, nothing needing escaping in a
   React `key` or a URL); **`__proto__` / `constructor` / `hasOwnProperty` are
   unreachable**, closing the R181/R183 hazard at the source as well as at the
   reader — `resolveBandLabel`'s `hasOwnProperty` guard **stays** as defence in
   depth, since it is correct for any caller-supplied record; and `''` is not a
   bucket (ungrouped is `null`, as today).

**Options.**

| | Option | Cost | Verdict |
| --- | --- | --- | --- |
| **A** | **Widen the CHECK to mirror the Zod set exactly**, then widen Zod. One migration, `080_list_players_tier_vocabulary.sql`: `DROP CONSTRAINT IF EXISTS list_players_tier_check` then re-add with the regex above. Strictly a **superset** of the old predicate, so no backfill and no data migration — every existing row already satisfies it. Fully reversible. Reaches production by `npx supabase db push`, never by hand | one migration file; D6 goes from two named server-side changes to two-and-a-half | **Recommended.** The only option that delivers D4 as written. D6 already blesses "widening one Zod enum" as a deliberate server-side change — it simply under-counted what that requires. The DB-side CHECK is also the *strongest* answer to the task's own "what must NOT be accepted", and the only one that covers `duplicate_list`, which never sees Zod |
| **B** | Drop the CHECK entirely; Zod becomes the only gate | same migration cost | **Rejected.** Does not avoid the scope question, and is strictly worse than A: `duplicate_list` copies `tier` verbatim, so the free-text exposure R181 flagged becomes fully real at the DB |
| **C** | **Cut round/cost/budget grouping from Round 1**; tier grouping only | no migration; a product reduction | **Acceptable fallback.** LV.1.5 shrinks to a coherence task (make the route import `TIER_VALUES` instead of inlining a duplicate). D4 collapses to one label set, LV.3.2's dropdown ships Tier-only, LV.3.6 still works in tier mode, and R185's budget tension dissolves. Only Chris can take this — it removes a feature D4 names |
| **D** | Store round/cost buckets outside `list_players.tier` | larger schema change | **Rejected by D4** — *"There is no separate `round` or `cost` field"* |

**Recommendation: A**, with **C** as the fallback if the migration budget is
genuinely closed. Under A, LV.1.5 lands as one PR: migration 080 + the widened
Zod set sourced from `TIER_VALUES`' file + `ListBucketKey` + tests pinning
S–F-still-works, `r1`/`r30`/`c4`-now-accepted, and `r31`/`c5`/`''`/`__proto__`/
a 200-char string all rejected — with the DB reached, not just the schema.

**Fold-back deferred on purpose.** D4's "not a schema change" sentence and §5
DoD item 3 both need a plan edit, but the edit differs per option, so the plan
is **left untouched** rather than amended toward an unruled outcome (the Q1
precedent). Whoever lands the ruling folds it into the plan changelog as v3.5
and ticks the §2 rows here.

#### ✅ RULED — Chris, 2026-08-09: **Option A. Widen the CHECK.**

*"That's fine, do the database change."* LV.1.5 is **unparked** and now includes
one migration (`ALTER TABLE list_players` — drop the S–F CHECK, add the wider
one). This is the build's **second and final** schema exception; plan §1 and D6
updated, D4's false "not a schema change" sentence replaced with the erratum,
plan → **v3.5**.

The proposed vocabulary in this question is **approved as proposed** unless the
LV.1.5 Builder finds cause to change it, in which case it records why:
`^([SABCDF]|r([1-9]|[12][0-9]|30)|c[1-4])$` — S–F tiers, rounds 1–30, cost
bands `c1`–`c4` adopted on the wire so every accepted key has a default label
and `resolveBandLabel` never renders a raw key. Budget mints no keys (D4 makes
it a label set, and R185 records it has no consumer).

**Both the CHECK and the Zod enum must be widened together**, and the migration
reaches production only via `npx supabase db push` — never by hand
(CLAUDE.md migration discipline).

Carry forward from the halt report — the Builder flagged, unfixed:
`TIER_BG`/`TIER_BAND_BG` in `src/components/lists/tier-badge.tsx` are total
`Record<ListTier, string>` maps with **no fallback**, so `TIER_BAND_BG['r1']`
is `undefined` → a silently uncolored band, in both the flag-OFF legacy view
and the SEO-critical public share view (D7). LV.1.5 should address or
explicitly defer it.

### Q3 — LV.7's capability diff found a whole feature with no v2 equivalent: **folders** (filed 2026-08-11, Builder)

**Nothing was deleted.** LV.7's task text requires the capability inventory to
be produced *before* the delete, and to classify every item **ported /
deliberately dropped / needs a ruling**, halting on the third. One item is in
the third category, and this question is only about that one. Everything else
is classified below so the ruling can be taken once.

#### The conflict

`lists-browse.tsx` and `list-card.tsx` are the **only** UI for list folders.
Deleting them removes the feature from the product while its database table,
its API and its hooks stay behind:

| Layer | Evidence |
| --- | --- |
| Table | `supabase/migrations/015_team_lists_and_folders.sql` (`list_folders`), `016_fix_folder_thumbnail_policies.sql`; `lists.folder_id` FK |
| API | `src/app/api/folders/route.ts`, `[id]/route.ts`, `[id]/thumbnail/route.ts` — full CRUD + image |
| Hooks | `src/hooks/use-folders.ts` — `useFolders`, `useCreateFolder`, `useUpdateFolder`, `useDeleteFolder`, `useMoveListToFolder` |
| UI — **all of it in the two files LV.7 deletes** | `lists-browse.tsx:206-301` (folder grid, open/scope crumb, rename, delete, per-folder count), `lists-browse.tsx:323` + `src/app/app/lists/page.tsx:54` (`FolderFormDialog`, create), `list-card.tsx:216-241` (**Move to folder** submenu) |
| v2 | `src/components/lists/v2/**` contains the string `folder` **zero** times |

The `folder-drop:` handler in `app-dnd-context.tsx:137-168` is *already* dead —
the redesigned nav registers no `folder-drop:` droppable — so after LV.7 the
whole feature is server-side only, reachable by no gesture in the app.

**Why this is a stop and not a judgement call.** CLAUDE.md → Redesign is
explicit that the prototype's silence is not permission to delete: *"exist in
the app but not the prototype. Keep them and restyle them in the new design
language — never leave them in the old style, never remove them."* **LV.5 is
the precedent**, and it is exact: it found the AI surfaces missing from
`lists/v2/`, called that *"the removal CLAUDE.md → Redesign forbids"*, and
restored them rather than accepting the loss (§4). Folders is the same shape,
one level up — a feature with a table rather than a dialog.

But the design package cannot be followed here either: `docs/design/lists/README.md`
mentions folders **nowhere**, its `List` shape (§"Data model") has no folder
field, and neither the Lists page nor the rail in `screens/*.png` has anywhere
to put one. So building a v2 folders UI would be improvisation against silent
LAW — the thing plan §1 forbids outright — and deleting it silently is the
thing CLAUDE.md forbids. **There is no third option a Builder may take.**

Chris approved the cutover with *"losing the old page is fine"*. That is read
here as a statement about the **page**, not about a CRUD feature that happens
to be hosted on it — which is exactly the distinction LV.5 had to make and got
right. If it was meant to cover folders too, option A below is one word.

#### Options

| | Option | Cost | Verdict |
| --- | --- | --- | --- |
| **A** | **Drop folders.** Delete the two files as LV.7 says; record the removal as a decision. The table, the four API routes and `use-folders.ts` stay (deleting server surface is outside LV.7's UI-only scope), so the data is intact and a future task can bring the feature back | one D-entry; `use-folders.ts` and `folder-form-dialog.tsx` become orphaned client code | **Recommended.** No users exist (Chris, §3 Q1 — *"We don't have any users yet"*), so no folder has ever been created; the design has no place for folders; and the 2026 launch is Lists + stats + AI lists, where a folder tree on ~5 lists earns nothing. Taking it as a **recorded decision** rather than a silent deletion is the whole point of asking |
| **B** | **Keep folders, build them into v2.** A folder concept in the rail / gallery | a screen design that does not exist, plus a Builder task | Available, but it is a design task before it is a build task, and it is not LV.7 |
| **C** | **Keep folders by keeping the old page** at a second route | two Lists pages diverging from the first commit | **Rejected** — this is the state LV.7 exists to end |
| **D** | Drop folders **and** delete the table/routes/hooks | a fourth schema change | **Rejected** — the budget is closed at three (plan §1), and dropping a table to tidy up a UI task is the wrong trade |

**Recommendation: A**, with the orphaned client files (`folder-form-dialog.tsx`,
`use-folders.ts`, `app-dnd-context.tsx`'s `folder-drop:` arm) deleted in the
same PR so no dead code is left implying the feature still exists.

#### The rest of the diff — no ruling needed, listed so the ruling is complete

Everything below is a Builder classification, not a question. Four items marked
**PORT** are things LV.7 should carry across in the same PR once it is
unparked; they are cheap and each is a live capability that would otherwise
vanish with no record.

**`list-detail-view.tsx` (2,198 lines) → `lists/v2/list-detail-panel.tsx` + parts**

| Legacy capability | Disposition |
| --- | --- |
| Back button + `Lists / <title>` breadcrumb | **dropped** — structural; v2 opens lists in a panel, there is no page to go back from |
| Share (copies the *app* URL) | **ported, improved** — v2 copies the public `/u/<handle>/lists/<slug>` link |
| Draft-mode toggle | **dropped by ruling** (Chris 2026-08-10 — the checkbox is permanent) |
| Reset list → `clearDrafted` | **ported** — hero dots → *Clear drafted*, same R190/R195/R201 guard |
| Duplicate | **ported**; v2 toasts instead of navigating to the copy (there is no detail route to navigate to) |
| Delete list **behind a confirm dialog** | **ported, the confirmation is not.** v2 deletes straight off the menu item. It is a soft delete with a toast and Trash restore, so it is recoverable — but a mis-click now costs a round trip through Trash. Recorded, not fixed: adding a dialog v2 never had is a design call |
| Inline rename · description · badges · Add-a-player · stat picker · view styles · tier board · remove player · empty states · comments | **ported** (several improved — description is editable in the Details tab, all five groupings are real, Comments gained the enabled/disabled gate at LV.6) |
| Arrow-key reorder, `Escape` deselect, click-to-select | **dropped, already on the record** — LV.4 §4 filed "there is no keyboard drag" as a known gap and said a keyboard/AT path is worth its own task. LV.7 does not widen that gap, it inherits it |
| `hide_order` disabling reorder | **dropped, minor** — v2 reads `ranking_mode` (`unranked → rank`) and lets an unranked list be dragged. The write is legal and the order is stored; only the "this list has no order" intent is lost |
| **Pin / Unpin a list** (`useToggleFavorite` from `use-lists.ts`) | **PORT.** `list-card.tsx` is its **only** consumer — verified: `players-spreadsheet.tsx` imports the same-named hook from `use-favorites.ts`, which favourites *players*. After LV.7 there is no way to pin or unpin a list anywhere in the signed-in app; only `PinListButton` on the public share page survives, so unpinning your own saved list means finding its public URL. One `DropdownMenuItem` in the hero and one in the gallery card |
| **Drop zone for players dragged from the right rail** (`list-drop:detail:<id>`, `tier-add:<id>:<tier>`) | **PORT.** `layout/rail/players-panel.tsx:112` makes every rail row a `kind:'players'` draggable and its own comment says *"Rows drag into lists via the app DndContext"* — and `list-detail-view.tsx:392` registers the **only** `list-drop:` droppable left in the codebase. Delete it and the rail's drag lands on nothing, silently. `app-dnd-context.tsx:185-188` parses the id generically (`overId.split(':').pop()`), so one `useDroppable` on the v2 panel restores it with **no** change to the app context |
| **`useHistoryStore.push`** → Home's "Recently viewed" | **PORT.** Only `src/app/app/lists/[listId]/page.tsx:43-53` records a list view, and that is the legacy arm. Behind the flag nothing has recorded one since LV.1.1 — which is also why LV.5's forward obligation (that route is *reachable from* Recently viewed) is currently reachable from an empty shelf. It belongs on the panel now, since the panel is the detail view |
| **Click a player → player pop-out window** (with list context, so the window offers *Remove from list*) | **PORT — and the design LAW asks for it.** §"View style: List": *"name 14px/600 on line one (**opens the player mini card on click**)"*, and again for Cards: *"name 15px/600 centered (opens the mini card)"*. v2 rows have no open affordance at all (`lists/v2/**` never touches `player-windows-store`). This is an LV.3 gap rather than an LV.7 removal, but LV.7 is the commit that makes it user-visible |
| **Team lists → `PositionBoard`** (roster slots, Start/Bench, eligibility, capacity caps) | **deliberately dropped.** `featureFlags.teams` is off for launch and `src/app/app/teams/[teamId]/page.tsx` is *already* a `PlaceholderPage`, so the teams surface is mid-rebuild regardless; `/api/lists` does not filter `is_team`, so a team list opened from the Lists page will render as an ordinary ranked list. Consequence to record, not fix: `useSetPlayerSlot` (`use-lists.ts:333`) loses its only consumer and `/api/lists/[id]/players/[playerId]/slot` goes unused. Deleting either is server-side and outside LV.7 |
| **The List order / Tiers control, which *wrote* `lists.ranking_mode`** | **dropped — with a consequence worth ruling on separately.** D3 makes grouping session-only and D4 makes `org` a label set, so v2 correctly never writes it; `resolveOrg` only *reads* it. But `list-detail-view.tsx:864` is the **last writer of `rank_and_tier` in the codebase** — `list-form-dialog.tsx:160` sends only `unranked` or `ranked`, and `/api/lists/route.ts:274-280` reaches `rank_and_tier` only from a `tiers_enabled: true` payload nothing sends. **After LV.7 no list can ever be `rank_and_tier` again**, so `resolveOrg(null, …)` always answers `'rank'` and tier grouping is per-session for everyone, forever. The list-create dialog still promises the opposite in its own copy: *"Numbered 1–N. **Flip on the tiers view any time.**"* LV.1.4 §4(2) explicitly left this decision to a later task and no task took it |
| **`EditableThumbnail`** — upload / replace the list image | **dropped, and the design disagrees.** The v2 cover still *renders* `thumbnail_url` (`cover-tile.tsx:143-149`), so existing images keep showing; nothing can set or clear one. The design LAW's options menu leads with **Change image** (§"Lists page"), alongside *List type*, *Insights* and *Archive* — all four are LV.3 carve-outs that were never filed. Worth one follow-up task, not a blocker |
| **Like / upvote a list** | **dropped, and the design disagrees.** Design LAW: *"Views and likes sit right-aligned on the tab row."* The v2 panel renders views only; LV.6 put the like **count** on the public view but as a number, not a control. `useToggleLike` survives via `explore-feed.tsx` (flag-gated off at launch). Same follow-up |

**`lists-browse.tsx` (335) → `lists/v2/lists-page-v2.tsx`**

| Legacy capability | Disposition |
| --- | --- |
| **Folders** — grid, create, rename, delete, scope crumb, per-folder count | ⚠️ **the ruling above** |
| Position filter row · tag filter row (multi-select) | **dropped by design** — `screens/list-rail-list-view.png` and `cards-gallery.png` show the mode segment and My lists / Saved and nothing else. Note this is the reason LV.11 converted the position row two days before LV.7 deletes it; that work is not wasted, the same conversion covers `weekly-ranks`, the rail and the AI modal |
| Draft-mode CTA → `/app/lists/draft-mode` | **dropped by ruling** — that surface is what LV.7 deletes |
| Sort by `updated_at` desc | **changed by design** — v2 keeps the API order with the permanent Favorites list first |
| Loading / error / empty states | **ported, improved** — v2 added the `fetchStatus: 'paused'` branch after a break probe found a false empty state (§4, LV.2) |
| — | **gained:** My lists / Saved tabs, which the legacy page had no concept of |

**`list-card.tsx` (325) → `lists/v2/list-gallery-card.tsx`**

| Legacy capability | Disposition |
| --- | --- |
| Open · Duplicate · Rename · Make public/private | **ported** — rename and visibility moved to the hero, which is where the design puts them |
| **Pin / Unpin** | **PORT** — see the detail table |
| **Move to folder** | ⚠️ **the ruling above** |
| Delete behind a confirm dialog | **ported, the confirmation is not** — same as the detail view |
| Badges: positions / `Empty` / `All positions`, tags, `Big board`, `Team` | **partly ported.** Positions and the count survive; tags moved to the Details tab. `Big board` is unreachable anyway (`/api/lists` excludes big boards unless asked — `route.ts:68`). `Team` is gone with team support |
| — | **gained:** Copy share link, description clamp, author byline, view count |

**Verified as *not* implicated**, so they are not in the tables: `share-link-permanence.test.ts`
(slug generation is untouched by anything here), `public-list-view.tsx` and
`public-list-card.tsx` (LV.6's surface, no legacy import), `comments-thread.tsx`
(the legacy detail page's only consumer — it is superseded by
`lists/v2/list-comments-tab.tsx`, so it is orphaned rather than a lost
capability), `customize-popover.tsx` (orphaned the same way;
`players-spreadsheet.tsx` has its own private component of that name at
`:932`), and `src/components/big-board/**`, which LV.9/LV.11 deferred and which
this task confirms is **still off limits** — §1's amendment reopens
`lists/draft-mode/**` only.

#### What LV.7 should do when it resumes

1. Take the ruling on folders (A / B / C).
2. Carry the four **PORT** items in the same PR — pin/unpin, the rail drop
   zone, the Recently-viewed push, and the player mini-card on row click.
3. Rule or record the `rank_and_tier` consequence.
4. File the three design-package gaps LV.3 never filed (**Change image**,
   **List type**, **Insights**, **Archive**, plus **likes on the tab row**) as
   follow-ups rather than letting the cutover bury them.
5. Then the mechanical half, which is not in doubt: flag removal, the three
   deletions, the `draft-mode` tree, the `generate-ai-modal.tsx` ternary
   (`:183`), `lists-v2-flag.test.ts` (**it pins only the flag and the branch
   direction — read in full, nothing in it survives the flag**), and the
   `NEXT_PUBLIC_FLAG_LISTS_V2` block in `.env.example` (`:60-73`).

**Both parked obligations dissolve, and this is the evidence:** LV.10's
`board-column.tsx` DEF-headshot fix and R192's false header comment in
`use-board-marks.ts` are both inside `src/components/lists/draft-mode/**`,
which LV.7 deletes in its entirety — `board-column.tsx`, `board-stage.tsx`,
`draft-mode-view.tsx`, `select-stage.tsx`, `use-board-marks.ts` and
`src/app/app/lists/draft-mode/page.tsx`, 725 lines. Nothing survives to carry
either obligation. They are discharged by deletion, not by a fix.

**Fold-back deferred on purpose.** The plan needs an edit whichever way this
goes, but the edit differs per option, so the plan is **left untouched** rather
than amended toward an unruled outcome — the Q1/Q2 precedent. Whoever lands the
ruling folds it into the plan changelog and ticks §2.

#### ✅ RULED — Chris, 2026-08-11: **keep all four. The recommendation was wrong.**

> *"Right rail dragging is a MUST. Yes mini player card 100%, MUST. Just use
> the one that's already there. This is why I didn't want to rebuild from
> scratch, I didn't think this was necessary. Folders yes keep folders. Pin and
> Unpin great keep it."*

**Folders stay** — option A is rejected. Nothing on the PORT list is dropped
either; the question had put three of them in a "no ruling needed" bucket and
the ruling closed all four together.

**The second half of that ruling is the more important one, and it is a
correction to how this build has been working.** CLAUDE.md → Redesign says it
first:

> **Re-skin in place.** Restyle the existing shadcn/Radix/CVA components in
> `src/components/ui/` via tokens and variant styles. **Do not generate a
> replacement component library or parallel component tree.**

`lists/v2/**` was built as a parallel tree anyway, and a rebuild loses
accumulated behaviour *by default* — which is exactly what this capability diff
caught, one task before the deletion would have made it permanent. So LV.7 was
executed as a **port**: for each item, find the thing that already works and
mount it.

| Ruled item | What was mounted, not rebuilt |
| --- | --- |
| Right-rail drag | one `useDroppable({ id: \`list-drop:detail:\${listId}\` })` on the panel shell. `app-dnd-context.tsx` was **not edited** — it already parses that id shape |
| Player mini card | `usePlayerWindowsStore().open()` → the existing `player-window.tsx` / `player-windows-layer.tsx`, with the list context that puts *Remove from list* in it. No second card component exists |
| Folders | the existing `use-folders.ts` hooks and `folder-form-dialog.tsx`, with the retired page's grid and scope crumb carried across (`v2/lists-folders.tsx`), minus the per-folder *Draft mode* button, whose destination this task deletes |
| Pin / unpin | `useToggleFavorite`, in the hero menu and the gallery card menu — the two surfaces that replaced `list-card.tsx` |

**The `folder-drop:` arm in `app-dnd-context.tsx` was left in place and left
dormant.** Reviving it needs a `kind: 'list'` draggable, and nothing in v2 makes
a list draggable — building one would be inventing a gesture the design package
does not describe, which is the improvisation this question exists to avoid. The
carried UI files lists through the same *Move to folder* menu it always used, so
nothing is unreachable.

**The `ranking_mode` consequence is closed, not just recorded** — see the LV.7
entry in §4.

**The design-package gaps (Change image, List type, Insights, Archive, likes on
the tab row) are filed in §5 as follow-ups**, exactly as this question asked,
and none was silently picked up.

---

### Q4 — the picker (and therefore LV.13's columns) has no upper bound (filed 2026-08-11, LV.12 fix-round Builder, from review finding **R212**)

**Status: ✅ RULED — Chris, 2026-08-11 (option A + no phone variant).** Both
rulings are in full below, and both are folded into delivery plan **D14**.
Nothing was ever blocked: LV.12 was correct as shipped and this was never a
defect in it. *(The header read "🟡 OPEN — needs a ruling before LV.13 builds
columns" until the LV.13 review round — **R222** — even though this very PR
recorded the ruling and shipped the columns. The recommendation line below was
already correctly marked overtaken; only the header was stale.)*

**The gap.** The design LAW's *Mode: Side by side* → *Picker* bullet
(`docs/design/lists/README.md:181`) describes *"a 232px-min grid of selectable
list cards"* and stops there. It names no search, no filter, no cap, and no
scroll treatment, and the prototype's seed carries **9** lists
(`docs/design/lists/design/lists.js`), so the reference screenshot never shows
the grid under pressure. The picker consequently renders **every list the
account holds, unbounded**, and the CTA can commit **all of them** as columns.

**This is not created by the LV.12 erratum, and that matters for how it is
answered.** Removing the tab clause widened the offered set from one tab to
both, which is at most a 2× change on a set that already had no ceiling. The
unbounded-ness is in the design, not in the deviation — so "reinstate the tab
filter" is not a fix for it and must not be adopted as one.

**Why it is worth a ruling before LV.13 rather than after.** LV.13 turns each
picked list into a **300px fixed-width panel in a horizontal scroller**. The
picker degrades gently (a taller grid); the columns degrade sharply — 20 picked
lists is 6,000px of horizontal scroller with the drafted checkbox live in every
one of them. The cost of deciding late is paid in LV.13's layout, not here.

| | Option | Cost | Risk |
| --- | --- | --- | --- |
| **A** | **Rule it a non-problem for the 2026 test cohort** and revisit on real usage. Nothing is built | none | a friend with 40 lists meets a 40-card grid on draft night |
| **B** | **Cap the *comparison*, not the picker** — the grid still shows everything, the CTA stops accepting picks past N (the design's own copy already counts: `Show N lists side by side`) | small, and it lives in LV.12's committed state | picks a number the design package does not supply |
| **C** | **Add a search/filter field above the grid** | a new control the design package does not describe, in the surface whose whole erratum was about *not* filtering | inventing UI is the thing this build has twice been corrected for (LV.7, and the tab clause itself) |
| **D** | Cap the picker's *rendered* set (e.g. most-recent N) | cheapest to draw | a list you own silently not being offered is the worst outcome on this list — it is "nothing happened means it worked" as a layout decision |

**Recommendation: A now, B when LV.13 lands, and never B, C or D without Chris.**
The 2026 cohort is friends running test leagues (CLAUDE.md → Active Builds), so
the realistic account holds single-digit lists and A costs nothing to hold. B is
the honest place for a limit if one is wanted, because it constrains the thing
that actually degrades (the scroller) while never hiding a list from its owner.
C and D are product decisions with design-package consequences and belong to
Chris, not to a Builder.

**A Builder must not build a search, a cap, or a truncation on the strength of
this entry** — it is filed to be answered, not to be actioned.

#### ✅ RULED — Chris, 2026-08-11: **Option A. Nothing is built; revisit on real usage.**

Side by side gets **no cap, no search field, and no truncation.** The picker
offers every list, the CTA commits every pick, and the scroller is as long as it
is. **B is not adopted "when LV.13 lands"** — the recommendation's own second
clause is overtaken by this ruling; a limit of any kind now needs a fresh ruling
from Chris, not this entry.

**If the scroller feels wrong at 20 columns, that is a finding to file, not a cap
to add.** LV.13 built it this way: `ids.map` over the whole comparison, no slice,
no ceiling.

#### ✅ ALSO RULED — Chris, 2026-08-11: **Side by side gets no phone-specific treatment.**

> *"id say leave the phone version as is"*

The columns scroll horizontally at **every** width — no stacking, no
single-column collapse, no breakpoint width override, no "compare is desktop
only" empty state, no warning. A 240px column on a 375px screen is a sideways
scroll through the columns, and that is the intended behaviour rather than a gap.

The ruling is about what to *build*, not about what to verify: LV.13 still
checked 375px and reported it (§4). Pinned by
`side-by-side-columns.test.ts` — "carries no breakpoint override of the column
width" — so the "fix" this ruling declines cannot arrive later as a tidy-up.

---

### Q5 — what should a pop-out do when the list under it is gone? (raised 2026-08-12 by LV.17's second review, from finding **R250**)

**Status: ✅ RULED — Chris, 2026-08-12.** Recorded here because LV.17 *decided*
this rather than asking, and the Reviewer escalated it: the decision reversed
the prototype on the strength of a Builder's reading of the LAW, which is
exactly the class of call this build sends to Chris.

**The gap.** The design LAW says pop-outs *"stay until closed"* (a statement
about **navigation**), and the prototype's own `store.destroy` splices the
window away when its list is destroyed (`docs/design/lists/design/lists.js`:253).
LV.17 read the first as governing the second and shipped **persist-and-explain**:
the window stays, the body says the list is gone, the footer is suppressed. The
argument was that a window vanishing with no word is CLAUDE.md's *"nothing
happened"* with the evidence removed.

#### ✅ RULED — Chris, 2026-08-12: **"Close it, with a toast."**

> Window closes. Toast: **"This list is no longer available."**

Both halves matter, and the fix round pins both: a silent close is the defect
LV.17 was right to fear, and a toast without the close leaves the stale window
the ruling exists to remove.

**The neutral copy is deliberate and is also the fix for R248.** Do not write
"deleted" into it — see Q6's neighbour finding and `listReadIsGone`'s header in
`list-row-parts.tsx`: the 404 behind this state is *also* a list that is alive
and merely no longer visible to the viewer.

---

### Q6 — what does a phone get instead of a floating draggable window? (raised 2026-08-12 by LV.17's second review, from finding **R251**)

**Status: ✅ RULED — Chris, 2026-08-12.** LV.17 discharged **F-LV15.3** by
deciding *"the phone gets the same window"* — defended on three verified
properties, and explicitly offered for overruling ("Hiding `pop out` below a
breakpoint was considered and NOT done… it is a one-line change"). The Reviewer
escalated it as a product call that had been made rather than asked.

#### ✅ RULED — Chris, 2026-08-12: **a real mobile variant.**

> *"On a mobile the pop out window is full width but only 60% of the screen
> height. the tool bar only shows Close and Options. All options go into the
> option menu."*

So below **768px**: width **100%**, height **60%** of the viewport, and a header
of **`Options` + `Close`** only — the `gear` (stats), the `dots` (grouping) and
`Collapse` all move **into** that menu.

**This does not contradict D14.** *"Leave the phone version as is"* (2026-08-11)
was ruled about **Side by side**, a different surface. This build's standing
rule is that a ruling is not inferred onto another surface, which is precisely
what left this question open to be asked — and why the two answers differ
without either being wrong.

**Three things the ruling does not state were decided by the Builder and are
flagged derived-not-ruled** so Chris can overrule any of them cheaply — see §4's
fix-round entry: **bottom-anchored**; **drag and resize switched off** rather
than left dead; **several windows pile, with no cap invented** (**F-LV17.4**).

---

## 4. Decisions log

Design decisions D1–D7 live in delivery plan §3 and are not duplicated here.
This section records decisions made **during** the build.

- **LV.1.1 (2026-08-09) — branch mechanism.** Both routes
  (`src/app/app/lists/page.tsx`, `src/app/app/lists/[listId]/page.tsx`) now
  check `featureFlags.listsV2` as the first statement in the default export
  and return early to a new `*V2` component when on. The pre-existing body
  of each page moved, unedited, into a same-file `*Legacy` component
  (`ListsPageLegacy`, `ListDetailPageLegacy`) — this was required, not
  stylistic: `useList`/`useAiListBuild`/`useHistoryStore`/`useState` are real
  hooks, so they can't sit in the branch itself without violating
  react-hooks/rules-of-hooks (confirmed clean via `npm run lint`). `use(props.params)`
  is exempt from that rule per React/Next 15 and stays in the outer
  component so both branches can read `listId`. New placeholder components
  live at `src/components/lists/v2/{lists-page-v2,list-detail-page-v2}.tsx`,
  built on the existing `PlaceholderPage` shared component (same pattern as
  `src/app/app/teams/[teamId]/page.tsx`) rather than inventing new markup.

  **Where `src/components/lists/v2/` comes from is now plan law, not a note
  here** — this entry originally carried a Builder's counter-reading of D1,
  which was the wrong place for it (R168). Plan **v3.3** amends D1 in place:
  Lists v2 screens live in `src/components/lists/v2/`, are swapped in at the
  route branch, and are retired at LV.4.4; "no forks of `src/components/ui/`
  primitives" survives as the absolute prohibition. **Read D1, not this
  bullet.** No task should re-derive the structure.

  Added `NEXT_PUBLIC_FLAG_LISTS_V2` to `.env.example` beside the other flags.
  **Its dev default takes something away, which no previous flag did**
  (R170): unset or blank means ON in local development, so until LV.2.1 and
  LV.3.1 land, `npm run dev` shows placeholders where today's working Lists
  page and list detail are. That is what plan §1 asks for — the rebuild is
  what you want to see locally — but it is surprising the first time, so
  `.env.example` now says it outright, along with the escape hatch:
  `NEXT_PUBLIC_FLAG_LISTS_V2=false` in `.env.local` restores today's Lists
  locally. `.env.local` itself is gitignored and was used only transiently
  for the flag-OFF browser verification.

- **LV.1.2 (2026-08-09) — the drafted table, and the four judgement calls in
  it.** Migration `079_list_player_drafted.sql` ships D2's printed DDL. This
  is **the only schema change in the whole Lists v2 build** (plan §1/D6);
  nothing after it may add another. Four decisions the plan did not make for
  the Builder:

  1. **The write takes an explicit desired state, not a blind toggle.** Wire
     contract is `POST {player_id, drafted: boolean}`, and the response
     carries `changed: boolean`. §4 calls LV.1.2 "the read/toggle route",
     which names the user's *gesture*; the transport is idempotent on
     purpose, because an optimistic checkbox retries and a blind toggle
     applied twice lands on the opposite answer with nothing to notice it
     (CLAUDE.md's "never let 'nothing happened' mean 'it worked'"). `changed`
     is what lets a caller tell a replay from a write. Pinned by
     `drafted-service.test.ts`, which explicitly **rejects** a toggle-shaped
     `{player_id}` body so a later "simplification" goes red.

  2. **The INSERT policy defers to `lists`'s own RLS instead of restating
     visibility.** Its `EXISTS (SELECT 1 FROM lists WHERE id = list_id AND
     deleted_at IS NULL)` carries no `is_private`/`owner_id` conjunct: policy
     expressions are evaluated as the invoking role, so the subquery runs
     under `lists`'s policies (the mechanism migration 067's D106 note
     documents). The encoded rule is therefore **"you may mark drafted on any
     list you can read"** — which is D2's Saved-list case for free, *and*
     covers 067's league-shared private lists, which copying
     `list_favorites`' hardcoded `is_private = FALSE OR owner_id = auth.uid()`
     would have silently excluded. **All three** directions pinned in pgTAP
     028 — u2 can mark on u1's public list, cannot on u1's plain private one,
     **and can on u1's private list shared with a league they both belong
     to**. The third pin was missing on the first pass and is the only one
     that distinguishes this design from the 013 form it rejects; the
     Reviewer proved the 013 form passed the entire suite green (R173, §6).
     The DELETE policy is
     `user_id = auth.uid()` **alone** — you must always be able to clean up
     your own rows, including on a list that has since gone private or into
     the trash — which is also why `clearDrafted` skips the visibility probe
     that GET and POST perform.

  3. **Beyond-the-print hardening: a composite FK `(list_id, player_id) →
     list_players`, ON DELETE CASCADE**, replacing the obvious separate
     `list_id → lists` / `player_id → players` FKs (which it subsumes
     transitively). The D106/R43 class — it makes a mark for a player who is
     not on that list impossible on *any* path rather than merely unlikely,
     and it self-cleans when a player leaves the list. Checked before
     choosing it that nothing delete-and-reinserts `list_players`:
     `reorder_list_players` (004) is UPDATE-only and `/api/big-board/save`
     diffs, so no reorder or board save can wipe a mark. Costs one index —
     the cascade lookup is not a PK prefix.

  4. **No UPDATE policy at all** — row presence *is* the state and
     `drafted_at` is write-once, so §8.2's "immutable tables have no UPDATE
     policy" applies. Proven from the row's **own user**, not a stranger: a
     stranger being blocked would not prove immutability.

  **Layering.** The 20 pre-existing `/api/lists` routes inline their logic;
  this one does not. Everything decidable lives in
  `src/lib/lists/drafted-service.ts` over an injected client (the leagues
  D68/D71 thin-route pattern), because the LV.1.2 DoD requires the RLS
  isolation to be proven through the code that actually ships.
  `ServiceResult` is re-declared locally rather than imported from
  `leagues-service.ts` — a two-field type is not worth pulling a paused
  build's module onto the launch path.

  **Grants.** No per-object `GRANT` (leagues D18→D23): migration 037's
  default privileges cover the new table. Verified after a real
  `npx supabase db reset` — `authenticated` holds SELECT/INSERT/DELETE — and
  pinned in pgTAP 028, because no RLS assertion can see a missing grant.
  *(Trap for the next Builder: hand-applying a migration with `psql -U
  postgres` on a drifted local DB grants only `Dxtm`. That is an artifact of
  hand-application, not of the migration; `db reset` is the only honest
  check.)*

  **Typegen.** `src/types/database.ts` regenerated with
  `npx supabase gen types typescript --local`; the hand-written alias block
  was re-appended and verified **byte-identical by sha256**, and the file
  diff is **+89 / −0**. The regen also picked up `ai_generation_usage`
  (074), `applied_migration_versions` (078) and three RPCs that had never
  been typegen'd — pre-existing drift, additive, not scope creep.

- **LV.1.4 (2026-08-09) — session display state, and the `org` call.** One new
  file, `src/stores/list-display-store.ts`, plus its test. **No migration, no
  schema change, no new API route** — the store never touches the network at
  all. Five judgement calls the plan left to the Builder:

  1. **`org` lives here — as an override (`ListOrg | null`), not as the
     value.** D3 names four things (`view`, `cols`, band labels, `budget`) and
     is silent on `org`; D4 supplies the answer — *"only the label set is
     local"* — and `org` is exactly the label-set selector ("Tier 3" vs
     "Round 3" vs a cost band's text), so it is session state and this store is
     the build's one home for it. But it is **not** stored as a plain value
     with a default, because `rank` vs `tier` **already has a server-side
     answer today**: `lists.ranking_mode`, which the legacy List order / Tiers
     control writes (`list-detail-view.tsx` → `ranking_mode: 'rank_and_tier'`).
     A store that owned `org` would silently re-group every tiered list as
     plain rank on every load. `null` means "the session has no opinion",
     resolved by the exported `resolveOrg(override, rankingMode)`:
     `rank_and_tier → tier`, everything else → `rank`. Round, cost and budget
     have no server representation by design, so they can only ever be a
     session choice. **Bucket *membership* is not in this store and must never
     be** — it is `list_players.tier` (D4) — which is pinned by a test that
     asserts the state shape is exactly the five keys above.

  2. **The store never writes to the server, and that is a boundary, not an
     omission.** If **LV.3.2** decides that choosing Tiers in the v2 grouping
     dropdown should also persist `ranking_mode` the way today's control does,
     that is a route call it makes *alongside* `setOrg`. Flagged in the store
     header so LV.3.2 makes the call deliberately rather than inheriting it.

  3. **Band labels are cost-only, and the prototype's `min` threshold is
     dropped.** Design LAW makes cost bands the only renameable bucket
     ("Click tier label (cost bands, owner only) → Inline rename"), and D4 says
     nothing is computed — so a band is a bucket you drag into, exactly like a
     tier, and `min` would encode a price rule D4 explicitly rejects. The four
     default labels come from the prototype (`$40 and up` … `Under $10`).
     **Their keys (`c1`–`c4`) are this store's own and are not on the wire** —
     the bucket vocabulary sent to the tier route is **LV.1.5's** to define; if
     the two ever need to agree, reconcile there.

  4. **Every default is borrowed, not invented.** `view: 'list'` matches
     today's `viewMode` default (`'comfortable'` = 60px rows); `cols:
     ['proj','last','adp']` mirrors `DEFAULT_LIST_ROW_STATS` in
     `customize-popover.tsx`; `budget: 200` is the prototype's. Stat ids stay
     opaque `string`s — the catalog is LV.3.7's.

  5. **Reference identity is a single gate in `update`, not per-mutator
     checks.** *(Rewritten after review — R180.)* The read path was always
     right: `selectListDisplay(listId)` returns either the stored entry or the
     one frozen `DEFAULT_LIST_DISPLAY`, because zustand v5 subscribes through
     `useSyncExternalStore` and loops forever on a selector that builds a fresh
     object per call. The **write** path was not: `setCols`, `toggleCol` and
     `setBandLabel` each allocated a new `ListDisplay` even when the value was
     unchanged, and nothing pinned that. The fix is one structural-equality
     check (`sameDisplay`) inside the shared `update` helper — `cols`
     element-wise, `bandLabels` key-for-key — after which **every** mutator
     returns the identical object on a value-identical write, including any
     mutator added later. The per-mutator `current.view === view` style checks
     were deleted as redundant so there is exactly **one** mechanism and
     exactly one test pinning it. Guards that mean something beyond equality
     stayed: an unknown stat in `moveCol`, and a non-finite number in
     `setBudget`/`moveCol`. Side-effect worth knowing — a list written back to
     its exact defaults now keeps **no** `byList` entry at all.

     Smaller calls in the same spirit: `setBudget` **refuses** a non-finite
     number outright rather than coercing it (a cleared input arrives as `NaN`
     and would render "$NaN" everywhere); `moveCol` now refuses one too, for
     the same reason (R182 — `NaN` survives `Math.trunc`/`min`/`max` untouched
     and `splice` reads it as `0`, so an unmeasurable drop silently moved the
     chip to the front); and a blank band rename **clears the override** back
     to the default label instead of storing `""` and rendering a nameless
     header.

  6. **Band-label maps have no prototype chain.** *(Added after review —
     R181.)* Bucket keys are free text, and become DB-sourced
     `list_players.tier` values the moment LV.1.5 widens the enum — so
     `__proto__` and `constructor` are reachable input, not hypotheticals. On a
     plain `{}` the first is swallowed by the prototype setter and stored
     nowhere, and the second makes `resolveBandLabel` return a **function** out
     of a `: string` API. `DEFAULT_LIST_DISPLAY.bandLabels` and every copy
     `setBandLabel` makes are now `Object.create(null)`, and `resolveBandLabel`
     reads through `Object.prototype.hasOwnProperty.call` so it is correct for
     any caller-supplied record, not just the store's own.

  **D3 is guarded, not commented (the point of the task).** **Seven** other
  stores in `src/stores/` use `persist` + `createJSONStorage(localStorage)`
  (`ai-build-store`, `list-order-store`, `history-store`, `rail-store`,
  `ui-store`, `board-labels-store`, `player-windows-store` — the store header
  and plan §2 both said *six* until R184; `ui-store` was missing from both), so
  the absence here reads like an oversight to anyone who does not know it was
  declined. `list-display-store.test.ts` carries **four independent detectors**
  — the store exposes no `.persist` API; every mutator touches neither
  `localStorage` nor `sessionStorage`; state does not survive a module reload;
  and the source names no persistence machinery. Plus a **control** that builds
  a store with the house `persist` pattern inline and shows all three runtime
  detectors tripping on it, so a green run means the detectors work rather than
  that they are asleep.

  **The guard's own hole, found in review and closed (R181/R179 — read this
  before extending it).** The storage spies were stubbed on `globalThis`
  **only**, and vitest's node environment has no `window`. The house SSR idiom
  — `if (typeof window === 'undefined') return` then
  `window.localStorage.setItem(...)`, which is literally what
  `src/hooks/use-draft-mode.ts:19` does — therefore took its early return under
  test and the spies never fired. A store that persisted `view` to
  `localStorage` in **every real browser** passed all four detectors. The
  describe now stubs `window` too, `window`/`globalThis` joined the banned-token
  list (a computed key like `w['local' + 'Storage']` names none of the other
  banned tokens), and `exerciseEveryMutator` **seeds `LIST_B` before resetting
  it** — it was resetting a list that had never been set, so `reset`'s early
  return ran and its real body never did, hiding a whole mutator from the
  runtime detectors.

  **No UI consumes this yet**, by design — the toolbar is LV.3.2 and the stats
  picker LV.3.7 — so browser verification (plan §5.4) would have nothing to
  show. Stated plainly in the PR rather than claiming a screenshot.

- **LV.1.3 (2026-08-09) — the drafted marks moved to the account, and the four
  calls that were not in the task text.** `src/hooks/use-draft-mode.ts` now reads
  and writes LV.1.2's `/api/lists/[id]/drafted` through React Query instead of
  `localStorage`. **No migration, no schema change, no new API route** — the only
  server-side files touched were the LV.1.2 service and route, and only to
  discharge R176/R178 (below). **Nothing under `src/components/lists/draft-mode/**`
  was opened**, and `list-detail-view.tsx` was not edited either: the whole change
  flows through the hook, whose returned shape (`enabled`, `setEnabled`,
  `drafted`, `toggleDrafted`, `clearDrafted`) is unchanged and is pinned by
  `type-check`, since both consumers destructure it.

  1. **`enabled` stays in `localStorage`, and that is a boundary, not an
     omission.** The hook owned two keys: the drafted set, and the draft-mode
     on/off toggle. **D2 buys one table, for the marks.** The toggle is a
     transient view state of one browser tab with no server representation, and
     giving it one would be the third schema change plan §3 **D6** forbids
     outright. Stated in the hook header so nobody "finishes the job" later.

  2. **Turning draft mode off still clears the marks — now durably.**
     `list-detail-view.tsx:659` calls `clearDrafted` when the toggle goes off,
     and that gesture already wiped the localStorage marks. It now issues a
     DELETE. Plan §2.1 says "nothing about its behavior changes; only where it
     stores", and applying that honestly means the *clear* moves too, not just
     the mark. Flagged here rather than discovered later, because it is the one
     place where a pre-existing gesture became a durable deletion. Exercised in
     the browser: "Reset list" → `remaining_marks = 0` in the DB.

     **Amended by R190 (LV.1.3 review) — it clears only marks it has seen.**
     Making the clear durable crossed it with item 4's silent degradation, and
     the pair was a data-loss path: with the GET failing the page shows zero
     drafted, and the next toggle-off DELETEd the real rows (measured live,
     2 → 0). `clearDrafted` now refuses while the marks are unknown, and
     toasts. The gesture is unchanged in every state where the marks *are*
     known, so this narrows the clear to the honest case rather than changing
     what the button does.

     **Amended again by R195 (LV.1.3 re-review) — and the first version of
     this paragraph was false.** It said "success is the only state that
     permits it… this refuses exactly the states where the marks are unknown".
     It did not: the guard read the query's `isError`/`isPending`, and this
     hook's own optimistic mark calls `setQueryData`, which React Query
     dispatches as a **manual success** — an errored query flips to
     `status: 'success'`, `isError: false`, `isPending: false` on the spot
     (measured, both by the Reviewer and again here). So one tap re-opened the
     whole R190 path, and because the same `onMutate` calls `cancelQueries`,
     killing the failing refetch, a marking session held the window open
     continuously rather than for an instant. The permitting bit now comes
     from the **read** — `draftedQueryOptions` raises `landed`/`failed` from
     inside the `queryFn`, `createReadLandedFlag` records the list id the last
     landed read was for, and no cache write can forge it. Live, same rig,
     both directions: with the status-only guard, 2 unseen rows + 1 fresh mark
     → **0**; with this one, → **3**, refusal toast shown, and both
     counter-controls (healthy read → clear; healthy read + mark → clear)
     still take the marks to 0.

  3. **The write is optimistic with a rollback AND a toast.** The consumers
     handle no errors — `toggleDrafted` returns `void`. A failed POST that only
     silently un-sticks the checkbox is precisely "nothing happened means it
     worked", so the hook rolls the cache back *and* raises a destructive toast.
     A same-tick double-tap converges rather than inverting, because LV.1.2's
     wire carries a desired STATE: both taps read the pre-mutation cache and
     send the same value, which is a no-op, not a flip. Noted in the hook.

     **R191: that convergence claim is now falsifiable.** It was asserted here
     and pinned nowhere — inverting the decision inside the hook body passed
     the entire gate. The decision is the exported `desiredStateFor`, and the
     double-tap property is a test.

  4. **The failure path is degradation, and the pin says what actually holds it
     up.** Q1 consequence 2 requires a failed read to render as "no marks". The
     first draft claimed `toDraftedSet`'s `?? []` was what prevented a crash;
     the deliberate-break probe **passed**, which proved that claim false —
     `new Set(undefined)` is harmless per spec. The real guards are (a) nothing
     in the file dereferencing the query's data, and (b) no `throwOnError` and
     no suspense, at this query or at the app-wide client, either of which
     would hand the error to an error boundary. All three are now pinned, each
     shown reddening under its own break, and the comment says the measured
     truth instead of the plausible one.

  **Where R176/R178 landed.** Both were LV.1.2 nits that live in this code path
  and are discharged in this PR — see §6 below. They compose: R178's threaded
  identity is what makes R176's new guard free on the production path.

  **Test-shape note for whoever extends this.** vitest here runs on node with
  **no jsdom and no `@testing-library/react`**, so the hook body cannot be
  rendered. Rather than add that infrastructure inside a UI task, the decidable
  parts are exported (`fetchDraftedIds`, `postDrafted`, `deleteDrafted`,
  `toDraftedSet`, `nextDraftedIds`, `draftedQueryOptions`) and the failure path
  is driven through a real `QueryObserver` over a real failing `fetch`. The
  return shape is left to `type-check`. **Source pins read comment-stripped
  source** (`code()` in the suite), after a header explaining why the file
  forbids `throwOnError` reddened the pin forbidding it — a source pin must
  read the code, not the prose about it.

  **R191 corrected the load-bearing half of that argument: `type-check` pins
  the return SHAPE, not behavior.** Anything left as a decision *inside* the
  hook body is pinned by nothing at all — measured, twice, each a total feature
  break passing the whole gate green. The rule this build now follows: if the
  hook body decides something, export the decision (`desiredStateFor`,
  `clearRefusalReason`, `canClearDrafted`, `runClearDrafted`, and — after R195
  — `createReadLandedFlag`, which is why the "has a read landed" bit is a
  factory rather than a `useRef` comparison inline) and leave the body as
  wiring, then pin the wiring with `callbackBody`, which slices the callback
  out of the comment-stripped source instead of scanning the whole file
  (R172's miss window; its own limitation is now stated in its JSDoc — R196). Adding jsdom + `@testing-library/react` remains the real fix and
  remains out of scope for a UI task.

  **R199/R200 (round 3, 2026-08-10) — the rule those two add: a guard's INPUT
  and its LIFETIME are separate questions, and both have to be answered.** R195
  fixed the input (take the bit from the event that establishes the fact, not
  from state something else may write). The final review found the same guard
  wrong on two other axes:

  5. **An abort is not an answer, on either arm.** The `queryFn` guarded
     `failed` and not `landed`, because "a cancelled read rejects" looked
     obviously true. It is only *usually* true: once `res.json()` is running on
     a buffered body, the abort no longer rejects and the read resolves after
     React Query has discarded it. A guard whose two arms disagree about what
     an event means will be wrong on whichever arm was reasoned about less.

  6. **A flag guarding a cache must live as long as the cache.** `hasRead` sat
     in a `useRef`, i.e. one mount, while the marks it vouched for sit in the
     cache for `staleTime`/`gcTime` past it — so an ordinary navigation refused
     a clear over marks that were on the screen. It hangs off the QueryClient
     now (`readLandedFlagFor`, a `WeakMap`), keyed per list. **And the hazard
     that buys — a flag that never resets — is not hand-waved:** every route
     back to `false` is enumerated and pinned (list switch, read failure,
     cancellation, and the cache entry being removed, via a `QueryCache`
     subscription that catches gc, `removeQueries` and `clear()`). Lengthening
     a guard's lifetime is only safe if you can name every way it ends.

- **LV.1.5 (2026-08-09) — the bucket vocabulary was designed but NOT decided.**
  *(Superseded 2026-08-11 by the entry at the end of this section — the
  vocabulary is now ruled, shipped and live. Kept because the halt is the reason
  it exists.)* The LV.1.5 task text directed the wire vocabulary to be recorded
  here, since LV.3.2, LV.3.5 and LV.3.6 all inherit it. It was **not** recorded
  here, because it was not ruled: the task halted before implementation on
  **§3 Q2** (`list_players.tier` carries a live CHECK constraint pinning it to
  S–F, so the widening needs a migration this build forbade). The full proposal
  — the key sets, the `c1`–`c4` reconciliation with `DEFAULT_COST_BANDS`, why
  budget mints no keys, the round ceiling and its justification, and what the
  closed shape rules out — lives in **§3 Q2**.

---

- **LV.2 + LV.3 (2026-08-11) — the Lists screen, rebuilt against the
  screenshots.** One PR, because §7 rules that the page and the detail are one
  screen. Everything lives in `src/components/lists/v2/`; nothing outside it was
  restyled. **No migration, no schema change, no new API route.** The judgement
  calls the task text did not make:

  1. **Bucket membership is stored for tier/round and *computed* for
     cost/budget — and that is the prototype's own model, not a shortcut.**
     `lists.js` keeps `tier` and `round` on the entry and derives the cost bands
     and budget share from `cost` with `min` thresholds. `screens/README.md`
     corrected plan D4 in the same direction: *"nothing is computed" holds for
     bucket membership and is wrong about stats*. So Avg cost and Budget % read
     `players.auction_value` (the `Cost PPR` column) and need no write at all —
     which is also why they render today while Rounds cannot.

  2. **Rounds ships rendering-complete and data-empty, deliberately.** It reads
     `r1`…`rN` out of `list_players.tier`, which the live
     `list_players_tier_check` still forbids, so every player falls into the
     ungrouped section until **LV.1.5** lands. The alternative — chunking the
     ranked order into rounds of twelve — was rejected: it matches no
     screenshot (the reference's rounds hold 4/3/4/3/3, i.e. stored
     membership), invents a picks-per-round number no screen shows, and would
     have silently changed meaning the day LV.1.5 shipped. `list-buckets.test.ts`
     pins both the empty-today case and the `r1`/`r2`/`r10` case LV.1.5 opens,
     including numeric (not lexical) ordering.

  3. **`/api/lists/[id]` now selects `bye_week`, `sos`, `auction_value` and the
     three `projected_pts_*` columns on the embedded player.** This is the one
     server-side edit and it is deliberately **not** a third D6 change: no
     migration, no schema change, no new route, no new mutation, and not one
     column that `/api/lists/big-board` does not already select from the same
     table. It was also a standing bug — `list-detail-view.tsx` has been reading
     `player.sos` / `player.auction_value` / `player.bye_week` since before this
     build while the route never returned them, so Bye / SOS / Auction rendered
     as an em dash on every list that is not the big board. Revert it and the
     design's own five-stat set (`ADP · Cost PPR · Proj · Bye · SOS`) cannot be
     shown at all.

  4. **Everything the schema cannot carry is named on screen, never faked.**
     There is no `cover` column, so the tile's colour is a stable FNV-1a hash of
     the list id over five tokens (brand lime reserved for Favorites) and its
     glyph is the title's word initials — the prototype's hand-picked `BB` /
     `11` / `0R` are not derivable. There is no `scope` column, so the second
     chip is **visibility**. There is no `links` table, so **Attached links**
     renders its section and empty state with the action disabled and the
     reason stated, rather than opening a dialog that would discard the link.
     Comment likes render 0 and are inert. The gallery's comments pill carries
     no count (`/api/lists` returns none and per-card fetching is an N+1).

  5. **A mobile control row was added, because the shell hides its header below
     `lg`.** `app-shell.tsx` renders `AppHeader` inside `hidden lg:block`, so a
     phone would have had no way to change page mode or tab at all. The same
     two controls render in-page under `lg:hidden`. The design package shows no
     mobile screens; this extends it rather than dropping the controls.

  **A break probe found a real bug and it is fixed.** Forcing `/api/lists` to
  500 rendered *"No lists yet. Start one with New list."* in the rail plus a
  permanent "Loading your lists…" — a confident empty state over a request that
  had never succeeded, which is the exact shape CLAUDE.md names. The cause was
  asking `isPending`, which misses React Query's third state: `fetchStatus:
  'paused'`, entered when it believes the browser is offline. Every "no rows"
  branch now gates on `isSuccess`, the rail renders a skeleton until the data is
  real, and `paused` gets its own loud message with a retry. *(Note for whoever
  repeats this: in the automated browser the 500 tips React Query into `paused`
  rather than `error`, so the `error` branch itself was not exercised live —
  only the `paused` branch, which shares the fix.)*

  **Verified in the browser at 1728×1000 and 375×812**, against every reference
  image: all three view styles, all five groupings, both tabs, the cards
  gallery, the note hover card, and the inline band rename. Seeded **locally
  only** — tiers S–F on one list, a Favorites list, three notes, five drafted
  marks, two comments, three tags.

- **LV.8 (2026-08-11) — `list_links`, and the judgement calls the ruling left
  open.** Migration `080_list_links.sql`, `src/lib/lists/links-service.ts`,
  `/api/lists/[id]/links` (+ `/[linkId]`), and the Details tab's links section.
  The build's **third and final** schema exception (plan D8, plan → v3.7;
  `ACTIVE-BUILD.md` §1 updated to match, since it carried the "two" count too).
  This closes the gap LV.3 correctly refused to improvise around: it shipped
  the section with a **disabled** action and said why, rather than a dialog
  that would discard the link on submit.

  1. **The columns, and why each one is there.** `list_links (id, list_id,
     kind, url, title, source_label, duration_label, position, created_at,
     updated_at)`. Every one is a fact `screens/detail-tab-details.png`
     renders: the bold title, the muted `source · duration` line, the ordered
     stack, the remove control. Nothing speculative — there is no `note`, no
     `added_by`, no `thumbnail_url`.
     - **A surrogate `id`, unlike 079's natural key.** 079 could key on
       `(user, list, player)` because row *presence* was the entire state. A
       link has a mutable payload and needs a stable handle for
       `DELETE .../links/[linkId]` and for the reorder contract to name rows.
     - **`position` is stored** because the design shows a list, not a set. It
       is deliberately **not** `UNIQUE (list_id, position)`: uniqueness would
       force every reorder into a two-phase shuffle to dodge transient
       collisions, and buys nothing, because the read path orders by
       `(position, created_at, id)` — **total** — so even a duplicated position
       renders deterministically.
     - **`duration_label` is text with a CLOCK regex** (`18:42`, `1:02:33`),
       not an interval. The screenshot renders it verbatim beside the source;
       an unbounded string there would be a second caption on a public page.
     - **`UNIQUE (list_id, url)`** — attaching the same resource twice is a
       mistake, not an intent, and the service normalises through
       `new URL().href` first so `https://x` and `https://x/` collide as they
       should. 23505 maps to a specific 409, never a silent second card.

  2. **RLS: reads defer, writes do not — and the asymmetry is the design.**
     The SELECT policy is a bare `EXISTS (SELECT 1 FROM lists WHERE id = ...)`
     with **no** visibility conjunct, so it runs under `lists`'s own RLS (the
     mechanism 067's D106 note documents and LV.1.2 adopted). The writes spell
     `owner_id = auth.uid()` out explicitly, because "owner-only" is a
     *different* rule from "readable" — a league member who can read a shared
     private list must not be able to staple their own video onto it. That
     exact row is pinned as an adjacent lives/throws pair in pgTAP 029 §E.
     Also pinned: **anon CAN read a public list's links**, because the share
     view (D7) renders signed-out and a policy tightened to
     `auth.uid() IS NOT NULL` would break that page with no RLS assertion
     noticing.

  3. **The URL is guarded twice, and the two layers are pinned to each other.**
     `normalizeLinkUrl` parses with the WHATWG `new URL()`, asserts the
     protocol is `http:`/`https:`, and stores `.href`; 080's
     `list_links_url_scheme_check` enforces `^https?://[^[:space:]]+$` at the
     database. Parse-then-check beats regex-on-raw-input on the case a regex
     misses — browsers strip TAB out of a scheme, so `java<TAB>script:` is a
     live `javascript:` URL, and `new URL()` normalises it *into*
     `javascript:` where the protocol check catches it explicitly (measured,
     not argued). The DB layer is not redundant: `duplicate_list` is this
     codebase's standing proof that a write path which never sees Zod will
     exist. `links-service.test.ts` carries the load-bearing pin — **every URL
     the service accepts is asserted to satisfy 080's CHECK regex**, so if a
     future edit loosens one layer, that test reddens instead of a `23514`
     surfacing as an HTTP 500.

  4. **Nothing is scraped.** `title`, `source_label` and `duration_label` are
     typed by the author; the service makes no network call. That is CLAUDE.md's
     standing rule, restated at the decision level in D8 so it is not
     re-litigated. Auto-filling from a YouTube URL is a **follow-up to
     propose**, and it is worth proposing — typing "18:42" by hand is the
     weakest part of this UX.

  5. **`links` rides on the existing list GET rather than a new fetch.**
     `/api/lists/[id]` embeds them (as it already does tags), so the Details
     tab costs no extra round-trip and LV.6's server-rendered share view gets
     them for free. **A failed links query 500s that route** rather than
     returning `[]` — this section has a real "Nothing attached" empty state,
     and rendering it because a query errored is verbatim the production bug
     CLAUDE.md records. Contrast `aggregateFantasyStats` on the same route,
     which *is* caught and degraded: that is a deliberate difference, because
     a missing stat renders as an em dash and a missing link renders as a lie.

  6. **No reorder UI, on purpose.** `PATCH .../links` exists and is
     stack-proven, but the reference shows no handle and no arrows on a link
     card. Inventing one would be UI the design LAW does not ask for, so the
     client half is left to **LV.4**, which owns the drag gesture — and
     `useReorderLinks` was deliberately **not** added to `use-lists.ts`, since
     an unused hook with a plausible name is just dead code. Recorded in the
     hook file so the omission reads as a decision.

  7. **Three interpretations where the reference is silent**, named rather
     than passed off as the design: the coloured block is a **placeholder, not
     a poster** (nothing scrapes a thumbnail), so it carries a glyph the way
     `ListCoverTile` does; its colour comes from the warm ramp (`tier-2` for
     video, `tier-4` for article) rather than `negative`, whose token comment
     reserves it for football semantics — the reference's rose reads closest to
     `negative`, and plan §1 says implement from tokens, never the handoff's
     hex; and the attach form is **inline**, matching this tab's own Description
     and Add-tag editing, because the design shows no dialog anywhere on it.

  8. **`duplicate_list` does not copy links.** 017's RPC predates this table
     and was deliberately left alone — modifying an existing SECURITY DEFINER
     RPC is scope this task does not hold. Recorded in D8 so it is a known
     boundary, not a rediscovered bug.

  **Typegen.** `src/types/database.ts` regenerated with
  `npx supabase gen types typescript --local`; the hand-written alias block was
  re-appended and verified **byte-identical by sha256**
  (`76970642dcc9d707…` both sides), and the file diff is **+48 / −0**. No
  `ListLink` alias was added to that block on purpose: the app consumes the
  *wire* shape (`ListLink` in `links-service.ts`, which omits the timestamps),
  and a same-named Row alias beside it would be a trap.

- **LV.2-fix (2026-08-11) — the cover treatment is headshots, and the
  screenshots were the thing that misled.** §7 gap 2 scrapped a PR for *reusing*
  `ListThumbnail`, on the strength of `screens/cards-gallery.png`. Chris,
  2026-08-11: *"we actually had them the way they were supposed to be before,
  using the headshots of the players. And then the background color is dependent
  on what position group the user selects for the list."* The prototype's
  glyphs (`★`, `BB`, `WR`, `$`, `11`, `RK`, `0R`) are **artefacts of its fake
  data**. Gap 2 is hereby **reversed** — see the boxed exception now at the top
  of `screens/README.md`, added so the next reader cannot repeat this.

  What the fix does, and the calls the ruling left open:

  1. **One colour rule, one map.** `POS_TINTS` in
     `src/components/lists/list-thumbnail.tsx` is now exported and is the single
     source: `lists.position_filter` → `bg-pos-*`, and `null` → `bg-ink`. The
     hashed six-colour `COVER_PALETTE` and the `coverGlyph` derivation are gone.
     **Favorites loses its lime cover** — it carries no position filter, so it
     lands on ink like any other all-players list. That follows the ruling
     literally; the lime went with the glyph treatment, and no carve-out was
     asked for. Flag it if the identity cue is missed.

  2. **Small covers delegate rather than duplicate.** `ListCoverTile` is now a
     thin adapter over `ListThumbnail` — the same component, restored, not a
     v2 re-implementation of it (CLAUDE.md, *no near-duplicate components*).
     `ListThumbnail.size` gained a **numeric px** form for the design's 24px
     rail and 51px hero, which fall between the named steps; named sizes keep
     their literal Tailwind classes, so no pre-existing screen moves a pixel.

  3. **The label is now sized to fit its quadrant, at numeric sizes only.**
     `FLEX` — the one four-character label — overflowed its 12px quadrant and
     bled across the neighbouring headshot at 24px, and clipped at 51px; `DEF`
     clipped at 24px. `fitFontPx` caps the font at whatever fits (~0.6em per
     mono glyph) so `FLEX` shrinks rather than clips. This is a *legibility*
     fix inside the restored component, not a redesign: the **fill colour** is
     what identifies the position group, and the letters only confirm it.

  4. **The gallery stack: 24px chips, 8px overlap, left-on-top.** Four squares
     overlapping by 8px occupy 72px — a third of the 214px card — so the
     cluster reads as a corner motif rather than a row of thumbnails filling
     the band. `z-index` **descends** with list order, so the list's #1 is whole
     and each player behind him is progressively occluded; flex siblings paint
     in DOM order otherwise, which would bury #1 under #4. Each chip carries the
     design's 1px `border-ink` and `rounded-sm` — the hard-edged language, not
     the round avatar stack of other apps. Under four it draws fewer chips and
     stays right-anchored, so one headshot sits exactly where the fourth would;
     with none, a dashed ghost chip with a `+` holds the same spot, because an
     empty band reads as a rendering failure.

  5. **`/api/lists` now returns four players per list, not three** — a cap
     bumped on an **existing** query, not a new route, and the budget in
     `ACTIVE-BUILD.md` closes *schema changes and new routes*, neither of which
     this is. Three could not satisfy "the top four players". Every other
     consumer slices to three and is unaffected.

  **Observed, not fixed (out of scope, worth its own task):** `DEF` players'
  `headshot_url` values are team-abbreviation URLs (`…/thumb/PHI.jpg`) that
  404, so a DEF list's cover shows broken-image glyphs. `ListThumbnail` has
  always behaved this way — it falls back to initials only when the URL is
  *null*, not when the image fails — so this predates the cover work and shows
  everywhere headshots render. An `onError` fallback would fix it globally.

- **LV.4 (2026-08-11) — drag-and-drop, and the two modes that had to refuse.**
  Three new files in `src/components/lists/v2/` (`list-reorder.ts` + its test,
  `use-list-drag.tsx`), plus wiring in `list-body.tsx`, `list-row-parts.tsx`,
  `list-buckets.ts` and `list-detail-panel.tsx`. **No migration, no schema
  change, no new API route** — both writes go through routes that already
  existed (`PATCH …/players/reorder`, `PATCH …/players/[playerId]/tier`) and
  through the hooks that already wrapped them optimistically. Six judgement
  calls the task text did not make:

  1. **dnd-kit is the sensor layer and nothing else.** It is already the app's
     drag library (`AppDndContext`, big board, legacy detail), so nothing was
     added to `package.json`. But `@dnd-kit/sortable` is **not** used: its
     model is "the other rows transform out of the way", which is the exact
     behaviour the design LAW rules out in its first sentence ("rows never
     highlight themselves"). Its **droppables** are not used either, and that
     is correctness rather than taste — dnd-kit caches droppable rects, and
     this model changes layout mid-drag by design, so hit-testing against
     cached rects aims at where a row *used to be* and the gap oscillates
     between two slots. The target is resolved from `document.elementFromPoint`
     on every move instead: always live, one rect on the hovered row, and
     self-stabilising because the open gap carries its own slot in
     `data-drop-gap` and re-aims at itself when the pointer lands inside it —
     which is the property the prototype gets free from native `dragover`.

  2. **Native HTML5 drag was the other candidate and was rejected.** It is what
     `docs/design/lists/design/ListsCommon.jsx` uses, so it would have been the
     higher-fidelity mechanism. It does not work on touch devices **at all**,
     and the 2026 audience is friends testing on phones. `MouseSensor`
     (6px distance) + `TouchSensor` (220ms press, 6px tolerance) instead of the
     single `PointerSensor` `AppDndContext` uses: a pointer sensor on touch
     either hijacks the page scroll or is cancelled by it.

  3. **Cost and Budget do not offer the drag at all, and say why on the grip.**
     Their sections are computed from `players.auction_value` and re-sorted by
     price on every render (`byCostDesc`), so a hand ordering would be
     discarded the moment React re-rendered — the drag would look like it
     worked and snap back, which is precisely CLAUDE.md's "never let *nothing
     happened* mean *it worked*". The rows carry no drag listeners in those two
     modes (verified in the browser: `onMouseDown`/`onTouchStart` are absent
     from the row's props) and the grip is faded with the reason in its
     `title`. **This contradicts plan D4's "the same write in all four modes"**
     — a sentence `screens/README.md` had already falsified for stats and which
     LV.3 shipped against. Folded back into the plan as an erratum on D4,
     plan → **v3.8**, rather than left for the next reader to rediscover.

  4. **Round buckets refuse with their reason, and the "start tier N" zone is
     withheld in round mode.** `list_players_tier_check` still pins the column
     to NULL or S–F (§3 Q2), so an `r3` write is a Postgres `23514` the tier
     route returns as a 500. `bucketDrop` answers `{ok:false, reason}` for
     round sections and the panel raises a destructive toast. The affordance
     that *can* only fail — the dashed "Drop a player here to start round N" —
     is not rendered at all; in tier mode it renders with the first free
     letter. This is the "gate it or fail loudly" choice, taken **both** ways:
     gated where the affordance would be pure furniture, loud where the section
     header exists anyway. It all reverses at LV.1.5, and `TIER_ORDER` is now
     typed `readonly ListTier[]` so the compiler names the places that change.

  5. **The two writes are sequenced, never fired together.** A cross-bucket
     move implies a tier write *and* an order write, and both hooks patch the
     same React Query cache inside `onMutate`. Issued in the same tick,
     whichever reads the cache first can be clobbered by the other's snapshot,
     and the rollback contexts cross. So the bucket write goes first (it is the
     one the server can refuse) and the order write follows in its `onSuccess`.
     A same-bucket reorder — the overwhelmingly common case and the literal ask
     — is a single optimistic call with nothing to sequence.

  6. **Order is written for the whole list, not just the moved player.** Design
     LAW: *"Moving an entry into a bucket assigns `tier`… then **keeps bucket
     members contiguous in the array**."* The new order is the buckets
     flattened in render order, which is what makes members contiguous — and it
     can move players the user never touched, when the stored array had tiers
     interleaved. That is the rule, not a side effect: after a drop the stored
     order matches the order on screen. `reorder_list_players` (004) only
     updates the rows it is given and the legacy view already sends the
     complete list, so the payload shape is established, not new.

  **A break probe found a real bug before it shipped.** The first build
  resolved the target inside a `requestAnimationFrame` and committed whatever
  the last frame had computed. A single-step programmatic drag — press, one
  move, release — produced **no** reorder at all, because no frame ran between
  the activating move and the release. rAF is also throttled outright in a
  background tab. Two fixes: the drop resolves once more at the release point,
  and the hit test is no longer frame-throttled (D5's warning is about
  *state*, which `aim` already writes only when the slot changes; frame-gating
  the *read* silently drops the last move of a fast drag).

  **Known gap, recorded rather than mimed:** there is no keyboard drag.
  dnd-kit's `KeyboardSensor` moves between *droppables*, and this model has
  none, so `useDraggable`'s `attributes` are deliberately not spread — they
  would put `role="button"` + `tabIndex=0` around the row's real buttons and
  advertise a capability that does not exist. A keyboard/AT path for reordering
  is worth its own task.

- **LV.9 (2026-08-11) — one tab/segment component, and the census that decided
  what "all of them" means.** Chris: *"Right now I see like 3 or 4 different
  versions of tabs. Let's use just that one."* He was counting accurately. The
  ruling and the design of the component are plan **D9**; what follows is the
  build's own record.

  **The inventory, and the disposition of every hit.** Surveyed by aria grep
  *and* by the idioms an aria grep misses (`.map` over a const array with a
  conditional active class, `aria-pressed`, `border-r … last:border-r-0`,
  `aria-current`, single-select `FilterChip` rows):

  | control | classification | done |
  | --- | --- | --- |
  | `ui/tabs.tsx` (the Radix primitive) | the style source | extended in place |
  | `lists/v2/lists-page-v2.tsx` page mode | segment (header lives in another React tree) | → `Segment`, boxed, icon + label |
  | `lists/v2/lists-page-v2.tsx` My lists / Saved | segment (same reason) | → `Segment`, bare, label × count |
  | `lists/v2/list-toolbar.tsx` view style | segment (restyles rows in place, no panel) | → `Segment`, boxed, icon only |
  | `lists/v2/list-detail-panel.tsx` List/Details/Comments | **genuine tab set** | → Radix, an *upgrade*: it had no `tabpanel` and no arrow keys |
  | `lists/v2/list-details-tab.tsx` video / article | segment (two-option kind picker) | → `Segment`, boxed, label only |
  | `players/player-detail-panels.tsx` Fantasy / NFL | segment (panels are the caller's) | → `Segment`; deleted its private `ToggleSegment` |
  | `players/players-spreadsheet.tsx` positions | Radix-without-panels: a **picker** | kept, `appearance="boxed"`; its `POSITION_TAB_ACTIVE` override still wins |
  | `home/trending-players-card`, `players/player-detail-page-view`, `shared/window-shell` | genuine tab sets | Radix kept, **no edit** — they inherit the look |
  | `explore/explore-feed` | Radix-without-panels | Radix kept, no edit; classified, not rewritten |
  | `lists/list-detail-view.tsx` (legacy) | Radix-without-panels ×2 | **not opened** — retired at LV.7; inherits the look |
  | `big-board/week-tabs.tsx`, `big-board/public-big-board.tsx` week strip | same look, hand-rolled | **off limits — deferred**, see below |
  | `FilterChip` single-select rows (10 sites), `bottom-tabs.tsx`, the research rail's tool strip, steppers, radio-cards | not tabs or segments | left alone, see D9 |

  **The judgement that mattered, and the evidence for it.** Radix `Tabs` is not
  a skin — it carries `tabpanel` association, roving focus and arrow keys, and
  ripping that out to make things look the same would be a bad trade. So the
  primitive keeps Radix and the *look* moved underneath it: six call sites
  converged with **zero edits**. Conversely the Lists page header cannot be a
  Radix tab set however much it reads like one — `PageHeader` pushes it into the
  app shell through a Zustand store (`app-header.tsx:69-79`), so no root can
  enclose the control and the content, and the same control renders a second
  time in-page below `lg`. That is a structural fact, not a preference, and it
  is why `Segment` exists at all.

  **Two escape hatches were measured, not assumed**, because both would have
  failed silently: `window-shell.tsx`'s `flex w-full` + `flex-1` equal-width
  tabs (`cn` resolves to `shrink-0 items-stretch gap-1 flex w-full` — the
  group's `inline-flex w-fit` correctly drops out) and
  `players-spreadsheet.tsx`'s per-position active fill (resolves to
  `data-[state=active]:bg-pos-rb`, measured live as `rgb(44,111,214)`).

  **`w-fit` on the group is load-bearing.** `inline-flex` sizes to content only
  until the group lands in a column flex parent, where `align-self: stretch`
  blows it out — found in the browser as the attach-link form's kind picker
  spanning the whole form. Caught by looking, which is the process §2 asks for
  on these screens.

  **The probe.** The handoff's critical note says an inline `background`
  outranks `:hover` and kills it silently. That mistake was made on purpose —
  `style={{ background: '#ffffff' }}` on `SegmentItem` — and measured: every
  active segment lost its accent fill and hover measured `rgb(255,255,255)`
  where the class rule gives `rgb(220,228,255)`. Reverted; hover measures
  `rgb(220,228,255)` again and every item carries `style === null`.

  **Deferred into the off-limits tree.** `src/components/big-board/week-tabs.tsx`
  and `public-big-board.tsx`'s `PublicWeekStrip` are the same boxed-tab recipe
  hand-rolled a third and fourth time (`h-tab`, `bg-ink` active). The strip is
  additionally `<Link>`-based, so converting it needs an `asChild` on
  `SegmentItem` that does not exist yet. Whichever task reopens
  `src/components/big-board/**` should convert both and decide whether
  `SegmentItem` grows `asChild`.

  **Interpretations worth flagging.** (a) Type sizes converged on the house
  `text-[11px]/700`, which moved the page-mode label up from 10px and the
  My lists/Saved label from 10.5px — uniformity was the point. (b) The
  video/article picker went 21px → 26px, the design's control height.
  (c) `ui/tabs.tsx`'s old comment claiming *"content tabs select to black;
  accent/blue is reserved for do-a-thing controls"* is gone: the screenshot
  fills tabs with accent, the design LAW lists **selection** under accent, and
  the styleguide's own caption had said so since the reskin. That comment was
  the last written trace of the treatment being replaced.

- **LV.10 (2026-08-11) — DEF renders the team logo, and the fallback that was
  never a fallback.** Chris: *"for DEF use the team's logo — that's what all
  platforms do."* Two fixes, one cause, and the second is the more valuable one.

  **The bug.** `players.headshot_url` is written by the Sleeper sync as
  `…/content/nfl/players/thumb/<sleeper_id>.jpg`, and for a team defense the
  Sleeper id **is the team abbreviation** — so every DEF row stores
  `…/thumb/PHI.jpg`, a URL that has never existed. Measured live: that path is
  **403**, `…/images/team_logos/nfl/phi.png` is **200** (12 KB PNG), and
  `…/team_logos/nfl/PHI.png` is **404**. **The logo path is case-sensitive**;
  all 32 abbreviations were checked lowercased against the CDN and every one
  returned 200. Same host the app already uses for headshots — no new
  dependency, nothing scraped.

  **Resolved at render, never written back.** `players` is sync-owned and the
  app must never write to it (CLAUDE.md), and the schema budget is closed at
  three, so this is a substitution made every time an image is drawn:
  `src/lib/player-image.ts` → `getPlayerImageUrl(player)`. It prefers `team`
  and falls back to `id` — for a DEF row the two are equal, but `team` is the
  field that *means* "which team" and `id` is only equal to it by the accident
  of Sleeper's keying, so a future id scheme cannot quietly become the source.
  An abbreviation outside `NFL_TEAMS` returns `null` (→ initials) rather than a
  request known in advance to 404.

  **The class names could not live in the lib, and that is not cosmetic.**
  `src/lib/**` is outside Tailwind's `content` globs, so `object-contain` named
  only there would be purged — and because `tailwind-merge` *does* remove the
  base `object-cover`, the result would have been an image with no object-fit at
  all: a stretched logo, from a class that looked right in the source. The URL
  lives in the lib; the fit decision lives in
  `src/components/players/player-image.tsx`, inside the scanned tree.

  **The second fix — the one worth carrying.** The survey found the general
  fallback was broken in exactly the two places that had hand-rolled an `<img>`
  instead of using the shared primitive: `list-thumbnail.tsx`'s quadrant and
  `cover-tile.tsx`'s stacked chip. Both did
  `player.headshot_url ? <img> : <initials>` — which handles a **missing URL**
  and not a **failed load**, so a 403 painted the browser's broken-image glyph.
  That is CLAUDE.md's *"never let 'nothing happened' mean 'it worked'"* in
  visual form. The fix is **not** a new `onError` handler: Radix's
  `Avatar.Image` already reports `error` for both cases and `Avatar.Fallback`
  renders whenever the status is not `loaded`, so the two raw `<img>`s were
  converted to the primitive the other twelve call sites already use. The bug
  was the fork, and deleting the fork is the fix. (`Avatar.Root`/`Fallback` are
  `<span>`s, which is why the cover band's span tree stays legal.)

  **Every call site now goes through one component.** `PlayerAvatarImage`
  replaced the `{player.headshot_url && <AvatarImage …/>}` idiom in 14 files:
  `lists/list-thumbnail`, `lists/v2/cover-tile`, `lists/v2/list-row-parts`,
  `lists/builder/player-sidebar`, `players/player-card` (×2),
  `players/player-detail-header`, `players/player-row`, `players/player-search`,
  `players/player-window`, `players/players-spreadsheet`,
  `shared/command-palette`, `teams/team-roster`, `home/home-player-row`,
  `draft/draft-queue-card`. `home-player-row` takes flat props rather than a
  player, so it gained a `team` prop (passed by `trending-players-card`; the two
  mock cards render no headshot and were left alone).

  **Off limits, recorded rather than edited.** `lists/draft-mode/board-column.tsx`
  renders a player headshot and carries the *same* DEF bug — it is in the boards
  tree, so it was not opened; **LV.7 retires that surface and should take the
  conversion with it**. `src/components/big-board/**` was checked and renders no
  player image at all (zero `<img>`, zero `AvatarImage`), so the boards rule
  costs nothing there. `leagues/league-cells.tsx`'s `Crest` is a league/team
  crest on mock data, not a player headshot — out of scope by kind, not by tree.

  **Interpretation flagged.** `draft/draft-queue-card.tsx` was converted even
  though `ACTIVE-BUILD.md` warns about `src/components/draft/**`. That warning
  is about *picking `L.*` tasks* while Lists v2 is active; this is a one-token
  `src` swap under an app-wide ruling, and leaving a known-403 image on a
  surface the ruling covers seemed worse than the scope question. Trivially
  reverted if a reviewer disagrees.

  **The probe.** `.toLowerCase()` was removed from `getTeamLogoUrl` — the exact
  regression the test exists for, and one break that proves both fixes at once.
  Unit: **6 of 12 tests RED**. Browser: the DEF list rendered **AC / AF / BR**
  initials in the hero quadrants, the rail tile and the player rows —
  `logoImgsInDom: 0`, `brokenGlyphs: 0`, i.e. Radix pulled the failed `<img>`
  and drew the fallback. Reverted; 12/12 green and all four logos back to
  `naturalWidth 150`.

- **LV.11 (2026-08-11) — the single-select filter rows joined the tab control,
  and the classification is the deliverable.** Chris: *"Use the tab component
  for now, we can create one for filters later."* The ruling and the rule are
  plan **D10**; what follows is the build's record. **UI/UX only — no
  migration, no schema change, no new API route.**

  **"For now" is recorded in four places, deliberately.** Plan D10, the plan
  changelog, `ui/tabs.tsx`'s header (which *names the rows that borrowed the
  control*, so the future filter-control task has its work list in the code)
  and `ui/badge.tsx`'s header (which names the rows that must **never** be
  folded in). `filter-chip-split.test.ts` asserts the first two headers still
  say so, because a header comment is the only artifact here that a refactor
  can silently delete.

  **The census — every `FilterChip` row, classified before anything was
  edited.** Fifteen rows across ten files. The classification, not the restyle,
  is what took the time: three of them look convertible and are not.

  | row | classification | disposition |
  | --- | --- | --- |
  | `app/admin/posts` Drafts / Published | single-select | → `Segment` boxed, label **× count** (the counts were hand-rolled `<span className="fs-num">`; they are now the component's own `count` prop) |
  | `lists/list-form-dialog` Position group | single-select (`''` = All players is an option) | → `Segment` boxed, **`grid grid-cols-4`** |
  | `lists/list-form-dialog` Public / Private | single-select | → `Segment` boxed |
  | `layout/rail/players-panel` On rosters / Free agents | single-select | → `Segment` boxed |
  | `lists/generate-ai-modal` `ChipGroup` ×3 (Position, Scoring, Players) | single-select | → `Segment` boxed grid; **one helper edit covered all three** |
  | `lists/lists-browse` position row | single-select ('All' is the zero option) | → `Segment` boxed |
  | `weekly-ranks/weekly-ranks-view` positions | single-select | → `Segment` boxed |
  | `explore/explore-feed` topics | single-select ('All' is `tagId === null`) | → `Segment` boxed — see the frame note below |
  | `lists/lists-browse` tag row | **multi-select** | left alone |
  | `lists/builder/player-sidebar` positions (`Set`) | **multi-select** | left alone |
  | `lists/generate-ai-modal` ranking styles (1–3 weight each) | **multi-select** | left alone |
  | `layout/rail/players-panel` position row | **zero selected is valid** | left alone — tapping the pressed chip sets `null` = all positions |
  | `lists/generate-ai-modal` AI expert | **zero selected is valid** | left alone — the field is Optional and starts with none chosen |
  | `leagues/roster-slot-builder` flex positions, IR designations | **multi-select** | left alone — and so **no file under `src/components/leagues/**` was opened**, which resolves the ACTIVE-BUILD tension by evidence rather than by exemption |
  | `app/styleguide` chip demo | demo | kept, and its caption now states the split |

  **`POSITION_FILTER_ACTIVE` was orphaned by this change and is deleted.** It
  was the plain-class twin of `POSITION_TAB_ACTIVE`, and both its consumers
  (`lists-browse`, `weekly-ranks`) moved to the `data-state` form — which they
  had to: a plain `bg-pos-qb` **loses** to the primitive's
  `data-[state=active]:bg-accent`, because the latter carries an extra
  attribute selector. Measured, not assumed: RB active renders
  `rgb(44,111,214)` = `bg-pos-rb`, the same value LV.9 measured on
  `players-spreadsheet.tsx`. `position-badge.tsx`'s header records where to
  find the deleted map if the filter control wants it back.

  **Two frame decisions, both made by looking, both worth the words.**
  (a) `explore-feed`'s topic row was built boxed, **tried bare, and put back**:
  bare is the right frame for a variable-length wrapping row, but the Radix
  tab set (Trending / Newest / Following) sits directly above it and is also
  bare, and un-framed the two read as one control — the exact filter-vs-tab
  blur D9 worried about. The frame is load-bearing; the cost is a ragged wrap
  below `sm`. (b) `list-form-dialog`'s eight positions were a wrapping flex row
  until the mobile screenshot showed **'K' stranded alone on a second line**
  with a gap above it; they are a `grid grid-cols-4` now, the same 4×2 the AI
  modal uses for the same choice.

  **The inline style that was already there is gone.** `ChipGroup` set
  `gridTemplateColumns` as an inline style. That was harmless on a plain `div`,
  but on this control an inline style is the documented way to kill `:hover`
  silently (the handoff's critical note, probed at LV.9) — so the column count
  is now a literal class and the file carries **no inline style at all**,
  rather than one for someone to extend with a colour. Verified live:
  `anyInlineStyle: false` on every converted group.

  **Measured, not asserted** (`getComputedStyle`, dev-local, desktop 1280 and
  mobile 375): active `rgb(61,92,255)` = `accent` with white text; inactive
  `rgb(255,255,255)` on `rgb(11,12,16)` = full-contrast ink; **hover
  `rgb(220,228,255)` = `accent-soft`**, measured twice (Visibility/Private and
  the AI modal's Position/QB) with a real pointer, matching LV.9's number;
  `boxShadow: none` at rest on every item; height 26px (`h-tab`) — identical to
  `FilterChip`'s `h-btn-sm`, so nothing moved. No horizontal overflow at 375px
  on any converted row.

  **Behaviour proven per row, not inferred.** Rail pool: Free agents **68**
  rows → On rosters **52**, different players. Legacy lists browse: **14** list
  cards → **3** on QB. Weekly ranks: heading "Week 1 · QB board" → "Week 1 · RB
  board". Explore: feed → "No sleepers lists yet" → back to the feed on
  re-tapping the active topic. Admin: "No drafts waiting" → "Nothing published
  yet". List form: created a list through the two converted rows and read the
  row back from the local DB — `position_filter: "QB"`, `is_private: true`.
  Also pinned the one **disabled** case: while the rail search is running both
  pool items go `disabled` at 40% opacity with neither active, which is a
  disabled state and not a user deselection — the same behaviour `FilterChip`
  had.

  **The probe, and it is the one that matters for this task.** The rail's
  position row — the "zero selected is valid" case — was converted to a
  `Segment` on purpose, i.e. exactly the mistake a later tidy-up would make.
  `filter-chip-split.test.ts` went **RED** on "the two rows that must never
  become segments are still chips", and the browser showed the regression
  itself: clicking the active QB a second time left `QB=active`, with no way
  back to all-positions. Reverted; the test is green and the same gesture
  measures `QB=false, RB=false, WR=false, TE=false` again.

  **Deferred, unchanged from LV.9.** `big-board/week-tabs.tsx` and
  `public-big-board.tsx`'s week strip are still the hand-rolled black-active
  recipe and are still off limits. The weekly-ranks screen now shows the new
  segment sitting directly above the old week strip, which makes the
  inconsistency more visible than it was — worth knowing, not worth breaking
  the boards rule for.

- **LV.1.5 (2026-08-11) — the tier CHECK is widened, and the widening turned out
  to be a read-side change too.** Migration
  `081_list_players_tier_vocabulary.sql` (one `ALTER TABLE`, one constraint, no
  new table, no new column, no new route), the tier route's Zod enum, one shared
  vocabulary module, and the LV.4 refusals it was blocking. The build's
  **second** schema exception, ruled by Chris 2026-08-09 (*"That's fine, do the
  database change."*); with LV.8 the budget is now **spent, three of three**.

  1. **The vocabulary shipped exactly as §3 Q2 approved it** —
     `^([SABCDF]|r([1-9]|[12][0-9]|30)|c[1-4])$`, 40 keys plus `NULL`. Nothing
     was changed, so nothing needed a reason. Two things *are* worth recording
     about it:

     - **`c1`–`c4` are accepted and nothing writes them.** LV.2/LV.3 shipped
       cost bands as **computed** from `players.auction_value` (D4 erratum,
       plan v3.8), so no `c*` key can be stored by any path today. They are in
       the vocabulary anyway, on purpose: they are the keys `DEFAULT_COST_BANDS`
       already uses, so *every* accepted key has a default label and
       `resolveBandLabel` can never render a raw key (the R181/R183 hazard); and
       **the schema budget closes with this migration**, so provisioning them
       now costs one character class where adding them later would cost a fourth
       exception. Recorded so a later reader does not delete them as dead.
     - **The round ceiling is 30 and the regex, not a comment, is what enforces
       it.** `r0`, `r31`, `r99` and `r01` are all `23514` at the database, each
       pinned in pgTAP 030 — because an off-by-one in a character class is
       invisible in the middle of a range.

  2. **The two layers are pinned to each other, not merely both edited.**
     `src/types/schemas/bucket-keys.test.ts` reads migration 081 off disk, lifts
     the regex out of the CHECK, and asserts Zod and the database agree over an
     exhaustive scan of every string of length 0–3 across the alphabet the
     vocabulary is built from (11,155 candidates) **plus** that the set they
     agree on is the vocabulary — two identically-broken layers would otherwise
     pass. Probed: adding `'c5'` to `COST_BAND_VALUES` alone reddens four
     assertions. This is the LV.8 `list_links.url` pin applied again, and it is
     the thing that stops the failure §3 Q2 named — a key Zod accepts becoming a
     `23514` the route returns as an HTTP 500.

     The route now **imports** `bucketKeySchema` rather than restating an enum,
     which is what §3 Q2 asked for when it noticed `TIER_VALUES` was exported
     and unused while the route inlined its own copy. A source pin in the same
     suite fails if an inline `z.enum([...])` comes back.

  3. **THE FINDING THIS TASK DID NOT EXPECT: widening the column would have
     crashed the public share view.** §3 Q2's blast-radius table asked what
     *writes* `tier`. It did not ask what *reads* it and assumes a closed set —
     and two surfaces did:

     ```ts
     const grouped = new Map<ListTier | 'untiered', PlayerEntry[]>()
     for (const tier of TIERS) grouped.set(tier, [])   // S–F only
     grouped.set('untiered', [])
     for (const p of players) grouped.get(p.tier ?? 'untiered')!.push(p)
     ```

     With `p.tier = 'r4'` that is `undefined.push` — a **TypeError**, and
     `public-list-view.tsx` is a **server component** on the SEO-critical share
     route (D7), so it is an HTTP 500 rather than a degraded page. The legacy
     detail view has the same shape in three places (`groupByTier`, the
     `TierGrid` memo, and `moveSelected`'s adjacent-tier carry). Both now key
     through `isTierKey`, which files anything that is not a tier letter with
     the ungrouped — the same answer `list-buckets.ts` already gave. Reproduced
     live with the fix reverted (*"Application error: a server-side exception
     has occurred"*, `TypeError: Cannot read properties of undefined (reading
     'push')` in the server log) and shown rendering with it back.

     **Rendering round *bands* on the share view is LV.6's**, not this task's.
     Round-bucketed players show as Untiered there for now, which is honest
     rather than wrong.

  4. **`TIER_BG` / `TIER_BAND_BG` were addressed, not deferred — and they moved
     house to be testable at all.** They were total `Record<ListTier, string>`
     maps with no fallback, so `TIER_BAND_BG['r1']` was `undefined` →
     `cn(undefined)` → a silently uncoloured band. They are now
     `bucketBandClass` / `bucketBadgeClass` in **`src/components/lists/
     bucket-colors.ts`**: total over `string`, with a *named* neutral fallback
     (`UNKNOWN_BUCKET_STYLE`) rather than a colour, because a bucket nobody can
     name should not be dressed as tier 1.

     Two reasons it is a new `.ts` file and not a rewrite inside
     `tier-badge.tsx`. **(a)** `tsconfig.json` sets `jsx: "preserve"` for Next,
     so vitest's esbuild leaves JSX in place and **any `.tsx` module is
     unimportable from a test** — which is exactly why these maps had no test
     for their whole life. Measured: importing `tier-badge.tsx` from a `.ts`
     test fails the file with *"content contains invalid JS syntax"*. **(b)**
     `list-buckets.ts` needed the same seven-step ramp and was carrying its own
     copy of the strings. `tier-badge.tsx` re-exports `TIER_RAMP` unchanged so
     `big-board/big-board-dashboard.tsx` — off limits — keeps its import path
     and its six-entry positional ramp; the seventh step lives only on
     `BAND_RAMP`.

     S–F colours are byte-identical before and after, pinned. Probed: returning
     `''` instead of the fallback reddens `bucket-colors.test.ts`.

  5. **What LV.4's refusals became. Rounds: real writes. Cost/budget: still
     refused, and that is the right answer, not a half-done one.** The task text
     asked for a judgement here rather than a flag flip, so:

     - **Round headers are now assignable** (`bucketDrop` returns the round key),
       and the dashed **"Drop a player here to start round N"** zone renders in
       round mode with the first unused round — `nextTierBucket` is renamed
       `nextBucket` because the old name became a lie the moment it could return
       `r7`. Both proven in the browser against the real routes: dragging Chase
       Brown onto the Round 2 header wrote `tier='r2'` **and** rewrote the whole
       order so bucket members stay contiguous (design LAW); dropping Jayden
       Daniels on the zone wrote `tier='r4'` and the section appeared between 3
       and 10. Read back from Postgres both times.
     - **Cost and budget stay computed and stay unassignable.** Enabling them is
       *not* a flag flip: `costBuckets` derives membership from
       `COST_BAND_MINIMUMS` and re-sorts `byCostDesc` on every render, so a
       stored `c2` would be ignored on read and the drag would visibly snap back
       — CLAUDE.md's "never let *nothing happened* mean *it worked*". Making
       them stored means ruling on whether a stored band overrides the computed
       one, what happens to unassigned players, and whether a band label may
       still *state* a threshold (`$40 and up`) it no longer enforces. That is a
       product question and it is **not** LV.1.5's to answer.
     - `ROUND_BUCKET_REASON` is kept and marked `@deprecated` rather than
       deleted, so the refusal reads as retired rather than lost.

  6. **The read is no looser than the write.** `list-buckets.ts` had its own
     `/^r(\d{1,2})$/`, which would have filed a hypothetical `r99` into a round
     section the vocabulary does not contain. Every membership test now comes
     from the same module the Zod schema and the migration are pinned to, and
     `list-buckets.test.ts` pins that `r31` renders as Ungrouped rather than as a
     31st section.

  **Typegen.** `src/types/database.ts` regenerated with
  `npx supabase gen types typescript --local` after a fresh `db reset` over the
  full 001→081 chain; the hand-written alias block re-appended and verified
  **byte-identical by sha256** (`d95ef0e6e048ac9d…` both sides). The file diff is
  **EMPTY**, and that is the evidence rather than the absence of it: 081 changes
  a CHECK, and `tier` is `text` before and after. `ListTier` in that block is
  deliberately left at exactly S–F — it is the tier-mode subset the legacy views
  compile against; the full wire set is `ListBucketKey` in
  `src/types/schemas/lists.ts`.

  **The migration has been applied LOCALLY ONLY.** `npx supabase db push` is
  Chris's separate step (CLAUDE.md migration discipline); the hosted project was
  not touched.

- **LV.5 (2026-08-11) — the AI surfaces had not drifted in style; they had
  vanished.** **UI/UX only — no migration, no schema change, no new API route.**
  The task reads as a restyle, and the restyle turned out to be the small half
  of it.

  **What the survey found.** Eleven AI/persona surfaces exist. Two of them —
  `generate-ai-button.tsx` and `ai-build-banner.tsx` — mount **only** inside
  `ListsPageLegacy` and `ListDetailPageLegacy`. `lists/v2/` contained the string
  "ai" nowhere. So with the flag ON:

  | | Behaviour before LV.5 |
  | --- | --- |
  | Create with AI | **no entry point anywhere on the Lists surface** |
  | A queued build job | never claimed — `useAiListBuild` had no v2 caller, so the loop never ran |
  | The build banner | never rendered; an errored job sat in `sessionStorage` narrating nothing (screenshotted before/after) |
  | `router.push('/app/lists/<id>')` | lands on `ListDetailPageV2`, **still a placeholder** |

  CLAUDE.md → Active Builds puts **AI stat lists** in the 2026 go-live scope, and
  LV.7 flips this flag. So the feature was one merge away from disappearing from
  the launch build with no error anywhere. This is the "never let *nothing
  happened* mean *it worked*" shape at the level of a whole feature.

  Four judgement calls the task text did not make:

  1. **The queued job is the deep link — no `?list=` parameter.** Lists v2 has no
     standalone detail screen; a list opens in the right-hand panel of the Lists
     page (§7 gap 1). The dialog therefore pushes `/app/lists`, and
     `ListsPageV2` reads `useAiBuildStore` to learn which list to open. A query
     parameter was the first design and was dropped: it needs `useSearchParams`
     (a Suspense boundary in a statically-rendered client route), and it carries
     no information the store does not already hold. **The selection is pinned
     while a build is live** — the list was created seconds ago and the
     collection query may not carry it yet, so the existing "selection follows
     the visible set" effect would read "not in `visible`" as "stale selection"
     and bounce to the first list, stranding the show off-screen. The pin
     releases when the job clears, by which point `use-ai-list-build` has
     invalidated the collection. The `featureFlags.listsV2` ternary in the dialog
     collapses at LV.7.
  2. **The banner is a `PanelShell` slot, not part of `children`.** The user
     arrives from the dialog *before* the detail query lands, so the banner has
     to render in all three panel states — loaded, skeleton, error. Composing it
     into the body would have shown it in one.
  3. **`canEdit` now excludes `aiBuild.building`**, matching the legacy page's
     `data.is_owner && !aiBuild.building`. Without it the user can drag rows
     while the ordering pass is rewriting them, and the two writes race over the
     same reorder route. Note the deliberate asymmetry inherited from the hook:
     an **error** job leaves the list editable (`building` is
     `job && job.phase !== 'error'`), which is right — a failed build should not
     lock the board.
  4. **`ScoutAiMark` extracted into `ui/ai-insight.tsx`** rather than hand-copied
     a fourth time. Three surfaces already carried the same eleven classes and
     the banner had drifted off them into a bare accent glyph. CLAUDE.md forbids
     near-duplicate components; the glyph is a prop so the banner uses the mark
     itself as its phase indicator (star → scouting, plus-circle → adding,
     sort → ordering) instead of a second icon beside a constant one.

  **The restyle proper**, derived from LV.2/LV.3 rather than invented — there is
  no reference screen for any of this: the square ink-bordered state cards, the
  explicit ×0.8 scale (`text-[13px]` / `text-[11px]`, replacing `text-sm` /
  `text-xs`), counts in `fs-num` **including the ones inside a sentence**, the
  v2 error card's `info-circle` + `Icon name="reset"` on Retry, and `shadow` on
  primary blue buttons. The **one** inline style left in the banner is the
  progress bar's `width`, which is data — there is no colour in an inline style
  anywhere in the diff, and the test pins that specifically rather than banning
  inline styles wholesale.

  **Personas: shallow, deliberately.** They are flag-gated off at launch
  (`featureFlags.personas`), and — measured, not assumed — they were already
  carried into the token language by the phase-4 reskin: `PersonaCard` rests at
  `box-shadow: none` / `transform: none` and lifts to `shadow-hard-4` with the
  −2/−2 translate on hover, no inline style, no literal hex. Redesigning a screen
  nobody sees at launch, with no reference in the design package, is exactly the
  improvisation the redesign rules warn against, so the depth went into the AI
  generation flow instead. **Shallow is not unguarded:** the persona components
  are pinned by the same colour/inline-style/resting-elevation assertions, which
  `ui/elevation-rule.test.ts` does not reach (it covers `src/components/ui/**`
  only). Where personas actually touch a launch surface — the dialog's "AI
  expert" row — they are in scope and were handled; LV.11 correctly left that row
  on `FilterChip` because zero-selected is a valid state.

  **Proof, and what was deliberately not spent.** The whole flow was exercised
  end to end in the browser with **`/api/lists/generate` stubbed client-side** —
  list creation, the six player POSTs, the reorder PATCH, the toast and the cache
  invalidation all real, only the Claude call intercepted. Six rows landed in the
  AI's rank order and `ai_call_log` stayed at **0**: no Anthropic call was made
  at any point in this session, and `seed:personas` was run with
  `ANTHROPIC_API_KEY` forced empty so it seeded the roster without generating
  lists. One thing worth recording because it looked like a defect and was not:
  the stub counted **two** hits on `/api/lists/generate`, which is
  `useAiGenerationQuota` reading the **same URL by GET** plus the one real POST —
  stack traces captured. Exactly one generation per build. The same over-broad
  matcher is why the "N of M left today" line was blank during the stubbed run.

  **Left alone, on purpose, and named rather than silently skipped:**
  `home/scout-ai-card.tsx` and `home/ai-expert-shelf.tsx` are Home surfaces, not
  Lists — the first still hand-rolls a `rounded-pill` variant of the Scout mark
  and should adopt `ScoutAiMark` whenever Home is reskinned. `list-detail-view.tsx`
  (legacy) was not opened; it is retired at LV.7.

- **LV.6 (2026-08-11) — the share view is the detail panel minus what a
  stranger cannot do, and the subtraction is a mechanism rather than a
  convention.** UI/UX only; no migration, no schema change, no new API route.
  `/u/[username]/lists/[slug]` stays a **server component** (plan D7) and now
  renders through the same v2 components the app panel uses.

  1. **Two gates, and they are different questions.** `RowHandlers` grew
     `canMark` beside `canEdit`. `canEdit` is "you own this list"; `canMark` is
     "you have an account at all" — a drafted mark is a row in
     `list_player_drafted` keyed by `user_id` (LV.1.2), so it is *not* an owner
     right and collapsing the two would have offered a signed-out viewer a
     checkbox that 401s. The public view passes `false` to both. Consequence
     worth naming: **the drafted checkbox is subtracted for signed-in strangers
     too.** RLS would permit it (LV.1.2's INSERT policy is "you may mark on any
     list you can read"), but a drafted mark is a tool for *your* board, not a
     reading control on someone else's, and offering it here would need a
     sign-in flow the design does not show. If that is wrong it is one prop.

  2. **Write gestures are absent, not no-ops.** `onDrop`, `onAddToBucket`,
     `onRenameBand`, `onEditNote`, `onRemove`, `onAddPlayers` and the Details
     tab's four handlers are all **optional** now, and every affordance is
     gated on `canEdit`/`canMark` **and** on its handler being present. The
     alternative — passing `() => {}` — is the shape CLAUDE.md forbids: a later
     edit re-enables the control and it silently does nothing. Probe A flipped
     both flags to `true` and **10 row menus appeared for a signed-out
     stranger**, while `Add players` and the bucket `Add +` stayed gone,
     because those need the handler as well. The double lock held under a
     deliberate break.

  3. **Two dead affordances were removed rather than faded.** With no drag
     story the grip is not rendered at all (an inert 9px dot column lies about
     an affordance), and `RowMenu` returns `null` rather than opening an empty
     popover. The table header's leading and trailing spacers follow the same
     two flags, so the columns still line up — checked in the browser. Both
     changes also reach the **signed-in non-owner** viewing a saved list, where
     the grip and the Add-note/Remove menu were already unreachable.

  4. **The LV.1.5 crash was reproduced here, not taken on trust.** The
     pre-LV.1.5 `Map`-seeded-with-S–F shape was reinstated for one run against
     a public list holding `r1` and `c1`: `curl` returned **HTTP 500 — Cannot
     read properties of undefined (reading 'push')**. Reverted, the same URL is
     **200** with both players in an Ungrouped section and the round key
     grouping as *Round 1* under the Rounds label set. Grouping goes through
     `buildBuckets`, total over `string`; `public-share-view.test.ts` runs the
     whole storable vocabulary plus `r99`/`zz`/`__proto__` through all five
     grouping modes and asserts no player is lost, duplicated, or left with an
     `undefined` band colour.

  5. **Where the toolbar was cut, and why there.** Grouping, view style,
     `Stats` and the budget field **stay** — they are session-only display
     state (D3), never touch the network, and are the difference between a
     share link that shows a board and one you can actually read your own way.
     `Add players` goes. One rule: **display stays, writes go.**

  6. **Three deliberate inventions, since the handoff has no share screen.**
     (a) The list title is the page's `h1` here and stays `h3` in the panel,
     which is a `heading` prop on the shell rather than two heroes. (b) The
     like count rides beside the view count in the tab row — a shared list is
     the social artifact and the page already had the number. (c) `Share`
     copies the page's own address, which is redundant on the page you are
     already on but is the gesture the hero is built around and needs no
     account. Dropped from the old page: the `Pro` badge (Pro is suspended —
     CLAUDE.md), and the Public/position/Big-board chips, which the cover fill,
     the Details tab and the position mix already say.

  7. **Two things fixed because they render on this page.** `ListCommentsTab`
     never read `lists.comments_enabled`, so the app panel showed a working
     composer on a list whose owner had turned comments off; both callers now
     pass it, and the public view also swaps the composer for a sign-in link
     when signed out. And the cards-view bucket rail sized its label by
     *renameability*, so `Ungrouped` and `No auction value` ran out of the 50px
     rail at 18px — it sizes by label length now. Both were reachable before
     LV.6; neither was reachable on a screen anyone had looked at.

  8. **Metadata stopped doing the whole load.** `generateMetadata` ran the full
     players + tags query for a title; it now runs a header-only query, which
     matters more than it did because the page's own load gained stats, links
     and a comment count.

  **Proof, signed out — and how dev auth was defeated.** Local dev
  auto-authenticates, so `NEXT_PUBLIC_DEV_AUTH=false` in the gitignored
  `.env.local` (restored afterwards) stopped `DevAuthProvider` re-signing in,
  **and** the surviving Supabase session cookie was cleared in the browser —
  disabling the provider alone leaves the old cookie, which is why the first
  capture still showed an avatar. Verified at 1280px and 390px: guest nav,
  lime signup banner, `Share` + `Pin → /login`, and an accessibility tree whose
  *entire* interactive surface is sign-in/sign-up, `@dev_user`, `Share`, `Pin`,
  the three tabs and the five display controls — no grip, no row menu, no
  checkbox, no pencil, no dots. SSR proved by `curl` with no cookies: all ten
  players, the `h1` and the Ungrouped section arrive in the HTML. Private lists
  proved twice — the route is **404** with no title, description or player
  leaking into the body, and the `anon` role reads **0 rows** from both `lists`
  and `list_players` for it.

- **LV.5 forward obligation → LV.7. ✅ DISCHARGED 2026-08-11.** `/app/lists/[listId]`
  renders `ListDetailPageV2`, **a placeholder**, whenever the flag is ON. LV.5
  routed the AI build show around it, but that route is reachable from the
  history store's "Recently viewed", from search, and from any saved link, and
  all of those land on a "coming soon" card today. **LV.7 must decide whether
  that route renders the real panel or redirects to `/app/lists`** — it is not
  the AI flow's problem to solve alone, and it is bigger than LV.5's scope.
  *LV.7's answer: it redirects. See the LV.7 entry below.*

- **LV.7 (2026-08-11) — the cutover, and the six decisions in it.**
  **UI/UX only — no migration, no schema change, no new API route.** Chris ruled
  §3 Q3 the same day (*"all four survive"*), and the ruling's second half —
  *"This is why I didn't want to rebuild from scratch"* — set the method: every
  ported item is the **existing** component or hook, mounted. Not one of the
  four was reimplemented.

  1. **The rail's drop zone goes on the panel shell, not in `ListBody`** — and
     that is a correctness constraint, not a layout preference. `ListBody`
     mounts its **own nested `DndContext`** for LV.4's gap model, and
     `useDroppable` binds to the nearest context; registered inside the body it
     would join the nested one, which the rail's app-level drag never enters, and
     the drop would silently land on nothing. `app-dnd-context.tsx` needed **no
     edit at all** — it already parses `list-drop:detail:<id>` with
     `overId.split(':').pop()`. Proven end to end in the browser: a rail row
     dragged onto the open list, *"Added 1 player"*, and the player still there
     after a full reload.

  2. **The player name is `role="button"`, not `<button>`, and it measures its
     own press.** The whole row is the drag surface (LV.4), and
     `use-list-drag.tsx`'s `guardListeners` refuses to start a drag from
     anything matching `button, a, input, textarea, select, [role="menuitem"],
     [contenteditable]` — so a real `<button>` would have made the name a dead
     zone for dragging, i.e. would have broken ruling (1) to satisfy ruling (2).
     A `role="button"` span keeps both. It then has to tell a click from a drag
     itself, which it does by measuring the press against dnd-kit's own 6px
     `MouseSensor` threshold rather than by reading a "a drag just ended" flag,
     which would race dnd-kit's teardown. Wired in all three view styles;
     **deliberately not passed on the public share view**, so LV.6's subtraction
     list is unchanged and a stranger still sees inert text.

  3. **Folders are carried, not redesigned.** The design package defines no
     folders screen, so `v2/lists-folders.tsx` is the retired page's grid and
     scope crumb over the same `use-folders.ts` and the same
     `folder-form-dialog.tsx`. Two forced differences, both stated in the file:
     the per-folder *Draft mode* button is gone (its destination is deleted by
     this same task), and folders appear on **My lists** only, because
     `lists.folder_id` is the owner's field and a saved list has nothing to file.
     `app-dnd-context.tsx`'s `folder-drop:` arm is **left in place and left
     dormant** — reviving it needs a `kind: 'list'` draggable that v2 does not
     have, and inventing one is the improvisation §3 Q3 refused.

  4. **`ranking_mode = 'rank_and_tier'` keeps a writer, and it is the same
     write the retired control made.** The grouping control persists exactly one
     thing: **Tier** → `rank_and_tier`, and **Rank** → `ranked` *only when the
     list is currently `rank_and_tier`* — that pair is "flip tiers on / off",
     which is what the deleted *List order / Tiers* tabs did. An `unranked` list
     stays `unranked` (the retired control was hidden entirely on `hide_order`
     lists, so promoting one would be a behaviour this task invented rather than
     carried), and round/cost/budget persist nothing because D4 makes them label
     sets over computed membership. **D3 still holds** — the display store
     writes nothing; this is the route call its own header always said would sit
     *alongside* `setOrg`. Both directions proven against the live API: picking
     Tiers wrote `ranking_mode: "rank_and_tier", tiers_enabled: true`, picking
     Ranked wrote `"ranked"` with `hide_order` untouched.

  5. **`/app/lists/[listId]` redirects rather than renders.** Rendering the
     panel standalone would need its own page shell — a rail-less hero, its own
     close/expand semantics, its own selection state — which is the
     two-Lists-pages state this whole task exists to end. So the URL points at
     the panel: a **server component** issuing `redirect('/app/lists?list=<id>')`,
     which means no placeholder flash and no client round-trip. The page seeds
     its selection from `?list=`, and **pins it**, so a list the viewer can see
     but neither owns nor saved — which that route could always open — is not
     bounced to whatever sits first in the rail.

     **The first cut of this was broken, and the browser is what caught it.**
     Written as a `useEffect`, the seed was overwritten inside the same commit:
     the auto-selection effect ran with a closure that still saw
     `selectedId === null` and an empty collection, and wrote `null` over the
     deep link. The URL said one list and the panel showed another. Fixed by
     seeding `useState` instead, so the pin is live on the effect's very first
     run. No test would have found this — it is a render-order fact.

  6. **The old `/app/lists/draft-mode` redirects to `/app/lists` rather than
     404ing.** That URL is in histories and bookmarks because *the app* sent
     people there — a lime CTA and every folder tile linked to it. Its
     `?folder=<id>` scope is dropped rather than translated: v2 scopes folders in
     page state, not in the URL, and minting a URL contract for it here would be
     inventing UI the design LAW does not ask for.

  **Deleted, with the count reconciled:** the flag, its `.env.example` block,
  `src/lib/lists-v2-flag.test.ts` (7 tests), `list-detail-view.tsx`,
  `lists-browse.tsx`, `list-card.tsx`, `comments-thread.tsx`,
  `customize-popover.tsx`, `editable-thumbnail.tsx`, `list-detail-page-v2.tsx`,
  and `lists/draft-mode/**` (5 files). `customize-popover.tsx` could not simply
  go: `v2/list-stats.ts` imported its `ListRowStatKey` union, so the **type
  moved** into `list-stats.ts` rather than a whole component file being kept
  alive to export a string union. Unit tests: **931 → 949**, which is
  `931 − 7 + 25` — the 25 being the replacement pin,
  `src/components/lists/lists-cutover.test.ts`.

  **One latent bug in a shared test helper was fixed because the pin could not
  move without it.** `use-draft-mode.test.ts`'s `code()` stripped block comments
  first and line comments second, so a line comment *containing* `/*` — the
  panel's own ``// … `/app/**` is behind auth …`` — was read as an opening token
  and swallowed half the file. Both `code()` helpers now strip in one
  alternating pass, which is order-correct by construction.

  **`use-draft-mode.ts`'s header was corrected in the same PR** (the R192-shaped
  hazard, one file over): it named two consumers that no longer exist and said
  turning draft mode off clears the marks — there is no draft-mode toggle any
  more. Its `enabled` / `setEnabled` are now consumer-less and are **left in
  place** with an F-row rather than ripped out mid-cutover.

- **LV.12 (2026-08-11) — the picker, and the plan clause the design package
  contradicts.** **UI/UX only — no migration, no schema change, no new API
  route**; the budget stays closed at three. Four things worth carrying
  forward.

  1. **"Honours the My lists / Saved tab" is wrong, and it is an erratum rather
     than a halt.** Three independent sources say the picker offers *every*
     list: `docs/design/lists/design/ListsScreen.jsx:431` reads
     `st.myLists().concat(st.savedLists())` and never consults `st.tab`; the
     same file hides the tab control entirely in compare mode (`:49`), which
     `lists-page-v2.tsx` already did too; and
     `screens/side-by-side-picker.png` renders **9** cards, which is exactly the
     prototype's **7 own + 2 saved**, own first (the seed's two saved lists are
     `lists.js:127` and `:141`). The clause carries no D-entry, and every
     deliberate deviation from the handoff in this plan has one — so it is an
     error, and the documented authority order (design LAW > plan > this file,
     plus `screens/README.md`'s "screenshots outrank the prose") resolves it
     without a ruling. **The LV.4 precedent governs**: D4's *"nothing is
     computed"* was likewise falsified by the design package and folded as a
     plan erratum by the Builder. Plan → **v5.1**.

     It also matters that the clause was a **trap, not a simplification**: with
     no tab control on screen there is no gesture that changes the filter, so a
     viewer on *My lists* could never compare a saved board and one on *Saved*
     could never compare their own. Comparing your board against someone
     else's is the reason the mode exists.

  2. **The primary CTA needed somewhere to go, so LV.12 owns the committed
     state and a temporary panel.** `compareIds` is a `React.useState` in
     `lists-page-v2.tsx` — the component that renders *both* the page header
     and the body — because LV.13's `Change lists` button lives in that header
     and has to read the same "is a comparison chosen yet". Behind it,
     `ComparisonPending` is a deliberately temporary branch: without it the
     picker would commit a comparison and change nothing on screen, which is
     CLAUDE.md's "never let nothing happened mean it worked". **LV.13 deletes
     that function**; its `Pick different lists` escape is *not* the header's
     `Change lists` and must not be mistaken for it.

  3. **Scale was converted, the checkbox deliberately was not.** The handoff's
     numbers are 1× and the app is ×0.8, so `minmax(232px)` → `minmax(186px)`
     and the 30px cover → `ListCoverTile size={24}` — the same conversions the
     shipped gallery (268 → 214) and rail (30 → 24) already made. The **16px
     checkbox stays 16px** because `DraftedCheckbox` already takes the
     prototype's 14px box at 1:1; converting only this one would invert the
     design's own size relationship between the two boxes. Measured in the
     browser: 3 columns of 186.7px at 1280 viewport, **one column of 343px at
     375** with `document.scrollWidth === 375` (no horizontal overflow) — that
     is what a phone gets, and it needed no breakpoint of its own.

  4. **The cards are named explicitly.** `ListThumbnail` is `aria-hidden`, so
     the accessible name computes from the title span — and `read_page`'s
     a11y tree showed the cards with **no name at all** before an
     `aria-label` was added. The rail already carried that same guard and the
     same comment; this is the second surface to need it, which is worth
     remembering when LV.13 builds column headers out of the same parts.

  Pinned by `src/components/lists/v2/side-by-side-picker.test.ts` (13 tests at
  landing, **17 after the fix round, 18 after R213**) — the tab set, the
  session-only storage,
  the elevation rule, the composition, the copy, and (added by R208) the chain
  that makes the saved half capable of being non-empty. **Shown falsifiable**:
  reinstating the tab filter and adding a resting `shadow-hard-4` turned exactly
  the two matching tests red, then both were reverted and the suite went green
  again.

  ---

  **Fix round — 2026-08-11 (review verdict FIX-THEN-MERGE, R207–R212; §6 carries
  the findings).** The erratum itself was re-verified by the Reviewer from all
  three design sources and **upheld** — nothing about the picker's behaviour
  changed. What changed is the evidence behind it, and both corrections are the
  same CLAUDE.md rule twice over.

  5. **The verification ran against hosted *production*, and neither the PR nor
     this file said so (R207).** `.env.local` sets
     `NEXT_PUBLIC_SUPABASE_URL` to the **hosted** project, so a plain
     `npm run dev` drives real users' data; the memory note
     `local-db-reset-recovery` says exactly this and it was not applied. Seven
     `LV12 tmp…` lists were created and cleaned up in the hosted project
     (2026-08-12 05:11–05:12 UTC, owner `b8e85002`). **They are left in place,
     soft-deleted.** The cleanup was already correct per Key Business Rule 8 —
     *never hard-delete lists* — so "tidying" them now would break a standing
     rule to hide a process failure. No live row leaked, no seed file changed,
     nothing hosted was schema-touched.

     **Re-verified against the local stack**, and the environment is now
     evidence rather than assertion: the gitignored `.claude/launch.json`
     config **`dev-local`** (port 3123) overrides the URL and keys to
     `http://127.0.0.1:54321`, and the browser's own network log shows
     `GET http://127.0.0.1:54321/auth/v1/user → 200` and
     `…/rest/v1/profiles?…id=eq.11111111-1111-4111-8111-111111111111` — the
     local dev user, not a hosted one. The durable form of this lesson is in
     `ACTIVE-BUILD.md`'s standing constraints, where the *next* Builder reads
     it, not only here.

  6. **The saved half of `[...mine, ...saved]` was empty in every run, so the
     erratum's headline behaviour was never once exercised (R208).** The
     verifying account had favourited nothing: the collection returned `2 own,
     0 saved`, which means every "it works" observation in the original PR was
     taken over `[...mine, []]`. A picker that dropped saved lists entirely
     would have looked identical. That is the *"never let 'nothing happened'
     mean 'it worked'"* rule, applied to a verification instead of a query.

     **Now shown, against the local stack, end to end:**

     | Step | Evidence |
     | --- | --- |
     | Second account owns a list | `LV12 local fixture — dev-pro's WR room` (6 WRs), owner `22222222-…` = `dev-pro@fieldscout.local`, `is_private=false`. **Seeded into the local DB only** — the R167 precedent. **Left in place on purpose**: the next Builder's local stack now has a non-empty `saved` half by default, which is the condition LV.12 never had. A `supabase db reset` wipes it — re-create it (a public list on the `dev-pro` account, favourited from `dev@`) before verifying anything about saved lists |
     | Saved through the shipped path | `POST /api/lists/bbbb2222-…-cd01/favorite` → **`200 {"is_favorited":true}`** (the real route, real cookie, RLS as the viewer) |
     | Collection now carries it | `GET /api/lists` → `Secret sleepers (own)`, `Consensus WR top 10 (own)`, `LV12 local fixture… (owner: devpro)` — so `saved.length === 1`, not 0 |
     | The tab really is on **My lists** | `My lists 2` `aria-pressed="true"`, `Saved 1` `aria-pressed="false"`, checked *before* entering compare mode |
     | The picker offers the saved list anyway | 3 cards: `Secret sleepers, 3 players` · `Consensus WR top 10, 10 players` · **`LV12 local fixture — dev-pro's WR room, 6 players`**, with the tab control absent from the DOM (`ListsScreen.jsx:49`) |
     | And the mirror direction | switched to **Saved** (`aria-pressed="true"`, rail down to that one list) → the picker still offers all **3**. Tab-independent both ways, which is the whole erratum |
     | It commits, not just renders | picked the saved list + one own → CTA read `Show 2 lists side by side` → panel: *"2 lists ready to compare — LV12 local fixture — dev-pro's WR room · Consensus WR top 10"* |
     | The tab never moved under it | back to List mode → `My lists` still `aria-pressed="true"` |
     | Clean | zero console errors across the run |

     **Pinned so an empty run cannot pass silently again**, within what this
     file's idiom can honestly claim. Four new source pins (13 → **17**) cover
     the chain that produces a saved list at all: the route reading
     `list_favorites`, its `.neq('owner_id', user.id)` fetch of others'
     favourited lists, the `owner: rest.owner_id === user.id ? null : ownerObj`
     attachment, and the page's `saved: all.filter((list) => Boolean(list.owner))`
     — plus the picker rendering `lists.map` with no filter of its own. **Three
     probes, each 1 red, each reverted to 17/17:** route stops attaching `owner`
     → 1 red *and*, checked live, the hosted-shaped degradation appears in the
     browser (the favourited list arrives classified as **own**, tabs read
     `My lists 3 / Saved 0` — the saved half structurally empty forever);
     `.in('id', [])` → 1 red; and `saved: []` in the page → 1 red, which is
     **literally the condition the original verification ran under** and now
     cannot recur unnoticed. What a source pin still cannot do is observe an
     empty array at runtime — the live evidence above is what carries that, and
     the test file says so in its own words rather than implying more.

     **These four pinned the chain's *shape* and not its two field selections,
     and the second review pass broke it straight through them (R213, §6).**
     Trimming `owner:profiles!owner_id` out of `ownedSelect` — a routine
     payload-size edit — left all 17 green while `saved` became `[]` for every
     user forever. An 18th pin now covers both selections, shown red under each
     break and reverted; §6 carries the probe evidence.

- **LV.13 (2026-08-11) — the columns, and the two rules that had to be shared
  rather than copied.** **UI/UX only — no migration, no schema change, no new
  API route**; the budget stays closed at three. Five things worth carrying
  forward.

  1. **The full-bleed scroller is pinned to the *shell's* gutter, not to a
     number.** The design LAW's `margin: 0 -36px; padding: 0 36px 8px` only
     works when the 36 is the page's own horizontal padding. This app's is
     `px-4 lg:px-7` (`app-shell.tsx`; `/app/lists` with no trailing slash is
     **not** in `FULL_BLEED_PREFIXES`, so it really is padded) — and 28px *is*
     36 × 0.8, which is the conversion landing on the token that already
     existed. The two numbers must move together: a negative margin larger than
     the padding pushes the whole page into a horizontal scroll, a smaller one
     stops the strip short and the bleed silently does nothing. **Both halves
     are pinned, and the break was measured, not reasoned about**: `lg:-mx-10`
     against `lg:px-7` turned the pin red *and*, live in the browser,
     `main.scrollWidth 982 > clientWidth 970` — a real page-level horizontal
     scroll. Reverted; back to `false` and 21/21.

  2. **Two rules moved into `list-buckets.ts` instead of being written twice.**
     A column and the detail panel now render the same list at the same time, so
     a second copy of either rule is a chance for them to disagree on screen.
     * **`bucketHeading(org, bucket)`** — a column's band says `Tier 1`,
       `Round 4`; the detail view's says `S`, `4`. That is not an inconsistency
       to tidy up: the LAW forbids the panel's sections repeating the word
       because the grouping dropdown sits directly above them, and a column has
       no such dropdown (its grouping is inside the `dots` menu). Only the two
       *stored* vocabularies take a prefix — `Ungrouped`, `$40 and up` and
       `Over 20% of budget` are already sentences, and the prefix is keyed off
       the bucket **key** so an out-of-vocabulary `r31` cannot become
       "Round Ungrouped".
     * **`rankMap(buckets)`** — the running `#N`. `useRanks` in `list-body.tsx`
       is now just its memo. Without this a player could be #9 in the panel and
       #10 in the column he is being compared against.
     Both are **executed** in `list-buckets.test.ts` (+6 tests — 4 for
     `bucketHeading`, 2 for `rankMap`; the file goes 10 → 16), not source-pinned
     — which is why they are where they are.

  3. **The grouping menu writes to the session store and nothing else.**
     `list-display-store` is keyed by list id, so `setOrg(thisList, …)` *is*
     "each column groups independently" with no new state (the prototype does
     the same, `st.patch(list, { org })`) — and a column and the panel showing
     the same list agree because they read one value. The menu deliberately does
     **not** persist `lists.ranking_mode`: the panel's control does, and that
     write is a restoration of the last `rank_and_tier` writer in the codebase
     (§3 Q3, LV.7), not a rule about grouping. D3 governs the rest, and a
     comparison routinely holds lists you do not own, where that write is not
     yours to make.

  4. **A tick is one tick on one list, and the count is honest about what it
     knows.** `useDraftMode(listId)` per column, one row in
     `list_player_drafted` — the fan-out is LV.14's (D12). The header's
     `N of M left` is derived per column from that column's own rows, which is
     the count D12 asks for as well. It reads `Loading…` before the rows land
     and `Could not load` when the read failed, rather than `0 of 0 left`:
     a headline number claimed over a request that has not answered is
     CLAUDE.md's *"never let 'nothing happened' mean 'it worked'"* on the one
     screen where that number is the entire point.

  5. **Column headers are named explicitly, because LV.12 warned they would need
     to be.** `ListThumbnail` is `aria-hidden` and the title sits in a nested
     span, so each column is a `<section aria-label={title}>` and each `dots`
     button an `aria-label={`Options for ${title}`}`. Confirmed in the a11y
     tree, not assumed — `read_page` reads back
     `button "Options for Consensus WR top 10"`, four named column landmarks.

  **Verification environment, stated rather than implied (R207).** Local stack
  only: `.claude/launch.json` config **`dev-local`** on port 3123, and the
  browser's network log shows `GET http://127.0.0.1:54321/auth/v1/user → 200`
  and the `dev@fieldscout.local` profile id `11111111-…`. Nothing hosted was
  read or written.

  | Observation | Evidence (local, 1280×900 unless stated) |
  | --- | --- |
  | Four columns, top-aligned, different heights, flat with a 1px ink border | matches `screens/side-by-side-columns.png`; `boxShadow: "none"` on all four at rest, `hover:shadow-hard-4` present |
  | Column geometry | `getComputedStyle` → column `width: 240px`, row `height: 30px` |
  | Full bleed | scroller margin `-28px/-28px` against padding `28px/28px` at `lg`; `−16/16` at 375 — the shell's own gutter at both |
  | No page-level horizontal scroll | `document`, `body` and `main` all `scrollWidth === clientWidth`, at 1280 **and** at 375 |
  | Bands carry colour through, per column | `Tier S · Tier A · Tier B · Tier C · Ungrouped` on one column while another shows `Round 1 · Round 2 · Round 3 · Round 4` — the `tier-*` ramp, red → orange → gold, dark text on gold |
  | Each column groups independently | the `dots` menu on the round-board column switched it to **Rounds** and no other column moved |
  | The menu is the LAW's | `Ranked · Tiers · Rounds · Avg cost · Budget %`, separator, `Remove column` — widened to 168px because `Remove column` wrapped at 144 |
  | One tick, one list | ticked A.J. Brown in the round-board column → that row struck and greyed, header `8 of 8 left` → **`7 of 8 left`**; the *other three* columns all contain A.J. Brown and **none** of them changed. `list_player_drafted` holds exactly **one** row |
  | Drafted is fill + strike-through, never elevation | row `bg-n-4`, name `text-decoration-line: line-through`, `opacity 0.6`, no shadow |
  | The mini card is the app's existing one | clicking a name opened `player-window.tsx` with list context (its `Remove` action present on an owned list) |
  | `Remove column` narrows rather than clears | 4 columns → removed the saved one → 3 remain |
  | `Change lists` | present in the header only past the picker; clicking it returned to the picker and the button disappeared with it |
  | 375px, per the ruling | the 240px columns are unchanged and the strip scrolls sideways (`scrollWidth 772 > clientWidth 375`); `touch-action: auto` the whole ancestor chain and no `touchmove` preventDefault, so a swipe pans it; `Change lists` / `New list` wrap onto their own row in the in-page header instead of colliding |
  | Clean | zero console errors across the run |

  **Both of the column's non-happy states *were* exercised live — the LV.13
  Reviewer got there, and the method is the deliverable** (**R223**; this
  paragraph previously recorded them as source-pinned only). Two things are
  worth carrying into LV.15 – LV.17, which will need exactly this to show a
  pop-out's loading and error states:

  1. **Why a `fetch` monkey-patch looks installed and still does nothing.**
     **React Query pauses retries while `document.hasFocus()` is false**, so an
     unfocused automation tab parks the query in `pending` forever rather than
     resolving to `error`. Read off the fiber, that state is
     `status:'pending', fetchStatus:'fetching', failureCount:1,
     failureReason:'List not found'` — the failure *has* happened and is simply
     not being surfaced. Dispatching a bubbling `visibilitychange` releases it.
     A patched `fetch` that appears to be ignored is very often this, not the
     patch.
  2. **The route that just works** — make the server say no, from outside the
     browser:
     `docker exec supabase_db_fieldscout psql -U postgres -d postgres -c "update lists set deleted_at = now() where id='<id>'"`,
     **after** the picker's collection query has cached (so the list is still
     offered), then commit the comparison. `GET /api/lists/<id>` → **404**, and
     the column renders `Could not load` in the header with *"This list could
     not be loaded. / List not found"* in the body — **never an empty column**,
     which is the outcome that would have mattered. `Loading…` was captured at
     commit, on the way in.

  The branch order — `isError` before `!entries` before rows — is what makes
  those two distinguishable, and it is now observed rather than only read.

  **Local fixture added, and left in place** for the same reason R215 left
  LV.12's: `LV13 local fixture — round board`, owned by `dev@fieldscout.local`,
  8 players carrying `r1`–`r4`, so a *round*-grouped column exists to compare a
  tier-grouped one against. It is the **only** list on the local stack that can
  produce a round-grouped column, which is what makes "each column groups
  independently" observable at all. Local DB only; `supabase db reset` wipes it.
  The LV.12 saved-list fixture was **not** touched. **The re-creation steps live
  in `ACTIVE-BUILD.md`'s standing constraints**, beside LV.12's — this entry
  originally carried them only here, which is the exact placement R215 had
  corrected one task earlier (**R219**).

  Pinned by `src/components/lists/v2/side-by-side-columns.test.ts` (**22** source
  pins after the review round's R218) and `list-buckets.test.ts` (**+6**
  executed — the file goes 10 → 16). **Every assertion in the new file reads the
  comment-stripped source** — LV.12's review twice found a pin green for the
  wrong reason, one of them satisfied by a *comment*, and this file documents the
  decisions its own negative assertions forbid. **Two probes, each shown red and
  reverted:** `bucketHeading` collapsed back to the value-only rule → 2 red
  (`expected [ 'S', 'A' ] to deeply equal [ 'Tier S', 'Tier A' ]`); the
  full-bleed pairing broken to `lg:-mx-10` → 1 red *and* a measured page-level
  horizontal overflow in the browser. Suite 967 → **994**, and → **995** with
  R218's added pin. **The arithmetic reconciles**: 21 new source pins + 6 new
  executed tests = 27 = 994 − 967. *(It read "+10 executed" in two places until
  the review round — **R221** — which reconciled to nothing and, worse, would
  have taught the next Builder to trust a stated delta over a counted one.)*

  ~~**One state ships with the copy ahead of it, and the interval is recorded
  rather than papered over** (**R220**).~~ **✅ DISCHARGED BY LV.14, 2026-08-12.**
  The picker's sub-line — *"Mark players off as they go in your draft and every
  column updates"* — is the design's verbatim copy, shipped since LV.12, and
  **LV.13 was the release that made it observably false**: ticking A.J. Brown in
  one column moved that column `2 of 2 left → 1 of 2 left` while the other three
  columns containing him stayed `aria-pressed="false"` with unchanged counts.
  That was never a defect in LV.13 — one tick, one list is exactly what D12
  assigned to LV.14 — but before LV.13 there were no columns on screen to
  contradict the sentence. **LV.14 made it true** (fan-out across the comparison
  set) and cleared the interval paragraph from `side-by-side-picker.tsx`'s JSDoc;
  the copy itself was never edited. The measurement that closes it is the inverse
  of the one above: one tick, **three** columns struck, three rows. See the LV.14
  entry below.

- **LV.14 (2026-08-12) — the drafted fan-out: the comparison set *is* the
  draft.** **UI/UX only — no migration, no schema change, no new API route**;
  the budget stays closed at three. N writes through LV.1.2's route, keyed
  `(user_id, list_id, player_id)` exactly as shipped.

  1. **The ruling is the boundary, and the boundary is the only input.** D12
     reconciles the design package (a tick marks *"every list containing him"*;
     `side-by-side-columns.png` shows Nabers struck in all five) with Chris's
     2026-08-10 override (*"per user, per list… players will have multiple lists
     for multiple leagues"*) by making the **comparison** the scope. So
     `drafted-fan-out.ts` is built only from the columns that **registered
     themselves**, in the page's own `ids` order, and it deliberately holds no
     way to ask "which lists contain this player" — a question whose answer is
     wider than the comparison, which something would eventually call. Pinned
     negatively (no `fetch(`, no `useQuery`, no `/api/`) and shown red by fanning
     out to every column instead of the containing ones.

  2. **It is a `.ts`, and that is the whole reason it is a separate file.**
     This repo's vitest is node with no jsdom, so a decision left in a `.tsx`
     hook body is pinned by nothing (R191). D12 is a set intersection plus a
     partial-failure protocol — decisions, not markup — so they live where they
     can be **executed**: 28 of the new file's 33 tests run the real functions,
     and only the 5 that guard JSX wiring and cited constants read source.

  3. **The per-column rollback is measured, not reasoned about.** "Each column
     has its own cache key, so a failed write can only roll its own column back"
     is precisely the shape of claim R190, R195 and R199 each defeated — right in
     the middle, wrong at an edge. So `markMutationOptions` was **extracted from
     the hook body** (the same move `draftedQueryOptions` already made in that
     file, for the same reason) and the suite drives five real cache entries in
     one real `QueryClient` through a wire that refuses exactly one: four keep
     the mark, the fifth returns to the array it held before, byte for byte.

  4. **`notify: false` buys the caller the telling, and nothing else.** The
     rollback sits **above** the branch. The reason a fan-out needs one report
     rather than N is not taste: `use-toast.ts` sets **`TOAST_LIMIT = 1`**, so
     three failing columns toasting individually would be two *invisible* toasts
     and one survivor naming a single column — "nothing happened means it
     worked" wearing a failure message. The aggregate names every failure and
     counts what landed.

  5. **The failure model was stated before it was built, and every column state
     has an answer** (R190's "cross the consequences with each other"):
     `in` → written; `out` → untouched (D12 consequence 2); `loading` → skipped
     **and reported**, because that column will shortly render a row that
     disagrees with its neighbours and say nothing; `unreadable` → skipped
     **silently**, because the column already reads *"This list could not be
     loaded"* permanently and a toast per tick would fire for the rest of the
     draft. A column whose rows have not arrived is `loading`, **never** `out` —
     `memberIds` is `null` rather than an empty Set for exactly that reason, and
     the ternary's order is pinned as one string so an arm cannot be reordered.

  6. **The crossing with `hasRead`, stated rather than assumed.** N optimistic
     `setQueryData` writes are still N cache writes, and the landing flag is
     raised only inside the `queryFn` — so fanning into a column whose *drafted*
     read failed leaves that list's `hasRead` false and its *Clear drafted* still
     refused. R195's rule holds under the new caller. **This one is pinned and
     reasoned, not measured live** — it has no user-visible surface on this
     screen — and is called out here rather than folded into the table below.

  **Verification environment, stated rather than implied (R207).** Local stack
  only: `.claude/launch.json` config **`dev-local`** on port 3123; the browser's
  network log shows `GET http://127.0.0.1:54321/auth/v1/user → 200` and the
  `dev@fieldscout.local` profile `11111111-…`. Nothing hosted was read or
  written. Every row below was checked against the database with
  `docker exec supabase_db_fieldscout psql`, not inferred from the screen.

  | Observation | Evidence (local, 1280×900) |
  | --- | --- |
  | **The fan-out** | comparison = `LV13 fixture` + `Consensus WR top 10` + `LV12 fixture (saved)`. Ticked A.J. Brown in **one** column → **all three** struck (`aria-pressed=true`, `line-through`), headers `8 of 8 → 7 of 8`, `10 of 10 → 9 of 10`, `6 of 6 → 5 of 6`, and `list_player_drafted` held exactly **3** rows |
  | **The ruling — a list outside the comparison** | `Secret sleepers` (dev@, holds A.J. Brown, deliberately **not** picked) gained **0** rows. This is the observation the whole task exists for, and the design package would have failed it |
  | **A player in only some columns** (D12.2) | Josh Allen is in `LV13` and `Secret sleepers` only. Ticked → **1** row (LV13), the other two columns unchanged at `9 of 10` / `5 of 6`, `Secret sleepers` still **0** |
  | **Unticking is symmetric** (D12.4) | unticked A.J. Brown from a **different** column (Consensus) → all three rows gone, counts back to `7 of 8` / `10 of 10` / `6 of 6`, and **Josh Allen's mark untouched**. Total 4 → 1 rows |
  | **Partial failure** | soft-deleted `Consensus WR top 10` via psql *after* its rows had cached, then ticked. Wire: **3** POSTs — `cccc3333 → 200`, `aaaa1111 → 404`, `bbbb2222 → 200`. Screen: the two that landed struck, **the refused column rolled itself back** (A.J. Brown unticked, `10 of 10 left`). DB: 2 rows, none on the refused list |
  | **…and the user is told, once, by name** | *"Not every column was updated — A.J. Brown was marked in 2 of 3 columns. Consensus WR top 10 could not be updated, so nothing changed there."* One toast for one gesture |
  | **A column still loading is skipped and reported** | committed the comparison with `Consensus` soft-deleted so its column parked at `Loading…`; ticking wrote **2** rows and toasted *"…Consensus WR top 10 has not loaded yet, so A.J. Brown was not checked there."* |
  | **A column that failed to load is skipped silently** | released the parked query → the column rendered `Could not load` / *"This list could not be loaded. / List not found"*. Ticked **two** further players: both wrote **2** rows each (`6 of 8 → 5 of 8`, `4 of 6 → 3 of 6`) and **no new toast appeared** (the on-screen toast was the previous one, `data-state="closed"`, text unchanged, no mention of either player). DB: **0** rows on the unreadable list |
  | **The detail panel is unchanged** (D12.5) | opened `LV13 fixture` on its own, ticked A.J. Brown in the panel's card view → **1** row, on that list only, although he sits on four lists |
  | **Clean** | the only console errors are `sleepercdn.com` headshots (`ERR_CONNECTION_REFUSED` — no outbound network in this sandbox, pre-existing) and the 404s this session deliberately caused. The one aborted `/drafted` GET is `cancelQueries` during a mark, which is R199's intended behaviour |

  **A correction to the technique R223 left for LV.15 – LV.17, found by using
  it.** R223 records that React Query parks a failed query in `pending` while
  the tab is unfocused and that *"a bubbling `visibilitychange` releases it"*.
  **That is necessary and not sufficient**, and it failed here: React Query v5's
  `focusManager.isFocused()` reads `document.visibilityState`, which in an
  automation tab is genuinely `'hidden'` (`document.hasFocus()` was `true` and
  `navigator.onLine` was `true` — neither is the gate). Dispatching the event
  only makes it *re-read* a value that has not changed, so the retry stays
  paused forever. The working form is to change the value first:

  ```js
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
  ```

  That is what turned `Loading…` into `Could not load` above, and it is why both
  skip branches could be shown live rather than one. The pop-out tasks face the
  same problem, so it is corrected here where R223 put the original.

  **The local fixtures are intact and were restored.** `Consensus WR top 10`'s
  `deleted_at` is back to `null` (it was soft-deleted twice, deliberately, and
  restored both times), and both documented fixtures — LV.12's saved
  `dev-pro` list and LV.13's `r1`–`r4` round board — are untouched, tiers
  included. `list_player_drafted` was left **empty**; the single stale row LV.13's
  run had left behind was cleared at the start so the counts below could not be
  read over pre-existing state. Local DB only; nothing hosted was touched.

  Pinned by `src/components/lists/v2/drafted-fan-out.test.ts` (**33**: 28
  executed, 5 source), plus **+2** in `side-by-side-columns.test.ts` (22 → 24)
  and **+2** in `use-draft-mode.test.ts` (69 → 71). **The arithmetic
  reconciles** (R221): 33 + 2 + 2 = **37** = 1032 − 995. **Five probes, each
  shown red and reverted:** fanning out to *every* column, the design package's
  own rule → **3 red**; `notify: false` gating the rollback as well as the toast
  → **4 red**, including the executed five-cache test showing the refused column
  keeping a mark the server had refused — D12's lie, reproduced; an unloaded
  column answering `'out'` → **1 red**; `Promise.all` for `allSettled` →
  **7 red**; and `TOAST_LIMIT` raised to 3 → **1 red**, which is what keeps a
  *cited constant* from quietly ceasing to be true under three documents that
  reason from it. `git diff` clean after each, gate back to **1032**.

  **One pin was corrected before it was trusted, and it was the control.** The
  comment-stripper control initially asserted `not.toContain('the comparison set
  *is* the draft')` against a header that says *"**The** comparison set…"* —
  case-sensitive, so it would have passed with the stripper doing nothing, which
  is the exact "green for the wrong reason" LV.12's review found twice. It now
  asserts **both** halves (raw contains, stripped does not) over three phrases,
  and caught a fourth (`no new route`) that was only failing because the header
  line-wraps.

- **LV.15 (2026-08-12) — the pop-out store and the app-shell host: the one file
  in Round 2 that mounts on every route.** **UI/UX only — no migration, no
  schema change, no new API route**; the budget stays closed at three. The
  window reads its list through the shipped `useList` and holds no other data.

  1. **The store is the precedent's, not a second convention (D13/D11).**
     `player-windows-store.ts` already settled this shape, so
     `list-windows-store.ts` copies it line for line where it can — `windows[]`
     ordered back-to-front, one entry per id, `open()` refocusing rather than
     duplicating, `closeAll`, and `partialize` persisting the remembered map
     only — and adds exactly what D13 says Round 2 adds: `w`, `h`, `min`. Four
     of those shapes are pinned **as strings present in both files**, so a
     divergence has to be deliberate.

  2. **The handoff's `z` is the array index, and that is the whole z-mechanism.**
     The design LAW's entry is `popouts[{id,x,y,w,h,z,min}]` and the prototype
     sorts by a `Date.now()` stamp; D13 asks instead for *"an array ordered
     back-to-front as the z-stack"*. Storing both would be two sources of truth
     for stacking, and the one that is not the render order is the one that
     silently wins — so there is **no `z` field** (pinned negatively, with the
     store header's own prose about `Date.now()` proving the comment stripper is
     doing its job). The store file's header carries a field-by-field table so
     the mapping is not something the next reader has to reconstruct.

  3. **Two windowing systems now coexist, and the order between them is chosen.**
     Pop-outs are **one** z layer at **45**: above every piece of page chrome
     (rail strip and bottom tabs at 40, app header at 20), below Radix at 50 —
     so LV.16's `dots` menu opens above its own window and a modal covers it —
     and below the player mini cards at 60, so a card opened **from** a pop-out
     row lands in front of the window that spawned it. One number for the layer
     rather than `45 + i`, because a sixth window would otherwise be at 50,
     inside the dialog layer; depth *within* the layer is DOM order, which is
     why nothing here portals (a portal appends on mount and does not re-order
     on a `focus()`, which is exactly why `window-shell.tsx` portals **and**
     numbers). Measured: pop-out `z:45` and mini card `z:60` overlapping at
     `(526,288)` → `elementFromPoint` returns the **mini card**.

  4. **The ×0.8 conversion, and the two numbers that are deliberately not
     converted.** The prototype shell renders at `zoom: 0.8`
     (`README` §Fidelity; `ListsCommon.jsx`'s own `const ZOOM = 0.8`), so its
     numbers are 1× coordinates and this app paints the scaled result, as
     `window-shell.tsx` already does for the mini card.

     | Handoff (1×) | Here | |
     | --- | --- | --- |
     | header 44px | **36px** (`h-9`) | the same 44 → 36 Round 1 converted |
     | name 12.5/600 | **10px**/600 | type scale |
     | header cover 24px | **19px** | 24 × 0.8 |
     | default 440 × 520 | **352 × 416** | window geometry |
     | clamp 330–1200 × 220–900 | **264–960 × 176–720** | the clamps bound content that converted too: a 960px window shows what the design's 1200px one showed |
     | cascade 120 + n·46, 120 + n·34 | **96 + n·37, 96 + n·27** | placement is geometry |
     | outer stroke 1.25px | **1px** (`border`) | the LAW's own rule — *"in a normal 1× app, use 1px wherever this document says 1.25px"*, and 1.25 × 0.8 is 1 device pixel either way. This app's `.border` utility is `0.5px` CSS = **1 device px at dpr 2**, which is the same hairline every `border-ink` surface in the shell already paints |
     | **resize grip 16px** | **16px — unconverted** | a **hit target**, not a rhythm or type measure. 12.8px is below anything this app asks a user to grab; LV.13 kept the design's 14px checkbox at 1:1 on the same reasoning. Pinned, including `not.toContain('h-[13px]')` |
     | **pointer deltas** (`clientX / ZOOM`) | **1:1, no division** | a pointer coordinate is a physical viewport pixel and this app has no zoom to undo. Pinned as `not.toContain('0.8')` on the stripped source |

  5. **Elevation: the one floating surface in the app with no shadow at any
     state.** CLAUDE.md would allow a true overlay a resting shadow, and the
     handoff overrides that on its own terms — *"a black offset shadow can't
     read on a black window, so the stroke carries the lift."* So the resting
     state is a 1px `n-3` stroke shifting to `brand` on hover (measured:
     `rgb(95,100,109)` → `rgb(180,255,137)`, `box-shadow: none` throughout), and
     `ui/elevation-rule.test.ts` is **not touched** — it guards
     `src/components/ui/**` and a pop-out is not a `ui/` primitive (plan §6).
     The reason is written where a reader will hit it: the window file's header,
     and a `no shadow at any state` pin over both files.

  6. **`gear` and `dots` are absent rather than inert, and the body is a marked
     scaffold.** The LAW lists both in this header, and both need what LV.16
     brings — the gear opens the Stats modal that task must render *outside* the
     inversion wrapper, and the grouping menu regroups rows that do not exist
     yet. A button that does nothing is the live-but-false affordance **R220**
     found in the picker's sub-line one task earlier, so they wait.
     `ListWindowBodyPending` is marked the way LV.12's `ComparisonPending` was —
     *"LV.16 deletes this function outright"* — and reports the row count it can
     see rather than rendering an empty box that would look identical for a
     broken list (F-LV15.1/F-LV15.2 carry both hand-offs).

  **Verification environment, stated rather than implied (R207).** Local stack
  only: `.claude/launch.json` config **`dev-local`** on port 3123; the browser's
  network log shows `GET http://127.0.0.1:54321/auth/v1/user → 200` and the
  `dev@fieldscout.local` profile `11111111-…`. **Nothing hosted was read or
  written, and this task wrote nothing to any database** — pop-outs are client
  state; the only persistence it touched is `localStorage`.

  **The verification harness, disclosed in full.** Nothing opens a pop-out until
  **LV.17** wires `pop out` into the detail hero and the column menu, so the
  browser run drove the store through a **temporary two-line harness** inside
  `ListWindowsHost`, placed *before* the empty-guard on purpose:

  ```tsx
  if (typeof window !== 'undefined') {
    ;(window as unknown as Record<string, unknown>).__listWindows = useListWindowsStore
  }
  ```

  It was **reverted before the commit** (`git diff` on that file empty; the
  string `__listWindows` appears nowhere in the tree). Its placement is why the
  render-nothing evidence is not vacuous: `window.__listWindows` was reachable
  from the console **on Home and on Players with no window open**, which proves
  the host was mounted and rendering nothing, rather than absent.

  | Observation | Evidence (local, 1280×900 unless noted) |
  | --- | --- |
  | **Renders nothing at all** | `/app` and `/app/players`, no window open: `[data-list-window]` **0**, `[role=dialog]` **0**, and the shell's own children still exactly `DIV, DIV, NAV` — the host contributed no node. Host confirmed mounted at the same moment (harness reachable) |
  | **Where a window opens** | first at `96,96`, second at `133,123` — the converted cascade — both `352 × 416`, `position: fixed`, `z-index: 45`, `background rgb(22,22,22)` (`--n-2`), `border rgb(95,100,109)` (`n-3`), `box-shadow: none`, header **36px** |
  | **Drag anywhere on the header** | dragged the front window `(133,123) → (432,322)`; the store and `localStorage` both recorded `{x:432,y:322}` **on release** |
  | **Resize, both clamp ends** | grip dragged to the viewport corner → **960 × 720** rendered and stored (the pointer asked for ~1270 × 890); dragged back to `(20,20)` → **264 × 176**. Both are the design's bounds at ×0.8, hit exactly |
  | **Collapse** | header only — `352 × 37` (36px + two hairlines), grip gone, body gone, control flips to `Expand`, `min: true` persisted |
  | **Close** | node gone, stack `0`, and the geometry for both lists still in storage |
  | **Back-to-front z-order** | with two windows overlapping and **both at `z-index: 45`**, clicking the buried one reordered the store array *and* the DOM siblings; `elementFromPoint(150,120)` then returned the newly-focused window |
  | **Survives navigation** | Players → Lists → Home by sidebar link, `performance.getEntriesByType('navigation').length` still **1** (no reload): both windows present throughout, geometry and collapsed state intact |
  | **A reload is a clean page (D13)** | full reload of `/app`: **0** windows, host still mounted, and `fieldscout.list-windows` still holding `{x,y,w,h}` for one list and `{min:true,x,y}` for the other. Re-opening both restored them to `571,581 264×176` and `549,183` collapsed — to the pixel |
  | **What is persisted** | the payload after all of the above is `{"state":{"geometry":{…}}}` — **no `windows` key**, with two windows open at the time |
  | **Coexistence with the player mini card** | pop-out `z:45` at `(300,200,264,176)`, mini card `z:60` at `(488,72,304,323)`, overlapping → the **mini card** paints on top |
  | **Hover** | stroke `rgb(95,100,109)` → `rgb(180,255,137)` (`--brand`); `box-shadow` stays `none` |
  | **375 × 812 phone** (the minimum, see below) | fresh window fully on screen at `15,96` with the close button *and* the grip reachable; `document.scrollWidth === clientWidth` (a `fixed` window creates no page scroll); a position remembered at `x:1100` rescued to `275` — 100px still grabbable |

  **The one concession to small screens, and exactly what it is.** LV.17 owns
  the mobile answer and this task built no phone variant. But at the design's
  `120,120` origin a 352px window on a 375px viewport opens at `96–448` with its
  **own close button off-screen**, reachable only by discovering that the header
  drags — broken, not merely unpolished. So `resolveWindowGeometry` now fits a
  **cascaded** window to the viewport when it can (`x` clamped into
  `[8, width − w − 8]`), which is what `window-shell.tsx` already does for the
  mini card (`startX = max(16, (innerWidth − 304) / 2)`). Desktop is unchanged —
  `96` on 1280 is untouched, pinned — and **a position the user dragged is never
  re-fitted**, only rescued far enough to stay grabbable. Everything else about
  small screens is flagged in **F-LV15.3**.

  Pinned by `src/stores/list-windows-store.test.ts` (**24, all executed** — the
  z-stack, the refocus rule, the clamps at both ends and at the boundary, the
  cascade and its wrap, the viewport rescue, the cascade fit, and what
  `partialize` writes, driven through the **real** middleware) and
  `src/components/lists/v2/list-windows-host.test.ts` (**17 source pins**).
  1032 → **1073**, and 24 + 17 = **41** = 1073 − 1032. *(Both numbers are what
  LV.15 landed with and are left as the record of that. The first review round
  took the source pins to **19** and the suite to **1075**, and the second
  (R231) to **21** and **1077** — see §6.)*

  *Getting the persistence test to be about anything took two corrections, both
  worth recording:* `persist` reads **`window.localStorage`** at store creation
  and, finding none under vitest's node environment, **degrades to a plain store
  with no `.persist` API at all** — so the first version of that suite was
  testing an unpersisted store and calling it proof (`useListWindowsStore.persist`
  was `undefined`). Stubbing the bare `localStorage` global is *not* enough,
  which is the same hole R179 found in `list-display-store.test.ts`; the stub has
  to be hoisted above the import **and** hung off `window`. And the rehydration
  test had to seed storage *after* its `setState`, because every state change
  writes through the middleware and would otherwise overwrite the seed before
  rehydration read it.

  **Nine probes, each shown red and reverted** (`git diff` empty afterwards,
  suite back to 1073) — *"Seven" until **R229**'s sibling **R228**; the table
  below has always had nine rows, and the Reviewer reproduced all nine at the
  stated red-counts:*

  | Probe | Result |
  | --- | --- |
  | delete the host's `if (windows.length === 0) return null` | **2 red** — *after* the pin was widened. The first run was **1 red**, because the second assertion took `indexOf(...) === -1` and sliced the whole function body, passing for the wrong reason. That is the "green for the wrong reason" family this build has now hit four times, so the pin now asserts the guard exists before it uses its position |
  | move the guard *after* the JSX return (present but unreachable) | **1 red** — the ordering assertion, which is the one a diff would not catch |
  | replace the returned fragment with a wrapper `<div>` | **1 red** — a layout box on every route in the app |
  | `partialize` persisting `windows` as well as geometry (D13 broken) | **3 red**, across both files |
  | `WINDOW_MAX_W` left at the design's un-converted `1200` | **2 red** — again after widening: the first run was **1 red**, because every other clamp assertion is written in terms of the constants and drifts with them. A literal `expect(clampWindowSize({w:5000,h:5000})).toEqual({w:960,h:720})` now fails too |
  | `shadow-hard-6` added to the window (the handoff forbids it) | **1 red** |
  | the grip "converted" to `h-[13px]` | **1 red** |
  | the host un-mounted from `app-shell.tsx` | **1 red** |
  | `zIndex={LIST_WINDOW_Z + index}` (a sixth window into the dialog layer) | **1 red** |

  **A note for LV.16 / LV.17 on the technique above.** The correction R223's
  entry carries — that a bubbling `visibilitychange` alone does **not** release a
  React Query retry in an automation tab — was reproduced again here: the
  Players table sat at `0 players` through a plain dispatch. The working form is
  the one recorded above it (redefine `document.visibilityState` first, then
  dispatch). This task did not need the data, so it moved to a surface that had
  it rather than fighting the harness.

- **LV.16 (2026-08-12) — the window's content, and the inversion the app's token
  layer could not do the way the LAW describes.**

  1. **The mechanism first, because it is the whole task.** The design LAW:
     *"Implement by scoping the color custom properties on an inner wrapper so
     children invert without restyling — and keep the Stats modal it opens
     outside that wrapper."* The prototype does exactly that, and even names the
     class: `<div className="fs-dark" style={{"--surface-card":"var(--n-2)",
     "--n-1":"var(--white)","--n-3":"#b3b9c0", …}}>`
     (`ListsCommon.jsx`:580). **That instruction does not survive contact with
     this codebase as written**: the prototype's design system is built on CSS
     custom properties, and this app's Field Scout palette is **literal hex in
     `tailwind.config.ts`** (that file's own header says so), so `text-n-3`
     compiles to `color: #5f646d` and there is no property to re-declare.

     Three ways out were weighed, and the choice is the smallest one that keeps
     the LAW's *property* — children inverting with no per-child restyling:

     | Option | Why not / why |
     | --- | --- |
     | Re-tokenize the palette to `rgb(var(--x) / <alpha-value>)` app-wide | It is the "purest" answer and it is **post-launch work** (memory: *"re-tokenizing is post-launch"*). It changes how ~470 `text-n-3` sites compile, and the plain `var()` form silently **drops the alpha** on the 14 places that write `bg-n-4/60`-style modifiers — a whole-app visual change inside a UI task |
     | Write white classes onto the window's children | Identical screenshot, and it is the LV.7 failure: a fork of the row parts by the second task. The LAW rules it out in the same sentence |
     | **Chosen:** the values as custom properties on `.fs-dark`, plus a short, enumerated redirect for the palette utilities that actually appear inside a pop-out | ~10 lines of plain CSS at the end of `globals.css`, scoped to a class used by **exactly one component** (pinned), zero effect on any other surface, and every child inverts untouched |

     **`text-ink` is deliberately *not* in that list**, and that is the
     interesting half. In this app it overwhelmingly means "ink text **on a light
     fill**" — the injury chip on `bg-caution`, the check glyph on `bg-positive`,
     tier bands 3–4 — so the LAW's `--n-1 → white` applied to it would paint
     white-on-pastel inside the window it exists to make legible. Primary text
     goes white by **inheritance** from the wrapper's own `color`, which is what
     the prototype's `color: var(--white)` does too.

  2. **The Stats picker is outside the wrapper, in the source and in the DOM.**
     It is a sibling of `.fs-dark` in the JSX (the prototype's `StatsModal` at
     `ListsCommon.jsx`:675 is the same sibling) *and* Radix portals it to
     `document.body`. Measured with both windows on screen: panel background
     `rgb(255,255,255)`, its `text-n-3` caption `rgb(95,100,109)` — the **light**
     value — `insideDark: false`, while the window behind it stays
     `rgb(22,22,22)`. It is the toolbar's own catalog (`StatsCatalog`, exported
     at this task), not a second picker: one list of stats, one `toggleCol`.

  3. **The numbers, converted ×0.8 — LV.15's kept, not re-derived.** Header 36,
     name 10, cover 19 and the geometry clamps are LV.15's and unchanged. New
     here: row **36 → 29** (the same conversion as LV.13's 38 → 30), name
     **13/400 → 10.5px Regular** (*"heavier reads as a heading on ink"*), `#N`
     11/500 → 9px in LV.13's 21px column, stat cell 60 → **48px** at 11.5 → 9px,
     column caption 9.5 → **8px** (never 600+ at that size), band header 21px,
     footer Share 30 → **24px** at 12 → 9.5px, and the row's min-width
     `190 + cols × 68` → **`152 + stats × 54`**. The **14px checkbox stays 14px**
     — LV.13's ruling for the same control.

  4. **"Widening reveals more stat columns" is the prototype's mechanism, not a
     breakpoint.** The rows carry the min-width above and the body scrolls;
     nothing recomputes *which* stats exist at *which* width, so a stat cannot
     disappear at a size nobody tested. Measured with five stats chosen: at
     `352px` the scroller was `scrollWidth 422 / clientWidth 351` and only
     `Proj · 2025 · ADP` were fully visible; the grip dragged to **509px** and
     all five — `Proj · 2025 · ADP · Bye · SOS` — were, with
     `scrollWidth === clientWidth`.

  5. **What a drop writes is now shared.** `list-detail-panel.tsx`'s `handleDrop`
     moved verbatim to **`use-list-drop.ts`** and both surfaces call it. Two
     rules were about to exist in two copies: *a refused drop says so* (the
     cost/budget bands are computed, so a drag there would otherwise no-op) and
     *the two writes are sequenced, not raced* (they patch the same cache in
     `onMutate`). That is LV.13's move — `bucketHeading` / `rankMap` into
     `list-buckets.ts` — applied to the one part of the drag that was still
     living in one screen's component.

  6. **The footer's Share, and the one literal the LAW sanctions.**
     `text-[#000]` on `bg-brand`, measured `rgb(0,0,0)` on `rgb(180,255,137)`:
     the LAW asks for the literal precisely because a token-based ink would go
     white inside the wrapper. The link is the **same** one the hero and the
     gallery card copy — `/u/{owner}/lists/{slug}` — with the owner resolved from
     the React Query collection cache (`lists-page-v2.tsx`'s rule) rather than by
     mounting a collection query on every route a pop-out survives to. Both
     branches measured: an owned list copied
     `…/u/dev_user/lists/consensus-wr-top-10`, and the **saved** list copied
     `…/u/devpro/lists/lv12-local-fixture-dev-pro-wr-room` — the owner's handle,
     not the viewer's. When neither source yields a username it **says so**
     instead of copying a link that 404s; the username is load-bearing (the
     public page looks the list up by `owner_id` *and* `slug`).

  7. **Views and comments are read-outs, not buttons.** A pop-out has no comments
     panel to open, and a control that does nothing is **R220**'s live-but-false
     affordance. An unknown comment count renders `—`, never `0`.

  **Verification environment, stated rather than implied (R207).** Local stack
  only: `.claude/launch.json` config **`dev-local`** on port 3123, signed in as
  `dev@fieldscout.local`, `GET /api/lists` answering from `127.0.0.1:54321`.
  **Nothing hosted was read or written.** This task *did* write to the local DB
  — one drafted mark and one reorder, both deliberate and both **restored**: the
  mark was unticked (`/drafted` → `[]`) and the order put back through the
  shipped reorder route (`Adonai Mitchell` back at 3). **Both documented local
  fixtures are untouched** — LV.12's saved `dev-pro` list and LV.13's `r1`–`r4`
  round board.

  **The verification harness, disclosed in full.** Nothing opens a pop-out until
  **LV.17**, so the run used the same temporary two-line harness LV.15 disclosed,
  this time on the store itself:

  ```ts
  if (typeof window !== 'undefined') {
    ;(window as unknown as Record<string, unknown>).__listWindows = useListWindowsStore
  }
  ```

  **Reverted before the commit** — `grep -rn "__listWindows" src/` returns
  nothing.

  | Observation | Evidence (local, 1280×900) |
  | --- | --- |
  | **The inversion inverts, and the A/B is the proof it is scoped** | inside the window: wrapper `color rgb(255,255,255)`, `#N` (`text-n-3`) **`rgb(179,185,192)`** = `#b3b9c0`, row rule (`border-n-4`) **`rgba(255,255,255,0.22)`**, checkbox fill (`bg-white`) `rgb(22,22,22)`. The **same `text-n-3` class** on the page behind it: `rgb(95,100,109)`. Exactly **one** `.fs-dark` in the tree |
  | **No child was restyled** | the checkbox's only per-instance class is the LAW's stroke, and it measured `rgba(255,255,255,0.75)` at 14 × 14; drafted it fills `rgb(152,233,171)` (`bg-positive`) unchanged |
  | **Rows** | `29px` tall, name `10.5px / weight 400 / white`, hover **`rgba(255,255,255,0.09)`** measured on the hovered row, drafted row `opacity 0.45` over `rgba(255,255,255,0.05)` with the name struck through |
  | **Stats modal light, window dark** | picker `rgb(255,255,255)` with `text-n-3` at `rgb(95,100,109)`, `insideDark:false`, `parentIsBody:BODY`; window `rgb(22,22,22)` at the same moment |
  | **Share** | `background rgb(180,255,137)`, `color rgb(0,0,0)`, `h 24`, `9.5px`, `box-shadow: none` |
  | **`dots` regroups this list** | menu = the five `ORG_OPTIONS`, light and above the window; selecting **Rounds** re-banded the rows to `Round 1 (1) · Ungrouped (9)` while the panel behind it kept its own grouping |
  | **Drag-reorder, and it persists** | dragged `Adonai Mitchell` down inside Tier A; a fresh `GET /api/lists/{id}` (no cache) then returned `AJ Henning` at position **3** and `Adonai Mitchell` at **4** |
  | **One tick, one list (D12 stops at the comparison set)** | ticked `A.J. Brown` in the pop-out → `Consensus WR top 10` drafted `["5859"]`; `Secret sleepers`, which **also holds him**, `[]`; the round board `[]`. Unticking cleared it |
  | **The owner gate** | the saved `dev-pro` window renders 6 rows and **no draggable row at all** (`canDrag: false`), because `is_owner` is false |
  | **Widening** | 352px → 3 of 5 stat columns visible; grip-dragged to 509px → all 5, `scrollWidth === clientWidth`, and `{w:509,h:460}` persisted |
  | **Survives navigation with its content** | Lists → Home by sidebar link: both windows still `rgb(22,22,22)`, 10 and 6 rows, one wrapper each |
  | **Escape still behaves (R227/R231) with the new menu in the header** | `dots` open, one Escape → a `keydown` trace at `window` showing `{key:'Escape', isTrusted:true, defaultPrevented:true}` and the menu dismissed with **`windows` still 1**; later, focus on the page, one Escape → the **top** window closed and the other stayed |

  Pinned by **+23** source pins in `list-windows-host.test.ts` (21 → 43, plus one
  widened locator and two rewritten) and **+1** in `drafted-fan-out.test.ts`
  (33 → 34). 1077 → **1101**, and 23 + 1 = **24** = 1101 − 1077.

  **R226's prediction came true in a spelling its own guard could not see, and
  that is this round's transferable finding.** R226 widened
  `classNameContaining` and wrote, in as many words, that `cursor-grab` was *"one
  edit away from being ambiguous, because **LV.16** brings drag-reorder rows into
  this very file"*. LV.16 duly added a second `cursor-grab` — and **the throw
  never fired**, because the locator matched only `className="…"` attributes,
  while a row's conditional class is a single-quoted string inside `cn(…)`. It
  went on confidently returning the header. Same shape as the four findings
  before it: *a guard that reads one spelling of the thing it forbids.* The scan
  now covers both forms, markers are regex-escaped (`text-[10.5px]` was a
  character class waiting to happen), and the header's marker moved to
  `active:cursor-grabbing` — the drag *handle*, not a draggable row.

  **Ten probes, each shown red and reverted** (`git diff HEAD` empty afterwards,
  suites back to 1101):

  | Probe | Result |
  | --- | --- |
  | delete the `.fs-dark .text-n-3` redirect | **1 red** |
  | invert `text-ink` as well (white-on-pastel) | **1 red** — the pin that guards a deliberate *omission* |
  | move the Stats picker inside the dark wrapper | **1 red** — `expected 8 to be 6`, the indentation-as-depth pin |
  | Share takes its ink from `text-brand-foreground` instead of the literal | **1 red** |
  | the row name goes `font-semibold` | **1 red**, by the locator **throwing** — *"no class string containing `font-normal`"* |
  | the header's marker put back to `cursor-grab` | **1 red**, by the locator **throwing** — *"`cursor-grab` appears in 2 class strings"*. This is R226's own probe, finally firing |
  | the window imports `drafted-fan-out` | **1 red** in the fan-out suite — D12's boundary |
  | the panel keeps its own copy of the drop commit | **1 red** |
  | `rowMinWidth` goes fixed (widening stops revealing columns) | **1 red** |
  | a second `fs-dark` wrapper | **1 red**. *The first attempt at this probe put `fs-dark` in a `data-` attribute and the suite stayed **green** — correctly, since that is not a class. Recorded because a probe that fails to reproduce is a probe that proves nothing, and re-running it as real JSX is what made it evidence* |

  **A note for LV.17 on the harness.** Two artefacts cost time here. (1) The
  **first** `getComputedStyle` / DOM read after a state change returns the
  *previous* value through this bridge — hover washes, drafted opacity and a
  dismissed menu all read stale once and correct on an immediate re-read; read
  twice before believing a measurement. (2) **Radix menu items do not respond to
  the harness's synthetic click** (they select on `pointerup`): `computer` clicks
  worked on every plain `<button>` — including the `gear` and the stat rows in
  its popover — and did nothing on the five `dots` items until the pointer
  sequence was dispatched by hand. Neither is a product behaviour; both are the
  "no-op that is the harness, not the code" CLAUDE.md's rule reads in reverse.

- **LV.16 fix round (2026-08-12) — the second consumer is what makes a shared
  module's hidden assumption visible, and there is no test for "you are now the
  second".**

  1. **The drag surface is now an object, not an assumption (R235/R236).**
     `use-list-drag.tsx` resolved its target with `document.elementFromPoint`
     and measured the dragged row with `document.querySelector`. Neither was
     wrong: with one consumer, `document` *is* the surface. LV.16 made the
     pop-out the second consumer — one that is `position: fixed` at `z-45` and
     therefore **overlaps the first by design** — and both surfaces write
     `data-drop-row="all:0"…` and the same `data-drag-id`s into one namespace.

     Two fixes were available and only one of them is structural:

     | Option | Why not / why |
     | --- | --- |
     | Namespace the `data-drop-*` attributes per surface | Works, and it spreads the surface's identity across four attributes and every component that writes them — `list-body.tsx`, `list-row-parts.tsx`, `list-window.tsx`. The next surface has to remember |
     | Pass a container ref into `useListDrag` | Correct, but the ref is a thing a caller can forget, and forgetting it silently restores the defect on that surface only |
     | **Chosen:** the hook owns the ref and `ListDragContext` renders the element it points at | The context component already wrapped every drop target in both consumers; it takes the class string over via `className` and renders **the same one `<div>`**, so the DOM is unchanged and there is nothing left for a caller to attach. The identity of the surface lives with the hook that needs it |

     **A release over another surface is refused, not redirected.** There is no
     defensible meaning for "this list's player into that list's slot", and
     inventing one is how the original defect reads in a diff. The gate is
     `root.contains(at)` *before* the `closest()` chain — `closest` walks
     **upwards**, so a point outside the root can never resolve to an element
     inside it, which is why one check covers all four branches. The **order** is
     what the pin asserts: a containment check placed after the chain would look
     like a fix and change nothing.

  2. **A hand-maintained list of styling exceptions goes stale between tasks
     (R238).** The `.fs-dark` redirects were correct on the day and already had a
     hole: `bg-n-4` — the empty cover quadrant, reached through `ListCoverTile`
     in the window's own header — measured **1.61:1** inside the wrapper. The fix
     is one CSS line; **the finding is that nothing would have said so**, and
     LV.17 owns "empty / error inside a window". The audit walks **components**,
     not files, because a file scan pulls in `PlayerMeta`'s injury chip and
     `NoteMark`'s tooltip — things a pop-out never renders — and every hollow
     allowlist entry teaches the next reader that the allowlist is decoration.
     Its locator throws on **ambiguous** as well as missing (R240's standard),
     and its two exclusions (`ui/icon.tsx`, `ui/button.tsx`) are *checked* rather
     than argued.

  3. **A cache's `gcTime` is part of a feature's contract when the feature
     outlives the page (R237).** The window reads the list's owner from the React
     Query collections cache — the right call, since mounting a collection query
     on every route a pop-out survives to would be worse. What was missing is
     that `query-provider.tsx` sets only `staleTime`, so that cache is gone
     **five minutes** after the user leaves `/app/lists` (measured: `gcTime`
     `300000`), and the fallback then answered a question it could not answer.
     The list already carries `is_owner`; the fallback asks it.

  **Verification environment.** Local stack only (`dev-local`, port 3123),
  `dev@fieldscout.local`. The local DB was written during the R235 reproduction
  and **restored exactly** — `list_players` for `…ab01` and `…ab99` diff clean
  against the pre-run snapshot, and both documented fixtures are intact. Two
  temporary harnesses (`__listWindows`, and a `__qc` handle on the query client
  for R237's eviction) were disclosed and reverted; `grep -rn "__listWindows\|__qc"
  src/` returns nothing.

- **LV.17 (2026-08-12) — wiring, the four states, the 6+ answer and the phone
  answer. Round 2's last task, and the one that makes pop-outs reachable.**

  **1. Two entry points, one `open`.** The hero's `pop out` (`list-detail-hero.tsx`)
  had shipped since LV.15 **disabled behind a tooltip** saying pop-outs were a
  later task — the one live-but-false affordance this build allowed itself,
  because the tooltip said so. It now calls `onPopOut`, wired by the panel to
  `list-windows-store`'s `open`. The second is `Pop out into a window` in a Side
  by side column's `dots` menu, under the same separator as `Remove column`.
  Both go through one store, which is what stops two windows appearing for one
  list; the pin asserts the whole set of files that read it, so a third
  mechanism shows up as a diff.

  **The column is deliberately NOT removed when you pop it out.** The
  comparison set is what a tick fans out over (**D12**), so shrinking it here
  would quietly change what the next tick writes. Measured: popping out from a
  column left all three columns in place.

  **2. The four states inside a window, and the branch order that is not
  optional.** `error → !entries → empty → rows`, which is
  `side-by-side-columns.tsx`'s order (LV.13) and is also the order the data
  forces: an errored read still carries the **last good `data`**, so testing
  `entries` first paints stale rows over a failure, and a read in flight has no
  `entries` at all, so testing `length === 0` first paints *"No players on this
  list yet"* over a request. Two of the three are now literally shared —
  `ListReadFailure` and `ListRowsSkeleton` moved into `list-row-parts.tsx`
  beside `EmptyListState` and are rendered by **both** the column and the
  window, at the column's scale, which already survives a 240px panel (narrower
  than the window's 264px minimum), so neither surface needs a variant.

  **3. A pop-out of a list you then delete: ~~it stays, and says so~~.**
  > **⛔ OVERRULED — Chris, 2026-08-12 (§3 Q5): *"Close it, with a toast."***
  > The paragraph below is left as the record of what was built and why, because
  > the *reasoning* is what the ruling engages with. What ships is in the
  > fix-round entry below: the window **closes**, and the toast reads **"This
  > list is no longer available."**

  The prototype splices the window away (`design/lists.js`:253) and this
  deliberately diverged. That is an in-memory demo with one actor, no soft
  delete and no Trash; here the host is app-wide, so the delete may not be the
  viewer's action and a window that vanishes with no word while you are on
  `/app/players` is CLAUDE.md's *"nothing happened"* with the evidence removed.
  The LAW's own persistence bullet was read as the other half — pop-outs *"stay
  until closed"*. So `ListReadFailure` split **deleted** from **failed** on the
  error's own status, the copy branched on ownership because Trash only lists
  your own, and the **footer was not rendered at all** over a gone list: Share
  would copy `/u/{owner}/lists/{slug}`, now a 404 page, and announce *"Link
  copied"* (**R220**'s shape — that half survives the reversal, for the one frame
  before the window goes). Measured live: deleted `LV17 tmp B` with its pop-out
  open → the window kept its name and its close button, showed *"This list was
  deleted. / Deleted lists go to Trash, where you can restore it."*, **0** rows
  and **no Share**. ***That sentence was also false for a second reason the
  ruling then fixed anyway — see R248.***

  **⚠️ Reaching that state changed a shared hook — and ~~it was not reachable at
  all~~ is FALSE (corrected by R249, 2026-08-12).** With the app-wide
  `retry: 1`, TanStack Query keeps the **last good data** while a retry is
  outstanding and reports the failure only through `failureReason` — so the
  window went on painting the vanished list's rows **until the retry was
  exhausted**. That is a **delay, not a dead end**. Reproduced against this
  repo's own `@tanstack/react-query`: one successful read, then every read 404s
  → `retry: 1` reaches `status: 'error'` after **3** `queryFn` calls, no-retry
  after **2**, `data` retained either way. The `fetchStatus: 'paused'` recorded
  above is React Query's **offline** pause (`networkMode: 'online'`), which a
  resolved HTTP 404 does not trigger; it was written down as the finding instead
  of being diagnosed. **The true and sufficient claim: a 404 surfaced one retry
  late, and a shared hook was changed to make it immediate.** `useList` carries
  `use-draft-mode.ts`:518's rule in intent — *a 404 is an answer, not a hiccup* —
  **narrowed at R252 from `status < 500` to `status === 404`**, because this same
  route answers 401/403/400 on `PATCH`/`DELETE` and 408/429 are canonically
  retryable. This is a **shared** hook (panel, columns, window); it is strictly
  more correct for all three. Recorded here because it is the one change in this
  task that reaches outside the diff's obvious surface.

  **4. Six windows, seven, twelve — no cap.** Q4's ruling (Chris, 2026-08-11:
  no cap, no search, no truncation on the picker) applied to the surface one
  screen away, and what the LAW asks for in its opening line: *"Open several and
  set them side by side."* What the **sixth** changes is only placement, and the
  store already answers it: the cascade wraps after six, so a seventh opens back
  at the origin instead of marching off the corner. **Measured live with seven
  open**: 2–6 at `133,123 / 170,150 / 207,177 / 244,204 / 281,231`, the seventh
  at **`96,96`**, every one at `z-index: 45` (one layer, never `45 + i`), and one
  Escape closed exactly one — the top — leaving six. Executed in the store test
  too, so a cap added later fails there however it is spelled. No `closeAll`
  caller was added: the design package has no such affordance, and Escape already
  unwinds the stack one press at a time.

  **5. The phone answer — F-LV15.3, and this task owns it.** ~~**Small screens
  get the same window.**~~
  > **⛔ OVERRULED — Chris, 2026-08-12 (§3 Q6): a real mobile variant.** Kept as
  > the record: the decision was explicitly offered for overruling in its own
  > last paragraph, and it was taken up. **F-LV15.3 stays discharged** — the
  > obligation was *"say what small screens get"*, and they now get an answer
  > with an author who could rule it. The three desktop properties below are
  > unchanged and still hold; they are what the ≥768px window rests on.

  No breakpoint, no variant, and the `pop out` control was not
  hidden below any width. That was a decision made here and **not** an extension
  of Chris's *"leave the phone version as is"* (D14), which was ruled about Side
  by side; it was defended on its own three properties rather than inherited:

  - **A window the store places opens whole.** LV.15 fitted the *position*;
    LV.17 fits the **size**, which is the half that was missing — the frame caps
    the *painted* box at `100vw − 16px`, so on a 320px phone the store said 352
    while the screen showed 304, and **the resize grip reads the store**: the
    first touch of the grip jumped the window 48px wider before the pointer
    moved. Fitting the size we chose keeps the model and the paint agreeing.
    Desktop is bit-identical and pinned.
  - **The grip now starts from the painted corner** (`getBoundingClientRect()`
    on the frame), which closes the same disagreement for a size the *user* set
    and carried onto a narrower viewport.
  - **Drag and resize are pointer events, so they are touch events.** Verified at
    375 × 812 with real `pointerType: 'touch'` gestures: a header drag and a grip
    drag moved the window from `[275, 462, 352, 416]` (restored desktop
    geometry, close button off-screen) to **`[10, 142, 292, 326]`** — fully on
    screen, close button hit-testable, and `{x:10,y:142,w:292,h:326}` persisted,
    so the grip path ran end to end. `touch-action: none` measured on both grab
    surfaces.

  **The guarantee is deliberately two-tier, and the weaker half is stated rather
  than glossed:** a window *we* place opens whole; a window the *user* placed is
  only **rescued**, to 100px of grabbable header — which is the drag handle, not
  the control cluster — so one carried across from a wider viewport takes **one
  drag** before its close button is reachable. Re-fitting a position the user
  chose is exactly what LV.15 refused and two reviews upheld. The honest costs:
  a 352 × 416 window covers most of a 375px screen, and it floats over the
  bottom tab bar (45 against 40) if dragged there. Both are true of the player
  mini card this window mirrors; neither is a trap.

  **Hiding `pop out` below a breakpoint was considered and NOT done**, because
  it is a product decision of the same shape Chris ruled on — and nothing is
  broken on a phone, so there is no question to force. If he wants pop-outs
  desktop-only it is a one-line change at the hero and the column menu.

  **6. One redirect added to `.fs-dark`, stated rather than slipped in.**
  `text-negative-strong` — the shared failure icon's colour, `#c0392b`, which
  measures **3.33:1** on `#161616` (legal for a non-text graphic at WCAG's 3:1,
  and visibly wrong beside everything else in the window). It is redirected to
  the palette's **own** light red, `negative` `#e99898`, at **8.11:1**. Measured
  both halves live: the same class reads `rgb(233,152,152)` inside the window and
  `rgb(192,57,43)` on the page behind it. This is the R238 audit working as
  designed — the new components were added to `INSIDE_THE_WRAPPER` and the audit
  named the utility.

  **Verification environment.** **Local stack only** — `.claude/launch.json`
  `dev-local` on port **3123**, `dev@fieldscout.local`, every request confirmed
  going to `127.0.0.1:54321`. **Nothing hosted was read or written.** Three
  temporary lists (`LV17 tmp A/B/C`) were created through the shipped
  `POST /api/lists` to get past six windows and to have something deletable, and
  **all three were removed from the local DB afterwards**; the drafted row the
  D12 test wrote was removed too. Both documented fixtures verified intact after
  cleanup — `LV12 local fixture` still favourited by `dev_user`, `LV13 local
  fixture` still `r1,r1,r2,r2,r3,r3,r4,r4` — and `list_players` order/tiers for
  `…ab01` and `…ab99` unchanged. **Two disclosed browser-side harnesses, neither
  a source change**: a `window.fetch` override to force a 403 on one list (the
  *failed* state), restored afterwards; and a stub of
  `Element.prototype.setPointerCapture` for the duration of the synthetic touch
  gestures, because a synthetic `pointerId` is not an *active* pointer and the
  real API throws `NotFoundError` — the product handlers were untouched and the
  stub was restored and re-checked. `git diff` on `src/` is the LV.17 diff and
  nothing else.

  **What that harness does and does not prove.** It proves the drag and resize
  handlers are driven by `pointerType: 'touch'` events and that the geometry
  maths and the store writes are correct under them. It does not exercise
  Chrome's own touch → pointer synthesis, which is browser behaviour; what
  protects that is `touch-action: none`, measured on both surfaces. The
  `computer` tool's drags time out under this harness's mobile emulation, which
  is why the synthetic route was needed at all.

- **LV.17 fix round (2026-08-12) — Chris's two rulings built, and four findings
  that were all about the same failure: stating more than you know.**

  **1. Ruling 1 (§3 Q5) — a pop-out of a list that is gone closes, with a
  toast.** One effect in `list-window.tsx`, guarded on the same `gone` the
  previous round computed: `close(listId)` and `toast({ title:
  LIST_UNAVAILABLE })`. **Both halves are pinned**, because either alone is the
  defect the other prevents — a silent close is "nothing happened" with the
  evidence removed, and a toast without the close leaves the stale window. The
  copy is an **exported constant** shared with the on-surface state, so "matching
  Chris's toast copy exactly" is structural rather than two files remembering.
  `TOAST_LIMIT` is 1, so N windows dying together leave one toast carrying the
  identical sentence — LV.14's reasoning for the fan-out's single report.
  Measured live on the local stack: deleting `LV17fix tmp A` from the hero while
  its pop-out floated over the page → **windows 1 → 0** and the toast
  *"This list is no longer available."*

  **2. R248 — the app stated a cause it cannot know, and it re-worded a merged
  surface doing it.** `GET /api/lists/[id]` reads
  `.eq('id', id).is('deleted_at', null)` and 404s on no row, and **three**
  situations collapse into that: a soft delete, a missing id, and **a list that
  is alive and merely no longer visible to this viewer** — the `lists` SELECT
  policy is `((is_private = false AND deleted_at IS NULL) OR auth.uid() =
  owner_id)`, and visibility is one click in the hero's options menu. LV.17
  wrote *"This list was deleted. / Its owner deleted it."* over all three.

  **Reproduced end to end, twice.** In a rolled-back transaction: as `dev@`, the
  public `LV12` fixture returned **1** row; after the owner set
  `is_private = true` the identical query returned **0** with `deleted_at` still
  `NULL`. Then live, with the pop-out open: `psql` flipped `LV12` private, the
  next list mutation invalidated `listsKeys.all`, and the window closed with the
  **neutral** toast — where the shipped copy would have named a deletion that
  never happened. DB ground truth captured at that moment:
  `LV12 … is_private = t, deleted_at NULL`. The fixture was restored (`f`) and
  re-verified.

  **What changed.** `ListReadFailure`'s gone branch is one neutral sentence, the
  same constant as the toast; the only thing left for an owner is a **condition**
  — *"If you deleted it, you can restore it from Trash."* — which asserts nothing
  about why the read failed. `listReadIsGone`'s header now carries all three
  situations, and the predicate is documented as *"gone from here"*, never as a
  cause. **And the Side by side column's sub-line is restored to LV.13's `Could
  not load`**: LV.17 had changed a merged surface to `Deleted` on the same
  inference, and re-wording a shipped surface was not a pop-out task's to do
  even where the word had been true. The column's *body* stays the shared
  component — that is LV.17's D11 win, and its copy is fixed upstream in one
  place.

  **3. Ruling 2 (§3 Q6) — the mobile variant.** Below **768px**
  (`WINDOW_MOBILE_MAX_W`, Tailwind's `md`, deliberately not the shell's `lg`):
  the window is a bottom sheet at **100% width × 60% height**, and the header is
  **`Options` + `Close`** with the `gear`, the `dots` menu and `Collapse` folded
  into that menu. **There is exactly one breakpoint in `list-window.tsx` and it
  is a number in the store** — `isSmallViewport`, executed by a node test
  (R191's rule), read through a `useSyncExternalStore` + `matchMedia`
  subscription so it survives a rotation, with the media query built from the
  same constant so the CSS boundary and the predicate cannot drift by a pixel.
  The file carries **no** `sm:`/`md:`/`lg:` variant at all, which is pinned.

  Measured at **375 × 812**: width **375 = 100.00%**, height **487.2 = 60.00%**,
  **bottom gap 0**, inline style **`z-index: 45` and nothing else**, **no grip**,
  header buttons **`["Options", "Close"]`**, header `cursor: auto` /
  `touch-action: auto`, `box-shadow: none`, `z-index 45`. The Options menu, in
  order: **Choose stats · ─── · Ranked / Tiers / Rounds / Avg cost / Budget % ·
  ─── · Expand**.

  `dvh` rather than `vh` for the 60%: on a phone *"the screen height"* is the
  **visible** viewport, and `vh` is the URL-bar-collapsed one, which would put
  roughly a tenth of the sheet under browser chrome.

  **4. The three things Chris did not state — DERIVED, NOT RULED.** Each is
  minimal and each is cheap to overrule:

  - **Bottom-anchored.** A full-width, fixed-height window has nowhere
    meaningful to drag to, so it must be anchored; the bottom is the mobile
    convention (sheets rise from it) and the thumb-reachable end. It therefore
    covers the bottom tab bar (45 against 40) while open — deliberate, and one
    tap from gone.
  - **Drag and resize switched off, not left dead.** Both are meaningless at a
    fixed size, and a `cursor-grab` header that does nothing is R220's
    live-but-false affordance. The grip is **not rendered**, the header drops its
    grab cursor *and* its `touch-none` together, and both pointer-down handlers
    bail. Gating the **gesture start** is what makes the stronger claim true:
    `dragRef`/`sizeRef` are the only things that unlock the two store writes, so
    **no geometry is written from a phone**.
  - **Several windows pile, and no cap is invented.** Q4's precedent is that
    Chris rules caps. Every mobile window has identical geometry, so the cascade
    is a no-op and the front one is the one you see; each carries its own
    `Close`. Measured: three open, all at `[0, 325, 375, 487]`, all `z-index 45`,
    closing the top revealing the next — **3 → 2 → 1 → 0**, `Secret sleepers` →
    `LV13 local fixture` → `Consensus WR top 10`. The honest cost — a pile of
    three looks like one until you close the top — is **F-LV17.4**, not a
    switcher invented here.

  **5. Desktop is bit-identical, and it is measured, not asserted.** Every mobile
  branch is `mobile ? … : <what shipped>`. At 1280 × 900: window opens at
  `[96, 96, 352, 416]`, `z 45`, `box-shadow: none`, grip present, header buttons
  `["Choose stats", "Grouping", "Collapse", "Close"]`, header class token-for-token
  LV.16's. A real header drag moved it to **`[464, 382]`** — the predicted pixel —
  and persisted `{x: 464, y: 382}`; a real grip drag took `352 × 416` → **`472 ×
  496`**, again the predicted pixels, persisted. The grouping menu is still
  exactly five items at **136px**. The `gear` still opens the Stats picker, and
  Escape over that picker still dismisses the picker and **not** the window
  (R227/R231 intact).

  **6. R251's own case, round-tripped.** A window sized and positioned on a wide
  viewport → opened on a phone → back to the desktop. Stored geometry
  `{x: 301, y: 150, w: 472, h: 496}` before; the phone painted the bottom sheet
  and wrote **nothing**; on return the window restored to exactly
  `[301, 150, 472, 496]`. That is the whole point of switching the geometry off
  rather than re-fitting it.

  **7. R255 — the R246 pin's residual hole, closed with the hole demonstrated.**
  The old pin was *"shallower than `{children}`, and after it"*, which a host
  placed **inside `<main>` after the content wrapper** satisfies while sitting in
  the page tree. `ancestorsOf()` now walks the enclosing chain by indentation
  (resolving Prettier's multi-line opening tags to their `<tag` head) and asserts
  that **no element enclosing the page encloses the host**, with a control test
  proving the walk finds ancestors at all. **Both were shown**: with the host
  moved inside `<main>`, the new pin is **red** and the pin *as it shipped* —
  re-run verbatim in a scratch file against the same broken shell — is **green**.
  Reverted; `app-shell.tsx` is not in this diff. **The mobile variant does not
  move the host**, which is the thing R246 exists to protect.

  **8. Verification environment.** **Local stack only** — `.claude/launch.json`
  `dev-local` on port **3123**, `dev@fieldscout.local`. Nothing hosted was read
  or written. Three temporary lists (`LV17fix tmp A/B/C`) were created and **all
  three deleted from the local DB afterwards**; `LV12`'s visibility was flipped
  and restored; a Pin/Unpin round-trip on `LV13` (the only mutation available
  that invalidates the right key) left `list_favorites` at its documented single
  row. Both fixtures re-verified after cleanup: `LV12` favourited by `dev_user`,
  `is_private = f`, `deleted_at NULL`; `LV13` still `r1,r1,r2,r2,r3,r3,r4,r4`;
  `…ab01` 10 rows, `…ab99` 2 rows; `list_player_drafted` **0** rows.

  **9. The harness, and what it does not prove (R254 is unresolved and now
  matters more).** At 375 the tooling's own pointer input **times out** — the
  same failure the Reviewer hit — so the mobile interactions were driven by
  synthesised pointer/mouse sequences on the shipped controls. That proves the
  handlers, the rendered variant and the geometry; it does **not** prove Chrome's
  touch → pointer synthesis. Ruling 2 makes mobile a *designed* surface rather
  than an incidental one, so a real-device pass is now a first-class gap:
  **F-LV17.5**. Two further tooling facts are worth recording for the next
  session: the tool's `computer` coordinates are **screenshot pixels** (0.625 ×
  CSS at 1280 wide), not CSS pixels — an hour of "the drag does nothing" was
  that; and `resize_window` fires **neither** `resize` nor a `matchMedia`
  `change` event, so the rotation path could not be exercised through it. The
  variant was still shown switching live on a re-render at 375, which is
  `useSyncExternalStore` re-reading its snapshot — the subscription is the
  belt-and-braces half, not the only path.

---

## 5. Blockers

- **✅ LV.7 — LANDED 2026-08-11. The halt worked exactly as it is supposed
  to.** It stopped one commit before an irreversible deletion, produced the
  capability diff, and Chris's ruling reversed the Builder's own recommendation
  on every item: **all four survive**, and the reason given —
  *"This is why I didn't want to rebuild from scratch"* — is the standing
  correction, not a one-off. CLAUDE.md → Redesign already said it
  (*"Do not generate a replacement component library or parallel component
  tree"*); `lists/v2/**` was built as one anyway, and a parallel tree loses
  behaviour by default. **The lesson to carry: when a rebuild replaces a
  surface, the diff of *capabilities* is the deliverable, not the diff of
  files.** Nothing on the PORT list would have failed a test, a type-check or a
  screenshot review — they would simply have stopped existing.

  Both parked obligations are **discharged by deletion**: LV.10's
  `board-column.tsx` DEF-headshot fix and R192's stale `use-board-marks.ts`
  header were inside the `draft-mode/**` tree this task removed whole.
  `src/components/big-board/**` is confirmed **still off limits** and LV.9's /
  LV.11's `week-tabs.tsx` / `PublicWeekStrip` deferral stands unchanged — it was
  re-recorded here rather than quietly picked up.

- **Follow-ups LV.7 filed rather than absorbed.** Each was in scope to *notice*
  and out of scope to fix; none is a blocker and none is silently dropped.

  | id | What | Why it is not in LV.7 |
  | --- | --- | --- |
  | **F-LV7.1** | **Change image** — the design LAW's options menu leads with it, and `editable-thumbnail.tsx` (the upload/replace UI) was deleted as an orphan. The v2 cover still *renders* `thumbnail_url`, so existing images show; nothing can set or clear one | Design-package gap LV.3 never filed. The component is recoverable from this PR's parent commit |
  | **F-LV7.2** | **List type**, **Insights**, **Archive** — the other three items in the design LAW's options menu, none of which v2 has | Same gap. Each is a screen decision before it is a build |
  | **F-LV7.3** | **Likes on the tab row** — design LAW: *"Views and likes sit right-aligned on the tab row."* The panel renders views only; LV.6 put the like **count** on the public view as a number, not a control | `useToggleLike` survives via `explore-feed.tsx` (flag-gated off), so nothing is orphaned — but the app has no like control for a list |
  | **F-LV7.4** | **`use-draft-mode.ts`'s `enabled` / `setEnabled` have no consumer.** There is no draft-mode gate any more (Chris, 2026-08-10 — the drafted checkbox is permanent), so nothing reads them | Removing them touches a hook with 69 pinned tests whose guard semantics R190/R195/R199/R200 all fought over. Not a drive-by in a UI task |
  | **F-LV7.5** | **`useSetPlayerSlot` (`use-lists.ts:333`) and `/api/lists/[id]/players/[playerId]/slot` lost their only consumer** with the team `PositionBoard` (§3 Q3, deliberately dropped — `featureFlags.teams` is off and the teams page is already a placeholder) | Deleting a route is server-side and outside LV.7's UI-only scope |
  | **F-LV7.6** | **Delete-list has no confirm dialog.** The retired card and detail view both put one in front of it; v2 deletes straight off the menu item. It is a soft delete with a toast and Trash restore, so a mis-click costs a round trip rather than data | Recorded at §3 Q3 as ported-minus-the-confirmation. Adding a dialog v2 never had is a design call |
  | **F-LV7.7** | **There is still no keyboard drag.** LV.4 filed it; LV.7 inherits rather than widens it. The player *name* is now keyboard-reachable (`Enter` / `Space` opens the mini card), which is new — reordering is not | An AT/keyboard path for the gap model is its own task, as LV.4 said |

- **Follow-up LV.12 filed rather than absorbed** (review finding **R211**), same
  rule as the LV.7 seven: in scope to notice, out of scope to fix here.

  | id | What | Why it is not in LV.12 |
  | --- | --- | --- |
  | **F-LV12.1** | **`N players` is never pluralised, house-wide.** A one-player list reads *"1 players"*, and LV.12's new `aria-label` now **announces** it — a screen reader says *"Favorites, 1 players"*. Four shipped v2 surfaces carry the same literal: `list-gallery-card.tsx:173`, `list-detail-panel.tsx:196`, `lists-rail.tsx:103`, `side-by-side-picker.tsx:172`. It matches the prototype, so it is not a regression — **and the house already disagrees with itself**: `list-detail-hero.tsx:178` pluralises properly (`list.players.length === 1 ? 'player' : 'players'`), which is the shape a sweep should adopt | Fixing it in the picker alone would leave the app saying two different things about the same number, and fixing all five is a five-file string change across surfaces this task has no business opening. One sweep, its own commit — including the a11y-string case LV.12 introduced |

- **Follow-up LV.14 filed rather than absorbed**, same rule as the LV.7 seven
  and F-LV12.1: in scope to notice, out of scope to fix here.

  | id | What | Why it is not in LV.14 |
  | --- | --- | --- |
  | **F-LV14.1** | **A column's `N of M left` is honest about its ROWS and silent about its MARKS.** `side-by-side-columns.tsx`'s subline branches on `detail.isError` (the *list* read) and on `entries` being absent, which is why it says `Could not load` / `Loading…` rather than `0 of 0 left` — LV.13 built that deliberately. But if the **drafted** read fails while the rows load, `toDraftedSet` turns it into an empty Set (LV.1.3, Q1 consequence 2, by design) and the header then claims `8 of 8 left` over marks the account may well hold. On the open list that fallback is the accepted behaviour; on a column header it becomes the *headline number* LV.13 refused to claim over an unanswered request — the same argument, one query along. Reproducible by 500ing `GET /api/lists/[id]/drafted` while `GET /api/lists/[id]` succeeds | The count is **LV.13's**, and LV.14's task text says in as many words that LV.13 built it correctly and not to change it. Fixing it means giving the subline a third input (the drafted query's own state) and deciding new copy for it — a design call on a surface this task was told to leave alone. It is also not a regression: the fan-out neither introduced nor widened it — though it does change how the flaw is *reached*, which **R225** asked be said out loud: before LV.14 a wrong `N of M left` needed you to tick in that column, and now one tick moves the header of every other column holding the player, including one whose drafted read failed, so the wrong number can appear where the user never clicked |

- **Hand-offs LV.15 filed rather than left implicit.** The first two are
  **obligations on LV.16**, not observations — LV.15 shipped a deliberately
  partial header and a scaffold body, and an obligation stated only in the
  previous Builder's file is R209's finding repeating (**R51**: a hand-off
  without its own row is itself a review finding). **Both now also sit in the
  plan's own LV.16 row** (**R230**, plan v5.7) — this table is the record, that
  row is what the next Builder is pointed at, and until R230 only this table had
  them. The third is LV.17's. **F-LV15.4 was added by the review round** and is
  neither: it is a defect in the *precedent*, on a surface outside this build.

  | id | What | Owner, and why it is not in LV.15 |
  | --- | --- | --- |
  > **✅ F-LV15.1 and F-LV15.2 are DISCHARGED by LV.16 (2026-08-12), in the same
  > PR as the work.** The scaffold is deleted outright — the name appears in no
  > `.tsx` in the tree outside the window header's own record of the hand-off,
  > and its branch renders the real rows (pinned both ways, so a *rename* cannot
  > satisfy the first assertion). The header now carries **cover, name, gear,
  > dots, collapse, close** in the LAW's order, with the order itself pinned, and
  > neither new control is decorative: the gear opens `list-toolbar.tsx`'s own
  > `StatsCatalog` — exported rather than copied, and rendered **outside** the
  > dark wrapper — and `dots` is `ORG_OPTIONS` + per-list `setOrg`, measured
  > re-banding the rows to `Round 1 · Ungrouped`. **F-LV15.3 remains open and is
  > still LV.17's.** The two rows below are left as written, as the record.

  | **F-LV15.1** | **`ListWindowBodyPending` must be deleted, not decorated.** `list-window.tsx` ships a marked scaffold body — the same device as LV.12's `ComparisonPending`, which LV.13 duly deleted — reading *"Rows, stats and the dark inversion arrive with LV.16."* Its branch becomes the inversion wrapper + the 36px rows + the footer | **LV.16.** The rows and the wrapper *are* that task. Nothing pins the scaffold's existence, deliberately: a pin the next task must delete is friction, and this row is the record instead |
  | **F-LV15.2** | **The header is two controls short of the design LAW.** *"cover, name 12.5px/600, then gear (stat picker), `dots` (grouping menu), collapse, close"* — LV.15 ships cover, name, collapse, close, and a marked gap where the other two go. They were left out rather than rendered inert because a control that does nothing is the live-but-false affordance **R220** found one task earlier | **LV.16.** The gear opens the Stats modal that task must render *outside* the inversion wrapper (design LAW), and the `dots` grouping menu regroups rows that do not exist until then. The menu itself is a compose, not a build: `list-display-store`'s `setOrg` + `ORG_OPTIONS`, exactly as `side-by-side-columns.tsx` does it |
  | **F-LV15.4** | **The precedent this build mirrors closes its window on an Escape that a Radix overlay already handled** — found while proving R227's own guard, and **reproduced live**. `window-shell.tsx`:123–129 has no `defaultPrevented` check, and Radix's `DismissableLayer` listens on `document` in the **capture** phase and only calls `preventDefault()`, so a bubble-phase listener still runs. Measured on `/app/lists`, local stack: player mini card open (`[role=dialog] "Josh Allen"`, `z:60`) **plus** the account dropdown open → **one** Escape → menu `data-state="closed"` *and* `[role=dialog]` count **0**. The user aimed at the menu and lost the mini card too | **Not LV.15, and not Lists — but it now has an owner, which it did not (R233).** `src/components/shared/window-shell.tsx` is the *Players* mini card, outside this task's diff and outside Round 2's surface; changing it would be the drive-by fix the charter forbids, and it is the only row in this table describing a **live defect on a shipped surface** rather than a build hand-off, so "LV.16" / "LV.17" were never available to it. It is filed as a **task chip — `task_c1e3da1c`, *"Fix player mini card closing on a handled Escape"*** — carrying the file, the line numbers, the cause, the reproduction and the fix to copy, so a one-line fix with a proven reproduction does not rot in §5. ~~The pop-out is **not** affected — LV.15 carries the guard~~ — ***that claim was too broad and is corrected by R231***: `defaultPrevented` covers Radix and only Radix, and the pop-out **was** affected by the app's own Escape handlers, which do not `preventDefault()`. Both windows had the same defect; only its Radix half differed. The pop-out's is fixed (R231, `escapeBelongsToTarget`), the mini card's is the chip, and **the chip points at the fixed file rather than restating the fix** |
  > **✅ F-LV15.3 is DISCHARGED by LV.17 (2026-08-12), in the same PR as the
  > work — and it STAYS discharged.** The obligation was *"say what small
  > screens get"*; LV.17's answer to it was **overruled by Chris on 2026-08-12
  > (§3 Q6)** and replaced by a real bottom-sheet variant, which is the
  > obligation being met by the only person who could rule it, not re-opened.
  > The paragraph below is left as written, as the record; its three *desktop*
  > properties are all still true and are what the ≥768px window rests on.
  > The answer *was* *"a small screen gets the same window"*, decided here
  > rather than inherited from D14 — Chris's *"leave the phone version as is"*
  > was about **Side by side**, and this task deliberately did not extend it, nor
  > hide the `pop out` control below a breakpoint (a product decision of the same
  > shape, left to Chris and a one-line change if he wants it). Each of the three
  > things F-LV15.3 names is closed: **touch resize is no longer unverified** —
  > a `pointerType: 'touch'` header drag and grip drag at 375 × 812 moved a
  > window from `[275,462,352,416]` to **`[10,142,292,326]`**, fully on screen
  > with the close button hit-testable and the size persisted; the *size* half of
  > LV.15's fit was added, so a window the store places opens whole rather than
  > relying on a CSS cap the resize grip could not see; and the grip now starts
  > from the painted corner. **The weaker half is stated, not glossed**: a window
  > the *user* placed is still only rescued to 100px of grabbable header — the
  > drag handle, not the control cluster — so one carried across from a wider
  > viewport takes one drag before its close button is reachable. That is LV.15's
  > deliberate rule, upheld twice, and re-fitting it would be the thing those
  > reviews refused. The row below is left as written, as the record.

  | **F-LV15.3** | **The phone question is open, and LV.15 answered only the part that would have shipped broken.** A cascaded window now fits the viewport (§4), so the close button and the grip are reachable at 375px — but a 352 × 416 window still covers most of a phone screen, **touch resize is unverified** (the grip carries `touch-none` and takes pointer events, but no touch drag was exercised), and there is no answer for what a phone *should* get instead of a floating window. Chris's *"leave the phone version as is"* (D14) was about **Side by side**, not pop-outs, so nothing here is ruled | **LV.17**, which owns *"the mobile answer (a floating draggable window has none — say what small screens get instead)"* in as many words |

- **Follow-up LV.16 filed rather than absorbed**, same rule as the LV.7 seven,
  F-LV12.1 and F-LV14.1: in scope to notice, out of scope to fix here. It is not
  a hand-off to LV.17 — it is house-wide.

  | id | What | Why it is not in LV.16 |
  | --- | --- | --- |
  | **F-LV16.1** | **The share link is now built in three places, from one rule.** `lists-page-v2.tsx`:227, `list-detail-panel.tsx`:392 and now `list-window.tsx` each spell `${origin}/u/${username}/lists/${slug}` with their own owner fallback, and ~~only the window's refuses to copy a link it cannot address~~ — the other two fall back to the literal `'you'`, which produces a **404** for a viewer whose profile has no username, because the public page matches on `owner_id` *and* `slug` (`u/[username]/lists/[listSlug]/page.tsx`:47–60). One `listShareLink(list, owner)` used by all three would collapse the rule and the fallback together. ***The struck clause was true of only one of the two ways this can go wrong, and is corrected by R235's round (R237):*** as first written, the window refused when the username was **null**, and copied a confidently wrong one when it was **not** — the viewer's own handle stood in for a **saved** list's owner as soon as the collections cache aged out, which is the ordinary life of a pop-out (`gcTime` is React Query's 5-minute default; measured at `300000`). That link was shown 404ing. It now refuses in both cases: `cached?.owner?.username ?? (list?.is_owner ? viewerName : null)` | The window needed the rule, not a refactor of two shipped surfaces: LV.16 already moves one shared thing (`use-list-drop.ts`), and a sweep across the page and the panel is a separate change with its own verification. It is also **not a regression** — the `'you'` fallback predates this task by two rounds. **Still true after R237**, which fixed the window's own fallback and deliberately left the other two alone |

- **Follow-ups LV.17 filed rather than absorbed**, same rule as the LV.7 seven,
  F-LV12.1, F-LV14.1 and F-LV16.1: in scope to notice, out of scope to fix here.

  | id | What | Why it is not in LV.17 |
  | --- | --- | --- |
  | **F-LV17.1** | **The prototype puts `Pop out into a window` in the list *row* menu too** — `design/ListsScreen.jsx`:119, the menu that became this app's `list-gallery-card.tsx` / rail row menu. The app now has two entry points (the detail hero and a Side by side column); the prototype has three, and the third is the one that pops a list out **without opening it first** | The task text names two in as many words — *"`pop out` in the detail hero action cluster and in the column menu"* — and a third entry point is a design call on a surface this task never opened. It is a two-line addition wherever it is wanted |
  | **F-LV17.2** | **The detail panel's own failed-read state is a third spelling of `ListReadFailure`.** LV.17 collapsed the column's and the window's into one shared component; `list-detail-panel.tsx`:300–312 still has its own — a 22px icon and 13px/11px type, the page's scale rather than the panel's — and so it does **not** get the unavailable/failed split. ~~Not currently reachable~~ — **that reason was wrong and is corrected (R253, 2026-08-12): it is reachable**, by the same two routes the window's state is (a delete from another tab or device, and the visibility flip R248 measured), and R249's retry removal makes it land immediately. What is true is that **its copy is not wrong** — *"This list could not be loaded."* claims no cause — so nothing false is shown; the split is a design call, not a defect | Changing the panel's error state means deciding whether the page-scale treatment folds into the shared one or takes a `size` prop — a design call, on the one Lists surface this task otherwise never touched. Filed rather than swept in with the two that had to move |
  | **F-LV17.3** | **`window-shell.tsx`'s player mini card has no equivalent of Ruling 1 or Ruling 2.** Chris ruled about *pop-outs*; the player mini card is the surface this window was modelled on (D11/D13), it floats at z 60, and it neither closes over a vanished player nor has a small-screen variant. Whether the rulings extend to it is a Chris call, not an inference | This build's rule is that a ruling is not inferred onto another surface — which is exactly what left Q6 open to be asked. The mini card is a *Players* surface, outside Lists v2's diff, and F-LV15.4's chip is the precedent for how a mini-card change gets an owner |
  | **F-LV17.4** | **Several pop-outs on a phone pile with no visual evidence that there is more than one.** Every mobile window has identical geometry (Ruling 2), so three open look like one until you close the top and the next appears. Measured: three at `[0, 325, 375, 487]`, unwound `3 → 2 → 1 → 0`. **No cap was invented** — Q4's precedent is that Chris rules caps — and no switcher was invented either, since the design package has neither | A mobile window switcher, a count badge, or a cap are each a product decision with design-package consequences. Filed so the cost is on the record rather than discovered on a phone |
  | **F-LV17.5** | **No pop-out gesture has ever been driven by a real browser touch event, in three sessions** (carried from **R254**). Two Builders and a Reviewer all hit the same wall: the tooling's pointer input **times out** under its mobile emulation, so every mobile interaction has been synthesised. What *is* proven, executably: `touch-action: none` on both desktop grab surfaces, the geometry maths, the rendered variant, and the store writes. **Ruling 2 raises the stakes** — mobile is now a designed surface, not an incidental one | A real-device (or real-touch-harness) pass is an environment problem, not a code change. Filed as an explicit gap so the limitation stops being restated in prose each round |

- **LV.1.3 — LANDED 2026-08-09.** Q1 was ruled "build it as written", and it
  built as written. The boards rule held on the *diff* — zero files under
  `src/components/lists/draft-mode/**`, and `list-detail-view.tsx` untouched too
  — while all three accepted consequences were **shown** rather than assumed:
  the board surface displaying an account-persisted mark it never asked for
  (and correctly *not* showing it on a second list sharing the same players),
  the legacy detail view rendering intact under a real 500 from the drafted
  route, and the old localStorage key left inert with no migration path.

  **What the review then found, and it is the lesson worth carrying (R190):**
  each of those three consequences was accepted on its own, and the *pair* of
  them — a silent failed read plus a clear that had just become durable — was a
  data-loss path neither review nor build had priced. Consequences accepted
  singly still have to be crossed with each other before a task is done.

  **And the second lesson, from the re-review (R195): a guard must gate on the
  fact, not on a signal that correlates with it.** The R190 fix asked React
  Query whether the query was in `error` or `pending` — a reasonable proxy for
  "the marks are unknown", and wrong, because the hook's own optimistic
  `setQueryData` rewrites those bits to `success`. The whole data-loss path
  re-opened on the first tap. The rule this build now follows: when a guard
  protects data, take its input from the event that actually establishes the
  fact (here, the `queryFn` returning), not from state that something else in
  the same file is allowed to write.

  **And the third, from the final review (R199/R200): getting a guard's input
  right is not the same as getting its scope right.** The same guard was then
  wrong twice more — an aborted read could still open it (the two arms of one
  `try/catch` disagreed about what an abort meant), and it was scoped to the
  mount while the data it guarded was scoped to the cache. Both were found by
  attacking the *edges* of a mechanism two reviews had already accepted at its
  centre. Round 3 resolved R199–R202; see §6.

- **LV.1.5 — LANDED 2026-08-11.** Q2 was ruled "widen the CHECK" and it was
  widened: migration `081_list_players_tier_vocabulary.sql`. The original
  finding held all the way to the database — the pre-migration predicate was
  golden-pinned, re-applied by hand as a probe, and pgTAP 030 went **red on 11
  assertions** under it, then green again on 081. Measured through the real
  HTTP route, the failure Q2 predicted no longer exists in either direction:
  `S`/`F`/`null`/`r7`/`r30`/`c1` → **200**, and `r31`/`c5`/`''`/`Z`/`__proto__`/
  a 200-char string → **400**, never a 500 carrying a raw `23514`.

  **The lesson this one adds: a widening is a read-side event too.** Q2 priced
  the blast radius carefully and still under-counted, because it asked "what
  writes this column" and not "what *reads* it and assumes a closed set". Two
  surfaces built a `Map` seeded with S–F and then did `map.get(key)!.push(p)`;
  the first round-bucketed player made that `undefined.push`. On the public
  share view — server-rendered, SEO-critical (D7) — that is a 500, not a
  degraded page. It was found by grepping every consumer of the column rather
  than every writer, and both halves were shown: the crash reproduced live,
  then fixed.

Nothing blocks Lists v2. ~~**Phase 2 (LV.2.1, LV.2.2, LV.2.3) and LV.3.1 are
clear of both Q1 and Q2** — that is where the loop should go next.~~ *(Stale —
all of Round 1 landed 2026-08-11.)* **The loop goes to LV.12** — Round 2's
picker — and then LV.13 → LV.17 in order. Plan §6 carries the task text; D12
and D13 carry the two decisions that were made before the first task, rather
than discovered inside one.

**Two pre-existing repo-wide test-infrastructure faults were measured during
LV.1.2 and are NOT caused by it.** Neither blocks this build (the Lists v2
DoD, plan §5, is type-check / lint / `test:unit` / PROGRESS / branch+PR), but
the first one **does** block the leagues M2 DoD, which includes
`npm run test:db`. Task chips were filed for both.

- **`npm run test:db` is red on `main`: the local Postgres backend
  segfaults.** `supabase/tests/002_notify_list_followers_auth.sql:35` kills
  the backend (`signal 11: Segmentation fault` in `docker logs
  supabase_db_fieldscout`), which puts the DB into recovery mode so every
  later file reports `FATAL: the database system is in recovery mode` —
  hence `Files=29, Tests=20, Result: FAIL`. Run file-by-file, **9 of 29
  crash**: 002, 013, 014, 015, 016, 018, 020, 022, 026. (Re-confirmed
  pre-existing at the LV.1.3 round-3 session by A/B: 002 reproduces the
  backend crash with the round-3 diff stashed *and* on `main` itself, and
  that branch touches no pgTAP file other than 028.)

  > ⚠️ **025 is NOT a crasher — corrected 2026-08-10 (orchestrator, R204).**
  > The round-3 session added it to this list; that was wrong, and the error
  > mattered because it filed two *genuine* failures as a harness crash, which
  > is exactly how they get waved through at the M2 DoD. Measured directly:
  > `npx supabase test db supabase/tests/025_mock_draft_mode.sql` →
  > `Wstat: 0, Tests: 120, Failed: 2` — the file **runs its whole plan** and
  > the backend stays up; contrast 002, which returns `wstat 512` and leaves
  > `database system was not properly shut down; automatic recovery in
  > progress` in the container log. The "same idiom" attribution was also
  > false: `grep -c "set local role anon" supabase/tests/025_mock_draft_mode.sql`
  > → **0**.
  >
  > **025 has two real, pre-existing failing assertions — tests 46 and 79**
  > (CPU-autopick behaviour). They belong to leagues M2, not Lists v2, and are
  > **not** covered by the crash waiver above. Whoever resumes M2 must treat
  > them as failures to fix, not noise to skip.
  Every crash is the same idiom — `throws_ok(..., '42501')` where the error
  is *permission denied for function* on a REVOKEd SECURITY DEFINER routine
  under `set local role anon`. Proven pre-existing by A/B: reproduced with
  migration 079 removed from the chain (chain at 078). pgTAP **028 passes
  49/49** (47/47 before the R173/R174 pins) — its `throws_ok` cases expect
  runtime errors (RLS `WITH CHECK` 42501, 23503, 23505), which do not trip
  the bug. Suspected cause is the Postgres 17 image from the pinned CLI
  (2.109.1; 2.113.0 available). **Run 028 on its own** —
  `docker exec -i supabase_db_fieldscout psql -U postgres -d postgres -q -t
  -A -f - < supabase/tests/028_list_player_drafted.sql` — rather than through
  the whole `test:db` sweep, which the segfault zeroes.

- **`npm run test:stack` is intermittently red at roughly 1 run in 3**, on a
  different leagues suite each time (most often `draft-realtime-db.test.ts`'s
  private-channel test, which fails on a **50-second** subscribe timeout —
  a load symptom, not an authorization one; also seen: invites capacity,
  `create_league` at team_count 14, draft-core picks, settings PATCH 409,
  and — **added at the LV.1.3 re-review, R198** —
  `src/lib/leagues/api/league-lists-api-db.test.ts`, which the LV.1.3 Reviewer
  saw red on 2 tests in 1 of 8 branch runs while passing **3/3 in isolation**,
  on a suite that diff does not touch. The family is "leagues stack suites
  under parallel load", not a fixed list; treat a red in any of them the way
  R161 says — re-run it alone before believing it).
  Measured over 17 consecutive runs: **3 failures in 9 runs without** the new
  `drafted-api-db.test.ts` and **3 failures in 8 runs with** it — the same
  rate, the same failure families. `drafted-api-db.test.ts` itself passed
  **8/8**. Likely causes are parallel-run timing against one local stack plus
  cross-suite fixture collisions (the class the R161 finding already
  documented).

---

## 6. Review findings

*(Reviewer findings per cycle, in house format.)*

### LV.1.1 — 2026-08-09 (PR #107) — verdict **FIX-THEN-MERGE**

*Reviewer session (fresh context, red-team brief) against PR #107 —
`featureFlags.listsV2` + the route-level branch — verified against plan v3.2
§1/§4/§5, D1, and the `.env.example` / `feature-flags.ts` conventions. Method
included a deliberate-break probe (inverting both branch conditions) run
against the full DoD gate. **R166–R170: three should-fix, two nits, no
blockers.**

**The finding that mattered:** the PR added **zero** tests (656 = 656 against
main's baseline), so nothing anywhere was falsifiable against the branch
*direction* or the flag's deployed default. The Reviewer inverted both
conditions to `if (!featureFlags.listsV2)` — the change that would replace
production Lists with the "coming soon" placeholder for every user — and the
entire gate stayed green: type-check clean, lint exit 0, `test:unit` 39
files / 656 tests passed.*

#### Resolution — 2026-08-09 (Builder, same branch `feat/LV.1.1-lists-v2-flag-and-route-branch`)

*All five resolved on the same branch; nothing deferred, nothing escalated.
Proof re-run this session: `type-check` clean · `lint` exit 0 (only the
pre-existing `auction-draft-room.tsx:105` warning) · `test:unit` **40 files /
663 tests** — above the 656 baseline by the 7 tests R166 required.*

| Finding | Severity | Resolved by |
| --- | --- | --- |
| **R166** — nothing falsifiable against the branch direction or the flag's deployed default | should-fix | **`src/lib/lists-v2-flag.test.ts`** (new, 7 tests), following the `launch-scope-gates.test.ts` idiom the house already owns. Pins (a) `featureFlags.listsV2 === false` under the deployed default (unset var, `NODE_ENV=test`), (b) `=== true` under the local-dev default via `vi.stubEnv('NODE_ENV','development')` + `resetModules`, (c) the literal `process.env.NEXT_PUBLIC_FLAG_LISTS_V2` read (build-time inlining), (d) per route, the exact **un-negated** `if (featureFlags.listsV2) {` **plus** an ordering assertion that the v2 screen is returned *inside* the ON branch and the `*Legacy` screen is the fallback below it, and (e) that the OFF path still mounts `PageHeader`/`ListsBrowse` and `ListDetailView`/`AiBuildBanner`/`CommentsThread`. **Shown falsifiable twice:** the Reviewer's exact probe → 2 RED, reverted → green; and a second probe swapping the two return bodies (same net effect, no negation) → 1 RED on the ordering assertion, reverted → green. `launch-scope-gates.test.ts` also gained a comment stating that `listsV2` is *not* a launch-scope gate and must not be deleted as one |
| **R167** — DoD §5.4 browser evidence asserted in prose, shown nowhere; the OFF-state check rendered the "List not found" error card, never the legacy happy path | should-fix | Re-verified from scratch against the **local** stack with a **real seeded 20-player list** owned by the dev user (`Draft Board — 2026 PPR`, seeded into the local DB only — nothing hosted touched). All 8 combinations re-run (2 routes × 2 flag states × 1440×900 / 375×812); the flag-OFF detail page rendered the full `ListDetailView` — hero, owner-only cover "Change", grouping selector, six tier sections, 20 players with PROJ/2025/ADP cells — **and** `CommentsThread`, with **zero console errors** on a clean tab. Verification log with rendered-text extracts written into the PR body; the PR states plainly that screenshots were taken locally and **cannot** be attached via `gh` (no image upload), rather than claiming attachments that do not exist |
| **R168** — plan §3 D1 ("New Lists replaces the bodies of existing components") contradicts the shipped `src/components/lists/v2/` structure, and the Builder resolved it unilaterally in PROGRESS §4 | should-fix | **Plan amended in place to v3.3** (changelog entry added). D1 now states that Lists v2 screens live in `src/components/lists/v2/`, are swapped in at the route branch, and are retired at LV.4.4 — with **"no forks of `src/components/ui/` primitives"** kept as the surviving absolute prohibition, and the §4/LV.4.4 derivation spelled out so none of the remaining twelve tasks re-derives it. §4 below now points at D1 instead of arguing with it. **Editorial reconciliation — no product decision** |
| **R169** — §1 Round 1 still read "🟡 Not started" with LV.1.1 ticked in §2 | nit | §1 Round 1 status → **🔵 In progress (LV.1.1 landed 2026-08-09)** |
| **R170** — `.env.example` documented only the `"true"` case; unset also routes to v2 in local dev, taking away a shipped surface | nit | `.env.example` comment expanded to say outright that blank = ON locally, that `npm run dev` therefore shows placeholders where Lists is today until LV.2.1/LV.3.1 land, and that `NEXT_PUBLIC_FLAG_LISTS_V2=false` in `.env.local` restores today's Lists. Same note added to the §4 decision entry |

#### Re-review — 2026-08-09 (fresh Reviewer, fix diff `2c17a76`) — **VERDICT: CLEAN**

*Re-ran the full gate independently (type-check clean · lint exit 0 · `test:unit`
40 files / 663 tests) and corroborated the R167 fixture against the local DB —
tier counts and player rows matched the PR's rendered-text extract, so it could
not have been fabricated from the diff. R166 confirmed **load-bearing** by six
break-probes, four of which the fix Builder never claimed to cover: inverted
branch → 2 RED · flag read deleted → 1 RED · coherent flag rename across all
three files → 5 RED · `enabled(...) || true` (defeats the source pin, trips the
behavioral pin) → 1 RED · swapped return bodies → 1 RED. Behavioral and source
pins proved complementary rather than redundant.*

Two nits recorded, **not fixed** — both are inherent ceilings of the source-pin
idiom (the routes are `.tsx`, unparseable by Vite under Next's
`jsx: "preserve"`, which is why the house source-pins at all):

| Finding | Severity | Disposition |
| --- | --- | --- |
| **R171** — `src/lib/lists-v2-flag.test.ts` locates the canonical `if (featureFlags.listsV2) {` but never asserts it is the *only* decider. A reachable shadow condition inserted *above* it (probe: `if (process.env.NEXT_PUBLIC_FLAG_LISTS_V2 !== 'false') return <ListsPageV2 />`) ships v2 to production with the gate green, because the ordering assertion only searches forward from the branch | nit | **Open.** Fix direction: assert the branch is the first statement of the default export, or that `<${v2}` occurs exactly once in the file. Worth folding into LV.2.1 when that task next opens these routes |
| **R172** — the "flag-OFF path still mounts today's Lists UI" assertion scans the whole file rather than the `*Legacy` body, so a mount dropped from the OFF render still passes if the same JSX survives elsewhere in the file. Outright deletion **is** caught; the miss window is narrow | nit | **Open.** Fix direction: slice the source to the `function ${legacy}` body before asserting mounts, or narrow the test name to what a whole-file pin can honestly claim |

### LV.1.2 — 2026-08-09 (PR #108) — verdict **FIX-THEN-MERGE**

*Reviewer session (fresh context, red-team brief) against PR #108 — migration
079 `list_player_drafted` + `/api/lists/[id]/drafted` — verified against plan
v3.3 §1/§2.2/§3 D2/D6, the migration + RLS checklists, and the falsifiability
floor. **R173–R175: one should-fix, two nits, no blockers.***

***The finding that mattered:** the Reviewer applied, against the live local
DB, exactly the 013-style policy that 079's own banner names as the wrong
answer — and **nothing moved**: pgTAP 028 47/47, `drafted-api-db.test.ts`
21/21, `drafted-service.test.ts` 11/11 all green. The regression was
nonetheless real (their 067 fixture went from SUCCEEDED to `new row violates
row-level security policy`). The banner's "both directions are pinned" claim
was true of the two directions that did not distinguish the design, and the
one that did was pinned nowhere. The forgery pin, by contrast, was shown
load-bearing by the Reviewer's control break.*

#### Resolution — 2026-08-09 (Builder, same branch `feat/LV.1.2-drafted-table-and-route`)

*All three resolved on the same branch; nothing deferred, nothing escalated.
Each fix was **shown falsifiable** — the pin reddens under the exact break it
exists to catch, then restored (R173's restore was a full `npx supabase db
reset`, the honest one).*

| Finding | Severity | Resolved by |
| --- | --- | --- |
| **R173** — the RLS-deferring `EXISTS` was pinned only in directions the rejected 013 form satisfies too; the 067 league-shared-private case, the sole discriminator, was pinned nowhere | should-fix | **pgTAP 028 gains the 067 fixture and the pin.** New fixture: `leagues` `pgtap-lpd-league` (u1 commissioner, u2 manager, u3 deliberately not a member), `league_lists (shared_with_league = TRUE)` over a NEW private list `lpd u1 private league-shared` (`94000000-…-0005`). New assertion 38, a `lives_ok` for u2 marking on it, sits **immediately after** the existing `throws_ok` for u2 on u1's plain-private `…-0002` — the two lists differ in exactly one respect, so the pair isolates the `EXISTS` and nothing else. `plan(47)` → `plan(49)`. **Probe:** the Reviewer's exact `ALTER POLICY` → **not ok 38** (`42501: new row violates row-level security policy`) **+ not ok 47** (the downstream total-rows epilogue), `# Looks like you failed 2 tests of 49`; restored by full `db reset` → **49/49**. The 079 banner was rewritten to stop overclaiming: it now names all three directions, says which suite pins each, states that the third is the load-bearing one, and records that the 013 form was **measured** passing the whole suite green before the pin existed |
| **R174** — "does not cascade to other lists", D2's most explicit prohibition, was indistinguishable from a cascade that wiped every list: both fixtures gave the victim exactly one list | nit | **The victim now lives on two lists in both suites.** pgTAP 028: `pgtap-lpd-p2` joins `lp4` as well as `lp1` and is marked on both; the positive control asserts 2 marks, then removing him from `lp1` asserts **0 on lp1 and 1 on lp4** (new assertion 24). `drafted-api-db.test.ts`: the cascade test puts `PLAYERS[1]` on the private board too, marks him there, and asserts that mark survives the public-list removal — then restores the fixture so the downstream clear-drafted counts are unchanged. **Probe:** an `AFTER DELETE` trigger on `list_players` wiping marks for that player across every list → **not ok 24** (+ the two total-rows guards), `# Looks like you failed 3 tests of 49`; dropped by the same `db reset` → 49/49 |
| **R175** — the un-mark path collapsed "you had no mark" and "the delete was not permitted" into one `changed: false`, while its `drafted: true` twin distinguishes them (42501 → 403) | nit | **Hard assertion, not a comment** (LV.1.3 consumes `setDrafted`). New `assertCallerIs(supabase, userId)` in `drafted-service.ts` compares `userId` against the client's real `auth.uid()` and returns the same **403 `CANNOT_MARK_MESSAGE`** the twin returns. It is called **only when the DELETE removed nothing** — in `setDrafted`'s un-mark arm and in `clearDrafted` — which is deliberate on two counts: the happy path pays no extra auth round-trip, and the 42501 arm of `setDrafted` stays **reachable through the service**, so the existing "a 42501 the probe cannot foresee becomes a friendly 403" test keeps pinning that code→copy mapping instead of being short-circuited into dead code by an eager guard. `getUser()` failing is a 500, never a swallowed no-op. Three new stack tests: the two 403s (each with a privileged positive control proving the row the call failed to delete really exists) plus a **counter-control** — a genuine zero-row un-mark by the rightful caller is still a plain 200 `changed:false`. **Probe:** both `assertCallerIs` call sites removed → **2 RED** (`expected 200 to be 403`) with the counter-control still green; reverted → 24/24 |

**Not changed, and why:** `clearDrafted` still skips the list-readability
probe (§4's decision 2 — 079's DELETE policy is unconditional on purpose, so
you can always clean up your own rows on a list that has since gone private
or into the trash). R175 adds an identity check, not a visibility check.

#### Re-review — 2026-08-09 (fresh Reviewer, fix diff `86a9881`) — **VERDICT: CLEAN**

*Gates re-run independently: type-check clean · lint exit 0 · `test:unit` 41/674 ·
`test:stack` 16/224 (green twice) · `drafted-api-db.test.ts` standalone 24/24 across
four runs, no flake · pgTAP 028 **49/49** · hosted `list_migrations` head still **078**
(079 never applied hosted) · `database.ts` alias block intact.*

*Six probes, three of which the fix Builder never ran: the 013-form policy → `not ok 38`
(the new 067 pin) byte-for-byte as claimed; the **013 form against the full stack suite →
224/224 green**, independently substantiating that assertion 38 is the only pin anywhere
that discriminates; a `BEFORE DELETE` cross-list wipe (different mechanism from the
Builder's `AFTER DELETE`) → `not ok 24` with assertion 22 still green, so 24 is the sole
per-list discriminator; the same trigger against the stack suite → 4 red; `assertCallerIs`
call sites removed → 2 red; and `assertCallerIs` forced to always-403 → 3 red, proving
the counter-control load-bearing rather than decorative.*

*R175's **lazy** guard placement was judged sound: the Reviewer could not construct a path
where a mismatched `userId` returns a cheerful `changed:false` — the DELETE carries
`.eq('user_id', userId)` under RLS `USING (user_id = auth.uid())`, so on a mismatch the
intersection is empty by construction. The Builder's argument that an eager guard would
silently un-pin the 42501→403 mapping test was verified correct.*

Three nits recorded, **not fixed**:

| Finding | Severity | Disposition |
| --- | --- | --- |
| **R176** — `drafted-service.ts` `listDrafted` (GET) still collapses "you hold no marks" with "you asked on behalf of someone you cannot speak for" into `200 {drafted: []}` — the exact shape R175's contract forbids eleven lines above. Reachability is identical to the un-mark path that got a hard 403, so the asymmetry now lives inside one file | nit | **RESOLVED at LV.1.3** (PR #112). `listDrafted` now calls `assertCallerIs` when the read comes back empty — same lazy placement, same 403 `CANNOT_MARK_MESSAGE`, so the read path and the un-mark path finally give the same answer to the same question. Three new stack tests: the 403 (with a privileged positive control proving the marks it failed to read really exist), a **counter-control** that a rightful caller holding genuinely zero marks is still a plain `200 {drafted: []}`, and one showing a non-empty read is untouched because the guard is lazy. **Probe:** guard removed → **3 RED**; reverted → 32/32. **Reachability, stated plainly (R193, LV.1.3 review):** every handler in `src/app/api/lists/[id]/drafted/route.ts` passes `user.id` twice, so `verifiedUserId === userId` by construction and the guard returns `null` without consulting reality — proved directly, `listDrafted(clientA, listId, userB, userB)` → **200** from a client that is not B. This is a **service-layer contract for non-route callers**; through the shipped route it is tautological, so nothing here promises a 403 the API will ever return. Not a regression: pre-R178 the fallback called `getUser()` on the same client and also always matched |
| **R177** — two imprecisions in the newly-amended honesty text: 028's break map says the 013 substitution fails "the 067 pin and nothing else" when it measurably fails **two** (38 + the total-rows epilogue 47), disagreeing with PROGRESS §6 which records both; and 079's banner cites `drafted-service.test.ts` as corroborating green when that suite drives a `noDatabase` Proxy and **structurally cannot** redden for an RLS change | nit | **Open.** Fix direction: "assertion 38, plus the downstream epilogue count"; cite the stack suite alone as the DB-reaching green |
| **R178** — the lazy guard adds an `auth.getUser()` round-trip on the legitimate idempotent-replay path, which this file's own header says to expect (optimistic checkbox retries); the route proved the same identity one call earlier | nit | **RESOLVED at LV.1.3** (PR #112). LV.1.3's hook drives the replay path on every un-mark, so the round-trip stopped being theoretical. `assertCallerIs` takes an optional `verifiedUserId`; all three route handlers pass `user.id` twice — once as the marks' owner, once as the identity they already resolved — and the comparison happens in memory. Callers that have proven nothing (including this suite's deliberately-mismatched drivers) keep the `auth.getUser()` fallback unchanged, so R175's pins stay live. The trust boundary is documented, not hand-waved: a caller could thread an unverified id and turn the 403 into a 200 `changed:false`, which costs nothing real because 079's RLS — not this function — stops the rows moving. **Measured with a `vi.spyOn` on the real client**: threaded empty read → `getUser` **0 calls**; identical unthreaded read → **≥1**; threaded mismatch → 403 with **0 calls**. **Probe:** short-circuit removed → **4 RED**; reverted → 32/32. **Upheld at the LV.1.3 review** — the Reviewer probed a caller threading a lie and confirmed the trade: honesty is lost, authority is not, because 079's RLS is the enforcement. **And (R193) both guards are unreachable through the shipped route** — all three handlers pass `user.id` twice, so the comparison is tautological there; the guards exist for non-route callers |

### LV.1.3 — 2026-08-09 (PR #112) — verdict **FIX-THEN-MERGE**

*Builder session. `use-draft-mode.ts` repointed at LV.1.2's server source
(§2.1, D2, §3 Q1), plus the two LV.1.2 nits that live in this code path —
**R176 and R178 are discharged here**, rows above updated.*

**Six break probes, one of which failed to redden and changed the design.**

| Probe | Result |
| --- | --- |
| `toDraftedSet` fallback removed (`new Set(ids as …)`) | **GREEN — the probe's own finding.** `new Set(undefined)` is harmless per spec, so `?? []` was never what stood between a failed read and a white screen. The JSDoc claiming it was a `TypeError` was **false and is corrected**; the real guards were identified and pinned instead |
| `toDraftedSet` dereferences first (`ids.length ? ids : []`) — the realistic edit | **4 RED**, `TypeError: Cannot read properties of undefined (reading 'length')` — the actual crashed-page shape |
| `throwOnError: true` added to the query | **1 RED** (the error-boundary pin) |
| Whole task reverted — marks read back out of `localStorage` | **8 RED** |
| R176's read guard removed | **3 RED** |
| R178's in-memory short-circuit removed | **4 RED** |

**Browser (local stack, flag OFF, desktop 1440×900 + mobile 375×812).** The
flag-OFF legacy detail view renders unchanged; a mark made there lands in
`list_player_drafted` (verified by SQL), survives a full reload while
`localStorage` holds **no** key for that list, and "Reset list" leaves
`remaining_marks = 0`. **Consequence 2 was exercised, not assumed**: the real
route was temporarily made to return 500, the page reloaded — all 12 players,
tiers and controls rendered, the "1 drafted" badge simply absent, no error
boundary — then the probe was reverted and the mark came back. **Consequence 1
likewise**: `/app/lists/draft-mode` shows the account-persisted mark struck
through with "1 drafted", through zero edits to that tree, and correctly shows
**no** drafted count on a second list sharing four of the same players.

#### Review — 2026-08-09 (fresh Reviewer, red-team brief) — **R190–R194: two should-fix, three nits, no blockers**

*Verified against plan v3.5 §2.1, **D2**, §3 **Q1** and the falsifiability
floor. The R178 trust boundary was **upheld** (the Reviewer probed a lying
caller: honesty is lost, authority is not — 079's RLS still enforces), and no
second crash vector for Q1 consequence 2 was found. Neither is to be
redesigned.*

***The finding that mattered (R190): a silent, durable data-loss path that
nobody priced, because it lives in the intersection of two separately-accepted
consequences.*** *The Reviewer ran it live on the flag-OFF legacy view: 2 real
rows in `list_player_drafted` → the GET forced to 500 → the page renders with
**no badge, no strikethrough, no toast, no console error** ("zero drafted",
from the user's side) → one click of **Draft mode**, a view-mode toggle that
`list-detail-view.tsx:659` wires straight to `clearDrafted()` → **0 rows**,
permanently, on every device. The codebase already had the right instinct
elsewhere: the other destructive control, "Reset list", measures as `disabled`
in that same state because it is gated on `draftedCount === 0`. Only the toggle
path lacked a guard.*

***The second (R191): the hook body's two decidable wiring facts were pinned by
nothing.*** *`type-check` pins the return **shape**, not behavior — so the PR's
own §4 decisions asserted behavior no suite could falsify. Two probes, each a
total feature break, each fully green: inverting `toggleDrafted`'s desired
state (no player can ever be marked; decision 3's "a same-tick double-tap
converges" becomes false) and making `clearDrafted` a no-op (decision 2's
"turning draft mode off still clears the marks" becomes false) — both passed
type-check, `test:unit` **715/715** and `drafted-api-db` **32/32**.*

#### Resolution — 2026-08-09 (Builder, same branch `feat/LV.1.3-drafted-hook-server-source`)

*All five addressed on the same branch; nothing escalated, no ruling needed.
Both should-fixes **shown falsifiable** — each pin reddens under the exact
break it exists to catch, then reverted. `test:unit` **43 files / 728 tests**
(baseline 715; +13). Scope held: 2 source files + PROGRESS, no migration, no
schema, no new route, nothing under `draft-mode/**`, `big-board/**` or
`board-labels-store.ts`.*

| Finding | Severity | Resolved by |
| --- | --- | --- |
| **R190** — `clearDrafted` issued an unconditional durable DELETE even when the drafted read had failed, so a transient read fault silently destroyed real marks | should-fix | ⚠️ **Superseded in part by R195 below — this row's "success is the only state that permits it" was false, and the corrected mechanism is in the R195 row.** **The clear now refuses marks it cannot see.** New exported `canClearDrafted` / `runClearDrafted` in `use-draft-mode.ts`: an errored read and a read still in flight both present as "no marks" on the page, so a clear issued there deletes rows the user was never shown. The refusal is **loud** (destructive toast: *"Nothing was cleared — your drafted players could not be loaded…"*), never a silent return, which is CLAUDE.md's rule in its mirror image. A *background* refetch over already-read data keeps `status: 'success'`, so the everyday mark → mark → toggle-off gesture is untouched. **Live reproduction, both directions, same rig:** with the pre-fix body restored, 2 marks → forced 500 → one click of Draft mode → **0 marks** (the Reviewer's finding, independently reproduced, so the rig demonstrably reaches the bug); with the fix, 2 marks → forced 500 (page: 12 players rendered, no badge, nothing struck, "Reset list" disabled, no error boundary) → **three** toggle-off clicks → **2 marks**, zero DELETEs on the wire, refusal toast shown. Fault reverted → "2 drafted" renders again. **Counter-control, live:** healthy read + toggle off → DELETE issued, 2 → **0**, so decision 2 still holds. **Probe:** guard removed → **4 RED**; pre-fix `clearDrafted` body restored → **1 RED** on the wiring pin; both reverted → 34/34 |
| **R191** — the hook body's two decidable wiring facts were unpinned; `type-check` pins shape, not behavior | should-fix | **Both decisions exported and pinned, and the wiring pinned separately.** `desiredStateFor(current, playerId)` is now the whole of `toggleDrafted`'s decision (`undefined → true`, `['p1'],'p1' → false`, plus the same-tick double-tap sending the **same** value twice — §4 decision 3, made falsifiable); `runClearDrafted` is the whole of the clear. The wiring is pinned with a **`callbackBody` slicer** that reads the callback's own body out of the comment-stripped source rather than the whole file — a whole-file pin survives the fact being deleted from the callback that needed it, which is exactly R172's miss window. The slicer throws on a missing callback and has its own control test (each body is a real slice and does not contain the other), so a rename fails loudly instead of turning the pins vacuous. **Probes — the Reviewer's own two, now RED:** inverted `toggleDrafted` (their exact edit, `drafted: toDraftedSet(current).has(playerId)`) → **1 RED** (`test:unit` 727/728) with type-check still clean, which is the point; the same inversion moved inside `desiredStateFor` → **3 RED**; `clearDrafted` made a no-op → **2 RED** (`test:unit` 726/728). All reverted → 728/728 |
| **R192** — `draft-mode/use-board-marks.ts:15-17` carries a now-false claim ("never written to the DB — same philosophy as `use-draft-mode.ts`"), in a file this build may not open, with no deferral recorded | nit | **Recorded as a deferral, file untouched** — the boards rule binds the diff, so correcting it here would be the violation. Clause added to the **LV.4.4 checklist row in §2** naming the file, the line range, the sentence that went stale and why (after LV.1.3 `use-draft-mode.ts` **is** written to the DB), so the task that reopens that tree fixes it rather than inheriting a comment that misdirects |
| **R193** — the R176/R178 rows never state that both identity guards are unreachable through the shipped route | nit | **One clause on both rows** (§6, LV.1.2 re-review table): every handler passes `user.id` twice, so `verifiedUserId === userId` by construction and `assertCallerIs` returns `null` without consulting reality — the guards are **service-layer contracts for non-route callers**; through `…/drafted/route.ts` they are tautological. Recorded as *not a regression* (pre-R178 the fallback called `getUser()` on the same client and also always matched), so R176's row can no longer be read as promising a 403 the API will never return |
| **R194** — two pasted evidence blocks in the PR body did not match what they claimed to show | nit | **Both re-pasted from the branch, not from a working tree.** The `git diff --stat` block is now generated from `git diff --stat main...HEAD` at the tip; the consequence-2 block's `playersRendered` figure now agrees with its prose (12), and the counts under it were re-measured on this session's rig rather than carried over |

**Not changed, and why:** the R178 trust boundary and the Q1-consequence-2 pin
set — both explicitly upheld by the Reviewer.

⚠️ **The rest of this paragraph was false and is corrected by R195 below.** It
argued `list-detail-view.tsx` needed no edit because `handleReset` ("Reset
list") is gated on `draftedCount === 0` and so "cannot be clicked" in the
degraded state. One optimistic mark makes that count `1`, which re-enables the
button — the same cache write that forged the guard's status bits. It is edited
now (six lines), and the reasoning that survives is only the last sentence: the
guard belongs in the hook, because the hook is what knows whether the marks were
ever read.

#### Re-review — 2026-08-09 (fresh Reviewer, fix diff `8f3a2d6`) — **VERDICT: FIX-THEN-MERGE** — **R195–R198: one should-fix, three nits**

***The finding that mattered (R195): R190's guard asked the wrong question, and
the hook's own optimistic mark answered it.*** *`canClearDrafted` inferred "the
marks have been read" from `status === 'success'` — but `setMark.onMutate` calls
`qc.setQueryData`, which React Query dispatches as a **manual success**: an
errored query flips to `status:'success'`, `isError:false`, `isPending:false`.
The Reviewer measured it live against the local stack — after a forced 500 the
guard correctly refused, then **one tap** gave `{ status:'success',
isError:false, isPending:false, data:['vitest-rvp-p3'], dbRows: 3 }` → clear
permitted → `ROWS AFTER THE PERMITTED CLEAR → 0`, destroying the 2 rows the user
was never shown. Not a race, either: `onMutate` also calls `cancelQueries`,
which kills the failing refetch, so a marking session holds the window open
continuously (`ever closed during the session → false`).*

#### Resolution — 2026-08-09 (Builder, same branch, second fix round)

*All four addressed on the same branch; nothing escalated, no ruling needed.
`test:unit` **43 files / 749 tests** (was 728; +21). Scope held: 3 source files
(the hook, its suite, six lines of `list-detail-view.tsx`) + PROGRESS. No
migration, no schema, no new route, nothing under `draft-mode/**`,
`big-board/**` or `board-labels-store.ts`.*

| Finding | Severity | Resolved by |
| --- | --- | --- |
| **R195** — `canClearDrafted` inferred "the marks have been read" from the query *status*, which the hook's own optimistic `setQueryData` manufactures, so R190's data-loss path re-opened for as long as the user kept marking | should-fix | **The permitting bit now comes from the read, and no cache write can forge it.** `draftedQueryOptions(listId, signals)` raises `landed(listId)` from inside the `queryFn` when the server actually delivers the marks, and `failed(listId)` when a read attempt genuinely fails; `createReadLandedFlag()` (exported, so the bit is falsifiable rather than hook-body logic — R191's rule) holds the **list id** the last landed read was for, which is why switching lists cannot inherit a stale `true` and there is no effect to race. `DraftedReadState` gains `hasRead`, and the decision is now `clearRefusalReason` returning *which* of three refusals it is (`read-failed` / `read-in-flight` / `never-read`), with `canClearDrafted` derived from it. **Aborts are neutral in both directions** — every mark calls `cancelQueries`, so React Query's signal is threaded into the request (`fetchDraftedIds(listId, signal)`) and a cancelled read neither opens the flag (a discarded read must not vouch for marks the cache never received) nor closes it (or two quick marks would refuse the clear for the rest of the session). ⚠️ **Overclaimed at the time, corrected by R199 below:** this round threaded the signal and guarded only the *failure* arm, on the belief that a cancelled read always rejects. It does not — an abort landing after `res.json()` has been entered on a buffered body resolves anyway — so the success arm could still vouch for a discarded read. The sentence is true of the code only *after* R199 made both arms check `signal.aborted`. **Live reproduction, same rig, both directions, real rows and real DELETEs:** with the status-only decision restored → `ROWS BEFORE 2` → forced 500 → optimistic mark (`{status:'success', isError:false, isPending:false, data:['vitest-r195-p3'], dbRows:3}`, the Reviewer's state reproduced exactly) → clear **ran** → **ROWS 0**; with the fix, the identical sequence → clear refused (`never-read`), a second mark and a second attempt → refused again → **ROWS 3**. **Counter-controls, live, both green in both directions:** healthy read + toggle off → 2 → **0**; healthy read + mark + toggle off → 3 → **0** (§4 decision 2 survives). **Probes:** the `hasRead` term deleted from `clearRefusalReason` → **7 RED**; aborts treated as failures → **2 RED**; the signal not threaded into the request → **3 RED**; all reverted → 55/55 |
| **R195 (second half)** — "Reset list" is gated on `draftedCount === 0`, which one optimistic mark re-opens, so **both** destructive controls are live in that state | should-fix | **`list-detail-view.tsx` edited — six lines, in scope.** The hook guard already refuses for both controls, but `handleReset` toasted *"List reset — drafted marks cleared"* unconditionally, so a refused clear still announced success: CLAUDE.md's "nothing happened means it worked", one layer up. `runClearDrafted` (and therefore `clearDrafted`) now returns whether the clear ran, and `handleReset` claims the reset only when the clear was **permitted and issued** (precise wording per R201 — `clearDrafted` returns `true` when the DELETE is dispatched, not when the rows are gone; a DELETE that then fails rolls the cache back and raises its own destructive toast, so the over-claim is timing, not outcome). The Draft-mode toggle is deliberately unchanged: it is a view state, it should still toggle, and the refusal toast is what tells the truth there. Pinned with a brace-balance `arrowBody` slicer over the comment-stripped view source, plus a counter-control that the toggle still calls the clear at all (§4 decision 2). **Probe:** the pre-fix unconditional toast restored → **1 RED**; reverted → 55/55. The whole-file prettier reformat this edit provoked was **reverted** — the file is 80-col legacy and reformatting it would have been a 439-line drive-by |
| **R196** — `callbackBody`'s paren-balance scan is not string- or regex-literal aware | nit | **Documented, not widened** — per the Reviewer's own first option. The JSDoc now states the limitation outright, says it is a text scanner and not a parser, records that no callback here holds a paren-bearing literal today, notes that the failure is loud (the slice stops early and the `toContain` pins redden), and tells the next author to parse it or move the decision out of the callback rather than relax the scan. The new `arrowBody` slicer carries the same caveat in the brace dialect |
| **R197** — the refusal toast said the marks "could not be loaded" in the `isPending` case, blaming a failure that had not happened during an ordinary page load | nit | **Three reasons, three copies, none of them a guess.** `clearRefusalReason` names which state refused, and `CLEAR_REFUSAL_COPY` maps each to its own sentence: *could not be loaded… reload* (failed), *are still loading… try again in a moment* (in flight — no "could not", no "reload"), *have not loaded on this device… reload* (never read). Pinned per branch, including a direct assertion that the in-flight copy does not match `/could not/i` |
| **R198** — the recorded `test:stack` flake family is narrower than what actually flakes | nit | `league-lists-api-db.test.ts` added to the §5 flake-family note, with the Reviewer's measurement (7× 232/232 and one red on 2 tests of a suite this diff does not touch, 3/3 in isolation) and this session's own runs |

### LV.1.4 — 2026-08-09 (PR #109) — verdict **FIX-THEN-MERGE**

*Reviewer session (fresh context, red-team brief) against PR #109 —
`src/stores/list-display-store.ts` + its test — verified against plan v3.3 §4,
**D3** and D4, and the falsifiability floor. **R179–R185: two should-fix, five
nits, no blockers.** The `org` design (`ListOrg | null` + `resolveOrg`) was
explicitly **upheld** as a correct engineering judgement needing no ruling.*

***The finding that mattered:** the whole point of LV.1.4 was that D3 be
*guarded*, and the guard did not hold. Its `beforeEach` stubbed `localStorage`
and `sessionStorage` on `globalThis` but never `window` — and vitest runs on the
node environment, where `typeof window === 'undefined'`. So the house SSR idiom,
which is exactly what `src/hooks/use-draft-mode.ts:19` uses, took its early
return under test and the spies never fired. The Reviewer put a real
`window['local' + 'Storage'].setItem(...)` in `setView` and the suite reported
**18 passed (18)** — reproduced here before fixing anything. A store that
persisted `view` in every real browser shipped with all four detectors green,
and the PR's stated backstop ("the runtime spies are the backstop") was false.
A second variant was invisible for a different reason: `exerciseEveryMutator`
called `reset(LIST_B)` on a list that had never been set, so `reset`'s early
return ran and its real body never did.*

#### Resolution — 2026-08-09 (Builder, same branch `feat/LV.1.4-session-display-state`)

*All seven addressed on the same branch; nothing deferred, nothing escalated.
Both should-fixes **shown falsifiable** — the pin reddens under the exact break
it exists to catch, then reverted. `test:unit` **42 files / 694 tests** (baseline
692; +2). Type-check clean, lint exit 0 (only the pre-existing
`auction-draft-room.tsx:105` warning), prettier clean.*

| Finding | Severity | Resolved by |
| --- | --- | --- |
| **R179** — the D3 guard is fully defeated by persistence written in this codebase's own SSR-safe idiom; `reset`'s real body was never exercised | should-fix | **Three changes, each independently probed.** (a) the D3 `beforeEach` now also `vi.stubGlobal('window', { localStorage, sessionStorage })`, putting the guard on the side of the branch that actually writes; (b) `window` and `globalThis` joined the banned-token list, because a computed key (`w['local' + 'Storage']`) names none of the existing tokens; (c) `exerciseEveryMutator` seeds `LIST_B` with `setView` before `reset(LIST_B)`, and asserts the entry exists **and then does not**, so the seeding cannot rot back into a no-op silently. **Probes:** the Reviewer's exact `setView` probe on the *unfixed* test → **18/18 green** (hole reproduced); the same probe against the hardened test → **2 RED** — the runtime storage spy **and** the source pin, so the layers really are complementary; reverted → 18 green. Then, isolating (c): the same idiom inside `reset`'s post-guard body → **2 RED** with the seeding in place, but **1 RED** (source pin only, spy green) with the seeding removed — which is the direct measurement that seeding `LIST_B` is what makes `reset` observable at all |
| **R180** — `setCols`, `toggleCol` and `setBandLabel` allocate a new `ListDisplay` on value-identical writes; PROGRESS's "pinned by a reference-identity test" covered only the selector's read path | should-fix | **One structural-equality gate in the shared `update` helper**, rather than three separate short-circuits: `sameDisplay` compares `cols` element-wise and `bandLabels` key-for-key, and `update` returns the state untouched when nothing changed. Chosen over per-mutator checks because it cannot be forgotten by a mutator added later — and the now-redundant `current.view === view` / `clamped === current.budget` checks were **deleted**, so there is exactly one mechanism and one test pinning it. Guards carrying meaning beyond equality stayed (unknown stat, non-finite number). New test **`every mutator hands back the same object on a value-identical write`** issues one no-op write per mutator and asserts `toBe` identity, plus a coverage assertion that the mutator surface is exactly the eight named — so a ninth mutator fails until it gets a line. `toggleCol` is called out in the test as the one mutator with **no** value-identical input by construction; its round trip is two genuine changes and correctly notifies twice. **Probes:** gate removed → **1 RED** (`serializes to the same string`, i.e. equal-but-new, the exact bug); `cols` compared by reference instead of element-wise → **1 RED**; `bandLabels` compared by reference instead of key-for-key → **1 RED**; all reverted → green. The two partial probes matter because `dedupe` always allocates, so a reference comparison would have looked like a gate and gated nothing |
| **R181** — `resolveBandLabel` uses a plain-object `Record` as a map, so a prototype-named key violates its declared `: string` return and `setBandLabel` silently discards a `__proto__` rename | nit | **Both halves fixed, because they fail differently.** `DEFAULT_LIST_DISPLAY.bandLabels` and every copy `setBandLabel` makes are now built with `Object.create(null)` (new `copyLabels` helper), so a `__proto__` rename is an ordinary own property; and `resolveBandLabel` reads through `Object.prototype.hasOwnProperty.call`, so it is correct for **any** caller-supplied record and not only the store's own. New test pins `resolveBandLabel('constructor', {}) === 'constructor'`, a `__proto__` rename round-tripping through store → selector → resolver, and the null prototype itself. **Probe:** both reverted to the plain-object idiom → **1 RED**; restored → green. Reachability rises at LV.1.5, which is now flagged on that checklist row (R183) |
| **R182** — `moveCol`'s doc says "clamped", but a non-finite `toIndex` is not clamped and silently moves the stat to the front | nit | `if (!Number.isFinite(toIndex)) return current`, placed and commented as the deliberate twin of `setBudget`'s NaN refusal — decline the write, keep the state, rather than return a plausible-looking wrong answer (CLAUDE.md's "never let 'nothing happened' mean 'it worked'", in its inverse form). The `moveCol` JSDoc now says "refused", not "clamped". Pinned in the existing `moveCol` test for both `NaN` and `Infinity`. **Probe:** guard removed → **2 RED** (the `moveCol` test and R180's identity test); restored → green |
| **R183** — the `c1`–`c4` / LV.1.5 reconciliation pointer lived only in the store's JSDoc and PROGRESS §4, neither of which the LV.1.5 Builder reads for its task text | nit | Clause added to the **LV.1.5 checklist row in §2** naming `DEFAULT_COST_BANDS` and the file it lives in, stating that LV.1.4's keys are session-local and not on the wire, and that LV.1.5 owns what the route accepts. The row also now records the consequence R181 turns on: widening the enum makes bucket keys DB-sourced free text |
| **R184** — the header says "Six other stores … wrap themselves in `persist`"; there are **seven** (`ui-store` omitted), and the miscount was inherited verbatim from delivery-plan §2 | nit | Fixed in **both** places. Plan bumped to **v3.4** with a changelog entry — the count is load-bearing for D3's argument ("every other store persists, this one deliberately does not"), so an undercount weakens the case the store header makes to its next reader, which is precisely what happened. §2 now also records how to check it: `grep -ln "persist(" src/stores/*.ts`. Store header and §4 above corrected to seven, with `ui-store` named |
| **R185** — `budget` is held per D3 but has no renderable meaning under D4, and the tension is recorded nowhere the tasks that hit it will look | nit (plan-level) | **Recorded, not resolved** — per the Reviewer's own disposition and because resolving it is a product call. Full note added to **§2** with the prototype citations (`ListsBody.jsx:109`, `lists.js:440-455`, and `b1`–`b4` at `lists.js:442-445`), plus ⚠️ pointers on the **LV.3.3** and **LV.3.5** checklist rows and a changelog paragraph in plan v3.4. The note says explicitly that the wrong fix is reintroducing a per-player `cost` field (D4 rejects it), and instructs whoever reaches it to **file in §3 and HALT** rather than invent default band labels |

**Not changed, and why:** the `org` design — `ListOrg | null` plus `resolveOrg`,
so a session with no opinion defers to `lists.ranking_mode` — the Reviewer
upheld it and asked for no change. `toggleCol` kept its allocate-always body: it
adds or removes exactly one stat, so it has no value-identical input, and the
`update` gate covers it structurally anyway.

#### Re-review — 2026-08-09 (fresh Reviewer, fix diff `27681e8`) — **VERDICT: CLEAN**

*Gates re-run independently: type-check clean · lint exit 0 · `test:unit` **42 / 694** ·
`share-link-permanence.test.ts` 6/6 · 4 files touched, no migration/schema/route ·
`use-draft-mode.ts` and all board surfaces untouched.*

*R179 confirmed genuinely discharged — the Reviewer reconstructed `f613660`'s exact
state, planted the SSR-idiom write, and reproduced **18/18 green** (the original hole,
independently), then showed the same probe gives **2 RED** on the fix through two
independent layers. It isolated the `reset` seeding claim by measuring the delta (3 RED
with seeding, 2 RED without — the difference being exactly the runtime spy), proving
`reset`'s body was previously unobservable.*

***The guard is behavioural, not name-matching*** *— the decisive probe: persistence
planted in a **separate module** (`window.localStorage.setItem` behind the SSR guard)
with **zero banned tokens in the store file**, caught by the runtime spy alone. That is
the property that matters; the source pin is the belt, not the braces.*

*R180's centralised gate judged a **strengthening** that strictly dominates the two
short-circuits it replaced; no consumer depends on entry presence. R182's `Infinity`
no-op judged correct — `moveCol(id, stat, cols.length)`, the normal insert-at-end
convention, still clamps, so LV.3.7 loses nothing.*

Four nits recorded, **not fixed**:

| Finding | Severity | Disposition |
| --- | --- | --- |
| **R186** — the "consequence worth knowing" note (store `:194`, PROGRESS `:301`) is false for a list customised then written back to defaults: the `byList` entry survives and the selector returns an equal-but-distinct object, not the frozen default. Case A was already true at `f613660`, so the sentence overstates what changed. The suite's own `toBe(DEFAULT_LIST_DISPLAY)` idiom invites a consumer to use reference equality as "is this list customised?", which **LV.3.2's segmented control would silently break on the first toggle-back** | nit | **Open — read before LV.3.2.** Either narrow the wording to "never customised", or make it true by dropping the entry in `update` when it equals the default. Pin whichever |
| **R187** — R184's anti-recurrence grep is quoted with the wrong glob in two of three places (`src/stores/*.ts` returns **8**, matching the test file's deliberate `persist` control; `src/stores/*-store.ts` returns the 7 it claims) | nit | **Open.** Fix at plan `:348` and PROGRESS `:566` |
| **R188** — PROGRESS `:338` heading cites R181; the passage is entirely R179 (R181 is the prototype-key finding at §4 item 6) | nit | **Open.** Retitle to R179 |
| **R189** — residual tail: a guarded write through an **unstubbed** alias (`self`, typed by lib.dom) escapes both the spies and the substring source pin — `20 passed`, `tsc` clean. Judged the obfuscation tail, not the realistic failure mode | nit | **Open.** Add `self` to the `vi.stubGlobal` set and the banned-token list — one line each |

#### Final re-review — 2026-08-09 (fresh Reviewer, fix diff `e94aa45`) — **VERDICT: CLEAN, but two SHOULD-FIX open**

*Gates re-run independently: type-check clean · lint exit 0 · `test:unit` **43 / 749** ·
`drafted-api-db` 32/32 ×3 · pgTAP 028 alone 49/49 · `test:stack` ×4 with two reds, both
in the §5 leagues flake family and both green in isolation. All five of the round-2
Builder's break probes reproduced at the exact claimed counts.*

**The class that consumed both fix rounds is demonstrably closed.** The Reviewer built an
independent live rig, proved it reaches the bug (pre-fix guard restored → real rows
destroyed), then showed the fix refuses over an optimistic mark on a failed read with
rows intact, and that both honest counter-controls still clear. It attacked six paths
neither prior round covered — successful-read-then-failed-refetch, listId switching,
in-flight mark, external `invalidateQueries`, mutation-error rollback, SSR first paint.

**Orchestrator decision (2026-08-09): NOT merged.** The verdict is CLEAN and the merge
conditions are formally met, but R199 is a residual path to the same permanent
cross-device data loss that consumed two fix rounds. Merging a known data-loss race —
however remote — when the fix is a one-line symmetry change is the wrong call. Two fix
rounds are spent, so per the house rule this goes to Chris rather than a third round.

**Chris authorised a third and final fix round (2026-08-10), scoped to R199–R202 only.**
All four are resolved on this branch — see the Disposition column. Two things the round
found that the findings had not: the R202 defect was **two** unscoped counts in 028, not
one (`:273` as well as `:441`), and the literal module-scoped singleton R200 proposed
would have half-fixed itself (`A → B → back to A` re-breaks it), so the flag is keyed
per list and scoped per QueryClient instead. Round-3 gates: type-check clean · lint
exit 0 (1 pre-existing warning, `auction-draft-room.tsx`) · `test:unit` **43 files /
763** · `test:stack` **×11 — 7 clean at 232/232, 4 red**, each on a *different* member
of the §5 leagues flake family (`draft-tick-db`, `draft-realtime-db`,
`draft-commish-api-db`, `members-api-db`), **every one green in isolation** (1/1, 2/2,
13/13, 19/19) and none of them touched by this diff · `test:gate` 24/24 · pgTAP 028
**49/49** alone, and 49/49 with foreign rows deliberately held. `npm run test:db`
remains red for the pre-existing §5 backend-crash reason, re-confirmed this session by
A/B on `main`.

| Finding | Severity | Disposition |
| --- | --- | --- |
| **R199** — `use-draft-mode.ts:351-364`: the `queryFn`'s **success** arm calls `signals.landed(listId)` without checking `signal.aborted`, while the catch arm *is* guarded. A read resolving after `cancelQueries` discarded it therefore vouches for marks the cache never received. Live rig: in-flight read → mark (aborts it) → response resolves anyway → clear permitted → **rows destroyed, never shown**. Measured window ~0.088 ms avg / 0.60 ms max of a ~42 ms read (~0.2%), and loss additionally needs the clear to beat the follow-up refetch — so incidence is remote, but the path is real. Three docs assert the property this violates | **should-fix** | **RESOLVED (round 3, PR #112).** The arms are symmetric: `if (!signal.aborted) signals?.landed(listId)`. **Live rig, real rows, both directions** — a localhost HTTP server delegating to the shipped `drafted-service.ts`, with the response bytes buffered off the wire *before* the abort and handed to `jsonOrThrow` *after* it (the window's physics, reproduced deterministically instead of raced). Pre-fix: `{dbBefore:['vitest-rvw-p1','vitest-rvw-p2'], responseTheReadCarried:['p1','p2'], cacheData:['vitest-rvw-p3'], hasRead:true, refusal:null, clearRan:true}` → **`dbAfter: []`**, three real rows destroyed, two of them never shown. With the fix, byte-identical sequence: `hasRead:false, refusal:'never-read', clearRan:false` → **`dbAfter: ['p1','p2','p3']`**. **Pinned two ways** — a behavioural test driving a real `QueryObserver` over a `fetch` that ignores the abort and resolves anyway, plus its counter-control (the same late read, *un*-cancelled, DOES open the flag, so the rig is not just a read that never completes); and a source pin that matches **every** raise of `landed`/`failed` with its line and requires the guard on each, so an unguarded one re-introduced anywhere reddens it rather than the pin being satisfied by the guarded call that remains. **Probe:** guard removed → **2 RED** (`hasRead` expected false, got true; + the source pin); reverted → 69/69. The three overclaiming doc passages named in the finding (`:124` "a cancelled read rejects", the catch-arm comment, `DraftedReadState.hasRead`) are corrected to what the code does, and the header carries an R199 paragraph |
| **R200** — `use-draft-mode.ts:416-418`: `hasRead` lives in a per-**mount** `useRef`, but the cached read outlives the mount (`staleTime: 60_000`). Remounting inside 60 s renders the real marks while `hasRead` is false, so the clear refuses with copy that contradicts the screen — the exact failure mode R197 was filed to eliminate. Reachable by ordinary navigation. **Not** data loss, not permanent | **should-fix** | **RESOLVED (round 3, PR #112).** The flag now has the cache's lifetime: `readLandedFlagFor(client)`, one flag per **QueryClient**, held in a module-scoped `WeakMap`. Two deliberate departures from the literal "module-scoped singleton" the finding proposed, both because the singleton is not quite enough: (a) it is **keyed per list** (a `Set`, not one slot) — a single slot fixes `A → back to A` but re-breaks `A → B → back to A` inside `staleTime`, R200's own symptom by a second route; (b) it hangs off the **client**, not the module, so `QueryProvider`'s per-request client on the server cannot share one visitor's landings with another's. **Every route back to `false` is pinned**: list switch (the keying), read failure (`signals.failed`, R195's rule unchanged), cancellation (R199), and — the hazard a longer-lived flag introduces — **the cache entry going away**, via a `QueryCache` subscription that drops the landing on `removed` (gc after `gcTime`, `removeQueries`, and `clear()` — the wipe a future sign-out cache reset would perform). Without that last one a cache collected while the user was elsewhere would leave `hasRead` true over an *empty* cache, and one optimistic mark on the way back forges the status: R195 by the back door. **Live rig, real rows:** pre-fix remount → `{renderedMarks:['vitest-rvw-p1','vitest-rvw-p2'], dbRows:[same], hasRead:false, refusal:'never-read', canClear:false, fetchCalls:1}` — the Reviewer's measurement reproduced exactly, `fetchCalls:1` confirming `refetchOnMount` never reopens it; with the fix, same sequence → `hasRead:true, refusal:null, clearRan:true`, rows 2 → **0**. **Probes:** the per-client cache made to miss → **2 RED**; the cache-removal subscription made a no-op → **2 RED**; both reverted → 69/69. The `staleTime` the finding turns on is itself pinned against `query-provider.tsx`, so the rig cannot drift into testing fiction |
| **R201** — `list-detail-view.tsx:339-343`: `clearDrafted()` returns `true` when the DELETE is *issued*, not when it succeeds, so the success toast can precede a failing DELETE. Standard optimistic-UI behavior, but §6's "claims the reset only when it did" reads stronger than the code guarantees | nit | **RESOLVED by rewording (round 3)** — the Reviewer's first option, chosen because moving the toast into `onSuccess` would trade an optimistic surface CLAUDE.md endorses for a slower one and change LV.3.9's contract. The R195 second-half row below now says **"claims the reset only when the clear was permitted and issued"**, and the comment at `list-detail-view.tsx` states the same, plus the fact that makes it safe: a DELETE that then fails is **not** silent — the mutation rolls the cache back, the marks reappear, and the hook raises its own destructive *"Could not update drafted"* toast. What the toast over-claims is timing, not outcome |
| **R202** — `supabase/tests/028_list_player_drafted.sql:441` (LV.1.2's file, unmodified here): the final assertion counts **all** rows in `list_player_drafted`, so 028 reports a false red whenever another suite holds rows — including the `test:stack` run §5 tells you to run. Verified: concurrent → `not ok 47 … have: 8 want: 5`; alone immediately after → 49/49 | nit | **RESOLVED (round 3, PR #112) — and it was TWO assertions, not one.** Reproducing it deterministically (3 committed rows held for a user outside 028's fixture set, instead of racing a `test:stack` run) reddened **both** privileged unscoped counts: the epilogue at `:441` (`have: 8 want: 5` — the Reviewer's exact numbers) **and** `:273`, the section-C total-rows guard (`have: 6 want: 3`), which the finding did not name. Both are now scoped to the suite's own three `user_id`s, as the surrounding assertions already were; the other counts in the file run under RLS as a suite user or under a suite-specific `player_id`, so they were never exposed. **Both directions shown:** unscoped + 3 foreign rows → `Failed 2/49`; scoped + the *same* 3 foreign rows still held → **49/49**; holder removed, alone → **49/49**. Editing a SQL **test** fixture is not a schema change — migration 079 is untouched |

#### Round-3 verification — 2026-08-10 (fresh Reviewer, diff `e94aa45..67c4c28`) — **VERDICT: FIX-THEN-MERGE**

*Gates re-run independently: type-check clean · lint exit 0 · `test:unit` **43 / 763** ·
`test:gate` 24/24 · pgTAP 028 49/49 alone **and** with foreign rows held · `test:stack` ×6,
one red in the §5 leagues flake family. Scope clean — 5 files, no migration edit, no
schema, no new route, nothing off-limits.*

**R199 and R200 are genuinely closed.** The Reviewer added an *extra unguarded* raise of
`landed` elsewhere in the `queryFn` → **3 RED**, proving the pin is not
substring-satisfiable. It independently exercised R200's other routes: 50 calls to
`readLandedFlagFor` → **1** cache listener (no accumulation), gc / `clear()` /
`removeQueries` each drain a landing, a foreign key's removal does not, two clients never
share a flag, and an optimistic `setQueryData` with no read never opens one. All four
counter-controls green.

| Finding | Severity | Disposition |
| --- | --- | --- |
| **R203** — `use-draft-mode.ts:435-439`: the `QueryCache` subscription forgets a landing on **any** `removed` event carrying a drafted key, including a *stale* query object destroyed while a live entry at the same key still holds the data (`query-core` deletes only when `queryInMap === query` but notifies either way). Production route: a failed mark's `rollback(undefined)` calls `removeQueries` on a mounted query; the rebuild moves the observer off `q1`, the refetch lands, and `gcTime` later `q1`'s gc **silently flips `hasRead` to false over a live cache** — the clear is then refused with "have not loaded on this device" while the marks are on screen. **Not data loss**; self-heals on the next mark or reload. Falsifies this round's own claim that "every route back to `false` is pinned" | **should-fix** | **Open.** Fix direction: forget only when the key has no entry left — `if (listId !== null && !client.getQueryCache().get(event.query.queryHash)) flag.forget(listId)` |
| **R204** — §5's crasher list was promoted 9 → 10 by adding `025`; **factually wrong** | should-fix | ✅ **FIXED 2026-08-10 (orchestrator).** Verified directly rather than adjudicated: 025 returns `Wstat: 0, Tests: 120, Failed: 2` — whole plan runs, backend survives — and contains **zero** `set local role anon`. §5 restored to 9, with 025's two real failures (tests 46, 79) recorded as **M2 work, not waived** |
| **R205** — the `test:stack` flake family is one member short; `draft-core-db` went red 1 of 6 runs, green 3/3 in isolation, untouched by this diff | nit | Open. Add `draft-core-db` to the §5 family note |
| **R206** — nothing in the flag machinery is user-scoped; a landing survives `signOut()` because `use-auth.ts` never clears the `QueryClient`. **Not reachable today** — every sign-in path is a hard navigation that tears the client down — but the code comment already anticipates a sign-out reset that does not exist | nit | Open. One line of insurance: `qc.clear()` in `signOut()` |

---

### Ruling — 2026-08-10: the drafted interaction, and why it closes four findings

Chris settled how drafted actually works, and it dissolves the bug class that
consumed three fix rounds rather than guarding against it:

> *"No longer will the user have to turn on 'draft mode' within a list to check
> players off as drafted, the default mode of any list is that the user can
> click that box and the player will take on the 'drafted' appearance. We can
> delete the existing 3-state cycle."*

**The handoff already agreed** — verified, not assumed: side-by-side rows carry
a *permanent* drafted checkbox (§"Side by side"), card view shows it on hover
and keeps it once drafted (§"Cards"), the row menu **omits** "Mark drafted"
because the checkbox covers it (§"Cards"), and drafted renders as a visual
treatment (`--surface-sunken` recessed row; 45% dim in the pop-out). **There is
no draft-mode gate anywhere in the design.** The v1 toggle was never in it.

**What this changes**

1. **A view control must never delete.** `list-detail-view.tsx`'s Draft-mode
   toggle called `clearDrafted()` on toggle-off. That is the single gesture
   **R190, R195, R199 and R203 all orbited** — four findings, three fix rounds,
   one root cause. Removed at LV.1.3 (2026-08-10); deleting is now only ever
   explicit, via "Reset list", which keeps the read guard. The old pin
   asserting the toggle *does* clear was inverted, and shown falsifiable:
   restoring the destructive line reddens it, reverting turns it green.
2. **`use-board-marks.ts` is deleted, not preserved** — scheduled with LV.4.4,
   under §1's boards amendment.
3. **The old and new side-by-side are different surfaces.** Worth recording
   because it was mis-stated during LV.1.3: the *old* `/app/lists/draft-mode`
   **cannot mark drafted at all.** `board-column.tsx:35` only *reads*
   `useDraftMode(list.id)` for the strikethrough and the "N drafted" count;
   its taps write the separate browser-only 3-state. So the surface most likely
   to be used on draft night is the one that never persisted — and the *new*
   side-by-side (Round 2) fixes that by carrying the real checkbox.

---

### LV.12 — 2026-08-11 (PR #133) — verdict **FIX-THEN-MERGE**

*Reviewer session (fresh context, red-team brief) against PR #133 — the Side by
side picker and the plan erratum it folds — verified against plan v5.1 §1/§6,
D3, D11, D12, the design LAW's* Picker *bullet and the ×0.8 rule.* **The erratum
was independently re-derived and upheld**: *the Reviewer read
`ListsScreen.jsx:431` and `:49` itself, counted the **9** cards in
`screens/side-by-side-picker.png`, and reproduced the tab-filter break probe.
It also confirmed the schema budget untouched (no migration, no column, no new
route), elevation correct (no resting shadow; selected carried by fill/border),
D3 held (session-only), and every ×0.8 conversion. None of that is re-opened
here.* **R207–R212: two should-fix, four nits, no blockers.**

***The finding that mattered (R208), and it is a rule this repo already
owns.*** *The picker's whole reason for existing after the erratum is that a
**saved** list appears whatever the tab says. The verifying account had
favourited nothing, so `[...mine, ...saved]` was `[...mine, []]` in **every**
run: the headline behaviour was never exercised once, and a build that dropped
saved lists entirely would have produced identical evidence. The tests passed
over an empty array and proved nothing — CLAUDE.md's* "never let 'nothing
happened' mean 'it worked'" *applied to a verification rather than a query. The
source pin was genuine (reinstating the filter → 1 red), which is what kept it a
should-fix instead of a blocker.*

#### Resolution — 2026-08-11 (fix Builder, same branch `feat/LV12-side-by-side-picker`)

*Both should-fix resolved, both nits marked for action applied, and the two
nits the review directed **away** from this PR filed instead of absorbed.
Proof re-run this session:* **`type-check` clean · `lint` exit 0** *(the one
pre-existing `auction-draft-room.tsx:107` warning)* **· `test:unit` 54 files /
966 tests** *(962 → 966: the four R208 pins).* `settings-round-trip-db.test.ts`
*is the known §5 leagues parallel-race flake, outside `test:unit`, and was not
chased.*

| Finding | Severity | Resolved by |
| --- | --- | --- |
| **R207** — browser verification ran against **hosted production**, undisclosed in both the PR and PROGRESS; seven `LV12 tmp` lists are now permanently soft-deleted in the real project | should-fix | **Re-verified against the local stack, and the environment is now evidence rather than a claim.** The gitignored `.claude/launch.json` config **`dev-local`** (port 3123) pins `NEXT_PUBLIC_SUPABASE_URL` to `http://127.0.0.1:54321`; the browser's network log shows `GET http://127.0.0.1:54321/auth/v1/user → 200` and the profile read for `11111111-…`, the local dev user. **The seven hosted rows are deliberately left alone** — Key Business Rule 8 forbids hard-deleting lists, they are already correctly soft-deleted, and destroying them to tidy up a process failure would break a standing rule to hide a mistake. Recorded instead: owner `b8e85002`, created 2026-08-12 05:11–05:12 UTC, all `deleted_at` set; no live row leaked, no seed file touched, nothing hosted schema-changed. Disclosed in §4 item 5 **and** in the PR body. The durable form is in **`ACTIVE-BUILD.md`'s standing constraints** — where the next Builder reads it before starting, rather than only in a §4 entry it might not reach |
| **R208** — the erratum's headline behaviour (a **saved** list appearing regardless of the active tab) was never exercised: the verifying account has zero saved lists, so the `saved` half was empty in every run | should-fix | **Shown live against the local stack, both directions, and pinned.** A list owned by a *second* account (`dev-pro@fieldscout.local`) was seeded into the local DB only, favourited through the shipped `POST /api/lists/[id]/favorite` → `200 {"is_favorited":true}`, and then: with the tab verified on **My lists** (`aria-pressed="true"`, `My lists 2` / `Saved 1`) the picker offered **3** cards including `LV12 local fixture — dev-pro's WR room, 6 players`; on **Saved** it still offered all 3; the saved list *committed* (`Show 2 lists side by side` → *"2 lists ready to compare — LV12 local fixture — dev-pro's WR room · Consensus WR top 10"*); and the tab was still `My lists` on the way back out. Zero console errors. **Four new source pins (13 → 17 tests)** cover the chain that makes a saved list exist — the route's `list_favorites` read, its `.neq('owner_id', user.id)` fetch, the `owner` attachment, the page's `saved: all.filter(…Boolean(list.owner))` — plus `lists.map` with no filter. **Three probes, 1 red each, all reverted to 17/17**: `owner: null` (also shown live degrading to `My lists 3 / Saved 0` — the saved half empty forever), `.in('id', [])`, and `saved: []` — the last being *literally* the condition the original verification ran under. Stated in the test file and in §4: a source pin cannot observe an empty array at runtime; the live evidence is what carries that half |
| **R209** — plan §6's LV.13 row does not carry the "delete `ComparisonPending`" obligation, though four other places do — and §6's row is what `ACTIVE-BUILD.md` names as the task text | nit | ✅ **Applied.** Plan → **v5.2**: the LV.13 row now ends *"and **`ComparisonPending` in `lists-page-v2.tsx` is deleted** — LV.12 shipped it as an explicitly temporary branch and this row is where it goes"*, with a changelog entry saying why an obligation that lives everywhere except the line the Builder is pointed at is an obligation that gets missed. §2b's LV.13 bullet cross-references it |
| **R210** — `ACTIVE-BUILD.md:39` still points task text at delivery plan **§4**; Round 2's tasks are **§6**. Pre-existing (Round 2 commit `85200b8`), not from this diff, but it can misroute LV.13's Builder | nit | ✅ **Applied.** The row now reads *"**Round 2 (LV.12 – LV.17): delivery plan §6.**"* and says outright that §4 was Round 1's, so a reader who half-remembers the old pointer sees the correction rather than a bare change |
| **R211** — `side-by-side-picker.tsx:172`'s `aria-label` announces `"Favorites, 1 players"`; `N players` is unpluralised across four shipped v2 surfaces, matching the prototype, so not a regression | nit | **Filed, not fixed — as directed.** §5 **F-LV12.1**, in the F-format the LV.7 follow-ups use. The filing adds one fact the finding did not have: `list-detail-hero.tsx:178` **already pluralises correctly**, so the app contradicts itself and a sweep has a house form to adopt. Fixing only the picker would have made that worse |
| **R212** — the picker has no search, filter or cap, so a large account gets an unbounded grid; the design package does not cover it and the erratum does not create it | nit | **Filed as a design question — §3 Q4, open.** Four options with costs and risks, recommending **A now** (non-problem for the 2026 friends cohort) **and B when LV.13 lands** (cap the *comparison*, never the rendered set), with C (invent a search field) and D (truncate the grid) explicitly reserved for Chris. The entry says in its own text that **a Builder must not build a search or a cap on the strength of it**. Filed before LV.13 deliberately: the picker degrades gently (a taller grid), the 300px-column scroller does not |

**Not changed, and why.** The picker's behaviour, the erratum, the plan §6 row
for LV.12, `ComparisonPending`, and every ×0.8 conversion are untouched — the
review upheld all of them, and this round is evidence and documentation, not a
second bite at a landed design. The one code change is
`side-by-side-picker.test.ts` (+4 tests); the one source file touched otherwise
is none.

#### Second review pass — 2026-08-11 (R213–R216, same branch, same PR #133)

*A **second** Reviewer, fresh context, re-verified the round above and confirmed
it independently: only test and doc files changed, the schema budget untouched,
the verification genuinely local, no hosted URL or key leaked, the seven hosted
rows soft-deleted (not hard-deleted, per Key Business Rule 8), the local fixture
real and RLS-readable, and the proof chain honest.* **R207–R212 are closed and
are not re-opened here. R213–R216: one should-fix, three nits, no blockers.**

***The finding that mattered (R213) — the R208 pins guard the chain's shape and
not its two field selections.*** *R208 was filed because a green suite proved
nothing over an empty `saved`. Its four new pins cover the `.neq`, the
concatenation and the `owner:` ternary — but **not** the `owner:profiles!owner_id`
embed those depend on. The Reviewer trimmed that embed out of `ownedSelect` and
the entire gate stayed green: picker suite 17/17, `test:unit` 966, `type-check`
exit 0 — while `saved` became `[]` for every user forever and the saved list was
misfiled into `mine`, the identical live degradation R208 recorded as*
`My lists 3 / Saved 0`. *The second unpinned selection,* `.select('list_id')`,
*reproduces it identically. The severity is about likelihood, in the Reviewer's
words:* "nobody accidentally rewrites the `owner:` ternary, but trimming a
`select('*')` embed for payload size is routine."

| Finding | Severity | Resolved by |
| --- | --- | --- |
| **R213** — the R208 pin set leaves both of the chain's **field selections** unpinned, so the exact defect R208 was filed for still recurs silently through a fully green gate (both breaks shown by the Reviewer at 17/17 green) | should-fix | ✅ **Pinned, and the pin shown failing — twice.** One new `it` in `side-by-side-picker.test.ts` (**17 → 18**) carries *both* assertions, the prescribed one and the optional one: `toContain('owner:profiles!owner_id')` and `toContain("select('list_id')")`. **Probe A** — drop the owner embed from `ownedSelect` (`route.ts:59-60`) → **1 red, at the exact new line**, 17 passed; reverted → 18/18, `git diff` on `route.ts` empty. **Probe B** — `.select('list_id')` → `.select('id')` (`route.ts:48`) → **1 red**, 17 passed; reverted → 18/18, diff empty. **Probe A was then re-run a third time with R214's comment in place**, because that comment quotes the literal `owner:profiles!owner_id` the assertion matches: still **1 red**, which proves the `code()` comment-stripper — not luck — is what keeps the pin honest. A pin never observed failing is the class of thing R208 was about |
| **R214** — the comment above the `owner` attachment (`route.ts:119-121`) describes it as sidebar decoration when it is the **sole classification key** for `saved`, which is what would license R213's regression | nit | ✅ **Applied — comment only, behaviour untouched** (the `route.ts` diff is six comment lines and nothing else; shown in the PR). It now names `lists-page-v2.tsx:146`'s `Boolean(list.owner)` split as the second, load-bearing consumer, names the Saved tab *and* the picker's saved half, and says what dropping either the field or its embed costs: *"Saved is empty for every user, forever, with no error anywhere"* |
| **R215** — the deliberately-retained local fixture and its re-creation instructions live only in §4's evidence table, not in `ACTIVE-BUILD.md`'s standing constraints — the same placement argument R207 made, applied inconsistently to R207's own round's artefact | nit | ✅ **Applied.** One bullet in `ACTIVE-BUILD.md`'s standing constraints, directly beside the R207 local-stack note: what the fixture is, that `supabase db reset` destroys it, how to re-create it (public list on `dev-pro`, favourited as `dev@` through the shipped favorite route), and the consequence of skipping it — *the verification reproduces R208 exactly while looking green*. Points back to §4 item 6 for the detail rather than duplicating it |
| **R216** — §3 Q4's recommendation line reads as reserving only C and D for Chris, though B is "cap the comparison" and the entry closes by prohibiting a Builder from building a search, a cap **or** a truncation on its strength | nit | ✅ **Applied, exactly as prescribed and no further.** The line now reads *"A now, B when LV.13 lands, and **never B, C or D** without Chris."* **Q4's status stays 🟡 OPEN** — it still needs a Chris ruling before LV.13 builds columns, and nothing in this round pre-empts that. R212's own row above is left as written: it is the record of what was filed at the time, not a live instruction |

**Not changed, and why (second pass).** No behaviour, anywhere. The schema
budget is still the ruled three; no migration, no column, no new route; boards
untouched; D3 selection still session-only; D11 composition unchanged. `route.ts`
received a comment and nothing else. **No browser verification was run this
round and none is claimed** — nothing user-visible changed, and the honest local
evidence for the picker remains the R208 run in §4 item 6.

---

### LV.13 — 2026-08-11 (PR #134) — verdict **FIX-THEN-MERGE**

*Reviewer session (fresh context, red-team brief) against PR #134 — the Side by
side columns and the two rulings that sized them — verified against plan v5.3
§1/§6, D3, D11, D12, D14, the design LAW's* Columns *bullets and the ×0.8 rule.*
**A great deal was re-verified independently and is not re-opened**: the shared
extraction is safe (`rankMap` a byte-identical move; `bucketHeading` genuinely
new, not moved; both surfaces exercised in one session with the panel rendering
value-only `1·2·3·4` while the column renders `Round 1…`), no fan-out (re-proved
live — one DB row), the full-bleed probe to the pixel, D11 composition real, the
schema budget untouched, boards untouched, elevation correct, the verification
genuinely local, and `type-check` / `lint` / `test:unit` **994** green. *The
Reviewer also ran five falsifiability probes of its own, each red-then-reverted.*
**R217–R223: four should-fix, three nits, no blockers.**

***The finding that mattered (R218) — the pin two documents cite as making
Chris's ruling un-re-addable missed the spelling a developer would actually
use.*** *`side-by-side-columns.test.ts` forbade `(sm|md|lg|xl):flex-col` — the
**desktop-first** spelling. The Reviewer changed the scroller to
`-mx-4 flex flex-col lg:flex-row items-start`, which is the standard
**mobile-first** way to stack on small screens and exactly the stacking D14
forbids, and the suite stayed* **21 passed, green**. *The width half was
genuinely falsifiable (`lg:w-full` → 1 red), so this was a half-built guard
rather than an absent one — but PROGRESS §3 Q4 and plan D14 both said "no
stacking… Pinned by `side-by-side-columns.test.ts`", which **overstated** it.
The reason it is a should-fix and not a nit is social, not technical: Chris ruled*
"id say leave the phone version as is" *and was told the ruling was pinned. **A
guard that misses the obvious spelling is worse than no guard, because it is
documented as protection.***

#### Resolution — 2026-08-12 (fix Builder, same branch `feat/LV13-side-by-side-columns`)

*All four should-fix and all three nits resolved on the same branch; nothing
deferred, nothing escalated, and* **no behaviour changed anywhere** *— the one
source file edited outside tests and docs received JSDoc and a comment.*
*Proof re-run this session:* **`type-check` clean · `lint` exit 0** *(the one
pre-existing `auction-draft-room.tsx:107` warning) ·* **`test:unit` 55 files /
995 tests** *(994 → 995: R218's added pin).* `settings-round-trip-db.test.ts`
*is the known §5 leagues parallel-race flake, outside `test:unit` and in the
paused build — not chased.*

| Finding | Severity | Resolved by |
| --- | --- | --- |
| **R218** — the no-stacking pin catches only the desktop-first spelling; the Reviewer's mobile-first `flex flex-col lg:flex-row` probe — the stacking D14 forbids — left the suite 21/21 **green**, while two documents cite the pin as what makes the ruling un-re-addable | should-fix | ✅ **Widened, and shown failing three times before being trusted.** The old one-line assertion is split into its own `it` (**21 → 22**) forbidding a breakpoint flex-direction change **in either direction** — `not.toMatch(/(sm\|md\|lg\|xl):flex-(col\|row)/)`, since a `lg:flex-row` exists only to undo a `flex-col` beneath it — **plus** `not.toMatch(/\bflex-col\b/)` scoped to the scroller's own class string. The scoping is load-bearing: `flex-col` is legitimate three times in this file (the column `<section>`, the loading skeleton, the error block), so a file-wide ban would be a false positive. A `scrollerClass()` helper isolates the one element that must never stack by the `-mx-4` no other element carries, and **throws** if it cannot find it — a guard that cannot locate what it guards is broken, not green. **The gap was reproduced first**: the Reviewer's exact probe applied to the *unfixed* pin → **21 passed, green**, confirming the finding rather than taking it on trust. Then, against the fixed pin — **probe 1**, that same `flex flex-col lg:flex-row` → **1 red at the new line 118**; **probe 1b**, a bare `flex-col` with no breakpoint (invisible to the first assertion) → **1 red on the second assertion**, proving both halves carry weight; **probe 2**, `lg:w-full` re-run → **1 red at line 94**, the width half still honest. All three reverted; `git diff` on `side-by-side-columns.tsx` **empty**, 22/22 green |
| **R220** — the picker's design-verbatim sub-line (*"…and every column updates"*) is **live and false** as of this PR: ticking a player in one column leaves the other three containing him unchanged. The JSDoc at `side-by-side-picker.tsx:45-55` describes **LV.14's** behaviour in the present tense | should-fix | ✅ **Recorded as an interval, in the three places that will be read — and the copy is untouched, as directed.** The JSDoc section is retitled *"The copy's promise, what ships today, and what LV.14 adds"* and now says outright that the sentence is ahead of the behaviour, what LV.13 actually does (`useDraftMode(listId)` per column — one strike, three unmoved headers), that **LV.14 makes it true**, and that the wording is the design's and stays. The JSX comment beside the copy carries the same pointer, so a reader who lands on line 132 is not left to infer. **The plan's §6 LV.14 row now carries the obligation as task text** — make the sentence true, then clear this note and the JSDoc paragraph — because an obligation stated only where the *previous* Builder wrote it is R209's finding repeating. §4's LV.13 entry records the measurement (`2 of 2 left → 1 of 2 left` in one column, `aria-pressed="false"` and unchanged counts in the other three) and says plainly that this is not a defect in LV.13: one tick, one list is what D12 assigns to LV.14. Plan → **v5.4**. `side-by-side-columns.tsx` was already clean and is unchanged |
| **R217** — **D14 was inserted between D13's body and D13's closing paragraph**, so LV.15's *"the app-shell host renders nothing when no window is open"* now reads as part of a decision about column caps and phone variants | should-fix | ✅ **Moved back**, to exactly where `git show main:…` has it — D13's third paragraph, directly after *"…a pop-out reads the same server source as everything else."* D13 has its conclusion again and D14 no longer ends on a non-sequitur. Nothing was lost while it was misplaced (`ACTIVE-BUILD.md` and §6's LV.15 row both carry the clause), which is why this is a should-fix on *readability of the law* rather than a blocker. D14's tail instead now records that its own no-stacking pin was widened by R218 — the decision text and the guard it cites no longer disagree. Plan → **v5.4**, with a changelog entry naming the insertion so the same edit is not made again |
| **R219** — the new deliberately-retained local fixture is documented **only** in PROGRESS §4 — *precisely the placement R215 corrected one task earlier*; `git diff --stat main...HEAD -- docs/specs/ACTIVE-BUILD.md` was empty | should-fix | ✅ **One bullet in `ACTIVE-BUILD.md`'s standing constraints, directly beside LV.12's**, in the same form R215 used: what it is (`LV13 local fixture — round board`, `dev@fieldscout.local`, 8 players, `r1`–`r4`), **why it is load-bearing** (the only list on the local stack that can render a round-grouped column — without it every column groups by tier and a build that ignored per-column grouping entirely would produce identical-looking evidence), that `supabase db reset` destroys it, and the steps to re-create it. **The prescribed SQL was executed, not composed**: `docker exec supabase_db_fieldscout psql … "update list_players set tier = 'r' \|\| ((position - 1) / 2 + 1) where list_id = '<id>'"` → `UPDATE 8`, reproducing the fixture's exact `r1,r1,r2,r2,r3,r3,r4,r4` — local stack only, and idempotent against the live fixture. It also names why `r1`–`r4` are legal (LV.1.5's widened CHECK, schema exception (b)) so the next Builder does not read the fixture as a fourth schema change. §4's entry now points here rather than holding the steps itself |
| **R221** — the ledger states the executed-test delta as **"+10"** twice, contradicting its own suite total | nit | ✅ **Corrected to +6 in both places, with the arithmetic written out so it can be checked rather than trusted.** Counted, not inferred: `list-buckets.test.ts` `it(` count **10 on `main` → 16 on branch = +6** (4 `bucketHeading`, 2 `rankMap`); new file 21; **21 + 6 = 27 = 994 − 967**, the delta the same entry and the PR body both report. 21 + 10 = 31 reconciles with nothing. The second site also now reads **22** source pins, post-R218. A parenthetical says why it is worth fixing a number that harmed nothing: a stated delta that disagrees with a counted one teaches the next Builder to trust the statement |
| **R222** — §3 Q4's status header still read *"🟡 OPEN — needs a ruling before LV.13 builds columns"* though this PR recorded the ruling and shipped the columns | nit | ✅ **Applied.** Now *"✅ RULED — Chris, 2026-08-11 (option A + no phone variant)"*, cross-referencing D14 and noting that the recommendation line below was already correctly marked overtaken — only the header was stale. §1's *"All four questions were ruled"* line already agreed with the fix. **R216's own row above is left as written** (it says Q4's status *stays* open): it is the record of what was true at that time, not a live instruction — the same rule that round applied to R212's row |
| **R223** — §4's disclosure that the loading and error branches are "source-pinned only" is **out of date**; the Reviewer exercised both live and found the root cause of the failed `fetch` patch | nit | ✅ **Replaced with the method, aimed at the tasks that will need it.** §4 now records (1) **why a `fetch` monkey-patch looks installed and does nothing** — React Query pauses retries while `document.hasFocus()` is false, so an unfocused automation tab parks the query in `pending` forever (`status:'pending', fetchStatus:'fetching', failureCount:1, failureReason:'List not found'` off the fiber); a bubbling `visibilitychange` releases it — and (2) **the route that works**: soft-delete via `docker exec … psql` *after* the picker's collection query has cached, then commit the comparison → `GET /api/lists/<id>` → **404** → `Could not load` in the header and *"This list could not be loaded. / List not found"* in the body, **never an empty column**. `Loading…` was captured at commit. Written as a technique the **LV.15 – LV.17** pop-out states inherit, since they face the same problem, rather than as a gap in LV.13's evidence |

**Not changed, and why.** **No behaviour, anywhere.** The columns, the
full-bleed pairing, the per-column grouping, the one-tick-one-list mark, the
count's three states, every ×0.8 conversion and the two Chris rulings are
untouched — the review upheld all of them, and this round is a guard, a
disclosure and four documentation corrections. `side-by-side-columns.tsx` ends
the round **byte-identical to how it was reviewed** (all three R218 probes
reverted, `git diff` empty). The schema budget is still the ruled three — no
migration, no column, no new route; boards untouched; D3 still session-only; D11
composition unchanged. **The one write this round made to any database was to
the local stack**, and it was the idempotent `UPDATE 8` that proves R219's
re-creation SQL runs — it set the fixture's tiers to the values they already
held. **No new browser verification was run and none is claimed**: nothing
user-visible changed, and the live evidence for the columns remains the §4 run,
now including the loading/error states the Reviewer contributed.

### LV.14 — 2026-08-12 (PR #135) — verdict **CLEAN**

*Reviewer session (fresh context, red-team brief) against PR #135 — the drafted
fan-out — verified against plan v5.5 §1/§6, D11, D12, the design LAW's global
`toggleDrafted` and Chris's 2026-08-10 per-list override.* **The fan-out was
upheld in full and merged as-is**: the boundary is the comparison set and
nothing wider, the per-column rollback is driven through real caches, the
partial-failure protocol is stated and executed, the schema budget is untouched,
and `type-check` / `lint` / `test:unit` **1032** green. **R224–R225: two nits,
no should-fix, no blockers.** Both were left for the next PR by agreement rather
than reopening a clean branch, and **LV.15's PR carries them** — which is the
only reason they are recorded here at all rather than lost in a review that
found nothing to fix.

| Finding | Severity | Resolved by |
| --- | --- | --- |
| **R224** — the comment-stripper control's *rationale* is wrong. `drafted-fan-out.test.ts:596-601` says the negative pins forbid strings *"this file's own header uses"* and names `no new route`, `Promise.all`, `useQuery` — **none of which is in the file**: `useLists` 0, `useQuery` 0, `fetch(` 0, `/api/` 0, and the two `Promise.all` occurrences do not match the pin's `/Promise\.all\(/`. Replacing the stripper with `read(file)` leaves every negative pin green and reddens only the control itself | nit | ✅ **Reworded, and the control kept.** It is genuine and prophylactic — the mistake was in what it claimed, not in its existence — so the comment now says so outright: *no pin needs the stripper today* (with the four counts spelled out, including why `Promise.all` does not match), and the control *"keeps the stripper working for the header that eventually will use one"*. The `no new route` example is dropped. **LV.15's own control is the case R224 describes as hypothetical** — that file's pins forbid `shadow-`, `0.8` and `ZOOM`, all three of which its header uses — so the pattern is now load-bearing somewhere, which is the argument for keeping it here |
| **R225** — §5's F-LV14.1 says the fan-out *"neither introduced nor widened"* the count's blind spot. True about magnitude, and it glosses one new consequence: a tick now lands in columns the user did not click, including one whose **drafted** read failed, so a wrong header can move with **no interaction with that column at all** | nit | ✅ **Half a sentence added to the F-row**, naming the change as one of *reachability* rather than magnitude: before LV.14 a wrong `N of M left` needed you to tick in that column; now one tick moves every other column holding the player. **The deferral itself stands** — the Reviewer ruled it a correct deferral, not a CLAUDE.md violation, and the count is still LV.13's surface which LV.14's task text told it to leave alone |

### LV.15 — 2026-08-12 (PR #136) — verdict **FIX-THEN-MERGE**

*Reviewer session (fresh context, red-team brief) against PR #136 — the pop-out
store and the app-shell host — verified against plan v5.6 §6, D11, D13, the
design LAW's* Pop-out window *bullets and the ×0.8 rule.* **A great deal was
re-verified independently and is not re-opened**: the every-route contract holds
live on Home and Players (the host contributes zero nodes, no hydration
warnings); the non-portal decision is sound (the full ancestor chain walked — no
stacking context, no fixed-position containing block, no clipping); all four
z-index numbers are real and the orderings hold at real overlaps; **all nine**
claimed probes reproduce at exactly the stated red-counts; both clamps hit
`960×720` and `264×176`; collapse, navigation and reload-forgets-windows-but-
keeps-geometry all confirmed; the conversions are correct;
`elevation-rule.test.ts` untouched; the schema/API diff empty. **Both of the
Builder's judgment calls were upheld** — `z`-as-array-index is defensible (the
normative LAW says nothing about `z`; D13 asks for the array), and the
small-screen fit is *minimum necessary, not a mobile variant* (desktop
bit-identical and pinned; a dragged position verified never re-fitted).
**R226–R230: two should-fix, three nits, no blockers.**

***The finding that mattered (R226) — the third variant of one defect, and this
one guards every page in the app.*** *Both pins on the render-nothing contract
anchored on* `body.indexOf('return null')` *— the* **first** *early return in
the function, not the empty guard's. The Reviewer showed both halves at* **41
passed**: *(a) the guard moved below the JSX with a decoy* `if (false) return null`
*above it, and (b) a* `useEffect` *writing* `document.body.dataset.popouts`
*on the empty path behind* `if (windows === undefined) return null` *—* **an
effect firing on every route in the app**, *which is precisely what "the empty
path touches one store and nothing else" exists to forbid. The Builder's own
disclosed probe does go 1 red, so the log was honest — the pin was simply
narrower than it read.*

#### Resolution — 2026-08-12 (fix Builder, same branch `feat/LV15-popout-host-store`)

*All five findings resolved on the same branch; nothing deferred, nothing
escalated.* **One behaviour changed, deliberately and as directed** *— R227's
Escape handler. Everything else is a pin, a comment or a document.*
*Proof re-run this session:* **`type-check` clean · `lint` exit 0** *(the one
pre-existing `auction-draft-room.tsx:107` warning) ·* **`test:unit` 58 files /
1075 tests** *(1073 → 1075: R227's two new pins, `list-windows-host.test.ts`
17 → 19; the store suite is unchanged at 24, and 24 + 19 = 43).*
`settings-round-trip-db.test.ts` *is the known §5 leagues parallel-race flake,
outside `test:unit` and in the paused build — not chased.*

| Finding | Severity | Resolved by |
| --- | --- | --- |
| **R226** — both render-nothing pins anchor on `body.indexOf('return null')`, so any earlier early return satisfies them; the Reviewer's probes (a) and (b) each left the suite **41 passed** on a broken host, (b) with an effect running on every route | should-fix | ✅ **Widened to the whole guard, and both probes shown red — after being reproduced first.** The anchor is now a named constant `EMPTY_GUARD = 'if (windows.length === 0) return null'`, used by both pins. **The gap was reproduced before it was fixed**, per R218's precedent: probe (a) → **41 passed**, probe (b) → **41 passed**, confirming the finding rather than taking it on trust. Against the widened pins: **probe (a)** → **1 red** (`expected 322 to be less than 94` — the guard now located *below* the JSX); **probe (b)** → **1 red** on the labelled hook assertion (`useEffect: expected … not to contain 'useEffect'`). Both reverted, `git diff` on `list-windows-host.tsx` **empty**. **The rest of the file was then audited for the same shape, and three more pins were widened** — each shown red, each reverted: (1) `classNameContaining` returned the **first** matching element and now **throws on ambiguity**, because `cursor-grab` is one edit from being ambiguous — **LV.16 brings drag-reorder rows into this very file** (probe: a second `cursor-grab` → *"appears in 2 classNames … asserting about whichever came first"*); (2) the release-not-per-frame pins anchored on `onHeaderPointerUp`, a name the file carries **three** times, and asserted nothing about the **move** handlers though the comment claims "only" — now asserted against each handler's own body via a `handlerBody()` helper that throws if it cannot find one (probe: a per-frame `setPosition` in `onHeaderPointerMove` → **1 red**; that is the write `persist` turns into a `JSON.stringify` per frame); (3) *"nothing else mounts it"* ruled out exactly **two** named files while claiming the whole app — now `filesRendering('<ListWindowsHost')` over every `.tsx` under `src/`, asserted to equal `['src/components/layout/app-shell.tsx']` (probe: a third mount in `guest-shell.tsx`, a file neither named assertion covers → **1 red**) |
| **R227** — a pop-out has no keyboard close and no reachable `closeAll`, so a window met by a smaller viewport is permanently unreachable on **every** route | should-fix | ✅ **The precedent's escape hatch, mirrored — discharge (1) of the two offered, as directed.** `list-window.tsx` gains `window-shell.tsx`:123–129's effect: `if (!isTop) return`, `keydown` on `window`, `close(listId)` on Escape, listener removed on cleanup; the host computes `isTop={index === windows.length - 1}` because only it can see the siblings. **The defect was reproduced first, to the Reviewer's numbers**: dragged to `[1050, 400, 352, 416]` at 1280×900, viewport → 800×700 → `visibleWidth: 0`, `anyPixelVisible: false`, `scrollWidth === clientWidth` (800 = 800, nothing to scroll to), window absent from the screenshot — then **one Escape closed it**. **Escape closes only the top window**: three open (`00ab01`, `00ef01`, `00ab99`) → Escape → `00ab99` gone → Escape → `00ef01` gone, front-to-back, one per press. **Top follows focus, not open order**: focusing the buried window made *it* the one Escape closed. **One addition to the precedent, and it is load-bearing**: Radix listens on `document` in the **capture** phase and only `preventDefault()`s, so the bubble-phase listener still runs — the handler therefore ignores `e.defaultPrevented`, and **both directions were measured live**: *with* the guard, Escape over an open dialog dismissed the dialog and left the pop-out (`radixOpen 1→0`, `popouts` stays `1`); *without* it, one Escape took **both** (`popouts 1→0`). Pinned by two new `it`s (**17 → 19**), each shown red: no `isTop` guard → the `escapeEffect()` matcher **throws** (*"either there is no keyboard close at all, or it is not scoped to the front window"*); `isTop={true}` in the host → **1 red**; the effect deleted entirely → **1 red**. **`closeAll` is explained rather than wired**: `player-windows-store.ts`:81's `closeAll` has **no caller outside tests either**, and the D11 pin asserts that exact line is present in *both* files — so it is a mirrored API, not a forgotten stub, and the store now says so and points at LV.17 as where a caller would belong. A second finding fell out of proving the guard and is filed, not fixed: **F-LV15.4**, the precedent's own Escape closing the mini card when a Radix menu handled the key — reproduced live |
| **R228** — *"**Seven** probes"* over a **nine**-row table, in PROGRESS §4 and PR body line 86 | nit | ✅ **"Nine probes", both places**, with a clause naming the correction so a reader who half-remembers "seven" sees the fix rather than a bare change — the form **R221** used. Rows counted: **9**; red-counts 2,1,1,3,2,1,1,1,1, all of which the Reviewer reproduced |
| **R229** — `list-windows-host.test.ts:14` says the store suite is "(22 tests)"; it is **24** | nit | ✅ **22 → 24**, and the comment now records that PROGRESS §4 and the PR body both had it right, so only this one site was stale. Counted, not inferred: `it(` in `list-windows-store.test.ts` = **24**, and `24 + 17 = 41 = 1073 − 1032` reconciles |
| **R230** — the plan's **LV.16 row** carries neither **F-LV15.1** nor **F-LV15.2**, though both name LV.16 as owner | nit | ✅ **One clause added to §6's LV.16 row**, naming both by id and by what discharges them — delete `ListWindowBodyPending` outright (as LV.13 deleted `ComparisonPending`), and add the `gear` + `dots` LV.15 left *absent rather than inert* (**R220**), with the note that the menu is a compose off `list-display-store`'s `setOrg` + `ORG_OPTIONS`. Plan → **v5.7**, changelog entry naming this as **R209's finding for the third time** — LV.12→LV.13, LV.13→LV.14, now LV.15→LV.16 — since an obligation living everywhere except the successor's own row is the one a Builder does not read |

**Not changed, and why.** The store's shape, the `z`-as-index decision, the
z-layer numbers, both clamps, the cascade and its fit, `partialize`, the
no-shadow stroke and every ×0.8 conversion are **untouched** — the review upheld
all of them, including both judgment calls. The schema budget is still the ruled
three: **no migration, no column, no new API route**; boards untouched;
`src/components/ui/elevation-rule.test.ts` untouched. **The one behaviour change
is R227's Escape handler**, which the Reviewer directed and which is the
precedent's four lines rather than a new mechanism. **LV.16's and LV.17's work
was not started**: no inversion wrapper, no rows, no `gear`/`dots`, no mobile
variant — the Escape handler is an affordance and behaves identically at every
width.

**Verification environment.** Local stack only — `.claude/launch.json`
**`dev-local`** on port 3123; `http://127.0.0.1:54321/auth/v1/user → 200` and
the `dev@fieldscout.local` profile `11111111-…` observed in the network log.
**Nothing hosted was read or written, and this round wrote nothing to any
database.** The same temporary two-line `__listWindows` harness LV.15 disclosed
was used again (nothing opens a pop-out until LV.17) and **reverted before the
commit** — the string appears nowhere in the tree outside this file's own
disclosure.

**Two harness artefacts, recorded so the next task does not read them as product
defects.** (1) `resize_window` below **768px** switches the tab into **mobile
device emulation** (UA becomes `Android 14; Pixel 8`) and trusted key injection
stops arriving — a `computer{action:"key"}` Escape appeared to do nothing at
700×700 while a JS-dispatched one closed the window immediately. The 800×700
re-run is the one in the table above, and it stays desktop. **This one is a
genuine harness artefact and the Reviewer re-derived it independently**: the
product code is width-independent, and an identical *in-page* Escape at 700×700
under mobile emulation closes the window, so Chris's "no special treatment"
ruling is not violated.

(2) ~~Key injection is also dropped while `document.visibilityState ===
'hidden'`~~ — **wrong as stated, and corrected at R234 by measurement.** The
predictor is not `visibilityState`, and it is not width either: **injected keys
are dropped until the page has received one real click since the last load.**
A/B, desktop 1280×900, `vis: "hidden"` throughout, with a `window` + `document`
keydown trace installed on a fresh load:

| Sequence | Trace |
| --- | --- |
| fresh load → Escape → Escape | `[]`, **both dropped** — and `document.hasFocus()` had already flipped to `true` by the second, so it misleads too |
| …then one `left_click` into the page → Escape | `[{document, Escape, trusted:true}, {window, Escape, trusted:true}]` |
| fresh load → one `left_click` → Escape | lands on the **first** press — the click is the enabling event, not the second keypress |
| fresh load at 700×700, mobile emulation → Escape | `[]`, as in (1) |

**Five** consecutive injected Escapes landed at `vis: "hidden"` while proving
R231 — the reproduction, both halves, the chrome-button case and the stack
unwind — plus the **two** in rows 2 and 3 above, all seven at `vis: "hidden"`.
That is what rules `visibilityState` out. *(Counted from the run, not
estimated: a stated count that disagrees with a countable one teaches the next
Builder to trust the statement — **R221**.)* **The operational
advice is unchanged and gains a clause: stay ≥768px, and click into the page
once after every load.** R234 proposed re-attributing (2) to (1)'s mobile
emulation; that does not survive the first row of the table above — a *desktop*
fresh load drops the press just the same — and a note whose whole purpose is to
prevent a false diagnosis is the wrong place to install a second one.

Neither is a product behaviour, and both cost a false negative before being run
down — which is CLAUDE.md's *"never let 'nothing happened' mean 'it worked'"* in
the reverse direction: **a no-op that is the harness, not the code.**

#### Second review — 2026-08-12 (independent Reviewer, on the fix diff) — verdict **FIX-THEN-MERGE**

*A second Reviewer, fresh context, re-reviewed the R226–R230 fix diff.* **No
blockers, and a great deal was independently re-derived and is not re-opened**:
all nine widened pins fire (it broke each one); the Escape behaviour live —
three windows, one press each, front-to-back, top-follows-focus, zero-windows a
no-op, a collapsed window closes, no leaked or duplicated handler; the
`defaultPrevented` guard as genuinely load-bearing (measured both ways, with a
full reload to force effect re-registration); the sub-768px claim as a **genuine
harness artefact** (the product code is width-independent — an identical in-page
Escape at 700×700 under mobile emulation closes the window, so Chris's *"no
special treatment"* ruling is not violated); **F-LV15.4 as a real defect
correctly filed rather than fixed**; and the whole proof chain and scope.
**R231–R234: two should-fix, two nits.**

***The finding that mattered (R231) — the guard was narrower than the document
claiming it.*** *`if (e.defaultPrevented) return` only covers a consumer that
calls `preventDefault()`, which is Radix's habit and not the app's. Four of the
app's own Escape handlers skip it —* `players-spreadsheet.tsx`:1092,
`list-detail-hero.tsx`:121, `list-row-parts.tsx`:531, `list-builder.tsx`:294 *—
and the first is on **Players**, a route the app-shell-hosted window survives
to. Reproduced live at 1280×900: pop-out open on `/app/players`, focus in the
player-search input with* `alle` *typed, one Escape →* `popouts 1 → 0` *while
focus never left the input. **The user aimed at a search dropdown and lost a
window, on a page that is not Lists** — and §5's F-LV15.4 row said in as many
words that the pop-out was* not *affected.*

#### Resolution — 2026-08-12 (second fix Builder, same branch `feat/LV15-popout-host-store`)

*All four resolved on the same branch; nothing deferred, nothing escalated.*
**One behaviour changed, deliberately and as directed** *— R231's target guard.
R232 removes a file. Everything else is a pin or a document.*
*Proof re-run this session:* **`type-check` clean · `lint` exit 0** *(the one
pre-existing `auction-draft-room.tsx:107` warning) ·* **`test:unit` 58 files /
1077 tests** *(1075 → 1077: R231's two new pins, `list-windows-host.test.ts`
19 → 21).* `settings-round-trip-db.test.ts` *is the known §5 leagues
parallel-race flake, outside `test:unit` and in the paused build — not chased.*

| Finding | Severity | Resolved by |
| --- | --- | --- |
| **R232** — `docs/specs/PROGRESS-scout.md`, **an unrelated build's memory document, was swept into the fix-round commit `417aa16` undisclosed**: not on `main`, listed by `gh pr view 136 --json files`, absent from the PR body, and absent from *"Not changed, and why"*, which enumerated only `PROGRESS-lists-v2.md` and the plan | should-fix | ✅ **Out of the branch, still on disk, byte-identical.** `git rm --cached` and a commit of its own — not a working-tree delete: the file is **Chris's**, it belongs to a different build, and it survives untracked exactly as it was (`md5 e6a6e35d…`, mtime unchanged at Aug 11 19:03). Verified after: `git ls-files docs/specs/PROGRESS-scout.md` → **empty**, `ls` → **present**, `git diff main...HEAD --stat -- docs/specs/PROGRESS-scout.md` → **empty**. Its internal inconsistency is confirmed and recorded rather than fixed — the authority header cites `spec-scout.md` **v2.7** / `delivery-plan-scout.md` **v2.7**, both of which read **v2.5** on this branch; resolving that is Chris's, not this build's. **How it got staged, so the next task does not repeat it:** the file has been untracked-but-present in `docs/specs/` since **before this branch existed**, and LV.15's own commit `d4f5b5d` **does not contain it** — so the fix round staged by directory (`git add docs/specs`) or with `-A` rather than by explicit path. Every prior Builder in this build left it alone and said so. **Stage by explicit path** |
| **R231** — the Escape guard covers Radix and only Radix: `defaultPrevented` needs the consumer to have called `preventDefault()`, and four of the app's own Escape handlers do not. Reproduced live on `/app/players`, focus in the player-search input → one Escape → `popouts 1 → 0`. `PROGRESS:2997` **overstates the coverage** | should-fix | ✅ **Widened to ask where the key came from, and pinned in both directions — after being reproduced first.** `list-window.tsx` gains `escapeBelongsToTarget(e.target)` beside the existing `defaultPrevented` check, driven by a named `ESCAPE_BELONGS_TO_TARGET` selector that carries the whole decision. **The defect was reproduced before the fix** (R218's precedent): `before {"url":"/app/players","popouts":1,"store":["00ab01"],"active":"INPUT/Search players…"}` → one injected Escape → `after {…"popouts":0,"store":[]…}`. **Both halves then proven live, local stack, 1280×900** — (a) same setup, `dropdown: true → false` and **`popouts` stays `1`**, store unchanged; (b) focus on `<body>`, one Escape → `popouts 1 → 0`. **The two deliberate *exclusions* were proven live too**, which is the half a selector-only pin cannot show: with focus on the window's own `<button aria-label="Expand">` — inside its own `[role="dialog"]`, `matchesGuard: false` — one Escape still closed the top window of two (`["00ef01","00ab01"] → ["00ef01"]`), front-to-back. Had `button` or `[role=dialog]` been in the selector, that press would have done nothing. **Two new `it`s (19 → 21), and five probes each shown red then reverted**: delete the guard line (the pre-fix state) → **1 red** at the new assertion; drop `input` from the selector → **1 red** (`expected [ 'textarea', … ] to include 'input'`); add `[role="dialog"]` → **1 red**; the lazy `'*'` → **2 red**, one per half; rename the constant away → the locator **throws** on both, *"the Escape guard is back to covering only Radix, which is R231"*. `git diff` on `list-window.tsx` clean of every probe. **The four consumers were left alone as directed** — three are outside this surface and one is on Players; changing four to fix one guard is the wider blast radius. **§5's overstated claim is struck through and corrected in place** |
| **R233** — **F-LV15.4 is the only row in its table with no owning task**, and the only one describing a *live defect on a shipped surface* rather than a build hand-off | nit | ✅ **Given a home outside this build, via the task-chip mechanism.** Chip **`task_c1e3da1c`** — *"Fix player mini card closing on a handled Escape"* — carrying the file and line numbers (`window-shell.tsx`:123–129), the cause (no `defaultPrevented` check against Radix's capture-phase `preventDefault()`, **plus** the four app handlers R231 found), the full reproduction, and the instruction to **copy `list-window.tsx`'s now-fixed guard rather than re-invent it** — including its comment on what is deliberately excluded, since `button` or `[role=dialog]` in that selector would disable the keyboard close outright. The chip id is recorded in the F-row, and the F-row now says why "LV.16" / "LV.17" were never available to it |
| **R234** — recorded harness artefact **(2) is wrong as stated**, in a note whose whole purpose is to save the next task from a false diagnosis: injection is **not** dropped merely because `document.visibilityState === 'hidden'` | nit | ✅ **Struck and replaced with an A/B table of what was actually measured — and the prescribed rewording did not survive that measurement either, which is said out loud.** R234 proposed re-attributing (2) to (1)'s mobile emulation; a **desktop** 1280×900 fresh load drops the press just the same (`trace: []` on **two** consecutive Escapes, with `document.hasFocus()` already `true` by the second — so it misleads too). The predictor that fits every observation: **injected keys are dropped until the page has received one real click since the last load**. Isolated: fresh load → one `left_click` → the **first** Escape lands, `trusted: true`, still at `vis: "hidden"`; and six consecutive Escapes landed under `vis: "hidden"` while proving R231. `visibilityState` is ruled out, (1) is untouched and upheld, and the operational advice stands with one clause added: **stay ≥768px, and click into the page once after every load** |

**Not changed, and why (second pass).** The store's shape, the `z`-as-index
decision, the z-layer numbers, both clamps, the cascade and its fit,
`partialize`, the no-shadow stroke, every ×0.8 conversion, and R226's five
widened pins are **untouched** — the second review upheld all of them. The
`isTop` scoping, the `defaultPrevented` check and the front-to-back unwind are
unchanged; R231 **adds** a second question to the same handler rather than
replacing the first. The schema budget is still the ruled three: **no migration,
no column, no new API route**; boards untouched;
`src/components/ui/elevation-rule.test.ts` untouched. **The four Escape handlers
R231 names were deliberately not edited** — `players-spreadsheet.tsx`,
`list-detail-hero.tsx`, `list-row-parts.tsx`, `list-builder.tsx` all keep their
`preventDefault()`-less Escape, per the Reviewer's direction. LV.16's and
LV.17's work was not started. **Files changed this round: three** —
`list-window.tsx`, `list-windows-host.test.ts`, this document — plus the
`git rm --cached` of `PROGRESS-scout.md`.

**Verification environment (second pass).** Local stack only —
`.claude/launch.json` **`dev-local`** on port 3123, `127.0.0.1:54321` returning
the `dev@fieldscout.local` profile `11111111-…`. **Nothing hosted was read or
written, and this round wrote nothing to any database.** The same temporary
two-line `__listWindows` harness was used again and **reverted before the
commit** — `grep -rn "__listWindows" src/` returns nothing.

### LV.16 — 2026-08-12 (PR #137) — verdict **FIX-THEN-MERGE**

*Reviewer session (fresh context, red-team brief) against PR #137 — the pop-out
window's content — verified against plan v5.7 §6, D3, D11, D12, D13, the design
LAW's* Pop-out window *bullets and the ×0.8 rule.* **A great deal was
independently re-derived and is not re-opened**: the inversion's colour decision
is sound and its **blast radius is zero** — the redirects are *descendant* rules,
`tailwind.config.ts` untouched, and outside the wrapper `text-n-3` measures
`rgb(95,100,109)`, `border-n-4` `rgb(231,232,233)`, `bg-white` `rgb(255,255,255)`
and `border-ink` `rgb(11,12,16)`, byte-for-byte the config hex, with exactly one
`.fs-dark` in the tree; `text-ink` correct in both halves; the Stats picker
portalled to `BODY` and light while its window stays `rgb(22,22,22)`; **the
`handleDrop` extraction verbatim** (the diff differs on exactly one line —
`const handleDrop = React.useCallback(` → `return React.useCallback(`); the D12
boundary live; every measured number; the proof chain at **1101** with the
arithmetic checked; and 4 of the 10 claimed probes reproduced at their exact
messages. **R235–R242: three should-fix, five nits, no blockers.**

***The finding that mattered (R235) — LV.16 made the app's drag layer ambiguous,
and nothing in LV.17's task text would have sent anyone looking.*** `hitTest` was
`document.elementFromPoint(x, y).closest('[data-drop-row]')` *with no scoping to
the surface that owns the gesture, and* `planDrop`*'s only cross-surface guard is*
`groups.findIndex((g) => g.key === target.bucketKey)` *(*`list-reorder.ts`*:98) —
which passes whenever the two surfaces share a bucket key, and two ranked lists
both produce* `all`. *On* `main` *this was unreachable:* `grep -rn "useListDrag(" src/`
*returned **one** consumer. This branch adds a second, at* `list-window.tsx`*:362,
and the pop-out is* `position: fixed` *at* `z-45` *— it overlaps the panel by
design.*

#### Resolution — 2026-08-12 (fix Builder, same branch `feat/LV16-window-content`)

*All eight resolved on the same branch; nothing deferred, nothing escalated.*
**Two behaviours changed, both directed** *— R235/R236's DOM scoping and R237's
share fallback. R238 adds one CSS redirect. Everything else is a pin, a comment
or a document.*
*Proof re-run this session:* **`type-check` clean · `lint` exit 0** *(the one
pre-existing `auction-draft-room.tsx:107` warning) ·* **`test:unit` 58 files /
1126 tests** *(1101 → 1126, **+25**: R238's audit 19, R235/R236's five,
R237's one; `list-windows-host.test.ts` 44 → 69).*
`settings-round-trip-db.test.ts` *is the known §5 leagues parallel-race flake,
outside `test:unit` and in the paused build — not chased.*

| Finding | Severity | Resolved by |
| --- | --- | --- |
| **R235** — a drop released over a *different* drag surface writes to the dragged list at the **foreign** surface's index. Measured with both mounted: 18 `[data-drop-row]` nodes in one `all:*` namespace. Not user-reachable in this PR (nothing opens a window until LV.17) — but LV.17's task text gives its reviewer no reason to look here | should-fix | ✅ **Scoped to the surface that owns the gesture, and reproduced both ways first.** `useListDrag` now owns a `rootRef`; `hitTest(root, …)` gates on `root.contains(at)` **before** the `closest()` chain (`closest` walks *up*, so one containment check is sufficient — and the *order* is pinned, not merely the presence). **Reproduced pre-fix, live, local stack**, panel = *Secret sleepers* (`all:0–1`), pop-out = *Consensus WR top 10* (`all:0–9`): (a) dragged the pop-out's `#10` and released over the **panel's** first row → `PATCH /api/lists/…ab01/players/reorder` moving that player to position 1, **persisted** (`psql` confirmed `1 │ 12863`), panel untouched; (b) dragged the **panel's** first row and released over the pop-out's `all:7` → `PATCH /api/lists/…ab99/players/reorder`, panel now `#1 Josh Allen`. **Post-fix, same two gestures: refused.** Over the foreign surface every gap closes (`openGaps: []`), release → **no PATCH**, both orders unchanged. A release over another surface is refused rather than redirected — there is no sensible reading of "this list's player into that list's slot". **The mechanism cannot be forgotten**: `ListDragContext` renders the root itself, taking over the one flex container each consumer already had via `className`, so the DOM is unchanged in both surfaces and there is no ref for a caller to drop. **Probes, each red then reverted**: the gate moved below the `closest()` chain → **1 red** (`expected 983 to be less than 229`); a null root falling back to the page → **1 red**; the ref never attached → **1 red**; the window keeping its own `<div>` inside the context → **1 red** |
| **R236** — `document.querySelector('[data-drag-id="…"]')` is a global first match, and the same list open in the panel *and* a pop-out puts the same id in the DOM twice. **The fifth instance of the unscoped-locator shape R226 named — and the first in product code rather than a test** | should-fix | ✅ **One fix closed both, as the finding predicted.** The measurement is now `rootRef.current?.querySelector(…)`, and `document.querySelector` appears nowhere in the file. **Reproduced pre-fix**: same list in both surfaces → 4 `[data-drag-id]` nodes, **2 duplicated ids**; sample → `[{inWin:false,h:48,w:716},{inWin:true,h:29,w:351}]` and `document.querySelector` returned the **panel's** 48px row (`<ListWindowsHost />` sits after `{children}` in `app-shell.tsx`:93, so the panel always wins document order). A drag inside the window then opened a gap of `height: 48px` on 29px rows — measured off the element's own style. **Post-fix the same drag opens `29`**, and the panel's own drag still opens `48`, both measured with 20 rows and **10 duplicated ids** live. Probe: restore `document.querySelector` → **1 red** |
| **R237** — *"Link copied"* for a link that 404s. `query-provider.tsx` sets only `staleTime`, so the collections query keeps React Query's **5-minute default `gcTime`** and is evicted once the user leaves `/app/lists` — which a pop-out is built to survive. For a **saved** list `viewerName` is then non-null and *wrong*, the refusal never fires, and the public page matches on `owner_id` **and** `slug` | should-fix | ✅ **The fallback asks whose list it is**, as directed: `cached?.owner?.username ?? (list?.is_owner ? viewerName : null)`. **Both halves measured live on `/app`, with the pop-out of `bbbb2222-…cd01` (owner `devpro`) open and every `lists/collection` query evicted** (`cachedRow: null`; the query's own `gcTime` read back as **300000**, confirming the premise): *pre-fix source* copied `…/u/dev_user/lists/lv12-local-fixture-dev-pro-wr-room` → **HTTP 404**; *post-fix* copies **nothing** (`clipboard.writeText` never called) and shows *"Could not build the share link — Open the list on the Lists page and share it from there."* The correct URL `…/u/devpro/…` → **HTTP 200**. With the cache warm it copies the `devpro` link either way. **The overstated claim is corrected in both places it was made** — §5's F-LV16.1 row and the PR body. Probe: restore `?? viewerName` → **1 red** |
| **R238** — the five `.fs-dark` redirects are enumerated by hand with nothing that fails when a component rendered inside the wrapper uses a palette utility that is not on the list — **and one such case was already live**: `list-thumbnail.tsx`:208's empty quadrant, reached through `ListCoverTile` in the window header | nit | ✅ **Audited by a test, and the live case fixed.** `.fs-dark .bg-n-4 → var(--fs-dark-hairline)` closes the quadrant: measured **1.61:1 → 5.14:1** (`#b3b9c0` on `rgba(255,255,255,.22)` composited over the tile's own `bg-ink`, `rgb(65,65,69)`), and **the blast radius is still zero** — outside the wrapper `bg-n-4` remains `rgb(231,232,233)`, and the other four redirects re-measured unchanged in both halves. The audit is `elevation-rule.test.ts`'s shape: **16 declarations** that render inside the wrapper, each extracted by a `declarationSource()` locator that **throws on missing *and* on ambiguous**, and every `text-*` / `bg-*` / `border-*` palette utility must be redirected in the token layer or listed in `LEGIBLE_ON_DARK` **with the reason it still reads on `#161616`**. Per-component rather than per-file deliberately: a whole-file scan drags in `PlayerMeta`'s injury chip and `NoteMark`'s tooltip, which a pop-out never renders, and the allowlist fills with hollow reasons. The two exclusions are **checked, not asserted in prose** — `ui/icon.tsx` carries zero palette utilities (`currentColor`), and the window renders exactly **one** `<Button`, whose fill and ink the footer's own pin already fixes. It found a further genuine case on first run: `bg-ink`, allowlisted with Chris's 2026-08-11 ruling behind it. **Probes**: drop the `bg-n-4` redirect → **5 red** across four components and the quadrant pin; a `text-caution` added to `ListWindowRow` → **1 red** naming the file, the component and the utility; a second `<Button` → **1 red** |
| **R239** — *"the checkbox's 75% stroke is the **only** per-instance dark class"* asserted that the class exists and that row-parts still has the 14px box; **nothing asserted "only"**. R226's own finding one file over | nit | ✅ **The set is asserted.** The pin reads the `className` handed to **every** shared child — the list is *derived from the `./list-row-parts` import* plus `ListCoverTile` and `PositionBadge`, so a fifth row part brought in later is covered without anyone remembering — requires `DraftedCheckbox`'s to be exactly `['border-white/75']` at **every** site, and requires each of the others' to carry no palette utility and no `text-[#…]`. Probe: `PlayerName` given `text-white` (a type-valid prop it already takes) → **1 red**, `<PlayerName className="… text-white">: expected [ 'text-white' ] to deeply equal []` |
| **R240** — `indentOf` used `.find()` and threw only when the marker was *missing*, never when **ambiguous** — the exact gap R226 hardened `classNameContaining` against, reintroduced in the helper added beside it | nit | ✅ **Collects all matching lines and throws on more than one**, as its neighbour does — *"it no longer identifies one element, so the structural pin below is asserting about whichever came first"*. **The gap was reproduced before it was closed**, per R218/R226: with the old `.find()` restored **and** a second `onPointerDown={onHeaderPointerDown}` added, the suite stayed **69 passed**; against the hardened locator the same edit is **1 red** with the ambiguity message. Both reverted, `git diff` clean. R240's own argument is the record: its markers are unique *today*, which is exactly what was true of `cursor-grab` at LV.15 |
| **R241** — `:759` pinned a Prettier-owned multi-line import block verbatim; brittle, no falsifiability, and the two assertions after it already carry the claim — while the same suite at `:534` explicitly refuses this | nit | ✅ **Replaced by the two questions it was standing in for**: `from './list-buckets'` and the existing `ORG_OPTIONS.map((option)`. **Shown both ways**: collapsing the import onto one line — which is what Prettier writes if it fits — leaves the new assertions **69 passed** while the deleted pin's string is absent, i.e. the old pin would have gone red for a change that changes nothing; and the replacement is falsifiable — repointing the import at a forked `./window-buckets` (the LV.7 failure shape it exists to catch) → **1 red** |
| **R242** — the new `StatsCatalog` doc says the window shows it in a `Dialog`; it is a **`Popover`**. Related: the anchor at `right-9 top-8` sits under the *collapse* control, not the gear, so *"opens under the `gear` that summoned it"* is also approximate | nit | ✅ **Both corrected in prose, with the measurement in the comment.** `list-toolbar.tsx` now says `Popover` and separates what the LAW actually makes normative (*outside that wrapper … it belongs to the light page*) from the widget it happens to name a "modal", with the measurement recorded: `[data-radix-popper-content-wrapper]`, parent `BODY`, `z-index: 50`. `list-window.tsx`'s anchor comment now says the picker hangs from the **chrome cluster**, not from the gear, and carries the numbers — anchor `x 956` against gear `885–905` and collapse `939–959` on a 352px window. **The anchor itself is deliberately unchanged**: the header is four 20px controls in 36px, the panel is 212px, and hanging it off the cluster is what keeps it inside the frame at the 264px minimum width. No pin — this is a comment, and inventing one for it would be the ceremony R241 just removed |

**Not changed, and why.** The inversion's mechanism and its five original values,
the ×0.8 conversions, the `no-shadow` stroke, the row geometry, `use-list-drop.ts`
(**untouched this round** — `git diff` on it is empty, so the refusal toast and
the sequenced writes are literally the code the Reviewer verified as a verbatim
extraction), the D12 boundary, the Stats picker's placement outside the wrapper,
and the header's control order are **untouched** — the review upheld all of them.
The schema budget is still the ruled three: **no migration, no column, no new API
route**; boards untouched; `src/components/ui/elevation-rule.test.ts` untouched;
the window still carries no shadow. **The two shipped surfaces F-LV16.1 names
were deliberately not edited** — `lists-page-v2.tsx` and `list-detail-panel.tsx`
keep their `'you'` fallback, because R237 asked for the window's claim to be
corrected, not for a sweep. LV.17's work was not started. **Files changed this
round: six** — `use-list-drag.tsx`, `list-body.tsx`, `list-window.tsx`,
`list-toolbar.tsx`, `globals.css`, `list-windows-host.test.ts` — plus this
document.

**The panel's drag-and-drop was proven unchanged, because R235/R236 change a
hook the merged, shipped detail panel uses.** All four aspects, live, post-fix:
**reorder** — dragged the panel's `#1` past `#2`, one `PATCH …/ab99/players/reorder`,
order swapped; **re-bucket** — dragged `#3 Adonai Mitchell` from tier `A` into
tier `S`, one `PATCH …/players/11625/tier {"tier":"S"}` and **no** reorder,
correctly, because the flattened order did not change; **write sequencing** —
the same player then dragged into tier `B`, `PATCH …/tier {"tier":"B"}` at
`t=…770631` followed by `PATCH …/players/reorder` at `t=…770740`, **109ms
later** and only on the first's success, never fired together; **the refusal** —
in an `Avg cost` grouping the panel offers **no drag at all** (0 `[data-drop-gap]`
rendered after a full press-and-move, no request, order unchanged) and all
**10** grips carry `COMPUTED_ORDER_REASON` as their tooltip. That last one is
worth stating precisely: `canReorder('cost')` is `false`, so `useDragHandle` is
disabled and `use-list-drop.ts`'s refusal *toast* is not reachable through a
drag — the grip's reason is the shipped affordance, and the toast's code is
unchanged because the file is.

**Verification environment.** Local stack only — `.claude/launch.json`
**`dev-local`** on port 3123, `dev@fieldscout.local`. **Nothing hosted was read
or written.** Two temporary harnesses were used and **both reverted before the
commit**: the `__listWindows` store handle LV.15 disclosed (nothing opens a
pop-out until LV.17) and a two-line `__qc` handle on `query-provider.tsx`, needed
to evict the collections query on demand for R237 — `grep -rn "__listWindows\|__qc"
src/` returns nothing and `git diff` on both files is empty. **The local DB was
written during the R235 reproduction and restored exactly**: `list_players`
positions and tiers for `…ab01` and `…ab99` diff **clean** against the
pre-verification snapshot, and no list was created or deleted, so both documented
fixtures (`LV12 local fixture`, `LV13 local fixture`) are intact.

---

### LV.16 second review — 2026-08-12 (PR #137) — verdict **CLEAN**, five nits carried to LV.17

*A second independent Reviewer session over the LV.16 fix round returned CLEAN
with no blockers and no should-fixes.* **R243–R247 were carried into LV.17's PR
rather than re-opening a merged branch**, which is the house's own rule for nits
that arrive after a merge (LV.14's R224/R225 were carried by LV.15 the same way).
All five are resolved in LV.17.

| Finding | Severity | Resolved by |
| --- | --- | --- |
| **R243** — the R238 audit's `INSIDE_THE_WRAPPER` set omits two components that **do** render inside the wrapper (`PlayerAvatarImage` via `player-image.tsx`:37 and `AvatarImage` via `ui/avatar.tsx`:29, reached through `ListCoverTile` → `PlayerQuadrant`), and its *"the two exclusions are checked"* prose is wrong — four things were excluded, two silently. No live defect (both carry layout / `object-fit` classes only), but *the enumeration that exists to replace memory was itself maintained by memory* | nit | ✅ **Both added to the set** (they pass on the first run, which is the point), the floor raised 16 → 20, and the exclusions block now says what it excludes: `ui/icon.tsx` and `ui/button.tsx`, and only those. Probe: a `bg-caution` added to `PlayerAvatarImage` → **1 red** naming the file, the component and the utility — the case that was previously invisible |
| **R244** — `isRedirected()` substring-matched the whole of `globals.css` **including its ~100-line prose header**, so a *sentence* about a redirect could satisfy the audit. Nothing was falsely green, but that header is exactly where the next redirect gets argued about before it is written | nit | ✅ **Matched as a declaration, over comment-stripped CSS** — the standard the quadrant pin already used, applied to the helper the whole audit runs through. **The gap was reproduced first**: with the pre-R244 helper, a prose line *"A later round may want a `.fs-dark .text-caution` redirect; not yet."* plus a **live, unredirected `text-caution` on `ListWindowRow`** left the suite at **86 passed**; the hardened helper on the identical tree is **1 red** — *"ListWindowRow paints text-caution inside the dark wrapper, and nothing says what happens to it."* Both reverted. **A second instance of the same shape was found while probing the first** and fixed with it: the *"every redirect points at a property"* pin sliced from the first `.fs-dark .` occurrence **anywhere in the file**, which the probe's prose line moved into the comment block, dragging the header's own quoted hex values into two negative pins |
| **R245** — `handlerBody()` was the **sixth** instance of the first-match-locator shape, unhardened, in the file R240 had just hardened `indentOf` in. It backs the four geometry-commit pins | nit | ✅ **Collects the declarations and throws on more than one**, as `indentOf`, `declarationSource` and `classNameContaining` now do. **Reproduced both ways**: a second `const onGripPointerDown` against the old first-match locator → **86 passed**; against the hardened one → **1 red**, *"`const onGripPointerDown` is declared 2 times … it no longer identifies one handler."* Reverted |
| **R246** — `use-list-drag.tsx`'s containment gate asks *"does this root contain the point"*, not *"is this the **nearest** root"*, so **nested** drag surfaces would restore R235 outer→inner. Not reachable because `<ListWindowsHost />` is a **sibling** of `{children}` — *"and LV.17 is the task most likely to change that"* | nit | ✅ **Both halves, as the finding preferred.** A pin: the host's line in `app-shell.tsx` is **shallower** than `{children}` and **after** it, so it cannot be a descendant of anything `{children}` sits in (indentation as a depth proxy, the idiom `indentOf` already documents). And a paragraph in `use-list-drag.tsx`'s header naming the precondition where the next reader is. Probe: `<ListWindowsHost />` moved inside the content wrapper beside `{children}` → **1 red**. LV.17 did **not** move the host |
| **R247** — the local fixture `Secret sleepers` (`aaaa1111-…ab99`) carried `lists.player_count = 3` against **2** `list_players` rows, so the picker card and the rail said *"3 players"* for a 2-player list. Pre-existing drift | nit | ✅ **Corrected in the local DB** (`update lists set player_count = (select count(*) …)`), verified by a whole-table check that now returns **0 rows** of drift, and observed in the UI: the rail and the picker both read **2 players**. Noted beside the LV12/LV13 fixtures in `ACTIVE-BUILD.md` so a `db reset` does not silently reintroduce it |

### LV.17 — 2026-08-12 (PR #138) — verdict **ESCALATE**, then **RULED** and fixed

*Reviewer session (fresh context, red-team brief) against PR #138 — pop-out
wiring, states and the phone answer.* **A great deal was independently
re-derived and is not re-opened**: the proof chain at **1148** with per-file
arithmetic confirmed against a `main` worktree; the schema budget closed; boards
and `elevation-rule.test.ts` untouched; `box-shadow: none` at `z-index 45`; D12
measured with `psql` (one tick in a pop-out, on a player sitting on four lists,
wrote exactly **one** row); D3 (reload → windows gone, geometry kept);
**R243–R247 all genuinely closed** — R244 reproduced both ways and R245
reproduced by the Reviewer itself; and **R246 did not regress**: the host is
still a sibling and the pin goes red when it is moved.

**Two questions were escalated rather than filed, and Chris ruled on both**
(2026-08-12). They are §3 **Q5** and **Q6**, and they are now rulings in the
delivery plan's §1 (v6.0). **R250 and R251 are therefore not "findings the
Builder resolved" — they are findings that correctly refused to resolve
themselves.** That is the escalation working: both were product calls a Builder
had *made*, and one of them (the phone answer) had said so in its own last
paragraph.

***The finding that mattered (R248) — the app stated a cause it cannot know, and
it re-worded a merged surface doing it.*** A 404 from `GET /api/lists/[id]`
collapses **three** situations and the shipped copy named one of them:
*"This list was deleted. / Its owner deleted it."* The third situation is a list
that is **alive with `deleted_at` NULL** and merely no longer visible to this
viewer — one click of a shipped visibility control. Both the Reviewer and this
round reproduced it, in a rolled-back transaction and then live with the DOM and
the DB read side by side. **CLAUDE.md's rule inverted**: the reason *inferred*
from a status the server collapses, on the one build whose whole idiom is
asserting the reason for emptiness.

| Finding | Severity | Resolved by |
| --- | --- | --- |
| **R250** — a pop-out of a deleted list persists-and-explains, reversing the prototype's `store.destroy` on a Builder's reading of the LAW | escalate | ✅ **RULED by Chris: *"Close it, with a toast."*** Built: a `gone`-guarded effect closing the window and raising **"This list is no longer available."** Recorded in §3 **Q5**, plan §1 and plan v6.0. Measured live — deleting `LV17fix tmp A` with its pop-out open → **windows 1 → 0** and the toast. **Both halves pinned**, since either alone is the other's defect. Probe: the close removed, toast kept → **1 red** (*"expected 'toast({ title: LIST_UNAVAILABLE })' to contain 'close(listId)'"*), reverted |
| **R251** — pop-outs need a real mobile variant; "the phone gets the same window" is a product decision a Builder made | escalate | ✅ **RULED by Chris: full width, 60% height, toolbar = Close + Options, everything else into the menu.** Built and measured at 375 × 812: **100.00% × 60.00%**, bottom gap **0**, inline style `z-index: 45` only, no grip, `["Options", "Close"]`, menu = *Choose stats · ─ · five grouping modes · ─ · Expand*. **One breakpoint**, `WINDOW_MOBILE_MAX_W = 768`, executed by `isSmallViewport` in the store test; **no `sm:`/`md:`/`lg:` anywhere in `list-window.tsx`**, pinned. Desktop bit-identical and measured: drag → `[464, 382]`, resize → `472 × 496`, both to the predicted pixel, both persisted. Probes: the mobile drag guard removed → **1 red**; the sheet un-anchored (`top-10`, `vh`) → **1 red**. Both reverted |
| **R248** — `listReadIsGone` treats every 404 as *"deleted"*, and the copy says so; **and it changed a merged surface** (`side-by-side-columns.tsx`:275, `'Could not load'` → `'Deleted'`) | should-fix | ✅ **One neutral state, and the merged surface restored.** `ListReadFailure`'s gone branch is `LIST_UNAVAILABLE` — *"This list is no longer available."*, the **same exported constant** as Chris's toast — and the only thing left for an owner is a **condition** (*"If you deleted it, you can restore it from Trash."*). `listReadIsGone`'s header now carries all three situations with the measurement. The column's sub-line is back to LV.13's **`Could not load`** and no longer imports the predicate; its *body* stays the shared component, fixed upstream in one place. **Reproduced live before and after**: `LV12` flipped `is_private = true` with `deleted_at NULL`, pop-out open → the window closed with the neutral toast where the shipped code named a deletion that never happened. Fixture restored and re-verified. Pin: with the conditional clause removed, `ListReadFailure` must contain no *"deleted / removed / owner"* at all. Probe: `'This list was deleted.'` reinstated → **1 red**, reverted |
| **R249** — the ledger records a false premise as measured fact: *"the deleted state was **not reachable at all**"* | should-fix | ✅ **Record corrected in all four places it appears** — PROGRESS §1's round row, §2b's LV.17 checklist row, §4 item 3, and plan v5.9 (via v6.0 and the §6 row) — to *"a 404 surfaced one retry late, and a shared hook was changed to make it immediate."* The `fetchStatus: 'paused'` observation is **diagnosed rather than dropped**: it is React Query's **offline** pause (`networkMode: 'online'`), which a resolved HTTP 404 does not trigger. The counts the Reviewer measured are recorded (`retry: 1` → 3 `queryFn` calls, no-retry → 2, `data` retained either way). **The change is kept on its true merits**, as directed. `useList`'s own JSDoc carries the correction, so the next reader meets it at the line rather than in a document |
| **R252** — the predicate is `status < 500`, materially wider than the 404-only argument above it | nit | ✅ **`if (status === 404) return false`.** Everything else keeps the app-wide single retry: this same route answers 401/403/400 on `PATCH`/`DELETE` (`route.ts`:147, 176, 302, 319), and 408/429 are canonically retryable. Pinned both ways — the new predicate present **and** `status < 500` absent. Probe: the old predicate restored → **1 red**, reverted |
| **R253** — F-LV17.2's deferral reason (*"Not currently reachable"*) is wrong | nit | ✅ **Reworded to the accurate reason**: it *is* reachable, by the same two routes, and R249's retry removal makes it immediate — but **its copy is not wrong**, so the split is a design call rather than a defect. The line reference is corrected to `list-detail-panel.tsx`:300–312 |
| **R254** — the touch claim still rests on synthetic pointer events; no real browser touch gesture has driven this window in any session | nit | ✅ **Filed as F-LV17.5 rather than restated in prose**, since Ruling 2 makes mobile a designed surface. The limitation is stated where the claim is (`list-window.tsx`, §4), and this round hit the identical wall — the tooling's pointer input times out under mobile emulation. Two tooling facts are recorded for the next session so the hour is not spent again: `computer` coordinates are **screenshot pixels** (0.625 × CSS at 1280), and `resize_window` fires **neither** `resize` nor a `matchMedia` `change`. **No code fix**, as directed |
| **R255** — the R246 indentation proxy has a residual hole: a host inside `<main>` but after the content wrapper passes both assertions while still sitting in the page tree | nit | ✅ **Replaced with a containment walk.** `ancestorsOf()` climbs the enclosing chain by indentation (resolving Prettier's multi-line opening tags to their `<tag` head) and the pin asserts that **no element enclosing the page encloses the host**, plus the host's depth equals `<BottomTabs />`'s — the sibling it shares — with a **control test** proving the walk finds ancestors at all. **The hole was demonstrated, not just closed**: with the host moved inside `<main>`, the new pin is **red** and the pin *as it shipped* — re-run verbatim in a scratch file against the same tree — is **green**. Reverted; `app-shell.tsx` is not in this diff, and the mobile variant does **not** move the host |

**Scope discipline.** Files changed this round: **eight** —
`list-window.tsx`, `list-row-parts.tsx`, `side-by-side-columns.tsx`,
`use-lists.ts`, `list-windows-store.ts`, and three test files — plus this
document and the delivery plan. `app-shell.tsx`, `elevation-rule.test.ts`, the
boards tree and every leagues surface are untouched; no migration, no column, no
route; `docs/specs/PROGRESS-scout.md` stays untracked and unmodified
(md5 `e6a6e35d89ea102b7142fbdfdacf4765`). **No `.fs-dark` redirect was added** —
the R238 audit stayed green with the two new components in its set.

**Proofs.** `npm run test:unit` **1159 passed / 58 files** (baseline 1148, **+11**:
+4 executed in `list-windows-store.test.ts`, +7 source-pinned in
`list-windows-host.test.ts`). `npm run type-check` clean; `npm run lint` clean
apart from the pre-existing unrelated `auction-draft-room.tsx` warning. **Six
break-probes, each shown red and reverted**, plus the R255 hole shown green
under the shipped pin.

---

## 7. LV.2 design-gap review — 2026-08-10 (Chris sent prototype screenshots)

**PR #114 is to be scrapped, not patched.** It is built on the wrong structure.

**Root cause: nobody building this had ever seen the design.** The handoff
package contains a prose spec and four `.jsx` files, **no images**, and is
missing `index.html` / `players.js`, so the prototype cannot be run locally
either. Every fidelity decision so far was made from a written description.
Chris: *"it's so far off I'm not really sure I can give you any feedback."*

**⚠️ Before the rebuild: `docs/design/lists/screens/` must exist**, holding the
prototype screenshots (`list-rail`, `cards`, `side-by-side`,
`side-by-side-picker`, `detail-cards`, `detail-table`). Chris is adding them.
**Compare against the images, not the prose** — see gap 4 for why the prose
alone is not trustworthy.

### The four gaps, observed from the screenshots

1. **Rail mode *is* the list detail — this is the structural error.** The
   design's right-hand panel carries the *complete* open list: hero with cover,
   name, `@handle` byline and created date; the Share (lime) / dots / expand /
   pop-out / close cluster; List · Details · Comments tabs with the view count
   right-aligned; the toolbar (`Ranked ⌄` bare-select, three view-style icons,
   `Stats 4`, `Add players`); and the player rows themselves. **LV.2 shipped a
   cover, a name and an "Open list" button in a thin strip**, with ~80% of the
   page blank. The README says it in its second line — *"List (rail + open
   list)"* — and the plan still split LV.2 from LV.3, which guaranteed an empty
   frame. **They are one screen and must be one task.**

2. **Cover tiles are the wrong object.** The design uses a solid saturated
   block with large initials or a glyph — `★`, `BB`, `WR`, `$`, `11`, `RK`,
   `0R` — in bright green / blue / purple / orange / teal / pink. In Cards mode
   it becomes a full-bleed colour band with the initials at display size and a
   category icon top-right. LV.2 reused the existing `ListThumbnail`, which
   renders a 2×2 grid of player headshots, tinted by position. Different
   component, different idea.

3. **Side by side is not Round 2.** It is fully realised in the prototype and
   is the draft-night surface: a picker screen ("Pick the lists to compare"),
   then columns showing `5 of 6 left`, per-row drafted checkboxes, strikethrough
   on drafted players, and tier bands carrying through each column. LV.2 shipped
   it disabled with a "coming in round 2" tooltip. **Reconsider the Round 1 /
   Round 2 split** — this is where Chris's own drafted-checkbox ruling lands.

4. **The tier ramp is warm, and the written spec is wrong about it.** The
   handoff says *"`--tier-1` … `--tier-6` | indigo ramp"*, and LV.2 built to
   that. The screenshots show red → orange → gold → green → teal — which is
   what `tailwind.config.ts` **already ships**: `tier-2..6` =
   `#df5551 / #e58033 / #e6b422 / #3fa055 / #1f9aa6`. The tokens were right and
   the prose misled. General lesson: where the two disagree, the screenshots
   and the tokens win.

### ⚠️ Gap 2 was WRONG and is reversed — 2026-08-11

**Cover tiles were never the wrong object.** Gap 2 below reads the prototype's
glyphs as the intended treatment and calls `ListThumbnail` *"different
component, different idea"*. Chris ruled the opposite the same day: the
headshots were right all along, and only the **fill** changes — the list's
position group, ink when there is no filter. The gallery band swaps the 2×2
quadrants for four 24px headshots stacked in the bottom-right. See §4's
`LV.2-fix` entry and the boxed exception at the top of `screens/README.md`.

**Read gap 2 as a record of a mistake, not as instruction.** Its own general
lesson — *where the screenshots and the prose disagree, the screenshots win* —
survives; what it missed is that a screenshot of **fake data** is not a
statement of intent, and neither outranks a ruling.

### ✅ Closed by the rebuild — 2026-08-11

All four gaps are addressed in the LV.2 + LV.3 PR; see §4's entry for the
judgement calls. **Gap 3 is the one that did *not* change**: side by side is
still not built. It renders its segment and says so in plain words rather than
a "coming in round 2" tooltip, so the header stays honest about the three modes
the design has. Whether it moves into Round 1 is Chris's call, not a Builder's —
the drafted checkbox it needs is already permanent and already shipped.

### Process note

LV.2's builder did its job — it verified hover states live, caught a real
false-empty-state bug in its own code by breaking the API deliberately, and
recorded every interpretation it made. **It could not catch this class of
error, because it was checking its work against the same prose that was
wrong.** No amount of review discipline substitutes for seeing the design.
