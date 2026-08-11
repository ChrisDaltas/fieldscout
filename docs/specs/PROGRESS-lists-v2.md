# PROGRESS — Lists v2

> **The build loop's only memory for this build.** Re-read at the start of
> every cycle; never rely on chat history. Every cycle ends at a task boundary
> with this file current and `main` clean, so a session can be compacted or
> killed at any point and a fresh one resumes losslessly.
>
> **Authority:** design LAW (`docs/design/lists/README.md`) > delivery plan
> (`docs/specs/delivery-plan-lists-v2.md` v4.0) > this file.
>
> Active per `docs/specs/ACTIVE-BUILD.md`. Task ids are `LV.*`. **`L.*` tasks
> belong to the paused leagues build — never pick one from here.**

---

## 1. Milestone status

| Round | Contents | Exit criteria | Status |
| --- | --- | --- | --- |
| **Round 1** | Lists page (rail + cards) and list detail (hero, tabs, toolbar, three view styles, drag-and-drop, stats picker, notes, drafted) in the new design language | Both screens match the handoff at desktop and mobile; `featureFlags.listsV2` flipped on; old components retired | 🔵 In progress (LV.1.1–LV.1.4 landed 2026-08-09; **LV.2 + LV.3 landed 2026-08-11**; **LV.8 (attached links) landed 2026-08-11**; **LV.4 (drag-and-drop) landed 2026-08-11**; **LV.2-fix (cover treatment → player headshots over a position-group fill) landed 2026-08-11**; **LV.9 (one tab/segment component) landed 2026-08-11**; **LV.10 (DEF → team logo + a real image fallback) landed 2026-08-11**; **LV.11 (single-select filter rows onto that control) landed 2026-08-11** — the screen exists, is comparable against `screens/`, and is now editable by dragging. **LV.1.5 (the tier CHECK widening) landed 2026-08-11** — the last schema task, and the one that turned Rounds from a rendering-complete empty section into a working grouping. Remaining: LV.5–LV.7) |
| **Round 2** | Side-by-side compare; pop-out windows (app-shell hosted) | — | ⚪ Deferred (plan §6) |

**Nothing is parked. Both questions were ruled on 2026-08-09.** **Q1** — build
LV.1.3 as written (no users exist, so there are no drafted marks to preserve).
**Q2** — widen the tier CHECK constraint, the build's second and final schema
exception. Every Phase 1 task is pickable and no ruling is outstanding.

Every task is unblocked. LV.3.9 depends on LV.1.3 and LV.3.6 on LV.1.5, both
of which are now buildable.

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
- [ ] **LV.5** — AI list generation + persona surfaces restyled into the new
  language (CLAUDE.md: never leave them in the old style, never remove them)
- [ ] **LV.6** — public share view `/u/[username]/lists/[slug]`, still
  server-rendered (D7)
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
- [ ] **LV.7** — cutover: flag flip, retire the old components, and **delete
  `use-board-marks.ts` and the old `/app/lists/draft-mode` 3-state cycle**
  (§1's boards amendment scopes this). Also fixes that file's now-false header
  comment (R192) — it claims parity with `use-draft-mode.ts`, which went false
  at LV.1.3 when that hook started writing to the database

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

---

## 5. Blockers

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

Nothing else blocks Lists v2. **Phase 2 (LV.2.1, LV.2.2, LV.2.3) and LV.3.1 are
clear of both Q1 and Q2** — that is where the loop should go next.

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
